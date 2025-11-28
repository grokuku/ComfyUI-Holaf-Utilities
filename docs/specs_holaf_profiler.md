# HOLAF WORKFLOW PROFILER - TECHNICAL SPECIFICATIONS

## 1. VISION & OBJECTIVE
**Purpose:** A dedicated benchmarking and optimization tool for ComfyUI workflows.
**Goal:** Measure granular performance metrics per node (VRAM, RAM, GPU, Time) to identify bottlenecks and optimize resource usage.
**Philosophy:** "Measure on Demand." The tool does not run in the background; it is triggered explicitly by the user to profile specific runs.

---

## 2. ARCHITECTURE & LOCATION

### 2.1 Interface
- **Type:** Standalone Window (SPA).
- **Access:** Similar to the Image Viewer (New Tab).
- **Communication:**
  - **HTTP API:** For fetching historical data and saving configurations.
  - **WebSocket / BroadcastChannel:** For triggering runs and receiving real-time progress from the main ComfyUI tab.

### 2.2 Storage (New Standard)
- **Root Path:** `ComfyUI/user/[user]/ComfyUI-Holaf-Utilities/profiler/`
  - *Note:* `[user]` defaults to `default` but respects ComfyUI multi-user structure if available.
- **Database:** `holaf_profiler.db` (SQLite). Dedicated file to separate performance data from image metadata.
- **Config:** `profiler_settings.json` (for UI preferences like column visibility).

---

## 3. CORE FEATURES

### 3.1 The "Update & Run" Logic (Safety First)
To ensure data integrity between the visual workflow and the recorded data:
1.  **"Update Nodes" Action:** User manually clicks this. Backend parses the current workflow and stores a "Reference Snapshot" (Node IDs, Titles, Connections).
2.  **"Run Profile" Action:**
    - Checks if the current ComfyUI workflow matches the "Reference Snapshot".
    - **Match:** Profiling starts.
    - **Mismatch:** Warning displayed ("Workflow changed. Please Update Nodes.").
    - **Force Run:** Option to run anyway (user accepts risk of desync data).

### 3.2 Metrics (Per Node)
- **VRAM Start:** Memory usage at `on_node_start`.
- **VRAM Max:** Peak memory usage during execution.
- **VRAM End:** Memory usage at `on_node_end` (Residual).
- **Execution Time:** Precise duration in ms.
- **CPU Peak:** Max CPU usage %.
- **GPU Load:** Max & Average Core Load %.
- **Parameters:** Snapshot of node inputs/widgets at runtime.

### 3.3 Grouping System (Flexible)
- **Entity:** Groups are independent entities (stored in DB).
- **Association:** M:N (Many-to-Many). One node can belong to multiple groups.
- **Persistence:** Based on **Node ID** (stable unless node is deleted).
- **Editing:** Can be edited before a run (preparation) or after a run (analysis).

---

## 4. DATABASE SCHEMA (`holaf_profiler.db`)

### Table: `profiler_runs`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER PK | Auto-inc. |
| `timestamp` | DATETIME | Run date. |
| `name` | TEXT | User defined name (optional). |
| `workflow_hash` | TEXT | Hash to verify consistency. |
| `global_comment` | TEXT | User notes for the whole run. |
| `total_time` | REAL | Total execution time. |

### Table: `profiler_steps`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER PK | Auto-inc. |
| `run_id` | INTEGER FK | Link to run. |
| `node_id` | INTEGER | ComfyUI Node ID. |
| `node_title` | TEXT | Display name. |
| `node_type` | TEXT | Class type. |
| `vram_start` | INTEGER | Bytes. |
| `vram_max` | INTEGER | Bytes. |
| `vram_end` | INTEGER | Bytes. |
| `exec_time` | REAL | Seconds. |
| `cpu_max` | REAL | Percentage. |
| `gpu_load_max` | REAL | Percentage. |
| `gpu_load_avg` | REAL | Percentage. |
| `inputs_json` | TEXT | JSON snapshot of parameters. |
| `step_comment` | TEXT | Specific note for this step. |

### Table: `profiler_groups`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER PK | Auto-inc. |
| `name` | TEXT | Group Label. |
| `color` | TEXT | Hex Code. |
| `description` | TEXT | Optional. |

### Table: `profiler_group_members`
| Column | Type | Description |
| :--- | :--- | :--- |
| `group_id` | INTEGER FK | |
| `node_id` | TEXT | The target node ID. |

---

## 5. TECHNICAL STACK & DEPENDENCIES

### 5.1 Backend (Python)
- **`pynvml`**: Mandatory for high-frequency NVIDIA GPU polling (lighter/faster than `nvidia-smi` CLI).
- **Threading**: A dedicated "Monitor Thread" spawns during execution to poll hardware stats every X ms (target: 50-100ms) without blocking the ComfyUI execution loop.

### 5.2 Frontend (JS)
- **Vanilla JS + ES Modules**.
- **BroadcastChannel**: To trigger execution in the main tab from the Profiler window.
- **Chart.js** (Optional): For potential visual graphs later.

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: Infrastructure (The Foundation) [DONE]
- [x] Implement `holaf_user_data_manager.py` to handle `ComfyUI/user/[user]/ComfyUI-Holaf-Utilities/profiler/`.
- [x] Check/Install `pynvml` dependency.
- [x] Create `holaf_profiler_database.py` with the new schema.

### Phase 2: The Engine (Backend Logic) [IN PROGRESS]
- [ ] Implement `ProfilerEngine` class.
- [ ] Create hooks for `on_node_start` / `on_node_end`.
- [ ] Implement the polling loop using `pynvml`.
- [ ] Create the logic to snapshot node parameters.

### Phase 3: Communication & API
- [ ] Create routes: `/holaf/profiler/runs`, `/holaf/profiler/groups`, `/holaf/profiler/update_nodes`.
- [ ] Implement the Hash/Validation logic (Update vs Run).

### Phase 4: Frontend - Core UI
- [ ] Create the Standalone HTML shell.
- [ ] Build the Main Table (Columns, Filters).
- [ ] Implement the "Update Nodes" button & JSON parsing.
- [ ] Implement the "Run" button & Bridge communication.

### Phase 5: Advanced Features
- [ ] Group Management UI.
- [ ] Commenting system (Runs & Steps).
- [ ] Historical Comparison view.