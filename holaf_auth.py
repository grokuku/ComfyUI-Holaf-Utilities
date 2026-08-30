# === Holaf Utilities - Shared Authentication ===
#
# Developer: Gemini (AI Assistant), under the direction of Holaf
# Date: 2025-06-01
#
# Purpose:
# Shared, stateless authentication for the Holaf utilities. It reuses the
# password hash stored in config.ini ([Security] / password_hash) and issues a
# signed, expiring cookie (holaf_session) instead of keeping server-side state.
# The signing key is persisted as [Security] / session_secret and generated on
# first use so sessions survive ComfyUI restarts.
#
# Security notes:
# - Password hashing is PBKDF2-HMAC-SHA256 (the same algorithm already used by
#   holaf_terminal.py / __main__.py).
# - Session tokens are HMAC-SHA256 signed payloads. No server-side session store
#   is required; validation recomputes the MAC and checks the expiry.
# - Client-facing errors are intentionally generic to avoid leaking whether a
#   password is configured or which part of a token is invalid.
# === End Documentation ===

import base64
import binascii
import collections
import functools
import hashlib
import hmac
import json
import os
import secrets
import threading
import time

from aiohttp import web

from . import holaf_config

SESSION_COOKIE_NAME = "holaf_session"
SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60  # 30 days
PBKDF2_ITERATIONS = 260000

# --- Brute-force rate limiting (login attempts) ---
# Bloque les attaques en ligne sur le mot de passe du terminal :
#   - par IP : RATE_LIMIT_MAX_FAILURES échecs dans la fenêtre → lockout ;
#   - global  : backstop contre le spoofing X-Forwarded-For (rotation d'IP).
# Surchargeable via l'environnement (défauts raisonnables : 5 / 15 min).
RATE_LIMIT_MAX_FAILURES = int(os.environ.get("AIH_RATE_LIMIT_MAX_FAILURES", "5"))
RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("AIH_RATE_LIMIT_WINDOW_SECONDS", "900"))  # 15 min
RATE_LIMIT_GLOBAL_MAX = int(os.environ.get("AIH_RATE_LIMIT_GLOBAL_MAX", "50"))
RATE_LIMIT_GLOBAL_WINDOW_SECONDS = int(os.environ.get("AIH_RATE_LIMIT_GLOBAL_WINDOW_SECONDS", "60"))
RATE_LIMIT_MAX_TRACKED_IPS = 1024

_rate_limit_lock = threading.Lock()
_failed_logins = collections.defaultdict(collections.deque)  # ip -> timestamps (monotonic)
_global_failures = collections.deque()  # timestamps (monotonic), toutes IP confondues

_session_secret_lock = threading.Lock()
_session_secret_cache = None


# --- Password hashing (factorized from holaf_terminal.py) ---
def hash_password(password: str) -> str:
    """Return a PBKDF2-HMAC-SHA256 password hash (salt$digest, hex encoded)."""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), salt, PBKDF2_ITERATIONS
    )
    return f"{salt.hex()}${digest.hex()}"


def verify_password(stored_hash, provided_password) -> bool:
    """Return True if *provided_password* matches *stored_hash*."""
    if not stored_hash or not provided_password:
        return False
    try:
        salt_hex, key_hex = stored_hash.split('$', 1)
        salt = bytes.fromhex(salt_hex)
        key = bytes.fromhex(key_hex)
    except (ValueError, TypeError):
        return False

    new_key = hashlib.pbkdf2_hmac(
        'sha256', provided_password.encode('utf-8'), salt, PBKDF2_ITERATIONS
    )
    return hmac.compare_digest(new_key, key)


# --- Session secret persistence ---
def _load_session_secret():
    try:
        config_parser = holaf_config.get_config_parser()
        secret = config_parser.get('Security', 'session_secret', fallback='')
    except Exception:
        return None
    secret = (secret or '').strip()
    return secret or None


def _persist_session_secret(secret):
    config_path = holaf_config.get_config_path()
    try:
        config_parser = holaf_config.get_config_parser()
        if not config_parser.has_section('Security'):
            config_parser.add_section('Security')
        config_parser.set('Security', 'session_secret', secret)

        # Write atomically so a crash mid-write cannot corrupt config.ini.
        tmp_path = f"{config_path}.tmp"
        with open(tmp_path, 'w', encoding='utf-8') as config_file:
            config_parser.write(config_file)
        os.replace(tmp_path, config_path)
    except Exception as e:
        # Persistence is best-effort: if config.ini is read-only or malformed,
        # the session still works for this process but will not survive a restart.
        print(f"🔴 [Holaf-Auth] Could not persist session_secret: {e}")


def get_session_secret() -> str:
    """Return the HMAC signing key, generating and persisting it on first use."""
    global _session_secret_cache
    with _session_secret_lock:
        if _session_secret_cache:
            return _session_secret_cache

        secret = _load_session_secret()
        if not secret:
            secret = secrets.token_hex(32)  # 256 bits of entropy
            _persist_session_secret(secret)

        _session_secret_cache = secret
        return secret


