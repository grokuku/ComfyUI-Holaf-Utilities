## 0. META: Interaction Rules & Protocols
    
    ### Purpose
    This file serves as the **primary source of truth** and **cognitive map**. Its goal is to provide a complete architectural understanding without requiring the LLM to read the source code of every file in every session. It bridges the gap between the raw file tree and the high-level business logic.
    
    ### Protocol for Updates
    When the user requests a "context update" or when a major feature is implemented, the following information MUST be integrated/updated in this file:
    1.  **Structural Changes**: If files are created, renamed, moved, or deleted, update **Section 2 (File Structure)** to reflect the new tree and the responsibility of the new files.
    2.  **Schema Evolutions**: If `models.py` or `migration.py` changes, update **Section 4 (Database Schema)** to reflect the current V-version and columns.
    3.  **Logic Shifts**: If the core way the backend handles processes, ports, saving, or networking changes, update **Section 3 (Key Concepts)**.
    4.  **New Dependencies**: If `Dockerfile` or `requirements.txt` changes significantly (new tools like KasmVNC, new libs), update **Section 1 (Stack)**.
    
    **Golden Rule**: Never paste raw code blocks in this file. Use concise, high-level functional descriptions to minimize token usage while maximizing understanding.
    
    ---
    ### FUNDAMENTAL SESSION AXIOMS
    ---
    
    #### **AXIOM 1: BEHAVIORAL (The Spirit of Collaboration)**
    
    *   **Expert Stance**: I act as a software development expert, meticulous and proactive. I anticipate potential errors and suggest relevant verification points after each modification.
    *   **Principle of Least Intervention**: I only modify what is strictly necessary to fulfill the request. I do not introduce any unsolicited modifications (e.g., refactoring, optimization).
    *   **Active Partnership**: I position myself as a development partner who analyzes and proposes, not just a simple executor.
    *   **Ambiguity Management**: If a request is ambiguous or if information necessary for its proper execution is missing, I will ask for clarifications before proposing a solution.
    
    #### **AXIOM 2: ANALYSIS AND SECURITY (No Blind Action)**
    
    *   **Knowledge of Current State**: Before ANY file modification, if I do not have its full and up-to-date content in our session, I must imperatively ask you for it. Once received, I will consider it up-to-date and will not ask for it again, unless explicitly notified of an external modification.
    *   **Mandatory Prior Analysis**: I will never propose a code modification command (e.g., `sed`) without having analyzed the content of the concerned file in the current session beforehand.
    *   **Proactive Dependency Verification**: My knowledge base ends in early 2023. Therefore, before integrating or using a new tool, library, or package, I must systematically perform a search. I will summarize key points (stable version, breaking changes, new usage practices) in the `project_context.md` file.
    *   **Data Protection**: I will never propose a destructive action (e.g., `rm`, `DROP TABLE`) on data in a development environment without proposing a workaround (e.g., renaming, backup).
    
    #### **AXIOM 3: CODE DELIVERY (Clarity and Reliability)**
    
    *   **Method 1 - Atomic Modification via `sed`**:
        *   **Usage**: Only for a simple modification, targeted at a single line (content modification, addition, or deletion), and without any risk of syntax or context error.
        *   **Format**: The `sed` command must be provided on a single line for Git Bash, with the main argument encapsulated in single quotes (`'`). The new file content will not be displayed.
        *   **Exclusivity**: No other command-line tool (`awk`, `patch`, `tee`, etc.) will be used for file modification.
    *   **Method 2 - Full File (Default)**:
        *   **Usage**: This is the default method. It is mandatory if a `sed` command is too complex, risky, or if modifications are substantial.
        *   **Format**: I provide the full and updated content of the file.
    *   **Formatting of Delivery Blocks**:
        *   **Markdown Files (`.md`)**: I will use a non-indented markdown code block (```md) non indenté. The full content of the file will be systematically indented by four spaces inside this block.
        *   **Other Files (Code, Config, etc.)**: I will use a standard code block (```language). Opening and closing tags will never be indented, but the code inside will be systematically indented by four spaces.
    
    #### **AXIOM 4: WORKFLOW (One Step at a Time)**
    
    1.  **Explicit Validation**: After each modification proposal (whether by `sed` or full file), I pause. I wait for your explicit agreement ("OK", "Applied", "Validated", etc.) before moving to another file or task.
    2.  **Continuous Dependency Documentation**: If a dependency version proves to be newer than my knowledge base, I log its version number and relevant usage notes in the `project_context.md` file.
    3.  **End of Feature Documentation**: At the end of the development of a major feature and after your final validation, I will proactively propose updating project tracking files, notably `project_context.md` and `features.md`.
    
    #### **AXIOM 5: LINGUISTICS (Strict Bilingualism)**
    
    *   **Our Interactions**: All our discussions, my explanations, and my questions are conducted exclusively in **French**.
    *   **The Final Product**: Absolutely all deliverables (code, comments, docstrings, variable names, logs, interface texts, etc.) are written exclusively in **English**.
    
    ---

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
    *   `psutil` (System Stats), `pywinpty` (Windows Terminal).
