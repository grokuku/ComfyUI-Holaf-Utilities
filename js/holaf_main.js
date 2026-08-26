/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Main Menu Initializer
 */

import { app } from "./holaf_api_compat.js";
import { holafExtUrl } from "./holaf_ext_base.js";
import { HolafToastManager } from "./holaf_toast_manager.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";

import "./holaf_themes.js";
import "./holaf_terminal.js";
import "./holaf_model_manager.js";
import "./holaf_nodes_manager.js";
import "./holaf_image_viewer.js";
import "./holaf_settings_manager.js";
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
    _compactObserver: null,
    _compactWatchdog: null,

    init() {
        this.loadSharedCss();
        this.initBridgeListener();
        this.injectCompactCSS(); 

        this.isCompactMode = localStorage.getItem("Holaf_CompactMenu") === "true";
        if (this.isCompactMode) {
            this.waitForUIAndApplyCompact();
            this.startCompactWatchdog();
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
                        if (text.includes("Layout Tools")) isActive = window.holaf?.layoutTools?.isVisible;
                        else if (text.includes("Shortcuts")) isActive = app.holafShortcuts?.isVisible;
                        else if (text.includes("Remote Comparer")) isActive = app.holafRemoteComparer?.isOpen; 
                        else if (text.includes("Compact Menu")) isActive = this.isCompactMode;

                        check.innerHTML = isActive ? "✓" : "";
                        check.style.borderColor = isActive ? "var(--holaf-accent-color, #ff8c00)" : "var(--border-color, #888)";
                    }
                });

                // Entrées AIH dynamiques : pastille Blobby, visibilité Chat et
                // statut serveur du pied de menu rafraîchis à chaque ouverture.
                this.updateAihDynamicItems();
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
            { label: "Toggle Layout Tools", special: "toggle_layout_tools" },
            { label: "Toggle Shortcuts", special: "toggle_shortcuts" },
            { label: "Toggle Remote Comparer", special: "toggle_remote_comparer" },
            { type: 'separator' },
            { label: "Settings", handlerName: "holafSettingsManager" },
            { type: 'separator' },
            // ── Groupe AIH (fonctions portées de AI-Helper/web/js/aih_menu.js,
            //    exposées par js/aih_menu.js sur window.AIHMenu) ──
            { label: "🌐 Open Webpage", special: 'aih_webpage' },
            { label: "📤 Workflows", special: 'aih_workflows' },
            { label: "📦 Models", special: 'aih_models' },
            { label: "👥 Membres", special: 'aih_members' },
            { special: 'aih_blobby_toggle' },
            { label: "💬 Chat", special: 'aih_chat' },
            { type: 'separator' },
            { label: "🔄 AIH Update", special: 'aih_update' },
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

            // Ligne Blobby toggle : structure dédiée (icône + libellé dynamique
            // + pastille ON/OFF), ne ferme pas le menu au clic.
            if (itemInfo.special === 'aih_blobby_toggle') {
                this.dropdownMenuEl.appendChild(this.buildAihBlobbyToggleItem());
                return;
            }

            const menuItem = document.createElement("li");
            menuItem.style.display = "flex";
            menuItem.style.justifyContent = "space-between";
            menuItem.style.alignItems = "center";

            const labelSpan = document.createElement("span");
            labelSpan.textContent = itemInfo.label;
            menuItem.appendChild(labelSpan);

            // « 💬 Chat » : caché par défaut, révélé par updateAihDynamicItems
            // uniquement quand Blobby est actif.
            if (itemInfo.special === 'aih_chat') {
                menuItem.id = "holaf-menu-aih-chat";
                menuItem.style.display = "none";
            }

            let checkbox = null;
            if (["toggle_layout_tools", "toggle_shortcuts", "toggle_compact_menu", "toggle_remote_comparer"].includes(itemInfo.special)) {
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
                if (itemInfo.special === "toggle_layout_tools") {
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
                    this.startRestartFlow();
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
                else if (itemInfo.special === 'aih_chat') {
                    // Visible uniquement quand Blobby est actif (géré par
                    // updateAihDynamicItems) ; ne ferme pas le menu.
                    if (window.AIHMenu && typeof window.AIHMenu.openChat === "function") {
                        window.AIHMenu.openChat();
                    }
                }
                else if (itemInfo.special === 'aih_update') {
                    // Modale enrichie portée de la source (spinner + log git +
                    // proposition de redémarrage). Fallback : ancien flux toast
                    // si js/aih_menu.js n'est pas encore chargé.
                    if (window.AIHMenu && typeof window.AIHMenu.openUpdate === "function") {
                        window.AIHMenu.openUpdate();
                    } else {
                        this.checkForAIHUpdate();
                    }
                }
                else if (itemInfo.special && itemInfo.special.startsWith('aih_')) {
                    this.callAihMenuFn(itemInfo.special);
                }
                else {
                    const handler = app[itemInfo.handlerName];
                    if (handler && typeof handler.show === 'function') {
                        handler.show();
                    } else {
                        HolafPanelManager.createDialog({ title: "Not Implemented", message: `The panel for "${itemInfo.label}" is not available yet.`, buttons: [{ text: "OK", value: true }] });
                    }
                }

                // Le toggle Blobby et le Chat ne ferment pas le menu
                // (comportement de la source aih_menu.js).
                if (!checkbox && itemInfo.special !== 'aih_chat') {
                    this.hideDropdown();
                }
            };
            this.dropdownMenuEl.appendChild(menuItem);
        });

        // Pied de menu : statut du serveur AIH distant. Ligne passive,
        // rafraîchie à chaque ouverture du menu (voir updateAihDynamicItems).
        const statusLi = document.createElement("li");
        statusLi.id = "holaf-menu-aih-status";
        statusLi.textContent = "Statut : vérification...";
        Object.assign(statusLi.style, {
            borderTop: "1px solid var(--holaf-border-color, #3F3F3F)",
            marginTop: "5px",
            paddingTop: "8px",
            paddingBottom: "8px",
            fontSize: "11px",
            cursor: "default",
            pointerEvents: "none"
        });
        this.dropdownMenuEl.appendChild(statusLi);
        this.aihStatusEl = statusLi;

        // État dynamique initial (Blobby actif ? → pastille + visibilité Chat).
        setTimeout(() => this.updateAihDynamicItems(), 50);
    },

    // ── Groupe AIH ──
    // Délègue aux helpers portés dans js/aih_menu.js (window.AIHMenu).
    // NB : plus d'entrée « Paramètres » — les onglets AIH (Compte / Provider
    // LLM) vivent dans la fenêtre Settings Holaf (holaf_settings_manager.js),
    // et window.AIHMenu.openSettings() ouvre simplement cette fenêtre.
    callAihMenuFn(special) {
        const map = {
            aih_webpage: "openWebpage",
            aih_workflows: "openWorkflows",
            aih_models: "openModels",
            aih_members: "openMembers"
        };
        const fnName = map[special];
        if (fnName && window.AIHMenu && typeof window.AIHMenu[fnName] === "function") {
            window.AIHMenu[fnName]();
        } else {
            HolafPanelManager.createDialog({ title: "AIH", message: `The AIH module entry "${special}" is not available yet (js/aih_menu.js not loaded?).`, buttons: [{ text: "OK", value: true }] });
        }
    },

    // Ligne « 🧡 Activer Blobby ↔ Blobby (test) » avec pastille ON/OFF.
    // Le clic appelle window.BlobbyCompanion.toggle() via AIHMenu et NE
    // ferme PAS le menu (comportement de la source).
    buildAihBlobbyToggleItem() {
        const li = document.createElement("li");
        li.id = "holaf-menu-aih-blobby";
        li.style.display = "flex";
        li.style.alignItems = "center";
        li.style.gap = "8px";

        const icon = document.createElement("span");
        icon.textContent = "🧡";
        const labelSpan = document.createElement("span");
        labelSpan.className = "holaf-aih-blobby-label";
        labelSpan.style.flex = "1";
        const pill = document.createElement("span");
        pill.className = "holaf-aih-blobby-pill";
        Object.assign(pill.style, {
            fontSize: "10px",
            padding: "1px 6px",
            borderRadius: "4px",
            fontWeight: "600"
        });

        li.appendChild(icon);
        li.appendChild(labelSpan);
        li.appendChild(pill);

        li.onclick = () => {
            if (window.AIHMenu && typeof window.AIHMenu.toggleBlobby === "function") {
                window.AIHMenu.toggleBlobby();
                this.updateAihDynamicItems();
            }
            // Pas de hideDropdown() ici
        };
        return li;
    },

    // État dynamique des entrées AIH : libellé/pastille Blobby, visibilité
    // de « 💬 Chat » (uniquement si Blobby actif) et sonde de statut serveur
    // pour le pied de menu. Appelé à chaque construction ET ouverture du menu.
    updateAihDynamicItems() {
        const blobbyLi = document.getElementById("holaf-menu-aih-blobby");
        const chatLi = document.getElementById("holaf-menu-aih-chat");
        let active = false;
        try {
            active = !!(window.AIHMenu && window.AIHMenu.getBlobbyState && window.AIHMenu.getBlobbyState());
        } catch (e) {
            active = false;
        }

        if (blobbyLi) {
            const labelSpan = blobbyLi.querySelector(".holaf-aih-blobby-label");
            const pill = blobbyLi.querySelector(".holaf-aih-blobby-pill");
            if (labelSpan) labelSpan.textContent = active ? "Blobby (test)" : "Activer Blobby";
            if (pill) {
                pill.textContent = active ? "ON" : "OFF";
                pill.style.background = active ? "#166534" : "#555";
                pill.style.color = active ? "#86efac" : "#aaa";
            }
        }
        if (chatLi) {
            chatLi.style.display = active ? "flex" : "none";
        }

        if (this.aihStatusEl && window.AIHMenu && typeof window.AIHMenu.checkServerStatus === "function") {
            window.AIHMenu.checkServerStatus(this.aihStatusEl);
        }
    },

    // ── AIH Update ──
    // POST /aih/update applies the update on disk and answers {updated: bool}
    // (never restarts by itself). When something changed, propose the restart
    // via the shared Utils mechanism POST /holaf/utilities/restart.
    checkForAIHUpdate() {
        const toast = window.holaf?.toastManager;
        const waitId = toast ? toast.show({ message: "Checking for AIH update...", type: "info", duration: 0 }) : null;
        fetch("/aih/update", { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (waitId && toast) toast.hide(waitId);
                if (data.updated) {
                    HolafModal.show(
                        "AIH Update",
                        "Update installed on disk. Restart ComfyUI now to load the new version?",
                        () => { this.startRestartFlow(); return false; },
                        "Restart",
                        "Later"
                    );
                } else if (data.status === "error") {
                    if (toast) toast.show({ message: "AIH update failed: " + (data.message || "unknown error"), type: "error" });
                } else {
                    if (toast) toast.show({ message: "AIH is already up to date.", type: "success" });
                }
            })
            .catch(err => {
                if (waitId && toast) toast.hide(waitId);
                if (toast) toast.show({ message: "AIH update check failed: " + (err.message || "network error"), type: "error" });
            });
    },

    // ── Shared restart flow (used by "Restart ComfyUI" — the only restart
    //    entry, the separate AIH one having been removed — and by the
    //    post-update prompt) ──
    startRestartFlow() {
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
    },

    injectCompactCSS() {
        if (document.getElementById("holaf-compact-style-override")) return;
        
        this.styleEl = document.createElement("style");
        this.styleEl.id = "holaf-compact-style-override";
        this.styleEl.innerHTML = `
            /* MODE COMPACT (nouvelle topbar Vue/Tailwind).
               La carte d'actions est marquée .holaf-compact-card par maintainCompactParent()
               et remontée en haut à droite, dans la même rangée que les onglets. */

            body.holaf-compact-active [data-testid="topbar-workflow-tabs"] {
                padding-right: var(--holaf-compact-card-width, 480px) !important;
                box-sizing: border-box !important;
                width: 100% !important;
                max-width: 100% !important;
            }

            body.holaf-compact-active .holaf-compact-card {
                position: fixed !important;
                top: 0 !important;
                right: 0 !important;
                height: var(--workflow-tabs-height, 38px) !important;
                min-height: 0 !important;
                flex-direction: row !important;
                align-items: center !important;
                flex-wrap: nowrap !important;
                z-index: 1005 !important;
                margin: 0 !important;
                padding: 0 8px !important;
                border-radius: 0 !important;
                box-shadow: -4px 0 8px rgba(0,0,0,0.3) !important;
                background: var(--comfy-menu-bg, #202020) !important;
            }

            body.holaf-compact-active .holaf-compact-card > * {
                flex-shrink: 0 !important;
            }
        `;
        document.head.appendChild(this.styleEl);
    },

    maintainCompactParent() {
        if (!this.isCompactMode) return;
        const ac = document.querySelector('.actionbar-container');
        if (!ac) return;
        const card = ac.parentElement;
        if (!card) return;

        // Marque la carte d'actions avec notre propre classe stable. La classe
        // native .action-bar-card n'est pas fiable (elle apparaît/disparaît).
        card.classList.add('holaf-compact-card');

        // Mesure la largeur réelle de la carte et la communique au CSS pour que
        // le padding-right des onglets corresponde exactement à la barre.
        const width = Math.round(card.getBoundingClientRect().width);
        document.documentElement.style.setProperty('--holaf-compact-card-width', width + 'px');
    },

    startCompactWatchdog() {
        // Filet de sécurité : la topbar Vue de ComfyUI est montée de façon
        // asynchrone (parfois bien après le chargement initial, ou re-rendue
        // plus tard). Ce watchdog basse fréquence ré-applique le mode compact
        // tant qu'il est actif, même si waitForUIAndApplyCompact a échoué ou
        // expiré après son timeout de 10 s.
        if (this._compactWatchdog) return;
        this._compactWatchdog = setInterval(() => {
            if (!this.isCompactMode) return;
            const tabs = document.querySelector('.workflow-tabs-container');
            const bar = document.querySelector('.actionbar-container');
            if (!tabs || !bar) return;
            if (!document.body.classList.contains("holaf-compact-active") || !this._compactObserver) {
                this.toggleCompactMode(true);
            } else {
                this.maintainCompactParent();
            }
        }, 2000);
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
                    window.holaf.toastManager.show({ message: "Workflow synced with Profiler.", type: "success" });
                } catch (e) {
                    window.holaf.toastManager.show({ message: "Error syncing workflow.", type: "error" });
                }
            }
        };
    },

    toggleCompactMode(active) {
        if (active) {
            document.body.classList.add("holaf-compact-active");
            this.maintainCompactParent();
            this.startCompactWatchdog();

            // Clean up any previous enforcer
            if (this.startupEnforcerInterval) clearInterval(this.startupEnforcerInterval);
            if (this._compactObserver) this._compactObserver.disconnect();

            // Short burst enforcer for initial setup (handles late DOM insertions)
            let ticks = 0;
            this.startupEnforcerInterval = setInterval(() => {
                this.maintainCompactParent();
                ticks++;
                // Increased to 10s (was 5s) because some ComfyUI extensions inject the action bar
            // asynchronously well after initial page load, causing compact mode to miss it.
            if (ticks > 20) {
                    clearInterval(this.startupEnforcerInterval);
                    this.startupEnforcerInterval = null;
                }
            }, 500);

            // Long-term observer: re-apply when ComfyUI moves/replaces the action bar.
            // Debounced to avoid excessive calls on busy pages with frequent DOM mutations.
            let _compactDebounce = null;
            this._compactObserver = new MutationObserver(() => {
                clearTimeout(_compactDebounce);
                _compactDebounce = setTimeout(() => {
                    if (this.isCompactMode) this.maintainCompactParent();
                }, 50);
            });
            this._compactObserver.observe(document.body, { childList: true, subtree: true });

        } else {
            document.body.classList.remove("holaf-compact-active");
            if (this.startupEnforcerInterval) {
                clearInterval(this.startupEnforcerInterval);
                this.startupEnforcerInterval = null;
            }
            if (this._compactObserver) {
                this._compactObserver.disconnect();
                this._compactObserver = null;
            }
            if (this._compactWatchdog) {
                clearInterval(this._compactWatchdog);
                this._compactWatchdog = null;
            }
            
            document.querySelectorAll('.holaf-compact-parent, .holaf-compact-card').forEach(el => {
                el.classList.remove('holaf-compact-parent', 'holaf-compact-card');
            });
            document.documentElement.style.removeProperty('--holaf-compact-card-width');
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
            "holaf_toasts.css",
            "holaf_profiler.css",
            "holaf_layout_tools.css",
            "holaf_remote_comparer_styles.css",
            "holaf_shortcuts_styles.css"
        ];
        cssFiles.forEach(fileName => {
            const cssId = `holaf-css-${fileName.replace('.css', '')}`;
            if (!document.getElementById(cssId)) {
                const link = document.createElement("link");
                link.id = cssId;
                link.rel = "stylesheet";
                link.type = "text/css";
                link.href = holafExtUrl(`css/${fileName}`);
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