/*
 * Holaf Utilities - Model Manager Settings
 * This module handles loading and saving settings for the Model Manager panel.
 */

import { HOLAF_THEMES } from "../holaf_themes.js";

/**
 * Loads the model type definitions and UI settings from the server.
 * @param {object} manager - The main model manager instance.
 */
export async function initializeSettings(manager) {
    // Load model type configurations (e.g., checkpoints, loras)
    if (manager.modelTypesConfig.length === 0) {
        try {
            const response = await fetch("/holaf/models/config");
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            manager.modelTypesConfig = await response.json();
            manager.modelTypesConfig.sort((a, b) => a.type.localeCompare(b.type));
            console.log("[Holaf ModelManager] Model config definitions loaded:", manager.modelTypesConfig);
        } catch (e) {
            console.error("[Holaf ModelManager] Could not load model type config:", e);
        }
    }

    // Load UI settings (panel position, size, theme, etc.)
    if (!manager.areSettingsLoaded) {
        try {
            const response = await fetch("/holaf/utilities/settings");
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const allSettings = await response.json();
            
            if (allSettings.ModelManagerUI) {
                const fetchedMMSettings = allSettings.ModelManagerUI;
                const validTheme = HOLAF_THEMES.find(t => t.name === fetchedMMSettings.theme);

                // Merge fetched settings with defaults
                manager.settings = {
                    ...manager.settings,
                    ...fetchedMMSettings,
                    theme: validTheme ? fetchedMMSettings.theme : HOLAF_THEMES[0].name,
                    panel_x: fetchedMMSettings.panel_x !== null && !isNaN(parseInt(fetchedMMSettings.panel_x)) ? parseInt(fetchedMMSettings.panel_x) : null,
                    panel_y: fetchedMMSettings.panel_y !== null && !isNaN(parseInt(fetchedMMSettings.panel_y)) ? parseInt(fetchedMMSettings.panel_y) : null,
                    panel_width: parseInt(fetchedMMSettings.panel_width) || manager.settings.panel_width,
                    panel_height: parseInt(fetchedMMSettings.panel_height) || manager.settings.panel_height,
                    zoom_level: parseFloat(fetchedMMSettings.zoom_level) || manager.settings.zoom_level,
                    panel_is_fullscreen: !!fetchedMMSettings.panel_is_fullscreen
                };

                // Clamp zoom level to defined min/max
                manager.settings.zoom_level = Math.max(manager.MIN_ZOOM, Math.min(manager.MAX_ZOOM, manager.settings.zoom_level));

                // Restore sort settings
                manager.currentSort.column = manager.settings.sort_column || 'name';
                manager.currentSort.order = manager.settings.sort_order || 'asc';
                
                manager.areSettingsLoaded = true;
                console.log("[Holaf ModelManager] UI settings loaded:", manager.settings);
            }
        } catch (e) {
            console.error("[Holaf ModelManager] Could not load UI settings from server. Using defaults.", e);
        }
    }
}

/**
 * Saves the current UI settings to the server's config file.
 * Debounced to avoid excessive requests.
 * @param {object} manager - The main model manager instance.
 */
export function saveSettings(manager) {
    clearTimeout(manager.saveSettingsTimeout);
    
    manager.saveSettingsTimeout = setTimeout(async () => {
        const settingsToSave = {
            theme: manager.settings.theme,
            panel_x: manager.settings.panel_x,
            panel_y: manager.settings.panel_y,
            panel_width: manager.settings.panel_width,
            panel_height: manager.settings.panel_height,
            panel_is_fullscreen: manager.settings.panel_is_fullscreen,
            filter_type: document.getElementById("holaf-manager-type-select")?.value || manager.settings.filter_type,
            filter_search_text: document.getElementById("holaf-manager-search-input")?.value || manager.settings.filter_search_text,
            sort_column: manager.currentSort.column,
            sort_order: manager.currentSort.order,
            zoom_level: manager.settings.zoom_level,
        };

        try {
            const response = await fetch('/holaf/model-manager/save-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settingsToSave)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: "Unknown error saving MM settings" }));
                console.error("[Holaf ModelManager] Failed to save settings. Status:", response.status, "Msg:", errorData.message);
            } else {
                console.log("[Holaf ModelManager] Settings saved to server.");
            }
        } catch (e) {
            console.error("[Holaf ModelManager] Exception during saveSettings fetch for Model Manager:", e);
        }
    }, 1000);
}