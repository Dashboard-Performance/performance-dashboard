/* Over View → "Orders per Hour — Today vs Yesterday" (v1.18.0)
   Cumulative Placed Orders by hour, today against yesterday, all merchants (overall — no ACM / Telesales filter).
   Source = Merchant Only. That query has days, not hours, so the Worker builds the curve: on the dot of every Cairo hour it reads Merchant Only
   live and stores one point = the Placed Orders of the latest day counted up to that moment (worker.js → recordHourlySnapshot, action=hourlyOrders).
     • A point at hour H means "orders placed up to H:00". The last point of today is the latest full hour.
     • Today = the latest DAY in Merchant Only, yesterday = the day before it (no assumption about the clock: each point carries its own DAY).
     • There is no way back in time (the query has no hours): points exist from the hour the Worker started taking them. Yesterday's line shows
       once a day of points exists. An hour the query did not answer stays a gap — never an estimate.
     • Cards: Today so far (last point) · Yesterday at the same hour · the difference and % · Yesterday's total (Merchant Only's own number for that day). */
(function () {
  "use strict";
  var H = { raw: null, err: "", chart: null, t: 0, at: 0 };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v) { return v == null || !isFinite(v) ? "—" : Math.round(+v).toLocaleString("en-US"); }
  function utcDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function prevDay(s) { var t = utcDay(s); return isNaN(t) ? "" : new Date(t - 86400000).toISOString().slice(0, 10); }
  function dayLabel(s) { var t = utcDay(s); return isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }); }

  // snapshots from the Worker -> what the panel draws. Pure, so it can be tested without a browser.
  // v1.18.3 - everything follows the DAY column of the data (Merchant Only), not the clock:
  //   • every reading carries the number of the last 3 DAYs in the query (s.days), so each DAY gets one point per hour from every reading,
  //     placed at "hours since 00:00 of that DAY" -> a DAY keeps collecting its late orders after midnight.
  //   • "today" = the newest DAY the query has. Until the query shows the new DAY, the old one stays today (it is still being filled).
  //   • when is a DAY finished? Not after a fixed time: it is CLOSED once the query is clearly refreshing (a newer DAY's number went up)
  //     and this DAY's number did not move for SETTLE readings in a row. If NOTHING moves (the query stalled - e.g. overnight, when it sat on
  //     4,038 for hours), that proves nothing, so the DAY stays "still updating".
  //   • a DAY's curve: hours 00..23 as read, and 24:00 = its newest total (the readings after midnight are folded into it, not drawn as hours).
  var SETTLE = 2;
  var C_T = "#34d399", C_Y = "#7dd3fc", C_DIM = "#94a3b8", C_AMB = "#f59e0b";
  function build(raw) {
    var snaps = (raw && raw.snapshots || []).filter(function (s) { return s && s.cairoDate && isFinite(s.hour); })
      .sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
    var series = {}, prev = {}, status = {}, moved = null;
    snaps.forEach(function (s) {
      var vals = {};
      Object.keys(s.days || {}).forEach(function (d) { if (s.days[d] != null && isFinite(s.days[d])) vals[d] = +s.days[d]; });
      if (s.dataDay && s.placed != null && isFinite(s.placed)) vals[s.dataDay] = +s.placed;
      var ds = Object.keys(vals).sort(), any = false;
      ds.forEach(function (d) {
        var x = Math.round((utcDay(s.cairoDate) - utcDay(d)) / 3600000) + s.hour;
        if (!isFinite(x) || x < 0) return;
        if (prev[d] == null || vals[d] !== prev[d]) any = true;
        (series[d] = series[d] || {})[x] = { x: x, y: vals[d], at: s.at };          // a newer reading for the same hour wins
        // closing: only readings taken after the DAY ended (x >= 24), and only when the query is visibly refreshing
        var st = status[d] = status[d] || { quiet: 0, closed: false, lastChangeX: null };
        if (prev[d] != null && vals[d] !== prev[d]) { st.quiet = 0; st.closed = false; st.lastChangeX = x; }
        else if (x >= 24 && prev[d] != null) {
          var fresh = ds.some(function (n) { return n > d && prev[n] != null && vals[n] > prev[n]; });
          if (fresh && ++st.quiet >= SETTLE) st.closed = true;
        }
      });
      if (any) moved = { date: s.cairoDate, hour: s.hour };
      ds.forEach(function (d) { prev[d] = vals[d]; });
    });
    var known = Object.keys(series).sort();
    // today = the Cairo calendar day (from the Worker clock); the query may not have it yet in the early hours
    var today = [raw && raw.cairoDate || "", known[known.length - 1] || ""].sort().pop(), yday = today ? prevDay(today) : "";
    function curve(d) {
      var all = Object.keys(series[d] || {}).map(function (k) { return series[d][k]; }).sort(function (a, b) { return a.x - b.x; });
      if (!all.length) return { P: [], latest: null };
      var latest = all[all.length - 1];
      var P = all.filter(function (p) { return p.x < 24; });
      if (!P.length || P[0].x > 0) P.unshift({ x: 0, y: 0, start: true });              // nothing is placed before the DAY starts
      if (latest.x >= 24) P.push({ x: 24, y: Math.max(latest.y, P[P.length - 1].y), at: latest.at, end: true });
      return { P: P, latest: latest };
    }
    var t = curve(today), y = curve(yday);
    var real = t.P.filter(function (p) { return !p.start; });
    var last = real.length ? real[real.length - 1] : null;
    var sameHour = last ? y.P.filter(function (p) { return p.x === last.x && !p.start; })[0] || null : null;
    var ys = status[yday] || null;
    var nowX = raw && isFinite(raw.hour) ? raw.hour + (isFinite(raw.minute) ? raw.minute : 0) / 60 : null;
    if (raw && raw.cairoDate && today !== raw.cairoDate) nowX = null;
    return { today: today, yday: yday, T: real.length ? t.P : [], Y: y.P, last: last, sameHour: sameHour,
      firstX: real.length ? real[0].x : null, waiting: !real.length,
      yTotal: y.latest ? y.latest.y : null, yClosed: !!(ys && ys.closed), yLastChange: ys && ys.lastChangeX, yAfterMidnight: !!(y.latest && y.latest.x >= 24),
      moved: moved, nowX: nowX, maxX: 24,
      diff: last && sameHour ? last.y - sameHour.y : null, pct: last && sameHour && sameHour.y ? 100 * (last.y - sameHour.y) / sameHour.y : null };
  }
  function hh(x, day) {
    if (x == null) return "";
    if (x === 24) return "24:00";
    var t = String(x % 24).padStart(2, "0") + ":00";
    if (x > 24) { var u = utcDay(day); t += isNaN(u) ? " (+1 day)" : " " + dayLabel(new Date(u + Math.floor(x / 24) * 86400000).toISOString().slice(0, 10)); }
    return t;
  }

  function css() {
    if ($("ovhStyle")) return;
    var s = document.createElement("style"); s.id = "ovhStyle";
    s.textContent = ".ovh-chart{position:relative;height:340px;padding:4px 14px 6px}" +
      ".ovh-legend{display:flex;gap:16px;align-items:center;font-size:12px;color:var(--text-dim);flex-wrap:wrap}.ovh-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px}" +
      ".ovh-legend .ovh-dash{display:inline-block;width:18px;border-top:2px dashed #94a3b8;margin-right:6px;vertical-align:3px}" +
      ".ovh-chips{display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 10px}.ovh-chip{font-size:11.5px;padding:3px 10px;border-radius:999px;border:1px solid var(--line);color:var(--text-dim);background:rgba(148,163,184,.06)}" +
      ".ovh-chip b{font-weight:700}.ovh-chip.ok{color:#34d399;border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}.ovh-chip.wait{color:#f59e0b;border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.08)}" +
      ".ovh-note{padding:2px 18px 14px;font-size:11.5px;color:var(--text-dim);line-height:1.6}.ovh-empty{padding:34px 22px;text-align:center;color:var(--text-dim);font-size:13px;line-height:1.7}.ovh-warn{color:#f59e0b}" +
      "body.tw-mscope #ovHourlyHost{display:none}@media (max-width:700px){.ovh-chart{height:270px;padding:0 4px 6px}}";
    document.head.appendChild(s);
  }

  // value labels: today above its points, yesterday below; nothing on the 00:00 start points; the 24:00 point says "total"
  var labels = { id: "ovhLabels", afterDatasetsDraw: function (ch) {
    var ctx = ch.ctx, step = ch.width > 760 ? 1 : 2, meta0 = ch.$ovh || {};
    ch.data.datasets.forEach(function (ds, di) {
      var meta = ch.getDatasetMeta(di); if (meta.hidden || ds.$gap) return;
      ctx.save(); ctx.textAlign = "center"; ctx.fillStyle = di === 0 ? C_T : C_Y;
      meta.data.forEach(function (pt, i) {
        var v = ds.data[i]; if (v == null || (ds.$kind[i] === "start")) return;
        var end = ds.$kind[i] === "end";
        if (!end && i % step && i !== ds.$lastIdx) return;
        ctx.font = (end ? "700 11.5px" : "600 10.5px") + " Inter, sans-serif";
        var up = di === 0 || end, txt = int(v) + (end ? (meta0.yClosed || di === 0 ? " total" : " so far") : "");
        ctx.fillText(txt, Math.min(pt.x, ch.chartArea.right - 18), up ? pt.y - 10 : pt.y + 18);
      });
      ctx.restore();
    });
  } };

  // the early hours of today before the query had any row for it, and a "now" line
  var bands = { id: "ovhBands", beforeDatasetsDraw: function (ch) {
    var m = ch.$ovh; if (!m) return;
    var x = ch.scales.x, a = ch.chartArea, ctx = ch.ctx;
    var gapTo = m.waiting ? (m.nowX != null ? m.nowX : null) : (m.firstX > 1 ? m.firstX : null);
    if (gapTo != null && gapTo > 0.5) {
      var x0 = x.getPixelForValue(0), x1 = x.getPixelForValue(Math.min(gapTo, 24));
      ctx.save(); ctx.fillStyle = "rgba(148,163,184,.07)"; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      ctx.fillStyle = C_DIM; ctx.font = "500 11px Inter, sans-serif"; ctx.textAlign = "center";
      if (x1 - x0 > 120) {
        ctx.fillText("No rows for " + dayLabel(m.today) + " in the query yet", (x0 + x1) / 2, a.top + 16);
        ctx.fillText("(it shows the new day with its morning refresh)", (x0 + x1) / 2, a.top + 31);
      }
      ctx.restore();
    }
    if (m.nowX != null && m.nowX > 0 && m.nowX < 24) {
      var nx = x.getPixelForValue(m.nowX);
      ctx.save(); ctx.strokeStyle = "rgba(148,163,184,.55)"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(nx, a.top); ctx.lineTo(nx, a.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = C_DIM; ctx.font = "600 10px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText("now", nx, a.top - 6);
      ctx.restore();
    }
  } };

  function render(host) {
    css();
    var d = build(H.raw);
    var warn = H.raw && H.raw.status && H.raw.status.ok === false ? '<div class="ovh-note ovh-warn">The last hourly read did not work (' + esc(H.raw.status.why || "no live answer") + ') — that hour stays empty.</div>' : "";
    var sub = d.today ? esc(dayLabel(d.today)) + (d.Y.length ? " vs " + esc(dayLabel(d.yday)) : "") + " · Placed Orders, cumulative" : "Placed Orders, cumulative by hour · Merchant Only";
    var head = '<div class="panel-head-modern"><div class="panel-title-wrapper border-green"><h2>Orders per Hour — Today vs Yesterday</h2><p>' + sub + '</p></div>' +
      '<div class="ovh-legend"><span><i style="background:' + C_T + '"></i>today' + (d.today ? " · " + esc(dayLabel(d.today)) : "") + '</span>' +
      '<span><i style="background:' + C_Y + '"></i>yesterday' + (d.yday ? " · " + esc(dayLabel(d.yday)) : "") + '</span><span><span class="ovh-dash"></span>no reading</span></div></div>';
    var body;
    if (H.err && !H.raw) body = '<div class="ovh-empty">Could not read the hourly points (' + esc(H.err) + '). It retries by itself.</div>';
    else if (!H.raw) body = '<div class="ovh-empty">Reading the hourly points…</div>';
    else if (!d.T.length && !d.Y.length) body = '<div class="ovh-empty">No hourly point yet.<br>The Worker reads Merchant Only on the dot of every Cairo hour.</div>';
    else {
      var col = d.diff == null ? "" : d.diff >= 0 ? C_T : "#f87171", sgn = function (v) { return v == null ? "—" : (v > 0 ? "+" : "") + int(v); };
      var tiles = [
        ["Today so far", d.last ? int(d.last.y) : "—", d.last ? "up to " + hh(d.last.x) : "waiting for " + esc(dayLabel(d.today)) + " in the query"],
        ["Yesterday, same hour", d.sameHour ? int(d.sameHour.y) : "—", d.sameHour ? "up to " + hh(d.sameHour.x) : (d.last ? "no reading at " + hh(d.last.x) + " yesterday" : "—")],
        ["Difference", sgn(d.diff), d.pct == null ? "vs yesterday" : '<em style="font-style:normal;font-weight:700;color:' + col + '">' + (d.pct > 0 ? "+" : "") + d.pct.toFixed(1) + '%</em> vs yesterday', col],
        ["Yesterday total", d.yTotal != null ? int(d.yTotal) : "—", d.yTotal == null ? "not in the query" : esc(dayLabel(d.yday)) + (d.yClosed ? " · full day" : " · still updating"), d.yTotal != null && !d.yClosed ? C_AMB : ""]];
      var chips = [];
      if (d.yTotal != null) chips.push(d.yClosed
        ? '<span class="ovh-chip ok">' + esc(dayLabel(d.yday)) + ' <b>closed</b> · last change ' + hh(d.yLastChange != null ? d.yLastChange : 24, d.yday) + '</span>'
        : '<span class="ovh-chip wait">' + esc(dayLabel(d.yday)) + ' <b>still updating</b>' + (d.yLastChange != null ? ' · last change ' + hh(d.yLastChange, d.yday) : '') + '</span>');
      if (d.waiting) chips.push('<span class="ovh-chip wait">' + esc(dayLabel(d.today)) + ' <b>not in the query yet</b></span>');
      if (d.moved) chips.push('<span class="ovh-chip">query last moved at <b>' + String(d.moved.hour).padStart(2, "0") + ':00</b>' + (d.moved.date !== (H.raw && H.raw.cairoDate) ? " · " + esc(dayLabel(d.moved.date)) : "") + '</span>');
      body = '<div class="cx-hero2" style="padding:0 18px 12px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b' + (t[3] ? ' style="color:' + t[3] + '"' : '') + '>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' +
        (chips.length ? '<div class="ovh-chips">' + chips.join("") + '</div>' : "") + warn +
        '<div class="ovh-chart"><canvas id="ovhCanvas"></canvas></div>' +
        '<div class="ovh-note">Each point = Placed Orders of that day (the date in Merchant Only) up to that hour, read on the hour (Cairo). ' +
        'The query refreshes about once an hour, so a reading can trail the real number a little. 24:00 = the full day, late orders included. ' +
        'A day is closed once the query is refreshing and that day stops moving. Dashed = hours without a reading.</div>';
    }
    host.innerHTML = head + body;
    if (d.T.length || d.Y.length) draw(d);
  }

  function draw(d) {
    var cv = $("ovhCanvas"); if (!cv || typeof Chart === "undefined") return;
    if (H.chart) { try { H.chart.destroy(); } catch (e) {} H.chart = null; }
    var xs = []; for (var i = 0; i <= d.maxX; i++) xs.push(i);
    function ds(P, color, label, fillA) {
      var data = xs.map(function () { return null; }), kind = xs.map(function () { return ""; });
      P.forEach(function (p) { if (p.x >= 0 && p.x <= d.maxX) { data[p.x] = p.y; kind[p.x] = p.start ? "start" : p.end ? "end" : "pt"; } });
      var lastIdx = -1; data.forEach(function (v, k) { if (v != null && kind[k] !== "start") lastIdx = k; });
      var ctx = cv.getContext("2d"), g = ctx.createLinearGradient(0, 0, 0, 320); g.addColorStop(0, fillA); g.addColorStop(1, "rgba(0,0,0,0)");
      return { label: label, data: data, $kind: kind, $lastIdx: lastIdx, borderColor: color, backgroundColor: g, fill: "origin", borderWidth: 2.5, tension: .3, spanGaps: false,
        pointRadius: kind.map(function (k) { return k === "start" ? 0 : k === "end" ? 5 : 3.5; }), pointHoverRadius: kind.map(function (k) { return k === "start" ? 0 : 6; }),
        pointBackgroundColor: kind.map(function (k) { return k === "end" ? color : "#0b1220"; }), pointBorderColor: color, pointBorderWidth: 2 };
    }
    // hours without a reading: a thin dashed bridge between the two readings around them (its own dataset: no fill, no labels, no tooltip)
    function gaps(P, color) {
      var out = [], Q = P.slice().sort(function (a, b) { return a.x - b.x; });
      for (var k = 1; k < Q.length; k++) if (Q[k].x - Q[k - 1].x > 1) {
        var data = xs.map(function () { return null; }); data[Q[k - 1].x] = Q[k - 1].y; data[Q[k].x] = Q[k].y;
        out.push({ label: "", $gap: true, data: data, borderColor: color, borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false, spanGaps: true, tension: 0 });
      }
      return out;
    }
    var sets = [ds(d.T, C_T, "today", "rgba(52,211,153,.18)"), ds(d.Y, C_Y, "yesterday", "rgba(125,211,252,.10)")]
      .concat(gaps(d.T, "rgba(52,211,153,.45)"), gaps(d.Y, "rgba(125,211,252,.45)"));
    H.chart = new Chart(cv.getContext("2d"), {
      type: "line", plugins: [bands, labels],
      data: { labels: xs.map(function (x) { return hh(x); }), datasets: sets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 26, right: 26, left: 4 } }, interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false },
          tooltip: { filter: function (it) { return !it.dataset.$gap && it.raw != null && it.dataset.$kind[it.dataIndex] !== "start"; },
            callbacks: { title: function (it) { return it.length && it[0].dataIndex === 24 ? "Full day (24:00)" : "Up to " + (it.length ? it[0].label : ""); },
              label: function (c) { var end = c.dataset.$kind[c.dataIndex] === "end";
                return " " + c.dataset.label + ": " + int(c.parsed.y) + " orders" + (end ? (c.datasetIndex === 1 && !d.yClosed ? " (still updating)" : " (incl. late orders)") : ""); } } } },
        scales: { x: { ticks: { color: C_DIM, maxRotation: 0, autoSkip: false, callback: function (v, k) { return k % 3 === 0 ? hh(k) : ""; } }, grid: { color: function (c) { return c.index % 3 === 0 ? "rgba(148,163,184,.14)" : "rgba(148,163,184,.04)"; } },
            title: { display: true, text: "Hour (Cairo) — orders placed up to that hour", color: C_DIM } },
          y: { beginAtZero: true, grace: "8%", ticks: { color: C_DIM, callback: function (v) { return int(v); } }, grid: { color: "rgba(148,163,184,.12)" }, title: { display: true, text: "Placed orders (cumulative)", color: C_DIM } } } }
    });
    H.chart.$ovh = d; H.chart.update("none");
  }

  function load(host) {
    var C = window.TowerCore; if (!C || !C.wfetch) return;
    C.wfetch("hourlyOrders", { timeout: 20000 }).then(function (j) {
      if (!j || j.success === false) throw new Error((j && j.message) || "no answer");
      var sig = JSON.stringify([j.snapshots.length, j.snapshots.length && j.snapshots[j.snapshots.length - 1].at, j.status && j.status.ok, j.hour, Math.floor((j.minute || 0) / 10)]);   // also every 10 min: the "now" line moves
      H.err = ""; var changed = sig !== H.sig; H.sig = sig; H.raw = j; if (changed || !H.rendered) { H.rendered = true; render(host); }
    }).catch(function (e) { H.err = (e && e.message) || "failed"; if (!H.raw) render(host); });
  }

  function boot() {
    var host = $("ovHourlyHost"); if (!host) return;
    if (!window.TowerCore || !window.TowerCore.wfetch) { setTimeout(boot, 400); return; }
    render(host); load(host);
    clearInterval(H.t);
    // a new point is taken at HH:00 — look every minute while Over View is open (cheap: three small KV reads)
    H.t = setInterval(function () { var ov = $("viewOverview"); if (!ov || ov.classList.contains("hidden") || document.hidden) return; load(host); }, 60000);
  }
  window.TaagerOvHourly = { build: build, state: H, reload: function () { var h = $("ovHourlyHost"); if (h) load(h); }, render: function () { var h = $("ovHourlyHost"); if (h) { H.rendered = true; render(h); } } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 600); }); else setTimeout(boot, 600);
})();
