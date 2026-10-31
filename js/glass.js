/* Glass view (preview) — layer فوق الداش بورد، مش بيغير أي لوجيك.
   - Sidebar → rail أيقونات + tooltip + flyout للصفحات الفرعية (بيدوس على العنصر الأصلي، فالـ roles والـ hub شغالين زي ما هم)
   - تبديل الصفحة: الكروت بتدخل ورا بعض (transform/opacity بس — بتتحرك على الـ compositor فمش بتعلق)
   - الأرقام الكبيرة بتعد لحد قيمتها
   - tw-tabs: pill بتتزحلق
   - زرار في التوب بار يقفل/يفتح الـ Glass view (محفوظ في localStorage "glView")
   Loaded LAST (after app.js, tower.js, loop.js …). */
(function () {
  "use strict";
  var LS = "glView2", LITE = "glLite2"; // v1.17.7: new key (the old "glView" choices are ignored -> everybody starts on Glass)
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function on() { return root.classList.contains("gl"); }
  function railMode() { return on() && window.innerWidth > 860; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function labelOf(a) { return (a.textContent || "").replace(/[▼▲]/g, "").replace(/\s+/g, " ").trim(); }

  // v1.17.7: وضعين بس — "glass" (الإزاز الكامل: سُمك + حواف بتلمع + كسر ضوء + لمعة الماوس) و "off" (Classic).
  // Glass هو الافتراضي عند الكل. الجهاز الضعيف (أو اللي اتعب وانت شغال) بيفضل Glass بس كسر الضوء ولمعة الماوس بيتقفلوا عليه (lite).
  var mode = ls(LS) === "off" ? "off" : "glass";
  function isWeak() { return !!((navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4)); }
  var lite = ls(LITE) === "1" || isWeak() || reduce;
  function applyMode() {
    root.classList.toggle("gl", mode !== "off");
    root.classList.toggle("gl-liquid", mode === "glass");
    root.classList.toggle("gl-lite", lite);
  }
  applyMode();

  // nav id -> view (نفس VIEW_NAV في tower.js + صفحات الـ Control). بعض العناصر الفرعية مالهاش click listener
  // لأنها بتتفتح من تابات الـ hub، فالـ flyout بينادي switchView مباشرة.
  var NAV_VIEW = {
    navOverview: "overview", navInventory: "inventory", navAcmTargets: "acmTargets", navAcmPerf: "acmPerformance",
    navMerchantTargets: "merchantTargets", navMerchantPerf: "merchantPerformance", navMerchantCpa: "merchantCpa",
    navMpSalesPlan: "mpSalesPlan", navSpFeedback: "spFeedback", navTargetsCommercial: "targetsCommercial",
    navCommercialDebundlized: "commercialDebundlized", navPurchasePlan: "purchasePlan", navCm3AnalystProducts: "cm3AnalystProducts",
    navPpmAnalystProducts: "ppmAnalystProducts", navPpmAnalystSingle: "ppmAnalystSingle", navProductsMatchesAnalyst: "productsMatchesAnalyst",
    navScAging: "scAging", navScSkus: "scSkus", navScActions: "scActions", navCm3Analyst: "cm3Analyst", navPoorMatches: "poorMatches",
    navAvailabilityLocking: "availabilityLocking", navAllocationLocking: "allocationLocking", navHealthyUnlocking: "healthyUnlocking",
    navMpMatches: "mpMatches", navMpNewMatches: "mpNewMatches", navMpDeclineWatch: "mpDeclineWatch", navIncMerchants: "incentiveMerchants",
    navSegmentationPanel: "segmentation", navSellthroughPanel: "sellthrough", navWeeklyInventory: "weeklyInventory",
    navForecastModel: "forecastModel", navDohPlanner: "dohPlanner",
    navTowerRoles: "towerRoles", navTowerTargets: "towerTargets", navLoopTasks: "loopTasks", navTowerAlerts: "towerAlerts",
    navLoopControl: "loopControl", navTowerSettings: "towerSettings", navTowerActivity: "towerActivity", navTowerUsage: "towerUsage", navTowerInvite: "towerInvite"
  };
  // Forecast Model لسه ورا باسورد الـ Admin Panel — فهنا بنسيب العنصر الأصلي يتداس (الباقي بقى من غير باسورد)
  var VIA_CLICK = { navForecastModel: 1 };
  function go(sub) {
    var v = NAV_VIEW[sub.id];
    if (v && !VIA_CLICK[sub.id] && typeof window.switchView === "function") window.switchView(v); else sub.click();
  }

  // ---------------------------------------------------------------- floating layers (on <body>)
  var tip, fly, user, flyFor = null, hideT = 0;
  function float(cls) { var d = document.createElement("div"); d.className = "gl-float " + cls; document.body.appendChild(d); return d; }
  function placeBeside(el, anchor, alignTop) {
    var r = anchor.getBoundingClientRect(), x = r.right + 12;
    el.style.left = x + "px";
    var h = el.offsetHeight, y = alignTop ? r.top - 8 : r.top + r.height / 2 - h / 2;
    y = Math.max(10, Math.min(y, window.innerHeight - h - 10));
    el.style.top = y + "px";
  }
  function showTip(a) {
    if (!railMode() || (fly && fly.classList.contains("show") && flyFor === a)) return;
    tip.textContent = labelOf(a); tip.classList.add("show"); placeBeside(tip, a);
  }
  function hideTip() { tip.classList.remove("show"); }

  function subsOf(toggle) {
    var wrap = toggle.closest(".nav-dropdown-wrapper"); if (!wrap) return [];
    // nav-hub-child مخفيين بالـ CSS عن قصد (بيظهروا كتابات جوه الصفحة)، فبنعتمد على صلاحيات tower.js بس
    return $$(".nav-item-sub", wrap).filter(function (s) { return !s.classList.contains("tw-off") && !s.classList.contains("hidden") && s.style.display !== "none"; });
  }
  function openFly(toggle) {
    clearTimeout(hideT); hideTip();
    var subs = subsOf(toggle); if (!subs.length) return;
    flyFor = toggle;
    fly.innerHTML = "";
    var h = document.createElement("h4"); h.textContent = labelOf(toggle); fly.appendChild(h);
    subs.forEach(function (s) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = labelOf(s);
      if (s.classList.contains("active") && toggle.classList.contains("gl-on")) b.className = "on";
      b.addEventListener("click", function () { closeFly(true); go(s); });
      fly.appendChild(b);
    });
    fly.classList.add("show"); placeBeside(fly, toggle, true);
  }
  function closeFly(now) {
    clearTimeout(hideT);
    var go = function () { fly.classList.remove("show"); flyFor = null; };
    if (now) go(); else hideT = setTimeout(go, 220);
  }

  // ---------------------------------------------------------------- rail wiring
  function navItems() { return $$(".sidebar .sidebar-nav .nav-item").filter(function (a) { return a.id; }); }
  var railInd = null;
  function placeRailInd(instant) {
    var nav = $(".sidebar-nav"); if (!nav) return;
    if (!railMode()) { if (railInd) railInd.style.opacity = "0"; return; }
    if (!railInd || !railInd.isConnected) { railInd = document.createElement("span"); railInd.className = "gl-rail-ind"; nav.insertBefore(railInd, nav.firstChild); instant = true; }
    var cur = navItems().filter(function (x) { return x.classList.contains("gl-on") && x.offsetParent; })[0];
    if (!cur) { railInd.style.opacity = "0"; return; }
    var y = cur.offsetTop, x = cur.offsetLeft;
    if (instant) railInd.style.transition = "none";
    railInd.style.opacity = "1"; railInd.style.transform = "translate3d(" + x + "px," + y + "px,0)";
    if (instant) { void railInd.offsetWidth; railInd.style.transition = ""; }
  }
  function markActive() {
    navItems().forEach(function (a) {
      var wrap = a.closest(".nav-dropdown-wrapper");
      // tower.js بيعلّم القسم المفتوح على الـ toggle نفسه (tw-hub) — الـ subs ممكن يفضل عليها active قديم
      var act = a.classList.contains("active") || (wrap && !a.classList.contains("tw-hub") && !!$(".nav-item-sub.active", wrap));
      a.classList.toggle("gl-on", !!act);
    });
    if (fly && fly.classList.contains("show") && flyFor) openFly(flyFor);
    placeRailInd(false);
  }
  function wireRail() {
    var sb = $(".sidebar"); if (!sb || sb.__gl) return; sb.__gl = true;
    sb.addEventListener("mouseover", function (e) {
      var a = e.target.closest(".nav-item"); if (!a || !sb.contains(a) || !railMode()) return;
      if (a.closest(".nav-dropdown-wrapper") && subsOf(a).length) openFly(a); else { closeFly(true); showTip(a); }
    });
    sb.addEventListener("mouseout", function (e) {
      var a = e.target.closest(".nav-item"); if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
      hideTip(); if (flyFor === a) closeFly();
    });
    // الضغط على أيقونة القسم بيفتح الصفحة زي الأول (tower.js بيوديك لآخر تاب كنت فيه)، والـ flyout بيتقفل
    sb.addEventListener("click", function () { if (railMode()) { closeFly(true); hideTip(); } }, true);
    sb.addEventListener("focusin", function (e) { var a = e.target.closest(".nav-item"); if (a && railMode()) showTip(a); });
    sb.addEventListener("focusout", hideTip);
    fly.addEventListener("mouseenter", function () { clearTimeout(hideT); });
    fly.addEventListener("mouseleave", function () { closeFly(); });
    document.addEventListener("click", function (e) {
      if (fly.classList.contains("show") && !fly.contains(e.target) && !sb.contains(e.target)) closeFly(true);
      if (user.classList.contains("show") && !user.contains(e.target) && !e.target.closest(".gl-me")) toggleUser(false);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeFly(true); toggleUser(false); } });
    window.addEventListener("resize", function () { closeFly(true); toggleUser(false); hideTip(); placeTabs(true); placeRailInd(true); });

    // user / footer: avatar في آخر الـ rail، والفوتر الأصلي بيتنقل للـ panel (نفس العناصر، فكل حاجة فيه شغالة)
    var me = document.createElement("button"); me.type = "button"; me.className = "gl-me"; me.setAttribute("aria-label", "Account and sync status");
    sb.appendChild(me);
    function initials() {
      try { var s = JSON.parse(localStorage.getItem("taagerDashboardSession") || "null"); var n = (s && (s.name || s.email)) || "?"; return n.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase(); } catch (e) { return "?"; }
    }
    me.textContent = initials();
    me.addEventListener("mouseenter", function () { if (!user.classList.contains("show")) { tip.textContent = "Account & sync"; tip.classList.add("show"); placeBeside(tip, me); } });
    me.addEventListener("mouseleave", hideTip);
    me.addEventListener("click", function () { hideTip(); toggleUser(); });
    var st = document.getElementById("sidebarUpdated");
    var syncDot = function () {
      var t = st ? st.textContent : "";
      me.classList.toggle("gl-bad", /fail|retry|error/i.test(t));
      if (/Refreshing|Loading the latest/i.test(t)) progress(true); else if (prog && prog.classList.contains("on")) progress(false);
    };
    if (st) new MutationObserver(syncDot).observe(st, { childList: true, characterData: true, subtree: true });
    syncDot();
  }
  function toggleUser(force) {
    var footer = $(".sidebar-footer"), sb = $(".sidebar"), me = $(".gl-me"); if (!footer || !sb || !me) return;
    var show = force === undefined ? !user.classList.contains("show") : force;
    if (show) {
      if (footer.parentNode !== user) user.appendChild(footer);
      user.classList.add("show");
      var r = me.getBoundingClientRect(); user.style.left = (r.right + 12) + "px"; user.style.top = Math.max(10, r.bottom - user.offsetHeight) + "px";
    } else {
      user.classList.remove("show");
      if (footer.parentNode === user) setTimeout(function () { if (!user.classList.contains("show")) sb.insertBefore(footer, me); }, 180);
    }
  }

  // ---------------------------------------------------------------- hub tabs: sliding pill
  var lastInd = [];
  function placeTabs(instant) {
    var bar = document.getElementById("twTabs"); if (!bar) return;
    // v1.17.7: Marketplace has TWO rows (the groups + the tabs of the open group) → one pill per row.
    // A row hidden with .tw-off has no width, so it is skipped. Before: only the first active tab got a pill, so the active
    // tab of the second row (e.g. "Matches / Single") had dark text on a dark background and looked like it had disappeared.
    var curs = $$(".tw-tab.on", bar).filter(function (c) { return c.offsetWidth > 0; }), inds = $$(".gl-ind", bar);
    if (!on() || !curs.length || bar.classList.contains("tw-off")) { inds.forEach(function (i) { i.remove(); }); return; }
    while (inds.length > curs.length) inds.pop().remove();
    curs.forEach(function (cur, n) {
      var ind = inds[n], fresh = !ind;
      if (fresh) { ind = document.createElement("span"); ind.className = "gl-ind"; bar.insertBefore(ind, bar.firstChild); }
      var x = cur.offsetLeft, y = cur.offsetTop, w = cur.offsetWidth, h = cur.offsetHeight, prev = lastInd[n];
      var setPos = function (px, pw) { ind.style.width = pw + "px"; ind.style.height = h + "px"; ind.style.transform = "translate(" + px + "px," + y + "px)"; };
      if (instant || reduce || (fresh && !prev)) { ind.style.transition = "none"; setPos(x, w); void ind.offsetWidth; ind.style.transition = ""; }
      else {
        if (fresh) { ind.style.transition = "none"; setPos(prev.x, prev.w); void ind.offsetWidth; ind.style.transition = ""; }
        setPos(x, w);
      }
      lastInd[n] = { x: x, w: w };
    });
  }
  function wireTabs() {
    var bar = document.getElementById("twTabs"); if (!bar || bar.__gl) return; bar.__gl = true;
    new MutationObserver(function (m) {
      if (m.every(function (r) { return r.target.classList && r.target.classList.contains("gl-ind"); })) return;
      requestAnimationFrame(function () { placeTabs(false); });
    }).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    requestAnimationFrame(function () { placeTabs(true); });
  }

  // ---------------------------------------------------------------- page-open motion
  // ليه بعض الصفحات ماكانش بيحصل فيها حاجة: الحركة كانت بتشتغل على الكروت والأرقام اللي موجودة لحظة
  // الضغط بس — وصفحات كتير (Supply Chain، Control، Planner DOH …) بترسم محتواها بعدها بلحظة أو لما
  // الداتا توصل، فكانت بتظهر من غير حركة. دلوقتي كل تبديل صفحة بيفتح "نافذة" 1.6 ثانية: أي كارت أو رقم
  // KPI يظهر في الصفحة دي خلالها بياخد نفس الحركة — قبل ما الفريم يترسم، فمفيش وميض.
  var CARD = ".metric-card, .panel, .sc-note, .seg-section-card, .cx-kpi, .cx-cat, .cx-tile, .cx-mini, .ov-hero, .tw-card, .tw-stat, .tw-dstat, .tw-stats > *";
  var INNER = ".metric-card, .panel, .ov-hero, .tw-card, .cx-kpi, .tw-stat, .tw-dstat";
  var BIG = ".metric-value, .tw-stats b, .ov-val, .ov-aov-v, .ov-stk b, .ov-chip b, .cx-kpi-v, .cx-tile b, .cx-mini b, .cx-cat-s, .cx-ring-n, .sc-act-n, .tw-stat b, .tw-dstat b, .tw-score b, .tg-num";
  var SKIP = { TBODY: 1, TR: 1, TD: 1, TH: 1, TABLE: 1, SELECT: 1, OPTION: 1, svg: 1, SVG: 1, CANVAS: 1 };
  var EASE = "cubic-bezier(.22,1,.36,1)";
  var armed = null;              // { sec, until, dx, dy, t0 }
  var NUM = /^([^\d\-−]*?)([\-−]?\d[\d,]*(?:\.\d+)?)(.*)$/;

  function isTopCard(c, sec) { var p = c.parentElement; return !(p && p !== sec && p.closest(INNER) && sec.contains(p.closest(INNER))); }
  function cardsIn(node, sec) {
    var out = [];
    if (node.nodeType !== 1) return out;
    if (node.matches(CARD) && isTopCard(node, sec)) out.push(node);
    else node.querySelectorAll && Array.prototype.forEach.call(node.querySelectorAll(CARD), function (c) { if (out.length < 12 && isTopCard(c, sec)) out.push(c); });
    return out;
  }
  function moveIn(list) {
    if (!armed || reduce || !on()) return;
    var A = armed, i = 0;
    list.forEach(function (c) {
      if (c.__glArm === A || i >= 8) return; c.__glArm = A;
      if (c.__glAnim) try { c.__glAnim.cancel(); } catch (e) {}
      var from = "translate3d(" + A.dx + "px," + A.dy + "px,0) scale(.985)";
      c.__glAnim = c.animate([{ opacity: 0.35, transform: from, offset: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1, transform: "none", offset: 1 }],
        { id: "gl-in", duration: 520, delay: (A.base || 0) + i++ * 30, easing: EASE, fill: "backwards" });
    });
  }

  // ---- count-up
  function countUp(el, fromVal) {
    if (reduce || !on() || el.childElementCount) return false;
    var text = el.textContent.trim(), m = text.length <= 22 && text.match(NUM); if (!m) return false;
    var raw = m[2].replace(/,/g, "").replace("−", "-"), to = parseFloat(raw); if (!isFinite(to) || to === 0) return false;
    var dec = (raw.split(".")[1] || "").length, grp = m[2].indexOf(",") >= 0, from = fromVal || 0;
    var t0 = performance.now(), dur = 850, token = {};
    el.__glTok = token; el.__glLast = el.textContent;
    function fmt(v) { var s = Math.abs(v).toFixed(dec); if (grp) { var p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = p.join("."); } return m[1] + (v < 0 ? (m[2][0] === "−" ? "−" : "-") : "") + s + m[3]; }
    (function step(now) {
      if (el.__glTok !== token) return;
      if (el.textContent !== el.__glLast) { el.__glTok = null; return; } // التطبيق كتب رقم جديد — هو الأولى
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { el.__glTok = null; el.__glLast = text; el.textContent = text; return; }
      el.__glLast = fmt(from + (to - from) * e); el.textContent = el.__glLast;
      requestAnimationFrame(step);
    })(t0);
    return true;
  }
  var prevNum = new WeakMap(), numQ = [], numQd = false;
  function queueNum(el) { if (numQ.indexOf(el) < 0) numQ.push(el); if (!numQd) { numQd = true; requestAnimationFrame(flushNums); } }
  function flushNums() {
    numQd = false; var list = numQ; numQ = [];
    var live = armed && performance.now() < armed.until;
    list.forEach(function (el) {
      if (!el.isConnected) return;
      var sec = el.closest(".view-section"); if (sec && sec.classList.contains("hidden")) return;
      var m = el.textContent.trim().match(NUM), cur = m ? parseFloat(m[2].replace(/,/g, "")) : NaN;
      var was = prevNum.get(el); prevNum.set(el, cur);
      if (el.__glTok) return;
      // جوه نافذة الفتح: أي رقم يظهر بيعد من الصفر (مرة واحدة لكل فتحة). برّاها: بس لما الداتا توصل لأول مرة
      if (live && sec === armed.sec) { if (el.__glArmN === armed) return; if (countUp(el, 0)) el.__glArmN = armed; }
      else if (was === undefined || was === 0 || isNaN(was)) countUp(el, 0);
    });
  }

  function watchContent() {
    var host = $(".content"); if (!host) return;
    new MutationObserver(function (muts) {
      if (!on() || reduce) return;
      var live = armed && performance.now() < armed.until, batch = [];
      for (var i = 0; i < muts.length; i++) {
        var r = muts[i], t = r.target, el = t.nodeType === 3 ? t.parentElement : t;
        if (!el || SKIP[el.tagName]) continue; // جداول وقوائم: بتتساب فورًا
        if (el.__glLast !== undefined && el.textContent === el.__glLast) continue; // ده إحنا اللي كاتبينه
        if (el.matches(BIG)) { queueNum(el); continue; }
        if (r.type !== "childList" || !r.addedNodes.length) continue;
        // أرقام اتشالت واتبنت تاني في نفس اللحظة (innerHTML بيتعاد كل شوية): الرقم الجديد ياخد مكان القديم — يتحدّث من غير ما يعد من الصفر تاني
        var gone = [];
        for (var q = 0; q < r.removedNodes.length; q++) { var o = r.removedNodes[q]; if (o.nodeType !== 1 || SKIP[o.tagName]) continue; if (o.matches(BIG)) gone.push(o); else Array.prototype.push.apply(gone, o.querySelectorAll(BIG)); }
        var fresh = [];
        for (var j = 0; j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j]; if (n.nodeType !== 1 || SKIP[n.tagName]) continue;
          if (live && armed.sec.contains(n)) Array.prototype.push.apply(batch, cardsIn(n, armed.sec));
          if (n.matches(BIG)) fresh.push(n); else Array.prototype.push.apply(fresh, n.querySelectorAll(BIG));
        }
        fresh.forEach(function (f, k) {
          var g = gone[k];
          if (g) { var gm = g.textContent.trim().match(NUM); prevNum.set(f, gm ? parseFloat(gm[2].replace(/,/g, "")) : NaN); if (g.__glArmN) f.__glArmN = g.__glArmN; }
          queueNum(f);
        });
      }
      if (batch.length) moveIn(batch); // MutationObserver بيشتغل قبل الرسم، فالكارت مش بيظهر ثانية وبعدين يختفي
    }).observe(host, { childList: true, characterData: true, subtree: true });
  }

  // اتجاه الحركة: بين تابات نفس القسم يمين/شمال حسب ترتيب التاب، ومن القايمة الجانبية لفوق
  function tabViews() { var bar = document.getElementById("twTabs"); if (!bar || bar.classList.contains("tw-off")) return []; return $$(".tw-tab:not(.tw-grp)", bar).map(function (b) { return b.dataset.v; }); }
  function openSection(sec, dir) {
    if (!sec) return;
    // الصفحة كلها بتتحرك (view transition أو حركة السكشن) — فالكروت جواها بتتحرك مسافة صغيرة بس، في نفس الاتجاه
    var side = dir === 1 || dir === -1;
    armed = { base: 40, sec: sec, until: performance.now() + 1600, dx: side ? dir * 10 : 0, dy: side ? 0 : (dir === "up" ? -7 : 7) };
    if (reduce || !on()) return;
    var list = []; Array.prototype.forEach.call(sec.querySelectorAll(CARD), function (c) { if (list.length < 12 && isTopCard(c, sec)) list.push(c); });
    moveIn(list);
    Array.prototype.forEach.call(sec.querySelectorAll(BIG), function (el) { if (!el.__glTok && countUp(el, 0)) el.__glArmN = armed; });
  }
  // لو المتصفح مش بيدعم view transitions (أو الجهاز بطيء فيها): السكشن الجديد نفسه بيدخل بنفس الحركة
  var FROM = { right: "translate3d(36px,0,0)", left: "translate3d(-36px,0,0)", down: "translate3d(0,16px,0) scale(.99)", up: "translate3d(0,-16px,0) scale(.99)" };
  function sectionIn(sec, dirName) {
    if (!sec || reduce || !on()) return;
    if (sec.__glSec) try { sec.__glSec.cancel(); } catch (e) {}
    // الظهور سريع (أول ~35%) والحركة بتكمل تهدى بعدها — المحتوى بيبان على طول ومايبقاش فيه لحظة فاضية
    // المحتوى مابيختفيش أبدًا: بيبدأ ظاهر (شفاف سنة) ومزاح شوية وبيتزحلق لمكانه. كده لو الجهاز اتأخر
    // لحظة قبل ما الحركة تبدأ، الصفحة تبان على طول بدل ما تفضل فاضية.
    sec.__glSec = sec.animate([
      { opacity: 0.55, transform: FROM[dirName] || FROM.down, offset: 0 },
      { opacity: 1, offset: 0.4 },
      { opacity: 1, transform: "none", offset: 1 }
    ], { id: "gl-sec", duration: 520, easing: EASE });
    window.__glMotionGate = sec.__glSec.ready;
  }
  // العنوان اللي فوق بيتبدل بحركة صغيرة بدل ما يتغير فجأة
  function wireTitle() {
    var t = $(".topbar-title"); if (!t || t.__gl) return; t.__gl = true;
    var last = (t.querySelector("h1") || {}).textContent;
    new MutationObserver(function () {
      var h = t.querySelector("h1"); if (!h || h.textContent === last) return; last = h.textContent;
      if (!on() || reduce) return;
      t.animate([{ opacity: 0.3, transform: "translate3d(0,6px,0)" }, { opacity: 1, transform: "none" }], { duration: 340, easing: EASE });
    }).observe(t, { childList: true, characterData: true, subtree: true });
  }

  // ---- direction
  function railIndexOfView(v) {
    var items = navItems(), id = null;
    for (var k in NAV_VIEW) if (NAV_VIEW[k] === v) { id = k; break; }
    if (v === "overview") id = "navOverview";
    var el = id && document.getElementById(id); if (!el) return -1;
    var wrap = el.closest(".nav-dropdown-wrapper"), t = wrap ? wrap.querySelector(".nav-item[id]") : el;
    return items.indexOf(t);
  }
  function directionTo(name) {
    var views = tabViews(), onTab = $$("#twTabs .tw-tab.on:not(.tw-grp)")[0], oldV = onTab ? onTab.dataset.v : "";
    var a = views.indexOf(oldV), b = views.indexOf(name);
    if (a >= 0 && b >= 0 && a !== b) return b > a ? 1 : -1;               // نفس القسم: يمين / شمال
    var items = navItems(), cur = items.filter(function (x) { return x.classList.contains("gl-on"); })[0];
    var from = cur ? items.indexOf(cur) : -1, to = railIndexOfView(name);
    return (from >= 0 && to >= 0 && to < from) ? "up" : "down";           // من القايمة: حسب مكان القسم فيها
  }

  // ---- progress line under the top bar
  var prog = null, progT = 0;
  function progress(onOff) {
    if (!prog) { prog = document.createElement("div"); prog.className = "gl-progress"; prog.innerHTML = "<i></i>"; document.body.appendChild(prog); }
    clearTimeout(progT);
    if (onOff) {
      var tb = $(".topbar"); if (tb) { var r = tb.getBoundingClientRect(); prog.style.left = (r.left + 18) + "px"; prog.style.width = Math.max(0, r.width - 36) + "px"; prog.style.top = (r.bottom - 2) + "px"; }
      prog.classList.add("on");
    } else progT = setTimeout(function () { prog.classList.remove("on"); }, 160);
  }
  function afterRender(fn) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(function () { requestAnimationFrame(fn); }, 0); }); }); }

  // ---- the switch itself
  var myWrap = null, vtOK = true, vtSlow = 0;
  // انتقال الصفحة كلها (View Transition) كان بيعمل فريمز واقفة 100–230ms عند كل تبديل تاب (المتصفح بياخد صورة للصفحة ويحرّكها)،
  // حتى من غير ما الـ JS يتأخر — فالـ Guard اللي تحت مكانش بيلقطها. بقى مقفول افتراضيًا والصفحة الجديدة بتدخل بحركة السكشن العادية.
  // لإرجاعه (تجربة): localStorage.setItem("glVT","1") ثم Reload.
  var USE_VT = false; try { USE_VT = localStorage.getItem("glVT") === "1"; } catch (e) {}
  function canVT(before) {
    return USE_VT && vtOK && on() && !reduce && typeof document.startViewTransition === "function" && before && !document.hidden && window.innerWidth > 860;
  }
  function hookSwitch() {
    var orig = window.switchView;
    if (typeof orig !== "function" || orig === myWrap) return true;
    if (myWrap) myWrap.__dead = true; // حد لفّ فوقنا — نلف تاني من برّا والقديم يعدّي بس
    var w = function (name) {
      if (w.__dead) return orig.apply(this, arguments);
      var self = this, args = arguments, before = $(".view-section:not(.hidden)");
      var dir = directionTo(name), dirName = dir === 1 ? "right" : dir === -1 ? "left" : dir, res;
      var run = function (viaVT) {
        res = orig.apply(self, args);
        var sec = $(".view-section:not(.hidden)");
        if (sec && sec !== before) { if (!viaVT) sectionIn(sec, dirName); openSection(sec, dir); }
        markActive();
        afterRender(function () { progress(false); });
        return res;
      };
      progress(true);
      window.__glMotionGate = null;
      if (!canVT(before)) return run(false);
      // View Transition: المتصفح بياخد صورة للصفحة القديمة، يغيّر الـ DOM، ويحرّك الاتنين على الـ GPU —
      // القديمة بتمشي والجديدة بتدخل، والسايدبار والتوب بار ثابتين. ومن غير ما ننسخ أي جداول.
      // ولو الجهاز أخد وقت في الصورة دي (أكتر من ~110ms مرتين)، بنقفلها للجلسة دي ونرجع للحركة العادية.
      root.setAttribute("data-gl-dir", dirName);
      root.classList.add("gl-vt-run");
      var np = window.__twNoPush, t0 = performance.now(), vt;
      try {
        vt = document.startViewTransition(function () {
          var lag = performance.now() - t0;
          if (lag > 110) { vtSlow++; if (vtSlow >= 2 || lag > 260) vtOK = false; } else vtSlow = 0;
          var prev = window.__twNoPush; window.__twNoPush = np;
          try { run(true); } finally { window.__twNoPush = prev; }
        });
      } catch (e) { root.classList.remove("gl-vt-run"); return run(false); }
      window.__glMotionGate = vt.ready;
      var done = function () { root.classList.remove("gl-vt-run"); };
      vt.finished.then(done, done); vt.ready.catch(function () {}); if (vt.updateCallbackDone) vt.updateCallbackDone.catch(function (e) { console.error(e); });
      return res;
    };
    w.__gl = true; myWrap = w; window.switchView = w;
    return true;
  }

  // ---------------------------------------------------------------- toggle button
  var EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="13" height="13" rx="3.5"/><rect x="7.5" y="9" width="13" height="10" rx="3.5" fill="currentColor" fill-opacity=".18"/></svg>';
  var MODE_LABEL = { glass: "Glass", off: "Classic" };
  var NEXT = { glass: "off", off: "glass" };
  function addToggle() {
    var bar = $(".topbar-actions"); if (!bar || $(".gl-toggle")) return;
    var b = document.createElement("button");
    b.className = "btn btn-outline tw-iconbtn gl-toggle"; b.type = "button"; b.innerHTML = EYE;
    var sync = function () {
      var t = "Look: " + MODE_LABEL[mode] + " — click for " + MODE_LABEL[NEXT[mode]];
      b.title = t; b.setAttribute("aria-label", t); b.dataset.mode = mode;
    };
    b.addEventListener("click", function () {
      mode = NEXT[mode]; ls(LS, mode); applyMode(); sync(); Guard.pin(); Light.off();
      closeFly(true); toggleUser(false); markActive(); placeTabs(true); placeRailInd(true);
      Lens.refresh();
      // اسم الوضع الجديد بيظهر لحظة جنب الزرار
      tip.textContent = MODE_LABEL[mode]; tip.classList.add("show");
      var r = b.getBoundingClientRect(); tip.style.left = Math.max(10, r.left + r.width / 2 - tip.offsetWidth / 2) + "px"; tip.style.top = (r.bottom + 10) + "px";
      clearTimeout(b.__t); b.__t = setTimeout(hideTip, 1200);
      if (on()) openSection($(".view-section:not(.hidden)"), 0);
    });
    sync();
    var ref = document.getElementById("refreshBtn");
    bar.insertBefore(b, ref && ref.parentNode === bar ? ref : null);
  }

  // ---------------------------------------------------------------- Liquid Glass
  // (1) Lens: الحواف بتكسر اللي وراها زي الإزاز التخين. SVG displacement map معمول على مقاس كل عنصر
  //     بالظبط (الحواف بس، والنص سليم)، ومتركب على backdrop-filter. Chrome / Edge بس — غيرهم بيتجاهلوه.
  // (2) Light: لمعة على الحافة وإضاءة خفيفة جوه الكارت بتمشي مع الماوس.
  // (3) لو الجهاز بيتعب وانت بتعمل سكرول، الـ Lens بيتقفل لوحده للجلسة دي (اللمعة بتفضل).
  var Lens = (function () {
    var SVGNS = "http://www.w3.org/2000/svg", defs = null, items = [], ro = null, dead = false;
    var ok = (function () { try { return CSS.supports("backdrop-filter", "url(#x)") && /Chrome|Chromium|Edg\//.test(navigator.userAgent); } catch (e) { return false; } })();
    try { if (sessionStorage.getItem("glLensOff") === "1") dead = true; } catch (e) {}
    function svgRoot() {
      if (defs) return defs;
      var svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      defs = document.createElementNS(SVGNS, "defs"); svg.appendChild(defs); document.body.appendChild(svg);
      return defs;
    }
    // خريطة الإزاحة: 128 = مفيش حركة. قرب الحافة بنسحب البيكسل من جوه (زي ما العدسة بتلم الضوء)
    function mapURL(w, h, r, band) {
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var ctx = c.getContext("2d"), img = ctx.createImageData(w, h), d = img.data;
      r = Math.min(r, w / 2, h / 2);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var px = x + 0.5, py = y + 0.5;
          var cx = Math.min(Math.max(px, r), w - r), cy = Math.min(Math.max(py, r), h - r);
          var dx = px - cx, dy = py - cy, dist, nx = 0, ny = 0;
          if (dx === 0 && dy === 0) {
            var dl = px, dr = w - px, dt = py, db = h - py, m = Math.min(dl, dr, dt, db); dist = m + r;
            if (m === dl) nx = -1; else if (m === dr) nx = 1; else if (m === dt) ny = -1; else ny = 1;
          } else { var L = Math.sqrt(dx * dx + dy * dy) || 1; dist = r - L; nx = dx / L; ny = dy / L; }
          var t = dist < band ? 1 - Math.max(dist, 0) / band : 0, s = t * t * (3 - 2 * t);
          var i = (y * w + x) * 4;
          d[i] = 128 - nx * s * 127; d[i + 1] = 128 - ny * s * 127; d[i + 2] = 128; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL("image/png");
    }
    function build(it) {
      var el = it.el, w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (!w || !h || (w === it.w && h === it.h)) return;
      it.w = w; it.h = h;
      var r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      var f = it.f;
      if (!f) {
        f = document.createElementNS(SVGNS, "filter"); f.setAttribute("id", it.id);
        f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", "100%"); f.setAttribute("height", "100%");
        f.setAttribute("color-interpolation-filters", "sRGB"); f.setAttribute("primitiveUnits", "userSpaceOnUse");
        var im = document.createElementNS(SVGNS, "feImage"); im.setAttribute("result", "map"); im.setAttribute("x", "0"); im.setAttribute("y", "0"); im.setAttribute("preserveAspectRatio", "none");
        var dm = document.createElementNS(SVGNS, "feDisplacementMap"); dm.setAttribute("in", "SourceGraphic"); dm.setAttribute("in2", "map");
        dm.setAttribute("xChannelSelector", "R"); dm.setAttribute("yChannelSelector", "G");
        f.appendChild(im); f.appendChild(dm); svgRoot().appendChild(f); it.f = f; it.im = im; it.dm = dm;
      }
      it.im.setAttribute("width", w); it.im.setAttribute("height", h);
      it.im.setAttribute("href", mapURL(w, h, r, it.band));
      it.dm.setAttribute("scale", it.scale);
      el.style.setProperty("--gl-lens", "url(#" + it.id + ")");
    }
    function add(el, id, scale, band) {
      if (!el || el.__glLens) return; el.__glLens = true;
      var it = { el: el, id: id, scale: scale, band: band }; items.push(it);
      if (ro) ro.observe(el);
      if (active()) build(it);
    }
    function active() { return ok && !dead && !lite && root.classList.contains("gl-liquid"); }
    function refresh() { if (!active()) return; items.forEach(function (it) { it.w = it.h = 0; build(it); }); root.classList.add("gl-lens"); }
    function kill() { dead = true; root.classList.remove("gl-lens"); items.forEach(function (it) { it.el.style.removeProperty("--gl-lens"); }); try { sessionStorage.setItem("glLensOff", "1"); } catch (e) {} }
    // حارس الأداء: بنقيس الفريمات وانت بتعمل سكرول؛ لو كتير منها اتأخر، الـ Lens بيتقفل
    var watching = false, slow = 0, total = 0, strikes = 0;
    function watchScroll() {
      if (watching || !root.classList.contains("gl-lens")) return; watching = true; slow = 0; total = 0;
      var last = performance.now(), end = last + 1200;
      (function f(t) {
        var dt = t - last; last = t; total++; if (dt > 34) slow++;
        if (t < end) return requestAnimationFrame(f);
        watching = false;
        if (total > 10 && slow / total > 0.3) { if (++strikes >= 2) kill(); } else strikes = 0;
      })(last);
    }
    function init() {
      if (!ok) return;
      var pendingRO = [], roT = 0;
      if (window.ResizeObserver) ro = new ResizeObserver(function (es) {
        es.forEach(function (e) { if (pendingRO.indexOf(e.target) < 0) pendingRO.push(e.target); });
        clearTimeout(roT); roT = setTimeout(function () { // بنستنى الـ resize يخلص قبل ما نرسم الخريطة تاني
          var list = pendingRO; pendingRO = [];
          list.forEach(function (el) { var it = items.filter(function (x) { return x.el === el; })[0]; if (it && active()) build(it); });
        }, 180);
      });
      add($(".topbar"), "gl-lens-top", 22, 16);
      add($(".sidebar"), "gl-lens-rail", 26, 18);
      add(fly, "gl-lens-fly", 20, 14);
      add(user, "gl-lens-user", 20, 14);
      add($(".auth-card"), "gl-lens-auth", 24, 18); // login card (exists only before sign-in)
      if (active()) root.classList.add("gl-lens");
      window.addEventListener("scroll", watchScroll, { passive: true, capture: true });
    }
    return { init: init, add: add, refresh: refresh, active: active, kill: kill };
  })();

  var Light = (function () {
    // اللمعة اتنقلت لطبقتين صغيرين فوق الكارت بيتحركوا بـ transform بس — يعني كارت الشاشة هو اللي
    // بيحركهم، والكارت نفسه (وجداوله ورسوماته) مابيتعادش رسمه مع كل حركة ماوس.
    var SEL = ".metric-card, .cx-kpi, .cx-tile, .cx-mini, .cx-cat, .ov-hero, .tw-stat, .tw-dstat, .tw-card, .seg-section-card, .panel, .topbar, .sidebar, .tw-tabs, .gl-fly, .gl-user, .exp-toast, .auth-card";
    var lit = null, rect = null, pend = null, raf = 0, box = null, glow = null, rimBox = null, rim = null;
    function make() {
      if (box) return;
      box = document.createElement("div"); box.className = "gl-light"; box.setAttribute("aria-hidden", "true");
      glow = document.createElement("i"); box.appendChild(glow);
      rimBox = document.createElement("div"); rimBox.className = "gl-light gl-light-rim"; rimBox.setAttribute("aria-hidden", "true");
      rim = document.createElement("i"); rimBox.appendChild(rim);
      document.body.appendChild(box); document.body.appendChild(rimBox);
    }
    function off() { lit = null; rect = null; if (box) { box.classList.remove("on"); rimBox.classList.remove("on"); } }
    function place(t) {
      make(); rect = t.getBoundingClientRect();
      var rad = getComputedStyle(t).borderTopLeftRadius;
      [box, rimBox].forEach(function (b) {
        b.style.left = rect.left + "px"; b.style.top = rect.top + "px"; b.style.width = rect.width + "px"; b.style.height = rect.height + "px"; b.style.borderRadius = rad;
      });
      var z = (t.matches(".auth-card") ? 100000 : t.matches(".gl-fly, .gl-user") ? 62 : t.matches(".sidebar") ? 41 : t.matches(".topbar") ? 21 : t.matches(".exp-toast") ? 121 : 2);
      box.style.zIndex = z; rimBox.style.zIndex = z;
      box.classList.add("on"); rimBox.classList.add("on");
    }
    function frame() {
      raf = 0; var e = pend; pend = null; if (!e) return;
      if (!root.classList.contains("gl-liquid") || lite) return off();
      var t = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (t && t.__glBig === undefined) t.__glBig = (t.offsetWidth * t.offsetHeight) > 520000;
      if (t && t.__glBig) t = null;
      if (t !== lit) { off(); if (t) { lit = t; place(t); } }
      if (!lit) return;
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      glow.style.transform = "translate3d(" + (x - 210) + "px," + (y - 210) + "px,0)";
      rim.style.transform = "translate3d(" + (x - 90) + "px," + (y - 90) + "px,0)";
    }
    function init() {
      if (reduce) return;
      document.addEventListener("pointermove", function (e) { if (e.pointerType === "touch") return; pend = e; if (!raf) raf = requestAnimationFrame(frame); }, { passive: true });
      document.addEventListener("pointerleave", off);
      window.addEventListener("blur", off);
      window.addEventListener("scroll", off, { passive: true, capture: true }); // بيرجع مع أول حركة ماوس
      window.addEventListener("resize", off);
      document.addEventListener("pointerdown", function () { if (lit) place(lit); }, true);
    }
    return { init: init, off: off };
  })();

  // ---------------------------------------------------------------- performance guard
  // بنقيس سلاسة الفريمات بس وانت بتتفاعل (سكرول / ماوس / تبديل صفحة) — مفيش أي loop شغال وانت سايبها.
  // لو الجهاز بيتعب: Liquid ← Glass ← Classic لوحده، ومرة واحدة بيقولك. ولو رجّعت الوضع بإيدك بنحترم اختيارك.
  var Guard = (function () {
    var busy = false, strikes = 0, userPinned = false, lastLong = 0;
    // تقطيع سببه حسابات الداتا نفسها (رندر جدول كبير، داونلود شغال) مالوش دعوة بالشكل — العينة دي بتتلغي
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { lastLong = Math.max(lastLong, e.startTime + e.duration); }); }).observe({ type: "longtask" }); } catch (e) {}
    function exporting() { return !!document.querySelector(".exp-toast:not(.ok):not(.bad)"); }
    function sample() {
      if (busy || mode === "off" || lite || userPinned || document.hidden || exporting()) return; busy = true;
      var start = performance.now(), last = start, end = start + 1000, total = 0, slow = 0;
      requestAnimationFrame(function f(t) {
        var dt = t - last; last = t; total++; if (dt > 34) slow++;
        if (t < end) return requestAnimationFrame(f);
        busy = false;
        if (lastLong > start - 50 || exporting()) return;
        if (total >= 8 && slow / total > 0.3) { if (++strikes >= 3) { strikes = 0; downgrade(); } }
        else strikes = Math.max(0, strikes - 1);
      });
    }
    function downgrade() {
      // v1.17.7: الشكل بيفضل Glass — بنقفل بس كسر الضوء ولمعة الماوس على الجهاز ده (ومحفوظ عليه).
      if (lite) return;
      lite = true; ls(LITE, "1"); applyMode(); Lens.kill(); Light.off();
      var b = $(".gl-toggle");
      if (b && tip) {
        tip.textContent = "Light effects turned off on this device to keep things smooth"; tip.classList.add("show");
        var r = b.getBoundingClientRect(); tip.style.left = Math.max(10, r.right - tip.offsetWidth) + "px"; tip.style.top = (r.bottom + 10) + "px";
        setTimeout(hideTip, 3500);
      }
    }
    function init() {
      var kick = function () { sample(); };
      window.addEventListener("scroll", kick, { passive: true, capture: true });
      document.addEventListener("pointerdown", kick, true);
      document.addEventListener("wheel", kick, { passive: true });
    }
    return { init: init, pin: function () { userPinned = true; }, sample: sample };
  })();

  // ---------------------------------------------------------------- boot
  function boot() {
    tip = float("gl-tip"); fly = float("gl-fly"); user = float("gl-user");
    fly.setAttribute("role", "menu");
    wireRail(); wireTabs(); addToggle(); watchContent(); wireTitle();
    Lens.init(); Light.init(); Guard.init();
    // tower.js / loop.js بيلفّوا switchView بعد التحميل — نستنى لحد ما يخلصوا ونلف إحنا الأخر
    var hooked = false, tries = 0, iv = setInterval(function () {
      tries++;
      var f = window.switchView;
      if (typeof f === "function" && f !== myWrap) hooked = hookSwitch();
      addToggle(); wireTabs(); wireTitle(); markActive();
      if (tries > 40) clearInterval(iv);
    }, 250);
    var nav = $(".sidebar-nav");
    if (nav) new MutationObserver(function () { requestAnimationFrame(markActive); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ["class", "style"], childList: true });
    openSection($(".view-section:not(.hidden)"), 0);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
