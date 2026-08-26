/*
 * Copyright (C) 2026 Holaf
 * AIH I18n — Fondation d'internationalisation (FONDATIONS / Vague 0)
 * ----------------------------------------------------------------------------
 * Couche de traduction centralisée sous window.AIH.I18n. Conçue pour être :
 *   - Fusionnable : chaque module peut enregistrer ses propres clés via addDict,
 *     sans modifier les dictionnaires des autres (extensible par consommateur).
 *   - Auto-détectée : navigator.language au premier chargement si aucun choix
 *     utilisateur persisté n'existe.
 *   - Persistante : le choix de langue est conservé dans localStorage (aih_locale).
 *   - À repli (fallback) : clé absente de la langue active → FR → clé brute.
 *
 * Langue par défaut : FRANÇAIS (choix utilisateur). Anglais prêt.
 * Ce fichier est volontairement autonome (pas d'import/export) : il s'exécute
 * aussi bien en script classique que chargé comme module, et expose l'API via
 * window.AIH.I18n. Il n'a AUCUNE dépendance vers le système de dialogue.
 */

(function (global) {
    "use strict";

    const AIH = (global.AIH = global.AIH || {});

    // ─── Constantes ─────────────────────────────────────────────────────────
    const STORAGE_KEY = "aih_locale";   // clé dédiée de persistance
    const DEFAULT_LOCALE = "fr";        // langue par défaut : FRANÇAIS

    // ─── Dictionnaires intégrés ────────────────────────────────────────────
    // Clés du système de dialogue + quelques clés génériques utiles aux
    // consommateurs futurs. Chaque module peut en ajouter via addDict().
    const FR = {
        "dialog.ok": "OK",
        "dialog.cancel": "Annuler",
        "dialog.confirm": "Confirmer",
        "dialog.retry": "Réessayer",
        "dialog.delete": "Supprimer",
        "dialog.close": "Fermer",
        "dialog.yes": "Oui",
        "dialog.no": "Non",
        "dialog.save": "Enregistrer",
        "dialog.apply": "Appliquer",
        "dialog.discard": "Ignorer",
        "dialog.loading": "Chargement…",
        "dialog.alert_title": "Information",
        "dialog.confirm_title": "Confirmation",
        "dialog.prompt_title": "Saisie",
        "dialog.progress_title": "Veuillez patienter",
        "dialog.error": "Erreur",
        "dialog.success": "Succès",
        "dialog.warning": "Attention",
    };

    const EN = {
        "dialog.ok": "OK",
        "dialog.cancel": "Cancel",
        "dialog.confirm": "Confirm",
        "dialog.retry": "Retry",
        "dialog.delete": "Delete",
        "dialog.close": "Close",
        "dialog.yes": "Yes",
        "dialog.no": "No",
        "dialog.save": "Save",
        "dialog.apply": "Apply",
        "dialog.discard": "Discard",
        "dialog.loading": "Loading…",
        "dialog.alert_title": "Information",
        "dialog.confirm_title": "Confirmation",
        "dialog.prompt_title": "Input",
        "dialog.progress_title": "Please wait",
        "dialog.error": "Error",
        "dialog.success": "Success",
        "dialog.warning": "Warning",
    };

    // Dictionnaires fusionnables (mutables via addDict).
    const dicts = { fr: FR, en: EN };

    // ─── Utilitaires ────────────────────────────────────────────────────────
    function baseLang(lang) {
        if (typeof lang !== "string") return DEFAULT_LOCALE;
        const l = lang.trim().toLowerCase().split(/[-_]/)[0];
        return l || DEFAULT_LOCALE;
    }

    function hasDict(lang) {
        return Object.prototype.hasOwnProperty.call(dicts, lang) && !!dicts[lang];
    }

    // Interpolation basique {placeholder} → valeur de params.
    function interpolate(str, params) {
        if (!params || typeof params !== "object") return str;
        return String(str).replace(/\{([a-zA-Z0-9_]+)\}/g, (m, name) => {
            return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
        });
    }

    // ─── API AIH.I18n ───────────────────────────────────────────────────────
    const I18n = {
        _locale: null,

        // Langue active (normalisée, ex: "fr", "en").
        getLocale() {
            return this._locale || DEFAULT_LOCALE;
        },

        // Bascule manuelle + persistance localStorage. Retourne la langue retenue.
        setLocale(lang) {
            const l = baseLang(lang);
            this._locale = hasDict(l) ? l : DEFAULT_LOCALE;
            try {
                global.localStorage.setItem(STORAGE_KEY, this._locale);
            } catch (e) {
                /* localStorage indisponible — silencieux */
            }
            return this._locale;
        },

        // Détection automatique via navigator.language (base avant le tiret).
        detect() {
            let lang = DEFAULT_LOCALE;
            try {
                const nav = typeof global.navigator !== "undefined" ? global.navigator.language : null;
                if (nav) {
                    const base = baseLang(nav);
                    if (hasDict(base)) lang = base;
                }
            } catch (e) {
                /* silencieux */
            }
            return lang;
        },

        // Fusionne un dictionnaire {key: value} dans la langue donnée.
        // Extensible par module : n'écrase que les clés fournies.
        addDict(lang, entries) {
            const l = baseLang(lang);
            if (!entries || typeof entries !== "object") return this;
            if (!hasDict(l)) dicts[l] = {};
            Object.keys(entries).forEach((k) => {
                dicts[l][k] = String(entries[k]);
            });
            return this;
        },

        // Traduit une clé. Repli : langue active → FR → clé brute.
        t(key, params) {
            const loc = this.getLocale();
            let str = this._lookup(loc, key);
            if (str === undefined || str === null) str = this._lookup(DEFAULT_LOCALE, key);
            if (str === undefined || str === null) str = key;
            return interpolate(str, params);
        },

        _lookup(lang, key) {
            const d = dicts[lang];
            return d ? d[key] : undefined;
        },

        // Liste des langues actuellement disponibles (ex: ["fr", "en"]).
        getAvailableLocales() {
            return Object.keys(dicts).slice();
        },

        // Restaure un choix persisté, sinon détecte. Appelé une fois.
        _restore() {
            let lang = null;
            try {
                lang = global.localStorage.getItem(STORAGE_KEY);
            } catch (e) {
                /* silencieux */
            }
            if (lang) {
                const base = baseLang(lang);
                if (hasDict(base)) {
                    this._locale = base;
                    return;
                }
            }
            this._locale = this.detect();
        },
    };

    // Initialisation au chargement : choix persisté > détection auto.
    I18n._restore();

    AIH.I18n = I18n;
})(typeof window !== "undefined" ? window : globalThis);
