// Arabic for the merchant portal. The portal opens in English; a merchant can switch to Arabic from
// the top bar and the choice sticks in that browser.
//
// Why a dictionary applied over the rendered page, rather than translated templates: the dashboard
// builds most of its markup from JS, so a second set of templates would be a second thing to keep in
// step with every change. Here there is ONE source of markup, and this file only swaps the words it
// recognises — anything it does not recognise is left exactly as it was.
//
// Deliberately left in English, per the merchants these are written for:
//   · the metric names they already use and quote back (GMV, CM3, CPA, SKU, ASP, CR%, DR%, Run Rate,
//     MTD, DOH, Confirmed, Delivered) — a merchant has to be able to match these to any other report
//   · all data: product names, SKU codes, categories, numbers and dates
// So an Arabic sentence can carry an English term inside it, exactly how the teams speak.

export const I18N_JS = String.raw`
(function () {
  var LS = "mpLang";
  var DICT = {
    // ---- sidebar / navigation
    "Over View": "نظرة عامة",
    "Merchant Target": "تارجت التاجر",
    "Sales Plan": "خطة المبيعات",
    "Inventory": "المخزون",
    "Incentives Tracker": "متابعة الحوافز",
    "RE-CPA": "RE-CPA",
    "Alert Center": "مركز التنبيهات",
    "Center Control": "Center Control",
    "Taager Performance": "أداء تاجر",
    "Live System Sync": "مزامنة مباشرة",
    "Your store": "متجرك",
    "Merchant": "تاجر",

    // ---- page subtitles (top bar)
    "Your demand, pipeline & delivery numbers": "أرقام الطلب والبايبلاين والتسليم بتاعتك",
    "Targets vs actuals, and segment projections": "التارجت مقابل الفعلي، وتوقعات الشريحة",
    "Your SKU targets vs actuals, run rate and status": "تارجت الـ SKUs مقابل الفعلي، والـ Run Rate والحالة",
    "Stock and days of cover for your SKUs": "المخزون وأيام التغطية للـ SKUs بتاعتك",
    "Your monthly confirmed-orders target and bonus": "تارجت الأوردرات المؤكدة الشهري والبونص",
    "Updates and alerts from your Taager team": "تحديثات وتنبيهات من فريق تاجر",
    "Max CPA calculator — never pay more per order than you earn": "حاسبة أقصى CPA — متدفعش في الأوردر أكتر مما تكسب",

    // ---- top bar / account
    "Account": "الحساب",
    "Change password": "تغيير كلمة السر",
    "Sign out": "تسجيل الخروج",
    "Sign in": "تسجيل الدخول",
    "Notifications": "التنبيهات",
    "Light / dark": "فاتح / غامق",
    "Switch theme": "تغيير المظهر",
    "Month": "الشهر",
    "Arabic": "العربية",
    "English": "English",
    "Language": "اللغة",

    // ---- sign in / password
    "Merchant portal": "بوابة التجار",
    "Email": "البريد الإلكتروني",
    "Password": "كلمة السر",
    "Forgot your password?": "نسيت كلمة السر؟",
    "Reset password": "إعادة تعيين كلمة السر",
    "Back to sign in": "الرجوع لتسجيل الدخول",
    "Send link": "إرسال الرابط",
    "Enter your email. If it has an account, we will send you a link to choose a new password.":
      "اكتب بريدك الإلكتروني. لو ليه حساب، هنبعتلك رابط تختار منه كلمة سر جديدة.",
    "At least 10 characters, with letters and numbers.": "١٠ حروف على الأقل، وتحتوي على حروف وأرقام.",
    "New password": "كلمة السر الجديدة",
    "Confirm password": "تأكيد كلمة السر",
    "Current password": "كلمة السر الحالية",
    "Save": "حفظ",
    "Cancel": "إلغاء",
    "Close": "إغلاق",

    // ---- common actions / states
    "Export CSV": "تحميل CSV",
    "Search": "بحث",
    "All": "الكل",
    "Loading…": "جاري التحميل…",
    "No data": "لا توجد بيانات",
    "Nothing here yet": "لا يوجد شيء هنا بعد",
    "Refresh": "تحديث",
    "Add / update": "إضافة / تحديث",
    "Ask for more lock": "طلب زيادة الحجز",
    "Ask to extend": "طلب تمديد",
    "Send": "إرسال",
    "Details": "التفاصيل",
    "Back": "رجوع",
    "Next": "التالي",
    "Previous": "السابق"
  };

  var RTL_CSS = [
    'html[dir="rtl"] body{direction:rtl;text-align:right}',
    'html[dir="rtl"] .shell{direction:rtl}',
    'html[dir="rtl"] .sidebar{border-right:0}',
    // numbers, codes and anything monospaced stay left-to-right so figures never read backwards
    'html[dir="rtl"] .num,html[dir="rtl"] td.num,html[dir="rtl"] th.num,html[dir="rtl"] .kpi-value,',
    'html[dir="rtl"] input[type="number"],html[dir="rtl"] code,html[dir="rtl"] .mono',
    '{direction:ltr;text-align:right;unicode-bidi:isolate}',
    'html[dir="rtl"] .tw-pop,html[dir="rtl"] .mp-menu-list{left:0;right:auto}',
    'html[dir="rtl"] .nav-item{text-align:right}'
  ].join("");

  function lang() { try { return localStorage.getItem(LS) === "ar" ? "ar" : "en"; } catch (e) { return "en"; } }

  // Only ever swaps a string the dictionary knows, whole and exact — never a partial or fuzzy match,
  // so a product name or a number can never be rewritten by accident.
  function tr(s) {
    if (!s) return null;
    var k = s.replace(/\s+/g, " ").trim();
    if (!k) return null;
    var v = DICT[k];
    if (!v || v === k) return null;
    return s.replace(k, v);
  }

  // Keeps the English original on each node it touches, so switching back restores the page exactly
  // instead of needing a reload.
  var EN = new WeakMap(), ENA = new WeakMap();
  function walkAr(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      var t = tr(root.nodeValue);
      if (t !== null) { if (!EN.has(root)) EN.set(root, root.nodeValue); root.nodeValue = t; }
      return;
    }
    if (root.nodeType !== 1) return;
    var tag = root.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "svg") return;
    ["placeholder", "title", "aria-label"].forEach(function (a) {
      if (!root.hasAttribute(a)) return;
      var cur = root.getAttribute(a), t = tr(cur);
      if (t === null) return;
      var m = ENA.get(root) || {};
      if (!(a in m)) { m[a] = cur; ENA.set(root, m); }
      root.setAttribute(a, t);
    });
    for (var n = root.firstChild; n; n = n.nextSibling) walkAr(n);
  }
  function toEn(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (EN.has(root)) { root.nodeValue = EN.get(root); EN.delete(root); } return; }
    if (root.nodeType !== 1) return;
    var m = ENA.get(root);
    if (m) { Object.keys(m).forEach(function (a) { root.setAttribute(a, m[a]); }); ENA.delete(root); }
    for (var n = root.firstChild; n; n = n.nextSibling) toEn(n);
  }

  var obs = null;
  function observe() {
    if (obs || typeof MutationObserver === "undefined") return;
    // The dashboard re-renders its panels as the merchant moves around, so anything added after the
    // switch has to be translated too — otherwise half the page would drift back to English.
    obs = new MutationObserver(function (muts) {
      if (lang() !== "ar") return;
      obs.disconnect();
      try {
        muts.forEach(function (mu) {
          if (mu.type === "characterData") { walkAr(mu.target); return; }
          for (var i = 0; i < mu.addedNodes.length; i++) walkAr(mu.addedNodes[i]);
        });
      } finally {
        if (lang() === "ar") obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        else obs = null;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function style() {
    if (document.getElementById("mpRtlCss")) return;
    var el = document.createElement("style");
    el.id = "mpRtlCss"; el.textContent = RTL_CSS;
    document.head.appendChild(el);
  }

  function apply(l) {
    var html = document.documentElement;
    style();
    if (l === "ar") {
      html.setAttribute("lang", "ar"); html.setAttribute("dir", "rtl");
      walkAr(document.body); observe();
    } else {
      html.setAttribute("lang", "en"); html.setAttribute("dir", "ltr");
      if (obs) { obs.disconnect(); obs = null; }
      toEn(document.body);
    }
    var b = document.getElementById("langBtn");
    if (b) {
      b.textContent = l === "ar" ? "EN" : "ع";
      b.setAttribute("title", l === "ar" ? "Switch to English" : "التبديل إلى العربية");
      b.setAttribute("aria-label", b.getAttribute("title"));
    }
  }

  function set(l) {
    try { localStorage.setItem(LS, l === "ar" ? "ar" : "en"); } catch (e) {}
    apply(l === "ar" ? "ar" : "en");
  }

  function mount() {
    if (!document.body) return;
    // Sits next to the theme button on the dashboard, and in the login card's corner otherwise.
    if (!document.getElementById("langBtn")) {
      var host = document.querySelector(".topbar-actions") || document.querySelector(".auth-card") || document.body;
      var b = document.createElement("button");
      b.type = "button"; b.id = "langBtn";
      b.className = host.classList.contains("topbar-actions") ? "btn btn-outline tw-iconbtn" : "link mp-lang";
      host.insertBefore(b, host.querySelector("#themeBtn") || host.firstChild);
      b.addEventListener("click", function () { set(lang() === "ar" ? "en" : "ar"); });
    }
    apply(lang());
  }

  window.MPLang = { get: lang, set: set, apply: apply };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
`;
