/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Gallery Module
 *
 * MAJOR REFACTOR: Implements high-performance virtualized scrolling with NETWORK CANCELLATION.
 * INCLUDES: Built-in Benchmark Tool to test concurrency limits.
 * FIX: Added strict 30s TIMEOUT to prevent queue deadlocks on stalled requests.
 * UPDATE: Added video click handler.
 */

import { imageViewerState } from "./image_viewer_state.js";
import { showFullscreenView } from './image_viewer_navigation.js';

// --- Configuration ---
const SCROLLBAR_DEBOUNCE_MS = 50;
const FETCH_TIMEOUT_MS = 30000; // 30 seconds timeout per image

// Default concurrency. Can be overridden by the benchmark tool.
let currentConcurrencyLimit = 6;
let benchmarkCacheBuster = ''; // Used to bypass browser cache during tests
let benchmarkStartTime = 0;
let benchmarkTotalItems = 0;
let isBenchmarking = false;

// --- Module-level state ---
let viewerInstance = null;
let galleryEl = null;
let gallerySizerEl = null;
let galleryGridEl = null;
let resizeObserver = null;
let renderedPlaceholders = new Map(); // path_canon -> DOM Element
let scrollbarDebounceTimeout = null;

// Track active network requests to cancel them if needed
// Map<path_canon, AbortController>
const activeFetches = new Map();

let isWheelScrolling = false;
let wheelScrollTimeout = null;
let activeThumbnailLoads = 0;

let columnCount = 0;
let itemWidth = 0;
let itemHeight = 0;
let gap = 0;
let renderRequestID = null;

// --- EXPOSED BENCHMARK TOOL ---
if (!window.holaf) window.holaf = {};

window.holaf.runBenchmark = (concurrency = 6) => {
    console.clear();
    console.log(`🚀 STARTING BENCHMARK with Concurrency: ${concurrency}`);

    // 1. Setup Benchmark Environment
    currentConcurrencyLimit = concurrency;
    benchmarkCacheBuster = `bench_${Date.now()}`; // Unique ID to bypass browser cache
    isBenchmarking = true;

    // 2. Reset Gallery
    if (viewerInstance) {
        // Cancel everything current
        for (const controller of activeFetches.values()) controller.abort();
        activeFetches.clear();
        activeThumbnailLoads = 0;

        // Clear DOM to force re-render
        galleryGridEl.innerHTML = '';
        renderedPlaceholders.clear();

        // 3. Start Timer and Trigger Render
        setTimeout(() => {
            const visibleCount = getVisibleItemCount();
            console.log(`📸 Target: Loading ${visibleCount} visible images from scratch...`);
            benchmarkTotalItems = visibleCount;
            benchmarkStartTime = performance.now();

            // Force re-layout and load
            renderVisibleItems();
        }, 100);
    } else {
        console.error("Gallery not initialized. Open the Image Viewer first.");
    }
};

function getVisibleItemCount() {
    if (!galleryEl) return 0;
    const viewportHeight = galleryEl.clientHeight;
    // Estimate based on layout
    const itemHeightWithGap = itemHeight + gap;
    const rowsVisible = Math.ceil(viewportHeight / itemHeightWithGap) + 1; // +1 buffer
    return Math.min(rowsVisible * columnCount, imageViewerState.getState().images.length);
}

