/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI Module
 *
 * REFACTORED: This module is now an active, state-aware component.
 * It builds the main UI structure, manages its own event listeners,
 * and reacts to changes in the global image viewer state.
 */

import { HOLAF_THEMES } from '../holaf_panel_manager.js';
import { imageViewerState } from './image_viewer_state.js';
import * as Navigation from './image_viewer_navigation.js';
import { HolafToastManager } from '../holaf_toast_manager.js';

class ImageViewerUI {
    constructor() {
        this.elements = {};
        this.callbacks = {};
    }

    init(container, callbacks) {
        this.callbacks = callbacks; // { getViewer, onFilterChange, onResetFilters, onEmptyTrash }

        // Build the main structure
        this.elements.container = container;
        this.elements.container.innerHTML = ''; // Clear previous content
        this.elements.container.style.display = 'flex';
        this.elements.container.style.flexDirection = 'column';
        this.elements.container.style.flexGrow = '1';

        const mainContent = document.createElement('div');
        mainContent.className = 'holaf-viewer-container';
        mainContent.style.flexGrow = '1';

        // Create panes
        this.elements.leftPane = this._createLeftPane();
        this.elements.centerPane = this._createCenterPane(); // Simplified: only one center pane
        this.elements.rightColumn = this._createRightColumn();

        // Final assembly
        mainContent.append(this.elements.leftPane, this.elements.centerPane, this.elements.rightColumn);

        this.elements.statusBar = document.createElement('div');
        this.elements.statusBar.id = 'holaf-viewer-statusbar';
        this.elements.statusBar.style.cssText = 'text-align: left; padding: 5px 10px;';

        this.elements.container.append(mainContent, this.elements.statusBar);

        this._setupEventListeners();

        // Subscribe to state changes to reactively update UI controls
        imageViewerState.subscribe(this._render.bind(this));

        // Initial render based on current state
        this._render(imageViewerState.getState());
    }

    // This render function is now much simpler. It only updates UI controls,
    // it DOES NOT manage view visibility, as that is handled by other modules (Navigation, Editor).
    _render(state) {
        // Update display options from state
        if (this.elements.thumbFitToggle) {
            this.elements.thumbFitToggle.checked = state.ui.thumbnail_fit === 'contain';
        }
        if (this.elements.thumbSizeSlider) {
            // Only update the slider's visual position if the user is NOT currently dragging it.
            // This prevents the state update (which happens on `onchange`) from causing a visual jump during `oninput`.
            if (!this.isDraggingSlider) {
                this.elements.thumbSizeSlider.value = state.ui.thumbnail_size;
            }
            if (this.elements.thumbSizeValue) {
                this.elements.thumbSizeValue.textContent = `${state.ui.thumbnail_size}px`;
            }
        }
    }

