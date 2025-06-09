# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-21
#
# Purpose:
# This __init__.py file is the main entry point for the 'ComfyUI-Holaf-Terminal'
# custom extension. It handles security, WebSocket communication, and registers
# the web assets for the floating terminal panel.
#
# Design Choices & Rationale (v17 - UI Persistence):
# - Added a [UI] section to config.ini to store panel state (position, theme, etc.).
# - Created a new endpoint `/holaf/terminal/save-settings` to persist UI changes.
# - The `/holaf/terminal/status` endpoint now also returns the saved UI settings on load.
# - All file write operations are protected by an asyncio.Lock.
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

from aiohttp import web

# --- Platform-specific imports ---
IS_WINDOWS = platform.system() == "Windows"
if not IS_WINDOWS:
    try:
        import pty, termios, tty, fcntl, select
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: pty/termios modules not found. Terminal will not work on non-Windows system.")
else:
    try:
        from winpty import PtyProcess
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: 'pywinpty' is not installed. Terminal will not work on Windows.")
        print("   Please run 'pip install pywinpty' in your ComfyUI Python environment.")
        PtyProcess = None

try:
    import tornado.web, tornado.websocket
    from tornado.ioloop import IOLoop
except ImportError:
    print("🔴 [Holaf-Terminal] Critical: 'tornado' module not found. Please run 'pip install tornado'.")
    raise

CONFIG_LOCK = asyncio.Lock()
SESSION_TOKENS = set()

# --- Configuration Loading ---
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

# --- Password Hashing and Verification Logic ---
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
@server.PromptServer.instance.routes.get("/holaf/terminal/status")
async def holaf_terminal_status(request: web.Request):
    is_set = CONFIG.get('password_hash') is not None
    return web.json_response({
        "password_is_set": is_set,
        "ui_settings": CONFIG.get('ui')
    })

@server.PromptServer.instance.routes.post("/holaf/terminal/save-settings")
async def holaf_terminal_save_settings(request: web.Request):
    # Basic security: only allow saving settings if a password is set
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
            
            # Update values from request data
            if 'theme' in data:
                config.set('UI', 'theme', str(data['theme']))
                CONFIG['ui']['theme'] = str(data['theme'])
            if 'font_size' in data:
                config.set('UI', 'font_size', str(data['font_size']))
                CONFIG['ui']['font_size'] = int(data['font_size'])
            if 'panel_x' in data and data['panel_x'] is not None:
                config.set('UI', 'panel_x', str(data['panel_x']))
                CONFIG['ui']['panel_x'] = int(data['panel_x'])
            if 'panel_y' in data and data['panel_y'] is not None:
                config.set('UI', 'panel_y', str(data['panel_y']))
                CONFIG['ui']['panel_y'] = int(data['panel_y'])
            if 'panel_width' in data:
                config.set('UI', 'panel_width', str(data['panel_width']))
                CONFIG['ui']['panel_width'] = int(data['panel_width'])
            if 'panel_height' in data:
                config.set('UI', 'panel_height', str(data['panel_height']))
                CONFIG['ui']['panel_height'] = int(data['panel_height'])

            with open(config_path, 'w') as configfile:
                config.write(configfile)
            
            return web.json_response({"status": "ok", "message": "Settings saved."})
        except Exception as e:
            print(f"🔴 [Holaf-Terminal] Error saving settings: {e}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/holaf/terminal/set-password")
async def holaf_terminal_set_password(request: web.Request):
    async with CONFIG_LOCK:
        current_config = get_config()
        if current_config.get('password_hash'):
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
                print("🔑 [Holaf-Terminal] A new password has been set and saved via the UI.")
                return web.json_response({"status": "ok", "action": "reload"})
            except PermissionError:
                print("🔵 [Holaf-Terminal] A user tried to set a password, but file permissions prevented saving.")
                return web.json_response({
                    "status": "manual_required",
                    "hash": new_hash,
                    "message": "Could not save config.ini due to file permissions."
                }, status=200)

        except Exception as e:
            print(f"🔴 [Holaf-Terminal] Error setting password: {e}")
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


