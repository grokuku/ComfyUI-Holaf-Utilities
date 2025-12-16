# === Documentation ===
# Developer: Gemini (AI Assistant), under the direction of Holaf
# Date: 2025-05-23 (Refactored: YYYY-MM-DD)
#
# Purpose:
# Main entry point for 'ComfyUI-Holaf-Utilities'. Initializes submodules,
# registers API routes, and loads custom nodes.
#
# Refactor Notes:
# - Core functionalities (DB, Config, Terminal, Image Viewer, System Monitor, Utils)
#   have been moved to separate modules for better organization.
# - This file now primarily handles imports, initialization calls, route registration,
#   and dynamic loading of nodes from the 'nodes' subdirectory.
# === End Documentation ===

import server
import os
import sys
import asyncio
import json
import traceback
import threading
import importlib.util
import folder_paths # ComfyUI global
from aiohttp import web
import time # For time.sleep in periodic task wrapper
import re # Added for finalize_upload_model_route for subfolder splitting

# import atexit # Option pour le futur

# --- Holaf Utilities Submodules ---
from . import holaf_database
from . import holaf_config
from . import holaf_utils # Also initializes its dirs and cleans up temp uploads
from . import holaf_terminal
from . import holaf_image_viewer_backend
from . import holaf_system_monitor
from . import holaf_server_management

# --- Holaf Node Helpers (Assumed to be in ./nodes/) ---
# These are facades for actual logic in the nodes/ directory
# If these files don't exist or don't have these functions,
# the related routes will fail.
try:
    from .nodes import holaf_model_manager as model_manager_helper
except ImportError:
    print("🔴 [Holaf-Init] 'nodes/holaf_model_manager.py' not found or incomplete. Model Manager features may fail.")
    model_manager_helper = None

try:
    from .nodes import holaf_nodes_manager as nodes_manager_helper
except ImportError:
    print("🔴 [Holaf-Init] 'nodes/holaf_nodes_manager.py' not found or incomplete. Nodes Manager features may fail.")
    nodes_manager_helper = None

# --- Global Application Configuration ---
# Loaded once and can be updated by config saving routes
CONFIG = {}

def reload_global_config():
    global CONFIG
    CONFIG = holaf_config.load_all_configs()

# --- Initialization ---
print("--- Initializing Holaf Utilities ---")
holaf_database.init_database()
reload_global_config() # Load initial config


# --- MODIFICATION START: Remove SaveImage patch ---
# The patch has been removed and replaced by a robust filesystem watcher.
print("🔵 [Holaf-Init] Live image updates now handled by Filesystem Watcher.")
# --- MODIFICATION END ---

# --- STANDALONE GALLERY HTML TEMPLATE ---
# Defines the separate window structure with CORRECT PATHS
GALLERY_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Holaf Gallery</title>
    <link rel="stylesheet" href="/extensions/ComfyUI-Holaf-Utilities/css/holaf_image_viewer.css">
    <style>
        /* Shim for ComfyUI variables to maintain dark theme */
        :root {
            --bg-color: #202020;
            --comfy-menu-bg: #353535;
            --comfy-input-bg: #222;
            --input-text: #ddd;
            --descrip-text: #999;
            --drag-text: #ccc;
            --error-text: #ff4444;
            --border-color: #4e4e4e;
            --holaf-accent-color: #236696;
            --holaf-bg-color: #2b2b2b;
            --holaf-text-color: #eeeeee;
            --holaf-border-radius: 4px;
        }
        body {
            background-color: var(--bg-color);
            color: var(--holaf-text-color);
            margin: 0;
            padding: 0;
            font-family: sans-serif;
            overflow: hidden; /* Gallery handles scroll */
        }
        /* Hide the close button in standalone mode */
        #holaf-viewer-close-btn { display: none !important; }
        
        /* Ensure modal content takes full screen */
        .holaf-modal-content {
            width: 100vw !important;
            height: 100vh !important;
            max-width: none !important;
            max-height: none !important;
            border: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
        }
        .holaf-modal {
            padding: 0 !important;
            background: transparent !important;
        }
    </style>
</head>
<body>
    <!-- The script will inject the gallery UI here -->
    <script type="module">
        import { initStandaloneGallery } from '/extensions/ComfyUI-Holaf-Utilities/holaf_image_viewer.js';
        // Initialize immediately
        initStandaloneGallery();
    </script>
