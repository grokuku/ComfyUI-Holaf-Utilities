import { app } from "../../../scripts/app.js";
import { HolafToastManager } from "./holaf_toast_manager.js";

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
        const existingModal = document.getElementById("holaf-modal-overlay");
        if (existingModal) existingModal.remove();

        const overlay = document.createElement("div");
        overlay.id = "holaf-modal-overlay";

        const currentTheme = document.body.className.match(/holaf-theme-\S+/)?.[0] || 'holaf-theme-graphite-orange';

        const dialog = document.createElement("div");
        dialog.id = "holaf-modal-dialog";
        dialog.className = currentTheme;
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

        if (!cancelText) {
            dialog.querySelector("#holaf-modal-cancel").style.display = "none";
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const closeModal = () => {
            if (window.holaf.restartMonitorInterval) clearInterval(window.holaf.restartMonitorInterval);
            if (window.holaf.restartTimerInterval) clearInterval(window.holaf.restartTimerInterval);
            delete window.holaf.restartMonitorInterval;
            delete window.holaf.restartTimerInterval;
            overlay.remove();
        }

        document.getElementById("holaf-modal-confirm").onclick = () => {
            if (onConfirm) {
                if (onConfirm() === false) return;
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
    dropdownMenuEl: null,
    isCompactMode: false,
    placeholderEl: null, // [NEW] Keep track of where the menu was

    init() {
        this.loadSharedCss();
        this.initBridgeListener();

        // Check preference
        this.isCompactMode = localStorage.getItem("Holaf_CompactMenu") === "true";
        if (this.isCompactMode) {
            setTimeout(() => this.toggleCompactMode(true), 500);
        }

        if (!document.body.className.includes("holaf-theme-")) {
            document.body.classList.add("holaf-theme-graphite-orange");
            console.log("[Holaf Main] Applied default fallback theme to body.");
        }

        if (!window.holaf) {
            window.holaf = {};
        }
        window.holaf.toastManager = new HolafToastManager();

        let menuContainer = document.getElementById("holaf-utilities-menu-container");
        if (menuContainer) {
            return; 
        }

        menuContainer = document.createElement("div");
        menuContainer.id = "holaf-utilities-menu-container";
        menuContainer.style.position = "relative";
        menuContainer.style.display = "inline-block";
        menuContainer.style.margin = "0 4px";

        const mainButton = document.createElement("button");
        mainButton.id = "holaf-utilities-menu-button";
        mainButton.textContent = "Holaf's Utilities";

        this.dropdownMenuEl = document.createElement("ul");
        this.dropdownMenuEl.id = "holaf-utilities-dropdown-menu";
        this.dropdownMenuEl.style.display = 'none';

        const menuItems = [
            { label: "Terminal", handlerName: "holafTerminal" },
            { label: "Model Manager", handlerName: "holafModelManager" },
            { label: "Custom Nodes Manager", handlerName: "holafNodesManager" },
            { label: "Image Viewer", handlerName: "holafImageViewer" },
            { label: "Workflow Profiler", special: "profiler_standalone" },
            { type: 'separator' },
            { label: "Compact Menu Bar", special: "toggle_compact_menu" },
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
                return;
            }

            const menuItem = document.createElement("li");
            menuItem.style.display = "flex";
            menuItem.style.justifyContent = "space-between";
            menuItem.style.alignItems = "center";
            
            const labelSpan = document.createElement("span");
            labelSpan.textContent = itemInfo.label;
            menuItem.appendChild(labelSpan);

            // Add Checkbox
            let checkbox = null;
            if (["toggle_monitor", "toggle_layout_tools", "toggle_shortcuts", "toggle_compact_menu"].includes(itemInfo.special)) {
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
                } else if (itemInfo.special === "toggle_compact_menu") {
                    isActive = this.isCompactMode;
                }
                checkbox.innerHTML = isActive ? "✓" : "";
                checkbox.style.borderColor = isActive ? "var(--holaf-accent-color, #ff8c00)" : "var(--border-color, #888)";
            };

            setTimeout(updateCheckboxUI, 50);

            menuItem.onclick = (e) => {
                // Restart logic
                if (itemInfo.special === 'restart') {
                     const restartDialogContent = `
                        <div>
                            <p id="holaf-restart-message">Are you sure you want to restart the ComfyUI server?</p>
                            <p id="holaf-restart-timer-line" style="visibility: hidden; margin-top: 10px; height: 1.2em;">
                                Time elapsed: <span id="holaf-restart-timer">0</span>s
                            </p>
                        </div>
                    `;

                    HolafModal.show("Restart ComfyUI", restartDialogContent, () => {
                        const dialog = document.getElementById("holaf-modal-dialog");
                        if (!dialog) return;

                        const messageEl = document.getElementById("holaf-restart-message");
                        const timerLineEl = document.getElementById("holaf-restart-timer-line");

                        dialog.querySelector(".holaf-utility-header span").textContent = "Restarting Server";
                        messageEl.textContent = "Sending restart command...";
                        timerLineEl.style.visibility = "visible";

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

                        console.log("[Holaf Utilities] Sending restart request...");
                        fetch("/holaf/utilities/restart", { method: 'POST' })
                            .then(res => res.json())
                            .then(data => {
                                if (data.status !== "ok") throw new Error(data.message || 'Unknown server error');

                                const timerEl = document.getElementById("holaf-restart-timer");
                                const refreshBtn = document.getElementById("holaf-restart-refresh-btn");
                                if (!messageEl || !timerEl || !refreshBtn) return;

                                messageEl.textContent = "The server is restarting. Waiting for it to go offline...";

                                let seconds = 0;
                                window.holaf.restartTimerInterval = setInterval(() => {
                                    seconds++;
                                    if (timerEl) timerEl.textContent = seconds;
                                }, 1000);

                                let serverIsDown = false;
                                const checkServerStatus = () => {
                                    fetch(window.location.origin, { method: 'HEAD', cache: 'no-cache' })
                                        .then(response => {
                                            if (response.ok) {
                                                if (serverIsDown) {
                                                    clearInterval(window.holaf.restartMonitorInterval);
                                                    clearInterval(window.holaf.restartTimerInterval);
                                                    delete window.holaf.restartMonitorInterval;
                                                    delete window.holaf.restartTimerInterval;

                                                    if (!messageEl || !refreshBtn) return;

                                                    messageEl.innerHTML = `✅ Server has rebooted successfully in <strong>${seconds}</strong> seconds.`;
                                                    if (timerLineEl) timerLineEl.style.visibility = "hidden";
                                                    refreshBtn.textContent = "Refresh Page";
                                                    refreshBtn.disabled = false;
                                                    refreshBtn.onclick = () => location.reload();
                                                    refreshBtn.focus();
                                                }
                                            } else {
                                                if (!serverIsDown) {
                                                    console.log(`[Holaf Utilities] Server is responding with error ${response.status}. Treating as offline.`);
                                                    if (messageEl) messageEl.textContent = "Server is offline. Monitoring for reconnection...";
                                                    serverIsDown = true;
                                                }
                                            }
                                        })
                                        .catch(() => {
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
                        return false;
                    });
                } 
                else if (itemInfo.special === "toggle_monitor") {
                    const monitor = app.holafSystemMonitor;
                    if (monitor && typeof monitor.toggle === "function") {
                        monitor.toggle();
                        updateCheckboxUI();
                    }
                } 
                else if (itemInfo.special === "toggle_layout_tools") {
                    if (window.holaf && window.holaf.layoutTools) {
                        window.holaf.layoutTools.toggle();
                        updateCheckboxUI();
                    }
                } 
                else if (itemInfo.special === "toggle_shortcuts") {
                    if (app.holafShortcuts && typeof app.holafShortcuts.toggle === "function") {
                        app.holafShortcuts.toggle();
                        updateCheckboxUI();
                    }
                } 
                else if (itemInfo.special === "toggle_compact_menu") {
                    const newState = !this.isCompactMode;
                    this.isCompactMode = newState;
                    localStorage.setItem("Holaf_CompactMenu", newState);
                    
                    // [FIX 1] Hide dropdown immediately to avoid visual glitch
                    this.hideDropdown();
                    
                    this.toggleCompactMode(newState);
                    updateCheckboxUI();
                    return; // Return early since we hid the dropdown manually
                }
                else if (itemInfo.special === "profiler_standalone") {
                    window.open('/holaf/profiler/view', '_blank');
                } 
                else {
                    const handler = app[itemInfo.handlerName];
                    if (handler && typeof handler.show === 'function') {
                        handler.show();
                    } else {
                        console.error(`[Holaf Utilities] Handler for "${itemInfo.label}" not available.`);
                        HolafModal.show("Not Implemented", `The panel for "${itemInfo.label}" is not available yet.`, () => { }, "OK", null);
                    }
                }
                
                // For other items, close menu
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
                this.dropdownMenuEl.querySelectorAll('li').forEach(li => {
                    const check = li.querySelector('div');
                    const text = li.textContent;
                    if (check) {
                        let isActive = false;
                        if (text.includes("Monitor")) isActive = app.holafSystemMonitor?.isVisible;
                        else if (text.includes("Layout Tools")) isActive = window.holaf?.layoutTools?.isVisible;
                        else if (text.includes("Shortcuts")) isActive = app.holafShortcuts?.isVisible;
                        else if (text.includes("Compact Menu")) isActive = this.isCompactMode;
                        
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
            console.error("[Holaf Utilities] Could not find settings button.");
            const comfyMenu = document.querySelector(".comfy-menu");
            if (comfyMenu) {
                comfyMenu.append(menuContainer);
            } else {
                document.body.prepend(menuContainer);
            }
        }

        console.log("[Holaf Utilities] Static menu initialized successfully.");
    },

    initBridgeListener() {
        const bc = new BroadcastChannel('holaf_channel');
        bc.onmessage = async (event) => {
            const { command, data } = event.data;
            if (command === 'get_workflow_for_profiler') {
                try {
                    const workflowData = await app.graphToPrompt(); 
                    const visualGraph = app.graph.serialize();
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
        };
    },

    toggleCompactMode(active) {
        const tabsContainer = document.querySelector('.workflow-tabs-container');
        const menuBar = document.querySelector('.actionbar-container');
        
        if (!tabsContainer || !menuBar) {
            console.warn("[Holaf Utilities] Compact Mode: Elements not found (yet).");
            return;
        }

        if (active) {
            if (tabsContainer.parentElement.id === "holaf-compact-wrapper") return;

            // [FIX 2] Create a Placeholder to know exactly where to put the menu back
            this.placeholderEl = document.createComment("holaf-menu-placeholder");
            if (menuBar.parentNode) {
                menuBar.parentNode.insertBefore(this.placeholderEl, menuBar);
            }

            // Create Wrapper V4
            const wrapper = document.createElement('div');
            wrapper.id = "holaf-compact-wrapper";
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.width = '100%';
            wrapper.style.overflow = 'hidden';
            
            tabsContainer.parentNode.insertBefore(wrapper, tabsContainer);
            wrapper.appendChild(tabsContainer);
            wrapper.appendChild(menuBar);
            
            // Critical Styles
            tabsContainer.style.flex = '1';
            tabsContainer.style.minWidth = '0';
            
            menuBar.style.flexShrink = '0';
            menuBar.style.height = '100%';
            menuBar.style.border = 'none';
            menuBar.style.boxShadow = 'none';
            
            console.log("[Holaf Utilities] Compact Mode Enabled.");

        } else {
            const wrapper = document.getElementById("holaf-compact-wrapper");
            
            if (wrapper && wrapper.contains(tabsContainer)) {
                // Restore tabs
                wrapper.parentNode.insertBefore(tabsContainer, wrapper);
                
                // [FIX 2] Restore menu to its EXACT original position via placeholder
                if (this.placeholderEl && this.placeholderEl.parentNode) {
                    this.placeholderEl.parentNode.insertBefore(menuBar, this.placeholderEl);
                    this.placeholderEl.remove();
                    this.placeholderEl = null;
                } else {
                    // Fallback if placeholder lost (e.g. reload): put it after tabs
                    console.warn("[Holaf Utilities] Placeholder lost, falling back to default position.");
                    tabsContainer.parentNode.insertBefore(menuBar, tabsContainer.nextSibling);
                }
                
                // Remove wrapper
                wrapper.remove();
                
                // Reset Styles
                tabsContainer.style.flex = '';
                tabsContainer.style.minWidth = '';
                
                menuBar.style.flexShrink = '';
                menuBar.style.height = '';
                menuBar.style.border = '';
                menuBar.style.boxShadow = '';
                menuBar.style.width = ''; // Ensure width is reset
                
                console.log("[Holaf Utilities] Compact Mode Disabled.");
            }
        }
    },

    showDropdown(buttonElement) {
        if (!this.dropdownMenuEl) return;
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
            "holaf_profiler.css",
            "holaf_layout_tools.css"
        ];
        const basePath = "extensions/ComfyUI-Holaf-Utilities/css/";
        cssFiles.forEach(fileName => {
            const cssId = `holaf-css-${fileName.replace('.css', '')}`;
            if (!document.getElementById(cssId)) {
                const link = document.createElement("link");
                link.id = cssId;
                link.rel = "stylesheet";
                link.type = "text/css";
                link.href = basePath + fileName;
                document.head.appendChild(link);
            }
        });
    }
};

app.registerExtension({
    name: "Holaf.Utilities.Menu",
    async setup() {
        setTimeout(() => HolafUtilitiesMenu.init(), 10);
    }
});