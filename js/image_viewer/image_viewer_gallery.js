/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Gallery Module
 *
 * This module manages the core gallery rendering logic, including
 * virtual/infinite scrolling, thumbnail loading, and prioritization.
 * REFACTOR: Rebuilt with a differential rendering approach. Instead of
 * replacing the entire gallery, it now calculates the difference between
 * the current view and the new state, then animates additions and removals.
 * This eliminates the "flash" on filter changes and provides a fluid UX.
 * FIX: The new `refreshThumbnail` function directly targets a thumbnail by its
 * `data-path-canon`, which solves the longstanding editor refresh bug.
 * FIX: Corrected selection bug by reading the element's `dataset.index` at click
 * time, preventing the use of a stale index from the event listener's closure.
 */

import { imageViewerState } from "./image_viewer_state.js";
import { showFullscreenView } from './image_viewer_navigation.js';

const PRIORITIZE_BATCH_SIZE = 50;
const PRIORITIZE_DEBOUNCE_MS = 500;
const ANIMATION_DURATION_MS = 300; // Must match CSS transition duration

// --- CORRECTIF : Nouvelle fonction d'initialisation pour attacher les écouteurs globaux ---
/**
 * Initializes the gallery module by setting up global event listeners.
 * @param {object} viewer - The main image viewer instance.
 */
export function initGallery(viewer) {
    document.addEventListener('holaf-refresh-thumbnail', (e) => {
        const { path_canon } = e.detail;
        if (path_canon) {
            console.log(`[Holaf Gallery] Received holaf-refresh-thumbnail event for ${path_canon}`);
            _refreshSingleThumbnail(viewer, path_canon);
        }
    });
}

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
 * @param {boolean} [forceReload=false] - Whether to force a cache bust for the thumbnail.
 */
