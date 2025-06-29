/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Actions Module
 *
 * This module handles the logic for user actions like deleting, restoring,
 * and managing metadata for selected images.
 * MODIFICATION: Forced dialogs to attach to document.body to fix z-index issues.
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
    const btnImport = document.getElementById('holaf-viewer-btn-import');

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
    const btnImport = document.getElementById('holaf-viewer-btn-import');

    const hasSelection = viewer.selectedImages.size > 0;
    const hasPngSelection = hasSelection && Array.from(viewer.selectedImages).some(img => img.format.toLowerCase() === 'png');

    let canRestore = false;
    if (hasSelection) {
        canRestore = Array.from(viewer.selectedImages).every(img => img.is_trashed);
    }
    const canPerformNonTrashActions = hasSelection && Array.from(viewer.selectedImages).every(img => !img.is_trashed);

    if (btnDelete) btnDelete.disabled = !canPerformNonTrashActions;
    if (btnRestore) btnRestore.disabled = !canRestore;
    if (btnExtract) btnExtract.disabled = !canPerformNonTrashActions || !hasPngSelection;
    if (btnInject) btnInject.disabled = !canPerformNonTrashActions || !hasPngSelection;
    if (btnExport) btnExport.disabled = !canPerformNonTrashActions;
    if (btnImport) btnImport.disabled = true;
}

/**
 * Handles deletion of selected images, with an option for permanent deletion.
 * @param {object} viewer - The main image viewer instance.
 * @param {boolean} [permanent=false] - If true, permanently deletes files.
 * @param {object[]|null} [imagesToProcess=null] - Specific images to delete. If null, uses viewer.selectedImages.
 * @returns {Promise<boolean>} True if the operation was successful, otherwise false.
 */
export async function handleDeletion(viewer, permanent = false, imagesToProcess = null) {
    const imagesForDeletion = imagesToProcess || Array.from(viewer.selectedImages);
    if (imagesForDeletion.length === 0) return false;
    
    const isAnyFileTrashed = imagesForDeletion.some(img => img.is_trashed);
    if (isAnyFileTrashed) {
        HolafPanelManager.createDialog({
            title: "Action Not Allowed",
            message: "This action cannot be performed on items already in the trash. Use 'Restore' or 'Empty Trash'.",
            buttons: [{ text: "OK" }],
            parentElement: document.body // Ensure it's on top
        });
        return false;
    }

    const pathsToDelete = imagesForDeletion.map(img => img.path_canon);
    const dialogTitle = permanent ? "Confirm Permanent Deletion" : "Confirm Delete";
    const dialogMessage = permanent 
        ? `Are you sure you want to PERMANENTLY delete ${imagesForDeletion.length} image(s)?\n\nThis action CANNOT be undone.`
        : `Are you sure you want to move ${imagesForDeletion.length} image(s) to the trashcan?`;
    const confirmButtonText = permanent ? "Permanently Delete" : "Delete";

    const confirmed = await HolafPanelManager.createDialog({
        title: dialogTitle,
        message: dialogMessage,
        buttons: [
            { text: "Cancel", value: false, type: "cancel" },
            { text: confirmButtonText, value: true, type: "danger" }
        ],
        parentElement: document.body // CORE FIX: Attach dialog to body
    });

    if (!confirmed) return false;

    try {
        const apiUrl = permanent ? "/holaf/images/delete-permanently" : "/holaf/images/delete";
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths_canon: pathsToDelete })
        });
        const result = await response.json();

        if (response.ok || response.status === 207) {
            return true; // SUCCESS
        } else {
            HolafPanelManager.createDialog({
                title: "Delete Error",
                message: `Failed to delete images: ${result.message || 'Unknown server error.'}`,
                buttons: [{ text: "OK", value: true }],
                parentElement: document.body // Ensure it's on top
            });
            return false; // FAILURE
        }
    } catch (error) {
        console.error("[Holaf ImageViewer] Error calling delete API:", error);
        HolafPanelManager.createDialog({
            title: "API Error",
            message: `Error communicating with server for delete operation: ${error.message}`,
            buttons: [{ text: "OK", value: true }],
            parentElement: document.body // Ensure it's on top
        });
        return false; // FAILURE
    }
}

/**
 * Handles the "Delete" button click. Now a wrapper around handleDeletion.
 * @param {object} viewer - The main image viewer instance.
 */
export async function handleDelete(viewer) {
    if (await handleDeletion(viewer, false)) {
        viewer.selectedImages.clear();
        viewer.activeImage = null;
        viewer.currentNavIndex = -1;
        viewer.loadFilteredImages();
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
        ],
        parentElement: document.body // Ensure it's on top
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
                    buttons: [{ text: "OK", value: true }],
                    parentElement: document.body // Ensure it's on top
                });
                viewer.selectedImages.clear();
                viewer.activeImage = null;
                viewer.currentNavIndex = -1;
                viewer.loadFilteredImages();
            } else {
                HolafPanelManager.createDialog({
                    title: "Restore Error",
                    message: `Failed to restore images: ${result.message || 'Unknown server error.'}`,
                    buttons: [{ text: "OK", value: true }],
                    parentElement: document.body // Ensure it's on top
                });
            }
        } catch (error) {
            console.error("[Holaf ImageViewer] Error calling restore API:", error);
            HolafPanelManager.createDialog({
                title: "API Error",
                message: `Error communicating with server for restore operation: ${error.message}`,
                buttons: [{ text: "OK", value: true }],
                parentElement: document.body // Ensure it's on top
            });
        }
    }
}

/**
 * Processes the next conflict in the viewer's conflict queue for metadata operations.
 * @param {object} viewer - The main image viewer instance.
 */
