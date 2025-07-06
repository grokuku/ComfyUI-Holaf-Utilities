# === Holaf Utilities - Image Viewer API Routes (Thumbnails) ===
import asyncio
import os
import hashlib
import json
import traceback

import aiofiles
from aiohttp import web
import folder_paths # ComfyUI global

# Imports from sibling/parent modules
from .. import logic
from ... import holaf_database
from ... import holaf_utils

# --- API Route Handlers ---
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
                gen_success = await loop.run_in_executor(None, logic._create_thumbnail_blocking, original_abs_path, thumb_path_abs, original_rel_path)
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


# <-- MODIFICATION START: Nouvelle route pour la régénération de miniature -->
async def regenerate_thumbnail_route(request: web.Request):
    """
    Regenerates a thumbnail for a given image, applying .edt file adjustments if present.
    """
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        if not path_canon:
            return web.json_response({"status": "error", "message": "'path_canon' is required"}, status=400)

        output_dir = folder_paths.get_output_directory()
        
        # Validate and get original image path
        safe_path_canon = holaf_utils.sanitize_path_canon(path_canon)
        if safe_path_canon != path_canon:
             return web.json_response({"status": "error", "message": "Invalid path specified"}, status=403)
        original_abs_path = os.path.normpath(os.path.join(output_dir, safe_path_canon))
        if not original_abs_path.startswith(os.path.normpath(output_dir)):
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)
        if not os.path.isfile(original_abs_path):
            return web.json_response({"status": "error", "message": "Original image not found"}, status=404)

        # Determine thumbnail path
        path_hash = hashlib.sha1(safe_path_canon.encode('utf-8')).hexdigest()
        thumb_filename = f"{path_hash}.jpg"
        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

        # Load edit data if it exists
        edit_data = None
        base_path, _ = os.path.splitext(safe_path_canon)
        edit_file_rel_path = f"{base_path}.edt"
        edit_file_abs_path = os.path.normpath(os.path.join(output_dir, edit_file_rel_path))
        if os.path.isfile(edit_file_abs_path):
            try:
                async with aiofiles.open(edit_file_abs_path, 'r', encoding='utf-8') as f:
                    content = await f.read()
                    edit_data = json.loads(content)
            except Exception as e:
                print(f"🟡 [IV-RegenThumb] Warning: Could not read or parse edit file {edit_file_abs_path}: {e}")

        # Run blocking thumbnail creation in an executor thread
        loop = asyncio.get_event_loop()
        gen_success = await loop.run_in_executor(
            None, 
            logic._create_thumbnail_blocking, 
            original_abs_path, 
            thumb_path_abs, 
            safe_path_canon, # path_canon for DB update
            edit_data        # The edit data
        )

        if gen_success:
            return web.json_response({"status": "ok", "message": "Thumbnail regenerated successfully."})
        else:
            return web.json_response({"status": "error", "message": "Thumbnail generation failed in backend logic."}, status=500)

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON in request"}, status=400)
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
# <-- MODIFICATION END -->


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

async def get_thumbnail_stats_route(request: web.Request):
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