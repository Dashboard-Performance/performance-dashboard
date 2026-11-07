// =============================================================================
// v1.17.0 — Command Loop: Scoring Engine → Diagnose → Route → Tasks → Follow-up
//                       + the signals the merchant portal turns into notifications.
//
// Everything here is controlled from the dashboard (Control → Command Loop), and
// only Admin / Country Manager can change it. The settings live in KV "loop:config"
// and are merged over DEFAULT_CONFIG, so a missing value always has a default.
//
// Storage:
//   D1 (binding LOOP_DB)  loop_cases  — one row per case/task (status, owner, evidence…)
//                         loop_events — the history of every case (who did what, when)
//   KV (SYNC_CACHE)       loop:config, loop:scores (latest scores, gzip), loop:signals
//                         (per-merchant data for the portal, gzip), loop:run (last run),
//                         loop:prices (price snapshot for PRICE_CHANGE), loop:lock (run lock)
//
// Data (same sources the dashboard already uses):
//   Main / Daily_Performance  Metabase CSV (gid 2099497960)  — read by HEADER NAME
//   Inventory                 Google Sheet tab 1780730573 (gviz CSV)
//   Products Debundle Map     Google Sheet tab 1409034448 (gviz CSV)
//   Availability Locking      Metabase JSON (gid 2085802038)
//   Products Info             Metabase JSON (gid 531154071) — optional (price / website status)
// =============================================================================

export const LOOP_VERSION = "1.17.0";

// ----------------------------------------------------------------------------- reasons
// label = what people read; family = de-dup key for the case (one open case per family+entity)
export const REASONS = {
  STOCK_OUT:           { label: "Out of stock",                    family: "STOCK",   level: "sku" },
  STOCK_LOW:           { label: "Stock running out (DOH)",         family: "STOCK",   level: "sku" },
  BUNDLE_SINGLE_SHORT: { label: "A single inside the bundle is short", family: "STOCK", level: "sku" },
  LISTING_ISSUE:       { label: "Listing issue (website status / expiry)", family: "LISTING", level: "sku" },
  PRICE_CHANGE:        { label: "Price changed + drop",            family: "PRICE",   level: "sku" },
  SKU_WIDE_DEMAND:     { label: "Demand down across merchants",    family: "DEMAND_SKU", level: "sku" },
  CR_DROP_SKU:         { label: "CR down on the product (overall)", family: "CR_SKU", level: "sku" },
  DR_DROP_SKU:         { label: "DR down on the product (overall)", family: "DR_SKU", level: "sku" },
  CM3_DROP:            { label: "CM3 down",                         family: "CM3_SKU", level: "sku" },
  NEGATIVE_CM3:        { label: "Negative CM3",                     family: "CM3_SKU", level: "sku" },
  PARTIAL_WATCH:       { label: "Partial drop (watch)",             family: "WATCH",   level: "sku" },
  LOCK_LOW:            { label: "Lock running out",                 family: "LOCK",    level: "match" },
  LOCK_EXPIRING:       { label: "Lock expiring",                    family: "LOCK",    level: "match" },
  LOCK_REQUEST:        { label: "Merchant asked for a lock update", family: "LOCK_REQUEST", level: "match" },
  MERCHANT_DROP:       { label: "Merchant dropped",                 family: "MERCHANT", level: "merchant" },
  MATCH_DROP:          { label: "Match dropped (merchant × SKU)",   family: "MATCH",   level: "match" },
  RELAUNCH:            { label: "Stock is back — relaunch merchants", family: "RELAUNCH", level: "acm" },
  PPM_LOW:             { label: "PPM / piece below the category target", family: "PPM", level: "sku" },
  CATEGORY_DROP:       { label: "Category down (overall)",          family: "CATEGORY", level: "category" },
  ACM_DROP:            { label: "ACM portfolio down (overall)",     family: "ACM", level: "acmall" },
  MANUAL:              { label: "Manual task",                      family: "MANUAL",  level: "manual" }
};

const ACM_ACTIONS = ["Called merchant", "Checked ads / audience", "Offered alternative SKU", "Checked addresses (DR)", "Merchant paused on purpose"];
export const DEFAULT_CONFIG = {
  version: 1,
  // TEST MODE (on by default): every task, bell notification and merchant notification reaches ONLY these emails.
  // Owners are still calculated, so you see exactly who WOULD get each task. Switch it off in Control → Command Loop → Overview.
  testMode: { on: true, recipients: ["youssef.hanafy@taager.com"] },
  engine: { enabled: true, runHours: [10, 15], staleDataDays: 2 },
  scoring: {
    threshold: 70, watchHigh: 90, minVolume: 5, minHistoryDays: 5, rowCapAlert: 20000,
    metrics: { demand: true, cr: true, dr: true, cm3: true },
    windows: { demand: { r: [1, 1], h: [2, 8] }, cr: { r: [1, 1], h: [2, 8] }, dr: { r: [6, 6], h: [7, 13] }, cm3: { r: [6, 6], h: [7, 13] } }
  },
  diagnose: {
    dohLow: 4, dohWindowDays: 3, dohRecovered: 7, lockCoverDays: 2, lockAvgDays: 7, lockExpiryDays: 3, lockWaitsForStock: true, lockMinFree: 1,
    lockNeedsUse: true,                            // v1.18.0 — no Lock running out / Lock expiring task (or N5 / N6) while the lock was never used (QUANTITY_USED = 0)
    priceLookbackDays: 7, skuWideShare: 60, skuWideMinMerchants: 3, minActiveDemand: 5,
    proactiveStock: true, proactiveLock: true, partialWatch: true,
    ppmFixPct: 80, ppmMinDelivered: 30,            // PPM_LOW: PPM / piece (delivered, D6..D12) below 80% of the category target
    categoryMinMerchants: 5, acmMinMerchants: 5,    // CATEGORY_DROP / ACM_DROP need at least this many active merchants
    merchantDropMinSkus: 1                          // merchant down overall → one MERCHANT_DROP even if only 1 SKU explains it
  },
  tasks: {
    followUpDays: 7, recoverScore: 70, escalateLevel2: 2, autoClearUntouched: true, dismissDays: 7,
    maxPerPerson: 10, chainRelaunch: true, notifyNewTasks: true, notifyEscalations: true,
    // quality gates — fewer, more important tasks
    minImpact: 2000,      // EGP/day at stake below this → no task (lock requests and manual tasks are always kept)
    confirmDays: 2,       // a drop must show on 2 days in a row (the same check one day earlier) before it becomes a task
    maxNewPerRun: 30      // at most this many NEW tasks per run, biggest EGP/day first (the rest wait for the next run)
  },
  routing: {
    STOCK_OUT:           { section: "navDohPlanner", byAcm: false, sla: 24, enabled: true, actions: ["Raise PO", "Transfer stock", "Debundle", "Set ETA"] },
    STOCK_LOW:           { section: "navDohPlanner", byAcm: false, sla: 24, enabled: true, actions: ["Raise PO", "Transfer stock", "Debundle", "Set ETA"] },
    BUNDLE_SINGLE_SHORT: { section: "navDohPlanner", byAcm: false, sla: 24, enabled: true, actions: ["Raise PO for the single", "Debundle", "Set ETA"] },
    LISTING_ISSUE:       { section: "navInventory", byAcm: false, sla: 24, enabled: true, actions: ["Reactivated", "Fixed expiry", "Removed restriction"] },
    PRICE_CHANGE:        { section: "navPpmAnalystProducts", byAcm: false, sla: 48, enabled: true, actions: ["Reverted price", "Approved new price", "Running a promo"] },
    SKU_WIDE_DEMAND:     { section: "navMpDeclineWatch", byAcm: false, sla: 72, enabled: true, actions: ["Pushed to new merchants", "Creative refresh", "Price check"] },
    CR_DROP_SKU:         { section: "navPpmAnalystProducts", byAcm: false, sla: 48, enabled: true, actions: ["Checked price / offer", "Product quality check", "Escalated to Ops"] },
    DR_DROP_SKU:         { section: "navPpmAnalystProducts", byAcm: false, sla: 48, enabled: true, actions: ["Checked courier / area", "Product quality check", "Escalated to Ops"] },
    CM3_DROP:            { section: "navPpmAnalystProducts", byAcm: false, sla: 48, enabled: true, actions: ["Price update", "COGS check", "Stop promo"] },
    NEGATIVE_CM3:        { section: "navPpmAnalystProducts", byAcm: false, sla: 48, enabled: true, actions: ["Price update", "COGS check", "Stop promo"] },
    PARTIAL_WATCH:       { section: "navPpmAnalystProducts", byAcm: false, sla: 0, enabled: false, actions: [] },
    LOCK_LOW:            { section: "navAvailabilityLocking", byAcm: false, sla: 24, enabled: true, actions: ["Increased lock", "Extended lock", "Rejected"] },
    LOCK_EXPIRING:       { section: "navAvailabilityLocking", byAcm: false, sla: 24, enabled: true, actions: ["Extended lock", "Let it expire", "Rejected"] },
    LOCK_REQUEST:        { section: "navAvailabilityLocking", byAcm: false, sla: 24, enabled: true, actions: ["Approved", "Approved partly", "Rejected"] },
    MERCHANT_DROP:       { section: "navMerchantPerf", byAcm: true, sla: 24, enabled: true, actions: ACM_ACTIONS },
    MATCH_DROP:          { section: "navMerchantPerf", byAcm: true, sla: 24, enabled: false, actions: ACM_ACTIONS },
    RELAUNCH:            { section: "navMerchantPerf", byAcm: true, sla: 24, enabled: true, actions: ["Called merchants", "Ads relaunched", "Merchant not interested"] },
    PPM_LOW:             { section: "navCm3AnalystProducts", byAcm: false, sla: 48, enabled: true, actions: ["Price update", "Renegotiated cost", "Stopped promo", "Accepted (strategic SKU)"] },
    CATEGORY_DROP:       { section: "navTargetsCommercial", byAcm: false, sla: 48, enabled: true, actions: ["Pushed top SKUs", "Price / offer review", "New SKUs listed", "Escalated to Ops (CR / DR)"] },
    ACM_DROP:            { section: "navAcmPerf", byAcm: true, sla: 24, enabled: true, actions: ["Called top merchants", "Weekly plan with merchants", "Offered alternative SKUs", "Checked addresses (DR)"] },
    MANUAL:              { section: "navOverview", byAcm: false, sla: 48, enabled: true, actions: ["Done"] }
  },
  merchant: {
    enabled: true, window: { r: [1, 3], h: [4, 10] }, minVolume: 5, cooldownDays: 3, maxNewPerDay: 5, muteDays: 30,
    lockSuggestDays: 7, lockRequests: true,
    rules: {
      N1: { on: true, critical: 50 },          // demand drop on a SKU the merchant works on
      N2: { on: true, critical: 50 },          // CR drop on that SKU
      N3: { on: true, days: 4, critical: 2 },  // DOH running out
      N4: { on: true },                        // out of stock
      N5: { on: true, coverDays: 2, critical: 1, avgDays: 7 }, // lock remaining vs avg CONFIRMED pieces/day
      N6: { on: true, days: 3 },               // lock expiry date close
      N7: { on: true, doh: 7 },                // back in stock
      N8: { on: true, score: 90 }              // performance recovered
    },
    alternatives: { on: true, minDoh: 14, max: 3 }
  },
  exclusions: { skus: [], merchants: [] },
  // RE-CPA calculator (Merchants → RE-CPA and the merchant portal)
  cpa: { shipping: 99, safetyPct: 20, rateDays: 30, minOwnPieces: 20, showProductAverages: true, portal: true }
};

