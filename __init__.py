# === Documentation ===
# Developer: Gemini (AI Assistant), under the direction of Holaf
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
# MODIFIED: Added deep scan endpoint for Model Manager and startup scan logic.
# MODIFIED: Added save/load settings endpoint and logic for Model Manager UI.
# MODIFIED: Added zoom_level setting for Model Manager UI.
# MODIFIED: Replaced single-file upload with chunked upload system to handle large files.
# MODIFIED: Fixed chunk assembly and cleanup logic in finalize-upload route.
# MODIFIED: Fixed delete logic to correctly remove DB entries for non-existent files.
# MODIFIED: Made finalize_upload asynchronous to prevent blocking the server event loop.
# MODIFIED: Added cleanup for temp_uploads directory on startup.
# MODIFIED: Added `panel_is_fullscreen` setting for persistent fullscreen state.
# MODIFIED: Replaced monolithic file download with a chunk-based system for parallel, non-blocking downloads.
# CORRECTION: Fixed blocking I/O in Nodes Manager API routes by using run_in_executor.
# MODIFIED: Added API endpoints for Nodes Manager actions (update, delete, install_req).
# MODIFIED: Enhanced /holaf/nodes/update to accept repo_url_override for non-Git nodes.
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
import traceback 
import folder_paths 
import shutil 
from urllib.parse import unquote 
import re # For sanitizing paths
import time # Added for timestamped logging
import aiofiles

from aiohttp import web
from .nodes import holaf_model_manager as model_manager_helper
from .nodes import holaf_nodes_manager as nodes_manager_helper

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
TEMP_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), 'temp_uploads')
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)

# --- Cleanup dangling chunks from previous runs ---
try:
    for item in os.listdir(TEMP_UPLOAD_DIR):
        if item.endswith('.chunk'):
            try:
                os.remove(os.path.join(TEMP_UPLOAD_DIR, item))
            except Exception as e:
                print(f'🔴 [Holaf-Utilities] Could not remove temp chunk {item}: {e}')
except Exception as e:
    print(f'🔴 [Holaf-Utilities] Could not perform startup cleanup of temp_uploads: {e}')


