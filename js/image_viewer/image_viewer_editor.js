/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Editor Module
 *
 * This module manages the image editing panel, its state,
 * and interactions with the backend for saving/loading edits.
 * REFACTOR: Safe Toast usage. Non-blocking Background Process.
 * UPDATE: Auto FPS Doubling for RIFE. UI Cleanup. State Sync.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";
import { imageViewerState } from './image_viewer_state.js';

const DEFAULT_EDIT_STATE = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    brightnessRange: 'all',
    contrastRange: 'all',
    saturationRange: 'all',
    targetFps: null,
    playbackRate: 1.0,
    interpolate: false
};

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

    hasUnsavedChanges() {
        return this.isDirty;
    }

    _showToast(message, type = 'info', duration = 3000) {
        if (window.holaf && window.holaf.toastManager) {
            return window.holaf.toastManager.show({ message, type, duration });
        } else {
            console.log(`[Holaf Toast] ${type}: ${message}`);
            return null;
        }
    }

    _dismissToast(id) {
        if (id && window.holaf && window.holaf.toastManager) {
            window.holaf.toastManager.dismiss(id);
        }
    }

    _handleStateChange(state) {
        if (!this.panelEl) {
            this.createPanel();
            if (!this.panelEl) return;
        }

        const shouldBeVisible = state.activeImage && state.ui.view_mode === 'zoom';
        const isActuallyVisible = this.panelEl.style.display !== 'none';

        if (state.activeImage && (state.activeImage.path_canon !== this.activeImage?.path_canon)) {
            this._show(state.activeImage);
        } else if (!state.activeImage && this.activeImage) {
            this._hide();
        }

        if (shouldBeVisible) {
            if (!isActuallyVisible) {
                this.panelEl.style.display = 'block';
            }
        } else {
            if (isActuallyVisible) {
                this._hide();
            }
        }
    }

    createPanel() {
        if (this.panelEl) return;

        let rightColumn = this.viewer?.elements?.rightColumn;
        if (!rightColumn) {
            rightColumn = document.getElementById('holaf-viewer-right-column');
        }

        if (rightColumn) {
            const editorContainer = document.createElement('div');
            editorContainer.id = 'holaf-viewer-editor-pane';
            editorContainer.style.display = 'none';
            editorContainer.innerHTML = this._getPanelHTML();

            rightColumn.appendChild(editorContainer);
            this.panelEl = editorContainer;
            this._attachListeners();
        }
    }

    async _show(image) {
        if (!this.panelEl) return;

        this.activeImage = image;
        this.isDirty = false;
        this.nativeFps = 0;
        this.processedVideoUrl = null;

        // Clear canvas preview cache for the new image
        if (this._previewBlobUrl) {
            URL.revokeObjectURL(this._previewBlobUrl);
            this._previewBlobUrl = null;
        }
        this._originalImgSrc = null;
        this._originalImgData = null;
        this._previewCanvas = null;

        this.currentState = { ...DEFAULT_EDIT_STATE };
        this.originalState = { ...DEFAULT_EDIT_STATE };

        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();

        await this._loadEditsForCurrentImage();
    }

    _hide() {
        if (this.isDirty) {
            this.currentState = { ...this.originalState };
            this.applyPreview();
            this.isDirty = false;
        }

        if (this.panelEl) {
            this.panelEl.style.display = 'none';
        }

        this._dispatchVideoOverride(null);

        const elements = this._getPreviewElements();
        elements.forEach(el => {
            if (el) {
                el.style.filter = 'none';
                if (el.tagName === 'VIDEO') el.playbackRate = 1.0;
            }
        });

        // Clean up canvas preview resources
        if (this._previewBlobUrl) {
            URL.revokeObjectURL(this._previewBlobUrl);
            this._previewBlobUrl = null;
        }
        this._originalImgSrc = null;
        this._originalImgData = null;
        this._previewCanvas = null;

        this.activeImage = null;
    }

    _dispatchVideoOverride(url) {
        const event = new CustomEvent('holaf-video-override', { detail: { url: url } });
        document.dispatchEvent(event);
    }

    // [NEW] Helper to update global state without fetching full list
    _updateGlobalImageState(pathCanon, hasEdits) {
        const state = imageViewerState.getState();
        const images = state.images.map(img => {
            if (img.path_canon === pathCanon) {
                return { ...img, has_edit_file: hasEdits };
            }
            return img;
        });

        // Also update selected/active if it matches
        let activeImage = state.activeImage;
        if (activeImage && activeImage.path_canon === pathCanon) {
            activeImage = { ...activeImage, has_edit_file: hasEdits };
        }

        imageViewerState.setState({ images, activeImage });
    }

    async _loadEditsForCurrentImage() {
        if (!this.activeImage) return;

        try {
            const response = await fetch(`/holaf/images/load-edits?path_canon=${encodeURIComponent(this.activeImage.path_canon)}`);
            if (response.ok) {
                const data = await response.json();

                if (data.native_fps) this.nativeFps = Number(data.native_fps);

                if (data.processed_video_url) {
                    this.processedVideoUrl = data.processed_video_url;
                    this._dispatchVideoOverride(this.processedVideoUrl);
                } else {
                    this._dispatchVideoOverride(null);
                }

                if (data.status === 'ok') {
                    this.currentState = { ...DEFAULT_EDIT_STATE, ...data.edits };
                }

                if (this.nativeFps > 0) {
                    if (this.currentState.targetFps == null) {
                        const legacyRate = this.currentState.playbackRate || 1.0;
                        this.currentState.targetFps = Math.round(this.nativeFps * legacyRate);
                    }
                }
            }
        } catch (e) {
            console.error("[Holaf Editor] Failed to load edits:", e);
        }

        this.originalState = { ...this.currentState };
        this.isDirty = false;

        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
    }

    applyPreview() {
        const elements = this._getPreviewElements();

        let effectiveRate = 1.0;
        if (this.nativeFps > 0 && this.currentState.targetFps > 0) {
            effectiveRate = this.currentState.targetFps / this.nativeFps;
        } else {
            effectiveRate = this.currentState.playbackRate || 1.0;
        }

        if (this.processedVideoUrl) {
            effectiveRate = 1.0;
        }

        if (this._hasRangedAdjustments()) {
            // Use canvas-based preview for ranged adjustments
            // CSS filters can't do luminance masking, so we process pixels in JS
            this._processRangedPreviewOnCanvas(elements);
        } else {
            // All ranges are 'all' — use fast CSS filter as before
            // Restore original image URL if a ranged preview was applied previously
            if (this._previewBlobUrl) {
                URL.revokeObjectURL(this._previewBlobUrl);
                this._previewBlobUrl = null;
                this._originalImgSrc = null;
                this._originalImgData = null;
                elements.forEach(el => {
                    if (el && el.dataset.originalSrc) {
                        el.src = el.dataset.originalSrc;
                        delete el.dataset.originalSrc;
                    }
                });
            }
            const filterValue = `brightness(${this.currentState.brightness}) contrast(${this.currentState.contrast}) saturate(${this.currentState.saturation})`;
            elements.forEach(el => {
                if (el) {
                    el.style.filter = filterValue;
                    if (el.tagName === 'VIDEO') {
                        el.playbackRate = effectiveRate;
                    }
                }
            });
        }
    }

    _hasRangedAdjustments() {
        if (this.nativeFps > 0) return false; // Videos don't have range selectors
        return ['brightness', 'contrast', 'saturation'].some(
            key => (this.currentState[`${key}Range`] || 'all') !== 'all'
        );
    }

    async _processRangedPreviewOnCanvas(elements) {
        const imgEl = elements[0]; // The zoom view img element
        if (!imgEl || imgEl.tagName !== 'IMG' || !imgEl.src) return;

        try {
            if (!this._originalImgData || this._originalImgSrc !== imgEl.src) {
                // Load original image onto an offscreen canvas (cached per image)
                this._originalImgSrc = imgEl.src;
                const loadImg = new Image();
                loadImg.crossOrigin = 'anonymous';
                await new Promise((resolve, reject) => {
                    loadImg.onload = resolve;
                    loadImg.onerror = reject;
                    loadImg.src = imgEl.src;
                });

                this._previewCanvas = document.createElement('canvas');
                this._previewCanvas.width = loadImg.naturalWidth;
                this._previewCanvas.height = loadImg.naturalHeight;
                const ctx = this._previewCanvas.getContext('2d');
                ctx.drawImage(loadImg, 0, 0);
                this._originalImgData = ctx.getImageData(0, 0, this._previewCanvas.width, this._previewCanvas.height);
            }

            // Process pixel data
            const src = this._originalImgData.data;
            const w = this._previewCanvas.width;
            const h = this._previewCanvas.height;
            const dst = new Uint8ClampedArray(src.length);

            const bVal = this.currentState.brightness;
            const cVal = this.currentState.contrast;
            const sVal = this.currentState.saturation;
            const bRange = this.currentState.brightnessRange || 'all';
            const cRange = this.currentState.contrastRange || 'all';
            const sRange = this.currentState.saturationRange || 'all';

            for (let i = 0; i < src.length; i += 4) {
                let r = src[i], g = src[i + 1], b = src[i + 2];
                const a = src[i + 3];

                // Luminance for masking
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                // Apply brightness (only non 'all' — 'all' is handled by CSS filter)
                if (bRange !== 'all') {
                    const wB = this._luminanceWeight(lum, bRange);
                    if (wB > 0) {
                        const adjR = r * bVal, adjG = g * bVal, adjB = b * bVal;
                        r += (adjR - r) * wB;
                        g += (adjG - g) * wB;
                        b += (adjB - b) * wB;
                    }
                }

                // Recompute luminance after brightness for contrast mask accuracy
                const lum2 = 0.299 * r + 0.587 * g + 0.114 * b;

                // Apply contrast
                if (cRange !== 'all') {
                    const wC = this._luminanceWeight(lum2, cRange);
                    if (wC > 0) {
                        const adjR = 128 + (r - 128) * cVal;
                        const adjG = 128 + (g - 128) * cVal;
                        const adjB = 128 + (b - 128) * cVal;
                        r += (adjR - r) * wC;
                        g += (adjG - g) * wC;
                        b += (adjB - b) * wC;
                    }
                }

                // Apply saturation
                if (sRange !== 'all') {
                    const wS = this._luminanceWeight(lum2, sRange);
                    if (wS > 0) {
                        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                        const adjR = gray + (r - gray) * sVal;
                        const adjG = gray + (g - gray) * sVal;
                        const adjB = gray + (b - gray) * sVal;
                        r += (adjR - r) * wS;
                        g += (adjG - g) * wS;
                        b += (adjB - b) * wS;
                    }
                }

                dst[i] = r;
                dst[i + 1] = g;
                dst[i + 2] = b;
                dst[i + 3] = a;
            }

            const ctx = this._previewCanvas.getContext('2d');
            ctx.putImageData(new ImageData(dst, w, h), 0, 0);

            const blob = await new Promise(resolve => this._previewCanvas.toBlob(resolve, 'image/jpeg', 0.92));
            if (!blob) return;

            // Revoke old blob URL
            if (this._previewBlobUrl) {
                URL.revokeObjectURL(this._previewBlobUrl);
            }
            this._previewBlobUrl = URL.createObjectURL(blob);

            // Replace img src with processed version, remove CSS filter
            elements.forEach(el => {
                if (el && el.tagName === 'IMG') {
                    // Save original src for later restoration
                    if (!el.dataset.originalSrc) {
                        el.dataset.originalSrc = el.src;
                    }
                    el.style.filter = 'none';
                    el.src = this._previewBlobUrl;
                }
            });

        } catch (e) {
            console.warn('[Holaf Editor] Ranged preview failed, falling back to CSS:', e);
            // Fallback: apply CSS filter (not range-accurate but functional)
            const filterValue = `brightness(${this.currentState.brightness}) contrast(${this.currentState.contrast}) saturate(${this.currentState.saturation})`;
            elements.forEach(el => {
                if (el) { el.style.filter = filterValue; }
            });
        }
    }

    _luminanceWeight(luminance, rangeType) {
        if (rangeType === 'all') return 1;
        if (rangeType === 'shadows') {
            return luminance < 128 ? 1 - luminance / 128 : 0;
        }
        if (rangeType === 'midtones') {
            if (luminance < 64) return 0;
            if (luminance < 128) return (luminance - 64) / 64;
            if (luminance < 192) return (192 - luminance) / 64;
            return 0;
        }
        if (rangeType === 'highlights') {
            return luminance > 127 ? (luminance - 127) / 128 : 0;
        }
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

    async _triggerProcessVideoBackground(pathCanon) {
        const isInteractive = (pathCanon === this.activeImage?.path_canon);

        // [UPDATED] Trigger Overlay
        document.dispatchEvent(new Event('holaf-video-processing-start'));

        try {
            const response = await fetch('/holaf/images/process-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path_canon: pathCanon,
                    edits: this.currentState
                })
            });

            const result = await response.json();

            if (response.ok) {
                if (result.stats) {
                    const msg = `Preview Ready!<br>Time: ${result.stats.duration}s<br>FPS: ${result.stats.fps_out}`;
                    this._showToast(msg, 'success', 5000);
                } else {
                    this._showToast("Preview Generated", 'success');
                }

                if (this.activeImage && this.activeImage.path_canon === pathCanon) {
                    await this._loadEditsForCurrentImage();
                }
            } else {
                HolafPanelManager.createDialog({ title: "Process Error", message: result.message });
            }
        } catch (e) {
            this._showToast(`Process Failed: ${e.message}`, 'error');
        } finally {
            // [UPDATED] Remove Overlay
            document.dispatchEvent(new Event('holaf-video-processing-end'));
        }
    }

    async save() { await this._saveEdits(); }

    async _saveEdits() {
        if (!this.activeImage) return;
        const pathCanonToSave = this.activeImage.path_canon;

        if (this.nativeFps > 0 && this.currentState.targetFps) {
            this.currentState.playbackRate = this.currentState.targetFps / this.nativeFps;
        }

        const btn = this.panelEl.querySelector('#holaf-editor-save-btn');
        if (btn) btn.disabled = true;

        this._showToast("Saving settings...", 'info', 1000);

        try {
            const response = await fetch('/holaf/images/save-edits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: pathCanonToSave, edits: this.currentState })
            });

            if (response.ok) {
                this.isDirty = false;
                this.originalState = { ...this.currentState };
                this._updateButtonStates();
                this._updateUIFromState();

                // [UPDATED] Update global state AND refresh gallery icon
                this._updateGlobalImageState(pathCanonToSave, true);
                if (this.viewer && this.viewer.gallery) {
                    this.viewer.gallery.refreshThumbnail(pathCanonToSave);
                }

                if (this.nativeFps > 0) {
                    const needsProcessing = this.currentState.interpolate || (this.currentState.targetFps && this.currentState.targetFps !== this.nativeFps);

                    if (needsProcessing) {
                        this._triggerProcessVideoBackground(pathCanonToSave);
                    } else {
                        this._showToast("Edits Saved", 'success');
                    }
                } else {
                    this._showToast("Edits Saved", 'success');
                }

            }
        } catch (e) {
            console.error(e);
            HolafPanelManager.createDialog({ title: "Save Error", message: e.message });
        } finally {
            if (btn) btn.disabled = !this.isDirty;
        }
    }

    _cancelEdits() {
        if (!this.isDirty) return;
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

        const pathCanonToReset = this.activeImage.path_canon;

        try {
            await fetch('/holaf/images/delete-edits', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: pathCanonToReset })
            });

            if (this.processedVideoUrl) {
                await fetch('/holaf/images/rollback-video', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path_canon: pathCanonToReset })
                });
            }

            this.currentState = { ...DEFAULT_EDIT_STATE };
            if (this.nativeFps > 0) this.currentState.targetFps = this.nativeFps;
            this.originalState = { ...this.currentState };
            this.isDirty = false;
            this.processedVideoUrl = null;
            this._dispatchVideoOverride(null);

            this._updateUIFromState();
            this.applyPreview();
            this._updateButtonStates();

            // [UPDATED] Update global state AND refresh gallery icon
            this._updateGlobalImageState(pathCanonToReset, false);
            if (this.viewer && this.viewer.gallery) {
                this.viewer.gallery.refreshThumbnail(pathCanonToReset);
            }

            this._showToast("Edits Reset", 'success');

        } catch (e) { console.error(e); }
    }

    _updateUIFromState() {
        if (!this.panelEl) return;

        for (const key of ['brightness', 'contrast', 'saturation']) {
            const slider = this.panelEl.querySelector(`#holaf-editor-${key}-slider`);
            const valueEl = this.panelEl.querySelector(`#holaf-editor-${key}-value`);
            if (slider) slider.value = this.currentState[key] * 100;
            if (valueEl) valueEl.textContent = Math.round(this.currentState[key] * 100);

            // Update range selector
            const rangeSelect = this.panelEl.querySelector(`.holaf-editor-range-select[data-range-key="${key}"]`);
            if (rangeSelect) {
                rangeSelect.value = this.currentState[`${key}Range`] || 'all';
                // Hide range selector for videos (FFmpeg can't do luminance masking)
                rangeSelect.style.display = this.nativeFps > 0 ? 'none' : '';
            }
        }

        const videoSection = this.panelEl.querySelector('#holaf-editor-video-section');

        if (videoSection) {
            if (this.nativeFps > 0) {
                videoSection.style.display = 'block';

                const fpsInput = this.panelEl.querySelector('#holaf-editor-fps-input');
                const fpsSlider = this.panelEl.querySelector('#holaf-editor-fps-slider');
                let val = this.currentState.targetFps;
                if (!val || val <= 0) val = this.nativeFps;
                if (fpsInput) fpsInput.value = val;
                if (fpsSlider) fpsSlider.value = val;

                const interpCheckbox = this.panelEl.querySelector('#holaf-editor-interpolate-check');
                if (interpCheckbox) interpCheckbox.checked = !!this.currentState.interpolate;

            } else {
                videoSection.style.display = 'none';
            }
        }
    }

    _updateButtonStates() {
        if (!this.panelEl) return;
        const saveBtn = this.panelEl.querySelector('#holaf-editor-save-btn');
        const cancelBtn = this.panelEl.querySelector('#holaf-editor-cancel-btn');
        if (saveBtn) saveBtn.disabled = !this.isDirty;
        if (cancelBtn) cancelBtn.disabled = !this.isDirty;
    }

    _attachListeners() {
        if (!this.panelEl) return;

        ['brightness', 'contrast', 'saturation'].forEach(key => {
            const sliderEl = this.panelEl.querySelector(`#holaf-editor-${key}-slider`);
            if (!sliderEl) return;
            const sliderContainer = sliderEl.parentNode;

            sliderContainer.addEventListener('dblclick', () => {
                this.currentState[key] = DEFAULT_EDIT_STATE[key];
                this.currentState[`${key}Range`] = DEFAULT_EDIT_STATE[`${key}Range`];
                this.isDirty = true;
                this._updateButtonStates();
                this._updateUIFromState();
                this.applyPreview();
            });

            const slider = sliderContainer.querySelector('input');
            slider.addEventListener('input', (e) => {
                this.currentState[key] = parseFloat(e.target.value) / 100;
                sliderContainer.querySelector('.holaf-editor-slider-value').textContent = e.target.value;
                this.isDirty = true;
                this._updateButtonStates();
                this.applyPreview();
            });

            // Range selector change handler
            const rangeSelect = sliderContainer.querySelector('.holaf-editor-range-select');
            if (rangeSelect) {
                rangeSelect.addEventListener('change', (e) => {
                    this.currentState[`${key}Range`] = e.target.value;
                    this.isDirty = true;
                    this._updateButtonStates();
                });
            }
        });

        const fpsInput = this.panelEl.querySelector('#holaf-editor-fps-input');
        const fpsSlider = this.panelEl.querySelector('#holaf-editor-fps-slider');
        const fpsContainer = this.panelEl.querySelector('#holaf-editor-video-section');
        const interpCheckbox = this.panelEl.querySelector('#holaf-editor-interpolate-check');

        const updateFpsState = (newVal) => {
            const val = parseFloat(newVal);
            if (!isNaN(val) && val > 0) {
                this.currentState.targetFps = val;
                this.isDirty = true;
                this._updateButtonStates();
                this.applyPreview();
                if (fpsInput && fpsInput.value != val) fpsInput.value = val;
                if (fpsSlider && fpsSlider.value != val) fpsSlider.value = val;
            }
        };
        const resetFps = () => { if (this.nativeFps > 0) updateFpsState(Math.round(this.nativeFps)); };

        if (fpsSlider) { fpsSlider.addEventListener('input', (e) => updateFpsState(e.target.value)); fpsSlider.addEventListener('dblclick', resetFps); }
        if (fpsInput) { fpsInput.addEventListener('change', (e) => updateFpsState(e.target.value)); }
        if (fpsContainer) { fpsContainer.addEventListener('dblclick', (e) => { if (e.target.tagName !== 'INPUT') resetFps(); }); }

        if (interpCheckbox) {
            interpCheckbox.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                this.currentState.interpolate = isChecked;
                this.isDirty = true;

                if (isChecked && this.nativeFps > 0) {
                    updateFpsState(this.nativeFps * 2);
                } else if (!isChecked && this.nativeFps > 0) {
                    updateFpsState(this.nativeFps);
                }

                this._updateButtonStates();
            });
        }

        const saveBtn = this.panelEl.querySelector('#holaf-editor-save-btn');
        const resetBtn = this.panelEl.querySelector('#holaf-editor-reset-btn');
        const cancelBtn = this.panelEl.querySelector('#holaf-editor-cancel-btn');
        if (saveBtn) saveBtn.onclick = () => this._saveEdits();
        if (resetBtn) resetBtn.onclick = () => this._resetEdits();
        if (cancelBtn) cancelBtn.onclick = () => this._cancelEdits();
    }

    _getPanelHTML() {
        const createSlider = (name, label, min, max, step, value, displayValue) => `
            <div class="holaf-editor-slider-container">
                <label for="holaf-editor-${name}-slider">${label}</label>
                <select class="holaf-editor-range-select" data-range-key="${name}">
                    <option value="all">All</option>
                    <option value="shadows">Shadows</option>
                    <option value="midtones">Midtones</option>
                    <option value="highlights">Highlights</option>
                </select>
                <input type="range" id="holaf-editor-${name}-slider" min="${min}" max="${max}" step="${step}" value="${value}">
                <span id="holaf-editor-${name}-value" class="holaf-editor-slider-value">${displayValue}</span>
            </div>
        `;

        // [MODIFIED] Removed Rollback btn, updated text
        return `
            <h4>Image Editor</h4>
            <div id="holaf-editor-content">
                <div class="holaf-editor-tabs">
                    <button class="holaf-editor-tab active">Adjust</button>
                    <button class="holaf-editor-tab" disabled>Crop/Ratio</button>
                    <button class="holaf-editor-tab" disabled>Effects</button>
                </div>
                <div class="holaf-editor-tab-content">
                    <div class="holaf-editor-section">
                        ${createSlider('brightness', 'Brightness', 0, 200, 1, 100, '100')}
                        ${createSlider('contrast', 'Contrast', 0, 200, 1, 100, '100')}
                        ${createSlider('saturation', 'Saturation', 0, 200, 1, 100, '100')}
                    </div>
                    
                    <div id="holaf-editor-video-section" class="holaf-editor-section" style="border-top: 1px solid var(--holaf-border-color); padding-top: 8px; margin-top: 4px; display:none;">
                        <style>
                            #holaf-editor-fps-input::-webkit-inner-spin-button, 
                            #holaf-editor-fps-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
                            #holaf-editor-fps-input { -moz-appearance: textfield; }
                        </style>
                        <div class="holaf-editor-slider-container">
                            <label for="holaf-editor-fps-slider">FPS</label>
                            <input type="range" id="holaf-editor-fps-slider" min="1" max="144" step="1" style="flex-grow: 1; margin: 0 8px;">
                            <input type="number" id="holaf-editor-fps-input" min="1" max="144" step="1" 
                                   style="width: 40px; background: var(--comfy-input-bg); color: var(--comfy-input-text); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px; text-align: center;">
                        </div>
                        
                        <div class="holaf-editor-slider-container" style="justify-content: flex-start; margin-top: 6px;">
                            <input type="checkbox" id="holaf-editor-interpolate-check" style="margin-right: 8px;">
                            <label for="holaf-editor-interpolate-check" style="cursor: pointer; opacity: 0.8;" title="Uses AI (RIFE) to generate intermediate frames (2x).">AI Interpolation (RIFE)</label>
                        </div>
                    </div>
                </div>
                <div class="holaf-editor-footer">
                    <button id="holaf-editor-reset-btn" class="comfy-button" title="Reset all edits">Reset</button>
                    <button id="holaf-editor-cancel-btn" class="comfy-button" title="Discard unsaved" disabled>Cancel</button>
                    <button id="holaf-editor-save-btn" class="comfy-button" title="Save changes and Process Video" disabled>Save</button>
                </div>
            </div>
        `;
    }
}