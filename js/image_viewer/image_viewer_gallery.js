/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Gallery Module
 *
 * This module manages the core gallery rendering logic, including
 * virtual/infinite scrolling, thumbnail loading, and prioritization.
 * REFACTOR: Updated to use the central imageViewerState.
 * FIX: Corrected selection logic to be fully state-driven and reliable.
 */

import { imageViewerState } from "./image_viewer_state.js";
import { showFullscreenView } from './image_viewer_navigation.js';

const RENDER_BATCH_SIZE = 50;
const RENDER_CHUNK_SIZE = 10;
const PRIORITIZE_BATCH_SIZE = 50;
const PRIORITIZE_DEBOUNCE_MS = 500;

/**
 * Schedules a debounced call to the thumbnail prioritization API.
 * @param {object} viewer - The main image viewer instance.
 */
function schedulePrioritizeThumbnails(viewer) {
    clearTimeout(viewer.prioritizeTimeoutId);
    viewer.prioritizeTimeoutId = setTimeout(async () => {
        if (viewer.visiblePlaceholdersToPrioritize.size === 0) return;

        const pathsToPrioritize = Array.from(viewer.visiblePlaceholdersToPrioritize);
        viewer.visiblePlaceholdersToPrioritize.clear();

        for (let i = 0; i < pathsToPrioritize.length; i += PRIORITIZE_BATCH_SIZE) {
            const batch = pathsToPrioritize.slice(i, i + PRIORITIZE_BATCH_SIZE);
            try {
                await fetch('/holaf/images/prioritize-thumbnails', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paths_canon: batch, context: "gallery_visible" })
                });
            } catch (e) {
                console.error("[Holaf ImageViewer] Error prioritizing thumbnails batch:", e);
            }
        }
    }, PRIORITIZE_DEBOUNCE_MS);
}

/**
 * Loads the actual thumbnail image for a given placeholder.
 * @param {object} viewer - The main image viewer instance.
 * @param {HTMLElement} placeholder - The placeholder element.
 * @param {object} image - The image data object.
 * @param {boolean} [forceRegen=false] - Whether to force regeneration of the thumbnail.
 */
export function loadSpecificThumbnail(viewer, placeholder, image, forceRegen = false) {
    placeholder.dataset.thumbnailLoadingOrLoaded = "true";

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
        placeholder.classList.remove('error');
        const errorContent = placeholder.querySelector('.holaf-viewer-error-overlay');
        const retryButton = placeholder.querySelector('.holaf-viewer-retry-button');
        if (errorContent) errorContent.remove();
        if (retryButton) retryButton.remove();

        if (!placeholder.querySelector('.holaf-viewer-fullscreen-icon')) {
            const fsIcon = document.createElement('div');
            fsIcon.className = 'holaf-viewer-fullscreen-icon';
            fsIcon.innerHTML = '⛶';
            fsIcon.title = 'View fullscreen';
            fsIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                showFullscreenView(viewer, image);
            });
            placeholder.appendChild(fsIcon);
        }
        placeholder.prepend(img);
    };
    img.onerror = async () => {
        const existingImg = placeholder.querySelector('img');
        if (existingImg) existingImg.remove();
        const existingFsIcon = placeholder.querySelector('.holaf-viewer-fullscreen-icon');
        if (existingFsIcon) existingFsIcon.remove();

        const oldError = placeholder.querySelector('.holaf-viewer-error-overlay');
        const oldRetry = placeholder.querySelector('.holaf-viewer-retry-button');
        if (oldError) oldError.remove();
        if (oldRetry) oldRetry.remove();

        placeholder.classList.add('error');
        placeholder.dataset.thumbnailLoadingOrLoaded = "error";

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
            placeholder.dataset.thumbnailLoadingOrLoaded = "";
            loadSpecificThumbnail(viewer, placeholder, image, true);
        };
        
        placeholder.appendChild(errorOverlay);
        placeholder.appendChild(retryButton);
    };
}

