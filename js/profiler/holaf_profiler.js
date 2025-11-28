import { HolafComfyBridge } from '/extensions/ComfyUI-Holaf-Utilities/holaf_comfy_bridge.js';

export function initProfiler() {
    console.log("Holaf Profiler Initializing...");
    
    const bridge = new HolafComfyBridge();
    let currentRunId = null;
    let pollInterval = null;

    const root = document.getElementById('holaf-profiler-root');
    root.innerHTML = `
        <header class="profiler-header">
            <div class="header-title">
                <h1>Holaf Workflow Profiler</h1>
            </div>
            <div class="header-actions">
                <button id="btn-update-nodes" class="btn btn-secondary">Update Nodes</button>
                <button id="btn-run-profile" class="btn">Run Profile</button>
            </div>
        </header>
        <div class="profiler-toolbar" id="column-filters">
            <!-- Filters could be injected here later -->
            <span style="font-size:0.8rem; color:#888;">Metrics: VRAM, Time, GPU Load</span>
        </div>
        <div class="profiler-content">
            <table class="data-table">
                <thead>
                    <tr id="table-header-row">
                        <th>ID</th>
                        <th>Node Name</th>
                        <th>Type</th>
                        <th class="col-vram">VRAM Max</th>
                        <th class="col-time">Time</th>
                        <th class="col-gpu">GPU Load</th>
                    </tr>
                </thead>
                <tbody id="profiler-table-body">
                    <tr><td colspan="6" style="text-align:center; color:#777;">Ready to profile. Click "Update Nodes" then "Run Profile".</td></tr>
                </tbody>
            </table>
        </div>
    `;

    // --- Helpers ---
    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function formatTime(seconds) {
        if (seconds < 1) return (seconds * 1000).toFixed(1) + " ms";
        return seconds.toFixed(2) + " s";
    }

    // --- Actions ---

    async function refreshContextView() {
        try {
            const resp = await fetch('/holaf/profiler/context');
            const data = await resp.json();
            
            if (data.nodes && data.nodes.length > 0) {
                const tbody = document.getElementById('profiler-table-body');
                tbody.innerHTML = '';
                
                data.nodes.forEach(node => {
                    const tr = document.createElement('tr');
                    tr.id = `row-node-${node.id}`;
                    tr.innerHTML = `
                        <td>${node.id}</td>
                        <td>${node.title || node.type}</td>
                        <td style="color:#888; font-size:0.85em;">${node.type}</td>
                        <td class="metric-cell vram">-</td>
                        <td class="metric-cell time">-</td>
                        <td class="metric-cell gpu">-</td>
                    `;
                    tbody.appendChild(tr);
                });
            } else {
                console.log("Context empty or invalid format.");
            }
        } catch (e) {
            console.error("Error fetching context:", e);
        }
    }

    async function pollRunData() {
        if (!currentRunId) return;
        
        try {
            const resp = await fetch(`/holaf/profiler/run/${currentRunId}`);
            const data = await resp.json();
            
            if (data.steps && Array.isArray(data.steps)) {
                // Update table rows
                data.steps.forEach(step => {
                    // Try to find row by Node ID
                    const rowId = `row-node-${step.node_id}`;
                    let tr = document.getElementById(rowId);
                    
                    // If row doesn't exist (dynamic node?), append it
                    if (!tr) {
                        const tbody = document.getElementById('profiler-table-body');
                        tr = document.createElement('tr');
                        tr.id = rowId;
                        tr.innerHTML = `
                            <td>${step.node_id}</td>
                            <td>${step.node_title}</td>
                            <td style="color:#888; font-size:0.85em;">${step.node_type}</td>
                            <td class="metric-cell vram"></td>
                            <td class="metric-cell time"></td>
                            <td class="metric-cell gpu"></td>
                        `;
                        tbody.appendChild(tr);
                    }
                    
                    // Update Metrics
                    tr.querySelector('.vram').textContent = formatBytes(step.vram_max);
                    tr.querySelector('.time').textContent = formatTime(step.exec_time);
                    tr.querySelector('.gpu').textContent = step.gpu_load_max ? step.gpu_load_max + "%" : "-";
                    
                    // Highlight finished rows
                    tr.style.backgroundColor = "rgba(76, 175, 80, 0.1)";
                });
            }
        } catch (e) {
            console.error("Polling error:", e);
        }
    }

    // 1. UPDATE NODES
    document.getElementById('btn-update-nodes').addEventListener('click', async () => {
        try {
            const btn = document.getElementById('btn-update-nodes');
            const originalText = btn.innerText;
            btn.innerText = "Syncing...";
            btn.disabled = true;

            // Ask main tab to push context to backend
            bridge.sendCommand('get_workflow_for_profiler');
            
            // Wait 500ms for backend to update, then fetch context
            setTimeout(async () => {
                await refreshContextView();
                btn.innerText = originalText;
                btn.disabled = false;
            }, 500);
            
        } catch (e) {
            console.error(e);
            alert("Failed to update nodes: " + e);
        }
    });

    // 2. RUN PROFILE
    document.getElementById('btn-run-profile').addEventListener('click', async () => {
        const runName = prompt("Enter a name for this run (Optional):", "Run " + new Date().toLocaleTimeString());
        
        // Ensure UI is clean
        const tbody = document.getElementById('profiler-table-body');
        // Reset colors and values but keep rows if they exist
        Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
            tr.style.backgroundColor = "";
            tr.querySelectorAll('.metric-cell').forEach(td => td.textContent = "-");
        });

        // Start Backend Run
        const resp = await fetch('/holaf/profiler/run-start', {
            method: 'POST',
            body: JSON.stringify({ name: runName })
        });
        const data = await resp.json();
        
        if (data.status === 'ok') {
            console.log("Run started:", data.run_id);
            currentRunId = data.run_id;
            
            // Trigger Queue in Main Tab
            bridge.sendCommand('queue_prompt');
            
            // Start Polling
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(pollRunData, 1000);
        }
    });
}