# --- Configuration Loading ---
def get_config():
    config = configparser.ConfigParser()
    config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
    config.read(config_path)

    default_shell = 'cmd.exe' if IS_WINDOWS else ('bash' if os.path.exists('/bin/bash') else 'sh')
    
    shell_cmd = config.get('Terminal', 'shell_command', fallback=default_shell)
    
    password_hash = config.get('Security', 'password_hash', fallback=None)
    if not password_hash: 
        password_hash = None

    ui_settings_terminal = {
        'theme': config.get('TerminalUI', 'theme', fallback='Dark'),
        'font_size': config.getint('TerminalUI', 'font_size', fallback=14),
        'panel_x': config.get('TerminalUI', 'panel_x', fallback=None),
        'panel_y': config.get('TerminalUI', 'panel_y', fallback=None),
        'panel_width': config.getint('TerminalUI', 'panel_width', fallback=600),
        'panel_height': config.getint('TerminalUI', 'panel_height', fallback=400),
        'panel_is_fullscreen': config.getboolean('TerminalUI', 'panel_is_fullscreen', fallback=False),
    }
    if ui_settings_terminal['panel_x'] and ui_settings_terminal['panel_x'].isdigit():
        ui_settings_terminal['panel_x'] = int(ui_settings_terminal['panel_x'])
    else:
        ui_settings_terminal['panel_x'] = None 
    if ui_settings_terminal['panel_y'] and ui_settings_terminal['panel_y'].isdigit():
        ui_settings_terminal['panel_y'] = int(ui_settings_terminal['panel_y'])
    else:
        ui_settings_terminal['panel_y'] = None

    ui_settings_model_manager = {
        'theme': config.get('ModelManagerUI', 'theme', fallback='Dark'),
        'panel_x': config.get('ModelManagerUI', 'panel_x', fallback=None),
        'panel_y': config.get('ModelManagerUI', 'panel_y', fallback=None),
        'panel_width': config.getint('ModelManagerUI', 'panel_width', fallback=800),
        'panel_height': config.getint('ModelManagerUI', 'panel_height', fallback=550),
        'filter_type': config.get('ModelManagerUI', 'filter_type', fallback='All'),
        'filter_search_text': config.get('ModelManagerUI', 'filter_search_text', fallback=''),
        'sort_column': config.get('ModelManagerUI', 'sort_column', fallback='name'),
        'sort_order': config.get('ModelManagerUI', 'sort_order', fallback='asc'),
        'zoom_level': config.getfloat('ModelManagerUI', 'zoom_level', fallback=1.0),
        'panel_is_fullscreen': config.getboolean('ModelManagerUI', 'panel_is_fullscreen', fallback=False),
    }
    if ui_settings_model_manager['panel_x'] and ui_settings_model_manager['panel_x'].isdigit():
        ui_settings_model_manager['panel_x'] = int(ui_settings_model_manager['panel_x'])
    else:
        ui_settings_model_manager['panel_x'] = None
    if ui_settings_model_manager['panel_y'] and ui_settings_model_manager['panel_y'].isdigit():
        ui_settings_model_manager['panel_y'] = int(ui_settings_model_manager['panel_y'])
    else:
        ui_settings_model_manager['panel_y'] = None


    return {
        'shell_command': shell_cmd,
        'password_hash': password_hash,
        'ui_terminal': ui_settings_terminal,
        'ui_model_manager': ui_settings_model_manager
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

# --- API Endpoints ---

@server.PromptServer.instance.routes.get("/holaf/utilities/settings")
async def holaf_get_all_settings(request: web.Request):
    current_config = get_config() 
    password_is_set = current_config.get('password_hash') is not None
    return web.json_response({
        "password_is_set": password_is_set, 
        "ui_terminal_settings": current_config.get('ui_terminal'),
        "ui_model_manager_settings": current_config.get('ui_model_manager')
    })

@server.PromptServer.instance.routes.post("/holaf/terminal/save-settings")
async def holaf_terminal_save_settings(request: web.Request):
    async with CONFIG_LOCK:
        try:
            data = await request.json()
            config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
            config_parser_obj = configparser.ConfigParser()
            config_parser_obj.read(config_path)
            
            section_name = 'TerminalUI' 
            if not config_parser_obj.has_section(section_name):
                config_parser_obj.add_section(section_name)
            
            if 'theme' in data: 
                config_parser_obj.set(section_name, 'theme', str(data['theme']))
                CONFIG['ui_terminal']['theme'] = str(data['theme'])
            if 'font_size' in data: 
                config_parser_obj.set(section_name, 'font_size', str(data['font_size']))
                CONFIG['ui_terminal']['font_size'] = int(data['font_size'])
            
            if 'panel_is_fullscreen' in data:
                config_parser_obj.set(section_name, 'panel_is_fullscreen', str(data['panel_is_fullscreen']))
                CONFIG['ui_terminal']['panel_is_fullscreen'] = bool(data['panel_is_fullscreen'])

            if 'panel_x' in data:
                if data['panel_x'] is not None:
                    config_parser_obj.set(section_name, 'panel_x', str(data['panel_x']))
                    CONFIG['ui_terminal']['panel_x'] = int(data['panel_x'])
                else:
                    if config_parser_obj.has_option(section_name, 'panel_x'):
                        config_parser_obj.remove_option(section_name, 'panel_x')
                    CONFIG['ui_terminal']['panel_x'] = None
            if 'panel_y' in data:
                if data['panel_y'] is not None:
                    config_parser_obj.set(section_name, 'panel_y', str(data['panel_y']))
                    CONFIG['ui_terminal']['panel_y'] = int(data['panel_y'])
                else:
                    if config_parser_obj.has_option(section_name, 'panel_y'):
                        config_parser_obj.remove_option(section_name, 'panel_y')
                    CONFIG['ui_terminal']['panel_y'] = None

            if 'panel_width' in data: 
                config_parser_obj.set(section_name, 'panel_width', str(data['panel_width']))
                CONFIG['ui_terminal']['panel_width'] = int(data['panel_width'])
            if 'panel_height' in data: 
                config_parser_obj.set(section_name, 'panel_height', str(data['panel_height']))
                CONFIG['ui_terminal']['panel_height'] = int(data['panel_height'])
                
            with open(config_path, 'w') as configfile: config_parser_obj.write(configfile)
            return web.json_response({"status": "ok", "message": "Terminal settings saved."})
        except Exception as e:
            print(f"🔴 [Holaf-Utilities] Error saving terminal settings: {e}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/holaf/model-manager/save-settings")
async def holaf_model_manager_save_settings(request: web.Request):
    async with CONFIG_LOCK:
        try:
            data = await request.json()
            config_path = os.path.join(os.path.dirname(__file__), 'config.ini')
            config_parser_obj = configparser.ConfigParser()
            config_parser_obj.read(config_path)
            
            section_name = 'ModelManagerUI'
            if not config_parser_obj.has_section(section_name):
                config_parser_obj.add_section(section_name)
            
            settings_map = {
                'theme': (str, 'theme'), 'panel_width': (int, 'panel_width'), 
                'panel_height': (int, 'panel_height'), 'filter_type': (str, 'filter_type'),
                'filter_search_text': (str, 'filter_search_text'),
                'sort_column': (str, 'sort_column'), 'sort_order': (str, 'sort_order'),
                'zoom_level': (float, 'zoom_level'),
                'panel_is_fullscreen': (lambda v: str(v).lower() in ('true', '1', 't'), 'panel_is_fullscreen')
            }

            for key_in_data, (type_converter, key_in_config) in settings_map.items():
                if key_in_data in data:
                    value = data[key_in_data]
                    if key_in_config == 'panel_is_fullscreen':
                         config_parser_obj.set(section_name, key_in_config, str(bool(value)))
                    else:
                        config_parser_obj.set(section_name, key_in_config, str(value))
                    CONFIG['ui_model_manager'][key_in_config] = type_converter(value)
            
            if 'panel_x' in data:
                if data['panel_x'] is not None:
                    config_parser_obj.set(section_name, 'panel_x', str(data['panel_x']))
                    CONFIG['ui_model_manager']['panel_x'] = int(data['panel_x'])
                else:
                    if config_parser_obj.has_option(section_name, 'panel_x'):
                        config_parser_obj.remove_option(section_name, 'panel_x')
                    CONFIG['ui_model_manager']['panel_x'] = None
            if 'panel_y' in data:
                if data['panel_y'] is not None:
                    config_parser_obj.set(section_name, 'panel_y', str(data['panel_y']))
                    CONFIG['ui_model_manager']['panel_y'] = int(data['panel_y'])
                else:
                    if config_parser_obj.has_option(section_name, 'panel_y'):
                        config_parser_obj.remove_option(section_name, 'panel_y')
                    CONFIG['ui_model_manager']['panel_y'] = None

            with open(config_path, 'w') as configfile: config_parser_obj.write(configfile)
            return web.json_response({"status": "ok", "message": "Model Manager settings saved."})
        except Exception as e:
            print(f"🔴 [Holaf-Utilities] Error saving Model Manager settings: {e}")
            traceback.print_exc()
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
            config_obj = configparser.ConfigParser()
            config_obj.read(config_path)
            if not config_obj.has_section('Security'):
                config_obj.add_section('Security')
            config_obj.set('Security', 'password_hash', new_hash)
            try:
                with open(config_path, 'w') as configfile:
                    config_obj.write(configfile)
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
    current_config = get_config() 
    if not current_config.get('password_hash'):
        return web.json_response({"status": "error", "message": "Terminal is not configured. No password is set."}, status=503)
    try:
        data = await request.json()
        password = data.get('password')
        if _verify_password(current_config['password_hash'], password):
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
        user_shell = get_config()['shell_command'] 
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
                def read(self, s): return self.pty.read(s).encode('utf-8', errors='replace')
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

def sanitize_filename(filename):
    if not filename: return "untitled"
    filename = str(filename)
    filename = filename.replace("..", "")
    filename = filename.strip("/\\ ")
    filename = re.sub(r'[<>:"|?*\x00-\x1f]', '', filename) 
    if not filename: return "untitled" 
    return filename

def sanitize_directory_component(component):
    if not component: return ""
    component = str(component)
    component = component.replace("..", "") 
    component = component.strip("/\\ ")
    component = re.sub(r'[<>:"|?*\x00-\x1f]', '', component) 
    return component

def sanitize_upload_id(upload_id):
    if not upload_id: return None
    sanitized = re.sub(r'[^a-zA-Z0-9-]', '', str(upload_id))
    return sanitized if sanitized else None


@server.PromptServer.instance.routes.post("/holaf/models/deep-scan-local")
async def holaf_model_deep_scan_local_route(request: web.Request):
    try:
        data = await request.json()
        model_paths = data.get("paths")
        if not model_paths or not isinstance(model_paths, list):
            return web.json_response({"status": "error", "message": "'paths' list is required."}, status=400)
        
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, model_manager_helper.process_deep_scan_request, model_paths)
        
        status_code = 200
        if results.get("updated_count", 0) == 0 and len(results.get("errors", [])) == len(model_paths) and len(model_paths) > 0:
            pass 
        return web.json_response({"status": "ok", "details": results}, status=status_code)
    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON payload."}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error during deep scan local request: {e}")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

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
async def delete_model_route(request: web.Request):
    deleted_count = 0
    errors = []
    try:
        data = await request.json()
        model_paths_from_client = data.get("paths", [])

        if not isinstance(model_paths_from_client, list):
            return web.json_response({"status": "error", "message": "'paths' must be a list."}, status=400)

        comfyui_base_path_norm = os.path.normpath(folder_paths.base_path)
        
        with model_manager_helper._get_db_connection() as conn:
            conn.autocommit = False
            cursor = conn.cursor()

            for path_canon in model_paths_from_client:
                try:
                    cursor.execute("SELECT is_directory FROM models WHERE path = ?", (path_canon,))
                    model_record = cursor.fetchone()
                    
                    is_dir = bool(model_record["is_directory"]) if model_record else False

                    if not model_manager_helper.is_path_safe(path_canon, is_directory_model=is_dir):
                        errors.append({"path": path_canon, "message": "Deletion of this path is not allowed by policy."})
                        continue

                    is_client_path_abs = path_canon.startswith('/') or (os.name == 'nt' and len(path_canon) > 1 and path_canon[1] == ':')
                    abs_path_norm = os.path.normpath(os.path.join(comfyui_base_path_norm, path_canon) if not is_client_path_abs else path_canon)
                    
                    if os.path.isfile(abs_path_norm):
                        os.remove(abs_path_norm)
                        print(f"🔵 [Holaf-ModelManager] Deleted model file: {abs_path_norm}")
                    elif os.path.isdir(abs_path_norm):
                        errors.append({"path": path_canon, "message": "Directory deletion is not currently supported for safety."})
                        continue
                    
                    cursor.execute("DELETE FROM models WHERE path = ?", (path_canon,))
                    if cursor.rowcount > 0:
                        deleted_count += 1

                except Exception as e:
                    error_msg = f"Error processing '{path_canon}': {str(e)}"
                    errors.append({"path": path_canon, "message": error_msg})
                    print(f"🔴 [Holaf-ModelManager] {error_msg}")
                    traceback.print_exc()
                    conn.rollback() 

            conn.commit()

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON payload."}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] General error in delete_model_route: {e}")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

    if not errors and deleted_count > 0:
        status, http_code = "ok", 200
    elif errors and deleted_count > 0:
        status, http_code = "partial_success", 207
    else: 
        status, http_code = "error", 400

    return web.json_response({
        "status": status,
        "message": f"Delete operation completed. {deleted_count} DB record(s) processed, {len(errors)} error(s).",
        "details": {"deleted_count": deleted_count, "errors": errors}
    }, status=http_code)


