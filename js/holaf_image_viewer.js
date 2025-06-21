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

        this.fullscreenElements.closeBtn.onclick = () => this._hideFullscreenView();
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
                defaultSize: { width: 1200, height: 800 },
                onClose: () => this.hide(),
            });

            this.populatePanelContent();
            this.applyCurrentTheme();
            this._createFullscreenOverlay();

        } catch (e) {
            console.error("[Holaf ImageViewer] Error creating panel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating Image Viewer panel. Check console for details." });
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.innerHTML = `
            <div class="holaf-viewer-container">
                <div id="holaf-viewer-left-pane" class="holaf-viewer-pane">
                    <div class="holaf-viewer-filter-group">
                        <h4>Folders</h4>
                        <div id="holaf-viewer-folders-filter" class="holaf-viewer-filter-list"></div>
                    </div>
                    <div class="holaf-viewer-filter-group">
                        <h4>Formats</h4>
                        <div id="holaf-viewer-formats-filter" class="holaf-viewer-filter-list"></div>
                    </div>
                </div>
                <div id="holaf-viewer-center-pane" class="holaf-viewer-pane">
                    <div id="holaf-viewer-toolbar">
                        <button id="holaf-viewer-refresh-btn" class="comfy-button" title="Refresh image list from server">Refresh</button>
                    </div>
                    <div id="holaf-viewer-gallery">
                        <p class="holaf-viewer-message">Click 'Refresh' to load images.</p>
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
        `;
        
        const zoomView = contentEl.querySelector('#holaf-viewer-zoom-view');
        const zoomCloseBtn = contentEl.querySelector('.holaf-viewer-zoom-close');
        const zoomImage = zoomView.querySelector('img');
        const zoomFullscreenBtn = contentEl.querySelector('.holaf-viewer-zoom-fullscreen-icon');

        const closeZoom = () => this._hideZoomedView();

        zoomCloseBtn.onclick = closeZoom;
        zoomImage.ondblclick = closeZoom;
        zoomImage.onclick = (e) => e.stopPropagation();
        
        zoomFullscreenBtn.onclick = () => {
            if (this.activeImage) {
                this._hideZoomedView();
                this._showFullscreenView(this.activeImage);
            }
        };

        this._setupZoomAndPan(this.zoomViewState, zoomView, zoomImage);
        document.getElementById('holaf-viewer-refresh-btn').onclick = () => this.loadImages();
    },

    async loadImages() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.setLoadingState("Loading image list from server...", true);

        try {
            const response = await fetch('/holaf/images/list', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);

            this.images = await response.json();
            this.populateFilters();
            this.applyFiltersAndRender();

        } catch (e) {
            console.error("[Holaf ImageViewer] Failed to load images:", e);
            this.setLoadingState(`Error: ${e.message}`, false);
        } finally {
            this.isLoading = false;
        }
    },

    populateFilters() {
        const folderSet = new Set();
        const formatSet = new Set();
        this.images.forEach(img => {
            folderSet.add(img.subfolder || '');
            formatSet.add(img.format);
        });

        const folders = Array.from(folderSet).sort();
        const formats = Array.from(formatSet).sort();

        const foldersEl = document.getElementById('holaf-viewer-folders-filter');
        const formatsEl = document.getElementById('holaf-viewer-formats-filter');

        foldersEl.innerHTML = '';
        formatsEl.innerHTML = '';

        folders.forEach(folder => {
            const id = `folder-filter-${folder || 'root'}`;
            const labelText = folder === '' ? 'root' : folder;
            const item = this.createFilterItem(id, labelText, true, () => this.applyFiltersAndRender());
            foldersEl.appendChild(item);
        });

        formats.forEach(format => {
            const id = `format-filter-${format}`;
            const item = this.createFilterItem(id, format, true, () => this.applyFiltersAndRender());
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
        document.querySelectorAll('#holaf-viewer-folders-filter input:checked').forEach(cb => {
            const folderName = cb.id.replace('folder-filter-', '');
            selectedFolders.push(folderName === 'root' ? '' : folderName);
        });

        const selectedFormats = [];
        document.querySelectorAll('#holaf-viewer-formats-filter input:checked').forEach(cb => {
            selectedFormats.push(cb.id.replace('format-filter-', ''));
        });

        this.filteredImages = this.images.filter(img => {
            const folderMatch = selectedFolders.includes(img.subfolder || '');
            const formatMatch = selectedFormats.includes(img.format);
            return folderMatch && formatMatch;
        });

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

        this.thumbnailObserver = new IntersectionObserver(this.onThumbnailVisible.bind(this), {
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

    onThumbnailVisible(entries, observer) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const placeholder = entry.target;
                const imageIndex = placeholder.dataset.index;
                const image = this.images[imageIndex];

                if (!image) return;

                observer.unobserve(placeholder);

                const imageUrl = new URL(window.location.origin);
                imageUrl.pathname = '/holaf/images/thumbnail';
                imageUrl.search = new URLSearchParams({
                    filename: image.filename,
                    subfolder: image.subfolder,
                    mtime: image.mtime
                });

                const img = document.createElement('img');
                img.src = imageUrl.href;
                img.alt = image.filename;
                img.loading = "lazy";

                img.onload = () => placeholder.prepend(img);
                img.onerror = () => {
                    placeholder.classList.add('error');
                    placeholder.innerText = 'ERR';
                };
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
            
            const getSourceLabel = (source) => {
                switch(source) {
                    case "external_txt": return "(from .txt file)";
                    case "external_json": return "(from .json file)";
                    case "internal_png": return "(from PNG metadata)";
                    default: return "";
                }
            };
            
            let content = '';

            const promptSourceLabel = getSourceLabel(data.prompt_source);
            content += `<p><span class="holaf-viewer-metadata-label">Prompt:</span> <span class="holaf-viewer-metadata-source">${promptSourceLabel}</span></p>`;
            if (data.prompt) content += `<div class="holaf-viewer-metadata-box">${data.prompt}</div>`;
            else content += `<p class="holaf-viewer-message"><em>Not available.</em></p>`;

            const workflowSourceLabel = getSourceLabel(data.workflow_source);
            content += `<p style="margin-top: 15px;"><span class="holaf-viewer-metadata-label">Workflow:</span> <span class="holaf-viewer-metadata-source">${workflowSourceLabel}</span></p>`;
            if (data.workflow && !data.workflow.error) content += `<div class="holaf-viewer-metadata-box">${JSON.stringify(data.workflow, null, 2)}</div>`;
            else if (data.workflow && data.workflow.error) content += `<p class="holaf-viewer-message error"><em>Error: ${data.workflow.error}</em></p>`;
            else content += `<p class="holaf-viewer-message"><em>No workflow found.</em></p>`;
            
            metadataContainer.innerHTML = content;

        } catch (err) {
            const metadataContainer = document.getElementById('holaf-metadata-container');
            if (err.name === 'AbortError') return;
            console.error("[Holaf ImageViewer] Error fetching metadata:", err);
            if(metadataContainer) metadataContainer.innerHTML = `<p class="holaf-viewer-message error"><strong>Error:</strong> Failed to fetch metadata.</p>`;
        } finally {
            this.metadataAbortController = null;
        }
    },
    
    _resetTransform(state, imageEl) {
        state.scale = 1;
        state.tx = 0;
        state.ty = 0;
        imageEl.style.transform = 'none';
        imageEl.style.cursor = 'zoom-out';
    },

    _showZoomedView(image) {
        const zoomImage = document.querySelector('#holaf-viewer-zoom-view img');
        this._resetTransform(this.zoomViewState, zoomImage);

        this.currentNavIndex = this._findImageIndexInFilteredList(image);
        if (this.currentNavIndex === -1) return;
        
        this.activeImage = image;

        zoomImage.src = this._getFullImageUrl(image);
        document.getElementById('holaf-viewer-zoom-view').style.display = 'flex';
        document.getElementById('holaf-viewer-gallery').style.display = 'none';
        
        this.updateInfoPane(image);
        this._updateActiveThumbnail(this.currentNavIndex);
    },

    _hideZoomedView() {
        document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
        document.getElementById('holaf-viewer-gallery').style.display = 'flex';
        this.currentNavIndex = -1;
    },

    _showFullscreenView(image) {
        this._resetTransform(this.fullscreenViewState, this.fullscreenElements.img);
        
        this.currentNavIndex = this._findImageIndexInFilteredList(image);
        if (this.currentNavIndex === -1) return;

        this.activeImage = image;
        
        this.fullscreenElements.img.src = this._getFullImageUrl(image);
        this.fullscreenElements.overlay.style.display = 'flex';
        
        this.updateInfoPane(image);
        this._updateActiveThumbnail(this.currentNavIndex);
    },
    
    _hideFullscreenView() {
        this.fullscreenElements.overlay.style.display = 'none';
        this.currentNavIndex = -1;
    },
    
    _navigate(direction) {
        if (this.currentNavIndex === -1 || this.filteredImages.length === 0) return;

        let newIndex = this.currentNavIndex + direction;

        if (newIndex < 0) newIndex = 0;
        if (newIndex >= this.filteredImages.length) newIndex = this.filteredImages.length - 1;
        
        if (newIndex === this.currentNavIndex) return;

        this.currentNavIndex = newIndex;
        const newImage = this.filteredImages[newIndex];
        this.activeImage = newImage;
        
        const isFullscreen = this.fullscreenElements.overlay.style.display === 'flex';
        const targetImageElement = isFullscreen ? this.fullscreenElements.img : document.querySelector('#holaf-viewer-zoom-view img');
        const viewState = isFullscreen ? this.fullscreenViewState : this.zoomViewState;

        this._resetTransform(viewState, targetImageElement);
        this._updateActiveThumbnail(newIndex);
        
        const updateMetadataOnLoad = () => this.updateInfoPane(newImage);

        targetImageElement.removeEventListener('load', updateMetadataOnLoad);
        targetImageElement.addEventListener('load', updateMetadataOnLoad, { once: true });
        targetImageElement.src = this._getFullImageUrl(newImage);
    },

    _handleKeyDown(e) {
        const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
        const isFullscreen = this.fullscreenElements?.overlay.style.display === 'flex';

        if (!isZoomed && !isFullscreen) return;

        switch(e.key) {
            case 'ArrowRight': e.preventDefault(); this._navigate(1); break;
            case 'ArrowLeft': e.preventDefault(); this._navigate(-1); break;
            case 'Escape':
                e.preventDefault();
                if(isFullscreen) this._hideFullscreenView();
                if(isZoomed) this._hideZoomedView();
                break;
        }
    },
    
    _setupZoomAndPan(state, container, imageEl) {
        const updateTransform = () => {
            imageEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
        };

        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const oldScale = state.scale;
            const zoomFactor = 1.1;
            
            if (e.deltaY < 0) { // Zoom in
                state.scale = Math.min(oldScale * zoomFactor, 20);
            } else { // Zoom out
                state.scale = Math.max(oldScale / zoomFactor, 1);
            }
            
            // Adjust translation to zoom towards mouse pointer
            state.tx = mouseX - (mouseX - state.tx) * (state.scale / oldScale);
            state.ty = mouseY - (mouseY - state.ty) * (state.scale / oldScale);

            if (state.scale <= 1) { // Reset pan when zoomed all the way out
                state.tx = 0;
                state.ty = 0;
                imageEl.style.cursor = 'zoom-out';
            } else {
                imageEl.style.cursor = 'grab';
            }
            
            updateTransform();
        });

        imageEl.addEventListener('mousedown', (e) => {
            if (state.scale <= 1) return;
            e.preventDefault();
            
            let startX = e.clientX - state.tx;
            let startY = e.clientY - state.ty;
            
            imageEl.style.cursor = 'grabbing';
            imageEl.style.transition = 'none'; // Disable transition for smooth panning

            const onMouseMove = (moveEvent) => {
                state.tx = moveEvent.clientX - startX;
                state.ty = moveEvent.clientY - startY;
                updateTransform();
            };

            const onMouseUp = () => {
                imageEl.style.cursor = 'grab';
                imageEl.style.transition = 'transform 0.2s ease-out'; // Re-enable transition
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
            if (!this.isInitialized) this.isInitialized = true;
        }
    },

    hide() {
        if (this.panelElements?.panelEl) {
            this.panelElements.panelEl.style.display = "none";
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