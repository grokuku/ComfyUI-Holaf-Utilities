/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Editor Module
 *
 * REFACTOR: Stackable controls system. Users add/remove individual controls
 * instead of a fixed set of sliders. Supports luminance range masking.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";
import { imageViewerState } from './image_viewer_state.js';

const CONTROL_TYPES = [
    { id: 'brightness', label: 'Brightness', default: 1, min: 0, max: 200, step: 1 },
    { id: 'contrast',   label: 'Contrast',   default: 1, min: 0, max: 200, step: 1 },
    { id: 'saturation', label: 'Saturation', default: 1, min: 0, max: 200, step: 1 },
    { id: 'hue',        label: 'Hue',        default: 0, min: -180, max: 180, step: 1 },
];

const DEFAULT_EDIT_STATE = {
    controls: [],
    targetFps: null,
    playbackRate: 1.0,
    interpolate: false
};

let _ctrlIdCounter = 0;

export class ImageEditor {
    constructor(viewer) {
        this.viewer = viewer;
        this.panelEl = null;
        this.activeImage = null;
        this.currentState = { ...DEFAULT_EDIT_STATE };
        this.originalState = { ...DEFAULT_EDIT_STATE };
        this.isDirty = false;
        this.nativeFps = 0;
        this.processedVideoUrl = null;
    }

    init() {
        this.createPanel();
        imageViewerState.subscribe(this._handleStateChange.bind(this));
    }

    hasUnsavedChanges() { return this.isDirty; }

    _showToast(message, type = 'info', duration = 3000) {
        if (window.holaf && window.holaf.toastManager)
            return window.holaf.toastManager.show({ message, type, duration });
        console.log(`[Holaf Toast] ${type}: ${message}`);
        return null;
    }

    _handleStateChange(state) {
        if (!this.panelEl) { this.createPanel(); if (!this.panelEl) return; }
        const visible = state.activeImage && state.ui.view_mode === 'zoom';
        const shown = this.panelEl.style.display !== 'none';
        if (state.activeImage && state.activeImage.path_canon !== this.activeImage?.path_canon)
            this._show(state.activeImage);
        else if (!state.activeImage && this.activeImage)
            this._hide();
        this.panelEl.style.display = visible ? 'block' : 'none';
        if (visible && !shown) this.panelEl.style.display = 'block';
        if (!visible && shown) this._hide();
    }

    createPanel() {
        if (this.panelEl) return;
        const col = this.viewer?.elements?.rightColumn || document.getElementById('holaf-viewer-right-column');
        if (!col) return;
        const el = document.createElement('div');
        el.id = 'holaf-viewer-editor-pane';
        el.style.display = 'none';
        el.innerHTML = `
            <h4>Image Editor</h4>
            <div id="holaf-editor-content">
                <div id="holaf-editor-controls-list"></div>
                <div style="padding: 4px 0 8px 0;">
                    <button id="holaf-editor-add-btn" class="comfy-button" style="width:100%;font-size:12px;padding:6px;">+ Add Control</button>
                </div>
                <div id="holaf-editor-video-section" style="display:none;border-top:1px solid var(--holaf-border-color);padding-top:8px;margin-top:4px;">
                    <style>
                        #holaf-editor-fps-input::-webkit-inner-spin-button,
                        #holaf-editor-fps-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
                        #holaf-editor-fps-input { -moz-appearance: textfield; }
                    </style>
                    <div class="holaf-editor-slider-container">
                        <label for="holaf-editor-fps-slider">FPS</label>
                        <input type="range" id="holaf-editor-fps-slider" min="1" max="144" step="1" style="flex-grow:1;margin:0 8px;">
                        <input type="number" id="holaf-editor-fps-input" min="1" max="144" step="1"
                               style="width:40px;background:var(--comfy-input-bg);color:var(--comfy-input-text);border:1px solid var(--border-color);border-radius:4px;padding:2px;text-align:center;">
                    </div>
                    <div class="holaf-editor-slider-container" style="justify-content:flex-start;margin-top:6px;">
                        <input type="checkbox" id="holaf-editor-interpolate-check" style="margin-right:8px;">
                        <label for="holaf-editor-interpolate-check" style="cursor:pointer;opacity:0.8;" title="AI frame interpolation (2x).">AI Interpolation (RIFE)</label>
                    </div>
                </div>
                <div class="holaf-editor-footer">
                    <label style="display:flex;align-items:center;gap:4px;margin-right:auto;cursor:pointer;font-size:12px;opacity:0.8;" title="Split view: left = original, right = edited">
                        <input type="checkbox" id="holaf-editor-compare-check" style="cursor:pointer;"> Compare
                    </label>
                    <button id="holaf-editor-reset-btn" class="comfy-button">Reset</button>
                    <button id="holaf-editor-cancel-btn" class="comfy-button" disabled>Cancel</button>
                    <button id="holaf-editor-save-btn" class="comfy-button" disabled>Save</button>
                </div>
            </div>`;
        col.appendChild(el);
        this.panelEl = el;
        this._attachListeners();
    }