</body>
</html>
"""

# --- API Route Definitions ---
routes = server.PromptServer.instance.routes

# --- NEW ROUTE: Standalone Gallery View ---
@routes.get("/holaf/view")
async def gallery_view_route(request: web.Request):
    return web.Response(text=GALLERY_HTML, content_type='text/html')
# ------------------------------------------

# Shared/Utility Routes
@routes.get("/holaf/utilities/settings")
async def holaf_get_all_settings_route(request: web.Request):
    current_live_config = CONFIG # Use the live global CONFIG
    password_is_set = current_live_config.get('password_hash') is not None
    response_data = {
        "password_is_set": password_is_set,
        "Terminal": {"shell_command": current_live_config.get('shell_command')},
        "TerminalUI": current_live_config.get('ui_terminal'),
        "ModelManagerUI": current_live_config.get('ui_model_manager'),
        "ImageViewerUI": current_live_config.get('ui_image_viewer'),
        "NodesManagerUI": current_live_config.get('ui_nodes_manager'),
        "SystemMonitor": current_live_config.get('monitor')
    }
    return web.json_response(response_data)

@routes.post("/holaf/utilities/save-all-settings")
async def holaf_save_all_settings_route(request: web.Request):
    try:
        data = await request.json()
        await holaf_config.save_bulk_settings_to_config(data)
        reload_global_config() # Reload to reflect changes in the live CONFIG
        return web.json_response({"status": "ok", "message": "All settings saved."})
    except Exception as e:
        print(f"🔴 [Holaf-Init] Error saving all settings: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.post("/holaf/utilities/restart")
async def holaf_restart_server_route(request: web.Request):
    return await holaf_server_management.restart_server_route(request)

# Terminal Routes
@routes.post("/holaf/terminal/set-password")
async def holaf_terminal_set_password_route(request: web.Request):
    return await holaf_terminal.set_password_route(request, CONFIG)

@routes.post("/holaf/terminal/auth")
async def holaf_terminal_auth_route(request: web.Request):
    return await holaf_terminal.auth_route(request, CONFIG)

@routes.get("/holaf/terminal") # WebSocket
async def holaf_terminal_websocket_route(request: web.Request):
    return await holaf_terminal.websocket_handler(request, CONFIG)

@routes.post("/holaf/terminal/save-settings")
async def holaf_terminal_save_ui_settings_route(request: web.Request):
    try:
        data = await request.json()
        async with holaf_config.CONFIG_LOCK:
            config_parser_obj = holaf_config.get_config_parser()
            section = 'TerminalUI'
            if not config_parser_obj.has_section(section): config_parser_obj.add_section(section)

            for key, value_type in [('theme', str), ('font_size', int),
                                    ('panel_width', int), ('panel_height', int),
                                    ('panel_is_fullscreen', bool)]:
                if key in data:
                    val = data[key]
                    config_parser_obj.set(section, key, str(val))
                    if CONFIG.get('ui_terminal'): CONFIG['ui_terminal'][key] = value_type(val)

            for key_pos in ['panel_x', 'panel_y']:
                 if key_pos in data:
                    val = data[key_pos]
                    if val is not None:
                        config_parser_obj.set(section, key_pos, str(val))
                        if CONFIG.get('ui_terminal'): CONFIG['ui_terminal'][key_pos] = int(val)
                    else:
                        if config_parser_obj.has_option(section, key_pos): config_parser_obj.remove_option(section, key_pos)
                        if CONFIG.get('ui_terminal'): CONFIG['ui_terminal'][key_pos] = None

            with open(holaf_config.get_config_path(), 'w') as cf: config_parser_obj.write(cf)
        reload_global_config()
        return web.json_response({"status": "ok", "message": "Terminal UI settings saved."})
    except Exception as e:
        print(f"🔴 Error saving Terminal UI settings: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# Model Manager Routes (thin wrappers around model_manager_helper)
MODEL_TYPES_CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'model_types.json')

@routes.get("/holaf/models/config")
async def get_model_types_config_route(request: web.Request):
    if not os.path.exists(MODEL_TYPES_CONFIG_PATH):
        return web.json_response({"error": "model_types.json not found"}, status=404)
    with open(MODEL_TYPES_CONFIG_PATH, 'r', encoding='utf-8') as f:
        return web.json_response(json.load(f))

@routes.post("/holaf/models/upload-chunk")
async def upload_model_chunk_route(request: web.Request):
    try:
        data = await request.post()
        upload_id = holaf_utils.sanitize_upload_id(data.get('upload_id'))
        chunk_idx = data.get('chunk_index')
        file_chunk = data.get('file_chunk')
        if not all([upload_id, chunk_idx, file_chunk]):
            return web.json_response({"status": "error", "message": "Missing fields."}, status=400)
        chunk_path = os.path.join(holaf_utils.TEMP_UPLOAD_DIR, f"{upload_id}-{chunk_idx}.chunk")
        if not os.path.normpath(chunk_path).startswith(os.path.normpath(holaf_utils.TEMP_UPLOAD_DIR)):
             return web.json_response({"status": "error", "message": "Invalid chunk path."}, status=400)
        with open(chunk_path, 'wb') as f: f.write(file_chunk.file.read())
        return web.json_response({"status": "ok", "message": f"Chunk {chunk_idx} received."})
    except Exception as e:
        print(f"🔴 Error processing chunk: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.post("/holaf/models/finalize-upload")
async def finalize_upload_model_route(request: web.Request):
    try:
        data = await request.json()
        upload_id = holaf_utils.sanitize_upload_id(data.get('upload_id'))
        filename_orig = data.get('filename')
        total_chunks = data.get('total_chunks')
        dest_type = data.get('destination_type')
        subfolder = data.get('subfolder', '')
        # MODIFIED: Get only expected size from the request
        expected_size = data.get('expected_size')
        # expected_sha256 removed

        # MODIFIED: Update validation to remove checksum
        if not all([upload_id, filename_orig, total_chunks, dest_type, expected_size]):
            return web.json_response({"status": "error", "message": "Missing fields, including expected size."}, status=400)

        filename = holaf_utils.sanitize_filename(filename_orig)
        if not filename: return web.json_response({"status": "error", "message": "Invalid filename."}, status=400)

        base_paths = folder_paths.get_folder_paths(dest_type)
        if not base_paths: return web.json_response({"error": f"Invalid dest type '{dest_type}'"}, status=400)

        # Use re.split for subfolder to handle both / and \
        final_subfolder_parts = [p for p in map(holaf_utils.sanitize_directory_component, re.split(r'[/\\]', subfolder)) if p]
        final_dest_dir = os.path.join(os.path.normpath(base_paths[0]), *final_subfolder_parts)
        final_save_path = os.path.normpath(os.path.join(final_dest_dir, filename))

        comfy_base = os.path.normpath(folder_paths.base_path)
        rel_save_path = os.path.relpath(final_save_path, comfy_base).replace(os.sep, '/')

        if model_manager_helper and not model_manager_helper.is_path_safe(rel_save_path, is_directory_model=False):
             return web.json_response({"status": "error", "message": "Save path outside allowed model dirs."}, status=403)
        if os.path.exists(final_save_path):
            return web.json_response({"status": "error", "message": "File already exists."}, status=409)

        def on_assembly_done():
            if model_manager_helper and hasattr(model_manager_helper, 'scan_and_update_db'):
                threading.Timer(1.0, model_manager_helper.scan_and_update_db).start()

        loop = asyncio.get_event_loop()
        # MODIFIED: Pass only expected_size to the assembly function
        await loop.run_in_executor(None, holaf_utils.assemble_chunks_blocking,
                                   final_save_path, upload_id, total_chunks, on_assembly_done,
                                   expected_size)
        return web.json_response({"status": "ok", "message": f"Finalization for '{filename}' started."})
    except Exception as e:
        print(f"🔴 Error finalizing upload: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

if model_manager_helper:
    @routes.get("/holaf/models")
    async def get_models_route(request: web.Request):
        try:
            models = model_manager_helper.get_all_models_from_db()
            return web.json_response(models)
        except Exception as e:
            print(f"🔴 [MM] Error fetching models: {e}"); traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @routes.post("/holaf/models/deep-scan-local")
    async def model_deep_scan_route(request: web.Request):
        try:
            data = await request.json()
            paths = data.get("paths")
            if not paths or not isinstance(paths, list):
                return web.json_response({"error": "'paths' list required."}, status=400)
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(None, model_manager_helper.process_deep_scan_request, paths)
            return web.json_response({"status": "ok", "details": results})
        except Exception as e:
            print(f"🔴 [MM] Error deep scanning: {e}"); traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @routes.post("/holaf/models/delete") # This is for Model Manager, distinct from Image Viewer delete
    async def delete_model_route(request: web.Request):
        try:
            data = await request.json()
            paths = data.get("paths", [])
            # Ensure this calls the correct helper if/when implemented for models
            if model_manager_helper and hasattr(model_manager_helper, 'delete_models_from_db_and_disk'):
                # results = await loop.run_in_executor(None, model_manager_helper.delete_models_from_db_and_disk, paths)
                # return web.json_response(results)
                pass # Placeholder for actual model deletion logic
            print(f"🟡 [MM] Delete route called for model paths: {paths}. Full deletion logic should be in model_manager_helper.")
            return web.json_response({"status": "warning", "message": "Model delete function stubbed. See model_manager_helper.", "details": {"deleted_count":0, "errors":[]}})
        except Exception as e:
            print(f"🔴 [MM] Error deleting models: {e}"); traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @routes.post("/holaf/model-manager/save-settings")
    async def model_manager_save_ui_settings_route(request: web.Request):
        try:
            data = await request.json()
            async with holaf_config.CONFIG_LOCK:
                cp = holaf_config.get_config_parser()
                s = 'ModelManagerUI'
                if not cp.has_section(s): cp.add_section(s)

                map_cfg = {'theme': str, 'panel_width': int, 'panel_height': int,
                           'filter_type': str, 'filter_search_text': str,
                           'sort_column': str, 'sort_order': str, 'zoom_level': float,
                           'panel_is_fullscreen': bool}
                for k, v_type in map_cfg.items():
                    if k in data:
                        val = data[k]
                        cp.set(s, k, str(val))
                        if CONFIG.get('ui_model_manager'): CONFIG['ui_model_manager'][k] = v_type(val)
                for k_pos in ['panel_x', 'panel_y']:
                    if k_pos in data:
                        val = data[k_pos]
                        if val is not None:
                            cp.set(s, k_pos, str(val))
                            if CONFIG.get('ui_model_manager'): CONFIG['ui_model_manager'][k_pos] = int(val)
                        else:
                            if cp.has_option(s,k_pos): cp.remove_option(s,k_pos)
                            if CONFIG.get('ui_model_manager'): CONFIG['ui_model_manager'][k_pos] = None
                with open(holaf_config.get_config_path(), 'w') as cf: cp.write(cf)
            reload_global_config()
            return web.json_response({"status": "ok", "message": "Model Manager UI settings saved."})
        except Exception as e:
            print(f"🔴 Error saving MM UI settings: {e}"); traceback.print_exc()
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @routes.post("/holaf/models/download-chunk")
    async def download_model_chunk_route(request: web.Request):
        try:
            data = await request.json()
            path_canon = data.get("path")
            chunk_index = int(data.get("chunk_index"))
            chunk_size = int(data.get("chunk_size"))

            if not model_manager_helper.is_path_safe(path_canon, is_directory_model=False):
                return web.Response(status=403, text="Access forbidden.")

            comfy_base = os.path.normpath(folder_paths.base_path)
            is_abs = path_canon.startswith('/') or (os.name == 'nt' and len(path_canon) > 1 and path_canon[1] == ':')
            abs_model_path = os.path.normpath(path_canon if is_abs else os.path.join(comfy_base, path_canon))

            if not os.path.isfile(abs_model_path):
                return web.Response(status=404, text="Model file not found.")

            offset = chunk_index * chunk_size
            chunk_data = await holaf_utils.read_file_chunk(abs_model_path, offset, chunk_size)
            if chunk_data is None: raise IOError("File could not be read.")
            return web.Response(body=chunk_data, content_type='application/octet-stream')
        except Exception as e:
            print(f"🔴 [MM] Error downloading chunk: {e}"); traceback.print_exc()
            return web.Response(status=500, text=str(e))

# --- Image Viewer Routes ---
@routes.get("/holaf/images/filter-options")
async def iv_filter_options_route(r): return await holaf_image_viewer_backend.get_filter_options_route(r)

@routes.post("/holaf/images/list")
async def iv_list_images_route(r): return await holaf_image_viewer_backend.list_images_route(r)

@routes.get("/holaf/images/thumbnail")
async def iv_get_thumbnail_route(r): return await holaf_image_viewer_backend.get_thumbnail_route(r)

@routes.get("/holaf/images/metadata")
async def iv_get_metadata_route(r): return await holaf_image_viewer_backend.get_metadata_route(r)

# --- MODIFICATION START: Add route for checking last update time ---
@routes.get("/holaf/images/last-update-time")
async def iv_get_last_update_time_route(request: web.Request):
    return web.json_response({"last_update": holaf_image_viewer_backend.logic.LAST_DB_UPDATE_TIME})
# --- MODIFICATION END ---


# Image Viewer Actions
@routes.post("/holaf/images/delete")
async def iv_delete_images_route(r): return await holaf_image_viewer_backend.delete_images_route(r)

@routes.post("/holaf/images/delete-permanently")
async def iv_delete_images_permanently_route(r): return await holaf_image_viewer_backend.delete_images_permanently_route(r)

@routes.post("/holaf/images/restore")
async def iv_restore_images_route(r): return await holaf_image_viewer_backend.restore_images_route(r)

@routes.post("/holaf/images/empty-trashcan")
async def iv_empty_trashcan_route(r): return await holaf_image_viewer_backend.empty_trashcan_route(r)

@routes.post("/holaf/images/extract-metadata")
async def iv_extract_metadata_route(r): return await holaf_image_viewer_backend.extract_metadata_route(r)

@routes.post("/holaf/images/inject-metadata")
async def iv_inject_metadata_route(r): return await holaf_image_viewer_backend.inject_metadata_route(r)

@routes.post("/holaf/images/prepare-export")
async def iv_prepare_export_route(r): return await holaf_image_viewer_backend.prepare_export_route(r)

@routes.get("/holaf/images/export-chunk")
async def iv_download_export_chunk_route(r): return await holaf_image_viewer_backend.download_export_chunk_route(r)

# --- MODIFICATION START: Add new edit routes ---
@routes.get("/holaf/images/load-edits")
async def iv_load_edits_route(r): return await holaf_image_viewer_backend.load_edits_route(r)

@routes.post("/holaf/images/save-edits")
async def iv_save_edits_route(r): return await holaf_image_viewer_backend.save_edits_route(r)

@routes.post("/holaf/images/delete-edits")
async def iv_delete_edits_route(r): return await holaf_image_viewer_backend.delete_edits_route(r)

@routes.post("/holaf/images/process-video") # <-- NEW: Register Process Video
async def iv_process_video_route(r): return await holaf_image_viewer_backend.process_video_route(r)

@routes.post("/holaf/images/rollback-video") # <-- NEW: Register Rollback
async def iv_rollback_video_route(r): return await holaf_image_viewer_backend.rollback_video_route(r)

@routes.post("/holaf/images/maintenance/sync-database")
async def iv_sync_database_route(r): return await holaf_image_viewer_backend.sync_database_route(r)

@routes.post("/holaf/images/maintenance/clean-thumbnails")
async def iv_clean_thumbnails_route(r): return await holaf_image_viewer_backend.clean_thumbnails_route(r)
# --- MODIFICATION END ---

# Image Viewer Thumbnail Worker and Stats
@routes.post("/holaf/images/viewer-activity")
async def iv_set_viewer_activity_route(r): return await holaf_image_viewer_backend.set_viewer_activity_route(r)

@routes.post("/holaf/images/prioritize-thumbnails")
async def iv_prioritize_thumbnails_route(r): return await holaf_image_viewer_backend.prioritize_thumbnails_route(r)

# <-- MODIFICATION START: Nouvelle route pour la régénération de miniature -->
@routes.post('/holaf/images/regenerate-thumbnail')
async def iv_regenerate_thumbnail_route(r):
    return await holaf_image_viewer_backend.regenerate_thumbnail_route(r)
# <-- MODIFICATION END -->

@routes.get("/holaf/images/thumbnail-stats")
async def iv_thumbnail_stats_route(r): return await holaf_image_viewer_backend.iv_get_thumbnail_stats_route(r)

@routes.post("/holaf/image-viewer/save-settings")
async def image_viewer_save_ui_settings_route(request: web.Request):
    try:
        data = await request.json()
        async with holaf_config.CONFIG_LOCK:
            cp = holaf_config.get_config_parser()
            s = 'ImageViewerUI'
            if not cp.has_section(s): cp.add_section(s)

            # Consolidate panel dimension keys
            pos_x = data.get('panel_x', data.get('x'))
            pos_y = data.get('panel_y', data.get('y'))
            width = data.get('panel_width', data.get('width'))
            height = data.get('panel_height', data.get('height'))

            # Handle panel position and size
            if pos_x is not None: cp.set(s, 'panel_x', str(int(pos_x)))
            else:
                if cp.has_option(s, 'panel_x'): cp.remove_option(s, 'panel_x')
            if pos_y is not None: cp.set(s, 'panel_y', str(int(pos_y)))
            else:
                if cp.has_option(s, 'panel_y'): cp.remove_option(s, 'panel_y')
            if width is not None: cp.set(s, 'panel_width', str(int(width)))
            if height is not None: cp.set(s, 'panel_height', str(int(height)))
            
            # Handle other specific settings
            keys_to_save = [
                'panel_is_fullscreen', 'thumbnail_fit', 'thumbnail_size', 'theme', 
                'export_format', 'export_include_meta', 'export_meta_method',
                'search_text', 'search_scope_name', 'search_scope_prompt', 'search_scope_workflow',
                'workflow_filter_internal', 'workflow_filter_external'
            ]
            for key in keys_to_save:
                if key in data:
                    cp.set(s, key, str(data[key]))

            # Handle date keys separately for case consistency (JS: startDate, INI: startdate)
            if 'startDate' in data:
                cp.set(s, 'startdate', str(data['startDate']))
            if 'endDate' in data:
                cp.set(s, 'enddate', str(data['endDate']))
            
            # Handle list-type settings
            if 'folder_filters' in data and isinstance(data['folder_filters'], list):
                cp.set(s, 'folder_filters', json.dumps(data['folder_filters'])) # Store as JSON string
            if 'format_filters' in data and isinstance(data['format_filters'], list):
                cp.set(s, 'format_filters', json.dumps(data['format_filters'])) # Store as JSON string
            # --- CORRECTIF : Ajouter la sauvegarde de locked_folders ---
            if 'locked_folders' in data and isinstance(data['locked_folders'], list):
                cp.set(s, 'locked_folders', json.dumps(data['locked_folders'])) # Store as JSON string

            with open(holaf_config.get_config_path(), 'w') as cf: cp.write(cf)
        reload_global_config() # Reload to reflect changes in the live CONFIG
        return web.json_response({"status": "ok", "message": "Image Viewer settings saved."})
    except Exception as e:
        print(f"🔴 Error saving IV UI settings: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# Nodes Manager Routes (thin wrappers, assuming nodes_manager_helper exists)
if nodes_manager_helper:
    @routes.get("/holaf/nodes/list")
    async def nm_get_list_route(r):
        try:
            loop = asyncio.get_event_loop()
            node_list = await loop.run_in_executor(None, nodes_manager_helper.scan_custom_nodes)
            return web.json_response({"nodes": node_list})
        except Exception as e: print(f"🔴 [NM] Error list: {e}"); return web.json_response({"error":str(e)},500)

    async def _handle_node_action_batch(request: web.Request, action_func_name: str):
        try:
            data = await request.json()
            payloads = data.get("node_payloads", data.get("node_names", [])) # Accept old and new payload keys
            if not payloads: return web.json_response({"error": "No nodes specified"}, status=400)

            items_to_process = []
            # Standardize payload to a list of dicts
            for p_item in payloads:
                if isinstance(p_item, dict) and "name" in p_item: # New format: {"name": "...", "repo_url_override": "..."}
                    items_to_process.append(p_item)
                elif isinstance(p_item, str): # Old format: "node_name"
                    items_to_process.append({"name": p_item, "repo_url_override": None}) # Convert to new format

            results = []
            loop = asyncio.get_event_loop()
            action_func = getattr(nodes_manager_helper, action_func_name)

            for item_data in items_to_process:
                node_name = item_data["name"]
                if action_func_name == "update_node_from_git":
                     # Pass repo_url_override if present, otherwise it will be None and helper handles default
                     result = await loop.run_in_executor(None, action_func, node_name, item_data.get("repo_url_override"))
                else:
                     result = await loop.run_in_executor(None, action_func, node_name) # Other actions don't need repo_url
                results.append({"node_name": node_name, **result}) # Merge node_name with result dict

            all_ok = all(r.get('status') == 'success' for r in results)
            any_ok = any(r.get('status') == 'success' for r in results)
            http_status = 200 if all_ok else (207 if any_ok else 400) # 207 Multi-Status if some succeed
            overall_status = "ok" if all_ok else ("partial_success" if any_ok else "error")
            return web.json_response({"status": overall_status, "details": results}, status=http_status)

        except Exception as e: print(f"🔴 [NM] Batch action error: {e}"); return web.json_response({"error":str(e)},500)

    @routes.post("/holaf/nodes/update")
    async def nm_update_route(r): return await _handle_node_action_batch(r, "update_node_from_git")
    @routes.post("/holaf/nodes/delete")
    async def nm_delete_route(r): return await _handle_node_action_batch(r, "delete_node_folder")
    @routes.post("/holaf/nodes/install-requirements")
    async def nm_install_req_route(r): return await _handle_node_action_batch(r, "install_node_requirements")

    @routes.get("/holaf/nodes/readme/local/{node_name}")
    async def nm_get_local_readme(request: web.Request):
        try:
            node_name = request.match_info.get('node_name', "")
            loop = asyncio.get_event_loop()
            content = await loop.run_in_executor(None, nodes_manager_helper.get_local_readme_content, node_name)
            return web.Response(text=content, content_type='text/plain', charset='utf-8')
        except Exception as e: return web.Response(text=str(e), status=500)

    @routes.post("/holaf/nodes/readme/github")
    async def nm_get_github_readme(request: web.Request):
        try:
            data = await request.json()
            content = await nodes_manager_helper.get_github_readme_content(data.get("owner"), data.get("repo"))
            return web.Response(text=content, content_type='text/plain', charset='utf-8')
        except Exception as e: return web.Response(text=str(e), status=500)

    @routes.get("/holaf/nodes/search/github/{node_name}")
    async def nm_search_github(request: web.Request):
        try:
            node_name = request.match_info.get('node_name', "")
            repo_url = await nodes_manager_helper.search_github_for_repo(node_name)
            return web.json_response({"url": repo_url})
        except Exception as e: return web.json_response({"error": str(e)}, status=500)


# System Monitor Routes
@routes.get("/holaf/monitor/ws") # WebSocket
async def holaf_monitor_websocket_route(request: web.Request):
    return await holaf_system_monitor.websocket_handler(request, CONFIG)


# --- Dynamic Node Loading from 'nodes/' directory ---
NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = {}, {}
nodes_dir_path = os.path.join(os.path.dirname(__file__), "nodes")
if os.path.isdir(nodes_dir_path):
    for filename in os.listdir(nodes_dir_path):
        if filename.endswith(".py") and not filename.startswith("__"):
            module_name = f"ComfyUI-Holaf-Utilities.nodes.{os.path.splitext(filename)[0]}"
            full_module_path_for_spec = os.path.join(nodes_dir_path, filename)
            try:
                spec = importlib.util.spec_from_file_location(module_name, full_module_path_for_spec)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    sys.modules[module_name] = module # Add to sys.modules before exec_module
                    spec.loader.exec_module(module)
                    if hasattr(module, "NODE_CLASS_MAPPINGS"):
                        NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS)
                        print(f"  > Loaded nodes from: {filename}")
                    if hasattr(module, "NODE_DISPLAY_NAME_MAPPINGS"):
                        NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)
                else:
                    print(f"🔴 [Holaf-Init] Could not create spec for module: {filename}")
            except Exception as e:
                print(f"🔴 [Holaf-Init] Error loading node module {filename}: {e}", file=sys.stderr)
                traceback.print_exc()
else:
    print("🟡 [Holaf-Init] 'nodes' directory not found. No additional custom nodes loaded.")


# --- ComfyUI Extension Registration ---
WEB_DIRECTORY = "js"

# --- Background Periodic Tasks & Worker Threads ---
stop_event = threading.Event()
all_background_threads = [] # Keep track of threads for cleaner shutdown if needed

def _periodic_task_wrapper(interval_seconds, task_func, *args, **kwargs):
    def task_loop():
        initial_delay = kwargs.pop('initial_delay', 0)
        if initial_delay > 0:
             if stop_event.wait(initial_delay): return # Exit if stop_event set during delay

        while not stop_event.is_set():
            try:
                task_func(*args, **kwargs)
            except Exception as e:
                print(f"🔴 [Holaf-Periodic] Error in '{task_func.__name__}': {e}")
                traceback.print_exc()
            if stop_event.wait(interval_seconds): break # Exit if stop_event set during wait

    thread = threading.Thread(target=task_loop, daemon=True)
    thread.start()
    all_background_threads.append(thread) # Add to list
    return thread

# --- MODIFICATION START: Consolidate worker startups ---
thumbnail_worker_thread_ref = None
filesystem_workers_started = False

def start_thumbnail_worker():
    global thumbnail_worker_thread_ref
    if thumbnail_worker_thread_ref is None or not thumbnail_worker_thread_ref.is_alive():
        print("🔵 [Holaf-Init] Starting Thumbnail Generation Worker thread...")
        thumbnail_worker_thread_ref = threading.Thread(
            target=holaf_image_viewer_backend.worker.run_thumbnail_generation_worker,
            args=(stop_event,), daemon=True, name="HolafThumbWorker"
        )
        thumbnail_worker_thread_ref.start()
        all_background_threads.append(thumbnail_worker_thread_ref)
    else:
        print("🟡 [Holaf-Init] Thumbnail Generation Worker thread already running.")

def start_filesystem_workers():
    global filesystem_workers_started
    if not filesystem_workers_started:
        print("🔵 [Holaf-Init] Starting Filesystem Watcher workers...")
        
        monitor_thread = threading.Thread(
            target=holaf_image_viewer_backend.worker.run_filesystem_monitor,
            args=(stop_event,), daemon=True, name="HolafFsMonitor"
        )
        processor_thread = threading.Thread(
            target=holaf_image_viewer_backend.worker.run_event_queue_processor,
            args=(stop_event,), daemon=True, name="HolafFsProcessor"
        )

        monitor_thread.start()
        processor_thread.start()
        
        all_background_threads.extend([monitor_thread, processor_thread])
        filesystem_workers_started = True
    else:
        print("🟡 [Holaf-Init] Filesystem Watcher workers already running.")
# --- MODIFICATION END ---


def shutdown_tasks():
    print("🔵 [Holaf-Init] Signaling background tasks and workers to stop...")
    stop_event.set()
    print("🔵 [Holaf-Init] Shutdown signal process complete.")

try:
    if hasattr(server.PromptServer.instance, "add_on_shutdown"):
        server.PromptServer.instance.add_on_shutdown(shutdown_tasks)
        print("🔵 [Holaf-Init] Registered shutdown_tasks with ComfyUI server.")
    else:
        print("🟡 [Holaf-Init] server.add_on_shutdown not available. Background tasks will rely on daemon status for exit.")
except AttributeError:
    print("🟡 [Holaf-Init] AttributeError registering shutdown_tasks. Background tasks will rely on daemon status for exit.")


print("🔵 [Holaf-Init] Scheduling startup and periodic background tasks...")

# Model Manager initial scan
if model_manager_helper and hasattr(model_manager_helper, 'scan_and_update_db'):
    _periodic_task_wrapper(3600, model_manager_helper.scan_and_update_db, initial_delay=5.0)
else:
    print("🟡 [Holaf-Init] Model Manager scan_and_update_db not available for scheduling.")

_periodic_task_wrapper(300.0, holaf_image_viewer_backend.sync_image_database_blocking, initial_delay=10.0)

# --- MODIFICATION START: Correctly schedule all image viewer workers ---
thumbnail_startup_timer = threading.Timer(15.0, start_thumbnail_worker)
thumbnail_startup_timer.daemon = True
thumbnail_startup_timer.start()

filesystem_startup_timer = threading.Timer(16.0, start_filesystem_workers)
filesystem_startup_timer.daemon = True
filesystem_startup_timer.start()
# --- MODIFICATION END ---


# --- Final Initialization Message ---
print("\n" + "="*50)
print("✅ [Holaf-Utilities] Extension initialized with modular structure.")
final_config = CONFIG # Use the reloaded global CONFIG
print(f"  > Terminal Shell: {final_config.get('shell_command', 'N/A')}")
if final_config.get('password_hash'):
    print("  > Terminal Status: 🔑 Password is set.")
else:
    print("  > Terminal Status: 🔵 No password set. Setup required.")
if not NODE_CLASS_MAPPINGS:
    print("  > Additional Nodes: None found or loaded from 'nodes/' directory.")
print("="*50 + "\n")
sys.stdout.flush()

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']