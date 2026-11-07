// v1.17.0 — Planner DOH copied to the planning sheet at 11:00 Cairo (Worker times it, Apps Script writes it)
const RealDate = Date; let NOW = RealDate.parse("2026-10-20T07:30:00Z"); // 09:30 Cairo
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const kv = new Map(); const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
// The dashboard computes the table and the Worker keeps it; the daily run just hands that copy to
// Apps Script, which only writes. "rows" below is what Apps Script reports back after writing.
let calls = 0, answer = { success: true, rows: 812, yday: "2026-10-19" };
globalThis.fetch = async (u, o) => { const b = o && o.body ? JSON.parse(o.body) : {}; if (b.action === "planner_doh_rows") { calls++; return new Response(JSON.stringify(b.serviceKey === "svc-1234567890abcdef" ? answer : { success: false, message: "no" })); }
  if (b.action === "decline_digest_build") return new Response(JSON.stringify({ success: true, empty: true })); throw new Error("offline"); };
const env = { SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://apps.example/exec", SERVICE_KEY: "svc-1234567890abcdef", DECLINE_DIGEST: "off", SUPPLY_CONVERSION_EXPORT: "off", INV_CATEGORY_EXPORT: "off" };
// what the dashboard last sent, as the Worker stores it (no R2 bucket in this test → KV)
kv.set("export:plannerdoh:payload", JSON.stringify({ cols: ["sku"], rows: [["SKU1"], ["SKU2"]], yday: "2026-10-19", sentAt: "2026-10-20T06:00:00.000Z" }));
const tick = async () => { const w = []; await worker.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };
await tick(); ok(calls === 0, "before 11:00 Cairo → nothing");
NOW = RealDate.parse("2026-10-20T09:00:30Z"); await tick(); // 11:00 Cairo
ok(calls === 1 && JSON.parse(kv.get("export:plannerdoh:2026-10-20")).state === "done", "11:00 Cairo → the stored table is written once");
NOW += 60e3; await tick(); NOW += 3600e3; await tick(); ok(calls === 1, "only once a day");
NOW = RealDate.parse("2026-10-21T09:00:00Z"); answer = { success: false, message: "Sheet with GID 693802633 not found." }; await tick();
ok(JSON.parse(kv.get("export:plannerdoh:2026-10-21")).state === "failed", "failure is kept with the reason");
answer = { success: true, rows: 800, yday: "2026-10-20" }; NOW += 16 * 60e3; await tick();
ok(calls === 3 && JSON.parse(kv.get("export:plannerdoh:2026-10-21")).state === "done", "retried after 15 minutes");
let j = await (await worker.fetch(new Request("https://w/?action=plannerDohExport"), env, {})).json();
ok(j.success && j.last && j.last.rows === 800, "status shows the last copy (800 rows)");
j = await (await worker.fetch(new Request("https://w/?action=plannerDohExport&run=1&email=x@taager.com"), env, {})).json();
ok(!j.success, "run now: non-owner refused");
j = await (await worker.fetch(new Request("https://w/?action=plannerDohExport&run=1&email=youssef.hanafy@taager.com"), env, {})).json();
ok(j.success && calls === 4, "run now: owner → written immediately");
ok(JSON.parse(kv.get("export:plannerdoh:last")).sentAt === "2026-10-20T06:00:00.000Z", "and the status carries when the dashboard sent that table");
env.PLANNER_DOH_EXPORT = "off"; NOW = RealDate.parse("2026-10-22T09:00:00Z"); await tick(); ok(calls === 4, "off → not written");
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
