// v1.17.0 — Command Loop tests: scoring (spec example), diagnose/routing, tasks in D1, follow-up, SLA,
// merchant signals + lock requests, admin control. Run: node test/loop.mjs   (D1 is emulated with node:sqlite)
process.env.TZ = "UTC";
import { DatabaseSync } from "node:sqlite";
const L = await import("../loop.js");
const A = await import("../loop-api.js");
const worker = (await import("../worker.js")).default;

// The fixture worlds below are tiny and test the diagnose rules one by one, so they run with the quality gates OFF
// (old behaviour). The real defaults are checked in the "Quality gates" section at the end.
const REAL = JSON.parse(JSON.stringify({ tasks: L.DEFAULT_CONFIG.tasks, routing: L.DEFAULT_CONFIG.routing }));
Object.assign(L.DEFAULT_CONFIG.tasks, { minImpact: 0, confirmDays: 1, maxNewPerRun: 0 }); L.DEFAULT_CONFIG.diagnose.merchantDropMinSkus = 2;
REAL.diagnose = { merchantDropMinSkus: 1 };
["MATCH_DROP", "PARTIAL_WATCH", "CM3_DROP"].forEach((r) => { L.DEFAULT_CONFIG.routing[r].enabled = true; });
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const section = (t) => console.log("\n" + t);

// ------------------------------------------------------------------ D1 shim
function d1() {
  const db = new DatabaseSync(":memory:");
  const clean = (a) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  function stmt(sql, args = []) {
    return {
      bind(...a) { return stmt(sql, clean(a)); },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { db.prepare(sql).run(...args); return { success: true }; },
      _exec() { db.prepare(sql).run(...args); }
    };
  }
  return { prepare: (sql) => stmt(sql), async batch(list) { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; }, _db: db };
}
function kv() {
  const m = new Map();
  return { m, async get(k, o) { const v = m.get(k); if (v == null) return null; if (o && o.type === "arrayBuffer") return v; return typeof v === "string" ? v : new TextDecoder().decode(v); },
    async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
}

// ------------------------------------------------------------------ synthetic data
const today = L.cairoToday();
const day = (n) => L.addDays(today, -n);
const HEAD = ["CREATION_DATE", "TAGER_ID", "TAGER_NAME", "PRODUCT_ID", "PRODUCT_NAME", "CATEGORY", "C6", "C7", "C8", "PLACED_ORDERS", "CONFIRMED_ORDERS", "DELIVERED_ORDERS", "C12", "C13", "C14",
  "PLACED_PIECES", "CONFIRMED_PIECES", "DELIVERED_PIECES", "CR_PCS", "DR_PCS", "NDR_PCS", "PLACED_GMV", "DELIVERED_GMV", "PLACED_ASP", "C24", "C25", "C26", "C27", "CM3", "C29", "C30", "ACM"];
function row(d, mid, mname, sku, pname, cat, placed, conf, deliv, cm3, acm, asp = 100) {
  const r = new Array(HEAD.length).fill("");
  r[0] = d; r[1] = mid; r[2] = mname; r[3] = sku; r[4] = pname; r[5] = cat; r[15] = placed; r[16] = conf; r[17] = deliv; r[21] = placed * asp; r[22] = deliv * asp; r[28] = cm3; r[31] = acm;
  return r;
}
// series: function(dayIndex) → placed
function series(rows, mid, mname, sku, pname, cat, acm, f, opts = {}) {
  for (let i = 0; i <= 14; i++) {
    const p = f(i); if (p == null) continue;
    const cr = opts.cr ? opts.cr(i) : 0.8, dr = opts.dr ? opts.dr(i) : 0.7, cm = opts.cm3 ? opts.cm3(i) : p * 20;
    rows.push(row(day(i), mid, mname, sku, pname, cat, p, Math.round(p * cr), Math.round(p * cr * dr), cm, acm));
  }
}
const toCsv = (rows) => [HEAD].concat(rows).map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(",")).join("\n");

// Spec §13 worked example: Match 71087×EG040101COWN99 H avg 120.7 → R 0 ; Merchant 312.6 → 127 ; SKU 167.3 → 53
function specRows() {
  const rows = [];
  const H = [121, 121, 121, 120, 121, 120, 121]; // sum 845 → 120.71
  series(rows, "71087", "Shop 71087", "EG040101COWN99", "Cow Lamp", "Home", "Sara", (i) => (i === 0 ? 5 : i === 1 ? 0 : i <= 8 ? H[i - 2] : 120));
  const H2 = [192, 192, 192, 192, 192, 192, 191]; // other product of 71087: sum 1343
  series(rows, "71087", "Shop 71087", "EG000OTHER01", "Other", "Home", "Sara", (i) => (i === 0 ? 3 : i === 1 ? 127 : i <= 8 ? H2[i - 2] : 190));
  const H3 = [47, 47, 46, 47, 46, 47, 46]; // other merchant on the SKU: sum 326
  series(rows, "55555", "Shop 55555", "EG040101COWN99", "Cow Lamp", "Home", "Omar", (i) => (i === 0 ? 1 : i === 1 ? 53 : i <= 8 ? H3[i - 2] : 46));
  return rows;
}
const resOf = (text, ct) => new Response(text, { headers: { "Content-Type": ct || "text/csv" } });

