/**
 * AIH — Menu helpers (portage de AI-Helper/web/js/aih_menu.js).
 *
 * Note pack fusionné : ce fichier ne crée PLUS son propre bouton de menu
 * (l'ancien bouton indigo « AI Helper ▾ » est remplacé par le menu orange
 * Holaf Utilities). Il expose window.AIHMenu (pattern merge sûr) et
 * holaf_main.js intègre ses entrées dans le dropdown existant.
 *
 * Contenu porté :
 *   - openWebpage / openWorkflows / openModels : raccourcis du menu source.
 *   - openMembers        : modale draggable aihOpenModalV2 (key
 *                          "aih-modal-members"), GET {serverUrl}/api/members.
 *   - openSettings       : ouvre la fenêtre Settings Holaf unifiée (panel
 *                          #holaf-settings-panel de js/holaf_settings_manager.js)
 *                          sur l'onglet AIH demandé. Les onglets eux-mêmes
 *                          (« Compte » : GET/POST /aih/credentials + migration
 *                          automatique depuis localStorage ; « Provider LLM » :
 *                          CRUD distant api/presets + list-models + mode
 *                          Client-side) sont rendus par renderAccountTab() /
 *                          renderProviderTab(), appelés par le gestionnaire
 *                          Settings Holaf comme ses propres onglets.
 *   - openUpdate         : modale spinner + log git de POST /aih/update ;
 *                          si updated → confirmation utilisateur puis
 *                          redémarrage via le flux COMMUN du menu
 *                          (window.holaf.startRestartFlow de holaf_main.js :
 *                          POST /holaf/utilities/restart + compteur à rebours
 *                          + reconnexion). C'est l'unique façon de redémarrer.
 *                          Si ce flux commun n'est pas disponible, fallback
 *                          propre (toast + reload manuel) — pas de double
 *                          polling/reload local.
 *   - checkServerStatus  : GET {serverUrl}/api/stats + /api/auth/me en
 *                          parallèle (timeout 5 s, Bearer apiKey) → ligne de
 *                          statut du pied de menu.
 *   - getBlobbyState / toggleBlobby : état du Blobby Companion pour la ligne
 *                          toggle du menu.
 *
 * Dépendances : 01_aih_modal_v2.js (aihOpenModalV2, aihShowAlert,
 * aihShowConfirm, aihShowPrompt), 03_aih_shared.js (localStorage
 * "AIH_config", même mécanique que window.AIH), blobby_companion.js
 * (window.BlobbyCompanion). Endpoints locaux : /aih/update,
 * /aih/credentials, /holaf/utilities/restart (cf. aih/routes.py).
 */
