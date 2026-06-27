# Roadmap & Rapport de Bugs — ComfyUI-Holaf-Utils

**Dernière mise à jour :** 2026-06-17  
**Version du projet :** Schema v13, éditeur à contrôles empilables

---

## ÉTAT GÉNÉRAL DU PROJET

Le projet a subi une session de debug/optimisation complète. Tous les bugs critiques et importants ont été corrigés. Les bugs restants sont soit théoriques (non déclenchables), soit des améliorations optionnelles.

---

## BUGS CORRIGÉS

### 🔴 Bugs critiques (3)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 1 | `edit_routes.py` | Fuite mémoire `_video_processing_locks` : cleanup après `return` (code mort) | Restructuration : réponse stockée, cleanup après le lock |
| 2 | `holaf_terminal.py` | Deadlock déconnexion client : `gather()` bloqué, PTY jamais terminé | `asyncio.wait(FIRST_COMPLETED)` + terminate PTY + timeout 3s |
| 3 | `holaf_profiler_engine.py` | Thread monitor en doublon après stop/start rapide | Toujours créer un nouveau thread + `join(timeout=2.0)` dans stop |

### 🟠 Bugs importants (3)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 4 | `logic.py` | `UnidentifiedImageError` ne marquait pas `thumbnail_status=3` → boucle infinie | Ajout du DB update + log dans le handler |
| 5 | `dependency_manager.py` | RIFE supprimé avant `shutil.move` → perte de données si échec | Backup avant suppression + restore si échec |
| 6 | `holaf_terminal.py` | Variables potentiellement unbound dans `finally` | `try/except NameError` sur cleanup PTY et WebSocket |

### 🟡 Bugs modérés (3)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 7 | `logic.py` | `ImageFont` non importé globalement | Ajout à l'import PIL global |
| 8 | `logic.py` | Import `uuid` mort | Supprimé |
| 9 | `worker.py` | Filesystem watcher mourait silencieusement | Auto-restart avec boucle `while` + retry 10s |

### ⚪ Bugs mineurs / frontend (6)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 10 | `holaf_monitor.js` | WebSocket sans `onclose`/`onerror` → monitor gelé silencieusement | Reconnexion auto exponential backoff + `event.target` guard |
| 11 | `image_viewer_infopane.js` | Ctrl+A sélectionnait toute la page ComfyUI | Event listener `capture: true` + `stopPropagation()` |
| 12 | `holaf_image_viewer.css` | Boutons "All/None/Invert" défilent hors de vue | `position: sticky; top: 0` sur `.holaf-viewer-filter-header` |
| 13 | `image_viewer_actions.js` | Balise `</div>` orpheline dans le dialog d'export → boutons hors du dialog | Wrappé le `<span>` audio info dans un `<div>` propre |
| 14 | `holaf_image_viewer.css` | Export dialog sans `max-height` → footer sort de la fenêtre | `max-height: 90%` + `flex column` + `overflow-y: auto` + `flex-shrink: 0` |
| 15 | `holaf_shared_panel.css` | `createDialog` et `HolafModal` sans max-height/scroll | Même pattern appliqué aux 2 systèmes + `min-height: 0` |

### 🔧 Harmonisation des modales (3 changements)

| Changement | Détail |
|------------|--------|
| `createDialog` étendu | Support `messageElement` (DOM custom) + close-on-overlay-click + `min-height: 0` |
| `HolafModal` → `createDialog` | "Not Implemented" migré. `HolafModal` gardé uniquement pour le restart |
| CSS unifié | `max-height: 90vh` + `overflow: hidden` + content scrollable + footer fixe sur tous les dialogs |

### 🎨 Refonte de l'éditeur d'images

| Changement | Détail |
|------------|--------|
| Système de contrôles empilables | Remplacement des sliders fixes par une liste dynamique add/remove |
| Format `.edt` nouveau | `{ controls: [{ id, type, value, range }] }` — migration automatique ancien format |
| Range masking | All/Shadows/Midtones/Highlights avec masques de luminance progressifs |
| Duplication autorisée | Plusieurs contrôles du même type (ex: 2× brightness avec ranges différents) |
| Hue en canvas | RGB→HSV→rotate→HSV→RGB dans le pixel loop pour le preview ranged |
| Compare mode | Canvas overlay avec `ctx.clip()` + `ctx.filter` + split line qui suit la souris |
| Compare + ranged | Rechargement de `editImg` quand le blob URL change (dirty flag) |
| Compare sur vidéo | Checkbox masquée pour les vidéos |
| Preview temps réel | CSS filter (GPU) si tous ranges 'all', canvas pixel processing sinon |
| Debounce | `_schedulePreview()` 16ms sur sliders + range selects |
| Anti-concurrence | `_rangedPreviewPending` flag + `finally` pour éviter les async qui se chevauchent |
| Cache anti-cascade | Cache basé sur `dataset.originalSrc` (pas `imgEl.src` qui devient un blob) |

### ⚡ Optimisations de performance (3)

