/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Panel Manager
 *
 * This script provides a generic manager for creating, dragging,
 * and resizing floating panels within the ComfyUI interface.
 * REFACTORED: Removed pop-out logic and theme exports for a cleaner, more stable base.
 * MODIFIED: Added a generic, promise-based `createDialog` function for custom modals.
 * MODIFIED: Added `bringToFront` on any panel mousedown, not just header.
 * MODIFIED: Added fullscreen toggling on header double-click.
 * MODIFICATION: Added dialog keyboard navigation and global state.
 * CRITICAL FIX: Removed unused import of 'app' which caused crashes in standalone mode.
 */

import { HOLAF_THEMES } from "./holaf_themes.js";

// MODIFICATION: Global state to track if a dialog is open
export const dialogState = {
    isOpen: false
};

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

        openPanels.add(panel);

        const header = document.createElement("div");
        header.className = "holaf-utility-header";

        const title = document.createElement("span");
        title.innerHTML = options.title;
        title.style.flexGrow = "1";
        title.style.overflow = "hidden";
        title.style.textOverflow = "ellipsis";
        title.style.whiteSpace = "nowrap";
        header.appendChild(title);

        if (options.headerContent) {
            const headerControlsWrapper = document.createElement("div");
            headerControlsWrapper.style.display = "flex";
            headerControlsWrapper.style.alignItems = "center";
            headerControlsWrapper.appendChild(options.headerContent);
            header.appendChild(headerControlsWrapper);
        }

        const closeButton = document.createElement("button");
        closeButton.className = "holaf-utility-close-button";
        closeButton.textContent = "✖";
        closeButton.title = "Fermer";
        closeButton.style.marginLeft = "auto";
        if (options.headerContent) {
            closeButton.style.marginLeft = "10px";
        }

        closeButton.onclick = (e) => {
            e.stopPropagation();
            panel.style.display = "none";
            openPanels.delete(panel);
            if (parseInt(panel.style.zIndex) === currentMaxZIndex && openPanels.size > 0) {
                currentMaxZIndex = BASE_Z_INDEX;
                openPanels.forEach(p => {
                    const pZIndex = parseInt(p.style.zIndex);
                    if (pZIndex > currentMaxZIndex) currentMaxZIndex = pZIndex;
                });
            } else if (openPanels.size === 0) {
                currentMaxZIndex = BASE_Z_INDEX;
            }
            if (options.onClose) options.onClose();
        };
        header.appendChild(closeButton);

        const content = document.createElement("div");
        content.style.flexGrow = "1";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.overflow = "hidden";
        content.style.position = "relative";

        const resizeHandle = document.createElement("div");
        resizeHandle.className = "holaf-utility-resize-handle";

        panel.append(header, content, resizeHandle);
        document.body.appendChild(panel);

        panel.addEventListener("mousedown", () => {
            this.bringToFront(panel);
        }, true);

        this.makeDraggable(panel, header, options.onStateChange);
        this.makeResizable(panel, resizeHandle, options.onStateChange, options.onResize);
        this.setupFullscreenToggle(panel, header, options.onFullscreenToggle);

        this.bringToFront(panel);

        return { panelEl: panel, contentEl: content, headerEl: header };
    },

    bringToFront(panelEl) {
        if (!openPanels.has(panelEl)) {
            openPanels.add(panelEl);
        }

        let maxZ = BASE_Z_INDEX;
        openPanels.forEach(p => {
            const pZIndex = parseInt(p.style.zIndex);
            if (!isNaN(pZIndex) && pZIndex > maxZ) maxZ = pZIndex;
        });
        currentMaxZIndex = maxZ;

        const panelZIndex = parseInt(panelEl.style.zIndex);
        if (isNaN(panelZIndex) || panelZIndex < currentMaxZIndex || openPanels.size === 1) {
            currentMaxZIndex++;
            panelEl.style.zIndex = currentMaxZIndex;
        } else if (panelEl.style.zIndex !== String(currentMaxZIndex) && panelZIndex === currentMaxZIndex) {
            currentMaxZIndex++;
            panelEl.style.zIndex = currentMaxZIndex;
        }
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
            if (panel.classList.contains("holaf-panel-fullscreen") || e.target.closest("button, input, select, textarea, a")) {
                return;
            }
            e.preventDefault();

            this.bringToFront(panel);
            this._bakePosition(panel);

            const offsetX = e.clientX - panel.offsetLeft;
            const offsetY = e.clientY - panel.offsetTop;

            const onMouseMove = (moveEvent) => {
                let newLeft = moveEvent.clientX - offsetX;
                let newTop = moveEvent.clientY - offsetY;
                const margin = 10;
                const panelRect = panel.getBoundingClientRect();

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
                    onStateChange({ x: panel.offsetLeft, y: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight });
                }
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });
    },

    makeResizable(panel, handle, onStateChange, onResize) {
        handle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.bringToFront(panel);
            this._bakePosition(panel);

            const initialX = e.clientX;
            const initialY = e.clientY;
            const initialWidth = panel.offsetWidth;
            const initialHeight = panel.offsetHeight;
            const minWidth = parseInt(getComputedStyle(panel).minWidth) || 100;
            const minHeight = parseInt(getComputedStyle(panel).minHeight) || 50;

            const onResizeMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - initialX;
                const deltaY = moveEvent.clientY - initialY;
                let newWidth = Math.max(minWidth, initialWidth + deltaX);
                let newHeight = Math.max(minHeight, initialHeight + deltaY);
                panel.style.width = `${newWidth}px`;
                panel.style.height = `${newHeight}px`;
                if (onResize) onResize();
            };

            const onResizeUp = () => {
                document.removeEventListener("mousemove", onResizeMove);
                document.removeEventListener("mouseup", onResizeUp);
                if (onStateChange) {
                    onStateChange({ x: panel.offsetLeft, y: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight });
                }
            };

            document.addEventListener("mousemove", onResizeMove);
            document.addEventListener("mouseup", onResizeUp);
        });
    },

    setupFullscreenToggle(panel, handle, onFullscreenToggle) {
        handle.addEventListener("dblclick", (e) => {
            if (e.target.closest("button, input, select, textarea, a")) return;
            this.toggleFullscreen(panel, onFullscreenToggle);
        });
    },

    toggleFullscreen(panel, onFullscreenToggle) {
        const isFullscreen = panel.classList.toggle("holaf-panel-fullscreen");
        if (onFullscreenToggle) {
            onFullscreenToggle(isFullscreen);
        }
    },

    createDialog(options) {
        return new Promise((resolve) => {
            dialogState.isOpen = true;

            const overlay = document.createElement("div");
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.6); z-index: 110000;
                display: flex; align-items: center; justify-content: center;
            `;

            const dialog = document.createElement("div");
            dialog.className = "holaf-utility-panel";
            dialog.style.position = "relative";
            dialog.style.transform = "none";
            dialog.style.width = "auto";
            dialog.style.minWidth = "300px";
            dialog.style.maxWidth = "500px";
            dialog.style.height = "auto";
            dialog.style.top = "auto";
            dialog.style.left = "auto";

            const anyPanel = document.querySelector('.holaf-utility-panel');
            let themeClass = 'holaf-theme-graphite-orange';
            if (anyPanel) {
                for (const theme of HOLAF_THEMES) {
                    if (anyPanel.classList.contains(theme.className)) {
                        themeClass = theme.className;
                        break;
                    }
                }
            }
            dialog.classList.add(themeClass);

            const header = document.createElement("div");
            header.className = "holaf-utility-header";
            header.innerHTML = `<span>${options.title || "Confirmation"}</span>`;

            const content = document.createElement("div");
            content.innerHTML = `<p style="padding: 15px 20px; color: var(--holaf-text-primary); white-space: pre-wrap;">${options.message}</p>`;

            const footer = document.createElement("div");
            footer.style.cssText = `
                padding: 10px 20px; display: flex; justify-content: flex-end;
                gap: 10px; background-color: var(--holaf-background-secondary);
                border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;
            `;

            const buttons = [];
            let focusedButtonIndex = -1;

            const closeDialog = (value) => {
                document.removeEventListener("keydown", handleDialogKeyDown);
                dialogState.isOpen = false;
                document.body.removeChild(overlay);
                resolve(value);
            };

            (options.buttons || [{ text: "OK", value: true, type: "confirm" }]).forEach(btnInfo => {
                const button = document.createElement("button");
                button.textContent = btnInfo.text;
                button.className = "comfy-button";
                if (btnInfo.type === 'cancel') {
                    button.style.backgroundColor = 'var(--holaf-tag-background)';
                } else if (btnInfo.type === 'danger') {
                    button.style.backgroundColor = '#c44';
                }
                button.onclick = () => {
                    if (btnInfo.onClick) btnInfo.onClick();
                    closeDialog(btnInfo.value);
                };
                footer.appendChild(button);
                buttons.push(button);
            });

            const updateFocusedButton = (newIndex) => {
                if (focusedButtonIndex > -1) {
                    buttons[focusedButtonIndex].classList.remove('dialog-button-focused');
                }
                buttons[newIndex].classList.add('dialog-button-focused');
                buttons[newIndex].focus();
                focusedButtonIndex = newIndex;
            };

            const handleDialogKeyDown = (e) => {
                if (buttons.length === 0) return;

                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    let newIndex = (focusedButtonIndex - 1 + buttons.length) % buttons.length;
                    updateFocusedButton(newIndex);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    let newIndex = (focusedButtonIndex + 1) % buttons.length;
                    updateFocusedButton(newIndex);
                } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (focusedButtonIndex > -1) {
                        buttons[focusedButtonIndex].click();
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    const cancelButton = buttons.find(btn => btn.textContent.toLowerCase() === 'cancel' || btn.textContent.toLowerCase() === 'annuler');
                    if (cancelButton) {
                        cancelButton.click();
                    }
                }
            };

            document.addEventListener("keydown", handleDialogKeyDown);

            dialog.append(header, content, footer);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            if (buttons.length > 0) {
                updateFocusedButton(buttons.length - 1);
            }
        });
    }
};