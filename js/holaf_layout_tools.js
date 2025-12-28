import { app } from "../../scripts/app.js";

const HolafLayoutTools = {
    coordDisplay: null,
    container: null,
    isVisible: true, // Default state
    
    init() {
        // Expose instance for external toggling
        if (!window.holaf) window.holaf = {};
        window.holaf.layoutTools = this;

        setTimeout(() => {
            this.createFloatingToolbar();
            this.startCoordinatePoller();
        }, 500);
    },

    toggle() {
        this.isVisible = !this.isVisible;
        if (this.container) {
            this.container.style.display = this.isVisible ? "flex" : "none";
        }
        return this.isVisible;
    },

    createFloatingToolbar() {
        if (document.getElementById("holaf-layout-toolbar")) return;

        this.container = document.createElement("div");
        this.container.id = "holaf-layout-toolbar";
        
        // Initial Style
        Object.assign(this.container.style, {
            position: "fixed",
            bottom: "20px",
            right: "360px",
            zIndex: "10000",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "4px 8px",
            backgroundColor: "var(--comfy-menu-bg)",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
            boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
            fontFamily: "monospace",
            fontSize: "12px",
            color: "var(--fg-color, #ccc)",
            userSelect: "none"
        });

        document.body.appendChild(this.container);

        // 1. Drag Handle
        this.injectDragHandle(this.container);

        // 2. Coordinates Display
        this.coordDisplay = document.createElement("div");
        this.coordDisplay.innerText = "X: 0 | Y: 0";
        this.coordDisplay.style.marginRight = "8px";
        this.coordDisplay.style.minWidth = "120px";
        this.coordDisplay.style.textAlign = "right";
        this.coordDisplay.style.pointerEvents = "none";
        this.coordDisplay.title = "Current View Center Coordinates";
        this.container.appendChild(this.coordDisplay);

        // Separator
        const sep = document.createElement("div");
        Object.assign(sep.style, {
            width: "1px",
            height: "20px",
            backgroundColor: "var(--border-color)"
        });
        this.container.appendChild(sep);

        // 3. Action Buttons
        this.injectButtons(this.container);
        
        console.log("[Holaf Layout] Toolbar created.");
    },

    injectDragHandle(container) {
        const handle = document.createElement("div");
        Object.assign(handle.style, {
            width: "12px",
            height: "24px",
            cursor: "grab",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: "0.5",
            marginRight: "4px"
        });
        
        handle.innerHTML = `<svg viewBox="0 0 6 14" width="6" height="14" fill="currentColor"><circle cx="1" cy="1" r="1"/><circle cx="1" cy="7" r="1"/><circle cx="1" cy="13" r="1"/><circle cx="5" cy="1" r="1"/><circle cx="5" cy="7" r="1"/><circle cx="5" cy="13" r="1"/></svg>`;

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        const onMouseDown = (e) => {
            isDragging = true;
            handle.style.cursor = "grabbing";
            const rect = container.getBoundingClientRect();
            
            container.style.bottom = "auto";
            container.style.right = "auto";
            container.style.left = rect.left + "px";
            container.style.top = rect.top + "px";

            startX = e.clientX;
            startY = e.clientY;
            initialLeft = rect.left;
            initialTop = rect.top;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault(); 
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            container.style.left = `${initialLeft + dx}px`;
            container.style.top = `${initialTop + dy}px`;
        };

        const onMouseUp = () => {
            isDragging = false;
            handle.style.cursor = "grab";
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', onMouseDown);
        container.appendChild(handle);
    },

    injectButtons(container) {
        const button = document.createElement("button");
        button.className = "holaf-layout-btn";
        button.title = "Move Visible Workflow to Origin (0,0)";
        
        Object.assign(button.style, {
            width: "32px",
            height: "32px",
            cursor: "pointer",
            backgroundColor: "var(--comfy-input-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px"
        });

        button.onmouseenter = () => button.style.backgroundColor = "var(--comfy-input-bg-hover, #555)";
        button.onmouseleave = () => button.style.backgroundColor = "var(--comfy-input-bg)";

        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:100%; height:100%; color: var(--fg-color, white);"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;

        button.onclick = () => this.moveGraphToOrigin();

        container.appendChild(button);
    },

    startCoordinatePoller() {
        setInterval(() => {
            if (!this.coordDisplay || !this.isVisible || !app.canvas) return;
            
            const ds = app.canvas.ds;
            const cvsWidth = app.canvas.canvas.width; 
            const cvsHeight = app.canvas.canvas.height;

            const centerX = (cvsWidth / 2 - ds.offset[0]) / ds.scale;
            const centerY = (cvsHeight / 2 - ds.offset[1]) / ds.scale;

            this.coordDisplay.innerText = `X: ${Math.round(centerX)} | Y: ${Math.round(centerY)}`;
        }, 100);
    },

    moveGraphToOrigin() {
        const graph = app.canvas.graph;
        
        if (!graph) return;

        // --- FIX SUBGRAPH SUPPORT ---
        // Collect ALL nodes, including standard nodes and Subgraph specific Input/Output nodes
        // which are often stored separately in 'input_node'/'output_node' properties.
        const allNodes = [];
        
        if (graph._nodes) {
            allNodes.push(...graph._nodes);
        }

        // Subgraph boundary nodes (Inputs)
        if (graph.input_node) {
            allNodes.push(graph.input_node);
        }
        // Subgraph boundary nodes (Outputs)
        if (graph.output_node) {
            allNodes.push(graph.output_node);
        }

        const groups = graph._groups || [];

        if (allNodes.length === 0) {
            if (window.holaf && window.holaf.toastManager) {
                 window.holaf.toastManager.show("No nodes to move.", "warning");
            }
            return;
        }

        // 1. Calculate Bounding Box
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        const getVal = (v) => (typeof v === 'number' && !isNaN(v)) ? v : 0;

        for (const node of allNodes) {
            if (!node.pos) continue;
            const x = getVal(node.pos[0]);
            const y = getVal(node.pos[1]);
            const w = node.size ? getVal(node.size[0]) : 60; 
            const h = node.size ? getVal(node.size[1]) : 30;

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if ((x + w) > maxX) maxX = x + w;
            if ((y + h) > maxY) maxY = y + h;
        }

        for (const group of groups) {
             if (!group.pos) continue;
             const x = getVal(group.pos[0]);
             const y = getVal(group.pos[1]);
             const w = group.size ? getVal(group.size[0]) : 100;
             const h = group.size ? getVal(group.size[1]) : 100;

             if (x < minX) minX = x;
             if (y < minY) minY = y;
             if ((x + w) > maxX) maxX = x + w;
             if ((y + h) > maxY) maxY = y + h;
        }

        if (minX === Infinity) return;

        // 2. Calculate Center Delta
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const offsetX = 0 - centerX;
        const offsetY = 0 - centerY;

        // 3. Apply Offset to ALL nodes (including inputs/outputs)
        let count = 0;
        for (const node of allNodes) {
            if (node.pos) {
                node.pos[0] += offsetX;
                node.pos[1] += offsetY;
                count++;
            }
        }
        for (const group of groups) {
            group.pos[0] += offsetX;
            group.pos[1] += offsetY;
        }

        // 4. Update Canvas
        graph.setDirtyCanvas(true, true);
        
        // Recenter view to (0,0)
        if (app.canvas) {
            const cvsWidth = app.canvas.canvas.width;
            const cvsHeight = app.canvas.canvas.height;
            app.canvas.ds.offset = [cvsWidth / 2, cvsHeight / 2];
            app.canvas.setDirty(true, true);
        }
        
        if (window.holaf && window.holaf.toastManager) {
            const msg = `Recenter: ${count} elements moved`;
            window.holaf.toastManager.show(msg, "success");
        } else {
            console.log(`[Holaf Layout] ${count} elements moved to origin.`);
        }
    }
};

app.registerExtension({
    name: "Holaf.Layout.Tools",
    setup() {
        HolafLayoutTools.init();
    }
});