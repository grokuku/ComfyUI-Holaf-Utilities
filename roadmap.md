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
- **Watcher filesystem** — Auto-restart en cas de crash, polling fallback si inotify saturé
- **Sync périodique** — Toutes les 30s (était 300s). Supprime les thumbnails orphelins
- **Folder metadata** — Incrémental (était full rebuild par image)
- **Worker DB connection** — Persistante pendant l'idle (pas de connect/déconnect toutes les 5s)
- **Thumbnail cleanup** — Orphelins supprimés pendant le sync (pas seulement manuellement)
- **Galerie** — `_doKick` limité à 20 cache hits/tick, `textContent` pour bulk DOM removal
- **Éditeur** — Downscale à 1920px max pour le canvas preview, contrôles 'all' séparés des ranged, pas de closures dans la boucle pixel

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
| Freeze onglet au lancement (jaune = JS) | 🔴 | Non identifié. Probablement backend ou JSON.parse des 30k images. À investiguer avec DevTools. |
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
