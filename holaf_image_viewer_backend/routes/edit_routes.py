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

EDIT_DIR_NAME = "edit"

def _get_edit_paths(output_dir, path_canon):
    """
    Returns a tuple (new_edit_path, legacy_edit_path, edit_dir) based on the image path.
    """
    # 1. Resolve absolute path of the image
    safe_path_canon = holaf_utils.sanitize_path_canon(path_canon)
    # Note: path_canon is relative to output_dir
    
    # Split into directory and filename (relative)
    rel_dir, filename = os.path.split(safe_path_canon)
    base_name, _ = os.path.splitext(filename)
    
    # Absolute path to the directory containing the image
    abs_img_dir = os.path.normpath(os.path.join(output_dir, rel_dir))
    
    # Define paths
    edit_filename = f"{base_name}.edt"
    
    # New Structure: /path/to/image_folder/edit/image.edt
    abs_edit_dir = os.path.join(abs_img_dir, EDIT_DIR_NAME)
    abs_new_edit_path = os.path.join(abs_edit_dir, edit_filename)
    
    # Legacy Structure: /path/to/image_folder/image.edt
    abs_legacy_edit_path = os.path.join(abs_img_dir, edit_filename)
    
    return abs_new_edit_path, abs_legacy_edit_path, abs_edit_dir, safe_path_canon

async def load_edits_route(request: web.Request):
    """
    Loads the content of an .edt sidecar file. 
    Prioritizes 'edit/' folder, falls back to legacy sibling file.
    """
    path_canon = request.query.get("path_canon")
    if not path_canon:
        return web.json_response({"status": "error", "message": "'path_canon' is required"}, status=400)

    try:
        output_dir = folder_paths.get_output_directory()
        new_path, legacy_path, _, safe_path = _get_edit_paths(output_dir, path_canon)

        if safe_path != path_canon:
             return web.json_response({"status": "error", "message": "Invalid path specified"}, status=403)

        # Security check
        if not new_path.startswith(os.path.normpath(output_dir)):
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)
        
        target_path = None
        
        # 1. Check new 'edit/' folder
        if os.path.isfile(new_path):
            target_path = new_path
        # 2. Check legacy location
        elif os.path.isfile(legacy_path):
            target_path = legacy_path
            
        if not target_path:
            return web.json_response({"status": "error", "message": "Edit file not found"}, status=404)

        async with aiofiles.open(target_path, 'r', encoding='utf-8') as f:
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
    Saves edit data to 'edit/' folder.
    Migrates legacy files by deleting them after successful save in new location.
    """
    conn, current_exception = None, None
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        edits = data.get("edits")

        if not path_canon or edits is None:
            return web.json_response({"status": "error", "message": "'path_canon' and 'edits' are required"}, status=400)

        output_dir = folder_paths.get_output_directory()
        new_path, legacy_path, edit_dir, safe_path = _get_edit_paths(output_dir, path_canon)
        
        if safe_path != path_canon:
             return web.json_response({"status": "error", "message": "Invalid path specified"}, status=403)

        if not new_path.startswith(os.path.normpath(output_dir)):
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)

        # Ensure 'edit' directory exists
        if not os.path.exists(edit_dir):
            os.makedirs(edit_dir, exist_ok=True)

        # Write the .edt file to the NEW location
        async with aiofiles.open(new_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(edits, indent=2))
            
        # Cleanup: Remove legacy file if it exists to avoid confusion
        if os.path.isfile(legacy_path):
            try:
                os.remove(legacy_path)
                print(f"🔵 [Holaf-Edit] Migrated edit file for {path_canon} to 'edit/' folder.")
            except Exception as e:
                print(f"🟡 [Holaf-Edit] Failed to remove legacy edit file: {e}")

        # Update the database
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
    Deletes .edt sidecar file (checks both new and legacy locations).
    """
    conn, current_exception = None, None
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        if not path_canon:
            return web.json_response({"status": "error", "message": "'path_canon' is required"}, status=400)
        
        output_dir = folder_paths.get_output_directory()
        new_path, legacy_path, _, safe_path = _get_edit_paths(output_dir, path_canon)
        
        if safe_path != path_canon:
             return web.json_response({"status": "error", "message": "Invalid path specified"}, status=403)

        if not new_path.startswith(os.path.normpath(output_dir)):
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)

        # Delete from NEW location
        if os.path.isfile(new_path):
            os.remove(new_path)
            
        # Delete from LEGACY location (cleanup)
        if os.path.isfile(legacy_path):
            os.remove(legacy_path)
        
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