### Purpose
This file serves as the **primary source of truth** and **cognitive map** for the Large Language Model (LLM) working on AiKore. Its goal is to provide a complete architectural understanding without requiring the LLM to read the source code of every file in every session. It bridges the gap between the raw file tree and the high-level business logic.

### Protocol for Updates
When the user requests a "context update" or when a major feature is implemented, the following information MUST be integrated/updated in this file:
1.  **Structural Changes**: If files are created, renamed, moved, or deleted, update **Section 2 (File Structure)** to reflect the new tree and the responsibility of the new files.
2.  **Schema Evolutions**: If `models.py` or `migration.py` changes, update **Section 4 (Database Schema)** to reflect the current V-version and columns.
3.  **Logic Shifts**: If the core way the backend handles processes, ports, saving, or networking changes, update **Section 3 (Key Concepts)**.
4.  **New Dependencies**: If `Dockerfile` or `requirements.txt` changes significantly (new tools like KasmVNC, new libs), update **Section 1 (Stack)**.

**Golden Rule**: Never paste raw code blocks in this file. Use concise, high-level functional descriptions to minimize token usage while maximizing understanding.

---

RÈGLES OPÉRATIONNELLES (LLM INSTRUCTIONS) :

1.  **Gestion des fichiers manquants :** Ne jamais inventer de code. Demander explicitement les fichiers manquants.
2.  **Format des modifications :**
    *   Utiliser `sed` (une ligne, guillemets simples) pour les petits patchs sans risque.
    *   Fournir le **fichier complet** pour toute modification complexe ou risquée (Défaut).
3.  **Flux séquentiel :** Attendre validation utilisateur après chaque fichier modifié.
4.  **Moindre intervention :** Ne modifier que le strict nécessaire.
5.  **Bilinguisme :** Interactions en Français, Code/Commentaires en Anglais.
6.  **Restitution du Contexte :** Toujours fournir le contenu intégral de ce fichier (`context.txt`) entre balises de code pour faciliter la copie.

---

### SECTION 1: STACK & DEPENDENCIES

*   **Python Environment:** ComfyUI embedded python.
*   **Key Libraries:**
    *   `aiohttp` (Server/API)
    *   `sqlite3` (Database) - **Optimized:** WAL Mode enabled, Memory Mapping active.
    *   `Pillow` (Image processing)
    *   `python-xmp-toolkit` (XMP Metadata support)
*   **System Dependencies:**
    *   **FFmpeg** : Requis dans le PATH système pour le support vidéo (thumbnails, metadata extraction).
    *   `psutil`, `pywinpty` (Windows only) for System Monitor/Terminal.

---

### SECTION 2: FILE STRUCTURE

📁 holaf_image_viewer_backend/
  > Backend logic for the Image Viewer.
  📁 routes/
    > Modular API route handlers.
    📄 __init__.py
    📄 edit_routes.py
      > [**UPDATED**] Gestion des fichiers `.edt`. Architecture : sous-dossier `edit/`. Auto-migration des anciens fichiers legacy.
    📄 export_routes.py
    📄 file_ops_routes.py
      > [**UPDATED**] Suppression/Restauration gère intelligemment le déplacement des sidecars dans `edit/`.
    📄 image_routes.py
      > [**OPTIMIZED**] Listing API. Utilise maintenant des index composites pour une performance < 200ms.
    📄 metadata_routes.py
    📄 thumbnail_routes.py
      > Gestion des thumbnails. Supporte la priorisation via file d'attente.
    📄 utility_routes.py
  📄 __init__.py
  📄 logic.py
    > [**CRITICAL**] Core logic. Scanner de fichiers (Ignore `trashcan` et `edit/`), Sync DB.
  📄 routes.py
  📄 worker.py

📁 js/
  > Frontend assets.
  📁 css/
    📄 holaf_image_viewer.css
      > Includes styles for Video Player and Filters.
  📁 image_viewer/
    📄 image_viewer_actions.js
    📄 image_viewer_editor.js
      > [**UPDATED**] Supporte "Playback Rate" pour les vidéos. Filtres appliqués via CSS (Soft Edit).
    📄 image_viewer_gallery.js
      > [**UPDATED**] Virtual Scroller. **Video Hover Preview** implémenté (lecture native muette au survol).
    📄 image_viewer_infopane.js
    📄 image_viewer_navigation.js
      > [**CRITICAL**] Gestion centralisée Zoom/Fullscreen. Bascule dynamique `<img>` vs `<video>`. Gestion propre des événements DOM (plus de cloneNode).
    📄 image_viewer_settings.js
    📄 image_viewer_state.js
      > [**OPTIMIZED**] Gestion d'état optimisée pour éviter les clonages profonds inutiles sur les grands datasets.
    📄 image_viewer_ui.js
      > Expose `this.elements` pour l'accès inter-modules.
  📁 model_manager/
  📄 holaf_main.js
  📄 holaf_image_viewer.js
    > Contrôleur principal. Initialise l'overlay fullscreen avec support vidéo.

