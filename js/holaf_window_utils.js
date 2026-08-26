/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Shared Window Utils
 *
 * Generic drag & resize helpers for floating windows/panels.
 * Consolidates duplicated logic previously inlined across several window
 * systems (AIH modals, picker, workflow share, panel manager, remote
 * comparer, shortcuts, layout tools).
 *
 * Both helpers support two anchoring modes:
 *   - 'left-top'   (default): position is driven by `left`/`top` styles.
 *   - 'right-bottom'        : position is driven by `right`/`bottom` styles
 *                             (used by remote_comparer & shortcuts).
 *
 * Optional persistence is supported via a `storageKey` (localStorage) or a
 * custom `saveState` callback.
 */

// ─── Persistance unifiée position / taille ──────────────────────────────────────
// UN SEUL store localStorage `aih_window_rects` (schéma { [storageKey]:
// {left, top, width, height} }). Centralise aussi le clamp au viewport pour la
// restauration. Migration : à la première lecture, si `aih_window_rects` est
// vide, on lit les anciens stores `aih_modal_rects` et `aih_dialog_rects` et on
// les reporte dans le store unifié.

const WINDOW_RECTS_KEY = "aih_window_rects";
const LEGACY_RECT_KEYS = ["aih_modal_rects", "aih_dialog_rects"];
let _rectsMigrated = false;

function _readRectsStore() {
    try {
        return JSON.parse(localStorage.getItem(WINDOW_RECTS_KEY) || "{}");
    } catch (e) {
        return {};
    }
}

function _writeRectsStore(store) {
    try {
        localStorage.setItem(WINDOW_RECTS_KEY, JSON.stringify(store));
    } catch (e) {
        /* localStorage indisponible — silencieux */
    }
}

// Migration one-shot : ne se déclenche que si le store unifié est vide.
function _ensureRectMigration() {
    if (_rectsMigrated) return;
    _rectsMigrated = true;
    try {
        const unified = _readRectsStore();
        if (Object.keys(unified).length > 0) return;
        const merged = {};
        for (const legacyKey of LEGACY_RECT_KEYS) {
            try {
                const raw = localStorage.getItem(legacyKey);
                if (raw) Object.assign(merged, JSON.parse(raw));
            } catch (e) { /* silencieux */ }
        }
        if (Object.keys(merged).length > 0) {
            _writeRectsStore(merged);
        }
    } catch (e) { /* silencieux */ }
}

/**
 * Clampe un rect {left, top, width, height} dans le viewport.
 * @param {object} rect
 * @param {number} [margin=20]
 * @returns {object|null} rect clamppé (left/top arrondis) ou null.
 */
export function clampWindowRect(rect, margin = 20) {
    if (!rect) return null;
    if (typeof rect.left !== "number" || typeof rect.top !== "number") return rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = rect.width || 0;
    const h = rect.height || 0;
    let left = rect.left;
    let top = rect.top;
    if (w <= vw - margin * 2) {
        left = Math.max(margin, Math.min(left, vw - w - margin));
    } else {
        left = margin;
    }
    if (h <= vh - margin * 2) {
        top = Math.max(margin, Math.min(top, vh - h - margin));
    } else {
        top = margin;
    }
    return { left: Math.round(left), top: Math.round(top), width: w, height: h };
}

/**
 * Charge un rect persisté (clampé au viewport) depuis le store unifié.
 * @param {string} storageKey
 * @returns {object|null} {left, top, width, height} clamppé ou null.
 */
export function loadWindowRect(storageKey, margin = 20) {
    if (!storageKey) return null;
    _ensureRectMigration();
    const store = _readRectsStore();
    const raw = store[storageKey];
    if (!raw) return null;
    return clampWindowRect({
        left: raw.left,
        top: raw.top,
        width: raw.width,
        height: raw.height,
    }, margin);
}

/**
 * Sauvegarde un rect {left, top, width, height} dans le store unifié.
 * @param {string} storageKey
 * @param {object} rect
 */
export function saveWindowRect(storageKey, rect) {
    if (!storageKey || !rect) return;
    _ensureRectMigration();
    const store = _readRectsStore();
    store[storageKey] = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
    };
    _writeRectsStore(store);
}

