/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Editor Module
 *
 * This module manages the image editing panel, its state,
 * and interactions with the backend for saving/loading edits.
 * REFACTOR: Added Playback Rate support for video.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";
import { imageViewerState } from './image_viewer_state.js';

const DEFAULT_EDIT_STATE = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    playbackRate: 1.0 // New property for video speed
};

export class ImageEditor {
    constructor() {
        this.panelEl = null;
        this.activeImage = null;
        this.currentState = { ...DEFAULT_EDIT_STATE };
        this.originalState = { ...DEFAULT_EDIT_STATE };
        this.isDirty = false;
    }

    /**
     * Initializes the editor, creates its UI, and subscribes to state changes.
     */
    init() {
        this.createPanel();
        imageViewerState.subscribe(this._handleStateChange.bind(this));
    }

    /**
     * Handles changes from the central state manager.
     * @param {object} state - The new state from imageViewerState.
     */
    _handleStateChange(state) {
        const shouldBeVisible = state.activeImage && state.ui.view_mode === 'zoom';
        const isActuallyVisible = this.panelEl && this.panelEl.style.display !== 'none';

        // If the active image in the global state is different from the one the editor is tracking...
        if (state.activeImage && (state.activeImage.path_canon !== this.activeImage?.path_canon)) {
            // ...we must load the new image's edit data to keep the preview state correct for all views.
            this._show(state.activeImage);
        } else if (!state.activeImage && this.activeImage) {
            // The image was deselected globally, clear our state too.
            this._hide();
        }

        // Now, separately, handle the panel's visibility based on the view mode.
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

    /**
     * Creates the editor panel's HTML and attaches it to the main UI.
     */
    createPanel() {
        const editorContainer = document.createElement('div');
        editorContainer.id = 'holaf-viewer-editor-pane';
        editorContainer.style.display = 'none';
        editorContainer.innerHTML = this._getPanelHTML();

        const rightColumn = document.getElementById('holaf-viewer-right-column');
        if (rightColumn) {
            rightColumn.appendChild(editorContainer);
            this.panelEl = editorContainer;
            this._attachListeners();
        } else {
            console.error("[Holaf Editor] Could not find right column to attach editor.");
        }
    }

    /**
     * Shows the editor panel and loads the edits for the given image. (Internal)
     * @param {object} image - The image data object.
     */
    async _show(image) {
        this.activeImage = image;
        this.isDirty = false;

        await this._loadEditsForCurrentImage();
        this._updateButtonStates();
    }

    /**
     * Hides the editor panel. (Internal)
     */
    _hide() {
        if (this.isDirty) {
            // If hiding with unsaved changes, revert the preview
            this.currentState = { ...this.originalState };
            this.applyPreview(); // Re-apply original filters
            this.isDirty = false;
        }

        if (this.panelEl) {
            this.panelEl.style.display = 'none';
        }

        // Clean up filters and rates on exit
        const zoomedImg = document.querySelector('#holaf-viewer-zoom-view img');
        const zoomedVideo = document.querySelector('#holaf-viewer-zoom-view video');
        const fullscreenImg = document.querySelector('#holaf-viewer-fullscreen-overlay img');
        const fullscreenVideo = document.querySelector('#holaf-viewer-fullscreen-overlay video');

        const elements = [zoomedImg, zoomedVideo, fullscreenImg, fullscreenVideo];
        elements.forEach(el => {
            if (el) {
                el.style.filter = 'none';
                if (el.tagName === 'VIDEO') el.playbackRate = 1.0;
            }
        });

        this.activeImage = null;
    }

    /**
     * Fetches edits from the backend for the active image.
     */
    async _loadEditsForCurrentImage() {
        if (!this.activeImage) return;

        this.currentState = { ...DEFAULT_EDIT_STATE };

        if (this.activeImage.has_edit_file) {
            try {
                const response = await fetch(`/holaf/images/load-edits?path_canon=${encodeURIComponent(this.activeImage.path_canon)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 'ok') {
                        this.currentState = { ...DEFAULT_EDIT_STATE, ...data.edits };
                        // Ensure playbackRate is numeric
                        if (typeof this.currentState.playbackRate !== 'number') {
                            this.currentState.playbackRate = 1.0;
                        }
                    }
                }
            } catch (e) {
                console.error("[Holaf Editor] Failed to load edits:", e);
            }
        }
        this.originalState = { ...this.currentState };
        this.isDirty = false;

        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
    }

    /**
     * Applies the current edit state to the zoomed/fullscreen image preview.
     */
    applyPreview() {
        const currentViewMode = imageViewerState.getState().ui.view_mode;
        if (currentViewMode !== 'zoom' && currentViewMode !== 'fullscreen') return;

        const zoomedImg = document.querySelector('#holaf-viewer-zoom-view img');
        const zoomedVideo = document.querySelector('#holaf-viewer-zoom-view video');
        const fullscreenImg = document.querySelector('#holaf-viewer-fullscreen-overlay img');
        const fullscreenVideo = document.querySelector('#holaf-viewer-fullscreen-overlay video');

        const filterValue = `brightness(${this.currentState.brightness}) contrast(${this.currentState.contrast}) saturate(${this.currentState.saturation})`;

        // Helper to apply to a set of elements
        const applyToElements = (elements) => {
            elements.forEach(el => {
                if (el) {
                    el.style.filter = filterValue;
                    if (el.tagName === 'VIDEO') {
                        el.playbackRate = this.currentState.playbackRate;
                    }
                }
            });
        };

        applyToElements([zoomedImg, zoomedVideo, fullscreenImg, fullscreenVideo]);
    }

    /**
     * Public method to check for unsaved changes.
     * @returns {boolean} True if there are unsaved changes.
     */
    hasUnsavedChanges() {
        return this.isDirty;
    }

    /**
     * Public method to trigger a save.
     * @returns {Promise<void>}
     */
    async save() {
        await this._saveEdits();
    }

    /**
     * Calls the backend to regenerate the thumbnail and forces a visual refresh in the gallery.
     * @param {string} pathCanon - The canonical path of the image to refresh.
     */
    async _triggerThumbnailRegeneration(pathCanon) {
        if (!pathCanon) return;
        try {
            console.log(`[Holaf Editor] Triggering thumbnail regeneration for ${pathCanon}`);
            const response = await fetch('/holaf/images/regenerate-thumbnail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: pathCanon })
            });
            if (response.ok) {
                const event = new CustomEvent('holaf-refresh-thumbnail', {
                    detail: { path_canon: pathCanon }
                });
                document.dispatchEvent(event);
            } else {
                console.error("[Holaf Editor] Failed to trigger thumbnail regeneration.", await response.json());
            }
        } catch (e) {
            console.error("[Holaf Editor] Error calling thumbnail regeneration API:", e);
        }
    }

    /**
     * Saves the current edit state to the backend.
     */
    async _saveEdits() {
        if (!this.activeImage || !this.isDirty) return;

        const pathCanonToSave = this.activeImage.path_canon;

        try {
            const response = await fetch('/holaf/images/save-edits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path_canon: pathCanonToSave,
                    edits: this.currentState
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server returned an error: ${response.status} ${response.statusText}. Response: ${errorText}`);
            }

            const result = await response.json();

            if (result.status === 'ok') {
                this.isDirty = false;
                this.originalState = { ...this.currentState };
                this._updateButtonStates();

                const state = imageViewerState.getState();
                let newActiveImage = null;
                const updatedImages = state.images.map(img => {
                    if (img.path_canon === pathCanonToSave) {
                        newActiveImage = { ...img, has_edit_file: true };
                        return newActiveImage;
                    }
                    return img;
                });

                if (newActiveImage) {
                    imageViewerState.setState({ images: updatedImages, activeImage: newActiveImage });
                } else {
                    imageViewerState.setState({ images: updatedImages });
                }

                await this._triggerThumbnailRegeneration(pathCanonToSave);

            } else {
                HolafPanelManager.createDialog({ title: "Save Error", message: `Could not save edits: ${result.message || 'Unknown error from server.'}` });
            }
        } catch (e) {
            console.error("[Holaf Editor] Error saving edits:", e);
            HolafPanelManager.createDialog({ title: "API Error", message: `Failed to save edits. The server response might not be valid. Details: ${e.message}` });
        }
    }

    /**
     * Discards any unsaved changes by reverting to the original state.
     */
    _cancelEdits() {
        if (!this.isDirty) return;
        this.currentState = { ...this.originalState };
        this.isDirty = false;
        this._updateUIFromState();
        this.applyPreview();
        this._updateButtonStates();
    }

    /**
     * Resets edits to default and deletes the .edt file on the backend.
     */
    async _resetEdits() {
        if (!this.activeImage) return;

        const pathCanonToReset = this.activeImage.path_canon;

        if (!await HolafPanelManager.createDialog({
            title: "Confirm Reset",
            message: "Are you sure you want to reset all edits for this image? This will delete the saved .edt file.",
            buttons: [{ text: "Cancel", value: false }, { text: "Reset", value: true, type: "danger" }]
        })) return;

        try {
            const response = await fetch('/holaf/images/delete-edits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: pathCanonToReset })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server returned an error: ${response.status} ${response.statusText}. Response: ${errorText}`);
            }

            const result = await response.json();

            if (result.status === 'ok') {
                this.currentState = { ...DEFAULT_EDIT_STATE };
                this.originalState = { ...DEFAULT_EDIT_STATE };
                this.isDirty = false;
                this._updateUIFromState();
                this.applyPreview();

                const state = imageViewerState.getState();
                let newActiveImage = null;
                const updatedImages = state.images.map(img => {
                    if (img.path_canon === pathCanonToReset) {
                        newActiveImage = { ...img, has_edit_file: false };
                        return newActiveImage;
                    }
                    return img;
                });

                if (newActiveImage) {
                    imageViewerState.setState({ images: updatedImages, activeImage: newActiveImage });
                } else {
                    imageViewerState.setState({ images: updatedImages });
                }

                this._updateButtonStates();

                await this._triggerThumbnailRegeneration(pathCanonToReset);

            } else {
                HolafPanelManager.createDialog({ title: "Reset Error", message: `Could not reset edits: ${result.message || 'Unknown error from server.'}` });
            }
        } catch (e) {
            console.error("[Holaf Editor] Error resetting edits:", e);
            HolafPanelManager.createDialog({ title: "API Error", message: `Failed to reset edits. The server response might not be valid. Details: ${e.message}` });
        }
    }

    /**
     * Updates the UI elements (sliders) to match the current state.
     */
    _updateUIFromState() {
        // Standard filters
        for (const key of ['brightness', 'contrast', 'saturation']) {
            const slider = this.panelEl.querySelector(`#holaf-editor-${key}-slider`);
            const valueEl = this.panelEl.querySelector(`#holaf-editor-${key}-value`);
            if (slider) slider.value = this.currentState[key] * 100;
            if (valueEl) valueEl.textContent = Math.round(this.currentState[key] * 100);
        }

        // Playback Rate (handled slightly differently due to range/step)
        const rateSlider = this.panelEl.querySelector('#holaf-editor-playbackRate-slider');
        const rateValueEl = this.panelEl.querySelector('#holaf-editor-playbackRate-value');
        if (rateSlider) rateSlider.value = this.currentState.playbackRate;
        if (rateValueEl) rateValueEl.textContent = this.currentState.playbackRate.toFixed(1) + 'x';
    }

    /**
     * Enables/disables the save and cancel buttons based on the `isDirty` flag.
     */
    _updateButtonStates() {
        const saveBtn = this.panelEl.querySelector('#holaf-editor-save-btn');
        const cancelBtn = this.panelEl.querySelector('#holaf-editor-cancel-btn');
        if (saveBtn) {
            saveBtn.disabled = !this.isDirty;
        }
        if (cancelBtn) {
            cancelBtn.disabled = !this.isDirty;
        }
    }

    /**
     * Wires up all the event listeners for the editor controls.
     */
    _attachListeners() {
        imageViewerState.subscribe((state, prevState) => {
            if (prevState && state.ui.view_mode !== prevState.ui.view_mode) {
                this.applyPreview();
            }
        });

        // Filter Sliders
        ['brightness', 'contrast', 'saturation'].forEach(key => {
            const sliderContainer = this.panelEl.querySelector(`#holaf-editor-${key}-slider`).parentNode;

            sliderContainer.addEventListener('dblclick', () => {
                const defaultValue = DEFAULT_EDIT_STATE[key];
                this.currentState[key] = defaultValue;

                this.isDirty = true;
                this._updateButtonStates();
                this._updateUIFromState();
                this.applyPreview();
            });

            const slider = sliderContainer.querySelector('input');
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value) / 100;
                    this.currentState[key] = value;
                    const valueEl = sliderContainer.querySelector('.holaf-editor-slider-value');
                    if (valueEl) valueEl.textContent = e.target.value;

                    this.isDirty = true;
                    this._updateButtonStates();
                    this.applyPreview();
                });
            }
        });

        // Playback Rate Slider
        const rateSlider = this.panelEl.querySelector('#holaf-editor-playbackRate-slider');
        const rateContainer = rateSlider ? rateSlider.parentNode : null;
        if (rateSlider && rateContainer) {
            rateContainer.addEventListener('dblclick', () => {
                this.currentState.playbackRate = 1.0;
                this.isDirty = true;
                this._updateButtonStates();
                this._updateUIFromState();
                this.applyPreview();
            });

            rateSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.currentState.playbackRate = value;
                const valueEl = rateContainer.querySelector('.holaf-editor-slider-value');
                if (valueEl) valueEl.textContent = value.toFixed(1) + 'x';

                this.isDirty = true;
                this._updateButtonStates();
                this.applyPreview();
            });
        }

        const saveBtn = this.panelEl.querySelector('#holaf-editor-save-btn');
        const resetBtn = this.panelEl.querySelector('#holaf-editor-reset-btn');
        const cancelBtn = this.panelEl.querySelector('#holaf-editor-cancel-btn');

        if (saveBtn) saveBtn.onclick = () => this._saveEdits();
        if (resetBtn) resetBtn.onclick = () => this._resetEdits();
        if (cancelBtn) cancelBtn.onclick = () => this._cancelEdits();
    }

    /**
     * Generates the inner HTML for the editor panel.
     */
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
                    <button class="holaf-editor-tab" disabled>Operations</button>
                </div>
                <div class="holaf-editor-tab-content">
                    <div class="holaf-editor-section">
                        ${createSlider('brightness', 'Brightness', 0, 200, 1, 100, '100')}
                        ${createSlider('contrast', 'Contrast', 0, 200, 1, 100, '100')}
                        ${createSlider('saturation', 'Saturation', 0, 200, 1, 100, '100')}
                    </div>
                    <div class="holaf-editor-section" style="border-top: 1px solid var(--holaf-border-color); padding-top: 8px; margin-top: 4px;">
                        ${createSlider('playbackRate', 'Playback Speed', 0.1, 4.0, 0.1, 1.0, '1.0x')}
                    </div>
                </div>
                <div class="holaf-editor-footer">
                    <button id="holaf-editor-reset-btn" class="comfy-button" title="Reset all edits for this image">Reset</button>
                    <button id="holaf-editor-cancel-btn" class="comfy-button" title="Discard unsaved changes" disabled>Cancel</button>
                    <button id="holaf-editor-save-btn" class="comfy-button" title="Save changes to .edt file" disabled>Save</button>
                </div>
            </div>
        `;
    }
}