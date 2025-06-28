/*
 * Holaf Utilities - Model Manager Actions
 * This module contains the business logic for all user actions such as
 * uploading, downloading, scanning, and deleting models.
 * MODIFIED: Removed SHA256 hashing for uploads to improve performance.
 * Replaced with a simple file size check on the server side.
 */

import { HolafPanelManager } from "../holaf_panel_manager.js";

// --- UPLOAD LOGIC ---

/**
 * Adds selected files from the upload dialog to the processing queue.
 * @param {object} manager - The main model manager instance.
 */
export function addFilesToUploadQueue(manager) {
    const { fileInput, destTypeSelect, subfolderInput, dialogEl, statusMessage } = manager.uploadDialog;
    const files = fileInput.files;
    const destType = destTypeSelect.value;
    const subfolder = subfolderInput.value.trim();

    if (files.length === 0) {
        statusMessage.textContent = "Please select at least one file.";
        return;
    }

    for (const file of files) {
        const job = {
            file: file,
            id: `holaf-upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            status: 'queued',
            progress: 0,
            chunksSent: 0,
            totalChunks: Math.ceil(file.size / manager.UPLOAD_CHUNK_SIZE),
            destType,
            subfolder,
            errorMessage: null,
            sentBytes: 0,
            // sha256 property removed
        };
        manager.uploadQueue.push(job);
    }

    dialogEl.style.display = 'none';
    fileInput.value = '';
    manager.uploadDialog.fileListEl.style.display = 'none';

    if (!manager.isUploading) {
        processUploadQueue(manager);
    }
}

/**
 * Processes the upload queue, one file at a time.
 * @param {object} manager - The main model manager instance.
 */
export async function processUploadQueue(manager) {
    if (manager.activeUploads >= manager.MAX_CONCURRENT_UPLOADS) return;

    const nextJob = manager.uploadQueue.find(j => j.status === 'queued');
    if (!nextJob) {
        if (manager.activeUploads === 0) {
            manager.isUploading = false;
            if (manager.refreshAfterUpload) {
                setTimeout(() => { manager.filterModels(); }, 3000); // Refresh list
            }
            manager.refreshAfterUpload = false;
            // Do not clear the queue here to allow inspection of errors
        }
        return;
    }

    manager.isUploading = true;
    manager.updateActionButtonsState();
    manager.activeUploads++;
    nextJob.status = 'uploading'; // Status changed from 'hashing' to 'uploading'

    if (!manager.statusUpdateRaf) {
        manager.updateStatusBarText();
    }
    manager.uploadStats.totalBytes += nextJob.file.size;

    await uploadFile(manager, nextJob);

    manager.activeUploads--;
    processUploadQueue(manager); // Process next job
}

async function uploadFile(manager, job) {
    try {
        // Hashing step removed
        const chunkIndices = Array.from({ length: job.totalChunks }, (_, i) => i);
        let parallelQueue = [...chunkIndices];

        await new Promise((resolve, reject) => {
            const worker = async () => {
                while (parallelQueue.length > 0) {
                    const chunkIndex = parallelQueue.shift();
                    if (chunkIndex === undefined) continue;

                    try {
                        const start = chunkIndex * manager.UPLOAD_CHUNK_SIZE;
                        const end = Math.min(start + manager.UPLOAD_CHUNK_SIZE, job.file.size);
                        const chunk = job.file.slice(start, end);

                        const formData = new FormData();
                        formData.append("upload_id", job.id);
                        formData.append("chunk_index", chunkIndex);
                        formData.append("file_chunk", chunk);

                        const response = await fetch('/holaf/models/upload-chunk', { method: 'POST', body: formData });
                        if (!response.ok) {
                            const errorData = await response.json().catch(() => ({}));
                            throw new Error(errorData.message || `Chunk ${chunkIndex} failed.`);
                        }
                        job.chunksSent++;
                        job.sentBytes += chunk.size;
                        job.progress = (job.chunksSent / job.totalChunks) * 100;
                        manager.uploadStats.totalSentBytes += chunk.size;
                        calculateSpeed(manager.uploadStats);
                    } catch (err) {
                        job.status = 'error';
                        job.errorMessage = err.message;
                        reject(err);
                        return; // Stop this worker
                    }
                }
            };
            const workers = Array(manager.MAX_CONCURRENT_CHUNKS).fill(null).map(() => worker());
            Promise.all(workers).then(resolve).catch(reject);
        });

        job.status = 'finalizing';
        await finalizeUpload(manager, job);

    } catch (error) {
        job.status = 'error';
        job.errorMessage = error.message;
    }
}

async function finalizeUpload(manager, job) {
    try {
        const response = await fetch('/holaf/models/finalize-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                upload_id: job.id,
                filename: job.file.name,
                total_chunks: job.totalChunks,
                destination_type: job.destType,
                subfolder: job.subfolder,
                expected_size: job.file.size,
                // expected_sha256 removed from payload
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Finalization failed.');
        job.status = 'done';
        manager.refreshAfterUpload = true;
    } catch (error) {
        job.status = 'error';
        job.errorMessage = error.message;
    }
}


// --- DOWNLOAD LOGIC ---

export function addSelectedToDownloadQueue(manager) {
    const pathsToDownload = getAvailablePathsForAction(manager, manager.selectedModelPaths);
    if (pathsToDownload.length === 0) {
        HolafPanelManager.createDialog({ title: "Download Models", message: "No available models selected for download." });
        return;
    }

    for (const path of pathsToDownload) {
        const model = manager.models.find(m => m.path === path);
        if (model) {
            const totalChunks = Math.ceil(model.size_bytes / manager.DOWNLOAD_CHUNK_SIZE);
            manager.downloadQueue.push({
                model,
                id: `holaf-download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                status: 'queued',
                progress: 0,
                chunksReceived: 0,
                totalChunks,
                receivedBytes: 0,
                chunksData: new Array(totalChunks),
            });
        }
    }
    manager.selectedModelPaths.clear();
    manager.filterModels();
    manager.updateActionButtonsState();

    if (!manager.isDownloading) {
        processDownloadQueue(manager);
    }
}

