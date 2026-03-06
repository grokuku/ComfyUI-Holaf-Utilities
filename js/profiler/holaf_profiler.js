import { HolafComfyBridge } from '/extensions/ComfyUI-Holaf-Utilities/holaf_comfy_bridge.js';

export function initProfiler() {
    console.log("Holaf Profiler Initializing...");
    
    const bridge = new HolafComfyBridge();
    
    // --- STATE ---
    let currentRunId = null;
    let pollInterval = null;
    let nodesMap = new Map();
    let executionCounter = 0;
    
    // Group Mapping
    let groupMapping = {}; 

    let config = {
        filterNonExecuted: false,
        filterTypeExclude: "",
        minTime: 0.0,
        sortBy: 'exec_order',
        sortDir: 'asc'
    };

    const root = document.getElementById('holaf-profiler-root');
    
    // --- LOAD SAVED GROUPS ---
    try {
        const saved = localStorage.getItem('holaf_profiler_groups');
        if (saved) groupMapping = JSON.parse(saved);
    } catch(e) {}

    // --- BRIDGE LISTENER ---
    bridge.listen((data) => {
        if (data && data.type === 'profiler_group_data') {
            groupMapping = data.map;
            applyGroupsAndRender();
        }
    });

    // --- UI STRUCTURE ---
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

        <div class="profiler-toolbar">
            <div class="filter-group">
                <label title="Only active if at least one node has finished execution">
                    <input type="checkbox" id="chk-hide-non-executed"> Hide Non-Executed
                </label>
            </div>
            <div class="filter-group">
                <label>Min Time: <span id="lbl-min-time" style="font-weight:bold; color:#4CAF50;">0.0s</span></label>
                <input type="range" id="rng-min-time" min="0" max="5" step="0.1" value="0">
            </div>
            <div class="filter-group">
                <label>Exclude Type:</label>
                <input type="text" id="inp-filter-type" placeholder="Type..." style="width: 100px; padding: 2px 5px; background:#222; border:1px solid #444; color:#fff;">
            </div>
            <div class="filter-group" style="flex-grow:1; text-align:right;">
                <span style="font-size:0.8rem; color:#888;">Click headers to sort</span>
            </div>
        </div>

        <div class="profiler-content">
            <table class="data-table">
                <thead>
                    <tr id="table-header-row">
                        <th data-sort="exec_order" class="sortable" style="width:60px;">Order <span class="sort-icon"></span></th>
                        <th data-sort="id" class="sortable">ID <span class="sort-icon"></span></th>
                        <th data-sort="title" class="sortable">Node Name <span class="sort-icon"></span></th>
                        <!-- CORRECTION: data-sort must match the property name 'holaf_group' -->
                        <th data-sort="holaf_group" class="sortable">Group <span class="sort-icon"></span></th>
                        <th data-sort="type" class="sortable">Type <span class="sort-icon"></span></th>
                        <th data-sort="vram" class="sortable col-vram">VRAM Max <span class="sort-icon"></span></th>
                        <th data-sort="exec_time" class="sortable col-time">Time <span class="sort-icon"></span></th>
                        <th data-sort="gpu" class="sortable col-gpu">GPU Load <span class="sort-icon"></span></th>
                    </tr>
                </thead>
                <tbody id="profiler-table-body">
                    <tr><td colspan="8" style="text-align:center; color:#777;">Ready. Click "Update Nodes".</td></tr>
                </tbody>
            </table>
        </div>
    `;

    // --- EVENT LISTENERS ---
    
    const chkNonExec = document.getElementById('chk-hide-non-executed');
    if (chkNonExec) chkNonExec.addEventListener('change', (e) => {
        config.filterNonExecuted = e.target.checked;
        renderTable();
    });

    const rangeTime = document.getElementById('rng-min-time');
    const labelTime = document.getElementById('lbl-min-time');
    if (rangeTime) rangeTime.addEventListener('input', (e) => {
        config.minTime = parseFloat(e.target.value);
        labelTime.textContent = config.minTime.toFixed(1) + "s";
        renderTable();
    });

    const inpType = document.getElementById('inp-filter-type');
    if (inpType) inpType.addEventListener('input', (e) => {
        config.filterTypeExclude = e.target.value.toLowerCase();
        renderTable();
    });

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (config.sortBy === key) {
                config.sortDir = config.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                config.sortBy = key;
                config.sortDir = 'desc'; 
                if (key === 'exec_order' || key === 'id' || key === 'holaf_group') config.sortDir = 'asc';
            }
            renderTable();
        });
    });

    // --- HELPERS ---

    function formatBytes(bytes) {
        if (!+bytes) return '-';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    function formatTime(seconds) {
        if (seconds === undefined || seconds === null) return '-';
        if (seconds < 1) return (seconds * 1000).toFixed(1) + " ms";
        return seconds.toFixed(2) + " s";
    }

    function formatOrder(num) {
        if (!num) return '-';
        return num.toString().padStart(3, '0');
    }

    function resolveNodeName(nodeId, nodeData) {
        const idStr = String(nodeId);
        if (idStr.includes(':')) {
            const [parentId, internalId] = idStr.split(':');
            const parent = nodesMap.get(parentId);
            const parentName = parent ? (parent.title || parent.type) : 'Unknown';
            return `<span style="opacity:0.6">${parentName} &gt;</span> SubNode ${internalId}`;
        }
        return nodeData.title || nodeData.type || "Unknown";
    }

    function applyGroupsAndRender() {
        if (nodesMap.size > 0 && Object.keys(groupMapping).length > 0) {
            nodesMap.forEach((node, id) => {
                if (groupMapping[id]) {
                    node.holaf_group = groupMapping[id];
                }
            });
            renderTable();
        }
    }

    // --- RENDER LOGIC ---

    function updateHeaderIcons() {
        document.querySelectorAll('th.sortable').forEach(th => {
            const iconSpan = th.querySelector('.sort-icon');
            if (!iconSpan) return;
            th.style.color = "";
            iconSpan.textContent = "";

            if (th.dataset.sort === config.sortBy) {
                th.style.color = "#fff";
                iconSpan.textContent = config.sortDir === 'asc' ? ' ▲' : ' ▼';
                iconSpan.style.color = "#4CAF50";
            }
        });
    }

    function renderTable() {
        updateHeaderIcons();

        const tbody = document.getElementById('profiler-table-body');
        if (!tbody) return;

        const rows = [];
        nodesMap.forEach((data, id) => {
            rows.push({ id: id, ...data });
        });

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#777;">No nodes data.</td></tr>';
            return;
        }

        const excludeTypes = config.filterTypeExclude.split(',').map(s => s.trim()).filter(s => s);
        const anyNodeExecuted = rows.some(r => (r.exec_time || 0) > 0);

        // --- FILTERING ---
        const filteredRows = rows.filter(row => {
            if (config.filterNonExecuted && anyNodeExecuted) {
                if (!row.exec_time || row.exec_time <= 0) return false;
            }
            
            const t = row.exec_time || 0;
            if (t > 0 && t < config.minTime) return false;

            if (excludeTypes.length > 0) {
                const rowType = (row.type || "").toLowerCase();
                for (let ex of excludeTypes) {
                    if (rowType.includes(ex)) return false;
                }
            }
            return true;
        });

        // --- SORTING ---
        filteredRows.sort((a, b) => {
            let valA = a[config.sortBy];
            let valB = b[config.sortBy];

            if (config.sortBy === 'exec_order') {
                if (!valA) valA = 999999;
                if (!valB) valB = 999999;
            } else {
                if (valA === undefined) valA = 0;
                if (valB === undefined) valB = 0;
            }
            
            // CORRECTION: Added 'holaf_group' to the text sort list
            if (['title', 'type', 'holaf_group'].includes(config.sortBy)) {
                valA = (valA || "").toString().toLowerCase();
                valB = (valB || "").toString().toLowerCase();
                if (valA < valB) return config.sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return config.sortDir === 'asc' ? 1 : -1;
                return 0;
            }
            return config.sortDir === 'asc' ? valA - valB : valB - valA;
        });

        // --- HTML GEN ---
        tbody.innerHTML = filteredRows.map(row => {
            const isSubNode = String(row.id).includes(':');
            const rowStyle = isSubNode ? 'background-color: rgba(255,255,255,0.02);' : '';
            const finishedStyle = row.exec_time ? 'background-color: rgba(76, 175, 80, 0.1);' : '';
            
            const groupBadge = row.holaf_group 
                ? `<span class="badge-group">${row.holaf_group}</span>` 
                : '<span style="color:#444">-</span>';

            const orderBadge = row.exec_order
                ? `<span style="font-family:monospace; color:#4CAF50;">${formatOrder(row.exec_order)}</span>`
                : `<span style="color:#444">-</span>`;

            let gpuDisplay = "-";
            if (row.gpu_load_max !== undefined && row.gpu_load_max !== null) {
                gpuDisplay = row.gpu_load_max + "%";
            }

            return `
                <tr style="${rowStyle} ${finishedStyle}">
                    <td style="text-align:center;">${orderBadge}</td>
                    <td>${row.id}</td>
                    <td>${resolveNodeName(row.id, row)}</td>
                    <td>${groupBadge}</td>
                    <td style="color:#888; font-size:0.85em;">${row.type}</td>
                    <td class="metric-cell vram">${formatBytes(row.vram_max)}</td>
                    <td class="metric-cell time">${formatTime(row.exec_time)}</td>
                    <td class="metric-cell gpu">${gpuDisplay}</td>
                </tr>
            `;
        }).join('');
    }

    // --- NETWORK ACTIONS ---

    async function refreshContextView() {
        try {
            const saved = localStorage.getItem('holaf_profiler_groups');
            if (saved) groupMapping = JSON.parse(saved);

            const resp = await fetch('/holaf/profiler/context');
            if (!resp.ok) throw new Error("Context fetch failed");
            
            const data = await resp.json();
            
            if (data.nodes && Array.isArray(data.nodes)) {
                nodesMap.clear();

                data.nodes.forEach(node => {
                    nodesMap.set(String(node.id), {
                        id: String(node.id),
                        title: node.title,
                        type: node.type,
                        mode: node.mode,
                        holaf_group: groupMapping[String(node.id)] || null,
                        exec_order: null,
                        vram_max: 0,
                        exec_time: 0,
                        gpu_load_max: 0
                    });
                });
                renderTable();
            }
        } catch (e) {
            console.error("Error fetching context:", e);
        }
    }

    async function pollRunData() {
        if (!currentRunId) return;
        try {
            const resp = await fetch(`/holaf/profiler/run/${currentRunId}`);
            if (!resp.ok) return;

            const data = await resp.json();
            if (data.steps && Array.isArray(data.steps)) {
                let hasUpdates = false;
                data.steps.forEach(step => {
                    const idStr = String(step.node_id);
                    let nodeData = nodesMap.get(idStr);
                    
                    if (!nodeData) {
                        nodeData = {
                            id: idStr,
                            title: step.node_title || "Unknown",
                            type: step.node_type || "Unknown",
                            holaf_group: groupMapping[idStr] || null, 
                            mode: 0,
                            exec_order: null,
                            vram_max: 0, exec_time: 0, gpu_load_max: 0
                        };
                        if (!nodeData.holaf_group && idStr.includes(':')) {
                            const parentId = idStr.split(':')[0];
                            const parent = nodesMap.get(parentId);
                            if (parent && parent.holaf_group) nodeData.holaf_group = parent.holaf_group;
                        }
                        nodesMap.set(idStr, nodeData);
                    }

                    nodeData.vram_max = step.vram_max;
                    nodeData.exec_time = step.exec_time;
                    nodeData.gpu_load_max = step.gpu_load_max;
                    
                    if (step.exec_time > 0 && !nodeData.exec_order) {
                        executionCounter++;
                        nodeData.exec_order = executionCounter;
                    }
                    hasUpdates = true;
                });
                if (hasUpdates) renderTable();
            }
        } catch (e) { console.error("Polling error:", e); }
    }

    const btnUpdate = document.getElementById('btn-update-nodes');
    if (btnUpdate) {
        btnUpdate.addEventListener('click', async () => {
            const originalText = btnUpdate.innerText;
            btnUpdate.innerText = "Syncing...";
            btnUpdate.disabled = true;

            bridge.send('get_workflow_for_profiler');
            
            setTimeout(async () => {
                await refreshContextView();
                btnUpdate.innerText = originalText;
                btnUpdate.disabled = false;
            }, 800);
        });
    }

    const btnRun = document.getElementById('btn-run-profile');
    if (btnRun) {
        btnRun.addEventListener('click', async () => {
            const runName = prompt("Enter a name for this run (Optional):", "Run " + new Date().toLocaleTimeString());
            executionCounter = 0;
            nodesMap.forEach(node => {
                node.vram_max = 0;
                node.exec_time = 0;
                node.exec_order = null;
                node.gpu_load_max = 0;
            });
            renderTable();

            try {
                const resp = await fetch('/holaf/profiler/run-start', {
                    method: 'POST',
                    body: JSON.stringify({ name: runName })
                });
                const data = await resp.json();
                if (data.status === 'ok') {
                    currentRunId = data.run_id;
                    bridge.send('queue_prompt');
                    if (pollInterval) clearInterval(pollInterval);
                    pollInterval = setInterval(pollRunData, 1000);
                }
            } catch (e) { console.error("Run start failed:", e); }
        });
    }
}