function checkBenchmarkCompletion() {
    if (!isBenchmarking) return;

    // Check if queue is empty and no active fetches
    if (activeThumbnailLoads === 0 && activeFetches.size === 0) {
        // Double check: are all visible placeholders actually loaded?
        const visiblePlaceholders = Array.from(galleryGridEl.children);
        const allLoaded = visiblePlaceholders.every(p => p.dataset.thumbnailLoadingOrLoaded === 'true' || p.dataset.thumbnailLoadingOrLoaded === 'error');

        if (allLoaded) {
            const endTime = performance.now();
            const duration = (endTime - benchmarkStartTime) / 1000; // seconds
            const speed = (benchmarkTotalItems / duration).toFixed(2);

            console.log(`🏁 BENCHMARK COMPLETE`);
            console.log(`-----------------------------------`);
            console.log(`threads:  ${currentConcurrencyLimit}`);
            console.log(`time:     ${duration.toFixed(3)}s`);
            console.log(`speed:    ${speed} images/sec`);
            console.log(`-----------------------------------`);

            // Reset benchmark state
            isBenchmarking = false;
            benchmarkCacheBuster = '';

            if (window.holaf.toastManager) {
                window.holaf.toastManager.show({
                    message: `<strong>Benchmark Result (${currentConcurrencyLimit} threads)</strong><br>Speed: ${speed} imgs/sec<br>Time: ${duration.toFixed(2)}s`,
                    type: 'success'
                });
            }
        }
    }
}

// --- Internal Functions ---

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

        const buffer = viewportHeight * 0.5;
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

        // Cleanup
        for (const [path, element] of renderedPlaceholders) {
            element.remove();
            if (activeFetches.has(path)) {
                // Abort user-cancelled fetches (scroll away)
                activeFetches.get(path).abort('scroll-away');
                activeFetches.delete(path);
                activeThumbnailLoads--;
                if (activeThumbnailLoads < 0) activeThumbnailLoads = 0;
            }
            const img = element.querySelector('img');
            if (img && img.src.startsWith('blob:')) {
                URL.revokeObjectURL(img.src);
            }
        }

        if (fragment.childElementCount > 0) {
            galleryGridEl.appendChild(fragment);
        }

        renderedPlaceholders = newPlaceholdersToRender;
        debouncedLoadVisibleThumbnails();
    });
}

function debouncedLoadVisibleThumbnails() {
    clearTimeout(scrollbarDebounceTimeout);
    scrollbarDebounceTimeout = setTimeout(loadVisibleThumbnails, isBenchmarking ? 5 : SCROLLBAR_DEBOUNCE_MS);
}

function loadVisibleThumbnails() {
    const placeholdersToLoad = Array.from(galleryGridEl.children);

    const process = () => {
        if (activeThumbnailLoads >= currentConcurrencyLimit) return;

        const nextPlaceholder = placeholdersToLoad.find(p =>
            !p.dataset.thumbnailLoadingOrLoaded &&
            !activeFetches.has(p.dataset.pathCanon)
        );

        if (nextPlaceholder) {
            activeThumbnailLoads++;
            const imageIndex = parseInt(nextPlaceholder.dataset.index, 10);
            const image = imageViewerState.getState().images[imageIndex];

            if (image) {
                fetchThumbnail(nextPlaceholder, image, false).finally(() => {
                    activeThumbnailLoads--;
                    if (activeThumbnailLoads < 0) activeThumbnailLoads = 0;
                    if (isBenchmarking) checkBenchmarkCompletion();
                    process();
                });
            } else {
                activeThumbnailLoads--;
                setTimeout(process, 0);
            }
        } else {
            // Queue is empty for now
            if (isBenchmarking) checkBenchmarkCompletion();
        }
    };

    // Fill the pipe
    for (let i = 0; i < currentConcurrencyLimit; i++) process();
}