export async function processDownloadQueue(manager) {
    if (manager.activeDownloads >= manager.MAX_CONCURRENT_DOWNLOADS) return;

    const nextJob = manager.downloadQueue.find(j => j.status === 'queued');
    if (!nextJob) {
        if (manager.activeDownloads === 0) manager.isDownloading = false;
        return;
    }

    manager.isDownloading = true;
    manager.updateActionButtonsState();
    manager.activeDownloads++;
    nextJob.status = 'downloading';

    if (!manager.statusUpdateRaf) manager.updateStatusBarText();
    manager.downloadStats.totalBytes += nextJob.model.size_bytes;

    await downloadFile(manager, nextJob);

    manager.activeDownloads--;
    processDownloadQueue(manager);
}

async function downloadFile(manager, job) {
    try {
        let parallelQueue = Array.from({ length: job.totalChunks }, (_, i) => i);
        await new Promise((resolve, reject) => {
            const worker = async () => {
                while (parallelQueue.length > 0) {
                    const chunkIndex = parallelQueue.shift();
                    if (chunkIndex === undefined) continue;
                    try {
                        const response = await fetch('/holaf/models/download-chunk', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                path: job.model.path,
                                chunk_index: chunkIndex,
                                chunk_size: manager.DOWNLOAD_CHUNK_SIZE,
                            })
                        });
                        if (!response.ok) throw new Error(await response.text());
                        
                        const chunkBlob = await response.blob();
                        job.chunksData[chunkIndex] = chunkBlob;
                        job.chunksReceived++;
                        job.receivedBytes += chunkBlob.size;
                        job.progress = (job.chunksReceived / job.totalChunks) * 100;
                        manager.downloadStats.totalReceivedBytes += chunkBlob.size;
                        calculateSpeed(manager.downloadStats);
                    } catch (err) {
                        job.status = 'error';
                        job.errorMessage = err.message;
                        reject(err);
                        return;
                    }
                }
            };
            const workers = Array(manager.MAX_CONCURRENT_CHUNKS).fill(null).map(() => worker());
            Promise.all(workers).then(resolve).catch(reject);
        });

        await assembleAndSaveFile(job);
    } catch (error) {
        job.status = 'error';
        job.errorMessage = error.message || "Unknown download error";
    }
}

async function assembleAndSaveFile(job) {
    job.status = 'assembling';
    try {
        const finalBlob = new Blob(job.chunksData, { type: 'application/octet-stream' });
        if (finalBlob.size !== job.model.size_bytes) {
            throw new Error(`Assembled size mismatch. Expected ${job.model.size_bytes}, got ${finalBlob.size}.`);
        }
        const url = window.URL.createObjectURL(finalBlob);
        const a = Object.assign(document.createElement('a'), { href: url, download: job.model.name, style: "display:none" });
        document.body.appendChild(a).click();
        document.body.removeChild(a);
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        job.status = 'done';
    } catch (error) {
        job.status = 'error';
        job.errorMessage = error.message;
    }
}


// --- SCAN AND DELETE LOGIC ---