export function loadSpecificThumbnail(viewer, placeholder, image, forceReload = false) {
    // Clear any previous error state
    placeholder.classList.remove('error');
    const existingError = placeholder.querySelector('.holaf-viewer-error-overlay');
    const existingRetry = placeholder.querySelector('.holaf-viewer-retry-button');
    if (existingError) existingError.remove();
    if (existingRetry) existingRetry.remove();
    
    // Remove old image if one exists (for regeneration)
    const oldImg = placeholder.querySelector('img');
    if(oldImg) oldImg.remove();
    
    placeholder.dataset.thumbnailLoadingOrLoaded = "true";

    const imageUrl = new URL(window.location.origin);
    imageUrl.pathname = '/holaf/images/thumbnail';
    const params = {
        filename: image.filename,
        subfolder: image.subfolder,
        mtime: image.mtime,
        // Cache-busting parameter for forced reload
        t: forceReload ? new Date().getTime() : '' 
    };
    // No need for force_regen here, the backend call is handled by the editor.
    imageUrl.search = new URLSearchParams(params);

    const img = document.createElement('img');
    img.src = imageUrl.href;
    img.alt = image.filename;
    img.loading = "lazy";
    // --- CORRECTIF : Ajouter la classe thumbnail ---
    img.className = "holaf-image-viewer-thumbnail";

    img.onload = () => {
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

        placeholder.classList.add('error');
        placeholder.dataset.thumbnailLoadingOrLoaded = "error";

        let errorText = 'ERR: Failed to load thumbnail.';
        try {
            const response = await fetch(imageUrl.href, { cache: 'no-store' });
            if (response && !response.ok) {
                errorText = await response.text();
            }
        } catch(e) { /* Use default error text */ }

        const errorOverlay = document.createElement('div');
        errorOverlay.className = 'holaf-viewer-error-overlay';
        errorOverlay.textContent = errorText;

        const retryButton = document.createElement('button');
        retryButton.className = 'holaf-viewer-retry-button';
        retryButton.textContent = 'Retry';
        retryButton.onclick = (e) => {
            e.stopPropagation();
            placeholder.dataset.thumbnailLoadingOrLoaded = "";
            loadSpecificThumbnail(viewer, placeholder, image, true); // Retry with force regen
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
function createPlaceholder(viewer, image, index) {
    const placeholder = document.createElement('div');
    placeholder.className = 'holaf-viewer-thumbnail-placeholder';
    placeholder.dataset.index = index;
    placeholder.dataset.pathCanon = image.path_canon;

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
    const isSelected = [...selectedImages].some(selImg => selImg.path_canon === image.path_canon);
    checkbox.checked = isSelected;
    checkbox.title = "Select image";
    placeholder.appendChild(checkbox);

    placeholder.addEventListener('click', (e) => {
        if (e.target.closest('.holaf-viewer-edit-icon, .holaf-viewer-fullscreen-icon')) {
            return;
        }

        const state = imageViewerState.getState();
        const clickedIndex = parseInt(e.currentTarget.dataset.index, 10);
        if (isNaN(clickedIndex)) return;

        const clickedImageData = state.images[clickedIndex];
        if (!clickedImageData) return;

        const anchorIndex = state.currentNavIndex > -1 ? state.currentNavIndex : clickedIndex;
        const selectedPaths = new Set([...state.selectedImages].map(img => img.path_canon));

        if (e.shiftKey) {
            if (!e.ctrlKey) {
                selectedPaths.clear();
            }
            const start = Math.min(anchorIndex, clickedIndex);
            const end = Math.max(anchorIndex, clickedIndex);
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
            currentNavIndex: clickedIndex
        });
        
        document.querySelectorAll('.holaf-viewer-thumbnail-placeholder').forEach(ph => {
            const phPath = ph.dataset.pathCanon;
             const phCheckbox = ph.querySelector('.holaf-viewer-thumb-checkbox');
             if (phCheckbox) {
                 phCheckbox.checked = selectedPaths.has(phPath);
             }
        });

        viewer._updateActiveThumbnail(clickedIndex);
        viewer._updateActionButtonsState();
    });

    placeholder.addEventListener('dblclick', (e) => {
        if (e.target.closest('.holaf-viewer-edit-icon, .holaf-viewer-fullscreen-icon, .holaf-viewer-thumb-checkbox')) return;
        viewer._showZoomedView(image);
    });

    return placeholder;
}

// --- CORRECTIF : Nouvelle fonction interne pour le rafraîchissement ---
/**
 * Forces a refresh of a single thumbnail by its canonical path.
 * This is called by the global event listener.
 * @param {object} viewer The main viewer instance.
 * @param {string} path_canon The unique path of the image to refresh.
 */
function _refreshSingleThumbnail(viewer, path_canon) {
    const placeholder = document.querySelector(`.holaf-viewer-thumbnail-placeholder[data-path-canon="${path_canon}"]`);
    if (!placeholder) {
        console.warn(`[Holaf Gallery] Could not find placeholder for ${path_canon} to refresh.`);
        return;
    }
    
    const image = imageViewerState.getState().images.find(img => img.path_canon === path_canon);
    if (!image) {
        console.warn(`[Holaf Gallery] Could not find image data for ${path_canon} in state.`);
        return;
    }
    
    // Force-reload the thumbnail from the frontend with cache-busting
    loadSpecificThumbnail(viewer, placeholder, image, true);

    // Update the 'has_edit_file' status on the edit icon
    const editIcon = placeholder.querySelector('.holaf-viewer-edit-icon');
    if (editIcon) {
        // We know an edit file exists because this event was just fired.
        editIcon.classList.add('active');
    }
}


/**
 * REBUILT: Synchronizes the gallery view with the current state using differential rendering.
 * @param {object} viewer - The main image viewer instance.
 */
export function syncGallery(viewer) {
    const galleryEl = document.getElementById("holaf-viewer-gallery");
    if (!galleryEl) return;

    if (viewer.galleryObserver) viewer.galleryObserver.disconnect();
    
    const { images } = imageViewerState.getState();

    if (!images || images.length === 0) {
        galleryEl.innerHTML = ''; // Clear out any old content
        viewer.setLoadingState("No images match the current filters.");
        viewer._updateActionButtonsState();
        return;
    }
    
    const messageEl = galleryEl.querySelector('.holaf-viewer-message');
    if(messageEl) messageEl.remove();

    const newImagePaths = new Set(images.map(img => img.path_canon));
    const existingPlaceholders = new Map(
        Array.from(galleryEl.querySelectorAll('.holaf-viewer-thumbnail-placeholder'))
            .map(el => [el.dataset.pathCanon, el])
    );
    
    for (const [path, element] of existingPlaceholders.entries()) {
        if (!newImagePaths.has(path)) {
            element.classList.add('exiting');
            setTimeout(() => element.remove(), ANIMATION_DURATION_MS);
            existingPlaceholders.delete(path);
        }
    }

    const fragment = document.createDocumentFragment();
    images.forEach((image, index) => {
        let placeholder = existingPlaceholders.get(image.path_canon);
        if (placeholder) {
            placeholder.dataset.index = index;
            // CORRECTIF: Mettre à jour l'icône d'édition au cas où elle aurait changé
            const editIcon = placeholder.querySelector('.holaf-viewer-edit-icon');
            if(editIcon) editIcon.classList.toggle('active', image.has_edit_file);
        } else {
            placeholder = createPlaceholder(viewer, image, index);
            placeholder.classList.add('entering');
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    placeholder.classList.remove('entering');
                });
            });
        }
        fragment.appendChild(placeholder);
    });

    galleryEl.innerHTML = '';
    galleryEl.appendChild(fragment);

    const placeholdersToObserve = galleryEl.querySelectorAll('.holaf-viewer-thumbnail-placeholder');
    viewer.galleryObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const placeholder = entry.target;
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
        });
    }, { root: galleryEl, rootMargin: "400px 0px" });

    placeholdersToObserve.forEach(ph => viewer.galleryObserver.observe(ph));
    
    viewer._updateActionButtonsState();
}