section("Scoring (Spec §13)");
{
  const main = await L.loadMain(resOf(toCsv(specRows())), today);
  const cfg = L.mergeConfig(L.DEFAULT_CONFIG, {});
  const m = L.scoreEntity(main.merchant.get("71087"), cfg.scoring), s = L.scoreEntity(main.sku.get("EG040101COWN99"), cfg.scoring), x = L.scoreEntity(main.match.get("71087|EG040101COWN99"), cfg.scoring);
  ok(Math.abs(m.hAvg - 312.6) < 0.1 && m.rAvg === 127 && m.sc.demand === 40.6, "Merchant 71087 = 127 / 312.6 → 40.6 (got " + m.sc.demand + ")");
  ok(s.sc.demand === 31.7, "SKU EG040101COWN99 → 31.7 (got " + s.sc.demand + ")");
  ok(x.sc.demand === 0, "Match 71087 × COWN99 → 0.0");
  ok(x.declined.indexOf("demand") >= 0 && m.declined.indexOf("demand") >= 0, "Declined = score < 70");
  ok(main.today === today, "D0 = today in Cairo (today's partial rows excluded)");
  // guards
  const tiny = await L.loadMain(resOf(toCsv((() => { const r = []; series(r, "1", "a", "S1", "s", "c", "x", (i) => (i >= 1 ? 2 : null)); return r; })())), today);
  ok(L.scoreEntity(tiny.match.get("1|S1"), cfg.scoring).flags.indexOf("LOW_VOLUME") >= 0, "LOW_VOLUME below 5 pcs/day → no score");
  const young = await L.loadMain(resOf(toCsv((() => { const r = []; series(r, "1", "a", "S1", "s", "c", "x", (i) => (i <= 3 ? 50 : null)); return r; })())), today);
  ok(L.scoreEntity(young.match.get("1|S1"), cfg.scoring).flags.indexOf("NEW") >= 0, "NEW when fewer than 5 active history days");
  // CR = sum-over-window ratio; DR on matured window D6 vs D7..D13
  const crRows = []; series(crRows, "9", "m9", "S9", "p", "c", "x", () => 50, { cr: (i) => (i === 1 ? 0.4 : 0.8), dr: (i) => (i === 6 ? 0.35 : 0.7) });
  const cr = L.scoreEntity((await L.loadMain(resOf(toCsv(crRows)), today)).match.get("9|S9"), cfg.scoring);
  ok(cr.sc.cr === 50 && cr.sc.dr === 50, "CR 0.4/0.8 → 50 · DR (matured D6) 0.35/0.7 → 50");
  // negative CM3
  const nRows = []; series(nRows, "8", "m8", "S8", "p", "c", "x", () => 50, { cm3: (i) => (i === 6 ? -100 : 1000) });
  ok(L.scoreEntity((await L.loadMain(resOf(toCsv(nRows)), today)).sku.get("S8"), cfg.scoring).flags.indexOf("NEGATIVE_CM3") >= 0, "NEGATIVE_CM3 flag");
}

// ------------------------------------------------------------------ a fuller world for diagnose + API
function worldRows(v) {
  const rows = [];
  // SKU A: stock-out (stock 0) — 4 merchants, demand dropped → one STOCK case, no ACM tasks for A
  [["101", "Sara"], ["102", "Sara"], ["103", "Omar"], ["104", "Omar"]].forEach(([mid, acm]) => series(rows, mid, "Shop " + mid, "SKU_A", "Alpha", "Kitchen", acm, (i) => (i === 0 ? 1 : i <= 1 ? (v.stockBack ? 30 : 4) : 30)));
  // SKU B: CR down on most merchants (product overall → Commercial)
  [["201", "Sara"], ["202", "Omar"], ["203", "Omar"], ["204", "Sara"]].forEach(([mid, acm]) => series(rows, mid, "Shop " + mid, "SKU_B", "Beta", "Beauty", acm, () => 40, { cr: (i) => (i === 1 ? 0.3 : 0.8) }));
  // SKU C: CR down on ONE merchant only (partial → that merchant's ACM)
  series(rows, "301", "Shop 301", "SKU_C", "Gamma", "Beauty", "Sara", () => 40, { cr: (i) => (i >= 1 && i <= 2 && !v.recovered ? 0.2 : 0.8) });
  // SKU G: product CR is down (<70) but the drop sits on ONE big merchant (50% of volume < 60%) → partial: ACM task + watch
  series(rows, "601", "Shop 601", "SKU_G", "Gee", "Beauty", "Sara", () => 60, { cr: (i) => (i === 1 && !v.recovered ? 0.1 : 0.8) });
  ["602", "603"].forEach((mid) => series(rows, mid, "Shop " + mid, "SKU_G", "Gee", "Beauty", "Omar", () => 30));
  ["302", "303", "304"].forEach((mid) => series(rows, mid, "Shop " + mid, "SKU_C", "Gamma", "Beauty", "Omar", () => 60));
  // Merchant 401 drops on two SKUs (D, E) → one MERCHANT_DROP case
  series(rows, "401", "Shop 401", "SKU_D", "Delta", "Toys", "Omar", (i) => (i === 1 ? 5 : 40));
  series(rows, "401", "Shop 401", "SKU_E", "Epsilon", "Toys", "Omar", (i) => (i === 1 ? 5 : 40));
  ["402", "403"].forEach((mid) => { series(rows, mid, "Shop " + mid, "SKU_D", "Delta", "Toys", "Sara", () => 60); series(rows, mid, "Shop " + mid, "SKU_E", "Epsilon", "Toys", "Sara", () => 60); });
  // SKU F: healthy, big stock (an alternative in Kitchen) ; lock on F for merchant 501: remaining 10 vs 8 confirmed/day
  series(rows, "501", "Shop 501", "SKU_F", "Phi", "Kitchen", "Sara", () => 10);
  series(rows, "502", "Shop 502", "SKU_F2", "Phi Two", "Kitchen", "Sara", () => 20);
  return rows;
}
const INV = (v) => "SKU_ID,NAME,STOCK,X,CATEGORY,AVAILABILITY\n" +
  "SKU_A,Alpha," + (v.stockBack ? 5000 : 0) + ",,Kitchen," + (v.stockBack ? "Available" : "Out of Stock") + "\nSKU_B,Beta,9000,,Beauty,Available\nSKU_C,Gamma,9000,,Beauty,Available\nSKU_G,Gee,9000,,Beauty,Available\nSKU_D,Delta,9000,,Toys,Available\nSKU_E,Epsilon,9000,,Toys,Available\nSKU_F,Phi,9000,,Kitchen,Available\nSKU_F2,Phi Two,9000,,Kitchen,Available\n";
const DEB = "PRODUCT_ID,X,IS_BUNDLE,SINGLE_ID,Y,PRODUCT_QUANTITY,Z,STOCK\n";
const LOCKS = JSON.stringify([{ PRODUCT_ID: "SKU_F", SKU_NAME: "Phi", TAGER_ID: "501", FULL_NAME: "Shop 501", ALLOCATED_QUANTITY: 100, QUANTITY_USED: 90, QUANTITY_USED_AT: "", QUANTITY_LOCK_EXPIRY_DATE: L.addDays(today, 20), LOCKING_TYPE: "Solo", FLAG: "", LOCK_UPDATE_DATE: "", LOCK_START_DATE: "", REMAINING_PIECES: 10 }]);

