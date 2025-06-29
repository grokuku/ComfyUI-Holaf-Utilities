/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Actions Module
 *
 * This module handles the logic for user actions like deleting, restoring,
 * and managing metadata for selected images.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";

/**
 * Attaches click listeners to the main action buttons.
 * @param {object} viewer - The main image viewer instance.
 */
export function attachActionListeners(viewer) {
    const btnDelete = document.getElementById('holaf-viewer-btn-delete');
    const btnRestore = document.getElementById('holaf-viewer-btn-restore');
    const btnExtract = document.getElementById('holaf-viewer-btn-extract');
    const btnInject = document.getElementById('holaf-viewer-btn-inject');
    const btnExport = document.getElementById('holaf-viewer-btn-export');

    if (btnDelete) btnDelete.onclick = () => handleDelete(viewer);
    if (btnRestore) btnRestore.onclick = () => handleRestore(viewer);
    if (btnExtract) btnExtract.onclick = () => handleExtractMetadata(viewer);
    if (btnInject) btnInject.onclick = () => handleInjectMetadata(viewer);
    if (btnExport) btnExport.onclick = () => handleExport(viewer);
}

/**
 * Updates the enabled/disabled state of action buttons based on the current selection.
 * @param {object} viewer - The main image viewer instance.
 */
export function updateActionButtonsState(viewer) {
    const btnDelete = document.getElementById('holaf-viewer-btn-delete');
    const btnRestore = document.getElementById('holaf-viewer-btn-restore');
    const btnExtract = document.getElementById('holaf-viewer-btn-extract');
    const btnInject = document.getElementById('holaf-viewer-btn-inject');
    const btnExport = document.getElementById('holaf-viewer-btn-export');
    const hasSelection = viewer.selectedImages.size > 0;

    let canRestore = false;
    if (hasSelection) {
        // Enable restore only if ALL selected images are in the trashcan
        canRestore = Array.from(viewer.selectedImages).every(img => img.is_trashed);
    }
    const canPerformNonTrashActions = hasSelection && Array.from(viewer.selectedImages).every(img => !img.is_trashed);

    // MODIFIED: Removed the isExporting check to allow queueing.
    if (btnDelete) btnDelete.disabled = !canPerformNonTrashActions;
    if (btnRestore) btnRestore.disabled = !canRestore;
    if (btnExtract) btnExtract.disabled = !canPerformNonTrashActions;
    if (btnInject) btnInject.disabled = !canPerformNonTrashActions;
    if (btnExport) btnExport.disabled = !canPerformNonTrashActions;
    
    // The status bar text is now exclusively managed by viewer.updateStatusBar()
}

/**
 * Handles the "Delete" action for selected images.
 * @param {object} viewer - The main image viewer instance.
 */
export async function handleDelete(viewer) {
    if (viewer.selectedImages.size === 0) return;
    const imagesToDelete = Array.from(viewer.selectedImages);
    const pathsToDelete = imagesToDelete.map(img => img.path_canon);

    if (await HolafPanelManager.createDialog({
        title: "Confirm Delete",
        message: `Are you sure you want to move ${imagesToDelete.length} image(s) to the trashcan?`,
        buttons: [
            { text: "Cancel", value: false, type: "cancel" },
            { text: "Delete", value: true, type: "danger" }
        ]
    })) {
        try {
            const response = await fetch("/holaf/images/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths_canon: pathsToDelete })
            });
            const result = await response.json();

            if (response.ok || response.status === 207) { // 207 for partial success
                HolafPanelManager.createDialog({
                    title: "Delete Operation",
                    message: result.message || "Delete operation processed.",
                    buttons: [{ text: "OK", value: true }]
                });
                // Refresh list
                viewer.selectedImages.clear();
                viewer.activeImage = null;
                viewer.currentNavIndex = -1;
                viewer.loadFilteredImages();
            } else {
                HolafPanelManager.createDialog({
                    title: "Delete Error",
                    message: `Failed to delete images: ${result.message || 'Unknown server error.'}`,
                    buttons: [{ text: "OK", value: true }]
                });
            }
        } catch (error) {
            console.error("[Holaf ImageViewer] Error calling delete API:", error);
            HolafPanelManager.createDialog({
                title: "API Error",
                message: `Error communicating with server for delete operation: ${error.message}`,
                buttons: [{ text: "OK", value: true }]
            });
        }
    }
}

