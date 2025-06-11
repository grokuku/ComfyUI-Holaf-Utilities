/*
 * Copyright (C) 2025 Holaf
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Utility to format file sizes for human readability
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const HolafModelManager = {
    // --- HTML Elements ---
    panel: null,
    content: null,
    statusBar: null,
    searchInput: null,

    // --- State ---
    isInitialized: false,
    allModels: [], // Store all models fetched from the API
    currentFilter: "",

    // --- Drag & Resize State ---
    isDragging: false,
    isResizing: false,
    dragOffsetX: 0,
    dragOffsetY: 0,

    // --- Initialization ---
    init() {
        if (this.isInitialized) return;
        
        this.addUtilitiesMenu();
        this.createPanel();
        
        this.isInitialized = true;
    },

    // --- UI Creation ---
    addUtilitiesMenu() {
        // Find or create the main container for the menu
        let menuContainer = document.getElementById("holaf-utilities-menu-container");
        let dropdownMenu;

        if (!menuContainer) {
            // Create container
            menuContainer = document.createElement("div");
            menuContainer.id = "holaf-utilities-menu-container";
            menuContainer.style.position = "relative";
            menuContainer.style.display = "inline-block";
            menuContainer.style.margin = "0 4px";

            // Create the main "Utilities" button
            const mainButton = document.createElement("button");
            mainButton.id = "holaf-utilities-menu-button";
            mainButton.textContent = "Utilities";
            mainButton.className = "holaf-main-utility-button"; // For shared styling if needed
            // Add styles similar to the original buttons
            mainButton.style.cssText = `
                background-color: var(--comfy-menu-bg, #222);
                color: var(--fg-color, white);
                font-size: 14px;
                padding: 10px;
                cursor: pointer;
                border: 1px solid var(--border-color, #444);
                border-radius: 8px;
            `;
            mainButton.onmouseover = () => { mainButton.style.backgroundColor = 'var(--comfy-menu-item-bg-hover, #333)'; };
            mainButton.onmouseout = () => { mainButton.style.backgroundColor = 'var(--comfy-menu-bg, #222)'; };


            // Create the dropdown menu (ul)
            dropdownMenu = document.createElement("ul");
            dropdownMenu.id = "holaf-utilities-dropdown-menu";
            dropdownMenu.style.cssText = `
                display: none;
                position: absolute;
                background-color: var(--comfy-menu-bg, #2a2a2a);
                border: 1px solid var(--border-color, #444);
                border-radius: 4px;
                list-style: none;
                padding: 5px 0;
                margin: 2px 0 0;
                z-index: 1002;
                min-width: 140px;
                right: 0;
            `;

            // Add toggle logic for the dropdown
            mainButton.onclick = (e) => {
                e.stopPropagation();
                dropdownMenu.style.display = dropdownMenu.style.display === "block" ? "none" : "block";
            };
            
            // Close when clicking outside
            document.addEventListener('click', () => {
                if (dropdownMenu.style.display === "block") {
                    dropdownMenu.style.display = 'none';
                }
            });
            dropdownMenu.addEventListener('click', (e) => e.stopPropagation());

            // Assemble and inject into the DOM before the settings button
            menuContainer.append(mainButton, dropdownMenu);
            const settingsButton = app.menu.settingsGroup.element;
            if (settingsButton) {
                settingsButton.before(menuContainer);
            } else {
                console.error("[Holaf Utilities] Could not find settings button to anchor Utilities menu.");
                const menu = document.querySelector(".comfy-menu");
                if (menu) menu.append(menuContainer);
            }
        } else {
            // If the container already exists, just get the dropdown menu
            dropdownMenu = document.getElementById("holaf-utilities-dropdown-menu");
        }

        // Add the "Model Manager" item to the menu
        const managerMenuItem = document.createElement("li");
        managerMenuItem.textContent = "Model Manager";
        managerMenuItem.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            color: var(--fg-color, #ccc);
        `;
        managerMenuItem.onmouseover = () => { managerMenuItem.style.backgroundColor = 'var(--comfy-menu-item-bg-hover, #333)'; };
        managerMenuItem.onmouseout = () => { managerMenuItem.style.backgroundColor = 'transparent'; };
        
        managerMenuItem.onclick = () => {
            this.show();
            dropdownMenu.style.display = "none"; // Hide menu after click
        };
        
        dropdownMenu.appendChild(managerMenuItem);
    },

    createPanel() {
        // Main panel container
        this.panel = document.createElement("div");
        this.panel.id = "holaf-manager-panel";
        this.panel.className = "holaf-utility-panel"; // Use a shared class for styling
        this.panel.style.display = "none"; // Initially hidden

        // Header for title, dragging, and closing
        const header = document.createElement("div");
        header.className = "holaf-utility-header";
        header.innerHTML = `
            <span><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 5px;"><path d="M2 6h12M2 12h12M2 18h12M18 9l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>Holaf Model Manager</span>
        `;

        const closeButton = document.createElement("button");
        closeButton.className = "holaf-utility-close-button";
        closeButton.textContent = "✖";
        closeButton.onclick = () => this.hide();
        header.appendChild(closeButton);

        // Toolbar for search and filters
        const toolbar = document.createElement("div");
        toolbar.className = "holaf-manager-toolbar";
        
        this.searchInput = document.createElement("input");
        this.searchInput.type = "text";
        this.searchInput.placeholder = "Search models...";
        this.searchInput.className = "holaf-manager-search";
        this.searchInput.oninput = (e) => this.filterAndRenderModels(e.target.value);
        toolbar.appendChild(this.searchInput);

        // Content area where models will be listed
        this.content = document.createElement("div");
        this.content.className = "holaf-manager-content";
        
        // Status bar for information
        this.statusBar = document.createElement("div");
        this.statusBar.className = "holaf-manager-statusbar";

        // Resize handle
        const resizeHandle = document.createElement("div");
        resizeHandle.className = "holaf-utility-resize-handle";

        // Assemble the panel
        this.panel.append(header, toolbar, this.content, this.statusBar, resizeHandle);
        document.body.appendChild(this.panel);

        // Add drag and resize functionality
        header.addEventListener('mousedown', (e) => this.startDrag(e));
        resizeHandle.addEventListener('mousedown', (e) => this.startResize(e));
        document.addEventListener('mousemove', (e) => {
            this.drag(e);

            this.resize(e);
        });
        document.addEventListener('mouseup', () => this.stopActions());
    },

    // --- Data Fetching and Rendering ---
    async loadAndDisplayModels() {
        this.content.innerHTML = '<p class="holaf-manager-message">Loading models...</p>';
        this.statusBar.textContent = "Fetching...";
        try {
            const response = await api.fetchApi("/holaf/models");
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.allModels = await response.json();
            
            // Initial render
            this.filterAndRenderModels(this.searchInput.value);

        } catch (error) {
            console.error("Holaf Manager Error:", error);
            this.content.innerHTML = `<p class="holaf-manager-message error">Error loading models. Check console.</p>`;
            this.statusBar.textContent = "Error";
        }
    },
    
    async handleDeleteRequest(model) {
        const confirmation = confirm(`Are you sure you want to permanently delete this model?\n\nFile: ${model.name}`);
        if (!confirmation) {
            return;
        }

        try {
            const response = await api.fetchApi("/holaf/models/delete", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ path: model.path }),
            });

            const result = await response.json();

            if (response.ok) {
                // Remove from the main list and re-render
                this.allModels = this.allModels.filter(m => m.path !== model.path);
                this.filterAndRenderModels(this.currentFilter);
            } else {
                throw new Error(result.message || "An unknown error occurred on the server.");
            }
        } catch (error) {
            console.error("Holaf Manager: Delete failed", error);
            alert(`Error deleting model: ${error.message}`);
        }
    },
    
    filterAndRenderModels(searchTerm = '') {
        this.currentFilter = searchTerm.toLowerCase();
        
        const filteredModels = this.allModels.filter(model => 
            model.name.toLowerCase().includes(this.currentFilter)
        );

        if (filteredModels.length === 0) {
            if (this.allModels.length === 0) {
                this.content.innerHTML = '<p class="holaf-manager-message">No models found in your ComfyUI directories.</p>';
                this.statusBar.textContent = '0 models';
            } else {
                this.content.innerHTML = `<p class="holaf-manager-message">No models match "${this.currentFilter}".</p>`;
                this.statusBar.textContent = `0 of ${this.allModels.length} models shown`;
            }
            return;
        }

        // Clear content and render model cards
        this.content.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        filteredModels.forEach(model => {
            const modelElement = document.createElement('div');
            modelElement.className = 'holaf-model-card';

            const modelName = document.createElement('div');
            modelName.className = 'holaf-model-name';
            modelName.title = model.path;
            modelName.textContent = model.name;

            const modelInfo = document.createElement('div');
            modelInfo.className = 'holaf-model-info';

            const modelType = document.createElement('span');
            modelType.className = 'holaf-model-type';
            modelType.textContent = model.type;

            const modelSize = document.createElement('span');
            modelSize.className = 'holaf-model-size';
            modelSize.textContent = formatBytes(model.size_bytes);

            const modelActions = document.createElement('div');
            modelActions.style.marginLeft = '15px';

            const deleteButton = document.createElement('button');
            deleteButton.textContent = '🗑️';
            deleteButton.title = 'Delete Model';
            deleteButton.style.cssText = `
                background: #553333;
                color: #f0b0b0;
                border: 1px solid #774444;
                border-radius: 4px;
                cursor: pointer;
                padding: 2px 6px;
                font-size: 14px;
                line-height: 1;
                transition: background-color 0.2s, color 0.2s;
            `;
            deleteButton.onmouseover = () => { deleteButton.style.backgroundColor = '#c44'; deleteButton.style.color = 'white'; };
            deleteButton.onmouseout = () => { deleteButton.style.backgroundColor = '#553333'; deleteButton.style.color = '#f0b0b0';};
            
            deleteButton.onclick = () => this.handleDeleteRequest(model);

            modelActions.appendChild(deleteButton);
            modelInfo.append(modelType, modelSize, modelActions);
            modelElement.append(modelName, modelInfo);
            
            fragment.appendChild(modelElement);
        });
        
        this.content.appendChild(fragment);
        this.statusBar.textContent = `${filteredModels.length} of ${this.allModels.length} models shown`;
    },

    // --- Dialog Visibility and Drag/Resize ---
    show() {
        this.panel.style.display = "flex";
        this.loadAndDisplayModels(); // Always refresh on show
        this.searchInput.focus();
    },

    hide() {
        this.panel.style.display = "none";
    },

    _bakePosition(panel) {
        if (panel.style.transform && panel.style.transform !== 'none') {
            const rect = panel.getBoundingClientRect();
            panel.style.top = `${rect.top}px`;
            panel.style.left = `${rect.left}px`;
            panel.style.transform = 'none';
        }
    },

    startDrag(e) {
        if (e.target.closest("button")) return;
        this._bakePosition(this.panel);
        this.isDragging = true;
        this.dragOffsetX = e.clientX - this.panel.offsetLeft;
        this.dragOffsetY = e.clientY - this.panel.offsetTop;
        this.panel.style.userSelect = 'none';
    },

    startResize(e) {
        e.preventDefault();
        this._bakePosition(this.panel);
        this.isResizing = true;
    },

    drag(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this.panel.style.left = `${e.clientX - this.dragOffsetX}px`;
        this.panel.style.top = `${e.clientY - this.dragOffsetY}px`;
    },

    resize(e) {
        if (!this.isResizing) return;
        e.preventDefault();
        const newWidth = e.clientX - this.panel.offsetLeft + 8;
        const newHeight = e.clientY - this.panel.offsetTop + 8;
        this.panel.style.width = `${newWidth}px`;
        this.panel.style.height = `${newHeight}px`;
    },

    stopActions() {
        this.isDragging = false;
        this.isResizing = false;
        this.panel.style.userSelect = '';
    }
};

// --- Extension Registration ---
app.registerExtension({
    name: "Holaf.ModelManager",
    async setup() {
        // Dynamically load the shared CSS file
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = "extensions/ComfyUI-Holaf-Utilities/holaf_utilities.css";
        document.head.appendChild(link);
        
        // Initialize the manager
        HolafModelManager.init();
    }
});