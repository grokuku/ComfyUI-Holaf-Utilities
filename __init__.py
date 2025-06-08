# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-15
#
# Purpose:
# This __init__.py file is the main entry point for the 'ComfyUI-Holaf-Terminal'
# custom node package. It handles security, WebSocket communication, and node registration.
#
# Design Choices & Rationale (v13 - Hybrid Setup):
# - "Try, then Guide" Setup: The backend now attempts to automatically save the new
#   password hash to config.ini.
# - Graceful Fallback: If a `PermissionError` occurs during the save attempt,
#   it hashes the password and returns the hash string to the frontend for manual setup.
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

from aiohttp import web

# --- Platform-specific imports ---
IS_WINDOWS = platform.system() == "Windows"
if not IS_WINDOWS:
    try:
        import pty, termios, tty, fcntl, select
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: pty/termios modules not found. Terminal will not work on non-Windows system.")
else:
    # MODIFICATION: Check for the correct importable module name 'winpty'
    try:
        import winpty
    except ImportError:
        print("🔴 [Holaf-Terminal] Critical: 'pywinpty' is not installed. Terminal will not work on Windows.")
        print("   Please run 'pip install pywinpty' in your ComfyUI Python environment.")
        winpty = None

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

    default_shell = 'powershell.exe' if IS_WINDOWS else ('bash' if os.path.exists('/bin/bash') else 'sh')
    
    shell_cmd = config.get('Terminal', 'shell_command', fallback=default_shell)
    password_hash = config.get('Security', 'password_hash', fallback=None)

    if not password_hash:
        password_hash = None

    return {'shell_command': shell_cmd, 'password_hash': password_hash}

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
    return web.json_response({"password_is_set": is_set})

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


from .nodes.holaf_terminal import HolafTerminal
NODE_CLASS_MAPPINGS = {"HolafTerminal": HolafTerminal}
NODE_DISPLAY_NAME_MAPPINGS = {"HolafTerminal": "Terminal (Holaf)"}
WEB_DIRECTORY = "./js"

print("\n" + "="*50)
print("✅ [Holaf-Terminal] Node initialized.")
print(f"SHELL COMMAND: {CONFIG['shell_command']}")
if CONFIG.get('password_hash'):
    print("🔑 [Holaf-Terminal] Password is set. Terminal is ENABLED.")
else:
    print("🔵 [Holaf-Terminal] No password set. Setup required in the node's UI.")
print("="*50 + "\n")
sys.stdout.flush()

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']