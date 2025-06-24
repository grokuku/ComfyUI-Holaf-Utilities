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

from aiohttp import web
from PIL import Image, ImageOps
import folder_paths # ComfyUI global

from . import holaf_database 
from . import holaf_utils # For sanitize_filename, THUMBNAIL_CACHE_DIR, THUMBNAIL_SIZE

# --- Constants ---
SUPPORTED_IMAGE_FORMATS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
STANDARD_RATIOS = [
    {"name": "1:1", "value": 1.0}, {"name": "4:3", "value": 4/3}, {"name": "3:4", "value": 3/4},
    {"name": "3:2", "value": 3/2}, {"name": "2:3", "value": 2/3}, {"name": "16:9", "value": 16/9}, 
    {"name": "9:16", "value": 9/16}, {"name": "16:10", "value": 16/10}, {"name": "10:16", "value": 10/16},
    {"name": "5:4", "value": 5/4}, {"name": "4:5", "value": 4/5}, {"name": "21:9", "value": 21/9}, 
    {"name": "9:21", "value": 9/21},
]
RATIO_THRESHOLD = 0.02 # 2% tolerance for matching standard ratios

# --- Database Synchronization ---
def sync_image_database_blocking():
    print("🔵 [Holaf-ImageViewer] Starting image database synchronization...")
    output_dir = folder_paths.get_output_directory()
    current_time = time.time()
    conn = None

    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id, path_canon, mtime, size_bytes FROM images")
        db_images = {row['path_canon']: dict(row) for row in cursor.fetchall()}
        
        disk_images_canons = set()
        if not os.path.isdir(output_dir):
            print(f"🟡 [Holaf-ImageViewer] Output directory not found: {output_dir}")
        else:
            for root, _, files in os.walk(output_dir):
                for filename in files:
                    file_ext = os.path.splitext(filename)[1].lower()
                    if file_ext not in SUPPORTED_IMAGE_FORMATS:
                        continue

                    try:
                        full_path = os.path.join(root, filename)
                        file_stat = os.stat(full_path)
                        
                        subfolder = os.path.relpath(root, output_dir)
                        if subfolder == '.': subfolder = ''
                        
                        path_canon = os.path.join(subfolder, filename).replace(os.sep, '/')
                        disk_images_canons.add(path_canon)

                        existing_record = db_images.get(path_canon)

                        if existing_record:
                            if existing_record['mtime'] != file_stat.st_mtime or \
                               existing_record['size_bytes'] != file_stat.st_size:
                                cursor.execute("""
                                    UPDATE images SET mtime = ?, size_bytes = ?, last_synced_at = ?
                                    WHERE id = ?
                                """, (file_stat.st_mtime, file_stat.st_size, current_time, existing_record['id']))
                        else:
                            cursor.execute("""
                                INSERT INTO images (filename, subfolder, path_canon, format, mtime, size_bytes, last_synced_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            """, (filename, subfolder.replace(os.sep, '/'), path_canon, file_ext[1:].upper(), 
                                  file_stat.st_mtime, file_stat.st_size, current_time))
                    except Exception as e:
                        print(f"🔴 [Holaf-ImageViewer] Error processing file {filename}: {e}")
        
        conn.commit()

        stale_canons = set(db_images.keys()) - disk_images_canons
        if stale_canons:
            print(f"🔵 [Holaf-ImageViewer] Found {len(stale_canons)} stale image entries to remove.")
            for path_canon in stale_canons:
                cursor.execute("DELETE FROM images WHERE path_canon = ?", (path_canon,))
                try:
                    path_hash = hashlib.sha1(path_canon.encode('utf-8')).hexdigest()
                    thumb_filename = f"{path_hash}.jpg"
                    thumb_path = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)
                    if os.path.exists(thumb_path):
                        os.remove(thumb_path)
                except Exception as e_thumb:
                    print(f"🔴 [Holaf-ImageViewer] Error removing thumbnail for {path_canon}: {e_thumb}")
            conn.commit()
        print("✅ [Holaf-ImageViewer] Image database synchronization complete.")
    
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error during sync: {e}")
        if conn: conn.rollback()
        traceback.print_exc()
    finally:
        if conn: conn.close()

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
    print(f"🔵 [Holaf-ImageViewer-Debug] Starting metadata extraction for: {image_path_abs}")
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
                if result["workflow_source"] == "none" and 'workflow' in img.info:
                    try:
                        loaded_json = json.loads(img.info['workflow'])
                        result["workflow"] = _sanitize_json_nan(loaded_json)
                        result["workflow_source"] = "internal_png"
                    except Exception:
                        result["workflow"] = {"error": "Malformed workflow in PNG"}; result["workflow_source"] = "error"
    except FileNotFoundError:
        return {"error": "Image file not found for internal metadata read."}
    except Exception as e:
        print(f"  [Debug] 🟡 Note: Could not read image data for {filename}. Reason: {e}")
            
    print(f"✅ [Holaf-ImageViewer-Debug] Finished metadata extraction for: {filename}")
    return result

