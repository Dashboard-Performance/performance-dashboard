/* v1.19.0 — ML Forecast (Admin Panel, next to Forecast Model).
   The model runs every day in Python on GitHub Actions (ml-forecast/) and publishes to the Worker; this page only reads and shows it.
     Locked  = next month's number, frozen on the day that month started (cannot change afterwards)
     Live    = the forecast for the month after, re-made every day from everything known so far
     Pace    = where the running month is heading, from the month-to-date (vs the locked number)
   Nothing is calculated here except sums, ratios and sorting of what the model published. */
(function () {
  "use strict";
  var C = null, $ = function (id) { return document.getElementById(id); };
  var S = { data: null, err: "", empty: false, seg: "ALL", q: "", sort: "live", dir: -1, page: 0, host: null, bucket: "end", names: null, loading: false };
  var PAGE = 50;
  var MODEL_LABEL = { naive: "Last month", ma3: "3-mo avg", pace14: "Pace 14d", pace30: "Pace 30d", pace_mtd: "Pace MTD", gbm_l1: "GBM", gbm_tw: "GBM Tw", gbm_log: "GBM log", ens: "Ensemble" };
  var BUCKET_LABEL = { "7": "Day 7", "14": "Day 14", "21": "Day 21", "end": "Month end (locked)" };
  var MODEL_COLS = ["naive", "ma3", "pace14", "pace_mtd", "gbm_l1", "gbm_tw", "gbm_log", "ens"];

  function esc(v) { return C && C.esc ? C.esc(v) : String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function n0(v) { return v == null || isNaN(v) ? "—" : Math.round(v).toLocaleString("en-US"); }
  function pct(v, d) { return v == null || isNaN(v) ? "—" : (+v).toFixed(d == null ? 1 : d) + "%"; }
  function monthName(m) { if (!m) return "—"; var p = m.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }); }
  function css() {
    if ($("mlfCss")) return;
    var st = document.createElement("style"); st.id = "mlfCss";
    st.textContent =
      ".mlf-seg{display:inline-flex;gap:4px;padding:4px;border-radius:12px;background:var(--panel);border:1px solid var(--line)}" +
      ".mlf-seg button{border:0;background:transparent;color:var(--text2);padding:6px 12px;border-radius:9px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}.mlf-seg button.on{background:var(--accent);color:var(--accent-ink)}" +
      ".mlf-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin:14px 0}" +
      ".mlf-bar input{min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line-light,var(--line));background:var(--panel2,var(--panel));color:var(--text);font:inherit;font-size:13px;min-width:240px}" +
      ".mlf-t{width:100%;border-collapse:collapse;font-size:13px}.mlf-t th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--text-dim);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}" +
      ".mlf-t th.s{cursor:pointer}.mlf-t th.s:hover{color:var(--text)}.mlf-t td{padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent)}.mlf-t .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".mlf-t td.best{font-weight:800;color:var(--green)}.mlf-t td.champ{box-shadow:inset 0 -2px 0 var(--accent)}.mlf-sku b{display:block;font-weight:650}.mlf-sku span{color:var(--text-dim);font-size:11px}" +
      ".mlf-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:color-mix(in srgb,var(--text) 8%,transparent);color:var(--text2)}.mlf-pill.A{background:color-mix(in srgb,var(--green) 18%,transparent);color:var(--green)}.mlf-pill.B{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}" +
      ".mlf-up{color:var(--green)}.mlf-down{color:var(--red,#e5484d)}.mlf-dim{color:var(--text-dim)}.mlf-note{color:var(--text-dim);font-size:12.5px;line-height:1.55;margin:8px 2px}" +
      ".mlf-two{display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:14px;margin:14px 0}@media(max-width:1250px){.mlf-two{grid-template-columns:1fr}}" +
      ".mlf-empty{padding:28px 18px;color:var(--text-dim);font-size:14px;line-height:1.7}.mlf-empty code{background:color-mix(in srgb,var(--text) 8%,transparent);padding:1px 6px;border-radius:6px}" +
      ".mlf-pager{display:flex;gap:10px;align-items:center;justify-content:flex-end;padding-top:10px;font-size:13px;color:var(--text-dim)}";
    document.head.appendChild(st);
  }

  function nameMap() {
    if (S.names) return S.names;
    var m = {}; try { (state.debundleMap || []).forEach(function (r) { if (r.singleId && r.singleName && !m[r.singleId]) m[r.singleId] = r.singleName; if (r.productId && r.productName && !m[r.productId]) m[r.productId] = r.productName; }); } catch (e) {}
    return (S.names = m);
  }
  function load() {
    S.loading = true;
    return C.wfetch("mlGet", { timeout: 30000 }).then(function (j) { S.data = j; S.err = ""; S.empty = false; })
      .catch(function (e) { S.data = null; if (e && e.status === 404) { S.empty = true; S.err = ""; } else { S.empty = false; S.err = (e && e.message) || "Could not load the ML forecast."; } })
      .then(function () { S.loading = false; draw(); });
  }

  // ---- numbers derived from what the model published
  function rowsOf(D) {
    var live = (D.live && D.live.rows) || {}, lock = (D.locked && D.locked.rows) || {}, now = (D.nowcast && D.nowcast.rows) || {}, names = nameMap(), out = [], seen = {};
    function add(sku) {
      if (seen[sku]) return; seen[sku] = 1;
      var l = live[sku], k = lock[sku], c = now[sku];
      out.push({ sku: sku, name: names[sku] || "", seg: (l && l[3]) || (k && k[3]) || "C",
        live: l ? l[0] : 0, liveLo: l ? l[1] : 0, liveHi: l ? l[2] : 0,
        locked: k ? k[0] : null, lockLo: k ? k[1] : null, lockHi: k ? k[2] : null,
        mtd: c ? c[0] : null, eom: c ? c[1] : null,
        pace: (k && c && k[0] > 0) ? (c[1] / k[0] - 1) * 100 : null });
    }
    Object.keys(live).forEach(add); Object.keys(lock).forEach(add); Object.keys(now).forEach(add);
    return out;
  }
  function sum(rows, k) { var s = 0, any = false; rows.forEach(function (r) { if (r[k] != null) { s += r[k]; any = true; } }); return any ? s : null; }

  function draw() {
    var host = S.host; if (!host) return; css();
    if (S.loading && !S.data) { host.innerHTML = '<div class="tw-page"><div class="tw-card tw-muted">Loading…</div></div>'; return; }
    if (S.err) { host.innerHTML = '<div class="tw-page"><div class="tw-card"><div class="mlf-empty">' + esc(S.err) + '<br><span class="ul-link" id="mlfRetry" style="cursor:pointer;color:var(--accent);font-weight:600">Try again</span></div></div></div>'; var rt = $("mlfRetry"); if (rt) rt.onclick = function () { S.loading = true; draw(); load(); }; return; }
    if (S.empty || !S.data) {
      host.innerHTML = '<div class="tw-page"><div class="tw-card"><div class="mlf-empty"><b>The model has not published anything yet.</b><br>It runs on GitHub Actions every day (<code>ML Forecast</code> workflow in the <code>taager-ml-forecast</code> repo) and sends its result here. ' +
        'Run the workflow once by hand (Actions → ML Forecast → Run workflow) and refresh this page.</div></div></div>'; return;
    }
    var D = S.data, rows = rowsOf(D), seg = S.seg === "ALL" ? rows : rows.filter(function (r) { return r.seg === S.seg; });
    var acc = (D.accuracy && D.accuracy.next) || {}, la = D.lockedAccuracy || [], lastLA = la.length ? la[la.length - 1] : null;
    var liveTot = sum(seg, "live"), lockTot = sum(seg, "locked"), mtdTot = sum(seg, "mtd"), eomTot = sum(seg, "eom");
    var paceTot = lockTot && eomTot != null ? (eomTot / lockTot - 1) * 100 : null;
    var endAll = (acc["end"] || {})["ALL"] || {}, ch = D.live && D.live.champion || {};
    var tile = function (l, v, sub, cls) { return '<div class="tw-stat"><span>' + l + '</span><b class="' + (cls || "") + '">' + v + '</b><small class="mlf-dim">' + (sub || "") + '</small></div>'; };
    var h = '<div class="tw-page">';
    h += '<div class="mlf-bar"><div class="mlf-seg">' + ["ALL", "A", "B", "C"].map(function (s) { return '<button data-seg="' + s + '" class="' + (S.seg === s ? "on" : "") + '">' + (s === "ALL" ? "All SKUs" : "Segment " + s) + '</button>'; }).join("") + '</div>' +
      '<span class="mlf-dim" style="font-size:12.5px">Data up to <b>' + esc(D.asOf) + '</b> · model published ' + esc(String(D.generatedAt || "").replace("T", " ").replace("Z", " UTC")) + '</span></div>';
    h += '<div class="tw-stats">' +
      tile("Locked · " + monthName(D.currentMonth), lockTot == null ? "—" : n0(lockTot), D.locked ? "frozen " + esc(D.locked.frozenAt || "") + " · cannot change" : "no frozen number for this month") +
      tile("Month-to-date", mtdTot == null ? "—" : n0(mtdTot), "day " + (D.dayOfMonth || "?") + " of " + (D.daysInMonth || "?")) +
      tile("Pace → month end", eomTot == null ? "—" : n0(eomTot), paceTot == null ? "" : '<span class="' + (paceTot >= 0 ? "mlf-up" : "mlf-down") + '">' + (paceTot >= 0 ? "+" : "") + pct(paceTot) + ' vs locked</span>') +
      tile("Live · " + monthName(D.targetMonth), n0(liveTot), "updated daily · locks on the 1st") + '</div>';
    h += '<p class="mlf-note">Pieces = confirmed pieces per Single SKU (bundles split), the same unit as the Forecast Model. “Locked” is the number frozen on the day the month began; “Live” is today’s forecast for the month after it. ' +
      'P10–P90 is a band built from this model’s own past mistakes — about 8 in 10 SKUs should land inside it' + (D.accuracy && D.accuracy.coverageP10P90 != null ? " (checked on last month: " + pct(D.accuracy.coverageP10P90, 0) + ")" : "") + '.</p>';
    // accuracy
    h += '<div class="mlf-two"><div class="tw-card"><div class="tw-card-h"><b>Backtest accuracy</b><span class="mlf-dim"> · 1 − WAPE, each past month forecast as it would have been on that day of the month before</span></div>' + accTable(acc, S.seg, ch) + '</div>';
    h += '<div class="tw-card"><div class="tw-card-h"><b>Frozen forecasts vs what happened</b></div>' + lockedTable(la) + '</div></div>';
    // per SKU table
    var q = S.q.trim().toLowerCase(), list = seg.filter(function (r) { return !q || r.sku.toLowerCase().indexOf(q) >= 0 || r.name.toLowerCase().indexOf(q) >= 0; });
    list.sort(function (a, b) { var x = a[S.sort], y = b[S.sort]; if (typeof x === "string" || typeof y === "string") return S.dir * String(x || "").localeCompare(String(y || "")); return S.dir * ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)); });
    var pages = Math.max(1, Math.ceil(list.length / PAGE)); if (S.page >= pages) S.page = pages - 1;
    var th = function (k, l, num) { return '<th class="s' + (num ? " num" : "") + '" data-sort="' + k + '">' + l + (S.sort === k ? (S.dir < 0 ? " ↓" : " ↑") : "") + '</th>'; };
    h += '<div class="tw-card"><div class="mlf-bar" style="margin-top:0"><b>Per SKU</b><span><input id="mlfQ" placeholder="Search SKU or name…" value="' + esc(S.q) + '"> <button class="btn btn-outline small" id="mlfExp">Export CSV</button></span></div>' +
      '<div class="table-responsive"><table class="mlf-t"><thead><tr>' + th("sku", "SKU") + th("seg", "Seg") + th("locked", "Locked · " + monthName(D.currentMonth).split(" ")[0], 1) + th("mtd", "MTD", 1) + th("eom", "Pace → end", 1) + th("pace", "vs locked", 1) +
      th("live", "Live · " + monthName(D.targetMonth).split(" ")[0], 1) + '<th class="num">P10 – P90</th></tr></thead><tbody>' +
      list.slice(S.page * PAGE, S.page * PAGE + PAGE).map(function (r) {
        return '<tr><td class="mlf-sku"><b>' + esc(r.name || r.sku) + '</b><span>' + (r.name ? esc(r.sku) : "") + '</span></td><td><span class="mlf-pill ' + r.seg + '">' + r.seg + '</span></td>' +
          '<td class="num">' + n0(r.locked) + '</td><td class="num">' + n0(r.mtd) + '</td><td class="num">' + n0(r.eom) + '</td>' +
          '<td class="num ' + (r.pace == null ? "" : r.pace >= 0 ? "mlf-up" : "mlf-down") + '">' + (r.pace == null ? "—" : (r.pace >= 0 ? "+" : "") + pct(r.pace, 0)) + '</td>' +
          '<td class="num"><b>' + n0(r.live) + '</b></td><td class="num mlf-dim">' + n0(r.liveLo) + ' – ' + n0(r.liveHi) + '</td></tr>';
      }).join("") + (list.length ? "" : '<tr><td colspan="8" class="mlf-empty">Nothing matches.</td></tr>') + '</tbody></table></div>' +
      '<div class="mlf-pager"><span>' + n0(list.length) + ' SKUs</span><button class="btn btn-outline small" id="mlfPrev"' + (S.page ? "" : " disabled") + '>Prev</button><span>Page ' + (S.page + 1) + ' of ' + pages + '</span><button class="btn btn-outline small" id="mlfNext"' + (S.page < pages - 1 ? "" : " disabled") + '>Next</button></div></div>';
    h += '<p class="mlf-note">Data used: ' + esc(dataLine(D)) + '. Model: ' + esc(Object.keys(ch).map(function (s) { return "segment " + s + " → " + (MODEL_LABEL[ch[s]] || ch[s]); }).join(" · ")) + ' (the candidate with the best accuracy over the last finished months). Trained on ' + ((D.live && D.live.train && D.live.train.months) || "?") + ' finished months.</p></div>';
    var keepFocus = document.activeElement && document.activeElement.id === "mlfQ", caret = keepFocus ? document.activeElement.selectionStart : 0;
    host.innerHTML = h; wire(D, list);
    if (keepFocus) { var qi = $("mlfQ"); qi.focus(); try { qi.setSelectionRange(caret, caret); } catch (e) {} }
  }
  function dataLine(D) { var d = D.data || {}, a = []; if (d.skus != null) a.push(n0(d.skus) + " Single SKUs"); if (d.firstDay) a.push("daily from " + d.firstDay); if (d.categories === false) a.push("no categories"); if (d.prices === false) a.push("no price history"); return a.length ? a.join(", ") : "daily confirmed pieces per Single SKU"; }

  function accTable(acc, segKey, champ) {
    var b = Object.keys(acc).length; if (!b) return '<div class="mlf-empty">Not enough finished months to run a backtest yet.</div>';
    var order = ["7", "14", "21", "end"].filter(function (k) { return acc[k]; });
    var h = '<div class="table-responsive"><table class="mlf-t"><thead><tr><th>Forecast made on</th>' + MODEL_COLS.map(function (k) { return '<th class="num">' + MODEL_LABEL[k] + '</th>'; }).join("") + '</tr></thead><tbody>';
    order.forEach(function (bk) {
      var r = acc[bk][segKey] || {}, best = -1e9, bk2 = ""; MODEL_COLS.forEach(function (k) { if (r[k] != null && r[k] > best) { best = r[k]; bk2 = k; } });
      var cm = segKey === "ALL" ? null : champ[segKey];
      h += '<tr><td>' + (BUCKET_LABEL[bk] || bk) + ' <span class="mlf-dim">· n=' + n0(r.n) + '</span></td>' + MODEL_COLS.map(function (k) { return '<td class="num' + (k === bk2 ? " best" : "") + (k === cm ? " champ" : "") + '">' + (r[k] == null ? "—" : pct(r[k])) + '</td>'; }).join("") + '</tr>';
    });
    return h + '</tbody></table></div><p class="mlf-note">Green = best on that row. Underlined = the model currently used for this segment. Accuracy = 1 − (total absolute error ÷ total actual pieces). Every past month is forecast using only what was known on that day, never later.</p>';
  }
  function lockedTable(la) {
    if (!la.length) return '<div class="mlf-empty">Nothing to score yet: a frozen forecast is scored once its month has finished. The first one is frozen on the 1st of the next month.</div>';
    return '<div class="table-responsive"><table class="mlf-t"><thead><tr><th>Month</th><th class="num">Forecast</th><th class="num">Actual</th><th class="num">ML</th><th class="num">Last month</th><th class="num">Bias</th></tr></thead><tbody>' +
      la.slice().reverse().map(function (r) { return '<tr><td>' + esc(monthName(r.month)) + '</td><td class="num">' + n0(r.forecast) + '</td><td class="num">' + n0(r.actual) + '</td><td class="num"><b>' + pct(r.ml) + '</b></td><td class="num mlf-dim">' + pct(r.naive) + '</td><td class="num ' + (r.bias >= 0 ? "mlf-up" : "mlf-down") + '">' + (r.bias >= 0 ? "+" : "") + pct(r.bias) + '</td></tr>'; }).join("") + '</tbody></table></div>';
  }

  function wire(D, list) {
    var host = S.host;
    host.querySelectorAll("[data-seg]").forEach(function (b) { b.onclick = function () { S.seg = b.dataset.seg; S.page = 0; draw(); }; });
    host.querySelectorAll("[data-sort]").forEach(function (t) { t.onclick = function () { var k = t.dataset.sort; if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = k === "sku" || k === "seg" ? 1 : -1; } S.page = 0; draw(); }; });
    var q = $("mlfQ"); if (q) q.oninput = function (e) { S.q = e.target.value; S.page = 0; draw(); };
    var p = $("mlfPrev"), n = $("mlfNext"); if (p) p.onclick = function () { S.page = Math.max(0, S.page - 1); draw(); }; if (n) n.onclick = function () { S.page++; draw(); };
    var ex = $("mlfExp"); if (ex) ex.onclick = function () {
      var cell = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
      var lines = ["SKU,Name,Segment,Locked " + D.currentMonth + ",MTD,Pace to month end,Pace vs locked %,Live " + D.targetMonth + ",P10,P90"];
      list.forEach(function (r) { lines.push([r.sku, r.name, r.seg, r.locked, r.mtd, r.eom, r.pace == null ? "" : r.pace.toFixed(1), r.live, r.liveLo, r.liveHi].map(cell).join(",")); });
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })); a.download = "ml-forecast-" + D.asOf + ".csv"; document.body.appendChild(a); a.click(); a.remove();
    };
  }
  function render(host) { css(); S.host = host; S.names = null; if (!S.data) host.innerHTML = '<div class="tw-page"><div class="tw-card tw-muted">Loading…</div></div>'; else draw(); load(); }

  function boot() {
    C = window.TowerCore; var ready = false; try { ready = typeof state !== "undefined"; } catch (e) {}
    if (!C || !ready) { setTimeout(boot, 300); return; }
    C.registerView("mlForecast", { sectionId: "viewMlForecast", navId: "navMlForecast", label: "ML Forecast", sub: "A model that learns every day · next month locks on the 1st", open: true, render: render });
    var nav = $("navMlForecast"); if (nav && !nav.__mlf) { nav.__mlf = 1; nav.addEventListener("click", function () { window.switchView("mlForecast"); }); }
  }
  window.MlForecast = { rowsOf: rowsOf, state: S };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 180); }); else setTimeout(boot, 180);
})();
