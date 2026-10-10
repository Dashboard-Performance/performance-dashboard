/* Taager Alerts Centre + Notifications bell (v1.6.0). Needs tower.js (window.TowerCore). */
(function () {
  "use strict";
  var C = null, alerts = [], seen = null, firstLoad = true;
  var READ_LS = "twAlertsRead";
  function $(id) { return document.getElementById(id); }
  function readSet() { try { return JSON.parse(C.ls(READ_LS) || "[]"); } catch (e) { return []; } }
  function saveRead(a) { C.ls(READ_LS, JSON.stringify(a.slice(-400))); }
  function ago(iso) { var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; var h = Math.round(m / 60); if (h < 24) return h + "h ago"; return Math.round(h / 24) + "d ago"; }
  function sevColor(s) { return s === "critical" ? "bad" : s === "warning" ? "warn" : "good"; }
  function toast(msg, kind) {
    var t = document.createElement("div"); t.className = "tw-toast " + (kind || ""); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3500); setTimeout(function () { t.remove(); }, 4000);
  }

  // ------------------------------------------------------------------ bell + popover
  function injectBell() {
    if ($("twBell")) return;
    var host = document.querySelector(".topbar-actions"); if (!host) return;
    var wrap = document.createElement("div"); wrap.className = "tw-bellwrap";
    wrap.innerHTML = '<button type="button" class="btn tw-bell" id="twBell" aria-label="Notifications"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span class="tw-badge tw-off" id="twBadge">0</span></button><div class="tw-pop tw-off" id="twPop"></div>';
    host.insertBefore(wrap, host.firstChild);
    $("twBell").addEventListener("click", function (e) { e.stopPropagation(); $("twPop").classList.toggle("tw-off"); renderPop(); });
    document.addEventListener("click", function (e) { var p = $("twPop"); if (p && !p.contains(e.target)) p.classList.add("tw-off"); });
  }
  function unreadCount() { var r = readSet(); return alerts.filter(function (a) { return r.indexOf(a.id) < 0; }).length; }
  function renderBadge() { var b = $("twBadge"); if (!b) return; var n = unreadCount(); b.textContent = n > 9 ? "9+" : String(n); b.classList.toggle("tw-off", n === 0); }
  function renderPop() {
    var p = $("twPop"); if (!p || p.classList.contains("tw-off")) return;
    var r = readSet();
    p.innerHTML = '<div class="tw-pop-head"><b>Notifications</b><button type="button" class="btn small ghost" id="twMarkAll">Mark all read</button></div>' +
      '<div class="tw-pop-list">' + (alerts.length ? alerts.slice(0, 20).map(function (a) {
        var unread = r.indexOf(a.id) < 0;
        return '<div class="tw-note' + (unread ? " unread" : "") + '" data-id="' + a.id + '"><i class="dot ' + sevColor(a.severity) + '"></i><div class="tw-note-body"><div class="tw-note-title">' + C.esc(a.title) + '</div><div class="tw-note-text">' + C.esc(a.body) + '</div>' +
          '<div class="tw-note-meta">' + (a.about ? '<span class="tw-pill">' + C.esc(a.about.type) + ': ' + C.esc(a.about.label) + '</span>' : "") + '<span>' + ago(a.at) + '</span>' + (a.link ? '<button type="button" class="btn small" data-open="' + C.esc(a.link) + '">Open</button>' : "") + '</div></div></div>';
      }).join("") : '<div class="tw-empty">No notifications yet.</div>') + '</div>';
    $("twMarkAll").onclick = function () { saveRead(readSet().concat(alerts.map(function (a) { return a.id; }))); renderBadge(); renderPop(); };
    p.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { var v = b.dataset.open; p.classList.add("tw-off"); window.switchView(v); }; });
    p.querySelectorAll(".tw-note").forEach(function (n) { n.onclick = function () { var id = n.dataset.id, rr = readSet(); if (rr.indexOf(id) < 0) { rr.push(id); saveRead(rr); n.classList.remove("unread"); renderBadge(); } }; });
  }
  function poll() {
    var s = C.session(); if (!s) return;
    C.wfetch("getAlerts", { timeout: 8000 }, "&email=" + encodeURIComponent(s.email) + "&role=" + encodeURIComponent(C.realRoleName())).then(function (j) {
      if (!j || !j.alerts) return;
      var before = seen || {}, fresh = j.alerts.filter(function (a) { return !before[a.id]; });
      alerts = j.alerts; seen = {}; alerts.forEach(function (a) { seen[a.id] = 1; });
      if (!firstLoad) { var r = readSet(); fresh.filter(function (a) { return r.indexOf(a.id) < 0; }).slice(0, 2).forEach(function (a) { toast("🔔 " + a.title, a.severity === "critical" ? "bad" : ""); }); }
      var wasFirst = firstLoad; firstLoad = false; renderBadge(); renderPop();
      if (wasFirst && unreadCount() > 0) setTimeout(function () { var p = $("twPop"); if (p) { p.classList.remove("tw-off"); renderPop(); } }, 900);
    }).catch(function () {});
  }

  // ------------------------------------------------------------------ Alerts Centre page
  var TEMPLATES = [
    { id: "decline", name: "Merchant decline rate is high", severity: "warning", title: "Decline rate is high — please follow up", body: "The decline rate for this merchant is above the limit. Please contact the merchant today and share the plan." },
    { id: "pacing", name: "Target pacing behind", severity: "warning", title: "Target pacing is behind", body: "Current run rate is below the monthly target. Please review the plan and share what will close the gap." },
    { id: "ndr", name: "NDR below floor", severity: "critical", title: "NDR is below the floor", body: "Net delivery rate dropped below the agreed minimum. Please check cancellations and returns and report back." },
    { id: "ann", name: "General announcement", severity: "info", title: "", body: "" }
  ];
  var st = { sev: "warning", all: false, roles: {}, users: {}, aboutType: "General", aboutLabel: "", alsoAcm: false, link: "", title: "", body: "", q: "" };
  var usersList = [];
  function statsNames(type) {
    try { if (type === "Merchant") return Array.from(new Set((state.merchantTableData || []).map(function (m) { return m.name; }))).filter(Boolean).slice(0, 3000); if (type === "ACM") return Array.from(new Set((state.acmTableData || []).map(function (m) { return m.name; }))).filter(Boolean); } catch (e) {}
    return [];
  }
  function acmOfMerchant(label) { try { var l = String(label).trim().toLowerCase(); var m = (state.merchantTableData || []).filter(function (x) { return String(x.name).toLowerCase() === l || String(x.id) === label.trim(); })[0]; return m ? m.acm : ""; } catch (e) { return ""; } }
  function userByName(name) { try { var cu = C.getCfg().users || {}; var k = Object.keys(cu).filter(function (e) { return cu[e] && cu[e].acm === name && cu[e].status !== "inactive"; })[0]; if (k) return { email: k, name: cu[k].name || name, role: cu[k].role }; } catch (e) {} return userByName2(name); }
  function userByName2(name) { var n = String(name || "").trim().toLowerCase(); return usersList.filter(function (u) { return u.name.trim().toLowerCase() === n; })[0] || null; }
  function recipientCount() {
    if (st.all) return "everyone";
    var ids = {}; Object.keys(st.users).forEach(function (e) { if (st.users[e]) ids[e] = 1; });
    var n = Object.keys(ids).length, roles = Object.keys(st.roles).filter(function (r) { return st.roles[r]; });
    return n + " people" + (roles.length ? " + role" + (roles.length > 1 ? "s" : "") + " " + roles.join(", ") : "");
  }
  function renderCompose(host) {
    var roles = Object.keys(C.getCfg().roles);
    var views = C.viewOptions();
    var peopleHtml = usersList.filter(function (u) { var q = st.q.toLowerCase(); return !q || (u.name + " " + u.email).toLowerCase().indexOf(q) >= 0; }).slice(0, 300).map(function (u) {
      return '<label class="tw-check"><input type="checkbox" data-user="' + C.esc(u.email) + '"' + (st.users[u.email] ? " checked" : "") + '> ' + C.esc(u.name || u.email) + ' <span class="tw-muted">' + C.esc(u.role || "") + '</span></label>';
    }).join("") || '<div class="tw-muted">No users loaded.</div>';
    host.innerHTML = '<div>' +
      '<div class="tw-card"><h3>New alert</h3><div class="tw-form">' +
      '<div class="tw-field"><label>Start from a template</label><select id="alTpl"><option value="">—</option>' + TEMPLATES.map(function (t) { return '<option value="' + t.id + '">' + C.esc(t.name) + '</option>'; }).join("") + '</select></div>' +
      '<div class="tw-field"><label>Send to</label><label class="tw-check"><input type="checkbox" id="alAll"' + (st.all ? " checked" : "") + '> Everyone</label>' +
      '<div class="tw-chips' + (st.all ? " dis" : "") + '">' + roles.map(function (r) { return '<label class="tw-chip' + (st.roles[r] ? " on" : "") + '"><input type="checkbox" data-role="' + C.esc(r) + '"' + (st.roles[r] ? " checked" : "") + ' hidden>' + C.esc(r) + '</label>'; }).join("") + '</div>' +
      '<input type="search" id="alQ" placeholder="Find people…" value="' + C.esc(st.q) + '" style="margin-top:8px;min-height:34px;padding:0 10px"><div class="tw-people' + (st.all ? " dis" : "") + '">' + peopleHtml + '</div></div>' +
      '<div class="tw-field"><label>About (optional)</label><div class="tw-row"><select id="alType" style="min-height:36px;padding:0 10px">' + ["General", "Merchant", "ACM", "SKU", "Page"].map(function (t) { return '<option' + (t === st.aboutType ? " selected" : "") + '>' + t + '</option>'; }).join("") + '</select>' +
      '<input id="alAbout" list="alNames" placeholder="Name or ID" value="' + C.esc(st.aboutLabel) + '" style="min-height:36px;padding:0 10px;min-width:260px"><datalist id="alNames">' + statsNames(st.aboutType).map(function (n) { return '<option value="' + C.esc(n) + '">'; }).join("") + '</datalist></div>' +
      (st.aboutType === "Merchant" ? '<label class="tw-check"><input type="checkbox" id="alAcm"' + (st.alsoAcm ? " checked" : "") + '> Also notify the ACM responsible for this merchant</label><div class="tw-muted" id="alAcmInfo"></div>' : "") + '</div>' +
      '<div class="tw-field"><label>Open page (optional button in the notification)</label><select id="alLink" style="min-height:36px;padding:0 10px"><option value="">— none —</option>' + views.map(function (v) { return '<option value="' + v.view + '"' + (st.link === v.view ? " selected" : "") + '>' + C.esc(v.label) + '</option>'; }).join("") + '</select></div>' +
      '<div class="tw-field"><label>Severity</label><div class="tw-tabgroup">' + ["info", "warning", "critical"].map(function (v) { return '<button type="button" class="tw-tab' + (st.sev === v ? " on" : "") + '" data-sev="' + v + '">' + v[0].toUpperCase() + v.slice(1) + '</button>'; }).join("") + '</div></div>' +
      '<div class="tw-field"><label>Title</label><input id="alTitle" type="text" placeholder="Short, specific headline" value="' + C.esc(st.title) + '" style="min-height:38px;padding:0 10px;width:100%"></div>' +
      '<div class="tw-field"><label>Message</label><textarea id="alBody" rows="4" placeholder="What happened, what you need, by when" style="width:100%;padding:10px">' + C.esc(st.body) + '</textarea></div>' +
      '<div class="tw-row"><button class="btn btn-primary" id="alSend">Send alert</button><span class="tw-muted" id="alCount"></span><span class="tw-msg" id="alMsg"></span></div></div></div>' +
      '</div>';
    var cnt = function () { $("alCount").textContent = "To: " + recipientCount(); };
    var keepFocus = function (fn) { return function (e) { fn(e); }; };
    $("alTpl").onchange = function (e) { var t = TEMPLATES.filter(function (x) { return x.id === e.target.value; })[0]; if (!t) return; st.title = t.title; st.body = t.body; st.sev = t.severity; renderCompose(host); };
    $("alAll").onchange = function (e) { st.all = e.target.checked; renderCompose(host); };
    host.querySelectorAll("[data-role]").forEach(function (c) { c.onchange = function () { st.roles[c.dataset.role] = c.checked; c.parentNode.classList.toggle("on", c.checked); cnt(); }; });
    host.querySelectorAll("[data-user]").forEach(function (c) { c.onchange = function () { st.users[c.dataset.user] = c.checked; cnt(); }; });
    $("alQ").oninput = function (e) { st.q = e.target.value; var pos = e.target.selectionStart; syncFields(); renderCompose(host); var q = $("alQ"); q.focus(); q.setSelectionRange(pos, pos); };
    $("alType").onchange = function (e) { syncFields(); st.aboutType = e.target.value; renderCompose(host); };
    host.querySelectorAll("[data-sev]").forEach(function (b) { b.onclick = function () { syncFields(); st.sev = b.dataset.sev; renderCompose(host); }; });
    var acm = $("alAcm"); if (acm) { acm.onchange = function () { st.alsoAcm = acm.checked; updAcm(); }; }
    function syncFields() { st.title = $("alTitle").value; st.body = $("alBody").value; st.aboutLabel = $("alAbout").value; st.link = $("alLink").value; }
    function updAcm() { var i = $("alAcmInfo"); if (!i) return; if (!st.alsoAcm) { i.textContent = ""; return; } var a = acmOfMerchant($("alAbout").value); var u = a && userByName(a); i.textContent = !a ? "Merchant not found in the loaded data — pick a merchant from the list." : (u ? "Will also go to " + a + " (" + u.email + ")." : "ACM is " + a + " but no dashboard user has exactly that name — add them to the list above."); }
    $("alAbout").oninput = updAcm; updAcm(); cnt();
    $("alSend").onclick = function () {
      syncFields(); var m = $("alMsg"); m.className = "tw-msg";
      var users = Object.keys(st.users).filter(function (e) { return st.users[e]; });
      if (st.aboutType === "Merchant" && st.alsoAcm) { var a = acmOfMerchant(st.aboutLabel), u = a && userByName(a); if (u && users.indexOf(u.email) < 0) users.push(u.email); }
      var roles = Object.keys(st.roles).filter(function (r) { return st.roles[r]; });
      if (!C.adminKey()) { m.className = "tw-msg err"; m.textContent = "Save the admin key first (Users & Roles page)."; return; }
      if (!st.title.trim() || !st.body.trim()) { m.className = "tw-msg err"; m.textContent = "Add a title and a message."; return; }
      if (!st.all && !users.length && !roles.length) { m.className = "tw-msg err"; m.textContent = "Pick at least one recipient."; return; }
      m.textContent = "Sending…";
      var payload = { title: st.title, body: st.body, severity: st.sev, audience: { all: st.all, roles: st.all ? [] : roles, users: st.all ? [] : users }, about: st.aboutLabel.trim() && st.aboutType !== "General" ? { type: st.aboutType, label: st.aboutLabel.trim() } : (st.aboutLabel.trim() ? { type: "General", label: st.aboutLabel.trim() } : null), link: st.link, by: (C.session() || {}).email || "" };
      C.wfetch("sendAlert", { body: JSON.stringify(payload) }).then(function () {
        st.title = ""; st.body = ""; st.aboutLabel = ""; st.alsoAcm = false; st.link = "";
        composeOpen = false; tab = "sent"; renderPage(pageHost); toast("Alert sent ✓"); poll();
      }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message + (e.status === 403 ? " — wrong admin key." : ""); });
    };
  }
  // ------------------------------------------------------------------ page shell: tabs (Inbox / All broadcasts / Rules & checks)
  var tab = "inbox", composeOpen = false, pageHost = null;
  function sevPill(s) { return '<span class="tw-pill ' + sevColor(s) + '">' + C.esc(s) + '</span>'; }
  function renderPage(host) {
    pageHost = host;
    var tabs = [["inbox", "Inbox"], ["sent", "All broadcasts"], ["rules", "Rules & checks"]].map(function (t) { return '<button class="tw-ut' + (tab === t[0] ? " on" : "") + '" data-at="' + t[0] + '">' + t[1] + (t[0] === "inbox" && unreadCount() ? ' <span class="tw-ubadge">' + unreadCount() + '</span>' : "") + '</button>'; }).join("");
    host.innerHTML = '<div class="tw-page"><div class="tw-toolbar"><span class="tw-grow"></span><button class="btn btn-primary" id="alNew">+ ' + (composeOpen ? "Close" : "New alert") + '</button></div>' +
      '<div class="tw-uts">' + tabs + '</div><div id="alCompose"></div><div id="alBody"></div></div>';
    host.querySelectorAll("[data-at]").forEach(function (b) { b.onclick = function () { tab = b.dataset.at; renderPage(host); }; });
    $("alNew").onclick = function () { composeOpen = !composeOpen; renderPage(host); };
    if (composeOpen) { C.loadUsers().then(function (u) { usersList = u || []; if (composeOpen && $("alCompose")) renderCompose($("alCompose")); }).catch(function () {}); renderCompose($("alCompose")); }
    if (tab === "inbox") renderInbox($("alBody")); else if (tab === "sent") loadHistory($("alBody")); else renderRules($("alBody"));
  }
  function renderInbox(h) {
    var r = readSet();
    if (!alerts.length) { h.innerHTML = '<div class="tw-card tw-empty"><div class="tw-empty-ic">🔔</div><div>Nothing addressed to you yet.</div></div>'; return; }
    h.innerHTML = '<div class="tw-card"><div class="tw-ch"><div><h3>Addressed to you</h3><div class="tw-muted">' + alerts.length + ' alert' + (alerts.length > 1 ? "s" : "") + '</div></div><button class="btn small" id="alAllRead">Mark all read</button></div><div class="tw-timeline">' +
      alerts.map(function (a) {
        var unread = r.indexOf(a.id) < 0;
        return '<div class="tw-tl"><span class="tw-sevbar ' + sevColor(a.severity) + '"></span><div class="tw-tl-main"><div><b>' + C.esc(a.title) + '</b>' + (unread ? ' <span class="tw-new">NEW</span>' : "") + '</div><p>' + C.esc(a.body) + '</p><span class="tw-muted">' + C.esc(a.by || "Admin") + ' · ' + ago(a.at) + (a.about ? " · " + C.esc(a.about.type + ": " + a.about.label) : "") + '</span></div>' +
          '<div class="tw-tl-act">' + (a.link ? '<button class="btn small" data-open="' + C.esc(a.link) + '">Open page</button>' : "") + (unread ? '<button class="btn small" data-read="' + a.id + '">Mark read</button>' : '<span class="tw-pill">read</span>') + '</div></div>';
      }).join("") + '</div></div>';
    h.querySelectorAll("[data-read]").forEach(function (b) { b.onclick = function () { var rr = readSet(); rr.push(b.dataset.read); saveRead(rr); renderBadge(); renderPage(pageHost); }; });
    h.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { window.switchView(b.dataset.open); }; });
    $("alAllRead").onclick = function () { saveRead(readSet().concat(alerts.map(function (a) { return a.id; }))); renderBadge(); renderPage(pageHost); };
  }
  function loadHistory(h) {
    h = h || $("alBody"); if (!h) return;
    h.innerHTML = '<div class="tw-card tw-muted">Loading…</div>';
    C.wfetch("getAlerts", { admin: true, timeout: 10000 }, "&all=1").then(function (j) {
      var list = (j && j.alerts) || [];
      if (!list.length) { h.innerHTML = '<div class="tw-card tw-empty"><div class="tw-empty-ic">📣</div><div>No alerts sent yet.</div></div>'; return; }
      h.innerHTML = '<div class="tw-card"><div class="tw-ch"><div><h3>Broadcast history</h3><div class="tw-muted">Everything sent from this workspace</div></div></div><div class="tw-scroll"><table class="tw-table"><thead><tr><th>When</th><th>Alert</th><th>Severity</th><th>To</th><th>About</th><th></th></tr></thead><tbody>' + list.slice(0, 60).map(function (a) {
        var au = a.audience || {}, to = au.all ? "Everyone" : ((au.roles || []).join(", ") + ((au.users || []).length ? ((au.roles || []).length ? " + " : "") + au.users.length + " people" : ""));
        return '<tr><td>' + ago(a.at) + '</td><td><b>' + C.esc(a.title) + '</b><div class="tw-muted">' + C.esc((a.body || "").slice(0, 110)) + '</div></td><td>' + sevPill(a.severity) + '</td><td>' + C.esc(to) + '</td><td>' + (a.about ? C.esc(a.about.type + ": " + a.about.label) : "—") + '</td><td><button class="btn small danger" data-del="' + a.id + '">Delete</button></td></tr>';
      }).join("") + '</tbody></table></div></div>';
      h.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { if (!confirm("Delete this alert for everyone?")) return; C.wfetch("deleteAlert", { body: JSON.stringify({ id: b.dataset.del }) }).then(function () { loadHistory(h); poll(); }).catch(function (e) { toast(e.message, "bad"); }); }; });
    }).catch(function (e) { h.innerHTML = '<div class="tw-card"><div class="tw-msg err">' + C.esc(e.message) + (e.status === 403 ? " — set the admin key in Users & Roles → Roles." : "") + '</div></div>'; });
  }

  // ------------------------------------------------------------------ Rules & checks
  var LIMIT_LABEL = { acmNdrMin: "ACM NDR % <", acmCrMin: "ACM CR % <", acmPacingMin: "ACM GMV pacing % <", merchNdrMin: "Merchant NDR % <" };
  function renderRules(h) {
    var S = JSON.parse(JSON.stringify(C.getSettings())), roles = Object.keys(C.getCfg().roles);
    var rows = S.rules.map(function (r, i) {
      return '<div class="tw-rule"><label class="tw-sw"><input type="checkbox" data-ron="' + i + '"' + (r.on ? " checked" : "") + '><span></span></label>' +
        '<div class="tw-rule-n"><b>' + C.esc(r.name) + '</b><div class="tw-muted">' + C.esc(LIMIT_LABEL[r.limit]) + ' limit</div></div>' +
        '<div class="tw-rule-notify"><span class="tw-muted">Notify:</span> ' + roles.map(function (ro) { return '<label class="tw-mini' + (r.notify.indexOf(ro) >= 0 ? " on" : "") + '"><input type="checkbox" hidden data-rn="' + i + '|' + C.esc(ro) + '"' + (r.notify.indexOf(ro) >= 0 ? " checked" : "") + '>' + C.esc(ro) + '</label>'; }).join("") + '</div>' +
        '<input type="number" class="tw-num" data-rl="' + r.limit + '" value="' + S.thresholds[r.limit] + '"><select class="tw-sevsel" data-rs="' + i + '">' + ["info", "warning", "critical"].map(function (v) { return '<option' + (r.severity === v ? " selected" : "") + '>' + v + '</option>'; }).join("") + '</select></div>';
    }).join("");
    h.innerHTML = '<div class="tw-card"><div class="tw-ch"><div><h3>Automatic rules</h3><div class="tw-muted">Rules are evaluated on the data loaded in this dashboard. Turn them on, change the limit, choose who gets told.</div></div><button class="btn btn-primary" id="alRSave">Save rules</button></div>' + rows + '<div class="tw-msg" id="alRMsg"></div></div>' +
      '<div class="tw-card"><div class="tw-ch"><div><h3>Live rule check</h3><div class="tw-muted">Preview what would fire right now, then send it in one click.</div></div><button class="btn" id="alRun">Run check now</button></div><div id="alRes"></div></div>';
    h.querySelectorAll("[data-ron]").forEach(function (c) { c.onchange = function () { S.rules[+c.dataset.ron].on = c.checked; }; });
    h.querySelectorAll("[data-rn]").forEach(function (c) { c.onchange = function () { var p = c.dataset.rn.split("|"), r = S.rules[+p[0]]; var i = r.notify.indexOf(p[1]); if (c.checked && i < 0) r.notify.push(p[1]); if (!c.checked && i >= 0) r.notify.splice(i, 1); c.parentNode.classList.toggle("on", c.checked); }; });
    h.querySelectorAll("[data-rl]").forEach(function (c) { c.oninput = function () { S.thresholds[c.dataset.rl] = Number(c.value); }; });
    h.querySelectorAll("[data-rs]").forEach(function (c) { c.onchange = function () { S.rules[+c.dataset.rs].severity = c.value; }; });
    $("alRSave").onclick = function () { var m = $("alRMsg"); m.className = "tw-msg"; m.textContent = "Saving…"; C.saveSettings(S).then(function () { m.className = "tw-msg ok"; m.textContent = "Rules saved ✓"; }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message + (e.status === 403 ? " — set the admin key in Users & Roles → Roles." : ""); }); };
    $("alRun").onclick = function () { C.loadUsers().then(function (u) { usersList = u || []; }).catch(function () {}).then(function () { runCheck(S, $("alRes")); }); };
  }
  function runCheck(S, out) {
    var M = window.TowerMetrics, hits = [];
    var T = S.thresholds, on = {}; S.rules.forEach(function (r) { on[r.key] = r; });
    var acms = (typeof state !== "undefined" && state.acmTableData) || [], mers = (typeof state !== "undefined" && state.merchantTableData) || [];
    if (!acms.length && !mers.length) { out.innerHTML = '<div class="tw-muted" style="padding:10px 0">No data loaded yet — wait for the dashboard to finish loading, then run the check.</div>'; return; }
    function add(rule, entity, type, value, unit, limit) { hits.push({ rule: rule, entity: entity, type: type, value: Math.round(value * 10) / 10, unit: unit, limit: limit, acm: type === "ACM" ? entity : "" }); }
    acms.forEach(function (a) {
      var m = M ? M.acmRates(a.name) : { cr: a.cr, ndr: a.ndr };
      if (on["acm.ndr"] && on["acm.ndr"].on && m.ndr < T.acmNdrMin) add(on["acm.ndr"], a.name, "ACM", m.ndr, "%", T.acmNdrMin);
      if (on["acm.cr"] && on["acm.cr"].on && m.cr < T.acmCrMin) add(on["acm.cr"], a.name, "ACM", m.cr, "%", T.acmCrMin);
      if (on["acm.pacing"] && on["acm.pacing"].on && a.targetGmv > 0) { var pace = a.runRate / a.targetGmv * 100; if (pace < T.acmPacingMin) add(on["acm.pacing"], a.name, "ACM", pace, "%", T.acmPacingMin); }
    });
    if (on["merchant.ndr"] && on["merchant.ndr"].on) mers.forEach(function (m) { if ((m.placed || 0) >= 30 && m.ndr < T.merchNdrMin) hits.push({ rule: on["merchant.ndr"], entity: m.name, type: "Merchant", value: Math.round(m.ndr * 10) / 10, unit: "%", limit: T.merchNdrMin, acm: m.acm || "" }); });
    if (!hits.length) { out.innerHTML = '<div class="tw-empty" style="padding:18px 0"><div class="tw-empty-ic">✅</div><div>No rule is breached. All clear.</div></div>'; return; }
    var order = { critical: 0, warning: 1, info: 2 }; hits.sort(function (x, y) { return order[x.rule.severity] - order[y.rule.severity]; });
    out.innerHTML = '<div class="tw-scroll"><table class="tw-table"><thead><tr><th>Severity</th><th>Who / what</th><th>Rule</th><th>Value</th></tr></thead><tbody>' + hits.slice(0, 80).map(function (h) { return '<tr><td>' + sevPill(h.rule.severity) + '</td><td><b>' + C.esc(h.entity) + '</b><div class="tw-muted">' + h.type + (h.type === "Merchant" && h.acm ? " · " + C.esc(h.acm) : "") + '</div></td><td>' + C.esc(h.rule.name) + '</td><td><b>' + h.value + h.unit + '</b> <span class="tw-muted">limit ' + h.limit + h.unit + '</span></td></tr>'; }).join("") + '</tbody></table></div>' +
      '<div class="tw-row" style="margin-top:12px"><button class="btn btn-primary" id="alRSend">Send all as alerts (' + hits.length + ')</button><span class="tw-msg" id="alRSM"></span></div>';
    $("alRSend").onclick = function () {
      var groups = {}; hits.forEach(function (h) { (groups[h.rule.key] = groups[h.rule.key] || []).push(h); });
      var m = $("alRSM"); m.className = "tw-msg"; m.textContent = "Sending…"; var jobs = [];
      Object.keys(groups).forEach(function (k) {
        var g = groups[k], r = g[0].rule, ppl = [];
        g.forEach(function (h) { var u = h.acm && userByName(h.acm); if (u && ppl.indexOf(u.email) < 0) ppl.push(u.email); });
        var body = g.slice(0, 6).map(function (h) { return h.entity + " " + h.value + h.unit; }).join("; ") + (g.length > 6 ? " and " + (g.length - 6) + " more." : ".");
        jobs.push(C.wfetch("sendAlert", { body: JSON.stringify({ title: r.name + " (" + g.length + ")", body: body, severity: r.severity, audience: { all: false, roles: r.notify, users: ppl }, about: { type: "General", label: "Rule check" }, link: "", by: (C.session() || {}).email || "" }) }));
      });
      Promise.all(jobs).then(function () { toast(jobs.length + " alert(s) sent"); tab = "sent"; renderPage(pageHost); poll(); }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message + (e.status === 403 ? " — set the admin key in Users & Roles → Roles." : ""); });
    };
  }

  window.TowerAlerts = {
    compose: function (pre) {
      pre = pre || {};
      C.loadUsers().catch(function () { return []; }).then(function (u) {
        usersList = u || [];
        st.title = pre.title || ""; st.body = pre.body || ""; st.sev = pre.severity || "warning"; st.all = false; st.roles = {}; st.users = {};
        st.aboutType = pre.aboutType || "General"; st.aboutLabel = pre.aboutLabel || ""; st.alsoAcm = false; st.link = pre.link || "";
        var usr = pre.userName && userByName(pre.userName); if (usr) st.users[usr.email] = true;
        composeOpen = true; tab = "sent"; window.switchView("towerAlerts");
      });
    }
  };
  function boot() {
    C = window.TowerCore; if (!C) return;
    injectBell();
    C.registerView("towerAlerts", { sectionId: "viewTowerAlerts", navId: "navTowerAlerts", label: "Alerts Centre", sub: "Inbox, broadcasts and automatic rules",
      render: function (host) { renderPage(host); } });
    poll(); setInterval(poll, 60000);
    setInterval(injectBell, 3000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 50); }); else setTimeout(boot, 50);
})();
