import { makeDraggable, makeResizable } from "./holaf_window_utils.js";

/**
 * AIH Modal v2 — Système de fenêtres flottantes pour extensions ComfyUI.
 *
 * Préfixé 01_ pour garantir le chargement avant les autres aih_*.js.
 * Remplace l'ancien 00_aih_modal.js (supprimé).
 * et avant les autres aih_*.js (qui peuvent utiliser aihOpenModalV2).
 *
 * Migration depuis aihOpenModal (v1) :
 *   var m = aihOpenModal("Titre", "<p>HTML</p>", "440px");
 *   → var m = aihOpenModalV2({ title: "Titre", content: "<p>HTML</p>", width: "440px" });
 *
 * Fonctions exportées sur window :
 *   - aihOpenModalV2(options)   → { modal, body, header, close, setTitle, setBody, bringToFront }
 *   - aihShowAlert(title, msg, type)    → Promise<void>
 *   - aihShowConfirm(title, msg)        → Promise<boolean>
 *   - aihShowPrompt(title, msg, ph)     → Promise<string|null>
 *
 * Dépendances : aucune (standalone). CSS auto-injecté au premier chargement.
 */
(function () {
    "use strict";

    // ─── Injection CSS (une seule fois) ──────────────────────────────────────────
    var _cssInjected = false;
    function _aihModalInjectCSS() {
        if (_cssInjected) return;
        _cssInjected = true;
        var style = document.createElement("style");
        style.textContent = [
            /* Conteneur racine */
            ".aih-modal {",
            "  position: fixed;",
            "  display: flex;",
            "  flex-direction: column;",
            "  background: #2a2a2e;",
            "  border: 1px solid #444;",
            "  border-radius: 12px;",
            "  box-shadow: 0 16px 48px rgba(0,0,0,0.6);",
            "  overflow: hidden;",
            "  min-width: 280px;",
            "  min-height: 120px;",
            "}",
            /* Modale active (premier plan) */
            ".aih-modal.active {",
            "  border-color: #6366f1;",
            "  box-shadow: 0 16px 48px rgba(99,102,241,0.15);",
            "}",
            ".aih-modal.active .aih-modal-header {",
            "  background: #38383d;",
            "}",
            /* Header */
            ".aih-modal-header {",
            "  display: flex;",
            "  align-items: center;",
            "  padding: 10px 16px;",
            "  cursor: grab;",
            "  user-select: none;",
            "  border-bottom: 1px solid #444;",
            "  background: #2a2a2e;",
            "  flex-shrink: 0;",
            "}",
            ".aih-modal-header:active {",
            "  cursor: grabbing;",
            "}",
            /* Titre */
            ".aih-modal-title {",
            "  flex: 1;",
            "  font-size: 14px;",
            "  font-weight: 600;",
            "  color: #fff;",
            "  overflow: hidden;",
            "  text-overflow: ellipsis;",
            "  white-space: nowrap;",
            "}",
            /* Zone droite du header (boutons supplémentaires) */
            ".aih-modal-header-right {",
            "  display: flex;",
            "  align-items: center;",
            "  gap: 4px;",
            "  margin-right: 8px;",
            "}",
            /* Bouton fermer */
            ".aih-modal-close {",
            "  background: none;",
            "  border: none;",
            "  color: #999;",
            "  cursor: pointer;",
            "  font-size: 16px;",
            "  padding: 0 4px;",
            "  line-height: 1;",
            "  flex-shrink: 0;",
            "}",
            ".aih-modal-close:hover {",
            "  color: #f87171;",
            "}",
            /* Body */
            ".aih-modal-body {",
            "  flex: 1;",
            "  padding: 16px;",
            "  overflow-y: auto;",
            "  overflow-x: hidden;",
            "  color: #fff;",
            "  font-size: 13px;",
            "  line-height: 1.5;",
            "}",
            /* Poignées de redimensionnement */
            ".aih-modal-rh { position: absolute; z-index: 2; }",
            /* Coins */
            ".aih-modal-rh-nw { top: -4px; left: -4px; width: 12px; height: 12px; cursor: nw-resize; }",
            ".aih-modal-rh-ne { top: -4px; right: -4px; width: 12px; height: 12px; cursor: ne-resize; }",
            ".aih-modal-rh-sw { bottom: -4px; left: -4px; width: 12px; height: 12px; cursor: sw-resize; }",
            ".aih-modal-rh-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, #555 50%); border-radius: 0 0 12px 0; }",
            /* Côtés */
            ".aih-modal-rh-n { top: -4px; left: 8px; right: 8px; height: 8px; cursor: n-resize; }",
            ".aih-modal-rh-s { bottom: -4px; left: 8px; right: 8px; height: 8px; cursor: s-resize; }",
            ".aih-modal-rh-e { top: 8px; right: -4px; bottom: 8px; width: 8px; cursor: e-resize; }",
            ".aih-modal-rh-w { top: 8px; left: -4px; bottom: 8px; width: 8px; cursor: w-resize; }",
            /* Style pour les alertes / confirms */
            ".aih-modal-actions {",
            "  display: flex;",
            "  justify-content: flex-end;",
            "  gap: 8px;",
            "  margin-top: 16px;",
            "}",
            ".aih-modal-btn {",
            "  padding: 6px 16px;",
            "  border-radius: 6px;",
            "  border: 1px solid #555;",
            "  background: #3a3a3e;",
            "  color: #fff;",
            "  cursor: pointer;",
            "  font-size: 13px;",
            "  transition: background 0.15s, border-color 0.15s;",
            "}",
            ".aih-modal-btn:hover {",
            "  background: #4a4a4e;",
            "  border-color: #777;",
            "}",
            ".aih-modal-btn-primary {",
            "  background: #3b82f6;",
            "  border-color: #3b82f6;",
            "  color: #fff;",
            "}",
            ".aih-modal-btn-primary:hover {",
            "  background: #2563eb;",
            "  border-color: #2563eb;",
            "}",
            ".aih-modal-btn-danger {",
            "  background: #ef4444;",
            "  border-color: #ef4444;",
            "  color: #fff;",
            "}",
            ".aih-modal-btn-danger:hover {",
            "  background: #dc2626;",
            "  border-color: #dc2626;",
            "}",
            /* Alert types */
            ".aih-modal-icon {",
            "  font-size: 24px;",
            "  margin-bottom: 8px;",
            "  text-align: center;",
            "}",
            ".aih-modal-icon-info { color: #3b82f6; }",
            ".aih-modal-icon-success { color: #22c55e; }",
            ".aih-modal-icon-error { color: #ef4444; }",
            ".aih-modal-icon-warning { color: #f59e0b; }",
            /* Input dans prompt */
            ".aih-modal-input {",
            "  width: 100%;",
            "  padding: 8px 10px;",
            "  border-radius: 6px;",
            "  border: 1px solid #555;",
            "  background: #1e1e22;",
            "  color: #fff;",
            "  font-size: 13px;",
            "  outline: none;",
            "  box-sizing: border-box;",
            "  margin-top: 8px;",
            "}",
            ".aih-modal-input:focus {",
            "  border-color: #3b82f6;",
            "}",
            /* Message text */
            ".aih-modal-message {",
            "  color: #ccc;",
            "  font-size: 13px;",
            "  line-height: 1.5;",
            "}",
        ].join("\n");
        document.head.appendChild(style);
    }

    // ─── Z-index Stacking ────────────────────────────────────────────────────────
    var _BASE_Z = 90000;
    if (typeof window._aihModalZCounter === "undefined") {
        window._aihModalZCounter = 0;
    }

    function _aihModalNextZ() {
        window._aihModalZCounter += 1;
        if (window._aihModalZCounter > 50000) {
            // Reset : rescanner toutes les modales existantes
            var allModals = document.querySelectorAll(".aih-modal");
            window._aihModalZCounter = 0;
            for (var i = 0; i < allModals.length; i++) {
                window._aihModalZCounter += 1;
                allModals[i].style.zIndex = _BASE_Z + window._aihModalZCounter;
            }
        }
        return _BASE_Z + window._aihModalZCounter;
    }

    // ─── Persistance localStorage ────────────────────────────────────────────────
    var _STORAGE_KEY = "aih_modal_rects";
    var _saveTimeout = null;

    function _aihModalGetStore() {
        try {
            var raw = localStorage.getItem(_STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function _aihModalWriteStore(store) {
        try {
            localStorage.setItem(_STORAGE_KEY, JSON.stringify(store));
        } catch (e) {
            // localStorage plein ou désactivé — silencieux
        }
    }

    function _aihModalSaveRect(key, rect) {
        if (!key) return;
        if (_saveTimeout) clearTimeout(_saveTimeout);
        _saveTimeout = setTimeout(function () {
            _saveTimeout = null;
            var store = _aihModalGetStore();
            store[key] = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            _aihModalWriteStore(store);
        }, 300);
    }

    function _aihModalLoadRect(key) {
        if (!key) return null;
        var store = _aihModalGetStore();
        return store[key] || null;
    }

    function _aihModalRemoveRect(key) {
        if (!key) return;
        var store = _aihModalGetStore();
        if (store[key]) {
            delete store[key];
            _aihModalWriteStore(store);
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────
    function _parseCSSLength(val, viewportDim) {
        if (typeof val !== 'string') return parseInt(val) || 0;
        val = val.trim();
        if (val.endsWith('px')) return parseFloat(val);
        if (val.endsWith('vw')) return (parseFloat(val) / 100) * window.innerWidth;
        if (val.endsWith('vh')) return (parseFloat(val) / 100) * window.innerHeight;
        if (val.endsWith('%')) return (parseFloat(val) / 100) * viewportDim;
        return parseFloat(val) || 0;
    }

    function _isElement(obj) {
        return obj && typeof obj === "object" && obj.nodeType === 1;
    }

    function _clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    function _ensureInViewport(rect, modalWidth, modalHeight) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var margin = 20;
        // Ensure visible within viewport
        var left = _clamp(rect.left, margin, vw - modalWidth - margin);
        var top = _clamp(rect.top, margin, vh - modalHeight - margin);
        // If modal is larger than viewport, just center it
        if (modalWidth > vw - margin * 2) {
            left = margin;
        }
        if (modalHeight > vh - margin * 2) {
            top = margin;
        }
        return { left: left, top: top };
    }

    // ─── Fonction principale ─────────────────────────────────────────────────────
    window.aihOpenModalV2 = function (options) {
        if (!options) options = {};
        _aihModalInjectCSS();

        var title = options.title || "";
        var content = options.content || "";
        var width = options.width || "400px";
        var height = options.height || "auto";
        var minWidth = options.minWidth || "280px";
        var minHeight = options.minHeight || "120px";
        var maxWidth = options.maxWidth || "90vw";
        var maxHeight = options.maxHeight || "85vh";
        var storageKey = options.storageKey || null;
        var persistSize = !!options.persistSize;
        var persistPos = !!options.persistPos;
        var resizable = options.resizable !== false;
        var draggable = options.draggable !== false;
        var closeOnEscape = options.closeOnEscape !== false;
        var bringToFrontOnClick = options.bringToFrontOnClick !== false;
        var onClose = options.onClose || null;
        var onOpen = options.onOpen || null;
        var onResize = options.onResize || null;
        var className = options.className || "";

        // ── Construire le DOM ──────────────────────────────────────────────────
        var modal = document.createElement("div");
        modal.className = "aih-modal" + (className ? " " + className : "");
        modal.style.width = width;
        modal.style.height = height;
        modal.style.minWidth = minWidth;
        modal.style.minHeight = minHeight;
        modal.style.maxWidth = maxWidth;
        modal.style.maxHeight = maxHeight;
        modal.style.zIndex = _aihModalNextZ();
        // Appliquer la classe active (premier plan)
        // Retirer .active de toutes les modales existantes
        var allExisting = document.querySelectorAll(".aih-modal");
        for (var i = 0; i < allExisting.length; i++) {
            allExisting[i].classList.remove("active");
        }
        modal.classList.add("active");

        // Header
        var header = document.createElement("div");
        header.className = "aih-modal-header";

        var titleEl = document.createElement("span");
        titleEl.className = "aih-modal-title";
        titleEl.textContent = title;

        var headerRight = document.createElement("span");
        headerRight.className = "aih-modal-header-right";

        var closeBtn = document.createElement("button");
        closeBtn.className = "aih-modal-close";
        closeBtn.textContent = "✕";

        header.appendChild(titleEl);
        header.appendChild(headerRight);
        header.appendChild(closeBtn);

        // Body
        var body = document.createElement("div");
        body.className = "aih-modal-body";

        if (typeof content === "string") {
            body.innerHTML = content;
        } else if (_isElement(content)) {
            body.appendChild(content);
        }

        // Resize handles (8 directions)
        var resizeHandles = [];
        var handleConfigs = [
            { className: "aih-modal-rh-n", dir: "n" },
            { className: "aih-modal-rh-s", dir: "s" },
            { className: "aih-modal-rh-e", dir: "e" },
            { className: "aih-modal-rh-w", dir: "w" },
            { className: "aih-modal-rh-ne", dir: "ne" },
            { className: "aih-modal-rh-nw", dir: "nw" },
            { className: "aih-modal-rh-se", dir: "se" },
            { className: "aih-modal-rh-sw", dir: "sw" },
        ];
        handleConfigs.forEach(function(cfg) {
            var h = document.createElement("div");
            h.className = "aih-modal-rh " + cfg.className;
            h.dataset.dir = cfg.dir;
            modal.appendChild(h);
            resizeHandles.push(h);
        });

        modal.appendChild(header);
        modal.appendChild(body);
        document.body.appendChild(modal);

        // ── Restauration de la position/taille ────────────────────────────────
        var restored = false;
        if (storageKey) {
            var saved = _aihModalLoadRect(storageKey);
            if (saved) {
                var modalW = saved.width || parseInt(width);
                var modalH = saved.height || parseInt(height);
                if (persistSize) {
                    modal.style.width = modalW + "px";
                    modal.style.height = modalH + "px";
                }
                if (persistPos) {
                    var pos = _ensureInViewport(
                        { left: saved.left, top: saved.top },
                        (persistSize ? modalW : modal.offsetWidth),
                        (persistSize ? modalH : modal.offsetHeight)
                    );
                    modal.style.left = pos.left + "px";
                    modal.style.top = pos.top + "px";
                    restored = true;
                }
            }
        }

        if (!restored) {
            // Centrer par défaut
            var parsedW = parseInt(modal.style.width) || 400;
            var parsedH = parseInt(modal.style.height) || 300;
            modal.style.left = Math.max(20, (window.innerWidth - parsedW) / 2) + "px";
            modal.style.top = Math.max(20, (window.innerHeight - parsedH) / 3) + "px";
        }

        // ── Bring to front ────────────────────────────────────────────────────
        function bringToFront() {
            var newZ = _aihModalNextZ();
            modal.style.zIndex = newZ;
            // Retirer .active de toutes les modales
            var allModals = document.querySelectorAll(".aih-modal");
            for (var i = 0; i < allModals.length; i++) {
                allModals[i].classList.remove("active");
            }
            modal.classList.add("active");
        }

        if (bringToFrontOnClick) {
            modal.addEventListener("mousedown", bringToFront);
        }

        // ── Close ─────────────────────────────────────────────────────────────
        var _closed = false;

        function closeModal() {
            if (_closed) return;
            _closed = true;
            if (typeof onClose === "function") {
                try { onClose(); } catch (e) { /* silencieux */ }
            }
            // Sauvegarder la position finale avant fermeture
            if (storageKey && (persistSize || persistPos)) {
                var rect = modal.getBoundingClientRect();
                if (persistSize || persistPos) {
                    _aihModalSaveRect(storageKey, {
                        left: rect.left,
                        top: rect.top,
                        width: modal.offsetWidth,
                        height: modal.offsetHeight,
                    });
                }
            }
            modal.remove();
        }

        if (closeOnEscape) {
            function onKeydown(e) {
                if (e.key === "Escape" && !_closed) {
                    closeModal();
                }
            }
            document.addEventListener("keydown", onKeydown);
            // Nettoyage : retirer l'écouteur quand la modale est fermée
            var origRemove = closeModal;
            closeModal = function () {
                document.removeEventListener("keydown", onKeydown);
                origRemove();
            };
        }

        closeBtn.addEventListener("click", closeModal);

        // ── Drag ──────────────────────────────────────────────────────────────
        if (draggable) {
            makeDraggable(modal, {
                handle: header,
                anchor: "left-top",
                ignore: "button, input, select, textarea, a",
                isIgnored: function (e) {
                    return e.target === headerRight || headerRight.contains(e.target);
                },
                cursor: "grabbing",
                cursorRestore: "",
                saveState: function (rect) {
                    if (storageKey && persistPos) {
                        _aihModalSaveRect(storageKey, rect);
                    }
                },
            });
        }

        // ── Resize ────────────────────────────────────────────────────────────
        if (resizable) {
            var minW = _parseCSSLength(modal.style.minWidth, window.innerWidth) || 280;
            var minH = _parseCSSLength(modal.style.minHeight, window.innerHeight) || 120;
            var maxW = _parseCSSLength(modal.style.maxWidth, window.innerWidth) || Math.round(window.innerWidth * 0.9);
            var maxH = _parseCSSLength(modal.style.maxHeight, window.innerHeight) || Math.round(window.innerHeight * 0.85);

            makeResizable(modal, {
                handles: resizeHandles,
                anchor: "left-top",
                minWidth: minW,
                minHeight: minH,
                maxWidth: maxW,
                maxHeight: maxH,
                onResize: function (w, h) {
                    if (typeof onResize === "function") {
                        try { onResize(w, h); } catch (e) { /* silencieux */ }
                    }
                },
                saveState: function (rect) {
                    if (storageKey && (persistSize || persistPos)) {
                        _aihModalSaveRect(storageKey, rect);
                    }
                },
            });
        }

        // ── setTitle / setBody ───────────────────────────────────────────────
        function setTitle(str) {
            titleEl.textContent = str;
        }

        function setBody(html) {
            body.innerHTML = "";
            if (typeof html === "string") {
                body.innerHTML = html;
            } else if (_isElement(html)) {
                body.appendChild(html);
            }
        }

        // ── Callback onOpen ────────────────────────────────────────────────────
        if (typeof onOpen === "function") {
            try { onOpen(); } catch (e) { /* silencieux */ }
        }

        // ── Return API ─────────────────────────────────────────────────────────
        return {
            modal: modal,
            body: body,
            header: header,
            close: function () {
                closeModal();
            },
            setTitle: setTitle,
            setBody: setBody,
            bringToFront: bringToFront,
        };
    };

    // ─── aihShowAlert ───────────────────────────────────────────────────────────
    window.aihShowAlert = function (title, message, type) {
        type = type || "info";
        var icons = {
            info: "ℹ️",
            success: "✅",
            error: "❌",
            warning: "⚠️",
        };
        return new Promise(function (resolve) {
            var m = window.aihOpenModalV2({
                title: title || "",
                width: "320px",
                minWidth: "280px",
                minHeight: "100px",
                resizable: false,
                storageKey: null,
                closeOnEscape: true,
                content: [
                    '<div class="aih-modal-icon aih-modal-icon-' + type + '">' + (icons[type] || "ℹ️") + '</div>',
                    '<div class="aih-modal-message">' + (message || "") + '</div>',
                    '<div class="aih-modal-actions">',
                    '<button class="aih-modal-btn aih-modal-btn-primary" id="aih-alert-ok">OK</button>',
                    '</div>',
                ].join(""),
                onClose: function () {
                    resolve();
                },
            });
            document.getElementById("aih-alert-ok").addEventListener("click", function () {
                m.close();
            });
        });
    };

    // ─── aihShowConfirm ─────────────────────────────────────────────────────────
    window.aihShowConfirm = function (title, message) {
        return new Promise(function (resolve) {
            var m = window.aihOpenModalV2({
                title: title || "",
                width: "360px",
                minWidth: "300px",
                minHeight: "100px",
                resizable: false,
                storageKey: null,
                closeOnEscape: true,
                content: [
                    '<div class="aih-modal-message">' + (message || "") + '</div>',
                    '<div class="aih-modal-actions">',
                    '<button class="aih-modal-btn" id="aih-confirm-cancel">Annuler</button>',
                    '<button class="aih-modal-btn aih-modal-btn-primary" id="aih-confirm-ok">Confirmer</button>',
                    '</div>',
                ].join(""),
                onClose: function () {
                    resolve(false);
                },
            });
            document.getElementById("aih-confirm-cancel").addEventListener("click", function () {
                resolve(false);
                m.close();
            });
            document.getElementById("aih-confirm-ok").addEventListener("click", function () {
                resolve(true);
                m.close();
            });
        });
    };

    // ─── aihShowPrompt ─────────────────────────────────────────────────────────
    window.aihShowPrompt = function (title, message, placeholder) {
        placeholder = placeholder || "";
        return new Promise(function (resolve) {
            var uid = "_aih_prompt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
            var m = window.aihOpenModalV2({
                title: title || "",
                width: "360px",
                minWidth: "300px",
                minHeight: "100px",
                resizable: false,
                storageKey: null,
                closeOnEscape: true,
                content: [
                    '<div class="aih-modal-message">' + (message || "") + '</div>',
                    '<input class="aih-modal-input" id="' + uid + '" type="text" placeholder="' + placeholder + '" />',
                    '<div class="aih-modal-actions">',
                    '<button class="aih-modal-btn" id="' + uid + '-cancel">Annuler</button>',
                    '<button class="aih-modal-btn aih-modal-btn-primary" id="' + uid + '-ok">OK</button>',
                    '</div>',
                ].join(""),
                onClose: function () {
                    resolve(null);
                },
            });
            var input = document.getElementById(uid);

            function submit() {
                var val = input.value.trim();
                resolve(val || null);
                m.close();
            }

            document.getElementById(uid + "-cancel").addEventListener("click", function () {
                resolve(null);
                m.close();
            });
            document.getElementById(uid + "-ok").addEventListener("click", submit);

            // Enter dans l'input → submit
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    submit();
                }
            });

            // Focus automatique sur l'input
            setTimeout(function () { input.focus(); }, 50);
        });
    };

})();
