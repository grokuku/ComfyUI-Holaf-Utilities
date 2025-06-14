# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-23
#
# Purpose:
# This __init__.py file is the main entry point for the 'ComfyUI-Holaf-Utilities'
# custom extension. It handles two primary functions:
# 1.  Initializes and runs the Holaf Terminal, including its security, API
#     endpoints, and WebSocket PTY management.
# 2.  Dynamically loads all additional node/API modules from the 'nodes'
#     subdirectory, allowing for modular features like the Holaf Model Manager.
#
# Design Choices & Rationale (v19 - Centralized API Registration):
# - All API endpoints (Terminal and Model Manager) are now registered in this
#   file to guarantee they are loaded correctly by the ComfyUI server.
# - The 'nodes' subdirectory contains helper modules that expose functions
#   (like model scanning) but do not register their own routes. This centralizes
#   the critical API registration logic and makes the extension more robust.
# === End Documentation ===

import server
import os
import sys
import uuid
import platform
import subprocess
import configparser
import hashlib
import asyncio
import hmac
import json
import threading
import shlex
import importlib.util

from aiohttp import web
from .nodes import holaf_model_manager as model_manager_helper

# --- Platform-specific imports for Terminal ---
IS_WINDOWS = platform.system() == "Windows"
if not IS_WINDOWS:
    try:
        import pty, termios, tty, fcntl, select
    except ImportError:
        print("🔴 [Holaf-Utilities] Critical: pty/termios modules not found. Terminal will not work on non-Windows system.")
else:
    try:
        from winpty import PtyProcess
    except ImportError:
        print("🔴 [Holaf-Utilities] Critical: 'pywinpty' is not installed. Terminal will not work on Windows.")
        print("   Please run 'pip install pywinpty' in your ComfyUI Python environment.")
        PtyProcess = None

# --- Global Configuration and State ---
CONFIG_LOCK = asyncio.Lock()
SESSION_TOKENS = set()

# --- Configuration Loading for Terminal ---
def get_config():
    config = configparser.ConfigParser()
    config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
    config.read(config_path)

    default_shell = 'cmd.exe' if IS_WINDOWS else ('bash' if os.path.exists('/bin/bash') else 'sh')
    
    # Terminal settings
    shell_cmd = config.get('Terminal', 'shell_command', fallback=default_shell)
    
    # Security settings
    password_hash = config.get('Security', 'password_hash', fallback=None)
    if not password_hash:
        password_hash = None

    # UI settings
    ui_settings = {
        'theme': config.get('UI', 'theme', fallback='Dark'),
        'font_size': config.getint('UI', 'font_size', fallback=14),
        'panel_x': config.getint('UI', 'panel_x', fallback=None),
        'panel_y': config.getint('UI', 'panel_y', fallback=None),
        'panel_width': config.getint('UI', 'panel_width', fallback=600),
        'panel_height': config.getint('UI', 'panel_height', fallback=400),
    }

    return {
        'shell_command': shell_cmd,
        'password_hash': password_hash,
        'ui': ui_settings
    }

CONFIG = get_config()

# --- Password Hashing and Verification Logic for Terminal ---
def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    iterations = 260000
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return f"{salt.hex()}${dk.hex()}"

def _verify_password(stored_hash, provided_password):
    if not stored_hash or not provided_password: return False
    try:
        salt_hex, key_hex = stored_hash.split('$')
        salt = bytes.fromhex(salt_hex)
        key = bytes.fromhex(key_hex)
    except (ValueError, TypeError): return False
    iterations = 260000
    new_key = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt, iterations)
    return hmac.compare_digest(new_key, key)

# --- API Endpoints for Terminal ---
@server.PromptServer.instance.routes.get("/holaf/terminal/status")
async def holaf_terminal_status(request: web.Request):
    is_set = CONFIG.get('password_hash') is not None
    return web.json_response({
        "password_is_set": is_set,
        "ui_settings": CONFIG.get('ui')
    })

