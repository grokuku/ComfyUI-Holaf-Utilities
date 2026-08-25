"""routes.py — Routes HTTP AIH du pack fusionné (Phase 2 chantier C).

Ce module porte les ~35 routes inline qui vivaient dans le ``__init__.py``
racine d'AI-Helper (refactorées conformément au PLAN_FUSION.md §3.5 :
suppression du chargement exotique via sys.modules pré-enregistrés,
imports standardisés, préfixes ``/aih/*`` et ``/api/aih/*`` conservés).

Architecture
------------
Un unique point d'entrée : ``register(server_routes, require_auth=None)``,
appelé UNE seule fois par le ``__init__.py`` racine de l'extension, juste
après le bootstrap du sous-package ``aih/`` (qui a ajouté la racine du pack
au ``sys.path``, rendant les imports absolus ``from aih import X`` valides).

- ``server_routes`` : l'objet ``server.PromptServer.instance.routes`` (table
  de décorateurs aiohttp) — le même que celui utilisé par toutes les routes
  ``/holaf/*`` d'Utils.
- ``require_auth``  : le décorateur d'authentification partagé Holaf
  (``holaf_auth.require_auth``), passé par le ``__init__.py`` racine. Il sert
  uniquement à sécuriser ``POST /aih/blobby/exec`` (voir groupe « blobby »).
  S'il n'est pas fourni, la garde fail-closed ``_fail_closed_auth_guard``
  remplace la route par un refus permanent (503) : jamais de shell ouvert
  par défaut.

Les groupes sont enregistrés indépendamment : l'échec d'un groupe est
journalisé mais ne prive pas les autres (robustesse héritée de la source).

Groupes (ordre historique des commits du chantier C) :
  1. ``credentials`` : GET/POST /aih/credentials, GET/POST
     /aih/elements/presets, POST /aih/elements/presets/delete,
     GET/POST /aih/openai/keys — chemins de données inchangés
     (``user/default/aih/``).
  2. ``update``      : POST /aih/update — git fetch + reset --hard
     FETCH_HEAD (stratégie d'origine conservée), renvoie ``{updated: bool}``.
     PAS d'auto-restart : le redémarrage post-update est délégué à
     l'endpoint Utils existant POST /holaf/utilities/restart (le frontend
     proposera le redémarrage quand ``updated`` est vrai). L'ancienne route
     POST /aih/restart n'est PAS recréée : le bouton Restart autonome du
     frontend appelle directement /holaf/utilities/restart.
  3. ``blobby``      : POST /aih/blobby/save + GET /aih/blobby/load
     (paramètres du companion, fichier user/default/aih/blobby.json) et
     POST /aih/blobby/exec (shell local) — cette dernière SÉCURISÉE derrière
     l'authentification par mot de passe du terminal Holaf (même mécanisme
     que GET /holaf/terminal : cookie de session signé ``holaf_session``,
     obtenu via POST /holaf/auth/login ou POST /holaf/terminal/auth) ; 401 sinon.
  4. ``models``      : /api/aih/models/* (liste locale/distante, upload et
     download SFTP chunked via paramiko, fingerprint head/tail, progression)
     portés fidèlement depuis AIH_ComfyUI/nodes/model_manager.py →
     ``aih/model_manager.py`` ; /api/aih/custom-nodes* depuis
     AIH_ComfyUI/nodes/custom_nodes_manager.py → ``aih/custom_nodes_manager.py``
     (SANS l'auto ``pip install`` post-clone, interdit — cf. §3.3).
  5. ``local``       : GET /aih/local/status, /aih/local/api/* (miroirs du
     store SQLite, sync/outbox/conflicts/retry, recherche sémantique,
     embeddings, music3), service statique du frontend site (copié dans
     ``<pack>/aih_frontend/``) sous /aih/local/, et démarrage du moteur de
     synchronisation daemon (comportement d'origine du mode local).

Non portés volontairement :
  - GET /aih/terminal (WebSocket PTY **sans mot de passe**) : ABANDONNÉ —
    décision « terminal unique Utils » (PLAN_FUSION.md §2.2). Le seul shell
    interactif du pack fusionné reste GET /holaf/terminal (authentifié).
  - POST /aih/restart : REMPLACÉ par la réutilisation directe de
    POST /holaf/utilities/restart (rien à créer côté backend).
  - Tout ``pip install`` automatique (INTERDIT, PLAN_FUSION.md §3.3).

Contrat POST /aih/update (pour le chantier D — widgets JS) :
    200 {"status": "ok"|..., "message": str, "log": str, "updated": bool,
         "before": "<sha>", "after": "<sha>"}   (before/after présents selon
                                                    le cas « déjà à jour » /
                                                    mise à jour appliquée)
    500 {"status": "error", "message": str, "log": str, "updated": false}
    Si ``updated`` est vrai, le repo a été reset --hard sur FETCH_HEAD :
    le frontend DOIT proposer un redémarrage via POST /holaf/utilities/restart
    pour charger le nouveau code.
"""

