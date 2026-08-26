// Validation de la fondation i18n (Vague 0).
// Usage : node test_aih_i18n.mjs
import assert from "node:assert";

/* ─── Environnement minimal (localStorage + navigator) ─────────────────── */
const store = {};
globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};

// Le module est chargé une seule fois ; on pilote ensuite detect()/_restore()
// en mutant navigator.language et localStorage partagé.
const fakeWindow = {
    localStorage: globalThis.localStorage,
    navigator: { language: "fr-FR" },
};
globalThis.window = fakeWindow;
await import("./aih_i18n.js");
const I18n = fakeWindow.AIH.I18n;

/* ─── 1. Détection auto + défaut FR ────────────────────────────────────── */
assert.ok(I18n && typeof I18n.t === "function", "AIH.I18n exposé");
assert.strictEqual(I18n.getLocale(), "fr", "detect fr-FR → fr");
assert.strictEqual(I18n.t("dialog.confirm"), "Confirmer", "FR confirm = Confirmer");
assert.deepStrictEqual(I18n.getAvailableLocales().slice().sort(), ["en", "fr"], "fr + en dispo");

// Langue non supportée → repli FR (choix utilisateur).
fakeWindow.navigator.language = "de-DE";
assert.strictEqual(I18n.detect(), "fr", "langue non supportée → FR par défaut");
fakeWindow.navigator.language = "en-GB";
assert.strictEqual(I18n.detect(), "en", "detect en-GB → en");

/* ─── 2. Bascule manuelle setLocale + persistance ─────────────────────── */
I18n.setLocale("en");
assert.strictEqual(I18n.getLocale(), "en", "setLocale('en')");
assert.strictEqual(I18n.t("dialog.confirm"), "Confirm", "EN confirm = Confirm");
assert.strictEqual(I18n.t("dialog.cancel"), "Cancel", "EN cancel = Cancel");
assert.strictEqual(store.aih_locale, "en", "setLocale persiste aih_locale = en");

// setLocale avec langue invalide → repli FR.
I18n.setLocale("xx");
assert.strictEqual(I18n.getLocale(), "fr", "setLocale('xx') → FR");

// Choix persisté prime sur la détection au rechargement (_restore).
fakeWindow.navigator.language = "fr-FR";
store.aih_locale = "en";
I18n._restore();
assert.strictEqual(I18n.getLocale(), "en", "choix persisté 'en' prime sur détection fr");
assert.strictEqual(I18n.t("dialog.confirm"), "Confirm", "EN restaurée depuis localStorage");

// Aucun choix persisté → détection.
delete store.aih_locale;
fakeWindow.navigator.language = "en-US";
I18n._restore();
assert.strictEqual(I18n.getLocale(), "en", "détection en-US après suppression du choix");

/* ─── 3. t() avec interpolation {placeholder} ──────────────────────────── */
I18n.setLocale("en");
I18n.addDict("en", { "test.greeting": "Hello {name}, {count} items" });
assert.strictEqual(
    I18n.t("test.greeting", { name: "Holaf", count: 3 }),
    "Hello Holaf, 3 items",
    "interpolation {placeholder}"
);
// Paramètre manquant → laissé tel quel.
assert.strictEqual(I18n.t("test.greeting", { name: "X" }), "Hello X, {count} items", "placeholder manquant conservé");

/* ─── 4. addDict : fusion extensible par module ────────────────────────── */
I18n.setLocale("fr");
I18n.addDict("fr", { "module.foo": "Bar", "dialog.ok": "D'accord" });
assert.strictEqual(I18n.t("module.foo"), "Bar", "clé module fusionnée");
assert.strictEqual(I18n.t("dialog.ok"), "D'accord", "surcharge d'une clé existante via addDict");
assert.deepStrictEqual(I18n.getAvailableLocales().slice().sort(), ["en", "fr"], "getAvailableLocales inchangé");

// addDict dans une langue inédite → nouvelle langue disponible.
I18n.addDict("es", { "module.hola": "Hola" });
assert.deepStrictEqual(I18n.getAvailableLocales().slice().sort(), ["en", "es", "fr"], "es ajoutée");
I18n.setLocale("es");
assert.strictEqual(I18n.t("module.hola"), "Hola", "clé résolue en es");

/* ─── 5. Fallback : locale → FR → clé brute ────────────────────────────── */
I18n.setLocale("es"); // pas de clé dialog.confirm en es
assert.strictEqual(I18n.t("dialog.confirm"), "Confirmer", "fallback es → FR");
assert.strictEqual(I18n.t("clé.inexistante"), "clé.inexistante", "fallback final = clé brute");

console.log("✅ Simulation AIH.I18n : TOUS LES TESTS PASSENT");