@server.PromptServer.instance.routes.post("/holaf/terminal/save-settings")
async def holaf_terminal_save_settings(request: web.Request):
    if not CONFIG.get('password_hash'):
        return web.json_response({"status": "error", "message": "Cannot save settings before a password is set."}, status=403)
    async with CONFIG_LOCK:
        try:
            data = await request.json()
            config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
            config = configparser.ConfigParser()
            config.read(config_path)
            if not config.has_section('UI'):
                config.add_section('UI')
            if 'theme' in data: config.set('UI', 'theme', str(data['theme'])); CONFIG['ui']['theme'] = str(data['theme'])
            if 'font_size' in data: config.set('UI', 'font_size', str(data['font_size'])); CONFIG['ui']['font_size'] = int(data['font_size'])
            if 'panel_x' in data and data['panel_x'] is not None: config.set('UI', 'panel_x', str(data['panel_x'])); CONFIG['ui']['panel_x'] = int(data['panel_x'])
            if 'panel_y' in data and data['panel_y'] is not None: config.set('UI', 'panel_y', str(data['panel_y'])); CONFIG['ui']['panel_y'] = int(data['panel_y'])
            if 'panel_width' in data: config.set('UI', 'panel_width', str(data['panel_width'])); CONFIG['ui']['panel_width'] = int(data['panel_width'])
            if 'panel_height' in data: config.set('UI', 'panel_height', str(data['panel_height'])); CONFIG['ui']['panel_height'] = int(data['panel_height'])
            with open(config_path, 'w') as configfile: config.write(configfile)
            return web.json_response({"status": "ok", "message": "Settings saved."})
        except Exception as e:
            print(f"🔴 [Holaf-Utilities] Error saving settings: {e}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/holaf/terminal/set-password")
async def holaf_terminal_set_password(request: web.Request):
    async with CONFIG_LOCK:
        if get_config().get('password_hash'):
            return web.json_response({"status": "error", "message": "Password is already set."}, status=409)
        try:
            data = await request.json()
            password = data.get('password')
            if not password or len(password) < 4:
                return web.json_response({"status": "error", "message": "Password is too short."}, status=400)
            new_hash = _hash_password(password)
            config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
            config = configparser.ConfigParser()
            config.read(config_path)
            if not config.has_section('Security'):
                config.add_section('Security')
            config.set('Security', 'password_hash', new_hash)
            try:
                with open(config_path, 'w') as configfile:
                    config.write(configfile)
                CONFIG['password_hash'] = new_hash
                print("🔑 [Holaf-Utilities] A new password has been set and saved via the UI.")
                return web.json_response({"status": "ok", "action": "reload"})
            except PermissionError:
                print("🔵 [Holaf-Utilities] A user tried to set a password, but file permissions prevented saving.")
                return web.json_response({"status": "manual_required", "hash": new_hash, "message": "Could not save config.ini due to file permissions."}, status=200)
        except Exception as e:
            print(f"🔴 [Holaf-Utilities] Error setting password: {e}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/holaf/terminal/auth")
async def holaf_terminal_authenticate(request: web.Request):
    if not CONFIG.get('password_hash'):
        return web.json_response({"status": "error", "message": "Terminal is not configured. No password is set."}, status=503)
    try:
        data = await request.json()
        password = data.get('password')
        if _verify_password(CONFIG['password_hash'], password):
            session_token = str(uuid.uuid4())
            SESSION_TOKENS.add(session_token)
            def cleanup_token():
                if session_token in SESSION_TOKENS: SESSION_TOKENS.remove(session_token)
            asyncio.get_event_loop().call_later(60, cleanup_token)
            return web.json_response({"status": "ok", "session_token": session_token})
        else:
            return web.json_response({"status": "error", "message": "Invalid password."}, status=403)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)

# --- WebSocket PTY Handler for Terminal ---
def is_running_in_conda():
    conda_prefix = os.environ.get('CONDA_PREFIX')
    return conda_prefix and sys.executable.startswith(os.path.normpath(conda_prefix))

def is_running_in_venv():
    venv_path = os.environ.get('VIRTUAL_ENV')
    return venv_path and sys.executable.startswith(os.path.normpath(venv_path))