    async _show(image) {
        if (!this.panelEl) return;
        this.activeImage = image;
        this.isDirty = false;
        this.nativeFps = 0;
        this.processedVideoUrl = null;
        this._clearCanvasCache();
        this._compareCleanup();
        this.currentState = { ...DEFAULT_EDIT_STATE };
        this.originalState = { ...DEFAULT_EDIT_STATE };
        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
        await this._loadEditsForCurrentImage();
    }

    _hide() {
        if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
        if (this.isDirty) { this.currentState = { ...this.originalState }; this.applyPreview(); this.isDirty = false; }
        if (this.panelEl) this.panelEl.style.display = 'none';
        this._dispatchVideoOverride(null);
        this._getPreviewElements().forEach(el => { if (el) el.style.filter = 'none'; });
        this._compareCleanup();
        this._clearCanvasCache();
        this.activeImage = null;
    }

    _clearCanvasCache() {
        if (this._previewBlobUrl) { URL.revokeObjectURL(this._previewBlobUrl); this._previewBlobUrl = null; }
        this._originalImgSrc = null; this._originalImgData = null; this._previewCanvas = null;
    }

    _dispatchVideoOverride(url) {
        document.dispatchEvent(new CustomEvent('holaf-video-override', { detail: { url } }));
    }

    _updateGlobalImageState(path, hasEdits) {
        const s = imageViewerState.getState();
        const images = s.images.map(i => i.path_canon === path ? { ...i, has_edit_file: hasEdits } : i);
        let active = s.activeImage;
        if (active && active.path_canon === path) active = { ...active, has_edit_file: hasEdits };
        imageViewerState.setState({ images, activeImage: active });
    }

    async _loadEditsForCurrentImage() {
        if (!this.activeImage) return;
        try {
            const r = await fetch(`/holaf/images/load-edits?path_canon=${encodeURIComponent(this.activeImage.path_canon)}`);
            if (r.ok) {
                const d = await r.json();
                if (d.native_fps) this.nativeFps = Number(d.native_fps);
                if (d.processed_video_url) { this.processedVideoUrl = d.processed_video_url; this._dispatchVideoOverride(this.processedVideoUrl); }
                else this._dispatchVideoOverride(null);
                if (d.status === 'ok') this.currentState = { ...DEFAULT_EDIT_STATE, ...d.edits };
                if (this.nativeFps > 0 && this.currentState.targetFps == null)
                    this.currentState.targetFps = Math.round(this.nativeFps * (this.currentState.playbackRate || 1.0));
            }
        } catch (e) { console.error("[Holaf Editor] load edits:", e); }
        this.originalState = { ...this.currentState };
        this.isDirty = false;
        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
    }

    // ── Preview ──

    applyPreview() {
        const els = this._getPreviewElements();
        let rate = 1.0;
        if (this.nativeFps > 0 && this.currentState.targetFps > 0) rate = this.currentState.targetFps / this.nativeFps;
        else rate = this.currentState.playbackRate || 1.0;
        if (this.processedVideoUrl) rate = 1.0;

        // Cancel any pending ranged preview to avoid overlapping async renders
        if (this._rangedPreviewPending) { this._rangedPreviewPending = false; }

        if (this._hasRangedAdjustments()) {
            this._rangedPreviewPending = true;
            this._processRangedPreviewOnCanvas(els);
        } else {
            this._applyCssFilter(els, rate);
        }

        // Refresh compare canvas if active
        this._compareRefresh();
    }