    _createLeftPane() {
        const pane = document.createElement('div');
        pane.id = 'holaf-viewer-left-pane';
        pane.className = 'holaf-viewer-pane';
        pane.innerHTML = `
            <div class="holaf-viewer-filter-group">
                <input type="search" id="holaf-viewer-search-input" placeholder="Search filename, prompt, workflow..." class="holaf-viewer-search-bar">
                <div id="holaf-viewer-search-scope-buttons" class="holaf-viewer-toggle-button-group">
                    <button id="holaf-search-scope-filename" class="holaf-viewer-toggle-button">Name</button>
                    <button id="holaf-search-scope-prompt" class="holaf-viewer-toggle-button">Prompt</button>
                    <button id="holaf-search-scope-workflow" class="holaf-viewer-toggle-button">Workflow</button>
                </div>
            </div>
            <div class="holaf-viewer-filter-group">
                <h4>Date Range</h4>
                <div id="holaf-viewer-date-filter" class="holaf-viewer-date-range-container">
                    <div class="holaf-viewer-date-input-group"><label for="holaf-viewer-date-start">From:</label><input type="date" id="holaf-viewer-date-start"></div>
                    <div class="holaf-viewer-date-input-group"><label for="holaf-viewer-date-end">To:</label><input type="date" id="holaf-viewer-date-end"></div>
                </div>
            </div>
            <div class="holaf-viewer-filter-group">
                <h4>Workflow Availability</h4>
                <div id="holaf-viewer-workflow-filter-buttons" class="holaf-viewer-toggle-button-group">
                    <button id="holaf-workflow-filter-internal" class="holaf-viewer-toggle-button">Internal</button>
                    <button id="holaf-workflow-filter-external" class="holaf-viewer-toggle-button">External</button>
                    <button id="holaf-workflow-filter-none" class="holaf-viewer-toggle-button">None</button>
                </div>
            </div>
            <div class="holaf-viewer-filter-group holaf-viewer-scrollable-section">
                <div class="holaf-viewer-filter-header">
                    <h4>Folders</h4>
                    <div class="holaf-viewer-folder-actions">
                        <a href="#" id="holaf-viewer-folders-select-all">All</a><span class="holaf-folder-separator">/</span><a href="#" id="holaf-viewer-folders-select-none">None</a><span class="holaf-folder-separator">/</span><a href="#" id="holaf-viewer-folders-select-invert">Invert</a>
                    </div>
                </div>
                <div id="holaf-viewer-folders-filter" class="holaf-viewer-filter-list"><p class="holaf-viewer-message"><em>Loading...</em></p></div>
            </div>
            <div class="holaf-viewer-fixed-sections">
                <div class="holaf-viewer-filter-group">
                    <h4>Formats</h4>
                    <div id="holaf-viewer-formats-filter" class="holaf-viewer-filter-list"></div>
                </div>
                <div class="holaf-viewer-actions-group">
                    <h4>Actions</h4>
                    <div class="holaf-viewer-actions-buttons-container">
                         <div class="holaf-viewer-action-button-row">
                            <button id="holaf-viewer-btn-delete" class="holaf-viewer-action-button" disabled title="Move selected to trashcan">🗑️ Delete</button>
                            <button id="holaf-viewer-btn-restore" class="holaf-viewer-action-button" disabled title="Restore selected from trashcan">♻️ Restore</button>
                        </div>
                        <div class="holaf-viewer-action-button-row">
                            <button id="holaf-viewer-btn-extract" class="holaf-viewer-action-button" disabled title="Extract metadata to .txt/.json and remove from image"> जाये Extract</button>
                            <button id="holaf-viewer-btn-inject" class="holaf-viewer-action-button" disabled title="Inject metadata from .txt/.json into image">💉 Inject</button>
                        </div>
                         <div class="holaf-viewer-action-button-row">
                            <button id="holaf-viewer-btn-export" class="holaf-viewer-action-button" disabled title="Export selected images">📤 Export</button>
                            <button id="holaf-viewer-btn-reset-filters" class="holaf-viewer-action-button" title="Reset all filters to their default values">🔄 Reset</button>
                        </div>
                    </div>
                </div>
                <div class="holaf-viewer-display-options">
                    <h4>Display Options</h4>
                    <div class="holaf-viewer-filter-list">
                       <div class="holaf-viewer-filter-item"><input type="checkbox" id="holaf-viewer-thumb-fit-toggle"><label for="holaf-viewer-thumb-fit-toggle">Contained (no crop)</label></div>
                       <div class="holaf-viewer-slider-container"><label for="holaf-viewer-thumb-size-slider">Size</label><input type="range" id="holaf-viewer-thumb-size-slider" min="80" max="300" step="10"><span id="holaf-viewer-thumb-size-value">150px</span></div>
                    </div>
                </div>
            </div>
        `;
        return pane;
    }

    _createCenterPane() {
        const pane = document.createElement('div');
        pane.id = 'holaf-viewer-center-pane';
        pane.className = 'holaf-viewer-pane';
        // This pane now contains the containers for BOTH the gallery and the zoom view.
        // Their visibility is controlled by other modules, not this UI module.
        pane.innerHTML = `
            <div id="holaf-viewer-toolbar"></div>
            <div id="holaf-viewer-gallery"><p class="holaf-viewer-message">Loading images...</p></div>
            <div id="holaf-viewer-zoom-view" style="display: none;">
                <button class="holaf-viewer-zoom-close" title="Close (or double-click image)">✖</button>
                <img src="" />
                <button class="holaf-viewer-zoom-fullscreen-icon" title="Enter fullscreen">⛶</button>
            </div>
        `;
        return pane;
    }

