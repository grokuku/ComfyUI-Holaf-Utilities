/*
 * Holaf Utilities - Model Manager UI
 * This module is responsible for creating and managing the DOM elements of the Model Manager,
 * including the main panel, dialogs, and theme/zoom controls.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";
import { HOLAF_THEMES } from "../holaf_themes.js";

/**
 * Creates the main panel for the Model Manager.
 * @param {object} manager - The main model manager instance.
 */
export function createPanel(manager) {
    if (manager.panelElements && manager.panelElements.panelEl) {
        applySettingsToPanel(manager);
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
    const themeMenu = createThemeMenu(manager);
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
    zoomOutButton.onclick = () => manager.decreaseZoom();

    const zoomInButton = document.createElement("button");
    zoomInButton.className = "holaf-header-button";
    zoomInButton.title = "Zoom In";
    zoomInButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    zoomInButton.onclick = () => manager.increaseZoom();

    managerHeaderControls.append(themeButtonContainer, zoomOutButton, zoomInButton);

    try {
        manager.panelElements = HolafPanelManager.createPanel({
            id: "holaf-manager-panel",
            title: "Holaf Model Manager",
            headerContent: managerHeaderControls,
            defaultSize: { width: manager.settings.panel_width, height: manager.settings.panel_height },
            defaultPosition: { x: manager.settings.panel_x, y: manager.settings.panel_y },
            onClose: () => {
                if (manager.uploadDialog && manager.uploadDialog.dialogEl) {
                    manager.uploadDialog.dialogEl.style.display = 'none';
                }
            },
            onStateChange: (newState) => {
                if (!manager.settings.panel_is_fullscreen) {
                    manager.settings.panel_x = newState.x;
                    manager.settings.panel_y = newState.y;
                    manager.settings.panel_width = newState.width;
                    manager.settings.panel_height = newState.height;
                    manager.saveSettings();
                }
            },
            onFullscreenToggle: (isFullscreen) => {
                manager.settings.panel_is_fullscreen = isFullscreen;
                manager.saveSettings();
            }
        });
    } catch (e) {
        console.error("[Holaf ModelManager] Error during HolafPanelManager.createPanel:", e);
        HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating panel. Check console for details." });
        return;
    }

    populatePanelContent(manager);
    createUploadDialog(manager);
    applySettingsToPanel(manager);
}

/**
 * Creates the HTML content inside the main panel.
 * @param {object} manager - The main model manager instance.
 */
function populatePanelContent(manager) {
    const contentEl = manager.panelElements.contentEl;
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
            <div class="holaf-manager-header-col holaf-header-name" data-sort-by="name">Name</div>
            <div class="holaf-manager-header-col holaf-header-path" data-sort-by="path">Path</div>
            <div class="holaf-manager-header-col holaf-header-type" data-sort-by="display_type">Type</div>
            <div class="holaf-manager-header-col holaf-header-family" data-sort-by="model_family">Family</div>
            <div class="holaf-manager-header-col holaf-header-size" data-sort-by="size_bytes">Size</div>
        </div>
        <div id="holaf-manager-models-area" class="holaf-manager-content">
            <p class="holaf-manager-message">Initializing...</p>
        </div>
        <div id="holaf-manager-statusbar" class="holaf-manager-statusbar">
            Status: Ready
        </div>
    `;

    // Event Listeners
    document.getElementById("holaf-manager-type-select").onchange = (e) => {
        manager.settings.filter_type = e.target.value;
        manager.filterModels();
        manager.saveSettings();
    };
    document.getElementById("holaf-manager-search-input").oninput = (e) => {
        manager.settings.filter_search_text = e.target.value;
        manager.filterModels();
        manager.saveSettings();
    };
    document.getElementById("holaf-manager-upload-button").onclick = () => showUploadDialog(manager);
    document.getElementById("holaf-manager-download-button").onclick = () => manager.addSelectedToDownloadQueue();
    document.getElementById("holaf-manager-deep-scan-button").onclick = () => manager.addSelectedToScanQueue();
    document.getElementById("holaf-manager-delete-button").onclick = () => manager.performDelete();

    contentEl.querySelectorAll(".holaf-manager-list-header .holaf-manager-header-col[data-sort-by]").forEach(headerCol => {
        headerCol.onclick = () => {
            const sortBy = headerCol.dataset.sortBy;
            if (manager.currentSort.column === sortBy) {
                manager.currentSort.order = manager.currentSort.order === 'asc' ? 'desc' : 'asc';
            } else {
                manager.currentSort.column = sortBy;
                manager.currentSort.order = 'asc';
            }
            manager.settings.sort_column = manager.currentSort.column;
            manager.settings.sort_order = manager.currentSort.order;
            manager.filterModels();
            manager.saveSettings();
        };
    });

    contentEl.querySelector("#holaf-manager-select-all-checkbox").onclick = (e) => {
        const isChecked = e.target.checked;
        const modelsArea = document.getElementById("holaf-manager-models-area");
        modelsArea.querySelectorAll(".holaf-model-checkbox").forEach(cb => {
            if (cb.checked !== isChecked) {
                cb.click(); // Simulate click to trigger onchange event
            }
        });
    };
    manager.updateActionButtonsState();
}

/**
 * Creates the floating dialog for file uploads.
 * @param {object} manager - The main model manager instance.
 */
export function createUploadDialog(manager) {
    if (manager.uploadDialog && manager.uploadDialog.dialogEl) return;

    const dialogEl = document.createElement("div");
    dialogEl.id = "holaf-manager-upload-dialog";
    dialogEl.className = "holaf-utility-panel";
    dialogEl.style.cssText = `
        width: 500px; height: auto; max-height: 70vh; display: none; 
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        z-index: 1005; flex-direction: column;
        font-size: calc(1em * var(--holaf-mm-zoom-factor));
    `;

    const header = document.createElement("div");
    header.className = "holaf-utility-header";
    header.innerHTML = `<span>Upload Models</span><button class="holaf-utility-close-button" style="margin-left:auto;">✖</button>`;
    header.querySelector('.holaf-utility-close-button').onclick = () => {
        dialogEl.style.display = 'none';
    };
    HolafPanelManager.makeDraggable(dialogEl, header);

    const content = document.createElement("div");
    content.className = "holaf-utility-content";
    content.innerHTML = `
        <div style="margin-bottom: 15px;">
            <label for="holaf-upload-dest-type" class="holaf-label">Destination Type:</label>
            <select id="holaf-upload-dest-type" class="holaf-manager-search"></select>
        </div>
        <div style="margin-bottom: 15px;">
            <label for="holaf-upload-subfolder" class="holaf-label">Subfolder (optional):</label>
            <input type="text" id="holaf-upload-subfolder" class="holaf-manager-search" placeholder="e.g., characters/female">
        </div>
        <hr class="holaf-hr">
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

    manager.uploadDialog = {
        dialogEl,
        destTypeSelect: dialogEl.querySelector("#holaf-upload-dest-type"),
        subfolderInput: dialogEl.querySelector("#holaf-upload-subfolder"),
        fileInput: dialogEl.querySelector("#holaf-upload-file-input"),
        fileListEl: dialogEl.querySelector("#holaf-upload-file-list"),
        addQueueButton: dialogEl.querySelector("#holaf-upload-add-queue-button"),
        statusMessage: dialogEl.querySelector("#holaf-upload-status")
    };

    dialogEl.querySelector("label[for='holaf-upload-file-input']").onclick = () => manager.uploadDialog.fileInput.click();
    manager.uploadDialog.fileInput.onchange = () => previewSelectedFiles(manager);
    manager.uploadDialog.addQueueButton.onclick = () => manager.addFilesToUploadQueue();
}

/**
 * Shows the upload dialog.
 * @param {object} manager - The main model manager instance.
 */
function showUploadDialog(manager) {
    if (manager.isLoading) {
        HolafPanelManager.createDialog({ title: "Operation in Progress", message: "Please wait for the model list to load before uploading." });
        return;
    }
    if (!manager.uploadDialog) {
        createUploadDialog(manager);
    }
    manager.uploadDialog.dialogEl.style.display = 'flex';
    HolafPanelManager.bringToFront(manager.uploadDialog.dialogEl);
    
    if (manager.uploadDialog.fileInput) manager.uploadDialog.fileInput.value = "";
    if (manager.uploadDialog.fileListEl) {
        manager.uploadDialog.fileListEl.innerHTML = '';
        manager.uploadDialog.fileListEl.style.display = 'none';
    }
    if (manager.uploadDialog.statusMessage) manager.uploadDialog.statusMessage.textContent = "";
}

/**
 * Previews the files selected for upload.
 * @param {object} manager - The main model manager instance.
 */
function previewSelectedFiles(manager) {
    const { fileInput, fileListEl } = manager.uploadDialog;
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
}

/**
 * Applies current settings (theme, zoom, size, position) to the panel.
 * @param {object} manager - The main model manager instance.
 */
function applySettingsToPanel(manager) {
    if (manager.panelElements && manager.panelElements.panelEl) {
        setTheme(manager, manager.settings.theme);
        applyZoom(manager);

        if (manager.settings.panel_is_fullscreen) {
            manager.panelElements.panelEl.classList.add("holaf-panel-fullscreen");
        } else {
            manager.panelElements.panelEl.classList.remove("holaf-panel-fullscreen");
        }
        manager.panelElements.panelEl.style.width = `${manager.settings.panel_width}px`;
        manager.panelElements.panelEl.style.height = `${manager.settings.panel_height}px`;

        if (manager.settings.panel_x !== null && manager.settings.panel_y !== null) {
            manager.panelElements.panelEl.style.left = `${manager.settings.panel_x}px`;
            manager.panelElements.panelEl.style.top = `${manager.settings.panel_y}px`;
            manager.panelElements.panelEl.style.transform = 'none';
        } else {
            HolafPanelManager.centerElement(manager.panelElements.panelEl);
        }

        const typeSelect = document.getElementById("holaf-manager-type-select");
        if (typeSelect) typeSelect.value = manager.settings.filter_type || "All";

        const searchInput = document.getElementById("holaf-manager-search-input");
        if (searchInput) searchInput.value = manager.settings.filter_search_text || "";
    }
}

/**
 * Creates the dropdown menu for theme selection.
 * @param {object} manager - The main model manager instance.
 * @returns {HTMLUListElement} The menu element.
 */
function createThemeMenu(manager) {
    const menu = document.createElement("ul");
    menu.className = "holaf-theme-menu";
    HOLAF_THEMES.forEach(theme => {
        const item = document.createElement("li");
        item.textContent = theme.name;
        item.onclick = (e) => {
            e.stopPropagation();
            manager.setTheme(theme.name);
            menu.style.display = 'none';
        };
        menu.appendChild(item);
    });
    return menu;
}

/**
 * Applies the selected theme to the panel and dialogs.
 * @param {object} manager - The main model manager instance.
 * @param {string} themeName - The name of the theme to apply.
 */
export function setTheme(manager, themeName) {
    const themeConfig = HOLAF_THEMES.find(t => t.name === themeName);
    if (!themeConfig) {
        console.warn(`[Holaf ModelManager] Theme '${themeName}' not found. Defaulting.`);
        setTheme(manager, HOLAF_THEMES[0].name); // Recurse with default
        return;
    }
    manager.settings.theme = themeName;
    const elementsToTheme = [manager.panelElements?.panelEl, manager.uploadDialog?.dialogEl];
    
    elementsToTheme.forEach(el => {
        if(el) {
            HOLAF_THEMES.forEach(t => el.classList.remove(t.className));
            el.classList.add(themeConfig.className);
        }
    });

    manager.saveSettings();
}

/**
 * Applies the current zoom level to the panel and dialogs.
 * @param {object} manager - The main model manager instance.
 */
export function applyZoom(manager) {
    const elementsToZoom = [manager.panelElements?.panelEl, manager.uploadDialog?.dialogEl];
    elementsToZoom.forEach(el => {
        if(el) {
            el.style.setProperty('--holaf-mm-zoom-factor', manager.settings.zoom_level);
        }
    });
}