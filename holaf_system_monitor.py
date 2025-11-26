# === Holaf Utilities - System Monitor ===
import asyncio
import os
import platform
import subprocess
import time
import json
import traceback
import csv
import io
import shutil

# --- Dependency Check ---
try:
    import psutil
except ImportError:
    psutil = None
    print("🔴 [Holaf-SysMon] CRITICAL: 'psutil' library not found! CPU/RAM stats will be 0.")

from aiohttp import web

IS_WINDOWS = platform.system() == "Windows"

# --- NVIDIA-SMI Auto-Detection ---
NVIDIA_SMI_PATH = None

def find_nvidia_smi():
    global NVIDIA_SMI_PATH
    # 1. Try PATH
    path_in_env = shutil.which("nvidia-smi")
    if path_in_env:
        return path_in_env
    
    # 2. Try Standard Windows Paths
    if IS_WINDOWS:
        candidates = [
            os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"), "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
            "C:\\Windows\\System32\\nvidia-smi.exe" 
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
    return None

NVIDIA_SMI_PATH = find_nvidia_smi()
if NVIDIA_SMI_PATH:
    print(f"🟢 [Holaf-SysMon] NVIDIA-SMI found at: {NVIDIA_SMI_PATH}")
else:
    print("🟡 [Holaf-SysMon] NVIDIA-SMI not found. GPU monitoring disabled.")

# --- Init ---
if psutil:
    try:
        psutil.cpu_percent(interval=None) 
    except Exception as e:
        print(f"🟡 [Holaf-SysMon] psutil init warning: {e}")

MONITOR_ACTIVE_WEBSOCKETS = set()

def _get_system_stats_blocking():
    stats = {
        "cpu_percent": 0.0,
        "ram": {"percent": 0.0, "used_gb": 0.0, "total_gb": 0.0},
        "gpus": [],
        "timestamp": time.time()
    }

    # 1. CPU & RAM
    if psutil:
        try:
            # Interval 0.1 is crucial for non-blocking yet accurate instant usage
            stats["cpu_percent"] = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory()
            stats["ram"]["percent"] = mem.percent
            stats["ram"]["used_gb"] = round(mem.used / (1024**3), 2)
            stats["ram"]["total_gb"] = round(mem.total / (1024**3), 2)
        except Exception as e:
            print(f"🔴 [Holaf-SysMon] CPU Read Error: {e}")
    
    # 2. GPU
    if NVIDIA_SMI_PATH:
        try:
            startupinfo = None
            if IS_WINDOWS:
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

            env = os.environ.copy()
            env["LC_ALL"] = "C"

            # Use CSV format
            cmd = [
                NVIDIA_SMI_PATH,
                "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits"
            ]
            
            output = subprocess.check_output(
                cmd, 
                universal_newlines=True, 
                startupinfo=startupinfo, 
                env=env,
                timeout=2
            )

            reader = csv.reader(io.StringIO(output.strip()))
            for p in reader:
                if not p or len(p) < 5: continue
                try:
                    def safe_float(v):
                        return float(v.strip()) if v and "Not Supported" not in v else 0.0

                    gpu_info = {
                        "id": int(p[0]),
                        "utilization_percent": safe_float(p[1]),
                        "memory_used_mb": safe_float(p[2]),
                        "memory_total_mb": safe_float(p[3]),
                        "temperature_c": safe_float(p[4])
                    }
                    stats["gpus"].append(gpu_info)
                except ValueError:
                    pass

        except Exception as e:
            # Only print once or verbose logging to avoid spamming console
            # print(f"🔴 [Holaf-SysMon] GPU Read Error: {e}") 
            pass

    return stats

async def websocket_handler(request: web.Request, global_app_config):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    MONITOR_ACTIVE_WEBSOCKETS.add(ws)
    
    loop = asyncio.get_event_loop()
    try:
        while True:
            stats = await loop.run_in_executor(None, _get_system_stats_blocking)
            if ws.closed: break
            await ws.send_json(stats)
            await asyncio.sleep(1.5)
            
    except Exception as e:
        print(f"🔴 [Holaf-SysMon] WS Error: {e}")
    finally:
        MONITOR_ACTIVE_WEBSOCKETS.discard(ws)
        if not ws.closed: await ws.close()
    return ws