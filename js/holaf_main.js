/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Main Menu Initializer
 */

import { app } from "./holaf_api_compat.js";
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
import "./holaf_remote_comparer.js";

const HolafModal = {
    show(title, messageOrElement, onConfirm, confirmText = "Confirm", cancelText = "Cancel") {
        const existingModal = document.getElementById("holaf-modal-overlay");
        if (existingModal) existingModal.remove();

        const overlay = document.createElement("div");
        overlay.id = "holaf-modal-overlay";

        const currentTheme = document.body.className.match(/holaf-theme-\S+/)?.[0] || 'holaf-theme-graphite-orange';

        const dialog = document.createElement("div");
        dialog.id = "holaf-modal-dialog";
        dialog.className = currentTheme;

        // Build modal DOM safely (no innerHTML with user data)
        const header = document.createElement("div");
        header.className = "holaf-utility-header";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = title;
        header.appendChild(titleSpan);

        const content = document.createElement("div");
        content.className = "holaf-modal-content";
        // Accept either a string (rendered as text) or a DOM element (appended directly)
        if (typeof messageOrElement === "string") {
            content.textContent = messageOrElement;
        } else if (messageOrElement instanceof HTMLElement) {
            content.appendChild(messageOrElement);
        }

        const footer = document.createElement("div");
        footer.className = "holaf-modal-footer";
        const cancelBtn = document.createElement("button");
        cancelBtn.id = "holaf-modal-cancel";
        cancelBtn.className = "comfy-button secondary";
        cancelBtn.textContent = cancelText;
        const confirmBtn = document.createElement("button");
        confirmBtn.id = "holaf-modal-confirm";
        confirmBtn.className = "comfy-button";
        confirmBtn.textContent = confirmText;

        if (!cancelText) {
            cancelBtn.style.display = "none";
        }

        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);
        dialog.append(header, content, footer);

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

        confirmBtn.onclick = () => {
            if (onConfirm) {
                if (onConfirm() === false) return;
            }
            closeModal();
        };

        cancelBtn.onclick = closeModal;

        overlay.onclick = (e) => {
            if (e.target === overlay) closeModal();
        };
    }
};