import "./aih_dialog.js";
(function () {
    "use strict";

    const STORAGE_KEY = "AIH_config";

    function getConfig() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
    }

    function setConfig(cfg) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    }

    function getApp() {
        return window.app || window.comfyAPI?.app?.app || null;
    }

    // ── Raccourcis du menu ───────────────────────────────────────────────

    function openWebpage() {
        // Aucune URL par défaut codée en dur : si le serveur n'est pas
        // configuré, on invite l'utilisateur à le faire dans Settings.
        const baseUrl = (getConfig().serverUrl || "").replace(/\/+$/, "");
        if (!baseUrl) {
            const msg = "Aucune URL de serveur AIH configurée. Renseigne-la dans Holaf Utilities ▸ Settings ▸ onglet « AIH · Compte » (champ « URL du serveur »).";
            if (window.holaf?.toastManager) {
                window.holaf.toastManager.show({ message: msg, type: "info", duration: 8000 });
            } else if (window.aihShowAlert) {
                window.aihShowAlert("Serveur non configuré", msg, "info");
            }
            return;
        }
        window.open(baseUrl, "_blank");
    }

    function openWorkflows() {
        if (window.openWorkflowManager) {
            window.openWorkflowManager();
        } else {
            if (window.aihShowAlert) window.aihShowAlert("Info", "Workflow Sharing pas encore chargé. Réessaie.", "info");
        }
    }

    function openModels() {
        if (window.openModelBrowser) {
            window.openModelBrowser();
        } else {
            if (window.aihShowAlert) window.aihShowAlert("Info", "Model Browser pas encore chargé.", "info");
        }
    }

    // ── Blobby Companion (état pour la ligne toggle du menu) ────────────

    function getBlobbyState() {
        try {
            return !!(window.BlobbyCompanion && window.BlobbyCompanion.isActive && window.BlobbyCompanion.isActive());
        } catch { return false; }
    }

    function toggleBlobby() {
        if (window.BlobbyCompanion && window.BlobbyCompanion.toggle) {
            return !!window.BlobbyCompanion.toggle();
        }
        return getBlobbyState();
    }

    function openChat() {
        if (window.BlobbyCompanion && window.BlobbyCompanion.openChat) {
            window.BlobbyCompanion.openChat();
        }
    }

    // ── Membres ──────────────────────────────────────────────────────────

    async function openMembers() {
        const cfg = getConfig();
        const baseUrl = (cfg.serverUrl || "").replace(/\/+$/, "");
        const apiKey = cfg.apiKey || "";

        const modal = window.aihOpenModalV2({
            title: "👥 Membres",
            content: "<p style='color:#888;font-size:12px;'>Chargement...</p>",
            width: "560px",
            height: "auto",
            minHeight: "200px",
            storageKey: "aih-modal-members",
            persistSize: true,
            persistPos: true
        });

        // Comportement dégradé : pas d'URL configurée → invitation au lieu
        // d'une requête vers une destination arbitraire.
        if (!baseUrl) {
            modal.body.innerHTML = `<div style="padding:16px;color:#facc15;font-size:12px;line-height:1.6;">⚠️ Aucune URL de serveur AIH configurée.<br>Renseigne-la dans Holaf Utilities ▸ Settings ▸ onglet « AIH · Compte ».</div>`;
            return;
        }

        try {
            const headers = {};
            if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
            const resp = await fetch(`${baseUrl}/api/members`, { method: "GET", headers });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const members = await resp.json();

            // Trier : admin en premier, puis kw_editor, puis par nom
            members.sort((a, b) => {
                const rank = (r) => r === "admin" ? 0 : r === "kw_editor" ? 1 : 2;
                const diff = rank(a.role) - rank(b.role);
                if (diff !== 0) return diff;
                return (a.display_name || a.username || "").localeCompare(b.display_name || b.username || "");
            });

            let html = `<table style="width:100%;border-collapse:collapse;font-size:12px;color:#ccc;">
                <thead>
                    <tr style="border-bottom:1px solid #555;">
                        <th style="text-align:left;padding:6px 8px;color:#888;font-weight:600;">Membre</th>
                        <th style="text-align:center;padding:6px 4px;color:#888;font-weight:600;">Rôle</th>
                        <th style="text-align:center;padding:6px 4px;color:#888;font-weight:600;">Filtres</th>
                        <th style="text-align:center;padding:6px 4px;color:#888;font-weight:600;">Prompts</th>
                    </tr>
                </thead><tbody>`;

            for (const m of members) {
                const name = m.display_name || m.username || m.id?.substring(0, 8) || "?";
                const avatarUrl = m.avatar_url || (m.avatar && m.id ? `https://cdn.discordapp.com/avatars/${m.id}/${m.avatar}.png?size=32` : null);
                const roleBadge = m.role === "admin"
                    ? '<span style="background:var(--aih-accent, #D8700D);color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">admin</span>'
                    : m.role === "kw_editor"
                      ? '<span style="background:#d97706;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">kw_editor</span>'
                      : '<span style="color:#888;font-size:11px;">membre</span>';

                html += `<tr style="border-bottom:1px solid #333;">
                    <td style="padding:6px 8px;display:flex;align-items:center;gap:8px;">
                        ${avatarUrl ? `<img src="${avatarUrl}" style="width:24px;height:24px;border-radius:50%;flex-shrink:0;">` : '<span style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;background:#444;border-radius:50%;font-size:11px;flex-shrink:0;">👤</span>'}
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                    </td>
                    <td style="text-align:center;padding:6px 4px;">${roleBadge}</td>
                    <td style="text-align:center;padding:6px 4px;">${m.filter_count ?? 0}</td>
                    <td style="text-align:center;padding:6px 4px;">${m.prompt_count ?? 0}</td>
                </tr>`;
            }

            html += "</tbody></table>";
            modal.body.innerHTML = html;
        } catch (err) {
            modal.body.innerHTML = `<p style="color:#f87171;font-size:12px;">Erreur : ${err.message}</p>`;
        }
    }

    // ── Statut serveur ───────────────────────────────────────────────────

    async function checkServerStatus(el) {
        const cfg = getConfig();
        const baseUrl = (cfg.serverUrl || "").replace(/\/+$/, "");
        const apiKey = cfg.apiKey || "";

        // Serveur non configuré : état explicite au lieu d'une sonde vers
        // une destination arbitraire.
        if (!baseUrl) {
            el.innerHTML = "";
            el.style.display = "flex";
            el.style.alignItems = "center";
            el.textContent = "⚪  Serveur AIH non configuré (Settings ▸ AIH · Compte)";
            el.style.color = "#888";
            return;
        }

        try {
            const headers = {};
            if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

            // Compat : AbortSignal.timeout() n'existe pas dans tous les navigateurs
            const makeTimeoutSignal = (ms) => {
                if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
                    return AbortSignal.timeout(ms);
                }
                const ctrl = new AbortController();
                setTimeout(() => ctrl.abort(), ms);
                return ctrl.signal;
            };
            const timeoutSignal = makeTimeoutSignal(5000);

            const [statsResp, meResp] = await Promise.all([
                fetch(`${baseUrl}/api/stats`, { method: "GET", headers, signal: timeoutSignal }).catch(() => null),
                fetch(`${baseUrl}/api/auth/me`, { method: "GET", headers, signal: timeoutSignal }).catch(() => null),
            ]);

            const serverOk = statsResp && statsResp.ok;
            let user = null;
            if (meResp && meResp.ok) {
                try { user = await meResp.json(); } catch {}
            }

            el.innerHTML = "";
            el.style.display = "flex";
            el.style.alignItems = "center";
            el.style.gap = "6px";

            if (user && (user.display_name || user.username)) {
                const name = user.display_name || user.username || "?";
                const avatarUrl = user.avatar_url || (user.avatar && user.id ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null);

                const dot = document.createElement("span");
                dot.textContent = "🟢";
                dot.style.cssText = "font-size:11px;line-height:1;flex-shrink:0;";
                el.appendChild(dot);

                const nameSpan = document.createElement("span");
                nameSpan.textContent = name;
                nameSpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                el.appendChild(nameSpan);

                if (avatarUrl) {
                    const img = document.createElement("img");
                    img.src = avatarUrl;
                    img.style.cssText = "width:22px;height:22px;border-radius:50%;flex-shrink:0;";
                    el.appendChild(img);
                }

                el.style.color = "#4ade80";
            } else if (serverOk) {
                el.textContent = "🟢  Serveur en ligne (non connecté)";
                el.style.color = "#4ade80";
            } else if (statsResp) {
                el.textContent = "🟡  Serveur répond (HTTP " + statsResp.status + ")";
                el.style.color = "#facc15";
            } else {
                el.textContent = "🔴  Serveur hors ligne";
                el.style.color = "#f87171";
            }
        } catch {
            el.textContent = "🔴  Serveur hors ligne";
            el.style.color = "#f87171";
        }
    }

    // ── Paramètres (délégué à la fenêtre Settings Holaf unifiée) ─────────
    // Les onglets « Compte » et « Provider LLM » vivent désormais dans la
    // fenêtre Settings de Holaf Utilities (panel #holaf-settings-panel,
    // js/holaf_settings_manager.js), au même niveau que ses onglets natifs.
    // Ce gestionnaire appelle directement renderCompteTab() /
    // renderProvidersTab() exposés plus bas sur window.AIHMenu ; ici, on se
    // contente d'ouvrir la fenêtre sur l'onglet AIH demandé (aucune logique
    // de rendu dupliquée).

    function openSettings(tabId = "aih-account") {
        const mgr = getApp()?.holafSettingsManager;
        if (mgr && typeof mgr.show === "function") {
            mgr.show({ tab: tabId });
            return;
        }
        // Fallback : le panneau Settings Holaf n'est pas disponible
        // (holaf_settings_manager.js pas encore chargé).
        const msg = "Le panneau Settings Holaf n'est pas disponible. Ouvre Holaf Utilities ▸ Settings pour configurer le compte AIH.";
        if (window.holaf?.toastManager) {
            window.holaf.toastManager.show({ message: msg, type: "info", duration: 6000 });
        } else if (window.aihShowAlert) {
            window.aihShowAlert("Info", msg, "info");
        }
    }

    // ── Helpers partagés ─────────────────────────────────────────────────

    const _aihStyle = {
        input: "width:100%; padding:6px 10px; border-radius:4px; border:1px solid #555; background:#1a1a1e; color:#fff; font-size:12px; box-sizing:border-box;",
        label: "display:block; margin-bottom:3px; font-size:11px; color:#aaa;",
        btn: (bg = "#ff8c00") => `padding:6px 12px; border-radius:4px; border:none; background:${bg}; color:white; cursor:pointer; font-size:12px; font-weight:600;`,
        btnSecondary: "padding:6px 12px; border-radius:4px; border:1px solid #555; background:transparent; color:#ccc; cursor:pointer; font-size:12px;",
        section: "padding:12px; background:#1a1a1e; border:1px solid #333; border-radius:6px; margin-bottom:12px;",
    };

    async function _aihFetchApi(path, opts = {}) {
        const cfg = getConfig();
        // baseUrl pointe vers le backend AIH distant configuré (cfg.serverUrl,
        // renseigné dans Settings ▸ AIH · Compte) ; /api/* est préfixé
        // automatiquement. Sans URL configurée : erreur explicite.
        const baseUrl = (cfg.serverUrl || "").replace(/\/+$/, "");
        if (!baseUrl) {
            throw new Error("Serveur AIH non configuré — Holaf Utilities ▸ Settings ▸ onglet « AIH · Compte »");
        }
        const headers = { "Content-Type": "application/json" };
        if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
        // path peut deja commencer par /api/ (auquel cas on l'utilise tel quel) ou non
        const cleanPath = path.replace(/^\/+/, "");
        const finalPath = cleanPath.startsWith("api/") ? cleanPath : "api/" + cleanPath;
        const resp = await fetch(`${baseUrl}/${finalPath}`, {
            ...opts,
            headers: { ...headers, ...(opts.headers || {}) },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => "");
            let msg = `HTTP ${resp.status}`;
            try { const j = JSON.parse(t); if (j.error) msg = j.error; } catch {}
            throw new Error(msg);
        }
        return resp.json().catch(() => ({}));
    }

    function mkBtn(text, css, onClick) {
        const b = document.createElement("button");
        b.textContent = text;
        b.style.cssText = typeof css === "string" ? css : "";
        b.onclick = onClick;
        return b;
    }

    // ── Onglet Compte (URL serveur + clé API) ────────────────────────────
    // Renderer autonome : appelé par la fenêtre Settings Holaf
    // (holaf_settings_manager.js, onglet « AIH · Compte »). Le backend local
    // porté expose GET/POST /aih/credentials qui gèrent le fichier
    // user/default/aih/credentials.json (cf. aih/routes.py groupe 1).

    function renderCompteTab(container) {
        const cfg = getConfig();
        container.innerHTML = "";
        const section = document.createElement("div");
        section.style.cssText = _aihStyle.section;

        // Status du fichier de credentials
        const status = document.createElement("p");
        status.style.cssText = "margin:0 0 12px; font-size:11px; color:#888;";
        status.textContent = "Chargement...";
        section.appendChild(status);

        const lbl1 = document.createElement("label");
        lbl1.textContent = "URL du serveur";
        lbl1.style.cssText = _aihStyle.label;
        section.appendChild(lbl1);

        const inputUrl = document.createElement("input");
        inputUrl.type = "url";
        inputUrl.value = cfg.serverUrl || "";
        inputUrl.placeholder = "https://mon-serveur-aih.example.com";
        inputUrl.style.cssText = _aihStyle.input;
        inputUrl.style.marginBottom = "12px";
        section.appendChild(inputUrl);

        const lbl2 = document.createElement("label");
        lbl2.textContent = "Clé API";
        lbl2.style.cssText = _aihStyle.label;
        section.appendChild(lbl2);

        const inputKey = document.createElement("input");
        inputKey.type = "password";
        inputKey.value = cfg.apiKey || "";
        inputKey.style.cssText = _aihStyle.input;
        inputKey.style.marginBottom = "4px";
        section.appendChild(inputKey);

        const hint = document.createElement("p");
        hint.textContent = "Générez votre clé sur le site web → Settings → Clé API";
        Object.assign(hint.style, { margin: "0 0 12px", fontSize: "11px", color: "#888" });
        section.appendChild(hint);

        const saveBtn = mkBtn("Sauvegarder", _aihStyle.btn(), async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = "...";
            try {
                const resp = await fetch("/aih/credentials", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        api_key: inputKey.value.trim(),
                        server_url: inputUrl.value.trim(),
                    }),
                });
                const data = await resp.json();
                if (data.status === "ok") {
                    // Mettre a jour aussi localStorage pour le cache UI
                    setConfig({
                        serverUrl: inputUrl.value.trim(),
                        apiKey: inputKey.value.trim(),
                    });
                    status.textContent = `✓ Sauvegardé dans ${data.path}`;
                    status.style.color = "#4ade80";
                    saveBtn.textContent = "✓ Sauvegardé";
                } else {
                    status.textContent = `✗ Erreur : ${data.message || "inconnue"}`;
                    status.style.color = "#ef4444";
                    saveBtn.textContent = "Erreur";
                }
            } catch (err) {
                status.textContent = `✗ Erreur réseau : ${err.message}`;
                status.style.color = "#ef4444";
                saveBtn.textContent = "Erreur";
            } finally {
                saveBtn.disabled = false;
                setTimeout(() => { saveBtn.textContent = "Sauvegarder"; }, 2000);
            }
        });
        section.appendChild(saveBtn);
        container.appendChild(section);

        // Charger les credentials depuis le fichier (au cas ou localStorage est vide)
        fetch("/aih/credentials")
            .then(r => r.json())
            .then(data => {
                if (data.status === "ok") {
                    if (data.server_url) inputUrl.value = data.server_url;
                    if (data.api_key) inputKey.value = data.api_key;
                    if (data.path) {
                        status.textContent = `Fichier : ${data.path}`;
                        status.style.color = "#888";
                    }
                    // Auto-migration : si le fichier n'existe pas mais que
                    // localStorage a une cle, on migre silencieusement.
                    if (!data.exists && cfg.apiKey) {
                        status.textContent = "⟳ Migration depuis localStorage...";
                        status.style.color = "#facc15";
                        return fetch("/aih/credentials", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                api_key: cfg.apiKey || "",
                                server_url: cfg.serverUrl || "",
                            }),
                        }).then(r => r.json()).then(saveData => {
                            if (saveData.status === "ok") {
                                status.textContent = `✓ Migré depuis localStorage vers ${saveData.path}`;
                                status.style.color = "#4ade80";
                            } else {
                                status.textContent = `✗ Échec migration : ${saveData.message || "inconnu"}`;
                                status.style.color = "#ef4444";
                            }
                        });
                    }
                } else {
                    status.textContent = `✗ Impossible de lire le fichier : ${data.message || "inconnu"}`;
                    status.style.color = "#ef4444";
                }
            })
            .catch(err => {
                status.textContent = `✗ Erreur de chargement : ${err.message}`;
                status.style.color = "#ef4444";
            });
    }

    // ── Onglet Provider LLM ──────────────────────────────────────────────
    // CRUD presets LLM sur le serveur distant configuré (cfg.serverUrl),
    // appelé directement depuis le navigateur avec Bearer apiKey :
    // GET/POST api/presets, PUT/DELETE api/presets/{id},
    // POST api/presets/list-models (proxy backend) ou appel direct
    // navigateur {base_url}/models en mode Client-side.
    // Renderer autonome appelé par la fenêtre Settings Holaf
    // (holaf_settings_manager.js, onglet « AIH · Provider LLM »).

    async function renderProvidersTab(container) {
        container.innerHTML = "";

        // Section : liste des presets existants
        const listSection = document.createElement("div");
        listSection.style.cssText = _aihStyle.section;
        const listTitle = document.createElement("h3");
        listTitle.textContent = "MES PRESETS";
        Object.assign(listTitle.style, { margin: "0 0 8px", fontSize: "11px", color: "#888", fontWeight: "600" });
        listSection.appendChild(listTitle);
        container.appendChild(listSection);

        async function reloadPresets() {
            const presets = await _aihFetchApi("presets");
            listSection.innerHTML = "";
            const t = document.createElement("h3");
            t.textContent = "MES PRESETS";
            Object.assign(t.style, { margin: "0 0 8px", fontSize: "11px", color: "#888", fontWeight: "600" });
            listSection.appendChild(t);
            if (presets.length === 0) {
                const empty = document.createElement("p");
                empty.textContent = "Aucun preset. Créez-en un ci-dessous.";
                Object.assign(empty.style, { color: "#888", fontSize: "12px", margin: "0" });
                listSection.appendChild(empty);
                return;
            }
            presets.forEach(p => {
                const row = document.createElement("div");
                Object.assign(row.style, {
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 8px", borderBottom: "1px solid #2a2a2e", fontSize: "12px",
                });
                const left = document.createElement("div");
                const scope = p.is_global ? "global" : (p.owner_name ? `(${p.owner_name})` : "personnel");
                const clientBadge = p.is_client_side ? " <span style='color:#f59e0b;'>🖥️</span>" : "";
                left.innerHTML = `<strong style='color:#fff;'>${p.name}</strong> <span style='color:#888;'>[${scope}]</span> ${clientBadge}<br><span style='color:#888;font-size:10px;'>${p.model} @ ${p.base_url}</span>`;
                const actions = document.createElement("div");
                Object.assign(actions.style, { display: "flex", gap: "4px" });
                const editBtn = mkBtn("Edit", _aihStyle.btnSecondary, () => fillForm(p));
                const dupBtn = mkBtn("Dup", _aihStyle.btnSecondary, async () => {
                    const body = { ...p };
                    delete body.id;
                    body.name = p.name + " (copie)";
                    try {
                        await _aihFetchApi("presets", { method: "POST", body });
                        reloadPresets();
                    } catch (e) { await window.aihShowAlert("Erreur", "Erreur duplication : " + e.message, "error"); }
                });
                const delBtn = mkBtn("Del", "padding:6px 12px;border-radius:4px;border:none;background:#7f1d1d;color:white;cursor:pointer;font-size:12px;", async () => {
                    var ok = await window.aihShowConfirm("Supprimer", "Supprimer " + p.name + " ?"); if (!ok) return;
                    try {
                        await _aihFetchApi(`presets/${p.id}`, { method: "DELETE" });
                        reloadPresets();
                    } catch (e) { await window.aihShowAlert("Erreur", "Erreur suppression : " + e.message, "error"); }
                });
                actions.append(editBtn, dupBtn, delBtn);
                row.append(left, actions);
                listSection.appendChild(row);
            });
        }
        await reloadPresets();

        // Section : formulaire create/edit
        const form = document.createElement("div");
        form.style.cssText = _aihStyle.section;

        const editingId = { value: null };

        const formTitle = document.createElement("h3");
        formTitle.id = "aih-preset-form-title";
        formTitle.textContent = "Nouveau preset";
        Object.assign(formTitle.style, { margin: "0 0 10px", fontSize: "11px", color: "#888", fontWeight: "600" });
        form.appendChild(formTitle);

        const mkField = (label, type = "text", value = "", placeholder = "") => {
            const wrap = document.createElement("div");
            wrap.style.cssText = "margin-bottom:8px;";
            const l = document.createElement("label");
            l.textContent = label;
            l.style.cssText = _aihStyle.label;
            wrap.appendChild(l);
            const input = document.createElement("input");
            input.type = type;
            input.value = value;
            input.placeholder = placeholder;
            input.style.cssText = _aihStyle.input;
            wrap.appendChild(input);
            return { wrap, input };
        };

        const fName = mkField("Nom du preset", "text", "", "");
        form.appendChild(fName.wrap);

        const fUrl = mkField("URL du serveur", "url", "", "http://localhost:11434/v1");
        form.appendChild(fUrl.wrap);

        const fKey = mkField("API Key (optionnel)", "password", "", "");
        form.appendChild(fKey.wrap);

        // Modele + bouton Lister
        const modelRow = document.createElement("div");
        modelRow.style.cssText = "display:flex; gap:6px; margin-bottom:8px; align-items:flex-end;";
        const fModelWrap = document.createElement("div");
        fModelWrap.style.cssText = "flex:1;";
        const lblModel = document.createElement("label");
        lblModel.textContent = "Modele";
        lblModel.style.cssText = _aihStyle.label;
        fModelWrap.appendChild(lblModel);
        const fModel = document.createElement("input");
        fModel.type = "text";
        fModel.placeholder = "llama3";
        fModel.style.cssText = _aihStyle.input;
        fModelWrap.appendChild(fModel);
        modelRow.appendChild(fModelWrap);

        const listModelsBtn = mkBtn("Lister", "padding:6px 10px;border-radius:4px;border:1px solid #ff8c00;background:transparent;color:#ff8c00;cursor:pointer;font-size:11px;flex:0 0 auto;height:28px;");
        listModelsBtn.onclick = async () => {
            const url = fUrl.input.value.trim();
            if (!url) { await window.aihShowAlert("Info", "Saisis l'URL d'abord", "info"); return; }
            try {
                let models;
                const isClient = fClientInput.checked;
                if (isClient) {
                    // Appel direct navigateur → serveur LLM
                    const headers = { "Content-Type": "application/json" };
                    const k = fKey.input.value.trim();
                    if (k) headers["Authorization"] = "Bearer " + k;
                    const r = await fetch(url.replace(/\/+$/, "") + "/models", { headers });
                    if (!r.ok) throw new Error("HTTP " + r.status);
                    const data = await r.json();
                    const raw = (data && data.data) || (data && data.models) || [];
                    models = raw.map(m => typeof m === "string" ? { id: m } : { id: m.id || m.name || "" });
                } else {
                    // Backend proxy
                    const resp = await _aihFetchApi("presets/list-models", {
                        method: "POST",
                        body: { base_url: url, api_key: fKey.input.value.trim() },
                    });
                    models = resp;
                }
                // Proposer un select inline pour choisir
                var choice = await window.aihShowPrompt("Choisir un modèle", "Modèles trouvés :\n" + models.map(m => "- " + m.id).join("\n") + "\n\nColle l'ID du modèle désiré :", models[0]?.id || "");
                if (choice) fModel.value = choice.trim();
            } catch (e) {
                await window.aihShowAlert("Erreur", "Erreur listage modèles : " + e.message, "error");
            }
        };
        modelRow.appendChild(listModelsBtn);
        form.appendChild(modelRow);

        // Checkboxes
        const checks = document.createElement("div");
        checks.style.cssText = "display:flex;gap:14px;margin-bottom:10px;";
        const mkCheck = (label, initial = false) => {
            const w = document.createElement("label");
            w.style.cssText = "display:flex;align-items:center;gap:5px;font-size:12px;color:#ccc;cursor:pointer;";
            const i = document.createElement("input");
            i.type = "checkbox";
            i.checked = initial;
            w.appendChild(i);
            w.appendChild(document.createTextNode(label));
            return { wrap: w, input: i };
        };
        const fGlobal = mkCheck("Global (visible par tous)", false);
        const fClient = mkCheck("Client-side", false);
        const fClientInput = fClient.input;
        checks.append(fGlobal.wrap, fClient.wrap);
        form.appendChild(checks);

        // Boutons
        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
        const resetForm = () => {
            editingId.value = null;
            fName.input.value = ""; fUrl.input.value = ""; fKey.input.value = "";
            fModel.value = ""; fGlobal.input.checked = false; fClientInput.checked = false;
            formTitle.textContent = "Nouveau preset";
        };
        const cancelBtn = mkBtn("Annuler", _aihStyle.btnSecondary, resetForm);
        const saveBtn = mkBtn("Sauvegarder", _aihStyle.btn(), async () => {
            const body = {
                name: fName.input.value.trim(),
                base_url: fUrl.input.value.trim(),
                api_key: fKey.input.value.trim(),
                model: fModel.value.trim(),
                is_global: fGlobal.input.checked ? 1 : 0,
                is_client_side: fClientInput.checked ? 1 : 0,
            };
            if (!body.name || !body.base_url || !body.model) {
                await window.aihShowAlert("Info", "Nom, URL et modèle sont requis", "info"); return;
            }
            try {
                if (editingId.value) {
                    await _aihFetchApi(`presets/${editingId.value}`, { method: "PUT", body });
                } else {
                    await _aihFetchApi("presets", { method: "POST", body });
                }
                resetForm();
                reloadPresets();
            } catch (e) {
                await window.aihShowAlert("Erreur", "Erreur sauvegarde : " + e.message, "error");
            }
        });
        btnRow.append(cancelBtn, saveBtn);
        form.appendChild(btnRow);
        container.appendChild(form);

        function fillForm(p) {
            editingId.value = p.id;
            fName.input.value = p.name || "";
            fUrl.input.value = p.base_url || "";
            fKey.input.value = ""; // On ne pré-remplit pas la clé pour la sécurité
            fModel.value = p.model || "";
            fGlobal.input.checked = !!p.is_global;
            fClientInput.checked = !!p.is_client_side;
            formTitle.textContent = "Modifier preset";
        }
    }

    // ── Update (git pull sur le repo local) ──────────────────────────────
    // Adaptation fusion : POST /aih/update renvoie {status, log, updated} et
    // ne redémarre JAMAIS seule. Après un update réussi et la confirmation
    // utilisateur, le redémarrage délègue au flux COMMUN du menu
    // (startRestartFlow de holaf_main.js, exposé sous window.holaf.
    // startRestartFlow) : POST /holaf/utilities/restart + compteur à rebours
    // + reconnexion — l'unique façon de redémarrer, aucun polling/reload
    // dupliqué ici. Si ce flux commun n'est pas disponible (module aih_menu
    // chargé avant holaf_main), un fallback propre (toast + reload manuel)
    // est utilisé à la place.

    async function openUpdate() {
        // Modale d'attente
        const modal = window.aihOpenModalV2({
            title: "🔄 Update AIH",
            content: `
            <div style="padding:8px 0;">
                <p style="color:#ccc; font-size:13px; margin:0 0 12px;">
                    Mise à jour du repo <code style="background:#1a1a1e; padding:1px 5px; border-radius:3px;">AIH_Tools</code> en cours...
                </p>
                <div id="aih-update-spinner" style="text-align:center; padding:20px;">
                    <span style="display:inline-block; width:32px; height:32px; border:3px solid #444; border-top-color:#ff8c00; border-radius:50%; animation:aih-spin 1s linear infinite;"></span>
                </div>
                <div id="aih-update-log" style="background:#1a1a1e; border:1px solid #333; border-radius:6px; padding:10px; font-family:monospace; font-size:11px; color:#aaa; max-height:280px; overflow-y:auto; white-space:pre-wrap; display:none;"></div>
            </div>
            <style>@keyframes aih-spin { to { transform: rotate(360deg); } }</style>
            `,
            width: "520px",
            height: "auto",
            minHeight: "250px",
            storageKey: "aih:aih-update",
            persistSize: true,
            persistPos: true
        });

        const logEl = modal.body.querySelector("#aih-update-log");
        const spinnerEl = modal.body.querySelector("#aih-update-spinner");

        try {
            const resp = await fetch("/aih/update", { method: "POST" });
            const data = await resp.json();
            spinnerEl.style.display = "none";
            logEl.style.display = "block";
            logEl.textContent = data.log || "(pas de log)";

            if (data.status === "ok" && data.updated) {
                // Mise à jour effectuée : proposer de redémarrer
                const restartSection = document.createElement("div");
                restartSection.style.cssText = "margin-top:14px; padding:12px; background:#1a2e1a; border:1px solid #2d5a2d; border-radius:6px;";
                restartSection.innerHTML = `
                    <p style="color:#4ade80; font-size:13px; margin:0 0 8px;">
                        ✓ Mise à jour installée. Un redémarrage de ComfyUI est nécessaire pour charger les nouveaux fichiers.
                    </p>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button id="aih-update-later" style="padding:6px 14px; border-radius:6px; border:1px solid #555; background:transparent; color:#ccc; cursor:pointer; font-size:12px;">Plus tard</button>
                        <button id="aih-update-restart" style="padding:6px 14px; border-radius:6px; border:none; background:#ff8c00; color:white; cursor:pointer; font-size:12px; font-weight:600;">Redémarrer ComfyUI</button>
                    </div>
                `;
                modal.body.appendChild(restartSection);

                modal.body.querySelector("#aih-update-later").onclick = () => modal.close();
                modal.body.querySelector("#aih-update-restart").onclick = () => {
                    // Ferme la modale AIH puis délègue au flux de redémarrage
                    // COMMUN (startRestartFlow de holaf_main.js) : même mécanique
                    // avec compteur à rebours que le bouton « Restart ComfyUI »
                    // du menu. C'est l'unique façon de redémarrer (pas de double
                    // polling/reload ici).
                    modal.close();
                    const restart = window.holaf && typeof window.holaf.startRestartFlow === "function"
                        ? window.holaf.startRestartFlow
                        : null;
                    if (restart) {
                        restart();
                        return;
                    }
                    // Fallback propre : flux commun indisponible (module aih_menu
                    // chargé avant holaf_main). Toast + lien de reload manuel —
                    // on ne recrée PAS de polling/reload local.
                    if (window.holaf && window.holaf.toastManager) {
                        window.holaf.toastManager.show({
                            message: "Redémarrage commun indisponible pour l'instant. " +
                                "<a href='#' onclick='event.preventDefault(); location.reload(); " +
                                "return false;' style='color:inherit;'>Recharger manuellement</a>",
                            type: "error"
                        });
                    } else {
                        location.reload();
                    }
                };
            } else if (data.status === "ok" && !data.updated) {
                // Déjà à jour
                const okSection = document.createElement("div");
                okSection.style.cssText = "margin-top:14px; padding:12px; background:#1a2e1a; border:1px solid #2d5a2d; border-radius:6px; text-align:center;";
                okSection.innerHTML = `<p style="color:#4ade80; font-size:13px; margin:0 0 8px;">✓ Vous êtes déjà à jour.</p>`;
                const closeBtn = document.createElement("button");
                closeBtn.textContent = "Fermer";
                Object.assign(closeBtn.style, { padding: "6px 14px", borderRadius: "6px", border: "1px solid #555", background: "transparent", color: "#ccc", cursor: "pointer", fontSize: "12px" });
                closeBtn.onclick = () => modal.close();
                okSection.appendChild(closeBtn);
                modal.body.appendChild(okSection);
            } else {
                // Erreur
                const errSection = document.createElement("div");
                errSection.style.cssText = "margin-top:14px; padding:12px; background:#2e1a1a; border:1px solid #5a2d2d; border-radius:6px; text-align:center;";
                errSection.innerHTML = `<p style="color:#f87171; font-size:13px; margin:0 0 8px;">✗ ${data.message || "Erreur inconnue"}</p>`;
                const closeBtn = document.createElement("button");
                closeBtn.textContent = "Fermer";
                Object.assign(closeBtn.style, { padding: "6px 14px", borderRadius: "6px", border: "1px solid #555", background: "transparent", color: "#ccc", cursor: "pointer", fontSize: "12px" });
                closeBtn.onclick = () => modal.close();
                errSection.appendChild(closeBtn);
                modal.body.appendChild(errSection);
            }
        } catch (err) {
            spinnerEl.style.display = "none";
            logEl.style.display = "block";
            logEl.textContent = "Erreur réseau : " + err.message;
        }
    }

    // ── Exposition (pattern merge sûr : n'écrase jamais une API existante) ──

    window.AIHMenu = Object.assign({}, window.AIHMenu, {
        getConfig,
        setConfig,
        openWebpage,
        openWorkflows,
        openModels,
        openMembers,
        openSettings,
        // Renderers d'onglets consommés par holaf_settings_manager.js :
        // chaque onglet de la fenêtre Settings Holaf délègue ici.
        renderAccountTab: renderCompteTab,
        renderCompteTab,
        renderProviderTab: renderProvidersTab,
        renderProvidersTab,
        openUpdate,
        checkServerStatus,
        getBlobbyState,
        toggleBlobby,
        openChat,
    });

})();
