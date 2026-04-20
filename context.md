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
      *   `torch` (Used for active GPU device detection).
      *   `wave` (Native Python module used for zero-dependency audio extraction).
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
    📄 logic.py : Core business logic (FFmpeg/RIFE pipeline, DB sync).
    📄 worker.py : Background threads (Watchdog, Thumbnails).

  📁 js/
    📄 holaf_api_compat.js : ComfyUI API compatibility layer. Provides `app` and `api` exports via `window.comfyAPI.app.app` / `window.comfyAPI.api.api` (new frontend >= v1.42) with Proxy fallback + legacy dynamic import fallback.
    📄 holaf_comfy_bridge.js : `BroadcastChannel` wrapper for cross-tab communication.
    📄 holaf_panel_manager.js : Generic floating panel manager (create, drag, resize, fullscreen toggle, z-index stacking via `bringToFront`/`unregister`).
    📁 css/ : Modular CSS files (themes, panels, layout tools, profiler).
    *   **BUG FIX (Critical)**: `holaf_image_viewer.css` had an unscoped `.holaf-utility-panel` rule that overrode `position: fixed`, `z-index`, etc. from `holaf_shared_panel.css`. Scoped to `body.holaf-standalone-mode .holaf-utility-panel:not(.holaf-floating-window)` to only target standalone dialogs.
    📁 image_viewer/ : Gallery, Editor, State, UI logic.
    📁 profiler/
      📄 holaf_profiler.js : UI Logic. State-driven table rendering, Smart Filters (Non-Executed), Sorting, Metrics display.
      📄 holaf_profiler_listener.js : Main tab logic. Calculates Group geometry using Live Graph, syncs context via API, Bridge, and LocalStorage.
    📄 holaf_main.js : Core extension entry. Handles Menu registration (Static Dropdown) and Compact Menu Mode logic.
    📄 holaf_layout_tools.js : Floating toolbar, Mouse coordinates, Graph recentering.
    📄 holaf_monitor.js : System Monitor overlay with Chart.js.
    📄 holaf_shortcuts.js : Viewport Bookmarks (Pan/Zoom) with Nested Subgraph Navigation.
    📄 holaf_settings_manager.js : Global settings UI.
    📄 holaf_remote_comparer.js : Floating UI for side-by-side Universal Media comparison (Audio/Video/Image, Crossfader, Global Settings).

  📁 nodes/
    📄 holaf_model_manager.py : Backend logic for Model scanning/hashing.
    📄 holaf_nodes_manager.py : Backend logic for nodes (Git/Pip operations).
    📄 holaf_remote_comparer.py : Universal Passthrough node (`AnyType`). Features file passthrough, native Audio `.wav` extraction, and FFmpeg optimization. Returns isolated `holaf_payload`.

  📄 holaf_profiler_engine.py : Measurement logic. Handles Execution Hooks and Robust GPU detection (Logical vs Physical mapping).
  📄 holaf_profiler_database.py : SQLite manager specific to Profiler data.
  📄 holaf_database.py : Main SQLite manager (Images/General).
  📄 __init__.py : Main entry point. Contains API Routes, MIME type fixes, and Execution Hooks.

  ---

  ### SECTION 3: KEY CONCEPTS & LOGIC

  #### 1. Universal UI Position Strategy ("Ghost Position")
  *   **Logic**: Applied to `System Monitor`, `Layout Tools`, `Shortcuts` and `Remote Comparer`.
  *   **Persistence**: Stores an "ideal" reference position (`right`, `bottom`, `width`, `height`) in `localStorage`.
  *   **Visual Clamping**: On window resize, tools are visually pushed to stay within the viewport bounds.

  #### 1b. Z-Index Stacking (Bring to Front)
  *   **Centralized in `HolafPanelManager`**: `bringToFront(panelEl)` and `unregister(panelEl)` are exposed for all Holaf windows.
  *   **`createPanel` panels**: Auto-registered with `mousedown` capture listener that calls `bringToFront`.
  *   **Custom windows** (Monitor, Shortcuts, Layout Tools): Call `bringToFront` on their own `mousedown` / drag start. Call `unregister` on hide.
  *   **Logic**: Compares z-index of all tracked panels; only bumps if clicked panel is not already on top. Handles `NaN` (panels without inline z-index) correctly via `isNaN()` check. Prevents unbounded z-index growth.
  *   **Track all**: `openPanels` Set now tracks ANY element passed to `bringToFront`, not just `createPanel` panels.
  *   **BUG FIX (Critical)**: The `bringToFront` refactored in "debug auto GLM" commit lost the `isNaN()` guard. `parseInt('')` → `NaN`, `NaN < maxZ` → `false`, so new panels never received a z-index. Fixed by adding `isNaN(currentZ) ||` to the condition.

  #### 2. Layout Tools (Workflow Management)
  *   **Coordinates**: Real-time display following `app.canvas.graph_mouse`.
  *   **Recentering Logic**: Bounding Box calculation for nodes, groups, and Subgraphs.

  #### 3. System Monitor
  *   **Turbo Mode**: High-frequency polling (250ms) during workflow execution.
  *   **Multi-GPU**: Dynamic detection and legend generation with VRAM/Load stats.

  #### 4. Workflow Profiler (Architecture)
  *   **Robust GPU Detection**: The engine identifies the active PyTorch device and maps its Logical Index to the NVML Physical Index.
  *   **Smart Sync Strategy (Groups)**: Group association is calculated in the `Listener` (Main Tab) using Live Graph geometry.
  *   **State-Driven UI**: The Profiler table is rendered from a local `nodesMap` state.

  #### 5. Shortcuts (Viewport Bookmarks & Navigation)
  *   **Dual Persistence**: `localStorage` (Window State) and `app.graph.extra.holaf_shortcuts` (Workflow Data).
  *   **Nested Subgraph Navigation**: Recursive path detection (`findPathToGraph`) and stable switching via `app.canvas.setGraph`.

  #### 6. Interface Persistence & Menu Sync
  *   **Visibility State**: Tool visibility (`isVisible`/`isOpen`) is saved in `localStorage` and auto-restored.
  *   **Interactive Menu**: Dropdown menu features visual checkmarks (✓) updated dynamically for all toggleable floating tools.

  #### 7. Compact Menu Strategy
    *   **Goal**: Merges the Tab Bar (Top) and the Action Bar (Menu) into a single row to save vertical space.
    *   **Architecture (Pure CSS)**: Abandons physical DOM manipulation (no wrappers or comment placeholders) to maintain strict compatibility with ComfyUI's dynamic layout engine (e.g., right-side Property Panel).
    *   **Logic**: Injects a dynamic CSS `<style>` block. Toggling the mode applies `holaf-compact-active` to the `body` and `holaf-compact-parent` to the original menu container. The action bar is shifted via `position: absolute`, ensuring zero risk of UI disappearance upon restoration.

  #### 8. Universal Remote Comparer (Media Split, Crossfader & Settings API)
  *   **Universal Backend Logic**: Uses `AnyType (*)` inputs. Smart object/dict probing enables zero-copy passthrough for existing media files. Raw image/video tensors are encoded via FFmpeg; audio tensors use Python's native `wave` module. Outputs an isolated `holaf_payload` key to prevent UI cross-pollution with native ComfyUI image nodes.
  *   **Global Settings Bridge**: The UI exposes a configuration panel (resolutions, speeds). Settings are saved in `localStorage` and sent via an API endpoint (`/holaf/comparer/settings`) to dictate backend compression rules globally across all nodes.
  *   **Audio/Video Engine**: Native Canvas Zoom/Pan handles visual media split. For audio, mouse X position drives a 100% Center Crossfader (isolating A or B at edges). Renders a dynamic Audio HUD independent of canvas scaling/clipping.
  *   **Pop-out Architecture**: Moves the live canvas DOM element into a newly spawned browser window (`window.open`) to support multi-monitor setups. State (zoom/pan) is preserved during the transition.

  ---

  ### SECTION 4: DATABASE SCHEMAS

  #### Main DB (`holaf_utilities.sqlite`)
  *   **`images`**: Metadata, paths, tags, edit status.
  *   **`models`**: Scanned model info (SHA256).

  #### Profiler DB (`holaf_profiler.db`)
  *   **`profiler_runs`**: Execution summaries (ID, Timestamp, Name, Workflow Hash).
  *   **`profiler_steps`**: Detailed per-node stats.
  *   **`profiler_groups`**: (Prepared) Structure for grouping nodes.
  *   **`profiler_group_members`**: (Prepared) Link table for groups.

  ---

  ### PROJECT STATE

  *   **[Stable] Image Viewer, Terminal, Node Manager, Model Manager**.
    *   **Bug Audit (23 bugs)**: 4 critical, 6 important, 7 moderate, 6 minor — all fixed.
    *   **Critical fixes**: `bringToFront` z-index NaN bug, CSS `.holaf-utility-panel` override breaking `position: fixed`, import ordering in `holaf_image_viewer.js`, `holaf_utils.get_thumbnail_dir()` → `holaf_utils.THUMBNAIL_CACHE_DIR`, profiler URL mismatch, NaN/Inf JSON sanitization, missing `holaf_nodes_manager` guard.
    *   **Important fixes**: `os.path.commonprefix` → `commonpath`, negative panel position rejection, `delete_models_from_db_and_disk` implemented, `POST /holaf/profiler/run-stop` route added, `_video_processing_locks` cleanup, `asyncio.get_event_loop()` → `get_running_loop()`, subprocess timeouts, lazy `ensure_trashcan_exists()`, permanent delete of trashed items, `workflow_sources: []` in initial filter state.
    *   **Moderate fixes**: Thread-local DB connections for ProfilerDatabase, remote comparer timeout, `SESSION_TOKENS_LOCK` threading lock, improved `_get_db_connection()` with PRAGMA, removed dead `_process_model_item`.
    *   **Cleanup**: Deleted all `__pycache__/` dirs and `.pyc` files, added `PYTHONDONTWRITEBYTECODE=1` to `__init__.py`, created `.gitignore`.
  *   **[Stable] System Monitor**: Multi-GPU, Turbo Mode, Persistence.
  *   **[Stable] Layout Tools**: Coordinates, Recentering, Persistence.
  *   **[Stable] Shortcuts**: Nested Subgraph support, Viewport Bookmarks, Graph-embedded data, Ghost Position.
  *   **[Stable] Main Menu**: Dynamic checkmarks, State synchronization, Compact Mode.
  *   **[Stable] Profiler**: Backend Engine (Robust), UI (Advanced), Subgraph Support (Active).
  *   **[Stable] Universal Remote Comparer**: Images/Video/Audio, Crossfader, Global Settings API, Isolated Payload, HUD, Multi-monitor Pop-out.

  **Next Priority**: Enhance Profiler visual analytics or History Navigation.

  ---

  ### SECTION 5: FRONTEND COMPATIBILITY (ComfyUI v0.19.3+ / Frontend v1.42.11+)

  *   **Breaking Change**: ComfyUI frontend migrated to Vue.js/Vite bundled app. Legacy imports from `/scripts/app.js` and `/scripts/api.js` are deprecated.
  *   **New Public API**: `window.comfyAPI` exposed by Vite plugin `comfyAPIPlugin`. Structure: `window.comfyAPI.{module}.{export}` (e.g. `window.comfyAPI.app.app` = ComfyApp instance).
  *   **`holaf_api_compat.js`**: Central compatibility shim. All Holaf JS files import `{ app, api }` from it instead of legacy paths.
      *   Priority: `window.comfyAPI.app.app` → `window.app` → legacy dynamic import fallback.
      *   Proxy objects ensure `registerExtension()` works even if app loads async.
  *   **Import Path Convention**: Files in `js/` root use `./holaf_api_compat.js`. Files in subdirs (`profiler/`, `image_viewer/`) use `../holaf_api_compat.js`.
  *   **WEB_DIRECTORY = "js"**: Maps `js/` contents to `/extensions/ComfyUI-Holaf-Utilities/` URL. Relative import `../X` from a file at this URL resolves to `/extensions/X` (WRONG), must use `./X`.