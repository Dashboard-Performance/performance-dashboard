/* Usage Log (v1.17.8)
   1) Tracker (everyone who is signed in): one "session" per open dashboard tab. It records when the dashboard was opened, how long it was on screen
      ("Open") and how long somebody was really using it ("Active": mouse / keyboard / scroll in the last 30 s), which tabs were opened and for how long,
      and which tables were downloaded. A hidden tab or a sleeping computer adds nothing. A small update goes to the Worker every ~90 s while the
      dashboard is on screen, and when the tab is hidden or closed. The Worker takes the e-mail from the signed staff token, so nobody can log as someone else.
   2) Page (Admin only, like Activity Log): Control > Usage Log — who, when, how long, which tabs, downloads, filters, CSV.
   Loaded after control.js. */
(function () {
  "use strict";
  var LS_SESSION = "taagerDashboardSession";
  var TICK_MS = 5000, BEAT_MS = 90000, IDLE_MS = 30000, MAX_GAP_MS = 20000;

  function $(id) { return document.getElementById(id); }
  function rid() {
    var a = new Uint8Array(12);
    try { (window.crypto || window.msCrypto).getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function session() { try { return JSON.parse(localStorage.getItem(LS_SESSION) || "null"); } catch (e) { return null; } }
  function token() { var s = session(); return s && s.token ? String(s.token) : ""; }
  function workerUrl() { try { return typeof SYNC_CDN_URL !== "undefined" ? SYNC_CDN_URL : ""; } catch (e) { return ""; } }
  function visible() { return document.visibilityState === "visible"; }
  function clip(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }

  // ======================================================================== 1) tracker
  var sid = rid(), startedAt = new Date().toISOString();
  var openMs = 0, activeMs = 0, last = Date.now(), lastInput = 0;
  var segs = [], cur = null, segN = 0, dls = [], dlN = 0, inflight = false, started = false;

  // the name of the page that is open now: "<hub> › <tab>" (e.g. "Supply Chain › Planner DOH"), or the page title
  function currentLabel() {
    var sec = document.querySelector(".view-section.active-view"); if (!sec) return "";
    var h1 = document.querySelector(".topbar-title h1"), title = h1 ? clip(h1.textContent, 60) : "";
    var on = Array.prototype.filter.call(document.querySelectorAll("#twTabs .tw-tab.on"), function (e) { return e.offsetWidth > 0; });
    var tab = on.length ? clip(on[on.length - 1].textContent, 60) : "";
    if (tab && title && tab !== title) return title + " › " + tab;
    return tab || title || clip(sec.id.replace(/^view/, ""), 60);
  }
  // add the time since the last call to the counters (only while the dashboard is on screen)
  function account(wasVisible) {
    var now = Date.now(), dt = now - last; last = now;
    if (!(wasVisible === undefined ? visible() : wasVisible) || dt <= 0 || dt > MAX_GAP_MS) return;
    openMs += dt; if (now - lastInput <= IDLE_MS) activeMs += dt;
    if (cur) cur.ms += dt;
  }
  function refreshTab() {
    var label = currentLabel(); if (!label || (cur && cur.tab === label)) return;
    account();
    cur = { n: segN++, at: new Date().toISOString(), tab: label, ms: 0, sent: -1 }; segs.push(cur);
    if (segs.length > 400) segs = segs.filter(function (s) { return s === cur || s.sent !== Math.round(s.ms); }).slice(-400);
  }
  function tick(wasVisible) { account(wasVisible); refreshTab(); }

  ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastInput = Date.now(); }, { passive: true, capture: true });
  });

  // ---- downloads: every file the page offers for download (CSV / XLSX / ZIP …), with the number of rows for CSV files
  var blobs = new Map(), origCreate = URL.createObjectURL;
  URL.createObjectURL = function (o) {
    var u = origCreate.apply(URL, arguments);
    try { if (o && typeof o.size === "number") { blobs.set(u, o); if (blobs.size > 40) blobs.delete(blobs.keys().next().value); } } catch (e) {}
    return u;
  };
  function noteDownload(a) {
    var now = Date.now(); if (a.__utAt && now - a.__utAt < 1500) return; a.__utAt = now;   // click() + the click event = one download
    var name = clip(a.getAttribute("download") || "", 160);
    if (!name) { try { name = clip(decodeURIComponent((a.href || "").split("?")[0].split("/").pop()), 160); } catch (e) {} }
    if (!name) return;
    var d = { n: dlN++, at: new Date().toISOString(), what: name, rows: null, tab: cur ? cur.tab : currentLabel(), sent: false };
    dls.push(d);
    var b = blobs.get(a.href);
    if (b && b.size <= 25e6 && (!b.type || /^text\/|csv|json/i.test(b.type))) {
      try { b.text().then(function (t) { var n = t.replace(/\r/g, "").split("\n").filter(Boolean).length - 1; d.rows = n > 0 ? n : 0; }).catch(function () {}); } catch (e) {}
    }
  }
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { try { if (this.hasAttribute("download")) noteDownload(this); } catch (e) {} return origClick.apply(this, arguments); };
  document.addEventListener("click", function (e) { try { var a = e.target && e.target.closest ? e.target.closest("a[download]") : null; if (a) noteDownload(a); } catch (err) {} }, true);

  // ---- sending
  function build() {
    var dirtySegs = segs.filter(function (s) { return s.sent !== Math.round(s.ms); }).slice(0, 60);
    var newDls = dls.filter(function (d) { return !d.sent; }).slice(0, 30);
    var s = session() || {};
    return {
      segs: dirtySegs, dls: newDls,
      body: JSON.stringify({
        sid: sid, startedAt: startedAt, name: clip(s.name || "", 80), openMs: Math.round(openMs), activeMs: Math.round(activeMs),
        tabs: dirtySegs.map(function (t) { return { n: t.n, at: t.at, tab: t.tab, ms: Math.round(t.ms) }; }),
        downloads: newDls.map(function (d) { return { n: d.n, at: d.at, what: d.what, rows: d.rows, tab: d.tab }; })
      })
    };
  }
  function markSent(snap, sentMs) {
    snap.segs.forEach(function (t) { t.sent = sentMs.get(t); });
    snap.dls.forEach(function (d) { d.sent = true; });
  }
  function send(final) {
    var tok = token(), base = workerUrl(); if (!tok || !base) return;
    if (inflight && !final) return;
    tick(final ? true : undefined);
    var snap = build(), sentMs = new Map(); snap.segs.forEach(function (t) { sentMs.set(t, Math.round(t.ms)); });
    var url = base + "?action=usagePing";
    if (final && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(url + "&st=" + encodeURIComponent(tok), new Blob([snap.body], { type: "text/plain;charset=UTF-8" }))) { markSent(snap, sentMs); return; } } catch (e) {}
    }
    inflight = true;
    // the page-wide fetch wrapper (auth.js) adds the X-Staff-Token header to Worker calls
    fetch(url, { method: "POST", body: snap.body, headers: { "Content-Type": "text/plain;charset=UTF-8" }, keepalive: true, cache: "no-store" })
      .then(function (r) { if (r.ok) markSent(snap, sentMs); })
      .catch(function () {})
      .then(function () { inflight = false; });
  }

  function startTracker() {
    var loop = function () {
      if (!token()) { started = false; return; }
      if (!started) { started = true; last = Date.now(); setTimeout(function () { send(false); }, 4000); }   // first update ~4 s after sign-in / load
      tick();
    };
    setTimeout(loop, 1200); setInterval(loop, TICK_MS);
    setInterval(function () { if (token() && visible()) send(false); }, BEAT_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { if (token()) send(true); } else last = Date.now();
    });
    window.addEventListener("pagehide", function () { if (token()) send(true); });
    var main = document.querySelector("main.content");
    if (main && window.MutationObserver) new MutationObserver(function () { if (token()) refreshTab(); }).observe(main, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  window.UsageTracker = { sid: sid, snapshot: function () { tick(); return { sid: sid, openMs: Math.round(openMs), activeMs: Math.round(activeMs), tabs: segs.map(function (s) { return { n: s.n, tab: s.tab, ms: Math.round(s.ms) }; }), downloads: dls.slice() }; }, flush: function () { send(false); } };

  // ======================================================================== 2) Control > Usage Log (Admin only)
  var C = null, U = { period: "today", person: "", q: "", data: null, people: [], open: {}, timer: 0, host: null, err: "", stamp: null };
  var PERIODS = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];
  var dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
  var timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  var shortFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  function cairoDay(d) { return dayFmt.format(d); }
  function esc(v) { return C && C.esc ? C.esc(v) : String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function range() {
    var now = new Date(), day = function (back) { return cairoDay(new Date(now.getTime() - back * 86400000)); };
    if (U.period === "yesterday") return [day(1), day(1)];
    if (U.period === "7d") return [day(6), day(0)];
    if (U.period === "30d") return [day(29), day(0)];
    return [day(0), day(0)];
  }
  function dur(ms) {
    ms = Math.max(0, Math.round(ms || 0)); var s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60); if (m < 60) return m + "m" + (m < 10 && s % 60 ? " " + String(s % 60).padStart(2, "0") + "s" : "");
    var h = Math.floor(m / 60); return h + "h " + String(m % 60).padStart(2, "0") + "m";
  }
  function when(iso) { return shortFmt.format(new Date(iso)); }
  function clock(iso) { return timeFmt.format(new Date(iso)); }
  function ago(iso, now) { var s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000)); if (s < 90) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; return when(iso); }
  function sectionVisible() { var s = $("viewTowerUsage"); return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null); }

  function css() {
    if ($("usageLogCss")) return;
    var st = document.createElement("style"); st.id = "usageLogCss";
    st.textContent =
      ".ul-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px}" +
      ".ul-seg{display:inline-flex;gap:4px;padding:4px;border-radius:12px;background:var(--panel);border:1px solid var(--line)}" +
      ".ul-seg button{border:0;background:transparent;color:var(--text2);padding:7px 14px;border-radius:9px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}" +
      ".ul-seg button:hover{color:var(--text)}.ul-seg button.on{background:var(--accent);color:var(--accent-ink)}" +
      ".ul-bar select,.ul-bar input{min-height:36px;padding:0 10px;border-radius:10px;border:1px solid var(--line-light,var(--line));background:var(--panel2,var(--panel));color:var(--text);font:inherit;font-size:13px}" +
      ".ul-grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:14px;margin:14px 0}@media(max-width:1100px){.ul-grid{grid-template-columns:1fr}}" +
      ".ul-t{width:100%;border-collapse:collapse;font-size:13px}.ul-t th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--text-dim);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}" +
      ".ul-t td{padding:9px 10px;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent);vertical-align:top}.ul-t .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".ul-t tr.ul-row{cursor:pointer}.ul-t tr.ul-row:hover td{background:color-mix(in srgb,var(--text) 4%,transparent)}.ul-t tr.ul-open td{background:color-mix(in srgb,var(--accent) 6%,transparent)}" +
      ".ul-who b{display:block;font-weight:650}.ul-who span{color:var(--text-dim);font-size:11px}" +
      ".ul-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 22%,transparent)}" +
      ".ul-chip{display:inline-block;padding:2px 8px;margin:0 4px 4px 0;border-radius:999px;font-size:11px;background:color-mix(in srgb,var(--text) 7%,transparent);color:var(--text2);white-space:nowrap}" +
      ".ul-tl{padding:6px 4px 10px 22px;border-left:2px solid var(--line);margin:4px 0 4px 6px;display:flex;flex-direction:column;gap:7px}" +
      ".ul-ev{font-size:12.5px;color:var(--text2)}.ul-ev time{font-family:'JetBrains Mono',monospace;color:var(--text-dim);margin-right:10px;font-size:11.5px}.ul-ev b{color:var(--text)}.ul-ev.dl b{color:var(--orange)}" +
      ".ul-empty{padding:18px;color:var(--text-dim);font-size:13px}.ul-link{color:var(--accent);cursor:pointer;font-weight:600}.ul-link:hover{text-decoration:underline}";
    document.head.appendChild(st);
  }

  function load(first) {
    var r = range(), qs = "&from=" + r[0] + "&to=" + r[1] + (U.person ? "&email=" + encodeURIComponent(U.person) : "");
    return C.wfetch("usageLog", { admin: true, timeout: 25000 }, qs).then(function (j) {
      U.data = j; U.err = ""; U.stamp = new Date();
      if (!U.person) {
        var m = {}; (j.sessions || []).forEach(function (s) { if (!m[s.email]) m[s.email] = s.name || s.email; });
        U.people = Object.keys(m).sort().map(function (e) { return { email: e, name: m[e] }; });
      }
    }).catch(function (e) {
      U.err = (e && e.message ? e.message : "Could not load") + (e && e.status === 403 ? " — set the admin key in Users & Roles → Roles." : "");
      if (first) U.data = null;
    }).then(draw);
  }

  function aggregate() {
    var d = U.data || { sessions: [], tabs: [], downloads: [] }, q = U.q.trim().toLowerCase();
    var sessions = (d.sessions || []).filter(function (s) { return !q || (s.email + " " + (s.name || "")).toLowerCase().indexOf(q) >= 0; });
    var ids = {}; sessions.forEach(function (s) { ids[s.sid] = s; });
    var tabsBy = {}, dlBy = {};
    (d.tabs || []).forEach(function (t) { if (ids[t.sid]) (tabsBy[t.sid] = tabsBy[t.sid] || []).push(t); });
    (d.downloads || []).forEach(function (x) { if (ids[x.sid]) (dlBy[x.sid] = dlBy[x.sid] || []).push(x); });
    var people = {}, tabs = {};
    sessions.forEach(function (s) {
      var p = people[s.email] || (people[s.email] = { email: s.email, name: s.name || s.email, opens: 0, open: 0, active: 0, last: "", tabMs: {} });
      p.opens++; p.open += s.open_ms || 0; p.active += s.active_ms || 0; if (!p.last || s.last_seen > p.last) p.last = s.last_seen; if (s.name) p.name = s.name;
      (tabsBy[s.sid] || []).forEach(function (t) {
        p.tabMs[t.tab] = (p.tabMs[t.tab] || 0) + (t.ms || 0);
        var x = tabs[t.tab] || (tabs[t.tab] = { tab: t.tab, ms: 0, who: {} }); x.ms += t.ms || 0; x.who[s.email] = 1;
      });
    });
    var peopleList = Object.keys(people).map(function (k) { return people[k]; }).sort(function (a, b) { return b.open - a.open; });
    var tabList = Object.keys(tabs).map(function (k) { return tabs[k]; }).sort(function (a, b) { return b.ms - a.ms; });
    var totalOpen = sessions.reduce(function (a, s) { return a + (s.open_ms || 0); }, 0);
    return { sessions: sessions, tabsBy: tabsBy, dlBy: dlBy, people: peopleList, tabs: tabList, totalOpen: totalOpen, totalActive: sessions.reduce(function (a, s) { return a + (s.active_ms || 0); }, 0) };
  }

  function draw() {
    var host = U.host; if (!host || !host.isConnected) return;
    var focused = document.activeElement && document.activeElement.id === "ulQ"; var caret = focused ? document.activeElement.selectionStart : 0;
    if (!U.data) { host.innerHTML = '<div class="tw-page ul-page"><div class="tw-card">' + (U.err ? '<div class="tw-msg err">' + esc(U.err) + "</div>" : '<div class="tw-muted">Loading…</div>') + "</div></div>"; return; }
    var A = aggregate(), now = Date.parse(U.data.now) || Date.now(), online = U.data.online || [];
    var onlineN = A.people.filter(function (p) { return online.indexOf(p.email) >= 0; }).length;
    var opts = '<option value="">Everyone</option>' + U.people.map(function (p) { return '<option value="' + esc(p.email) + '"' + (p.email === U.person ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("");
    var kpi = function (l, v, sub) { return '<div class="tw-stat"><span>' + l + "</span><b>" + v + "</b>" + (sub ? '<div class="tw-muted">' + sub + "</div>" : "") + "</div>"; };
    var rowsPeople = A.people.length ? A.people.map(function (p) {
      var top = Object.keys(p.tabMs).sort(function (a, b) { return p.tabMs[b] - p.tabMs[a]; }).slice(0, 3).map(function (t) { return '<span class="ul-chip">' + esc(t) + " · " + dur(p.tabMs[t]) + "</span>"; }).join("");
      return '<tr><td class="ul-who"><span class="ul-link" data-person="' + esc(p.email) + '"><b>' + (online.indexOf(p.email) >= 0 ? '<i class="ul-dot"></i>' : "") + esc(p.name) + "</b></span><span>" + esc(p.email) + '</span></td><td class="num">' + p.opens + '</td><td class="num">' + dur(p.open) + '</td><td class="num">' + dur(p.active) + "</td><td>" + (online.indexOf(p.email) >= 0 ? "Online now" : esc(ago(p.last, now))) + "</td><td>" + top + "</td></tr>";
    }).join("") : '<tr><td colspan="6" class="ul-empty">No activity in this period.</td></tr>';
    var rowsTabs = A.tabs.length ? A.tabs.slice(0, 15).map(function (t) { return "<tr><td>" + esc(t.tab) + '</td><td class="num">' + dur(t.ms) + '</td><td class="num">' + Object.keys(t.who).length + "</td></tr>"; }).join("") : '<tr><td colspan="3" class="ul-empty">No tabs yet.</td></tr>';
    var rowsSes = A.sessions.length ? A.sessions.map(function (s) {
      var open = !!U.open[s.sid], tl = A.tabsBy[s.sid] || [], dl = A.dlBy[s.sid] || [];
      var out = '<tr class="ul-row' + (open ? " ul-open" : "") + '" data-sid="' + esc(s.sid) + '"><td>' + esc(when(s.started_at)) + '</td><td class="ul-who"><b>' + esc(s.name || s.email) + "</b><span>" + esc(s.email) + '</span></td><td class="num">' + dur(s.open_ms) + '</td><td class="num">' + dur(s.active_ms) + "</td><td>" + (online.indexOf(s.email) >= 0 && now - Date.parse(s.last_seen) < 180000 ? '<i class="ul-dot"></i>Online' : esc(ago(s.last_seen, now))) + '</td><td class="num">' + tl.length + '</td><td class="num">' + dl.length + "</td></tr>";
      if (open) {
        var ev = tl.map(function (t) { return { at: t.at, html: '<div class="ul-ev"><time>' + esc(clock(t.at)) + "</time>Opened <b>" + esc(t.tab) + "</b> · " + dur(t.ms) + "</div>" }; })
          .concat(dl.map(function (x) { return { at: x.at, html: '<div class="ul-ev dl"><time>' + esc(clock(x.at)) + "</time>Downloaded <b>" + esc(x.what) + "</b>" + (x.rows != null ? " · " + Number(x.rows).toLocaleString("en-US") + " rows" : "") + (x.tab ? " (from " + esc(x.tab) + ")" : "") + "</div>" }; }))
          .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
        out += '<tr class="ul-open"><td colspan="7"><div class="ul-tl">' + (ev.length ? ev.map(function (e) { return e.html; }).join("") : '<div class="ul-ev">Nothing recorded inside this session yet.</div>') + "</div></td></tr>";
      }
      return out;
    }).join("") : '<tr><td colspan="7" class="ul-empty">No sessions in this period.</td></tr>';

    host.innerHTML = '<div class="tw-page ul-page">' +
      '<div class="ul-bar"><div class="ul-seg">' + PERIODS.map(function (p) { return '<button type="button" data-p="' + p[0] + '" class="' + (U.period === p[0] ? "on" : "") + '">' + p[1] + "</button>"; }).join("") + "</div>" +
      '<select id="ulPerson" title="Person">' + opts + '</select><input type="search" id="ulQ" placeholder="Search a person" value="' + esc(U.q) + '" style="min-width:200px">' +
      '<span class="tw-muted" id="ulStamp">' + (U.stamp ? "Updated " + esc(clock(U.stamp.toISOString())) + (U.period === "today" ? " · refreshes every minute" : "") : "") + '</span><span style="flex:1"></span><button class="btn" id="ulExp" type="button">Export CSV</button></div>' +
      (U.err ? '<div class="tw-msg err" style="margin-bottom:10px">' + esc(U.err) + "</div>" : "") +
      '<div class="tw-stats">' + kpi("People", A.people.length, onlineN + " online now") + kpi("Opens", A.sessions.length, "each open tab counts once") + kpi("Total time", dur(A.totalOpen), "on screen · " + dur(A.totalActive) + " active") + kpi("Average per open", dur(A.sessions.length ? A.totalOpen / A.sessions.length : 0), "") + "</div>" +
      '<div class="ul-grid"><div class="tw-card"><h3>People</h3><div class="table-responsive"><table class="ul-t"><thead><tr><th>Person</th><th class="num">Opens</th><th class="num">Open</th><th class="num">Active</th><th>Last seen</th><th>Most used tabs</th></tr></thead><tbody>' + rowsPeople + "</tbody></table></div></div>" +
      '<div class="tw-card"><h3>Most used tabs</h3><div class="table-responsive"><table class="ul-t"><thead><tr><th>Tab</th><th class="num">Time</th><th class="num">People</th></tr></thead><tbody>' + rowsTabs + "</tbody></table></div></div></div>" +
      '<div class="tw-card"><h3>Sessions <span class="tw-muted">· click a row for the minute-by-minute timeline</span></h3>' + (U.data.truncated ? '<div class="tw-msg err">Showing the latest 3,000 sessions only — narrow the period.</div>' : "") + '<div class="table-responsive"><table class="ul-t"><thead><tr><th>Opened (Cairo)</th><th>Person</th><th class="num">Open</th><th class="num">Active</th><th>Last seen</th><th class="num">Tabs</th><th class="num">Downloads</th></tr></thead><tbody>' + rowsSes + "</tbody></table></div></div>" +
      '<div class="tw-muted" style="margin:12px 2px">Open = the dashboard was on screen. Active = mouse, keyboard or scroll in the last 30 seconds. A hidden tab or a sleeping computer adds nothing. Records are kept for ' + (U.data.retentionDays ? Math.round(U.data.retentionDays / 30.5) : 6) + " months.</div></div>";

    host.querySelectorAll(".ul-seg button").forEach(function (b) { b.onclick = function () { U.period = b.dataset.p; U.person = ""; U.open = {}; U.data = null; draw(); load(true); }; });
    $("ulPerson").onchange = function (e) { U.person = e.target.value; U.open = {}; load(false); };
    $("ulQ").oninput = function (e) { U.q = e.target.value; draw(); };
    host.querySelectorAll("[data-person]").forEach(function (el) { el.onclick = function () { U.person = el.dataset.person; U.open = {}; load(false); }; });
    host.querySelectorAll("tr.ul-row").forEach(function (tr) { tr.onclick = function () { var id = tr.dataset.sid; if (U.open[id]) delete U.open[id]; else U.open[id] = 1; draw(); }; });
    $("ulExp").onclick = function () { exportCsv(A); };
    if (focused) { var q = $("ulQ"); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} }
  }

  function exportCsv(A) {
    var cell = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var lines = ["Opened (Cairo),Person,Email,Role,Open (min),Active (min),Last seen (Cairo),Tabs,Downloads"];
    A.sessions.forEach(function (s) {
      var tabs = (A.tabsBy[s.sid] || []).map(function (t) { return t.tab + " (" + dur(t.ms) + ")"; }).join("; "), dl = (A.dlBy[s.sid] || []).map(function (x) { return x.what + (x.rows != null ? " (" + x.rows + " rows)" : ""); }).join("; ");
      lines.push([when(s.started_at), s.name, s.email, s.role, ((s.open_ms || 0) / 60000).toFixed(1), ((s.active_ms || 0) / 60000).toFixed(1), when(s.last_seen), tabs, dl].map(cell).join(","));
    });
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })); a.download = "usage-log-" + range()[0] + ".csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  function renderUsage(host) {
    css(); U.host = host; U.open = {};
    host.innerHTML = '<div class="tw-page"><div class="tw-card tw-muted">Loading…</div></div>';
    load(true);
    clearInterval(U.timer);
    U.timer = setInterval(function () { if (U.period === "today" && sectionVisible() && !document.hidden) load(false); }, 60000);
  }

  function boot() {
    C = window.TowerCore; var ready = false; try { ready = typeof state !== "undefined"; } catch (e) {}
    if (!C || !ready) { setTimeout(boot, 300); return; }
    C.registerView("towerUsage", { sectionId: "viewTowerUsage", navId: "navTowerUsage", label: "Usage Log", sub: "Who opened the dashboard, when, for how long, and which tabs", render: renderUsage });
  }
  startTracker();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 160); }); else setTimeout(boot, 160);
})();
