/*
 * Copyright (C) 2026 Holaf
 * Holaf Utilities - Shared extension asset base resolver.
 *
 * Resolves the root URL under which ComfyUI serves this pack's web assets
 * ("/extensions/<pack folder>/") WITHOUT hardcoding the pack folder name,
 * so the extension folder/repo can be renamed without breaking asset paths.
 *
 * SERVING LAYOUT (critical): ComfyUI mounts WEB_DIRECTORY ("<repo>/js/")
 * DIRECTLY at "/extensions/<pack>/". Browser URLs NEVER contain the "js/"
 * segment:
 *     <repo>/js/holaf_ext_base.js  ->  <origin>/extensions/<pack>/holaf_ext_base.js
 *     <repo>/js/css/x.css          ->  <origin>/extensions/<pack>/css/x.css
 * The pack root is therefore the DIRECTORY of this module's own URL (one
 * level UP from the file, NOT from a "js/" folder). A previous revision
 * used new URL("../", import.meta.url) assuming a "<root>/js/<file>" URL;
 * that silently produced "<origin>/extensions/" (both sanity checks passed)
 * and every injected stylesheet 404'd. See resolution strategy below.
 *
 * RESOLUTION STRATEGY (first match wins):
 *   1. window.HOLAF_EXT_BASE  - explicit host-side injection. Required for
 *     pages served through alias routes whose browser URL does not mirror
 *     disk layout (e.g. the profiler entry at /holaf/profiler/app.js; see
 *     js/profiler/holaf_profiler.js and PROFILER_HTML in __init__.py).
 *   2. import.meta.url        - standard case: this module is imported by
 *     the ComfyUI frontend from its real "/extensions/<pack>/" URL.
 *   3. document script scan   - find any <script src> served from
 *     "/extensions/<pack>/" and reuse its directory as the pack root.
 *   4. Legacy relative default - last resort, mirrors the documented
 *     pre-refactor behaviour (relative "extensions/<legacy name>/"); loud
 *     console.warn emitted. Never used while 1-3 succeed.
 */

const LEGACY_DEFAULT_BASE = "extensions/ComfyUI-Holaf-Utilities/";

function _logBase(mode, base) {
    console.info(`[Holaf] Extension asset base resolved via ${mode}: ${base}`);
}

/**
 * Validates a candidate base URL string and returns it normalized with a
 * trailing slash, or null if unusable. A usable base points at a pack
 * folder: its path must have at least two non-empty segments (e.g.
 * "/extensions/<pack>/"), optionally behind a reverse-proxy prefix.
 */
function _normalizeCandidateBase(rawBase) {
    if (!rawBase || typeof rawBase !== "string") return null;
    let url;
    try {
        url = new URL(rawBase);
    } catch {
        return null;
    }
    let path = url.pathname;
    if (!path || path === "/") return null;

    // Defensive: if we ever sit inside a literal "js/" folder in a served
    // URL, climb out of it - ComfyUI never exposes the WEB_DIRECTORY name.
    // (Kept harmless in the standard layout where it never triggers.)
    if (/\/js\/$/i.test(path)) {
        const parent = path.replace(/js\/$/i, "");
        if (parent.split("/").filter(Boolean).length >= 2 && /\/extensions\//i.test(parent)) {
            path = parent;
        }
    }

    const segments = path.split("/").filter(Boolean);
    if (segments.length < 2) return null; // e.g. "/extensions/" alone: no pack folder

    url.pathname = path.endsWith("/") ? path : `${path}/`;
    return url.href;
}

/** True when the path clearly identifies a ComfyUI-served pack folder. */
function _looksLikeExtensionsBase(base) {
    return !!base && /\/extensions\/[^/]+\//.test(base);
}

/** Strategy 1: host-injected override (standalone/alias pages). */
function _baseFromWindow() {
    if (typeof window === "undefined") return null;
    const injected = window.HOLAF_EXT_BASE;
    if (typeof injected !== "string" || !injected.trim()) return null;
    // Accept origin-relative ("/extensions/pack/") or absolute URLs only.
    if (!/^https?:\/\//i.test(injected) && !injected.startsWith("/")) return null;
    try {
        // Origin-relative values (e.g. "/extensions/pack" injected by
        // PROFILER_HTML in __init__.py) throw when passed to new URL()
        // alone: resolve them against the current document base first.
        const href = /^https?:\/\//i.test(injected)
            ? injected
            : new URL(injected, (typeof document !== "undefined" && document.baseURI) || "file:///").href;
        return _normalizeCandidateBase(href);
    } catch {
        return null;
    }
}

/** Strategy 2: derive from this module's own real URL. */
function _baseFromImportMeta() {
    try {
        // Directory containing this module file.
        return _normalizeCandidateBase(new URL(".", import.meta.url).href);
    } catch {
        return null;
    }
}

/** Strategy 3: reuse the directory of any script served from /extensions/. */
function _baseFromDocumentScripts() {
    if (typeof document === "undefined" || !document.scripts) return null;
    for (const script of document.scripts) {
        const src = script.src || "";
        const match = src.match(/\/extensions\/([^/?#]+)\//i);
        if (!match) continue;
        try {
            const url = new URL(src);
            const idx = url.pathname.toLowerCase().indexOf("/extensions/");
            const base = _normalizeCandidateBase(
                `${url.origin}${url.pathname.slice(0, idx)}${url.pathname.slice(idx, idx + "/extensions/".length)}${match[1]}/`
            );
            if (base) return base;
        } catch {
            // Malformed src attribute; keep scanning.
        }
    }
    return null;
}

function _resolveExtensionBase() {
    const strategies = [
        ["window.HOLAF_EXT_BASE (host-injected)", _baseFromWindow],
        ["import.meta.url", _baseFromImportMeta],
        ["document script scan", _baseFromDocumentScripts],
    ];
    for (const [mode, resolve] of strategies) {
        try {
            const base = resolve();
            if (!base) continue;
            if (!_looksLikeExtensionsBase(base)) {
                // Tolerated (custom reverse-proxy mounts may not use
                // /extensions/), but say so loudly in the console.
                console.warn("[Holaf] Resolved asset base does not look like /extensions/:", base);
            }
            _logBase(mode, base);
            return base;
        } catch (err) {
            console.warn(`[Holaf] Asset base strategy "${mode}" failed:`, err);
        }
    }

    // Last resort: documented legacy default (pre-refactor hardcoded path),
    // kept relative exactly as before. Loud warning so misresolution is
    // diagnosable from the console.
    console.warn(
        `[Holaf] Unable to resolve extension asset base (import.meta.url unavailable/unexpected and no /extensions/ script found). ` +
        `Falling back to legacy relative default "${LEGACY_DEFAULT_BASE}". Styles/scripts will 404 if the pack folder differs.`
    );
    return LEGACY_DEFAULT_BASE;
}

/** Root URL of this pack's served assets, with a trailing slash (never null). */
export const HOLAF_EXT_BASE = _resolveExtensionBase();

/**
 * Builds an absolute URL for a pack asset, relative to the extension root.
 * @param {string} relativePath e.g. "css/holaf_themes.css", "xterm.js"
 * @returns {string} absolute URL like "<base>/css/holaf_themes.css"
 */
export function holafExtUrl(relativePath) {
    const rel = String(relativePath).replace(/^\/+/, "");
    return HOLAF_EXT_BASE.endsWith("/") ? HOLAF_EXT_BASE + rel : `${HOLAF_EXT_BASE}/${rel}`;
}
