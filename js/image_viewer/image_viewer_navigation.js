/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Navigation Module
 *
 * This module handles all user navigation, including keyboard controls,
 * zoomed view, fullscreen view, and pan/zoom interactions.
 * MODIFICATION: Corrected state synchronization after deleting from zoomed/fullscreen views.
 */

import { handleDeletion } from './image_viewer_actions.js';

/**
 * Resets the transformation (zoom/pan) state of a view.
 * @param {object} state - The view state object (e.g., zoomViewState).
 * @param {HTMLImageElement} imageEl - The image element to reset.
 */
function resetTransform(state, imageEl) {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    imageEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    imageEl.style.cursor = 'grab';
}

/**
 * Preloads the next image in the list for faster navigation.
 * @param {object} viewer - The main image viewer instance.
 * @param {number} currentIndex - The index of the currently active image.
 */
function preloadNextImage(viewer, currentIndex) {
    if (currentIndex < 0 || (currentIndex + 1) >= viewer.filteredImages.length) return;
    const next = viewer.filteredImages[currentIndex + 1];
    if (next) {
        const p = new Image();
        p.src = getFullImageUrl(next);
    }
}

/**
 * Constructs the full URL for viewing an image.
 * @param {object} image - The image data object.
 * @returns {string} The full URL.
 */
export function getFullImageUrl(image) {
    if (!image) return "";
    const url = new URL(window.location.origin);
    url.pathname = '/view';
    url.search = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: 'output'
    });
    return url.href;
}

/**
 * Shows the zoomed-in image view within the panel.
 * @param {object} viewer - The main image viewer instance.
 * @param {object} image - The image to display.
 */
export function showZoomedView(viewer, image) {
    const idx = viewer.filteredImages.findIndex(i => i.path_canon === image.path_canon);
    if (idx === -1) return;

    viewer.activeImage = viewer.filteredImages[idx];
    viewer.currentNavIndex = idx;

    const v = document.getElementById('holaf-viewer-zoom-view');
    const i = v.querySelector('img');
    const u = getFullImageUrl(viewer.activeImage);

    const l = new Image();
    l.onload = () => {
        resetTransform(viewer.zoomViewState, i);
        i.src = u;
        v.style.display = 'flex';
        document.getElementById('holaf-viewer-gallery').style.display = 'none';
    };
    l.onerror = () => console.error(`Failed to load: ${u}`);
    l.src = u;

    viewer.updateInfoPane(viewer.activeImage);
    viewer._updateActiveThumbnail(idx);
    preloadNextImage(viewer, idx);
}

/**
 * Hides the zoomed-in image view and shows the gallery.
 */
export function hideZoomedView() {
    document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
    document.getElementById('holaf-viewer-gallery').style.display = 'flex';
}

/**
 * Shows the fullscreen image overlay.
 * @param {object} viewer - The main image viewer instance.
 * @param {object} image - The image to display.
 */
export function showFullscreenView(viewer, image) {
    if (!image) return;
    const idx = viewer.filteredImages.findIndex(i => i.path_canon === image.path_canon);
    if (idx === -1) return;

    viewer.activeImage = viewer.filteredImages[idx];
    viewer.currentNavIndex = idx;
    viewer._fullscreenSourceView = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex' ? 'zoomed' : 'gallery';

    if (viewer._fullscreenSourceView === 'zoomed') hideZoomedView();

    const { img: fImg, overlay: fOv } = viewer.fullscreenElements;
    const u = getFullImageUrl(viewer.activeImage);
    const l = new Image();
    l.onload = () => {
        resetTransform(viewer.fullscreenViewState, fImg);
        fImg.src = u;
        fOv.style.display = 'flex';
    };
    l.onerror = () => console.error(`Failed to load: ${u}`);
    l.src = u;

    viewer.updateInfoPane(viewer.activeImage);
    viewer._updateActiveThumbnail(idx);
    preloadNextImage(viewer, idx);
}

/**
 * Hides the fullscreen overlay.
 * @param {object} viewer - The main image viewer instance.
 * @returns {string|null} The view ('zoomed' or 'gallery') that was active before fullscreen.
 */
export function hideFullscreenView(viewer) {
    viewer.fullscreenElements.overlay.style.display = 'none';
    const s = viewer._fullscreenSourceView;
    viewer._fullscreenSourceView = null;
    return s;
}