section("Diagnose + routing");
let world = {};
async function engineFor(v) {
  const main = await L.loadMain(resOf(toCsv(worldRows(v))), today);
  const D = { main, inv: await L.loadInventory(resOf(INV(v))), deb: await L.loadDebundle(resOf(DEB)), locks: L.parseLocks({ header: Object.keys(JSON.parse(LOCKS)[0]), rows: JSON.parse(LOCKS).map((o) => Object.values(o)) }), info: null, prices: {} };
  return L.runEngine(D, L.mergeConfig(L.DEFAULT_CONFIG, {}), new Date().toISOString());
}
{
  const run = await engineFor({});
  const by = (r) => run.cands.filter((c) => c.reason === r);
  ok(by("STOCK_OUT").length === 1 && by("STOCK_OUT")[0].sku === "SKU_A" && by("STOCK_OUT")[0].children.length === 4, "Stock-out → one SKU case with the 4 merchants as children");
  ok(!run.cands.some((c) => (c.reason === "MATCH_DROP" || c.reason === "MERCHANT_DROP") && c.sku === "SKU_A"), "…and no ACM task for SKU_A (explained by stock)");
  ok(by("CR_DROP_SKU").length === 1 && by("CR_DROP_SKU")[0].sku === "SKU_B", "CR down on the product overall → CR_DROP_SKU (Commercial)");
  ok(!run.cands.some((c) => c.reason === "MATCH_DROP" && c.sku === "SKU_B"), "…and no per-merchant CR tasks for SKU_B");
  const cm = by("MATCH_DROP").filter((c) => c.sku === "SKU_C");
  ok(cm.length === 1 && cm[0].mid === "301" && cm[0].acm === "Sara" && /cr/.test(cm[0].metric), "CR down on one merchant only → MATCH_DROP for that merchant's ACM");
  ok(!by("PARTIAL_WATCH").some((c) => c.sku === "SKU_C"), "…no watch when the product itself is fine");
  ok(by("PARTIAL_WATCH").some((c) => c.sku === "SKU_G" && c.metric === "cr" && c.ev.share === 50) && by("MATCH_DROP").some((c) => c.sku === "SKU_G" && c.mid === "601"), "Product CR < 70 but the drop is 50% of volume (< 60%) → ACM task for 601 + a watch for Commercial");
  const md = by("MERCHANT_DROP");
  ok(md.length === 1 && md[0].mid === "401" && md[0].children.length === 2, "Merchant down on 2 SKUs → one MERCHANT_DROP with both SKUs");
  const R0 = L.DEFAULT_CONFIG.routing;
  const lk = by("LOCK_LOW");
  // v1.18.0 — suggested increase = share of the stock (CONTR%) ÷ the merchant's CR; final action = that + what is left: 501 is the only seller → 9000 × 100% ÷ 80% = 11250 (+10 = 11260)
  ok(lk.length === 1 && lk[0].mid === "501" && lk[0].ev.lock.cover === 1.3 && lk[0].ev.plan.contr === 100 && lk[0].ev.plan.crM === 80 && lk[0].ev.plan.target === 11250 && lk[0].ev.suggestedQty === 11250 && lk[0].ev.plan.action === 11260 && lk[0].ev.plan.cr === 80, "Lock 10 left vs 8 confirmed/day → LOCK_LOW, cover 1.3d, suggest = 9000 × 100% ÷ 80% = 11250, final action 11250 + 10 = 11260 (got " + JSON.stringify(lk[0] && lk[0].ev.plan) + ")");
  {
    // capped by stock: SKU_F stock 100, another seller (503) sells 8 confirmed/day → keeps 56 for 7 days → free 44 → 44 / 80% CR = 55 placed → +45
    const rows2 = worldRows({}); series(rows2, "503", "Shop 503", "SKU_F", "Phi", "Kitchen", "Omar", () => 10);
    const D2 = { main: await L.loadMain(resOf(toCsv(rows2)), today), inv: await L.loadInventory(resOf(INV({}).replace("SKU_F,Phi,9000", "SKU_F,Phi,100"))), deb: await L.loadDebundle(resOf(DEB)), locks: L.parseLocks({ header: Object.keys(JSON.parse(LOCKS)[0]), rows: JSON.parse(LOCKS).map((o) => Object.values(o)) }), info: null, prices: {} };
    const r2 = L.runEngine(D2, L.mergeConfig(L.DEFAULT_CONFIG, {}), new Date().toISOString());
    const c2 = r2.cands.find((c) => c.reason === "LOCK_LOW"), P = c2 && c2.ev.plan;
    // 503 sells as much as 501 → CONTR 50% → 100 × 50% = 50 ÷ 80% = 63 placed → suggest +63; final action 63 + 10 in the lock = 73
    ok(P && P.need === 60 && P.contr === 50 && P.sellers === 2 && P.share === 50 && P.target === 63 && P.action === 73 && P.suggest === 63 && !P.capped, "Suggested lock = share of the stock ÷ merchant CR; final action = that + left in the lock (got " + JSON.stringify(P) + ")");
    const D3a = Object.assign({}, D2, { inv: await L.loadInventory(resOf(INV({}).replace("SKU_F,Phi,9000", "SKU_F,Phi,40"))) });
    const off = L.mergeConfig(L.DEFAULT_CONFIG, { diagnose: { lockWaitsForStock: false } });
    const P3a = L.runEngine(D3a, off, new Date().toISOString()).cands.find((c) => c.reason === "LOCK_LOW").ev.plan;
    ok(P3a.target === 25 && P3a.suggest === 25 && P3a.action === 35, "Stock 40 → share 20 ÷ 80% = 25 → +25, final action 25 + 10 = 35 (got " + JSON.stringify(P3a) + ")");
    const D3 = Object.assign({}, D2, { inv: await L.loadInventory(resOf(INV({}).replace("SKU_F,Phi,9000", "SKU_F,Phi,0"))) });
    const P3 = L.runEngine(D3, off, new Date().toISOString()).cands.find((c) => c.reason === "LOCK_LOW").ev.plan;
    ok(P3.target === 0 && P3.action === 10 && P3.suggest === 0, "(stock-first off) Stock 0 → no share → suggest 0, final action = the 10 still in the lock (got " + JSON.stringify(P3) + ")");
    // stock first (default): no free stock → NO lock task; the Supply Chain stock task carries the waiting lock
    const r3 = L.runEngine(D3, L.mergeConfig(L.DEFAULT_CONFIG, {}), new Date().toISOString());
    const st3 = r3.cands.find((c) => c.sku === "SKU_F" && /^STOCK_/.test(c.reason));
    ok(!r3.cands.some((c) => c.reason === "LOCK_LOW" && c.sku === "SKU_F"), "Stock first: no free stock → no Lock running out task for Marketplace");
    ok(st3 && R0.STOCK_LOW.section === "navDohPlanner" && st3.ev.locksWaiting.length === 1 && st3.ev.locksWaiting[0].mid === "501" && /1 lock waiting for stock/.test(st3.ev.locksNote), "…the Supply Chain stock task shows the lock waiting for stock (" + (st3 && st3.reason) + ")");
    ok(r3.lockHeld.length === 1 && r3.lockHeld[0].ckey === "LOCK|match|501:SKU_F" && r3.stats.locksWaitingStock === 1, "…and the lock is listed as on hold");
    // v1.18.0 — a lock that was never used (QUANTITY_USED = 0) is not running out → no task, no N5 / N6
    const LOCK0 = JSON.stringify([Object.assign(JSON.parse(LOCKS)[0], { ALLOCATED_QUANTITY: 10, QUANTITY_USED: 0, REMAINING_PIECES: 10 })]);
    const D4 = Object.assign({}, D2, { locks: L.parseLocks({ header: Object.keys(JSON.parse(LOCK0)[0]), rows: JSON.parse(LOCK0).map((o) => Object.values(o)) }) });
    const r4 = L.runEngine(D4, L.mergeConfig(L.DEFAULT_CONFIG, {}), new Date().toISOString());
    ok(!r4.cands.some((c) => c.reason === "LOCK_LOW" || c.reason === "LOCK_EXPIRING") && r4.stats.locksUnused === 1, "Lock 10 of 10 left, QUANTITY_USED 0 → no Lock running out task (counted as unused)");
    const r5 = L.runEngine(D4, L.mergeConfig(L.DEFAULT_CONFIG, { diagnose: { lockNeedsUse: false } }), new Date().toISOString());
    ok(r5.cands.some((c) => c.reason === "LOCK_LOW"), "…with lockNeedsUse off, the same lock gives the task again");
    // stock arrives → the lock task comes back by itself (r2: stock 100 → +63)
    ok(c2 && !r2.lockHeld.length, "Stock arrives → the lock task opens again with the capped suggestion");
    // an already-open lock task when the stock runs out
    const DBh = d1(); A._resetSchemaFlag(); const CF = L.mergeConfig(L.DEFAULT_CONFIG, {});
    const offRun = L.runEngine(D3, off, new Date().toISOString());
    await A.reconcile(DBh, offRun, CF, new Date().toISOString());
    const recH = await A.reconcile(DBh, r3, CF, new Date().toISOString());
    const lkRow = DBh._db.prepare("SELECT status, outcome FROM loop_cases WHERE ckey='LOCK|match|501:SKU_F'").get();
    ok(recH.lockHeld === 1 && lkRow.status === "auto_cleared" && /no free stock/i.test(lkRow.outcome), "Open (untouched) lock task → closed 'On hold — no free stock, Supply Chain first' (" + JSON.stringify(lkRow) + ")");
    const DBt = d1(); A._resetSchemaFlag();
    await A.reconcile(DBt, offRun, CF, new Date().toISOString());
    DBt._db.prepare("UPDATE loop_cases SET touched=1, status='in_progress' WHERE ckey='LOCK|match|501:SKU_F'").run();
    await A.reconcile(DBt, r3, CF, new Date().toISOString());
    const tRow = DBt._db.prepare("SELECT status, blocked_by FROM loop_cases WHERE ckey='LOCK|match|501:SKU_F'").get(), sRow = DBt._db.prepare("SELECT id FROM loop_cases WHERE ckey='STOCK|sku|SKU_F'").get();
    ok(tRow.status === "waiting" && sRow && tRow.blocked_by === sRow.id, "Someone already working on it → kept, but 'waiting' on the Supply Chain stock task");
    const recBack = await A.reconcile(DBh, r2, CF, new Date().toISOString());
    ok(recBack.created.some((c) => c.ckey === "LOCK|match|501:SKU_F" && c.qty === 63), "Stock arrives → a fresh lock task for Marketplace (+63 = its share of the stock)");
    A._resetSchemaFlag();
  }
  const R = L.DEFAULT_CONFIG.routing;
  ok(R.CR_DROP_SKU.section === "navPpmAnalystProducts" && R.MATCH_DROP.byAcm && R.MATCH_DROP.section === "navMerchantPerf" && R.STOCK_OUT.section === "navDohPlanner" && R.LOCK_LOW.section === "navAvailabilityLocking", "Routing: product → Commercial, merchant → ACM, stock → Planner DOH, lock → Availability Locking");
  const s501 = run.signals.merchants["501"], s101 = run.signals.merchants["101"], s301 = run.signals.merchants["301"];
  ok(s501 && s501.signals.some((x) => x.rule === "N5" && x.data.suggest === 11250), "Merchant signal N5 (lock) with the suggested quantity (share of the stock)");
  ok(s101 && s101.signals.some((x) => x.rule === "N4"), "Merchant signal N4 (out of stock)");
  ok(s301 && s301.signals.some((x) => x.rule === "N2" && x.sku === "SKU_C"), "Merchant signal N2 (CR drop) on own SKU");
  ok(!JSON.stringify(run.signals).match(/cm3/i) || !JSON.stringify(run.signals.merchants).match(/"m":|cm3/i), "No CM3 in what the portal receives");
  ok(run.signals.alts.Kitchen && run.signals.alts.Kitchen.some((a) => a.sku === "SKU_F2") && !run.signals.alts.Kitchen.some((a) => a.sku === "SKU_F"), "Alternatives: healthy Kitchen SKU offered, locked SKU not offered");
  world.run = run;
}

