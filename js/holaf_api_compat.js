/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - ComfyUI API Compatibility Layer
 *
 * Provides backward-compatible access to the ComfyUI app and api objects.
 *
 * The ComfyUI frontend (>= v1.42) uses a Vite plugin (comfyAPIPlugin) that
 * transforms module exports into window.comfyAPI namespaces:
 *   window.comfyAPI.app.app = ComfyApp instance  (from scripts/app.ts)
 *   window.comfyAPI.api.api = ComfyApi instance   (from scripts/api.ts)
 *
 * It also generates legacy shim files at /scripts/app.js and /scripts/api.js
 * that re-export from window.comfyAPI, so the old import paths still work.
 *
 * This module tries window.comfyAPI first (fastest, no HTTP request),
 * then falls back to dynamic imports from the legacy shim paths.
 */

const _getApp = () => {
    // comfyAPIPlugin structure: window.comfyAPI.{module}.{export}
    if (window?.comfyAPI?.app?.app) return window.comfyAPI.app.app;
    // Fallback: some builds may expose directly
    if (window?.comfyAPI?.app && typeof window.comfyAPI.app === 'object' && window.comfyAPI.app.registerExtension) return window.comfyAPI.app;
    // Global fallback (older ComfyUI)
    if (window?.app?.registerExtension) return window.app;
    return null;
};

const _getApi = () => {
    if (window?.comfyAPI?.api?.api) return window.comfyAPI.api.api;
    if (window?.comfyAPI?.api && typeof window.comfyAPI.api === 'object' && window.comfyAPI.api.api_base !== undefined) return window.comfyAPI.api;
    if (window?.api?.api_base !== undefined) return window.api;
    return null;
};

let _app = _getApp();
let _api = _getApi();

console.log("[Holaf] API compat layer initialized. app:", _app ? "loaded" : "NOT YET", "| api:", _api ? "loaded" : "NOT YET");
if (_app) {
    console.log("[Holaf] app source:", window?.comfyAPI?.app?.app ? "window.comfyAPI.app.app" : 
                (window?.app?.registerExtension ? "window.app" : "unknown"));
}

// Fallback: schedule dynamic import if not available synchronously
if (!_app || !_api) {
    (async () => {
        try {
            if (!_app) {
                const mod = await import("../../scripts/app.js");
                _app = mod.app;
                console.log("[Holaf] app loaded from /scripts/app.js fallback");
            }
        } catch (e) {
            try {
                const mod = await import("../../../scripts/app.js");
                _app = mod.app;
                console.log("[Holaf] app loaded from alternate legacy path");
            } catch (e2) {
                console.error("[Holaf] Could not load app:", e, e2);
            }
        }

        try {
            if (!_api) {
                const mod = await import("../../scripts/api.js");
                _api = mod.api;
                console.log("[Holaf] api loaded from /scripts/api.js fallback");
            }
        } catch (e) {
            try {
                const mod = await import("../../../scripts/api.js");
                _api = mod.api;
                console.log("[Holaf] api loaded from alternate legacy path");
            } catch (e2) {
                console.error("[Holaf] Could not load api:", e, e2);
            }
        }

        if (!_app) {
            // Last resort: poll for window.comfyAPI.app.app (might be set later)
            console.warn("[Holaf] Polling for window.comfyAPI...");
            for (let i = 0; i < 50; i++) {
                await new Promise(r => setTimeout(r, 100));
                const maybeApp = _getApp();
                const maybeApi = _getApi();
                if (maybeApp) { _app = maybeApp; console.log("[Holaf] app found via polling window.comfyAPI"); break; }
            }
            if (!_app) {
                console.error("[Holaf] CRITICAL: Could not obtain ComfyUI app object after 5s. Extension will not function.");
                console.error("[Holaf] window.comfyAPI =", window.comfyAPI);
            }
        }
    })();
}

/**
 * Proxy for app that forwards to the real ComfyApp instance.
 * If _app is already available (synchronous path), all property
 * accesses go directly to it. If not, calls are queued via promises.
 */
export const app = _app || new Proxy({}, {
    get(_target, prop) {
        // Try getting app again (might have been set by async fallback)
        const realApp = _app || _getApp();
        if (realApp) {
            const val = realApp[prop];
            return typeof val === 'function' ? val.bind(realApp) : val;
        }
        // Queue registerExtension calls for when app becomes available
        if (prop === 'registerExtension') {
            return (...args) => {
                const tryRegister = () => {
                    const a = _app || _getApp();
                    if (a) { a.registerExtension(...args); return true; }
                    return false;
                };
                if (!tryRegister()) {
                    // Retry with delay
                    setTimeout(tryRegister, 100);
                }
            };
        }
        console.warn(`[Holaf] app.${String(prop)} accessed before app was available`);
        return undefined;
    },
    set(_target, prop, value) {
        const realApp = _app || _getApp();
        if (realApp) { realApp[prop] = value; return true; }
        // Queue property set
        const check = () => {
            const a = _app || _getApp();
            if (a) { a[prop] = value; return true; }
            return false;
        };
        if (!check()) setTimeout(check, 100);
        return true;
    }
});

/**
 * Proxy for api that forwards to the real ComfyApi instance.
 */
export const api = _api || new Proxy({}, {
    get(_target, prop) {
        const realApi = _api || _getApi();
        if (realApi) {
            const val = realApi[prop];
            return typeof val === 'function' ? val.bind(realApi) : val;
        }
        console.warn(`[Holaf] api.${String(prop)} accessed before api was available`);
        return undefined;
    },
    set(_target, prop, value) {
        const realApi = _api || _getApi();
        if (realApi) { realApi[prop] = value; return true; }
        const check = () => {
            const a = _api || _getApi();
            if (a) { a[prop] = value; return true; }
            return false;
        };
        if (!check()) setTimeout(check, 100);
        return true;
    }
});