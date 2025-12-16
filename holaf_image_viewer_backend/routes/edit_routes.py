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
from .. import logic 

EDIT_DIR_NAME = "edit"

def _get_edit_paths(output_dir, path_canon):
    """
    Returns a tuple (new_edit_path, legacy_edit_path, edit_dir, safe_path_canon) based on the image path.
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
        
        # Check if the IMAGE (or video) file itself exists
        abs_image_path = os.path.join(output_dir, safe_path)
        if not os.path.isfile(abs_image_path):
             return web.json_response({"status": "error", "message": "Image/Video file not found"}, status=404)
             
        # Resolve Edits Path
        target_path = None
        if os.path.isfile(new_path):
            target_path = new_path
        elif os.path.isfile(legacy_path):
            target_path = legacy_path

        # --- LOAD EDIT DATA (IF EXISTS) ---
        edit_data = {}
        if target_path:
            async with aiofiles.open(target_path, 'r', encoding='utf-8') as f:
                content = await f.read()
                edit_data = json.loads(content)
                
        # --- ENRICH WITH METADATA (FPS & SIDE-LOAD) ---
        response_data = {"status": "ok", "edits": edit_data}
        
        # Check if video format to inject FPS
        _, ext = os.path.splitext(safe_path)
        if ext.lower() in logic.VIDEO_FORMATS:
            loop = asyncio.get_event_loop()
            
            # 1. Native FPS
            native_fps = await loop.run_in_executor(None, logic.get_video_fps, abs_image_path)
            response_data["native_fps"] = native_fps
            
            # 2. Check for Processed Side-Load File (_proc.mp4)
            # Logic module handles the path resolution
            proc_path = logic.get_proc_video_path(abs_image_path)
            if os.path.isfile(proc_path):
                # Construct URL for the frontend to play it
                # We use the standard ComfyUI view route mechanism
                rel_dir = os.path.dirname(safe_path)
                edit_subfolder = os.path.join(rel_dir, EDIT_DIR_NAME).replace("\\", "/")
                proc_filename = os.path.basename(proc_path)
                
                response_data["processed_video_url"] = f"/view?filename={proc_filename}&subfolder={edit_subfolder}&type=output"
            
        return web.json_response(response_data)

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON format in edit file"}, status=500)
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def save_edits_route(request: web.Request):
    """
    Saves edit data to 'edit/' folder.
    Migrates legacy files by deleting them after successful save in new location.
    Forces thumbnail regeneration to reflect changes.
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
        
        # [MODIFIED] Set thumbnail_status = 0 and high priority to force regeneration
        cursor.execute("""
            UPDATE images 
            SET has_edit_file = 1, 
                last_synced_at = ?, 
                thumbnail_status = 0, 
                thumbnail_priority_score = 2000 
            WHERE path_canon = ?
        """, (time.time(), path_canon))
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
        
        # [MODIFIED] Reset thumbnail too when deleting edits
        cursor.execute("""
            UPDATE images 
            SET has_edit_file = 0, 
                last_synced_at = ?,
                thumbnail_status = 0, 
                thumbnail_priority_score = 2000 
            WHERE path_canon = ?
        """, (time.time(), path_canon))
        
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

# --- NEW: SIDE-LOAD PROCESSING ROUTES ---

async def process_video_route(request: web.Request):
    """
    Generates a _proc.mp4 video based on current edits (RIFE, Filters).
    """
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        edit_data = data.get("edits", {})
        
        if not path_canon: return web.json_response({"status": "error", "message": "Missing path"}, status=400)
        
        output_dir = folder_paths.get_output_directory()
        safe_path = holaf_utils.sanitize_path_canon(path_canon)
        abs_image_path = os.path.join(output_dir, safe_path)
        
        if not os.path.isfile(abs_image_path):
            return web.json_response({"status": "error", "message": "Source file not found"}, status=404)
            
        loop = asyncio.get_event_loop()
        
        # [UPDATED] Use preview_mode=True to skip baking colors (letting CSS handle it)
        # and receive stats back
        stats = await loop.run_in_executor(None, logic.generate_proc_video, abs_image_path, edit_data, True)
        
        return web.json_response({"status": "ok", "message": "Preview generated successfully", "stats": stats})
        
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def rollback_video_route(request: web.Request):
    """
    Deletes the _proc.mp4 video to revert to original view.
    """
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        
        output_dir = folder_paths.get_output_directory()
        safe_path = holaf_utils.sanitize_path_canon(path_canon)
        abs_image_path = os.path.join(output_dir, safe_path)
        
        # Get location of proc file
        proc_path = logic.get_proc_video_path(abs_image_path)
        
        if os.path.isfile(proc_path):
            os.remove(proc_path)
            return web.json_response({"status": "ok", "message": "Rollback successful"})
        else:
             return web.json_response({"status": "warning", "message": "No processed file found to delete"})
             
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)