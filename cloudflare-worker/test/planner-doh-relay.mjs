// v1.17.0 — the Worker relays the Planner DOH table and keeps a copy for the 11:00 Cairo rewrite
const RealDate = Date;
const cairoHM = (ms) => { const p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new RealDate(ms)).forEach((x) => { p[x.type] = x.value; }); return Number(p.hour) * 60 + Number(p.minute); };
const atCairo = (day, hh, mm) => { const want = hh * 60 + mm;
  for (let off = 0; off <= 5 * 60; off += 1) { const t = RealDate.parse(day + "T00:00:00Z") + (want - off) * 60000; if (cairoHM(t) === want) return t; }
  throw new Error("no instant maps to " + day + " " + hh + ":" + mm + " Cairo"); };
let NOW = atCairo("2026-10-27", 9, 0);
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n + (c ? "" : " :: " + JSON.stringify(x))); };

const kv = new Map();
const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
const r2 = new Map();
const R2 = { async put(k, v) { r2.set(k, v); }, async get(k) { return r2.has(k) ? { text: async () => r2.get(k), body: r2.get(k) } : null; }, async head(k) { return r2.has(k) ? { size: r2.get(k).length, customMetadata: {} } : null; } };

let seen = [], answer = { success: true, rows: 0, yday: "" };
globalThis.fetch = async (u, o) => {
  const b = o && o.body ? JSON.parse(o.body) : {};
  if (b.action === "planner_doh_rows") { seen.push(b); return new Response(JSON.stringify(Object.assign({}, answer, { rows: b.rows.length, yday: b.yday }))); }
  return new Response(JSON.stringify({ success: true }));
};
const env = { SYNC_CACHE: KV, SNAPSHOTS: R2, APPS_SCRIPT_URL: "https://apps.example/exec", SERVICE_KEY: "svc-1234567890abcdef",
  DECLINE_DIGEST: "off", SUPPLY_CONVERSION_EXPORT: "off", INV_CATEGORY_EXPORT: "off", PLANNER_DOH_EXPORT: "on" };
const COLS = ["sku","name","cat","stock","placedYday","avg3","cr","dr","ndr","crUsed","expConf","diff","dohPlaced","dohAvg3"];
const table = (n) => ({ cols: COLS, yday: "2026-10-26", params: { cutoffDays: 5 }, floored: 2,
  rows: Array.from({ length: n }, (_, i) => ["SKU" + i, "Name " + i, "Home", 10, 5, 1.2, 50, 60, 30, 50, 2.5, 1.3, 4, 8]) });
const post = (body) => worker.fetch(new Request("https://w/?action=plannerDohRows", { method: "POST", body: JSON.stringify(body) }), env, { waitUntil() {} });
const tick = async () => { const w = []; await worker.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };

// ---- the dashboard sends the table
let j = await (await post(table(2500))).json();
ok(j.success && j.rows === 2500, "a 2,500-SKU table is accepted and written straight away", { success: j.success, rows: j.rows });
ok(seen.length === 1 && seen[0].serviceKey === "svc-1234567890abcdef", "Apps Script is called with the service key");
ok(seen[0].rows.length === 2500 && seen[0].cols.length === 14, "the whole table reaches Apps Script, compact form intact");
ok(j.stored === "r2", "and a copy is kept for the daily rewrite", j.stored);

// ---- a real answer, not an opaque one
j = await (await post({ cols: COLS, rows: [] })).json();
ok(!j.success && /No rows/.test(j.message), "an empty table is refused with a readable reason — the page can show it", j);
const bad = await worker.fetch(new Request("https://w/?action=plannerDohRows", { method: "GET" }), env, { waitUntil() {} });
ok(bad.status === 405, "GET cannot write the sheet", bad.status);

// ---- Apps Script refusing is reported, and the copy survives for the next attempt
seen = []; answer = { success: false, message: "Sheet with GID 693802633 not found." };
const before = r2.get("export:plannerdoh:payload");
j = await (await post(table(3))).json();
ok(!j.success && /693802633/.test(j.message), "a refusal from Apps Script comes back with its reason", j);
ok(r2.get("export:plannerdoh:payload") !== before, "the copy is stored before the write is attempted, so the 11:00 run can retry it");

// ---- the 11:00 Cairo run sends the stored copy; nothing is recomputed anywhere
answer = { success: true }; seen = [];
await tick();
ok(seen.length === 0, "09:00 Cairo → the daily run has not fired yet");
NOW = atCairo("2026-10-27", 11, 0); await tick();
ok(seen.length === 1 && seen[0].action === "planner_doh_rows" && seen[0].rows.length === 3,
   "11:00 Cairo → the stored table is sent to be written again", seen.length && seen[0].rows.length);
ok(!seen.some((b) => b.action === "planner_doh_export"), "the old 'go and compute it' call is gone");
const last = JSON.parse(kv.get("export:plannerdoh:2026-10-27"));
ok(last.state === "done" && last.sentAt, "the run records when the dashboard had sent that table", last);
seen = []; NOW += 30 * 60e3; await tick();
ok(seen.length === 0, "and it only runs once a day");

// ---- with nothing ever sent, it says so instead of writing anything
r2.clear(); kv.delete("export:plannerdoh:2026-10-28");
NOW = atCairo("2026-10-28", 11, 0); seen = [];
await tick();
ok(seen.length === 0, "nothing stored → nothing is written");
const st = JSON.parse(kv.get("export:plannerdoh:2026-10-28"));
ok(st.state === "failed" && /has not sent/.test(st.message), "and the reason is recorded for you to read", st.message);

// ---- KV is used when there is no R2 bucket
const envKv = Object.assign({}, env); delete envKv.SNAPSHOTS;
seen = [];
j = await (await worker.fetch(new Request("https://w/?action=plannerDohRows", { method: "POST", body: JSON.stringify(table(5)) }), envKv, { waitUntil() {} })).json();
ok(j.success && j.stored === "kv", "without an R2 bucket it falls back to KV rather than failing", j.stored);
ok(JSON.parse(kv.get("export:plannerdoh:payload")).rows.length === 5, "and the copy is really there");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