// ─── makeDraggable ────────────────────────────────────────────────────────────
/**
 * Makes an element draggable by a handle.
 *
 * @param {HTMLElement} el - The element to move.
 * @param {object} opts
 * @param {HTMLElement} [opts.handle=el] - The drag handle.
 * @param {'left-top'|'right-bottom'} [opts.anchor='left-top'] - Anchoring mode.
 * @param {string} [opts.storageKey] - localStorage key for persistence.
 * @param {Function} [opts.onStateChange] - Called on drag end with {x,y,width,height}.
 * @param {Function} [opts.onDragStart] - Called on mousedown.
 * @param {Function} [opts.onDragMove] - Called on mousemove.
 * @param {Function} [opts.onDragEnd] - Called on mouseup.
 * @param {boolean} [opts.clamp=true] - Clamp to viewport.
 * @param {number} [opts.margin=10] - Viewport margin when clamping.
 * @param {string} [opts.ignore] - Selector of targets that cancel the drag.
 * @param {Function} [opts.isIgnored] - (e)=>bool, extra ignore predicate.
 * @param {Function} [opts.bringToFront] - Called on mousedown.
 * @param {Function} [opts.bakeTransform] - Called on mousedown to bake transform.
 * @param {object} [opts.state] - Mutable state object (right-bottom mode).
 * @param {Function} [opts.updateVisualPosition] - (right-bottom mode) refresh position.
 * @param {Function} [opts.saveState] - Persistence callback on drag end.
 * @param {string} [opts.cursor] - Cursor to set on the handle during drag.
 * @param {string} [opts.cursorRestore=''] - Cursor to restore on drag end.
 */
