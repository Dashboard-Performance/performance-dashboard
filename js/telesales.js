/* Telesales → Telesales Performance (v1.18.0)
   Performance of the Telesales merchant (Merchant ID 1160154) only, at SKU level, from Main (the match-level query: merchant × SKU × day).
   Period = the month picked at the top of the dashboard (Overall = every loaded month).
   Every metric uses the dashboard's own definitions — the same bucket maths as the Commercial targets actuals (tcEmptyBucket / tcFinalizeBucket):
     • Placed / Confirmed / Delivered pieces, orders and Delivered GMV: the whole period, no cut-off.
     • CR% = Confirmed ÷ Placed pieces, only days up to the CR cut-off (latest data day − CR_LAG_DAYS).
     • DR% = Delivered ÷ Confirmed pieces, only days up to the CM3 cut-off (latest data day − CM3_LAG_DAYS). NDR% = CR% × DR%.
     • CM3 and CM3% (÷ Delivered GMV of the same days): only days up to the CM3 cut-off. CM3/Pc = CM3 ÷ Delivered pieces of those days.
     • PPM, PPM/Pc, PPM% (÷ Delivered GMV): the whole period, no cut-off.
     • ASP = Delivered GMV ÷ Delivered pieces. Avg Placed/Day = Placed pieces ÷ days that have rows.
     • Stock & DOH: the dashboard's stock index (bundles broken into their singles), company stock of the SKU.
   The cut-off day comes from all merchants' rows in the period (the dashboard's latest data day), not from this merchant alone.
   1160154 still counts in every other page of the dashboard. */
