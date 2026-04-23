/*
    * Copyright (C) 2026 Holaf
    * Holaf Utilities - Remote Comparer
    *
    * Provides a floating UI overlay to compare two images, videos, or audio tracks.
    * Features: Drag, Resize, Fullscreen, Pop-out, Pan & Zoom, Audio Crossfader.
    * Node Preview: Hidden in graph, visible only in Remote Comparer.
    * Universal Media: Handles AnyType (*) input with isolated Holaf Payload.
    */

import { app, api } from "./holaf_api_compat.js";

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
    sidebarHistoryContainer: null,
    sidebarBottomContainer: null,
    contentElement: null,
    canvasEl: null,
    ctx: null,
    statusTextEl: null,
    resizeHandle: null,
    popupWindow: null,
    floatingSidebarBtn: null,
    floatingPopoutBtn: null,
    floatingPopinBtn: null,

    // UI Control Elements
    uiControls: {
        container: null,
        playBtn: null,
        timeline: null,
        frameCount: null,
        fpsSlider: null,
        fpsInput: null,
        settingsForm: {}
    },

    // --- Comparison & History State ---
    history: [], 
    latestImagesMeta: [],
    currentImagesMeta: [], 
    currentViewName: "latest",
    images: [], // Holds HTMLImageElement, HTMLVideoElement, or HTMLAudioElement
    mouseX: null,      // Scaled mouse X (for image pan/zoom clipping)
    rawMouseX: null,   // Raw canvas mouse X (for audio volume crossfading)
    isMouseOver: false,
    rafId: null,

    // --- Player State ---
    playbackState: {
        isPlaying: true,
        fps: 24,
        maxDuration: 0
    },
    isDraggingTimeline: false,

    // --- Global Settings Bridge ---
    globalSettings: {
        video_res: "0",
        video_speed: "ultrafast",
        image_format: "WEBP"
    },

    // --- Pan & Zoom State ---
    zoomState: { scale: 1, tx: 0, ty: 0 },
    isPanning: false,

    // --- Window State ---
    storedPos: {
        right: 50, bottom: 50, width: 850, height: 500
    },
    STORAGE_KEY: "holaf_remote_comparer_state_v2",

    init() {
        this.restoreState();
        this.buildUI();

        window.addEventListener("resize", () => {
            if (!this.isFullscreen && !this.isPoppedOut) {
                this.updateVisualPosition();
            }
        });
        api.addEventListener("executed", (e) => this.handleNodeExecution(e));

        // Sync initial settings to backend
        this.syncSettingsToBackend();

        if (this.isOpen) {
            setTimeout(() => this.show(), 300);
        }
        console.log("[Holaf Remote Comparer] Initialized Universal Mode.");
    },

    // --- SETTINGS BRIDGE LOGIC ---

    syncSettingsToBackend() {
        api.fetchApi("/holaf/comparer/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(this.globalSettings)
        }).catch(e => console.error("[Holaf Remote Comparer] Settings sync failed:", e));
    },

    updateSetting(key, value) {
        this.globalSettings[key] = value;
        this.saveState();
        this.syncSettingsToBackend();
    },

    // --- UI CONSTRUCTION ---

    buildUI() {
        if (this.rootElement) return;

        this.rootElement = document.createElement("div");
        this.rootElement.id = "holaf-remote-comparer-root";
        this.rootElement.classList.add("holaf-floating-window");
        Object.assign(this.rootElement.style, {
            display: "none", position: "fixed", zIndex: "1000",
            fontFamily: "sans-serif", boxSizing: "border-box", overflow: "hidden",
            flexDirection: "column",
            transition: "border-radius 0.2s ease"
        });

        // Header
        const header = document.createElement("div");
        header.className = "holaf-utility-header";
        header.style.cursor = "move";
        header.style.boxSizing = "border-box";

        const title = document.createElement("span");
        title.innerText = "Remote Media Comparer";
        Object.assign(title.style, { flex: "1", fontWeight: "bold", fontSize: "12px", userSelect: "none", pointerEvents: "none" });

        const btnContainer = document.createElement("div");
        Object.assign(btnContainer.style, { display: "flex", gap: "12px" });

        const closeBtn = document.createElement("button");
        closeBtn.innerText = "✕";
        closeBtn.title = "Close";
        closeBtn.className = "holaf-utility-close-button";
        // Hover handled by CSS
        closeBtn.onmousedown = (e) => e.stopPropagation();
        closeBtn.onclick = () => this.hide();

        btnContainer.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(btnContainer);

        header.addEventListener('dblclick', (e) => {
            if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
            this.toggleFullscreen();
        });

        // Main Container
        this.mainContainer = document.createElement("div");
        Object.assign(this.mainContainer.style, {
            flex: "1", display: "flex", flexDirection: "row", overflow: "hidden", width: "100%", height: "100%"
        });

        // Sidebar
        this.sidebarElement = document.createElement("div");
        this.sidebarElement.className = "holaf-rc-sidebar";
        Object.assign(this.sidebarElement.style, {
            display: "flex", flexDirection: "column",
            overflow: "hidden", flexShrink: "0", transition: "width 0.2s ease", userSelect: "none"
        });

        this.sidebarHistoryContainer = document.createElement("div");
        this.sidebarHistoryContainer.className = "holaf-rc-sidebar-history";
        Object.assign(this.sidebarHistoryContainer.style, { flex: "1", overflowY: "auto", overflowX: "hidden" });

        this.sidebarBottomContainer = document.createElement("div");
        this.sidebarBottomContainer.className = "holaf-rc-sidebar-bottom";
        Object.assign(this.sidebarBottomContainer.style, {
            flexShrink: "0", display: "flex", flexDirection: "column", boxSizing: "border-box"
        });

        this.sidebarElement.appendChild(this.sidebarHistoryContainer);
        this.sidebarElement.appendChild(this.sidebarBottomContainer);

        // Content Area
        this.contentElement = document.createElement("div");
        this.contentElement.className = "holaf-rc-content";
        Object.assign(this.contentElement.style, {
            flex: "1", position: "relative", display: "flex",
            justifyContent: "center", alignItems: "center", overflow: "hidden", height: "100%"
        });

        // Floating Buttons
        this.floatingSidebarBtn = document.createElement("button");
        this.floatingSidebarBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 3h18v18H3V3zm16 16V5H9v14h10z"/></svg>`;
        this.floatingSidebarBtn.className = "holaf-rc-float-btn";
        Object.assign(this.floatingSidebarBtn.style, {
            position: "absolute", top: "10px", left: "10px", zIndex: "100",
            display: "flex", alignItems: "center", justifyContent: "center"
        });
        this.floatingSidebarBtn.onclick = () => this.toggleSidebar();

        this.floatingPopoutBtn = document.createElement("button");
        this.floatingPopoutBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;
        this.floatingPopoutBtn.className = "holaf-rc-float-btn";
        Object.assign(this.floatingPopoutBtn.style, {
            position: "absolute", top: "10px", right: "10px", zIndex: "100",
            display: "flex", alignItems: "center", justifyContent: "center"
        });
        this.floatingPopoutBtn.onclick = () => this.popOut();

        this.floatingPopinBtn = document.createElement("button");
        this.floatingPopinBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`;
        this.floatingPopinBtn.className = "holaf-rc-float-btn";
        Object.assign(this.floatingPopinBtn.style, {
            position: "absolute", top: "10px", right: "10px", zIndex: "100",
            display: "none", alignItems: "center", justifyContent: "center"
        });
        this.floatingPopinBtn.onclick = () => this.popIn();

        this.statusTextEl = document.createElement("div");
        this.statusTextEl.className = "holaf-rc-status-text";
        Object.assign(this.statusTextEl.style, {
            position: "absolute", pointerEvents: "none", userSelect: "none", zIndex: "10"
        });
        this.statusTextEl.innerText = "Waiting for execution...";

        this.canvasEl = document.createElement("canvas");
        Object.assign(this.canvasEl.style, {
            display: "block", cursor: "crosshair", width: "100%", height: "100%", transformOrigin: "0 0"
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
        this.buildBottomSidebar();

        this.rootElement.appendChild(header);
        this.rootElement.appendChild(this.mainContainer);
        this.rootElement.appendChild(this.resizeHandle);

        document.body.appendChild(this.rootElement);

        this.enableWindowDragging(header);
        this.attachCanvasListeners();
        this.renderSidebarHistory();
        this.updateVisualPosition();

        const resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        resizeObserver.observe(this.contentElement);
    },

    buildBottomSidebar() {
        // 0. Settings Bridge Encart
        const settingsContainer = document.createElement("div");
        settingsContainer.className = "holaf-rc-settings-container";
        Object.assign(settingsContainer.style, {
            display: "flex", flexDirection: "column", gap: "6px", padding: "8px 10px",
            fontSize: "10px"
        });

        const createSelect = (label, key, options) => {
            const row = document.createElement("div");
            Object.assign(row.style, { display: "flex", justifyContent: "space-between", alignItems: "center" });
            
            const lbl = document.createElement("span");
            lbl.innerText = label;
            
            const sel = document.createElement("select");
            sel.className = "holaf-rc-settings-select";
            Object.assign(sel.style, { 
                fontSize: "10px", padding: "2px", width: "70px"
            });
            
            options.forEach(opt => {
                const o = document.createElement("option");
                o.value = opt.value; o.innerText = opt.text;
                if (this.globalSettings[key] === opt.value) o.selected = true;
                sel.appendChild(o);
            });

            sel.onchange = (e) => this.updateSetting(key, e.target.value);
            
            row.appendChild(lbl);
            row.appendChild(sel);
            return row;
        };

        settingsContainer.appendChild(createSelect("Image Format", "image_format", [
            {value: "WEBP", text: "WEBP"}, {value: "PNG", text: "PNG"}, {value: "JPEG", text: "JPEG"}
        ]));
        settingsContainer.appendChild(createSelect("Video Res", "video_res", [
            {value: "0", text: "Original"}, {value: "1024", text: "1024px"}, {value: "720", text: "720px"}, {value: "512", text: "512px"}
        ]));
        settingsContainer.appendChild(createSelect("Video Speed", "video_speed", [
            {value: "ultrafast", text: "Ultrafast"}, {value: "fast", text: "Fast"}, {value: "medium", text: "Medium"}
        ]));

        this.sidebarBottomContainer.appendChild(settingsContainer);

        // 1. Playback Controls Container
        const controls = document.createElement("div");
        controls.className = "holaf-rc-controls";
        Object.assign(controls.style, {
            display: "none", boxSizing: "border-box"
        });
        this.uiControls.container = controls;

        const row1 = document.createElement("div");
        Object.assign(row1.style, { display: "flex", alignItems: "center", gap: "6px", width: "100%" });

        const playBtn = document.createElement("button");
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        playBtn.className = "holaf-rc-play-btn";
        playBtn.onclick = () => {
            const mediaEls = this.images.filter(m => m instanceof HTMLMediaElement);
            const isPlaying = mediaEls.some(m => !m.paused);
            mediaEls.forEach(m => isPlaying ? m.pause() : m.play());
        };
        this.uiControls.playBtn = playBtn;

        const timeline = document.createElement("input");
        timeline.type = "range"; timeline.min = 0; timeline.max = 1000; timeline.value = 0;
        Object.assign(timeline.style, { flex: "1", cursor: "pointer", minWidth: "0", width: "100%" });
        
        timeline.oninput = (e) => {
            this.isDraggingTimeline = true;
            const percent = parseInt(e.target.value, 10) / 1000;
            this.images.forEach(m => {
                if (m instanceof HTMLMediaElement && m.duration) {
                    m.currentTime = percent * this.playbackState.maxDuration;
                }
            });
            this.draw();
        };
        timeline.onchange = () => this.isDraggingTimeline = false;
        this.uiControls.timeline = timeline;

        const frameCount = document.createElement("span");
        frameCount.className = "holaf-rc-frame-count";
        Object.assign(frameCount.style, { width: "35px", textAlign: "right", flexShrink: "0" });
        frameCount.innerText = "0:00";
        this.uiControls.frameCount = frameCount;

        row1.appendChild(playBtn);
        row1.appendChild(timeline);
        row1.appendChild(frameCount);
        controls.appendChild(row1);
        this.sidebarBottomContainer.appendChild(controls);

        // 2. Actions Container
        const actionsContainer = document.createElement("div");
        actionsContainer.className = "holaf-rc-actions";

        const baseBtnStyle = {
            padding: "8px", cursor: "pointer", textAlign: "center", fontSize: "12px", fontWeight: "bold", 
            backgroundColor: "color-mix(in srgb, var(--holaf-background-secondary) 50%, transparent)", transition: "background-color 0.1s ease", display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: "2px"
        };

        const clearBtn = document.createElement("div");
        clearBtn.innerText = "Clear";
        clearBtn.className = "holaf-rc-action-btn holaf-rc-clear-btn";
        Object.assign(clearBtn.style, { flex: "1" });
        clearBtn.onclick = () => this.clearHistory();

        const createSaveBtn = (label, index) => {
            const btn = document.createElement("div");
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right:4px"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>${label}`;
            btn.className = "holaf-rc-action-btn holaf-rc-save-btn";
            Object.assign(btn.style, { width: "35px" });
            btn.onclick = () => this.saveImage(index);
            return btn;
        };

        actionsContainer.appendChild(clearBtn);
        actionsContainer.appendChild(createSaveBtn("2", 1));
        actionsContainer.appendChild(createSaveBtn("1", 0));
        this.sidebarBottomContainer.appendChild(actionsContainer);
    },

    // --- STATE & DATA LOGIC ---

    saveState() {
        if (!this.rootElement) return;
        const state = {
            ...this.storedPos,
            isOpen: this.isOpen,
            isSidebarOpen: this.isSidebarOpen,
            settings: this.globalSettings
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
                if (state.settings) {
                    this.globalSettings = { ...this.globalSettings, ...state.settings };
                }
            }
        } catch (e) { }
    },

    // --- CROSSFADER & INTERACTION ---

    updateVolumes() {
        if (this.images.length === 0) return;
        const width = this.canvasEl ? this.canvasEl.width : 1;
        
        // Default to 0.0 when mouse leaves (Show/Hear ONLY Track A)
        let ratio = 0.0; 
        if (this.rawMouseX !== null && this.isMouseOver) {
            ratio = this.rawMouseX / width;
        }

        // Crossfader Math: Center (0.5) is 1.0 for both. Sides fade opposite track.
        const volA = Math.max(0, Math.min(1, (1 - ratio) * 2));
        const volB = Math.max(0, Math.min(1, ratio * 2));

        if (this.images[0] instanceof HTMLMediaElement) {
            this.images[0].volume = this.images.length > 1 ? volA : 1.0;
        }
        if (this.images.length > 1 && this.images[1] instanceof HTMLMediaElement) {
            this.images[1].volume = volB;
        }
    },

    attachCanvasListeners() {
        this.contentElement.addEventListener("dblclick", (e) => {
            if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
            
            if (this.zoomState.scale > 1) {
                this.resetZoom();
            } else {
                if (this.images.length === 0) return;
                const imgA = this.images[0];
                if (!this.isMediaReady(imgA)) return;

                const sizeA = this.getMediaSize(imgA);
                if (sizeA.width === 0) return;

                const rect = this.contentElement.getBoundingClientRect();
                const screenX = e.clientX - rect.left;
                const screenY = e.clientY - rect.top;

                const width = this.canvasEl.width;
                const height = this.canvasEl.height;
                const imgAspect = sizeA.width / sizeA.height;
                const canvasAspect = width / height;
                let drawWidth = imgAspect > canvasAspect ? width : height * imgAspect;

                const targetScale = Math.min(Math.max(sizeA.width / drawWidth, 2), 30);
                this.zoomState.scale = targetScale;
                this.zoomState.tx = screenX - screenX * targetScale;
                this.zoomState.ty = screenY - screenY * targetScale;
                
                this.mouseX = (screenX - this.zoomState.tx) / this.zoomState.scale;
                this.rawMouseX = screenX;
                this.updateVolumes();
                this.draw();
            }
        });

        this.contentElement.addEventListener("mousemove", (e) => {
            const rect = this.contentElement.getBoundingClientRect();
            this.rawMouseX = e.clientX - rect.left;
            this.mouseX = (this.rawMouseX - this.zoomState.tx) / this.zoomState.scale;
            
            this.updateVolumes();
            if (this.isOpen || this.isPoppedOut) this.draw();
        });

        this.contentElement.addEventListener("mouseenter", () => {
            this.isMouseOver = true;
        });

        this.contentElement.addEventListener("mouseleave", () => {
            this.isMouseOver = false;
            this.mouseX = null;
            this.rawMouseX = null;
            this.updateVolumes();
            if (this.isOpen || this.isPoppedOut) this.draw();
        });

        this.contentElement.addEventListener("wheel", (e) => {
            if (this.images.length === 0) return;
            e.preventDefault();

            const state = this.zoomState;
            const oldScale = state.scale;
            const newScale = e.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
            state.scale = Math.max(1, Math.min(newScale, 30));

            if (state.scale === oldScale) return;

            const rect = this.contentElement.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            state.tx = screenX - (screenX - state.tx) * (state.scale / oldScale);
            state.ty = screenY - (screenY - state.ty) * (state.scale / oldScale);

            if (state.scale <= 1) this.resetZoom();
            else this.draw();
        });

        this.contentElement.addEventListener("mousedown", (e) => {
            if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
            if (e.button !== 0 || this.zoomState.scale <= 1) return;
            e.preventDefault();

            this.isPanning = true;
            const state = this.zoomState;
            let startX = e.clientX - state.tx;
            let startY = e.clientY - state.ty;
            this.canvasEl.style.cursor = 'grabbing';

            const onMouseMove = (moveEvent) => {
                state.tx = moveEvent.clientX - startX;
                state.ty = moveEvent.clientY - startY;

                const rect = this.contentElement.getBoundingClientRect();
                this.rawMouseX = moveEvent.clientX - rect.left;
                this.mouseX = (this.rawMouseX - state.tx) / state.scale;
                this.updateVolumes();
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
    },

    // --- ISOLATED EXECUTION HANDLING ---

    async handleNodeExecution(event) {
        const detail = event.detail;
        if (!detail || !detail.node || !detail.output) return;

        // STRICT ISOLATION: We ONLY process "holaf_payload"
        const payloads = detail.output.ui?.holaf_payload || detail.output.holaf_payload;
        if (!payloads || payloads.length === 0) return;

        const payload = payloads[0];
        const compName = payload.comparison_name || "Unnamed Comparison";
        const mediaMeta = payload.media || [];

        if (mediaMeta.length === 0) return;

        this.latestImagesMeta = mediaMeta;
        this.history = this.history.filter(h => h.name !== compName);
        this.history.unshift({ name: compName, imagesMeta: mediaMeta });

        const shouldReload = (this.currentViewName === "latest" || this.currentViewName === compName);
        this.renderSidebarHistory();

        if (shouldReload) {
            this.statusTextEl.style.display = "none";
            if (!this.isOpen && !this.isPoppedOut) {
                this.show();
                this.saveState();
            }
            this.resetZoom();
            await this.loadMedia(mediaMeta);
            this.draw();
        }
    },

    // --- UNIVERSAL MEDIA LOADER ---

    loadMedia(imagesMeta) {
        return new Promise((resolve) => {
            this.currentImagesMeta = imagesMeta;
            this.stopAnimation();

            // Cleanup
            this.images.forEach(media => {
                if (media instanceof HTMLMediaElement) {
                    media.pause(); media.removeAttribute('src'); media.load();
                }
            });
            this.images = [];
            this.playbackState.maxDuration = 0;
            
            let loadedCount = 0;
            const targetCount = Math.min(imagesMeta.length, 2);

            if (targetCount === 0) {
                this.uiControls.container.style.display = "none";
                resolve();
                return;
            }

            let hasTimelineMedia = false;

            for (let i = 0; i < targetCount; i++) {
                const meta = imagesMeta[i];
                let mediaEl;

                const onMediaReady = () => {
                    loadedCount++;
                    if (mediaEl.duration && mediaEl.duration > this.playbackState.maxDuration) {
                        this.playbackState.maxDuration = mediaEl.duration;
                    }
                    
                    if (loadedCount === targetCount) {
                        if (hasTimelineMedia) {
                            this.uiControls.container.style.display = "flex";
                            this.syncVideos();
                        } else {
                            this.uiControls.container.style.display = "none";
                        }
                        this.checkAndStartAnimation();
                        this.updateVolumes();
                        resolve();
                    }
                };

                const onMediaError = () => {
                    console.error("[Holaf Remote Comparer] Failed to load media:", meta.filename);
                    loadedCount++;
                    if (loadedCount === targetCount) {
                        if (hasTimelineMedia) this.uiControls.container.style.display = "flex";
                        this.checkAndStartAnimation();
                        resolve();
                    }
                };

                if (meta.format === 'video' || meta.format === 'audio') {
                    hasTimelineMedia = true;
                    mediaEl = meta.format === 'video' ? document.createElement("video") : new Audio();
                    mediaEl.autoplay = true;
                    mediaEl.loop = true;
                    mediaEl.playsInline = true;
                    mediaEl.onloadeddata = onMediaReady;
                    mediaEl.onerror = onMediaError;

                    // Timeline Sync (Bind to the first timeline media)
                    if (!this.images.some(m => m instanceof HTMLMediaElement)) {
                        mediaEl.addEventListener('timeupdate', () => {
                            if (!this.isDraggingTimeline && this.playbackState.maxDuration > 0) {
                                this.uiControls.timeline.value = (mediaEl.currentTime / this.playbackState.maxDuration) * 1000;
                                const formatTime = (t) => {
                                    const m = Math.floor(t / 60);
                                    const s = Math.floor(t % 60).toString().padStart(2, '0');
                                    return `${m}:${s}`;
                                };
                                this.uiControls.frameCount.innerText = `${formatTime(mediaEl.currentTime)} / ${formatTime(this.playbackState.maxDuration)}`;
                            }
                        });
                        mediaEl.addEventListener('play', () => this.updatePlaybackUI(true));
                        mediaEl.addEventListener('pause', () => this.updatePlaybackUI(false));
                    }
                } else {
                    mediaEl = new Image();
                    mediaEl.onload = onMediaReady;
                    mediaEl.onerror = onMediaError;
                }

                const params = new URLSearchParams({ filename: meta.filename, type: meta.type, subfolder: meta.subfolder || "" });
                mediaEl.src = api.apiURL(`/view?${params.toString()}`);

                // Tag the element for rendering logic
                mediaEl._holafFormat = meta.format;
                mediaEl._holafName = meta.filename;
                
                this.images.push(mediaEl);
            }
        });
    },

    // --- RENDER ENGINE ---

    drawMediaItem(ctx, media, x, y, w, h, isA) {
        if (media instanceof HTMLImageElement || media instanceof HTMLVideoElement) {
            ctx.drawImage(media, x, y, w, h);
        } else if (media instanceof window.HTMLAudioElement) {
            // Simplified Audio Canvas Background
            ctx.fillStyle = isA ? "#1a1005" : "#05101a"; 
            ctx.fillRect(x, y, w, h);
            
            ctx.fillStyle = isA ? "rgba(255, 140, 0, 0.2)" : "rgba(0, 168, 255, 0.2)";
            ctx.font = "bold 40px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(`🎵 AUDIO ${isA ? 'A' : 'B'}`, x + w/2, y + h/2);
        }
    },

    drawAudioHUD(ctx, width, height) {
        if (this.images.length === 0) return;
        const imgA = this.images[0];
        const imgB = this.images.length > 1 ? this.images[1] : null;

        const isAudioA = imgA instanceof window.HTMLAudioElement;
        const isAudioB = imgB instanceof window.HTMLAudioElement;

        if (!isAudioA && !isAudioB) return;

        // Reset transform to draw HUD fixed on the screen (immune to zoom/pan/clip)
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const volA = isAudioA ? (imgA.volume || 0) : 0;
        const volB = isAudioB ? (imgB.volume || 0) : 0;

        const colorA = volA >= volB ? "#ff8c00" : "#888888";
        const colorB = volB >= volA ? "#00a8ff" : "#888888";

        ctx.textBaseline = "top";

        // Track A HUD (Top Left)
        if (isAudioA) {
            ctx.fillStyle = "rgba(15, 15, 15, 0.9)";
            ctx.fillRect(20, 20, 240, 60);
            
            ctx.fillStyle = colorA;
            ctx.textAlign = "left";
            ctx.font = "bold 13px sans-serif";
            const nameA = imgA._holafName ? imgA._holafName.replace(/^holaf_remote_cmp_[AB]_.*?_/, '') : "Unknown Track";
            ctx.fillText(`🎵 A: ${nameA}`, 35, 30);
            
            ctx.fillStyle = "#333";
            ctx.fillRect(35, 55, 180, 8);
            ctx.fillStyle = colorA;
            ctx.fillRect(35, 55, 180 * volA, 8);
            
            ctx.fillStyle = "#fff";
            ctx.font = "10px monospace";
            ctx.fillText(`${Math.round(volA * 100)}%`, 225, 53);
        }

        // Track B HUD (Top Right)
        if (isAudioB) {
            ctx.fillStyle = "rgba(15, 15, 15, 0.9)";
            ctx.fillRect(width - 260, 20, 240, 60);
            
            ctx.fillStyle = colorB;
            ctx.textAlign = "right";
            ctx.font = "bold 13px sans-serif";
            const nameB = imgB._holafName ? imgB._holafName.replace(/^holaf_remote_cmp_[AB]_.*?_/, '') : "Unknown Track";
            ctx.fillText(`🎵 B: ${nameB}`, width - 35, 30);
            
            ctx.fillStyle = "#333";
            ctx.fillRect(width - 215, 55, 180, 8);
            ctx.fillStyle = colorB;
            ctx.fillRect(width - 35 - (180 * volB), 55, 180 * volB, 8); // Draw right to left
            
            ctx.fillStyle = "#fff";
            ctx.font = "10px monospace";
            ctx.fillText(`${Math.round(volB * 100)}%`, width - 225, 53);
        }
    },

    draw() {
        if (!this.ctx || !this.canvasEl) return;
        const width = this.canvasEl.width;
        const height = this.canvasEl.height;

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, width, height);

        if (this.images.length === 0) return;

        const imgA = this.images[0];
        const imgB = this.images.length > 1 ? this.images[1] : null;

        if (!this.isMediaReady(imgA)) return;
        const sizeA = this.getMediaSize(imgA);
        
        // Audio has no intrinsic size, force a virtual 16:9 canvas
        const baseW = sizeA.width > 0 ? sizeA.width : 1280;
        const baseH = sizeA.height > 0 ? sizeA.height : 720;

        this.ctx.translate(this.zoomState.tx, this.zoomState.ty);
        this.ctx.scale(this.zoomState.scale, this.zoomState.scale);

        const imgAspect = baseW / baseH;
        const canvasAspect = width / height;
        let drawWidth, drawHeight, offsetX = 0, offsetY = 0;

        if (imgAspect > canvasAspect) {
            drawWidth = width; drawHeight = width / imgAspect;
            offsetY = (height - drawHeight) / 2;
        } else {
            drawHeight = height; drawWidth = height * imgAspect;
            offsetX = (width - drawWidth) / 2;
        }

        // Draw Background (A)
        this.drawMediaItem(this.ctx, imgA, offsetX, offsetY, drawWidth, drawHeight, true);

        if (!imgB || !this.isMediaReady(imgB)) {
            this.drawAudioHUD(this.ctx, width, height);
            return;
        }

        // Draw Foreground Split (B)
        if ((this.isMouseOver || this.isPanning) && this.mouseX !== null) {
            this.ctx.save();
            this.ctx.beginPath();

            const clipWidth = Math.max(0, this.mouseX - offsetX);
            this.ctx.rect(offsetX, offsetY, clipWidth, drawHeight);
            this.ctx.clip();

            this.drawMediaItem(this.ctx, imgB, offsetX, offsetY, drawWidth, drawHeight, false);
            this.ctx.restore();

            // Split Line
            if (this.mouseX >= offsetX && this.mouseX <= offsetX + drawWidth) {
                this.ctx.beginPath();
                this.ctx.moveTo(this.mouseX, offsetY);
                this.ctx.lineTo(this.mouseX, offsetY + drawHeight);
                this.ctx.lineWidth = 1 / (this.zoomState.scale || 1);
                this.ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
                this.ctx.globalCompositeOperation = "difference";
                this.ctx.stroke();
                this.ctx.globalCompositeOperation = "source-over";
            }
        }

        // Draw Unclipped Audio HUD on top of everything
        this.drawAudioHUD(this.ctx, width, height);
    },

    // --- UTILS & BOILERPLATE ---
    
    getMediaSize(media) {
        if (media instanceof HTMLVideoElement) return { width: media.videoWidth || 0, height: media.videoHeight || 0 };
        if (media instanceof HTMLImageElement) return { width: media.naturalWidth || 0, height: media.naturalHeight || 0 };
        return { width: 0, height: 0 }; // Audio
    },

    isMediaReady(media) {
        if (!media) return false;
        if (media instanceof HTMLMediaElement) return media.readyState >= 1; // Metadata loaded is enough
        return media.complete && media.naturalWidth > 0;
    },

    checkAndStartAnimation() {
        this.stopAnimation();
        const needsLoop = this.images.some(el => el instanceof HTMLMediaElement);
        if (needsLoop) {
            const loop = () => {
                if (this.isOpen || this.isPoppedOut) this.draw();
                this.rafId = requestAnimationFrame(loop);
            };
            this.rafId = requestAnimationFrame(loop);
        }
    },

    stopAnimation() {
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    },

    syncVideos() {
        const mediaEls = this.images.filter(el => el instanceof HTMLMediaElement);
        if (mediaEls.length > 1) mediaEls.forEach(v => v.currentTime = 0);
    },

    resetZoom() {
        this.zoomState = { scale: 1, tx: 0, ty: 0 };
        this.draw();
    },

    updatePlaybackUI(isPlaying) {
        const playIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        const pauseIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        this.uiControls.playBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
    },

    toggleSidebar() {
        this.isSidebarOpen = !this.isSidebarOpen;
        this.renderSidebarHistory();
        this.saveState();
    },

    renderSidebarHistory() {
        if (!this.sidebarHistoryContainer) return;
        this.sidebarHistoryContainer.innerHTML = "";

        if (!this.isSidebarOpen) {
            this.sidebarElement.style.width = "0px";
            this.sidebarElement.style.borderRight = "none";  // already handled
            return;
        }
        
        this.sidebarElement.style.width = "180px";
        this.sidebarElement.style.borderRight = "1px solid var(--holaf-border-color, #444)";

        const createItem = (label, nameId, isSpecial = false) => {
            const el = document.createElement("div");
            el.innerText = label; el.title = label;
            const isSelected = (this.currentViewName === nameId);
            el.className = isSelected ? "holaf-rc-history-item selected" : "holaf-rc-history-item";
            if (isSpecial) el.style.fontWeight = "bold";
            Object.assign(el.style, {
                overflow: "hidden", textOverflow: "ellipsis"
            });
            el.onclick = () => this.selectView(nameId);
            return el;
        };

        this.sidebarHistoryContainer.appendChild(createItem("Latest", "latest", true));
        if (this.history.length > 0) {
            const sep1 = document.createElement("div");
            sep1.className = "holaf-rc-history-separator";
            Object.assign(sep1.style, { height: "4px" });
            this.sidebarHistoryContainer.appendChild(sep1);
            this.history.forEach(item => this.sidebarHistoryContainer.appendChild(createItem(item.name, item.name)));
        }
    },

    async selectView(nameId) {
        this.currentViewName = nameId;
        this.renderSidebarHistory();
        let targetMeta = nameId === "latest" ? this.latestImagesMeta : (this.history.find(h => h.name === nameId)?.imagesMeta || []);

        if (targetMeta.length > 0) {
            this.statusTextEl.style.display = "none";
            this.resetZoom();
            await this.loadMedia(targetMeta);
            this.draw();
        } else {
            this.clearHistory();
        }
    },

    clearHistory() {
        this.stopAnimation();
        this.history = []; this.latestImagesMeta = []; this.currentImagesMeta = []; this.currentViewName = "latest";
        this.images.forEach(m => { if (m instanceof HTMLMediaElement) m.pause(); });
        this.images = [];
        this.uiControls.container.style.display = "none";
        this.statusTextEl.style.display = "block";
        this.statusTextEl.innerText = "Waiting for execution...";
        this.renderSidebarHistory();
        this.resetZoom();
    },

    saveImage(index) {
        if (!this.images || this.images.length <= index) return;
        const media = this.images[index];
        const meta = this.currentImagesMeta[index];
        
        const isVideo = media instanceof HTMLVideoElement;
        const isAudio = media instanceof window.HTMLAudioElement;
        const ext = isVideo ? "mp4" : isAudio ? "wav" : "png";
        
        let filename = `comparer_media_${index + 1}.${ext}`;
        if (meta && meta.filename) {
            filename = meta.filename.replace('holaf_remote_cmp_', 'saved_cmp_').replace(/\.[^/.]+$/, `.${ext}`);
        }

        fetch(media.src).then(res => res.blob()).then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none'; a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            window.URL.revokeObjectURL(url); document.body.removeChild(a);
        }).catch(err => console.error("[Holaf Remote Comparer] Save failed:", err));
    },

    // --- FULLSCREEN & POPOUT ---
    toggleFullscreen() {
        this.isFullscreen = !this.isFullscreen;
        if (this.isFullscreen) {
            Object.assign(this.rootElement.style, { width: "100vw", height: "100vh", right: "0px", bottom: "0px", borderRadius: "0px" });
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

        this.popupWindow = window.open("", "HolafRemoteComparerPopup", `width=${this.storedPos.width},height=${this.storedPos.height},menubar=no,toolbar=no,location=no,status=no`);
        if (!this.popupWindow) {
            alert("Popup blocked! Please allow popups for ComfyUI.");
            this.isPoppedOut = false; this.rootElement.style.display = "flex"; return;
        }

        const doc = this.popupWindow.document;
        doc.title = "Holaf Remote Comparer";
        Object.assign(doc.body.style, { margin: "0", backgroundColor: "color-mix(in srgb, var(--holaf-background-primary) 50%, black)", overflow: "hidden", display: "flex", flexDirection: "column", height: "100vh" });
        doc.body.appendChild(this.mainContainer);
        
        this.floatingPopoutBtn.style.display = "none"; this.floatingPopinBtn.style.display = "flex";
        this.popupWindow.onbeforeunload = () => this.popIn();
    },

    popIn() {
        if (!this.isPoppedOut) return;
        this.isPoppedOut = false;
        this.rootElement.insertBefore(this.mainContainer, this.resizeHandle);
        this.floatingPopoutBtn.style.display = "flex"; this.floatingPopinBtn.style.display = "none";

        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.onbeforeunload = null; this.popupWindow.close();
        }
        this.popupWindow = null;
        if (this.isOpen) { this.rootElement.style.display = "flex"; this.updateVisualPosition(); }
    },

    updateVisualPosition() {
        if (!this.rootElement || this.isFullscreen || this.isPoppedOut) return;
        this.rootElement.style.width = this.storedPos.width + "px";
        this.rootElement.style.height = this.storedPos.height + "px";
        const visualRight = Math.max(0, Math.min(this.storedPos.right, window.innerWidth - this.storedPos.width));
        const visualBottom = Math.max(0, Math.min(this.storedPos.bottom, window.innerHeight - this.storedPos.height));
        Object.assign(this.rootElement.style, { left: "auto", top: "auto", right: visualRight + "px", bottom: visualBottom + "px" });
    },

    enableWindowDragging(dragTarget) {
        let isDragging = false, startX, startY, dragStartRight, dragStartBottom;
        dragTarget.addEventListener('mousedown', (e) => {
            if (e.target.tagName === "BUTTON" || e.target.closest("button") || this.isFullscreen) return;
            isDragging = true; startX = e.clientX; startY = e.clientY;
            const rect = this.rootElement.getBoundingClientRect();
            dragStartRight = window.innerWidth - rect.right; dragStartBottom = window.innerHeight - rect.bottom;
            this.rootElement.style.cursor = "move"; e.preventDefault();

            const onMouseMove = (ev) => {
                if (!isDragging) return;
                this.storedPos.right = dragStartRight - (ev.clientX - startX);
                this.storedPos.bottom = dragStartBottom - (ev.clientY - startY);
                this.updateVisualPosition();
            };

            const onMouseUp = () => {
                if (isDragging) { isDragging = false; this.rootElement.style.cursor = "default"; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); this.saveState(); }
            };
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        });
    },

    createResizeHandle() {
        this.resizeHandle = document.createElement("div");
        this.resizeHandle.className = "holaf-rc-resize-handle";
        Object.assign(this.resizeHandle.style, { position: "absolute", bottom: "0", right: "0", width: "15px", height: "15px", cursor: "nwse-resize", zIndex: "20" });
        this.resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" style="width:100%; height:100%;"><path d="M22 22H12v-2h10v-10h2v12z"/></svg>`;
        let isResizing = false, startX, startY, startW, startH, startRight, startBottom;

        this.resizeHandle.addEventListener('mousedown', (e) => {
            if (this.isFullscreen) return;
            e.stopPropagation(); isResizing = true; startX = e.clientX; startY = e.clientY;
            const rect = this.rootElement.getBoundingClientRect();
            startW = rect.width; startH = rect.height; startRight = window.innerWidth - rect.right; startBottom = window.innerHeight - rect.bottom;
            e.preventDefault();

            const onMouseMove = (ev) => {
                if (!isResizing) return;
                const newW = Math.max(300, startW + (ev.clientX - startX));
                const newH = Math.max(200, startH + (ev.clientY - startY));
                this.storedPos.width = newW; this.storedPos.height = newH;
                this.storedPos.right = startRight - (newW - startW); this.storedPos.bottom = startBottom - (newH - startH);
                this.updateVisualPosition();
            };

            const onMouseUp = () => {
                if (isResizing) { isResizing = false; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); this.saveState(); }
            };
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        });
    },

    resizeCanvas() {
        if (!this.canvasEl || !this.contentElement) return;
        this.canvasEl.width = this.contentElement.clientWidth;
        this.canvasEl.height = this.contentElement.clientHeight;
        this.draw();
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
        this.images.forEach(m => { if (m instanceof HTMLMediaElement) m.play(); });
    },

    hide() {
        this.isOpen = false;
        if (this.isPoppedOut) this.popIn();
        if (this.rootElement) this.rootElement.style.display = "none";
        this.images.forEach(m => { if (m instanceof HTMLMediaElement) m.pause(); });
        this.saveState();
    }
};

app.registerExtension({
    name: HolafRemoteComparer.name,
    async setup() {
        HolafRemoteComparer.init();
        app.holafRemoteComparer = HolafRemoteComparer;
    }
});