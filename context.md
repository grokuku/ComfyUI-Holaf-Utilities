## 0. META: Interaction Rules & Protocols

    ### Purpose
    This file serves as the **primary source of truth** and **cognitive map**. It provides a complete architectural understanding without requiring the LLM to read the source code of every file in every session.

    ### Protocol for Updates
    When the user requests a "context update" or when a major feature is implemented, this file MUST be updated:
    1.  **Structural Changes**: Update **Section 2 (File Structure)**.
    2.  **Schema Evolutions**: Update **Section 4 (Database Schema)**.
    3.  **Logic Shifts**: Update **Section 3 (Key Concepts)**.
    4.  **New Dependencies**: Update **Section 1 (Stack)**.

    **Golden Rule**: Never paste raw code blocks. Use concise, high-level functional descriptions.

    ---
    ### FUNDAMENTAL SESSION AXIOMS
    ---

    *   **Expert Stance**: Act as a meticulous software expert. Anticipate errors.
    *   **Least Intervention**: Modify only what is necessary. No unsolicited refactoring.
    *   **Active Partnership**: Analyze and propose, don't just execute.
    *   **Truth Hierarchy**: Code > Context. Use context for mapping, code for editing.
    *   **Output**: Interaction in **French**, Code/Comments/Commits in **English**.

    ---

    ### SECTION 1: STACK & DEPENDENCIES

    *   **Python Environment:** ComfyUI embedded python.
    *   **Core Libraries:**
        *   `aiohttp` (Server/API/WebSockets/HTTP Client).
        *   `sqlite3` (Data storage) - WAL Mode, Memory Mapping.
        *   `watchdog` (Real-time filesystem monitoring).
        *   `orjson` (Fast JSON serialization).
        *   `aiofiles` (Async file I/O).
    *   **Specialized Libraries:**
        *   `Pillow` (Image processing), `python-xmp-toolkit` (XMP), `pynvml` (GPU).
        *   `pywinpty` (Windows) / `pty` (Linux/Mac) - Terminal emulation.
    *   **System Binaries:**
        *   **FFmpeg & FFprobe**: Video analysis/transcoding.
        *   **RIFE ncnn Vulkan**: AI video interpolation.
        *   **Git**: Node Manager operations.
    *   **Frontend:**
        *   Vanilla JS (ES Modules).
        *   **Libraries**: `Chart.js` (Monitor), `xterm.js` (Terminal), `marked.js` (Markdown).

    ---

    ### SECTION 2: FILE STRUCTURE

    📁 holaf_image_viewer_backend/
      > Core backend logic & Route Facade.
      📄 __init__.py : Exposes all routes.
      📁 routes/ : Modular API handlers (edit, export, file_ops, image, metadata, thumbnail, utility).
      📁 bin/ : Managed binaries (RIFE).
      📄 dependency_manager.py : RIFE auto-installer.
      📄 logic.py : Core business logic (FFmpeg/RIFE pipeline, DB sync).
      📄 worker.py : Background threads (Watchdog, Thumbnails).

    📁 js/
      > Frontend modules.
      📁 css/ : Modular CSS files (themes, panels, layout tools).
        📄 holaf_layout_tools.css : Styles for floating toolbar.
        📄 holaf_profiler.css : Styles for Profiler UI.
      📁 image_viewer/ : Gallery, Editor, State, UI logic.
      📁 model_manager/ : UI for Model Manager.
      📁 nodes/ : UI for Custom Nodes Manager.
      📁 profiler/ : UI for Workflow Profiler (Standalone view).
      📄 holaf_main.js : **[Core]** Static menu registration, Bridge Listener (Profiler), Global Modal Manager.
      📄 holaf_layout_tools.js : **[New]** Floating toolbar, Coordinate Poller, Graph Recentering logic.
      📄 holaf_monitor.js : System Monitor overlay.
      📄 holaf_settings_manager.js : Global settings UI.
      📄 holaf_terminal.js : xterm.js integration.
      📄 holaf_toast_manager.js : Non-blocking UI notifications.

    📁 nodes/
      > ComfyUI Custom Nodes (Python).
      📄 holaf_model_manager.py : Backend logic for Model scanning/hashing.
      📄 holaf_nodes_manager.py : Backend logic for nodes (Git/Pip operations).

    📄 __init__.py : Main extension entry.
    📄 holaf_config.py : `config.ini` manager.
    📄 holaf_database.py : Main SQLite manager (`holaf_utilities.sqlite`).
    📄 holaf_profiler_database.py : Profiler SQLite manager (`holaf_profiler.db`).
    📄 holaf_profiler_engine.py : Profiling logic (Hooks + Polling).
    📄 holaf_user_data_manager.py : Path management.
    📄 holaf_utils.py : Shared utilities.

    ---

    ### SECTION 3: KEY CONCEPTS & LOGIC

    #### 1. Image Viewer & Media
    *   **Sync**: Watchdog + SQLite.
    *   **Editing**: Non-destructive `.edt` sidecars.
    *   **Video**: FFmpeg/RIFE pipeline.

    #### 2. Layout Tools (Workflow Management)
    *   **Floating Toolbar**: Draggable UI, independent of ComfyUI menu version.
    *   **Coordinate System**: Uses `app.canvas.canvas.width/height` (Physical Pixels) to match LiteGraph's internal `ds.offset` matrix. *Note: Using clientWidth (logical) causes offsets on High-DPI screens.*
    *   **Recentering Logic**: Calculates Bounding Box of all nodes + groups to shift the graph to (0,0).
    *   **Subgraph Challenge**: Input/Output nodes in Subgraphs are special entities (`graph.input_node`, `graph.output_node`) and are NOT part of the standard `graph._nodes` list. Special handling is required to move them, otherwise, connections stretch infinitely.

    #### 3. Workflow Profiler
    *   **Architecture**: "Measure on Demand". Hooks into ComfyUI execution.
    *   **Bridge**: Uses `BroadcastChannel` to sync Workflow structure from the main tab to the Profiler tab.

    #### 4. Terminal & Security
    *   Secure PTY access via WebSocket + Hashed password.

    ---

    ### SECTION 4: DATABASE SCHEMAS

    #### Main DB (`holaf_utilities.sqlite`)
    *   **`images`**: Metadata, paths, tags, edit status.
    *   **`tags`**, **`imagetags`**: Tagging system.
    *   **`models`**: Scanned model info (SHA256).

    #### Profiler DB (`holaf_profiler.db`)
    *   **`profiler_runs`**: Execution summaries.
    *   **`profiler_steps`**: Per-node execution stats (VRAM, Time, GPU Load).

    ---

    ### PROJECT STATE

    *   **[Stable] Image Viewer, Terminal, Node Manager, Model Manager**.
    *   **[Stable] System Monitor**: Multi-GPU support, persistence.
    *   **[Beta] Layout Tools**:
        *   Coordinates Display: **Fixed** (High-DPI support).
        *   UI: **Fixed** (Draggable, Menu integration).
        *   Recentering: **Partial**. Works for standard workflows. **Fails for Subgraphs** (Input/Output nodes do not move, creating visual artifacts).
    *   **[Beta] Profiler**: Core engine ready. UI refining in progress. Bridge listener active.

    **Next Priority**: Fix Recentering logic for Subgraphs (Input/Output nodes) and stabilize Profiler.