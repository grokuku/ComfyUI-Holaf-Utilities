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
    *   `aiohttp` (Server/API/WebSockets/HTTP Client). *Used for backend routes and GitHub API queries.*
    *   `sqlite3` (Data storage) - **Optimized:** WAL Mode, Memory Mapping.
    *   `watchdog` (Real-time filesystem monitoring).
    *   `orjson` (Fast JSON serialization, optional fallback to json).
    *   `aiofiles` (Async file I/O).
*   **Specialized Libraries:**
    *   `Pillow` (Image processing).
    *   `python-xmp-toolkit` (XMP Metadata).
    *   `pynvml` (NVIDIA Management Library) - GPU profiling for Profiler & Monitor.
    *   `pywinpty` (Windows) / `pty` (Linux/Mac) - Terminal emulation.
*   **System Binaries:**
    *   **FFmpeg & FFprobe**: Required in PATH for video analysis, thumbnails, and transcoding.
    *   **RIFE ncnn Vulkan**: Managed binary (auto-downloaded) for AI video interpolation.
    *   **Git**: Required in PATH for Node Manager operations (clone/pull).
*   **Frontend:**
    *   Vanilla JS (ES Modules).
    *   **Libraries**: `Chart.js` (Monitor), `xterm.js` (Terminal), `marked.js` (Markdown rendering for READMEs).
    *   **Communication**: `BroadcastChannel` (Inter-tab sync), WebSockets (Terminal/Monitor), HTTP API.

---

### SECTION 2: FILE STRUCTURE

📁 holaf_image_viewer_backend/
  > Core backend logic & Route Facade.
  📄 __init__.py : **Crucial**. Exposes all routes from submodules to the main application.
  📁 routes/
    > API Route Handlers (Modularized).
    📄 edit_routes.py : Handles `.edt` sidecars, video processing/rollback.
    📄 export_routes.py : Export queue preparation, transcoding, metadata embedding.
    📄 file_ops_routes.py : Delete (Trashcan), Restore, Permanent Delete.
    📄 image_routes.py : Listing (advanced filtering), Filter options.
    📄 metadata_routes.py : Extract/Inject metadata, Get info.
    📄 thumbnail_routes.py : Thumbnail generation (Regen/Stats), Prioritization.
    📄 utility_routes.py : Maintenance tasks (DB Sync), **Node Manager Facade** (Install/Search routes).
  📁 bin/
    > Managed external binaries (RIFE).
  📄 dependency_manager.py : Auto-installer for RIFE ncnn Vulkan.
  📄 logic.py : Core business logic. Image/Video metadata extraction, FFmpeg/RIFE pipeline, DB sync logic.
  📄 worker.py : Background threads: `watchdog` (Filesystem Events) & Thumbnail Generator.

📁 js/
  > Frontend modules.
  📁 css/ : Modular CSS files (Theming, Panels, specific components).
  📁 image_viewer/
    📄 image_viewer_gallery.js : Virtualized scrolling grid, LRU Cache for thumbnails, Network cancellation.
    📄 image_viewer_editor.js : Non-destructive editor UI, Video preview pipeline.
    📄 image_viewer_state.js : Centralized Pub/Sub state management.
    📄 image_viewer_ui.js : Main UI layout, Filter controls.
  📁 model_manager/ : UI for Model Manager (Upload/Download/Scan).
  📁 nodes/ : UI for Custom Nodes Manager.
    📄 holaf_nodes_manager.js : UI Logic. GitHub Search integration, Markdown rendering, Install/Update actions.
  📁 profiler/ : UI for Workflow Profiler (Standalone view).
  📄 holaf_main.js : Entry point. Static menu registration, Global modal/toast managers.
  📄 holaf_comfy_bridge.js : Cross-tab communication (`BroadcastChannel`).
  📄 holaf_panel_manager.js : Window management (Floating/Dialogs).
  📄 holaf_settings_manager.js : Global settings UI.
  📄 holaf_terminal.js : xterm.js integration (WebSocket).
  📄 holaf_monitor.js : System Monitor overlay (WebSocket, Chart.js).

📁 nodes/
  > ComfyUI Custom Nodes (Python).
  📄 holaf_model_manager.py : Backend logic for Model scanning/hashing.
  📄 holaf_nodes_manager.py : Backend logic for nodes. Git operations, `aiohttp` GitHub Search, `pip` requirements install.