import json
import logging
import os
from datetime import datetime

from aiohttp import web

# Socle léger (pur Python, aucun effet de bord à l'import) : le helper de
# credentials partagé du sous-package aih/ — mêmes fonctions que la source
# (ex AIH_ComfyUI/nodes/_credentials.py, renommé aih.credentials au chantier A).
from aih import credentials

# Racine du pack (routes.py vit dans <pack>/aih/). Utilisée par le groupe
# « local » pour localiser aih_frontend/.
_PACK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Helpers communs ───────────────────────────────────────────────────

def _get_aih_user_dir():
    """Dossier user/default/aih de ComfyUI (identique à la source AI-Helper).

    ⚠️ Chemin conservé À L'IDENTIQUE (presets, clés OpenAI, blobby.json...)
    pour ne pas perdre les données des utilisateurs d'AI-Helper.
    """
    try:
        import folder_paths
        user_dir = folder_paths.get_user_directory()
    except Exception:
        user_dir = os.path.join(os.path.dirname(_PACK_ROOT), "user")
    return os.path.join(user_dir, "default", "aih")


def _get_presets_path():
    """Chemin du fichier de presets de l'Elements Picker (inchangé)."""
    return os.path.join(_get_aih_user_dir(), "aih_elements_presets.json")


class _RecordingRoutes:
    """Proxy mince autour de l'objet ``routes`` du PromptServer.

    Journalise chaque couple (méthode, chemin) au moment du décorateur afin
    d'afficher un récapitulatif au boot et de permettre un test hors ComfyUI
    (un faux objet exposant seulement get/post suffit à ``register()``).
    Les méthodes retournent directement le décorateur aiohttp sous-jacent.
    """

    def __init__(self, target, log):
        self._target = target
        self._log = log

    def get(self, path):
        self._log.append(("GET", path))
        return self._target.get(path)

    def post(self, path):
        self._log.append(("POST", path))
        return self._target.post(path)


def _fail_closed_auth_guard(handler):
    """Garde-fou fail-closed si aucune fonction d'auth n'est fournie.

    Utilisé pour /aih/blobby/exec quand ``register()`` est appelé sans
    ``require_auth`` (contexte où holaf_auth serait indisponible) : on
    préfère une route morte (503 permanent) à une route de shell ouverte.
    """
    async def wrapper(request):
        return web.json_response(
            {"ok": False, "error": "Authentication unavailable: endpoint disabled."},
            status=503,
        )
    return wrapper


# ══════════════════════════════════════════════════════════════════════
# GROUPE 1 — Credentials & clés & presets (chemins de données inchangés)
# ══════════════════════════════════════════════════════════════════════

