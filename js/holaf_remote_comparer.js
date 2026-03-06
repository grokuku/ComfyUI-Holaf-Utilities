/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Remote Comparer
 *
 * Provides a floating, draggable UI overlay to compare two images.
 * Listens to executions from the 'HolafRemoteComparer' node.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

class HolafRemoteComparer {
    constructor() {
        this.isOpen = false;
        this.images = [];
        this.mouseX = null;
        this.isMouseOver = false;

        // DOM Elements
        this.containerEl = null;
        this.canvasEl = null;
        this.ctx = null;
        this.statusTextEl = null;
        this.headerEl = null;

        // Dragging state
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.initialLeft = 0;
        this.initialTop = 0;
    }

    init() {
        this.buildUI();
        this.attachEventListeners();
        console.log("[Holaf Remote Comparer] Initialized (Floating Window).");
    }

    buildUI() {
        // Container (The Floating Window)
        this.containerEl = document.createElement("div");
        this.containerEl.id = "holaf-remote-comparer-container";

        // Header (Draggable Area)
        this.headerEl = document.createElement("div");
        this.headerEl.id = "holaf-remote-comparer-header";

        const title = document.createElement("span");
        title.textContent = "Remote Image Comparer";

        const closeBtn = document.createElement("button");
        closeBtn.id = "holaf-rc-close-btn";
        closeBtn.innerHTML = "&times;";
        closeBtn.title = "Close Comparer";
        closeBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent triggering drag
            this.hide();
        };

        this.headerEl.appendChild(title);
        this.headerEl.appendChild(closeBtn);

        // Content Area
        const content = document.createElement("div");
        content.id = "holaf-remote-comparer-content";

        // Status Text
        this.statusTextEl = document.createElement("div");
        this.statusTextEl.id = "holaf-rc-status-text";
        this.statusTextEl.textContent = "Waiting for execution...";

        // Canvas
        this.canvasEl = document.createElement("canvas");
        this.canvasEl.id = "holaf-remote-comparer-canvas";
        this.ctx = this.canvasEl.getContext("2d");

        content.appendChild(this.statusTextEl);
        content.appendChild(this.canvasEl);

        this.containerEl.appendChild(this.headerEl);
        this.containerEl.appendChild(content);

        document.body.appendChild(this.containerEl);

