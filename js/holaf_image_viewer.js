/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI
 *
 * This script provides the client-side logic for the Holaf Image Viewer.
 * MODIFIED: Implemented gallery virtualization with IntersectionObserver.
 * MODIFIED: Added folder and format filters.
 * CORRECTION: Removed dynamic menu registration. Menu is now built statically by holaf_main.js.
 * CORRECTION: Reverted thumbnail loading to use <img> tags to work with a new CSS fix for the rendering bug.
 * MODIFIED: updateInfoPane now fetches and displays full image metadata, prioritizing external files and showing data source.
 * CORRECTION: Reworked info pane HTML generation for more reliable styling of metadata labels and sources.
 * MODIFIED: Removed manual refresh button and implemented automatic refresh on show + periodic polling.
 * CORRECTION: Fixed enlarged image positioning and cursor behavior for better UX.
 * CORRECTION: Prevented default browser image drag behavior on non-zoomed enlarged images.
 * CORRECTION: Enabled arrow key navigation in the main gallery view and made the logic robust across all views.
 * CORRECTION: Added Up/Down arrow key navigation for the gallery view.
 * MODIFIED: Added advanced keyboard shortcuts (Enter, Shift+Enter, Escape) for streamlined navigation between views.
 * MODIFIED: Added preloading for the next image in enlarged and fullscreen views for faster navigation.
 * CORRECTION: Prevented flash of previous image during navigation by preloading before display.
 * MODIFIED: Added a "Display Options" panel with a toggle for thumbnail fit (Cover/Contain).
 * MODIFIED: Added a slider to control thumbnail size.
 * MODIFIED: Added unified header controls (theme, zoom) for UI consistency.
 * MODIFICATION: Made theme setting independent for this panel.
 * OPTIMIZATION: Overhauled data loading to use server-side filtering. Frontend no longer loads the entire image list, resulting in a massive performance boost for large galleries.
 * OPTIMIZATION: Implemented virtual/infinite scrolling for the gallery itself to prevent browser lock-up when rendering thousands of thumbnails.
 * MODIFICATION: Added date range filter inputs and corresponding API logic.
 * MODIFICATION: Added PageUp/PageDown key handlers for fast gallery scrolling.
 * MODIFICATION: Double-clicking a zoomed-in image now enters fullscreen.
 * MODIFICATION: Implemented logic to preserve scroll position on filter updates.
 * CORRECTION: Periodic refresh is now non-disruptive ("silent refresh").
 * CORRECTION: Improved scroll preservation logic on filter changes.
 * MODIFICATION: Implemented progressive background rendering of thumbnails.
 * MODIFICATION: Added Home/End key handlers for gallery navigation.
 * CORRECTION: Fixed settings loading race condition by awaiting settings in show().
 * CORRECTION: Added applyPanelSettings to correctly apply size/pos/theme on every show.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";
import holafModelManager from "./holaf_model_manager.js"; // Only used for default theme, not for control

const RENDER_BATCH_SIZE = 100; // Number of thumbnails to render at a time

