/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Panel Manager
 *
 * This script provides a generic manager for creating, dragging,
 * and resizing floating panels within the ComfyUI interface.
 * MODIFIED: Added HOLAF_THEMES constant for shared theme definitions.
 */

export const HOLAF_THEMES = [
    {
        name: "Graphite Orange",
        className: "holaf-theme-graphite-orange",
        base: "dark",
        colors: {
            accent: "#D8700D",
            backgroundPrimary: "#1E1E1E",
            backgroundSecondary: "#2B2B2B",
            textPrimary: "#E0E0E0",
            textSecondary: "#A0A0A0",
            border: "#3F3F3F",
            selectionBackground: "#555555",
            cursor: "#D8700D",
            buttonBackground: "#D8700D",
            buttonText: "#FFFFFF",
            inputBackground: "#252525",
            tagBackground: "#4F4F4F",
            tagText: "#DADADA"
        }
    },
    {
        name: "Midnight Purple",
        className: "holaf-theme-midnight-purple",
        base: "dark",
        colors: {
            accent: "#8A2BE2",
            backgroundPrimary: "#1C1C2E",
            backgroundSecondary: "#2A2A40",
            textPrimary: "#E0D8F0",
            textSecondary: "#9890B0",
            border: "#383850",
            selectionBackground: "#4A3A5E",
            cursor: "#8A2BE2",
            buttonBackground: "#8A2BE2",
            buttonText: "#FFFFFF",
            inputBackground: "#242438",
            tagBackground: "#4A3A5E",
            tagText: "#E0D8F0"
        }
    },
    {
        name: "Forest Green",
        className: "holaf-theme-forest-green",
        base: "dark",
        colors: {
            accent: "#228B22",
            backgroundPrimary: "#1A241A",
            backgroundSecondary: "#283A28",
            textPrimary: "#D0E0D0",
            textSecondary: "#809080",
            border: "#304830",
            selectionBackground: "#3A5E3A",
            cursor: "#228B22",
            buttonBackground: "#228B22",
            buttonText: "#FFFFFF",
            inputBackground: "#223022",
            tagBackground: "#3A5E3A",
            tagText: "#D0E0D0"
        }
    },
    {
        name: "Steel Blue",
        className: "holaf-theme-steel-blue",
        base: "dark",
        colors: {
            accent: "#4682B4",
            backgroundPrimary: "#1C2024",
            backgroundSecondary: "#2A3038",
            textPrimary: "#D0D8E0",
            textSecondary: "#808890",
            border: "#36404A",
            selectionBackground: "#3A4E5E",
            cursor: "#4682B4",
            buttonBackground: "#4682B4",
            buttonText: "#FFFFFF",
            inputBackground: "#24282D",
            tagBackground: "#3A4E5E",
            tagText: "#D0D8E0"
        }
    },
    {
        name: "Ashy Light",
        className: "holaf-theme-ashy-light",
        base: "light",
        colors: {
            accent: "#607D8B",
            backgroundPrimary: "#FAFAFA",
            backgroundSecondary: "#F0F0F0",
            textPrimary: "#263238",
            textSecondary: "#546E7A",
            border: "#D0D0D0",
            selectionBackground: "#CFD8DC",
            cursor: "#455A64",
            buttonBackground: "#607D8B",
            buttonText: "#FFFFFF",
            inputBackground: "#FFFFFF",
            tagBackground: "#E0E0E0",
            tagText: "#37474F"
        }
    }
];

