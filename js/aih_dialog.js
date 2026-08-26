/*
 * Copyright (C) 2026 Holaf
 * AIH Dialog — Système unifié de dialogues (FONDATIONS / Vague 0)
 * ----------------------------------------------------------------------------
 * S'ajoute SANS régression : aucun consommateur existant n'est modifié à cette
 * étape. Le module expose un contrat d'API unifié sous window.AIH.Dialog et
 * window.AIH.Theme, puis rebranche les API historiques comme wrappers :
 *   - aihOpenModalV2 / aihShowAlert / aihShowConfirm / aihShowPrompt
 *   - HolafPanelManager.createDialog
 *   - window.HolafModal.show (forward-compatible)
 *
 * Le drag / resize réutilise js/holaf_window_utils.js (makeDraggable /
 * makeResizable). Autorité de z-index unique (compteur partagé).
 *
 * Dépendances : holaf_window_utils.js (drag/resize),
 *               holaf_panel_manager.js (wrapper createDialog).
 * CSS : js/css/aih_dialog.css (auto-chargé par ComfyUI, thème centralisé --aih-*).
 */

import { makeDraggable, makeResizable } from "./holaf_window_utils.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";

(function () {
    "use strict";

    const AIH = (window.AIH = window.AIH || {});

    // ─── Z-index authority (compteur partagé unique) ────────────────────────
    const DEFAULT_Z = 90000;
    const MAX_Z = 50000; // fenêtre de compteur avant renormalisation
    if (typeof window._aihDialogZCounter === "undefined") {
        window._aihDialogZCounter = 0;
    }

    function nextZ() {
        window._aihDialogZCounter += 1;
        if (window._aihDialogZCounter > MAX_Z) {
            const all = document.querySelectorAll(".aih-dialog-root");
            window._aihDialogZCounter = 0;
            for (let i = 0; i < all.length; i++) {
                window._aihDialogZCounter += 1;
                all[i].style.zIndex = String(DEFAULT_Z + window._aihDialogZCounter);
            }
        }
        return DEFAULT_Z + window._aihDialogZCounter;
    }

    // ─── Utilitaires ─────────────────────────────────────────────────────────
    function isNode(obj) {
        return obj && typeof obj === "object" && obj.nodeType === 1;
    }

    function toPx(val) {
        if (val === undefined || val === null || val === "") return undefined;
        if (typeof val === "number") return val + "px";
        return String(val);
    }

    function parseLen(val, viewportDim) {
        if (typeof val !== "string") return parseInt(val, 10) || 0;
        const s = val.trim();
        if (s.endsWith("px")) return parseFloat(s);
        if (s.endsWith("vw")) return (parseFloat(s) / 100) * window.innerWidth;
        if (s.endsWith("vh")) return (parseFloat(s) / 100) * window.innerHeight;
        if (s.endsWith("%")) return (parseFloat(s) / 100) * viewportDim;
        return parseFloat(s) || 0;
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ─── I18n helper ──────────────────────────────────────────────────────────
    // Traduit une clé via AIH.I18n (si disponible) et retombe sur un libellé
    // littéral quand la couche i18n est absente ou ne fournit pas la clé. Les
    // libellés explicites fournis par l'appelant prennent toujours le dessus.
    function L(key, params, fallback) {
        if (AIH.I18n && typeof AIH.I18n.t === "function") {
            const v = AIH.I18n.t(key, params);
            if (v !== undefined && v !== null && v !== key) return v;
        }
        return fallback;
    }

    // ─── Persistance position / taille ───────────────────────────────────────
    const STORE_KEY = "aih_dialog_rects";
    let _saveTimer = null;

    function getStore() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
        } catch (e) {
            return {};
        }
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
        } catch (e) {
            /* localStorage indisponible — silencieux */
        }
    }

    function saveRect(key, rect) {
        if (!key) return;
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            _saveTimer = null;
            const store = getStore();
            store[key] = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            writeStore(store);
        }, 300);
    }

    function loadRect(key) {
        if (!key) return null;
        return getStore()[key] || null;
    }

    // ─── Thème (AIH.Theme) ───────────────────────────────────────────────────
    const THEME_VARS = [
        "--aih-accent", "--aih-accent-hover", "--aih-accent-text",
        "--aih-bg", "--aih-bg-secondary", "--aih-bg-input", "--aih-bg-hover",
        "--aih-text", "--aih-text-secondary",
        "--aih-border", "--aih-border-strong",
        "--aih-danger", "--aih-danger-hover", "--aih-danger-text", "--aih-success",
        "--aih-radius", "--aih-radius-footer",
        "--aih-shadow", "--aih-shadow-active", "--aih-overlay-bg", "--aih-busy-bg",
        "--aih-font-size", "--aih-title-size", "--aih-title-weight",
        "--aih-btn-bg", "--aih-btn-bg-hover", "--aih-btn-border",
        "--aih-close-color", "--aih-close-hover", "--aih-input-focus",
        "--aih-resize-handle", "--aih-resize-handle-active",
    ];

    const THEME_STORAGE_KEY = "aih_theme_overrides";

    function defaultTarget() {
        return document.documentElement;
    }

    // Applique des surcharges de thème sur un élément (sans persistance globale).
    function applyVars(el, overrides) {
        if (!overrides) return;
        Object.keys(overrides).forEach((k) => {
            if (k.indexOf("--aih-") === 0) {
                el.style.setProperty(k, String(overrides[k]));
            }
        });
    }

    const Theme = {
        _target: null,

        get target() {
            return this._target || defaultTarget();
        },

        setTheme(overrides, target) {
            const el = target || this.target;
            const merged = {};
            // Base = valeurs actuelles (défauts CSS déjà posés sur :root)
            const current = this.getTheme(el);
            Object.assign(merged, current, overrides || {});
            applyVars(el, merged);
            if (overrides) {
                try {
                    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(merged));
                } catch (e) { /* silencieux */ }
            }
            return merged;
        },

        getTheme(target) {
            const el = target || this.target;
            const cs = getComputedStyle(el);
            const out = {};
            THEME_VARS.forEach((k) => {
                const v = cs.getPropertyValue(k).trim();
                out[k] = v || "";
            });
            return out;
        },

        resetTheme(target) {
            const el = target || this.target;
            THEME_VARS.forEach((k) => el.style.removeProperty(k));
            try {
                localStorage.removeItem(THEME_STORAGE_KEY);
            } catch (e) { /* silencieux */ }
        },

        // Restaure des surcharges persistées (appelé une fois au chargement).
        _restorePersisted() {
            try {
                const raw = localStorage.getItem(THEME_STORAGE_KEY);
                if (raw) applyVars(defaultTarget(), JSON.parse(raw));
            } catch (e) { /* silencieux */ }
        },
    };

    AIH.Theme = Theme;

    // ─── Noyau : AIH.Dialog.open ─────────────────────────────────────────────
    function open(opts) {
        opts = opts || {};

        const modal = !!opts.modal;
        const resizable = opts.resizable !== undefined ? !!opts.resizable : !modal;
        const draggable = opts.draggable !== undefined ? !!opts.draggable : !modal;
        const closeOnEscape = opts.closeOnEscape !== false;
        const closeOnOverlay = opts.closeOnOverlay !== false;
        const focusTrap = opts.focusTrap !== undefined ? !!opts.focusTrap : modal;
        const bringToFrontOnClick = opts.bringToFrontOnClick !== false;
        const busy = !!opts.busy;

        const width = toPx(opts.width) || "400px";
        const height = toPx(opts.height);
        const minWidth = toPx(opts.minWidth || opts.min) || "280px";
        const minHeight = toPx(opts.minHeight || opts.min) || "120px";
        const maxWidth = toPx(opts.maxWidth || opts.max) || "90vw";
        const maxHeight = toPx(opts.maxHeight || opts.max) || "85vh";

        const storageKey = opts.storageKey || null;
        const persistSize = !!opts.persistSize;
        const persistPos = !!opts.persistPos;

        // ── Overlay (mode modal) ────────────────────────────────────────────
        let overlay = null;
        if (modal) {
            overlay = document.createElement("div");
            overlay.className = "aih-dialog-overlay";
            document.body.appendChild(overlay);
        }

        // ── Racine ──────────────────────────────────────────────────────────
        const el = document.createElement("div");
        el.className = "aih-dialog-theme aih-dialog-root" + (opts.className ? " " + opts.className : "");
        if (opts.id) el.id = opts.id;

        // Applique un thème spécifique au dialogue (inline, sans persistance).
        if (opts.theme) applyVars(el, opts.theme);

        const z = (typeof opts.zIndex === "number" ? opts.zIndex : DEFAULT_Z) + window._aihDialogZCounter + 1;
        el.style.zIndex = String(z);
        if (overlay) overlay.style.zIndex = String(z);

        el.style.width = width;
        if (height) el.style.height = height;
        el.style.minWidth = minWidth;
        el.style.minHeight = minHeight;
        el.style.maxWidth = maxWidth;
        el.style.maxHeight = maxHeight;

        // ── Header ──────────────────────────────────────────────────────────
        const header = document.createElement("div");
        header.className = "aih-dialog-header";

        const titleEl = document.createElement("span");
        titleEl.className = "aih-dialog-title";
        titleEl.textContent = opts.title || "";

        const closeBtn = document.createElement("button");
        closeBtn.className = "aih-dialog-close";
        closeBtn.textContent = "✕";
        closeBtn.title = L("dialog.close", null, "Close");
        closeBtn.style.display = busy ? "none" : "";
        if (!busy) header.appendChild(closeBtn);

        header.appendChild(titleEl);
        el.appendChild(header);

        // ── Body ────────────────────────────────────────────────────────────
        const body = document.createElement("div");
        body.className = "aih-dialog-body";

        function renderContent(target) {
            const c = opts.content;
            if (typeof c === "function") {
                const r = c(target);
                if (isNode(r)) target.appendChild(r);
                else if (typeof r === "string") target.innerHTML = r;
            } else if (isNode(c)) {
                target.appendChild(c);
            } else if (c !== undefined && c !== null) {
                target.innerHTML = String(c);
            }
        }
        renderContent(body);
        el.appendChild(body);

        // ── Footer / boutons ────────────────────────────────────────────────
        let footer = null;
        const buttons = opts.buttons || [];
        if (buttons.length > 0 && !busy) {
            footer = document.createElement("div");
            footer.className = "aih-dialog-footer";
            el.appendChild(footer);
        }

        // ── Resize handles ──────────────────────────────────────────────────
        const resizeHandles = [];
        const handleDirs = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
        handleDirs.forEach((dir) => {
            const h = document.createElement("div");
            h.className = "aih-dialog-resize-handle aih-dialog-resize-" + dir;
            h.dataset.dir = dir;
            el.appendChild(h);
            resizeHandles.push(h);
        });
        if (!resizable) {
            resizeHandles.forEach((h) => { h.style.display = "none"; });
        }

        // ── Insertion dans le DOM (el après overlay → même z, au-dessus) ───
        document.body.appendChild(el);

        // ── Position par défaut / restaurée ────────────────────────────────
        let positioned = false;
        if (storageKey) {
            const saved = loadRect(storageKey);
            if (saved) {
                const w = saved.width || parseInt(width, 10);
                const h = saved.height || parseInt(height, 10);
                if (persistSize) {
                    el.style.width = w + "px";
                    el.style.height = h + "px";
                }
                if (persistPos) {
                    const vw = window.innerWidth;
                    const vh = window.innerHeight;
                    const m = 20;
                    const left = clamp(saved.left, m, vw - w - m);
                    const top = clamp(saved.top, m, vh - h - m);
                    el.style.left = left + "px";
                    el.style.top = top + "px";
                    positioned = true;
                }
            }
        }
        if (!positioned) {
            const pw = parseInt(el.style.width, 10) || 400;
            const ph = parseInt(el.style.height, 10) || 300;
            el.style.left = Math.max(20, (window.innerWidth - pw) / 2) + "px";
            el.style.top = Math.max(20, (window.innerHeight - ph) / 3) + "px";
        }

        // ── Busy overlay (spinner) ──────────────────────────────────────────
        let busyEl = null;
        function setBusy(b, msg) {
            if (!busyEl && b) {
                busyEl = document.createElement("div");
                busyEl.className = "aih-dialog-busy";
                const spin = document.createElement("span");
                spin.className = "aih-dialog-spinner";
                const lbl = document.createElement("div");
                lbl.className = "aih-dialog-busy-msg";
                lbl.textContent = msg || "";
                busyEl.appendChild(spin);
                busyEl.appendChild(lbl);
                el.appendChild(busyEl);
            }
            if (busyEl) busyEl.style.display = b ? "flex" : "none";
        }

        // ── Bring to front ──────────────────────────────────────────────────
        function bringToFront() {
            const newZ = nextZ();
            el.style.zIndex = String(newZ);
            if (overlay) overlay.style.zIndex = String(newZ);
            document.querySelectorAll(".aih-dialog-root").forEach((d) => d.classList.remove("active"));
            el.classList.add("active");
        }

        if (bringToFrontOnClick) {
            el.addEventListener("mousedown", () => {
                if (document.querySelectorAll(".aih-dialog-root.active")[0] !== el) {
                    bringToFront();
                }
            });
        }

        // ── Fermeture ───────────────────────────────────────────────────────
        let closed = false;
        let _result = null;
        let _keyHandler = null;

        function cleanup() {
            if (overlay && overlay.parentNode) overlay.remove();
            if (_keyHandler) document.removeEventListener("keydown", _keyHandler);
        }

        function close(value) {
            if (closed) return;
            closed = true;
            _result = value !== undefined ? value : null;
            if (storageKey && (persistSize || persistPos)) {
                saveRect(storageKey, {
                    left: el.offsetLeft,
                    top: el.offsetTop,
                    width: el.offsetWidth,
                    height: el.offsetHeight,
                });
            }
            cleanup();
            el.remove();
            if (typeof opts.onClose === "function") {
                try { opts.onClose(_result); } catch (e) { /* silencieux */ }
            }
            if (typeof _onResolve === "function") {
                try { _onResolve(_result); } catch (e) { /* silencieux */ }
            }
        }

        // ── Clavier (Escape + focus trap) — un seul écouteur, supprimé à la fermeture ─
        if ((closeOnEscape || focusTrap) && !busy) {
            _keyHandler = (e) => {
                if (e.key === "Escape" && closeOnEscape && !closed) {
                    close();
                    return;
                }
                if (e.key === "Tab" && focusTrap) {
                    const focusable = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                    if (focusable.length === 0) return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            };
            document.addEventListener("keydown", _keyHandler);
        }

        // ── closeBtn click ──────────────────────────────────────────────────
        if (!busy) closeBtn.addEventListener("click", () => close());

        // ── Overlay click (modal) ───────────────────────────────────────────
        if (overlay && closeOnOverlay && !busy) {
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) close();
            });
        }

        // ── Drag ────────────────────────────────────────────────────────────
        if (draggable) {
            makeDraggable(el, {
                handle: header,
                anchor: "left-top",
                clamp: true,
                margin: 10,
                ignore: "button, input, select, textarea, a",
                bringToFront: () => bringToFront(),
                cursor: "grabbing",
                cursorRestore: "",
                saveState: (rect) => {
                    if (storageKey && persistPos) saveRect(storageKey, rect);
                },
            });
        }

        // ── Resize ──────────────────────────────────────────────────────────
        if (resizable) {
            const minW = parseLen(minWidth, window.innerWidth) || 280;
            const minH = parseLen(minHeight, window.innerHeight) || 120;
            const maxW = parseLen(maxWidth, window.innerWidth) || Math.round(window.innerWidth * 0.9);
            const maxH = parseLen(maxHeight, window.innerHeight) || Math.round(window.innerHeight * 0.85);
            makeResizable(el, {
                handles: resizeHandles,
                anchor: "left-top",
                minWidth: minW,
                minHeight: minH,
                maxWidth: maxW,
                maxHeight: maxH,
                bringToFront: () => bringToFront(),
                onResize: (w, h) => {
                    if (typeof opts.onResize === "function") {
                        try { opts.onResize(w, h); } catch (e) { /* silencieux */ }
                    }
                },
                saveState: (rect) => {
                    if (storageKey && (persistSize || persistPos)) saveRect(storageKey, rect);
                },
            });
        }

        // ── Boutons du footer ───────────────────────────────────────────────
        if (footer) {
            buttons.forEach((btn) => {
                const b = document.createElement("button");
                b.className = "aih-dialog-btn";
                const t = btn.type || "primary";
                if (t === "danger") b.classList.add("aih-dialog-btn-danger");
                else if (t === "cancel") b.classList.add("aih-dialog-btn-cancel");
                else b.classList.add("aih-dialog-btn-primary");
                b.textContent = btn.text !== undefined ? btn.text : L("dialog.ok", null, "OK");
                b.addEventListener("click", async () => {
                    if (typeof btn.onClick === "function") {
                        try { btn.onClick(_controller); } catch (e) { /* silencieux */ }
                    }
                    if (typeof opts.guard === "function") {
                        setBusy(true);
                        let keepOpen = false;
                        try {
                            const r = await opts.guard(btn.value, _controller);
                            if (r === false) keepOpen = true;
                        } catch (err) {
                            if (err && err.keepOpen) keepOpen = true;
                            else console.error("[AIH.Dialog] guard error:", err);
                        }
                        setBusy(false);
                        if (keepOpen) return;
                    }
                    close(btn.value);
                });
                footer.appendChild(b);
            });
        }

        // ── setTitle / setContent / setBusy ─────────────────────────────────
        function setTitle(str) {
            titleEl.textContent = str;
        }
        function setContent(c) {
            body.innerHTML = "";
            opts.content = c;
            renderContent(body);
        }

        // ── Controller ──────────────────────────────────────────────────────
        let _onResolve = opts._onResolve || null;
        const _controller = {
            el: el,
            body: body,
            header: header,
            close: close,
            setTitle: setTitle,
            setContent: setContent,
            setBusy: setBusy,
            bringToFront: bringToFront,
            // alias de compatibilité v2
            modal: el,
            setBody: setContent,
        };

        if (busy) {
            _controller._busyMessage = titleEl;
        }

        // ── onOpen ──────────────────────────────────────────────────────────
        if (typeof opts.onOpen === "function") {
            try { opts.onOpen(_controller); } catch (e) { /* silencieux */ }
        }

        return _controller;
    }

    AIH.Dialog = { open: open };

    // ─── Helper : alert ──────────────────────────────────────────────────────
    function alert(title, message, type) {
        type = type || "info";
        const icons = {
            info: "ℹ️",
            success: "✅",
            error: "❌",
            warning: "⚠️",
        };
        return new Promise((resolve) => {
            const content = [
                '<div class="aih-dialog-icon aih-dialog-icon-' + type + '">' + (icons[type] || "ℹ️") + '</div>',
                '<div class="aih-dialog-message">' + (message || "") + '</div>',
                '<div class="aih-dialog-actions">',
                '<button class="aih-dialog-btn aih-dialog-btn-primary" data-aih-ok>' + escapeHtml(L("dialog.ok", null, "OK")) + '</button>',
                '</div>',
            ].join("");
            const ctrl = open({
                title: title || L("dialog.alert_title", null, ""),
                width: "320px",
                modal: true,
                resizable: false,
                draggable: false,
                content: content,
                _onResolve: (v) => resolve(v),
            });
            ctrl.el.querySelector("[data-aih-ok]").addEventListener("click", () => ctrl.close());
        });
    }

    // ─── Helper : confirm ────────────────────────────────────────────────────
    function confirm(title, message, opts) {
        opts = opts || {};
        const confirmText = opts.confirmText || L("dialog.confirm", null, "Confirmer");
        const cancelText = opts.cancelText || L("dialog.cancel", null, "Annuler");
        return new Promise((resolve) => {
            const content = [
                '<div class="aih-dialog-message">' + (message || "") + '</div>',
                '<div class="aih-dialog-actions">',
                '<button class="aih-dialog-btn aih-dialog-btn-cancel" data-aih-cancel>' + escapeHtml(cancelText) + '</button>',
                '<button class="aih-dialog-btn ' + (opts.danger ? "aih-dialog-btn-danger" : "aih-dialog-btn-primary") + '" data-aih-ok>' + escapeHtml(confirmText) + '</button>',
                '</div>',
            ].join("");
            const ctrl = open({
                title: title || L("dialog.confirm_title", null, ""),
                width: "360px",
                modal: true,
                resizable: false,
                draggable: false,
                guard: opts.guard,
                content: content,
                _onResolve: (v) => resolve(v === true),
            });
            ctrl.el.querySelector("[data-aih-cancel]").addEventListener("click", () => ctrl.close(false));
            ctrl.el.querySelector("[data-aih-ok]").addEventListener("click", async () => {
                if (typeof opts.guard === "function") {
                    ctrl.setBusy(true);
                    let keep = false;
                    try {
                        const r = await opts.guard(true);
                        if (r === false) keep = true;
                    } catch (e) {
                        if (e && e.keepOpen) keep = true;
                    }
                    ctrl.setBusy(false);
                    if (keep) return;
                }
                ctrl.close(true);
            });
        });
    }

    // ─── Helper : prompt ─────────────────────────────────────────────────────
    function prompt(title, message, placeholder, opts) {
        opts = opts || {};
        placeholder = placeholder || "";
        return new Promise((resolve) => {
            const uid = "_aih_prompt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
            const content = [
                '<div class="aih-dialog-message">' + (message || "") + '</div>',
                '<input class="aih-dialog-input" id="' + uid + '" type="text" placeholder="' + escapeHtml(placeholder) + '" />',
                '<div class="aih-dialog-actions">',
                '<button class="aih-dialog-btn aih-dialog-btn-cancel" data-aih-cancel>' + escapeHtml(opts.cancelText || L("dialog.cancel", null, "Annuler")) + '</button>',
                '<button class="aih-dialog-btn aih-dialog-btn-primary" data-aih-ok>' + escapeHtml(opts.confirmText || L("dialog.ok", null, "OK")) + '</button>',
                '</div>',
            ].join("");
            const ctrl = open({
                title: title || L("dialog.prompt_title", null, ""),
                width: "360px",
                modal: true,
                resizable: false,
                draggable: false,
                content: content,
                _onResolve: (v) => resolve(v),
            });
            const input = ctrl.el.querySelector("#" + uid);
            const submit = () => {
                const val = input.value.trim();
                ctrl.close(val || null);
            };
            ctrl.el.querySelector("[data-aih-cancel]").addEventListener("click", () => ctrl.close(null));
            ctrl.el.querySelector("[data-aih-ok]").addEventListener("click", submit);
            input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
            setTimeout(() => input.focus(), 50);
        });
    }

    // ─── Helper : choose ─────────────────────────────────────────────────────
    function choose(title, message, buttons, opts) {
        opts = opts || {};
        buttons = (buttons && buttons.length) ? buttons : [{ text: L("dialog.ok", null, "OK"), value: true, type: "primary" }];
        return new Promise((resolve) => {
            const content = [];
            if (isNode(message)) {
                // géré via content function ci-dessous
            } else {
                content.push('<div class="aih-dialog-message">' + (message || "") + '</div>');
            }
            const ctrl = open({
                title: title || "",
                width: opts.width || "360px",
                modal: true,
                resizable: opts.resizable !== undefined ? opts.resizable : false,
                draggable: opts.draggable !== undefined ? opts.draggable : false,
                guard: opts.guard,
                className: opts.className,
                content: (body) => {
                    if (isNode(message)) body.appendChild(message);
                    else body.innerHTML = content.join("");
                },
                buttons: buttons.map((b) => ({
                    text: b.text,
                    value: b.value,
                    type: b.type || "primary",
                    onClick: b.onClick,
                })),
                _onResolve: (v) => resolve(v),
            });
        });
    }

    // ─── Helper : busy ───────────────────────────────────────────────────────
    function busy(title, message) {
        let msgEl = null;
        const ctrl = open({
            title: title || L("dialog.progress_title", null, ""),
            width: "320px",
            modal: true,
            resizable: false,
            draggable: false,
            busy: true,
            closeOnEscape: false,
            closeOnOverlay: false,
            content: (body) => {
                const wrap = document.createElement("div");
                wrap.className = "aih-dialog-busy";
                const spin = document.createElement("span");
                spin.className = "aih-dialog-spinner";
                msgEl = document.createElement("div");
                msgEl.className = "aih-dialog-busy-msg";
                msgEl.textContent = message || "";
                wrap.appendChild(spin);
                wrap.appendChild(msgEl);
                body.appendChild(wrap);
            },
        });
        return {
            close: () => ctrl.close(),
            set: (m) => { if (msgEl) msgEl.textContent = m; },
        };
    }

    AIH.alert = alert;
    AIH.confirm = confirm;
    AIH.prompt = prompt;
    AIH.choose = choose;
    AIH.busy = busy;

    // Restaure les surcharges de thème persistées au chargement.
    try { Theme._restorePersisted(); } catch (e) { /* silencieux */ }

    // ══════════════════════════════════════════════════════════════════════
    // WRAPPERS DE COMPATIBILITÉ (aucun consommateur ne change)
    // ══════════════════════════════════════════════════════════════════════

    // ── Adapter controller AIH.Dialog → API v2 (modal/setBody) ──────────────
    function toV2Controller(ctrl) {
        return {
            modal: ctrl.el,
            el: ctrl.el,
            body: ctrl.body,
            header: ctrl.header,
            close: () => ctrl.close(),
            setTitle: ctrl.setTitle,
            setBody: ctrl.setContent,
            setContent: ctrl.setContent,
            bringToFront: ctrl.bringToFront,
        };
    }

    // aihOpenModalV2 → AIH.Dialog.open (retour compatible)
    window.aihOpenModalV2 = function (options) {
        options = options || {};
        const ctrl = open({
            title: options.title,
            content: options.content,
            width: options.width,
            height: options.height,
            minWidth: options.minWidth || options.min,
            minHeight: options.minHeight || options.min,
            maxWidth: options.maxWidth || options.max,
            maxHeight: options.maxHeight || options.max,
            resizable: options.resizable,
            draggable: options.draggable,
            modal: options.modal,
            closeOnEscape: options.closeOnEscape,
            storageKey: options.storageKey,
            persistSize: options.persistSize,
            persistPos: options.persistPos,
            className: options.className,
            onClose: options.onClose,
            onOpen: options.onOpen,
            onResize: options.onResize,
            bringToFrontOnClick: options.bringToFrontOnClick,
            zIndex: options.zIndex,
        });
        return toV2Controller(ctrl);
    };

    // aihShowAlert / aihShowConfirm / aihShowPrompt → AIH helpers
    window.aihShowAlert = function (title, message, type) {
        return alert(title, message, type);
    };
    window.aihShowConfirm = function (title, message) {
        return confirm(title, message);
    };
    window.aihShowPrompt = function (title, message, placeholder) {
        return prompt(title, message, placeholder);
    };

    // ── HolafPanelManager.createDialog → AIH.choose/alert ───────────────────
    // On enveloppe la méthode du module exporté (même référence d'objet), donc
    // les consommateurs qui importent HolafPanelManager profitent du wrapper
    // sans rien modifier. Retour Promise<value> compatible, ids/overlay gardés
    // par AIH.Dialog (className "holaf-dialog-inline").
    const _origCreateDialog = HolafPanelManager.createDialog;
    HolafPanelManager.createDialog = function (options) {
        options = options || {};
        const buttons = (options.buttons && options.buttons.length)
            ? options.buttons
            : [{ text: L("dialog.ok", null, "OK"), value: true, type: "confirm" }];
        const message = isNode(options.messageElement) ? options.messageElement : (options.message || "");
        const title = options.title || L("dialog.confirm_title", null, "Confirmation");

        // Cas simple : un seul bouton affirmatif → alert-style, résout true.
        if (buttons.length === 1 && buttons[0].value === true) {
            return alert(title, message).then(() => true);
        }

        const mapped = buttons.map((b) => {
            let type = "primary";
            if (b.type === "danger") type = "danger";
            else if (b.type === "cancel") type = "cancel";
            return { text: b.text, value: b.value, type: type, onClick: b.onClick };
        });
        return choose(title, message, mapped, { className: "holaf-dialog-inline" });
    };

    // ── window.HolafModal.show → AIH.choose (forward-compatible) ────────────
    // Semantique conservée : onConfirm() === false → garde ouvert (keep-open).
    // NB : le const HolafModal de holaf_main.js est module-local (inaccessible
    // sans modification). Ce wrapper est exposé globalement comme chemin
    // unifié pour tout futur consommateur ; les consommateurs actuels de
    // holaf_main.js utilisent leur const local et ne sont PAS modifiés.
    if (typeof window.HolafModal === "undefined") {
        window.HolafModal = {
            show(title, messageOrElement, onConfirm, confirmText, cancelText) {
                confirmText = confirmText || L("dialog.confirm", null, "Confirm");
                cancelText = cancelText || L("dialog.cancel", null, "Cancel");
                return choose(title, messageOrElement, [
                    { text: cancelText, value: false, type: "cancel" },
                    { text: confirmText, value: true, type: "primary" },
                ], {
                    guard: async (value) => {
                        if (value === true && typeof onConfirm === "function") {
                            // Retour false → garder ouvert (keep-open).
                            if (onConfirm() === false) return { keepOpen: true };
                        }
                        return true;
                    },
                }).then((ok) => ok === true);
            },
        };
    }

    // Garde une référence à la fonction d'origine accessible pour débug/défaillance.
    if (!window.AIH) window.AIH = {};
    window.AIH._origCreateDialog = _origCreateDialog;
})();