# --- WebSocket PTY Handler ---

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
    
    sender_task = None
    receiver_task = None
    proc = None

    try:
        user_shell = CONFIG['shell_command']
        shell_cmd_list = []
        env = os.environ.copy()
        
        in_conda = is_running_in_conda()
        in_venv = is_running_in_venv()

        if in_conda:
            conda_prefix = os.environ.get('CONDA_PREFIX')
            print(f"🔵 [Holaf-Terminal] Running in a Conda environment: {conda_prefix}")
            if IS_WINDOWS:
                inner_cmd = f'call conda activate "{conda_prefix}" 2>nul && {user_shell}'
                shell_cmd_list = ['cmd.exe', '/K', inner_cmd]
            else:
                cmd_string = f'eval "$(conda shell.bash hook)" && conda activate "{conda_prefix}" && exec {user_shell}'
                shell_cmd_list = ['/bin/bash', '-c', cmd_string]
        
        elif in_venv:
            print(f"🔵 [Holaf-Terminal] Running in a Venv environment: {os.environ.get('VIRTUAL_ENV')}")
            shell_cmd_list = shlex.split(user_shell)

        else: # Portable or global install
            print(f"🔵 [Holaf-Terminal] Not running in a detectable venv/conda. Using default shell for Python at: {sys.executable}")
            shell_cmd_list = shlex.split(user_shell)
            
            if 'CONDA_PREFIX' in env:
                print("🔵 [Holaf-Terminal] Inherited Conda context detected. Cleansing environment.")
                conda_vars_to_remove = [
                    'CONDA_PREFIX', 'CONDA_SHLVL', 'CONDA_DEFAULT_ENV', 'CONDA_PROMPT_MODIFIER'
                ]
                for var in conda_vars_to_remove:
                    if var in env:
                        del env[var]

        print(f"🔵 [Holaf-Terminal] Spawning shell with command: {shell_cmd_list}")
        
        if IS_WINDOWS:
            if not PtyProcess:
                await ws.close(code=1011, message=b'pywinpty library not found on server')
                return ws
            
            class WindowsPty:
                def __init__(self, pty_process): self.pty = pty_process
                def read(self, size): return self.pty.read(size).encode('utf-8')
                def write(self, data): return self.pty.write(data.decode('utf-8', errors='ignore'))
                def setwinsize(self, rows, cols): self.pty.setwinsize(rows, cols)
                def isalive(self): return self.pty.isalive()
                def terminate(self, force=False): self.pty.terminate(force)
            
            raw_proc = PtyProcess.spawn(shell_cmd_list, dimensions=(24, 80), env=env)
            proc = WindowsPty(raw_proc)

        else: # Unix
            pid, fd = pty.fork()
            if pid == 0:
                env["TERM"] = "xterm"
                try:
                    os.execvpe(shell_cmd_list[0], shell_cmd_list, env)
                except FileNotFoundError:
                    os.execvpe("/bin/sh", ["/bin/sh"], env)
                sys.exit(1)
                
            class UnixPty:
                def __init__(self, pid, fd): self.pid, self.fd = pid, fd
                def read(self, size): return os.read(self.fd, size)
                def write(self, data): return os.write(self.fd, data)
                def setwinsize(self, rows, cols):
                    winsize = __import__('struct').pack('HHHH', rows, cols, 0, 0)
                    __import__('fcntl').ioctl(self.fd, __import__('termios').TIOCSWINSZ, winsize)
                def isalive(self):
                    try: os.kill(self.pid, 0); return True
                    except OSError: return False
                def terminate(self, force=False):
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
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        reader_thread = threading.Thread(target=reader_thread_target, daemon=True)
        reader_thread.start()

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
                        if 'resize' in data and isinstance(data['resize'], list) and len(data['resize']) == 2:
                            rows, cols = data['resize']
                            proc.setwinsize(rows, cols)
                            print(f"🔵 [Holaf-Terminal] Resized to {rows}x{cols}")
                    except (json.JSONDecodeError, TypeError):
                        proc.write(msg.data.encode('utf-8'))
                elif msg.type == web.WSMsgType.BINARY:
                    proc.write(msg.data)
                elif msg.type == web.WSMsgType.ERROR: break
        
        sender_task = asyncio.create_task(sender())
        receiver_task = asyncio.create_task(receiver())
        await asyncio.gather(sender_task, receiver_task)

    finally:
        print("⚫ [Holaf-Terminal] Cleaning up PTY session.")
        if sender_task: sender_task.cancel()
        if receiver_task: receiver_task.cancel()
        if proc and proc.isalive():
            proc.terminate(force=True)
        if not ws.closed: await ws.close()

    return ws

# --- Extension Registration ---

# This variable is picked up by ComfyUI.
WEB_DIRECTORY = "js"
# We don't have any nodes to register.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


print("\n" + "="*50)
print("✅ [Holaf-Terminal] Extension initialized.")
print(f"SHELL COMMAND: {CONFIG['shell_command']}")
if CONFIG.get('password_hash'):
    print("🔑 [Holaf-Terminal] Password is set. Terminal is ENABLED.")
else:
    print("🔵 [Holaf-Terminal] No password set. Setup required in the terminal panel.")
print("="*50 + "\n")
sys.stdout.flush()

# Don't export WEB_DIRECTORY, it's not a node.
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']