async def _read_file_chunk(path, offset, size):
    """Asynchronously reads a chunk from a file."""
    try:
        async with aiofiles.open(path, 'rb') as f:
            await f.seek(offset)
            return await f.read(size)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error reading chunk for {path}: {e}")
        return None

@server.PromptServer.instance.routes.post("/holaf/models/download-chunk")
async def download_model_chunk_route(request: web.Request):
    try:
        data = await request.json()
        path_canon = data.get("path")
        chunk_index = int(data.get("chunk_index"))
        chunk_size = int(data.get("chunk_size"))
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        return web.Response(status=400, text=f"Invalid request data: {e}")

    if not all([path_canon, isinstance(chunk_index, int) and chunk_index >= 0, isinstance(chunk_size, int) and chunk_size > 0]):
        return web.Response(status=400, text="Missing or invalid parameters.")
    
    if not model_manager_helper.is_path_safe(path_canon, is_directory_model=False):
        return web.Response(status=403, text="Access to the requested model path is forbidden.")

    comfyui_base_path_norm = os.path.normpath(folder_paths.base_path)
    is_abs = path_canon.startswith('/') or (os.name == 'nt' and len(path_canon) > 1 and path_canon[1] == ':')
    abs_model_path_norm = os.path.normpath(path_canon if is_abs else os.path.join(comfyui_base_path_norm, path_canon))

    if not os.path.isfile(abs_model_path_norm):
        return web.Response(status=404, text="Model file not found on server.")
    
    offset = chunk_index * chunk_size
    
    try:
        chunk_data = await _read_file_chunk(abs_model_path_norm, offset, chunk_size)
        if chunk_data is None:
            raise IOError("File could not be read.")

        return web.Response(body=chunk_data, content_type='application/octet-stream')
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error processing download chunk for '{path_canon}': {e}")
        return web.Response(status=500, text=f"Server error during chunk read: {e}")


