# === Holaf Utilities - Image Viewer API Routes (Utility) ===
import json
import traceback
import asyncio
from aiohttp import web

# Imports from this package's modules
from .. import worker # For viewer_is_active
from .. import logic # For maintenance tasks

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