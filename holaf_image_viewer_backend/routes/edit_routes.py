# === Holaf Utilities - Image Viewer API Routes (Image Editing) ===
import asyncio
import os
import json
import traceback
import time

import aiofiles
from aiohttp import web
import folder_paths # ComfyUI global

from ... import holaf_utils
from ... import holaf_database

async def load_edits_route(request: web.Request):
    """
    Loads the content of an .edt sidecar file for a given image.
    """
    path_canon = request.query.get("path_canon")
    if not path_canon:
        return web.json_response({"status": "error", "message": "'path_canon' is required"}, status=400)

    try:
        output_dir = folder_paths.get_output_directory()
        # Sanitize to prevent directory traversal outside of the intended path
        safe_path_canon = holaf_utils.sanitize_path_canon(path_canon)
        if safe_path_canon != path_canon:
             return web.json_response({"status": "error", "message": "Invalid path specified"}, status=403)

        base_path, _ = os.path.splitext(safe_path_canon)
        edit_file_rel_path = f"{base_path}.edt"
        edit_file_abs_path = os.path.normpath(os.path.join(output_dir, edit_file_rel_path))

        if not edit_file_abs_path.startswith(os.path.normpath(output_dir)):
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)
        
        if not os.path.isfile(edit_file_abs_path):
            return web.json_response({"status": "error", "message": "Edit file not found"}, status=404)

        async with aiofiles.open(edit_file_abs_path, 'r', encoding='utf-8') as f:
            content = await f.read()
            edit_data = json.loads(content)

        return web.json_response({"status": "ok", "edits": edit_data})

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON format in edit file"}, status=500)
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def save_edits_route(request: web.Request):
    """
    Saves edit data to an .edt sidecar file and updates the database.
    """
    conn, current_exception = None, None
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        edits = data.get("edits")

        if not path_canon or edits is None:
            return web.json_response({"status": "error", "message": "'path_canon' and 'edits' are required"}, status=400)

        output_dir = folder_paths.get_output_directory()
        safe_path_canon = holaf_utils.sanitize_path_canon(path_canon)
        if safe_path_canon != path_canon:
             return web.json_response({"status": "error", "message": "Invalid path specified"}, status=403)

        base_path, _ = os.path.splitext(safe_path_canon)
        edit_file_rel_path = f"{base_path}.edt"
        edit_file_abs_path = os.path.normpath(os.path.join(output_dir, edit_file_rel_path))

        if not edit_file_abs_path.startswith(os.path.normpath(output_dir)):
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)

        # Write the .edt file
        async with aiofiles.open(edit_file_abs_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(edits, indent=2))

        # Update the database to reflect the presence of the edit file
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE images SET has_edit_file = 1, last_synced_at = ? WHERE path_canon = ?", (time.time(), path_canon))
        conn.commit()

        return web.json_response({"status": "ok", "message": "Edits saved successfully"})

    except json.JSONDecodeError:
        current_exception = "Invalid JSON in request"
        return web.json_response({"status": "error", "message": current_exception}, status=400)
    except Exception as e:
        current_exception = e
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


async def delete_edits_route(request: web.Request):
    """
    Deletes an .edt sidecar file and updates the database.
    """
    conn, current_exception = None, None
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        if not path_canon:
            return web.json_response({"status": "error", "message": "'path_canon' is required"}, status=400)
        
        output_dir = folder_paths.get_output_directory()
        safe_path_canon = holaf_utils.sanitize_path_canon(path_canon)
        if safe_path_canon != path_canon:
             return web.json_response({"status": "error", "message": "Invalid path specified"}, status=403)
        
        base_path, _ = os.path.splitext(safe_path_canon)
        edit_file_rel_path = f"{base_path}.edt"
        edit_file_abs_path = os.path.normpath(os.path.join(output_dir, edit_file_rel_path))

        if not edit_file_abs_path.startswith(os.path.normpath(output_dir)):
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)

        # Delete the file if it exists
        if os.path.isfile(edit_file_abs_path):
            os.remove(edit_file_abs_path)
        
        # Update the database
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE images SET has_edit_file = 0, last_synced_at = ? WHERE path_canon = ?", (time.time(), path_canon))
        conn.commit()

        return web.json_response({"status": "ok", "message": "Edits reset successfully"})

    except json.JSONDecodeError:
        current_exception = "Invalid JSON in request"
        return web.json_response({"status": "error", "message": current_exception}, status=400)
    except Exception as e:
        current_exception = e
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)