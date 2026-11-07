/* Marketplace → Locking → SKU Lock Review / Merchant Lock Review (v1.18.0)
   The same review as the "SKU_Merchant_Lock_Review" sheet, built from the dashboard's own data for any date range:
     • SKUs        = the rows of Supply Chain → Inventory & Inbound for that range (SKUs that received inbound in it), with the
                     same columns and the same maths (Beginning Inventory, Inbound Qty, Confirmed Qty, Beginning Sales, Remaining from
                     Beginning, Confirmed From Purchase, Over Confirmed, Inbound vs Sold, Overachieve, Purchases Sold Out On).
     • Demand      = Main (Matches): every merchant with placed pieces on the SKU in the range, bundles split into their singles
                     (× quantity per bundle) like Allocation Locking. CR% = confirmed ÷ placed, DR% = delivered ÷ confirmed (plain, no cut-off,
                     like the sheet).
     • Lock fields = the locking tab Allocation Locking reads (state.availabilityLockingRows), matched on SKU ID + Merchant ID:
                     Locked = an active lock row (same rule as Availability Locking → Active Locks). ALLOCATED_QUANTITY 0 / blank means the
                     SKU is locked to the merchant with NO quantity cap (it can raise whatever it needs) · Unlocked = the row is there but the
                     lock expired / was cancelled · Not in lock list = no row for that merchant on that SKU (not locked to it at all).
     • Merchant status = the Matches / Single rule, taken at the start of the range: Active = the merchant had any activity on this single in
                     the month before the range starts (Main, else that month from the history tab), else New. "—" while that month is not loaded.
   Merchant Lock Review = the sheet's "Merchant Breakdown": merchants ranked by placed pieces (ties: confirmed); locked merchants with no
   demand in the range are listed after them with no rank. SKU Lock Review = the sheet's "SKU Summary", one row per SKU with the review
   flag. CHECK and REVIEW FLAG follow the sheet's Notes word for word. */