async function fetchThumbnail(placeholder, image, forceReload = false) {
    const pathCanon = image.path_canon;
    if (activeFetches.has(pathCanon)) return;

    // Flag as loading to prevent duplicate queueing
    placeholder.dataset.thumbnailLoadingOrLoaded = "loading";

    // Visual feedback for loading (optional: could be a spinner)
    placeholder.classList.remove('error');
    const existingError = placeholder.querySelector('.holaf-viewer-error-overlay');
    if (existingError) existingError.remove();

    const imageUrl = new URL(window.location.origin);
    imageUrl.pathname = '/holaf/images/thumbnail';
    let cacheBuster = image.thumb_hash ? image.thumb_hash : (image.mtime || '');
    if (benchmarkCacheBuster) cacheBuster += `_${benchmarkCacheBuster}`;

    const params = {
        filename: image.filename,
        subfolder: image.subfolder,
        path_canon: image.path_canon,
        mtime: cacheBuster,
        t: forceReload ? new Date().getTime() : ''
    };
    imageUrl.search = new URLSearchParams(params);

    const controller = new AbortController();
    // --- TIMEOUT PROTECTION ---
    const timeoutId = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);

    activeFetches.set(pathCanon, controller);

    try {
        const response = await fetch(imageUrl.href, {
            signal: controller.signal,
            priority: 'high'
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const blob = await response.blob();
        const objectURL = URL.createObjectURL(blob);

        if (!placeholder.isConnected) {
            URL.revokeObjectURL(objectURL);
            return;
        }

        const img = document.createElement('img');
        img.className = "holaf-image-viewer-thumbnail";
        img.src = objectURL;

        img.onload = () => {
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
        };

        const oldImg = placeholder.querySelector('img');
        if (oldImg) {
            URL.revokeObjectURL(oldImg.src);
            oldImg.remove();
        }

        placeholder.prepend(img);
        placeholder.dataset.thumbnailLoadingOrLoaded = "true";

    } catch (err) {
        clearTimeout(timeoutId);

        let isTimeout = false;
        // Check if it's a timeout abort
        if (controller.signal.aborted && controller.signal.reason === 'timeout') {
            isTimeout = true;
        }

        if (isTimeout || err.name !== 'AbortError') {
            // Real error or timeout
            if (placeholder.isConnected) {
                placeholder.classList.add('error');
                placeholder.dataset.thumbnailLoadingOrLoaded = "error";
                const errorDiv = document.createElement('div');
                errorDiv.className = 'holaf-viewer-error-overlay';
                errorDiv.textContent = isTimeout ? 'Timeout' : 'Err';
                placeholder.appendChild(errorDiv);
            }
        }
        // If normal abort (scroll away), we silently ignore
    } finally {
        activeFetches.delete(pathCanon);
    }
}

function createPlaceholder(viewer, image, index) {
    const placeholder = document.createElement('div');
    placeholder.className = 'holaf-viewer-thumbnail-placeholder';
    placeholder.style.position = 'absolute';
    placeholder.dataset.index = index;
    placeholder.dataset.pathCanon = image.path_canon;

    const actionIcon = document.createElement('div');
    actionIcon.className = 'holaf-viewer-edit-icon';

    if (['MP4', 'WEBM'].includes(image.format)) {
        actionIcon.innerHTML = '🎥';
        actionIcon.title = "Play Video";
        actionIcon.onclick = (e) => {
            e.stopPropagation();
            // Trigger viewer to open video (Zoom view will handle it)
            imageViewerState.setState({ activeImage: image, currentNavIndex: index });
            viewer._showZoomedView(image);
        };
    } else {
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

    activeThumbnailLoads = 0;
    for (const controller of activeFetches.values()) {
        controller.abort();
    }
    activeFetches.clear();

    galleryGridEl.innerHTML = '';
    renderedPlaceholders.clear();

    const messageEl = galleryEl.querySelector('.holaf-viewer-message');
    if (messageEl) messageEl.remove();

    if (images && images.length > 0) {
        updateLayout(true);
    } else {
        gallerySizerEl.style.height = '300px';
        const placeholder = document.createElement('div');
        placeholder.className = 'holaf-viewer-thumbnail-placeholder holaf-viewer-empty-message';
        placeholder.style.cssText = `position: absolute; top: 8px; left: 8px; right: 8px; height: 200px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px; box-sizing: border-box; border: 2px dashed var(--holaf-border-color); border-radius: var(--holaf-border-radius); color: var(--holaf-text-color-secondary);`;
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

    fetchThumbnail(placeholder, image, true);
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
            if (isVisible) return;
            if (rect.top < galleryRect.top) targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            else targetElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
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