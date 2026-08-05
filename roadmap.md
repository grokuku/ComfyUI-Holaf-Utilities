# Roadmap & Rapport de Bugs — ComfyUI-Holaf-Utils

**Dernière mise à jour :** 2026-06-27  
**Version du projet :** Schema v13, éditeur à contrôles empilables, sauvegarde automatique

---

## ÉTAT GÉNÉRAL DU PROJET

Le projet a subi une session de debug/optimisation/fonctionnalités complète. Tous les bugs critiques et importants sont corrigés. Le projet est stable et utilisable au quotidien.

---

## FONCTIONNALITÉS IMPLÉMENTÉES

### 🎨 Éditeur d'images
- **Contrôles empilables** — Plus de sliders fixes. Bouton "+ Add Control" → choisit un type (Brightness/Contrast/Saturation/Hue) + choix du range (All/Shadows/Midtones/Highlights) → le contrôle s'ajoute à la liste
- **Duplication autorisée** — Plusieurs contrôles du même type (ex: 2× Brightness avec ranges différents)
- **Range masking** — Shadows/Midtones/Highlights avec masques de luminance progressifs (PIL côté backend, canvas côté frontend)
- **Hue** — Supporté en CSS et en canvas, avec ranges
- **Sauvegarde automatique** — 500ms après le dernier changement, les modifications sont sauvegardées. Plus de boutons Save/Cancel.
- **Reset** — Supprime tous les réglages et le fichier `.edt`
- **Compare mode** — Overlay canvas qui split l'original (gauche) et l'édité (droite) avec `ctx.clip()`. Suit la souris. Supporte le zoom/pan. Compatible ranged adjustments.
- **Aperçu temps réel** — CSS filter quand tous les ranges sont 'all' (GPU). Canvas pixel processing sinon (avec downscale 1920px max + optimisations)
- **Transition plein écran fluide** — La miniature sert de placeholder pendant le chargement de l'image pleine taille. Blur + spinner si > 1s
- **Suppression optimiste** — Delete en zoom/éditeur → image retirée immédiatement de la galerie + navigation vers la suivante. Requête en arrière-plan avec rollback si échec

### 🖼️ Galerie
- **Scrolling virtualisé** — Seuls les éléments visibles sont rendus dans le DOM
- **Object pool** — Les placeholders DOM sont recyclés (pas de createElement à chaque scroll)
- **LRU cache** — 2000 thumbnails en cache mémoire
- **Tri** — Toujours les plus récents en premier (`ORDER BY mtime DESC`)
- **Filtres** — Dossiers (top_level_subfolder), formats (uniquement ceux présents), dates, tags, recherche textuelle
- **Chargement optimiste** — Les images supprimées disparaissent immédiatement
- **Polling updates** — Détection des nouvelles images toutes les 5s (skip pendant le scroll)

### 🖥️ Performance
- **Thumbnail worker** — File d'attente prioritaire (visible > pending), 6 concurrents, retry avec backoff
- **Watcher filesystem** — Auto-restart en cas de crash, fallback poller scandir incrémental si inotify saturé
- **Sync périodique** — Toutes les 30s (filet de sécurité, cf. fix watcher ; était 120s après les 10 fixes). Supprime les thumbnails orphelins
- **Folder metadata** — Incrémental (était full rebuild par image)
- **Worker DB connection** — Persistante pendant l'idle (pas de connect/déconnect toutes les 5s)
- **Thumbnail cleanup** — Orphelins supprimés pendant le sync (pas seulement manuellement)
- **Galerie** — `_doKick` limité à 20 cache hits/tick, `textContent` pour bulk DOM removal
- **Éditeur** — Downscale à 1920px max pour le canvas preview, contrôles 'all' séparés des ranged, pas de closures dans la boucle pixel

### ⚡ Performance galerie — commité/poussé (10 fixes, f9975fa + 89174e1)

