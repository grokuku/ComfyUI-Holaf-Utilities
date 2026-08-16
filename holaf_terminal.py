# === Holaf Utilities - Terminal Manager ===
import asyncio
import os
import platform
import shlex
import sys
import uuid
import json
import traceback
import threading

from aiohttp import web
# Conditional imports for PTY
IS_WINDOWS = platform.system() == "Windows"
if not IS_WINDOWS:
    try:
        import pty, termios, tty, fcntl, select, struct
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: pty/termios modules not found. Terminal will not work on non-Windows system.")
        pty = termios = tty = fcntl = select = struct = None 
else:
    try:
        from winpty import PtyProcess
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: 'pywinpty' is not installed. Terminal will not work on Windows.")
        print("   Please run 'pip install pywinpty' in your ComfyUI Python environment.")
        PtyProcess = None

from . import holaf_auth
from . import holaf_config # For config access if needed, or pass config values

SESSION_TOKENS = set() # Manages active terminal session tokens
SESSION_TOKENS_LOCK = threading.Lock() # Thread-safe access to SESSION_TOKENS

# --- Password Hashing and Verification ---
# Factorized into holaf_auth.py so the terminal and the shared auth module use
# the exact same PBKDF2-HMAC-SHA256 implementation. These aliases keep any
# existing callers working without changes.
_hash_password = holaf_auth.hash_password
_verify_password = holaf_auth.verify_password

# --- Terminal Environment ---
def is_running_in_conda():
    conda_prefix = os.environ.get('CONDA_PREFIX')
    return conda_prefix and sys.executable.startswith(os.path.normpath(conda_prefix))

def is_running_in_venv():
    venv_path = os.environ.get('VIRTUAL_ENV')
    return venv_path and sys.executable.startswith(os.path.normpath(venv_path))

# --- API Route Handlers ---
async def set_password_route(request: web.Request, global_app_config):
    # The lock is handled inside save_setting_to_config; removing it here prevents a deadlock.
    try:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"status": "error", "message": "Invalid request."}, status=400)

        if not isinstance(data, dict):
            return web.json_response({"status": "error", "message": "Invalid request."}, status=400)

        current_hash = global_app_config.get('password_hash')

        if current_hash:
            # A password already exists: changing it requires proving knowledge of the
            # current password. This prevents an unauthenticated attacker from
            # hijacking the terminal by overwriting the password.
            current_password = data.get('current_password')
            if not current_password or not _verify_password(current_hash, current_password):
                return web.json_response({"status": "error", "message": "Current password is incorrect."}, status=403)

        # No password is configured yet: first-time setup is allowed. This is
        # protected by the CSRF middleware (Origin/Referer check) and, in remote
        # deployments, by the authenticated reverse proxy in front of ComfyUI.
        # On instances exposed WITHOUT an authenticated proxy, pre-configure
        # 'password_hash' in config.ini to avoid a first-come-first-served takeover.
        password = data.get('password')
        if not password or len(password) < 4:
            return web.json_response({"status": "error", "message": "New password is too short."}, status=400)

        new_hash = _hash_password(password)

        try:
            await holaf_config.save_setting_to_config('Security', 'password_hash', new_hash)
            global_app_config['password_hash'] = new_hash # Update live global config
            if current_hash:
                print("🔑 [Holaf-Terminal] The terminal password has been changed via the UI.")
            else:
                print("🔑 [Holaf-Terminal] The terminal password has been set via the UI.")
            return web.json_response({"status": "ok", "action": "reload"})
        except PermissionError:
            print("🔵 [Holaf-Terminal] A user tried to set/change the password, but file permissions prevented saving.")
            if not current_hash:
                # First-time setup: offer the manual fallback (README-documented UX):
                # the user copies the hash into config.ini under [Security] password_hash.
                return web.json_response({"status": "manual_required", "hash": new_hash})
            return web.json_response({"status": "error", "message": "Could not save config.ini due to file permissions."}, status=500)
    except Exception as e:
        print(f"🔴 [Holaf-Terminal] Error setting password: {e}")
        traceback.print_exc()
        return web.json_response({"status": "error", "message": "An unexpected error occurred while updating the password."}, status=500)

async def auth_route(request: web.Request, global_app_config):
    # Compatibility endpoint for the current terminal frontend.
    #
    # It performs the same password verification as POST /holaf/auth/login and
    # sets the shared holaf_session cookie, but it also returns the legacy
    # one-time 'session_token' that the terminal WebSocket currently appends as
    # ?token=... for its handshake. New clients should prefer
    # POST /holaf/auth/login + cookie-only auth.
    if not global_app_config.get('password_hash'):
        return web.json_response({"status": "error", "message": "Terminal is not configured. No password is set."}, status=503)
    try:
        data = await request.json()
        password = data.get('password')
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request."}, status=400)

    if not _verify_password(global_app_config['password_hash'], password):
        return web.json_response({"status": "error", "message": "Invalid password."}, status=403)

    session_token = str(uuid.uuid4())
    with SESSION_TOKENS_LOCK:
        SESSION_TOKENS.add(session_token)
    def cleanup_token(): # Runs in the event loop's thread
        with SESSION_TOKENS_LOCK:
            SESSION_TOKENS.discard(session_token)
    asyncio.get_running_loop().call_later(60, cleanup_token) # Token valid for 60s

    response = web.json_response({"status": "ok", "session_token": session_token})
    holaf_auth.set_session_cookie(response, request)
    return response

