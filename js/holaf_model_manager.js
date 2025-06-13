/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Model Manager UI
 *
 * This script provides the client-side logic for the Holaf Model Manager.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";

const holafModelManager = {
    panelElements: null,
    isInitialized: false,
    isLoading: false,
    models: [],
    settings: {
        panel_x: null,
        panel_y: null,
        panel_width: 700,
        panel_height: 500,
    },
    saveTimeout: null,

    addMenuItem() {
        console.log("[Holaf ModelManager] addMenuItem called.");
        const dropdownMenu = document.getElementById("holaf-utilities-dropdown-menu");
        if (!dropdownMenu) {
            console.error("[Holaf ModelManager] Could not find the main utilities dropdown menu. Retrying...");
            setTimeout(() => this.addMenuItem(), 500);
            return;
        }

        const menuItem = document.createElement("li");
        menuItem.textContent = "Model Manager";
        menuItem.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            color: var(--fg-color, #ccc);
        `;
        menuItem.onmouseover = () => { menuItem.style.backgroundColor = 'var(--comfy-menu-item-bg-hover, #D84315)'; };
        menuItem.onmouseout = () => { menuItem.style.backgroundColor = 'transparent'; };

        menuItem.onclick = () => {
            console.log("[Holaf ModelManager] Model Manager menu item clicked.");
            this.show();
            dropdownMenu.style.display = "none";
        };

        const terminalMenuItem = Array.from(dropdownMenu.children).find(child => child.textContent === "Terminal");
        if (terminalMenuItem && terminalMenuItem.nextSibling) {
            dropdownMenu.insertBefore(menuItem, terminalMenuItem.nextSibling);
        } else if (terminalMenuItem) {
            dropdownMenu.appendChild(menuItem);
        } else {
            dropdownMenu.prepend(menuItem);
        }
        console.log("[Holaf ModelManager] Menu item added.");
    },

    createPanel() {
        console.log("[Holaf ModelManager] createPanel called.");
        if (this.panelElements && this.panelElements.panelEl) {
            console.log("[Holaf ModelManager] Panel already exists, skipping creation.");
            return;
        }
        console.log("[Holaf ModelManager] Panel does not exist, proceeding with creation.");

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-manager-panel",
                title: "Holaf Model Manager <span style='font-size:0.8em; color:#aaa;'>(WIP - Preview)</span>", // MODIFIED
                defaultSize: { width: this.settings.panel_width, height: this.settings.panel_height },
                defaultPosition: { x: this.settings.panel_x, y: this.settings.panel_y },
                onClose: () => {
                    console.log("[Holaf ModelManager] Panel close button clicked.");
                },
                onStateChange: (newState) => {
                    console.log("[Holaf ModelManager] onStateChange triggered by PanelManager:", newState);
                    this.settings.panel_x = newState.x;
                    this.settings.panel_y = newState.y;
                    this.settings.panel_width = newState.width;
                    this.settings.panel_height = newState.height;
                },
                onResize: () => {
                    console.log("[Holaf ModelManager] onResize triggered by PanelManager.");
                }
            });
            console.log("[Holaf ModelManager] PanelManager.createPanel call completed. Panel elements:", this.panelElements);
        } catch (e) {
            console.error("[Holaf ModelManager] Error during HolafPanelManager.createPanel:", e);
            alert("[Holaf ModelManager] Error creating panel. Check console.");
            return;
        }

        this.populatePanelContent();
        console.log("[Holaf ModelManager] createPanel finished.");
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.innerHTML = `
            <div class="holaf-manager-toolbar">
                <input type="text" id="holaf-manager-search-input" class="holaf-manager-search" placeholder="Search models...">
                <button id="holaf-manager-refresh-button" class="comfy-button">Refresh</button> 
            </div>
            <div id="holaf-manager-models-area" class="holaf-manager-content">
                <p class="holaf-manager-message">Initializing...</p>
            </div>
            <div id="holaf-manager-statusbar" class="holaf-manager-statusbar">
                Status: Ready
            </div>
        `;

        document.getElementById("holaf-manager-refresh-button").onclick = () => this.loadModels();
        document.getElementById("holaf-manager-search-input").oninput = (e) => this.filterModels(e.target.value);
    },

    async loadModels() {
        if (this.isLoading) {
            console.log("[Holaf ModelManager] Already loading models.");
            return;
        }
        this.isLoading = true;
        const modelsArea = document.getElementById("holaf-manager-models-area");
        const statusBar = document.getElementById("holaf-manager-statusbar");

        if (modelsArea) modelsArea.innerHTML = `<p class="holaf-manager-message">Loading models...</p>`;
        if (statusBar) statusBar.textContent = "Status: Loading...";

        try {
            const response = await fetch("/holaf/models");
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.models = await response.json();
            this.renderModels();
            if (statusBar) statusBar.textContent = `Status: ${this.models.length} models loaded.`;
            console.log("[Holaf ModelManager] Models loaded:", this.models.length);
        } catch (error) {
            console.error("[Holaf ModelManager] Error loading models:", error);
            if (modelsArea) modelsArea.innerHTML = `<p class="holaf-manager-message error">Error loading models: ${error.message}</p>`;
            if (statusBar) statusBar.textContent = "Status: Error loading models.";
        } finally {
            this.isLoading = false;
        }
    },

    renderModels(filterText = "") {
        const modelsArea = document.getElementById("holaf-manager-models-area");
        if (!modelsArea) return;

        modelsArea.innerHTML = '';

        const filteredModels = this.models.filter(model =>
            model.name.toLowerCase().includes(filterText.toLowerCase()) ||
            model.type.toLowerCase().includes(filterText.toLowerCase())
        );

        if (filteredModels.length === 0) {
            modelsArea.innerHTML = `<p class="holaf-manager-message">${filterText ? 'No models match your search.' : 'No models found.'}</p>`;
            return;
        }

        filteredModels.forEach(model => {
            const card = document.createElement("div");
            card.className = "holaf-model-card";

            const sizeMB = (model.size_bytes / (1024 * 1024)).toFixed(2);

            card.innerHTML = `
                <span class="holaf-model-name" title="${model.path}">${model.name}</span>
                <div class="holaf-model-info">
                    <span class="holaf-model-type">${model.type}</span>
                    <span class="holaf-model-size">${sizeMB} MB</span>
                </div>
            `;
            modelsArea.appendChild(card);
        });
    },

    filterModels(searchText) {
        this.renderModels(searchText);
        const statusBar = document.getElementById("holaf-manager-statusbar");
        const modelsArea = document.getElementById("holaf-manager-models-area");
        if (statusBar && modelsArea) { // modelsArea check added
            const count = modelsArea.getElementsByClassName("holaf-model-card").length;
            statusBar.textContent = `Status: Displaying ${count} of ${this.models.length} models.`;
        }
    },

    show() {
        console.log("[Holaf ModelManager] show called.");
        if (!this.panelElements || !this.panelElements.panelEl) {
            console.log("[Holaf ModelManager] Panel not created or panelEl missing. Calling createPanel().");
            this.createPanel();
            if (!this.panelElements || !this.panelElements.panelEl) {
                console.error("[Holaf ModelManager] Panel creation FAILED in show(). Aborting show.");
                return;
            }
        }

        this.applySettings();

        const panelIsVisible = this.panelElements.panelEl.style.display === "flex";

        if (panelIsVisible) {
            console.log("[Holaf ModelManager] Panel already visible. Hiding it.");
            this.panelElements.panelEl.style.display = "none";
        } else {
            console.log("[Holaf ModelManager] Setting panel display to flex.");
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl); // Bring to front when shown
            if (!this.isInitialized) {
                this.loadModels();
                this.isInitialized = true;
            }
        }
        console.log("[Holaf ModelManager] show finished.");
    },

    applySettings() {
        console.log("[Holaf ModelManager] applySettings called with current settings:", JSON.parse(JSON.stringify(this.settings)));
        if (this.panelElements && this.panelElements.panelEl) {
            this.panelElements.panelEl.style.width = `${this.settings.panel_width}px`;
            this.panelElements.panelEl.style.height = `${this.settings.panel_height}px`;

            if (this.settings.panel_x !== null && this.settings.panel_y !== null) {
                this.panelElements.panelEl.style.left = `${this.settings.panel_x}px`;
                this.panelElements.panelEl.style.top = `${this.settings.panel_y}px`;
                this.panelElements.panelEl.style.transform = 'none';
            } else {
                this.panelElements.panelEl.style.left = `50%`;
                this.panelElements.panelEl.style.top = `50%`;
                this.panelElements.panelEl.style.transform = 'translate(-50%, -50%)';
            }
            console.log("[Holaf ModelManager] Panel dimensions and position applied from settings.");
        } else {
            console.log("[Holaf ModelManager] applySettings: panelElements not ready.");
        }
    }
};

app.registerExtension({
    name: "Holaf.ModelManager.Panel",
    async setup() {
        console.log("[Holaf ModelManager] Extension setup() called.");
        holafModelManager.addMenuItem();
    },
});

export default holafModelManager;