# === Holaf Utilities - Server Management ===
import os
import sys
import time
import threading
from aiohttp import web

def _do_restart_blocking():
    """This function is run in a separate thread to allow the server to respond before restarting."""
    print("🔵 [Holaf-ServerMgmt] Server restart requested. Waiting 1 second...")
    time.sleep(1)
    print("🔴 [Holaf-ServerMgmt] RESTARTING NOW...")
    try:
        # sys.executable is the path to the current Python interpreter
        # sys.argv is the list of arguments used to start the current script
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception as e:
        print(f"🔴 [Holaf-ServerMgmt] CRITICAL: Restart via os.execv failed: {e}")

async def restart_server_route(request: web.Request):
    restart_thread = threading.Thread(target=_do_restart_blocking, daemon=True)
    restart_thread.start()
    return web.json_response({"status": "ok", "message": "Restart command received and scheduled."})