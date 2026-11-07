// v1.17.8 — Usage Log tests (tracking endpoint + admin read + retention). Run: node test/usage.mjs   (D1 is emulated with node:sqlite)
process.env.TZ = "UTC";
import { DatabaseSync } from "node:sqlite";
const worker = (await import("../worker.js")).default;
const { createUsage, cairoDay } = await import("../usage.js");

function d1() {
  const db = new DatabaseSync(":memory:");
  const clean = (a) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  function stmt(sql, args = []) {
    return { bind(...a) { return stmt(sql, clean(a)); }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) || null; },
      async run() { db.prepare(sql).run(...args); return { success: true }; }, _exec() { db.prepare(sql).run(...args); } };
  }
  return { raw: db, prepare: (sql) => stmt(sql), async batch(list) { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}
const kvm = new Map();
const KV = { async get(k) { return kvm.get(k) ?? null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
kvm.set("access:config", JSON.stringify({ requireApproval: false, roles: { Admin: { views: "*", admin: true } }, users: {} }));
globalThis.fetch = async (u, o) => {
  u = String(u);
  if (u.startsWith("https://apps.example")) { const b = JSON.parse(o.body); return new Response(JSON.stringify({ success: true, name: "N", email: b.email, role: "Admin" }), { status: 200 }); }
  throw new Error("unexpected " + u);
};
const DB = d1();
const env = { SYNC_CACHE: KV, LOOP_DB: DB, APPS_SCRIPT_URL: "https://apps.example/exec", STAFF_SESSION_SECRET: "x".repeat(40), ADMIN_KEY: "admin-key-123456" };
const ctx = { waitUntil() {} };
const call = async (q, { method = "GET", body, tok, admin } = {}) => {
  const h = {}; if (tok) h["X-Staff-Token"] = tok; if (admin) h["X-Admin-Key"] = "admin-key-123456";
  const r = await worker.fetch(new Request("https://w.example/?" + q, { method, headers: h, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) }), env, ctx);
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, t };
};
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const login = async (email) => (await call("action=staffLogin", { method: "POST", body: { email, password: "pw" } })).j.token;
const tokA = await login("amira@taager.com"), tokB = await login("omar@taager.com"), tokBoss = await login("boss@taager.com");
const iso = (m) => new Date(Date.now() - m * 60000).toISOString();

ok((await call("action=usagePing", { method: "POST", body: { sid: "abcdefgh1234" } })).s === 401, "ping without a staff session → 401");
ok((await call("action=usagePing", { tok: tokA })).s === 405, "ping must be POST");
ok((await call("action=usagePing", { method: "POST", tok: tokA, body: { sid: "x" } })).s === 400, "bad session id → 400");
ok((await call("action=usagePing", { method: "POST", tok: tokA, body: "not json" })).s === 400, "body must be JSON");

const T0 = iso(30);
let r = await call("action=usagePing", { method: "POST", tok: tokA, body: { sid: "sessAAAA1111", name: "Amira", email: "someone.else@taager.com", startedAt: T0, openMs: 60000, activeMs: 30000,
  tabs: [{ n: 0, at: T0, tab: "Overview", ms: 20000 }, { n: 1, at: iso(29), tab: "Supply Chain › Planner DOH", ms: 40000 }, { n: 2, at: "garbage", tab: "x", ms: 5 }], downloads: [{ n: 0, at: iso(28), what: "planner-doh.csv", rows: 340, tab: "Supply Chain › Planner DOH" }] } });
ok(r.s === 200 && r.j.success, "first update accepted");
let s = DB.raw.prepare("SELECT * FROM usage_sessions").all();
ok(s.length === 1 && s[0].email === "amira@taager.com", "e-mail comes from the signed token, not from the body (someone.else@ ignored)");
ok(DB.raw.prepare("SELECT COUNT(*) c FROM usage_tabs").get().c === 2, "tab with an invalid time is ignored");
r = await call("action=usagePing", { method: "POST", tok: tokA, body: { sid: "sessAAAA1111", startedAt: T0, openMs: 150000, activeMs: 90000,
  tabs: [{ n: 1, at: iso(29), tab: "Supply Chain › Planner DOH", ms: 130000 }, { n: 2, at: iso(27), tab: "Control › Usage Log", ms: 10000 }], downloads: [{ n: 0, at: iso(28), what: "planner-doh.csv", rows: 999 }] } });
s = DB.raw.prepare("SELECT * FROM usage_sessions").get();
ok(s.open_ms === 150000 && s.active_ms === 90000, "later update raises Open / Active");
ok(DB.raw.prepare("SELECT ms FROM usage_tabs WHERE seg = 1").get().ms === 130000, "tab time is updated in place (no duplicate row)");
ok(DB.raw.prepare("SELECT COUNT(*) c FROM usage_tabs").get().c === 3, "new tab segment added");
ok(DB.raw.prepare("SELECT rows FROM usage_downloads WHERE n = 0").get().rows === 340, "a download is stored once (re-sent copy ignored)");
await call("action=usagePing", { method: "POST", tok: tokA, body: { sid: "sessAAAA1111", startedAt: T0, openMs: 10, activeMs: 1 } });
ok(DB.raw.prepare("SELECT open_ms FROM usage_sessions").get().open_ms === 150000, "time never goes backwards (an old/late update cannot lower it)");
await call("action=usagePing", { method: "POST", tok: tokB, body: { sid: "sessAAAA1111", startedAt: T0, openMs: 99999999, activeMs: 99999999, tabs: [{ n: 9, at: iso(1), tab: "hijack", ms: 5 }] } });
ok(DB.raw.prepare("SELECT open_ms, email FROM usage_sessions WHERE sid='sessAAAA1111'").get().email === "amira@taager.com" && DB.raw.prepare("SELECT open_ms FROM usage_sessions WHERE sid='sessAAAA1111'").get().open_ms === 150000, "another user cannot overwrite somebody else's session");
ok(DB.raw.prepare("SELECT COUNT(*) c FROM usage_tabs WHERE tab='hijack'").get().c === 0, "…and cannot add tabs to it either");
await call("action=usagePing", { method: "POST", tok: tokB, body: { sid: "sessBBBB2222", name: "Omar", startedAt: iso(5), openMs: 9e12, activeMs: 9e12, tabs: [{ n: 0, at: iso(5), tab: "Overview", ms: 9e12 }] } });
const b = DB.raw.prepare("SELECT open_ms, active_ms FROM usage_sessions WHERE sid='sessBBBB2222'").get();
ok(b.open_ms === 86400000 && b.active_ms <= b.open_ms, "absurd times are clamped to 24 h, Active never exceeds Open");

ok((await call("action=usageLog", { tok: tokBoss })).s === 403, "Usage Log without the admin key → 403");
ok((await call("action=usageLog", { admin: true })).s === 401, "Usage Log without a staff session → 401");
r = await call("action=usageLog&from=" + cairoDay(new Date().toISOString()), { tok: tokBoss, admin: true });
ok(r.s === 200 && r.j.sessions.length === 2, "admin sees today's sessions (" + (r.j.sessions || []).length + ")");
ok(r.j.tabs.length >= 3 && r.j.downloads.length === 1 && r.j.downloads[0].rows === 340, "tabs and downloads come with the sessions");
ok(r.j.online.indexOf("omar@taager.com") >= 0 && r.j.online.indexOf("amira@taager.com") >= 0, "both people are online (seen in the last 3 minutes)");
r = await call("action=usageLog&email=omar@taager.com&from=" + cairoDay(new Date().toISOString()), { tok: tokBoss, admin: true });
ok(r.j.sessions.length === 1 && r.j.sessions[0].email === "omar@taager.com" && r.j.tabs.every((t) => t.sid === "sessBBBB2222"), "filter by person");
r = await call("action=usageLog&from=2020-01-01&to=2020-01-02", { tok: tokBoss, admin: true });
ok(r.j.sessions.length === 0, "a date range with no activity is empty");
ok((await call("action=usageLog&from=bad", { tok: tokBoss, admin: true })).s === 400, "bad dates → 400");

ok(cairoDay("2026-10-30T22:30:00Z") === "2026-10-31" && cairoDay("2026-10-30T10:00:00Z") === "2026-10-30", "days are Cairo days (22:30 UTC is already the next day in Cairo)");
DB.raw.prepare("INSERT INTO usage_sessions VALUES ('oldoldold1','o@taager.com','O','Admin','2025-01-01T10:00:00.000Z','2025-01-01T10:10:00.000Z',1000,500,'2025-01-01')").run();
DB.raw.prepare("INSERT INTO usage_tabs VALUES ('oldoldold1',0,'2025-01-01T10:00:00.000Z','Overview',1000)").run();
DB.raw.prepare("INSERT INTO usage_downloads VALUES ('oldoldold1',0,'2025-01-01T10:00:00.000Z','x.csv',3,'Overview')").run();
await createUsage({ jsonResponse: () => null, staffSession: () => null, towerAdminOk: () => false }).prune(DB);
ok(DB.raw.prepare("SELECT COUNT(*) c FROM usage_sessions WHERE sid='oldoldold1'").get().c === 0 && DB.raw.prepare("SELECT COUNT(*) c FROM usage_tabs WHERE sid='oldoldold1'").get().c === 0 && DB.raw.prepare("SELECT COUNT(*) c FROM usage_downloads WHERE sid='oldoldold1'").get().c === 0, "anything older than 6 months is deleted (sessions, tabs, downloads)");
ok(DB.raw.prepare("SELECT COUNT(*) c FROM usage_sessions").get().c === 2, "recent sessions are kept");
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
