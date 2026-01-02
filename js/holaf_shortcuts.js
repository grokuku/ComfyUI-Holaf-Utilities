import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

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
            this.shortcuts = JSON.parse(JSON.stringify(app.graph.extra[this.GRAPH_EXTRA_KEY]));
        } else {
            this.shortcuts = [];
        }
        this.renderList();
    },

    syncToGraph() {
        if (!app.graph) return;
        if (!app.graph.extra) app.graph.extra = {};
        app.graph.extra[this.GRAPH_EXTRA_KEY] = JSON.parse(JSON.stringify(this.shortcuts));
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
            color: "#eee"
        });

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
        title.innerText = "Shortcuts";
        Object.assign(title.style, { flex: "1", fontWeight: "bold", fontSize: "12px", userSelect: "none" });
        
        const addBtn = document.createElement("button");
        addBtn.innerText = "+";
        Object.assign(addBtn.style, {
            background: "none", border: "1px solid #666", borderRadius: "4px",
            color: "#fff", cursor: "pointer", fontSize: "14px", padding: "0 6px"
        });
        addBtn.onmousedown = (e) => e.stopPropagation(); 
        addBtn.onclick = () => this.addShortcut();

        header.appendChild(title);
        header.appendChild(addBtn);

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
            this.listElement.innerHTML = `<div style="text-align:center; color:#777; font-size:11px; margin-top:10px;">No shortcuts</div>`;
            return;
        }

        this.shortcuts.forEach(s => {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "flex", alignItems: "center", marginBottom: "4px",
                backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "4px", padding: "4px"
            });
            row.setAttribute("data-id", s.id);

            const nameLabel = document.createElement("div");
            nameLabel.innerText = s.name;
            
            const isDeep = s.path && s.path.length > 0;
            if (isDeep) {
                nameLabel.title = `Subgraph View (${s.path.length} level(s))`;
                nameLabel.innerHTML = `<small style="color:var(--holaf-accent-color, #ff8c00); margin-right:4px;">📂</small>${s.name}`;
            }

            Object.assign(nameLabel.style, {
                flex: "1", fontSize: "12px", cursor: "pointer",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginRight: "5px"
            });
            
            nameLabel.onclick = () => this.applyShortcut(s.id);
            
            nameLabel.ondblclick = () => {
                nameLabel.contentEditable = true;
                nameLabel.focus();
                document.execCommand('selectAll', false, null);
                
                const finishEdit = () => {
                    nameLabel.contentEditable = false;
                    this.renameShortcut(s.id, nameLabel.innerText);
                };
                nameLabel.onblur = finishEdit;
                nameLabel.onkeydown = (e) => {
                    if (e.key === "Enter") { e.preventDefault(); nameLabel.blur(); }
                };
            };

            const btnStyle = {
                background: "none", border: "none", color: "#888", 
                cursor: "pointer", fontSize: "12px", padding: "0 2px", marginLeft: "2px"
            };

            const updateBtn = document.createElement("button");
            updateBtn.innerHTML = "💾"; 
            updateBtn.title = "Update with current view";
            updateBtn.className = "update-btn";
            Object.assign(updateBtn.style, btnStyle);
            updateBtn.onclick = (e) => { e.stopPropagation(); this.updateShortcut(s.id); };

            const delBtn = document.createElement("button");
            delBtn.innerHTML = "✕";
            delBtn.title = "Delete";
            Object.assign(delBtn.style, btnStyle);
            delBtn.onmouseenter = () => delBtn.style.color = "#ff5555";
            delBtn.onmouseleave = () => delBtn.style.color = "#888";
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
        if (this.rootElement) this.rootElement.style.display = "none";
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