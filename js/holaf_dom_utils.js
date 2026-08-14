/*
 * Copyright (C) 2025 Holaf
 * Holaf Utilities - DOM security helpers
 *
 * Centralized utilities for safely inserting untrusted data into the DOM.
 *
 * - escapeHtml: escape untrusted strings before interpolating them into HTML.
 * - sanitizeUrl: allow only safe URL schemes for href/src attributes.
 * - sanitizeMarkdownHtml: whitelist-based sanitizer for the HTML produced by
 *   marked.js. DOMPurify is NOT bundled with this project and adding a new
 *   external dependency is not desired, so this minimal sanitizer removes
 *   scripts, event handlers, javascript:/vbscript: URLs and other dangerous
 *   content while preserving the common Markdown tags used for READMEs.
 */

export function escapeHtml(value) {
    const str = String(value ?? '');
    return str.replace(/[&<>"']/g, (ch) => {
        switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return ch;
        }
    });
}

/**
 * Validates a URL for use in href/src attributes.
 * @param {*} value
 * @param {{allowDataImage?: boolean}} [options]
 * @returns {string} The sanitized URL, or an empty string if it is unsafe.
 */
export function sanitizeUrl(value, { allowDataImage = false } = {}) {
    const str = String(value ?? '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
    const lower = str.toLowerCase();

    if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '';
    if (lower.startsWith('data:')) {
        return allowDataImage && lower.startsWith('data:image/') ? str : '';
    }
    return str;
}

const ALLOWED_TAGS = new Set([
    'A', 'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'STRONG', 'EM', 'B', 'I', 'DEL', 'S', 'U', 'UL', 'OL', 'LI',
    'PRE', 'CODE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT',
    'TR', 'TH', 'TD', 'SPAN', 'DIV', 'IMG', 'INPUT', 'DETAILS',
    'SUMMARY', 'KBD', 'DL', 'DT', 'DD'
]);

const ALLOWED_ATTRIBUTES = {
    A: ['href', 'title', 'target', 'rel'],
    IMG: ['src', 'alt', 'title', 'width', 'height'],
    INPUT: ['type', 'checked', 'disabled'],
    CODE: ['class'],
    TH: ['align'],
    TD: ['align']
};

function isAllowedAttribute(tag, name) {
    const normalized = String(name).toLowerCase();
    if (normalized.startsWith('on')) return false;
    const attrs = ALLOWED_ATTRIBUTES[tag];
    return attrs ? attrs.includes(normalized) : false;
}

/**
 * Minimal, whitelist-based HTML sanitizer.
 *
 * The HTML returned by marked.js is parsed without executing scripts (an
 * element created via innerHTML on a detached <template> is inert). The DOM
 * is then walked and every non-allowlisted tag is unwrapped while its already
 * sanitized children are preserved. Script/style content is dropped because
 * the tags themselves are not in the allowlist and are unwrapped rather than
 * kept, so their text content would become visible text; to avoid that,
 * SCRIPT and STYLE elements are removed completely below.
 *
 * @param {string} html
 * @returns {string} Sanitized HTML.
 */
export function sanitizeMarkdownHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html ?? '');

    const cleanElement = (el) => {
        const tag = el.tagName.toUpperCase();

        // Clean children first so any nodes moved during unwrapping are safe.
        Array.from(el.children).forEach((child) => cleanElement(child));

        if (!ALLOWED_TAGS.has(tag)) {
            const parent = el.parentNode;
            if (!parent) return;

            if (tag === 'SCRIPT' || tag === 'STYLE') {
                // Never preserve raw script/style content as text.
                parent.removeChild(el);
                return;
            }

            // Unwrap unknown/inline elements while keeping their children.
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            return;
        }

        // Remove every attribute, then re-apply only the allowlisted ones.
        for (const attr of Array.from(el.attributes)) {
            if (!isAllowedAttribute(tag, attr.name)) {
                el.removeAttribute(attr.name);
            }
        }

        // Sanitize URL-bearing attributes.
        if (el.hasAttribute('href')) {
            const safeHref = sanitizeUrl(el.getAttribute('href'));
            if (safeHref) {
                el.setAttribute('href', safeHref);
            } else {
                el.removeAttribute('href');
            }
        }

        if (el.hasAttribute('src')) {
            const safeSrc = sanitizeUrl(el.getAttribute('src'), { allowDataImage: true });
            if (safeSrc) {
                el.setAttribute('src', safeSrc);
            } else {
                el.removeAttribute('src');
            }
        }

        // Links opening in a new tab must not leak the opener.
        if (tag === 'A' && el.getAttribute('target') === '_blank') {
            el.setAttribute('rel', 'noopener noreferrer');
        }

        // Keep only language-* classes on code blocks (used by syntax highlighters).
        if (tag === 'CODE' && el.hasAttribute('class')) {
            const langClass = String(el.getAttribute('class')).match(/language-[\w-]+/);
            if (langClass) {
                el.setAttribute('class', langClass[0]);
            } else {
                el.removeAttribute('class');
            }
        }

        // GitHub task lists use checkboxes. Force anything else to a disabled
        // checkbox so the README cannot submit forms or trigger handlers.
        if (tag === 'INPUT') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (type !== 'checkbox') {
                el.setAttribute('type', 'checkbox');
            }
            el.setAttribute('disabled', '');
        }
    };

    Array.from(template.content.children).forEach((child) => cleanElement(child));

    return template.innerHTML;
}
