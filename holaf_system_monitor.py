# === Holaf Utilities - System Monitor ===
import asyncio
import os
import platform
import subprocess
import time
import json
import traceback
import psutil # Requires psutil
from aiohttp import web

IS_WINDOWS = platform.system() == "Windows"
NVIDIA_SMI_PATH = "nvidia-smi"
if IS_WINDOWS:
    prog_files_smi = os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), 
                                  "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")
    if os.path.exists(prog_files_smi):
        NVIDIA_SMI_PATH = prog_files_smi

# Initialize psutil's cpu_percent. First call is blocking or returns 0.0
try:
    psutil.cpu_percent(interval=None) 
except Exception as e:
    print(f"🟡 [Holaf-SysMon] Warning: psutil.cpu_percent(interval=None) failed on init: {e}")

MONITOR_ACTIVE_WEBSOCKETS = set()

def _get_system_stats_blocking():
    stats = {
        "cpu_percent": 0.0,
        "ram": {"percent": 0.0, "used_gb": 0.0, "total_gb": 0.0},
        "gpus": [],
        "timestamp": time.time()
    }
    try:
        stats["cpu_percent"] = psutil.cpu_percent(interval=0.1) 
        mem = psutil.virtual_memory()
        stats["ram"]["percent"] = mem.percent
        stats["ram"]["used_gb"] = round(mem.used / (1024**3), 2)
        stats["ram"]["total_gb"] = round(mem.total / (1024**3), 2)

        try:
            # Check nvidia-smi availability
            subprocess.check_output([NVIDIA_SMI_PATH, "-L"], universal_newlines=True, stderr=subprocess.DEVNULL, timeout=2)
            
            smi_output = subprocess.check_output([
                NVIDIA_SMI_PATH,
                "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,clocks.gr,clocks.mem",
                "--format=csv,noheader,nounits"
            ], universal_newlines=True, timeout=5)

            for line in smi_output.strip().split('\n'):
                if not line.strip(): continue
                parts = [p.strip() for p in line.split(',')]
                try:
                    gpu_info = {
                        "id": int(parts[0]),
                        "utilization_percent": float(parts[1]) if parts[1] != "[Not Supported]" else None,
                        "memory_used_mb": float(parts[2]) if parts[2] != "[Not Supported]" else None,
                        "memory_total_mb": float(parts[3]) if parts[3] != "[Not Supported]" else None,
                        "temperature_c": float(parts[4]) if parts[4] != "[Not Supported]" else None,
                        "power_draw_w": float(parts[5]) if parts[5] != "[Not Supported]" else None,
                        "power_limit_w": float(parts[6]) if parts[6] != "[Not Supported]" else None,
                        "graphics_clock_mhz": float(parts[7]) if parts[7] != "[Not Supported]" else None,
                        "memory_clock_mhz": float(parts[8]) if parts[8] != "[Not Supported]" else None,
                    }
                    stats["gpus"].append(gpu_info)
                except (ValueError, IndexError) as e_parse:
                    print(f"🟡 [Holaf-SysMon] Could not parse GPU line: '{line}'. Error: {e_parse}")
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e_smi_check:
            # This is not necessarily an error if nvidia-smi is not expected.
            # print(f"🟡 [Holaf-SysMon] nvidia-smi not available or failed: {e_smi_check}. GPU monitoring disabled.")
            stats["gpus"] = [] # Ensure it's an empty list
        except Exception as e_gpu:
            print(f"🔴 [Holaf-SysMon] Unexpected error during GPU stat collection: {e_gpu}")
            traceback.print_exc()
            stats["gpus"] = []
            
    except Exception as e_main:
        print(f"🔴 [Holaf-SysMon] Error collecting main system stats (CPU/RAM): {e_main}")
        traceback.print_exc()
        # Ensure default structure even on error
        stats.setdefault("cpu_percent", 0.0)
        stats.setdefault("ram", {"percent": 0.0, "used_gb": 0.0, "total_gb": 0.0})
        stats.setdefault("gpus", [])
        stats.setdefault("timestamp", time.time())
        
    # print(f"🔵 [Holaf-SysMon-DEBUG] Stats collected: {json.dumps(stats)}")
    return stats

async def websocket_handler(request: web.Request, global_app_config):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    MONITOR_ACTIVE_WEBSOCKETS.add(ws)
    print(f"🟢 [Holaf-SysMon] WebSocket connection opened. Active: {len(MONITOR_ACTIVE_WEBSOCKETS)}")
    
    loop = asyncio.get_event_loop()
    monitor_config_settings = global_app_config.get('monitor', {})
    update_interval_seconds = monitor_config_settings.get('update_interval_ms', 1500) / 1000.0

    try:
        while True:
            stats = await loop.run_in_executor(None, _get_system_stats_blocking)
            if ws.closed: break
            await ws.send_json(stats)
            await asyncio.sleep(update_interval_seconds)
    except (ConnectionResetError, asyncio.CancelledError): pass # Common disconnects
    except Exception as e:
        print(f"🔴 [Holaf-SysMon] WebSocket error: {e}")
        traceback.print_exc()
    finally:
        MONITOR_ACTIVE_WEBSOCKETS.discard(ws)
        if not ws.closed: await ws.close()
        print(f"⚫ [Holaf-SysMon] WebSocket connection closed. Active: {len(MONITOR_ACTIVE_WEBSOCKETS)}")
    return ws