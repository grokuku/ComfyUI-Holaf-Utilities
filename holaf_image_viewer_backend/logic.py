# === Holaf Utilities - Image Viewer Core Logic ===
import os
import hashlib
import json
import math
import time
import datetime
import traceback
import uuid
import shutil
from PIL import PngImagePlugin

from PIL import Image, ImageOps, UnidentifiedImageError, ImageEnhance
import folder_paths

# Relative imports to sibling modules in the main package
from .. import holaf_database
from .. import holaf_utils

# --- Constants ---
SUPPORTED_IMAGE_FORMATS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
TRASHCAN_DIR_NAME = "trashcan"
STANDARD_RATIOS = [
    {"name": "1:1", "value": 1.0}, {"name": "4:3", "value": 4/3}, {"name": "3:4", "value": 3/4},
    {"name": "3:2", "value": 3/2}, {"name": "2:3", "value": 2/3}, {"name": "16:9", "value": 16/9},
    {"name": "9:16", "value": 9/16}, {"name": "16:10", "value": 16/10}, {"name": "10:16", "value": 10/16},
    {"name": "5:4", "value": 5/4}, {"name": "4:5", "value": 4/5}, {"name": "21:9", "value": 21/9},
    {"name": "9:21", "value": 9/21},
]
RATIO_THRESHOLD = 0.02

# --- MODIFICATION START: Live Update Tracking ---
LAST_DB_UPDATE_TIME = time.time()

def update_last_db_update_time():
    """Updates the global timestamp to signal a database change."""
    global LAST_DB_UPDATE_TIME
    LAST_DB_UPDATE_TIME = time.time()
# --- MODIFICATION END ---


# --- Filesystem Helpers ---
def ensure_trashcan_exists():
    """Ensures the trashcan directory exists within the main output directory."""
    output_dir = folder_paths.get_output_directory()
    trashcan_path = os.path.join(output_dir, TRASHCAN_DIR_NAME)
    if not os.path.exists(trashcan_path):
        try:
            os.makedirs(trashcan_path, exist_ok=True)
        except OSError as e:
            print(f"🔴 [Holaf-ImageViewer] Failed to create trashcan directory {trashcan_path}: {e}")
            return None
    return trashcan_path

# Call it once at module load to be sure
ensure_trashcan_exists()

def _update_folder_metadata_cache_blocking(cursor):
    """
    Clears and completely rebuilds the folder_metadata table.
    This should be called within an existing DB transaction.
    """
    try:
        current_time = time.time()
        
        cursor.execute("DELETE FROM folder_metadata")
        
        cursor.execute("""
            INSERT INTO folder_metadata (path_canon, image_count, last_calculated_at)
            SELECT 
                CASE 
                    WHEN subfolder = '' THEN 'root' 
                    ELSE subfolder 
                END as folder_path,
                COUNT(*) as count,
                ?
            FROM images
            WHERE is_trashed = 0
            GROUP BY folder_path
        """, (current_time,))
        
    except Exception as e:
        print(f"🔴 [Holaf-Logic] CRITICAL: Failed to rebuild folder metadata cache: {e}")
        raise

# --- Database Synchronization ---

