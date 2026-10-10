/* Supply Chain (v1.9.0): Inventory Aging overview, SKU analysis, Action plan.
   All numbers are calculated from the dashboard data (stock, COGS, inbound, confirmed sales). */
(function () {
  "use strict";
  var C = window.TowerCore; if (!C) return;
  function $(id) { return document.getElementById(id); }
  var esc = C.esc;
  function money(n) { try { return fmtMoneyCompact(n); } catch (e) { return "EGP " + Math.round(n || 0).toLocaleString(); } }
  function int(n) { return Math.round(+n || 0).toLocaleString(); }
  function pct(n, d) { return (+n || 0).toFixed(d == null ? 1 : d) + "%"; }
  function dfmt(s) { if (!s) return "—"; var d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); }

  var AGES = ["1. 0-2 Months", "2. 2-4 Months", "3. 4-6 Months", "4. 6-12 Months", "5. Unhealthy"];
  var AGE_LBL = { "1. 0-2 Months": "0–2 months", "2. 2-4 Months": "2–4 months", "3. 4-6 Months": "4–6 months", "4. 6-12 Months": "6–12 months", "5. Unhealthy": "Unhealthy (12m+)" };
  var AGE_COL = ["#34d399", "#7dd3a8", "#fbbf24", "#fb923c", "#fb7185"];
  var CATS = ["electronics", "home", "consumables", "leisure", "fashion"];
  var CATL = { electronics: "Electronics", home: "Home", consumables: "Consumables", leisure: "Leisure", fashion: "Fashion", "taager gomla": "Taager Gomla", general: "General" };
  var TAGS = ["5- Overstocked", "4- Fairly Stocked", "3- Understocked", "2- At Risk", "1- OSS"];
  var FMS = ["1. Fast-Moving", "2. Medium-Moving", "3. Slow-Moving", "4. Obsolete"];
  var TAG_TONE = { "5- Overstocked": "bad", "4- Fairly Stocked": "ok", "3- Understocked": "warn", "2- At Risk": "warn", "1- OSS": "na" };
  var ACTIONS = ["Liquidation (On-Cost)", "Merchant Focus", "Telesales - Upselling - Cross Selling", "Supplier Returns"];
  // Proposed action = Lookups sheet: ABC_FMS_Quarter(of last purchase date) -> [action, channel] (first match)
  var ACT_LOOKUP = {"A_1. Fast-Moving_Q1": ["Merchant Focus", "Online"], "A_1. Fast-Moving_Q2": ["Merchant Focus", "Online"], "A_1. Fast-Moving_Q3": ["Merchant Focus", "Online"], "A_1. Fast-Moving_Before 2026": ["Merchant Focus", "Online"], "A_2. Medium-Moving_Q1": ["Merchant Focus", "Online"], "A_2. Medium-Moving_Q2": ["Merchant Focus", "Online"], "A_2. Medium-Moving_Q3": ["Merchant Focus", "Online"], "A_2. Medium-Moving_Before 2026": ["Merchant Focus", "Online"], "A_3. Slow-Moving_Q1": ["Supplier Returns", "Supply Team"], "A_3. Slow-Moving_Q2": ["Merchant Focus", "Online"], "A_3. Slow-Moving_Q3": ["Telesales - Upselling - Cross Selling", "Online"], "A_3. Slow-Moving_Before 2026": ["Liquidation (On-Cost)", "Offline - B2B"], "A_4. Obsolete_Q1": ["Supplier Returns", "Supply Team"], "A_4. Obsolete_Q2": ["Merchant Focus", "Online"], "A_4. Obsolete_Q3": ["Telesales - Upselling - Cross Selling", "Online"], "A_4. Obsolete_Before 2026": ["Liquidation (On-Cost)", "Offline - B2B"], "B_1. Fast-Moving_Q1": ["Merchant Focus", "Online"], "B_1. Fast-Moving_Q2": ["Merchant Focus", "Online"], "B_1. Fast-Moving_Q3": ["Merchant Focus", "Online"], "B_1. Fast-Moving_Before 2026": ["Merchant Focus", "Online"], "B_2. Medium-Moving_Q1": ["Merchant Focus", "Online"], "B_2. Medium-Moving_Q2": ["Merchant Focus", "Online"], "B_2. Medium-Moving_Q3": ["Merchant Focus", "Online"], "B_2. Medium-Moving_Before 2026": ["Merchant Focus", "Online"], "B_3. Slow-Moving_Q1": ["Supplier Returns", "Supply Team"], "B_3. Slow-Moving_Q2": ["Merchant Focus", "Online"], "B_3. Slow-Moving_Q3": ["Telesales - Upselling - Cross Selling", "Online"], "B_3. Slow-Moving_Before 2026": ["Liquidation (On-Cost)", "Offline - B2B"], "B_4. Obsolete_Q1": ["Supplier Returns", "Supply Team"], "B_4. Obsolete_Q2": ["Merchant Focus", "Online"], "B_4. Obsolete_Q3": ["Telesales - Upselling - Cross Selling", "Online"], "B_4. Obsolete_Before 2026": ["Liquidation (On-Cost)", "Offline - B2B"], "C_1. Fast-Moving_Q1": ["Merchant Focus", "Online"], "C_1. Fast-Moving_Q2": ["Merchant Focus", "Online"], "C_1. Fast-Moving_Q3": ["Merchant Focus", "Online"], "C_1. Fast-Moving_Before 2026": ["Merchant Focus", "Online"], "C_2. Medium-Moving_Q1": ["Merchant Focus", "Online"], "C_2. Medium-Moving_Q2": ["Merchant Focus", "Online"], "C_2. Medium-Moving_Q3": ["Merchant Focus", "Online"], "C_2. Medium-Moving_Before 2026": ["Merchant Focus", "Online"], "C_3. Slow-Moving_Q1": ["Supplier Returns", "Supply Team"], "C_3. Slow-Moving_Q2": ["Merchant Focus", "Online"], "C_3. Slow-Moving_Q3": ["Telesales - Upselling - Cross Selling", "Online"], "C_3. Slow-Moving_Before 2026": ["Liquidation (On-Cost)", "Offline - B2B"], "C_4. Obsolete_Q1": ["Supplier Returns", "Supply Team"], "C_4. Obsolete_Q2": ["Merchant Focus", "Online"], "C_4. Obsolete_Q3": ["Telesales - Upselling - Cross Selling", "Online"], "C_4. Obsolete_Before 2026": ["Liquidation (On-Cost)", "Offline - B2B"]};
  var ACT_NOTE = { "Liquidation (On-Cost)": "Offline - B2B", "Merchant Focus": "Online", "Telesales - Upselling - Cross Selling": "Online", "Supplier Returns": "Supply Team" };

  /* ---------------------------------------------------------------- data (computed from the dashboard's own data) */
  var SC = { rows: [], asOf: "", sig: "", cat: "all", sk: { q: "", cat: "", aging: "", tag: "", seg: "", action: "", instock: true, key: "inv", dir: "desc", page: 0 }, act: ACTIONS[0], empty: true, segMode: "segA" };
  var PAGE = 25, DAY = 86400000;
  function sigNow() { try { return [state.allParsedRows.length, (state.inboundRows || []).length, Object.keys(state.inventoryMap || {}).length, state.cogsMap && state.cogsMap.size, (state.debundleMap || []).length, (state.supplyRepackRows || []).length, (state.metabaseSellthroughNeeded || []).length, (state.metabaseBeginningInventory || []).length].join("|"); } catch (e) { return ""; } }
  function ageIdx(days) { return days == null ? 4 : days <= 60 ? 0 : days <= 120 ? 1 : days <= 180 ? 2 : days <= 364 ? 3 : 4; } // same bands as the Inventory Aging sheet; no purchase date = Unhealthy
  var RET_FACTOR = 0.75; // Returns = MAX(0, Confirmed − Delivered) × 75% (conservative haircut, same as the Purchase Plan sheet)
  var SEGS = ["Mega", "Super", "Winning", "Potential Winning", "Normal"], SEG_MIN = [1200000, 400000, 200000, 100000, 0];
  function segOf(g) { for (var i = 0; i < 4; i++) if (g >= SEG_MIN[i]) return SEGS[i]; return SEGS[4]; }
  function build() {
    var sg = sigNow(); if (sg && sg === SC.sig) return; SC.sig = sg;
    var rows = [];
    try {
      var main = state.allParsedRows || [], invMap = state.inventoryMap || {};
      if (!main.length || !Object.keys(invMap).length || typeof buildDebundledStockDohIndex !== "function") { SC.rows = []; SC.empty = true; return; }
      var idx = buildDebundledStockDohIndex(main), dbm = buildDebundleProductMap(state.debundleMap, state.cogsMap), pm = dbm.productMap, singles = dbm.singlesList;
      var mapsFor = function (sku) { var m = pm.get(sku); return (m && m.length) ? m : [{ singleId: sku, quantity: 1 }]; };
      var t0 = new Date(); t0.setHours(0, 0, 0, 0); var today = t0.getTime();
      var maxTs = 0; main.forEach(function (r) { if (r.timestamp > maxTs) maxTs = r.timestamp; });
      var ref = new Date(maxTs || today), cy = ref.getFullYear(), cmo = ref.getMonth(), elapsed = ref.getDate() || 1, mdays = new Date(cy, cmo + 1, 0).getDate();
      var py = cmo === 0 ? cy - 1 : cy, pmo = cmo === 0 ? 11 : cmo - 1;
      var c3 = {}, c15 = {}, c30 = {}, gA = {}, gL = {}, mtd = {};
      main.forEach(function (r) {
        if (!r.sku) return;
        var d = new Date(r.timestamp), dd = new Date(r.timestamp); dd.setHours(0, 0, 0, 0); var age = (today - dd.getTime()) / DAY;
        var inCur = d.getFullYear() === cy && d.getMonth() === cmo, inPrev = d.getFullYear() === py && d.getMonth() === pmo;
        var needQ = r.confirmedPieces && ((age >= 1 && age <= 30) || inCur), needG = (inCur || inPrev) && r.confirmedGmv;
        if (!needQ && !needG) return;
        mapsFor(r.sku).forEach(function (mp) {
          var id = mp.singleId;
          if (needQ) { var q = r.confirmedPieces * (mp.quantity || 1); if (inCur) mtd[id] = (mtd[id] || 0) + q; if (age < 1 || age > 30) { /* only MTD */ } else { if (age <= 3) c3[id] = (c3[id] || 0) + q; if (age <= 15) c15[id] = (c15[id] || 0) + q; c30[id] = (c30[id] || 0) + q; } }
          if (needG) { var g = r.confirmedGmv * (mp.cogsWeight != null ? mp.cogsWeight : 1); if (inCur) gA[id] = (gA[id] || 0) + g; else gL[id] = (gL[id] || 0) + g; }
        });
      });
      var beg = {}, inM = {};
      (state.metabaseBeginningInventory || []).forEach(function (r) { var d = new Date(r.MONTH); if (isNaN(d.getTime()) || d.getUTCFullYear() !== cy || d.getUTCMonth() !== cmo) return; beg[r.PRODUCT_ID] = (beg[r.PRODUCT_ID] || 0) + (+r.QTY || 0); });
      (state.inboundRows || []).forEach(function (r) { if (!r.sku || !r.rcvTs) return; var d = new Date(r.rcvTs); if (d.getFullYear() === cy && d.getMonth() === cmo) inM[r.sku] = (inM[r.sku] || 0) + (+r.rcvQty || 0); });
      var last = {};
      (state.inboundRows || []).forEach(function (r) { if (r.sku && r.rcvTs && (!last[r.sku] || r.rcvTs > last[r.sku])) last[r.sku] = r.rcvTs; });
      // expected returns — same logic as Purchase Plan (pending confirmed × (1 − DR%))
      var ov = null; try { ov = computePurchasePlanOverallSingleStats(); } catch (e) { ov = null; }
      var ids = {}; Object.keys(invMap).forEach(function (k) { ids[k] = 1; }); idx.stockByProductId.forEach(function (v, k) { ids[k] = 1; });
      Object.keys(ids).forEach(function (id) {
        var m = pm.get(id); if ((m && m.length > 1) || idx.isBundleByProductId.get(id) || (singles && singles.size && !singles.has(id))) return; // Single SKUs only
        var iv = invMap[id] || {}, pr = (state.productsMap || {})[id] || {};
        var stock = idx.stockByProductId.has(id) ? (+idx.stockByProductId.get(id) || 0) : (+iv.stock || 0), st = idx.singleOverallStats(id), wac = (state.cogsMap && state.cogsMap.get) ? (+state.cogsMap.get(id) || 0) : 0;
        var newest = last[id] || 0, days = newest ? Math.max(0, Math.floor((today - newest) / DAY)) : null, ai = ageIdx(days), q = [0, 0, 0, 0, 0, 0];
        q[ai] = stock; var aging = AGES[ai];
        var a15 = (c15[id] || 0) / 15, a3 = (c3[id] || 0) / 3, doh = a3 === 0 ? stock : stock / a3;
        var tag = doh > 18 ? "5- Overstocked" : doh >= 10 ? "4- Fairly Stocked" : doh === 0 ? "1- OSS" : doh < 5 ? "2- At Risk" : "3- Understocked";
        var supply = (beg[id] || 0) + (inM[id] || 0), str = supply > 0 ? (mtd[id] || 0) / supply : null;
        var fms = str == null ? "0. No Stock" : str >= 0.7 ? FMS[0] : str >= 0.4 ? FMS[1] : str >= 0.1 ? FMS[2] : FMS[3];
        var o = ov && ov.get(id), drPct = o && o.drConfirmed ? o.drDelivered / o.drConfirmed * 100 : 0, exRet = o ? Math.round(Math.max(0, o.confirmed - o.delivered) * RET_FACTOR) : 0;
        var gA_ = gA[id] || 0, gL_ = gL[id] || 0, gP = elapsed >= 5 ? gA_ / elapsed * mdays : (gA_ / elapsed * mdays * elapsed + gL_ * (5 - elapsed)) / 5;
        var action = "", channel = "";
        var row = { id: id, name: iv.skuName || pr.name || id, cat: String(iv.category || pr.category || "").toLowerCase() || "general", lpd: newest ? new Date(newest).toISOString().slice(0, 10) : "", days: days, aging: aging, avg3: a3, avg15: a15, c15: c15[id] || 0, c30: c30[id] || 0, stock: stock, doh: doh, wac: wac, inv: stock * wac, tag: tag, fms: fms, abc: "", quarter: newest ? (new Date(newest).getFullYear() < 2026 ? "Before 2026" : new Date(newest).getMonth() <= 2 ? "Q1" : new Date(newest).getMonth() <= 5 ? "Q2" : "Q3") : "", mtd: mtd[id] || 0, str: str, action: action, channel: channel, exRet: exRet, retV: exRet * wac, drPct: drPct, gA: gA_, gL: gL_, gP: gP, segA: segOf(gA_), segL: segOf(gL_), segP: segOf(gP) };
        for (var z = 0; z < 6; z++) { row["q" + z] = q[z]; row["v" + z] = q[z] * wac; }
        rows.push(row);
      });
      // ---- Supply conversion (Targets page) — same waterfall as the Inventory Aging workbook (Working Sheet X/AB/AF/BR):
      // MTD confirmed is consumed from Beginning inventory first, then Purchases, then Returns, then Repack. Values = qty × WAC.
      var rep = {}; (state.supplyRepackRows || []).forEach(function (r) { if (r.status !== "APPLIED" || !r.ts) return; var d = new Date(r.ts); if (d.getFullYear() === cy && d.getMonth() === cmo) rep[r.sku] = (rep[r.sku] || 0) + (+r.qty || 0); });
      var rto = {}, mk = ref.toLocaleString("en-US", { month: "long", year: "numeric" });
      try { var stx = getSellthroughIndices(); stx.needBySkuMonth.forEach(function (v, k) { var i = k.lastIndexOf("|"); if (k.slice(i + 1) === mk && v.rto) rto[k.slice(0, i)] = (rto[k.slice(0, i)] || 0) + v.rto; }); } catch (e2) {}
      var cids = {}; [beg, inM, rto, rep, mtd].forEach(function (o) { Object.keys(o).forEach(function (k) { cids[k] = 1; }); });
      var conv = { all: null }, mkAgg = function () { return { beg: [0, 0], pur: [0, 0], ret: [0, 0], rep: [0, 0] }; }; // [actual, converted]
      Object.keys(cids).forEach(function (id) {
        var m = pm.get(id); if ((m && m.length > 1) || idx.isBundleByProductId.get(id) || (singles && singles.size && !singles.has(id))) return;
        var w = (state.cogsMap && state.cogsMap.get) ? (+state.cogsMap.get(id) || 0) : 0; if (!w) return;
        var P = mtd[id] || 0, V = beg[id] || 0, Z = inM[id] || 0, R = rto[id] || 0, B = rep[id] || 0;
        var X = P === 0 ? 0 : Math.min(V, P), AB = Math.min(P - X, Z), AF = Math.min(P - X - AB, R), BR = Math.max(0, Math.min(P - X - AB - R, B));
        var iv = invMap[id] || {}, pr = (state.productsMap || {})[id] || {}, cat = String(iv.category || pr.category || "").toLowerCase() || "general";
        [["all"], [cat]].forEach(function (kk) { var a = conv[kk[0]] = conv[kk[0]] || mkAgg(); a.beg[0] += V * w; a.beg[1] += X * w; a.pur[0] += Z * w; a.pur[1] += AB * w; a.ret[0] += R * w; a.ret[1] += AF * w; a.rep[0] += B * w; a.rep[1] += BR * w; });
      });
      SC.conv = conv; SC.convMonth = ref.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      var tot = 0, cum = 0, sorted = rows.slice().sort(function (x, y) { return y.inv - x.inv; });
      rows.forEach(function (r) { tot += r.inv; });
      sorted.forEach(function (r) { cum += r.inv; r.abc = r.stock <= 0 ? "-" : cum / (tot || 1) <= 0.8 ? "A" : cum / (tot || 1) <= 0.95 ? "B" : "C"; var L = ACT_LOOKUP[r.abc + "_" + r.fms + "_" + r.quarter]; if (L) { r.action = L[0]; r.channel = L[1]; } });
      SC.rows = rows; SC.empty = !rows.length; SC.asOf = new Date().toISOString().slice(0, 10); SC.monthLbl = ref.toLocaleDateString("en-GB", { month: "short", year: "numeric" }); SC.elapsed = elapsed; SC.mdays = mdays;
    } catch (e) { SC.rows = []; SC.empty = true; SC.err = String(e && e.message || e); }
  }

  /* ---------------------------------------------------------------- Targets page: Supply conversion */
  var PLAN_DEF = { beg: 27000000, pur: 12500000, ret: 16096387, rep: 9442000 };
  function planGet() { var p = {}; try { p = JSON.parse(localStorage.getItem("twScPlanned") || "{}"); } catch (e) {} var o = {}; Object.keys(PLAN_DEF).forEach(function (k) { o[k] = +p[k] > 0 ? +p[k] : PLAN_DEF[k]; }); return o; }
  function planSet(k, v) { var p = {}; try { p = JSON.parse(localStorage.getItem("twScPlanned") || "{}"); } catch (e) {} p[k] = v; try { localStorage.setItem("twScPlanned", JSON.stringify(p)); } catch (e) {} }
  function convPanel() {
    var d = SC.conv && SC.conv[SC.cat === "all" ? "all" : SC.cat];
    var pl = planGet(), labs = [["beg", "Beg Inv."], ["pur", "Purchases"], ["ret", "Returns"], ["rep", "Repack"]];
    var body = labs.map(function (l) {
      var k = l[0], a = d ? d[k][0] : 0, c = d ? d[k][1] : 0, p = pl[k], pc = p > 0 ? c / p * 100 : 0;
      return '<tr><td>' + l[1] + '</td><td class="num">' + int(a) + '</td><td class="num"><input class="sc-plan" data-plan="' + k + '" value="' + int(p) + '" inputmode="numeric" title="Planned — click to edit (saved in this browser)"></td><td class="num">' + int(c) + '</td><td class="num" style="min-width:150px"><b>' + pc.toFixed(2) + '%</b>' + bar(pc, "ok", "sm") + '</td></tr>';
    }).join("");
    return '<div class="panel table-panel hover-glow" style="margin-top:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Supply conversion — ' + esc(SC.convMonth || "") + '</h2><p>Beg Inv · Purchases · Returns · Repack vs plan</p></div></div><div class="table-responsive"><table class="data-table"><thead><tr><th>Metric</th><th class="num" title="Quantity × WAC available from this source this month.">Actual</th><th class="num" title="Planned value (editable).">Planned</th><th class="num" title="Confirmed COGS fulfilled from this source.">Converted</th><th class="num">Conversion %</th></tr></thead><tbody>' + body + '</tbody></table></div><div class="sc-note" style="margin:12px 16px">Values are COGS (quantity × WAC), single SKUs only. Converted = MTD confirmed quantity consumed from each source in order: Beg Inv → Purchases → Returns → Repack. Conversion % = Converted ÷ Planned.</div></div>';
  }
  function boot() { build(); }

  /* ---------------------------------------------------------------- helpers */
  function scoped() { return SC.cat === "all" ? SC.rows : SC.rows.filter(function (r) { return r.cat === SC.cat; }); }
  function sum(rows, k) { var s = 0; rows.forEach(function (r) { s += +r[k] || 0; }); return s; }
  function groupBy(rows, k) { var m = {}; rows.forEach(function (r) { (m[r[k]] = m[r[k]] || []).push(r); }); return m; }
  function bar(p, tone, h) { return '<div class="cx-bar ' + (h || "sm") + ' cx-' + tone + '"><b style="width:' + Math.max(0, Math.min(100, p)) + '%"></b></div>'; }
  function chip(t, tone) { return '<i class="cx-chip cx-' + tone + '">' + esc(t) + '</i>'; }
  function segChip(g) { return chip(g, g === "Normal" ? "na" : "ok"); }
  function ageChip(a) { var i = AGES.indexOf(a); var tone = i < 0 ? "na" : i < 2 ? "ok" : i === 2 ? "warn" : "bad"; return chip(AGE_LBL[a] || a || "—", tone); }
  function dohTxt(r) { return r.stock > 0 ? (r.doh >= 999 ? "999+" : int(r.doh)) : "—"; }
  function dohOf(rows) { var st = sum(rows, "stock"), av = sum(rows, "avg3"); return av > 0 ? st / av : 0; }
  function srcChip() { return ""; }
  function catPills() {
    return '<div class="cx-pills">' + ["all"].concat(CATS).map(function (c) { return '<button type="button" class="cx-pill' + (SC.cat === c ? " on" : "") + '" data-sc-cat="' + c + '">' + (c === "all" ? "All categories" : CATL[c]) + '</button>'; }).join("") + '</div>';
  }
  function dist(rows, key, order, valKey, labelFn, colorFn) {
    var g = groupBy(rows, key), tot = sum(rows, valKey) || 1;
    return order.map(function (k, i) {
      var rs = g[k] || [], v = sum(rs, valKey), p = v / tot * 100;
      return '<div class="sc-drow"><span class="sc-dl">' + esc(labelFn ? labelFn(k) : k) + '<small>' + int(rs.length) + ' SKUs</small></span><div class="cx-bar sm" style="--c:' + colorFn(k, i) + '"><b style="width:' + p + '%"></b></div><em>' + money(v) + '<small>' + pct(p, 0) + '</small></em></div>';
    }).join("");
  }

  /* ---------------------------------------------------------------- views */
  function mkSection(id) { var main = document.querySelector("main.content"); if (main && !$(id)) { var d = document.createElement("div"); d.id = id; d.className = "view-section hidden"; main.appendChild(d); } }
  function bsum(rows, i) { return sum(rows, "v" + i); }
  function distV(items, tot) {
    return items.map(function (it) { var p = tot ? it.v / tot * 100 : 0; return '<div class="sc-drow"><span class="sc-dl">' + esc(it.l) + '<small>' + int(it.n) + ' SKUs</small></span><div class="cx-bar sm" style="--c:' + it.c + '"><b style="width:' + p + '%"></b></div><em>' + money(it.v) + '<small>' + pct(p, 0) + '</small></em></div>'; }).join("");
  }
  function renderAging(host) {
    var rows = scoped(), inv = sum(rows, "inv"), stocked = rows.filter(function (r) { return r.stock > 0; });
    var unh = bsum(rows, 4), doh = dohOf(stocked), dead = stocked.filter(function (r) { return r.fms === FMS[3]; }), retV = sum(rows, "retV");
    var tiles = [
      ["Inventory value", money(inv), int(sum(rows, "stock")) + " units on hand", ""],
      ["SKUs in stock", int(stocked.length), "of " + int(rows.length) + " SKUs in inventory", ""],
      ["Unhealthy stock", pct(inv ? unh / inv * 100 : 0, 0), money(unh) + " at 12m+ aging", (inv && unh / inv > 0.3) ? "bad" : "warn"],
      ["Days on hand", int(doh), "stock ÷ 3-day avg demand", ""],
      ["Obsolete stock", money(sum(dead, "inv")), int(dead.length) + " SKUs · sold < 10% of supply MTD", dead.length ? "bad" : "ok"],
      ["Expected returns", money(retV), int(sum(rows, "exRet")) + " pcs · (Confirmed − Delivered) × 75%", ""]
    ];
    var html = '<div class="cx-bar-top"><div>' + catPills() + '</div>' + srcChip() + '</div>' +
      '<div class="cx-hero2">' + tiles.map(function (t) { return '<div class="cx-tile ' + (t[3] ? "cx-" + t[3] : "") + '"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>';
    var cats = SC.cat === "all" ? CATS : [SC.cat];
    var stack = cats.map(function (c) {
      var rs = SC.rows.filter(function (r) { return r.cat === c; }), tv = sum(rs, "inv") || 1;
      return '<div class="sc-stk"><span class="sc-stk-l">' + CATL[c] + '<small>' + money(sum(rs, "inv")) + '</small></span><div class="sc-stk-b">' + AGES.map(function (a, i) { var v = bsum(rs, i); return v > 0 ? '<i style="width:' + (v / tv * 100) + '%;background:' + AGE_COL[i] + '" title="' + AGE_LBL[a] + ' · ' + money(v) + '"></i>' : ""; }).join("") + '</div></div>';
    }).join("");
    var ageItems = AGES.map(function (a, i) { return { l: AGE_LBL[a], c: AGE_COL[i], v: bsum(rows, i), n: rows.filter(function (r) { return r["q" + i] > 0; }).length }; });
    html += '<div class="cx-grid2"><div class="panel cx-card"><div class="cx-card-h">Inventory value by aging <small>per category</small></div>' + stack +
      '<div class="sc-legend">' + AGES.map(function (a, i) { return '<span><i style="background:' + AGE_COL[i] + '"></i>' + AGE_LBL[a] + '</span>'; }).join("") + '</div></div>' +
      '<div class="panel cx-card"><div class="cx-card-h">Aging buckets <small>value · share</small></div>' + distV(ageItems, inv) + '</div></div>';
    var segTone = ["#0ea58a", "#7c5cf0", "#3b82f6", "#fbbf24", "#9aa7bd"], sm = SC.segMode, smL = { segA: "Actual (MTD)", segL: "Last month", segP: "Projected" };
    var segItems = SEGS.map(function (g, i) { var rs = stocked.filter(function (r) { return r[sm] === g; }); return { l: g, c: segTone[i], v: sum(rs, "inv"), n: rs.length }; });
    html += '<div class="cx-grid2"><div class="panel cx-card"><div class="cx-card-h">Stock health <small>inventory tag (DOH)</small></div>' + dist(stocked, "tag", TAGS.slice(0, 4), "inv", null, function (k) { return ({ ok: "#34d399", warn: "#fbbf24", bad: "#fb7185", na: "#74839a" })[TAG_TONE[k]]; }) + '</div>' +
      '<div class="panel cx-card"><div class="cx-card-h">Product segment <small>confirmed GMV · inventory value</small></div><div class="cx-pills" style="margin-bottom:10px">' + ["segA", "segL", "segP"].map(function (k) { return '<button type="button" class="cx-pill' + (sm === k ? " on" : "") + '" data-sc-seg="' + k + '">' + smL[k] + '</button>'; }).join("") + '</div>' + distV(segItems, sum(stocked, "inv")) +
      '<div class="sc-note" style="margin-bottom:0">Monthly confirmed GMV: Mega ≥ 1.2M · Super ≥ 400K · Winning ≥ 200K · Potential Winning ≥ 100K. Actual = ' + esc(SC.monthLbl || "") + ' so far (day ' + SC.elapsed + '/' + SC.mdays + '); Projected = run-rate to month end' + (SC.elapsed < 5 ? ' (blended with last month early in the month)' : '') + '.</div></div></div>';
    var top = rows.filter(function (r) { return r.stock > 0 && (r.v3 + r.v4) > 0 && r.lpd && new Date(r.lpd).getFullYear() === new Date().getFullYear(); }).sort(function (a, b) { return (b.v3 + b.v4) - (a.v3 + a.v4); }).slice(0, 8);
    html += convPanel().replace('margin-top:14px', 'margin:0 0 14px');
    html += '<div class="panel cx-card"><div class="cx-card-h">Biggest capital stuck in aged stock <small>6m+ aging · bought this year · click for details</small></div>' + top.map(function (r) {
      return '<div class="cx-lrow" data-sc-sku="' + esc(r.id) + '"><div><b>' + esc(r.name) + '</b><small>' + esc(r.id) + ' · ' + esc(CATL[r.cat] || r.cat) + ' · last inbound ' + dfmt(r.lpd) + '</small></div><div class="cx-lr"><b>' + money(r.v3 + r.v4) + '</b><small>' + int(r.stock) + ' pcs · DOH ' + dohTxt(r) + '</small>' + ageChip(r.aging) + '</div></div>';
    }).join("") + '</div>';
    host.innerHTML = html;
  }

  var COLS = [["id", "SKU ID", ""], ["name", "SKU name", ""], ["cat", "Category", ""], ["lpd", "Last inbound", ""], ["aging", "Aging", ""], ["avg3", "Avg 3D", "num"], ["avg15", "Avg 15D", "num"], ["stock", "Stock", "num"], ["doh", "DOH", "num"], ["wac", "WAC", "num"], ["inv", "Inv. value", "num"], ["exRet", "Exp. returns", "num"], ["tag", "Stock tag", ""], ["segA", "Segment", ""], ["segL", "Last month", ""], ["segP", "Projected", ""], ["fms", "Movement", ""], ["abc", "ABC", ""], ["action", "Proposed action", ""]];
  function uniq(k) { var s = {}; SC.rows.forEach(function (r) { if (r[k]) s[r[k]] = 1; }); return Object.keys(s).sort(); }
  function sel(id, label, opts, v) { return '<select data-sk="' + id + '"><option value="">' + label + '</option>' + opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === v ? " selected" : "") + '>' + esc(CATL[o] || o) + '</option>'; }).join("") + '</select>'; }
  function skuFiltered() {
    var f = SC.sk, q = f.q.toLowerCase();
    var rows = SC.rows.filter(function (r) {
      if (f.instock && !(r.stock > 0)) return false;
      if (f.cat && r.cat !== f.cat) return false; if (f.aging && r.aging !== f.aging) return false; if (f.tag && r.tag !== f.tag) return false; if (f.seg && r.segA !== f.seg) return false; if (f.action && r.action !== f.action) return false;
      if (q && (String(r.id).toLowerCase().indexOf(q) < 0 && String(r.name).toLowerCase().indexOf(q) < 0)) return false; return true;
    });
    var k = f.key, d = f.dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) { var x = a[k], y = b[k]; if (typeof x === "string" || typeof y === "string") return String(x || "").localeCompare(String(y || "")) * d; return ((x || 0) - (y || 0)) * d; });
    return rows;
  }
  function renderSkus(host) {
    var f = SC.sk;
    if (!$("scSkuTable")) {
      host.innerHTML = '<div class="cx-bar-top"><div class="sc-hdr">Every SKU with stock, aging, health tag and the proposed action</div>' + srcChip() + '</div><div class="sc-stats" id="scSkuStats"></div>' +
        '<div class="panel table-panel"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>SKU analysis</h2><p>Stock, aging, returns and segment per SKU</p></div><div class="table-controls sc-filters" id="scSkuFilters"></div></div>' +
        '<div class="table-responsive"><table class="data-table" id="scSkuTable"><thead><tr>' + COLS.map(function (c) { return '<th class="' + c[2] + '" data-k="' + c[0] + '" style="cursor:pointer">' + c[1] + '</th>'; }).join("") + '</tr></thead><tbody id="scSkuBody"></tbody></table></div>' +
        '<div class="table-footer"><span id="scSkuCount"></span><div class="pager"><button class="btn btn-outline small" data-sc="prev">Prev</button><span id="scSkuPage"></span><button class="btn btn-outline small" data-sc="next">Next</button></div></div></div>';
    } else { var sc = host.querySelector(".sc-src"); }
    $("scSkuFilters").innerHTML = '<input type="search" id="scSkuQ" placeholder="Search SKU ID or name…" value="' + esc(f.q) + '" autocomplete="off" />' + sel("cat", "All categories", CATS, f.cat) + sel("aging", "All aging", AGES, f.aging) + sel("tag", "All stock tags", TAGS, f.tag) + sel("seg", "All segments", SEGS, f.seg) + sel("action", "All actions", ACTIONS, f.action) +
      '<label class="sc-chk"><input type="checkbox" data-sk="instock"' + (f.instock ? " checked" : "") + '> In stock only</label>';
    var q = $("scSkuQ"); if (q && document.activeElement !== q && f.q) { /* keep */ }
    drawSkuBody();
  }
  function drawSkuBody() {
    var rows = skuFiltered(), f = SC.sk, tp = Math.max(1, Math.ceil(rows.length / PAGE)); if (f.page >= tp) f.page = tp - 1;
    var pg = rows.slice(f.page * PAGE, f.page * PAGE + PAGE);
    $("scSkuBody").innerHTML = pg.length ? pg.map(function (r) {
      return '<tr class="cx-row" data-sc-sku="' + esc(r.id) + '"><td class="font-mono text-dim">' + esc(r.id) + '</td><td class="truncate-cell" title="' + esc(r.name) + '">' + esc(r.name) + '</td><td class="text-dim">' + esc(CATL[r.cat] || r.cat) + '</td><td class="text-dim">' + dfmt(r.lpd) + '</td><td>' + ageChip(r.aging) + '</td><td class="num">' + (+r.avg3).toFixed(1) + '</td><td class="num">' + (+r.avg15).toFixed(1) + '</td><td class="num font-bold">' + int(r.stock) + '</td><td class="num">' + dohTxt(r) + '</td><td class="num text-dim">' + money(r.wac) + '</td><td class="num font-bold">' + money(r.inv) + '</td><td class="num ' + (r.exRet > 0 ? '' : 'text-dim') + '">' + int(r.exRet) + '</td><td>' + chip(r.tag.replace(/^\d-\s*/, "") || "—", TAG_TONE[r.tag] || "na") + '</td><td>' + segChip(r.segA) + '</td><td class="text-dim">' + esc(r.segL) + '</td><td class="text-dim">' + esc(r.segP) + '</td><td class="text-dim">' + esc((r.fms || "").replace(/^\d\.\s*/, "")) + '</td><td class="text-dim">' + esc(r.abc) + '</td><td class="text-dim truncate-cell">' + esc(r.action) + '</td></tr>';
    }).join("") : '<tr><td colspan="' + COLS.length + '" class="text-dim center">No SKUs match these filters.</td></tr>';
    $("scSkuCount").textContent = int(rows.length) + " SKUs"; $("scSkuPage").textContent = "Page " + (f.page + 1) + " of " + tp;
    var st = $("scSkuStats"); if (st) st.innerHTML = [["SKUs", int(rows.length)], ["Units", int(sum(rows, "stock"))], ["Inventory value", money(sum(rows, "inv"))], ["Avg DOH", int(dohOf(rows.filter(function (r) { return r.stock > 0; })))]].map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b></div>'; }).join("");
  }

  function renderActions(host) {
    var stocked = SC.rows.filter(function (r) { return r.stock > 0; }), cur = SC.act;
    var cards = ACTIONS.map(function (a) {
      var rs = stocked.filter(function (r) { return r.action === a; }), ch = (ACT_LOOKUP[Object.keys(ACT_LOOKUP).filter(function (k) { return ACT_LOOKUP[k][0] === a; })[0]] || [])[1] || "";
      return '<button type="button" class="sc-act' + (a === cur ? " on" : "") + '" data-sc-act="' + esc(a) + '"><b>' + esc(a) + '</b><span>' + esc(ACT_NOTE[a]) + '</span><div class="sc-act-n">' + money(sum(rs, "inv")) + '</div><small>' + int(rs.length) + ' SKUs · ' + int(sum(rs, "stock")) + ' pcs' + (ch ? " · " + esc(ch) : "") + '</small></button>';
    }).join("");
    var none = [];
    var rs = stocked.filter(function (r) { return r.action === cur; }).sort(function (a, b) { return b.inv - a.inv; });
    var tot = sum(rs, "inv");
    host.innerHTML = '<div class="cx-bar-top"><div class="sc-hdr">Proposed action per SKU — ABC × FMS × purchase period (Lookups sheet)</div>' + srcChip() + '</div><div class="sc-acts">' + cards + '</div>' +
      (none.length ? '<div class="sc-note">' + int(none.length) + ' aged SKUs (' + money(sum(none, "inv")) + ') have no proposed action yet.</div>' : "") +
      '<div class="panel table-panel"><div class="panel-head-modern"><div class="panel-title-wrapper border-orange"><h2>' + esc(cur) + '</h2><p>' + esc(ACT_NOTE[cur]) + ' · ' + int(rs.length) + ' SKUs · ' + money(tot) + '</p></div></div><div class="table-responsive"><table class="data-table" id="scActTable"><thead><tr><th>SKU ID</th><th>SKU name</th><th>Category</th><th>Aging</th><th class="num">Stock</th><th class="num">Avg 3D</th><th class="num">DOH</th><th class="num">WAC</th><th class="num">Inv. value</th><th class="num">Share</th><th>Movement</th><th>ABC</th></tr></thead><tbody>' +
      (rs.slice(0, 100).map(function (r) { return '<tr class="cx-row" data-sc-sku="' + esc(r.id) + '"><td class="font-mono text-dim">' + esc(r.id) + '</td><td class="truncate-cell" title="' + esc(r.name) + '">' + esc(r.name) + '</td><td class="text-dim">' + esc(CATL[r.cat] || r.cat) + '</td><td>' + ageChip(r.aging) + '</td><td class="num font-bold">' + int(r.stock) + '</td><td class="num">' + (+r.avg3).toFixed(1) + '</td><td class="num">' + dohTxt(r) + '</td><td class="num text-dim">' + money(r.wac) + '</td><td class="num font-bold">' + money(r.inv) + '</td><td class="num">' + pct(tot ? r.inv / tot * 100 : 0, 1) + '</td><td class="text-dim">' + esc((r.fms || "").replace(/^\d\.\s*/, "")) + '</td><td class="text-dim">' + esc(r.abc) + '</td></tr>'; }).join("") || '<tr><td colspan="12" class="text-dim center">No SKUs for this action.</td></tr>') + '</tbody></table></div>' + (rs.length > 100 ? '<div class="table-footer"><span>Showing top 100 of ' + int(rs.length) + ' by inventory value</span></div>' : "") + '</div>';
  }

  /* ---------------------------------------------------------------- drawer + connect modal */
  function kv(k, v) { return '<div class="tw-dstat"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function openSku(id) {
    var r = SC.rows.filter(function (x) { return String(x.id) === String(id); })[0]; if (!r) return;
    var old = $("scDrawer"); if (old) old.remove();
    var D = document.createElement("div"); D.id = "scDrawer"; D.className = "tw-drawer";
    var sec = function (t, items) { return '<div class="cx-sec-t" style="margin:14px 0 8px">' + t + '</div><div class="tw-dstats">' + items.join("") + '</div>'; };
    D.innerHTML = '<div class="tw-dback"></div><div class="tw-dpanel"><div class="tw-dhead"><div><h3>' + esc(r.name) + '</h3><small>' + esc(r.id) + ' · ' + esc(CATL[r.cat] || r.cat) + ' · last purchase ' + dfmt(r.lpd) + '</small></div><button type="button" class="tw-dx">×</button></div><div class="tw-dbody"><div style="display:flex;gap:6px;flex-wrap:wrap">' + ageChip(r.aging) + chip((r.tag || "—").replace(/^\d-\s*/, ""), TAG_TONE[r.tag] || "na") + (r.action ? chip(r.action, "warn") : "") + '</div>' +
      sec("Stock", [kv("On hand", int(r.stock)), kv("DOH", dohTxt(r)), kv("WAC", money(r.wac)), kv("Inventory value", money(r.inv)), kv("Movement", esc((r.fms || "—").replace(/^\d\.\s*/, ""))), kv("ABC", esc(r.abc || "—"))]) +
      sec("Returns", [kv("Expected returns", int(r.exRet)), kv("Returns value", money(r.retV)), kv("DR%", pct(r.drPct, 1)), kv("Stock + returns", int(r.stock + r.exRet))]) +
      sec("Segment (confirmed GMV)", [kv("Actual MTD", money(r.gA) + ' · ' + esc(r.segA)), kv("Last month", money(r.gL) + ' · ' + esc(r.segL)), kv("Projected", money(r.gP) + ' · ' + esc(r.segP))]) +
      sec("Action logic", [kv("ABC", esc(r.abc)), kv("FMS", esc((r.fms || "—").replace(/^\d\.\s*/, ""))), kv("Purchase period", esc(r.quarter || "—")), kv("Channel", esc(r.channel || "—")), kv("MTD confirmed", int(r.mtd)), kv("Sell-through MTD", r.str == null ? "—" : pct(r.str * 100, 0))]) +
      sec("Sales", [kv("Avg 3D demand", (+r.avg3).toFixed(1)), kv("Avg 15D demand", (+r.avg15).toFixed(1)), kv("Confirmed last 15D", int(r.c15)), kv("Confirmed last 30D", int(r.c30))]) +
      sec("Inbound", [kv("Last inbound", dfmt(r.lpd)), kv("Days since last inbound", r.days == null ? "—" : int(r.days))]) + '</div></div>';
    document.body.appendChild(D); requestAnimationFrame(function () { D.classList.add("open"); });
    var close = function () { D.classList.remove("open"); setTimeout(function () { D.remove(); }, 200); };
    D.querySelector(".tw-dback").onclick = close; D.querySelector(".tw-dx").onclick = close;
  }
  /* ---------------------------------------------------------------- wiring */
  var VIEWS = { scAging: ["viewScAging", renderAging], scSkus: ["viewScSkus", renderSkus], scActions: ["viewScActions", renderActions] };
  var current = null;
  function rerender() { build(); if (current && VIEWS[current]) { var h = $(VIEWS[current][0]); if (h && !h.classList.contains("hidden")) VIEWS[current][1](h); } }
  function onClick(e) {
    var t = e.target;
    var c = t.closest("[data-sc-cat]"); if (c) { SC.cat = c.getAttribute("data-sc-cat"); rerender(); return; }
    var sg = t.closest("[data-sc-seg]"); if (sg) { SC.segMode = sg.getAttribute("data-sc-seg"); rerender(); return; }
    var a = t.closest("[data-sc-act]"); if (a) { SC.act = a.getAttribute("data-sc-act"); rerender(); return; }
    var s = t.closest("[data-sc-sku]"); if (s) { openSku(s.getAttribute("data-sc-sku")); return; }
    var b = t.closest("[data-sc]"); if (b) { var k = b.getAttribute("data-sc"); if (k === "prev") { SC.sk.page = Math.max(0, SC.sk.page - 1); drawSkuBody(); } else if (k === "next") { SC.sk.page++; drawSkuBody(); } return; }
    var th = t.closest("#scSkuTable th[data-k]"); if (th) { var key = th.getAttribute("data-k"); if (SC.sk.key === key) SC.sk.dir = SC.sk.dir === "asc" ? "desc" : "asc"; else { SC.sk.key = key; SC.sk.dir = "desc"; } SC.sk.page = 0; drawSkuBody(); }
  }
  function onInput(e) {
    var t = e.target; if (t.id === "scSkuQ") { SC.sk.q = t.value; SC.sk.page = 0; drawSkuBody(); return; }
    var pk = t.getAttribute && t.getAttribute("data-plan"); if (pk) { var pv = parseFloat(String(t.value).replace(/,/g, "")); planSet(pk, pv > 0 ? pv : 0); rerender(); return; }
    var k = t.getAttribute && t.getAttribute("data-sk"); if (!k) return;
    SC.sk[k] = t.type === "checkbox" ? t.checked : t.value; SC.sk.page = 0; drawSkuBody();
  }
  function setup() {
    Object.keys(VIEWS).forEach(function (name) {
      mkSection(VIEWS[name][0]);
      C.registerView(name, { sectionId: VIEWS[name][0], navId: ({ scAging: "navScAging", scSkus: "navScSkus", scActions: "navScActions" })[name], label: "", open: true, sub: "Inventory aging, stock health & actions", render: function (host) { current = name; build(); if (SC.empty) { host.innerHTML = '<div class="sc-note">Waiting for dashboard data (inventory, COGS, inbound and sales). It appears here as soon as the main data finishes loading.</div>'; return; } VIEWS[name][1](host); } });
      var h = $(VIEWS[name][0]); if (h) { h.addEventListener("click", onClick); h.addEventListener("input", onInput); h.addEventListener("change", onInput); }
    });
    boot();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
})();