@server.PromptServer.instance.routes.post("/holaf/models/upload-chunk")
async def upload_model_chunk_route(request: web.Request):
    try:
        data = await request.post()
        
        upload_id = sanitize_upload_id(data.get('upload_id'))
        chunk_index_str = data.get('chunk_index')
        file_chunk_field = data.get('file_chunk')

        if not all([upload_id, chunk_index_str, file_chunk_field]):
            return web.json_response({"status": "error", "message": "Missing required fields (upload_id, chunk_index, file_chunk)."}, status=400)

        chunk_path = os.path.join(TEMP_UPLOAD_DIR, f"{upload_id}-{chunk_index_str}.chunk")
        
        if os.path.normpath(chunk_path).startswith(os.path.normpath(TEMP_UPLOAD_DIR)) is False:
             return web.json_response({"status": "error", "message": "Invalid chunk path."}, status=400)

        with open(chunk_path, 'wb') as f_out:
            f_out.write(file_chunk_field.file.read())
            
        return web.json_response({"status": "ok", "message": f"Chunk {chunk_index_str} received."})

    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error processing chunk: {e}")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": f"Server error processing chunk: {e}"}, status=500)


def _assemble_and_cleanup_blocking(final_save_path, upload_id, total_chunks):
    """This is a blocking function intended to be run in a separate thread."""
    chunk_files_to_clean = [os.path.join(TEMP_UPLOAD_DIR, f"{upload_id}-{i}.chunk") for i in range(total_chunks)]
    try:
        with open(final_save_path, 'wb') as f_out:
            for i in range(total_chunks):
                chunk_path = chunk_files_to_clean[i]
                if not os.path.exists(chunk_path):
                    raise IOError(f"Missing chunk {i} for upload {upload_id}.")
                with open(chunk_path, 'rb') as f_in:
                    f_out.write(f_in.read())
        print(f"🔵 [Holaf-ModelManager] File assembled successfully to: {final_save_path}")
        threading.Timer(2.0, model_manager_helper.scan_and_update_db).start()
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error assembling file '{os.path.basename(final_save_path)}': {e}")
        if os.path.exists(final_save_path):
            os.remove(final_save_path)
        raise
    finally:
        for chunk_file in chunk_files_to_clean:
            if os.path.exists(chunk_file):
                try: 
                    os.remove(chunk_file)
                except Exception as e_clean: 
                    print(f"🔴 [Holaf-ModelManager] Error cleaning up chunk '{chunk_file}': {e_clean}")

