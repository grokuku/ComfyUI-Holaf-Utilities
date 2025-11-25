# AiKore: Technical Project Context & Manifest
    
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
    
    ## 1. System Overview
    
    AiKore is a monolithic orchestration platform designed to manage AI WebUIs inside a **single Docker container**.
    
    ### Core Stack
    *   **Orchestration**: `s6-overlay` (manages backend services and NGINX).
    *   **Backend**: Python 3.12 + **FastAPI** + **SQLAlchemy** (SQLite).
    *   **Frontend**: Vanilla JavaScript (ES Modules). Uses `Split.js`, `xterm.js`, `CodeMirror`.
    *   **Networking**: **NGINX** (Dynamic Reverse Proxy) + **KasmVNC** (Persistent Desktop Sessions).
    
    ---
    
    ## 2. Project Structure & File Tree
    
    This tree represents the complete architecture. Key files are annotated with their specific responsibilities.
    
    ```text
    .
    ├── aikore/                             # MAIN APPLICATION PACKAGE
    │   ├── api/                            # API Endpoints (Routers)
    │   │   ├── __init__.py
    │   │   ├── instances.py                # CORE: CRUD, Actions (Start/Stop), Port Self-Healing, Websockets
    │   │   └── system.py                   # System Stats (NVML), Blueprint listing
    │   │
    │   ├── core/                           # Business Logic
    │   │   ├── __init__.py
    │   │   ├── blueprint_parser.py         # Reads metadata headers from .sh files
    │   │   └── process_manager.py          # BRAIN: Subprocess mgmt, PTY generation, NGINX config generation
    │   │
    │   ├── database/                       # Persistence Layer
    │   │   ├── __init__.py
    │   │   ├── crud.py                     # DB Operations (Create/Read/Update/Delete)
    │   │   ├── migration.py                # Auto-migration logic on startup
    │   │   ├── models.py                   # SQLAlchemy definitions (Instances, Meta)
    │   │   └── session.py                  # SQLite connection setup
    │   │
    │   ├── schemas/                        # Pydantic Models (Validation)
    │   │   ├── __init__.py
    │   │   └── instance.py                 # Instance schemas (Base, Create, Read, Update)
    │   │
    │   ├── static/                         # FRONTEND ASSETS
    │   │   ├── css/
    │   │   │   ├── base.css                # Layout & Split.js
    │   │   │   ├── components.css          # Context Menus, Progress Bars
    │   │   │   ├── instances.css           # Instance Table styling (Grouping logic)
    │   │   │   ├── modals.css              # Popups
    │   │   │   └── tools.css               # Terminal/Editor styling
    │   │   ├── js/
    │   │   │   ├── api.js                  # Fetch wrappers
    │   │   │   ├── eventHandlers.js        # Click/Input events & Global Save
    │   │   │   ├── main.js                 # Entry Point: Polling & Grouped Rendering
    │   │   │   ├── modals.js               # Modal logic
    │   │   │   ├── state.js                # Centralized State Store
    │   │   │   ├── tools.js                # Tools (Terminal, Editor, Welcome) logic
    │   │   │   └── ui.js                   # DOM Manipulation (Dirty rows, Normalization)
    │   │   ├── welcome/                    # "CRT Style" Welcome Screen
    │   │   └── index.html                  # Main HTML Entry Point
    │   │
    │   ├── main.py                         # FastAPI Entry Point (Startup logic)
    │   └── requirements.txt                # Backend Python Dependencies
    │
    ├── blueprints/                         # INSTALLATION SCRIPTS
    │   ├── legacy/                         # Old scripts archive
    │   ├── ComfyUI.sh                      # Example Blueprint
    │   ├── FluxGym.sh                      # Example Blueprint
    │   └── ...
    │
    ├── docker/                             # CONTAINER OVERLAY
    │   └── root/
    │       └── etc/
    │           ├── nginx/conf.d/aikore.conf # Main NGINX Config (Proxy & Websockets)
    │           ├── s6-overlay/             # S6 Services Definition
    │           │   ├── s6-init.d/          # Init scripts (Permissions)
    │           │   └── s6-rc.d/            # Service Run Scripts (svc-app, svc-nginx)
    │           └── sudoers.d/              # Sudo rules for 'abc' user
    │
    ├── scripts/                            # HELPER SCRIPTS
    │   ├── kasm_launcher.sh                # Orchestrates Persistent Mode (Xvnc + Openbox + App)
    │   └── version_check.sh                # Env diagnostics tool
    │
    ├── Dockerfile                          # Main Image Definition
    ├── Dockerfile.buildbase                # Builder Image (Wheels compilation)
    ├── docker-compose.yml                  # Production Deployment
    ├── docker-compose.dev.yml              # Development Deployment
    ├── entry.sh                            # Container Runtime Entrypoint (Activates Conda -> Python)
    ├── functions.sh                        # Bash Library for Blueprints (Symlinks, Git Sync)
    ├── Makefile                            # Command shortcuts
    └── requirements.txt                    # (Root reqs, usually symlinked or copied to aikore/)
    ```
    
    ---
    
    ## 3. Key Concepts & Logic
    
    ### Instance Types & Families
    1.  **Standard**: Headless (NGINX proxy).
    2.  **Persistent**: GUI (KasmVNC via dedicated port).
    3.  **Satellite**:
        *   **Concept**: A lightweight instance that reuses the Parent's installation (venv, code) but has its own Output folder and runtime config (GPU, Port).
        *   **UI Representation**: Grouped visually with the Parent in a single block (via `<tbody>` tags in `main.js`). Dragging affects the whole family.
        *   **Constraints**: `base_blueprint` and `output_path` are inherited from the Parent and **locked** (read-only) in the UI.
    
    ### Port Management
    *   **Public Pool**: Range defined in Docker Compose (`AIKORE_INSTANCE_PORT_RANGE`, default `19001-19020`).
    *   **Normal Mode**: `port` (internal app) = Public Pool Port.
    *   **Persistent Mode**: `persistent_port` (VNC) = Public Pool Port. `port` (internal app) = Ephemeral (Random).
    *   **Self-Healing**: Auto-allocation occurs in `api/instances.py` on startup if ports are missing/null.
    
    ### Lazy Filesystem Provisioning
    *   **Principle**: Creating an instance in the DB (especially Satellites) does **not** create a folder immediately in `/config/instances`.
    *   **Trigger**: The folder structure is created by `core/process_manager.py` only when the instance is **started** for the first time, to store `output.log` and the PID file.
    
    ---
    
    ## 4. Database Schema (V5)
    
    | Column | Type | Description |
    | :--- | :--- | :--- |
    | `id` | Int | Primary Key. |
    | `parent_instance_id` | Int | **(V5)** Links Satellite to Parent. Null for Root instances. |
    | `name` | String | Unique name (folder name). |
    | `base_blueprint` | String | Script filename (e.g., `ComfyUI.sh`). |
    | `status` | String | `stopped`, `starting`, `started`, `installing`, `error`. |
    | `gpu_ids` | String | `CUDA_VISIBLE_DEVICES` string (e.g., "0,1"). |
    | `port` | Int | Internal HTTP port for the application. |
    | `persistent_mode` | Bool | True = Launches KasmVNC stack. |
    | `persistent_port` | Int | Public VNC port (if enabled). |
    | `persistent_display`| Int | X11 Display ID (e.g., 10 for :10). |
    | `output_path` | String | Override output folder path. |
    | `hostname` | String | Custom URL override (for local DNS). |
    | `use_custom_hostname`| Bool | Toggle for hostname usage. |