(function () {
  "use strict";
  var C = null, PAGE = 50, DAY = 86400000;
  function $(id) { return document.getElementById(id); }
  function st() { try { return state; } catch (e) { return {}; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v) { return v == null || !isFinite(v) ? "—" : Math.round(+v).toLocaleString("en-US"); }
  function pct(v) { return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%"; }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function day0(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function g(name) { return typeof window[name] === "function" ? window[name] : null; }

  // default range = 1st of last month → today (Main covers last month + this month), same span as the sheet (Oct 1 – Nov 5)
  var now0 = new Date(); now0.setHours(0, 0, 0, 0);
  var LR = { from: ymd(new Date(now0.getFullYear(), now0.getMonth() - 1, 1)), to: ymd(now0), sig: "", data: null,
    sku: { q: "", cat: "all", flag: "all", sort: "doh", dir: -1, page: 0 },
    mer: { q: "", cat: "all", acm: "all", lock: "all", check: "all", sku: "", stockCols: true, page: 0 } };
  try { var sv = JSON.parse(localStorage.getItem("lockReviewRange") || "null"); if (sv && sv.from && sv.to) { LR.from = sv.from; LR.to = sv.to; } } catch (e) {}
  function saveRange() { try { localStorage.setItem("lockReviewRange", JSON.stringify({ from: LR.from, to: LR.to })); } catch (e) {} }

  var CHECK = { ok: "OK – locked with remaining qty", used: "Locked – allocation fully used", zero: "Locked – 0 allocated qty",
    noDemand: "Locked – no demand in period", removed: "Placed demand – lock removed (Unlocked)", notIn: "Placed demand – NOT in lock list",
    open: "SKU open on the website – not locked" };
  var OPEN = "Open – SKU not locked";

  function H() { try { return hist; } catch (e) { return null; } }
  function srcRefs() { var s = st(), h = H(); return [s.allParsedRows, s.availabilityLockingRows, s.weeklyInventoryRows, s.inboundRows, s.debundleMap, s.weeklyInvBySku, s.confirmedByDayRows, h ? h.rows.size : 0]; }
  // rows of the month before the range: Main if it has them, else the history tab (loaded on demand); null = not available (yet)
  function prevMonthRows(startTs) {
    var d = new Date(startTs), pm = new Date(d.getFullYear(), d.getMonth() - 1, 1), label = pm.toLocaleString("en-US", { month: "long", year: "numeric" });
    var main = (st().allParsedRows || []).filter(function (r) { return r.monthYear === label; });
    if (main.length) return { label: label, rows: main };
    var h = H(); if (!h) return null;
    if (h.rows.has(label)) return { label: label, rows: h.rows.get(label) };
    if (!h.inited && typeof window.histInit === "function") window.histInit();
    if ((h.months || []).indexOf(label) >= 0 && typeof window.histLoadMonth === "function") window.histLoadMonth(label);
    return null;
  }

  // ------------------------------------------------------------------ build
  function build() {
    var s = st();
    if (!(s.allParsedRows || []).length || !(s.weeklyInventoryRows || []).length) return null;
    if (!(s.weeklyInvBySku && s.weeklyInvBySku.size)) { var prep = g("prepareWeeklyInventoryWeeks"); if (prep) prep(); }
    if (!(s.weeklyInvBySku && s.weeklyInvBySku.size)) return null;
    var startTs = new Date(LR.from + "T00:00:00").getTime(), endTs = new Date(LR.to + "T23:59:59").getTime();
    if (!isFinite(startTs) || !isFinite(endTs) || startTs > endTs) return { bad: true };
    var sig = [LR.from, LR.to].concat(srcRefs().map(function (x) { return x ? (x.length != null ? x.length : x.size) : 0; })).join("|");
    if (LR.data && LR.sig === sig && LR.refs && srcRefs().every(function (x, i) { return x === LR.refs[i]; })) return LR.data;

    var snap = g("wiSnapToDateCol"), stockAt = g("wiStockAtTs"), sumInb = g("wiSumInboundInRange"), sumConf = g("wiSumConfirmedInRange"), avail = g("wiGetAvailability"), isActive = g("alIsLockActive");
    var dm = g("buildDebundleProductMap")(s.debundleMap, s.cogsMap), pmap = dm.productMap;
    var mapsFor = function (sku) { var m = pmap.get(sku); return m && m.length ? m : [{ singleId: sku, quantity: 1 }]; };
    var todayMs = day0(Date.now()), ydayMs = todayMs - DAY;

    // 1) SKUs = Inventory & Inbound rows for the range (purchases and sales both counted over the range)
    var begTs = snap ? snap(startTs) : startTs, skus = [], bySku = new Map();
    s.weeklyInvBySku.forEach(function (inv) {
      var inb = sumInb(inv.sku, begTs, endTs); if (!(inb.qty > 0)) return;
      var meta = (s.weeklyInvSkuMetaMap || new Map()).get(inv.sku) || { category: "Uncategorized", stock: 0, doh: 0, cogs: 0 };
      var beginInv = stockAt(inv.sku, begTs), conf = sumConf(inv.sku, begTs, endTs);
      var bs = Math.min(conf, beginInv), rem = conf - bs, cfp = Math.min(rem, inb.qty), over = Math.max(0, rem - inb.qty);
      var r = { sku: inv.sku, name: inv.name || inv.sku, category: meta.category || "Uncategorized", availability: avail ? avail(inv.sku) : "", stock: meta.stock || 0, doh: meta.doh || 0, cogs: meta.cogs || 0,
        beginInv: beginInv, inboundQty: inb.qty, inboundDates: inb.dates, confirmedQty: conf, beginningSales: bs, remainingFromBeginning: rem, confirmedFromPurchase: cfp, overConfirmed: over,
        inboundVsSold: inb.qty > 0 ? cfp / inb.qty : null, overachieve: inb.qty > 0 ? over / inb.qty : null, purchasesLeft: inb.qty - cfp, placedYday: 0, isLocked: false, merchants: [] };
      skus.push(r); bySku.set(inv.sku, r);
    });

    // 2) demand per merchant x single in the range (debundled), placed yesterday per single, activity in the month before (status)
    var dem = new Map(), info = s.merchantInfoMap || new Map(), prev = prevMonthRows(startTs), prevAct = prev ? new Set() : null;
    if (prev) prev.rows.forEach(function (row) {
      if (!row.sku || !row.merchantId || !((row.placedPieces || 0) + (row.confirmedPieces || 0) + (row.deliveredPieces || 0) + (row.placedOrders || 0) > 0)) return;
      mapsFor(row.sku).forEach(function (mp) { if (bySku.has(mp.singleId)) prevAct.add(row.merchantId + "||" + mp.singleId); });
    });
    (s.allParsedRows || []).forEach(function (row) {
      if (!row.sku || !row.merchantId || !row.timestamp) return;
      var t = row.timestamp, inR = t >= startTs && t <= endTs, isY = day0(t) === ydayMs;
      if (!inR && !isY) return;
      mapsFor(row.sku).forEach(function (mp) {
        var S = bySku.get(mp.singleId); if (!S) return;
        var q = mp.quantity || 1, k = row.merchantId + "||" + mp.singleId;
        if (isY) S.placedYday += (row.placedPieces || 0) * q;
        if (!inR) return;
        var b = dem.get(k);
        if (!b) { b = { mid: row.merchantId, sku: mp.singleId, name: "", acm: "", placed: 0, confirmed: 0, delivered: 0 }; dem.set(k, b); }
        b.placed += (row.placedPieces || 0) * q; b.confirmed += (row.confirmedPieces || 0) * q; b.delivered += (row.deliveredPieces || 0) * q;
        if (row.merchantName) b.name = row.merchantName;
        if (row.acmName && row.acmName !== "Unassigned") b.acm = row.acmName;
      });
    });

    // 3) lock rows on these SKUs (SKU ID + Merchant ID)
    var locks = new Map();
    (s.availabilityLockingRows || []).forEach(function (l) {
      if (!l.singleId || !l.tagerId || !bySku.has(l.singleId)) return;
      var k = l.tagerId + "||" + l.singleId, x = locks.get(k);
      if (!x) { x = { locked: false, any: true, alloc: 0, used: 0, rem: 0, name: l.merchantName || "" }; locks.set(k, x); }
      // owner's rule: any active lock row = Locked; a blank / 0 ALLOCATED_QUANTITY = locked with no quantity cap
      if (!isActive || isActive(l, todayMs)) { x.locked = true; x.alloc += l.allocatedBlank ? 0 : (l.allocatedQty || 0); x.used += l.usedQty || 0; x.rem += l.remainingPieces || 0; }
      if (!x.name && l.merchantName) x.name = l.merchantName;
    });

    // 4) merchant rows per SKU
    var rowsOf = new Map();
    dem.forEach(function (b, k) { if (!(b.placed > 0)) return; var a = rowsOf.get(b.sku) || []; rowsOf.set(b.sku, a); a.push({ k: k, b: b }); });
    skus.forEach(function (S) {
      var a = (rowsOf.get(S.sku) || []).sort(function (x, y) { return (y.b.placed - x.b.placed) || (y.b.confirmed - x.b.confirmed); });
      var tot = a.reduce(function (t, x) { return t + x.b.placed; }, 0), cum = 0;
      // owner's rule: Is Locked? = No (no merchant has an active lock on this SKU) → the whole SKU is open on the website, so a merchant
      // without a lock row is not a problem: it can sell the SKU like everyone else.
      var skuLocked = false; locks.forEach(function (L, k) { if (L.locked && k.slice(k.indexOf("||") + 2) === S.sku) skuLocked = true; });
      a.forEach(function (x, i) {
        var b = x.b, L = locks.get(x.k), mi = info.get(b.mid) || {};
        var lock = L ? (L.locked ? "Locked" : "Unlocked") : (skuLocked ? "Not in lock list" : OPEN);
        cum += b.placed;
        var chk = !skuLocked ? CHECK.open : lock === "Not in lock list" ? CHECK.notIn : lock === "Unlocked" ? CHECK.removed : (L.rem > 0 ? CHECK.ok : (L.alloc > 0 ? CHECK.used : CHECK.zero));
        S.merchants.push({ rank: i + 1, mid: b.mid, merchant: b.name || mi.merchantName || (L && L.name) || b.mid, acm: b.acm || mi.acmName || "Unassigned", status: prevAct ? (prevAct.has(x.k) ? "Active" : "New") : "—",
          placed: b.placed, share: tot > 0 ? b.placed / tot : 0, cum: tot > 0 ? cum / tot : 0, confirmed: b.confirmed, delivered: b.delivered,
          cr: b.placed > 0 ? b.confirmed / b.placed : null, dr: b.confirmed > 0 ? b.delivered / b.confirmed : null,
          lock: lock, alloc: L && L.locked ? L.alloc : null, used: L && L.locked ? L.used : null, rem: L && L.locked ? L.rem : null, check: chk });
      });
      // locked merchants on this SKU with no demand in the range: after the ranked ones, no rank
      locks.forEach(function (L, k) {
        var sep = k.indexOf("||"); if (k.slice(sep + 2) !== S.sku || !L.locked) return;
        var b = dem.get(k); if (b && b.placed > 0) return;
        var mid = k.slice(0, sep), mi = info.get(mid) || {};
        S.merchants.push({ rank: null, mid: mid, merchant: L.name || mi.merchantName || mid, acm: "", status: "", placed: 0, share: 0, cum: null, confirmed: b ? b.confirmed : 0, delivered: b ? b.delivered : 0,
          cr: null, dr: null, lock: "Locked", alloc: L.alloc, used: L.used, rem: L.rem, check: CHECK.noDemand });
      });
      // summary (the sheet's SKU Summary)
      var M = S.merchants, dmd = M.filter(function (m) { return m.rank != null; }), top = dmd[0] || null;
      S.isLocked = skuLocked;
      S.withDemand = dmd.length; S.totPlaced = tot; S.totConfirmed = dmd.reduce(function (t, m) { return t + m.confirmed; }, 0);
      S.top = top ? top.merchant : ""; S.topPlaced = top ? top.placed : 0; S.topShare = top && tot > 0 ? top.placed / tot : 0; S.topLock = top ? top.lock : "";
      S.nLocked = M.filter(function (m) { return m.lock === "Locked"; }).length; S.nUnlocked = M.filter(function (m) { return m.lock === "Unlocked"; }).length;
      S.nNotIn = M.filter(function (m) { return m.lock === "Not in lock list"; }).length; S.nNoDemand = M.filter(function (m) { return m.check === CHECK.noDemand; }).length;
      S.totAlloc = M.reduce(function (t, m) { return t + (m.alloc || 0); }, 0); S.totUsed = M.reduce(function (t, m) { return t + (m.used || 0); }, 0); S.totRem = M.reduce(function (t, m) { return t + (m.rem || 0); }, 0);
      S.nOpen = M.filter(function (m) { return m.lock === OPEN; }).length;
      S.flag = !skuLocked ? "SKU open on the website (not locked)" : !top ? "No demand in period" : top.lock !== "Locked" ? "Top merchant not locked" : S.nNotIn > 0 ? S.nNotIn + " demand merchant(s) not in lock list" : "OK";
      S.flagKey = !skuLocked ? "open" : !top ? "nodemand" : top.lock !== "Locked" ? "top" : S.nNotIn > 0 ? "notin" : "ok";
    });
    LR.data = { skus: skus, startTs: startTs, endTs: endTs, begTs: begTs, prevLabel: prev ? prev.label : null };
    LR.sig = sig; LR.refs = srcRefs();
    return LR.data;
  }

  // ------------------------------------------------------------------ shared UI bits
  function rangeBar(id) {
    return '<div class="filter-group" title="Purchases and sales are both counted over this range (like Inventory & Inbound with a custom range). Demand comes from Matches, which covers last month and this month.">' +
      '<input id="' + id + 'From" type="date" class="date-filter-input" value="' + esc(LR.from) + '"><span class="text-dim" style="padding:0 4px">→</span><input id="' + id + 'To" type="date" class="date-filter-input" value="' + esc(LR.to) + '"></div>';
  }
  function wireRange(host, id, rerender) {
    var f = host.querySelector("#" + id + "From"), t = host.querySelector("#" + id + "To");
    var go = function () { if (f.value && t.value && f.value <= t.value) { LR.from = f.value; LR.to = t.value; LR.sku.page = 0; LR.mer.page = 0; saveRange(); rerender(); } };
    if (f) f.addEventListener("change", go); if (t) t.addEventListener("change", go);
  }
  function waiting(host, d, rerender) {
    if (d && !d.bad) return false;
    host.innerHTML = '<div class="panel" style="padding:18px"><div class="sc-note">' + (d && d.bad ? "Pick a valid date range (From before To)." : "Waiting for dashboard data (Matches, the locking tab and Inventory & Inbound). This page fills in by itself.") + '</div></div>';
    clearTimeout(LR.poll); LR.poll = setTimeout(function () { if (host.isConnected && !host.classList.contains("hidden")) rerender(); }, 1500);
    return true;
  }
  function watch(host, rerender) {
    LR.wrefs = srcRefs(); clearInterval(LR.watch);
    LR.watch = setInterval(function () {
      if (!host.isConnected || host.classList.contains("hidden")) { clearInterval(LR.watch); return; }
      var n = srcRefs(); if (n.some(function (x, i) { return x !== LR.wrefs[i]; })) rerender();
    }, 2000);
  }
  function rangeText(d) { var f = function (ts) { return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }; return f(d.startTs) + " – " + f(d.endTs); }
  function opts(list, cur, allLabel) { return '<option value="all">' + allLabel + '</option>' + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + '>' + esc(v) + '</option>'; }).join(""); }
  function uniq(a) { return Array.from(new Set(a.filter(Boolean))).sort(); }
  function soldOut(r) { return r.inboundQty > 0 && r.purchasesLeft <= 0 ? '<span class="badge-outline red">Sold out</span>' : '<span class="badge-outline orange">' + int(r.purchasesLeft) + ' left</span>'; }
  function lockBadge(l) { return !l ? "" : '<span class="badge-outline ' + (l === "Locked" ? "green" : l === "Unlocked" ? "orange" : l === OPEN ? "blue" : "red") + '">' + esc(l) + '</span>'; }
  function checkCls(c) { return c === CHECK.open ? "text-dim" : c === CHECK.ok ? "text-green" : (c === CHECK.notIn || c === CHECK.removed) ? "text-red" : "text-orange"; }
  function download(name, head, rows) {
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var blob = new Blob(["﻿" + [head.join(",")].concat(rows.map(function (r) { return r.map(q).join(","); })).join("\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function pager(id, page, pages, n) { return '<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:10px 18px"><button class="btn btn-outline small" id="' + id + 'Prev"' + (page ? "" : " disabled") + '>Prev</button><span class="text-dim" style="font-size:12.5px">Page ' + (page + 1) + ' of ' + pages + ' · ' + int(n) + ' rows</span><button class="btn btn-outline small" id="' + id + 'Next"' + (page < pages - 1 ? "" : " disabled") + '>Next</button></div>'; }
  function r3(v) { return v == null || !isFinite(v) ? "" : Math.round(v * 1000) / 1000; }

  // ------------------------------------------------------------------ SKU Lock Review (= SKU Summary)
  // what each column means (shown when you hover the column title)
  var TIP = {
    // SKU Lock Review
    "SKU ID": "The single SKU. Only SKUs that received inbound in the selected range are listed (same rows as Inventory & Inbound for that range).",
    "SKU Name": "Product name of the SKU.",
    "Category": "Category of the SKU (from the Inventory data).",
    "Current Stock": "Pieces on hand now (good stock), same as Inventory & Inbound.",
    "DOH": "Days on hand: current stock ÷ the SKU's average confirmed pieces per day (last 3 days), same as Inventory & Inbound.",
    "Is Locked?": "Yes = at least one merchant has an active lock on this SKU (locking tab). No = no active lock → the whole SKU is open on the website and any merchant can sell it.",
    "Merchants with Demand": "How many merchants placed at least one piece of this SKU in the range (bundles split into their singles).",
    "Total Placed": "Placed pieces of this SKU by all merchants in the range (bundles split into singles × quantity per bundle).",
    "Total Confirmed": "Confirmed pieces of this SKU by the merchants with demand in the range.",
    "Top Merchant": "The merchant with the most placed pieces of this SKU in the range (ties: more confirmed).",
    "Top Merchant Placed": "Placed pieces of the top merchant in the range.",
    "Top Merchant Share": "Top merchant's placed pieces ÷ Total Placed — how much of the SKU's demand one merchant holds.",
    "Top Merchant Lock Status": "Lock status of the top merchant on this SKU: Locked (incl. allocated 0 = no quantity cap), Unlocked (lock expired / cancelled) or Not in lock list.",
    "Locked Merchants": "Merchants with an active lock on this SKU (with or without demand in the range).",
    "Unlocked Merchants": "Merchants with demand whose lock row on this SKU is no longer active (the lock expired / was cancelled).",
    "Demand – Not in Lock List": "On a locked SKU: merchants that placed demand but have no lock row for it. 0 on an open SKU (it is open to everyone).",
    "Locked – No Demand": "Merchants locked on this SKU that placed nothing in the range — stock held for nobody selling it.",
    "Total Allocated": "Sum of ALLOCATED_QUANTITY of the active locks on this SKU.",
    "Total Used": "Sum of QUANTITY_USED of the active locks on this SKU.",
    "Total Remaining": "Sum of REMAINING_PIECES of the active locks on this SKU — pieces still held in locks.",
    "Review Flag": "Is Locked? = No → SKU open on the website (not locked). Locked SKUs, in this order: Top merchant not locked → N demand merchant(s) not in lock list → OK. No demand in period = locked SKU nobody placed in the range.",
    // Merchant Lock Review
    "Rank": "Position of the merchant on this SKU by placed pieces (1 = biggest buyer). Empty = locked merchant with no demand in the range.",
    "Merchant ID": "TAGER ID of the merchant.",
    "Merchant": "Merchant name.",
    "ACM": "Account manager of the merchant (from Matches).",
    "Merchant Status": "Matches / Single rule at the start of the range: Active = the merchant sold this SKU in the month before the range, New = it did not. — = that month is not loaded yet.",
    "Placed Pcs": "Placed pieces of this SKU by this merchant in the range (bundles split into singles × quantity).",
    "Share of SKU Placed": "This merchant's placed pieces ÷ all placed pieces of the SKU in the range.",
    "Cumulative Share": "Running total of the share from rank 1 down to this merchant — e.g. 80% = this merchant and the ones above it hold 80% of the demand.",
    "Confirmed Pcs": "Confirmed pieces of this SKU by this merchant in the range.",
    "Delivered Pcs": "Delivered pieces of this SKU by this merchant in the range.",
    "CR%": "Confirmation rate = Confirmed Pcs ÷ Placed Pcs (whole range, no cut-off days).",
    "DR%": "Delivery rate = Delivered Pcs ÷ Confirmed Pcs (whole range, no cut-off days).",
    "Lock Status": "Locked = active lock row (same as Active Locks); allocated 0 = locked with no quantity cap, the merchant can raise what it needs · Unlocked = the lock row expired / was cancelled · Not in lock list = the SKU is locked to other merchants but not to this one · Open – SKU not locked = nobody is locked on this SKU, it is open on the website.",
    "Allocated Qty": "ALLOCATED_QUANTITY of the merchant's active lock. 0 = locked with no quantity cap. Empty = not locked.",
    "Used Qty": "QUANTITY_USED of the merchant's active lock — pieces already taken from it.",
    "Remaining Pieces": "REMAINING_PIECES of the merchant's active lock — pieces still held for this merchant.",
    "Check": "Locked & remaining > 0 → OK · Locked & allocated > 0 & remaining ≤ 0 → allocation fully used · Locked & allocated = 0 → 0 allocated qty (locked with no quantity cap) · Locked & no demand → no demand in period · Unlocked with demand → lock removed · no lock row → NOT in lock list · SKU not locked at all (Is Locked? = No) → SKU open on the website.",
    "Availability": "Availability of the SKU (same as Inventory & Inbound).",
    "Placed Yesterday": "Placed pieces of this SKU yesterday by all merchants (bundles split into singles).",
    "Cogs": "Cost of one piece.",
    "Beginning Inventory": "Stock of the SKU on the first day of the range (Inventory & Inbound).",
    "Inbound Qty": "Pieces received (inbound) in the range.",
    "Inbound Date": "The days the inbound arrived in the range.",
    "Confirmed Qty": "Confirmed pieces of the SKU in the range, all merchants (Inventory & Inbound).",
    "Beginning Sales": "Pieces sold from the beginning stock = lower of Confirmed Qty and Beginning Inventory.",
    "Remaining from Beginning": "Confirmed Qty − Beginning Sales — what was sold after the beginning stock ran out.",
    "Confirmed From Purchase": "Pieces sold from the new purchase = lower of Remaining from Beginning and Inbound Qty.",
    "Over Confirmed": "Confirmed beyond the beginning stock + the purchase = Remaining from Beginning − Inbound Qty (when above 0).",
    "Inbound vs Sold": "Confirmed From Purchase ÷ Inbound Qty — how much of the purchase is sold (100% = all of it).",
    "Overachieve": "Over Confirmed ÷ Inbound Qty — how far sales went past the purchase.",
    "Purchases Sold Out On": "Sold out = the whole purchase is sold · otherwise the pieces of the purchase still not sold."
  };
  function tipAttr(name) { var t = TIP[name]; return t ? ' title="' + esc(t) + '"' : ""; }
  var FLAGS = [["all", "All review flags"], ["top", "Top merchant not locked"], ["notin", "Demand merchants not in lock list"], ["ok", "OK"], ["open", "SKU open on the website (not locked)"], ["nodemand", "No demand in period"]];
  function skuRows(d) {
    var F = LR.sku, q = F.q.trim().toLowerCase();
    var rows = d.skus.filter(function (r) { return (F.cat === "all" || r.category === F.cat) && (F.flag === "all" || r.flagKey === F.flag) && (!q || r.sku.toLowerCase().indexOf(q) >= 0 || String(r.name).toLowerCase().indexOf(q) >= 0); });
    var k = F.sort, dir = F.dir;
    return rows.sort(function (a, b) { var x = a[k], y = b[k]; if (typeof x === "string" || typeof y === "string") return dir * String(x || "").localeCompare(String(y || "")); return dir * ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)); });
  }
  var SKU_COLS = [["sku", "SKU ID"], ["name", "SKU Name"], ["category", "Category"], ["stock", "Current Stock", 1], ["doh", "DOH", 1], ["isLocked", "Is Locked?"], ["withDemand", "Merchants with Demand", 1], ["totPlaced", "Total Placed", 1], ["totConfirmed", "Total Confirmed", 1],
    ["top", "Top Merchant"], ["topPlaced", "Top Merchant Placed", 1], ["topShare", "Top Merchant Share", 1], ["topLock", "Top Merchant Lock Status"], ["nLocked", "Locked Merchants", 1], ["nUnlocked", "Unlocked Merchants", 1], ["nNotIn", "Demand – Not in Lock List", 1],
    ["nNoDemand", "Locked – No Demand", 1], ["totAlloc", "Total Allocated", 1], ["totUsed", "Total Used", 1], ["totRem", "Total Remaining", 1], ["flag", "Review Flag"]];
  function renderSku(host) {
    var rerender = function () { renderSku(host); };
    var d = build(); if (waiting(host, d, rerender)) return; watch(host, rerender);
    var F = LR.sku, rows = skuRows(d), pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (F.page > pages - 1) F.page = pages - 1;
    var cnt = function (k) { return d.skus.filter(function (r) { return r.flagKey === k; }).length; };
    var tiles = [["SKUs reviewed", int(d.skus.length), "received inbound in " + rangeText(d)], ["Top merchant not locked", int(cnt("top")), "the biggest buyer of the SKU has no active lock"],
      ["Demand merchants not in lock list", int(cnt("notin")), "SKUs where merchants placed demand with no lock row"], ["OK", int(cnt("ok")), "top merchant locked, every demand merchant in the lock list"], ["Open on the website", int(cnt("open")), "Is Locked? = No — no active lock, any merchant can sell it"], ["No demand", int(cnt("nodemand")), "locked SKU, nobody placed it in the range"]];
    var th = function (c) { return '<th class="' + (c[2] ? "num " : "") + '" style="cursor:pointer;white-space:nowrap" data-lrs="' + c[0] + '"' + tipAttr(c[1]) + '>' + c[1] + (F.sort === c[0] ? (F.dir < 0 ? " ↓" : " ↑") : "") + '</th>'; };
    var html = '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>SKU Lock Review</h2>' +
      '<p>One row per SKU that received inbound in the range: its stock, who placed demand on it, and whether those merchants are locked. Click a SKU to open its merchants in Merchant Lock Review.</p></div>' +
      '<div class="table-controls">' + rangeBar("lrs") + '</div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' +
      '<div class="sc-note" style="margin:0 18px 14px">Is Locked? = <b>No</b> means no merchant has an active lock on the SKU, so the whole SKU is open on the website → Review Flag <b>SKU open on the website</b>. For locked SKUs, in this order: <b>Top merchant not locked</b> → <b>N demand merchant(s) not in lock list</b> → <b>OK</b>. Top merchant = the one with the most placed pieces in the range (bundles split into singles).</div></div>';
    html += '<div class="panel table-panel hover-glow"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>SKUs</h2><p>' + esc(rangeText(d)) + '</p></div><div class="table-controls" style="gap:8px;flex-wrap:wrap">' +
      '<input id="lrsQ" type="search" class="date-filter-input" style="min-width:200px" placeholder="Search SKU ID or name" value="' + esc(F.q) + '">' +
      '<select id="lrsCat" class="date-filter-input">' + opts(uniq(d.skus.map(function (r) { return r.category; })), F.cat, "All categories") + '</select>' +
      '<select id="lrsFlag" class="date-filter-input">' + FLAGS.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === F.flag ? " selected" : "") + '>' + f[1] + '</option>'; }).join("") + '</select>' +
      '<button class="btn btn-outline small tw-exp" data-csv="own" id="lrsCsv">Export CSV</button></div></div>' +
      '<div class="table-responsive"><table class="data-table" id="lrsTable"><thead><tr>' + SKU_COLS.map(th).join("") + '</tr></thead><tbody>' +
      (rows.slice(F.page * PAGE, F.page * PAGE + PAGE).map(function (r) {
        return '<tr><td class="font-mono"><a href="#" data-lrsku="' + esc(r.sku) + '" style="color:var(--accent);text-decoration:none">' + esc(r.sku) + '</a></td><td>' + esc(r.name) + '</td><td>' + esc(r.category) + '</td><td class="num">' + int(r.stock) + '</td><td class="num">' + int(r.doh) + '</td>' +
          '<td>' + (r.isLocked ? "Yes" : "No") + '</td><td class="num">' + int(r.withDemand) + '</td><td class="num">' + int(r.totPlaced) + '</td><td class="num">' + int(r.totConfirmed) + '</td><td>' + esc(r.top || "—") + '</td>' +
          '<td class="num">' + int(r.topPlaced) + '</td><td class="num">' + pct(r.topShare) + '</td><td>' + lockBadge(r.topLock) + '</td><td class="num">' + int(r.nLocked) + '</td><td class="num">' + int(r.nUnlocked) + '</td>' +
          '<td class="num' + (r.nNotIn ? " text-red" : "") + '">' + int(r.nNotIn) + '</td><td class="num">' + int(r.nNoDemand) + '</td><td class="num">' + int(r.totAlloc) + '</td><td class="num">' + int(r.totUsed) + '</td><td class="num">' + int(r.totRem) + '</td>' +
          '<td><b class="' + (r.flagKey === "ok" ? "text-green" : (r.flagKey === "nodemand" || r.flagKey === "open") ? "text-dim" : r.flagKey === "top" ? "text-red" : "text-orange") + '">' + esc(r.flag) + '</b></td></tr>';
      }).join("") || '<tr><td colspan="21" class="text-dim" style="text-align:center;padding:18px">No SKU matches these filters.</td></tr>') + '</tbody></table></div>' + pager("lrs", F.page, pages, rows.length) + '</div>';
    host.innerHTML = html;
    wireRange(host, "lrs", rerender);
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("lrsQ", "input", function (e) { F.q = e.target.value; F.page = 0; rerender(); var el = host.querySelector("#lrsQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    on("lrsCat", "change", function (e) { F.cat = e.target.value; F.page = 0; rerender(); });
    on("lrsFlag", "change", function (e) { F.flag = e.target.value; F.page = 0; rerender(); });
    on("lrsPrev", "click", function () { F.page--; rerender(); }); on("lrsNext", "click", function () { F.page++; rerender(); });
    host.querySelectorAll("[data-lrs]").forEach(function (t) { t.addEventListener("click", function () { var k = t.dataset.lrs; if (F.sort === k) F.dir = -F.dir; else { F.sort = k; F.dir = (k === "sku" || k === "name" || k === "category") ? 1 : -1; } rerender(); }); });
    host.querySelectorAll("[data-lrsku]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); LR.mer.sku = a.dataset.lrsku; LR.mer.page = 0; window.switchView("merchantLockReview"); }); });
    on("lrsCsv", "click", function () {
      download("sku-lock-review_" + LR.from + "_" + LR.to + ".csv", SKU_COLS.map(function (c) { return c[1]; }), rows.map(function (r) {
        return [r.sku, r.name, r.category, Math.round(r.stock), Math.round(r.doh), r.isLocked ? "Yes" : "No", r.withDemand, Math.round(r.totPlaced), Math.round(r.totConfirmed), r.top, Math.round(r.topPlaced), r3(r.topShare), r.topLock, r.nLocked, r.nUnlocked, r.nNotIn, r.nNoDemand, Math.round(r.totAlloc), Math.round(r.totUsed), Math.round(r.totRem), r.flag];
      }));
    });
  }

  // ------------------------------------------------------------------ Merchant Lock Review (= Merchant Breakdown)
  var MER_COLS = ["SKU ID", "SKU Name", "Category", "Rank", "Merchant ID", "Merchant", "ACM", "Merchant Status", "Placed Pcs", "Share of SKU Placed", "Cumulative Share", "Confirmed Pcs", "Delivered Pcs", "CR%", "DR%", "Lock Status", "Allocated Qty", "Used Qty", "Remaining Pieces", "Check"];
  var STOCK_COLS = ["Availability", "Is Locked?", "Placed Yesterday", "Current Stock", "DOH", "Cogs", "Beginning Inventory", "Inbound Qty", "Inbound Date", "Confirmed Qty", "Beginning Sales", "Remaining from Beginning", "Confirmed From Purchase", "Over Confirmed", "Inbound vs Sold", "Overachieve", "Purchases Sold Out On"];
  var LOCKS = ["Locked", "Unlocked", "Not in lock list", "Open – SKU not locked"];
  var NUM_HEAD = ["Rank", "Placed Pcs", "Share of SKU Placed", "Cumulative Share", "Confirmed Pcs", "Delivered Pcs", "CR%", "DR%", "Allocated Qty", "Used Qty", "Remaining Pieces", "Placed Yesterday", "Current Stock", "DOH", "Cogs",
    "Beginning Inventory", "Inbound Qty", "Confirmed Qty", "Beginning Sales", "Remaining from Beginning", "Confirmed From Purchase", "Over Confirmed", "Inbound vs Sold", "Overachieve"];
  function merRows(d) {
    var F = LR.mer, q = F.q.trim().toLowerCase(), out = [];
    d.skus.forEach(function (S) {
      if (F.sku && S.sku !== F.sku) return;
      if (F.cat !== "all" && S.category !== F.cat) return;
      S.merchants.forEach(function (m) {
        if (F.acm !== "all" && m.acm !== F.acm) return;
        if (F.lock !== "all" && m.lock !== F.lock) return;
        if (F.check !== "all" && m.check !== F.check) return;
        if (q && S.sku.toLowerCase().indexOf(q) < 0 && String(S.name).toLowerCase().indexOf(q) < 0 && String(m.merchant).toLowerCase().indexOf(q) < 0 && String(m.mid).indexOf(q) < 0) return;
        out.push({ S: S, m: m });
      });
    });
    return out;
  }
  function renderMer(host) {
    var rerender = function () { renderMer(host); };
    var d = build(); if (waiting(host, d, rerender)) return; watch(host, rerender);
    var F = LR.mer, rows = merRows(d), pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (F.page > pages - 1) F.page = pages - 1;
    var all = []; d.skus.forEach(function (S) { S.merchants.forEach(function (m) { all.push(m); }); });
    var cc = function (c) { return all.filter(function (m) { return m.check === c; }).length; };
    var tiles = [["Merchant rows", int(all.length), "merchants with demand + locked merchants with none"], ["Not in lock list", int(cc(CHECK.notIn)), "placed demand, no lock row for that SKU"], ["Lock removed", int(cc(CHECK.removed)), "placed demand, its lock expired / was cancelled"],
      ["SKU open", int(cc(CHECK.open)), "demand on SKUs nobody is locked on — open on the website"], ["Locked – 0 allocated", int(cc(CHECK.zero)), "locked with no quantity cap / nothing left"], ["Locked – no demand", int(cc(CHECK.noDemand)), "locked but placed nothing in the range"], ["OK", int(cc(CHECK.ok)), "locked with remaining qty"]];
    var html = '<div class="panel table-panel hover-glow" style="margin-bottom:14px"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Merchant Lock Review</h2>' +
      '<p>Every merchant who placed demand on each reviewed SKU, ranked by placed pieces (ties: confirmed), with its lock. Locked merchants with no demand in the range are listed after them with no rank.</p></div>' +
      '<div class="table-controls">' + rangeBar("lrm") + '</div></div>' +
      '<div class="cx-hero2" style="padding:0 18px 14px">' + tiles.map(function (t) { return '<div class="cx-tile"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join("") + '</div>' +
      '<div class="sc-note" style="margin:0 18px 14px">Check: Locked &amp; remaining &gt; 0 → OK · Locked &amp; allocated &gt; 0 &amp; remaining ≤ 0 → allocation fully used · Locked &amp; allocated = 0 → 0 allocated qty · Unlocked with demand → lock removed · no lock row → NOT in lock list · SKU not locked at all → SKU open on the website. ' +
      'Locked = an active lock row, same as Active Locks — allocated 0 means the SKU is locked to the merchant with no quantity cap. Unlocked = the lock expired / was cancelled. Lock fields come from the locking tab (Single rows), matched on SKU ID + Merchant ID. The stock &amp; inbound columns are the SKU\'s Inventory &amp; Inbound numbers for the range (the same on every merchant of that SKU).</div></div>';
    var checks = Object.keys(CHECK).map(function (k) { return CHECK[k]; });
    html += '<div class="panel table-panel hover-glow"><div class="panel-head-modern"><div class="panel-title-wrapper border-blue"><h2>Merchants' + (F.sku ? ' · ' + esc(F.sku) : '') + '</h2><p>' + esc(rangeText(d)) + (F.sku ? ' · <a href="#" id="lrmAll" style="color:var(--accent)">show all SKUs</a>' : '') + '</p></div><div class="table-controls" style="gap:8px;flex-wrap:wrap">' +
      '<input id="lrmQ" type="search" class="date-filter-input" style="min-width:200px" placeholder="Search SKU, merchant name or ID" value="' + esc(F.q) + '">' +
      '<select id="lrmCat" class="date-filter-input">' + opts(uniq(d.skus.map(function (r) { return r.category; })), F.cat, "All categories") + '</select>' +
      '<select id="lrmAcm" class="date-filter-input">' + opts(uniq(all.map(function (m) { return m.acm; })), F.acm, "All ACMs") + '</select>' +
      '<select id="lrmLock" class="date-filter-input">' + opts(LOCKS, F.lock, "All lock statuses") + '</select>' +
      '<select id="lrmCheck" class="date-filter-input">' + opts(checks, F.check, "All checks") + '</select>' +
      '<button class="btn btn-outline small" id="lrmStock">' + (F.stockCols ? "Hide" : "Show") + ' stock &amp; inbound columns</button>' +
      '<button class="btn btn-outline small tw-exp" data-csv="own" id="lrmCsv">Export CSV</button></div></div>' +
      '<div class="table-responsive"><table class="data-table" id="lrmTable"><thead><tr>' + MER_COLS.concat(F.stockCols ? STOCK_COLS : []).map(function (c) { return '<th class="' + (NUM_HEAD.indexOf(c) >= 0 ? "num" : "") + '" style="white-space:nowrap;cursor:help"' + tipAttr(c) + '>' + c + '</th>'; }).join("") + '</tr></thead><tbody>' +
      (rows.slice(F.page * PAGE, F.page * PAGE + PAGE).map(function (x) {
        var S = x.S, m = x.m;
        var h = '<tr><td class="font-mono">' + esc(S.sku) + '</td><td>' + esc(S.name) + '</td><td>' + esc(S.category) + '</td><td class="num">' + (m.rank == null ? "" : m.rank) + '</td><td class="font-mono">' + esc(m.mid) + '</td><td>' + esc(m.merchant) + '</td><td>' + esc(m.acm) + '</td>' +
          '<td>' + (m.status === "Active" || m.status === "New" ? '<span class="badge-outline ' + (m.status === "New" ? "blue" : "green") + '">' + m.status + '</span>' : esc(m.status || "")) + '</td><td class="num">' + int(m.placed) + '</td><td class="num">' + pct(m.share) + '</td><td class="num">' + (m.cum == null ? "" : pct(m.cum)) + '</td>' +
          '<td class="num">' + int(m.confirmed) + '</td><td class="num">' + int(m.delivered) + '</td><td class="num">' + pct(m.cr) + '</td><td class="num">' + pct(m.dr) + '</td><td>' + lockBadge(m.lock) + '</td>' +
          '<td class="num">' + (m.alloc == null ? "" : int(m.alloc)) + '</td><td class="num">' + (m.used == null ? "" : int(m.used)) + '</td><td class="num">' + (m.rem == null ? "" : int(m.rem)) + '</td><td><b class="' + checkCls(m.check) + '">' + esc(m.check) + '</b></td>';
        if (F.stockCols) h += '<td>' + esc(S.availability) + '</td><td>' + (S.isLocked ? "Yes" : "No") + '</td><td class="num">' + int(S.placedYday) + '</td><td class="num">' + int(S.stock) + '</td><td class="num">' + int(S.doh) + '</td><td class="num">' + int(S.cogs) + '</td>' +
          '<td class="num">' + int(S.beginInv) + '</td><td class="num">' + int(S.inboundQty) + '</td><td style="white-space:nowrap">' + esc((S.inboundDates || []).join(", ")) + '</td><td class="num">' + int(S.confirmedQty) + '</td><td class="num">' + int(S.beginningSales) + '</td>' +
          '<td class="num">' + int(S.remainingFromBeginning) + '</td><td class="num">' + int(S.confirmedFromPurchase) + '</td><td class="num">' + int(S.overConfirmed) + '</td><td class="num">' + pct(S.inboundVsSold) + '</td><td class="num">' + pct(S.overachieve) + '</td><td>' + soldOut(S) + '</td>';
        return h + '</tr>';
      }).join("") || '<tr><td colspan="37" class="text-dim" style="text-align:center;padding:18px">No merchant matches these filters.</td></tr>') + '</tbody></table></div>' + pager("lrm", F.page, pages, rows.length) + '</div>';
    host.innerHTML = html;
    wireRange(host, "lrm", rerender);
    var on = function (id, ev, fn) { var el = host.querySelector("#" + id); if (el) el.addEventListener(ev, fn); };
    on("lrmQ", "input", function (e) { F.q = e.target.value; F.page = 0; rerender(); var el = host.querySelector("#lrmQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    on("lrmCat", "change", function (e) { F.cat = e.target.value; F.page = 0; rerender(); });
    on("lrmAcm", "change", function (e) { F.acm = e.target.value; F.page = 0; rerender(); });
    on("lrmLock", "change", function (e) { F.lock = e.target.value; F.page = 0; rerender(); });
    on("lrmCheck", "change", function (e) { F.check = e.target.value; F.page = 0; rerender(); });
    on("lrmStock", "click", function () { F.stockCols = !F.stockCols; rerender(); });
    on("lrmAll", "click", function (e) { e.preventDefault(); F.sku = ""; F.page = 0; rerender(); });
    on("lrmPrev", "click", function () { F.page--; rerender(); }); on("lrmNext", "click", function () { F.page++; rerender(); });
    on("lrmCsv", "click", function () {
      download("merchant-lock-review_" + LR.from + "_" + LR.to + ".csv", MER_COLS.concat(STOCK_COLS), rows.map(function (x) {
        var S = x.S, m = x.m;
        return [S.sku, S.name, S.category, m.rank == null ? "" : m.rank, m.mid, m.merchant, m.acm, m.status, Math.round(m.placed), r3(m.share), m.cum == null ? "" : r3(m.cum), Math.round(m.confirmed), Math.round(m.delivered), r3(m.cr), r3(m.dr), m.lock,
          m.alloc == null ? "" : Math.round(m.alloc), m.used == null ? "" : Math.round(m.used), m.rem == null ? "" : Math.round(m.rem), m.check,
          S.availability, S.isLocked ? "Yes" : "No", Math.round(S.placedYday), Math.round(S.stock), Math.round(S.doh), Math.round(S.cogs), Math.round(S.beginInv), Math.round(S.inboundQty), (S.inboundDates || []).join(", "), Math.round(S.confirmedQty),
          Math.round(S.beginningSales), Math.round(S.remainingFromBeginning), Math.round(S.confirmedFromPurchase), Math.round(S.overConfirmed), r3(S.inboundVsSold), r3(S.overachieve), S.purchasesLeft <= 0 ? "Sold out" : Math.round(S.purchasesLeft)];
      }));
    });
  }

  window.TaagerLockReview = { build: function () { LR.data = null; LR.sig = ""; return build(); }, state: LR, CHECK: CHECK };

  function boot() {
    C = window.TowerCore; if (!C || !C.registerView) { setTimeout(boot, 300); return; }
    C.registerView("skuLockReview", { sectionId: "viewSkuLockReview", navId: "navSkuLockReview", label: "SKU Lock Review", sub: "Per SKU: who has demand and whether they are locked", open: true, render: renderSku });
    C.registerView("merchantLockReview", { sectionId: "viewMerchantLockReview", navId: "navMerchantLockReview", label: "Merchant Lock Review", sub: "Per merchant and SKU: demand, lock and what to check", open: true, render: renderMer });
    [["navSkuLockReview", "skuLockReview"], ["navMerchantLockReview", "merchantLockReview"]].forEach(function (p) { var nav = $(p[0]); if (nav && !nav.dataset.lr) { nav.dataset.lr = "1"; nav.addEventListener("click", function () { window.switchView(p[1]); }); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 160); }); else setTimeout(boot, 160);
})();