@server.PromptServer.instance.routes.post("/holaf/models/finalize-upload")
async def finalize_upload_route(request: web.Request):
    try:
        data = await request.json()
        upload_id = sanitize_upload_id(data.get('upload_id'))
        filename_original = data.get('filename')
        total_chunks = data.get('total_chunks')
        destination_type = data.get('destination_type')
        subfolder = data.get('subfolder', '')

        if not all([upload_id, filename_original, total_chunks, destination_type]):
            return web.json_response({"status": "error", "message": "Missing required finalization fields."}, status=400)
            
        filename = sanitize_filename(filename_original)
        if not filename:
             return web.json_response({"status": "error", "message": "Invalid or empty filename after sanitization."}, status=400)

        base_dest_paths = folder_paths.get_folder_paths(destination_type)
        if not base_dest_paths: 
            return web.json_response({"status": "error", "message": f"Invalid destination type '{destination_type}'"}, status=400)
        base_dest_path = os.path.normpath(base_dest_paths[0])

        final_subfolder_parts = [p for p in map(sanitize_directory_component, re.split(r'[/\\]', subfolder)) if p]
        full_destination_dir = os.path.join(base_dest_path, *final_subfolder_parts)
        final_save_path_norm = os.path.normpath(os.path.join(full_destination_dir, filename))
        
        comfyui_base_path_norm = os.path.normpath(folder_paths.base_path)
        path_for_safety_check_canon = os.path.relpath(final_save_path_norm, comfyui_base_path_norm).replace(os.sep, '/')
        
        if not model_manager_helper.is_path_safe(path_for_safety_check_canon, is_directory_model=False):
            return web.json_response({"status": "error", "message": "Calculated save path is outside allowed model directories."}, status=403)
        
        if os.path.exists(final_save_path_norm):
            return web.json_response({"status": "error", "message": f"File '{filename}' already exists at the destination."}, status=409)

        os.makedirs(full_destination_dir, exist_ok=True)
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _assemble_and_cleanup_blocking, final_save_path_norm, upload_id, total_chunks)
        
        return web.json_response({"status": "ok", "message": f"Finalization for '{filename}' started."})
            
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Critical error in finalize_upload_route: {e}")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": f"Server error during finalization: {e}"}, status=500)


