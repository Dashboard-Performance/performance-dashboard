/* Account Manager → Daily Orders (v1.18.0)
   The "ACC-manager-Daily-Orders-Merchants" view, built from the Merchant Only query (state.merchantOnlyRows: one row per DAY x merchant x ACC_MANAGER,
   Egypt, current month + the whole previous month). Nothing else is read except Merchant Targets for the goal.
     • Rows = merchants, columns = days, cell = Placed Orders of that merchant on that day. No row for that merchant on that day = a blank (dark) cell, a row with 0 = 0.
     • Day columns = every calendar day from From to To (To stops at the latest day the query holds, that day can still be incomplete).
     • AVG_DAILY = Row total ÷ number of day columns (a merchant that sold on 8 of 15 days is divided by 15, like the Metabase view).
     • DAILY_GOAL = the merchant's Target Placed (Merchant Targets, monthly) ÷ days in the month of To — the same target ÷ days-in-month
       convention the dashboard uses for its MTD targets. A merchant without a target shows a blank.
     • Merchant's ACM = the ACC_MANAGER on its latest day in the selection. Colour = red (lowest cell) → green (highest cell) over all merchants in the selection.
     • Grand totals = sum over every merchant that passes the filters (not only the page shown); its AVG_DAILY = grand total ÷ day columns. */
