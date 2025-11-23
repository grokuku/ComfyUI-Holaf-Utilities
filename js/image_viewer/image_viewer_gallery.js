/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Gallery Module
 *
 * MAJOR REFACTOR: This module now implements a high-performance virtualized scroller.
 * It calculates the total gallery height to create an accurate scrollbar,
 * but only ever renders the thumbnail elements that are currently visible in the viewport.
 * FIX: Flickering on scroll is eliminated by using differential DOM updates.
 * FIX: Scroll position is now preserved correctly during window resizes.
 * FIX: Deadlock in thumbnail loader fixed with safety timeouts and immediate DOM insertion.
 */

import { imageViewerState } from "./image_viewer_state.js";
import { showFullscreenView } from './image_viewer_navigation.js';

// --- Configuration ---
const SCROLLBAR_DEBOUNCE_MS = 150;
// Increased concurrency limit as modern browsers handle this well
const MAX_CONCURRENT_THUMBNAIL_LOADS = 24;

// --- Module-level state ---
let viewerInstance = null;
let galleryEl = null;
let gallerySizerEl = null;
let galleryGridEl = null;
let resizeObserver = null;
let renderedPlaceholders = new Map();
let scrollbarDebounceTimeout = null;

let isWheelScrolling = false;
let wheelScrollTimeout = null;
let activeThumbnailLoads = 0;

let columnCount = 0;
let itemWidth = 0;
let itemHeight = 0;
let gap = 0;
let renderRequestID = null;

// --- Internal Functions (not exported directly) ---

function handleResize() {
    const { images } = imageViewerState.getState();
    if (!images || images.length === 0 || !galleryEl) return;

    const oldItemHeightWithGap = itemHeight + gap;

    let topVisibleIndex = 0;
    if (oldItemHeightWithGap > 0 && columnCount > 0) {
        const topRow = Math.floor(galleryEl.scrollTop / oldItemHeightWithGap);
        topVisibleIndex = topRow * columnCount;
    }

    updateLayout(false);

    if (topVisibleIndex > 0 && columnCount > 0) {
        const newTopRow = Math.floor(topVisibleIndex / columnCount);
        const newScrollTop = newTopRow * (itemHeight + gap);
        galleryEl.scrollTop = newScrollTop;
    }

    renderVisibleItems(true);
}

function updateLayout(renderAfter = true, overrideThumbSize = null) {
    if (!galleryEl || !viewerInstance) return;

    const targetThumbSize = overrideThumbSize !== null ? overrideThumbSize : imageViewerState.getState().ui.thumbnail_size;

    const containerWidth = galleryEl.clientWidth;
    const style = window.getComputedStyle(galleryGridEl);
    gap = parseFloat(style.getPropertyValue('gap')) || 8;

    columnCount = Math.max(1, Math.floor((containerWidth + gap) / (targetThumbSize + gap)));
    const totalGapWidth = (columnCount - 1) * gap;
    itemWidth = (containerWidth - totalGapWidth) / columnCount;
    itemHeight = itemWidth;

    const { images } = imageViewerState.getState();
    const rowCount = Math.ceil(images.length / columnCount);
    const totalHeight = rowCount * (itemHeight + gap);
    gallerySizerEl.style.height = `${totalHeight}px`;

    if (renderAfter) {
        renderVisibleItems(true);
    }
}

function renderVisibleItems() {
    if (renderRequestID) {
        cancelAnimationFrame(renderRequestID);
    }

    renderRequestID = requestAnimationFrame(() => {
        renderRequestID = null;

        if (columnCount === 0) return;
        const { images, activeImage, selectedImages } = imageViewerState.getState();

        if (!images.length || !galleryEl || !galleryGridEl || itemHeight === 0) {
            return;
        }

        const viewportHeight = galleryEl.clientHeight;
        const scrollTop = galleryEl.scrollTop;

        const buffer = viewportHeight * 1.5;
        const visibleAreaStart = Math.max(0, scrollTop - buffer);
        const visibleAreaEnd = scrollTop + viewportHeight + buffer;

        const itemHeightWithGap = itemHeight + gap;
        const startRow = Math.max(0, Math.floor(visibleAreaStart / itemHeightWithGap));
        const endRow = Math.ceil(visibleAreaEnd / itemHeightWithGap);

        const startIndex = startRow * columnCount;
        const endIndex = Math.min(images.length - 1, (endRow * columnCount) + columnCount - 1);

        const newPlaceholdersToRender = new Map();
        const fragment = document.createDocumentFragment();

        for (let i = startIndex; i <= endIndex; i++) {
            const image = images[i];
            if (!image) continue;

            const path = image.path_canon;
            let placeholder;

            if (renderedPlaceholders.has(path)) {
                placeholder = renderedPlaceholders.get(path);
                renderedPlaceholders.delete(path);
            } else {
                placeholder = createPlaceholder(viewerInstance, image, i);
                fragment.appendChild(placeholder);
            }

            const row = Math.floor(i / columnCount);
            const col = i % columnCount;
            const top = row * itemHeightWithGap;
            const left = col * (itemWidth + gap);

            const transformVal = `translate(${left}px, ${top}px)`;
            if (placeholder.style.transform !== transformVal) {
                placeholder.style.transform = transformVal;
            }

            placeholder.style.width = `${itemWidth}px`;
            placeholder.style.height = `${itemHeight}px`;

            placeholder.classList.toggle('active', activeImage && activeImage.path_canon === path);
            const isSelected = [...selectedImages].some(selImg => selImg.path_canon === path);
            placeholder.querySelector('.holaf-viewer-thumb-checkbox').checked = isSelected;

            newPlaceholdersToRender.set(path, placeholder);
        }

        for (const element of renderedPlaceholders.values()) {
            element.remove();
        }

        if (fragment.childElementCount > 0) {
            galleryGridEl.appendChild(fragment);
        }

        renderedPlaceholders = newPlaceholdersToRender;
        loadVisibleThumbnails();
    });
}

