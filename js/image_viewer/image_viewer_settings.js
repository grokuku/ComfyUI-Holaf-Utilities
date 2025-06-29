/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Settings Module
 *
 * This module manages loading, saving, and applying user settings for the image viewer.
 */

import { HolafPanelManager, HOLAF_THEMES } from "../holaf_panel_manager.js";

/**
 * Loads settings from the server.
 * @param {object} viewer - The main image viewer instance.
 */
export async function loadSettings(viewer) {
    try {
        const response = await fetch('/holaf/utilities/settings');
        const allSettings = await response.json();
        if (allSettings.ImageViewerUI) {
            const fetchedSettings = allSettings.ImageViewerUI;

            // --- MODIFICATION START ---
            // Explicitly convert string representations of booleans to actual booleans
            if (fetchedSettings.export_include_meta !== undefined) {
                fetchedSettings.export_include_meta = String(fetchedSettings.export_include_meta).toLowerCase() === 'true';
            }
            if (fetchedSettings.panel_is_fullscreen !== undefined) {
                fetchedSettings.panel_is_fullscreen = String(fetchedSettings.panel_is_fullscreen).toLowerCase() === 'true';
            }
            // --- MODIFICATION END ---

            const validTheme = HOLAF_THEMES.find(t => t.name === fetchedSettings.theme);
            
            const folderFilters = fetchedSettings.folder_filters;
            const formatFilters = fetchedSettings.format_filters;

            viewer.settings = { ...viewer.settings, ...fetchedSettings };

            if (folderFilters !== undefined) {
                try { viewer.settings.folder_filters = JSON.parse(folderFilters); }
                catch (e) { viewer.settings.folder_filters = undefined; }
            }
             if (formatFilters !== undefined) {
                try { viewer.settings.format_filters = JSON.parse(formatFilters); }
                catch (e) { viewer.settings.format_filters = undefined; }
            }
            
            if (!validTheme) viewer.settings.theme = HOLAF_THEMES[0].name;
        }
    } catch (e) {
        console.error("[Holaf ImageViewer] Could not load settings:", e);
    }
    viewer.areSettingsLoaded = true;
}

/**
 * Saves settings to the server, with debouncing.
 * @param {object} viewer - The main image viewer instance.
 * @param {object} newSettings - The new settings to merge and save.
 */
export function saveSettings(viewer, newSettings) {
    if (newSettings.x !== undefined) newSettings.panel_x = newSettings.x;
    if (newSettings.y !== undefined) newSettings.panel_y = newSettings.y;
    if (newSettings.width !== undefined) newSettings.panel_width = newSettings.width;
    if (newSettings.height !== undefined) newSettings.panel_height = newSettings.height;
    delete newSettings.x;
    delete newSettings.y;
    delete newSettings.width;
    delete newSettings.height;

    Object.assign(viewer.settings, newSettings);

    if (viewer.settings.folder_filters !== undefined && !Array.isArray(viewer.settings.folder_filters)) viewer.settings.folder_filters = [];
    if (viewer.settings.format_filters !== undefined && !Array.isArray(viewer.settings.format_filters)) viewer.settings.format_filters = [];

    if (!viewer.debouncedSave) {
        viewer.debouncedSave = (() => {
            let timeout;
            return (settingsToSave) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                     fetch("/holaf/image-viewer/save-settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(settingsToSave),
                    }).catch(error => console.error("[Holaf ImageViewer] Error saving settings:", error));
                }, 750);
            };
        })();
    }
    viewer.debouncedSave(viewer.settings);
}

/**
 * Applies a theme to the panel.
 * @param {object} viewer - The main image viewer instance.
 * @param {string} themeName - The name of the theme to apply.
 * @param {boolean} [doSave=true] - Whether to save the setting change.
 */
export function setTheme(viewer, themeName, doSave = true) {
    const themeConfig = HOLAF_THEMES.find(t => t.name === themeName);
    if (!themeConfig) {
        console.warn(`[Holaf ImageViewer] Theme '${themeName}' not found.`);
        return;
    }

    if (doSave) {
        saveSettings(viewer, { theme: themeName });
    } else {
        viewer.settings.theme = themeName;
    }

    if (viewer.panelElements && viewer.panelElements.panelEl) {
        HOLAF_THEMES.forEach(t => viewer.panelElements.panelEl.classList.remove(t.className));
        viewer.panelElements.panelEl.classList.add(themeConfig.className);
    }
}

/**
 * Applies all stored panel settings (size, position, theme, fullscreen state).
 * @param {object} viewer - The main image viewer instance.
 */
export function applyPanelSettings(viewer) {
    if (!viewer.panelElements || !viewer.panelElements.panelEl) return;

    setTheme(viewer, viewer.settings.theme, false);

    const isFullscreen = viewer.settings.panel_is_fullscreen;
    const panelIsFullscreen = viewer.panelElements.panelEl.classList.contains("holaf-panel-fullscreen");

    if (isFullscreen && !panelIsFullscreen) {
        HolafPanelManager.toggleFullscreen(viewer.panelElements.panelEl, (isFs) => saveSettings(viewer, { panel_is_fullscreen: isFs }));
    } else if (!isFullscreen && panelIsFullscreen) {
        HolafPanelManager.toggleFullscreen(viewer.panelElements.panelEl, (isFs) => saveSettings(viewer, { panel_is_fullscreen: isFs }));
    }

    if (!viewer.settings.panel_is_fullscreen) {
        viewer.panelElements.panelEl.style.width = `${viewer.settings.panel_width}px`;
        viewer.panelElements.panelEl.style.height = `${viewer.settings.panel_height}px`;

        if (viewer.settings.panel_x !== null && viewer.settings.panel_y !== null) {
            viewer.panelElements.panelEl.style.left = `${viewer.settings.panel_x}px`;
            viewer.panelElements.panelEl.style.top = `${viewer.settings.panel_y}px`;
            viewer.panelElements.panelEl.style.transform = 'none';
        } else {
            viewer.panelElements.panelEl.style.left = '50%';
            viewer.panelElements.panelEl.style.top = '50%';
            viewer.panelElements.panelEl.style.transform = 'translate(-50%, -50%)';
        }
    }

    applyThumbnailFit(viewer.settings.thumbnail_fit);
    applyThumbnailSize(viewer.settings.thumbnail_size);
}

/**
 * Applies the 'fit' style (cover/contain) to the gallery.
 * @param {string} fitMode - 'cover' or 'contain'.
 */
export function applyThumbnailFit(fitMode) {
    const el = document.getElementById("holaf-viewer-gallery");
    if (el) el.classList.toggle('contain-thumbnails', fitMode === 'contain');
}

/**
 * Applies the thumbnail size CSS variable to the gallery.
 * @param {number} size - The size in pixels.
 */
export function applyThumbnailSize(size) {
    const el = document.getElementById("holaf-viewer-gallery");
    if (el) el.style.setProperty('--holaf-thumbnail-size', `${size}px`);
}