📁 nodes/
  📄 holaf_model_manager.py
  📄 holaf_nodes_manager.py

📄 __init__.py
📄 __main__.py
📄 context.txt
📄 holaf_config.py
📄 holaf_database.py
  > [**UPDATED**] Gestion SQLite optimisée (PRAGMA mmap_size, cache_size, synchronous=NORMAL).
📄 holaf_server_management.py
📄 holaf_system_monitor.py
📄 holaf_terminal.py
📄 holaf_utils.py
📄 requirements.txt

---

### SECTION 3: KEY CONCEPTS

*   **Editing Architecture (Sidecars):**
    *   **Storage:** Les fichiers d'édition (`.edt`) sont stockés dans un sous-dossier `edit/` situé dans le même dossier que l'image.
    *   **Migration:** Le backend détecte automatiquement les anciens fichiers `.edt` (legacy) situés à la racine et les déplace dans `edit/` lors de la sauvegarde.
    *   **Isolation:** Le scanner (`logic.py`) ignore le dossier `edit/` pour ne pas indexer ces fichiers.
*   **Video Handling (Frontend):**
    *   **Playback:** Native HTML5 `<video>`. Loop enabled by default.
    *   **Hover Preview:** Chargement direct du fichier source (muted/autoplay) au survol de la miniature.
    *   **Editing:** "Soft Edit" uniquement. Les filtres et la vitesse sont sauvegardés dans le `.edt`.
*   **Sync Strategy:** `logic.py` scanne le dossier output. Il compare mtime/size/hash avec la DB.
*   **Thumbnailing (Frontend):** Virtual Scroller personnalisé avec Network Cancellation et Timeout (30s).
*   **Filtering Logic:**
    *   **Backend:** Requêtes SQL optimisées via Index Composite.
    *   **Frontend:** État centralisé (`imageViewerState`).

---

### SECTION 4: DATABASE SCHEMA

*   **File:** `holaf_utilities.sqlite`
*   **Current Version:** 13
*   **Table `images` (Key Columns):**
    *   `path_canon` (Unique ID path)
    *   `top_level_subfolder` (Indexed for fast folder switching)
    *   `mtime` (Indexed for sorting)
    *   `thumb_hash` (Used for thumbnail caching)
    *   `is_trashed`
    *   `format` (MP4, WEBM, PNG, JPG...)
*   **Indexes:**
    *   `idx_gallery_composite`: (is_trashed, top_level_subfolder, mtime DESC) -> **Performance Critique**.

---

### PROJECT STATE

  ACTIVE_BUGS: {}

  IN_PROGRESS:
    - (Aucune tâche active - Fin de session)

  COMPLETED_FEATURES (Recent):
    - **[feature, backend, edit_architecture]** : Implémentation du dossier `edit/` pour les sidecars (.edt). Migration auto + support corbeille.
    - **[feature, ui, video_player_modal]** : Support complet vidéo (MP4/WEBM) en Zoom et Plein écran.
    - **[feature, ui, video_hover_preview]** : Prévisualisation immédiate au survol de la souris.
    - **[feature, ui, video_soft_editor]** : Éditeur "Soft" pour vidéo (Playback Speed + Filtres CSS).
    - **[fix, navigation]** : Réécriture de la logique d'événements (suppression `cloneNode`) pour corriger les crashs "parentNode null".
    - **[perf, backend, db_optimization]** : Passage DB v13. Index composites + WAL mode.

  ROADMAP:
    Global:
      - [new_tool, session_log_tool]
      - [backend, periodic_maintenance_worker]
    ImageViewer Backend (Video):
      - **[feature, video_hard_bake_export]** : Transcoding FFmpeg pour appliquer définitivement les filtres lors de l'export.
      - **[feature, video_remux_fps]** : Modification des métadonnées du conteneur (MP4) pour changer les FPS sans réencodage.