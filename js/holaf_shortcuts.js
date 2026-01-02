import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const HolafShortcuts = {
    name: "Holaf.Shortcuts",
    isVisible: false,
    rootElement: null,
    listElement: null,
    resizeHandle: null,
    
    shortcuts: [], 
    STORAGE_KEY: "holaf_shortcuts_state_v1",
    GRAPH_EXTRA_KEY: "holaf_shortcuts",
    storedPos: { right: 20, bottom: 300, width: 200, height: 250 },

    init() {
        this.restoreState();
        this.createHostElement();
        window.addEventListener("resize", () => this.updateVisualPosition());
        if (this.isVisible) setTimeout(() => this.show(), 300);
    },

    // --- NOUVELLE LOGIQUE DE NAVIGATION ---

    /**
     * Identifie le nœud propriétaire du graphe actuel en le cherchant manuellement.
     */
    getCurrentGraphPath() {
        const path = [];
        let currentGraph = app.canvas.graph;

        if (!currentGraph || currentGraph === app.graph) return path;

        // On cherche quel nœud dans le graphe racine possède ce sous-graphe
        const owner = app.graph._nodes.find(n => n.subgraph === currentGraph);
        if (owner) {
            path.push(owner.id);
        }
        return path;
    },

    /**
     * Navigue vers le chemin cible en utilisant ta méthode 'setGraph' confirmée.
     */
    async navigateToPath(targetPath) {
        targetPath = targetPath || [];
        const currentPath = this.getCurrentGraphPath();

        // Déjà au bon endroit ?
        if (JSON.stringify(targetPath) === JSON.stringify(currentPath)) {
            return false;
        }

        // 1. Reset à la racine (Ta méthode Test 1 qui fonctionne)
        if (app.canvas.graph !== app.graph) {
            app.canvas.setGraph(app.graph);
            await new Promise(r => setTimeout(r, 50)); // Laisser souffler le moteur
        }

        // 2. Si on doit descendre dans un subgraph
        if (targetPath.length > 0) {
            for (const nodeId of targetPath) {
                const node = app.graph.getNodeById(nodeId);
                if (node && node.subgraph) {
                    // On utilise la méthode de ComfyUI pour ouvrir, 
                    // ou on simule le double-clic si elle manque.
                    if (app.canvas.openSubgraph) {
                        app.canvas.openSubgraph(node);
                    } else if (node.onDblClick) {
                        node.onDblClick();
                    } else {
                        // Ultime recours : switch manuel
                        app.canvas.setGraph(node.subgraph);
                    }
                    await new Promise(r => setTimeout(r, 100)); // Crucial pour la stabilité
                }
            }
        }
        return true;
    },

    async applyShortcut(id) {
        const item = this.shortcuts.find(s => s.id === id);
        if (!item || !app.canvas || !app.canvas.ds) return;

        // Navigation
        const switched = await this.navigateToPath(item.path);

        // On attend que le canvas soit prêt avant d'appliquer le zoom
        setTimeout(() => {
            app.canvas.ds.offset[0] = item.x;
            app.canvas.ds.offset[1] = item.y;
            app.canvas.ds.scale = item.zoom;
            app.canvas.setDirty(true, true);
        }, switched ? 150 : 0);
    },

    // --- LOGIQUE DATA ---

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
        const idx = this.shortcuts.findIndex(s => s.id === id);
        if (idx === -1) return;
        this.shortcuts[idx].path = this.getCurrentGraphPath();
        this.shortcuts[idx].x = app.canvas.ds.offset[0];
        this.shortcuts[idx].y = app.canvas.ds.offset[1];
        this.shortcuts[idx].zoom = app.canvas.ds.scale;
        this.syncToGraph();
        const btn = this.listElement.querySelector(`[data-id="${id}"] .update-btn`);
        if (btn) {
            btn.innerHTML = "✓";
            setTimeout(() => btn.innerHTML = "💾", 1000);
        }
    },

    deleteShortcut(id) {
        this.shortcuts = this.shortcuts.filter(s => s.id !== id);
        this.syncToGraph();
        this.renderList();
    },

    renameShortcut(id, newName) {
        const item = this.shortcuts.find(s => s.id === id);
        if (item) { item.name = newName; this.syncToGraph(); }
    },

    // --- UI (Inchangé mais pour complétude) ---

    createHostElement() {
        if (this.rootElement) return;
        this.rootElement = document.createElement("div");
        Object.assign(this.rootElement.style, {
            display: "none", position: "fixed", zIndex: "1000",
            backgroundColor: "rgba(20, 20, 20, 0.95)", borderRadius: "8px",
            border: "1px solid var(--border-color, #555)", backdropFilter: "blur(4px)",
            fontFamily: "sans-serif", boxSizing: "border-box", overflow: "hidden",
            flexDirection: "column", color: "#eee"
        });
        const header = document.createElement("div");
        Object.assign(header.style, {
            flex: "0 0 auto", display: "flex", alignItems: "center", padding: "8px",
            backgroundColor: "rgba(255,255,255,0.05)", borderBottom: "1px solid #444", cursor: "move" 
        });
        const title = document.createElement("span");
        title.innerText = "Shortcuts";
        Object.assign(title.style, { flex: "1", fontWeight: "bold", fontSize: "12px", userSelect: "none" });
        const addBtn = document.createElement("button");
        addBtn.innerText = "+";
        Object.assign(addBtn.style, { background: "none", border: "1px solid #666", borderRadius: "4px", color: "#fff", cursor: "pointer", fontSize: "14px", padding: "0 6px" });
        addBtn.onclick = () => this.addShortcut();
        header.appendChild(title); header.appendChild(addBtn);
        this.listElement = document.createElement("div");
        Object.assign(this.listElement.style, { flex: "1", overflowY: "auto", padding: "5px" });
        this.createResizeHandle();
        this.rootElement.appendChild(header); this.rootElement.appendChild(this.listElement); this.rootElement.appendChild(this.resizeHandle); 
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
            Object.assign(row.style, { display: "flex", alignItems: "center", marginBottom: "4px", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "4px", padding: "4px" });
            row.setAttribute("data-id", s.id);
            const nameLabel = document.createElement("div");
            const isDeep = s.path && s.path.length > 0;
            nameLabel.innerHTML = isDeep ? `<small style="color:#ff8c00;">📂</small> ${s.name}` : s.name;
            Object.assign(nameLabel.style, { flex: "1", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
            nameLabel.onclick = () => this.applyShortcut(s.id);
            const updateBtn = document.createElement("button");
            updateBtn.innerHTML = "💾"; updateBtn.className = "update-btn";
            Object.assign(updateBtn.style, { background: "none", border: "none", color: "#888", cursor: "pointer", padding: "0 4px" });
            updateBtn.onclick = (e) => { e.stopPropagation(); this.updateShortcut(s.id); };
            const delBtn = document.createElement("button");
            delBtn.innerHTML = "✕";
            Object.assign(delBtn.style, { background: "none", border: "none", color: "#888", cursor: "pointer", padding: "0 4px" });
            delBtn.onclick = (e) => { e.stopPropagation(); this.deleteShortcut(s.id); };
            row.appendChild(nameLabel); row.appendChild(updateBtn); row.appendChild(delBtn);
            this.listElement.appendChild(row);
        });
    },

    updateVisualPosition() {
        if (!this.rootElement) return;
        this.rootElement.style.width = this.storedPos.width + "px";
        this.rootElement.style.height = this.storedPos.height + "px";
        const maxRight = window.innerWidth - this.storedPos.width;
        const maxBottom = window.innerHeight - this.storedPos.height;
        Object.assign(this.rootElement.style, { right: Math.max(0, Math.min(this.storedPos.right, maxRight)) + "px", bottom: Math.max(0, Math.min(this.storedPos.bottom, maxBottom)) + "px", display: this.isVisible ? "flex" : "none" });
    },

    enableWindowDragging(dragTarget) {
        let isDragging = false, startX, startY, dragStartRight, dragStartBottom;
        dragTarget.addEventListener('mousedown', (e) => {
            if (e.target.tagName === "BUTTON") return;
            isDragging = true; startX = e.clientX; startY = e.clientY;
            const rect = this.rootElement.getBoundingClientRect();
            dragStartRight = window.innerWidth - rect.right; dragStartBottom = window.innerHeight - rect.bottom;
            e.preventDefault();
            const onMouseMove = (ev) => {
                if (!isDragging) return;
                this.storedPos.right = dragStartRight - (ev.clientX - startX);
                this.storedPos.bottom = dragStartBottom - (ev.clientY - startY);
                this.updateVisualPosition();
            };
            const onMouseUp = () => { isDragging = false; this.saveState(); document.removeEventListener('mousemove', onMouseMove); };
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        });
    },

    createResizeHandle() {
        this.resizeHandle = document.createElement("div");
        Object.assign(this.resizeHandle.style, { position: "absolute", bottom: "0", right: "0", width: "15px", height: "15px", cursor: "nwse-resize" });
        this.resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" style="fill:rgba(255,255,255,0.3);"><path d="M22 22H12v-2h10v-10h2v12z"/></svg>`;
        this.resizeHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation(); let startX = e.clientX, startY = e.clientY, startW = this.rootElement.offsetWidth, startH = this.rootElement.offsetHeight;
            e.preventDefault();
            const onMouseMove = (ev) => {
                this.storedPos.width = Math.max(150, startW + (ev.clientX - startX));
                this.storedPos.height = Math.max(100, startH + (ev.clientY - startY));
                this.updateVisualPosition();
            };
            const onMouseUp = () => { this.saveState(); document.removeEventListener('mousemove', onMouseMove); };
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        });
    },

    saveState() { localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ ...this.storedPos, isVisible: this.isVisible })); },
    restoreState() { try { const s = JSON.parse(localStorage.getItem(this.STORAGE_KEY)); if (s) { Object.assign(this.storedPos, s); this.isVisible = !!s.isVisible; } } catch(e){} },
    toggle() { this.isVisible = !this.isVisible; this.isVisible ? this.show() : this.hide(); this.saveState(); return this.isVisible; },
    show() { if (!this.rootElement) this.createHostElement(); this.rootElement.style.display = "flex"; this.isVisible = true; this.updateVisualPosition(); this.renderList(); },
    hide() { if (this.rootElement) this.rootElement.style.display = "none"; this.isVisible = false; }
};

app.registerExtension({
    name: HolafShortcuts.name,
    async setup() {
        HolafShortcuts.init();
        app.holafShortcuts = HolafShortcuts;
        api.addEventListener("graph-cleared", () => { HolafShortcuts.shortcuts = []; HolafShortcuts.renderList(); });
    },
    async afterConfigureGraph() { HolafShortcuts.loadFromGraph(); }
});