/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI
 *
 * This script provides the client-side logic for the Holaf Image Viewer.
 * It acts as a central coordinator, importing and orchestrating functionality
 * from specialized modules in the `js/image_viewer/` directory.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";

// Import modularized functionalities
import * as Settings from './image_viewer/image_viewer_settings.js';
import * as UI from './image_viewer/image_viewer_ui.js';
import * as Gallery from './image_viewer/image_viewer_gallery.js';
import * as Actions from './image_viewer/image_viewer_actions.js';
import * as InfoPane from './image_viewer/image_viewer_infopane.js';
import * as Navigation from './image_viewer/image_viewer_navigation.js';

const STATS_REFRESH_INTERVAL_MS = 2000; // Refresh stats every 2 seconds

const holafImageViewer = {
    // State Properties
    panelElements: null,
    isInitialized: false,
    areSettingsLoaded: false,
    isLoading: false,
    filteredImages: [],
    renderedCount: 0,
    activeImage: null,
    currentNavIndex: -1,
    galleryObserver: null,
    backgroundRenderHandle: null,
    metadataAbortController: null,
    fullscreenElements: null,
    refreshIntervalId: null,
    _fullscreenSourceView: null,
    _lastFolderFilterState: null,
    settings: {
        theme: "Graphite Orange",
        panel_x: null, panel_y: null,
        panel_width: 1200, panel_height: 800,
        panel_is_fullscreen: false,
        folder_filters: undefined,
        format_filters: undefined,
        thumbnail_fit: 'cover',
        thumbnail_size: 150,
        startDate: '', endDate: '',
    },
    zoomViewState: { scale: 1, tx: 0, ty: 0 },
    fullscreenViewState: { scale: 1, tx: 0, ty: 0 },
    visiblePlaceholdersToPrioritize: new Set(),
    prioritizeTimeoutId: null,
    statsRefreshIntervalId: null,
    allThumbnailsGenerated: false,
    currentFilteredCount: 0,
    currentTotalDbCount: 0,
    lastThumbStats: null,
    selectedImages: new Set(),

    // --- Initialization & Core Lifecycle ---

    init() {
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
    },

    async show() {
        if (!this.areSettingsLoaded) {
            await this.loadSettings();
        }

        if (!this.panelElements) {
            this.createPanel();
        }

        const panelIsVisible = this.panelElements?.panelEl && this.panelElements.panelEl.style.display === "flex";
        if (panelIsVisible) {
            this.hide();
            return;
        }

        if (this.panelElements?.panelEl) {
            this.applyPanelSettings();
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl);
            this.loadAndPopulateFilters();
            if (!this.isInitialized) this.isInitialized = true;
            this._updateViewerActivity(true);
        }
    },

    hide() {
        if (this.panelElements?.panelEl) {
            this.panelElements.panelEl.style.display = "none";
            if (this.refreshIntervalId) {
                clearInterval(this.refreshIntervalId);
                this.refreshIntervalId = null;
            }
            if (this.backgroundRenderHandle) {
                clearTimeout(this.backgroundRenderHandle);
                this.backgroundRenderHandle = null;
            }
            clearTimeout(this.prioritizeTimeoutId);
            this.visiblePlaceholdersToPrioritize.clear();
            if (this.statsRefreshIntervalId) {
                clearInterval(this.statsRefreshIntervalId);
                this.statsRefreshIntervalId = null;
            }
            this._updateViewerActivity(false);
        }
    },

    // --- Settings Management (delegated) ---

    loadSettings: function() { return Settings.loadSettings(this); },
    saveSettings: function(newSettings) { return Settings.saveSettings(this, newSettings); },
    setTheme: function(themeName, doSave = true) { return Settings.setTheme(this, themeName, doSave); },
    applyPanelSettings: function() { return Settings.applyPanelSettings(this); },
    _applyThumbnailFit: function() { return Settings.applyThumbnailFit(this.settings.thumbnail_fit); },
    _applyThumbnailSize: function() { return Settings.applyThumbnailSize(this.settings.thumbnail_size); },

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
        const headerControls = document.createElement("div");
        headerControls.className = "holaf-header-button-group";
        const themeButtonContainer = document.createElement("div");
        themeButtonContainer.style.position = 'relative';
        const themeButton = document.createElement("button");
        themeButton.className = "holaf-header-button";
        themeButton.title = "Change Theme";
        themeButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 12.55a9.42 9.42 0 0 1-9.45 9.45 9.42 9.42 0 0 1-9.45-9.45 9.42 9.42 0 0 1 9.45-9.45 2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 1-2.5 2.5Z"/></svg>`;
        
        const themeMenu = UI.createThemeMenu((themeName) => this.setTheme(themeName));
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
                defaultSize: { width: this.settings.panel_width, height: this.settings.panel_height },
                defaultPosition: { x: this.settings.panel_x, y: this.settings.panel_y },
                onClose: () => this.hide(),
                onStateChange: (newState) => this.saveSettings(newState),
                onFullscreenToggle: (isFullscreen) => this.saveSettings({ panel_is_fullscreen: isFullscreen }),
            });
            this.populatePanelContent();
            this.applyPanelSettings();
            this._createFullscreenOverlay();
            this._attachActionListeners();
        } catch (e) {
            console.error("[Holaf ImageViewer] Error creating panel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating Image Viewer panel. Check console for details." });
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.innerHTML = UI.getPanelHTML();
        
        // Attach listeners for newly created elements
        const dateStartEl = contentEl.querySelector('#holaf-viewer-date-start');
        const dateEndEl = contentEl.querySelector('#holaf-viewer-date-end');
        dateStartEl.value = this.settings.startDate || '';
        dateEndEl.value = this.settings.endDate || '';
        dateStartEl.onchange = () => this.loadFilteredImages();
        dateEndEl.onchange = () => this.loadFilteredImages();

        const thumbFitToggle = contentEl.querySelector('#holaf-viewer-thumb-fit-toggle');
        thumbFitToggle.checked = this.settings.thumbnail_fit === 'contain';
        thumbFitToggle.onchange = (e) => {
            this.saveSettings({ thumbnail_fit: e.target.checked ? 'contain' : 'cover' });
            this._applyThumbnailFit();
        };
        
        const thumbSizeSlider = contentEl.querySelector('#holaf-viewer-thumb-size-slider');
        const thumbSizeValue = contentEl.querySelector('#holaf-viewer-thumb-size-value');
        thumbSizeSlider.value = this.settings.thumbnail_size;
        thumbSizeValue.textContent = `${this.settings.thumbnail_size}px`;
        thumbSizeSlider.oninput = (e) => {
            thumbSizeValue.textContent = `${e.target.value}px`;
        };
        thumbSizeSlider.onchange = (e) => {
            this.saveSettings({ thumbnail_size: parseInt(e.target.value) });
            this._applyThumbnailSize();
        };

        const zoomView = contentEl.querySelector('#holaf-viewer-zoom-view');
        const zoomCloseBtn = contentEl.querySelector('.holaf-viewer-zoom-close');
        const zoomImage = zoomView.querySelector('img');
        const zoomFullscreenBtn = contentEl.querySelector('.holaf-viewer-zoom-fullscreen-icon');
        zoomCloseBtn.onclick = () => this._hideZoomedView();
        zoomImage.ondblclick = () => this._showFullscreenView(this.activeImage);
        zoomImage.onclick = (e) => e.stopPropagation();
        zoomFullscreenBtn.onclick = () => {
            if (this.activeImage) this._showFullscreenView(this.activeImage);
        };

        Navigation.setupZoomAndPan(this.zoomViewState, zoomView, zoomImage);
        this._updateActionButtonsState();
    },

    // --- Action Management (delegated) ---

    _attachActionListeners: function() { return Actions.attachActionListeners(this); },
    _updateActionButtonsState: function() { return Actions.updateActionButtonsState(this); },
    handleDelete: function() { return Actions.handleDelete(this); },
    handleRestore: function() { return Actions.handleRestore(this); },
    handleExtractMetadata: function() { return Actions.handleExtractMetadata(this); },
    handleInjectMetadata: function() { return Actions.handleInjectMetadata(this); },

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
                    // Refresh filters and image list completely
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

    async loadAndPopulateFilters() {
        try {
            const response = await fetch('/holaf/images/filter-options', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const data = await response.json();

            const useSavedFolderFilters = this.settings.folder_filters !== undefined;
            const useSavedFormatFilters = this.settings.format_filters !== undefined;

            const allFolders = new Set(data.subfolders.map(p => p.split('/')[0]));
            allFolders.delete('trashcan'); // Always try to remove trashcan from the main list
            const sortedFolders = Array.from(allFolders).sort();
            
            const foldersEl = document.getElementById('holaf-viewer-folders-filter');
            const formatsEl = document.getElementById('holaf-viewer-formats-filter');
            foldersEl.innerHTML = '';
            formatsEl.innerHTML = '';

            const createFolderCheckbox = (folder, isRoot = false) => {
                const id = isRoot ? 'root' : folder;
                const isChecked = useSavedFolderFilters ? this.settings.folder_filters.includes(id) : true;
                return this.createFilterItem(`folder-filter-${id}`, isRoot ? '(root)' : folder, isChecked, () => this.loadFilteredImages());
            };
            
            if (data.has_root) foldersEl.appendChild(createFolderCheckbox(null, true));
            sortedFolders.forEach(folder => foldersEl.appendChild(createFolderCheckbox(folder)));

            // Always display the trashcan section
            const separator = document.createElement('div');
            separator.className = 'holaf-viewer-trash-separator';
            foldersEl.appendChild(separator);
            
            const isTrashChecked = useSavedFolderFilters ? this.settings.folder_filters.includes('trashcan') : false;
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
                this.loadFilteredImages();
            });

            // Add "Empty Trash" button
            const trashContainer = trashCheckboxItem;
            trashContainer.style.display = 'flex';
            trashContainer.style.justifyContent = 'space-between';
            trashContainer.style.alignItems = 'center';
            
            const emptyTrashBtn = document.createElement('button');
            emptyTrashBtn.textContent = 'Empty';
            emptyTrashBtn.title = 'Permanently delete all files in the trashcan';
            emptyTrashBtn.style.cssText = 'font-size: 10px; padding: 2px 6px; margin-left: 10px; background-color: #802020; color: white; border: 1px solid #c03030; cursor: pointer; border-radius: 4px;';
            emptyTrashBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._handleEmptyTrash();
            };
            trashContainer.appendChild(emptyTrashBtn);

            foldersEl.appendChild(trashContainer);
            
            if (trashCheckboxItem.querySelector('input').checked) {
                foldersEl.querySelectorAll('input[type="checkbox"]:not(#folder-filter-trashcan)').forEach(cb => cb.disabled = true);
            }

            data.formats.forEach(format => {
                const isChecked = useSavedFormatFilters ? this.settings.format_filters.includes(format) : true;
                formatsEl.appendChild(this.createFilterItem(`format-filter-${format}`, format, isChecked, () => this.loadFilteredImages()));
            });

            this.loadFilteredImages();
        } catch (e) {
            console.error("[Holaf ImageViewer] Failed to load filter options:", e);
            document.getElementById('holaf-viewer-folders-filter').innerHTML = `<p class="holaf-viewer-message error">Error loading filters.</p>`;
        }
    },

    async _fetchFilteredImages() {
        const selectedFolders = [...document.querySelectorAll('#holaf-viewer-folders-filter input:checked')].map(cb => cb.id.replace('folder-filter-', ''));
        const selectedFormats = [...document.querySelectorAll('#holaf-viewer-formats-filter input:checked')].map(cb => cb.id.replace('format-filter-', ''));
        const startDate = document.getElementById('holaf-viewer-date-start').value;
        const endDate = document.getElementById('holaf-viewer-date-end').value;
        
        this.saveSettings({ folder_filters: selectedFolders, format_filters: selectedFormats, startDate, endDate });

        const response = await fetch('/holaf/images/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_filters: selectedFolders, format_filters: selectedFormats, startDate, endDate })
        });
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        return await response.json();
    },

    async loadFilteredImages() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.setLoadingState("Applying filters...");

        const currentSelectedPaths = new Set(Array.from(this.selectedImages).map(img => img.path_canon));
        const activeImageCanonPath = this.activeImage ? this.activeImage.path_canon : null;
        this.selectedImages.clear();

        try {
            const data = await this._fetchFilteredImages();
            this.filteredImages = data.images || [];

            if (currentSelectedPaths.size > 0) {
                this.filteredImages.forEach(img => {
                    if (currentSelectedPaths.has(img.path_canon)) {
                        this.selectedImages.add(img);
                    }
                });
            }
            
            this.renderGallery();
            this.updateStatusBar(data, true);

            if (activeImageCanonPath) {
                const newIndex = this.filteredImages.findIndex(img => img.path_canon === activeImageCanonPath);
                if (newIndex > -1) {
                    this.currentNavIndex = newIndex;
                    this.activeImage = this.filteredImages[newIndex];
                    setTimeout(() => this._updateActiveThumbnail(newIndex), 100);
                } else {
                    this.activeImage = null; this.currentNavIndex = -1; this.updateInfoPane(null);
                }
            } else {
                this.activeImage = null; this.currentNavIndex = -1; this.updateInfoPane(null);
            }

            if (data.total_db_count > 0 && data.generated_thumbnails_count < data.total_db_count) {
                this.allThumbnailsGenerated = false;
                if (!this.statsRefreshIntervalId) {
                    this.statsRefreshIntervalId = setInterval(() => this.fetchAndUpdateThumbnailStats(), STATS_REFRESH_INTERVAL_MS);
                }
            } else {
                 this.allThumbnailsGenerated = true;
                 if (this.statsRefreshIntervalId) { clearInterval(this.statsRefreshIntervalId); this.statsRefreshIntervalId = null; }
            }

        } catch (e) {
            console.error("[Holaf ImageViewer] Failed to load images:", e);
            this.setLoadingState(`Error: ${e.message}`);
            this.filteredImages = []; this.activeImage = null; this.currentNavIndex = -1; this.updateInfoPane(null);
        } finally {
            this.isLoading = false;
            this._updateActionButtonsState();
        }
    },

    // --- Gallery & Thumbnail Rendering (delegated) ---

    renderGallery: function() { return Gallery.renderGallery(this); },
    renderImageBatch: function(isBackground = false) { return Gallery.renderImageBatch(this, isBackground); },
    startBackgroundRendering: function() { return Gallery.startBackgroundRendering(this); },
    createPlaceholder: function(image, index) { return Gallery.createPlaceholder(this, image, index); },
    loadSpecificThumbnail: function(placeholder, image, forceRegen = false) { return Gallery.loadSpecificThumbnail(this, placeholder, image, forceRegen); },

    // --- Info Pane (delegated) ---
    
    updateInfoPane: function(image) { return InfoPane.updateInfoPane(this, image); },

    // --- Navigation & Interaction (delegated) ---

    _handleKeyDown: function(e) { return Navigation.handleKeyDown(this, e); },
    _navigate: function(direction) { return Navigation.navigate(this, direction); },
    _navigateGrid: function(direction) { return Navigation.navigateGrid(this, direction); },
    _handleEscape: function() { return Navigation.handleEscape(this); },
    _showZoomedView: function(image) { return Navigation.showZoomedView(this, image); },
    _hideZoomedView: function() { return Navigation.hideZoomedView(); },
    _showFullscreenView: function(image) { return Navigation.showFullscreenView(this, image); },
    _hideFullscreenView: function() { return Navigation.hideFullscreenView(this); },

    // --- Status & Helpers ---

    _updateActiveThumbnail(navIndex) {
        const currentActive = document.querySelector('.holaf-viewer-thumbnail-placeholder.active');
        if (currentActive) currentActive.classList.remove('active');
        if (navIndex < 0 || navIndex >= this.filteredImages.length) return;
        const newActiveThumbnail = document.querySelector(`.holaf-viewer-thumbnail-placeholder[data-index="${navIndex}"]`);
        if (newActiveThumbnail) {
            newActiveThumbnail.classList.add('active');
            newActiveThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    async fetchAndUpdateThumbnailStats() {
        if (this.allThumbnailsGenerated && this.statsRefreshIntervalId) {
             clearInterval(this.statsRefreshIntervalId); this.statsRefreshIntervalId = null; return;
        }
        try {
            const response = await fetch('/holaf/images/thumbnail-stats');
            if (!response.ok) return;
            const stats = await response.json();
            this.lastThumbStats = stats;
            this.updateStatusBar(stats, false);
            if (stats.generated_thumbnails_count >= stats.total_db_count && this.statsRefreshIntervalId) {
                clearInterval(this.statsRefreshIntervalId); this.statsRefreshIntervalId = null;
            }
        } catch (e) { /* silent fail */ }
    },
    
    updateStatusBar(data, isFullUpdate = true) {
        const statusBarEl = document.getElementById('holaf-viewer-statusbar');
        if (!statusBarEl) return;
        if (isFullUpdate) {
            this.currentFilteredCount = data.filtered_count !== undefined ? data.filtered_count : this.currentFilteredCount;
            this.currentTotalDbCount = data.total_db_count !== undefined ? data.total_db_count : this.currentTotalDbCount;
        }
        let statusText = `Displaying ${this.currentFilteredCount} of ${this.currentTotalDbCount} total images.`;
        const generatedCount = data.generated_thumbnails_count !== undefined ? data.generated_thumbnails_count : (this.lastThumbStats ? this.lastThumbStats.generated_thumbnails_count : 0);
        const totalForThumbs = data.total_db_count !== undefined ? data.total_db_count : (this.lastThumbStats ? this.lastThumbStats.total_db_count : this.currentTotalDbCount);
        if (totalForThumbs > 0) {
            const percentage = ((generatedCount / totalForThumbs) * 100).toFixed(1);
            statusText += ` | Thumbnails: ${generatedCount}/${totalForThumbs} (${percentage}%)`;
            this.allThumbnailsGenerated = (generatedCount >= totalForThumbs);
        } else {
             statusText += ` | Thumbnails: N/A`; this.allThumbnailsGenerated = true;
        }
        if (this.selectedImages.size > 0) {
            statusText += ` | Selected: ${this.selectedImages.size}`;
        }
        statusBarEl.textContent = statusText;
    },

    createFilterItem(id, label, isChecked, onChange) {
        const container = document.createElement('div');
        container.className = 'holaf-viewer-filter-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.id = id; checkbox.checked = isChecked;
        checkbox.onchange = onChange;
        const labelEl = document.createElement('label');
        labelEl.htmlFor = id; labelEl.textContent = label;
        container.append(checkbox, labelEl);
        return container;
    },

    setLoadingState(message) {
        const g = document.getElementById("holaf-viewer-gallery");
        if (g) g.innerHTML = `<p class="holaf-viewer-message">${message}</p>`;
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

app.holafImageViewer = holafImageViewer;
app.registerExtension({ name: "Holaf.ImageViewer.Panel", async setup() { holafImageViewer.init(); } });
export default holafImageViewer;