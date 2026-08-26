/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Global Settings Manager
 *
 * This script creates and manages the main settings panel for Holaf utilities.
 *
 * Since the AIH UI fusion, the panel is tabbed:
 *   - "General"             : native Holaf settings (theme, per-app WIP toggles).
 *   - "AIH · Compte"        : AIH account (server URL + API key), rendered by
 *                             window.AIHMenu.renderAccountTab() (js/aih_menu.js).
 *   - "AIH · Provider LLM"  : AIH LLM presets CRUD, rendered by
 *                             window.AIHMenu.renderProviderTab().
 * The AIH tabs delegate 100% of their logic to js/aih_menu.js — no duplication.
 */

import { app } from "./holaf_api_compat.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";
import { HOLAF_THEMES } from "./holaf_themes.js";
import { HolafWipManager, WIP_FEATURES } from "./holaf_wip_settings.js";
import { saveWindowRect, loadWindowRect } from "./holaf_window_utils.js";

const SETTINGS_RECT_KEY = "aih:settings-panel";

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
            // Persistance position/taille via le store unifié (clamp viewport).
            onStateChange: (rect) => {
                saveWindowRect(SETTINGS_RECT_KEY, {
                    left: rect.x,
                    top: rect.y,
                    width: rect.width,
                    height: rect.height,
                });
            },
            onClose: () => {
                this.panelEl = null;
                this.contentEl = null;
            }
        });

        this.panelEl = panelEl;
        this.contentEl = contentEl;

        // Restaure la position/taille persistée (avec clamp au viewport).
        const saved = loadWindowRect(SETTINGS_RECT_KEY);
        if (saved) {
            panelEl.style.transform = "none";
            panelEl.style.left = saved.left + "px";
            panelEl.style.top = saved.top + "px";
            panelEl.style.width = saved.width + "px";
            panelEl.style.height = saved.height + "px";
        }

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

        // Build Theme Options HTML
        const themeOptionsHtml = HOLAF_THEMES.map(theme => {
            const isSelected = theme.className === currentTheme ? "selected" : "";
            return `<option value="${theme.className}" ${isSelected}>${theme.name}</option>`;
        }).join('');

        // Build the per-feature WIP checkboxes.
        const wipRowsHtml = HolafWipManager.getFeatureList().map(feature => {
            const isChecked = HolafWipManager.isEnabled(feature.id) ? "checked" : "";
            const parentNote = feature.parent
                ? `<span class="holaf-settings-field-description" style="display:block;margin-left:26px;font-size:11px;opacity:.75;">Nécessite « ${WIP_FEATURES[feature.parent]?.label ?? feature.parent} » activé.</span>`
                : "";
            return `
                <div class="holaf-settings-field" style="display:flex;align-items:flex-start;gap:10px;margin-top:6px;">
                    <input type="checkbox" id="holaf-wip-${feature.id}" data-wip-feature="${feature.id}" ${isChecked} style="cursor:pointer;width:16px;height:16px;margin-top:1px;">
                    <div style="display:flex;flex-direction:column;gap:1px;">
                        <label for="holaf-wip-${feature.id}" style="font-size:12px;cursor:pointer;">${feature.label}</label>
                        ${feature.description ? `<span class="holaf-settings-field-description" style="font-size:11px;opacity:.8;">${feature.description}</span>` : ""}
                        ${parentNote}
                    </div>
                </div>`;
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

                <!-- Applications WIP -->
                <div class="holaf-settings-group">
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <h3 style="margin: 0 0 10px 0; font-size: 14px;">Applications WIP</h3>
                        <button type="button" id="holaf-wip-reset" style="font-size:11px;padding:2px 8px;cursor:pointer;background:transparent;border:1px solid var(--holaf-accent-color,#ff8c00);color:var(--holaf-accent-color,#ff8c00);border-radius:4px;">Réinitialiser</button>
                    </div>
                    <div class="holaf-settings-field" style="font-size:12px;">
                        Affiche ou masque chaque application en développement, indépendamment, dans le menu principal.
                    </div>
                    ${wipRowsHtml}
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

        // 2. Per-feature WIP checkboxes: persist each choice independently.
        const applyWipChange = (checkbox) => {
            const featureId = checkbox.dataset.wipFeature;
            if (!featureId) return;
            HolafWipManager.setEnabled(featureId, checkbox.checked);

            // Dynamically rebuild the main menu to show/hide items.
            if (window.holaf && typeof window.holaf.rebuildMenu === "function") {
                window.holaf.rebuildMenu();
            }
        };
        container.querySelectorAll("input[data-wip-feature]").forEach(cb => {
            cb.addEventListener("change", (e) => applyWipChange(e.target));
        });

        // 3. Reset: re-enable every WIP feature and refresh the panel + menu.
        const resetBtn = container.querySelector("#holaf-wip-reset");
        resetBtn.addEventListener("click", () => {
            HolafWipManager.resetAll();
            this.renderActiveTab();
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