export const CLOSED = ["resolved", "auto_cleared", "cancelled", "upgraded"];
const OPENISH = ["open", "in_progress", "waiting", "done", "watch"];
export const ADMIN_ROLES = ["Admin", "Country Manager"];

// ----------------------------------------------------------------------------- small utils
const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
export function mergeConfig(base, over) {
  if (!isObj(over)) return JSON.parse(JSON.stringify(base));
  const out = Array.isArray(base) ? [] : {};
  for (const k of Object.keys(base)) {
    const b = base[k], o = over[k];
    if (o === undefined || o === null) out[k] = JSON.parse(JSON.stringify(b));
    else if (isObj(b) && isObj(o)) out[k] = mergeConfig(b, o);
    else if (Array.isArray(b)) out[k] = Array.isArray(o) ? o : JSON.parse(JSON.stringify(b));
    else if (typeof b === "number") out[k] = Number.isFinite(+o) ? +o : b;
    else if (typeof b === "boolean") out[k] = !!o;
    else out[k] = o;
  }
  // keys that only exist in the override (e.g. a new routing reason) are kept as-is
  for (const k of Object.keys(over)) if (!(k in base)) out[k] = over[k];
  return out;
}
export function num(v) { if (v == null) return 0; if (typeof v === "number") return Number.isFinite(v) ? v : 0; const n = parseFloat(String(v).replace(/[,\s%]/g, "")); return Number.isFinite(n) ? n : 0; }
export function cairoToday(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now || new Date());
}
export function cairoHour(now) { return +new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hour12: false }).format(now || new Date()) % 24; }
export function addDays(ymd, n) { const d = new Date(Date.parse(ymd + "T00:00:00Z") + n * 864e5); return d.toISOString().slice(0, 10); }
export function dayDiff(a, b) { return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5); }
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function toYmd(v) {
  const s = String(v == null ? "" : v).trim(); if (!s) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = /^Date\((\d{4}),(\d{1,2}),(\d{1,2})/.exec(s); if (m) return m[1] + "-" + String(+m[2] + 1).padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(s); if (m && MONTHS[m[1].toLowerCase()]) return m[3] + "-" + String(MONTHS[m[1].toLowerCase()]).padStart(2, "0") + "-" + m[2].padStart(2, "0");
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0"); // M/D/YYYY (Sheets)
  const t = Date.parse(s); if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return "";
}
const normKey = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
export function normAcm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;

// ----------------------------------------------------------------------------- CSV / table readers
export function csvParser(onRow) {
  let row = [], field = "", inQ = false, quoteSeen = false, first = true, skipLF = false;
  return {
    push(chunk) {
      if (first) { if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1); first = false; }
      let i0 = 0;
      if (skipLF && chunk.charCodeAt(0) === 10) i0 = 1;
      skipLF = false;
      for (let i = i0; i < chunk.length; i++) {
        const ch = chunk.charCodeAt(i);
        if (inQ) {
          if (ch === 34) { inQ = false; quoteSeen = true; continue; }
          const j = chunk.indexOf('"', i); if (j === -1) { field += chunk.slice(i); break; }
          field += chunk.slice(i, j); i = j - 1; continue;
        }
        if (ch === 34) { if (quoteSeen) field += '"'; inQ = true; quoteSeen = false; continue; }
        quoteSeen = false;
        if (ch === 44) { row.push(field); field = ""; continue; }
        if (ch === 10 || ch === 13) { if (ch === 13) { if (i + 1 === chunk.length) skipLF = true; else if (chunk.charCodeAt(i + 1) === 10) i++; } row.push(field); field = ""; onRow(row); row = []; continue; }
        let j = i + 1;
        while (j < chunk.length) { const c2 = chunk.charCodeAt(j); if (c2 === 44 || c2 === 10 || c2 === 13 || c2 === 34) break; j++; }
        field += chunk.slice(i, j); i = j - 1;
      }
    },
    end() { if (field !== "" || row.length) { row.push(field); onRow(row); } }
  };
}
// Finds a column by header name (any of the candidates, case/space-insensitive); falls back to an index.
export function colFinder(header) {
  const H = header.map(normKey);
  return function (cands, fallback) { for (const c of cands) { const i = H.indexOf(normKey(c)); if (i >= 0) return i; } return fallback == null ? -1 : fallback; };
}
// Streams a CSV Response; onHeader(header) must return a row callback.
export async function streamCsv(res, onHeader) {
  let header = null, cb = null, rows = 0;
  const p = csvParser((c) => {
    if (!header) { header = c; cb = onHeader(c); return; }
    if (c.length === 1 && c[0] === "") return;
    rows++; cb(c);
  });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; p.push(value); }
  p.end();
  if (!header) throw new Error("empty CSV");
  if (/^\s*</.test(String(header[0]))) throw new Error("source did not return CSV (not shared / wrong link?)");
  return rows;
}
// Metabase public JSON (array of objects) or CSV → { header, rows }.
async function readTable(res) {
  const ct = String(res.headers.get("Content-Type") || "");
  if (ct.indexOf("csv") >= 0 || ct.indexOf("text/plain") >= 0) {
    const rows = []; let header = null;
    await streamCsv(res, (h) => { header = h; return (c) => rows.push(c); });
    return { header, rows };
  }
  const j = await res.json();
  const arr = Array.isArray(j) ? j : (j && j.data && Array.isArray(j.data.rows) ? null : []);
  if (arr) { const header = arr.length ? Object.keys(arr[0]) : []; return { header, rows: arr.map((o) => header.map((h) => o[h])) }; }
  const header = j.data.cols.map((c) => c.name || c.display_name); return { header, rows: j.data.rows };
}

// ----------------------------------------------------------------------------- data loading
export const GIDS = { catTargets: "1656655269", main: "2099497960", inventory: "1780730573", debundle: "1409034448", locks: "2085802038", productsInfo: "531154071", products: "1779314157" };
function gvizUrl(sheet, gid) { return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(sheet) + "/gviz/tq?gid=" + encodeURIComponent(gid) + "&tqx=out:csv&tq=" + encodeURIComponent("select *"); }

