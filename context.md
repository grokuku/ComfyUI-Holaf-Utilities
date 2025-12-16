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
    *   **Markdown Files (`.md`)** : J'utiliserai un bloc de code markdown (```md) non indenté. Le contenu intégral du fichier sera systématiquement indenté de quatre espaces à l'intérieur de ce bloc.
    *   **Autres Fichiers (Code, Config, etc.)** : J'utiliserai un bloc de code standard (```langue). Les balises d'ouverture et de fermeture ne seront jamais indentées, mais le code à l'intérieur le sera systématiquement de quatre espaces.

#### **AXIOME 4 : WORKFLOW (Un Pas Après l'Autre)**

1.  **Validation Explicite** : Après chaque proposition de modification (que ce soit par `sed` ou par fichier complet), je marque une pause. J'attends votre accord explicite ("OK", "Appliqué", "Validé", etc.) avant de passer à un autre fichier ou à une autre tâche.
2.  **Documentation Continue des Dépendances** : Si la version d'une dépendance s'avère plus récente que ma base de connaissances, je consigne son numéro de version et les notes d'utilisation pertinentes dans le fichier `project_context.md`.
3.  **Documentation de Fin de Fonctionnalité** : À la fin du développement d'une fonctionnalité majeure et après votre validation finale, je proposerai de manière proactive la mise à jour des fichiers de suivi du projet, notamment `project_context.md` et `features.md`.

#### **AXIOME 5 : LINGUISTIQUE (Bilinguisme Strict)**

*   **Nos Interactions** : Toutes nos discussions, mes explications et mes questions se déroulent exclusivement en **français**.
*   **Le Produit Final** : Absolument tout le livrable (code, commentaires, docstrings, noms de variables, logs, textes d'interface, etc.) est rédigé exclusivement en **anglais**.

---

---

### SECTION 1: STACK & DEPENDENCIES

*   **Python Environment:** ComfyUI embedded python.
*   **Key Libraries:**
    *   `aiohttp` (Server/API)
    *   `sqlite3` (Database) - **Optimized:** WAL Mode enabled, Memory Mapping active.
    *   `Pillow` (Image processing) - Used for applying edits to static images.
    *   `python-xmp-toolkit` (XMP Metadata support)
    *   `pynvml` (NVIDIA Management Library) - GPU profiling.
*   **System Dependencies:**
    *   **FFmpeg & FFprobe** : Requis dans le PATH système. Indispensables pour les thumbnails, l'analyse FPS et l'export.
    *   **RIFE ncnn Vulkan** : Binaire externe géré automatiquement par `dependency_manager.py` pour l'interpolation vidéo par IA.
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
      > [**UPDATED**] Supporte `/process-video` et `/rollback-video`. Logique FPS plus robuste.
    📄 export_routes.py
    📄 file_ops_routes.py
    📄 image_routes.py
    📄 metadata_routes.py
    📄 thumbnail_routes.py
    📄 utility_routes.py
  📁 bin/
    > [**NEW**] Dossier géré automatiquement contenant les exécutables externes (ex: RIFE).
  📄 __init__.py
  📄 dependency_manager.py
    > [**NEW**] Téléchargement et installation automatique de `rife-ncnn-vulkan`.
  📄 logic.py
    > [**UPDATED**] `VIDEO_FORMATS` étendu (.mkv, .mov, etc.). Intègre `get_video_fps`, `generate_proc_video`.
  📄 routes.py
  📄 worker.py

📁 js/
  > Frontend assets.
  📁 css/
    📄 holaf_image_viewer.css
  📁 image_viewer/
    📄 image_viewer_actions.js
    📄 image_viewer_editor.js
      > [**FIXED**] Classe `ImageEditor` fonctionnelle. Supporte `hasUnsavedChanges`, injection du viewer (DOM), et contrôles FPS.
    📄 image_viewer_gallery.js
    📄 image_viewer_infopane.js
    📄 image_viewer_navigation.js
    📄 image_viewer_settings.js
    📄 image_viewer_state.js
    📄 image_viewer_ui.js
      > [**UPDATED**] Supporte l'override de la source vidéo (Preview Mode) via EventListener.
  📁 model_manager/
  📄 holaf_comfy_bridge.js
  📄 holaf_main.js
  📄 holaf_image_viewer.js
  📄 holaf_monitor.js

📁 nodes/
  📄 holaf_model_manager.py
  📄 holaf_nodes_manager.py

📄 __init__.py
📄 __main__.py
📄 context.txt
📄 holaf_config.py
📄 holaf_database.py
📄 holaf_profiler_database.py
📄 holaf_profiler_engine.py
📄 holaf_server_management.py
📄 holaf_system_monitor.py
📄 holaf_terminal.py
📄 holaf_user_data_manager.py
📄 holaf_utils.py
📄 requirements.txt

---

### SECTION 3: KEY CONCEPTS

*   **Side-Load Processing (Preview Mode):**
    *   **Concept:** Génération d'un fichier intermédiaire (`_proc.mp4`) dans le dossier `edit/` pour prévisualiser les traitements lourds (RIFE).
    *   **Flux:** L'utilisateur clique "Generate Preview" -> Backend lance RIFE -> UI remplace la source vidéo par le fichier `_proc` et affiche un badge "PREVIEW MODE".
    *   **Rollback:** L'utilisateur peut supprimer ce fichier pour revenir à la vue originale.
    *   **⚠️ Status:** Code implémenté mais **NON TESTÉ** et probablement instable.
*   **Video Export (Hard Bake):**
    *   **FPS Target:** Vitesse pilotée par FPS cible. Calcul dynamique du ratio.
    *   **Interpolation (RIFE):** Pipeline optionnel : Extract Frames -> RIFE -> Assemble.
*   **Gallery Performance:** Debounce & Cleanup (AbortController).

---

### PROJECT STATE

  ACTIVE_BUGS:
    - **[Frontend, RIFE/Sideload]** : Les fonctionnalités de Preview Vidéo (Side-load) et d'interpolation RIFE sont présentes dans le code mais **non testées**.
        - Risques : Crash serveur lors de l'exécution du binaire RIFE, problèmes de chemin (`_proc.mp4`), UI qui ne se met pas à jour après génération.
        - Action requise : Phase de test dédiée.

  IN_PROGRESS:
    - **[feature, video_workflow]** : Validation du pipeline RIFE et Sideload.

  COMPLETED_FEATURES:
    - **[fix, frontend]** : Éditeur d'image réparé (Events, DOM, FPS Controls).
    - **[backend, fps]** : Détection FPS robuste (formats étendus) et transcodage (ffmpeg).
    - **[backend, rife_setup]** : Installation auto de RIFE ncnn Vulkan.
    - **[perf, gallery]** : Optimisation anti-freeze.
    - **[feature, export]** : Export Vidéo fonctionnel (hors RIFE UI).

  ROADMAP:
    Immediate:
      - **[test, rife]** : Tester la génération de preview RIFE et le mécanisme de Rollback.
    ImageViewer Backend:
      - **[perf, batch_processing]** : Opérations de masse.
    Global:
      - [new_tool, session_log_tool]