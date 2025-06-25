/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Gallery Module
 *
 * This module manages the core gallery rendering logic, including
 * virtual/infinite scrolling, thumbnail loading, and prioritization.
 */

import { showFullscreenView, getFullImageUrl } from './image_viewer_navigation.js';

const RENDER_BATCH_SIZE = 100;
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
        const currentCheckbox = placeholder.querySelector('.holaf-viewer-thumb-checkbox');
        const currentFsIcon = placeholder.querySelector('.holaf-viewer-fullscreen-icon');
        placeholder.innerHTML = '';
        placeholder.classList.remove('error');

        if(currentCheckbox) placeholder.appendChild(currentCheckbox);

        const fsIcon = currentFsIcon || document.createElement('div');
        if(!currentFsIcon) {
            fsIcon.className = 'holaf-viewer-fullscreen-icon';
            fsIcon.innerHTML = '⛶';
            fsIcon.title = 'View fullscreen';
            fsIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                showFullscreenView(viewer, image);
            });
        }
        placeholder.appendChild(fsIcon);
        placeholder.prepend(img);
    };
    img.onerror = async () => {
        const currentCheckbox = placeholder.querySelector('.holaf-viewer-thumb-checkbox');
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
        placeholder.innerHTML = '';
        if(currentCheckbox) placeholder.appendChild(currentCheckbox);
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

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'holaf-viewer-thumb-checkbox';
    
    checkbox.checked = Array.from(viewer.selectedImages).some(selImg => selImg.path_canon === image.path_canon);
    checkbox.title = "Select image";

    checkbox.onclick = (e) => { e.stopPropagation(); };
    checkbox.onchange = (e) => {
        e.stopPropagation();
        const imgData = viewer.filteredImages[index];
        if (e.target.checked) {
            viewer.selectedImages.add(imgData);
        } else {
            const itemToRemove = Array.from(viewer.selectedImages).find(selImg => selImg.path_canon === imgData.path_canon);
            if (itemToRemove) viewer.selectedImages.delete(itemToRemove);
        }
        viewer._updateActionButtonsState();
    };
    placeholder.appendChild(checkbox);

    placeholder.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;

        const imgData = viewer.filteredImages[index];

        if (!e.ctrlKey && !e.shiftKey) {
            document.querySelectorAll('.holaf-viewer-thumb-checkbox:checked').forEach(cb => cb.checked = false);
            viewer.selectedImages.clear();
            checkbox.checked = true;
            viewer.selectedImages.add(imgData);
        } else if (e.ctrlKey) {
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
                viewer.selectedImages.add(imgData);
            } else {
                const itemToRemove = Array.from(viewer.selectedImages).find(selImg => selImg.path_canon === imgData.path_canon);
                if (itemToRemove) viewer.selectedImages.delete(itemToRemove);
            }
        }
        
        viewer.activeImage = imgData;
        viewer.currentNavIndex = index;
        viewer._updateActiveThumbnail(viewer.currentNavIndex);
        viewer.updateInfoPane(imgData);
        viewer._updateActionButtonsState();
    });

    placeholder.addEventListener('dblclick', (e) => {
        if (e.target.tagName === 'INPUT') return;
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
    if (viewer.backgroundRenderHandle) clearTimeout(viewer.backgroundRenderHandle);
    galleryEl.innerHTML = '';
    viewer.renderedCount = 0;
    viewer.visiblePlaceholdersToPrioritize.clear();

    if (!viewer.filteredImages || viewer.filteredImages.length === 0) {
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
                const image = viewer.filteredImages[imageIndex];
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
 * Renders a batch of image placeholders.
 * @param {object} viewer - The main image viewer instance.
 * @param {boolean} [isBackground=false] - True if called from the background rendering loop.
 */
export function renderImageBatch(viewer, isBackground = false) {
    const galleryEl = document.getElementById("holaf-viewer-gallery");
    const sentinel = document.getElementById('holaf-viewer-load-sentinel');
    if (!galleryEl) return;

    if (viewer.backgroundRenderHandle && !isBackground) {
        clearTimeout(viewer.backgroundRenderHandle);
    }

    const fragment = document.createDocumentFragment();
    const nextRenderLimit = Math.min(viewer.renderedCount + RENDER_BATCH_SIZE, viewer.filteredImages.length);

    for (let i = viewer.renderedCount; i < nextRenderLimit; i++) {
        const placeholder = createPlaceholder(viewer, viewer.filteredImages[i], i);
        fragment.appendChild(placeholder);
        viewer.galleryObserver.observe(placeholder);
    }

    if (sentinel) {
        galleryEl.insertBefore(fragment, sentinel);
    } else {
        galleryEl.appendChild(fragment);
    }
    viewer.renderedCount = nextRenderLimit;

    if (viewer.renderedCount < viewer.filteredImages.length) {
        if (!isBackground) {
            startBackgroundRendering(viewer);
        }
    } else {
        if (sentinel) sentinel.remove();
    }
}

/**
 * Starts a progressive background rendering of remaining placeholders.
 * @param {object} viewer - The main image viewer instance.
 */
export function startBackgroundRendering(viewer) {
    if (viewer.backgroundRenderHandle) clearTimeout(viewer.backgroundRenderHandle);
    const renderNext = () => {
        if (viewer.renderedCount >= viewer.filteredImages.length) {
            viewer.backgroundRenderHandle = null;
            return;
        }
        renderImageBatch(viewer, true);
        viewer.backgroundRenderHandle = setTimeout(renderNext, 50);
    };
    viewer.backgroundRenderHandle = setTimeout(renderNext, 500);
}