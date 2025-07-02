/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI Module
 *
 * This module is responsible for generating the static HTML content
 * and UI components for the Holaf Image Viewer panel.
 */

import { HOLAF_THEMES } from '../holaf_panel_manager.js';

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

/**
 * Returns the inner HTML for the main panel content area.
 * @returns {string} The HTML string for the panel content.
 */
export function getPanelHTML() {
    return `
        <div class="holaf-viewer-container" style="flex-grow: 1;">
            <div id="holaf-viewer-left-pane" class="holaf-viewer-pane">

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
                        <div class="holaf-viewer-date-input-group">
                            <label for="holaf-viewer-date-start">From:</label>
                            <input type="date" id="holaf-viewer-date-start">
                        </div>
                        <div class="holaf-viewer-date-input-group">
                            <label for="holaf-viewer-date-end">To:</label>
                            <input type="date" id="holaf-viewer-date-end">
                        </div>
                    </div>
                </div>

                <div class="holaf-viewer-filter-group">
                    <h4>Workflow Availability</h4>
                    <div id="holaf-viewer-workflow-filter-buttons" class="holaf-viewer-toggle-button-group">
                        <button id="holaf-workflow-filter-internal" class="holaf-viewer-toggle-button">Internal</button>
                        <button id="holaf-workflow-filter-external" class="holaf-viewer-toggle-button">External</button>
                    </div>
                </div>

                <div class="holaf-viewer-filter-group holaf-viewer-scrollable-section">
                    <div class="holaf-viewer-filter-header">
                        <h4>Folders</h4>
                        <div class="holaf-viewer-folder-actions">
                            <a href="#" id="holaf-viewer-folders-select-all">All</a>
                            <span class="holaf-folder-separator">/</span>
                            <a href="#" id="holaf-viewer-folders-select-none">None</a>
                        </div>
                    </div>
                    <div id="holaf-viewer-folders-filter" class="holaf-viewer-filter-list">
                        <p class="holaf-viewer-message"><em>Loading...</em></p>
                    </div>
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
                                <button id="holaf-viewer-btn-import" class="holaf-viewer-action-button" disabled title="Import images (coming soon)">📥 Import</button>
                            </div>
                        </div>
                    </div>

                    <div class="holaf-viewer-display-options">
                        <h4>Display Options</h4>
                        <div class="holaf-viewer-filter-list">
                           <div class="holaf-viewer-filter-item">
                                <input type="checkbox" id="holaf-viewer-thumb-fit-toggle">
                                <label for="holaf-viewer-thumb-fit-toggle">Contained (no crop)</label>
                           </div>
                           <div class="holaf-viewer-slider-container">
                               <label for="holaf-viewer-thumb-size-slider">Size</label>
                               <input type="range" id="holaf-viewer-thumb-size-slider" min="80" max="300" step="10">
                               <span id="holaf-viewer-thumb-size-value">150px</span>
                           </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="holaf-viewer-center-pane" class="holaf-viewer-pane">
                <div id="holaf-viewer-toolbar"></div>
                <div id="holaf-viewer-gallery">
                    <p class="holaf-viewer-message">Loading images...</p>
                </div>
                <div id="holaf-viewer-zoom-view" style="display: none;">
                    <button class="holaf-viewer-zoom-close" title="Close (or double-click image)">✖</button>
                    <img src="" />
                    <button class="holaf-viewer-zoom-fullscreen-icon" title="Enter fullscreen">⛶</button>
                </div>
            </div>
            <div id="holaf-viewer-right-pane" class="holaf-viewer-pane">
                <h4>Image Information</h4>
                <div id="holaf-viewer-info-content">
                    <p class="holaf-viewer-message">Select an image to see details.</p>
                </div>
            </div>
        </div>
        <div id="holaf-viewer-statusbar" style="text-align: left; padding: 5px 10px;"></div>
    `;
}