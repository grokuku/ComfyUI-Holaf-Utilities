# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-23
#
# Purpose:
# This file provides the server-side logic for the Holaf Model Manager.
# It defines API endpoints for listing and managing models recognized by ComfyUI.
#
# Design Choices & Rationale (v2 - Robust Scanning):
# - Error Handling: Added a try-except block for each individual model file.
#   This prevents a single problematic file (e.g., broken symlink, permission
#   issue) from crashing the entire API endpoint and returning a 500 error.
# - Security: The delete endpoint includes a security check to prevent path
#   traversal attacks, ensuring that only files within registered model
#   directories can be deleted.
# === End Documentation ===

import os
import server
from aiohttp import web
import folder_paths

# This dictionary is intentionally empty. The file is used for its API endpoints,
# not for creating custom nodes in the graph. It must exist for the dynamic
# loader in __init__.py to work correctly.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

def get_all_models():
    """Scans all known model folders and returns a structured list of models."""
    model_list = []
    supported_types = folder_paths.get_model_paths_dict()

    for model_type in supported_types:
        try:
            model_files = folder_paths.get_filename_list(model_type)
            if not model_files:
                continue

            for model_file in model_files:
                # THIS IS THE FIX: Wrap each file operation in a try-except block.
                try:
                    full_path = folder_paths.get_full_path(model_type, model_file)
                    if full_path and os.path.isfile(full_path):
                        model_list.append({
                            "name": model_file,
                            "type": model_type,
                            "path": full_path,
                            "size_bytes": os.path.getsize(full_path)
                        })
                except Exception as e:
                    # If one file fails, log it and continue with the others.
                    print(f"🟡 [Holaf-ModelManager] Warning: Could not process model file '{model_file}' in '{model_type}'. Skipping. Reason: {e}")
        
        except Exception as e:
            print(f"🔴 [Holaf-ModelManager] Error: Could not scan model type '{model_type}': {e}")
            
    return sorted(model_list, key=lambda x: x['name'].lower())

@server.PromptServer.instance.routes.get("/holaf/models")
async def get_models_route(request):
    """API endpoint to get the list of all models."""
    try:
        models = get_all_models()
        return web.json_response(models)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Critical error during model fetch: {e}")
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/holaf/models/delete")
async def delete_model_route(request):
    """API endpoint to delete a model file."""
    try:
        data = await request.json()
        model_path = data.get("path")

        if not model_path:
            return web.json_response({"status": "error", "message": "No path provided"}, status=400)

        safe_path = os.path.normpath(model_path)
        all_model_dirs = set()
        for paths in folder_paths.get_model_paths_dict().values():
            for path in paths:
                all_model_dirs.add(os.path.normpath(path))

        is_safe = False
        for valid_dir in all_model_dirs:
            try:
                # Check if the file's directory is a sub-path of a valid model directory.
                if os.path.normpath(os.path.dirname(safe_path)) in valid_dir:
                    is_safe = True
                    break
                # An alternative, more robust check for subdirectories
                if os.path.commonpath([safe_path, valid_dir]) == valid_dir:
                    is_safe = True
                    break
            except ValueError:
                continue

        if not is_safe:
            print(f"🔴 [Holaf-ModelManager] SECURITY: Attempt to delete file outside of model directories was blocked: {safe_path}")
            return web.json_response({"status": "error", "message": "Deletion of this file is not allowed."}, status=403)
        
        if os.path.exists(safe_path) and os.path.isfile(safe_path):
            os.remove(safe_path)
            print(f"🔵 [Holaf-ModelManager] Deleted model: {safe_path}")
            return web.json_response({"status": "ok", "message": f"Model '{os.path.basename(safe_path)}' deleted."})
        else:
            return web.json_response({"status": "error", "message": "File not found or is a directory."}, status=404)

    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error deleting model: {e}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)

print("  > [Holaf-ModelManager] API endpoints loaded.")