- **Backend — arrêt du refresh perpétuel** (`holaf_image_viewer_backend/logic.py`) — `sync_image_database_blocking()` ne bump `LAST_DB_UPDATE_TIME` que si un pass détecte des changements (compteurs added/deleted/changed). Avant : bump inconditionnel toutes les 30s → le frontend re-fetchait les 30k images toutes les 30s en boucle. Cause racine du refresh lent après une nouvelle image, des freezes d'onglet et des placeholders gris
- **Backend — sync allégé** (`logic.py` + `__init__.py`) — Intervalle de sync 30s → 120s ; `_update_folder_metadata_cache_blocking` (DELETE + rebuild complet) ne tourne que si des changements sont détectés
- **Backend — génération de thumbnails bornée** (`routes/thumbnail_routes.py` + `logic.py`) — Génération inline capée via `threading.Semaphore(2)` ; si occupée, la route renvoie 202 + `Retry-After: 2` + no-store au lieu d'une génération PIL illimitée (jusqu'à ~20 threads concurrents saturant le CPU) ; `optimize=False` dans `_create_thumbnail_blocking` (~30-50% plus rapide) ; thumbnails servis via `web.FileResponse` avec `Cache-Control: max-age=31536000, immutable`
- **Backend — nouvelle route image pleine taille** (`routes/image_routes.py`, enregistrée dans `__init__.py`) — `GET /holaf/images/full?path_canon=...&mtime=...` streame le fichier ORIGINAL avec `Cache-Control: max-age=31536000, immutable` (ETag depuis mtime/thumb_hash), même whitelist de chemins que les thumbnails. Le plein écran ne dépend plus de la route ComfyUI `/view`
- **Backend — liste incrémentale** (`routes/image_routes.py`) — `POST /holaf/images/list` accepte un `min_mtime` optionnel → ne retourne que les images avec `mtime > min_mtime` (mêmes champs, `mtime DESC`) ; sans lui, liste complète comme avant
- **Frontend — refresh incrémental** (`js/holaf_image_viewer.js`) — `checkForUpdates` calcule le top mtime depuis le state et ne fetch que le delta via `min_mtime` ; 0 item → rien à faire ; N items → fusionnés en haut du state (dédupe par `path_canon`) ; DOM des filtres reconstruit seulement si la signature dossier/formats change (`_filterSignatureChanged`) ; premier load = fetch complet ; early-return sur `folder_filters` vide préservé
- **Frontend — insertion de delta** (`js/image_viewer/image_viewer_gallery.js`) — `insertImagesAtTop()` ajoute les nouvelles thumbnails en haut via le `renderVisibleItems` virtualisé existant (réutilise les placeholders, ne crée du DOM que pour le delta) — chemin du load initial 30k (syncGallery rebuild complet + force rebuild liste vide) intact. Pas de pagination, pas de création différée — contraintes utilisateur respectées
- **Frontend — priorisation des thumbnails visibles** (`image_viewer_gallery.js`) — `renderVisibleItems` collecte les chemins visibles non cachés → `POST /holaf/images/prioritize-thumbnails` (debounce 300ms, flush 1000, fire-and-forget). Active la file de priorité backend jusque-là morte (`thumbnail_status=1`)
- **Frontend — route cache image pleine taille** (`js/image_viewer/image_viewer_navigation.js`) — `getFullImageUrl` pointe vers `/holaf/images/full` avec cache-buster mtime au lieu de ComfyUI `/view`
- **Frontend — gestion du 202 en attente** (`image_viewer_gallery.js`) — fetch thumbnail 202 → placeholder gris conservé, retry programmé après `Retry-After` (2s par défaut) via la map dédiée `pendingThumbnailRetries` (aucune collision avec `idleRestartTimer`) ; prefetch early-return aussi sur 202
- **Code mort activé** — le flag `viewer_is_active` (`worker.py:40`, set par `utility_routes.py:28`) et l'endpoint `/holaf/images/prioritize-thumbnails` existaient mais n'étaient jamais utilisés par le frontend — désormais câblés

### 👁️ Fix watcher — scandir poller (`worker.py` + `__init__.py`, working tree — à pousser)

- **Cause racine** — Limite de watches inotify atteinte (`[Errno 28] ENOSPC`) sur le Docker de l'utilisateur avec 32k images → fallback watchdog `PollingObserver` qui n'émet JAMAIS d'événements sur le FS du conteneur (snapshot full-tree de 32k fichiers trop lent à diff) → les nouvelles images n'étaient détectées que par le sync périodique (120s) → la galerie prenait jusqu'à 2 min à afficher une nouvelle image
- **Fix** — `PollingObserver` remplacé par un poller incrémental custom basé sur `scandir` (`worker.py`) : détection add/delete par nom avec cache en mémoire, intervalle de scan ~2.5s, pas de `stat` par fichier pour les fichiers inchangés (léger même avec 32k fichiers), warm-up du baseline sans émettre d'événements, print par événement ("Detected creation/deletion")
- **Sync 120s → 30s** — Filet de sécurité pour les content updates/renames ; le sync ne bump le timestamp DB que sur de vrais changements → pas de refreshes fantômes
- **COUNT skip (commité 89174e1)** — La requête COUNT (~900ms) n'est plus exécutée sur les requêtes de liste incrémentale (`min_mtime`) (`image_routes.py`) → elle ne tourne plus à chaque check delta de 5s

---

## CORRECTIONS DE BUGS

### 🔴 Critiques (3)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 1 | `edit_routes.py` | Fuite mémoire `_video_processing_locks` | Restructuration du return |
| 2 | `holaf_terminal.py` | Deadlock déconnexion client | `asyncio.wait(FIRST_COMPLETED)` + terminate PTY |
| 3 | `holaf_profiler_engine.py` | Thread monitor en doublon | Toujours créer nouveau thread + join |

