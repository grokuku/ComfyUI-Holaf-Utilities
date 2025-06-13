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
    
    # MODIFICATION: Utiliser une méthode compatible pour obtenir les types de modèles.
    if hasattr(folder_paths, 'folder_names_and_paths'):
        # folder_names_and_paths est un dictionnaire clé: type, valeur: [ ([paths], [extensions]), ... ]
        # Nous avons juste besoin des clés (types de modèles)
        supported_model_types = list(folder_paths.folder_names_and_paths.keys())
    elif hasattr(folder_paths, 'supported_pt_extensions'): 
        # Fallback: supported_pt_extensions est un dictionnaire clé: type, valeur: (extensions)
        supported_model_types = list(folder_paths.supported_pt_extensions.keys())
    else:
        print("🔴 [Holaf-ModelManager] Error: Could not determine model types from folder_paths module.")
        return []

    for model_type in supported_model_types:
        try:
            model_files = folder_paths.get_filename_list(model_type)
            if not model_files:
                continue

            for model_file in model_files:
                try:
                    full_path = folder_paths.get_full_path(model_type, model_file)
                    if full_path and os.path.isfile(full_path):
                        model_list.append({
                            "name": model_file,
                            "type": model_type,
                            "path": full_path,
                            "size_bytes": os.path.getsize(full_path)
                        })
                    elif not full_path:
                         print(f"🟡 [Holaf-ModelManager] Warning: get_full_path returned None for model_file '{model_file}' in '{model_type}'. Skipping.")
                except Exception as e:
                    print(f"🟡 [Holaf-ModelManager] Warning: Could not process model file '{model_file}' in '{model_type}'. Skipping. Reason: {e}")
        
        except Exception as e:
            # Cette exception peut survenir si model_type (ex: 'custom_nodes') n'est pas un type de "modèle" valide pour get_filename_list
            # ou si get_filename_list lui-même a un problème avec ce type.
            print(f"🟡 [Holaf-ModelManager] Warning: Could not scan model type '{model_type}'. Skipping. Reason: {e}")
            
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
        
        # Obtenir tous les répertoires de modèles valides pour la vérification de sécurité
        all_model_root_dirs = set()
        if hasattr(folder_paths, 'folder_names_and_paths'):
            for type_name, paths_extensions_list in folder_paths.folder_names_and_paths.items():
                for paths_list, _ in paths_extensions_list: # paths_list est une liste de chemins de base pour ce type
                    for p_item in paths_list:
                         # Dans les versions plus récentes, p_item peut être juste le chemin, ou un tuple (path, metadata)
                        if isinstance(p_item, str):
                            all_model_root_dirs.add(os.path.normpath(p_item))
                        elif isinstance(p_item, tuple) and len(p_item) > 0 and isinstance(p_item[0], str):
                            all_model_root_dirs.add(os.path.normpath(p_item[0]))


        is_safe = False
        if not all_model_root_dirs: # Sécurité au cas où on ne pourrait pas charger les répertoires
            print(f"🔴 [Holaf-ModelManager] SECURITY: Could not determine valid model directories. Deletion blocked for: {safe_path}")
            return web.json_response({"status": "error", "message": "Cannot verify model directories. Deletion blocked."}, status=500)

        for valid_dir in all_model_root_dirs:
            # Vérifier si le chemin du modèle est DANS un des répertoires de modèles valides
            if os.path.commonpath([safe_path, valid_dir]) == valid_dir:
                 # Vérifier aussi que ce n'est pas le répertoire lui-même, mais un fichier dedans
                if os.path.isfile(safe_path) and os.path.dirname(safe_path).startswith(valid_dir):
                    is_safe = True
                    break
        
        if not is_safe:
            print(f"🔴 [Holaf-ModelManager] SECURITY: Attempt to delete file outside of model directories was blocked: {safe_path}")
            return web.json_response({"status": "error", "message": "Deletion of this file is not allowed."}, status=403)
        
        if os.path.exists(safe_path) and os.path.isfile(safe_path): # Double check isfile
            os.remove(safe_path)
            print(f"🔵 [Holaf-ModelManager] Deleted model: {safe_path}")
            return web.json_response({"status": "ok", "message": f"Model '{os.path.basename(safe_path)}' deleted."})
        else:
            return web.json_response({"status": "error", "message": "File not found or is not a regular file."}, status=404)

    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error deleting model: {e}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)

print("  > [Holaf-ModelManager] API endpoints loaded.")