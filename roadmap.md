# Rapport d'Analyse de Bugs — ComfyUI-Holaf-Utils

**Date :** 2026-06-17  
**Analyseur :** Pi (Coding Agent)  
**Version du projet :** Refactoring multi-module (Schema v13)

---

## LÉGENDE

| Symbole | Sévérité | Description |
|---------|----------|-------------|
| 🔴 **CRITICAL** | Bloquant | Provoque un crash, une perte de données, ou une vulnérabilité de sécurité |
| 🟠 **IMPORTANT** | Majeur | Fonctionnalité cassée ou comportement gravement incorrect |
| 🟡 **MODERATE** | Modéré | Bug fonctionnel mais contournable, ou performance dégradée |
| ⚪ **MINOR** | Mineur | Problème cosmétique, UI/UX, ou code mort |
| ✅ **FIXED** | Corrigé | Bug confirmé et corrigé |
| ❌ **FALSE POSITIVE** | Faux positif | Analyse initiale incorrecte après vérification approfondie |

---

## 1. 🔴 BUGS CRITIQUES

### ✅ 1.1 — `process_video_route` : Memory leak dans `_video_processing_locks`

**Fichier :** `holaf_image_viewer_backend/routes/edit_routes.py`  
**Statut :** CORRIGÉ

**Problème :** Le cleanup de `_video_processing_locks` était du code mort placé après un `return` à l'intérieur d'un bloc `async with path_lock:`. Le `return` sortait du context manager (libérant le lock), mais le code de cleanup après le bloc n'était jamais exécuté. Le dictionnaire `_video_processing_locks` grossissait indéfiniment.

**Correctif appliqué :** Restructuration pour éviter le `return` à l'intérieur du `async with path_lock:`. La réponse est stockée dans une variable `response`, le lock est relâché, puis le cleanup s'exécute avant le `return` final.

---

### ✅ 1.2 — `holaf_terminal.py` : Deadlock lors de la déconnexion du client

**Fichier :** `holaf_terminal.py`  
**Statut :** CORRIGÉ

**Problème :** `asyncio.gather()` attendait que les 3 tâches terminent (sender, receiver, reader_thread). Mais :
1. Le client se déconnecte → `receiver_task` termine
2. `gather()` attend encore `sender_task` (bloqué sur `pty_queue.get()`) et `reader_task` (bloqué sur `os.read(fd, 1024)`)
3. Le PTY n'est terminé que dans le bloc `finally` qui s'exécute APRÈS `gather()`
4. → **Deadlock : `gather()` ne retourne jamais, `finally` ne s'exécute jamais**

**Correctif appliqué :** Remplacement de `gather()` par `asyncio.wait(..., return_when=FIRST_COMPLETED)`. Dès qu'une tâche termine (déconnexion client ou fermeture PTY), on termine le PTY et ferme le WebSocket pour débloquer les tâches restantes, puis on attend leur cleanup avec un timeout de 3s.

---

### ✅ 1.3 — `holaf_profiler_engine.py` : Thread monitor en doublon après stop/start rapide

**Fichier :** `holaf_profiler_engine.py`  
**Statut :** CORRIGÉ

**Problème :** `stop_run()` mettait `is_profiling = False` mais ne joinait pas le `monitor_thread`. Si `start_run()` était appelé dans les ~50ms qui suivaient, l'ancien thread était encore vivant. La condition `if self.monitor_thread is None or not self.monitor_thread.is_alive()` empêchait la création d'un nouveau thread, mais l'ancien thread continuait avec les stats corrompues de l'ancien run.

**Correctif appliqué :** 
- `start_run()` crée toujours un nouveau thread (plus de check `is_alive()`)
- `stop_run()` fait un `monitor_thread.join(timeout=2.0)` pour attendre la fin du thread, puis met `monitor_thread = None`

---

### ❌ 1.4 — `PngImagePlugin` non accessible depuis `logic` (FAUX POSITIF)

**Statut :** FAUX POSITIF — Vérification approfondie

En Python, `from PIL import PngImagePlugin` rend `PngImagePlugin` accessible comme attribut du module. `logic.PngImagePlugin.PngInfo()` fonctionne correctement.

---

### ❌ 1.5 — `asyncio.to_thread()` non awaited (FAUX POSITIF)

**Statut :** FAUX POSITIF — Vérification approfondie

`asyncio.gather()` accepte les coroutines et les wrappe automatiquement en Tasks (doc Python : "If any awaitable in aw is a coroutine, it is automatically scheduled as a Task."). Le code fonctionnait, mais le deadlock (bug 1.2) restait un vrai problème.

