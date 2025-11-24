/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Navigation Module
 *
 * This module handles all user navigation, including keyboard controls,
 * zoomed view, fullscreen view, and pan/zoom interactions.
 * FIX: Removed DOM cloning which caused "parentNode is null" errors.
 * FIX: Added safety checks for missing video elements.
 */

import { imageViewerState } from './image_viewer_state.js';
import { handleDeletion } from './image_viewer_actions.js';
import { HolafPanelManager, dialogState } from '../holaf_panel_manager.js';

function _applyEditorPreview(viewer, mediaEl) {
    if (!viewer.editor || !mediaEl) return;

    // Safety check for invalid sources
    if (mediaEl.tagName === 'IMG' && (!mediaEl.src || mediaEl.src.endsWith('undefined'))) {
        mediaEl.style.filter = 'none';
        return;
    }

    const { currentState } = viewer.editor;
    if (!currentState) {
        mediaEl.style.filter = 'none';
        if (mediaEl.tagName === 'VIDEO') mediaEl.playbackRate = 1.0;
        return;
    }

    const filterValue = `brightness(${currentState.brightness}) contrast(${currentState.contrast}) saturate(${currentState.saturation})`;
    mediaEl.style.filter = filterValue;

    if (mediaEl.tagName === 'VIDEO') {
        mediaEl.playbackRate = currentState.playbackRate;
    }
}

async function _handleUnsavedChanges(viewer) {
    if (!viewer.editor || !viewer.editor.hasUnsavedChanges()) {
        return 'proceed';
    }

    const choice = await HolafPanelManager.createDialog({
        title: "Unsaved Changes",
        message: "You have unsaved edits. What would you like to do?",
        buttons: [
            { text: "Cancel Navigation", value: 'cancel', type: 'cancel' },
            { text: "Discard Changes", value: 'discard', type: 'danger' },
            { text: "Save & Continue", value: 'save', type: 'primary' }
        ]
    });

    switch (choice) {
        case 'save':
            await viewer.editor._saveEdits();
            return 'proceed';
        case 'discard':
            viewer.editor._cancelEdits();
            return 'proceed';
        case 'cancel':
        default:
            return 'cancel';
    }
}


function resetTransform(state, element) {
    if (!element) return;
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    element.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    element.style.cursor = 'grab';
    element.style.transformOrigin = '0 0'; // Ensure origin is consistent
}

