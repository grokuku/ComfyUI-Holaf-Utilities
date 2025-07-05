/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Navigation Module
 *
 * This module handles all user navigation, including keyboard controls,
 * zoomed view, fullscreen view, and pan/zoom interactions.
 * REFACTOR: Updated to use the central imageViewerState.
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
    const state = imageViewerState.getState();
    const idx = state.images.findIndex(i => i.path_canon === image.path_canon);
    if (idx === -1) return;

    const activeImage = state.images[idx];
    imageViewerState.setState({ activeImage: activeImage, currentNavIndex: idx });

    const v = document.getElementById('holaf-viewer-zoom-view');
    const i = v.querySelector('img');
    const u = getFullImageUrl(activeImage);

    const l = new Image();
    l.onload = () => {
        resetTransform(viewer.zoomViewState, i);
        i.src = u;
        v.style.display = 'flex';
        document.getElementById('holaf-viewer-gallery').style.display = 'none';
    };
    l.onerror = () => console.error(`Failed to load: ${u}`);
    l.src = u;

    viewer.updateInfoPane(activeImage);
    viewer._updateActiveThumbnail(idx);
    preloadNextImage(viewer);
}

export function hideZoomedView() {
    document.getElementById('holaf-viewer-zoom-view').style.display = 'none';
    document.getElementById('holaf-viewer-gallery').style.display = 'flex';
}

export function showFullscreenView(viewer, image) {
    if (!image) return;
    const state = imageViewerState.getState();
    const idx = state.images.findIndex(i => i.path_canon === image.path_canon);
    if (idx === -1) return;

    const activeImage = state.images[idx];
    imageViewerState.setState({ activeImage: activeImage, currentNavIndex: idx });
    viewer._fullscreenSourceView = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex' ? 'zoomed' : 'gallery';

    if (viewer._fullscreenSourceView === 'zoomed') hideZoomedView();

    const { img: fImg, overlay: fOv } = viewer.fullscreenElements;
    const u = getFullImageUrl(activeImage);
    const l = new Image();
    l.onload = () => {
        resetTransform(viewer.fullscreenViewState, fImg);
        fImg.src = u;
        fOv.style.display = 'flex';
    };
    l.onerror = () => console.error(`Failed to load: ${u}`);
    l.src = u;

    viewer.updateInfoPane(activeImage);
    viewer._updateActiveThumbnail(idx);
    preloadNextImage(viewer);
}

export function hideFullscreenView(viewer) {
    viewer.fullscreenElements.overlay.style.display = 'none';
    const s = viewer._fullscreenSourceView;
    viewer._fullscreenSourceView = null;
    return s;
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
    viewer.updateInfoPane(newActiveImage);
    preloadNextImage(viewer);

    const newImageUrl = getFullImageUrl(newActiveImage);
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
    viewer.updateInfoPane(newActiveImage);
}

export function handleEscape(viewer) {
    const state = imageViewerState.getState();
    if (viewer.fullscreenElements?.overlay.style.display === 'flex') {
        const sourceView = hideFullscreenView(viewer);
        if (sourceView === 'zoomed' && state.activeImage) showZoomedView(viewer, state.activeImage);
    } else if (document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex') {
        hideZoomedView();
    }
}

export async function handleKeyDown(viewer, e) {
    if (!viewer.panelElements?.panelEl || viewer.panelElements.panelEl.style.display === 'none') return;
    
    const isInputFocused = ['input', 'textarea', 'select'].includes(e.target.tagName.toLowerCase());
    if (isInputFocused && e.key !== 'Escape' && e.key !== 'Delete') return;

    const isZoomed = document.getElementById('holaf-viewer-zoom-view')?.style.display === 'flex';
    const isFullscreen = viewer.fullscreenElements?.overlay.style.display === 'flex';
    const galleryEl = document.getElementById('holaf-viewer-gallery');
    
    let state = imageViewerState.getState();

    switch (e.key) {
        case 'Delete': {
            e.preventDefault();
            const isPermanent = e.shiftKey;
            
            if ((isZoomed || isFullscreen) && state.activeImage) {
                const originalIndex = state.currentNavIndex;
                
                const success = await handleDeletion(viewer, isPermanent, [state.activeImage]);
                
                if (success) {
                    await viewer.loadFilteredImages();
                    
                    // After reloading, the state is new
                    const newState = imageViewerState.getState();

                    if (newState.images.length === 0) {
                        if (isFullscreen) hideFullscreenView(viewer);
                        if (isZoomed) hideZoomedView();
                        imageViewerState.setState({ activeImage: null, currentNavIndex: -1 });
                        viewer.updateInfoPane(null);
                    } else {
                        const newIndex = Math.min(originalIndex, newState.images.length - 1);
                        imageViewerState.setState({ currentNavIndex: newIndex + 1 });
                        navigate(viewer, -1);
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
            if (!isZoomed && !isFullscreen && galleryEl) {
                e.preventDefault();
                galleryEl.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * galleryEl.clientHeight * 0.9, behavior: 'smooth' });
            }
            break;
        case 'Home':
        case 'End':
            if (!isZoomed && !isFullscreen && state.images.length > 0) {
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
                imageViewerState.setState({ currentNavIndex: 0 });
                state = imageViewerState.getState();
            }
            if (state.currentNavIndex === -1 || !state.images[state.currentNavIndex]) return;

            const imgToView = state.images[state.currentNavIndex];
            if (!isFullscreen) showFullscreenView(viewer, imgToView);

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