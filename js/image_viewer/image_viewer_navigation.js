/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Navigation Module
 *
 * This module handles all user navigation, including keyboard controls,
 * zoomed view, fullscreen view, and pan/zoom interactions.
 * REFACTOR: Updated to use and manage ui.view_mode in the central state.
 */

import { imageViewerState } from './image_viewer_state.js';
import { handleDeletion } from './image_viewer_actions.js';

function resetTransform(state, imageEl) {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    imageEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    imageEl.style.cursor = 'grab';
}

function preloadNextImage(viewer) {
    const state = imageViewerState.getState();
    if (state.currentNavIndex < 0 || (state.currentNavIndex + 1) >= state.images.length) return;
    
    const nextImage = state.images[state.currentNavIndex + 1];
    if (nextImage) {
        const preloader = new Image();
        preloader.src = getFullImageUrl(nextImage);
    }
}

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

export function showZoomedView(viewer, image) {
    // REFACTOR: This function now just sets the view mode. The active image should already be set.
    imageViewerState.setState({ ui: { view_mode: 'zoom' } });

    const v = document.getElementById('holaf-viewer-zoom-view');
    const i = v.querySelector('img');
    const u = getFullImageUrl(image);

    const l = new Image();
    l.onload = () => {
        resetTransform(viewer.zoomViewState, i);
        i.src = u;
        v.style.display = 'flex';
        document.getElementById('holaf-viewer-gallery').style.display = 'none';
    };
    l.onerror = () => console.error(`Failed to load: ${u}`);
    l.src = u;

    viewer._updateActiveThumbnail(imageViewerState.getState().currentNavIndex);
    preloadNextImage(viewer);
}

export function hideZoomedView() {
    // REFACTOR: This function's primary role is to set the state back to 'gallery'.
    imageViewerState.setState({ ui: { view_mode: 'gallery' } });
    document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
    document.getElementById('holaf-viewer-gallery').style.display = 'flex';
}

export function showFullscreenView(viewer, image) {
    if (!image) return;
    
    // REFACTOR: Determine source view *before* changing state.
    viewer._fullscreenSourceView = imageViewerState.getState().ui.view_mode;
    
    // REFACTOR: Atomically set the new state.
    imageViewerState.setState({ ui: { view_mode: 'fullscreen' } });

    // FIX: Manually hide the zoomed view's DOM element without calling hideZoomedView,
    // which would incorrectly change the state to 'gallery'.
    if (viewer._fullscreenSourceView === 'zoom') {
        document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
    }

    const { img: fImg, overlay: fOv } = viewer.fullscreenElements;
    const u = getFullImageUrl(image);
    const l = new Image();
    l.onload = () => {
        resetTransform(viewer.fullscreenViewState, fImg);
        fImg.src = u;
        fOv.style.display = 'flex';
    };
    l.onerror = () => console.error(`Failed to load: ${u}`);
    l.src = u;

    viewer._updateActiveThumbnail(imageViewerState.getState().currentNavIndex);
    preloadNextImage(viewer);
}

export function hideFullscreenView(viewer) {
    viewer.fullscreenElements.overlay.style.display = 'none';
    // REFACTOR: This function should only manage the DOM. The caller manages state.
    return viewer._fullscreenSourceView;
}

export function navigate(viewer, direction) {
    const state = imageViewerState.getState();
    if (state.images.length === 0) return;
    
    let newIndex = (state.currentNavIndex === -1) ? 0 : state.currentNavIndex + direction;
    const clampedIndex = Math.max(0, Math.min(newIndex, state.images.length - 1));

    if (clampedIndex === state.currentNavIndex && state.currentNavIndex !== -1) return;

    const newActiveImage = state.images[clampedIndex];
    imageViewerState.setState({ currentNavIndex: clampedIndex, activeImage: newActiveImage });

    viewer._updateActiveThumbnail(clampedIndex);
    preloadNextImage(viewer);

    const newImageUrl = getFullImageUrl(newActiveImage);
    const loader = new Image();
    loader.onload = () => {
        // This logic correctly updates the image within the current view mode. No changes needed.
        const currentViewMode = imageViewerState.getState().ui.view_mode;
        if (currentViewMode === 'zoom') {
            const zImg = document.querySelector('#holaf-viewer-zoom-view img');
            resetTransform(viewer.zoomViewState, zImg);
            zImg.src = newImageUrl;
        } else if (currentViewMode === 'fullscreen') {
            const fImg = viewer.fullscreenElements.img;
            resetTransform(viewer.fullscreenViewState, fImg);
            fImg.src = newImageUrl;
        }
    };
    loader.onerror = () => console.error(`Preload failed: ${newImageUrl}`);
    loader.src = newImageUrl;
}

