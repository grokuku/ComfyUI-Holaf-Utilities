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
import subprocess
from PIL import PngImagePlugin

from PIL import Image, ImageOps, UnidentifiedImageError, ImageEnhance
import folder_paths

# --- NEW DEPENDENCY: Required for reading XMP sidecar files for tags ---
# Make sure to add 'python-xmp-toolkit' to your requirements.txt
try:
    from libxmp.files import XMPFiles
    from libxmp.consts import XMP_NS_DC
    XMP_AVAILABLE = True
except ImportError:
    XMP_AVAILABLE = False
    print("🟡 [Holaf-Logic] Warning: 'python-xmp-toolkit' not found. XMP tag reading will be disabled.")

# Relative imports to sibling modules in the main package
from .. import holaf_database
from .. import holaf_utils

# --- Constants ---
# We keep the name SUPPORTED_IMAGE_FORMATS for compatibility, but it now includes videos
VIDEO_FORMATS = {'.mp4', '.webm'}
SUPPORTED_IMAGE_FORMATS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}.union(VIDEO_FORMATS)

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

def get_ffmpeg_path():
    """Returns the path to the ffmpeg executable, or None if not found."""
    return shutil.which("ffmpeg")

def get_ffprobe_path():
    """Returns the path to the ffprobe executable, or None if not found."""
    return shutil.which("ffprobe")

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

