// v1.17.0 — Inventory & DOH per category copied to its own tab at 11:45 Cairo, after Supply conversion
const RealDate = Date;
const cairoHM = (ms) => { const p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new RealDate(ms)).forEach((x) => { p[x.type] = x.value; }); return Number(p.hour) * 60 + Number(p.minute); };
const atCairo = (day, hh, mm) => { const want = hh * 60 + mm;
  for (let off = 0; off <= 5 * 60; off += 1) { const t = RealDate.parse(day + "T00:00:00Z") + (want - off) * 60000; if (cairoHM(t) === want) return t; }
  throw new Error("no instant maps to " + day + " " + hh + ":" + mm + " Cairo"); };
let NOW = atCairo("2026-10-28", 11, 0);
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n + (c ? "" : " :: " + JSON.stringify(x))); };

const kv = new Map();
const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
kv.set("export:plannerdoh:payload", JSON.stringify({ cols: ["sku"], rows: [["S1"]], yday: "2026-10-27", sentAt: "2026-10-28T06:00:00.000Z" }));
let calls = { conv: 0, cat: 0, rows: 0 }, order = [], rowsAnswer = { success: true, rows: 6 }, catAnswer = { success: true, rows: 6, sentAt: "2026-10-28T06:10:00.000Z" };
globalThis.fetch = async (u, o) => {
  const b = o && o.body ? JSON.parse(o.body) : {};
  if (b.action === "supply_conversion_export") { calls.conv++; order.push("conv"); return new Response(JSON.stringify({ success: true, month: "2026-10", skus: 1480 })); }
  if (b.action === "inv_category_export") { calls.cat++; order.push("cat"); return new Response(JSON.stringify(b.serviceKey === "svc-1234567890abcdef" ? catAnswer : { success: false, message: "no key" })); }
  if (b.action === "planner_doh_rows") return new Response(JSON.stringify({ success: true, rows: 1, yday: "2026-10-27" }));
  if (b.action === "inv_category_rows") { calls.rows++; return new Response(JSON.stringify(b.serviceKey === "svc-1234567890abcdef" ? rowsAnswer : { success: false, message: "Not allowed (WORKER_SERVICE_KEY)." })); }
  return new Response(JSON.stringify({ success: true }));
};
const env = { SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://apps.example/exec", SERVICE_KEY: "svc-1234567890abcdef", DECLINE_DIGEST: "off" };
const tick = async () => { const w = []; await worker.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };

await tick();
ok(calls.cat === 0, "11:00 Cairo → too early for the per-category tab");
NOW = atCairo("2026-10-28", 11, 30); await tick();
ok(calls.conv === 1 && calls.cat === 0, "11:30 → Supply conversion runs, per-category still waits");
NOW = atCairo("2026-10-28", 11, 44); await tick();
ok(calls.cat === 0, "11:44 → still too early (the minute is respected, not just the hour)");
NOW = atCairo("2026-10-28", 11, 45); await tick();
ok(calls.cat === 1 && JSON.parse(kv.get("export:invcat:2026-10-28")).state === "done", "11:45 → the tab is written");
ok(order.join(">").indexOf("conv>cat") >= 0, "the two never run at the same moment — Supply conversion first", order.join(">"));
NOW += 60e3; await tick(); NOW += 30 * 60e3; await tick();
ok(calls.cat === 1, "only once a day");

let j = await (await worker.fetch(new Request("https://w/?action=invCategoryExport"), env, {})).json();
ok(j.success && j.at === "11:45 Cairo" && j.last && j.last.rows === 6, "status shows the time and the last run", j.last);
ok(j.last.sentAt === "2026-10-28T06:10:00.000Z", "including when the dashboard had sent that table");

// a failure is kept with its reason and retried, up to three times
NOW = atCairo("2026-10-29", 11, 45);
catAnswer = { success: false, message: "Sheet with GID 398126694 not found." };
await tick();
let st = JSON.parse(kv.get("export:invcat:2026-10-29"));
ok(st.state === "failed" && /398126694/.test(st.message), "a failure is kept with the reason", st.message);
const n1 = calls.cat; NOW += 5 * 60e3; await tick();
ok(calls.cat === n1, "it waits before retrying rather than hammering Apps Script");
catAnswer = { success: true, rows: 6 }; NOW += 11 * 60e3; await tick();
ok(JSON.parse(kv.get("export:invcat:2026-10-29")).state === "done", "and the retry writes it");

// run now, and the off switch
j = await (await worker.fetch(new Request("https://w/?action=invCategoryExport&run=1&email=someone@taager.com"), env, {})).json();
ok(!j.success, "run now: anyone else is refused");
const n2 = calls.cat;
j = await (await worker.fetch(new Request("https://w/?action=invCategoryExport&run=1&email=youssef.hanafy@taager.com"), env, {})).json();
ok(j.success && calls.cat === n2 + 1, "run now: the owner can write it immediately, outside the window");
env.INV_CATEGORY_EXPORT = "off"; NOW = atCairo("2026-10-30", 11, 45); const n3 = calls.cat; await tick();
ok(calls.cat === n3, "off → not written");

// ---- the dashboard posting the table through the Worker, which is what the button now does
const post = (b) => worker.fetch(new Request("https://w/?action=invCategoryRows", { method: "POST", body: JSON.stringify(b) }), env, { waitUntil() {} });
const table = { rows: [{ category: "Home", skus: 3, pcs: 200, value: 6000, dohValue: 20, dohPcs: 20 }], asOf: "2026-10-28" };
let p2 = await (await post(table)).json();
ok(p2.success && p2.rows === 6, "the dashboard's table is relayed and the real row count comes back", p2);
ok(calls.rows === 1, "Apps Script was actually called");

// the case that made the button lie: Apps Script refusing an action it does not know yet
rowsAnswer = { success: false, message: "Unknown action." };
p2 = await (await post(table)).json();
ok(!p2.success && /Unknown action/.test(p2.message),
   "a refusal now comes back with its reason instead of looking like success", p2);
rowsAnswer = { success: true, rows: 6 };

p2 = await (await post({ rows: [] })).json();
ok(!p2.success && /No rows/.test(p2.message), "an empty table is refused before it can clear the tab", p2);
const g2 = await worker.fetch(new Request("https://w/?action=invCategoryRows", { method: "GET" }), env, { waitUntil() {} });
ok(g2.status === 405, "GET cannot write the tab", g2.status);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
