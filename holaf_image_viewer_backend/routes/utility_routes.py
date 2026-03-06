# === Holaf Utilities - Image Viewer API Routes (Utility) ===
import json
import traceback
import asyncio
from aiohttp import web

# Imports from this package's modules
from .. import worker # For viewer_is_active
from .. import logic # For maintenance tasks

# Import Node Manager Logic (from root/nodes/holaf_nodes_manager.py)
# Using relative import based on: routes/ -> backend/ -> root/ -> nodes/
try:
    from ...nodes import holaf_nodes_manager
except ImportError:
    # Fallback/Safety in case of package structure variation, though '...' works for siblings like holaf_database
    print("🔴 [Holaf-Routes] Could not import holaf_nodes_manager. Node actions may fail.")

# --- API Route Handlers ---
async def set_viewer_activity_route(request: web.Request):
    try:
        data = await request.json()
        is_active = data.get("active", False)
        if not isinstance(is_active, bool):
            return web.json_response({"status": "error", "message": "'active' must be boolean"}, status=400)
        # Modify the state in the imported worker module
        worker.viewer_is_active = is_active
        return web.json_response({"status": "ok", "viewer_active": worker.viewer_is_active})
    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in set_viewer_activity_route: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def sync_database_route(request: web.Request):
    """Route to trigger a full database sync."""
    try:
        loop = asyncio.get_event_loop()
        # Run the blocking sync function in a thread pool executor
        await loop.run_in_executor(None, logic.sync_image_database_blocking)
        return web.json_response({
            "status": "ok", 
            "message": "Database synchronization process completed successfully."
        })
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error triggering database sync: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def clean_thumbnails_route(request: web.Request):
    """Route to trigger a full thumbnail cleanup."""
    try:
        loop = asyncio.get_event_loop()
        # Run the blocking clean function in a thread pool executor
        result = await loop.run_in_executor(None, logic.clean_thumbnails_blocking)
        
        if "error" in result:
             return web.json_response({"status": "error", "message": result["error"]}, status=500)

        return web.json_response({
            "status": "ok",
            "message": "Thumbnail cleanup process completed.",
            "details": result
        })
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error triggering thumbnail cleanup: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# --- NEW: Node Manager Routes ---

async def install_custom_node_route(request: web.Request):
    """Route to install a custom node from a Git URL."""
    try:
        data = await request.json()
        url = data.get("url")
        
        if not url:
            return web.json_response({"status": "error", "message": "URL is required."}, status=400)
            
        loop = asyncio.get_event_loop()
        # Execute the blocking git clone operation in a thread
        result = await loop.run_in_executor(None, holaf_nodes_manager.install_custom_node, url)
        
        if result.get("status") == "error":
            return web.json_response(result, status=500)
            
        return web.json_response(result)
        
    except Exception as e:
        print(f"🔴 [Holaf-NodesManager] Error in install route: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def search_custom_nodes_route(request: web.Request):
    """Route to search for custom nodes on GitHub."""
    try:
        data = await request.json()
        query = data.get("query")
        
        if not query:
            return web.json_response({"status": "error", "message": "Query is required."}, status=400)
            
        # This function is async in holaf_nodes_manager, so we await it directly
        result = await holaf_nodes_manager.search_custom_nodes(query)
        
        if "error" in result:
             return web.json_response(result, status=500)
             
        return web.json_response(result)
        
    except Exception as e:
        print(f"🔴 [Holaf-NodesManager] Error in search route: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)