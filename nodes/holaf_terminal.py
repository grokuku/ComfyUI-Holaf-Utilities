# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-15
#
# Purpose:
# This file contains the backend logic for the Holaf Terminal node. It defines
# the aiohttp WebSocket handler that manages the shell process and the ComfyUI
# node class itself.
#
# Design Choices & Rationale (v21 - I/O Wrapper Fix):
# - The previous fix attempt for the str/bytes issue was incorrect.
# - The core problem is that pywinpty's API uses `str` for I/O, while the Unix
#   pty uses `bytes`.
# - This version introduces a `WindowsPty` wrapper class that mirrors the
#   `UnixPty` one. This new class handles the str <-> bytes conversion
#   internally, creating a consistent API for the `proc` object across
#   all platforms.
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
        if IS_WINDOWS:
            if not PtyProcess:
                await ws.close(code=1011, message=b'pywinpty library not found on server')
                return ws
            
            # MODIFICATION: Create a wrapper for the Windows PTY to handle str/bytes conversion
            class WindowsPty:
                def __init__(self, pty_process):
                    self.pty = pty_process
                
                def read(self, size):
                    # winpty returns str, encode to bytes to be consistent with Unix
                    return self.pty.read(size).encode('utf-8')
                
                def write(self, data):
                    # winpty expects str, decode from bytes
                    return self.pty.write(data.decode('utf-8', errors='ignore'))
                
                def setwinsize(self, rows, cols):
                    self.pty.setwinsize(rows, cols)

                def isalive(self):
                    return self.pty.isalive()
                    
                def terminate(self, force=False):
                    self.pty.terminate(force)

            shell_cmd_list = shlex.split(CONFIG['shell_command'])
            raw_proc = PtyProcess.spawn(shell_cmd_list, dimensions=(24, 80))
            proc = WindowsPty(raw_proc)

        else:
            # Unix uses the standard pty.fork()
            pid, fd = pty.fork()
            if pid == 0:
                env = os.environ.copy(); env["TERM"] = "xterm"
                
                shell_cmd_list = shlex.split(CONFIG['shell_command'])
                shell_path = shell_cmd_list[0]
                try:
                    os.execvpe(shell_path, shell_cmd_list, env)
                except FileNotFoundError:
                    os.execvpe("/bin/sh", ["/bin/sh"], env)
                sys.exit(1)
                
            class UnixPty:
                def __init__(self, pid, fd):
                    self.pid = pid
                    self.fd = fd
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
            """PRODUCER: Reads from PTY and puts data into the queue. Now platform-agnostic."""
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
            """CONSUMER: Gets data from queue and sends to WebSocket. Now platform-agnostic."""
            while True:
                data = await queue.get()
                if data is None: break
                try: await ws.send_bytes(data)
                except ConnectionResetError: break
            if not ws.closed: await ws.close()
        
        async def receiver():
            """RECEIVER: Gets data from WebSocket and writes to PTY. Now platform-agnostic."""
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