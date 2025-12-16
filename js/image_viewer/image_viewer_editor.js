/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Editor Module
 *
 * This module manages the image editing panel, its state,
 * and interactions with the backend for saving/loading edits.
 * REFACTOR: Decoupled UI logic (Events). Added Preview & Rollback.
 * FIX: Restored Viewer instance injection.
 * FIX: Added missing hasUnsavedChanges() method required by Navigation module.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";
import { imageViewerState } from './image_viewer_state.js';

const DEFAULT_EDIT_STATE = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    targetFps: null,    // Primary source of truth for video speed now
    playbackRate: 1.0,  // Kept for backward compatibility / internal calc
    interpolate: false  // RIFE Interpolation flag
};

export class ImageEditor {
    /**
     * @param {Object} viewer - The main HolafImageViewer instance (required for DOM access)
     */
    constructor(viewer) {
        this.viewer = viewer; // Store reference to access UI elements safely
        this.panelEl = null;
        this.activeImage = null;
        this.currentState = { ...DEFAULT_EDIT_STATE };
        this.originalState = { ...DEFAULT_EDIT_STATE };
        this.isDirty = false;
        
        // Runtime properties
        this.nativeFps = 0; 
        this.processedVideoUrl = null; // URL of side-load video if exists
    }

    /**
     * Initializes the editor, creates its UI, and subscribes to state changes.
     */
    init() {
        this.createPanel();
        imageViewerState.subscribe(this._handleStateChange.bind(this));
    }

    /**
     * Public method used by Navigation module to check for unsaved work.
     * @returns {boolean} True if there are unsaved edits.
     */
    hasUnsavedChanges() {
        return this.isDirty;
    }

    /**
     * Handles changes from the central state manager.
     */
    _handleStateChange(state) {
        // Safety check: ensure panel exists before trying to manipulate it
        if (!this.panelEl) {
            // Try one last time to create it if context is ready (lazy init recovery)
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
        // Prevent duplicate creation
        if (this.panelEl) return;

        // ROBUST TARGETING: Use the element reference from the viewer instance if available
        let rightColumn = this.viewer?.elements?.rightColumn;
        
        // Fallback to DOM query if direct reference fails (defensive programming)
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
        } else {
            console.warn("[Holaf Editor] Could not find right column to attach editor.");
        }
    }

    async _show(image) {
        if (!this.panelEl) return;

        this.activeImage = image;
        this.isDirty = false;
        this.nativeFps = 0; 
        this.processedVideoUrl = null;

        // Reset UI immediately
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

        // Clean up visual overrides using Event
        this._dispatchVideoOverride(null);
        
        // Clean up filters on exit
        const elements = this._getPreviewElements();
        elements.forEach(el => {
            if (el) {
                el.style.filter = 'none';
                if (el.tagName === 'VIDEO') el.playbackRate = 1.0;
            }
        });

        this.activeImage = null;
    }
    
    // Helper to communicate with UI decoupled
    _dispatchVideoOverride(url) {
        const event = new CustomEvent('holaf-video-override', { detail: { url: url } });
        document.dispatchEvent(event);
    }

    async _loadEditsForCurrentImage() {
        if (!this.activeImage) return;

        try {
            const response = await fetch(`/holaf/images/load-edits?path_canon=${encodeURIComponent(this.activeImage.path_canon)}`);
            if (response.ok) {
                const data = await response.json();
                
                // FORCE NUMBER TYPE to prevent "invisible controls" bug
                if (data.native_fps) this.nativeFps = Number(data.native_fps);
                
                // Check if a processed video exists
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
        // If we are watching the processed video, we DO NOT apply CSS filters
        if (this.processedVideoUrl) {
             const elements = this._getPreviewElements();
             elements.forEach(el => {
                 if (el) {
                     el.style.filter = 'none';
                     if (el.tagName === 'VIDEO') el.playbackRate = 1.0;
                 }
             });
            return;
        }

        const elements = this._getPreviewElements();
        
        let effectiveRate = 1.0;
        if (this.nativeFps > 0 && this.currentState.targetFps > 0) {
            effectiveRate = this.currentState.targetFps / this.nativeFps;
        } else {
            effectiveRate = this.currentState.playbackRate || 1.0;
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
    
    _getPreviewElements() {
        return [
            document.querySelector('#holaf-viewer-zoom-view img'),
            document.querySelector('#holaf-viewer-zoom-view video'),
            document.querySelector('#holaf-viewer-fullscreen-overlay img'),
            document.querySelector('#holaf-viewer-fullscreen-overlay video')
        ];
    }

    async _triggerProcessVideo() {
        if (!this.activeImage) return;
        if (!this.panelEl) return;
        
        const btn = this.panelEl.querySelector('#holaf-editor-generate-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Processing... (Wait)";
        }
        
        try {
            // Force Save first so backend uses current settings
            await this._saveEdits();
            
            const response = await fetch('/holaf/images/process-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path_canon: this.activeImage.path_canon,
                    edits: this.currentState
                })
            });
            
            const result = await response.json();
            if (response.ok) {
                await this._loadEditsForCurrentImage();
            } else {
                HolafPanelManager.createDialog({ title: "Process Error", message: result.message });
            }
        } catch (e) {
            HolafPanelManager.createDialog({ title: "Error", message: e.message });
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "▶ Generate Preview";
            }
        }
    }

