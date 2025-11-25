## 0. META: Interaction Rules & Protocols
    
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
*   **Frontend:**
    *   Vanilla JS (ES Modules).
    *   **BroadcastChannel API** : Communication inter-onglets (Mode Standalone).
    *   **No-Bundler Strategy** : Chargement direct des modules ES6.

---

### SECTION 2: FILE STRUCTURE

📁 holaf_image_viewer_backend/
  > Backend logic for the Image Viewer.
  📁 routes/
    📄 thumbnail_routes.py
      > [**OPTIMIZED**] Utilise `GlobalStatsManager` (RAM) pour les stats.
  📄 logic.py
    > [**CRITICAL**] Core logic. In-Memory Stats singleton.

📁 js/
  > Frontend assets.
  📁 css/
    📄 holaf_image_viewer.css
      > [**UPDATED**] Support du mode Standalone (Body class `holaf-standalone-mode`, `:root` fallbacks pour les variables de thème).
  📁 image_viewer/
    📄 image_viewer_actions.js
    📄 image_viewer_editor.js
    📄 image_viewer_gallery.js
      > [**PERF**] Virtual Scrolling, Cache LRU, Network Cancellation.
    📄 image_viewer_infopane.js
      > [**STANDALONE SAFE**] Chargement conditionnel de `app.js` (évite les crashs hors de ComfyUI).
    📄 image_viewer_navigation.js
    📄 image_viewer_settings.js
    📄 image_viewer_state.js
    📄 image_viewer_ui.js
  📄 holaf_comfy_bridge.js
    > [**NEW**] Wrapper `BroadcastChannel` pour la communication Onglet <-> Onglet.
  📄 holaf_image_viewer.js
    > [**ENTRY POINT**] Gère l'initialisation "Safe". Applique la classe CSS `holaf-standalone-mode` sur le body si URL détectée.
  📄 holaf_panel_manager.js
    > [**FIXED**] Suppression totale des imports vers `app.js` pour éviter les crashs en standalone.

📄 __init__.py
  > [**ROUTE**] `/holaf/view` sert la coquille HTML vide pour le mode Standalone.

---

### SECTION 3: KEY CONCEPTS

*   **Standalone Mode Architecture (The "Iron Wall"):**
    *   **Isolation:** Le code JS doit être strictement agnostique de l'objet global `app` ou `window.comfyAPI` lorsqu'il tourne sur `/holaf/view`.
    *   **Dynamic Imports:** Les fichiers qui *doivent* interagir avec ComfyUI (ex: `infopane.js` pour charger un workflow) doivent utiliser `if (!isStandalone) import(...)` pour ne pas déclencher l'exécution de `app.js` dans l'onglet autonome.
    *   **Styling:** Le mode Standalone applique la classe `holaf-standalone-mode` sur le `<body>`. Le CSS utilise cette classe pour :
        *   Forcer le plein écran (`fixed`, `100vw`, `100vh`).
        *   Masquer la barre de titre flottante (`.holaf-utility-header`).
        *   Utiliser des variables de couleur de repli (`:root`) car les thèmes ComfyUI ne sont pas chargés.
*   **Communication (Bridge):**
    *   Utilise `BroadcastChannel` (`holaf_comfy_bridge.js`).
    *   Le Viewer envoie : `LOAD_WORKFLOW`.
    *   L'onglet Principal écoute et exécute : `app.loadGraphData(...)`.

---

### SECTION 4: DATABASE SCHEMA

*   **File:** `holaf_utilities.sqlite`
*   **Current Version:** 13
*   **Table `images`:** `path_canon` (PK), `thumbnail_status`, `thumbnail_priority_score`, `has_edit_file`, etc.

---

### PROJECT STATE

  ACTIVE_BUGS: {}

  IN_PROGRESS:
    - (Aucune tâche active - Fin de session Standalone)

  COMPLETED_FEATURES (Session "Standalone & UI"):
    - **[feature, standalone]** : Mode "Nouvel Onglet" fonctionnel et stable.
    - **[fix, crash]** : Suppression des imports statiques de `app.js` dans `holaf_panel_manager.js` et `infopane.js` pour empêcher le crash de la page blanche.
    - **[feature, bridge]** : Communication bidirectionnelle (Load Workflow) via `BroadcastChannel`.
    - **[fix, ui]** : CSS adapté pour gérer le plein écran (Layout Flexbox corrigé, barre de titre masquée via classe body).

  ROADMAP:
    Global:
      - [new_tool, session_log_tool]
    ImageViewer Frontend:
      - **[fix, ui]** : Corriger l'apparence des popups (dialogs) en mode Standalone (actuellement style ComfyUI manquant).
    ImageViewer Backend:
      - [feature, video_remux_fps]
      - [perf, batch_processing]