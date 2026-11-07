// v1.18.0 — Metabase prewarm: the cron keeps every source fresh in KV and the dashboard is served that copy at once.
process.env.TZ = "UTC";
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const m = new Map();
const KV = { async get(k, o) { const v = m.get(k); if (v == null) return null; if (o && o.type === "arrayBuffer") return v instanceof ArrayBuffer ? v : new TextEncoder().encode(v).buffer; return typeof v === "string" ? v : new TextDecoder().decode(v); },
  async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
const env = { SYNC_CACHE: KV, SHEET_ID: "x" };
let calls = 0, version = 1;
globalThis.fetch = async (u) => { const s = String(u); if (/metabase\.taager\.com/.test(s)) calls++;
  if (/\.csv|\/csv/.test(s)) return new Response("CREATION_DATE,TAGER_ID,X\n" + Array.from({ length: 100 + version }, (_, i) => "2026-11-0" + (1 + (i % 7)) + "," + i + ",1").join("\n") + "\n", { headers: { "Content-Type": "text/csv" } });
  return new Response(JSON.stringify(Array.from({ length: 50 + version }, (_, i) => ({ id: "S" + i }))), { headers: { "Content-Type": "application/json" } }); };
const MAIN = "2099497960";
async function get(gid, live) {
  const r = await worker.fetch(new Request("https://w/?action=metabase&gid=" + gid + (live ? "&live=1" : "")), env, { waitUntil() {} });
  const body = r.headers.get("Content-Encoding") === "gzip" ? await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text() : await r.text();
  return { src: r.headers.get("X-Data-Source"), at: r.headers.get("X-Fetched-At"), body, expose: r.headers.get("Access-Control-Expose-Headers") || "" };
}
const rows = (t) => t.trim().split("\n").length - 1;
// the scheduled handler runs the prewarm only on minutes divisible by 10
const RealDate = Date; let fakeNow = RealDate.UTC(2026, 10, 7, 10, 3);
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fakeNow])); } static now() { return fakeNow; } };
const waits = []; const ctx = { waitUntil(p) { waits.push(p); } };
await worker.scheduled({}, env, ctx); await Promise.allSettled(waits); waits.length = 0;
ok(!m.get("mb:prewarm:last"), "10:03 → no prewarm (runs every 10 minutes)");
fakeNow = RealDate.UTC(2026, 10, 7, 10, 10); calls = 0;
await worker.scheduled({}, env, ctx); await Promise.allSettled(waits); waits.length = 0;
const last = JSON.parse(m.get("mb:prewarm:last") || "null");
ok(last && Object.keys(last.sources).length === 13 && Object.values(last.sources).every((x) => x.source === "live"), "10:10 → every one of the 13 Metabase sources fetched and saved (" + (last ? Object.keys(last.sources).length : 0) + ")");
ok(!m.get("mb:prewarm:lock"), "the lock is released when the prewarm ends");
calls = 0; version = 2;
let r = await get(MAIN);
ok(r.src === "prewarmed" && calls === 0 && rows(r.body) === 101 && r.at && /X-Fetched-At/.test(r.expose), "dashboard asks for Main 3 min later → the prewarmed copy straight away, Metabase not called");
r = await get(MAIN, true);
ok(r.src === "live" && calls === 1 && rows(r.body) === 102, "Refresh (&live=1) → asks Metabase live and gets the newer answer");
fakeNow += 16 * 60 * 1000; calls = 0; version = 3;
r = await get(MAIN);
ok(r.src === "live" && calls === 1 && rows(r.body) === 103, "copy older than 15 minutes (prewarm missed) → live as before");
m.set("mb:prewarm:lock", "x"); fakeNow = RealDate.UTC(2026, 10, 7, 10, 40); calls = 0;
await worker.scheduled({}, env, ctx); await Promise.allSettled(waits); waits.length = 0;
ok(calls === 0, "a prewarm already running → the next one does not start on top of it (" + calls + " Metabase calls)");
globalThis.Date = RealDate;
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
