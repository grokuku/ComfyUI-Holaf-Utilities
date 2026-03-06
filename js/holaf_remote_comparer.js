/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Remote Comparer
 *
 * Provides a floating UI overlay to compare two images.
 * Features: Drag, Resize, Fullscreen, Pop-out, Pan & Zoom (Internal Canvas Scaling).
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const HolafRemoteComparer = {
    name: "Holaf.RemoteComparer",
    isOpen: false,
    isFullscreen: false,
    isPoppedOut: false,

    // --- DOM Elements ---
    rootElement: null,
    contentElement: null,
    canvasEl: null,
    ctx: null,
    statusTextEl: null,
    resizeHandle: null,
    popupWindow: null,

    // --- Comparison State ---
    images: [],
    mouseX: null,
    isMouseOver: false,

    // --- Pan & Zoom State ---
    zoomState: { scale: 1, tx: 0, ty: 0 },
    isPanning: false,

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

        window.addEventListener("resize", () => {
            if (!this.isFullscreen && !this.isPoppedOut) {
                this.updateVisualPosition();
            }
        });
        api.addEventListener("executed", (e) => this.handleNodeExecution(e));

        if (this.isOpen) {
            setTimeout(() => this.show(), 300);
        }
        console.log("[Holaf Remote Comparer] Initialized.");
    },

    // --- UI CONSTRUCTION ---

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
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.7)",
            transition: "border-radius 0.2s ease"
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
        Object.assign(title.style, { flex: "1", fontWeight: "bold", fontSize: "12px", userSelect: "none", pointerEvents: "none" });

        const btnContainer = document.createElement("div");
        Object.assign(btnContainer.style, { display: "flex", gap: "8px" });

        // Pop-out Button
        const popoutBtn = document.createElement("button");
        popoutBtn.innerText = "↗";
        popoutBtn.title = "Pop out to new window";
        Object.assign(popoutBtn.style, {
            background: "none", border: "none", color: "#888",
            cursor: "pointer", fontSize: "14px", padding: "0",
            transition: "color 0.2s ease"
        });
        popoutBtn.onmouseenter = () => popoutBtn.style.color = "var(--holaf-accent-color, #ff8c00)";
        popoutBtn.onmouseleave = () => popoutBtn.style.color = "#888";
        popoutBtn.onmousedown = (e) => e.stopPropagation();
        popoutBtn.onclick = () => this.popOut();

        // Close Button
        const closeBtn = document.createElement("button");
        closeBtn.innerText = "✕";
        closeBtn.title = "Close";
        Object.assign(closeBtn.style, {
            background: "none", border: "none", color: "#888",
            cursor: "pointer", fontSize: "14px", padding: "0",
            transition: "color 0.2s ease"
        });
        closeBtn.onmouseenter = () => closeBtn.style.color = "#ff5555";
        closeBtn.onmouseleave = () => closeBtn.style.color = "#888";
        closeBtn.onmousedown = (e) => e.stopPropagation();
        closeBtn.onclick = () => this.hide();

        btnContainer.appendChild(popoutBtn);
        btnContainer.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(btnContainer);

        header.addEventListener('dblclick', (e) => {
            if (e.target.tagName === "BUTTON") return;
            this.toggleFullscreen();
        });

        // Content Area
        this.contentElement = document.createElement("div");
        Object.assign(this.contentElement.style, {
            flex: "1",
            position: "relative",
            backgroundColor: "#111",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden",
            width: "100%",
            height: "100%"
        });

        // Status Text
        this.statusTextEl = document.createElement("div");
        Object.assign(this.statusTextEl.style, {
            position: "absolute",
            color: "#777",
            fontSize: "12px",
            pointerEvents: "none",
            userSelect: "none",
            zIndex: "10"
        });
        this.statusTextEl.innerText = "Waiting for execution...";

        // Canvas
        this.canvasEl = document.createElement("canvas");
        Object.assign(this.canvasEl.style, {
            display: "block",
            cursor: "crosshair",
            width: "100%",
            height: "100%"
            // CSS transform is entirely removed here to preserve native resolution
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

        const resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        resizeObserver.observe(this.contentElement);
    },

    // --- FULLSCREEN LOGIC ---

    toggleFullscreen() {
        this.isFullscreen = !this.isFullscreen;
        if (this.isFullscreen) {
            Object.assign(this.rootElement.style, {
                width: "100vw",
                height: "100vh",
                right: "0px",
                bottom: "0px",
                borderRadius: "0px"
            });
            this.resizeHandle.style.display = "none";
        } else {
            this.rootElement.style.borderRadius = "8px";
            this.resizeHandle.style.display = "block";
            this.updateVisualPosition();
        }
        setTimeout(() => this.resizeCanvas(), 50);
    },

    // --- POPOUT LOGIC ---

    popOut() {
        if (this.isPoppedOut) return;
        this.isPoppedOut = true;

        this.rootElement.style.display = "none";
        if (this.isFullscreen) this.toggleFullscreen();

        const w = this.storedPos.width;
        const h = this.storedPos.height;
        this.popupWindow = window.open("", "HolafRemoteComparerPopup", `width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`);

        if (!this.popupWindow) {
            alert("Popup blocked! Please allow popups for ComfyUI to use the Pop-out feature.");
            this.isPoppedOut = false;
            this.rootElement.style.display = "flex";
            return;
        }

        const doc = this.popupWindow.document;
        doc.title = "Holaf Remote Comparer";

        Object.assign(doc.body.style, {
            margin: "0",
            backgroundColor: "#111",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "100vh"
        });

        const popupHeader = doc.createElement("div");
        const returnBtn = doc.createElement("button");
        returnBtn.innerText = "↘ Return to ComfyUI Canvas";
        Object.assign(returnBtn.style, {
            width: "100%", padding: "8px", background: "#353535", color: "#eee",
            border: "none", borderBottom: "1px solid #555", cursor: "pointer",
            fontFamily: "sans-serif", fontWeight: "bold", transition: "background 0.2s"
        });
        returnBtn.onmouseenter = () => returnBtn.style.background = "#444";
        returnBtn.onmouseleave = () => returnBtn.style.background = "#353535";
        returnBtn.onclick = () => this.popIn();

        popupHeader.appendChild(returnBtn);
        doc.body.appendChild(popupHeader);
        doc.body.appendChild(this.contentElement);

        this.popupWindow.onbeforeunload = () => this.popIn();
        this.popupWindow.addEventListener("resize", () => this.resizeCanvas());

        setTimeout(() => this.resizeCanvas(), 50);
    },

    popIn() {
        if (!this.isPoppedOut) return;
        this.isPoppedOut = false;

        this.rootElement.insertBefore(this.contentElement, this.resizeHandle);

        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.onbeforeunload = null;
            this.popupWindow.close();
        }
        this.popupWindow = null;

        if (this.isOpen) {
            this.rootElement.style.display = "flex";
            this.updateVisualPosition();
        }

        setTimeout(() => this.resizeCanvas(), 50);
    },

    // --- DRAG & RESIZE LOGIC ---

    updateVisualPosition() {
        if (!this.rootElement || this.isFullscreen || this.isPoppedOut) return;

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
            if (e.target.tagName === "BUTTON" || this.isFullscreen) return;

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
            if (this.isFullscreen) return;
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

                const newW = Math.max(300, startW + dx);
                const newH = Math.max(200, startH + dy);

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
        this.isOpen = true;

        if (!this.isPoppedOut) {
            this.rootElement.style.display = "flex";
            if (!this.isFullscreen) this.updateVisualPosition();
        }

        this.resizeCanvas();
    },

    hide() {
        this.isOpen = false;
        if (this.isPoppedOut) {
            this.popIn();
        }
        if (this.rootElement) this.rootElement.style.display = "none";
        this.saveState();
    },

    // --- PAN, ZOOM & CANVAS LOGIC ---

    resetZoom() {
        this.zoomState = { scale: 1, tx: 0, ty: 0 };
        this.draw();
    },

    attachCanvasListeners() {
        // Slider movement
        this.contentElement.addEventListener("mousemove", (e) => {
            const rect = this.contentElement.getBoundingClientRect();
            const screenX = e.clientX - rect.left;

            // Map screen mouse position to scaled canvas coordinates
            this.mouseX = (screenX - this.zoomState.tx) / this.zoomState.scale;

            if (this.isOpen || this.isPoppedOut) {
                this.draw();
            }
        });

        this.contentElement.addEventListener("mouseenter", () => {
            this.isMouseOver = true;
        });

        this.contentElement.addEventListener("mouseleave", () => {
            this.isMouseOver = false;
            this.mouseX = null;
            if (this.isOpen || this.isPoppedOut) this.draw();
        });

        // Zoom (Scroll wheel)
        this.contentElement.addEventListener("wheel", (e) => {
            if (this.images.length === 0) return;
            e.preventDefault();

            const state = this.zoomState;
            const oldScale = state.scale;
            const newScale = e.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
            state.scale = Math.max(1, Math.min(newScale, 30));

            if (state.scale === oldScale) return;

            const rect = this.contentElement.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Zoom relative to mouse cursor
            state.tx = mouseX - (mouseX - state.tx) * (state.scale / oldScale);
            state.ty = mouseY - (mouseY - state.ty) * (state.scale / oldScale);

            if (state.scale <= 1) {
                this.resetZoom();
            } else {
                this.draw();
            }
        });

        // Pan (Drag)
        this.contentElement.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || this.zoomState.scale <= 1) return; // Only left-click when zoomed
            e.preventDefault();

            this.isPanning = true;
            const state = this.zoomState;
            let startX = e.clientX - state.tx;
            let startY = e.clientY - state.ty;

            this.canvasEl.style.cursor = 'grabbing';

            const onMouseMove = (moveEvent) => {
                state.tx = moveEvent.clientX - startX;
                state.ty = moveEvent.clientY - startY;

                // Update slider position while panning
                const rect = this.contentElement.getBoundingClientRect();
                const screenX = moveEvent.clientX - rect.left;
                this.mouseX = (screenX - state.tx) / state.scale;

                this.draw();
            };

            const onMouseUp = () => {
                this.isPanning = false;
                this.canvasEl.style.cursor = 'crosshair';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        this.canvasEl.ondragstart = (e) => e.preventDefault();
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
            this.resetZoom();
            return;
        }

        this.statusTextEl.style.display = "none";

        if (!this.isOpen && !this.isPoppedOut) {
            this.show();
            this.saveState();
        }

        this.resetZoom();
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

        // Always reset transform before clearing to ensure the entire physical canvas is wiped
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, width, height);

        if (this.images.length === 0) return;

        const imgA = this.images[0];
        const imgB = this.images.length > 1 ? this.images[1] : null;

        if (!imgA || !imgA.complete || imgA.naturalWidth === 0) return;

        // Apply internal canvas zoom and pan
        this.ctx.translate(this.zoomState.tx, this.zoomState.ty);
        this.ctx.scale(this.zoomState.scale, this.zoomState.scale);

        const imgAspect = imgA.naturalWidth / imgA.naturalHeight;
        const canvasAspect = width / height;
        let drawWidth, drawHeight, offsetX = 0, offsetY = 0;

        // Letterboxing calculation based on unscaled bounds
        if (imgAspect > canvasAspect) {
            drawWidth = width;
            drawHeight = width / imgAspect;
            offsetY = (height - drawHeight) / 2;
        } else {
            drawHeight = height;
            drawWidth = height * imgAspect;
            offsetX = (width - drawWidth) / 2;
        }

        // Draw background image
        // Because of ctx.scale, this will pull high-res data from the source image
        this.ctx.drawImage(imgA, offsetX, offsetY, drawWidth, drawHeight);

        if (!imgB || !imgB.complete) return;

        // Draw foreground split image
        if ((this.isMouseOver || this.isPanning) && this.mouseX !== null) {
            this.ctx.save();
            this.ctx.beginPath();

            const clipWidth = Math.max(0, this.mouseX - offsetX);
            this.ctx.rect(offsetX, offsetY, clipWidth, drawHeight);
            this.ctx.clip();

            this.ctx.drawImage(imgB, offsetX, offsetY, drawWidth, drawHeight);
            this.ctx.restore();

            // Draw split separator line
            if (this.mouseX >= offsetX && this.mouseX <= offsetX + drawWidth) {
                this.ctx.beginPath();
                this.ctx.moveTo(this.mouseX, offsetY);
                this.ctx.lineTo(this.mouseX, offsetY + drawHeight);

                // Keep the line visually 1px wide regardless of canvas CSS scale
                this.ctx.lineWidth = 1 / (this.zoomState.scale || 1);

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