export function addSelectedToScanQueue(manager) {
    const allSelected = Array.from(manager.selectedModelPaths);
    const pathsToScan = getAvailablePathsForAction(manager, allSelected.filter(p => p.toLowerCase().endsWith('.safetensors')));
    if (pathsToScan.length === 0) {
        HolafPanelManager.createDialog({ title: "Deep Scan", message: "No eligible (.safetensors) and available models selected for scanning." });
        return;
    }
    manager.scanQueue.push(...pathsToScan);
    manager.selectedModelPaths.clear();
    manager.filterModels();
    manager.updateActionButtonsState();
    if (!manager.isDeepScanning) processScanQueue(manager);
}

export async function processScanQueue(manager) {
    if (manager.scanQueue.length === 0) {
        manager.isDeepScanning = false;
        if (!manager.isUploading && !manager.isDownloading) manager.filterModels();
        return;
    }
    manager.isDeepScanning = true;
    if (!manager.statusUpdateRaf) manager.updateStatusBarText();

    const pathsToScanInBatch = manager.scanQueue.splice(0, manager.scanQueue.length);
    try {
        const response = await fetch('/holaf/models/deep-scan-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: pathsToScanInBatch })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);
        if (result.details?.errors?.length > 0) console.error("[Holaf MM] Deep Scan Errors:", result.details.errors);
    } catch (error) {
        HolafPanelManager.createDialog({ title: "Deep Scan Error", message: `A scan batch failed:\n${error.message}` });
    } finally {
        processScanQueue(manager); // Process next batch or finish
    }
}

export async function performDelete(manager) {
    const pathsToDelete = getAvailablePathsForAction(manager, manager.selectedModelPaths);
    if (pathsToDelete.length === 0) {
        HolafPanelManager.createDialog({ title: "Delete Models", message: "No available models selected for deletion." });
        return;
    }
    const confirmed = await HolafPanelManager.createDialog({
        title: "Confirm Deletion",
        message: `PERMANENTLY delete ${pathsToDelete.length} model(s)? This cannot be undone.`,
        buttons: [{ text: "Cancel", value: false }, { text: "Delete Permanently", value: true, type: "danger" }]
    });
    if (!confirmed) return;

    manager.isLoading = true;
    manager.updateActionButtonsState();
    try {
        const response = await fetch('/holaf/models/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: pathsToDelete })
        });
        const result = await response.json();
        if (!response.ok && response.status !== 207) throw new Error(result.message || `HTTP error ${response.status}`);
        let message = `${result.details?.deleted_count || 0} model(s) processed for deletion.`;
        if (result.details?.errors?.length > 0) {
            message += `\n\n${result.details.errors.length} error(s) occurred. Check console.`;
            console.error("[Holaf MM] Delete Errors:", result.details.errors);
        }
        await HolafPanelManager.createDialog({ title: "Deletion Complete", message });
    } catch (error) {
        await HolafPanelManager.createDialog({ title: "Deletion Error", message: `Delete failed:\n${error.message}` });
    } finally {
        manager.isLoading = false;
        manager.selectedModelPaths.clear();
        await manager.filterModels();
    }
}


// --- UTILITY FUNCTIONS ---

function getAvailablePathsForAction(manager, selectedPaths) {
    const allSelected = Array.from(selectedPaths);
    const availablePaths = allSelected.filter(path => !isPathInActiveTransfer(manager, path));
    const skippedCount = allSelected.length - availablePaths.length;
    if (skippedCount > 0) {
        HolafPanelManager.createDialog({ title: "Notice", message: `${skippedCount} file(s) were skipped as they are currently being transferred.` });
    }
    return availablePaths;
}

function isPathInActiveTransfer(manager, path) {
    const filename = path.split('/').pop();
    const inUpload = manager.uploadQueue.some(j => j.file.name === filename && j.status !== 'done' && j.status !== 'error');
    const inDownload = manager.downloadQueue.some(j => j.model.path === path && j.status !== 'done' && j.status !== 'error');
    return inUpload || inDownload;
}

// The calculateFileSHA256 function has been removed.

function calculateSpeed(statsObject) {
    const now = Date.now();
    const byteSource = statsObject.totalSentBytes ?? statsObject.totalReceivedBytes;
    statsObject.history.push({ time: now, bytes: byteSource });
    while (statsObject.history.length > 20 && now - statsObject.history[0].time > 5000) {
        statsObject.history.shift();
    }
    if (statsObject.history.length > 1) {
        const first = statsObject.history[0];
        const last = statsObject.history[statsObject.history.length - 1];
        const deltaTime = (last.time - first.time) / 1000;
        if (deltaTime > 0.1) {
            statsObject.currentSpeed = ((last.bytes - first.bytes) / deltaTime) / (1024 * 1024);
        }
    }
}