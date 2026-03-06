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
    floatingSidebarBtn: null,
    floatingPopoutBtn: null,
    floatingPopinBtn: null,

    // --- Comparison & History State ---
    history:[], // Array of { name, imagesMeta }
    latestImagesMeta:[],
    currentImagesMeta:[], // Currently displayed metadata (for saving)
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
        Object.assign(btnContainer.style, { display: "flex", gap: "12px" });

        // Close Button (Only button left in header)
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

        // Floating Overlay Buttons
        this.floatingSidebarBtn = document.createElement("button");
        this.floatingSidebarBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 3h18v18H3V3zm16 16V5H9v14h10z"/></svg>`;
        this.floatingSidebarBtn.title = "Toggle Sidebar";
        Object.assign(this.floatingSidebarBtn.style, {
            position: "absolute", top: "10px", left: "10px", zIndex: "100",
            background: "rgba(20,20,20,0.7)", border: "1px solid #444", color: "#ddd",
            cursor: "pointer", padding: "6px", display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "6px", backdropFilter: "blur(4px)", transition: "all 0.2s ease"
        });
        this.floatingSidebarBtn.onmouseenter = () => { this.floatingSidebarBtn.style.color = "var(--holaf-accent-color, #ff8c00)"; this.floatingSidebarBtn.style.background = "rgba(40,40,40,0.9)"; };
        this.floatingSidebarBtn.onmouseleave = () => { this.floatingSidebarBtn.style.color = "#ddd"; this.floatingSidebarBtn.style.background = "rgba(20,20,20,0.7)"; };
        this.floatingSidebarBtn.onclick = () => this.toggleSidebar();

        this.floatingPopoutBtn = document.createElement("button");
        this.floatingPopoutBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;
        this.floatingPopoutBtn.title = "Pop out to new window";
        Object.assign(this.floatingPopoutBtn.style, {
            position: "absolute", top: "10px", right: "10px", zIndex: "100",
            background: "rgba(20,20,20,0.7)", border: "1px solid #444", color: "#ddd",
            cursor: "pointer", padding: "6px", display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "6px", backdropFilter: "blur(4px)", transition: "all 0.2s ease"
        });
        this.floatingPopoutBtn.onmouseenter = () => { this.floatingPopoutBtn.style.color = "var(--holaf-accent-color, #ff8c00)"; this.floatingPopoutBtn.style.background = "rgba(40,40,40,0.9)"; };
        this.floatingPopoutBtn.onmouseleave = () => { this.floatingPopoutBtn.style.color = "#ddd"; this.floatingPopoutBtn.style.background = "rgba(20,20,20,0.7)"; };
        this.floatingPopoutBtn.onclick = () => this.popOut();

        this.floatingPopinBtn = document.createElement("button");
        this.floatingPopinBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`;
        this.floatingPopinBtn.title = "Return to main window";
        Object.assign(this.floatingPopinBtn.style, {
            position: "absolute", top: "10px", right: "10px", zIndex: "100",
            background: "rgba(20,20,20,0.7)", border: "1px solid #444", color: "#ddd",
            cursor: "pointer", padding: "6px", display: "none", alignItems: "center", justifyContent: "center",
            borderRadius: "6px", backdropFilter: "blur(4px)", transition: "all 0.2s ease"
        });
        this.floatingPopinBtn.onmouseenter = () => { this.floatingPopinBtn.style.color = "var(--holaf-accent-color, #ff8c00)"; this.floatingPopinBtn.style.background = "rgba(40,40,40,0.9)"; };
        this.floatingPopinBtn.onmouseleave = () => { this.floatingPopinBtn.style.color = "#ddd"; this.floatingPopinBtn.style.background = "rgba(20,20,20,0.7)"; };
        this.floatingPopinBtn.onclick = () => this.popIn();

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

        this.contentElement.appendChild(this.floatingSidebarBtn);
        this.contentElement.appendChild(this.floatingPopoutBtn);
        this.contentElement.appendChild(this.floatingPopinBtn);
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

        // 3. Actions Row (Clear / Save 2 / Save 1)
        if (this.history.length > 0 || this.latestImagesMeta.length > 0) {
            const sep2 = document.createElement("div");
            Object.assign(sep2.style, { height: "4px", backgroundColor: "#111" });
            this.sidebarElement.appendChild(sep2);

            const actionsContainer = document.createElement("div");
            Object.assign(actionsContainer.style, {
                display: "flex", gap: "2px", padding: "4px"
            });

            const baseBtnStyle = {
                padding: "8px", cursor: "pointer", textAlign: "center",
                fontSize: "12px", fontWeight: "bold", backgroundColor: "#1a1a1a",
                transition: "background-color 0.1s ease", display: "flex",
                alignItems: "center", justifyContent: "center", borderRadius: "2px"
            };

            const clearBtn = document.createElement("div");
            clearBtn.innerText = "Clear";
            Object.assign(clearBtn.style, { ...baseBtnStyle, flex: "1", color: "#ff5555" });
            clearBtn.onmouseenter = () => clearBtn.style.backgroundColor = "#2a2a2a";
            clearBtn.onmouseleave = () => clearBtn.style.backgroundColor = "#1a1a1a";
            clearBtn.onclick = () => this.clearHistory();

            const createSaveBtn = (label, index) => {
                const btn = document.createElement("div");
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right:4px"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>${label}`;
                btn.title = `Save Image ${label}`;
                Object.assign(btn.style, { ...baseBtnStyle, width: "35px", color: "#ccc" });
                btn.onmouseenter = () => btn.style.backgroundColor = "#2a2a2a";
                btn.onmouseleave = () => btn.style.backgroundColor = "#1a1a1a";
                btn.onclick = () => this.saveImage(index);
                return btn;
            };

            actionsContainer.appendChild(clearBtn);
            actionsContainer.appendChild(createSaveBtn("2", 1));
            actionsContainer.appendChild(createSaveBtn("1", 0));

            this.sidebarElement.appendChild(actionsContainer);
        }
    },

    async selectView(nameId) {
        this.currentViewName = nameId;
        this.renderSidebar();

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
            this.currentImagesMeta =[];
            this.statusTextEl.style.display = "block";
            this.statusTextEl.innerText = "No images available.";
            this.resetZoom();
        }
    },

    clearHistory() {
        this.history = [];
        this.latestImagesMeta =[];
        this.currentImagesMeta = [];
        this.currentViewName = "latest";
        this.images =[];
        this.statusTextEl.style.display = "block";
        this.statusTextEl.innerText = "Waiting for execution...";
        this.renderSidebar();
        this.resetZoom();
    },

    saveImage(index) {
        if (!this.images || this.images.length <= index) return;
        const img = this.images[index];
        const meta = this.currentImagesMeta[index];
        
        // Clean up filename for saving
        let filename = `comparer_image_${index + 1}.png`;
        if (meta && meta.filename) {
            filename = meta.filename.replace('holaf_remote_cmp_', 'saved_cmp_');
        }

        // Fetch as blob to force download instead of opening in a new tab
        fetch(img.src)
            .then(res => res.blob())
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            })
            .catch(err => console.error("[Holaf Remote Comparer] Save failed:", err));
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
        
        // Toggle floating buttons
        this.floatingPopoutBtn.style.display = "none";
        this.floatingPopinBtn.style.display = "flex";

        this.popupWindow.onbeforeunload = () => this.popIn();
    },

    popIn() {
        if (!this.isPoppedOut) return;
        this.isPoppedOut = false;

        // Return mainContainer to rootElement
        this.rootElement.insertBefore(this.mainContainer, this.resizeHandle);
        
        // Toggle floating buttons
        this.floatingPopoutBtn.style.display = "flex";
        this.floatingPopinBtn.style.display = "none";

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
        // Smart Zoom on Double Click
        this.contentElement.addEventListener("dblclick", (e) => {
            if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
            
            if (this.zoomState.scale > 1) {
                // Already zoomed -> Reset
                this.resetZoom();
            } else {
                // Zoomed out (scale == 1) -> Zoom 100% on cursor
                if (this.images.length === 0) return;
                const imgA = this.images[0];
                if (!imgA || !imgA.complete || imgA.naturalWidth === 0) return;

                const rect = this.contentElement.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const width = this.canvasEl.width;
                const height = this.canvasEl.height;
                const imgAspect = imgA.naturalWidth / imgA.naturalHeight;
                const canvasAspect = width / height;
                let drawWidth;
                
                if (imgAspect > canvasAspect) {
                    drawWidth = width;
                } else {
                    drawWidth = height * imgAspect;
                }

                // Target scale for 1:1 pixel mapping. Fallback to 2x if image is already small.
                const targetScale = Math.min(Math.max(imgA.naturalWidth / drawWidth, 2), 30);

                this.zoomState.scale = targetScale;
                this.zoomState.tx = mouseX - mouseX * targetScale;
                this.zoomState.ty = mouseY - mouseY * targetScale;
                
                // Update slider position so it doesn't jump
                this.mouseX = (mouseX - this.zoomState.tx) / this.zoomState.scale;
                
                this.draw();
            }
        });

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
            if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
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
        if (!imagesMeta || imagesMeta.length === 0) return;

        // LECTURE DIRECTE DU WIDGET
        let compName = "Unnamed Comparison";
        const nameWidget = node.widgets?.find(w => w.name === "comparison_name");
        if (nameWidget && nameWidget.value) {
            compName = nameWidget.value;
        } else if (detail.output.ui?.comparison_name && detail.output.ui.comparison_name.length > 0) {
            compName = detail.output.ui.comparison_name[0];
        }

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
            this.currentImagesMeta = imagesMeta; // Keep track for saving
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