        // Handle Window resizing (using CSS resize: both)
        const resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        resizeObserver.observe(content);
    }

    attachEventListeners() {
        // --- Dragging Logic ---
        this.headerEl.addEventListener("mousedown", (e) => {
            if (e.target.id === "holaf-rc-close-btn") return;
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;

            const rect = this.containerEl.getBoundingClientRect();
            this.initialLeft = rect.left;
            this.initialTop = rect.top;

            // Prevent text selection during drag
            document.body.style.userSelect = "none";
        });

        window.addEventListener("mousemove", (e) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;

            this.containerEl.style.left = `${this.initialLeft + dx}px`;
            this.containerEl.style.top = `${this.initialTop + dy}px`;
        });

        window.addEventListener("mouseup", () => {
            if (this.isDragging) {
                this.isDragging = false;
                document.body.style.userSelect = ""; // Restore selection
            }
        });

        // --- Canvas Slide interactions ---
        this.canvasEl.addEventListener("mousemove", (e) => {
            const rect = this.canvasEl.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            if (this.isOpen) this.draw();
        });

        this.canvasEl.addEventListener("mouseenter", () => {
            this.isMouseOver = true;
        });

        this.canvasEl.addEventListener("mouseleave", () => {
            this.isMouseOver = false;
            this.mouseX = null;
            if (this.isOpen) this.draw();
        });

        // --- Listen for ComfyUI Node Executions ---
        api.addEventListener("executed", (e) => this.handleNodeExecution(e));
    }

    resizeCanvas() {
        if (!this.canvasEl || !this.canvasEl.parentElement) return;
        const parent = this.canvasEl.parentElement;
        this.canvasEl.width = parent.clientWidth;
        this.canvasEl.height = parent.clientHeight;
        this.draw();
    }

    toggle() {
        this.isOpen ? this.hide() : this.show();
    }

    show() {
        this.isOpen = true;
        this.containerEl.style.display = "flex";
        this.resizeCanvas();

        // Ensure it's inside the viewport when opening
        const rect = this.containerEl.getBoundingClientRect();
        if (rect.top < 0) this.containerEl.style.top = "10px";
        if (rect.left < 0) this.containerEl.style.left = "10px";
    }

    hide() {
        this.isOpen = false;
        this.containerEl.style.display = "none";
    }

    async handleNodeExecution(event) {
        const detail = event.detail;
        if (!detail || !detail.node || !detail.output) return;

        const node = app.graph.getNodeById(detail.node);
        if (!node || node.type !== "HolafRemoteComparer") return;

        const imagesMeta = detail.output.ui?.images || detail.output.images;
        if (!imagesMeta || imagesMeta.length === 0) {
            this.statusTextEl.style.display = "block";
            this.statusTextEl.textContent = "No images received.";
            this.images = [];
            this.draw();
            return;
        }

        this.statusTextEl.style.display = "none";

        if (!this.isOpen) {
            this.show();
        }

        await this.loadImages(imagesMeta);
        this.draw();
    }

    loadImages(imagesMeta) {
        return new Promise((resolve) => {
            this.images = [];
            let loadedCount = 0;
            const targetCount = Math.min(imagesMeta.length, 2);

            for (let i = 0; i < targetCount; i++) {
                const meta = imagesMeta[i];
                const img = new Image();

                img.onload = () => {
                    loadedCount++;
                    if (loadedCount === targetCount) resolve();
                };

                img.onerror = () => {
                    console.error("[Holaf Remote Comparer] Failed to load image:", meta.filename);
                    loadedCount++;
                    if (loadedCount === targetCount) resolve();
                };

                const params = new URLSearchParams({
                    filename: meta.filename,
                    type: meta.type,
                    subfolder: meta.subfolder || ""
                });
                img.src = api.apiURL(`/view?${params.toString()}`);

                this.images.push(img);
            }
        });
    }

    draw() {
        if (!this.ctx || !this.canvasEl) return;

        const width = this.canvasEl.width;
        const height = this.canvasEl.height;
        this.ctx.clearRect(0, 0, width, height);

        if (this.images.length === 0) return;

        const imgA = this.images[0];
        const imgB = this.images.length > 1 ? this.images[1] : null;

        if (!imgA || !imgA.complete || imgA.naturalWidth === 0) return;

        const imgAspect = imgA.naturalWidth / imgA.naturalHeight;
        const canvasAspect = width / height;
        let drawWidth, drawHeight, offsetX = 0, offsetY = 0;

        if (imgAspect > canvasAspect) {
            drawWidth = width;
            drawHeight = width / imgAspect;
            offsetY = (height - drawHeight) / 2;
        } else {
            drawHeight = height;
            drawWidth = height * imgAspect;
            offsetX = (width - drawWidth) / 2;
        }

        this.ctx.drawImage(imgA, offsetX, offsetY, drawWidth, drawHeight);

        if (!imgB || !imgB.complete) return;

        if (this.isMouseOver && this.mouseX !== null) {
            this.ctx.save();
            this.ctx.beginPath();

            const clipWidth = Math.max(0, this.mouseX - offsetX);
            this.ctx.rect(offsetX, offsetY, clipWidth, drawHeight);
            this.ctx.clip();

            this.ctx.drawImage(imgB, offsetX, offsetY, drawWidth, drawHeight);
            this.ctx.restore();

            if (this.mouseX >= offsetX && this.mouseX <= offsetX + drawWidth) {
                this.ctx.beginPath();
                this.ctx.moveTo(this.mouseX, offsetY);
                this.ctx.lineTo(this.mouseX, offsetY + drawHeight);
                this.ctx.lineWidth = 1;
                this.ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
                this.ctx.globalCompositeOperation = "difference";
                this.ctx.stroke();
                this.ctx.globalCompositeOperation = "source-over";
            }
        }
    }
}

app.registerExtension({
    name: "Holaf.Utilities.RemoteComparer",
    async setup() {
        app.holafRemoteComparer = new HolafRemoteComparer();
        app.holafRemoteComparer.init();
    }
});