(function () {
  "use strict";
  var MID = "1160154", PAGE = 50, VIEW = "telesales";
  var TS = { q: "", sort: "placed", dir: -1, page: 0, sig: "", data: null, chart: null };
  function $(id) { return document.getElementById(id); }
  function st() { try { return state; } catch (e) { return {}; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v) { return v == null || !isFinite(v) ? "—" : Math.round(+v).toLocaleString("en-US"); }
  function dec(v, n) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n }); }
  function pct(v) { return v == null || !isFinite(v) ? "—" : (+v).toFixed(1) + "%"; }
  function money(v) { return typeof fmtMoneyExact === "function" ? fmtMoneyExact(v) : "EGP " + int(v); }        // tables: the real number
  function moneyC(v) { return typeof fmtMoneyCompact === "function" ? fmtMoneyCompact(v) : "EGP " + int(v); }   // cards: short form
  function month() { var s = $("monthSelect"); return s ? s.value : ""; }

  function build() {
    var S = st(), all = S.allParsedRows || [], m = month();
    var sig = (all.length + ":" + (all[0] && all[0].timestamp) + ":" + (all[all.length - 1] && all[all.length - 1].timestamp)) + "|" + m;
    if (TS.data && TS.sig === sig) return TS.data;
    var period = all.filter(function (r) { return rowMatchesPeriod(r, m, VIEW); });
    var cm3Cut = getCm3LagCutoffTimestamp(period), crCut = getLagCutoffTimestamp(period, CR_LAG_DAYS);
    var mine = period.filter(function (r) { return String(r.merchantId || "").trim() === MID; });
    var bySku = new Map(), tot = tcEmptyBucket(), orders = { po: 0, co: 0, dO: 0 }, daily = new Map(), info = new Map();
    var add = function (b, r) {
      b.placed += r.placedPieces || 0; b.confirmed += r.confirmedPieces || 0; b.delivered += r.deliveredPieces || 0; b.deliveredGmv += r.deliveredGmv || 0;
      if (r.date) b.dateSet.add(r.date); if (r.sku) b.skuSet.add(r.sku);
      if (isRowEligibleForLag(r, crCut, VIEW)) { b.crPlaced += r.placedPieces || 0; b.crConfirmed += r.confirmedPieces || 0; }
      if (isRowEligibleForLag(r, cm3Cut, VIEW)) { b.drConfirmed += r.confirmedPieces || 0; b.drDelivered += r.deliveredPieces || 0; }
      if (isCm3RowEligible(r, cm3Cut, VIEW)) { b.cm3 += r.cm3 || 0; b.cm3Gmv += r.deliveredGmv || 0; }
      b.ppm += r.ppm || 0; b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0); b.ppmPerPieceWeight += r.deliveredPieces || 0;
      b.po = (b.po || 0) + (r.placedOrders || 0); b.dO = (b.dO || 0) + (r.deliveredOrders || 0); b.co = (b.co || 0) + (r.confirmedOrders || 0);
    };
    mine.forEach(function (r) {
      if (!r.sku) return;
      var b = bySku.get(r.sku); if (!b) { b = tcEmptyBucket(); bySku.set(r.sku, b); }
      add(b, r); add(tot, r);
      if (!info.has(r.sku)) info.set(r.sku, { name: r.productName || "", category: r.category || "" });
      var d = daily.get(r.date) || { ts: r.timestamp, placed: 0, confirmed: 0, delivered: 0 };
      d.placed += r.placedPieces || 0; d.confirmed += r.confirmedPieces || 0; d.delivered += r.deliveredPieces || 0; daily.set(r.date, d);
    });
    var sd = null; try { sd = buildDebundledStockDohIndex(S.allParsedRows || []); } catch (e) { sd = null; }
    var T = tcFinalizeBucket(tot, tot.deliveredGmv); T.po = tot.po || 0; T.co = tot.co || 0; T.dO = tot.dO || 0;
    var skus = [];
    bySku.forEach(function (b, sku) {
      var f = tcFinalizeBucket(b, tot.deliveredGmv), i = info.get(sku) || {}, s = sd ? sd.getStockDoh(sku) : null;
      skus.push({ sku: sku, name: i.name, category: i.category, stock: s ? +s.stock || 0 : null, doh: s && s.doh != null && isFinite(s.doh) ? +s.doh : null,
        placed: f.placed, placedDaily: f.placedDaily, po: b.po || 0, confirmed: f.confirmed, crPct: f.crPct, delivered: f.delivered, dO: b.dO || 0, drPct: f.drPct, ndrPct: f.ndrPct,
        gmv: f.gmv, contribution: f.contribution, asp: f.aspDlv, cm3: f.cm3, cm3PerPiece: f.cm3PerPiece, cm3Pct: f.cm3Pct, ppm: f.ppm, ppmPerPiece: f.ppmPerPiece, ppmPct: f.ppmPct });
    });
    var days = Array.from(daily.entries()).sort(function (a, b) { return a[1].ts - b[1].ts; });
    TS.data = { T: T, skus: skus, days: days, rows: mine.length, cm3Cut: cm3Cut, crCut: crCut, month: m, loaded: all.length > 0 };
    TS.sig = sig;
    return TS.data;
  }

  var COLS = [
    ["sku", "SKU ID", 0, "SKU of the Telesales merchant (1160154)."], ["name", "SKU Name", 0], ["category", "Category", 0],
    ["stock", "Stock", 1, "Current stock of the SKU (company stock, bundles broken into their singles)."], ["doh", "DOH", 1, "Days of stock left = Stock ÷ average daily Confirmed pieces of the last 3 days (all merchants)."],
    ["placed", "Placed Pcs", 1], ["placedDaily", "Avg Placed/Day", 1, "Placed pieces ÷ days the SKU has rows in the period."], ["po", "Placed Orders", 1],
    ["confirmed", "Confirmed Pcs", 1], ["crPct", "CR%", 1, "Confirmed ÷ Placed pieces, days up to the CR cut-off."],
    ["delivered", "Delivered Pcs", 1], ["dO", "Delivered Orders", 1], ["drPct", "DR%", 1, "Delivered ÷ Confirmed pieces, days up to the CM3 cut-off."], ["ndrPct", "NDR%", 1, "CR% × DR%."],
    ["gmv", "Delivered GMV", 1], ["contribution", "GMV Contr%", 1, "This SKU's Delivered GMV ÷ the merchant's total Delivered GMV."], ["asp", "ASP", 1, "Delivered GMV ÷ Delivered pieces."],
    ["cm3", "CM3", 1, "CM3 of the days up to the CM3 cut-off."], ["cm3PerPiece", "CM3/Pc", 1, "CM3 ÷ Delivered pieces of the same days."], ["cm3Pct", "CM3%", 1, "CM3 ÷ Delivered GMV of the same days."],
    ["ppm", "PPM", 1, "Whole period, no cut-off."], ["ppmPerPiece", "PPM/Pc", 1], ["ppmPct", "PPM%", 1, "PPM ÷ Delivered GMV."]
  ];
  var MONEY = { gmv: 1, asp: 1, cm3: 1, cm3PerPiece: 1, ppm: 1, ppmPerPiece: 1 }, PCT = { crPct: 1, drPct: 1, ndrPct: 1, contribution: 1, cm3Pct: 1, ppmPct: 1 };
  function cell(r, k) {
    var v = r[k];
    if (MONEY[k]) return money(v);
    if (PCT[k]) return pct(v);
    if (k === "placedDaily" || k === "doh") return v == null ? "—" : dec(v, 1);
    if (k === "stock") return v == null ? "—" : int(v);
    return typeof v === "number" ? int(v) : esc(v || "—");
  }
  function rowsOf(d) {
    var q = TS.q.trim().toLowerCase();
    var rows = d.skus.filter(function (r) { return !q || r.sku.toLowerCase().indexOf(q) >= 0 || String(r.name || "").toLowerCase().indexOf(q) >= 0 || String(r.category || "").toLowerCase().indexOf(q) >= 0; });
    var k = TS.sort, dir = TS.dir;
    return rows.sort(function (a, b) { var x = a[k], y = b[k]; if (typeof x === "string" || typeof y === "string") return dir * String(x || "").localeCompare(String(y || "")); return dir * ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)); });
  }
  function dayText(ts) { return ts ? new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"; }

  function render(host) {
    var d = build();
    if (!d.loaded) { host.innerHTML = '<div class="sc-note">Waiting for dashboard data… this page fills in as soon as Main finishes loading.</div>'; watch(host); return; }
    watch(host);
    var T = d.T, rows = rowsOf(d), pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (TS.page > pages - 1) TS.page = pages - 1;
    var per = d.month || "All loaded months";
    var tiles = [
      ["SKUs", int(T.skuCount), "with rows in " + per], ["Placed Pcs", int(T.placed), int(T.po) + " orders"], ["Confirmed Pcs", int(T.confirmed), int(T.co) + " orders"],
      ["Delivered Pcs", int(T.delivered), int(T.dO) + " orders"], ["Avg Placed/Day", dec(T.placedDaily, 1), "pieces per day with rows"],
      ["CR%", pct(T.crPct), "up to " + dayText(d.crCut)], ["DR%", pct(T.drPct), "up to " + dayText(d.cm3Cut)], ["NDR%", pct(T.ndrPct), "CR% × DR%"],
      ["Delivered GMV", moneyC(T.gmv), "ASP " + moneyC(T.aspDlv)], ["CM3", moneyC(T.cm3), "CM3% " + pct(T.cm3Pct) + " · per pc " + moneyC(T.cm3PerPiece)],
      ["PPM", moneyC(T.ppm), "PPM% " + pct(T.ppmPct) + " · per pc " + moneyC(T.ppmPerPiece)]
    ];
    var th = function (c) { return '<th class="' + (c[2] ? "num" : "") + '" style="cursor:pointer;white-space:nowrap" data-tss="' + c[0] + '"' + (c[3] ? ' title="' + esc(c[3]) + '"' : "") + '>' + c[1] + (TS.sort === c[0] ? (TS.dir < 0 ? " ↓" : " ↑") : "") + '</th>'; };
    var html = '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Telesales Performance</h2>' +
      '<p>Merchant ID ' + MID + ' only · ' + esc(per) + ' · from Matches (Main). Pick the month at the top of the dashboard.</p></div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + esc(t[2]) + '</small></div>'; }).join("") + '</div></div>';
    html += '<div class="panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Daily Pieces</h2><p>Placed, Confirmed and Delivered pieces per day — merchant ' + MID + '</p></div></div>' +
      '<div style="height:260px;padding:0 18px 16px"><canvas id="tsDailyChart"></canvas></div></div>';
    html += '<div class="panel table-panel hover-glow"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>SKU Performance</h2><p>' + int(rows.length) + ' SKUs · hover a column title for how it is calculated</p></div>' +
      '<div class="table-controls" style="gap:8px;flex-wrap:wrap"><input id="tsQ" type="search" class="date-filter-input" style="min-width:220px" placeholder="Search SKU ID, name or category" value="' + esc(TS.q) + '">' +
      '<button class="btn btn-outline small tw-exp" data-csv="own" id="tsCsv">Export CSV</button></div></div>' +
      '<div class="table-responsive"><table class="data-table" id="tsTable"><thead><tr>' + COLS.map(th).join("") + '</tr></thead><tbody>' +
      (rows.slice(TS.page * PAGE, TS.page * PAGE + PAGE).map(function (r) {
        return '<tr>' + COLS.map(function (c) { var k = c[0]; return '<td class="' + (c[2] ? "num" : "") + (k === "sku" ? " font-mono" : "") + (k === "name" ? " truncate-cell" : "") + (k === "doh" && r.doh != null && r.doh < 5 ? " text-red font-bold" : "") + '"' + (k === "name" ? ' style="max-width:240px" title="' + esc(r.name) + '"' : "") + '>' + cell(r, k) + '</td>'; }).join("") + '</tr>';
      }).join("") || '<tr><td colspan="' + COLS.length + '" class="text-dim" style="text-align:center;padding:18px">No rows for merchant ' + MID + ' in this period.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="pagination-controls" style="display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:12px 18px"><button class="btn btn-outline small" id="tsPrev"' + (TS.page ? "" : " disabled") + '>Prev</button><span class="text-dim">Page ' + (TS.page + 1) + ' of ' + pages + '</span><button class="btn btn-outline small" id="tsNext"' + (TS.page < pages - 1 ? "" : " disabled") + '>Next</button></div></div>';
    host.innerHTML = html;
    drawChart(d);
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("tsQ", "input", function (e) { TS.q = e.target.value; TS.page = 0; render(host); var el = host.querySelector("#tsQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    on("tsPrev", "click", function () { if (TS.page > 0) { TS.page--; render(host); } });
    on("tsNext", "click", function () { TS.page++; render(host); });
    host.querySelectorAll("[data-tss]").forEach(function (h) { h.addEventListener("click", function () { var k = h.dataset.tss; if (TS.sort === k) TS.dir = -TS.dir; else { TS.sort = k; TS.dir = -1; } render(host); }); });
    on("tsCsv", "click", function () {
      var all = rowsOf(d), r2 = function (v) { return v == null || !isFinite(v) ? "" : Math.round(v * 100) / 100; };
      var lines = [COLS.map(function (c) { return c[1]; })].concat(all.map(function (r) { return COLS.map(function (c) { var v = r[c[0]]; return typeof v === "number" ? r2(v) : (v == null ? "" : v); }); }));
      var csv = "﻿" + lines.map(function (l) { return l.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = "telesales-" + MID + "_" + (d.month || "all").replace(/\s+/g, "-") + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }
  function drawChart(d) {
    var cv = $("tsDailyChart"); if (!cv || typeof Chart === "undefined") return;
    if (TS.chart) { try { TS.chart.destroy(); } catch (e) {} TS.chart = null; }
    var labels = d.days.map(function (x) { return dayText(x[1].ts); });
    TS.chart = new Chart(cv.getContext("2d"), {
      data: { labels: labels, datasets: [
        { type: "bar", label: "Placed", data: d.days.map(function (x) { return x[1].placed; }), backgroundColor: "rgba(59,130,246,.55)", borderRadius: 4, order: 3 },
        { type: "line", label: "Confirmed", data: d.days.map(function (x) { return x[1].confirmed; }), borderColor: "#a78bfa", backgroundColor: "#a78bfa", tension: .3, pointRadius: 2, order: 1 },
        { type: "line", label: "Delivered", data: d.days.map(function (x) { return x[1].delivered; }), borderColor: "#34d399", backgroundColor: "#34d399", tension: .3, pointRadius: 2, order: 2 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: "#94a3b8" } } },
        scales: { x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } }, y: { beginAtZero: true, ticks: { color: "#94a3b8", callback: function (v) { return v >= 1000 ? (v / 1000) + "k" : v; } }, grid: { color: "#1e293b" } } } }
    });
  }
  // re-draw when new data arrives or the month changes while the page is open
  var watchT = 0;
  function watch(host) {
    clearInterval(watchT);
    watchT = setInterval(function () {
      var sec = $("viewTelesales"); if (!sec || sec.classList.contains("hidden")) { clearInterval(watchT); return; }
      var S = st(), all = S.allParsedRows || [];
      var sig = (all.length + ":" + (all[0] && all[0].timestamp) + ":" + (all[all.length - 1] && all[all.length - 1].timestamp)) + "|" + month();
      if (sig !== TS.sig) render(host);
    }, 1500);
  }
  window.TaagerTelesales = { build: function () { TS.sig = ""; return build(); }, state: TS, MID: MID };

  function boot() {
    var C = window.TowerCore; if (!C || !C.registerView) { setTimeout(boot, 300); return; }
    C.registerView(VIEW, { sectionId: "viewTelesales", navId: "navTelesalesPerf", label: "Telesales Performance", sub: "Merchant ID " + MID + " · SKU-level performance from Matches", open: true, render: render });
    var nav = $("navTelesalesPerf"); if (nav && !nav.dataset.ts) { nav.dataset.ts = "1"; nav.addEventListener("click", function () { window.switchView(VIEW); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 160); }); else setTimeout(boot, 160);
})();
