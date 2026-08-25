/**
 * AIH Shared Helpers — Fonctions partagées entre les widgets ComfyUI.
 *
 * Chargé automatiquement par ComfyUI (WEB_DIRECTORY = "web").
 * Pas d'ESM : attache les helpers à l'objet global window.AIH.
 *
 * Les fichiers widget délèguent à ces helpers pour éviter la duplication.
 */
(function () {
    "use strict";

    const AIH = (window.AIH = window.AIH || {});

    /**
     * Récupère la clé API AIH depuis localStorage ("AIH_config").
     * @returns {string} La clé API, ou "" si absente / illisible.
     */
    AIH.getApiKey = function getApiKey() {
        try {
            return JSON.parse(localStorage.getItem("AIH_config") || "{}").apiKey || "";
        } catch {
            return "";
        }
    };

    /**
     * Récupère l'URL du serveur AIH depuis localStorage ("AIH_config").
     * @returns {string} L'URL de base (ex: "https://kw.holaf.fr"), sans slash final.
     */
    AIH.getServerUrl = function getServerUrl() {
        try {
            return JSON.parse(localStorage.getItem("AIH_config") || "{}").serverUrl || "https://kw.holaf.fr";
        } catch {
            return "https://kw.holaf.fr";
        }
    };
})();