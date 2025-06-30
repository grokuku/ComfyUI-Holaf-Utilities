# === Holaf Utilities - Image Viewer Utilities & Routes ===
import asyncio
import os
import hashlib
import json
import math
import time
import datetime
import traceback
from urllib.parse import unquote, quote
import re
import aiofiles
import sqlite3 # Ensured import is present
import shutil # For moving files AND rmtree
import uuid # ADDED for export jobs
from PIL import PngImagePlugin # ADDED for metadata embedding

from aiohttp import web
from PIL import Image, ImageOps, UnidentifiedImageError
import folder_paths # ComfyUI global

from . import holaf_database
from . import holaf_utils # For sanitize_filename, THUMBNAIL_CACHE_DIR, THUMBNAIL_SIZE

# --- Constants ---
SUPPORTED_IMAGE_FORMATS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
TRASHCAN_DIR_NAME = "trashcan" # Name of the trash directory within output_dir
STANDARD_RATIOS = [
    {"name": "1:1", "value": 1.0}, {"name": "4:3", "value": 4/3}, {"name": "3:4", "value": 3/4},
    {"name": "3:2", "value": 3/2}, {"name": "2:3", "value": 2/3}, {"name": "16:9", "value": 16/9},
    {"name": "9:16", "value": 9/16}, {"name": "16:10", "value": 16/10}, {"name": "10:16", "value": 10/16},
    {"name": "5:4", "value": 5/4}, {"name": "4:5", "value": 4/5}, {"name": "21:9", "value": 21/9},
    {"name": "9:21", "value": 9/21},
]
RATIO_THRESHOLD = 0.02 # 2% tolerance for matching standard ratios

# --- Thumbnail Worker Globals ---
viewer_is_active = False # Updated by /viewer-activity endpoint
# Potentially add a lock if access becomes concurrent in a more complex worker
# thumbnail_generation_lock = asyncio.Lock() # If needed for DB operations inside worker

WORKER_IDLE_SLEEP_SECONDS = 5.0  # Sleep when no work is found
WORKER_POST_JOB_SLEEP_SECONDS = 0.1 # Very short sleep after completing a job


# --- Helper for Trashcan ---
def ensure_trashcan_exists():
    """Ensures the trashcan directory exists within the main output directory."""
    output_dir = folder_paths.get_output_directory()
    trashcan_path = os.path.join(output_dir, TRASHCAN_DIR_NAME)
    if not os.path.exists(trashcan_path):
        try:
            os.makedirs(trashcan_path, exist_ok=True)
            print(f"🔵 [Holaf-ImageViewer] Created trashcan directory: {trashcan_path}")
        except OSError as e:
            print(f"🔴 [Holaf-ImageViewer] Failed to create trashcan directory {trashcan_path}: {e}")
            return None
    return trashcan_path

# Call it once at module load to be sure
ensure_trashcan_exists()


# --- Database Synchronization ---
def sync_image_database_blocking():
    print("🔵 [Holaf-ImageViewer] Starting image database synchronization...")
    output_dir = folder_paths.get_output_directory()
    trashcan_full_path = os.path.join(output_dir, TRASHCAN_DIR_NAME)
    current_time = time.time()
    conn = None
    sync_exception = None

    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # Fetch mtime and size for existing DB images to detect changes (non-trashed only for this check)
        cursor.execute("SELECT id, path_canon, mtime, size_bytes, thumbnail_last_generated_at FROM images WHERE is_trashed = 0")
        db_images = {row['path_canon']: dict(row) for row in cursor.fetchall()}

        disk_images_canons = set()
        if not os.path.isdir(output_dir):
            print(f"🟡 [Holaf-ImageViewer] Output directory not found: {output_dir}")
        else:
            for root, dirs, files in os.walk(output_dir):
                # Skip the trashcan directory itself and its contents from regular sync
                if os.path.normpath(root) == os.path.normpath(trashcan_full_path):
                    dirs[:] = [] # Don't go into subdirectories of trashcan
                    continue

                # Also skip if root is a subfolder of trashcan_full_path
                if os.path.normpath(root).startswith(os.path.normpath(trashcan_full_path) + os.sep):
                    continue

                for filename in files:
                    file_ext = os.path.splitext(filename)[1].lower()
                    if file_ext not in SUPPORTED_IMAGE_FORMATS:
                        continue

                    try:
                        full_path = os.path.join(root, filename)
                        file_stat = os.stat(full_path)

                        subfolder = os.path.relpath(root, output_dir)
                        if subfolder == '.': subfolder = ''
                        
                        # Ensure we are not processing something already in trashcan (double safety)
                        if subfolder.startswith(TRASHCAN_DIR_NAME + '/') or subfolder == TRASHCAN_DIR_NAME:
                            continue

                        path_canon = os.path.join(subfolder, filename).replace(os.sep, '/')
                        disk_images_canons.add(path_canon)

                        existing_record = db_images.get(path_canon)

                        if existing_record: # Image exists in DB and is not trashed
                            if existing_record['mtime'] != file_stat.st_mtime or \
                               existing_record['size_bytes'] != file_stat.st_size:
                                cursor.execute("""
                                    UPDATE images
                                    SET mtime = ?, size_bytes = ?, last_synced_at = ?,
                                        thumbnail_status = 0, thumbnail_priority_score = 1000, thumbnail_last_generated_at = NULL
                                    WHERE id = ? AND is_trashed = 0
                                """, (file_stat.st_mtime, file_stat.st_size, current_time,
                                      existing_record['id']))
                        else: # New image found on disk (not in DB or was previously trashed and now outside trash)
                            cursor.execute("""
                                INSERT OR REPLACE INTO images 
                                    (filename, subfolder, path_canon, format, mtime, size_bytes, last_synced_at, is_trashed, original_path_canon)
                                VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
                            """, (filename, subfolder.replace(os.sep, '/'), path_canon, file_ext[1:].upper(),
                                  file_stat.st_mtime, file_stat.st_size, current_time))
                    except Exception as e:
                        print(f"🔴 [Holaf-ImageViewer] Error processing file {filename} during sync: {e}")

        conn.commit()

        # Remove non-trashed DB entries for files no longer on disk (excluding trashcan)
        stale_canons = set(db_images.keys()) - disk_images_canons
        if stale_canons:
            print(f"🔵 [Holaf-ImageViewer] Found {len(stale_canons)} stale non-trashed image entries to remove from DB.")
            for path_canon_to_delete in stale_canons:
                cursor.execute("DELETE FROM images WHERE path_canon = ? AND is_trashed = 0", (path_canon_to_delete,))
            conn.commit()
        print("✅ [Holaf-ImageViewer] Image database synchronization complete.")

    except Exception as e:
        sync_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error during sync: {e}")
        traceback.print_exc()
    finally:
        if conn:
            holaf_database.close_db_connection(exception=sync_exception)


