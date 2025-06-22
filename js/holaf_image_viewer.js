/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI
 *
 * This script provides the client-side logic for the Holaf Image Viewer.
 * MODIFIED: Implemented gallery virtualization with IntersectionObserver.
 * MODIFIED: Added folder and format filters.
 * CORRECTION: Final version restoring all initialization and menu logic.
 * CORRECTION: Reverted thumbnail loading to use <img> tags to work with a new CSS fix for the rendering bug.
 * MODIFIED: updateInfoPane now fetches and displays full image metadata, prioritizing external files and showing data source.
 * CORRECTION: Reworked info pane HTML generation for more reliable styling of metadata labels and sources.
 * MODIFIED: Removed manual refresh button and implemented automatic refresh on show + periodic polling.
 * CORRECTION: Fixed enlarged image positioning and cursor behavior for better UX.
 * CORRECTION: Prevented default browser image drag behavior on non-zoomed enlarged images.
 * CORRECTION: Enabled arrow key navigation in the main gallery view and made the logic robust across all views.
 * CORRECTION: Added Up/Down arrow key navigation for the gallery view.
 * MODIFIED: Added advanced keyboard shortcuts (Enter, Shift+Enter, Escape) for streamlined navigation between views.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";
import holafModelManager from "./holaf_model_manager.js";