function debouncedLoadVisibleThumbnails() {
    clearTimeout(scrollbarDebounceTimeout);
    scrollbarDebounceTimeout = setTimeout(loadVisibleThumbnails, SCROLLBAR_DEBOUNCE_MS);
}

function loadVisibleThumbnails() {
    const placeholdersToLoad = Array.from(galleryGridEl.children);

    // Helper to pump the queue
    const process = () => {
        if (activeThumbnailLoads >= MAX_CONCURRENT_THUMBNAIL_LOADS) return;
        const nextPlaceholder = placeholdersToLoad.find(p => !p.dataset.thumbnailLoadingOrLoaded);

        if (nextPlaceholder) {
            activeThumbnailLoads++;
            const imageIndex = parseInt(nextPlaceholder.dataset.index, 10);
            const image = imageViewerState.getState().images[imageIndex];
            if (image) {
                loadSpecificThumbnail(nextPlaceholder, image, false, () => {
                    activeThumbnailLoads--;
                    if (activeThumbnailLoads < 0) activeThumbnailLoads = 0;
                    process();
                });
            } else {
                activeThumbnailLoads--;
                setTimeout(process, 0);
            }
        }
    };

    // Start as many workers as allowed
    for (let i = 0; i < MAX_CONCURRENT_THUMBNAIL_LOADS; i++) process();
}

function loadSpecificThumbnail(placeholder, image, forceReload = false, onCompleteCallback = null) {
    if (placeholder.dataset.thumbnailLoadingOrLoaded === 'true' && !forceReload) {
        if (onCompleteCallback) onCompleteCallback();
        return;
    }

    placeholder.dataset.thumbnailLoadingOrLoaded = "true";
    placeholder.classList.remove('error');
    const existingError = placeholder.querySelector('.holaf-viewer-error-overlay');
    if (existingError) existingError.remove();

    const oldImg = placeholder.querySelector('img');
    if (oldImg && !forceReload) {
        if (onCompleteCallback) onCompleteCallback();
        return;
    }
    if (oldImg) oldImg.remove();

    const onComplete = () => { if (onCompleteCallback) onCompleteCallback(); };

    const imageUrl = new URL(window.location.origin);
    imageUrl.pathname = '/holaf/images/thumbnail';
    const cacheBuster = image.thumb_hash ? image.thumb_hash : (image.mtime || '');
    const params = {
        filename: image.filename,
        subfolder: image.subfolder,
        path_canon: image.path_canon,
        mtime: cacheBuster,
        t: forceReload ? new Date().getTime() : ''
    };
    imageUrl.search = new URLSearchParams(params);

    const img = document.createElement('img');
    img.alt = image.filename;
    img.loading = "lazy";
    img.className = "holaf-image-viewer-thumbnail";

    // --- CRITICAL FIX: Safety timeout to prevent deadlocks ---
    const safetyTimeout = setTimeout(() => {
        // If image takes too long, consider it "done" for the queue's sake
        // but let it keep loading in the background.
        onComplete();
    }, 10000); // 10 seconds safety valve

    img.onload = () => {
        clearTimeout(safetyTimeout);
        if (!placeholder.querySelector('.holaf-viewer-fullscreen-icon')) {
            const fsIcon = document.createElement('div');
            fsIcon.className = 'holaf-viewer-fullscreen-icon';
            fsIcon.innerHTML = '⛶';
            fsIcon.title = 'View fullscreen';
            fsIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                const imageIndex = parseInt(placeholder.dataset.index, 10);
                if (!isNaN(imageIndex)) {
                    imageViewerState.setState({ activeImage: image, currentNavIndex: imageIndex });
                }
                showFullscreenView(viewerInstance, image);
            });
            placeholder.appendChild(fsIcon);
        }
        onComplete();
    };

    img.onerror = () => {
        clearTimeout(safetyTimeout);
        placeholder.classList.add('error');
        placeholder.dataset.thumbnailLoadingOrLoaded = "error";
        const errorDiv = document.createElement('div');
        errorDiv.className = 'holaf-viewer-error-overlay';
        errorDiv.textContent = 'Load Failed';
        placeholder.appendChild(errorDiv);
        onComplete();
    };

    img.src = imageUrl.href;
    // --- CRITICAL FIX: Append immediately so browser manages it ---
    placeholder.prepend(img);
}

