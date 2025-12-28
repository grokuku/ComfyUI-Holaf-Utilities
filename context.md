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
  📄 logic.py : Core business logic (FFmpeg/RIFE pipeline, DB sync).
  📄 worker.py : Background threads (Watchdog, Thumbnails).

📁 js/
  📄 holaf_comfy_bridge.js : `BroadcastChannel` wrapper for cross-tab communication.
  📁 css/ : Modular CSS files (themes, panels, layout tools, profiler).
  📁 image_viewer/ : Gallery, Editor, State, UI logic.
  📁 profiler/
    📄 holaf_profiler.js : UI Logic. State-driven table rendering, Filters, Sorting, Metrics display.
    📄 holaf_profiler_listener.js : Main tab logic. Calculates Group geometry, syncs context via API & LocalStorage.
  📄 holaf_main.js : Core extension entry and menu registration.
  📄 holaf_layout_tools.js : Floating toolbar, Mouse coordinates, Graph recentering.
  📄 holaf_monitor.js : System Monitor overlay with Chart.js.
  📄 holaf_settings_manager.js : Global settings UI.

📁 nodes/
  📄 holaf_model_manager.py : Backend logic for Model scanning/hashing.
  📄 holaf_nodes_manager.py : Backend logic for nodes (Git/Pip operations).

📄 holaf_profiler_engine.py : Measurement logic (Hooks execution, monitors VRAM/Time).
📄 holaf_profiler_database.py : SQLite manager specific to Profiler data.
📄 holaf_database.py : Main SQLite manager (Images/General).
📄 __init__.py : Main entry point. Contains API Routes, MIME type fixes, and Execution Hooks.

---

### SECTION 3: KEY CONCEPTS & LOGIC

#### 1. Universal UI Position Strategy ("Ghost Position")
*   **Logic**: Applied to `System Monitor` and `Layout Tools`. 
*   **Persistence**: Stores an "ideal" reference position (`right`, `bottom`, `width`, `height`) in `localStorage`.
*   **Visual Clamping**: On window resize, tools are visually pushed to stay within the viewport bounds.

#### 2. Layout Tools (Workflow Management)
*   **Coordinates**: Real-time display following `app.canvas.graph_mouse`.
*   **Recentering Logic**: Bounding Box calculation for nodes, groups, and Subgraphs.

#### 3. System Monitor
*   **Turbo Mode**: High-frequency polling (250ms) during workflow execution.
*   **Multi-GPU**: Dynamic detection and legend generation with VRAM/Load stats.

#### 4. Workflow Profiler (Architecture)
*   **Backend Hooks**: Monkey-patches `server.PromptServer` to detect start/end times and VRAM usage.
*   **Smart Sync Strategy (Groups)**: Group association is calculated in the `Listener` (Main Tab) using Live Graph geometry. This mapping is transmitted to the Profiler UI via `localStorage` (primary buffer) and `BroadcastChannel`, ensuring data persists even if the backend strips custom JSON fields.
*   **State-Driven UI**: The Profiler table is rendered from a local `nodesMap` state. This allows:
    *   **Dynamic Sorting**: Sort by ID, Name, Group, Time, VRAM, or Execution Order.
    *   **Smart Filters**: Hide Disabled nodes, Exclude by Type string, and "Smart Min Time" (hides fast nodes only if they have finished executing).
    *   **Subgraph Logic**: Detects composite IDs (`ParentID:SubID`) to display "Parent Name > Subnode".
    *   **Runtime Ordering**: Tracks execution sequence (1, 2, 3...) in real-time.

#### 5. Interface Persistence & Menu Sync
*   **Visibility State**: Tool visibility (`isVisible`) is saved in `localStorage`. Tools auto-restore their state on page reload.
*   **Interactive Menu**: The dropdown menu features visual checkmarks (✓) for toggleable tools.
*   **State Sync**: The menu UI updates dynamically when a tool is toggled or when the menu is opened.

---

### SECTION 4: DATABASE SCHEMAS

#### Main DB (`holaf_utilities.sqlite`)
*   **`images`**: Metadata, paths, tags, edit status.
*   **`models`**: Scanned model info (SHA256).

#### Profiler DB (`holaf_profiler.db`)
*   **`profiler_runs`**: Execution summaries (ID, Timestamp, Name, Workflow Hash).
*   **`profiler_steps`**: Detailed per-node stats (Node ID, Type, VRAM Start/Max/End, Exec Time, GPU Load).
*   **`profiler_groups`**: (Prepared) Structure for grouping nodes.
*   **`profiler_group_members`**: (Prepared) Link table for groups.

---

### PROJECT STATE

*   **[Stable] Image Viewer, Terminal, Node Manager, Model Manager**.
*   **[Stable] System Monitor**: Multi-GPU, Turbo Mode, Persistence.
*   **[Stable] Layout Tools**: Coordinates, Recentering, Persistence.
*   **[Stable] Main Menu**: Dynamic checkmarks, State synchronization.
*   **[Stable] Profiler**: 
    *   Backend Hooks & Engine: **Active**.
    *   UI: **Advanced** (Real-time charts, Group detection via LocalStorage, Sorting, Smart Filtering, Runtime Ordering).
    *   Subgraph Support: **Active** (Parent resolution).

**Next Priority**: Enhance Profiler visual analytics (Charts.js integration for visual timeline) or History Navigation.