    async _triggerRollbackVideo() {
        if (!this.activeImage) return;
        
        if (!await HolafPanelManager.createDialog({
            title: "Confirm Rollback",
            message: "This will delete the generated preview and return to the original video.",
            buttons: [{ text: "Cancel", value: false }, { text: "Rollback", value: true, type: "danger" }]
        })) return;
        
        try {
            const response = await fetch('/holaf/images/rollback-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: this.activeImage.path_canon })
            });
            
            if (response.ok) {
                await this._loadEditsForCurrentImage();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async save() { await this._saveEdits(); }
    
    async _saveEdits() {
        if (!this.activeImage) return; 
        const pathCanonToSave = this.activeImage.path_canon;
        
        if (this.nativeFps > 0 && this.currentState.targetFps) {
            this.currentState.playbackRate = this.currentState.targetFps / this.nativeFps;
        }
        
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
            }
        } catch (e) { console.error(e); }
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

        try {
            await fetch('/holaf/images/delete-edits', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: this.activeImage.path_canon })
            });
            
            if (this.processedVideoUrl) {
                await fetch('/holaf/images/rollback-video', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path_canon: this.activeImage.path_canon })
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
        } catch (e) { console.error(e); }
    }

    _updateUIFromState() {
        if (!this.panelEl) return;

        for (const key of ['brightness', 'contrast', 'saturation']) {
            const slider = this.panelEl.querySelector(`#holaf-editor-${key}-slider`);
            const valueEl = this.panelEl.querySelector(`#holaf-editor-${key}-value`);
            if (slider) slider.value = this.currentState[key] * 100;
            if (valueEl) valueEl.textContent = Math.round(this.currentState[key] * 100);
        }

        const videoSection = this.panelEl.querySelector('#holaf-editor-video-section');
        const processControls = this.panelEl.querySelector('#holaf-editor-process-controls');
        const rollbackControls = this.panelEl.querySelector('#holaf-editor-rollback-controls');

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

                if (this.processedVideoUrl) {
                    if (processControls) processControls.style.display = 'none';
                    if (rollbackControls) rollbackControls.style.display = 'block';
                } else {
                    if (processControls) processControls.style.display = 'block';
                    if (rollbackControls) rollbackControls.style.display = 'none';
                }

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
        });

        const fpsInput = this.panelEl.querySelector('#holaf-editor-fps-input');
        const fpsSlider = this.panelEl.querySelector('#holaf-editor-fps-slider');
        const fpsContainer = this.panelEl.querySelector('#holaf-editor-video-section');
        const interpCheckbox = this.panelEl.querySelector('#holaf-editor-interpolate-check');
        const generateBtn = this.panelEl.querySelector('#holaf-editor-generate-btn');
        const rollbackBtn = this.panelEl.querySelector('#holaf-editor-rollback-btn');

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
                this.currentState.interpolate = e.target.checked;
                this.isDirty = true;
                this._updateButtonStates();
            });
        }
        
        if (generateBtn) generateBtn.onclick = () => this._triggerProcessVideo();
        if (rollbackBtn) rollbackBtn.onclick = () => this._triggerRollbackVideo();

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
                <input type="range" id="holaf-editor-${name}-slider" min="${min}" max="${max}" step="${step}" value="${value}">
                <span id="holaf-editor-${name}-value" class="holaf-editor-slider-value">${displayValue}</span>
            </div>
        `;

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
                            <input type="range" id="holaf-editor-fps-slider" min="1" max="120" step="1" style="flex-grow: 1; margin: 0 8px;">
                            <input type="number" id="holaf-editor-fps-input" min="1" max="144" step="1" 
                                   style="width: 40px; background: var(--comfy-input-bg); color: var(--comfy-input-text); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px; text-align: center;">
                        </div>
                        
                        <div class="holaf-editor-slider-container" style="justify-content: flex-start; margin-top: 6px;">
                            <input type="checkbox" id="holaf-editor-interpolate-check" style="margin-right: 8px;">
                            <label for="holaf-editor-interpolate-check" style="cursor: pointer; opacity: 0.8;" title="Uses AI (RIFE) to generate intermediate frames.">AI Interpolation (Smooth)</label>
                        </div>

                        <!-- Process Actions -->
                        <div id="holaf-editor-process-controls" style="margin-top: 8px; text-align: right;">
                            <button id="holaf-editor-generate-btn" class="comfy-button" style="width:100%; font-size: 0.9em; padding: 4px;" title="Generates a preview video using current settings (RIFE/Filters). Takes time.">▶ Generate Preview</button>
                        </div>
                         <div id="holaf-editor-rollback-controls" style="margin-top: 8px; text-align: right; display: none;">
                            <button id="holaf-editor-rollback-btn" class="comfy-button" style="width:100%; font-size: 0.9em; padding: 4px; background: var(--error-text);" title="Delete generated preview and return to original.">↺ Rollback to Original</button>
                        </div>
                    </div>
                </div>
                <div class="holaf-editor-footer">
                    <button id="holaf-editor-reset-btn" class="comfy-button" title="Reset all edits">Reset</button>
                    <button id="holaf-editor-cancel-btn" class="comfy-button" title="Discard unsaved" disabled>Cancel</button>
                    <button id="holaf-editor-save-btn" class="comfy-button" title="Save changes" disabled>Save</button>
                </div>
            </div>
        `;
    }
}