### 🟠 Importants (3)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 4 | `logic.py` | `UnidentifiedImageError` → boucle infinie | `thumbnail_status = 3` |
| 5 | `dependency_manager.py` | RIFE supprimé avant move → perte données | Backup avant suppression |
| 6 | `holaf_terminal.py` | Variables potentiellement unbound dans `finally` | `try/except NameError` |

### 🟡 Modérés (3)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 7 | `logic.py` | `ImageFont` non importé globalement | Ajout à l'import PIL |
| 8 | `logic.py` | Import `uuid` mort | Supprimé |
| 9 | `worker.py` | Watcher filesystem mourait silencieusement | Auto-restart avec retry 10s |

### ⚪ Mineurs / Frontend (6)

| # | Fichier | Problème | Correctif |
|---|---------|----------|-----------|
| 10 | `holaf_monitor.js` | WebSocket sans `onclose`/`onerror` | Reconnexion auto exponential backoff |
| 11 | `image_viewer_infopane.js` | Ctrl+A sélectionnait toute la page | Event listener `capture: true` |
| 12 | `holaf_image_viewer.css` | Boutons "All/None/Invert" défilent | `position: sticky; top: 0` |
| 13 | `image_viewer_actions.js` | Balise `</div>` orpheline → boutons hors dialog | Wrappé le `<span>` dans un `<div>` |
| 14 | `holaf_image_viewer.css` | Export dialog sans max-height | `max-height: 90%` + flex column |
| 15 | `holaf_shared_panel.css` | `createDialog`/`HolafModal` sans max-height | Même pattern appliqué |

### 🔧 Harmonisation modales (3)

- `createDialog` étendu : `messageElement` (DOM custom) + close-on-overlay-click + `min-height: 0`
- `HolafModal` → `createDialog` pour "Not Implemented". Reste uniquement pour le restart
- CSS unifié : `max-height: 90vh` + `overflow: hidden` + content scrollable + footer fixe

### 🔒 Code review fixes (5)

| # | Problème | Correctif |
|---|----------|-----------|
| 1 | `_rangedPreviewPending` jamais mis à `true` | Set avant async, clear dans `finally` |
| 2 | Event listener leak dans `_toggleCompareMode` | Cleanup `_compareCleanups` avant re-création |
| 3 | Hue dropped quand ranged controls actifs | Ajout RGB→HSV→RGB dans canvas pixel loop |
| 4 | `_compareRefresh` faisait full teardown | `_compareFilterDirty` flag |
| 5 | `_cancelEdits` + `_hide` sans cleanup | Ajouté les cleanups |

### ⚡ Performance (4)

| # | Fichier | Changement |
|---|---------|------------|
| 1 | `__init__.py` | Sync périodique 300s → 30s |
| 2 | `image_viewer_gallery.js` | `_doKick` limité à 20 cache hits/tick |
| 3 | `holaf_image_viewer.js` | `checkForUpdates` skip pendant le scroll |
| 4 | `image_viewer_gallery.js` | `textContent` au lieu de `removeChild` en boucle |

### 🎨 Refonte éditeur (12 changements)

- Système de contrôles empilables (add/remove/duplicate)
- Format `.edt` nouveau avec migration automatique
- Range masking (All/Shadows/Midtones/Highlights)
- Hue en canvas (RGB→HSV→RGB)
- Compare mode (canvas overlay avec `ctx.clip()`)
- Compare + ranged (rechargement de `editImg`)
- Compare caché pour les vidéos
- Preview CSS filter (GPU) si tous 'all', canvas sinon
- Debounce 16ms + anti-concurrence `_rangedPending`
- Cache anti-cascade basé sur `dataset.originalSrc`
- Sauvegarde automatique 500ms (plus de Save/Cancel)
- Auto-save tokenisé + sérialisé (pas de sauvegardes concurrentes)

---

## BUGS RESTANTS CONNUS

| Bug | Sévérité | Statut |
|-----|----------|--------|
| Freeze onglet au lancement (jaune = JS) | 🟠 | Grandement réduit — cause racine identifiée et supprimée (boucle de refresh perpétuelle). Risques restants : décodage fullscreen, build initial des 30k éléments DOM. |
| Bouton "Copy Prompt" cassé | 🟡 | Déjà corrigé par l'utilisateur |
| Bouton "Load Workflow" standalone | 🟡 | Déjà corrigé par l'utilisateur |
| CSS dupliqué dans templates HTML | ⚪ | Cosmétique |

---

## FICHIERS SUPPRIMÉS

| Fichier | Raison |
|---------|--------|
| `GEMINI.md` | Artefact de l'IA génératrice. Référençait des fichiers inexistants. |

---

*39 corrections au total. Projet stable et fonctionnel.*
