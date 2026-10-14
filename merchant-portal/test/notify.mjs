// v1.17.0 — merchant notifications: lifecycle (new / update / resolved / back in stock / cooldown / cap / mute)
// and the portal API (/api/notifications, /api/sku, /api/lock-request) with a fake staff dashboard.   node test/notify.mjs
import worker, { __test } from "../src/worker.js";
import { lifecycle } from "../src/notify.js";

let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const CFG = { enabled: true, cooldownDays: 3, maxNewPerDay: 5, muteDays: 30, lockRequests: true, threshold: 70,
  rules: { N1: { on: true, critical: 50 }, N2: { on: true, critical: 50 }, N3: { on: true, days: 4, critical: 2 }, N4: { on: true }, N5: { on: true, coverDays: 2, critical: 1 }, N6: { on: true, days: 3 }, N7: { on: true, doh: 7 }, N8: { on: true, score: 90 } },
  alternatives: { on: true, minDoh: 14, max: 3 } };
const T0 = "2026-10-14T08:00:00.000Z", T1 = "2026-10-14T13:00:00.000Z", T2 = "2026-10-15T08:00:00.000Z", T3 = "2026-10-20T08:00:00.000Z";

console.log("Lifecycle");
{
  const sig = { skus: { A: { n: "Alpha", doh: 2.5, stock: 50, sc: { demand: 40 } }, B: { n: "Beta", doh: 30, stock: 900, sc: { demand: 45 } } },
    signals: [{ rule: "N3", sku: "A", sev: "warning", impact: 100, data: { doh: 2.5, stock: 50 } }, { rule: "N1", sku: "B", sev: "critical", impact: 900, data: { score: 45, recent: 9, usual: 20 } }] };
  let st = lifecycle(null, sig, CFG, T0);
  ok(st.items.length === 2 && st.items.every((x) => x.status === "active"), "two new notifications");
  ok(st.items[0].rule === "N1", "most important first (critical, then EGP at stake)");
  const id = st.items.find((x) => x.rule === "N3").id;
  sig.signals[0].data.doh = 1.5; sig.signals[0].sev = "critical";
  st = lifecycle(st, sig, CFG, T1);
  ok(st.items.filter((x) => x.rule === "N3").length === 1 && st.items.find((x) => x.rule === "N3").id === id && st.items.find((x) => x.rule === "N3").sev === "critical", "same condition → same notification, updated (no duplicate)");
  const sig2 = { skus: { A: { n: "Alpha", doh: 12, stock: 900, sc: {} }, B: { n: "Beta", doh: 30, stock: 900, sc: { demand: 95 } } }, signals: [] };
  st = lifecycle(st, sig2, CFG, T2);
  ok(st.items.find((x) => x.rule === "N3").status === "resolved" && st.items.some((x) => x.rule === "N7" && x.sku === "A"), "stock came back → resolved + 'back in stock'");
  ok(st.items.some((x) => x.rule === "N8" && x.sku === "B"), "orders back to normal → 'performing again'");
  st = lifecycle(st, sig, CFG, "2026-10-16T08:00:00.000Z");
  ok(!st.items.some((x) => x.rule === "N3" && x.status === "active"), "cooldown: the same notification does not come back within 3 days");
  st = lifecycle(st, sig, CFG, T3);
  ok(st.items.some((x) => x.rule === "N3" && x.status === "active"), "…and comes back after the cooldown");
  // cap
  const many = { skus: {}, signals: [] }; for (let i = 0; i < 9; i++) { many.skus["S" + i] = { n: "S" + i }; many.signals.push({ rule: "N1", sku: "S" + i, sev: "warning", impact: i, data: {} }); }
  ok(lifecycle(null, many, CFG, T0).items.length === 5, "max 5 new per merchant per day");
  // mute + switches
  const muted = lifecycle({ items: [], muted: { A: "2026-12-01T00:00:00Z" } }, sig, CFG, T0);
  ok(!muted.items.some((x) => x.sku === "A"), "a muted SKU gets nothing");
  ok(lifecycle(null, sig, Object.assign({}, CFG, { rules: Object.assign({}, CFG.rules, { N1: { on: false } }) }), T0).items.every((x) => x.rule !== "N1"), "a rule switched off in the dashboard is not sent");
  const off = lifecycle(lifecycle(null, sig, CFG, T0), sig, Object.assign({}, CFG, { enabled: false }), T1);
  ok(off.items.every((x) => x.status !== "active"), "notifications switched off → nothing stays active");
  // request decision
  const rq = lifecycle(null, { skus: {}, signals: [] }, CFG, T0, { requests: [{ sku: "A", status: "resolved", decision: "Approved", outcome: "+40", at: T0, updated: T1 }] });
  ok(rq.items.some((x) => x.rule === "RQ" && x.data.decision === "Approved"), "the team's decision on a lock request becomes an update");
}

