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
    *   `Pillow` (Image processing) - Used for applying edits to static images.
    *   `python-xmp-toolkit` (XMP Metadata support)
*   **System Dependencies:**
    *   **FFmpeg** : Requis dans le PATH système. Indispensable pour :
        *   Thumbnails Vidéo.
        *   **Hard Bake Export** (Transcodage MP4/GIF avec application des filtres).
    *   `psutil`, `pywinpty` (Windows only) for System Monitor/Terminal.

---

### SECTION 2: FILE STRUCTURE

📁 holaf_image_viewer_backend/
  > Backend logic for the Image Viewer.
  📁 routes/
    > Modular API route handlers.
    📄 __init__.py
    📄 edit_routes.py
      > Gestion des fichiers `.edt` (JSON) dans sous-dossier `edit/`.
    📄 export_routes.py
      > [**UPDATED**] Supporte l'export MP4 et GIF. Logique de sélection intelligente du format selon le contenu.
    📄 file_ops_routes.py
    📄 image_routes.py
      > Listing API optimisé (Index Composite).
    📄 metadata_routes.py
    📄 thumbnail_routes.py
      > [**UPDATED**] "Dynamic Thumbnails" : Charge les fichiers `.edt` pour appliquer les edits (Luma/Contrast/Hue) lors de la génération.
    📄 utility_routes.py
  📄 __init__.py
  📄 logic.py
    > [**CRITICAL**] Core logic.
    > - Scanner de fichiers (Ignore `trashcan` et `edit/`).
    > - **Video Transcoding** : Fonctions `transcode_video_with_edits` (FFmpeg filter_complex) pour MP4 et GIF.
    > - **Image Processing** : `apply_edits_to_image` supporte maintenant Hue (via conversion HSV).
  📄 routes.py
  📄 worker.py

📁 js/
  > Frontend assets.
  📁 css/
    📄 holaf_image_viewer.css
  📁 image_viewer/
    📄 image_viewer_actions.js
      > [**UPDATED**] Dialogue d'export contextuel (propose MP4/GIF si vidéo sélectionnée).
    📄 image_viewer_editor.js
    📄 image_viewer_gallery.js
      > [**UPDATED**] "Soft Edit Preview" : Applique les filtres CSS dynamiquement sur le `<video>` au survol de la souris.
    📄 image_viewer_infopane.js
    📄 image_viewer_navigation.js
    📄 image_viewer_settings.js
    📄 image_viewer_state.js
    📄 image_viewer_ui.js
  📁 model_manager/
  📄 holaf_main.js
  📄 holaf_image_viewer.js

📁 nodes/
  📄 holaf_model_manager.py
  📄 holaf_nodes_manager.py

📄 __init__.py
📄 __main__.py
📄 context.txt
📄 holaf_config.py
📄 holaf_database.py
📄 holaf_server_management.py
📄 holaf_system_monitor.py
📄 holaf_terminal.py
📄 holaf_utils.py
📄 requirements.txt

---

### SECTION 3: KEY CONCEPTS

*   **Editing Architecture (Sidecars):**
    *   **Storage:** Fichiers `.edt` dans `image_folder/edit/`.
    *   **Format:** JSON stockant Brightness, Contrast, Saturation, Hue.
    *   **Application:**
        *   **Frontend:** Filtres CSS (Soft Edit) pour l'affichage temps réel.
        *   **Backend (Thumbnails):** Pillow/FFmpeg appliquent les filtres lors de la génération de la miniature.
        *   **Backend (Export):** FFmpeg "Hard Bake" (réencodage) pour les vidéos/GIFs.
*   **Video Handling:**
    *   **Playback:** Native HTML5.
    *   **Hover Preview:** Lecture muette au survol. Récupère le `.edt` pour appliquer les filtres CSS correspondants.
    *   **Export:** Support MP4 (x264) et GIF (PaletteGen optimisée).
*   **Sync Strategy:** `logic.py` scanne le dossier output. Il compare mtime/size/hash avec la DB.
*   **Filtering Logic:** Requêtes SQL optimisées via Index Composite `idx_gallery_composite`.

---

### SECTION 4: DATABASE SCHEMA

*   **File:** `holaf_utilities.sqlite`
*   **Current Version:** 13
*   **Table `images` (Key Columns):**
    *   `path_canon` (Unique ID path)
    *   `top_level_subfolder`, `mtime`, `is_trashed`, `format`
    *   `has_edit_file` (Boolean flag for fast UI feedback)
*   **Indexes:**
    *   `idx_gallery_composite`: (is_trashed, top_level_subfolder, mtime DESC).

---

### PROJECT STATE

  ACTIVE_BUGS: {}

  IN_PROGRESS:
    - (Aucune tâche active - Fin de session)

  COMPLETED_FEATURES (Recent):
    - **[feature, backend, edit_architecture]** : Migration sidecars `.edt` vers dossier `edit/`.
    - **[feature, ui, video_player_modal]** : Support complet vidéo (Zoom/Fullscreen).
    - **[feature, backend, dynamic_thumbnails]** : Les miniatures (img/vidéo) reflètent les édits (luminosité, teinte, etc.).
    - **[feature, backend, video_hard_bake_export]** : Export vidéo avec application définitive des filtres via FFmpeg.
    - **[feature, backend, video_gif_export]** : Export vidéo vers GIF haute qualité.
    - **[feature, ui, video_hover_soft_edit]** : Prévisualisation au survol avec application dynamique des filtres CSS.
    - **[feature, ui, smart_export_dialog]** : Dialogue d'export contextuel (formats adaptés au contenu).

  ROADMAP:
    Global:
      - [new_tool, session_log_tool]
      - [backend, periodic_maintenance_worker]
    ImageViewer Backend:
      - **[feature, video_remux_fps]** : Modification des métadonnées du conteneur (MP4) pour changer les FPS sans réencodage.
      - **[perf, batch_processing]** : Amélioration des performances pour les opérations de masse (delete/move).