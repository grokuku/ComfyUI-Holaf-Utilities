/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Main Menu Initializer
 *
 * This script is responsible for creating the main "Utilities" button and dropdown menu.
 * It also ensures that shared CSS for utility panels is loaded.
 * MODIFIED: Replaced dynamic/event-based menu with a static, hardcoded menu for stability.
 * CORRECTION: Replaced unreliable handler lookup with a direct lookup on the app object.
 * MODIFICATION: Added "Settings" and "Restart ComfyUI" menu items with separators.
 * MODIFICATION: Replaced native confirm() with a custom, themed modal dialog.
 * CORRECTION: Removed automatic page reload after sending restart command.
 * MODIFICATION: Imported and activated the new Settings Manager.
 */

import { app } from "../../../scripts/app.js";

// We can't import the other modules here without creating circular dependencies or race conditions.
// We rely on the fact that ComfyUI loads all JS files, making the handler objects available globally.
// We will add checks to ensure the handlers exist before calling them.
import "./holaf_terminal.js";
import "./holaf_model_manager.js";
import "./holaf_nodes_manager.js";
import "./holaf_image_viewer.js";
import "./holaf_settings_manager.js"; // <-- This line is now active

/**
 * A simple, themed modal dialog helper.
 */
const HolafModal = {
    show(title, message, onConfirm, confirmText = "Confirm", cancelText = "Cancel") {
        // Remove existing modal if any
        const existingModal = document.getElementById("holaf-modal-overlay");
        if (existingModal) existingModal.remove();

        // Create overlay
        const overlay = document.createElement("div");
        overlay.id = "holaf-modal-overlay";

        // Use the current theme for the modal
        const currentTheme = document.body.className.match(/holaf-theme-\S+/)?.[0] || 'holaf-theme-graphite-orange';

        // Create dialog
        const dialog = document.createElement("div");
        dialog.id = "holaf-modal-dialog";
        dialog.className = currentTheme; // Apply theme
        dialog.innerHTML = `
            <div class="holaf-utility-header">
                <span>${title}</span>
            </div>
            <div class="holaf-modal-content">
                ${message}
            </div>
            <div class="holaf-modal-footer">
                <button id="holaf-modal-cancel" class="comfy-button secondary">${cancelText}</button>
                <button id="holaf-modal-confirm" class="comfy-button">${confirmText}</button>
            </div>
        `;

        // Hide cancel button if text is null or empty
        if (!cancelText) {
            dialog.querySelector("#holaf-modal-cancel").style.display = "none";
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const closeModal = () => overlay.remove();

        document.getElementById("holaf-modal-confirm").onclick = () => {
            if (onConfirm) onConfirm();
            closeModal();
        };

        const cancelBtn = document.getElementById("holaf-modal-cancel");
        if (cancelBtn) cancelBtn.onclick = closeModal;

        overlay.onclick = (e) => {
            if (e.target === overlay) closeModal();
        };
    }
};


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
            { label: "Image Viewer", handlerName: "holafImageViewer" },
            { type: 'separator' },
            { label: "Settings", handlerName: "holafSettingsManager" },
            { type: 'separator' },
            { label: "Restart ComfyUI", special: 'restart' }
        ];

        menuItems.forEach(itemInfo => {
            if (itemInfo.type === 'separator') {
                const separator = document.createElement("li");
                separator.style.height = "1px";
                separator.style.backgroundColor = "var(--holaf-border-color, #3F3F3F)";
                separator.style.margin = "5px 0";
                separator.style.padding = "0";
                this.dropdownMenuEl.appendChild(separator);
                return; // Continue to next item
            }

            const menuItem = document.createElement("li");
            menuItem.textContent = itemInfo.label;

            menuItem.onclick = () => {
                // Handle special actions first
                if (itemInfo.special === 'restart') {
                    HolafModal.show("Restart ComfyUI", "Are you sure you want to restart the ComfyUI server?", () => {
                        console.log("[Holaf Utilities] Sending restart request...");
                        fetch("/holaf/utilities/restart", { method: 'POST' })
                            .then(res => res.json())
                            .then(data => {
                                if (data.status === "ok") {
                                    HolafModal.show("Restart Command Sent", "The server is restarting. You will need to **manually refresh** this page after the server is back online.", () => { }, "OK", null);
                                } else {
                                    HolafModal.show("Error", `Failed to send restart command to the server: ${data.message || 'Unknown error'}.`, () => { }, "OK", null);
                                }
                            })
                            .catch(err => {
                                HolafModal.show("Restart Command Sent", "The server is restarting. You will need to **manually refresh** this page after the server is back online.", () => { }, "OK", null);
                            });
                    });
                } else {
                    // Handle standard panel opening
                    const handler = app[itemInfo.handlerName];
                    if (handler && typeof handler.show === 'function') {
                        handler.show();
                    } else {
                        console.error(`[Holaf Utilities] Handler for "${itemInfo.label}" (app.${itemInfo.handlerName}) is not available or has no .show() method.`);
                        HolafModal.show("Not Implemented", `The panel for "${itemInfo.label}" is not available yet.`, () => { }, "OK", null);
                    }
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