section("Price change");
{
  const info = L.parseProductsInfo({ header: ["COUNTRY", "PRODUCT_ID", "BUNDLE_NAME", "CATEGORY_L1", "CATEGORY_L2", "CATEGORY_L3", "PRICE", "PROFIT"], rows: [["EG", "SKU_B", "", "", "", "", 500, 100], ["IRQ", "SKU_B", "", "", "", "", 35000, 5000]] });
  ok(info.get("SKU_B").price === 500, "Products Info: Egypt row kept, Iraq row ignored (no fake price changes)");
  const main = await L.loadMain(resOf(toCsv(worldRows({}))), today), cfg = L.mergeConfig(L.DEFAULT_CONFIG, {});
  const prod = (price) => new Map([["SKU_B", { n: "Beta", web: "Active", price, profit: 100, cat: "" }]]);
  const r1 = L.runEngine({ main, inv: await L.loadInventory(resOf(INV({}))), deb: null, locks: null, info: null, prices: {}, products: prod(500) }, cfg, new Date().toISOString());
  ok(!r1.cands.some((c) => c.reason === "PRICE_CHANGE") && r1.prices.SKU_B.p === 500, "first run only stores today's price (snapshot)");
  const r2 = L.runEngine({ main, inv: await L.loadInventory(resOf(INV({}))), deb: null, locks: null, info: null, prices: r1.prices, products: prod(560) }, cfg, new Date().toISOString());
  const pc = r2.cands.find((c) => c.reason === "PRICE_CHANGE");
  ok(pc && pc.sku === "SKU_B" && /500 → 560/.test(pc.ev.note) && !r2.cands.some((c) => c.reason === "CR_DROP_SKU" && c.sku === "SKU_B"), "next run: price 500 → 560 + CR drop → PRICE_CHANGE (Commercial), not a plain CR case");
}