/**
 * Handles the "Restore" action for selected images.
 * @param {object} viewer - The main image viewer instance.
 */
export async function handleRestore(viewer) {
    if (viewer.selectedImages.size === 0) return;
    const imagesToRestore = Array.from(viewer.selectedImages);
    const pathsToRestore = imagesToRestore.map(img => img.path_canon);

    if (await HolafPanelManager.createDialog({
        title: "Confirm Restore",
        message: `Are you sure you want to restore ${imagesToRestore.length} image(s) from the trashcan?`,
        buttons: [
            { text: "Cancel", value: false, type: "cancel" },
            { text: "Restore", value: true, type: "confirm" }
        ]
    })) {
        try {
            const response = await fetch("/holaf/images/restore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths_canon: pathsToRestore })
            });
            const result = await response.json();

            if (response.ok || response.status === 207) {
                HolafPanelManager.createDialog({
                    title: "Restore Operation",
                    message: result.message || "Restore operation processed.",
                    buttons: [{ text: "OK", value: true }]
                });
                // Refresh list
                viewer.selectedImages.clear();
                viewer.activeImage = null;
                viewer.currentNavIndex = -1;
                viewer.loadFilteredImages();
            } else {
                HolafPanelManager.createDialog({
                    title: "Restore Error",
                    message: `Failed to restore images: ${result.message || 'Unknown server error.'}`,
                    buttons: [{ text: "OK", value: true }]
                });
            }
        } catch (error) {
            console.error("[Holaf ImageViewer] Error calling restore API:", error);
            HolafPanelManager.createDialog({
                title: "API Error",
                message: `Error communicating with server for restore operation: ${error.message}`,
                buttons: [{ text: "OK", value: true }]
            });
        }
    }
}

/**
 * Placeholder for "Extract Metadata" action.
 * @param {object} viewer - The main image viewer instance.
 */
export function handleExtractMetadata(viewer) {
    if (viewer.selectedImages.size === 0) return;
    console.log("[Holaf ImageViewer] Extract Metadata action triggered for:", Array.from(viewer.selectedImages).map(img => img.filename));
    HolafPanelManager.createDialog({ title: "Not Implemented", message: "Extract Metadata functionality is not yet implemented.", buttons: [{ text: "OK" }] });
}

/**
 * Placeholder for "Inject Metadata" action.
 * @param {object} viewer - The main image viewer instance.
 */
export function handleInjectMetadata(viewer) {
    if (viewer.selectedImages.size === 0) return;
    console.log("[Holaf ImageViewer] Inject Metadata action triggered for:", Array.from(viewer.selectedImages).map(img => img.filename));
    HolafPanelManager.createDialog({ title: "Not Implemented", message: "Inject Metadata functionality is not yet implemented.", buttons: [{ text: "OK" }] });
}

/**
 * Handles the "Export" action for selected images by opening an options dialog.
 * @param {object} viewer - The main image viewer instance.
 */
