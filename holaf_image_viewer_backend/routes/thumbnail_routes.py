# === Holaf Utilities - Image Viewer API Routes (Thumbnails) ===
import asyncio
import os
import hashlib
import json
import traceback
import logging

import aiofiles
from aiohttp import web
import folder_paths # ComfyUI global

# Imports from sibling/parent modules
from .. import logic
from ... import holaf_database
from ... import holaf_utils

logger = logging.getLogger('holaf.images.routes')

# --- API Route Handlers ---
async def get_thumbnail_route(request: web.Request):
    path_canon_param = request.query.get("path_canon")
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "") # This subfolder can now include 'trashcan'
    force_regen_param = request.query.get("force_regen") == "true"

    conn_info_read = None
    original_rel_path = None
    error_message_for_client = "ERR: Thumbnail processing failed."
    current_exception = None

    try:
        output_dir = folder_paths.get_output_directory() # Base output

        # --- FIX: Prioritize path_canon if available (it matches DB key exactly) ---
        if path_canon_param:
             # Security check is vital here since we trust the param more
             if ".." in path_canon_param or path_canon_param.startswith("/"):
                  return web.Response(status=403, text="ERR: Invalid path_canon.")
             original_rel_path = path_canon_param
             original_abs_path = os.path.normpath(os.path.join(output_dir, original_rel_path))
             if not original_abs_path.startswith(os.path.normpath(output_dir)):
                 return web.Response(status=403, text="ERR: Forbidden path_canon.")
        
        # Fallback to legacy reconstruction
        elif filename:
            safe_filename = holaf_utils.sanitize_filename(filename)
            # original_rel_path is the path_canon from the DB
            original_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
            # original_abs_path is its location on disk
            original_abs_path = os.path.normpath(os.path.join(output_dir, original_rel_path))

            if not original_abs_path.startswith(os.path.normpath(output_dir)):
                error_message_for_client = "ERR: Forbidden path for thumbnail."
                return web.Response(status=403, text=error_message_for_client)
        else:
            error_message_for_client = "ERR: Filename or path_canon is required."
            return web.Response(status=400, text=error_message_for_client)


        # --- FIX: Retrieve thumb_hash from DB first ---
        conn_info_read = holaf_database.get_db_connection()
        cursor = conn_info_read.cursor()
        cursor.execute(
            "SELECT mtime, thumbnail_status, thumbnail_last_generated_at, thumb_hash FROM images WHERE path_canon = ?",
            (original_rel_path,)
        )
        image_db_info = cursor.fetchone()
        conn_info_read.commit()

        # Handle case where image is not in DB (possibly just created or deleted)
        if not image_db_info:
             holaf_database.close_db_connection()
             conn_info_read = None
             
             # Fallback: check file existence manually to give a specific error
             if not os.path.isfile(original_abs_path):
                 return web.Response(status=404, text="ERR: Original image not found (disk or DB).")
             return web.Response(status=404, text="ERR: Image record not found in DB.")

        # Extract data from DB
        original_mtime_db = image_db_info['mtime']
        thumb_status_db = image_db_info['thumbnail_status']
        thumb_last_gen_db = image_db_info['thumbnail_last_generated_at']
        db_thumb_hash = image_db_info['thumb_hash']

        # Determine the thumbnail filename based on DB hash (Source of Truth)
        if db_thumb_hash:
            thumb_filename = f"{db_thumb_hash}.jpg"
        else:
            # Fallback for legacy records or sync lag: calculate it
            path_hash = hashlib.sha1(original_rel_path.encode('utf-8')).hexdigest()
            thumb_filename = f"{path_hash}.jpg"

        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)
        
        # Determine generation needs
        needs_generation = force_regen_param
        if thumb_status_db == 0: needs_generation = True
        elif thumb_status_db == 1: needs_generation = True
        elif thumb_status_db == 3: error_message_for_client = "ERR: Thumbnail previously failed (permanent)."
        elif thumb_last_gen_db is not None and original_mtime_db > thumb_last_gen_db: needs_generation = True
        if thumb_status_db == 2 and not os.path.exists(thumb_path_abs) and not needs_generation:
            needs_generation = True
        
        holaf_database.close_db_connection()
        conn_info_read = None

        if error_message_for_client == "ERR: Thumbnail previously failed (permanent)." and not force_regen_param:
             return web.Response(status=500, text=error_message_for_client)

        if needs_generation and os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception: pass 

        # Serve existing if no regen needed
        if not needs_generation and os.path.exists(thumb_path_abs):
            try:
                async with aiofiles.open(thumb_path_abs, 'rb') as f: content = await f.read()
                return web.Response(body=content, content_type='image/jpeg')
            except Exception as e: needs_generation = True; error_message_for_client = "ERR: Failed to read existing thumb."

        # Generate if needed
        if needs_generation:
            if not os.path.isfile(original_abs_path):
                 return web.Response(status=404, text="ERR: Source file missing for generation.")

            loop = asyncio.get_event_loop()
            # Pass explicit args to blocking logic
            gen_success = await loop.run_in_executor(
                None, 
                logic._create_thumbnail_blocking, 
                original_abs_path, 
                thumb_path_abs, 
                original_rel_path # path_canon for DB update
            )
            if not gen_success: error_message_for_client = "ERR: Thumbnail generation function failed."
        
        # Serve generated file
        if os.path.exists(thumb_path_abs):
            try:
                async with aiofiles.open(thumb_path_abs, 'rb') as f: content = await f.read()
                return web.Response(body=content, content_type='image/jpeg')
            except Exception as e: current_exception = e; error_message_for_client = "ERR: Failed to read generated thumb at final stage."
        
        logger.warning(f"Final fallback for {original_rel_path}: Thumbnail not served. Reason: {error_message_for_client}")
        return web.Response(status=500, text=error_message_for_client)

    except Exception as e_outer:
        current_exception = e_outer
        # ... (Exception handling) ...
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
        safe_path_canon = holaf_utils.sanitize_path_canon(path_canon)
        original_abs_path = os.path.normpath(os.path.join(output_dir, safe_path_canon))
        
        if not original_abs_path.startswith(os.path.normpath(output_dir)):
             return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)
        if not os.path.isfile(original_abs_path):
            return web.json_response({"status": "error", "message": "Original image not found"}, status=404)

        # --- FIX: Lookup Hash in DB ---
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT thumb_hash FROM images WHERE path_canon = ?", (safe_path_canon,))
        row = cursor.fetchone()
        holaf_database.close_db_connection()
        
        if row and row['thumb_hash']:
            path_hash = row['thumb_hash']
        else:
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
                logger.warning(f"Could not read or parse edit file {edit_file_abs_path}: {e}")

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


