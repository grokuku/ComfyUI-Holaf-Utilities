/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - System Monitor
 *
 * This script displays a real-time system monitor overlay (CPU, RAM, GPU).
 * MODIFIED: Superimposed CPU, RAM, GPU charts into a single canvas.
 *           Added dynamic dataset addition for GPUs to the main chart.
 *           Ensured legend is active and configured for multiple datasets.
 *           Separated textual display of stats from the chart.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import "./chart.min.js"; // Import Chart.js

const HolafSystemMonitor = {
    name: "Holaf.SystemMonitor",
    isVisible: false,
    ws: null,
    monitorElement: null,
    mainChart: null, // Single chart instance
    chartData: { // Unified data for the main chart
        labels: [],
        datasets: []
    },
    maxHistoryPoints: 60,
    config: {
        update_interval_ms: 1500,
        max_history_points: 60,
    },
    gpuDataInitialized: false,

    // Define colors for different metrics
    METRIC_COLORS: {
        CPU: 'rgba(255, 99, 132, 1)',  // Red-ish
        RAM: 'rgba(54, 162, 235, 1)',  // Blue-ish
        GPU_0: 'rgba(75, 192, 192, 1)', // Teal
        GPU_1: 'rgba(255, 206, 86, 1)', // Yellow
        GPU_2: 'rgba(153, 102, 255, 1)',// Purple
        GPU_3: 'rgba(255, 159, 64, 1)'  // Orange
    },

    init() {
        this.loadSettingsFromGlobalOrFetch();
        this.createMonitorElement();
    },
    
    async loadSettingsFromGlobalOrFetch() {
        // ... (existing code for loading settings - unchanged)
        if (app.holafSettingsManager && app.holafSettingsManager.settingsData && app.holafSettingsManager.settingsData.SystemMonitor) {
            this.config = app.holafSettingsManager.settingsData.SystemMonitor;
            this.maxHistoryPoints = this.config.max_history_points || 60;
            console.log("[Holaf Monitor] Loaded settings from global SettingsManager.", this.config);
        } else {
            try {
                const response = await api.fetchApi("/holaf/utilities/settings");
                if (response.ok) {
                    const allSettings = await response.json();
                    if (allSettings.SystemMonitor) {
                        this.config = allSettings.SystemMonitor;
                        this.maxHistoryPoints = this.config.max_history_points || 60;
                        console.log("[Holaf Monitor] Fetched settings for monitor.", this.config);
                    }
                }
            } catch (e) {
                console.error("[Holaf Monitor] Could not fetch settings for monitor.", e);
            }
        }
        // Initialize chart labels based on maxHistoryPoints
        this.chartData.labels = Array(this.maxHistoryPoints).fill("");
    },

    createMonitorElement() {
        if (this.monitorElement) return;

        this.monitorElement = document.createElement("div");
        this.monitorElement.id = "holaf-system-monitor-overlay";
        this.monitorElement.style.display = "none"; // Initially hidden

        // Container for textual stats (CPU, RAM, GPUs)
        const statsTextContainer = document.createElement("div");
        statsTextContainer.id = "holaf-monitor-stats-text-container";
        // Basic styling, will be refined in CSS
        statsTextContainer.style.display = "flex";
        statsTextContainer.style.flexWrap = "wrap"; // Allow text stats to wrap
        statsTextContainer.style.gap = "5px 10px"; // Spacing between stat items
        statsTextContainer.style.paddingBottom = "5px";

        statsTextContainer.innerHTML = `
            <div class="holaf-monitor-stat-item" id="holaf-monitor-cpu-text">CPU: <span class="value">0%</span></div>
            <div class="holaf-monitor-stat-item" id="holaf-monitor-ram-text">RAM: <span class="value">0% (0/0 GB)</span></div>
        `; // GPU text stats will be added dynamically here

        // Single canvas for the combined chart
        const chartCanvas = document.createElement("canvas");
        chartCanvas.id = "holaf-main-monitor-chart";
        chartCanvas.style.minHeight = "60px"; // Ensure canvas has some height

        this.monitorElement.appendChild(statsTextContainer);
        this.monitorElement.appendChild(chartCanvas);
        document.body.appendChild(this.monitorElement);
    },

    toggle() {
        this.isVisible = !this.isVisible;
        if (this.isVisible) {
            this.show();
        } else {
            this.hide();
        }
        return this.isVisible;
    },

    show() {
        if (!this.monitorElement) this.createMonitorElement();
        this.monitorElement.style.display = "flex"; // Changed from block to flex for overlay
        this.isVisible = true;
        this.gpuDataInitialized = false; // Reset GPU init flag
        this.initializeMainChart();
        this.connectWebSocket();
    },

    hide() {
        if (this.monitorElement) {
            this.monitorElement.style.display = "none";
        }
        this.isVisible = false;
        this.disconnectWebSocket(); // This will also destroy the chart
    },

    initializeMainChart() {
        if (this.mainChart) {
            this.mainChart.destroy();
            this.mainChart = null;
        }
        this.chartData.datasets = []; // Clear previous datasets

        // Add initial datasets for CPU and RAM
        this.addDataset("CPU", "CPU Usage (%)", this.METRIC_COLORS.CPU);
        this.addDataset("RAM", "RAM Usage (%)", this.METRIC_COLORS.RAM);

        const ctx = document.getElementById("holaf-main-monitor-chart").getContext("2d");
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    display: false,
                    ticks: { display: false },
                    grid: { display: false }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: { display: false, stepSize: 25 },
                    grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false }
                }
            },
            plugins: {
                legend: { 
                    display: true, 
                    position: "top", 
                    align: "end", 
                    labels: { 
                        boxWidth: 10, 
                        boxHeight: 1, // Make legend box thinner, more like a line
                        padding: 5, 
                        font: { size: 9 }, 
                        color: "#E0E0E0" 
                    } 
                },
                tooltip: { enabled: false }
            },
            elements: {
                point: { radius: 0 },
                line: { borderWidth: 1.5, tension: 0.3 }
            }
        };
        
        this.mainChart = new Chart(ctx, {
            type: "line",
            data: this.chartData,
            options: chartOptions,
        });
    },

    addDataset(id, label, color) {
        const newDataset = {
            id: id, // Custom ID to find dataset later
            label: label,
            data: Array(this.maxHistoryPoints).fill(null),
            borderColor: color,
            backgroundColor: 'transparent',
            fill: false,
        };
        this.chartData.datasets.push(newDataset);
        if (this.mainChart) {
            this.mainChart.update('none');
        }
    },

    initializeGpuDatasets(gpuStatsArray) {
        if (!this.monitorElement || this.gpuDataInitialized) return;

        const statsTextContainer = document.getElementById("holaf-monitor-stats-text-container");
        // Clear any previous GPU text stat elements
        statsTextContainer.querySelectorAll('.holaf-monitor-gpu-stat-item').forEach(el => el.remove());

        gpuStatsArray.forEach((gpu, index) => {
            const gpuId = `GPU_${gpu.id}`;
            const gpuColor = this.METRIC_COLORS[gpuId] || this.METRIC_COLORS[`GPU_${index % 4}`]; // Fallback color

            // Add dataset for GPU utilization if it doesn't exist
            if (!this.chartData.datasets.find(ds => ds.id === gpuId)) {
                this.addDataset(gpuId, `GPU ${gpu.id} Util (%)`, gpuColor);
            }

            // Add text display element for this GPU
            const gpuStatTextEl = document.createElement("div");
            gpuStatTextEl.className = "holaf-monitor-stat-item holaf-monitor-gpu-stat-item";
            gpuStatTextEl.id = `holaf-monitor-gpu${gpu.id}-text`;
            gpuStatTextEl.innerHTML = `GPU ${gpu.id}: <span class="util-value">0%</span> | <span class="mem-value">0/0MB</span> | <span class="temp-value">0°C</span>`;
            statsTextContainer.appendChild(gpuStatTextEl);
        });
        
        this.gpuDataInitialized = true;
        if (this.mainChart) {
            this.mainChart.update('none'); // Update chart with new datasets
        }
    },

    updateChartData(datasetId, newValue) {
        if (!this.mainChart) return;
        const dataset = this.chartData.datasets.find(ds => ds.id === datasetId);
        if (dataset) {
            dataset.data.push(newValue);
            if (dataset.data.length > this.maxHistoryPoints) {
                dataset.data.shift();
            }
        }
        // Batch updates: Chart is updated once after all data processing in onmessage
    },

    updateDisplayValues(stats) {
        if (!this.monitorElement) return;

        const cpuTextEl = this.monitorElement.querySelector("#holaf-monitor-cpu-text .value");
        if (cpuTextEl) cpuTextEl.textContent = `${stats.cpu_percent.toFixed(1)}%`;

        const ramTextEl = this.monitorElement.querySelector("#holaf-monitor-ram-text .value");
        if (ramTextEl) ramTextEl.textContent = `${stats.ram.percent.toFixed(1)}% (${stats.ram.used_gb.toFixed(1)}/${stats.ram.total_gb.toFixed(1)} GB)`;

        stats.gpus.forEach(gpu => {
            const gpuStatTextEl = this.monitorElement.querySelector(`#holaf-monitor-gpu${gpu.id}-text`);
            if (gpuStatTextEl) {
                const utilValueEl = gpuStatTextEl.querySelector(".util-value");
                if (utilValueEl) utilValueEl.textContent = `${gpu.utilization_percent !== null ? gpu.utilization_percent.toFixed(1) : 'N/A'}%`;
                
                const memValueEl = gpuStatTextEl.querySelector(".mem-value");
                if (memValueEl && gpu.memory_used_mb !== null && gpu.memory_total_mb !== null) {
                     memValueEl.textContent = `${gpu.memory_used_mb.toFixed(0)}/${gpu.memory_total_mb.toFixed(0)}MB`;
                } else if (memValueEl) {
                    memValueEl.textContent = `N/A`;
                }

                const tempValueEl = gpuStatTextEl.querySelector(".temp-value");
                if (tempValueEl) tempValueEl.textContent = `${gpu.temperature_c !== null ? gpu.temperature_c.toFixed(0) : 'N/A'}°C`;
            }
        });
    },

    connectWebSocket() {
        // ... (existing code for connectWebSocket - largely unchanged header)
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }
        if (this.ws) { 
            this.ws.close();
        }

        const url = new URL("/holaf/monitor/ws", api.api_base);
        url.protocol = url.protocol.replace("http", "ws"); 
        this.ws = new WebSocket(url.toString());

        this.ws.onopen = () => {
            console.log("[Holaf Monitor] WebSocket connected.");
        };

        this.ws.onmessage = (event) => {
            try {
                const stats = JSON.parse(event.data);

                if (stats.gpus && stats.gpus.length > 0 && !this.gpuDataInitialized) {
                    this.initializeGpuDatasets(stats.gpus);
                }
                
                this.updateChartData("CPU", stats.cpu_percent);
                this.updateChartData("RAM", stats.ram.percent);
                
                if(stats.gpus) {
                    stats.gpus.forEach(gpu => {
                        // Ensure dataset exists, sometimes initializeGpuDatasets might be slightly delayed
                        const gpuDatasetId = `GPU_${gpu.id}`;
                         if (!this.chartData.datasets.find(ds => ds.id === gpuDatasetId) && this.gpuDataInitialized) {
                             // This case should ideally not happen if initializeGpuDatasets runs first
                             console.warn(`[Holaf Monitor] GPU dataset ${gpuDatasetId} not found, attempting re-init.`);
                             this.initializeGpuDatasets(stats.gpus); // Try to re-init if missed
                         }
                        this.updateChartData(gpuDatasetId, gpu.utilization_percent);
                    });
                }
                
                this.updateDisplayValues(stats);

                if (this.mainChart) {
                    this.mainChart.update('none'); // Single update after all data processed
                }

            } catch (e) {
                console.error("[Holaf Monitor] Error processing WebSocket message:", e, event.data);
            }
        };

        this.ws.onclose = () => {
            console.log("[Holaf Monitor] WebSocket disconnected.");
            // Chart is destroyed on hide or explicit disconnect
        };

        this.ws.onerror = (error) => {
            console.error("[Holaf Monitor] WebSocket error:", error);
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
        this.chartData.datasets = []; // Clear datasets
        this.gpuDataInitialized = false; // Reset flag
        
        // Clear dynamic GPU text stat elements from DOM
        if (this.monitorElement) {
            const statsTextContainer = document.getElementById("holaf-monitor-stats-text-container");
            if (statsTextContainer) {
                 statsTextContainer.querySelectorAll('.holaf-monitor-gpu-stat-item').forEach(el => el.remove());
            }
        }
    },
};

app.registerExtension({
    name: HolafSystemMonitor.name,
    async setup() {
         setTimeout(() => HolafSystemMonitor.init(), 200);
        app.holafSystemMonitor = HolafSystemMonitor;
    },
});