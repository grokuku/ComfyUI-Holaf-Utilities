/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI Module
 *
 * REFACTORED: This module is now an active, state-aware component.
 * It builds the main UI structure, manages its own event listeners,
 * and reacts to changes in the global image viewer state.
 */

import { HOLAF_THEMES } from '../holaf_themes.js';
import { imageViewerState } from './image_viewer_state.js';
import * as Navigation from './image_viewer_navigation.js';
import { HolafToastManager } from '../holaf_toast_manager.js';

class ImageViewerUI {
    constructor() {
        this.elements = {};
        this.callbacks = {};
        this.isDraggingSlider = false; // Flag to prevent state updates while dragging
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
        this.elements.centerPane = this._createCenterPane();
        this.elements.rightColumn = this._createRightColumn();

        // Final assembly
        mainContent.append(this.elements.leftPane, this.elements.centerPane, this.elements.rightColumn);

        this.elements.statusBar = document.createElement('div');
        this.elements.statusBar.id = 'holaf-viewer-statusbar';
        this.elements.statusBar.style.cssText = 'text-align: left; padding: 5px 10px;';

        this.elements.container.append(mainContent, this.elements.statusBar);

        // Cache UI elements that will be updated frequently
        this._cacheElements();
        
        this._setupEventListeners();

        imageViewerState.subscribe(this._render.bind(this));
        this._render(imageViewerState.getState());
    }

    _render(state) {
        const { filters, ui } = state;

        if (!this.elements.searchFilename) return; // UI not cached yet

        // Update Filter Controls
        this.elements.searchFilename.value = filters.filename_search || '';
        this.elements.searchPrompt.value = filters.prompt_search || '';
        this.elements.searchWorkflow.value = filters.workflow_search || '';

        this.elements.dateStart.value = filters.startDate || '';
        this.elements.dateEnd.value = filters.endDate || '';

        // Update boolean filter buttons
        for (const key in this.elements.boolFilterButtons) {
            const button = this.elements.boolFilterButtons[key];
            if (button) {
                button.classList.toggle('active', filters.bool_filters[key] === true);
            }
        }
        
        this._renderActiveTags(filters.tags_filter || []);
        
        // Update Display Options
        if (this.elements.thumbFitToggle) {
            this.elements.thumbFitToggle.checked = ui.thumbnail_fit === 'contain';
        }
        if (this.elements.thumbSizeSlider) {
            if (!this.isDraggingSlider) {
                this.elements.thumbSizeSlider.value = ui.thumbnail_size;
            }
            if (this.elements.thumbSizeValue) {
                this.elements.thumbSizeValue.textContent = `${ui.thumbnail_size}px`;
            }
        }
    }