section("Owners come from Users & Roles");
const ACCESS = {
  roles: { "Account Manager": { views: ["navOverview", "navMerchantPerf", "navAcmPerf"] }, "Commercial": { views: ["navOverview", "navPpmAnalystProducts"] }, "Marketplace": { views: ["navOverview", "navAvailabilityLocking", "navMpDeclineWatch", "navInventory"] }, "Supply Chain": { views: ["navOverview", "navDohPlanner"] }, "Admin": { views: "*", admin: true }, "Country Manager": { views: "*", admin: true } },
  users: { "sara@taager.com": { role: "Account Manager", acm: "Sara" }, "omar@taager.com": { role: "Account Manager", acm: "Omar" }, "com@taager.com": { role: "Commercial" }, "mp@taager.com": { role: "Marketplace" }, "sc@taager.com": { role: "Supply Chain" }, "cm@taager.com": { role: "Country Manager" } },
  trustLoginRole: true, defaultRole: "Merchant"
};
{
  const cfg = L.mergeConfig(L.DEFAULT_CONFIG, {});
  ok(A.assigneesOf({ reason: "MATCH_DROP", section: "navMerchantPerf", acm: "Sara" }, ACCESS, cfg).join() === "sara@taager.com", "ACM task → only the ACM named in the data");
  ok(A.assigneesOf({ reason: "CR_DROP_SKU", section: "navPpmAnalystProducts" }, ACCESS, cfg).join() === "com@taager.com", "Product task → everyone who sees Analyst / Products");
  ok(A.assigneesOf({ reason: "STOCK_OUT", section: "navDohPlanner" }, ACCESS, cfg).join() === "sc@taager.com", "Stock task → Supply Chain");
  ok(A.assigneesOf({ reason: "MATCH_DROP", section: "navMerchantPerf", acm: "Nobody" }, ACCESS, cfg).length === 0, "Unknown ACM → ownerless (Admin / Country Manager see it)");
  const cmw = A.whoIs(ACCESS, "cm@taager.com", "", {}); ok(cmw.isAdmin, "Country Manager = full control");
  ok(!A.whoIs(ACCESS, "x@taager.com", "Admin", {}).isAdmin, "A login-sheet 'Admin' claim alone does not give control");
}