@server.PromptServer.instance.routes.get("/holaf/terminal")
async def holaf_terminal_websocket_handler(request: web.Request):
    session_token = request.query.get('token')
    if not session_token or session_token not in SESSION_TOKENS:
        return web.Response(status=403, text="Invalid or expired session token")
    SESSION_TOKENS.remove(session_token)
    
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    print("🟢 [Holaf-Terminal] WebSocket connection opened and authenticated.")
    loop = asyncio.get_event_loop()
    queue = asyncio.Queue()
    sender_task, receiver_task, proc = None, None, None
    try:
        user_shell = CONFIG['shell_command']
        shell_cmd_list = []
        env = os.environ.copy()
        if is_running_in_conda():
            conda_prefix = os.environ.get('CONDA_PREFIX')
            print(f"🔵 [Holaf-Terminal] Running in a Conda environment: {conda_prefix}")
            if IS_WINDOWS:
                inner_cmd = f'call conda activate "{conda_prefix}" 2>nul && {user_shell}'
                shell_cmd_list = ['cmd.exe', '/K', inner_cmd]
            else:
                cmd_string = f'eval "$(conda shell.bash hook)" && conda activate "{conda_prefix}" && exec {user_shell}'
                shell_cmd_list = ['/bin/bash', '-c', cmd_string]
        elif is_running_in_venv():
            print(f"🔵 [Holaf-Terminal] Running in a Venv environment: {os.environ.get('VIRTUAL_ENV')}")
            shell_cmd_list = shlex.split(user_shell)
        else:
            print(f"🔵 [Holaf-Terminal] Not in venv/conda. Using default shell for Python at: {sys.executable}")
            shell_cmd_list = shlex.split(user_shell)
            if 'CONDA_PREFIX' in env:
                print("🔵 [Holaf-Terminal] Inherited Conda context detected. Cleansing environment.")
                for var in ['CONDA_PREFIX', 'CONDA_SHLVL', 'CONDA_DEFAULT_ENV', 'CONDA_PROMPT_MODIFIER']:
                    if var in env: del env[var]
        print(f"🔵 [Holaf-Terminal] Spawning shell with command: {shell_cmd_list}")
        if IS_WINDOWS:
            if not PtyProcess: await ws.close(code=1011, message=b'pywinpty library not found'); return ws
            class WindowsPty:
                def __init__(self, p): self.pty=p
                def read(self, s): return self.pty.read(s).encode('utf-8')
                def write(self, d): return self.pty.write(d.decode('utf-8', errors='ignore'))
                def setwinsize(self, r, c): self.pty.setwinsize(r, c)
                def isalive(self): return self.pty.isalive()
                def terminate(self, f=False): self.pty.terminate(f)
            proc = WindowsPty(PtyProcess.spawn(shell_cmd_list, dimensions=(24, 80), env=env))
        else:
            pid, fd = pty.fork()
            if pid == 0:
                env["TERM"] = "xterm"
                try: os.execvpe(shell_cmd_list[0], shell_cmd_list, env)
                except FileNotFoundError: os.execvpe("/bin/sh", ["/bin/sh"], env)
                sys.exit(1)
            class UnixPty:
                def __init__(self, p, f): self.pid, self.fd = p, f
                def read(self, s): return os.read(self.fd, s)
                def write(self, d): return os.write(self.fd, d)
                def setwinsize(self, r, c): __import__('fcntl').ioctl(self.fd, __import__('termios').TIOCSWINSZ, __import__('struct').pack('HHHH', r, c, 0, 0))
                def isalive(self):
                    try: os.kill(self.pid, 0); return True
                    except OSError: return False
                def terminate(self, f=False):
                    try: os.kill(self.pid, 15)
                    except ProcessLookupError: pass
            initial_winsize = __import__('struct').pack('HHHH', 24, 80, 0, 0)
            __import__('fcntl').ioctl(fd, __import__('termios').TIOCSWINSZ, initial_winsize)
            attrs = __import__('termios').tcgetattr(fd)
            attrs[3] &= ~__import__('termios').ICANON; attrs[3] |= __import__('termios').ECHO
            __import__('termios').tcsetattr(fd, __import__('termios').TCSANOW, attrs)
            proc = UnixPty(pid, fd)
        def reader_thread_target():
            try:
                while proc.isalive():
                    data = proc.read(1024)
                    if not data: break
                    loop.call_soon_threadsafe(queue.put_nowait, data)
            except (IOError, EOFError): pass
            finally: loop.call_soon_threadsafe(queue.put_nowait, None)
        reader_thread = threading.Thread(target=reader_thread_target, daemon=True); reader_thread.start()
        async def sender():
            while True:
                data = await queue.get()
                if data is None: break
                try: await ws.send_bytes(data)
                except ConnectionResetError: break
            if not ws.closed: await ws.close()
        async def receiver():
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        if 'resize' in data and len(data['resize']) == 2: proc.setwinsize(*data['resize']); print(f"🔵 [Holaf-Terminal] Resized to {data['resize'][0]}x{data['resize'][1]}")
                    except (json.JSONDecodeError, TypeError): proc.write(msg.data.encode('utf-8'))
                elif msg.type == web.WSMsgType.BINARY: proc.write(msg.data)
                elif msg.type == web.WSMsgType.ERROR: break
        sender_task, receiver_task = asyncio.create_task(sender()), asyncio.create_task(receiver())
        await asyncio.gather(sender_task, receiver_task)
    finally:
        print("⚫ [Holaf-Terminal] Cleaning up PTY session.")
        if sender_task: sender_task.cancel()
        if receiver_task: receiver_task.cancel()
        if proc and proc.isalive(): proc.terminate(force=True)
        if not ws.closed: await ws.close()
    return ws