*   **Frontend:**
    *   Vanilla JS (ES Modules).
    *   **BroadcastChannel API** : Communication inter-onglets (Mode Standalone).
    *   **Chart.js** : Utilisé pour `holaf_monitor.js`.

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
    📄 metadata_routes.py
    📄 thumbnail_routes.py
      > [**OPTIMIZED**] Utilise `GlobalStatsManager` (RAM) pour les stats au lieu de SQL (Anti-Lock).
    📄 utility_routes.py
  📄 __init__.py
  📄 logic.py
    > [**CRITICAL**] Core logic.
    > - **In-Memory Stats** : `GlobalStatsManager` singleton pour éviter la contention SQL.
    > - **Process Safety** : Timeouts ajoutés sur `subprocess.Popen` (ffmpeg/ffprobe).
  📄 routes.py
  📄 worker.py

📁 js/
  > Frontend assets.
  📁 css/
    📄 holaf_image_viewer.css
  📁 image_viewer/
    📄 image_viewer_actions.js
    📄 image_viewer_editor.js
      > [**UX FIX**] Reset immédiat de l'interface au changement d'image (plus d'image "fantôme").
    📄 image_viewer_gallery.js
      > [**PERF**] Virtual Scrolling optimisé : Cache LRU pour thumbnails, Annulation réseau agressive (AbortController).
      > [**FIX**] Support correct du paramètre `nocrop` (Images & Vidéos).
    📄 image_viewer_infopane.js
      > [**STANDALONE**] Envoie les workflows via `holafBridge` si hors de ComfyUI.
    📄 image_viewer_navigation.js
    📄 image_viewer_settings.js
    📄 image_viewer_state.js
    📄 image_viewer_ui.js
  📁 model_manager/
  📄 holaf_comfy_bridge.js
    > [**NEW**] Wrapper `BroadcastChannel` pour la communication Onglet <-> Onglet.
  📄 holaf_main.js
  📄 holaf_image_viewer.js
    > [**UPDATED**] Point d'entrée unifié. Gère le mode "Modal" (Comfy) et "Standalone" (Nouvel Onglet).
  📄 holaf_monitor.js
    > [**BUGGED**] System Monitor Overlay. Problèmes de redimensionnement vertical du graphique Chart.js.

📁 nodes/
  📄 holaf_model_manager.py
  📄 holaf_nodes_manager.py

📄 __init__.py
  > [**UPDATED**] Route `/holaf/view` pour servir la galerie autonome (HTML léger).
📄 __main__.py
📄 context.txt
📄 holaf_config.py
📄 holaf_database.py
📄 holaf_server_management.py
📄 holaf_system_monitor.py
  > Backend pour le monitoring (psutil/nvidia-smi).
📄 holaf_terminal.py
📄 holaf_utils.py
📄 requirements.txt

---

### SECTION 3: KEY CONCEPTS

*   **Standalone Mode (New Tab):**
    *   **Access:** Via bouton "Holaf Viewer (New Tab)" dans le menu.
    *   **Architecture:** Route `/holaf/view` sert une coquille HTML vide qui charge les JS.
    *   **Communication:** Utilise `BroadcastChannel` (`holaf_comfy_bridge.js`) pour envoyer des commandes (ex: Load Workflow) à l'onglet ComfyUI principal.
*   **Performance Optimization (RAM vs Disk):**
    *   **Stats:** Le backend maintient un compteur d'images en RAM (`GlobalStatsManager`). La route `/thumbnail-stats` ne touche plus la DB. Élimine les verrous SQL lors de la génération massive de thumbnails.
    *   **Frontend:** Cache LRU (Least Recently Used) pour stocker les Blob URLs des thumbnails.
*   **System Monitor (Overlay):**
    *   Overlay flottant affichant CPU/RAM (Barres) et GPU (Graphique).
    *   **Architecture:** Backend WebSocket -> Frontend Chart.js.
    *   **Problème Actuel:** Le graphique GPU refuse de s'étirer verticalement lors du redimensionnement de la fenêtre, malgré l'utilisation de `maintainAspectRatio: false`, Flexbox, Grid, ou calcul manuel JS. Une limite horizontale "fantôme" empêche aussi l'élargissement correct.

---

### PROJECT STATE

  ACTIVE_BUGS:
    - **[monitor, ui]** : Le graphique Chart.js ne suit pas le redimensionnement vertical de la fenêtre (reste écrasé).
    - **[monitor, ui]** : Présence d'une limite de largeur maximale ("max-width" fantôme) empêchant d'agrandir la fenêtre horizontalement au-delà d'un certain point, provoquant un débordement du contenu.

  IN_PROGRESS:
    - **[monitor]** : Tentative de refonte du layout `holaf_monitor.js`.
      - *Méthodes échouées* : Flexbox Grow, Grid Layout, Absolute Positioning (top/bottom anchors), JS Manual Pixel Force (`canvas.width = x`), CSS `calc()`.
      - *Suspect* : Conflit CSS global ComfyUI ou comportement interne de la version Chart.js utilisée.

  COMPLETED_FEATURES:
    - **[perf, backend]** : `GlobalStatsManager` (In-Memory Stats).
    - **[perf, frontend]** : Cache LRU Galerie + AbortController.
    - **[feature, standalone]** : Mode "Nouvel Onglet" complet avec Bridge.
    - **[ux]** : Correction "nocrop" vidéo et "ghosting" éditeur.

  ROADMAP:
    Global:
      - [new_tool, session_log_tool]
      - [backend, periodic_maintenance_worker]
    ImageViewer Backend:
      - **[feature, video_remux_fps]** : Modification des métadonnées du conteneur (MP4).
      - **[perf, batch_processing]** : Amélioration des performances pour les opérations de masse.