# --- MODIFICATION: New helper function to manage tags in the DB ---
def _update_image_tags_in_db(cursor, image_id, tags_list):
    """
    Updates the tags for a specific image ID within a transaction.
    It clears existing tags and adds the new ones.
    """
    # 1. Clear all existing tags for this image
    cursor.execute("DELETE FROM imagetags WHERE image_id = ?", (image_id,))

    if not tags_list:
        return # Nothing more to do if the list is empty

    # 2. Process the new list of tags
    for tag_name in set(tags_list): # Use set to ensure uniqueness
        if not isinstance(tag_name, str) or not tag_name.strip():
            continue # Skip empty or invalid tags
        
        clean_tag = tag_name.strip().lower()

        # 3. Find tag_id or create a new tag
        cursor.execute("SELECT tag_id FROM tags WHERE name = ?", (clean_tag,))
        tag_row = cursor.fetchone()
        
        if tag_row:
            tag_id = tag_row['tag_id']
        else:
            cursor.execute("INSERT INTO tags (name) VALUES (?)", (clean_tag,))
            tag_id = cursor.lastrowid
        
        # 4. Link the tag to the image
        cursor.execute("INSERT OR IGNORE INTO imagetags (image_id, tag_id) VALUES (?, ?)", (image_id, tag_id))

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

        meta = _extract_image_metadata_blocking(image_abs_path)

        if not meta.get('width') or not meta.get('height'):
            print(f"🔴 [Holaf-Logic] CRITICAL: Failed to extract valid metadata for {path_canon}. Aborting DB insertion.")
            return

        has_prompt_flag = (meta.get('prompt_source', 'none') not in ['none', 'error'])
        has_workflow_flag = (meta.get('workflow_source', 'none') not in ['none', 'error'])
        has_edits_flag = meta.get('has_edits', False)
        # BUGFIX: Define has_edit_file alias for backward compatibility/SQL params
        has_edit_file = has_edits_flag
        
        # The 'has_tags' flag is now determined by whether the tags list from metadata is empty
        tags_list = meta.get('tags', [])
        has_tags_flag = bool(tags_list)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT id FROM images WHERE path_canon = ?", (path_canon,))
        existing_image = cursor.fetchone()

        if existing_image:
            image_id = existing_image['id']
            # UPDATE existing image
            cursor.execute("""
                UPDATE images SET
                    filename=?, subfolder=?, top_level_subfolder=?, format=?, mtime=?, size_bytes=?, last_synced_at=?,
                    is_trashed=0, original_path_canon=NULL, prompt_text=?, workflow_json=?, prompt_source=?,
                    workflow_source=?, width=?, height=?, aspect_ratio_str=?, has_edit_file=?, thumb_hash=?,
                    has_prompt=?, has_workflow=?, has_edits=?, has_tags=?, thumbnail_status=0, thumbnail_priority_score=1000, thumbnail_last_generated_at=NULL
                WHERE id=?
            """, (filename, subfolder_str, top_level_subfolder, file_ext[1:].upper(), file_stat.st_mtime, file_stat.st_size, time.time(),
                  meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None, meta.get('prompt_source'),
                  meta.get('workflow_source'), meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file, thumb_hash,
                  has_prompt_flag, has_workflow_flag, has_edits_flag, has_tags_flag, image_id))
        else:
            # INSERT new image
            # --- FIX: Ensure 24 '?' for 24 columns ---
            cursor.execute("""
                INSERT INTO images 
                    (filename, subfolder, top_level_subfolder, path_canon, format, mtime, size_bytes, last_synced_at, 
                    is_trashed, original_path_canon, prompt_text, workflow_json, prompt_source, workflow_source,
                    width, height, aspect_ratio_str, has_edit_file, thumb_hash, has_prompt, has_workflow, has_edits, has_tags,
                    thumbnail_status, thumbnail_priority_score, thumbnail_last_generated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1000, NULL)
            """, (filename, subfolder_str, top_level_subfolder, path_canon, file_ext[1:].upper(),
                  file_stat.st_mtime, file_stat.st_size, time.time(),
                  meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
                  meta.get('prompt_source'), meta.get('workflow_source'),
                  meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file, thumb_hash,
                  has_prompt_flag, has_workflow_flag, has_edits_flag, has_tags_flag))
            image_id = cursor.lastrowid
        
        # --- MODIFICATION: Update tags for the image ---
        _update_image_tags_in_db(cursor, image_id, tags_list)

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
    # This function is correct and doesn't need changes, as deleting an image
    # will cascade-delete its tag associations due to the FOREIGN KEY ON DELETE CASCADE constraint.
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
                        subfolder_str = os.path.relpath(root, output_dir).replace(os.sep, '/')
                        if subfolder_str == '.': subfolder_str = ''
                        if subfolder_str.startswith(TRASHCAN_DIR_NAME + '/') or subfolder_str == TRASHCAN_DIR_NAME:
                            continue
                        path_canon = os.path.join(subfolder_str, filename).replace('\\', '/')
                        
                        # --- FIX: Calculate thumb_hash ---
                        thumb_hash = hashlib.sha1(path_canon.encode('utf-8')).hexdigest()
                        
                        disk_images_canons.add(path_canon)
                        top_level_subfolder = 'root'
                        if subfolder_str: top_level_subfolder = subfolder_str.split('/')[0]

                        meta = _extract_image_metadata_blocking(full_path)
                        has_prompt_flag = (meta.get('prompt_source', 'none') not in ['none', 'error'])
                        has_workflow_flag = (meta.get('workflow_source', 'none') not in ['none', 'error'])
                        has_edits_flag = meta.get('has_edits', False)
                        # BUGFIX: Define has_edit_file alias for backward compatibility/SQL params
                        has_edit_file = has_edits_flag
                        
                        tags_list = meta.get('tags', [])
                        has_tags_flag = bool(tags_list)
                        
                        existing_record = db_images.get(path_canon)
                        image_id = None
                        if existing_record:
                            image_id = existing_record['id']
                            # Check if properties changed OR if thumb_hash is missing in DB (for migration safety)
                            if (existing_record['mtime'] != file_stat.st_mtime or
                                existing_record['size_bytes'] != file_stat.st_size or
                                existing_record.get('thumb_hash') != thumb_hash): # Check for thumb_hash change too
                                cursor.execute("""
                                    UPDATE images SET mtime=?, size_bytes=?, last_synced_at=?, subfolder=?, 
                                    top_level_subfolder=?, prompt_text=?, workflow_json=?, prompt_source=?, 
                                    workflow_source=?, width=?, height=?, aspect_ratio_str=?, has_edit_file=?, thumb_hash=?,
                                    has_prompt=?, has_workflow=?, has_edits=?, has_tags=?, 
                                    thumbnail_status=0, thumbnail_priority_score=1000, thumbnail_last_generated_at=NULL
                                    WHERE id=?
                                """, (file_stat.st_mtime, file_stat.st_size, current_time, subfolder_str, top_level_subfolder,
                                      meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None, meta.get('prompt_source'),
                                      meta.get('workflow_source'), meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file, thumb_hash,
                                      has_prompt_flag, has_workflow_flag, has_edits_flag, has_tags_flag, image_id))
                        else:
                            # --- FIX: Ensure 24 '?' for 24 columns in Sync function too ---
                            cursor.execute("""
                                INSERT INTO images (filename, subfolder, top_level_subfolder, path_canon, format, mtime, 
                                size_bytes, last_synced_at, has_edit_file, thumb_hash, has_prompt, has_workflow, has_edits, has_tags,
                                prompt_text, workflow_json, prompt_source, workflow_source, width, height, aspect_ratio_str,
                                thumbnail_status, thumbnail_priority_score, thumbnail_last_generated_at)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                            """, (filename, subfolder_str, top_level_subfolder, path_canon, file_ext[1:].upper(),
                                  file_stat.st_mtime, file_stat.st_size, current_time, has_edit_file, thumb_hash,
                                  has_prompt_flag, has_workflow_flag, has_edits_flag, has_tags_flag,
                                  meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
                                  meta.get('prompt_source'), meta.get('workflow_source'),
                                  meta.get('width'), meta.get('height'), meta.get('ratio'),
                                  0, 1000, None))
                            image_id = cursor.lastrowid
                        
                        if image_id:
                            _update_image_tags_in_db(cursor, image_id, tags_list)
                    except Exception as e:
                        print(f"🔴 [Holaf-ImageViewer] Error processing file {filename} during sync: {e}")
            conn.commit()

        stale_canons = set(db_images.keys()) - disk_images_canons
        if stale_canons:
            print(f"🔵 [Holaf-ImageViewer] Found {len(stale_canons)} stale image entries to remove from DB.")
            placeholders = ','.join('?' for _ in stale_canons)
            cursor.execute(f"DELETE FROM images WHERE path_canon IN ({placeholders}) AND is_trashed = 0", tuple(stale_canons))
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
    if isinstance(obj, dict): return {k: _sanitize_json_nan(v) for k, v in obj.items()}
    elif isinstance(obj, list): return [_sanitize_json_nan(i) for i in obj]
    elif isinstance(obj, float) and math.isnan(obj): return None
    return obj

