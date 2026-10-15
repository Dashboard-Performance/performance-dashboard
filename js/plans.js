/* v1.17.0 — Monthly plans edited in Control → Targets and read by the whole dashboard.
   Stored on the Worker (KV) per month, like the other targets:
     targets:supplyplan.YYYY-MM  → { values: { beg, pur, ret, rep }, at, by }          (Supply Chain → Supply conversion "Planned")
     targets:segplan.YYYY-MM     → { values: { r4: 0.05, r19: 3400, … }, at, by }      (Admin Panel → Segmentation Panel targets)
   A month with nothing saved uses the previous month's plan, then the built-in defaults. */
(function () {
  "use strict";
  // ---- Supply conversion (planned COGS per source)
  var SUPPLY_FIELDS = [
    { id: "beg", label: "Beg Inv.", help: "Planned COGS sold from the beginning inventory" },
    { id: "pur", label: "Purchases", help: "Planned COGS sold from this month's purchases" },
    { id: "ret", label: "Returns", help: "Planned COGS sold from returned stock" },
    { id: "rep", label: "Repack", help: "Planned COGS sold from repacked stock" }
  ];
  var SUPPLY_DEF = { beg: 27000000, pur: 12500000, ret: 16096387, rep: 9442000 };

  // ---- Segmentation plan — same model as the "Egy-N" sheet (Merchants New Segmentation):
  //   rate  = % of last month's merchants of the segment  → target = ROUNDUP(last month × %)
  //   count = number of merchants · num = orders per merchant · pct = DR% · money = EGP
  // Every row that is NOT here is calculated automatically (see SEG_AUTO for the formulas shown in the editor).
  var SEG_INPUTS = [
    { s: "HVM (Champions)", id: "r4", l: "Churned", k: "rate", d: 0 },
    { s: "HVM (Champions)", id: "r5", l: "Demoted", k: "rate", d: 0.25 },
    { s: "HVM (Champions)", id: "r6", l: "Demoted to loyal MVM", k: "count", d: 0, sub: 1 },
    { s: "HVM (Champions)", id: "r7", l: "Demoted to potential loyal MVM", k: "count", d: 0, sub: 1 },
    { s: "HVM (Champions)", id: "r8", l: "Demoted to LVM", k: "count", d: 0, sub: 1 },
    { s: "HVM (Champions)", id: "r9", l: "Retained", k: "rate", d: 0.75 },
    { s: "HVM (Champions)", id: "r10", l: "Re-activated", k: "rate", d: 0.06 },
    { s: "HVM (Champions)", id: "r11", l: "New", k: "rate", d: 0.06 },
    { s: "HVM (Champions)", id: "r12", l: "Promoted", k: "rate", d: 0.2 },
    { s: "HVM (Champions)", id: "r13", l: "Promoted from loyal MVM", k: "count", d: 0, sub: 1 },
    { s: "HVM (Champions)", id: "r14", l: "Promoted from potential loyal MVM", k: "count", d: 0, sub: 1 },
    { s: "HVM (Champions)", id: "r15", l: "Promoted from LVM", k: "count", d: 0, sub: 1 },
    { s: "HVM (Champions)", id: "r19", l: "Confirmed orders per merchant", k: "num", d: 3400 },
    { s: "HVM (Champions)", id: "r23", l: "DR%", k: "pct", d: 0.5 },

    { s: "Loyal MVM", id: "r29", l: "Churned", k: "rate", d: 0.05 },
    { s: "Loyal MVM", id: "r30", l: "Demoted", k: "rate", d: 0.3043 },
    { s: "Loyal MVM", id: "r31", l: "Demoted to potential loyal MVM", k: "count", d: 2, sub: 1 },
    { s: "Loyal MVM", id: "r32", l: "Demoted to LVM", k: "count", d: 2, sub: 1 },
    { s: "Loyal MVM", id: "r36", l: "Re-activated", k: "rate", d: 0.05 },
    { s: "Loyal MVM", id: "r37", l: "New", k: "rate", d: 0.15 },
    { s: "Loyal MVM", id: "r38", l: "Promoted", k: "rate", d: 0.2 },
    { s: "Loyal MVM", id: "r39", l: "Promoted from potential loyal MVM", k: "count", d: 1, sub: 1 },
    { s: "Loyal MVM", id: "r40", l: "Promoted from LVM", k: "count", d: 0, sub: 1 },
    { s: "Loyal MVM", id: "r44", l: "Confirmed orders per merchant", k: "num", d: 615 },
    { s: "Loyal MVM", id: "r48", l: "DR%", k: "pct", d: 0.5 },
    { s: "Loyal MVM", id: "r50", l: "Delivered AOV", k: "money", d: 830 },

    { s: "Potential Loyal MVM", id: "r54", l: "Churned", k: "rate", d: 0.05 },
    { s: "Potential Loyal MVM", id: "r55", l: "Demoted", k: "rate", d: 0.3 },
    { s: "Potential Loyal MVM", id: "r57", l: "Promoted to Champions", k: "count", d: 0, sub: 1 },
    { s: "Potential Loyal MVM", id: "r58", l: "Promoted to Loyal MVM", k: "count", d: 6, sub: 1 },
    { s: "Potential Loyal MVM", id: "r63", l: "Re-activated", k: "rate", d: 0.2 },
    { s: "Potential Loyal MVM", id: "r64", l: "New", k: "rate", d: 0.2 },
    { s: "Potential Loyal MVM", id: "r65", l: "Promoted", k: "rate", d: 0.15 },
    { s: "Potential Loyal MVM", id: "r69", l: "Confirmed orders per merchant", k: "num", d: 203.1538 },
    { s: "Potential Loyal MVM", id: "r73", l: "DR%", k: "pct", d: 0.45 },
    { s: "Potential Loyal MVM", id: "r75", l: "Delivered AOV", k: "money", d: 1036 },

    { s: "LVM", id: "r82", l: "Churned", k: "count", d: 227 },
    { s: "LVM", id: "r84", l: "Retained · Low value", k: "count", d: 55, sub: 1 },
    { s: "LVM", id: "r85", l: "Retained · Occasional", k: "count", d: 22, sub: 1 },
    { s: "LVM", id: "r86", l: "Retained · Promising", k: "count", d: 10, sub: 1 },
    { s: "LVM", id: "r87", l: "Retained · Promoted", k: "count", d: 16, sub: 1 },
    { s: "LVM", id: "r88", l: "Retained · Demoted", k: "count", d: 41, sub: 1 },
    { s: "LVM", id: "r90", l: "Re-activated · Low value", k: "count", d: 99, sub: 1 },
    { s: "LVM", id: "r91", l: "Re-activated · Occasional", k: "count", d: 15, sub: 1 },
    { s: "LVM", id: "r92", l: "Re-activated · Promising", k: "count", d: 10, sub: 1 },
    { s: "LVM", id: "r94", l: "New · Low value", k: "count", d: 200, sub: 1 },
    { s: "LVM", id: "r95", l: "New · Occasional", k: "count", d: 20, sub: 1 },
    { s: "LVM", id: "r96", l: "New · Promising", k: "count", d: 7, sub: 1 },
    { s: "LVM", id: "r98", l: "Total merchants · Low value", k: "count", d: 343, sub: 1 },
    { s: "LVM", id: "r99", l: "Total merchants · Occasional", k: "count", d: 61, sub: 1 },
    { s: "LVM", id: "r100", l: "Total merchants · Promising", k: "count", d: 20, sub: 1 },
    { s: "LVM", id: "r103", l: "Confirmed orders per merchant", k: "num", d: 10 },
    { s: "LVM", id: "r107", l: "DR%", k: "pct", d: 0.48 }
  ];
  // what the dashboard calculates by itself (shown read-only in the editor)
  var SEG_AUTO = {
    "HVM (Champions)": [["Last month merchants", "actual Champions of last month"], ["Total merchants", "last month + re-activated + new + promoted − churned − demoted"], ["Total confirmed orders", "total merchants × orders per merchant"], ["Confirmed AOV", "last month's actual AOV"], ["Confirmed GMV", "orders × AOV"], ["Total delivered orders", "orders × DR%"], ["Delivered AOV", "confirmed AOV × 96%"], ["Delivered GMV", "delivered orders × delivered AOV"]],
    "Loyal MVM": [["Last month merchants", "actual Loyal of last month"], ["Promoted to Champions", "= Champions \"Promoted\""], ["Demoted from Champions", "= Champions \"Demoted\""], ["Retained", "last month − churned − demoted − promoted to Champions"], ["Total merchants", "last month + from Champions + re-activated + new + promoted − churned − demoted − promoted to Champions"], ["Confirmed AOV", "last month's actual AOV"], ["Orders · GMV · delivered", "same chain as Champions"]],
    "Potential Loyal MVM": [["Last month merchants", "actual Potential Loyal of last month"], ["Promoted to higher segments", "= Loyal \"Promoted\""], ["Demoted from higher segments", "= Loyal \"Demoted\""], ["Demoted from Champions / Loyal", "= Champions \"Demoted to potential loyal\" / Loyal \"Demoted to potential loyal\""], ["Retained", "last month − churned − demoted − promoted"], ["Total merchants", "last month + demoted from higher + re-activated + new + promoted − churned − demoted − promoted to higher"], ["Confirmed AOV", "last month's actual AOV"]],
    "LVM": [["Last month merchants (and split)", "actual LVM of last month"], ["Retained / Re-activated / New / Total", "sum of their splits"], ["Confirmed AOV · Delivered AOV", "last month's actual"], ["Orders · GMV · delivered", "total merchants × orders per merchant, then × AOV / × DR%"]],
    "Total": [["All totals", "sum of the four segments"]]
  };
  var SEG_DEF = {}; SEG_INPUTS.forEach(function (x) { SEG_DEF[x.id] = x.d; });

  function workerUrl() { try { return (typeof SYNC_CDN_URL !== "undefined" && SYNC_CDN_URL) || (window.TowerCore && window.TowerCore.workerUrl && window.TowerCore.workerUrl()) || ""; } catch (e) { return ""; } }
  function prevKey(key) { var p = key.split("-"), d = new Date(+p[0], +p[1] - 2, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function keyOf(date) { return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0"); }
  var cache = {}, inflight = {};
  function fetchOne(type, key) {
    var u = workerUrl(); if (!u) return Promise.resolve(null);
    return fetch(u + "?action=getTargets&type=" + type + "." + key, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.values && typeof j.values === "object" ? j : null; }).catch(function () { return null; });
  }
  // → { values, month (the month the plan was saved for), source: "month" | "previous" | "default", at, by }
  function get(type, key, force) {
    var ck = type + "." + key;
    if (!force && cache[ck]) return Promise.resolve(cache[ck]);
    if (!force && inflight[ck]) return inflight[ck];
    var DEF = type === "supplyplan" ? SUPPLY_DEF : SEG_DEF;
    inflight[ck] = fetchOne(type, key).then(function (p) {
      if (p) return { values: Object.assign({}, DEF, p.values), month: key, source: "month", at: p.at, by: p.by };
      var pk = prevKey(key);
      return fetchOne(type, pk).then(function (q) {
        if (q) return { values: Object.assign({}, DEF, q.values), month: pk, source: "previous", at: q.at, by: q.by };
        return { values: Object.assign({}, DEF), month: "", source: "default" };
      });
    }).then(function (res) { cache[ck] = res; delete inflight[ck]; return res; });
    return inflight[ck];
  }
  function peek(type, key) { return cache[type + "." + key] || null; }
  function forget(type, key) { delete cache[type + "." + key]; }
  function monthTitle(key) { if (!key) return ""; var p = key.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }); }
  function sourceText(res) {
    if (!res) return "Loading targets…";
    if (res.source === "month") return "Targets saved for " + monthTitle(res.month) + (res.by ? " by " + res.by : "");
    if (res.source === "previous") return "Nothing saved for this month — using the " + monthTitle(res.month) + " plan";
    return "Default plan — set this month's targets in Control → Targets";
  }
  window.TaagerPlans = { SUPPLY_FIELDS: SUPPLY_FIELDS, SUPPLY_DEF: SUPPLY_DEF, SEG_INPUTS: SEG_INPUTS, SEG_DEF: SEG_DEF, SEG_AUTO: SEG_AUTO,
    get: get, peek: peek, forget: forget, keyOf: keyOf, prevKey: prevKey, monthTitle: monthTitle, sourceText: sourceText };
})();