async def websocket_handler(request: web.Request, global_app_config):
    # The route wrapper applies require_auth (cookie check). We keep the legacy
    # one-time query token path for the current frontend: if a ?token= is
    # supplied it is consumed as before, otherwise the caller must have already
    # passed the shared cookie check performed by require_auth.
    session_token = request.query.get('token')
    if session_token:
        with SESSION_TOKENS_LOCK:
            if session_token not in SESSION_TOKENS:
                return web.Response(status=403, text="Invalid or expired session token")
            SESSION_TOKENS.discard(session_token) # One-time use token
    elif not holaf_auth.is_authenticated(request):
        return web.Response(status=403, text="Invalid or expired session")
    
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    print("🟢 [Holaf-Terminal] WebSocket connection opened and authenticated.")
    
    loop = asyncio.get_running_loop()
    pty_queue = asyncio.Queue() # For data from PTY to WebSocket
    
    proc_adapter = None # Will hold either WindowsPty or UnixPty instance
    
    try:
        user_shell = global_app_config['shell_command']
        shell_cmd_list = []
        current_env = os.environ.copy()

        if is_running_in_conda():
            conda_prefix = os.environ.get('CONDA_PREFIX')
            print(f"🔵 [Holaf-Terminal] Running in a Conda environment: {conda_prefix}")
            if IS_WINDOWS:
                inner_cmd = f'call conda activate "{conda_prefix}" 2>nul && {user_shell}'
                shell_cmd_list = ['cmd.exe', '/K', inner_cmd]
            else: # Linux/macOS
                cmd_string = f'eval "$(conda shell.bash hook)" && conda activate "{conda_prefix}" && exec {user_shell}'
                shell_cmd_list = ['/bin/bash', '-c', cmd_string]
        elif is_running_in_venv():
            print(f"🔵 [Holaf-Terminal] Running in a Venv environment: {os.environ.get('VIRTUAL_ENV')}")
            shell_cmd_list = shlex.split(user_shell)
        else:
            print(f"🔵 [Holaf-Terminal] Not in venv/conda. Using default shell for Python at: {sys.executable}")
            shell_cmd_list = shlex.split(user_shell)
            # Cleanse Conda vars if present but not active, to avoid issues
            if 'CONDA_PREFIX' in current_env:
                print("🔵 [Holaf-Terminal] Inherited Conda context detected. Cleansing environment.")
                for var_name in ['CONDA_PREFIX', 'CONDA_SHLVL', 'CONDA_DEFAULT_ENV', 'CONDA_PROMPT_MODIFIER']:
                    if var_name in current_env: del current_env[var_name]
        
        print(f"🔵 [Holaf-Terminal] Spawning shell with command: {shell_cmd_list}")

        if IS_WINDOWS:
            if not PtyProcess:
                await ws.close(code=1011, message=b'pywinpty library not found')
                return ws
            
            class WindowsPtyAdapter:
                def __init__(self, p): self.pty_proc = p
                def read(self, size): return self.pty_proc.read(size).encode('utf-8', errors='replace')
                def write(self, data_bytes): return self.pty_proc.write(data_bytes.decode('utf-8', errors='ignore'))
                def set_winsize(self, rows, cols): self.pty_proc.setwinsize(rows, cols)
                def is_alive(self): return self.pty_proc.isalive()
                def terminate(self, force=False): self.pty_proc.terminate(force)
            
            proc_adapter = WindowsPtyAdapter(PtyProcess.spawn(shell_cmd_list, dimensions=(24, 80), env=current_env))
        
        else: # Linux/macOS
            if not pty: # pty modules failed to import
                await ws.close(code=1011, message=b'pty/termios modules unavailable')
                return ws

            pid, fd = pty.fork()
            if pid == 0: # Child process
                os.environ["TERM"] = "xterm" # Basic terminal type
                try:
                    os.execvpe(shell_cmd_list[0], shell_cmd_list, current_env)
                except FileNotFoundError: # Fallback if shell_cmd_list[0] is not found in PATH
                    os.execvpe("/bin/sh", ["/bin/sh"], current_env) 
                sys.exit(1) # Should not be reached
            
            class UnixPtyAdapter:
                def __init__(self, p, f_descriptor):
                    self.pid = p
                    self.fd = f_descriptor
                def read(self, size): return os.read(self.fd, size)
                def write(self, data_bytes): return os.write(self.fd, data_bytes)
                def set_winsize(self, rows, cols):
                    winsize = struct.pack('HHHH', rows, cols, 0, 0)
                    fcntl.ioctl(self.fd, termios.TIOCSWINSZ, winsize)
                def is_alive(self):
                    try:
                        os.kill(self.pid, 0)
                        return True
                    except OSError:
                        return False
                def terminate(self, force=False): # force is ignored on Unix, SIGTERM is sent
                    try:
                        os.kill(self.pid, 15) # SIGTERM
                    except ProcessLookupError:
                        pass # Process already ended
            
            # Set initial window size and terminal attributes for the PTY master
            initial_winsize_packed = struct.pack('HHHH', 24, 80, 0, 0)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, initial_winsize_packed)
            
            # Set terminal to raw mode and enable echo
            attrs = termios.tcgetattr(fd)
            attrs[3] &= ~termios.ICANON  # Disable canonical mode
            attrs[3] |= termios.ECHO    # Enable echo
            termios.tcsetattr(fd, termios.TCSANOW, attrs)
            
            proc_adapter = UnixPtyAdapter(pid, fd)

        # Thread to read from PTY and put data into asyncio queue
        def pty_reader_thread_target():
            try:
                while proc_adapter and proc_adapter.is_alive():
                    data = proc_adapter.read(1024) # Read up to 1KB
                    if not data: # PTY closed
                        break
                    loop.call_soon_threadsafe(pty_queue.put_nowait, data)
            except (IOError, EOFError):
                pass # Expected when PTY closes
            finally:
                loop.call_soon_threadsafe(pty_queue.put_nowait, None) # Signal EOF to sender

        # FIX: Create explicit Tasks for all three concurrent operations.
        # Old code used `asyncio.gather()` with all three, but when the client
        # disconnected, the PTY reader thread (blocked on os.read) and the sender
        # task (blocked on queue.get) could never complete because the PTY was
        # only terminated in the `finally` block AFTER `gather()` returned → deadlock.
        reader_task = asyncio.create_task(asyncio.to_thread(pty_reader_thread_target))

        # Task to send data from queue to WebSocket
        async def pty_to_ws_sender():
            while True:
                data = await pty_queue.get()
                if data is None: # EOF signal
                    break
                try:
                    await ws.send_bytes(data)
                except ConnectionResetError:
                    break # Client disconnected
            if not ws.closed:
                await ws.close()

        sender_task = asyncio.create_task(pty_to_ws_sender())

        # Task to receive data from WebSocket and write to PTY
        async def ws_to_pty_receiver():
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    try:
                        data_json = json.loads(msg.data)
                        if 'resize' in data_json and isinstance(data_json['resize'], list) and len(data_json['resize']) == 2:
                            rows, cols = data_json['resize']
                            if proc_adapter: proc_adapter.set_winsize(rows, cols)
                            print(f"🔵 [Holaf-Terminal] Resized to {rows}x{cols}")
                        # Could handle other JSON commands here
                    except (json.JSONDecodeError, TypeError):
                        # Not JSON, assume it's direct input for the terminal
                        if proc_adapter: proc_adapter.write(msg.data.encode('utf-8'))
                elif msg.type == web.WSMsgType.BINARY:
                    if proc_adapter: proc_adapter.write(msg.data)
                elif msg.type == web.WSMsgType.ERROR:
                    print(f'🔴 [Holaf-Terminal] WebSocket error: {ws.exception()}')
                    break

        receiver_task = asyncio.create_task(ws_to_pty_receiver())

        # FIX: Wait for ANY task to finish (client disconnect, PTY exit, or error),
        # then terminate the PTY and close the WebSocket to unblock remaining tasks.
        done, pending = await asyncio.wait(
            [sender_task, receiver_task, reader_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        # Terminate PTY to unblock the reader thread (causes os.read to return)
        if proc_adapter and proc_adapter.is_alive():
            proc_adapter.terminate(force=True)

        # Close WebSocket to unblock the receiver task if it's still running
        if not ws.closed:
            try:
                await ws.close()
            except Exception:
                pass

        # Wait for remaining tasks to finish cleanup (with timeout)
        for task in pending:
            try:
                await asyncio.wait_for(task, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                if not task.done():
                    task.cancel()

    except Exception as e:
        print(f"🔴 [Holaf-Terminal] Unhandled error in WebSocket PTY handler: {e}")
        traceback.print_exc()
    finally:
        print("⚫ [Holaf-Terminal] Cleaning up PTY session.")
        # Tasks are cancelled implicitly if gather raises/finishes
        # Ensure PTY process is terminated
        # FIX: Wrap in try/except to handle NameError if proc_adapter or ws
        # were never assigned (e.g., exception during WebSocket handshake)
        try:
            if proc_adapter and proc_adapter.is_alive():
                proc_adapter.terminate(force=True)
        except NameError:
            pass
        try:
            if not ws.closed:
                await ws.close()
        except (NameError, AttributeError):
            pass
    
    return ws