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
 * MODIFICATION: Added "Toggle Monitor" menu item.
 * REFACTOR CSS: Modified loadSharedCss to load multiple split CSS files.
 * REFACTOR RESTART: Implemented a new multi-stage restart sequence with fixed dialog size.
 * MODIFICATION: Integrated the new HolafToastManager for non-blocking notifications.
 */

import { app } from "../../../scripts/app.js";
import { HolafToastManager } from "./holaf_toast_manager.js";

// We can't import the other modules here without creating circular dependencies or race conditions.
// We rely on the fact that ComfyUI loads all JS files, making the handler objects available globally.
// We will add checks to ensure the handlers exist before calling them.
import "./holaf_terminal.js";
import "./holaf_model_manager.js";
import "./holaf_nodes_manager.js";
import "./holaf_image_viewer.js";
import "./holaf_settings_manager.js";
import "./holaf_monitor.js";

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

        const closeModal = () => {
            // Clean up any intervals that might have been created by a process within the modal
            if (window.holaf.restartMonitorInterval) clearInterval(window.holaf.restartMonitorInterval);
            if (window.holaf.restartTimerInterval) clearInterval(window.holaf.restartTimerInterval);
            delete window.holaf.restartMonitorInterval;
            delete window.holaf.restartTimerInterval;
            overlay.remove();
        }

        document.getElementById("holaf-modal-confirm").onclick = () => {
            if (onConfirm) {
                // If the confirm handler returns exactly false, we keep the modal open.
                // This allows the handler to take control of the modal's lifecycle.
                if (onConfirm() === false) {
                    return;
                }
            }
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

        // --- [FIX] Ensure a default theme is present on the body ---
        if (!document.body.className.includes("holaf-theme-")) {
            document.body.classList.add("holaf-theme-graphite-orange");
            console.log("[Holaf Main] Applied default fallback theme to body.");
        }
        // --- [END FIX] ---

        // --- NEW: Initialize global Holaf namespace and Toast Manager ---
        if (!window.holaf) {
            window.holaf = {};
        }
        window.holaf.toastManager = new HolafToastManager();
        // --- END NEW ---

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
            { label: "Toggle Monitor", special: "toggle_monitor" },
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
                    // Prepare the full HTML structure from the start to avoid resizing
                    const restartDialogContent = `
                        <div>
                            <p id="holaf-restart-message">Are you sure you want to restart the ComfyUI server?</p>
                            <p id="holaf-restart-timer-line" style="visibility: hidden; margin-top: 10px; height: 1.2em;">
                                Time elapsed: <span id="holaf-restart-timer">0</span>s
                            </p>
                        </div>
                    `;

                    HolafModal.show("Restart ComfyUI", restartDialogContent, () => {
                        // --- Stage 1: Transform the modal ---
                        const dialog = document.getElementById("holaf-modal-dialog");
                        if (!dialog) return; // Should not happen

                        const messageEl = document.getElementById("holaf-restart-message");
                        const timerLineEl = document.getElementById("holaf-restart-timer-line");

                        // Update texts and visibility
                        dialog.querySelector(".holaf-utility-header span").textContent = "Restarting Server";
                        messageEl.textContent = "Sending restart command...";
                        timerLineEl.style.visibility = "visible";

                        // Update footer
                        dialog.querySelector(".holaf-modal-footer").innerHTML = `
                            <button id="holaf-restart-close-btn" class="comfy-button secondary">Close</button>
                            <button id="holaf-restart-refresh-btn" class="comfy-button" disabled>Refresh</button>
                        `;

                        const cleanupAndClose = () => {
                            const overlay = document.getElementById("holaf-modal-overlay");
                            if (overlay) overlay.remove();
                            if (window.holaf.restartMonitorInterval) clearInterval(window.holaf.restartMonitorInterval);
                            if (window.holaf.restartTimerInterval) clearInterval(window.holaf.restartTimerInterval);
                            delete window.holaf.restartMonitorInterval;
                            delete window.holaf.restartTimerInterval;
                        }

                        dialog.querySelector("#holaf-restart-close-btn").onclick = cleanupAndClose;

                        // --- Stage 2: Send command and start monitoring ---
                        console.log("[Holaf Utilities] Sending restart request...");
                        fetch("/holaf/utilities/restart", { method: 'POST' })
                            .then(res => res.json())
                            .then(data => {
                                if (data.status !== "ok") throw new Error(data.message || 'Unknown server error');

                                const timerEl = document.getElementById("holaf-restart-timer");
                                const refreshBtn = document.getElementById("holaf-restart-refresh-btn");
                                if (!messageEl || !timerEl || !refreshBtn) return; // Dialog was closed

                                messageEl.textContent = "The server is restarting. Waiting for it to go offline...";

                                let seconds = 0;
                                window.holaf.restartTimerInterval = setInterval(() => {
                                    seconds++;
                                    if (timerEl) timerEl.textContent = seconds;
                                }, 1000);

                                let serverIsDown = false;
                                const checkServerStatus = () => {
                                    // --- [FIX] Removed 'no-cors' to inspect response. Added explicit status check.
                                    fetch(window.location.origin, { method: 'HEAD', cache: 'no-cache' })
                                        .then(response => {
                                            if (response.ok) { // Check for 2xx status codes
                                                if (serverIsDown) {
                                                    // --- Stage 3: Server is back online ---
                                                    clearInterval(window.holaf.restartMonitorInterval);
                                                    clearInterval(window.holaf.restartTimerInterval);
                                                    delete window.holaf.restartMonitorInterval;
                                                    delete window.holaf.restartTimerInterval;

                                                    if (!messageEl || !refreshBtn) return;

                                                    messageEl.innerHTML = `✅ Server has rebooted successfully in <strong>${seconds}</strong> seconds.`;
                                                    if (timerLineEl) timerLineEl.style.visibility = "hidden"; // Hide timer line on success
                                                    refreshBtn.textContent = "Refresh Page";
                                                    refreshBtn.disabled = false;
                                                    refreshBtn.onclick = () => location.reload();
                                                    refreshBtn.focus();
                                                }
                                            } else {
                                                // Server is up but returning an error (e.g., 502 from proxy)
                                                // Treat this as the server being down.
                                                if (!serverIsDown) {
                                                    console.log(`[Holaf Utilities] Server is responding with error ${response.status}. Treating as offline.`);
                                                    if (messageEl) messageEl.textContent = "Server is offline. Monitoring for reconnection...";
                                                    serverIsDown = true;
                                                }
                                            }
                                        })
                                        .catch(() => {
                                            // This catches network errors (server truly unreachable)
                                            if (!serverIsDown) {
                                                console.log("[Holaf Utilities] Server is now offline (network error). Waiting for it to come back online.");
                                                if (messageEl) messageEl.textContent = "Server is offline. Monitoring for reconnection...";
                                                serverIsDown = true;
                                            }
                                        });
                                };

                                window.holaf.restartMonitorInterval = setInterval(checkServerStatus, 2000);
                            })
                            .catch(err => {
                                console.error("[Holaf Utilities] Failed to send restart command:", err);
                                dialog.querySelector(".holaf-modal-content").innerHTML = `<p style="color:var(--holaf-error-text,red);">Failed to send restart command to the server: ${err.message}.</p>`;
                                dialog.querySelector("#holaf-restart-refresh-btn").disabled = true;
                            });

                        // Return false to prevent the modal from closing automatically.
                        return false;
                    });
                } else if (itemInfo.special === "toggle_monitor") {
                    const monitor = app.holafSystemMonitor;
                    if (monitor && typeof monitor.toggle === "function") {
                        monitor.toggle();
                    } else {
                        console.error("[Holaf Utilities] HolafSystemMonitor is not available.");
                        HolafModal.show("Error", "System Monitor module not loaded.", () => { }, "OK", null);
                    }
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
        const cssFiles = [
            "holaf_themes.css",
            "holaf_shared_panel.css",
            "holaf_main_button.css",
            "holaf_model_manager_styles.css",
            "holaf_terminal_styles.css",
            "holaf_nodes_manager_styles.css",
            "holaf_settings_panel_styles.css",
            "holaf_system_monitor_styles.css",
            "holaf_image_viewer_styles.css",
            "holaf_toasts.css" // <-- Added this line
        ];

        const basePath = "extensions/ComfyUI-Holaf-Utilities/css/"; // Corrected base path

        cssFiles.forEach(fileName => {
            const cssId = `holaf-css-${fileName.replace('.css', '')}`;
            if (!document.getElementById(cssId)) {
                const link = document.createElement("link");
                link.id = cssId;
                link.rel = "stylesheet";
                link.type = "text/css";
                link.href = basePath + fileName;
                document.head.appendChild(link);
                console.log(`[Holaf Main] Loaded CSS: ${fileName}`);
            }
        });
    }
};

app.registerExtension({
    name: "Holaf.Utilities.Menu",
    async setup() {
        // We delay init slightly to ensure other scripts have a chance to register their exports.
        setTimeout(() => HolafUtilitiesMenu.init(), 10);
    }
});