/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Main Menu Initializer
 *
 * This script is responsible for creating the main "Utilities" button and dropdown menu.
 * It also ensures that shared CSS for utility panels is loaded.
 * MODIFIED: Replaced dynamic/event-based menu with a static, hardcoded menu for stability.
 *           This file now defines all menu items directly.
 * CORRECTION: Replaced unreliable handler lookup with a direct lookup on the app object.
 */

import { app } from "../../../scripts/app.js";

// We can't import the other modules here without creating circular dependencies or race conditions.
// We rely on the fact that ComfyUI loads all JS files, making the handler objects available globally.
// We will add checks to ensure the handlers exist before calling them.
import "./holaf_terminal.js";
import "./holaf_model_manager.js";
import "./holaf_nodes_manager.js";
import "./holaf_image_viewer.js";


const HolafUtilitiesMenu = {
    dropdownMenuEl: null, // Référence au menu déroulant

    init() {
        this.loadSharedCss();

        let menuContainer = document.getElementById("holaf-utilities-menu-container");
        if (menuContainer) {
            return; // Already initialized
        }

        menuContainer = document.createElement("div");
        menuContainer.id = "holaf-utilities-menu-container";
        menuContainer.style.position = "relative"; 
        menuContainer.style.display = "inline-block";
        menuContainer.style.margin = "0 4px";

        const mainButton = document.createElement("button");
        mainButton.id = "holaf-utilities-menu-button";
        mainButton.textContent = "Holaf's Utilities";

        // --- Create the static, full dropdown menu from the start ---
        this.dropdownMenuEl = document.createElement("ul");
        this.dropdownMenuEl.id = "holaf-utilities-dropdown-menu";
        this.dropdownMenuEl.style.display = 'none'; // Hidden by default

        // Define all menu items statically
        const menuItems = [
            { label: "Terminal", handlerName: "holafTerminal" },
            { label: "Model Manager", handlerName: "holafModelManager" },
            { label: "Custom Nodes Manager", handlerName: "holafNodesManager" },
            { label: "Image Viewer", handlerName: "holafImageViewer" }
        ];

        menuItems.forEach(itemInfo => {
            const menuItem = document.createElement("li");
            menuItem.textContent = itemInfo.label;

            // The onclick handler finds the tool's object when clicked.
            // This relies on each tool's script attaching its main object to `app`.
            menuItem.onclick = () => {
                const handler = app[itemInfo.handlerName];
                
                if (handler && typeof handler.show === 'function') {
                    handler.show();
                } else {
                    console.error(`[Holaf Utilities] Handler for "${itemInfo.label}" (app.${itemInfo.handlerName}) is not available or has no .show() method.`);
                    alert(`Could not open "${itemInfo.label}". See browser console for details.`);
                }
                this.hideDropdown();
            };
            this.dropdownMenuEl.appendChild(menuItem);
        });

        document.body.appendChild(this.dropdownMenuEl);
        
        mainButton.onclick = (e) => {
            e.stopPropagation();
            if (this.dropdownMenuEl.style.display === "block") {
                this.hideDropdown();
            } else {
                this.showDropdown(mainButton);
            }
        };

        document.addEventListener('click', (e) => {
            if (this.dropdownMenuEl && this.dropdownMenuEl.style.display === "block") {
                if (e.target !== mainButton && !this.dropdownMenuEl.contains(e.target)) {
                    this.hideDropdown();
                }
            }
        });
        
        menuContainer.appendChild(mainButton);

        const settingsButton = app.menu.settingsGroup.element;
        if (settingsButton) {
            settingsButton.before(menuContainer);
        } else {
            console.error("[Holaf Utilities] Could not find settings button to anchor Utilities menu.");
            const comfyMenu = document.querySelector(".comfy-menu");
            if (comfyMenu) {
                comfyMenu.append(menuContainer);
            } else {
                document.body.prepend(menuContainer);
            }
        }
        
        console.log("[Holaf Utilities] Static menu initialized successfully.");
    },

    showDropdown(buttonElement) {
        if (!this.dropdownMenuEl) {
            console.error("[Holaf Utilities] showDropdown: dropdownMenuEl is null!");
            return;
        }
        if (this.dropdownMenuEl.parentElement !== document.body) {
            document.body.appendChild(this.dropdownMenuEl);
        }

        const rect = buttonElement.getBoundingClientRect();
        this.dropdownMenuEl.style.top = `${rect.bottom + 2}px`;
        
        const computedStyle = getComputedStyle(this.dropdownMenuEl);
        const dropdownWidth = this.dropdownMenuEl.offsetWidth || parseFloat(computedStyle.minWidth) || 140;
        
        let leftPosition = rect.right - dropdownWidth;
        if (leftPosition < 5) leftPosition = 5; 

        this.dropdownMenuEl.style.left = `${leftPosition}px`;
        this.dropdownMenuEl.style.display = "block";
    },

    hideDropdown() {
        if (!this.dropdownMenuEl) return;
        this.dropdownMenuEl.style.display = "none";
    },

    loadSharedCss() {
        const cssId = "holaf-utilities-shared-css";
        if (!document.getElementById(cssId)) {
            const link = document.createElement("link");
            link.id = cssId;
            link.rel = "stylesheet";
            link.type = "text/css";
            link.href = "extensions/ComfyUI-Holaf-Utilities/css/holaf_utilities.css";
            document.head.appendChild(link);
        }
    }
};

app.registerExtension({
    name: "Holaf.Utilities.Menu",
    async setup() {
        // We delay init slightly to ensure other scripts have a chance to register their exports.
        setTimeout(() => HolafUtilitiesMenu.init(), 10);
    }
});