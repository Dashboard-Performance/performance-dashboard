// Arabic option in the merchant portal: English by default, Arabic on request, data never touched
import { I18N_JS } from "../src/i18n.js";
import { DASH_HTML } from "../src/dash.js";
import { PORTAL_HTML, APP_CSS } from "../src/ui.js";
import { DASH_CSS_EXTRA } from "../src/dash-css.js";
let pass = 0, fail = 0; const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n + (c ? "" : " :: " + JSON.stringify(x))); };

// ---- a very small DOM, enough for the walker
let store = {};
class N {
  constructor(t, v) { this.nodeType = t; this.nodeValue = v; this.childNodes = []; this.attrs = {}; this.tagName = ""; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parent; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null; }
  add(c) { c.parent = this; this.childNodes.push(c); return c; }
  hasAttribute(a) { return a in this.attrs; }
  getAttribute(a) { return this.attrs[a]; }
  setAttribute(a, v) { this.attrs[a] = v; }
  get classList() { return { contains: (c) => String(this.attrs.class || "").split(" ").includes(c) }; }
  querySelector() { return null; }
  insertBefore(c) { this.add(c); }
  addEventListener(e, f) { (this.ev = this.ev || {})[e] = f; }
  appendChild(c) { return this.add(c); }
  click() { if (this.ev && this.ev.click) this.ev.click(); }
}
const el = (tag, attrs) => { const n = new N(1); n.tagName = tag; Object.assign(n.attrs, attrs || {}); return n; };
const txt = (v) => new N(3, v);