const holafImageViewer = {
    panelElements: null,
    isInitialized: false,
    isLoading: false,
    images: [],
    filteredImages: [],
    activeImage: null,
    currentNavIndex: -1,
    thumbnailObserver: null,
    metadataAbortController: null,
    fullscreenElements: null,
    refreshIntervalId: null,
    _fullscreenSourceView: null, // 'gallery' or 'zoomed'
    settings: { // Default settings
        theme: "Graphite Orange",
        panel_x: null,
        panel_y: null,
        panel_width: 1200,
        panel_height: 800,
        panel_is_fullscreen: false,
        folder_filters: [],
        format_filters: [],
    },
    
    // State for zoom/pan
    zoomViewState: { scale: 1, tx: 0, ty: 0 },
    fullscreenViewState: { scale: 1, tx: 0, ty: 0 },

    addMenuItem() {
        const dropdownMenu = document.getElementById("holaf-utilities-dropdown-menu");
        if (!dropdownMenu) {
            console.error("[Holaf ImageViewer] Cannot add menu item: Dropdown menu not found.");
            return;
        }

        const existingItem = Array.from(dropdownMenu.children).find(
            li => li.textContent.includes("Image Viewer")
        );
        if (existingItem) {
            existingItem.textContent = "Image Viewer";
            return;
        }

        const menuItem = document.createElement("li");
        menuItem.textContent = "Image Viewer";
        menuItem.onclick = () => {
            this.show();
            if (dropdownMenu) dropdownMenu.style.display = "none";
        };
        dropdownMenu.appendChild(menuItem);
        console.log("[Holaf ImageViewer] Menu item added to dropdown.");
    },

    init() {
        document.addEventListener("holaf-menu-ready", () => this.addMenuItem());
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
        
        // Fetch initial settings from the server
        this.loadSettings();
    },
    
    async loadSettings() {
        try {
            const response = await fetch('/holaf/utilities/settings');
            const allSettings = await response.json();
            if (allSettings.ui_image_viewer_settings) {
                // Merge loaded settings with defaults
                Object.assign(this.settings, allSettings.ui_image_viewer_settings);
                console.log("[Holaf ImageViewer] Settings loaded:", this.settings);
            }
        } catch (e) {
            console.error("[Holaf ImageViewer] Could not load settings:", e);
        }
    },

    async saveSettings(newSettings) {
        Object.assign(this.settings, newSettings);
        try {
            await fetch("/holaf/image-viewer/save-settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(this.settings),
            });
        } catch (error) {
            console.error("[Holaf ImageViewer] Error saving settings:", error);
        }
    },
    
    _createFullscreenOverlay() {
        if (document.getElementById('holaf-viewer-fullscreen-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'holaf-viewer-fullscreen-overlay';
        overlay.style.display = 'none';

        overlay.innerHTML = `
            <button id="holaf-viewer-fs-close" class="holaf-viewer-fs-close" title="Close (Esc)">✖</button>
            <button id="holaf-viewer-fs-prev" class="holaf-viewer-fs-nav" title="Previous (Left Arrow)">‹</button>
            <img src="" />
            <button id="holaf-viewer-fs-next" class="holaf-viewer-fs-nav" title="Next (Right Arrow)">›</button>
        `;
        document.body.appendChild(overlay);
        
        this.fullscreenElements = {
            overlay: overlay,
            img: overlay.querySelector('img'),
            closeBtn: overlay.querySelector('#holaf-viewer-fs-close'),
            prevBtn: overlay.querySelector('#holaf-viewer-fs-prev'),
            nextBtn: overlay.querySelector('#holaf-viewer-fs-next'),
        };

        this.fullscreenElements.closeBtn.onclick = () => this._handleEscape();
        this.fullscreenElements.prevBtn.onclick = () => this._navigate(-1);
        this.fullscreenElements.nextBtn.onclick = () => this._navigate(1);
        
        this._setupZoomAndPan(this.fullscreenViewState, overlay, this.fullscreenElements.img);
    },

    createPanel() {
        if (this.panelElements && this.panelElements.panelEl) return;

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-viewer-panel",
                title: "Holaf Image Viewer",
                defaultSize: { width: this.settings.panel_width, height: this.settings.panel_height },
                defaultPosition: { x: this.settings.panel_x, y: this.settings.panel_y },
                onClose: () => this.hide(),
                onStateChange: (newState) => this.saveSettings(newState),
                onFullscreenToggle: (isFullscreen) => this.saveSettings({ panel_is_fullscreen: isFullscreen }),
            });

            this.populatePanelContent();
            this.applyCurrentTheme();
            this._createFullscreenOverlay();
            
            if (this.settings.panel_is_fullscreen) {
                HolafPanelManager.toggleFullscreen(this.panelElements.panelEl, (isFullscreen) => this.saveSettings({ panel_is_fullscreen: isFullscreen }));
            }

        } catch (e) {
            console.error("[Holaf ImageViewer] Error creating panel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating Image Viewer panel. Check console for details." });
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        // The main container is now a flex-column to accommodate the status bar
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.innerHTML = `
            <div class="holaf-viewer-container" style="flex-grow: 1;">
                <div id="holaf-viewer-left-pane" class="holaf-viewer-pane">
                    <div class="holaf-viewer-filter-group">
                        <h4>Folders</h4>
                        <div id="holaf-viewer-folders-filter" class="holaf-viewer-filter-list">
                        </div>
                    </div>
                    <div class="holaf-viewer-filter-group">
                        <h4>Formats</h4>
                        <div id="holaf-viewer-formats-filter" class="holaf-viewer-filter-list"></div>
                    </div>
                </div>
                <div id="holaf-viewer-center-pane" class="holaf-viewer-pane">
                    <div id="holaf-viewer-toolbar">
                    </div>
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
        
        const zoomView = contentEl.querySelector('#holaf-viewer-zoom-view');
        const zoomCloseBtn = contentEl.querySelector('.holaf-viewer-zoom-close');
        const zoomImage = zoomView.querySelector('img');
        const zoomFullscreenBtn = contentEl.querySelector('.holaf-viewer-zoom-fullscreen-icon');

        zoomCloseBtn.onclick = () => this._hideZoomedView();
        zoomImage.ondblclick = () => this._hideZoomedView();
        zoomImage.onclick = (e) => e.stopPropagation();
        
        zoomFullscreenBtn.onclick = () => {
            if (this.activeImage) {
                this._showFullscreenView(this.activeImage);
            }
        };

        this._setupZoomAndPan(this.zoomViewState, zoomView, zoomImage);
    },

    async loadImages() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const response = await fetch('/holaf/images/list', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);

            const newImages = await response.json();

            if (JSON.stringify(this.images) !== JSON.stringify(newImages)) {
                this.images = newImages;
                this.populateFilters();
                this.applyFiltersAndRender();
            }

        } catch (e) {
            console.error("[Holaf ImageViewer] Failed to load images:", e);
            this.setLoadingState(`Error: ${e.message}`, false);
        } finally {
            this.isLoading = false;
        }
    },

    populateFilters() {
        const folderSet = new Set();
        this.images.forEach(img => {
            const topLevelFolder = (img.subfolder || '').split('/')[0];
            folderSet.add(topLevelFolder);
        });

        const formatSet = new Set();
        this.images.forEach(img => {
            formatSet.add(img.format);
        });

        const folders = Array.from(folderSet).sort();
        const formats = Array.from(formatSet).sort();

        const foldersEl = document.getElementById('holaf-viewer-folders-filter');
        const formatsEl = document.getElementById('holaf-viewer-formats-filter');

        foldersEl.innerHTML = '';
        formatsEl.innerHTML = '';

        const useSavedFolderFilters = this.settings.folder_filters && this.settings.folder_filters.length > 0;
        const useSavedFormatFilters = this.settings.format_filters && this.settings.format_filters.length > 0;

        if (folders.length > 1) {
            const selectAllItem = this.createFilterItem('folder-filter-select-all', 'Select All', !useSavedFolderFilters, (e) => {
                const isChecked = e.target.checked;
                foldersEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    if (cb.id !== 'folder-filter-select-all') {
                        cb.checked = isChecked;
                    }
                });
                this.applyFiltersAndRender();
            });
            selectAllItem.style.fontWeight = 'bold';
            selectAllItem.style.borderBottom = '1px solid var(--holaf-border-color)';
            selectAllItem.style.paddingBottom = '5px';
            selectAllItem.style.marginBottom = '5px';
            foldersEl.appendChild(selectAllItem);
        }
        
        const updateSelectAllState = () => {
            const selectAllCb = foldersEl.querySelector('#folder-filter-select-all');
            if (!selectAllCb) return;

            const allFolderCbs = foldersEl.querySelectorAll('input[type="checkbox"]:not(#folder-filter-select-all)');
            const allChecked = Array.from(allFolderCbs).every(cb => cb.checked);
            selectAllCb.checked = allChecked;
        };

        folders.forEach(folder => {
            const id = `folder-filter-${folder || 'root'}`;
            const labelText = folder === '' ? 'root' : folder;
            const isChecked = useSavedFolderFilters ? this.settings.folder_filters.includes(labelText) : true;
            const item = this.createFilterItem(id, labelText, isChecked, () => {
                updateSelectAllState();
                this.applyFiltersAndRender();
            });
            foldersEl.appendChild(item);
        });
        updateSelectAllState();

        formats.forEach(format => {
            const id = `format-filter-${format}`;
            const isChecked = useSavedFormatFilters ? this.settings.format_filters.includes(format) : true;
            const item = this.createFilterItem(id, format, isChecked, () => this.applyFiltersAndRender());
            formatsEl.appendChild(item);
        });
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

    applyFiltersAndRender() {
        const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
        const isFullscreen = this.fullscreenElements?.overlay.style.display === 'flex';
        const wasInEnlargedView = isZoomed || isFullscreen;
        const previousActiveImage = this.activeImage;
        const previousNavIndex = this.currentNavIndex;
        
        const selectedFolders = [];
        document.querySelectorAll('#holaf-viewer-folders-filter input:checked:not(#folder-filter-select-all)').forEach(cb => {
            const folderName = cb.id.replace('folder-filter-', '');
            selectedFolders.push(folderName === 'root' ? '' : folderName);
        });

        const selectedFormats = [];
        document.querySelectorAll('#holaf-viewer-formats-filter input:checked').forEach(cb => {
            selectedFormats.push(cb.id.replace('format-filter-', ''));
        });
        
        // Save the current filter state
        const folderLabels = selectedFolders.map(f => f === '' ? 'root' : f);
        this.saveSettings({ folder_filters: folderLabels, format_filters: selectedFormats });

        this.filteredImages = this.images.filter(img => {
            const imgSubfolder = img.subfolder || '';
            const folderMatch = selectedFolders.some(selectedFolder => {
                if (selectedFolder === '') { 
                    return imgSubfolder === '';
                }
                return imgSubfolder === selectedFolder || imgSubfolder.startsWith(selectedFolder + '/');
            });
            const formatMatch = selectedFormats.includes(img.format);
            return folderMatch && formatMatch;
        });

        const statusBar = document.getElementById('holaf-viewer-statusbar');
        if (statusBar) {
            statusBar.textContent = `Displaying ${this.filteredImages.length} of ${this.images.length} images.`;
        }

        this.renderGallery(this.filteredImages);

        if (wasInEnlargedView && previousActiveImage) {
            let newNavIndex = this._findImageIndexInFilteredList(previousActiveImage);

            if (newNavIndex !== -1) {
                this.currentNavIndex = newNavIndex;
            } else {
                if (this.filteredImages.length === 0) {
                    if (isZoomed) this._hideZoomedView();
                    if (isFullscreen) this._hideFullscreenView();
                    return;
                }
                
                newNavIndex = Math.min(previousNavIndex, this.filteredImages.length - 1);
                
                this.activeImage = this.filteredImages[newNavIndex];
                this.currentNavIndex = newNavIndex;
                
                const newImageUrl = this._getFullImageUrl(this.activeImage);
                if (isZoomed) document.querySelector('#holaf-viewer-zoom-view img').src = newImageUrl;
                if (isFullscreen) this.fullscreenElements.img.src = newImageUrl;
                
                this.updateInfoPane(this.activeImage);
                this._updateActiveThumbnail(this.currentNavIndex);
            }
        }
    },

    renderGallery(imagesToRender) {
        const galleryEl = document.getElementById("holaf-viewer-gallery");
        if (!galleryEl) return;

        if (this.thumbnailObserver) this.thumbnailObserver.disconnect();

        galleryEl.innerHTML = '';
        if (!imagesToRender || imagesToRender.length === 0) {
            this.setLoadingState("No images match the current filters.", false);
            return;
        }

        this.thumbnailObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const placeholder = entry.target;
                    const imageIndex = placeholder.dataset.index;
                    const image = this.images[imageIndex];
                    if (!image) return;
                    
                    observer.unobserve(placeholder);
                    this.loadSpecificThumbnail(placeholder, image, false);
                }
            });
        }, {
            root: galleryEl, rootMargin: "200px 0px 200px 0px"
        });

        const fragment = document.createDocumentFragment();
        imagesToRender.forEach(image => {
            const originalIndex = this.images.findIndex(img => img.filename === image.filename && img.subfolder === image.subfolder);
            const placeholder = this.createPlaceholder(image, originalIndex);
            fragment.appendChild(placeholder);
            this.thumbnailObserver.observe(placeholder);
        });
        galleryEl.appendChild(fragment);
    },
    
    _getFullImageUrl(image) {
        const url = new URL(window.location.origin);
        url.pathname = '/view';
        url.search = new URLSearchParams({
            filename: image.filename,
            subfolder: image.subfolder || '',
            type: 'output'
        });
        return url.href;
    },
    
    _findImageIndexInFilteredList(imageToFind) {
        if (!imageToFind) return -1;
        return this.filteredImages.findIndex(img => img.filename === imageToFind.filename && img.subfolder === imageToFind.subfolder);
    },
    
    _updateActiveThumbnail(navIndex) {
        const currentActive = document.querySelector('.holaf-viewer-thumbnail-placeholder.active');
        if (currentActive) currentActive.classList.remove('active');
        
        if(navIndex < 0 || navIndex >= this.filteredImages.length) return;

        const image = this.filteredImages[navIndex];
        const masterIndex = this.images.findIndex(img => img.filename === image.filename && img.subfolder === image.subfolder);
        
        const newActiveThumbnail = document.querySelector(`.holaf-viewer-thumbnail-placeholder[data-index="${masterIndex}"]`);
        if(newActiveThumbnail) {
            newActiveThumbnail.classList.add('active');
            newActiveThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        if (forceRegen) {
            params.force_regen = 'true';
        }
        imageUrl.search = new URLSearchParams(params);

        const img = document.createElement('img');
        img.src = imageUrl.href;
        img.alt = image.filename;
        img.loading = "lazy";

        img.onload = () => {
            placeholder.innerHTML = ''; // Clear potential error message
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
            if (response) {
                errorText = await response.text().catch(() => 'ERR: Could not read error.');
            }

            const errorOverlay = document.createElement('div');
            errorOverlay.className = 'holaf-viewer-error-overlay';
            errorOverlay.textContent = errorText;

            const retryButton = document.createElement('button');
            retryButton.className = 'holaf-viewer-retry-button';
            retryButton.textContent = 'Retry';
            retryButton.onclick = (e) => {
                e.stopPropagation();
                this.loadSpecificThumbnail(placeholder, image, true); // Force regeneration
            };

            placeholder.innerHTML = ''; // Clear previous content
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
            this.currentNavIndex = this._findImageIndexInFilteredList(image);
            this._updateActiveThumbnail(this.currentNavIndex);
            this.updateInfoPane(image);
        });

        placeholder.addEventListener('dblclick', () => this._showZoomedView(image));
        
        const fullscreenIcon = document.createElement('div');
        fullscreenIcon.className = 'holaf-viewer-fullscreen-icon';
        fullscreenIcon.innerHTML = '⛶';
        fullscreenIcon.title = 'View fullscreen';
        fullscreenIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this._showFullscreenView(image);
        });
        placeholder.appendChild(fullscreenIcon);

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
                    const successful = document.execCommand('copy');
                    if (successful) {
                        resolve();
                    } else {
                        reject(new Error('Copy command was not successful.'));
                    }
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

        const sizeInMB = (image.size_bytes / (1024 * 1024)).toFixed(2);
        infoContentEl.innerHTML = `
            <p><strong>Filename:</strong><br>${image.filename}</p>
            <p><strong>Folder:</strong> ${image.subfolder || '/'}</p>
            <p><strong>Size:</strong> ${sizeInMB} MB</p>
            <p><strong>Format:</strong> ${image.format}</p>
            <p><strong>Modified:</strong><br>${new Date(image.mtime * 1000).toLocaleString()}</p>
            <div id="holaf-resolution-container"></div>
            <hr>
            <div id="holaf-metadata-container">
                <p class="holaf-viewer-message"><em>Loading metadata...</em></p>
            </div>
        `;
        
        try {
            const metadataUrl = new URL(window.location.origin);
            metadataUrl.pathname = '/holaf/images/metadata';
            metadataUrl.search = new URLSearchParams({
                filename: image.filename,
                subfolder: image.subfolder || ''
            });

            const response = await fetch(metadataUrl.href, { signal, cache: 'no-store' });
            const metadataContainer = document.getElementById('holaf-metadata-container');
            if (!metadataContainer) return;

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP Error ${response.status}` }));
                metadataContainer.innerHTML = `<p class="holaf-viewer-message error"><strong>Error:</strong> ${errorData.error || 'Unknown error'}</p>`;
                return;
            }
            
            const data = await response.json();

            // Populate resolution info
            const resolutionContainer = document.getElementById('holaf-resolution-container');
            if(resolutionContainer) {
                let resolutionHTML = '';
                if(data.width && data.height) {
                    resolutionHTML += `<p><strong>Resolution:</strong> ${data.width} x ${data.height} px</p>`;
                }
                if(data.ratio) {
                    resolutionHTML += `<p><strong>Ratio:</strong> ${data.ratio}</p>`;
                }
                resolutionContainer.innerHTML = resolutionHTML;
            }
            
            const getSourceLabel = (source) => {
                switch(source) {
                    case "external_txt": return "(from .txt file)";
                    case "external_json": return "(from .json file)";
                    case "internal_png": return "(from PNG metadata)";
                    default: return "";
                }
            };
            
            metadataContainer.innerHTML = ''; // Clear loading message

            const createButton = (text, onClick, disabled = false) => {
                const button = document.createElement('button');
                button.className = 'holaf-viewer-info-button';
                button.textContent = text;
                button.disabled = disabled;
                if (!disabled) {
                    button.onclick = onClick;
                }
                return button;
            };

            // --- Prompt Section ---
            const promptSourceLabel = getSourceLabel(data.prompt_source);
            metadataContainer.innerHTML += `<p><span class="holaf-viewer-metadata-label">Prompt:</span> <span class="holaf-viewer-metadata-source">${promptSourceLabel}</span></p>`;
            
            const promptActions = document.createElement('div');
            promptActions.className = 'holaf-viewer-info-actions';
            const copyPromptBtn = createButton('📋 Copy Prompt', (e) => {
                this._copyTextToClipboard(data.prompt).then(() => {
                    e.target.textContent = 'Copied!';
                    setTimeout(() => { e.target.textContent = '📋 Copy Prompt'; }, 1500);
                }).catch(err => {
                    console.error('Failed to copy prompt:', err);
                    e.target.textContent = 'Copy Failed!';
                    setTimeout(() => { e.target.textContent = '📋 Copy Prompt'; }, 2000);
                });
            }, !data.prompt);
            promptActions.appendChild(copyPromptBtn);
            metadataContainer.appendChild(promptActions);

            if (data.prompt) {
                const promptBox = document.createElement('div');
                promptBox.className = 'holaf-viewer-metadata-box';
                promptBox.textContent = data.prompt;
                metadataContainer.appendChild(promptBox);
            } else {
                metadataContainer.innerHTML += `<p class="holaf-viewer-message"><em>Not available.</em></p>`;
            }

            // --- Workflow Section ---
            const workflowSourceLabel = getSourceLabel(data.workflow_source);
            metadataContainer.innerHTML += `<p style="margin-top: 15px;"><span class="holaf-viewer-metadata-label">Workflow:</span> <span class="holaf-viewer-metadata-source">${workflowSourceLabel}</span></p>`;
            
            const workflowActions = document.createElement('div');
            workflowActions.className = 'holaf-viewer-info-actions';
            const loadWorkflowBtn = createButton('⚡ Load Workflow', async () => {
                const confirmed = await HolafPanelManager.createDialog({
                    title: 'Load Workflow',
                    message: 'This will load the image\'s workflow.\n\nAre you sure you want to continue?',
                    buttons: [
                        { text: 'Cancel', value: false, type: 'cancel' },
                        { text: 'Load', value: true, type: 'confirm' },
                    ]
                });
                if (confirmed) {
                    app.loadGraphData(data.workflow);
                }
            }, !data.workflow || !!data.workflow.error);
            workflowActions.appendChild(loadWorkflowBtn);
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
            const metadataContainer = document.getElementById('holaf-metadata-container');
            if (err.name === 'AbortError') return;
            console.error("[Holaf ImageViewer] Error fetching metadata:", err);
            if(metadataContainer) metadataContainer.innerHTML = `<p class="holaf-viewer-message error"><strong>Error:</strong> Failed to fetch metadata.</p>`;
        } finally {
            this.metadataAbortController = null;
        }
    },
    
    _resetTransform(state, imageEl, containerEl) {
        state.scale = 1;
        state.tx = 0; 
        state.ty = 0;
        imageEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
        imageEl.style.cursor = 'grab';
    },

    _showZoomedView(image) {
        this.currentNavIndex = this._findImageIndexInFilteredList(image);
        if (this.currentNavIndex === -1) return;
        
        this.activeImage = image;

        const zoomView = document.getElementById('holaf-viewer-zoom-view');
        const zoomImage = zoomView.querySelector('img');
        
        this._resetTransform(this.zoomViewState, zoomImage, zoomView);
        zoomImage.src = this._getFullImageUrl(image);
        
        zoomView.style.display = 'flex';
        document.getElementById('holaf-viewer-gallery').style.display = 'none';
        
        this.updateInfoPane(image);
        this._updateActiveThumbnail(this.currentNavIndex);
    },

    _hideZoomedView() {
        document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
        document.getElementById('holaf-viewer-gallery').style.display = 'flex';
    },

    _showFullscreenView(image) {
        this.currentNavIndex = this._findImageIndexInFilteredList(image);
        if (this.currentNavIndex === -1) return;

        this.activeImage = image;

        const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
        this._fullscreenSourceView = isZoomed ? 'zoomed' : 'gallery';

        if(isZoomed) this._hideZoomedView();
        
        const fsImg = this.fullscreenElements.img;
        const fsOverlay = this.fullscreenElements.overlay;
        
        this._resetTransform(this.fullscreenViewState, fsImg, fsOverlay);
        fsImg.src = this._getFullImageUrl(image);

        fsOverlay.style.display = 'flex';
        
        this.updateInfoPane(image);
        this._updateActiveThumbnail(this.currentNavIndex);
    },
    
    _hideFullscreenView() {
        this.fullscreenElements.overlay.style.display = 'none';
        const source = this._fullscreenSourceView;
        this._fullscreenSourceView = null; // Reset state
        return source;
    },
    
    _navigate(direction) {
        if (this.filteredImages.length === 0) return;

        let newIndex;
        if (this.currentNavIndex === -1) {
            newIndex = 0;
        } else {
            newIndex = this.currentNavIndex + direction;
        }

        const clampedIndex = Math.max(0, Math.min(newIndex, this.filteredImages.length - 1));
        
        if (clampedIndex === this.currentNavIndex && this.currentNavIndex !== -1) {
            return; 
        }
        
        this.currentNavIndex = clampedIndex;
        const newImage = this.filteredImages[this.currentNavIndex];
        this.activeImage = newImage;
        
        this._updateActiveThumbnail(this.currentNavIndex);
        this.updateInfoPane(newImage);

        const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
        const isFullscreen = this.fullscreenElements.overlay.style.display === 'flex';

        if (isZoomed) {
            const zoomImage = document.querySelector('#holaf-viewer-zoom-view img');
            this._resetTransform(this.zoomViewState, zoomImage, zoomImage.parentElement);
            zoomImage.src = this._getFullImageUrl(newImage);
        } else if (isFullscreen) {
            const fsImg = this.fullscreenElements.img;
            this._resetTransform(this.fullscreenViewState, fsImg, fsImg.parentElement);
            fsImg.src = this._getFullImageUrl(newImage);
        }
    },

    _navigateGrid(direction) { // +1 for down, -1 for up
        if (this.filteredImages.length === 0) return;

        const galleryEl = document.getElementById('holaf-viewer-gallery');
        const firstThumbnail = galleryEl?.querySelector('.holaf-viewer-thumbnail-placeholder');
        if (!galleryEl || !firstThumbnail) return;

        const galleryStyle = window.getComputedStyle(galleryEl);
        const thumbStyle = window.getComputedStyle(firstThumbnail);
        const galleryWidth = galleryEl.clientWidth;
        const thumbWidth = firstThumbnail.offsetWidth + parseFloat(thumbStyle.marginLeft) + parseFloat(thumbStyle.marginRight);
        const numColumns = Math.max(1, Math.floor(galleryWidth / thumbWidth));

        let newIndex;
        if (this.currentNavIndex === -1) {
            newIndex = 0;
        } else {
            newIndex = this.currentNavIndex + (direction * numColumns);
        }

        const clampedIndex = Math.max(0, Math.min(newIndex, this.filteredImages.length - 1));

        if (clampedIndex === this.currentNavIndex) return;

        this.currentNavIndex = clampedIndex;
        this.activeImage = this.filteredImages[this.currentNavIndex];
        
        this._updateActiveThumbnail(this.currentNavIndex);
        this.updateInfoPane(this.activeImage);
    },

    _handleEscape() {
        const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
        const isFullscreen = this.fullscreenElements?.overlay.style.display === 'flex';

        if (isFullscreen) {
            const source = this._hideFullscreenView();
            if (source === 'zoomed' && this.activeImage) {
                this._showZoomedView(this.activeImage);
            }
        } else if (isZoomed) {
            this._hideZoomedView();
        }
    },

    _handleKeyDown(e) {
        if (!this.panelElements?.panelEl || this.panelElements.panelEl.style.display === 'none') return;
        
        const targetTagName = e.target.tagName.toLowerCase();
        if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
            return;
        }

        const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
        const isFullscreen = this.fullscreenElements?.overlay.style.display === 'flex';

        switch(e.key) {
            case 'Enter':
                e.preventDefault();
                if (this.currentNavIndex === -1 && this.filteredImages.length > 0) {
                    this._navigate(1); // Select first image if none is selected
                }
                if (this.currentNavIndex === -1) return;

                const imageToDisplay = this.filteredImages[this.currentNavIndex];

                if (e.shiftKey) { // Shift+Enter: go directly to fullscreen
                    if (!isFullscreen) this._showFullscreenView(imageToDisplay);
                } else { // Regular Enter: toggle between views
                    if (isZoomed) this._showFullscreenView(imageToDisplay);
                    else if (!isFullscreen) this._showZoomedView(imageToDisplay);
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
        const updateTransform = () => {
            imageEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
        };

        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const oldScale = state.scale;
            const zoomFactor = 1.1;
            
            const newScale = e.deltaY < 0 ? oldScale * zoomFactor : oldScale / zoomFactor;
            
            // Clamp the scale to a reasonable range
            state.scale = Math.max(1, Math.min(newScale, 30));

            // If the scale didn't change (e.g., at min/max), do nothing
            if (state.scale === oldScale) return;

            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // The translation needs to be adjusted to keep the point under the mouse stationary
            // The formula is: new_translate = mouse_pos - (mouse_pos - old_translate) * (new_scale / old_scale)
            state.tx = mouseX - (mouseX - state.tx) * (state.scale / oldScale);
            state.ty = mouseY - (mouseY - state.ty) * (state.scale / oldScale);

            if (state.scale <= 1) {
                // If scale is back to 1 or less, reset everything for a clean, centered state
                this._resetTransform(state, imageEl, container);
            } else {
                imageEl.style.cursor = 'grab';
            }
            
            updateTransform();
        });

        imageEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (state.scale <= 1) return;
            
            let startX = e.clientX - state.tx;
            let startY = e.clientY - state.ty;
            
            imageEl.style.cursor = 'grabbing';
            imageEl.style.transition = 'none';

            const onMouseMove = (moveEvent) => {
                state.tx = moveEvent.clientX - startX;
                state.ty = moveEvent.clientY - startY;
                updateTransform();
            };

            const onMouseUp = () => {
                imageEl.style.cursor = 'grab';
                imageEl.style.transition = 'transform 0.2s ease-out';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },

    setLoadingState(message) {
        const galleryEl = document.getElementById("holaf-viewer-gallery");
        if (galleryEl) galleryEl.innerHTML = `<p class="holaf-viewer-message">${message}</p>`;
    },

    applyCurrentTheme() {
        if (this.panelElements?.panelEl) {
            const currentThemeName = holafModelManager.settings.theme; 
            const themeConfig = HOLAF_THEMES.find(t => t.name === currentThemeName) || HOLAF_THEMES[0];
            HOLAF_THEMES.forEach(t => this.panelElements.panelEl.classList.remove(t.className));
            this.panelElements.panelEl.classList.add(themeConfig.className);
        }
    },

    show() {
        if (!this.panelElements) this.createPanel();
        if (this.panelElements?.panelEl) {
            this.applyCurrentTheme();
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl);

            this.loadImages();
            if (this.refreshIntervalId) clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = setInterval(() => this.loadImages(), 15000);

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
        }
    }
};

app.registerExtension({
    name: "Holaf.ImageViewer.Panel",
    async setup() {
        holafImageViewer.init();
    },
});

export default holafImageViewer;