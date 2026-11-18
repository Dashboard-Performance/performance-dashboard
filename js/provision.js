/* Commercial → Provision Products (v1.18.3)
   One overall tracker for the SKUs listed in the "Tracking-SKU's" tab (gid 1999299868: SKU ID, SKU NAME).
   Actuals only — no forecast anywhere on this page. Every number comes from data the dashboard already loads:
     • Main (Matches)            → placed / confirmed / delivered pieces, GMV, CM3, PPM, merchants, last sale
     • Inventory                 → stock, DOH, availability
     • Products / COGS           → price, profit, COGS, website status, lock, category / sub-category / product type
     • Availability Locking      → stock locked for merchants (remaining pieces, lock not expired)
     • Inbound                   → last receipt, received this month
     • Debundle map              → live bundles that contain the SKU and their confirmed orders
     • Sales Plan (ACM)          → merchants planned on the SKU and their daily placed target
   Periods follow the DATA, not the device clock: the data day = the newest day in Main.
     MTD = 1st of that month → data day · LM = the same days of the month before · 7d = the last 7 data days vs the 7 before.
     CR / DR = rolling 30 days, matured (CR ends 2 days before the data day, DR 5 days before), like PPM Analyst. */
(function () {
  "use strict";
  var GID = "1999299868", PAGE = 50, DAY = 86400000;
  var C = null;
  function $(id) { return document.getElementById(id); }
  function st() { try { return state; } catch (e) { return {}; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fin(v) { return v != null && isFinite(v); }
  function int(v) { return fin(v) ? Math.round(+v).toLocaleString("en-US") : "—"; }
  function money(v) { return fin(v) ? "EGP " + int(v) : "—"; }
  function pct(v, d) { return fin(v) ? (+v).toFixed(d == null ? 1 : d) + "%" : "—"; }
  function delta(v) { if (!fin(v)) return '<span class="text-dim">—</span>'; var c = v > 0.5 ? "text-green" : v < -0.5 ? "text-red" : "text-dim"; return '<span class="' + c + '">' + (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(0) + '%</span>'; }
  function chg(a, b) { return b > 0 ? (a - b) / b * 100 : (a > 0 ? null : null); }
  function dayOf(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function shift(ms, n) { var d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
  function fmtDay(ms) { return ms ? new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"; }
  function cell(c) { return c ? (c.v != null ? c.v : c.f) : ""; }

  var PP = { skus: null, loading: false, err: "", sig: "", data: null, q: "", cat: "all", status: "all", sort: "conf", dir: -1, page: 0,
    th: { low: 7, over: 90, trend: 30 }, poll: null, watch: null, chart: null };

  // ---------- the SKU list (Tracking-SKU's tab) ----------
  function parseList(p) {
    var rows = (p && p.table && p.table.rows) || [], cols = (p && p.table && p.table.cols) || [], out = [], seen = {};
    var labels = cols.map(function (c) { return String((c && c.label) || "").trim().toUpperCase(); });
    var iId = labels.indexOf("SKU ID"), iName = labels.indexOf("SKU NAME");
    if (iId < 0) iId = 0; if (iName < 0) iName = 1;
    rows.forEach(function (r) {
      var c = r.c || [], id = String(cell(c[iId]) || "").trim();
      if (!id || id.toUpperCase() === "SKU ID" || seen[id]) return;
      seen[id] = 1; out.push({ id: id, name: String(cell(c[iName]) || "").trim() });
    });
    return out;
  }
  function loadList(host) {
    if (PP.loading) return; PP.loading = true; PP.err = "";
    var go = typeof loadSheetWithRetry === "function" ? loadSheetWithRetry(GID) : Promise.reject(new Error("Sheet loader not available"));
    go.then(function (p) { PP.skus = parseList(p); PP.sig = ""; }).catch(function (e) { PP.err = (e && e.message) || String(e); })
      .then(function () { PP.loading = false; if (host && host.isConnected && !host.classList.contains("hidden")) render(host); });
  }

  // ---------- build ----------
  function srcRefs() { var s = st(); return [PP.skus, s.allParsedRows, s.inventoryMap, s.productsMap, s.cogsMap, s.availabilityLockingRows, s.inboundRows, s.debundleMap, s.acmSalesPlanData]; }
  function build() {
    var s = st(), main = s.allParsedRows || [];
    if (!PP.skus || !main.length) return null;
    var refs = srcRefs(), sig = refs.map(function (x) { return x && x.length != null ? x.length : x && x.size != null ? x.size : x ? Object.keys(x).length : 0; }).join("|");
    if (PP.data && PP.sig === sig && PP.refs && refs.every(function (x, i) { return x === PP.refs[i]; })) return PP.data;
    PP.sig = sig; PP.refs = refs;

    var inv = s.inventoryMap || {}, prods = s.productsMap || {}, cogsM = s.cogsMap, now = Date.now();
    var tracked = {}; PP.skus.forEach(function (x, i) { tracked[x.id] = i; });

    // data day = the newest day in Main with activity
    var anchor = 0; main.forEach(function (r) { if (r.timestamp > anchor && ((r.placedPieces || 0) > 0 || (r.confirmedPieces || 0) > 0)) anchor = r.timestamp; });
    if (!anchor) return null;
    anchor = dayOf(anchor);
    var ad = new Date(anchor), dayN = ad.getDate();
    var mStart = new Date(ad.getFullYear(), ad.getMonth(), 1).getTime();
    var lmStart = new Date(ad.getFullYear(), ad.getMonth() - 1, 1).getTime();
    var lmLen = new Date(ad.getFullYear(), ad.getMonth(), 0).getDate();
    var lmEnd = new Date(ad.getFullYear(), ad.getMonth() - 1, Math.min(dayN, lmLen)).getTime();
    var w1 = shift(anchor, -6), w0 = shift(anchor, -13);
    var lag = (typeof CM3_LAG_DAYS !== "undefined" && CM3_LAG_DAYS >= 0) ? CM3_LAG_DAYS : 4, cm3End = shift(anchor, -lag); // same CM3 cutoff as the rest of the dashboard
    var crEnd = shift(anchor, -2), crStart = shift(crEnd, -29), drEnd = shift(anchor, -5), drStart = shift(drEnd, -29);

    // bundles containing each tracked single
    var bundlesOf = {}, bundleSingles = {};
    (s.debundleMap || []).forEach(function (b) {
      if (!b.productId || !b.singleId || b.productId === b.singleId || tracked[b.singleId] == null) return;
      (bundlesOf[b.singleId] = bundlesOf[b.singleId] || {})[b.productId] = b.quantity || 1;
      (bundleSingles[b.productId] = bundleSingles[b.productId] || []).push(b.singleId);
    });

    var A = {};
    function agg(id) {
      return A[id] || (A[id] = { pM: 0, cM: 0, dM: 0, cL: 0, c7: 0, c7p: 0, gmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0, dPcsM: 0, crP: 0, crC: 0, drC: 0, drD: 0,
        merch: {}, merchL: {}, lastSale: 0, bOrdM: 0, bOrdL: 0, bLive: {}, daily: {}, dailyL: {} });
    }
    main.forEach(function (r) {
      var id = r.sku, isT = tracked[id] != null, bs = bundleSingles[id];
      if (!isT && !bs) return;
      var t = dayOf(r.timestamp), cp = r.confirmedPieces || 0;
      if (isT) {
        var a = agg(id);
        if (t >= mStart && t <= anchor) {
          a.pM += r.placedPieces || 0; a.cM += cp; a.dM += r.deliveredPieces || 0;
          a.gmv += r.deliveredGmv || 0; if (t <= cm3End) { a.cm3 += r.cm3 || 0; a.cm3Gmv += r.deliveredGmv || 0; } a.ppm += r.ppm || 0; a.dPcsM += r.deliveredPieces || 0;
          if (cp > 0 && r.merchantId) a.merch[r.merchantId] = (a.merch[r.merchantId] || 0) + cp;
          var dm = new Date(t).getDate(); a.daily[dm] = (a.daily[dm] || 0) + cp;
        }
        if (t >= lmStart && t < mStart) {
          if (cp > 0 && r.merchantId) a.merchL[r.merchantId] = 1;
          var dl = new Date(t).getDate(); a.dailyL[dl] = (a.dailyL[dl] || 0) + cp;
          if (t <= lmEnd) a.cL += cp;
        }
        if (t >= w1 && t <= anchor) a.c7 += cp; else if (t >= w0 && t < w1) a.c7p += cp;
        if (t >= crStart && t <= crEnd) { a.crP += r.placedPieces || 0; a.crC += cp; }
        if (t >= drStart && t <= drEnd) { a.drC += cp; a.drD += r.deliveredPieces || 0; }
        if (cp > 0 && t > a.lastSale) a.lastSale = t;
      }
      if (bs) {
        var co = r.confirmedOrders || 0;
        bs.forEach(function (sid) {
          var b = agg(sid);
          if (t >= mStart && t <= anchor) { b.bOrdM += co; if (co > 0) b.bLive[id] = 1; }
          else if (t >= lmStart && t <= lmEnd) b.bOrdL += co;
        });
      }
    });

    var locked = {};
    (s.availabilityLockingRows || []).forEach(function (l) {
      if (tracked[l.singleId] == null || l.allocatedBlank) return;
      if (l.expiryTs && l.expiryTs < now) return;
      var rem = +l.remainingPieces || 0; if (rem > 0) locked[l.singleId] = (locked[l.singleId] || 0) + rem;
    });
    var inb = {};
    (s.inboundRows || []).forEach(function (x) {
      if (tracked[x.sku] == null || !x.rcvTs) return;
      var o = inb[x.sku] || (inb[x.sku] = { last: 0, lastQty: 0, mtd: 0, l90: 0 }), t = dayOf(x.rcvTs);
      if (t > o.last) { o.last = t; o.lastQty = x.rcvQty || 0; } else if (t === o.last) o.lastQty += x.rcvQty || 0;
      if (t >= mStart) o.mtd += x.rcvQty || 0;
      if (t >= shift(anchor, -89)) o.l90 += x.rcvQty || 0;
    });
    var plan = {};
    (s.acmSalesPlanData || []).forEach(function (p) {
      if (tracked[p.productId] == null) return;
      var o = plan[p.productId] || (plan[p.productId] = { m: {}, t: 0 });
      if (p.tagerId) o.m[p.tagerId] = 1; o.t += +p.dailyPlacedTarget || 0;
    });

    var th = PP.th, cats = {}, rows = PP.skus.map(function (sk, i) {
      var id = sk.id, a = A[id] || agg(id), iv = inv[id] || {}, pr = prods[id] || {}, ib = inb[id] || {}, pl = plan[id];
      var cogs = cogsM && cogsM.get ? (cogsM.get(id) || 0) : 0;
      var price = +pr.price || 0, profit = +pr.profit || 0;
      var stock = fin(iv.stock) ? +iv.stock : null, doh = fin(iv.doh) ? +iv.doh : null, lk = locked[id] || 0;
      var free = stock == null ? null : Math.max(0, stock - lk);
      var avg7 = a.c7 / 7;
      var mList = Object.keys(a.merch), top = null;
      mList.forEach(function (m) { if (!top || a.merch[m] > a.merch[top]) top = m; });
      var info = s.merchantInfoMap && s.merchantInfoMap.get ? s.merchantInfoMap : null;
      var topName = top ? ((info && info.get(top) && info.get(top).merchantName) || top) : "";
      var r = {
        n: i + 1, id: id, name: sk.name || iv.skuName || "", cat: iv.category || pr.category || "—", sub: pr.subCategory || "", sc: pr.sc || "",
        web: pr.websiteStatus || "", locked: pr.isLocked || iv.isLocked || "", avail: iv.availability || "",
        price: price || null, profit: profit || null, cogs: cogs || null, lppm: price ? price - profit - cogs : null,
        pM: a.pM, conf: a.cM, dM: a.dM, cL: a.cL, dLM: chg(a.cM, a.cL), c7: a.c7, c7p: a.c7p, d7: chg(a.c7, a.c7p), avg7: avg7, avgM: a.cM / dayN,
        cr: a.crP > 0 ? a.crC / a.crP * 100 : null, dr: a.drC > 0 ? a.drD / a.drC * 100 : null,
        gmv: a.gmv, cm3: a.cm3, cm3Gmv: a.cm3Gmv, cm3p: a.cm3Gmv > 0 ? a.cm3 / a.cm3Gmv * 100 : null, ppm: a.ppm, ppmPc: a.dPcsM > 0 ? a.ppm / a.dPcsM : null, asp: a.dPcsM > 0 ? a.gmv / a.dPcsM : null,
        merch: mList.length, merchNew: mList.filter(function (m) { return !a.merchL[m]; }).length, top: topName, topShare: top && a.cM > 0 ? a.merch[top] / a.cM * 100 : null,
        lastSale: a.lastSale || 0, idle: a.lastSale ? Math.round((anchor - a.lastSale) / DAY) : null,
        stock: stock, doh: doh, lockQ: lk, free: free, cover: free != null && avg7 > 0 ? free / avg7 : null,
        inLast: ib.last || 0, inLastQty: ib.lastQty || 0, inMtd: ib.mtd || 0, in90: ib.l90 || 0, inAge: ib.last ? Math.round((anchor - ib.last) / DAY) : null,
        bundles: Object.keys(bundlesOf[id] || {}).length, bLive: Object.keys(a.bLive).length, bOrd: a.bOrdM, bOrdL: a.bOrdL, dB: chg(a.bOrdM, a.bOrdL),
        planM: pl ? Object.keys(pl.m).length : 0, planT: pl ? pl.t : 0, planA: pl && pl.t > 0 ? a.pM / (pl.t * dayN) * 100 : null,
        known: !!(inv[id] || prods[id] || A[id] && (a.pM || a.cL))
      };
      r.ndr = fin(r.cr) && fin(r.dr) ? r.cr * r.dr / 100 : null;
      // status (first match wins) + what to do about it
      var sold30 = a.lastSale && anchor - a.lastSale < 30 * DAY;
      if (!r.known) { r.st = "unknown"; }
      else if (stock != null && stock <= 0) r.st = sold30 ? "oosSelling" : "oos";
      else if (stock > 0 && free <= 0) r.st = "allLocked";
      else if (a.cM <= 0 && a.c7 <= 0) r.st = "notSelling";
      else if (doh != null && doh > 0 && doh < th.low) r.st = "low";
      else if (doh != null && doh > th.over) r.st = "over";
      else if (a.c7p >= 10 && r.d7 != null && r.d7 <= -th.trend) r.st = "down";
      else if (a.c7p >= 10 && r.d7 != null && r.d7 >= th.trend) r.st = "up";
      else r.st = "ok";
      var c = cats[r.cat] || (cats[r.cat] = { cat: r.cat, n: 0, sell: 0, conf: 0, cL: 0, gmv: 0, cm3: 0, stock: 0, oos: 0 });
      c.n++; if (a.cM > 0) c.sell++; c.conf += a.cM; c.cL += a.cL; c.gmv += a.gmv; c.cm3 += a.cm3; c.stock += stock > 0 ? stock : 0; if (r.st === "oos" || r.st === "oosSelling") c.oos++;
      return r;
    });

    // tracked SKUs per day: this month vs last month
    var dailyM = [], dailyL = [];
    for (var d = 1; d <= 31; d++) { var sm = 0, sl = 0; for (var k in A) if (tracked[k] != null) { sm += A[k].daily[d] || 0; sl += A[k].dailyL[d] || 0; } dailyM.push(d <= dayN ? sm : null); dailyL.push(d <= lmLen ? sl : null); }

    PP.data = { rows: rows, anchor: anchor, cm3End: cm3End, lag: lag, dayN: dayN, mStart: mStart, lmStart: lmStart, lmEnd: lmEnd, lmLen: lmLen, cats: Object.keys(cats).map(function (k) { return cats[k]; }).sort(function (x, y) { return y.conf - x.conf; }),
      dailyM: dailyM, dailyL: dailyL };
    return PP.data;
  }

  var ST = {
    oosSelling: ["Out of stock · was selling", "bad", "Restock now — it sold in the last 30 days and has no stock."],
    oos: ["Out of stock", "bad", "Decide: restock or drop from tracking."],
    allLocked: ["All stock locked", "warn", "Every piece is locked for merchants — check the locks are being used."],
    notSelling: ["Not selling", "warn", "Has stock but no confirmed piece this month — push to merchants or review the price."],
    low: ["Low DOH", "warn", "Stock runs out soon at today's pace — plan the next receipt."],
    over: ["Overstock", "warn", "Too many days of stock — promote, bundle or re-price."],
    down: ["Declining", "warn", "Last 7 days fell vs the 7 before — check price, availability and merchants."],
    up: ["Growing", "good", "Last 7 days grew vs the 7 before — keep it in stock."],
    ok: ["Healthy", "good", "On track."],
    unknown: ["Not found", "", "Not in Inventory, Products or Main — check the SKU ID."]
  };

  // ---------- view ----------
  function view(d) {
    var q = PP.q.trim().toLowerCase();
    var rows = d.rows.filter(function (r) {
      if (PP.cat !== "all" && r.cat !== PP.cat) return false;
      if (PP.status !== "all" && r.st !== PP.status) return false;
      if (q && r.id.toLowerCase().indexOf(q) < 0 && String(r.name).toLowerCase().indexOf(q) < 0 && String(r.top).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = PP.sort, dir = PP.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === "st") { x = ST[a.st][0]; y = ST[b.st][0]; }
      var nx = x == null || x === "" || (typeof x === "number" && !isFinite(x)), ny = y == null || y === "" || (typeof y === "number" && !isFinite(y));
      if (nx && ny) return a.n - b.n; if (nx) return 1; if (ny) return -1;
      if (typeof x === "string" || typeof y === "string") return dir * String(x).localeCompare(String(y));
      return dir * (x - y) || a.n - b.n;
    });
  }

  // columns: [key, label, group, cell fn, tooltip, numeric]
  function dayCell(ms, age) { return ms ? fmtDay(ms) + (age != null ? ' <small class="text-dim">(' + age + 'd)</small>' : "") : '<span class="text-dim">—</span>'; }
  var COLS = [
    ["id", "SKU", function (r) { return '<b>' + esc(r.id) + '</b>'; }, "", 0],
    ["name", "Name", function (r) { return '<span style="display:inline-block;max-width:260px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom" title="' + esc(r.name) + '">' + esc(r.name) + '</span>'; }, "", 0],
    ["cat", "Category", function (r) { return esc(r.cat); }, "Inventory → Products", 0],
    ["avail", "Availability", function (r) { return esc(r.avail); }, "Inventory → availability", 0],
    ["stock", "Stock", function (r) { return '<b>' + int(r.stock) + '</b>'; }, "Inventory", 1],
    ["doh", "DOH", function (r) { return int(r.doh); }, "Inventory → days on hand", 1],
    ["price", "Price", function (r) { return int(r.price); }, "Products → selling price", 1],
    ["profit", "Merchant profit", function (r) { return int(r.profit); }, "Products → profit", 1],
    ["cogs", "COGS", function (r) { return int(r.cogs); }, "COGS tab", 1],
    ["lppm", "List PPM", function (r) { return int(r.lppm); }, "Price − merchant profit − COGS", 1],
    ["pM", "Placed pcs MTD", function (r) { return int(r.pM); }, "", 1],
    ["conf", "Confirmed pcs MTD", function (r) { return '<b>' + int(r.conf) + '</b>'; }, "", 1],
    ["dM", "Delivered pcs MTD", function (r) { return int(r.dM); }, "", 1],
    ["dLM", "Δ vs LM", function (r) { return delta(r.dLM); }, "Confirmed MTD vs the same days of last month", 1],
    ["d7", "Δ 7d", function (r) { return delta(r.d7); }, "Confirmed last 7 days vs the 7 before", 1],
    ["cr", "CR %", function (r) { return pct(r.cr); }, "Confirmed ÷ placed pieces, 30 days ending 2 days before the data day", 1],
    ["dr", "DR %", function (r) { return pct(r.dr); }, "Delivered ÷ confirmed pieces, 30 days ending 5 days before the data day", 1],
    ["ndr", "NDR %", function (r) { return pct(r.ndr); }, "CR × DR", 1],
    ["gmv", "Delivered GMV MTD", function (r) { return int(r.gmv); }, "", 1],
    ["cm3", "CM3", function (r) { return '<span class="' + (r.cm3 < 0 ? "text-red" : "") + '">' + int(r.cm3) + '</span>'; }, "CM3 MTD up to the CM3 cutoff (newest data day − CM3 lag days), like the rest of the dashboard", 1],
    ["cm3p", "CM3 %", function (r) { return pct(r.cm3p); }, "CM3 ÷ delivered GMV of the same days (CM3 cutoff)", 1],
    ["ppm", "PPM MTD", function (r) { return int(r.ppm); }, "Delivered PPM", 1],
    ["ppmPc", "PPM / pc", function (r) { return int(r.ppmPc); }, "Delivered PPM ÷ delivered pieces", 1],
    ["asp", "ASP", function (r) { return int(r.asp); }, "Delivered GMV ÷ delivered pieces", 1],
    ["merch", "Merchants MTD", function (r) { return int(r.merch); }, "Merchants with a confirmed piece this month", 1],
    ["top", "Top merchant", function (r) { return r.top ? '<span style="display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom" title="' + esc(r.top) + '">' + esc(r.top) + '</span>' : '<span class="text-dim">—</span>'; }, "Most confirmed pieces this month", 0],
    ["topShare", "Top share", function (r) { return pct(r.topShare, 0); }, "Top merchant's share of confirmed pieces", 1]
  ];
  function cols() { return COLS; }

  function tile(label, value, sub, cls) { return '<div class="cx-tile"><span>' + label + '</span><b class="' + (cls || "") + '">' + value + '</b><small>' + sub + '</small></div>'; }

  function render(host) {
    if (!PP.skus) {
      if (!PP.loading && !PP.err) loadList(host);
      host.innerHTML = '<div class="panel" style="padding:18px"><div class="sc-note">' + (PP.err ? 'Could not read the Tracking-SKU\'s tab (gid ' + GID + '): ' + esc(PP.err) + ' <button type="button" class="btn" id="ppRetry">Try again</button>' : 'Loading the SKU list (Tracking-SKU\'s tab)…') + '</div></div>';
      var rb = host.querySelector("#ppRetry"); if (rb) rb.addEventListener("click", function () { PP.err = ""; render(host); });
      return;
    }
    var d = build();
    watch(host);
    if (!d) { host.innerHTML = '<div class="panel" style="padding:18px"><div class="sc-note">Waiting for dashboard data (Main, Inventory, Products). This page fills in by itself.</div></div>'; return; }
    var R = d.rows, sum = function (k) { return R.reduce(function (a, r) { return a + (fin(r[k]) ? r[k] : 0); }, 0); };
    var cnt = function (f) { return R.filter(f).length; };
    var conf = sum("conf"), cL = sum("cL"), gmv = sum("gmv"), cm3 = sum("cm3");
    var w = function (k, wk) { var a = 0, b = 0; R.forEach(function (r) { if (fin(r[k]) && r[wk] > 0) { a += r[k] * r[wk]; b += r[wk]; } }); return b > 0 ? a / b : null; };
    var c7 = sum("c7"), c7p = sum("c7p");
    var sts = {}; R.forEach(function (r) { sts[r.st] = (sts[r.st] || 0) + 1; });
    var mName = new Date(d.anchor).toLocaleDateString("en-GB", { month: "long" });
    var tiles = [
      tile("Tracked SKUs", int(R.length), int(cnt(function (r) { return r.conf > 0; })) + " sold this month · " + int(cnt(function (r) { return !r.known; })) + " not found"),
      tile("Confirmed pcs MTD", int(conf), delta(chg(conf, cL)) + " vs " + int(cL) + " (same days LM)"),
      tile("Confirmed 7d", int(c7), delta(chg(c7, c7p)) + " vs the 7 days before"),
      tile("Delivered GMV MTD", money(gmv), "CM3 " + money(cm3) + " · " + pct(sum("cm3Gmv") > 0 ? cm3 / sum("cm3Gmv") * 100 : null) + " (to " + fmtDay(d.cm3End) + ")"),
      tile("CR / DR", pct(w("cr", "pM"), 0) + " / " + pct(w("dr", "conf"), 0), "weighted by pieces · 30 days, matured"),
      tile("Stock", int(sum("stock")), "free " + int(sum("free")) + " · locked " + int(sum("lockQ"))),
      tile("Out of stock", int((sts.oos || 0) + (sts.oosSelling || 0)), int(sts.oosSelling || 0) + " of them sold in the last 30 days", (sts.oosSelling ? "text-red" : "")),
      tile("Low DOH / Overstock", int(sts.low || 0) + " / " + int(sts.over || 0), "DOH < " + PP.th.low + " · DOH > " + PP.th.over),
      tile("Inbound MTD", int(sum("inMtd")), int(cnt(function (r) { return r.inMtd > 0; })) + " SKUs received this month")
    ];
    var cs = cols();

    var html = '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Provision Products</h2>' +
      '<p>Overall tracker for the ' + int(R.length) + ' SKUs in the Tracking-SKU\'s tab. Actuals only. Data day <b>' + fmtDay(d.anchor) + '</b> · MTD = 1–' + d.dayN + ' ' + esc(mName) + ' · LM = 1–' + Math.min(d.dayN, d.lmLen) + ' ' + esc(new Date(d.lmStart).toLocaleDateString("en-GB", { month: "long" })) + '.</p></div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.join("") + '</div></div>';

    html += '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">' +
      '<div class="panel hover-glow" style="flex:2 1 520px;min-width:0"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Confirmed pieces per day</h2><p>All tracked SKUs · this month vs last month, by day of the month</p></div></div><div style="height:260px;padding:0 18px 16px"><canvas id="ppChart"></canvas></div></div>' +
      '<div class="panel table-panel hover-glow" style="flex:1 1 380px;min-width:0"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>By category</h2><p>Click a row to filter the table</p></div></div><div class="table-responsive" style="max-height:276px;overflow:auto"><table class="data-table"><thead><tr><th>Category</th><th class="num">SKUs</th><th class="num">Selling</th><th class="num">Conf MTD</th><th class="num">Δ LM</th><th class="num">CM3</th><th class="num">Stock</th><th class="num">OOS</th></tr></thead><tbody>' +
      d.cats.map(function (c) { return '<tr data-cat="' + esc(c.cat) + '" style="cursor:pointer' + (PP.cat === c.cat ? ';background:color-mix(in srgb,var(--accent) 12%,transparent)' : '') + '"><td>' + esc(c.cat) + '</td><td class="num">' + int(c.n) + '</td><td class="num">' + int(c.sell) + '</td><td class="num">' + int(c.conf) + '</td><td class="num">' + delta(chg(c.conf, c.cL)) + '</td><td class="num">' + int(c.cm3) + '</td><td class="num">' + int(c.stock) + '</td><td class="num' + (c.oos ? ' text-red' : '') + '">' + int(c.oos) + '</td></tr>'; }).join("") +
      '</tbody></table></div></div></div>';

    var catOpts = d.cats.map(function (c) { return '<option value="' + esc(c.cat) + '"' + (PP.cat === c.cat ? " selected" : "") + '>' + esc(c.cat) + '</option>'; }).join("");
    html += '<div class="panel table-panel hover-glow"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>SKUs</h2><p>Tracking-SKU\'s tab · click a column title to sort</p></div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:0 18px 12px">' +
      '<select id="ppCat" class="date-filter-input" style="flex:0 0 auto"><option value="all">All categories</option>' + catOpts + '</select>' +
      '<input id="ppQ" type="search" class="date-filter-input" style="flex:0 1 260px;min-width:160px" placeholder="Search SKU, name or merchant" value="' + esc(PP.q) + '">' +
      '<button type="button" class="tw-exp" id="ppCsv">Export CSV</button>' +
      '<button type="button" class="btn" id="ppReload" title="Read the Tracking-SKU\'s tab again">Reload SKU list</button></div>' +
      '<div class="table-responsive"><table class="data-table" id="ppTable"><thead><tr>' +
      cs.map(function (c) { return '<th data-k="' + c[0] + '"' + (c[4] ? ' class="num"' : '') + (c[3] ? ' title="' + esc(c[3]) + '"' : '') + '>' + c[1] + (PP.sort === c[0] ? (PP.dir < 0 ? " ▼" : " ▲") : "") + '</th>'; }).join("") +
      '</tr></thead><tbody id="ppBody"></tbody></table></div>' +
      '<div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:10px 18px"><button type="button" class="btn" id="ppPrev">Prev</button><span class="text-dim" id="ppPageInfo"></span><button type="button" class="btn" id="ppNext">Next</button></div></div>';
    host.innerHTML = html;
    drawBody(host);
    drawChart(host, d);
    wire(host);
  }

  function drawBody(host) {
    var rows = view(PP.data), cs = cols(), pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (PP.page > pages - 1) PP.page = pages - 1; if (PP.page < 0) PP.page = 0;
    var body = host.querySelector("#ppBody"); if (!body) return;
    var slice = rows.slice(PP.page * PAGE, PP.page * PAGE + PAGE);
    body.innerHTML = slice.length ? slice.map(function (r) {
      return '<tr>' + cs.map(function (c) { return '<td' + (c[4] ? ' class="num"' : '') + '>' + c[2](r) + '</td>'; }).join("") + '</tr>';
    }).join("") : '<tr><td colspan="' + cs.length + '" class="text-dim" style="text-align:center;padding:18px">No SKU matches these filters.</td></tr>';
    var pi = host.querySelector("#ppPageInfo"); if (pi) pi.textContent = "Page " + (PP.page + 1) + " of " + pages + " · " + int(rows.length) + " SKUs";
  }

  function drawChart(host, d) {
    var cv = host.querySelector("#ppChart"); if (!cv || typeof Chart === "undefined") return;
    if (PP.chart) { try { PP.chart.destroy(); } catch (e) {} }
    var css = getComputedStyle(document.documentElement), v = function (n, f) { return (css.getPropertyValue(n) || "").trim() || f; };
    var accent = v("--accent", "#3b82f6"), dim = v("--text-dim", "#8892a6"), line = v("--line", "rgba(128,128,128,.2)");
    var labels = []; for (var i = 1; i <= 31; i++) labels.push(String(i));
    var mN = new Date(d.anchor).toLocaleDateString("en-GB", { month: "short" }), lN = new Date(d.lmStart).toLocaleDateString("en-GB", { month: "short" });
    PP.chart = new Chart(cv.getContext("2d"), {
      type: "line",
      data: { labels: labels, datasets: [
        { label: mN, data: d.dailyM, borderColor: accent, backgroundColor: accent, borderWidth: 2.5, pointRadius: 2, tension: .3, spanGaps: false },
        { label: lN, data: d.dailyL, borderColor: dim, backgroundColor: dim, borderWidth: 1.5, pointRadius: 0, tension: .3, borderDash: [] }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: dim, boxWidth: 12 } }, tooltip: { callbacks: { title: function (it) { return "Day " + it[0].label; }, label: function (c) { return c.dataset.label + ": " + int(c.parsed.y) + " pcs"; } } } },
        scales: { x: { ticks: { color: dim, maxRotation: 0, autoSkip: true }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: dim }, grid: { color: line } } } }
    });
  }

  function csv() {
    var rows = view(PP.data), q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var raw = function (r, k) { var x = r[k]; return x == null || (typeof x === "number" && !isFinite(x)) ? "" : typeof x === "number" ? Math.round(x * 100) / 100 : x; };
    var lines = [COLS.map(function (c) { return q(c[1]); }).join(",")].concat(rows.map(function (r) { return COLS.map(function (c) { return q(raw(r, c[0])); }).join(","); }));
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "provision-products-" + new Date(PP.data.anchor).toISOString().slice(0, 10) + ".csv"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function wire(host) {
    var re = function () { PP.page = 0; render(host); };
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("ppCat", "change", function (e) { PP.cat = e.target.value; re(); });
    on("ppQ", "input", function (e) { PP.q = e.target.value; PP.page = 0; drawBody(host); });
    on("ppCsv", "click", csv);
    on("ppReload", "click", function () { PP.skus = null; PP.data = null; PP.sig = ""; render(host); });
    on("ppPrev", "click", function () { if (PP.page > 0) { PP.page--; drawBody(host); } });
    on("ppNext", "click", function () { PP.page++; drawBody(host); });
    host.querySelectorAll("tr[data-cat]").forEach(function (tr) { tr.addEventListener("click", function () { PP.cat = PP.cat === tr.dataset.cat ? "all" : tr.dataset.cat; re(); }); });
    host.querySelectorAll("#ppTable th[data-k]").forEach(function (h) {
      h.addEventListener("click", function () { var k = h.dataset.k; if (PP.sort === k) PP.dir = -PP.dir; else { PP.sort = k; PP.dir = (k === "id" || k === "name" || k === "cat" || k === "avail" || k === "top") ? 1 : -1; } PP.page = 0; render(host); });
    });
  }

  // re-draw when the dashboard replaces a source (cached copy first, then the fresh load)
  function watch(host) {
    clearInterval(PP.watch); var refs = srcRefs();
    PP.watch = setInterval(function () {
      if (!host.isConnected || host.classList.contains("hidden")) { clearInterval(PP.watch); return; }
      var now = srcRefs(); if (now.some(function (x, i) { return x !== refs[i]; })) render(host);
    }, 2000);
  }

  window.TaagerProvision = { state: PP, build: function () { PP.data = null; PP.sig = ""; return build(); }, view: function () { return view(PP.data || build()); }, render: render, parseList: parseList };

  function boot() {
    C = window.TowerCore; if (!C || !C.registerView) { setTimeout(boot, 300); return; }
    C.registerView("provisionProducts", { sectionId: "viewProvisionProducts", navId: "navProvisionProducts", label: "Provision Products", sub: "Overall tracker for the SKUs in the Tracking-SKU's tab", open: true, render: render });
    var nav = $("navProvisionProducts"); if (nav && !nav.dataset.pp) { nav.dataset.pp = "1"; nav.addEventListener("click", function () { window.switchView("provisionProducts"); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 150); }); else setTimeout(boot, 150);
})();
