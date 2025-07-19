/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI
 *
 * This script provides the client-side logic for the Holaf Image Viewer.
 * It acts as a central coordinator, importing and orchestrating functionality
 * from specialized modules in the `js/image_viewer/` directory.
 * REFACTOR: Logic now pre-loads the full image list on startup for instant
 * panel display, and passes it to the virtualized gallery.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";

// Import State Manager
import { imageViewerState } from './image_viewer/image_viewer_state.js';

// Import modularized functionalities
import * as Settings from './image_viewer/image_viewer_settings.js';
import { UI, createThemeMenu } from './image_viewer/image_viewer_ui.js';
import { initGallery, syncGallery, refreshThumbnailInGallery } from './image_viewer/image_viewer_gallery.js';
import * as Actions from './image_viewer/image_viewer_actions.js';
import * as InfoPane from './image_viewer/image_viewer_infopane.js';
import * as Navigation from './image_viewer/image_viewer_navigation.js';
import { ImageEditor } from './image_viewer/image_viewer_editor.js';

const STATS_REFRESH_INTERVAL_MS = 2000;
const DOWNLOAD_CHUNK_SIZE = 5 * 1024 * 1024;
const FILTER_REFRESH_INTERVAL_MS = 5000;

// SVG icons for folder locks for better compatibility than emojis
const ICONS = {
    locked: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
    unlocked: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`
};

const holafImageViewer = {
    // --- State & Properties ---
    editor: null,
    panelElements: null,
    isInitialized: false,
    areSettingsLoaded: false,
    settings: {}, 
    fullscreenElements: null,
    _fullscreenSourceView: null,
    _lastFolderFilterState: null,
    filterRefreshIntervalId: null,
    zoomViewState: { scale: 1, tx: 0, ty: 0 },
    fullscreenViewState: { scale: 1, tx: 0, ty: 0 },
    statsRefreshIntervalId: null,
    exportStatusRaf: null,

    // --- Robust Filtering State ---
    isLoading: false, // Is a fetch request currently in flight?
    isDirty: false,   // Has a filter changed since the last fetch started?
    
    // --- Initialization & Core Lifecycle ---

    async init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        
        document.addEventListener("keydown", (e) => this._handleKeyDown(e));
        const cssId = "holaf-image-viewer-css";
        if (!document.getElementById(cssId)) {
            const link = document.createElement("link");
            link.id = cssId;
            link.rel = "stylesheet";
            link.type = "text/css";
            link.href = "extensions/ComfyUI-Holaf-Utilities/css/holaf_image_viewer.css";
            document.head.appendChild(link);
        }

        // --- PRE-LOADING LOGIC ---
        // Load settings first, then immediately trigger filter population and data fetch.
        await this.loadSettings();
        await this.loadAndPopulateFilters(true); 
    },

    async show() {
        if (!this.panelElements) {
            this.createPanel();
            // FIX: On first show, populate the UI from pre-loaded data.
            // Calling with 'isUpdate=true' tells the function to repopulate filters
            // but to SKIP re-fetching the main image list, which is already loaded.
            await this.loadAndPopulateFilters(false, true);
        }

        const panelIsVisible = this.panelElements?.panelEl && this.panelElements.panelEl.style.display === "flex";
        if (panelIsVisible) {
            this.hide();
            return;
        }

        if (this.panelElements?.panelEl) {
            this.applyPanelSettings();
            this._updateWorkflowButtonStates();
            this._updateSearchScopeButtonStates();
            this._applyFilterStateToInputs();
            
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl);
            
            // Re-sync gallery with the (already loaded) images from the state.
            const { images } = imageViewerState.getState();
            this.syncGallery(images);

            if (!this.filterRefreshIntervalId) {
                this.filterRefreshIntervalId = setInterval(() => this.checkForUpdates(), FILTER_REFRESH_INTERVAL_MS);
            }
            this._updateViewerActivity(true);
        }
    },

    hide() {
        if (this.panelElements?.panelEl) {
            this.panelElements.panelEl.style.display = "none";
            if (this.statsRefreshIntervalId) {
                clearInterval(this.statsRefreshIntervalId);
                this.statsRefreshIntervalId = null;
            }
            if (this.filterRefreshIntervalId) {
                clearInterval(this.filterRefreshIntervalId);
                this.filterRefreshIntervalId = null;
            }
            this._updateViewerActivity(false);
        }
    },

    // --- Settings Management (delegated) ---

    loadSettings: function () { return Settings.loadSettings(this); },
    saveSettings: function (newSettings) { return Settings.saveSettings(this, newSettings); },
    setTheme: function (themeName, doSave = true) { return Settings.setTheme(this, themeName, doSave); },
    applyPanelSettings: function () { return Settings.applyPanelSettings(this); },
    _applyThumbnailFit: function () { return Settings.applyThumbnailFit(imageViewerState.getState().ui.thumbnail_fit); },
    _applyThumbnailSize: function () {
        // This now just triggers a re-layout in the gallery module
        Settings.applyThumbnailSize(imageViewerState.getState().ui.thumbnail_size);
    },

    // --- UI Creation & Population (partially delegated) ---

    _createFullscreenOverlay() {
        if (document.getElementById('holaf-viewer-fullscreen-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'holaf-viewer-fullscreen-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML = `<button id="holaf-viewer-fs-close" class="holaf-viewer-fs-close" title="Close (Esc)">✖</button><button id="holaf-viewer-fs-prev" class="holaf-viewer-fs-nav" title="Previous (Left Arrow)">‹</button><img src="" /><button id="holaf-viewer-fs-next" class="holaf-viewer-fs-nav" title="Next (Right Arrow)">›</button>`;
        document.body.appendChild(overlay);
        this.fullscreenElements = {
            overlay,
            img: overlay.querySelector('img'),
            closeBtn: overlay.querySelector('#holaf-viewer-fs-close'),
            prevBtn: overlay.querySelector('#holaf-viewer-fs-prev'),
            nextBtn: overlay.querySelector('#holaf-viewer-fs-next')
        };
        this.fullscreenElements.closeBtn.onclick = () => this._handleEscape();
        this.fullscreenElements.prevBtn.onclick = () => this._navigate(-1);
        this.fullscreenElements.nextBtn.onclick = () => this._navigate(1);
        Navigation.setupZoomAndPan(this.fullscreenViewState, overlay, this.fullscreenElements.img);
    },

    createPanel() {
        if (this.panelElements && this.panelElements.panelEl) return;
        
        const state = imageViewerState.getState();
        const headerControls = document.createElement("div");
        headerControls.className = "holaf-header-button-group";
        const themeButtonContainer = document.createElement("div");
        themeButtonContainer.style.position = 'relative';
        const themeButton = document.createElement("button");
        themeButton.className = "holaf-header-button";
        themeButton.title = "Change Theme";
        themeButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 12.55a9.42 9.42 0 0 1-9.45 9.45 9.42 9.42 0 0 1-9.45-9.45 9.42 9.42 0 0 1 9.45-9.45 2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 1-2.5 2.5Z"/></svg>`;

        const themeMenu = createThemeMenu((themeName) => this.setTheme(themeName));
        themeButton.onclick = (e) => {
            e.stopPropagation();
            themeMenu.style.display = themeMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', () => {
            if (themeMenu) themeMenu.style.display = 'none'
        });

        themeButtonContainer.append(themeButton, themeMenu);
        headerControls.append(themeButtonContainer);

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-viewer-panel",
                title: "Holaf Image Viewer",
                headerContent: headerControls,
                defaultSize: { width: state.panel_width, height: state.panel_height },
                defaultPosition: { x: state.panel_x, y: state.panel_y },
                onClose: () => this.hide(),
                onStateChange: (newState) => this.saveSettings(newState),
                onFullscreenToggle: (isFullscreen) => this.saveSettings({ panel_is_fullscreen: isFullscreen }),
            });

            const typesToKeepFocus = ['text', 'search', 'number', 'password', 'url', 'email'];
            this.panelElements.panelEl.addEventListener('click', (e) => {
                const target = e.target;
                if (target.tagName === 'INPUT' && !typesToKeepFocus.includes(target.type)) {
                    target.blur();
                }
            });

            this.populatePanelContent();
            this.applyPanelSettings();
            this._createFullscreenOverlay();
            this._attachActionListeners();
            
            // Initialize modules that depend on the panel DOM
            InfoPane.setupInfoPane();
            this.editor = new ImageEditor(this);
            this.editor.init();
            initGallery(this);

        } catch (e) {
            console.error("[Holaf ImageViewer] Error creating panel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating Image Viewer panel. Check console for details." });
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;

        UI.init(contentEl, {
            getViewer: () => this,
            onFilterChange: () => this.triggerFilterChange(),
            onResetFilters: () => this._resetFilters(),
        });

        this._updateActionButtonsState();
    },

    // --- Action Management (delegated) ---

    _attachActionListeners: function () { return Actions.attachActionListeners(this); },
    _updateActionButtonsState: function () { return Actions.updateActionButtonsState(this); },
    handleDelete: function () { return Actions.handleDelete(this); },
    handleRestore: function () { return Actions.handleRestore(this); },
    handleExport: function () { return Actions.handleExport(this); },
    handleExtractMetadata: function () { return Actions.handleExtractMetadata(this); },
    handleInjectMetadata: function () { return Actions.handleInjectMetadata(this); },

    async _handleEmptyTrash() {
        if (await HolafPanelManager.createDialog({
            title: "Confirm Empty Trash",
            message: "Are you sure you want to permanently delete ALL files in the trashcan?\nThis action cannot be undone.",
            buttons: [
                { text: "Cancel", value: false, type: "cancel" },
                { text: "Permanently Delete", value: true, type: "danger" }
            ]
        })) {
            try {
                const response = await fetch("/holaf/images/empty-trashcan", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                });
                const result = await response.json();

                if (response.ok) {
                    HolafPanelManager.createDialog({
                        title: "Trash Emptied",
                        message: result.message || "The trashcan has been successfully emptied.",
                        buttons: [{ text: "OK", value: true }]
                    });
                    this.loadAndPopulateFilters();
                } else {
                    HolafPanelManager.createDialog({
                        title: "Error",
                        message: `Failed to empty trashcan: ${result.message || 'Unknown server error.'}`,
                        buttons: [{ text: "OK", value: true }]
                    });
                }
            } catch (error) {
                console.error("[Holaf ImageViewer] Error calling empty-trashcan API:", error);
                HolafPanelManager.createDialog({
                    title: "API Error",
                    message: `Error communicating with the server: ${error.message}`,
                    buttons: [{ text: "OK", value: true }]
                });
            }
        }
    },

    // --- Data Loading & Filtering ---

    triggerFilterChange() {
        this._saveCurrentFilterState();
        if (this.isLoading) {
            this.isDirty = true;
            return;
        }
        this.loadFilteredImages();
    },
    
    _applyFilterStateToInputs() {
        const state = imageViewerState.getState();
        const searchInput = document.getElementById('holaf-viewer-search-input');
        if (searchInput) searchInput.value = state.filters.search_text || '';
        
        const startDateInput = document.getElementById('holaf-viewer-date-start');
        if (startDateInput) startDateInput.value = state.filters.startDate || '';

        const endDateInput = document.getElementById('holaf-viewer-date-end');
        if (endDateInput) endDateInput.value = state.filters.endDate || '';
    },

    async checkForUpdates() {
        if (this.isLoading) return;
        try {
            const response = await fetch('/holaf/images/last-update-time', { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();

            const state = imageViewerState.getState();
            if (data.last_update > state.status.lastDbUpdateTime) {
                console.log("[Holaf ImageViewer] New data detected on server, refreshing filters.");
                imageViewerState.setState({ status: { lastDbUpdateTime: data.last_update }});
                await this.loadAndPopulateFilters(false, true);
            }
        } catch (e) {
            console.error("[Holaf ImageViewer] Error checking for updates:", e);
        }
    },
    
    _performFullReset(resetLocks) {
        const newFilters = {
            search_text: '',
            startDate: '',
            endDate: '',
            search_scope_name: true,
            search_scope_prompt: true,
            search_scope_workflow: true,
            workflow_filter_internal: true,
            workflow_filter_external: true,
        };
        if (resetLocks) {
            newFilters.locked_folders = [];
        }
        this.saveSettings(newFilters);
        
        this._applyFilterStateToInputs();
        this._updateSearchScopeButtonStates();
        this._updateWorkflowButtonStates();
        
        const { locked_folders } = imageViewerState.getState().filters;
        document.querySelectorAll('#holaf-viewer-folders-filter input[type="checkbox"]').forEach(cb => {
            const item = cb.closest('.holaf-viewer-filter-item');
            const folderId = item ? item.dataset.folderId : null;
            
            cb.disabled = false;

            if (!resetLocks && folderId && locked_folders.includes(folderId)) {
                // Do nothing
            } else {
                cb.checked = true; 
            }
        });

        document.querySelectorAll('#holaf-viewer-formats-filter input[type="checkbox"]').forEach(cb => cb.checked = true);
        
        if (resetLocks) {
            document.querySelectorAll('.holaf-folder-lock-icon.locked').forEach(icon => {
                icon.classList.remove('locked');
                icon.innerHTML = ICONS.unlocked;
                icon.title = 'Lock this folder (prevents changes from All/None/Invert)';
            });
        }
        
        const trashCheckbox = document.getElementById('folder-filter-trashcan');
        if (trashCheckbox) {
            trashCheckbox.checked = false;
        }
        
        this.triggerFilterChange();
    },

    async _resetFilters() {
        const { locked_folders } = imageViewerState.getState().filters;

        if (locked_folders.length === 0) {
            this._performFullReset(true);
            return;
        }

        const choice = await HolafPanelManager.createDialog({
            title: "Reset Filters Confirmation",
            message: "You have locked folders. How would you like to proceed?",
            buttons: [
                { text: "Cancel", value: "cancel", type: "cancel" },
                { text: "Reset (Keep Locks)", value: "reset_keep_locks" },
                { text: "Unlock & Reset All", value: "unlock_and_reset", type: "confirm" }
            ]
        });

        switch (choice) {
            case "unlock_and_reset":
                this._performFullReset(true);
                break;
            case "reset_keep_locks":
                this._performFullReset(false);
                break;
            case "cancel":
            default:
                return;
        }
    },

    _saveCurrentFilterState() {
        if (!this.panelElements) return; // Don't save if panel isn't even created
        const selectedFolders = [...document.querySelectorAll('#holaf-viewer-folders-filter input:checked')].map(cb => cb.id.replace('folder-filter-', ''));
        const selectedFormats = [...document.querySelectorAll('#holaf-viewer-formats-filter input:checked')].map(cb => cb.id.replace('format-filter-', ''));
        const startDate = document.getElementById('holaf-viewer-date-start').value;
        const endDate = document.getElementById('holaf-viewer-date-end').value;
        const searchText = document.getElementById('holaf-viewer-search-input').value;

        this.saveSettings({
            folder_filters: selectedFolders,
            format_filters: selectedFormats,
            startDate,
            endDate,
            search_text: searchText,
            locked_folders: imageViewerState.getState().filters.locked_folders,
        });
    },
    
    async loadAndPopulateFilters(isInitialLoad = false, isUpdate = false) {
        try {
            const response = await fetch('/holaf/images/filter-options', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const data = await response.json();
            
            const state = imageViewerState.getState();
            imageViewerState.setState({ status: { lastDbUpdateTime: data.last_update_time || state.status.lastDbUpdateTime }});

            const useSavedFolderFilters = state.filters.folder_filters && state.filters.folder_filters.length > 0 && !isUpdate;
            const useSavedFormatFilters = state.filters.format_filters && state.filters.format_filters.length > 0 && !isUpdate;

            if (this.panelElements) {
                const currentSelectedFolders = isUpdate ? new Set([...document.querySelectorAll('#holaf-viewer-folders-filter input:checked')].map(cb => cb.id.replace('folder-filter-', ''))) : null;
                const currentSelectedFormats = isUpdate ? new Set([...document.querySelectorAll('#holaf-viewer-formats-filter input:checked')].map(cb => cb.id.replace('format-filter-', ''))) : null;
    
                const allFolders = new Set(data.subfolders.map(p => p.split('/')[0]));
                allFolders.delete('trashcan');
                const sortedFolders = Array.from(allFolders).sort();
    
                const foldersEl = document.getElementById('holaf-viewer-folders-filter');
                const formatsEl = document.getElementById('holaf-viewer-formats-filter');
                
                if (foldersEl) foldersEl.innerHTML = '';
                if (formatsEl) formatsEl.innerHTML = '';
                
                const onFilterChange = () => this.triggerFilterChange();
    
                const createFolderCheckbox = (folder, isRoot = false) => {
                    const id = isRoot ? 'root' : folder;
                    let isChecked = true;
                    if (isUpdate) { isChecked = currentSelectedFolders.has(id); }
                    else if (useSavedFolderFilters) { isChecked = state.filters.folder_filters.includes(id); }
                    return this.createFilterItem(`folder-filter-${id}`, isRoot ? '(root)' : folder, isChecked, onFilterChange, id);
                };
    
                if (foldersEl) {
                    if (data.has_root) foldersEl.appendChild(createFolderCheckbox(null, true));
                    sortedFolders.forEach(folder => foldersEl.appendChild(createFolderCheckbox(folder)));
        
                    const separator = document.createElement('div');
                    separator.className = 'holaf-viewer-trash-separator';
                    foldersEl.appendChild(separator);
        
                    let isTrashChecked = false;
                    if (isUpdate) { isTrashChecked = currentSelectedFolders.has('trashcan'); }
                    else if (useSavedFolderFilters) { isTrashChecked = state.filters.folder_filters.includes('trashcan'); }
        
                    const trashCheckboxItem = this.createFilterItem('folder-filter-trashcan', '🗑️ Trashcan', isTrashChecked, (e) => {
                        const otherFolderCheckboxes = foldersEl.querySelectorAll('input[type="checkbox"]:not(#folder-filter-trashcan)');
                        if (e.target.checked) {
                            this._lastFolderFilterState = [...otherFolderCheckboxes].filter(cb => cb.checked).map(cb => cb.id);
                            otherFolderCheckboxes.forEach(cb => { cb.checked = false; cb.disabled = true; });
                        } else {
                            otherFolderCheckboxes.forEach(cb => {
                                cb.disabled = false;
                                if (this._lastFolderFilterState && this._lastFolderFilterState.includes(cb.id)) {
                                    cb.checked = true;
                                }
                            });
                        }
                        onFilterChange();
                    });
        
                    const trashContainer = trashCheckboxItem;
                    trashContainer.style.display = 'flex';
                    trashContainer.style.justifyContent = 'space-between';
                    trashContainer.style.alignItems = 'center';
        
                    const emptyTrashBtn = document.createElement('button');
                    emptyTrashBtn.textContent = 'Empty';
                    emptyTrashBtn.title = 'Permanently delete all files in the trashcan';
                    emptyTrashBtn.style.cssText = 'font-size: 10px; padding: 2px 6px; margin-left: 10px; background-color: #802020; color: white; border: 1px solid #c03030; cursor: pointer; border-radius: 4px;';
                    emptyTrashBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this._handleEmptyTrash(); };
                    trashContainer.appendChild(emptyTrashBtn);
                    foldersEl.appendChild(trashContainer);
        
                    if (trashCheckboxItem.querySelector('input').checked) {
                        foldersEl.querySelectorAll('input[type="checkbox"]:not(#folder-filter-trashcan)').forEach(cb => cb.disabled = true);
                    }
                }
    
                if (formatsEl) {
                    data.formats.forEach(format => {
                        let isChecked = true;
                        if (isUpdate) { isChecked = currentSelectedFormats.has(format); }
                        else if (useSavedFormatFilters) { isChecked = state.filters.format_filters.includes(format); }
                        formatsEl.appendChild(this.createFilterItem(`format-filter-${format}`, format, isChecked, onFilterChange));
                    });
                }
            }


            if (!isUpdate) {
                await this.loadFilteredImages(isInitialLoad);
            }
        } catch (e) {
            console.error("[Holaf ImageViewer] Failed to load filter options:", e);
            if (this.panelElements && document.getElementById('holaf-viewer-folders-filter')) {
                document.getElementById('holaf-viewer-folders-filter').innerHTML = `<p class="holaf-viewer-message error">Error loading filters.</p>`;
            }
        }
    },
    
    async _fetchFilteredImages() {
        const { filters } = imageViewerState.getState();
        const { folder_filters, format_filters, startDate, endDate, search_text, 
                workflow_filter_internal, workflow_filter_external,
                search_scope_name, search_scope_prompt, search_scope_workflow } = filters;

        let workflowFilter = 'all';
        if (workflow_filter_internal && workflow_filter_external) workflowFilter = 'present';
        else if (workflow_filter_internal) workflowFilter = 'internal';
        else if (workflow_filter_external) workflowFilter = 'external';
        else workflowFilter = 'none';

        const searchScopes = [];
        if (search_scope_name) searchScopes.push('name');
        if (search_scope_prompt) searchScopes.push('prompt');
        if (search_scope_workflow) searchScopes.push('workflow');

        const response = await fetch('/holaf/images/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folder_filters, format_filters, startDate, endDate,
                workflow_filter: workflowFilter,
                search_text,
                search_scopes: searchScopes
            })
        });
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        return await response.json();
    },

    async loadFilteredImages(isInitialLoad = false) {
        this.isLoading = true;
        this.isDirty = false;
        
        try {
            const { filters } = imageViewerState.getState();
            if (!filters.folder_filters || filters.folder_filters.length === 0) {
                 if (isInitialLoad) {
                    // On first load ever, select all folders by default.
                    // This relies on filter options being loaded first.
                 } else {
                    imageViewerState.setState({ images: [], selectedImages: new Set(), activeImage: null, currentNavIndex: -1 });
                    this.syncGallery([]);
                    this.updateStatusBar(0, imageViewerState.getState().status.totalImageCount);
                    this._updateActionButtonsState();
                    this.isLoading = false;
                    this.isDirty = false;
                    return;
                }
            }

            if (isInitialLoad && this.panelElements) {
                this.setLoadingState("Applying filters...");
            }

            const currentState = imageViewerState.getState();
            const currentSelectedPaths = new Set(Array.from(currentState.selectedImages).map(img => img.path_canon));
            const activeImageCanonPath = currentState.activeImage ? currentState.activeImage.path_canon : null;
            
            imageViewerState.setState({ selectedImages: new Set() });

            const data = await this._fetchFilteredImages();
            const newImages = data.images || [];
            
            const newSelectedImages = new Set();
            if (currentSelectedPaths.size > 0) {
                newImages.forEach(img => {
                    if (currentSelectedPaths.has(img.path_canon)) {
                        newSelectedImages.add(img);
                    }
                });
            }

            let newActiveImage = null;
            let newNavIndex = -1;

            if (activeImageCanonPath) {
                newNavIndex = newImages.findIndex(img => img.path_canon === activeImageCanonPath);
                if (newNavIndex > -1) {
                    newActiveImage = newImages[newNavIndex];
                }
            }

            imageViewerState.setState({ 
                images: newImages, 
                selectedImages: newSelectedImages,
                activeImage: newActiveImage, 
                currentNavIndex: newNavIndex
            });
            
            this.syncGallery(newImages);
            this.updateStatusBar(data.filtered_count, data.total_db_count);
            
            const allThumbsGenerated = data.total_db_count > 0 && data.generated_thumbnails_count >= data.total_db_count;
            imageViewerState.setState({ status: { 
                allThumbnailsGenerated: allThumbsGenerated,
                generatedThumbnailsCount: data.generated_thumbnails_count || 0,
            }});

            if (!allThumbsGenerated && !this.statsRefreshIntervalId) {
                this.statsRefreshIntervalId = setInterval(() => this.fetchAndUpdateThumbnailStats(), STATS_REFRESH_INTERVAL_MS);
            } else if (allThumbsGenerated && this.statsRefreshIntervalId) {
                clearInterval(this.statsRefreshIntervalId); this.statsRefreshIntervalId = null;
            }

        } catch (e) {
            console.error("[Holaf ImageViewer] Failed to load images:", e);
            if (this.panelElements) this.setLoadingState(`Error: ${e.message}`);
            imageViewerState.setState({ images: [], activeImage: null, currentNavIndex: -1, status: { error: e.message } });
        } finally {
            if (this.isDirty) {
                // Use a timeout to avoid synchronous loop if loadFilteredImages fails instantly
                setTimeout(() => this.loadFilteredImages(), 0);
            } else {
                this.isLoading = false;
            }
            this._updateActionButtonsState();
        }
    },

    // --- Gallery & Thumbnail Rendering (delegated) ---
    syncGallery: function (images) { 
        if (this.panelElements) { // Only sync if panel is created
             syncGallery(this, images);
        }
    },
    refreshSingleThumbnail: function (path_canon) { return refreshThumbnailInGallery(path_canon); },

    // --- Navigation & Interaction (delegated) ---
    _handleKeyDown: function (e) { return Navigation.handleKeyDown(this, e); },
    _navigate: function (direction) { return Navigation.navigate(this, direction); },
    _navigateGrid: function (direction) { return Navigation.navigateGrid(this, direction); },
    _handleEscape: function () { return Navigation.handleEscape(this); },
    _showZoomedView: function (image) { 
        if (image) Navigation.showZoomedView(this, image);
    },
    _hideZoomedView: function () { return Navigation.hideZoomedView(); },
    _showFullscreenView: function () { 
        const { activeImage } = imageViewerState.getState();
        if (activeImage) Navigation.showFullscreenView(this, activeImage);
    },
    _hideFullscreenView: function () { return Navigation.hideFullscreenView(this); },

    // --- Download Queue Processing ---
    _startStatusAnimation() {
        if (this.exportStatusRaf) return;
        const loop = () => {
            this.updateStatusBar();
            this.exportStatusRaf = requestAnimationFrame(loop);
        };
        this.exportStatusRaf = requestAnimationFrame(loop);
    },

    _stopStatusAnimation() {
        if (this.exportStatusRaf) {
            cancelAnimationFrame(this.exportStatusRaf);
            this.exportStatusRaf = null;
        }
    },

    async processExportDownloadQueue() {
        let state = imageViewerState.getState();
        if (state.exporting.queue.length === 0) {
            this._stopStatusAnimation();
            
            const newExportStats = { totalFiles: 0, completedFiles: 0, currentFileName: '', currentFileProgress: 0 };
            imageViewerState.setState({ 
                status: { isExporting: false },
                exporting: { stats: newExportStats, activeToastId: null }
            });

            if (state.exporting.activeToastId && state.exporting.stats.completedFiles > 0) {
                window.holaf.toastManager.update(state.exporting.activeToastId, {
                    message: `<strong>Export Queue Complete:</strong><br>${state.exporting.stats.completedFiles} file(s) downloaded.`,
                    type: 'success',
                    progress: 100
                });
                setTimeout(() => window.holaf.toastManager.hide(state.exporting.activeToastId), 5000);
            } else if (state.exporting.activeToastId) {
                window.holaf.toastManager.hide(state.exporting.activeToastId);
            }
            this.updateStatusBar();
            return;
        }

        this._startStatusAnimation();

        const newQueue = [...state.exporting.queue];
        const fileToDownload = newQueue.shift();
        const { export_id, path, size } = fileToDownload;
        const filename = path.split('/').pop();

        imageViewerState.setState({
            exporting: {
                queue: newQueue,
                stats: { ...state.exporting.stats, currentFileName: filename, currentFileProgress: 0 }
            }
        });
        
        state = imageViewerState.getState();

        let receivedBytes = 0;
        const chunks = [];
        const totalChunks = Math.ceil(size / DOWNLOAD_CHUNK_SIZE);

        try {
            for (let i = 0; i < totalChunks; i++) {
                const url = new URL(window.location.origin);
                url.pathname = '/holaf/images/export-chunk';
                url.search = new URLSearchParams({
                    export_id: export_id,
                    file_path: path,
                    chunk_index: i,
                    chunk_size: DOWNLOAD_CHUNK_SIZE
                });

                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error ${response.status} for chunk ${i}`);

                const chunk = await response.arrayBuffer();
                chunks.push(chunk);
                receivedBytes += chunk.byteLength;
                
                imageViewerState.setState({
                    exporting: {
                        stats: {
                            ...imageViewerState.getState().exporting.stats,
                            currentFileProgress: (receivedBytes / size) * 100
                        }
                    }
                });
            }

            const blob = new Blob(chunks);
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            
            const currentCompleted = imageViewerState.getState().exporting.stats.completedFiles;
            imageViewerState.setState({ exporting: { stats: { completedFiles: currentCompleted + 1 } } });
            
            setTimeout(() => this.processExportDownloadQueue(), 100);

        } catch (error) {
            console.error(`[Holaf ImageViewer] Failed to download file ${filename}:`, error);
            const activeToastId = imageViewerState.getState().exporting.activeToastId;
            if (activeToastId) {
                window.holaf.toastManager.update(activeToastId, {
                    message: `<strong>Download Failed:</strong><br>${filename}<br><small>${error.message}</small>`,
                    type: 'error',
                    progress: 100
                });
            }
            this._stopStatusAnimation();
            imageViewerState.setState({ status: { isExporting: false }, exporting: { activeToastId: null } });
            this.updateStatusBar();
        }
    },

    // --- Status & Helpers ---

    _updateWorkflowButtonStates() {
        if (!this.panelElements) return;
        const filters = imageViewerState.getState().filters;
        const internalBtn = document.getElementById('holaf-workflow-filter-internal');
        const externalBtn = document.getElementById('holaf-workflow-filter-external');
        if (internalBtn) internalBtn.classList.toggle('active', filters.workflow_filter_internal);
        if (externalBtn) externalBtn.classList.toggle('active', filters.workflow_filter_external);
    },

    _updateSearchScopeButtonStates() {
        if (!this.panelElements) return;
        const filters = imageViewerState.getState().filters;
        document.getElementById('holaf-search-scope-filename')?.classList.toggle('active', filters.search_scope_name);
        document.getElementById('holaf-search-scope-prompt')?.classList.toggle('active', filters.search_scope_prompt);
        document.getElementById('holaf-search-scope-workflow')?.classList.toggle('active', filters.search_scope_workflow);
    },

    _updateActiveThumbnail(navIndex) {
        // Handled by virtual renderer.
    },

    async fetchAndUpdateThumbnailStats() {
        if (this.isLoading) return; // Don't check stats during a load
        const state = imageViewerState.getState();
        if (state.status.allThumbnailsGenerated && this.statsRefreshIntervalId) {
            clearInterval(this.statsRefreshIntervalId); this.statsRefreshIntervalId = null; return;
        }
        try {
            const response = await fetch('/holaf/images/thumbnail-stats');
            if (!response.ok) return;
            const stats = await response.json();
            
            const allGenerated = stats.generated_thumbnails_count >= stats.total_db_count;
            imageViewerState.setState({ status: {
                allThumbnailsGenerated: allGenerated,
                generatedThumbnailsCount: stats.generated_thumbnails_count,
                totalImageCount: stats.total_db_count
            }});
            
            this.updateStatusBar();

            if (allGenerated && this.statsRefreshIntervalId) {
                clearInterval(this.statsRefreshIntervalId); this.statsRefreshIntervalId = null;
            }
        } catch (e) { /* silent fail */ }
    },

    updateStatusBar(filteredCount, totalCount) {
        const statusBarEl = document.getElementById('holaf-viewer-statusbar');
        if (!statusBarEl) return;
        const state = imageViewerState.getState();

        if (state.status.isExporting) {
            const progress = state.exporting.stats.currentFileProgress.toFixed(1);
            const text = `Exporting (${state.exporting.stats.completedFiles + 1}/${state.exporting.stats.totalFiles}): ${state.exporting.stats.currentFileName}`;
            statusBarEl.textContent = `${text} [${progress}%]`;
            
            if (state.exporting.activeToastId) {
                window.holaf.toastManager.update(state.exporting.activeToastId, {
                    message: text,
                    progress: state.exporting.stats.currentFileProgress
                });
            }
            return;
        }

        const currentFilteredCount = filteredCount !== undefined ? filteredCount : state.status.filteredImageCount;
        const currentTotalDbCount = totalCount !== undefined ? totalCount : state.status.totalImageCount;

        if (filteredCount !== undefined) imageViewerState.setState({ status: { filteredImageCount: filteredCount }});
        if (totalCount !== undefined) imageViewerState.setState({ status: { totalImageCount: totalCount }});

        let statusText = `Displaying ${currentFilteredCount} of ${currentTotalDbCount} total images.`;

        if (state.exporting.queue.length > 0) {
            statusText += ` | Export Queue: ${state.exporting.queue.length} file(s)`;
        } else if (currentTotalDbCount > 0 && !state.status.allThumbnailsGenerated) {
            const percentage = ((state.status.generatedThumbnailsCount / currentTotalDbCount) * 100).toFixed(1);
            statusText += ` | Thumbnails: ${state.status.generatedThumbnailsCount}/${currentTotalDbCount} (${percentage}%)`;
        } else if (currentTotalDbCount === 0) {
            statusText += ` | Thumbnails: N/A`;
        }

        const selectedCount = imageViewerState.getState().selectedImages.size;
        if (selectedCount > 0) {
            statusText += ` | Selected: ${selectedCount}`;
        }
        statusBarEl.textContent = statusText;
    },

    createFilterItem(id, label, isChecked, onChange, folderId = null) {
        const container = document.createElement('div');
        container.className = 'holaf-viewer-filter-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; 
        checkbox.id = id; 
        checkbox.checked = isChecked;
        checkbox.onchange = onChange;
        
        const labelEl = document.createElement('label');
        labelEl.htmlFor = id; 
        labelEl.textContent = label;
        
        const elementsToAppend = [];
    
        if (folderId) {
            container.dataset.folderId = folderId;
            const lockIcon = document.createElement('a');
            lockIcon.href = '#';
            lockIcon.className = 'holaf-folder-lock-icon';
            
            const { locked_folders } = imageViewerState.getState().filters;
            const isLocked = locked_folders.includes(folderId);
            
            lockIcon.innerHTML = isLocked ? ICONS.locked : ICONS.unlocked;
            lockIcon.title = isLocked ? 'Unlock this folder' : 'Lock this folder (prevents changes from All/None/Invert)';
            lockIcon.classList.toggle('locked', isLocked);
    
            lockIcon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
    
                const currentState = imageViewerState.getState();
                let currentLocked = [...currentState.filters.locked_folders];
                const isCurrentlyLocked = currentLocked.includes(folderId);
                
                if (isCurrentlyLocked) {
                    currentLocked = currentLocked.filter(f => f !== folderId);
                } else {
                    currentLocked.push(folderId);
                }
                
                this.saveSettings({ locked_folders: currentLocked });
                
                lockIcon.innerHTML = !isCurrentlyLocked ? ICONS.locked : ICONS.unlocked;
                lockIcon.title = !isCurrentlyLocked ? 'Unlock this folder' : 'Lock this folder (prevents changes from All/None/Invert)';
                lockIcon.classList.toggle('locked', !isCurrentlyLocked);
            };
            elementsToAppend.push(lockIcon);
        }
        
        elementsToAppend.push(checkbox, labelEl);
        container.append(...elementsToAppend);
        
        return container;
    },

    setLoadingState(message) {
        if (this.panelElements) {
            const g = document.getElementById("holaf-viewer-gallery");
            if (g) g.innerHTML = `<p class="holaf-viewer-message">${message}</p>`;
        }
    },

    async _updateViewerActivity(isActive) {
        try {
            await fetch('/holaf/images/viewer-activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: isActive })
            });
        } catch (e) {
            console.error("[Holaf ImageViewer] Error updating viewer activity:", e);
        }
    },
};

// --- FIX: Make the viewer object globally accessible ---
app.holafImageViewer = holafImageViewer;

// Start pre-loading as soon as the extension is registered.
app.registerExtension({ name: "Holaf.ImageViewer.Panel", async setup() { await holafImageViewer.init(); } });

export default holafImageViewer;