# --- Metadata Extraction ---
def _sanitize_json_nan(obj):
    if isinstance(obj, dict):
        return {k: _sanitize_json_nan(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_sanitize_json_nan(i) for i in obj]
    elif isinstance(obj, float) and math.isnan(obj):
        return None
    return obj

def _get_best_ratio_string(width, height):
    if height == 0: return None
    actual_ratio = width / height
    min_diff = float('inf')
    best_match = None
    for r_info in STANDARD_RATIOS:
        diff = abs(actual_ratio - r_info["value"])
        if diff < min_diff:
            min_diff = diff
            best_match = r_info["name"]
    if min_diff / actual_ratio < RATIO_THRESHOLD:
        return best_match
    common_divisor = math.gcd(width, height)
    return f"{width // common_divisor}:{height // common_divisor}"

def _extract_image_metadata_blocking(image_path_abs):
    # print(f"🔵 [Holaf-ImageViewer-Debug] Starting metadata extraction for: {image_path_abs}") # DEBUG
    directory, filename = os.path.split(image_path_abs)
    base_filename = os.path.splitext(filename)[0]

    prompt_txt_path = os.path.join(directory, base_filename + ".txt")
    workflow_json_path = os.path.join(directory, base_filename + ".json")

    result = {
        "prompt": None, "prompt_source": "none",
        "workflow": None, "workflow_source": "none",
        "width": None, "height": None, "ratio": None
    }

    if os.path.isfile(prompt_txt_path):
        try:
            with open(prompt_txt_path, 'r', encoding='utf-8') as f: result["prompt"] = f.read()
            result["prompt_source"] = "external_txt"
        except Exception as e:
            result["prompt"] = f"Error reading .txt file: {e}"; result["prompt_source"] = "error"

    if os.path.isfile(workflow_json_path):
        try:
            with open(workflow_json_path, 'r', encoding='utf-8') as f: loaded_json = json.load(f)
            result["workflow"] = _sanitize_json_nan(loaded_json)
            result["workflow_source"] = "external_json"
        except Exception as e:
            result["workflow"] = {"error": f"Error reading/parsing .json: {e}"}; result["workflow_source"] = "error"

    try:
        with Image.open(image_path_abs) as img:
            result["width"], result["height"] = img.size
            result["ratio"] = _get_best_ratio_string(result["width"], result["height"])
            if hasattr(img, 'info') and isinstance(img.info, dict):
                # FIX: Check for prompt from internal PNG metadata
                if result["prompt_source"] == "none" and 'prompt' in img.info:
                    result["prompt"] = img.info['prompt']
                    result["prompt_source"] = "internal_png"

                if result["workflow_source"] == "none" and 'workflow' in img.info:
                    try:
                        loaded_json = json.loads(img.info['workflow'])
                        result["workflow"] = _sanitize_json_nan(loaded_json)
                        result["workflow_source"] = "internal_png"
                    except Exception:
                        result["workflow"] = {"error": "Malformed workflow in PNG"}; result["workflow_source"] = "error"
    except FileNotFoundError:
        return {"error": "Image file not found for internal metadata read."}
    except UnidentifiedImageError:
        print(f"  [Debug] 🟡 Note: Could not read image data for {filename}. Reason: UnidentifiedImageError (corrupt or unsupported format for metadata).")
    except Exception as e:
        print(f"  [Debug] 🟡 Note: Could not read image data for {filename}. Reason: {e}")

    # print(f"✅ [Holaf-ImageViewer-Debug] Finished metadata extraction for: {filename}") # DEBUG
    return result

# --- Thumbnail Generation ---
def _create_thumbnail_blocking(original_path_abs, thumb_path_abs, image_path_canon_for_db_update=None):
    """ Returns True on success, False on failure. Handles its own DB updates and error logging. """
    conn_update_db = None
    update_exception = None
    try:
        if os.path.exists(thumb_path_abs):
            try:
                os.remove(thumb_path_abs)
            except OSError as e_remove_pre:
                print(f"🟡 [Holaf-ImageViewer] Failed to preemptively remove {thumb_path_abs}: {e_remove_pre}. Will attempt save anyway.")

        with Image.open(original_path_abs) as img:
            img_copy = img.copy()
            target_thumb_dim_config = holaf_utils.THUMBNAIL_SIZE
            target_dim_w, target_dim_h = target_thumb_dim_config if isinstance(target_thumb_dim_config, tuple) else (target_thumb_dim_config, target_thumb_dim_config)
            original_width, original_height = img_copy.size
            if original_width == 0 or original_height == 0: raise ValueError("Original image dimensions cannot be zero.")

            ratio = min(target_dim_w / original_width, target_dim_h / original_height)
            new_width = int(original_width * ratio)
            new_height = int(original_height * ratio)
            if new_width <= 0: new_width = 1
            if new_height <= 0: new_height = 1

            img_copy = img_copy.resize((new_width, new_height), Image.Resampling.LANCZOS)
            img_to_save = img_copy
            if img_copy.mode in ('RGBA', 'LA') or ('transparency' in img_copy.info and img_copy.mode == 'P'):
                try:
                    background = Image.new("RGB", img_copy.size, (128, 128, 128))
                    img_for_paste = img_copy.convert('RGBA') if img_copy.mode == 'P' else img_copy
                    mask = img_for_paste.split()[-1] if 'A' in img_for_paste.mode else None
                    if mask and mask.mode == 'L': background.paste(img_for_paste, (0,0), mask=mask)
                    else: background.paste(img_for_paste, (0,0)) # Paste without mask if no alpha or unexpected mask
                    img_to_save = background
                except Exception as e_paste:
                    print(f"🔴 [Holaf-ImageViewer] Error during transparent background paste for {thumb_path_abs}: {e_paste}. Falling back to simple convert.")
                    img_to_save = img_copy.convert("RGB")
            else:
                img_to_save = img_copy.convert("RGB")
            img_to_save.save(thumb_path_abs, "JPEG", quality=85, optimize=True)

        if image_path_canon_for_db_update: # Success
            conn_update_db = holaf_database.get_db_connection()
            cursor = conn_update_db.cursor()
            cursor.execute("""
                UPDATE images
                SET thumbnail_status = 2, thumbnail_last_generated_at = ?, thumbnail_priority_score = 1000
                WHERE path_canon = ?
            """, (time.time(), image_path_canon_for_db_update))
            conn_update_db.commit()
        return True
    except UnidentifiedImageError as e_unid:
        update_exception = e_unid
        print(f"🔴 [Holaf-ImageViewer] Could not identify image: {original_path_abs}")
        if image_path_canon_for_db_update:
            conn_update_db = holaf_database.get_db_connection()
            cursor = conn_update_db.cursor()
            cursor.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (image_path_canon_for_db_update,))
            conn_update_db.commit()
        return False
    except Exception as e_gen:
        update_exception = e_gen
        print(f"🔴 [Holaf-ImageViewer] Error in _create_thumbnail_blocking for {original_path_abs}: {e_gen}")
        if image_path_canon_for_db_update:
             conn_update_db = holaf_database.get_db_connection()
             cursor = conn_update_db.cursor()
             cursor.execute("UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = CASE WHEN thumbnail_priority_score > 1000 THEN 1000 ELSE thumbnail_priority_score END WHERE path_canon = ?", (image_path_canon_for_db_update,))
             conn_update_db.commit()
        if os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception as e_clean: print(f"🔴 [Holaf-ImageViewer] Could not clean up failed thumbnail {thumb_path_abs}: {e_clean}")
        return False
    finally:
        if conn_update_db:
            holaf_database.close_db_connection(exception=update_exception)