export function makeDraggable(el, opts = {}) {
    const {
        handle = el,
        anchor = 'left-top',
        storageKey = null,
        onStateChange = null,
        onDragStart = null,
        onDragMove = null,
        onDragEnd = null,
        clamp = true,
        margin = 10,
        ignore = 'button, input, select, textarea, a',
        isIgnored = null,
        bringToFront = null,
        bakeTransform = null,
        state = null,
        updateVisualPosition = null,
        saveState = null,
        cursor = null,
        cursorRestore = '',
    } = opts;

    const persist = (rect) => {
        if (storageKey) {
            try {
                localStorage.setItem(storageKey, JSON.stringify(rect));
            } catch (e) { /* localStorage unavailable — silent */ }
        }
        if (saveState) saveState(rect);
    };

    handle.addEventListener('mousedown', (e) => {
        if (el.classList.contains('holaf-panel-fullscreen')) return;
        if (ignore && e.target.closest(ignore)) return;
        if (isIgnored && isIgnored(e)) return;
        e.preventDefault();

        if (bringToFront) bringToFront(el);
        if (bakeTransform) bakeTransform(el);
        if (cursor) handle.style.cursor = cursor;
        if (onDragStart) onDragStart(e);

        if (anchor === 'right-bottom') {
            const rect = el.getBoundingClientRect();
            const startRight = window.innerWidth - rect.right;
            const startBottom = window.innerHeight - rect.bottom;
            const startX = e.clientX;
            const startY = e.clientY;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (state) {
                    state.right = startRight - dx;
                    state.bottom = startBottom - dy;
                }
                if (updateVisualPosition) updateVisualPosition();
                if (onDragMove) onDragMove(dx, dy);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (cursor) handle.style.cursor = cursorRestore;
                if (onStateChange) {
                    onStateChange({
                        right: state ? state.right : 0,
                        bottom: state ? state.bottom : 0,
                        width: el.offsetWidth,
                        height: el.offsetHeight,
                    });
                }
                persist(null);
                if (onDragEnd) onDragEnd();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            return;
        }

        // left-top mode
        const offsetX = e.clientX - el.offsetLeft;
        const offsetY = e.clientY - el.offsetTop;

        const onMove = (moveEvent) => {
            let newLeft = moveEvent.clientX - offsetX;
            let newTop = moveEvent.clientY - offsetY;
            if (clamp) {
                const panelRect = el.getBoundingClientRect();
                if (newTop < margin) newTop = margin;
                if (newLeft < margin) newLeft = margin;
                if (newLeft + panelRect.width > window.innerWidth - margin) newLeft = window.innerWidth - panelRect.width - margin;
                if (newTop + panelRect.height > window.innerHeight - margin) newTop = window.innerHeight - panelRect.height - margin;
            }
            el.style.left = `${newLeft}px`;
            el.style.top = `${newTop}px`;
            if (onDragMove) onDragMove(newLeft, newTop);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (cursor) handle.style.cursor = cursorRestore;
            if (onStateChange) {
                onStateChange({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
            }
            persist({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
            if (onDragEnd) onDragEnd();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ─── makeResizable ───────────────────────────────────────────────────────────
/**
 * Makes an element resizable via directional handles.
 *
 * @param {HTMLElement} el - The element to resize.
 * @param {object} opts
 * @param {NodeList|Array} [opts.handles] - Resize handles (default: .holaf-resize-handle).
 * @param {'left-top'|'right-bottom'} [opts.anchor='left-top'] - Anchoring mode.
 * @param {string} [opts.storageKey] - localStorage key for persistence.
 * @param {Function} [opts.onStateChange] - Called on resize end.
 * @param {Function} [opts.onResize] - Called on each resize move.
 * @param {number} [opts.minWidth=100] - Minimum width.
 * @param {number} [opts.minHeight=50] - Minimum height.
 * @param {number} [opts.maxWidth] - Maximum width (optional).
 * @param {number} [opts.maxHeight] - Maximum height (optional).
 * @param {Function} [opts.bringToFront] - Called on mousedown.
 * @param {Function} [opts.bakeTransform] - Called on mousedown.
 * @param {object} [opts.state] - Mutable state object (right-bottom mode).
 * @param {Function} [opts.updateVisualPosition] - (right-bottom mode) refresh position.
 * @param {Function} [opts.saveState] - Persistence callback on resize end.
 * @param {Function} [opts.isIgnored] - (e)=>bool, cancel the resize.
 */
export function makeResizable(el, opts = {}) {
    const {
        handles = el.querySelectorAll('.holaf-resize-handle'),
        anchor = 'left-top',
        storageKey = null,
        onStateChange = null,
        onResize = null,
        minWidth = 100,
        minHeight = 50,
        maxWidth = null,
        maxHeight = null,
        bringToFront = null,
        bakeTransform = null,
        state = null,
        updateVisualPosition = null,
        saveState = null,
        isIgnored = null,
    } = opts;

    const persist = (rect) => {
        if (storageKey) {
            try {
                localStorage.setItem(storageKey, JSON.stringify(rect));
            } catch (e) { /* localStorage unavailable — silent */ }
        }
        if (saveState) saveState(rect);
    };

    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            if (isIgnored && isIgnored(e)) return;
            e.preventDefault();
            e.stopPropagation();

            const dir = handle.dataset.dir;
            const resizeN = dir.includes('n');
            const resizeS = dir.includes('s');
            const resizeE = dir.includes('e');
            const resizeW = dir.includes('w');

            if (bringToFront) bringToFront(el);
            if (bakeTransform) bakeTransform(el);

            const startX = e.clientX;
            const startY = e.clientY;

            if (anchor === 'right-bottom') {
                const rect = el.getBoundingClientRect();
                const startW = rect.width;
                const startH = rect.height;
                const startRight = window.innerWidth - rect.right;
                const startBottom = window.innerHeight - rect.bottom;

                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
                    let newW = startW;
                    let newH = startH;
                    let newRight = startRight;
                    let newBottom = startBottom;

                    if (resizeE) { newW = Math.max(minWidth, startW + dx); newRight = startRight - (newW - startW); }
                    if (resizeW) { newW = Math.max(minWidth, startW - dx); }
                    if (resizeS) { newH = Math.max(minHeight, startH + dy); newBottom = startBottom - (newH - startH); }
                    if (resizeN) { newH = Math.max(minHeight, startH - dy); }

                    if (state) {
                        state.width = newW;
                        state.height = newH;
                        state.right = newRight;
                        state.bottom = newBottom;
                    }
                    if (updateVisualPosition) updateVisualPosition();
                    if (onResize) onResize(newW, newH);
                };

                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (onStateChange) {
                        onStateChange({
                            width: state ? state.width : el.offsetWidth,
                            height: state ? state.height : el.offsetHeight,
                            right: state ? state.right : 0,
                            bottom: state ? state.bottom : 0,
                        });
                    }
                    persist(null);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                return;
            }

            // left-top mode
            const initialWidth = el.offsetWidth;
            const initialHeight = el.offsetHeight;
            const initialLeft = el.offsetLeft;
            const initialTop = el.offsetTop;

            const onMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const deltaY = moveEvent.clientY - startY;

                let newWidth = initialWidth;
                let newHeight = initialHeight;
                let newLeft = initialLeft;
                let newTop = initialTop;

                if (resizeE) newWidth = Math.max(minWidth, initialWidth + deltaX);
                if (resizeW) { newWidth = Math.max(minWidth, initialWidth - deltaX); newLeft = initialLeft + initialWidth - newWidth; }
                if (resizeS) newHeight = Math.max(minHeight, initialHeight + deltaY);
                if (resizeN) { newHeight = Math.max(minHeight, initialHeight - deltaY); newTop = initialTop + initialHeight - newHeight; }

                if (maxWidth != null && newWidth > maxWidth) {
                    if (resizeW) newLeft = initialLeft + initialWidth - maxWidth;
                    newWidth = maxWidth;
                }
                if (maxHeight != null && newHeight > maxHeight) {
                    if (resizeN) newTop = initialTop + initialHeight - maxHeight;
                    newHeight = maxHeight;
                }

                el.style.width = `${newWidth}px`;
                el.style.height = `${newHeight}px`;
                el.style.left = `${newLeft}px`;
                el.style.top = `${newTop}px`;
                if (onResize) onResize(newWidth, newHeight);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (onStateChange) {
                    onStateChange({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
                }
                persist({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}
