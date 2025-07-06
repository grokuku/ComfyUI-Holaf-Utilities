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
            print(f"🔵 [Holaf-ImageViewer] Created trashcan directory: {trashcan_path}")
        except OSError as e:
            print(f"🔴 [Holaf-ImageViewer] Failed to create trashcan directory {trashcan_path}: {e}")
            return None
    return trashcan_path

# Call it once at module load to be sure
ensure_trashcan_exists()

# --- Database Synchronization ---

# --- MODIFICATION START: New function for single image updates ---
def add_or_update_single_image(image_abs_path):
    """
    Efficiently adds or updates a single image in the database.
    This should be called by any process that saves a new image.
    """
    output_dir = folder_paths.get_output_directory()
    if not image_abs_path.startswith(output_dir):
        print(f"🟡 [Holaf-Logic] Attempted to add image outside of output directory, ignoring: {image_abs_path}")
        return

    conn = None
    update_exception = None
    try:
        file_stat = os.stat(image_abs_path)
        directory, filename = os.path.split(image_abs_path)
        base_filename, file_ext = os.path.splitext(filename)

        if file_ext.lower() not in SUPPORTED_IMAGE_FORMATS:
            return

        subfolder = os.path.relpath(directory, output_dir)
        if subfolder == '.': subfolder = ''
        path_canon = os.path.join(subfolder, filename).replace(os.sep, '/')

        # Ensure we are not processing something in the trashcan
        if subfolder.startswith(TRASHCAN_DIR_NAME + '/') or subfolder == TRASHCAN_DIR_NAME:
            return

        edit_file_path = os.path.join(directory, f"{base_filename}.edt")
        has_edit_file = os.path.isfile(edit_file_path)

        meta = _extract_image_metadata_blocking(image_abs_path)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        
        # Use INSERT OR REPLACE to handle both new and updated files cleanly
        cursor.execute("""
            INSERT OR REPLACE INTO images 
                (filename, subfolder, path_canon, format, mtime, size_bytes, last_synced_at, 
                 is_trashed, original_path_canon,
                 prompt_text, workflow_json, prompt_source, workflow_source,
                 width, height, aspect_ratio_str, has_edit_file,
                 thumbnail_status, thumbnail_priority_score, thumbnail_last_generated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1000, NULL)
        """, (filename, subfolder.replace(os.sep, '/'), path_canon, file_ext[1:].upper(),
              file_stat.st_mtime, file_stat.st_size, time.time(),
              meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
              meta.get('prompt_source'), meta.get('workflow_source'),
              meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file))
        
        conn.commit()
        print(f"🔵 [Holaf-Logic] Successfully added/updated single image in DB: {path_canon}")
        update_last_db_update_time() # Signal that the DB has changed

    except Exception as e:
        update_exception = e
        print(f"🔴 [Holaf-Logic] Error in add_or_update_single_image for {image_abs_path}: {e}")
        traceback.print_exc()
    finally:
        if conn:
            holaf_database.close_db_connection(exception=update_exception)
# --- MODIFICATION END ---


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

                        # --- MODIFICATION START: Check for .edt file ---
                        base_name, _ = os.path.splitext(filename)
                        edit_file_path = os.path.join(root, f"{base_name}.edt")
                        has_edit_file = os.path.isfile(edit_file_path)
                        # --- MODIFICATION END ---

                        subfolder = os.path.relpath(root, output_dir)
                        if subfolder == '.': subfolder = ''
                        
                        # Ensure we are not processing something already in trashcan (double safety)
                        if subfolder.startswith(TRASHCAN_DIR_NAME + '/') or subfolder == TRASHCAN_DIR_NAME:
                            continue

                        path_canon = os.path.join(subfolder, filename).replace(os.sep, '/')
                        disk_images_canons.add(path_canon)

                        # --- MODIFICATION: Extract metadata here to get sources for DB insert/update ---
                        meta = _extract_image_metadata_blocking(full_path)

                        existing_record = db_images.get(path_canon)

                        if existing_record: # Image exists in DB and is not trashed
                            if existing_record['mtime'] != file_stat.st_mtime or \
                               existing_record['size_bytes'] != file_stat.st_size:
                                cursor.execute("""
                                    UPDATE images
                                    SET mtime = ?, size_bytes = ?, last_synced_at = ?,
                                        prompt_text = ?, workflow_json = ?, prompt_source = ?, workflow_source = ?,
                                        width = ?, height = ?, aspect_ratio_str = ?, has_edit_file = ?,
                                        thumbnail_status = 0, thumbnail_priority_score = 1000, thumbnail_last_generated_at = NULL
                                    WHERE id = ? AND is_trashed = 0
                                """, (file_stat.st_mtime, file_stat.st_size, current_time,
                                      meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
                                      meta.get('prompt_source'), meta.get('workflow_source'),
                                      meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file,
                                      existing_record['id']))
                        else: # New image found on disk (not in DB or was previously trashed and now outside trash)
                            cursor.execute("""
                                INSERT OR REPLACE INTO images 
                                    (filename, subfolder, path_canon, format, mtime, size_bytes, last_synced_at, 
                                     is_trashed, original_path_canon,
                                     prompt_text, workflow_json, prompt_source, workflow_source,
                                     width, height, aspect_ratio_str, has_edit_file)
                                VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (filename, subfolder.replace(os.sep, '/'), path_canon, file_ext[1:].upper(),
                                  file_stat.st_mtime, file_stat.st_size, current_time,
                                  meta.get('prompt'), json.dumps(meta.get('workflow')) if meta.get('workflow') else None,
                                  meta.get('prompt_source'), meta.get('workflow_source'),
                                  meta.get('width'), meta.get('height'), meta.get('ratio'), has_edit_file))
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
        update_last_db_update_time() # --- MODIFICATION: Signal DB change after sync ---

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
            if result["width"] and result["height"]:
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
             cursor.execute("UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = CASE WHEN thumbnail_priority_score > 1000 THEN 1000 ELSE thumbnail_priority_score END WHERE path_canon = ?", (image_path_canon_for_db_update,))
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