def _get_best_ratio_string(width, height):
    if height == 0: return None
    actual_ratio = width / height
    min_diff, best_match = float('inf'), None
    for r_info in STANDARD_RATIOS:
        diff = abs(actual_ratio - r_info["value"])
        if diff < min_diff: min_diff, best_match = diff, r_info["name"]
    if min_diff / actual_ratio < RATIO_THRESHOLD: return best_match
    common_divisor = math.gcd(width, height)
    return f"{width // common_divisor}:{height // common_divisor}"

def _extract_image_metadata_blocking(image_path_abs):
    directory, filename = os.path.split(image_path_abs)
    base_filename, file_ext = os.path.splitext(filename)

    prompt_txt_path = os.path.join(directory, base_filename + ".txt")
    workflow_json_path = os.path.join(directory, base_filename + ".json")
    edit_file_path = os.path.join(directory, base_filename + ".edt")
    xmp_file_path = os.path.join(directory, base_filename + ".xmp")

    result = {
        "prompt": None, "prompt_source": "none",
        "workflow": None, "workflow_source": "none",
        "width": None, "height": None, "ratio": None,
        "has_edits": os.path.isfile(edit_file_path),
        "tags": [] # Initialize with an empty list for tags
    }

    # --- MODIFICATION: Read tags from XMP sidecar file ---
    if XMP_AVAILABLE and os.path.isfile(xmp_file_path):
        try:
            xmpfile = XMPFiles(file_path=xmp_file_path, open_forupdate=False)
            xmp = xmpfile.get_xmp()
            if xmp and xmp.does_property_exist(XMP_NS_DC, 'subject'):
                # get_property returns a list of strings for 'subject'
                tags = xmp.get_property(XMP_NS_DC, 'subject')
                if tags:
                    result["tags"] = [str(tag) for tag in tags if isinstance(tag, str) and tag.strip()]
            xmpfile.close_file()
        except Exception as e:
            print(f"🟡 [Holaf-Logic] Failed to read XMP file {xmp_file_path}: {e}")
    # --- END MODIFICATION ---

    if os.path.isfile(prompt_txt_path):
        try:
            with open(prompt_txt_path, 'r', encoding='utf-8') as f: result["prompt"] = f.read()
            result["prompt_source"] = "external_txt"
        except Exception as e: result["prompt"], result["prompt_source"] = f"Error reading .txt: {e}", "error"

    if os.path.isfile(workflow_json_path):
        try:
            with open(workflow_json_path, 'r', encoding='utf-8') as f: result["workflow"] = _sanitize_json_nan(json.load(f))
            result["workflow_source"] = "external_json"
        except Exception as e: result["workflow"], result["workflow_source"] = {"error": f"Error reading .json: {e}"}, "error"

    # --- VIDEO HANDLING ---
    if file_ext.lower() in VIDEO_FORMATS:
        ffprobe = get_ffprobe_path()
        if ffprobe:
            try:
                # Run ffprobe to get resolution
                cmd = [
                    ffprobe, "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=width,height",
                    "-of", "json", image_path_abs
                ]
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                stdout, stderr = process.communicate()
                
                if process.returncode == 0:
                    info = json.loads(stdout)
                    streams = info.get("streams", [])
                    if streams:
                        result["width"] = streams[0].get("width")
                        result["height"] = streams[0].get("height")
                        if result["width"] and result["height"]:
                             result["ratio"] = _get_best_ratio_string(result["width"], result["height"])
                else:
                    result["error"] = f"ffprobe failed: {stderr.decode('utf-8')}"
            except Exception as e:
                result["error"] = f"Video analysis failed: {e}"
        else:
            result["error"] = "ffprobe not found"
            
        return result
    # --- END VIDEO HANDLING ---

    # --- IMAGE HANDLING ---
    try:
        with Image.open(image_path_abs) as img:
            result["width"], result["height"] = img.size
            if result["width"] and result["height"]: result["ratio"] = _get_best_ratio_string(result["width"], result["height"])
            if hasattr(img, 'info') and isinstance(img.info, dict):
                if result["prompt_source"] == "none" and 'prompt' in img.info:
                    result["prompt"], result["prompt_source"] = img.info['prompt'], "internal_png"
                if result["workflow_source"] == "none" and 'workflow' in img.info:
                    try:
                        result["workflow"], result["workflow_source"] = _sanitize_json_nan(json.loads(img.info['workflow'])), "internal_png"
                    except Exception: result["workflow"], result["workflow_source"] = {"error": "Malformed workflow in PNG"}, "error"
    except FileNotFoundError: result["error"] = "Image file not found"
    except UnidentifiedImageError: result["error"] = "Unidentified image error"
    except Exception as e: result["error"] = str(e)
    if "error" in result: print(f"🟡 [Holaf-Logic] Metadata error for {filename}: {result['error']}")

    return result