---

### ❌ 1.6 — Imports JS dépréciés dans les sous-répertoires (FAUX POSITIF)

**Statut :** FAUX POSITIF — Vérification approfondie

Les fichiers dans `js/image_viewer/` et `js/profiler/` utilisent correctement les imports relatifs (`../holaf_api_compat.js`) ou absolus (`/extensions/ComfyUI-Holaf-Utilities/...`). Les imports de fallback vers `/scripts/app.js` sont uniquement dans `holaf_api_compat.js` qui est le shim de compatibilité — c'est le comportement attendu.

---

## 2. 🟠 BUGS IMPORTANTS

### 2.1 — `nodes/holaf_model_manager.py` : Connexion SQLite sans thread-local

**Fichier :** `nodes/holaf_model_manager.py`

Le Model Manager utilise `sqlite3.connect()` directement (fonction `_get_db_connection()` locale) au lieu de passer par `holaf_database.py`. Il configure bien WAL mode et busy_timeout, mais chaque fonction ouvre et ferme sa propre connexion. Pas de gestion thread-local. En pratique, cela fonctionne car les opérations sont courtes, mais c'est une dette technique.

---

### 2.2 — `thumbnail_routes.py` : Thumbnails bloqués en statut 1

**Fichier :** `holaf_image_viewer_backend/routes/thumbnail_route.py` + `worker.py`

La priorisation met `thumbnail_status = 1`. Le worker cherche `thumbnail_status = 1` en priorité. Mais si la génération échoue sans atteindre le handler d'erreur (ex: crash du worker), le statut reste à 1 et le worker retente indéfiniment.

**Note :** En pratique, le handler d'erreur met le statut à 3 (permanent failure), donc ce cas est peu probable sauf si le processus entier crash.

---

### ✅ 2.3 — `dependency_manager.py` : Pas de rollback si `shutil.move` échoue

**Fichier :** `holaf_image_viewer_backend/dependency_manager.py`  
**Statut :** CORRIGÉ

**Problème :** Si `shutil.move` échouait (permission, espace disque), l'ancienne installation RIFE avait déjà été supprimée par `shutil.rmtree`. L'utilisateur se retrouvait sans RIFE et devait réinstaller manuellement.

**Correctif :** L'ancienne installation est maintenant renommée en backup (`RIFE_DIR + "_old"`) avant la suppression. Si `shutil.move` échoue, le backup est restauré automatiquement.

---

### 2.4 — `edit_routes.py` : `import hashlib` en milieu de fonction

**Fichier :** `holaf_image_viewer_backend/routes/edit_routes.py`

Dans `save_edits_route` et `delete_edits_route`, `import hashlib` est fait localement au milieu de la fonction. Ce n'est pas un bug fonctionnel (Python l'exécute quand il l'atteint), mais c'est une mauvaise pratique. Si une exception se produit avant l'import, `hashlib` n'existe pas, mais les `except` blocks ne l'utilisent pas, donc pas de `NameError`.

---

## 3. 🟡 BUGS MODÉRÉS

### 3.1 — `holaf_database.py` : `local_data` non réinitialisé après migration

**Fichier :** `holaf_database.py` — `_migrate_database_by_copy()`

Après `close_db_connection()`, `local_data.connection` est `None`. Le prochain appel à `get_db_connection()` crée une nouvelle connexion sur la nouvelle DB. Mais si d'autres threads ont des connexions ouvertes sur l'ancienne DB (renommanée), elles sont invalides. En pratique, la migration tourne au startup avant que les threads background ne démarrent.

---

### 3.2 — `holaf_config.py` : `save_bulk_settings_to_config` peut corrompre les données JSON

**Fichier :** `holaf_config.py`

```python
safe_key = re.sub(r'[^a-zA-Z0-9_]', '', key)
config_parser_obj.set(section, str(safe_key), str(value))
```

Si `value` est une liste JSON (ex: `["folder1", "folder2"]`), `str(value)` produit la représentation Python `['folder1', 'folder2']` au lieu de JSON valide `["folder1", "folder2"]`. Cependant, en pratique, `save_bulk_settings_to_config` n'est pas utilisé pour les listes — ces clés sont gérées individuellement par les routes spécifiques.

---

### ✅ 3.3 — `logic.py` : `_get_pil_font` utilise `ImageFont` sans import global

**Fichier :** `holaf_image_viewer_backend/logic.py`  
**Statut :** CORRIGÉ

