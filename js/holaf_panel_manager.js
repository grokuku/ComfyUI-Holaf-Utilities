/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Panel Manager
 *
 * This script provides a generic manager for creating, dragging,
 * and resizing floating panels within the ComfyUI interface.
 */

export const HolafPanelManager = {
    /**
     * Creates a new, fully functional floating panel.
     * @param {object} options - Configuration for the panel.
     * @param {string} options.id - The unique ID for the panel element.
     * @param {string} options.title - The title displayed in the header.
     * @param {HTMLElement} [options.headerContent] - Optional extra elements to add to the header.
     * @param {object} [options.defaultSize] - Default {width, height}.
     * @param {object} [options.defaultPosition] - Default {x, y}.
     * @param {function} [options.onClose] - Callback function when the close button is clicked.
     * @param {function} [options.onStateChange] - Callback function when position or size changes.
     * @param {function} [options.onResize] - Callback function during resize.
     * @returns {{panelEl: HTMLElement, contentEl: HTMLElement}} - The main panel element and its content container.
     */
    createPanel(options) {
        const panel = document.createElement("div");
        panel.id = options.id;
        panel.className = "holaf-utility-panel"; // Use shared class

        if (options.defaultSize) {
            panel.style.width = `${options.defaultSize.width}px`;
            panel.style.height = `${options.defaultSize.height}px`;
        }

        if (options.defaultPosition && options.defaultPosition.x !== null && options.defaultPosition.y !== null) {
            panel.style.left = `${options.defaultPosition.x}px`;
            panel.style.top = `${options.defaultPosition.y}px`;
            panel.style.transform = 'none';
        } else { // Ensure transform is set if no explicit position, for _bakePosition to work
            panel.style.left = '50%';
            panel.style.top = '50%';
            panel.style.transform = 'translate(-50%, -50%)';
        }


        // --- Header ---
        const header = document.createElement("div");
        header.className = "holaf-utility-header";

        const title = document.createElement("span");
        title.innerHTML = options.title;

        // Prepend title first, then add other controls.
        // This makes the title span more likely to be the e.target for drag.
        header.appendChild(title);

        if (options.headerContent) {
            header.appendChild(options.headerContent);
        }

        const closeButton = document.createElement("button");
        closeButton.className = "holaf-utility-close-button";
        closeButton.textContent = "✖";
        closeButton.onclick = () => {
            panel.style.display = "none";
            if (options.onClose) {
                options.onClose();
            }
        };

        // Append close button last to keep it on the right
        header.appendChild(closeButton);


        // --- Content ---
        const content = document.createElement("div");
        // The content area will grow to fill the available space.
        // We let the tool-specific JS/CSS handle the content's internal layout.
        content.style.flexGrow = "1";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.overflow = "hidden";
        content.style.position = "relative"; // For children positioning

        // --- Resize Handle ---
        const resizeHandle = document.createElement("div");
        resizeHandle.className = "holaf-utility-resize-handle";

        panel.append(header, content, resizeHandle);
        document.body.appendChild(panel);

        // --- Add Behaviors ---
        this.makeDraggable(panel, header, options.onStateChange);
        this.makeResizable(panel, resizeHandle, options.onStateChange, options.onResize);

        // Return the panel and its content area for the caller to populate
        return { panelEl: panel, contentEl: content };
    },

    _bakePosition(panel) {
        if (panel.style.transform && panel.style.transform !== 'none') {
            const rect = panel.getBoundingClientRect();
            panel.style.top = `${rect.top}px`;
            panel.style.left = `${rect.left}px`;
            panel.style.transform = 'none';
            console.log("[HolafPanelManager] Baked position. New L/T:", panel.style.left, panel.style.top);
        }
    },

    makeDraggable(panel, handle, onStateChange) {
        let isDragging = false, offsetX, offsetY;
        handle.addEventListener("mousedown", (e) => {
            if (e.target.closest("button, input, select, textarea, a")) { // Added textarea
                console.log("[HolafPanelManager] Drag mousedown ignored on interactive element:", e.target);
                return;
            }
            console.log("[HolafPanelManager] Drag mousedown target:", e.target);
            e.preventDefault();
            this._bakePosition(panel); // Ensure this is called
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
            console.log("[HolafPanelManager] Drag start. OffsetX:", offsetX, "OffsetY:", offsetY, "Panel L/T:", panel.offsetLeft, panel.offsetTop);

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });

        const onMouseMove = (e) => {
            if (isDragging) {
                const newLeft = e.clientX - offsetX;
                const newTop = e.clientY - offsetY;
                // console.log("[HolafPanelManager] Dragging. New L/T:", newLeft, newTop); // Can be very verbose
                panel.style.left = `${newLeft}px`;
                panel.style.top = `${newTop}px`;
            }
        };

        const onMouseUp = (e) => {
            if (!isDragging) return;
            console.log("[HolafPanelManager] Drag mouseup. Final L/T:", panel.style.left, panel.style.top);
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
            console.log("[HolafPanelManager] Resize mousedown target:", e.target);
            e.preventDefault();
            this._bakePosition(panel); // Ensure this is called
            isResizing = true;
            initialX = e.clientX;
            initialY = e.clientY;
            initialWidth = panel.offsetWidth;
            initialHeight = panel.offsetHeight;
            console.log("[HolafPanelManager] Resize start. Panel W/H:", panel.offsetWidth, panel.offsetHeight, "Panel L/T:", panel.offsetLeft, panel.offsetTop);

            document.addEventListener("mousemove", onResizeMove);
            document.addEventListener("mouseup", onResizeUp);
        });

        const onResizeMove = (e) => {
            if (isResizing) {
                const deltaX = e.clientX - initialX;
                const deltaY = e.clientY - initialY;
                const newWidth = initialWidth + deltaX;
                const newHeight = initialHeight + deltaY;
                // console.log("[HolafPanelManager] Resizing. New W/H:", newWidth, newHeight); // Can be very verbose
                panel.style.width = `${newWidth}px`;
                panel.style.height = `${newHeight}px`;
                if (onResize) {
                    onResize();
                }
            }
        };

        const onResizeUp = (e) => {
            if (!isResizing) return;
            console.log("[HolafPanelManager] Resize mouseup. Final W/H:", panel.style.width, panel.style.height);
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