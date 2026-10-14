/* Taager Control Tower layer (v1.4.0): Roles + per-role Views + Targets uploaded from files.
   Loaded AFTER app.js. Storage = Cloudflare Worker KV (getAccess/putAccess/getTargets/putTargets).
   Login stays the Apps Script @taager.com login (js/auth.js); roles are tied to the logged-in email. */
(function () {
  "use strict";
  function workerUrl() { return (typeof SYNC_CDN_URL !== "undefined" && SYNC_CDN_URL) || ""; }
  var MANAGER_EMAIL = "youssef.hanafy@taager.com";
  // v1.16.0: لينك بورتال الميرشنتس (merchant-portal/) — حطه هنا بعد ما تعمله Deploy
  var MERCHANT_PORTAL_URL = "https://merchants.taager.app";
  var KEY_LS = "towerAdminKey", ACCESS_LS = "towerAccessCache", PREVIEW_SS = "towerPreviewRole", PREVIEW_MID = "towerPreviewMerchantId", SESSION_LS = "taagerDashboardSession";

  // view name (switchView) -> nav element id
  var VIEW_NAV = {
    overview: "navOverview", inventory: "navInventory",
    acmTargets: "navAcmTargets", acmPerformance: "navAcmPerf", merchantTargets: "navMerchantTargets", merchantPerformance: "navMerchantPerf", mpSalesPlan: "navMpSalesPlan", spFeedback: "navSpFeedback",
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
    { type: "merchants", gid: "115442405", title: "Merchant Targets", desc: "TAGER_ID · Tager_name · Target GMV (Actual) · Target Placed (Actual) — each merchant's ACM is picked up automatically and its target is added to that ACM" },
    { type: "acm", gid: " _Targets_ACM_ ", title: "KPI's Account Manager", desc: "KPI targets & weights used for the ACM Final Weight % (edit below)", editor: true },
    { type: "category", gid: "1656655269", title: "Category Targets (Commercial)", desc: "Category · Daily Target · CR % · DR % · ASP · CM3 · PPM …" },
    { type: "salesplan", gid: "892918900", title: "Sales Plan-ACM (daily)", desc: "SKU ID · Name · Category · Merchant ID · Merchant · Target · New Target · Flag" },
    { type: "singlesku", gid: "1620722565", title: "SKU Targets (Bundle & Single)", desc: "Overall SKU tracker — bundle and single SKUs: PRODUCT_ID · Name · Category · Placed · Confirmed · Delivered · GMV" }
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
        "Account Manager": { views: base.concat(g("navAcmToggle"), g("navMerchantsToggle"), g("navIncentivesToggle")) },
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
    // v1.15.49: إيميلات اللي بيوصلهم إشعار (Inbox + إيميل) لما حد يطلب دخول
    c.rejected = (Array.isArray(c.rejected) ? c.rejected : []).map(function (x) { return String(x || "").trim().toLowerCase(); }).filter(Boolean);
    c.approvers = (Array.isArray(c.approvers) ? c.approvers : []).map(function (x) { return String(x || "").trim().toLowerCase(); }).filter(function (x, i, a) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && a.indexOf(x) === i; });
    // v1.15.0: role "Viewer" was renamed "Merchant" — migrate saved configs
    if (c.roles.Viewer) { if (!c.roles.Merchant) c.roles.Merchant = c.roles.Viewer; delete c.roles.Viewer; }
    if (!c.roles.Merchant) c.roles.Merchant = d.roles.Merchant;
    if (c.defaultRole === "Viewer") c.defaultRole = "Merchant";
    Object.keys(c.users).forEach(function (em) { var u = c.users[em]; if (u === "Viewer") c.users[em] = "Merchant"; else if (u && typeof u === "object" && u.role === "Viewer") u.role = "Merchant"; });
    // v1.15.36: Target ACM / Merchant Targets tabs — أي دور كان شايف Performance ACM / Merchants يشوف التابات الجديدة كمان
    Object.keys(c.roles).forEach(function (n) {
      var r = c.roles[n]; if (!r || !Array.isArray(r.views)) return;
      var v = r.views, add = function (has, id) { if (v.indexOf(has) >= 0 && v.indexOf(id) < 0) v.push(id); };
      add("navAcmPerf", "navAcmTargets"); add("navMerchantPerf", "navMerchantTargets");
      if (v.indexOf("navMerchantPerf") >= 0 && v.indexOf("navMerchantsToggle") < 0) v.push("navMerchantsToggle");
    });
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
    // v1.15.49: رول الـ sign-up مايدّيش صلاحيات أدمن أبدًا (أي حد كان بيختار Admin في التسجيل كان بياخد كل حاجة)
    if (c.trustLoginRole && sr && c.roles[sr] && !c.roles[sr].admin && c.roles[sr].views !== "*" && FULL_ROLES.indexOf(sr) < 0) return sr;
    return c.defaultRole || "Merchant";
  }
  var STAFF_DOMAIN_RE = /@taager\.com$/i; // v1.16.0: Admin / Country Manager = @taager.com only
  function isRealAdmin() {
    var s = session(); if (!s) return false;
    if (!STAFF_DOMAIN_RE.test(s.email || "")) return false;
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
    if (navId === "navTowerInvite") return canInvite();
    if (navId === "navTowerAlerts") return !!session(); // everyone can open their own Inbox
    var r = effRole();
    if (r.admin && isEffAdmin()) return true;
    if (r.views === "*") return true;
    return Array.isArray(r.views) && r.views.indexOf(navId) >= 0;
  }

  // Merchant scope: a Merchant only sees the numbers of the Merchant ID linked to their email (set in Users & Roles).
  // null = not a Merchant (no restriction). A Merchant without an ID sees nothing until an admin links one.
  function merchantScope() {
    if (effRoleName() !== "Merchant") return null;
    var s = session(), id = "", previewing = false;
    try { previewing = !!sessionStorage.getItem(PREVIEW_SS) && isRealAdmin(); } catch (e) {}
    if (previewing) { try { id = sessionStorage.getItem(PREVIEW_MID) || ""; } catch (e) {} }
    else { var u = s ? userEntry(s.email) : null; id = (u && u.merchantId) || ""; }
    return { id: String(id).trim() };
  }
  var lastScopeSig = "none";
  function applyScope() {
    var sc = merchantScope(), sig = sc ? "m:" + sc.id : "none";
    document.body.classList.toggle("tw-mscope", !!sc);
    var ov = $("viewOverview"), note = $("twScopeNote");
    if (sc && ov) {
      if (!note) { note = document.createElement("div"); note.id = "twScopeNote"; note.className = "tw-scopenote"; ov.insertBefore(note, ov.firstChild); }
      note.classList.toggle("warn", !sc.id);
      note.textContent = sc.id ? "Showing the numbers of Merchant ID " + sc.id + " only." : "Your account is not linked to a Merchant ID yet. Ask an admin to add it, then your numbers will appear here.";
    } else if (note) note.remove();
    if (sig !== lastScopeSig) { lastScopeSig = sig; if (typeof window.rescopeData === "function") window.rescopeData(); }
  }

  // ---------------------------------------------------------------- approval gate
  var gateTimer = null, gateAsked = "", accessKnown = false, accessFailed = false;
  function needsApproval() {
    var s = session(); if (!s) return false;
    if ((s.email || "").toLowerCase() === MANAGER_EMAIL) return false;
    // v1.15.49: قبل كده لو الكونفيج لسه ما اتحملش (أول زيارة / الووركر وقع) requireApproval كان false فالكل بيدخل
    if (!accessKnown) return "checking";
    if (realRoleName() === "Merchant" && !isRealAdmin()) return "merchant";
    if ((getCfg().rejected || []).indexOf((s.email || "").toLowerCase()) >= 0 && !userEntry(s.email)) return "rejected";
    if (!getCfg().requireApproval) return false;
    var em = (s.email || "").toLowerCase();
    return em !== MANAGER_EMAIL && !userEntry(em);
  }
  function checkGate() {
    var el = $("twPendingGate"), need = needsApproval();
    if (!need) { if (el) el.remove(); if (gateTimer) { clearInterval(gateTimer); gateTimer = null; } return; }
    if (need === "checking") {
      if (!el) { el = document.createElement("div"); el.id = "twPendingGate"; el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--bg,#0b1220);padding:24px"; document.body.appendChild(el); }
      el.dataset.mode = "checking";
      el.innerHTML = '<div style="max-width:420px;text-align:center;color:var(--text,#e5e7eb)"><div class="spinner" style="margin:0 auto 14px"></div><div style="opacity:.8">' + (accessFailed ? 'Could not check your access. <button class="btn small" id="twGateRetry">Try again</button>' : 'Checking your access…') + '</div></div>';
      var rt = $("twGateRetry"); if (rt) rt.onclick = function () { accessFailed = false; checkGate(); loadAccess().then(applyNav); };
      return;
    }
    var s = session(), em = (s.email || "").toLowerCase();
    if (el && el.dataset.mode !== (need === "rejected" || need === "merchant" ? need : "waiting")) { el.remove(); el = null; }
    if (need === "merchant") {
      if (!el) { el = document.createElement("div"); el.id = "twPendingGate"; el.dataset.mode = "merchant"; el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--bg,#0b1220);padding:24px";
        el.innerHTML = '<div style="max-width:460px;text-align:center;background:var(--panel,#111a2e);color:var(--text,#e5e7eb);border:1px solid var(--line-light,#243049);border-radius:16px;padding:36px 30px"><div style="font-size:42px">🏪</div><h2 style="margin:10px 0 8px">This dashboard is for Taager staff</h2><p style="line-height:1.6;opacity:.8;margin:0 0 20px">Merchants see their numbers on the Taager merchant portal.</p>' + (MERCHANT_PORTAL_URL ? '<a class="btn btn-primary" href="' + esc(MERCHANT_PORTAL_URL) + '" style="margin-right:8px">Open the merchant portal</a>' : "") + '<button class="btn" id="twGateOut">Sign out</button></div>';
        document.body.appendChild(el); $("twGateOut").onclick = function () { try { localStorage.removeItem(SESSION_LS); } catch (e) {} location.reload(); }; }
      return;
    }
    if (need === "rejected") {
      if (!el) { el = document.createElement("div"); el.id = "twPendingGate"; el.dataset.mode = "rejected"; el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--bg,#0b1220);padding:24px";
        el.innerHTML = '<div style="max-width:440px;text-align:center;background:var(--panel,#111a2e);color:var(--text,#e5e7eb);border:1px solid var(--line-light,#243049);border-radius:16px;padding:36px 30px"><div style="font-size:42px">⛔</div><h2 style="margin:10px 0 8px">Access not approved</h2><p style="line-height:1.6;opacity:.8;margin:0 0 20px">Your request to access the dashboard was declined. Contact the dashboard admin if you think this is a mistake.</p><button class="btn" id="twGateOut">Sign out</button></div>';
        document.body.appendChild(el); $("twGateOut").onclick = function () { try { localStorage.removeItem(SESSION_LS); } catch (e) {} location.reload(); }; }
      if (!gateTimer) gateTimer = setInterval(function () { loadAccess().then(applyNav); }, 30000);
      return;
    }
    if (!el) {
      el = document.createElement("div"); el.id = "twPendingGate"; el.dataset.mode = "waiting";
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
    // Control shows for everyone who has at least one tab in it (Alerts inbox, Invite people); the admin pages stay admin-only.
    var grp = $("navTowerGroup"); if (grp) grp.classList.toggle("tw-off", !hubTabs(HUBS.filter(function (h) { return h.toggle === "navTowerToggle"; })[0]).length);
    ["navTowerRoles", "navTowerTargets"].forEach(function (id) { var a = $(id); if (a) a.classList.toggle("tw-off", !admin); });
    // role chip under the name in the profile card
    var rr = document.querySelector("#authUserBadge .auth-profile-role");
    if (rr) rr.textContent = effRoleName() + " · Egypt";
    renderViewAs();
    applyScope();
  }

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
    return wfetch("getAccess", { timeout: 8000 }).then(function (j) { if (j) { cfg = normCfg(j); ls(ACCESS_LS, JSON.stringify(cfg)); } accessKnown = true; accessFailed = false; })
      .catch(function () { if (ls(ACCESS_LS)) accessKnown = true; else accessFailed = true; });
  }

  // ---------------------------------------------------------------- Targets (read side: used by app.js)
  // Targets are stored per month on the Worker ("<type>.<YYYY-MM>"). Reading a month falls back to the older
  // single upload ("<type>"), and then to the Google Sheet (handled by app.js with the payloads it already has).
  function monthKeyFromLabel(label) {
    var d = label ? new Date(label) : new Date();
    if (isNaN(d)) d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function selectedMonthKey() { var s = $("monthSelect"); return monthKeyFromLabel(s ? s.value : ""); }
  function monthTitle(key) { var p = key.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }); }
  function hasRows(p) { return !!(p && p.table && Array.isArray(p.table.rows) && p.table.rows.length); }
  window.TowerTargets = {
    meta: null, activeKey: null, cache: {},
    keyForSelect: selectedMonthKey,
    start: function (key) {
      if (!workerUrl()) return Promise.resolve({});
      key = key || selectedMonthKey();
      var self = this, found = {};
      var get = function (type) { return wfetch("getTargets", { timeout: 9000 }, "&type=" + type).then(function (p) { return hasRows(p) ? p : null; }); };
      var jobs = TARGET_TYPES.map(function (t) {
        return get(t.type + "." + key).catch(function () { return null; }).then(function (p) { return p || get(t.type); })
          .then(function (p) { if (p) found[t.gid] = p; })
          .catch(function (e) { console.warn("[Tower] targets " + t.type + " failed — using fallback:", e && e.message); });
      });
      var metaJob = wfetch("getTargets", { timeout: 6000 }, "&type=meta").then(function (m) { self.meta = m; }).catch(function () {});
      return Promise.all(jobs.concat([metaJob])).then(function () { self.cache[key] = found; self.activeKey = key; return found; });
    },
    forMonth: function (key) { return this.cache[key] ? Promise.resolve(this.cache[key]).then(function (f) { window.TowerTargets.activeKey = key; return f; }) : this.start(key); },
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
    var get = function (type) { return wfetch("getTargets", { timeout: 15000 }, "&type=" + type).then(function (p) { return p && p.table ? p : null; }).catch(function () { return null; }); };
    return get(t.type + "." + tgMonth).then(function (p) { return p || get(t.type); })
      .then(function (p) { if (p) return p; return (typeof loadSheetWithRetry === "function") ? loadSheetWithRetry(t.gid) : null; });
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
      b.innerHTML = '<label>View as <span>(preview a role)</span></label><select id="twViewAsSel"><option value="">My role (' + esc(realRoleName()) + ')</option>' + roles.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join("") + '</select><input id="twViewAsMid" placeholder="Merchant ID" style="display:none">';
      $("twViewAsSel").onchange = function () { setPreview(this.value || null); };
      $("twViewAsMid").onchange = function () { try { sessionStorage.setItem(PREVIEW_MID, this.value.trim()); } catch (e) {} applyNav(); };
    }
    var sel = $("twViewAsSel"); if (sel && sel.value !== cur) sel.value = cur;
    var vm = $("twViewAsMid"); if (vm) { vm.style.display = cur === "Merchant" ? "" : "none"; var pm = ""; try { pm = sessionStorage.getItem(PREVIEW_MID) || ""; } catch (e) {} if (document.activeElement !== vm) vm.value = pm; }
    b.classList.toggle("on", !!cur);
  }
  // Simple sidebar status block: dot + status, then "updated" and version on one row.
  var NAV_ICONS = {
    navOverview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    navAcmToggle: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.2c2.6.2 4.5 2 4.5 5"/>',
    navMerchantsToggle: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
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
  function setPreview(role) { try { if (role) sessionStorage.setItem(PREVIEW_SS, role); else { sessionStorage.removeItem(PREVIEW_SS); sessionStorage.removeItem(PREVIEW_MID); } } catch (e) {} applyNav(); window.switchView("overview"); }

  // ---------------------------------------------------------------- Users & Roles page
  var usersCache = null, usersInflight = null, USERS_LS = "twUsersCache";
  function cachedUsers() { if (usersCache) return usersCache; try { var j = JSON.parse(ls(USERS_LS) || "null"); if (j && Array.isArray(j.users)) { usersCache = j.users; return usersCache; } } catch (e) {} return null; }
  function loadRegisteredUsers() {
    var api = (typeof DATA_API_URL !== "undefined" && DATA_API_URL) || "";
      function viaAppsScript() {
        var keys = [ls("towerUsersKey"), adminKey()].filter(function (k, i, a) { return k && a.indexOf(k) === i; });
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
  var regWaiting = []; // v1.15.49: ناس مسجلين في شيت اليوزرز بس لسه ما اتعملهمش approve
  function mergeUsers(users) {
    var added = 0;
    if (draft.requireApproval) regWaiting = [];
    users.forEach(function (u) {
      if (!draft.users[u.email] && draft.requireApproval) {
        // قبل كده كانوا بيتضافوا هنا لـ People تلقائي، وأول ما الأدمن يدوس Save (أو Approve لأي حد) كلهم بيتعملهم approve
        if (u.email !== MANAGER_EMAIL) regWaiting.push({ email: u.email, name: u.name || "", at: "", invitedBy: "", role: u.role || "" });
        return;
      }
      if (!draft.users[u.email]) { var r0 = draft.roles[u.role]; draft.users[u.email] = { role: r0 && !r0.admin && r0.views !== "*" ? u.role : draft.defaultRole, name: u.name }; added++; } else if (typeof draft.users[u.email] === "object" && !draft.users[u.email].name && u.name) draft.users[u.email].name = u.name; });
    return added;
  }
  // قائمة الانتظار = طلبات الووركر (requestAccess) + المسجلين في الشيت اللي لسه مش في People ولا مرفوضين
  function waitList() {
    var seen = {}, out = [], rej = (draft && draft.rejected) || [];
    pendingReqs.concat(regWaiting).forEach(function (r) { var e = r && r.email; if (!e || seen[e] || (draft && draft.users[e]) || rej.indexOf(e) >= 0) return; seen[e] = 1; out.push(r); });
    return out;
  }
  function nonStaffAdmins(d) {
    return Object.keys(d.users).filter(function (em) { var u = d.users[em], r = d.roles[typeof u === "string" ? u : (u && u.role)]; return r && (r.admin || r.views === "*") && !STAFF_DOMAIN_RE.test(em); });
  }
  function saveDraft(done, fail) {
    FULL_ROLES.forEach(function (n) { draft.roles[n] = { views: "*", admin: true }; });
    var bad = nonStaffAdmins(draft); if (bad.length) { if (fail) fail(new Error("Admin roles are for @taager.com emails only: " + bad.join(", "))); return Promise.resolve(); }
    return wfetch("putAccess", { body: JSON.stringify(draft) }).then(function () { cfg = normCfg(JSON.parse(JSON.stringify(draft))); ls(ACCESS_LS, JSON.stringify(cfg)); applyNav(); if (done) done(); }).catch(function (e) { if (fail) fail(e); });
  }
  // Invite email for users added by hand (not for self-registered ones). Runs after a successful save.
  function sendInvitesAfterSave() {
    var list = Object.keys(pendingInvites).filter(function (em) { return draft && draft.users[em]; }).map(function (em) { var du = draft.users[em], uo = typeof du === "object" ? du : {}; var it = { email: em, role: (typeof du === "object" ? du.role : du) || pendingInvites[em] }; if (it.role === "Merchant") { it.merchantId = uo.merchantId || ""; it.name = uo.name || ""; } return it; });
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
      '<div class="tw-field" id="muMidWrap"' + ((u.role || draft.defaultRole) === "Merchant" ? "" : ' style="display:none"') + '><label>Merchant ID</label><input id="muMid" value="' + esc(u.merchantId || "") + '" placeholder="e.g. the merchant\'s Taager ID"><div class="tw-muted">This person only sees the numbers of this Merchant ID.</div></div><div class="tw-field"><label>Linked ACM account</label><select id="muAcm"><option value="">— none —</option>' + acms.map(function (n) { return '<option' + (n === u.acm ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("") + '</select><div class="tw-muted">Used to deliver alerts about this ACM\'s portfolio to this person. Inactive people fall back to the default role.</div></div><div class="tw-msg" id="muMsg"></div></div>' +
      '<div class="tw-mfoot"><button class="btn" data-x>Cancel</button><button class="btn btn-primary" id="muSave">Save</button></div></div>';
    document.body.appendChild(m);
    var close = function () { m.remove(); };
    m.querySelector("#muRole").onchange = function () { m.querySelector("#muMidWrap").style.display = this.value === "Merchant" ? "" : "none"; };
    m.querySelectorAll("[data-x]").forEach(function (b) { b.onclick = close; }); m.querySelector(".tw-mback").onclick = close;
    m.querySelector("#muSave").onclick = function () {
      var em = m.querySelector("#muEmail").value.trim().toLowerCase(), msg = m.querySelector("#muMsg");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { msg.className = "tw-msg err"; msg.textContent = "Enter a valid email."; return; }
      var nu = { role: m.querySelector("#muRole").value, name: m.querySelector("#muName").value.trim(), status: m.querySelector("#muStatus").value };
      var acm = m.querySelector("#muAcm").value; if (acm) nu.acm = acm;
      if (nu.role === "Merchant") { var mid = m.querySelector("#muMid").value.trim(); if (!mid) { msg.className = "tw-msg err"; msg.textContent = "Enter the Merchant ID for this Merchant."; return; } nu.merchantId = mid; }
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
    var uList = Object.keys(draft.users).map(function (em) { var u = typeof draft.users[em] === "string" ? { role: draft.users[em] } : draft.users[em]; return { email: em, name: u.name || "", role: u.role || draft.defaultRole, status: u.status || "active", merchantId: u.merchantId || "" }; });
    var tabsHtml = [["people", "People"], ["permissions", "Permissions"], ["roles", "Roles"]].map(function (t) { return '<button class="tw-ut' + (rolesTab === t[0] ? " on" : "") + '" data-rt="' + t[0] + '">' + t[1] + '</button>'; }).join("");
    var body = "";
    if (rolesTab === "people") {
      var q = peopleQ.toLowerCase();
      var rows = uList.filter(function (u) { return !q || (u.name + " " + u.email + " " + u.role).toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
      var wl = waitList();
      var pendHtml = (!adminKey() ? '<div class="tw-card" style="border-color:#fbbf24"><div class="tw-muted">Access requests are hidden until the admin key is saved in this browser (Roles tab → Admin key).</div></div>' : "") + (wl.length ? '<div class="tw-card" style="border-color:#fbbf24"><div class="tw-ch"><div><h3>Waiting for approval (' + wl.length + ')</h3><div class="tw-muted">These people signed up or tried to sign in. Pick a role, then approve.</div></div></div><table class="tw-table"><tbody>' + wl.map(function (r) {
        return '<tr><td><div class="tw-pn">' + esc(r.name || r.email.split("@")[0]) + '</div><div class="tw-muted">' + esc(r.email) + (r.invitedBy ? ' · invited by ' + esc(r.invitedBy) : '') + '</div></td><td><select data-preq-role="' + esc(r.email) + '" style="min-height:34px;padding:0 8px">' + roleOpts(r.role && draft.roles[r.role] ? r.role : draft.defaultRole) + '</select><input data-preq-mid="' + esc(r.email) + '" placeholder="Merchant ID" style="min-height:34px;padding:0 8px;margin-left:6px;width:130px;' + ((r.role && draft.roles[r.role] ? r.role : draft.defaultRole) === "Merchant" ? "" : "display:none") + '"></td><td style="text-align:right"><button class="btn small btn-primary" data-preq-ok="' + esc(r.email) + '">Approve</button> <button class="btn small danger" data-preq-no="' + esc(r.email) + '">Reject</button></td></tr>';
      }).join("") + '</tbody></table><span class="tw-msg" id="twPendMsg"></span></div>' : "");
      var trs = rows.map(function (u) {
        var c = roleColor(u.role);
        return '<tr class="tw-prow" data-edit="' + esc(u.email) + '"><td><div class="tw-person"><span class="tw-av" style="background:' + c + '">' + esc(initials(u.name || u.email)) + '</span><div><div class="tw-pn">' + esc(u.name || u.email.split("@")[0]) + '</div><div class="tw-muted">' + esc(u.email) + '</div></div></div></td>' +
          '<td><select class="tw-rolechip" style="background:' + c + '" data-urole="' + esc(u.email) + '">' + roleOpts(u.role) + '</select></td><td>' + esc(u.role === "Merchant" ? (u.merchantId ? "Merchant ID " + u.merchantId : "No Merchant ID yet") : scopeOf(u.role)) + '</td><td><span class="tw-pill ' + (u.status === "inactive" ? "warn" : "good") + '">' + (u.status === "inactive" ? "Inactive" : "Active") + '</span></td>' +
          '<td style="text-align:right"><button class="btn small danger" data-udel="' + esc(u.email) + '">Remove</button></td></tr>';
      }).join("") || '<tr><td colspan="5" class="tw-muted" style="padding:22px">No people match.</td></tr>';
      body = pendHtml + '<div class="tw-card"><div class="tw-ch"><div><h3>People in Egypt</h3><div class="tw-muted">' + (usersLoading && !uList.length ? 'Loading people…' : uList.length + ' users. Click a row to edit, or change the role from the chip.') + '</div></div>' +
        '<div class="tw-row"><input type="search" id="twPQ" placeholder="Search people" value="' + esc(peopleQ) + '" style="min-height:36px;padding:0 10px;min-width:200px"><button class="btn btn-primary" id="twAddToggle">+ Add user</button></div></div>' +
        (addOpen ? '<div class="tw-row tw-addrow"><input id="twNewEmail" type="email" placeholder="name@taager.com" style="min-width:240px;padding:0 10px;min-height:36px"><select id="twNewRole" style="min-height:36px;padding:0 10px">' + roleOpts(draft.defaultRole) + '</select><input id="twNewMid" placeholder="Merchant ID" style="padding:0 10px;min-height:36px;width:150px;' + (draft.defaultRole === "Merchant" ? "" : "display:none") + '"><button class="btn" id="twUserAdd">Add</button></div>' : "") +
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
        '<div class="tw-row" style="margin-top:10px"><span class="tw-muted">Default role for everyone else:</span><select id="twDefRole" style="min-height:34px;padding:0 8px">' + roleOpts(draft.defaultRole) + '</select></div>' +
        '<div style="margin-top:14px"><div class="tw-muted" style="margin-bottom:6px"><b>Approvers</b> — get a notification (Inbox + email) every time someone asks for access. One email per line. Admins and Country Managers always get it in their Inbox. To approve, the person needs the Admin or Country Manager role and the admin key.</div>' +
        '<textarea id="twApprovers" rows="3" placeholder="name@taager.com" style="width:100%;max-width:520px;padding:8px 10px;font:inherit;font-size:13px">' + esc((draft.approvers || []).join("\n")) + '</textarea></div></div>' +
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
    var nrSel = $("twNewRole"); if (nrSel) nrSel.onchange = function () { $("twNewMid").style.display = nrSel.value === "Merchant" ? "" : "none"; };
    var ua = $("twUserAdd"); if (ua) ua.onclick = function () { var em = $("twNewEmail").value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { $("twSaveMsg").className = "tw-msg err"; $("twSaveMsg").textContent = "Enter a valid email."; return; } var nr = $("twNewRole").value, nm = $("twNewMid").value.trim(); if (nr === "Merchant" && !nm) { $("twSaveMsg").className = "tw-msg err"; $("twSaveMsg").textContent = "Enter the Merchant ID for this Merchant."; return; } draft.users[em] = nr === "Merchant" ? { role: nr, merchantId: nm } : { role: nr }; pendingInvites[em] = nr; addOpen = false; renderRoles(); };
    function loadPending() { if (!adminKey()) return; wfetch("getPending", { admin: true }).then(function (j) { var n = (j && j.pending) || []; if (JSON.stringify(n) !== JSON.stringify(pendingReqs)) { pendingReqs = n; renderRoles(); } }).catch(function () {}); }
    host.querySelectorAll("[data-preq-role]").forEach(function (sel) { sel.onchange = function () { var mi = host.querySelector('[data-preq-mid="' + sel.dataset.preqRole + '"]'); if (mi) mi.style.display = sel.value === "Merchant" ? "" : "none"; }; });
    host.querySelectorAll("[data-preq-ok]").forEach(function (b) { b.onclick = function () {
      var em = b.dataset.preqOk, rs = host.querySelector('[data-preq-role="' + em + '"]'), role = rs ? rs.value : draft.defaultRole, r0 = waitList().filter(function (x) { return x.email === em; })[0] || {};
      draft.rejected = (draft.rejected || []).filter(function (x) { return x !== em; });
      var mi = host.querySelector('[data-preq-mid="' + em + '"]'), mid = mi ? mi.value.trim() : "";
      if (role === "Merchant" && !mid) { var pm = $("twPendMsg"); if (pm) { pm.className = "tw-msg err"; pm.textContent = "Enter the Merchant ID for " + em + "."; } return; }
      b.disabled = true; draft.users[em] = role === "Merchant" ? { role: role, name: r0.name || undefined, merchantId: mid } : { role: role, name: r0.name || undefined }; pendingInvites[em] = role;
      saveDraft(function () { sendInvitesAfterSave().then(function () { return wfetch("resolvePending", { body: JSON.stringify({ emails: [em] }) }); }).then(function () { pendingReqs = pendingReqs.filter(function (x) { return x.email !== em; }); renderRoles(); }).catch(function () { renderRoles(); }); },
        function (e) { delete draft.users[em]; b.disabled = false; var m = $("twPendMsg"); if (m) { m.className = "tw-msg err"; m.textContent = e.message; } });
    }; });
    host.querySelectorAll("[data-preq-no]").forEach(function (b) { b.onclick = function () {
      var em = b.dataset.preqNo; if (!confirm("Decline access for " + em + "?")) return; b.disabled = true;
      // v1.15.49: الرفض بقى بيتسجل في الكونفيج — قبل كده كان بيمسح الطلب بس، فالشخص يرجع يطلب تاني أو يدخل لو الـ approval اتقفل
      draft.rejected = (draft.rejected || []).filter(function (x) { return x !== em; }).concat([em]);
      saveDraft(function () { wfetch("resolvePending", { body: JSON.stringify({ emails: [em] }) }).catch(function () {}).then(function () { pendingReqs = pendingReqs.filter(function (x) { return x.email !== em; }); renderRoles(); }); },
        function (e) { draft.rejected = draft.rejected.filter(function (x) { return x !== em; }); b.disabled = false; var m = $("twPendMsg"); if (m) { m.className = "tw-msg err"; m.textContent = e.message; } });
    }; });
    if (!host._pendAt || Date.now() - host._pendAt > 30000) { host._pendAt = Date.now(); loadPending(); }
    if (!host._pendTimer) host._pendTimer = setInterval(function () { var v = $("viewTowerRoles"); if (v && v.offsetParent !== null && rolesTab === "people") { host._pendAt = Date.now(); loadPending(); } }, 45000);
    function loadRegistered() {
      usersLoading = true;
      loadRegisteredUsers().then(function (users) {
        usersLoading = false; var added = mergeUsers(users);
        renderRoles(); var mm = $("twUsersMsg"); if (mm && added) { mm.className = "tw-msg ok"; mm.textContent = added + " new registered user" + (added > 1 ? "s" : "") + " added — press Save changes to keep them."; }
      }).catch(function (e) { usersLoading = false; renderRoles(); var mm = $("twUsersMsg"); if (mm) { mm.className = "tw-msg err"; mm.textContent = "Could not read registered users (" + (e && e.message) + ")."; } });
    }
    if (!usersLoaded) { usersLoaded = true; loadRegistered(); }
    var ra = $("twReqAppr"); if (ra) ra.onchange = function (e) {
      draft.requireApproval = e.target.checked;
      // لما الـ approval يتفتح: اللي اتضافوا للمسودة من شيت اليوزرز ومش محفوظين فعلاً يرجعوا لقائمة الانتظار
      if (draft.requireApproval) { var saved = getCfg().users || {}; Object.keys(draft.users).forEach(function (em) { if (!saved[em] && !pendingInvites[em]) delete draft.users[em]; }); mergeUsers(cachedUsers() || []); }
    };
    var tr = $("twTrust"); if (tr) tr.onchange = function (e) { draft.trustLoginRole = e.target.checked; };
    var dr = $("twDefRole"); if (dr) dr.onchange = function (e) { draft.defaultRole = e.target.value; };
    var ap = $("twApprovers"); if (ap) ap.onchange = function () { draft.approvers = ap.value.split(/[\s,;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(function (x, i, a) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && a.indexOf(x) === i; }); };
    var kc = $("twKeyCheck"); if (kc) kc.onclick = function () { ls(KEY_LS, $("twKey").value.trim()); var m = $("twKeyMsg"); m.className = "tw-msg"; m.textContent = "Checking…"; wfetch("checkAdminKey", { body: "{}" }).then(function () { m.className = "tw-msg ok"; m.textContent = "Key accepted ✓"; }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message; }); };
    $("twDiscard").onclick = function () { draft = null; pendingInvites = {}; usersLoaded = false; renderRoles(); };
    $("twSave").onclick = function () {
      var m = $("twSaveMsg"); m.className = "tw-msg"; m.textContent = "Saving…";
      FULL_ROLES.forEach(function (n) { draft.roles[n] = { views: "*", admin: true }; });
      var bad = nonStaffAdmins(draft); if (bad.length) { m.className = "tw-msg err"; m.textContent = "Admin roles are for @taager.com emails only: " + bad.join(", "); return; }
      wfetch("putAccess", { body: JSON.stringify(draft) }).then(function () { cfg = normCfg(JSON.parse(JSON.stringify(draft))); ls(ACCESS_LS, JSON.stringify(cfg)); applyNav(); m.className = "tw-msg ok"; m.textContent = "Saved ✓"; return sendInvitesAfterSave().then(function (t) { if (t) { m.textContent = "Saved ✓" + t; if (t.indexOf("failed") >= 0) m.className = "tw-msg err"; } }); }).catch(function (e) { m.className = "tw-msg err"; m.textContent = e.message + (e.status === 403 ? " — set the admin key in the Roles tab." : ""); });
    };
  }

  // ---------------------------------------------------------------- Targets page
  var tgState = {}, tgMonth = "", tgMeta = {}, tgLegacy = {}, tgKpi = null;
  var KPI_DEFAULT = [["Delivered GMV", 100, 40], ["Portfolio NDR ( Orders )%", 31, 20], ["CM3 Per Merchant", 10, 30], ["Segment Retention", 100, 10]];
  function kpiFromPayload(p) {
    var out = KPI_DEFAULT.map(function (r) { return r.slice(); });
    ((p && p.table && p.table.rows) || []).forEach(function (r) { var c = r.c || []; if (c.length < 3) return; var l = String(c[0] ? (c[0].v != null ? c[0].v : c[0].f) : "").toLowerCase(); var i = l.indexOf("gmv") >= 0 ? 0 : l.indexOf("ndr") >= 0 ? 1 : l.indexOf("cm3") >= 0 ? 2 : l.indexOf("retention") >= 0 ? 3 : -1; if (i < 0) return; var t = parseFloat(String(c[1] ? (c[1].v != null ? c[1].v : c[1].f) : "").replace(/[%,]/g, "")), w = parseFloat(String(c[2] ? (c[2].v != null ? c[2].v : c[2].f) : "").replace(/[%,]/g, "")); if (t > 0) out[i][1] = t; if (w >= 0) out[i][2] = w; });
    return out;
  }
  function renderTargets() {
    var host = $("viewTowerTargets"); if (!host) return;
    if (!tgMonth) tgMonth = selectedMonthKey();
    var key = tgMonth;
    Promise.all([
      wfetch("getTargets", { timeout: 6000 }, "&type=meta." + key).catch(function () { return null; }),
      wfetch("getTargets", { timeout: 6000 }, "&type=meta").catch(function () { return null; }),
      wfetch("getTargets", { timeout: 6000 }, "&type=acm." + key).catch(function () { return null; }).then(function (p) { return p && p.table && (p.table.rows || []).length ? p : wfetch("getTargets", { timeout: 6000 }, "&type=acm").catch(function () { return null; }); })
    ]).then(function (r) { if (key !== tgMonth) return; tgMeta = r[0] || {}; tgLegacy = r[1] || {}; tgKpi = kpiFromPayload(r[2]); window.TowerTargets.meta = tgLegacy; drawTargets(); });
    if (!host.firstChild) drawTargets();
  }
  // --- view helpers (v1.15.48 redesign) -------------------------------------
  var TG_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function tgWhen(x) {
    var d = new Date(x); if (isNaN(d.getTime())) return "";
    var h = d.getHours(), ap = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12, mi = ("0" + d.getMinutes()).slice(-2);
    return d.getDate() + " " + TG_MONTHS[d.getMonth()] + " " + d.getFullYear() + " · " + h12 + ":" + mi + " " + ap;
  }
  var TG_ICONS = {
    file: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M19 9v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z"/><path d="M9 13h6M9 17h4"/></svg>',
    tune: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2.2" fill="currentColor" stroke="none"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>'
  };
  function tgStatus(t) {
    if (t.editor) return tgMeta[t.type] ? "ok" : "idle";
    if (tgMeta[t.type]) return "ok";
    if (tgLegacy[t.type]) return "warn";
    return "idle";
  }
  function drawTargets() {
    var host = $("viewTowerTargets"); if (!host) return;
    var counts = { ok: 0, warn: 0, idle: 0 };
    TARGET_TYPES.forEach(function (t) { counts[tgStatus(t)]++; });

    // file cards first, the full-width KPI editor last — so the grid never leaves a hole
    var ordered = TARGET_TYPES.filter(function (x) { return !x.editor; }).concat(TARGET_TYPES.filter(function (x) { return x.editor; }));
    var cards = ordered.map(function (t) {
      if (t.editor) return kpiCardHtml(t);
      var st = tgStatus(t), m = tgMeta[t.type], g = tgLegacy[t.type], pill, info;
      if (m) {
        pill = '<span class="tg-pill ok" title="Uploaded ' + esc(tgWhen(m.at)) + '">Uploaded · ' + esc(tgWhen(m.at)) + '</span>';
        info = '<div class="tg-meta"><span>' + esc(m.rows) + ' rows · ' + esc(m.file || "") + '</span>' + (m.by ? '<span>by ' + esc(m.by) + '</span>' : "") + '</div>';
      } else if (g) {
        pill = '<span class="tg-pill warn">Older upload in use</span>';
        info = '<div class="tg-meta"><span>Nothing for ' + esc(monthTitle(tgMonth)) + ' — using ' + esc(g.rows) + ' rows · ' + esc(g.file || "") + '</span><span>uploaded ' + esc(tgWhen(g.at)) + '</span></div>';
      } else {
        pill = '<span class="tg-pill">Google Sheet (fallback)</span>';
        info = '<div class="tg-meta"><span>Nothing uploaded for ' + esc(monthTitle(tgMonth)) + ' — still reading the Google Sheet.</span></div>';
      }
      return '<div class="tg-card ' + st + '" data-t="' + t.type + '">' +
        '<div class="tg-card-h"><span class="tg-ico">' + TG_ICONS.file + '</span>' +
        '<div class="tg-ht"><b title="' + esc(t.title) + '">' + esc(t.title) + '</b>' + pill + '</div></div>' +
        '<p class="tg-desc" title="' + esc(t.desc) + '">' + esc(t.desc) + '</p>' + info +
        '<label class="tg-drop" data-drop="' + t.type + '">' + TG_ICONS.up + '<b>Drop an .xlsx / .csv file</b><span>or click to choose</span>' +
        '<input type="file" accept=".xlsx,.xls,.csv" hidden data-file="' + t.type + '"></label>' +
        '<div class="tw-msg" data-msg="' + t.type + '"></div><div data-prev="' + t.type + '"></div>' +
        '<div class="tg-acts"><button class="btn small" data-tpl="' + t.type + '">Download current / template</button>' +
        '<button class="btn small" data-seed="' + t.type + '">Import Google Sheet</button></div></div>';
    }).join("");

    host.innerHTML = '<div class="tw-page tg-page">' +
      '<div class="tg-head"><div><h2>Targets Upload</h2>' +
      '<p>Egypt only. Targets are saved per month — pick the month, then upload each file (first sheet of the workbook, same columns as the old Google Sheet, header row included). A month with no upload keeps using the older upload, then the Google Sheet.</p></div>' +
      '<span class="tg-month-badge">' + esc(monthTitle(tgMonth)) + '</span></div>' +

      '<div class="tw-card tg-bar-card"><div class="tg-bar">' +
      '<label class="tg-f month"><span>Target month</span><input type="month" id="twMonth" value="' + esc(tgMonth) + '"></label>' +
      '<label class="tg-f key"><span>Admin key</span><input type="password" id="twKey2" placeholder="ADMIN_KEY" value="' + esc(adminKey()) + '"></label>' +
      '<button class="btn tg-btn-field" id="twKey2Save">Save key</button>' +
      '<span class="tg-spacer"></span>' +
      '<button class="btn btn-primary tg-btn-field" id="twSeedAll">Import all from Google Sheet</button></div>' +
      '<div class="tg-note"><span class="tg-chip ok"><i></i>' + counts.ok + ' uploaded for this month</span>' +
      '<span class="tg-chip warn"><i></i>' + counts.warn + ' on an older upload</span>' +
      '<span class="tg-chip"><i></i>' + counts.idle + ' on the Google Sheet</span>' +
      '<span class="tw-msg" id="twTgMsg"></span></div></div>' +

      '<div class="tg-grid">' + cards + '</div></div>';

    $("twMonth").onchange = function () { if (/^\d{4}-\d{2}$/.test(this.value)) { tgMonth = this.value; tgState = {}; renderTargets(); } };
    $("twKey2Save").onclick = function () { ls(KEY_LS, $("twKey2").value.trim()); gmsg("Key saved.", "ok"); };
    $("twSeedAll").onclick = function () { if (!confirm("Copy the current Google Sheet data of all " + TARGET_TYPES.filter(function (x) { return !x.editor; }).length + " targets into " + monthTitle(tgMonth) + "?")) return; seed(TARGET_TYPES.filter(function (x) { return !x.editor; })); };
    kpiWire(host);
    host.querySelectorAll("[data-file]").forEach(function (inp) { inp.onchange = function () { if (inp.files[0]) pick(inp.dataset.file, inp.files[0]); inp.value = ""; }; });
    host.querySelectorAll("[data-drop]").forEach(function (d) {
      ["dragenter", "dragover"].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.add("over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.remove("over"); }); });
      d.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) pick(d.dataset.drop, f); });
    });
    host.querySelectorAll("[data-tpl]").forEach(function (b) { b.onclick = function () { var t = TARGET_TYPES.filter(function (x) { return x.type === b.dataset.tpl; })[0]; tmsg(t.type, "Preparing file…"); payloadOf(t).then(function (p) { if (!p) throw new Error("No data to export."); return downloadGrid(payloadToGrid(p), "targets_" + t.type + "_" + tgMonth + ".xlsx"); }).then(function () { tmsg(t.type, "Downloaded.", "ok"); }).catch(function (e) { tmsg(t.type, e.message, "err"); }); }; });
    host.querySelectorAll("[data-seed]").forEach(function (b) { b.onclick = function () { seed(TARGET_TYPES.filter(function (x) { return x.type === b.dataset.seed; })); }; });
  }
  function kpiCardHtml(t) {
    var K = tgKpi || KPI_DEFAULT, m = tgMeta[t.type], st = tgStatus(t);
    var pill = m ? '<span class="tg-pill ok">Saved · ' + esc(tgWhen(m.at)) + '</span>' : '<span class="tg-pill">Default values</span>';
    var num = function (k, v) { return '<span class="tg-num"><input type="number" min="0" step="any" data-kpi="' + k + '" value="' + esc(v) + '"><s>%</s></span>'; };
    var rows = K.map(function (r, i) { return '<tr><td>' + esc(r[0]) + '</td><td class="n">' + num("t" + i, r[1]) + '</td><td class="n">' + num("w" + i, r[2]) + '</td></tr>'; }).join("");
    var tot = K.reduce(function (a, r) { return a + (+r[2] || 0); }, 0);
    return '<div class="tg-card wide ' + st + '" data-t="' + t.type + '">' +
      '<div class="tg-card-h"><span class="tg-ico">' + TG_ICONS.tune + '</span>' +
      '<div class="tg-ht"><b>' + esc(t.title) + '</b>' + pill + '</div></div>' +
      '<p class="tg-desc">' + esc(t.desc) + '</p>' +
      '<div class="tg-kpi-wrap"><table class="tg-kpi-t"><thead><tr><th>Metric</th><th class="n">Target</th><th class="n">Weight</th></tr></thead>' +
      '<tbody>' + rows + '<tr class="tg-totr"><td>Total weight</td><td class="n"></td><td class="n"><b id="twKpiTot" class="tg-tot' + (Math.abs(tot - 100) > 0.001 ? " bad" : "") + '">' + tot + '%</b></td></tr></tbody></table></div>' +
      '<div class="tw-msg" data-msg="acm"></div>' +
      '<div class="tg-acts"><button class="btn btn-primary small" id="twKpiSave">Save KPIs</button><button class="btn small" id="twKpiReset">Reset to default</button></div></div>';
  }
  function kpiRead(host) {
    return KPI_DEFAULT.map(function (r, i) { return [r[0], parseFloat(host.querySelector('[data-kpi="t' + i + '"]').value), parseFloat(host.querySelector('[data-kpi="w' + i + '"]').value)]; });
  }
  function kpiWire(host) {
    var upd = function () { var K = kpiRead(host); var tot = K.reduce(function (a, r) { return a + (isFinite(r[2]) ? r[2] : 0); }, 0); var e = $("twKpiTot"); if (e) { e.textContent = tot + "%"; e.className = "tg-tot" + (Math.abs(tot - 100) > 0.001 ? " bad" : ""); } };
    host.querySelectorAll("[data-kpi]").forEach(function (i) { i.oninput = upd; });
    var rs = $("twKpiReset"); if (rs) rs.onclick = function () { tgKpi = KPI_DEFAULT.map(function (r) { return r.slice(); }); drawTargets(); tmsg("acm", "Defaults restored — press Save KPIs to keep them.", ""); };
    var sv = $("twKpiSave"); if (sv) sv.onclick = function () {
      if (!adminKey()) { tmsg("acm", "Enter and save the admin key first.", "err"); return; }
      var K = kpiRead(host), bad = K.some(function (r) { return !isFinite(r[1]) || r[1] <= 0 || !isFinite(r[2]) || r[2] < 0; });
      if (bad) { tmsg("acm", "Every target must be above 0 and every weight 0 or more.", "err"); return; }
      var tot = K.reduce(function (a, r) { return a + r[2]; }, 0);
      if (Math.abs(tot - 100) > 0.001 && !confirm("The weights add up to " + tot + "%, not 100%. Save anyway?")) return;
      var payload = { table: { cols: [], rows: K.map(function (r) { return { c: [{ v: r[0] }, { v: r[1] }, { v: r[2] }] }; }) } };
      tmsg("acm", "Saving…");
      putTarget("acm", payload, "KPI editor", K.length).then(function () { tgKpi = K; tmsg("acm", "Saved ✓ — refreshing dashboard data…", "ok"); setTimeout(function () { renderTargets(); var rb = $("refreshBtn"); if (rb && tgMonth === selectedMonthKey()) rb.click(); }, 400); })
        .catch(function (e) { tmsg("acm", e.message, "err"); });
    };
  }
  function gmsg(t, c) { var e = $("twTgMsg"); if (e) { e.className = "tw-msg " + (c || ""); e.textContent = t; } }
  function tmsg(type, t, c) { var e = document.querySelector('[data-msg="' + type + '"]'); if (e) { e.className = "tw-msg " + (c || ""); e.textContent = t; } }
  function putTarget(type, payload, file, rows) {
    var key = tgMonth;
    return wfetch("putTargets", { body: JSON.stringify(payload), timeout: 60000 }, "&type=" + type + "." + key).then(function () {
      var meta = Object.assign({}, tgMeta || {}); var s = session();
      meta[type] = { at: new Date().toISOString(), rows: rows, file: file, by: s ? s.email : "" };
      return wfetch("putTargets", { body: JSON.stringify(meta) }, "&type=meta." + key).then(function () { tgMeta = meta; delete window.TowerTargets.cache[key]; });
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
      prev.innerHTML = '<div class="tg-prev"><div class="tg-prev-h">Preview · first ' + Math.min(5, rows.length) + ' of ' + rows.length + ' rows</div>' +
        '<div class="tg-prev-s"><table class="tg-prev-t">' + show + '</table></div>' +
        '<div class="tg-acts" style="margin-top:10px"><button class="btn btn-primary small" id="twPub_' + type + '">Publish ' + rows.length + ' rows</button><button class="btn small" id="twCan_' + type + '">Cancel</button></div></div>';
      tmsg(type, "Check the preview, then publish.", "");
      $("twCan_" + type).onclick = function () { prev.innerHTML = ""; tmsg(type, ""); delete tgState[type]; };
      $("twPub_" + type).onclick = function () {
        tmsg(type, "Publishing…");
        putTarget(type, p, file.name, rows.length).then(function () { tmsg(type, "Published ✓ — refreshing dashboard data…", "ok"); setTimeout(function () { renderTargets(); var rb = $("refreshBtn"); if (rb && tgMonth === selectedMonthKey()) rb.click(); }, 400); }).catch(function (e) { tmsg(type, e.message + (e.status === 403 ? " — wrong admin key." : ""), "err"); });
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
      { nav: "navTowerActivity", view: "towerActivity", label: "Activity Log" },
      { nav: "navTowerInvite", view: "towerInvite", label: "Invite people" }
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
    { toggle: "navMerchantsToggle", title: "Merchants", tabs: [
      { nav: "navMerchantTargets", view: "merchantTargets", label: "Merchant Targets" },
      { nav: "navMerchantPerf", view: "merchantPerformance", label: "Merchant Performance" }
    ] },
    { toggle: "navAcmToggle", title: "Account Manager", tabs: [
      { nav: "navAcmTargets", view: "acmTargets", label: "Target ACM" },
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
  var SINGLE_TITLES = { overview: "Over View", towerRoles: "Users & Roles", towerTargets: "Targets Upload" };
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
      renderInvite();
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
  // File names follow the tab labels shown in the sidebar (Commercial Plan -> commercial-plan.html).
  var VIEW_SLUG = {
    inventory: "inventory",
    acmTargets: "target-acm", acmPerformance: "performance-acm", merchantTargets: "merchant-targets", merchantPerformance: "merchant-performance", mpSalesPlan: "sales-plan-acm", spFeedback: "sales-plan-feedback",
    targetsCommercial: "targets", commercialDebundlized: "commercial-plan", purchasePlan: "purchase-plan",
    cm3AnalystProducts: "cm3-analyst-products", ppmAnalystProducts: "analyst-products", ppmAnalystSingle: "analyst-single",
    productsMatchesAnalyst: "matches-single", scAging: "inventory-aging", scSkus: "sku-analysis", scActions: "action-plan",
    cm3Analyst: "cm3-analyst", poorMatches: "poor-matches", availabilityLocking: "availability-locking",
    allocationLocking: "allocation-locking", healthyUnlocking: "unlocking-actions",
    mpMatches: "performance-matches", mpNewMatches: "new-matches", mpDeclineWatch: "decline-matches",
    incentiveMerchants: "incentive-merchants", segmentation: "segmentation-panel", sellthrough: "sellthrough-rate-panel",
    weeklyInventory: "inventory-inbound", forecastModel: "forecast-model", dohPlanner: "planner-doh"
  };
  function twFileOf(view) { return view === "overview" ? "index.html" : (VIEW_SLUG[view] || view.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()) + ".html"; }
  // Old file names (camelCase view name) keep working so saved links don't break; they open the same tab and the address bar switches to the new name.
  function twLegacyFile(view) { return view.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".html"; }
  function twViewOfFile(file) {
    file = (file || "").toLowerCase(); if (!file || file === "index.html") return "overview";
    for (var k in VIEW_NAV) if (twFileOf(k) === file || twLegacyFile(k) === file) return k;
    return null;
  }
  function twPushUrl(name) {
    try {
      var nid = VIEW_NAV[name]; if (!nid) return; if (!allowed(nid)) name = "overview";
      var file = twFileOf(name), cur = (location.pathname.split("/").pop() || "index.html").toLowerCase();
      if (cur === file) return;
      var url = new URL(file, location.href).href;
      if (cur === twLegacyFile(name)) history.replaceState({ v: name }, "", url); else history.pushState({ v: name }, "", url);
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
      if (isOwnView(name)) { if (!(name === "towerInvite" ? canInvite() : (EXTRA_VIEWS[name] && EXTRA_VIEWS[name].open ? allowed(EXTRA_VIEWS[name].navId) : isEffAdmin()))) { res = origSwitch("overview"); updateHub("overview"); return res; } res = showOwnView(name); updateHub(name); return res; }
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
    merchantScope: merchantScope,
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
    try { var c = ls(ACCESS_LS); if (c) { cfg = normCfg(JSON.parse(c)); accessKnown = true; } } catch (e) {}
    injectShell(); injectThemeBtn(); wrapNav(); initEntryView(); setupHubs(); injectMerchantsToolbar(); injectExportButtons(); applyNav(); updateHub("overview");
    loadAccess().then(function () { applyNav(); try { if (isRealAdmin()) loadRegisteredUsers().catch(function () {}); } catch (e) {} }); loadSettings();
    setInterval(function () { loadAccess().then(applyNav); }, 5 * 60 * 1000);
    setInterval(function () { iconifyNav(); tidyStatus(); injectExportButtons(); var s = session(), em = s && s.email; injectShell(); if (em !== lastEmail) { lastEmail = em; applyNav(); } else { var rr = document.querySelector("#authUserBadge .auth-profile-role"); if (rr && rr.textContent.indexOf(effRoleName()) !== 0) applyNav(); } }, 1000);
  }
  iconifyNav();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
