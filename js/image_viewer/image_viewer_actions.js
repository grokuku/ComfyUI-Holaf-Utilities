/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Actions Module
 *
 * This module handles the logic for user actions like deleting, restoring,
 * and managing metadata for selected images.
 * REFACTOR: Updated to use the central imageViewerState.
 * CORRECTIF: Actions now correctly target the active image in zoom/fullscreen view.
 * FEATURE: Added a confirmation dialog for exporting when there are unsaved edits.
 * MODIFICATION: Made the export dialog fully keyboard-navigable with 2D-aware controls.
 */

import { HolafPanelManager, dialogState } from "../holaf_panel_manager.js";
import { imageViewerState } from "./image_viewer_state.js";

// --- CORRECTIF : Nouvelle fonction d'aide pour déterminer la cible des actions ---
/**
 * Determines the target images for an action based on the current view mode.
 * @returns {object[]} An array of image objects to be processed.
 */
function _getTargets() {
    const state = imageViewerState.getState();
    const viewMode = state.ui.view_mode;

    if (viewMode === 'zoom' || viewMode === 'fullscreen') {
        // En vue zoom ou plein écran, la cible est l'image active.
        return state.activeImage ? [state.activeImage] : [];
    }
    
    // Sinon, en vue galerie, la cible est la sélection multiple.
    return Array.from(state.selectedImages);
}


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
    // CORRECTIF : Utiliser _getTargets() pour obtenir les images concernées.
    const targetImages = _getTargets();

    const btnDelete = document.getElementById('holaf-viewer-btn-delete');
    const btnRestore = document.getElementById('holaf-viewer-btn-restore');
    const btnExtract = document.getElementById('holaf-viewer-btn-extract');
    const btnInject = document.getElementById('holaf-viewer-btn-inject');
    const btnExport = document.getElementById('holaf-viewer-btn-export');
    const btnImport = document.getElementById('holaf-viewer-btn-import');

    const hasSelection = targetImages.length > 0;
    const hasPngSelection = hasSelection && targetImages.some(img => img.format.toLowerCase() === 'png');

    let canRestore = false;
    if (hasSelection) {
        canRestore = targetImages.every(img => img.is_trashed);
    }
    const canPerformNonTrashActions = hasSelection && targetImages.every(img => !img.is_trashed);

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
 * @param {object[]|null} [imagesToProcess=null] - Specific images to delete. If null, uses context-aware targets.
 * @returns {Promise<boolean>} True if the operation was successful, otherwise false.
 */
export async function handleDeletion(viewer, permanent = false, imagesToProcess = null) {
    // CORRECTIF : Le paramètre `imagesToProcess` a la priorité (utilisé par ex. par la touche Suppr), sinon on utilise _getTargets().
    const imagesForDeletion = imagesToProcess || _getTargets();
    if (imagesForDeletion.length === 0) return false;
    
    const isAnyFileTrashed = imagesForDeletion.some(img => img.is_trashed);
    if (isAnyFileTrashed) {
        HolafPanelManager.createDialog({
            title: "Action Not Allowed",
            message: "This action cannot be performed on items already in the trash. Use 'Restore' or 'Empty Trash'.",
            buttons: [{ text: "OK" }],
            parentElement: document.body
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
        parentElement: document.body
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
                parentElement: document.body
            });
            return false; // FAILURE
        }
    } catch (error) {
        console.error("[Holaf ImageViewer] Error calling delete API:", error);
        HolafPanelManager.createDialog({
            title: "API Error",
            message: `Error communicating with server for delete operation: ${error.message}`,
            buttons: [{ text: "OK", value: true }],
            parentElement: document.body
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
        imageViewerState.setState({
            selectedImages: new Set(),
            activeImage: null,
            currentNavIndex: -1
        });
        viewer.loadFilteredImages();
    }
}

/**
 * Handles the "Restore" action for selected images.
 * @param {object} viewer - The main image viewer instance.
 */
export async function handleRestore(viewer) {
    // CORRECTIF : Utiliser _getTargets() pour obtenir les images concernées.
    const imagesToRestore = _getTargets();
    if (imagesToRestore.length === 0) return;
    const pathsToRestore = imagesToRestore.map(img => img.path_canon);

    if (await HolafPanelManager.createDialog({
        title: "Confirm Restore",
        message: `Are you sure you want to restore ${imagesToRestore.length} image(s) from the trashcan?`,
        buttons: [
            { text: "Cancel", value: false, type: "cancel" },
            { text: "Restore", value: true, type: "confirm" }
        ],
        parentElement: document.body
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
                    parentElement: document.body
                });
                imageViewerState.setState({
                    selectedImages: new Set(),
                    activeImage: null,
                    currentNavIndex: -1
                });
                viewer.loadFilteredImages();
            } else {
                HolafPanelManager.createDialog({
                    title: "Restore Error",
                    message: `Failed to restore images: ${result.message || 'Unknown server error.'}`,
                    buttons: [{ text: "OK", value: true }],
                    parentElement: document.body
                });
            }
        } catch (error) {
            console.error("[Holaf ImageViewer] Error calling restore API:", error);
            HolafPanelManager.createDialog({
                title: "API Error",
                message: `Error communicating with server for restore operation: ${error.message}`,
                buttons: [{ text: "OK", value: true }],
                parentElement: document.body
            });
        }
    }
}

