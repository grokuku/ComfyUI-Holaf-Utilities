/* holaf_monitor.js */
    import { app } from "../../../scripts/app.js";
    import { api } from "../../../scripts/api.js";
    import "./chart.min.js"; // Import Chart.js
    
    const HolafSystemMonitor = {
        name: "Holaf.SystemMonitor",
        isVisible: false,
        ws: null,
        monitorElement: null,
        resizeHandle: null,
        mainChart: null,
        resizeObserver: null,
        chartData: {
            labels: [],
            datasets: []
        },
    
        // --- NEW: Internal state for Ghost Position ---
        storedPos: {
            right: 20,
            bottom: 20,
            width: 400,
            height: 260
        },
        STORAGE_KEY: "holaf_monitor_state_v2", // Versioned key
    
        // Configuration
        baseMaxPoints: 60,       // Normal mode (1.5s rate)
        turboMaxPoints: 300,     // Turbo mode (0.25s rate) - 5x density
        currentMaxPoints: 60,    // Dynamic current limit
        
        config: {
            update_interval_ms: 1500,
            max_history_points: 60,
        },
        gpuDataInitialized: false,
        hiddenDatasetIds: new Set(), // Store user preference for hidden lines
    
        // Palette for multiple GPUs.
        GPU_PALETTE: [
            { load: '#4bc0c0', vram: '#9966ff' }, // GPU 0
            { load: '#ff9f40', vram: '#ffcd56' }, // GPU 1
            { load: '#36a2eb', vram: '#ff6384' }, // GPU 2
            { load: '#4d5360', vram: '#c9cbcf' }  // GPU 3
        ],
    
        COLORS: {
            CPU_BAR: '#ff6384',
            RAM_BAR: '#36a2eb'
        },
    
        init() {
            this.loadSettingsFromGlobalOrFetch();
            this.restoreState(); // Loads storedPos and isVisible
            this.createMonitorElement();
            this.setupComfyListeners();
    
            // Handle window resizing to keep tool visible without breaking storedPos
            window.addEventListener("resize", () => this.updateVisualPosition());
    
            // Auto-start if it was visible in previous session
            if (this.isVisible) {
                setTimeout(() => this.show(), 300);
            }
        },
        
        async loadSettingsFromGlobalOrFetch() {
            if (app.holafSettingsManager?.settingsData?.SystemMonitor) {
                this.config = app.holafSettingsManager.settingsData.SystemMonitor;
            }
            this.baseMaxPoints = this.config.max_history_points || 60;
            this.currentMaxPoints = this.baseMaxPoints;
            // Init labels array
            this.chartData.labels = Array(this.currentMaxPoints).fill("");
        },
    
        // --- TURBO MODE LOGIC ---
        setupComfyListeners() {
            api.addEventListener("execution_start", () => this.setTurboMode(true));
            api.addEventListener("execution_error", () => this.setTurboMode(false));
            api.addEventListener("executing", (e) => {
                if (e.detail === null) this.setTurboMode(false);
            });
        },
    
        setTurboMode(enable) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            
            // 1. Send Command to Backend
            const cmd = enable ? "turbo_on" : "turbo_off";
            this.ws.send(JSON.stringify({ cmd: cmd }));
    
            // 2. Adjust Graph Density (Counterbalance Acceleration)
            // When turbo (fast updates), we want MORE points so they appear closer together
            // and the total time window on screen remains roughly consistent.
            this.currentMaxPoints = enable ? this.turboMaxPoints : this.baseMaxPoints;
            
            // Adjust labels array length immediately to avoid Chart.js errors
            // (Data arrays adjust automatically in updateChartData)
            if (this.chartData.labels.length > this.currentMaxPoints) {
                this.chartData.labels = this.chartData.labels.slice(-this.currentMaxPoints);
            } else {
                while (this.chartData.labels.length < this.currentMaxPoints) {
                    this.chartData.labels.push("");
                }
            }
        },
    
        createMonitorElement() {
            if (this.monitorElement) return;
    
            // --- 1. MAIN WINDOW ---
            this.monitorElement = document.createElement("div");
            this.monitorElement.id = "holaf-monitor-root";
            
            Object.assign(this.monitorElement.style, {
                display: "none",
                position: "fixed",
                zIndex: "1000",
                minWidth: "250px",
                minHeight: "180px",
                backgroundColor: "rgba(20, 20, 20, 0.95)",
                borderRadius: "10px",
                border: "1px solid var(--border-color, #555)",
                backdropFilter: "blur(4px)",
                fontFamily: "monospace",
                boxSizing: "border-box",
                overflow: "hidden",
                pointerEvents: "auto", 
                cursor: "default",
                flexDirection: "column"
            });
    
            this.enableWindowDragging();
            this.createResizeHandle();
    
            // --- 2. HEADER ---
            const headerContainer = document.createElement("div");
            headerContainer.id = "holaf-monitor-header";
            Object.assign(headerContainer.style, {
                flex: "0 0 auto",
                width: "100%",
                padding: "12px 12px 8px 12px",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
            });
    
            const createBar = (id, label, color) => {
                const wrapper = document.createElement("div");
                wrapper.style.display = "flex"; wrapper.style.flexDirection = "column";
                
                const labelRow = document.createElement("div");
                Object.assign(labelRow.style, {
                    display: "flex", justifyContent: "space-between",
                    fontSize: "14px", fontWeight: "bold", color: "#eee",
                    marginBottom: "3px", paddingRight: "10px"
                });
                labelRow.innerHTML = `<span>${label}</span><span id="${id}-val">0%</span>`;
    
                const track = document.createElement("div");
                Object.assign(track.style, {
                    height: "10px", width: "100%", backgroundColor: "rgba(255,255,255,0.15)",
                    borderRadius: "5px", overflow: "hidden"
                });
                const fill = document.createElement("div");
                fill.id = `${id}-fill`;
                Object.assign(fill.style, { height: "100%", width: "0%", backgroundColor: color, transition: "width 0.3s ease" });
                
                track.appendChild(fill);
                wrapper.appendChild(labelRow);
                wrapper.appendChild(track);
                return wrapper;
            };
    
            headerContainer.appendChild(createBar("holaf-cpu", "CPU", this.COLORS.CPU_BAR));
            headerContainer.appendChild(createBar("holaf-ram", "RAM", this.COLORS.RAM_BAR));
    
            // --- 3. CHART WRAPPER ---
            const chartWrapper = document.createElement("div");
            chartWrapper.id = "holaf-monitor-chart-wrapper";
            Object.assign(chartWrapper.style, {
                flex: "1 1 auto",
                position: "relative",
                width: "100%",
                minHeight: "0",
                padding: "0 10px 5px 0", 
                boxSizing: "border-box",
                overflow: "hidden"
            });
    
            const chartCanvas = document.createElement("canvas");
            chartCanvas.id = "holaf-main-monitor-chart";
            Object.assign(chartCanvas.style, { display: "block", width: "100%", height: "100%" });
    
            chartWrapper.appendChild(chartCanvas);
    
            this.monitorElement.appendChild(headerContainer);
            this.monitorElement.appendChild(chartWrapper);
            document.body.appendChild(this.monitorElement);
    
            this.resizeObserver = new ResizeObserver(() => {
                if (this.mainChart) this.mainChart.resize();
            });
            this.resizeObserver.observe(chartWrapper);
    
            // Apply visual clamping
            this.updateVisualPosition();
        },
    
        // --- NEW: Visual clamping logic ---
        updateVisualPosition() {
            if (!this.monitorElement) return;
    
            // Apply stored size
            this.monitorElement.style.width = this.storedPos.width + "px";
            this.monitorElement.style.height = this.storedPos.height + "px";
    
            // Calculate viewport limits
            const maxRight = window.innerWidth - this.storedPos.width;
            const maxBottom = window.innerHeight - this.storedPos.height;
    
            // Visual clamping: cap the display between 0 and screen limits
            const visualRight = Math.max(0, Math.min(this.storedPos.right, maxRight));
            const visualBottom = Math.max(0, Math.min(this.storedPos.bottom, maxBottom));
    
            Object.assign(this.monitorElement.style, {
                left: "auto",
                top: "auto",
                right: visualRight + "px",
                bottom: visualBottom + "px"
            });
    
            if (this.mainChart) this.mainChart.resize();
        },
    
        enableWindowDragging() {
            let isDragging = false;
            let startX, startY, dragStartRight, dragStartBottom;
    
            this.monitorElement.addEventListener('mousedown', (e) => {
                if (e.target === this.resizeHandle || this.resizeHandle?.contains(e.target)) return;
                
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                
                // Current visual state as starting point
                const rect = this.monitorElement.getBoundingClientRect();
                dragStartRight = window.innerWidth - rect.right;
                dragStartBottom = window.innerHeight - rect.bottom;
                
                this.monitorElement.style.cursor = "move";
                e.preventDefault();
                
                const onMouseMove = (ev) => {
                    if (!isDragging) return;
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
    
                    // Update STORED position directly
                    this.storedPos.right = dragStartRight - dx;
                    this.storedPos.bottom = dragStartBottom - dy;
    
                    this.updateVisualPosition();
                };
    
                const onMouseUp = () => {
                    if (isDragging) {
                        isDragging = false;
                        this.monitorElement.style.cursor = "default";
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        this.saveState(); 
                    }
                };
    
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        },
    
        createResizeHandle() {
            this.resizeHandle = document.createElement("div");
            Object.assign(this.resizeHandle.style, {
                position: "absolute", bottom: "0", right: "0",
                width: "24px", height: "24px", cursor: "nwse-resize",
                backgroundColor: "rgba(255, 255, 255, 0.1)", zIndex: "20",
                borderBottomRightRadius: "10px", borderTopLeftRadius: "10px",
                pointerEvents: "auto"
            });
            this.resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" style="fill:white; opacity:0.8;"><path d="M22 22H2v-2h20v2zM22 18H6v-2h16v2zM22 14H10v-2h12v2z"/></svg>`; 
    
            let isResizing = false;
            let startX, startY, startW, startH, startRight, startBottom;
    
            this.resizeHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation(); 
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                
                const rect = this.monitorElement.getBoundingClientRect();
                startW = rect.width;
                startH = rect.height;
                startRight = window.innerWidth - rect.right;
                startBottom = window.innerHeight - rect.bottom;
    
                e.preventDefault();
    
                const onMouseMove = (ev) => {
                    if (!isResizing) return;
                    const dx = ev.clientX - startX; 
                    const dy = ev.clientY - startY;
                    
                    const newW = Math.max(250, startW + dx);
                    const newH = Math.max(180, startH + dy);
    
                    // Update size
                    this.storedPos.width = newW;
                    this.storedPos.height = newH;
                    
                    // Adjust position to keep top-left corner fixed
                    this.storedPos.right = startRight - (newW - startW);
                    this.storedPos.bottom = startBottom - (newH - startH);
                    
                    this.updateVisualPosition();
                };
    
                const onMouseUp = () => {
                    if (isResizing) {
                        isResizing = false;
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        this.saveState(); 
                    }
                };
    
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
    
            this.monitorElement.appendChild(this.resizeHandle);
        },
    
        // --- PERSISTENCE ---
        saveState() {
            if (!this.monitorElement) return;
            
            // Also save hidden datasets
            const hiddenIds = [];
            if (this.mainChart) {
                this.mainChart.data.datasets.forEach((ds, index) => {
                    const meta = this.mainChart.getDatasetMeta(index);
                    if (meta.hidden) hiddenIds.push(ds.id);
                });
            }
    
            const state = { 
                ...this.storedPos,
                isVisible: this.isVisible, // Persist visibility
                hiddenDatasets: hiddenIds // Save visibility preference
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        },
    
        restoreState() {
            try {
                const saved = localStorage.getItem(this.STORAGE_KEY);
                if (saved) {
                    const state = JSON.parse(saved);
                    this.storedPos.right = state.right ?? 20;
                    this.storedPos.bottom = state.bottom ?? 20;
                    this.storedPos.width = state.width ?? 400;
                    this.storedPos.height = state.height ?? 260;
                    this.isVisible = !!state.isVisible;
                    
                    if (state.hiddenDatasets && Array.isArray(state.hiddenDatasets)) {
                        this.hiddenDatasetIds = new Set(state.hiddenDatasets);
                    }
                }
            } catch (e) {}
        },
    
        toggle() {
            this.isVisible = !this.isVisible;
            this.isVisible ? this.show() : this.hide();
            this.saveState(); // Save on toggle
            return this.isVisible;
        },
    
        show() {
            if (!this.monitorElement) this.createMonitorElement();
            this.monitorElement.style.display = "flex";
            this.isVisible = true;
            this.gpuDataInitialized = false;
            this.initializeMainChart();
            this.connectWebSocket();
            this.updateVisualPosition();
        },
    
        hide() {
            if (this.monitorElement) this.monitorElement.style.display = "none";
            this.isVisible = false;
            this.disconnectWebSocket();
        },
    
        initializeMainChart() {
            if (this.mainChart) {
                this.mainChart.destroy();
                this.mainChart = null;
            }
            this.chartData.datasets = [];
    
            const canvas = document.getElementById("holaf-main-monitor-chart");
            if (!canvas) return;
            
            const ctx = canvas.getContext("2d");
            const chartOptions = {
                responsive: true,
                maintainAspectRatio: false, 
                animation: false,
                layout: {
                    padding: { left: 0, right: 10, top: 5, bottom: 0 }
                },
                interaction: { mode: 'index', intersect: false },
                events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
                scales: {
                    x: { display: false },
                    y: { 
                        position: 'left',
                        min: 0, max: 100,
                        beginAtZero: false,
                        ticks: { 
                            display: true, color: '#ffffff',
                            font: { size: 10, family: 'monospace' },
                            padding: 5,
                            callback: function(value) { return value + '%'; }
                        }, 
                        grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false } 
                    }
                },
                plugins: {
                    legend: { 
                        display: true, position: "bottom",
                        labels: { 
                            boxWidth: 12, boxHeight: 3, padding: 15, 
                            font: { size: 11, weight: 'bold', family: 'monospace' }, 
                            color: "#ccc",
                            generateLabels: (chart) => {
                                const original = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                                original.forEach(label => {
                                    const dataset = chart.data.datasets[label.datasetIndex];
                                    // Check for valid last value
                                    let lastVal = null;
                                    for(let i = dataset.data.length -1; i >= 0; i--) {
                                        if(dataset.data[i] !== null) { lastVal = dataset.data[i]; break; }
                                    }
                                    if (lastVal !== null) {
                                        if (dataset.isVram && dataset.totalVramMb) {
                                            const usedGb = (lastVal / 100 * dataset.totalVramMb / 1024).toFixed(1);
                                            label.text = `${dataset.baseLabel}: ${usedGb} GB`;
                                        } else {
                                            label.text = `${dataset.baseLabel}: ${lastVal.toFixed(0)}%`;
                                        }
                                    } else {
                                         label.text = `${dataset.baseLabel}: --`;
                                    }
                                });
                                return original;
                            }
                        },
                        // INTERCEPT CLICK TO SAVE STATE
                        onClick: (e, legendItem, legend) => {
                            // Call default handler to toggle visibility
                            Chart.defaults.plugins.legend.onClick(e, legendItem, legend);
                            // Save the new state
                            this.saveState();
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        titleFont: { size: 13 },
                        bodyFont: { size: 13 },
                        padding: 10,
                        cornerRadius: 4,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.baseLabel || context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toFixed(1) + '%';
                                    if (context.dataset.isVram && context.dataset.totalVramMb) {
                                        const usedGb = (context.parsed.y / 100 * context.dataset.totalVramMb / 1024).toFixed(1);
                                        const totalGb = (context.dataset.totalVramMb / 1024).toFixed(1);
                                        label += ` (${usedGb}/${totalGb} GB)`;
                                    }
                                }
                                return label;
                            }
                        }
                    }
                },
                elements: { point: { radius: 0, hoverRadius: 4 }, line: { borderWidth: 2, tension: 0.2 } }
            };
            
            try {
                this.mainChart = new Chart(ctx, {
                    type: "line",
                    data: this.chartData,
                    options: chartOptions,
                });
            } catch (e) { }
        },
    
        updateBars(stats) {
            const cpuEl = document.getElementById("holaf-cpu-val");
            const cpuFill = document.getElementById("holaf-cpu-fill");
            if (cpuEl) cpuEl.textContent = stats.cpu_percent.toFixed(0) + "%";
            if (cpuFill) cpuFill.style.width = stats.cpu_percent + "%";
    
            const ramEl = document.getElementById("holaf-ram-val");
            const ramFill = document.getElementById("holaf-ram-fill");
            if (ramEl) ramEl.textContent = `${stats.ram.percent.toFixed(0)}% (${stats.ram.used_gb.toFixed(1)}GB)`;
            if (ramFill) ramFill.style.width = stats.ram.percent + "%";
        },
    
        initializeGpuDatasets(gpuStatsArray) {
            if (!this.monitorElement || this.gpuDataInitialized) return;
            this.chartData.datasets = [];
            
            gpuStatsArray.forEach((gpu, index) => {
                const colorPair = this.GPU_PALETTE[index % this.GPU_PALETTE.length];
                
                const loadId = `GPU_${gpu.id}_LOAD`;
                const vramId = `GPU_${gpu.id}_VRAM`;
    
                // LOAD Dataset
                this.chartData.datasets.push({
                    id: loadId, 
                    label: `GPU ${gpu.id} Load`,
                    baseLabel: `GPU ${gpu.id} Load`, 
                    data: Array(this.currentMaxPoints).fill(null),
                    borderColor: colorPair.load, 
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [4, 4],
                    pointRadius: 0, 
                    fill: false,
                    isVram: false,
                    hidden: this.hiddenDatasetIds.has(loadId) // Restore hidden state
                });
    
                // VRAM Dataset
                this.chartData.datasets.push({
                    id: vramId, 
                    label: `GPU ${gpu.id} VRAM`,
                    baseLabel: `GPU ${gpu.id} VRAM`,
                    data: Array(this.currentMaxPoints).fill(null),
                    borderColor: colorPair.vram, 
                    backgroundColor: 'transparent',
                    borderWidth: 2, 
                    borderDash: [],
                    pointRadius: 0, 
                    fill: false,
                    isVram: true,
                    totalVramMb: gpu.memory_total_mb,
                    hidden: this.hiddenDatasetIds.has(vramId) // Restore hidden state
                });
            });
            
            this.gpuDataInitialized = true;
            if (this.mainChart) this.mainChart.update('none');
        },
    
        updateChartData(datasetId, newValue) {
            if (!this.mainChart) return;
            const dataset = this.chartData.datasets.find(ds => ds.id === datasetId);
            if (dataset) {
                dataset.data.push(newValue);
                // Dynamic trim based on CURRENT max points (Turbo vs Normal)
                while (dataset.data.length > this.currentMaxPoints) {
                    dataset.data.shift();
                }
            }
        },
    
        connectWebSocket() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
            if (this.ws) this.ws.close();
    
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const host = window.location.host;
            let basePath = api.api_base || "";
            if (basePath.startsWith("/")) basePath = basePath.substring(1);
            if (basePath.length > 0 && !basePath.endsWith("/")) basePath += "/";
            const wsUrl = `${protocol}//${host}/${basePath}holaf/monitor/ws`;
    
            try {
                this.ws = new WebSocket(wsUrl);
            } catch (e) { return; }
    
            this.ws.onmessage = (event) => {
                try {
                    const stats = JSON.parse(event.data);
                    this.updateBars(stats);
    
                    if (stats.gpus && stats.gpus.length > 0 && !this.gpuDataInitialized) {
                        this.initializeGpuDatasets(stats.gpus);
                    }
                    
                    let minVisibleValue = 100;
    
                    if(stats.gpus && this.gpuDataInitialized) {
                        stats.gpus.forEach(gpu => {
                            const loadVal = gpu.utilization_percent;
                            let vramPercent = 0;
                            if (gpu.memory_total_mb > 0) {
                                vramPercent = (gpu.memory_used_mb / gpu.memory_total_mb) * 100;
                            }
                            
                            this.updateChartData(`GPU_${gpu.id}_LOAD`, loadVal);
                            this.updateChartData(`GPU_${gpu.id}_VRAM`, vramPercent);
    
                            // Scaling
                            const loadDs = this.chartData.datasets.find(ds => ds.id === `GPU_${gpu.id}_LOAD`);
                            if (loadDs && this.mainChart.isDatasetVisible(this.chartData.datasets.indexOf(loadDs))) {
                                 const minHist = Math.min(...loadDs.data.filter(v => v !== null));
                                 if (minHist < minVisibleValue) minVisibleValue = minHist;
                            }
                            const vramDs = this.chartData.datasets.find(ds => ds.id === `GPU_${gpu.id}_VRAM`);
                            if (vramDs && this.mainChart.isDatasetVisible(this.chartData.datasets.indexOf(vramDs))) {
                                const minHist = Math.min(...vramDs.data.filter(v => v !== null));
                                if (minHist < minVisibleValue) minVisibleValue = minHist;
                            }
                        });
                    }
                    
                    if (this.mainChart) {
                        if (minVisibleValue > 95) minVisibleValue = 95; 
                        if (minVisibleValue < 0) minVisibleValue = 0;
                        const newMin = Math.max(0, Math.floor(minVisibleValue - 5));
                        
                        if (this.mainChart.options.scales.y.min !== newMin) {
                            this.mainChart.options.scales.y.min = newMin;
                        }
                        this.mainChart.update('none'); 
                    }
    
                } catch (e) { }
            };
        },
    
        disconnectWebSocket() {
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            if (this.mainChart) {
                this.mainChart.destroy();
                this.mainChart = null;
            }
            this.chartData.datasets = [];
            this.gpuDataInitialized = false;
        },
    };
    
    app.registerExtension({
        name: HolafSystemMonitor.name,
        async setup() {
            try {
                setTimeout(() => HolafSystemMonitor.init(), 200);
                app.holafSystemMonitor = HolafSystemMonitor;
            } catch(e) { }
        },
    });