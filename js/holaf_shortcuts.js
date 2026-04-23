import { app, api } from "./holaf_api_compat.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";

const HolafShortcuts = {
    name: "Holaf.Shortcuts",
    isVisible: false,
    rootElement: null,
    listElement: null,
    resizeHandle: null,
    
    // --- Data State ---
    shortcuts: [], // Array of { id, name, x, y, zoom, path }

    // --- Window State ---
    storedPos: {
        right: 20,
        bottom: 300, 
        width: 200,
        height: 250
    },
    STORAGE_KEY: "holaf_shortcuts_state_v1",
    GRAPH_EXTRA_KEY: "holaf_shortcuts",

    init() {
        this.restoreState();
        this.createHostElement();
        
        window.addEventListener("resize", () => this.updateVisualPosition());

        if (this.isVisible) {
            setTimeout(() => this.show(), 300);
        }
    },

    // --- SUBGRAPH NAVIGATION LOGIC ---

    /**
     * Recherche récursive pour trouver le chemin d'un graphe.
     */
    findPathToGraph(targetGraph, currentGraph, currentPath = []) {
        if (targetGraph === currentGraph) return currentPath;
        if (!currentGraph || !currentGraph._nodes) return null;

        for (const node of currentGraph._nodes) {
            if (node.subgraph) {
                const foundPath = this.findPathToGraph(targetGraph, node.subgraph, [...currentPath, node.id]);
                if (foundPath) return foundPath;
            }
        }
        return null;
    },

    getCurrentGraphPath() {
        const currentGraph = app.canvas.graph;
        if (!currentGraph || currentGraph === app.graph) {
            return [];
        }
        // On cherche récursivement le chemin depuis la racine
        return this.findPathToGraph(currentGraph, app.graph) || [];
    },

    /**
     * Navigue vers le chemin cible (supporte n niveaux).
     */
    navigateToPath(targetPath) {
        const isTargetRoot = !targetPath || targetPath.length === 0;
        const currentGraph = app.canvas.graph;

        if (isTargetRoot) {
            if (currentGraph !== app.graph) {
                app.canvas.setGraph(app.graph);
                return true;
            }
            return false;
        }

        // On descend dans la hiérarchie pour trouver le graphe final
        let targetLevelGraph = app.graph;
        for (const nodeId of targetPath) {
            const node = targetLevelGraph.getNodeById(nodeId);
            if (node && node.subgraph) {
                targetLevelGraph = node.subgraph;
            } else {
                // Chemin cassé
                return false;
            }
        }

        if (currentGraph !== targetLevelGraph) {
            app.canvas.setGraph(targetLevelGraph);
            return true;
        }
        
        return false;
    },

    applyShortcut(id) {
        const item = this.shortcuts.find(s => s.id === id);
        if (!item || !app.canvas || !app.canvas.ds) return;

        // Délai pour éviter les conflits d'événements souris
        setTimeout(() => {
            const switched = this.navigateToPath(item.path);

            // Positionnement
            setTimeout(() => {
                app.canvas.ds.offset[0] = item.x;
                app.canvas.ds.offset[1] = item.y;
                app.canvas.ds.scale = item.zoom;
                app.canvas.setDirty(true, true);
            }, switched ? 100 : 0);
        }, 0);
    },

    // --- DATA LOGIC ---

    loadFromGraph() {
        if (app.graph && app.graph.extra && app.graph.extra[this.GRAPH_EXTRA_KEY]) {
            this.shortcuts = structuredClone(app.graph.extra[this.GRAPH_EXTRA_KEY]);
        } else {
            this.shortcuts = [];
        }
        this.renderList();
    },

    syncToGraph() {
        if (!app.graph) return;
        if (!app.graph.extra) app.graph.extra = {};
        app.graph.extra[this.GRAPH_EXTRA_KEY] = structuredClone(this.shortcuts);
    },

    addShortcut() {
        if (!app.canvas || !app.canvas.ds) return;
        
        const newId = Date.now().toString(36);
        const name = `View ${this.shortcuts.length + 1}`;
        const path = this.getCurrentGraphPath();

        this.shortcuts.push({
            id: newId,
            name,
            x: app.canvas.ds.offset[0],
            y: app.canvas.ds.offset[1],
            zoom: app.canvas.ds.scale,
            path: path
        });
        
        this.syncToGraph();
        this.renderList();
    },

    updateShortcut(id) {
        const index = this.shortcuts.findIndex(s => s.id === id);
        if (index === -1) return;

        this.shortcuts[index].path = this.getCurrentGraphPath();
        this.shortcuts[index].x = app.canvas.ds.offset[0];
        this.shortcuts[index].y = app.canvas.ds.offset[1];
        this.shortcuts[index].zoom = app.canvas.ds.scale;
        
        this.syncToGraph();
        
        const btn = this.listElement.querySelector(`[data-id="${id}"] .update-btn`);
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = "✓";
            setTimeout(() => btn.innerHTML = originalText, 1000);
        }
    },

    deleteShortcut(id) {
        this.shortcuts = this.shortcuts.filter(s => s.id !== id);
        this.syncToGraph();
        this.renderList();
    },

    renameShortcut(id, newName) {
        const item = this.shortcuts.find(s => s.id === id);
        if (item) {
            item.name = newName;
            this.syncToGraph();
        }
    },

    // --- UI CONSTRUCTION ---

    createHostElement() {
        if (this.rootElement) return;

        this.rootElement = document.createElement("div");
        this.rootElement.id = "holaf-shortcuts-root";
        this.rootElement.classList.add("holaf-floating-window");
        Object.assign(this.rootElement.style, {
            display: "none",
            position: "fixed",
            zIndex: "1000",
            fontFamily: "sans-serif",
            boxSizing: "border-box",
            overflow: "hidden",
            flexDirection: "column"
        });

        const header = document.createElement("div");
        header.className = "holaf-utility-header";
        header.style.cursor = "move";
        
        const title = document.createElement("span");
        title.innerText = "Shortcuts";
        // Title style handled by .holaf-utility-header CSS
        
        const addBtn = document.createElement("button");
        addBtn.innerText = "+";
        addBtn.className = "holaf-header-button";
        addBtn.style.fontSize = "14px";
        addBtn.style.padding = "0 6px";
        addBtn.onmousedown = (e) => e.stopPropagation(); 
        addBtn.onclick = () => this.addShortcut();

        const closeBtn = document.createElement("button");
        closeBtn.className = "holaf-utility-close-button";
        closeBtn.textContent = "✕";
        closeBtn.title = "Close";
        closeBtn.onmousedown = (e) => e.stopPropagation();
        closeBtn.onclick = () => this.hide();

        header.appendChild(title);
        header.appendChild(addBtn);
        header.appendChild(closeBtn);

        this.listElement = document.createElement("div");
        Object.assign(this.listElement.style, {
            flex: "1",
            overflowY: "auto",
            padding: "5px"
        });

        this.createResizeHandle();

        this.rootElement.appendChild(header);
        this.rootElement.appendChild(this.listElement);
        this.rootElement.appendChild(this.resizeHandle); 
        
        document.body.appendChild(this.rootElement);

        this.enableWindowDragging(header);
        this.updateVisualPosition();
    },

    renderList() {
        if (!this.listElement) return;
        this.listElement.innerHTML = "";

        if (this.shortcuts.length === 0) {
            this.listElement.innerHTML = `<div style="text-align:center; font-size:11px; margin-top:10px; color:var(--holaf-text-secondary);">No shortcuts</div>`;
            return;
        }

        this.shortcuts.forEach(s => {
            const row = document.createElement("div");
            row.className = "holaf-shortcut-row";
            row.setAttribute("data-id", s.id);

            const nameLabel = document.createElement("div");
            nameLabel.className = "holaf-shortcut-name";
            nameLabel.innerText = s.name;
            
            const isDeep = s.path && s.path.length > 0;
            if (isDeep) {
                nameLabel.title = `Subgraph View (${s.path.length} level(s))`;
                nameLabel.innerText = ""; // Clear before appending DOM nodes
                const small = document.createElement("small");
                small.style.color = "var(--holaf-accent-color)";
                small.style.marginRight = "4px";
                small.textContent = "\uD83D\uDCC2"; // folder icon
                nameLabel.appendChild(small);
                nameLabel.appendChild(document.createTextNode(s.name));
            }

            nameLabel.onclick = () => this.applyShortcut(s.id);
            
            nameLabel.ondblclick = () => {
                nameLabel.contentEditable = true;
                nameLabel.focus();
                const range = document.createRange();
                    range.selectNodeContents(nameLabel);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                
                const finishEdit = () => {
                    nameLabel.contentEditable = false;
                    this.renameShortcut(s.id, nameLabel.innerText);
                };
                nameLabel.onblur = finishEdit;
                nameLabel.onkeydown = (e) => {
                    if (e.key === "Enter") { e.preventDefault(); nameLabel.blur(); }
                };
            };

            const updateBtn = document.createElement("button");
            updateBtn.innerHTML = "\U0001f4be"; 
            updateBtn.title = "Update with current view";
            updateBtn.className = "holaf-shortcut-btn update-btn";
            updateBtn.onclick = (e) => { e.stopPropagation(); this.updateShortcut(s.id); };

            const delBtn = document.createElement("button");
            delBtn.innerHTML = "✕";
            delBtn.title = "Delete";
            delBtn.className = "holaf-shortcut-btn";
            delBtn.onmouseenter = () => delBtn.style.color = "#ff5555";
            delBtn.onmouseleave = () => delBtn.style.color = "var(--holaf-text-secondary)";
            delBtn.onclick = (e) => { e.stopPropagation(); this.deleteShortcut(s.id); };

            row.appendChild(nameLabel);
            row.appendChild(updateBtn);
            row.appendChild(delBtn);
            this.listElement.appendChild(row);
        });
    },

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
        this.resizeHandle.className = "holaf-utility-resize-handle";

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
                
                const newW = Math.max(150, startW + dx);
                const newH = Math.max(100, startH + dy);

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

    saveState() {
        if (!this.rootElement) return;
        const state = { 
            ...this.storedPos,
            isVisible: this.isVisible
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    },

    restoreState() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const state = JSON.parse(saved);
                this.storedPos.right = state.right ?? 20;
                this.storedPos.bottom = state.bottom ?? 300;
                this.storedPos.width = state.width ?? 200;
                this.storedPos.height = state.height ?? 250;
                this.isVisible = !!state.isVisible;
            }
        } catch (e) {}
    },

    toggle() {
        this.isVisible = !this.isVisible;
        this.isVisible ? this.show() : this.hide();
        this.saveState();
        return this.isVisible;
    },

    show() {
        if (!this.rootElement) this.createHostElement();
        this.rootElement.style.display = "flex";
        this.isVisible = true;
        this.updateVisualPosition();
        this.renderList();
    },

    hide() {
        if (this.rootElement) {
            HolafPanelManager.unregister(this.rootElement);
            this.rootElement.style.display = "none";
        }
        this.isVisible = false;
    }
};

app.registerExtension({
    name: HolafShortcuts.name,
    async setup() {
        HolafShortcuts.init();
        app.holafShortcuts = HolafShortcuts;
        
        api.addEventListener("graph-cleared", () => {
            HolafShortcuts.shortcuts = [];
            HolafShortcuts.renderList();
        });
    },
    async afterConfigureGraph() {
        HolafShortcuts.loadFromGraph();
    }
});