const BASE_Z_INDEX = 1000; // Base for panels
let currentMaxZIndex = BASE_Z_INDEX; // Tracks the highest z-index currently assigned to a panel
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

        openPanels.add(panel);

        // --- Header ---
        const header = document.createElement("div");
        header.className = "holaf-utility-header";

        const title = document.createElement("span");
        title.innerHTML = options.title; // title can now contain HTML
        title.style.flexGrow = "1"; // Allow title to take space
        title.style.overflow = "hidden";
        title.style.textOverflow = "ellipsis";
        title.style.whiteSpace = "nowrap";

        header.appendChild(title);


        if (options.headerContent) {
            // Header content (like buttons) should be wrapped to control its flex behavior
            const headerControlsWrapper = document.createElement("div");
            headerControlsWrapper.style.display = "flex";
            headerControlsWrapper.style.alignItems = "center";
            // The order of elements in header (title, headerContent, closeButton) is now more explicit
            // headerContent itself can define its order via `order` CSS property if needed by the specific utility
            headerControlsWrapper.appendChild(options.headerContent);
            header.appendChild(headerControlsWrapper);
        }

        const closeButton = document.createElement("button");
        closeButton.className = "holaf-utility-close-button";
        closeButton.textContent = "✖";
        closeButton.style.marginLeft = "auto"; // Push close button to the far right if no other controls
        if (options.headerContent) {
             closeButton.style.marginLeft = "10px"; // Add some space if there are other header controls
        }

        closeButton.onclick = (e) => {
            e.stopPropagation();
            panel.style.display = "none";
            openPanels.delete(panel);
            // Recalculate currentMaxZIndex if the closed panel was the top one
            if (parseInt(panel.style.zIndex) === currentMaxZIndex && openPanels.size > 0) {
                currentMaxZIndex = BASE_Z_INDEX; // Reset
                openPanels.forEach(p => {
                    const pZIndex = parseInt(p.style.zIndex);
                    if (pZIndex > currentMaxZIndex) {
                        currentMaxZIndex = pZIndex;
                    }
                });
            } else if (openPanels.size === 0) {
                currentMaxZIndex = BASE_Z_INDEX; // Reset if no panels are open
            }

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
        content.style.position = "relative"; // Needed for some internal absolute positioning like resize handle

        // --- Resize Handle ---
        const resizeHandle = document.createElement("div");
        resizeHandle.className = "holaf-utility-resize-handle";

        panel.append(header, content, resizeHandle);
        document.body.appendChild(panel);

        panel.addEventListener("mousedown", (e) => { // Capture phase not strictly necessary but fine
            // Only bring to front if the mousedown is on the panel itself or its header, not interactive elements inside content
            if (e.target === panel || header.contains(e.target)) {
                 this.bringToFront(panel);
            }
        }, true);


        this.makeDraggable(panel, header, options.onStateChange);
        this.makeResizable(panel, resizeHandle, options.onStateChange, options.onResize);
        
        this.bringToFront(panel); // Bring to front on creation

        return { panelEl: panel, contentEl: content, headerEl: header }; // Return headerEl for direct manipulation
    },

    bringToFront(panelEl) {
        if (!openPanels.has(panelEl)) {
            // console.warn(`[HolafPanelManager] Panel ${panelEl.id} not managed. Cannot bring to front.`);
            openPanels.add(panelEl);
        }

        // Find the current highest z-index among ALL open panels
        let maxZ = BASE_Z_INDEX;
        openPanels.forEach(p => {
            const pZIndex = parseInt(p.style.zIndex);
            if (!isNaN(pZIndex) && pZIndex > maxZ) {
                maxZ = pZIndex;
            }
        });
        currentMaxZIndex = maxZ; // Update global tracker

        const panelZIndex = parseInt(panelEl.style.zIndex);

        // If the panel is not already the one with the highest z-index, bring it up
        if (isNaN(panelZIndex) || panelZIndex < currentMaxZIndex || openPanels.size === 1) {
            currentMaxZIndex++;
            panelEl.style.zIndex = currentMaxZIndex;
            // console.log(`[HolafPanelManager] Brought panel ${panelEl.id} to front with z-index: ${currentMaxZIndex}`);
        } else if (panelEl.style.zIndex !== String(currentMaxZIndex) && panelZIndex === currentMaxZIndex) {
            // This can happen if multiple panels were at maxZ, and one was clicked.
            // The one clicked should get a new higher z-index.
            currentMaxZIndex++;
            panelEl.style.zIndex = currentMaxZIndex;
        }
        // If panelZIndex is already currentMaxZIndex, it's considered on top (or was just set).
    },

    _bakePosition(panel) {
        if (panel.style.transform && panel.style.transform !== 'none') {
            const rect = panel.getBoundingClientRect();
            panel.style.top = `${rect.top}px`;
            panel.style.left = `${rect.left}px`;
            panel.style.transform = 'none';
        }
    },

    makeDraggable(panel, handle, onStateChange) {
        handle.addEventListener("mousedown", (e) => {
            // Prevent drag if mousedown is on an interactive element within the handle (e.g. buttons in header)
            if (e.target.closest("button, input, select, textarea, a")) {
                openPanels.add(panelEl);
            }
            e.preventDefault(); // Prevent text selection during drag

            this.bringToFront(panel); // Bring to front on drag start
            this._bakePosition(panel);

            const offsetX = e.clientX - panel.offsetLeft;
            const offsetY = e.clientY - panel.offsetTop;

            const onMouseMove = (moveEvent) => {
                let newLeft = moveEvent.clientX - offsetX;
                let newTop = moveEvent.clientY - offsetY;

                // Basic boundary collision with viewport
                const panelRect = panel.getBoundingClientRect(); // Get current dimensions
                const margin = 10; // Small margin from edge

                if (newTop < margin) newTop = margin;
                if (newLeft < margin) newLeft = margin;
                if (newLeft + panelRect.width > window.innerWidth - margin) newLeft = window.innerWidth - panelRect.width - margin;
                if (newTop + panelRect.height > window.innerHeight - margin) newTop = window.innerHeight - panelRect.height - margin;


                panel.style.left = `${newLeft}px`;
                panel.style.top = `${newTop}px`;
            };

            const onMouseUp = () => {
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

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });
    },

    makeResizable(panel, handle, onStateChange, onResize) {
        handle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent drag from starting if resize handle is on header edge

            this.bringToFront(panel); // Bring to front on resize start
            this._bakePosition(panel);

            const initialX = e.clientX;
            const initialY = e.clientY;
            const initialWidth = panel.offsetWidth;
            const initialHeight = panel.offsetHeight;

            // Get min dimensions from CSS or set defaults
            const minWidth = parseInt(getComputedStyle(panel).minWidth) || 100;
            const minHeight = parseInt(getComputedStyle(panel).minHeight) || 50;


            const onResizeMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - initialX;
                const deltaY = moveEvent.clientY - initialY;
                
                let newWidth = initialWidth + deltaX;
                let newHeight = initialHeight + deltaY;

                // Enforce minimum dimensions
                if (newWidth < minWidth) newWidth = minWidth;
                if (newHeight < minHeight) newHeight = minHeight;

                // Optional: Max dimensions (e.g., viewport based)
                // const maxWidth = window.innerWidth - panel.offsetLeft - 10;
                // if (newWidth > maxWidth) newWidth = maxWidth;
                // const maxHeight = window.innerHeight - panel.offsetTop - 10;
                // if (newHeight > maxHeight) newHeight = maxHeight;

                panel.style.width = `${newWidth}px`;
                panel.style.height = `${newHeight}px`;
                if (onResize) {
                    onResize(); // Callback for things like xterm.fit()
                }
            };

            const onResizeUp = () => {
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

            document.addEventListener("mousemove", onResizeMove);
            document.addEventListener("mouseup", onResizeUp);
        });
    }
};