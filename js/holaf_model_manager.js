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
    modelTypesConfig: [], // Configuration lue depuis model_types.json
    modelCountsPerDisplayType: {}, // Compte des modèles par display_type réel
    selectedType: "All", 
    settings: {
        theme: 'Dark',
        panel_x: null,
        panel_y: null,
        panel_width: 700,
        panel_height: 500,
    },
    themes: [
        { name: 'Dark', className: 'holaf-theme-dark' },
        { name: 'Light', className: 'holaf-theme-light' }
    ],
    saveTimeout: null,

    async loadModelConfig() {
        if (this.modelTypesConfig.length > 0) return;
        try {
            const response = await fetch("/holaf/models/config");
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.modelTypesConfig = await response.json();
            this.modelTypesConfig.sort((a, b) => a.type.localeCompare(b.type)); 
            console.log("[Holaf ModelManager] Model config definitions loaded:", this.modelTypesConfig);
        } catch (e) {
            console.error("[Holaf ModelManager] Could not load or parse model configuration from '/holaf/models/config':", e);
            alert("Failed to load model configuration. Check console for details.");
        }
    },

    addMenuItem() {
        console.log("[Holaf ModelManager] addMenuItem called.");
        const dropdownMenu = document.getElementById("holaf-utilities-dropdown-menu");
        if (!dropdownMenu) {
            console.error("[Holaf ModelManager] CRITICAL: Could not find the main utilities dropdown menu even after HolafUtilitiesMenuReady was set. Check holaf_main.js.");
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

        dropdownMenu.appendChild(menuItem);
        console.log("[Holaf ModelManager] Menu item added.");
    },

    createPanel() {
        console.log("[Holaf ModelManager] createPanel called.");
        if (this.panelElements && this.panelElements.panelEl) {
            console.log("[Holaf ModelManager] Panel already exists, skipping creation.");
            return;
        }
        console.log("[Holaf ModelManager] Panel does not exist, proceeding with creation.");

        const managerHeaderControls = document.createElement("div");
        managerHeaderControls.className = "holaf-header-button-group";

        const themeButtonContainer = document.createElement("div");
        themeButtonContainer.style.position = 'relative';

        const themeButton = document.createElement("button");
        themeButton.className = "holaf-header-button";
        themeButton.title = "Change Theme";
        themeButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 12.55a9.42 9.42 0 0 1-9.45 9.45 9.42 9.42 0 0 1-9.45-9.45 9.42 9.42 0 0 1 9.45-9.45 2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 1-2.5 2.5Z"/></svg>`;

        const themeMenu = this.createThemeMenu();
        themeButton.onclick = (e) => {
            e.stopPropagation();
            themeMenu.style.display = themeMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', () => { if(themeMenu) themeMenu.style.display = 'none' });
        themeButtonContainer.append(themeButton, themeMenu);
        managerHeaderControls.appendChild(themeButtonContainer);

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-manager-panel",
                title: "Holaf Model Manager <span style='font-size:0.8em; color:#aaa;'>(WIP - Preview)</span>",
                headerContent: managerHeaderControls,
                defaultSize: { width: this.settings.panel_width, height: this.settings.panel_height },
                defaultPosition: { x: this.settings.panel_x, y: this.settings.panel_y },
                onClose: () => {
                    console.log("[Holaf ModelManager] Panel close button clicked.");
                },
                onStateChange: (newState) => {
                    this.settings.panel_x = newState.x;
                    this.settings.panel_y = newState.y;
                    this.settings.panel_width = newState.width;
                    this.settings.panel_height = newState.height;
                },
                onResize: () => {}
            });
            console.log("[Holaf ModelManager] PanelManager.createPanel call completed.");
        } catch (e) {
            console.error("[Holaf ModelManager] Error during HolafPanelManager.createPanel:", e);
            alert("[Holaf ModelManager] Error creating panel. Check console.");
            return;
        }

        this.setTheme(this.settings.theme);
        this.populatePanelContent();
        // populateModelTypes() est maintenant appelé DANS loadModels()
        console.log("[Holaf ModelManager] createPanel finished.");
    },

    createThemeMenu() {
        const menu = document.createElement("ul");
        menu.className = "holaf-theme-menu";
        this.themes.forEach(theme => {
            const item = document.createElement("li");
            item.textContent = theme.name;
            item.onclick = (e) => {
                e.stopPropagation();
                this.setTheme(theme.name);
                menu.style.display = 'none';
            };
            menu.appendChild(item);
        });
        return menu;
    },

    setTheme(themeName) {
        const themeConfig = this.themes.find(t => t.name === themeName);
        if (!themeConfig || !this.panelElements || !this.panelElements.panelEl) {
            console.warn(`[Holaf ModelManager] Theme '${themeName}' not found or panel not ready.`);
            return;
        }
        this.settings.theme = themeName;
        this.themes.forEach(t => this.panelElements.panelEl.classList.remove(t.className));
        this.panelElements.panelEl.classList.add(themeConfig.className);
        console.log(`[Holaf ModelManager] Theme set to: ${themeName}`);
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.innerHTML = `
            <div class="holaf-manager-toolbar" style="flex-wrap: wrap;">
                <div style="display: flex; gap: 8px; align-items: center; flex-grow: 1; min-width: 250px;">
                    <select id="holaf-manager-type-select" class="holaf-manager-search" style="flex-grow: 0.5;"></select>
                    <input type="text" id="holaf-manager-search-input" class="holaf-manager-search" placeholder="Search models..." style="flex-grow: 1;">
                </div>
                <div id="holaf-manager-button-group" style="display: flex; gap: 4px; align-items: center;">
                    <button class="comfy-button" title="Placeholder 1">B1</button>
                    <button class="comfy-button" title="Placeholder 2">B2</button>
                    <button class="comfy-button" title="Placeholder 3">B3</button>
                    <button class="comfy-button" title="Placeholder 4">B4</button>
                    <button class="comfy-button" title="Placeholder 5">B5</button>
                </div>
            </div>
            <div id="holaf-manager-models-area" class="holaf-manager-content">
                <p class="holaf-manager-message">Initializing...</p>
            </div>
            <div id="holaf-manager-statusbar" class="holaf-manager-statusbar">
                Status: Ready
            </div>
        `;

        document.getElementById("holaf-manager-type-select").onchange = (e) => this.filterModels();
        document.getElementById("holaf-manager-search-input").oninput = (e) => this.filterModels();
    },

    populateModelTypes() {
        const selectEl = document.getElementById("holaf-manager-type-select");
        if (!selectEl) {
            console.error("[Holaf ModelManager] Type select element not found in populateModelTypes.");
            return;
        }

        selectEl.innerHTML = `<option value="All">All Model Types</option>`; 

        const displayTypesFromModels = Object.keys(this.modelCountsPerDisplayType).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        let hasOtherCategoryModels = false;

        displayTypesFromModels.forEach(displayType => {
            if (this.modelCountsPerDisplayType[displayType] > 0) {
                if (displayType.startsWith("Autres (")) {
                    hasOtherCategoryModels = true; 
                } else {
                    const option = document.createElement("option");
                    option.value = displayType; 
                    option.textContent = `${displayType} (${this.modelCountsPerDisplayType[displayType]})`;
                    selectEl.appendChild(option);
                }
            }
        });

        if (hasOtherCategoryModels) {
            const otherCount = Object.entries(this.modelCountsPerDisplayType)
                .filter(([type, count]) => type.startsWith("Autres (") && count > 0)
                .reduce((sum, [, count]) => sum + count, 0);
            
            if (otherCount > 0) {
                const option = document.createElement("option");
                option.value = "Holaf--Category--Others"; 
                option.textContent = `Autres (${otherCount})`;
                selectEl.appendChild(option); // Add "Autres" at the end for now
            }
        }
    },

    async loadModels() {
        if (this.isLoading) return;
        this.isLoading = true;
        const modelsArea = document.getElementById("holaf-manager-models-area");
        const statusBar = document.getElementById("holaf-manager-statusbar");

        if (modelsArea) modelsArea.innerHTML = `<p class="holaf-manager-message">Loading models...</p>`;
        if (statusBar) statusBar.textContent = "Status: Loading...";
        this.models = []; 
        this.modelCountsPerDisplayType = {}; 

        try {
            const response = await fetch("/holaf/models");
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            this.models = await response.json();

            this.models.forEach(model => {
                const dtype = model.display_type || "Undefined"; 
                this.modelCountsPerDisplayType[dtype] = (this.modelCountsPerDisplayType[dtype] || 0) + 1;
            });
            
            this.populateModelTypes(); // Update dropdown AFTER models and counts are known
            this.filterModels(); 
            
            if (statusBar) statusBar.textContent = `Status: ${this.models.length} models loaded.`;
        } catch (error) {
            console.error("[Holaf ModelManager] Error loading models:", error);
            if (modelsArea) modelsArea.innerHTML = `<p class="holaf-manager-message error">Error loading models: ${error.message}</p>`;
            if (statusBar) statusBar.textContent = "Status: Error loading models.";
        } finally {
            this.isLoading = false;
        }
    },

    renderModels(modelsToRender) {
        const modelsArea = document.getElementById("holaf-manager-models-area");
        if (!modelsArea) return;
        modelsArea.innerHTML = '';

        if (modelsToRender.length === 0) {
            modelsArea.innerHTML = `<p class="holaf-manager-message">No models match your criteria.</p>`;
            return;
        }

        modelsToRender.forEach(model => {
            const card = document.createElement("div");
            card.className = "holaf-model-card";
            const sizeMB = (model.size_bytes / (1024 * 1024)).toFixed(2);
            card.innerHTML = `
                <span class="holaf-model-name" title="${model.path}">${model.name}</span>
                <div class="holaf-model-info">
                    <span class="holaf-model-type">${model.display_type}</span>
                    <span class="holaf-model-size">${sizeMB} MB</span>
                </div>
            `;
            modelsArea.appendChild(card);
        });
    },

    filterModels() {
        const typeSelect = document.getElementById("holaf-manager-type-select");
        const searchInput = document.getElementById("holaf-manager-search-input");
        const statusBar = document.getElementById("holaf-manager-statusbar");

        const selectedTypeFilterValue = typeSelect ? typeSelect.value : "All";
        const searchText = searchInput ? searchInput.value.toLowerCase() : "";

        const filteredModels = this.models.filter(model => {
            let typeMatch = false;
            if (selectedTypeFilterValue === "All") {
                typeMatch = true;
            } else if (selectedTypeFilterValue === "Holaf--Category--Others") {
                typeMatch = model.display_type && model.display_type.startsWith("Autres (");
            } else {
                // Direct match for specific display_types (e.g., "Checkpoints", "LoRAs")
                typeMatch = (model.display_type === selectedTypeFilterValue);
            }
            
            const textMatch = (model.name.toLowerCase().includes(searchText));
            return typeMatch && textMatch;
        });
        
        this.renderModels(filteredModels);
        
        if (statusBar) {
            const totalShown = filteredModels.length;
            const totalAvailable = this.models.length;
            if (totalShown === totalAvailable && selectedTypeFilterValue === "All" && searchText === "") {
                 statusBar.textContent = `Status: ${totalAvailable} models loaded.`;
            } else {
                 statusBar.textContent = `Status: Displaying ${totalShown} of ${totalAvailable} models.`;
            }
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
            this.panelElements.panelEl.style.display = "none";
        } else {
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl);
            // Load models only if not initialized, or if explicitly requested by a refresh button later
            if (!this.isInitialized) { 
                this.loadModels(); // This will also call populateModelTypes
                this.isInitialized = true;
            } else {
                // If already initialized, ensure dropdown is up-to-date in case models changed via external means
                // and a refresh mechanism isn't implemented yet. For now, this is okay.
                // this.populateModelTypes(); // Peut-être pas nécessaire ici si on ne recharge pas les modèles.
            }
        }
        console.log("[Holaf ModelManager] show finished.");
    },

    applySettings() {
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
        }
    }
};

app.registerExtension({
    name: "Holaf.ModelManager.Panel",
    setup() {
        console.log("[Holaf ModelManager] Extension setup() called.");
        
        const addMenuItemWhenReady = () => {
            if (window.HolafUtilitiesMenuReady) {
                holafModelManager.addMenuItem();
            } else {
                setTimeout(addMenuItemWhenReady, 100);
            }
        };
        addMenuItemWhenReady();
        
        holafModelManager.loadModelConfig(); // Charge les définitions des types depuis model_types.json
        // Note: loadModels() (qui appelle populateModelTypes) est appelé la première fois que le panel est montré.
    },
});

export default holafModelManager;