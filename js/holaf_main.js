import { app } from "../../../scripts/app.js";
import { HolafToastManager } from "./holaf_toast_manager.js";

// CORRECTED: Import themes first to ensure it's available for all other modules.
import "./holaf_themes.js";
import "./holaf_terminal.js";
import "./holaf_model_manager.js";
import "./holaf_nodes_manager.js";
import "./holaf_image_viewer.js";
import "./holaf_settings_manager.js";
import "./holaf_monitor.js";
import "./holaf_layout_tools.js";
import "./holaf_shortcuts.js";

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
        this.initBridgeListener(); // [NEW] Start listening for Profiler commands

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
            // [NEW] Workflow Profiler Entry
            { label: "Workflow Profiler", special: "profiler_standalone" },
            { type: 'separator' },
            { label: "Toggle Monitor", special: "toggle_monitor" },
            { label: "Toggle Layout Tools", special: "toggle_layout_tools" },
            { label: "Toggle Shortcuts", special: "toggle_shortcuts" },
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
            // Use flexbox for the menu item to align label and checkbox
            menuItem.style.display = "flex";
            menuItem.style.justifyContent = "space-between";
            menuItem.style.alignItems = "center";
            
            const labelSpan = document.createElement("span");
            labelSpan.textContent = itemInfo.label;
            menuItem.appendChild(labelSpan);

            // Add Checkbox if it's a toggleable item
            let checkbox = null;
            if (["toggle_monitor", "toggle_layout_tools", "toggle_shortcuts"].includes(itemInfo.special)) {
                checkbox = document.createElement("div");
                Object.assign(checkbox.style, {
                    width: "12px",
                    height: "12px",
                    border: "1px solid var(--border-color, #888)",
                    borderRadius: "3px",
                    backgroundColor: "rgba(0,0,0,0.2)",
                    marginLeft: "15px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    color: "var(--holaf-accent-color, #ff8c00)"
                });
                menuItem.appendChild(checkbox);
            }

            const updateCheckboxUI = () => {
                if (!checkbox) return;
                let isActive = false;
                if (itemInfo.special === "toggle_monitor") {
                    isActive = app.holafSystemMonitor?.isVisible;
                } else if (itemInfo.special === "toggle_layout_tools") {
                    isActive = window.holaf?.layoutTools?.isVisible;
                } else if (itemInfo.special === "toggle_shortcuts") {
                    isActive = app.holafShortcuts?.isVisible;
                }
                checkbox.innerHTML = isActive ? "✓" : "";
                checkbox.style.borderColor = isActive ? "var(--holaf-accent-color, #ff8c00)" : "var(--border-color, #888)";
            };

            // Initial update
            setTimeout(updateCheckboxUI, 50);

            menuItem.onclick = (e) => {
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
                        updateCheckboxUI();
                    } else {
                        console.error("[Holaf Utilities] HolafSystemMonitor is not available.");
                        HolafModal.show("Error", "System Monitor module not loaded.", () => { }, "OK", null);
                    }
                } else if (itemInfo.special === "toggle_layout_tools") {
                    if (window.holaf && window.holaf.layoutTools) {
                        window.holaf.layoutTools.toggle();
                        updateCheckboxUI();
                    } else {
                        console.warn("[Holaf Utilities] Layout Tools module not loaded yet.");
                    }
                } else if (itemInfo.special === "toggle_shortcuts") {
                    if (app.holafShortcuts && typeof app.holafShortcuts.toggle === "function") {
                        app.holafShortcuts.toggle();
                        updateCheckboxUI();
                    } else {
                         console.warn("[Holaf Utilities] Shortcuts module not loaded yet.");
                    }
                } else if (itemInfo.special === "profiler_standalone") {
                    // Open Profiler in new tab
                    window.open('/holaf/profiler/view', '_blank');
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
                // Only hide dropdown for non-toggle items to allow seeing the checkmark change
                if (!checkbox) {
                    this.hideDropdown();
                }
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
                // Refresh checkboxes when menu opens to ensure sync
                this.dropdownMenuEl.querySelectorAll('li').forEach(li => {
                    const check = li.querySelector('div');
                    const text = li.textContent;
                    if (check) {
                        let isActive = false;
                        if (text.includes("Monitor")) isActive = app.holafSystemMonitor?.isVisible;
                        else if (text.includes("Layout Tools")) isActive = window.holaf?.layoutTools?.isVisible;
                        else if (text.includes("Shortcuts")) isActive = app.holafShortcuts?.isVisible;
                        
                        check.innerHTML = isActive ? "✓" : "";
                        check.style.borderColor = isActive ? "var(--holaf-accent-color, #ff8c00)" : "var(--border-color, #888)";
                    }
                });
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

    // [NEW] BRIDGE LISTENER: Responds to requests from other tabs (Profiler, Gallery)
    initBridgeListener() {
        const bc = new BroadcastChannel('holaf_channel');
        bc.onmessage = async (event) => {
            const { command, data } = event.data;
            
            if (command === 'get_workflow_for_profiler') {
                console.log("[Holaf Bridge] Received workflow request from Profiler.");
                try {
                    // Serialize current graph
                    const workflowData = await app.graphToPrompt(); 
                    
                    const visualGraph = app.graph.serialize();
                    
                    // Send to backend
                    await fetch('/holaf/profiler/update-context', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(visualGraph)
                    });
                    
                    window.holaf.toastManager.show("Workflow synced with Profiler.", "success");
                    
                } catch(e) {
                    console.error("[Holaf Bridge] Error syncing workflow:", e);
                    window.holaf.toastManager.show("Error syncing workflow.", "error");
                }
            }
            // Add other listeners here if needed (e.g. load_workflow from Gallery)
        };
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
            "holaf_toasts.css",
            "holaf_profiler.css", // [NEW] Added Profiler CSS
            "holaf_layout_tools.css"
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