**Problème :** `_get_pil_font` utilisait `ImageFont.truetype()` et `ImageFont.load_default()` sans que `ImageFont` soit importé globalement. Ça fonctionnait par chance car un import local dans `_create_thumbnail_blocking` mettait `ImageFont` dans le namespace.

**Correctif :** Ajout de `ImageFont` à l'import global PIL en haut de `logic.py`.

---

## 4. ⚪ BUGS MINEURS

### 4.1 — Imports non utilisés ou morts

- `logic.py` importe `uuid` et `tempfile` qui ne sont utilisés que dans `generate_proc_video`
- `holaf_nodes_manager.py` : variable `remotes` assignée mais non réutilisée dans le fallback `git remote -v`

### 4.2 — Thème CSS dupliqué dans les templates HTML

**Fichier :** `__init__.py` — `GALLERY_HTML`, `PROFILER_HTML`, `COMPARER_HTML` définissent tous les mêmes variables CSS `:root`. Si le thème change dans `holaf_themes.css`, ces templates doivent être mis à jour manuellement.

### 4.3 — `holaf_database.py` : `ATTACH DATABASE` sans try/except spécifique

Dans `_migrate_database_by_copy()`, `ATTACH DATABASE ? AS old_db` peut échouer si le backup est corrompu, mais l'exception est catchée par le bloc `except Exception` englobant.

---

## 5. PROBLÈMES DE PERFORMANCE

### 5.1 — `list_images_route` envoie TOUTES les données d'un coup

Pour une galerie de 10 000+ images, le payload JSON peut dépasser 50 MB. Pas de pagination côté backend.

**Recommandation :** Ajouter une pagination avec `LIMIT/OFFSET`.

### 5.2 — `sync_image_database_blocking` lock la DB pendant la synchro

La synchro peut prendre plusieurs secondes sur une grosse collection. Le `time.sleep(0.01)` libère le verrou WAL tous les 50 opérations, mais les requêtes UI sont ralenties.

### 5.3 — `clean_thumbnails_blocking` vérifie chaque thumbnail séquentiellement

Sur 10 000 thumbnails, `Image.open() + img.verify()` séquentiel peut prendre 30+ secondes.

---

## 6. PROBLÈMES DE SÉCURITÉ

### 6.1 — Token de session terminal à usage unique mais fenêtre de 60s

Le token de session terminal est valable 60 secondes. Pendant cette fenêtre, un rejeu est possible si un attaquant peut intercepter la requête WebSocket.

### 6.2 — PBKDF2 avec 260 000 itérations

OWASP recommande > 600 000 itérations pour SHA-256 en 2023. Le chiffre actuel est acceptable mais pourrait être augmenté.

---

## 7. BUGS SPÉCIFIQUES AU FRONTEND

### ✅ 7.1 — `Ctrl+A` sélectionne tout le texte de la page

**Statut :** CORRIGÉ

**Correctif :** Ajout d'un event listener `capture: true` dans `image_viewer_infopane.js` qui intercepte Ctrl+A quand le focus est dans un `<textarea>` du viewer (`#holaf-viewer-info-content`). `e.stopPropagation()` empêche le handler global de ComfyUI de sélectionner toute la page, et `e.target.select()` sélectionne uniquement le contenu du textarea.

### 7.2 — Bouton "Copy Prompt" cassé (à investiguer)

Le code `copyTextToClipboard()` semble correct (execCommand + fallback API clipboard). Le bug est probablement contextuel (sandbox iframe, HTTPS manquant pour `navigator.clipboard`, ou `data.prompt` undefined). Nécessite un debug en navigateur.

### 7.3 — Bouton "Load Workflow" cassé en mode standalone (à investiguer)

Le bouton utilise `holafBridge.send('LOAD_WORKFLOW', data.workflow)` en standalone. Il faut vérifier si le listener `BroadcastChannel` côté main tab existe et fonctionne. Nécessite une investigation du bridge.

### ✅ 7.4 — Boutons "All/None/Invert" défilent hors de la vue

**Statut :** CORRIGÉ

**Correctif :** Ajout de `position: sticky; top: 0; z-index: 10;` sur `.holaf-viewer-filter-header` dans `holaf_image_viewer.css`, avec un `background-color` opaque pour couvrir le contenu qui défile en dessous.

---

## 8. TESTS MANQUANTS

1. Test de migration DB (`_migrate_database_by_copy()`)
2. Test d'upload chunké (`assemble_chunks_blocking`)
3. Test de verrou vidéo concurrent (`process_video_route`)
4. Test WebSocket terminal (connexion + déconnexion propre)
5. Test du profiler (`handle_execution_start/on_node_end`)
6. Test de compatibilité API (`holaf_api_compat.js`)

