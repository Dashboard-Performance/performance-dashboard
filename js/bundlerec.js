/* Commercial → Bundle Recommendations (v1.18.0)
   A short list (top 200 by default) of bundles you can act on, built from what already WORKED TOGETHER since January:
     history tab (FORECAST_HISTORY_GID, Jan → the month before Main) + Main (Matches, previous + current month).
   We have no order-level data, so the only proof that CUSTOMERS buy two singles together is a bundle of them that sold.

   Kinds of recommendation (only singles that sell on their own and are in stock now; never a combination that is already a bundle):
     • Revive  — a proven bundle (mixed bundle with delivered pieces since January) that cannot run now because one of its
                 singles has NO STOCK → that single is replaced by the most similar single in stock.
     • Variant — a proven bundle that runs today, with one single swapped for one of the 2 closest singles of the SAME product type.
     • Swap / New — two singles the same merchant delivered in the same month (strength = merchant-months; Swap = one of them is
                 out of stock and is replaced). Kept only when their two product types already sit together in a bundle that
                 sold, and never two of the same product type (two different cameras are alternatives, not a bundle).
   Similar single = same product type (Products → SC: electric shavers, home storage …), else sub-category, else category;
   the closest price first; in stock.

   PPM (no merchant profit anywhere):
     • PPM / piece of a single = its actual delivered PPM ÷ delivered pieces (Main; history months if Main has none).
     • Actual R (info, and the fallback when no Pricing R can be learned) = the median, over the mixed bundles that sell now, of
       (bundle PPM per delivered order ÷ the sum of its singles' PPM / piece).
     • Today = the best PPM per delivered order of any of its singles sold alone (and of the original bundle for Revive / Variant).
     • Only suggestions that beat Today are kept.
   Pricing columns (today's prices, Products: Price − Profit − COGS per single):
     • Floor PPM     = the best single alone (or the original bundle for Revive / Variant) — below it, sell the single alone.
     • Ceiling PPM   = the singles sold apart (sum) — at or above it the customer has no reason to buy the bundle.
     • Suggested PPM = Ceiling × Pricing R · Base Price = COGS + Suggested.
   Pricing R (2 and 3 pieces) — the discount that brings demand AND PPM, learned from your mixed bundles that sell now (Main):
     • each bundle's list R = its list PPM (Price − Profit − its singles' COGS) ÷ the sum of its singles' list PPM;
     • bundles are grouped in list-R bands (<0.50, 0.50-0.60 … ≥1.00); a band's score = the MEDIAN actual PPM per bundle in it
       (orders × PPM per order together; median so one big bundle cannot decide alone); a band needs ≥ "min bundles" (5, editable);
     • Auto Pricing R = the median list R of the bundles in the best band. You can type your own R.
   Expected PPM / order = the sum of its singles' ACTUAL PPM / piece × the Pricing R = what the bundle earns per order at the price you set;
   Uplift = Expected − Today, and only bundles with Uplift > 0 at your Pricing R are listed (changing the R rebuilds the list).
   CM3 check — the cost lines of the CM3 (like the Bundle CM3 sheet), applied to the PPM of each recommendation:
     • Cost rates = company-wide, from Product Only (main-product rows of ALL products, actual columns; Oct 1 → Nov 2 2026 values
       if the query has none), PER ORDER, each one editable: shipping fee revenue and shipping cost per delivered order · VAT and
       marketing as a % of the selling price · packaging / warehouse, inventory provision, CS per confirmed order · returns per
       confirmed order not delivered.
     • One order at DR r (you pick, 50%): CM3 = PPM + fee − shipping − (VAT% + marketing%) × price − (packaging + provision + CS +
       (1 − r) × returns) ÷ r.
     • Bundle = one order: PPM = Expected PPM / order, price = Base Price + merchant profit (200). Singles = one order EACH: PPM =
       its actual PPM / piece, price = its Products selling price. Δ = Bundle − Σ singles → More / Same / Less.
   Order: Revive, then Variant (by the original bundle's pieces sold), then Swap + New (by merchant-months); a single appears in
   at most 3 Swap / New suggestions so one popular SKU does not fill the list. */
