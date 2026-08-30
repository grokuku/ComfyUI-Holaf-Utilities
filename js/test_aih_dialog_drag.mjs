// Simulation du drag des dialogs Holaf (HolafPanelManager.createDialog) avec
// un fake DOM minimal — vérifie : centrage JS explicite, drag fluide (left/top),
// pas de fermeture quand le drag se termine sur l'overlay.
// Usage : node js/test_aih_dialog_drag.mjs
import assert from "node:assert";

/* ──────────────────────────── Fake DOM minimal ──────────────────────────── */

class FakeClassList {
    constructor() { this._set = new Set(); }
    add(...c) { c.forEach((x) => this._set.add(x)); }
    remove(...c) { c.forEach((x) => this._set.delete(x)); }
    contains(c) { return this._set.has(c); }
    toggle(c, force) {
        if (force === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); }
        else if (force) this._set.add(c); else this._set.delete(c);
    }
}

class FakeStyle {
    constructor() { return new Proxy({}, {
        set(t, prop, val) { t[prop] = val; return true; },
        get(t, prop) { return t[prop]; },
    }); }
}

class FakeEl {
    constructor(tag = "div") {
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.children = [];
        this._parent = null;
        this.id = "";
        this.style = new FakeStyle();
        this._className = "";
        this._listeners = {};
        this.dataset = {};
        this.textContent = "";
        this.innerHTML = "";
        this.classList = new FakeClassList();
        this._rect = { width: 100, height: 50 };
        this.offsetWidth = 100;
        this.offsetHeight = 50;
    }
    get parentNode() { return this._parent; }
    get className() { return [...this.classList._set].join(" "); }
    set className(v) { this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get offsetLeft() { return parseInt(this.style.left, 10) || 0; }
    get offsetTop() { return parseInt(this.style.top, 10) || 0; }
    appendChild(child) { child._parent = this; this.children.push(child); return child; }
    append(...children) { children.forEach((c) => this.appendChild(c)); }
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child._parent = null; }
    remove() { if (this._parent) this._parent.removeChild(this); }
    focus() {}
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { const a = this._listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
    dispatch(type, ev) { [...(this._listeners[type] || [])].forEach((fn) => fn(ev)); }
    matches(sel) {
        if (sel.includes(",")) return sel.split(",").some((s) => this.matches(s.trim()));
        if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
        return this.tagName === sel.toUpperCase();
    }
    closest(sel) { let n = this; while (n) { if (n.matches(sel)) return n; n = n._parent; } return null; }
    getBoundingClientRect() { return { ...this._rect, left: this.offsetLeft, top: this.offsetTop }; }
    querySelector(sel) { return this._allDescendants().find((n) => n.matches(sel)) || null; }
    querySelectorAll(sel) { return this._allDescendants().filter((n) => n.matches(sel)); }
    _allDescendants(out = []) { for (const c of this.children) { out.push(c); c._allDescendants(out); } return out; }
}

globalThis.window = globalThis;
globalThis.HTMLElement = class {};
globalThis.Node = class {};
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
globalThis.document = {
    body: new FakeEl("body"),
    createElement: (tag) => new FakeEl(tag),
    addEventListener(type, fn) { (this._l = this._l || {})[type] ? this._l[type].push(fn) : (this._l[type] = [fn]); },
    removeEventListener(type, fn) { if (this._l && this._l[type]) { const a = this._l[type]; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
};
globalThis.getComputedStyle = () => ({ transform: "none" });
window.innerWidth = 1280;
window.innerHeight = 800;

const HPM = (await import("./holaf_panel_manager.js")).HolafPanelManager;

/* ── 1. Création : dialog centré en pixels (JS explicite) ─────────────────── */
let dialogP;
try {
    dialogP = HPM.createDialog({ title: "Test", message: "Salut", buttons: [{ text: "OK", value: true }] });
} catch (e) {
    console.log("SYNC THROW:", e.message);
    throw e;
}
dialogP.catch((e) => { console.log("REJECTED:", e.message); });

const all = () => document.body._allDescendants([]);
const overlay = all().find((n) => n.classList.contains("holaf-dialog-overlay"));
const dialog = all().find((n) => n.classList.contains("holaf-dialog-inline"));
assert.ok(overlay, "overlay créé");
assert.ok(dialog, "dialog créé");

const expectedLeft = (window.innerWidth - dialog.offsetWidth) / 2;
const expectedTop = (window.innerHeight - dialog.offsetHeight) / 2;
assert.strictEqual(dialog.style.position, "fixed", "position: fixed inline");
assert.strictEqual(parseInt(dialog.style.left, 10), Math.round(expectedLeft), "centré horizontalement en pixels");
assert.strictEqual(parseInt(dialog.style.top, 10), Math.round(expectedTop), "centré verticalement en pixels");
assert.strictEqual(dialog.style.transform, "none", "pas de transform résiduel");

/* ── 2. Drag : mousedown sur le header → mousemove → left/top mis à jour ──── */
const header = dialog.children[0];
assert.ok(header.classList.contains("holaf-utility-header"), "header trouvé");

header.dispatch("mousedown", { clientX: 400, clientY: 300, target: header, preventDefault() {} });

const doc = globalThis.document;
assert.ok(doc._l.mousemove && doc._l.mousemove.length > 0, "écouteur mousemove posé");
assert.ok(doc._l.mouseup && doc._l.mouseup.length > 0, "écouteur mouseup posé");

doc._l.mousemove[0]({ clientX: 600, clientY: 500 });

const movedLeft = parseInt(dialog.style.left, 10);
const movedTop = parseInt(dialog.style.top, 10);
assert.strictEqual(movedLeft, 600 - (400 - expectedLeft), `left suit le curseur (${movedLeft})`);
assert.strictEqual(movedTop, 500 - (300 - expectedTop), `top suit le curseur (${movedTop})`);

/* ── 3. Relâchement : le drag se termine → pas de fermeture ──────────────── */
doc._l.mouseup[0]({ clientX: 600, clientY: 500 });
overlay.dispatch("click", { target: overlay });   // clic sur le fond APRÈS un drag
assert.ok(dialog._parent === overlay, "dialog pas fermé après drag (fond ignoré)");

/* ── 4. Clic suivant sur le fond → fermeture normale ─────────────────────── */
overlay.dispatch("click", { target: overlay });
assert.strictEqual(overlay._parent, null, "dialog fermé au clic suivant sur le fond (overlay retiré du body)");

console.log("✅ Simulation drag dialogs : centré en pixels, déplacement fluide, pas de fermeture accidentelle");