# --- API Route Handlers ---
async def get_filter_options_route(request: web.Request):
    conn = None
    response_data = {"subfolders": [], "formats": [], "has_root": False}
    error_status = 500
    current_exception = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # Get subfolders from non-trashed images
        cursor.execute("SELECT DISTINCT subfolder FROM images WHERE subfolder != '' AND is_trashed = 0")
        subfolders = {row['subfolder'] for row in cursor.fetchall()}

        # Check if there are any items in the trash
        cursor.execute("SELECT 1 FROM images WHERE is_trashed = 1 LIMIT 1")
        has_trashed_items = cursor.fetchone() is not None

        # If there are trashed items, add 'trashcan' to the list of folders to be displayed
        if has_trashed_items:
            subfolders.add(TRASHCAN_DIR_NAME)

        # Get formats from non-trashed images
        cursor.execute("SELECT DISTINCT format FROM images WHERE is_trashed = 0")
        formats = sorted([row['format'] for row in cursor.fetchall()])

        # Check for non-trashed images in root
        cursor.execute("SELECT 1 FROM images WHERE subfolder = '' AND is_trashed = 0 LIMIT 1")
        has_root_images = cursor.fetchone() is not None
        
        conn.commit()
        response_data = {"subfolders": sorted(list(subfolders)), "formats": formats, "has_root": has_root_images}
        return web.json_response(response_data)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Failed to get filter options from DB: {e}")
        return web.json_response(response_data, status=error_status)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def list_images_route(request: web.Request):
    conn = None
    filters = {}
    current_exception = None
    default_response_data = {
        "images": [], "filtered_count": 0, "total_db_count": 0, "generated_thumbnails_count": 0
    }
    try:
        filters = await request.json()
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        query_fields = "id, filename, subfolder, format, mtime, size_bytes, path_canon, thumbnail_status, thumbnail_last_generated_at, is_trashed, original_path_canon"
        query_base = f"SELECT {query_fields} FROM images"
        where_clauses, params = [], []

        folder_filters = filters.get('folder_filters', [])
        
        # If 'trashcan' is selected, we ONLY show the trashcan, regardless of other selections.
        if TRASHCAN_DIR_NAME in folder_filters:
            where_clauses.append("is_trashed = 1")
            # Build a condition that only matches the trashcan and its subdirectories.
            where_clauses.append("(subfolder = ? OR subfolder LIKE ?)")
            params.extend([TRASHCAN_DIR_NAME, f"{TRASHCAN_DIR_NAME}/%"])

        else: # Normal view, non-trashed items
            where_clauses.append("is_trashed = 0")
            if folder_filters:
                conditions = []
                for folder in folder_filters:
                    if folder == 'root':
                        conditions.append("subfolder = ?")
                        params.append('')
                    else:
                        conditions.append("(subfolder = ? OR subfolder LIKE ?)")
                        params.extend([folder, f"{folder}/%"])
                if conditions:
                    where_clauses.append(f"({ ' OR '.join(conditions) })")

        format_filters = filters.get('format_filters', [])
        if format_filters: # Format filters apply to both trash and non-trash views
            placeholders = ','.join('?' * len(format_filters))
            where_clauses.append(f"format IN ({placeholders})"); params.extend(format_filters)

        if filters.get('startDate'):
            try:
                dt_start = datetime.datetime.strptime(filters['startDate'], '%Y-%m-%d')
                where_clauses.append("mtime >= ?"); params.append(time.mktime(dt_start.timetuple()))
            except (ValueError, TypeError): print(f"🟡 Invalid start date: {filters['startDate']}")
        if filters.get('endDate'):
            try:
                dt_end = datetime.datetime.strptime(filters['endDate'], '%Y-%m-%d') + datetime.timedelta(days=1)
                where_clauses.append("mtime < ?"); params.append(time.mktime(dt_end.timetuple()))
            except (ValueError, TypeError): print(f"🟡 Invalid end date: {filters['endDate']}")

        final_query = query_base
        if where_clauses:
            final_query += " WHERE " + " AND ".join(where_clauses)

        count_query_filtered = final_query.replace(query_fields, "COUNT(*)")
        cursor.execute(count_query_filtered, params)
        filtered_count = cursor.fetchone()[0]

        # Total non-trashed images in DB
        cursor.execute("SELECT COUNT(*) FROM images WHERE is_trashed = 0")
        total_db_count = cursor.fetchone()[0]
        # Generated thumbnails for non-trashed images
        cursor.execute("SELECT COUNT(*) FROM images WHERE thumbnail_status = 2 AND is_trashed = 0")
        generated_thumbnails_count = cursor.fetchone()[0]
        
        conn.commit()

        final_query += " ORDER BY mtime DESC"
        cursor.execute(final_query, params)
        images_data = [dict(row) for row in cursor.fetchall()]
        
        return web.json_response({
            "images": images_data,
            "filtered_count": filtered_count,
            "total_db_count": total_db_count,
            "generated_thumbnails_count": generated_thumbnails_count
        })
    except json.JSONDecodeError as e_json:
        current_exception = e_json
        print(f"🔴 [Holaf-ImageViewer] Invalid JSON in list_images_route: {e_json}")
        return web.json_response({"error": "Invalid JSON", **default_response_data}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error listing filtered images: {e}"); traceback.print_exc()
        return web.json_response({"error": str(e), **default_response_data}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def delete_images_route(request: web.Request):
    conn = None
    current_exception = None
    output_dir = folder_paths.get_output_directory()
    trashcan_base_path = ensure_trashcan_exists()
    if not trashcan_base_path:
        return web.json_response({"status": "error", "message": "Trashcan directory could not be created/accessed."}, status=500)

    try:
        data = await request.json()
        paths_canon_to_delete = data.get("paths_canon", [])
        if not paths_canon_to_delete or not isinstance(paths_canon_to_delete, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        
        deleted_files_count = 0
        errors = []

        for original_path_canon in paths_canon_to_delete:
            original_full_path = os.path.normpath(os.path.join(output_dir, original_path_canon))
            
            if not os.path.isfile(original_full_path):
                errors.append({"path": original_path_canon, "error": "File not found on disk."})
                # Mark as trashed in DB anyway if it exists, to clean up entry
                cursor.execute("UPDATE images SET is_trashed = 1, original_path_canon = ? WHERE path_canon = ? AND is_trashed = 0", 
                               (original_path_canon, original_path_canon))
                continue

            original_subfolder, original_filename = os.path.split(original_path_canon)
            
            # Create corresponding subfolder structure in trashcan
            trash_subfolder_path = os.path.join(trashcan_base_path, original_subfolder)
            os.makedirs(trash_subfolder_path, exist_ok=True)
            
            # Determine unique filename in trash (simple append of timestamp for now if conflict)
            destination_filename_in_trash = original_filename
            destination_full_path_in_trash = os.path.join(trash_subfolder_path, destination_filename_in_trash)
            
            counter = 0
            base_name, ext = os.path.splitext(destination_filename_in_trash)
            while os.path.exists(destination_full_path_in_trash):
                counter += 1
                destination_filename_in_trash = f"{base_name}_{counter}{ext}"
                destination_full_path_in_trash = os.path.join(trash_subfolder_path, destination_filename_in_trash)

            new_path_canon_in_trash = os.path.join(TRASHCAN_DIR_NAME, original_subfolder, destination_filename_in_trash).replace(os.sep, '/')
            new_subfolder_in_trash = os.path.join(TRASHCAN_DIR_NAME, original_subfolder).replace(os.sep, '/')


            try:
                shutil.move(original_full_path, destination_full_path_in_trash)
                
                # Move associated .txt and .json files
                base_original_path, _ = os.path.splitext(original_full_path)
                base_dest_path_in_trash, _ = os.path.splitext(destination_full_path_in_trash)

                for meta_ext in ['.txt', '.json']:
                    original_meta_file = base_original_path + meta_ext
                    dest_meta_file_in_trash = base_dest_path_in_trash + meta_ext
                    if os.path.exists(original_meta_file):
                        shutil.move(original_meta_file, dest_meta_file_in_trash)
                
                cursor.execute("""
                    UPDATE images 
                    SET is_trashed = 1, original_path_canon = ?, path_canon = ?, subfolder = ?, filename = ?
                    WHERE path_canon = ? AND is_trashed = 0 
                """, (original_path_canon, new_path_canon_in_trash, new_subfolder_in_trash, destination_filename_in_trash, original_path_canon))
                
                if cursor.rowcount > 0:
                    deleted_files_count += 1
                else: # DB record might have been already marked or missing
                    errors.append({"path": original_path_canon, "error": "DB record not updated (already trashed or missing). File moved."})


            except Exception as move_exc:
                errors.append({"path": original_path_canon, "error": f"Failed to move file: {str(move_exc)}"})
        
        conn.commit()
        status_message = f"Processed {len(paths_canon_to_delete)} items. Successfully deleted {deleted_files_count} files."
        if errors:
            status_message += f" Encountered {len(errors)} errors."
            return web.json_response({"status": "partial_success", "message": status_message, "details": errors}, status=207)
        
        return web.json_response({"status": "ok", "message": status_message, "deleted_count": deleted_files_count})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error deleting images: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def restore_images_route(request: web.Request):
    conn = None
    current_exception = None
    output_dir = folder_paths.get_output_directory()

    try:
        data = await request.json()
        paths_canon_to_restore = data.get("paths_canon", [])
        if not paths_canon_to_restore or not isinstance(paths_canon_to_restore, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        restored_files_count = 0
        errors = []

        for path_in_trash_canon in paths_canon_to_restore:
            # Get the original path from the database
            cursor.execute("SELECT original_path_canon FROM images WHERE path_canon = ? AND is_trashed = 1", (path_in_trash_canon,))
            row = cursor.fetchone()
            
            if not row or not row['original_path_canon']:
                errors.append({"path": path_in_trash_canon, "error": "DB record not found or original path is missing."})
                continue
            
            original_path_canon = row['original_path_canon']
            current_full_path_in_trash = os.path.normpath(os.path.join(output_dir, path_in_trash_canon))
            original_full_path_restored = os.path.normpath(os.path.join(output_dir, original_path_canon))

            if not os.path.isfile(current_full_path_in_trash):
                errors.append({"path": path_in_trash_canon, "error": "File not found in trashcan."})
                # Clean up the DB entry if the file is gone
                cursor.execute("DELETE FROM images WHERE path_canon = ?", (path_in_trash_canon,))
                continue

            if os.path.exists(original_full_path_restored):
                errors.append({"path": path_in_trash_canon, "error": f"Conflict: A file already exists at the original location '{original_path_canon}'."})
                continue
            
            # Ensure destination directory exists
            os.makedirs(os.path.dirname(original_full_path_restored), exist_ok=True)
            
            try:
                # Move the main image file
                shutil.move(current_full_path_in_trash, original_full_path_restored)

                # Move associated .txt and .json files
                base_path_in_trash, _ = os.path.splitext(current_full_path_in_trash)
                base_restored_path, _ = os.path.splitext(original_full_path_restored)
                
                for meta_ext in ['.txt', '.json']:
                    meta_file_in_trash = base_path_in_trash + meta_ext
                    restored_meta_file = base_restored_path + meta_ext
                    if os.path.exists(meta_file_in_trash):
                        shutil.move(meta_file_in_trash, restored_meta_file)

                # Update the database record
                new_subfolder, new_filename = os.path.split(original_path_canon)
                cursor.execute("""
                    UPDATE images
                    SET is_trashed = 0, original_path_canon = NULL, path_canon = ?, subfolder = ?, filename = ?
                    WHERE path_canon = ?
                """, (original_path_canon, new_subfolder.replace(os.sep, '/'), new_filename, path_in_trash_canon))

                if cursor.rowcount > 0:
                    restored_files_count += 1
                else:
                    # This case is unlikely if we passed the initial select, but good for safety
                    errors.append({"path": path_in_trash_canon, "error": "DB record could not be updated after file move."})

            except Exception as move_exc:
                errors.append({"path": path_in_trash_canon, "error": f"Failed to move file: {str(move_exc)}"})

        conn.commit()
        status_message = f"Processed {len(paths_canon_to_restore)} items. Successfully restored {restored_files_count} files."
        if errors:
            status_message += f" Encountered {len(errors)} errors."
            return web.json_response({"status": "partial_success", "message": status_message, "details": errors}, status=207)

        return web.json_response({"status": "ok", "message": status_message, "restored_count": restored_files_count})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error restoring images: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

# --- NEW: Route for permanent deletion ---
async def delete_images_permanently_route(request: web.Request):
    conn = None
    current_exception = None
    output_dir = folder_paths.get_output_directory()

    try:
        data = await request.json()
        paths_canon_to_delete = data.get("paths_canon", [])
        if not paths_canon_to_delete or not isinstance(paths_canon_to_delete, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        deleted_files_count = 0
        errors = []

        for path_canon in paths_canon_to_delete:
            # Safety check: do not allow this action on items already in trashcan.
            cursor.execute("SELECT 1 FROM images WHERE path_canon = ? AND is_trashed = 1", (path_canon,))
            if cursor.fetchone():
                errors.append({"path": path_canon, "error": "Cannot permanently delete an item that is in the trashcan."})
                continue

            full_path = os.path.normpath(os.path.join(output_dir, path_canon))
            
            try:
                # Delete main image file
                if os.path.isfile(full_path):
                    os.unlink(full_path)
                
                # Delete associated .txt and .json files
                base_path, _ = os.path.splitext(full_path)
                for meta_ext in ['.txt', '.json']:
                    meta_file = base_path + meta_ext
                    if os.path.exists(meta_file):
                        os.unlink(meta_file)
                
                # Delete the record from the database
                cursor.execute("DELETE FROM images WHERE path_canon = ?", (path_canon,))
                
                if cursor.rowcount > 0:
                    deleted_files_count += 1
                else:
                    errors.append({"path": path_canon, "error": "File deleted from disk, but no corresponding DB entry was found to remove."})

            except Exception as delete_exc:
                errors.append({"path": path_canon, "error": f"Failed to delete file or its metadata: {str(delete_exc)}"})
        
        conn.commit()
        status_message = f"Processed {len(paths_canon_to_delete)} items. Successfully permanently deleted {deleted_files_count} files."
        if errors:
            status_message += f" Encountered {len(errors)} errors."
            return web.json_response({"status": "partial_success", "message": status_message, "details": errors}, status=207)
        
        return web.json_response({"status": "ok", "message": status_message, "deleted_count": deleted_files_count})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error permanently deleting images: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


async def empty_trashcan_route(request: web.Request):
    conn = None
    current_exception = None
    
    try:
        output_dir = folder_paths.get_output_directory()
        trashcan_path = os.path.join(output_dir, TRASHCAN_DIR_NAME)

        deleted_count = 0
        errors = []

        if os.path.isdir(trashcan_path):
            for item_name in os.listdir(trashcan_path):
                item_path = os.path.join(trashcan_path, item_name)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                    deleted_count += 1
                except Exception as e:
                    errors.append(f"Could not delete {item_name}: {e}")
        
        # Now, clear the database
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM images WHERE is_trashed = 1")
        db_deleted_count = cursor.rowcount
        conn.commit()

        if errors:
            error_message = f"Completed with {len(errors)} errors. DB entries for trashed items removed. Errors: {'; '.join(errors)}"
            return web.json_response({"status": "partial_success", "message": error_message}, status=207)

        return web.json_response({
            "status": "ok",
            "message": f"Trashcan emptied. {deleted_count} filesystem items and {db_deleted_count} database records removed."
        })

    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error emptying trashcan: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


async def get_thumbnail_route(request: web.Request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "") # This subfolder can now include 'trashcan'
    force_regen_param = request.query.get("force_regen") == "true"

    conn_info_read = None
    original_rel_path = None
    error_message_for_client = "ERR: Thumbnail processing failed."
    current_exception = None

    try:
        if not filename:
            error_message_for_client = "ERR: Filename is required."
            return web.Response(status=400, text=error_message_for_client)

        output_dir = folder_paths.get_output_directory() # Base output
        safe_filename = holaf_utils.sanitize_filename(filename)
        
        # original_rel_path is the path_canon from the DB, which might be inside trashcan
        original_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
        # original_abs_path is its location on disk, relative to output_dir
        original_abs_path = os.path.normpath(os.path.join(output_dir, original_rel_path))


        if not original_abs_path.startswith(os.path.normpath(output_dir)):
            error_message_for_client = "ERR: Forbidden path for thumbnail."
            return web.Response(status=403, text=error_message_for_client)

        if not os.path.isfile(original_abs_path):
            error_message_for_client = "ERR: Original image not found for thumbnail."
            temp_conn_no_orig, no_orig_exception = None, None
            try:
                temp_conn_no_orig = holaf_database.get_db_connection()
                cursor_no_orig = temp_conn_no_orig.cursor()
                # Check if record exists using its current path_canon (which might be in trash)
                cursor_no_orig.execute("SELECT id FROM images WHERE path_canon = ?", (original_rel_path,))
                if cursor_no_orig.fetchone():
                    cursor_no_orig.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (original_rel_path,))
                    temp_conn_no_orig.commit()
            except Exception as e_db_no_orig: no_orig_exception = e_db_no_orig
            finally:
                if temp_conn_no_orig: holaf_database.close_db_connection(exception=no_orig_exception)
            return web.Response(status=404, text=error_message_for_client)

        # Hash is based on path_canon, so trashed images get different hashes if path_canon changes
        path_hash = hashlib.sha1(original_rel_path.encode('utf-8')).hexdigest()
        thumb_filename = f"{path_hash}.jpg"
        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

        conn_info_read = holaf_database.get_db_connection()
        cursor = conn_info_read.cursor()
        cursor.execute(
            "SELECT mtime, thumbnail_status, thumbnail_last_generated_at FROM images WHERE path_canon = ?",
            (original_rel_path,) # Use the current path_canon from DB
        )
        image_db_info = cursor.fetchone()
        conn_info_read.commit()

        needs_generation = force_regen_param
        if image_db_info:
            original_mtime_db = image_db_info['mtime']
            thumb_status_db = image_db_info['thumbnail_status']
            thumb_last_gen_db = image_db_info['thumbnail_last_generated_at']

            if thumb_status_db == 0: needs_generation = True
            elif thumb_status_db == 1: needs_generation = True
            elif thumb_status_db == 3: error_message_for_client = "ERR: Thumbnail previously failed (permanent)."
            elif thumb_last_gen_db is not None and original_mtime_db > thumb_last_gen_db: needs_generation = True
            if thumb_status_db == 2 and not os.path.exists(thumb_path_abs) and not needs_generation:
                needs_generation = True
        else: error_message_for_client = "ERR: Image record not found in DB."
        
        holaf_database.close_db_connection()
        conn_info_read = None

        if error_message_for_client in ("ERR: Thumbnail previously failed (permanent).", "ERR: Image record not found in DB."):
             return web.Response(status=404 if "not found" in error_message_for_client else 500, text=error_message_for_client)

        if needs_generation and os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception: pass # Ignore error if removal fails, generation will overwrite

        if not needs_generation and os.path.exists(thumb_path_abs):
            try:
                async with aiofiles.open(thumb_path_abs, 'rb') as f: content = await f.read()
                return web.Response(body=content, content_type='image/jpeg')
            except Exception as e: needs_generation = True; error_message_for_client = "ERR: Failed to read existing thumb."

        if needs_generation:
            loop = asyncio.get_event_loop()
            try:
                # Pass original_rel_path (which is current path_canon) for DB update key
                gen_success = await loop.run_in_executor(None, _create_thumbnail_blocking, original_abs_path, thumb_path_abs, original_rel_path)
                if not gen_success: error_message_for_client = "ERR: Thumbnail generation function failed."
            except Exception as e: current_exception = e; error_message_for_client = "ERR: Exception during thumbnail creation."
        
        if os.path.exists(thumb_path_abs):
            try:
                async with aiofiles.open(thumb_path_abs, 'rb') as f: content = await f.read()
                return web.Response(body=content, content_type='image/jpeg')
            except Exception as e: current_exception = e; error_message_for_client = "ERR: Failed to read generated thumb at final stage."
        
        print(f"🟡 [IV-Route] Final fallback for {original_rel_path}: Thumbnail not served. Reason: {error_message_for_client}")
        return web.Response(status=500, text=error_message_for_client)

    except Exception as e_outer:
        current_exception = e_outer
        # ... (rest of outer exception handling unchanged, but ensure DB updates use correct path_canon) ...
        final_error_text = error_message_for_client if error_message_for_client != "ERR: Thumbnail processing failed." else f"ERR: Server error processing thumbnail for {filename}."
        if original_rel_path: 
            error_conn_outer, db_outer_exception = None, None
            try:
                error_conn_outer = holaf_database.get_db_connection()
                cursor_outer = error_conn_outer.cursor()
                cursor_outer.execute("UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = CASE WHEN thumbnail_priority_score > 1000 THEN 1000 ELSE thumbnail_priority_score END WHERE path_canon = ?", (original_rel_path,))
                error_conn_outer.commit()
            except Exception as db_e: db_outer_exception = db_e
            finally:
                if error_conn_outer: holaf_database.close_db_connection(exception=db_outer_exception)
        return web.Response(status=500, text=final_error_text)
    finally:
        if conn_info_read: holaf_database.close_db_connection(exception=current_exception)


async def get_metadata_route(request: web.Request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "") # Can now include TRASHCAN_DIR_NAME
    if not filename: return web.json_response({"error": "Filename required"}, status=400)
    try:
        output_dir = folder_paths.get_output_directory()
        safe_filename = holaf_utils.sanitize_filename(filename)
        # Path is now constructed directly from subfolder and filename query params
        image_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
        image_abs_path = os.path.normpath(os.path.join(output_dir, image_rel_path))

        if not image_abs_path.startswith(os.path.normpath(output_dir)) or \
           not os.path.isfile(image_abs_path):
            return web.json_response({"error": "Image not found or path forbidden"}, status=404)

        loop = asyncio.get_event_loop()
        metadata = await loop.run_in_executor(None, _extract_image_metadata_blocking, image_abs_path)

        if "error" in metadata and metadata["error"]: return web.json_response(metadata, status=422)
        return web.json_response(metadata)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in metadata endpoint for {filename}: {e}"); traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)

# --- NEW: Metadata Management Logic ---
def _strip_png_metadata_and_get_mtime(image_abs_path):
    """
    Strips metadata from a PNG by re-saving its pixel data. This is a blocking function.
    """
    try:
        with Image.open(image_abs_path) as img:
            img.load()
        
        # Create a new image from the loaded pixel data to drop all metadata.
        new_img = Image.new(img.mode, img.size)
        new_img.putdata(list(img.getdata()))
        
        new_img.save(image_abs_path, "PNG")

        return os.path.getmtime(image_abs_path)
    except Exception as e:
        # Re-raise to be caught by the calling executor
        raise RuntimeError(f"Failed to strip metadata from PNG: {e}") from e


async def extract_metadata_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon", [])
        force_overwrite = data.get("force", False)

        if not paths_canon:
            return web.json_response({"error": "No image paths provided"}, status=400)
        
        successes, failures, conflicts = [], [], []
        db_updates = []
        
        output_dir = folder_paths.get_output_directory()
        loop = asyncio.get_event_loop()

        for path in paths_canon:
            image_abs_path = os.path.normpath(os.path.join(output_dir, path))
            base_path, _ = os.path.splitext(image_abs_path)

            try:
                # 1. Pre-flight checks (non-blocking)
                if not path.lower().endswith('.png'):
                    failures.append({"path": path, "error": "Not a PNG file."})
                    continue
                if not os.path.isfile(image_abs_path):
                    failures.append({"path": path, "error": "File not found on disk."})
                    continue
                
                # 2. Extract metadata (blocking, in executor)
                internal_meta = await loop.run_in_executor(None, _extract_image_metadata_blocking, image_abs_path)
                
                has_workflow = internal_meta.get("workflow") and internal_meta.get("workflow_source") == "internal_png"
                has_prompt = internal_meta.get("prompt") and internal_meta.get("prompt_source") == "internal_png"

                if not has_workflow and not has_prompt:
                    failures.append({"path": path, "error": "No internal metadata found to extract."})
                    continue

                # 3. Check for conflicts (non-blocking)
                json_path = base_path + ".json"
                txt_path = base_path + ".txt"
                if not force_overwrite:
                    conflict_details = []
                    if has_workflow and os.path.exists(json_path):
                        conflict_details.append(f"'{os.path.basename(json_path)}' already exists.")
                    if has_prompt and os.path.exists(txt_path):
                        conflict_details.append(f"'{os.path.basename(txt_path)}' already exists.")
                    if conflict_details:
                        conflicts.append({"path": path, "error": "Sidecar file(s) already exist.", "details": conflict_details})
                        continue
                
                # 4. Write sidecars (asynchronous)
                if has_workflow:
                    async with aiofiles.open(json_path, 'w', encoding='utf-8') as f:
                        await f.write(json.dumps(internal_meta["workflow"], indent=2))
                if has_prompt:
                    async with aiofiles.open(txt_path, 'w', encoding='utf-8') as f:
                        await f.write(internal_meta["prompt"])

                # 5. Strip metadata from PNG (blocking, in executor)
                new_mtime = await loop.run_in_executor(None, _strip_png_metadata_and_get_mtime, image_abs_path)
                
                successes.append(path)
                db_updates.append({"path": path, "mtime": new_mtime})

            except Exception as e:
                failures.append({"path": path, "error": f"Unexpected server error during processing: {e}"})

        # 6. Perform DB updates in batch
        if db_updates:
            conn, db_exception = None, None
            try:
                conn = holaf_database.get_db_connection()
                cursor, current_time = conn.cursor(), time.time()
                for update in db_updates:
                    cursor.execute("UPDATE images SET mtime = ?, last_synced_at = ? WHERE path_canon = ?", 
                                   (update["mtime"], current_time, update["path"]))
                conn.commit()
            except Exception as e:
                db_exception = e
                print(f"🔴 [Holaf-ImageViewer] DB update failed during metadata extraction: {e}")
                for update in db_updates:
                    failures.append({"path": update["path"], "error": "File processed but DB update failed."})
                successes = [s for s in successes if s not in [u["path"] for u in db_updates]]
            finally:
                if conn: holaf_database.close_db_connection(exception=db_exception)

        response_status = "processed"
        if conflicts: response_status = "processed_with_conflicts"
        if not successes and not conflicts and failures: response_status = "failed"
        
        return web.json_response({
            "status": response_status,
            "results": {"successes": successes, "failures": failures, "conflicts": conflicts}
        })

    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON in request"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in extract_metadata_route: {e}")
        traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)


def _inject_png_metadata_and_get_mtime(image_abs_path, prompt_text=None, workflow_data=None):
    """
    Injects metadata into a PNG by re-saving it with new info chunks. This is a blocking function.
    """
    try:
        with Image.open(image_abs_path) as img:
            img.load() # Ensure image data is loaded
        
        png_info = PngImagePlugin.PngInfo()
        if prompt_text:
            png_info.add_text("prompt", prompt_text)
        if workflow_data:
            png_info.add_text("workflow", json.dumps(workflow_data))

        # Re-save the image with the original pixel data but new metadata
        img.save(image_abs_path, "PNG", pnginfo=png_info)

        return os.path.getmtime(image_abs_path)
    except Exception as e:
        raise RuntimeError(f"Failed to inject metadata into PNG: {e}") from e


async def inject_metadata_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon", [])
        force_overwrite = data.get("force", False)

        if not paths_canon:
            return web.json_response({"error": "No image paths provided"}, status=400)
        
        successes, failures, conflicts = [], [], []
        db_updates = []
        
        output_dir = folder_paths.get_output_directory()
        loop = asyncio.get_event_loop()

        for path in paths_canon:
            image_abs_path = os.path.normpath(os.path.join(output_dir, path))
            base_path, _ = os.path.splitext(image_abs_path)

            try:
                # 1. Pre-flight checks
                if not path.lower().endswith('.png'):
                    failures.append({"path": path, "error": "Not a PNG file."})
                    continue
                if not os.path.isfile(image_abs_path):
                    failures.append({"path": path, "error": "File not found on disk."})
                    continue

                json_path = base_path + ".json"
                txt_path = base_path + ".txt"
                has_json = os.path.exists(json_path)
                has_txt = os.path.exists(txt_path)
                if not has_json and not has_txt:
                    failures.append({"path": path, "error": "No .txt or .json sidecar files found to inject."})
                    continue

                # 2. Check for conflicts (image already has internal metadata)
                if not force_overwrite:
                    internal_meta = await loop.run_in_executor(None, _extract_image_metadata_blocking, image_abs_path)
                    conflict_details = []
                    if internal_meta.get("workflow_source") == "internal_png":
                        conflict_details.append("Image already contains embedded workflow data.")
                    if internal_meta.get("prompt_source") == "internal_png":
                        conflict_details.append("Image already contains an embedded prompt.")
                    if conflict_details:
                        conflicts.append({"path": path, "error": "Internal metadata conflict.", "details": conflict_details})
                        continue

                # 3. Read sidecar data
                prompt_to_inject, workflow_to_inject = None, None
                if has_txt:
                    async with aiofiles.open(txt_path, 'r', encoding='utf-8') as f:
                        prompt_to_inject = await f.read()
                if has_json:
                    async with aiofiles.open(json_path, 'r', encoding='utf-8') as f:
                        workflow_to_inject = json.loads(await f.read())

                # 4. Inject metadata (blocking, in executor)
                new_mtime = await loop.run_in_executor(None, _inject_png_metadata_and_get_mtime, image_abs_path, prompt_to_inject, workflow_to_inject)
                
                # 5. Delete sidecar files upon successful injection
                if has_txt:
                    try:
                        os.remove(txt_path)
                    except OSError as e:
                        print(f"🟡 [Holaf-ImageViewer] Warning: Could not remove sidecar file {txt_path}: {e}")
                if has_json:
                    try:
                        os.remove(json_path)
                    except OSError as e:
                        print(f"🟡 [Holaf-ImageViewer] Warning: Could not remove sidecar file {json_path}: {e}")

                successes.append(path)
                db_updates.append({"path": path, "mtime": new_mtime})

            except Exception as e:
                failures.append({"path": path, "error": f"Unexpected server error during processing: {e}"})

        # 6. Perform DB updates in batch
        if db_updates:
            conn, db_exception = None, None
            try:
                conn = holaf_database.get_db_connection()
                cursor, current_time = conn.cursor(), time.time()
                for update in db_updates:
                    cursor.execute("UPDATE images SET mtime = ?, last_synced_at = ? WHERE path_canon = ?", 
                                   (update["mtime"], current_time, update["path"]))
                conn.commit()
            except Exception as e:
                db_exception = e
                print(f"🔴 [Holaf-ImageViewer] DB update failed during metadata injection: {e}")
                for update in db_updates:
                    failures.append({"path": update["path"], "error": "File processed but DB update failed."})
                successes = [s for s in successes if s not in [u["path"] for u in db_updates]]
            finally:
                if conn: holaf_database.close_db_connection(exception=db_exception)
        
        response_status = "processed"
        if conflicts: response_status = "processed_with_conflicts"
        if not successes and not conflicts and failures: response_status = "failed"
        
        return web.json_response({
            "status": response_status,
            "results": {"successes": successes, "failures": failures, "conflicts": conflicts}
        })

    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON in request"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in inject_metadata_route: {e}")
        traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)