# --- API Endpoints for Custom Nodes Manager ---

@server.PromptServer.instance.routes.get("/holaf/nodes/list")
async def holaf_get_nodes_list(request: web.Request):
    try:
        loop = asyncio.get_event_loop()
        nodes_list = await loop.run_in_executor(None, nodes_manager_helper.scan_custom_nodes)
        return web.json_response({"nodes": nodes_list})
    except Exception as e:
        print(f"🔴 [Holaf-NodesManager] Error scanning custom nodes: {e}")
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/holaf/nodes/readme/local/{node_name}")
async def holaf_get_node_local_readme(request: web.Request):
    try:
        node_name = request.match_info.get('node_name', "")
        loop = asyncio.get_event_loop()
        content = await loop.run_in_executor(None, nodes_manager_helper.get_local_readme_content, node_name)
        return web.Response(text=content, content_type='text/plain', charset='utf-8')
    except Exception as e:
        node_name_for_log = locals().get('node_name', '[unknown]')
        print(f"🔴 [Holaf-NodesManager] Error getting local README for {node_name_for_log}: {e}")
        traceback.print_exc()
        return web.Response(text=f"Server error fetching local README: {e}", status=500)

@server.PromptServer.instance.routes.post("/holaf/nodes/readme/github")
async def holaf_get_node_github_readme(request: web.Request):
    try:
        data = await request.json()
        owner = data.get("owner")
        repo = data.get("repo")
        if not owner or not repo:
            return web.Response(text="Error: 'owner' and 'repo' are required.", status=400)
        
        content = await nodes_manager_helper.get_github_readme_content(owner, repo)
        return web.Response(text=content, content_type='text/plain', charset='utf-8') 
    except json.JSONDecodeError:
        return web.Response(text="Error: Invalid JSON payload.", status=400)
    except Exception as e:
        owner = locals().get('owner', 'N/A')
        repo = locals().get('repo', 'N/A')
        print(f"🔴 [Holaf-NodesManager] Error getting GitHub README for {owner}/{repo}: {e}")
        return web.Response(text=f"Server error fetching GitHub README: {e}", status=500)