const body = el("BODY");
const bar = el("DIV", { class: "topbar-actions" }); body.add(bar);
const nav = el("A"); nav.add(txt("Over View")); body.add(nav);
const sub = el("P"); sub.add(txt("Your demand, pipeline & delivery numbers")); body.add(sub);
const btn = el("BUTTON", { title: "Sign out" }); btn.add(txt("Sign out")); body.add(btn);
const inp = el("INPUT", { placeholder: "Email" }); body.add(inp);
// things that must survive untouched
const prod = el("TD"); prod.add(txt("Hair Dryer Pro 2200W")); body.add(prod);
const sku = el("TD"); sku.add(txt("EG030501C5CART")); body.add(sku);
const kpi = el("TD", { title: "Actual ÷ MTD Target, as a percentage." }); kpi.add(txt("GMV")); body.add(kpi);
const num = el("TD"); num.add(txt("1,284,900")); body.add(num);
const head = el("HEAD");
const htmlEl = el("HTML");
const ids = {};
const document = {
  documentElement: htmlEl, body, head, readyState: "complete",
  // resolve like a real DOM, so the module's own getElementById("langBtn") finds the button it just inserted
  getElementById: (i) => { const find = (n) => { if (n.id === i || n.attrs.id === i) return n; for (const c of n.childNodes) { const r = find(c); if (r) return r; } return null; };
    return ids[i] || find(body) || find(head) || null; },
  querySelector: (s) => (s === ".topbar-actions" ? bar : null),
  createElement: (t) => { const n = el(t.toUpperCase()); Object.defineProperty(n, "textContent", { get() { return this._t || ""; }, set(v) { this._t = v; }, configurable: true }); return n; },
  addEventListener() {},
};
const win = {};
const observed = [];
class MO { constructor(f) { this.f = f; } observe(...a) { observed.push(a); } disconnect() {} }
new Function("window", "document", "localStorage", "MutationObserver", "WeakMap", "Object", "String",
  I18N_JS + "\n")(win, document,
    { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, MO, WeakMap, Object, String);
// the button the module mounted
const lang = bar.childNodes.find((c) => c.id === "langBtn");
ids.langBtn = lang;

ok(!!lang, "a language button is added to the top bar");
ok(htmlEl.attrs.lang === "en" && htmlEl.attrs.dir === "ltr", "the portal opens in English, left-to-right", htmlEl.attrs);
ok(nav.firstChild.nodeValue === "Over View", "and nothing is translated until asked");
ok(lang.textContent === "ع", "the button offers Arabic", lang.textContent);

// ---- switch to Arabic
win.MPLang.set("ar");
ok(htmlEl.attrs.lang === "ar" && htmlEl.attrs.dir === "rtl", "switching sets Arabic and right-to-left", htmlEl.attrs);
ok(nav.firstChild.nodeValue === "نظرة عامة", "navigation is translated", nav.firstChild.nodeValue);
ok(/أرقام الطلب/.test(sub.firstChild.nodeValue), "page subtitles are translated", sub.firstChild.nodeValue);
ok(btn.attrs.title === "تسجيل الخروج" && btn.firstChild.nodeValue === "تسجيل الخروج", "button labels AND their tooltips", [btn.attrs.title, btn.firstChild.nodeValue]);
ok(inp.attrs.placeholder === "البريد الإلكتروني", "input placeholders", inp.attrs.placeholder);
ok(lang.textContent === "EN", "the button now offers the way back");

// ---- what must never be touched
ok(prod.firstChild.nodeValue === "Hair Dryer Pro 2200W", "a product name is left exactly as it is");
ok(sku.firstChild.nodeValue === "EG030501C5CART", "a SKU code is left exactly as it is");
ok(num.firstChild.nodeValue === "1,284,900", "a number is left exactly as it is");
ok(kpi.firstChild.nodeValue === "GMV", "GMV stays English — merchants quote these back and match them to other reports");
ok(kpi.attrs.title === "Actual ÷ MTD Target, as a percentage.", "a metric tooltip outside the dictionary is left alone rather than half-translated");

// ---- and back
win.MPLang.set("en");
ok(htmlEl.attrs.dir === "ltr", "switching back restores left-to-right");
ok(nav.firstChild.nodeValue === "Over View" && btn.attrs.title === "Sign out" && inp.attrs.placeholder === "Email",
   "every translated node and attribute is restored exactly, with no reload", [nav.firstChild.nodeValue, btn.attrs.title, inp.attrs.placeholder]);
ok(store.mpLang === "en", "the choice is remembered for next time", store);

// ---- the choice survives a reload
store.mpLang = "ar";
const html2 = el("HTML"), body2 = el("BODY"), bar2 = el("DIV", { class: "topbar-actions" });
body2.add(bar2); const nav2 = el("A"); nav2.add(txt("Inventory")); body2.add(nav2);
const doc2 = Object.assign({}, document, { documentElement: html2, body: body2, head: el("HEAD"),
  querySelector: (s) => (s === ".topbar-actions" ? bar2 : null), getElementById: () => null });
new Function("window", "document", "localStorage", "MutationObserver", "WeakMap", "Object", "String", I18N_JS)
  ({}, doc2, { getItem: (k) => store[k] ?? null, setItem: () => {} }, MO, WeakMap, Object, String);
ok(html2.attrs.dir === "rtl" && nav2.firstChild.nodeValue === "المخزون", "a merchant who chose Arabic gets Arabic on the next visit", nav2.firstChild.nodeValue);
ok(observed.length > 0, "and newly rendered panels are watched, so the page cannot drift back to English");

// ---- wiring
ok(DASH_HTML.includes('/static/i18n.js'), "the dashboard page loads it");
ok(PORTAL_HTML.includes('/static/i18n.js'), "the sign-in page loads it too");
ok(!/<script>[^<]/.test(DASH_HTML + PORTAL_HTML), "still no inline script anywhere — the CSP forbids it");
ok(DASH_CSS_EXTRA.includes("#langBtn") && APP_CSS.includes(".mp-lang"), "the button is styled on both pages");
ok(/direction:ltr/.test(I18N_JS), "figures are forced left-to-right in Arabic, so they never read backwards");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