console.log("Portal API");
function makeKV() { const m = new Map(); return { _m: m, async get(k, o) { const v = m.get(k); if (v == null) return null; return v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix || "")).map((name) => ({ name })), list_complete: true }; } }; }
const sent = [];
const SIG = { success: true, asOf: "2026-10-14", cfg: CFG, alts: { Kitchen: [{ sku: "ALT1", n: "Alt One", doh: 40 }, { sku: "A", n: "Alpha", doh: 2 }] }, eta: { A: "2026-10-18" },
  merchants: { "1001": { skus: { A: { n: "Alpha", cat: "Kitchen", d: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], c: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], doh: 2.5, stock: 50, avail: "Available", sc: { demand: 40, cr: 90 }, lock: { alloc: 100, used: 90, rem: 10, cover: 1.3, avg: 8, suggest: 46, exp: "2026-11-01" } } },
    signals: [{ rule: "N3", sku: "A", sev: "warning", impact: 100, data: { doh: 2.5, stock: 50 } }, { rule: "N5", sku: "A", sev: "warning", impact: 800, data: { rem: 10, avg: 8, cover: 1.3, suggest: 46 } }] },
    "2002": { skus: { Z: { n: "Secret of other merchant" } }, signals: [{ rule: "N4", sku: "Z", sev: "critical", data: {} }] } },
  requests: {} };
