/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Remote Comparer
 *
 * Provides a floating UI overlay to compare two images.
 * Features: Drag, Resize, Fullscreen, Pop-out, Pan & Zoom (Internal Canvas Scaling).
 * Node Preview: Hidden in graph, visible only in Remote Comparer.
 * History: Volatile sidebar history for fast comparison switching.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const HolafRemoteComparer = {
    name: "Holaf.RemoteComparer",
    isOpen: false,
    isFullscreen: false,
    isPoppedOut: false,
    isSidebarOpen: true,

    // --- DOM Elements ---
    rootElement: null,
    mainContainer: null,
    sidebarElement: null,
    contentElement: null,
    canvasEl: null,
    ctx: null,
    statusTextEl: null,
    resizeHandle: null,
    popupWindow: null,

    // --- Comparison & History State ---
    history:[], // Array of { name, imagesMeta }
    latestImagesMeta: [],
    currentViewName: "latest", // "latest" or a specific comparison name
    images:[], // Currently loaded JS Image objects
    mouseX: null,
    isMouseOver: false,

    // --- Pan & Zoom State ---
    zoomState: { scale: 1, tx: 0, ty: 0 },
    isPanning: false,

    // --- Window State ---
    storedPos: {
        right: 50,
        bottom: 50,
        width: 850,
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

        // Sidebar Toggle Button
        const sidebarBtn = document.createElement("button");
        sidebarBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 3h18v18H3V3zm16 16V5H9v14h10z"/></svg>`;
        sidebarBtn.title = "Toggle Sidebar";
        Object.assign(sidebarBtn.style, {
            background: "none", border: "none", color: "#888",
            cursor: "pointer", padding: "0", display: "flex", alignItems: "center",
            transition: "color 0.2s ease"
        });
        sidebarBtn.onmouseenter = () => sidebarBtn.style.color = "var(--holaf-accent-color, #ff8c00)";
        sidebarBtn.onmouseleave = () => sidebarBtn.style.color = "#888";
        sidebarBtn.onmousedown = (e) => e.stopPropagation();
        sidebarBtn.onclick = () => this.toggleSidebar();

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

        btnContainer.appendChild(sidebarBtn);
        btnContainer.appendChild(popoutBtn);
        btnContainer.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(btnContainer);

        header.addEventListener('dblclick', (e) => {
            if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
            this.toggleFullscreen();
        });

        // Main Container (holds Sidebar and Canvas)
        this.mainContainer = document.createElement("div");
        Object.assign(this.mainContainer.style, {
            flex: "1",
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
            width: "100%",
            height: "100%"
        });

        // Sidebar
        this.sidebarElement = document.createElement("div");
        Object.assign(this.sidebarElement.style, {
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#1a1a1a",
            overflowY: "auto",
            overflowX: "hidden",
            flexShrink: "0",
            transition: "width 0.2s ease",
            userSelect: "none"
        });

        // Content Area (Canvas)
        this.contentElement = document.createElement("div");
        Object.assign(this.contentElement.style, {
            flex: "1",
            position: "relative",
            backgroundColor: "#111",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden",
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
            height: "100%",
            transformOrigin: "0 0"
        });
        this.ctx = this.canvasEl.getContext("2d");

        this.contentElement.appendChild(this.statusTextEl);
        this.contentElement.appendChild(this.canvasEl);

        this.mainContainer.appendChild(this.sidebarElement);
        this.mainContainer.appendChild(this.contentElement);

        this.createResizeHandle();

        this.rootElement.appendChild(header);
        this.rootElement.appendChild(this.mainContainer);
        this.rootElement.appendChild(this.resizeHandle);

        document.body.appendChild(this.rootElement);

        this.enableWindowDragging(header);
        this.attachCanvasListeners();
        this.renderSidebar();
        this.updateVisualPosition();

        const resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        resizeObserver.observe(this.contentElement);
    },

    // --- SIDEBAR & HISTORY LOGIC ---

    toggleSidebar() {
        this.isSidebarOpen = !this.isSidebarOpen;
        this.renderSidebar();
        this.saveState();
    },

    renderSidebar() {
        if (!this.sidebarElement) return;
        this.sidebarElement.innerHTML = "";

        if (!this.isSidebarOpen) {
            this.sidebarElement.style.width = "0px";
            this.sidebarElement.style.borderRight = "none";
            return;
        }
        
        this.sidebarElement.style.width = "180px";
        this.sidebarElement.style.borderRight = "1px solid #444";

        const createItem = (label, nameId, isSpecial = false) => {
            const el = document.createElement("div");
            el.innerText = label;
            el.title = label;
            const isSelected = (this.currentViewName === nameId);
            Object.assign(el.style, {
                padding: "10px 12px",
                cursor: "pointer",
                fontSize: "12px",
                borderBottom: "1px solid #2a2a2a",
                backgroundColor: isSelected ? "#333" : "transparent",
                fontWeight: isSpecial ? "bold" : "normal",
                color: isSelected ? "var(--holaf-accent-color, #ff8c00)" : "#ccc",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                transition: "background-color 0.1s ease"
            });
            
            el.onmouseenter = () => { if (!isSelected) el.style.backgroundColor = "#222"; };
            el.onmouseleave = () => { if (!isSelected) el.style.backgroundColor = "transparent"; };
            el.onclick = () => this.selectView(nameId);
            return el;
        };

        // 1. Latest
        this.sidebarElement.appendChild(createItem("Latest", "latest", true));

        // Separator
        if (this.history.length > 0) {
            const sep1 = document.createElement("div");
            Object.assign(sep1.style, { height: "4px", backgroundColor: "#111", borderBottom: "1px solid #2a2a2a" });
            this.sidebarElement.appendChild(sep1);

            // 2. History List
            this.history.forEach(item => {
                this.sidebarElement.appendChild(createItem(item.name, item.name));
            });
        }

        // Spacer
        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        this.sidebarElement.appendChild(spacer);

        // 3. Clear Button
        if (this.history.length > 0 || this.latestImagesMeta.length > 0) {
            const sep2 = document.createElement("div");
            Object.assign(sep2.style, { height: "4px", backgroundColor: "#111" });
            this.sidebarElement.appendChild(sep2);

            const clearBtn = document.createElement("div");
            clearBtn.innerText = "Clear History";
            Object.assign(clearBtn.style, {
                padding: "10px", cursor: "pointer", textAlign: "center", color: "#ff5555",
                fontSize: "12px", fontWeight: "bold", backgroundColor: "#1a1a1a",
                transition: "background-color 0.1s ease"
            });
            clearBtn.onmouseenter = () => clearBtn.style.backgroundColor = "#2a2a2a";
            clearBtn.onmouseleave = () => clearBtn.style.backgroundColor = "#1a1a1a";
            clearBtn.onclick = () => this.clearHistory();
            this.sidebarElement.appendChild(clearBtn);
        }
    },

    async selectView(nameId) {
        this.currentViewName = nameId;
        this.renderSidebar(); // Update UI highlights

        let targetMeta =[];
        if (nameId === "latest") {
            targetMeta = this.latestImagesMeta;
        } else {
            const found = this.history.find(h => h.name === nameId);
            if (found) targetMeta = found.imagesMeta;
        }

        if (targetMeta && targetMeta.length > 0) {
            this.statusTextEl.style.display = "none";
            this.resetZoom();
            await this.loadImages(targetMeta);
            this.draw();
        } else {
            this.images =[];
            this.statusTextEl.style.display = "block";
            this.statusTextEl.innerText = "No images available.";
            this.resetZoom();
        }
    },

    clearHistory() {
        this.history =[];
        this.latestImagesMeta =[];
        this.currentViewName = "latest";
        this.images =[];
        this.statusTextEl.style.display = "block";
        this.statusTextEl.innerText = "Waiting for execution...";
        this.renderSidebar();
        this.resetZoom();
    },

    // --- FULLSCREEN & POPOUT LOGIC ---

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
    },

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

        // Move mainContainer (Sidebar + Canvas) to popup
        doc.body.appendChild(this.mainContainer);

        this.popupWindow.onbeforeunload = () => this.popIn();
    },

    popIn() {
        if (!this.isPoppedOut) return;
        this.isPoppedOut = false;

        // Return mainContainer to rootElement
        this.rootElement.insertBefore(this.mainContainer, this.resizeHandle);

        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.onbeforeunload = null;
            this.popupWindow.close();
        }
        this.popupWindow = null;

        if (this.isOpen) {
            this.rootElement.style.display = "flex";
            this.updateVisualPosition();
        }
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
            if (e.target.tagName === "BUTTON" || e.target.closest("button") || this.isFullscreen) return;

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
            isOpen: this.isOpen,
            isSidebarOpen: this.isSidebarOpen
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
                this.storedPos.width = state.width ?? 850;
                this.storedPos.height = state.height ?? 500;
                this.isOpen = !!state.isOpen;
                this.isSidebarOpen = state.isSidebarOpen ?? true;
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

            const targetDoc = this.contentElement.ownerDocument;

            const onMouseUp = () => {
                this.isPanning = false;
                this.canvasEl.style.cursor = 'crosshair';
                targetDoc.removeEventListener('mousemove', onMouseMove);
                targetDoc.removeEventListener('mouseup', onMouseUp);
            };

            targetDoc.addEventListener('mousemove', onMouseMove);
            targetDoc.addEventListener('mouseup', onMouseUp);
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

        const imagesMeta = detail.output.ui?.holaf_images || detail.output.holaf_images || detail.output.ui?.images || detail.output.images;
        
        // Extract comparison name
        let compName = "Unnamed Comparison";
        if (detail.output.ui?.comparison_name && detail.output.ui.comparison_name.length > 0) {
            compName = detail.output.ui.comparison_name[0];
        }

        if (!imagesMeta || imagesMeta.length === 0) return;

        // Update History State
        this.latestImagesMeta = imagesMeta;
        this.history = this.history.filter(h => h.name !== compName);
        this.history.unshift({ name: compName, imagesMeta: imagesMeta });

        // Determine if canvas should reload automatically
        const shouldReload = (this.currentViewName === "latest" || this.currentViewName === compName);

        this.renderSidebar();

        if (shouldReload) {
            this.statusTextEl.style.display = "none";
            if (!this.isOpen && !this.isPoppedOut) {
                this.show();
                this.saveState();
            }
            this.resetZoom();
            await this.loadImages(imagesMeta);
            this.draw();
        }
    },

    loadImages(imagesMeta) {
        return new Promise((resolve) => {
            this.images =[];
            let loadedCount = 0;
            const targetCount = Math.min(imagesMeta.length, 2);

            if (targetCount === 0) {
                resolve();
                return;
            }

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