/**
 * Navigates to the next or previous image.
 * @param {object} viewer - The main image viewer instance.
 * @param {number} direction - 1 for next, -1 for previous.
 */
export function navigate(viewer, direction) {
    if (viewer.filteredImages.length === 0) return;
    let newIndex = (viewer.currentNavIndex === -1) ? 0 : viewer.currentNavIndex + direction;
    const clampedIndex = Math.max(0, Math.min(newIndex, viewer.filteredImages.length - 1));

    if (clampedIndex === viewer.currentNavIndex && viewer.currentNavIndex !== -1) return;

    viewer.currentNavIndex = clampedIndex;
    viewer.activeImage = viewer.filteredImages[clampedIndex];

    viewer._updateActiveThumbnail(clampedIndex);
    viewer.updateInfoPane(viewer.activeImage);
    preloadNextImage(viewer, clampedIndex);

    const newImageUrl = getFullImageUrl(viewer.activeImage);
    const loader = new Image();
    loader.onload = () => {
        const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
        const isFullscreen = viewer.fullscreenElements.overlay.style.display === 'flex';
        if (isZoomed) {
            const zImg = document.querySelector('#holaf-viewer-zoom-view img');
            resetTransform(viewer.zoomViewState, zImg);
            zImg.src = newImageUrl;
        } else if (isFullscreen) {
            const fImg = viewer.fullscreenElements.img;
            resetTransform(viewer.fullscreenViewState, fImg);
            fImg.src = newImageUrl;
        }
    };
    loader.onerror = () => console.error(`Preload failed: ${newImageUrl}`);
    loader.src = newImageUrl;
}

/**
 * Navigates up or down in the thumbnail grid.
 * @param {object} viewer - The main image viewer instance.
 * @param {number} direction - 1 for down, -1 for up.
 */
export function navigateGrid(viewer, direction) {
    if (viewer.filteredImages.length === 0) return;
    const g = document.getElementById('holaf-viewer-gallery');
    const f = g?.querySelector('.holaf-viewer-thumbnail-placeholder');
    if (!g || !f) return;

    const s = window.getComputedStyle(f);
    const w = f.offsetWidth + parseFloat(s.marginLeft) + parseFloat(s.marginRight);
    const n = Math.max(1, Math.floor(g.clientWidth / w));

    let newIndex = (viewer.currentNavIndex === -1) ? 0 : viewer.currentNavIndex + (direction * n);
    const clampedIndex = Math.max(0, Math.min(newIndex, viewer.filteredImages.length - 1));
    if (clampedIndex === viewer.currentNavIndex && viewer.currentNavIndex !== -1) return;

    viewer.currentNavIndex = clampedIndex;
    viewer.activeImage = viewer.filteredImages[clampedIndex];
    viewer._updateActiveThumbnail(clampedIndex);
    viewer.updateInfoPane(viewer.activeImage);
}

/**
 * Handles the Escape key press to close views.
 * @param {object} viewer - The main image viewer instance.
 */
export function handleEscape(viewer) {
    if (viewer.fullscreenElements?.overlay.style.display === 'flex') {
        const sourceView = hideFullscreenView(viewer);
        if (sourceView === 'zoomed' && viewer.activeImage) showZoomedView(viewer, viewer.activeImage);
    } else if (document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex') {
        hideZoomedView();
    }
}

/**
 * Main keydown event handler for the viewer.
 * @param {object} viewer - The main image viewer instance.
 * @param {KeyboardEvent} e - The keyboard event.
 */
