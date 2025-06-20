/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer UI (Work in Progress)
 *
 * This script provides the client-side logic for the Holaf Image Viewer.
 * CORRECTION: Replaced setTimeout polling with a "holaf-menu-ready" event listener for robust initialization.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";
import holafModelManager from "./holaf_model_manager.js"; // Import to access shared settings

const holafImageViewer = {
    panelElements: null,
    isInitialized: false,

    addMenuItem() {
        const dropdownMenu = document.getElementById("holaf-utilities-dropdown-menu");
        if (!dropdownMenu) {
            console.error("[Holaf ImageViewer] Cannot add menu item: Dropdown menu not found.");
            return;
        }

        const existingItem = Array.from(dropdownMenu.children).find(
            li => li.textContent === "Image Viewer (WIP)"
        );
        if (existingItem) return;

        const menuItem = document.createElement("li");
        menuItem.textContent = "Image Viewer (WIP)";
        menuItem.onclick = () => {
            this.show();
            if (dropdownMenu) dropdownMenu.style.display = "none";
        };
        dropdownMenu.appendChild(menuItem);
        console.log("[Holaf ImageViewer] Menu item added to dropdown.");
    },

    init() {
        // Wait for the main menu to signal it's ready.
        document.addEventListener("holaf-menu-ready", () => {
            this.addMenuItem();
        });
    },

    createPanel() {
        if (this.panelElements && this.panelElements.panelEl) {
            return;
        }

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-viewer-panel",
                title: "Holaf Image Viewer (WIP)",
                defaultSize: { width: 700, height: 500 },
                onClose: () => this.hide(),
            });

            this.populatePanelContent();
            this.applyCurrentTheme();

        } catch (e) {
            console.error("[Holaf ImageViewer] Error creating panel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating Image Viewer panel. Check console for details." });
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.style.display = "flex";
        contentEl.style.alignItems = "center";
        contentEl.style.justifyContent = "center";
        contentEl.style.padding = "20px";

        contentEl.innerHTML = `
            <div style="text-align: center; color: var(--holaf-text-secondary);">
                <h2>Image Viewer</h2>
                <p>This feature is currently under construction.</p>
                <p>It will allow browsing, searching, and managing images from ComfyUI's output directory.</p>
            </div>
        `;
    },

    applyCurrentTheme() {
        if (this.panelElements && this.panelElements.panelEl) {
            const currentThemeName = holafModelManager.settings.theme;
            const themeConfig = HOLAF_THEMES.find(t => t.name === currentThemeName) || HOLAF_THEMES[0];

            HOLAF_THEMES.forEach(t => {
                this.panelElements.panelEl.classList.remove(t.className);
            });
            this.panelElements.panelEl.classList.add(themeConfig.className);
        }
    },

    show() {
        if (!this.panelElements) {
            this.createPanel();
        }

        if (this.panelElements && this.panelElements.panelEl) {
            this.applyCurrentTheme(); // Ensure theme is up-to-date
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl);
        }
    },

    hide() {
        if (this.panelElements && this.panelElements.panelEl) {
            this.panelElements.panelEl.style.display = "none";
        }
    }
};

app.registerExtension({
    name: "Holaf.ImageViewer.Panel",
    async setup() {
        holafImageViewer.init();
    },
});

export default holafImageViewer;