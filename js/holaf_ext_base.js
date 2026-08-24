/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Shared extension asset base resolver.
 *
 * Resolves the root URL under which ComfyUI serves this pack's web assets
 * ("/extensions/<pack folder>/") WITHOUT hardcoding the pack folder name,
 * so the extension folder/repo can be renamed without breaking asset paths.
 *
 * Mechanism: every file in WEB_DIRECTORY ("js/") is loaded by the ComfyUI
 * frontend from its real URL (<root>/<WEB_DIRECTORY>/<file>.js). Taking the
 * parent directory of this module's own URL therefore yields <root>, whatever
 * the pack folder is called.
 *
 * NOTE: modules served through an alias route (e.g. the profiler entry served
 * at /holaf/profiler/app.js as a MIME workaround) have a browser URL that does
 * NOT mirror their disk location: they cannot use this resolver and must get
 * the base injected by their host page instead (see js/profiler/holaf_profiler.js).
 */

function _resolveExtensionBase() {
    try {
        // Directory containing this module: <root>/<WEB_DIRECTORY>/ ; "../" -> <root>/
        const base = new URL("../", import.meta.url);
        if (!base.pathname || base.pathname === "/") {
            throw new Error(`unexpected module URL: ${import.meta.url}`);
        }
        if (!/\/extensions\//.test(base.href)) {
            // Not fatal: reverse proxies may mount ComfyUI under a sub-path.
            console.warn("[Holaf] Resolved asset base does not look like /extensions/:", base.href);
        }
        return base.href;
    } catch (err) {
        console.warn("[Holaf] Unable to resolve extension asset base URL from", import.meta.url, "-", err);
        return null;
    }
}

/** Root URL of this pack's served assets, with a trailing slash (or null on failure). */
export const HOLAF_EXT_BASE = _resolveExtensionBase();

/**
 * Builds an absolute URL for a pack asset, relative to the extension root.
 * @param {string} relativePath e.g. "css/holaf_themes.css" or "js/xterm.js"
 * @returns {string} absolute URL like "<base>/css/holaf_themes.css"
 */
export function holafExtUrl(relativePath) {
    const rel = String(relativePath).replace(/^\/+/, "");
    if (!HOLAF_EXT_BASE) return rel; // last resort (warning already emitted above)
    return HOLAF_EXT_BASE + rel;
}
