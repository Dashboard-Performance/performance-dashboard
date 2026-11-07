// v1.17.0 — Metabase "last good copy" guard: a failed / partial answer never reaches the dashboard.
process.env.TZ = "UTC";
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const m = new Map();
const KV = { async get(k, o) { const v = m.get(k); if (v == null) return null; if (o && o.type === "arrayBuffer") return v instanceof ArrayBuffer ? v : new TextEncoder().encode(v).buffer; return typeof v === "string" ? v : new TextDecoder().decode(v); },
  async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
const env = { SYNC_CACHE: KV, SHEET_ID: "x" };
let next = null; // what Metabase answers
globalThis.fetch = async (u) => { const x = typeof next === "function" ? next(u) : next; if (x instanceof Error) throw x; return new Response(x.body, { status: x.status || 200, headers: { "Content-Type": x.ct || "text/csv" } }); };
const csv = (months) => "CREATION_DATE,TAGER_ID,X\n" + Object.keys(months).map((k) => Array.from({ length: months[k] }, (_, i) => k + "-0" + (1 + (i % 9)) + "," + i + ",1").join("\n")).join("\n") + "\n";
const MAIN = "2099497960", PRODUCTS = "1779314157";
async function get(gid) {
  const r = await worker.fetch(new Request("https://w/?action=metabase&live=1&gid=" + gid), env, { waitUntil() {} });
  let body = r.headers.get("Content-Encoding") === "gzip" ? await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text() : await r.text();
  return { s: r.status, src: r.headers.get("X-Data-Source"), at: r.headers.get("X-Cached-At"), why: r.headers.get("X-Cache-Reason"), body, expose: r.headers.get("Access-Control-Expose-Headers") || "" };
}
const rows = (t) => t.trim().split("\n").length - 1;

next = { body: csv({ "2026-08": 300, "2026-09": 1000, "2026-10": 600 }) };
let r = await get(MAIN);
ok(r.s === 200 && r.src === "live" && rows(r.body) === 1900 && /X-Data-Source/.test(r.expose), "healthy answer → live, kept as the last good copy");
const goodAt = JSON.parse(m.get("mb:meta:" + MAIN)).at;

next = { body: csv({ "2026-08": 300, "2026-09": 1000, "2026-10": 250 }) }; // October collapsed (partial refresh)
r = await get(MAIN);
ok(r.src === "cache" && rows(r.body) === 1900 && r.at === goodAt && /2026-10 rows fell from 600 to 250/.test(r.why), "same month suddenly lower → last good copy + reason (" + r.why + ")");

next = { body: csv({ "2026-08": 300, "2026-09": 400, "2026-10": 610 }) }; // total almost the same but September lost rows
r = await get(MAIN);
ok(r.src === "cache" && /2026-09/.test(r.why), "a past month lost rows → cached (" + r.src + " " + r.why + ")");

next = { body: "", status: 500 }; r = await get(MAIN);
ok(r.src === "cache" && /HTTP 500/.test(r.why) && rows(r.body) === 1900, "Metabase HTTP 500 → cached");
next = new Error("boom"); r = await get(MAIN);
ok(r.src === "cache" && /did not answer/.test(r.why), "Metabase down → cached");
next = { body: "<html>error</html>" }; r = await get(MAIN);
ok(r.src === "cache" && /not CSV/.test(r.why), "error page instead of CSV → cached");

next = { body: csv({ "2026-09": 1000, "2026-10": 700 }) }; // August rolled out of the window, October grew
r = await get(MAIN);
ok(r.src === "live", "oldest month rolled out of the query window (others fine) → live");
next = { body: csv({ "2026-08": 280, "2026-09": 1000, "2026-10": 720 }) }; // normal growth, oldest month trimmed a bit
r = await get(MAIN);
ok(r.src === "live" && rows(r.body) === 2000, "normal day (October grew, oldest month trimmed) → live");

// a smaller answer that stays → accepted after 12h (simulated) or by an owner
next = { body: csv({ "2026-08": 280, "2026-09": 1000, "2026-10": 100 }) };
r = await get(MAIN); ok(r.src === "cache", "smaller answer → cached the first time");
const sus = JSON.parse(m.get("mb:sus:" + MAIN)); sus.first -= 13 * 3600e3; m.set("mb:sus:" + MAIN, JSON.stringify(sus));
r = await get(MAIN); ok(r.src === "live" && rows(r.body) === 1380, "…the same smaller answer for 12h → accepted as the new normal");

// JSON sources: total row check + Metabase error objects
const js = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: "S" + i, name: "p {" + i + "}" })));
next = { body: js(500), ct: "application/json" }; r = await get(PRODUCTS);
ok(r.src === "live" && JSON.parse(r.body).length === 500, "JSON source healthy → live");
next = { body: js(200), ct: "application/json" }; r = await get(PRODUCTS);
ok(r.src === "cache" && JSON.parse(r.body).length === 500 && /rows fell from 500 to 200/.test(r.why), "JSON source lost 60% of rows → cached");
next = { body: JSON.stringify({ status: "failed", error: "Query timed out" }), ct: "application/json" }; r = await get(PRODUCTS);
ok(r.src === "cache" && /Metabase error/.test(r.why), "Metabase error object → cached");
r = await worker.fetch(new Request("https://w/?action=metabaseStatus"), env, {});
const st = (await r.json()).sources;
ok(st[PRODUCTS].lastGood.rows === 500 && /Metabase error/.test(st[PRODUCTS].lastProblem.why), "status endpoint: last good copy + last problem per source");