---

## RÉSUMÉ STATISTIQUE

| Sévérité | Nombre | Corrigés |
|----------|--------|----------|
| 🔴 Critical | 3 confirmés | ✅ 3 corrigés |
| ❌ Faux positifs | 3 | N/A |
| 🟠 Important | 4 | ✅ 1 corrigé (RIFE rollback) |
| 🟡 Moderate | 3 | ✅ 1 corrigé (ImageFont) |
| ⚪ Minor | 3 | 0 |
| Performance | 3 | 0 |
| Sécurité | 2 | 0 |
| Frontend UI | 4 | ✅ 2 corrigés (Ctrl+A, sticky buttons) |
| Tests manquants | 6 | 0 |
| **Total confirmé** | **16** | **✅ 7 corrigés** |

---

## DÉTAILS DES CORRECTIONS APPORTÉES

### Fix 1 — `edit_routes.py` : `process_video_route`

**Avant :**
```python
async with path_lock:
    # ...
    return web.json_response(...)  # ← return dans le context manager

# DEAD CODE - jamais exécuté
async with _video_processing_locks_mutex:
    del _video_processing_locks[path_canon]
```

**Après :**
```python
response = None
async with path_lock:
    try:
        # ... processing ...
        response = web.json_response(...)
    except Exception as inner_e:
        response = web.json_response(..., status=500)

# Cleanup APRÈS la sortie du context manager (le lock est libéré)
async with _video_processing_locks_mutex:
    if path_canon in _video_processing_locks and not _video_processing_locks[path_canon].locked():
        del _video_processing_locks[path_canon]

if response is not None:
    return response
```

### Fix 2 — `holaf_terminal.py` : Deadlock déconnexion client

**Avant :**
```python
await asyncio.gather(sender_task, receiver_task, reader_thread)
# ← Deadlock : gather() attend reader_thread qui est bloqué sur os.read()
# Le PTY n'est terminé que dans le finally APRÈS gather()
```

**Après :**
```python
# Attendre qu'AU MOINS UNE tâche termine
done, pending = await asyncio.wait(
    [sender_task, receiver_task, reader_task],
    return_when=asyncio.FIRST_COMPLETED
)

# Terminer le PTY pour débloquer le reader thread
if proc_adapter and proc_adapter.is_alive():
    proc_adapter.terminate(force=True)

# Fermer le WebSocket pour débloquer le receiver
if not ws.closed:
    await ws.close()

# Attendre le cleanup des tâches restantes (avec timeout)
for task in pending:
    try:
        await asyncio.wait_for(task, timeout=3.0)
    except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
        if not task.done():
            task.cancel()
```

### Fix 3 — `holaf_profiler_engine.py` : Thread monitor en doublon

**Avant :**
```python
def start_run(self, ...):
    self.is_profiling = True
    if self.monitor_thread is None or not self.monitor_thread.is_alive():
        self.monitor_thread = threading.Thread(...)
        self.monitor_thread.start()
    # ← Si stop_run() + start_run() rapide, l'ancien thread est réutilisé

def stop_run(self):
    self.is_profiling = False
    # ← Pas de join(), le thread continue potentiellement
```

**Après :**
```python
def start_run(self, ...):
    self.is_profiling = True
    # Toujours créer un nouveau thread
    self.monitor_thread = threading.Thread(...)
    self.monitor_thread.start()

def stop_run(self):
    self.is_profiling = False
    self.active_run_id = None
    self.current_node_id = None
    # Attendre la fin du thread pour éviter les doublons
    if self.monitor_thread is not None and self.monitor_thread.is_alive():
        self.monitor_thread.join(timeout=2.0)
    self.monitor_thread = None
```

---

## PRIORITÉS DE CORRECTION RESTANTES

1. 🟠 **Haute priorité** : Bugs 2.1-2.3 (Model Manager DB, thumbnails bloqués, rollback RIFE)
2. 🟡 **Moyenne priorité** : Bugs 3.1-3.3 (DB migration, config parser, ImageFont)
3. ⚪ **Basse priorité** : Bugs 4.1-4.3 (imports morts, CSS dupliqué)
4. 📈 **Améliorations** : Sections 5, 6, 7 (performance, sécurité, UI)
5. 🧪 **Tests** : Section 8

---

*Rapport généré par analyse statique complète du code source.  
3 bugs critiques corrigés le 2026-06-17.*