@server.PromptServer.instance.routes.get("/holaf/nodes/search/github/{node_name}")
async def holaf_search_github_repo(request: web.Request):
    try:
        node_name = request.match_info.get('node_name', "")
        if not node_name:
            return web.json_response({"error": "Node name is required."}, status=400)
        
        repo_url = await nodes_manager_helper.search_github_for_repo(node_name)
        
        return web.json_response({"url": repo_url})
    except Exception as e:
        node_name_for_log = locals().get('node_name', '[unknown]')
        print(f"🔴 [Holaf-NodesManager] Error searching GitHub for repo '{node_name_for_log}': {e}")
        return web.json_response({"error": f"Server error during GitHub search: {e}"}, status=500)

async def _handle_node_action_batch(request: web.Request, action_func, action_name: str):
    """Generic handler for batch node actions. Action_name used for specific param extraction."""
    try:
        data = await request.json()
        
        # 'node_payloads' will be a list of dicts, each like {"name": "node_A", "repo_url_override": "url_if_any"}
        # or just a list of names if 'node_names' is used by older client.
        # We prioritize 'node_payloads' if it exists.
        
        items_to_process = []
        if "node_payloads" in data and isinstance(data["node_payloads"], list):
            for payload_item in data["node_payloads"]:
                if isinstance(payload_item, dict) and "name" in payload_item:
                    items_to_process.append({
                        "name": payload_item["name"],
                        "repo_url_override": payload_item.get("repo_url_override") # Will be None if not present
                    })
                elif isinstance(payload_item, str): # Fallback for old format if mixed
                    items_to_process.append({"name": payload_item, "repo_url_override": None})

        elif "node_names" in data and isinstance(data["node_names"], list): # Fallback to old format
             for node_name_str in data["node_names"]:
                 if isinstance(node_name_str, str):
                    items_to_process.append({"name": node_name_str, "repo_url_override": None})
        
        if not items_to_process:
            return web.json_response({"status": "error", "message": "Valid 'node_payloads' list (with dicts) or 'node_names' list (with strings) is required."}, status=400)

        results = []
        loop = asyncio.get_event_loop()
        for item_data in items_to_process:
            node_name = item_data["name"]
            repo_url_override = item_data["repo_url_override"]
            
            # Run blocking action in executor
            if action_name == "update": # Only 'update' action uses repo_url_override
                result = await loop.run_in_executor(None, action_func, node_name, repo_url_override)
            else:
                result = await loop.run_in_executor(None, action_func, node_name)
            results.append({"node_name": node_name, **result})
        
        all_successful = all(r['status'] == 'success' for r in results)
        any_successful = any(r['status'] == 'success' for r in results)

        if all_successful:
            http_status = 200
            overall_status = "ok"
        elif any_successful:
            http_status = 207 
            overall_status = "partial_success"
        else:
            http_status = 400 
            overall_status = "error"
            
        return web.json_response({"status": overall_status, "details": results}, status=http_status)

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON payload."}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-NodesManager] Error during batch node action '{action_name}': {e}")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/holaf/nodes/update")
async def holaf_update_nodes(request: web.Request):
    return await _handle_node_action_batch(request, nodes_manager_helper.update_node_from_git, "update")