    _createLeftPane() {
        const pane = document.createElement('div');
        pane.id = 'holaf-viewer-left-pane';
        pane.className = 'holaf-viewer-pane';
        // Reworked HTML structure for the new filter system
        pane.innerHTML = `
            <div class="holaf-viewer-filter-group">
                <h4>Filename Search</h4>
                <input type="search" id="holaf-viewer-search-filename" placeholder="Enter filename text..." class="holaf-viewer-search-bar">
            </div>
            <div class="holaf-viewer-filter-group">
                <h4>Prompt Search</h4>
                <input type="search" id="holaf-viewer-search-prompt" placeholder="Enter prompt text..." class="holaf-viewer-search-bar">
            </div>
            <div class="holaf-viewer-filter-group">
                <h4>Workflow Search</h4>
                <input type="search" id="holaf-viewer-search-workflow" placeholder="Enter workflow text..." class="holaf-viewer-search-bar">
            </div>
            <div class="holaf-viewer-filter-group">
                <h4>Date Range</h4>
                <div class="holaf-viewer-date-range-container">
                    <div class="holaf-viewer-date-input-group"><label for="holaf-viewer-date-start">From:</label><input type="date" id="holaf-viewer-date-start"></div>
                    <div class="holaf-viewer-date-input-group"><label for="holaf-viewer-date-end">To:</label><input type="date" id="holaf-viewer-date-end"></div>
                </div>
            </div>
            <div class="holaf-viewer-filter-group">
                <h4>Tags (AND logic)</h4>
                <div id="holaf-viewer-tags-filter-container">
                    <div id="holaf-viewer-active-tags" class="holaf-viewer-active-tags-container"></div>
                    <input type="text" id="holaf-viewer-tag-input" list="holaf-viewer-tag-suggestions" placeholder="Add a tag..." class="holaf-viewer-search-bar">
                    <datalist id="holaf-viewer-tag-suggestions"></datalist>
                </div>
            </div>
            <div class="holaf-viewer-filter-group">
                <h4>Metadata & Sidecars</h4>
                <div id="holaf-viewer-bool-filters" class="holaf-viewer-button-grid">
                    <button class="holaf-viewer-toggle-button" id="holaf-bool-filter-has-workflow" data-filterkey="has_workflow">Workflow</button>
                    <button class="holaf-viewer-toggle-button" id="holaf-bool-filter-has-prompt" data-filterkey="has_prompt">Prompt</button>
                    <button class="holaf-viewer-toggle-button" id="holaf-bool-filter-has-edits" data-filterkey="has_edits">Edits</button>
                    <button class="holaf-viewer-toggle-button" id="holaf-bool-filter-has-tags" data-filterkey="has_tags">Tags</button>
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
    
    _cacheElements() {
        this.elements.searchFilename = this.elements.leftPane.querySelector('#holaf-viewer-search-filename');
        this.elements.searchPrompt = this.elements.leftPane.querySelector('#holaf-viewer-search-prompt');
        this.elements.searchWorkflow = this.elements.leftPane.querySelector('#holaf-viewer-search-workflow');
        this.elements.dateStart = this.elements.leftPane.querySelector('#holaf-viewer-date-start');
        this.elements.dateEnd = this.elements.leftPane.querySelector('#holaf-viewer-date-end');
        this.elements.tagInput = this.elements.leftPane.querySelector('#holaf-viewer-tag-input');
        this.elements.activeTagsContainer = this.elements.leftPane.querySelector('#holaf-viewer-active-tags');
        this.elements.boolFiltersContainer = this.elements.leftPane.querySelector('#holaf-viewer-bool-filters');
        
        // Cache buttons instead of checkboxes
        this.elements.boolFilterButtons = {
            has_workflow: this.elements.leftPane.querySelector('#holaf-bool-filter-has-workflow'),
            has_prompt: this.elements.leftPane.querySelector('#holaf-bool-filter-has-prompt'),
            has_edits: this.elements.leftPane.querySelector('#holaf-bool-filter-has-edits'),
            has_tags: this.elements.leftPane.querySelector('#holaf-bool-filter-has-tags'),
        };

        this.elements.thumbFitToggle = this.elements.leftPane.querySelector('#holaf-viewer-thumb-fit-toggle');
        this.elements.thumbSizeSlider = this.elements.leftPane.querySelector('#holaf-viewer-thumb-size-slider');
        this.elements.thumbSizeValue = this.elements.leftPane.querySelector('#holaf-viewer-thumb-size-value');
    }

    _setupEventListeners() {
        const viewer = this.callbacks.getViewer();

        this.elements.leftPane.querySelector('#holaf-viewer-btn-reset-filters').onclick = () => {
            this.callbacks.onResetFilters();
        };

        // Text search inputs
        const onSearchInput = () => this.callbacks.onFilterChange();
        this.elements.searchFilename.oninput = onSearchInput;
        this.elements.searchPrompt.oninput = onSearchInput;
        this.elements.searchWorkflow.oninput = onSearchInput;
        
        // Date inputs
        const onDateChange = () => this.callbacks.onFilterChange();
        this.elements.dateStart.onchange = onDateChange;
        this.elements.dateEnd.onchange = onDateChange;

        // Boolean filters (now using click on buttons)
        this.elements.boolFiltersContainer.onclick = (e) => {
            if (e.target.matches('button')) {
                const key = e.target.dataset.filterkey;
                const currentFilters = imageViewerState.getState().filters;

                // Flip the state: true becomes null, anything else becomes true
                const currentValue = currentFilters.bool_filters[key];
                const newValue = currentValue === true ? null : true;
                
                const newBoolFilters = { ...currentFilters.bool_filters, [key]: newValue };
                imageViewerState.setState({ filters: { ...currentFilters, bool_filters: newBoolFilters } });
                

                this.callbacks.onFilterChange();
            }
        };

        // Tag filter input
        this.elements.tagInput.onkeydown = (e) => {
            if (e.key === 'Enter' && this.elements.tagInput.value.trim() !== '') {
                e.preventDefault();
                const newTag = this.elements.tagInput.value.trim();
                const currentFilters = imageViewerState.getState().filters;
                const currentTags = currentFilters.tags_filter || [];

                if (!currentTags.includes(newTag)) {
                    const newTags = [...currentTags, newTag];
                    imageViewerState.setState({ filters: { ...currentFilters, tags_filter: newTags } });
                    this.callbacks.onFilterChange();
                }
                this.elements.tagInput.value = '';
            }
        };

        // Remove tags by clicking them
        this.elements.activeTagsContainer.onclick = (e) => {
            if (e.target.matches('.holaf-viewer-tag-remove')) {
                const tagToRemove = e.target.parentElement.dataset.tag;
                const currentFilters = imageViewerState.getState().filters;
                const newTags = (currentFilters.tags_filter || []).filter(t => t !== tagToRemove);
                
                imageViewerState.setState({ filters: { ...currentFilters, tags_filter: newTags } });
                this.callbacks.onFilterChange();
            }
        };

        // Folder filters
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

        // Display Options
        this.elements.thumbFitToggle.onchange = (e) => {
            const newFit = e.target.checked ? 'contain' : 'cover';
            viewer.saveSettings({ thumbnail_fit: newFit });
            viewer._applyThumbnailFit();
        };

        // `oninput` is for real-time visual updates *during* sliding.
        this.elements.thumbSizeSlider.oninput = (e) => {
            this.isDraggingSlider = true;
            const newSize = parseInt(e.target.value);
            this.elements.thumbSizeValue.textContent = `${newSize}px`;
            viewer._applyThumbnailSize(newSize);
        };

        // `onchange` fires only when the user releases the slider.
        // This is the correct time to save the final setting.
        this.elements.thumbSizeSlider.onchange = (e) => {
            this.isDraggingSlider = false;
            const newSize = parseInt(e.target.value);
            viewer.saveSettings({ thumbnail_size: newSize });
        };
        
        // Center Pane (Zoom View) Listeners
        const zoomView = this.elements.centerPane.querySelector('#holaf-viewer-zoom-view');
        const zoomImage = zoomView.querySelector('img');
        this.elements.centerPane.querySelector('.holaf-viewer-zoom-close').onclick = () => viewer._hideZoomedView();
        this.elements.centerPane.querySelector('.holaf-viewer-zoom-fullscreen-icon').onclick = () => viewer._showFullscreenView();
        zoomImage.ondblclick = () => viewer._showFullscreenView();
        zoomImage.onclick = (e) => e.stopPropagation();

        Navigation.setupZoomAndPan(viewer.zoomViewState, zoomView, zoomImage);
    }
    
    _renderActiveTags(tags) {
        if (!this.elements.activeTagsContainer) return;
        this.elements.activeTagsContainer.innerHTML = '';
        tags.forEach(tag => {
            const tagEl = document.createElement('div');
            tagEl.className = 'holaf-viewer-active-tag';
            tagEl.dataset.tag = tag;
            tagEl.innerHTML = `
                <span>${tag}</span>
                <button class="holaf-viewer-tag-remove" title="Remove tag">×</button>
            `;
            this.elements.activeTagsContainer.appendChild(tagEl);
        });
    }
}

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

export const UI = new ImageViewerUI();