async def prepare_export_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon", [])
        export_format = data.get("export_format", "png").lower()
        include_meta = data.get("include_meta", False)
        meta_method = data.get("meta_method", "embed")

        if not paths_canon:
            return web.json_response({"status": "error", "message": "No images selected for export."}, status=400)
        if export_format not in ['png', 'jpg', 'tiff']:
            return web.json_response({"status": "error", "message": f"Invalid export format: {export_format}"}, status=400)

        export_id = str(uuid.uuid4())
        export_dir = os.path.join(holaf_utils.TEMP_EXPORT_DIR, export_id)
        os.makedirs(export_dir, exist_ok=True)
        
        output_dir = folder_paths.get_output_directory()
        manifest = []
        errors = []
        
        loop = asyncio.get_event_loop()

        for path_canon in paths_canon:
            source_abs_path = os.path.normpath(os.path.join(output_dir, path_canon))
            if not os.path.isfile(source_abs_path):
                errors.append({"path": path_canon, "error": "File not found on disk."})
                continue
            
            subfolder, original_filename = os.path.split(path_canon)
            dest_subfolder_abs_path = os.path.join(export_dir, subfolder)
            os.makedirs(dest_subfolder_abs_path, exist_ok=True)
            
            base_name, original_ext = os.path.splitext(original_filename)
            dest_filename = f"{base_name}.{export_format}"
            dest_abs_path = os.path.join(dest_subfolder_abs_path, dest_filename)

            try:
                prompt_data, workflow_data = None, None
                if include_meta:
                    metadata = await loop.run_in_executor(None, _extract_image_metadata_blocking, source_abs_path)
                    if metadata and not metadata.get("error"):
                        prompt_data = metadata.get("prompt")
                        workflow_data = metadata.get("workflow")

                with Image.open(source_abs_path) as img:
                    img_to_save = img.copy() # CORRECTED: Ensure we work on a copy
                    save_params = {}

                    if export_format == 'png' and include_meta and meta_method == 'embed':
                        png_info = PngImagePlugin.PngInfo()
                        if prompt_data: png_info.add_text("prompt", prompt_data)
                        if workflow_data: png_info.add_text("workflow", json.dumps(workflow_data))
                        if png_info.chunks: save_params['pnginfo'] = png_info
                    
                    # Ensure conversion for formats that don't support alpha
                    if export_format == 'jpg':
                        if img_to_save.mode in ['RGBA', 'P', 'LA']: img_to_save = img_to_save.convert('RGB')
                        save_params['quality'] = 95
                    elif export_format == 'tiff':
                        save_params['compression'] = 'tiff_lzw'

                    img_to_save.save(dest_abs_path, format=export_format.upper(), **save_params)

                rel_path = os.path.join(subfolder, dest_filename).replace(os.sep, '/')
                manifest.append({'path': rel_path, 'size': os.path.getsize(dest_abs_path)})
                
                if include_meta and meta_method == 'sidecar':
                    if prompt_data:
                        txt_path = os.path.join(dest_subfolder_abs_path, f"{base_name}.txt")
                        async with aiofiles.open(txt_path, 'w', encoding='utf-8') as f: await f.write(prompt_data)
                        txt_rel_path = os.path.join(subfolder, f"{base_name}.txt").replace(os.sep, '/')
                        manifest.append({'path': txt_rel_path, 'size': os.path.getsize(txt_path)})
                    if workflow_data:
                        json_path = os.path.join(dest_subfolder_abs_path, f"{base_name}.json")
                        async with aiofiles.open(json_path, 'w', encoding='utf-8') as f: await f.write(json.dumps(workflow_data, indent=2))
                        json_rel_path = os.path.join(subfolder, f"{base_name}.json").replace(os.sep, '/')
                        manifest.append({'path': json_rel_path, 'size': os.path.getsize(json_path)})

            except Exception as e:
                errors.append({"path": path_canon, "error": f"Failed to process: {str(e)}"})
                traceback.print_exc()

        manifest_path = os.path.join(export_dir, 'manifest.json')
        with open(manifest_path, 'w', encoding='utf-8') as f: json.dump(manifest, f)
        
        return web.json_response({ "status": "ok", "export_id": export_id, "errors": errors })
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def download_export_chunk_route(request: web.Request):
    try:
        export_id = holaf_utils.sanitize_upload_id(request.query.get("export_id"))
        file_path_rel = request.query.get("file_path") # Not sanitized here, path is relative to export_id dir
        chunk_index = int(request.query.get("chunk_index"))
        chunk_size = int(request.query.get("chunk_size"))

        if not all([export_id, file_path_rel, chunk_index is not None, chunk_size]):
            return web.Response(status=400, text="Missing parameters.")

        base_export_dir = os.path.normpath(holaf_utils.TEMP_EXPORT_DIR)
        target_file_abs = os.path.normpath(os.path.join(base_export_dir, export_id, file_path_rel))

        if not target_file_abs.startswith(base_export_dir):
            return web.Response(status=403, text="Access forbidden.")
        if not os.path.isfile(target_file_abs):
            return web.Response(status=404, text="Export file not found.")

        offset = chunk_index * chunk_size
        chunk_data = await holaf_utils.read_file_chunk(target_file_abs, offset, chunk_size)
        if chunk_data is None: raise IOError("File could not be read.")
        return web.Response(body=chunk_data, content_type='application/octet-stream')

    except Exception as e:
        print(f"🔴 [IV-Export] Error downloading chunk: {e}"); traceback.print_exc()
        return web.Response(status=500, text=str(e))


