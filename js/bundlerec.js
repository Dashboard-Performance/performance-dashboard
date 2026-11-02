/* Commercial → Bundle Recommendations (v1.18.0)
   New bundles (2 or 3 different single SKUs, one piece each) that raise PPM per order, priced the way the existing bundles are.
   Everything comes from the dashboard's own data:
     • Main (Matches)        — delivered orders / pieces and PPM per SKU (bundles + singles), and which merchants sell which single
     • Products sheet        — selling price and merchant profit
     • COGS map              — COGS per single (a COGS of 1 or less is a placeholder = unknown → the SKU is left out)
     • Debundle map          — what every existing bundle is made of
   PPM per order of a bundle = Price − Merchant profit − COGS (this matches the actual delivered PPM per order of the existing bundles).
   Pricing — how the existing bundles that SELL are priced (mixed bundles with delivered orders whose singles all sell on their own,
   so no gift / packaging placeholder price enters):
     • Price           = the main single's price (the highest price in the bundle) + the other pieces at their COGS × K,
                         K = the median of those bundles for the same number of pieces (editable on the page). Not tied to the sum of prices.
     • Merchant profit = the highest merchant profit among the singles (in the selling bundles the profit ≈ the best single's profit). Gifts and packaging never become a suggestion: a suggestion is made only of singles
   that sell on their own. Multi-packs of one SKU (×2, ×3) are not suggested: in the data they earn less per order than the single.
   Which singles go together = how many merchants sell both of them; a third single = one of the 5 most sold by the merchants that sell the pair.
   "Today" (what the suggestion has to beat) = the best single's list-price PPM or the best existing bundle with any of these singles, at list price
   too — the same basis as the suggestion. "Price check" = actual PPM per delivered order ÷ list-price PPM of the singles (are they really sold at
   that price?). */
