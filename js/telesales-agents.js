/* Telesales → Agents Performance (v1.18.0)
   Agent and Team-Leader (TL) performance of the Telesales team. Read straight from the Telesales_Data Google Sheet — it does not use Main:
     • "Agent's_Performance" (GID 0): one row per agent per day.   • "Team" (GID 570707782): TL, Agent Name, Taager ID (joined to TELESALES_AGENT_ID).
   CM3 and CM3/Pc are the exception: the sheet has no CM3 and Main has no agent id, so they are the Telesales merchant's (1160154) own totals from Main (CM3 cut-off), shown as cards only.
   CM3% = CM3 ÷ Delivered GMV of the same cut-off days. PPM% = PPM ÷ Delivered GMV (same as the other pages), per agent / TL / total.
   Every other number is the sheet's own column, summed over the picked dates. Ratios are re-computed from the sums with the same formula the sheet uses
   (checked against every row of the sheet), so a rate is never an average of daily rates:
     • AOV = Conf GMV ÷ Confirmed Orders. ABS = Pieces incl. warranty ÷ Confirmed Orders. Basket Size = Pieces ÷ Confirmed Orders (excl. / incl. warranty).
     • Delivery Rate (Pcs) = Delivered Pcs ÷ Confirmed Pcs. Delivery Rate (Orders) = Delivered Orders ÷ Confirmed Orders.
     • Fake Rate = Fake ÷ Confirmed (pieces / orders). Aftersales Rate = Aftersales Orders ÷ Confirmed Orders.
     • Orders/Day, GMV/Day = ÷ Days Worked. Expected Monthly GMV (and Delivered) = per-day × 22, the same as the sheet. A TL / total = sum of its agents' expected.
     • ASP and PPM/Pc: the sheet's per-piece value × its pieces gives a clean total (ASP × Pieces incl., PPM/Pc × the matching pieces), so the totals are summed and divided by the pieces. */