const N_DAYS = 15; // D0..D14 kept per entity (scores need ≤ D13, the portal chart shows D1..D14)
// Reads Daily_Performance (Main) into per-day arrays for Match / Merchant / SKU.
export async function loadMain(res, anchorToday) {
  const match = new Map(), merchant = new Map(), sku = new Map();
  let minDate = "", maxDate = "", total = 0, dupes = 0; const seen = new Set();
  const rows = []; // kept small: [ymd, mid, sku, placed, conf, deliv, cm3, gmv]
  const meta = { mName: new Map(), pName: new Map(), cat: new Map(), acm: new Map() };
  total = await streamCsv(res, (header) => {
    const f = colFinder(header);
    const C = {
      date: f(["CREATION_DATE", "DATE", "ORDER_DATE"], 0), mid: f(["TAGER_ID", "MERCHANT_ID"], 1), mName: f(["TAGER_NAME", "MERCHANT_NAME", "FULL_NAME"], 2),
      sku: f(["PRODUCT_ID", "SKU", "SKU_ID"], 3), pName: f(["PRODUCT_NAME", "SKU_NAME", "NAME"], 4), cat: f(["CATEGORY", "CATEGORY_L1"], 5),
      placed: f(["PLACED_PIECES"], 15), conf: f(["CONFIRMED_PIECES"], 16), deliv: f(["DELIVERED_PIECES"], 17),
      gmv: f(["PLACED_GMV"], 21), cm3: f(["CM3"], 28), acm: f(["ACM", "ACM_NAME", "ACCOUNT_MANAGER"], 31), ppm: f(["DELIVERED_PPM", "PPM", "TOTAL_PPM"], 27), dgmv: f(["DELIVERED_GMV"], 22)
    };
    return (c) => {
      const d = toYmd(c[C.date]), mid = String(c[C.mid] || "").trim(), s = String(c[C.sku] || "").trim();
      if (!d || !mid || !s) return;
      const k = d + "|" + mid + "|" + s; if (seen.has(k)) { dupes++; return; } seen.add(k);
      if (!minDate || d < minDate) minDate = d; if (!maxDate || d > maxDate) maxDate = d;
      const catv = String(c[C.cat] || "").trim().slice(0, 60), acmv = String(c[C.acm] || "").trim().slice(0, 80);
      rows.push([d, mid, s, num(c[C.placed]), num(c[C.conf]), num(c[C.deliv]), num(c[C.cm3]), num(c[C.gmv]), C.ppm >= 0 ? num(c[C.ppm]) : 0, catv, acmv && acmv !== "Unassigned" ? acmv : "", num(c[C.dgmv])]);
      if (c[C.mName]) meta.mName.set(mid, String(c[C.mName]).slice(0, 120));
      if (c[C.pName]) meta.pName.set(s, String(c[C.pName]).slice(0, 160));
      if (c[C.cat]) meta.cat.set(s, String(c[C.cat]).slice(0, 60));
      const a = String(c[C.acm] || "").trim(); if (a && a !== "Unassigned") meta.acm.set(mid, a.slice(0, 80));
    };
  });
  // the anchor (D0): today in Cairo, unless the data stops earlier (then D0 = the day after the last data day)
  let today = anchorToday, stale = 0;
  if (maxDate && maxDate < addDays(anchorToday, -1)) { stale = dayDiff(addDays(anchorToday, -1), maxDate); today = addDays(maxDate, 1); }
  const mk = () => ({ p: new Float64Array(N_DAYS), c: new Float64Array(N_DAYS), d: new Float64Array(N_DAYS), m: new Float64Array(N_DAYS), g: new Float64Array(N_DAYS), pp: new Float64Array(N_DAYS), dg: new Float64Array(N_DAYS) });
  const cat = new Map(), acmE = new Map(), catMids = new Map(), acmMids = new Map();
  const add = (map, key) => { let e = map.get(key); if (!e) { e = mk(); map.set(key, e); } return e; };
  for (const r of rows) {
    const di = dayDiff(today, r[0]); if (di < 0 || di >= N_DAYS) continue;
    const ents = [add(match, r[1] + "|" + r[2]), add(merchant, r[1]), add(sku, r[2])];
    if (r[9]) { ents.push(add(cat, r[9])); let a = catMids.get(r[9]); if (!a) { a = new Set(); catMids.set(r[9], a); } a.add(r[1]); }
    if (r[10]) { ents.push(add(acmE, r[10])); let a = acmMids.get(r[10]); if (!a) { a = new Set(); acmMids.set(r[10], a); } a.add(r[1]); }
    for (const e of ents) { e.p[di] += r[3]; e.c[di] += r[4]; e.d[di] += r[5]; e.m[di] += r[6]; e.g[di] += r[7]; e.pp[di] += r[8]; e.dg[di] += r[11] || 0; }
  }
  // distinct merchants per SKU per day (merchant-count split)
  const skuMerchants = new Map();
  for (const key of match.keys()) { const [mid, s] = key.split("|"); let a = skuMerchants.get(s); if (!a) { a = []; skuMerchants.set(s, a); } a.push(mid); }
  return { match, merchant, sku, skuMerchants, meta, today, stale, minDate, maxDate, rows: total, dupes, cat, acm: acmE, catMids, acmMids };
}

export async function loadInventory(res) {
  const inv = new Map();
  await streamCsv(res, (header) => {
    const f = colFinder(header);
    const C = { sku: f(["SKU_ID", "SKU", "PRODUCT_ID"], 0), name: f(["SKU_NAME", "NAME", "PRODUCT_NAME"], 1), stock: f(["STOCK", "TOTAL_COUNT", "QUANTITY", "AVAILABLE_STOCK"], 2), cat: f(["CATEGORY"], 4), avail: f(["AVAILABILITY", "STATUS"], 5) };
    return (c) => { const s = String(c[C.sku] || "").trim(); if (!s || /^(sku_id|sku|product_id)$/i.test(s)) return; inv.set(s, { name: String(c[C.name] || "").slice(0, 160), stock: num(c[C.stock]), cat: String(c[C.cat] || "").trim().slice(0, 60), avail: String(c[C.avail] || "").trim().slice(0, 40) }); };
  });
  return inv;
}
export async function loadDebundle(res) {
  const map = new Map(), stock = new Map(), isBundle = new Map();
  await streamCsv(res, (header) => {
    const f = colFinder(header);
    const C = { pid: f(["PRODUCT_ID"], 0), bundle: f(["IS_BUNDLE"], 2), single: f(["SINGLE_ID", "SINGLE"], 3), qty: f(["PRODUCT_QUANTITY", "QUANTITY"], 5), stock: f(["SINGLE_STOCK", "STOCK", "BUNDLE_STOCK"], 7) };
    return (c) => {
      const pid = String(c[C.pid] || "").trim(), single = String(c[C.single] || "").trim(); if (!pid || pid === "PRODUCT_ID" || !single) return;
      if (!map.has(pid)) map.set(pid, []); map.get(pid).push({ single, qty: num(c[C.qty]) || 1 });
      if (!stock.has(pid)) stock.set(pid, num(c[C.stock]));
      if (!isBundle.has(pid)) isBundle.set(pid, /^(true|yes|1)$/i.test(String(c[C.bundle] || "").trim()));
    };
  });
  return { map, stock, isBundle };
}
export function parseLocks(table) {
  const f = colFinder(table.header), out = [];
  const C = { single: f(["PRODUCT_ID", "SINGLE_ID", "SKU_ID"], 0), name: f(["SKU_NAME", "PRODUCT_NAME"], 1), mid: f(["TAGER_ID", "MERCHANT_ID"], 2), mName: f(["FULL_NAME", "TAGER_NAME"], 3),
    alloc: f(["ALLOCATED_QUANTITY"], 4), used: f(["QUANTITY_USED"], 5), exp: f(["QUANTITY_LOCK_EXPIRY_DATE", "EXPIRY_DATE", "LOCK_EXPIRY_DATE"], 7), type: f(["LOCKING_TYPE"], 8), rem: f(["REMAINING_PIECES", "REMAINING"], 12) };
  for (const c of table.rows) {
    const single = String(c[C.single] == null ? "" : c[C.single]).trim(), mid = String(c[C.mid] == null ? "" : c[C.mid]).trim();
    if (!single || !mid || single === "PRODUCT_ID") continue;
    const allocRaw = c[C.alloc]; if (allocRaw === "" || allocRaw == null) continue; // blank = no lock
    const alloc = num(allocRaw), used = num(c[C.used]), remCell = C.rem >= 0 ? c[C.rem] : null;
    const rem = remCell === "" || remCell == null ? Math.max(0, alloc - used) : num(remCell);
    out.push({ single, name: String(c[C.name] || "").slice(0, 160), mid, alloc, used, rem, exp: toYmd(c[C.exp]), type: String(c[C.type] || "").slice(0, 30) });
  }
  return out;
}
// Category Targets (Commercial) — the same sheet the dashboard reads: a "Category" header row, then one row per category
// (Consumables / Electronics / Fashion / Home / Leisure / Grand Total). Accepts {header, rows} or the uploaded payload {table:{rows:[{c:[{v}]}]}}.
export const normCat = (x) => { const n = String(x == null ? "" : x).trim().toLowerCase().replace(/\s+/g, " "); return n === "total" ? "grand total" : n; };
export function parseCategoryTargets(src) {
  let grid = [];
  if (src && src.table && Array.isArray(src.table.rows)) grid = src.table.rows.map((r) => (r && r.c ? r.c : r || []).map((x) => (x && typeof x === "object" ? (x.v == null ? "" : x.v) : x == null ? "" : x)));
  else if (src && Array.isArray(src.rows)) grid = [src.header || []].concat(src.rows);
  const norm = (x) => String(x == null ? "" : x).toLowerCase().replace(/[^\w%]+/g, " ").replace(/\s+/g, " ").trim();
  const hi = grid.findIndex((r) => r.some((x) => norm(x) === "category")); if (hi < 0) return null;
  const H = grid[hi].map(norm), col = (fn) => H.findIndex(fn), has = (h, w) => h.indexOf(w) >= 0;
  const C = { cat: H.indexOf("category"), ppmPiece: col((h) => has(h, "ppm") && (has(h, "piece") || has(h, "pc"))), cm3Piece: col((h) => has(h, "cm3") && (has(h, "piece") || has(h, "pc"))),
    cr: col((h) => /^cr\b/.test(h)), dr: col((h) => /^dr\b/.test(h)), daily: col((h) => has(h, "daily")), asp: col((h) => has(h, "asp")) };
  const pct = (v) => { const n = num(v); return n > 0 && n <= 1 ? n * 100 : n; };
  const out = new Map();
  for (const r of grid.slice(hi + 1)) {
    const k = normCat(r[C.cat]); if (!k) continue;
    out.set(k, { ppmPiece: C.ppmPiece >= 0 ? num(r[C.ppmPiece]) : 0, cm3Piece: C.cm3Piece >= 0 ? num(r[C.cm3Piece]) : 0, cr: C.cr >= 0 ? pct(r[C.cr]) : 0, dr: C.dr >= 0 ? pct(r[C.dr]) : 0, daily: C.daily >= 0 ? num(r[C.daily]) : 0, asp: C.asp >= 0 ? num(r[C.asp]) : 0 });
  }
  return out.size ? out : null;
}
export function parseProductsInfo(table) {
  const f = colFinder(table.header), out = new Map();
  const C = { country: f(["COUNTRY"], -1), id: f(["PRODUCT_ID", "SKU", "SKU_ID", "ID", "INTERNAL_REFERENCE"], 0), price: f(["PRICE", "SELLING_PRICE"], -1), l3: f(["CATEGORY_L3"], -1),
    web: f(["WEBSITE_STATUS"], -1), expired: f(["IS_EXPIRED"], -1), expEnd: f(["EXPIRY_END_DATE"], -1), restrict: f(["RESTRICT_VISIBILITY"], -1) };
  for (const c of table.rows) {
    const id = String(c[C.id] == null ? "" : c[C.id]).trim(); if (!id) continue;
    // the query holds Egypt AND Iraq rows (same PRODUCT_ID, different price) — Egypt only, or the price would "change" every run
    if (C.country >= 0) { const ctry = String(c[C.country] == null ? "" : c[C.country]).trim().toUpperCase(); if (ctry && !/^(EG|EGY|EGYPT)$/.test(ctry)) continue; }
    out.set(id, { price: C.price >= 0 ? num(c[C.price]) : null, l3: C.l3 >= 0 ? String(c[C.l3] || "").slice(0, 60) : "",
      web: C.web >= 0 ? String(c[C.web] || "") : "", expired: C.expired >= 0 ? /^(true|yes|1)$/i.test(String(c[C.expired] || "")) : false,
      expEnd: C.expEnd >= 0 ? toYmd(c[C.expEnd]) : "", restrict: C.restrict >= 0 ? /^(true|yes|1)$/i.test(String(c[C.restrict] || "")) : false });
  }
  return out;
}

