/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - System Monitor
 *
 * This script displays a real-time system monitor overlay.
 * FINAL ATTEMPT: "CSS CALC STRATEGY"
 * - Layout: Header is fixed pixel height. Chart is height: calc(100% - header).
 * - Canvas: Forced to width/height 100% !important via CSS.
 * - Resize: No limits on max size.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import "./chart.min.js"; // Import Chart.js

const HolafSystemMonitor = {
    name: "Holaf.SystemMonitor",
    isVisible: false,
    ws: null,
    monitorElement: null,
    dragHandle: null,
    resizeHandle: null,
    mainChart: null,
    resizeObserver: null,
    chartData: {
        labels: [],
        datasets: []
    },
    maxHistoryPoints: 60,
    config: {
        update_interval_ms: 1500,
        max_history_points: 60,
    },
    gpuDataInitialized: false,

    COLORS: {
        CPU_BAR: '#ff6384',
        RAM_BAR: '#36a2eb',
        GPU_LOAD: '#4bc0c0', 
        GPU_VRAM: '#9966ff' 
    },

    init() {
        this.loadSettingsFromGlobalOrFetch();
        this.createMonitorElement();
        this.restoreState();
    },
    
    async loadSettingsFromGlobalOrFetch() {
        if (app.holafSettingsManager?.settingsData?.SystemMonitor) {
            this.config = app.holafSettingsManager.settingsData.SystemMonitor;
        }
        this.maxHistoryPoints = this.config.max_history_points || 60;
        this.chartData.labels = Array(this.maxHistoryPoints).fill("");
    },

    createMonitorElement() {
        if (this.monitorElement) return;

        // --- 1. MAIN WINDOW ---
        this.monitorElement = document.createElement("div");
        this.monitorElement.id = "holaf-system-monitor-overlay";
        
        Object.assign(this.monitorElement.style, {
            display: "none",
            position: "fixed",
            zIndex: "1000",
            top: "20px",
            right: "20px",
            width: "400px",
            height: "260px",
            minWidth: "250px", // Min limit only
            minHeight: "150px", // Min limit only
            // NO MAX LIMITS
            backgroundColor: "rgba(20, 20, 20, 0.95)",
            borderRadius: "10px",
            border: "1px solid var(--border-color, #555)",
            backdropFilter: "blur(4px)",
            fontFamily: "monospace",
            boxSizing: "border-box",
            overflow: "hidden" // Clip content
        });

        this.createDragHandle();
        this.createResizeHandle();

        // --- 2. HEADER (Fixed Height) ---
        // Contains CPU/RAM bars
        const headerHeight = 85; // px

        const headerContainer = document.createElement("div");
        headerContainer.id = "holaf-monitor-header";
        Object.assign(headerContainer.style, {
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            height: `${headerHeight}px`,
            padding: "12px 12px 0 12px",
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
                marginBottom: "3px", paddingRight: "30px"
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

        // --- 3. CHART CONTAINER (The Rest) ---
        const chartWrapper = document.createElement("div");
        chartWrapper.id = "holaf-monitor-chart-wrapper";
        Object.assign(chartWrapper.style, {
            position: "absolute",
            top: `${headerHeight}px`, // Starts where header ends
            left: "0",
            width: "100%",
            // MAGIC: Height is effectively 100% of parent minus the header.
            // This is handled by CSS engine, JS doesn't need to recalculate it.
            height: `calc(100% - ${headerHeight}px)`, 
            padding: "0 12px 12px 12px", // Padding for the chart inside
            boxSizing: "border-box",
            overflow: "hidden"
        });

        // The Canvas
        const chartCanvas = document.createElement("canvas");
        chartCanvas.id = "holaf-main-monitor-chart";
        // FORCE FULL SIZE
        chartCanvas.style.cssText = "width: 100% !important; height: 100% !important; display: block;";

        chartWrapper.appendChild(chartCanvas);

        this.monitorElement.appendChild(headerContainer);
        this.monitorElement.appendChild(chartWrapper);
        document.body.appendChild(this.monitorElement);

        // --- 4. RESIZE OBSERVER ---
        // Since we use calc(), the wrapper changes size automatically.
        // We just need to poke Chart.js to redraw when that happens.
        this.resizeObserver = new ResizeObserver(() => {
            if (this.mainChart) {
                this.mainChart.resize();
            }
        });
        this.resizeObserver.observe(chartWrapper);
    },

    createDragHandle() {
        this.dragHandle = document.createElement("div");
        Object.assign(this.dragHandle.style, {
            position: "absolute", top: "0", right: "0",
            width: "32px", height: "32px", cursor: "move",
            backgroundColor: "rgba(255, 255, 255, 0.1)", zIndex: "20",
            borderTopRightRadius: "10px", borderBottomLeftRadius: "10px",
            pointerEvents: "auto"
        });
        this.dragHandle.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" style="fill:white; margin:6px;"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"></path></svg>`;
        
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        this.dragHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = this.monitorElement.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            e.preventDefault();
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        const onMouseMove = (e) => {
            if (!isDragging) return;
            this.monitorElement.style.top = `${initialTop + (e.clientY - startY)}px`;
            this.monitorElement.style.left = `${initialLeft + (e.clientX - startX)}px`;
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.saveState();
            }
        };
        this.monitorElement.appendChild(this.dragHandle);
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
        let startX, startY, startW, startH;

        this.resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = this.monitorElement.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;
            e.preventDefault();
            e.stopPropagation();
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        const onMouseMove = (e) => {
            if (!isResizing) return;
            // Simple resize: Just change Main Window width/height.
            // CSS calc() handles the rest.
            const dx = e.clientX - startX; 
            const dy = e.clientY - startY;
            
            // Only Min limits, NO MAX LIMITS
            const newW = Math.max(250, startW + dx);
            const newH = Math.max(150, startH + dy);

            this.monitorElement.style.width = `${newW}px`;
            this.monitorElement.style.height = `${newH}px`;
        };

        const onMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.saveState();
                if(this.mainChart) this.mainChart.resize(); // Just in case
            }
        };
        this.monitorElement.appendChild(this.resizeHandle);
    },

    saveState() {
        if (!this.monitorElement) return;
        const rect = this.monitorElement.getBoundingClientRect();
        const state = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
        localStorage.setItem("holaf_monitor_state", JSON.stringify(state));
    },

    restoreState() {
        try {
            const saved = localStorage.getItem("holaf_monitor_state");
            if (saved && this.monitorElement) {
                const state = JSON.parse(saved);
                this.monitorElement.style.top = `${state.top}px`;
                this.monitorElement.style.left = `${state.left}px`;
                if (state.width) this.monitorElement.style.width = `${state.width}px`;
                if (state.height) this.monitorElement.style.height = `${state.height}px`;
            }
        } catch (e) {}
    },

    toggle() {
        this.isVisible = !this.isVisible;
        this.isVisible ? this.show() : this.hide();
        return this.isVisible;
    },

    show() {
        if (!this.monitorElement) this.createMonitorElement();
        this.monitorElement.style.display = "block";
        this.isVisible = true;
        this.gpuDataInitialized = false;
        
        this.initializeMainChart();
        this.connectWebSocket();
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
            maintainAspectRatio: false, // Critical for vertical stretch
            animation: false,
            interaction: { mode: 'none' },
            events: [],
            scales: {
                x: { display: false },
                y: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(255, 255, 255, 0.08)', drawBorder: false } }
            },
            plugins: {
                legend: { display: true, position: "bottom", labels: { boxWidth: 12, boxHeight: 12, padding: 15, font: { size: 12, weight: 'bold' }, color: "#ccc" } },
                tooltip: { enabled: false }
            },
            elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.2 } }
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
            this.chartData.datasets.push({
                id: `GPU_${gpu.id}_LOAD`, label: `GPU ${gpu.id} Load`,
                data: Array(this.maxHistoryPoints).fill(null),
                borderColor: this.COLORS.GPU_LOAD, backgroundColor: 'transparent',
                borderWidth: 2, pointRadius: 0, fill: false,
            });
            this.chartData.datasets.push({
                id: `GPU_${gpu.id}_VRAM`, label: `GPU ${gpu.id} VRAM`,
                data: Array(this.maxHistoryPoints).fill(null),
                borderColor: this.COLORS.GPU_VRAM, backgroundColor: 'transparent',
                borderWidth: 2, borderDash: [6, 6], pointRadius: 0, fill: false,
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
            if (dataset.data.length > this.maxHistoryPoints) dataset.data.shift();
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
                
                if(stats.gpus && this.gpuDataInitialized) {
                    stats.gpus.forEach(gpu => {
                        this.updateChartData(`GPU_${gpu.id}_LOAD`, gpu.utilization_percent);
                        let vramPercent = 0;
                        if (gpu.memory_total_mb > 0) {
                            vramPercent = (gpu.memory_used_mb / gpu.memory_total_mb) * 100;
                        }
                        this.updateChartData(`GPU_${gpu.id}_VRAM`, vramPercent);
                    });
                }
                if (this.mainChart) this.mainChart.update('none');
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