(function () {
  "use strict";
  var C = null;
  function $(id) { return document.getElementById(id); }
  function st() { try { return state; } catch (e) { return {}; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v) { return Math.round(+v || 0).toLocaleString("en-US"); }
  function money(v) { return "EGP " + int(v); }
  function median(a) { a = a.filter(function (x) { return x != null && isFinite(x); }).sort(function (x, y) { return x - y; }); if (!a.length) return null; var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function monthKey(ts) { var d = new Date(ts); return d.getFullYear() * 100 + d.getMonth() + 1; }

  var BR = { sig: "", data: null, type: "all", top: 200, cat: "all", q: "", page: 0, poll: null, rOv: { 2: null, 3: null }, minBand: 5, mp: 200, cmSame: 0, dr: 50, costOv: {} };
  try { var sv = JSON.parse(localStorage.getItem("brPricingR") || "null"); if (sv) { BR.rOv = { 2: sv[2] > 0 ? +sv[2] : null, 3: sv[3] > 0 ? +sv[3] : null }; if (sv.min > 0) BR.minBand = Math.round(sv.min); if (sv.mp >= 0 && sv.mp !== null && sv.mp !== undefined) BR.mp = +sv.mp; if (sv.cmMin > 0) BR.cmMin = Math.round(sv.cmMin); if (sv.cmSame >= 0 && sv.cmSame !== null && sv.cmSame !== undefined) BR.cmSame = +sv.cmSame; if (sv.dr > 0 && sv.dr <= 100) BR.dr = +sv.dr; if (sv.costOv && typeof sv.costOv === "object") BR.costOv = sv.costOv; } } catch (e) {}
  function saveR() { try { localStorage.setItem("brPricingR", JSON.stringify({ 2: BR.rOv[2], 3: BR.rOv[3], min: BR.minBand, mp: BR.mp, cmSame: BR.cmSame, dr: BR.dr, costOv: BR.costOv })); } catch (e) {} }
  var BANDS = [["<0.50", -Infinity, 0.5], ["0.50-0.60", 0.5, 0.6], ["0.60-0.70", 0.6, 0.7], ["0.70-0.80", 0.7, 0.8], ["0.80-0.90", 0.8, 0.9], ["0.90-1.00", 0.9, 1.0], ["≥1.00", 1.0, Infinity]];
  // band table + best band for one piece count (min = bundles a band needs to win)
  function bandsOf(list, min) {
    var rows = BANDS.map(function (b) {
      var xs = list.filter(function (x) { return x.lr >= b[1] && x.lr < b[2]; }), o = 0, p = 0; xs.forEach(function (x) { o += x.orders; p += x.ppm; });
      return { label: b[0], n: xs.length, orders: o, ppm: p, perBundle: xs.length ? o / xs.length : null, perOrder: o > 0 ? p / o : null, score: median(xs.map(function (x) { return x.ppm; })), r: median(xs.map(function (x) { return x.lr; })), ok: xs.length >= min };
    });
    var best = null; rows.forEach(function (r) { if (r.ok && r.score != null && (!best || r.score > best.score)) best = r; });
    return { rows: rows, best: best, auto: best ? best.r : median(list.map(function (x) { return x.lr; })), count: list.length };
  }
  // CM3 cost rates. Costs are positive numbers (deducted); fee is revenue. Fallback = the October 2026 Product Only file
  // (main-product rows of all products) when the loaded query has none of the columns.
  // Per ORDER (one shipment), not per piece: an order holds 1.26 pieces on average, and the dashboard's Product Only counts every
  // physical piece, so per-piece rates come out lower than what one order really costs (shipping 49 per piece vs 62 per order).
  var COST_KEYS = [["fee", "Shipping fee revenue / delivered order", "+"], ["ship", "Shipping cost / delivered order", "−"], ["vat", "VAT % of price", "−%"], ["mk", "Marketing % of price", "−%"],
    ["pack", "Packaging + warehouse / confirmed order", "−"], ["prov", "Inventory provision / confirmed order", "−"], ["cs", "CS / confirmed order", "−"], ["ret", "Returns / confirmed order not delivered", "−"]];
  var COST_FALLBACK = { fee: 100.38, ship: 62.49, vat: 4.59, mk: 1.18, pack: 13.46, prov: 4.10, cs: 10.05, ret: 30.20 }; // Product Only, Oct 1 → Nov 2 2026, per order
  function costRates(d) { var o = {}; COST_KEYS.forEach(function (k) { var v = BR.costOv[k[0]]; o[k[0]] = v != null && v !== "" && isFinite(+v) ? +v : d.costs[k[0]]; }); return o; }
  // CM3 of ONE order at delivery rate r: ppm per delivered order, price = the selling price the VAT / marketing % apply to
  function cmOrder(ppm, price, r, R) { return ppm + R.fee - R.ship - (R.vat + R.mk) / 100 * price - (R.pack + R.prov + R.cs + (1 - r) * R.ret) / r; }
  function pricingR(d, n) { return BR.rOv[n] > 0 ? BR.rOv[n] : (d.pb[n].auto != null ? d.pb[n].auto : d.R[n]); }
  // Suggested / Base prices on the Pricing R (Expected PPM / Uplift use the same R — set in build)
  function price(d, c) {
    var P = pricingR(d, c.n);
    c.pr = P; c.suggested = c.ceiling != null ? c.ceiling * P : null; c.priceBefore = c.suggested != null ? c.cogs + c.suggested : null;
    c.parts = c.allList ? c.us.map(function (u) { var inB = u.listPpm * P; return { id: u.id, name: u.name, alone: u.listPpm, inBundle: inB, cogs: u.cogs, base: u.cogs + inB }; }) : null;
    // CM3 check: the cost lines applied to this recommendation's PPM (bundle = one order, each single = its own order)
    var R = costRates(d), r = Math.min(1, Math.max(0.01, (+BR.dr || 50) / 100));
    c.cm3 = null; c.cm3S = null; c.cm3D = null; c.cm3V = ""; c.cm3Why = "";
    var noPrice = c.us.filter(function (u) { return !(u.price > 0); }).map(function (u) { return u.id; });
    if (c.priceBefore == null) c.cm3Why = "no Base Price";
    else if (noPrice.length) c.cm3Why = "no selling price in Products: " + noPrice.join(", ");
    else {
      c.cm3 = cmOrder(c.ppm, c.priceBefore + (+BR.mp || 0), r, R);
      c.cm3S = c.us.reduce(function (a, u) { return a + cmOrder(u.ppmPiece, u.price, r, R); }, 0);
      c.cm3D = c.cm3 - c.cm3S;
      c.cm3V = c.cm3D > BR.cmSame ? "More" : (c.cm3D < -BR.cmSame ? "Less" : "Same");
    }
    return c;
  }
  var PAGE = 50;
  var TYPE_LABEL = { revive: "Revive", variant: "Variant", swap: "Swap", fresh: "New" };

  // history months (Jan → before Main) — loaded in the background by app.js (histInit / histLoadMonth)
  function histState() {
    var H = (typeof hist !== "undefined") ? hist : null; if (!H) return { ready: true, rows: [], months: 0, loaded: 0 };
    if (!H.inited && typeof histInit === "function") histInit();
    var months = H.months || [], rows = [], loaded = 0;
    months.forEach(function (m) { if (H.rows.has(m)) { loaded++; rows = rows.concat(H.rows.get(m)); } else if (typeof histLoadMonth === "function") histLoadMonth(m); });
    return { ready: H.inited && loaded === months.length && !H.loading.size, rows: rows, months: months.length, loaded: loaded };
  }
  function sigNow(h) { var s = st(); try { return [(s.allParsedRows || []).length, h.rows.length, (s.debundleMap || []).length, Object.keys(s.productsMap || {}).length, s.cogsMap && s.cogsMap.size, Object.keys(s.inventoryMap || {}).length, BR.rOv[2], BR.rOv[3], BR.minBand, (s.productOnlyRows || []).length].join("|"); } catch (e) { return ""; } }

  function build(h) {
    var sg = sigNow(h), poNow = st().productOnlyRows;
    if (BR.data && sg === BR.sig && BR.poRef === poNow) return BR.data; BR.sig = sg; BR.poRef = poNow;
    var s = st(), pm = s.productsMap || {}, cogsMap = s.cogsMap || new Map(), inv = s.inventoryMap || {};
    var main = (typeof allSkuRows === "function" ? allSkuRows() : (s.allParsedRows || []));   // bundles + singles -> Main (Matches)
    var deb = s.debundleMap || [];
    if (!main.length || !deb.length) return (BR.data = null);
    var all = h.rows.concat(main);
    var cogsOf = function (id) { var c = cogsMap.get ? +cogsMap.get(id) || 0 : 0; return c > 1 ? c : 0; }; // 1 or less = placeholder
    var nameOf = {}; deb.forEach(function (r) { if (r.singleId && r.singleName && !nameOf[r.singleId]) nameOf[r.singleId] = r.singleName; if (r.productId && r.productName && !nameOf[r.productId]) nameOf[r.productId] = r.productName; });
    var nm = function (id) { return (inv[id] && inv[id].skuName) || nameOf[id] || id; };
    var catOf = function (id) { return String((inv[id] && inv[id].category) || (pm[id] && pm[id].category) || "").trim().toLowerCase(); };
    var subOf = function (id) { return String((pm[id] && pm[id].subCategory) || "").trim().toLowerCase(); };
    var scOf = function (id) { return String((pm[id] && pm[id].sc) || "").trim().toLowerCase(); }; // product type (Products → SC)
    var stockOf = function (id) { return inv[id] ? +inv[id].stock || 0 : 0; };

    var comps = new Map();
    deb.forEach(function (r) { if (!r.productId || !r.singleId) return; if (!comps.has(r.productId)) comps.set(r.productId, []); comps.get(r.productId).push({ s: r.singleId, q: +r.quantity || 1 }); });
    var pcsOf = function (id) { var c = comps.get(id); return c ? c.reduce(function (a, x) { return a + x.q; }, 0) : 1; };
    var isBundle = function (id) { return pcsOf(id) >= 2; };
    var existing = new Set(); comps.forEach(function (cs) { if (cs.length >= 2 && cs.every(function (x) { return x.q === 1; })) existing.add(cs.map(function (x) { return x.s; }).sort().join("|")); });

    // per SKU: all-time delivered (history + Main), and PPM from Main (history if Main has none)
    var T = new Map(), firstTs = 0, lastTs = 0;
    var tot = function (id) { var t = T.get(id); if (!t) T.set(id, t = { dp: 0, mo: 0, mp: 0, mppm: 0, ho: 0, hp: 0, hppm: 0, last: 0 }); return t; };
    h.rows.forEach(function (r) { if (!r.sku) return; var t = tot(r.sku); t.dp += r.deliveredPieces || 0; t.ho += r.deliveredOrders || 0; t.hp += r.deliveredPieces || 0; t.hppm += r.ppm || 0; if ((r.deliveredPieces || 0) > 0 && r.timestamp > t.last) t.last = r.timestamp; if (r.timestamp && (!firstTs || r.timestamp < firstTs)) firstTs = r.timestamp; });
    main.forEach(function (r) { if (!r.sku) return; var t = tot(r.sku); t.dp += r.deliveredPieces || 0; t.mo += r.deliveredOrders || 0; t.mp += r.deliveredPieces || 0; t.mppm += r.ppm || 0; if ((r.deliveredPieces || 0) > 0 && r.timestamp > t.last) t.last = r.timestamp; if (r.timestamp > lastTs) lastTs = r.timestamp; if (r.timestamp && (!firstTs || r.timestamp < firstTs)) firstTs = r.timestamp; });
    var ppmPiece = function (id) { var t = T.get(id); if (!t) return null; if (t.mp > 0) return t.mppm / t.mp; if (t.hp > 0 && t.hppm) return t.hppm / t.hp; return null; };
    var ppmOrder = function (id) { var t = T.get(id); if (!t) return null; if (t.mo > 0) return t.mppm / t.mo; if (t.ho > 0 && t.hppm) return t.hppm / t.ho; return null; };

    // singles that can go into a suggestion: sell on their own, have a PPM, a real COGS and stock now
    var single = function (id) { if (isBundle(id)) return null; var t = T.get(id); if (!t || !(t.dp > 0)) return null; var pp = ppmPiece(id); if (pp == null) return null;
      var pr = pm[id] ? +pm[id].price || 0 : 0, lp = pr > 0 && cogsOf(id) > 0 ? pr - (+pm[id].profit || 0) - cogsOf(id) : null; // PPM at today's pricing
      return { id: id, name: nm(id), cat: catOf(id), sub: subOf(id), sc: scOf(id), price: pr, listPpm: lp, cogs: cogsOf(id), stock: stockOf(id), ppmPiece: pp, ppmOrder: ppmOrder(id), last: t.last }; };
    var S = new Map(); T.forEach(function (t, id) { var u = single(id); if (u) S.set(id, u); });
    var usable = function (u) { return u && u.stock > 0 && u.cogs > 0; };

    // R — what a bundle earns per order vs the sum of its singles' PPM / piece (mixed bundles that sell now, Main)
    var Rl = { 2: [], 3: [] }, Rn = { 2: 0, 3: 0 };
    comps.forEach(function (cs, id) {
      var n = pcsOf(id); if (cs.length < 2 || !Rl[n]) return; var t = T.get(id); if (!t || !(t.mo > 0)) return;
      var sum = 0, ok = true; cs.forEach(function (x) { var u = S.get(x.s); if (!u) { ok = false; return; } sum += u.ppmPiece * x.q; });
      if (!ok || !(sum > 0)) return; Rl[n].push((t.mppm / t.mo) / sum); Rn[n]++;
    });
    var R = { 2: median(Rl[2]), 3: median(Rl[3]) };
    // list R of the mixed bundles that sell now (Main) — feeds the Pricing R bands
    var LR = { 2: [], 3: [] };
    comps.forEach(function (cs, id) {
      var n = pcsOf(id); if (cs.length < 2 || !LR[n]) return; var t = T.get(id); if (!t || !(t.mo > 0)) return;
      var b = pm[id]; if (!b || !(+b.price > 0)) return; var bc = 0, sl = 0, ok = true;
      cs.forEach(function (x) { var c = cogsOf(x.s), q = pm[x.s]; if (!c || !q || !(+q.price > 0)) { ok = false; return; } bc += c * x.q; sl += (+q.price - (+q.profit || 0) - c) * x.q; });
      if (!ok || !(sl > 0)) return; // a warranty card (COGS ≤ 1) has no real list PPM
      LR[n].push({ id: id, lr: (+b.price - (+b.profit || 0) - bc) / sl, orders: t.mo, ppm: t.mppm });
    });
    var pb = { 2: bandsOf(LR[2], BR.minBand), 3: bandsOf(LR[3], BR.minBand) };
    // CM3 per piece of each single as the main product of its own order (Product Only, IS_PRIMARY = true)
    // company-wide CM3 cost rates from Product Only (main-product rows of all products); dlv / cnf = ORDERS (main-product rows hold the orders)
    var CK = ["rev", "fee", "ship", "vat", "mk", "pack", "prov", "cs", "ret"], T0 = { dlv: 0, cnf: 0 }; CK.forEach(function (k) { T0[k] = 0; });
    var cmLoaded = false, cmFirst = 0, cmLast = 0;
    (s.productOnlyRows || []).forEach(function (r) { if (r.pCnf == null || r.p_fee == null) return; cmLoaded = true; T0.dlv += r.deliveredOrders || 0; T0.cnf += r.confirmedOrders || 0;
      CK.forEach(function (k) { T0[k] += r["p_" + k] || 0; });
      if (r.timestamp) { if (!cmFirst || r.timestamp < cmFirst) cmFirst = r.timestamp; if (r.timestamp > cmLast) cmLast = r.timestamp; } });
    var costs = COST_FALLBACK, costSrc = "Product Only Oct 1 → Nov 2 2026 (the loaded Product Only has no cost columns)";
    if (cmLoaded && T0.dlv > 0 && T0.cnf > T0.dlv && T0.rev > 0) {
      costs = { fee: T0.fee / T0.dlv, ship: -T0.ship / T0.dlv, vat: -T0.vat / T0.rev * 100, mk: -T0.mk / T0.rev * 100, pack: -T0.pack / T0.cnf, prov: -T0.prov / T0.cnf, cs: -T0.cs / T0.cnf, ret: -T0.ret / (T0.cnf - T0.dlv) };
      costSrc = "Product Only, " + new Date(cmFirst).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " → " + new Date(cmLast).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " (" + int(T0.cnf) + " confirmed orders, actual DR " + Math.round(T0.dlv / T0.cnf * 100) + "%)";
    }
    var PR = { 2: pricingR({ pb: pb, R: R }, 2), 3: pricingR({ pb: pb, R: R }, 3) }; // the R you price with → Expected PPM / Uplift / the filter

    // which KINDS of product go together = sub-category pairs (category pairs when a sub-category is missing) that already
    // sit together in a mixed bundle that sold since January. A pair of singles is suggested only if its kinds are one of them.
    var kindOf = function (id) { var t = scOf(id); if (t) return "t:" + t; var sb = subOf(id); return sb ? "s:" + sb : "c:" + catOf(id); };
    var kindKey = function (a, b) { var x = kindOf(a), y = kindOf(b); return x < y ? x + "|" + y : y + "|" + x; };
    var goTogether = new Map();
    comps.forEach(function (cs, id) { if (cs.length < 2) return; var t = T.get(id); if (!t || !(t.dp > 0)) return; var seenK = {};
      for (var i = 0; i < cs.length; i++) for (var j = i + 1; j < cs.length; j++) { var kk = kindKey(cs[i].s, cs[j].s); if (seenK[kk]) continue; seenK[kk] = 1; goTogether.set(kk, (goTogether.get(kk) || 0) + 1); } });
    // two singles of the SAME product type are alternatives to each other (two different cameras), not a bundle a customer buys
    var fits = function (a, b) { var x = kindOf(a), y = kindOf(b); if (x === y) return 0; return goTogether.get(kindKey(a, b)) || 0; };

    // the most similar single in stock: same sub-category (else category), closest price, not already in the bundle
    var bySc = new Map(), bySub = new Map(), byCat = new Map();
    var addTo = function (m, k, u) { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(u); };
    S.forEach(function (u) { if (!usable(u)) return; addTo(bySc, u.sc, u); addTo(bySub, u.sub, u); addTo(byCat, u.cat, u); });
    // singles of the same product type (else sub-category, else category) in stock, closest price first
    var similarList = function (x, exclude) {
      var ref = S.get(x) || { sc: scOf(x), sub: subOf(x), cat: catOf(x), price: pm[x] ? +pm[x].price || 0 : 0 };
      var by = ref.sc && bySc.get(ref.sc) ? "same product type" : ref.sub && bySub.get(ref.sub) ? "same sub-category" : "same category";
      var pool = (ref.sc && bySc.get(ref.sc)) || (ref.sub && bySub.get(ref.sub)) || (ref.cat && byCat.get(ref.cat)) || [];
      return pool.filter(function (u) { return exclude.indexOf(u.id) < 0 && u.id !== x; }).sort(function (a, b) { return Math.abs(a.price - ref.price) - Math.abs(b.price - ref.price); }).map(function (u) { return { u: u, by: by }; });
    };
    var similar = function (x, exclude) { return similarList(x, exclude)[0] || null; };

    var out = [], seen = new Set();
    // PPM of an existing bundle at today's pricing (Products: Price − Profit − its singles' COGS)
    var listPpmOf = function (id) { var b = pm[id], cs = comps.get(id); if (!b || !(+b.price > 0) || !cs) return null; var c = 0, ok = true; cs.forEach(function (x) { var v = cogsOf(x.s); if (!v) ok = false; c += v * x.q; }); return ok ? +b.price - (+b.profit || 0) - c : null; };
    var push = function (type, ids, why, strength, replaced, todayExtra, origList) {
      var n = ids.length; if (n < 2 || n > 3 || !PR[n]) return;
      var key = ids.slice().sort().join("|"); if (seen.has(key) || existing.has(key)) return;
      var us = ids.map(function (i) { return S.get(i); }); if (!us.every(usable)) return;
      var sumPp = 0, cogs = 0, today = todayExtra != null ? todayExtra : -Infinity, minStock = Infinity, cats = [];
      us.forEach(function (u) { sumPp += u.ppmPiece; cogs += u.cogs; if (u.ppmOrder != null && u.ppmOrder > today) today = u.ppmOrder; if (u.stock < minStock) minStock = u.stock; if (u.cat && cats.indexOf(u.cat) < 0) cats.push(u.cat); });
      var ppm = sumPp * PR[n]; if (!(isFinite(today) && ppm > today)) return; // Expected PPM / order at your price must beat today
      seen.add(key);
      // pricing at today's prices: Floor = the best single (or the original bundle) · Ceiling = the singles sold apart · Suggested = Ceiling × R
      var allList = us.every(function (u) { return u.listPpm != null; }), ceiling = null, floor = null;
      if (allList) {
        ceiling = 0; floor = origList != null ? origList : -Infinity;
        us.forEach(function (u) { ceiling += u.listPpm; if (u.listPpm > floor) floor = u.listPpm; });
      }
      // Suggested PPM, Base Price and Base price per SKU are set by price() on the Pricing R
      // (each SKU: its own PPM × the same R, so the bundle's discount is shared in the same proportion)
      out.push({ type: type, key: key, us: us, n: n, why: why, strength: strength, replaced: replaced || null, cogs: cogs, ppm: ppm, ppmPiece: ppm / n, today: today, uplift: ppm - today, minStock: minStock, cats: cats,
        floor: floor, ceiling: ceiling, allList: allList, suggested: null, priceBefore: null, parts: null });
    };

    // 1) Revive proven bundles that cannot run now
    comps.forEach(function (cs, id) {
      if (cs.length < 2) return; var n = pcsOf(id); if (n > 3) return;
      var t = T.get(id); if (!t || !(t.dp > 0)) return;
      var ids = []; cs.forEach(function (x) { for (var i = 0; i < x.q; i++) ids.push(x.s); });
      var out0 = ids.filter(function (x) { return stockOf(x) <= 0; }); if (!out0.length) return; // runs today — nothing to do
      var next = ids.slice(), rep = [];
      for (var i = 0; i < next.length; i++) { if (stockOf(next[i]) > 0) continue; var sm = similar(next[i], next); if (!sm) return; rep.push({ from: next[i], fromName: nm(next[i]), to: sm.u.id, by: sm.by }); next[i] = sm.u.id; }
      var orig = t.mo > 0 ? t.mppm / t.mo : null;
      push("revive", next, "Bundle " + id + " sold " + int(t.dp) + " pcs since " + new Date(firstTs).toLocaleString("en-US", { month: "short" }) + " (last " + (t.last ? new Date(t.last).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—") + ")", t.dp, rep, orig, listPpmOf(id));
    });

    // 1b) Variant — a proven bundle that runs today, with one single swapped for one of the 2 closest singles of the same
    //     product type (in stock): what customers already bought together, with a similar product
    comps.forEach(function (cs, id) {
      if (cs.length < 2) return; var n = pcsOf(id); if (n > 3) return;
      var t = T.get(id); if (!t || !(t.dp > 0)) return;
      var ids = []; cs.forEach(function (x) { for (var i = 0; i < x.q; i++) ids.push(x.s); });
      if (ids.some(function (x) { return stockOf(x) <= 0; })) return; // that one is a Revive
      var orig = t.mo > 0 ? t.mppm / t.mo : null;
      ids.forEach(function (x, slot) {
        similarList(x, ids).filter(function (c) { return c.by === "same product type"; }).slice(0, 2).forEach(function (c) {
          var next = ids.slice(); next[slot] = c.u.id;
          push("variant", next, "Variant of bundle " + id + " (sold " + int(t.dp) + " pcs since " + new Date(firstTs).toLocaleString("en-US", { month: "short" }) + ")", t.dp, [{ from: x, fromName: nm(x), to: c.u.id, by: c.by, variant: true }], orig, listPpmOf(id));
        });
      });
    });

    // 2) singles the same merchant delivered in the same month (numeric keys: there are ~400k pairs since January)
    var idx = new Map(), ids0 = [];
    var ix = function (id) { var v = idx.get(id); if (v == null) { v = ids0.length; idx.set(id, v); ids0.push(id); } return v; };
    var mm = new Map();
    all.forEach(function (r) { if (!r.sku || !r.merchantId || !((r.deliveredPieces || 0) > 0) || !S.has(r.sku)) return; var k = r.merchantId + "|" + monthKey(r.timestamp); var set = mm.get(k); if (!set) mm.set(k, set = new Set()); set.add(ix(r.sku)); });
    var keys = Array.from(mm.keys()).sort(), P = new Map(), W = 1 << 20;
    keys.forEach(function (k) {
      var m = k.split("|")[0], l = Array.from(mm.get(k)).sort(function (a, b) { return a - b; });
      for (var i = 0; i < l.length; i++) for (var j = i + 1; j < l.length; j++) {
        var pk = l[i] * W + l[j], e = P.get(pk);
        if (!e) P.set(pk, e = { n: 0, m: 0, last: "" });
        e.n++; if (e.last !== m) { e.m++; e.last = m; }
      }
    });
    var pairs = []; P.forEach(function (e, pk) { pairs.push({ a: ids0[Math.floor(pk / W)], b: ids0[pk % W], n: e.n, m: e.m }); });
    P = null; pairs.sort(function (x, y) { return (y.n - x.n) || (y.m - x.m); });
    // a single is used in at most MAX_PER_SINGLE New / Swap suggestions, so one popular SKU does not fill the whole list
    var CAP = 2000, MAX_PER_SINGLE = 3, got = { fresh: 0, swap: 0 }, capped = false, uses = new Map();
    var free = function (ids) { return ids.every(function (x) { return (uses.get(x) || 0) < MAX_PER_SINGLE; }); };
    var use = function (ids) { ids.forEach(function (x) { uses.set(x, (uses.get(x) || 0) + 1); }); };
    for (var pi = 0; pi < pairs.length; pi++) {
      if (got.fresh >= CAP && got.swap >= CAP) { capped = true; break; }
      var p = pairs[pi], ab = [p.a, p.b], why = "Sold together by " + int(p.m) + " merchants · " + int(p.n) + " merchant-months";
      var oos = ab.filter(function (x) { return stockOf(x) <= 0; }), before = out.length;
      if (!oos.length) { var fk = fits(p.a, p.b); if (got.fresh < CAP && fk && free(ab)) { push("fresh", ab, why + " · these product types sit together in " + fk + " bundles that sold", p.n); if (out.length > before) { got.fresh++; use(ab); } } continue; }
      if (oos.length === 2 || got.swap >= CAP) continue;
      var keep = ab.filter(function (x) { return stockOf(x) > 0; })[0], sm = similar(oos[0], ab); if (!sm) continue;
      var sw = [keep, sm.u.id], sk = fits(keep, sm.u.id); if (!sk || !free(sw.concat(oos[0]))) continue;
      push("swap", sw, why + " · these product types sit together in " + sk + " bundles that sold", p.n, [{ from: oos[0], fromName: nm(oos[0]), to: sm.u.id, by: sm.by }]);
      if (out.length > before) { got.swap++; use(sw.concat(oos[0])); }
    }

    var cats = {}; out.forEach(function (c) { c.cats.forEach(function (x) { cats[x] = 1; }); });
    return (BR.data = { cands: out, R: R, Rn: Rn, LR: LR, pb: pb, P: PR, costs: costs, costSrc: costSrc, cats: Object.keys(cats).sort(), capped: capped, firstTs: firstTs, lastTs: lastTs, histMonths: h.months, singles: S.size,
      counts: { revive: out.filter(function (c) { return c.type === "revive"; }).length, variant: out.filter(function (c) { return c.type === "variant"; }).length, fresh: out.filter(function (c) { return c.type === "fresh"; }).length, swap: out.filter(function (c) { return c.type === "swap"; }).length } });
  }

  function view(d) {
    var q = BR.q.trim().toLowerCase();
    d.cands.forEach(function (c) { price(d, c); });
    var rows = d.cands.filter(function (c) {
      if (BR.type !== "all" && c.type !== BR.type) return false;
      if (BR.cat !== "all" && c.cats.indexOf(BR.cat) < 0) return false;
      if (q && !c.us.some(function (u) { return u.id.toLowerCase().indexOf(q) >= 0 || String(u.name).toLowerCase().indexOf(q) >= 0; })) return false;
      return true;
    });
    // strongest evidence first inside each kind, then the uplift
    var by = function (a, b) { return (b.strength - a.strength) || (b.uplift - a.uplift); }, top = Math.max(1, BR.top || 200);
    if (BR.type !== "all") return rows.sort(by).slice(0, top);
    // All kinds: Revive, then Variant (both = proven bundles, by pieces sold), then Swap + New (by merchant-months)
    var pick = function (f) { return rows.filter(f).sort(by); };
    return pick(function (r) { return r.type === "revive"; }).concat(pick(function (r) { return r.type === "variant"; }), pick(function (r) { return r.type === "swap" || r.type === "fresh"; })).slice(0, top);
  }

  // the dashboard loads its sources after the page may already be drawn (cached copy first, then the fresh load):
  // while this page is open, re-draw it whenever Matches / Product Only / the debundle map / Products are replaced
  function srcRefs() { var s = st(); return [s.allParsedRows, s.productOnlyRows, s.debundleMap, s.productsMap, s.inventoryMap, s.cogsMap]; }
  function watch(host) {
    BR.refs = srcRefs(); clearInterval(BR.watch);
    BR.watch = setInterval(function () {
      if (!host.isConnected || host.classList.contains("hidden")) { clearInterval(BR.watch); return; }
      var now = srcRefs(); if (now.some(function (x, i) { return x !== BR.refs[i]; })) render(host);
    }, 2000);
  }
  function render(host) {
    var h = histState();
    if (!h.ready) {
      host.innerHTML = '<div class="panel" style="padding:18px"><div class="sc-note">Loading the history months (' + h.loaded + ' of ' + h.months + ') — the recommendations use every month since January. This page fills in by itself.</div></div>';
      clearTimeout(BR.poll); BR.poll = setTimeout(function () { if (!host.classList.contains("hidden")) render(host); }, 1500); return;
    }
    var d = build(h);
    watch(host);
    if (!d) { host.innerHTML = '<div class="panel" style="padding:18px"><div class="sc-note">Waiting for dashboard data (Matches, Products, COGS, inventory and the debundle map). This page fills in by itself.</div></div>'; return; }
    var rows = view(d);
    var span = d.firstTs ? new Date(d.firstTs).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) + " → " + new Date(d.lastTs).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
    var avgUp = rows.length ? rows.reduce(function (a, r) { return a + r.uplift; }, 0) / rows.length : 0;
    var tiles = [
      ["Revive", int(d.counts.revive), "proven bundles stuck on a single with no stock → similar single in stock"],
      ["Variant", int(d.counts.variant), "proven bundles with one single swapped for a similar one (same product type)"],
      ["Swap", int(d.counts.swap) + (d.capped ? "+" : ""), "sold-together pairs with one single out of stock → similar single"],
      ["New", int(d.counts.fresh) + (d.capped ? "+" : ""), "sold-together pairs, both in stock, not a bundle yet"],
      ["Avg uplift / order", money(avgUp), "of the " + int(rows.length) + " shown, vs the best single today"]
    ];
    var html = '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Bundle Recommendations</h2>' +
      '<p>Bundles you can run now, built from what already worked together (' + esc(span) + ': history tab + Matches). Only singles that sell on their own and are in stock; only bundles that earn more per order than today.</p></div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' +
      '<div class="sc-note" style="margin:0 18px 14px">Pricing (today\'s prices, Products: Price − Profit − COGS): price between <b>Floor PPM</b> (the best single alone) and <b>Ceiling PPM</b> (the singles sold apart); <b>Suggested PPM</b> = Ceiling × <b>Pricing R</b> (box below); <b>Base Price</b> = COGS + Suggested PPM — add the merchant profit on top to get the Selling Price. <b>Base price per SKU</b> = each SKU\'s COGS + its PPM alone × Pricing R (the same discount on every SKU); they add up to Base Price. <b>Expected PPM / order</b> = what the bundle earns per order at the price you set = its singles\' actual PPM per piece × Pricing R; <b>Uplift</b> = Expected − Today, and only bundles with Uplift &gt; 0 are listed.<br>For reference, the discount your selling bundles give in practice (actual R): <b>2 pieces = ' + (d.R[2] == null ? "—" : d.R[2].toFixed(2)) + '</b> (' + int(d.Rn[2]) + ' bundles) · <b>3 pieces = ' + (d.R[3] == null ? "—" : d.R[3].toFixed(2)) + '</b> (' + int(d.Rn[3]) + ' bundles). A similar single = same product type (Products → SC; else sub-category, else category), the closest price, in stock. Swap / New need their two product types to already sit together in a bundle that sold, and never pair two of the same product type.</div></div>';

    html += pricingPanel(d);
    html += '<div class="panel table-panel hover-glow"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Recommendations</h2><p>All kinds = Revive, then Variant (proven bundles, by pieces sold), then Swap + New (by merchant-months). A single appears in at most 3 Swap / New suggestions.</p></div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:0 18px 12px">' +
      '<select id="brType" class="date-filter-input" style="flex:0 0 auto"><option value="all">All kinds</option>' + ["revive", "variant", "swap", "fresh"].map(function (k) { return '<option value="' + k + '"' + (BR.type === k ? " selected" : "") + '>' + TYPE_LABEL[k] + '</option>'; }).join("") + '</select>' +
      '<select id="brCat" class="date-filter-input" style="flex:0 0 auto"><option value="all">All categories</option>' + d.cats.map(function (c) { return '<option value="' + esc(c) + '"' + (BR.cat === c ? " selected" : "") + '>' + esc(c) + '</option>'; }).join("") + '</select>' +
      '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:0 0 auto">Show top <input id="brTop" type="number" min="1" value="' + BR.top + '" class="date-filter-input" style="width:80px;min-width:0;flex:0 0 80px"></label>' +
      '<input id="brQ" type="search" class="date-filter-input" style="flex:0 1 240px;min-width:160px" placeholder="Search SKU ID or name" value="' + esc(BR.q) + '">' +
      '<button type="button" class="tw-exp" id="brCsv">Export CSV</button></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:0 18px 6px"><b>CM3 check</b>' +
      '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px">DR% <input id="brDr" type="number" min="1" max="100" step="1" value="' + BR.dr + '" class="date-filter-input" style="width:70px;min-width:0;flex:0 0 70px"></label>' +
      '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px">Merchant profit (avg) <input id="brMp" type="number" min="0" value="' + BR.mp + '" class="date-filter-input" style="width:80px;min-width:0;flex:0 0 80px"></label>' +
      '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px">"Same" within ± EGP <input id="brCmSame" type="number" min="0" value="' + BR.cmSame + '" class="date-filter-input" style="width:70px;min-width:0;flex:0 0 70px"></label>' +
      '<button type="button" class="btn" id="brCostAuto">Costs back to data</button></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:0 18px 6px">' + (function () { var R = costRates(d); return COST_KEYS.map(function (k) {
        var mine = BR.costOv[k[0]] != null && BR.costOv[k[0]] !== "";
        return '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px" title="From the data: ' + (+d.costs[k[0]]).toFixed(2) + '">' + k[1] + ' <span>' + k[2] + '</span><input data-cost="' + k[0] + '" type="number" step="0.01" min="0" value="' + (+R[k[0]]).toFixed(2) + '" class="date-filter-input' + (mine ? ' text-orange' : '') + '" style="width:80px;min-width:0;flex:0 0 80px"></label>'; }).join(""); })() + '</div>' +
      '<div class="sc-note" style="margin:0 18px 12px">CM3 of one order at DR ' + BR.dr + '% = PPM + shipping fee − shipping − (VAT% + marketing%) × price − (packaging + provision + CS + (1 − DR) × returns) ÷ DR. <b>Bundle</b> = one order (PPM = Expected PPM / order, price = Base Price + merchant profit). <b>Singles</b> = one order each (PPM = its actual PPM / piece, price = its selling price in Products). Cost rates: ' + esc(d.costSrc) + ' — per ORDER (one shipment), main-product orders of all products; type your own to change one.</div>' +
      '<div class="table-responsive"><table class="data-table" id="brTable"><thead><tr><th>#</th><th title="Revive = proven bundle with a replaced single (no stock) · Variant = proven bundle with a similar single · Swap = sold-together pair with a replaced single · New = sold-together pair.">Kind</th><th>Bundle (single SKUs)</th><th>Why</th><th>Category</th>' +
      '<th class="num">Pcs</th><th class="num" title="Sum of the singles\' COGS.">COGS</th>' +
      '<th class="num" title="Lowest PPM per order worth pricing at: the best single alone at today\'s pricing (Price − Profit − COGS), or the original bundle for Revive / Variant. Below it, selling the single alone earns more.">Floor PPM</th>' +
      '<th class="num" title="Ceiling PPM × Pricing R (' + rTxt(pricingR(d, 2)) + ' for 2 pieces, ' + rTxt(pricingR(d, 3)) + ' for 3 — see the Pricing R box). Orange = below the Floor.">Suggested PPM</th>' +
      '<th class="num" title="The singles sold apart at today\'s pricing (sum of Price − Profit − COGS). At or above it the customer has no reason to buy the bundle.">Ceiling PPM</th>' +
      '<th class="num" title="COGS + Suggested PPM = the bundle\'s Selling Price without the merchant profit.">Base Price</th>' +
      '<th class="num" title="Suggested PPM ÷ pieces.">Suggested PPM / piece</th>' +
      '<th title="How to price each SKU inside the bundle: PPM in bundle = its PPM alone (today\'s pricing) × Pricing R; Base price = its COGS + PPM in bundle (without the merchant profit). The base prices add up to Base Price.">Base price per SKU</th>' +
      '<th class="num" title="What you earn per order at the price you set: the singles\' actual delivered PPM per piece × Pricing R. Lower than Suggested PPM when the singles earn less in practice than their list price.">Expected PPM / order</th>' +
      '<th class="num" title="The best actual PPM per delivered order of any of these singles sold alone (and of the original bundle for Revive / Variant).">Today (actual)</th><th class="num" title="Expected PPM / order − Today (actual).">Uplift / order</th><th class="num" title="The lowest stock among the singles.">Min stock</th>' +
      '<th class="num" title="One order at DR ' + BR.dr + '% with the cost rates above: Expected PPM / order + shipping fee − shipping − (VAT + marketing)% × (Base Price + merchant profit ' + int(BR.mp) + ') − (packaging + provision + CS + (1 − DR) × returns) ÷ DR.">Expected CM3 / order</th>' +
      '<th class="num" title="The same for each single as its own order (its actual PPM / piece, its selling price in Products), added up.">Singles CM3</th>' +
      '<th class="num" title="Expected CM3 / order − Singles CM3.">Δ CM3 / order</th><th title="More / Same (within ± ' + int(BR.cmSame) + ' EGP) / Less.">CM3 verdict</th></tr></thead><tbody id="brBody"></tbody></table></div>' +
      '<div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:10px 18px"><button type="button" class="btn" id="brPrev">Prev</button><span class="text-dim" id="brPageInfo"></span><button type="button" class="btn" id="brNext">Next</button></div></div>';
    host.innerHTML = html;
    drawBody(host, rows);
    wire(host);
  }

  function rTxt(v) { return v == null || !isFinite(v) ? "—" : (+v).toFixed(2); }
  // Pricing R: the R the Suggested PPM / Base prices use — auto (best list-R band) or yours
  function pricingPanel(d) {
    var one = function (n) {
      var b = d.pb[n], P = pricingR(d, n), mine = BR.rOv[n] > 0;
      var rows = b.rows.map(function (r) {
        var win = b.best && r.label === b.best.label;
        return '<tr' + (win ? ' style="background:rgba(34,197,94,.14)"' : '') + '><td>' + (win ? '<b>' + r.label + ' ✓</b>' : r.label) + '</td><td class="num">' + int(r.n) + '</td><td class="num">' + int(r.orders) + '</td>' +
          '<td class="num">' + (r.perBundle == null ? "—" : int(r.perBundle)) + '</td><td class="num">' + mv(r.perOrder) + '</td><td class="num"><b>' + mv(r.score) + '</b></td><td class="num">' + rTxt(r.r) + '</td><td>' + (r.ok ? "" : '<small class="text-dim">too few</small>') + '</td></tr>';
      }).join("");
      return '<div style="flex:1 1 640px;min-width:0"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><b>' + n + ' pieces</b>' +
        '<span class="text-dim">Auto = <b>' + rTxt(b.auto) + '</b>' + (b.best ? ' (band ' + b.best.label + ', ' + int(b.best.n) + ' bundles)' : ' (no band has enough bundles → median of all ' + int(b.count) + ')') + '</span>' +
        '<label class="text-dim" style="display:inline-flex;align-items:center;gap:6px">Your R <input id="brR' + n + '" type="number" step="0.01" min="0.05" max="1.5" placeholder="' + rTxt(b.auto) + '" value="' + (mine ? BR.rOv[n] : "") + '" class="date-filter-input" style="width:80px;min-width:0;flex:0 0 80px"></label>' +
        '<span>Using <b class="' + (mine ? 'text-orange' : 'text-green') + '">' + rTxt(P) + '</b>' + (mine ? ' (yours)' : ' (auto)') + '</span></div>' +
        '<div class="table-responsive"><table class="data-table" style="font-size:12px"><thead><tr><th>List R band</th><th class="num">Bundles</th><th class="num">Delivered orders</th><th class="num" title="Demand">Orders / bundle</th><th class="num" title="Profit per order">Actual PPM / order</th><th class="num" title="Score = median actual PPM per bundle (demand × profit). The best band with enough bundles wins.">Median PPM / bundle</th><th class="num">Median list R</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    };
    return '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Pricing R</h2>' +
      '<p>The R the Suggested PPM and Base price per SKU use. Auto = the discount that brought the most PPM per bundle (demand × profit) in your mixed bundles that sell now (Matches). List R of a bundle = its PPM at today\'s price (Price − Profit − COGS) ÷ its singles\' PPM at today\'s price. Bundles with a warranty card (COGS ≤ 1) are left out. Expected PPM / order, Uplift and which bundles are listed follow the same R — change it and the list is rebuilt.</p></div></div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:0 18px 10px"><label class="text-dim" style="display:inline-flex;align-items:center;gap:6px">Min bundles in a band <input id="brMin" type="number" min="1" value="' + BR.minBand + '" class="date-filter-input" style="width:70px;min-width:0;flex:0 0 70px"></label>' +
      '<button type="button" class="btn" id="brRAuto">Back to auto</button><small class="text-dim">Score = median (not total), so one big bundle cannot decide a band alone. Type your own R to price with it.</small></div>' +
      '<div style="display:flex;gap:18px;flex-wrap:wrap;padding:0 18px 16px">' + one(2) + one(3) + '</div></div>';
  }
  function mv(v) { return v == null || !isFinite(v) ? "—" : money(v); }
  // per SKU: PPM alone → PPM in bundle · COGS · Base price
  function partsCell(r) {
    if (!r.parts) return '<span class="text-dim">—</span>';
    var td = function (t, right, bold) { return '<td style="padding:0 8px 2px 0' + (right ? ';text-align:right' : '') + '">' + (bold ? '<b>' + t + '</b>' : t) + '</td>'; };
    return '<table style="border-collapse:collapse;font-size:12px;white-space:nowrap"><tr class="text-dim">' + td("SKU") + td("PPM alone", 1) + td("PPM in bundle", 1) + td("COGS", 1) + td("Base price", 1) + '</tr>' +
      r.parts.map(function (x) { return '<tr title="' + esc(x.name) + '">' + td(esc(x.id)) + td(int(x.alone), 1) + td(int(x.inBundle), 1) + td(int(x.cogs), 1) + td(int(x.base), 1, 1) + '</tr>'; }).join("") + '</table>';
  }
  function drawBody(host, rows) {
    rows = rows || view(BR.data);
    var pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (BR.page > pages - 1) BR.page = pages - 1;
    var slice = rows.slice(BR.page * PAGE, BR.page * PAGE + PAGE), body = host.querySelector("#brBody"); if (!body) return;
    body.innerHTML = slice.length ? slice.map(function (r, i) {
      var repTo = {}; (r.replaced || []).forEach(function (x) { repTo[x.to] = x; });
      return '<tr><td>' + (BR.page * PAGE + i + 1) + '</td><td>' + TYPE_LABEL[r.type] + '</td><td>' + r.us.map(function (u) {
        var x = repTo[u.id];
        return '<div><b>' + esc(u.name) + '</b> <small class="text-dim">' + esc(u.id) + ' · PPM/pc ' + (u.listPpm == null ? "—" : int(u.listPpm)) + ' (actual ' + int(u.ppmPiece) + ') · stock ' + int(u.stock) + '</small>' + (x ? '<div><small class="text-orange">' + (x.variant ? 'instead of ' + esc(x.fromName) + ' (' + esc(x.from) + ') · ' : 'replaces ' + esc(x.fromName) + ' (' + esc(x.from) + ', no stock) · ') + esc(x.by) + '</small></div>' : '') + '</div>';
      }).join("") + '</td><td><small>' + esc(r.why) + '</small></td><td>' + esc(r.cats.join(" + ")) + '</td><td class="num">' + r.n + '</td><td class="num">' + money(r.cogs) + '</td>' +
        '<td class="num">' + mv(r.floor) + '</td><td class="num' + (r.suggested != null && r.floor != null && r.suggested < r.floor ? ' text-orange' : '') + '"><b>' + mv(r.suggested) + '</b></td><td class="num">' + mv(r.ceiling) + '</td><td class="num"><b>' + mv(r.priceBefore) + '</b></td>' +
        '<td class="num">' + mv(r.suggested != null ? r.suggested / r.n : null) + '</td><td>' + partsCell(r) + '</td>' +
        '<td class="num">' + money(r.ppm) + '</td><td class="num">' + money(r.today) + '</td><td class="num text-green">+' + int(r.uplift) + '</td><td class="num">' + int(r.minStock) + '</td>' +
        (r.cm3 == null ? '<td class="num text-dim" colspan="4" title="' + esc(r.cm3Why) + '"><small>— ' + esc(r.cm3Why) + '</small></td>' :
          '<td class="num"><b>' + money(r.cm3) + '</b></td><td class="num">' + money(r.cm3S) + '</td><td class="num ' + (r.cm3D >= 0 ? 'text-green' : 'text-orange') + '">' + (r.cm3D >= 0 ? '+' : '−') + int(Math.abs(r.cm3D)) + '</td><td><b class="' + (r.cm3V === "More" ? 'text-green' : (r.cm3V === "Less" ? 'text-orange' : '')) + '">' + r.cm3V + '</b></td>') + '</tr>';
    }).join("") : '<tr><td colspan="21" class="text-dim" style="text-align:center;padding:18px">No recommendation matches these filters.</td></tr>';
    var pi = host.querySelector("#brPageInfo"); if (pi) pi.textContent = "Page " + (BR.page + 1) + " of " + pages + " · " + int(rows.length) + " shown";
  }

  function csv() {
    var rows = view(BR.data), head = ["Kind", "Bundle SKUs", "Bundle names", "Replaced single", "Why", "Category", "Pieces", "COGS", "Floor PPM", "Pricing R", "Suggested PPM", "Ceiling PPM", "Base Price", "Suggested PPM per piece", "Expected PPM per order", "Today (actual)", "Uplift per order", "Min stock", "Expected CM3 per order", "Singles CM3", "Delta CM3 per order", "CM3 verdict", "CM3 note"];
    [1, 2, 3].forEach(function (k) { head.push("SKU " + k, "SKU " + k + " name", "SKU " + k + " PPM alone", "SKU " + k + " PPM in bundle", "SKU " + k + " COGS", "SKU " + k + " Base price"); });
    var rd = function (v) { return v == null || !isFinite(v) ? "" : Math.round(v); };
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [head.join(",")].concat(rows.map(function (r) { return [TYPE_LABEL[r.type], r.us.map(function (u) { return u.id; }).join(" + "), r.us.map(function (u) { return u.name; }).join(" + "), (r.replaced || []).map(function (x) { return x.from + " → " + x.to; }).join("; "), r.why, r.cats.join(" + "), r.n, Math.round(r.cogs), rd(r.floor), r.pr == null ? "" : (+r.pr).toFixed(3), rd(r.suggested), rd(r.ceiling), rd(r.priceBefore), rd(r.suggested != null ? r.suggested / r.n : null), Math.round(r.ppm), Math.round(r.today), Math.round(r.uplift), r.minStock, rd(r.cm3), rd(r.cm3S), rd(r.cm3D), r.cm3V, r.cm3Why].concat([0, 1, 2].reduce(function (a, k) { var x = r.parts && r.parts[k]; return a.concat(x ? [x.id, x.name, rd(x.alone), rd(x.inBundle), rd(x.cogs), rd(x.base)] : ["", "", "", "", "", ""]); }, [])).map(q).join(","); }));
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "bundle-recommendations.csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function wire(host) {
    var re = function () { BR.page = 0; render(host); };
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("brType", "change", function (e) { BR.type = e.target.value; re(); });
    on("brCat", "change", function (e) { BR.cat = e.target.value; re(); });
    on("brTop", "change", function (e) { BR.top = Math.max(1, Math.round(+e.target.value || 200)); re(); });
    on("brQ", "input", function (e) { BR.q = e.target.value; BR.page = 0; drawBody(host); });
    on("brCsv", "click", csv);
    var setR = function (n) { return function (e) { var v = parseFloat(e.target.value); BR.rOv[n] = v > 0 ? v : null; saveR(); re(); }; };
    on("brR2", "change", setR(2)); on("brR3", "change", setR(3));
    on("brMin", "change", function (e) { BR.minBand = Math.max(1, Math.round(+e.target.value || 5)); saveR(); re(); });
    on("brMp", "change", function (e) { var v = parseFloat(e.target.value); BR.mp = v >= 0 ? v : 200; saveR(); re(); });
    on("brDr", "change", function (e) { var v = parseFloat(e.target.value); BR.dr = v > 0 && v <= 100 ? v : 50; saveR(); re(); });
    host.querySelectorAll("input[data-cost]").forEach(function (el) { el.addEventListener("change", function () { var v = parseFloat(el.value); if (isFinite(v) && v >= 0) BR.costOv[el.dataset.cost] = v; else delete BR.costOv[el.dataset.cost]; saveR(); re(); }); });
    on("brCostAuto", "click", function () { BR.costOv = {}; saveR(); re(); });
    on("brCmSame", "change", function (e) { var v = parseFloat(e.target.value); BR.cmSame = v >= 0 ? v : 0; saveR(); re(); });
    on("brRAuto", "click", function () { BR.rOv = { 2: null, 3: null }; saveR(); re(); });
    on("brPrev", "click", function () { if (BR.page > 0) { BR.page--; drawBody(host); } });
    on("brNext", "click", function () { BR.page++; drawBody(host); });
  }

  // for tests / the console
  window.TaagerBundleRec = { build: function () { BR.data = null; BR.sig = ""; return build(histState()); }, state: BR, bandsOf: bandsOf, pricingR: pricingR, view: function () { return view(BR.data || build(histState())); }, render: render };

  function boot() {
    C = window.TowerCore; if (!C || !C.registerView) { setTimeout(boot, 300); return; }
    C.registerView("bundleRecommendations", { sectionId: "viewBundleRecommendations", navId: "navBundleRecommendations", label: "Bundle Recommendations", sub: "Bundles to run now, from what already worked together", open: true, render: render });
    var nav = $("navBundleRecommendations"); if (nav && !nav.dataset.br) { nav.dataset.br = "1"; nav.addEventListener("click", function () { window.switchView("bundleRecommendations"); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 150); }); else setTimeout(boot, 150);
})();
