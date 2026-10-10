/* Taager Center Control — Settings, Activity Log, ACM drawer, shared metrics (v1.7.0). Needs tower.js + alerts.js. */
(function () {
  "use strict";
  var C = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return C.esc(s); }
  function ago(iso) { var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; var h = Math.round(m / 60); if (h < 24) return h + "h ago"; return Math.round(h / 24) + "d ago"; }
  function fmtNum(n) { return Math.round(n || 0).toLocaleString("en-US"); }
  function fmtMoney(n) { n = n || 0; var a = Math.abs(n); return "EGP " + (a >= 1e6 ? (n / 1e6).toFixed(2) + "M" : a >= 1e3 ? (n / 1e3).toFixed(1) + "K" : Math.round(n)); }
  function initials(n) { var p = String(n || "?").split(/\s+/).filter(Boolean); return ((p[0] || "?")[0] + ((p[1] || "")[0] || "")).toUpperCase(); }

  // ---------------------------------------------------------------- shared metrics honoring Settings → Metric cutoffs
  window.TowerMetrics = {
    acmRates: function (name) {
      var rows = (window.__acmRows || []).filter(function (r) { return r.acmName === name; });
      var cut = C.getSettings().cutoffs, now = Date.now(), crL = now - cut.cr * 864e5, drL = now - cut.dr * 864e5;
      var p = 0, c = 0, c2 = 0, d = 0, P = 0, Cc = 0, D = 0;
      rows.forEach(function (r) { P += r.placedOrders; Cc += r.confirmedOrders; D += r.deliveredOrders; if (r.timestamp <= crL) { p += r.placedOrders; c += r.confirmedOrders; } if (r.timestamp <= drL) { c2 += r.confirmedOrders; d += r.deliveredOrders; } });
      var cr = p ? c / p : (P ? Cc / P : 0), dr = c2 ? d / c2 : (Cc ? D / Cc : 0);
      return { cr: cr * 100, dr: dr * 100, ndr: cr * dr * 100, provisional: !c2 && Cc > 0, placed: P, confirmed: Cc, delivered: D };
    },
    daily: function (name) {
      var map = {}; (window.__acmRows || []).forEach(function (r) { if (r.acmName !== name || !r.timestamp) return; var d = new Date(r.timestamp), k = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); map[k] = map[k] || { ts: r.timestamp, d: d.getDate(), placed: 0 }; map[k].placed += r.placedOrders; });
      return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.ts - b.ts; });
    }
  };

  // ---------------------------------------------------------------- ACM drawer (click a row in Performance ACM)
  function areaChart(pts) {
    if (pts.length < 2) return '<div class="tw-muted" style="padding:14px 0">Not enough daily data for this period.</div>';
    var W = 560, H = 190, L = 34, B = 24, T = 10, R = 10, max = Math.max.apply(null, pts.map(function (p) { return p.placed; })) || 1;
    var nice = Math.ceil(max / 4 / 10) * 10 * 4 || 4, X = function (i) { return L + i * (W - L - R) / (pts.length - 1); }, Y = function (v) { return T + (H - T - B) * (1 - v / nice); };
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.placed).toFixed(1); }).join(" ");
    var grid = [0, 1, 2, 3, 4].map(function (g) { var v = nice * g / 4; return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="tw-grid"/><text x="' + (L - 6) + '" y="' + (Y(v) + 3) + '" text-anchor="end" class="tw-ax">' + Math.round(v) + '</text>'; }).join("");
    var step = Math.ceil(pts.length / 8), xs = pts.map(function (p, i) { return i % step === 0 ? '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle" class="tw-ax">' + p.d + '</text>' : ""; }).join("");
    var dots = pts.map(function (p, i) { return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.placed).toFixed(1) + '" r="2.6" class="tw-dotc"><title>Day ' + p.d + ': ' + p.placed + '</title></circle>'; }).join("");
    return '<div class="tw-chartwrap" data-pts=\'' + JSON.stringify(pts.map(function (p, i) { return { x: +(X(i) / W).toFixed(4), y: +(Y(p.placed) / H).toFixed(4), v: p.placed, t: p.ts }; })) + '\'><div class="tw-tip"></div><svg viewBox="0 0 ' + W + ' ' + H + '" class="tw-chart"><line class="tw-vline" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '"/>' + grid + '<path d="' + line + ' L' + X(pts.length - 1) + " " + Y(0) + " L" + X(0) + " " + Y(0) + ' Z" class="tw-area"/><path d="' + line + '" class="tw-line"/>' + dots + xs + '<circle class="tw-hdot" r="5"/></svg></div>';
  }
  function wireChart(root) {
    var w = root.querySelector(".tw-chartwrap"); if (!w) return;
    var pts = JSON.parse(w.getAttribute("data-pts")), svg = w.querySelector("svg"), tip = w.querySelector(".tw-tip"), vl = w.querySelector(".tw-vline"), hd = w.querySelector(".tw-hdot"), vb = svg.viewBox.baseVal;
    function show(e) {
      var r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, best = 0, bd = 9;
      pts.forEach(function (p, i) { var d = Math.abs(p.x - fx); if (d < bd) { bd = d; best = i; } });
      var p = pts[best], px = p.x * vb.width, py = p.y * vb.height;
      vl.setAttribute("x1", px); vl.setAttribute("x2", px); hd.setAttribute("cx", px); hd.setAttribute("cy", py); w.classList.add("hov");
      tip.innerHTML = '<b>' + Math.round(p.v).toLocaleString("en-US") + '</b> orders<span>' + new Date(p.t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + '</span>';
      var left = p.x * r.width; tip.style.left = Math.min(Math.max(left, 50), r.width - 50) + "px"; tip.style.top = Math.max(p.y * r.height - 62, 0) + "px";
    }
    svg.addEventListener("mousemove", show); svg.addEventListener("mouseleave", function () { w.classList.remove("hov"); });
    svg.addEventListener("touchstart", function (e) { show(e.touches[0]); }, { passive: true }); svg.addEventListener("touchmove", function (e) { show(e.touches[0]); }, { passive: true });
  }
  function bar(pct, cls) { return '<div class="tw-bar"><i class="' + (cls || "") + '" style="width:' + Math.max(0, Math.min(pct, 100)).toFixed(1) + '%"></i></div>'; }
  function closeDrawer() { var d = $("twDrawer"); if (d) { d.classList.remove("open"); setTimeout(function () { d.remove(); }, 220); } }
  function openAcmDrawer(name) {
    var a = (state.acmTableData || []).filter(function (x) { return x.name === name; })[0]; if (!a) return;
    var M = window.TowerMetrics, m = M.acmRates(name), daily = M.daily(name);
    var mers = (state.merchantTableData || []).filter(function (x) { return x.acm === name; }).sort(function (x, y) { return y.deliveredGmv - x.deliveredGmv; }).slice(0, 8);
    var tgt = function (label, val, target, fmt, pct) { return '<div class="tw-tg"><div class="tw-tg-h"><b>' + label + '</b><span class="tw-mono">' + fmt(val) + (target > 0 ? " / " + fmt(target) : "") + '</span></div>' + (target > 0 ? bar(pct != null ? pct : val / target * 100, (pct != null ? pct : val / target * 100) >= 100 ? "good" : (pct != null ? pct : val / target * 100) < 50 ? "bad" : "warn") : '<div class="tw-muted">No target set</div>') + '</div>'; };
    var pct1 = function (v) { return v.toFixed(1) + "%"; };
    var html = '<div class="tw-dback"></div><aside class="tw-dpanel"><div class="tw-dhead"><div><h3>' + esc(name) + '</h3><div class="tw-muted">ACM portfolio · ' + esc(($("monthSelect") && $("monthSelect").selectedOptions[0] ? $("monthSelect").selectedOptions[0].text : "")) + '</div></div><button class="tw-x" id="twDx" aria-label="Close">✕</button></div><div class="tw-dbody">' +
      '<div class="tw-dstats"><div class="tw-dstat"><span>ORDERS</span><b>' + fmtNum(m.placed) + '</b></div><div class="tw-dstat"><span>CR</span><b>' + pct1(m.cr) + '</b></div><div class="tw-dstat"><span>DR</span><b>' + pct1(m.dr) + '</b></div><div class="tw-dstat"><span>NDR</span><b>' + pct1(m.ndr) + '</b></div></div>' +
      (m.provisional ? '<div class="tw-prov">Provisional — delivery numbers still maturing (DR cutoff D-' + C.getSettings().cutoffs.dr + ')</div>' : "") +
      '<div class="tw-card"><h3>Targets</h3><div class="tw-muted" style="margin-bottom:10px">Delivered vs month target</div>' +
        tgt("GMV", a.deliveredGmv, a.targetGmv, fmtMoney) + tgt("Run rate (EOM)", a.runRate, a.targetGmv, fmtMoney) + tgt("NDR", m.ndr, a.targetNdr, pct1) + tgt("CM3", a.cm3Pct, a.targetCm3, pct1) + tgt("Retention", a.actualRetention, a.targetRetention, fmtNum) +
        '<div class="tw-score"><span class="tw-muted">Final score</span><b>' + a.finalScorePct.toFixed(1) + '%</b></div></div>' +
      '<div class="tw-card"><h3>Daily orders</h3>' + areaChart(daily) + '</div>' +
      '<div class="tw-card"><h3>Top merchants</h3>' + (mers.length ? '<table class="tw-table"><thead><tr><th>Merchant</th><th class="r">Orders</th><th class="r">NDR</th><th class="r">GMV</th></tr></thead><tbody>' + mers.map(function (x) { return '<tr><td><b>' + esc(x.name) + '</b></td><td class="r">' + fmtNum(x.placed) + '</td><td class="r">' + pct1(x.ndr) + '</td><td class="r">' + fmtMoney(x.deliveredGmv) + '</td></tr>'; }).join("") + '</tbody></table>' : '<div class="tw-muted">No merchants found for this ACM in the loaded data.</div>') + '</div>' +
      '<div class="tw-row"><button class="btn btn-primary" id="twDAlert">Send alert to ' + esc(name.split(" ")[0]) + '</button><button class="btn" id="twDMerch">Open Merchants</button></div></div></aside>';
    closeDrawer();
    var d = document.createElement("div"); d.id = "twDrawer"; d.className = "tw-drawer"; d.innerHTML = html; document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add("open"); });
    wireChart(d); d.querySelector(".tw-dback").onclick = closeDrawer; $("twDx").onclick = closeDrawer;
    $("twDAlert").onclick = function () { closeDrawer(); if (window.TowerAlerts) window.TowerAlerts.compose({ aboutType: "ACM", aboutLabel: name, userName: name, title: "Your portfolio needs attention", body: "Your NDR is " + pct1(m.ndr) + " this month. Please review unconfirmed orders and your top merchants today.", severity: m.ndr < C.getSettings().thresholds.acmNdrMin ? "critical" : "warning" }); };
    $("twDMerch").onclick = function () { closeDrawer(); window.switchView("merchantPerformance"); };
  }
  // ---------------------------------------------------------------- Merchant drawer (click a row in Merchants)
  function openMerchantDrawer(id) {
    var m = (state.merchantTableData || []).filter(function (x) { return String(x.id) === String(id); })[0]; if (!m) return;
    var rows = (window.__acmRows || []).filter(function (r) { return String(r.merchantId) === String(m.id); });
    var dmap = {}; rows.forEach(function (r) { if (!r.timestamp) return; var d = new Date(r.timestamp), k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); dmap[k] = dmap[k] || { ts: r.timestamp, d: d.getDate(), placed: 0 }; dmap[k].placed += r.placedOrders; });
    var daily = Object.keys(dmap).map(function (k) { return dmap[k]; }).sort(function (a, b) { return a.ts - b.ts; });
    var sk = {}; rows.forEach(function (r) { var k = r.sku || "—"; sk[k] = sk[k] || { sku: k, cat: r.category || "", placed: 0, gmv: 0 }; sk[k].placed += r.placedOrders; sk[k].gmv += r.deliveredGmv; });
    var skus = Object.keys(sk).map(function (k) { return sk[k]; }).sort(function (a, b) { return b.gmv - a.gmv || b.placed - a.placed; }).slice(0, 8);
    var pct1 = function (v) { return (v || 0).toFixed(1) + "%"; };
    var tgt = function (label, val, target, fmt) { var p = target > 0 ? val / target * 100 : 0; return '<div class="tw-tg"><div class="tw-tg-h"><b>' + label + '</b><span class="tw-mono">' + fmt(val) + (target > 0 ? " / " + fmt(target) : "") + '</span></div>' + (target > 0 ? bar(p, p >= 100 ? "good" : p < 50 ? "bad" : "warn") : '<div class="tw-muted">No target set</div>') + '</div>'; };
    var acmFirst = (m.acm || "ACM").split(" ")[0];
    var html = '<div class="tw-dback"></div><aside class="tw-dpanel"><div class="tw-dhead"><div><h3>' + esc(m.name) + '</h3><div class="tw-muted">Merchant profile · ID ' + esc(m.id) + '</div></div><button class="tw-x" id="twDx" aria-label="Close">✕</button></div><div class="tw-dbody">' +
      '<div class="tw-dstats"><div class="tw-dstat"><span>ORDERS</span><b>' + fmtNum(m.placed) + '</b></div><div class="tw-dstat"><span>CR</span><b>' + pct1(m.cr) + '</b></div><div class="tw-dstat"><span>DR</span><b>' + pct1(m.dr) + '</b></div><div class="tw-dstat"><span>NDR</span><b>' + pct1(m.ndr) + '</b></div></div>' +
      '<div class="tw-card tw-kv"><div><span>ACM</span><b>' + esc(m.acm || "—") + '</b></div><div><span>Delivered GMV</span><b>' + fmtMoney(m.deliveredGmv) + '</b></div><div><span>Current segment</span><b>' + esc(m.currentSegment || "—") + '</b></div><div><span>Projected segment</span><b>' + esc(m.projectedSegment || "—") + '</b></div><div><span>Active SKUs</span><b>' + fmtNum(m.skuCount) + '</b></div><div><span>CM3</span><b>' + pct1(m.cm3Pct) + '</b></div></div>' +
      '<div class="tw-card"><h3>Targets</h3><div class="tw-muted" style="margin-bottom:10px">Delivered vs month target</div>' + tgt("GMV", m.deliveredGmv, m.targetGmv, fmtMoney) + tgt("Run rate (EOM)", m.runRate, m.targetGmv, fmtMoney) + tgt("Placed orders", m.placed, m.targetPlaced, fmtNum) + '</div>' +
      '<div class="tw-card"><h3>Daily orders</h3>' + areaChart(daily) + '</div>' +
      '<div class="tw-card"><h3>Top SKUs</h3>' + (skus.length ? '<table class="tw-table"><thead><tr><th>SKU</th><th>Category</th><th class="r">Orders</th><th class="r">GMV</th></tr></thead><tbody>' + skus.map(function (x) { return '<tr><td><b>' + esc(x.sku) + '</b></td><td>' + esc(x.cat) + '</td><td class="r">' + fmtNum(x.placed) + '</td><td class="r">' + fmtMoney(x.gmv) + '</td></tr>'; }).join("") + '</tbody></table>' : '<div class="tw-muted">No daily rows for this merchant in the current filter.</div>') + '</div>' +
      '<div class="tw-row"><button class="btn btn-primary" id="twDAlert">Alert ' + esc(acmFirst) + '</button></div></div></aside>';
    closeDrawer();
    var d = document.createElement("div"); d.id = "twDrawer"; d.className = "tw-drawer"; d.innerHTML = html; document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add("open"); });
    wireChart(d); d.querySelector(".tw-dback").onclick = closeDrawer; $("twDx").onclick = closeDrawer;
    $("twDAlert").onclick = function () { closeDrawer(); if (window.TowerAlerts) window.TowerAlerts.compose({ aboutType: "Merchant", aboutLabel: m.name, userName: m.acm, title: "Merchant needs attention: " + m.name, body: m.name + " is at NDR " + pct1(m.ndr) + " this month (CR " + pct1(m.cr) + ", DR " + pct1(m.dr) + "). Please follow up with the merchant today.", severity: m.ndr < C.getSettings().thresholds.merchNdrMin ? "critical" : "warning" }); };
  }
  function hookMerchantRows() {
    var tb = $("merchantTableBody"); if (!tb || tb.__tw) return; tb.__tw = true;
    tb.addEventListener("click", function (e) { var tr = e.target.closest("tr"); if (!tr || !tr.children[1]) return; openMerchantDrawer(tr.children[1].textContent.trim()); });
    tb.classList.add("tw-clickrows");
  }
  function hookAcmRows() {
    var tb = $("acmTableBody"); if (!tb || tb.__tw) return; tb.__tw = true;
    tb.addEventListener("click", function (e) { var tr = e.target.closest("tr"); if (!tr || !tr.children[1]) return; openAcmDrawer(tr.children[1].textContent.trim()); });
    tb.classList.add("tw-clickrows");
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

  // ---------------------------------------------------------------- Settings
  function renderSettings(host) {
    var S = JSON.parse(JSON.stringify(C.getSettings()));
    var num = function (id, v, step) { return '<input type="number" id="' + id + '" class="tw-num" step="' + (step || 1) + '" value="' + v + '">'; };
    host.innerHTML = '<div class="tw-page"><div class="tw-grid2">' +
      '<div class="tw-card"><h3>Metric cutoffs</h3><div class="tw-muted">CR and DR only count orders older than their cutoff, so young orders do not drag the rates down. They apply to the ACM table, the ACM drawer and the alert checks.</div>' +
        '<div class="tw-field"><label>CR cutoff (days back)</label>' + num("stCr", S.cutoffs.cr) + '<div class="tw-muted">Orders newer than D-' + S.cutoffs.cr + ' are left out of CR.</div></div>' +
        '<div class="tw-field"><label>DR cutoff (days back)</label>' + num("stDr", S.cutoffs.dr) + '<div class="tw-muted">Orders newer than D-' + S.cutoffs.dr + ' are left out of DR. While nothing is old enough, delivery numbers show as provisional.</div></div></div>' +
      '<div class="tw-card"><h3>Alert thresholds</h3><div class="tw-muted">Limits used by the automatic rules in Alerts Centre → Rules &amp; checks.</div>' +
        '<div class="tw-field"><label>ACM NDR floor (%)</label>' + num("stNdr", S.thresholds.acmNdrMin) + '</div>' +
        '<div class="tw-field"><label>ACM CR floor (%)</label>' + num("stAcr", S.thresholds.acmCrMin) + '</div>' +
        '<div class="tw-field"><label>ACM GMV pacing floor (%)</label>' + num("stPace", S.thresholds.acmPacingMin) + '</div>' +
        '<div class="tw-field"><label>Merchant NDR floor (%)</label>' + num("stMndr", S.thresholds.merchNdrMin) + '</div></div></div>' +
      '<div class="tw-savebar"><button class="btn btn-primary" id="stSave">Save settings</button><button class="btn" id="stReset">Reset to defaults</button><span class="tw-msg" id="stMsg"></span></div></div>';
    var read = function () { S.cutoffs.cr = +$("stCr").value; S.cutoffs.dr = +$("stDr").value; S.thresholds.acmNdrMin = +$("stNdr").value; S.thresholds.acmCrMin = +$("stAcr").value; S.thresholds.acmPacingMin = +$("stPace").value; S.thresholds.merchNdrMin = +$("stMndr").value; };
    $("stReset").onclick = function () { if (!confirm("Reset cutoffs and thresholds to defaults?")) return; S = { cutoffs: { cr: 2, dr: 5 }, thresholds: { acmNdrMin: 50, acmCrMin: 60, acmPacingMin: 70, merchNdrMin: 40 }, rules: S.rules }; C.saveSettings(S).then(function () { renderSettings(host); }).catch(function (e) { $("stMsg").className = "tw-msg err"; $("stMsg").textContent = e.message; }); };
    $("stSave").onclick = function () {
      read(); var m = $("stMsg"); m.className = "tw-msg"; m.textContent = "Saving…";
      C.saveSettings(S).then(function () { m.className = "tw-msg ok"; m.textContent = "Saved ✓"; try { prepareAcmTableData(window.__acmRows || []); applyTableSearchAndSort(); } catch (e) {} })
        .catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message + (e.status === 403 ? " — set the admin key in Users & Roles → Roles." : ""); });
    };
  }

  // ---------------------------------------------------------------- Activity Log
  var actQ = "", actType = "";
  var ACT_IC = { alert: "🔔", targets: "🎯", roles: "🛡️", settings: "🎚️", other: "•" };
  function renderActivity(host) {
    host.innerHTML = '<div class="tw-page"><div class="tw-card tw-muted">Loading…</div></div>';
    C.wfetch("getActivity", { admin: true, timeout: 10000 }).then(function (j) {
      var list = (j && j.list) || [];
      var types = list.map(function (x) { return x.type; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      function draw() {
        var q = actQ.toLowerCase();
        var rows = list.filter(function (x) { return (!actType || x.type === actType) && (!q || (x.text + x.actor + (x.detail || "")).toLowerCase().indexOf(q) >= 0); });
        $("actList").innerHTML = rows.length ? rows.slice(0, 120).map(function (x) { return '<div class="tw-tl"><span class="tw-tlic">' + (ACT_IC[x.type] || ACT_IC.other) + '</span><div class="tw-tl-main"><b>' + esc(x.text) + '</b><p>' + esc(x.actor || "system") + (x.role ? " · " + esc(x.role) : "") + (x.detail ? " · " + esc(x.detail) : "") + '</p></div><span class="tw-muted">' + ago(x.ts) + '</span></div>'; }).join("") : '<div class="tw-empty" style="padding:24px 0"><div class="tw-empty-ic">🗒️</div><div>No activity yet.</div></div>';
      }
      host.innerHTML = '<div class="tw-page"><div class="tw-toolbar"><input type="search" id="actQ" placeholder="Search activity" value="' + esc(actQ) + '" style="min-height:36px;padding:0 10px;min-width:220px"><select id="actT" style="min-height:36px;padding:0 10px"><option value="">All types</option>' + types.map(function (t) { return '<option' + (t === actType ? " selected" : "") + '>' + esc(t) + '</option>'; }).join("") + '</select><span class="tw-grow"></span><button class="btn" id="actExp">Export CSV</button></div><div class="tw-card"><div id="actList" class="tw-timeline"></div></div></div>';
      draw();
      $("actQ").oninput = function (e) { actQ = e.target.value; draw(); };
      $("actT").onchange = function (e) { actType = e.target.value; draw(); };
      $("actExp").onclick = function () {
        var csv = "Time,Who,Role,Type,What,Detail\n" + list.map(function (x) { return [x.ts, x.actor, x.role, x.type, x.text, x.detail].map(function (v) { return '"' + String(v || "").replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
        var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "activity-log.csv"; document.body.appendChild(a); a.click(); a.remove();
      };
    }).catch(function (e) { host.innerHTML = '<div class="tw-page"><div class="tw-card"><div class="tw-msg err">' + esc(e.message) + (e.status === 403 ? " — set the admin key in Users & Roles → Roles." : "") + '</div></div></div>'; });
  }

  function boot() {
    C = window.TowerCore; var ok = false; try { ok = typeof state !== "undefined"; } catch (e) {} if (!C || !ok) { setTimeout(boot, 300); return; }
    C.registerView("towerSettings", { sectionId: "viewTowerSettings", navId: "navTowerSettings", label: "Settings", sub: "Metric cutoffs and alert thresholds", render: function (h) { C.loadSettings().then(function () { renderSettings(h); }); renderSettings(h); } });
    C.registerView("towerActivity", { sectionId: "viewTowerActivity", navId: "navTowerActivity", label: "Activity Log", sub: "Every change made from this dashboard", render: renderActivity });
    hookAcmRows(); hookMerchantRows(); setInterval(function () { hookAcmRows(); hookMerchantRows(); }, 2000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 120); }); else setTimeout(boot, 120);
})();
