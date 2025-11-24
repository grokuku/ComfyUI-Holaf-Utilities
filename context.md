--- START OF FILE context.txt ---

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
    📄 export_routes.py
    📄 file_ops_routes.py
    📄 image_routes.py
      > [**OPTIMIZED**] Listing API. Utilise maintenant des index composites pour une performance < 200ms.
    📄 metadata_routes.py
    📄 thumbnail_routes.py
      > Gestion des thumbnails. Supporte la priorisation via file d'attente.
    📄 utility_routes.py
  📄 __init__.py
  📄 logic.py
    > [**CRITICAL**] Core logic. Scanner de fichiers, Sync DB.
  📄 routes.py
  📄 worker.py

📁 js/
  > Frontend assets.
  📁 css/
    📄 holaf_image_viewer.css
  📁 image_viewer/
    📄 image_viewer_actions.js
    📄 image_viewer_editor.js
    📄 image_viewer_gallery.js
      > [**REFACTORED**] Virtual Scroller avec gestion active du réseau (AbortController) et Timeout de sécurité (30s).
    📄 image_viewer_infopane.js
    📄 image_viewer_navigation.js
    📄 image_viewer_settings.js
    📄 image_viewer_state.js
      > [**OPTIMIZED**] Gestion d'état optimisée pour éviter les clonages profonds inutiles sur les grands datasets.
    📄 image_viewer_ui.js
  📁 model_manager/
  📄 holaf_main.js
  📄 holaf_image_viewer.js
    > [**FIXED**] Contrôleur principal nettoyé des références obsolètes pour la sauvegarde des filtres.

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

*   **Sync Strategy:** `logic.py` scanne le dossier output. Il compare mtime/size/hash avec la DB.
*   **Thumbnailing (Frontend):** Virtual Scroller personnalisé. Charge uniquement les images visibles. Annule les requêtes (`abort()`) si l'utilisateur scrolle trop vite pour éviter la saturation réseau. Timeout strict de 30s pour éviter les blocages.
*   **Filtering Logic:**
    *   **Backend:** Requêtes SQL optimisées via Index Composite (`is_trashed`, `top_level_subfolder`, `mtime`).
    *   **Frontend:** État centralisé (`imageViewerState`).
*   **Workflow Availability:** Distingue si le workflow est embarqué dans le PNG (`internal_png`) ou dans un sidecar JSON (`external_json`).

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
*   **Indexes:**
    *   `idx_gallery_composite`: (is_trashed, top_level_subfolder, mtime DESC) -> **Performance Critique**.

---

### PROJECT STATE

  ACTIVE_BUGS: {}

  IN_PROGRESS:
    - (Aucune tâche active - Fin de session)

  COMPLETED_FEATURES (Recent):
    - **[perf, backend, db_optimization]** : Passage DB v13. Index composites + WAL mode. Vitesse listing x10.
    - **[perf, frontend, virtual_scroller]** : AbortController sur le scroll rapide, Timeout 30s, suppression des memory leaks.
    - **[fix, ui, filters]** : Correction du bug de sélection des dossiers (références objets JS).
    - **[feature, video_support_basic]** : Support MP4/WEBM.
    - **[feature, ui, unified_search]** : Barre de recherche unique avec scopes.

  ROADMAP:
    Global:
      - [new_tool, session_log_tool]
      - [backend, periodic_maintenance_worker]
    ImageViewer:
      - **Améliorations Futures (Vidéo) :**
          - `[feature, ui, video_hover_preview]` : Prévisualisation au survol.
          - `[feature, ui, video_player_modal]` : Lecteur vidéo simple.
--- END OF FILE context.txt ---