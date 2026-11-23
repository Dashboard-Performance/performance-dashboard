/* Account Manager → Daily Orders (v1.18.0)
   The "ACC-manager-Daily-Orders-Merchants" view, built from the Merchant Only query (state.merchantOnlyRows: one row per DAY x merchant x ACC_MANAGER,
   Egypt, current month + the whole previous month). Nothing else is read except Merchant Targets for the goal.
     • Rows = merchants, columns = days, cell = Placed Orders of that merchant on that day. No row for that merchant on that day = a blank (dark) cell, a row with 0 = 0.
     • Day columns = every calendar day from From to To (To stops at the latest day the query holds, that day can still be incomplete).
     • AVG_DAILY = Row total ÷ number of day columns (a merchant that sold on 8 of 15 days is divided by 15, like the Metabase view).
     • DAILY_GOAL = the merchant's Target Placed (Merchant Targets, monthly) ÷ days in the month of To — the same target ÷ days-in-month
       convention the dashboard uses for its MTD targets. A merchant without a target shows a blank.
     • Merchant's ACM = the ACC_MANAGER on its latest day in the selection. Colour (v1.18.3) = the day vs that merchant's own Daily Goal: ≥ 100% green, 80–99% amber, < 80% red;
       no target → vs its own Avg Daily; today's (incomplete) column is not coloured.
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
  // v1.18.1 - the signature includes the Placed Orders total, so a new order redraws the page even when the number of rows did not change
  function sig() { var a = rowsNow(), t = st().merchantTargets || {}, s = 0; for (var i = 0; i < a.length; i++) s += a[i].placedOrders || 0; return a.length + ":" + (a[0] && a[0].ts) + ":" + (a[a.length - 1] && a[a.length - 1].ts) + ":" + s + ":" + Object.keys(t).length; }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function asOfText() {
    var L = st().merchantOnlyLiveAt; if (!L) return "checking…";
    var d = new Date(L.at), t = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    if (L.source === "cache") return "⚠ Metabase did not answer — showing the last saved copy (checked " + t + ")";
    return "Live · checked " + t + " · refreshes every minute";
  }

  function css() {
    if ($("acmdStyle")) return;
    var s = document.createElement("style"); s.id = "acmdStyle";
    s.textContent =
      ".acmd-wrap{width:100%;border-top:1px solid var(--line)}" +
      ".acmd-table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed}" +
      ".acmd-table th,.acmd-table td{padding:8px 3px;font-size:12px;border-bottom:1px solid var(--line);border-right:1px solid rgba(127,127,127,.12);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".acmd-table thead th{color:var(--text-dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;cursor:pointer;user-select:none;text-align:right;background:rgba(127,127,127,.06)}" +
      ".acmd-table thead th:hover{color:var(--text)} .acmd-table thead th.sorted{color:var(--blue)}" +
      ".acmd-table .l{text-align:left;padding-left:10px} .acmd-table .n{text-align:right;font-variant-numeric:tabular-nums;padding-right:8px}" +
      ".acmd-table .c-id{width:72px}.acmd-table .c-name{width:150px}.acmd-table .c-avg{width:74px}.acmd-table .c-goal{width:78px}.acmd-table .c-tot{width:84px}" +
      ".acmd-table .sep{border-right:2px solid var(--line-light)}" +
      ".acmd-table .tot{font-weight:700;background:rgba(59,130,246,.10)}" +
      ".acmd-table .d{text-align:right;padding-right:6px;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.35)}" +
      ".acmd-table .d.e{background:rgba(0,0,0,.28);color:transparent;text-shadow:none}" +
      "html[data-theme=light] .acmd-table .d{color:#0b1220;text-shadow:none}" +
      ".acmd-table tbody tr:hover td:not(.d){background-image:linear-gradient(rgba(59,130,246,.12),rgba(59,130,246,.12))}" +
      ".acmd-table tfoot td{font-weight:800;border-top:2px solid var(--line-light);background:rgba(127,127,127,.06)}" +
      /* the table is sized to fit the screen: fewer columns / smaller type / k-numbers as the width gets tighter */
      ".acmd-tight .acmd-table th,.acmd-tight .acmd-table td{font-size:11px}.acmd-tight .acmd-table .d{padding-right:4px}" +
      ".acmd-dense .acmd-table th,.acmd-dense .acmd-table td{font-size:10.5px}.acmd-dense .acmd-table .d{padding-right:3px}" +
      ".acmd-dense .acmd-table .c-id,.acmd-dense .acmd-table .s0{display:none}.acmd-dense .acmd-table .c-name{width:118px}.acmd-dense .acmd-table .c-avg{width:66px}.acmd-dense .acmd-table .c-goal{width:48px}.acmd-dense .acmd-table .c-tot{width:66px}" +
      ".acmd-micro .acmd-table th,.acmd-micro .acmd-table td{font-size:9.5px}.acmd-micro .acmd-table .d{padding:8px 2px}.acmd-micro .acmd-table .l{padding-left:6px}.acmd-micro .acmd-table .n{padding-right:4px}" +
      ".acmd-micro .acmd-table .c-id,.acmd-micro .acmd-table .s0,.acmd-micro .acmd-table .c-goal,.acmd-micro .acmd-table .s3{display:none}.acmd-micro .acmd-table .c-name{width:96px}.acmd-micro .acmd-table .c-avg{width:58px}.acmd-micro .acmd-table .c-tot{width:58px}" +
      ".acmd-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}.acmd-scroll .acmd-table{table-layout:auto;width:max-content;min-width:100%}" +
      ".acmd-scroll .acmd-table .c-id,.acmd-scroll .acmd-table .s0{display:none}.acmd-scroll .acmd-table th,.acmd-scroll .acmd-table td{font-size:10.5px}" +
      ".acmd-scroll .acmd-table .d,.acmd-scroll .acmd-table .d-h{min-width:40px}.acmd-scroll .acmd-table .s1{position:sticky;left:0;z-index:2;min-width:118px;max-width:118px;background-color:#101826;box-shadow:6px 0 8px -6px rgba(0,0,0,.55)}" +
      "html[data-theme=light] .acmd-scroll .acmd-table .s1{background-color:#eef2f8;box-shadow:6px 0 8px -6px rgba(30,50,90,.35)}" +
      ".acmd-scroll .acmd-table thead .s1{z-index:3}" +
      ".acmd-legend{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-dim)} .acmd-legend i{display:inline-block;width:120px;height:8px;border-radius:99px;background:linear-gradient(90deg,rgba(239,68,68,.75),rgba(148,163,184,.55),rgba(16,185,129,.8))}" +
      ".acmd-head{flex-wrap:wrap;gap:10px}.panel-head-modern .table-controls.acmd-ctl{flex-wrap:wrap !important;flex:0 1 auto;max-width:100%;row-gap:8px}" +
      "@media (max-width:1200px){.acmd-head{flex-direction:column;align-items:stretch}.acmd-ctl{justify-content:flex-start}}" +
      "@media (max-width:700px){.acmd-legend i{width:70px}}" +
      ".acmd-legend .lg{display:inline-block;width:14px;height:10px;border-radius:3px;margin-left:6px}.acmd-legend .lg.r{background:rgba(220,50,55,.8)}.acmd-legend .lg.a{background:rgba(225,150,8,.7)}.acmd-legend .lg.g{background:rgba(10,165,115,.8)}" +
      ".acmd-legend .lg.t,.acmd-table .d.today{background:rgba(127,127,127,.10);box-shadow:inset 0 0 0 1px rgba(148,163,184,.45)}html .acmd-table .d.today{color:var(--text);text-shadow:none}";
    document.head.appendChild(s);
  }

  // v1.18.3 - the colour is the day vs THAT merchant's own Daily Goal (not vs the other merchants):
  //   ≥ 100% of goal = green (deeper up to 150%) · 80–99% = amber · < 80% = red (deeper as it falls to 0).
  //   No target → its own Avg Daily is the benchmark. Today's column (still incomplete) is not coloured.
  var GOOD = 1, WARN = 0.8;
  function mix(a, b, k) { k = Math.max(0, Math.min(1, k)); var c = a.map(function (x, i) { return x + (b[i] - x) * k; }); return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + c[3].toFixed(2) + ")"; }
  function heat(p) {
    var R0 = [190, 30, 45, 0.9], R1 = [239, 68, 68, 0.6], A0 = [217, 119, 6, 0.62], A1 = [234, 179, 8, 0.62], G0 = [16, 185, 129, 0.55], G1 = [5, 150, 105, 0.95];
    if (p >= GOOD) return mix(G0, G1, (p - GOOD) / 0.5);
    if (p >= WARN) return mix(A0, A1, (p - WARN) / (GOOD - WARN));
    return mix(R0, R1, p / WARN);
  }
  function bench(m) { return m.goal != null && m.goal > 0 ? m.goal : (m.avg > 0 ? m.avg : null); }

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
    var th = function (k, label, cls, title, hd) { return '<th class="' + cls + (AD.sort === k ? " sorted" : "") + '" data-s="' + k + '"' + (title ? ' title="' + esc(title) + '"' : "") + '><span class="lb"' + (hd ? ' data-hf="' + esc(hd[0]) + '" data-hs="' + esc(hd[1]) + '" data-hd="' + esc(hd[2]) + '"' : "") + '>' + label + '</span>' + arrow(k) + '</th>'; };
    var cols = '<colgroup><col class="c-id"><col class="c-name"><col class="c-avg"><col class="c-goal">' + d.days.map(function () { return "<col>"; }).join("") + '<col class="c-tot"></colgroup>';
    var head = '<tr>' + th("id", "Tager ID", "s0 l") + th("name", "Tager Name", "s1 l") + th("avg", "Avg Daily", "s2", "Row total ÷ the " + nd + " day columns.", ["Avg Daily", "Avg Daily", "Avg"]) +
      th("goal", "Daily Goal", "s3 sep", "Target Placed (Merchant Targets) ÷ " + d.dim + " days in the month. Blank = no target.", ["Daily Goal", "Daily Goal", "Goal"]) +
      d.days.map(function (x, i) { var dt = new Date(x.ts), dd = String(dt.getDate()).padStart(2, "0"), first = i === 0 || dt.getDate() === 1; return th("d:" + i, dlab(x.ts), "d-h", dfull(x.ts), [dlab(x.ts), dt.getDate() + "/" + (dt.getMonth() + 1), first ? dt.getDate() + "/" + (dt.getMonth() + 1) : dd]); }).join("") + th("total", "Row Total", "", "Sum of the day columns.", ["Row Total", "Row Total", "Total"]) + '</tr>';
    var kfmt = function (v) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(v)); };
    var dcell = function (v, extra, style, tip) { return '<td class="d' + (extra || "") + '"' + (style ? ' style="' + style + '"' : "") + ' data-f="' + int(v) + '" data-c="' + kfmt(v) + '" title="' + esc(tip || int(v)) + '">' + int(v) + '</td>'; };
    var t0 = new Date(); t0.setHours(0, 0, 0, 0); var todayI = -1; d.days.forEach(function (x, i) { if (x.ts === t0.getTime()) todayI = i; });
    var body = page.map(function (m) {
      return '<tr><td class="s0 l font-mono text-dim">' + esc(m.id) + '</td><td class="s1 l font-bold" title="' + esc(m.name + " · " + m.acm + " · " + m.id) + '">' + esc(m.name) + '</td><td class="s2 n">' + dec(m.avg) + '</td><td class="s3 n sep">' + (m.goal != null ? int(m.goal) : "") + '</td>' +
        m.cells.map(function (v, i) {
          if (v == null) return '<td class="d e">·</td>';
          var b = bench(m), base = m.goal != null && m.goal > 0 ? "goal " : "own avg ";
          if (i === todayI) return dcell(v, " today", "", int(v) + " · today, still incomplete — not coloured");
          if (b == null) return dcell(v, "", "background:rgba(148,163,184,.35)", int(v) + " · no goal and no average");
          var p = v / b;
          return dcell(v, "", "background:" + heat(p), int(v) + " · " + Math.round(p * 100) + "% of " + base + "(" + int(b) + ")");
        }).join("") + '<td class="n tot">' + int(m.total) + '</td></tr>';
    }).join("") || '<tr><td class="l text-dim" colspan="' + (nd + 5) + '" style="text-align:center;padding:22px">No merchants for this selection.</td></tr>';
    var foot = '<tr><td class="s0"></td><td class="s1 l">Grand totals' + (L.length > page.length ? ' <span class="text-dim" style="font-weight:500">(' + L.length.toLocaleString("en-US") + ')</span>' : "") + '</td><td class="s2 n">' + dec(nd ? tot.total / nd : null) + '</td><td class="s3 n sep">' + (tot.goals ? int(tot.goal) : "") + '</td>' +
      tot.cells.map(function (v) { return dcell(v, " n", "color:inherit;text-shadow:none"); }).join("") + '<td class="n tot">' + int(tot.total) + '</td></tr>';
    host.innerHTML = '<div class="panel table-panel hover-glow">' +
      '<div class="panel-head-modern acmd-head"><div class="panel-title-wrapper border-blue"><h2>Daily Orders — Merchants</h2><p>Placed Orders per merchant per day · ' + esc(dlab(d.days[0].ts)) + ' – ' + esc(dlab(d.days[nd - 1].ts)) + ' · Merchant Only query · the latest day can still be incomplete · <span id="acmdAsOf">' + esc(asOfText()) + '</span></p></div>' +
      '<div class="table-controls acmd-ctl" style="gap:8px;flex-wrap:wrap"><label class="text-dim" style="font-size:12px">From <input id="acmdFrom" type="date" class="date-filter-input" min="' + ymd(d.min) + '" max="' + ymd(d.max) + '" value="' + ymd(d.from) + '"></label>' +
      '<label class="text-dim" style="font-size:12px">To <input id="acmdTo" type="date" class="date-filter-input" min="' + ymd(d.min) + '" max="' + ymd(d.max) + '" value="' + ymd(d.to) + '"></label>' +
      '<select id="acmdAcm" class="date-filter-input" title="Account Manager">' + acmOpts + '</select>' +
      '<input id="acmdQ" type="search" class="date-filter-input" style="min-width:190px" placeholder="Tager ID or name" value="' + esc(AD.q) + '" autocomplete="off">' +
      '<button class="btn btn-outline small" id="acmdCsv">Export CSV</button></div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' +
      '<div style="display:flex;justify-content:flex-end;padding:0 18px 8px"><div class="acmd-legend" title="Each day vs that merchant\'s Daily Goal (no target → its own Avg Daily). Today is not coloured until the day is over.">' +
        '<b class="lg r"></b><span>&lt; 80% of goal</span><b class="lg a"></b><span>80–99%</span><b class="lg g"></b><span>≥ goal</span>' + (todayI >= 0 ? '<b class="lg t"></b><span>today (incomplete)</span>' : "") + '</div></div>' +
      '<div class="acmd-wrap"><table class="acmd-table" id="acmdTable" data-nd="' + nd + '">' + cols + '<thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
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
    fit(host); observe(host); watch(host);
  }

  // Fit the table to the screen: no inner scrolling. As the width gets tighter: full -> tight (smaller type, d/m headers, k-numbers) -> dense (no Tager ID) -> scroll (phones only).
  function fit(host) {
    var wrap = host.querySelector(".acmd-wrap"), t = host.querySelector("#acmdTable"); if (!wrap || !t) return;
    var MODES = ["full", "tight", "dense", "micro", "scroll"], mode = "scroll", i;
    var apply = function (m) {
      wrap.className = "acmd-wrap acmd-" + m; t.dataset.mode = m;
      t.querySelectorAll("td[data-f]").forEach(function (c) { c.textContent = (m === "full" || m === "scroll") ? c.dataset.f : c.dataset.c; });
      t.querySelectorAll(".lb[data-hf]").forEach(function (l) { l.textContent = m === "full" || m === "scroll" ? l.dataset.hf : m === "tight" ? l.dataset.hs : l.dataset.hd; });
    };
    // the first mode where nothing is cut off wins (measured, not guessed); phones fall through to a horizontal scroll
    var clipped = function () {
      var bad = false; t.querySelectorAll("td.d:not(.e), thead th:not(.s1), tfoot td:not(.s1)").forEach(function (c) { if (c.scrollWidth > c.clientWidth + 1) bad = true; });
      return bad || wrap.scrollWidth > wrap.clientWidth + 1;
    };
    for (i = 0; i < MODES.length - 1; i++) { apply(MODES[i]); if (!clipped()) { mode = MODES[i]; break; } }
    apply(mode); lastW = wrap.clientWidth;
  }
  var lastW = 0, ro = null, hostRef = null;
  function observe(host) {
    hostRef = host; if (ro || typeof ResizeObserver === "undefined") return;
    ro = new ResizeObserver(function () { var w = hostRef && hostRef.querySelector(".acmd-wrap"); if (w && Math.abs(w.clientWidth - lastW) > 1) fit(hostRef); }); ro.observe(host);
  }
  window.addEventListener("resize", function () { if (hostRef) fit(hostRef); });

  // v1.18.1 - while this page is open it re-reads Merchant Only by itself every minute (Worker serves a copy at most 60 s old), independent of the dashboard's full sync
  var liveT = 0;
  function liveTick() {
    var sec = $("viewAcmDailyOrders"); if (!sec || sec.classList.contains("hidden")) { clearInterval(liveT); liveT = 0; return; }
    if (document.hidden || typeof window.refreshMerchantOnlyLive !== "function") return;
    window.refreshMerchantOnlyLive().then(function () { var el = $("acmdAsOf"); if (el) el.textContent = asOfText(); }).catch(function (e) { var el = $("acmdAsOf"); if (el) el.textContent = "could not refresh (" + String((e && e.message) || "error").slice(0, 60) + ") - showing the last numbers"; });
  }
  function startLive() {
    var L = st().merchantOnlyLiveAt;
    if (!liveT) liveT = setInterval(liveTick, 60000);
    if (!L || Date.now() - L.at > 30000) liveTick();
  }
  var watchT = 0, lastSig = "";
  function watch(host) {
    startLive();
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