# --- Signed stateless session tokens ---
def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def _b64url_decode(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign(payload_b64: str) -> str:
    secret = get_session_secret()
    return hmac.new(
        secret.encode('ascii'),
        payload_b64.encode('ascii'),
        hashlib.sha256,
    ).hexdigest()


def create_session_token(now: int | None = None) -> str:
    """Create a signed, expiring session token."""
    if now is None:
        now = int(time.time())
    payload = {
        "iat": now,
        "exp": now + SESSION_MAX_AGE_SECONDS,
    }
    payload_b64 = _b64url_encode(
        json.dumps(payload, separators=(',', ':')).encode('utf-8')
    )
    return f"{payload_b64}.{_sign(payload_b64)}"


def validate_session_token(token, now: int | None = None) -> bool:
    """Return True if *token* has a valid signature and has not expired."""
    if not token or not isinstance(token, str):
        return False
    if now is None:
        now = int(time.time())

    try:
        payload_b64, signature = token.split('.', 1)
    except ValueError:
        return False

    if not payload_b64 or not signature:
        return False

    expected_signature = _sign(payload_b64)
    if not hmac.compare_digest(expected_signature, signature):
        return False

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode('utf-8'))
        expires_at = int(payload.get('exp', 0))
    except (binascii.Error, ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return False

    return expires_at > now


# --- Cookie helpers ---
def _is_secure_request(request: web.Request) -> bool:
    """Detect HTTPS, including the common reverse-proxy TLS offload header."""
    forwarded_proto = (
        request.headers.get('X-Forwarded-Proto', '').split(',')[0].strip().lower()
    )
    if forwarded_proto:
        return forwarded_proto == 'https'
    return request.scheme == 'https'


def set_session_cookie(response: web.Response, request: web.Request, token: str | None = None) -> str:
    """Attach the shared session cookie to *response* and return the token."""
    if token is None:
        token = create_session_token()

    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite='Strict',
        secure=_is_secure_request(request),
        path='/',
    )
    return token


def clear_session_cookie(response: web.Response):
    response.del_cookie(SESSION_COOKIE_NAME, path='/')


def is_authenticated(request: web.Request) -> bool:
    """Return True if the request carries a valid holaf_session cookie."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    return bool(token) and validate_session_token(token)


# --- Route-level auth guard ---
def require_auth(handler):
    """Decorator that rejects unauthenticated requests with a clean 401 JSON."""
    @functools.wraps(handler)
    async def wrapper(request: web.Request, *args, **kwargs):
        if not is_authenticated(request):
            return web.json_response(
                {"success": False, "error": "Authentication required."},
                status=401,
            )
        return await handler(request, *args, **kwargs)

    return wrapper


# --- Unified auth endpoints ---
async def login_route(request: web.Request, global_config) -> web.Response:
    """POST /holaf/auth/login"""
    if is_rate_limited(request):
        return web.json_response(
            {"success": False, "error": "Too many attempts. Try again later."},
            status=429,
        )
    password_hash = global_config.get('password_hash')
    password = None
    try:
        data = await request.json()
        if isinstance(data, dict):
            password = data.get('password')
    except Exception:
        password = None

    # Generic message on purpose: do not reveal whether a password is set.
    if not password_hash or not verify_password(password_hash, password):
        record_failed_login(request)
        return web.json_response(
            {"success": False, "error": "Invalid credentials."},
            status=401,
        )

    clear_failed_logins(request)
    response = web.json_response({"success": True})
    set_session_cookie(response, request)
    return response


# --- Rate limiting helpers (exposés pour les autres routes d'auth) ---

def _client_ip(request: web.Request) -> str:
    """IP du client, best-effort : 1er X-Forwarded-For (proxy Caddy) sinon peer."""
    xff = request.headers.get('X-Forwarded-For', '')
    first = xff.split(',')[0].strip() if xff else ''
    if first and len(first) <= 64:
        return first
    return request.remote or 'unknown'


def _prune_older_than(dq, now, window):
    while dq and now - dq[0] > window:
        dq.popleft()


def is_rate_limited(request: web.Request) -> bool:
    """True si la requête est en lockout (trop d'échecs récents, par IP ou global)."""
    now = time.monotonic()
    with _rate_limit_lock:
        _prune_older_than(_global_failures, now, RATE_LIMIT_GLOBAL_WINDOW_SECONDS)
        if len(_global_failures) >= RATE_LIMIT_GLOBAL_MAX:
            return True
        ip = _client_ip(request)
        dq = _failed_logins[ip]
        _prune_older_than(dq, now, RATE_LIMIT_WINDOW_SECONDS)
        return len(dq) >= RATE_LIMIT_MAX_FAILURES


def record_failed_login(request: web.Request) -> None:
    """Enregistre un échec d'authentification (bucket par IP + compteur global)."""
    now = time.monotonic()
    ip = _client_ip(request)
    with _rate_limit_lock:
        _global_failures.append(now)
        _failed_logins[ip].append(now)
        # Borne la mémoire : purge les entrées IP inactives au-delà du seuil.
        if len(_failed_logins) > RATE_LIMIT_MAX_TRACKED_IPS:
            for key in list(_failed_logins):
                dq = _failed_logins[key]
                _prune_older_than(dq, now, RATE_LIMIT_WINDOW_SECONDS)
                if not dq:
                    del _failed_logins[key]


def clear_failed_logins(request: web.Request) -> None:
    """Réinitialise le compteur d'échecs de l'IP (login réussi)."""
    ip = _client_ip(request)
    with _rate_limit_lock:
        _failed_logins.pop(ip, None)


async def logout_route(request: web.Request) -> web.Response:
    """POST /holaf/auth/logout"""
    response = web.json_response({"success": True})
    clear_session_cookie(response)
    return response


async def status_route(request: web.Request, global_config=None) -> web.Response:
    """GET /holaf/auth/status"""
    return web.json_response({
        "authenticated": is_authenticated(request),
        "password_configured": bool(global_config.get('password_hash')) if global_config else None,
    })