| Changement | Fichier | Détail |
|------------|---------|--------|
| Sync périodique 300s → 30s | `__init__.py` | Galerie se met à jour en 30s max au lieu de 5 min |
| `_doKick` limité à 20 cache hits/tick | `image_viewer_gallery.js` | Évite 200 DOM manipulations synchrones dans un microtask |
| `checkForUpdates` skip pendant scroll | `holaf_image_viewer.js` | Évite `JSON.parse` sur gros payload pendant le scroll |
| `syncGallery` utilise `textContent` | `image_viewer_gallery.js` | DOM bulk removal plus rapide que `removeChild` en boucle |

### 🔒 Correctifs de code review (5)

| # | Problème | Correctif |
|---|----------|-----------|
| 1 | `_rangedPreviewPending` jamais mis à `true` | Set avant async, clear dans `finally` |
| 2 | Event listener leak dans `_toggleCompareMode` | Cleanup `_compareCleanups` avant re-création |
| 3 | Hue dropped quand ranged controls actifs | Ajout RGB→HSV→RGB dans canvas pixel loop |
| 4 | `_compareRefresh` faisait full teardown/rebuild | Remplacé par `_compareFilterDirty` flag |
| 5 | `_cancelEdits` sans compare cleanup + `_hide` sans clear timer | Ajouté les cleanups |

---

## FAUX POSITIFS (5)

| # | Bug original | Pourquoi c'est un faux positif |
|---|-------------|-------------------------------|
| 1 | `PngImagePlugin` non accessible depuis `logic` | Python expose les imports comme attributs de module |
| 2 | `asyncio.to_thread()` non awaited | `gather()` gère les coroutines automatiquement |
| 3 | Imports JS dépréciés dans sous-répertoires | Les imports sont corrects (relatifs + absolus valides) |
| 4 | Model Manager DB sans thread-local | Pattern open/close per call sûr pour opérations courtes |
| 5 | `ATTACH DATABASE` sans try/except | Catché par le bloc englobant |

---

## BUGS THÉORIQUES (2 — non déclenchables)

| # | Problème | Pourquoi non déclenché |
|---|---------|------------------------|
| 1 | Migration DB + autres threads | La migration tourne au startup avant les threads background |
| 2 | `save_bulk_settings` corrompt les listes | Les listes passent par une route dédiée avec `json.dumps()` |

---

## BUGS FRONTEND CONNUS (déjà corrigés par l'utilisateur)

| Bug | Statut |
|-----|--------|
| Bouton "Copy Prompt" cassé | ✅ Corrigé par l'utilisateur |
| Bouton "Load Workflow" cassé en standalone | ✅ Corrigé par l'utilisateur |

---

## AMÉLIORATIONS FUTURES OPTIONNELLES

### Performance

| Item | Description | Priorité |
|------|-------------|----------|
| Pagination backend | `list_images_route` envoie toutes les images d'un coup. Le frontend virtualise déjà le rendu. Bénéfique pour 10 000+ images. | Basse |
| Downscaled preview | L'aperçu ranged en canvas traite tous les pixels. Downscaler à 1920px max pour le preview serait plus fluide. | Basse |
| Web Worker pour pixel processing | Déporter le canvas pixel loop dans un Worker pour ne pas bloquer le main thread | Basse |

### Sécurité

| Item | Description | Priorité |
|------|-------------|----------|
| PBKDF2 iterations | 260k → 600k (recommandation OWASP 2023). Acceptable pour usage local. | Basse |

### Cosmétique

| Item | Description | Priorité |
|------|-------------|----------|
| CSS dupliqué dans templates HTML | `GALLERY_HTML`, `PROFILER_HTML`, `COMPARER_HTML` duppliquent les variables CSS `:root` | Très basse |

### Tests

| Item | Description | Priorité |
|------|-------------|----------|
| Migration DB | Test `_migrate_database_by_copy()` | Moyenne |
| Upload chunké | Test `assemble_chunks_blocking` | Moyenne |
| Verrou vidéo concurrent | Test `process_video_route` | Basse |
| WebSocket terminal | Test connexion + déconnexion propre | Basse |
| Profiler | Test `handle_execution_start/on_node_end` | Basse |
| Compatibilité API | Test `holaf_api_compat.js` | Basse |

---

## RÉSUMÉ STATISTIQUE

| Catégorie | Nombre | Corrigés |
|----------|--------|----------|
| 🔴 Critiques | 3 | ✅ 3 |
| 🟠 Importants | 3 | ✅ 3 |
| 🟡 Modérés | 3 | ✅ 3 |
| ⚪ Mineurs/frontend | 6 | ✅ 6 |
| 🔧 Harmonisation modales | 3 | ✅ 3 |
| 🎨 Refonte éditeur | 12 | ✅ 12 |
| ⚡ Performance | 4 | ✅ 4 |
| 🔒 Code review | 5 | ✅ 5 |
| ❌ Faux positifs | 5 | N/A |
| ⚪ Théoriques | 2 | Non déclenchables |
| **Total corrections** | **39** | **✅ 39** |

---

## FICHIERS SUPPRIMÉS

| Fichier | Raison |
|---------|--------|
| `GEMINI.md` | Artefact de l'IA génératrice. Décrivait des fichiers inexistants (CHANGELOG.md, ROADMAP.md, CONTRIBUTING.md) et des conventions non appliquées (flake8, black). |

---

*Rapport généré par analyse statique et dynamique du code source.  
39 corrections appliquées au total sur l'ensemble du projet.*