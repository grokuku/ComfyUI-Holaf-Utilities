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
    isDownloading: false,
    isUploading: false, // New state for upload
    models: [],
    modelTypesConfig: [],
    modelCountsPerDisplayType: {},
    selectedModelPaths: new Set(),
    uploadDialog: null, // To store the upload dialog elements
    settings: {
        theme: HOLAF_THEMES[0].name,
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
                const response = await fetch("/holaf/models/config"); // Already loads model types config
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
                    if (this.uploadDialog && this.uploadDialog.dialogEl) {
                        this.uploadDialog.dialogEl.style.display = 'none';
                        this.setModal(false);
                    }
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
        } catch (e) {
            console.error("[Holaf ModelManager] Error during HolafPanelManager.createPanel:", e);
            alert("[Holaf ModelManager] Error creating panel. Check console.");
            return;
        }

        const overlay = document.createElement("div");
        overlay.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(20, 20, 20, 0.6); z-index: 100;
            display: none; border-radius: 8px;
        `;
        this.panelElements.panelEl.appendChild(overlay);
        this.panelElements.modalOverlayEl = overlay;

        this.populatePanelContent();
        this.createUploadDialog(); // Create the dialog structure (hidden by default)
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
            if (this.uploadDialog && this.uploadDialog.dialogEl) { // Also apply to dialog
                HOLAF_THEMES.forEach(t => this.uploadDialog.dialogEl.classList.remove(t.className));
                this.uploadDialog.dialogEl.classList.add(themeConfig.className);
            }
            console.log(`[Holaf ModelManager] Theme set to: ${themeName} (Class: ${themeConfig.className})`);
        }
        this.saveSettings();
    },

    applyZoom() {
        if (this.panelElements && this.panelElements.panelEl) {
            this.panelElements.panelEl.style.setProperty('--holaf-mm-zoom-factor', this.settings.zoom_level);
            if (this.uploadDialog && this.uploadDialog.dialogEl) {
                this.uploadDialog.dialogEl.style.setProperty('--holaf-mm-zoom-factor', this.settings.zoom_level);
            }
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
                <div id="holaf-manager-button-group" style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                    <button id="holaf-manager-upload-button" class="comfy-button" title="Upload new models.">Upload</button>
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
        document.getElementById("holaf-manager-upload-button").onclick = () => this.showUploadDialog();
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

        // Populate upload dialog destination folder types if dialog exists
        if (this.uploadDialog && this.uploadDialog.destTypeSelect) {
            this.uploadDialog.destTypeSelect.innerHTML = ''; // Clear existing
            this.modelTypesConfig
                .filter(mt => !mt.storage_hint || mt.storage_hint !== 'directory') // Filter out "Diffusers" type for now
                .forEach(mt => {
                    const option = document.createElement("option");
                    option.value = mt.folder_name; // Use folder_name as value
                    option.textContent = mt.type; // Display user-friendly type
                    this.uploadDialog.destTypeSelect.appendChild(option);
                });
        }
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
        const uploadButton = document.getElementById("holaf-manager-upload-button");
        const downloadButton = document.getElementById("holaf-manager-download-button");
        const deepScanButton = document.getElementById("holaf-manager-deep-scan-button");
        const deleteButton = document.getElementById("holaf-manager-delete-button");

        const canPerformSelectionActions = this.selectedModelPaths.size > 0 && !this.isLoading && !this.isDeepScanning && !this.isDownloading && !this.isUploading;
        const canPerformGeneralActions = !this.isLoading && !this.isDeepScanning && !this.isDownloading && !this.isUploading;


        if (uploadButton) {
            uploadButton.disabled = !canPerformGeneralActions;
            uploadButton.style.opacity = canPerformGeneralActions ? '1' : '0.5';
            uploadButton.style.cursor = canPerformGeneralActions ? 'pointer' : 'not-allowed';
            if (this.isUploading) uploadButton.textContent = "Uploading...";
            else uploadButton.textContent = "Upload";
        }

        if (downloadButton) {
            downloadButton.disabled = !canPerformSelectionActions;
            downloadButton.style.opacity = canPerformSelectionActions ? '1' : '0.5';
            downloadButton.style.cursor = canPerformSelectionActions ? 'pointer' : 'not-allowed';
            if (this.isDownloading) downloadButton.textContent = "Downloading...";
            else downloadButton.textContent = `Download (${this.selectedModelPaths.size})`;
        }

        if (deepScanButton) {
            const hasSafetensorsSelected = Array.from(this.selectedModelPaths).some(path =>
                typeof path === 'string' && path.toLowerCase().endsWith('.safetensors')
            );
            const canScan = hasSafetensorsSelected && canPerformSelectionActions;
            deepScanButton.disabled = !canScan;
            deepScanButton.style.opacity = canScan ? '1' : '0.5';
            deepScanButton.style.cursor = canScan ? 'pointer' : 'not-allowed';
            if (this.isDeepScanning) deepScanButton.textContent = "Scanning...";
            else deepScanButton.textContent = "Deep Scan";
        }

        if (deleteButton) {
            deleteButton.disabled = !canPerformSelectionActions;
            deleteButton.style.opacity = canPerformSelectionActions ? '1' : '0.5';
            deleteButton.style.cursor = canPerformSelectionActions ? 'pointer' : 'not-allowed';
            if (this.isLoading) deleteButton.textContent = "Loading...";
            else if (this.isDeepScanning) deleteButton.textContent = "Scanning...";
            else if (this.isDownloading) deleteButton.textContent = "Downloading...";
            else if (this.isUploading) deleteButton.textContent = "Uploading...";
            else deleteButton.textContent = `Delete (${this.selectedModelPaths.size})`;
        }
    },

    async performDeepScan() {
        if (this.isDeepScanning || this.isLoading || this.isDownloading || this.isUploading) {
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
        if (statusBar) statusBar.textContent = `Status: Deep scanning ${pathsToScan.length} model(s)...`;
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
        if (this.isLoading || this.isDeepScanning || this.isDownloading || this.isUploading) {
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
        if (this.isLoading || this.isDeepScanning || this.isDownloading || this.isUploading) {
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
            let suggestedFilename = modelPath.substring(modelPath.lastIndexOf('/') + 1);
            if (suggestedFilename === "" || suggestedFilename === ".") {
                suggestedFilename = "model_download";
            }
            if (statusBar) statusBar.textContent = `Status: Downloading ${suggestedFilename}... (${successfulDownloads + failedDownloads + 1}/${pathsToDownload.length})`;
            try {
                const downloadUrl = `/holaf/models/download?path=${encodeURIComponent(modelPath)}`;
                const a = document.createElement('a');
                a.href = downloadUrl;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                successfulDownloads++;
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

    setModal(isModal) {
        const overlay = this.panelElements?.modalOverlayEl;
        if (overlay) {
            overlay.style.display = isModal ? 'block' : 'none';
        }
    },

    createUploadDialog() {
        if (this.uploadDialog && this.uploadDialog.dialogEl) {
            return; // Already created
        }

        const dialogEl = document.createElement("div");
        dialogEl.id = "holaf-manager-upload-dialog";
        dialogEl.className = "holaf-utility-panel"; // Reuse panel styling
        dialogEl.style.cssText = `
            width: 500px; height: auto; max-height: 70vh; display: none; 
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            z-index: 1005; /* Higher than main panel */
            flex-direction: column;
            font-size: calc(1em * var(--holaf-mm-zoom-factor)); /* Respect zoom */
        `;
        // Apply current theme and zoom
        const currentThemeClass = HOLAF_THEMES.find(t => t.name === this.settings.theme)?.className || HOLAF_THEMES[0].className;
        dialogEl.classList.add(currentThemeClass);
        dialogEl.style.setProperty('--holaf-mm-zoom-factor', this.settings.zoom_level);


        const header = document.createElement("div");
        header.className = "holaf-utility-header";
        header.innerHTML = `<span>Upload Model</span><button class="holaf-utility-close-button" style="margin-left:auto;">✖</button>`;
        header.querySelector('.holaf-utility-close-button').onclick = () => {
            dialogEl.style.display = 'none';
            this.setModal(false);
        };
        // Make dialog draggable by its header (simplified, no resize for dialog)
        HolafPanelManager.makeDraggable(dialogEl, header, () => { });


        const content = document.createElement("div");
        content.style.padding = "15px";
        content.style.overflowY = "auto";
        content.style.flexGrow = "1";

        content.innerHTML = `
            <div style="margin-bottom: 15px;">
                <label for="holaf-upload-dest-type" style="display:block; margin-bottom:5px;">Destination Type:</label>
                <select id="holaf-upload-dest-type" class="holaf-manager-search"></select>
            </div>
            <div style="margin-bottom: 15px;">
                <label for="holaf-upload-subfolder" style="display:block; margin-bottom:5px;">Subfolder (optional, e.g., 'characters/female'):</label>
                <input type="text" id="holaf-upload-subfolder" class="holaf-manager-search" placeholder="Leave blank for root of type">
            </div>
            <hr style="border-color: var(--holaf-border-color); margin: 15px 0;">
            <div style="margin-bottom: 15px;">
                <h4 style="margin-top:0; margin-bottom:8px; color:var(--holaf-text-primary);">Upload from File:</h4>
                <input type="file" id="holaf-upload-file-input" style="color:var(--holaf-text-secondary); width: 100%;">
            </div>
            <div style="text-align:center; margin-top:20px;">
                <button id="holaf-upload-start-button" class="comfy-button">Start Upload</button>
            </div>
            <div id="holaf-upload-status" style="margin-top:15px; text-align:center; color:var(--holaf-text-secondary);"></div>
        `;

        dialogEl.append(header, content);
        document.body.appendChild(dialogEl);

        this.uploadDialog = {
            dialogEl: dialogEl,
            destTypeSelect: dialogEl.querySelector("#holaf-upload-dest-type"),
            subfolderInput: dialogEl.querySelector("#holaf-upload-subfolder"),
            fileInput: dialogEl.querySelector("#holaf-upload-file-input"),
            startButton: dialogEl.querySelector("#holaf-upload-start-button"),
            statusMessage: dialogEl.querySelector("#holaf-upload-status")
        };

        this.uploadDialog.startButton.onclick = () => this.performUpload();
        this.populateModelTypes(); // Populate select now that it exists
    },

    showUploadDialog() {
        if (!this.uploadDialog || !this.uploadDialog.dialogEl) {
            console.error("[Holaf ModelManager] Upload dialog not created.");
            return;
        }
        if (this.isUploading || this.isLoading || this.isDeepScanning || this.isDownloading) {
            alert("Another operation is in progress. Please wait.");
            return;
        }
        this.uploadDialog.dialogEl.style.display = 'flex';
        HolafPanelManager.bringToFront(this.uploadDialog.dialogEl); // Bring dialog to front
        this.setModal(true);
        if (this.uploadDialog.fileInput) this.uploadDialog.fileInput.value = ""; // Clear previous file selection
        if (this.uploadDialog.statusMessage) this.uploadDialog.statusMessage.textContent = "";
    },

    async performUpload() {
        if (!this.uploadDialog) return;
        const file = this.uploadDialog.fileInput.files[0];
        const destType = this.uploadDialog.destTypeSelect.value;
        const subfolder = this.uploadDialog.subfolderInput.value.trim();

        if (!file) {
            this.uploadDialog.statusMessage.textContent = "Please select a file to upload.";
            this.uploadDialog.statusMessage.style.color = "var(--holaf-accent-color)";
            return;
        }
        if (!destType) {
            this.uploadDialog.statusMessage.textContent = "Please select a destination type.";
            this.uploadDialog.statusMessage.style.color = "var(--holaf-accent-color)";
            return;
        }

        this.isUploading = true;
        this.updateActionButtonsState();
        this.uploadDialog.startButton.disabled = true;
        this.uploadDialog.statusMessage.textContent = `Uploading ${file.name}...`;
        this.uploadDialog.statusMessage.style.color = "var(--holaf-text-secondary)";

        const formData = new FormData();
        formData.append("file", file);
        formData.append("destination_type", destType);
        formData.append("subfolder", subfolder);
        // Could add original filename if needed by backend, but usually backend uses the uploaded file's name.
        // formData.append("original_filename", file.name);


        try {
            const response = await fetch('/holaf/models/upload-file', {
                method: 'POST',
                body: formData,
                // Headers for FormData are set automatically by the browser, including Content-Type: multipart/form-data
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || `Upload failed with status ${response.status}`);
            }

            this.uploadDialog.statusMessage.textContent = result.message || "Upload successful!";
            this.uploadDialog.statusMessage.style.color = "var(--holaf-text-primary)"; // Or a success color

            this.uploadDialog.fileInput.value = ""; // Clear file input
            this.uploadDialog.dialogEl.style.display = 'none'; // Close dialog on success
            this.setModal(false); // Hide the overlay

            await this.loadModels(); // Refresh model list

        } catch (error) {
            console.error("[Holaf ModelManager] Upload error:", error);
            this.uploadDialog.statusMessage.textContent = `Error: ${error.message}`;
            this.uploadDialog.statusMessage.style.color = "var(--holaf-accent-color)"; // Error color
        } finally {
            this.isUploading = false;
            this.updateActionButtonsState();
            this.uploadDialog.startButton.disabled = false;
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
            if (this.uploadDialog && this.uploadDialog.dialogEl) {
                this.uploadDialog.dialogEl.style.display = 'none'; // Hide upload dialog too
                this.setModal(false); // Ensure overlay is hidden
            }
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