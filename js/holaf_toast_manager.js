/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - Toast Notification Manager
 *
 * Manages the lifecycle of non-blocking toast notifications.
 * Can be used globally via window.holaf.toastManager
 * CORRECTION: Removed flawed MutationObserver logic and now applies a default theme directly.
 */

export class HolafToastManager {
    constructor() {
        this.container = null;
        this.activeToasts = new Map();
        this._initContainer();
        
        // Apply a default theme to ensure toasts are always readable.
        // The theme can be changed later if a global theme-switching mechanism is introduced.
        this.setTheme('holaf-theme-graphite-orange'); 
    }

    _initContainer() {
        if (document.getElementById('holaf-toast-container')) {
            this.container = document.getElementById('holaf-toast-container');
            return;
        }
        this.container = document.createElement('div');
        this.container.id = 'holaf-toast-container';
        document.body.appendChild(this.container);
    }
    
    /**
     * Applies a specific theme class to the toast container.
     * @param {string} themeClassName - The CSS class name of the theme to apply (e.g., 'holaf-theme-midnight-purple').
     */
    setTheme(themeClassName) {
        if (!this.container) return;
        
        // Remove any existing theme classes
        const classList = Array.from(this.container.classList);
        for (const cls of classList) {
            if (cls.startsWith('holaf-theme-')) {
                this.container.classList.remove(cls);
            }
        }
        
        // Add the new theme class
        if (themeClassName) {
            this.container.classList.add(themeClassName);
        }
    }


    /**
     * Shows a new toast notification.
     * @param {object} options - The options for the toast.
     * @param {string} options.message - The message to display.
     * @param {string} [options.type='info'] - The type of toast ('info', 'success', 'error').
     * @param {number} [options.duration=4000] - Duration in ms. If 0, toast is persistent until hidden manually.
     * @param {string} [options.id=uuid] - A unique ID for the toast. If not provided, one is generated. Useful for updates.
     * @param {boolean} [options.progress=false] - If true, a progress bar is shown for persistent toasts.
     * @returns {string} The ID of the created toast.
     */
    show(options = {}) {
        const {
            message = 'No message provided.',
            type = 'info',
            duration = 4000,
            id = `toast-${Date.now()}-${Math.random()}`,
            progress = false
        } = options;

        if (this.activeToasts.has(id)) {
            // If a toast with the same ID exists, update it instead of creating a new one.
            return this.update(id, options);
        }

        const toastElement = this._createToastElement(id, message, type, progress);
        this.container.prepend(toastElement); // Prepend to show new toasts on top
        
        const close = () => this.hide(id);

        toastElement.addEventListener('click', close);
        
        let timeoutId = null;
        if (duration > 0) {
            timeoutId = setTimeout(close, duration);
        }

        this.activeToasts.set(id, { element: toastElement, timeoutId });

        return id;
    }
    
    /**
     * Updates an existing toast.
     * @param {string} id - The ID of the toast to update.
     * @param {object} options - The options to update.
     * @param {string} [options.message] - The new message.
     * @param {string} [options.type] - The new type.
     * @param {number} [options.progress] - The new progress value (0 to 100).
     * @returns {string} The ID of the updated toast.
     */
    update(id, options = {}) {
        if (!this.activeToasts.has(id)) {
            console.warn(`[HolafToastManager] Toast with ID "${id}" not found for update.`);
            return this.show({ id, ...options });
        }

        const { element } = this.activeToasts.get(id);

        if (options.message) {
            const messageEl = element.querySelector('.holaf-toast-message');
            if(messageEl) messageEl.innerHTML = options.message; // Use innerHTML to allow for simple tags like <strong>
        }

        if (options.type) {
            element.className = 'holaf-toast'; // Reset classes
            element.classList.add(options.type);
            const iconEl = element.querySelector('.holaf-toast-icon');
            if(iconEl) iconEl.innerHTML = this._getIconForType(options.type);
        }

        if (typeof options.progress === 'number') {
            const progressEl = element.querySelector('.holaf-toast-progress-bar');
            if (progressEl) {
                progressEl.style.width = `${Math.max(0, Math.min(100, options.progress))}%`;
            }
        }
        
        return id;
    }

    /**
     * Hides and removes a toast.
     * @param {string} id - The ID of the toast to hide.
     */
    hide(id) {
        if (!this.activeToasts.has(id)) return;

        const { element, timeoutId } = this.activeToasts.get(id);
        clearTimeout(timeoutId);

        element.classList.add('holaf-toast-fade-out');

        // Remove from DOM after fade-out animation completes
        element.addEventListener('animationend', () => {
            element.remove();
        }, { once: true });

        this.activeToasts.delete(id);
    }
    
    _createToastElement(id, message, type, showProgressBar) {
        const toastElement = document.createElement('div');
        toastElement.className = `holaf-toast ${type}`;
        toastElement.dataset.toastId = id;

        const icon = document.createElement('div');
        icon.className = 'holaf-toast-icon';
        icon.innerHTML = this._getIconForType(type);

        const messageEl = document.createElement('div');
        messageEl.className = 'holaf-toast-message';
        messageEl.innerHTML = message; // Use innerHTML to allow for simple tags

        const closeBtn = document.createElement('button');
        closeBtn.className = 'holaf-toast-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Close';
        closeBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent the toast's own click event
            this.hide(id);
        };
        
        toastElement.appendChild(icon);
        toastElement.appendChild(messageEl);
        toastElement.appendChild(closeBtn);
        
        if(showProgressBar) {
            const progressBar = document.createElement('div');
            progressBar.className = 'holaf-toast-progress-bar';
            toastElement.appendChild(progressBar);
        }

        return toastElement;
    }
    
    _getIconForType(type) {
        switch (type) {
            case 'success': return '✔'; // Check mark
            case 'error': return '✖'; // Cross
            case 'info':
            default:
                return 'ℹ'; // Info symbol
        }
    }
}