// Products (Metabase "Products", gid 1779314157 — same columns js/app.js parseProductsSheet reads): SKU, name, website status, price, profit
export function parseProducts(table) {
  const f = colFinder(table.header), out = new Map();
  const C = { id: f(["SKU_ID", "PRODUCT_ID", "SKU"], 0), name: f(["NAME", "PRODUCT_NAME", "SKU_NAME", "ARABIC_NAME"], 1), web: f(["WEBSITE_STATUS", "STATUS"], 3), price: f(["PRICE", "SELLING_PRICE"], 4), profit: f(["PROFIT"], 6), cat: f(["CATEGORY", "CATEGORY_L1"], 13) };
  for (const c of table.rows) {
    const id = String(c[C.id] == null ? "" : c[C.id]).trim(); if (!id || id === "SKU_ID") continue;
    out.set(id, { n: String(c[C.name] == null ? "" : c[C.name]).slice(0, 160), web: String(c[C.web] == null ? "" : c[C.web]).trim().slice(0, 40), price: num(c[C.price]), profit: num(c[C.profit]), cat: String(c[C.cat] == null ? "" : c[C.cat]).slice(0, 60) });
  }
  return out;
}

// ----------------------------------------------------------------------------- scoring (Scoring Spec, Final)
const sumW = (a, w) => { let s = 0; for (let i = w[0]; i <= w[1]; i++) s += a[i] || 0; return s; };
const lenW = (w) => w[1] - w[0] + 1;
function activeDays(a, w) { let n = 0; for (let i = w[0]; i <= w[1]; i++) if ((a[i] || 0) > 0) n++; return n; }
// one entity (arrays p/c/d/m/g) → { demand, cr, dr, cm3, flags, impact… }
export function scoreEntity(e, S, winOverride) {
  const W = winOverride || S.windows, out = { flags: [], sc: {}, ev: {} };
  const Hd = W.demand.h, Rd = W.demand.r;
  const hAvg = sumW(e.p, Hd) / lenW(Hd), rAvg = sumW(e.p, Rd) / lenW(Rd);
  const histPlaced = sumW(e.p, [1, 13]), histGmv = sumW(e.g, [1, 13]);
  const asp = histPlaced > 0 ? histGmv / histPlaced : 0;
  out.asp = asp; out.hAvg = hAvg; out.rAvg = rAvg;
  if (activeDays(e.p, Hd) < Math.min(S.minHistoryDays, lenW(Hd))) out.flags.push("NEW");
  if (hAvg < S.minVolume) out.flags.push("LOW_VOLUME");
  const scored = out.flags.length === 0;
  const thr = S.threshold;
  if (S.metrics.demand !== false && scored) {
    const v = hAvg > 0 ? (rAvg / hAvg) * 100 : null;
    out.sc.demand = v == null ? null : r1(v);
    out.ev.demand = { r: r2(rAvg), h: r2(hAvg), impact: v != null && v < thr ? Math.max(0, hAvg - rAvg) * asp : 0 };
  }
  if (S.metrics.cr !== false && scored) {
    const w = W.cr, rp = sumW(e.p, w.r), rc = sumW(e.c, w.r), hp = sumW(e.p, w.h), hc = sumW(e.c, w.h);
    const rr = rp > 0 ? rc / rp : null, hr = hp > 0 ? hc / hp : null;
    const v = rr != null && hr > 0 ? (rr / hr) * 100 : null;
    out.sc.cr = v == null ? null : r1(v);
    out.ev.cr = { r: rr == null ? null : r2(rr * 100), h: hr == null ? null : r2(hr * 100), impact: v != null && v < thr ? Math.max(0, hr - rr) * (rp / lenW(w.r)) * asp : 0 };
  }
  if (S.metrics.dr !== false && scored) {
    const w = W.dr, rc = sumW(e.c, w.r), rd = sumW(e.d, w.r), hc = sumW(e.c, w.h), hd = sumW(e.d, w.h);
    const rr = rc > 0 ? rd / rc : null, hr = hc > 0 ? hd / hc : null;
    const v = rr != null && hr > 0 ? (rr / hr) * 100 : null;
    out.sc.dr = v == null ? null : r1(v);
    out.ev.dr = { r: rr == null ? null : r2(rr * 100), h: hr == null ? null : r2(hr * 100), impact: v != null && v < thr ? Math.max(0, hr - rr) * (rc / lenW(w.r)) * asp : 0 };
  }
  if (S.metrics.cm3 !== false && scored) {
    const w = W.cm3, rA = sumW(e.m, w.r) / lenW(w.r), hA = sumW(e.m, w.h) / lenW(w.h);
    if (rA < 0) out.flags.push("NEGATIVE_CM3");
    const v = hA > 0 ? (rA / hA) * 100 : null;
    out.sc.cm3 = v == null ? null : r1(v);
    out.ev.cm3 = { r: Math.round(rA), h: Math.round(hA), impact: (v != null && v < thr) || rA < 0 ? Math.max(0, hA - rA) : 0 };
  }
  out.declined = Object.keys(out.sc).filter((k) => out.sc[k] != null && out.sc[k] < thr);
  out.impact = out.declined.reduce((s, k) => s + (out.ev[k].impact || 0), 0);
  return out;
}

// ----------------------------------------------------------------------------- the engine run
// D = { main, inv, deb, locks, info, prices }   (any of inv/deb/locks/info may be null → that check is skipped)
// Section (dashboard tab) → team (role name in Users & Roles). Tasks go to the team that owns the section,
// not to everyone who can open the page. routing[reason].team overrides it (Control → Command Loop → Routing).
const TEAM_TABS = {
  "Commercial": ["navTargetsCommercial", "navCommercialPlan", "navCommercialDebundlized", "navCm3AnalystProducts", "navPpmAnalystProducts", "navPpmAnalystSingle", "navBundleRecommendations"],
  "Supply Chain": ["navScAging", "navScSkus", "navScActions", "navPurchasePlan", "navDohPlanner"],
  "Marketplace": ["navInventory", "navCm3Analyst", "navProductsMatchesAnalyst", "navMpMatches", "navMpNewMatches", "navPoorMatches", "navMpDeclineWatch", "navAvailabilityLocking", "navAllocationLocking", "navHealthyUnlocking"],
  "Account Manager": ["navMerchantTargets", "navMerchantPerf", "navMerchantCpa", "navAcmTargets", "navAcmPerf", "navMpSalesPlan", "navSpFeedback", "navIncMerchants"]
};
export const SECTION_TEAM = {};
for (const t of Object.keys(TEAM_TABS)) for (const id of TEAM_TABS[t]) SECTION_TEAM[id] = t;
export const TEAMS = Object.keys(TEAM_TABS);

