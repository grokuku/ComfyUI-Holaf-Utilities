# === Holaf Utilities - Image Viewer API Routes (Utility) ===
import json
import traceback

from aiohttp import web

# Imports from this package's modules
from .. import worker # For viewer_is_active

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