import time
import threading
import psutil
import logging
import json
import os
import torch  # Required for GPU detection

try:
    import pynvml
    PYNVML_AVAILABLE = True
except ImportError:
    PYNVML_AVAILABLE = False

from .holaf_profiler_database import ProfilerDatabase

class ProfilerEngine:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ProfilerEngine, cls).__new__(cls)
            cls._instance.init_engine()
        return cls._instance

    def init_engine(self):
        self.db = ProfilerDatabase()
        self.active_run_id = None
        self.is_profiling = False
        self.run_start_time = 0
        self._last_workflow_json = None
        
        # Context Mapping (ID -> Node Data)
        self.node_lookup_map = {}

        # Subgraph Definitions Map (subgraph id -> definition dict)
        self._subgraph_defs = {} 
        
        # Current Step Context
        self.current_node_id = None
        self.current_node_title = ""
        self.current_node_type = ""
        self.current_inputs = None
        
        self.current_node_start_time = 0
        self.current_node_vram_start = 0
        
        # Volatile Stats
        self.stat_vram_max = 0
        self.stat_gpu_load_max = 0
        self.stat_gpu_load_sum = 0
        self.stat_gpu_sample_count = 0
        self.stat_cpu_max = 0

        # Hardware Handle
        self.gpu_handle = None
        
        if PYNVML_AVAILABLE:
            try:
                pynvml.nvmlInit()
                
                # --- HOLAF DEBUG: ROBUST GPU DETECTION ---
                print("\n[Holaf Profiler] --- GPU DETECTION DIAGNOSTIC ---")
                
                # 1. Get Torch Logic Index
                torch_index = 0
                if torch.cuda.is_available():
                    torch_index = torch.cuda.current_device()
                
                print(f"[Holaf Profiler] PyTorch Current Device Index: {torch_index}")

                # 2. Check Environment Remapping (CUDA_VISIBLE_DEVICES)
                visible_devices = os.environ.get("CUDA_VISIBLE_DEVICES")
                physical_index = torch_index # Default fallback

                if visible_devices:
                    print(f"[Holaf Profiler] CUDA_VISIBLE_DEVICES set to: '{visible_devices}'")
                    # Parse "0,1" or "1" etc.
                    device_list = [x.strip() for x in visible_devices.split(',') if x.strip()]
                    
                    if torch_index < len(device_list):
                        try:
                            physical_index = int(device_list[torch_index])
                            print(f"[Holaf Profiler] Remapped Logical GPU {torch_index} -> Physical GPU {physical_index}")
                        except ValueError:
                            print("[Holaf Profiler] Error parsing CUDA_VISIBLE_DEVICES list.")
                    else:
                        print(f"[Holaf Profiler] Warning: Torch index {torch_index} out of bounds for visible devices list.")
                else:
                    print("[Holaf Profiler] No CUDA_VISIBLE_DEVICES set. Assuming direct mapping.")

                # 3. Init NVML with Physical Index
                try:
                    handle = pynvml.nvmlDeviceGetHandleByIndex(physical_index)
                    gpu_name = pynvml.nvmlDeviceGetName(handle)
                    # Decode bytes if necessary (older pynvml returns bytes)
                    if isinstance(gpu_name, bytes):
                        gpu_name = gpu_name.decode('utf-8')
                        
                    print(f"[Holaf Profiler] Monitoring NVML Device {physical_index}: {gpu_name}")
                    self.gpu_handle = handle
                except Exception as e:
                    print(f"[Holaf Profiler] Failed to get handle for index {physical_index}: {e}")
                    # Fallback to 0 if mapping failed
                    if physical_index != 0:
                        print("[Holaf Profiler] Attempting fallback to index 0...")
                        self.gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(0)

                print("[Holaf Profiler] -----------------------------------\n")
                # ---------------------------------------------------------

            except Exception as e:
                print(f"[Holaf Profiler] Failed to init pynvml: {e}")
                self.gpu_handle = None

        self.monitor_thread = None

    def load_workflow_context(self, workflow_data):
        # Reset both the node map and the subgraph definitions map
        self.node_lookup_map = {}
        self._subgraph_defs = {}

        # Build a flat map of ALL subgraph definitions (id -> definition dict)
        if isinstance(workflow_data, dict):
            definitions = workflow_data.get("definitions", {}) or {}
            subgraphs = definitions.get("subgraphs", []) or []
            for subgraph in subgraphs:
                if isinstance(subgraph, dict) and subgraph.get("id"):
                    self._subgraph_defs[str(subgraph["id"])] = subgraph

        # Store the raw workflow JSON for later persistence with the run
        try:
            self._last_workflow_json = json.dumps(workflow_data)
        except Exception as e:
            print(f"[Holaf Profiler] Failed to serialize workflow_data: {e}")
            self._last_workflow_json = None

        nodes = workflow_data.get("nodes", []) if isinstance(workflow_data, dict) else []
        for n in nodes:
            self._register_node(n, parent_id_prefix="")

    def _register_node(self, node, parent_id_prefix=""):
        """Recursively register a node and its subgraph children."""
        raw_id = str(node.get("id"))
        full_id = f"{parent_id_prefix}{raw_id}" if parent_id_prefix else raw_id
        node_type = node.get("type", "Unknown")

        # Determine a friendly title: use the subgraph definition's name for
        # subgraph instance nodes (their type is the definition's UUID), else
        # fall back to the node's own title or type.
        subgraph_def = self._subgraph_defs.get(node_type) if node_type else None
        if subgraph_def is not None:
            title = subgraph_def.get("name") or node.get("title") or node_type
        else:
            title = node.get("title", node_type)

        self.node_lookup_map[full_id] = {
            "id": full_id,
            "title": title,
            "type": node_type,
            "inputs": node.get("widgets_values", []),
            "is_subgraph_node": bool(parent_id_prefix),
        }

        # Recurse into subgraph children if the node type is a subgraph
        # definition ID (ComfyUI latest format). Nested subgraphs are handled
        # naturally: internal nodes can themselves be subgraph instances.
        if subgraph_def is not None:
            child_nodes = subgraph_def.get("nodes", []) or []
            for child in child_nodes:
                self._register_node(child, parent_id_prefix=f"{full_id}:")

        # Backward compatibility: older ComfyUI formats may embed the subgraph
        # directly on the node via a "subgraph" or "subgraph_data" key.
        subgraph = node.get("subgraph") or node.get("subgraph_data")
        if subgraph and isinstance(subgraph, dict):
            sub_nodes = subgraph.get("nodes", []) or []
            for sn in sub_nodes:
                self._register_node(sn, parent_id_prefix=f"{full_id}:")

    def get_context_for_frontend(self):
        nodes = list(self.node_lookup_map.values())
        def _sort_key(x):
            # Handle ':'-containing IDs by using the leaf ID for sorting
            leaf = x['id'].split(':')[-1]
            try:
                return (0, int(leaf))
            except (ValueError, TypeError):
                return (1, str(leaf))
        nodes.sort(key=_sort_key)
        return nodes

    def start_run(self, name=None, workflow_hash=None, global_comment=""):
        try:
            self.run_start_time = time.perf_counter()
            self.active_run_id = self.db.create_run(name, workflow_hash, global_comment)
            self.is_profiling = True

            # Persist the last loaded workflow JSON if available
            if self._last_workflow_json is not None:
                try:
                    self.db.save_workflow_json(self.active_run_id, self._last_workflow_json)
                except Exception as e:
                    print(f"[Holaf Profiler] Error saving workflow_json: {e}")

            # FIX: Always create a fresh monitor thread for each run.
            # The old code checked `self.monitor_thread.is_alive()`, which meant a
            # rapid stop_run() → start_run() cycle would reuse the old thread,
            # causing stale stats from the previous run to bleed into the new one.
            self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
            self.monitor_thread.start()

            return self.active_run_id
        except Exception as e:
            print(f"[Holaf Profiler] Error starting run: {e}")
            return None

    def stop_run(self):
        # Finalize the current node if still active
        if self.is_profiling and self.current_node_id is not None:
            try:
                self.on_node_end()
            except Exception as e:
                print(f"[Holaf Profiler] Error finalizing node on stop: {e}")

        # Persist run total time and node count
        if self.active_run_id is not None:
            try:
                total_time = time.perf_counter() - self.run_start_time if self.run_start_time else 0.0
                node_count = len(self.node_lookup_map)
                self.db.finalize_run(self.active_run_id, total_time, node_count)
            except Exception as e:
                print(f"[Holaf Profiler] Error finalizing run: {e}")

        # FIX: Set is_profiling = False first so the monitor loop exits cleanly.
        self.is_profiling = False
        self.active_run_id = None
        self.current_node_id = None
        self.run_start_time = 0

        # FIX: Wait briefly for the monitor thread to exit to avoid a
        # race condition where a rapid start_run() creates a duplicate thread.
        if self.monitor_thread is not None and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=2.0)
        self.monitor_thread = None

    def handle_execution_start(self, node_id):
        if not self.is_profiling: return
        nid = str(node_id)
        node_data = self.node_lookup_map.get(nid, {})
        title = node_data.get("title", f"Node {nid}")
        n_type = node_data.get("type", "Unknown")
        inputs = node_data.get("inputs", [])
        self.on_node_start(nid, title, n_type, inputs)

    def on_node_start(self, node_id, node_title, node_type, inputs):
        self.current_node_id = node_id
        self.current_node_title = node_title
        self.current_node_type = node_type
        self.current_inputs = json.dumps(inputs) if inputs else "[]"
        self.current_node_start_time = time.perf_counter()
        self.current_node_vram_start = self._get_vram_usage()
        
        self.stat_vram_max = self.current_node_vram_start
        self.stat_gpu_load_max = 0
        self.stat_gpu_load_sum = 0
        self.stat_gpu_sample_count = 0
        self.stat_cpu_max = 0

    def on_node_end(self):
        if not self.is_profiling or self.current_node_id is None:
            return

        end_time = time.perf_counter()
        exec_time = end_time - self.current_node_start_time
        vram_end = self._get_vram_usage()
        
        avg_gpu_load = 0
        if self.stat_gpu_sample_count > 0:
            avg_gpu_load = self.stat_gpu_load_sum / self.stat_gpu_sample_count

        try:
            self.db.add_step(
                run_id=self.active_run_id,
                node_id=str(self.current_node_id),
                node_title=self.current_node_title,
                node_type=self.current_node_type,
                vram_start=self.current_node_vram_start,
                vram_max=self.stat_vram_max,
                vram_end=vram_end,
                exec_time=exec_time,
                cpu_max=self.stat_cpu_max,
                gpu_load_max=self.stat_gpu_load_max,
                gpu_load_avg=avg_gpu_load,
                inputs_json=self.current_inputs,
                step_comment=""
            )
        except Exception as e:
            print(f"[Holaf Profiler] Error saving step: {e}")
        
        self.current_node_id = None

    def _monitor_loop(self):
        while self.is_profiling:
            try:
                cpu = psutil.cpu_percent(interval=None)
                if cpu > self.stat_cpu_max:
                    self.stat_cpu_max = cpu

                if self.gpu_handle:
                    mem_info = pynvml.nvmlDeviceGetMemoryInfo(self.gpu_handle)
                    used = mem_info.used
                    if used > self.stat_vram_max:
                        self.stat_vram_max = used
                    
                    util = pynvml.nvmlDeviceGetUtilizationRates(self.gpu_handle)
                    load = util.gpu
                    if load > self.stat_gpu_load_max:
                        self.stat_gpu_load_max = load
                    
                    self.stat_gpu_load_sum += load
                    self.stat_gpu_sample_count += 1
            except Exception:
                pass 
            time.sleep(0.05)

    def _get_vram_usage(self):
        if self.gpu_handle:
            try:
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(self.gpu_handle)
                return mem_info.used
            except:
                return 0
        return 0