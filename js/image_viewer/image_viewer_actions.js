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

    if (btnDelete) btnDelete.onclick = () => handleDelete(viewer);
    if (btnRestore) btnRestore.onclick = () => handleRestore(viewer);
    if (btnExtract) btnExtract.onclick = () => handleExtractMetadata(viewer);
    if (btnInject) btnInject.onclick = () => handleInjectMetadata(viewer);
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
    const hasSelection = viewer.selectedImages.size > 0;

    let canRestore = false;
    if (hasSelection) {
        // Enable restore only if ALL selected images are in the trashcan
        canRestore = Array.from(viewer.selectedImages).every(img => img.is_trashed);
    }
    const canPerformNonTrashActions = hasSelection && Array.from(viewer.selectedImages).every(img => !img.is_trashed);


    if (btnDelete) btnDelete.disabled = !canPerformNonTrashActions;
    if (btnRestore) btnRestore.disabled = !canRestore;
    if (btnExtract) btnExtract.disabled = !canPerformNonTrashActions; // For now, only on non-trashed
    if (btnInject) btnInject.disabled = !canPerformNonTrashActions;  // For now, only on non-trashed


    const statusBarEl = document.getElementById('holaf-viewer-statusbar');
    if (statusBarEl) {
        let currentText = statusBarEl.textContent.split(' | Selected:')[0];
        if (hasSelection) {
            currentText += ` | Selected: ${viewer.selectedImages.size}`;
        }
        statusBarEl.textContent = currentText;
    }
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
                viewer.loadFilteredImages(); // This will re-render and update button states
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