// ---- the 1st of a month: the query window moves (previous month + this month so far), the whole older month drops out
{
  const MAIN2 = "2099497960";
  m.delete("mb:meta:" + MAIN2); m.delete("mb:good:" + MAIN2); m.delete("mb:sus:" + MAIN2);
  next = { body: csv({ "2026-09": 1000, "2026-10": 1100 }) }; await get(MAIN2);
  next = { body: csv({ "2026-10": 1130 }) }; // September left the window, October complete
  r = await get(MAIN2);
  ok(r.src === "live" && rows(r.body) === 1130, "new month: the older month left the window, the rest is fine → live (was held back as 'rows fell 46%')");
  m.delete("mb:meta:" + MAIN2); m.delete("mb:good:" + MAIN2); m.delete("mb:sus:" + MAIN2);
  next = { body: csv({ "2026-09": 1000, "2026-10": 1100 }) }; await get(MAIN2);
  next = { body: csv({ "2026-10": 400 }) }; // the month that stays collapsed
  r = await get(MAIN2);
  ok(r.src === "cache" && /2026-10 rows fell from 1,100 to 400/.test(r.why), "new month but the month that stays lost 64% → still cached (" + r.why + ")");
  // a source that shows the current month only restarts on the 1st
  const SEG = "620123165";
  next = { body: js(679), ct: "application/json" }; r = await get(SEG);
  next = { body: js(50), ct: "application/json" }; r = await get(SEG);
  ok(r.src === "cache" && /rows fell/.test(r.why), "Merchant Segmentation: 679 → 50 rows in the SAME month → cached");
  const meta = JSON.parse(m.get("mb:meta:" + SEG)); meta.at = "2020-01-15T10:00:00.000Z"; m.set("mb:meta:" + SEG, JSON.stringify(meta));
  r = await get(SEG);
  ok(r.src === "live" && JSON.parse(r.body).length === 50, "Merchant Segmentation: the last good copy is from an earlier month → the smaller answer is accepted");
  // other JSON sources are not touched by that rule
  const BI = "22283311";
  next = { body: js(500), ct: "application/json" }; await get(BI);
  const meta2 = JSON.parse(m.get("mb:meta:" + BI)); meta2.at = "2020-01-15T10:00:00.000Z"; m.set("mb:meta:" + BI, JSON.stringify(meta2));
  next = { body: js(1), ct: "application/json" }; r = await get(BI);
  ok(r.src === "cache" && JSON.parse(r.body).length === 500, "Beginning Inventory: 500 → 1 row is still held back even on a new month");
  // the same 1-row answer for 13h is NOT auto-accepted (broken export, 1 Nov 2026); an owner accept still works
  const susB = JSON.parse(m.get("mb:sus:" + BI)); susB.first -= 13 * 3600e3; m.set("mb:sus:" + BI, JSON.stringify(susB));
  r = await get(BI);
  ok(r.src === "cache" && JSON.parse(r.body).length === 500 && /one row only/.test(r.why), "Beginning Inventory: 1 row for 13h → still held back (" + r.why + ")");
  m.set("mb:accept:" + BI, "1"); r = await get(BI);
  ok(r.src === "live" && JSON.parse(r.body).length === 1, "…an owner can still accept it on purpose");
}
// ---- Supply Chain: actual returns (Apps Script → Return_Archive_YYYY-MM / Return_RCV)
{
  let as = null, calls = 0;
  globalThis.fetch = async (u, o) => { calls++; const b = JSON.parse(o.body); if (as instanceof Error) throw as; return new Response(JSON.stringify(as(b)), { headers: { "Content-Type": "application/json" } }); };
  const env2 = { SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://script.example/exec", SERVICE_KEY: "service-key-123456" };
  const ret = async (q) => (await worker.fetch(new Request("https://w/?action=actualReturns&month=2026-10" + (q || "")), env2, {})).json();
  as = (b) => ({ success: b.action === "actual_returns" && b.serviceKey === "service-key-123456" && b.month === "2026-10", file: "Return_Archive_2026-10", rows: 3, total: 1000, skus: { EG030401BAAN99: 449, SE0105: 315 } });
  let j = await ret();
  ok(j.success && j.source === "live" && j.skus.EG030401BAAN99 === 449 && j.file === "Return_Archive_2026-10", "actual returns: Apps Script sums Return_RCV 'Product is good' per SKU (BAAN99 449)");
  const c0 = calls; j = await ret(); ok(calls === c0 && j.skus.SE0105 === 315, "cached for 20 minutes (no extra Apps Script call)");
  as = () => ({ success: true, total: 300, skus: { EG030401BAAN99: 100 } });
  j = await ret("&refresh=1"); ok(j.source === "cache" && j.skus.EG030401BAAN99 === 449 && /fell from 1,000 to 300/.test(j.reason), "returns total suddenly −70% → last good copy");
  as = new Error("down"); j = await ret("&refresh=1"); ok(j.source === "cache" && /did not answer/.test(j.reason), "Apps Script down → last good copy");
  as = () => ({ success: true, total: 1200, skus: { EG030401BAAN99: 520 } }); j = await ret("&refresh=1"); ok(j.source === "live" && j.skus.EG030401BAAN99 === 520, "normal growth → live");
}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
