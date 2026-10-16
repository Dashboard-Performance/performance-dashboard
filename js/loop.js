/* Taager Command Loop (v1.17.0) — My Tasks (everyone), task strip on top of every section,
   and Command Loop control (Admin / Country Manager only: every number, every task).
   Needs tower.js (window.TowerCore). Server side: cloudflare-worker/loop.js + loop-api.js. */
(function () {
  "use strict";
  var C = null, ME = null, CACHE = {}, STRIP_TTL = 60000;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return C.esc(s); }
  function fmtN(n) { return Math.round(n || 0).toLocaleString("en-US"); }
  function fmtEgp(n) { n = n || 0; var a = Math.abs(n); return "EGP " + (a >= 1e6 ? (n / 1e6).toFixed(2) + "M" : a >= 1e3 ? (n / 1e3).toFixed(1) + "K" : Math.round(n)); }
  function ago(iso) { if (!iso) return ""; var m = Math.round((Date.now() - Date.parse(iso)) / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; var h = Math.round(m / 60); if (h < 48) return h + "h ago"; return Math.round(h / 24) + "d ago"; }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""; }
  function api(action, body, params, timeout) {
    return C.wfetch(action, body === undefined ? { timeout: timeout || 20000 } : { timeout: timeout || 20000, body: JSON.stringify(body) }, params || "").then(function (j) {
      if (j && j.success === false) { var e = new Error(j.message || "Failed"); throw e; } return j;
    });
  }
  function navLabel(id) { var el = $(id); return el ? el.textContent.replace(/[▼▲]/g, "").trim() : id; }
  var STATUS = { open: ["Open", "warn"], in_progress: ["In progress", ""], waiting: ["Waiting", ""], done: ["Done · follow-up", "good"], watch: ["Watch", ""], resolved: ["Resolved", "good"], auto_cleared: ["Cleared", ""], cancelled: ["Dismissed", ""], upgraded: ["Upgraded", ""] };
  function pill(st) { var s = STATUS[st] || [st, ""]; return '<span class="tw-pill ' + s[1] + '">' + esc(s[0]) + '</span>'; }
  function sla(t) {
    if (t.status === "done") return '<span class="tw-muted">follow-up ' + day(t.followup_at) + '</span>';
    if (t.slaHoursLeft == null || ["open", "in_progress"].indexOf(t.status) < 0) return "";
    if (t.slaHoursLeft < 0) return '<span class="lp-late">' + Math.round(-t.slaHoursLeft) + 'h late' + (t.escalation >= 2 ? " · escalated" : "") + '</span>';
    return '<span class="tw-muted">' + Math.round(t.slaHoursLeft) + 'h left</span>';
  }
  function sevClass(t) { return t.escalation >= 2 ? "bad" : (t.slaHoursLeft != null && t.slaHoursLeft < 0 && ["open", "in_progress"].indexOf(t.status) >= 0) ? "bad" : t.status === "watch" ? "" : t.impact > 5000 ? "warn" : ""; }
  function sortTasks(a, b) { return (b.escalation || 0) - (a.escalation || 0) || ((a.slaHoursLeft == null ? 1e9 : a.slaHoursLeft) - (b.slaHoursLeft == null ? 1e9 : b.slaHoursLeft) < 0 && a.slaHoursLeft < 0 ? -1 : 0) || (b.priority || 0) - (a.priority || 0) || (b.impact || 0) - (a.impact || 0); }
  var METRIC = { demand: "Placed demand", cr: "CR %", dr: "DR %", cm3: "CM3", ppm: "PPM / piece" };
  // IDs at the top of the task: SKU, Merchant ID, ACM, category — click to copy
  function idsHtml(t) {
    var ids = [];
    if (t.product_id) ids.push(["SKU", t.product_id]);
    if (t.tager_id) ids.push(["Merchant ID", t.tager_id]);
    if (t.merchant_name && t.tager_id) ids.push(["Merchant", t.merchant_name]);
    if (t.acm) ids.push(["ACM", t.acm]);
    if (t.category) ids.push(["Category", t.category]);
    if (!ids.length) return "";
    return '<div class="lp-ids">' + ids.map(function (x) { return '<button type="button" class="lp-id" data-copy="' + esc(x[1]) + '" title="Copy"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></button>'; }).join("") + '</div>';
  }

  // ---------------------------------------------------------------- task card + drawer (shared)
  function card(t) {
    var who = t.level === "sku" ? (t.product_name || t.product_id) : t.level === "merchant" ? (t.merchant_name || t.tager_id) : t.level === "match" ? (t.merchant_name || t.tager_id) + " × " + (t.product_name || t.product_id) : t.level === "category" ? "Category: " + (t.category || "") : t.level === "acmall" ? "ACM: " + (t.acm || "") : (t.product_name || t.title);
    return '<div class="lp-card ' + sevClass(t) + '" data-task="' + esc(t.id) + '"><div class="lp-card-h"><b>' + esc(t.reasonLabel || t.reason) + '</b>' + pill(t.status) + (t.cleared_at && ["open", "in_progress", "waiting"].indexOf(t.status) >= 0 ? '<span class="tw-pill good">condition cleared</span>' : "") + (t.blocked_by ? '<span class="tw-pill">blocked</span>' : "") + '<span class="lp-grow"></span>' + sla(t) + '</div>' +
      '<div class="lp-card-t">' + esc(who) + '</div><div class="lp-card-m">' + esc(navLabel(t.section)) + (t.acm ? " · ACM " + esc(t.acm) : "") + (t.impact ? " · <b>" + fmtEgp(t.impact) + "/day</b> at stake" : "") + (t.eta ? " · ETA " + esc(t.eta) : "") + (t.ownerless ? ' · <span class="lp-late">no owner</span>' : "") + " · " + esc(ago(t.created_at)) + '</div></div>';
  }
  function closeDrawer() { var d = $("lpDrawer"); if (d) { d.classList.remove("open"); setTimeout(function () { d.remove(); }, 220); } }
  function evidenceHtml(t) {
    var ev = t.evidence || {}, h = "";
    var ms = ev.metrics || {}, sc = ev.scores || {};
    var rows = Object.keys(ms).filter(function (k) { return ms[k] && sc[k] != null; }).map(function (k) {
      var x = ms[k], s = sc[k], unit = k === "demand" ? " pcs/day" : k === "cm3" ? " EGP/day" : "%";
      return '<tr><td>' + METRIC[k] + '</td><td class="r">' + (x.r == null ? "—" : x.r + unit) + '</td><td class="r">' + (x.h == null ? "—" : x.h + unit) + '</td><td class="r"><b class="' + (s < 70 ? "lp-late" : "") + '">' + s + '</b></td></tr>';
    }).join("");
    if (rows) h += '<table class="tw-table"><thead><tr><th>Score</th><th class="r">Recent</th><th class="r">Usual</th><th class="r">Score</th></tr></thead><tbody>' + rows + '</tbody></table>';
    var kv = [];
    if (ev.note) kv.push(["Why", ev.note]);
    if (ev.doh != null) kv.push(["DOH", ev.doh + " days"]);
    if (ev.stock != null) kv.push(["Stock", fmtN(ev.stock)]);
    if (ev.avgDemand != null) kv.push(["Demand (7d avg)", ev.avgDemand + " pcs/day"]);
    if (ev.share != null) kv.push(["Drop share", ev.share + "% of volume · " + ev.declinedMerchants + " / " + ev.merchants + " merchants"]);
    if (ev.lock) { var L = ev.lock; kv.push(["Lock left", fmtN(L.rem) + " of " + fmtN(L.alloc)]); kv.push(["Avg confirmed / day", L.avg]); kv.push(["Cover", L.cover == null ? "—" : L.cover + " days"]); if (L.exp) kv.push(["Lock expiry", L.exp]); }
    if (ev.ppm) { var Q = ev.ppm; kv.push(["PPM / piece (delivered, D6–D12)", fmtN(Q.actual)]); kv.push(["Category target", fmtN(Q.target) + " (" + esc(Q.category || "grand total") + ")"]); kv.push(["Reached", Q.pct + "% (fix below " + Q.fixAt + "%)"]); kv.push(["Delivered / day", Q.deliveredDay]); }
    if (ev.target) { var TG = ev.target; if (TG.daily) kv.push(["Category daily target", fmtN(TG.daily)]); if (TG.cr) kv.push(["Target CR", TG.cr + "%"]); if (TG.dr) kv.push(["Target DR", TG.dr + "%"]); if (TG.ppmPiece) kv.push(["Target PPM / piece", fmtN(TG.ppmPiece)]); }
    if (ev.merchants != null && t.level === "acmall") kv.push(["Active merchants", fmtN(ev.merchants)]);
    if (ev.plan) {
      var P = ev.plan;
      if (ev.lock && ev.lock.avgPlaced != null) kv.push(["Avg placed / day", ev.lock.avgPlaced]);
      kv.push(["Product CR", P.cr == null ? "—" : P.cr + "%"]);
      kv.push(["Needed for " + P.days + " days", fmtN(P.need) + " (placed " + P.placedDay + "/day × " + P.days + " − " + fmtN(ev.lock ? ev.lock.rem : 0) + " left)"]);
      if (P.stock != null) {
        kv.push(["Stock (single)", fmtN(P.stock) + (P.doh != null ? " · DOH " + P.doh : "")]);
        kv.push(["Kept for other sellers", fmtN(P.others) + " (" + P.othersN + " seller" + (P.othersN === 1 ? "" : "s") + ", " + P.days + " days)"]);
        kv.push(["Free stock → max increase", fmtN(P.free) + " → " + fmtN(P.cap) + " placed"]);
      } else kv.push(["Stock (single)", "not in Inventory — not capped"]);
      kv.push(["Suggested increase", fmtN(P.suggest) + (P.capped ? (P.suggest > 0 ? " (capped by stock)" : " — no free stock: raise PO / transfer first") : "")]);
    } else if (ev.suggestedQty != null) kv.push(["Suggested increase", fmtN(ev.suggestedQty)]);
    if (ev.askedQty != null) kv.push(["Merchant asked", (ev.kind || "") + " " + fmtN(ev.askedQty) + (ev.note ? " — " + ev.note : "")]);
    if (t.score_after != null) kv.push(["Score after follow-up", t.score_after]);
    if (t.recovered_gmv) kv.push(["Recovered", fmtEgp(t.recovered_gmv) + "/day"]);
    if (kv.length) h += '<div class="tw-kv">' + kv.map(function (x) { return '<div><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join("") + '</div>';
    return h || '<div class="tw-muted">No numbers for this task.</div>';
  }
  function childrenHtml(t) {
    var k = t.children || []; if (!k.length) return "";
    if (k[0].sku) return '<table class="tw-table"><thead><tr><th>SKU</th><th>Down on</th><th class="r">Usual</th><th class="r">Recent</th></tr></thead><tbody>' + k.map(function (x) { return '<tr><td>' + esc(x.name || x.sku) + '<div class="tw-muted">' + esc(x.sku) + '</div></td><td>' + esc((x.metrics || []).map(function (m) { return METRIC[m] || m; }).join(", ")) + '</td><td class="r">' + x.h + '</td><td class="r">' + x.r + '</td></tr>'; }).join("") + '</tbody></table>';
    return '<table class="tw-table"><thead><tr><th>Merchant</th><th>ACM</th><th class="r">Usual</th><th class="r">Recent</th><th class="r">Score</th></tr></thead><tbody>' + k.map(function (x) { return '<tr><td>' + esc(x.name) + '<div class="tw-muted">' + esc(x.mid) + '</div></td><td>' + esc(x.acm || "—") + '</td><td class="r">' + (x.h == null ? "" : x.h) + '</td><td class="r">' + (x.r == null ? "" : x.r) + '</td><td class="r">' + (x.score == null ? "—" : '<span class="' + (x.declined ? "lp-late" : "") + '">' + x.score + '</span>') + '</td></tr>'; }).join("") + '</tbody></table>';
  }
  function openTask(id, onChange) {
    closeDrawer();
    var d = document.createElement("div"); d.id = "lpDrawer"; d.className = "tw-drawer";
    d.innerHTML = '<div class="tw-dback"></div><aside class="tw-dpanel"><div class="tw-dhead"><div><h3>Loading…</h3></div><button class="tw-x" data-x aria-label="Close">✕</button></div><div class="tw-dbody"></div></aside>';
    document.body.appendChild(d); requestAnimationFrame(function () { d.classList.add("open"); });
    d.querySelector(".tw-dback").onclick = closeDrawer; d.querySelector("[data-x]").onclick = closeDrawer;
    api("loopTask", undefined, "&id=" + encodeURIComponent(id)).then(function (j) { renderTask(d, j, onChange); })
      .catch(function (e) { d.querySelector(".tw-dbody").innerHTML = '<div class="tw-msg err">' + esc(e.message) + '</div>'; });
  }
  function renderTask(d, j, onChange) {
    var t = j.task, isAdmin = ME && ME.isAdmin, live = ["open", "in_progress", "waiting", "watch"].indexOf(t.status) >= 0, stockish = /^(STOCK_|BUNDLE_)/.test(t.reason), lockish = /^LOCK_/.test(t.reason);
    var head = '<div><h3>' + esc(t.reasonLabel) + '</h3><div class="tw-muted">' + esc(t.title) + '</div><div class="lp-card-m" style="margin-top:6px">' + pill(t.status) + ' ' + sla(t) + ' · ' + esc(navLabel(t.section)) + (t.acm ? " · ACM " + esc(t.acm) : "") + (t.impact ? " · " + fmtEgp(t.impact) + "/day" : "") + '</div></div><button class="tw-x" data-x aria-label="Close">✕</button>';
    var owners = t.assignee ? "Assigned to " + t.assignee : t.owners && t.owners.length ? "Owners: " + t.owners.join(", ") : "No owner in this section — only Admin / Country Manager see it";
    var links = "";
    if (j.parent) links += '<div class="lp-link" data-open="' + esc(j.parent.id) + '">↑ Comes from: ' + esc(j.parent.title) + ' ' + pill(j.parent.status) + '</div>';
    if (j.blocker) links += '<div class="lp-link" data-open="' + esc(j.blocker.id) + '">⏸ Waiting on: ' + esc(j.blocker.title) + ' ' + pill(j.blocker.status) + (j.blocker.eta ? " · ETA " + esc(j.blocker.eta) : "") + '</div>';
    (j.linked || []).forEach(function (k) { links += '<div class="lp-link" data-open="' + esc(k.id) + '">↓ Led to: ' + esc(k.title) + ' ' + pill(k.status) + '</div>'; });
    var acts = (t.actions || []).map(function (a) { return '<button class="tw-chip" data-act="' + esc(a) + '">' + esc(a) + '</button>'; }).join("");
    var body = idsHtml(t) + '<div class="tw-muted">' + esc(owners) + '</div>' + (t.cleared_at && live ? '<div class="lp-ok">The condition is gone since ' + day(t.cleared_at) + ' — close the task with what you did.</div>' : "") + (links ? '<div class="lp-links">' + links + '</div>' : "") +
      '<div class="tw-card"><h3>Why this task</h3>' + evidenceHtml(t) + '</div>' +
      (t.children && t.children.length ? '<div class="tw-card"><h3>' + (t.children[0].sku ? "SKUs" : "Merchants") + ' (' + t.children.length + ')</h3><div class="tw-scroll">' + childrenHtml(t) + '</div></div>' : "") +
      (j.canEdit && (live || t.status === "done") ? '<div class="tw-card"><h3>Act</h3>' +
        (t.status === "open" ? '<button class="btn" id="lpStart">Start</button> ' : "") +
        (acts ? '<div class="tw-field"><label>What did you do?</label><div class="tw-chips" id="lpActs">' + acts + '</div></div>' : "") +
        (stockish ? '<div class="tw-field"><label>Stock ETA (shows to merchants and ACMs)</label><div class="tw-row"><input type="date" id="lpEta" value="' + esc(t.eta || "") + '"><button class="btn" id="lpEtaSave">Save ETA</button></div></div>' : "") +
        (lockish ? '<div class="tw-field"><label>Quantity</label><div class="tw-row"><input type="number" id="lpQty" min="0" value="' + esc(t.qty == null ? "" : t.qty) + '"><button class="btn" id="lpQtySave">Save</button></div></div>' : "") +
        (t.reason === "LOCK_REQUEST" ? '<div class="tw-field"><label>Reply to the merchant (the merchant sees this text)</label><textarea id="lpReply" rows="2" placeholder="e.g. Lock increased by 40 pcs until 1 Nov">' + esc((t.evidence && t.evidence.reply) || "") + '</textarea></div>' : "") +
        '<div class="tw-field"><label>Outcome / note (internal — merchants never see it)</label><textarea id="lpOut" rows="3" placeholder="What happened? (needed to close the task)">' + esc(t.outcome || "") + '</textarea></div>' +
        '<div class="tw-row lp-btns"><button class="btn btn-primary" id="lpDone">' + (/^(LOCK_REQUEST|MANUAL|RELAUNCH|LOCK_)/.test(t.reason) || t.status === "watch" ? "Close task" : "Done → follow-up in " + "D+" + ((ME && ME.followUpDays) || 7)) + '</button><button class="btn" id="lpWait">Waiting on someone</button><button class="btn" id="lpComment">Add comment</button>' +
        (isAdmin ? '<button class="btn danger" id="lpCancel">Dismiss</button>' : "") + '</div><div class="tw-msg" id="lpMsg"></div></div>' : "") +
      (j.canEdit && !live && t.status !== "done" ? '<div class="tw-row"><button class="btn" id="lpReopen">Reopen</button><span class="tw-msg" id="lpMsg"></span></div>' : "") +
      '<div class="tw-card"><h3>History</h3><div class="tw-timeline">' + (j.events || []).map(function (e) { return '<div class="tw-tl"><div class="tw-tl-main"><b>' + esc(e.text) + '</b><p>' + esc(e.actor) + ' · ' + esc(new Date(e.at).toLocaleString()) + '</p></div></div>'; }).join("") + '</div></div>';
    d.querySelector(".tw-dhead").innerHTML = head; d.querySelector(".tw-dbody").innerHTML = body;
    d.querySelector("[data-x]").onclick = closeDrawer;
    d.querySelectorAll("[data-open]").forEach(function (n) { n.onclick = function () { openTask(n.getAttribute("data-open"), onChange); }; });
    d.querySelectorAll("[data-copy]").forEach(function (n) { n.onclick = function () { var v = n.getAttribute("data-copy"); try { navigator.clipboard.writeText(v); n.classList.add("ok"); setTimeout(function () { n.classList.remove("ok"); }, 900); } catch (e) {} }; });
    var picked = t.action || "";
    d.querySelectorAll("[data-act]").forEach(function (b) { if (b.getAttribute("data-act") === picked) b.classList.add("on"); b.onclick = function () { picked = b.getAttribute("data-act"); d.querySelectorAll("[data-act]").forEach(function (x) { x.classList.toggle("on", x === b); }); send({ op: "action", action: picked, note: ($("lpOut") || {}).value || "" }, true); }; });
    function msg(t2, cls) { var m = $("lpMsg"); if (m) { m.className = "tw-msg " + (cls || ""); m.textContent = t2; } }
    function send(b, stay) {
      b.id = t.id; msg("Saving…");
      return api("loopUpdate", b).then(function (r) { msg("Saved ✓", "ok"); invalidate(); if (onChange) onChange(); if (!stay) openTask(t.id, onChange); else t = r.task; })
        .catch(function (e) { msg(e.message, "err"); });
    }
    var on = function (id, fn) { var el = $(id); if (el) el.onclick = fn; };
    on("lpStart", function () { send({ op: "start" }); });
    on("lpEtaSave", function () { send({ op: "eta", eta: $("lpEta").value }); });
    on("lpQtySave", function () { send({ op: "qty", qty: $("lpQty").value }); });
    on("lpWait", function () { send({ op: "wait", note: $("lpOut").value }); });
    on("lpComment", function () { send({ op: "comment", note: $("lpOut").value }); });
    on("lpDone", function () { var b = { op: "done", action: picked, outcome: $("lpOut").value }; if ($("lpReply")) b.reply = $("lpReply").value; send(b); });
    on("lpCancel", function () { if (confirm("Dismiss this task? The engine will not raise it again for a few days.")) send({ op: "cancel", note: $("lpOut").value }); });
    on("lpReopen", function () { send({ op: "reopen" }); });
  }
  function invalidate() { CACHE = {}; }

  // ---------------------------------------------------------------- My Tasks
  var myFilter = { status: "active", section: "", q: "", all: false };
  function renderMyTasks(host) {
    host.innerHTML = '<div class="tw-page"><div class="tw-card tw-muted">Loading your tasks…</div></div>';
    var p = (myFilter.status === "closed" ? "&status=closed" : "") + (myFilter.everyone ? "&all=1" : "");
    api("loopTasks", undefined, "&scope=mine" + p).then(function (j) {
      var tasks = j.tasks || [], fyi = j.fyi || [];
      var sections = {}; tasks.forEach(function (t) { sections[t.section] = (sections[t.section] || 0) + 1; });
      function draw() {
        var q = myFilter.q.toLowerCase();
        var list = tasks.filter(function (t) {
          if (myFilter.section && t.section !== myFilter.section) return false;
          if (myFilter.status === "late" && !(t.slaHoursLeft != null && t.slaHoursLeft < 0 && ["open", "in_progress"].indexOf(t.status) >= 0)) return false;
          if (myFilter.status === "done" && t.status !== "done") return false;
          if (myFilter.status === "waiting" && t.status !== "waiting") return false;
          if (myFilter.status === "watch" && t.status !== "watch") return false;
          if (myFilter.status === "active" && ["open", "in_progress"].indexOf(t.status) < 0) return false;
          return !q || (t.title + " " + t.tager_id + " " + t.product_id + " " + (t.acm || "")).toLowerCase().indexOf(q) >= 0;
        }).sort(sortTasks);
        var max = j.maxPerPerson || 10, shown = myFilter.all ? list : list.slice(0, max);
        $("lpList").innerHTML = shown.length ? shown.map(card).join("") + (list.length > shown.length ? '<button class="btn" id="lpMore">Show all ' + list.length + '</button>' : "") : '<div class="tw-empty"><div class="tw-empty-ic">✓</div>Nothing here. Tasks show up after the engine runs (' + esc(j.asOf ? "last run " + ago(j.asOf) : "not run yet") + ').</div>';
        if ($("lpMore")) $("lpMore").onclick = function () { myFilter.all = true; draw(); };
        $("lpList").querySelectorAll("[data-task]").forEach(function (n) { n.onclick = function () { openTask(n.getAttribute("data-task"), function () { renderMyTasks(host); }); }; });
      }
      var cnt = function (f) { return tasks.filter(f).length; };
      var late = cnt(function (t) { return t.slaHoursLeft != null && t.slaHoursLeft < 0 && ["open", "in_progress"].indexOf(t.status) >= 0; });
      var chips = [["active", "To do", cnt(function (t) { return ["open", "in_progress"].indexOf(t.status) >= 0; })], ["late", "Late", late], ["waiting", "Waiting", cnt(function (t) { return t.status === "waiting"; })], ["done", "Follow-up", cnt(function (t) { return t.status === "done"; })], ["watch", "Watch", cnt(function (t) { return t.status === "watch"; })], ["closed", "Closed (30d)", null]];
      host.innerHTML = '<div class="tw-page">' + (j.testMode ? '<div class="lp-test"><b>TEST MODE</b> ' + (j.testMode.you ? "You see every task as it would reach its owners (\"Owners\" in each task). Nobody else sees them, and merchants get no notifications." : "") + '</div>' : "") +
        '<div class="tw-stats"><div class="tw-stat"><span>To do</span><b>' + chips[0][2] + '</b></div><div class="tw-stat"><span>Late</span><b class="' + (late ? "lp-late" : "") + '">' + late + '</b></div><div class="tw-stat"><span>Waiting / follow-up</span><b>' + (chips[2][2] + chips[3][2]) + '</b></div><div class="tw-stat"><span>At stake / day</span><b>' + fmtEgp(tasks.filter(function (t) { return ["open", "in_progress", "waiting"].indexOf(t.status) >= 0; }).reduce(function (a, t) { return a + (t.impact || 0); }, 0)) + '</b></div></div>' +
        '<div class="tw-toolbar"><div class="tw-chips">' + chips.map(function (c) { return '<button class="tw-chip' + (myFilter.status === c[0] ? " on" : "") + '" data-st="' + c[0] + '">' + c[1] + (c[2] == null ? "" : " · " + c[2]) + '</button>'; }).join("") + '</div>' +
        '<select id="lpSec" style="min-height:36px;padding:0 10px"><option value="">All sections</option>' + Object.keys(sections).map(function (s) { return '<option value="' + esc(s) + '"' + (myFilter.section === s ? " selected" : "") + '>' + esc(navLabel(s)) + ' (' + sections[s] + ')</option>'; }).join("") + '</select>' +
        '<input type="search" id="lpQ" placeholder="Search merchant / SKU" value="' + esc(myFilter.q) + '" style="min-height:36px;padding:0 10px;min-width:200px">' + (ME && ME.isAdmin ? '<label class="tw-check"><input type="checkbox" id="lpEvery"' + (myFilter.everyone ? " checked" : "") + '> Everyone\'s tasks</label>' : "") + '<span class="tw-muted">' + esc(j.asOf ? "Engine ran " + ago(j.asOf) : "") + (ME && ME.isAdmin && !myFilter.everyone ? " · as Admin you see tasks with no owner, escalated ones and yours" : "") + '</span></div>' +
        '<div id="lpList" class="lp-list"></div>' +
        (fyi.length ? '<div class="tw-card"><h3>Other teams are on it (your merchants are affected)</h3><div class="lp-list">' + fyi.map(card).join("") + '</div></div>' : "") + '</div>';
      host.querySelectorAll("[data-st]").forEach(function (b) { b.onclick = function () { var was = myFilter.status; myFilter.status = b.getAttribute("data-st"); myFilter.all = false; if ((was === "closed") !== (myFilter.status === "closed")) renderMyTasks(host); else { host.querySelectorAll("[data-st]").forEach(function (x) { x.classList.toggle("on", x === b); }); draw(); } }; });
      $("lpSec").onchange = function () { myFilter.section = this.value; draw(); };
      $("lpQ").oninput = function () { myFilter.q = this.value; draw(); };
      if ($("lpEvery")) $("lpEvery").onchange = function () { myFilter.everyone = this.checked; renderMyTasks(host); };
      host.querySelectorAll(".lp-list [data-task]").forEach(function (n) { n.onclick = function () { openTask(n.getAttribute("data-task"), function () { renderMyTasks(host); }); }; });
      draw();
      updateBadge(tasks);
    }).catch(function (e) { host.innerHTML = '<div class="tw-page"><div class="tw-card"><div class="tw-msg err">' + esc(e.message) + '</div></div></div>'; });
  }
  function updateBadge(tasks) {
    var nav = $("navLoopTasks"); if (!nav) return;
    var n = (tasks || []).filter(function (t) { return ["open", "in_progress"].indexOf(t.status) >= 0; }).length;
    var b = nav.querySelector(".lp-nb"); if (!b) { b = document.createElement("span"); b.className = "lp-nb"; nav.appendChild(b); }
    b.textContent = n > 99 ? "99+" : String(n); b.style.display = n ? "" : "none";
  }

  // ---------------------------------------------------------------- strip on top of every section
  function stripFor(view) {
    var nav = C.viewNav && C.viewNav[view]; if (!nav) return;
    var sec = document.querySelector(".view-section:not(.hidden)"); if (!sec || sec.id === "viewLoopTasks" || sec.id === "viewLoopControl") return;
    var old = sec.querySelector(":scope > .lp-strip"); if (old) old.remove();
    var go = function (j) {
      var tasks = (j.tasks || []).filter(function (t) { return ["open", "in_progress", "waiting"].indexOf(t.status) >= 0; }).sort(sortTasks);
      if (!tasks.length) return;
      var late = tasks.filter(function (t) { return t.slaHoursLeft != null && t.slaHoursLeft < 0; }).length;
      var s = document.createElement("div"); s.className = "lp-strip";
      s.innerHTML = '<div class="lp-strip-h"><b>' + tasks.length + ' task' + (tasks.length > 1 ? "s" : "") + ' on this page</b>' + (late ? '<span class="lp-late">' + late + ' late</span>' : "") + '<span class="lp-grow"></span><button class="btn small" data-all>Open in My Tasks</button><button class="tw-x" data-hide aria-label="Hide">✕</button></div>' +
        '<div class="lp-strip-l">' + tasks.slice(0, 3).map(function (t) { return '<div class="lp-strip-i" data-task="' + esc(t.id) + '"><span class="lp-dot ' + sevClass(t) + '"></span>' + esc(t.title) + ' <span class="tw-muted">' + (t.impact ? fmtEgp(t.impact) + "/day" : "") + '</span> ' + sla(t) + '</div>'; }).join("") + '</div>';
      sec.insertBefore(s, sec.firstChild);
      s.querySelector("[data-hide]").onclick = function () { s.remove(); };
      s.querySelector("[data-all]").onclick = function () { myFilter.section = nav; myFilter.status = "active"; window.switchView("loopTasks"); };
      s.querySelectorAll("[data-task]").forEach(function (n) { n.onclick = function () { openTask(n.getAttribute("data-task"), function () { invalidate(); stripFor(view); }); }; });
    };
    var c = CACHE[nav]; if (c && Date.now() - c.at < STRIP_TTL) { go(c.j); return; }
    api("loopTasks", undefined, "&scope=section&section=" + encodeURIComponent(nav)).then(function (j) { CACHE[nav] = { at: Date.now(), j: j }; if (document.querySelector(".view-section:not(.hidden)") === sec) go(j); }).catch(function () {});
  }

  // ---------------------------------------------------------------- Command Loop control (Admin / Country Manager)
  var ctab = "overview", CFG = null, DEF = null, REASONS = {}, TEAMS = [], SECTEAM = {}, adminRows = null, adminUsers = [], af = { status: "active", section: "", reason: "", owner: "", q: "", late: false, ownerless: false }, sel = {};
  var TABS = [["overview", "Overview"], ["tasks", "All tasks"], ["preview", "Merchant preview"], ["scores", "Scores"], ["scoring", "Scoring"], ["diagnose", "Diagnose & tasks"], ["routing", "Routing"], ["merchant", "Merchant notifications"], ["cpa", "RE-CPA"], ["exclusions", "Exclusions"], ["runs", "Engine"]];
  function renderControl(host) {
    host.innerHTML = '<div class="tw-page"><div class="tw-tabs lp-ctabs">' + TABS.map(function (t) { return '<button class="tw-tab' + (ctab === t[0] ? " on" : "") + '" data-ct="' + t[0] + '">' + t[1] + '</button>'; }).join("") + '</div><div id="lpCtl"><div class="tw-card tw-muted">Loading…</div></div></div>';
    host.querySelectorAll("[data-ct]").forEach(function (b) { b.onclick = function () { ctab = b.getAttribute("data-ct"); renderControl(host); }; });
    var box = $("lpCtl");
    var needCfg = ["scoring", "diagnose", "routing", "merchant", "cpa", "exclusions"].indexOf(ctab) >= 0;
    (needCfg && !CFG ? api("loopConfig").then(function (j) { CFG = j.config; DEF = j.defaults; REASONS = j.reasons; TEAMS = j.teams || []; SECTEAM = j.sectionTeam || {}; }) : Promise.resolve()).then(function () {
      if (ctab === "overview") return ctlOverview(box);
      if (ctab === "tasks") return ctlTasks(box);
      if (ctab === "scores") return ctlScores(box);
      if (ctab === "runs") return ctlRuns(box);
      if (ctab === "preview") return ctlPreview(box);
      return ctlSettings(box, ctab);
    }).catch(function (e) { box.innerHTML = '<div class="tw-card"><div class="tw-msg err">' + esc(e.message) + '</div></div>'; });
  }
  function kpi(label, v, cls) { return '<div class="tw-stat"><span>' + esc(label) + '</span><b class="' + (cls || "") + '">' + v + '</b></div>'; }
  function ctlOverview(box) {
    return Promise.all([api("loopStats"), api("loopRunInfo"), api("loopConfig")]).then(function (r) {
      var s = r[0].stats, run = r[1]; CFG = r[2].config; DEF = r[2].defaults; REASONS = r[2].reasons; TEAMS = r[2].teams || []; SECTEAM = r[2].sectionTeam || {};
      var secRows = Object.keys(s.bySection).sort(function (a, b) { return s.bySection[b].open - s.bySection[a].open; }).map(function (k) { var x = s.bySection[k]; return '<tr><td>' + esc(navLabel(k)) + '</td><td class="r">' + x.open + '</td><td class="r ' + (x.late ? "lp-late" : "") + '">' + x.late + '</td><td class="r">' + x.resolved + '</td><td class="r">' + fmtEgp(x.impact) + '</td></tr>'; }).join("");
      var ownRows = Object.keys(s.byOwner).sort(function (a, b) { return s.byOwner[b].late - s.byOwner[a].late || s.byOwner[b].open - s.byOwner[a].open; }).map(function (k) { var x = s.byOwner[k]; return '<tr><td>' + esc(k) + '</td><td class="r">' + x.open + '</td><td class="r ' + (x.late ? "lp-late" : "") + '">' + x.late + '</td></tr>'; }).join("");
      var RL = r[0].reasons || {}; var rsRows = Object.keys(s.byReason).map(function (k) { var x = s.byReason[k]; return '<tr><td>' + esc((RL[k] || {}).label || k) + '</td><td class="r">' + x.open + '</td><td class="r">' + x.resolved + '</td><td class="r">' + x.recovered + ' / ' + (x.recovered + x.notRecovered) + '</td></tr>'; }).join("");
      var pb = (s.playbook || []).slice(0, 15).map(function (p) { return '<tr><td>' + esc(p.key) + '</td><td class="r">' + p.n + '</td><td class="r"><b>' + p.rate + '%</b></td></tr>'; }).join("");
      var last = run.last || {};
      var tm = CFG.testMode || { on: false, recipients: [] };
      box.innerHTML = '<div class="tw-card lp-testcard' + (tm.on ? " on" : "") + '"><div class="tw-row"><label class="tw-sw"><input type="checkbox" id="tmOn"' + (tm.on ? " checked" : "") + '><span></span></label><div class="lp-grow"><b>Test mode ' + (tm.on ? "ON" : "OFF") + '</b><div class="tw-muted">' + (tm.on ? "Tasks, bell notifications and merchant notifications reach ONLY the emails below. Owners are still calculated, so you see who would get each task. Use Merchant preview to see what a merchant would get." : "Live: tasks reach their owners and merchants get their notifications.") + '</div></div></div>' +
        '<div class="tw-field"><label>Test recipients (comma separated)</label><input id="tmTo" value="' + esc((tm.recipients || []).join(", ")) + '"></div><div class="tw-row"><button class="btn btn-primary" id="tmSave">Save</button><span class="tw-msg" id="tmMsg"></span></div></div>' +
        '<div class="tw-stats">' + kpi("Open tasks", fmtN(s.open)) + kpi("Late", fmtN(s.late), s.late ? "lp-late" : "") + kpi("Escalated", fmtN(s.escalated), s.escalated ? "lp-late" : "") + kpi("No owner", fmtN(s.ownerless), s.ownerless ? "lp-late" : "") + '</div>' +
        '<div class="tw-stats">' + kpi("Resolved (30d)", fmtN(s.resolved30)) + kpi("Recovery rate", s.recoveryRate == null ? "—" : s.recoveryRate + "%") + kpi("GMV recovered / day", fmtEgp(s.gmvRecovered)) + kpi("Median time to act", s.medianHoursToAction == null ? "—" : s.medianHoursToAction + "h") + '</div>' +
        '<div class="tw-card"><h3>Engine</h3><div class="tw-row"><span>' + (last.at ? (last.ok ? "Last run " : "Last run FAILED ") + esc(ago(last.at)) + " · " + (last.ms || 0) + "ms · " + fmtN(last.created) + " new · " + fmtN(last.cleared) + " cleared · " + fmtN(last.resolved) + " resolved" + (last.stats && last.stats.gated ? " · filtered out: " + fmtN(last.stats.gated.unconfirmed) + " one-day blips, " + fmtN(last.stats.gated.small) + " too small" : "") + (last.heldBack ? " · " + fmtN(last.heldBack) + " waiting (daily cap)" : "") : "Not run yet") + '</span><span class="lp-grow"></span><button class="btn btn-primary" id="lpRun">Run now</button></div>' +
          (last.error ? '<div class="tw-msg err">' + esc(last.error) + '</div>' : "") + ((last.warnings || []).length ? '<ul class="lp-warn">' + last.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>" : "") + (!run.d1 ? '<div class="tw-msg err">D1 database is not connected — tasks are not stored. See DEPLOY-v1.17.0.md.</div>' : "") + '<div class="tw-msg" id="lpRunMsg"></div></div>' +
        '<div class="tw-grid2"><div class="tw-card"><h3>By section</h3><table class="tw-table"><thead><tr><th>Section</th><th class="r">Open</th><th class="r">Late</th><th class="r">Resolved</th><th class="r">At stake</th></tr></thead><tbody>' + (secRows || '<tr><td colspan="5" class="tw-muted">No tasks yet</td></tr>') + '</tbody></table></div>' +
        '<div class="tw-card"><h3>By person</h3><table class="tw-table"><thead><tr><th>Owner</th><th class="r">Open</th><th class="r">Late</th></tr></thead><tbody>' + (ownRows || '<tr><td colspan="3" class="tw-muted">—</td></tr>') + '</tbody></table></div></div>' +
        '<div class="tw-grid2"><div class="tw-card"><h3>By reason</h3><table class="tw-table"><thead><tr><th>Reason</th><th class="r">Open</th><th class="r">Resolved</th><th class="r">Recovered</th></tr></thead><tbody>' + (rsRows || '<tr><td colspan="4" class="tw-muted">—</td></tr>') + '</tbody></table></div>' +
        '<div class="tw-card"><h3>Playbook — which action recovers best</h3><table class="tw-table"><thead><tr><th>Reason · action</th><th class="r">Times</th><th class="r">Recovered</th></tr></thead><tbody>' + (pb || '<tr><td colspan="3" class="tw-muted">Fills in after the first follow-ups (D+7).</td></tr>') + '</tbody></table></div></div>';
      $("lpRun").onclick = function () { runNow($("lpRunMsg"), function () { ctlOverview(box); }); };
      $("tmSave").onclick = function () {
        var on = $("tmOn").checked, to = $("tmTo").value.split(",").map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean), m = $("tmMsg");
        if (on && !to.length) { m.className = "tw-msg err"; m.textContent = "Add at least one test email."; return; }
        if (!on && !confirm("Go LIVE? Tasks will reach their owners and merchants will start getting notifications.")) return;
        CFG.testMode = { on: on, recipients: to }; m.className = "tw-msg"; m.textContent = "Saving…";
        api("loopConfigPut", { config: CFG }).then(function (j) { CFG = j.config; C.logActivity("settings", "Command Loop test mode " + (on ? "ON" : "OFF (live)"), to.join(", ")); invalidate(); ctlOverview(box); }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message; });
      };
    });
  }
  function runNow(msgEl, done) {
    msgEl.className = "tw-msg"; msgEl.textContent = "Running the engine (reads Main + Inventory + Locks)… this takes up to a minute.";
    api("loopRun", {}, "", 180000).then(function (j) { msgEl.className = "tw-msg ok"; msgEl.textContent = "Done ✓ " + (j.run.created || 0) + " new tasks"; C.logActivity("settings", "Command Loop engine run", (j.run.created || 0) + " new"); invalidate(); setTimeout(done, 600); })
      .catch(function (e) { msgEl.className = "tw-msg err"; msgEl.textContent = e.message; });
  }
  function ctlTasks(box) {
    return api("loopAdminList", undefined, "&days=30").then(function (j) {
      adminRows = j.tasks || []; adminUsers = j.users || []; sel = {};
      var secs = {}, rs = {}; adminRows.forEach(function (t) { secs[t.section] = 1; rs[t.reason] = 1; });
      var opt = function (arr, v, lab) { return arr.map(function (x) { return '<option value="' + esc(x) + '"' + (v === x ? " selected" : "") + '>' + esc(lab ? lab(x) : x) + '</option>'; }).join(""); };
      var userOpts = '<option value="">auto (by section)</option>' + adminUsers.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.email + " · " + (u.role || "") + (u.acm ? " · " + u.acm : "")) + '</option>'; }).join("");
      box.innerHTML = '<div class="tw-card"><div class="tw-toolbar">' +
        '<select id="afSt"><option value="active">Active</option><option value="all">All (30d)</option><option value="closed">Closed (30d)</option>' + opt(Object.keys(STATUS), af.status === "active" || af.status === "all" || af.status === "closed" ? "" : af.status, function (s) { return "Status: " + STATUS[s][0]; }) + '</select>' +
        '<select id="afSec"><option value="">All sections</option>' + opt(Object.keys(secs), af.section, navLabel) + '</select>' +
        '<select id="afRs"><option value="">All reasons</option>' + opt(Object.keys(rs), af.reason) + '</select>' +
        '<input id="afQ" type="search" placeholder="Search title / merchant / SKU / owner" value="' + esc(af.q) + '">' +
        '<label class="tw-check"><input type="checkbox" id="afLate"' + (af.late ? " checked" : "") + '> Late</label><label class="tw-check"><input type="checkbox" id="afNo"' + (af.ownerless ? " checked" : "") + '> No owner</label>' +
        '<span class="lp-grow"></span><button class="btn" id="afNew">+ New task</button><button class="btn" id="afCsv">Export CSV</button></div>' +
        '<div class="tw-toolbar lp-bulk"><b id="afN">0 selected</b><select id="abAs">' + userOpts + '</select><button class="btn small" id="abAsGo">Assign</button>' +
        '<select id="abSt"><option value="">Set status…</option>' + opt(["open", "in_progress", "waiting", "done", "resolved", "cancelled", "watch"], "", function (s) { return STATUS[s][0]; }) + '</select>' +
        '<select id="abSec"><option value="">Move to section…</option>' + C.viewOptions().map(function (o) { var n = C.viewNav[o.view]; return '<option value="' + esc(n) + '">' + esc(o.label) + '</option>'; }).join("") + '</select>' +
        '<input id="abSla" type="number" min="1" placeholder="SLA h" style="width:90px"><button class="btn small" id="abSlaGo">Reset SLA</button>' +
        '<input id="abFu" type="number" min="0" placeholder="Follow-up d" style="width:110px"><button class="btn small" id="abFuGo">Follow-up</button>' +
        '<select id="abPr"><option value="">Priority…</option><option value="3">Urgent</option><option value="2">High</option><option value="1">Raised</option><option value="0">Normal</option><option value="-1">Low</option></select>' +
        '<button class="btn small danger" id="abDel">Delete</button><span class="tw-msg" id="abMsg"></span></div>' +
        '<div class="tw-scroll"><table class="tw-table lp-at"><thead><tr><th><input type="checkbox" id="afAll"></th><th>Task</th><th>Section / owner</th><th>Status</th><th class="r">EGP/day</th><th>SLA</th><th>Created</th></tr></thead><tbody id="afBody"></tbody></table></div><div class="tw-muted" id="afFoot"></div></div>';
      function list() {
        var q = af.q.toLowerCase(), now = Date.now();
        return adminRows.filter(function (t) {
          var closed = ["resolved", "auto_cleared", "cancelled", "upgraded"].indexOf(t.status) >= 0;
          if (af.status === "active" && closed) return false; if (af.status === "closed" && !closed) return false;
          if (["active", "all", "closed"].indexOf(af.status) < 0 && t.status !== af.status) return false;
          if (af.section && t.section !== af.section) return false; if (af.reason && t.reason !== af.reason) return false;
          if (af.late && !(t.slaHoursLeft != null && t.slaHoursLeft < 0 && ["open", "in_progress"].indexOf(t.status) >= 0)) return false;
          if (af.ownerless && !t.ownerless) return false;
          return !q || (t.title + " " + t.tager_id + " " + t.product_id + " " + (t.owners || []).join(" ") + " " + (t.assignee || "") + " " + (t.acm || "")).toLowerCase().indexOf(q) >= 0;
        }).sort(sortTasks);
      }
      function draw() {
        var L = list(), shown = L.slice(0, 400);
        $("afBody").innerHTML = shown.map(function (t) { return '<tr data-row="' + esc(t.id) + '"><td><input type="checkbox" data-sel="' + esc(t.id) + '"' + (sel[t.id] ? " checked" : "") + '></td><td><a class="lp-a" data-task="' + esc(t.id) + '">' + esc(t.title) + '</a><div class="tw-muted">' + esc(t.reasonLabel) + (t.escalation ? " · escalation " + t.escalation : "") + (t.priority > 0 ? " · priority " + t.priority : "") + '</div></td><td>' + esc(navLabel(t.section)) + '<div class="tw-muted">' + esc(t.assignee ? "→ " + t.assignee : (t.owners || []).slice(0, 2).join(", ") || "no owner") + '</div></td><td>' + pill(t.status) + '</td><td class="r">' + fmtN(t.impact) + '</td><td>' + sla(t) + '</td><td class="tw-muted">' + esc(day(t.created_at)) + '</td></tr>'; }).join("") || '<tr><td colspan="7" class="tw-muted">No tasks match.</td></tr>';
        $("afFoot").textContent = L.length + " tasks" + (L.length > shown.length ? " (first 400 shown — narrow the filters)" : "");
        $("afBody").querySelectorAll("[data-sel]").forEach(function (c) { c.onchange = function () { if (c.checked) sel[c.getAttribute("data-sel")] = 1; else delete sel[c.getAttribute("data-sel")]; cnt(); }; });
        $("afBody").querySelectorAll("[data-task]").forEach(function (a) { a.onclick = function () { openTask(a.getAttribute("data-task"), function () { ctlTasks(box); }); }; });
      }
      function cnt() { $("afN").textContent = Object.keys(sel).length + " selected"; }
      function bulk(set) {
        var ids = Object.keys(sel); if (!ids.length) { $("abMsg").textContent = "Select tasks first."; return; }
        $("abMsg").className = "tw-msg"; $("abMsg").textContent = "Saving…";
        api("loopAdminUpdate", { ids: ids, set: set }).then(function () { C.logActivity("settings", "Command Loop: " + ids.length + " task(s) changed", JSON.stringify(set)); invalidate(); ctlTasks(box); }).catch(function (e) { $("abMsg").className = "tw-msg err"; $("abMsg").textContent = e.message; });
      }
      $("afSt").value = af.status; $("afSt").onchange = function () { af.status = this.value; draw(); };
      $("afSec").onchange = function () { af.section = this.value; draw(); }; $("afRs").onchange = function () { af.reason = this.value; draw(); };
      $("afQ").oninput = function () { af.q = this.value; draw(); };
      $("afLate").onchange = function () { af.late = this.checked; draw(); }; $("afNo").onchange = function () { af.ownerless = this.checked; draw(); };
      $("afAll").onchange = function () { var on = this.checked; list().slice(0, 400).forEach(function (t) { if (on) sel[t.id] = 1; else delete sel[t.id]; }); draw(); cnt(); };
      $("abAsGo").onclick = function () { bulk({ assignee: $("abAs").value || null }); };
      $("abSt").onchange = function () { if (this.value) bulk({ status: this.value, outcome: this.value === "resolved" || this.value === "cancelled" ? "Changed by admin" : undefined }); };
      $("abSec").onchange = function () { if (this.value) bulk({ section: this.value }); };
      $("abSlaGo").onclick = function () { if (+$("abSla").value > 0) bulk({ dueHours: +$("abSla").value }); };
      $("abFuGo").onclick = function () { if ($("abFu").value !== "") bulk({ followupDays: +$("abFu").value }); };
      $("abPr").onchange = function () { if (this.value !== "") bulk({ priority: +this.value }); };
      $("abDel").onclick = function () { var ids = Object.keys(sel); if (!ids.length || !confirm("Delete " + ids.length + " task(s) and their history for good?")) return; api("loopDelete", { ids: ids }).then(function () { C.logActivity("settings", "Command Loop: deleted " + ids.length + " task(s)"); ctlTasks(box); }); };
      $("afCsv").onclick = function () { exportCsv(); };
      $("afNew").onclick = function () { newTaskModal(userOpts, function () { ctlTasks(box); }); };
      draw();
    });
  }
  var pvMid = "";
  function ntfPreviewText(x, sku) {
    var d = x.data || {}, nm = (sku && sku.n) || x.sku, n1 = function (v) { return v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("en-US"); };
    switch (x.rule) {
      case "N1": return ["Orders dropped on " + nm, "You placed " + n1(d.recent) + " pcs/day lately vs " + n1(d.usual) + " pcs/day usually (score " + n1(d.score) + ")."];
      case "N2": return ["Confirmation rate dropped on " + nm, n1(d.recent) + "% confirmed lately vs " + n1(d.usual) + "% usually."];
      case "N3": return [nm + " is running out", "About " + n1(d.doh) + " days of stock left (" + fmtN(d.stock) + " pcs)."];
      case "N4": return [nm + " is out of stock", "New orders on this SKU cannot be fulfilled."];
      case "N5": return ["Your lock on " + nm + " is running low", fmtN(d.rem) + " pcs left ≈ " + n1(d.cover) + " days at " + n1(d.avg) + " confirmed pcs/day. Suggested: +" + fmtN(d.suggest) + " pcs."];
      case "N6": return ["Your lock on " + nm + " ends on " + d.exp, fmtN(d.rem) + " pcs left in the lock."];
    }
    return [nm, ""];
  }
  function ctlPreview(box) {
    box.innerHTML = '<div class="tw-card"><h3>Merchant preview</h3><div class="tw-muted">What a merchant would see in the portal\'s Alert Center right now (from the last engine run). Use it while test mode is on.</div><div class="tw-toolbar" style="margin-top:12px"><input id="pvMid" placeholder="Merchant ID" value="' + esc(pvMid) + '"><button class="btn btn-primary" id="pvGo">Show</button></div><div id="pvOut"></div></div>';
    var go = function () {
      pvMid = $("pvMid").value.trim(); if (!pvMid) return; $("pvOut").innerHTML = '<div class="tw-muted">Loading…</div>';
      api("loopMerchantPreview", undefined, "&mid=" + encodeURIComponent(pvMid)).then(function (j) {
        var sig = j.signals || [];
        $("pvOut").innerHTML = (j.testMode ? '<div class="lp-test"><b>TEST MODE</b> This merchant does NOT see these yet.</div>' : "") + (sig.length ? '<div class="lp-list">' + sig.map(function (x) { var t = ntfPreviewText(x, j.skus[x.sku]); return '<div class="lp-card ' + (x.sev === "critical" ? "bad" : "warn") + '"><div class="lp-card-h"><b>' + esc(x.rule) + '</b><span class="tw-pill ' + (x.sev === "critical" ? "bad" : "warn") + '">' + esc(x.sev) + '</span><span class="lp-grow"></span><span class="tw-muted">' + esc(x.sku) + '</span></div><div class="lp-card-t">' + esc(t[0]) + '</div><div class="lp-card-m">' + esc(t[1]) + '</div></div>'; }).join("") + '</div>' : '<div class="tw-empty">No notifications for merchant ' + esc(j.mid) + ' (as of ' + esc(j.asOf || "—") + ').</div>');
      }).catch(function (e) { $("pvOut").innerHTML = '<div class="tw-msg err">' + esc(e.message) + '</div>'; });
    };
    $("pvGo").onclick = go; $("pvMid").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); }); if (pvMid) go();
  }
  function exportCsv() {
    var url = (typeof SYNC_CDN_URL !== "undefined" ? SYNC_CDN_URL : "") + "?action=loopExport";
    fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); }).then(function (b) { var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "command-loop-follow-up-log.csv"; document.body.appendChild(a); a.click(); a.remove(); }).catch(function (e) { alert(e.message); });
  }
  function newTaskModal(userOpts, done) {
    var m = document.createElement("div"); m.className = "tw-modal";
    m.innerHTML = '<div class="tw-mback"></div><div class="tw-mbox"><div class="tw-mhead"><h3>New task</h3><button class="tw-x" data-x aria-label="Close">✕</button></div><div class="tw-mbody">' +
      '<div class="tw-field"><label>Title</label><input id="ntT" placeholder="What needs to be done"></div>' +
      '<div class="tw-mgrid"><div class="tw-field"><label>Section (the team that gets it)</label><select id="ntS">' + C.viewOptions().map(function (o) { return '<option value="' + esc(C.viewNav[o.view]) + '">' + esc(o.label) + '</option>'; }).join("") + '</select></div>' +
      '<div class="tw-field"><label>Assign to (optional)</label><select id="ntA">' + userOpts + '</select></div>' +
      '<div class="tw-field"><label>Merchant ID (optional)</label><input id="ntM"></div><div class="tw-field"><label>SKU (optional)</label><input id="ntK"></div>' +
      '<div class="tw-field"><label>Due in (hours)</label><input id="ntD" type="number" value="48" min="1"></div><div class="tw-field"><label>Priority</label><select id="ntP"><option value="0">Normal</option><option value="1">Raised</option><option value="2">High</option><option value="3">Urgent</option></select></div></div>' +
      '<div class="tw-field"><label>Details</label><textarea id="ntN" rows="3"></textarea></div><div class="tw-msg" id="ntMsg"></div></div>' +
      '<div class="tw-mfoot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" id="ntGo">Create</button></div></div>';
    document.body.appendChild(m);
    var close = function () { m.remove(); }; m.querySelectorAll("[data-x], .tw-mback").forEach(function (x) { x.onclick = close; });
    $("ntGo").onclick = function () {
      api("loopCreate", { title: $("ntT").value, section: $("ntS").value, assignee: $("ntA").value, mid: $("ntM").value, sku: $("ntK").value, dueHours: +$("ntD").value, priority: +$("ntP").value, note: $("ntN").value })
        .then(function () { C.logActivity("settings", "Command Loop: manual task", $("ntT").value); close(); done(); }).catch(function (e) { $("ntMsg").className = "tw-msg err"; $("ntMsg").textContent = e.message; });
    };
  }
  var scLevel = "merchant", scQ = "", scDec = true;
  function ctlScores(box) {
    return api("loopScores").then(function (j) {
      var S = j.scores; if (!S) { box.innerHTML = '<div class="tw-card tw-muted">No scores yet — run the engine first (Engine tab).</div>'; return; }
      box.innerHTML = '<div class="tw-card"><div class="tw-toolbar"><div class="tw-chips">' + [["acm", "ACMs"], ["category", "Categories"], ["merchant", "Merchants"], ["sku", "SKUs"], ["match", "Matches (flagged)"]].map(function (x) { return '<button class="tw-chip' + (scLevel === x[0] ? " on" : "") + '" data-lv="' + x[0] + '">' + x[1] + ' · ' + fmtN((S[x[0]] || []).length) + '</button>'; }).join("") + '</div>' +
        '<input id="scQ" type="search" placeholder="Search" value="' + esc(scQ) + '"><label class="tw-check"><input type="checkbox" id="scDec"' + (scDec ? " checked" : "") + '> Declined only</label><span class="lp-grow"></span><span class="tw-muted">As of ' + esc(S.asOf) + ' (D0) · built ' + esc(ago(S.builtAt)) + '</span></div>' +
        '<div class="tw-scroll"><table class="tw-table"><thead><tr><th>Name</th><th>ACM</th><th class="r">Demand</th><th class="r">CR</th><th class="r">DR</th><th class="r">CM3</th><th class="r">Usual/day</th><th class="r">Recent</th><th>Flags</th><th class="r">EGP/day</th></tr></thead><tbody id="scBody"></tbody></table></div><div class="tw-muted" id="scFoot"></div></div>';
      function cell(v) { return v == null ? '<td class="r tw-muted">—</td>' : '<td class="r' + (v < (CFG ? CFG.scoring.threshold : 70) ? " lp-late" : "") + '">' + v + '</td>'; }
      function draw() {
        var q = scQ.toLowerCase(), rows = (S[scLevel] || []).filter(function (r) { return (!scDec || r.d.length || r.f.indexOf("NEGATIVE_CM3") >= 0) && (!q || (r.k + " " + r.n + " " + (r.acm || "")).toLowerCase().indexOf(q) >= 0); });
        $("scBody").innerHTML = rows.slice(0, 500).map(function (r) { return '<tr><td>' + esc(r.n) + '<div class="tw-muted">' + esc(r.k) + '</div></td><td>' + esc(r.acm || "") + '</td>' + cell(r.sc.demand) + cell(r.sc.cr) + cell(r.sc.dr) + cell(r.sc.cm3) + '<td class="r">' + r.h + '</td><td class="r">' + r.r + '</td><td class="tw-muted">' + esc(r.f.join(", ")) + (r.doh != null ? " DOH " + r.doh : "") + '</td><td class="r">' + fmtN(r.i) + '</td></tr>'; }).join("") || '<tr><td colspan="10" class="tw-muted">Nothing matches.</td></tr>';
        $("scFoot").textContent = rows.length + " rows" + (rows.length > 500 ? " (first 500)" : "");
      }
      box.querySelectorAll("[data-lv]").forEach(function (b) { b.onclick = function () { scLevel = b.getAttribute("data-lv"); ctlScores(box); }; });
      $("scQ").oninput = function () { scQ = this.value; draw(); }; $("scDec").onchange = function () { scDec = this.checked; draw(); };
      if (!CFG) api("loopConfig").then(function (j2) { CFG = j2.config; DEF = j2.defaults; REASONS = j2.reasons; TEAMS = j2.teams || []; SECTEAM = j2.sectionTeam || {}; draw(); });
      draw();
    });
  }
  function ctlRuns(box) {
    return api("loopRunInfo").then(function (j) {
      var last = j.last || {};
      box.innerHTML = '<div class="tw-card"><h3>Engine</h3><div class="tw-row"><span>' + (j.running ? "Running now…" : last.at ? "Last run " + esc(new Date(last.at).toLocaleString()) + (last.ok === false ? " — FAILED" : "") : "Not run yet") + '</span><span class="lp-grow"></span><button class="btn btn-primary" id="lpRun2">Run now</button></div>' +
        (last.stats ? '<div class="tw-kv" style="margin-top:12px">' + [["Main rows", fmtN(last.stats.rows)], ["Dates", last.stats.minDate + " → " + last.stats.maxDate], ["D0 (as of)", last.stats.asOf], ["SKUs / merchants / matches", fmtN(last.stats.skus) + " / " + fmtN(last.stats.merchants) + " / " + fmtN(last.stats.matches)], ["Duplicate rows dropped", fmtN(last.stats.dupes)], ["Lock rows", last.stats.locks == null ? "not read" : fmtN(last.stats.locks)]].map(function (x) { return '<div><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join("") + '</div>' : "") +
        ((last.warnings || []).length ? '<h3 style="margin-top:14px">Data guards</h3><ul class="lp-warn">' + last.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>" : "") + (last.error ? '<div class="tw-msg err">' + esc(last.error) + '</div>' : "") + '<div class="tw-msg" id="lpRunMsg2"></div></div>' +
        '<div class="tw-card"><h3>Run history</h3><table class="tw-table"><thead><tr><th>When</th><th>Why</th><th class="r">ms</th><th class="r">New</th><th class="r">Cleared</th><th class="r">Resolved</th><th class="r">Escalated</th><th>Result</th></tr></thead><tbody>' +
        (j.runs || []).map(function (r) { return '<tr><td>' + esc(new Date(r.at).toLocaleString()) + '</td><td>' + esc(r.why + (r.by && r.by !== "system" ? " · " + r.by : "")) + '</td><td class="r">' + fmtN(r.ms) + '</td><td class="r">' + fmtN(r.created) + '</td><td class="r">' + fmtN(r.cleared) + '</td><td class="r">' + fmtN(r.resolved) + '</td><td class="r">' + fmtN(r.escalated) + '</td><td>' + (r.ok ? '<span class="tw-pill good">ok</span>' + (r.warnings ? ' <span class="tw-muted">' + r.warnings + ' warning(s)</span>' : "") : '<span class="tw-pill bad">failed</span> ' + esc(r.error)) + '</td></tr>'; }).join("") + '</tbody></table></div>';
      $("lpRun2").onclick = function () { runNow($("lpRunMsg2"), function () { ctlRuns(box); }); };
    });
  }

  // ---- settings forms (every number of the loop)
  function g(o, path) { return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function s(o, path, v) { var ks = path.split("."), last = ks.pop(), t = ks.reduce(function (a, k) { return a[k] = a[k] || {}; }, o); t[last] = v; }
  function numF(path, label, help, step) { var v = g(CFG, path), d = g(DEF, path); return '<div class="tw-field"><label>' + esc(label) + '</label><input type="number" step="' + (step || "any") + '" data-p="' + path + '" data-t="n" value="' + esc(v) + '"><div class="tw-muted">' + esc(help || "") + (d !== undefined && d !== v ? ' <span class="lp-def">default ' + esc(d) + '</span>' : "") + '</div></div>'; }
  function boolF(path, label, help) { return '<div class="tw-field lp-bool"><label class="tw-sw"><input type="checkbox" data-p="' + path + '" data-t="b"' + (g(CFG, path) ? " checked" : "") + '><span></span></label><div><b>' + esc(label) + '</b><div class="tw-muted">' + esc(help || "") + '</div></div></div>'; }
  function winF(path, label, help) { var w = g(CFG, path); return '<div class="tw-field"><label>' + esc(label) + '</label><div class="lp-win">Recent D<input type="number" min="1" max="13" data-p="' + path + '.r.0" data-t="n" value="' + w.r[0] + '">→D<input type="number" min="1" max="13" data-p="' + path + '.r.1" data-t="n" value="' + w.r[1] + '"> vs history D<input type="number" min="1" max="13" data-p="' + path + '.h.0" data-t="n" value="' + w.h[0] + '">→D<input type="number" min="1" max="13" data-p="' + path + '.h.1" data-t="n" value="' + w.h[1] + '"></div><div class="tw-muted">' + esc(help || "") + '</div></div>'; }
  function txtF(path, label, help) { var v = g(CFG, path); return '<div class="tw-field"><label>' + esc(label) + '</label><input data-p="' + path + '" data-t="list" value="' + esc((v || []).join(", ")) + '"><div class="tw-muted">' + esc(help || "") + '</div></div>'; }
  function card2(title, inner, sub) { return '<div class="tw-card"><h3>' + esc(title) + '</h3>' + (sub ? '<div class="tw-muted">' + esc(sub) + '</div>' : "") + inner + '</div>'; }
  function ctlSettings(box, tab) {
    var html = "";
    if (tab === "scoring") html = '<div class="tw-grid2">' +
      card2("Decline rule", numF("scoring.threshold", "Declined when score is below", "Score = recent ÷ own history × 100. 100 = same as usual.") + numF("scoring.watchHigh", "Recovered / healthy at", "Used for the 'performance is back' merchant notification and the watch band.") + numF("tasks.recoverScore", "Follow-up passes when score ≥", "At D+follow-up the task closes as recovered, or reopens and escalates.")) +
      card2("Guards", numF("scoring.minVolume", "Minimum placed pieces / day in history", "Below this = LOW_VOLUME, not scored.") + numF("scoring.minHistoryDays", "Minimum active history days", "Fewer = NEW, not scored.") + numF("scoring.rowCapAlert", "Alert if Main has exactly this many rows", "A round total can mean the source query is capped.") + numF("engine.staleDataDays", "Warn when Main is behind by (days)", "")) +
      card2("Windows (D1 = yesterday, D0 never used)", winF("scoring.windows.demand", "Placed demand") + winF("scoring.windows.cr", "CR %") + winF("scoring.windows.dr", "DR % (matured — keep the cutoff)", "D1–D5 are not delivered yet.") + winF("scoring.windows.cm3", "CM3 (matured)")) +
      card2("Scores in use", boolF("scoring.metrics.demand", "Placed demand") + boolF("scoring.metrics.cr", "CR %") + boolF("scoring.metrics.dr", "DR %") + boolF("scoring.metrics.cm3", "CM3")) + '</div>';
    if (tab === "diagnose") html = '<div class="tw-grid2">' +
      card2("Stock", numF("diagnose.dohLow", "Stock task when DOH is below (days)", "Supply Chain (Planner DOH) gets a task.") + numF("diagnose.dohWindowDays", "DOH = stock ÷ avg confirmed pieces of the last (days)", "Same method as the merchant portal Inventory page.") + numF("diagnose.dohRecovered", "Stock counts as back at DOH ≥", "Closes the stock task and starts the relaunch tasks.") + numF("diagnose.minActiveDemand", "Only SKUs with at least (pcs/day)", "") + boolF("diagnose.proactiveStock", "Raise stock tasks before any drop", "Off = only when the SKU already declined.")) +
      card2("Locks", numF("diagnose.lockCoverDays", "Lock task when the lock covers ≤ (days)", "Remaining ÷ merchant's avg CONFIRMED pieces/day.") + numF("diagnose.lockAvgDays", "Average confirmed pieces over (days)", "") + numF("diagnose.lockExpiryDays", "Lock expiring within (days)", "") + boolF("diagnose.proactiveLock", "Raise lock tasks before any drop", "")) +
      card2("Product overall vs partial (CR / DR / demand)", numF("diagnose.skuWideShare", "Product-wide when the drop covers ≥ (% of volume)", "→ Commercial (CR/DR) or Marketplace (demand). Below → each ACM gets their merchants.") + numF("diagnose.skuWideMinMerchants", "…and at least (merchants)", "") + boolF("diagnose.partialWatch", "Keep a watch for partial drops", "Shows to the product team without a task / SLA.") + numF("diagnose.priceLookbackDays", "Price change counts for (days)", "Needs Products Info with a PRICE column.")) +
      card2("Fewer, more important tasks", numF("tasks.minImpact", "Minimum EGP/day at stake", "Below this → no task. Lock requests and manual tasks are always kept.") + numF("tasks.confirmDays", "Drop must show on (days in a row)", "2 = the same drop one day earlier too (ignores one bad day). 1 = off.") + numF("tasks.maxNewPerRun", "Max new tasks per run", "Biggest EGP/day first; the rest wait for the next run. 0 = no limit.") + numF("diagnose.merchantDropMinSkus", "Merchant drop needs (SKUs)", "1 = one task per merchant even if a single SKU explains it.")) +
      card2("Overall tasks", numF("diagnose.ppmFixPct", "PPM / piece below (% of the category target)", "→ PPM task for Commercial. Target = 'Target PPM Pieces' in Category Targets.") + numF("diagnose.ppmMinDelivered", "…with at least (delivered pieces in 7 days)", "") + numF("diagnose.categoryMinMerchants", "Category task needs (active merchants)", "Category down overall → Commercial.") + numF("diagnose.acmMinMerchants", "ACM task needs (active merchants)", "ACM portfolio down overall → that ACM.")) +
      card2("Tasks", numF("tasks.followUpDays", "Follow-up after (days)", "Re-score on that day.") + numF("tasks.escalateLevel2", "Escalate to Admin / Country Manager after (× SLA)", "") + numF("tasks.maxPerPerson", "Tasks shown per person before 'show all'", "") + numF("tasks.dismissDays", "A dismissed task stays quiet for (days)", "") +
        boolF("tasks.autoClearUntouched", "Close untouched tasks when the condition is gone", "") + boolF("tasks.chainRelaunch", "Stock back → relaunch task for each ACM", "") + boolF("tasks.notifyNewTasks", "Bell notification for new tasks", "") + boolF("tasks.notifyEscalations", "Bell notification for late / escalated", "")) +
      card2("Schedule", txtF("engine.runHours", "Run at (Cairo hours, comma separated)", "e.g. 10, 15") + boolF("engine.enabled", "Engine on", "Off = no runs, no new tasks, no merchant notifications.")) + '</div>';
    if (tab === "routing") {
      var secOpts = C.viewOptions().map(function (o) { return { id: C.viewNav[o.view], label: o.label }; });
      html = card2("Who gets what", '<div class="tw-scroll"><table class="tw-table lp-route"><thead><tr><th>On</th><th>Reason</th><th>Section</th><th>Team (owners = this role in Users & Roles)</th><th>By ACM</th><th>SLA h</th><th>Playbook actions (comma separated)</th></tr></thead><tbody>' +
        Object.keys(CFG.routing).map(function (r) { var x = CFG.routing[r], p = "routing." + r; return '<tr><td><label class="tw-sw"><input type="checkbox" data-p="' + p + '.enabled" data-t="b"' + (x.enabled !== false ? " checked" : "") + '><span></span></label></td><td><b>' + esc((REASONS[r] || {}).label || r) + '</b><div class="tw-muted">' + esc(r) + '</div></td><td><select data-p="' + p + '.section" data-t="s">' + secOpts.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === x.section ? " selected" : "") + '>' + esc(o.label) + '</option>'; }).join("") + '</select></td><td><select data-p="' + p + '.team" data-t="s"><option value="">Auto — ' + esc(SECTEAM[x.section] || "page access") + '</option>' + TEAMS.map(function (t) { return '<option value="' + esc(t) + '"' + (t === x.team ? " selected" : "") + '>' + esc(t) + '</option>'; }).join("") + '</select></td><td><label class="tw-sw"><input type="checkbox" data-p="' + p + '.byAcm" data-t="b"' + (x.byAcm ? " checked" : "") + '><span></span></label></td><td><input type="number" min="0" data-p="' + p + '.sla" data-t="n" value="' + esc(x.sla) + '" style="width:80px"></td><td><input data-p="' + p + '.actions" data-t="list" value="' + esc((x.actions || []).join(", ")) + '"></td></tr>'; }).join("") +
        '</tbody></table></div>', "The task goes to the team that owns its section (e.g. Availability Locking → Marketplace): everyone whose role in Users & Roles is that team. Page access alone does not make you an owner. If nobody has that role, everyone who can open the page gets it. 'By ACM' = only the person whose 'Linked ACM account' matches the merchant's ACM.");
    }
    if (tab === "merchant") {
      var R = "merchant.rules.";
      html = '<div class="tw-grid2">' +
        card2("General", boolF("merchant.enabled", "Notifications in the merchant portal", "Off = merchants see no automatic notifications.") + winF("merchant.window", "Drop window for merchants", "Smoother than the ACM window so a single quiet day does not alert.") + numF("merchant.minVolume", "Minimum pieces/day to notify", "") + numF("merchant.maxNewPerDay", "Max new notifications per merchant per day", "") + numF("merchant.cooldownDays", "Cooldown before the same notification again (days)", "") + numF("merchant.muteDays", "'Not interested' mutes a SKU for (days)", "")) +
        card2("Drops", boolF(R + "N1.on", "N1 · Demand dropped on a SKU", "") + numF(R + "N1.critical", "N1 critical below score", "") + boolF(R + "N2.on", "N2 · Confirmation rate dropped", "") + numF(R + "N2.critical", "N2 critical below score", "") + boolF(R + "N8.on", "N8 · Performance is back", "") + numF(R + "N8.score", "N8 when score ≥", "")) +
        card2("Stock", boolF(R + "N3.on", "N3 · Stock running out", "") + numF(R + "N3.days", "N3 when DOH below (days)", "") + numF(R + "N3.critical", "N3 critical below (days)", "") + boolF(R + "N4.on", "N4 · Out of stock", "") + boolF(R + "N7.on", "N7 · Back in stock", "") + numF(R + "N7.doh", "N7 when DOH ≥", "") + boolF("merchant.alternatives.on", "Suggest alternatives", "Same category, healthy stock, not locked.") + numF("merchant.alternatives.minDoh", "Alternatives need DOH ≥", "") + numF("merchant.alternatives.max", "How many alternatives", "")) +
        card2("Locks", boolF(R + "N5.on", "N5 · Lock needs an update", "") + numF(R + "N5.coverDays", "N5 when the lock covers ≤ (days)", "Remaining ÷ avg CONFIRMED pieces/day") + numF(R + "N5.critical", "N5 critical at ≤ (days)", "") + boolF(R + "N6.on", "N6 · Lock expiry date close", "") + numF(R + "N6.days", "N6 within (days)", "") + boolF("merchant.lockRequests", "Merchants can ask for a lock update", "Creates a task in Availability Locking.") + numF("merchant.lockSuggestDays", "Suggested quantity = avg × (days) − remaining", "")) + '</div>';
    }
    if (tab === "cpa") html = '<div class="tw-grid2">' +
      card2("Max CPA math", numF("cpa.shipping", "Shipping fee the customer pays (EGP)", "Margin / piece = AVE Market − this fee − (Selling price − Profit). Empty AVE Market → the product's Placed ASP.") + numF("cpa.safetyPct", "Safety margin (%)", "Safe CPA = Max CPA × (1 − this %). Below Safe CPA = 'Profitable', between Safe and Max = 'Thin margin'.")) +
      card2("Where CR / DR come from", numF("cpa.rateDays", "Merchant's own rates over the last (days) — dashboard", "The portal uses the last 14 days.") + numF("cpa.minOwnPieces", "Use the merchant's own rates from (placed pieces)", "Below this, the product's average is used.") + boolF("cpa.showProductAverages", "Show product averages to merchants", "Off = merchants only see their own rates (or type them).")) +
      card2("Merchant portal", boolF("cpa.portal", "RE-CPA tab in the merchant portal", "Merchants' saved plans show up in Merchants → RE-CPA → Merchant's own plan.")) + '</div>';
    if (tab === "exclusions") {
      var ex = function (kind, title) { var list = CFG.exclusions[kind] || []; return card2(title, '<table class="tw-table"><thead><tr><th>ID</th><th>Until (empty = always)</th><th>Note</th><th></th></tr></thead><tbody>' + list.map(function (x, i) { return '<tr><td><input data-ex="' + kind + '" data-i="' + i + '" data-f="id" value="' + esc(x.id) + '"></td><td><input type="date" data-ex="' + kind + '" data-i="' + i + '" data-f="until" value="' + esc(x.until || "") + '"></td><td><input data-ex="' + kind + '" data-i="' + i + '" data-f="note" value="' + esc(x.note || "") + '"></td><td><button class="btn small" data-rm="' + kind + '" data-i="' + i + '">Remove</button></td></tr>'; }).join("") + '</tbody></table><button class="btn small" data-add="' + kind + '" style="margin-top:10px">+ Add</button>', "Excluded entities get no tasks and no merchant notifications."); };
      html = '<div class="tw-grid2">' + ex("skus", "Excluded SKUs") + ex("merchants", "Excluded merchants") + '</div>';
    }
    box.innerHTML = html + '<div class="tw-savebar"><button class="btn btn-primary" id="lpSave">Save</button><button class="btn" id="lpReset">Reset everything to defaults</button><span class="tw-msg" id="lpSaveMsg"></span>' + (CFG.updatedAt ? '<span class="tw-muted">Last saved ' + esc(ago(CFG.updatedAt)) + (CFG.updatedBy ? " by " + esc(CFG.updatedBy) : "") + '</span>' : "") + '</div>';
    box.querySelectorAll("[data-add]").forEach(function (b) { b.onclick = function () { read(); CFG.exclusions[b.getAttribute("data-add")].push({ id: "", until: "", note: "" }); ctlSettings(box, tab); }; });
    box.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { read(); CFG.exclusions[b.getAttribute("data-rm")].splice(+b.getAttribute("data-i"), 1); ctlSettings(box, tab); }; });
    function read() {
      box.querySelectorAll("[data-p]").forEach(function (el) {
        var p = el.getAttribute("data-p"), t = el.getAttribute("data-t"), v;
        if (t === "b") v = el.checked; else if (t === "n") v = el.value === "" ? g(DEF, p) : +el.value; else if (t === "list") { v = el.value.split(",").map(function (x) { return x.trim(); }).filter(Boolean); if (p === "engine.runHours") v = v.map(Number); } else v = el.value;
        s(CFG, p, v);
      });
      box.querySelectorAll("[data-ex]").forEach(function (el) { var k = el.getAttribute("data-ex"), i = +el.getAttribute("data-i"); CFG.exclusions[k][i][el.getAttribute("data-f")] = el.value.trim(); });
    }
    $("lpSave").onclick = function () {
      read(); var m = $("lpSaveMsg"); m.className = "tw-msg"; m.textContent = "Saving…";
      CFG.exclusions.skus = CFG.exclusions.skus.filter(function (x) { return x.id; }); CFG.exclusions.merchants = CFG.exclusions.merchants.filter(function (x) { return x.id; });
      api("loopConfigPut", { config: CFG }).then(function (j) { CFG = j.config; m.className = "tw-msg ok"; m.textContent = "Saved ✓ — applies from the next engine run (Engine → Run now to apply right away)."; C.logActivity("settings", "Command Loop settings saved", TABS.filter(function (t) { return t[0] === tab; })[0][1]); })
        .catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message; });
    };
    $("lpReset").onclick = function () { if (!confirm("Reset ALL Command Loop settings (scoring, routing, merchant notifications, exclusions) to the defaults?")) return; api("loopConfigReset", {}).then(function () { CFG = null; C.logActivity("settings", "Command Loop settings reset to defaults"); renderControl($("viewLoopControl")); }); };
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    C = window.TowerCore; if (!C || !C.registerView || !$("towerSubmenu")) { setTimeout(boot, 300); return; }
    C.registerView("loopTasks", { sectionId: "viewLoopTasks", navId: "navLoopTasks", label: "My Tasks", sub: "Your tasks from the Command Loop", open: true, render: renderMyTasks });
    C.registerView("loopControl", { sectionId: "viewLoopControl", navId: "navLoopControl", label: "Command Loop", sub: "Scores, routing, merchant notifications and every task — Admin / Country Manager", render: renderControl });
    try { C.applyNav && C.applyNav(); } catch (e) {}
    var orig = window.switchView;
    if (orig && !orig.__lp) {
      var w = function (name) { var r = orig.apply(this, arguments); setTimeout(function () { try { stripFor(name); } catch (e) {} }, 80); return r; };
      w.__lp = true; window.switchView = w;
    }
    // badge + strip for the page we opened on
    setTimeout(function () { var v = window.__ENTRY_VIEW; if (v) stripFor(v); }, 2500);
    api("loopTasks", undefined, "&scope=mine").then(function (j) { updateBadge(j.tasks); ME = { isAdmin: C.isRealAdmin && C.isRealAdmin() }; }).catch(function () {});
    ME = { isAdmin: C.isRealAdmin && C.isRealAdmin() };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 200); }); else setTimeout(boot, 200);
})();