export function navigateGrid(viewer, direction) {
    const state = imageViewerState.getState();
    if (state.images.length === 0) return;
    
    const g = document.getElementById('holaf-viewer-gallery');
    const f = g?.querySelector('.holaf-viewer-thumbnail-placeholder');
    if (!g || !f) return;

    const s = window.getComputedStyle(f);
    const w = f.offsetWidth + parseFloat(s.marginLeft) + parseFloat(s.marginRight);
    const n = Math.max(1, Math.floor(g.clientWidth / w));

    let newIndex = (state.currentNavIndex === -1) ? 0 : state.currentNavIndex + (direction * n);
    const clampedIndex = Math.max(0, Math.min(newIndex, state.images.length - 1));
    if (clampedIndex === state.currentNavIndex && state.currentNavIndex !== -1) return;

    const newActiveImage = state.images[clampedIndex];
    imageViewerState.setState({ currentNavIndex: clampedIndex, activeImage: newActiveImage });

    viewer._updateActiveThumbnail(clampedIndex);
}

export function handleEscape(viewer) {
    // REFACTOR: This is now the primary state manager for "going back".
    const state = imageViewerState.getState();
    const currentMode = state.ui.view_mode;

    if (currentMode === 'fullscreen') {
        const sourceView = hideFullscreenView(viewer); // Hides DOM, returns 'zoom' or 'gallery'
        const targetMode = sourceView === 'zoom' ? 'zoom' : 'gallery';
        imageViewerState.setState({ ui: { view_mode: targetMode } });
        
        // Manually restore the zoom view's visibility if needed.
        if (targetMode === 'zoom') {
            document.getElementById('holaf-viewer-zoom-view').style.display = 'flex';
        }
    } else if (currentMode === 'zoom') {
        hideZoomedView(); // Hides DOM and sets state to 'gallery'
    }
}

export async function handleKeyDown(viewer, e) {
    if (!viewer.panelElements?.panelEl || viewer.panelElements.panelEl.style.display === 'none') return;
    
    const isInputFocused = ['input', 'textarea', 'select'].includes(e.target.tagName.toLowerCase());
    if (isInputFocused && e.key !== 'Escape' && e.key !== 'Delete') return;
    
    const state = imageViewerState.getState();
    const currentMode = state.ui.view_mode;
    const galleryEl = document.getElementById('holaf-viewer-gallery');

    switch (e.key) {
        case 'Delete': {
            e.preventDefault();
            const isPermanent = e.shiftKey;
            
            if (currentMode !== 'gallery' && state.activeImage) {
                const originalIndex = state.currentNavIndex;
                const success = await handleDeletion(viewer, isPermanent, [state.activeImage]);
                
                if (success) {
                    await viewer.loadFilteredImages();
                    const newState = imageViewerState.getState();

                    if (newState.images.length === 0) {
                        // FIX: Explicitly clear active image and set mode to gallery
                        if (currentMode === 'fullscreen') hideFullscreenView(viewer);
                        document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
                        document.getElementById('holaf-viewer-gallery').style.display = 'flex';
                        imageViewerState.setState({ activeImage: null, currentNavIndex: -1, ui: { view_mode: 'gallery' } });
                    } else {
                        const newIndex = Math.min(originalIndex, newState.images.length - 1);
                        imageViewerState.setState({ currentNavIndex: newIndex + 1 }); // Set to item after deleted one
                        navigate(viewer, -1); // Navigate back to the item at the new index
                    }
                }
            } else if (state.selectedImages.length > 0) {
                const success = await handleDeletion(viewer, isPermanent, null);
                if (success) {
                    imageViewerState.setState({ selectedImages: new Set(), activeImage: null, currentNavIndex: -1 });
                    await viewer.loadFilteredImages();
                }
            }
            break;
        }
        case 'PageUp':
        case 'PageDown':
            if (currentMode === 'gallery' && galleryEl) {
                e.preventDefault();
                galleryEl.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * galleryEl.clientHeight * 0.9, behavior: 'smooth' });
            }
            break;
        case 'Home':
        case 'End':
            if (currentMode === 'gallery' && state.images.length > 0) {
                e.preventDefault();
                let targetIndex;
                if (e.key === 'Home') {
                    targetIndex = 0;
                } else {
                    if (viewer.backgroundRenderHandle) clearTimeout(viewer.backgroundRenderHandle);
                    while (viewer.renderedCount < state.images.length) viewer.renderImageBatch(true);
                    targetIndex = state.images.length - 1;
                }
                const direction = targetIndex - state.currentNavIndex;
                navigate(viewer, direction);
            }
            break;
        case 'Enter':
            e.preventDefault();
            if (state.currentNavIndex === -1 && state.images.length > 0) {
                // Select the first image if none is active
                imageViewerState.setState({ activeImage: state.images[0], currentNavIndex: 0 });
            }
            
            const currentState = imageViewerState.getState();
            if (currentState.currentNavIndex !== -1 && currentState.activeImage) {
                showFullscreenView(viewer, currentState.activeImage);
            }
            break;
        case 'ArrowRight':
        case 'ArrowLeft':
            e.preventDefault();
            navigate(viewer, e.key === 'ArrowRight' ? 1 : -1);
            break;
        case 'ArrowUp':
        case 'ArrowDown':
            if (currentMode === 'gallery') {
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