/**
 * Creates a placeholder element for a thumbnail.
 * @param {object} viewer - The main image viewer instance.
 * @param {object} image - The image data object.
 * @param {number} index - The index of the image in the filtered list.
 * @returns {HTMLElement} The created placeholder element.
 */
export function createPlaceholder(viewer, image, index) {
    const placeholder = document.createElement('div');
    placeholder.className = 'holaf-viewer-thumbnail-placeholder';
    placeholder.dataset.index = index;

    const editIcon = document.createElement('div');
    editIcon.className = 'holaf-viewer-edit-icon';
    editIcon.innerHTML = '✎';
    editIcon.title = "Edit image";
    if (image.has_edit_file) {
        editIcon.classList.add('active');
    }
    editIcon.onclick = (e) => {
        e.stopPropagation();
        viewer._showZoomedView(image);
    };
    placeholder.appendChild(editIcon);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'holaf-viewer-thumb-checkbox';
    
    const { selectedImages } = imageViewerState.getState();
    const isSelected = selectedImages.some(selImg => selImg.path_canon === image.path_canon);
    checkbox.checked = isSelected;
    checkbox.title = "Select image";
    placeholder.appendChild(checkbox);

    placeholder.addEventListener('click', (e) => {
        if (e.target.closest('.holaf-viewer-edit-icon, .holaf-viewer-fullscreen-icon')) {
            return;
        }

        const state = imageViewerState.getState();
        const clickedImageData = state.images[index];
        const anchorIndex = state.currentNavIndex > -1 ? state.currentNavIndex : index;
        const selectedPaths = new Set(state.selectedImages.map(img => img.path_canon));

        if (e.shiftKey) {
            if (!e.ctrlKey) {
                selectedPaths.clear();
            }
            const start = Math.min(anchorIndex, index);
            const end = Math.max(anchorIndex, index);
            for (let i = start; i <= end; i++) {
                if (state.images[i]) {
                    selectedPaths.add(state.images[i].path_canon);
                }
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
        
        const newSelectedImages = new Set(
            state.images.filter(img => selectedPaths.has(img.path_canon))
        );

        imageViewerState.setState({ 
            selectedImages: newSelectedImages,
            activeImage: clickedImageData,
            currentNavIndex: index
        });
        
        // --- Legacy UI Updates ---
        document.querySelectorAll('.holaf-viewer-thumbnail-placeholder').forEach(ph => {
            const phIndex = parseInt(ph.dataset.index);
            if (state.images[phIndex]) {
                 const phImg = state.images[phIndex];
                 const phCheckbox = ph.querySelector('.holaf-viewer-thumb-checkbox');
                 if (phCheckbox) {
                     phCheckbox.checked = selectedPaths.has(phImg.path_canon);
                 }
            }
        });

        viewer._updateActiveThumbnail(index);
        // CORRECT: The manual call to updateInfoPane is removed. It updates automatically.
        viewer._updateActionButtonsState();
    });

    placeholder.addEventListener('dblclick', (e) => {
        if (e.target.closest('.holaf-viewer-edit-icon, .holaf-viewer-fullscreen-icon, .holaf-viewer-thumb-checkbox')) return;
        viewer._showZoomedView(image);
    });
    return placeholder;
}

/**
 * Renders the main gallery, creating placeholders and setting up the IntersectionObserver.
 * @param {object} viewer - The main image viewer instance.
 */
export function renderGallery(viewer) {
    const galleryEl = document.getElementById("holaf-viewer-gallery");
    if (!galleryEl) return;
    if (viewer.galleryObserver) viewer.galleryObserver.disconnect();
    if (viewer.backgroundRenderHandle) cancelAnimationFrame(viewer.backgroundRenderHandle);
    galleryEl.innerHTML = '';
    viewer.renderedCount = 0;
    viewer.visiblePlaceholdersToPrioritize.clear();
    
    const { images } = imageViewerState.getState();

    if (!images || images.length === 0) {
        viewer.setLoadingState("No images match the current filters.");
        viewer._updateActionButtonsState();
        return;
    }

    const sentinel = document.createElement('div');
    sentinel.id = 'holaf-viewer-load-sentinel';
    galleryEl.appendChild(sentinel);

    viewer.galleryObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            const placeholder = entry.target;
            if (placeholder.id === 'holaf-viewer-load-sentinel') {
                renderImageBatch(viewer);
            } else {
                const imageIndex = parseInt(placeholder.dataset.index);
                const image = imageViewerState.getState().images[imageIndex];
                if (image) {
                    if (!placeholder.dataset.thumbnailLoadingOrLoaded) {
                        viewer.visiblePlaceholdersToPrioritize.add(image.path_canon);
                        schedulePrioritizeThumbnails(viewer);
                    }
                    viewer.galleryObserver.unobserve(placeholder);
                    loadSpecificThumbnail(viewer, placeholder, image, false);
                }
            }
        });
    }, { root: galleryEl, rootMargin: "400px 0px" });

    renderImageBatch(viewer);
    viewer.galleryObserver.observe(sentinel);
    viewer._updateActionButtonsState();
}