(function () {
  "use strict";
  var VIEW = "acmDailyOrders", PAGE = 50, DAY = 86400000;
  var AD = { from: "", to: "", acm: "", q: "", sort: "total", dir: -1, page: 0 };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v) { return v == null || !isFinite(v) ? "" : Math.round(+v).toLocaleString("en-US"); }
  function dec(v) { return v == null || !isFinite(v) ? "" : (+v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function st() { try { return state; } catch (e) { return {}; } }
  function rowsNow() { return st().merchantOnlyRows || []; }
  function sig() { var a = rowsNow(), t = st().merchantTargets || {}; return a.length + ":" + (a[0] && a[0].ts) + ":" + (a[a.length - 1] && a[a.length - 1].ts) + ":" + Object.keys(t).length; }

  function css() {
    if ($("acmdStyle")) return;
    var s = document.createElement("style"); s.id = "acmdStyle";
    s.textContent =
      ".acmd-wrap{overflow:auto;max-height:calc(100vh - 330px);min-height:240px;border-top:1px solid var(--line)}" +
      ".acmd-table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%}" +
      ".acmd-table th,.acmd-table td{padding:9px 10px;font-size:12px;border-bottom:1px solid var(--line);border-right:1px solid rgba(127,127,127,.12);white-space:nowrap}" +
      ".acmd-table thead th{position:sticky;top:0;z-index:3;background:var(--gl-card-strong,var(--panel));color:var(--text-dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;cursor:pointer;user-select:none;text-align:right}" +
      ".acmd-table thead th:hover{color:var(--text)} .acmd-table thead th.sorted{color:var(--blue)}" +
      ".acmd-table .l{text-align:left} .acmd-table .n{text-align:right;font-variant-numeric:tabular-nums}" +
      ".acmd-table .s0,.acmd-table .s1,.acmd-table .s2,.acmd-table .s3,.acmd-table .s4{position:sticky;z-index:2;background:var(--gl-card-strong,var(--panel))}" +
      ".acmd-table thead .s0,.acmd-table thead .s1,.acmd-table thead .s2,.acmd-table thead .s3,.acmd-table thead .s4{z-index:4}" +
      ".acmd-table .s0{left:0;min-width:84px;max-width:84px}.acmd-table .s1{left:84px;min-width:170px;max-width:170px;overflow:hidden;text-overflow:ellipsis}" +
      ".acmd-table .s2{left:254px;min-width:84px}.acmd-table .s3{left:338px;min-width:84px;border-right:2px solid var(--line-light)}" +
      ".acmd-table .tot{font-weight:700;background:rgba(59,130,246,.10)}" +
      ".acmd-table .d{min-width:62px;text-align:right;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.35)}" +
      ".acmd-table .d.e{background:rgba(0,0,0,.28);color:transparent;text-shadow:none}" +
      "html[data-theme=light] .acmd-table .d{color:#0b1220;text-shadow:none}" +
      ".acmd-table tbody tr:hover td:not(.d){background:rgba(59,130,246,.10)}" +
      ".acmd-table tfoot td{position:sticky;bottom:0;z-index:2;background:var(--gl-card-strong,var(--panel));font-weight:800;border-top:2px solid var(--line-light)}" +
      ".acmd-table tfoot td.s0,.acmd-table tfoot td.s1,.acmd-table tfoot td.s2,.acmd-table tfoot td.s3{z-index:5}" +
      ".acmd-legend{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-dim)} .acmd-legend i{display:inline-block;width:120px;height:8px;border-radius:99px;background:linear-gradient(90deg,rgba(239,68,68,.75),rgba(148,163,184,.55),rgba(16,185,129,.8))}";
    document.head.appendChild(s);
  }

  // red (low) -> slate (middle) -> green (high)
  function heat(v, lo, hi) {
    var t = hi > lo ? (v - lo) / (hi - lo) : 0.5, a, b, k;
    var R = [239, 68, 68, 0.78], M = [148, 163, 184, 0.5], G = [16, 185, 129, 0.82];
    if (t < 0.5) { a = R; b = M; k = t / 0.5; } else { a = M; b = G; k = (t - 0.5) / 0.5; }
    var c = a.map(function (x, i) { return x + (b[i] - x) * k; });
    return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + c[3].toFixed(2) + ")";
  }

  function bounds() {
    var rows = rowsNow(), mn = Infinity, mx = -Infinity;
    rows.forEach(function (r) { if (r.ts < mn) mn = r.ts; if (r.ts > mx) mx = r.ts; });
    return rows.length ? { min: mn, max: mx } : null;
  }

  function compute() {
    var rows = rowsNow(), B = bounds(); if (!B) return null;
    var minD = new Date(B.min), maxD = new Date(B.max);
    var from = parseYmd(AD.from) || new Date(maxD.getFullYear(), maxD.getMonth(), 1), to = parseYmd(AD.to) || maxD;
    if (from.getTime() < B.min) from = minD; if (to.getTime() > B.max) to = maxD; if (from.getTime() > to.getTime()) from = to;
    var days = []; for (var t = from.getTime(); t <= to.getTime(); t += DAY) { var d = new Date(t); d.setHours(0, 0, 0, 0); days.push({ ts: d.getTime(), key: ymd(d) }); }
    var idx = {}; days.forEach(function (d, i) { idx[d.key] = i; });
    var M = {}, tg = st().merchantTargets || {}, dim = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
    rows.forEach(function (r) {
      var i = idx[r.day]; if (i == null) return;
      var m = M[r.merchantId]; if (!m) { m = M[r.merchantId] = { id: r.merchantId, name: "", acm: "", acmDay: -1, cells: new Array(days.length).fill(null), total: 0 }; }
      m.cells[i] = (m.cells[i] || 0) + (r.placedOrders || 0); m.total += r.placedOrders || 0;
      if (r.merchantName) m.name = r.merchantName;
      if (r.acmName && i >= m.acmDay) { m.acm = r.acmName; m.acmDay = i; }
    });
    var list = Object.keys(M).map(function (k) {
      var m = M[k], tgt = tg[m.id] && tg[m.id].placed > 0 ? tg[m.id].placed : null;
      m.acm = m.acm || "Unassigned"; m.name = m.name || (tg[m.id] && tg[m.id].name) || m.id; m.avg = days.length ? m.total / days.length : null; m.goal = tgt ? tgt / dim : null;
      return m;
    });
    var acms = {}; list.forEach(function (m) { acms[m.acm] = 1; });
    return { days: days, list: list, acms: Object.keys(acms).sort(function (a, b) { return a.localeCompare(b); }), from: from, to: to, min: minD, max: maxD, dim: dim };
  }

  function filtered(d) {
    var q = AD.q.trim().toLowerCase();
    var L = d.list.filter(function (m) { return (!AD.acm || m.acm === AD.acm) && (!q || m.id.toLowerCase().indexOf(q) >= 0 || String(m.name).toLowerCase().indexOf(q) >= 0); });
    var k = AD.sort, dir = AD.dir;
    L.sort(function (a, b) {
      var x, y; if (k.indexOf("d:") === 0) { var i = +k.slice(2); x = a.cells[i]; y = b.cells[i]; } else { x = a[k]; y = b[k]; }
      if (typeof x === "string" || typeof y === "string") return dir * String(x || "").localeCompare(String(y || ""), undefined, { numeric: true });
      return dir * ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)) || String(a.name).localeCompare(String(b.name));
    });
    return L;
  }

  function dlab(ts) { return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  function dfull(ts) { return new Date(ts).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); }

  function render(host) {
    css();
    var d = compute();
    if (!d) { host.innerHTML = '<div class="panel" style="padding:18px"><h3 style="margin:0 0 6px">Daily Orders</h3><p class="text-dim" style="margin:0">Waiting for the Merchant Only query… it appears here as soon as the data has loaded.</p></div>'; watch(host); return; }
    var L = filtered(d), nd = d.days.length, pages = Math.max(1, Math.ceil(L.length / PAGE)); if (AD.page >= pages) AD.page = pages - 1; if (AD.page < 0) AD.page = 0;
    var tot = { cells: new Array(nd).fill(0), total: 0, goal: 0, goals: 0 }, lo = Infinity, hi = -Infinity;
    L.forEach(function (m) { m.cells.forEach(function (v, i) { if (v != null) { tot.cells[i] += v; if (v < lo) lo = v; if (v > hi) hi = v; } }); tot.total += m.total; if (m.goal != null) { tot.goal += m.goal; tot.goals++; } });
    var peak = -1, peakI = -1; tot.cells.forEach(function (v, i) { if (v > peak) { peak = v; peakI = i; } });
    var page = L.slice(AD.page * PAGE, AD.page * PAGE + PAGE);
    var tiles = [["Merchants", L.length.toLocaleString("en-US"), AD.acm ? esc(AD.acm) : d.acms.length + " ACMs"], ["Placed Orders", int(tot.total), dlab(d.days[0].ts) + " – " + dlab(d.days[nd - 1].ts)],
      ["Avg / Day", int(nd ? tot.total / nd : 0), nd + " days"], ["Peak Day", peakI >= 0 ? int(peak) : "—", peakI >= 0 ? dlab(d.days[peakI].ts) : ""],
      ["Daily Goal", tot.goals ? int(tot.goal) : "—", tot.goals ? tot.goals + " merchants with a target" : "no targets loaded"]];
    var acmOpts = '<option value="">All ACMs</option>' + d.acms.map(function (n) { return '<option value="' + esc(n) + '"' + (AD.acm === n ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("");
    var arrow = function (k) { return AD.sort === k ? (AD.dir < 0 ? " ↓" : " ↑") : ""; };
    var th = function (k, label, cls, title) { return '<th class="' + cls + (AD.sort === k ? " sorted" : "") + '" data-s="' + k + '"' + (title ? ' title="' + esc(title) + '"' : "") + '>' + label + arrow(k) + '</th>'; };
    var head = '<tr>' + th("id", "Tager ID", "s0 l") + th("name", "Tager Name", "s1 l") + th("avg", "Avg Daily", "s2", "Row total ÷ the " + nd + " day columns.") +
      th("goal", "Daily Goal", "s3", "Target Placed (Merchant Targets) ÷ " + d.dim + " days in the month. Blank = no target.") +
      d.days.map(function (x, i) { return th("d:" + i, dlab(x.ts), "d-h", dfull(x.ts)); }).join("") + th("total", "Row Total", "") + '</tr>';
    var body = page.map(function (m) {
      return '<tr><td class="s0 l font-mono text-dim">' + esc(m.id) + '</td><td class="s1 l font-bold" title="' + esc(m.name + " · " + m.acm) + '">' + esc(m.name) + '</td><td class="s2 n">' + dec(m.avg) + '</td><td class="s3 n">' + (m.goal != null ? int(m.goal) : "") + '</td>' +
        m.cells.map(function (v) { return v == null ? '<td class="d e">·</td>' : '<td class="d" style="background:' + heat(v, lo, hi) + '">' + int(v) + '</td>'; }).join("") + '<td class="n tot">' + int(m.total) + '</td></tr>';
    }).join("") || '<tr><td class="l text-dim" colspan="' + (nd + 5) + '" style="text-align:center;padding:22px">No merchants for this selection.</td></tr>';
    var foot = '<tr><td class="s0 l" colspan="2">Grand totals' + (L.length > page.length ? ' <span class="text-dim" style="font-weight:500">(all ' + L.length.toLocaleString("en-US") + ')</span>' : "") + '</td><td class="s2 n">' + dec(nd ? tot.total / nd : null) + '</td><td class="s3 n">' + (tot.goals ? int(tot.goal) : "") + '</td>' +
      tot.cells.map(function (v) { return '<td class="n">' + int(v) + '</td>'; }).join("") + '<td class="n tot">' + int(tot.total) + '</td></tr>';
    host.innerHTML = '<div class="panel table-panel hover-glow">' +
      '<div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Daily Orders — Merchants</h2><p>Placed Orders per merchant per day · ' + esc(dlab(d.days[0].ts)) + ' – ' + esc(dlab(d.days[nd - 1].ts)) + ' · Merchant Only query · the latest day can still be incomplete</p></div>' +
      '<div class="table-controls" style="gap:8px;flex-wrap:wrap"><label class="text-dim" style="font-size:12px">From <input id="acmdFrom" type="date" class="date-filter-input" min="' + ymd(d.min) + '" max="' + ymd(d.max) + '" value="' + ymd(d.from) + '"></label>' +
      '<label class="text-dim" style="font-size:12px">To <input id="acmdTo" type="date" class="date-filter-input" min="' + ymd(d.min) + '" max="' + ymd(d.max) + '" value="' + ymd(d.to) + '"></label>' +
      '<select id="acmdAcm" class="date-filter-input" title="Account Manager">' + acmOpts + '</select>' +
      '<input id="acmdQ" type="search" class="date-filter-input" style="min-width:190px" placeholder="Tager ID or name" value="' + esc(AD.q) + '" autocomplete="off">' +
      '<button class="btn btn-outline small" id="acmdCsv">Export CSV</button></div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' +
      '<div style="display:flex;justify-content:flex-end;padding:0 18px 8px"><div class="acmd-legend"><span>' + int(lo === Infinity ? 0 : lo) + '</span><i></i><span>' + int(hi === -Infinity ? 0 : hi) + '</span></div></div>' +
      '<div class="acmd-wrap"><table class="acmd-table" id="acmdTable"><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      '<div class="table-footer"><span>' + L.length.toLocaleString("en-US") + ' merchants</span><div class="pager"><button id="acmdPrev" class="btn btn-outline small"' + (AD.page === 0 ? " disabled" : "") + '>Prev</button><span>Page ' + (AD.page + 1) + ' of ' + pages + '</span><button id="acmdNext" class="btn btn-outline small"' + (AD.page >= pages - 1 ? " disabled" : "") + '>Next</button></div></div></div>';
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("acmdFrom", "change", function (e) { AD.from = e.target.value; AD.page = 0; render(host); }); on("acmdTo", "change", function (e) { AD.to = e.target.value; AD.page = 0; render(host); });
    on("acmdAcm", "change", function (e) { AD.acm = e.target.value; AD.page = 0; render(host); });
    on("acmdQ", "input", function (e) { AD.q = e.target.value; AD.page = 0; render(host); var el = host.querySelector("#acmdQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    on("acmdPrev", "click", function () { AD.page--; render(host); }); on("acmdNext", "click", function () { AD.page++; render(host); });
    host.querySelectorAll("[data-s]").forEach(function (h) { h.addEventListener("click", function () { var k = h.dataset.s; if (AD.sort === k) AD.dir = -AD.dir; else { AD.sort = k; AD.dir = (k === "id" || k === "name") ? 1 : -1; } AD.page = 0; render(host); }); });
    on("acmdCsv", "click", function () {
      var r2 = function (v) { return v == null || !isFinite(v) ? "" : Math.round(v * 100) / 100; };
      var lines = [["Tager ID", "Tager Name", "ACM", "Avg Daily", "Daily Goal"].concat(d.days.map(function (x) { return x.key; })).concat(["Row Total"])]
        .concat(L.map(function (m) { return [m.id, m.name, m.acm, r2(m.avg), r2(m.goal)].concat(m.cells.map(function (v) { return v == null ? "" : v; })).concat([m.total]); }))
        .concat([["Grand totals", "", "", r2(nd ? tot.total / nd : null), tot.goals ? r2(tot.goal) : ""].concat(tot.cells).concat([tot.total])]);
      var csv = "﻿" + lines.map(function (l) { return l.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "daily-orders-merchants.csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
    watch(host);
  }

  var watchT = 0, lastSig = "";
  function watch(host) {
    clearInterval(watchT); lastSig = sig();
    watchT = setInterval(function () {
      var sec = $("viewAcmDailyOrders"); if (!sec || sec.classList.contains("hidden")) { clearInterval(watchT); return; }
      if (sig() !== lastSig) render(host);
    }, 1500);
  }
  window.TaagerAcmDaily = { state: AD, compute: compute, filtered: function () { var d = compute(); return d ? filtered(d) : []; } };

  function boot() {
    var C = window.TowerCore; if (!C || !C.registerView) { setTimeout(boot, 300); return; }
    C.registerView(VIEW, { sectionId: "viewAcmDailyOrders", navId: "navAcmDailyOrders", label: "Daily Orders", sub: "Placed Orders per merchant per day · Merchant Only", open: true, render: render });
    var nav = $("navAcmDailyOrders"); if (nav && !nav.dataset.ad) { nav.dataset.ad = "1"; nav.addEventListener("click", function () { window.switchView(VIEW); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 160); }); else setTimeout(boot, 160);
})();