(function () {
  "use strict";
  var SHEET = "1cq3gbvtRuSi0VFHp1E-jV5VuM1AoUeZzzEVSCzVrKx0", GID_PERF = "0", GID_TEAM = "570707782", VIEW = "telesalesAgents", WORK_DAYS = 22;
  var AG = { q: "", sort: "gmv", dir: -1, tl: "", from: "", to: "", raw: null, err: "", loading: false, chart: null, at: 0 };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v) { return v == null || !isFinite(v) ? "—" : Math.round(+v).toLocaleString("en-US"); }
  function dec(v, n) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n }); }
  function pct(v) { return v == null || !isFinite(v) ? "—" : (+v).toFixed(1) + "%"; }
  function money(v) { return v == null || !isFinite(v) ? "—" : (typeof fmtMoneyExact === "function" ? fmtMoneyExact(v) : "EGP " + int(v)); }
  function moneyC(v) { return v == null || !isFinite(v) ? "—" : (typeof fmtMoneyCompact === "function" ? fmtMoneyCompact(v) : "EGP " + int(v)); }
  function num(v) { if (v == null || v === "") return 0; if (typeof v === "number") return v; var x = parseFloat(String(v).replace(/[,%\s]/g, "")); return isFinite(x) ? x : 0; }
  function div(a, b) { return b ? a / b : null; }

  // ---- loading (gviz JSONP, the same way the dashboard reads its own sheet) ----
  var cbN = 0;
  function loadGid(gid) {
    return new Promise(function (resolve, reject) {
      var cb = "__tsAgCb" + Date.now() + "_" + (cbN++), s = document.createElement("script"), done = false;
      var end = function () { try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.remove(); clearTimeout(t); };
      var t = setTimeout(function () { if (done) return; done = true; end(); reject(new Error("Timeout reading the sheet")); }, 30000);
      window[cb] = function (p) { if (done) return; done = true; end(); if (p && p.status === "error") reject(new Error((p.errors && p.errors[0] && (p.errors[0].detailed_message || p.errors[0].message)) || "Sheet returned an error")); else resolve(p); };
      s.src = "https://docs.google.com/spreadsheets/d/" + SHEET + "/gviz/tq?gid=" + gid + "&tqx=out:json;responseHandler:" + cb;
      s.onerror = function () { if (done) return; done = true; end(); reject(new Error("Could not reach the sheet")); };
      document.head.appendChild(s);
    });
  }
  // gviz payload → array of {HEADER: value}
  function rowsOf(p) {
    var t = p && p.table; if (!t) return [];
    var cols = (t.cols || []).map(function (c) { return String(c.label || "").trim(); }), rows = (t.rows || []).map(function (r) { return (r.c || []).map(function (c) { return c ? (c.v != null ? c.v : (c.f != null ? c.f : "")) : ""; }); });
    if (!cols.some(function (c) { return c; }) && rows.length) cols = rows.shift().map(function (c) { return String(c || "").trim(); });   // header came back as a data row
    return rows.map(function (r) { var o = {}; cols.forEach(function (c, i) { if (c) o[c] = r[i] == null ? "" : r[i]; }); return o; });
  }
  function dayKey(v) {
    if (v == null || v === "") return "";
    var m = /^Date\((\d+),(\d+),(\d+)/.exec(String(v));
    var d = m ? new Date(+m[1], +m[2], +m[3]) : new Date(String(v));
    if (isNaN(d)) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function cap(s) { s = String(s || "").trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function parse(perfP, teamP) {
    var team = new Map();
    rowsOf(teamP).forEach(function (r) { var id = String(r["Taager ID"] == null ? "" : r["Taager ID"]).trim(); if (id) team.set(id, { tl: cap(String(r["TL"] || "").toLowerCase()), name: String(r["Agent Name"] || "").trim() }); });
    var names = new Map(), recs = [];
    rowsOf(perfP).forEach(function (r) {
      var id = String(r["TELESALES_AGENT_ID"] == null ? "" : r["TELESALES_AGENT_ID"]).trim(), day = dayKey(r["DATE_GROUP"]);
      if (!id || !day) return;
      var nm = String(r["TELESALES_AGENT_NAME"] || "").trim(); if (nm && !names.has(id)) names.set(id, nm);
      var pIn = num(r["PIECES_INCL_WARRANTY"]), pEx = num(r["PIECES_EXCL_WARRANTY"]);
      recs.push({ id: id, day: day, days: num(r["DAYS"]), co: num(r["CONFIRMED_ORDERS"]), cp: num(r["CONFIRMED_PIECES"]), so: num(r["SHIPPED_ORDERS"]), sp: num(r["SHIPPED_PIECES"]), gmv: num(r["CONF_GMV"]),
        pIn: pIn, pEx: pEx, aspTot: num(r["ASP"]) * pIn, ppmEx: num(r["PPM_PER_PIECE_EXCL_WARRANTY"]) * pEx, ppmIn: num(r["PPM_PER_PIECE_INCL_WARRANTY"]) * pIn,
        dp: num(r["DELIVERED_PIECES"]), dord: num(r["DELIVERED_ORDERS"]), dgmv: num(r["DELIVERED_GMV"]), fp: num(r["FAKE_PIECES"]), fo: num(r["FAKE_ORDERS"]), fg: num(r["FAKE_GMV"]),
        ao: num(r["AFTERSALES_ORDERS"]), ap: num(r["AFTERSALES_PIECES"]) });
    });
    return { team: team, names: names, recs: recs };
  }
  function load(host, force) {
    if (AG.loading) return; if (AG.raw && !force) return;
    AG.loading = true; AG.err = ""; render(host);
    Promise.all([loadGid(GID_PERF), loadGid(GID_TEAM)]).then(function (r) { AG.raw = parse(r[0], r[1]); AG.at = Date.now(); AG.loading = false; render(host); })
      .catch(function (e) { AG.err = e && e.message ? e.message : String(e); AG.loading = false; render(host); });
  }

  // ---- maths ----
  var SUMS = { days: 1, co: 1, cp: 1, so: 1, sp: 1, gmv: 1, pIn: 1, pEx: 1, aspTot: 1, ppmEx: 1, ppmIn: 1, dp: 1, dord: 1, dgmv: 1, fp: 1, fo: 1, fg: 1, ao: 1, ap: 1 };   // the only fields that are added up
  function bucket() { return { days: 0, co: 0, cp: 0, so: 0, sp: 0, gmv: 0, pIn: 0, pEx: 0, aspTot: 0, ppmEx: 0, ppmIn: 0, dp: 0, dord: 0, dgmv: 0, fp: 0, fo: 0, fg: 0, ao: 0, ap: 0, expGmv: 0, expDgmv: 0, agents: 0 }; }
  function addTo(b, r) { for (var k in b) if (SUMS[k] && typeof r[k] === "number") b[k] += r[k]; }
  function finish(b) {
    b.ordersDay = div(b.co, b.days); b.gmvDay = div(b.gmv, b.days); b.aov = div(b.gmv, b.co); b.abs = div(b.pIn, b.co); b.basketEx = div(b.pEx, b.co); b.basketIn = div(b.pIn, b.co);
    b.ppmPct = b.dgmv ? 100 * b.ppmIn / b.dgmv : null; b.asp = div(b.aspTot, b.pIn); b.ppmPcEx = div(b.ppmEx, b.pEx); b.ppmPcIn = div(b.ppmIn, b.pIn);
    b.drPcs = b.cp ? 100 * b.dp / b.cp : null; b.drOrd = b.co ? 100 * b.dord / b.co : null;
    b.fakeOrdPct = b.co ? 100 * b.fo / b.co : null; b.fakePcsPct = b.cp ? 100 * b.fp / b.cp : null; b.asRate = b.co ? 100 * b.ao / b.co : null;
    return b;
  }
  function compute() {
    var R = AG.raw; if (!R) return null;
    var inRange = R.recs.filter(function (r) { return (!AG.from || r.day >= AG.from) && (!AG.to || r.day <= AG.to); });
    var byAgent = new Map(), dayMap = new Map();
    inRange.forEach(function (r) {
      var t = R.team.get(r.id), tl = t ? (t.tl || "No TL") : "No TL";
      if (AG.tl && tl !== AG.tl) return;
      var a = byAgent.get(r.id); if (!a) { a = bucket(); a.id = r.id; a.tl = tl; a.name = (t && t.name) || R.names.get(r.id) || r.id; byAgent.set(r.id, a); }
      addTo(a, r);
      var d = dayMap.get(r.day) || { cp: 0, dp: 0 }; d.cp += r.cp; d.dp += r.dp; dayMap.set(r.day, d);
    });
    var agents = [], tls = new Map(), tot = bucket();
    byAgent.forEach(function (a) {
      a.expGmv = a.days ? a.gmv / a.days * WORK_DAYS : 0; a.expDgmv = a.days ? a.dgmv / a.days * WORK_DAYS : 0; finish(a); agents.push(a);
      var t = tls.get(a.tl); if (!t) { t = bucket(); t.name = a.tl; tls.set(a.tl, t); }
      addTo(t, a); t.expGmv += a.expGmv; t.expDgmv += a.expDgmv; t.agents++;
      addTo(tot, a); tot.expGmv += a.expGmv; tot.expDgmv += a.expDgmv; tot.agents++;
    });
    tls.forEach(finish); finish(tot);
    var dates = R.recs.map(function (r) { return r.day; }).sort();
    return { agents: agents, tls: Array.from(tls.values()).sort(function (a, b) { return b.gmv - a.gmv; }), tot: tot, days: Array.from(dayMap.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }),
      min: dates[0] || "", max: dates[dates.length - 1] || "", tlNames: Array.from(new Set(Array.from(R.team.values()).map(function (t) { return t.tl; }).concat(R.recs.some(function (r) { return !R.team.has(r.id); }) ? ["No TL"] : []))).filter(Boolean).sort() };
  }

  // [key, title, isNumber, tooltip]
  // CM3 is not in the Telesales_Data sheet and Main has no agent id, so CM3 and CM3/Pc here are the Telesales merchant's (1160154) own numbers from Main —
  // one figure for the whole team in the picked dates, not split per agent / TL. Same maths as the Telesales Performance page:
  // CM3 only on days up to the CM3 cut-off (latest data day of all merchants − CM3_LAG_DAYS); CM3/Pc = CM3 ÷ Delivered pcs of those same days.
  var MID = "1160154";
  function dayStart(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); }
  function mainCm3() {
    var all = []; try { all = state.allParsedRows || []; } catch (e) { all = []; }
    if (!all.length) return { loaded: false };
    var cut = getCm3LagCutoffTimestamp(all), cm3Gmv = 0, from = AG.from ? dayStart(AG.from) : 0, to = AG.to ? dayStart(AG.to) : Infinity, cm3 = 0, dlv = 0, rows = 0;
    all.forEach(function (r) {
      if (String(r.merchantId || "").trim() !== MID || !r.timestamp) return;
      var d = new Date(r.timestamp); d.setHours(0, 0, 0, 0); var t = d.getTime();
      if (t < from || t > to) return;
      rows++;
      if (isRowEligibleForLag(r, cut, "telesales")) dlv += r.deliveredPieces || 0;
      if (isCm3RowEligible(r, cut, "telesales")) { cm3 += r.cm3 || 0; cm3Gmv += r.deliveredGmv || 0; }
    });
    return { loaded: true, cut: cut, cm3: cm3, perPc: dlv ? cm3 / dlv : null, pct: cm3Gmv ? 100 * cm3 / cm3Gmv : null, rows: rows };
  }
  function mainSig() { var a = []; try { a = state.allParsedRows || []; } catch (e) {} return a.length + ":" + (a[0] && a[0].timestamp) + ":" + (a[a.length - 1] && a[a.length - 1].timestamp); }

  var COLS = [
    ["name", "Agent", 0], ["tl", "TL", 0], ["id", "Agent ID", 0],
    ["days", "Days Worked", 1, "Sum of DAYS in the sheet (1 = worked that day)."],
    ["co", "Confirmed Orders", 1], ["cp", "Confirmed Pcs", 1], ["so", "Shipped Orders", 1], ["sp", "Shipped Pcs", 1],
    ["ordersDay", "Orders/Day", 1, "Confirmed Orders ÷ Days Worked."], ["gmv", "Conf GMV", 1], ["gmvDay", "GMV/Day", 1, "Conf GMV ÷ Days Worked."],
    ["expGmv", "Expected Monthly GMV", 1, "GMV/Day × 22 — the same formula as the sheet. A TL or the total is the sum of its agents."],
    ["aov", "AOV", 1, "Conf GMV ÷ Confirmed Orders."], ["abs", "ABS", 1, "Pieces incl. warranty ÷ Confirmed Orders."],
    ["basketEx", "Basket Size (excl. warranty)", 1, "Pieces excl. warranty ÷ Confirmed Orders."], ["basketIn", "Basket Size (incl. warranty)", 1, "Pieces incl. warranty ÷ Confirmed Orders."],
    ["asp", "ASP", 1, "The sheet's ASP, weighted by Pieces incl. warranty."], ["ppmPcEx", "PPM/Pc (excl. warranty)", 1, "The sheet's PPM per piece, weighted by Pieces excl. warranty."], ["ppmPcIn", "PPM/Pc (incl. warranty)", 1, "The sheet's PPM per piece, weighted by Pieces incl. warranty."], ["ppmPct", "PPM%", 1, "PPM (the sheet's PPM/Pc incl. warranty × Pieces incl. warranty) ÷ Delivered GMV — the same definition as the other pages."],
    ["dord", "Delivered Orders", 1], ["dp", "Delivered Pcs", 1], ["dgmv", "Delivered GMV", 1], ["expDgmv", "Expected Monthly Delivered GMV", 1, "Delivered GMV ÷ Days Worked × 22 — the same formula as the sheet."],
    ["drOrd", "Delivery Rate (Orders)", 1, "Delivered Orders ÷ Confirmed Orders."], ["drPcs", "Delivery Rate (Pcs)", 1, "Delivered Pcs ÷ Confirmed Pcs."],
    ["fo", "Fake Orders", 1], ["fp", "Fake Pcs", 1], ["fg", "Fake GMV", 1], ["fakeOrdPct", "Fake Rate (Orders)", 1, "Fake Orders ÷ Confirmed Orders."], ["fakePcsPct", "Fake Rate (Pcs)", 1, "Fake Pcs ÷ Confirmed Pcs."],
    ["ao", "Aftersales Orders", 1], ["ap", "Aftersales Pcs", 1], ["asRate", "Aftersales Rate", 1, "Aftersales Orders ÷ Confirmed Orders."]
  ];
  var MONEY = { gmv: 1, gmvDay: 1, expGmv: 1, aov: 1, asp: 1, ppmPcEx: 1, ppmPcIn: 1, dgmv: 1, expDgmv: 1, fg: 1 }, PCT = { ppmPct: 1, drOrd: 1, drPcs: 1, fakeOrdPct: 1, fakePcsPct: 1, asRate: 1 }, D1 = { ordersDay: 1, abs: 1, basketEx: 1, basketIn: 1 };
  function cell(r, k) {
    var v = r[k];
    if (MONEY[k]) return money(v); if (PCT[k]) return pct(v); if (D1[k]) return dec(v, 2);
    return typeof v === "number" ? int(v) : esc(v == null || v === "" ? "—" : v);
  }
  function sortRows(rows) {
    var k = AG.sort, dir = AG.dir, q = AG.q.trim().toLowerCase();
    rows = rows.filter(function (r) { return !q || String(r.name).toLowerCase().indexOf(q) >= 0 || String(r.id).indexOf(q) >= 0 || String(r.tl).toLowerCase().indexOf(q) >= 0; });
    return rows.sort(function (a, b) { var x = a[k], y = b[k]; if (typeof x === "string" || typeof y === "string") return dir * String(x || "").localeCompare(String(y || "")); return dir * ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)); });
  }
  function dayText(k) { if (!k) return "—"; var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }

  function table(title, sub, rows, cols, id, firstKey) {
    var th = function (c) { return '<th class="' + (c[2] ? "num" : "") + '" style="cursor:pointer;white-space:nowrap" data-ags="' + c[0] + '"' + (c[3] ? ' title="' + esc(c[3]) + '"' : "") + '>' + c[1] + (AG.sort === c[0] ? (AG.dir < 0 ? " ↓" : " ↑") : "") + '</th>'; };
    return '<div class="table-responsive"><table class="data-table" id="' + id + '"><thead><tr>' + cols.map(th).join("") + '</tr></thead><tbody>' +
      (rows.map(function (r) { return '<tr' + (r._tot ? ' style="font-weight:700"' : "") + '>' + cols.map(function (c) { return '<td class="' + (c[2] ? "num" : "") + (c[0] === "id" ? " font-mono" : "") + '">' + cell(r, c[0]) + '</td>'; }).join("") + '</tr>'; }).join("") ||
        '<tr><td colspan="' + cols.length + '" class="text-dim" style="text-align:center;padding:18px">No rows for this selection.</td></tr>') + '</tbody></table></div>';
  }

  function render(host) {
    if (AG.loading && !AG.raw) { host.innerHTML = '<div class="sc-note">Reading the Telesales_Data sheet…</div>'; return; }
    if (AG.err && !AG.raw) {
      host.innerHTML = '<div class="panel" style="padding:18px"><h3 style="margin:0 0 6px">Could not read the Telesales_Data sheet</h3><p class="text-dim" style="margin:0 0 10px">' + esc(AG.err) + '. The dashboard reads the sheet like its other sheets, so Telesales_Data has to be shared as “Anyone with the link – Viewer”.</p><button class="btn btn-outline small" id="tagRetry">Retry</button></div>';
      var b = host.querySelector("#tagRetry"); if (b) b.addEventListener("click", function () { AG.raw = null; load(host, true); }); return;
    }
    if (!AG.raw) { load(host); return; }
    var d = compute(), T = d.tot, tlRows = d.tls.map(function (t) { return Object.assign({ _tl: 1, tl: t.name, name: t.name + " (" + t.agents + " agents)", id: "" }, t); });
    var allRow = Object.assign({ _tot: 1, name: "Total (" + T.agents + " agents)", tl: "", id: "" }, T);
    var agents = sortRows(d.agents.slice()), per = (AG.from || d.min) && (AG.to || d.max) ? dayText(AG.from || d.min) + " – " + dayText(AG.to || d.max) : "all days";
    var tiles = [["Agents", int(T.agents), "with rows in the selection"], ["Days Worked", int(T.days), "sum of agent-days"], ["Confirmed Orders", int(T.co), int(T.cp) + " pcs"], ["Conf GMV", moneyC(T.gmv), "AOV " + moneyC(T.aov)],
      ["Expected Monthly GMV", moneyC(T.expGmv), "per-day × 22"], ["Delivered GMV", moneyC(T.dgmv), int(T.dp) + " pcs"], ["Delivery Rate (Pcs)", pct(T.drPcs), "Delivered ÷ Confirmed pcs"], ["Fake Rate (Orders)", pct(T.fakeOrdPct), int(T.fo) + " fake orders"],
      ["Aftersales Rate", pct(T.asRate), int(T.ao) + " orders"], ["ASP", moneyC(T.asp), "weighted by pieces"], ["PPM/Pc (incl. warranty)", moneyC(T.ppmPcIn), "excl.: " + moneyC(T.ppmPcEx)], ["PPM%", pct(T.ppmPct), "PPM ÷ Delivered GMV"]];
    var M = mainCm3(), mNote = !M.loaded ? "Main is still loading" : (AG.tl ? "whole team — not split by TL" : "merchant " + MID + " (Main) · up to " + new Date(M.cut).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }));
    tiles.push(["CM3", M.loaded ? moneyC(M.cm3) : "—", mNote], ["CM3/Pc", M.loaded ? moneyC(M.perPc) : "—", "CM3 ÷ Delivered pcs, same days"], ["CM3%", M.loaded ? pct(M.pct) : "—", "CM3 ÷ Delivered GMV, same days"]);
    var tlOpts = '<option value="">All TLs</option>' + d.tlNames.map(function (n) { return '<option value="' + esc(n) + '"' + (AG.tl === n ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("");
    var html = '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Agents Performance</h2>' +
      '<p>Telesales agents and TLs · ' + esc(per) + ' · from the Telesales_Data sheet (Agent\'s_Performance + Team), CM3 from Main. Delivered numbers of the latest days are still maturing.</p></div>' +
      '<div class="table-controls" style="gap:8px;flex-wrap:wrap"><label class="text-dim" style="font-size:12px">From <input id="tagFrom" type="date" class="date-filter-input" min="' + d.min + '" max="' + d.max + '" value="' + AG.from + '"></label>' +
      '<label class="text-dim" style="font-size:12px">To <input id="tagTo" type="date" class="date-filter-input" min="' + d.min + '" max="' + d.max + '" value="' + AG.to + '"></label>' +
      '<select id="tagTl" class="date-filter-input">' + tlOpts + '</select><button class="btn btn-outline small" id="tagRefresh">Refresh</button></div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + esc(t[2]) + '</small></div>'; }).join("") + '</div></div>';
    html += '<div class="panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Daily Pieces</h2><p>Confirmed and Delivered pieces per day — all agents in the selection</p></div></div><div style="height:240px;padding:0 18px 16px"><canvas id="tagChart"></canvas></div></div>';
    html += '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Team Leaders</h2><p>Each TL = the sum of their agents · hover a column title for how it is calculated</p></div></div>' +
      table("", "", tlRows.concat([allRow]), COLS.filter(function (c) { return c[0] !== "tl" && c[0] !== "id"; }), "tagTlTable") + '</div>';
    html += '<div class="panel table-panel hover-glow"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Agents</h2><p>' + int(agents.length) + ' agents · click a column title to sort</p></div>' +
      '<div class="table-controls" style="gap:8px;flex-wrap:wrap"><input id="tagQ" type="search" class="date-filter-input" style="min-width:220px" placeholder="Search agent, ID or TL" value="' + esc(AG.q) + '"><button class="btn btn-outline small tw-exp" data-csv="own" id="tagCsv">Export CSV</button></div></div>' +
      table("", "", agents, COLS, "tagTable") + '</div>';
    host.innerHTML = html; draw(d); watch(host);
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("tagFrom", "change", function (e) { AG.from = e.target.value; render(host); }); on("tagTo", "change", function (e) { AG.to = e.target.value; render(host); });
    on("tagTl", "change", function (e) { AG.tl = e.target.value; render(host); }); on("tagRefresh", "click", function () { AG.raw = null; load(host, true); });
    on("tagQ", "input", function (e) { AG.q = e.target.value; render(host); var el = host.querySelector("#tagQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    host.querySelectorAll("[data-ags]").forEach(function (h) { h.addEventListener("click", function () { var k = h.dataset.ags; if (AG.sort === k) AG.dir = -AG.dir; else { AG.sort = k; AG.dir = (k === "name" || k === "tl" || k === "id") ? 1 : -1; } render(host); }); });
    on("tagCsv", "click", function () {
      var r2 = function (v) { return v == null || !isFinite(v) ? "" : Math.round(v * 100) / 100; }, lines = [COLS.map(function (c) { return c[1]; })].concat(agents.map(function (r) { return COLS.map(function (c) { var v = r[c[0]]; return typeof v === "number" ? r2(v) : (v == null ? "" : v); }); }));
      var csv = "﻿" + lines.map(function (l) { return l.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "telesales-agents.csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }
  function draw(d) {
    var cv = $("tagChart"); if (!cv || typeof Chart === "undefined") return;
    if (AG.chart) { try { AG.chart.destroy(); } catch (e) {} AG.chart = null; }
    AG.chart = new Chart(cv.getContext("2d"), {
      data: { labels: d.days.map(function (x) { return dayText(x[0]); }), datasets: [
        { type: "bar", label: "Confirmed Pcs", data: d.days.map(function (x) { return x[1].cp; }), backgroundColor: "rgba(167,139,250,.55)", borderRadius: 4, order: 2 },
        { type: "line", label: "Delivered Pcs", data: d.days.map(function (x) { return x[1].dp; }), borderColor: "#34d399", backgroundColor: "#34d399", tension: .3, pointRadius: 2, order: 1 } ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: "#94a3b8" } } },
        scales: { x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } }, y: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } } } }
    });
  }
  var watchT = 0, lastSig = "";
  function watch(host) {
    clearInterval(watchT); lastSig = mainSig();
    watchT = setInterval(function () {
      var sec = $("viewTelesalesAgents"); if (!sec || sec.classList.contains("hidden")) { clearInterval(watchT); return; }
      if (mainSig() !== lastSig && AG.raw) render(host);
    }, 1500);
  }
  window.TaagerTelesalesAgents = { parse: parse, state: AG, compute: function () { return compute(); }, load: function (h) { AG.raw = null; load(h || document.body, true); } };

  function boot() {
    var C = window.TowerCore; if (!C || !C.registerView) { setTimeout(boot, 300); return; }
    C.registerView(VIEW, { sectionId: "viewTelesalesAgents", navId: "navTelesalesAgents", label: "Agents Performance", sub: "Telesales agents and TLs · from the Telesales_Data sheet", open: true, render: function (h) { if (!AG.raw && !AG.loading) AG.err = ""; render(h); } });   // opening the tab again retries a failed read
    var nav = $("navTelesalesAgents"); if (nav && !nav.dataset.ts) { nav.dataset.ts = "1"; nav.addEventListener("click", function () { window.switchView(VIEW); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 160); }); else setTimeout(boot, 160);
})();