(function () {
  "use strict";
  var C = null;
  function $(id) { return document.getElementById(id); }
  function st() { try { return state; } catch (e) { return {}; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v) { return Math.round(+v || 0).toLocaleString("en-US"); }
  function money(v) { return "EGP " + int(v); }
  function median(a) { a = a.filter(function (x) { return x != null && isFinite(x); }).sort(function (x, y) { return x - y; }); if (!a.length) return null; var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

  var BR = { sig: "", data: null, k: { 2: null, 3: null }, pcs: "all", cat: "all", minShared: 2, better: true, inStock: true, q: "", sort: "uplift", dir: "desc", page: 0 };
  var PAGE = 50;

  function sigNow() { var s = st(); try { return [(s.allParsedRows || []).length, (s.debundleMap || []).length, Object.keys(s.productsMap || {}).length, s.cogsMap && s.cogsMap.size, Object.keys(s.inventoryMap || {}).length].join("|"); } catch (e) { return ""; } }

  function build() {
    var sg = sigNow(); if (BR.data && sg === BR.sig) return BR.data; BR.sig = sg;
    var s = st(), pm = s.productsMap || {}, cogsMap = s.cogsMap || new Map(), inv = s.inventoryMap || {};
    var main = (typeof allSkuRows === "function" ? allSkuRows() : (s.allParsedRows || []));   // bundles + singles -> Main (Matches)
    var deb = s.debundleMap || [];
    if (!main.length || !deb.length || !Object.keys(pm).length) return (BR.data = null);
    var cogsOf = function (id) { var c = cogsMap.get ? +cogsMap.get(id) || 0 : 0; return c > 1 ? c : 0; };
    var nameOf = {}; deb.forEach(function (r) { if (r.singleId && r.singleName && !nameOf[r.singleId]) nameOf[r.singleId] = r.singleName; if (r.productId && r.productName && !nameOf[r.productId]) nameOf[r.productId] = r.productName; });
    var nm = function (id) { return (inv[id] && inv[id].skuName) || nameOf[id] || id; };
    var catOf = function (id) { return String((inv[id] && inv[id].category) || (pm[id] && pm[id].category) || "").trim().toLowerCase() || "general"; };

    // what every bundle is made of
    var comps = new Map();
    deb.forEach(function (r) { if (!r.productId || !r.singleId) return; if (!comps.has(r.productId)) comps.set(r.productId, []); comps.get(r.productId).push({ s: r.singleId, q: +r.quantity || 1 }); });
    var pcsOf = function (id) { var c = comps.get(id); return c ? c.reduce(function (a, x) { return a + x.q; }, 0) : 1; };
    var isBundle = function (id) { return pcsOf(id) >= 2; };

    // actual sales per SKU + which merchants sell each single on its own
    var act = new Map(), sellers = new Map(), latest = 0;
    main.forEach(function (r) {
      if (!r.sku) return; if (r.timestamp > latest) latest = r.timestamp;
      var a = act.get(r.sku) || { o: 0, p: 0, ppm: 0 }; a.o += r.deliveredOrders || 0; a.p += r.deliveredPieces || 0; a.ppm += r.ppm || 0; act.set(r.sku, a);
      if ((r.confirmedPieces || 0) > 0 && r.merchantId && !isBundle(r.sku)) { var m = sellers.get(r.sku); if (!m) sellers.set(r.sku, m = new Set()); m.add(String(r.merchantId)); }
    });
    var ppmOrder = function (id) { var a = act.get(id); return a && a.o > 0 ? a.ppm / a.o : null; };

    // singles that can go into a suggestion: sold on their own (delivered orders), real price and COGS
    var U = new Map(), noCogs = 0;
    act.forEach(function (a, id) {
      if (isBundle(id) || !(a.o > 0)) return;
      var p = pm[id]; if (!p || !(p.price > 0)) return;
      var c = cogsOf(id); if (!c) { noCogs++; return; }
      var lp = +p.price - (+p.profit || 0) - c; // list-price PPM per piece
      U.set(id, { id: id, name: nm(id), cat: catOf(id), price: +p.price, profit: +p.profit || 0, cogs: c, listPpm: lp, ppmOrder: ppmOrder(id), ppmPiece: a.p > 0 ? a.ppm / a.p : null, check: lp > 0 && ppmOrder(id) != null ? ppmOrder(id) / lp : null, stock: inv[id] ? +inv[id].stock || 0 : 0, sellers: sellers.get(id) || new Set() });
    });

    // learn from existing MIXED bundles whose singles all sell on their own
    var learn = { 2: { k: [], fr: [], o: 0, ppm: 0, n: 0 }, 3: { k: [], fr: [], o: 0, ppm: 0, n: 0 } }, combos = new Set(), bestBundle = new Map();
    comps.forEach(function (cs, id) {
      var n = pcsOf(id); if (n < 2) return;
      var a = act.get(id), po = a && a.o > 0 ? a.ppm / a.o : null, bp = pm[id];
      // the existing bundle's list-price PPM per order (same basis as the suggestions), kept for every single inside it
      var bc = 0, bok = !!(bp && bp.price > 0); cs.forEach(function (x) { var c = cogsOf(x.s); if (!c) bok = false; bc += c * x.q; });
      var lpB = bok ? +bp.price - (+bp.profit || 0) - bc : null;
      if (lpB != null) cs.forEach(function (x) { var b = bestBundle.get(x.s); if (!b || lpB > b.listPpm) bestBundle.set(x.s, { id: id, name: nm(id), listPpm: lpB, ppmOrder: po }); });
      if (cs.every(function (x) { return x.q === 1; }) && cs.length >= 2) combos.add(cs.map(function (x) { return x.s; }).sort().join("|"));
      if (cs.length < 2 || !learn[n]) return;
      var b = pm[id]; if (!b || !(b.price > 0)) return;
      if (!(a && a.o > 0)) return; // only bundles that sell
      var items = [], ok = true;
      cs.forEach(function (x) { var u = U.get(x.s); if (!u) { ok = false; return; } for (var i = 0; i < x.q; i++) items.push(u); });
      if (!ok) return;
      items.sort(function (x, y) { return y.price - x.price; });
      var oc = 0; items.slice(1).forEach(function (u) { oc += u.cogs; });
      var mp = Math.max.apply(null, items.map(function (u) { return u.profit; }));
      var L = learn[n]; L.n++; if (oc > 0) L.k.push((+b.price - items[0].price) / oc); if (mp > 0) L.fr.push((+b.profit || 0) / mp);
      L.o += a.o; L.ppm += a.ppm;
    });
    var rule = {}; [2, 3].forEach(function (n) { var L = learn[n]; rule[n] = { n: L.n, k: median(L.k), profitVsBest: median(L.fr), ppmOrder: L.o ? L.ppm / L.o : null, orders: L.o }; });

    // which singles go together: merchants that sell both (pairs), then a third one sold by the same merchants
    var byMerchant = new Map();
    U.forEach(function (u) { u.sellers.forEach(function (m) { var l = byMerchant.get(m); if (!l) byMerchant.set(m, l = []); l.push(u.id); }); });
    var pairN = new Map();
    byMerchant.forEach(function (l) { l.sort(); for (var i = 0; i < l.length; i++) for (var j = i + 1; j < l.length; j++) { var k = l[i] + "|" + l[j]; pairN.set(k, (pairN.get(k) || 0) + 1); } });
    var pairs = []; pairN.forEach(function (n, k) { if (n >= 1) pairs.push({ k: k, n: n }); });
    pairs.sort(function (a, b) { return b.n - a.n; });
    var triN = new Map(), TOP_PAIRS = 400;
    pairs.slice(0, TOP_PAIRS).forEach(function (p) {
      var ab = p.k.split("|"), A = U.get(ab[0]), B = U.get(ab[1]), cnt = new Map();
      A.sellers.forEach(function (m) { if (!B.sellers.has(m)) return; (byMerchant.get(m) || []).forEach(function (c) { if (c === ab[0] || c === ab[1]) return; cnt.set(c, (cnt.get(c) || 0) + 1); }); });
      // the 5 singles most often sold by the merchants that sell both
      Array.from(cnt.entries()).sort(function (x, y) { return y[1] - x[1]; }).slice(0, 5).forEach(function (e) { var k = [ab[0], ab[1], e[0]].sort().join("|"); if (!triN.has(k) || triN.get(k) < e[1]) triN.set(k, e[1]); });
    });

    var cands = [];
    var add = function (key, shared) {
      if (combos.has(key)) return; // already a bundle
      var ids = key.split("|"), us = ids.map(function (i) { return U.get(i); }), n = ids.length;
      var sumPrice = 0, sumCogs = 0; us.forEach(function (u) { sumPrice += u.price; sumCogs += u.cogs; });
      var byPrice = us.slice().sort(function (x, y) { return y.price - x.price; }), otherCogs = 0; byPrice.slice(1).forEach(function (u) { otherCogs += u.cogs; });
      var bestSingle = null, bestB = null;
      us.forEach(function (u) { if (bestSingle == null || u.listPpm > bestSingle.v) bestSingle = { v: u.listPpm, id: u.id }; var b = bestBundle.get(u.id); if (b && (bestB == null || b.listPpm > bestB.listPpm)) bestB = b; });
      var profit = Math.max.apply(null, us.map(function (u) { return u.profit; }));
      var cats = []; us.forEach(function (u) { if (cats.indexOf(u.cat) < 0) cats.push(u.cat); });
      cands.push({ key: key, ids: ids, us: us, n: n, shared: shared, cats: cats, sumPrice: sumPrice, cogs: sumCogs, profit: profit, mainPrice: byPrice[0].price, main: byPrice[0].id, otherCogs: otherCogs,
        bestSingle: bestSingle, bestBundle: bestB, today: Math.max(bestSingle ? bestSingle.v : -Infinity, bestB ? bestB.listPpm : -Infinity),
        check: Math.min.apply(null, us.map(function (u) { return u.check == null ? Infinity : u.check; })),
        minStock: Math.min.apply(null, us.map(function (u) { return u.stock; })) });
    };
    pairs.forEach(function (p) { add(p.k, p.n); });
    triN.forEach(function (n, k) { add(k, n); });
    var catSet = {}; cands.forEach(function (c) { c.cats.forEach(function (x) { catSet[x] = 1; }); });

    var sO = 0, sPpm = 0; U.forEach(function (u) { var a = act.get(u.id); sO += a.o; sPpm += a.ppm; });
    var bO = 0, bPpm = 0; comps.forEach(function (cs, id) { if (pcsOf(id) < 2) return; var a = act.get(id); if (a) { bO += a.o; bPpm += a.ppm; } });
    return (BR.data = { cands: cands, rule: rule, singles: U.size, noCogs: noCogs, singlesPpmOrder: sO ? sPpm / sO : null, bundlesPpmOrder: bO ? bPpm / bO : null, cats: Object.keys(catSet).sort(), latest: latest, existing: combos.size });
  }

  // K = the other pieces' COGS multiplier: the value typed on the page, else the one learned from the selling bundles
  function kOf(n) { var v = BR.k[n]; if (v != null && isFinite(v)) return v; var R = BR.data && BR.data.rule[n]; return R && R.k != null ? R.k : 1; }
  function view(d) {
    var q = BR.q.trim().toLowerCase();
    var out = d.cands.map(function (c) {
      var price = c.mainPrice + c.otherCogs * kOf(c.n), ppm = price - c.profit - c.cogs;
      return { c: c, price: price, ppm: ppm, ppmPiece: ppm / c.n, uplift: isFinite(c.today) ? ppm - c.today : null };
    }).filter(function (r) {
      var c = r.c;
      if (c.shared < BR.minShared) return false;
      if (BR.pcs !== "all" && String(c.n) !== BR.pcs) return false;
      if (BR.cat !== "all" && c.cats.indexOf(BR.cat) < 0) return false;
      if (BR.inStock && !(c.minStock > 0)) return false;
      if (BR.better && !(r.uplift != null && r.uplift > 0)) return false;
      if (q && !c.us.some(function (u) { return u.id.toLowerCase().indexOf(q) >= 0 || String(u.name).toLowerCase().indexOf(q) >= 0; })) return false;
      return true;
    });
    var key = BR.sort, dir = BR.dir === "asc" ? 1 : -1;
    var val = function (r) { return key === "shared" ? r.c.shared : key === "n" ? r.c.n : key === "price" ? r.price : key === "profit" ? r.c.profit : key === "ppm" ? r.ppm : key === "ppmPiece" ? r.ppmPiece : key === "today" ? r.c.today : key === "stock" ? r.c.minStock : key === "check" ? (isFinite(r.c.check) ? r.c.check : -1) : (r.uplift == null ? -Infinity : r.uplift); };
    out.sort(function (a, b) { return (val(a) - val(b)) * dir; });
    return out;
  }

  function th(k, label, title, num) { var on = BR.sort === k; return '<th data-brk="' + k + '"' + (num ? ' class="num"' : "") + ' title="' + esc(title) + '" style="cursor:pointer">' + label + (on ? (BR.dir === "asc" ? " ▲" : " ▼") : "") + "</th>"; }

  function render(host) {
    var d = build();
    if (!d) { host.innerHTML = '<div class="panel" style="padding:18px"><div class="sc-note">Waiting for dashboard data (Matches, Products, COGS and the debundle map). It appears here as soon as the main data finishes loading.</div></div>'; return; }
    var rows = view(d), R2 = d.rule[2], R3 = d.rule[3];
    var pct = function (v) { return v == null ? "—" : (v * 100).toFixed(0) + "%"; };
    var avg = function (k) { if (!rows.length) return 0; return rows.reduce(function (a, r) { return a + (r[k] || 0); }, 0) / rows.length; };
    var tiles = [
      ["Suggestions", int(rows.length), "after the filters below"],
      ["Avg PPM / order", money(avg("ppm")), "priced like the bundles that sell"],
      ["Avg uplift / order", money(avg("uplift")), "vs the best single / existing bundle (list price)"],
      ["Singles today", money(d.singlesPpmOrder), "actual PPM per delivered order"],
      ["Bundles today", money(d.bundlesPpmOrder), "actual PPM per delivered order"]
    ];
    var html = '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Bundle Recommendations</h2>' +
      '<p>New bundles of 2 or 3 different single SKUs that the same merchants already sell, with the PPM per order they would make. PPM per order = Price − Merchant profit − COGS (the same as the actual PPM per delivered order of today\'s bundles).</p></div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' +
      '<div class="table-responsive" style="padding:0 18px 14px"><table class="data-table"><thead><tr><th>Learned from the mixed bundles that sell</th><th class="num">Bundles</th><th class="num" title="(Bundle price − the main single\'s price) ÷ the other pieces\' COGS — median. The main single = the one with the highest price.">Other pieces at COGS ×</th><th class="num" title="K used on this page. Type another value to try it (empty = the learned one).">K used</th><th class="num" title="Bundle merchant profit ÷ the highest profit among its singles — median.">Merchant profit ÷ best single\'s profit</th><th class="num" title="Actual PPM per delivered order of these bundles.">PPM / order today</th></tr></thead><tbody>' +
      [[2, R2], [3, R3]].map(function (x) { return '<tr><td>' + x[0] + ' pieces</td><td class="num">' + int(x[1].n) + '</td><td class="num">' + (x[1].k == null ? "—" : x[1].k.toFixed(2)) + '</td><td class="num"><input type="number" step="0.05" min="0" data-brk-in="' + x[0] + '" value="' + (BR.k[x[0]] != null ? BR.k[x[0]] : "") + '" placeholder="' + kOf(x[0]).toFixed(2) + '" class="date-filter-input" style="width:80px;min-width:0"></td><td class="num">' + pct(x[1].profitVsBest) + '</td><td class="num">' + (x[1].ppmOrder == null ? "—" : money(x[1].ppmOrder)) + '</td></tr>'; }).join("") +
      '</tbody></table><div class="sc-note" style="margin-top:8px">Price = the main single\'s price + the other pieces\' COGS × K (not tied to the sum of the singles\' prices). Merchant profit = the highest profit among the singles. Learned only from bundles that have delivered orders and whose singles all sell on their own, so a gift / packaging placeholder price never enters. ' + int(d.noCogs) + ' singles with no COGS (1 or less) are left out. Combinations that already exist as a bundle are not suggested (' + int(d.existing) + '). Multi-packs of one SKU are not suggested.</div></div></div>';

    html += '<div class="panel table-panel hover-glow"><div class="panel-head-modern" style="flex-wrap:wrap;gap:10px"><div class="panel-title-wrapper border-blue"><h2>Suggestions</h2><p>Merchants = how many merchants sell all of these singles (Main). PPM is at list price (Products: Price − Profit − COGS) for the suggestion and for Today, so they compare like for like; Price check shows whether the singles really sell at that price.</p></div></div>' +
      '<div class="br-ctrl" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:0 18px 12px">' +
      '<select id="brPcs" class="date-filter-input" style="flex:0 0 auto"><option value="all">2 & 3 pieces</option><option value="2"' + (BR.pcs === "2" ? " selected" : "") + '>2 pieces</option><option value="3"' + (BR.pcs === "3" ? " selected" : "") + '>3 pieces</option></select>' +
      '<select id="brCat" class="date-filter-input" style="flex:0 0 auto"><option value="all">All categories</option>' + d.cats.map(function (c) { return '<option value="' + esc(c) + '"' + (BR.cat === c ? " selected" : "") + '>' + esc(c) + '</option>'; }).join("") + '</select>' +
      '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:0 0 auto" title="Minimum number of merchants that sell all of these singles.">Merchants ≥ <input id="brMin" type="number" min="1" value="' + BR.minShared + '" class="date-filter-input" style="width:70px;min-width:0;flex:0 0 70px"></label>' +
      '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:0 0 auto"><input id="brBetter" type="checkbox" style="width:16px;height:16px;min-height:0;flex:0 0 16px;margin:0"' + (BR.better ? " checked" : "") + '> Better than today only</label>' +
      '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:0 0 auto"><input id="brStock" type="checkbox" style="width:16px;height:16px;min-height:0;flex:0 0 16px;margin:0"' + (BR.inStock ? " checked" : "") + '> In stock only</label>' +
      '<input id="brQ" type="search" class="date-filter-input" style="flex:0 1 240px;min-width:160px" placeholder="Search SKU ID or name" value="' + esc(BR.q) + '">' +
      '<button type="button" class="tw-exp" id="brCsv">Export CSV</button></div>' +
      '<div class="table-responsive"><table class="data-table" id="brTable"><thead><tr><th>#</th><th>Bundle (single SKUs)</th><th>Category</th>' +
      th("n", "Pcs", "Pieces in the bundle.", true) + th("shared", "Merchants", "Merchants that sell all of these singles.", true) + th("price", "Price", "The main single\'s price + the other pieces\' COGS × K.", true) +
      th("profit", "Merchant profit", "The highest merchant profit among the singles.", true) + '<th class="num" title="Sum of the singles\' COGS.">COGS</th>' +
      th("ppm", "PPM / order", "Price − Merchant profit − COGS.", true) + th("ppmPiece", "PPM / piece", "PPM per order ÷ pieces.", true) +
      th("today", "Today", "The better of: the best single\'s PPM and the best existing bundle with any of these singles — both at list price (Price − Profit − COGS), the same basis as the suggestion.", true) + th("uplift", "Uplift / order", "PPM / order − Today.", true) + th("check", "Price check", "Lowest of the singles\' actual PPM per delivered order ÷ their list-price PPM. Near 100% = they really sell at the list price; much lower = they sell cheaper than the list price, so this PPM is optimistic.", true) + th("stock", "Min stock", "The lowest stock among the singles.", true) +
      '</tr></thead><tbody id="brBody"></tbody></table></div><div class="pagination-controls" style="display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:10px 18px"><button type="button" class="btn" id="brPrev">Prev</button><span class="text-dim" id="brPageInfo"></span><button type="button" class="btn" id="brNext">Next</button></div></div>';
    host.innerHTML = html;
    drawBody(host, rows);
    wire(host);
  }

  function drawBody(host, rows) {
    rows = rows || view(BR.data);
    var pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (BR.page > pages - 1) BR.page = pages - 1;
    var slice = rows.slice(BR.page * PAGE, BR.page * PAGE + PAGE);
    var body = host.querySelector("#brBody"); if (!body) return;
    body.innerHTML = slice.length ? slice.map(function (r, i) {
      var c = r.c, todaySrc = c.bestBundle && (!c.bestSingle || c.bestBundle.listPpm >= c.bestSingle.v) ? "best existing bundle: " + c.bestBundle.id + (c.bestBundle.ppmOrder != null ? " (actual PPM/order " + int(c.bestBundle.ppmOrder) + ")" : "") : (c.bestSingle ? "best single: " + c.bestSingle.id : "");
      return '<tr><td>' + (BR.page * PAGE + i + 1) + '</td><td>' + c.us.map(function (u) { return '<div><b>' + esc(u.name) + '</b>' + (u.id === c.main ? ' <small class="text-blue">main</small>' : '') + ' <small class="text-dim">' + esc(u.id) + ' · price ' + int(u.price) + ' · PPM ' + int(u.listPpm) + ' (actual ' + (u.ppmOrder == null ? "—" : int(u.ppmOrder)) + ')</small></div>'; }).join("") + '</td>' +
        '<td>' + esc(c.cats.join(" + ")) + '</td><td class="num">' + c.n + '</td><td class="num">' + int(c.shared) + '</td><td class="num">' + money(r.price) + '</td><td class="num">' + money(c.profit) + '</td><td class="num">' + money(c.cogs) + '</td>' +
        '<td class="num"><b>' + money(r.ppm) + '</b></td><td class="num">' + money(r.ppmPiece) + '</td><td class="num" title="' + esc(todaySrc) + '">' + (isFinite(c.today) ? money(c.today) : "—") + '</td>' +
        '<td class="num ' + (r.uplift > 0 ? "text-green" : "text-red") + '">' + (r.uplift == null ? "—" : (r.uplift > 0 ? "+" : "") + int(r.uplift)) + '</td><td class="num">' + (isFinite(c.check) ? Math.round(c.check * 100) + "%" : "—") + '</td><td class="num">' + int(c.minStock) + '</td></tr>';
    }).join("") : '<tr><td colspan="14" class="text-dim" style="text-align:center;padding:18px">No suggestion matches these filters.</td></tr>';
    var pi = host.querySelector("#brPageInfo"); if (pi) pi.textContent = "Page " + (BR.page + 1) + " of " + pages + " · " + int(rows.length) + " suggestions";
  }

  function csv() {
    var rows = view(BR.data), head = ["Bundle SKUs", "Bundle names", "Category", "Pieces", "Merchants", "Main single", "Price", "Merchant profit", "COGS", "PPM per order", "PPM per piece", "Today best PPM per order", "Uplift per order", "Price check %", "Min stock"];
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [head.join(",")].concat(rows.map(function (r) { var c = r.c; return [c.ids.join(" + "), c.us.map(function (u) { return u.name; }).join(" + "), c.cats.join(" + "), c.n, c.shared, c.main, Math.round(r.price), Math.round(c.profit), Math.round(c.cogs), Math.round(r.ppm), Math.round(r.ppmPiece), isFinite(c.today) ? Math.round(c.today) : "", r.uplift == null ? "" : Math.round(r.uplift), isFinite(c.check) ? Math.round(c.check * 100) : "", c.minStock].map(q).join(","); }));
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "bundle-recommendations.csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function wire(host) {
    var re = function () { BR.page = 0; render(host); };
    host.querySelectorAll("[data-brk-in]").forEach(function (inp) { inp.addEventListener("change", function () { var n = inp.getAttribute("data-brk-in"), v = inp.value.trim(); BR.k[n] = v === "" ? null : Math.max(0, +v); re(); }); });
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("brPcs", "change", function (e) { BR.pcs = e.target.value; re(); });
    on("brCat", "change", function (e) { BR.cat = e.target.value; re(); });
    on("brMin", "change", function (e) { BR.minShared = Math.max(1, Math.round(+e.target.value || 1)); re(); });
    on("brBetter", "change", function (e) { BR.better = e.target.checked; re(); });
    on("brStock", "change", function (e) { BR.inStock = e.target.checked; re(); });
    on("brQ", "input", function (e) { BR.q = e.target.value; BR.page = 0; drawBody(host); });
    on("brCsv", "click", csv);
    on("brPrev", "click", function () { if (BR.page > 0) { BR.page--; drawBody(host); } });
    on("brNext", "click", function () { BR.page++; drawBody(host); });
    host.querySelectorAll("[data-brk]").forEach(function (t) { t.onclick = function () { var k = t.getAttribute("data-brk"); if (BR.sort === k) BR.dir = BR.dir === "asc" ? "desc" : "asc"; else { BR.sort = k; BR.dir = "desc"; } re(); }; });
  }

  // for tests / the console
  window.TaagerBundleRec = { build: function () { BR.data = null; BR.sig = ""; return build(); }, state: BR, view: function () { return view(BR.data || build()); }, render: render };

  function boot() {
    C = window.TowerCore; if (!C || !C.registerView) { setTimeout(boot, 300); return; }
    C.registerView("bundleRecommendations", { sectionId: "viewBundleRecommendations", navId: "navBundleRecommendations", label: "Bundle Recommendations", sub: "New bundles that raise PPM per order", open: true, render: render });
    var nav = $("navBundleRecommendations"); if (nav && !nav.dataset.br) { nav.dataset.br = "1"; nav.addEventListener("click", function () { window.switchView("bundleRecommendations"); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 150); }); else setTimeout(boot, 150);
})();