def apply_edits_to_image(image, edit_data):
    if not isinstance(edit_data, dict): return image
    if 'brightness' in edit_data: image = ImageEnhance.Brightness(image).enhance(float(edit_data['brightness']))
    if 'contrast' in edit_data: image = ImageEnhance.Contrast(image).enhance(float(edit_data['contrast']))
    if 'saturation' in edit_data: image = ImageEnhance.Color(image).enhance(float(edit_data['saturation']))
    return image

def _create_thumbnail_blocking(original_path_abs, thumb_path_abs, image_path_canon_for_db_update=None, edit_data=None):
    conn_update_db = None
    update_exception = None
    file_ext = os.path.splitext(original_path_abs)[1].lower()

    try:
        if os.path.exists(thumb_path_abs): os.remove(thumb_path_abs)
        
        img = None
        
        # --- VIDEO THUMBNAIL EXTRACTION ---
        if file_ext in VIDEO_FORMATS:
            ffmpeg = get_ffmpeg_path()
            if not ffmpeg:
                raise RuntimeError("ffmpeg not found, cannot generate video thumbnail.")
            
            # Extract first frame at 00:00:00 to stdout
            cmd = [
                ffmpeg, "-y", "-ss", "00:00:00", "-i", original_path_abs,
                "-frames:v", "1", "-f", "image2", "pipe:1"
            ]
            
            # We suppress stderr unless there is an error to avoid console spam
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = process.communicate()
            
            if process.returncode != 0:
                raise RuntimeError(f"ffmpeg extraction failed: {stderr.decode('utf-8')}")
                
            from io import BytesIO
            img = Image.open(BytesIO(stdout))
        # --- END VIDEO THUMBNAIL EXTRACTION ---
        else:
            # Standard image loading
            img = Image.open(original_path_abs)

        # Common processing (Resize, Edits, Save)
        with img:
            img_copy = img.copy()
            if edit_data: img_copy = apply_edits_to_image(img_copy, edit_data)
            
            target_dim_w, target_dim_h = holaf_utils.THUMBNAIL_SIZE if isinstance(holaf_utils.THUMBNAIL_SIZE, tuple) else (holaf_utils.THUMBNAIL_SIZE, holaf_utils.THUMBNAIL_SIZE)
            original_width, original_height = img_copy.size
            if original_width == 0 or original_height == 0: raise ValueError("Image dimensions cannot be zero.")
            
            ratio = min(target_dim_w / original_width, target_dim_h / original_height)
            new_width, new_height = int(original_width * ratio), int(original_height * ratio)
            
            if new_width <= 0: new_width = 1
            if new_height <= 0: new_height = 1
            
            img_copy = img_copy.resize((new_width, new_height), Image.Resampling.LANCZOS)
            img_to_save = img_copy.convert("RGB")
            img_to_save.save(thumb_path_abs, "JPEG", quality=85, optimize=True)
            
        if image_path_canon_for_db_update:
            conn_update_db = holaf_database.get_db_connection()
            cursor = conn_update_db.cursor()
            cursor.execute("UPDATE images SET thumbnail_status = 2, thumbnail_last_generated_at = ? WHERE path_canon = ?", (time.time(), image_path_canon_for_db_update))
            conn_update_db.commit()
            
    except UnidentifiedImageError as e:
        update_exception = e
    except Exception as e:
        update_exception = e
        # --- FIX: Prevent infinite loops. Mark as Failed (Status 3) and set Lowest Priority (9999) ---
        print(f"🔴 [Holaf-ImageViewer] Error in _create_thumbnail_blocking for {original_path_abs}: {e}")
        if image_path_canon_for_db_update:
            conn_fail_db_inner = None # Use a new connection variable to avoid conflicts
            try:
                conn_fail_db_inner = holaf_database.get_db_connection()
                cursor_inner = conn_fail_db_inner.cursor()
                cursor_inner.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (image_path_canon_for_db_update,))
                conn_fail_db_inner.commit()
            except Exception as e_fail_inner:
                print(f"🔴 [Holaf-ImageViewer] CRITICAL: ALSO FAILED to update thumbnail error status in DB (inner): {e_fail_inner}")
            finally:
                if conn_fail_db_inner:
                    holaf_database.close_db_connection(exception=e_fail_inner)
        if os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception as e_clean: print(f"🔴 [Holaf-ImageViewer] Could not clean up failed thumbnail {thumb_path_abs}: {e_clean}")
    finally:
        if conn_update_db:
            holaf_database.close_db_connection(exception=update_exception)

def _strip_png_metadata_and_get_mtime(image_abs_path):
    try:
        with Image.open(image_abs_path) as img: img.load()
        new_img = Image.new(img.mode, img.size); new_img.putdata(list(img.getdata()))
        new_img.save(image_abs_path, "PNG")
        return os.path.getmtime(image_abs_path)
    except Exception as e: raise RuntimeError(f"Failed to strip metadata: {e}") from e

def _inject_png_metadata_and_get_mtime(image_abs_path, prompt_text=None, workflow_data=None):
    try:
        with Image.open(image_abs_path) as img: img.load()
        png_info = PngImagePlugin.PngInfo()
        if prompt_text: png_info.add_text("prompt", prompt_text)
        if workflow_data: png_info.add_text("workflow", json.dumps(workflow_data))
        img.save(image_abs_path, "PNG", pnginfo=png_info)
        return os.path.getmtime(image_abs_path)
    except Exception as e: raise RuntimeError(f"Failed to inject metadata: {e}") from e