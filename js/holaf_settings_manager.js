/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Global Settings Manager
 *
 * This script creates and manages the main settings panel for all Holaf utilities.
 * CORRECTION: Rewritten to use the official HolafPanelManager object and its API.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";
import { HOLAF_THEMES } from "./holaf_themes.js";
import { api } from "../../../scripts/api.js";

const HolafSettingsManager = {
    name: "Holaf.SettingsManager",
    settingsData: null,
    panelEl: null,
    contentEl: null,

    init() {
        // The panel is created on-demand.
    },

    async show() {
        if (this.panelEl && document.body.contains(this.panelEl)) {
            this.panelEl.style.display = 'flex';
            HolafPanelManager.bringToFront(this.panelEl);
            return;
        }

        this.createPanel();
        await this.loadSettings();
        this.populatePanel();
    },

    createPanel() {
        const { panelEl, contentEl } = HolafPanelManager.createPanel({
            id: "holaf-settings-panel",
            title: "Holaf Utilities - Settings",
            defaultSize: { width: 600, height: 500 },
            onClose: () => {
                this.panelEl = null;
                this.contentEl = null;
            }
        });

        this.panelEl = panelEl;
        this.contentEl = contentEl;

        // Apply the first available theme as a default
        this.panelEl.classList.add(HOLAF_THEMES[0].className);

        this.contentEl.innerHTML = `<div class="holaf-settings-content"><p>Loading settings...</p></div>`;
    },

    async loadSettings() {
        try {
            const response = await api.fetchApi("/holaf/utilities/settings");
            if (!response.ok) {
                throw new Error(`Failed to load settings: ${response.statusText}`);
            }
            this.settingsData = await response.json();
        } catch (error) {
            console.error("[Holaf Settings] Error loading settings:", error);
            this.contentEl.innerHTML = `<p class="error">Error loading settings. Check the console for details.</p>`;
            this.settingsData = null;
        }
    },

    populatePanel() {
        if (!this.settingsData) return;

        this.contentEl.innerHTML = `
            <div class="holaf-settings-container">
                <div class="holaf-settings-toolbar">
                    <button id="holaf-settings-save-btn" class="comfy-button">Save and Apply</button>
                    <span id="holaf-settings-status" class="holaf-settings-status-indicator"></span>
                </div>
                <div id="holaf-settings-form-area" class="holaf-settings-form">
                    <!-- Settings will be built here by JS -->
                </div>
            </div>
        `;

        const formArea = this.contentEl.querySelector("#holaf-settings-form-area");

        const settingsMap = {
            "Terminal": {
                label: "Terminal",
                description: "Core settings for the terminal functionality.",
                fields: {
                    shell_command: { label: "Shell Command", description: "e.g., cmd.exe, powershell.exe, bash, zsh" }
                }
            },
            "TerminalUI": {
                label: "Terminal UI",
                description: "Visual appearance of the Terminal panel.",
                fields: {
                    font_size: { label: "Font Size", description: "Font size in pixels for the terminal text.", type: "number" }
                }
            },
            "ModelManagerUI": {
                label: "Model Manager UI",
                description: "Visual appearance and behavior of the Model Manager.",
                fields: {
                    zoom_level: { label: "Default Zoom Level", description: "e.g., 0.8, 1.0, 1.2", type: "number", step: 0.1 }
                }
            },
            "ImageViewerUI": {
                label: "Image Viewer UI",
                description: "Visual appearance and behavior of the Image Viewer.",
                fields: {
                    thumbnail_size: { label: "Thumbnail Size", description: "Size of the square thumbnails in pixels.", type: "number" },
                    thumbnail_fit: { label: "Thumbnail Fit Mode", description: "How images fit in thumbnails.", type: "select", options: ["cover", "contain"] }
                }
            }
        };

        for (const sectionKey in settingsMap) {
            if (this.settingsData[sectionKey]) {
                const sectionInfo = settingsMap[sectionKey];

                const group = document.createElement('div');
                group.className = 'holaf-settings-group';
                group.innerHTML = `
                    <h3>${sectionInfo.label}</h3>
                    <p class="holaf-settings-group-description">${sectionInfo.description}</p>
                `;

                for (const fieldKey in sectionInfo.fields) {
                    if (this.settingsData[sectionKey].hasOwnProperty(fieldKey)) {
                        const fieldInfo = sectionInfo.fields[fieldKey];
                        const currentValue = this.settingsData[sectionKey][fieldKey];

                        const fieldEl = document.createElement('div');
                        fieldEl.className = 'holaf-settings-field';

                        let inputHtml = '';
                        const inputId = `holaf-setting-${sectionKey}-${fieldKey}`;

                        if (fieldInfo.type === 'select') {
                            const optionsHtml = fieldInfo.options.map(opt =>
                                `<option value="${opt}" ${opt === currentValue ? 'selected' : ''}>${opt}</option>`
                            ).join('');
                            inputHtml = `<select id="${inputId}" data-section="${sectionKey}" data-key="${fieldKey}">${optionsHtml}</select>`;
                        } else {
                            const inputType = fieldInfo.type || 'text';
                            const stepAttr = fieldInfo.step ? `step="${fieldInfo.step}"` : '';
                            inputHtml = `<input type="${inputType}" id="${inputId}" value="${currentValue || ''}" data-section="${sectionKey}" data-key="${fieldKey}" ${stepAttr}>`;
                        }

                        fieldEl.innerHTML = `
                            <label for="${inputId}">${fieldInfo.label}</label>
                            ${inputHtml}
                            <p class="holaf-settings-field-description">${fieldInfo.description}</p>
                        `;
                        group.appendChild(fieldEl);
                    }
                }
                formArea.appendChild(group);
            }
        }

        this.contentEl.querySelector("#holaf-settings-save-btn").addEventListener("click", this.saveSettings.bind(this));
    },

    async saveSettings() {
        const statusEl = this.panelEl.querySelector("#holaf-settings-status");
        statusEl.textContent = "Saving...";
        statusEl.style.color = "var(--holaf-text-secondary)";

        const inputs = this.panelEl.querySelectorAll("input[data-section], select[data-section]");
        const updatedSettings = {};

        inputs.forEach(input => {
            const section = input.dataset.section;
            const key = input.dataset.key;

            if (!updatedSettings[section]) {
                updatedSettings[section] = {};
            }

            let value = input.value;
            if (input.type === 'number') {
                value = parseFloat(value);
            } else if (value === '') {
                value = null; // Send null to remove the key from config.ini
            }

            updatedSettings[section][key] = value;
        });

        try {
            const response = await api.fetchApi("/holaf/utilities/save-all-settings", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedSettings)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP error ${response.status}`);
            }

            statusEl.textContent = "Settings saved! A restart may be required for some changes.";
            statusEl.style.color = "lime";

            await this.loadSettings();

        } catch (error) {
            console.error("[Holaf Settings] Error saving settings:", error);
            statusEl.textContent = `Error: ${error.message}`;
            statusEl.style.color = "#ff8a8a";
        } finally {
            setTimeout(() => { statusEl.textContent = ""; }, 5000);
        }
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