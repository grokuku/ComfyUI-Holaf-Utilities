/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Main Menu Initializer
 *
 * This script is responsible for creating the main "Utilities" button and dropdown menu.
 * It also ensures that shared CSS for utility panels is loaded.
 * Other utility scripts will then add their own items to this menu.
 * MODIFIED: Dropdown menu is attached to document.body immediately on init (hidden).
 */

import { app } from "../../../scripts/app.js";

const HolafUtilitiesMenu = {
    dropdownMenuEl: null, // Référence au menu déroulant

    init() {
        this.loadSharedCss();

        let menuContainer = document.getElementById("holaf-utilities-menu-container");
        if (menuContainer) {
            if (!window.HolafUtilitiesMenuReady) {
                 window.HolafUtilitiesMenuReady = true;
            }
            // S'assurer que le dropdownMenuEl est référencé si le menu existait déjà
            // et qu'il est bien sur le body (au cas où un HMR aurait foiré)
            this.dropdownMenuEl = document.getElementById("holaf-utilities-dropdown-menu");
            if (this.dropdownMenuEl && this.dropdownMenuEl.parentElement !== document.body) {
                console.warn("[Holaf Utilities] Dropdown existed but was not on body. Re-attaching.");
                document.body.appendChild(this.dropdownMenuEl);
                this.dropdownMenuEl.style.display = 'none'; // Ensure hidden
            }
            return;
        }

        menuContainer = document.createElement("div");
        menuContainer.id = "holaf-utilities-menu-container";
        menuContainer.style.position = "relative"; 
        menuContainer.style.display = "inline-block";
        menuContainer.style.margin = "0 4px";

        const mainButton = document.createElement("button");
        mainButton.id = "holaf-utilities-menu-button";
        mainButton.textContent = "Utilities";

        // Créer le menu déroulant une seule fois et l'attacher au body (caché)
        if (!this.dropdownMenuEl) {
            this.dropdownMenuEl = document.createElement("ul");
            this.dropdownMenuEl.id = "holaf-utilities-dropdown-menu";
            this.dropdownMenuEl.style.cssText = `
                display: none; /* Caché par défaut */
                position: fixed; 
                background-color: var(--comfy-menu-bg, #2a2a2a);
                border: 1px solid var(--border-color, #444);
                border-radius: 4px;
                list-style: none;
                padding: 5px 0;
                margin: 0; 
                z-index: 100000; 
                min-width: 140px;
                box-shadow: 0 3px 10px rgba(0,0,0,0.3);
            `;
            document.body.appendChild(this.dropdownMenuEl);
            console.log("[Holaf Utilities] Dropdown menu element created and attached to body (hidden).");
        }
        
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
        
        if (this.dropdownMenuEl) { // S'assurer qu'il existe avant d'ajouter le listener
            this.dropdownMenuEl.addEventListener('click', (e) => e.stopPropagation());
        }

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
                console.error("[Holaf Utilities] Could not find .comfy-menu. Appending to body as last resort.");
                document.body.prepend(menuContainer); // Prepend to try to keep it visible
            }
        }
        
        window.HolafUtilitiesMenuReady = true;
        console.log("[Holaf Utilities] Menu initialized. Button ready. Dropdown ready in body.");
    },

    showDropdown(buttonElement) {
        if (!this.dropdownMenuEl) {
            console.error("[Holaf Utilities] showDropdown: dropdownMenuEl is null!");
            return;
        }
        // S'assurer qu'il est sur le body (au cas où il aurait été retiré par un autre script ou bug)
        if (this.dropdownMenuEl.parentElement !== document.body) {
            console.warn("[Holaf Utilities] Dropdown was not on body in showDropdown. Re-attaching.");
            document.body.appendChild(this.dropdownMenuEl);
        }

        const rect = buttonElement.getBoundingClientRect();
        this.dropdownMenuEl.style.top = `${rect.bottom + 2}px`;
        
        // Utiliser min-width du CSS comme fallback si offsetWidth est 0 (parce que display:none)
        const computedStyle = getComputedStyle(this.dropdownMenuEl);
        const dropdownWidth = this.dropdownMenuEl.offsetWidth || parseFloat(computedStyle.minWidth) || 140;
        
        let leftPosition = rect.right - dropdownWidth;
        if (leftPosition < 5) leftPosition = 5; // Empêcher de sortir à gauche de l'écran

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
        HolafUtilitiesMenu.init();
    }
});