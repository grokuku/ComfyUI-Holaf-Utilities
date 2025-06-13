/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Main Menu Initializer
 *
 * This script is responsible for creating the main "Utilities" button and dropdown menu.
 * It also ensures that shared CSS for utility panels is loaded.
 * Other utility scripts will then add their own items to this menu.
 */

import { app } from "../../../scripts/app.js";

const HolafUtilitiesMenu = {
    init() {
        // Load shared CSS for all utility panels
        this.loadSharedCss();

        // Find or create the main container for the menu
        let menuContainer = document.getElementById("holaf-utilities-menu-container");

        // If the menu already exists, do nothing.
        if (menuContainer) {
            return;
        }

        // --- Create Menu Container ---
        menuContainer = document.createElement("div");
        menuContainer.id = "holaf-utilities-menu-container";
        menuContainer.style.position = "relative";
        menuContainer.style.display = "inline-block";
        menuContainer.style.margin = "0 4px";

        // --- Create the main "Utilities" button ---
        const mainButton = document.createElement("button");
        mainButton.id = "holaf-utilities-menu-button";
        mainButton.textContent = "Utilities";
        // The style is now primarily controlled by holaf_utilities.css
        // We remove the inline styles that were overriding the CSS file.

        // --- Create the dropdown menu (ul) ---
        const dropdownMenu = document.createElement("ul");
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

        // --- Add Event Listeners ---
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

        // --- Assemble and Inject into DOM ---
        menuContainer.append(mainButton, dropdownMenu);
        const settingsButton = app.menu.settingsGroup.element;
        if (settingsButton) {
            settingsButton.before(menuContainer);
        } else {
            console.error("[Holaf Utilities] Could not find settings button to anchor Utilities menu.");
            const menu = document.querySelector(".comfy-menu");
            if (menu) menu.append(menuContainer);
        }
    },

    loadSharedCss() {
        const cssId = "holaf-utilities-shared-css";
        if (!document.getElementById(cssId)) {
            const link = document.createElement("link");
            link.id = cssId;
            link.rel = "stylesheet";
            link.type = "text/css";
            // MODIFIED LINE: Assumes holaf_utilities.css is now in js/css/
            link.href = "extensions/ComfyUI-Holaf-Utilities/css/holaf_utilities.css";
            document.head.appendChild(link);
            console.log("[Holaf Utilities] Shared CSS loaded (attempting from js/css/).");
        }
    }
};

// --- Extension Registration ---
app.registerExtension({
    name: "Holaf.Utilities.Menu", // Name ensures it runs early
    async setup() {
        HolafUtilitiesMenu.init();
    }
});