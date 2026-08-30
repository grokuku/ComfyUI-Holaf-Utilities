"""Tests du rate limiting d'authentification (holaf_auth).

Le package ComfyUI-AI-Helper n'étant pas importable directement (tiret dans
le nom du dossier), on le charge sous un nom Python valide via importlib.

Le module holaf_auth lit ses constantes de rate limiting depuis l'environnement
AU MOMENT de l'import → les variables sont fixées avant tout chargement.
"""

import asyncio
import importlib.util
import io
import os
import sys
import types
from pathlib import Path

import pytest

# ── Config déterministe AVANT l'import de holaf_auth ───────────────────
os.environ["AIH_RATE_LIMIT_MAX_FAILURES"] = "5"
os.environ["AIH_RATE_LIMIT_WINDOW_SECONDS"] = "900"
os.environ["AIH_RATE_LIMIT_GLOBAL_MAX"] = "6"
os.environ["AIH_RATE_LIMIT_GLOBAL_WINDOW_SECONDS"] = "60"

PACKAGE_DIR = Path(__file__).resolve().parent.parent
_PKG = "holaf_utils_pkg"


def _load_module(name):
    spec = importlib.util.spec_from_file_location(f"{_PKG}.{name}", PACKAGE_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[f"{_PKG}.{name}"] = module
    spec.loader.exec_module(module)
    return module


# Charge le package synthétique une seule fois (session)
_pkg = types.ModuleType(_PKG)
_pkg.__path__ = [str(PACKAGE_DIR)]
sys.modules[_PKG] = _pkg
_load_module("holaf_config")
auth = _load_module("holaf_auth")


class _FakeRequest:
    """Requête minimale pour les helpers de rate limiting."""

    def __init__(self, remote="10.0.0.1", xff=None):
        self.remote = remote
        self.headers = {"X-Forwarded-For": xff} if xff else {}


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """État global du rate limiter remis à zéro avant chaque test."""
    auth._failed_logins.clear()
    auth._global_failures.clear()
    yield


# ── Bucket par IP ─────────────────────────────────────────────────────


def test_not_limited_below_threshold():
    req = _FakeRequest(xff="203.0.113.7")
    for _ in range(4):
        auth.record_failed_login(req)
    assert auth.is_rate_limited(req) is False


def test_locked_after_5_failures():
    req = _FakeRequest(xff="203.0.113.7")
    for _ in range(5):
        auth.record_failed_login(req)
    assert auth.is_rate_limited(req) is True


def test_clear_on_success():
    req = _FakeRequest(xff="203.0.113.7")
    for _ in range(4):
        auth.record_failed_login(req)
    auth.clear_failed_logins(req)
    assert auth.is_rate_limited(req) is False


def test_per_ip_independent():
    ip_a = _FakeRequest(xff="203.0.113.7")
    ip_b = _FakeRequest(xff="198.51.100.9")
    for _ in range(5):
        auth.record_failed_login(ip_a)
    assert auth.is_rate_limited(ip_a) is True
    assert auth.is_rate_limited(ip_b) is False  # l'IP B n'est pas punie


def test_xff_first_entry_is_used():
    """Le bucket est keyé sur le 1er X-Forwarded-For, pas sur le peer."""
    with_xff = _FakeRequest(remote="172.17.0.2", xff="203.0.113.7")
    other_peer = _FakeRequest(remote="172.17.0.3", xff="203.0.113.7")
    for _ in range(5):
        auth.record_failed_login(with_xff)
    assert auth.is_rate_limited(other_peer) is True  # même XFF → même bucket


# ── Backstop global (anti-spoofing XFF) ───────────────────────────────


def test_global_backstop_after_6_failures():
    for i in range(6):
        auth.record_failed_login(_FakeRequest(xff=f"203.0.113.{i + 10}"))
    # 6 échecs globaux >= AIH_RATE_LIMIT_GLOBAL_MAX(6) → tout le monde bloqué
    fresh = _FakeRequest(xff="198.51.100.77")
    assert auth.is_rate_limited(fresh) is True


# ── Comportement HTTP réel de la route /holaf/auth/login ──────────────


def _make_login_client(cfg):
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer

    app = web.Application()

    async def handler(request):
        return await auth.login_route(request, cfg)

    app.router.add_post("/holaf/auth/login", handler)
    return TestClient(TestServer(app))


def test_login_route_returns_429_after_5_failures():
    async def run():
        cfg = {"password_hash": "not-a-real-hash"}
        client = _make_login_client(cfg)
        await client.start_server()
        try:
            for _ in range(5):
                resp = await client.post(
                    "/holaf/auth/login", json={"password": "wrong"},
                    headers={"X-Forwarded-For": "203.0.113.7"},
                )
                assert resp.status == 401
            resp = await client.post(
                "/holaf/auth/login", json={"password": "wrong"},
                headers={"X-Forwarded-For": "203.0.113.7"},
            )
            assert resp.status == 429
        finally:
            await client.close()

    asyncio.run(run())


def test_login_route_ok_clears_failures():
    async def run():
        cfg = {"password_hash": auth.hash_password("s3cret-password-ok")}
        client = _make_login_client(cfg)
        await client.start_server()
        try:
            # 4 échecs puis succès → le compteur est réinitialisé
            for _ in range(4):
                resp = await client.post(
                    "/holaf/auth/login", json={"password": "wrong"},
                    headers={"X-Forwarded-For": "203.0.113.8"},
                )
                assert resp.status == 401
            resp = await client.post(
                "/holaf/auth/login", json={"password": "s3cret-password-ok"},
                headers={"X-Forwarded-For": "203.0.113.8"},
            )
            assert resp.status == 200
            # 1 nouvel échec : le bucket IP a été réinitialisé par le succès
            # (sans clear, 4+1=5 ≥ 5 → limité ; avec clear, 1 < 5 → non limité).
            # Le compteur global (backstop) continue : 4+1=5 < global_max(6).
            resp = await client.post(
                "/holaf/auth/login", json={"password": "wrong"},
                headers={"X-Forwarded-For": "203.0.113.8"},
            )
            assert resp.status == 401
            assert auth.is_rate_limited(_FakeRequest(xff="203.0.113.8")) is False
        finally:
            await client.close()

    asyncio.run(run())