/**
 * Renders a batch of image placeholders when the sentinel is triggered.
 * @param {object} viewer - The main image viewer instance.
 */
export function renderImageBatch(viewer) {
    const galleryEl = document.getElementById("holaf-viewer-gallery");
    const sentinel = document.getElementById('holaf-viewer-load-sentinel');
    if (!galleryEl) return;

    if (viewer.backgroundRenderHandle) {
        cancelAnimationFrame(viewer.backgroundRenderHandle);
        viewer.backgroundRenderHandle = null;
    }

    const { images } = imageViewerState.getState();
    const fragment = document.createDocumentFragment();
    const nextRenderLimit = Math.min(viewer.renderedCount + RENDER_BATCH_SIZE, images.length);

    for (let i = viewer.renderedCount; i < nextRenderLimit; i++) {
        const placeholder = createPlaceholder(viewer, images[i], i);
        fragment.appendChild(placeholder);
        viewer.galleryObserver.observe(placeholder);
    }

    if (sentinel) {
        galleryEl.insertBefore(fragment, sentinel);
    } else {
        galleryEl.appendChild(fragment);
    }
    viewer.renderedCount = nextRenderLimit;

    if (viewer.renderedCount < images.length) {
        startBackgroundRendering(viewer);
    } else {
        if (sentinel) sentinel.remove();
    }
}

/**
 * Starts a non-blocking, progressive background rendering of remaining placeholders.
 * @param {object} viewer - The main image viewer instance.
 */
export function startBackgroundRendering(viewer) {
    if (viewer.backgroundRenderHandle) {
        cancelAnimationFrame(viewer.backgroundRenderHandle);
    }

    const galleryEl = document.getElementById("holaf-viewer-gallery");
    const sentinel = document.getElementById('holaf-viewer-load-sentinel');
    if (!galleryEl) return;
    
    const { images } = imageViewerState.getState();

    const renderNextChunk = () => {
        if (viewer.renderedCount >= images.length) {
            if (sentinel) sentinel.remove();
            viewer.backgroundRenderHandle = null;
            return;
        }

        const fragment = document.createDocumentFragment();
        const nextRenderLimit = Math.min(viewer.renderedCount + RENDER_CHUNK_SIZE, images.length);

        for (let i = viewer.renderedCount; i < nextRenderLimit; i++) {
            const placeholder = createPlaceholder(viewer, images[i], i);
            fragment.appendChild(placeholder);
            viewer.galleryObserver.observe(placeholder);
        }

        if (sentinel) {
            galleryEl.insertBefore(fragment, sentinel);
        } else {
            galleryEl.appendChild(fragment);
        }
        viewer.renderedCount = nextRenderLimit;

        viewer.backgroundRenderHandle = requestAnimationFrame(renderNextChunk);
    };

    viewer.backgroundRenderHandle = requestAnimationFrame(renderNextChunk);
}