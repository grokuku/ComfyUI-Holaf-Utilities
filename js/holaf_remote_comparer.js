/*
    * Copyright (C) 2026 Holaf
    * Holaf Utilities - Remote Comparer
    *
    * Provides a floating UI overlay to compare two images.
    * Uses the exact skin, drag, resize and state persistence of HolafShortcuts.
    */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const HolafRemoteComparer = {
    name: "Holaf.RemoteComparer",
    isOpen: false,

    // --- DOM Elements ---
    rootElement: null,
    contentElement: null,
    canvasEl: null,
    ctx: null,
    statusTextEl: null,
    resizeHandle: null,

    // --- Comparison State ---
    images: [],
    mouseX: null,
    isMouseOver: false,

    // --- Window State ---
    storedPos: {
        right: 50,
        bottom: 50,
        width: 700,
        height: 500
    },
    STORAGE_KEY: "holaf_remote_comparer_state_v1",

    init() {
        this.restoreState();
        this.buildUI();

        window.addEventListener("resize", () => this.updateVisualPosition());
        api.addEventListener("executed", (e) => this.handleNodeExecution(e));

        if (this.isOpen) {
            // Small delay to ensure ComfyUI is fully loaded before showing
            setTimeout(() => this.show(), 300);
        }
        console.log("[Holaf Remote Comparer] Initialized.");
    },

    // --- UI CONSTRUCTION (Matched with Shortcuts skin) ---

    buildUI() {
        if (this.rootElement) return;

        this.rootElement = document.createElement("div");
        Object.assign(this.rootElement.style, {
            display: "none",
            position: "fixed",
            zIndex: "1000",
            backgroundColor: "rgba(20, 20, 20, 0.95)",
            borderRadius: "8px",
            border: "1px solid var(--border-color, #555)",
            backdropFilter: "blur(4px)",
            fontFamily: "sans-serif",
            boxSizing: "border-box",
            overflow: "hidden",
            flexDirection: "column",
            color: "#eee",
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.7)"
        });

        // Header
        const header = document.createElement("div");
        Object.assign(header.style, {
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            padding: "8px",
            backgroundColor: "rgba(255,255,255,0.05)",
            borderBottom: "1px solid #444",
            cursor: "move"
        });

        const title = document.createElement("span");
        title.innerText = "Remote Image Comparer";
        Object.assign(title.style, { flex: "1", fontWeight: "bold", fontSize: "12px", userSelect: "none" });

        const closeBtn = document.createElement("button");
        closeBtn.innerText = "✕";
        closeBtn.title = "Close";
        Object.assign(closeBtn.style, {
            background: "none", border: "none", color: "#888",
            cursor: "pointer", fontSize: "14px", padding: "0 6px",
            transition: "color 0.2s ease"
        });
        closeBtn.onmouseenter = () => closeBtn.style.color = "#ff5555";
        closeBtn.onmouseleave = () => closeBtn.style.color = "#888";
        closeBtn.onmousedown = (e) => e.stopPropagation(); // Prevent dragging
        closeBtn.onclick = () => this.hide();

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Content Area
        this.contentElement = document.createElement("div");
        Object.assign(this.contentElement.style, {
            flex: "1",
            position: "relative",
            backgroundColor: "#111",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden"
        });

        // Status Text
        this.statusTextEl = document.createElement("div");
        Object.assign(this.statusTextEl.style, {
            position: "absolute",
            color: "#777",
            fontSize: "12px",
            pointerEvents: "none",
            userSelect: "none"
        });
        this.statusTextEl.innerText = "Waiting for execution...";

        // Canvas
        this.canvasEl = document.createElement("canvas");
        Object.assign(this.canvasEl.style, {
            display: "block",
            cursor: "crosshair",
            width: "100%",
            height: "100%"
        });
        this.ctx = this.canvasEl.getContext("2d");

        this.contentElement.appendChild(this.statusTextEl);
        this.contentElement.appendChild(this.canvasEl);

        this.createResizeHandle();

        this.rootElement.appendChild(header);
        this.rootElement.appendChild(this.contentElement);
        this.rootElement.appendChild(this.resizeHandle);

        document.body.appendChild(this.rootElement);

        this.enableWindowDragging(header);
        this.attachCanvasListeners();
        this.updateVisualPosition();

        // Handle Canvas resizing properly
        const resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        resizeObserver.observe(this.contentElement);
    },

    // --- DRAG & RESIZE LOGIC (Copied from Shortcuts) ---

    updateVisualPosition() {
        if (!this.rootElement) return;

        this.rootElement.style.width = this.storedPos.width + "px";
        this.rootElement.style.height = this.storedPos.height + "px";

        const maxRight = window.innerWidth - this.storedPos.width;
        const maxBottom = window.innerHeight - this.storedPos.height;

        const visualRight = Math.max(0, Math.min(this.storedPos.right, maxRight));
        const visualBottom = Math.max(0, Math.min(this.storedPos.bottom, maxBottom));

        Object.assign(this.rootElement.style, {
            left: "auto", top: "auto",
            right: visualRight + "px",
            bottom: visualBottom + "px"
        });
    },

    enableWindowDragging(dragTarget) {
        let isDragging = false;
        let startX, startY, dragStartRight, dragStartBottom;

        dragTarget.addEventListener('mousedown', (e) => {
            if (e.target.tagName === "BUTTON") return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = this.rootElement.getBoundingClientRect();
            dragStartRight = window.innerWidth - rect.right;
            dragStartBottom = window.innerHeight - rect.bottom;

            this.rootElement.style.cursor = "move";
            e.preventDefault();

            const onMouseMove = (ev) => {
                if (!isDragging) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;

                this.storedPos.right = dragStartRight - dx;
                this.storedPos.bottom = dragStartBottom - dy;

                this.updateVisualPosition();
            };

            const onMouseUp = () => {
                if (isDragging) {
                    isDragging = false;
                    this.rootElement.style.cursor = "default";
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    this.saveState();
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },

    createResizeHandle() {
        this.resizeHandle = document.createElement("div");
        Object.assign(this.resizeHandle.style, {
            position: "absolute", bottom: "0", right: "0",
            width: "15px", height: "15px", cursor: "nwse-resize",
            zIndex: "20"
        });
        this.resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" style="width:100%; height:100%; fill:rgba(255,255,255,0.3);"><path d="M22 22H12v-2h10v-10h2v12z"/></svg>`;

        let isResizing = false;
        let startX, startY, startW, startH, startRight, startBottom;

        this.resizeHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = this.rootElement.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;
            startRight = window.innerWidth - rect.right;
            startBottom = window.innerHeight - rect.bottom;

            e.preventDefault();

            const onMouseMove = (ev) => {
                if (!isResizing) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;

                const newW = Math.max(300, startW + dx); // Minimum width
                const newH = Math.max(200, startH + dy); // Minimum height

                this.storedPos.width = newW;
                this.storedPos.height = newH;

                this.storedPos.right = startRight - (newW - startW);
                this.storedPos.bottom = startBottom - (newH - startH);

                this.updateVisualPosition();
            };

            const onMouseUp = () => {
                if (isResizing) {
                    isResizing = false;
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    this.saveState();
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },

    // --- STATE MANAGEMENT ---

    saveState() {
        if (!this.rootElement) return;
        const state = {
            ...this.storedPos,
            isOpen: this.isOpen
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    },

    restoreState() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const state = JSON.parse(saved);
                this.storedPos.right = state.right ?? 50;
                this.storedPos.bottom = state.bottom ?? 50;
                this.storedPos.width = state.width ?? 700;
                this.storedPos.height = state.height ?? 500;
                this.isOpen = !!state.isOpen;
            }
        } catch (e) { }
    },

    toggle() {
        this.isOpen = !this.isOpen;
        this.isOpen ? this.show() : this.hide();
        this.saveState();
        return this.isOpen;
    },

    show() {
        if (!this.rootElement) this.buildUI();
        this.rootElement.style.display = "flex";
        this.isOpen = true;
        this.updateVisualPosition();
        this.resizeCanvas();
    },

    hide() {
        if (this.rootElement) this.rootElement.style.display = "none";
        this.isOpen = false;
        this.saveState(); // Update state when hidden via the close button
    },

    // --- CANVAS INTERACTIONS & DRAWING ---

    attachCanvasListeners() {
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
    },

    resizeCanvas() {
        if (!this.canvasEl || !this.contentElement) return;
        this.canvasEl.width = this.contentElement.clientWidth;
        this.canvasEl.height = this.contentElement.clientHeight;
        this.draw();
    },

    async handleNodeExecution(event) {
        const detail = event.detail;
        if (!detail || !detail.node || !detail.output) return;

        const node = app.graph.getNodeById(detail.node);
        if (!node || node.type !== "HolafRemoteComparer") return;

        const imagesMeta = detail.output.ui?.images || detail.output.images;
        if (!imagesMeta || imagesMeta.length === 0) {
            this.statusTextEl.style.display = "block";
            this.statusTextEl.innerText = "No images received.";
            this.images = [];
            this.draw();
            return;
        }

        this.statusTextEl.style.display = "none";

        if (!this.isOpen) {
            this.show();
            this.saveState();
        }

        await this.loadImages(imagesMeta);
        this.draw();
    },

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
    },

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
};

app.registerExtension({
    name: HolafRemoteComparer.name,
    async setup() {
        HolafRemoteComparer.init();
        app.holafRemoteComparer = HolafRemoteComparer;
    }
});