# --- New Endpoints for Thumbnail Worker ---
async def set_viewer_activity_route(request: web.Request):
    global viewer_is_active
    try:
        data = await request.json()
        is_active = data.get("active", False)
        if not isinstance(is_active, bool):
            return web.json_response({"status": "error", "message": "'active' must be boolean"}, status=400)
        viewer_is_active = is_active
        return web.json_response({"status": "ok", "viewer_active": viewer_is_active})
    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in set_viewer_activity_route: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def prioritize_thumbnails_route(request: web.Request):
    conn = None
    current_exception = None
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon")

        if not paths_canon or not isinstance(paths_canon, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        updated_count = 0
        priority_score_for_visible = 10

        for path_canon_str in paths_canon:
            res = cursor.execute("""
                UPDATE images
                SET thumbnail_status = CASE thumbnail_status WHEN 0 THEN 1 ELSE thumbnail_status END,
                    thumbnail_priority_score = MIN(thumbnail_priority_score, ?)
                WHERE path_canon = ? AND thumbnail_status IN (0, 1)
            """, (priority_score_for_visible, path_canon_str))
            if res.rowcount > 0:
                updated_count += 1
        conn.commit()
        return web.json_response({"status": "ok", "message": f"{updated_count} thumbnails prioritized."})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error in prioritize_thumbnails_route: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def iv_get_thumbnail_stats_route(request: web.Request):
    conn = None
    current_exception = None
    default_response = {"total_db_count": 0, "generated_thumbnails_count": 0}
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM images WHERE is_trashed = 0") # Only non-trashed
        total_db_count = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM images WHERE thumbnail_status = 2 AND is_trashed = 0") # Only non-trashed
        generated_thumbnails_count = cursor.fetchone()[0]
        conn.commit() 

        return web.json_response({
            "total_db_count": total_db_count,
            "generated_thumbnails_count": generated_thumbnails_count,
        })
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error getting thumbnail stats: {e}"); traceback.print_exc()
        return web.json_response({"error": str(e), **default_response}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

# --- Thumbnail Generation Worker ---
def run_thumbnail_generation_worker(stop_event):
    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker started.")
    output_dir = folder_paths.get_output_directory()
    batch_size_for_query = 1

    while not stop_event.is_set():
        conn_worker_db = None
        image_to_process_path_canon = None # This is the key for DB updates, should be current path_canon
        worker_exception = None
        try:
            conn_worker_db = holaf_database.get_db_connection()
            cursor = conn_worker_db.cursor()
            image_row_to_process = None

            # Worker should only process non-trashed images
            priority_query = """
                SELECT path_canon FROM images
                WHERE thumbnail_status = 1 AND is_trashed = 0
                ORDER BY thumbnail_priority_score ASC, mtime DESC
                LIMIT ?
            """
            cursor.execute(priority_query, (batch_size_for_query,))
            image_row_to_process = cursor.fetchone()

            if not image_row_to_process:
                normal_query = """
                    SELECT path_canon FROM images
                    WHERE thumbnail_status = 0 AND is_trashed = 0
                    ORDER BY mtime DESC
                    LIMIT ?
                """
                cursor.execute(normal_query, (batch_size_for_query,))
                image_row_to_process = cursor.fetchone()
            
            conn_worker_db.commit() 

            if not image_row_to_process:
                holaf_database.close_db_connection()
                conn_worker_db = None
                stop_event.wait(WORKER_IDLE_SLEEP_SECONDS)
                continue
            
            holaf_database.close_db_connection()
            conn_worker_db = None

            image_to_process_path_canon = image_row_to_process['path_canon']
            # The actual file on disk is at output_dir + path_canon (which is not in trash for worker)
            original_abs_path = os.path.normpath(os.path.join(output_dir, image_to_process_path_canon))

            if not os.path.isfile(original_abs_path):
                temp_conn_err, no_file_exception = None, None
                try:
                    temp_conn_err = holaf_database.get_db_connection()
                    temp_cursor_err = temp_conn_err.cursor()
                    # Mark using its current path_canon
                    temp_cursor_err.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (image_to_process_path_canon,))
                    temp_conn_err.commit()
                except Exception as e_db_no_file: no_file_exception = e_db_worker_no_file
                finally:
                    if temp_conn_err: holaf_database.close_db_connection(exception=no_file_exception)
                stop_event.wait(WORKER_POST_JOB_SLEEP_SECONDS)
                continue

            path_hash = hashlib.sha1(image_to_process_path_canon.encode('utf-8')).hexdigest()
            thumb_filename = f"{path_hash}.jpg"
            thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

            _create_thumbnail_blocking(original_abs_path, thumb_path_abs, image_path_canon_for_db_update=image_to_process_path_canon)
            stop_event.wait(WORKER_POST_JOB_SLEEP_SECONDS)

        except sqlite3.Error as e_sql:
            worker_exception = e_sql
            print(f"🔴 [Holaf-ImageViewer-Worker] SQLite error (processing '{image_to_process_path_canon}'): {e_sql}")
            stop_event.wait(30.0)
        except Exception as e_main:
            worker_exception = e_main
            print(f"🔴 [Holaf-ImageViewer-Worker] General error (processing '{image_to_process_path_canon}'): {e_main}")
            stop_event.wait(30.0)
        finally:
            if conn_worker_db:
                holaf_database.close_db_connection(exception=worker_exception)
            image_to_process_path_canon = None

    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker stopped.")