async function processNextConflict(viewer) {
    if (!viewer.conflictQueue || viewer.conflictQueue.length === 0) {
        viewer.isProcessingConflicts = false;
        HolafPanelManager.createDialog({
            title: "Process Finished",
            message: "All metadata operations have been processed.",
            buttons: [{ text: "OK" }],
            parentElement: document.body
        });
        viewer.loadFilteredImages(); // Refresh the gallery
        return;
    }

    viewer.isProcessingConflicts = true;
    const conflict = viewer.conflictQueue.shift();
    const filename = conflict.path.split('/').pop();

    const choice = await HolafPanelManager.createDialog({
        title: `Conflict on ${filename}`,
        message: `For the image '${filename}':\n${conflict.error}\n\n${(conflict.details || []).join("\n")}\n\nDo you want to overwrite the existing file(s)?`,
        buttons: [
            { text: "Skip", value: 'skip', type: 'cancel' },
            { text: "Cancel All", value: 'cancel_all' },
            { text: "Overwrite", value: 'overwrite', type: 'danger' },
        ],
        parentElement: document.body
    });

    if (choice === 'overwrite') {
        // Re-call the API for this single file with force=true
        try {
            const response = await fetch('/holaf/images/extract-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths_canon: [conflict.path], force: true })
            });
            const result = await response.json();
            if (!response.ok || result.results?.failures?.length > 0) {
                const errorMsg = result.results?.failures[0]?.error || result.message || 'Unknown error during overwrite.';
                HolafPanelManager.createDialog({ title: `Error Overwriting ${filename}`, message: errorMsg, parentElement: document.body });
            }
        } catch (e) {
             HolafPanelManager.createDialog({ title: `API Error`, message: `Failed to overwrite for ${filename}: ${e.message}`, parentElement: document.body });
        }
    } else if (choice === 'cancel_all') {
        viewer.conflictQueue = [];
    }

    // Process the next item in the queue recursively
    await processNextConflict(viewer);
}


/**
 * Handles the "Extract Metadata" action. Extracts embedded metadata from PNGs to sidecar files.
 * @param {object} viewer - The main image viewer instance.
 */
export async function handleExtractMetadata(viewer) {
    if (viewer.isProcessingConflicts) {
        HolafPanelManager.createDialog({ title: "Process Busy", message: "Please resolve the current conflicts before starting a new operation.", parentElement: document.body });
        return;
    }

    const pngImages = Array.from(viewer.selectedImages).filter(img => img.format.toLowerCase() === 'png');

    if (pngImages.length === 0) {
        HolafPanelManager.createDialog({
            title: "Invalid Selection",
            message: "The 'Extract' action only works on PNG images. Please select one or more PNG files.",
            buttons: [{ text: "OK" }],
            parentElement: document.body
        });
        return;
    }

    const pathsToProcess = pngImages.map(img => img.path_canon);

    try {
        const response = await fetch('/holaf/images/extract-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths_canon: pathsToProcess, force: false })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `Server returned status ${response.status}`);
        }
        
        // Initialize or clear conflict state
        viewer.conflictQueue = [];
        viewer.isProcessingConflicts = false;

        const successes = result.results?.successes || [];
        const failures = result.results?.failures || [];
        const conflicts = result.results?.conflicts || [];

        // Report failures immediately
        if (failures.length > 0) {
            const failureMessage = failures.map(f => `- ${f.path.split('/').pop()}: ${f.error}`).join('\n');
            HolafPanelManager.createDialog({
                title: "Extraction Errors",
                message: `Could not extract metadata for the following files:\n${failureMessage}`,
                buttons: [{ text: "OK" }],
                parentElement: document.body
            });
        }
        
        // Start processing conflicts if any, otherwise finish up.
        if (conflicts.length > 0) {
            viewer.conflictQueue = conflicts;
            processNextConflict(viewer);
        } else {
            // No conflicts, just successes and/or failures.
            if (successes.length > 0 && failures.length === 0) {
                 HolafPanelManager.createDialog({
                    title: "Extraction Complete",
                    message: `Successfully extracted metadata for ${successes.length} image(s).`,
                    buttons: [{ text: "OK" }],
                    parentElement: document.body
                });
            }
            viewer.loadFilteredImages(); // Refresh
        }

    } catch (error) {
        console.error("[Holaf ImageViewer] Error calling extract API:", error);
        HolafPanelManager.createDialog({
            title: "API Error",
            message: `Error communicating with server for extract operation: ${error.message}`,
            buttons: [{ text: "OK" }],
            parentElement: document.body
        });
    }
}

/**
 * Placeholder for "Inject Metadata" action.
 * @param {object} viewer - The main image viewer instance.
 */
export function handleInjectMetadata(viewer) {
    if (viewer.selectedImages.size === 0) return;
    HolafPanelManager.createDialog({ 
        title: "Not Implemented", 
        message: "Inject Metadata functionality is not yet implemented.", 
        buttons: [{ text: "OK" }],
        parentElement: document.body // Ensure it's on top
    });
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
                 HolafPanelManager.createDialog({ title: "Preparation Errors", message: `Some files could not be prepared:\n${result.errors.map(e => `- ${e.path}: ${e.error}`).join('\n')}`, parentElement: document.body });
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
                    viewer.updateStatusBar();
                    viewer.processExportDownloadQueue();
                } else {
                    viewer.updateStatusBar();
                }
            } else {
                 if (!viewer.isExporting) viewer.updateStatusBar();
                 HolafPanelManager.createDialog({ title: "Export Warning", message: "No new files were added to the export queue.", parentElement: document.body });
            }

        } catch (error) {
            console.error('[Holaf ImageViewer] Export preparation failed:', error);
            HolafPanelManager.createDialog({ title: "Export Error", message: `Error adding to export queue: ${error.message}`, parentElement: document.body });
        }
    });

    toggleMetaMethod();
}