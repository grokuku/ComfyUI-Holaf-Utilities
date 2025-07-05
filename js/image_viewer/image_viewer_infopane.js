/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Image Viewer Info Pane Module
 *
 * This module is responsible for fetching and displaying detailed
 * image information and metadata in the right-hand side pane.
 * REFACTOR: Subscribes to imageViewerState to update automatically.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager } from "../holaf_panel_manager.js";
import { imageViewerState } from './image_viewer_state.js';

// Module-level variables to manage state
let abortController = null;
let lastProcessedPath = null;

/**
 * Copies text to the user's clipboard.
 * @param {string} text - The text to copy.
 * @returns {Promise<void>}
 */
function copyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(resolve).catch(reject);
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.top = "-9999px";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                if (document.execCommand('copy')) resolve();
                else reject(new Error('Copy command failed.'));
            } catch (err) {
                reject(err);
            }
            document.body.removeChild(textArea);
        }
    });
}

/**
 * Fetches and displays metadata for a given image in the info pane.
 * @param {object|null} image - The image data object, or null to clear the pane.
 */
async function displayInfoForImage(image) {
    const infoContentEl = document.getElementById('holaf-viewer-info-content');
    if (!infoContentEl) return;

    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();
    const signal = abortController.signal;

    if (!image) {
         infoContentEl.innerHTML = `<p class="holaf-viewer-message">Select an image to see details.</p>`;
         return;
    }

    const sizeInMB = (image.size_bytes / 1048576).toFixed(2);
    let originalPathInfo = '';
    if (image.is_trashed && image.original_path_canon) {
        originalPathInfo = `<p><strong>Original Path:</strong><br>${image.original_path_canon}</p>`;
    }

    infoContentEl.innerHTML = `<p><strong>Filename:</strong><br>${image.filename}</p><p><strong>Folder:</strong> ${image.subfolder || '/'}</p>${originalPathInfo}<p><strong>Size:</strong> ${sizeInMB} MB</p><p><strong>Format:</strong> ${image.format}</p><p><strong>Modified:</strong><br>${new Date(image.mtime * 1000).toLocaleString()}</p><div id="holaf-resolution-container"></div><hr><div id="holaf-metadata-container"><p class="holaf-viewer-message"><em>Loading metadata...</em></p></div>`;

    try {
        const metadataUrl = new URL(window.location.origin);
        metadataUrl.pathname = '/holaf/images/metadata';
        metadataUrl.search = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' });

        const response = await fetch(metadataUrl.href, { signal, cache: 'no-store' });
        if (signal.aborted) return;

        const metadataContainer = document.getElementById('holaf-metadata-container');
        if (!metadataContainer) return;

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `HTTP Error ${response.status}` }));
            metadataContainer.innerHTML = `<p class="holaf-viewer-message error"><strong>Error:</strong> ${errorData.error || 'Unknown error'}</p>`;
            return;
        }

        const data = await response.json();
        if (signal.aborted) return;
        
        const finalMetadataContainer = document.getElementById('holaf-metadata-container');
        if (!finalMetadataContainer) return;

        const resolutionContainer = document.getElementById('holaf-resolution-container');
        if (resolutionContainer) {
            let resolutionHTML = '';
            if (data.width && data.height) resolutionHTML += `<p><strong>Resolution:</strong> ${data.width}x${data.height} px</p>`;
            if (data.ratio) resolutionHTML += `<p><strong>Ratio:</strong> ${data.ratio}</p>`;
            resolutionContainer.innerHTML = resolutionHTML;
        }

        const getSourceLabel = (s) => ({ "external_txt": "(from .txt)", "external_json": "(from .json)", "internal_png": "(from PNG)" }[s] || "");
        finalMetadataContainer.innerHTML = '';

        const createButton = (txt, cb, dis = false) => {
            const b = document.createElement('button');
            b.className = 'holaf-viewer-info-button';
            b.textContent = txt;
            b.disabled = dis;
            if (!dis) b.onclick = cb;
            return b;
        };

        finalMetadataContainer.innerHTML += `<p><span class="holaf-viewer-metadata-label">Prompt:</span><span class="holaf-viewer-metadata-source">${getSourceLabel(data.prompt_source)}</span></p>`;
        const promptActions = document.createElement('div');
        promptActions.className = 'holaf-viewer-info-actions';
        promptActions.appendChild(createButton('📋 Copy Prompt', (e) => {
            copyTextToClipboard(data.prompt).then(() => {
                e.target.textContent = 'Copied!';
                setTimeout(() => e.target.textContent = '📋 Copy Prompt', 1500);
            }).catch(err => {
                console.error('Copy failed:', err);
                e.target.textContent = 'Copy Failed!';
                setTimeout(() => e.target.textContent = '📋 Copy Prompt', 2000);
            });
        }, !data.prompt));
        finalMetadataContainer.appendChild(promptActions);

        if (data.prompt) {
            const promptBox = document.createElement('div');
            promptBox.className = 'holaf-viewer-metadata-box';
            promptBox.textContent = data.prompt;
            finalMetadataContainer.appendChild(promptBox);
        } else {
            finalMetadataContainer.innerHTML += `<p class="holaf-viewer-message"><em>Not available.</em></p>`;
        }

        finalMetadataContainer.innerHTML += `<p style="margin-top:15px;"><span class="holaf-viewer-metadata-label">Workflow:</span><span class="holaf-viewer-metadata-source">${getSourceLabel(data.workflow_source)}</span></p>`;
        const workflowActions = document.createElement('div');
        workflowActions.className = 'holaf-viewer-info-actions';
        workflowActions.appendChild(createButton('⚡ Load Workflow', async () => {
            if (await HolafPanelManager.createDialog({
                    title: 'Load Workflow',
                    message: 'Load image workflow?',
                    buttons: [{ text: 'Cancel', value: false }, { text: 'Load', value: true }]
                })) app.loadGraphData(data.workflow);
        }, !data.workflow || !!data.workflow.error));
        finalMetadataContainer.appendChild(workflowActions);

        if (data.workflow && !data.workflow.error) {
            const workflowBox = document.createElement('div');
            workflowBox.className = 'holaf-viewer-metadata-box';
            workflowBox.textContent = JSON.stringify(data.workflow, null, 2);
            finalMetadataContainer.appendChild(workflowBox);
        } else if (data.workflow && data.workflow.error) {
            finalMetadataContainer.innerHTML += `<p class="holaf-viewer-message error"><em>Error: ${data.workflow.error}</em></p>`;
        } else {
            finalMetadataContainer.innerHTML += `<p class="holaf-viewer-message"><em>No workflow found.</em></p>`;
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error("Metadata fetch error:", err);
            const m = document.getElementById('holaf-metadata-container');
            if (m) m.innerHTML = `<p class="holaf-viewer-message error"><strong>Error:</strong> Failed to fetch metadata.</p>`;
        }
    }
}

/**
 * Initializes the info pane to subscribe to state changes.
 */
export function setupInfoPane() {
    imageViewerState.subscribe(newState => {
        const activeImage = newState.activeImage;
        const activeImagePath = activeImage ? activeImage.path_canon : null;

        if (activeImagePath !== lastProcessedPath) {
            lastProcessedPath = activeImagePath;
            displayInfoForImage(activeImage);
        }
    });
}