# --- NOUVEAU : Fonction pour traiter la priorisation en arrière-plan ---
async def _background_prioritize_task(paths_canon):
    """
    Processes a list of paths to update their priority in the database.
    This runs in the background.
    """
    conn = None
    current_exception = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        priority_score_for_visible = 10
        
        # Use a single UPDATE statement for efficiency
        placeholders = ','.join(['?'] * len(paths_canon))
        sql = f"""
            UPDATE images
            SET thumbnail_status = CASE thumbnail_status WHEN 0 THEN 1 ELSE thumbnail_status END,
                thumbnail_priority_score = MIN(thumbnail_priority_score, ?)
            WHERE path_canon IN ({placeholders}) AND thumbnail_status IN (0, 1)
        """
        
        params = [priority_score_for_visible] + paths_canon
        cursor.execute(sql, params)
        conn.commit()
        logger.info(f"Background prioritization updated {cursor.rowcount} of {len(paths_canon)} thumbnails.")
        
    except Exception as e:
        current_exception = e
        logger.error(f"Error in _background_prioritize_task: {e}", exc_info=True)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


# --- MODIFIÉ : Route de priorisation non-bloquante ---
async def prioritize_thumbnails_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon")

        if not paths_canon or not isinstance(paths_canon, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        # Lancer la tâche de mise à jour de la base de données en arrière-plan
        loop = asyncio.get_event_loop()
        loop.create_task(_background_prioritize_task(paths_canon))

        # Répondre immédiatement
        return web.json_response({"status": "accepted", "message": "Prioritization task scheduled."}, status=202)

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        logger.error(f"Error scheduling prioritize_thumbnails_route: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


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
        logger.error(f"Error getting thumbnail stats: {e}", exc_info=True)
        return web.json_response({"error": str(e), **default_response}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)