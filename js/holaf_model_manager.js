/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Model Manager UI
 *
 * This script provides the client-side logic for the Holaf Model Manager.
 * MODIFIED: Added model family display and sorting.
 * MODIFIED: Added "Deep Scan (Local)" button and functionality.
 * MODIFIED: Added saving/loading of panel state (size, pos, theme, filters, sort) to config.ini.
 * MODIFIED: Added zoom controls and saving of zoom level.
 * MODIFIED: Unified theme management using HOLAF_THEMES from holaf_panel_manager.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";

const holafModelManager = {
    panelElements: null,
    isInitialized: false,
    areSettingsLoaded: false,
    isLoading: false,
    isDeepScanning: false,
    isDownloading: false, // New state for download
    models: [],
    modelTypesConfig: [],
    modelCountsPerDisplayType: {},
    selectedModelPaths: new Set(),
    settings: {
        theme: HOLAF_THEMES[0].name, // Default to the first theme in the shared list
        panel_x: null,
        panel_y: null,
        panel_width: 800,
        panel_height: 550,
        filter_type: "All",
        filter_search_text: "",
        sort_column: 'name',
        sort_order: 'asc',
        zoom_level: 1.0,
    },
    currentSort: { column: 'name', order: 'asc' },
    saveSettingsTimeout: null,
    MIN_ZOOM: 0.7,
    MAX_ZOOM: 1.5,
    ZOOM_STEP: 0.1,

    async loadModelConfigAndSettings() {
        if (this.modelTypesConfig.length === 0) {
            try {
                const response = await fetch("/holaf/models/config");
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                this.modelTypesConfig = await response.json();
                this.modelTypesConfig.sort((a, b) => a.type.localeCompare(b.type));
                console.log("[Holaf ModelManager] Model config definitions loaded:", this.modelTypesConfig);
            } catch (e) {
                console.error("[Holaf ModelManager] Could not load model type config:", e);
            }
        }

        if (!this.areSettingsLoaded) {
            try {
                const response = await fetch("/holaf/utilities/settings");
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const allSettings = await response.json();
                if (allSettings.ui_model_manager_settings) {
                    const fetchedMMSettings = allSettings.ui_model_manager_settings;

                    const validTheme = HOLAF_THEMES.find(t => t.name === fetchedMMSettings.theme);

                    this.settings = {
                        ...this.settings,
                        ...fetchedMMSettings,
                        theme: validTheme ? fetchedMMSettings.theme : HOLAF_THEMES[0].name,
                        panel_x: fetchedMMSettings.panel_x !== null && !isNaN(parseInt(fetchedMMSettings.panel_x)) ? parseInt(fetchedMMSettings.panel_x) : null,
                        panel_y: fetchedMMSettings.panel_y !== null && !isNaN(parseInt(fetchedMMSettings.panel_y)) ? parseInt(fetchedMMSettings.panel_y) : null,
                        panel_width: parseInt(fetchedMMSettings.panel_width) || this.settings.panel_width,
                        panel_height: parseInt(fetchedMMSettings.panel_height) || this.settings.panel_height,
                        zoom_level: parseFloat(fetchedMMSettings.zoom_level) || this.settings.zoom_level,
                    };

                    this.settings.zoom_level = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.settings.zoom_level));

                    this.currentSort.column = this.settings.sort_column || 'name';
                    this.currentSort.order = this.settings.sort_order || 'asc';
                    this.areSettingsLoaded = true;
                    console.log("[Holaf ModelManager] UI settings loaded:", this.settings);
                }
            } catch (e) {
                console.error("[Holaf ModelManager] Could not load UI settings from server. Using defaults.", e);
            }
        }
    },

    saveSettings() {
        clearTimeout(this.saveSettingsTimeout);
        this.saveSettingsTimeout = setTimeout(async () => {
            const settingsToSave = {
                theme: this.settings.theme,
                panel_x: this.settings.panel_x,
                panel_y: this.settings.panel_y,
                panel_width: this.settings.panel_width,
                panel_height: this.settings.panel_height,
                filter_type: document.getElementById("holaf-manager-type-select")?.value || this.settings.filter_type,
                filter_search_text: document.getElementById("holaf-manager-search-input")?.value || this.settings.filter_search_text,
                sort_column: this.currentSort.column,
                sort_order: this.currentSort.order,
                zoom_level: this.settings.zoom_level,
            };
            try {
                const response = await fetch('/holaf/model-manager/save-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settingsToSave)
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: "Unknown error saving MM settings" }));
                    console.error("[Holaf ModelManager] Failed to save settings. Status:", response.status, "Msg:", errorData.message);
                } else {
                    console.log("[Holaf ModelManager] Settings saved to server.");
                }
            } catch (e) {
                console.error("[Holaf ModelManager] Exception during saveSettings fetch for Model Manager:", e);
            }
        }, 1000);
    },

    ensureMenuItemAdded() {
        const menuId = "holaf-utilities-dropdown-menu";
        let dropdownMenu = document.getElementById(menuId);

        if (!dropdownMenu) {
            const mainButton = document.getElementById("holaf-utilities-menu-button");
            if (mainButton && typeof window.HolafUtilitiesMenu !== 'undefined' && window.HolafUtilitiesMenu.dropdownMenuEl) {
                dropdownMenu = window.HolafUtilitiesMenu.dropdownMenuEl;
            } else {
                console.warn("[Holaf ModelManager] Main utilities menu not found yet. Deferring menu item addition.");
                setTimeout(() => this.ensureMenuItemAdded(), 200);
                return;
            }
        }

        const existingItem = Array.from(dropdownMenu.children).find(
            li => li.textContent === "Model Manager"
        );
        if (existingItem) {
            return;
        }

        const menuItem = document.createElement("li");
        menuItem.textContent = "Model Manager";
        menuItem.style.cssText = ` 
            padding: 8px 12px;
            cursor: pointer;
            color: var(--fg-color, #ccc); 
        `;

        menuItem.onclick = async () => {
            if (!this.areSettingsLoaded) {
                await this.loadModelConfigAndSettings();
            }
            this.show();
            if (dropdownMenu) dropdownMenu.style.display = "none";
        };

        dropdownMenu.appendChild(menuItem);
        console.log("[Holaf ModelManager] Menu item added to dropdown.");
    },


    createPanel() {
        console.log("[Holaf ModelManager] createPanel called.");
        if (this.panelElements && this.panelElements.panelEl) {
            console.log("[Holaf ModelManager] Panel already exists, applying current settings.");
            this.applySettingsToPanel();
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
        document.addEventListener('click', () => { if (themeMenu) themeMenu.style.display = 'none' });
        themeButtonContainer.append(themeButton, themeMenu);

        const zoomOutButton = document.createElement("button");
        zoomOutButton.className = "holaf-header-button";
        zoomOutButton.title = "Zoom Out";
        zoomOutButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        zoomOutButton.onclick = () => this.decreaseZoom();

        const zoomInButton = document.createElement("button");
        zoomInButton.className = "holaf-header-button";
        zoomInButton.title = "Zoom In";
        zoomInButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        zoomInButton.onclick = () => this.increaseZoom();

        managerHeaderControls.append(themeButtonContainer, zoomOutButton, zoomInButton);

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-manager-panel",
                title: "Holaf Model Manager",
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
                    this.saveSettings();
                },
                onResize: () => { }
            });
            console.log("[Holaf ModelManager] PanelManager.createPanel call completed.");
        } catch (e) {
            console.error("[Holaf ModelManager] Error during HolafPanelManager.createPanel:", e);
            alert("[Holaf ModelManager] Error creating panel. Check console.");
            return;
        }

        this.populatePanelContent();
        this.applySettingsToPanel();
        console.log("[Holaf ModelManager] createPanel finished.");
    },

    applySettingsToPanel() {
        if (this.panelElements && this.panelElements.panelEl) {
            this.setTheme(this.settings.theme);
            this.applyZoom();

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

            const typeSelect = document.getElementById("holaf-manager-type-select");
            if (typeSelect) typeSelect.value = this.settings.filter_type || "All";

            const searchInput = document.getElementById("holaf-manager-search-input");
            if (searchInput) searchInput.value = this.settings.filter_search_text || "";
        }
    },

    createThemeMenu() {
        const menu = document.createElement("ul");
        menu.className = "holaf-theme-menu";
        HOLAF_THEMES.forEach(theme => {
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
        const themeConfig = HOLAF_THEMES.find(t => t.name === themeName);
        if (!themeConfig) {
            console.warn(`[Holaf ModelManager] Theme '${themeName}' not found. Defaulting to ${HOLAF_THEMES[0].name}`);
            this.setTheme(HOLAF_THEMES[0].name);
            return;
        }

        this.settings.theme = themeName;

        if (this.panelElements && this.panelElements.panelEl) {
            HOLAF_THEMES.forEach(t => {
                if (this.panelElements.panelEl.classList.contains(t.className)) {
                    this.panelElements.panelEl.classList.remove(t.className);
                }
            });
            this.panelElements.panelEl.classList.add(themeConfig.className);
            console.log(`[Holaf ModelManager] Theme set to: ${themeName} (Class: ${themeConfig.className})`);
        }
        this.saveSettings();
    },

    applyZoom() {
        if (this.panelElements && this.panelElements.panelEl) {
            this.panelElements.panelEl.style.setProperty('--holaf-mm-zoom-factor', this.settings.zoom_level);
            console.log(`[Holaf ModelManager] Zoom level applied: ${this.settings.zoom_level}`);
        }
    },

    increaseZoom() {
        const newZoom = parseFloat((this.settings.zoom_level + this.ZOOM_STEP).toFixed(2));
        if (newZoom <= this.MAX_ZOOM) {
            this.settings.zoom_level = newZoom;
            this.applyZoom();
            this.saveSettings();
        }
    },

    decreaseZoom() {
        const newZoom = parseFloat((this.settings.zoom_level - this.ZOOM_STEP).toFixed(2));
        if (newZoom >= this.MIN_ZOOM) {
            this.settings.zoom_level = newZoom;
            this.applyZoom();
            this.saveSettings();
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.innerHTML = `
            <div class="holaf-manager-toolbar" style="flex-wrap: wrap;">
                <div style="display: flex; gap: 8px; align-items: center; flex-grow: 1; min-width: 250px;">
                    <select id="holaf-manager-type-select" class="holaf-manager-search" style="flex-grow: 0.5;"></select>
                    <input type="text" id="holaf-manager-search-input" class="holaf-manager-search" placeholder="Search models (name, family, path)..." style="flex-grow: 1;">
                </div>
                <div id="holaf-manager-button-group" style="display: flex; gap: 4px; align-items: center;">
                    <button id="holaf-manager-download-button" class="comfy-button" title="Download selected models.">Download</button>
                    <button id="holaf-manager-deep-scan-button" class="comfy-button" title="Deep Scan selected .safetensors models for metadata and hash.">Deep Scan</button>
                    <button id="holaf-manager-delete-button" class="comfy-button" title="Delete selected models from server." style="background-color: #D32F2F;">Delete</button>
                </div>
            </div>

            <div class="holaf-manager-list-header">
                <div class="holaf-manager-header-col holaf-header-checkbox">
                    <input type="checkbox" id="holaf-manager-select-all-checkbox" title="Select/Deselect All">
                </div>
                <div class="holaf-manager-header-col holaf-header-name" data-sort-by="name">Nom</div>
                <div class="holaf-manager-header-col holaf-header-path" data-sort-by="path">Chemin</div>
                <div class="holaf-manager-header-col holaf-header-type" data-sort-by="display_type">Type</div>
                <div class="holaf-manager-header-col holaf-header-family" data-sort-by="model_family">Famille</div>
                <div class="holaf-manager-header-col holaf-header-size" data-sort-by="size_bytes">Taille</div>
            </div>

            <div id="holaf-manager-models-area" class="holaf-manager-content">
                <p class="holaf-manager-message">Initializing...</p>
            </div>
            <div id="holaf-manager-statusbar" class="holaf-manager-statusbar">
                Status: Ready
            </div>
        `;

        document.getElementById("holaf-manager-type-select").onchange = (e) => {
            this.settings.filter_type = e.target.value;
            this.filterModels();
            this.saveSettings();
        };
        document.getElementById("holaf-manager-search-input").oninput = (e) => {
            this.settings.filter_search_text = e.target.value;
            this.filterModels();
            this.saveSettings();
        };
        document.getElementById("holaf-manager-download-button").onclick = () => this.performDownloadSelectedModels();
        document.getElementById("holaf-manager-deep-scan-button").onclick = () => this.performDeepScan();
        document.getElementById("holaf-manager-delete-button").onclick = () => this.performDelete();


        contentEl.querySelectorAll(".holaf-manager-list-header .holaf-manager-header-col[data-sort-by]").forEach(headerCol => {
            headerCol.onclick = () => {
                const sortBy = headerCol.dataset.sortBy;
                if (this.currentSort.column === sortBy) {
                    this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
                } else {
                    this.currentSort.column = sortBy;
                    this.currentSort.order = 'asc';
                }
                this.settings.sort_column = this.currentSort.column;
                this.settings.sort_order = this.currentSort.order;
                this.filterModels();
                this.saveSettings();
            };
        });

        const selectAllCheckbox = contentEl.querySelector("#holaf-manager-select-all-checkbox");
        if (selectAllCheckbox) {
            selectAllCheckbox.onclick = (e) => {
                const isChecked = e.target.checked;
                this.selectedModelPaths.clear();
                const currentlyVisibleModels = this.getCurrentlyFilteredModels();

                if (isChecked) {
                    currentlyVisibleModels.forEach(model => this.selectedModelPaths.add(model.path));
                }
                const modelsArea = document.getElementById("holaf-manager-models-area");
                if (modelsArea) {
                    modelsArea.querySelectorAll(".holaf-model-checkbox").forEach(cb => cb.checked = isChecked);
                }
                this.updateActionButtonsState();
            };
        }
        this.updateActionButtonsState();
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
                selectEl.appendChild(option);
            }
        }
        selectEl.value = this.settings.filter_type || "All";
    },

    async loadModels() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.updateActionButtonsState();
        const modelsArea = document.getElementById("holaf-manager-models-area");
        const statusBar = document.getElementById("holaf-manager-statusbar");

        if (modelsArea) modelsArea.innerHTML = `<p class="holaf-manager-message">Loading models...</p>`;
        if (statusBar) statusBar.textContent = "Status: Loading...";

        this.models = [];
        this.modelCountsPerDisplayType = {};
        if (modelsArea) modelsArea.innerHTML = '';

        try {
            const response = await fetch("/holaf/models", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            this.models = await response.json();

            this.models.forEach(model => {
                const dtype = model.display_type || "Undefined";
                this.modelCountsPerDisplayType[dtype] = (this.modelCountsPerDisplayType[dtype] || 0) + 1;
            });

            this.populateModelTypes();
            this.filterModels();

            if (statusBar) statusBar.textContent = `Status: ${this.models.length} models loaded.`;
        } catch (error) {
            console.error("[Holaf ModelManager] Error loading models:", error);
            if (modelsArea) modelsArea.innerHTML = `<p class="holaf-manager-message error">Error loading models: ${error.message}</p>`;
            if (statusBar) statusBar.textContent = "Status: Error loading models.";
        } finally {
            this.isLoading = false;
            this.updateActionButtonsState();
        }
    },

    renderModels(modelsToRender) {
        const modelsArea = document.getElementById("holaf-manager-models-area");
        if (!modelsArea) return;
        modelsArea.innerHTML = '';

        if (modelsToRender.length === 0) {
            modelsArea.innerHTML = `<p class="holaf-manager-message">No models match your criteria.</p>`;
            const selectAllCheckbox = document.getElementById("holaf-manager-select-all-checkbox");
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            return;
        }

        modelsToRender.forEach(model => {
            const card = document.createElement("div");
            card.className = "holaf-model-card";
            const sizeInBytes = Number(model.size_bytes);
            const sizeMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
            const modelPath = model.path || "N/A";
            const modelName = model.name || "N/A";
            const displayType = model.display_type || "N/A";
            const modelFamily = model.model_family || "N/A";

            card.innerHTML = `
                <div class="holaf-model-col holaf-col-checkbox">
                    <input type="checkbox" class="holaf-model-checkbox" data-model-path="${modelPath}" ${this.selectedModelPaths.has(modelPath) ? 'checked' : ''}>
                </div>
                <div class="holaf-model-col holaf-col-name" title="${modelName}\n${modelPath}">
                    <span class="holaf-model-name">${modelName}</span>
                    <span class="holaf-model-path">${modelPath}</span>
                </div>
                <div class="holaf-model-col holaf-col-type">
                    <span class="holaf-model-type-tag">${displayType}</span>
                </div>
                <div class="holaf-model-col holaf-col-family">
                    <span class="holaf-model-family-tag">${modelFamily}</span>
                </div>
                <div class="holaf-model-col holaf-col-size">
                    <span class="holaf-model-size">${sizeMB} MB</span>
                </div>
            `;

            const checkbox = card.querySelector(".holaf-model-checkbox");
            checkbox.onchange = (e) => {
                if (e.target.checked) {
                    this.selectedModelPaths.add(modelPath);
                } else {
                    this.selectedModelPaths.delete(modelPath);
                }
                this.updateSelectAllCheckboxState();
                this.updateActionButtonsState();
            };
            modelsArea.appendChild(card);
        });
        this.updateSelectAllCheckboxState();
    },

    getCurrentlyFilteredModels() {
        const selectedTypeFilterValue = this.settings.filter_type || "All";
        const searchText = (this.settings.filter_search_text || "").toLowerCase();

        return this.models.filter(model => {
            let typeMatch = false;
            if (selectedTypeFilterValue === "All") {
                typeMatch = true;
            } else if (selectedTypeFilterValue === "Holaf--Category--Others") {
                typeMatch = model.display_type && model.display_type.startsWith("Autres (");
            } else {
                typeMatch = (model.display_type === selectedTypeFilterValue);
            }
            const textMatch = (
                model.name.toLowerCase().includes(searchText) ||
                (model.model_family && model.model_family.toLowerCase().includes(searchText)) ||
                model.path.toLowerCase().includes(searchText)
            );
            return typeMatch && textMatch;
        });
    },

    sortAndRenderModels() {
        let modelsToDisplay = this.getCurrentlyFilteredModels();
        const { column, order } = this.currentSort;

        modelsToDisplay.sort((a, b) => {
            let valA = a[column];
            let valB = b[column];

            if (column === 'size_bytes') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            } else {
                valA = String(valA || "").toLowerCase();
                valB = String(valB || "").toLowerCase();
            }

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;

            if (column !== 'name') {
                let nameA = String(a.name || "").toLowerCase();
                let nameB = String(b.name || "").toLowerCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;
            }
            return 0;
        });

        this.renderModels(modelsToDisplay);
        this.updateSortIndicators();
    },

    filterModels() {
        this.sortAndRenderModels();
        const statusBar = document.getElementById("holaf-manager-statusbar");
        if (statusBar) {
            const modelsToDisplay = this.getCurrentlyFilteredModels();
            const totalShown = modelsToDisplay.length;
            const totalAvailable = this.models.length;
            const selectedTypeFilterValue = this.settings.filter_type || "All";
            const searchText = this.settings.filter_search_text || "";

            if (totalShown === totalAvailable && selectedTypeFilterValue === "All" && searchText === "") {
                statusBar.textContent = `Status: ${totalAvailable} models loaded.`;
            } else {
                statusBar.textContent = `Status: Displaying ${totalShown} of ${totalAvailable} models. Filtered by type: '${selectedTypeFilterValue}', search: '${searchText || 'none'}'.`;
            }
        }
    },

    updateSortIndicators() {
        const headerCols = document.querySelectorAll(".holaf-manager-list-header .holaf-manager-header-col[data-sort-by]");
        headerCols.forEach(col => {
            col.classList.remove('sort-asc', 'sort-desc');
            if (col.dataset.sortBy === this.currentSort.column) {
                col.classList.add(this.currentSort.order === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    },

    updateSelectAllCheckboxState() {
        const selectAllCheckbox = document.getElementById("holaf-manager-select-all-checkbox");
        if (!selectAllCheckbox) return;

        const visibleCheckboxes = document.querySelectorAll("#holaf-manager-models-area .holaf-model-checkbox");
        if (visibleCheckboxes.length === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
            return;
        }

        let allChecked = true;
        let noneChecked = true;
        for (const cb of visibleCheckboxes) {
            if (cb.checked) noneChecked = false;
            else allChecked = false;
        }

        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = !allChecked && !noneChecked;
    },

    updateActionButtonsState() {
        const downloadButton = document.getElementById("holaf-manager-download-button");
        const deepScanButton = document.getElementById("holaf-manager-deep-scan-button");
        const deleteButton = document.getElementById("holaf-manager-delete-button");

        const canPerformActions = this.selectedModelPaths.size > 0 && !this.isLoading && !this.isDeepScanning && !this.isDownloading;

        if (downloadButton) {
            downloadButton.disabled = !canPerformActions;
            downloadButton.style.opacity = canPerformActions ? '1' : '0.5';
            downloadButton.style.cursor = canPerformActions ? 'pointer' : 'not-allowed';
            if (this.isDownloading) {
                downloadButton.textContent = "Downloading...";
            } else {
                downloadButton.textContent = `Download (${this.selectedModelPaths.size})`;
            }
        }

        if (deepScanButton) {
            const hasSafetensorsSelected = Array.from(this.selectedModelPaths).some(path =>
                typeof path === 'string' && path.toLowerCase().endsWith('.safetensors')
            );
            const canScan = hasSafetensorsSelected && canPerformActions;

            deepScanButton.disabled = !canScan;
            deepScanButton.style.opacity = canScan ? '1' : '0.5';
            deepScanButton.style.cursor = canScan ? 'pointer' : 'not-allowed';

            if (this.isDeepScanning) {
                deepScanButton.textContent = "Scanning...";
            } else {
                deepScanButton.textContent = "Deep Scan";
            }
        }

        if (deleteButton) {
            deleteButton.disabled = !canPerformActions;
            deleteButton.style.opacity = canPerformActions ? '1' : '0.5';
            deleteButton.style.cursor = canPerformActions ? 'pointer' : 'not-allowed';

            if (this.isLoading) { // Generic loading state
                deleteButton.textContent = "Loading...";
            } else if (this.isDeepScanning) {
                deleteButton.textContent = "Scanning...";
            } else if (this.isDownloading) {
                deleteButton.textContent = "Downloading...";
            }
            else {
                deleteButton.textContent = `Delete (${this.selectedModelPaths.size})`;
            }
        }
    },

    async performDeepScan() {
        if (this.isDeepScanning || this.isLoading || this.isDownloading) {
            console.warn("[Holaf ModelManager] Operation already in progress.");
            return;
        }

        const pathsToScan = Array.from(this.selectedModelPaths).filter(path =>
            typeof path === 'string' && path.toLowerCase().endsWith('.safetensors')
        );

        if (pathsToScan.length === 0) {
            alert("Please select at least one .safetensors model to deep scan.");
            this.updateActionButtonsState();
            return;
        }

        this.isDeepScanning = true;
        this.updateActionButtonsState();
        const statusBar = document.getElementById("holaf-manager-statusbar");
        if (statusBar) statusBar.textContent = `Status: Deep scanning ${pathsToScan.length} model(s)... (SHA256 & metadata)`;

        try {
            const response = await fetch('/holaf/models/deep-scan-local', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: pathsToScan })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: "Unknown server error during deep scan." }));
                throw new Error(errorData.message || `HTTP error ${response.status}`);
            }

            const result = await response.json();
            console.log("[Holaf ModelManager] Deep Scan Result:", result);

            let message = `Deep scan completed. ${result.details.updated_count || 0} model(s) updated in DB.`;
            if (result.details.errors && result.details.errors.length > 0) {
                message += ` ${result.details.errors.length} error(s) occurred. Check console for details.`;
                result.details.errors.forEach(err => {
                    console.error(`[Holaf ModelManager] Deep Scan Error for path '${err.path || 'N/A'}' (Name: ${err.name || 'Unknown'}): ${err.message}`);
                });
            }
            if (statusBar) statusBar.textContent = "Status: " + message;

            this.selectedModelPaths.clear();
            await this.loadModels();

        } catch (error) {
            console.error("[Holaf ModelManager] Failed to perform deep scan:", error);
            if (statusBar) statusBar.textContent = `Status: Deep scan error: ${error.message}`;
            alert(`Deep scan failed: ${error.message}`);
        } finally {
            this.isDeepScanning = false;
            this.updateActionButtonsState();
        }
    },

    async performDelete() {
        if (this.isLoading || this.isDeepScanning || this.isDownloading) {
            console.warn("[Holaf ModelManager] Cannot delete while other operations are in progress.");
            return;
        }
        const pathsToDelete = Array.from(this.selectedModelPaths);
        if (pathsToDelete.length === 0) {
            alert("Please select at least one model to delete.");
            return;
        }

        const userConfirmed = confirm(`Are you sure you want to PERMANENTLY delete ${pathsToDelete.length} selected model(s) from the server? This action cannot be undone.`);
        if (!userConfirmed) return;

        this.isLoading = true;
        this.updateActionButtonsState();
        const statusBar = document.getElementById("holaf-manager-statusbar");
        if (statusBar) statusBar.textContent = `Status: Deleting ${pathsToDelete.length} model(s)...`;

        try {
            const response = await fetch('/holaf/models/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: pathsToDelete })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || `HTTP error ${response.status}`);
            }

            let message = `${result.details?.deleted_count || 0} model(s) successfully deleted.`;
            if (result.details?.errors && result.details.errors.length > 0) {
                message += ` ${result.details.errors.length} error(s) occurred.`;
                result.details.errors.forEach(err => {
                    console.error(`[Holaf ModelManager] Delete Error for path '${err.path || 'N/A'}': ${err.message}`);
                });
                alert("Some models could not be deleted. Check console for details.");
            } else {
                if (!result.details?.errors || result.details.errors.length === 0) {
                    alert("Selected models deleted successfully.");
                }
            }
            if (statusBar) statusBar.textContent = "Status: " + message;

        } catch (error) {
            console.error("[Holaf ModelManager] Failed to perform delete:", error);
            if (statusBar) statusBar.textContent = `Status: Delete error: ${error.message}`;
            alert(`Delete operation failed: ${error.message}`);
        } finally {
            this.isLoading = false;
            this.selectedModelPaths.clear();
            await this.loadModels();
            this.updateActionButtonsState();
        }
    },

    async performDownloadSelectedModels() {
        if (this.isLoading || this.isDeepScanning || this.isDownloading) {
            console.warn("[Holaf ModelManager] Cannot download while other operations are in progress.");
            return;
        }
        const pathsToDownload = Array.from(this.selectedModelPaths);
        if (pathsToDownload.length === 0) {
            alert("Please select at least one model to download.");
            return;
        }

        this.isDownloading = true;
        this.updateActionButtonsState();
        const statusBar = document.getElementById("holaf-manager-statusbar");
        if (statusBar) statusBar.textContent = `Status: Preparing to download ${pathsToDownload.length} model(s)...`;

        let successfulDownloads = 0;
        let failedDownloads = 0;

        for (const modelPath of pathsToDownload) {
            // For file models, extract filename. For directory models, create a zip name.
            // This is a simplified assumption; backend will provide the actual filename.
            let suggestedFilename = modelPath.substring(modelPath.lastIndexOf('/') + 1);
            if (suggestedFilename === "" || suggestedFilename === ".") { // Should not happen with good paths
                suggestedFilename = "model_download";
            }

            if (statusBar) statusBar.textContent = `Status: Downloading ${suggestedFilename}... (${successfulDownloads + failedDownloads + 1}/${pathsToDownload.length})`;

            try {
                // Construct the download URL
                const downloadUrl = `/holaf/models/download?path=${encodeURIComponent(modelPath)}`;

                // Create a temporary anchor element to trigger the download
                const a = document.createElement('a');
                a.href = downloadUrl;
                // a.download = ""; // Let server decide filename via Content-Disposition for now
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Note: True success/failure of download is hard to track client-side this way.
                // We assume it will succeed if the link is clicked.
                // A more robust solution might involve fetch + Blob, but can be complex with large files.
                successfulDownloads++;

                // Small delay between downloads to be slightly nicer to browser/server
                if (pathsToDownload.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

            } catch (error) {
                console.error(`[Holaf ModelManager] Error initiating download for ${modelPath}:`, error);
                failedDownloads++;
            }
        }

        this.isDownloading = false;
        this.updateActionButtonsState();
        if (statusBar) {
            let finalMessage = `Download process initiated for ${successfulDownloads} model(s).`;
            if (failedDownloads > 0) {
                finalMessage += ` ${failedDownloads} download(s) could not be initiated (check console).`;
            }
            statusBar.textContent = "Status: " + finalMessage;
        }
        if (failedDownloads > 0) {
            alert("Some downloads could not be initiated. Please check the browser console for errors.");
        }
    },

    async show() {
        console.log("[Holaf ModelManager] show called.");
        if (!this.panelElements || !this.panelElements.panelEl) {
            if (!this.areSettingsLoaded) {
                await this.loadModelConfigAndSettings();
            }
            console.log("[Holaf ModelManager] Panel not created or panelEl missing. Calling createPanel().");
            this.createPanel();
            if (!this.panelElements || !this.panelElements.panelEl) {
                console.error("[Holaf ModelManager] Panel creation FAILED in show(). Aborting show.");
                return;
            }
        } else {
            this.applySettingsToPanel();
        }

        const panelIsVisible = this.panelElements.panelEl.style.display === "flex";

        if (panelIsVisible) {
            this.panelElements.panelEl.style.display = "none";
        } else {
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl);
            if (!this.isInitialized || this.models.length === 0) {
                this.loadModels();
                this.isInitialized = true;
            } else {
                this.filterModels();
            }
            this.updateActionButtonsState();
        }
        console.log("[Holaf ModelManager] show finished.");
    },
};

app.registerExtension({
    name: "Holaf.ModelManager.Panel",
    async setup() {
        console.log("[Holaf ModelManager] Extension setup() called.");

        holafModelManager.ensureMenuItemAdded();

        await holafModelManager.loadModelConfigAndSettings();
    },
});

export default holafModelManager;