def _register_credentials_group(r):
    """GET/POST /aih/credentials, /aih/elements/presets*, /aih/openai/keys."""

    # ── Credentials (lecture / ecriture du fichier local) ──────────────
    # Le menu AIH → Compte appelle ces routes pour lire/ecrire
    # user/default/aih/credentials.json (api_key + server_url).
    # Les nodes Python lisent ce fichier via aih.credentials.

    @r.get("/aih/credentials")
    async def aih_get_credentials_route(request):
        try:
            creds = credentials._load_aih_credentials(use_cache=False)
            creds_path = credentials.get_credentials_path()
            return web.json_response({
                "status": "ok",
                "api_key": creds.get("api_key", ""),
                "server_url": creds.get("server_url", "https://kw.holaf.fr"),
                "path": creds_path,
                "exists": os.path.isfile(creds_path),
            })
        except Exception as e:
            return web.json_response({
                "status": "error",
                "message": f"Exception: {e}",
            }, status=500)

    @r.post("/aih/credentials")
    async def aih_save_credentials_route(request):
        try:
            data = await request.json()
            api_key = (data.get("api_key") or "").strip()
            server_url = (data.get("server_url") or "https://kw.holaf.fr").strip()

            creds_path = credentials.get_credentials_path()
            os.makedirs(os.path.dirname(creds_path), exist_ok=True)

            # Permissions restrictives (Linux)
            old_umask = None
            if os.name != 'nt':
                old_umask = os.umask(0o077)
            try:
                with open(creds_path, "w", encoding="utf-8") as f:
                    json.dump({
                        "api_key": api_key,
                        "server_url": server_url,
                        "updated_at": datetime.utcnow().isoformat() + "Z",
                    }, f, indent=2)
            finally:
                if old_umask is not None:
                    os.umask(old_umask)

            # Invalider le cache pour que les nodes lisent la nouvelle valeur
            credentials.invalidate_cache()

            return web.json_response({
                "status": "ok",
                "path": creds_path,
                "api_key_len": len(api_key),
            })
        except Exception as e:
            import traceback
            return web.json_response({
                "status": "error",
                "message": f"Exception: {e}",
                "log": traceback.format_exc(),
            }, status=500)

    # ── Elements Presets (sauvegarde locale dans user/default/aih/) ────
    # Les presets de l'Elements Picker sont stockés dans un fichier JSON
    # local pour ne pas saturer le workflow ni être partagés avec d'autres.

    @r.get("/aih/elements/presets")
    async def aih_get_elements_presets(request):
        """Liste tous les presets sauvegardés."""
        try:
            presets_path = _get_presets_path()
            if os.path.isfile(presets_path):
                with open(presets_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return web.json_response({"status": "ok", "presets": data.get("presets", [])})
            return web.json_response({"status": "ok", "presets": []})
        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @r.post("/aih/elements/presets")
    async def aih_save_elements_preset(request):
        """Sauvegarde ou met à jour un preset, ou action cleanup."""
        try:
            body = await request.json()

            # ── Action cleanup : vide le fichier local (après migration distante) ──
            if body.get("action") == "cleanup":
                presets_path = _get_presets_path()
                if os.path.isfile(presets_path):
                    with open(presets_path, "w", encoding="utf-8") as f:
                        json.dump({"presets": []}, f)
                return web.json_response({"status": "ok", "cleaned": True})

            name = body.get("name", "").strip()
            preset_data = body.get("data", {})
            if not name:
                return web.json_response({"status": "error", "message": "Name required"}, status=400)

            presets_path = _get_presets_path()
            os.makedirs(os.path.dirname(presets_path), exist_ok=True)

            # Lire les presets existants
            presets = []
            if os.path.isfile(presets_path):
                with open(presets_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    presets = data.get("presets", [])

            # Chercher si un preset avec ce nom existe déjà (update)
            existing_idx = None
            for i, p in enumerate(presets):
                if p.get("name") == name:
                    existing_idx = i
                    break

            preset_obj = {
                "name": name,
                "data": preset_data,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            }

            if existing_idx is not None:
                presets[existing_idx] = preset_obj
            else:
                presets.append(preset_obj)

            with open(presets_path, "w", encoding="utf-8") as f:
                json.dump({"presets": presets}, f, indent=2, ensure_ascii=False)

            return web.json_response({"status": "ok", "name": name, "count": len(presets)})
        except Exception as e:
            import traceback
            return web.json_response({"status": "error", "message": str(e), "log": traceback.format_exc()}, status=500)

    @r.post("/aih/elements/presets/delete")
    async def aih_delete_elements_preset(request):
        """Supprime un preset par son nom."""
        try:
            body = await request.json()
            name = body.get("name", "").strip()
            if not name:
                return web.json_response({"status": "error", "message": "Name required"}, status=400)

            presets_path = _get_presets_path()
            if not os.path.isfile(presets_path):
                return web.json_response({"status": "ok", "deleted": False})

            with open(presets_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                presets = data.get("presets", [])

            new_presets = [p for p in presets if p.get("name") != name]

            with open(presets_path, "w", encoding="utf-8") as f:
                json.dump({"presets": new_presets}, f, indent=2, ensure_ascii=False)

            return web.json_response({"status": "ok", "deleted": len(presets) != len(new_presets)})
        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    # ── OpenAI API Keys (stockage local par base_url) ──────────────────

    @r.get("/aih/openai/keys")
    async def aih_get_openai_keys(request):
        """Retourne les clés API stockées, optionnellement filtrées par base_url."""
        try:
            keys_path = os.path.join(_get_aih_user_dir(), "openai_keys.json")
            data = {}
            if os.path.isfile(keys_path):
                with open(keys_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            # Filtrer par base_url si demandé
            base_url = request.query.get("base_url", "").rstrip("/")
            if base_url:
                return web.json_response({"status": "ok", "key": data.get(base_url, "")})
            return web.json_response({"status": "ok", "keys": data})
        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @r.post("/aih/openai/keys")
    async def aih_save_openai_key(request):
        """Sauvegarde une clé API pour un base_url donné."""
        try:
            body = await request.json()
            base_url = (body.get("base_url") or "").strip().rstrip("/")
            api_key = (body.get("api_key") or "").strip()
            if not base_url:
                return web.json_response({"status": "error", "message": "base_url required"}, status=400)

            keys_path = os.path.join(_get_aih_user_dir(), "openai_keys.json")
            os.makedirs(os.path.dirname(keys_path), exist_ok=True)

            # Lire les clés existantes
            data = {}
            if os.path.isfile(keys_path):
                with open(keys_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

            if api_key:
                data[base_url] = api_key
            elif base_url in data:
                del data[base_url]  # Supprimer si clé vide

            with open(keys_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            return web.json_response({"status": "ok", "base_url": base_url})
        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)


# ══════════════════════════════════════════════════════════════════════
# GROUPE 2 — Update (POST /aih/update, SANS auto-restart)

def _register_update_group(r):
    """POST /aih/update — git fetch + reset --hard FETCH_HEAD.

    Contrat pour le chantier D (widgets JS) :
        200 {"status": str, "message": str, "log": str, "updated": bool,
             "before"?: sha, "after"?: sha}
        500 {"status": "error", ..., "updated": false}
    Si ``updated`` est vrai : le repo local a été mis à jour sur disque mais
    le code chargé en mémoire est l'ancien. Le frontend doit PROPOSER un
    redémarrage et appeler l'endpoint Utils existant
    POST /holaf/utilities/restart — cette route ne redémarre JAMAIS seule
    (l'auto os.execv de la source AI-Helper a été retiré volontairement,
    cf. aih/update_manager.py). L'ancienne POST /aih/restart n'est pas
    recréée : le bouton Restart autonome appelle directement
    /holaf/utilities/restart.
    """
    from aih import update_manager as _update_manager

    @r.post("/aih/update")
    async def aih_update_route(request):
        try:
            result = _update_manager.update_repo()
            return web.json_response(result)
        except Exception as e:
            import traceback
            return web.json_response({
                "status": "error",
                "message": f"Exception: {e}",
                "log": traceback.format_exc(),
                "updated": False,
            }, status=500)



# GROUPE 3 — Blobby Companion (settings + exec SÉCURISÉ)

def _get_blobby_file():
    """Chemin des paramètres du companion : user/default/aih/blobby.json.

    Porté de AIH_ComfyUI/blobby_companion/settings_api.py (chemin inchangé),
    avec migration paresseuse depuis l'ancien user/default/aih_blobby.json.
    Calculé à la volée (et non à l'import comme la source) pour rester
    testable hors ComfyUI.
    """
    try:
        import folder_paths
        user_dir = folder_paths.get_user_directory()
    except Exception:
        user_dir = os.path.expanduser("~")
    blobby_file = os.path.join(user_dir, "default", "aih", "blobby.json")

    # Migration depuis l'ancien emplacement : user/default/aih_blobby.json
    try:
        old_blobby = os.path.join(user_dir, "default", "aih_blobby.json")
        if os.path.isfile(old_blobby) and not os.path.isfile(blobby_file):
            import shutil
            os.makedirs(os.path.dirname(blobby_file), exist_ok=True)
            shutil.move(old_blobby, blobby_file)
            logging.info(f"[Blobby] Migrated {old_blobby} → {blobby_file}")
    except Exception as e:
        logging.warning(f"[Blobby] Migration failed: {e}")
    return blobby_file


def _register_blobby_group(r, require_auth):
    """Routes du Blobby Companion.

    - POST /aih/blobby/save + GET /aih/blobby/load : stockage JSON clé→valeur
      des paramètres du companion (fichier local, portage fidèle — pas
      d'authentification à la source, CSRF middleware global d'Utils actif).
    - POST /aih/blobby/exec : exécution shell locale. 🔴 À la source, cette
      route était OUVERTE (aucune auth). Elle est ici PORTÉE UNIQUEMENT
      SÉCURISÉE derrière l'authentification par mot de passe du terminal
      Holaf : le décorateur ``require_auth`` (holaf_auth.require_auth, passé
      par le __init__.py racine) vérifie le cookie de session signé
      ``holaf_session`` — exactement la même garde que GET /holaf/terminal.
      Le client doit donc s'authentifier au préalable via
      POST /holaf/auth/login ou POST /holaf/terminal/auth (le cookie part
      ensuite automatiquement sur chaque requête même origine). Sans session
      valide → 401. Si aucun décorateur n'a été fourni à register(), une
      garde fail-closed renvoie 503 en permanence : jamais de shell ouvert.
    """

    @r.post("/aih/blobby/save")
    async def aih_blobby_save_route(request):
        try:
            body = await request.json()
            key = body.get("key")
            data = body.get("data")
            if not key:
                return web.json_response({"error": "key required"}, status=400)
            blobby_file = _get_blobby_file()
            all_data = {}
            if os.path.isfile(blobby_file):
                with open(blobby_file, "r", encoding="utf-8") as f:
                    all_data = json.load(f)
            all_data[key] = data
            os.makedirs(os.path.dirname(blobby_file), exist_ok=True)
            with open(blobby_file, "w", encoding="utf-8") as f:
                json.dump(all_data, f, indent=2, ensure_ascii=False)
            return web.json_response({"status": "ok"})
        except Exception as e:
            logging.error(f"[Blobby] save error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    @r.get("/aih/blobby/load")
    async def aih_blobby_load_route(request):
        try:
            key = request.query.get("key")
            if not key:
                return web.json_response({"error": "key required"}, status=400)
            blobby_file = _get_blobby_file()
            all_data = {}
            if os.path.isfile(blobby_file):
                with open(blobby_file, "r", encoding="utf-8") as f:
                    all_data = json.load(f)
            return web.json_response({"data": all_data.get(key, None)})
        except Exception as e:
            logging.error(f"[Blobby] load error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    # ── Blobby Exec (commandes shell locales) — AUTH OBLIGATOIRE ────────

    guard = require_auth if require_auth is not None else _fail_closed_auth_guard

    @r.post("/aih/blobby/exec")
    @guard
    async def aih_blobby_exec_route(request):
        """Exécute une commande shell locale sur la machine ComfyUI."""
        import subprocess as _sp
        try:
            data = await request.json()
            action = (data.get("action") or "").strip()

            if action == "shell":
                cmd = (data.get("command") or "").strip()
                if not cmd:
                    return web.json_response({"ok": False, "output": "⚠️ Commande vide"}, status=400)
                # Limiter la durée des commandes shell.
                # Utiliser /bin/bash si disponible (boucles for, etc.)
                shell = os.environ.get('SHELL', '/bin/sh')
                if os.path.exists('/bin/bash'):
                    shell = '/bin/bash'
                try:
                    proc = _sp.run(cmd, shell=True, executable=shell,
                                   capture_output=True, text=True, timeout=15)
                    out = proc.stdout.strip()
                    if proc.stderr:
                        out += "\n" + proc.stderr.strip()
                    if proc.returncode != 0:
                        out += f"\n❌ Code: {proc.returncode}"
                    if not out:
                        out = "✅ Commande exécutée (pas de sortie)"
                    return web.json_response({"ok": True, "output": out})
                except _sp.TimeoutExpired:
                    return web.json_response({"ok": False, "output": "⏱️ Commande trop longue (>15s)"})
                except Exception as e:
                    return web.json_response({"ok": False, "output": f"❌ Erreur: {e}"})

            return web.json_response({"ok": False, "output": f"Action '{action}' inconnue"}, status=400)

        except Exception as e:
            import traceback
            return web.json_response(
                {"ok": False, "output": f"❌ Erreur: {e}", "log": traceback.format_exc()},
                status=500,
            )



# POINT D'ENTRÉE — appelé une fois par le __init__.py racine
# ══════════════════════════════════════════════════════════════════════

def register(server_routes, require_auth=None):
    """Enregistre toutes les routes AIH sur l'objet routes du PromptServer.

    Args:
        server_routes: ``server.PromptServer.instance.routes``.
        require_auth: décorateur d'authentification partagé Holaf
            (``holaf_auth.require_auth``). Utilisé exclusivement par
            /aih/blobby/exec ; absent → garde fail-closed (503).

    Returns:
        int: nombre de routes effectivement enregistrées.
    """
    log = []
    r = _RecordingRoutes(server_routes, log)

    def _safe(name, fn, *args):
        try:
            fn(*args)
            return True
        except Exception:
            logging.exception(f"[AIH-Routes] Échec de l'enregistrement du groupe '{name}'.")
            return False

    print("--- Registering AIH HTTP routes (aih/routes.py) ---")
    _safe("credentials", _register_credentials_group, r)
    _safe("update", _register_update_group, r)
    _safe("blobby", _register_blobby_group, r, require_auth)
    _safe("models", _register_models_group, r)
    _safe("local", _register_local_group, r)

    for method, path in log:
        print(f"  • [AIH] {method:<4} {path}")
    print(f"✅ [AIH-Routes] {len(log)} route(s) AIH enregistrée(s).")
    return len(log)


# Groupes models/local — remplis par les commits incrémentaux suivants :
def _register_models_group(r):
    return 0


def _register_local_group(r):
    return 0
