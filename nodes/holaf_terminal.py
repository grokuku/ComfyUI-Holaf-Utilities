# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-17
#
# Purpose:
# This file contains the backend logic for the Holaf Terminal node. It defines
# the aiohttp WebSocket handler that manages the shell process and the ComfyUI
# node class itself.
#
# Design Choices & Rationale (v30 - Final Env Logic):
# - Default shell on Windows is now `cmd.exe` (set in __init__.py) for stability.
# - The logic now correctly handles all known use cases:
#   1. ComfyUI run from an activated Conda env: Activates the same env.
#   2. ComfyUI run from an activated Venv: Inherits env correctly.
#   3. Portable ComfyUI run from a standard terminal: Works as is.
#   4. Portable ComfyUI run from a Conda-activated terminal: This was the tricky
#      case. The logic now detects this situation and cleanses the inherited
#      Conda variables from the new shell's environment to prevent conflicts
#      and incorrect prompts like "(base)".
# === End Documentation ===

import os
import sys
import platform
import asyncio
import json
import threading
import shlex
from aiohttp import web

import server
from .. import SESSION_TOKENS, CONFIG, IS_WINDOWS

if not IS_WINDOWS:
    try:
        import pty
        import termios
        import fcntl
        import tty
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: pty/termios modules not found.")
else:
    try:
        from winpty import PtyProcess
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: 'pywinpty' is not installed or accessible. Terminal will not function on Windows.")
        PtyProcess = None


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
            
            # Cleanse inherited Conda variables if a portable version was launched from a Conda prompt
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
            
            # Pass the (potentially cleansed) environment to the new process
            raw_proc = PtyProcess.spawn(shell_cmd_list, dimensions=(24, 80), env=env)
            proc = WindowsPty(raw_proc)

        else: # Unix
            pid, fd = pty.fork()
            if pid == 0:
                env["TERM"] = "xterm"
                try:
                    # Pass the (potentially cleansed) environment to the new process
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

class HolafTerminal:
    def __init__(self): pass
    @classmethod
    def INPUT_TYPES(s): return {"required": {}, "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"}}
    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    OUTPUT_NODE = True
    CATEGORY = "Holaf"
    def do_nothing(self, **kwargs): return ()