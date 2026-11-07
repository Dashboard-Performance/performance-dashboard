// v1.17.0 — Supply conversion copied to its own sheet at 11:30 Cairo, right after Planner DOH
const RealDate = Date;
// Egypt runs DST for part of the year, so never hardcode a UTC instant for a Cairo wall clock — resolve it.
const cairoHM = (ms) => { const p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new RealDate(ms)).forEach((x) => { p[x.type] = x.value; }); return Number(p.hour) * 60 + Number(p.minute); };
const atCairo = (day, hh, mm) => {
  const want = hh * 60 + mm;
  for (let off = 0; off <= 5 * 60; off += 1) { const t = RealDate.parse(day + "T00:00:00Z") + (want - off) * 60000; if (cairoHM(t) === want) return t; }
  throw new Error("no UTC instant maps to " + day + " " + hh + ":" + mm + " Cairo");
};
let NOW = atCairo("2026-10-25", 10, 0);
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const kv = new Map(); const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
let calls = { doh: 0, conv: 0 }, order = [], convAnswer = { success: true, month: "2026-10", skus: 1480 };
globalThis.fetch = async (u, o) => {
  const b = o && o.body ? JSON.parse(o.body) : {};
  if (b.action === "planner_doh_rows") { calls.doh++; order.push("doh"); return new Response(JSON.stringify({ success: true, rows: 800, yday: "2026-10-24" })); }
  if (b.action === "supply_conversion_export") { calls.conv++; order.push("conv"); return new Response(JSON.stringify(b.serviceKey === "svc-1234567890abcdef" ? convAnswer : { success: false, message: "no key" })); }
  throw new Error("offline in this test");
};
kv.set("export:plannerdoh:payload", JSON.stringify({ cols: ["sku"], rows: [["SKU1"]], yday: "2026-10-24", sentAt: "2026-10-25T06:00:00.000Z" }));
const env = { SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://apps.example/exec", SERVICE_KEY: "svc-1234567890abcdef", DECLINE_DIGEST: "off" };
const tick = async () => { const w = []; await worker.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };

await tick(); ok(calls.conv === 0 && calls.doh === 0, "10:00 Cairo → neither export runs");
NOW = atCairo("2026-10-25", 11, 0); await tick();
ok(calls.doh === 1 && calls.conv === 0, "11:00 Cairo → Planner DOH only, Supply conversion still waits");
NOW = atCairo("2026-10-25", 11, 29); await tick();
ok(calls.conv === 0, "11:29 Cairo → still too early (minute is respected, not just the hour)");
NOW = atCairo("2026-10-25", 11, 30); await tick();
ok(calls.conv === 1 && JSON.parse(kv.get("export:supplyconv:2026-10-25")).state === "done", "11:30 Cairo → Supply conversion written");
ok(order.join(">") === "doh>conv", "the two never run at the same moment — Planner DOH first, then Supply conversion");
NOW += 60e3; await tick(); NOW += 30 * 60e3; await tick();
ok(calls.conv === 1, "only once a day");
let j = await (await worker.fetch(new Request("https://w/?action=supplyConversionExport"), env, {})).json();
ok(j.success && j.at === "11:30 Cairo" && j.last && j.last.skus === 1480, "status shows the time and the last run");
// a failure retries after 15 minutes, up to 3 tries
NOW = atCairo("2026-10-26", 11, 30); convAnswer = { success: false, message: "Sheet with GID 1516662734 not found." };
const cFail = calls.conv; await tick(); let st = JSON.parse(kv.get("export:supplyconv:2026-10-26"));
ok(st.state === "failed" && /1516662734/.test(st.message), "a failure is kept with the reason");
const cAfterFail = calls.conv;
NOW += 5 * 60e3; await tick(); ok(calls.conv === cAfterFail, "no retry before 15 minutes");
convAnswer = { success: true, month: "2026-10", skus: 1477 }; NOW += 11 * 60e3; await tick();
ok(JSON.parse(kv.get("export:supplyconv:2026-10-26")).state === "done", "retried after 15 minutes and written");
// late in the day nothing new starts
NOW = atCairo("2026-10-27", 14, 0); const c0 = calls.conv; await tick();
ok(calls.conv === c0, "14:00 Cairo → too late, not started");
// manual run
j = await (await worker.fetch(new Request("https://w/?action=supplyConversionExport&run=1&email=someone@taager.com"), env, {})).json();
ok(!j.success && calls.conv === c0, "run now: non-owner refused");
j = await (await worker.fetch(new Request("https://w/?action=supplyConversionExport&run=1&email=youssef.hanafy@taager.com"), env, {})).json();
ok(j.success && calls.conv === c0 + 1, "run now: owner → written immediately, whatever the time");
// off switch
env.SUPPLY_CONVERSION_EXPORT = "off"; NOW = atCairo("2026-10-28", 11, 30); const c1 = calls.conv; await tick();
ok(calls.conv === c1, "SUPPLY_CONVERSION_EXPORT = off → not written");
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