export async function handleKeyDown(viewer, e) {
    if (!viewer.panelElements?.panelEl || viewer.panelElements.panelEl.style.display === 'none') return;
    
    const isInputFocused = ['input', 'textarea', 'select'].includes(e.target.tagName.toLowerCase());
    if (isInputFocused && e.key !== 'Escape' && e.key !== 'Delete') return;

    const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
    const isFullscreen = viewer.fullscreenElements?.overlay.style.display === 'flex';
    const galleryEl = document.getElementById('holaf-viewer-gallery');

    switch (e.key) {
        case 'Delete': {
            e.preventDefault();
            const isPermanent = e.shiftKey;
            
            // --- MODIFIED: Reworked logic for zoomed/fullscreen deletion ---
            if ((isZoomed || isFullscreen) && viewer.activeImage) {
                const originalIndex = viewer.currentNavIndex;
                
                const success = await handleDeletion(viewer, isPermanent, [viewer.activeImage]);
                
                if (success) {
                    // We must fully reload the image list from the server to get the new state
                    await viewer.loadFilteredImages();

                    if (viewer.filteredImages.length === 0) {
                        // If the list is empty, close the views and return to the gallery
                        if (isFullscreen) hideFullscreenView(viewer);
                        if (isZoomed) hideZoomedView();
                        viewer.activeImage = null;
                        viewer.currentNavIndex = -1;
                        viewer.updateInfoPane(null);
                    } else {
                        // Calculate the new index. It should be the one before the deleted image.
                        // Clamp the index to stay within the bounds of the new, shorter list.
                        const newIndex = Math.min(originalIndex, viewer.filteredImages.length - 1);

                        // Set currentNavIndex to one *after* our target, so navigate(-1) lands on it.
                        // This reuses the navigation logic to update the UI correctly.
                        viewer.currentNavIndex = newIndex + 1;
                        navigate(viewer, -1);
                    }
                }
            } else if (viewer.selectedImages.size > 0) {
                // This logic is for deleting from the gallery view
                const success = await handleDeletion(viewer, isPermanent, null);
                if (success) {
                    viewer.selectedImages.clear();
                    viewer.activeImage = null;
                    viewer.currentNavIndex = -1;
                    await viewer.loadFilteredImages(); // Reload the gallery
                }
            }
            break;
        }
        case 'PageUp':
        case 'PageDown':
            if (!isZoomed && !isFullscreen && galleryEl) {
                e.preventDefault();
                galleryEl.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * galleryEl.clientHeight * 0.9, behavior: 'smooth' });
            }
            break;
        case 'Home':
        case 'End':
            if (!isZoomed && !isFullscreen && viewer.filteredImages.length > 0) {
                e.preventDefault();
                if (e.key === 'Home') {
                    navigate(viewer, 0 - viewer.currentNavIndex);
                } else {
                    if (viewer.backgroundRenderHandle) clearTimeout(viewer.backgroundRenderHandle);
                    while (viewer.renderedCount < viewer.filteredImages.length) viewer.renderImageBatch(true);
                    navigate(viewer, viewer.filteredImages.length - 1 - viewer.currentNavIndex);
                }
            }
            break;
        case 'Enter':
            e.preventDefault();
            if (viewer.currentNavIndex === -1 && viewer.filteredImages.length > 0) viewer.currentNavIndex = 0;
            if (viewer.currentNavIndex === -1 || !viewer.filteredImages[viewer.currentNavIndex]) return;

            const imgToView = viewer.filteredImages[viewer.currentNavIndex];
            if (e.shiftKey) {
                if (!isFullscreen) showFullscreenView(viewer, imgToView);
            } else {
                if (isZoomed) showFullscreenView(viewer, imgToView);
                else if (!isFullscreen) showFullscreenView(viewer, imgToView);
            }
            break;
        case 'ArrowRight':
        case 'ArrowLeft':
            e.preventDefault();
            navigate(viewer, e.key === 'ArrowRight' ? 1 : -1);
            break;
        case 'ArrowUp':
        case 'ArrowDown':
            if (!isZoomed && !isFullscreen) {
                e.preventDefault();
                navigateGrid(viewer, e.key === 'ArrowDown' ? 1 : -1);
            }
            break;
        case 'Escape':
            e.preventDefault();
            handleEscape(viewer);
            break;
    }
}

/**
 * Sets up pan and zoom functionality on a view container.
 * @param {object} state - The view state object (e.g., zoomViewState).
 * @param {HTMLElement} container - The container element for the view.
 * @param {HTMLImageElement} imageEl - The image element to transform.
 */
export function setupZoomAndPan(state, container, imageEl) {
    const updateTransform = () => { imageEl.style.transform = `translate(${state.tx}px,${state.ty}px) scale(${state.scale})`; };
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const oldScale = state.scale;
        const newScale = e.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
        state.scale = Math.max(1, Math.min(newScale, 30));
        if (state.scale === oldScale) return;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        state.tx = mouseX - (mouseX - state.tx) * (state.scale / oldScale);
        state.ty = mouseY - (mouseY - state.ty) * (state.scale / oldScale);

        if (state.scale <= 1) resetTransform(state, imageEl);
        else imageEl.style.cursor = 'grab';
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
            imageEl.style.transition = 'transform .2s ease-out';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}