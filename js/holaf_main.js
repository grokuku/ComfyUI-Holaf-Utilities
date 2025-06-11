/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Main Menu Initializer
 *
 * This script is responsible for creating the main "Utilities" button and dropdown menu.
 * Other utility scripts will then add their own items to this menu.
 * This makes the system modular and resilient; if one utility fails to load,
 * it won't prevent the main menu from appearing.
 */

import { app } from "../../../scripts/app.js";

const HolafUtilitiesMenu = {
    init() {
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
        mainButton.className = "holaf-main-utility-button";
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
    }
};

// --- Extension Registration ---
app.registerExtension({
    name: "Holaf.Utilities.Menu",
    // This setup runs first to ensure the menu exists for other components.
    // The name is alphabetically first.
    async setup() {
        HolafUtilitiesMenu.init();
    }
});