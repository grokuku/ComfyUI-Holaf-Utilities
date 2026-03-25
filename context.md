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
    📄 holaf_comfy_bridge.js : `BroadcastChannel` wrapper for cross-tab communication.
    📁 css/ : Modular CSS files (themes, panels, layout tools, profiler).
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
  *   **[Stable] System Monitor**: Multi-GPU, Turbo Mode, Persistence.
  *   **[Stable] Layout Tools**: Coordinates, Recentering, Persistence.
  *   **[Stable] Shortcuts**: Nested Subgraph support, Viewport Bookmarks, Graph-embedded data, Ghost Position.
  *   **[Stable] Main Menu**: Dynamic checkmarks, State synchronization, Compact Mode.
  *   **[Stable] Profiler**: Backend Engine (Robust), UI (Advanced), Subgraph Support (Active).
  *   **[Stable] Universal Remote Comparer**: Images/Video/Audio, Crossfader, Global Settings API, Isolated Payload, HUD, Multi-monitor Pop-out.

  **Next Priority**: Enhance Profiler visual analytics or History Navigation.