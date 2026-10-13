/* Commercial redesign (v1.8.0): Targets hub (Targets + Commercial Plan), CM3 Analyst / Products CT-style view.
   Loaded after app.js. Reuses app.js data functions; replaces only the presentation. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { try { return fmtMoneyCompact(n); } catch (e) { return Math.round(n || 0).toLocaleString(); } }
  function pct(n, d) { n = +n || 0; return n.toFixed(d == null ? 1 : d) + "%"; }
  function int(n) { return Math.round(+n || 0).toLocaleString(); }
  function val(v, f) { if (v == null) return "—"; return f === "pct" ? pct(v) : f === "money" ? money(v) : int(v); }
  function tone(a) { return a == null ? "na" : a >= 100 ? "ok" : a >= 85 ? "warn" : "bad"; }
  var LBL = { ok: "On target", warn: "Near target", bad: "Below target", na: "No target" };

  /* ============================================================ TARGETS ============================================================ */
  var CATS = ["grand total", "consumables", "electronics", "fashion", "home", "leisure"];
  var CATLBL = { "grand total": "Grand Total", consumables: "Consumables", electronics: "Electronics", fashion: "Fashion", home: "Home", leisure: "Leisure" };
  function ach(row, tr, ar) {
    var t = tr ? (tr[row.t] || 0) : 0, a = (row.a && ar) ? (ar[row.a] || 0) : null;
    return { t: t, a: a, p: (a != null && t) ? a / t * 100 : null };
  }
  function ring(p, t) {
    var v = Math.max(0, Math.min(100, p == null ? 0 : p)), C = 2 * Math.PI * 52;
    return '<svg viewBox="0 0 120 120" class="cx-ring cx-' + t + '"><circle cx="60" cy="60" r="52" class="cx-ring-bg"/><circle cx="60" cy="60" r="52" class="cx-ring-fg" stroke-dasharray="' + (C * v / 100).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 60 60)"/><text x="60" y="58" text-anchor="middle" class="cx-ring-n">' + (p == null ? "—" : Math.round(p) + "%") + '</text><text x="60" y="76" text-anchor="middle" class="cx-ring-s">score</text></svg>';
  }
  function kpi(label, row, tr, ar, cls) {
    var x = ach(row, tr, ar), t = tone(x.p), w = x.p == null ? 0 : Math.min(100, x.p);
    var delta = (x.a != null && x.t) ? (x.a - x.t) : null;
    return '<div class="cx-kpi cx-' + t + '"><div class="cx-kpi-h"><span>' + label + '</span><i class="cx-chip cx-' + t + '">' + LBL[t] + '</i></div>' +
      '<div class="cx-kpi-v">' + val(x.a, row.fmt) + '</div>' +
      '<div class="cx-bar"><b style="width:' + w + '%"></b><u style="left:100%"></u></div>' +
      '<div class="cx-kpi-f"><span>Target ' + val(x.t, row.fmt) + '</span><span>' + (delta == null ? "" : (delta >= 0 ? "▲ " : "▼ ") + val(Math.abs(delta), row.fmt) + (row.fmt === "pct" ? " pp" : "")) + '</span></div></div>';
  }
  function mini(label, row, tr, ar) {
    var x = ach(row, tr, ar), t = tone(x.p);
    return '<div class="cx-mini"><span>' + label + '</span><b>' + val(x.a, row.fmt) + '</b><div class="cx-bar sm cx-' + t + '"><b style="width:' + (x.p == null ? 0 : Math.min(100, x.p)) + '%"></b></div><em>' + (x.p == null ? "no target" : Math.round(x.p) + "% of " + val(x.t, row.fmt)) + '</em></div>';
  }
  var R = {}; function R_(k) { if (!R[k]) { for (var i = 0; i < TC_METRIC_ROWS.length; i++) R[TC_METRIC_ROWS[i].t] = TC_METRIC_ROWS[i]; } return R[k]; }

  var GROUPS = [
    ["Volume", ["placedPiecesTarget", "plannedCnfPieces", "dlvPiecesTarget", "targetPlacedDaily"]],
    ["Conversion", ["targetCr", "targetDr", "targetContribution"]],
    ["Value", ["targetGmv", "aspDlvPlanned"]],
    ["Profitability", ["targetCm3", "targetCm3PerPiece", "targetCm3Pct", "targetPpm", "targetPpmPerPiece", "targetPpmPct"]]
  ];
  var SHORT = { targetPlacedDaily: "Daily target (pcs/day)", placedPiecesTarget: "Placed (pcs)", plannedCnfPieces: "Confirmed (pcs)", dlvPiecesTarget: "Delivered (pcs)", targetCr: "CR %", targetDr: "DR %", targetContribution: "Contribution %", targetGmv: "Delivered GMV", aspDlvPlanned: "ASP", targetCm3: "CM3", targetCm3PerPiece: "CM3 / piece", targetCm3Pct: "CM3 %", targetPpm: "PPM", targetPpmPerPiece: "PPM / piece", targetPpmPct: "PPM %" };
  function buildTargets() {
    var v = $("viewTargetsCommercial"); if (!v || $("tcNew")) return;
    Array.prototype.forEach.call(v.children, function (c) { c.classList.add("cx-legacy"); });
    var d = document.createElement("div"); d.id = "tcNew";
    d.innerHTML = '<div class="cx-bar-top"><div class="cx-sec-t" style="margin:0">All categories · Actual vs Target</div><div class="cx-range"><span class="cx-legend"><i class="cx-dot cx-ok"></i>On target ≥100%<i class="cx-dot cx-warn"></i>Near 85–99%<i class="cx-dot cx-bad"></i>Below 85%</span><span id="cxRange"></span><span id="cxDateSlot"></span></div></div>' +
      '<div class="cx-cats" id="cxCatCards"></div>' +
      '<div class="panel table-panel"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Targets scorecard</h2><p>Every metric for every category in one view — Actual, then Target and Achievement % (CM3 / rate cut-off rules apply)</p></div></div><div class="table-responsive"><table class="data-table cx-matrix" id="cxMatrix"><thead id="cxMatrixHead"></thead><tbody id="cxMatrixBody"></tbody></table></div></div>';
    v.appendChild(d);
    var slot = $("cxDateSlot"), f = v.querySelector(".section-date-filter"); if (f && slot) slot.appendChild(f);
  }
  function cellHtml(x, row) {
    var t = tone(x.p), w = x.p == null ? 0 : Math.min(100, x.p);
    return '<td class="cx-cell cx-' + t + '"><b>' + val(x.a, row.fmt) + '</b><span>' + (x.t ? 'of ' + val(x.t, row.tFmt || row.fmt) + ' · ' + Math.round(x.p == null ? 0 : x.p) + '%' : 'no target') + '</span><div class="cx-bar xs"><b style="width:' + w + '%"></b></div></td>';
  }
  function renderTargetsNew() {
    buildTargets(); if (!$("tcNew")) return;
    var actuals = computeCommercialActuals(state.allParsedRows || []), tgt = state.commercialTargets || {};
    var sm = $("monthSelect") ? $("monthSelect").value : ""; $("cxRange").textContent = sm || "All time";
    var core = ["targetCr", "targetDr", "targetPpmPct", "targetCm3Pct", "targetGmv", "dlvPiecesTarget"];
    $("cxCatCards").innerHTML = CATS.map(function (c) {
      var tr = tgt[c], ar = actuals[c], sum = 0, n = 0;
      core.forEach(function (k) { var x = ach(R_(k), tr, ar); if (x.p != null) { sum += Math.min(150, x.p); n++; } });
      var sc = n ? sum / n : null, t = tone(sc), g = ach(R_("targetGmv"), tr, ar);
      return '<div class="cx-cat cx-' + t + (c === "grand total" ? " cx-gt" : "") + '"><div class="cx-cat-h"><b>' + CATLBL[c] + '</b><i class="cx-chip cx-' + t + '">' + LBL[t] + '</i></div><div class="cx-cat-s">' + (sc == null ? "—" : Math.round(sc) + "%") + '<small>score</small></div><div class="cx-bar sm"><b style="width:' + (sc == null ? 0 : Math.min(100, sc)) + '%"></b></div><div class="cx-cat-f"><span>GMV ' + (ar ? money(ar.gmv) : "—") + '</span><span>' + (g.t ? "of " + money(g.t) : "no target") + '</span></div></div>';
    }).join("");
    $("cxMatrixHead").innerHTML = '<tr><th>Metric</th>' + CATS.map(function (c) { return '<th class="num' + (c === "grand total" ? " cx-gt-h" : "") + '">' + CATLBL[c] + '</th>'; }).join("") + '</tr>';
    $("cxMatrixBody").innerHTML = GROUPS.map(function (g) {
      return '<tr class="cx-grp"><td colspan="' + (CATS.length + 1) + '">' + g[0] + '</td></tr>' + g[1].map(function (k) {
        var row = R_(k); if (!row) return "";
        return '<tr><td class="font-bold text-light">' + SHORT[k] + '</td>' + CATS.map(function (c) { return cellHtml(ach(row, tgt[c], actuals[c]), row); }).join("") + '</tr>';
      }).join("");
    }).join("");
  }
  window.renderTargetsCommercialView = renderTargetsNew;

  /* ============================================================ CM3 ANALYST / PRODUCTS ============================================================ */
  function buildCm3() {
    var v = $("viewCm3AnalystProducts"); if (!v || $("cxCm3")) return;
    var secs = v.querySelectorAll(":scope > section");
    // [0] toolbar (keep, restyled), [1] old KPI grid (hide), [2] old pipeline & insights (hide), [3] table (keep)
    if (secs[1]) secs[1].classList.add("cx-legacy");
    if (secs[2]) secs[2].classList.add("cx-legacy");
    if (secs[4]) secs[4].classList.add("cx-legacy");
    var d = document.createElement("div"); d.id = "cxCm3";
    d.innerHTML = '<div class="cx-hero2" id="cxCm3Hero"></div><div class="cx-grid2"><div class="panel cx-card"><div class="cx-card-h">CM3 % by category</div><div id="cxCm3Cats"></div></div><div class="panel cx-card"><div class="cx-card-h">Needs attention <small>Fix PPM · lowest CM3 % · Placed &gt; 30</small></div><div id="cxCm3Watch"></div></div></div>' +
      '<div class="cx-grid2"><div class="panel cx-card"><div class="cx-card-h">Top performers <small>by CM3</small></div><div id="cxCm3Top"></div></div><div class="panel cx-card"><div class="cx-card-h">Biggest CM3 % movers <small>vs previous 5-day period · Placed &gt; 30</small></div><div id="cxCm3Mov"></div></div></div>';
    if (secs[0] && secs[0].nextSibling) v.insertBefore(d, secs[0].nextSibling); else v.appendChild(d);
    d.addEventListener("click", function (e) { var r = e.target.closest("[data-sku]"); if (r) openSku(r.getAttribute("data-sku")); });
    var tb = $("cm3apTableBody");
    if (tb) tb.addEventListener("click", function (e) { var tr = e.target.closest("tr"); if (!tr) return; var td = tr.querySelector("td"); if (td) openSku(td.textContent.trim()); });
  }
  function pill(s) { return '<i class="cx-chip cx-' + (s === "OK" ? "ok" : s === "Fix PPM" ? "bad" : "na") + '">' + esc(s) + '</i>'; }
  function lrow(p, right) { return '<div class="cx-lrow" data-sku="' + esc(p.sku) + '"><div><b>' + esc(p.skuName || p.sku) + '</b><small>' + esc(p.sku) + ' · ' + esc(p.category) + '</small></div><div class="cx-lr">' + right + '</div></div>'; }
  function renderCm3New() {
    buildCm3(); var d = $("cxCm3"); if (!d || typeof cm3apDataAll === "undefined") return;
    var all = cm3apDataAll.slice(); if (!all.length) { $("cxCm3Hero").innerHTML = '<div class="cx-empty">No data for this period.</div>'; ["Cats", "Watch", "Top", "Mov"].forEach(function (k) { $("cxCm3" + k).innerHTML = ""; }); return; }
    var cat = $("cm3apCategorySelect") ? $("cm3apCategorySelect").value : "All";
    var data = cat && cat !== "All" ? all.filter(function (p) { return p.category === cat; }) : all;
    var gmv = 0, cm3 = 0, ppm = 0, pl = 0, cf = 0, dl = 0, fix = 0;
    data.forEach(function (p) { gmv += p.deliveredGmv; cm3 += p.cm3; ppm += p.ppm; pl += p.placed; cf += p.confirmed; dl += p.delivered; if (p.status === "Fix PPM") fix++; });
    var cmP = gmv ? cm3 / gmv * 100 : 0, ppP = gmv ? ppm / gmv * 100 : 0, cr = pl ? cf / pl * 100 : 0, dr = cf ? dl / cf * 100 : 0;
    var tiles = [["Products", int(data.length), "Period " + ((cm3apMeta && cm3apMeta.latestPeriod) || "-"), ""], ["Delivered GMV", money(gmv), "Delivered pcs " + int(dl), ""], ["CM3", money(cm3), pct(cmP, 2) + " of GMV", cm3 >= 0 ? "ok" : "bad"], ["PPM", money(ppm), pct(ppP, 2) + " of GMV", ""], ["CR → DR", pct(cr, 0) + " → " + pct(dr, 0), "NDR " + pct(cr * dr / 100, 1), ""], ["Fix PPM", int(fix), "below 80% of target PPM", fix ? "bad" : "ok"]];
    $("cxCm3Hero").innerHTML = tiles.map(function (t) { return '<div class="cx-tile ' + (t[3] ? "cx-" + t[3] : "") + '"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("");
    // categories
    var bc = {}; all.forEach(function (p) { var c = bc[p.category] || (bc[p.category] = { g: 0, m: 0, n: 0 }); c.g += p.deliveredGmv; c.m += p.cm3; c.n++; });
    var cats = Object.keys(bc).map(function (k) { return { k: k, p: bc[k].g ? bc[k].m / bc[k].g * 100 : 0, g: bc[k].g, n: bc[k].n }; }).sort(function (a, b) { return b.g - a.g; });
    var mx = Math.max.apply(null, cats.map(function (c) { return Math.abs(c.p); }).concat([1]));
    $("cxCm3Cats").innerHTML = cats.map(function (c) { return '<div class="cx-crow"><span>' + esc(c.k) + '<small>' + c.n + ' SKUs · ' + money(c.g) + '</small></span><div class="cx-bar sm ' + (c.p >= 0 ? "cx-ok" : "cx-bad") + '"><b style="width:' + Math.min(100, Math.abs(c.p) / mx * 100) + '%"></b></div><em>' + pct(c.p, 1) + '</em></div>'; }).join("");
    // watchlist: Fix PPM first then lowest cm3 pct among qualified (gmv>0)
    var watch = data.filter(function (p) { return p.deliveredGmv > 0 && p.placed > 30; }).sort(function (a, b) { return ((b.status === "Fix PPM") - (a.status === "Fix PPM")) || (a.cm3Pct - b.cm3Pct); }).slice(0, 6);
    $("cxCm3Watch").innerHTML = watch.map(function (p) { return lrow(p, '<b class="' + (p.cm3Pct < 0 ? "text-red" : "") + '">' + pct(p.cm3Pct, 1) + '</b>' + pill(p.status)); }).join("") || '<div class="cx-empty">Nothing flagged.</div>';
    var top = data.slice().sort(function (a, b) { return b.cm3 - a.cm3; }).slice(0, 6);
    $("cxCm3Top").innerHTML = top.map(function (p) { return lrow(p, '<b class="text-green">' + money(p.cm3) + '</b><small>' + pct(p.cm3Pct, 1) + '</small>'); }).join("");
    var mov = data.filter(function (p) { return p.deltaCm3Pct != null && p.placed > 30; }).sort(function (a, b) { return Math.abs(b.deltaCm3Pct) - Math.abs(a.deltaCm3Pct); }).slice(0, 6);
    $("cxCm3Mov").innerHTML = mov.map(function (p) { return lrow(p, '<b class="' + (p.deltaCm3Pct >= 0 ? "text-green" : "text-red") + '">' + (p.deltaCm3Pct >= 0 ? "▲ " : "▼ ") + pct(Math.abs(p.deltaCm3Pct), 1) + '</b><small>' + pct(p.cm3Pct, 1) + '</small>'); }).join("") || '<div class="cx-empty">Not enough history.</div>';
  }
  function openSku(sku) {
    var p = (typeof cm3apDataAll !== "undefined" ? cm3apDataAll : []).filter(function (x) { return String(x.sku) === String(sku); })[0]; if (!p) return;
    var old = $("cxSku"); if (old) old.remove();
    var D = document.createElement("div"); D.id = "cxSku"; D.className = "tw-drawer";
    var kv = [["Placed", int(p.placed)], ["Confirmed", int(p.confirmed)], ["Delivered", int(p.delivered)], ["CR %", pct(p.crPct)], ["DR %", pct(p.drPct)], ["NDR %", pct(p.ndrPct)], ["Delivered ASP", money(p.deliveredAsp)], ["Delivered GMV", money(p.deliveredGmv)], ["CM3", money(p.cm3)], ["CM3 %", pct(p.cm3Pct, 2)], ["Δ vs prev", p.deltaCm3Pct == null ? "—" : pct(p.deltaCm3Pct, 1)], ["Total PPM", money(p.ppm)], ["PPM / piece", money(p.ppmPerPiece)], ["Target PPM", p.targetPpm ? money(p.targetPpm) : "—"], ["PPM actual %", p.ppmActualPct == null ? "—" : pct(p.ppmActualPct, 0)], ["PPM / GMV", pct(p.ppmGmvRatio, 2)]];
    D.innerHTML = '<div class="tw-dback"></div><div class="tw-dpanel"><div class="tw-dhead"><div><h3>' + esc(p.skuName || p.sku) + '</h3><small>' + esc(p.sku) + ' · ' + esc(p.category) + '</small></div><button type="button" class="tw-dx">×</button></div><div class="tw-dbody"><div style="margin-bottom:12px">' + pill(p.status) + '</div><div class="tw-dstats">' + kv.map(function (k) { return '<div class="tw-dstat"><span>' + k[0] + '</span><b>' + k[1] + '</b></div>'; }).join("") + '</div></div></div>';
    document.body.appendChild(D);
    requestAnimationFrame(function () { D.classList.add("on"); });
    var close = function () { D.classList.remove("on"); setTimeout(function () { D.remove(); }, 200); };
    D.querySelector(".tw-dback").onclick = close; D.querySelector(".tw-dx").onclick = close;
  }

  /* hook the existing prepare so the new layer always refreshes with the data */
  function hook() {
    if (typeof prepareCm3AnalystProductsData === "function" && !window.__cxCm3Hooked) {
      window.__cxCm3Hooked = true;
      var o = prepareCm3AnalystProductsData;
      window.prepareCm3AnalystProductsData = function () { var r = o.apply(this, arguments); try { renderCm3New(); } catch (e) { console.warn(e); } return r; };
      var f = applyCm3apFilterAndSort;
      window.applyCm3apFilterAndSort = function () { var r = f.apply(this, arguments); try { renderCm3New(); } catch (e) {} return r; };
    }
  }
  hook();
})();
