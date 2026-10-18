/* Merchants → RE-CPA (v1.17.0). Staff adapter for js/cpa-core.js:
   price / profit from the Products sheet; CR / DR / NDR and Delivered ASP = the PRODUCT's numbers from the Main rows
   (all merchants, last rateDays days; DR on the matured rows); plans saved per merchant on the Worker (and the merchant's own plan from the portal). */
(function () {
  "use strict";
  var C = null, CFG = null, CAT = null, cur = { mid: "", source: "staff" }, handle = null, merchantPlan = null;
  function $(id) { return document.getElementById(id); }
  function api(action, body, params) { return C.wfetch(action, body === undefined ? { timeout: 20000 } : { timeout: 20000, body: JSON.stringify(body) }, params || "").then(function (j) { if (j && j.success === false) throw new Error(j.message || "Failed"); return j; }); }
  function st() { try { return state; } catch (e) { return {}; } }
  function cfg() { return CFG || { shipping: 99, safetyPct: 20, rateDays: 30, minOwnPieces: 20 }; }
  function rowsAll() { return st().allParsedRows || []; }
  function catalog() { if (CAT) return Promise.resolve(CAT); return api("loopCpaCatalog").then(function (j) { CAT = j.items || {}; if (j.cfg) CFG = j.cfg; return CAT; }).catch(function () { CAT = {}; return CAT; }); }
  function rates(sku, mid) {
    var rows = rowsAll(), latest = 0; rows.forEach(function (r) { if (r.timestamp > latest) latest = r.timestamp; });
    var c = cfg(), from = latest - (c.rateDays || 30) * 864e5, matured = latest - 5 * 864e5;
    var P = { p: 0, c: 0, c2: 0, d2: 0, g: 0, dl: 0 }, M = { p: 0, c: 0, c2: 0, d2: 0, g: 0, dl: 0 }, name = "";
    rows.forEach(function (r) {
      if (r.sku !== sku || r.timestamp < from) return;
      var acc = [P]; if (mid && String(r.merchantId) === String(mid)) acc.push(M);
      acc.forEach(function (a) { a.p += r.placedPieces || 0; a.g += r.deliveredGmv || 0; a.dl += r.deliveredPieces || 0; a.c += r.confirmedPieces || 0; if (r.timestamp <= matured) { a.c2 += r.confirmedPieces || 0; a.d2 += r.deliveredPieces || 0; } });
    });
    var rate = function (a) { return { cr: a.p > 0 ? a.c / a.p : null, dr: a.c2 > 0 ? a.d2 / a.c2 : null }; };
    var pr = rate(P), mr = rate(M), own = mid && M.p >= (c.minOwnPieces || 20) && mr.cr != null && mr.dr != null;
    return { own: own ? mr : null, product: pr, asp: P.dl > 0 ? P.g / P.dl : null }; // Delivered ASP = delivered GMV ÷ delivered pieces
  }
  function lookupRates(sku) {
    var mid = cur.mid, prod = (st().productsMap || {})[sku], inv = (st().inventoryMap || {})[sku];
    return catalog().then(function (cat) {
      var x = cat[sku] || [], r = rates(sku, mid), pick = r.product; // the product's CR / DR (all merchants)
      var name = (inv && inv.skuName) || x[0] || "";
      if (!prod && !x.length && !name) return null;
      var crdr = pick && pick.cr != null ? pick : { cr: x[3], dr: x[4] };
      return { sku: sku, n: name, price: prod && prod.price ? prod.price : x[1], profit: prod && prod.price ? prod.profit : x[2], cr: crdr.cr, dr: crdr.dr, src: "product", asp: r.asp != null ? r.asp : x[7],
        productNdr: r.product.cr != null && r.product.dr != null ? r.product.cr * r.product.dr : (x[3] != null && x[4] != null ? x[3] * x[4] : null) };
    });
  }
  function skuOptions() {
    var out = {}, mid = cur.mid;
    rowsAll().forEach(function (r) { if (mid && String(r.merchantId) !== String(mid)) return; var o = out[r.sku] || (out[r.sku] = { sku: r.sku, n: "", p: 0 }); o.p += r.placedPieces || 0; });
    var inv = st().inventoryMap || {};
    return Object.keys(out).map(function (k) { out[k].n = (inv[k] && inv[k].skuName) || ""; return out[k]; }).sort(function (a, b) { return b.p - a.p; });
  }
  function lookup(q) {
    q = q.toLowerCase(); var inv = st().inventoryMap || {}, prods = st().productsMap || {}, seen = {}, out = [];
    Object.keys(prods).concat(Object.keys(inv)).forEach(function (k) { if (seen[k] || out.length >= 30) return; var n = (inv[k] && inv[k].skuName) || ""; if (k.toLowerCase().indexOf(q) >= 0 || n.toLowerCase().indexOf(q) >= 0) { seen[k] = 1; out.push({ sku: k, n: n }); } });
    return Promise.resolve(out);
  }
  function merchants() { return (st().merchantTableData || []).map(function (m) { return { id: String(m.id), name: m.name || "" }; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); }
  function render(host) {
    var esc = C.esc, ms = merchants();
    handle = window.TaagerCpa.mount(host, {
      esc: esc, cfg: cfg,
      title: "RE-CPA · Max CPA calculator",
      sub: "Add a SKU: the product's CR / DR / NDR, selling price, profit and Delivered ASP fill in. Type AVE Market, Actual CPA and Conversions — Max CPA is automatic, above it the merchant loses money.",
      extraHead: '<input id="cpaMid" list="cpaMidList" placeholder="Merchant ID or name (empty = general plan)" value="' + esc(cur.mid) + '"><datalist id="cpaMidList">' + ms.slice(0, 3000).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + "</option>"; }).join("") + '</datalist><button type="button" class="btn" id="cpaOpen">Open plan</button><button type="button" class="btn" id="cpaMerchant" disabled>Merchant\'s own plan</button>',
      onHead: function (h) {
        h.querySelector("#cpaOpen").onclick = function () { var v = h.querySelector("#cpaMid").value.trim(); var m = ms.filter(function (x) { return x.id === v || x.name.toLowerCase() === v.toLowerCase(); })[0]; cur.mid = m ? m.id : v.replace(/[^0-9A-Za-z_-]/g, ""); cur.source = "staff"; handle.reload(); };
        h.querySelector("#cpaMid").addEventListener("keydown", function (e) { if (e.key === "Enter") h.querySelector("#cpaOpen").click(); });
        h.querySelector("#cpaMerchant").onclick = function () { cur.source = cur.source === "merchant" ? "staff" : "merchant"; handle.reload(); };
      },
      load: function () {
        return api("loopCpaGet", undefined, "&mid=" + encodeURIComponent(cur.mid || "")).then(function (j) {
          if (j.cfg) CFG = j.cfg; merchantPlan = j.merchant;
          var b = host.querySelector("#cpaMerchant");
          if (b) { b.disabled = !merchantPlan || !(merchantPlan.rows || []).length; b.textContent = cur.source === "merchant" ? "Back to the team plan" : "Merchant's own plan" + (merchantPlan && merchantPlan.rows ? " (" + merchantPlan.rows.length + ")" : ""); }
          if (cur.source === "merchant" && merchantPlan) return { rows: merchantPlan.rows, updatedAt: merchantPlan.updatedAt };
          return j.staff || { rows: [] };
        });
      },
      save: function (rows) { if (cur.source === "merchant") return Promise.reject(new Error("This is the merchant's own plan (read-only). Switch back to the team plan to save.")); return api("loopCpaSave", { mid: cur.mid, rows: rows }).then(function () { C.logActivity("other", "RE-CPA plan saved", (cur.mid || "general") + " · " + rows.length + " SKUs"); }); },
      lookup: lookup, rates: lookupRates, skuOptions: skuOptions
    });
  }
  function boot() {
    C = window.TowerCore; if (!C || !C.registerView || !window.TaagerCpa) { setTimeout(boot, 300); return; }
    C.registerView("merchantCpa", { sectionId: "viewMerchantCpa", navId: "navMerchantCpa", label: "RE-CPA", sub: "Max CPA calculator per merchant & SKU", open: true, render: render });
    var nav = $("navMerchantCpa"); if (nav && !nav.dataset.cpa) { nav.dataset.cpa = "1"; nav.addEventListener("click", function () { window.switchView("merchantCpa"); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 150); }); else setTimeout(boot, 150);
})();
