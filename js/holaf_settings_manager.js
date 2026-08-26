/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Global Settings Manager
 *
 * This script creates and manages the main settings panel for Holaf utilities.
 *
 * Since the AIH UI fusion, the panel is tabbed:
 *   - "General"             : native Holaf settings (theme, WIP modules toggle).
 *   - "AIH · Compte"        : AIH account (server URL + API key), rendered by
 *                             window.AIHMenu.renderAccountTab() (js/aih_menu.js).
 *   - "AIH · Provider LLM"  : AIH LLM presets CRUD, rendered by
 *                             window.AIHMenu.renderProviderTab().
 * The AIH tabs delegate 100% of their logic to js/aih_menu.js — no duplication.
 */

import { app } from "./holaf_api_compat.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";
import { HOLAF_THEMES } from "./holaf_themes.js";

const HolafSettingsManager = {
    name: "Holaf.SettingsManager",
    panelEl: null,
    contentEl: null,
    activeTab: "general",

    TABS: [
        { id: "general", label: "General" },
        { id: "aih-account", label: "AIH · Compte" },
        { id: "aih-providers", label: "AIH · Provider LLM" },
    ],

    init() {
        // The panel is created on-demand.
    },

    /**
     * Show the settings window.
     * @param {object} [options] - { tab?: string } activates the given tab id.
     */
    show(options = {}) {
        if (options.tab && this.TABS.some(t => t.id === options.tab)) {
            this.activeTab = options.tab;
        }
        if (!this.TABS.some(t => t.id === this.activeTab)) {
            this.activeTab = "general";
        }

        if (this.panelEl && document.body.contains(this.panelEl)) {
            this.panelEl.style.display = 'flex';
            HolafPanelManager.bringToFront(this.panelEl);
            this.renderActiveTab();
            return;
        }

        this.createPanel();
        this.populatePanel();
    },

    createPanel() {
        const { panelEl, contentEl } = HolafPanelManager.createPanel({
            id: "holaf-settings-panel",
            title: "Holaf Utilities - Settings",
            defaultSize: { width: 560, height: 480 }, // Roomy enough for the AIH tabs
            onClose: () => {
                this.panelEl = null;
                this.contentEl = null;
            }
        });

        this.panelEl = panelEl;
        this.contentEl = contentEl;

        // Ensure the panel itself has the correct theme class initially
        const currentTheme = localStorage.getItem("Holaf_Theme") || "holaf-theme-graphite-orange";
        this.panelEl.classList.add(currentTheme);
    },

    populatePanel() {
        // Tab bar + shared content container. Tab contents are re-rendered on
        // every switch (renderActiveTab), so state never goes stale.
        this.contentEl.innerHTML = "";

        const tabsBar = document.createElement("div");
        tabsBar.className = "holaf-settings-tabs";

        this.TABS.forEach(tab => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.id = `holaf-settings-tab-${tab.id}`;
            btn.className = "holaf-settings-tab-btn";
            btn.textContent = tab.label;
            btn.addEventListener("click", () => {
                this.activeTab = tab.id;
                this.renderActiveTab();
            });
            tabsBar.appendChild(btn);
        });

        const tabContent = document.createElement("div");
        tabContent.className = "holaf-settings-tab-content";
        tabContent.id = "holaf-settings-tab-content";

        this.contentEl.style.display = "flex";
        this.contentEl.style.flexDirection = "column";
        this.contentEl.append(tabsBar, tabContent);

        this.renderActiveTab();
    },

    renderActiveTab() {
        if (!this.contentEl) return;
        const container = this.contentEl.querySelector("#holaf-settings-tab-content");
        if (!container) return;

        // Reflect active state on the tab buttons
        this.TABS.forEach(tab => {
            const btn = this.contentEl.querySelector(`#holaf-settings-tab-${tab.id}`);
            if (btn) btn.classList.toggle("active", tab.id === this.activeTab);
        });

        if (this.activeTab === "general") {
            this.renderGeneralTab(container);
        } else if (this.activeTab === "aih-account") {
            this.renderAihTab(container, "renderAccountTab", "Compte");
        } else if (this.activeTab === "aih-providers") {
            this.renderAihTab(container, "renderProviderTab", "Provider LLM");
        }
    },

    /**
     * Delegate an AIH tab to window.AIHMenu (js/aih_menu.js), with a graceful
     * message when the AIH menu helpers are not loaded yet.
     */
    renderAihTab(container, fnName, label) {
        container.innerHTML = "";
        const renderFn = window.AIHMenu?.[fnName];
        if (typeof renderFn === "function") {
            try {
                renderFn(container);
                return;
            } catch (err) {
                const errorP = document.createElement("p");
                errorP.style.cssText = "color: var(--holaf-error-color, #F44336); font-size: 12px;";
                errorP.textContent = `Erreur onglet AIH « ${label} » : ${err?.message || err}`;
                container.appendChild(errorP);
                return;
            }
        }
        const infoP = document.createElement("p");
        infoP.style.cssText = "color: var(--holaf-text-secondary, #888); font-size: 12px; line-height: 1.5;";
        infoP.textContent = `Le module AIH n'est pas encore chargé (js/aih_menu.js). Recharge la page pour accéder à l'onglet « ${label} ».`;
        container.appendChild(infoP);
    },

    // ── Native Holaf tab (theme + WIP modules) ──

    renderGeneralTab(container) {
        const currentTheme = localStorage.getItem("Holaf_Theme") || "holaf-theme-graphite-orange";
        const showWip = localStorage.getItem("Holaf_ShowWIP") === "true";

        // Build Theme Options HTML
        const themeOptionsHtml = HOLAF_THEMES.map(theme => {
            const isSelected = theme.className === currentTheme ? "selected" : "";
            return `<option value="${theme.className}" ${isSelected}>${theme.name}</option>`;
        }).join('');

        container.innerHTML = `
            <div class="holaf-settings-container" style="padding: 15px; gap: 20px;">

                <!-- Theme Selection -->
                <div class="holaf-settings-group">
                    <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 14px;">Appearance</h3>
                    <div class="holaf-settings-field" style="display: flex; flex-direction: column; gap: 5px;">
                        <label for="holaf-theme-select" style="font-size: 12px;">UI Theme</label>
                        <select id="holaf-theme-select" style="outline: none; cursor: pointer;">
                            ${themeOptionsHtml}
                        </select>
                        <span class="holaf-settings-field-description" style="font-size: 11px;">Changes the color scheme of Holaf's floating panels. Applies instantly.</span>
                    </div>
                </div>

                <!-- Features Toggle -->
                <div class="holaf-settings-group">
                    <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 14px;">Features</h3>
                    <div class="holaf-settings-field" style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="holaf-wip-checkbox" ${showWip ? "checked" : ""} style="cursor: pointer; width: 16px; height: 16px;">
                        <label for="holaf-wip-checkbox" style="font-size: 12px; cursor: pointer;">Show Work-In-Progress (WIP) Modules</label>
                    </div>
                    <span class="holaf-settings-field-description" style="display: block; margin-top: 5px;">Displays in-development tools (Model Manager, Nodes Manager, Profiler) in the main menu.</span>
                </div>

            </div>
        `;

        // --- Event Listeners ---

        // 1. Theme Auto-Apply
        const themeSelect = container.querySelector("#holaf-theme-select");
        themeSelect.addEventListener("change", (e) => {
            const newTheme = e.target.value;

            // Remove old theme classes from body
            HOLAF_THEMES.forEach(t => document.body.classList.remove(t.className));

            // Add new theme class
            document.body.classList.add(newTheme);

            // Save preference
            localStorage.setItem("Holaf_Theme", newTheme);

            // Update the settings panel itself
            if (this.panelEl) {
                HOLAF_THEMES.forEach(t => this.panelEl.classList.remove(t.className));
                this.panelEl.classList.add(newTheme);
            }
        });

        // 2. WIP Checkbox Auto-Apply
        const wipCheckbox = container.querySelector("#holaf-wip-checkbox");
        wipCheckbox.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem("Holaf_ShowWIP", isChecked);

            // Dynamically rebuild the main menu to show/hide items
            if (window.holaf && typeof window.holaf.rebuildMenu === "function") {
                window.holaf.rebuildMenu();
            }
        });
    }
};

app.registerExtension({
    name: HolafSettingsManager.name,
    init() {
        HolafSettingsManager.init();
    },
    setup() {
        app.holafSettingsManager = HolafSettingsManager;
    }
});
