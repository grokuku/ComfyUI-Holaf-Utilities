/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Global Settings Manager
 *
 * This script creates and manages the main settings panel for Holaf utilities.
 */

import { app } from "./holaf_api_compat.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";
import { HOLAF_THEMES } from "./holaf_themes.js";

const HolafSettingsManager = {
    name: "Holaf.SettingsManager",
    panelEl: null,
    contentEl: null,

    init() {
        // The panel is created on-demand.
    },

    show() {
        if (this.panelEl && document.body.contains(this.panelEl)) {
            this.panelEl.style.display = 'flex';
            HolafPanelManager.bringToFront(this.panelEl);
            return;
        }

        this.createPanel();
        this.populatePanel();
    },

    createPanel() {
        const { panelEl, contentEl } = HolafPanelManager.createPanel({
            id: "holaf-settings-panel",
            title: "Holaf Utilities - Settings",
            defaultSize: { width: 450, height: 250 }, // Reduced size for minimal settings
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
        const currentTheme = localStorage.getItem("Holaf_Theme") || "holaf-theme-graphite-orange";
        const showWip = localStorage.getItem("Holaf_ShowWIP") === "true";

        // Build Theme Options HTML
        const themeOptionsHtml = HOLAF_THEMES.map(theme => {
            const isSelected = theme.className === currentTheme ? "selected" : "";
            return `<option value="${theme.className}" ${isSelected}>${theme.name}</option>`;
        }).join('');

        this.contentEl.innerHTML = `
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
        const themeSelect = this.contentEl.querySelector("#holaf-theme-select");
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
        const wipCheckbox = this.contentEl.querySelector("#holaf-wip-checkbox");
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