# --- API Endpoints for Model Manager ---
MODEL_TYPES_CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'model_types.json')

@server.PromptServer.instance.routes.get("/holaf/models/config")
async def get_model_types_config(request):
    try:
        if not os.path.exists(MODEL_TYPES_CONFIG_PATH):
            return web.json_response({"error": "model_types.json not found on server"}, status=404)
        with open(MODEL_TYPES_CONFIG_PATH, 'r', encoding='utf-8') as f:
            config_data = json.load(f)
        return web.json_response(config_data)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error reading model_types.json: {e}")
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/holaf/models")
async def get_models_route(request):
    try:
        models = model_manager_helper.get_all_models_from_db()
        return web.json_response(models)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Critical error during model fetch: {e}")
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/holaf/models/delete")
async def delete_model_route(request):
    try:
        data = await request.json()
        model_path = data.get("path")
        if not model_path:
            return web.json_response({"status": "error", "message": "No path provided"}, status=400)
        
        if not model_manager_helper.is_path_safe_for_deletion(model_path):
            return web.json_response({"status": "error", "message": "Deletion of this file is not allowed."}, status=403)

        os.remove(model_path)
        print(f"🔵 [Holaf-ModelManager] Deleted model: {model_path}")
        return web.json_response({"status": "ok", "message": f"Model '{os.path.basename(model_path)}' deleted."})
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found."}, status=404)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error deleting model: {e}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# --- Dynamic Node and API Loading ---
base_dir = os.path.dirname(os.path.abspath(__file__))
nodes_dir = os.path.join(base_dir, "nodes")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

print("--- Initializing Holaf Utilities ---")
if os.path.isdir(nodes_dir):
    for filename in os.listdir(nodes_dir):
        if filename.endswith(".py") and not filename.startswith("__"):
            safe_module_name = f"holaf_utilities_node_{os.path.splitext(filename)[0]}"
            file_path = os.path.join(nodes_dir, filename)
            try:
                spec = importlib.util.spec_from_file_location(safe_module_name, file_path)
                module = importlib.util.module_from_spec(spec)
                sys.modules[safe_module_name] = module
                spec.loader.exec_module(module)
                
                if hasattr(module, "NODE_CLASS_MAPPINGS"):
                    NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS)
                    print(f"  > Loaded nodes from: {filename}")
                if hasattr(module, "NODE_DISPLAY_NAME_MAPPINGS"):
                    NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)
            except Exception as e:
                print(f"🔴 [Holaf-Utilities] Error loading {filename}: {e}", file=sys.stderr)
else:
    print("🟡 [Holaf-Utilities] 'nodes' directory not found. No custom nodes or APIs will be loaded.")


# --- Extension Registration ---
WEB_DIRECTORY = "js"

print("\n" + "="*50)
print("✅ [Holaf-Utilities] Extension initialized.")
print(f"  > Terminal Shell: {CONFIG['shell_command']}")
if CONFIG.get('password_hash'):
    print("  > Terminal Status: 🔑 Password is set. Terminal is ENABLED.")
else:
    print("  > Terminal Status: 🔵 No password set. Setup required in the terminal panel.")
if not NODE_CLASS_MAPPINGS:
    print("  > Additional Nodes: None found.")
print("="*50 + "\n")
sys.stdout.flush()

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']