@server.PromptServer.instance.routes.post("/holaf/nodes/delete")
async def holaf_delete_nodes(request: web.Request):
    return await _handle_node_action_batch(request, nodes_manager_helper.delete_node_folder, "delete")

@server.PromptServer.instance.routes.post("/holaf/nodes/install-requirements")
async def holaf_install_nodes_requirements(request: web.Request):
    return await _handle_node_action_batch(request, nodes_manager_helper.install_node_requirements, "install_requirements")


# --- Dynamic Node and API Loading ---
base_dir = os.path.dirname(os.path.abspath(__file__)); nodes_dir = os.path.join(base_dir, "nodes")
NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = {}, {}
print("--- Initializing Holaf Utilities ---")
if os.path.isdir(nodes_dir):
    for filename in os.listdir(nodes_dir):
        if filename.endswith(".py") and not filename.startswith("__"):
            safe_module_name = f"holaf_utilities_node_{os.path.splitext(filename)[0]}"
            file_path = os.path.join(nodes_dir, filename)
            try:
                spec = importlib.util.spec_from_file_location(safe_module_name, file_path)
                module = importlib.util.module_from_spec(spec); sys.modules[safe_module_name] = module
                spec.loader.exec_module(module)
                if hasattr(module, "NODE_CLASS_MAPPINGS"): NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS); print(f"  > Loaded nodes from: {filename}")
                if hasattr(module, "NODE_DISPLAY_NAME_MAPPINGS"): NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)
            except Exception as e: print(f"🔴 [Holaf-Utilities] Error loading {filename}: {e}", file=sys.stderr)
else: print("🟡 [Holaf-Utilities] 'nodes' directory not found. No custom nodes or APIs will be loaded.")

# --- Extension Registration ---
WEB_DIRECTORY = "js"

# Perform model scan on startup
print("🔵 [Holaf-ModelManager] Scheduling model database scan on startup via __init__.py...")
if 'model_manager_helper' in globals() and hasattr(model_manager_helper, 'scan_and_update_db'):
    scan_thread_init = threading.Timer(5.0, model_manager_helper.scan_and_update_db)
    scan_thread_init.daemon = True 
    scan_thread_init.start()
else:
    print("🔴 [Holaf-ModelManager] ERROR: model_manager_helper or scan_and_update_db not found for scheduled scan.")


print("\n" + "="*50)
print("✅ [Holaf-Utilities] Extension initialized.")
current_config_final = get_config() 
print(f"  > Terminal Shell: {current_config_final['shell_command']}")
if current_config_final.get('password_hash'):
    print("  > Terminal Status: 🔑 Password is set. Terminal is ENABLED.")
else:
    print("  > Terminal Status: 🔵 No password set. Setup required in the terminal panel.")
print(f"  > Terminal UI settings: {current_config_final.get('ui_terminal')}")
print(f"  > Model Manager UI settings: {current_config_final.get('ui_model_manager')}")
if not NODE_CLASS_MAPPINGS:
    print("  > Additional Nodes: None found.")
print("="*50 + "\n"); sys.stdout.flush()
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']