def add_or_update_single_image(image_abs_path):
    """
    Efficiently adds or updates a single image in the database.
    This should be called by any process that saves a new image.
    """
    output_dir = folder_paths.get_output_directory()
    if not os.path.normpath(image_abs_path).startswith(os.path.normpath(output_dir)):
        return

    conn = None
    update_exception = None
    try:
        try:
            file_stat = os.stat(image_abs_path)
        except FileNotFoundError:
            return

        directory, filename = os.path.split(image_abs_path)
        base_filename, file_ext = os.path.splitext(filename)

        if file_ext.lower() not in SUPPORTED_IMAGE_FORMATS:
            return

        subfolder_str = os.path.relpath(directory, output_dir).replace(os.sep, '/')
        if subfolder_str == '.': subfolder_str = ''
        path_canon = os.path.join(subfolder_str, filename).replace('\\', '/')
        
        # --- FIX: Calculate thumb_hash ---
        thumb_hash = hashlib.sha1(path_canon.encode('utf-8')).hexdigest()

        if subfolder_str.startswith(TRASHCAN_DIR_NAME + '/') or subfolder_str == TRASHCAN_DIR_NAME:
            return

        top_level_subfolder = 'root'
        if subfolder_str:
            top_level_subfolder = subfolder_str.split('/')[0]

        edit_file_path = os.path.join(directory, f"{base_filename}.edt")
        has_edit_file = os.path.isfile(edit_file_path)

        meta = _extract_image_metadata_blocking(image_abs_path)

        # --- ARCHITECTURAL FIX ---
        # We now validate the metadata. If we couldn't even read the basic
        # width and height, we consider the image corrupt or unreadable.
        # We log a critical error and ABORT the insertion to prevent creating a "ghost" record.
        if not meta.get('width') or not meta.get('height'):
            print(f"🔴 [Holaf-Logic] CRITICAL: Failed to extract valid metadata (width/height) for {path_canon}. The file might be corrupt. Aborting DB insertion.")
            return

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        
        # --- FIX: Insert thumb_hash ---
        cursor.execute("""
            INSERT OR REPLACE INTO images 
                (filename, subfolder, top_level_subfolder, path_canon, format, mtime, size_bytes, last_synced_at, 
                    is_trashed, original_path_canon,
                    prompt_text, workflow_json, prompt_source, workflow_source,
                    width, height, aspect_ratio_str, has_edit_file,
                    thumbnail_status, thumbnail_priority_score, thumbnail_last_generated_at, thumb_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1000, NULL, ?)
        """, (filename, subfolder_str, top_level_subfolder, path_canon, file_ext[1:].upper(),
                file_stat.st_mtime, file_stat.st_size, time.time(),
                meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
                meta.get('prompt_source'), meta.get('workflow_source'),
                meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file, thumb_hash))
        
        _update_folder_metadata_cache_blocking(cursor)

        conn.commit()
        print(f"✅ [Holaf-Logic-DB] Successfully added/updated in DB: {path_canon}")
        update_last_db_update_time() 

    except Exception as e:
        update_exception = e
        print(f"🔴 [Holaf-Logic] Error in add_or_update_single_image for {image_abs_path}: {e}")
        traceback.print_exc()
    finally:
        if conn:
            holaf_database.close_db_connection(exception=update_exception)

def delete_single_image_by_path(image_abs_path):
    """
    Efficiently deletes a single image's record from the database.
    """
    output_dir = folder_paths.get_output_directory()
    if not os.path.normpath(image_abs_path).startswith(os.path.normpath(output_dir)):
        return

    conn = None
    delete_exception = None
    try:
        directory, filename = os.path.split(image_abs_path)
        subfolder_str = os.path.relpath(directory, output_dir).replace(os.sep, '/')
        if subfolder_str == '.': subfolder_str = ''
        
        path_canon = os.path.join(subfolder_str, filename).replace('\\', '/')

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM images WHERE path_canon = ?", (path_canon,))
        image_exists = cursor.fetchone()

        if image_exists:
            cursor.execute("DELETE FROM images WHERE path_canon = ?", (path_canon,))
            _update_folder_metadata_cache_blocking(cursor)
            conn.commit()
            print(f"✅ [Holaf-Logic-DB] Successfully deleted from DB: {path_canon}")
            update_last_db_update_time()

    except Exception as e:
        delete_exception = e
        print(f"🔴 [Holaf-Logic] Error in delete_single_image_by_path for {image_abs_path}: {e}")
        traceback.print_exc()
    finally:
        if conn:
            holaf_database.close_db_connection(exception=delete_exception)