export function handleExport(viewer) {
    if (viewer.selectedImages.size === 0) return;

    const overlay = document.createElement('div');
    overlay.id = 'holaf-viewer-export-dialog-overlay';
    
    const imageCount = viewer.selectedImages.size;
    const savedSettings = viewer.settings;

    overlay.innerHTML = `
        <div id="holaf-viewer-export-dialog">
            <div class="holaf-viewer-export-header">
                Exporting ${imageCount} image(s)
            </div>
            <div class="holaf-viewer-export-content">
                <div class="holaf-viewer-export-option-group">
                    <label>Image Format:</label>
                    <div class="holaf-export-choices">
                        <label><input type="radio" name="export-format" value="png" ${savedSettings.export_format === 'png' ? 'checked' : ''}> PNG</label>
                        <label><input type="radio" name="export-format" value="jpg" ${savedSettings.export_format === 'jpg' ? 'checked' : ''}> JPG</label>
                        <label><input type="radio" name="export-format" value="tiff" ${savedSettings.export_format === 'tiff' ? 'checked' : ''}> TIFF</label>
                    </div>
                </div>
                <div class="holaf-viewer-export-option-group">
                    <label>Metadata:</label>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <label>
                            <input type="checkbox" id="holaf-export-include-meta" name="include-meta" ${savedSettings.export_include_meta ? 'checked' : ''}>
                            Include Prompt & Workflow
                        </label>
                        <div id="holaf-export-meta-method-group" style="padding-left: 20px; display: flex; flex-direction: column; gap: 8px;">
                            <label><input type="radio" name="meta-method" value="embed" ${savedSettings.export_meta_method === 'embed' ? 'checked' : ''}> Embed in image file</label>
                            <label><input type="radio" name="meta-method" value="sidecar" ${savedSettings.export_meta_method === 'sidecar' ? 'checked' : ''}> Save as .txt/.json sidecar</label>
                        </div>
                    </div>
                </div>
            </div>
            <div class="holaf-viewer-export-footer">
                <button id="holaf-export-cancel-btn" class="comfy-button secondary">Cancel</button>
                <button id="holaf-export-start-btn" class="comfy-button">Add to Export Queue</button>
            </div>
        </div>
    `;

    viewer.panelElements.panelEl.appendChild(overlay);

    const includeMetaCheckbox = overlay.querySelector('#holaf-export-include-meta');
    const metaMethodGroup = overlay.querySelector('#holaf-export-meta-method-group');

    const toggleMetaMethod = () => {
        const isEnabled = includeMetaCheckbox.checked;
        metaMethodGroup.style.opacity = isEnabled ? '1' : '0.5';
        metaMethodGroup.style.pointerEvents = isEnabled ? 'auto' : 'none';
    };

    includeMetaCheckbox.addEventListener('change', toggleMetaMethod);

    overlay.querySelector('#holaf-export-cancel-btn').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#holaf-export-start-btn').addEventListener('click', async () => {
        const format = overlay.querySelector('input[name="export-format"]:checked').value;
        const includeMeta = overlay.querySelector('#holaf-export-include-meta').checked;
        const metaMethod = includeMeta ? overlay.querySelector('input[name="meta-method"]:checked').value : null;

        const newExportSettings = {
            export_format: format,
            export_include_meta: includeMeta,
            export_meta_method: metaMethod
        };
        viewer.saveSettings(newExportSettings);
        
        const payload = {
            ...newExportSettings,
            paths_canon: Array.from(viewer.selectedImages).map(img => img.path_canon)
        };
        
        overlay.remove();
        
        try {
            const response = await fetch('/holaf/images/prepare-export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (!response.ok || result.status !== 'ok') {
                throw new Error(result.message || 'Failed to prepare export on server.');
            }
            if (result.errors && result.errors.length > 0) {
                 HolafPanelManager.createDialog({ title: "Preparation Errors", message: `Some files could not be prepared:\n${result.errors.map(e => `- ${e.path}: ${e.error}`).join('\n')}` });
            }

            const manifestUrl = `/holaf/images/export-chunk?export_id=${result.export_id}&file_path=manifest.json&chunk_index=0&chunk_size=1000000`;
            const manifestResponse = await fetch(manifestUrl);
            const manifest = await manifestResponse.json();

            if (manifest && manifest.length > 0) {
                const newFiles = manifest.map(file => ({ ...file, export_id: result.export_id }));
                viewer.exportDownloadQueue.push(...newFiles);
                viewer.exportStats.totalFiles += newFiles.length;

                if (!viewer.isExporting) {
                    viewer.isExporting = true;
                    viewer.updateStatusBar(); // Immediately update status bar to show "Exporting..."
                    viewer.processExportDownloadQueue();
                } else {
                    viewer.updateStatusBar(); // Just update the total count
                }
            } else {
                 if (!viewer.isExporting) viewer.updateStatusBar();
                 HolafPanelManager.createDialog({ title: "Export Warning", message: "No new files were added to the export queue." });
            }

        } catch (error) {
            console.error('[Holaf ImageViewer] Export preparation failed:', error);
            HolafPanelManager.createDialog({ title: "Export Error", message: `Error adding to export queue: ${error.message}` });
        }
    });

    toggleMetaMethod();
}