function createPlaceholder(viewer, image, index) {
    const placeholder = document.createElement('div');
    placeholder.className = 'holaf-viewer-thumbnail-placeholder';
    placeholder.style.position = 'absolute';
    placeholder.dataset.index = index;
    placeholder.dataset.pathCanon = image.path_canon;

    // --- MODIFICATION: Video Icon Logic ---
    const actionIcon = document.createElement('div');
    // We keep the base class 'holaf-viewer-edit-icon' so it inherits the top-right positioning
    // from the existing CSS.
    actionIcon.className = 'holaf-viewer-edit-icon';

    if (['MP4', 'WEBM'].includes(image.format)) {
        // Video Case
        actionIcon.innerHTML = '🎥'; // Camera icon
        actionIcon.title = "Video media";
        // We do NOT add the 'active' class (which usually means "has edits") for videos yet.
        
        actionIcon.onclick = (e) => {
            e.stopPropagation();
            // Placeholder for future video player logic
            console.log("Video action clicked (Not yet implemented) for:", image.filename);
        };
    } else {
        // Standard Image Case
        actionIcon.innerHTML = '✎';
        actionIcon.title = "Edit image";
        actionIcon.classList.toggle('active', image.has_edit_file);
        
        actionIcon.onclick = (e) => {
            e.stopPropagation();
            imageViewerState.setState({ activeImage: image, currentNavIndex: index });
            viewer._showZoomedView(image);
        };
    }
    placeholder.appendChild(actionIcon);
    // --- END MODIFICATION ---

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'holaf-viewer-thumb-checkbox';
    checkbox.title = "Select image";
    placeholder.appendChild(checkbox);

    placeholder.addEventListener('click', (e) => {
        if (e.target.closest('.holaf-viewer-edit-icon, .holaf-viewer-fullscreen-icon')) return;
        const state = imageViewerState.getState();
        const clickedIndex = parseInt(e.currentTarget.dataset.index, 10);
        if (isNaN(clickedIndex)) return;
        const clickedImageData = state.images[clickedIndex];
        if (!clickedImageData) return;
        const anchorIndex = state.currentNavIndex > -1 ? state.currentNavIndex : clickedIndex;
        const selectedPaths = new Set([...state.selectedImages].map(img => img.path_canon));
        if (e.shiftKey) {
            if (!e.ctrlKey) selectedPaths.clear();
            const start = Math.min(anchorIndex, clickedIndex);
            const end = Math.max(anchorIndex, clickedIndex);
            for (let i = start; i <= end; i++) {
                if (state.images[i]) selectedPaths.add(state.images[i].path_canon);
            }
        } else if (e.ctrlKey || e.target.tagName === 'INPUT') {
            if (selectedPaths.has(clickedImageData.path_canon)) {
                selectedPaths.delete(clickedImageData.path_canon);
            } else {
                selectedPaths.add(clickedImageData.path_canon);
            }
        } else {
            selectedPaths.clear();
            selectedPaths.add(clickedImageData.path_canon);
        }
        const newSelectedImages = new Set(state.images.filter(img => selectedPaths.has(img.path_canon)));
        imageViewerState.setState({ selectedImages: newSelectedImages, activeImage: clickedImageData, currentNavIndex: clickedIndex });
        renderVisibleItems();
        viewer._updateActionButtonsState();
    });

    placeholder.addEventListener('dblclick', (e) => {
        if (e.target.closest('.holaf-viewer-edit-icon, .holaf-viewer-fullscreen-icon, .holaf-viewer-thumb-checkbox')) return;
        imageViewerState.setState({ activeImage: image, currentNavIndex: index });
        viewer._showZoomedView(image);
    });

    return placeholder;
}


// --- Functions to be exported ---

