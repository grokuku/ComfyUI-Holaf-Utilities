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
# MODIFIED: Added deep scan endpoint for Model Manager and startup scan logic.
# MODIFIED: Added save/load settings endpoint and logic for Model Manager UI.
# MODIFIED: Added zoom_level setting for Model Manager UI.
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
                'zoom_level': (float, 'zoom_level') # Added zoom_level
            }

            for key_in_data, (type_converter, key_in_config) in settings_map.items():
                if key_in_data in data:
                    value = data[key_in_data]
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
async def delete_model_route(request):
    try:
        data = await request.json()
        model_path_from_client_canon = data.get("path") 
        if not model_path_from_client_canon:
            return web.json_response({"status": "error", "message": "No path provided"}, status=400)
        
        comfyui_base_path_norm = os.path.normpath(folder_paths.base_path)
        is_client_path_intended_as_absolute = model_path_from_client_canon.startswith('/') or \
                                             (os.name == 'nt' and len(model_path_from_client_canon) > 1 and model_path_from_client_canon[1] == ':' and model_path_from_client_canon[0].isalpha())
        if not is_client_path_intended_as_absolute:
            abs_model_path_norm = os.path.normpath(os.path.join(comfyui_base_path_norm, model_path_from_client_canon))
        else:
            abs_model_path_norm = os.path.normpath(model_path_from_client_canon)

        if not model_manager_helper.is_path_safe_for_deletion(model_path_from_client_canon): 
            return web.json_response({"status": "error", "message": "Deletion of this file/directory is not allowed by policy."}, status=403)

        if os.path.isfile(abs_model_path_norm):
            os.remove(abs_model_path_norm)
        elif os.path.isdir(abs_model_path_norm):
            return web.json_response({"status": "error", "message": "Directory deletion not yet fully supported via this endpoint for safety."}, status=400)
        else:
            return web.json_response({"status": "error", "message": "File/directory not found on server."}, status=404)

        print(f"🔵 [Holaf-ModelManager] Deleted model: {abs_model_path_norm}")
        
        conn_del = None
        try: 
            conn_del = model_manager_helper._get_db_connection()
            cursor_del = conn_del.cursor()
            cursor_del.execute("DELETE FROM models WHERE path = ?", (model_path_from_client_canon,))
            conn_del.commit()
        except Exception as db_e:
            print(f"🔴 [Holaf-ModelManager] Error removing deleted model {model_path_from_client_canon} from DB: {db_e}")
            if conn_del: conn_del.rollback()
        finally:
            if conn_del: conn_del.close()
            
        return web.json_response({"status": "ok", "message": f"Model '{os.path.basename(abs_model_path_norm)}' deleted."})
    
    except FileNotFoundError: 
        return web.json_response({"status": "error", "message": "File not found for deletion."}, status=404)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] Error deleting model: {e}")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


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
    scan_thread = threading.Timer(5.0, model_manager_helper.scan_and_update_db)
    scan_thread.daemon = True 
    scan_thread.start()
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