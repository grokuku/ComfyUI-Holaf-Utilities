/**
 * AIH Widget Base - Shared infrastructure for ComfyUI custom widgets.
 *
 * This module provides common utilities (waitForApp, registerWidget) to reduce
 * duplication across aih_*_widget.js files. Individual widget files should
 * eventually be refactored to use these helpers instead of their own inline
 * copies of waitForApp() and beforeRegisterNodeDef() hooks.
 *
 * Depends on: 03_aih_shared.js (for AIH namespace / getApiKey)
 */
(function() {
    "use strict";
    const AIH = (window.AIH = window.AIH || {});

    /**
     * Wait until ComfyUI's app/graph is fully loaded, then invoke callback.
     *
     * @param {Function} callback  - Called with window.app once ready.
     * @param {Object}   opts       - Optional configuration:
     *   - maxAttempts {number}   Poll limit (default 100).
     *   - interval    {number}   Poll interval in ms (default 100).
     *   - onTimeout   {Function} Called if app never becomes ready.
     */
    AIH.waitForApp = function(callback, opts) {
        opts = opts || {};
        const maxAttempts = opts.maxAttempts || 100;
        const interval = opts.interval || 100;
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            const app = window.app || window.comfyAPI?.app?.app;
            if (app && app.graph) {
                clearInterval(check);
                callback(app);
            } else if (attempts >= maxAttempts) {
                clearInterval(check);
                console.warn("[AIH] App not ready after", maxAttempts, "attempts");
                if (opts.onTimeout) opts.onTimeout();
            }
        }, interval);
    };

    /**
     * Register common hooks on a ComfyUI node type prototype.
     *
     * @param {Object} nodeType - The ComfyUI node type (prototype holder).
     * @param {Object} config    - Hook configuration:
     *   - onCreated {Function} Called inside onNodeCreated (after original).
     *
     * Future extensions can add beforeRegisterNodeDef, onExecuted, etc.
     */
    AIH.registerWidget = function(nodeType, config) {
        config = config || {};
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            if (config.onCreated) config.onCreated.call(this);
            return r;
        };
    };
})();