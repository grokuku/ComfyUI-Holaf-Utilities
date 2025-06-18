/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Model Manager UI
 *
 * This script provides the client-side logic for the Holaf Model Manager.
 * MODIFIED: Added model family display and sorting.
 * MODIFIED: Added "Deep Scan (Local)" button and functionality.
 * MODIFIED: Added saving/loading of panel state (size, pos, theme, filters, sort) to config.ini.
 * MODIFIED: Added zoom controls and saving of zoom level.
 * MODIFIED: Reworked upload to use a chunk-based, parallel, queueing system to handle large files.
 * MODIFIED: Replaced browser alerts with custom dialogs. Made uploads fully non-blocking.
 *           Enabled concurrent finalization/uploading. Fixed post-upload refresh.
 * MODIFIED: Replaced single-file sequential download with a parallel, chunk-based queueing system.
 * MODIFIED: Made download process non-blocking for the UI and removed the final completion dialog.
 * MODIFIED: Unlocked UI to allow concurrent uploads, downloads, and scans, with an improved status bar.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";

const holafModelManager = {
    panelElements: null,
    isInitialized: false,
    areSettingsLoaded: false,
    isLoading: false, // This is the ONLY truly blocking operation for the UI now

    // Operation states
    isUploading: false,
    isDownloading: false,
    isDeepScanning: false,

    // Queues and stats
    uploadQueue: [],
    activeUploads: 0,
    uploadStats: { history: [], currentSpeed: 0, totalBytes: 0, totalSentBytes: 0 },
    refreshAfterUpload: false,

    downloadQueue: [],
    activeDownloads: 0,
    downloadStats: { history: [], currentSpeed: 0, totalBytes: 0, totalReceivedBytes: 0 },

    scanQueue: [],

    statusUpdateRaf: null,
    models: [],
    modelTypesConfig: [],
    modelCountsPerDisplayType: {},
    selectedModelPaths: new Set(),
    uploadDialog: null,
    settings: {
        theme: HOLAF_THEMES[0].name,
        panel_x: null,
        panel_y: null,
        panel_width: 800,
        panel_height: 550,
        panel_is_fullscreen: false,
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

    // Concurrency settings
    MAX_CONCURRENT_UPLOADS: 1,
    MAX_CONCURRENT_DOWNLOADS: 1,
    MAX_CONCURRENT_CHUNKS: 4,

    // Chunk size settings
    UPLOAD_CHUNK_SIZE: 5 * 1024 * 1024,
    DOWNLOAD_CHUNK_SIZE: 5 * 1024 * 1024,

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
                        panel_is_fullscreen: !!fetchedMMSettings.panel_is_fullscreen
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
                panel_is_fullscreen: this.settings.panel_is_fullscreen,
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
        if (this.panelElements && this.panelElements.panelEl) {
            this.applySettingsToPanel();
            return;
        }

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
                title: "Holaf Model Manager (WIP)",
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
                    if (!this.settings.panel_is_fullscreen) {
                        this.settings.panel_x = newState.x;
                        this.settings.panel_y = newState.y;
                        this.settings.panel_width = newState.width;
                        this.settings.panel_height = newState.height;
                        this.saveSettings();
                    }
                },
                onResize: () => { },
                onFullscreenToggle: (isFullscreen) => {
                    this.settings.panel_is_fullscreen = isFullscreen;
                    this.saveSettings();
                }
            });
        } catch (e) {
            console.error("[Holaf ModelManager] Error during HolafPanelManager.createPanel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating panel. Check console for details." });
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
        this.createUploadDialog();
        this.applySettingsToPanel();
    },

    applySettingsToPanel() {
        if (this.panelElements && this.panelElements.panelEl) {
            this.setTheme(this.settings.theme);
            this.applyZoom();

            if (this.settings.panel_is_fullscreen) {
                if (!this.panelElements.panelEl.classList.contains("holaf-panel-fullscreen")) {
                    this.panelElements.panelEl.classList.add("holaf-panel-fullscreen");
                }
            } else {
                if (this.panelElements.panelEl.classList.contains("holaf-panel-fullscreen")) {
                    this.panelElements.panelEl.classList.remove("holaf-panel-fullscreen");
                }
            }

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
            if (this.uploadDialog && this.uploadDialog.dialogEl) {
                HOLAF_THEMES.forEach(t => this.uploadDialog.dialogEl.classList.remove(t.className));
                this.uploadDialog.dialogEl.classList.add(themeConfig.className);
            }
        }
        this.saveSettings();
    },

    applyZoom() {
        if (this.panelElements && this.panelElements.panelEl) {
            this.panelElements.panelEl.style.setProperty('--holaf-mm-zoom-factor', this.settings.zoom_level);
            if (this.uploadDialog && this.uploadDialog.dialogEl) {
                this.uploadDialog.dialogEl.style.setProperty('--holaf-mm-zoom-factor', this.settings.zoom_level);
            }
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
        document.getElementById("holaf-manager-download-button").onclick = () => this.addSelectedToDownloadQueue();
        document.getElementById("holaf-manager-deep-scan-button").onclick = () => this.addSelectedToScanQueue();
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

        if (this.uploadDialog && this.uploadDialog.destTypeSelect) {
            this.uploadDialog.destTypeSelect.innerHTML = '';
            this.modelTypesConfig
                .filter(mt => !mt.storage_hint || mt.storage_hint !== 'directory')
                .forEach(mt => {
                    const option = document.createElement("option");
                    option.value = mt.folder_name;
                    option.textContent = mt.type;
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

        if (this.isUploading || this.isDownloading || this.isDeepScanning) return;

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

    isPathInActiveTransfer(path) {
        const filename = path.split('/').pop();
        const inUpload = this.uploadQueue.some(job => job.file.name === filename && job.status !== 'done' && job.status !== 'error');
        const inDownload = this.downloadQueue.some(job => job.model.path === path && job.status !== 'done' && job.status !== 'error');
        return inUpload || inDownload;
    },

    updateActionButtonsState() {
        const uploadButton = document.getElementById("holaf-manager-upload-button");
        const downloadButton = document.getElementById("holaf-manager-download-button");
        const deepScanButton = document.getElementById("holaf-manager-deep-scan-button");
        const deleteButton = document.getElementById("holaf-manager-delete-button");

        const isGloballyBlocked = this.isLoading;

        if (uploadButton) {
            uploadButton.disabled = isGloballyBlocked;
        }
        if (downloadButton) {
            downloadButton.disabled = isGloballyBlocked || this.selectedModelPaths.size === 0;
            downloadButton.textContent = `Download (${this.selectedModelPaths.size})`;
        }
        if (deepScanButton) {
            const hasSafetensorsSelected = Array.from(this.selectedModelPaths).some(p => p.toLowerCase().endsWith('.safetensors'));
            deepScanButton.disabled = isGloballyBlocked || !hasSafetensorsSelected;
            deepScanButton.textContent = "Deep Scan";
        }
        if (deleteButton) {
            deleteButton.disabled = isGloballyBlocked || this.selectedModelPaths.size === 0;
            deleteButton.textContent = `Delete (${this.selectedModelPaths.size})`;
        }

        [uploadButton, downloadButton, deepScanButton, deleteButton].forEach(btn => {
            if (btn) {
                btn.style.opacity = btn.disabled ? '0.5' : '1';
                btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
            }
        });
    },

    async addSelectedToScanQueue() {
        if (this.isLoading) return;

        const allSelectedPaths = Array.from(this.selectedModelPaths);
        const pathsToScan = allSelectedPaths.filter(p => p.toLowerCase().endsWith('.safetensors') && !this.isPathInActiveTransfer(p));
        const skippedCount = allSelectedPaths.filter(p => !p.toLowerCase().endsWith('.safetensors') || this.isPathInActiveTransfer(p)).length;

        if (skippedCount > 0 && pathsToScan.length > 0) {
            HolafPanelManager.createDialog({ title: "Scan Notice", message: `${skippedCount} file(s) were skipped because they are not .safetensors or are currently being transferred.` });
        }

        if (pathsToScan.length === 0) {
            HolafPanelManager.createDialog({ title: "Scan", message: "No eligible (.safetensors) and available models selected for scanning." });
            return;
        }

        this.scanQueue.push(...pathsToScan);
        this.selectedModelPaths.clear();
        this.filterModels();
        this.updateActionButtonsState();

        if (!this.isDeepScanning) {
            this.processScanQueue();
        }
    },

    async processScanQueue() {
        if (this.scanQueue.length === 0) {
            this.isDeepScanning = false;
            this.updateActionButtonsState();
            if (!this.isUploading && !this.isDownloading) {
                this.loadModels(); // Refresh the list after all scans are done
            }
            return;
        }

        this.isDeepScanning = true;
        this.updateActionButtonsState();

        if (!this.statusUpdateRaf) {
            this.statusUpdateRaf = requestAnimationFrame(() => this.updateStatusBarText());
        }

        const pathsToScanInBatch = this.scanQueue.splice(0, this.scanQueue.length);

        try {
            const response = await fetch('/holaf/models/deep-scan-local', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: pathsToScanInBatch })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);

            if (result.details.errors && result.details.errors.length > 0) {
                console.error("[Holaf ModelManager] Deep Scan Errors:", result.details.errors);
            }
        } catch (error) {
            console.error("[Holaf ModelManager] Failed to perform deep scan batch:", error);
            HolafPanelManager.createDialog({ title: "Deep Scan Error", message: `A scan batch failed:\n${error.message}` });
        } finally {
            this.processScanQueue(); // Process next batch or finish
        }
    },

    async performDelete() {
        if (this.isLoading) return;

        const allSelectedPaths = Array.from(this.selectedModelPaths);
        const pathsToDelete = allSelectedPaths.filter(path => !this.isPathInActiveTransfer(path));
        const skippedCount = allSelectedPaths.length - pathsToDelete.length;

        if (skippedCount > 0 && pathsToDelete.length > 0) {
            HolafPanelManager.createDialog({ title: "Delete Notice", message: `${skippedCount} file(s) were skipped because they are currently being transferred.` });
        }

        if (pathsToDelete.length === 0) {
            HolafPanelManager.createDialog({ title: "Delete Models", message: "No available models selected for deletion." });
            return;
        }

        const userConfirmed = await HolafPanelManager.createDialog({
            title: "Confirm Deletion",
            message: `Are you sure you want to PERMANENTLY delete ${pathsToDelete.length} selected model(s) from the server?\n\nThis action cannot be undone.`,
            buttons: [{ text: "Cancel", value: false, type: "cancel" }, { text: "Delete Permanently", value: true, type: "danger" }]
        });

        if (!userConfirmed) return;

        this.isLoading = true; // Block UI during this critical op
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
            if (!response.ok && response.status !== 207) {
                throw new Error(result.message || `HTTP error ${response.status}`);
            }

            let message = `${result.details?.deleted_count || 0} model(s) successfully processed for deletion.`;
            if (result.details?.errors && result.details.errors.length > 0) {
                message += `\n\n${result.details.errors.length} error(s) occurred. Check browser console for details.`;
                result.details.errors.forEach(err => console.error(`[Holaf ModelManager] Delete Error for '${err.path}': ${err.message}`));
            }
            await HolafPanelManager.createDialog({ title: "Deletion Complete", message: message });
        } catch (error) {
            console.error("[Holaf ModelManager] Failed to perform delete:", error);
            await HolafPanelManager.createDialog({ title: "Deletion Error", message: `Delete operation failed:\n${error.message}` });
        } finally {
            this.isLoading = false; // Unblock
            this.selectedModelPaths.clear();
            await this.loadModels();
        }
    },

    setModal(isModal) {
        const overlay = this.panelElements?.modalOverlayEl;
        if (overlay) {
            overlay.style.display = isModal ? 'block' : 'none';
        }
    },

    createUploadDialog() {
        if (this.uploadDialog && this.uploadDialog.dialogEl) return;

        const dialogEl = document.createElement("div");
        dialogEl.id = "holaf-manager-upload-dialog";
        dialogEl.className = "holaf-utility-panel";
        dialogEl.style.cssText = `
            width: 500px; height: auto; max-height: 70vh; display: none; 
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            z-index: 1005; flex-direction: column;
            font-size: calc(1em * var(--holaf-mm-zoom-factor));
        `;
        const currentThemeClass = HOLAF_THEMES.find(t => t.name === this.settings.theme)?.className || HOLAF_THEMES[0].className;
        dialogEl.classList.add(currentThemeClass);
        dialogEl.style.setProperty('--holaf-mm-zoom-factor', this.settings.zoom_level);

        const header = document.createElement("div");
        header.className = "holaf-utility-header";
        header.innerHTML = `<span>Upload Models</span><button class="holaf-utility-close-button" style="margin-left:auto;">✖</button>`;
        header.querySelector('.holaf-utility-close-button').onclick = () => {
            dialogEl.style.display = 'none';
            this.setModal(false);
        };
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
                <label for="holaf-upload-subfolder" style="display:block; margin-bottom:5px;">Subfolder (optional):</label>
                <input type="text" id="holaf-upload-subfolder" class="holaf-manager-search" placeholder="e.g., characters/female">
            </div>
            <hr style="border-color: var(--holaf-border-color); margin: 15px 0;">
            <div style="margin-bottom: 15px;">
                 <label for="holaf-upload-file-input" class="comfy-button" style="display: block; text-align: center; margin-bottom: 10px;">Choose Files</label>
                <input type="file" id="holaf-upload-file-input" multiple style="display: none;">
                <div id="holaf-upload-file-list" style="max-height: 150px; overflow-y: auto; border: 1px solid var(--holaf-border-color); padding: 5px; display: none; background-color: var(--holaf-input-background)"></div>
            </div>
            <div style="text-align:center; margin-top:20px;">
                <button id="holaf-upload-add-queue-button" class="comfy-button">Add to Upload Queue</button>
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
            fileListEl: dialogEl.querySelector("#holaf-upload-file-list"),
            addQueueButton: dialogEl.querySelector("#holaf-upload-add-queue-button"),
            statusMessage: dialogEl.querySelector("#holaf-upload-status")
        };

        dialogEl.querySelector("label[for='holaf-upload-file-input']").onclick = () => this.uploadDialog.fileInput.click();
        this.uploadDialog.fileInput.onchange = () => this.previewSelectedFiles();
        this.uploadDialog.addQueueButton.onclick = () => this.addFilesToUploadQueue();
        this.populateModelTypes();
    },

    showUploadDialog() {
        if (this.isLoading) {
            HolafPanelManager.createDialog({ title: "Operation in Progress", message: "Please wait for the model list to load before uploading." });
            return;
        }

        this.uploadDialog.dialogEl.style.display = 'flex';
        HolafPanelManager.bringToFront(this.uploadDialog.dialogEl);
        this.setModal(true);
        if (this.uploadDialog.fileInput) this.uploadDialog.fileInput.value = "";
        if (this.uploadDialog.fileListEl) {
            this.uploadDialog.fileListEl.innerHTML = '';
            this.uploadDialog.fileListEl.style.display = 'none';
        }
        if (this.uploadDialog.statusMessage) this.uploadDialog.statusMessage.textContent = "";
    },

    previewSelectedFiles() {
        const { fileInput, fileListEl } = this.uploadDialog;
        if (!fileInput.files || fileInput.files.length === 0) {
            fileListEl.style.display = 'none';
            return;
        }
        fileListEl.innerHTML = '';
        Array.from(fileInput.files).forEach(file => {
            const item = document.createElement('div');
            item.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
            fileListEl.appendChild(item);
        });
        fileListEl.style.display = 'block';
    },

    // --- UPLOAD LOGIC ---
    addFilesToUploadQueue() {
        const { fileInput, destTypeSelect, subfolderInput, dialogEl, statusMessage } = this.uploadDialog;
        const files = fileInput.files;
        const destType = destTypeSelect.value;
        const subfolder = subfolderInput.value.trim();

        if (files.length === 0) {
            statusMessage.textContent = "Please select at least one file.";
            return;
        }

        for (const file of files) {
            const job = {
                file: file,
                id: `holaf-upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                status: 'queued',
                progress: 0,
                chunksSent: 0,
                totalChunks: Math.ceil(file.size / this.UPLOAD_CHUNK_SIZE),
                destType,
                subfolder,
                errorMessage: null,
                sentBytes: 0,
            };
            this.uploadQueue.push(job);
        }

        dialogEl.style.display = 'none';
        this.setModal(false);
        fileInput.value = '';
        this.uploadDialog.fileListEl.style.display = 'none';

        if (!this.isUploading) {
            this.processUploadQueue();
        }
    },

    async processUploadQueue() {
        if (this.activeUploads >= this.MAX_CONCURRENT_UPLOADS) return;

        const nextJob = this.uploadQueue.find(j => j.status === 'queued');
        if (!nextJob) {
            if (this.activeUploads === 0) {
                this.isUploading = false;
                if (!this.isDownloading && !this.isDeepScanning) {
                    if (this.statusUpdateRaf) cancelAnimationFrame(this.statusUpdateRaf);
                    this.statusUpdateRaf = null;
                    if (this.refreshAfterUpload) {
                        const statusBar = document.getElementById("holaf-manager-statusbar");
                        if (statusBar) statusBar.textContent = `Status: All uploads finished. Refreshing list in 3s...`;
                        setTimeout(() => { this.loadModels(); }, 3000);
                    } else {
                        this.filterModels();
                    }
                }
                this.refreshAfterUpload = false;
                this.uploadQueue = [];
                this.updateActionButtonsState();
            }
            return;
        }

        this.isUploading = true;
        this.updateActionButtonsState();
        this.activeUploads++;
        nextJob.status = 'uploading';

        if (!this.statusUpdateRaf) {
            this.statusUpdateRaf = requestAnimationFrame(() => this.updateStatusBarText());
        }
        this.uploadStats.totalBytes += nextJob.file.size;

        await this.uploadFile(nextJob);

        this.activeUploads--;
        this.processUploadQueue();
    },

    async uploadFile(job) {
        try {
            const chunkIndices = [...Array(job.totalChunks).keys()];
            let parallelQueue = chunkIndices.slice();

            await new Promise((resolve, reject) => {
                const worker = async () => {
                    while (parallelQueue.length > 0) {
                        const chunkIndex = parallelQueue.shift();
                        if (chunkIndex === undefined) continue;

                        try {
                            const start = chunkIndex * this.UPLOAD_CHUNK_SIZE;
                            const end = Math.min(start + this.UPLOAD_CHUNK_SIZE, job.file.size);
                            const chunk = job.file.slice(start, end);

                            const formData = new FormData();
                            formData.append("upload_id", job.id);
                            formData.append("chunk_index", chunkIndex);
                            formData.append("file_chunk", chunk);

                            const response = await fetch('/holaf/models/upload-chunk', { method: 'POST', body: formData });
                            if (!response.ok) {
                                const errorData = await response.json().catch(() => ({}));
                                throw new Error(errorData.message || `Chunk ${chunkIndex} failed.`);
                            }
                            job.chunksSent++;
                            job.sentBytes += chunk.size;
                            job.progress = (job.chunksSent / job.totalChunks) * 100;
                            this.uploadStats.totalSentBytes += chunk.size;
                            this.calculateSpeed(this.uploadStats);
                        } catch (err) {
                            job.status = 'error';
                            job.errorMessage = err.message;
                            reject(err);
                            return;
                        }
                    }
                };
                const workers = Array(this.MAX_CONCURRENT_CHUNKS).fill(null).map(() => worker());
                Promise.all(workers).then(resolve).catch(reject);
            });

            job.status = 'finalizing';
            await this.finalizeUpload(job);

        } catch (error) {
            console.error(`[Holaf ModelManager] Upload failed for ${job.file.name}:`, error);
        }
    },

    async finalizeUpload(job) {
        try {
            const response = await fetch('/holaf/models/finalize-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    upload_id: job.id, filename: job.file.name, total_chunks: job.totalChunks,
                    destination_type: job.destType, subfolder: job.subfolder
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Finalization failed.');
            job.status = 'done';
            this.refreshAfterUpload = true;
        } catch (error) {
            console.error(`[Holaf ModelManager] Finalization failed for ${job.file.name}:`, error);
            job.status = 'error';
            job.errorMessage = error.message;
        }
    },

    // --- DOWNLOAD LOGIC ---
    addSelectedToDownloadQueue() {
        if (this.isLoading) return;

        const allSelectedPaths = Array.from(this.selectedModelPaths);
        const pathsToDownload = allSelectedPaths.filter(path => !this.isPathInActiveTransfer(path));
        const skippedCount = allSelectedPaths.length - pathsToDownload.length;

        if (skippedCount > 0 && pathsToDownload.length > 0) {
            HolafPanelManager.createDialog({ title: "Download Notice", message: `${skippedCount} file(s) were skipped as they are already being transferred.` });
        }

        if (pathsToDownload.length === 0) {
            HolafPanelManager.createDialog({ title: "Download Models", message: "No available models selected for download." });
            return;
        }

        for (const path of pathsToDownload) {
            const model = this.models.find(m => m.path === path);
            if (model) {
                const totalChunks = Math.ceil(model.size_bytes / this.DOWNLOAD_CHUNK_SIZE);
                const job = {
                    model: model,
                    id: `holaf-download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    status: 'queued',
                    progress: 0,
                    chunksReceived: 0,
                    totalChunks: totalChunks,
                    receivedBytes: 0,
                    chunksData: new Array(totalChunks),
                    errorMessage: null,
                };
                this.downloadQueue.push(job);
            }
        }

        this.selectedModelPaths.clear();
        this.filterModels();
        this.updateActionButtonsState();

        if (!this.isDownloading) {
            this.processDownloadQueue();
        }
    },

    async processDownloadQueue() {
        if (this.activeDownloads >= this.MAX_CONCURRENT_DOWNLOADS) return;

        const nextJob = this.downloadQueue.find(j => j.status === 'queued');
        if (!nextJob) {
            if (this.activeDownloads === 0) {
                this.isDownloading = false;
                if (!this.isUploading && !this.isDeepScanning) {
                    const statusBar = document.getElementById("holaf-manager-statusbar");
                    if (statusBar) statusBar.textContent = "Status: All downloads completed.";

                    if (this.statusUpdateRaf) cancelAnimationFrame(this.statusUpdateRaf);
                    this.statusUpdateRaf = null;

                    setTimeout(() => this.filterModels(), 3000);
                }
                this.downloadQueue = [];
                this.updateActionButtonsState();
            }
            return;
        }

        this.isDownloading = true;
        this.updateActionButtonsState();
        this.activeDownloads++;
        nextJob.status = 'downloading';

        if (!this.statusUpdateRaf) {
            this.statusUpdateRaf = requestAnimationFrame(() => this.updateStatusBarText());
        }
        this.downloadStats.totalBytes += nextJob.model.size_bytes;

        await this.downloadFile(nextJob);

        this.activeDownloads--;
        this.processDownloadQueue();
    },

    async downloadFile(job) {
        try {
            const chunkIndices = [...Array(job.totalChunks).keys()];
            let parallelQueue = chunkIndices.slice();

            await new Promise((resolve, reject) => {
                const worker = async () => {
                    while (parallelQueue.length > 0) {
                        const chunkIndex = parallelQueue.shift();
                        if (chunkIndex === undefined) continue;

                        try {
                            const response = await fetch('/holaf/models/download-chunk', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    path: job.model.path,
                                    chunk_index: chunkIndex,
                                    chunk_size: this.DOWNLOAD_CHUNK_SIZE,
                                })
                            });
                            if (!response.ok) {
                                const errorText = await response.text();
                                throw new Error(errorText || `Chunk ${chunkIndex} download failed.`);
                            }
                            const chunkBlob = await response.blob();
                            job.chunksData[chunkIndex] = chunkBlob;

                            job.chunksReceived++;
                            job.receivedBytes += chunkBlob.size;
                            job.progress = (job.chunksReceived / job.totalChunks) * 100;
                            this.downloadStats.totalReceivedBytes += chunkBlob.size;
                            this.calculateSpeed(this.downloadStats);
                        } catch (err) {
                            job.status = 'error';
                            job.errorMessage = err.message;
                            reject(err);
                            return;
                        }
                    }
                };
                const workers = Array(this.MAX_CONCURRENT_CHUNKS).fill(null).map(() => worker());
                Promise.all(workers).then(resolve).catch(reject);
            });

            await this.assembleAndSaveFile(job);

        } catch (error) {
            console.error(`[Holaf ModelManager] Download failed for ${job.model.name}:`, error);
            job.status = 'error';
            job.errorMessage = error.message || "Unknown download error";
        }
    },

    async assembleAndSaveFile(job) {
        job.status = 'assembling';
        try {
            const finalBlob = new Blob(job.chunksData, { type: 'application/octet-stream' });

            if (finalBlob.size !== job.model.size_bytes) {
                throw new Error(`Assembled file size mismatch. Expected ${job.model.size_bytes}, got ${finalBlob.size}.`);
            }

            const url = window.URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = job.model.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => window.URL.revokeObjectURL(url), 1000);

            job.status = 'done';
            job.chunksData = null;
        } catch (error) {
            console.error(`[Holaf ModelManager] Assembly failed for ${job.model.name}:`, error);
            job.status = 'error';
            job.errorMessage = error.message;
        }
    },

    // --- SHARED UTILITIES ---
    calculateSpeed(statsObject) {
        const now = Date.now();
        const byteSource = statsObject === this.uploadStats ? this.uploadStats.totalSentBytes : this.downloadStats.totalReceivedBytes;

        statsObject.history.push({ time: now, bytes: byteSource });
        while (statsObject.history.length > 20 && now - statsObject.history[0].time > 5000) {
            statsObject.history.shift();
        }
        if (statsObject.history.length > 1) {
            const first = statsObject.history[0];
            const last = statsObject.history[statsObject.history.length - 1];
            const deltaTime = (last.time - first.time) / 1000;
            if (deltaTime > 0.1) {
                const deltaBytes = last.bytes - first.bytes;
                statsObject.currentSpeed = (deltaBytes / deltaTime) / (1024 * 1024);
            }
        }
    },

    updateStatusBarText() {
        const statusBar = document.getElementById("holaf-manager-statusbar");
        if (!statusBar) return;

        let statusParts = [];
        let operationActive = this.isUploading || this.isDownloading || this.isDeepScanning;

        if (this.isUploading) {
            const currentJob = this.uploadQueue.find(j => j.status === 'uploading' || j.status === 'finalizing');
            const queuedJobs = this.uploadQueue.filter(j => j.status === 'queued').length;
            if (currentJob) {
                const speed = this.uploadStats.currentSpeed > 0 ? this.uploadStats.currentSpeed.toFixed(2) : '...';
                statusParts.push(`Uploading: ${currentJob.file.name} (${currentJob.progress.toFixed(1)}%) @ ${speed} MB/s`);
            }
            if (queuedJobs > 0) statusParts.push(`${queuedJobs} upload(s) queued`);
        }

        if (this.isDownloading) {
            const currentJob = this.downloadQueue.find(j => j.status === 'downloading' || j.status === 'assembling');
            const queuedJobs = this.downloadQueue.filter(j => j.status === 'queued').length;
            if (currentJob) {
                const speed = this.downloadStats.currentSpeed > 0 ? this.downloadStats.currentSpeed.toFixed(2) : '...';
                statusParts.push(`Downloading: ${currentJob.model.name} (${currentJob.progress.toFixed(1)}%) @ ${speed} MB/s`);
            }
            if (queuedJobs > 0) statusParts.push(`${queuedJobs} download(s) queued`);
        }

        if (this.isDeepScanning) {
            statusParts.push(`Scanning ${this.scanQueue.length} more models...`);
        }

        const erroredUploads = this.uploadQueue.filter(j => j.status === 'error').length;
        if (erroredUploads > 0) statusParts.push(`${erroredUploads} upload error(s)`);

        const erroredDownloads = this.downloadQueue.filter(j => j.status === 'error').length;
        if (erroredDownloads > 0) statusParts.push(`${erroredDownloads} download error(s)`);

        if (operationActive) {
            statusBar.textContent = 'Status: ' + (statusParts.length > 0 ? statusParts.join(' | ') : 'Processing...');
            this.statusUpdateRaf = requestAnimationFrame(() => this.updateStatusBarText());
        } else {
            if (this.statusUpdateRaf) cancelAnimationFrame(this.statusUpdateRaf);
            this.statusUpdateRaf = null;
            this.filterModels(); // This will set the default status text
        }
    },

    async show() {
        if (!this.panelElements || !this.panelElements.panelEl) {
            if (!this.areSettingsLoaded) {
                await this.loadModelConfigAndSettings();
            }
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
                this.uploadDialog.dialogEl.style.display = 'none';
                this.setModal(false);
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
    },
};

app.registerExtension({
    name: "Holaf.ModelManager.Panel",
    async setup() {
        holafModelManager.ensureMenuItemAdded();
        await holafModelManager.loadModelConfigAndSettings();
    },
});

export default holafModelManager;