📄 __init__.py : Main extension entry. Registers routes, initializes DBs, starts background workers.
📄 holaf_config.py : `config.ini` manager.
📄 holaf_database.py : Main SQLite manager (`holaf_utilities.sqlite`).
📄 holaf_profiler_database.py : Profiler SQLite manager (`holaf_profiler.db`).
📄 holaf_profiler_engine.py : Profiling logic (Hooks + Polling).
📄 holaf_user_data_manager.py : Path management (`ComfyUI/user/...`).
📄 holaf_utils.py : Shared utilities (Hashing, Chunking).

---

### SECTION 3: KEY CONCEPTS & LOGIC

#### 1. Image Viewer Architecture
*   **Data Source:** SQLite Database (`images` table) synchronized with filesystem via `watchdog` (real-time) and periodic full scans.
*   **Thumbnails:** Generated on-demand via background worker. Prioritized queue. Stored in `.cache/thumbnails`. Served via HTTP.
*   **Non-Destructive Editing:** Edits stored in `.edt` JSON sidecars in `edit/` subfolder.
*   **Video Handling:** Preview generated as `_proc.mp4` (FFmpeg/RIFE).

#### 2. Workflow Profiler
*   **Philosophy:** "Measure on Demand". Explicit start/stop.
*   **Storage:** `holaf_profiler.db`.
*   **Mechanism:** Hooks into ComfyUI execution + High-frequency polling (50ms).

#### 3. Terminal & Security
*   **Access:** Secured by hashed password.
*   **Transport:** WebSocket transmitting raw PTY data.

#### 4. Model & Node Management
*   **Models:** Scans standard ComfyUI paths. Uploads via chunked HTTP. Deep Scan (SHA256).
*   **Nodes Architecture:**
    *   **Backend (`holaf_nodes_manager.py`)**: Executes system commands (`git`, `pip`).
    *   **GitHub Integration**: Uses `aiohttp` to search repositories and fetch raw READMEs directly from GitHub.
    *   **Installation**:
        *   **Git Clone**: For URLs ending in `.git` or detected as repositories.
        *   **Manual**: Search allows discovering nodes not yet installed.
    *   **Updates**: 
        *   *Standard*: `git pull` for tracked repos.
        *   *Hybrid*: For manually installed nodes converted to Git, performs backup -> clone -> restore untracked files.

---

### SECTION 4: DATABASE SCHEMAS

#### Main DB (`holaf_utilities.sqlite`)
*   **`images`**: Stores metadata for all output images.
    *   Cols: `id`, `path_canon` (Unique), `mtime`, `size_bytes`, `width`, `height`, `format`, `prompt_text`, `workflow_json`, `thumbnail_status` (0=Pending, 1=Queued, 2=Ready, 3=Error), `is_trashed`, `thumb_hash`, `has_edit_file`, `has_workflow` (bool), `has_prompt` (bool), `has_tags` (bool).
    *   **Optimization:** Composite Indexes for Gallery & Timeline queries.
*   **`tags`** & **`imagetags`**: Many-to-many relationship for image tagging.
*   **`models`**: Stores scanned model info.
    *   Cols: `path_canon`, `type`, `family`, `sha256`, `metadata_json`.

#### Profiler DB (`holaf_profiler.db`)
*   **`profiler_runs`**: `id`, `timestamp`, `name`, `total_time`.
*   **`profiler_steps`**: Per-node execution data.
    *   Cols: `run_id`, `node_id`, `vram_max`, `exec_time`, `gpu_load_max`, `inputs_json`.

---

### PROJECT STATE

*   **[Stable] Image Viewer**: Full virtualization, Watchdog integration, Editing pipeline.
*   **[Stable] Terminal**: Secure PTY access.
*   **[Stable] Node Manager**: Full CRUD, Git integration, GitHub Search & Install via URL fully functional.
*   **[Stable] Model Manager**: Scan, Upload, Hash, Search.
*   **[Beta] Profiler**: Core engine and DB ready. UI basics implemented.
*   **[New] System Monitor**: Turbo mode, Persistence, Multi-GPU support.

**Current Focus**: Stability, Batch operations performance, and refining the Profiler UX.