export function runEngine(D, cfg, nowIso) {
  const S = cfg.scoring, G = cfg.diagnose, M = D.main, today = M.today, warnings = [];
  if (M.rows === S.rowCapAlert) warnings.push("Main has exactly " + M.rows + " rows — the source query may be capped (history can be cut).");
  if (M.minDate && M.minDate > addDays(today, -13)) warnings.push("Oldest Main date " + M.minDate + " is newer than D13 (" + addDays(today, -13) + ") — the DR/CM3 history window is truncated.");
  if (M.stale >= cfg.engine.staleDataDays) warnings.push("Main data stops at " + M.maxDate + " (" + M.stale + " day(s) behind) — D0 was moved to " + today + ".");
  if (!D.inv) warnings.push("Inventory could not be read — stock checks skipped.");
  if (!D.locks) warnings.push("Availability Locking could not be read — lock checks skipped.");
  const exSku = new Set((cfg.exclusions.skus || []).filter((x) => !x.until || x.until >= today).map((x) => String(x.id)));
  const exMid = new Set((cfg.exclusions.merchants || []).filter((x) => !x.until || x.until >= today).map((x) => String(x.id)));

  // ---- scores
  const sScore = new Map(), mScore = new Map(), xScore = new Map();
  for (const [k, e] of M.sku) sScore.set(k, scoreEntity(e, S));
  for (const [k, e] of M.merchant) mScore.set(k, scoreEntity(e, S));
  for (const [k, e] of M.match) xScore.set(k, scoreEntity(e, S));

  // ---- DOH per SKU (same method as the portal Inventory page: avg confirmed pieces / day, debundled to singles)
  const W = G.dohWindowDays, singleConf = new Map();
  for (const [s, e] of M.sku) {
    const v = sumW(e.c, [1, W]); if (!v) continue;
    const maps = D.deb && D.deb.map.get(s);
    if (maps && maps.length) maps.forEach((m) => singleConf.set(m.single, (singleConf.get(m.single) || 0) + v * m.qty));
    else singleConf.set(s, (singleConf.get(s) || 0) + v);
  }
  const stockOf = (id) => { if (D.deb && D.deb.stock.has(id)) return D.deb.stock.get(id); const i = D.inv && D.inv.get(id); return i ? i.stock : 0; };
  const single = (id) => { const st = stockOf(id), avg = (singleConf.get(id) || 0) / W; return { id, stock: st, avg, doh: avg > 0 ? st / avg : null }; };
  function dohOf(s) {
    const maps = (D.deb && D.deb.map.get(s)) || [], bundle = (D.deb && D.deb.isBundle.get(s)) || maps.length > 1;
    if (bundle && maps.length) {
      const ws = maps.map((m) => single(m.single)), withAvg = ws.filter((x) => x.doh != null);
      const worst = withAvg.length ? withAvg.reduce((a, b) => (b.doh < a.doh ? b : a)) : null;
      return { doh: worst ? worst.doh : null, stock: stockOf(s), bundle: true, shortSingle: worst && worst.doh < G.dohLow ? worst.id : null, singles: ws };
    }
    const x = single(s); return { doh: x.doh, stock: x.stock, bundle: false, shortSingle: null, singles: null };
  }
  const invState = new Map();
  const skuIds = new Set([...M.sku.keys()]);
  for (const s of skuIds) {
    const d = dohOf(s), i = D.inv && D.inv.get(s);
    const known = !!i || !!(D.deb && D.deb.stock.has(s)); // a SKU missing from Inventory is "unknown", never "out of stock"
    invState.set(s, { known, doh: known && d.doh != null ? r1(d.doh) : null, stock: i ? i.stock : d.stock, avail: i ? i.avail : "", bundle: d.bundle, shortSingle: known ? d.shortSingle : null, name: (i && i.name) || M.meta.pName.get(s) || s });
  }
  const isOut = (st) => !!st && st.known !== false && (st.stock <= 0 || /out of stock/i.test(st.avail || ""));

  // ---- price snapshot (PRICE_CHANGE)
  // selling price per SKU: Products (the same price the dashboard shows) first, Products Info (Egypt rows) as a fallback
  const priceNow = new Map();
  if (D.info) for (const [id, x] of D.info) if (x.price) priceNow.set(id, x.price);
  if (D.products) for (const [id, x] of D.products) if (x.price) priceNow.set(id, x.price);
  const prices = Object.assign({}, D.prices || {}), priceChanged = new Set();
  for (const [id, price] of priceNow) {
    const x = { price };
    const p = prices[id];
    if (!p) prices[id] = { p: x.price, at: "" };
    else if (Math.abs(p.p - x.price) > 0.009) prices[id] = { p: x.price, at: today, was: p.p };
    if (prices[id].at && dayDiff(today, prices[id].at) <= G.priceLookbackDays) priceChanged.add(id);
  }
  const BAD_WEB = /(inactive|disabled|hidden|draft|unpublish|archiv|not ?visible|removed)/i;
  const listingIssue = (s) => {
    const x = D.info && D.info.get(s), pr = D.products && D.products.get(s);
    if (x && (x.expired || (x.expEnd && x.expEnd < today))) return "expired";
    if (x && x.restrict) return "restricted visibility";
    const web = (x && x.web) || (pr && pr.web) || "";
    if (web && BAD_WEB.test(web)) return "website status: " + web;
    return null;
  };

  // ---- locks per match (single × merchant) vs avg CONFIRMED pieces/day of that merchant (debundled)
  const lockByMatch = new Map();
  // lock plan per match: the lock is used by PLACED pieces, stock is used by CONFIRMED pieces (placed × product CR),
  // and the other sellers on the same single need their share of the stock too.
  if (D.locks) {
    const conf = new Map(), placed = new Map(); // mid|single → pieces in lockAvgDays (debundled)
    const sConf = new Map(), sPlaced = new Map(), sMids = new Map(); // single → totals / merchants
    for (const [key, e] of M.match) {
      const [mid, s] = key.split("|"), v = sumW(e.c, [1, G.lockAvgDays]), pl = sumW(e.p, [1, G.lockAvgDays]); if (!v && !pl) continue;
      const maps = D.deb && D.deb.map.get(s);
      const parts = maps && maps.length ? maps.map((m) => [m.single, m.qty]) : [[s, 1]];
      for (const [one, q] of parts) {
        const k = mid + "|" + one;
        conf.set(k, (conf.get(k) || 0) + v * q); placed.set(k, (placed.get(k) || 0) + pl * q);
        sConf.set(one, (sConf.get(one) || 0) + v * q); sPlaced.set(one, (sPlaced.get(one) || 0) + pl * q);
        let a = sMids.get(one); if (!a) { a = new Set(); sMids.set(one, a); } a.add(mid);
      }
    }
    for (const L of D.locks) {
      const k = L.mid + "|" + L.single, avg = (conf.get(k) || 0) / G.lockAvgDays;
      const cover = avg > 0 ? L.rem / avg : null, expDays = L.exp ? dayDiff(L.exp, today) : null;
      const prev = lockByMatch.get(k);
      const rec = { mid: L.mid, single: L.single, name: L.name, alloc: L.alloc, used: L.used, rem: L.rem, exp: L.exp, expDays, type: L.type, avg: r2(avg), avgPlaced: r2((placed.get(k) || 0) / G.lockAvgDays), cover: cover == null ? null : r1(cover) };
      if (!prev || rec.rem < prev.rem) lockByMatch.set(k, rec);
    }
    const days = cfg.merchant.lockSuggestDays;
    for (const [k, L] of lockByMatch) {
      const s = L.single, tp = sPlaced.get(s) || 0, tc = sConf.get(s) || 0;
      const cr = tp > 0 && tc > 0 ? Math.min(1, tc / tp) : null; // product CR (all sellers, debundled)
      const stockKnown = !!(D.inv && D.inv.get(s)) || !!(D.deb && D.deb.stock.has(s)), stock = stockOf(s);
      // v1.18.0 — owner's rule, same as Control → Allocation Locking (Final Action): the merchant gets its SHARE of the stock
      // (CONTR% = its confirmed ÷ every seller's confirmed on this single, lockAvgDays) ÷ its own CR (the lock is taken by placed
      // pieces) — so a seller that is not working / sells little takes little. Suggested increase = that share; Final action
      // (the quantity to set on the system) = that share + what is still in the lock.
      const myConf = conf.get(k) || 0, myPl = placed.get(k) || 0;
      const contr = tc > 0 ? myConf / tc : 0;
      const crM = myPl > 0 && myConf > 0 ? Math.min(1, myConf / myPl) : cr; // the merchant's own CR on this single, else the product's
      const placedDay = L.avgPlaced > 0 ? L.avgPlaced : cr ? L.avg / cr : L.avg;
      const need = Math.max(0, Math.ceil(placedDay * days - L.rem));
      const share = stock * contr;
      const target = stockKnown ? Math.round(crM ? share / crM : share) : null;
      const action = target == null ? null : target + L.rem;
      const cap = target == null ? null : Math.max(0, target);
      const sug = cap == null ? need : cap;
      const totalConfDay = tc / G.lockAvgDays;
      L.plan = { days, placedDay: r2(placedDay), need, cr: cr == null ? null : Math.round(cr * 1000) / 10, crM: crM == null ? null : Math.round(crM * 1000) / 10,
        contr: Math.round(contr * 1000) / 10, sellers: (sMids.get(s) || new Set()).size, stock: stockKnown ? stock : null, share: stockKnown ? Math.round(share) : null, target, action,
        cap, suggest: sug, capped: cap != null && cap < need, doh: totalConfDay > 0 && stockKnown ? r1(stock / totalConfDay) : null };
    }
  }

  // ---- diagnose → candidate cases
  const cands = [], R = cfg.routing, thr = S.threshold;
  const absorbed = new Map(); // "mid|sku" → Set(metric) explained by a SKU-level case
  const absorb = (s, metrics) => { for (const mid of M.skuMerchants.get(s) || []) { const k = mid + "|" + s; let a = absorbed.get(k); if (!a) { a = new Set(); absorbed.set(k, a); } metrics.forEach((m) => a.add(m)); } };
  const on = (reason) => R[reason] && R[reason].enabled !== false;
  const mInfo = (mid) => ({ mid, name: M.meta.mName.get(mid) || mid, acm: M.meta.acm.get(mid) || "" });
  const childList = (s, metric) => (M.skuMerchants.get(s) || []).map((mid) => {
    const x = xScore.get(mid + "|" + s); if (!x || exMid.has(mid)) return null;
    const sc = metric ? x.sc[metric] : x.sc.demand;
    return { mid, name: M.meta.mName.get(mid) || mid, acm: M.meta.acm.get(mid) || "", score: sc == null ? null : sc, h: r1(x.hAvg), r: r1(x.rAvg), declined: metric ? sc != null && sc < thr : x.declined.length > 0 };
  }).filter(Boolean).sort((a, b) => b.h - a.h).slice(0, 60);
  const skuBase = (s, sc) => ({ level: "sku", sku: s, mid: "", productName: invState.get(s).name, category: M.meta.cat.get(s) || "", merchantName: "", acm: "" , score: sc });

  for (const s of skuIds) {
    if (exSku.has(s)) continue;
    const x = sScore.get(s), st = invState.get(s), e = M.sku.get(s);
    const recentDemand = sumW(e.p, [1, 7]) / 7, active = Math.max(x.hAvg, recentDemand) >= G.minActiveDemand;
    let supply = null, supplyNote = "";
    if (D.inv && active && isOut(st)) { supply = "STOCK_OUT"; supplyNote = "stock " + st.stock; }
    else if (D.deb && active && st.shortSingle) { supply = "BUNDLE_SINGLE_SHORT"; supplyNote = "single " + st.shortSingle; }
    else if (active && st.doh != null && st.doh < G.dohLow) { supply = "STOCK_LOW"; supplyNote = "DOH " + st.doh; }
    const declinedDemandish = x.declined.indexOf("demand") >= 0 || x.declined.indexOf("cr") >= 0;
    if (supply && on(supply) && (G.proactiveStock || x.declined.length)) {
      cands.push(Object.assign(skuBase(s, x.sc.demand), { reason: supply, ev: { scores: x.sc, metrics: x.ev, stock: st.stock, doh: st.doh, avail: st.avail, note: supplyNote, avgDemand: r1(recentDemand) },
        impact: Math.max(x.ev.demand ? x.ev.demand.impact : 0, recentDemand * x.asp * (supply === "STOCK_OUT" ? 1 : 0.5)), children: childList(s, "demand") }));
      absorb(s, ["demand", "cr"]);
    }
    const li = declinedDemandish ? listingIssue(s) : null;
    if (li && on("LISTING_ISSUE")) { cands.push(Object.assign(skuBase(s, x.sc.demand), { reason: "LISTING_ISSUE", ev: { scores: x.sc, metrics: x.ev, note: li }, impact: x.impact, children: childList(s, "demand") })); absorb(s, ["demand", "cr"]); }
    if (declinedDemandish && priceChanged.has(s) && on("PRICE_CHANGE")) { const p = prices[s]; cands.push(Object.assign(skuBase(s, x.sc.demand), { reason: "PRICE_CHANGE", ev: { scores: x.sc, metrics: x.ev, note: "price " + p.was + " → " + p.p + " on " + p.at }, impact: x.impact, children: childList(s, "demand") })); absorb(s, ["demand", "cr"]); }
    // CR / DR / demand: product overall (Commercial / Marketplace) vs partial (each ACM handles own matches)
    for (const metric of ["demand", "cr", "dr"]) {
      if (x.sc[metric] == null || x.sc[metric] >= thr) continue;
      const kids = (M.skuMerchants.get(s) || []).map((mid) => ({ mid, x: xScore.get(mid + "|" + s) })).filter((k) => k.x && k.x.sc[metric] != null && !exMid.has(k.mid));
      if (kids.every((k) => (absorbed.get(k.mid + "|" + s) || new Set()).has(metric)) && kids.length) continue;
      const vol = (k) => k.x.hAvg, all = kids.reduce((a, k) => a + vol(k), 0), dec = kids.filter((k) => k.x.sc[metric] < thr);
      const share = all > 0 ? (dec.reduce((a, k) => a + vol(k), 0) / all) * 100 : 0;
      const reason = { demand: "SKU_WIDE_DEMAND", cr: "CR_DROP_SKU", dr: "DR_DROP_SKU" }[metric];
      const ev = { scores: x.sc, metrics: x.ev, metric, share: r1(share), declinedMerchants: dec.length, merchants: kids.length };
      if (share >= G.skuWideShare && dec.length >= G.skuWideMinMerchants) {
        if (on(reason)) { cands.push(Object.assign(skuBase(s, x.sc[metric]), { reason, metric, ev, impact: x.ev[metric].impact, children: childList(s, metric) })); absorb(s, [metric]); }
      } else if (G.partialWatch && on("PARTIAL_WATCH") && dec.length) {
        cands.push(Object.assign(skuBase(s, x.sc[metric]), { reason: "PARTIAL_WATCH", metric, ckeyExtra: metric, ev, impact: x.ev[metric].impact, children: childList(s, metric), watch: true }));
      }
    }
    if ((x.flags.indexOf("NEGATIVE_CM3") >= 0 && on("NEGATIVE_CM3")) || (x.sc.cm3 != null && x.sc.cm3 < thr && on("CM3_DROP"))) {
      const reason = x.flags.indexOf("NEGATIVE_CM3") >= 0 ? "NEGATIVE_CM3" : "CM3_DROP";
      cands.push(Object.assign(skuBase(s, x.sc.cm3), { reason, metric: "cm3", ev: { scores: x.sc, metrics: x.ev }, impact: x.ev.cm3 ? x.ev.cm3.impact : 0, children: [] }));
    }
  }
  // locks (Marketplace)
  const lockWaits = new Map(); // sku → locks that need stock before they can be raised
  let lockUnused = 0;          // locks skipped because QUANTITY_USED = 0 (lockNeedsUse)
  for (const [k, L] of lockByMatch) {
    if (exMid.has(L.mid) || exSku.has(L.single)) continue;
    let reason = null;
    if (L.cover != null && L.cover <= G.lockCoverDays) reason = "LOCK_LOW";
    else if (L.expDays != null && L.expDays >= 0 && L.expDays <= G.lockExpiryDays && L.avg > 0) reason = "LOCK_EXPIRING";
    if (!reason || !on(reason) || (!G.proactiveLock && !(xScore.get(k) || { declined: [] }).declined.length)) continue;
    // v1.18.0 — a lock nobody has used yet (QUANTITY_USED = 0) is not running out: the merchant's orders are not taking from it
    // (new lock, or sold from free stock), so "Remaining ÷ the merchant's avg confirmed/day" says nothing about the lock.
    if (G.lockNeedsUse !== false && !(L.used > 0)) { lockUnused++; continue; }
    const mi = mInfo(L.mid);
    // v1.17.0 — tasks in order: no free stock → raising the lock does nothing, so it is a Supply Chain task first.
    // The lock task comes back by itself on the first run after stock arrives (free stock ≥ lockMinFree).
    if (G.lockWaitsForStock !== false && L.plan && L.plan.cap != null && L.plan.cap < (G.lockMinFree || 1)) {
      const w = lockWaits.get(L.single) || []; lockWaits.set(L.single, w);
      w.push({ mid: L.mid, name: mi.name, acm: mi.acm, reason, rem: L.rem, alloc: L.alloc, avg: L.avg, need: L.plan.need, impact: Math.round(L.avg * ((sScore.get(L.single) || {}).asp || 0)) });
      continue;
    }
    cands.push({ level: "match", reason, sku: L.single, mid: L.mid, productName: L.name || (invState.get(L.single) || {}).name || L.single, category: M.meta.cat.get(L.single) || "", merchantName: mi.name, acm: mi.acm,
      score: null, ev: { lock: Object.assign({}, L, { plan: undefined }), plan: L.plan || null, suggestedQty: L.plan ? L.plan.suggest : Math.max(0, Math.ceil(L.avg * cfg.merchant.lockSuggestDays - L.rem)) }, impact: L.avg * ((sScore.get(L.single) || {}).asp || 0), children: [] });
  }
  // locks waiting for stock → shown on (or create) the Supply Chain stock task of that product
  const lockHeld = [];
  for (const [sku, w] of lockWaits) {
    w.sort((a, b) => b.impact - a.impact);
    w.forEach((x) => lockHeld.push({ ckey: caseKey({ reason: x.reason, level: "match", mid: x.mid, sku }), sku }));
    const lockImpact = w.reduce((a, x) => a + x.impact, 0), need = w.reduce((a, x) => a + x.need, 0);
    const P = (lockByMatch.get(w[0].mid + "|" + sku) || {}).plan || {};
    const note = w.length + " lock" + (w.length > 1 ? "s" : "") + " waiting for stock (" + need + " placed pieces needed for " + cfg.merchant.lockSuggestDays + " days)";
    let sc = cands.find((c) => c.level === "sku" && c.sku === sku && REASONS[c.reason] && REASONS[c.reason].family === "STOCK");
    if (!sc && on("STOCK_LOW")) {
      const st = invState.get(sku) || {}, x = sScore.get(sku);
      sc = Object.assign(skuBase(sku, x ? x.sc.demand : null), { reason: "STOCK_LOW", ev: { scores: x ? x.sc : {}, metrics: x ? x.ev : {}, stock: st.stock, doh: st.doh, avail: st.avail,
        note: P.target != null ? "the merchant's share of the stock is already in its lock" : "stock " + (st.stock == null ? "?" : st.stock), avgDemand: null }, impact: 0, children: childList(sku, "demand") });
      cands.push(sc); absorb(sku, ["demand", "cr"]);
    }
    if (!sc) continue;
    sc.ev.locksWaiting = w.slice(0, 30); sc.ev.locksNote = note; sc.ev.lockStock = { stock: P.stock, contr: P.contr, share: P.share, target: P.target, cr: P.crM };
    sc.impact = Math.max(sc.impact || 0, lockImpact);
  }

  // PPM / piece vs the category target (Commercial) — delivered pieces only, matured window D6..D12
  const T = D.catTargets || null, tgtOf = (cat) => (T && (T.get(normCat(cat)) || T.get("grand total"))) || null;
  const ppmPct = new Map();
  let ppmSeen = 0; for (const [, e] of M.sku) { ppmSeen += sumW(e.pp, [1, 14]); if (ppmSeen) break; }
  if (!T) warnings.push("Category Targets could not be read — PPM checks skipped.");
  else if (!ppmSeen) warnings.push("Main has no DELIVERED_PPM numbers — PPM checks skipped.");
  else for (const s of skuIds) {
    if (exSku.has(s)) continue;
    const e = M.sku.get(s), dl = sumW(e.d, [6, 12]), pp = sumW(e.pp, [6, 12]), cat = M.meta.cat.get(s) || "", t = tgtOf(cat);
    if (!t || !(t.ppmPiece > 0) || dl < G.ppmMinDelivered) continue;
    const actual = pp / dl, pct = (actual / t.ppmPiece) * 100; ppmPct.set(s, r1(pct));
    if (pct >= G.ppmFixPct || !on("PPM_LOW")) continue;
    cands.push(Object.assign(skuBase(s, r1(pct)), { reason: "PPM_LOW", metric: "ppm", ev: { ppm: { actual: r1(actual), target: t.ppmPiece, pct: r1(pct), fixAt: G.ppmFixPct, deliveredDay: r1(dl / 7), category: cat } }, impact: Math.max(0, t.ppmPiece - actual) * (dl / 7), children: [] }));
  }
  // category overall (Commercial) and ACM portfolio overall (each ACM) — same scoring as everything else
  const cScore = new Map(), aScore = new Map();
  for (const [k, e] of M.cat || []) cScore.set(k, scoreEntity(e, S));
  for (const [k, e] of M.acm || []) aScore.set(k, scoreEntity(e, S));
  for (const [cat, x] of cScore) {
    const dec = x.declined; if (!dec.length || !on("CATEGORY_DROP") || ((M.catMids.get(cat) || new Set()).size < G.categoryMinMerchants)) continue;
    const kids = [...skuIds].filter((s) => (M.meta.cat.get(s) || "") === cat && !exSku.has(s)).map((s) => ({ s, y: sScore.get(s) }))
      .filter((k) => k.y && k.y.declined.some((m) => dec.indexOf(m) >= 0)).sort((a, b) => b.y.impact - a.y.impact).slice(0, 15)
      .map((k) => ({ sku: k.s, name: invState.get(k.s).name, metrics: k.y.declined.filter((m) => dec.indexOf(m) >= 0), scores: k.y.sc, h: r1(k.y.hAvg), r: r1(k.y.rAvg) }));
    cands.push({ level: "category", reason: "CATEGORY_DROP", sku: "", mid: "", productName: cat, category: cat, merchantName: "", acm: "", score: x.sc[dec[0]], metric: dec.join(","),
      ev: { scores: x.sc, metrics: x.ev, declined: dec, target: tgtOf(cat) }, impact: x.impact, children: kids });
  }
  for (const [acm, x] of aScore) {
    const dec = x.declined.filter((m) => m !== "cm3"); if (!dec.length || !on("ACM_DROP") || ((M.acmMids.get(acm) || new Set()).size < G.acmMinMerchants)) continue;
    const kids = [...(M.acmMids.get(acm) || [])].filter((mid) => !exMid.has(mid)).map((mid) => ({ mid, y: mScore.get(mid) }))
      .filter((k) => k.y && k.y.declined.some((m) => dec.indexOf(m) >= 0)).sort((a, b) => b.y.impact - a.y.impact).slice(0, 15)
      .map((k) => ({ mid: k.mid, name: M.meta.mName.get(k.mid) || k.mid, acm, score: k.y.sc[dec[0]], h: r1(k.y.hAvg), r: r1(k.y.rAvg), declined: true }));
    cands.push({ level: "acmall", reason: "ACM_DROP", sku: "", mid: "", productName: "", category: "", merchantName: "", acm, score: x.sc[dec[0]], metric: dec.join(","),
      ev: { scores: x.sc, metrics: x.ev, declined: dec, merchants: (M.acmMids.get(acm) || new Set()).size }, impact: x.impact, children: kids });
  }

  // merchants / matches (Account Manager)
  const mSkus = new Map();
  for (const key of M.match.keys()) { const i = key.indexOf("|"), mid = key.slice(0, i); let a = mSkus.get(mid); if (!a) { a = []; mSkus.set(mid, a); } a.push(key.slice(i + 1)); }
  for (const [mid, mx] of mScore) {
    if (exMid.has(mid)) continue;
    const mine = [];
    for (const s of mSkus.get(mid) || []) {
      if (exSku.has(s)) continue;
      const x = xScore.get(mid + "|" + s); if (!x || !x.declined.length) continue;
      const ab = absorbed.get(mid + "|" + s) || new Set(), left = x.declined.filter((m) => m !== "cm3" && !ab.has(m));
      if (left.length) mine.push({ s, x, left });
    }
    if (!mine.length) continue;
    const mi = mInfo(mid);
    const merchantDeclined = mx.declined.filter((m) => m !== "cm3");
    if (merchantDeclined.length && mine.length >= (G.merchantDropMinSkus || 1) && on("MERCHANT_DROP")) {
      const kids = mine.sort((a, b) => b.x.impact - a.x.impact).slice(0, 15).map((m) => ({ sku: m.s, name: invState.get(m.s).name, metrics: m.left, scores: m.x.sc, h: r1(m.x.hAvg), r: r1(m.x.rAvg) }));
      cands.push({ level: "merchant", reason: "MERCHANT_DROP", sku: "", mid, productName: "", category: "", merchantName: mi.name, acm: mi.acm, score: mx.sc.demand,
        metric: merchantDeclined.join(","), ev: { scores: mx.sc, metrics: mx.ev, declined: merchantDeclined }, impact: mx.impact, children: kids });
    } else if (on("MATCH_DROP")) {
      for (const m of mine) cands.push({ level: "match", reason: "MATCH_DROP", sku: m.s, mid, productName: invState.get(m.s).name, category: M.meta.cat.get(m.s) || "", merchantName: mi.name, acm: mi.acm,
        score: m.x.sc[m.left[0]], metric: m.left.join(","), ev: { scores: m.x.sc, metrics: m.x.ev, declined: m.left }, impact: m.x.impact, children: [] });
    }
  }
  // ---- quality gates: confirmed on 2 days in a row + enough EGP/day at stake
  const TQ = cfg.tasks, gated = { unconfirmed: 0, small: 0 };
  const shiftW = (W) => { const o = {}; for (const k of Object.keys(W)) o[k] = { r: [W[k].r[0] + 1, W[k].r[1] + 1], h: [W[k].h[0] + 1, W[k].h[1] + 1] }; return o; };
  const W1 = shiftW(S.windows), prevCache = new Map();
  const entOf = (c) => c.level === "sku" ? M.sku.get(c.sku) : c.level === "merchant" ? M.merchant.get(c.mid) : c.level === "match" ? M.match.get(c.mid + "|" + c.sku) : c.level === "category" ? M.cat.get(c.category) : c.level === "acmall" ? M.acm.get(c.acm) : null;
  const CONFIRM = ["SKU_WIDE_DEMAND", "CR_DROP_SKU", "DR_DROP_SKU", "CM3_DROP", "MERCHANT_DROP", "MATCH_DROP", "CATEGORY_DROP", "ACM_DROP", "PRICE_CHANGE", "PARTIAL_WATCH"];
  const confirmed = (c) => {
    if ((TQ.confirmDays || 1) < 2 || CONFIRM.indexOf(c.reason) < 0) return true;
    const e = entOf(c); if (!e) return true;
    const k = c.level + "|" + (c.sku || "") + "|" + (c.mid || "") + "|" + (c.category || "") + "|" + (c.acm || "");
    let y = prevCache.get(k); if (!y) { y = scoreEntity(e, S, W1); prevCache.set(k, y); }
    const ms = String(c.metric || "demand").split(",").filter(Boolean);
    return ms.some((m) => y.sc[m] != null && y.sc[m] < thr);
  };
  const KEEP = ["LOCK_REQUEST", "MANUAL"];
  const kept = cands.filter((c) => {
    if (KEEP.indexOf(c.reason) >= 0) return true;
    if (!confirmed(c)) { gated.unconfirmed++; return false; }
    if ((c.impact || 0) < (TQ.minImpact || 0)) { gated.small++; return false; }
    return true;
  });
  cands.length = 0; kept.forEach((c) => cands.push(c));
  cands.forEach((c) => { c.impact = Math.round(c.impact || 0); c.ckey = caseKey(c); });

  // ---- merchant signals for the portal (only the merchant's own numbers — no CM3, no other merchants)
  const signals = buildMerchantSignals({ M, D, cfg, xScore, invState, lockByMatch, exSku, exMid, isOut });
  // product catalog for the RE-CPA calculator: price / profit + the product's own 14-day CR / DR (DR on the matured D6..D14)
  const catalog = {};
  const ids = new Set([...(D.products ? D.products.keys() : []), ...M.sku.keys()]);
  for (const s of ids) {
    const pr = D.products && D.products.get(s), e = M.sku.get(s);
    let cr = null, dr = null;
    if (e) { const p = sumW(e.p, [1, 14]), c = sumW(e.c, [1, 14]), c2 = sumW(e.c, [6, 14]), d2 = sumW(e.d, [6, 14]); cr = p > 0 ? r2(c / p * 100) / 100 : null; dr = c2 > 0 ? r2(d2 / c2 * 100) / 100 : null; }
    catalog[s] = [(pr && pr.n) || (invState.get(s) || {}).name || M.meta.pName.get(s) || "", pr ? pr.price : null, pr ? pr.profit : null, cr, dr, (pr && pr.cat) || M.meta.cat.get(s) || "", e ? Math.round(sumW(e.p, [1, 14])) : 0, e && sumW(e.d, [1, 14]) > 0 ? Math.round(sumW(e.dg, [1, 14]) / sumW(e.d, [1, 14])) : null]; // [7] = Delivered ASP (delivered GMV ÷ delivered pieces, 14 days)
  }
  const scores = { asOf: today, builtAt: nowIso, sku: compactScores(sScore, (k) => ({ n: invState.get(k).name, cat: M.meta.cat.get(k) || "", doh: invState.get(k).doh, stock: invState.get(k).stock, mer: (M.skuMerchants.get(k) || []).length })),
    merchant: compactScores(mScore, (k) => ({ n: M.meta.mName.get(k) || k, acm: M.meta.acm.get(k) || "" })),
    match: compactScores(xScore, (k) => { const [mid, s] = k.split("|"); return { n: (M.meta.mName.get(mid) || mid) + " × " + (invState.get(s) || {}).name, acm: M.meta.acm.get(mid) || "" }; }, true),
    category: compactScores(cScore, (k) => ({ n: k, mer: (M.catMids.get(k) || new Set()).size })), acm: compactScores(aScore, (k) => ({ n: k, mer: (M.acmMids.get(k) || new Set()).size })) };
  const stats = { asOf: today, rows: M.rows, dupes: M.dupes, minDate: M.minDate, maxDate: M.maxDate, skus: M.sku.size, merchants: M.merchant.size, matches: M.match.size, candidates: cands.length, gated, locks: D.locks ? D.locks.length : null, locksUnused: lockUnused };
  if (!D.products) warnings.push("Products could not be read — website status and RE-CPA prices skipped.");
  stats.locksWaitingStock = lockHeld.length;
  return { cands, signals, scores, prices, warnings, stats, today, invState, xScore, sScore, mScore, cScore, aScore, ppmPct, lockByMatch, catalog, lockHeld };
}
export function caseKey(c) {
  const fam = REASONS[c.reason] ? REASONS[c.reason].family : c.reason, ent = c.level === "sku" ? c.sku : c.level === "merchant" ? c.mid : c.level === "match" ? c.mid + ":" + c.sku : c.level === "category" ? normCat(c.category) : c.level === "acmall" ? normAcm(c.acm) : (c.acm || "") + ":" + (c.sku || c.mid || "");
  return fam + "|" + c.level + "|" + ent + (c.ckeyExtra ? "|" + c.ckeyExtra : "");
}
function compactScores(map, metaFn, onlyFlagged) {
  const out = [];
  for (const [k, x] of map) {
    if (onlyFlagged && !x.declined.length && x.flags.indexOf("NEGATIVE_CM3") < 0) continue;
    out.push(Object.assign({ k, sc: x.sc, f: x.flags, d: x.declined, i: Math.round(x.impact), h: r1(x.hAvg), r: r1(x.rAvg) }, metaFn(k)));
  }
  return out.sort((a, b) => b.i - a.i).slice(0, 4000);
}