globalThis.fetch = async (url, o) => {
  url = String(url);
  if (url.startsWith("https://dash.example") && url.indexOf("loopPortalSignals") >= 0) { if (o.headers["X-Service-Key"] !== "svc-key-1234567890") return new Response("{}", { status: 403 }); const b = JSON.parse(o.body); const out = Object.assign({}, SIG, { merchants: {} }); b.mids.forEach((m) => { if (SIG.merchants[m]) out.merchants[m] = SIG.merchants[m]; }); return new Response(JSON.stringify(out)); }
  if (url.startsWith("https://dash.example") && url.indexOf("loopMerchantRequest") >= 0) { sent.push(JSON.parse(o.body)); return new Response(JSON.stringify({ success: true, id: "c_1" })); }
  if (url.startsWith("https://dash.example") && url.indexOf("loopPortalCatalog") >= 0) { const b = JSON.parse(o.body); if (b.sku) return new Response(JSON.stringify({ success: true, item: b.sku === "A" ? { sku: "A", n: "Alpha", price: 735, profit: 200, cr: 0.6, dr: 0.5, cat: "Kitchen" } : null })); return new Response(JSON.stringify({ success: true, items: [{ sku: "A", n: "Alpha" }] })); }
  if (url.startsWith("https://dash.example") && url.indexOf("loopCpaSync") >= 0) { sent.push(Object.assign({ sync: true }, JSON.parse(o.body))); return new Response(JSON.stringify({ success: true })); }
  if (url.startsWith("https://dash.example") && url.indexOf("getPortalAlerts") >= 0) return new Response(JSON.stringify({ alerts: [{ id: "m1", at: T0, title: "Hello from Taager", body: "Manual alert", severity: "info" }] }));
  throw new Error("unexpected fetch " + url);
};
const env = { PORTAL_KV: makeKV(), ADMIN_KEY: "admin-key-1234567890", SESSION_SECRET: "s".repeat(40), DASHBOARD_WORKER_URL: "https://dash.example/", DASHBOARD_SERVICE_KEY: "svc-key-1234567890" };
const ctx = { waitUntil() {} }, ORIGIN = "https://portal.example";
async function call(path, { method = "GET", body, cookie, admin } = {}) {
  const h = { "X-Portal": "1", Origin: ORIGIN, "CF-Connecting-IP": "1.2.3.4" }; if (body !== undefined) h["Content-Type"] = "application/json"; if (cookie) h.Cookie = cookie; if (admin) h["X-Admin-Key"] = admin;
  const r = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), env, ctx);
  const sc = r.headers.get("Set-Cookie"); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; } return { status: r.status, j, cookie: sc ? sc.split(";")[0] : null };
}
{
  let r = await call("/api/admin/accounts", { method: "POST", admin: env.ADMIN_KEY, body: { email: "owner@shop.com", name: "Store A", merchantIds: "1001" } });
  await call("/api/admin/accounts", { method: "POST", admin: env.ADMIN_KEY, body: { email: "other@shop.com", name: "Store B", merchantIds: "2002" } });
  r = await call("/api/password/set", { method: "POST", body: { token: r.j.link.split("#t=")[1], password: "GoodPassw0rd!" } });
  const cookie = r.cookie;
  ok((await call("/api/notifications")).status === 401, "notifications need sign-in");
  r = await call("/api/admin/refresh", { method: "POST", admin: env.ADMIN_KEY, body: { part: "notifications" } });
  ok(r.j.ok, "admin 'Refresh → Notifications' pulls the signals from the dashboard");
  r = await call("/api/notifications", { cookie });
  ok(r.status === 200 && r.j.items.length === 2 && r.j.items.every((x) => x.mid === "1001"), "merchant sees only their own notifications");
  ok(r.j.alerts.length === 1 && r.j.alerts[0].title === "Hello from Taager", "…plus the alerts the team sent manually");
  ok(r.j.items.find((x) => x.rule === "N3").eta === "2026-10-18", "the Supply ETA is attached to the stock notification");
  ok(!JSON.stringify(r.j).includes("Secret of other merchant"), "nothing from another merchant leaks");
  await call("/api/notifications/read", { method: "POST", cookie, body: { ids: r.j.items.map((x) => x.id) } });
  r = await call("/api/notifications", { cookie });
  ok(r.j.read.length === 2, "read state saved on the server");
  r = await call("/api/sku?sku=A", { cookie });
  ok(r.j.found && r.j.data.lock.suggest === 46 && r.j.data.d.length === 14 && r.j.eta === "2026-10-18", "SKU detail: 14-day chart, lock, ETA");
  ok(r.j.alts.length === 1 && r.j.alts[0].sku === "ALT1", "alternatives exclude SKUs the merchant already sells");
  r = await call("/api/lock-request", { method: "POST", cookie, body: { mid: "2002", sku: "Z", qty: 10 } });
  ok(r.status === 403, "cannot ask for another merchant's lock");
  r = await call("/api/lock-request", { method: "POST", cookie, body: { mid: "1001", sku: "A", kind: "increase", qty: 46, note: "big campaign" } });
  ok(r.status === 200 && sent.length === 1 && sent[0].mid === "1001" && sent[0].qty === 46 && sent[0].email === "owner@shop.com", "lock request forwarded to the dashboard (Availability Locking task)");
  r = await call("/api/sku?sku=A", { cookie });
  ok(r.j.requests.length === 1 && r.j.requests[0].status === "open", "…and shows as waiting right away");
  r = await call("/api/notifications/mute", { method: "POST", cookie, body: { mid: "1001", sku: "A" } });
  ok(r.status === 200, "merchant mutes a SKU");
  r = await call("/api/notifications", { cookie });
  ok(r.j.items.every((x) => x.status !== "active"), "…its notifications close");
  await call("/api/admin/refresh", { method: "POST", admin: env.ADMIN_KEY, body: { part: "notifications" } });
  r = await call("/api/notifications", { cookie });
  ok(r.j.items.every((x) => x.status !== "active"), "…and stay quiet on the next refresh");
  r = await call("/dashboard");
  ok(/id="skuDrawer"/.test(r.j) && /id="lkModal"/.test(r.j) && !/style="/.test(r.j), "dashboard page has the drawer + request form, no inline styles (CSP)");
}
console.log("RE-CPA");
{
  const fs = await import("node:fs"), path = await import("node:path"), { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { CPA_JS, CPA_CSS } = await import("../src/cpa-core.js");
  ok(CPA_JS === fs.readFileSync(path.join(root, "js/cpa-core.js"), "utf8") && CPA_CSS === fs.readFileSync(path.join(root, "css/cpa.css"), "utf8"), "portal copy of the RE-CPA core is in sync (node tools/sync-cpa.mjs)");
  new Function(CPA_JS)(); const T = globalThis.TaagerCpa;
  // the rows of the RE-CPA sheet — same results as its formulas
  let o = T.calc({ price: 735, profit: 200, market: 950, ndrOverride: 0.3, cpa: 120, conv: 100 });
  ok(o.asp === 851 && o.margin === 316 && Math.abs(o.maxCpa - 94.8) < 1e-9 && o.spend === 12000 && Math.abs(o.net + 2520) < 1e-9 && o.status === "losing", "sheet row 2: ASP 851, Top-up 316, NET −2,520 → Max CPA 94.8 (the sheet had 72 typed by hand)");
  o = T.calc({ price: 600, profit: 175, market: 750, ndrOverride: 0.32, cpa: 60, conv: 132 });
  ok(o.margin === 226 && Math.abs(o.net - 1626.24) < 1e-6 && Math.abs(o.maxCpa - 72.32) < 1e-9, "sheet row 5: NET 1,626.24, Max CPA 72.32");
  o = T.calc({ price: 900, profit: 200, market: 1070, cr: 0.7714285714, dr: 0.4074074074, cpa: 44, conv: 70 });
  ok(o.margin === 271 && Math.abs(o.maxCpa - 85.17) < 0.01 && Math.abs(o.net - 2882) < 0.5 && o.status === "safe", "sheet row 10 (NDR = CR × DR): Max CPA 85.17, NET 2,882");
  o = T.calc({ price: 550, profit: 150, market: "", ndrOverride: 0.54, cpa: "", conv: "" });
  ok(o.asp === 550 && o.margin === 150 && o.status === "noCpa", "empty AVE Market = sells at Taager's price (no more −499 like the sheet)");
  ok(T.calc({ price: 750, profit: 50, market: 700, ndrOverride: 0.3, cpa: 10, conv: 10 }).status === "noMargin", "margin ≤ 0 → 'No margin'");
  const sg = T.suggestions({ src: "merchant", productNdr: 0.4 }, T.calc({ price: 735, profit: 200, market: 950, cr: 0.6, dr: 0.5, cpa: 120, conv: 100 }));
  ok(sg.some((x) => /lose/.test(x[1])) && sg.some((x) => /market price to at least/.test(x[1])) && sg.some((x) => /NDR to/.test(x[1])), "suggestions: lower CPA / raise price / lift NDR");
  ok(T.calc({ price: 735, profit: 200, market: 950, ndrOverride: 0.3 }, { shipping: 50 }).asp === 900, "shipping fee comes from the dashboard settings");
  // API
  let r = await call("/api/login", { method: "POST", body: { email: "owner@shop.com", password: "GoodPassw0rd!" } }); const cookie = r.cookie;
  r = await call("/api/cpa/sku?sku=A", { cookie });
  ok(r.j.item && r.j.item.price === 735 && r.j.item.profit === 200 && r.j.item.src === "product" && Math.abs(r.j.item.productNdr - 0.3) < 1e-9, "SKU lookup: Taager price / profit + product CR/DR");
  r = await call("/api/cpa", { method: "POST", cookie, body: { rows: [{ sku: "A", n: "Alpha", price: 735, profit: 200, market: 950, cpa: 80, conv: 50 }] } });
  ok(r.status === 200 && sent.some((x) => x.sync && x.mid === "1001" && x.rows.length === 1), "plan saved and shared with the Taager team (per merchant ID)");
  r = await call("/api/cpa", { cookie });
  ok(r.j.plan.rows[0].cpa === 80 && r.j.cfg.shipping === 99, "plan reloads with the dashboard's settings");
  r = await call("/static/cpa.js"); ok(r.status === 200 && /TaagerCpa/.test(r.j), "calculator served by the portal");
  r = await call("/dashboard"); ok(/id="viewCpa"/.test(r.j) && /\/static\/cpa.js/.test(r.j), "RE-CPA tab in the merchant dashboard");
}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