def sync_image_database_blocking():
    # ... (function is correct, no changes needed here)
    print("🔵 [Holaf-ImageViewer] Starting periodic image database synchronization...")
    output_dir = folder_paths.get_output_directory()
    trashcan_full_path = os.path.join(output_dir, TRASHCAN_DIR_NAME)
    current_time = time.time()
    conn = None
    sync_exception = None

    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # --- FIX: Fetch thumb_hash as well for checking ---
        cursor.execute("SELECT id, path_canon, mtime, size_bytes, thumbnail_last_generated_at, thumb_hash FROM images WHERE is_trashed = 0")
        db_images = {row['path_canon']: dict(row) for row in cursor.fetchall()}

        disk_images_canons = set()
        if not os.path.isdir(output_dir):
            print(f"🟡 [Holaf-ImageViewer] Output directory not found: {output_dir}")
        else:
            for root, dirs, files in os.walk(output_dir):
                if os.path.normpath(root) == os.path.normpath(trashcan_full_path):
                    dirs[:] = [] 
                    continue

                if os.path.normpath(root).startswith(os.path.normpath(trashcan_full_path) + os.sep):
                    continue

                for filename in files:
                    file_ext = os.path.splitext(filename)[1].lower()
                    if file_ext not in SUPPORTED_IMAGE_FORMATS:
                        continue
                    try:
                        full_path = os.path.join(root, filename)
                        file_stat = os.stat(full_path)
                        base_name, _ = os.path.splitext(filename)
                        edit_file_path = os.path.join(root, f"{base_name}.edt")
                        has_edit_file = os.path.isfile(edit_file_path)
                        subfolder_str = os.path.relpath(root, output_dir).replace(os.sep, '/')
                        if subfolder_str == '.': subfolder_str = ''
                        if subfolder_str.startswith(TRASHCAN_DIR_NAME + '/') or subfolder_str == TRASHCAN_DIR_NAME:
                            continue
                        path_canon = os.path.join(subfolder_str, filename).replace('\\', '/')
                        
                        # --- FIX: Calculate thumb_hash ---
                        thumb_hash = hashlib.sha1(path_canon.encode('utf-8')).hexdigest()
                        
                        disk_images_canons.add(path_canon)
                        top_level_subfolder = 'root'
                        if subfolder_str:
                            top_level_subfolder = subfolder_str.split('/')[0]
                        meta = _extract_image_metadata_blocking(full_path)
                        existing_record = db_images.get(path_canon)
                        
                        if existing_record: 
                            # Check if properties changed OR if thumb_hash is missing in DB (for migration safety)
                            if (existing_record['mtime'] != file_stat.st_mtime or 
                                existing_record['size_bytes'] != file_stat.st_size or
                                existing_record.get('thumb_hash') != thumb_hash):
                                
                                cursor.execute("""
                                    UPDATE images SET mtime = ?, size_bytes = ?, last_synced_at = ?, subfolder = ?, 
                                    top_level_subfolder = ?, prompt_text = ?, workflow_json = ?, prompt_source = ?, 
                                    workflow_source = ?, width = ?, height = ?, aspect_ratio_str = ?, has_edit_file = ?,
                                    thumbnail_status = 0, thumbnail_priority_score = 1000, thumbnail_last_generated_at = NULL,
                                    thumb_hash = ?
                                    WHERE id = ? AND is_trashed = 0
                                """, (file_stat.st_mtime, file_stat.st_size, current_time, subfolder_str, top_level_subfolder,
                                        meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
                                        meta.get('prompt_source'), meta.get('workflow_source'), meta.get('width'), meta.get('height'),
                                        meta.get('ratio'), has_edit_file, thumb_hash, existing_record['id']))
                        else: 
                            cursor.execute("""
                                INSERT OR REPLACE INTO images (filename, subfolder, top_level_subfolder, path_canon, format, mtime, 
                                size_bytes, last_synced_at, is_trashed, original_path_canon, prompt_text, workflow_json, 
                                prompt_source, workflow_source, width, height, aspect_ratio_str, has_edit_file, thumb_hash)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (filename, subfolder_str, top_level_subfolder, path_canon, file_ext[1:].upper(),
                                    file_stat.st_mtime, file_stat.st_size, current_time,
                                    meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
                                    meta.get('prompt_source'), meta.get('workflow_source'),
                                    meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file, thumb_hash))
                    except Exception as e:
                        print(f"🔴 [Holaf-ImageViewer] Error processing file {filename} during sync: {e}")

        conn.commit()

        stale_canons = set(db_images.keys()) - disk_images_canons
        if stale_canons:
            print(f"🔵 [Holaf-ImageViewer] Found {len(stale_canons)} stale non-trashed image entries to remove from DB.")
            for path_canon_to_delete in stale_canons:
                cursor.execute("DELETE FROM images WHERE path_canon = ? AND is_trashed = 0", (path_canon_to_delete,))
            conn.commit()
        
        _update_folder_metadata_cache_blocking(cursor)
        conn.commit()

        print("✅ [Holaf-ImageViewer] Periodic image database synchronization complete.")
        update_last_db_update_time()

    except Exception as e:
        sync_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error during sync: {e}")
        traceback.print_exc()
    finally:
        if conn:
            holaf_database.close_db_connection(exception=sync_exception)


def clean_thumbnails_blocking():
    """
    Scans the thumbnail directory and the database to clean up and regenerate thumbnails.
    - Deletes orphan thumbnails (where the original image no longer exists).
    - Resets the status for images that are missing a thumbnail file.
    - Resets the status for thumbnails that are unreadable/corrupt.
    """
    print("🔵 [Holaf-ImageViewer] Starting thumbnail cleaning process...")
    thumb_dir = holaf_utils.get_thumbnail_dir()
    output_dir = folder_paths.get_output_directory()
    
    deleted_orphans_count = 0
    regenerated_missing_count = 0
    regenerated_corrupt_count = 0
    
    conn = None
    clean_exception = None

    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # 1. Delete orphan thumbnails
        if os.path.isdir(thumb_dir):
            all_thumb_files = os.listdir(thumb_dir)
            
            # --- OPTIMIZATION: Now we can check the hash directly from the DB ---
            # Fetch all valid thumb_hashes
            cursor.execute("SELECT thumb_hash FROM images WHERE thumb_hash IS NOT NULL")
            valid_hashes = {row['thumb_hash'] for row in cursor.fetchall()}
            
            for thumb_filename in all_thumb_files:
                thumb_hash = os.path.splitext(thumb_filename)[0]
                
                if thumb_hash not in valid_hashes:
                    try:
                        os.remove(os.path.join(thumb_dir, thumb_filename))
                        deleted_orphans_count += 1
                    except OSError as e:
                        print(f"🟡 [Holaf-ImageViewer] Could not delete orphan thumbnail {thumb_filename}: {e}")

        # 2. Check all non-corrupt images in DB for thumbnail validity
        cursor.execute("SELECT id, path_canon, thumb_hash FROM images WHERE thumbnail_status != 3")
        images_to_check = cursor.fetchall()
        
        ids_to_reset_missing = []
        ids_to_reset_corrupt = []

        for image in images_to_check:
            if not image['thumb_hash']: continue # Skip if hash is missing (should be fixed by sync)

            thumb_filename = f"{image['thumb_hash']}.jpg"
            thumb_path = os.path.join(thumb_dir, thumb_filename)
            
            if not os.path.exists(thumb_path):
                ids_to_reset_missing.append(image['id'])
            else:
                # 3. Verify if thumbnail is a valid, readable image
                try:
                    with Image.open(thumb_path) as img:
                        img.verify() # Fast check for basic integrity
                except Exception:
                    # If any error occurs, it's likely corrupt
                    ids_to_reset_corrupt.append(image['id'])

        if ids_to_reset_missing:
            regenerated_missing_count = len(ids_to_reset_missing)
            cursor.execute(f"UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = 1500 WHERE id IN ({','.join(['?']*len(ids_to_reset_missing))})", ids_to_reset_missing)
            print(f"🔵 [Holaf-ImageViewer] Marked {regenerated_missing_count} images for thumbnail regeneration (missing).")

        if ids_to_reset_corrupt:
            regenerated_corrupt_count = len(ids_to_reset_corrupt)
            cursor.execute(f"UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = 1500 WHERE id IN ({','.join(['?']*len(ids_to_reset_corrupt))})", ids_to_reset_corrupt)
            print(f"🔵 [Holaf-ImageViewer] Marked {regenerated_corrupt_count} images for thumbnail regeneration (corrupt).")

        conn.commit()

        print(f"✅ [Holaf-ImageViewer] Thumbnail cleaning complete. "
                f"Deleted: {deleted_orphans_count}, "
                f"Queued for regen (missing): {regenerated_missing_count}, "
                f"Queued for regen (corrupt): {regenerated_corrupt_count}.")
        
        return {
            "deleted_orphans": deleted_orphans_count,
            "regenerated_missing": regenerated_missing_count,
            "regenerated_corrupt": regenerated_corrupt_count
        }

    except Exception as e:
        clean_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error during thumbnail cleaning: {e}")
        traceback.print_exc()
        return {"error": str(e)}
    finally:
        if conn:
            holaf_database.close_db_connection(exception=clean_exception)


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
            if result["width"] and result["height"]:
                result["ratio"] = _get_best_ratio_string(result["width"], result["height"])
            if hasattr(img, 'info') and isinstance(img.info, dict):
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
        result["error"] = "Image file not found for internal metadata read."
        print(f"🟡 [Holaf-Logic] Could not find image to read metadata: {filename}")
    except UnidentifiedImageError:
        result["error"] = "Unidentified image error."
        print(f"🟡 [Holaf-Logic] Could not read image data for {filename}. Reason: UnidentifiedImageError (corrupt or unsupported format for metadata).")
    except Exception as e:
        # --- TYPO FIX ---
        # The 'NameError' came from a simple typo in an error message.
        # This is fixed, but more importantly, the calling function now validates the result.
        result["error"] = str(e)
        print(f"🟡 [Holaf-Logic] An unexpected error occurred reading metadata for {filename}. Reason: {e}")

    return result

# --- MODIFICATION START: Ajout de la fonction centralisée ---
def apply_edits_to_image(image, edit_data):
    """
    Applies non-destructive edits from a dictionary to a Pillow Image object.
    
    Args:
        image (PIL.Image.Image): The source image.
        edit_data (dict): A dictionary containing edit parameters.
                            e.g., {'brightness': 1.2, 'contrast': 1.1, 'saturation': 1.5}

    Returns:
        PIL.Image.Image: The modified image.
    """
    if not isinstance(edit_data, dict):
        return image

    # Phase 1: Basic adjustments
    if 'brightness' in edit_data:
        enhancer = ImageEnhance.Brightness(image)
        image = enhancer.enhance(float(edit_data['brightness']))
    
    if 'contrast' in edit_data:
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(float(edit_data['contrast']))
        
    if 'saturation' in edit_data:
        # Note: Pillow calls this "Color"
        enhancer = ImageEnhance.Color(image)
        image = enhancer.enhance(float(edit_data['saturation']))
        
    # Placeholder for future edits like crop, etc.
    
    return image
# --- MODIFICATION END ---


# --- Thumbnail Generation ---
# <-- MODIFICATION START: Modification de la fonction de création de miniature -->
def _create_thumbnail_blocking(original_path_abs, thumb_path_abs, image_path_canon_for_db_update=None, edit_data=None):
    """ 
    Returns True on success, False on failure. Handles its own DB updates and error logging.
    Can now apply edits before thumbnailing if edit_data is provided.
    """
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

            # Apply edits if they are provided, before resizing
            if edit_data:
                img_copy = apply_edits_to_image(img_copy, edit_data)

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
                # --- FIX: Prevent infinite loops. Mark as Failed (Status 3) and set Lowest Priority (9999) ---
                cursor.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (image_path_canon_for_db_update,))
                conn_update_db.commit()
        if os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception as e_clean: print(f"🔴 [Holaf-ImageViewer] Could not clean up failed thumbnail {thumb_path_abs}: {e_clean}")
        return False
    finally:
        if conn_update_db:
            holaf_database.close_db_connection(exception=update_exception)
# <-- MODIFICATION END -->


# --- Metadata Management Logic ---
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