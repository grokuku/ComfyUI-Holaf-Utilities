/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Gallery Module
 *
 * This module manages the core gallery rendering logic, including
 * virtual/infinite scrolling, thumbnail loading, and prioritization.
 * MODIFICATION: Added shift-click and ctrl-shift-click range selection logic.
 * MODIFICATION: Replaced setTimeout with requestAnimationFrame for non-blocking rendering.
 * CORRECTION: Replaced destructive 'innerHTML' with surgical DOM manipulation to fix disappearing icons.
 */

import { showFullscreenView, getFullImageUrl } from './image_viewer_navigation.js';

const RENDER_BATCH_SIZE = 50;   // How many placeholders to render when the scroll sentinel is hit.
const RENDER_CHUNK_SIZE = 10;   // How many placeholders to render per frame during background rendering.
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
        // CORRECTION START: Non-destructive DOM update for success
        // Non-destructively clean up placeholder from any previous error state
        placeholder.classList.remove('error');
        const errorContent = placeholder.querySelector('.holaf-viewer-error-overlay');
        const retryButton = placeholder.querySelector('.holaf-viewer-retry-button');
        if (errorContent) errorContent.remove();
        if (retryButton) retryButton.remove();

        // Ensure fullscreen icon exists (it's added on successful load)
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

        // Prepend the image itself. This preserves the existing checkbox and edit icon.
        placeholder.prepend(img);
        // CORRECTION END
    };
    img.onerror = async () => {
        // CORRECTION START: Non-destructive DOM update for error
        // Surgical cleanup: remove image and fullscreen icon if they exist from a prior success
        const existingImg = placeholder.querySelector('img');
        if (existingImg) existingImg.remove();
        const existingFsIcon = placeholder.querySelector('.holaf-viewer-fullscreen-icon');
        if (existingFsIcon) existingFsIcon.remove();

        // Clear previous error messages
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
        
        // Append error elements. This preserves checkbox and edit icon.
        placeholder.appendChild(errorOverlay);
        placeholder.appendChild(retryButton);
        // CORRECTION END
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

    // --- MODIFICATION: Add Edit Icon ---
    const editIcon = document.createElement('div');
    editIcon.className = 'holaf-viewer-edit-icon';
    editIcon.innerHTML = '✎'; // Pencil icon
    editIcon.title = "Edit image";
    if (image.has_edit_file) {
        editIcon.classList.add('active');
    }
    editIcon.onclick = (e) => {
        e.stopPropagation(); // Prevent grid click event
        viewer._showZoomedView(image); // This will open the editor
    };
    placeholder.appendChild(editIcon);
    // --- END MODIFICATION ---

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
        if (e.target.tagName === 'INPUT' || e.target.classList.contains('holaf-viewer-edit-icon')) return;

        const imgData = viewer.filteredImages[index];
        const hasAnchor = viewer.lastClickedIndex > -1;

        // --- MODIFIED: Reordered and added Ctrl+Shift logic ---

        // Case 1: Ctrl + Shift + Click (additive range selection)
        if (e.ctrlKey && e.shiftKey && hasAnchor) {
            const start = Math.min(viewer.lastClickedIndex, index);
            const end = Math.max(viewer.lastClickedIndex, index);

            // Add all items in the range to the current selection
            for (let i = start; i <= end; i++) {
                const imageInRange = viewer.filteredImages[i];
                viewer.selectedImages.add(imageInRange);
                const thumbInRange = document.querySelector(`.holaf-viewer-thumbnail-placeholder[data-index="${i}"]`);
                if (thumbInRange) {
                    const checkboxInRange = thumbInRange.querySelector('.holaf-viewer-thumb-checkbox');
                    if (checkboxInRange) checkboxInRange.checked = true;
                }
            }
            // Case 2: Shift + Click (exclusive range selection)
        } else if (e.shiftKey && hasAnchor) {
            const start = Math.min(viewer.lastClickedIndex, index);
            const end = Math.max(viewer.lastClickedIndex, index);

            // Clear previous selection and select only the new range
            document.querySelectorAll('.holaf-viewer-thumb-checkbox:checked').forEach(cb => cb.checked = false);
            viewer.selectedImages.clear();

            for (let i = start; i <= end; i++) {
                const imageInRange = viewer.filteredImages[i];
                viewer.selectedImages.add(imageInRange);
                const thumbInRange = document.querySelector(`.holaf-viewer-thumbnail-placeholder[data-index="${i}"]`);
                if (thumbInRange) {
                    const checkboxInRange = thumbInRange.querySelector('.holaf-viewer-thumb-checkbox');
                    if (checkboxInRange) checkboxInRange.checked = true;
                }
            }
            // Case 3: Ctrl + Click (toggle single item)
        } else if (e.ctrlKey) {
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
                viewer.selectedImages.add(imgData);
            } else {
                const itemToRemove = Array.from(viewer.selectedImages).find(selImg => selImg.path_canon === imgData.path_canon);
                if (itemToRemove) viewer.selectedImages.delete(itemToRemove);
            }
            // A ctrl-click sets the anchor for the next shift-click
            viewer.lastClickedIndex = index;
            // Case 4: Simple Click (select single item)
        } else {
            document.querySelectorAll('.holaf-viewer-thumb-checkbox:checked').forEach(cb => cb.checked = false);
            viewer.selectedImages.clear();
            checkbox.checked = true;
            viewer.selectedImages.add(imgData);
            // A simple click also sets the anchor
            viewer.lastClickedIndex = index;
        }

        // Update the 'active' image regardless of selection type
        viewer.activeImage = imgData;
        viewer.currentNavIndex = index;
        viewer._updateActiveThumbnail(viewer.currentNavIndex);
        viewer.updateInfoPane(imgData);
        viewer._updateActionButtonsState();
    });

    placeholder.addEventListener('dblclick', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.classList.contains('holaf-viewer-edit-icon')) return;
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
    viewer.lastClickedIndex = -1;


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

    renderImageBatch(viewer); // Render initial batch
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

    // Stop any existing background rendering, as the user has scrolled manually
    if (viewer.backgroundRenderHandle) {
        cancelAnimationFrame(viewer.backgroundRenderHandle);
        viewer.backgroundRenderHandle = null;
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

    // After a manual scroll/batch render, restart the non-blocking background rendering
    if (viewer.renderedCount < viewer.filteredImages.length) {
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

    const renderNextChunk = () => {
        // Stop if all images are rendered
        if (viewer.renderedCount >= viewer.filteredImages.length) {
            if (sentinel) sentinel.remove();
            viewer.backgroundRenderHandle = null;
            return;
        }

        const fragment = document.createDocumentFragment();
        const nextRenderLimit = Math.min(viewer.renderedCount + RENDER_CHUNK_SIZE, viewer.filteredImages.length);

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

        // Queue up the next chunk for the next animation frame
        viewer.backgroundRenderHandle = requestAnimationFrame(renderNextChunk);
    };

    // Start the non-blocking render loop
    viewer.backgroundRenderHandle = requestAnimationFrame(renderNextChunk);
}