const holafImageViewer = {
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
    settings: {
        theme: "Graphite Orange",
        panel_x: null,
        panel_y: null,
        panel_width: 1200,
        panel_height: 800,
        panel_is_fullscreen: false,
        folder_filters: [],
        format_filters: [],
        thumbnail_fit: 'cover',
        thumbnail_size: 150,
        startDate: '',
        endDate: '',
    },
    zoomViewState: { scale: 1, tx: 0, ty: 0 },
    fullscreenViewState: { scale: 1, tx: 0, ty: 0 },

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

    async loadSettings() {
        try {
            const response = await fetch('/holaf/utilities/settings');
            const allSettings = await response.json();
            if (allSettings.ImageViewerUI) {
                const fetchedSettings = allSettings.ImageViewerUI;
                const validTheme = HOLAF_THEMES.find(t => t.name === fetchedSettings.theme);
                this.settings = { ...this.settings, ...fetchedSettings };
                if (!validTheme) this.settings.theme = HOLAF_THEMES[0].name;
                console.log("[Holaf ImageViewer] Settings loaded:", this.settings);
            }
        } catch (e) {
            console.error("[Holaf ImageViewer] Could not load settings:", e);
        }
        this.areSettingsLoaded = true;
    },

    async saveSettings(newSettings) {
        // Handle inconsistent property names from panel manager
        if (newSettings.x !== undefined) newSettings.panel_x = newSettings.x;
        if (newSettings.y !== undefined) newSettings.panel_y = newSettings.y;
        if (newSettings.width !== undefined) newSettings.panel_width = newSettings.width;
        if (newSettings.height !== undefined) newSettings.panel_height = newSettings.height;
        delete newSettings.x;
        delete newSettings.y;
        delete newSettings.width;
        delete newSettings.height;

        Object.assign(this.settings, newSettings);

        if (!this.debouncedSave) {
            this.debouncedSave = (() => {
                let timeout;
                return (settingsToSave) => {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => {
                         fetch("/holaf/image-viewer/save-settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(settingsToSave),
                        }).catch(error => console.error("[Holaf ImageViewer] Error saving settings:", error));
                    }, 750);
                };
            })();
        }
        this.debouncedSave(this.settings);
    },

    setTheme(themeName, doSave = true) {
        const themeConfig = HOLAF_THEMES.find(t => t.name === themeName);
        if (!themeConfig) { console.warn(`[Holaf ImageViewer] Theme '${themeName}' not found.`); return; }
        
        if (doSave) {
            this.saveSettings({ theme: themeName });
        } else {
            this.settings.theme = themeName;
        }

        if (this.panelElements && this.panelElements.panelEl) {
            HOLAF_THEMES.forEach(t => this.panelElements.panelEl.classList.remove(t.className));
            this.panelElements.panelEl.classList.add(themeConfig.className);
        }
    },

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
        this._setupZoomAndPan(this.fullscreenViewState, overlay, this.fullscreenElements.img);
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
        const themeMenu = this.createThemeMenu();
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
        } catch (e) {
            console.error("[Holaf ImageViewer] Error creating panel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating Image Viewer panel. Check console for details." });
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.innerHTML = `
            <div class="holaf-viewer-container" style="flex-grow: 1;">
                <div id="holaf-viewer-left-pane" class="holaf-viewer-pane">
                    <div class="holaf-viewer-filter-group">
                        <h4>Date Range</h4>
                        <div id="holaf-viewer-date-filter" class="holaf-viewer-filter-list">
                            <div class="holaf-viewer-filter-item" style="flex-direction: column; align-items: flex-start;">
                                <label for="holaf-viewer-date-start">From:</label>
                                <input type="date" id="holaf-viewer-date-start" style="width: 100%; box-sizing: border-box;">
                                <label for="holaf-viewer-date-end" style="margin-top: 5px;">To:</label>
                                <input type="date" id="holaf-viewer-date-end" style="width: 100%; box-sizing: border-box;">
                            </div>
                        </div>
                    </div>
                    <div class="holaf-viewer-filter-group">
                        <h4>Folders</h4>
                        <div id="holaf-viewer-folders-filter" class="holaf-viewer-filter-list">
                            <p class="holaf-viewer-message"><em>Loading...</em></p>
                        </div>
                    </div>
                    <div class="holaf-viewer-filter-group">
                        <h4>Formats</h4>
                        <div id="holaf-viewer-formats-filter" class="holaf-viewer-filter-list"></div>
                    </div>
                    <div class="holaf-viewer-display-options">
                        <h4>Display Options</h4>
                        <div class="holaf-viewer-filter-list">
                           <div class="holaf-viewer-filter-item">
                                <input type="checkbox" id="holaf-viewer-thumb-fit-toggle">
                                <label for="holaf-viewer-thumb-fit-toggle">Contained (no crop)</label>
                           </div>
                           <div class="holaf-viewer-slider-container">
                               <label for="holaf-viewer-thumb-size-slider">Size</label>
                               <input type="range" id="holaf-viewer-thumb-size-slider" min="80" max="300" step="10">
                               <span id="holaf-viewer-thumb-size-value">150px</span>
                           </div>
                        </div>
                    </div>
                </div>
                <div id="holaf-viewer-center-pane" class="holaf-viewer-pane">
                    <div id="holaf-viewer-toolbar"></div>
                    <div id="holaf-viewer-gallery">
                        <p class="holaf-viewer-message">Loading images...</p>
                    </div>
                    <div id="holaf-viewer-zoom-view" style="display: none;">
                        <button class="holaf-viewer-zoom-close" title="Close (or double-click image)">✖</button>
                        <img src="" />
                        <button class="holaf-viewer-zoom-fullscreen-icon" title="Enter fullscreen">⛶</button>
                    </div>
                </div>
                <div id="holaf-viewer-right-pane" class="holaf-viewer-pane">
                    <h4>Image Information</h4>
                    <div id="holaf-viewer-info-content">
                        <p class="holaf-viewer-message">Select an image to see details.</p>
                    </div>
                </div>
            </div>
            <div id="holaf-viewer-statusbar"></div>
        `;
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
            const newSize = parseInt(e.target.value);
            thumbSizeValue.textContent = `${newSize}px`;
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
        this._setupZoomAndPan(this.zoomViewState, zoomView, zoomImage);
    },

    applyPanelSettings() {
        if (!this.panelElements || !this.panelElements.panelEl) return;

        this.setTheme(this.settings.theme, false);

        const isFullscreen = this.settings.panel_is_fullscreen;
        const panelIsFullscreen = this.panelElements.panelEl.classList.contains("holaf-panel-fullscreen");

        if (isFullscreen && !panelIsFullscreen) {
            HolafPanelManager.toggleFullscreen(this.panelElements.panelEl, (isFs) => this.saveSettings({ panel_is_fullscreen: isFs }));
        } else if (!isFullscreen && panelIsFullscreen) {
            HolafPanelManager.toggleFullscreen(this.panelElements.panelEl, (isFs) => this.saveSettings({ panel_is_fullscreen: isFs }));
        }
        
        if (!this.settings.panel_is_fullscreen) {
            this.panelElements.panelEl.style.width = `${this.settings.panel_width}px`;
            this.panelElements.panelEl.style.height = `${this.settings.panel_height}px`;

            if (this.settings.panel_x !== null && this.settings.panel_y !== null) {
                this.panelElements.panelEl.style.left = `${this.settings.panel_x}px`;
                this.panelElements.panelEl.style.top = `${this.settings.panel_y}px`;
                this.panelElements.panelEl.style.transform = 'none';
            } else {
                this.panelElements.panelEl.style.left = '50%';
                this.panelElements.panelEl.style.top = '50%';
                this.panelElements.panelEl.style.transform = 'translate(-50%, -50%)';
            }
        }
        
        this._applyThumbnailFit();
        this._applyThumbnailSize();
    },

    _applyThumbnailFit() {
        const el = document.getElementById("holaf-viewer-gallery");
        if (el) el.classList.toggle('contain-thumbnails', this.settings.thumbnail_fit === 'contain');
    },

    _applyThumbnailSize() {
        const el = document.getElementById("holaf-viewer-gallery");
        if (el) el.style.setProperty('--holaf-thumbnail-size', `${this.settings.thumbnail_size}px`);
    },

    async loadAndPopulateFilters() {
        try {
            const response = await fetch('/holaf/images/filter-options', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const data = await response.json();
            const topLevelFolders = data.subfolders.map(p => p.split('/')[0]).filter((v, i, a) => a.indexOf(v) === i).sort();
            const foldersEl = document.getElementById('holaf-viewer-folders-filter');
            const formatsEl = document.getElementById('holaf-viewer-formats-filter');
            foldersEl.innerHTML = '';
            formatsEl.innerHTML = '';
            const useSavedFolderFilters = this.settings.folder_filters && this.settings.folder_filters.length > 0;
            const useSavedFormatFilters = this.settings.format_filters && this.settings.format_filters.length > 0;
            if (data.has_root) {
                foldersEl.appendChild(this.createFilterItem('folder-filter-root', '(root)', useSavedFolderFilters ? this.settings.folder_filters.includes('root') : true, () => this.loadFilteredImages()));
            }
            topLevelFolders.forEach(folder => {
                foldersEl.appendChild(this.createFilterItem(`folder-filter-${folder}`, folder, useSavedFolderFilters ? this.settings.folder_filters.includes(folder) : true, () => this.loadFilteredImages()));
            });
            data.formats.forEach(format => {
                formatsEl.appendChild(this.createFilterItem(`format-filter-${format}`, format, useSavedFormatFilters ? this.settings.format_filters.includes(format) : true, () => this.loadFilteredImages()));
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
        const activeImageCanonPath = this.activeImage ? this.activeImage.path_canon : null;
        try {
            const data = await this._fetchFilteredImages();
            this.filteredImages = data.images;
            this.renderGallery();
            document.getElementById('holaf-viewer-statusbar').textContent = `Displaying ${data.filtered_count} of ${data.total_db_count} total images.`;
            if (activeImageCanonPath) {
                const newIndex = this.filteredImages.findIndex(img => img.path_canon === activeImageCanonPath);
                if (newIndex > -1) {
                    this.currentNavIndex = newIndex;
                    this.activeImage = this.filteredImages[newIndex];
                    setTimeout(() => this._updateActiveThumbnail(newIndex), 100);
                } else {
                    this.activeImage = null;
                    this.currentNavIndex = -1;
                }
            }
        } catch (e) {
            console.error("[Holaf ImageViewer] Failed to load images:", e);
            this.setLoadingState(`Error: ${e.message}`, false);
        } finally {
            this.isLoading = false;
        }
    },

    async performSilentRefresh() {
        if (this.isLoading) return;
        try {
            const data = await this._fetchFilteredImages();
            const newImages = data.images;
            const currentImagePaths = new Set(this.filteredImages.map(img => img.path_canon));
            const addedImages = newImages.filter(img => !currentImagePaths.has(img.path_canon));
            if (addedImages.length > 0) {
                console.log(`[Holaf ImageViewer] Silent refresh: Found ${addedImages.length} new images.`);
                const galleryEl = document.getElementById("holaf-viewer-gallery");
                const fragment = document.createDocumentFragment();
                addedImages.forEach(image => {
                    const placeholder = this.createPlaceholder(image, -1);
                    fragment.appendChild(placeholder);
                    this.galleryObserver.observe(placeholder);
                });
                galleryEl.prepend(fragment);
                this.filteredImages.unshift(...addedImages);
                // Re-index all thumbnails
                galleryEl.querySelectorAll('.holaf-viewer-thumbnail-placeholder').forEach((el, i) => el.dataset.index = i);
                if (this.currentNavIndex !== -1) {
                    this.currentNavIndex += addedImages.length;
                    this._updateActiveThumbnail(this.currentNavIndex);
                }
            }
            document.getElementById('holaf-viewer-statusbar').textContent = `Displaying ${data.filtered_count} of ${data.total_db_count} total images.`;
        } catch (e) {
            console.warn("[Holaf ImageViewer] Silent refresh failed:", e);
        }
    },

    createFilterItem(id, label, isChecked, onChange) {
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
        container.append(checkbox, labelEl);
        return container;
    },

    renderGallery() {
        const galleryEl = document.getElementById("holaf-viewer-gallery");
        if (!galleryEl) return;
        if (this.galleryObserver) this.galleryObserver.disconnect();
        if (this.backgroundRenderHandle) clearTimeout(this.backgroundRenderHandle);
        galleryEl.innerHTML = '';
        this.renderedCount = 0;
        if (!this.filteredImages || this.filteredImages.length === 0) {
            this.setLoadingState("No images match the current filters.", false);
            return;
        }
        const sentinel = document.createElement('div');
        sentinel.id = 'holaf-viewer-load-sentinel';
        galleryEl.appendChild(sentinel);
        this.galleryObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                if (entry.target.id === 'holaf-viewer-load-sentinel') {
                    this.renderImageBatch();
                } else {
                    const placeholder = entry.target;
                    const imageIndex = placeholder.dataset.index;
                    const image = this.filteredImages[imageIndex];
                    if (image) {
                        this.galleryObserver.unobserve(placeholder);
                        this.loadSpecificThumbnail(placeholder, image, false);
                    }
                }
            });
        }, { root: galleryEl, rootMargin: "400px 0px" });
        this.renderImageBatch();
        this.galleryObserver.observe(sentinel);
    },

    renderImageBatch(isBackground = false) {
        const galleryEl = document.getElementById("holaf-viewer-gallery");
        const sentinel = document.getElementById('holaf-viewer-load-sentinel');
        if (!galleryEl) return;
        if (this.backgroundRenderHandle && !isBackground) {
            clearTimeout(this.backgroundRenderHandle);
        }
        const fragment = document.createDocumentFragment();
        const nextRenderLimit = Math.min(this.renderedCount + RENDER_BATCH_SIZE, this.filteredImages.length);
        for (let i = this.renderedCount; i < nextRenderLimit; i++) {
            const placeholder = this.createPlaceholder(this.filteredImages[i], i);
            fragment.appendChild(placeholder);
            this.galleryObserver.observe(placeholder);
        }
        if (sentinel) {
            galleryEl.insertBefore(fragment, sentinel);
        } else {
            galleryEl.appendChild(fragment);
        }
        this.renderedCount = nextRenderLimit;
        if (this.renderedCount < this.filteredImages.length) {
            if (!isBackground) {
                this.startBackgroundRendering();
            }
        } else {
            if (sentinel) sentinel.remove();
        }
    },

    startBackgroundRendering() {
        if (this.backgroundRenderHandle) clearTimeout(this.backgroundRenderHandle);
        const renderNext = () => {
            if (this.renderedCount >= this.filteredImages.length) {
                this.backgroundRenderHandle = null;
                return;
            }
            this.renderImageBatch(true);
            this.backgroundRenderHandle = setTimeout(renderNext, 50);
        };
        this.backgroundRenderHandle = setTimeout(renderNext, 500);
    },

    _getFullImageUrl(image) {
        if (!image) return "";
        const url = new URL(window.location.origin);
        url.pathname = '/view';
        url.search = new URLSearchParams({
            filename: image.filename,
            subfolder: image.subfolder || '',
            type: 'output'
        });
        return url.href;
    },

    _updateActiveThumbnail(navIndex) {
        const currentActive = document.querySelector('.holaf-viewer-thumbnail-placeholder.active');
        if (currentActive) currentActive.classList.remove('active');
        if (navIndex < 0 || navIndex >= this.renderedCount) return;
        const newActiveThumbnail = document.querySelector(`.holaf-viewer-thumbnail-placeholder[data-index="${navIndex}"]`);
        if (newActiveThumbnail) {
            newActiveThumbnail.classList.add('active');
            newActiveThumbnail.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    },

    loadSpecificThumbnail(placeholder, image, forceRegen = false) {
        const imageUrl = new URL(window.location.origin);
        imageUrl.pathname = '/holaf/images/thumbnail';
        const params = {
            filename: image.filename,
            subfolder: image.subfolder,
            mtime: image.mtime
        };
        if (forceRegen) params.force_regen = 'true';
        imageUrl.search = new URLSearchParams(params);
        const img = document.createElement('img');
        img.src = imageUrl.href;
        img.alt = image.filename;
        img.loading = "lazy";
        img.onload = () => {
            placeholder.innerHTML = '';
            placeholder.classList.remove('error');
            const fsIcon = document.createElement('div');
            fsIcon.className = 'holaf-viewer-fullscreen-icon';
            fsIcon.innerHTML = '⛶';
            fsIcon.title = 'View fullscreen';
            fsIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showFullscreenView(image);
            });
            placeholder.appendChild(fsIcon);
            placeholder.prepend(img);
        };
        img.onerror = async () => {
            placeholder.classList.add('error');
            const response = await fetch(imageUrl.href, { cache: 'no-store' }).catch(() => null);
            let errorText = 'ERR: Failed to fetch.';
            if (response) errorText = await response.text().catch(() => 'ERR: Could not read error.');
            const errorOverlay = document.createElement('div');
            errorOverlay.className = 'holaf-viewer-error-overlay';
            errorOverlay.textContent = errorText;
            const retryButton = document.createElement('button');
            retryButton.className = 'holaf-viewer-retry-button';
            retryButton.textContent = 'Retry';
            retryButton.onclick = (e) => {
                e.stopPropagation();
                this.loadSpecificThumbnail(placeholder, image, true);
            };
            placeholder.innerHTML = '';
            placeholder.appendChild(errorOverlay);
            placeholder.appendChild(retryButton);
        };
    },

    createPlaceholder(image, index) {
        const placeholder = document.createElement('div');
        placeholder.className = 'holaf-viewer-thumbnail-placeholder';
        placeholder.dataset.index = index;
        placeholder.addEventListener('click', () => {
            if (this.activeImage === image) return;
            this.activeImage = image;
            this.currentNavIndex = index;
            this._updateActiveThumbnail(this.currentNavIndex);
            this.updateInfoPane(image);
        });
        placeholder.addEventListener('dblclick', () => this._showZoomedView(image));
        return placeholder;
    },

    _copyTextToClipboard(text) {
        return new Promise((resolve, reject) => {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(resolve).catch(reject);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.top = "-9999px";
                textArea.style.left = "-9999px";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    if (document.execCommand('copy')) resolve();
                    else reject(new Error('Copy failed.'));
                } catch (err) {
                    reject(err);
                }
                document.body.removeChild(textArea);
            }
        });
    },

    async updateInfoPane(image) {
        const infoContentEl = document.getElementById('holaf-viewer-info-content');
        if (!infoContentEl || !image) return;
        if (this.metadataAbortController) this.metadataAbortController.abort();
        this.metadataAbortController = new AbortController();
        const signal = this.metadataAbortController.signal;
        const sizeInMB = (image.size_bytes / 1048576).toFixed(2);
        infoContentEl.innerHTML = `<p><strong>Filename:</strong><br>${image.filename}</p><p><strong>Folder:</strong> ${image.subfolder || '/'}</p><p><strong>Size:</strong> ${sizeInMB} MB</p><p><strong>Format:</strong> ${image.format}</p><p><strong>Modified:</strong><br>${new Date(image.mtime * 1000).toLocaleString()}</p><div id="holaf-resolution-container"></div><hr><div id="holaf-metadata-container"><p class="holaf-viewer-message"><em>Loading metadata...</em></p></div>`;
        try {
            const metadataUrl = new URL(window.location.origin);
            metadataUrl.pathname = '/holaf/images/metadata';
            metadataUrl.search = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' });
            const response = await fetch(metadataUrl.href, { signal, cache: 'no-store' });
            const metadataContainer = document.getElementById('holaf-metadata-container');
            if (!metadataContainer) return;
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP Error ${response.status}` }));
                metadataContainer.innerHTML = `<p class="holaf-viewer-message error"><strong>Error:</strong> ${errorData.error || 'Unknown error'}</p>`;
                return;
            }
            const data = await response.json();
            const resolutionContainer = document.getElementById('holaf-resolution-container');
            if (resolutionContainer) {
                let resolutionHTML = '';
                if (data.width && data.height) resolutionHTML += `<p><strong>Resolution:</strong> ${data.width}x${data.height} px</p>`;
                if (data.ratio) resolutionHTML += `<p><strong>Ratio:</strong> ${data.ratio}</p>`;
                resolutionContainer.innerHTML = resolutionHTML;
            }
            const getSourceLabel = (s) => ({ "external_txt": "(from .txt)", "external_json": "(from .json)", "internal_png": "(from PNG)" }[s] || "");
            metadataContainer.innerHTML = '';
            const createButton = (txt, cb, dis = false) => {
                const b = document.createElement('button');
                b.className = 'holaf-viewer-info-button';
                b.textContent = txt;
                b.disabled = dis;
                if (!dis) b.onclick = cb;
                return b;
            };
            metadataContainer.innerHTML += `<p><span class="holaf-viewer-metadata-label">Prompt:</span><span class="holaf-viewer-metadata-source">${getSourceLabel(data.prompt_source)}</span></p>`;
            const promptActions = document.createElement('div');
            promptActions.className = 'holaf-viewer-info-actions';
            promptActions.appendChild(createButton('📋 Copy Prompt', (e) => {
                this._copyTextToClipboard(data.prompt).then(() => {
                    e.target.textContent = 'Copied!';
                    setTimeout(() => e.target.textContent = '📋 Copy Prompt', 1500);
                }).catch(err => {
                    console.error('Copy failed:', err);
                    e.target.textContent = 'Copy Failed!';
                    setTimeout(() => e.target.textContent = '📋 Copy Prompt', 2000);
                });
            }, !data.prompt));
            metadataContainer.appendChild(promptActions);
            if (data.prompt) {
                const promptBox = document.createElement('div');
                promptBox.className = 'holaf-viewer-metadata-box';
                promptBox.textContent = data.prompt;
                metadataContainer.appendChild(promptBox);
            } else {
                metadataContainer.innerHTML += `<p class="holaf-viewer-message"><em>Not available.</em></p>`;
            }
            metadataContainer.innerHTML += `<p style="margin-top:15px;"><span class="holaf-viewer-metadata-label">Workflow:</span><span class="holaf-viewer-metadata-source">${getSourceLabel(data.workflow_source)}</span></p>`;
            const workflowActions = document.createElement('div');
            workflowActions.className = 'holaf-viewer-info-actions';
            workflowActions.appendChild(createButton('⚡ Load Workflow', async () => {
                if (await HolafPanelManager.createDialog({
                        title: 'Load Workflow',
                        message: 'Load image workflow?',
                        buttons: [{ text: 'Cancel', value: false }, { text: 'Load', value: true }]
                    })) app.loadGraphData(data.workflow);
            }, !data.workflow || !!data.workflow.error));
            metadataContainer.appendChild(workflowActions);
            if (data.workflow && !data.workflow.error) {
                const workflowBox = document.createElement('div');
                workflowBox.className = 'holaf-viewer-metadata-box';
                workflowBox.textContent = JSON.stringify(data.workflow, null, 2);
                metadataContainer.appendChild(workflowBox);
            } else if (data.workflow && data.workflow.error) {
                metadataContainer.innerHTML += `<p class="holaf-viewer-message error"><em>Error: ${data.workflow.error}</em></p>`;
            } else {
                metadataContainer.innerHTML += `<p class="holaf-viewer-message"><em>No workflow found.</em></p>`;
            }
        } catch (err) {
            const m = document.getElementById('holaf-metadata-container');
            if (err.name === 'AbortError') return;
            console.error("Metadata fetch error:", err);
            if (m) m.innerHTML = `<p class="holaf-viewer-message error"><strong>Error:</strong> Failed to fetch metadata.</p>`;
        } finally {
            this.metadataAbortController = null;
        }
    },

    _resetTransform(state, imageEl) {
        state.scale = 1;
        state.tx = 0;
        state.ty = 0;
        imageEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
        imageEl.style.cursor = 'grab';
    },

    _preloadNextImage(idx) {
        if (idx < 0 || (idx + 1) >= this.filteredImages.length) return;
        const next = this.filteredImages[idx + 1];
        if (next) {
            const p = new Image();
            p.src = this._getFullImageUrl(next);
        }
    },

    _showZoomedView(image) {
        const idx = this.filteredImages.findIndex(i => i === image);
        if (idx === -1) return;
        this.activeImage = image;
        this.currentNavIndex = idx;
        const v = document.getElementById('holaf-viewer-zoom-view'),
            i = v.querySelector('img'),
            u = this._getFullImageUrl(image);
        const l = new Image();
        l.onload = () => {
            this._resetTransform(this.zoomViewState, i);
            i.src = u;
            v.style.display = 'flex';
            document.getElementById('holaf-viewer-gallery').style.display = 'none';
        };
        l.onerror = () => console.error(`Failed to load: ${u}`);
        l.src = u;
        this.updateInfoPane(image);
        this._updateActiveThumbnail(idx);
        this._preloadNextImage(idx);
    },

    _hideZoomedView() {
        document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
        document.getElementById('holaf-viewer-gallery').style.display = 'flex';
    },

    _showFullscreenView(image) {
        if (!image) return;
        const idx = this.filteredImages.findIndex(i => i === image);
        if (idx === -1) return;
        this.activeImage = image;
        this.currentNavIndex = idx;
        this._fullscreenSourceView = document.getElementById('holaf-viewer-zoom-view') ?.style.display === 'flex' ? 'zoomed' : 'gallery';
        if (this._fullscreenSourceView === 'zoomed') this._hideZoomedView();
        const { img: fImg, overlay: fOv } = this.fullscreenElements, u = this._getFullImageUrl(image);
        const l = new Image();
        l.onload = () => {
            this._resetTransform(this.fullscreenViewState, fImg);
            fImg.src = u;
            fOv.style.display = 'flex';
        };
        l.onerror = () => console.error(`Failed to load: ${u}`);
        l.src = u;
        this.updateInfoPane(image);
        this._updateActiveThumbnail(idx);
        this._preloadNextImage(idx);
    },

    _hideFullscreenView() {
        this.fullscreenElements.overlay.style.display = 'none';
        const s = this._fullscreenSourceView;
        this._fullscreenSourceView = null;
        return s;
    },

    _navigate(direction) {
        if (this.filteredImages.length === 0) return;
        let newIndex = (this.currentNavIndex === -1) ? 0 : this.currentNavIndex + direction;
        const clampedIndex = Math.max(0, Math.min(newIndex, this.filteredImages.length - 1));
        if (clampedIndex === this.currentNavIndex && this.currentNavIndex !== -1) return;
        this.currentNavIndex = clampedIndex;
        this.activeImage = this.filteredImages[clampedIndex];
        this._updateActiveThumbnail(clampedIndex);
        this.updateInfoPane(this.activeImage);
        this._preloadNextImage(clampedIndex);
        const newImageUrl = this._getFullImageUrl(this.activeImage);
        const loader = new Image();
        loader.onload = () => {
            const isZoomed = document.getElementById('holaf-viewer-zoom-view') ?.style.display === 'flex';
            const isFullscreen = this.fullscreenElements.overlay.style.display === 'flex';
            if (isZoomed) {
                const zImg = document.querySelector('#holaf-viewer-zoom-view img');
                this._resetTransform(this.zoomViewState, zImg);
                zImg.src = newImageUrl;
            } else if (isFullscreen) {
                const fImg = this.fullscreenElements.img;
                this._resetTransform(this.fullscreenViewState, fImg);
                fImg.src = newImageUrl;
            }
        };
        loader.onerror = () => console.error(`Preload failed: ${newImageUrl}`);
        loader.src = newImageUrl;
    },

    _navigateGrid(direction) {
        if (this.filteredImages.length === 0) return;
        const g = document.getElementById('holaf-viewer-gallery');
        const f = g ?.querySelector('.holaf-viewer-thumbnail-placeholder');
        if (!g || !f) return;
        const s = window.getComputedStyle(f),
            w = f.offsetWidth + parseFloat(s.marginLeft) + parseFloat(s.marginRight),
            n = Math.max(1, Math.floor(g.clientWidth / w));
        let newIndex = (this.currentNavIndex === -1) ? 0 : this.currentNavIndex + (direction * n);
        const clampedIndex = Math.max(0, Math.min(newIndex, this.filteredImages.length - 1));
        if (clampedIndex === this.currentNavIndex) return;
        this.currentNavIndex = clampedIndex;
        this.activeImage = this.filteredImages[clampedIndex];
        this._updateActiveThumbnail(clampedIndex);
        this.updateInfoPane(this.activeImage);
    },

    _handleEscape() {
        if (this.fullscreenElements ?.overlay.style.display === 'flex') {
            const s = this._hideFullscreenView();
            if (s === 'zoomed' && this.activeImage) this._showZoomedView(this.activeImage);
        } else if (document.getElementById('holaf-viewer-zoom-view') ?.style.display === 'flex') {
            this._hideZoomedView();
        }
    },

    _handleKeyDown(e) {
        if (!this.panelElements ?.panelEl || this.panelElements.panelEl.style.display === 'none') return;
        const targetTagName = e.target.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(targetTagName)) return;
        const isZoomed = document.getElementById('holaf-viewer-zoom-view') ?.style.display === 'flex',
            isFullscreen = this.fullscreenElements ?.overlay.style.display === 'flex';
        const galleryEl = document.getElementById('holaf-viewer-gallery');
        switch (e.key) {
            case 'PageUp':
            case 'PageDown':
                if (!isZoomed && !isFullscreen && galleryEl) {
                    e.preventDefault();
                    galleryEl.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * galleryEl.clientHeight * 0.9, behavior: 'smooth' });
                }
                break;
            case 'Home':
            case 'End':
                if (!isZoomed && !isFullscreen && this.filteredImages.length > 0) {
                    e.preventDefault();
                    if (e.key === 'Home') {
                        this._navigate(0 - this.currentNavIndex);
                    } else { // End key
                        if (this.backgroundRenderHandle) clearTimeout(this.backgroundRenderHandle);
                        while (this.renderedCount < this.filteredImages.length) this.renderImageBatch(true);
                        this._navigate(this.filteredImages.length - 1 - this.currentNavIndex);
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (this.currentNavIndex === -1 && this.filteredImages.length > 0) this.currentNavIndex = 0;
                if (this.currentNavIndex === -1) return;
                const img = this.filteredImages[this.currentNavIndex];
                if (e.shiftKey) {
                    if (!isFullscreen) this._showFullscreenView(img);
                } else {
                    if (isZoomed) this._showFullscreenView(img);
                    else if (!isFullscreen) this._showZoomedView(img);
                }
                break;
            case 'ArrowRight':
            case 'ArrowLeft':
                e.preventDefault();
                this._navigate(e.key === 'ArrowRight' ? 1 : -1);
                break;
            case 'ArrowUp':
            case 'ArrowDown':
                if (!isZoomed && !isFullscreen) {
                    e.preventDefault();
                    this._navigateGrid(e.key === 'ArrowDown' ? 1 : -1);
                }
                break;
            case 'Escape':
                e.preventDefault();
                this._handleEscape();
                break;
        }
    },

    _setupZoomAndPan(state, container, imageEl) {
        const u = () => { imageEl.style.transform = `translate(${state.tx}px,${state.ty}px) scale(${state.scale})`; };
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const o = state.scale,
                n = e.deltaY < 0 ? o * 1.1 : o / 1.1;
            state.scale = Math.max(1, Math.min(n, 30));
            if (state.scale === o) return;
            const r = container.getBoundingClientRect(),
                mX = e.clientX - r.left,
                mY = e.clientY - r.top;
            state.tx = mX - (mX - state.tx) * (state.scale / o);
            state.ty = mY - (mY - state.ty) * (state.scale / o);
            if (state.scale <= 1) this._resetTransform(state, imageEl);
            else imageEl.style.cursor = 'grab';
            u();
        });
        imageEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (state.scale <= 1) return;
            let sX = e.clientX - state.tx,
                sY = e.clientY - state.ty;
            imageEl.style.cursor = 'grabbing';
            imageEl.style.transition = 'none';
            const onM = (m) => {
                state.tx = m.clientX - sX;
                state.ty = m.clientY - sY;
                u();
            };
            const onU = () => {
                imageEl.style.cursor = 'grab';
                imageEl.style.transition = 'transform .2s ease-out';
                document.removeEventListener('mousemove', onM);
                document.removeEventListener('mouseup', onU);
            };
            document.addEventListener('mousemove', onM);
            document.addEventListener('mouseup', onU);
        });
    },

    setLoadingState(message) {
        const g = document.getElementById("holaf-viewer-gallery");
        if (g) g.innerHTML = `<p class="holaf-viewer-message">${message}</p>`;
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
            if (this.refreshIntervalId) clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = setInterval(() => this.performSilentRefresh(), 20000);
            if (!this.isInitialized) this.isInitialized = true;
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
        }
    }
};

app.holafImageViewer = holafImageViewer;
app.registerExtension({ name: "Holaf.ImageViewer.Panel", async setup() { holafImageViewer.init(); } });
export default holafImageViewer;