    _createRightColumn() {
        const col = document.createElement('div');
        col.id = 'holaf-viewer-right-column';
        // This column will contain BOTH the info pane and the editor pane as siblings.
        // Their respective modules will control their visibility.
        col.innerHTML = `
            <div id="holaf-viewer-right-pane" class="holaf-viewer-pane">
                <h4>Image Information</h4>
                <div id="holaf-viewer-info-content">
                    <p class="holaf-viewer-message">Select an image to see details.</p>
                </div>
            </div>
        `;
        return col;
    }

    _setupEventListeners() {
        const viewer = this.callbacks.getViewer();

        // --- Left Pane Listeners ---

        // Find the new reset button in the Actions section
        this.elements.leftPane.querySelector('#holaf-viewer-btn-reset-filters').onclick = (e) => {
            this.callbacks.onResetFilters();
        };

        const searchInputEl = this.elements.leftPane.querySelector('#holaf-viewer-search-input');
        searchInputEl.oninput = () => {
            this.callbacks.onFilterChange();
        };

        const createScopeClickHandler = (scopeKey) => () => {
            const currentFilters = imageViewerState.getState().filters;
            const newScopeState = { [scopeKey]: !currentFilters[scopeKey] };

            // Save the setting, which also updates the central state
            viewer.saveSettings(newScopeState);

            // Immediately update the button's visual state for instant feedback
            viewer._updateSearchScopeButtonStates();

            // Only trigger a full filter reload if there is text in the search bar
            if (searchInputEl.value.trim() !== "") {
                this.callbacks.onFilterChange();
            }
        };
        this.elements.leftPane.querySelector('#holaf-search-scope-filename').onclick = createScopeClickHandler('search_scope_name');
        this.elements.leftPane.querySelector('#holaf-search-scope-prompt').onclick = createScopeClickHandler('search_scope_prompt');
        this.elements.leftPane.querySelector('#holaf-search-scope-workflow').onclick = createScopeClickHandler('search_scope_workflow');

        this.elements.leftPane.querySelector('#holaf-workflow-filter-internal').onclick = () => {
            const currentFilters = imageViewerState.getState().filters;
            viewer.saveSettings({ workflow_filter_internal: !currentFilters.workflow_filter_internal });
            viewer._updateWorkflowButtonStates();
            this.callbacks.onFilterChange();
        };
        this.elements.leftPane.querySelector('#holaf-workflow-filter-external').onclick = () => {
            const currentFilters = imageViewerState.getState().filters;
            viewer.saveSettings({ workflow_filter_external: !currentFilters.workflow_filter_external });
            viewer._updateWorkflowButtonStates();
            this.callbacks.onFilterChange();
        };
        this.elements.leftPane.querySelector('#holaf-workflow-filter-none').onclick = () => {
            const currentFilters = imageViewerState.getState().filters;
            viewer.saveSettings({ workflow_filter_none: !currentFilters.workflow_filter_none });
            viewer._updateWorkflowButtonStates();
            this.callbacks.onFilterChange();
        };

        this.elements.leftPane.querySelector('#holaf-viewer-folders-select-all').onclick = (e) => {
            e.preventDefault();
            const { locked_folders } = imageViewerState.getState().filters;
            this.elements.leftPane.querySelectorAll('#holaf-viewer-folders-filter input[type="checkbox"]:not(#folder-filter-trashcan)').forEach(cb => {
                const folderId = cb.closest('.holaf-viewer-filter-item')?.dataset.folderId;
                if (!cb.disabled && !locked_folders.includes(folderId)) {
                    cb.checked = true;
                }
            });
            this.callbacks.onFilterChange();
        };
        this.elements.leftPane.querySelector('#holaf-viewer-folders-select-none').onclick = (e) => {
            e.preventDefault();
            const { locked_folders } = imageViewerState.getState().filters;
            this.elements.leftPane.querySelectorAll('#holaf-viewer-folders-filter input[type="checkbox"]:not(#folder-filter-trashcan)').forEach(cb => {
                const folderId = cb.closest('.holaf-viewer-filter-item')?.dataset.folderId;
                if (!cb.disabled && !locked_folders.includes(folderId)) {
                    cb.checked = false;
                }
            });
            this.callbacks.onFilterChange();
        };
        this.elements.leftPane.querySelector('#holaf-viewer-folders-select-invert').onclick = (e) => {
            e.preventDefault();
            const { locked_folders } = imageViewerState.getState().filters;
            this.elements.leftPane.querySelectorAll('#holaf-viewer-folders-filter input[type="checkbox"]:not(#folder-filter-trashcan)').forEach(cb => {
                const folderId = cb.closest('.holaf-viewer-filter-item')?.dataset.folderId;
                if (!cb.disabled && !locked_folders.includes(folderId)) {
                    cb.checked = !cb.checked;
                }
            });
            this.callbacks.onFilterChange();
        };

        this.elements.leftPane.querySelector('#holaf-viewer-date-start').onchange = (e) => {
            this.callbacks.onFilterChange();
        };
        this.elements.leftPane.querySelector('#holaf-viewer-date-end').onchange = (e) => {
            this.callbacks.onFilterChange();
        };

        // --- Display Options ---
        this.elements.thumbFitToggle = this.elements.leftPane.querySelector('#holaf-viewer-thumb-fit-toggle');
        this.elements.thumbFitToggle.onchange = (e) => {
            const newFit = e.target.checked ? 'contain' : 'cover';
            viewer.saveSettings({ thumbnail_fit: newFit });
            viewer._applyThumbnailFit();
        };

        this.elements.thumbSizeSlider = this.elements.leftPane.querySelector('#holaf-viewer-thumb-size-slider');
        this.elements.thumbSizeValue = this.elements.leftPane.querySelector('#holaf-viewer-thumb-size-value');

        // `oninput` is for real-time visual updates *during* sliding.
        this.elements.thumbSizeSlider.oninput = (e) => {
            const newSize = parseInt(e.target.value);
            // Update the text label instantly.
            this.elements.thumbSizeValue.textContent = `${newSize}px`;
            // Call the coordinator's function, passing the live size value directly.
            // This bypasses the central state and forces an immediate re-render.
            viewer._applyThumbnailSize(newSize);
        };

        // `onchange` fires only when the user releases the slider.
        // This is the correct time to save the final setting.
        this.elements.thumbSizeSlider.onchange = (e) => {
            const newSize = parseInt(e.target.value);
            viewer.saveSettings({ thumbnail_size: newSize });
        };

        // --- Center Pane (Zoom View) Listeners ---
        const zoomView = this.elements.centerPane.querySelector('#holaf-viewer-zoom-view');
        const zoomImage = zoomView.querySelector('img');
        this.elements.centerPane.querySelector('.holaf-viewer-zoom-close').onclick = () => viewer._hideZoomedView();
        this.elements.centerPane.querySelector('.holaf-viewer-zoom-fullscreen-icon').onclick = () => viewer._showFullscreenView();
        zoomImage.ondblclick = () => viewer._showFullscreenView();
        zoomImage.onclick = (e) => e.stopPropagation();

        Navigation.setupZoomAndPan(viewer.zoomViewState, zoomView, zoomImage);
    }
}

/**
 * Creates the theme selection menu.
 * @param {function(string): void} setThemeCallback - The function to call when a theme is selected.
 * @returns {HTMLUListElement} The theme menu element.
 */
export function createThemeMenu(setThemeCallback) {
    const menu = document.createElement("ul");
    menu.className = "holaf-theme-menu";
    HOLAF_THEMES.forEach(theme => {
        const item = document.createElement("li");
        item.textContent = theme.name;
        item.onclick = (e) => {
            e.stopPropagation();
            setThemeCallback(theme.name);
            menu.style.display = 'none';
        };
        menu.appendChild(item);
    });
    return menu;
}


// Export a single instance (Singleton) for the entire application
export const UI = new ImageViewerUI();