const HolafUtilitiesMenu = {
    dropdownMenuEl: null,
    isCompactMode: false,
    styleEl: null,
    startupEnforcerInterval: null,

    init() {
        this.loadSharedCss();
        this.initBridgeListener();
        this.injectCompactCSS(); 

        this.isCompactMode = localStorage.getItem("Holaf_CompactMenu") === "true";
        if (this.isCompactMode) {
            this.waitForUIAndApplyCompact();
        }

        if (!document.body.className.includes("holaf-theme-")) {
            document.body.classList.add("holaf-theme-graphite-orange");
        }

        if (!window.holaf) {
            window.holaf = {};
        }
        window.holaf.toastManager = new HolafToastManager();
        
        window.holaf.rebuildMenu = () => this.buildMenu();

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
        this.dropdownMenuEl.style.zIndex = '10005';

        this.buildMenu(); 

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
                        else if (text.includes("Remote Comparer")) isActive = app.holafRemoteComparer?.isOpen; 
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

        const settingsButton = app.menu?.settingsGroup?.element;
        if (settingsButton) {
            settingsButton.before(menuContainer);
        } else {
            const comfyMenu = document.querySelector(".comfy-menu");
            if (comfyMenu) {
                comfyMenu.append(menuContainer);
            } else {
                document.body.prepend(menuContainer);
            }
        }
    },

    buildMenu() {
        if (!this.dropdownMenuEl) return;
        this.dropdownMenuEl.innerHTML = '';

        const showWip = localStorage.getItem("Holaf_ShowWIP") === "true";

        const menuItems =[
            { label: "Terminal", handlerName: "holafTerminal" },
            { label: "Model Manager (WIP)", handlerName: "holafModelManager", isWip: true },
            { label: "Custom Nodes Manager (WIP)", handlerName: "holafNodesManager", isWip: true },
            { label: "Image Viewer", handlerName: "holafImageViewer" },
            { label: "Workflow Profiler (WIP)", special: "profiler_standalone", isWip: true },
            { type: 'separator' },
            { label: "Compact Menu Bar", special: "toggle_compact_menu" },
            { type: 'separator' },
            { label: "Toggle Monitor", special: "toggle_monitor" },
            { label: "Toggle Layout Tools", special: "toggle_layout_tools" },
            { label: "Toggle Shortcuts", special: "toggle_shortcuts" },
            { label: "Toggle Remote Comparer", special: "toggle_remote_comparer" },
            { type: 'separator' },
            { label: "Settings", handlerName: "holafSettingsManager" },
            { type: 'separator' },
            { label: "Restart ComfyUI", special: 'restart' }
        ];

        const filteredItems = menuItems.filter(item => !item.isWip || showWip);

        filteredItems.forEach(itemInfo => {
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

            let checkbox = null;
            if (["toggle_monitor", "toggle_layout_tools", "toggle_shortcuts", "toggle_compact_menu", "toggle_remote_comparer"].includes(itemInfo.special)) {
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
                } else if (itemInfo.special === "toggle_remote_comparer") {
                    isActive = app.holafRemoteComparer?.isOpen;
                } else if (itemInfo.special === "toggle_compact_menu") {
                    isActive = this.isCompactMode;
                }
                checkbox.innerHTML = isActive ? "✓" : "";
                checkbox.style.borderColor = isActive ? "var(--holaf-accent-color, #ff8c00)" : "var(--border-color, #888)";
            };

            setTimeout(updateCheckboxUI, 50);

            menuItem.onclick = (e) => {
                if (itemInfo.special === 'restart') {
                    const restartDiv = document.createElement("div");
                    const restartMsg = document.createElement("p");
                    restartMsg.id = "holaf-restart-message";
                    restartMsg.textContent = "Are you sure you want to restart the ComfyUI server?";
                    restartDiv.appendChild(restartMsg);
                    const restartTimerLine = document.createElement("p");
                    restartTimerLine.id = "holaf-restart-timer-line";
                    restartTimerLine.style.cssText = "visibility: hidden; margin-top: 10px; height: 1.2em;";
                    restartTimerLine.appendChild(document.createTextNode("Time elapsed: "));
                    const restartTimerSpan = document.createElement("span");
                    restartTimerSpan.id = "holaf-restart-timer";
                    restartTimerSpan.textContent = "0";
                    restartTimerLine.appendChild(restartTimerSpan);
                    restartTimerLine.appendChild(document.createTextNode("s"));
                    restartDiv.appendChild(restartTimerLine);

                    HolafModal.show("Restart ComfyUI", restartDiv, () => {
                        const dialog = document.getElementById("holaf-modal-dialog");
                        if (!dialog) return;

                        const messageEl = document.getElementById("holaf-restart-message");
                        const timerLineEl = document.getElementById("holaf-restart-timer-line");

                        dialog.querySelector(".holaf-utility-header span").textContent = "Restarting Server";
                        messageEl.textContent = "Sending restart command...";
                        timerLineEl.style.visibility = "visible";

                        const footerEl = dialog.querySelector(".holaf-modal-footer");
                        footerEl.replaceChildren();
                        const restartCloseBtn = document.createElement("button");
                        restartCloseBtn.id = "holaf-restart-close-btn";
                        restartCloseBtn.className = "comfy-button secondary";
                        restartCloseBtn.textContent = "Close";
                        const restartRefreshBtn = document.createElement("button");
                        restartRefreshBtn.id = "holaf-restart-refresh-btn";
                        restartRefreshBtn.className = "comfy-button";
                        restartRefreshBtn.disabled = true;
                        restartRefreshBtn.textContent = "Refresh";
                        footerEl.appendChild(restartCloseBtn);
                        footerEl.appendChild(restartRefreshBtn);

                        const cleanupAndClose = () => {
                            const overlay = document.getElementById("holaf-modal-overlay");
                            if (overlay) overlay.remove();
                            if (window.holaf.restartMonitorInterval) clearInterval(window.holaf.restartMonitorInterval);
                            if (window.holaf.restartTimerInterval) clearInterval(window.holaf.restartTimerInterval);
                            delete window.holaf.restartMonitorInterval;
                            delete window.holaf.restartTimerInterval;
                        }

                        dialog.querySelector("#holaf-restart-close-btn").onclick = cleanupAndClose;

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

                                                    messageEl.textContent = "✅ Server has rebooted successfully in " + seconds + " seconds."
                                                    if (timerLineEl) timerLineEl.style.visibility = "hidden";
                                                    refreshBtn.textContent = "Refresh Page";
                                                    refreshBtn.disabled = false;
                                                    refreshBtn.onclick = () => location.reload();
                                                    refreshBtn.focus();
                                                }
                                            } else {
                                                if (!serverIsDown) {
                                                    if (messageEl) messageEl.textContent = "Server is offline. Monitoring for reconnection...";
                                                    serverIsDown = true;
                                                }
                                            }
                                        })
                                        .catch(() => {
                                            if (!serverIsDown) {
                                                if (messageEl) messageEl.textContent = "Server is offline. Monitoring for reconnection...";
                                                serverIsDown = true;
                                            }
                                        });
                                };

                                window.holaf.restartMonitorInterval = setInterval(checkServerStatus, 2000);
                            })
                            .catch(err => {
                                const errorP = document.createElement('p');
                                errorP.style.color = 'var(--holaf-error-color, #F44336)';
                                errorP.textContent = "Failed to send restart command to the server: " + (err.message || "Unknown error") + ".";
                                dialog.querySelector(".holaf-modal-content").replaceChildren(errorP);
                                const rb = dialog.querySelector("#holaf-restart-refresh-btn");
                                if (rb) rb.disabled = true;
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
                else if (itemInfo.special === "toggle_remote_comparer") {
                    if (app.holafRemoteComparer && typeof app.holafRemoteComparer.toggle === "function") {
                        app.holafRemoteComparer.toggle();
                        updateCheckboxUI();
                    }
                }
                else if (itemInfo.special === "toggle_compact_menu") {
                    const newState = !this.isCompactMode;
                    this.isCompactMode = newState;
                    localStorage.setItem("Holaf_CompactMenu", newState);

                    this.hideDropdown();
                    this.toggleCompactMode(newState);
                    updateCheckboxUI();
                    return;
                }
                else if (itemInfo.special === "profiler_standalone") {
                    window.open('/holaf/profiler/view', '_blank');
                }
                else {
                    const handler = app[itemInfo.handlerName];
                    if (handler && typeof handler.show === 'function') {
                        handler.show();
                    } else {
                        HolafModal.show("Not Implemented", `The panel for "${itemInfo.label}" is not available yet.`, () => { }, "OK", null);
                    }
                }

                if (!checkbox) {
                    this.hideDropdown();
                }
            };
            this.dropdownMenuEl.appendChild(menuItem);
        });
    },

    injectCompactCSS() {
        if (document.getElementById("holaf-compact-style-override")) return;
        
        this.styleEl = document.createElement("style");
        this.styleEl.id = "holaf-compact-style-override";
        this.styleEl.innerHTML = `
            /* 1. Uniformisation du Conteneur : force la hauteur, la taille maximale et le contexte d'empilement */
            .holaf-compact-parent {
                position: relative !important;
                min-height: var(--comfy-tab-height, 40px) !important;
                width: 100% !important;
                max-width: 100vw !important; /* EMPÊCHE L'EXTENSION INFINIE due aux onglets */
                box-sizing: border-box !important;
                z-index: 1000 !important;
            }

            body.holaf-compact-active .workflow-tabs-container {
                padding-right: 480px !important; /* Marge sûre pour que les onglets ne glissent pas sous les boutons */
                box-sizing: border-box !important;
                width: 100% !important;
                max-width: 100% !important;
                position: relative !important;
                z-index: 1 !important;
                overflow-x: auto !important; /* GÈRE LE DEBORDEMENT DES ONGLETS */
                overflow-y: hidden !important;
            }

            /* 2. Correction du Clipping et positionnement absolu strict */
            body.holaf-compact-active .actionbar-container {
                position: absolute !important;
                top: 0 !important;
                right: 0 !important;
                height: var(--comfy-tab-height, 40px) !important;
                width: auto !important;
                z-index: 1005 !important;
                background: var(--bg-color, #202020) !important; /* Masque les onglets glissant en dessous */
                border: none !important;
                box-shadow: -4px 0 8px rgba(0,0,0,0.3) !important; /* Séparation visuelle nette */
                display: flex !important;
                align-items: center !important;
                flex-wrap: nowrap !important;
                margin: 0 !important;
                padding: 0 8px !important;
            }

            body.holaf-compact-active .actionbar-container > * {
                flex-shrink: 0 !important; /* Empêche l'écrasement des boutons de menu */
                margin: 0 2px !important;
            }
        `;
        document.head.appendChild(this.styleEl);
    },

    maintainCompactParent() {
        if (!this.isCompactMode) return;
        const menuBar = document.querySelector('.actionbar-container');
        const tabs = document.querySelector('.workflow-tabs-container');

        if (menuBar) {
            let targetParent = menuBar.parentElement;
            
            if (tabs) {
                let current = menuBar.parentElement;
                while (current && current !== document.body && !current.contains(tabs)) {
                    current = current.parentElement;
                }
                if (current && current !== document.body) {
                    targetParent = current;
                }
            }

            if (targetParent) {
                if (!targetParent.classList.contains('holaf-compact-parent')) {
                    document.querySelectorAll('.holaf-compact-parent').forEach(el => {
                        el.classList.remove('holaf-compact-parent');
                    });
                    targetParent.classList.add('holaf-compact-parent');
                }
            }
        }
    },

    waitForUIAndApplyCompact() {
        const checkAndApply = () => {
            const tabs = document.querySelector('.workflow-tabs-container');
            const bar = document.querySelector('.actionbar-container');
            if (tabs && bar) {
                this.toggleCompactMode(true);
                return true;
            }
            return false;
        };

        if (checkAndApply()) return;

        const observer = new MutationObserver(() => {
            if (checkAndApply()) {
                observer.disconnect();
                clearTimeout(timeoutId);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        const timeoutId = setTimeout(() => observer.disconnect(), 10000);
    },

    initBridgeListener() {
        const bc = new BroadcastChannel('holaf_channel');
        bc.onmessage = async (event) => {
            const { command, data } = event.data;
            if (command === 'get_workflow_for_profiler') {
                try {
                    const visualGraph = app.graph.serialize();
                    await fetch('/holaf/profiler/context', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(visualGraph)
                    });
                    window.holaf.toastManager.show("Workflow synced with Profiler.", "success");
                } catch (e) {
                    window.holaf.toastManager.show("Error syncing workflow.", "error");
                }
            }
        };
    },

    toggleCompactMode(active) {
        if (active) {
            document.body.classList.add("holaf-compact-active");
            this.maintainCompactParent();

            let ticks = 0;
            if (this.startupEnforcerInterval) clearInterval(this.startupEnforcerInterval);
            this.startupEnforcerInterval = setInterval(() => {
                this.maintainCompactParent();
                ticks++;
                if (ticks > 10) { 
                    clearInterval(this.startupEnforcerInterval);
                }
            }, 500);

        } else {
            document.body.classList.remove("holaf-compact-active");
            if (this.startupEnforcerInterval) clearInterval(this.startupEnforcerInterval);
            
            document.querySelectorAll('.holaf-compact-parent').forEach(el => {
                el.classList.remove('holaf-compact-parent');
            });
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
        const cssFiles =[
            "holaf_themes.css",
            "holaf_shared_panel.css",
            "holaf_main_button.css",
            "holaf_model_manager_styles.css",
            "holaf_terminal_styles.css",
            "holaf_nodes_manager_styles.css",
            "holaf_settings_panel_styles.css",
            "holaf_system_monitor_styles.css",
            "holaf_toasts.css",
            "holaf_profiler.css",
            "holaf_layout_tools.css",
            "holaf_remote_comparer_styles.css",
            "holaf_shortcuts_styles.css"
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