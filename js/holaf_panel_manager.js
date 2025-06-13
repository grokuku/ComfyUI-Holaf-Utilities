/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Panel Manager
 *
 * This script provides a generic manager for creating, dragging,
 * and resizing floating panels within the ComfyUI interface.
 */

const BASE_Z_INDEX = 1000;
let currentMaxZIndex = BASE_Z_INDEX;
const openPanels = new Set();

export const HolafPanelManager = {
    createPanel(options) {
        const panel = document.createElement("div");
        panel.id = options.id;
        panel.className = "holaf-utility-panel";

        if (options.defaultSize) {
            panel.style.width = `${options.defaultSize.width}px`;
            panel.style.height = `${options.defaultSize.height}px`;
        }

        if (options.defaultPosition && options.defaultPosition.x !== null && options.defaultPosition.y !== null) {
            panel.style.left = `${options.defaultPosition.x}px`;
            panel.style.top = `${options.defaultPosition.y}px`;
            panel.style.transform = 'none';
        } else {
            panel.style.left = '50%';
            panel.style.top = '50%';
            panel.style.transform = 'translate(-50%, -50%)';
        }

        // Initial z-index: set by bringToFront called from utility's show() or later interaction
        // panel.style.zIndex = BASE_Z_INDEX; // Start at base, bringToFront will elevate
        openPanels.add(panel);


        // --- Header ---
        const header = document.createElement("div");
        header.className = "holaf-utility-header";

        const title = document.createElement("span");
        title.innerHTML = options.title;
        header.appendChild(title);

        if (options.headerContent) {
            header.appendChild(options.headerContent);
        }

        const closeButton = document.createElement("button");
        closeButton.className = "holaf-utility-close-button";
        closeButton.textContent = "✖";
        closeButton.onclick = (e) => { // Added event 'e'
            e.stopPropagation(); // Prevent mousedown on panel from firing after close
            panel.style.display = "none";
            openPanels.delete(panel);
            // Optional: Recalculate currentMaxZIndex if needed, though less critical
            // if new panels always increment from a potentially gapped currentMaxZIndex.
            if (options.onClose) {
                options.onClose();
            }
        };
        header.appendChild(closeButton);

        // --- Content ---
        const content = document.createElement("div");
        content.style.flexGrow = "1";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.overflow = "hidden";
        content.style.position = "relative";

        // --- Resize Handle ---
        const resizeHandle = document.createElement("div");
        resizeHandle.className = "holaf-utility-resize-handle";

        panel.append(header, content, resizeHandle);
        document.body.appendChild(panel);

        // MODIFIED: Add mousedown listener to the panel itself in capture phase
        panel.addEventListener("mousedown", () => {
            this.bringToFront(panel);
        }, true); // true for capture phase

        this.makeDraggable(panel, header, options.onStateChange);
        this.makeResizable(panel, resizeHandle, options.onStateChange, options.onResize);

        // Set initial z-index after creation and event listeners are set up
        // This ensures it gets a z-index in the sequence.
        // It will be immediately brought to front if it's the only one or by the show() method.
        this.bringToFront(panel);


        return { panelEl: panel, contentEl: content };
    },

    bringToFront(panelEl) {
        if (!openPanels.has(panelEl)) {
            console.warn(`[HolafPanelManager] Panel ${panelEl.id} not managed. Cannot bring to front.`);
            return;
        }

        // Check if it's already the top-most visually active panel
        // (currentMaxZIndex should ideally always be the z-index of the current top panel)
        // If its zIndex is less than the current known max, it needs to come up.
        const panelZIndex = parseInt(panelEl.style.zIndex) || BASE_Z_INDEX;

        if (panelZIndex < currentMaxZIndex || openPanels.size === 1) {
            // If multiple panels share the same currentMaxZIndex (e.g. after one was closed),
            // or if this panel is simply behind the currentMaxZIndex.
            currentMaxZIndex++;
            panelEl.style.zIndex = currentMaxZIndex;
            console.log(`[HolafPanelManager] Brought panel ${panelEl.id} to front with z-index: ${currentMaxZIndex}`);
        } else if (panelZIndex === currentMaxZIndex && panelEl.style.zIndex !== String(currentMaxZIndex)) {
            // This case handles if currentMaxZIndex somehow got desynced or if zIndex was manually changed.
            // Force it to be the currentMaxZIndex, potentially incrementing if another panel also claims this.
            // This is more of a safeguard.
            currentMaxZIndex++;
            panelEl.style.zIndex = currentMaxZIndex;
            console.log(`[HolafPanelManager] Synced panel ${panelEl.id} to front with z-index: ${currentMaxZIndex}`);
        }
        // If panelZIndex is already currentMaxZIndex, it's considered on top.
    },

    _bakePosition(panel) {
        if (panel.style.transform && panel.style.transform !== 'none') {
            const rect = panel.getBoundingClientRect();
            panel.style.top = `${rect.top}px`;
            panel.style.left = `${rect.left}px`;
            panel.style.transform = 'none';
            // console.log("[HolafPanelManager] Baked position. New L/T:", panel.style.left, panel.style.top); // Less verbose
        }
    },

    makeDraggable(panel, handle, onStateChange) {
        let isDragging = false, offsetX, offsetY;
        handle.addEventListener("mousedown", (e) => {
            // bringToFront is handled by the panel's own mousedown listener
            if (e.target.closest("button, input, select, textarea, a")) {
                return; // Do not prevent default or start drag for these elements in header
            }
            e.preventDefault(); // Prevent text selection on header while dragging
            this._bakePosition(panel);
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });

        const onMouseMove = (e) => {
            if (isDragging) {
                const newLeft = e.clientX - offsetX;
                const newTop = e.clientY - offsetY;
                panel.style.left = `${newLeft}px`;
                panel.style.top = `${newTop}px`;
            }
        };

        const onMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            if (onStateChange) {
                onStateChange({
                    x: panel.offsetLeft,
                    y: panel.offsetTop,
                    width: panel.offsetWidth,
                    height: panel.offsetHeight,
                });
            }
        };
    },

    makeResizable(panel, handle, onStateChange, onResize) {
        let isResizing = false, initialX, initialY, initialWidth, initialHeight;

        handle.addEventListener("mousedown", (e) => {
            // bringToFront is handled by the panel's own mousedown listener
            e.preventDefault(); // Prevent default actions on resize handle
            this._bakePosition(panel);
            isResizing = true;
            initialX = e.clientX;
            initialY = e.clientY;
            initialWidth = panel.offsetWidth;
            initialHeight = panel.offsetHeight;

            document.addEventListener("mousemove", onResizeMove);
            document.addEventListener("mouseup", onResizeUp);
        });

        const onResizeMove = (e) => {
            if (isResizing) {
                const deltaX = e.clientX - initialX;
                const deltaY = e.clientY - initialY;
                const newWidth = initialWidth + deltaX;
                const newHeight = initialHeight + deltaY;
                panel.style.width = `${newWidth}px`;
                panel.style.height = `${newHeight}px`;
                if (onResize) {
                    onResize();
                }
            }
        };

        const onResizeUp = (e) => {
            if (!isResizing) return;
            isResizing = false;
            document.removeEventListener("mousemove", onResizeMove);
            document.removeEventListener("mouseup", onResizeUp);
            if (onStateChange) {
                onStateChange({
                    x: panel.offsetLeft,
                    y: panel.offsetTop,
                    width: panel.offsetWidth,
                    height: panel.offsetHeight,
                });
            }
        };
    }
};