/**
 * Processes the next conflict in the viewer's conflict queue for metadata operations.
 * @param {object} viewer - The main image viewer instance.
 * @param {string} operation - The name of the operation ('extract' or 'inject').
 */
async function processNextConflict(viewer, operation) {
    if (!viewer.conflictQueue || viewer.conflictQueue.length === 0) {
        viewer.isProcessingConflicts = false;
        const opDisplay = operation === 'extract' ? 'Extraction' : 'Injection';
        HolafPanelManager.createDialog({
            title: "Process Finished",
            message: `All metadata ${opDisplay.toLowerCase()} operations have been processed.`,
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
        message: `For the image '${filename}':\n${conflict.error}\n\n${(conflict.details || []).join("\n")}\n\nDo you want to overwrite the existing data?`,
        buttons: [
            { text: "Skip", value: 'skip', type: 'cancel' },
            { text: "Cancel All", value: 'cancel_all' },
            { text: "Overwrite", value: 'overwrite', type: 'danger' },
        ],
        parentElement: document.body
    });

    if (choice === 'overwrite') {
        try {
            const apiUrl = `/holaf/images/${operation}-metadata`;
            const response = await fetch(apiUrl, {
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
    await processNextConflict(viewer, operation);
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

    // CORRECTIF : Utiliser _getTargets() pour obtenir les images concernées.
    const targetImages = _getTargets();
    const pngImages = targetImages.filter(img => img.format.toLowerCase() === 'png');

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

        if (!response.ok) throw new Error(result.message || `Server returned status ${response.status}`);
        
        viewer.conflictQueue = result.results?.conflicts || [];
        viewer.isProcessingConflicts = false;

        const successes = result.results?.successes || [];
        const failures = result.results?.failures || [];
        
        if (failures.length > 0) {
            const failureMessage = failures.map(f => `- ${f.path.split('/').pop()}: ${f.error}`).join('\n');
            HolafPanelManager.createDialog({
                title: "Extraction Errors",
                message: `Could not extract metadata for the following files:\n${failureMessage}`,
                buttons: [{ text: "OK" }], parentElement: document.body
            });
        }
        
        if (viewer.conflictQueue.length > 0) {
            processNextConflict(viewer, 'extract');
        } else {
            if (successes.length > 0 && failures.length === 0) {
                 HolafPanelManager.createDialog({
                    title: "Extraction Complete",
                    message: `Successfully extracted metadata for ${successes.length} image(s).`,
                    buttons: [{ text: "OK" }], parentElement: document.body
                });
            }
            viewer.loadFilteredImages();
        }
    } catch (error) {
        console.error("[Holaf ImageViewer] Error calling extract API:", error);
        HolafPanelManager.createDialog({
            title: "API Error",
            message: `Error communicating with server for extract operation: ${error.message}`,
            buttons: [{ text: "OK" }], parentElement: document.body
        });
    }
}

/**
 * Handles the "Inject Metadata" action. Injects sidecar metadata into PNG files.
 * @param {object} viewer - The main image viewer instance.
 */
export async function handleInjectMetadata(viewer) {
    if (viewer.isProcessingConflicts) {
        HolafPanelManager.createDialog({ title: "Process Busy", message: "Please resolve the current conflicts before starting a new operation.", parentElement: document.body });
        return;
    }

    // CORRECTIF : Utiliser _getTargets() pour obtenir les images concernées.
    const targetImages = _getTargets();
    const pngImages = targetImages.filter(img => img.format.toLowerCase() === 'png');

    if (pngImages.length === 0) {
        HolafPanelManager.createDialog({
            title: "Invalid Selection",
            message: "The 'Inject' action only works on PNG images. Please select one or more PNG files.",
            buttons: [{ text: "OK" }], parentElement: document.body
        });
        return;
    }
    
    const pathsToProcess = pngImages.map(img => img.path_canon);

    try {
        const response = await fetch('/holaf/images/inject-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths_canon: pathsToProcess, force: false })
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.message || `Server returned status ${response.status}`);
        
        viewer.conflictQueue = result.results?.conflicts || [];
        viewer.isProcessingConflicts = false;

        const successes = result.results?.successes || [];
        const failures = result.results?.failures || [];

        if (failures.length > 0) {
            const failureMessage = failures.map(f => `- ${f.path.split('/').pop()}: ${f.error}`).join('\n');
            HolafPanelManager.createDialog({
                title: "Injection Errors",
                message: `Could not inject metadata for the following files:\n${failureMessage}`,
                buttons: [{ text: "OK" }], parentElement: document.body
            });
        }
        
        if (viewer.conflictQueue.length > 0) {
            processNextConflict(viewer, 'inject');
        } else {
            if (successes.length > 0 && failures.length === 0) {
                 HolafPanelManager.createDialog({
                    title: "Injection Complete",
                    message: `Successfully injected metadata into ${successes.length} image(s).`,
                    buttons: [{ text: "OK" }], parentElement: document.body
                });
            }
            viewer.loadFilteredImages();
        }

    } catch (error) {
        console.error("[Holaf ImageViewer] Error calling inject API:", error);
        HolafPanelManager.createDialog({
            title: "API Error",
            message: `Error communicating with server for inject operation: ${error.message}`,
            buttons: [{ text: "OK" }], parentElement: document.body
        });
    }
}

/**
 * Shows the export options dialog.
 * @param {object} viewer - The main image viewer instance.
 * @param {object[]} imagesToExport - The array of image objects to export.
 */
function _showExportOptionsDialog(viewer, imagesToExport) {
    dialogState.isOpen = true; // Block main viewer keyboard shortcuts

    const overlay = document.createElement('div');
    overlay.id = 'holaf-viewer-export-dialog-overlay';
    
    const imageCount = imagesToExport.length;
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
        setupKeyboardNavigation();
    };
    includeMetaCheckbox.addEventListener('change', toggleMetaMethod);

    // --- START: Keyboard Navigation Logic (v2 - 2D Aware) ---
    let focusableElements = [];
    let elementGrid = []; // A 2D array representing the layout
    let currentFocusCoords = { row: -1, col: -1 };

    const setupKeyboardNavigation = () => {
        const query = 'input[name="export-format"], #holaf-export-include-meta, input[name="meta-method"], #holaf-export-cancel-btn, #holaf-export-start-btn';
        const allElements = [...overlay.querySelectorAll(query)].filter(el => {
            // Filter out disabled elements
            const parentGroup = el.closest('#holaf-export-meta-method-group');
            return !(parentGroup && parentGroup.style.pointerEvents === 'none');
        });

        // The element we want to apply style/focus to is the label or the button itself.
        focusableElements = allElements.map(el => el.tagName === 'BUTTON' ? el : el.parentElement);

        // Group elements by row
        elementGrid = [];
        if (focusableElements.length > 0) {
            let currentRow = [];
            let lastY = focusableElements[0].getBoundingClientRect().top;
            focusableElements.forEach(el => {
                const elY = el.getBoundingClientRect().top;
                if (Math.abs(elY - lastY) > 10) { // Threshold for a new row
                    elementGrid.push(currentRow);
                    currentRow = [];
                }
                currentRow.push(el);
                lastY = elY;
            });
            elementGrid.push(currentRow); // Add the last row
        }

        // If the current focus is now invalid, reset it
        if (currentFocusCoords.row >= elementGrid.length || 
            (elementGrid[currentFocusCoords.row] && currentFocusCoords.col >= elementGrid[currentFocusCoords.row].length)) {
             const lastRow = elementGrid.length - 1;
             const lastCol = elementGrid[lastRow].length - 1;
             updateFocus(lastRow, lastCol);
        }
    };
    
    const updateFocus = (newRow, newCol) => {
        // Remove focus from old element
        if (currentFocusCoords.row > -1 && elementGrid[currentFocusCoords.row]?.[currentFocusCoords.col]) {
            elementGrid[currentFocusCoords.row][currentFocusCoords.col].classList.remove('holaf-dialog-item-focused');
        }
        
        // Clamp new coordinates and set focus
        const clampedRow = Math.max(0, Math.min(newRow, elementGrid.length - 1));
        const clampedCol = Math.max(0, Math.min(newCol, elementGrid[clampedRow].length - 1));
        
        const newFocusedEl = elementGrid[clampedRow][clampedCol];
        newFocusedEl.classList.add('holaf-dialog-item-focused');
        newFocusedEl.focus();
        currentFocusCoords = { row: clampedRow, col: clampedCol };
    };

    const handleKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const { row, col } = currentFocusCoords;

        switch(e.key) {
            case 'ArrowUp':
                if (row > 0) {
                    const currentElRect = elementGrid[row][col].getBoundingClientRect();
                    const prevRow = elementGrid[row - 1];
                    // Find the element in the previous row that's closest horizontally
                    let closestCol = 0;
                    let minDx = Infinity;
                    prevRow.forEach((el, index) => {
                        const dx = Math.abs(el.getBoundingClientRect().left - currentElRect.left);
                        if (dx < minDx) {
                            minDx = dx;
                            closestCol = index;
                        }
                    });
                    updateFocus(row - 1, closestCol);
                }
                break;
            case 'ArrowDown':
                if (row < elementGrid.length - 1) {
                    const currentElRect = elementGrid[row][col].getBoundingClientRect();
                    const nextRow = elementGrid[row + 1];
                    let closestCol = 0;
                    let minDx = Infinity;
                    nextRow.forEach((el, index) => {
                        const dx = Math.abs(el.getBoundingClientRect().left - currentElRect.left);
                        if (dx < minDx) {
                            minDx = dx;
                            closestCol = index;
                        }
                    });
                    updateFocus(row + 1, closestCol);
                }
                break;
            case 'ArrowRight':
                if (col < elementGrid[row].length - 1) {
                    updateFocus(row, col + 1);
                }
                break;
            case 'ArrowLeft':
                if (col > 0) {
                    updateFocus(row, col - 1);
                }
                break;
            case ' ':
            case 'Enter': {
                const focusedEl = elementGrid[row][col];
                if (focusedEl) {
                    (focusedEl.querySelector('input') || focusedEl).click();
                }
                break;
            }
            case 'Escape':
                cleanupAndClose();
                break;
        }
    };

    const cleanupAndClose = () => {
        document.removeEventListener('keydown', handleKeyDown, true);
        dialogState.isOpen = false;
        if(overlay) overlay.remove();
    };

    document.addEventListener('keydown', handleKeyDown, true);

    overlay.querySelector('#holaf-export-cancel-btn').addEventListener('click', cleanupAndClose);

    overlay.querySelector('#holaf-export-start-btn').addEventListener('click', async () => {
        cleanupAndClose();

        const format = overlay.querySelector('input[name="export-format"]:checked').value;
        const includeMeta = overlay.querySelector('#holaf-export-include-meta').checked;
        const metaMethod = includeMeta ? overlay.querySelector('input[name="meta-method"]:checked').value : null;

        const toastId = `export-${Date.now()}`;
        
        if (!imageViewerState.getState().status.isExporting) {
            window.holaf.toastManager.show({
                id: toastId, message: `Preparing to export ${imageCount} image(s)...`,
                type: 'info', duration: 0, progress: true
            });
            imageViewerState.setState({ exporting: { activeToastId: toastId } });
        }
        
        viewer.saveSettings({
            export_format: format,
            export_include_meta: includeMeta,
            export_meta_method: metaMethod
        });
        
        const payload = {
            paths_canon: imagesToExport.map(img => img.path_canon),
            export_format: format,
            include_meta: includeMeta,
            meta_method: metaMethod
        };
        
        try {
            const response = await fetch('/holaf/images/prepare-export', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (!response.ok || result.status !== 'ok') {
                throw new Error(result.message || 'Failed to prepare export on server.');
            }
            
            if (result.errors && result.errors.length > 0) {
                 const errorMessage = `Some files could not be prepared:\n${result.errors.map(e => `- ${e.path.split('/').pop()}: ${e.error}`).join('\n')}`;
                 window.holaf.toastManager.show({ message: errorMessage, type: 'error', duration: 0 });
            }

            const manifestUrl = `/holaf/images/export-chunk?export_id=${result.export_id}&file_path=manifest.json&chunk_index=0&chunk_size=1000000`;
            const manifestResponse = await fetch(manifestUrl);
            const manifest = await manifestResponse.json();

            if (manifest && manifest.length > 0) {
                const newFiles = manifest.map(file => ({ ...file, export_id: result.export_id }));
                
                const oldState = imageViewerState.getState();
                const newQueue = [...oldState.exporting.queue, ...newFiles];
                const newTotalFiles = oldState.exporting.stats.totalFiles + newFiles.length;
                imageViewerState.setState({ exporting: { queue: newQueue, stats: { ...oldState.exporting.stats, totalFiles: newTotalFiles }}});

                const activeToastId = imageViewerState.getState().exporting.activeToastId;
                if (activeToastId) {
                    window.holaf.toastManager.update(activeToastId, {
                        message: `Added ${newFiles.length} file(s) to queue. Starting download...`,
                        type: 'info'
                    });
                }
                
                if (!imageViewerState.getState().status.isExporting) {
                    imageViewerState.setState({ status: { isExporting: true }});
                    viewer.updateStatusBar();
                    viewer.processExportDownloadQueue();
                } else {
                    viewer.updateStatusBar();
                }
            } else {
                 const activeToastId = imageViewerState.getState().exporting.activeToastId;
                 if (activeToastId) {
                     window.holaf.toastManager.update(activeToastId, {
                        message: "No new files were added to the export queue.",
                        type: 'info', progress: 100
                     });
                     setTimeout(() => window.holaf.toastManager.hide(activeToastId), 5000);
                 }
                 if (!imageViewerState.getState().status.isExporting) viewer.updateStatusBar();
            }
        } catch (error) {
            console.error('[Holaf ImageViewer] Export preparation failed:', error);
            const activeToastId = imageViewerState.getState().exporting.activeToastId;
            if (activeToastId) {
                window.holaf.toastManager.update(activeToastId, {
                    message: `<strong>Export Failed:</strong><br>${error.message}`,
                    type: 'error', progress: 100
                });
            } else {
                window.holaf.toastManager.show({ message: `Export Failed: ${error.message}`, type: 'error', duration: 0 });
            }
        }
    });

    toggleMetaMethod();
    setupKeyboardNavigation();
    const lastRow = elementGrid.length - 1;
    const lastCol = elementGrid.length > 0 ? elementGrid[lastRow].length - 1 : 0;
    updateFocus(lastRow, lastCol);
    // --- END: Keyboard Navigation Logic (v2) ---
}

/**
 * Handles the "Export" action, checking for unsaved changes first.
 * @param {object} viewer - The main image viewer instance.
 */
export async function handleExport(viewer) {
    const imagesToExport = _getTargets();
    if (imagesToExport.length === 0) return;

    const editor = viewer.editor;

    // Check if the currently edited image (if any) is part of the export batch and has unsaved changes.
    const activeImageHasUnsavedChanges = editor &&
                                         editor.hasUnsavedChanges() &&
                                         editor.activeImage &&
                                         imagesToExport.some(img => img.path_canon === editor.activeImage.path_canon);

    if (activeImageHasUnsavedChanges) {
        const choice = await HolafPanelManager.createDialog({
            title: "Unsaved Changes Detected",
            message: "The active image has unsaved edits. How would you like to proceed with the export?",
            buttons: [
                { text: "Cancel", value: "cancel", type: "cancel" },
                { text: "Export without Saving", value: "export_without_saving" },
                { text: "Save & Export", value: "save_and_export", type: "confirm" }
            ],
            parentElement: viewer.panelElements.panelEl
        });

        switch (choice) {
            case "save_and_export":
                await editor.save(); // Await the save operation
                _showExportOptionsDialog(viewer, imagesToExport);
                break;
            case "export_without_saving":
                _showExportOptionsDialog(viewer, imagesToExport);
                break;
            case "cancel":
            default:
                return; // Do nothing
        }
    } else {
        // No unsaved changes, or the unsaved image is not part of the export batch.
        _showExportOptionsDialog(viewer, imagesToExport);
    }
}