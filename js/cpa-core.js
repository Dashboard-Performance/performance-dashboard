/* Taager RE-CPA (v1.17.0) — Max CPA calculator: the same core runs in the staff dashboard (Merchants → RE-CPA)
   and in the merchant portal (RE-CPA tab). No inline styles (the portal CSP forbids them) — classes live in css/cpa.css.
   Source of truth: this file. `node tools/sync-cpa.mjs` copies it (and css/cpa.css) into merchant-portal/src/cpa-core.js.

   The math (per SKU row):
     ASP (merchant's real selling price)  = AVE Market − shipping fee the customer pays (default 99)
     Margin per delivered piece           = Taager profit + (ASP − Taager selling price)          ← "Top up for pic"
     NDR                                  = CR × DR   (or typed in)
     Max CPA (break-even)                 = Margin × NDR      → paying more than this per conversion loses money
     Safe CPA                             = Max CPA × (1 − safety %)
     Ad spend                             = Actual CPA × conversions
     Delivered pieces                     = conversions × NDR
     Net profit                           = delivered × margin − ad spend
*/
(function (root) {
  "use strict";
  function n(v) { if (v === "" || v == null) return null; var x = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s%]/g, "")); return isFinite(x) ? x : null; }
  function pct(v) { var x = n(v); if (x == null) return null; return x > 1 ? x / 100 : x; } // 32 or 0.32 → 0.32

  function calc(r, cfg) {
    cfg = cfg || {};
    var ship = n(cfg.shipping); if (ship == null) ship = 99;
    var safety = n(cfg.safetyPct); if (safety == null) safety = 20;
    var price = n(r.price), profit = n(r.profit), market = n(r.market), cpa = n(r.cpa), conv = n(r.conv);
    var cr = pct(r.cr), dr = pct(r.dr), ndrIn = pct(r.ndrOverride);
    var ndr = ndrIn != null ? ndrIn : (cr != null && dr != null ? cr * dr : null);
    var o = { price: price, profit: profit, market: market, cpa: cpa, conv: conv, ndr: ndr, ndrManual: ndrIn != null, ship: ship, safety: safety };
    o.asp = market != null ? market - ship : price;
    o.margin = profit != null && o.asp != null && price != null ? profit + (o.asp - price) : null;
    o.maxCpa = o.margin != null && ndr != null ? o.margin * ndr : null;
    o.safeCpa = o.maxCpa != null ? o.maxCpa * (1 - safety / 100) : null;
    o.spend = cpa != null && conv != null ? cpa * conv : null;
    o.delivered = conv != null && ndr != null ? conv * ndr : null;
    o.gross = o.delivered != null && o.margin != null ? o.delivered * o.margin : null;
    o.net = o.gross != null ? o.gross - (o.spend || 0) : null;
    o.perConv = o.margin != null && ndr != null && cpa != null ? ndr * o.margin - cpa : null;
    o.roi = o.spend ? o.net / o.spend : null;
    o.breakEvenNdr = cpa != null && o.margin > 0 ? cpa / o.margin : null;
    o.breakEvenMarket = cpa != null && ndr > 0 && profit != null && price != null ? cpa / ndr - profit + price + ship : null;
    if (o.margin == null || ndr == null) o.status = "incomplete";
    else if (o.margin <= 0) o.status = "noMargin";
    else if (cpa == null) o.status = "noCpa";
    else if (cpa <= o.safeCpa) o.status = "safe";
    else if (cpa <= o.maxCpa) o.status = "thin";
    else o.status = "losing";
    return o;
  }
  var STATUS = { safe: ["Profitable", "good"], thin: ["Thin margin", "warn"], losing: ["Losing money", "bad"], noMargin: ["No margin", "bad"], noCpa: ["Enter CPA", ""], incomplete: ["Missing data", ""] };
  function money(v) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v); return (v < 0 ? "-" : "") + "EGP " + (a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "K" : Math.round(a).toLocaleString("en-US")); }
  function p1(v) { return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%"; }

  // plain-language suggestions for one row (o = calc result, r = row with productNdr/src)
  function suggestions(r, o) {
    var s = [];
    if (o.status === "incomplete") { s.push(["", "Add the price, profit and CR/DR (or type the NDR) to see the numbers."]); return s; }
    if (o.margin <= 0) {
      s.push(["bad", "At AVE Market " + money(o.market) + " you earn " + money(o.margin) + " on each delivered piece — any ad spend is a loss."]);
      s.push(["", "Sell at a market price above " + money(o.price - o.profit + o.ship) + " to have a margin at all."]);
      return s;
    }
    if (o.cpa == null) s.push(["", "Keep your CPA under " + money(o.safeCpa) + " (safe) — never above " + money(o.maxCpa) + " (break-even)."]);
    else if (o.status === "losing") {
      s.push(["bad", "You lose " + money(-o.perConv) + " on every conversion (CPA " + money(o.cpa) + " > Max CPA " + money(o.maxCpa) + ")."]);
      s.push(["", "Bring CPA down to " + money(o.safeCpa) + " or less (better targeting, creatives, stop the weakest ad sets)."]);
      if (o.breakEvenMarket != null) s.push(["", "Or raise the market price to at least " + money(o.breakEvenMarket) + " to break even at this CPA."]);
      if (o.breakEvenNdr != null && o.breakEvenNdr <= 1) s.push(["", "Or lift NDR to " + p1(o.breakEvenNdr) + " (now " + p1(o.ndr) + "): confirm orders fast, correct addresses, follow up on delivery."]);
      else s.push(["bad", "Even 100% NDR would not cover this CPA — change the price or the ads."]);
    } else if (o.status === "thin") {
      s.push(["warn", "Profitable, but only " + money(o.perConv) + " per conversion. A small NDR drop turns it into a loss."]);
      s.push(["", "Target CPA ≤ " + money(o.safeCpa) + " to keep a " + o.safety + "% safety margin."]);
    } else {
      s.push(["good", "Healthy: " + money(o.perConv) + " profit per conversion, " + money(o.maxCpa - o.cpa) + " of room below Max CPA."]);
      s.push(["", "Room to scale: every extra 100 conversions ≈ " + money(o.perConv * 100) + " more profit, if CPA holds."]);
    }
    if (o.market != null && o.asp < o.price) s.push(["warn", "Your selling price (" + money(o.asp) + " after shipping) is below Taager's price " + money(o.price) + " — you give away " + money(o.price - o.asp) + " per piece."]);
    if (r.productNdr != null && o.ndr != null && !o.ndrManual && r.src === "merchant" && o.ndr < r.productNdr * 0.9) s.push(["warn", "Your NDR " + p1(o.ndr) + " is below the product average " + p1(r.productNdr) + " — the gap is in confirmation / delivery, not the ads."]);
    if (r.src === "product" && !o.ndrManual) s.push(["", "CR/DR are the product's average (not enough of your own orders yet). Type your real NDR when you have it."]);
    return s;
  }
  // net profit per 100 conversions for CPA ±20% × NDR ±5 points
  function sensitivity(r, cfg) {
    var base = calc(r, cfg); if (base.margin == null || base.ndr == null) return null;
    var cpa0 = base.cpa != null ? base.cpa : base.safeCpa || 0, cpas = [cpa0 * 0.8, cpa0, cpa0 * 1.2], ndrs = [Math.max(0, base.ndr - 0.05), base.ndr, Math.min(1, base.ndr + 0.05)];
    return { cpas: cpas, ndrs: ndrs, grid: ndrs.map(function (d) { return cpas.map(function (c) { return (d * base.margin - c) * 100; }); }) };
  }

  // ---------------------------------------------------------------- UI (adapter-driven)
  // A = { esc, cfg(), load() → Promise<{rows, updatedAt}>, save(rows) → Promise, lookup(q) → Promise<[{sku, n}]>, rates(sku) → Promise<{sku, n, price, profit, cr, dr, src, productNdr}>,
  //       skuOptions() → [{sku, n}], title, sub, extraHead (html), onHead(el), readOnlyNote }
  function mount(host, A) {
    var esc = A.esc, rows = [], sel = -1, dirty = false;
    host.innerHTML = '<div class="tw-page cpa"><div class="tw-card"><div class="cpa-head"><div><h3>' + esc(A.title || "RE-CPA · Max CPA calculator") + '</h3><div class="tw-muted">' + esc(A.sub || "Type AVE Market, your actual CPA and conversions — Max CPA is calculated so you never advertise at a loss.") + '</div></div>' +
      '<div class="cpa-actions">' + (A.extraHead || "") + '</div></div>' +
      '<div class="cpa-add"><input class="cpa-in-sku" list="cpaSkuList" placeholder="Add SKU (e.g. EG030107CLAN99)" autocomplete="off"><datalist id="cpaSkuList"></datalist><button type="button" class="btn btn-primary cpa-addbtn">Add SKU</button><span class="cpa-grow"></span><span class="tw-muted cpa-cfgnote"></span><button type="button" class="btn cpa-save">Save</button><button type="button" class="btn cpa-csv">Export CSV</button><span class="tw-msg cpa-msg"></span></div></div>' +
      '<div class="tw-stats cpa-kpis"></div><div class="tw-card cpa-tablecard"><div class="tw-scroll"><table class="tw-table cpa-table"><thead><tr>' +
      ["SKU", "Product", "CR", "DR", "NDR", "Taager price", "Profit", "AVE Market", "ASP", "Margin / piece", "Actual CPA", "Max CPA", "Safe CPA", "Conversions", "Ad spend", "Net profit", "Status", ""].map(function (h, i) { return "<th" + (i >= 2 && i <= 15 ? ' class="r"' : "") + ">" + h + "</th>"; }).join("") +
      '</tr></thead><tbody class="cpa-body"></tbody></table></div><div class="tw-muted cpa-foot"></div></div><div class="tw-card cpa-detail"></div></div>';
    var $q = function (c) { return host.querySelector(c); };
    if (A.onHead) A.onHead(host);
    function cfg() { return A.cfg() || {}; }
    function fillList() { var opts = (A.skuOptions && A.skuOptions()) || []; $q("#cpaSkuList").innerHTML = opts.slice(0, 400).map(function (o) { return '<option value="' + esc(o.sku) + '">' + esc(o.n || "") + "</option>"; }).join(""); }
    function msg(t, cls) { var m = $q(".cpa-msg"); m.className = "tw-msg cpa-msg " + (cls || ""); m.textContent = t || ""; }
    function inp(i, k, v, w) { return '<input class="cpa-in cpa-w' + (w || 8) + '" data-i="' + i + '" data-k="' + k + '" inputmode="decimal" value="' + esc(v == null ? "" : v) + '">'; }
    function draw() {
      var c = cfg(), tot = { spend: 0, net: 0, losing: 0, n: rows.length, conv: 0 };
      $q(".cpa-cfgnote").textContent = "Shipping " + (c.shipping == null ? 99 : c.shipping) + " · safety " + (c.safetyPct == null ? 20 : c.safetyPct) + "%";
      $q(".cpa-body").innerHTML = rows.map(function (r, i) {
        var o = calc(r, c), st = STATUS[o.status];
        if (o.spend) tot.spend += o.spend; if (o.net != null) tot.net += o.net; if (o.status === "losing" || o.status === "noMargin") tot.losing++; if (o.conv) tot.conv += o.conv;
        return '<tr class="cpa-row' + (i === sel ? " on" : "") + '" data-row="' + i + '"><td class="tw-mono">' + esc(r.sku) + '</td><td class="cpa-name" title="' + esc(r.n || "") + '">' + esc(r.n || "—") + '<div class="tw-muted">' + esc(r.src === "merchant" ? "own rates" : r.src === "product" ? "product avg" : r.src === "manual" ? "manual" : "") + '</div></td>' +
          '<td class="r">' + inp(i, "cr", r.cr == null ? "" : +(pct(r.cr) * 100).toFixed(1), 5) + '</td><td class="r">' + inp(i, "dr", r.dr == null ? "" : +(pct(r.dr) * 100).toFixed(1), 5) + '</td>' +
          '<td class="r">' + inp(i, "ndrOverride", r.ndrOverride == null || r.ndrOverride === "" ? "" : r.ndrOverride, 5) + '<div class="tw-muted cpa-c" data-c="ndr">' + p1(o.ndr) + '</div></td>' +
          '<td class="r">' + inp(i, "price", r.price, 6) + '</td><td class="r">' + inp(i, "profit", r.profit, 6) + '</td><td class="r">' + inp(i, "market", r.market, 6) + '</td>' +
          '<td class="r cpa-c" data-c="asp">' + money(o.asp) + '</td><td class="r cpa-c" data-c="margin">' + money(o.margin) + '</td><td class="r">' + inp(i, "cpa", r.cpa, 6) + '</td>' +
          '<td class="r cpa-c cpa-max" data-c="maxCpa">' + money(o.maxCpa) + '</td><td class="r cpa-c" data-c="safeCpa">' + money(o.safeCpa) + '</td><td class="r">' + inp(i, "conv", r.conv, 6) + '</td>' +
          '<td class="r cpa-c" data-c="spend">' + money(o.spend) + '</td><td class="r cpa-c cpa-net ' + (o.net < 0 ? "neg" : o.net > 0 ? "pos" : "") + '" data-c="net">' + money(o.net) + '</td>' +
          '<td><span class="tw-pill ' + st[1] + '" data-c="status">' + st[0] + '</span></td><td><button type="button" class="tw-x cpa-rm" data-rm="' + i + '" aria-label="Remove">✕</button></td></tr>';
      }).join("") || '<tr><td colspan="18" class="tw-muted cpa-empty">Add a SKU to start. Price, profit and CR/DR fill in by themselves — you type AVE Market, Actual CPA and Conversions.</td></tr>';
      $q(".cpa-kpis").innerHTML = [["SKUs", tot.n], ["Conversions", Math.round(tot.conv).toLocaleString("en-US")], ["Ad spend", money(tot.spend)], ["Net profit", money(tot.net)], ["Losing SKUs", tot.losing]].map(function (k, i) { return '<div class="tw-stat"><span>' + k[0] + '</span><b class="' + (i === 3 ? (tot.net < 0 ? "cpa-neg" : "cpa-pos") : i === 4 && tot.losing ? "cpa-neg" : "") + '">' + k[1] + "</b></div>"; }).join("");
      $q(".cpa-foot").textContent = "Max CPA = margin per delivered piece × NDR (break-even). Safe CPA keeps a " + (cfg().safetyPct == null ? 20 : cfg().safetyPct) + "% cushion. NDR: type it to override CR × DR.";
      detail();
    }
    function refreshRow(i) { // update computed cells without rebuilding the inputs (keeps focus while typing)
      var tr = $q('tr[data-row="' + i + '"]'); if (!tr) return draw();
      var o = calc(rows[i], cfg()), st = STATUS[o.status];
      var set = function (k, v) { var e = tr.querySelector('[data-c="' + k + '"]'); if (e) e.textContent = v; };
      set("ndr", p1(o.ndr)); set("asp", money(o.asp)); set("margin", money(o.margin)); set("maxCpa", money(o.maxCpa)); set("safeCpa", money(o.safeCpa)); set("spend", money(o.spend)); set("net", money(o.net));
      var ne = tr.querySelector('[data-c="net"]'); ne.className = "r cpa-c cpa-net " + (o.net < 0 ? "neg" : o.net > 0 ? "pos" : "");
      var se = tr.querySelector('[data-c="status"]'); se.className = "tw-pill " + st[1]; se.textContent = st[0];
      var tot = { spend: 0, net: 0, losing: 0, conv: 0 };
      rows.forEach(function (r) { var x = calc(r, cfg()); if (x.spend) tot.spend += x.spend; if (x.net != null) tot.net += x.net; if (x.status === "losing" || x.status === "noMargin") tot.losing++; if (x.conv) tot.conv += x.conv; });
      var b = host.querySelectorAll(".cpa-kpis b"); if (b.length === 5) { b[1].textContent = Math.round(tot.conv).toLocaleString("en-US"); b[2].textContent = money(tot.spend); b[3].textContent = money(tot.net); b[3].className = tot.net < 0 ? "cpa-neg" : "cpa-pos"; b[4].textContent = tot.losing; }
      if (i === sel) detail();
    }
    function detail() {
      var box = $q(".cpa-detail"); if (sel < 0 || !rows[sel]) { box.classList.add("tw-off"); return; }
      box.classList.remove("tw-off");
      var r = rows[sel], o = calc(r, cfg()), sg = suggestions(r, o), sens = sensitivity(r, cfg()), st = STATUS[o.status];
      box.innerHTML = '<div class="cpa-head"><div><h3>' + esc(r.n || r.sku) + ' <span class="tw-pill ' + st[1] + '">' + st[0] + '</span></h3><div class="tw-muted">' + esc(r.sku) + '</div></div></div>' +
        '<div class="cpa-kv">' + [["Max CPA (break-even)", money(o.maxCpa)], ["Safe CPA", money(o.safeCpa)], ["Profit / conversion", money(o.perConv)], ["ROI on ads", o.roi == null ? "—" : (o.roi * 100).toFixed(0) + "%"], ["Break-even NDR", p1(o.breakEvenNdr)], ["Break-even AVE Market", money(o.breakEvenMarket)]].map(function (x) { return "<div><span>" + x[0] + "</span><b>" + x[1] + "</b></div>"; }).join("") + "</div>" +
        '<ul class="cpa-sug">' + sg.map(function (x) { return '<li class="' + x[0] + '">' + esc(x[1]) + "</li>"; }).join("") + "</ul>" +
        (sens ? '<h4>Net profit per 100 conversions</h4><div class="tw-scroll"><table class="tw-table cpa-sens"><thead><tr><th>NDR \\ CPA</th>' + sens.cpas.map(function (c) { return '<th class="r">' + money(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          sens.grid.map(function (row, j) { return "<tr><td>" + p1(sens.ndrs[j]) + "</td>" + row.map(function (v) { return '<td class="r ' + (v < 0 ? "cpa-neg" : "cpa-pos") + '">' + money(v) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" : "");
    }
    function addSku(sku) {
      sku = String(sku || "").trim(); if (!sku) return;
      if (rows.some(function (r) { return r.sku === sku; }) && !confirm(sku + " is already in the list. Add it again (another scenario)?")) return;
      msg("Loading " + sku + "…");
      A.rates(sku).then(function (x) {
        if (!x || (!x.price && !x.n)) { msg("SKU not found — you can still type its numbers.", "err"); x = { sku: sku }; } else msg("");
        rows.push({ sku: sku, n: x.n || "", price: x.price == null ? "" : x.price, profit: x.profit == null ? "" : x.profit, cr: x.cr == null ? "" : x.cr, dr: x.dr == null ? "" : x.dr, src: x.src || "", productNdr: x.productNdr == null ? null : x.productNdr, ndrOverride: "", market: "", cpa: "", conv: "" });
        sel = rows.length - 1; dirty = true; $q(".cpa-in-sku").value = ""; draw();
      }).catch(function (e) { msg(e.message, "err"); });
    }
    host.addEventListener("input", function (e) {
      var t = e.target; if (!t.classList.contains("cpa-in")) return;
      var i = +t.getAttribute("data-i"), k = t.getAttribute("data-k"), r = rows[i]; if (!r) return;
      var v = t.value.trim();
      if (k === "cr" || k === "dr") { r[k] = v === "" ? "" : n(v) / 100; r.src = "manual"; } else r[k] = v;
      dirty = true; refreshRow(i);
    });
    host.addEventListener("click", function (e) {
      var rm = e.target.closest("[data-rm]"); if (rm) { var i = +rm.getAttribute("data-rm"); rows.splice(i, 1); if (sel >= rows.length) sel = rows.length - 1; dirty = true; draw(); return; }
      var tr = e.target.closest("tr.cpa-row"); if (tr && !e.target.closest("input")) { sel = +tr.getAttribute("data-row"); host.querySelectorAll("tr.cpa-row").forEach(function (x) { x.classList.toggle("on", x === tr); }); detail(); }
    });
    host.addEventListener("focusin", function (e) { var t = e.target; if (t.classList && t.classList.contains("cpa-in")) { var i = +t.getAttribute("data-i"); if (i !== sel) { sel = i; host.querySelectorAll("tr.cpa-row").forEach(function (x) { x.classList.toggle("on", +x.getAttribute("data-row") === i); }); detail(); } } });
    $q(".cpa-addbtn").onclick = function () { addSku($q(".cpa-in-sku").value); };
    $q(".cpa-in-sku").addEventListener("keydown", function (e) { if (e.key === "Enter") addSku(this.value); });
    var lt = 0; $q(".cpa-in-sku").addEventListener("input", function () { var q = this.value.trim(); clearTimeout(lt); if (q.length < 3 || !A.lookup) return; lt = setTimeout(function () { A.lookup(q).then(function (list) { var dl = $q("#cpaSkuList"); dl.innerHTML = (list || []).slice(0, 30).map(function (o) { return '<option value="' + esc(o.sku) + '">' + esc(o.n || "") + "</option>"; }).join(""); }).catch(function () {}); }, 250); });
    $q(".cpa-save").onclick = function () { msg("Saving…"); A.save(rows.map(clean)).then(function () { dirty = false; msg("Saved ✓", "ok"); }).catch(function (e) { msg(e.message, "err"); }); };
    $q(".cpa-csv").onclick = function () {
      var c = cfg(), H = ["SKU", "Product", "CR", "DR", "NDR", "Selling Price", "Profit", "AVE Market", "ASP", "Top Up for pic", "Actual CPA", "Max CPA", "Safe CPA", "Num of Conversion", "Cost Of Total Orders", "NET Profit", "Status"];
      var q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }, r2 = function (v) { return v == null ? "" : Math.round(v * 100) / 100; };
      var csv = H.join(",") + "\n" + rows.map(function (r) { var o = calc(r, c); return [r.sku, r.n, r2(pct(r.cr)), r2(pct(r.dr)), r2(o.ndr), r2(o.price), r2(o.profit), r2(o.market), r2(o.asp), r2(o.margin), r2(o.cpa), r2(o.maxCpa), r2(o.safeCpa), r2(o.conv), r2(o.spend), r2(o.net), STATUS[o.status][0]].map(q).join(","); }).join("\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "re-cpa.csv"; document.body.appendChild(a); a.click(); a.remove();
    };
    function clean(r) { return { sku: r.sku, n: r.n, price: r.price, profit: r.profit, cr: r.cr, dr: r.dr, src: r.src, productNdr: r.productNdr, ndrOverride: r.ndrOverride, market: r.market, cpa: r.cpa, conv: r.conv }; }
    function reload() { msg("Loading…"); return A.load().then(function (d) { rows = ((d && d.rows) || []).map(function (r) { return Object.assign({}, r); }); sel = rows.length ? 0 : -1; dirty = false; fillList(); draw(); msg(d && d.updatedAt ? "Saved plan from " + new Date(d.updatedAt).toLocaleString() : ""); }).catch(function (e) { rows = []; draw(); msg(e.message, "err"); }); }
    draw(); reload();
    return { reload: reload, isDirty: function () { return dirty; }, rows: function () { return rows; }, fillList: fillList, redraw: draw };
  }
  root.TaagerCpa = { calc: calc, suggestions: suggestions, sensitivity: sensitivity, mount: mount, STATUS: STATUS };
})(typeof window !== "undefined" ? window : globalThis);