# --- Thumbnail Generation ---
def _create_thumbnail_blocking(original_path_abs, thumb_path_abs):
    try:
        with Image.open(original_path_abs) as img:
            img = ImageOps.fit(img, holaf_utils.THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            img.convert("RGB").save(thumb_path_abs, "JPEG", quality=85, optimize=True)
        print(f"🔵 [Holaf-ImageViewer] Created thumbnail: {os.path.basename(thumb_path_abs)}")
    except Exception as e:
        if os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception as e_clean: print(f"🔴 [Holaf-ImageViewer] Could not clean up failed thumbnail {thumb_path_abs}: {e_clean}")
        raise e 

# --- API Route Handlers ---
async def get_filter_options_route(request: web.Request):
    conn = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT subfolder FROM images WHERE subfolder != ''")
        subfolders = sorted([row['subfolder'] for row in cursor.fetchall()])
        cursor.execute("SELECT DISTINCT format FROM images")
        formats = sorted([row['format'] for row in cursor.fetchall()])
        cursor.execute("SELECT 1 FROM images WHERE subfolder = '' LIMIT 1")
        has_root_images = cursor.fetchone() is not None
        return web.json_response({"subfolders": subfolders, "formats": formats, "has_root": has_root_images})
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Failed to get filter options from DB: {e}")
        return web.json_response({"subfolders": [], "formats": [], "has_root": False}, status=500)
    finally:
        if conn: conn.close()

async def list_images_route(request: web.Request):
    conn = None
    try:
        filters = await request.json()
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        
        query = "SELECT filename, subfolder, format, mtime, size_bytes FROM images"
        where_clauses, params = [], []
        
        folder_filters = filters.get('folder_filters', [])
        if folder_filters:
            conditions = []
            for folder in folder_filters:
                if folder == 'root': conditions.append("subfolder = ?"); params.append('')
                else: conditions.append("(subfolder = ? OR subfolder LIKE ?)"); params.extend([folder, f"{folder}/%"])
            if conditions: where_clauses.append(f"({ ' OR '.join(conditions) })")

        format_filters = filters.get('format_filters', [])
        if format_filters:
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

        if where_clauses: query += " WHERE " + " AND ".join(where_clauses)
            
        count_query = query.replace("filename, subfolder, format, mtime, size_bytes", "COUNT(*)")
        cursor.execute(count_query, params)
        filtered_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM images"); total_db_count = cursor.fetchone()[0]
        query += " ORDER BY mtime DESC"
        
        cursor.execute(query, params)
        images = [dict(row) for row in cursor.fetchall()]
        return web.json_response({"images": images, "filtered_count": filtered_count, "total_db_count": total_db_count})
    except json.JSONDecodeError: return web.json_response({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error listing filtered images: {e}"); traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        if conn: conn.close()

async def get_thumbnail_route(request: web.Request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")
    force_regen = request.query.get("force_regen") == "true"
    if not filename: return web.Response(status=400, text="Filename is required")

    try:
        output_dir = folder_paths.get_output_directory()
        safe_filename = holaf_utils.sanitize_filename(filename)
        safe_subfolder_parts = [holaf_utils.sanitize_directory_component(p) for p in subfolder.split('/') if p]
        
        original_rel_path = os.path.join(*safe_subfolder_parts, safe_filename)
        original_abs_path = os.path.normpath(os.path.join(output_dir, original_rel_path))

        if not original_abs_path.startswith(os.path.normpath(output_dir)):
            return web.Response(status=403, text="Forbidden path")
        if not os.path.isfile(original_abs_path):
            return web.Response(status=404, text="Original image not found")

        path_hash = hashlib.sha1(original_rel_path.encode('utf-8')).hexdigest()
        thumb_filename = f"{path_hash}.jpg"
        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

        if force_regen and os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception as e: print(f"🔴 Error removing thumb for regen {thumb_path_abs}: {e}")
        
        if os.path.exists(thumb_path_abs): return web.FileResponse(thumb_path_abs)
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _create_thumbnail_blocking, original_abs_path, thumb_path_abs)
        return web.FileResponse(thumb_path_abs)
    except Exception as e:
        err_msg = f"Thumbnail creation/serving failed: {str(e)}"
        print(f"🔴 [Holaf-ImageViewer] {err_msg} for {filename} in {subfolder}")
        traceback.print_exc()
        return web.Response(status=500, text=err_msg)

async def get_metadata_route(request: web.Request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")
    if not filename: return web.json_response({"error": "Filename required"}, status=400)

    try:
        output_dir = folder_paths.get_output_directory()
        safe_filename = holaf_utils.sanitize_filename(filename)
        safe_subfolder_parts = [holaf_utils.sanitize_directory_component(p) for p in subfolder.split('/') if p]
        original_rel_path = os.path.join(*safe_subfolder_parts, safe_filename)
        original_abs_path = os.path.normpath(os.path.join(output_dir, original_rel_path))

        if not original_abs_path.startswith(os.path.normpath(output_dir)) or \
           not os.path.isfile(original_abs_path):
            return web.json_response({"error": "Image not found or path forbidden"}, status=404)

        loop = asyncio.get_event_loop()
        metadata = await loop.run_in_executor(None, _extract_image_metadata_blocking, original_abs_path)
        
        if "error" in metadata and metadata["error"]: return web.json_response(metadata, status=422)
        return web.json_response(metadata)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in metadata endpoint for {filename}: {e}"); traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)