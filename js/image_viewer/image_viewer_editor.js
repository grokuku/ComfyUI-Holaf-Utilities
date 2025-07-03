/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Editor Module
 *
 * This module manages the image editing panel, its state,
 * and interactions with the backend for saving/loading edits.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";

const DEFAULT_EDIT_STATE = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
};

export class ImageEditor {
    constructor(viewer) {
        this.viewer = viewer; // Reference to the main image viewer instance
        this.panelEl = null;
        this.activeImage = null;
        this.currentState = { ...DEFAULT_EDIT_STATE };
        this.isDirty = false; // Tracks if there are unsaved changes
    }

    /**
     * Creates the editor panel's HTML and attaches it to the main UI.
     */
    createPanel() {
        const editorContainer = document.createElement('div');
        editorContainer.id = 'holaf-viewer-editor-pane';
        // editorContainer.className = 'holaf-viewer-pane'; // This class is not needed here
        editorContainer.style.display = 'none'; // Initially hidden
        editorContainer.innerHTML = this._getPanelHTML();

        // --- MODIFICATION START: Correctly append the editor to the right column ---
        const rightColumn = document.getElementById('holaf-viewer-right-column');
        if (rightColumn) {
            rightColumn.appendChild(editorContainer);
            this.panelEl = editorContainer;
            this._attachListeners();
        } else {
            console.error("[Holaf Editor] Could not find right column to attach editor.");
        }
        // --- MODIFICATION END ---
    }

    /**
     * Shows the editor panel and loads the edits for the given image.
     * @param {object} image - The image data object.
     */
    async show(image) {
        if (!this.panelEl) this.createPanel();

        this.activeImage = image;
        this.panelEl.style.display = 'block';
        this.isDirty = false;

        await this._loadEditsForCurrentImage();
        this._updateSaveButtonState();
    }

    /**
     * Hides the editor panel.
     */
    hide() {
        if (this.panelEl) {
            this.panelEl.style.display = 'none';
        }
        this.activeImage = null;
    }