// ------------------------------------------------------------------ API end-to-end through the Worker
section("API end-to-end (Worker + D1)");
const DB = d1(), KV = kv();
KV.m.set("access:config", JSON.stringify(ACCESS));
KV.m.set("loop:config", JSON.stringify({ testMode: { on: false } })); // the real routing is tested first; test mode at the end
let V = {};
globalThis.fetch = async (u, o) => {
  u = String(u);
  if (u.startsWith("https://apps.example")) { const b = JSON.parse(o.body); return new Response(JSON.stringify({ success: true, name: "N", email: b.email, role: "Commercial" })); }
  if (u.indexOf("8ac644f8") >= 0) return resOf(toCsv(worldRows(V)));
  if (u.indexOf("6048f9a4") >= 0) return resOf(LOCKS, "application/json");
  if (u.indexOf("e36159b1") >= 0) return resOf("[]", "application/json");
  if (u.indexOf("7d6164a3") >= 0) return resOf(JSON.stringify([{ SKU_ID: "SKU_A", NAME: "Alpha", X: "", WEBSITE_STATUS: "Active", PRICE: 735, Y: "", PROFIT: 200 }, { SKU_ID: "SKU_B", NAME: "Beta", X: "", WEBSITE_STATUS: "Active", PRICE: 500, Y: "", PROFIT: 120 }]), "application/json");
  if (u.indexOf("gid=1780730573") >= 0) return resOf(INV(V));
  if (u.indexOf("gid=1409034448") >= 0) return resOf(DEB);
  throw new Error("unexpected fetch " + u);
};
const env = { SYNC_CACHE: KV, LOOP_DB: DB, APPS_SCRIPT_URL: "https://apps.example/exec", STAFF_SESSION_SECRET: "x".repeat(40), ADMIN_KEY: "admin-key-123456", SERVICE_KEY: "service-key-123456", SHEET_ID: "sheet1" };
const ctx = { waitUntil() {} };
const call = async (q, { method = "GET", body, tok, hdr = {} } = {}) => { const h = Object.assign({}, hdr); if (tok) h["X-Staff-Token"] = tok; const r = await worker.fetch(new Request("https://w.example/?" + q, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, ctx); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; } return { s: r.status, j }; };
const login = async (email) => (await call("action=staffLogin", { method: "POST", body: { email, password: "pw" } })).j.token;
const tCM = await login("cm@taager.com"), tSara = await login("sara@taager.com"), tOmar = await login("omar@taager.com"), tCom = await login("com@taager.com"), tMp = await login("mp@taager.com"), tSc = await login("sc@taager.com");
{
  ok((await call("action=loopTasks")).s === 401, "No staff session → 401");
  ok((await call("action=loopRun", { method: "POST", tok: tSara, body: {} })).s === 403, "ACM cannot run the engine / open the control panel");
  let r = await call("action=loopRun", { method: "POST", tok: tCM, body: {} });
  ok(r.j.success && r.j.run.created > 0, "Country Manager runs the engine → cases created (" + (r.j.run && r.j.run.created) + ")");
  r = await call("action=loopTasks", { tok: tSara });
  const saraT = r.j.tasks;
  ok(saraT.length && saraT.every((t) => t.acm === "Sara" && t.section === "navMerchantPerf"), "Sara sees only her own merchants' tasks (" + saraT.map((t) => t.reason + ":" + t.tager_id).join(", ") + ")");
  ok(r.j.fyi.some((t) => t.reason === "STOCK_OUT"), "…and an FYI that Supply is on SKU_A (her merchants are children)");
  const omarT = (await call("action=loopTasks", { tok: tOmar })).j.tasks;
  ok(omarT.some((t) => t.reason === "MERCHANT_DROP" && t.tager_id === "401"), "Omar gets the MERCHANT_DROP for 401");
  const comT = (await call("action=loopTasks", { tok: tCom })).j.tasks;
  ok(comT.some((t) => t.reason === "CR_DROP_SKU") && comT.some((t) => t.reason === "PARTIAL_WATCH") && !comT.some((t) => t.section === "navMerchantPerf"), "Commercial gets the product-wide CR case + the partial watch");
  const scT = (await call("action=loopTasks", { tok: tSc })).j.tasks;
  ok(scT.length === 1 && scT[0].reason === "STOCK_OUT", "Supply Chain gets the stock-out");
  const mpT = (await call("action=loopTasks", { tok: tMp })).j.tasks;
  ok(mpT.some((t) => t.reason === "LOCK_LOW"), "Marketplace gets the lock running out");
  // update flow
  const t = saraT.find((x) => x.reason === "MATCH_DROP");
  ok((await call("action=loopUpdate", { method: "POST", tok: tOmar, body: { id: t.id, op: "start" } })).s === 403, "Omar cannot touch Sara's task");
  r = await call("action=loopUpdate", { method: "POST", tok: tSara, body: { id: t.id, op: "done" } });
  ok(r.s === 400, "Closing needs an outcome");
  r = await call("action=loopUpdate", { method: "POST", tok: tSara, body: { id: t.id, op: "done", action: "Called merchant", outcome: "Merchant fixed the confirmation script" } });
  ok(r.j.success && r.j.task.status === "done" && r.j.task.followup_at, "Done → waits for the D+7 follow-up");
  // ETA by supply
  r = await call("action=loopUpdate", { method: "POST", tok: tSc, body: { id: scT[0].id, op: "eta", eta: L.addDays(today, 3) } });
  ok(r.j.success && r.j.task.eta === L.addDays(today, 3), "Supply sets an ETA");
  // portal signals (service key)
  r = await call("action=loopPortalSignals", { method: "POST", body: { mids: ["101", "501"] } });
  ok(r.s === 401 || r.s === 403, "Portal signals need the service key");
  r = await call("action=loopPortalSignals", { method: "POST", hdr: { "X-Service-Key": "service-key-123456" }, body: { mids: ["101", "501"] } });
  ok(r.j.success && Object.keys(r.j.merchants).sort().join() === "101,501" && r.j.eta.SKU_A === L.addDays(today, 3), "Portal gets only the asked merchants + the Supply ETA");
  // merchant lock request → Marketplace task
  r = await call("action=loopMerchantRequest", { method: "POST", hdr: { "X-Service-Key": "service-key-123456" }, body: { mid: "501", sku: "SKU_F", kind: "increase", qty: 46, email: "m@shop.com" } });
  ok(r.j.success, "Merchant lock request accepted");
  const rq = (await call("action=loopTasks", { tok: tMp })).j.tasks.find((x) => x.reason === "LOCK_REQUEST");
  ok(rq && rq.qty === 46, "…it lands in Marketplace (Availability Locking) with the quantity");
  r = await call("action=loopUpdate", { method: "POST", tok: tMp, body: { id: rq.id, op: "done", action: "Approved", outcome: "internal: merchant is low quality", reply: "Lock +46 until 1 Nov" } });
  ok(r.j.task.status === "resolved", "Approving a request closes it (no follow-up)");
  r = await call("action=loopPortalSignals", { method: "POST", hdr: { "X-Service-Key": "service-key-123456" }, body: { mids: ["501"] } });
  ok(r.j.requests["501"] && r.j.requests["501"][0].decision === "Approved" && r.j.requests["501"][0].outcome === "Lock +46 until 1 Nov" && !JSON.stringify(r.j).includes("low quality"), "…the merchant sees the decision + the reply, never the internal note");
  ok(JSON.parse(KV.m.get("alerts:log")).some((a) => /Lock request/.test(a.title) && a.audience.users.indexOf("mp@taager.com") >= 0), "Marketplace got a bell notification for the request");

  // stock back → stock case resolves + relaunch tasks per ACM; Sara's CR recovers → follow-up resolves
  V = { stockBack: true, recovered: true };
  await call("action=loopAdminUpdate", { method: "POST", tok: tCM, body: { ids: [t.id], set: { followupDays: 0 } } });
  await new Promise((res) => setTimeout(res, 5));
  r = await call("action=loopRun", { method: "POST", tok: tCM, body: {} });
  ok(r.j.run.resolved >= 1 && r.j.run.chained === 2, "Stock back → stock case resolved + 2 relaunch tasks (Sara, Omar)");
  const sara2 = (await call("action=loopTasks", { tok: tSara })).j.tasks;
  ok(sara2.some((x) => x.reason === "RELAUNCH" && x.children.length === 2), "Sara gets 'Stock is back — relaunch' with her 2 merchants");
  const after = (await call("action=loopTask&id=" + t.id, { tok: tSara })).j.task;
  ok(after.status === "resolved" && after.score_after >= 70, "Follow-up re-scored the match → resolved (score " + after.score_after + ")");

  // SLA escalation
  const om = (await call("action=loopTasks", { tok: tOmar })).j.tasks.find((x) => x.reason === "MERCHANT_DROP");
  DB._db.prepare("UPDATE loop_cases SET due_at=?, created_at=? WHERE id=?").run(new Date(Date.now() - 3600e3).toISOString(), new Date(Date.now() - 72 * 3600e3).toISOString(), om.id);
  const cfg = L.mergeConfig(L.DEFAULT_CONFIG, {});
  const fu = await A.followUpAndSla(DB, null, cfg, new Date().toISOString());
  ok(fu.escalated.some((c) => c.id === om.id && c.escalation === 2), "Past 2× SLA → escalated to Admin / Country Manager");

  // review fixes
  {
    // owners = the team that owns the section, not everyone who can open the page
    const wide = { roles: Object.assign({}, ACCESS.roles, { "Account Manager": { views: ACCESS.roles["Account Manager"].views.concat("navAvailabilityLocking") } }), users: ACCESS.users };
    const lockCase = { reason: "LOCK_LOW", section: "navAvailabilityLocking", acm: "Sara" };
    ok(A.assigneesOf(lockCase, wide, cfg).join() === "mp@taager.com", "Lock task → Marketplace team only, even when ACMs can open Availability Locking");
    ok(!A.canSee(lockCase, { email: "sara@taager.com", role: "Account Manager", isAdmin: false, views: wide.roles["Account Manager"].views, acm: "sara" }, cfg, wide), "…and the ACM with page access does not see it as a task");
    const noMp = { roles: wide.roles, users: Object.fromEntries(Object.entries(ACCESS.users).filter(([e]) => e !== "mp@taager.com")) };
    ok(A.assigneesOf(lockCase, noMp, cfg).sort().join() === "omar@taager.com,sara@taager.com", "Nobody in Marketplace → falls back to who can open the page");
    const ov = L.mergeConfig(cfg, { routing: { LOCK_LOW: { team: "Account Manager", byAcm: true } } });
    ok(A.assigneesOf(lockCase, wide, ov).join() === "sara@taager.com", "Team override in Routing (+ By ACM) → the merchant's ACM");
  }
  ok(A.assigneesOf({ reason: "MATCH_DROP", section: "navMerchantPerf", acm: "" }, { roles: ACCESS.roles, users: Object.assign({ "new@taager.com": { role: "Account Manager" } }, ACCESS.users) }, cfg).length === 0, "A merchant with no ACM is ownerless (not given to ACMs without a linked name)");
  const fyiT = (await call("action=loopTasks", { tok: tSara })).j.fyi.concat((await call("action=loopTasks", { tok: tSara })).j.tasks);
  const anyFyi = (await call("action=loopTasks", { tok: tSara })).j.fyi[0];
  if (anyFyi) { const d = (await call("action=loopTask&id=" + anyFyi.id, { tok: tSara })).j.task; ok(!(d.evidence.scores && "cm3" in d.evidence.scores) && !(d.evidence.metrics && "cm3" in d.evidence.metrics), "FYI viewers (outside the section) do not get CM3"); }
  // a match that died is not "recovered" at follow-up
  {
    const dead = { today, sScore: new Map(), mScore: new Map(), xScore: new Map([["999|DEAD", L.scoreEntity({ p: new Float64Array(15), c: new Float64Array(15), d: new Float64Array(15), m: new Float64Array(15), g: new Float64Array(15) }, cfg.scoring)]]) };
    DB._db.prepare("INSERT INTO loop_cases (id, ckey, reason, family, level, metric, tager_id, product_id, status, followup_at, created_at, evidence, children) VALUES ('dead1','MATCH|match|999:DEAD','MATCH_DROP','MATCH','match','demand','999','DEAD','done',?,?,'{}','[]')").run(new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
    await A.followUpAndSla(DB, dead, cfg, new Date().toISOString());
    ok(DB._db.prepare("SELECT status FROM loop_cases WHERE id='dead1'").get().status === "open", "No orders at follow-up → reopened, not 'recovered'");
  }
  ok((await call("action=loopUpdate", { method: "POST", tok: tCom, body: { id: om.id, op: "comment", note: "x" } })).s === 403, "Commercial cannot touch an ACM task");

  // admin control
  ok((await call("action=loopConfigPut", { method: "POST", tok: tCom, body: { config: {} } })).s === 403, "Only Admin / Country Manager change the numbers");
  r = await call("action=loopConfigPut", { method: "POST", tok: tCM, body: { config: { testMode: { on: false }, scoring: { threshold: 60 }, merchant: { rules: { N5: { coverDays: 3 } } } } } });
  ok(r.j.success && r.j.config.scoring.threshold === 60 && r.j.config.merchant.rules.N5.coverDays === 3 && r.j.config.merchant.rules.N5.on === true, "Config saved and merged over defaults");
  r = await call("action=loopConfigPut", { method: "POST", tok: tCM, body: { config: { scoring: { windows: { demand: { r: [1, 3], h: [2, 8] } } } } } });
  ok(r.s === 400, "Overlapping windows refused");
  r = await call("action=loopAdminUpdate", { method: "POST", tok: tCM, body: { ids: [om.id], set: { assignee: "sara@taager.com", note: "cover for Omar" } } });
  ok(r.j.success && (await call("action=loopTasks", { tok: tSara })).j.tasks.some((x) => x.id === om.id), "Reassign: the task moves to Sara");
  r = await call("action=loopCreate", { method: "POST", tok: tCM, body: { title: "Check the new courier in Alex", section: "navMpDeclineWatch", dueHours: 12 } });
  ok(r.j.success && (await call("action=loopTasks", { tok: tMp })).j.tasks.some((x) => x.title === "Check the new courier in Alex"), "Manual task → Marketplace");
  r = await call("action=loopStats", { tok: tCM }); ok(r.j.success && r.j.stats.open > 0 && r.j.stats.recoveryRate === 100, "Scoreboard (open, recovery rate)");
  r = await call("action=loopExport", { tok: tCM }); ok(typeof r.j === "string" && r.j.startsWith("id,flag_date"), "Follow-up Log CSV export");
  r = await call("action=loopScores", { tok: tCM }); ok(r.j.scores && r.j.scores.merchant.length > 0, "Latest scores browsable");
  // RE-CPA
  r = await call("action=loopCpaCatalog", { tok: tSara });
  ok(r.j.items.SKU_A && r.j.items.SKU_A[1] === 735 && r.j.items.SKU_A[2] === 200 && r.j.items.SKU_A[7] === 100, "RE-CPA catalog: Taager price / profit + Delivered ASP (delivered GMV ÷ delivered pieces)");
  r = await call("action=loopCpaSave", { method: "POST", tok: tSara, body: { mid: "101", rows: [{ sku: "SKU_A", market: 950, cpa: 80, conv: 40, evil: "<x>" }] } });
  ok(r.j.success, "ACM saves a RE-CPA plan for a merchant");
  await call("action=loopCpaSync", { method: "POST", hdr: { "X-Service-Key": "service-key-123456" }, body: { mid: "101", email: "m@shop.com", rows: [{ sku: "SKU_A", cpa: 95 }] } });
  r = await call("action=loopCpaGet&mid=101", { tok: tSara });
  ok(r.j.staff.rows[0].cpa === 80 && !("evil" in r.j.staff.rows[0]) && r.j.merchant.rows[0].cpa === 95 && r.j.merchant.by === "m@shop.com", "…and sees the merchant's own plan from the portal");
  ok((await call("action=loopCpaSync", { method: "POST", body: { mid: "101", rows: [] } })).s === 401 || (await call("action=loopCpaSync", { method: "POST", body: { mid: "101", rows: [] } })).s === 403, "portal sync needs the service key");
  r = await call("action=loopPortalCatalog", { method: "POST", hdr: { "X-Service-Key": "service-key-123456" }, body: { sku: "SKU_A" } });
  ok(r.j.item.price === 735 && r.j.item.cr != null, "portal SKU lookup (price, profit, product CR/DR)");
  r = await call("action=loopConfigPut", { method: "POST", tok: tCM, body: { config: { testMode: { on: false }, cpa: { shipping: 60, showProductAverages: false } } } });
  r = await call("action=loopPortalCatalog", { method: "POST", hdr: { "X-Service-Key": "service-key-123456" }, body: { sku: "SKU_A" } });
  ok(r.j.item.cr === null && r.j.cfg.shipping === 60, "Admin can hide product averages from merchants and change the shipping fee");
  r = await call("action=loopUpdate", { method: "POST", tok: tCom, body: { id: comT.find((x) => x.reason === "CR_DROP_SKU").id, op: "cancel" } });
  ok(r.s === 403, "Only Admin / Country Manager can dismiss");
}
section("Test mode (default ON after deploy)");
{
  ok(L.DEFAULT_CONFIG.testMode.on === true && L.DEFAULT_CONFIG.testMode.recipients[0] === "youssef.hanafy@taager.com", "test mode is ON by default, only youssef.hanafy@taager.com");
  const T = Object.assign({}, ACCESS, { users: Object.assign({ "youssef.hanafy@taager.com": { role: "Account Manager" } }, ACCESS.users) });
  KV.m.set("access:config", JSON.stringify(T));
  const tY = await login("youssef.hanafy@taager.com");
  let r = await call("action=loopConfigPut", { method: "POST", tok: tCM, body: { config: { testMode: { on: true, recipients: ["youssef.hanafy@taager.com"] } } } });
  ok(r.j.success, "Admin switches test mode on");
  const before = JSON.parse(KV.m.get("alerts:log") || "[]").length;
  ok((await call("action=loopTasks", { tok: tSara })).j.tasks.length === 0 && (await call("action=loopTasks", { tok: tSara })).j.fyi.length === 0, "Sara sees no tasks while testing");
  ok((await call("action=loopTasks&scope=section&section=navAvailabilityLocking", { tok: tMp })).j.tasks.length === 0, "…no strip on the section pages either");
  r = await call("action=loopTasks", { tok: tY });
  ok(r.j.tasks.length > 3 && r.j.testMode.you && r.j.tasks.every((t) => Array.isArray(t.owners)), "the tester sees every task, with who WOULD own it");
  await call("action=loopCreate", { method: "POST", tok: tCM, body: { title: "Test task", section: "navMpDeclineWatch" } });
  const al = JSON.parse(KV.m.get("alerts:log")).slice(0, JSON.parse(KV.m.get("alerts:log")).length - before);
  ok(al.length >= 1 && al.every((a) => a.title.startsWith("[TEST]") && a.audience.users.join() === "youssef.hanafy@taager.com" && !a.audience.roles.length && /Would go to: mp@taager.com/.test(a.body)), "bell notifications go only to the tester, marked [TEST] + 'Would go to'");
  r = await call("action=loopPortalSignals", { method: "POST", hdr: { "X-Service-Key": "service-key-123456" }, body: { mids: ["501"] } });
  ok(r.j.cfg.enabled === false && r.j.cfg.lockRequests === false && r.j.cfg.testMode === true, "merchant portal notifications + lock requests are off while testing");
  r = await call("action=loopMerchantPreview&mid=501", { tok: tCM });
  ok(r.j.signals.some((x) => x.rule === "N5"), "Admin previews what merchant 501 would get");
  r = await call("action=loopConfigPut", { method: "POST", tok: tCM, body: { config: { testMode: { on: false } } } });
  ok((await call("action=loopTasks", { tok: tSara })).j.tasks.length > 0, "switching test mode off → owners see their tasks");
}
section("Quality gates + new overall tasks (real defaults)");
{
  const rows = [];
  // Home: 6 merchants of ACM Hana, each down 150 → 50 for 2 days in a row (confirmed)
  for (let k = 1; k <= 6; k++) series(rows, "70" + k, "Home " + k, "H" + k, "Home sku " + k, "Home", "Hana", (i) => (i === 1 || i === 2 ? 50 : 150));
  series(rows, "801", "Blip", "T1", "Toy one", "Toys2", "Zed", (i) => (i === 1 ? 20 : 60));   // one bad day only → no task yet
  series(rows, "802", "Small", "T2", "Toy two", "Toys2", "Zed", (i) => (i <= 2 ? 6 : 10));    // confirmed but tiny (< 2,000 EGP/day)
  // PPM: H1 earns 10 / delivered piece, the rest 60; Home target = 50 / piece
  rows.forEach((r) => { r[27] = r[3] === "H1" ? r[17] * 10 : r[3].startsWith("H") ? r[17] * 60 : r[17] * 45; });
  const D = { main: await L.loadMain(resOf(toCsv(rows)), today), inv: null, deb: null, locks: null, info: null, prices: {},
    catTargets: L.parseCategoryTargets({ header: ["Category", "Daily Target", "Target PPM Pieces"], rows: [["Home", 500, 50], ["Grand Total", 900, 40]] }) };
  const cfg = L.mergeConfig(L.DEFAULT_CONFIG, { tasks: REAL.tasks, routing: REAL.routing, diagnose: REAL.diagnose });
  const run = L.runEngine(D, cfg, new Date().toISOString());
  const by = (r) => run.cands.filter((c) => c.reason === r);
  ok(by("CATEGORY_DROP").length === 1 && by("CATEGORY_DROP")[0].category === "Home" && by("CATEGORY_DROP")[0].children.length === 6, "Category down overall → one CATEGORY_DROP for Home (Commercial) with its SKUs");
  const ad = by("ACM_DROP");
  ok(ad.length === 1 && ad[0].acm === "Hana" && ad[0].children.length === 6 && cfg.routing.ACM_DROP.byAcm, "ACM portfolio down → one ACM_DROP for Hana with her merchants");
  ok(by("MERCHANT_DROP").length === 6 && !by("MATCH_DROP").length, "Merchant down on 1 SKU → MERCHANT_DROP (no separate match tasks)");
  ok(!run.cands.some((c) => c.mid === "801" || c.acm === "Zed"), "One bad day only → no task yet (needs 2 days in a row)");
  ok(!run.cands.some((c) => c.mid === "802") && run.stats.gated.small > 0, "Confirmed but under 2,000 EGP/day → no task");
  const pp = by("PPM_LOW");
  ok(pp.length === 1 && pp[0].sku === "H1" && pp[0].ev.ppm.actual === 10 && pp[0].ev.ppm.target === 50 && pp[0].ev.ppm.pct === 20, "PPM / piece 10 vs Home target 50 (20% < 80%) → PPM_LOW for H1 only");
  ok(REAL.routing.CM3_DROP.enabled && REAL.routing.NEGATIVE_CM3.enabled && REAL.routing.PPM_LOW.enabled, "CM3 down stays on next to the new PPM task");
  ok(L.caseKey(ad[0]) === "ACM|acmall|hana" && L.caseKey(by("CATEGORY_DROP")[0]) === "CATEGORY|category|home", "stable case keys for category / ACM");
  ok(A.titleOf(Object.assign({ level: "acmall", reason: "ACM_DROP", acm: "Hana", children: ad[0].children })).indexOf("Hana (6 merchants down)") > 0, "ACM task title names the ACM");
  // max new tasks per run
  const DB2 = d1(); A._resetSchemaFlag();
  const rec = await A.reconcile(DB2, run, L.mergeConfig(cfg, { tasks: { maxNewPerRun: 3 } }), new Date().toISOString());
  ok(rec.created.length === 3 && rec.heldBack === run.cands.length - 3 && rec.created[0].impact >= rec.created[2].impact, "At most 3 new tasks per run, biggest EGP/day first (" + rec.heldBack + " wait)");
  const noT = L.runEngine(Object.assign({}, D, { catTargets: null }), cfg, new Date().toISOString());
  ok(!noT.cands.some((c) => c.reason === "PPM_LOW") && noT.warnings.some((w) => /Category Targets/.test(w)), "No Category Targets → PPM checks skipped with a warning");
}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