function preloadNextImage(viewer) {
    const state = imageViewerState.getState();
    if (state.currentNavIndex < 0 || (state.currentNavIndex + 1) >= state.images.length) return;

    const nextImage = state.images[state.currentNavIndex + 1];
    if (nextImage && !['MP4', 'WEBM'].includes(nextImage.format)) {
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

/**
 * Updates the container to show either the Image or Video element based on the file type.
 */
function _updateMediaSource(viewer, image, container, imgEl, videoEl, transformState) {
    const isVideo = ['MP4', 'WEBM'].includes(image.format);
    const url = getFullImageUrl(image);

    // Safety check: ensure videoEl exists (it might be missing if UI didn't initialize correctly)
    const hasVideoEl = !!videoEl;

    if (isVideo && hasVideoEl) {
        if (imgEl) {
            imgEl.style.display = 'none';
            imgEl.src = '';
        }

        videoEl.style.display = 'block';
        videoEl.src = url;
        resetTransform(transformState, videoEl);

        // Re-attach pan/zoom logic to the video element
        setupZoomAndPan(transformState, container, videoEl);
        _applyEditorPreview(viewer, videoEl);

        // Attempt autoplay
        videoEl.play().catch(e => {
            // console.warn("Autoplay blocked or interrupted:", e);
        });

    } else {
        if (hasVideoEl) {
            videoEl.pause();
            videoEl.style.display = 'none';
            videoEl.src = '';
        }

        if (imgEl) {
            imgEl.style.display = 'block';

            // Pre-load image
            const loader = new Image();
            loader.onload = () => {
                resetTransform(transformState, imgEl);
                imgEl.src = url;
                setupZoomAndPan(transformState, container, imgEl);
                _applyEditorPreview(viewer, imgEl);
            };
            loader.src = url;
        }
    }
}

export function stopPlayback(viewer) {
    if (viewer.elements?.zoomVideo) viewer.elements.zoomVideo.pause();
    if (viewer.fullscreenElements?.video) viewer.fullscreenElements.video.pause();
}

export function showZoomedView(viewer, image) {
    imageViewerState.setState({ ui: { view_mode: 'zoom' } });

    const view = document.getElementById('holaf-viewer-zoom-view');
    const imgEl = view.querySelector('img');
    const videoEl = viewer.elements ? viewer.elements.zoomVideo : null;

    view.style.display = 'flex';
    const galleryEl = document.getElementById('holaf-viewer-gallery');
    if (galleryEl) galleryEl.style.display = 'none';

    _updateMediaSource(viewer, image, view, imgEl, videoEl, viewer.zoomViewState);

    preloadNextImage(viewer);
}

export async function hideZoomedView(viewer) {
    const action = await _handleUnsavedChanges(viewer);
    if (action === 'cancel') return;

    // Pause video
    if (viewer.elements && viewer.elements.zoomVideo) viewer.elements.zoomVideo.pause();

    imageViewerState.setState({ ui: { view_mode: 'gallery' } });

    const zoomView = document.getElementById('holaf-viewer-zoom-view');
    if (zoomView) zoomView.style.display = 'none';

    const galleryEl = document.getElementById('holaf-viewer-gallery');
    if (galleryEl) galleryEl.style.display = 'flex';

    // Restore scroll position alignment
    const { currentNavIndex } = imageViewerState.getState();
    if (currentNavIndex !== -1 && viewer.gallery?.alignImageOnExit) {
        viewer.gallery.alignImageOnExit(currentNavIndex);
    }
}

export function showFullscreenView(viewer, image) {
    if (!image) return;

    viewer._fullscreenSourceView = imageViewerState.getState().ui.view_mode;
    imageViewerState.setState({ ui: { view_mode: 'fullscreen' } });

    if (viewer._fullscreenSourceView === 'zoom') {
        const zoomView = document.getElementById('holaf-viewer-zoom-view');
        if (zoomView) zoomView.style.display = 'none';
        // Pause zoom video while in fullscreen
        if (viewer.elements && viewer.elements.zoomVideo) viewer.elements.zoomVideo.pause();
    }

    const { overlay, img: imgEl, video: videoEl } = viewer.fullscreenElements;
    overlay.style.display = 'flex';

    _updateMediaSource(viewer, image, overlay, imgEl, videoEl, viewer.fullscreenViewState);

    preloadNextImage(viewer);
}

export function hideFullscreenView(viewer) {
    if (viewer.fullscreenElements && viewer.fullscreenElements.overlay) {
        viewer.fullscreenElements.overlay.style.display = 'none';
    }

    // Pause fullscreen video
    if (viewer.fullscreenElements && viewer.fullscreenElements.video) {
        viewer.fullscreenElements.video.pause();
    }

    return viewer._fullscreenSourceView;
}

export async function navigate(viewer, direction) {
    const action = await _handleUnsavedChanges(viewer);
    if (action === 'cancel') return;

    const state = imageViewerState.getState();
    if (state.images.length === 0) return;

    let newIndex = (state.currentNavIndex === -1) ? 0 : state.currentNavIndex + direction;

    if (newIndex < 0) {
        newIndex = state.images.length - 1;
    } else if (newIndex >= state.images.length) {
        newIndex = 0;
    }

    const newActiveImage = state.images[newIndex];
    imageViewerState.setState({ currentNavIndex: newIndex, activeImage: newActiveImage });

    if (viewer.gallery?.render) viewer.gallery.render();

    preloadNextImage(viewer);

    const currentViewMode = imageViewerState.getState().ui.view_mode;

    if (currentViewMode === 'gallery') {
        if (viewer.gallery?.ensureImageVisible) {
            viewer.gallery.ensureImageVisible(newIndex);
        }
    } else if (currentViewMode === 'zoom') {
        const view = document.getElementById('holaf-viewer-zoom-view');
        const imgEl = view.querySelector('img');
        const videoEl = viewer.elements ? viewer.elements.zoomVideo : null;
        _updateMediaSource(viewer, newActiveImage, view, imgEl, videoEl, viewer.zoomViewState);
    } else if (currentViewMode === 'fullscreen') {
        const { overlay, img, video } = viewer.fullscreenElements;
        _updateMediaSource(viewer, newActiveImage, overlay, img, video, viewer.fullscreenViewState);
    }
}

export function navigateGrid(viewer, direction) {
    const state = imageViewerState.getState();
    if (state.images.length === 0 || !viewer.gallery) return;

    const columnCount = viewer.gallery.getColumnCount();
    if (columnCount <= 0) return;

    const currentIndex = state.currentNavIndex;
    if (currentIndex === -1) {
        const newActiveImage = state.images[0];
        imageViewerState.setState({ currentNavIndex: 0, activeImage: newActiveImage });
        if (viewer.gallery?.render) viewer.gallery.render();
        if (viewer.gallery?.ensureImageVisible) {
            viewer.gallery.ensureImageVisible(0);
        }
        return;
    }

    const newIndex = currentIndex + (direction * columnCount);

    if (newIndex < 0 || newIndex >= state.images.length) {
        return;
    }

    const newActiveImage = state.images[newIndex];
    imageViewerState.setState({ currentNavIndex: newIndex, activeImage: newActiveImage });

    if (viewer.gallery?.render) viewer.gallery.render();

    if (viewer.gallery?.ensureImageVisible) {
        viewer.gallery.ensureImageVisible(newIndex);
    }
}

export async function handleEscape(viewer) {
    const state = imageViewerState.getState();
    const currentMode = state.ui.view_mode;

    if (currentMode === 'fullscreen') {
        const sourceView = hideFullscreenView(viewer);
        const targetMode = sourceView === 'zoom' ? 'zoom' : 'gallery';
        imageViewerState.setState({ ui: { view_mode: targetMode } });

        if (targetMode === 'zoom') {
            document.getElementById('holaf-viewer-zoom-view').style.display = 'flex';
            const imgEl = document.querySelector('#holaf-viewer-zoom-view img');
            const videoEl = viewer.elements ? viewer.elements.zoomVideo : null;

            // Re-apply preview to the correct element (whichever is visible)
            if (videoEl && videoEl.style.display !== 'none') {
                _applyEditorPreview(viewer, videoEl);
                videoEl.play().catch(() => { });
            } else if (imgEl) {
                _applyEditorPreview(viewer, imgEl);
            }

        } else {
            const { currentNavIndex } = imageViewerState.getState();
            if (currentNavIndex !== -1 && viewer.gallery?.alignImageOnExit) {
                viewer.gallery.alignImageOnExit(currentNavIndex);
            }
        }
    } else if (currentMode === 'zoom') {
        await hideZoomedView(viewer);
    }
}

export async function handleKeyDown(viewer, e) {
    if (dialogState.isOpen) return;
    if (!viewer.panelElements?.panelEl || viewer.panelElements.panelEl.style.display === 'none') return;

    const isInputFocused = ['input', 'textarea', 'select'].includes(e.target.tagName.toLowerCase());
    if (isInputFocused && e.key !== 'Escape' && e.key !== 'Delete') return;

    const state = imageViewerState.getState();
    const currentMode = state.ui.view_mode;
    const galleryEl = document.getElementById('holaf-viewer-gallery');

    switch (e.key) {
        case ' ': {
            if (currentMode !== 'gallery' || !state.activeImage) break;
            e.preventDefault();

            const currentSelection = new Set([...state.selectedImages].map(img => img.path_canon));
            const activeImagePath = state.activeImage.path_canon;

            if (currentSelection.has(activeImagePath)) {
                currentSelection.delete(activeImagePath);
            } else {
                currentSelection.add(activeImagePath);
            }

            const newSelectedImages = new Set(state.images.filter(img => currentSelection.has(img.path_canon)));
            imageViewerState.setState({ selectedImages: newSelectedImages });
            if (viewer.gallery?.render) viewer.gallery.render();
            viewer._updateActionButtonsState();
            break;
        }
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
                        if (currentMode === 'fullscreen') hideFullscreenView(viewer);
                        hideZoomedView(viewer);
                        imageViewerState.setState({ activeImage: null, currentNavIndex: -1, ui: { view_mode: 'gallery' } });
                    } else {
                        const newIndex = Math.min(originalIndex, newState.images.length - 1);
                        imageViewerState.setState({ currentNavIndex: newIndex + 1 });
                        await navigate(viewer, -1);
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
                const targetIndex = e.key === 'Home' ? 0 : state.images.length - 1;
                const newActiveImage = state.images[targetIndex];
                imageViewerState.setState({ currentNavIndex: targetIndex, activeImage: newActiveImage });
                if (viewer.gallery?.ensureImageVisible) {
                    viewer.gallery.ensureImageVisible(targetIndex);
                }
            }
            break;
        case 'Enter':
            e.preventDefault();
            const { currentNavIndex, activeImage, images } = state;
            let targetImage = activeImage;

            if (currentNavIndex === -1 && images.length > 0) {
                targetImage = images[0];
                imageViewerState.setState({ activeImage: targetImage, currentNavIndex: 0 });
            }

            if (targetImage) {
                if (e.ctrlKey) {
                    showFullscreenView(viewer, targetImage);
                } else {
                    showZoomedView(viewer, targetImage);
                }
            }
            break;
        case 'ArrowRight':
        case 'ArrowLeft':
            e.preventDefault();
            await navigate(viewer, e.key === 'ArrowRight' ? 1 : -1);
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
            await handleEscape(viewer);
            break;
    }
}

export function setupZoomAndPan(state, container, element) {
    if (!element || !container) return;

    // CORRECTION : Nous n'utilisons PLUS de clonage. 
    // Nous écrasons directement les propriétés onwheel/onmousedown.
    // Cela préserve l'élément DOM original et ses références.

    // Set origin to top-left to make math easier
    element.style.transformOrigin = '0 0';

    const updateTransform = () => { element.style.transform = `translate(${state.tx}px,${state.ty}px) scale(${state.scale})`; };

    // Attach wheel event to the container (the viewport)
    container.onwheel = (e) => {
        if (container.style.display === 'none') return;
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

        if (state.scale <= 1) resetTransform(state, element);
        else element.style.cursor = 'grab';
        updateTransform();
    };

    // Attach drag event to the element itself
    element.onmousedown = (e) => {
        if (e.button !== 0) return; // Only left click
        e.preventDefault();
        if (state.scale <= 1) return;

        let startX = e.clientX - state.tx;
        let startY = e.clientY - state.ty;
        element.style.cursor = 'grabbing';
        element.style.transition = 'none';

        const onMouseMove = (moveEvent) => {
            state.tx = moveEvent.clientX - startX;
            state.ty = moveEvent.clientY - startY;
            updateTransform();
        };
        const onMouseUp = () => {
            element.style.cursor = 'grab';
            element.style.transition = 'transform .2s ease-out';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    // Prevent default drag behavior (ghost image)
    element.ondragstart = (e) => e.preventDefault();
}