    /**
     * Fetches edits from the backend for the active image.
     */
    async _loadEditsForCurrentImage() {
        if (!this.activeImage) return;

        // Reset to default state before loading
        this.currentState = { ...DEFAULT_EDIT_STATE };

        if (this.activeImage.has_edit_file) {
            try {
                const response = await fetch(`/holaf/images/load-edits?path_canon=${encodeURIComponent(this.activeImage.path_canon)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 'ok') {
                        this.currentState = { ...DEFAULT_EDIT_STATE, ...data.edits };
                    }
                }
            } catch (e) {
                console.error("[Holaf Editor] Failed to load edits:", e);
            }
        }
        this._updateUIFromState();
        this.applyPreview();
    }

    /**
     * Applies the current edit state to the zoomed/fullscreen image preview.
     */
    applyPreview() {
        if (!this.viewer.activeImage) return;

        const zoomedImg = document.querySelector('#holaf-viewer-zoom-view img');
        const fullscreenImg = this.viewer.fullscreenElements?.img;

        const filterValue = `brightness(${this.currentState.brightness}) contrast(${this.currentState.contrast}) saturate(${this.currentState.saturation})`;

        if (zoomedImg) zoomedImg.style.filter = filterValue;
        if (fullscreenImg) fullscreenImg.style.filter = filterValue;
    }

    /**
     * Saves the current edit state to the backend.
     */
    async _saveEdits() {
        if (!this.activeImage) return;

        try {
            const response = await fetch('/holaf/images/save-edits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path_canon: this.activeImage.path_canon,
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
                this._updateSaveButtonState();
                this.activeImage.has_edit_file = true;

                const imageInList = this.viewer.filteredImages.find(img => img.path_canon === this.activeImage.path_canon);
                if (imageInList) imageInList.has_edit_file = true;

                this.viewer.updateStatusBar(null, false);
            } else {
                HolafPanelManager.createDialog({ title: "Save Error", message: `Could not save edits: ${result.message || 'Unknown error from server.'}` });
            }
        } catch (e) {
            console.error("[Holaf Editor] Error saving edits:", e);
            HolafPanelManager.createDialog({ title: "API Error", message: `Failed to save edits. The server response might not be valid. Details: ${e.message}` });
        }
    }

    /**
     * Resets edits to default and deletes the .edt file on the backend.
     */
    async _resetEdits() {
        if (!this.activeImage) return;

        if (!await HolafPanelManager.createDialog({
            title: "Confirm Reset",
            message: "Are you sure you want to reset all edits for this image? This will delete the saved .edt file.",
            buttons: [{ text: "Cancel", value: false }, { text: "Reset", value: true, type: "danger" }]
        })) return;

        try {
            const response = await fetch('/holaf/images/delete-edits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path_canon: this.activeImage.path_canon })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server returned an error: ${response.status} ${response.statusText}. Response: ${errorText}`);
            }

            const result = await response.json();

            if (result.status === 'ok') {
                this.currentState = { ...DEFAULT_EDIT_STATE };
                this.isDirty = false;
                this._updateUIFromState();
                this.applyPreview();
                this.activeImage.has_edit_file = false;

                const imageInList = this.viewer.filteredImages.find(img => img.path_canon === this.activeImage.path_canon);
                if (imageInList) imageInList.has_edit_file = false;

                this._updateSaveButtonState();
                this.viewer.updateStatusBar(null, false);
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
        for (const key of ['brightness', 'contrast', 'saturation']) {
            const slider = this.panelEl.querySelector(`#holaf-editor-${key}-slider`);
            const valueEl = this.panelEl.querySelector(`#holaf-editor-${key}-value`);
            if (slider) slider.value = this.currentState[key] * 100;
            if (valueEl) valueEl.textContent = Math.round(this.currentState[key] * 100);
        }
    }

    /**
     * Enables/disables the save button based on the `isDirty` flag.
     */
    _updateSaveButtonState() {
        const saveBtn = this.panelEl.querySelector('#holaf-editor-save-btn');
        if (saveBtn) {
            saveBtn.disabled = !this.isDirty;
        }
    }

    /**
     * Wires up all the event listeners for the editor controls.
     */
    _attachListeners() {
        // --- MODIFICATION: Add dblclick to reset sliders ---
        ['brightness', 'contrast', 'saturation'].forEach(key => {
            const sliderContainer = this.panelEl.querySelector(`#holaf-editor-${key}-slider`).parentNode;

            sliderContainer.addEventListener('dblclick', () => {
                const defaultValue = DEFAULT_EDIT_STATE[key];
                this.currentState[key] = defaultValue;

                this.isDirty = true;
                this._updateSaveButtonState();
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
                    this._updateSaveButtonState();
                    this.applyPreview();
                });
            }
        });

        // Main buttons
        const saveBtn = this.panelEl.querySelector('#holaf-editor-save-btn');
        const resetBtn = this.panelEl.querySelector('#holaf-editor-reset-btn');
        if (saveBtn) saveBtn.onclick = () => this._saveEdits();
        if (resetBtn) resetBtn.onclick = () => this._resetEdits();
    }

    /**
     * Generates the inner HTML for the editor panel.
     */
    _getPanelHTML() {
        const createSlider = (name, label, min, max, step, value) => `
            <div class="holaf-editor-slider-container">
                <label for="holaf-editor-${name}-slider">${label}</label>
                <input type="range" id="holaf-editor-${name}-slider" min="${min}" max="${max}" step="${step}" value="${value}">
                <span id="holaf-editor-${name}-value" class="holaf-editor-slider-value">${value}</span>
            </div>
        `;

        return `
            <h4>Image Editor</h4>
            <div id="holaf-editor-content">
                <div class="holaf-editor-tabs">
                    <button class="holaf-editor-tab active">Adjust</button>
                    <button class="holaf-editor-tab" disabled>Crop/Ratio</button>
                    <button class="holaf-editor-tab" disabled>Effects</button>
                    <button class="holaf-editor-tab">Operations</button>
                </div>
                <div class="holaf-editor-tab-content">
                    <!-- Adjustments Tab -->
                    <div class="holaf-editor-section">
                        ${createSlider('brightness', 'Brightness', 0, 200, 1, 100)}
                        ${createSlider('contrast', 'Contrast', 0, 200, 1, 100)}
                        ${createSlider('saturation', 'Saturation', 0, 200, 1, 100)}
                    </div>
                </div>
                <div class="holaf-editor-footer">
                    <button id="holaf-editor-reset-btn" class="comfy-button" title="Reset all edits for this image">Reset</button>
                    <button id="holaf-editor-save-btn" class="comfy-button" title="Save changes to .edt file" disabled>Save</button>
                </div>
            </div>
        `;
    }
}