    _schedulePreview() {
        if (this._previewTimer) clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => { this._previewTimer = null; this.applyPreview(); }, 16);
    }

    _compareRefresh() {
        const canvas = document.getElementById('holaf-compare-canvas');
        if (!canvas) return;
        // Signal the running render loop to re-read the filter on next frame
        // instead of tearing down and rebuilding the entire compare setup
        this._compareFilterDirty = true;
    }

    _applyCssFilter(els, rate) {
        if (this._previewBlobUrl) {
            URL.revokeObjectURL(this._previewBlobUrl); this._previewBlobUrl = null;
            this._originalImgSrc = null; this._originalImgData = null;
            els.forEach(el => { if (el && el.dataset.originalSrc) { el.src = el.dataset.originalSrc; delete el.dataset.originalSrc; } });
        }
        const f = this._buildCssFilter();
        els.forEach(el => { if (el) { el.style.filter = f; if (el.tagName === 'VIDEO') el.playbackRate = rate; } });
    }

    _buildCssFilter() {
        let b = 1, c = 1, s = 1, h = 0;
        for (const ctrl of this.currentState.controls || []) {
            if (ctrl.range !== 'all') continue;
            if (ctrl.type === 'brightness') b = ctrl.value;
            if (ctrl.type === 'contrast') c = ctrl.value;
            if (ctrl.type === 'saturation') s = ctrl.value;
            if (ctrl.type === 'hue') h = ctrl.value;
        }
        return `brightness(${b}) contrast(${c}) saturate(${s}) hue-rotate(${h}deg)`;
    }

    _hasRangedAdjustments() {
        if (this.nativeFps > 0) return false;
        return (this.currentState.controls || []).some(c => c.range && c.range !== 'all');
    }

    async _processRangedPreviewOnCanvas(els) {
        const imgEl = els[0];
        if (!imgEl || imgEl.tagName !== 'IMG') return;
        // Use the ORIGINAL image URL as cache key, not the current src (which may be a blob URL)
        const originalUrl = imgEl.dataset.originalSrc || imgEl.src;
        if (!originalUrl) return;
        try {
            if (!this._originalImgData || this._originalImgSrc !== originalUrl) {
                this._originalImgSrc = originalUrl;
                const loadImg = new Image();
                loadImg.crossOrigin = 'anonymous';
                await new Promise((res, rej) => { loadImg.onload = res; loadImg.onerror = rej; loadImg.src = originalUrl; });
                // Downscale to max 1920px for preview — 4x fewer pixels = 4x faster pixel loop
                const MAX_PREVIEW_DIM = 1920;
                let pw = loadImg.naturalWidth, ph = loadImg.naturalHeight;
                if (pw > MAX_PREVIEW_DIM || ph > MAX_PREVIEW_DIM) {
                    const scale = MAX_PREVIEW_DIM / Math.max(pw, ph);
                    pw = Math.round(pw * scale);
                    ph = Math.round(ph * scale);
                }
                this._previewCanvas = document.createElement('canvas');
                this._previewCanvas.width = pw;
                this._previewCanvas.height = ph;
                this._previewCanvas.getContext('2d').drawImage(loadImg, 0, 0, pw, ph);
                this._originalImgData = this._previewCanvas.getContext('2d').getImageData(0, 0, pw, ph);
            }
            const src = this._originalImgData.data, w = this._previewCanvas.width, h = this._previewCanvas.height;
            const dst = new Uint8ClampedArray(src.length);
            const controls = this.currentState.controls || [];

            for (let i = 0; i < src.length; i += 4) {
                let r = src[i], g = src[i + 1], b = src[i + 2], a0 = src[i + 3];
                const oR = r, oG = g, oB = b;
                const origLum = 0.299 * oR + 0.587 * oG + 0.114 * oB;

                for (const ctrl of controls) {
                    const range = ctrl.range || 'all';
                    const val = ctrl.value;
                    const weight = range === 'all' ? 1 : this._luminanceWeight(origLum, range);
                    if (weight <= 0) continue;

                    if (ctrl.type === 'brightness') {
                        if (range === 'all') { r *= val; g *= val; b *= val; }
                        else { r += (oR * val - oR) * weight; g += (oG * val - oG) * weight; b += (oB * val - oB) * weight; }
                    } else if (ctrl.type === 'contrast') {
                        const adj = (px, v) => 128 + (px - 128) * v;
                        if (range === 'all') { r = adj(r, val); g = adj(g, val); b = adj(b, val); }
                        else { r += (adj(oR, val) - oR) * weight; g += (adj(oG, val) - oG) * weight; b += (adj(oB, val) - oB) * weight; }
                    } else if (ctrl.type === 'saturation') {
                        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                        const sat = (px, gr) => gr + (px - gr) * val;
                        if (range === 'all') { r = sat(r, gray); g = sat(g, gray); b = sat(b, gray); }
                        else {
                            const oGray = 0.299 * oR + 0.587 * oG + 0.114 * oB;
                            r += (sat(oR, oGray) - oR) * weight;
                            g += (sat(oG, oGray) - oG) * weight;
                            b += (sat(oB, oGray) - oB) * weight;
                        }
                    } else if (ctrl.type === 'hue') {
                        // RGB -> HSV -> rotate H -> HSV -> RGB
                        const max = Math.max(r, g, b), min = Math.min(r, g, b);
                        const d = max - min;
                        let h;
                        if (d === 0) h = 0;
                        else if (max === r) h = ((g - b) / d) % 6;
                        else if (max === g) h = (b - r) / d + 2;
                        else h = (r - g) / d + 4;
                        h = h * 60; if (h < 0) h += 360;
                        const s = max === 0 ? 0 : d / max;
                        const v = max;
                        // Rotate hue
                        let nH = (h + val) % 360; if (nH < 0) nH += 360;
                        // HSV -> RGB
                        const c = v * s;
                        const x = c * (1 - Math.abs((nH / 60) % 2 - 1));
                        const m = v - c;
                        let nr, ng, nb;
                        if (nH < 60) { nr = c; ng = x; nb = 0; }
                        else if (nH < 120) { nr = x; ng = c; nb = 0; }
                        else if (nH < 180) { nr = 0; ng = c; nb = x; }
                        else if (nH < 240) { nr = 0; ng = x; nb = c; }
                        else if (nH < 300) { nr = x; ng = 0; nb = c; }
                        else { nr = c; ng = 0; nb = x; }
                        const adjR = nr + m, adjG = ng + m, adjB = nb + m;
                        if (range === 'all') { r = adjR; g = adjG; b = adjB; }
                        else {
                            r += (adjR - oR) * weight;
                            g += (adjG - oG) * weight;
                            b += (adjB - oB) * weight;
                        }
                    }
                }

                dst[i] = Math.round(r); dst[i+1] = Math.round(g); dst[i+2] = Math.round(b); dst[i+3] = a0;
            }

            this._previewCanvas.getContext('2d').putImageData(new ImageData(dst, w, h), 0, 0);
            const blob = await new Promise(r => this._previewCanvas.toBlob(r, 'image/jpeg', 0.92));
            if (!blob) return;
            if (this._previewBlobUrl) URL.revokeObjectURL(this._previewBlobUrl);
            this._previewBlobUrl = URL.createObjectURL(blob);
            els.forEach(el => { if (el && el.tagName === 'IMG') { if (!el.dataset.originalSrc) el.dataset.originalSrc = el.src; el.style.filter = 'none'; el.src = this._previewBlobUrl; } });
        } catch (e) {
            console.warn('[Holaf Editor] Ranged preview fallback:', e);
            this._applyCssFilter(els, 1.0);
        } finally {
            this._rangedPreviewPending = false;
        }
    }

    _luminanceWeight(lum, range) {
        if (range === 'all') return 1;
        if (range === 'shadows') return lum < 128 ? 1 - lum / 128 : 0;
        if (range === 'midtones') {
            if (lum < 64) return 0; if (lum < 128) return (lum - 64) / 64;
            if (lum < 192) return (192 - lum) / 64; return 0;
        }
        if (range === 'highlights') return lum > 127 ? (lum - 127) / 128 : 0;
        return 1;
    }

    _getPreviewElements() {
        return [
            document.querySelector('#holaf-viewer-zoom-view img'),
            document.querySelector('#holaf-viewer-zoom-view video'),
            document.querySelector('#holaf-viewer-fullscreen-overlay img'),
            document.querySelector('#holaf-viewer-fullscreen-overlay video')
        ];
    }

    // ── Controls management ──

    _addControl(typeId) {
        const def = CONTROL_TYPES.find(c => c.id === typeId);
        if (!def) return;
        _ctrlIdCounter++;
        this.currentState.controls.push({ id: 'c_' + _ctrlIdCounter, type: typeId, value: def.default, range: 'all' });
        this.isDirty = true;
        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
    }

    _removeControl(ctrlId) {
        this.currentState.controls = this.currentState.controls.filter(c => c.id !== ctrlId);
        this.isDirty = true;
        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
    }

    _renderControlsList() {
        const container = this.panelEl?.querySelector('#holaf-editor-controls-list');
        if (!container) return;
        const controls = this.currentState.controls || [];

        if (controls.length === 0) {
            container.innerHTML = `<p style="opacity:0.5;font-size:12px;text-align:center;padding:12px 0;">No controls yet. Click "+ Add Control" to begin.</p>`;
            return;
        }

        container.innerHTML = controls.map(c => {
            const def = CONTROL_TYPES.find(t => t.id === c.type);
            if (!def) return '';
            const val = c.value;
            const displayVal = c.type === 'hue' ? val : Math.round(val * 100);
            const sliderVal = c.type === 'hue' ? val : val * 100;
            const isVideo = this.nativeFps > 0;
            return `
                <div class="holaf-editor-slider-container" data-ctrl-id="${c.id}">
                    <label>${def.label}</label>
                    <select class="holaf-editor-range-select" data-range-for="${c.id}" style="${isVideo ? 'display:none;' : ''}">
                        <option value="all" ${c.range === 'all' ? 'selected' : ''}>All</option>
                        <option value="shadows" ${c.range === 'shadows' ? 'selected' : ''}>Shadows</option>
                        <option value="midtones" ${c.range === 'midtones' ? 'selected' : ''}>Midtones</option>
                        <option value="highlights" ${c.range === 'highlights' ? 'selected' : ''}>Highlights</option>
                    </select>
                    <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${sliderVal}">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="holaf-editor-slider-value" style="min-width:36px;">${displayVal}</span>
                        <button class="holaf-editor-remove-ctrl" data-ctrl-id="${c.id}" title="Remove ${def.label}"
                                style="background:none;border:none;cursor:pointer;color:var(--holaf-error-color,#c44);padding:0 2px;font-size:14px;line-height:1;">✕</button>
                    </div>
                </div>`;
        }).join('');
    }

    // ── UI sync ──

    _updateUIFromState() {
        if (!this.panelEl) return;
        this._renderControlsList();

        const vs = this.panelEl.querySelector('#holaf-editor-video-section');
        // Hide compare checkbox for videos (compare only works on images)
        const compareLabel = this.panelEl.querySelector('label[title="Split view: left = original, right = edited"]');
        if (compareLabel) compareLabel.style.display = this.nativeFps > 0 ? 'none' : '';
        if (vs) {
            if (this.nativeFps > 0) {
                vs.style.display = 'block';
                const fi = vs.querySelector('#holaf-editor-fps-input');
                const fs = vs.querySelector('#holaf-editor-fps-slider');
                let v = this.currentState.targetFps; if (!v || v <= 0) v = this.nativeFps;
                if (fi) fi.value = v; if (fs) fs.value = v;
                const ic = vs.querySelector('#holaf-editor-interpolate-check');
                if (ic) ic.checked = !!this.currentState.interpolate;
            } else vs.style.display = 'none';
        }
    }

    _updateButtonStates() {
        const sb = this.panelEl?.querySelector('#holaf-editor-save-btn');
        const cb = this.panelEl?.querySelector('#holaf-editor-cancel-btn');
        if (sb) sb.disabled = !this.isDirty;
        if (cb) cb.disabled = !this.isDirty;
    }

    // ── Event listeners ──

    _attachListeners() {
        if (!this.panelEl) return;

        // Add Control — uses createDialog for reliable positioning
        const addBtn = this.panelEl.querySelector('#holaf-editor-add-btn');
        if (addBtn) {
            addBtn.onclick = async () => {
                // Build choice buttons for ALL control types (duplicates allowed)
                const buttons = CONTROL_TYPES.map(t => ({
                    text: t.label,
                    value: t.id,
                    type: 'confirm'
                }));
                buttons.push({ text: "Cancel", value: null, type: 'cancel' });

                const chosen = await HolafPanelManager.createDialog({
                    title: "Add Control",
                    message: "Choose a control type to add:",
                    buttons
                });

                if (chosen) {
                    this._addControl(chosen);
                }
            };
        }

        // Delegated events for controls list
        const list = this.panelEl.querySelector('#holaf-editor-controls-list');
        if (list) {
            // Range select change
            list.addEventListener('change', (e) => {
                const sel = e.target.closest('.holaf-editor-range-select');
                if (!sel) return;
                const ctrlId = sel.dataset.rangeFor;
                const ctrl = this.currentState.controls.find(c => c.id === ctrlId);
                if (ctrl) { ctrl.range = sel.value; this.isDirty = true; this._updateButtonStates(); this._schedulePreview(); }
            });

            // Slider input
            list.addEventListener('input', (e) => {
                const slider = e.target.closest('input[type="range"]');
                if (!slider) return;
                const container = slider.closest('.holaf-editor-slider-container');
                const ctrlId = container?.dataset.ctrlId;
                const ctrl = this.currentState.controls.find(c => c.id === ctrlId);
                if (!ctrl) return;
                const def = CONTROL_TYPES.find(t => t.id === ctrl.type);
                const rawVal = parseFloat(slider.value);
                ctrl.value = ctrl.type === 'hue' ? rawVal : rawVal / 100;
                const valEl = container.querySelector('.holaf-editor-slider-value');
                if (valEl) valEl.textContent = ctrl.type === 'hue' ? rawVal : Math.round(rawVal);
                this.isDirty = true;
                this._updateButtonStates();
                this._schedulePreview();
            });

            // Double-click on container to reset control
            list.addEventListener('dblclick', (e) => {
                const container = e.target.closest('.holaf-editor-slider-container');
                if (!container) return;
                const ctrlId = container.dataset.ctrlId;
                const ctrl = this.currentState.controls.find(c => c.id === ctrlId);
                if (!ctrl) return;
                const def = CONTROL_TYPES.find(t => t.id === ctrl.type);
                if (!def) return;
                ctrl.value = def.default;
                ctrl.range = 'all';
                this.isDirty = true;
                this._updateUIFromState();
                this._schedulePreview();
                this._updateButtonStates();
            });

            // Remove button click
            list.addEventListener('click', (e) => {
                const btn = e.target.closest('.holaf-editor-remove-ctrl');
                if (btn) { this._removeControl(btn.dataset.ctrlId); }
            });
        }

        // FPS
        const fi = this.panelEl.querySelector('#holaf-editor-fps-input');
        const fs = this.panelEl.querySelector('#holaf-editor-fps-slider');
        const ic = this.panelEl.querySelector('#holaf-editor-interpolate-check');

        const setFps = (v) => {
            const val = parseFloat(v);
            if (isNaN(val) || val <= 0) return;
            this.currentState.targetFps = val;
            this.isDirty = true; this._updateButtonStates(); this.applyPreview();
            if (fi && fi.value != val) fi.value = val;
            if (fs && fs.value != val) fs.value = val;
        };
        const resetFps = () => { if (this.nativeFps > 0) setFps(Math.round(this.nativeFps)); };

        if (fs) { fs.addEventListener('input', e => setFps(e.target.value)); fs.addEventListener('dblclick', resetFps); }
        if (fi) fi.addEventListener('change', e => setFps(e.target.value));
        if (this.panelEl.querySelector('#holaf-editor-video-section')) {
            this.panelEl.querySelector('#holaf-editor-video-section').addEventListener('dblclick', e => { if (e.target.tagName !== 'INPUT') resetFps(); });
        }
        if (ic) ic.addEventListener('change', e => {
            this.currentState.interpolate = e.target.checked;
            this.isDirty = true;
            if (e.target.checked && this.nativeFps > 0) setFps(this.nativeFps * 2);
            else if (!e.target.checked && this.nativeFps > 0) setFps(this.nativeFps);
            this._updateButtonStates();
        });

        const sb = this.panelEl.querySelector('#holaf-editor-save-btn');
        const rb = this.panelEl.querySelector('#holaf-editor-reset-btn');
        const cb = this.panelEl.querySelector('#holaf-editor-cancel-btn');
        if (sb) sb.onclick = () => this._saveEdits();
        if (rb) rb.onclick = () => this._resetEdits();
        if (cb) cb.onclick = () => this._cancelEdits();

        // Compare toggle
        const compareCb = this.panelEl.querySelector('#holaf-editor-compare-check');
        if (compareCb) {
            compareCb.addEventListener('change', (e) => {
                this._toggleCompareMode(e.target.checked);
            });
        }
    }

    // ── Save / Reset / Cancel ──

    async save() { await this._saveEdits(); }

    async _saveEdits() {
        if (!this.activeImage) return;
        const path = this.activeImage.path_canon;
        if (this.nativeFps > 0 && this.currentState.targetFps)
            this.currentState.playbackRate = this.currentState.targetFps / this.nativeFps;

        const btn = this.panelEl?.querySelector('#holaf-editor-save-btn');
        if (btn) btn.disabled = true;
        this._showToast("Saving...", 'info', 1000);
        try {
            const r = await fetch('/holaf/images/save-edits', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: path, edits: this.currentState })
            });
            if (r.ok) {
                this.isDirty = false;
                this.originalState = { ...this.currentState };
                this._updateButtonStates();
                this._updateGlobalImageState(path, true);
                if (this.viewer?.gallery) this.viewer.gallery.refreshThumbnail(path);
                if (this.nativeFps > 0) {
                    const needs = this.currentState.interpolate || (this.currentState.targetFps && this.currentState.targetFps !== this.nativeFps);
                    if (needs) this._triggerProcessVideoBackground(path);
                    else this._showToast("Edits Saved", 'success');
                } else this._showToast("Edits Saved", 'success');
            }
        } catch (e) { HolafPanelManager.createDialog({ title: "Save Error", message: e.message }); }
        finally { if (btn) btn.disabled = !this.isDirty; }
    }

    _cancelEdits() {
        if (!this.isDirty) return;
        this._compareCleanup();
        this.currentState = { ...this.originalState };
        this.isDirty = false;
        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
    }

    async _resetEdits() {
        if (!this.activeImage) return;
        if (!await HolafPanelManager.createDialog({
            title: "Confirm Reset", message: "Reset all edits? This deletes the .edt file.",
            buttons: [{ text: "Cancel", value: false }, { text: "Reset", value: true, type: "danger" }]
        })) return;

        const path = this.activeImage.path_canon;
        try {
            await fetch('/holaf/images/delete-edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path_canon: path }) });
            if (this.processedVideoUrl)
                await fetch('/holaf/images/rollback-video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path_canon: path }) });
            this.currentState = { ...DEFAULT_EDIT_STATE };
            if (this.nativeFps > 0) this.currentState.targetFps = this.nativeFps;
            this.originalState = { ...this.currentState };
            this.isDirty = false;
            this.processedVideoUrl = null;
            this._dispatchVideoOverride(null);
            this._clearCanvasCache();
            // Restore original image src if it was replaced by a blob URL
            this._getPreviewElements().forEach(el => {
                if (el && el.dataset.originalSrc) { el.src = el.dataset.originalSrc; delete el.dataset.originalSrc; }
            });
            this._updateUIFromState();
            this.applyPreview();
            this._updateButtonStates();
            this._updateGlobalImageState(path, false);
            if (this.viewer?.gallery) this.viewer.gallery.refreshThumbnail(path);
            this._showToast("Edits Reset", 'success');
        } catch (e) { console.error(e); }
    }

    async _triggerProcessVideoBackground(path) {
        document.dispatchEvent(new Event('holaf-video-processing-start'));
        try {
            const r = await fetch('/holaf/images/process-video', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: path, edits: this.currentState })
            });
            const d = await r.json();
            if (r.ok) {
                this._showToast(d.stats ? `Preview Ready! ${d.stats.duration}s` : "Preview Generated", 'success');
                if (this.activeImage?.path_canon === path) await this._loadEditsForCurrentImage();
            } else HolafPanelManager.createDialog({ title: "Process Error", message: d.message });
        } catch (e) { this._showToast(`Process Failed: ${e.message}`, 'error'); }
        finally { document.dispatchEvent(new Event('holaf-video-processing-end')); }
    }

    // ── Compare mode (canvas-based split like remote comparer) ──

    _toggleCompareMode(active) {
        if (!this.activeImage) { this._compareCleanup(); return; }

        if (!active) {
            this._compareCleanup();
            return;
        }

        const zoomView = document.getElementById('holaf-viewer-zoom-view');
        const editedImg = zoomView?.querySelector('img');
        if (!zoomView || !editedImg || !editedImg.src) return;

        // Clean up any previous compare state (including event listeners)
        if (this._compareCleanups) { this._compareCleanups.forEach(fn => fn()); this._compareCleanups = null; }
        if (this._compareRaf) { cancelAnimationFrame(this._compareRaf); this._compareRaf = null; }
        if (this._compareResizeObserver) { this._compareResizeObserver.disconnect(); this._compareResizeObserver = null; }
        const oldCanvas = document.getElementById('holaf-compare-canvas');
        if (oldCanvas) oldCanvas.remove();

        // Create canvas overlay
        const canvas = document.createElement('canvas');
        canvas.id = 'holaf-compare-canvas';
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:50;pointer-events:none;';
        zoomView.appendChild(canvas);

        // Resize canvas to match zoom view dimensions
        const rect = zoomView.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        const ctx = canvas.getContext('2d');

        // Determine original URL and edited URL
        const originalUrl = editedImg.dataset.originalSrc || (
            window.location.origin + '/view?' +
            new URLSearchParams({
                filename: this.activeImage.filename,
                subfolder: this.activeImage.subfolder || '',
                type: 'output'
            }).toString()
        );
        const editedUrl = editedImg.src;

        // Load both images
        const origImg = new Image();
        origImg.crossOrigin = 'anonymous';
        const editImg = new Image();
        editImg.crossOrigin = 'anonymous';

        let imagesLoaded = 0;
        const onLoad = () => {
            imagesLoaded++;
            if (imagesLoaded < 2) return;
            this._compareStartLoop(zoomView, canvas, ctx, origImg, editImg, editedUrl);
        };
        origImg.onload = onLoad;
        editImg.onload = onLoad;
        origImg.src = originalUrl;
        editImg.src = editedUrl;

        // Resize observer to update canvas dimensions
        this._compareResizeObserver = new ResizeObserver(() => {
            const r = zoomView.getBoundingClientRect();
            canvas.width = r.width;
            canvas.height = r.height;
        });
        this._compareResizeObserver.observe(zoomView);
    }

    _compareStartLoop(zoomView, canvas, ctx, origImg, editImg, initialEditedUrl) {
        // Read current CSS filter from the edited element
        const editedEl = zoomView.querySelector('img');
        let filterValue = editedEl ? getComputedStyle(editedEl).filter : 'none';

        let mouseX = canvas.width / 2;
        let isOver = false;

        const onMove = (e) => {
            const r = canvas.getBoundingClientRect();
            mouseX = Math.max(0, Math.min(r.width, e.clientX - r.left));
            isOver = true;
        };
        const onLeave = () => { isOver = false; };

        zoomView.addEventListener('mousemove', onMove);
        zoomView.addEventListener('mouseleave', onLeave);
        this._compareCleanups = [
            () => zoomView.removeEventListener('mousemove', onMove),
            () => zoomView.removeEventListener('mouseleave', onLeave),
        ];

        // Track the edited image src to detect blob URL changes
        let currentEditedSrc = initialEditedUrl;

        const render = () => {
            const w = canvas.width, h = canvas.height;
            if (w === 0 || h === 0) { this._compareRaf = requestAnimationFrame(render); return; }

            // Re-read filter if dirty (slider changed)
            if (this._compareFilterDirty) {
                this._compareFilterDirty = false;
                const el = zoomView.querySelector('img');
                if (el) {
                    filterValue = getComputedStyle(el).filter;
                    // If the edited image src changed (new blob from ranged processing), reload
                    if (el.src !== currentEditedSrc) {
                        currentEditedSrc = el.src;
                        editImg.src = currentEditedSrc;
                    }
                }
            }

            // Skip rendering if edited image is still loading after a src change
            if (!editImg.complete || editImg.naturalWidth === 0) {
                this._compareRaf = requestAnimationFrame(render);
                return;
            }

            ctx.clearRect(0, 0, w, h);

            // Calculate draw rect (object-fit: contain)
            const imgAspect = origImg.naturalWidth / origImg.naturalHeight;
            const canvasAspect = w / h;
            let dw, dh, ox = 0, oy = 0;
            if (imgAspect > canvasAspect) {
                dw = w; dh = w / imgAspect; oy = (h - dh) / 2;
            } else {
                dh = h; dw = h * imgAspect; ox = (w - dw) / 2;
            }

            // 1. Draw ORIGINAL image (full)
            ctx.drawImage(origImg, ox, oy, dw, dh);

            // 2. Draw EDITED image (clipped to left of mouse, with CSS filter)
            if (isOver && mouseX !== null) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(ox, oy, Math.max(0, mouseX - ox), dh);
                ctx.clip();

                // Apply the same CSS filter as the edited image
                ctx.filter = filterValue;
                ctx.drawImage(editImg, ox, oy, dw, dh);
                ctx.filter = 'none';

                ctx.restore();

                // 3. Split line
                if (mouseX >= ox && mouseX <= ox + dw) {
                    ctx.beginPath();
                    ctx.moveTo(mouseX, oy);
                    ctx.lineTo(mouseX, oy + dh);
                    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                    ctx.lineWidth = 2;
                    ctx.globalCompositeOperation = 'difference';
                    ctx.stroke();
                    ctx.globalCompositeOperation = 'source-over';
                }
            }

            this._compareRaf = requestAnimationFrame(render);
        };

        render();
    }

    _compareCleanup() {
        const canvas = document.getElementById('holaf-compare-canvas');
        if (canvas) canvas.remove();
        if (this._compareRaf) { cancelAnimationFrame(this._compareRaf); this._compareRaf = null; }
        if (this._compareResizeObserver) { this._compareResizeObserver.disconnect(); this._compareResizeObserver = null; }
        if (this._compareCleanups) { this._compareCleanups.forEach(fn => fn()); this._compareCleanups = null; }
        this._compareFilterDirty = false;
        // Reset checkbox only on explicit cleanup (not during toggle setup)
        const cb = this.panelEl?.querySelector('#holaf-editor-compare-check');
        if (cb && cb.checked) cb.checked = false;
    }
}