function initGallery(viewer) {
    viewerInstance = viewer;
    galleryEl = document.getElementById("holaf-viewer-gallery");

    document.addEventListener('holaf-refresh-thumbnail', (e) => {
        const { path_canon } = e.detail;
        if (path_canon) refreshThumbnailInGallery(path_canon);
    });

    galleryEl.innerHTML = `
        <div id="holaf-gallery-sizer" style="position: relative; width: 100%; height: 0; pointer-events: none;"></div>
        <div id="holaf-gallery-grid" style="position: absolute; top: 0; left: 0; width: 100%;"></div>
    `;
    gallerySizerEl = document.getElementById("holaf-gallery-sizer");
    galleryGridEl = document.getElementById("holaf-gallery-grid");

    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(galleryEl);

    galleryEl.addEventListener('wheel', () => {
        isWheelScrolling = true;
        clearTimeout(wheelScrollTimeout);
        wheelScrollTimeout = setTimeout(() => { isWheelScrolling = false; }, 300);
    }, { passive: true });

    galleryEl.addEventListener('scroll', () => {
        renderVisibleItems();
        if (isWheelScrolling) {
            loadVisibleThumbnails();
        } else {
            debouncedLoadVisibleThumbnails();
        }
    }, { passive: true });

    viewer.gallery = {
        ensureImageVisible,
        alignImageOnExit,
        refreshThumbnail: refreshThumbnailInGallery,
        render: renderVisibleItems,
        getColumnCount: () => columnCount
    };
}

function syncGallery(viewer, images) {
    if (!galleryEl) initGallery(viewer);

    viewerInstance = viewer;
    const { images: allImages } = imageViewerState.getState();

    // --- CRITICAL FIX: Reset Semaphore on sync ---
    activeThumbnailLoads = 0;

    galleryGridEl.innerHTML = '';
    renderedPlaceholders.clear();

    const messageEl = galleryEl.querySelector('.holaf-viewer-message');
    if (messageEl) messageEl.remove();

    galleryEl.scrollTop = 0;

    if (allImages && allImages.length > 0) {
        updateLayout(true);
    } else {
        gallerySizerEl.style.height = '300px';

        const placeholder = document.createElement('div');
        placeholder.className = 'holaf-viewer-thumbnail-placeholder holaf-viewer-empty-message';
        placeholder.style.cssText = `
            position: absolute;
            top: 8px; left: 8px; right: 8px; 
            height: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 20px;
            box-sizing: border-box;
            border: 2px dashed var(--holaf-border-color);
            border-radius: var(--holaf-border-radius);
            color: var(--holaf-text-color-secondary);
        `;
        placeholder.textContent = 'No images match the current filters.';
        galleryGridEl.appendChild(placeholder);
    }
}

function refreshThumbnailInGallery(path_canon) {
    const placeholder = renderedPlaceholders.get(path_canon);
    if (!placeholder) return;
    const allImages = imageViewerState.getState().images;
    const image = allImages.find(img => img.path_canon === path_canon);
    if (!image) return;

    const editIcon = placeholder.querySelector('.holaf-viewer-edit-icon');
    if (editIcon) editIcon.classList.add('active');

    loadSpecificThumbnail(placeholder, image, true);
}

function ensureImageVisible(imageIndex) {
    if (!galleryEl || imageIndex < 0) return;

    renderVisibleItems();

    setTimeout(() => {
        const targetElement = galleryGridEl.querySelector(`[data-index="${imageIndex}"]`);

        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            if (columnCount <= 0 || itemHeight === 0) return;
            const targetRow = Math.floor(imageIndex / columnCount);
            galleryEl.scrollTop = targetRow * (itemHeight + gap);
            renderVisibleItems();
        }
    }, 50);
}

function alignImageOnExit(imageIndex) {
    if (!galleryEl || imageIndex < 0) return;

    renderVisibleItems();

    setTimeout(() => {
        const targetElement = galleryGridEl.querySelector(`[data-index="${imageIndex}"]`);

        if (targetElement) {
            const rect = targetElement.getBoundingClientRect();
            const galleryRect = galleryEl.getBoundingClientRect();
            const isVisible = rect.top >= galleryRect.top && rect.bottom <= galleryRect.bottom;

            if (isVisible) {
                return;
            }

            if (rect.top < galleryRect.top) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
        } else {
            if (columnCount <= 0 || itemHeight === 0) return;
            const targetRow = Math.floor(imageIndex / columnCount);
            galleryEl.scrollTop = targetRow * (itemHeight + gap);
            renderVisibleItems();
        }
    }, 50);
}

function forceRelayout(newSize) {
    if (!galleryEl) return;
    updateLayout(true, newSize);
}

export {
    initGallery,
    syncGallery,
    ensureImageVisible,
    alignImageOnExit,
    refreshThumbnailInGallery,
    forceRelayout
};