/* Taager Control Tower layer (v1.4.0): Roles + per-role Views + Targets uploaded from files.
   Loaded AFTER app.js. Storage = Cloudflare Worker KV (getAccess/putAccess/getTargets/putTargets).
   Login stays the Apps Script @taager.com login (js/auth.js); roles are tied to the logged-in email. */
(function () {
  "use strict";
  function workerUrl() { return (typeof SYNC_CDN_URL !== "undefined" && SYNC_CDN_URL) || ""; }
  var MANAGER_EMAIL = "youssef.hanafy@taager.com";
  var KEY_LS = "towerAdminKey", ACCESS_LS = "towerAccessCache", PREVIEW_SS = "towerPreviewRole", SESSION_LS = "taagerDashboardSession";

  // view name (switchView) -> nav element id
  var VIEW_NAV = {
    overview: "navOverview", recommendedTracker: "navRecommendedTracker", inventory: "navInventory",
    acmPerformance: "navAcmPerf", merchantPerformance: "navMerchantPerf", mpSalesPlan: "navMpSalesPlan", spFeedback: "navSpFeedback",
    targetsCommercial: "navTargetsCommercial", commercialDebundlized: "navCommercialDebundlized", purchasePlan: "navPurchasePlan",
    cm3AnalystProducts: "navCm3AnalystProducts", ppmAnalystProducts: "navPpmAnalystProducts", ppmAnalystSingle: "navPpmAnalystSingle",
    productsMatchesAnalyst: "navProductsMatchesAnalyst", scAging: "navScAging", scSkus: "navScSkus", scActions: "navScActions",
    cm3Analyst: "navCm3Analyst", poorMatches: "navPoorMatches", availabilityLocking: "navAvailabilityLocking",
    allocationLocking: "navAllocationLocking", healthyUnlocking: "navHealthyUnlocking",
    mpMatches: "navMpMatches", mpNewMatches: "navMpNewMatches", mpDeclineWatch: "navMpDeclineWatch",
    incentiveMerchants: "navIncMerchants", segmentation: "navSegmentationPanel", sellthrough: "navSellthroughPanel",
    weeklyInventory: "navWeeklyInventory", forecastModel: "navForecastModel", dohPlanner: "navDohPlanner"
  };
  var ADMIN_PW_VIEWS = ["segmentation", "sellthrough", "weeklyInventory", "forecastModel"]; // still behind the Admin Panel password
  var ADMIN_GROUP_IDS = ["navAdminToggle"]; // wrapper whose children are the Admin Panel tools
  var TARGET_TYPES = [
    { type: "merchants", gid: "115442405", title: "Merchant Targets", desc: "Merchant ID · … · GMV (col D) · Placed (col E)" },
    { type: "acm", gid: "2042936628", title: "ACM Targets", desc: "ACM · Target GMV · NDR % · CM3 % · Retention (+ weights)" },
    { type: "category", gid: "1656655269", title: "Category Targets (Commercial)", desc: "Category · Daily Target · CR % · DR % · ASP · CM3 · PPM …" },
    { type: "salesplan", gid: "892918900", title: "Sales Plan-ACM (daily)", desc: "SKU ID · Name · Category · Merchant ID · Merchant · Target · New Target · Flag" },
    { type: "singlesku", gid: "1620722565", title: "Single SKU Targets", desc: "PRODUCT_ID · Name · Category · Placed · Confirmed · Delivered · GMV" }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function session() { try { var r = JSON.parse(ls(SESSION_LS) || "null"); return r && r.email ? r : null; } catch (e) { return null; } }
  function adminKey() { return ls(KEY_LS) || ""; }

  // ---------------------------------------------------------------- nav model (read from the DOM)
  function navModel() {
    var nav = document.querySelector(".sidebar-nav"); if (!nav) return [];
    var out = [];
    Array.prototype.forEach.call(nav.children, function (el) {
      if (el.classList.contains("nav-dropdown-wrapper")) {
        var t = el.querySelector(".nav-item[id]"); if (!t) return;
        var subs = Array.prototype.map.call(el.querySelectorAll(".nav-item-sub[id]"), function (s) { return { id: s.id, label: s.textContent.trim() }; });
        out.push({ id: t.id, label: t.textContent.replace(/[▼▲]/g, "").trim(), subs: subs, el: el, admin: ADMIN_GROUP_IDS.indexOf(t.id) >= 0 });
      } else if (el.classList.contains("nav-item") && el.id && el.id !== "navSyncStatus" && el.id.indexOf("navTower") !== 0) {
        out.push({ id: el.id, label: el.textContent.trim(), subs: [], el: el });
      }
    });
    return out;
  }
  function allLeafIds(model) { var ids = []; model.forEach(function (g) { if (g.subs.length) g.subs.forEach(function (s) { ids.push(s.id); }); else ids.push(g.id); }); return ids; }

  // ---------------------------------------------------------------- access config
  var FULL_ROLES = ["Admin", "Country Manager"]; // always full access, cannot be edited or deleted
  var cfg = null;       // {roles:{name:{views:'*'|[ids],admin}},users:{email:{role,acm}},trustLoginRole,defaultRole}
  function defaultCfg() {
    var m = navModel(), g = function (id) { var x = m.filter(function (k) { return k.id === id; })[0]; return x ? x.subs.map(function (s) { return s.id; }) : []; };
    var base = ["navOverview"];
    return {
      v: 1, trustLoginRole: true, defaultRole: "Merchant",
      roles: {
        "Admin": { views: "*", admin: true },
        "Country Manager": { views: "*", admin: true },
        "Account Manager": { views: base.concat(g("navAcmToggle"), ["navMerchantPerf"], g("navIncentivesToggle")) },
        "Commercial": { views: base.concat(g("navCommercialToggle")) },
        "Marketplace": { views: base.concat(g("navMarketplaceToggle")) },
        "Supply Chain": { views: base.concat(g("navSupplyChainToggle")) },
        "Merchant": { views: base }
      },
      users: {}
    };
  }
  function getCfg() { return cfg || (cfg = defaultCfg()); }
  function normCfg(c) {
    var d = defaultCfg();
    if (!c || typeof c !== "object") return d;
    c.roles = c.roles && typeof c.roles === "object" ? c.roles : d.roles;
    FULL_ROLES.forEach(function (n) { c.roles[n] = { views: "*", admin: true }; });
    c.users = c.users && typeof c.users === "object" ? c.users : {};
    if (c.trustLoginRole === undefined) c.trustLoginRole = true;
    c.requireApproval = !!c.requireApproval;
    // v1.15.0: role "Viewer" was renamed "Merchant" — migrate saved configs
    if (c.roles.Viewer) { if (!c.roles.Merchant) c.roles.Merchant = c.roles.Viewer; delete c.roles.Viewer; }
    if (!c.roles.Merchant) c.roles.Merchant = d.roles.Merchant;
    if (c.defaultRole === "Viewer") c.defaultRole = "Merchant";
    Object.keys(c.users).forEach(function (em) { var u = c.users[em]; if (u === "Viewer") c.users[em] = "Merchant"; else if (u && typeof u === "object" && u.role === "Viewer") u.role = "Merchant"; });
    if (!c.defaultRole || !c.roles[c.defaultRole]) c.defaultRole = "Merchant";
    return c;
  }
  function userEntry(email) { var u = getCfg().users[(email || "").toLowerCase()]; return typeof u === "string" ? { role: u } : (u || null); }
  function realRoleName() {
    var s = session(); if (!s) return "Merchant";
    var c = getCfg(), u = userEntry(s.email);
    if (u && u.status === "inactive" && (s.email || "").toLowerCase() !== MANAGER_EMAIL) return c.defaultRole || "Merchant";
    if (u && u.role && c.roles[u.role]) return u.role;
    var sr = s.role === "Viewer" ? "Merchant" : s.role;
    if (c.trustLoginRole && sr && c.roles[sr]) return sr;
    return c.defaultRole || "Merchant";
  }
  function isRealAdmin() {
    var s = session(); if (!s) return false;
    if ((s.email || "").toLowerCase() === MANAGER_EMAIL) return true;
    var r = getCfg().roles[realRoleName()]; return !!(r && (r.admin || r.views === "*"));
  }
  function effRoleName() { var p = null; try { p = sessionStorage.getItem(PREVIEW_SS); } catch (e) {} return (p && isRealAdmin() && getCfg().roles[p]) ? p : realRoleName(); }
  function effRole() { return getCfg().roles[effRoleName()] || { views: ["navOverview"] }; }
  function isEffAdmin() {
    var p = null; try { p = sessionStorage.getItem(PREVIEW_SS); } catch (e) {}
    if (p && isRealAdmin()) { var r = getCfg().roles[p]; return !!(r && r.admin); }
    return isRealAdmin();
  }
  function allowed(navId) {
    if (navId === "navOverview") return true;
    var r = effRole();
    if (r.admin && isEffAdmin()) return true;
    if (r.views === "*") return true;
    return Array.isArray(r.views) && r.views.indexOf(navId) >= 0;
  }

  // ---------------------------------------------------------------- approval gate
  var gateTimer = null, gateAsked = "";
  function needsApproval() {
    var s = session(); if (!s || !getCfg().requireApproval) return false;
    var em = (s.email || "").toLowerCase();
    return em !== MANAGER_EMAIL && !userEntry(em);
  }
  function checkGate() {
    var el = $("twPendingGate");
    if (!needsApproval()) { if (el) el.remove(); if (gateTimer) { clearInterval(gateTimer); gateTimer = null; } return; }
    var s = session(), em = (s.email || "").toLowerCase();
    if (!el) {
      el = document.createElement("div"); el.id = "twPendingGate";
      el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--bg,#0b1220);padding:24px";
      el.innerHTML = '<div style="max-width:440px;text-align:center;background:var(--panel,#111a2e);color:var(--text,#e5e7eb);border:1px solid var(--line-light,#243049);border-radius:16px;padding:36px 30px"><div style="font-size:42px">⏳</div><h2 style="margin:10px 0 8px">Waiting for admin approval</h2><p style="line-height:1.6;opacity:.8;margin:0 0 20px">Your request to access the dashboard was sent to the admin. This page opens automatically once you are approved.</p><button class="btn" id="twGateOut">Sign out</button></div>';
      document.body.appendChild(el);
      $("twGateOut").onclick = function () { try { localStorage.removeItem(SESSION_LS); } catch (e) {} location.reload(); };
    }
    if (gateAsked !== em) {
      gateAsked = em;
      fetch(workerUrl() + "?action=requestAccess", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ email: em, name: s.name || "" }) }).catch(function () { gateAsked = ""; });
    }
    if (!gateTimer) gateTimer = setInterval(function () { loadAccess().then(applyNav); }, 30000);
  }

  // Invite page: every role except Merchant (admins already have Users & Roles). Invites go to the admin queue for approval.
  function canInvite() { return !!session() && !isEffAdmin() && effRoleName() !== "Merchant"; }
  function renderInvite() {
    var host = $("viewTowerInvite"); if (!host) return;
    var roles = Object.keys(getCfg().roles).filter(function (r) { return FULL_ROLES.indexOf(r) < 0; });
    host.innerHTML = '<div class="tw-page"><div class="tw-card" style="max-width:560px"><h3>Invite people</h3><div class="tw-muted">Enter the work email of the person. Your request goes to the admin, who approves it and sets the final role. The person then gets an email.</div>' +
      '<div style="display:grid;gap:10px;margin-top:14px"><input type="email" id="twInvEmail" placeholder="name@taager.com" style="min-height:38px;padding:0 10px"><select id="twInvRole" style="min-height:38px;padding:0 8px">' + roles.map(function (r) { return '<option value="' + esc(r) + '"' + (r === getCfg().defaultRole ? " selected" : "") + '>Suggested role: ' + esc(r) + '</option>'; }).join("") + '</select>' +
      '<div class="tw-row"><button class="btn btn-primary" id="twInvGo">Send for approval</button><span class="tw-msg" id="twInvMsg"></span></div></div></div></div>';
    $("twInvGo").onclick = function () {
      var em = $("twInvEmail").value.trim().toLowerCase(), m = $("twInvMsg"), s = session();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { m.className = "tw-msg err"; m.textContent = "Enter a valid email."; return; }
      m.className = "tw-msg"; m.textContent = "Sending…";
      fetch(workerUrl() + "?action=requestAccess", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ email: em, name: "", invitedBy: (s && s.email) || "", role: $("twInvRole").value }) })
        .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.success) throw new Error((j && j.message) || "Failed"); m.className = "tw-msg ok"; m.textContent = "Sent to the admin for approval ✓"; $("twInvEmail").value = ""; })
        .catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message; });
    };
  }

  function applyNav() {
    checkGate();
    var ni = $("navTowerInvite"); if (ni) ni.classList.toggle("tw-off", !canInvite());
    var model = navModel();
    model.forEach(function (g) {
      if (g.subs.length) {
        var any = false;
        g.subs.forEach(function (s) { var ok = allowed(s.id); var el = $(s.id); if (el) el.classList.toggle("tw-off", !ok); if (ok) any = true; });
        g.el.classList.toggle("tw-off", !any);
      } else {
        g.el.classList.toggle("tw-off", !allowed(g.id));
      }
    });
    var admin = isEffAdmin();
    var grp = $("navTowerGroup"); if (grp) grp.classList.toggle("tw-off", !admin);
    // role chip under the name in the profile card
    var rr = document.querySelector("#authUserBadge .auth-profile-role");
    if (rr) rr.textContent = effRoleName() + " · Egypt";
    renderViewAs();
    applyAcmLock();
  }

  // ---------------------------------------------------------------- ACM scope
  var acmTimer = null;
  function applyAcmLock() {}

  // ---------------------------------------------------------------- worker I/O
  function wfetch(action, opts, params) {
    var url = workerUrl() + "?action=" + action + (params || "");
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, (opts && opts.timeout) || 15000);
    var o = { cache: "no-store", signal: ctrl.signal };
    if (opts && opts.admin) o.headers = { "X-Admin-Key": adminKey() };
    if (opts && opts.body !== undefined) { o.method = "POST"; o.body = opts.body; o.headers = { "Content-Type": "text/plain", "X-Admin-Key": adminKey() }; }
    return fetch(url, o).then(function (r) { clearTimeout(t); return r.text().then(function (txt) { var j = null; try { j = JSON.parse(txt); } catch (e) {} if (!r.ok) { var e = new Error((j && j.message) || ("HTTP " + r.status)); e.status = r.status; throw e; } return j; }); }, function (e) { clearTimeout(t); throw e; });
  }
  var _wfRaw = wfetch;
  wfetch = function (action, opts, params) {
    return _wfRaw(action, opts, params).then(function (j) {
      try {
        var T = null;
        if (action === "putAccess") T = ["roles", "Roles & users updated", ""];
        else if (action === "putTargets" && params && params.indexOf("type=meta") < 0) T = ["targets", "Targets uploaded", String(params).replace("&type=", "")];
        else if (action === "putSettings") T = ["settings", "Settings saved", ""];
        else if (action === "sendAlert") { var b = JSON.parse(opts.body); T = ["alert", "Alert sent: " + b.title, (b.audience && b.audience.all) ? "Everyone" : ""]; }
        else if (action === "deleteAlert") T = ["alert", "Alert deleted", ""];
        if (T) logActivity(T[0], T[1], T[2]);
      } catch (e) {}
      return j;
    });
  };
  function logActivity(type, text, detail) {
    var s = session() || {};
    _wfRaw("logActivity", { body: JSON.stringify({ type: type, text: text, detail: detail || "", actor: s.email || "", role: realRoleName() }) }).catch(function () {});
  }
  // ---------------------------------------------------------------- shared Settings (cutoffs, thresholds, alert rules) — KV "settings:config"
  var SETTINGS_LS = "twSettings";
  var DEFAULT_SETTINGS = {
    sources: { agingSheetId: "" },
    cutoffs: { cr: 2, dr: 5 },
    thresholds: { acmNdrMin: 50, acmCrMin: 60, acmPacingMin: 70, merchNdrMin: 40 },
    rules: [
      { key: "acm.ndr", name: "ACM NDR below floor", on: true, severity: "critical", notify: ["Admin"], limit: "acmNdrMin" },
      { key: "acm.cr", name: "ACM confirmation rate low", on: true, severity: "warning", notify: ["Admin"], limit: "acmCrMin" },
      { key: "acm.pacing", name: "ACM GMV pacing behind target", on: true, severity: "warning", notify: ["Admin"], limit: "acmPacingMin" },
      { key: "merchant.ndr", name: "Merchant NDR below floor", on: false, severity: "warning", notify: ["Admin"], limit: "merchNdrMin" }
    ]
  };
  var settingsCache = null;
  function normSettings(j) {
    var d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); if (!j || typeof j !== "object") return d;
    if (j.cutoffs) { d.cutoffs.cr = Number(j.cutoffs.cr); d.cutoffs.dr = Number(j.cutoffs.dr); if (!isFinite(d.cutoffs.cr)) d.cutoffs.cr = 2; if (!isFinite(d.cutoffs.dr)) d.cutoffs.dr = 5; }
    if (j.sources && typeof j.sources.agingSheetId === "string") d.sources.agingSheetId = j.sources.agingSheetId.trim();
    if (j.thresholds) Object.keys(d.thresholds).forEach(function (k) { var v = Number(j.thresholds[k]); if (isFinite(v)) d.thresholds[k] = v; });
    if (Array.isArray(j.rules)) d.rules.forEach(function (r) { var o = j.rules.filter(function (x) { return x.key === r.key; })[0]; if (o) { r.on = !!o.on; if (["info", "warning", "critical"].indexOf(o.severity) >= 0) r.severity = o.severity; if (Array.isArray(o.notify)) r.notify = o.notify; } });
    return d;
  }
  function getSettings() { if (!settingsCache) { try { settingsCache = normSettings(JSON.parse(ls(SETTINGS_LS) || "null")); } catch (e) { settingsCache = normSettings(null); } } return settingsCache; }
  function loadSettings() { return wfetch("getSettings", { timeout: 8000 }).then(function (j) { if (j) { settingsCache = normSettings(j); ls(SETTINGS_LS, JSON.stringify(settingsCache)); } return getSettings(); }).catch(function () { return getSettings(); }); }
  function saveSettings(obj) { var n = normSettings(obj); return wfetch("putSettings", { body: JSON.stringify(n) }).then(function () { settingsCache = n; ls(SETTINGS_LS, JSON.stringify(n)); return n; }); }

  function loadAccess() {
    return wfetch("getAccess", { timeout: 8000 }).then(function (j) { if (j) { cfg = normCfg(j); ls(ACCESS_LS, JSON.stringify(cfg)); } }).catch(function () {});
  }

  // ---------------------------------------------------------------- Targets (read side: used by app.js)
  window.TowerTargets = {
    meta: null,
    start: function () {
      if (!workerUrl()) return Promise.resolve({});
      var self = this, found = {};
      var jobs = TARGET_TYPES.map(function (t) {
        return wfetch("getTargets", { timeout: 9000 }, "&type=" + t.type).then(function (p) {
          if (p && p.table && Array.isArray(p.table.rows) && p.table.rows.length) found[t.gid] = p;
        }).catch(function (e) { console.warn("[Tower] targets " + t.type + " failed — using fallback:", e && e.message); });
      });
      var metaJob = wfetch("getTargets", { timeout: 6000 }, "&type=meta").then(function (m) { self.meta = m; }).catch(function () {});
      return Promise.all(jobs.concat([metaJob])).then(function () { return found; });
    },
    apply: function (sheets, started) {
      return (started || this.start()).then(function (found) {
        var used = Object.keys(found);
        used.forEach(function (gid) { sheets[gid] = found[gid]; });
        if (used.length) console.info("[Tower] uploaded targets in use:", used.length + "/" + TARGET_TYPES.length);
      });
    }
  };

  // ---------------------------------------------------------------- SheetJS (lazy)
  var xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxP) return xlsxP;
    xlsxP = new Promise(function (res, rej) { var s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = function () { res(window.XLSX); }; s.onerror = function () { xlsxP = null; rej(new Error("Could not load the Excel reader (cdnjs).")); }; document.head.appendChild(s); });
    return xlsxP;
  }
  function wbToPayload(XLSX, wb) {
    var ws = wb.Sheets[wb.SheetNames[0]]; if (!ws || !ws["!ref"]) throw new Error("The file has no data.");
    var rng = XLSX.utils.decode_range(ws["!ref"]), rows = [];
    for (var r = rng.s.r; r <= rng.e.r; r++) {
      var cells = [], last = -1;
      for (var c = rng.s.c; c <= rng.e.c; c++) {
        var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })], o = null;
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
          if (cell.t === "n") { o = { v: cell.v }; var w = cell.w; if (w != null && String(w) !== String(cell.v)) o.f = String(w); }
          else if (cell.t === "b") o = { v: cell.v };
          else { var tx = cell.w != null ? String(cell.w) : String(cell.v); o = { v: tx }; }
        }
        cells.push(o); if (o) last = c - rng.s.c;
      }
      if (last < 0) continue;            // blank row
      rows.push({ c: cells });
    }
    if (!rows.length) throw new Error("The file has no data rows.");
    return { table: { cols: [], rows: rows } };
  }
  function parseFile(file) {
    return loadXlsx().then(function (XLSX) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onerror = function () { rej(new Error("Could not read the file.")); };
        fr.onload = function () { try { var isCsv = /\.csv$/i.test(file.name); var wb = isCsv ? XLSX.read(fr.result, { type: "string" }) : XLSX.read(fr.result, { type: "array" }); res(wbToPayload(XLSX, wb)); } catch (e) { rej(e); } };
        if (/\.csv$/i.test(file.name)) fr.readAsText(file, "utf-8"); else fr.readAsArrayBuffer(file);
      });
    });
  }
  function payloadToGrid(p) {
    var grid = [], cols = (p.table && p.table.cols) || [];
    if (cols.some(function (c) { return c && c.label; })) grid.push(cols.map(function (c) { return (c && c.label) || ""; }));
    ((p.table && p.table.rows) || []).forEach(function (r) {
      grid.push((r.c || []).map(function (x) {
        if (!x) return "";
        if (typeof x.v === "string" && x.v.indexOf("Date(") === 0) return x.f != null ? x.f : x.v;
        if (typeof x.v === "number" && x.f && String(x.f).indexOf("%") >= 0) return x.f;
        return x.v != null ? x.v : (x.f != null ? x.f : "");
      }));
    });
    return grid;
  }
  function downloadGrid(grid, name) {
    return loadXlsx().then(function (XLSX) { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), "Sheet1"); XLSX.writeFile(wb, name); });
  }
  function payloadOf(t) {
    return wfetch("getTargets", { timeout: 15000 }, "&type=" + t.type).then(function (p) { if (p && p.table) return p; return (typeof loadSheetWithRetry === "function") ? loadSheetWithRetry(t.gid) : null; });
  }

  // ---------------------------------------------------------------- UI shell: nav + views + banner
  function injectShell() {
    if ($("navTowerGroup")) return;
    var nav = document.querySelector(".sidebar-nav"), main = document.querySelector("main.content");
    if (!nav || !main) return;
    var wrap = document.createElement("div"); wrap.className = "nav-dropdown-wrapper tw-off"; wrap.id = "navTowerGroup";
    wrap.innerHTML = '<a class="nav-item" id="navTowerToggle"><span class="nav-icon"></span>Control<span class="nav-caret" id="navTowerCaret">▼</span></a>' +
      '<div class="nav-submenu hidden" id="towerSubmenu"><a class="nav-item-sub" id="navTowerRoles">Users &amp; Roles</a><a class="nav-item-sub" id="navTowerTargets">Targets Upload</a></div>';
    var before = $("navSyncStatus");
    if (before && before.parentNode === nav) nav.insertBefore(wrap, before); else nav.appendChild(wrap);
    $("navTowerToggle").addEventListener("click", function () { var m = $("towerSubmenu"); m.classList.toggle("hidden"); $("navTowerCaret").classList.toggle("rotate", m.classList.contains("hidden") ? false : true); });
    $("navTowerRoles").addEventListener("click", function () { switchView("towerRoles"); });
    $("navTowerTargets").addEventListener("click", function () { switchView("towerTargets"); });
    var inv = document.createElement("a"); inv.className = "nav-item tw-off"; inv.id = "navTowerInvite"; inv.innerHTML = '<span class="nav-icon"></span>Invite people';
    if (before && before.parentNode === nav) nav.insertBefore(inv, before); else nav.appendChild(inv);
    inv.addEventListener("click", function () { window.switchView("towerInvite"); });
    ["towerRoles", "towerTargets", "towerInvite"].forEach(function (v) {
      var d = document.createElement("div"); d.id = "view" + v.charAt(0).toUpperCase() + v.slice(1); d.className = "view-section hidden"; main.appendChild(d);
    });
  }
  // "View as": Admin / Country Manager can preview the dashboard exactly as any other role sees it.
  function renderViewAs() {
    var b = $("twViewAs"), footer = document.querySelector(".sidebar-footer");
    if (!footer || !isRealAdmin()) { if (b) b.remove(); try { sessionStorage.removeItem(PREVIEW_SS); } catch (e) {} return; }
    var roles = Object.keys(getCfg().roles), cur = "";
    try { cur = sessionStorage.getItem(PREVIEW_SS) || ""; } catch (e) {}
    if (cur && roles.indexOf(cur) < 0) cur = "";
    var sig = roles.join("|") + "#" + realRoleName();
    if (!b) { b = document.createElement("div"); b.id = "twViewAs"; var badge = $("authUserBadge"); if (badge && badge.parentNode === footer) footer.insertBefore(b, badge); else footer.appendChild(b); }
    if (b.getAttribute("data-sig") !== sig) {
      b.setAttribute("data-sig", sig);
      b.innerHTML = '<label>View as <span>(preview a role)</span></label><select id="twViewAsSel"><option value="">My role (' + esc(realRoleName()) + ')</option>' + roles.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join("") + '</select>';
      $("twViewAsSel").onchange = function () { setPreview(this.value || null); };
    }
    var sel = $("twViewAsSel"); if (sel && sel.value !== cur) sel.value = cur;
    b.classList.toggle("on", !!cur);
  }
  // Simple sidebar status block: dot + status, then "updated" and version on one row.
  var NAV_ICONS = {
    navOverview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    navAcmToggle: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.2c2.6.2 4.5 2 4.5 5"/>',
    navMerchantPerf: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
    navCommercialToggle: '<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/>',
    navSupplyChainToggle: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    navMarketplaceToggle: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    navIncentivesToggle: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    navAdminToggle: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    navTowerToggle: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    navSyncStatus: '<path d="M3 12h4l2-6 4 12 2-6h6"/>'
  };
  var CARET_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  function iconifyNav() {
    Object.keys(NAV_ICONS).forEach(function (id) {
      var a = document.getElementById(id); if (!a) return;
      var ic = a.querySelector(".nav-icon");
      if (ic && !ic.getAttribute("data-svg")) {
        ic.setAttribute("data-svg", "1");
        ic.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + NAV_ICONS[id] + '</svg>';
      }
    });
    document.querySelectorAll(".sidebar-nav .nav-caret").forEach(function (c) {
      if (!c.getAttribute("data-svg")) { c.setAttribute("data-svg", "1"); c.innerHTML = CARET_SVG; }
    });
  }
  function tidyStatus() {
    var footer = document.querySelector(".sidebar-footer"), st = $("sidebarStatus"), up = $("sidebarUpdated"), ver = $("sidebarVersion");
    if (!footer || !st || !up || !ver) return;
    var w = $("twStatus");
    if (!w) { w = document.createElement("div"); w.id = "twStatus"; footer.insertBefore(w, footer.firstChild); w.appendChild(st); w.appendChild(up); w.appendChild(ver); }
    var t = (st.textContent || "").toLowerCase();
    w.classList.toggle("warn", /fail|cached|retry|offline/.test(t));
  }
  function setPreview(role) { try { if (role) sessionStorage.setItem(PREVIEW_SS, role); else sessionStorage.removeItem(PREVIEW_SS); } catch (e) {} applyNav(); window.switchView("overview"); }

  // ---------------------------------------------------------------- Users & Roles page
  var usersCache = null, usersInflight = null, USERS_LS = "twUsersCache";
  function cachedUsers() { if (usersCache) return usersCache; try { var j = JSON.parse(ls(USERS_LS) || "null"); if (j && Array.isArray(j.users)) { usersCache = j.users; return usersCache; } } catch (e) {} return null; }
  function loadRegisteredUsers() {
    var api = (typeof DATA_API_URL !== "undefined" && DATA_API_URL) || "";
      function viaAppsScript() {
        var keys = [ls("towerUsersKey"), adminKey(), "Admin-Panal-Center"].filter(function (k, i, a) { return k && a.indexOf(k) === i; });
        function next(i) {
          if (i >= keys.length) return Promise.reject(new Error("keys rejected"));
          return fetch(api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "list_users", key: keys[i] }) })
            .then(function (r) { return r.text(); })
            .then(function (t) { var j = JSON.parse(t); if (j && j.success && Array.isArray(j.users)) { ls("towerUsersKey", keys[i]); return j.users; } return next(i + 1); });
        }
        return next(0);
      }
      // Fallback: read ONLY name/email/role columns (A,B,D) of the Users sheet — the password column is never requested.
      function viaSheet() {
        if (typeof fcLoadGvizQuery !== "function") return Promise.reject(new Error("sheet reader unavailable"));
        return fcLoadGvizQuery("1839838273", "select A,B,D", 20000).then(function (p) {
          var out = [];
          ((p && p.table && p.table.rows) || []).forEach(function (r) {
            var c = r.c || [], em = String((c[1] && (c[1].v != null ? c[1].v : c[1].f)) || "").trim().toLowerCase();
            if (em.indexOf("@") < 0) return;
            out.push({ name: String((c[0] && c[0].v) || ""), email: em, role: String((c[2] && c[2].v) || "") });
          });
          if (!out.length) throw new Error("no users in sheet");
          return out;
        });
      }
    if (usersInflight) return usersInflight;
    usersInflight = new Promise(function (resolve, reject) {
      var fails = 0, done = false;
      function bad(e) { if (++fails === 2 && !done) reject(e); }
      function ok(u) { if (done) return; done = true; usersCache = u; ls(USERS_LS, JSON.stringify({ at: Date.now(), users: u })); resolve(u); }
      viaAppsScript().then(ok, bad); viaSheet().then(ok, bad);
    }).then(function (u) { usersInflight = null; return u; }, function (e) { usersInflight = null; throw e; });
    return usersInflight;
  }
  var usersLoading = false, draft = null, editRole = "Admin", usersLoaded = false, rolesTab = "people", peopleQ = "", addOpen = false, pendingInvites = {}, pendingReqs = [];
  var ROLE_COLORS = ["#60a5fa", "#fbbf24", "#38bdf8", "#a78bfa", "#34d399", "#fb7185", "#f472b6", "#2dd4a8"];
  function roleColor(name) { var i = Object.keys((draft || getCfg()).roles).indexOf(name); return ROLE_COLORS[(i < 0 ? 0 : i) % ROLE_COLORS.length]; }
  function initials(n) { var p = String(n || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean); return ((p[0] || "?")[0] + ((p[1] || "")[0] || "")).toUpperCase(); }
  function scopeOf(role) { var r = draft.roles[role]; if (!r) return "—"; if (r.views === "*") return "Everything"; var n = (r.views || []).length; return n + " section" + (n === 1 ? "" : "s"); }
  function mergeUsers(users) {
    var added = 0;
    users.forEach(function (u) { if (!draft.users[u.email]) { draft.users[u.email] = { role: draft.roles[u.role] ? u.role : draft.defaultRole, name: u.name }; added++; } else if (typeof draft.users[u.email] === "object" && !draft.users[u.email].name && u.name) draft.users[u.email].name = u.name; });
    return added;
  }
  function saveDraft(done, fail) {
    FULL_ROLES.forEach(function (n) { draft.roles[n] = { views: "*", admin: true }; });
    return wfetch("putAccess", { body: JSON.stringify(draft) }).then(function () { cfg = normCfg(JSON.parse(JSON.stringify(draft))); ls(ACCESS_LS, JSON.stringify(cfg)); applyNav(); if (done) done(); }).catch(function (e) { if (fail) fail(e); });
  }
  // Invite email for users added by hand (not for self-registered ones). Runs after a successful save.
  function sendInvitesAfterSave() {
    var list = Object.keys(pendingInvites).filter(function (em) { return draft && draft.users[em]; }).map(function (em) { return { email: em, role: (typeof draft.users[em] === "object" ? draft.users[em].role : draft.users[em]) || pendingInvites[em] }; });
    if (!list.length) return Promise.resolve("");
    return wfetch("sendInvites", { body: JSON.stringify({ invites: list, url: location.origin + "/" }) }).then(function (j) {
      pendingInvites = {};
      return " Invite email sent to " + list.length + " user" + (list.length > 1 ? "s" : "") + " ✓";
    }).catch(function (e) { return " — saved, but the invite email failed: " + e.message; });
  }
  function acmNames() { var out = []; try { (state.acmTableData || []).forEach(function (a) { if (a.name && out.indexOf(a.name) < 0) out.push(a.name); }); } catch (e) {} return out.sort(); }
  function openUserModal(email) {
    var u0 = draft.users[email]; if (u0 === undefined) return; var u = typeof u0 === "string" ? { role: u0 } : u0;
    var roleNames = Object.keys(draft.roles), acms = acmNames(); if (u.acm && acms.indexOf(u.acm) < 0) acms.unshift(u.acm);
    var m = document.createElement("div"); m.className = "tw-modal";
    var opts = function (arr, sel) { return arr.map(function (r) { return '<option' + (r === sel ? " selected" : "") + '>' + esc(r) + '</option>'; }).join(""); };
    m.innerHTML = '<div class="tw-mback"></div><div class="tw-mbox"><div class="tw-mhead"><h3>Edit ' + esc(u.name || email) + '</h3><button class="tw-x" data-x aria-label="Close">✕</button></div>' +
      '<div class="tw-mbody"><div class="tw-mgrid"><div class="tw-field"><label>Full name</label><input id="muName" value="' + esc(u.name || "") + '"></div><div class="tw-field"><label>Work email</label><input id="muEmail" type="email" value="' + esc(email) + '"></div>' +
      '<div class="tw-field"><label>Role</label><select id="muRole">' + opts(roleNames, u.role || draft.defaultRole) + '</select></div><div class="tw-field"><label>Status</label><select id="muStatus">' + opts(["active", "inactive"], u.status || "active") + '</select></div></div>' +
      '<div class="tw-field"><label>Linked ACM account</label><select id="muAcm"><option value="">— none —</option>' + acms.map(function (n) { return '<option' + (n === u.acm ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("") + '</select><div class="tw-muted">Used to deliver alerts about this ACM\'s portfolio to this person. Inactive people fall back to the default role.</div></div><div class="tw-msg" id="muMsg"></div></div>' +
      '<div class="tw-mfoot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" id="muSave">Save</button></div></div>';
    document.body.appendChild(m);
    var close = function () { m.remove(); };
    m.querySelectorAll("[data-x]").forEach(function (b) { b.onclick = close; }); m.querySelector(".tw-mback").onclick = close;
    m.querySelector("#muSave").onclick = function () {
      var em = m.querySelector("#muEmail").value.trim().toLowerCase(), msg = m.querySelector("#muMsg");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { msg.className = "tw-msg err"; msg.textContent = "Enter a valid email."; return; }
      var nu = { role: m.querySelector("#muRole").value, name: m.querySelector("#muName").value.trim(), status: m.querySelector("#muStatus").value };
      var acm = m.querySelector("#muAcm").value; if (acm) nu.acm = acm;
      if (em !== email) delete draft.users[email]; draft.users[em] = nu;
      msg.className = "tw-msg"; msg.textContent = "Saving…";
      saveDraft(function () { close(); renderRoles(); var sm = $("twSaveMsg"); if (sm) { sm.className = "tw-msg ok"; sm.textContent = "Saved ✓"; } }, function (e) { msg.className = "tw-msg err"; msg.textContent = e.message + (e.status === 403 ? " — set the admin key in the Roles tab." : ""); });
    };
  }
  function renderRoles() {
    var host = $("viewTowerRoles"); if (!host) return;
    if (!usersLoaded) usersLoading = true;
    if (!draft) { draft = JSON.parse(JSON.stringify(getCfg())); var cu = cachedUsers(); if (cu) mergeUsers(cu); }
    if (!draft.roles[editRole]) editRole = Object.keys(draft.roles)[0];
    var roleNames = Object.keys(draft.roles);
    var roleOpts = function (sel) { return roleNames.map(function (r) { return '<option' + (r === sel ? " selected" : "") + '>' + esc(r) + '</option>'; }).join(""); };
    var uList = Object.keys(draft.users).map(function (em) { var u = typeof draft.users[em] === "string" ? { role: draft.users[em] } : draft.users[em]; return { email: em, name: u.name || "", role: u.role || draft.defaultRole, status: u.status || "active" }; });
    var tabsHtml = [["people", "People"], ["permissions", "Permissions"], ["roles", "Roles"]].map(function (t) { return '<button class="tw-ut' + (rolesTab === t[0] ? " on" : "") + '" data-rt="' + t[0] + '">' + t[1] + '</button>'; }).join("");
    var body = "";
    if (rolesTab === "people") {
      var q = peopleQ.toLowerCase();
      var rows = uList.filter(function (u) { return !q || (u.name + " " + u.email + " " + u.role).toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
      var pendHtml = pendingReqs.length ? '<div class="tw-card" style="border-color:#fbbf24"><div class="tw-ch"><div><h3>Waiting for approval (' + pendingReqs.length + ')</h3><div class="tw-muted">These people tried to sign in. Pick a role, then approve.</div></div></div><table class="tw-table"><tbody>' + pendingReqs.map(function (r) {
        return '<tr><td><div class="tw-pn">' + esc(r.name || r.email.split("@")[0]) + '</div><div class="tw-muted">' + esc(r.email) + (r.invitedBy ? ' · invited by ' + esc(r.invitedBy) : '') + '</div></td><td><select data-preq-role="' + esc(r.email) + '" style="min-height:34px;padding:0 8px">' + roleOpts(r.role && draft.roles[r.role] ? r.role : draft.defaultRole) + '</select></td><td style="text-align:right"><button class="btn small btn-primary" data-preq-ok="' + esc(r.email) + '">Approve</button> <button class="btn small danger" data-preq-no="' + esc(r.email) + '">Reject</button></td></tr>';
      }).join("") + '</tbody></table><span class="tw-msg" id="twPendMsg"></span></div>' : "";
      var trs = rows.map(function (u) {
        var c = roleColor(u.role);
        return '<tr class="tw-prow" data-edit="' + esc(u.email) + '"><td><div class="tw-person"><span class="tw-av" style="background:' + c + '">' + esc(initials(u.name || u.email)) + '</span><div><div class="tw-pn">' + esc(u.name || u.email.split("@")[0]) + '</div><div class="tw-muted">' + esc(u.email) + '</div></div></div></td>' +
          '<td><select class="tw-rolechip" style="background:' + c + '" data-urole="' + esc(u.email) + '">' + roleOpts(u.role) + '</select></td><td>' + esc(scopeOf(u.role)) + '</td><td><span class="tw-pill ' + (u.status === "inactive" ? "warn" : "good") + '">' + (u.status === "inactive" ? "Inactive" : "Active") + '</span></td>' +
          '<td style="text-align:right"><button class="btn small danger" data-udel="' + esc(u.email) + '">Remove</button></td></tr>';
      }).join("") || '<tr><td colspan="5" class="tw-muted" style="padding:22px">No people match.</td></tr>';
      body = pendHtml + '<div class="tw-card"><div class="tw-ch"><div><h3>People in Egypt</h3><div class="tw-muted">' + (usersLoading && !uList.length ? 'Loading people…' : uList.length + ' users. Click a row to edit, or change the role from the chip.') + '</div></div>' +
        '<div class="tw-row"><input type="search" id="twPQ" placeholder="Search people" value="' + esc(peopleQ) + '" style="min-height:36px;padding:0 10px;min-width:200px"><button class="btn btn-primary" id="twAddToggle">+ Add user</button></div></div>' +
        (addOpen ? '<div class="tw-row tw-addrow"><input id="twNewEmail" type="email" placeholder="name@taager.com" style="min-width:240px;padding:0 10px;min-height:36px"><select id="twNewRole" style="min-height:36px;padding:0 10px">' + roleOpts(draft.defaultRole) + '</select><button class="btn" id="twUserAdd">Add</button></div>' : "") +
        '<div class="tw-scroll"><table class="tw-table tw-people-t"><thead><tr><th>Person</th><th>Role</th><th>Scope</th><th>Status</th><th></th></tr></thead><tbody>' + trs + '</tbody></table></div><div class="tw-msg" id="twUsersMsg"></div></div>';
    } else if (rolesTab === "permissions") {
      var model = navModel();
      var head = '<tr><th>Section</th>' + roleNames.map(function (r) { return '<th class="c"><span class="tw-dot" style="background:' + roleColor(r) + '"></span>' + esc(r) + '</th>'; }).join("") + '</tr>';
      var cell = function (id, grp) { return roleNames.map(function (r) { var rv = draft.roles[r].views, on = rv === "*" || (rv || []).indexOf(id) >= 0; return '<td class="c"><label class="tw-sw"><input type="checkbox" data-pm="' + esc(r) + '|' + id + '"' + (on ? " checked" : "") + (FULL_ROLES.indexOf(r) >= 0 ? " disabled" : "") + '><span></span></label></td>'; }).join(""); };
      var trs2 = model.map(function (g) {
        var out = '<tr class="' + (g.subs.length ? "tw-grp" : "") + '"><td>' + esc(g.label) + (g.subs.length ? '<span class="tw-muted"> · group</span>' : "") + '</td>' + cell(g.id) + '</tr>';
        g.subs.forEach(function (s) { out += '<tr><td class="tw-sub">' + esc(s.label) + '</td>' + cell(s.id) + '</tr>'; });
        return out;
      }).join("");
      body = '<div class="tw-card"><div class="tw-ch"><div><h3>Permissions</h3><div class="tw-muted">Tick which sections each role can open. Admin and Country Manager always see everything, including Control.</div></div></div><div class="tw-scroll"><table class="tw-table tw-matrix"><thead>' + head + '</thead><tbody>' + trs2 + '</tbody></table></div></div>';
    } else {
      var cards = roleNames.map(function (r) {
        var n = uList.filter(function (u) { return u.role === r; }).length;
        return '<div class="tw-rolecard' + (r === editRole ? " on" : "") + '" data-rc="' + esc(r) + '"><span class="tw-dot" style="background:' + roleColor(r) + '"></span><div><b>' + esc(r) + '</b><div class="tw-muted">' + n + ' people · ' + esc(scopeOf(r)) + '</div></div></div>';
      }).join("");
      body = '<div class="tw-card"><div class="tw-ch"><div><h3>Roles</h3><div class="tw-muted">Select a role to manage it. Section access is edited in Permissions.</div></div>' +
        '<div class="tw-row"><button class="btn btn-primary" id="twRoleNew">+ New role</button><button class="btn danger" id="twRoleDel"' + (["Admin", "Country Manager", "Merchant"].indexOf(editRole) >= 0 ? " disabled" : "") + '>Delete “' + esc(editRole) + '”</button></div></div><div class="tw-rolegrid">' + cards + '</div></div>' +
        '<div class="tw-card"><h3>Sign-up defaults</h3><div class="tw-row" style="margin-top:10px"><label class="tw-check"><input type="checkbox" id="twTrust"' + (draft.trustLoginRole ? " checked" : "") + '> Trust the role picked at sign-up for people not listed in People</label></div>' +
        '<div class="tw-row" style="margin-top:10px"><label class="tw-check"><input type="checkbox" id="twReqAppr"' + (draft.requireApproval ? " checked" : "") + '> Require admin approval: anyone not listed in People waits for approval before entering</label></div>' +
        '<div class="tw-row" style="margin-top:10px"><span class="tw-muted">Default role for everyone else:</span><select id="twDefRole" style="min-height:34px;padding:0 8px">' + roleOpts(draft.defaultRole) + '</select></div></div>' +
        '<div class="tw-card"><h3>Admin key</h3><div class="tw-muted">Needed once per browser to save changes, upload targets and send alerts. It is the ADMIN_KEY secret of the Worker.</div><div class="tw-row" style="margin-top:10px"><input type="password" id="twKey" placeholder="ADMIN_KEY (Worker secret)" value="' + esc(adminKey()) + '" style="min-width:260px;padding:0 10px;min-height:36px"><button class="btn" id="twKeyCheck">Save &amp; check</button><span class="tw-msg" id="twKeyMsg"></span></div></div>';
    }
    host.innerHTML = '<div class="tw-page"><div class="tw-uts">' + tabsHtml + '</div>' + body +
      '<div class="tw-savebar"><button class="btn btn-primary" id="twSave">Save changes</button><button class="btn" id="twDiscard">Discard</button><span class="tw-msg" id="twSaveMsg"></span><span class="tw-muted">Changes apply to everyone within ~5 minutes (or on reload).</span></div></div>';
    host.querySelectorAll("[data-rt]").forEach(function (b) { b.onclick = function () { rolesTab = b.dataset.rt; renderRoles(); }; });
    host.querySelectorAll("[data-pm]").forEach(function (c) { c.onchange = function () { var p = c.dataset.pm.split("|"), r = draft.roles[p[0]]; if (r.views === "*") return; var set = {}; (r.views || []).forEach(function (v) { set[v] = 1; }); if (c.checked) set[p[1]] = 1; else delete set[p[1]];
      var g = navModel().filter(function (x) { return x.id === p[1]; })[0]; if (g) g.subs.forEach(function (s) { if (c.checked) set[s.id] = 1; else delete set[s.id]; });
      r.views = Object.keys(set); renderRoles(); }; });
    host.querySelectorAll("[data-rc]").forEach(function (d) { d.onclick = function () { editRole = d.dataset.rc; renderRoles(); }; });
    var nb = $("twRoleNew"); if (nb) nb.onclick = function () { var n = (prompt("New role name:") || "").trim(); if (!n || draft.roles[n]) return; draft.roles[n] = { views: ["navOverview"] }; editRole = n; renderRoles(); };
    var db = $("twRoleDel"); if (db) db.onclick = function () { if (!confirm("Delete role " + editRole + "?")) return; delete draft.roles[editRole]; Object.keys(draft.users).forEach(function (em) { var u = draft.users[em]; if (typeof u === "object" && u.role === editRole) u.role = draft.defaultRole; }); editRole = "Admin"; renderRoles(); };
    host.querySelectorAll("[data-urole]").forEach(function (s) { s.onchange = function () { var u = draft.users[s.dataset.urole]; draft.users[s.dataset.urole] = Object.assign(typeof u === "string" ? {} : u, { role: s.value }); renderRoles(); }; });
    host.querySelectorAll("[data-udel]").forEach(function (b) { b.onclick = function () { delete draft.users[b.dataset.udel]; renderRoles(); }; });
    host.querySelectorAll("tr[data-edit]").forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest("select,button,input")) return; openUserModal(tr.dataset.edit); }; });
    var pq = $("twPQ"); if (pq) pq.oninput = function () { peopleQ = pq.value; var pos = pq.selectionStart; renderRoles(); var n = $("twPQ"); n.focus(); n.setSelectionRange(pos, pos); };
    var at = $("twAddToggle"); if (at) at.onclick = function () { addOpen = !addOpen; renderRoles(); };
    var ua = $("twUserAdd"); if (ua) ua.onclick = function () { var em = $("twNewEmail").value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { $("twSaveMsg").className = "tw-msg err"; $("twSaveMsg").textContent = "Enter a valid email."; return; } var nr = $("twNewRole").value; draft.users[em] = { role: nr }; pendingInvites[em] = nr; addOpen = false; renderRoles(); };
    function loadPending() { if (!adminKey()) return; wfetch("getPending", { admin: true }).then(function (j) { var n = (j && j.pending) || []; if (JSON.stringify(n) !== JSON.stringify(pendingReqs)) { pendingReqs = n; renderRoles(); } }).catch(function () {}); }
    host.querySelectorAll("[data-preq-ok]").forEach(function (b) { b.onclick = function () {
      var em = b.dataset.preqOk, rs = host.querySelector('[data-preq-role="' + em + '"]'), role = rs ? rs.value : draft.defaultRole, r0 = pendingReqs.filter(function (x) { return x.email === em; })[0] || {};
      b.disabled = true; draft.users[em] = { role: role, name: r0.name || undefined }; pendingInvites[em] = role;
      saveDraft(function () { sendInvitesAfterSave().then(function () { return wfetch("resolvePending", { body: JSON.stringify({ emails: [em] }) }); }).then(function () { pendingReqs = pendingReqs.filter(function (x) { return x.email !== em; }); renderRoles(); }).catch(function () { renderRoles(); }); },
        function (e) { delete draft.users[em]; b.disabled = false; var m = $("twPendMsg"); if (m) { m.className = "tw-msg err"; m.textContent = e.message; } });
    }; });
    host.querySelectorAll("[data-preq-no]").forEach(function (b) { b.onclick = function () { var em = b.dataset.preqNo; wfetch("resolvePending", { body: JSON.stringify({ emails: [em] }) }).then(function () { pendingReqs = pendingReqs.filter(function (x) { return x.email !== em; }); renderRoles(); }).catch(function () {}); }; });
    if (!host._pendLoaded) { host._pendLoaded = true; loadPending(); }
    function loadRegistered() {
      usersLoading = true;
      loadRegisteredUsers().then(function (users) {
        usersLoading = false; var added = mergeUsers(users);
        renderRoles(); var mm = $("twUsersMsg"); if (mm && added) { mm.className = "tw-msg ok"; mm.textContent = added + " new registered user" + (added > 1 ? "s" : "") + " added — press Save changes to keep them."; }
      }).catch(function (e) { usersLoading = false; renderRoles(); var mm = $("twUsersMsg"); if (mm) { mm.className = "tw-msg err"; mm.textContent = "Could not read registered users (" + (e && e.message) + ")."; } });
    }
    if (!usersLoaded) { usersLoaded = true; loadRegistered(); }
    var ra = $("twReqAppr"); if (ra) ra.onchange = function (e) { draft.requireApproval = e.target.checked; };
    var tr = $("twTrust"); if (tr) tr.onchange = function (e) { draft.trustLoginRole = e.target.checked; };
    var dr = $("twDefRole"); if (dr) dr.onchange = function (e) { draft.defaultRole = e.target.value; };
    var kc = $("twKeyCheck"); if (kc) kc.onclick = function () { ls(KEY_LS, $("twKey").value.trim()); var m = $("twKeyMsg"); m.className = "tw-msg"; m.textContent = "Checking…"; wfetch("checkAdminKey", { body: "{}" }).then(function () { m.className = "tw-msg ok"; m.textContent = "Key accepted ✓"; }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message; }); };
    $("twDiscard").onclick = function () { draft = null; pendingInvites = {}; usersLoaded = false; renderRoles(); };
    $("twSave").onclick = function () {
      var m = $("twSaveMsg"); m.className = "tw-msg"; m.textContent = "Saving…";
      FULL_ROLES.forEach(function (n) { draft.roles[n] = { views: "*", admin: true }; });
      wfetch("putAccess", { body: JSON.stringify(draft) }).then(function () { cfg = normCfg(JSON.parse(JSON.stringify(draft))); ls(ACCESS_LS, JSON.stringify(cfg)); applyNav(); m.className = "tw-msg ok"; m.textContent = "Saved ✓"; return sendInvitesAfterSave().then(function (t) { if (t) { m.textContent = "Saved ✓" + t; if (t.indexOf("failed") >= 0) m.className = "tw-msg err"; } }); }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message + (e.status === 403 ? " — set the admin key in the Roles tab." : ""); });
    };
  }

  // ---------------------------------------------------------------- Targets page
  var tgState = {};
  function renderTargets() {
    var host = $("viewTowerTargets"); if (!host) return;
    var meta = (window.TowerTargets.meta || {});
    var cards = TARGET_TYPES.map(function (t) {
      var m = meta[t.type];
      var pill = m ? '<span class="tw-pill good">Uploaded · ' + esc(new Date(m.at).toLocaleString()) + '</span>' : '<span class="tw-pill warn">Google Sheet (fallback)</span>';
      var info = m ? '<div class="tw-muted">' + esc(m.rows) + ' rows · ' + esc(m.file || "") + (m.by ? " · " + esc(m.by) : "") + '</div>' : '<div class="tw-muted">Not uploaded yet — still reading the Google Sheet.</div>';
      return '<div class="tw-card tw-tgt" data-t="' + t.type + '"><div class="tw-tgt-top"><div><b>' + esc(t.title) + '</b><div class="tw-muted">' + esc(t.desc) + '</div></div>' + pill + '</div>' + info +
        '<label class="tw-drop" data-drop="' + t.type + '">Drop an .xlsx / .csv here or click to choose<input type="file" accept=".xlsx,.xls,.csv" hidden data-file="' + t.type + '"></label>' +
        '<div class="tw-msg" data-msg="' + t.type + '"></div><div data-prev="' + t.type + '"></div>' +
        '<div class="tw-row"><button class="btn small" data-tpl="' + t.type + '">Download current / template</button><button class="btn small" data-seed="' + t.type + '">Import Google Sheet now</button></div></div>';
    }).join("");
    host.innerHTML = '<div class="tw-page"><div class="tw-head"><h2>Targets Upload</h2><p>Egypt only. Upload each target file (first sheet of the workbook, same column layout as the old Google Sheet — header row included). The dashboard reads uploaded files automatically; until a file is uploaded it keeps using the Google Sheet.</p></div>' +
      '<div class="tw-card"><div class="tw-row"><input type="password" id="twKey2" placeholder="ADMIN_KEY" value="' + esc(adminKey()) + '" style="min-width:240px;padding:0 10px;min-height:36px"><button class="btn" id="twKey2Save">Save key</button><button class="btn" id="twSeedAll">Import all current Google Sheet data</button><span class="tw-msg" id="twTgMsg"></span></div></div>' +
      '<div class="tw-grid">' + cards + '</div></div>';
    $("twKey2Save").onclick = function () { ls(KEY_LS, $("twKey2").value.trim()); gmsg("Key saved.", "ok"); };
    $("twSeedAll").onclick = function () { if (!confirm("Copy the current Google Sheet data of all 5 targets into the dashboard storage?")) return; seed(TARGET_TYPES.slice()); };
    host.querySelectorAll("[data-file]").forEach(function (inp) { inp.onchange = function () { if (inp.files[0]) pick(inp.dataset.file, inp.files[0]); inp.value = ""; }; });
    host.querySelectorAll("[data-drop]").forEach(function (d) {
      ["dragenter", "dragover"].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.add("over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.remove("over"); }); });
      d.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) pick(d.dataset.drop, f); });
    });
    host.querySelectorAll("[data-tpl]").forEach(function (b) { b.onclick = function () { var t = TARGET_TYPES.filter(function (x) { return x.type === b.dataset.tpl; })[0]; tmsg(t.type, "Preparing file…"); payloadOf(t).then(function (p) { if (!p) throw new Error("No data to export."); return downloadGrid(payloadToGrid(p), "targets_" + t.type + ".xlsx"); }).then(function () { tmsg(t.type, "Downloaded.", "ok"); }).catch(function (e) { tmsg(t.type, e.message, "err"); }); }; });
    host.querySelectorAll("[data-seed]").forEach(function (b) { b.onclick = function () { seed(TARGET_TYPES.filter(function (x) { return x.type === b.dataset.seed; })); }; });
  }
  function gmsg(t, c) { var e = $("twTgMsg"); if (e) { e.className = "tw-msg " + (c || ""); e.textContent = t; } }
  function tmsg(type, t, c) { var e = document.querySelector('[data-msg="' + type + '"]'); if (e) { e.className = "tw-msg " + (c || ""); e.textContent = t; } }
  function putTarget(type, payload, file, rows) {
    return wfetch("putTargets", { body: JSON.stringify(payload), timeout: 60000 }, "&type=" + type).then(function () {
      var meta = Object.assign({}, window.TowerTargets.meta || {}); var s = session();
      meta[type] = { at: new Date().toISOString(), rows: rows, file: file, by: s ? s.email : "" };
      return wfetch("putTargets", { body: JSON.stringify(meta) }, "&type=meta").then(function () { window.TowerTargets.meta = meta; });
    });
  }
  function pick(type, file) {
    var t = TARGET_TYPES.filter(function (x) { return x.type === type; })[0];
    if (!adminKey()) { tmsg(type, "Enter and save the admin key first.", "err"); return; }
    tmsg(type, "Reading " + file.name + "…");
    parseFile(file).then(function (p) {
      tgState[type] = { payload: p, file: file.name };
      var rows = p.table.rows, show = rows.slice(0, 5).map(function (r) { return '<tr>' + (r.c || []).slice(0, 8).map(function (c) { return '<td>' + esc(c ? (c.f != null ? c.f : c.v) : "") + '</td>'; }).join("") + '</tr>'; }).join("");
      var prev = document.querySelector('[data-prev="' + type + '"]');
      prev.innerHTML = '<div class="table-responsive"><table class="tw-table">' + show + '</table></div><div class="tw-row" style="margin-top:8px"><button class="btn btn-primary small" id="twPub_' + type + '">Publish ' + rows.length + ' rows</button><button class="btn small" id="twCan_' + type + '">Cancel</button></div>';
      tmsg(type, "Check the preview, then publish.", "");
      $("twCan_" + type).onclick = function () { prev.innerHTML = ""; tmsg(type, ""); delete tgState[type]; };
      $("twPub_" + type).onclick = function () {
        tmsg(type, "Publishing…");
        putTarget(type, p, file.name, rows.length).then(function () { tmsg(type, "Published ✓ — refreshing dashboard data…", "ok"); setTimeout(function () { renderTargets(); var rb = $("refreshBtn"); if (rb) rb.click(); }, 400); }).catch(function (e) { tmsg(type, e.message + (e.status === 403 ? " — wrong admin key." : ""), "err"); });
      };
    }).catch(function (e) { tmsg(type, e.message, "err"); });
  }
  function seed(list) {
    if (!adminKey()) { gmsg("Enter and save the admin key first.", "err"); return; }
    if (typeof loadSheetWithRetry !== "function") { gmsg("Sheet loader not available.", "err"); return; }
    var chain = Promise.resolve(), done = 0;
    list.forEach(function (t) {
      chain = chain.then(function () { gmsg("Importing " + t.title + "…"); return loadSheetWithRetry(t.gid); }).then(function (p) {
        if (!p || !p.table || !(p.table.rows || []).length) throw new Error(t.title + ": the Google Sheet returned no rows.");
        return putTarget(t.type, p, "Google Sheet import", p.table.rows.length);
      }).then(function () { done++; });
    });
    chain.then(function () { gmsg("Imported " + done + " sheet(s) ✓", "ok"); renderTargets(); }).catch(function (e) { gmsg(e.message, "err"); });
  }


  // ---------------------------------------------------------------- Hubs: one sidebar item, tabs inside (Control Tower style)
  var HUBS = [
    { toggle: "navCommercialToggle", title: "Commercial", tabs: [
      { nav: "navTargetsCommercial", view: "targetsCommercial", label: "Targets" },
      { nav: "navCommercialDebundlized", view: "commercialDebundlized", label: "Commercial Plan" },
      { nav: "navCm3AnalystProducts", view: "cm3AnalystProducts", label: "CM3 Analyst / Products" },
      { nav: "navPpmAnalystProducts", view: "ppmAnalystProducts", label: "Analyst / Products" },
      { nav: "navPpmAnalystSingle", view: "ppmAnalystSingle", label: "Analyst / Single" }
    ] },
    { toggle: "navSupplyChainToggle", title: "Supply Chain", tabs: [
      { nav: "navScAging", view: "scAging", label: "Inventory Aging" },
      { nav: "navScSkus", view: "scSkus", label: "SKU Analysis" },
      { nav: "navScActions", view: "scActions", label: "Action Plan" },
      { nav: "navPurchasePlan", view: "purchasePlan", label: "Purchase Plan" },
      { nav: "navDohPlanner", view: "dohPlanner", label: "Planner DOH" }
    ] },
    { toggle: "navMarketplaceToggle", title: "Marketplace", groups: [
      { label: "Inventory", tabs: [
        { nav: "navInventory", view: "inventory", label: "Inventory" }
      ] },
      { label: "CM3", tabs: [
        { nav: "navCm3Analyst", view: "cm3Analyst", label: "CM3 Analyst" }
      ] },
      { label: "Matches", tabs: [
        { nav: "navProductsMatchesAnalyst", view: "productsMatchesAnalyst", label: "Matches / Single" },
        { nav: "navMpMatches", view: "mpMatches", label: "Performance-Matches" },
        { nav: "navMpNewMatches", view: "mpNewMatches", label: "New Matches" },
        { nav: "navPoorMatches", view: "poorMatches", label: "Poor Matches" },
        { nav: "navMpDeclineWatch", view: "mpDeclineWatch", label: "Decline Matches" }
      ] },
      { label: "Locking", tabs: [
        { nav: "navAvailabilityLocking", view: "availabilityLocking", label: "Availability Locking" },
        { nav: "navAllocationLocking", view: "allocationLocking", label: "Allocation Locking" },
        { nav: "navHealthyUnlocking", view: "healthyUnlocking", label: "Unlocking Action's" }
      ] }
    ] },
    { toggle: "navTowerToggle", title: "Control", tabs: [
      { nav: "navTowerRoles", view: "towerRoles", label: "Users & Roles" },
      { nav: "navTowerTargets", view: "towerTargets", label: "Targets Upload" },
      { nav: "navTowerAlerts", view: "towerAlerts", label: "Alerts Centre" },
      { nav: "navTowerSettings", view: "towerSettings", label: "Settings" },
      { nav: "navTowerActivity", view: "towerActivity", label: "Activity Log" }
    ] },
    { toggle: "navAdminToggle", title: "Admin Panel", tabs: [
      { nav: "navSegmentationPanel", view: "segmentation", label: "Segmentation Panel" },
      { nav: "navSellthroughPanel", view: "sellthrough", label: "Sellthrough Rate Panel" },
      { nav: "navWeeklyInventory", view: "weeklyInventory", label: "Inventory & Inbound" },
      { nav: "navForecastModel", view: "forecastModel", label: "Forecast Model" }
    ] },
    { toggle: "navIncentivesToggle", title: "Incentives Tracker", tabs: [
      { nav: "navIncMerchants", view: "incentiveMerchants", label: "Incentive Merchants" }
    ] },
    { toggle: "navAcmToggle", title: "Account Manager", tabs: [
      { nav: "navAcmPerf", view: "acmPerformance", label: "Performance ACM" },
      { nav: "navMpSalesPlan", view: "mpSalesPlan", label: "Sales Plan-ACM" },
      { nav: "navSpFeedback", view: "spFeedback", label: "Sales Plan - Feedback" }
    ] }
  ];
  HUBS.forEach(function (h) { if (h.groups) { h.tabs = []; h.groups.forEach(function (g) { g.tabs.forEach(function (t) { t.group = g; h.tabs.push(t); }); }); } });
  var lastHubView = {}, topbarOrig = null, subOrig = null;
  function hubOfView(v) { for (var i = 0; i < HUBS.length; i++) for (var j = 0; j < HUBS[i].tabs.length; j++) if (HUBS[i].tabs[j].view === v) return HUBS[i]; return null; }
  function hubTabs(h) { return h.tabs.filter(function (t) { return allowed(t.nav); }); }
  function setupHubs() {
    HUBS.forEach(function (h) {
      var el = $(h.toggle); if (!el || el.dataset.twHub) return;
      el.dataset.twHub = "1"; el.classList.add("tw-hub");
      el.addEventListener("click", function (e) {
        e.stopImmediatePropagation(); e.preventDefault();
        var tabs = hubTabs(h); if (!tabs.length) return;
        var want = lastHubView[h.toggle], t = tabs.filter(function (x) { return x.view === want; })[0] || tabs[0];
        window.switchView(t.view);
      }, true);
    });
  }
  var SINGLE_TITLES = { overview: "Over View", merchantPerformance: "Merchants", towerRoles: "Users & Roles", towerTargets: "Targets Upload", towerInvite: "Invite people" };
  function navTitle(view) { var id = VIEW_NAV[view], el = id && $(id); return el ? el.textContent.replace(/[▼▲]/g, "").trim() : ""; }
  function updateHub(view) {
    var cur = hubOfView(view), bar = $("twTabs");
    HUBS.forEach(function (h) { var el = $(h.toggle); if (el) el.classList.toggle("active", h === cur); });
    var h1 = document.querySelector(".topbar-title h1");
    if (h1 && topbarOrig === null) topbarOrig = h1.textContent;
    if (h1) h1.textContent = cur ? cur.title : (SINGLE_TITLES[view] || (EXTRA_VIEWS[view] && EXTRA_VIEWS[view].label) || navTitle(view) || topbarOrig || h1.textContent);
    var pp = document.querySelector(".topbar-title p");
    if (pp) { if (subOrig === null) subOrig = pp.textContent; if (!isOwnView(view)) pp.textContent = subOrig; }
    if (!bar) return;
    if (isOwnView(view) && !cur) { bar.classList.add("tw-off"); return; }
    var tabs = [], groupsHtml = "";
    if (cur) { lastHubView[cur.toggle] = view; tabs = hubTabs(cur); }
    var curTab = tabs.filter(function (t) { return t.view === view; })[0], curGroup = curTab && curTab.group;
    if (cur && cur.groups) {
      var gs = cur.groups.filter(function (g) { return tabs.some(function (t) { return t.group === g; }); });
      groupsHtml = '<div class="tw-tabgroup tw-grps">' + gs.map(function (g) { var first = tabs.filter(function (t) { return t.group === g; })[0]; return '<button type="button" class="tw-tab tw-grp' + (g === curGroup ? " on" : "") + '" data-v="' + first.view + '">' + g.label + '</button>'; }).join("") + '</div>';
      tabs = tabs.filter(function (t) { return t.group === curGroup; });
    }
    var showTabs = tabs.length > 1;
    bar.innerHTML = groupsHtml + '<div class="tw-tabgroup' + (showTabs ? '' : ' tw-off') + '">' + tabs.map(function (t) { return '<button type="button" class="tw-tab' + (t.view === view ? " on" : "") + '" data-v="' + t.view + '">' + t.label + '</button>'; }).join("") + '</div>';
    bar.classList.toggle("tw-off", !groupsHtml && !showTabs);
    bar.querySelectorAll(".tw-tab").forEach(function (b) { b.onclick = function () { window.switchView(b.dataset.v); }; });
  }

  // ---------------------------------------------------------------- Merchants tab: Control Tower-style toolbar (search + export) + stat strip
  function fmtC(n) { try { return typeof fmtMoneyCompact === "function" ? fmtMoneyCompact(n) : Math.round(n).toLocaleString(); } catch (e) { return String(n); } }
  function merchRows() { try { return (state && state.merchantTableData) || []; } catch (e) { return []; } }
  function injectMerchantsToolbar() {
    var v = $("viewMerchantPerformance"); if (!v || $("twMerchBar")) return;
    var bar = document.createElement("div"); bar.id = "twMerchBar";
    bar.innerHTML = '<div class="tw-stats" id="twMerchStats"></div>';
    v.insertBefore(bar, v.firstChild);
  }
  function refreshMerchantStats() {
    var host = $("twMerchStats"), v = $("viewMerchantPerformance"); if (!host || !v || v.classList.contains("hidden")) return;
    var rows = merchRows(), gmv = 0, placed = 0, delivered = 0;
    rows.forEach(function (m) { gmv += +m.deliveredGmv || 0; placed += +m.placed || 0; delivered += +m.delivered || 0; });
    var ndr = placed > 0 ? (delivered / placed) * 100 : 0;
    var tiles = [["Merchants", rows.length.toLocaleString()], ["Delivered GMV", fmtC(gmv)], ["Placed orders", Math.round(placed).toLocaleString()], ["NDR", ndr.toFixed(1) + "%"]];
    host.innerHTML = tiles.map(function (t) { return '<div class="tw-stat"><span>' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b></div>'; }).join("");
  }
  setInterval(refreshMerchantStats, 1500);

  // ---------------------------------------------------------------- wrap navigation
  var EXTRA_VIEWS = {};
  function isOwnView(n) { return n === "towerRoles" || n === "towerTargets" || n === "towerInvite" || !!EXTRA_VIEWS[n]; }
  function showOwnView(name) {
    var X = EXTRA_VIEWS[name];
    if (X) {
      document.querySelectorAll(".view-section").forEach(function (el) { el.classList.remove("active-view"); el.classList.add("hidden"); });
      document.querySelectorAll(".nav-item.active, .nav-item-sub.active").forEach(function (el) { el.classList.remove("active"); });
      var xs = $(X.sectionId); if (!xs) return;
      var xn = $(X.navId); if (xn) xn.classList.add("active");
      X.render(xs);
      xs.classList.remove("hidden"); setTimeout(function () { xs.classList.add("active-view"); }, 10);
      var hh = document.querySelector(".topbar-title p"); if (hh) hh.textContent = X.sub || "";
      return;
    }
    document.querySelectorAll(".view-section").forEach(function (el) { el.classList.remove("active-view"); el.classList.add("hidden"); });
    document.querySelectorAll(".nav-item.active, .nav-item-sub.active").forEach(function (el) { el.classList.remove("active"); });
    if (name === "towerInvite") {
      var iv = $("viewTowerInvite"); if (!iv) return;
      $("navTowerInvite").classList.add("active"); renderInvite();
      iv.classList.remove("hidden"); setTimeout(function () { iv.classList.add("active-view"); }, 10);
      var ih = document.querySelector(".topbar-title p"); if (ih) ih.textContent = "Invite people to the dashboard"; return;
    }
    var id = name === "towerRoles" ? "viewTowerRoles" : "viewTowerTargets", nid = name === "towerRoles" ? "navTowerRoles" : "navTowerTargets";
    var sec = $(id); if (!sec) return;
    $(nid).classList.add("active");
    if (name === "towerRoles") { draft = null; usersLoaded = false; renderRoles(); } else renderTargets();
    sec.classList.remove("hidden"); setTimeout(function () { sec.classList.add("active-view"); }, 10);
    var h = document.querySelector(".topbar-title p"); if (h) h.textContent = name === "towerRoles" ? "Users, roles & views" : "Targets upload";
  }
  // ---------------------------------------------------------------- entry view: ملفات زي inventory.html بتفتح على التاب بتاعتها (الداتا كلها بتتحمّل عادي)
  function initEntryView() {
    var want = window.__ENTRY_VIEW; if (!want || want === "overview") return;
    var tries = 0, iv = setInterval(function () {
      tries++;
      var user = (typeof getLoggedInUser === "function") ? getLoggedInUser() : null;
      if (user || tries > 240) { clearInterval(iv); if (user) window.switchView(want); }
    }, 500);
  }

  // اسم الملف في اللينك بيتغير مع التاب (inventory.html, mp-matches.html, ...) — كل ملف نسخة حقيقية من index.html فالـ reload بيفتح نفس التاب
  function twFileOf(view) { return view === "overview" ? "index.html" : view.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".html"; }
  function twViewOfFile(file) {
    file = (file || "").toLowerCase(); if (!file || file === "index.html") return "overview";
    for (var k in VIEW_NAV) if (twFileOf(k) === file) return k;
    return null;
  }
  function twPushUrl(name) {
    try {
      var nid = VIEW_NAV[name]; if (!nid) return; if (!allowed(nid)) name = "overview";
      var file = twFileOf(name), cur = location.pathname.split("/").pop() || "index.html";
      if (cur.toLowerCase() === file) return;
      history.pushState({ v: name }, "", new URL(file, location.href).href);
    } catch (e) {}
  }
  window.addEventListener("popstate", function () {
    var v = twViewOfFile(location.pathname.split("/").pop()) || "overview";
    window.__twNoPush = true; try { window.switchView(v); } finally { window.__twNoPush = false; }
  });

  function wrapNav() {
    if (window.__towerWrapped) return; window.__towerWrapped = true;
    var origSwitch = window.switchView, origAdmin = window.requestAdminAccess;
    window.switchView = function (name) {
      var res = window.__twSwitch(name); if (!window.__twNoPush) twPushUrl(name); return res;
    };
    window.__twSwitch = function (name) {
      var res;
      if (isOwnView(name)) { if (!(name === "towerInvite" ? canInvite() : (EXTRA_VIEWS[name] && EXTRA_VIEWS[name].open ? allowed(VIEW_NAV[name]) : isEffAdmin()))) { res = origSwitch("overview"); updateHub("overview"); return res; } res = showOwnView(name); updateHub(name); return res; }
      var nid = VIEW_NAV[name];
      if (nid && !allowed(nid)) { name = "overview"; }
      if (ADMIN_PW_VIEWS.indexOf(name) >= 0 && typeof isAdminUnlocked === "function" && !isAdminUnlocked() && origAdmin) { return origAdmin(name); }
      res = origSwitch(name); updateHub(name); return res;
    };
    if (origAdmin) window.requestAdminAccess = function (name) { var nid = VIEW_NAV[name]; if (nid && !allowed(nid)) return origSwitch("overview"); return origAdmin(name); };
  }



  // ---------------------------------------------------------------- per-table Export CSV (all pages), injected into every table panel header
  var ICON_DL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>';
  function injectExportButtons() {
    document.querySelectorAll(".data-table, .st-summary-table").forEach(function (t) {
      var panel = t.closest(".panel, .table-panel, .seg-section-card"); if (!panel) return;
      var head = panel.querySelector(".panel-head-modern"); if (!head || head.querySelector(".tw-exp")) return;
      var first = panel.querySelector(".data-table, .st-summary-table"); if (first !== t) return;
      var btn = document.createElement("button"); btn.type = "button"; btn.className = "tw-exp"; btn.title = "Download all rows as CSV";
      btn.innerHTML = ICON_DL + "<span>Export CSV</span>";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var h2 = panel.querySelector("h2"), title = h2 ? h2.innerText : "table";
        try { selectedTableForDownload = { el: t, title: title }; } catch (err) { return; }
        var go = $("confirmDownload"); if (!go) return;
        btn.classList.add("busy"); btn.querySelector("span").textContent = "Preparing…";
        go.click();
        setTimeout(function () { btn.classList.remove("busy"); btn.querySelector("span").textContent = "Export CSV"; }, 1800);
      });
      head.appendChild(btn);
    });
  }

  // ---------------------------------------------------------------- shared core for extra modules (alerts.js)
  window.TowerCore = {
    wfetch: wfetch, logActivity: logActivity, getSettings: getSettings, loadSettings: loadSettings, saveSettings: saveSettings, esc: esc, ls: ls, session: session, adminKey: adminKey, getCfg: getCfg, navModel: navModel,
    realRoleName: realRoleName, isRealAdmin: isRealAdmin, isEffAdmin: isEffAdmin, allowed: allowed,
    registerView: function (name, def) {
      EXTRA_VIEWS[name] = def;
      var main = document.querySelector("main.content");
      if (main && !$(def.sectionId)) { var d = document.createElement("div"); d.id = def.sectionId; d.className = "view-section hidden"; main.appendChild(d); }
      var sub = $("towerSubmenu");
      if (sub && !$(def.navId)) { var a = document.createElement("a"); a.className = "nav-item-sub"; a.id = def.navId; a.textContent = def.label; a.addEventListener("click", function () { window.switchView(name); }); sub.appendChild(a); }
    },
    loadUsers: function () { var c = cachedUsers(); if (c) { loadRegisteredUsers().catch(function () {}); return Promise.resolve(c); } return loadRegisteredUsers(); }, cachedUsers: cachedUsers,
    viewOptions: function () { var out = []; Object.keys(VIEW_NAV).forEach(function (v) { var el = $(VIEW_NAV[v]); if (el) out.push({ view: v, label: el.textContent.replace(/[▼▲]/g, "").trim() }); }); return out; }
  };

  // ---------------------------------------------------------------- light / dark theme toggle (top bar)
  var SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  // Chart.js: charts hardcode dark-theme colours (grid #1e293b, ticks #94a3b8/#e2e8f0) -> remap them per theme.
  function chartLight() { return document.documentElement.getAttribute("data-theme") === "light"; }
  function twChartPlugin() {
    return {
      id: "twTheme",
      beforeInit: function (chart) { twApplyChart(chart); }
    };
  }
  function twApplyChart(chart) {
    {
      {
        var o = (chart.config && chart.config.options) || {}, light = chartLight(), sc = o.scales || {};
        chart.$twO = chart.$twO || {};
        Object.keys(sc).forEach(function (k) {
          var a = sc[k]; if (!a || typeof a !== "object") return;
          var st = chart.$twO[k] = chart.$twO[k] || { gc: a.grid && a.grid.color, tc: a.ticks && a.ticks.color, bc: a.border && a.border.color };
          if (a.grid && a.grid.display !== false) { a.grid.color = light ? "#e2e8f0" : st.gc; }
          a.ticks = a.ticks || {};
          a.ticks.color = light ? "#475569" : st.tc;
          if (a.title && typeof a.title === "object") { var tt = chart.$twO[k + "_t"] = chart.$twO[k + "_t"] || a.title.color; a.title.color = light ? "#475569" : tt; }
        });
        var lg = o.plugins && o.plugins.legend && o.plugins.legend.labels;
        if (lg) { if (chart.$twL === undefined) chart.$twL = lg.color; lg.color = light ? "#334155" : chart.$twL; }
      }
    }
  }
  function registerChartTheme() {
    if (!window.Chart || window.Chart.$twReg) return;
    try { window.Chart.register(twChartPlugin()); window.Chart.$twReg = true; } catch (e) {}
  }
  function refreshCharts() {
    registerChartTheme();
    try { var inst = window.Chart && window.Chart.instances; if (inst) Object.keys(inst).forEach(function (k) { try { twApplyChart(inst[k]); inst[k].update("none"); } catch (e) {} }); } catch (e) {}
  }
  registerChartTheme();
  document.addEventListener("DOMContentLoaded", registerChartTheme);
  window.addEventListener("load", refreshCharts);
  window.addEventListener("tw-theme", refreshCharts);
  function applyTheme(t) {
    if (t === "light") document.documentElement.setAttribute("data-theme", "light"); else document.documentElement.removeAttribute("data-theme");
    ls("twTheme", t);
    var b = $("twThemeBtn"); if (b) { b.innerHTML = t === "light" ? MOON : SUN; b.title = t === "light" ? "Switch to dark theme" : "Switch to light theme"; }
    try { window.dispatchEvent(new CustomEvent("tw-theme", { detail: t })); } catch (e) {}
  }
  function injectThemeBtn() {
    var host = document.querySelector(".topbar-actions"); if (!host || $("twThemeBtn")) return;
    var b = document.createElement("button"); b.id = "twThemeBtn"; b.type = "button"; b.className = "btn btn-outline tw-iconbtn";
    var rf = $("refreshBtn"); if (rf) host.insertBefore(b, rf); else host.appendChild(b);
    b.addEventListener("click", function () { applyTheme(ls("twTheme") === "light" ? "dark" : "light"); });
    applyTheme(ls("twTheme") === "light" ? "light" : "dark");
  }

  // ---------------------------------------------------------------- boot
  var lastEmail = null;
  function boot() {
    try { var c = ls(ACCESS_LS); if (c) cfg = normCfg(JSON.parse(c)); } catch (e) {}
    injectShell(); injectThemeBtn(); wrapNav(); initEntryView(); setupHubs(); injectMerchantsToolbar(); injectExportButtons(); applyNav(); updateHub("overview");
    loadAccess().then(function () { applyNav(); try { if (isRealAdmin()) loadRegisteredUsers().catch(function () {}); } catch (e) {} }); loadSettings();
    setInterval(function () { loadAccess().then(applyNav); }, 5 * 60 * 1000);
    setInterval(function () { iconifyNav(); tidyStatus(); injectExportButtons(); var s = session(), em = s && s.email; injectShell(); if (em !== lastEmail) { lastEmail = em; applyNav(); } else { var rr = document.querySelector("#authUserBadge .auth-profile-role"); if (rr && rr.textContent.indexOf(effRoleName()) !== 0) applyNav(); } }, 1000);
  }
  iconifyNav();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
