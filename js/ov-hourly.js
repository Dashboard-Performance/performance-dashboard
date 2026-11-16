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
  function build(raw) {
    var snaps = (raw && raw.snapshots || []).filter(function (s) { return s && s.dataDay && isFinite(s.placed) && isFinite(s.hour); });
    var byDay = {};
    snaps.forEach(function (s) {
      var x = Math.round((utcDay(s.cairoDate) - utcDay(s.dataDay)) / 3600000) + s.hour;   // hours since 00:00 of the point's own DAY
      (byDay[s.dataDay] = byDay[s.dataDay] || []).push({ x: x, y: s.placed, at: s.at, days: s.days || {} });
    });
    var days = Object.keys(byDay).sort(), today = days[days.length - 1] || "", yday = today ? prevDay(today) : "";
    var T = (byDay[today] || []).sort(function (a, b) { return a.x - b.x; }), Y = (byDay[yday] || []).sort(function (a, b) { return a.x - b.x; });
    var last = T[T.length - 1] || null, sameHour = last ? Y.filter(function (p) { return p.x === last.x; })[0] || null : null;
    // yesterday's own total: Merchant Only's number for that day, from the newest point that carries it
    var yTotal = null; snaps.slice().sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).some(function (s) { if (s.days && s.days[yday] != null) { yTotal = s.days[yday]; return true; } return false; });
    var maxX = Math.max(23, last ? last.x : 0, Y.length ? Y[Y.length - 1].x : 0);
    return { today: today, yday: yday, T: T, Y: Y, last: last, sameHour: sameHour, yTotal: yTotal, maxX: maxX,
      diff: last && sameHour ? last.y - sameHour.y : null, pct: last && sameHour && sameHour.y ? 100 * (last.y - sameHour.y) / sameHour.y : null };
  }

  function css() {
    if ($("ovhStyle")) return;
    var s = document.createElement("style"); s.id = "ovhStyle";
    s.textContent = ".ovh-chart{position:relative;height:320px;padding:0 14px 14px}.ovh-legend{display:flex;gap:16px;align-items:center;font-size:12px;color:var(--text-dim)}.ovh-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}" +
      ".ovh-note{padding:0 18px 14px;font-size:11.5px;color:var(--text-dim)}.ovh-empty{padding:34px 22px;text-align:center;color:var(--text-dim);font-size:13px;line-height:1.7}.ovh-warn{color:#f59e0b}" +
      "body.tw-mscope #ovHourlyHost{display:none}.ovh-up{color:#34d399}.ovh-down{color:#f87171}@media (max-width:700px){.ovh-chart{height:260px;padding:0 6px 10px}}";
    document.head.appendChild(s);
  }

  // value labels above (today) / below (yesterday) the points, like the Metabase view
  var labels = { id: "ovhLabels", afterDatasetsDraw: function (ch) {
    var ctx = ch.ctx, wide = ch.width > 760, step = wide ? 1 : 2;
    ch.data.datasets.forEach(function (ds, di) {
      var meta = ch.getDatasetMeta(di); if (meta.hidden) return;
      ctx.save(); ctx.font = "600 10.5px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = di === 0 ? "#34d399" : "#7dd3fc";
      meta.data.forEach(function (pt, i) { var v = ds.data[i]; if (v == null || i % step) return; ctx.fillText(int(v), pt.x, di === 0 ? pt.y - 9 : pt.y + 17); });
      ctx.restore();
    });
  } };

  function render(host) {
    css();
    var d = build(H.raw), nowHr = H.raw ? H.raw.hour : null;
    var warn = H.raw && H.raw.status && H.raw.status.ok === false ? '<div class="ovh-note ovh-warn">The last hourly read did not work (' + esc(H.raw.status.why || "no live answer") + ') — that hour stays empty until the next one.</div>' : "";
    var head = '<div class="panel-head-modern"><div class="panel-title-wrapper border-green"><h2>Orders per Hour — Today vs Yesterday</h2>' +
      '<p>' + (d.last ? "Placed Orders, cumulative · " + esc(dayLabel(d.today)) + (d.Y.length ? " vs " + esc(dayLabel(d.yday)) : "") + " · last point " + String(d.last.x % 24).padStart(2, "0") + ":00" : "Placed Orders, cumulative by hour · Merchant Only") + '</p></div>' +
      '<div class="ovh-legend"><span><i style="background:#34d399"></i>today</span><span><i style="background:#7dd3fc"></i>yesterday</span></div></div>';
    var body;
    if (H.err && !H.raw) body = '<div class="ovh-empty">Could not read the hourly points (' + esc(H.err) + '). It retries by itself.</div>';
    else if (!H.raw) body = '<div class="ovh-empty">Reading the hourly points…</div>';
    else if (!d.T.length) body = '<div class="ovh-empty">No hourly point yet.<br>The Worker takes one on the dot of every Cairo hour from Merchant Only — the first one lands at ' + String(((nowHr == null ? 0 : nowHr) + 1) % 24).padStart(2, "0") + ':00.<br>The query has no hours, so earlier hours cannot be filled in.</div>';
    else {
      var col = d.diff == null ? "" : d.diff >= 0 ? "#34d399" : "#f87171", sgn = function (v) { return v == null ? "—" : (v > 0 ? "+" : "") + int(v); };
      var tiles = [["Today so far", int(d.last.y), "up to " + String(d.last.x % 24).padStart(2, "0") + ":00"],
        ["Yesterday, same hour", d.sameHour ? int(d.sameHour.y) : "—", d.sameHour ? "up to " + String(d.sameHour.x % 24).padStart(2, "0") + ":00" : (d.Y.length ? "no point at that hour" : "starts once a full day exists")],
        ["Difference", sgn(d.diff), d.pct == null ? "vs yesterday" : '<em style="font-style:normal;font-weight:700;color:' + col + '">' + (d.pct > 0 ? "+" : "") + d.pct.toFixed(1) + '%</em> vs yesterday', col],
        ["Yesterday total", d.yTotal != null ? int(d.yTotal) : "—", d.yTotal != null ? esc(dayLabel(d.yday)) + " · full day" : "not in the query"]];
      body = '<div class="cx-hero2" style="padding:0 18px 12px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b' + (t[3] ? ' style="color:' + t[3] + '"' : '') + '>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' + warn +
        '<div class="ovh-chart"><canvas id="ovhCanvas"></canvas></div>' +
        '<div class="ovh-note">Each point = Placed Orders of the day counted up to that hour (Merchant Only, all merchants, Egypt), read live on the hour (Cairo time). An hour the query did not answer stays empty.</div>';
    }
    host.innerHTML = head + body;
    if (d.T.length) draw(d);
  }

  function draw(d) {
    var cv = $("ovhCanvas"); if (!cv || typeof Chart === "undefined") return;
    if (H.chart) { try { H.chart.destroy(); } catch (e) {} H.chart = null; }
    var xs = []; for (var i = 0; i <= d.maxX; i++) xs.push(i);
    var arr = function (P) { var a = xs.map(function () { return null; }); P.forEach(function (p) { if (p.x >= 0 && p.x <= d.maxX) a[p.x] = p.y; }); return a; };
    H.chart = new Chart(cv.getContext("2d"), {
      type: "line", plugins: [labels],
      data: { labels: xs.map(function (x) { return String(x % 24).padStart(2, "0") + ":00"; }), datasets: [
        { label: "today", data: arr(d.T), borderColor: "#34d399", backgroundColor: "#34d399", pointRadius: 3.5, pointBackgroundColor: "#0b1220", pointBorderColor: "#34d399", pointBorderWidth: 2, tension: .25, spanGaps: false },
        { label: "yesterday", data: arr(d.Y), borderColor: "#7dd3fc", backgroundColor: "#7dd3fc", pointRadius: 3.5, pointBackgroundColor: "#0b1220", pointBorderColor: "#7dd3fc", pointBorderWidth: 2, tension: .25, spanGaps: false } ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 22, right: 18 } }, interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false },
        tooltip: { callbacks: { title: function (it) { return "Up to " + it[0].label; }, label: function (c) { return c.parsed.y == null ? "" : c.dataset.label + ": " + int(c.parsed.y) + " orders"; } } } },
        scales: { x: { ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: "rgba(148,163,184,.14)" }, title: { display: true, text: "Hour (Cairo) — orders placed up to that hour", color: "#94a3b8" } },
          y: { beginAtZero: true, ticks: { color: "#94a3b8", callback: function (v) { return int(v); } }, grid: { color: "rgba(148,163,184,.14)" }, title: { display: true, text: "Placed orders (cumulative)", color: "#94a3b8" } } } }
    });
  }

  function load(host) {
    var C = window.TowerCore; if (!C || !C.wfetch) return;
    C.wfetch("hourlyOrders", { timeout: 20000 }).then(function (j) {
      if (!j || j.success === false) throw new Error((j && j.message) || "no answer");
      var sig = JSON.stringify([j.snapshots.length, j.snapshots.length && j.snapshots[j.snapshots.length - 1].at, j.status && j.status.ok, j.hour]);
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