// Per-merchant data for the portal. Signals = conditions that are TRUE right now; the portal keeps the
// lifecycle (new / updated / resolved / cooldown / read state).
export function buildMerchantSignals({ M, D, cfg, xScore, invState, lockByMatch, exSku, exMid, isOut }) {
  D = D || {};
  const C = cfg.merchant, N = C.rules, out = {}, today = M.today;
  if (!C.enabled) return { builtAt: null, asOf: today, merchants: {}, alts: {}, cfg: portalCfg(cfg) };
  const S = Object.assign({}, cfg.scoring, { minVolume: C.minVolume, windows: Object.assign({}, cfg.scoring.windows, { demand: C.window, cr: C.window }), metrics: { demand: true, cr: true, dr: false, cm3: false } });
  const ensure = (mid) => out[mid] || (out[mid] = { skus: {}, signals: [] });
  for (const [key, e] of M.match) {
    const [mid, s] = key.split("|"); if (exMid.has(mid) || exSku.has(s)) continue;
    const recent = sumW(e.p, [1, 14]); if (!recent) continue;
    const st = invState.get(s) || {}, sc = scoreEntity(e, S);
    const m = ensure(mid);
    const pr = D.products && D.products.get(s);
    m.skus[s] = { n: st.name || s, cat: M.meta.cat.get(s) || "", d: Array.from(e.p.slice(1, 15)), c: Array.from(e.c.slice(1, 15)), dl: Array.from(e.d.slice(1, 15)), pr: pr ? pr.price : null, pf: pr ? pr.profit : null, doh: st.doh, stock: st.stock, avail: st.avail || "", sc: { demand: sc.sc.demand == null ? null : sc.sc.demand, cr: sc.sc.cr == null ? null : sc.sc.cr }, f: sc.flags };
    const asp = sc.asp || 0, impact = (sc.ev.demand && sc.ev.demand.impact) || 0;
    if (N.N1.on && sc.sc.demand != null && sc.sc.demand < cfg.scoring.threshold)
      m.signals.push({ rule: "N1", sku: s, sev: sc.sc.demand < N.N1.critical ? "critical" : "warning", impact: Math.round(impact), data: { score: sc.sc.demand, recent: r1(sc.rAvg), usual: r1(sc.hAvg) } });
    if (N.N2.on && sc.sc.cr != null && sc.sc.cr < cfg.scoring.threshold)
      m.signals.push({ rule: "N2", sku: s, sev: sc.sc.cr < N.N2.critical ? "critical" : "warning", impact: Math.round((sc.ev.cr && sc.ev.cr.impact) || 0), data: { score: sc.sc.cr, recent: sc.ev.cr.r, usual: sc.ev.cr.h } });
    const activeWeek = sumW(e.p, [1, 7]) > 0;
    if (activeWeek && N.N4.on && isOut(st)) m.signals.push({ rule: "N4", sku: s, sev: "critical", impact: Math.round(sumW(e.p, [1, 7]) / 7 * asp), data: { stock: st.stock } });
    else if (activeWeek && N.N3.on && st.doh != null && st.doh < N.N3.days) m.signals.push({ rule: "N3", sku: s, sev: st.doh < N.N3.critical ? "critical" : "warning", impact: Math.round(sumW(e.p, [1, 7]) / 7 * asp), data: { doh: st.doh, stock: st.stock } });
  }
  for (const [k, L] of lockByMatch) {
    if (exMid.has(L.mid) || exSku.has(L.single)) continue;
    const m = ensure(L.mid);
    const avgN = L.avg; // avg CONFIRMED pieces/day (lockAvgDays) — debundled
    const sug = L.plan ? L.plan.suggest : Math.max(0, Math.ceil(avgN * C.lockSuggestDays - L.rem));
    const sk = m.skus[L.single] || (m.skus[L.single] = { n: L.name || (invState.get(L.single) || {}).name || L.single, cat: M.meta.cat.get(L.single) || "", d: null, c: null, doh: (invState.get(L.single) || {}).doh, stock: (invState.get(L.single) || {}).stock, avail: "", sc: {}, f: [] });
    sk.lock = { alloc: L.alloc, used: L.used, rem: L.rem, exp: L.exp, expDays: L.expDays, avg: L.avg, cover: L.cover, suggest: sug };
    if (cfg.diagnose.lockNeedsUse !== false && !(L.used > 0)) { /* never used → no N5 / N6 */ }
    else if (N.N5.on && L.cover != null && L.cover <= N.N5.coverDays) m.signals.push({ rule: "N5", sku: L.single, sev: L.cover <= N.N5.critical ? "critical" : "warning", impact: Math.round(avgN * 100), data: { rem: L.rem, avg: L.avg, cover: L.cover, suggest: sug } });
    else if (N.N6.on && L.expDays != null && L.expDays >= 0 && L.expDays <= N.N6.days && L.avg > 0) m.signals.push({ rule: "N6", sku: L.single, sev: L.expDays <= 1 ? "critical" : "warning", impact: Math.round(avgN * 50), data: { exp: L.exp, days: L.expDays, rem: L.rem } });
  }
  // alternatives per category: healthy SKUs with real demand (no lock on them)
  const alts = {};
  if (C.alternatives.on) {
    const locked = new Set([...lockByMatch.values()].map((L) => L.single));
    const byCat = {};
    for (const [s, st] of invState) {
      if (exSku.has(s) || locked.has(s) || isOut(st) || st.doh == null || st.doh < C.alternatives.minDoh) continue;
      const cat = M.meta.cat.get(s) || ""; if (!cat) continue;
      const e = M.sku.get(s), dem = e ? sumW(e.p, [1, 7]) : 0; if (!dem) continue;
      (byCat[cat] || (byCat[cat] = [])).push({ sku: s, n: st.name, doh: st.doh, dem });
    }
    for (const cat of Object.keys(byCat)) alts[cat] = byCat[cat].sort((a, b) => b.dem - a.dem).slice(0, 12).map((a) => ({ sku: a.sku, n: a.n, doh: a.doh }));
  }
  return { asOf: today, merchants: out, alts, cfg: portalCfg(cfg) };
}
export function portalCfg(cfg) { const C = cfg.merchant, test = cfg.testMode && cfg.testMode.on; return { cpa: cfg.cpa, testMode: !!test, enabled: C.enabled && !test, cooldownDays: C.cooldownDays, maxNewPerDay: C.maxNewPerDay, muteDays: C.muteDays, lockRequests: C.lockRequests && !test, rules: C.rules, alternatives: C.alternatives, threshold: cfg.scoring.threshold }; }
