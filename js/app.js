window.addEventListener('error', function(e) {
  if (e.message && e.message.includes("Script error")) return;
  console.error("System Error: " + e.message);
});
window.addEventListener('unhandledrejection', function(e) {
  hideLoadingShowError("Sync Error: " + (e.reason.message || e.reason));
});
function hideLoadingShowError(msg) {
  const loadingEl = document.getElementById("loadingState");
  const errorEl = document.getElementById("errorState");
  const errorMsg = document.getElementById("errorMsgText");
  if(loadingEl) loadingEl.classList.add("hidden");
  if(errorEl) errorEl.classList.remove("hidden");
  if(errorMsg) errorMsg.textContent = msg;
}

const SHEET_ID = "1Vg8P1EL5y_FqQSR7_uDI1XtB-gDe0Bkj7IqbiOzNgxA";
const MAIN_GID = "2099497960";
const TARGETS_GID = "115442405";
const SEGMENTATION_GID = "891214324";
const TARGETS_ACM_GID = "2042936628";
const INVENTORY_GID = "1780730573";
const PRODUCTS_GID = "1779314157";
const CAT_TARGETS_GID = "1656655269";
const ACM_SALES_PLAN_GID = "892918900"; // شيت التارجت اليومي الخاص بالـ Sales Plan-ACM (TAGER_ID/PRODUCT_ID/ACM/Daily Targets)
const NEW_SEGMENTATION_GID = "683046998"; // شيت "New segmentation #6864" الخام (الداتا اللي بتتحسب منها بنية الـ Segmentation Panel)
const INBOUND_GID = "565878313";
// المصادر التلاتة بتاعت البانل ده بقوا بيتقروا من نفس السبريدشيت (SHEET_ID) بدل
// ما كانوا بيتجابوا من روابط Metabase العامة (اللينكات دي كانت بتقف/متسحبش أحياناً).
// الشيتات دي لازم تكون جوه نفس السبريدشيت ومشاركة "Anyone with the link – Viewer".
const BEGIN_INV_GID = "22283311";        // شيت "EGY Beginning Inventory #4132"
const PRODUCTS_INFO_GID = "531154071";   // شيت "Porducts_infor #4259"
const SELLTHROUGH_NEEDED_GID = "548859670"; // شيت "EGY Sell-through rate needed data #2941"

// -------------------------------------------------------------------------
// COMMERCIAL DEBUNDLIZED (تحت Targets Commercial) — بيديبندلايز الديماند بتاع
// كل Single SKU عن طريق ضم الديماند اللي جاي من البندلز اللي فيها نفس الـ
// Single SKU (مضروبة في الكمية بتاعتها جوه البندل) فوق الديماند المباشر بتاعه.
//   PRODUCTS_DEBUNDLE_MAP_GID: شيت الماب بين PRODUCT_ID (سنجل أو بندل) و SINGLE_ID
//     الأعمدة: PRODUCT_ID, PRODUCT_NAME, IS_BUNDLE, SINGLE_ID, SINGLE_NAME, PRODUCT_QUANTITY
//   SINGLE_SKU_TARGETS_GID: شيت تارجتس الـ Single SKU (Adjusted Target = تارجت يومي كونفيرمد)
//     الأعمدة: ID, NAME, Category, Adjusted Target
// -------------------------------------------------------------------------
const PRODUCTS_DEBUNDLE_MAP_GID = "1409034448";
const SINGLE_SKU_TARGETS_GID = "1620722565";
// شيت الـ COGS: الأعمدة Internal Reference (Product/Single ID), Cost, LAST_PP, Country.
// مستخدم بس في Commercial Debundlized عشان نحسب نصيب كل Single من قيمة
// البندل (GMV/CM3/PPM) بالنسبة لتكلفته (COGS) داخل نفس البندل — بالظبط زي
// عمود "%" في شيت الـ BUNDLE TABLE المرجعي (Single Cogs ÷ Bundle Cogs).
const COGS_GID = "1724469150";
// شيت Availability Locking (تحت Poor Matches): بيبين إيه الـ Single SKUs اللي
// جزء (أو كل) الاستوك بتاعها متقفل (Locked) لصالح تاجر معين (Solo) أو أكتر
// من تاجر، وبيمنع باقي التجار إنهم يعرضوا/يبيعوا نفس الـ SKU ده لحد ما القفل
// يخلص. الأعمدة: PRODUCT_ID, SKU_NAME, TAGER_ID, FULL_NAME, ALLOCATED_QUANTITY,
// QUANTITY_USED, QUANTITY_USED_AT, QUANTITY_LOCK_EXPIRY_DATE, LOCKING_TYPE,
// FLAG, LOCK_UPDATE_DATE, LOCK_START_DATE, REMAINING_PIECES.
// القفل هنا بيبقى على مستوى الـ Single SKU مباشرة (PRODUCT_ID هنا = SINGLE_ID)،
// فديماند أي Single بيتحسب بنفس طريقة Commercial Plan بالظبط: هات كل الطلب
// (Placed Pieces) بتاع أي PRODUCT_ID في MAIN_GID (سواء كان سنجل أو بندل)،
// ووزّعه على كل Single جواه (× PRODUCT_QUANTITY) عن طريق خريطة الديبندلايز
// (PRODUCTS_DEBUNDLE_MAP_GID) نفسها.
const AVAILABILITY_LOCKING_GID = "2085802038";

// -------------------------------------------------------------------------
// RECOMMENDED TRACKER (sidebar item right under "Over View") — شيت المنتجات
// والماتشات (PRODUCTS_MATCHES_GID / gid=1298408207). كل صف = ماتش
// (PRODUCT_ID × Merchant ID) واحد. الأعمدة (0-based):
//   0 Type | 1 PRODUCT_ID | 2 PRODUCT_NAME | 3 Merchant ID | 4 Merchant |
//   5 Stock | 6 Action | 7 Starting Cogs | 8 Merchant Starting AVG |
//   9 SKU Starting AVG
// الأعمدة دي بتتقرا زي ما هي من الشيت (starting snapshot). كل باقي
// الأعمدة (Current/Placed today/Placed Yesterday/Current Inventory/DOH)
// بتتحسب لايف هنا فوق MAIN_GID و PRODUCTS_DEBUNDLE_MAP_GID — التفاصيل جوه
// prepareRecommendedTrackerData().
// -------------------------------------------------------------------------
const PRODUCTS_MATCHES_GID = "1298408207";

// شيت الميرشنت اليومي (Merchant × SKU) — بيدينا Placed/Confirmed لكل يوم من
// آخر 32 يوم (DAY0 = النهاردة، DAY1 = امبارح، ...، DAY31). في Recommended
// Tracker إحنا مستخدمين بس DAY0..DAY5 (Placed) — العمود المطلوب (Placed
// Pieces اليومي لآخر 6 أيام) بعد Remaining Pieces مباشرة، متربط بنفس
// الماتش (SKU_ID × TAGER_ID = نفس مفتاح matchKey بتاع Recommended Tracker).
// الأعمدة (0-based): 0 SKU_ID, 1 SKU_NAME, 2 TAGER_ID, 3 FULL_NAME, 4 ACM,
// 5 PLACED_PIECES, 6 CONFIRMED_PIECES, 7 DELIVERED_PIECES, 8 CR_2_DAY,
// 9 DR_5_DAYS, 10 NDR_5_DAYS, 11 AVG_TOPUP, 12 ASP, 13 DAY0 .. 44 DAY31,
// 45 DAY_0_CONFIRMED .. 76 DAY_31_CONFIRMED.
const MERCHANT_SKU_DAILY_GID = "461854229";

// -------------------------------------------------------------------------
// DATA API (Apps Script backend) — ONE round trip for all sheets instead of
// the old ~14 parallel gviz/JSONP calls, which Google was rate-limiting
// (that's what caused the repeating "Timeout on GID: ..." errors and the
// dashboard falling back to stale cache on refresh).
//
// Paste the SAME Apps Script Web App deployment URL used in js/auth.js
// (CONFIG.API_URL) — a doGet handler for this was added to backend/Code.gs.
// After pasting, redeploy the Apps Script ("Manage deployments" > Edit >
// New version) so the new doGet is live on that same URL.
//
// Leave this empty ("") to keep the old per-sheet JSONP path as a fallback
// — the app works either way, but JSONP is the one that was failing.
// -------------------------------------------------------------------------
const DATA_API_URL = "";
// نفس رابط الـ Apps Script Web App الموجود في js/auth.js (CONFIG.API_URL) —
// مستخدم هنا بس عشان يبعت فيدباك الـ Recommended Tracker (save_match_feedback)
// لل backend، اللي بيكتبه لايف في شيت الماتشات (PRODUCTS_MATCHES_GID).
const MATCHES_FEEDBACK_API_URL = "https://script.google.com/macros/s/AKfycbwJw0dlXgmSt9E04YYcMzvLln0M1NQpraPvuFcxDiE5VnHLR4HWfMJAlMsJzmO1deDaGg/exec";
// The backend fetches every GID sequentially (one gviz request at a time,
// on purpose — see backend/Code.gs), so the total round trip for ~14
// sheets can take longer than a single sheet used to. 60s gives it room.
const DATA_API_TIMEOUT_MS = 60000;
// -------------------------------------------------------------------------
// SEGMENTATION PANEL (Admin Panel) — نفس الحسبة اللي في شيت EGY بالظبط
// (Target/Actual/Achievement% لشهر يوليو)، بس بتتقرأ لايف من شيت
// "New segmentation #6864" (NEW_SEGMENTATION_GID) بدل ما تبقى أرقام ثابتة.
// -------------------------------------------------------------------------
const ADMIN_PANEL_PASSWORD = "admin1";
const SEG_PANEL_COUNTRY = "EGY";
// SEG_PANEL_MONTH / SEG_PANEL_PREV_MONTH بقوا اتوماتيك دلوقتي: بيتحسبوا من
// أحدث شهر موجود فعليًا في شيت "New segmentation #6864" (مش أرقام ثابتة).
// updateSegPanelMonths() هي اللي بتحدّثهم — بتتنادى في أول renderSegmentationPanel().
let SEG_PANEL_MONTH = new Date(2026, 6, 1);       // قيمة مبدئية بس، بتتغيّر تلقائيًا
let SEG_PANEL_PREV_MONTH = new Date(2026, 5, 1);  // قيمة مبدئية بس، بتتغيّر تلقائيًا
const SEG_PANEL_APRIL_REF = new Date(2026, 3, 1);   // أبريل 2026 — مرجع ثابت بيستخدمه شيت الإكسيل الأصلي (خلية $I$78) لحساب % من إجمالي الميرشانتس بتاعت الـ LVM

// بتدور في state.newSegRows (بيانات شيت "New segmentation #6864") بتاعة
// SEG_PANEL_COUNTRY، وبتلاقي أحدث شهر موجود فيها فعلاً، وتخليه هو
// SEG_PANEL_MONTH (الشهر الحالي)، والشهر اللي قبله يبقى SEG_PANEL_PREV_MONTH.
// كده الداشبورد بيتحرك لوحده كل ما شهر جديد يتضاف في الشيت، من غير ما حد
// يعدّل في الكود.
function updateSegPanelMonths() {
  const rows = state.newSegRows || [];
  let latest = null;
  for (const row of rows) {
    if (!row.month) continue;
    if (row.country && row.country.trim().toLowerCase() !== SEG_PANEL_COUNTRY.toLowerCase()) continue;
    if (!latest || row.month.getTime() > latest.getTime()) latest = row.month;
  }
  if (!latest) return; // مفيش بيانات لسه — سيب القيم المبدئية
  SEG_PANEL_MONTH = new Date(latest.getFullYear(), latest.getMonth(), 1);
  SEG_PANEL_PREV_MONTH = new Date(latest.getFullYear(), latest.getMonth() - 1, 1);
}

let PAGE_SIZE = 10;
const CM3_PLACED_PIECES_COL = 15;
const CM3_MIN_PLACED_PIECES = 10;
const CM3_NEGATIVE_CONTRIBUTION_TARGET = 15;
// Poor Matches (زي شيت "Matches"/"NDR_Summary" بالظبط): بس الماتشات اللي
// Placed Pieces بتاعتها أكتر من 50، وأي ماتش الـ NDR% بتاعه أقل من متوسط
// باقي نفس الساب-كاتيجوري (من غيره هو) بفرق أكتر من 3% بيتعتبر "Bad".
const POOR_MATCHES_MIN_PLACED_PIECES = 50;
const POOR_MATCHES_NDR_GAP_THRESHOLD = 0.03;

// أي حساب في السورس كود بيسحب قيمة CM3 من شيت البرفورمانس الـ Main العادي (MAIN_GID)
// لازم يرجع بـ 5 أيام لورا ويقرأ الـ CM3 على أساس التاريخ ده، لأن قيمة الـ CM3 بتاخد وقت
// عشان تتقفل (Confirmed/Delivered/Returns...) وآخر 5 أيام بيكونوا لسه مش نهائيين.
// ده بيتطبق على أي حساب مصدره MAIN_GID — بما فيها سكشن Sales Plan-ACM دلوقتي،
// بعد ما بقى بياخد الأداء الفعلي (Actuals) من MAIN_GID زي أي سكشن تاني.
const CM3_LAG_DAYS = 5;

// -------------------------------------------------------------------------
// ملحوظة: سكشن Performance-Matches بقى بيقرأ من شيت الـ Main (MAIN_GID) زي أي
// سكشن تاني، فبيستخدم نفس قاعدة الـ CM3_LAG_DAYS اللي فوق ومفيش لاج خاص بيه.
// سكشن Sales Plan-ACM و Commercial Plan (السابق اسمه Commercial Debundlized)
// كمان بياخدوا الأداء الفعلي بتاعهم من MAIN_GID بالظبط زي أي سكشن تاني في
// الداشبورد — مفيش أي شيت "برفورمانس" منفصل بيتقرا لأي منهم.
// -------------------------------------------------------------------------

const TICKER_MESSAGES = [
  "Welcome to Command Center",
  "Live Performance Dashboard",
  "Real-Time KPIs",
  "Sales Tracking Active",
  "Inventory Status Updated",
  "Merchant Performance Insights",
  "Data Synced Successfully"
];

const SEGMENT_RANKS = { "in active": 0, "low value": 1, "occasional": 2, "promising": 3, "potential loyalist": 4, "loyal merchants": 5, "champions": 6 };

const state = {
  mpSalesPlanDataPrepared: [],
  mpSalesPlanFiltered: [],
  mpSalesPlanSortKey: "mtdActual",
  mpSalesPlanSortDir: "desc",
  mpSalesPlanPage: 0,
  allParsedRows: [], merchantTargets: {}, merchantSegmentsMap: {}, acmTargets: {}, newSegRows: [], newSegLoadError: null,
  acmSalesPlanData: [], // شيت التارجت اليومي بتاع Sales Plan-ACM (ACM_SALES_PLAN_GID) — الأداء الفعلي بتاعه بيتحسب لايف من allParsedRows (MAIN_GID)
  acmWeights: { gmv: 40, ndr: 20, cm3: 30, retention: 10 },
  inventoryMap: {}, productsMap: {}, categoryTargets: {},
  commercialTargets: {}, tcCategory: "grand total",
  debundleMap: [], singleSkuTargets: {}, cogsMap: new Map(), // Commercial Plan (PRODUCTS_DEBUNDLE_MAP_GID / SINGLE_SKU_TARGETS_GID / COGS_GID)
  availabilityLockingRows: [], // Availability Locking (تحت Poor Matches) — AVAILABILITY_LOCKING_GID
  productsMatchesRows: [], // Recommended Tracker (تحت Over View) — PRODUCTS_MATCHES_GID
  merchantSkuDailyRows: [], // Recommended Tracker (Day0..Day5) — MERCHANT_SKU_DAILY_GID
  recTrackerDataPrepared: [], recTrackerSortKey: "skuPlacedToday", recTrackerSortDir: "desc",
  recTrackerFiltered: [], recTrackerPage: 0,
  // Match Feedback (Recommended Tracker) — كل عمود من K فأكتر في شيت الماتشات
  // (1298408207) هو تاريخ (يوم واحد)، وكل صف فيه فيدباك الأكاونت مانجر بتاع
  // الماتش ده في اليوم ده. matchesFeedbackDateLabels = ترتيب أعمدة التواريخ
  // زي ما هي في الشيت (من قديم لجديد، نفس ترتيب الأعمدة نفسها).
  matchesFeedbackDateLabels: [],
  rtAcmFilter: "", // فلتر عمود ACM في Recommended Tracker
  rtFeedbackDateFilter: "", // "" = النهاردة، غير كده = تاريخ من matchesFeedbackDateLabels
  availabilityLockingSkuRows: [], availabilityLockingCategoryRows: [], availabilityLockingTotals: null,
  cdzDataPrepared: [], cdzSortKey: "totalConfirmed", cdzSortDir: "desc",
  cdzFiltered: [], cdzPage: 0,
  acmTableData: [], filteredAcmData: [], sortKey: "finalScorePct", sortDir: "desc", page: 0,
  merchantTableData: [], filteredMerchantData: [], sortKeyMerchant: "deliveredGmv", sortDirMerchant: "desc", pageMerchant: 0,
  filteredSegData: [], sortKeySeg: "rrConfirmed", sortDirSeg: "desc", pageSeg: 0,
  inventoryTableData: [], filteredInventoryData: [], sortKeyInventory: "conf3d", sortDirInventory: "desc", pageInventory: 0,
  inboundRows: [],
  metabaseProductsInfo: [],
  metabaseBeginningInventory: [],
  metabaseSellthroughNeeded: [],
  sellthroughDataPrepared: [],
  filteredSellthroughData: [],
  sellthroughSortKey: "stRate",
  sellthroughSortDir: "desc",
  sellthroughPage: 0,
  // فلاتر شهور لوحة الـ Sellthrough: begInv (شهر المخزون الافتتاحي/المشتريات),
  // startSale/endSale (مدى شهور المبيعات) — بالظبط زي Summary!D1 و H1/H2 في الشيت الأصلي.
  stFilters: { begInv: null, startSale: null, endSale: null, lastInboundStatus: "" },
  sellthroughMonthOptions: [],
  // true لما تتجهز الداتا مرة، يبقى فاتح البانل تاني (نفس الجلسة) مايعملش
  // لودينج ولا يعيد الحساب تاني — إلا لو الداتا الخام اتغيرت (applySnapshotToState
  // بيرجعها false تاني عشان تتحسب مرة واحدة بس مع أحدث داتا).
  sellthroughPrepared: false
};
const analystState = {
  scope: "merchant", data: [], filtered: [], sortKey: "cm3Pct", sortDir: "desc", page: 0, wired: false
};
const mpMatchesState = {
  data: [], filtered: [], sortKey: "cm3", sortDir: "desc", page: 0
};
// New Matches (تحت Performance-Matches): ماتشات (Merchant × SKU) جديدة
// خالص — ظهرت أول مرة من يوم 7 الشهر ده لحد النهاردة، ومعندهاش أي نشاط
// خالص في الشهر ده قبل يوم 7 ولا في الشهر اللي فات كله.
const mpNewMatchesState = {
  data: [], filtered: [], sortKey: "placed", sortDir: "desc", page: 0
};
// Poor Matches (تحت CM3 Analyst): نفس منطق شيت "Matches" + "NDR_Summary" —
// ماتشات (Merchant × SKU) أداؤها في الـ NDR% أقل بشكل ملحوظ من باقي نفس
// الساب-كاتيجوري بتاعتها، وبالتالي مسؤولة عن جزء من الـ "Missed Deliveries".
const poorMatchesState = {
  data: [], filtered: [], sortKey: "impactPieces", sortDir: "desc", page: 0, summary: null
};
// Availability Locking (تحت Poor Matches): جدول تفصيلي على مستوى كل قفل
// (Merchant × SKU) على حدة — الملخص على مستوى الكاتيجوري نفسه مش paginated
// (عدد الكاتيجوريز صغير)، فمخزّن في state.availabilityLockingCategoryRows.
const availabilityLockingState = {
  data: [], filtered: [], sortKey: "remainingPieces", sortDir: "desc", page: 0
};
// Healthy Locking (تحت Availability Locking): نفس فكرة availabilityLockingState
// بس على مستوى صحة كل قفل (Healthy/At Risk/Unhealthy) بدل مجرد Active/Expiring.
const healthyLockingState = {
  data: [], filtered: [], sortKey: "remainingPieces", sortDir: "desc", page: 0, merchantPage: 0
};
let pipelineChartInst = null;
let pipelineChartMetric = "pieces"; // "orders" | "pieces" — Pipeline Velocity toggle
let pipelineChartLastRows = []; // آخر بيانات اتبعتلها الشارت، عشان نقدر نعيد الرسم لما المقياس يتغيّر من غير ما نطلب الداتا تاني
let categoryChartInst = null;
const $ = (id) => document.getElementById(id);
let jsonpCounter = 0;

// ---------------------------------------------------------------------
// منع المتصفح من اقتراح/كتابة الإيميلات المحفوظة (Chrome Autofill/Account
// Chooser) جوه أي مربع سيرش في الداشبورد كله — بطلب صريح إن الحقل يفضل
// نضيف بس السيرش الفعلي اللي المستخدم بيكتبه، مش إيميل حساب متسجل على
// المتصفح. الـ autocomplete="off" اللي كان موجود على كل مربعات السيرش
// (data-lpignore/data-1p-ignore كمان) مش كفاية لوحدها — كروم بيتجاهلها في
// حالات كتير، خصوصًا لو عندك أكتر من إيميل محفوظ على البروفايل.
//
// الحل الأضمن المعروف لتعطيل الـ Autofill dropdown بتاع كروم نهائيًا: الحقل
// يبدأ بـ readonly (يعني كروم مايعتبروش حقل قابل للتعبئة أصلاً وقت ما بيقرر
// يعرض الاقتراحات)، وبيتشال الـ readonly أول ما المستخدم يدوس عليه (focus/
// mousedown/touchstart) — قبل ما يكتب أي حرف، فيقدر يكتب عادي جدًا من غير
// ما يفضل حاسس إن فيه حاجة اتقفلت. شغالة على كل input[type="search"]
// الموجودين دلوقتي، وأي واحد جديد هيتضاف بعد كده (بتتنادى live وقت الحاجة
// كمان — مش مرة واحدة بس عند تحميل الصفحة).
// ---------------------------------------------------------------------
function preventSearchInputAutofill(root) {
  (root || document).querySelectorAll('input[type="search"]').forEach(input => {
    if (input.dataset.noAutofillWired) return;
    input.dataset.noAutofillWired = "1";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("readonly", "readonly");
    // بيتشال الـ readonly أول ما يتدوس على الحقل (قبل أي حرف يتكتب)، وبيترجع
    // يتحط تاني لما الحقل يفقد الفوكس — عشان الحماية تفضل شغالة كل مرة
    // اليوزر يدوس على الحقل تاني، مش أول مرة بس.
    const unlock = () => input.removeAttribute("readonly");
    const relock = () => input.setAttribute("readonly", "readonly");
    input.addEventListener("focus", unlock);
    input.addEventListener("mousedown", unlock);
    input.addEventListener("touchstart", unlock);
    input.addEventListener("blur", relock);
  });
}
// السكريبت متحط آخر حاجة قبل </body>، فكل مربعات السيرش الأصلية في الـ HTML
// موجودة أصلاً في الـ DOM وقت ما السطر ده بيتنفذ — مفيش داعي ننتظر
// DOMContentLoaded.
preventSearchInputAutofill();

document.addEventListener("mousemove", (e) => {
  document.querySelectorAll('.hover-glow').forEach(card => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty('--mouse-x', `${x}px`);
    card.style.setProperty('--mouse-y', `${y}px`);
  });
});

const navOverview = $("navOverview");
const navRecommendedTracker = $("navRecommendedTracker");
const navInventory = $("navInventory");
const navAcmToggle = $("navAcmToggle");
const acmSubmenu = $("acmSubmenu");
const navAcmPerf = $("navAcmPerf");
const navMerchantPerf = $("navMerchantPerf");
const navAcmCaret = $("navAcmCaret");
const navCommercialToggle = $("navCommercialToggle");
const commercialSubmenu = $("commercialSubmenu");
const navCommercialCaret = $("navCommercialCaret");
const navMarketplaceToggle = $("navMarketplaceToggle");
const marketplaceSubmenu = $("marketplaceSubmenu");
const navMarketplaceCaret = $("navMarketplaceCaret");
const navTargetsCommercial = $("navTargetsCommercial");
const navCommercialDebundlized = $("navCommercialDebundlized");
const navCm3AnalystProducts = $("navCm3AnalystProducts");
const navPpmAnalystProducts = $("navPpmAnalystProducts");
const navProductsAnalyst = $("navProductsAnalyst");
const navProductsMatchesAnalyst = $("navProductsMatchesAnalyst");
const navCm3Analyst = $("navCm3Analyst");
const navPoorMatches = $("navPoorMatches");
const navAvailabilityLocking = $("navAvailabilityLocking");
const navHealthyLocking = $("navHealthyLocking");
const navMpSalesPlan = $("navMpSalesPlan");
const navMpMatches = $("navMpMatches");
const navMpNewMatches = $("navMpNewMatches");
const navAdminToggle = $("navAdminToggle");
const adminSubmenu = $("adminSubmenu");
const navAdminCaret = $("navAdminCaret");
const navSegmentationPanel = $("navSegmentationPanel");
const navSellthroughPanel = $("navSellthroughPanel");

if (navMarketplaceToggle) {
  navMarketplaceToggle.addEventListener("click", () => {
    marketplaceSubmenu.classList.toggle("hidden");
    if(navMarketplaceCaret) navMarketplaceCaret.classList.toggle("rotate");
  });
}
if (navAcmToggle) {
  navAcmToggle.addEventListener("click", () => {
    acmSubmenu.classList.toggle("hidden");
    if(navAcmCaret) navAcmCaret.classList.toggle("rotate");
  });
}
if (navCommercialToggle) {
  navCommercialToggle.addEventListener("click", () => {
    commercialSubmenu.classList.toggle("hidden");
    if(navCommercialCaret) navCommercialCaret.classList.toggle("rotate");
  });
}
if (navAdminToggle) {
  navAdminToggle.addEventListener("click", () => {
    adminSubmenu.classList.toggle("hidden");
    if(navAdminCaret) navAdminCaret.classList.toggle("rotate");
  });
}

function switchView(viewName) {
  document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active-view'); el.classList.add('hidden'); });
  if(navOverview) navOverview.classList.remove("active");
  if(navRecommendedTracker) navRecommendedTracker.classList.remove("active");
  if(navInventory) navInventory.classList.remove("active");
  if(navAcmPerf) navAcmPerf.classList.remove("active");
  if(navMerchantPerf) navMerchantPerf.classList.remove("active");
  if(navTargetsCommercial) navTargetsCommercial.classList.remove("active");
  if(navCommercialDebundlized) navCommercialDebundlized.classList.remove("active");
  if(navCm3AnalystProducts) navCm3AnalystProducts.classList.remove("active");
  if(navPpmAnalystProducts) navPpmAnalystProducts.classList.remove("active");
  if(navProductsAnalyst) navProductsAnalyst.classList.remove("active");
  if(navProductsMatchesAnalyst) navProductsMatchesAnalyst.classList.remove("active");
  if(navCm3Analyst) navCm3Analyst.classList.remove("active");
  if(navPoorMatches) navPoorMatches.classList.remove("active");
  if(navAvailabilityLocking) navAvailabilityLocking.classList.remove("active");
  if(navHealthyLocking) navHealthyLocking.classList.remove("active");
  if(navMpSalesPlan) navMpSalesPlan.classList.remove("active");
  if(navMpMatches) navMpMatches.classList.remove("active");
  if(navMpNewMatches) navMpNewMatches.classList.remove("active");
  if(navSegmentationPanel) navSegmentationPanel.classList.remove("active");
  if(navSellthroughPanel) navSellthroughPanel.classList.remove("active");

  let activeSection = null;
  if (viewName === "overview") { activeSection = $("viewOverview"); if(navOverview) navOverview.classList.add("active"); }
  else if (viewName === "recommendedTracker") { activeSection = $("viewRecommendedTracker"); if(navRecommendedTracker) navRecommendedTracker.classList.add("active"); prepareRecommendedTrackerData(); }
  else if (viewName === "inventory") { activeSection = $("viewInventory"); if(navInventory) navInventory.classList.add("active"); }
  else if (viewName === "acmPerformance") { activeSection = $("viewAcmPerformance"); if(navAcmPerf) navAcmPerf.classList.add("active"); } 
  else if (viewName === "merchantPerformance") { activeSection = $("viewMerchantPerformance"); if(navMerchantPerf) navMerchantPerf.classList.add("active"); } 
  else if (viewName === "targetsCommercial") { activeSection = $("viewTargetsCommercial"); if(navTargetsCommercial) navTargetsCommercial.classList.add("active"); renderTargetsCommercialView(); }
  else if (viewName === "commercialDebundlized") { activeSection = $("viewCommercialDebundlized"); if(navCommercialDebundlized) navCommercialDebundlized.classList.add("active"); prepareCommercialDebundlizedData(); }
  else if (viewName === "cm3AnalystProducts") { activeSection = $("viewCm3AnalystProducts"); if(navCm3AnalystProducts) navCm3AnalystProducts.classList.add("active"); prepareCm3AnalystProductsData(); }
  else if (viewName === "ppmAnalystProducts") { activeSection = $("viewPpmAnalystProducts"); if(navPpmAnalystProducts) navPpmAnalystProducts.classList.add("active"); preparePpmAnalystProductsData(); }
  else if (viewName === "productsAnalyst") { activeSection = $("viewProductsAnalyst"); if(navProductsAnalyst) navProductsAnalyst.classList.add("active"); prepareProductsAnalystData(); }
  else if (viewName === "productsMatchesAnalyst") { activeSection = $("viewProductsMatchesAnalyst"); if(navProductsMatchesAnalyst) navProductsMatchesAnalyst.classList.add("active"); prepareProductsMatchesAnalystData(); }
  // CM3 Target اتدمجت جوه صفحة CM3 Analyst نفسها (بطلب صريح) — بدل ما تبقى
  // صفحة لوحدها، دلوقتي هي أول سكشن في viewCm3Analyst، فبنرندر الاتنين مع بعض.
  else if (viewName === "cm3Analyst") { activeSection = $("viewCm3Analyst"); if(navCm3Analyst) navCm3Analyst.classList.add("active"); renderCm3TargetView(); renderCm3AnalystView(); }
  else if (viewName === "poorMatches") { activeSection = $("viewPoorMatches"); if(navPoorMatches) navPoorMatches.classList.add("active"); preparePoorMatchesData(); }
  else if (viewName === "availabilityLocking") { activeSection = $("viewAvailabilityLocking"); if(navAvailabilityLocking) navAvailabilityLocking.classList.add("active"); prepareAvailabilityLockingData(); }
  else if (viewName === "healthyLocking") { activeSection = $("viewHealthyLocking"); if(navHealthyLocking) navHealthyLocking.classList.add("active"); prepareHealthyLockingData(); }
  else if (viewName === "mpSalesPlan") { activeSection = $("viewMpSalesPlan"); if(navMpSalesPlan) navMpSalesPlan.classList.add("active"); prepareMpSalesPlanData(); }
  else if (viewName === "mpMatches") { activeSection = $("viewMpMatches"); if(navMpMatches) navMpMatches.classList.add("active"); prepareMpMatchesData(); }
  else if (viewName === "mpNewMatches") { activeSection = $("viewMpNewMatches"); if(navMpNewMatches) navMpNewMatches.classList.add("active"); prepareMpNewMatchesData(); }
  else if (viewName === "segmentation") { activeSection = $("viewSegmentationPanel"); if(navSegmentationPanel) navSegmentationPanel.classList.add("active"); renderSegmentationPanel(); }
  else if (viewName === "sellthrough") {      
      activeSection = $("viewSellthroughPanel");      
      if(navSellthroughPanel) navSellthroughPanel.classList.add("active");            
      simulateSellthroughProgress(); 
  }

  if (activeSection) {
    activeSection.classList.remove("hidden");
    setTimeout(() => activeSection.classList.add("active-view"), 10);
  }
}

if(navOverview) navOverview.addEventListener("click", () => switchView("overview"));
if(navRecommendedTracker) navRecommendedTracker.addEventListener("click", () => switchView("recommendedTracker"));
if(navInventory) navInventory.addEventListener("click", () => switchView("inventory"));
if(navAcmPerf) navAcmPerf.addEventListener("click", () => switchView("acmPerformance"));
if(navMerchantPerf) navMerchantPerf.addEventListener("click", () => switchView("merchantPerformance"));
if(navTargetsCommercial) navTargetsCommercial.addEventListener("click", () => switchView("targetsCommercial"));
if(navCommercialDebundlized) navCommercialDebundlized.addEventListener("click", () => switchView("commercialDebundlized"));
if(navCm3AnalystProducts) navCm3AnalystProducts.addEventListener("click", () => switchView("cm3AnalystProducts"));
if(navPpmAnalystProducts) navPpmAnalystProducts.addEventListener("click", () => switchView("ppmAnalystProducts"));
if(navProductsAnalyst) navProductsAnalyst.addEventListener("click", () => switchView("productsAnalyst"));
if(navProductsMatchesAnalyst) navProductsMatchesAnalyst.addEventListener("click", () => switchView("productsMatchesAnalyst"));
if(navCm3Analyst) navCm3Analyst.addEventListener("click", () => switchView("cm3Analyst"));
if(navPoorMatches) navPoorMatches.addEventListener("click", () => switchView("poorMatches"));
if(navAvailabilityLocking) navAvailabilityLocking.addEventListener("click", () => switchView("availabilityLocking"));
if(navHealthyLocking) navHealthyLocking.addEventListener("click", () => switchView("healthyLocking"));
if(navMpSalesPlan) navMpSalesPlan.addEventListener("click", () => switchView("mpSalesPlan"));
if(navMpMatches) navMpMatches.addEventListener("click", () => switchView("mpMatches"));
if(navMpNewMatches) navMpNewMatches.addEventListener("click", () => switchView("mpNewMatches"));
if(navSegmentationPanel) navSegmentationPanel.addEventListener("click", () => requestAdminAccess("segmentation"));
if(navSellthroughPanel) navSellthroughPanel.addEventListener("click", () => requestAdminAccess("sellthrough"));

// -------------------------------------------------------------------------
// ADMIN PANEL — بوابة الباسورد (admin1). لو اتفتحت مرة في نفس الجلسة (tab)
// مبيطلبش الباسورد تاني لحد ما التاب يتقفل (sessionStorage).
// -------------------------------------------------------------------------
const ADMIN_UNLOCK_KEY = "adminPanelUnlocked";
function isAdminUnlocked() {
  try { return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === "1"; } catch (e) { return false; }
}
function setAdminUnlocked() {
  try { sessionStorage.setItem(ADMIN_UNLOCK_KEY, "1"); } catch (e) { /* ignore */ }
}
let pendingAdminView = null;
function requestAdminAccess(viewName) {
  if (isAdminUnlocked()) { switchView(viewName); return; }
  pendingAdminView = viewName;
  const modal = $("adminPasswordModal");
  const input = $("adminPasswordInput");
  const errorEl = $("adminPasswordError");
  if (errorEl) errorEl.classList.add("hidden");
  if (input) { input.value = ""; }
  if (modal) { modal.classList.remove("hidden"); setTimeout(() => input && input.focus(), 50); }
}
function closeAdminPasswordModal() {
  const modal = $("adminPasswordModal");
  if (modal) modal.classList.add("hidden");
  pendingAdminView = null;
}
function submitAdminPassword() {
  const input = $("adminPasswordInput");
  const errorEl = $("adminPasswordError");
  const value = input ? input.value : "";
  if (value === ADMIN_PANEL_PASSWORD) {
    setAdminUnlocked();
    const modal = $("adminPasswordModal");
    if (modal) modal.classList.add("hidden");
    const target = pendingAdminView || "segmentation";
    pendingAdminView = null;
    switchView(target);
  } else {
    if (errorEl) errorEl.classList.remove("hidden");
    if (input) { input.value = ""; input.focus(); }
  }
}
if ($("adminPasswordSubmit")) $("adminPasswordSubmit").addEventListener("click", submitAdminPassword);
if ($("adminPasswordCancel")) $("adminPasswordCancel").addEventListener("click", closeAdminPasswordModal);
if ($("adminPasswordInput")) $("adminPasswordInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitAdminPassword(); });

// -------------------------------------------------------------------------
// SEGMENTATION PANEL — render (الجدول + كروت الـ KPI بتاعة يوليو)
// -------------------------------------------------------------------------
function segAchColor(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "text-dim";
  if (ratio >= 1) return "text-green";
  if (ratio >= 0.8) return "text-orange";
  return "text-red";
}
function fmtSegValue(unit, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (unit === "money") return fmtMoneyCompactCell(value);
  if (unit === "percent") return fmtPctCell(value * 100);
  return fmtIntCell(Math.round(value));
}
function fmtSegAch(ach) {
  if (!ach || ach.kind === "dash") return `<span class="text-dim">-</span>`;
  if (ach.ratio === null || ach.ratio === undefined || !Number.isFinite(ach.ratio)) return `<span class="text-dim">-</span>`;
  return `<span class="font-bold ${segAchColor(ach.ratio)}">${fmtPctCell(ach.ratio * 100)}</span>`;
}
function renderSegmentationPanel() {
  const grid = $("segSectionsGrid");
  const totalWrap = $("segTotalSectionWrap");
  if (!grid || !totalWrap) return;

  if (!state.newSegRows || state.newSegRows.length === 0) {
    const reason = state.newSegLoadError ? ` (${state.newSegLoadError})` : "";
    grid.innerHTML = `<div class="text-dim" style="padding:20px;">No data yet — could not load "New segmentation #6864" (GID ${NEW_SEGMENTATION_GID})${reason}. Check that this GID belongs to the same spreadsheet (${SHEET_ID}) and that the sheet is shared as "Anyone with the link – Viewer".</div>`;
    totalWrap.innerHTML = "";
    return;
  }
  updateSegPanelMonths();
  const rows = computeSegmentationPerformance();

  // كروت الـ KPI الإجمالية (Total merchants / confirmed orders / GMV / delivered GMV)
  const kpiIds = ["r113", "r114", "r115", "r118"];
  const kpiGrid = $("segKpiGrid");
  if (kpiGrid) {
    kpiGrid.innerHTML = kpiIds.map((id) => {
      const r = rows.find(x => x.id === id);
      if (!r) return "";
      return `
        <div class="metric-card hover-glow">
          <div class="metric-title">${r.label} <span class="text-dim" style="font-weight:400;font-size:11px;">July</span></div>
          <div class="metric-value">${fmtSegValue(r.unit, r.actual)}</div>
          <div class="metric-sub text-dim">Target: ${fmtSegValue(r.unit, r.target)} · ${fmtSegAch(r.ach)}</div>
        </div>`;
    }).join("");
  }

  function rowsHtml(list) {
    return list.map((r) => {
      const labelClass = r.top ? "font-bold text-light" : (r.sub ? "text-dim" : "");
      const indent = r.sub ? "padding-left:22px;" : "";
      return `
        <tr>
          <td class="${labelClass}" style="${indent}">${r.label}</td>
          <td class="num text-dim">${fmtSegValue(r.unit, r.target)}</td>
          <td class="num font-bold">${fmtSegValue(r.unit, r.actual)}</td>
          <td class="num">${fmtSegAch(r.ach)}</td>
        </tr>`;
    }).join("");
  }

  function sectionCard(sectionName, list) {
    return `
      <div class="panel table-panel hover-glow seg-section-card">
        <div class="panel-head-modern">
          <div class="panel-title-wrapper border-purple"><h3>${sectionName}</h3></div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr><th>Metric</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Ach%</th></tr>
            </thead>
            <tbody>${rowsHtml(list)}</tbody>
          </table>
        </div>
      </div>`;
  }

  // 4 سكاشن الشرائح، كل واحد لوحده في كارت صغير — 2 فوق و 2 تحت
  const sectionNames = ["HVM (Champions)", "Loyal MVM", "Potential Loyal MVM", "LVM"];
  grid.innerHTML = sectionNames.map((name) => sectionCard(name, rows.filter(r => r.section === name))).join("");

  // سكشن الـ Total لوحده تحت الكل، عرض كامل
  const totalRows = rows.filter(r => r.section === "Total");
  totalWrap.innerHTML = `
    <div class="panel table-panel hover-glow seg-total-card">
      <div class="panel-head-modern">
        <div class="panel-title-wrapper border-purple"><h3>Total</h3></div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr><th>Metric</th><th class="num">July TARGET</th><th class="num">Actuals</th><th class="num">Achievement%</th></tr>
          </thead>
          <tbody>${rowsHtml(totalRows)}</tbody>
        </table>
      </div>
    </div>`;
}

const searchMpSalesPlanInput = $("searchMpSalesPlanInput");
if (searchMpSalesPlanInput) searchMpSalesPlanInput.addEventListener("input", applyMpSalesPlanFilterAndSort);

const searchMpMatchesInput = $("searchMpMatchesInput");
if (searchMpMatchesInput) searchMpMatchesInput.addEventListener("input", applyMpMatchesSearchAndSort);
if($("prevPageMpMatches")) $("prevPageMpMatches").addEventListener("click", () => { if (mpMatchesState.page > 0) { mpMatchesState.page -= 1; renderPaginatedMpMatchesTable(); } });
if($("nextPageMpMatches")) $("nextPageMpMatches").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(mpMatchesState.filtered.length / PAGE_SIZE)); if (mpMatchesState.page < totalPages - 1) { mpMatchesState.page += 1; renderPaginatedMpMatchesTable(); } });

const searchMpNewMatchesInput = $("searchMpNewMatchesInput");
if (searchMpNewMatchesInput) searchMpNewMatchesInput.addEventListener("input", applyMpNewMatchesSearchAndSort);
if($("prevPageMpNewMatches")) $("prevPageMpNewMatches").addEventListener("click", () => { if (mpNewMatchesState.page > 0) { mpNewMatchesState.page -= 1; renderPaginatedMpNewMatchesTable(); } });
if($("nextPageMpNewMatches")) $("nextPageMpNewMatches").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(mpNewMatchesState.filtered.length / PAGE_SIZE)); if (mpNewMatchesState.page < totalPages - 1) { mpNewMatchesState.page += 1; renderPaginatedMpNewMatchesTable(); } });

const searchPoorMatchesInput = $("searchPoorMatchesInput");
if (searchPoorMatchesInput) searchPoorMatchesInput.addEventListener("input", applyPoorMatchesSearchAndSort);
if($("prevPagePoorMatches")) $("prevPagePoorMatches").addEventListener("click", () => { if (poorMatchesState.page > 0) { poorMatchesState.page -= 1; renderPaginatedPoorMatchesTable(); } });
if($("nextPagePoorMatches")) $("nextPagePoorMatches").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(poorMatchesState.filtered.length / PAGE_SIZE)); if (poorMatchesState.page < totalPages - 1) { poorMatchesState.page += 1; renderPaginatedPoorMatchesTable(); } });

const searchAvailabilityLockingInput = $("searchAvailabilityLockingInput");
if (searchAvailabilityLockingInput) searchAvailabilityLockingInput.addEventListener("input", applyAvailabilityLockingSearchAndSort);
if($("prevPageAvailabilityLocking")) $("prevPageAvailabilityLocking").addEventListener("click", () => { if (availabilityLockingState.page > 0) { availabilityLockingState.page -= 1; renderPaginatedAvailabilityLockingTable(); } });
if($("nextPageAvailabilityLocking")) $("nextPageAvailabilityLocking").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil((availabilityLockingState.filtered || []).length / PAGE_SIZE)); if (availabilityLockingState.page < totalPages - 1) { availabilityLockingState.page += 1; renderPaginatedAvailabilityLockingTable(); } });

const searchHealthyLockingInput = $("searchHealthyLockingInput");
if (searchHealthyLockingInput) searchHealthyLockingInput.addEventListener("input", applyHealthyLockingSearchAndSort);
if($("prevPageHealthyLocking")) $("prevPageHealthyLocking").addEventListener("click", () => { if (healthyLockingState.page > 0) { healthyLockingState.page -= 1; renderPaginatedHealthyLockingTable(); } });
if($("nextPageHealthyLocking")) $("nextPageHealthyLocking").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil((healthyLockingState.filtered || []).length / PAGE_SIZE)); if (healthyLockingState.page < totalPages - 1) { healthyLockingState.page += 1; renderPaginatedHealthyLockingTable(); } });
if($("prevPageHlMerchant")) $("prevPageHlMerchant").addEventListener("click", () => { if (healthyLockingState.merchantPage > 0) { healthyLockingState.merchantPage -= 1; renderHealthyLockingMerchantTable(); } });
if($("nextPageHlMerchant")) $("nextPageHlMerchant").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil((state.healthyLockingMerchantRows || []).length / PAGE_SIZE)); if (healthyLockingState.merchantPage < totalPages - 1) { healthyLockingState.merchantPage += 1; renderHealthyLockingMerchantTable(); } });

if($("prevPageMpSalesPlan")) $("prevPageMpSalesPlan").addEventListener("click", () => { if (state.mpSalesPlanPage > 0) { state.mpSalesPlanPage -= 1; renderPaginatedMpSalesPlanTable(); } });
if($("nextPageMpSalesPlan")) $("nextPageMpSalesPlan").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil((state.mpSalesPlanFiltered || []).length / PAGE_SIZE)); if (state.mpSalesPlanPage < totalPages - 1) { state.mpSalesPlanPage += 1; renderPaginatedMpSalesPlanTable(); } });

// -------------------------------------------------------------------------
// SHEET LOADING — JSONP + timeout
// -------------------------------------------------------------------------
// SHEET_LOAD_TIMEOUT_MS: how long we wait for a single GID before giving up
// on that attempt. Raised from the original 15s because with 7 sheets
// fetched in parallel, transient Google-side latency on one GID (usually
// the big MAIN sheet) was enough to blow the old, tight timeout.
const SHEET_LOAD_TIMEOUT_MS = 40000;
// How many attempts (including the first) we make per GID before we
// actually give up on that sheet.
const SHEET_LOAD_MAX_ATTEMPTS = 4;
// Base backoff between retries (grows a bit each retry).
const SHEET_LOAD_RETRY_BASE_MS = 1200;

function loadSheetViaJsonp(gid) {
  return new Promise((resolve, reject) => {
    const callbackName = `__sheetCb${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement("script");
    let settled = false;
    const cleanup = () => { if(window[callbackName]) delete window[callbackName]; if(script.parentNode) script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { if (settled) return; settled = true; cleanup(); reject(new Error(`Timeout on GID: ${gid}`)); }, SHEET_LOAD_TIMEOUT_MS);
    window[callbackName] = (payload) => { if (settled) return; settled = true; cleanup(); if (payload?.status === 'error') { reject(new Error(payload.errors[0]?.message)); return; } resolve(payload); };
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${gid}&tqx=out:json;responseHandler:${callbackName}`;
    script.onerror = () => { if (settled) return; settled = true; cleanup(); reject(new Error(`Connection failed`)); };
    document.head.appendChild(script);
  });
}

// Wraps loadSheetViaJsonp with retries + backoff. A single slow/blocked
// request no longer kills the whole load — this is what actually fixes the
// recurring "Timeout on GID: ..." error, because most timeouts are
// transient (one bad round-trip), not permanent failures.
function loadSheetWithRetry(gid, attemptsLeft = SHEET_LOAD_MAX_ATTEMPTS, attemptNumber = 1) {
  return limitSheetLoad(() => loadSheetViaJsonp(gid)).catch((err) => {
    if (attemptsLeft <= 1) throw err;
    const delay = SHEET_LOAD_RETRY_BASE_MS * attemptNumber;
    console.warn(`GID ${gid} failed (attempt ${attemptNumber}): ${err.message}. Retrying in ${delay}ms...`);
    return new Promise((resolve) => setTimeout(resolve, delay)).then(() =>
      loadSheetWithRetry(gid, attemptsLeft - 1, attemptNumber + 1)
    );
  });
}

// -------------------------------------------------------------------------
// CONCURRENCY LIMITER — this is the actual fix for the timeouts.
// Firing all ~14 GID requests at once (Promise.all) was hitting Google's
// per-document rate limit on the gviz endpoint, which is why several sheets
// (especially the big MAIN one) kept timing out. Running only a few at a
// time — the rest wait in a queue — keeps every individual request fast
// and reliable, at the cost of the whole load taking a bit longer overall.
// -------------------------------------------------------------------------
const SHEET_LOAD_CONCURRENCY = 2;
function createLoadLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; runNext(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); runNext(); });
}
const limitSheetLoad = createLoadLimiter(SHEET_LOAD_CONCURRENCY);

// -------------------------------------------------------------------------
// LOCAL CACHE (IndexedDB) — instant paint + timeout/offline fallback
// -------------------------------------------------------------------------
// Switched from localStorage to IndexedDB: localStorage caps out around
// 5-10MB per origin, and this dashboard's sheet snapshot is bigger than
// that, so every save was silently failing with a quota error. IndexedDB's
// limit is tied to available disk space, effectively large enough for this.
const IDB_NAME = "perfDashboardDB";
const IDB_STORE = "cache";
const IDB_KEY = "snapshot";

function openCacheDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB not available")); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function saveDataToCache(snapshot) {
  try {
    const db = await openCacheDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ savedAt: Date.now(), data: snapshot, fingerprint: computeSnapshotFingerprint(snapshot) }, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // Not fatal — the app just falls back to always fetching fresh next time.
    console.warn("Cache save failed:", e.message || e);
  }
}

// -------------------------------------------------------------------------
// بصمة خفيفة للداتا (بدل ما نقارن الـ JSON كله، اللي هيبقى تقيل وبطيء) —
// بتجمع عدد الصفوف + مجموع أهم الأرقام (Placed/Confirmed/Delivered/GMV/CM3)
// + آخر تاريخ، بالإضافة لعدد صفوف باقي الشيتات المهمة. لو البصمتين اتطابقوا
// يبقى مفيش أي داتا جديدة فعلياً وصلت، فمفيش داعي نعمل toast "Synchronized"
// ولا نغير حالة الـ sync بشكل مبالغ فيه كل مرة بتفتح فيها الصفحة.
// -------------------------------------------------------------------------
function computeSnapshotFingerprint(snapshot) {
  const rows = snapshot.allParsedRows || [];
  let sumPlaced = 0, sumConfirmed = 0, sumDelivered = 0, sumGmv = 0, sumCm3 = 0, maxTs = 0;
  rows.forEach(r => {
    sumPlaced += r.placedPieces || 0; sumConfirmed += r.confirmedPieces || 0; sumDelivered += r.deliveredPieces || 0;
    sumGmv += r.deliveredGmv || 0; sumCm3 += r.cm3 || 0;
    if (r.timestamp > maxTs) maxTs = r.timestamp;
  });
  const parts = [
    rows.length, Math.round(sumPlaced), Math.round(sumConfirmed), Math.round(sumDelivered),
    Math.round(sumGmv), Math.round(sumCm3), maxTs,
    (snapshot.acmSalesPlanData || []).length,
    (snapshot.debundleMap || []).length, Object.keys(snapshot.singleSkuTargets || {}).length,
    (snapshot.inboundRows || []).length, (snapshot.newSegRows || []).length,
    (snapshot.availabilityLockingRows || []).length
  ];
  return parts.join("|");
}

async function loadDataFromCache() {
  try {
    const db = await openCacheDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        const result = req.result;
        if (!result || !result.data || !Array.isArray(result.data.allParsedRows)) { resolve(null); return; }
        resolve(result);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("Cache read failed:", e.message || e);
    return null;
  }
}

function formatCacheTimestamp(ts) {
  try {
    return new Date(ts).toLocaleString("en-GB", { hour12: false });
  } catch (e) {
    return "";
  }
}

// -------------------------------------------------------------------------
// OPTIONAL DRIVE BACKUP — sends a copy of the fresh snapshot to a Google
// Apps Script Web App you deploy yourself (see APPS_SCRIPT_SETUP.md).
// Paste the deployment URL below. Leave it empty ("") to disable this
// completely — nothing else in the app depends on it.
//
// The snapshot is gzipped client-side, then split into chunks and sent as
// a sequence of small POSTs (rather than one big one) — gzip alone wasn't
// enough here (an 8MB+ gzipped snapshot is still well over what Google's
// front-end will accept in a single request to an Apps Script Web App, so
// even compressed we were still hitting "413 Content Too Large"). Chunking
// keeps every individual request small regardless of how large the sheet
// grows, so this doesn't need revisiting as the dataset grows further.
// -------------------------------------------------------------------------
const DRIVE_BACKUP_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxN2rCqUtVV9JRcJdS-er__az_fDhYW8r1YwNgyuc3Kj2Yqrs2FJO2UpiCOq61tmVtM8A/exec";

const DRIVE_BACKUP_MAX_BYTES = 40 * 1024 * 1024; // sanity ceiling on the gzipped snapshot — chunking handles anything under this
const DRIVE_BACKUP_CHUNK_CHARS = 2 * 1024 * 1024; // ~2MB of base64 text per request — comfortably under any request-size ceiling

async function gzipToBase64(str) {
  if (typeof CompressionStream === "undefined") return null; // old browser — skip backup
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return { base64: btoa(binary), byteLength: bytes.length };
}

async function backupSnapshotToDrive(snapshot) {
  if (!DRIVE_BACKUP_WEBHOOK_URL) return; // disabled
  try {
    const json = JSON.stringify({ savedAt: Date.now(), data: snapshot });
    const gz = await gzipToBase64(json);
    if (!gz) { console.warn("[Drive backup] skipped — browser doesn't support CompressionStream."); return; }
    if (gz.byteLength > DRIVE_BACKUP_MAX_BYTES) {
      console.warn(`[Drive backup] skipped (non-fatal): ${(gz.byteLength / 1e6).toFixed(1)}MB gzipped, over the ${(DRIVE_BACKUP_MAX_BYTES / 1e6).toFixed(1)}MB sanity limit.`);
      return;
    }

    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.max(1, Math.ceil(gz.base64.length / DRIVE_BACKUP_CHUNK_CHARS));
    console.log(`[Drive backup] sending ${(gz.byteLength / 1e6).toFixed(1)}MB gzipped as ${totalChunks} chunk(s), uploadId=${uploadId}`);

    for (let i = 0; i < totalChunks; i++) {
      const chunkData = gz.base64.slice(i * DRIVE_BACKUP_CHUNK_CHARS, (i + 1) * DRIVE_BACKUP_CHUNK_CHARS);
      // Sequential + awaited on purpose: keeps chunks arriving in order
      // without needing the server to buffer out-of-order pieces, and
      // avoids firing 5+ simultaneous large POSTs at once.
      await fetch(DRIVE_BACKUP_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors", // Apps Script doesn't return CORS headers; we don't need to read the response anyway.
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
        body: JSON.stringify({ action: "backup_chunk", uploadId, chunkIndex: i, totalChunks, chunkData })
      });
    }
    // NOTE: mode:"no-cors" means the browser gives us an opaque response —
    // we get here as long as every chunk request was *sent* without a
    // network-level failure, but we cannot read status codes, so this does
    // NOT confirm the server actually wrote the file (e.g. a bad Drive
    // folder ID would still "succeed" from this side). To confirm a backup
    // really landed, check the Drive backup folder for a new snapshot-*.json
    // file, or Apps Script's own Executions log (Extensions > Apps Script >
    // Executions) for the matching backup_chunk run.
    console.log(`[Drive backup] all ${totalChunks} chunk(s) sent for uploadId=${uploadId}. This confirms the requests went out, not that the server wrote the file — check the Drive folder or Apps Script Executions log to verify.`);
  } catch (e) {
    console.warn("[Drive backup] failed (non-fatal):", e.message);
  }
}

function setSyncStatus(text) {
  const el = $("sidebarUpdated");
  if (el) el.textContent = text;
}

function cellNumber(cell) {
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  const raw = (cell.f ?? cell.v ?? "0").toString().replace(/[%,]/g, "");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}
function cellText(cell) {
  if (!cell) return "";
  return (cell.f ?? cell.v ?? "").toString();
}
// -------------------------------------------------------------------------
// قراءة مضمونة لأي خلية نسبة مئوية (%) جايه من جوجل شيتس عبر gviz.
// السبب اللي بيخلي cellNumber() ماينفعش هنا: لما الخلية في جوجل شيتس تكون
// متنسّقة كـ % (زي 38.40%)، جوجل بيحط الكسر (0.384) في cell.v والنص
// المنسّق "38.40%" في cell.f — وبما إن cellNumber() بترجع cell.v على طول
// لما يكون رقم، فبترجع 0.384 مش 38.4، ولو حصل تجاهل لعلامة الـ% في النص
// (زي ما كان بيحصل قبل كده) الرقم يفضل غلط (0.384% بدل 38.40%).
// الحل الجذري: نقرأ دايمًا من النص المنسّق (cell.f) الأول لأنه هو نفسه
// اللي المستخدم شايفه في الشيت (38.40%)، ونشيل منه أي حرف مش رقم/نقطة/
// سالب (بما فيها علامة %) — كده بترجع القيمة الصحيحة زي ما هي مكتوبة في
// الشيت، سواء الخلية متنسقة % أو مكتوبة كرقم عادي. لو مفيش نص منسّق خالص
// (نادر)، بنرجع لـ cell.v كـ fallback ونكبّره *100 بس لو كان كسر (0<v<=1).
function cellPercent(cell) {
  if (!cell) return 0;
  const fmt = cell.f;
  if (fmt !== undefined && fmt !== null && String(fmt) !== "") {
    const n = parseFloat(String(fmt).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (typeof cell.v === "number") {
    return (cell.v > 0 && cell.v <= 1) ? cell.v * 100 : cell.v;
  }
  const n2 = parseFloat(String(cell.v ?? "0").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n2) ? n2 : 0;
}

const normalizeName = (name) => name ? name.toString().trim().toLowerCase() : "";

// -------------------------------------------------------------------------
// CM3 LAG (4 أيام) — يُطبَّق فقط على بيانات مصدرها MAIN_GID (شيت البرفورمانس Main).
// بياخد أحدث تاريخ موجود في الصفوف الممرَّرة، ويرجع بـ CM3_LAG_DAYS أيام لورا،
// فأي صف بعد الـ cutoff ده (يعني آخر 4 أيام) بيتجاهل من حساب الـ CM3 (باقي المقاييس
// زي Placed/Confirmed/Delivered/GMV بتفضل زي ما هي، من غير أي تأخير).
// -------------------------------------------------------------------------
function getCm3LagCutoffTimestamp(rows) {
  let latestTs = 0;
  rows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
  if (!latestTs) return 0;
  const latestDate = new Date(latestTs); latestDate.setHours(0, 0, 0, 0);
  return latestDate.getTime() - (CM3_LAG_DAYS * 86400000);
}
function isCm3RowEligible(row, cutoffTs) {
  if (!cutoffTs) return false;
  if (!row.timestamp) return false;
  const rd = new Date(row.timestamp); rd.setHours(0, 0, 0, 0);
  return rd.getTime() <= cutoffTs;
}

// -------------------------------------------------------------------------
// De-dup: شيت الـ Main (MAIN_GID) بيبقى فيه أحيانًا نفس صف (نفس التاريخ + نفس
// التاجر + نفس الـ SKU) متكرر أكتر من مرة (مشكلة مصدر الداتا نفسه، مش من هنا).
// لو سبناها زي ما هي، أي تجميع بيعتمد على state.allParsedRows — بما فيه
// Commercial Debundlized — هيدبل الأرقام لكل صف متكرر، وده هيبعدنا عن أرقام
// شيت Single المرجعي (اللي مصدره BUNDLE TABLE/Financial Profitabilty، مش
// فيهم التكرار ده). فبنفلتر الصفوف اللي عندها نفس مفتاح (تاريخ+تاجر+SKU)
// ونسيب أول ظهور بس، قبل ما نرجع الداتا لأي حساب في الداشبورد.
function parseMainSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  const seenKeys = new Set();
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0 || (!c[0] && !c[1])) continue;
    const placedOrders = cellNumber(c[9]);
    const confirmedOrders = cellNumber(c[10]);
    const placedGmv = cellNumber(c[21]);
    const confirmedGmv = placedOrders > 0 ? (placedGmv * (confirmedOrders / placedOrders)) : 0;
    
    let dateStr = cellText(c[0]);
    let d = new Date(dateStr);
    let monthYear = isNaN(d.getTime()) ? "Unknown Month" : d.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const merchantId = cellText(c[1]); const sku = cellText(c[3]);
    const dedupKey = `${dateStr}|${merchantId}|${sku}`;
    if (seenKeys.has(dedupKey)) continue; // صف مكرر — اتجاهل
    seenKeys.add(dedupKey);

    rows.push({
      date: dateStr, monthYear: monthYear, timestamp: isNaN(d.getTime()) ? 0 : d.getTime(),
      merchantId: merchantId, merchantName: cellText(c[2]), sku: sku, category: cellText(c[5]) || "Uncategorized",
      placedOrders: placedOrders, confirmedOrders: confirmedOrders, deliveredOrders: cellNumber(c[11]),
      placedGmv: placedGmv, deliveredGmv: cellNumber(c[22]), cm3: cellNumber(c[28]),
      acmName: cellText(c[31]) || "Unassigned", confirmedGmv: confirmedGmv,
      placedPieces: cellNumber(c[CM3_PLACED_PIECES_COL]),
      confirmedPieces: cellNumber(c[16]), deliveredPieces: cellNumber(c[17]),
      crPcs: cellNumber(c[18]), drPcs: cellNumber(c[19]), ndrPcs: cellNumber(c[20]), // CR_PCS / DR_PCS / NDR_PCS
      deliveredAsp: cellNumber(c[24]), // DELIVERED_ASP — عمود Y
      ppm: cellNumber(c[27]), // DELIVERED_PPM — نفس عمود الـ PPM المستخدم في شيت الـ Sales Plan Performance (عمود AB)
      ppmPerPiece: cellNumber(c[29]) // PPM_PER_PIECE — عمود AD، بيتقرا مباشرة من الشيت وليس بالحساب
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// خريطة Merchant ID -> { acmName, merchantName } مبنية من شيت الـ Main
// (MAIN_GID) عشان أي سكشن تاني (زي Performance-Matches أو Sales Plan-ACM)
// يقدر ياخد الـ ACM الصحيح من عمود AF في شيت الـ Main بدل ما يعتمد على
// عمود ACM الخاص بشيته هو لو كان فاضي/مش موثوق فيه.
// -------------------------------------------------------------------------
function buildMerchantInfoMap(mainRows) {
  const map = new Map();
  (mainRows || []).forEach(r => {
    if (!r.merchantId) return;
    const existing = map.get(r.merchantId) || {};
    const acmName = (r.acmName && r.acmName !== "Unassigned") ? r.acmName : existing.acmName;
    const merchantName = r.merchantName || existing.merchantName;
    map.set(r.merchantId, { acmName: acmName || "Unassigned", merchantName: merchantName || "" });
  });
  return map;
}

function parseTargetsSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const targets = {};
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const merchantId = cellText(c[0]);
    if (merchantId) { targets[merchantId] = { gmv: cellNumber(c[3]), placed: cellNumber(c[4]) }; }
  }
  return targets;
}

function parseSegmentationSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const segMap = {};
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const merchantId = cellText(c[2]);
    const segmentation = cellText(c[12]);
    if (merchantId && segmentation) { segMap[merchantId] = segmentation; }
  }
  return segMap;
}

function parseAcmTargetsSheet(payload) {
  const acmTargetsMap = {};
  let weights = { gmv: 40, ndr: 20, cm3: 30, retention: 10 };
  try {
    const rawRows = payload?.table?.rows ?? [];
    for (let i = 0; i < rawRows.length; i++) {
      const c = rawRows[i].c || [];
      if (!c || c.length === 0) continue;
      const acmName = cellText(c[0]).trim();
      const lowerAcm = normalizeName(acmName);
      if (acmName && lowerAcm !== "acm" && lowerAcm !== "total" && lowerAcm !== "kpis" && lowerAcm !== "weight%") {
        let gmv = cellNumber(c[1]);
        let ndrNum = cellPercent(c[2]);
        let cm3Num = cellPercent(c[3]);
        let retention = cellNumber(c[4]);
        acmTargetsMap[acmName] = { targetGmv: gmv, targetNdr: ndrNum, targetCm3: cm3Num, targetRetention: retention };
      }
      for (let j = 1; j < c.length - 1; j++) {
        const cellStr = normalizeName(cellText(c[j]));
        if (!cellStr) continue;
        let weightVal = cellPercent(c[j + 1]);
        if (cellStr.includes("delivered gmv") && weightVal > 0) weights.gmv = weightVal;
        else if (cellStr.includes("portfolio ndr") && weightVal > 0) weights.ndr = weightVal;
        else if (cellStr.includes("cm3") && weightVal > 0) weights.cm3 = weightVal;
        else if (cellStr.includes("segment retention") && weightVal > 0) weights.retention = weightVal;
      }
    }
    state.acmWeights = weights;
  } catch (error) { console.error("Parse Error in ACM Targets:", error); }
  return acmTargetsMap;
}

function parseInventorySheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const map = {};
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const skuId = cellText(c[0]);
    if (skuId && skuId !== "SKU_ID") {
      // Stock/DOH لازم يبقوا أعداد صحيحة (بدون كسور) في كل مكان بيتعرضوا فيه —
      // بنقرّبهم هنا من مصدر الداتا نفسه عشان أي حساب تاني ياخدهم صحاح من الأول.
      map[skuId] = { skuName: cellText(c[1]), stock: Math.round(cellNumber(c[2])), doh: Math.round(cellNumber(c[3])), category: cellText(c[4]), availability: cellText(c[5]), isLocked: cellText(c[6]) };
    }
  }
  return map;
}

// شيت Products (PRODUCTS_GID / gid=1779314157). الأعمدة (0-based): SKU_ID,
// SKU_NAME, IS_EXPIRED, WEBSITE_STATUS, PRICE, MAX_PRICE, PROFIT, QUANTITY,
// WEIGHT, LOCKED_OUT_MERCHANTS_ARRAY, LOCK_VISIBILITY_FLAG, CREATED_DATE,
// LAST_UPDATED_AT, CATEGORY, SUB_CATEGORY, SC, EXPIRY_END_DATE, IS_LOCKED,
// VISIBILITY_AFTER_LOCK_EXPIRATION, RESTRICT_VISIBILITY, PRODUCT_SIZE,
// COLOR_NAME_AR. websiteStatus/isLocked مستخدمين في Sellthrough Rate Panel
// (عمودين Availability / Is_Locked في آخر الجدول).
function parseProductsSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const map = {};
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const skuId = cellText(c[0]);
    if (skuId && skuId !== "SKU_ID") {
      map[skuId] = {
        price: cellNumber(c[4]), profit: cellNumber(c[6]),
        websiteStatus: cellText(c[3]) || "-",
        isLocked: cellText(c[17]) || "-",
        subCategory: cellText(c[14]) || "", // مستخدم في Poor Matches (بنشمارك NDR على مستوى الساب كاتيجوري)
        category: cellText(c[13]) || "" // fallback لو الـ SKU مش موجود في inventoryMap (مستخدم في Availability Locking)
      };
    }
  }
  return map;
}

// شيت Availability Locking (AVAILABILITY_LOCKING_GID / gid=2085802038).
// الأعمدة (0-based): PRODUCT_ID (= SINGLE_ID)، SKU_NAME، TAGER_ID، FULL_NAME
// (اسم التاجر اللي عليه القفل)، ALLOCATED_QUANTITY، QUANTITY_USED،
// QUANTITY_USED_AT، QUANTITY_LOCK_EXPIRY_DATE، LOCKING_TYPE (زي "Solo")،
// FLAG، LOCK_UPDATE_DATE، LOCK_START_DATE، REMAINING_PIECES.
function parseAvailabilityLockingSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const singleId = cellText(c[0]);
    if (!singleId || singleId === "PRODUCT_ID") continue;

    const expiryText = cellText(c[7]);
    const expiryD = expiryText ? new Date(expiryText) : null;
    const expiryTs = (expiryD && !isNaN(expiryD.getTime())) ? expiryD.getTime() : null;

    rows.push({
      singleId,
      skuName: cellText(c[1]),
      tagerId: cellText(c[2]).trim(),
      merchantName: cellText(c[3]) || cellText(c[2]),
      allocatedQty: cellNumber(c[4]),
      usedQty: cellNumber(c[5]),
      usedAtText: cellText(c[6]),
      expiryText: expiryText, expiryTs,
      lockingType: cellText(c[8]) || "Unknown",
      flag: cellText(c[9]),
      updateDateText: cellText(c[10]),
      startDateText: cellText(c[11]),
      remainingPieces: cellNumber(c[12])
    });
  }
  return rows;
}


// شيت Targets_CAT (CAT_TARGETS_GID) بقى شيت واحد موحد: صف عناوين + صف لكل
// قسم (Category, Count of SKUs, ..., CM3, CM3/Piece, CM3%, ..., PPM, PPM/Piece,
// PPM%) — بدل ما كان قسمين مختلفين في نفس الشيت. القراءة كلها بقت في
// parseCommercialTargetsSheet تحت، واللي محتاج بس CM3 target/CM3 per Piece/
// CM3% على مستوى القسم (زي CM3 Analyst) بياخدها من نفس النتيجة دي.
function deriveCategoryTargetsFromCommercial(commercialTargets) {
  const map = {};
  Object.keys(commercialTargets || {}).forEach(cat => {
    if (cat === "grand total") return; // CM3 Analyst شغال على مستوى الأقسام بس
    const d = commercialTargets[cat] || {};
    map[cat] = {
      targetCm3: d.targetCm3 || 0,
      targetCm3PerPiece: d.targetCm3PerPiece || 0,
      targetCm3Pct: d.targetCm3Pct || 0
    };
  });
  return map;
}

// -------------------------------------------------------------------------
// TARGETS COMMERCIAL (Commercial dropdown) — بيقرأ من نفس شيت الـ Category
// Targets (CAT_TARGETS_GID / gid=1656655269) بشكلها الجديد: صف عناوين واحد
// (Category, Count of SKUs, Daily Target, Total Placed, Contribution %,
// Total Confirmed, CR %, Total Delivered, DR %, ASP, Total Delivered GMV,
// Refund Rate, Net Delivered After Refund (Pcs/GMV), CM3, CM3/Piece, CM3%,
// PPM, PPM/Piece, PPM%) وبعده صف واحد لكل قسم (Consumables/Electronics/
// Fashion/Home/Leisure) + صف Total (= Grand Total). القراءة هنا بتتم
// بمطابقة نص عنوان كل عمود (مش رقم عمود ثابت) عشان تفضل شغالة حتى لو
// اتحرك ترتيب الأعمدة في الشيت.
// -------------------------------------------------------------------------
const TC_CATEGORY_ORDER = ["consumables", "electronics", "fashion", "home", "leisure", "grand total"];
// أسماء بديلة لصف الإجمالي زي ما ممكن يتكتب في الشيت (Total / Grand Total).
const TC_CATEGORY_NAME_ALIASES = { "total": "grand total", "grand total": "grand total" };
const TC_PCT_KEYS = new Set(["targetContribution", "targetCr", "targetDr", "targetRefundRate", "targetCm3Pct", "targetPpmPct"]);
// نص عنوان العمود بعد التطبيع (tcNormalize) -> المفتاح الداخلي اللي بنخزنه بيه
const TC_COLUMN_MAP = {
  "count of skus": "skuCountTarget",
  "daily target": "targetPlacedDaily", "daily target pcs day": "targetPlacedDaily",
  "total placed pcs": "placedPiecesTarget", "total placed": "placedPiecesTarget",
  "contribution": "targetContribution", "contribution %": "targetContribution", "contribution%": "targetContribution",
  "total confirmed pcs": "plannedCnfPieces", "total confirmed": "plannedCnfPieces",
  "cr %": "targetCr", "cr%": "targetCr",
  "total delivered pcs": "dlvPiecesTarget", "total delivered": "dlvPiecesTarget",
  "dr %": "targetDr", "dr%": "targetDr",
  "asp": "aspDlvPlanned",
  "total delivered gmv": "targetGmv",
  "refund rate": "targetRefundRate",
  "net delivered pcs after refund": "netDlvPiecesTarget", "net delivered after refund pcs": "netDlvPiecesTarget",
  "net delivered gmv after refund": "netDlvGmvTarget",
  "cm3": "targetCm3",
  "cm3 piece": "targetCm3PerPiece", "cm3piece": "targetCm3PerPiece",
  "cm3 %": "targetCm3Pct", "cm3%": "targetCm3Pct",
  "ppm": "targetPpm",
  "ppm piece": "targetPpmPerPiece", "ppmpiece": "targetPpmPerPiece",
  "ppm %": "targetPpmPct", "ppm%": "targetPpmPct"
};
function tcNormalize(str) {
  return (str || "").toString().trim().toLowerCase().replace(/[^\w%]+/g, " ").replace(/\s+/g, " ").trim();
}
function tcNormalizeCategoryName(raw) {
  const norm = (raw || "").toString().trim().toLowerCase();
  return TC_CATEGORY_NAME_ALIASES[norm] || norm;
}
// Fallback لو نص عنوان العمود مطابقش أي حاجة في TC_COLUMN_MAP بالظبط (اختلاف
// بسيط في الصياغة). بيدور بالكلمات المفتاحية بدل المطابقة الحرفية.
function tcFuzzyMatchColumnLabel(label) {
  const has = (s) => label.indexOf(s) !== -1;
  if (has("sku")) return "skuCountTarget";
  if (has("daily")) return "targetPlacedDaily";
  if (has("contribution")) return "targetContribution";
  if (has("refund") && has("rate")) return "targetRefundRate";
  if (has("net") && has("refund") && (has("pcs") || has("piece"))) return "netDlvPiecesTarget";
  if (has("net") && has("refund") && has("gmv")) return "netDlvGmvTarget";
  if (has("asp")) return "aspDlvPlanned";
  if (has("cm3") && (has("piece") || has("pc"))) return "targetCm3PerPiece";
  if (has("cm3") && has("%")) return "targetCm3Pct";
  if (has("cm3")) return "targetCm3";
  if (has("ppm") && (has("piece") || has("pc"))) return "targetPpmPerPiece";
  if (has("ppm") && has("%")) return "targetPpmPct";
  if (has("ppm")) return "targetPpm";
  if (has("placed")) return "placedPiecesTarget";
  if (has("confirmed") || has("cnf")) return "plannedCnfPieces";
  if (has("delivered") && has("gmv")) return "targetGmv";
  if (has("delivered")) return "dlvPiecesTarget";
  if (has("cr")) return "targetCr";
  if (has("dr")) return "targetDr";
  return null;
}
function parseCommercialTargetsSheet(payload) {
  const result = {};
  TC_CATEGORY_ORDER.forEach(cat => { result[cat] = {}; });
  try {
    const rawRows = payload?.table?.rows ?? [];
    const rawCols = payload?.table?.cols ?? [];

    // الخطوة 1: تحديد رقم عمود كل عنوان (Category, Count of SKUs, ...).
    // جوجل شيتس (gviz) غالبًا بيحط صف العناوين في table.cols (label) —
    // فده أول مكان نتأكد منه، ولو مش موجود هناك ندور على صف عناوين جوه
    // table.rows بدل كده.
    let headerColIdx = {};
    rawCols.forEach((col, idx) => {
      const t = tcNormalize(col && col.label);
      if (t) headerColIdx[t] = idx;
    });

    let headerRowIndex = -1;
    if (headerColIdx["category"] === undefined || Object.keys(headerColIdx).length < 4) {
      headerColIdx = {};
      for (let i = 0; i < rawRows.length; i++) {
        const c = rawRows[i].c || [];
        const tempMap = {};
        c.forEach((cell, idx) => { const t = tcNormalize(cellText(cell)); if (t) tempMap[t] = idx; });
        if (tempMap["category"] !== undefined && Object.keys(tempMap).length >= 4) {
          headerColIdx = tempMap; headerRowIndex = i; break;
        }
      }
    }

    if (headerColIdx["category"] === undefined) {
      console.error("Parse Error in Commercial Targets: couldn't find the 'Category' header row.");
      return result;
    }
    const catColIdx = headerColIdx["category"];

    // الخطوة 2: نربط كل رقم عمود بيانات بمفتاحنا الداخلي المعروف.
    const dataColKeyByIdx = {};
    Object.keys(headerColIdx).forEach(headerText => {
      if (headerText === "category") return;
      const key = TC_COLUMN_MAP[headerText] || tcFuzzyMatchColumnLabel(headerText);
      if (key) dataColKeyByIdx[headerColIdx[headerText]] = key;
    });

    // الخطوة 3: كل صف بيانات (باستثناء صف العناوين نفسه لو كان جوه rows)،
    // نقرأ اسم القسم من عمود Category ونطابقه بالأقسام المعروفة، وبعدين
    // نقرأ باقي الأعمدة المعروفة لنفس الصف.
    rawRows.forEach((r, idx) => {
      if (idx === headerRowIndex) return;
      const c = r.c || [];
      if (!c.length) return;
      const cat = tcNormalizeCategoryName(cellText(c[catColIdx]));
      if (!cat || !result[cat]) return; // قسم مش معروف أو صف فاضي — يتجاهل

      Object.keys(dataColKeyByIdx).forEach(colIdxStr => {
        const colIdx = Number(colIdxStr);
        if (!c[colIdx]) return;
        const key = dataColKeyByIdx[colIdx];
        const num = TC_PCT_KEYS.has(key) ? cellPercent(c[colIdx]) : cellNumber(c[colIdx]);
        result[cat][key] = num;
      });
    });

    // لو عمود CM3% أو PPM% مش موجود في الشيت لأي سبب، نحسبهم كـ fallback.
    TC_CATEGORY_ORDER.forEach(cat => {
      const d = result[cat];
      if (!d.targetCm3Pct && d.targetGmv) d.targetCm3Pct = (d.targetCm3 / d.targetGmv) * 100;
      if (!d.targetPpmPct && d.targetGmv) d.targetPpmPct = (d.targetPpm / d.targetGmv) * 100;
    });
  } catch (e) {
    console.error("Parse Error in Commercial Targets:", e);
  }
  return result;
}

// بيحسب نفس المقاييس (Actual) من شيت الـ Main (MAIN_GID) لكل قسم، باحترام
// فلتر الشهر/الـ ACM الحالي.
// - CR% (Confirmed/Placed): بتاخد كات أوف يومين (CR_LAG_DAYS) وبتاخد الشهر كله.
// - DR% (Delivered/Confirmed): بتاخد نفس كات أوف الـ 4 أيام بتاع CM3 (CM3_LAG_DAYS) وبتاخد الشهر كله.
// - NDR% = CR% × DR% (زي ما هما، من غير أي تعديل إضافي).
// - CM3/PPM: بتحترم نفس كات أوف الـ 4 أيام (CM3_LAG_DAYS) زي أي سكشن تاني مصدره MAIN_GID.
// - باقي الأرقام (Placed/Confirmed/Delivered Pieces, GMV): من غير أي لاج، الشهر كله كامل.
const CR_LAG_DAYS = 2;
function getLagCutoffTimestamp(rows, lagDays) {
  let latestTs = 0;
  rows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
  if (!latestTs) return 0;
  const latestDate = new Date(latestTs); latestDate.setHours(0, 0, 0, 0);
  return latestDate.getTime() - (lagDays * 86400000);
}
function isRowEligibleForLag(row, cutoffTs) {
  if (!cutoffTs) return false;
  if (!row.timestamp) return false;
  const rd = new Date(row.timestamp); rd.setHours(0, 0, 0, 0);
  return rd.getTime() <= cutoffTs;
}
function tcEmptyBucket() {
  return {
    placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0,
    crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, dateSet: new Set(), skuSet: new Set(),
    ppmPerPieceWeighted: 0, ppmPerPieceWeight: 0
  };
}
// grandPlaced بيتحسب مسبقاً (من مجموع كل الأقسام) عشان نقدر نحسب Contribution %
// (نصيب كل قسم من إجمالي الـ Placed) بنفس منطق عمود "Contribution %" في الشيت.
function tcFinalizeBucket(b, grandDeliveredGmv) {
  const crPct = b.crPlaced ? (b.crConfirmed / b.crPlaced) * 100 : 0;
  const drPct = b.drConfirmed ? (b.drDelivered / b.drConfirmed) * 100 : 0;
  const activeDays = b.dateSet.size || 1;
  const cm3Pct = b.cm3Gmv ? (b.cm3 / b.cm3Gmv) * 100 : 0;
  // CM3/Piece: المقام لازم ياخد نفس كات أوف الـ CM3 بالظبط (زي CM3%) — مش
  // إجمالي الـ Delivered الكامل من غير كات أوف. b.drDelivered أصلاً Delivered
  // Pieces من نفس الصفوف اللي عدت كات أوف الـ CM3 (نفس cm3CutoffTs المستخدم
  // في isRowEligibleForLag وisCm3RowEligible)، فبنعيد استخدامه هنا بدل b.delivered.
  const cm3PerPiece = b.drDelivered ? (b.cm3 / b.drDelivered) : 0;
  const ppmPerPiece = b.ppmPerPieceWeight ? (b.ppmPerPieceWeighted / b.ppmPerPieceWeight) : (b.delivered ? (b.ppm / b.delivered) : 0);
  // PPM% بيتقسم على Delivered GMV من غير كات أوف (b.deliveredGmv) عشان يفضل
  // متسق مع PPM اللي بقى من غير كات أوف برضو — مش على b.cm3Gmv (اللي لسه
  // محترم كات أوف الـ CM3).
  const ppmPct = b.deliveredGmv ? (b.ppm / b.deliveredGmv) * 100 : 0;
  const aspDlv = b.delivered ? (b.deliveredGmv / b.delivered) : 0;
  // Contribution % دلوقتي بتحسب نصيب الكاتيجوري من إجمالي الـ Total Delivered GMV
  // (مش من إجمالي الـ Placed Pieces زي الأول).
  const contribution = grandDeliveredGmv ? (b.deliveredGmv / grandDeliveredGmv) * 100 : 0;
  return {
    skuCount: b.skuSet.size,
    placedDaily: b.placed / activeDays,
    confirmedDaily: b.confirmed / activeDays,
    placed: b.placed, contribution, confirmed: b.confirmed, crPct, delivered: b.delivered, drPct,
    aspDlv, gmv: b.deliveredGmv,
    cm3: b.cm3, cm3PerPiece, cm3Pct, ppm: b.ppm, ppmPerPiece, ppmPct
  };
}
function computeCommercialActuals(mainRowsAll) {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const rows = (mainRowsAll || []).filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));
  const cm3CutoffTs = getCm3LagCutoffTimestamp(rows); // 4 أيام (CM3_LAG_DAYS) — نفس كات أوف الـ CM3 والـ DR
  const crCutoffTs = getLagCutoffTimestamp(rows, CR_LAG_DAYS); // يومين — خاص بالـ CR بس

  const CATS = ["consumables", "electronics", "fashion", "home", "leisure"];
  const buckets = {}; CATS.forEach(c => buckets[c] = tcEmptyBucket());

  rows.forEach(r => {
    const catNorm = (r.category || "").trim().toLowerCase();
    if (!buckets[catNorm]) return;
    const b = buckets[catNorm];
    b.placed += r.placedPieces; b.confirmed += r.confirmedPieces; b.delivered += r.deliveredPieces;
    b.deliveredGmv += r.deliveredGmv;
    if (r.date) b.dateSet.add(r.date);
    if (r.sku) b.skuSet.add(r.sku);
    if (isRowEligibleForLag(r, crCutoffTs)) { b.crPlaced += r.placedPieces; b.crConfirmed += r.confirmedPieces; }
    if (isRowEligibleForLag(r, cm3CutoffTs)) { b.drConfirmed += r.confirmedPieces; b.drDelivered += r.deliveredPieces; }
    if (isCm3RowEligible(r, cm3CutoffTs)) {
      b.cm3 += r.cm3; b.cm3Gmv += r.deliveredGmv;
    }
    // PPM (Total) و PPM/Piece — من غير أي كات أوف خالص (بطلب صريح)، بعكس
    // CM3 اللي لسه بياخد كات أوف الـ CM3_LAG_DAYS زي ما هو فوق.
    b.ppm += (r.ppm || 0);
    b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0);
    b.ppmPerPieceWeight += (r.deliveredPieces || 0);
  });

  const grand = tcEmptyBucket();
  CATS.forEach(cat => {
    const b = buckets[cat];
    grand.placed += b.placed; grand.confirmed += b.confirmed; grand.delivered += b.delivered;
    grand.deliveredGmv += b.deliveredGmv; grand.cm3 += b.cm3; grand.cm3Gmv += b.cm3Gmv; grand.ppm += b.ppm;
    grand.crPlaced += b.crPlaced; grand.crConfirmed += b.crConfirmed;
    grand.drConfirmed += b.drConfirmed; grand.drDelivered += b.drDelivered;
    grand.ppmPerPieceWeighted += b.ppmPerPieceWeighted; grand.ppmPerPieceWeight += b.ppmPerPieceWeight;
    b.dateSet.forEach(d => grand.dateSet.add(d));
    b.skuSet.forEach(s => grand.skuSet.add(s));
  });

  const results = {};
  CATS.forEach(cat => { results[cat] = tcFinalizeBucket(buckets[cat], grand.deliveredGmv); });
  results["grand total"] = tcFinalizeBucket(grand, grand.deliveredGmv);
  return results;
}

// شيت التارجت اليومي الخاص بسكشن Sales Plan-ACM (ACM_SALES_PLAN_GID / gid=892918900).
// الأعمدة الجديدة (0-based): TAGER_ID, TAGER_NAME, PRODUCT_ID, PRODUCT_NAME,
// CATEGORY, ACM, Adjust Daily Placed, Adjust Daily DLV, Adjust DLV GMV,
// Rounded Daily Confirmed.
//
// "Adjust Daily Placed"، "Adjust Daily DLV"، و"Rounded Daily Confirmed"
// الثلاثة دول تارجت يومي فعلاً زي ما اسمهم بيقول، بياخدوا زي ما هم من غير
// أي تحويل. الوحيد المختلف هو "Adjust DLV GMV": القيمة الموجودة في الشيت
// فعليًا هي **إجمالي الشهر كله**، مش يومي. فلو استخدمناها زي ما هي هيبوظ
// حساب الـ MTD (هيبقى أكبر من المفروض بمقدار عدد أيام الشهر). فبنسيبها
// هنا زي ما هي (Monthly) وبنحولها لتارجت يومي في prepareMpSalesPlanData
// (بالقسمة على عدد أيام الشهر) قبل ما نحسب منها MTD Target — بنفس منطق
// Commercial Plan بالظبط.
function parseAcmSalesPlanSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const plan = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const tagerId = cellText(c[0]);
    const productId = cellText(c[2]);
    // تخطي صف العناوين أو أي صف فاضي
    if (!tagerId && !productId) continue;
    if (tagerId === "TAGER_ID" || productId === "PRODUCT_ID") continue;

    plan.push({
      tagerId: tagerId,
      tagerName: cellText(c[1]),
      productId: productId,
      productName: cellText(c[3]),
      category: cellText(c[4]) || "Uncategorized",
      acm: cellText(c[5]) || "Unassigned",
      dailyPlacedTarget: cellNumber(c[6]),      // Adjust Daily Placed — يومي فعلاً
      dailyDlvTarget: cellNumber(c[7]),          // Adjust Daily DLV — يومي فعلاً
      gmvMonthlyTarget: cellNumber(c[8]),        // Adjust DLV GMV — إجمالي الشهر كله
      dailyConfirmedTarget: cellNumber(c[9])     // Rounded Daily Confirmed — يومي فعلاً
    });
  }
  return plan;
}

// -------------------------------------------------------------------------
// شيت الـ COGS (COGS_GID / gid=1724469150). الأعمدة: Internal Reference
// (Product/Single ID), Cost, LAST_PP, Country. بيرجع Map(productId -> cost).
// مستخدم بس في Commercial Debundlized لحساب وزن كل Single داخل البندل.
// -------------------------------------------------------------------------
function parseCogsSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const map = new Map();
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const productId = cellText(c[0]).trim();
    if (!productId || productId === "Internal Reference") continue;
    if (!map.has(productId)) map.set(productId, cellNumber(c[1])); // عمود B: Cost
  }
  return map;
}

// -------------------------------------------------------------------------
// شيت الماب بين المنتجات (PRODUCTS_DEBUNDLE_MAP_GID / gid=1409034448).
// كل صف بيمثل PRODUCT_ID (سنجل أو بندل) وبيقول الـ Single SKU الحقيقي بتاعه
// (SINGLE_ID) والكمية اللي طالعة منه فيه (PRODUCT_QUANTITY) — للسطور اللي هي
// أصلاً سنجل-بسنجل، PRODUCT_ID == SINGLE_ID والكمية بتبقى 1.
// الأعمدة: PRODUCT_ID, PRODUCT_NAME, IS_BUNDLE, SINGLE_ID, SINGLE_NAME, PRODUCT_QUANTITY
// -------------------------------------------------------------------------
// الأعمدة: PRODUCT_ID, PRODUCT_NAME, IS_BUNDLE, SINGLE_ID, SINGLE_NAME, PRODUCT_QUANTITY, (F فاضي/مش مستخدم), STOCK (عمود H)
function parseDebundleMapSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const productId = cellText(c[0]).trim();
    if (!productId || productId === "PRODUCT_ID") continue;
    const singleId = cellText(c[3]).trim();
    if (!singleId) continue;
    rows.push({
      productId: productId,
      productName: cellText(c[1]),
      isBundle: cellText(c[2]),
      singleId: singleId,
      singleName: cellText(c[4]),
      quantity: cellNumber(c[5]) || 1,
      stock: cellNumber(c[7]) || 0 // العمود H — الاستوك الخاص بالـ SINGLE_ID
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// شيت المنتجات والماتشات (PRODUCTS_MATCHES_GID / gid=1298408207) — مصدر
// الـ Recommended Tracker. الأعمدة (0-based) زي ما هي في الشيت:
//   0 Type | 1 PRODUCT_ID | 2 PRODUCT_NAME | 3 Merchant ID | 4 Merchant |
//   5 Stock | 6 Action | 7 Starting Cogs | 8 Merchant Starting AVG |
//   9 SKU Starting AVG | 10+ (K فأكتر) عمود لكل يوم فيدباك — عنوان العمود
//   نفسه هو التاريخ (زي "16-Aug")، وكل خلية جواه هي فيدباك الأكاونت مانجر
//   بتاع الماتش (الصف) ده في اليوم ده. الأعمدة دي بتتضاف تلقائيًا من
//   backend/Code.gs (handleSaveMatchFeedback) كل ما حد يبعت فيدباك جديد.
// -------------------------------------------------------------------------
function parseProductsMatchesSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rawCols = payload?.table?.cols ?? [];
  const rows = [];
  let feedbackDateLabels = [];
  // جوجل شيتس (gviz) أحيانًا بيحط صف العناوين في table.cols (label) بدل ما
  // يحطه جوه table.rows — زي ما بيحصل بالظبط في parseCommercialTargetsSheet.
  // فبنتأكد الأول من هنا (index >= 10 = أعمدة الفيدباك K فأكتر)، ولو مفيش
  // حاجة هنا بنرجع نلتقطها من صف العناوين جوه rows (الكود القديم تحت).
  if (rawCols.length > 10) {
    const colsLabels = rawCols.slice(10).map(col => (col && col.label ? String(col.label).trim() : "")).filter(Boolean);
    if (colsLabels.length) feedbackDateLabels = colsLabels;
  }
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const productId = cellText(c[1]).trim();
    if (!productId || productId === "PRODUCT_ID") {
      // صف الهيدر (لو اتكرر جوه الصفوف) — نلتقط منه عناوين أعمدة الفيدباك
      // (K فأكتر) قبل ما نتخطاه، لو لسه ملقطناش حاجة من table.cols فوق.
      if (productId === "PRODUCT_ID" && c.length > 10 && !feedbackDateLabels.length) {
        feedbackDateLabels = c.slice(10).map(cell => cellText(cell).trim()).filter(Boolean);
      }
      continue;
    }
    const feedbackByDate = {};
    for (let i = 10; i < c.length; i++) {
      const label = feedbackDateLabels[i - 10];
      if (!label) continue;
      const text = cellText(c[i]).trim();
      if (text) feedbackByDate[label] = text;
    }
    rows.push({
      type: cellText(c[0]),
      productId: productId,
      productName: cellText(c[2]),
      merchantId: cellText(c[3]).trim(),
      merchant: cellText(c[4]),
      stock: cellNumber(c[5]),
      action: cellText(c[6]),
      startingCogs: cellNumber(c[7]),
      merchantStartingAvg: cellNumber(c[8]),
      skuStartingAvg: cellNumber(c[9]),
      feedbackByDate
    });
  }
  // بنعلق ترتيب أعمدة التواريخ نفسه على الـ array المرجعة (من غير ما نغير
  // شكل الإرجاع الأساسي — لسه array زي ما كانت — عشان أي كود تاني بيتعامل
  // مع state.productsMatchesRows كـ array عادي يفضل شغال من غير أي تعديل).
  rows.feedbackDateLabels = feedbackDateLabels;
  return rows;
}

// -------------------------------------------------------------------------
// شيت الميرشنت اليومي (MERCHANT_SKU_DAILY_GID / gid=461854229). إحنا بس
// مستخدمين هنا PLACED PIECES بتاعة DAY0..DAY5 (آخر 6 أيام، DAY0 = النهاردة)
// لنفس الماتش (SKU_ID × TAGER_ID)، عشان نعرضهم في Recommended Tracker بعد
// عمود Remaining Pieces مباشرة — باقي أعمدة الشيت (CR_2_DAY, DR_5_DAYS,
// AVG_TOPUP, ASP, DAY_x_CONFIRMED, ...) مش مستخدمة هنا، بنتجاهلها بالكامل.
// الأعمدة (0-based): 0 SKU_ID, 1 SKU_NAME, 2 TAGER_ID, 3 FULL_NAME, 4 ACM,
// 5 PLACED_PIECES, 6 CONFIRMED_PIECES, 7 DELIVERED_PIECES, 8 CR_2_DAY,
// 9 DR_5_DAYS, 10 NDR_5_DAYS, 11 AVG_TOPUP, 12 ASP, 13 DAY0 .. 18 DAY5.
function parseMerchantSkuDailySheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const skuId = cellText(c[0]).trim();
    if (!skuId || skuId === "SKU_ID") continue; // تخطي صف العناوين لو موجود جوه rows
    rows.push({
      skuId,
      tagerId: cellText(c[2]).trim(),
      day0: cellNumber(c[13]), day1: cellNumber(c[14]), day2: cellNumber(c[15]),
      day3: cellNumber(c[16]), day4: cellNumber(c[17]), day5: cellNumber(c[18])
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// RECOMMENDED TRACKER — بيثري كل صف من parseProductsMatchesSheet() بأرقام
// لايف محسوبة من MAIN_GID و PRODUCTS_DEBUNDLE_MAP_GID، بنفس المعادلات
// المستخدمة في باقي الداشبورد (Commercial Debundlized / Availability
// Locking) عشان الأرقام تفضل متسقة مع أي سكشن تاني:
//
//  • "النهاردة" هنا معناها التاريخ الفعلي الحقيقي (تاريخ الجهاز وقت ما
//    الصفحة بتتحسب) — مش آخر تاريخ موجود في MAIN_GID زي باقي سكاشن
//    الداشبورد. لو الشيت لسه ما اتحدثش لليوم الحقيقي ده، الأعمدة دي بترجع 0
//    لنهارده بدل ما تدّي بيانات يوم قديم وتعتبرها غلط إنها "النهاردة".
//  • SKU Placed today  = مجموع Placed Pieces لكل التجار على نفس الـ SKU في
//    تاريخ النهاردة الحقيقي بالظبط — لو مفيش صفوف بتاريخ النهاردة أصلاً في
//    MAIN_GID، القيمة بترجع 0.
//  • SKU Placed Yesterday = نفس الحاجة بس بتاريخ (النهاردة الحقيقي - يوم).
//  • SKU Current AVG   = متوسط Placed Pieces اليومي لنفس الـ SKU (كل
//    التجار مع بعض) آخر 3 أيام قبل النهاردة (يعني امبارح + يومين قبله،
//    من غير النهاردة نفسه لأن يومه لسه ماخلصش) — بيتقارن بعمود "SKU
//    Starting AVG" الجاي من الشيت.
//  • Merchant Current AVG = نفس الفكرة بس على مستوى (Merchant × SKU) —
//    متوسط Placed Pieces اليومي بتاع التاجر ده بالذات على الـ SKU ده بالذات
//    آخر 3 أيام قبل النهاردة (بنفس منطق avg3dPlacedMerchant المستخدم في
//    Availability/Healthy Locking) — بيتقارن بعمود "Merchant Starting AVG".
//  • Current Inventory  = عمود H (STOCK) في شيت الديبندلايز
//    (PRODUCTS_DEBUNDLE_MAP_GID)، بمطابقة مباشرة على عمود A (PRODUCT_ID) في
//    نفس الشيت — القيمة بتتقرا زي ما هي من غير أي جمع/طرح أو أي عملية
//    حسابية عليها. لو الـ PRODUCT_ID ده مش موجود في شيت الديبندلايز أصلاً،
//    fallback لعمود Stock الموجود في نفس شيت الماتشات (1298408207) نفسه.
//  • Current Inventory DOH = "SKU TOTAL DEMAND OVERALL" (Debundled):
//      - لو الـ PRODUCT_ID Single (مش بندل): Stock (عمود H بتاعه) ÷ متوسط
//        آخر 3 أيام Confirmed المجمّع من *كل* المنتجات (سنجل أو بندل) اللي
//        بتحتوي عليه — يعني بنشوف كل البندلات اللي فيها نفس الـ Single ده
//        (من شيت الديبندلايز 1409034448) ونجمع TOTAL DEMAND بتاعها كلها
//        (Confirmed × PRODUCT_QUANTITY) فوق الديماند المباشر بتاعه، مش بس
//        الطلب اللي جاي عليه هو لوحده كـ PRODUCT_ID مباشر.
//      - لو الـ PRODUCT_ID أصلاً Bundle (IS_BUNDLE=TRUE في نفس الشيت):
//        بياخد أقل DOH (Minimum) بين كل الـ Singles اللي جوه البندل ده —
//        أضعف Single هو اللي بيتحكم في توفر البندل ككل.
//      - لو مفيش Confirmed خالص آخر 3 أيام لأي Single، الـ DOH بيرجع
//        لـ Stock بتاعه نفسه (زي ما بيحصل بالظبط في باقي السكشنز).
//  • Avg SKU Last 3D = متوسط الـ Confirmed آخر 3 أيام اللي هو أصلاً مقام
//    معادلة الـ Current Inventory DOH (نفس "SKU TOTAL DEMAND OVERALL"
//    Debundled فوق) — لو الـ PRODUCT_ID Single، الرقم ده بتاعه هو نفسه؛
//    ولو Bundle، بيبقى بتاع نفس الـ Single اللي هو "عنق الزجاجة" (صاحب أقل
//    DOH) المستخدم في حساب Current Inventory DOH بتاع البندل، عشان الرقمين
//    (DOH والـ Avg) يفضلوا متسقين مع بعض ودايمًا بيتكلموا عن نفس الـ Single.
//
// الأعمدة دي كلها بتتحسب على مستوى الماتش (Merchant × PRODUCT_ID) بالتحديد،
// كل واحد بلاج مختلف (زي ما اتطلب بالظبط، مبني على "النهاردة الحقيقي"):
//  • CR%  = Confirmed Pieces ÷ Placed Pieces، بس للصفوف اللي عدى عليها
//    يومين (lag يومين، عشان الـ Confirm ياخد وقت يستقر).
//  • DR%  = Delivered Pieces ÷ Confirmed Pieces، بس للصفوف اللي عدى عليها
//    5 أيام (lag 5 أيام).
//  • NDR% = CR% × DR% (زي ما هما، من غير أي تعديل إضافي).
//  • PPM/Piece = متوسط PPM_PER_PIECE (عمود AD في MAIN_GID) موزون بالـ
//    Delivered Pieces، بس للصفوف اللي عدى عليها 4 أيام (lag 4 أيام، نفس
//    كات أوف الـ CM3).
//  • Placed ASP = Placed GMV ÷ Placed Pieces لآخر 3 أيام "فيهم داتا فعلاً"
//    لنفس الماتش (مش آخر 3 أيام تقويم عمياني) — لو آخر 3 أيام تقويم
//    (النهاردة-3 لحد امبارح) مفيهمش Placed خالص، بيرجع تلقائيًا يدوّر
//    لأقرب 3 أيام قبلهم فيهم داتا (هيستوريكل) ويحسب منهم.
//  • CM3 Per Merchant = مجموع CM3 لنفس الماتش، بس للصفوف اللي عدى عليها
//    4 أيام (lag 4 أيام).
//  • CM3% = CM3 Per Merchant ÷ Delivered GMV لنفس الماتش، بنفس كات أوف الـ
//    4 أيام (نفس الصفوف بالظبط المستخدمة في CM3 Per Merchant).
//  • SKU PPM = PRICE - PROFIT (شيت Products، PRODUCTS_GID/1779314157) -
//    Cost (شيت COGS، COGS_GID/1724469150) — القيم الثلاثة بتتقرا زي ما هي
//    من الشيتين، مفيش أي حسبة عليهم غير الطرح المذكور.
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// SHARED HELPER — بنفس معادلة Stock/DOH المستخدمة في Recommended Tracker
// بالظبط ("SKU TOTAL DEMAND OVERALL" Debundled)، مستخرجة هنا في فانكشن
// منفصلة عشان أي سكشن تاني (زي PPM Analyst / Products) يقدر يستخدمها من
// غير ما يكرر نفس الـ 40 سطر. الشرح الكامل موجود فوق جوه تعليق
// prepareRecommendedTrackerData (Current Inventory DOH).
// -------------------------------------------------------------------------
function buildDebundledStockDohIndex(mainRows, windowDays) {
  windowDays = windowDays || 3;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const dWindowStart = todayMs - (windowDays * 86400000);

  const stockByProductId = new Map();
  (state.debundleMap || []).forEach(r => {
    if (r.productId && !stockByProductId.has(r.productId)) stockByProductId.set(r.productId, r.stock);
  });

  const { productMap: bundleProductMap } = buildDebundleProductMap(state.debundleMap, state.cogsMap);
  const isBundleByProductId = new Map();
  (state.debundleMap || []).forEach(r => {
    if (!r.productId || isBundleByProductId.has(r.productId)) return;
    isBundleByProductId.set(r.productId, /^(true|yes|1)$/i.test(String(r.isBundle || "").trim()));
  });

  const confWindowBySingleOverall = new Map();
  (mainRows || []).forEach(r => {
    if (!r.sku) return;
    const rDate = new Date(r.timestamp); rDate.setHours(0, 0, 0, 0);
    const rTime = rDate.getTime();
    if (rTime < dWindowStart || rTime >= todayMs) return;
    const mappings = bundleProductMap.get(r.sku);
    if (mappings && mappings.length) {
      mappings.forEach(mp => {
        confWindowBySingleOverall.set(mp.singleId, (confWindowBySingleOverall.get(mp.singleId) || 0) + (r.confirmedPieces || 0) * (mp.quantity || 1));
      });
    } else {
      confWindowBySingleOverall.set(r.sku, (confWindowBySingleOverall.get(r.sku) || 0) + (r.confirmedPieces || 0));
    }
  });

  const singleOverallStats = (singleId) => {
    const stock = stockByProductId.has(singleId) ? stockByProductId.get(singleId) : 0;
    const avg = (confWindowBySingleOverall.get(singleId) || 0) / windowDays;
    const doh = avg > 0 ? (stock / avg) : (stock || 0);
    return { avg, doh };
  };

  // getStockDoh(sku): الرقم النهائي الجاهز للعرض — Stock بتاع الصف نفسه
  // (Current Inventory)، و DOH بنفس منطق Bundle-minimum اللي في Recommended
  // Tracker (لو Single: DOH/Avg بتوعه هو نفسه؛ لو Bundle: بتوع أضعف Single
  // جواه، أقل DOH بينهم).
  const getStockDoh = (sku) => {
    const stock = stockByProductId.has(sku) ? stockByProductId.get(sku) : 0;
    const mappings = bundleProductMap.get(sku) || [];
    const isBundleSku = isBundleByProductId.get(sku) || mappings.length > 1;
    let doh, avg;
    if (isBundleSku && mappings.length) {
      const stats = mappings.map(mp => singleOverallStats(mp.singleId));
      const bottleneck = stats.reduce((min, s) => (s.doh < min.doh ? s : min), stats[0]);
      doh = bottleneck.doh; avg = bottleneck.avg;
    } else {
      const stats = singleOverallStats(sku);
      doh = stats.doh; avg = stats.avg;
    }
    return { stock, doh, avg };
  };

  return { stockByProductId, bundleProductMap, isBundleByProductId, singleOverallStats, getStockDoh };
}
function prepareRecommendedTrackerData() {
  const mainRows = state.allParsedRows || [];

  // Placed Pieces اليومية لآخر 6 أيام (DAY0..DAY5) من MERCHANT_SKU_DAILY_GID
  // — بمفتاح (TAGER_ID||SKU_ID) نفس ترتيب matchKey (merchantId||sku) تحت.
  const dailyByMatch = new Map();
  (state.merchantSkuDailyRows || []).forEach(r => {
    if (!r.skuId || !r.tagerId) return;
    dailyByMatch.set(r.tagerId + "||" + r.skuId, r);
  });

  // النهاردة هنا = التاريخ الحقيقي الفعلي (تاريخ الجهاز)، مش آخر تاريخ
  // موجود في MAIN_GID — طلب صريح عشان Placed Today/Yesterday و Current
  // AVG يتقاسوا على التاريخ الحقيقي مش على آخر يوم اتحدثت فيه الداتا.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const ydayMs = todayMs - 86400000;
  // نطاق "آخر 3 أيام" لحساب الـ Current AVG = 3 أيام كاملة قبل النهاردة
  // (امبارح + يومين قبله) — من غير النهاردة نفسه، لأن يومه لسه ماخلصش.
  const d3Start = todayMs - (3 * 86400000);

  // كات أوف الـ CR%/DR%/CM3% — كل واحد له لاج مختلف بالظبط زي ما اتطلب:
  // CR% (Confirmed/Placed) بيرجع يومين، DR% (Delivered/Confirmed) بيرجع 5
  // أيام، CM3%/PPM/Piece بيرجعوا 4 أيام (نفس منطق الـ lag cutoff المستخدم
  // في Commercial Debundlized/Targets Commercial، بس بأرقام لاج مختلفة هنا
  // ومبنية على "النهاردة الحقيقي" بدل آخر تاريخ في MAIN_GID).
  const crCutoffMs = todayMs - (2 * 86400000);
  const drCutoffMs = todayMs - (5 * 86400000);
  const cm3CutoffMs = todayMs - (4 * 86400000);

  // Current Inventory: بيتقرا مباشرة من شيت الديبندلايز (1409034448) — عمود A
  // (PRODUCT_ID) وعمود H (STOCK) لنفس الصف، مباشرة زي ما هو من غير أي جمع/طرح
  // أو أي عملية حسابية عليه. الـ join هنا لازم يبقى بعمود A (PRODUCT_ID) مش
  // SINGLE_ID (عمود D) — دا اللي كان بيطلّع Current Inventory غلط قبل كده.
  // لو نفس PRODUCT_ID اتكرر أكتر من صف، بناخد أول قيمة H نلاقيها بس (من غير
  // جمع القيم مع بعض).
  const stockByProductId = new Map();
  (state.debundleMap || []).forEach(r => {
    if (r.productId && !stockByProductId.has(r.productId)) stockByProductId.set(r.productId, r.stock);
  });

  // -----------------------------------------------------------------------
  // Current Inventory DOH — "SKU TOTAL DEMAND OVERALL" (Debundled):
  //   • bundleProductMap: PRODUCT_ID (سنجل أو بندل) -> [{singleId, quantity}]
  //     من شيت الديبندلايز نفسه (1409034448) — نفس الماب المستخدم في
  //     Commercial Debundlized/Availability Locking.
  //   • isBundleByProductId: PRODUCT_ID -> IS_BUNDLE (عمود C) زي ما هو في الشيت.
  //   • conf3dBySingleOverall: لكل SINGLE_ID، مجموع الـ Confirmed Pieces آخر
  //     3 أيام الجايه من *كل* المنتجات (سنجل أو بندل) اللي بتحتوي عليه —
  //     يعني بنوزع ديماند أي بندل اتباع على كل Single جواه (× PRODUCT_QUANTITY)
  //     بدل ما نقرا بس الطلب المباشر على الـ Single ID نفسه.
  // -----------------------------------------------------------------------
  const { productMap: bundleProductMap } = buildDebundleProductMap(state.debundleMap, state.cogsMap);
  const isBundleByProductId = new Map();
  (state.debundleMap || []).forEach(r => {
    if (!r.productId || isBundleByProductId.has(r.productId)) return;
    isBundleByProductId.set(r.productId, /^(true|yes|1)$/i.test(String(r.isBundle || "").trim()));
  });
  const conf3dBySingleOverall = new Map();

  // -----------------------------------------------------------------------
  // Allocated Qty / Used Qty / Remaining Pieces — من شيت Availability
  // Locking (AVAILABILITY_LOCKING_GID)، على مستوى (Merchant × Single SKU)
  // بالظبط — يعني قفل التاجر بتاع الصف ده تحديدًا على الـ Single، مش
  // إجمالي كل التجار مع بعض على نفس الـ SKU (زي TAGER_ID في الشيت =
  // merchantId هنا). بنجمع القفلات النشطة (Active) بس لنفس (تاجر × Single)
  // (عادة قفل واحد، بس بنجمع للاحتياط لو فيه أكتر من صف):
  //   • لو الـ PRODUCT_ID في Recommended Tracker Single (مش بندل): بناخد
  //     الأرقام دي بتاعة (التاجر × الـ Single) نفسه مباشرة.
  //   • لو الـ PRODUCT_ID Bundle: بندور على كل الـ Singles اللي جواه (من
  //     شيت الديبندلايز، زي بالظبط الـ Current Inventory DOH فوق)، لنفس
  //     التاجر بتاع الصف ده، وناخد الـ Single صاحب أقل Remaining Pieces
  //     (أضعف حلقة/الأكتر تقييدًا)، والـ 3 أعمدة (Allocated/Used/Remaining)
  //     بتطلع كلها بتاعة نفس الـ Single ده بالتحديد عشان الأرقام تفضل
  //     متسقة مع بعض.
  // -----------------------------------------------------------------------
  const lockingByMerchantSingle = new Map();
  (state.availabilityLockingRows || []).forEach(l => {
    if (!l.singleId || !l.tagerId || !alIsLockActive(l, todayMs)) return;
    const key = l.tagerId + "||" + l.singleId;
    const agg = lockingByMerchantSingle.get(key) || { allocatedQty: 0, usedQty: 0, remainingPieces: 0 };
    agg.allocatedQty += (l.allocatedQty || 0);
    agg.usedQty += (l.usedQty || 0);
    agg.remainingPieces += (l.remainingPieces || 0);
    lockingByMerchantSingle.set(key, agg);
  });
  const lockingForMerchantSingle = (merchantId, singleId) => lockingByMerchantSingle.get(merchantId + "||" + singleId) || { allocatedQty: 0, usedQty: 0, remainingPieces: 0 };

  // خرائط تجميع لكل SKU: Placed Pieces اليوم/امبارح/آخر 3 أيام (overall)،
  // وآخر 3 أيام على مستوى (Merchant × SKU). (Confirmed Pieces آخر 3 أيام
  // بقت conf3dBySingleOverall فوق — مبنية Debundled مش مباشرة زي هنا.)
  const placedTodayBySku = new Map();
  const placedYdayBySku = new Map();
  const placed3dBySku = new Map();
  const placed3dByMerchantSku = new Map(); // "merchantId||sku" -> pieces

  // تجميع على مستوى (Merchant × SKU) — نفس مفتاح صفوف الـ Recommended
  // Tracker (كل صف = ماتش Merchant×PRODUCT_ID) — للـ CR%/DR%/NDR%/PPM/
  // Placed ASP/CM3 Per Merchant/CM3%.
  const byMatch = new Map(); // "merchantId||sku" -> bucket
  const getMatchBucket = (key) => {
    let b = byMatch.get(key);
    if (!b) {
      b = {
        crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0,
        cm3: 0, cm3Gmv: 0, ppmPerPieceWeighted: 0, ppmPerPieceWeight: 0,
        placedByDate: new Map() // rTime -> { gmv, pieces } — للـ Placed ASP (آخر 3 أيام فيهم داتا فعلاً)
      };
      byMatch.set(key, b);
    }
    return b;
  };

  mainRows.forEach(r => {
    if (!r.sku) return;
    const rDate = new Date(r.timestamp); rDate.setHours(0, 0, 0, 0);
    const rTime = rDate.getTime();

    if (rTime === todayMs) placedTodayBySku.set(r.sku, (placedTodayBySku.get(r.sku) || 0) + (r.placedPieces || 0));
    if (rTime === ydayMs) placedYdayBySku.set(r.sku, (placedYdayBySku.get(r.sku) || 0) + (r.placedPieces || 0));
    if (rTime >= d3Start && rTime < todayMs) {
      placed3dBySku.set(r.sku, (placed3dBySku.get(r.sku) || 0) + (r.placedPieces || 0));
      if (r.merchantId) {
        const key = r.merchantId + "||" + r.sku;
        placed3dByMerchantSku.set(key, (placed3dByMerchantSku.get(key) || 0) + (r.placedPieces || 0));
      }
      // SKU TOTAL DEMAND OVERALL (Debundled) — نفس صف الـ MAIN_GID ده ممكن
      // يكون بندل، فبنوزع الـ Confirmed Pieces بتاعه على كل Single جواه
      // (× PRODUCT_QUANTITY) بدل ما نحطها بس تحت الـ PRODUCT_ID الأصلي.
      const mappings = bundleProductMap.get(r.sku);
      if (mappings && mappings.length) {
        mappings.forEach(mp => {
          conf3dBySingleOverall.set(mp.singleId, (conf3dBySingleOverall.get(mp.singleId) || 0) + (r.confirmedPieces || 0) * (mp.quantity || 1));
        });
      } else {
        // مش موجود في شيت الديبندلايز خالص — نعتبره Single لوحده بكمية 1.
        conf3dBySingleOverall.set(r.sku, (conf3dBySingleOverall.get(r.sku) || 0) + (r.confirmedPieces || 0));
      }
    }

    if (!r.merchantId) return;
    const matchKey = r.merchantId + "||" + r.sku;
    const b = getMatchBucket(matchKey);
    // Placed ASP — بنسجل كل يوم بيانات Placed فيه لوحده (تاريخ -> gmv/pieces)
    // لنفس الماتش، عشان بعدين ناخد آخر 3 أيام "فيهم داتا فعلاً" مش آخر 3
    // أيام تقويم عمياني — لو آخر 3 أيام تقويم مفيهمش داتا، بيرجع تلقائيًا
    // لأقرب 3 أيام قبلهم فيهم داتا (تفاصيل الاختيار في نهاية الفانكشن).
    if (r.placedPieces > 0) {
      const dEntry = b.placedByDate.get(rTime) || { gmv: 0, pieces: 0 };
      dEntry.gmv += (r.placedGmv || 0); dEntry.pieces += (r.placedPieces || 0);
      b.placedByDate.set(rTime, dEntry);
    }
    // CR% — Confirmed ÷ Placed، بس للصفوف اللي عدى عليها يومين (CR lag).
    if (rTime <= crCutoffMs) { b.crPlaced += (r.placedPieces || 0); b.crConfirmed += (r.confirmedPieces || 0); }
    // DR% — Delivered ÷ Confirmed، بس للصفوف اللي عدى عليها 5 أيام (DR lag).
    if (rTime <= drCutoffMs) { b.drConfirmed += (r.confirmedPieces || 0); b.drDelivered += (r.deliveredPieces || 0); }
    // CM3 Per Merchant / CM3% — بس للصفوف اللي عدى عليها 4 أيام (CM3 lag).
    if (rTime <= cm3CutoffMs) {
      b.cm3 += (r.cm3 || 0); b.cm3Gmv += (r.deliveredGmv || 0);
    }
    // PPM/Piece — من غير أي كات أوف خالص (بطلب صريح)، بعكس CM3 اللي لسه
    // بياخد كات أوف الـ 4 أيام فوق.
    b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0);
    b.ppmPerPieceWeight += (r.deliveredPieces || 0);
  });

  // Avg/DOH بتاع Single واحد (Overall/Debundled): avg = متوسط آخر 3 أيام
  // Confirmed المجمّع من *كل* المنتجات (سنجل أو بندل) اللي بتحتوي عليه
  // (conf3dBySingleOverall) — نفس الرقم ده هو مقام معادلة الـ DOH (Stock ÷
  // avg، من عمود H بتاع نفس صف الـ Single في شيت الديبندلايز).
  const singleOverallStats = (singleId) => {
    const stock = stockByProductId.has(singleId) ? stockByProductId.get(singleId) : 0;
    const avg = (conf3dBySingleOverall.get(singleId) || 0) / 3;
    const doh = avg > 0 ? (stock / avg) : (stock || 0);
    return { avg, doh };
  };

  // ---------------------------------------------------------------------
  // NEW LOCKED MATCHES — بطلب صريح: بنقتصر بس على الـ SKUs (PRODUCT_ID)
  // الموجودين أصلاً في شيت الماتشات (PRODUCTS_MATCHES_GID) — يعني منتجات
  // متتبعة فعلاً في الـ Recommended Tracker لتاجر واحد أو أكتر. مش أي SKU
  // عليه قفل في الدنيا، بس اللي هو أصلاً موجود في الشيت ده. من جوه الـ SKUs
  // دي بس، بندور على أي (تاجر × نفس الـ SKU) عليه قفل نشط (Availability
  // Locking) بس مفيش ليه صف في الشيت لنفس التاجر ده تحديدًا — يعني SKU
  // متتبع، بس التاجر ده بالذات ناقص منه. بنلاقيهم هنا (مقارنة على مستوى
  // Merchant ID + PRODUCT_ID)، وبنضمهم لنفس الـ array اللي بيتعمله .map()
  // تحت — يعني بياخدوا بالظبط نفس حسبة الأداء (Stock/DOH/CR%/DR%/NDR%/PPM/
  // CM3/ASP/Allocated/Used/Remaining Pieces) اللي أي ماتش عادي بياخدها، من
  // غير ما نكرر أي منطق. وبعدين syncNewLockedMatchesToSheet بتبعتهم لل
  // backend عشان يتكتبوا فعليًا كصفوف جديدة في الشيت نفسه (Type = "New
  // Locked")، فالمرة الجاية هيوصلوا عادي من الشيت زي أي ماتش تاني ومش
  // هيتكرر إضافتهم تاني (مفيش تكرار للداتا خالص).
  // ---------------------------------------------------------------------
  const existingMatchKeys = new Set((state.productsMatchesRows || []).map(m => m.merchantId + "||" + m.productId));
  const existingProductIds = new Set((state.productsMatchesRows || []).map(m => m.productId));
  const seenMissingLockedKeys = new Set();
  const missingLockedMatches = [];
  (state.availabilityLockingRows || []).forEach(l => {
    if (!l.singleId || !l.tagerId || !alIsLockActive(l, todayMs)) return;
    // الشرط الجديد: الـ SKU (Single ID) لازم يكون أصلاً موجود كـ PRODUCT_ID
    // في شيت الماتشات — مش أي SKU عليه قفل في أي مكان.
    if (!existingProductIds.has(l.singleId)) return;
    const key = l.tagerId + "||" + l.singleId;
    if (existingMatchKeys.has(key) || seenMissingLockedKeys.has(key)) return;
    seenMissingLockedKeys.add(key);
    const cogsCost = (state.cogsMap && state.cogsMap.get) ? (state.cogsMap.get(l.singleId) || 0) : 0;
    // Starting AVGs لماتش جديد = نفس الـ Current AVG بتاعه دلوقتي (أول لحظة
    // بيتضاف فيها للتراكر بيبقى هو نفسه نقطة البداية بطبيعة الحال).
    const skuAvgStart = (placed3dBySku.get(l.singleId) || 0) / 3;
    const merchantAvgStart = (placed3dByMerchantSku.get(key) || 0) / 3;
    missingLockedMatches.push({
      type: "New Locked",
      productId: l.singleId,
      productName: l.skuName || l.singleId,
      merchantId: l.tagerId,
      merchant: l.merchantName || l.tagerId,
      stock: stockByProductId.has(l.singleId) ? stockByProductId.get(l.singleId) : 0,
      action: "",
      startingCogs: cogsCost,
      merchantStartingAvg: merchantAvgStart,
      skuStartingAvg: skuAvgStart,
      feedbackByDate: {}
    });
  });
  if (missingLockedMatches.length) syncNewLockedMatchesToSheet(missingLockedMatches);

  const rows = (state.productsMatchesRows || []).concat(missingLockedMatches).map(m => {
    const sku = m.productId;
    const matchKey = m.merchantId + "||" + sku;
    const skuCurrentAvg = (placed3dBySku.get(sku) || 0) / 3;
    const merchantCurrentAvg = (placed3dByMerchantSku.get(matchKey) || 0) / 3;
    const currentInventory = stockByProductId.has(sku) ? stockByProductId.get(sku) : (m.stock || 0);

    // Current Inventory DOH + Avg SKU Last 3D:
    //  • لو الـ SKU ده Single (مش بندل) → الـ DOH والـ Avg بتوع
    //    "SKU TOTAL DEMAND OVERALL" هما بتوع نفسه (singleOverallStats(sku)).
    //  • لو الـ SKU ده Bundle → أضعف حلقة بتتحكم في التوفر: بناخد الـ Single
    //    صاحب أقل DOH (Minimum) بين كل الـ Singles اللي جوه البندل ده، وكل
    //    من الـ DOH والـ Avg SKU Last 3D بيطلعوا بتوع نفس الـ Single ده
    //    بالتحديد (مش بس الـ DOH لوحده) — عشان الرقمين يفضلوا متسقين مع
    //    بعض ويوضحوا مين فعلاً هو عنق الزجاجة جوه البندل.
    const mappings = bundleProductMap.get(sku) || [];
    const isBundleSku = isBundleByProductId.get(sku) || mappings.length > 1;
    let currentInventoryDoh, avgSkuLast3d;
    if (isBundleSku && mappings.length) {
      const singleStats = mappings.map(mp => singleOverallStats(mp.singleId));
      const bottleneck = singleStats.reduce((min, s) => (s.doh < min.doh ? s : min), singleStats[0]);
      currentInventoryDoh = bottleneck.doh;
      avgSkuLast3d = bottleneck.avg;
    } else {
      const stats = singleOverallStats(sku);
      currentInventoryDoh = stats.doh;
      avgSkuLast3d = stats.avg;
    }

    const b = byMatch.get(matchKey) || { crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, cm3: 0, cm3Gmv: 0, ppmPerPieceWeighted: 0, ppmPerPieceWeight: 0, placedByDate: new Map() };
    const crPct = b.crPlaced > 0 ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed > 0 ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const ppmPerPiece = b.ppmPerPieceWeight > 0 ? (b.ppmPerPieceWeighted / b.ppmPerPieceWeight) : 0;

    // Placed ASP — آخر 3 أيام "فيهم داتا فعلاً" لنفس الماتش (مش آخر 3 أيام
    // تقويم عمياني): بنرتب كل الأيام اللي فيها Placed لنفس الماتش من الأحدث
    // للأقدم، وناخد أول 3 أيام بس. لو آخر 3 أيام تقويم (النهاردة-3 لحد
    // امبارح) مفيهمش داتا، الترتيب ده بيرجع تلقائيًا لأقرب 3 أيام قبلهم
    // فيهم داتا (زي ما اتطلب بالظبط: "هات الداتا اللي قبليها هيستوريكل").
    const sortedPlacedDates = Array.from(b.placedByDate.entries()).sort((x, y) => y[0] - x[0]).slice(0, 3);
    let placedAspGmv = 0, placedAspPieces = 0;
    sortedPlacedDates.forEach(([, entry]) => { placedAspGmv += entry.gmv; placedAspPieces += entry.pieces; });
    const placedAsp = placedAspPieces > 0 ? (placedAspGmv / placedAspPieces) : 0;

    // Last Placed ASP — يوم واحد بس (أحدث يوم فيه Placed فعلاً لنفس الماتش،
    // مش متوسط آخر 3 أيام زي Placed ASP فوق) — أول عنصر في sortedPlacedDates
    // أصلاً هو أحدث يوم (مرتبين من الأحدث للأقدم).
    const lastPlacedAsp = sortedPlacedDates.length ? (sortedPlacedDates[0][1].pieces > 0 ? (sortedPlacedDates[0][1].gmv / sortedPlacedDates[0][1].pieces) : 0) : 0;

    const cm3PerMerchant = b.cm3;
    const cm3Pct = b.cm3Gmv > 0 ? (b.cm3 / b.cm3Gmv) * 100 : 0;

    // SKU PPM = PRICE - PROFIT (شيت Products، PRODUCTS_GID 1779314157) -
    // Cost (شيت COGS، COGS_GID 1724469150) لنفس الـ PRODUCT_ID — القيم دي
    // بتتقرا زي ما هي من الشيتين من غير أي حسبة تانية عليها.
    const prodInfo = state.productsMap[sku] || { price: 0, profit: 0 };
    const cogsCost = (state.cogsMap && state.cogsMap.get) ? (state.cogsMap.get(sku) || 0) : 0;
    const skuPpm = (prodInfo.price || 0) - (prodInfo.profit || 0) - cogsCost;
    // PPM% (بعد SKU PPM مباشرة) = SKU PPM ÷ Last Placed ASP (آخر يوم فيه
    // Placed فعلاً، مش المتوسط) — بيدي نسبة الـ PPM من آخر سعر بيع فعلي.
    const skuPpmPct = lastPlacedAsp > 0 ? (skuPpm / lastPlacedAsp) * 100 : 0;

    // Allocated Qty / Used Qty / Remaining Pieces (Availability Locking) —
    // على مستوى (التاجر × SKU) بتاع الصف ده تحديدًا (m.merchantId)، مش كل
    // التجار مع بعض. لو بندل: أقل Remaining Pieces بين كل الـ Singles جواه
    // لنفس التاجر ده (bottleneck)، وناخد الـ Allocated/Used منه هو نفسه مش
    // مجموع كل الـ Singles.
    let lockAllocatedQty = 0, lockUsedQty = 0, lockRemainingPieces = 0;
    if (isBundleSku && mappings.length) {
      const singleLocks = mappings.map(mp => lockingForMerchantSingle(m.merchantId, mp.singleId));
      const minLock = singleLocks.reduce((min, s) => (s.remainingPieces < min.remainingPieces ? s : min), singleLocks[0]);
      lockAllocatedQty = minLock.allocatedQty; lockUsedQty = minLock.usedQty; lockRemainingPieces = minLock.remainingPieces;
    } else {
      const lock = lockingForMerchantSingle(m.merchantId, sku);
      lockAllocatedQty = lock.allocatedQty; lockUsedQty = lock.usedQty; lockRemainingPieces = lock.remainingPieces;
    }

    // ACM بتاع التاجر ده — من merchantInfoMap (مبني من شيت الـ Main) —
    // عشان الأكاونت مانجر يقدر يفلتر ويشوف بس الماتشات بتاعته.
    const acmName = ((state.merchantInfoMap || new Map()).get(m.merchantId) || {}).acmName || "Unassigned";

    // Placed Pieces اليومية آخر 6 أيام (DAY0..DAY5) لنفس الماتش، من
    // MERCHANT_SKU_DAILY_GID — "-" (0) لو الماتش ده مش موجود في الشيت ده.
    const daily = dailyByMatch.get(matchKey) || { day0: 0, day1: 0, day2: 0, day3: 0, day4: 0, day5: 0 };

    return {
      type: m.type, productId: m.productId, productName: m.productName,
      merchantId: m.merchantId, merchant: m.merchant, stock: m.stock, action: m.action,
      startingCogs: m.startingCogs,
      merchantStartingAvg: m.merchantStartingAvg, merchantCurrentAvg,
      skuStartingAvg: m.skuStartingAvg, skuCurrentAvg,
      skuPlacedToday: placedTodayBySku.get(sku) || 0,
      skuPlacedYday: placedYdayBySku.get(sku) || 0,
      currentInventory: Math.round(currentInventory || 0),
      currentInventoryDoh: Math.round(currentInventoryDoh),
      avgSkuLast3d,
      crPct, drPct, ndrPct, ppmPerPiece, placedAsp, cm3PerMerchant, cm3Pct, skuPpm, lastPlacedAsp, skuPpmPct,
      lockAllocatedQty, lockUsedQty, lockRemainingPieces,
      day0: daily.day0 || 0, day1: daily.day1 || 0, day2: daily.day2 || 0,
      day3: daily.day3 || 0, day4: daily.day4 || 0, day5: daily.day5 || 0,
      acm: acmName, matchKey, feedbackByDate: m.feedbackByDate || {}
    };
  });

  state.recTrackerDataPrepared = rows;
  populateRtFilterDropdowns(rows);
  applyRecommendedTrackerSearchAndSort();
  renderRecommendedTrackerSummary(rows);
}

// -------------------------------------------------------------------------
// بيملأ الـ 2 Dropdown الجداد فوق جدول Recommended Tracker:
//  • rtAcmFilterSelect: كل الـ ACM المختلفين الموجودين في الصفوف الحالية.
//  • rtFeedbackDateSelect: "Feedback: Today" + كل تواريخ أعمدة الفيدباك
//    الموجودة فعليًا في الشيت (state.matchesFeedbackDateLabels)، من الأحدث
//    للأقدم، عشان المستخدم يقدر يرجع لأي يوم فات ويشوف/يعدل الفيدباك بتاعه.
// -------------------------------------------------------------------------
function populateRtFilterDropdowns(rows) {
  const acmSelect = $("rtAcmFilterSelect");
  if (acmSelect) {
    const acms = Array.from(new Set(rows.map(r => r.acm).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const prevVal = state.rtAcmFilter || "";
    acmSelect.innerHTML = `<option value="">All ACMs</option>` + acms.map(a => `<option value="${a}">${a}</option>`).join("");
    acmSelect.value = acms.includes(prevVal) ? prevVal : "";
    state.rtAcmFilter = acmSelect.value;
  }
  const dateSelect = $("rtFeedbackDateSelect");
  if (dateSelect) {
    const labels = (state.matchesFeedbackDateLabels || []).slice().reverse(); // الأحدث الأول
    const todayLabel = rtTodayFeedbackLabel();
    const prevVal = state.rtFeedbackDateFilter || "";
    const options = labels.filter(l => l !== todayLabel).map(l => `<option value="${l}">${l}</option>`).join("");
    // "All Feedback" — بيوري كل أعمدة التواريخ مع بعض كأعمدة منفصلة في آخر
    // الجدول (15-Aug, 16-Aug, ...) بدل ما تختار يوم واحد بس.
    dateSelect.innerHTML = `<option value="">Feedback: Today (${todayLabel})</option>` + options + `<option value="__ALL__">All Feedback (all dates)</option>`;
    const validValues = labels.concat(["__ALL__"]);
    dateSelect.value = validValues.includes(prevVal) ? prevVal : "";
    state.rtFeedbackDateFilter = dateSelect.value;
  }
}

// عنوان عمود فيدباك "النهاردة" بنفس فورمات الأعمدة الموجودة في الشيت (زي
// "16-Aug") — عشان لو مفيش عمود بالتاريخ ده لسه، هيتضاف تلقائيًا في
// backend/Code.gs أول ما حد يبعت فيدباك جديد النهاردة.
function rtTodayFeedbackLabel() {
  const d = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()}-${months[d.getMonth()]}`;
}

// المستخدم اللي عامل login حاليًا (من نفس session بتاعة auth.js) — بيرجع
// null لو مفيش حد عامل login عشان نمنع بعت فيدباك من غير اسم معروف.
function getLoggedInUser() {
  try {
    const raw = localStorage.getItem("taagerDashboardSession");
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session && session.name ? session : null;
  } catch (e) { return null; }
}

// عشان نمنع أي XSS بسيط لو حد كتب فيدباك فيه < أو > أو " جوه النص.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// -------------------------------------------------------------------------
// بتبعت أي match جديد لقيناه Locked (Availability Locking) بس مش موجود في
// شيت الماتشات لسه (missingLockedMatches جوه prepareRecommendedTrackerData
// فوق) لل backend، عشان يتضاف كصف جديد فعلي في الشيت (PRODUCTS_MATCHES_GID)،
// Type = "New Locked"، وباقي الأعمدة (Stock/Starting Cogs/Merchant & SKU
// Starting AVG) بالقيم المحسوبة دلوقتي زي ما هي.
//
// state.addedNewLockedMatchKeys بيمنع إعادة إرسال نفس الماتش أكتر من مرة في
// نفس الجلسة (مثلاً لو الـ Refresh التلقائي نادى prepareRecommendedTrackerData
// تاني قبل ما الشيت يتحدّث فعليًا) — لحد ما الريفريش الجاي يجيب الماتش ده من
// الشيت نفسه بعد ما يتضاف، فوقتها هيبقى موجود في existingMatchKeys تلقائيًا
// ومش هيتحسب "missing" تاني من الأساس.
// -------------------------------------------------------------------------
async function syncNewLockedMatchesToSheet(missingMatches) {
  if (!MATCHES_FEEDBACK_API_URL || !missingMatches || !missingMatches.length) return;
  if (!state.addedNewLockedMatchKeys) state.addedNewLockedMatchKeys = new Set();

  const toSend = missingMatches.filter(m => !state.addedNewLockedMatchKeys.has(m.merchantId + "||" + m.productId));
  if (!toSend.length) return;
  // بنعلّمهم كـ "اتبعتوا" فورًا (متفائل) قبل ما نستنى رد الـ backend، عشان لو
  // الفانكشن دي اتنادت تاني بسرعة (Refresh تلقائي مثلاً) قبل ما الأول يخلص،
  // منبعتش نفس الماتشات مرتين مع بعض.
  toSend.forEach(m => state.addedNewLockedMatchKeys.add(m.merchantId + "||" + m.productId));

  try {
    const resp = await fetch(MATCHES_FEEDBACK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // زي submitMatchFeedback بالظبط — نتفادى CORS preflight مع Apps Script
      body: JSON.stringify({
        action: "add_new_locked_matches",
        rows: toSend.map(m => ({
          productId: m.productId, productName: m.productName,
          merchantId: m.merchantId, merchant: m.merchant,
          stock: m.stock, startingCogs: m.startingCogs,
          merchantStartingAvg: m.merchantStartingAvg, skuStartingAvg: m.skuStartingAvg
        }))
      })
    });
    const data = await resp.json();
    if (!data || data.success === false) throw new Error((data && data.error) || "Failed to add new locked matches");
  } catch (err) {
    // فشل البعت — نشيلهم من set الـ "اتبعتوا" عشان يتحاول تاني في أقرب فرصة
    // (مرة جاية يتنادى فيها prepareRecommendedTrackerData) بدل ما يفضلوا
    // ناقصين من الشيت للأبد.
    toSend.forEach(m => state.addedNewLockedMatchKeys.delete(m.merchantId + "||" + m.productId));
    console.error("syncNewLockedMatchesToSheet error:", err);
  }
}

// -------------------------------------------------------------------------
// بيبعت فيدباك الأكاونت مانجر على ماتش معين (Merchant × PRODUCT_ID) لل
// backend (Code.gs) عشان يتكتب لايف في شيت الماتشات (PRODUCTS_MATCHES_GID)،
// في عمود تاريخ النهاردة (K فأكتر) — لو حصل أكتر من فيدباك في نفس اليوم
// لنفس الماتش، آخر واحد بيكتب فوق اللي قبله (Overwrite، مفيش هيستوري).
// الاسم اللي بيتسجل مع الفيدباك بياخده تلقائيًا من المستخدم Login حاليًا.
// -------------------------------------------------------------------------
async function submitMatchFeedback(merchantId, productId, text, rowEl) {
  const statusEl = rowEl ? rowEl.querySelector(".rt-feedback-status") : null;
  const sendBtn = rowEl ? rowEl.querySelector(".rt-feedback-send") : null;
  const setStatus = (msg, cls) => { if (statusEl) { statusEl.textContent = msg; statusEl.className = "rt-feedback-status " + (cls || ""); } };

  const trimmed = (text || "").trim();
  if (!trimmed) { setStatus("اكتب فيدباك الأول", "err"); return; }

  const user = getLoggedInUser();
  if (!user) { setStatus("لازم تعمل Login الأول", "err"); return; }

  if (!MATCHES_FEEDBACK_API_URL) { setStatus("Backend مش متظبط", "err"); return; }

  if (sendBtn) { sendBtn.classList.add("is-saving"); sendBtn.disabled = true; }
  setStatus("بيتبعت...", "");

  try {
    const resp = await fetch(MATCHES_FEEDBACK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // زي auth.js بالظبط — عشان نتفادى CORS preflight مع Apps Script
      body: JSON.stringify({
        action: "save_match_feedback",
        merchantId: merchantId,
        productId: productId,
        feedback: trimmed,
        acmName: user.name
      })
    });
    const data = await resp.json();
    if (!data || data.success === false) throw new Error((data && data.error) || "فشل الحفظ");

    // نحدّث الداتا المحلية فورًا (من غير ما نستنى Refresh كامل للداشبورد)
    // عشان المستخدم يشوف الفيدباك اتحفظ في نفس اللحظة.
    const todayLabel = rtTodayFeedbackLabel();
    const matchKey = merchantId + "||" + productId;
    (state.productsMatchesRows || []).forEach(m => {
      if (m.merchantId === merchantId && m.productId === productId) { m.feedbackByDate = m.feedbackByDate || {}; m.feedbackByDate[todayLabel] = trimmed; }
    });
    (state.recTrackerDataPrepared || []).forEach(m => {
      if (m.matchKey === matchKey) { m.feedbackByDate = m.feedbackByDate || {}; m.feedbackByDate[todayLabel] = trimmed; }
    });
    if (!state.matchesFeedbackDateLabels) state.matchesFeedbackDateLabels = [];
    if (!state.matchesFeedbackDateLabels.includes(todayLabel)) state.matchesFeedbackDateLabels.push(todayLabel);

    setStatus("اتحفظ ✓", "ok");
    renderPaginatedRecommendedTrackerTable();
  } catch (err) {
    console.error("submitMatchFeedback error:", err);
    setStatus("حصل خطأ، جرب تاني", "err");
    if (sendBtn) { sendBtn.classList.remove("is-saving"); sendBtn.disabled = false; }
  }
}

function renderRecommendedTrackerSummary(rows) {
  const skuSet = new Set(rows.map(r => r.productId));
  const totalInventory = rows.reduce((s, r) => s + (r.currentInventory || 0), 0);
  const dohRows = rows.filter(r => r.currentInventoryDoh > 0);
  const avgDoh = dohRows.length ? dohRows.reduce((s, r) => s + r.currentInventoryDoh, 0) / dohRows.length : 0;
  if ($("rtTotalRows")) $("rtTotalRows").textContent = fmtInt.format(rows.length);
  if ($("rtTotalSkus")) $("rtTotalSkus").textContent = fmtInt.format(skuSet.size);
  if ($("rtTotalInventory")) $("rtTotalInventory").textContent = fmtInt.format(Math.round(totalInventory));
  if ($("rtAvgDoh")) $("rtAvgDoh").textContent = Math.round(avgDoh);
}

function sortRecommendedTracker(key) {
  if (state.recTrackerSortKey === key) { state.recTrackerSortDir = state.recTrackerSortDir === "asc" ? "desc" : "asc"; }
  else { state.recTrackerSortKey = key; state.recTrackerSortDir = "desc"; }
  applyRecommendedTrackerSearchAndSort();
}

function applyRecommendedTrackerSearchAndSort() {
  const term = $("searchRecommendedTrackerInput") ? $("searchRecommendedTrackerInput").value.trim().toLowerCase() : "";
  const acmFilter = state.rtAcmFilter || "";
  state.recTrackerFiltered = (state.recTrackerDataPrepared || []).filter(m => {
    if (acmFilter && m.acm !== acmFilter) return false;
    if (!term) return true;
    return (m.productName && m.productName.toLowerCase().includes(term)) || (m.productId && String(m.productId).toLowerCase().includes(term)) ||
      (m.merchant && m.merchant.toLowerCase().includes(term)) || (m.merchantId && String(m.merchantId).toLowerCase().includes(term)) ||
      (m.action && m.action.toLowerCase().includes(term)) || (m.type && m.type.toLowerCase().includes(term)) ||
      (m.acm && m.acm.toLowerCase().includes(term));
  });
  const { recTrackerSortKey, recTrackerSortDir } = state; const dir = recTrackerSortDir === "asc" ? 1 : -1;
  state.recTrackerFiltered.sort((a, b) => {
    const av = a[recTrackerSortKey]; const bv = b[recTrackerSortKey];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return ((av || 0) - (bv || 0)) * dir;
  });
  state.recTrackerPage = 0;
  renderPaginatedRecommendedTrackerTable();
}

// كل تواريخ أعمدة الفيدباك الموجودة فعليًا في الشيت + النهاردة (حتى لو
// عمود النهاردة لسه مش موجود في الشيت لأنه محدش بعت فيدباك النهاردة لسه) —
// بترتيب الشيت نفسه (من الأقدم للأحدث)، مستخدمة في وضع "All Feedback".
function rtAllFeedbackLabelsIncludingToday() {
  const todayLabel = rtTodayFeedbackLabel();
  const labels = (state.matchesFeedbackDateLabels || []).slice();
  if (!labels.includes(todayLabel)) labels.push(todayLabel);
  return labels;
}

// بيزود/بيشيل أعمدة الهيدر الإضافية بتاعة "All Feedback" (عمود لكل تاريخ)
// جمب عمود "Feedback" الأساسي (بتاع النهاردة، قابل للكتابة). بيتنفذ قبل ما
// نبني صفوف الـ tbody عشان عدد الأعمدة يفضل متطابق بين thead وtbody.
function syncRtFeedbackHeaders(isAllMode) {
  const headerRow = $("rtTableHeaderRow");
  if (!headerRow) return;
  headerRow.querySelectorAll(".rt-feedback-date-th").forEach(el => el.remove());
  if (!isAllMode) return;
  const todayLabel = rtTodayFeedbackLabel();
  rtAllFeedbackLabelsIncludingToday().filter(l => l !== todayLabel).forEach(label => {
    const th = document.createElement("th");
    th.className = "rt-feedback-date-th";
    th.style.minWidth = "180px";
    th.textContent = label;
    headerRow.appendChild(th);
  });
}

function renderPaginatedRecommendedTrackerTable() {
  const tbody = $("recommendedTrackerTableBody"); if (!tbody) return; tbody.innerHTML = "";
  const start = state.recTrackerPage * PAGE_SIZE;
  const pageRows = state.recTrackerFiltered.slice(start, start + PAGE_SIZE);
  const todayLabel = rtTodayFeedbackLabel();
  const isAllMode = state.rtFeedbackDateFilter === "__ALL__";
  // في وضع "All Feedback"، عمود "Feedback" الأساسي بيفضل دايمًا عمود
  // النهاردة (قابل للكتابة)، وباقي التواريخ بتتضاف كأعمدة إضافية للقراءة بس.
  const selectedDateLabel = isAllMode ? todayLabel : (state.rtFeedbackDateFilter || todayLabel);
  const isViewingToday = selectedDateLabel === todayLabel;
  syncRtFeedbackHeaders(isAllMode);
  const extraDateLabels = isAllMode ? rtAllFeedbackLabelsIncludingToday().filter(l => l !== todayLabel) : [];
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.dataset.matchKey = m.matchKey;
    tr.dataset.merchantId = m.merchantId;
    tr.dataset.productId = m.productId;
    const feedbackText = (m.feedbackByDate && m.feedbackByDate[selectedDateLabel]) || "";
    const feedbackCellHtml = isViewingToday
      ? `<div class="rt-feedback-cell">
           <div class="rt-feedback-view ${feedbackText ? '' : 'rt-feedback-empty'}">${feedbackText ? escapeHtml(feedbackText) : 'No feedback yet today'}</div>
           <div class="rt-feedback-write">
             <input type="text" class="rt-feedback-input" placeholder="Write feedback for ${todayLabel}..." value="${feedbackText ? escapeHtml(feedbackText) : ''}" />
             <button type="button" class="btn btn-primary small rt-feedback-send">Send</button>
           </div>
           <div class="rt-feedback-status"></div>
         </div>`
      : `<div class="rt-feedback-cell">
           <div class="rt-feedback-view ${feedbackText ? '' : 'rt-feedback-empty'}">${feedbackText ? escapeHtml(feedbackText) : `No feedback on ${selectedDateLabel}`}</div>
         </div>`;
    // في وضع "All Feedback" — عمود إضافي للقراءة بس لكل تاريخ تاني غير النهاردة.
    const extraDateCellsHtml = extraDateLabels.map(label => {
      const text = (m.feedbackByDate && m.feedbackByDate[label]) || "";
      return `<td><div class="rt-feedback-cell"><div class="rt-feedback-view ${text ? '' : 'rt-feedback-empty'}">${text ? escapeHtml(text) : `No feedback on ${label}`}</div></div></td>`;
    }).join("");
    tr.innerHTML = `
      <td class="${m.type === "New Locked" ? "text-orange font-bold" : "text-dim"}">${m.type || "-"}</td>
      <td class="font-mono text-dim">${m.productId}</td>
      <td class="truncate-cell" title="${m.productName}">${m.productName}</td>
      <td class="font-mono text-dim">${m.merchantId}</td>
      <td class="truncate-cell" title="${m.merchant}">${m.merchant}</td>
      <td class="text-dim">${m.acm || "-"}</td>
      <td class="num"><span class="badge-outline ${m.stock > 10 ? 'green' : 'red'}">${fmtIntCell(Math.round(m.stock))}</span></td>
      <td class="text-dim">${m.action || "-"}</td>
      <td class="num font-bold text-blue">${fmtMoneyCompactCell(m.startingCogs)}</td>
      <td class="num text-dim">${m.merchantStartingAvg.toFixed(1)}</td>
      <td class="num font-bold ${m.merchantCurrentAvg >= m.merchantStartingAvg ? 'text-green' : 'text-red'}">${m.merchantCurrentAvg.toFixed(1)}</td>
      <td class="num text-dim">${m.skuStartingAvg.toFixed(1)}</td>
      <td class="num font-bold ${m.skuCurrentAvg >= m.skuStartingAvg ? 'text-green' : 'text-red'}">${m.skuCurrentAvg.toFixed(1)}</td>
      <td class="num text-light font-bold">${fmtIntCell(Math.round(m.skuPlacedToday))}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.skuPlacedYday))}</td>
      <td class="num font-bold text-orange">${fmtIntCell(m.currentInventory)}</td>
      <td class="num font-bold text-purple">${fmtIntCell(m.currentInventoryDoh)}</td>
      <td class="num text-dim">${m.avgSkuLast3d.toFixed(1)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.ppmPerPiece)}</td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.placedAsp)}</td>
      <td class="num font-bold ${m.cm3PerMerchant >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompactCell(m.cm3PerMerchant)}</td>
      <td class="num font-bold">${fmtPctCell(m.cm3Pct)}</td>
      <td class="num font-bold text-blue">${fmtMoneyCompactCell(m.skuPpm)}</td>
      <td class="num font-bold text-purple">${fmtPctCell(m.skuPpmPct)}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.lockAllocatedQty))}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.lockUsedQty))}</td>
      <td class="num font-bold ${m.lockRemainingPieces > 0 ? 'text-green' : 'text-red'}">${fmtIntCell(Math.round(m.lockRemainingPieces))}</td>
      <td class="num text-light font-bold">${fmtIntCell(Math.round(m.day0))}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.day1))}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.day2))}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.day3))}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.day4))}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(m.day5))}</td>
      <td>${feedbackCellHtml}</td>
      ${extraDateCellsHtml}
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(state.recTrackerFiltered.length / PAGE_SIZE));
  if ($("rowCountRecommendedTracker")) $("rowCountRecommendedTracker").textContent = `${fmtInt.format(state.recTrackerFiltered.length)} Rows`;
  if ($("pageIndicatorRecommendedTracker")) $("pageIndicatorRecommendedTracker").textContent = `Page ${state.recTrackerPage + 1} of ${totalPages}`;
  if ($("prevPageRecommendedTracker")) $("prevPageRecommendedTracker").disabled = state.recTrackerPage === 0;
  if ($("nextPageRecommendedTracker")) $("nextPageRecommendedTracker").disabled = state.recTrackerPage >= totalPages - 1;
}

if ($("searchRecommendedTrackerInput")) $("searchRecommendedTrackerInput").addEventListener("input", applyRecommendedTrackerSearchAndSort);
if ($("prevPageRecommendedTracker")) $("prevPageRecommendedTracker").addEventListener("click", () => { if (state.recTrackerPage > 0) { state.recTrackerPage -= 1; renderPaginatedRecommendedTrackerTable(); } });
if ($("nextPageRecommendedTracker")) $("nextPageRecommendedTracker").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(state.recTrackerFiltered.length / PAGE_SIZE)); if (state.recTrackerPage < totalPages - 1) { state.recTrackerPage += 1; renderPaginatedRecommendedTrackerTable(); } });
if ($("rtAcmFilterSelect")) $("rtAcmFilterSelect").addEventListener("change", (e) => { state.rtAcmFilter = e.target.value; applyRecommendedTrackerSearchAndSort(); });
if ($("rtFeedbackDateSelect")) $("rtFeedbackDateSelect").addEventListener("change", (e) => { state.rtFeedbackDateFilter = e.target.value; renderPaginatedRecommendedTrackerTable(); });

// Event delegation لزراير "Send" بتاعة الفيدباك — الصفوف بتتعمل ديناميكيًا
// (innerHTML) في renderPaginatedRecommendedTrackerTable، فمينفعش نربط
// listener مباشر على كل زرار وقت الإنشاء؛ بنسمع على الـ tbody نفسه بدل كده.
const recTrackerTbodyEl = $("recommendedTrackerTableBody");
if (recTrackerTbodyEl) {
  recTrackerTbodyEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".rt-feedback-send");
    if (!btn) return;
    const tr = btn.closest("tr");
    if (!tr) return;
    const input = tr.querySelector(".rt-feedback-input");
    if (!input) return;
    submitMatchFeedback(tr.dataset.merchantId, tr.dataset.productId, input.value, tr);
  });
  // Enter جوه input الفيدباك = نفس تأثير دوس على Send.
  recTrackerTbodyEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest(".rt-feedback-input");
    if (!input) return;
    const tr = input.closest("tr");
    if (!tr) return;
    submitMatchFeedback(tr.dataset.merchantId, tr.dataset.productId, input.value, tr);
  });
}

// =========================================================================
// PPM ANALYST / PRODUCTS (تحت Commercial، بعد CM3 Analyst / Products) —
// مصدرها MAIN_GID بس (2099497960)، الشهر الحالي بس، SKUs بس (مش ماتشات
// Merchant×SKU). مرتبة افتراضيًا على Delivered GMV الأعلى.
//
//  • STOCK/DOH: نفس الـ "SKU TOTAL DEMAND OVERALL" (Debundled) المستخدمة في
//    Recommended Tracker بالظبط (buildDebundledStockDohIndex فوق) — ومبنية
//    على آخر 3 أيام Confirmed الفعليين (كل الشهور)، مش بس صفوف الشهر الحالي.
//  • Delivered GMV / TOTAL DELIVERED PPM = مجموع عمودي DELIVERED_GMV وPPM
//    (AB) لنفس الـ SKU، من غير أي كات أوف خالص — إجمالي صفوف الشهر ده زي ما
//    هي (اتشال منها كات أوف الـ 4 أيام اللي كان موجود الأول بطلب صريح).
//  • CONTR GMV% = Delivered GMV بتاع الـ SKU ده ÷ إجمالي Delivered GMV لكل
//    الـ SKUs في الشهر ده (نفس الأرقام اللي من غير كات أوف فوق).
//  • CR% = Confirmed ÷ Placed، بس للصفوف اللي عدى عليها يومين (lag يومين).
//  • DR% = Delivered ÷ Confirmed، بس للصفوف اللي عدى عليها 5 أيام (lag 5 أيام).
//  • NDR% = CR% × DR%.
//  • PPM/Piece = متوسط PPM_PER_PIECE موزون بالـ Delivered Pieces، لسه بياخد
//    كات أوف 4 أيام (lag 4 أيام) — زي Recommended Tracker بالظبط؛ العمود ده
//    الوحيد اللي محتفظ بالكات أوف، مش من ضمن الأعمدة اللي اتشال منها.
//  • PPM% = TOTAL DELIVERED PPM ÷ Delivered GMV لنفس الـ SKU (نفس الأرقام
//    اللي من غير كات أوف فوق)، بنفس منطق PPM/GMV% المستخدم في باقي الداشبورد.
//  • TOTAL DELIVERED PCS = مجموع Delivered Pieces لنفس الـ SKU، من غير أي
//    كات أوف خالص برضو (زي ما اتطلب بالظبط من الأول).
//  • CONTR PPM% = TOTAL DELIVERED PPM بتاع الـ SKU ده ÷ إجمالي TOTAL DELIVERED
//    PPM لكل الـ SKUs في الشهر ده (نفس الأرقام اللي من غير كات أوف فوق).
//
// كروت الملخص فوق الجدول (Total Delivered GMV / Total Delivered PPM / PPM%
// Overall) بتستخدم نفس إجمالي الـ Delivered GMV/PPM من غير كات أوف بتاع
// الجدول بالظبط — مفيش نسختين مختلفتين. PPM% Overall = Total Delivered PPM
// ÷ Total Delivered GMV.
// =========================================================================
const ppmAnalystState = { data: [], filtered: [], sortKey: "deliveredGmv", sortDir: "desc", page: 0 };

function preparePpmAnalystProductsData() {
  const mainRowsAll = state.allParsedRows || [];

  // "الشهر ده" = الشهر الحقيقي الحالي (تاريخ الجهاز)، بنفس فورمات monthYear
  // المستخدم أصلاً في parseMainSheet، عشان نلاقي بالظبط صفوف نفس الشهر ده.
  const now = new Date();
  const currentMonthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const monthRows = mainRowsAll.filter(r => r.monthYear === currentMonthYear);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const crCutoffMs = todayMs - (2 * 86400000);
  const drCutoffMs = todayMs - (5 * 86400000);

  // DOH بيتحسب من كل تاريخ MAIN_GID (آخر 3 أيام فعليين)، مش بس صفوف الشهر
  // الحالي — بنفس منطق Recommended Tracker بالظبط.
  const { getStockDoh } = buildDebundledStockDohIndex(mainRowsAll);

  const bySku = new Map();
  const getBucket = (sku) => {
    let b = bySku.get(sku);
    if (!b) {
      b = { crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, ppm: 0, ppmPerPieceWeighted: 0, ppmPerPieceWeight: 0, deliveredGmv: 0, deliveredPieces: 0 };
      bySku.set(sku, b);
    }
    return b;
  };

  monthRows.forEach(r => {
    if (!r.sku) return;
    const rDate = new Date(r.timestamp); rDate.setHours(0, 0, 0, 0);
    const rTime = rDate.getTime();
    const b = getBucket(r.sku);
    // TOTAL DELIVERED PCS — من غير أي كات أوف (زي ما اتطلب بالظبط).
    b.deliveredPieces += (r.deliveredPieces || 0);
    // Delivered GMV / TOTAL DELIVERED PPM (وبالتبعية CONTR GMV%/PPM%/CONTR
    // PPM% اللي متبنية عليهم) — من غير أي كات أوف خالص برضو، بطلب صريح إن
    // الـ 4 أيام لاج يتشال من الأعمدة دي في الجدول نفسه (مش بس الكروت فوق).
    b.ppm += (r.ppm || 0);
    b.deliveredGmv += (r.deliveredGmv || 0);
    if (rTime <= crCutoffMs) { b.crPlaced += (r.placedPieces || 0); b.crConfirmed += (r.confirmedPieces || 0); }
    if (rTime <= drCutoffMs) { b.drConfirmed += (r.confirmedPieces || 0); b.drDelivered += (r.deliveredPieces || 0); }
    // PPM/Piece — من غير أي كات أوف خالص كمان دلوقتي (بطلب صريح إن كل حاجة
    // تخص PPM متبقاش عليها كات أوف، مش بس Total PPM).
    b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0);
    b.ppmPerPieceWeight += (r.deliveredPieces || 0);
  });

  // كل الأرقام اللي بتتجمع من bySku بقت أصلاً من غير كات أوف (زي فوق)، فكروت
  // الملخص وأعمدة الجدول (Delivered GMV/CONTR%/PPM%/TOTAL DELIVERED PPM)
  // بيستخدموا نفس الإجمالي ده بالظبط — مفيش نسختين مختلفتين تاني.
  let grandDeliveredGmv = 0, grandPpm = 0;
  bySku.forEach(b => { grandDeliveredGmv += b.deliveredGmv; grandPpm += b.ppm; });
  const overallPpmPct = grandDeliveredGmv > 0 ? (grandPpm / grandDeliveredGmv) * 100 : 0;

  const rows = [];
  bySku.forEach((b, sku) => {
    const inv = state.inventoryMap[sku] || {};
    const prod = state.productsMap[sku] || {};
    const { stock, doh } = getStockDoh(sku);
    const crPct = b.crPlaced > 0 ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed > 0 ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const ppmPerPiece = b.ppmPerPieceWeight > 0 ? (b.ppmPerPieceWeighted / b.ppmPerPieceWeight) : 0;
    const ppmPct = b.deliveredGmv > 0 ? (b.ppm / b.deliveredGmv) * 100 : 0;
    const contrGmvPct = grandDeliveredGmv > 0 ? (b.deliveredGmv / grandDeliveredGmv) * 100 : 0;
    const contrPpmPct = grandPpm > 0 ? (b.ppm / grandPpm) * 100 : 0;

    // Selling Price / Profit — من شيت Products (PRODUCTS_GID/1779314157)،
    // عمودي PRICE وPROFIT زي ما هما بالظبط.
    const sellingPrice = prod.price || 0;
    const profit = prod.profit || 0;
    // ASP = DELIVERED_GMV ÷ DELIVERED_PIECES من غير أي كات أوف — بنفس
    // أرقام Delivered GMV/TOTAL DELIVERED PCS اللي أصلاً من غير كات أوف فوق.
    const asp = b.deliveredPieces > 0 ? (b.deliveredGmv / b.deliveredPieces) : 0;

    rows.push({
      skuId: sku, skuName: inv.skuName || prod.name || sku, category: inv.category || prod.category || "Uncategorized",
      stock: Math.round(stock || 0), doh: Math.round(doh),
      sellingPrice, profit, asp,
      deliveredGmv: b.deliveredGmv, contrGmvPct,
      crPct, drPct, ndrPct, ppmPerPiece, ppmPct,
      totalDeliveredPpm: b.ppm, totalDeliveredPcs: Math.round(b.deliveredPieces || 0),
      contrPpmPct
    });
  });

  ppmAnalystState.data = rows;
  applyPpmAnalystSearchAndSort();
  renderPpmAnalystSummary(rows, grandDeliveredGmv, grandPpm, currentMonthYear, overallPpmPct);
}

function renderPpmAnalystSummary(rows, grandDeliveredGmv, grandPpm, monthLabel, overallPpmPct) {
  if ($("ppmApTotalSkus")) $("ppmApTotalSkus").textContent = fmtInt.format(rows.length);
  if ($("ppmApOverallPpmPct")) $("ppmApOverallPpmPct").textContent = fmtPct(overallPpmPct || 0);
  if ($("ppmApTotalGmv")) $("ppmApTotalGmv").textContent = fmtMoneyCompact(grandDeliveredGmv);
  if ($("ppmApTotalPpm")) $("ppmApTotalPpm").textContent = fmtMoneyCompact(grandPpm);
  if ($("ppmApMonthLabel")) $("ppmApMonthLabel").textContent = monthLabel || "-";
}

function sortPpmAnalyst(key) {
  if (ppmAnalystState.sortKey === key) { ppmAnalystState.sortDir = ppmAnalystState.sortDir === "asc" ? "desc" : "asc"; }
  else { ppmAnalystState.sortKey = key; ppmAnalystState.sortDir = "desc"; }
  applyPpmAnalystSearchAndSort();
}

function applyPpmAnalystSearchAndSort() {
  const term = $("searchPpmAnalystInput") ? $("searchPpmAnalystInput").value.trim().toLowerCase() : "";
  // فلتر PPM% (more than / less than) — لو مفيش عملية متحددة أو الرقم فاضي،
  // الفلتر بيتجاهل تمامًا (كل الصفوف بتعدي).
  const filterOp = $("ppmAnalystFilterOp") ? $("ppmAnalystFilterOp").value : "";
  const filterValueRaw = $("ppmAnalystFilterValue") ? $("ppmAnalystFilterValue").value : "";
  const filterValue = filterValueRaw === "" ? null : parseFloat(filterValueRaw);
  const hasFilter = filterOp && filterValue !== null && !Number.isNaN(filterValue);

  ppmAnalystState.filtered = (ppmAnalystState.data || []).filter(m => {
    if (term && !((m.skuName && m.skuName.toLowerCase().includes(term)) || (m.skuId && String(m.skuId).toLowerCase().includes(term)) ||
      (m.category && m.category.toLowerCase().includes(term)))) return false;
    if (hasFilter) {
      if (filterOp === "gte" && !(m.ppmPct > filterValue)) return false;
      if (filterOp === "lte" && !(m.ppmPct < filterValue)) return false;
    }
    return true;
  });
  const { sortKey, sortDir } = ppmAnalystState; const dir = sortDir === "asc" ? 1 : -1;
  ppmAnalystState.filtered.sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return ((av || 0) - (bv || 0)) * dir;
  });
  ppmAnalystState.page = 0;
  renderPaginatedPpmAnalystTable();
}

function renderPaginatedPpmAnalystTable() {
  const tbody = $("ppmAnalystTableBody"); if (!tbody) return; tbody.innerHTML = "";
  const start = ppmAnalystState.page * PAGE_SIZE;
  const pageRows = ppmAnalystState.filtered.slice(start, start + PAGE_SIZE);
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim">${m.skuId}</td>
      <td class="truncate-cell" title="${m.skuName}">${m.skuName}</td>
      <td class="text-dim truncate-cell" title="${m.category}">${m.category}</td>
      <td class="num"><span class="badge-outline ${m.stock > 10 ? 'green' : 'red'}">${fmtIntCell(m.stock)}</span></td>
      <td class="num font-bold text-purple">${fmtIntCell(m.doh)}</td>
      <td class="num text-blue">${fmtMoneyCompactCell(m.sellingPrice)}</td>
      <td class="num text-green">${fmtMoneyCompactCell(m.profit)}</td>
      <td class="num font-bold">${fmtMoneyCompactCell(m.asp)}</td>
      <td class="num font-bold text-light">${fmtMoneyCompactCell(m.deliveredGmv)}</td>
      <td class="num font-bold">${fmtPctCell(m.contrGmvPct)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.ppmPerPiece)}</td>
      <td class="num">${fmtPctCell(m.ppmPct)}</td>
      <td class="num font-bold text-blue">${fmtMoneyCompactCell(m.totalDeliveredPpm)}</td>
      <td class="num text-dim">${fmtIntCell(m.totalDeliveredPcs)}</td>
      <td class="num font-bold">${fmtPctCell(m.contrPpmPct)}</td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(ppmAnalystState.filtered.length / PAGE_SIZE));
  if ($("rowCountPpmAnalyst")) $("rowCountPpmAnalyst").textContent = `${fmtInt.format(ppmAnalystState.filtered.length)} SKUs`;
  if ($("pageIndicatorPpmAnalyst")) $("pageIndicatorPpmAnalyst").textContent = `Page ${ppmAnalystState.page + 1} of ${totalPages}`;
  if ($("prevPagePpmAnalyst")) $("prevPagePpmAnalyst").disabled = ppmAnalystState.page === 0;
  if ($("nextPagePpmAnalyst")) $("nextPagePpmAnalyst").disabled = ppmAnalystState.page >= totalPages - 1;
}

if ($("searchPpmAnalystInput")) $("searchPpmAnalystInput").addEventListener("input", applyPpmAnalystSearchAndSort);
if ($("ppmAnalystFilterOp")) $("ppmAnalystFilterOp").addEventListener("change", applyPpmAnalystSearchAndSort);
if ($("ppmAnalystFilterValue")) $("ppmAnalystFilterValue").addEventListener("input", applyPpmAnalystSearchAndSort);
if ($("prevPagePpmAnalyst")) $("prevPagePpmAnalyst").addEventListener("click", () => { if (ppmAnalystState.page > 0) { ppmAnalystState.page -= 1; renderPaginatedPpmAnalystTable(); } });
if ($("nextPagePpmAnalyst")) $("nextPagePpmAnalyst").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(ppmAnalystState.filtered.length / PAGE_SIZE)); if (ppmAnalystState.page < totalPages - 1) { ppmAnalystState.page += 1; renderPaginatedPpmAnalystTable(); } });

// -------------------------------------------------------------------------
// PRODUCTS / ANALYST (منفصلة تمامًا، مش جوه PPM Analyst / Products — بس
// متحطوطة تحتيها في القائمة الجانبية) — كل الـ Products اللي اتعملهم Inbound
// (استلام) في أي شهر من السنة الحالية (نفس شيت الـ Inbound (GID 565878313)
// اللي بتستخدمه لوحة الـ Sellthrough Rate Panel)، مع:
//  • مهم جدًا: الجدول ده شغال على مستوى SINGLE SKU (SINGLE_ID من شيت
//    الديبندلايز PRODUCTS_DEBUNDLE_MAP_GID)، مش على مستوى صف الـ Main
//    مباشرة. أي رقم فلوس (PPM/GMV/CM3) لازم يبقى "OVERALL" — يعني نجمعه
//    من كل البندلز (PRODUCT_ID) اللي الـ Single ده عضو فيها، مش بس البندل
//    اللي عمل PRODUCT_ID == SINGLE_ID. التوزيع ده بيستخدم نفس منطق
//    Commercial Plan بالظبط: كل بندل بيوزع قيمته (GMV/PPM/CM3) على الـ
//    Singles اللي جواه بوزن الـ COGS (cogsWeight = Single Cogs ÷ Bundle
//    Cogs)، وبيوزع القطع (Pieces/Demand) بضرب PRODUCT_QUANTITY (زي
//    conf3dBySingleOverall في buildDebundledStockDohIndex بالظبط).
//  • DEMAND CONFIRMED (3M) = مجموع CNF_QTY من شيت "EGY Sell-through rate
//    needed data #2941" (SELLTHROUGH_NEEDED_GID / 548859670 — نفس مصدر
//    state.metabaseSellthroughNeeded اللي بتستخدمه لوحة الـ Sellthrough Rate
//    Panel)، لكل PRODUCT_ID، لآخر 3 شهور (الشهر الحالي + الشهرين اللي فاتوا
//    — يعني شهر 8+7+6 دلوقتي). الشيت ده أصلاً سنجل SKU (مفيش بندلات)، فمفيش
//    داعي لأي توزيع/ديبندلايز هنا (بعكس PPM/GMV/CM3 تحت اللي مصدرهم Main).
//  • AVG CONFIRMED DAILY = DEMAND CONFIRMED (3M) ÷ إجمالي عدد أيام الـ 3
//    شهور دول بالظبط (نفس منطق avg3dConfirmed = conf3d ÷ 3 المستخدم في
//    Commercial Debundlized، بس هنا بتاع 3 شهور مش 3 أيام).
//  • TOTAL PPM DELIVERED / TOTAL DELIVERED PCS / PPM/Piece / PPM% — الشهر
//    الحالي، من غير أي كات أوف، بنفس لوجيك PPM Analyst / Products بالظبط
//    (PPM/Piece هنا = TOTAL PPM DELIVERED ÷ TOTAL DELIVERED PCS مباشرة، زي
//    ما اتطلب بالظبط) — لكن كل رقم منهم دلوقتي OVERALL (كل البندلز).
//  • CM3 / CM3 per Piece / CM3% — الشهر الحالي، بنفس كات أوف الـ CM3
//    (CM3_LAG_DAYS / getCm3LagCutoffTimestamp / isCm3RowEligible) المستخدم
//    في أي سكشن تاني مصدره MAIN_GID (زي CM3 Analyst / Products بالظبط)،
//    وبرضو OVERALL على كل البندلز بوزن الـ COGS.
// -------------------------------------------------------------------------
const prodAnState = { data: [], filtered: [], sortKey: "totalDeliveredPpm", sortDir: "desc", page: 0 };

function prepareProductsAnalystData() {
  const mainRowsAll = state.allParsedRows || [];

  const now = new Date();
  const currentMonthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const currentYear = now.getFullYear();

  // آخر 3 شهور (الشهر الحالي + اتنين اللي فاتوا) — يعني شهر 8، 7، 6 دلوقتي —
  // مع إجمالي عدد أيام الـ 3 شهور دول (لحساب AVG Confirmed Daily).
  let last3TotalDays = 0;
  const last3MonthYears = [0, 1, 2].map(back => {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    last3TotalDays += new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  });
  const last3Set = new Set(last3MonthYears);

  // كل الـ SINGLE SKUs اللي اتعملهم Inbound في أي شهر من السنة الحالية، +
  // Last Inbound Date بتاع كل SKU (آخر تاريخ استلام فعلي ليه — من كل
  // صفوف الـ Inbound مش بس السنة الحالية، عشان لو نفس الـ SKU اتستلم قبل
  // كده وبعدين تاني السنة دي، يفضل ياخد أحدث تاريخ استلام حقيقي عنده).
  const inboundThisYearSkus = new Set();
  const lastInboundTsBySku = new Map();
  (state.inboundRows || []).forEach(r => {
    if (!r.sku || !r.receivingMonthKey) return;
    const d = new Date(r.receivingMonthKey);
    if (!isNaN(d.getTime()) && d.getFullYear() === currentYear) inboundThisYearSkus.add(r.sku);
    if (r.rcvTs && r.rcvTs > (lastInboundTsBySku.get(r.sku) || 0)) lastInboundTsBySku.set(r.sku, r.rcvTs);
  });

  // خريطة PRODUCT_ID (سنجل أو بندل) -> [{singleId, quantity, cogsWeight}] —
  // نفس الماب المستخدم في Commercial Plan/Healthy Locking بالظبط.
  const { productMap: bundleProductMap, singlesList } = buildDebundleProductMap(state.debundleMap, state.cogsMap);

  // بيرجع mappings الصف ده: لو الـ PRODUCT_ID (r.sku) موجود في شيت الديبندلايز
  // بيرجع mappings بتاعته زي ما هي (بوزن COGS/الكمية الحقيقية)؛ غير كده
  // (SKU مش موجود في الديبندلايز خالص) بيترجع Fallback: الـ SKU ده نفسه
  // "Single" لوحده بوزن/كمية = 1 (زي fallback الأصلي في conf3dBySingleOverall).
  const mappingsFor = (sku) => {
    const m = bundleProductMap.get(sku);
    return (m && m.length) ? m : [{ singleId: sku, quantity: 1, cogsWeight: 1 }];
  };

  // Demand Confirmed (آخر 3 شهور) — من شيت "EGY Sell-through rate needed
  // data #2941" (SELLTHROUGH_NEEDED_GID / 548859670)، نفس المصدر اللي
  // بتستخدمه لوحة الـ Sellthrough Rate Panel بالظبط (state.metabaseSellthroughNeeded)
  // — عمود CNF_QTY، مجموع لكل الصفوف اللي MONTH بتاعها من آخر 3 شهور
  // (شهر 8 + 7 + 6)، لكل PRODUCT_ID (ده أصلاً سنجل SKU في الشيت ده، مفيش
  // بندلات هنا، فمفيش داعي لأي توزيع/ديبندلايز).
  const demandBySingle = new Map();
  (state.metabaseSellthroughNeeded || []).forEach(row => {
    const sku = row.PRODUCT_ID;
    const mk = stMonthKeyFromValue(row.MONTH);
    if (!sku || !mk || !last3Set.has(mk)) return;
    demandBySingle.set(sku, (demandBySingle.get(sku) || 0) + (row.CNF_QTY || 0));
  });

  // PPM / CM3 الشهر الحالي OVERALL — نفس منطق PPM Analyst / Products بالظبط
  // (Delivered GMV/PPM من غير كات أوف)، والـ CM3 بياخد كات أوف الـ CM3_LAG_DAYS.
  // GMV/PPM/CM3 (فلوس) بيتوزعوا بوزن الـ COGS، والـ Pieces بيتوزعوا بضرب الكمية.
  const monthRows = mainRowsAll.filter(r => r.monthYear === currentMonthYear);
  const cm3CutoffTs = getCm3LagCutoffTimestamp(monthRows);
  // CR% (Confirmed/Placed) بيرجع يومين (CR_LAG_DAYS)، DR% (Delivered/
  // Confirmed) بيرجع نفس كات أوف الـ CM3 (CM3_LAG_DAYS) — بالظبط زي باقي
  // الداشبورد كله (computeCommercialActuals/Products Matches Analyst).
  const crCutoffTs = getLagCutoffTimestamp(monthRows, CR_LAG_DAYS);

  const bySingle = new Map();
  const getBucket = (singleId) => {
    let b = bySingle.get(singleId);
    if (!b) {
      b = {
        ppm: 0, deliveredGmv: 0, deliveredPieces: 0, cm3: 0, cm3Gmv: 0, cm3DeliveredPieces: 0,
        crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0
      };
      bySingle.set(singleId, b);
    }
    return b;
  };
  monthRows.forEach(r => {
    if (!r.sku) return;
    const cm3Eligible = isCm3RowEligible(r, cm3CutoffTs);
    const crEligible = isRowEligibleForLag(r, crCutoffTs);
    const drEligible = isRowEligibleForLag(r, cm3CutoffTs);
    mappingsFor(r.sku).forEach(mp => {
      if (!inboundThisYearSkus.has(mp.singleId)) return;
      const b = getBucket(mp.singleId);
      const weight = mp.cogsWeight != null ? mp.cogsWeight : 1;
      const qty = mp.quantity || 1;
      // TOTAL DELIVERED PCS (العمود المستقل) — من غير كات أوف خالص، زي الـ PPM.
      b.deliveredPieces += (r.deliveredPieces || 0) * qty;
      b.ppm += (r.ppm || 0) * weight;
      b.deliveredGmv += (r.deliveredGmv || 0) * weight;
      // CM3 (وCM3/Piece وCM3% اللي مبنيين عليها) — بس من الصفوف اللي عدت
      // كات أوف الـ CM3، بما فيها Delivered Pieces المستخدمة كمقام لـ CM3/Piece
      // (cm3DeliveredPieces) — مش إجمالي Delivered Pieces الكامل فوق.
      if (cm3Eligible) {
        b.cm3 += (r.cm3 || 0) * weight;
        b.cm3Gmv += (r.deliveredGmv || 0) * weight;
        b.cm3DeliveredPieces += (r.deliveredPieces || 0) * qty;
      }
      // CR%/DR%/NDR% — Overall على مستوى الـ Single (مجموع كل البندلات
      // اللي بتحتويه + طلبه المباشر لو Single أصلاً)، بالكمية الفعلية
      // (qty) نفس منطق Placed/Delivered Pieces فوق.
      if (crEligible) { b.crPlaced += (r.placedPieces || 0) * qty; b.crConfirmed += (r.confirmedPieces || 0) * qty; }
      if (drEligible) { b.drConfirmed += (r.confirmedPieces || 0) * qty; b.drDelivered += (r.deliveredPieces || 0) * qty; }
    });
  });

  // كل Single inbound السنة دي لازم يظهر في الجدول حتى لو مالوش صفوف في شهر
  // الـ Main الحالي (PPM/CM3 هيبقوا صفر وقتها، مش هيتشال من الجدول).
  inboundThisYearSkus.forEach(sku => getBucket(sku));

  let grandDeliveredGmv = 0, grandPpm = 0, grandCm3 = 0, grandCm3Gmv = 0;
  bySingle.forEach(b => { grandDeliveredGmv += b.deliveredGmv; grandPpm += b.ppm; grandCm3 += b.cm3; grandCm3Gmv += b.cm3Gmv; });
  const overallPpmPct = grandDeliveredGmv > 0 ? (grandPpm / grandDeliveredGmv) * 100 : 0;
  const overallCm3Pct = grandCm3Gmv > 0 ? (grandCm3 / grandCm3Gmv) * 100 : 0;

  const rows = [];
  bySingle.forEach((b, singleId) => {
    const inv = state.inventoryMap[singleId] || {};
    const prod = state.productsMap[singleId] || {};
    const debundleName = singlesList.get(singleId);
    const ppmPerPiece = b.deliveredPieces > 0 ? (b.ppm / b.deliveredPieces) : 0;
    const ppmPct = b.deliveredGmv > 0 ? (b.ppm / b.deliveredGmv) * 100 : 0;
    const cm3PerPiece = b.cm3DeliveredPieces > 0 ? (b.cm3 / b.cm3DeliveredPieces) : 0;
    const cm3Pct = b.cm3Gmv > 0 ? (b.cm3 / b.cm3Gmv) * 100 : 0;
    const demandConfirmed3m = demandBySingle.get(singleId) || 0;
    const avgConfirmedDaily = last3TotalDays > 0 ? (demandConfirmed3m / last3TotalDays) : 0;
    const lastInboundTs = lastInboundTsBySku.get(singleId) || 0;
    const crPct = b.crPlaced > 0 ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed > 0 ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;

    rows.push({
      skuId: singleId, skuName: debundleName || inv.skuName || prod.name || singleId, category: inv.category || prod.category || "Uncategorized",
      lastInboundTs, lastInboundDate: lastInboundTs ? new Date(lastInboundTs).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : "-",
      demandConfirmed3m: Math.round(demandConfirmed3m), avgConfirmedDaily,
      totalDeliveredPpm: b.ppm, totalDeliveredPcs: Math.round(b.deliveredPieces || 0),
      crPct, drPct, ndrPct,
      ppmPerPiece, ppmPct,
      cm3: b.cm3, cm3PerPiece, cm3Pct
    });
  });

  prodAnState.data = rows;
  applyProdAnSearchAndSort();
  renderProdAnSummary(rows, grandPpm, currentMonthYear, overallPpmPct, grandCm3, overallCm3Pct);
}

function renderProdAnSummary(rows, grandPpm, monthLabel, overallPpmPct, grandCm3, overallCm3Pct) {
  if ($("prodAnTotalSkus")) $("prodAnTotalSkus").textContent = fmtInt.format(rows.length);
  if ($("prodAnMonthLabel")) $("prodAnMonthLabel").textContent = monthLabel || "-";
  if ($("prodAnTotalPpm")) $("prodAnTotalPpm").textContent = fmtMoneyCompact(grandPpm);
  if ($("prodAnOverallPpmPct")) $("prodAnOverallPpmPct").textContent = fmtPct(overallPpmPct || 0);
  if ($("prodAnTotalCm3")) $("prodAnTotalCm3").textContent = fmtMoneyCompact(grandCm3);
  if ($("prodAnOverallCm3Pct")) $("prodAnOverallCm3Pct").textContent = fmtPct(overallCm3Pct || 0);
}

function sortProdAn(key) {
  if (prodAnState.sortKey === key) { prodAnState.sortDir = prodAnState.sortDir === "asc" ? "desc" : "asc"; }
  else { prodAnState.sortKey = key; prodAnState.sortDir = "desc"; }
  applyProdAnSearchAndSort();
}

function applyProdAnSearchAndSort() {
  const term = $("searchProdAnInput") ? $("searchProdAnInput").value.trim().toLowerCase() : "";
  prodAnState.filtered = (prodAnState.data || []).filter(m => {
    if (term && !((m.skuName && m.skuName.toLowerCase().includes(term)) || (m.skuId && String(m.skuId).toLowerCase().includes(term)) ||
      (m.category && m.category.toLowerCase().includes(term)))) return false;
    return true;
  });

  const { sortKey, sortDir } = prodAnState; const dir = sortDir === "asc" ? 1 : -1;
  prodAnState.filtered.sort((a, b) => {
    let av = a[sortKey]; let bv = b[sortKey];
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });

  prodAnState.page = 0;
  renderPaginatedProdAnTable();
}

function renderPaginatedProdAnTable() {
  const tbody = $("prodAnTableBody"); if (!tbody) return; tbody.innerHTML = "";
  const start = prodAnState.page * PAGE_SIZE;
  const pageRows = prodAnState.filtered.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="16" class="text-dim center">No products match this filter.</td></tr>`;
  } else {
    pageRows.forEach(m => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="font-mono text-light font-bold">${m.skuId}</td>
        <td class="truncate-cell text-dim" title="${m.skuName || ""}">${m.skuName || '<span class="text-dim">-</span>'}</td>
        <td class="truncate-cell text-dim">${m.category}</td>
        <td class="text-dim">${m.lastInboundDate || "-"}</td>
        <td class="num">${fmtIntCell(m.demandConfirmed3m)}</td>
        <td class="num text-dim">${fmtIntCell(Math.round(m.avgConfirmedDaily))}</td>
        <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
        <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
        <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
        <td class="num text-blue">${fmtMoneyCompactCell(m.totalDeliveredPpm)}</td>
        <td class="num">${fmtIntCell(m.totalDeliveredPcs)}</td>
        <td class="num">${fmtMoneyCompactCell(m.ppmPerPiece)}</td>
        <td class="num font-bold text-purple">${fmtPctCell(m.ppmPct)}</td>
        <td class="num text-orange">${fmtMoneyCompactCell(m.cm3)}</td>
        <td class="num">${fmtMoneyCompactCell(m.cm3PerPiece)}</td>
        <td class="num font-bold text-green">${fmtPctCell(m.cm3Pct)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const totalPages = Math.max(1, Math.ceil(prodAnState.filtered.length / PAGE_SIZE));
  if ($("rowCountProdAn")) $("rowCountProdAn").textContent = `${fmtInt.format(prodAnState.filtered.length)} SKUs`;
  if ($("pageIndicatorProdAn")) $("pageIndicatorProdAn").textContent = `Page ${prodAnState.page + 1} of ${totalPages}`;
  if ($("prevPageProdAn")) $("prevPageProdAn").disabled = prodAnState.page === 0;
  if ($("nextPageProdAn")) $("nextPageProdAn").disabled = prodAnState.page >= totalPages - 1;
}

if ($("searchProdAnInput")) $("searchProdAnInput").addEventListener("input", applyProdAnSearchAndSort);
if ($("prevPageProdAn")) $("prevPageProdAn").addEventListener("click", () => { if (prodAnState.page > 0) { prodAnState.page -= 1; renderPaginatedProdAnTable(); } });
if ($("nextPageProdAn")) $("nextPageProdAn").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(prodAnState.filtered.length / PAGE_SIZE)); if (prodAnState.page < totalPages - 1) { prodAnState.page += 1; renderPaginatedProdAnTable(); } });

// =========================================================================
// PRODUCTS MATCHES / ANALYST — جوه Products / Analyst بالظبط: بدل ما نجمع
// كل الميرشنتس مع بعض على مستوى الـ Single SKU (زي Products / Analyst)،
// هنا كل صف هو (Merchant × Single SKU) لوحده — يعني كل ميرشنت شغال على
// المنتج ده (حتى لو شغال على بندل فيه المنتج ده) بيظهر بصفه لوحده، بنفس
// منطق التوزيع (debundle apportionment) المستخدم في كل مكان تاني بالظبط:
//   • فلوس (PPM/GMV/CM3) بتتوزع بوزن الـ COGS (cogsWeight).
//   • قطع فعلية (Placed/Confirmed/Delivered Pieces) بتتوزع بضرب الكمية
//     (PRODUCT_QUANTITY).
// النطاق (Scope) هنا نفس نطاق Products / Analyst بالظبط: بس الـ Single
// SKUs اللي اتعملهم Inbound السنة دي (inboundThisYearSkus)، عشان الجدولين
// يفضلوا متسقين مع بعض (نفس الـ "مصدر" اللي طلبه اليوزر).
//
// CR%/DR%/NDR%/CM3 بتاخد نفس منطق الكات أوف المستخدم في Targets Commercial/
// Commercial Debundlized (computeCommercialActuals/tcFinalizeBucket):
//   • CR% (Confirmed/Placed): كات أوف يومين (CR_LAG_DAYS).
//   • DR% (Delivered/Confirmed) وCM3 وCM3/Piece وCM3%: كات أوف الـ 4 أيام
//     بتاع CM3 (CM3_LAG_DAYS) — ونفس القاعدة العامة اللي اتفقنا عليها قبل
//     كده: أي عمود لوحده (زي Delivered Pcs) بيفضل من غير كات أوف، لكن لما
//     يتستخدم كمقام جوه حاجة زي CM3/Piece أو CM3% بياخد نفس كات أوف الـ CM3
//     بالظبط (عشان كده cm3DeliveredPieces منفصلة عن deliveredPieces الأساسية).
//   • PPM/Piece وPPM% من غير أي كات أوف خالص (بطلب صريح، زي كل مكان تاني).
//
// STATUS — بيجاوب سؤالين: هل الماتش ده (نفس التاجر × نفس الـ Single) كان
// شغال الشهر اللي فات ولا لأ (أي نشاط خالص في كل الشهر اللي فات، من غير أي
// قيد على الرينج)، ولو كان شغال، بنقارن "Avg Daily Confirmed" بتاعه في نفس
// الـ Date Range (يوم 1 لحد نفس رقم اليوم النهاردة) في الشهرين — عشان
// المقارنة تبقى Apples-to-apples (نفس عدد الأيام بالظبط) مش الشهر كله ضد
// جزء من الشهر الحالي. لو مفيش أي نشاط خالص الشهر اللي فات → Status = "New".
// =========================================================================
const pmaState = { data: [], filtered: [], sortKey: "confirmedPieces", sortDir: "desc", page: 0 };

function prepareProductsMatchesAnalystData() {
  const mainRowsAll = state.allParsedRows || [];
  const now = new Date();
  const currentMonthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const currentYear = now.getFullYear();
  const currentDay = now.getDate();

  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthYear = prevMonthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const daysInPrevMonth = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).getDate();
  const clampedPrevDay = Math.min(currentDay, daysInPrevMonth);

  // نفس تعريف "Inbound السنة دي" ونفس ماب الديبندلايز المستخدمين في
  // Products / Analyst بالظبط — عشان النطاق (أي Single SKUs) يفضل متطابق.
  const inboundThisYearSkus = new Set();
  (state.inboundRows || []).forEach(r => {
    if (!r.sku || !r.receivingMonthKey) return;
    const d = new Date(r.receivingMonthKey);
    if (!isNaN(d.getTime()) && d.getFullYear() === currentYear) inboundThisYearSkus.add(r.sku);
  });

  const { productMap: bundleProductMap, singlesList } = buildDebundleProductMap(state.debundleMap, state.cogsMap);
  const mappingsFor = (sku) => {
    const m = bundleProductMap.get(sku);
    return (m && m.length) ? m : [{ singleId: sku, quantity: 1, cogsWeight: 1 }];
  };

  const monthRows = mainRowsAll.filter(r => r.monthYear === currentMonthYear);
  const cm3CutoffTs = getCm3LagCutoffTimestamp(monthRows); // 4 أيام (DR%/CM3/CM3-Piece/CM3%)
  const crCutoffTs = getLagCutoffTimestamp(monthRows, CR_LAG_DAYS); // يومين (CR% بس)

  const byMatch = new Map(); // "merchantId||singleId" -> bucket
  const getBucket = (key) => {
    let b = byMatch.get(key);
    if (!b) {
      b = {
        placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, ppm: 0,
        crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0,
        cm3: 0, cm3Gmv: 0, cm3DeliveredPieces: 0, dateSet: new Set(),
        merchantId: "", merchantName: "", skuId: ""
      };
      byMatch.set(key, b);
    }
    return b;
  };

  monthRows.forEach(r => {
    if (!r.sku || !r.merchantId) return;
    const crEligible = isRowEligibleForLag(r, crCutoffTs);
    const drEligible = isRowEligibleForLag(r, cm3CutoffTs);
    const cm3Eligible = isCm3RowEligible(r, cm3CutoffTs);
    mappingsFor(r.sku).forEach(mp => {
      if (!inboundThisYearSkus.has(mp.singleId)) return;
      const key = r.merchantId + "||" + mp.singleId;
      const b = getBucket(key);
      b.merchantId = r.merchantId; b.merchantName = r.merchantName || r.merchantId; b.skuId = mp.singleId;
      const weight = mp.cogsWeight != null ? mp.cogsWeight : 1;
      const qty = mp.quantity || 1;
      b.placed += (r.placedPieces || 0) * qty;
      b.confirmed += (r.confirmedPieces || 0) * qty;
      // TOTAL DELIVERED PCS (عمود لوحده) — من غير كات أوف خالص، زي PPM.
      b.delivered += (r.deliveredPieces || 0) * qty;
      b.deliveredGmv += (r.deliveredGmv || 0) * weight;
      b.ppm += (r.ppm || 0) * weight;
      if (r.date) b.dateSet.add(r.date);
      if (crEligible) { b.crPlaced += (r.placedPieces || 0) * qty; b.crConfirmed += (r.confirmedPieces || 0) * qty; }
      if (drEligible) { b.drConfirmed += (r.confirmedPieces || 0) * qty; b.drDelivered += (r.deliveredPieces || 0) * qty; }
      if (cm3Eligible) {
        b.cm3 += (r.cm3 || 0) * weight; b.cm3Gmv += (r.deliveredGmv || 0) * weight;
        b.cm3DeliveredPieces += (r.deliveredPieces || 0) * qty;
      }
    });
  });

  // --- الشهر اللي فات: هل الماتش اشتغل خالص (أي نشاط طول الشهر)، وConfirmed
  // Pcs بتاعه في نفس الـ Date Range (يوم 1 لحد currentDay) عشان نقارنها. ---
  const prevMonthAnyActivity = new Set();
  const prevMonthSameRangeConfirmed = new Map();
  const prevMonthRows = mainRowsAll.filter(r => r.monthYear === prevMonthYear);
  prevMonthRows.forEach(r => {
    if (!r.sku || !r.merchantId || !r.timestamp) return;
    mappingsFor(r.sku).forEach(mp => {
      if (!inboundThisYearSkus.has(mp.singleId)) return;
      const key = r.merchantId + "||" + mp.singleId;
      prevMonthAnyActivity.add(key);
      const rDay = new Date(r.timestamp).getDate();
      if (rDay <= clampedPrevDay) {
        const qty = mp.quantity || 1;
        prevMonthSameRangeConfirmed.set(key, (prevMonthSameRangeConfirmed.get(key) || 0) + (r.confirmedPieces || 0) * qty);
      }
    });
  });

  let grandPpm = 0, grandDeliveredGmv = 0, grandCm3 = 0, grandCm3Gmv = 0, newCount = 0;
  const rows = [];
  byMatch.forEach((b, key) => {
    const inv = state.inventoryMap[b.skuId] || {};
    const prod = state.productsMap[b.skuId] || {};
    const debundleName = singlesList.get(b.skuId);
    const acmName = ((state.merchantInfoMap || new Map()).get(b.merchantId) || {}).acmName || "Unassigned";

    // Avg Daily Confirmed (This Month) — بتقسم على currentDay (يوم 1 لحد
    // النهاردة، تقويميًا) مش على عدد الأيام اللي فيها داتا فعليًا بس
    // (activeDays)، عشان تفضل بالظبط على نفس أساس عدد الأيام المستخدم في
    // Prev Avg Daily Confirmed (clampedPrevDay) — المقارنة تبقى Apples-to-
    // apples 100%: نفس عدد الأيام بالظبط في الشهرين (إلا لو الشهر اللي فات
    // عدد أيامه أقل من currentDay، زي لو النهاردة يوم 31 والشهر اللي فات 28
    // يوم بس — وقتها clampedPrevDay بيتقص لأقصى يوم متاح فعلاً في الشهر اللي
    // فات، وهي أدق مقارنة ممكنة في الحالة دي).
    const avgDailyConfirmed = currentDay > 0 ? (b.confirmed / currentDay) : 0;
    const crPct = b.crPlaced > 0 ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed > 0 ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const ppmPerPiece = b.delivered > 0 ? (b.ppm / b.delivered) : 0;
    const ppmPct = b.deliveredGmv > 0 ? (b.ppm / b.deliveredGmv) * 100 : 0;
    const cm3PerPiece = b.cm3DeliveredPieces > 0 ? (b.cm3 / b.cm3DeliveredPieces) : 0;
    const cm3Pct = b.cm3Gmv > 0 ? (b.cm3 / b.cm3Gmv) * 100 : 0;

    const workedLastMonth = prevMonthAnyActivity.has(key);
    const status = workedLastMonth ? "Active" : "New";
    const prevAvgDailyConfirmed = workedLastMonth && clampedPrevDay > 0 ? ((prevMonthSameRangeConfirmed.get(key) || 0) / clampedPrevDay) : null;
    if (!workedLastMonth) newCount++;

    // MoM Trend — بيقارن avgDailyConfirmed (الشهر ده) بـ prevAvgDailyConfirmed
    // (نفس الرينج من الشهر اللي فات) — طالما الاتنين على نفس أساس عدد
    // الأيام بالظبط (فوق)، الفرق ده بيعبر فعلاً عن "بيطلع ولا بيقع" حقيقي،
    // مش بس اختلاف في عدد الأيام. null لو الماتش New (مفيش حاجة تتقارن بيها).
    let trendPct = null;
    if (prevAvgDailyConfirmed !== null) {
      trendPct = prevAvgDailyConfirmed > 0
        ? ((avgDailyConfirmed - prevAvgDailyConfirmed) / prevAvgDailyConfirmed) * 100
        : (avgDailyConfirmed > 0 ? 100 : 0);
    }

    grandPpm += b.ppm; grandDeliveredGmv += b.deliveredGmv; grandCm3 += b.cm3; grandCm3Gmv += b.cm3Gmv;

    rows.push({
      skuId: b.skuId, skuName: debundleName || inv.skuName || prod.name || b.skuId, category: inv.category || prod.category || "Uncategorized",
      merchantId: b.merchantId, merchantName: b.merchantName, acm: acmName,
      status, placedPieces: Math.round(b.placed), confirmedPieces: Math.round(b.confirmed), deliveredPieces: Math.round(b.delivered),
      avgDailyConfirmed, prevAvgDailyConfirmed, trendPct,
      crPct, drPct, ndrPct, ppmPerPiece, ppmPct, cm3: b.cm3, cm3PerPiece, cm3Pct
    });
  });

  const overallPpmPct = grandDeliveredGmv > 0 ? (grandPpm / grandDeliveredGmv) * 100 : 0;
  const overallCm3Pct = grandCm3Gmv > 0 ? (grandCm3 / grandCm3Gmv) * 100 : 0;

  pmaState.data = rows;
  applyPmaSearchAndSort();
  renderPmaSummary(rows, grandPpm, currentMonthYear, overallPpmPct, grandCm3, overallCm3Pct, newCount);
}

function renderPmaSummary(rows, grandPpm, monthLabel, overallPpmPct, grandCm3, overallCm3Pct, newCount) {
  if ($("pmaTotalRows")) $("pmaTotalRows").textContent = fmtInt.format(rows.length);
  if ($("pmaMonthLabel")) $("pmaMonthLabel").textContent = monthLabel || "-";
  if ($("pmaNewCount")) $("pmaNewCount").textContent = fmtInt.format(newCount || 0);
  if ($("pmaTotalPpm")) $("pmaTotalPpm").textContent = fmtMoneyCompact(grandPpm);
  if ($("pmaTotalCm3")) $("pmaTotalCm3").textContent = fmtMoneyCompact(grandCm3);
}

function sortPma(key) {
  if (pmaState.sortKey === key) { pmaState.sortDir = pmaState.sortDir === "asc" ? "desc" : "asc"; }
  else { pmaState.sortKey = key; pmaState.sortDir = "desc"; }
  applyPmaSearchAndSort();
}

function applyPmaSearchAndSort() {
  const term = $("searchPmaInput") ? $("searchPmaInput").value.trim().toLowerCase() : "";
  pmaState.filtered = (pmaState.data || []).filter(m => {
    if (term && !((m.skuName && m.skuName.toLowerCase().includes(term)) || (m.skuId && String(m.skuId).toLowerCase().includes(term)) ||
      (m.merchantName && m.merchantName.toLowerCase().includes(term)) || (m.merchantId && String(m.merchantId).toLowerCase().includes(term)) ||
      (m.acm && m.acm.toLowerCase().includes(term)) || (m.category && m.category.toLowerCase().includes(term)))) return false;
    return true;
  });

  const { sortKey, sortDir } = pmaState; const dir = sortDir === "asc" ? 1 : -1;
  pmaState.filtered.sort((a, b) => {
    let av = a[sortKey]; let bv = b[sortKey];
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });

  pmaState.page = 0;
  renderPaginatedPmaTable();
}

function renderPaginatedPmaTable() {
  const tbody = $("pmaTableBody"); if (!tbody) return; tbody.innerHTML = "";
  const start = pmaState.page * PAGE_SIZE;
  const pageRows = pmaState.filtered.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="21" class="text-dim center">No matches found.</td></tr>`;
  } else {
    pageRows.forEach(m => {
      const tr = document.createElement("tr");
      // MoM Trend — سهم لفوق (أخضر) لو الأداء بيطلع، سهم لتحت (أحمر) لو
      // بيقع، سهم يمين (رمادي) لو شبه ثابت (±1%)، "-" لو الماتش New.
      let trendHtml = '<span class="text-dim">-</span>';
      if (m.trendPct !== null && m.trendPct !== undefined) {
        const isUp = m.trendPct > 1, isDown = m.trendPct < -1;
        const arrow = isUp ? "▲" : (isDown ? "▼" : "▶");
        const cls = isUp ? "text-green" : (isDown ? "text-red" : "text-dim");
        trendHtml = `<span class="${cls} font-bold">${arrow} ${m.trendPct >= 0 ? "+" : ""}${fmtPctCell(m.trendPct)}</span>`;
      }
      tr.innerHTML = `
        <td class="font-mono text-light font-bold">${m.skuId}</td>
        <td class="truncate-cell text-dim" title="${m.skuName || ""}">${m.skuName || '<span class="text-dim">-</span>'}</td>
        <td class="truncate-cell text-dim">${m.category}</td>
        <td class="font-mono text-dim">${m.merchantId}</td>
        <td class="truncate-cell text-dim" title="${m.merchantName || ""}">${m.merchantName || "-"}</td>
        <td class="text-dim">${m.acm || "-"}</td>
        <td><span class="badge-outline ${m.status === "New" ? "blue" : "green"}">${m.status}</span></td>
        <td class="num">${fmtIntCell(m.placedPieces)}</td>
        <td class="num">${fmtIntCell(m.confirmedPieces)}</td>
        <td class="num">${fmtIntCell(m.deliveredPieces)}</td>
        <td class="num text-light font-bold">${fmtIntCell(Math.round(m.avgDailyConfirmed))}</td>
        <td class="num text-dim">${m.prevAvgDailyConfirmed === null ? '<span class="text-dim">-</span>' : fmtIntCell(Math.round(m.prevAvgDailyConfirmed))}</td>
        <td class="num">${trendHtml}</td>
        <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
        <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
        <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
        <td class="num text-dim">${fmtMoneyCompactCell(m.ppmPerPiece)}</td>
        <td class="num font-bold text-purple">${fmtPctCell(m.ppmPct)}</td>
        <td class="num text-orange">${fmtMoneyCompactCell(m.cm3)}</td>
        <td class="num">${fmtMoneyCompactCell(m.cm3PerPiece)}</td>
        <td class="num font-bold text-green">${fmtPctCell(m.cm3Pct)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const totalPages = Math.max(1, Math.ceil(pmaState.filtered.length / PAGE_SIZE));
  if ($("rowCountPma")) $("rowCountPma").textContent = `${fmtInt.format(pmaState.filtered.length)} Matches`;
  if ($("pageIndicatorPma")) $("pageIndicatorPma").textContent = `Page ${pmaState.page + 1} of ${totalPages}`;
  if ($("prevPagePma")) $("prevPagePma").disabled = pmaState.page === 0;
  if ($("nextPagePma")) $("nextPagePma").disabled = pmaState.page >= totalPages - 1;
}

if ($("searchPmaInput")) $("searchPmaInput").addEventListener("input", applyPmaSearchAndSort);
if ($("prevPagePma")) $("prevPagePma").addEventListener("click", () => { if (pmaState.page > 0) { pmaState.page -= 1; renderPaginatedPmaTable(); } });
if ($("nextPagePma")) $("nextPagePma").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(pmaState.filtered.length / PAGE_SIZE)); if (pmaState.page < totalPages - 1) { pmaState.page += 1; renderPaginatedPmaTable(); } });

// -------------------------------------------------------------------------
// شيت تارجتس الـ Single SKU (SINGLE_SKU_TARGETS_GID / gid=1620722565).
// الأعمدة الجديدة (0-based): PRODUCT_ID, PRODUCT_NAME, CATEGORY,
// Availability Placed Daily, Adjust Target Daily Confirmed,
// Target Delivered PCS, Total Delivered GMV.
//
// مهم جدًا: "Availability Placed Daily" و"Adjust Target Daily Confirmed"
// دول تارجت يومي فعلاً (زي ما اسمهم بيقول) — بس "Target Delivered PCS" و
// "Total Delivered GMV" دول إجمالي الشهر كله (Monthly Total)، مش يومي.
// فلو استخدمناهم زي ما هم كأنهم يومي هيبوظوا حساب الـ MTD تمامًا (هيبقى
// أكبر من المفروض بمقدار عدد أيام الشهر). فبنسيبهم هنا زي ما هم (Monthly)
// وبنحولهم لتارجت يومي في computeCommercialDebundlized (بالقسمة على عدد
// أيام الشهر) قبل ما نحسب منهم MTD Target، بنفس منطق باقي الداشبورد كله
// (Daily Target × عدد الأيام من أول الشهر لحد امبارح).
// -------------------------------------------------------------------------
function parseSingleSkuTargetsSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const map = {};
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const id = cellText(c[0]).trim();
    if (!id || id === "PRODUCT_ID" || id === "ID") continue;
    map[id] = {
      name: cellText(c[1]), category: cellText(c[2]),
      placedDailyTarget: cellNumber(c[3]),   // Availability Placed Daily — يومي فعلاً
      adjustedTarget: cellNumber(c[4]),       // Adjust Target Daily Confirmed — يومي فعلاً (زي الأول)
      dlvPcsMonthlyTarget: cellNumber(c[5]),  // Target Delivered PCS — إجمالي الشهر كله
      dlvGmvMonthlyTarget: cellNumber(c[6])   // Total Delivered GMV — إجمالي الشهر كله
    };
  }
  return map;
}


// -------------------------------------------------------------------------
// شيت "New segmentation #6864" الخام (NEW_SEGMENTATION_GID). أعمدته (0-based):
// 0 COUNTRY, 1 MONTH, 2 SEGMENT (HVM/MVM/LVM), 3 SUB_SEGMENT (Champions/Loyal/
// Potential Loyal/Low Value/Occasional/Promising), 4 STATUS (Retained/Churned
// from.../Demoted from.../promoted from.../Re-activated/New merchant),
// 5 FINAL_STATUS (New merchant/Re-activated/Retained/Promoted/Churned/Demoted),
// 6 ORDER_PER_MONTH, 7 CNF_GMV_PER_MONTH, 8 DLV_ORDER_PER_MONTH,
// 9 DLV_GMV_PER_MONTH, 10 COUNT_OF_MERCHANTS.
// -------------------------------------------------------------------------
function parseNewSegmentationSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const country = cellText(c[0]).trim();
    if (!country || country === "COUNTRY") continue; // تخطي صف العناوين
    const dateStr = cellText(c[1]).trim();
    let monthDate = null;
    const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // "2026-01-01" نص عادي
    if (isoMatch) {
      monthDate = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, 1);
    } else {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) monthDate = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    rows.push({
      country: country,
      month: monthDate,
      segment: cellText(c[2]).trim(),
      subSegment: cellText(c[3]).trim(),
      status: cellText(c[4]).trim(),
      finalStatus: cellText(c[5]).trim(),
      orders: cellNumber(c[6]),
      cnfGmv: cellNumber(c[7]),
      dlvOrders: cellNumber(c[8]),
      dlvGmv: cellNumber(c[9]),
      count: cellNumber(c[10])
    });
  }
  console.info(`[Segmentation Panel] Loaded ${rows.length} rows from GID ${NEW_SEGMENTATION_GID}. Countries found:`, [...new Set(rows.map(r => r.country))]);
  return rows;
}

// شيت "Inbound" (GID 565878313). ترتيب الأعمدة (0-based) زي الشيت الأصلي بالظبط:
// 0 Date (تاريخ الاستلام), 1 Odoo_NO, 2 SKU, 3 RCV_QTY, 4 Des (اسم المنتج),
// 5 Category, 6 Receiving Month (أول يوم في شهر الاستلام),
// 7 First buy month (أقدم Receiving Month ظهر فيه الـ SKU ده).
function parseInboundSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const sku = cellText(c[2]);
    if (!sku || sku === "SKU") continue; // تخطي صف العناوين لو موجود

    const rcvDateText = cellText(c[0]);
    const rcvDate = new Date(rcvDateText);

    rows.push({
      sku,
      name: cellText(c[4]),
      cat: cellText(c[5]),
      rcvDateText,
      rcvTs: isNaN(rcvDate.getTime()) ? 0 : rcvDate.getTime(),
      rcvQty: cellNumber(c[3]),
      receivingMonthKey: stMonthKeyFromValue(cellText(c[6])),
      firstBuyMonthKey: stMonthKeyFromValue(cellText(c[7]))
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// شيت "EGY Beginning Inventory #4132" (BEGIN_INV_GID)
// أعمدة بالترتيب: PRODUCT_ID | QTY | MONTH | PRODUCT_NAME | CATEGORY_L1
// -------------------------------------------------------------------------
function parseBeginningInventorySheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const productId = cellText(c[0]);
    if (!productId || productId === "PRODUCT_ID") continue;
    rows.push({
      PRODUCT_ID: productId,
      QTY: cellNumber(c[1]),
      MONTH: cellText(c[2]),
      PRODUCT_NAME: cellText(c[3]),
      CATEGORY_L1: cellText(c[4])
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// شيت "Porducts_infor #4259" (PRODUCTS_INFO_GID)
// أعمدة بالترتيب: COUNTRY | PRODUCT_ID | BUNDLE_NAME | CATEGORY_L1 | CATEGORY_L2 |
//                 CATEGORY_L3 | PRICE | PROFIT | WAVG | PPM | IS_BUNDLE | QTY | IMAGE
// بيتفلتر على COUNTRY = "EGY" بس (زي باقي البانل).
// -------------------------------------------------------------------------
function parseProductsInfoSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const country = cellText(c[0]);
    if (!country || country === "COUNTRY") continue;
    if (country.trim().toUpperCase() !== "EGY") continue;
    const productId = cellText(c[1]);
    if (!productId) continue;
    rows.push({
      COUNTRY: country,
      PRODUCT_ID: productId,
      BUNDLE_NAME: cellText(c[2]),
      CATEGORY_L1: cellText(c[3]),
      CATEGORY_L2: cellText(c[4]),
      CATEGORY_L3: cellText(c[5]),
      PRICE: cellNumber(c[6]),
      PROFIT: cellNumber(c[7]),
      WAVG: cellNumber(c[8]),
      PPM: cellNumber(c[9]),
      IS_BUNDLE: cellText(c[10]),
      QTY: cellNumber(c[11]),
      IMAGE: cellText(c[12])
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// شيت "EGY Sell-through rate needed data #2941" (SELLTHROUGH_NEEDED_GID)
// أعمدة بالترتيب: PRODUCT_ID | PRODUCT_NAME | CATEGORY_L1 | PLC_QTY | CNF_QTY |
//                 DLV_QTY | RTO_QTY | MONTH
// -------------------------------------------------------------------------
function parseSellthroughNeededSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const productId = cellText(c[0]);
    if (!productId || productId === "PRODUCT_ID") continue;
    rows.push({
      PRODUCT_ID: productId,
      PRODUCT_NAME: cellText(c[1]),
      CATEGORY_L1: cellText(c[2]),
      PLC_QTY: cellNumber(c[3]),
      CNF_QTY: cellNumber(c[4]),
      DLV_QTY: cellNumber(c[5]),
      RTO_QTY: cellNumber(c[6]),
      MONTH: cellText(c[7])
    });
  }
  return rows;
}

function getSegmentLogic(orders) {
  if (orders === 0) return "In active";
  if (orders < 5) return "Low Value";
  if (orders < 50) return "Occasional";
  if (orders < 150) return "Promising";
  if (orders < 300) return "Potential Loyalist";
  if (orders < 1000) return "Loyal Merchants";
  return "Champions";
}

const fmtInt = new Intl.NumberFormat("en-US");
const fmtPct = (n) => `${n.toFixed(1)}%`;
const fmtMoneyCompact = (n) => {
  if (n === 0) return `EGP 0`;
  const sign = n < 0 ? "-" : ""; const abs = Math.abs(n);
  if (abs >= 1000000) return `${sign}EGP ${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}EGP ${Math.round(abs / 1000)}K`;
  return `${sign}EGP ${Math.round(abs)}`;
}
// -------------------------------------------------------------------------
// نسخ "Cell" من نفس الفورمترز فوق: نفس الشكل المعروض بالظبط على الشاشة
// (EGP / K / M / % / فواصل الآلاف) بدون أي تغيير بصري، لكن بتلف النص ده جوه
// span عادي ومعاه data-raw = الرقم الخام (من غير % ولا EGP، عشان الأعمدة
// اللي مش نسبة تنزل رقم نضيف تقدر تعمل عليه عمليات حسابية في إكسيل)،
// ومعاه كمان data-export لو الشكل المطلوب في الداونلود مختلف عن الرقم
// الخام البسيط — زي النسب المئوية، اللي المفروض تنزل "49.0%" بعلامة الـ%
// معاها في الداونلود برضو (مش رقم عشري خام من غير وحدة)، عشان محدش يلخبط
// 49% بـ 49 كرقم عادي أو بـ 0.49 كسر.
// -------------------------------------------------------------------------
function wrapRawCell(raw, text, exportOverride) {
  const safeRaw = Number.isFinite(raw) ? raw : 0;
  const exportAttr = exportOverride !== undefined ? ` data-export="${String(exportOverride).replace(/"/g, "&quot;")}"` : "";
  return `<span class="raw-num" data-raw="${safeRaw}"${exportAttr}>${text}</span>`;
}
const fmtIntCell = (n) => wrapRawCell(n, fmtInt.format(n));
const fmtPctCell = (n) => wrapRawCell(n, fmtPct(n), fmtPct(n)); // الداونلود بينزل "49.0%" زي ما هي، مش رقم خام من غير علامة %
const fmtMoneyCompactCell = (n) => wrapRawCell(n, fmtMoneyCompact(n));

function setupTicker() {
  const text = TICKER_MESSAGES.join("&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;");
  if($("tickerTrack")) $("tickerTrack").innerHTML = `${text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${text}`;
}

function showToast() { const toast = $("toast"); if(!toast) return; toast.classList.remove("hidden"); setTimeout(() => toast.classList.add("hidden"), 3500); }

function populateFilters(rows) {
  const acms = new Set(); const months = new Set();
  rows.forEach(r => { if (r.acmName && r.acmName !== "Unassigned") acms.add(r.acmName); if (r.monthYear && r.monthYear !== "Unknown Month") months.add(r.monthYear); });
  const sortedMonths = Array.from(months).sort((a, b) => new Date(b) - new Date(a));
  const monthSelect = $("monthSelect");
  if(monthSelect) {
    monthSelect.innerHTML = '<option value="">All Months</option>';
    sortedMonths.forEach(m => { const opt = document.createElement("option"); opt.value = m; opt.textContent = m; monthSelect.appendChild(opt); });
    const now = new Date(); const currentMonthStr = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    for(let i=0; i < monthSelect.options.length; i++) { if(monthSelect.options[i].value === currentMonthStr) { monthSelect.value = currentMonthStr; break; } }
  }
  const sortedAcms = Array.from(acms).sort();
  const acmSelect = $("acmSelect");
  if(acmSelect) {
    acmSelect.innerHTML = '<option value="All">All ACMs</option>';
    sortedAcms.forEach(a => { const opt = document.createElement("option"); opt.value = a; opt.textContent = a; acmSelect.appendChild(opt); });
  }
}

function applyFilters() {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  if($("tableDateRange")) $("tableDateRange").textContent = selectedMonth || "All Time";
  const filteredRows = state.allParsedRows.filter(r => { return (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm); });
  updateDashboard(filteredRows);
}

function updateDashboard(rows) {
  const metrics = computeMetrics(rows);
  const leaderboard = computeLeaderboard(rows);
  if($("placedOrdersVal")) $("placedOrdersVal").textContent = fmtInt.format(metrics.placedOrders);
  if($("confirmedOrdersVal")) $("confirmedOrdersVal").textContent = fmtInt.format(metrics.confirmedOrders);
  if($("deliveredGmvVal")) $("deliveredGmvVal").textContent = fmtMoneyCompact(metrics.deliveredGmv);
  if($("placedOrdersRunRate")) $("placedOrdersRunRate").textContent = `Run Rate: ${fmtInt.format(Math.round(metrics.placedRunRate))} by EOM`;
  if($("confirmedOrdersRunRate")) $("confirmedOrdersRunRate").textContent = `Run Rate: ${fmtInt.format(Math.round(metrics.confirmedRunRate))} by EOM`;
  if($("deliveredGmvRunRate")) $("deliveredGmvRunRate").textContent = `Run Rate: ${fmtMoneyCompact(metrics.deliveredGmvRunRate)} by EOM`;
  if($("confirmedGmvVal")) $("confirmedGmvVal").textContent = fmtMoneyCompact(metrics.confirmedGmv);
  if($("crVal")) $("crVal").textContent = fmtPct(metrics.cr);
  if($("drVal")) $("drVal").textContent = fmtPct(metrics.dr);
  if($("ndrVal")) $("ndrVal").textContent = fmtPct(metrics.ndr);
  if($("activeSkusVal")) $("activeSkusVal").textContent = fmtInt.format(metrics.activeSkus);
  if($("activeMerchantsVal")) $("activeMerchantsVal").textContent = fmtInt.format(metrics.activeMerchants);
  const lbContainer = $("leaderboardList");
  if(lbContainer) {
    lbContainer.innerHTML = "";
    leaderboard.forEach((item, index) => {
      const li = document.createElement("li"); li.className = "leaderboard-item";
      li.innerHTML = `
        <div class="lb-rank ${index === 0 ? 'gold' : ''}">${index + 1}</div>
        <div class="lb-name">${item.name}</div>
        <div class="lb-stats"><div class="lb-ndr">${fmtPctCell(item.ndr)}</div><div class="lb-orders">${fmtIntCell(item.orders)} orders</div></div>
      `;
      lbContainer.appendChild(li);
    });
  }
  if($("sidebarUpdated")) $("sidebarUpdated").textContent = `Last sync: ${new Date().toLocaleTimeString()}`;
  renderPipelineChart(rows); renderCategoryChart(rows);
  prepareMerchantTableData(rows); prepareAcmTableData(rows); prepareMpSalesPlanData(); prepareInventoryTableData(rows);
  renderOverallAcmTargetsSummary();
  if ($("viewTargetsCommercial") && $("viewTargetsCommercial").classList.contains("active-view")) renderTargetsCommercialView();
  if ($("viewCommercialDebundlized") && $("viewCommercialDebundlized").classList.contains("active-view")) prepareCommercialDebundlizedData();
  if ($("viewCm3AnalystProducts") && $("viewCm3AnalystProducts").classList.contains("active-view")) prepareCm3AnalystProductsData();
  if ($("viewPpmAnalystProducts") && $("viewPpmAnalystProducts").classList.contains("active-view")) preparePpmAnalystProductsData();
  if ($("viewProductsAnalyst") && $("viewProductsAnalyst").classList.contains("active-view")) prepareProductsAnalystData();
  if ($("viewProductsMatchesAnalyst") && $("viewProductsMatchesAnalyst").classList.contains("active-view")) prepareProductsMatchesAnalystData();
  // CM3 Target بقت سكشن جوه CM3 Analyst — لازم الاتنين يترندروا مع بعض.
  if ($("viewCm3Analyst") && $("viewCm3Analyst").classList.contains("active-view")) { renderCm3TargetView(); renderCm3AnalystView(); }
  if ($("viewMpMatches") && $("viewMpMatches").classList.contains("active-view")) prepareMpMatchesData();
  if ($("viewMpNewMatches") && $("viewMpNewMatches").classList.contains("active-view")) prepareMpNewMatchesData();
  if ($("viewRecommendedTracker") && $("viewRecommendedTracker").classList.contains("active-view")) prepareRecommendedTrackerData();
  applyTableSearchAndSort(); renderTrendTables(state.allParsedRows, $("acmSelect") ? $("acmSelect").value : "All");
  renderTop10Merchants(); renderOverallTargetSummary(); applyMerchantSearchAndSort(); applySegSearchAndSort(); applyInventorySearchAndSort();
}

function computeMetrics(rows) {
  let totalPlaced = 0, totalConfirmed = 0, totalDelivered = 0, confirmedGmv = 0, deliveredGmv = 0;
  let skus = new Set(), merchants = new Set();
  rows.forEach(r => {
    totalPlaced += r.placedOrders; totalConfirmed += r.confirmedOrders; totalDelivered += r.deliveredOrders;
    confirmedGmv += r.confirmedGmv; deliveredGmv += r.deliveredGmv;
    if(r.sku && r.placedOrders > 0) skus.add(r.sku);
    if(r.merchantId && r.placedOrders > 0) merchants.add(r.merchantId);
  });

  // CR% / DR% / NDR% في الأوفرفيو: زي باقي أي سكشن تاني مصدره MAIN_GID —
  // CR% (Confirmed/Placed) بياخد كات أوف يومين بس (CR_LAG_DAYS)، والـ DR%
  // (Delivered/Confirmed) بياخد كات أوف الـ 5 أيام (CM3_LAG_DAYS) — كل واحد
  // بالكات أوف الخاص بيه لوحده، مش كات أوف واحد مشترك بينهم. الأوردرات اللي
  // لسه في نطاق الـ لاج بتاعها لسه مالهاش وقت كافي تتأكد/تتسلم، فلو دخلناها
  // في الحساب هتوهم إن الـ Rate واطي وهو مش كده فعلاً. NDR% = CR% × DR%.
  // باقي الأرقام (Placed/Confirmed Orders, GMV) فاضلة زي ما هي من غير أي لاج.
  const crCutoffTs = getLagCutoffTimestamp(rows, CR_LAG_DAYS);
  const drCutoffTs = getCm3LagCutoffTimestamp(rows);
  let crPlaced = 0, crConfirmed = 0, drConfirmed = 0, drDelivered = 0;
  rows.forEach(r => {
    if (isRowEligibleForLag(r, crCutoffTs)) {
      crPlaced += r.placedOrders; crConfirmed += r.confirmedOrders;
    }
    if (isCm3RowEligible(r, drCutoffTs)) {
      drConfirmed += r.confirmedOrders; drDelivered += r.deliveredOrders;
    }
  });
  const cr = crPlaced ? (crConfirmed / crPlaced) : 0;
  const dr = drConfirmed ? (drDelivered / drConfirmed) : 0;

  // Run Rate: إسقاط "هيقفل الشهر كام" لو الأداء الحالي (لحد آخر تاريخ في
  // الداتا المفلترة) استمر لحد آخر يوم في نفس الشهر — نفس المنطق المستخدم
  // في Sales Plan-ACM وCommercial Plan بالظبط (MTD Actual ÷ الأيام اللي
  // فاتت × إجمالي أيام الشهر).
  let latestTs = 0; rows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
  let placedRunRate = totalPlaced, confirmedRunRate = totalConfirmed, deliveredGmvRunRate = deliveredGmv;
  if (latestTs) {
    const latestDate = new Date(latestTs); latestDate.setHours(0, 0, 0, 0);
    const elapsedDays = latestDate.getDate() || 1;
    const currentMonthDays = new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 0).getDate();
    placedRunRate = (totalPlaced / elapsedDays) * currentMonthDays;
    confirmedRunRate = (totalConfirmed / elapsedDays) * currentMonthDays;
    deliveredGmvRunRate = (deliveredGmv / elapsedDays) * currentMonthDays;
  }

  return {
    placedOrders: totalPlaced, confirmedOrders: totalConfirmed, deliveredGmv, confirmedGmv, cr: cr * 100, dr: dr * 100, ndr: (dr * cr) * 100, activeSkus: skus.size, activeMerchants: merchants.size,
    placedRunRate, confirmedRunRate, deliveredGmvRunRate
  };
}

function computeLeaderboard(rows) {
  // نفس منطق كروت CR/DR/NDR فوق في نفس الصفحة — عشان الـ Leaderboard يبقى
  // متسق معاهم: CR% (Confirmed/Placed) بكات أوف يومين (CR_LAG_DAYS) لوحده،
  // و DR% (Delivered/Confirmed) بكات أوف 5 أيام (CM3_LAG_DAYS) لوحده، كل
  // واحد بالكات أوف بتاعه، مش كات أوف واحد مشترك بينهم.
  const crCutoffTs = getLagCutoffTimestamp(rows, CR_LAG_DAYS);
  const drCutoffTs = getCm3LagCutoffTimestamp(rows);
  const map = new Map();
  rows.forEach(r => {
    if (!r.acmName || r.acmName === "Unassigned") return;
    const entry = map.get(r.acmName) || { name: r.acmName, crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0 };
    if (isRowEligibleForLag(r, crCutoffTs)) { entry.crPlaced += r.placedOrders; entry.crConfirmed += r.confirmedOrders; }
    if (isCm3RowEligible(r, drCutoffTs)) { entry.drConfirmed += r.confirmedOrders; entry.drDelivered += r.deliveredOrders; }
    map.set(r.acmName, entry);
  });
  return Array.from(map.values()).filter(m => m.crPlaced > 0).map(m => {
    const cr = m.crPlaced ? (m.crConfirmed / m.crPlaced) : 0;
    const dr = m.drConfirmed ? (m.drDelivered / m.drConfirmed) : 0;
    return { name: m.name, orders: m.crConfirmed, ndr: (dr * cr) * 100 };
  }).sort((a, b) => b.ndr - a.ndr).slice(0, 6);
}

function getCrBadgeColor(pct) { return pct >= 60 ? "green" : (pct >= 50 ? "orange" : "red"); }
function getNdrBadgeColor(pct) { return pct >= 25 ? "green" : (pct >= 15 ? "orange" : "red"); }
function getSegBadgeClass(segment) {
  const s = segment ? segment.toLowerCase() : "";
  if (s.includes("champions")) return "seg-champions"; if (s.includes("loyal")) return "seg-loyal";
  if (s.includes("potential")) return "seg-potential"; if (s.includes("promising")) return "seg-promising";
  if (s.includes("occasional")) return "seg-occasional"; if (s.includes("low value")) return "seg-lowvalue";
  return "seg-inactive";
}

function prepareInventoryTableData(rows) {
  let latestTs = 0; rows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
  const today = new Date(latestTs); today.setHours(0,0,0,0); const todayMs = today.getTime();
  const ydayMs = todayMs - 86400000; const d3Ms = todayMs - (3 * 86400000); const d5Ms = todayMs - (5 * 86400000); const d15Ms = todayMs - (15 * 86400000);
  const cm3Cutoff = getCm3LagCutoffTimestamp(rows); // بيانات المصدر هنا Main، فالـ CM3 لازم يرجع 4 أيام
  const map = new Map();
  for (let sku in state.inventoryMap) {
    const inv = state.inventoryMap[sku]; const prod = state.productsMap[sku] || { price: 0, profit: 0 };
    map.set(sku, { skuId: sku, skuName: inv.skuName, stock: inv.stock, doh: inv.doh, category: inv.category, availability: inv.availability, isLocked: inv.isLocked, price: prod.price, profit: prod.profit, placed: 0, confirmed: 0, delivered: 0, cm3: 0, deliveredGmv: 0, placedYday: 0, confYday: 0, conf3d: 0, conf5d: 0, conf15d: 0, merchants5d: {}, totalActiveDays: new Set() });
  }
  rows.forEach(r => {
    const sku = r.sku; if (!sku) return;
    if (!map.has(sku)) {
      const prod = state.productsMap[sku] || { price: 0, profit: 0 };
      map.set(sku, { skuId: sku, skuName: "Unknown", stock: 0, doh: 0, category: r.category, availability: "Unknown", isLocked: "No", price: prod.price, profit: prod.profit, placed: 0, confirmed: 0, delivered: 0, cm3: 0, deliveredGmv: 0, placedYday: 0, confYday: 0, conf3d: 0, conf5d: 0, conf15d: 0, merchants5d: {}, totalActiveDays: new Set() });
    }
    const entry = map.get(sku);
    entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders;
    // deliveredGmv هنا مستخدم فقط لحساب نسبة الـ CM3%، فلازم يبقى بنفس الكات أوف بتاع الـ CM3 بالظبط
    // (متكونش الـ CM3 واقفة عند يوم والـ GMV ماشية لحد آخر يوم في الداتا)
    if (isCm3RowEligible(r, cm3Cutoff)) { entry.cm3 += r.cm3; entry.deliveredGmv += r.deliveredGmv; }
    const rDate = new Date(r.timestamp); rDate.setHours(0,0,0,0); const rTime = rDate.getTime();
    if(r.placedOrders > 0) entry.totalActiveDays.add(rTime);
    if (rTime === ydayMs) { entry.placedYday += r.placedOrders; entry.confYday += r.confirmedOrders; }
    if (rTime >= d3Ms) entry.conf3d += r.confirmedOrders;
    if (rTime >= d15Ms) entry.conf15d += r.confirmedOrders;
    if (rTime >= d5Ms) { entry.conf5d += r.confirmedOrders; if(r.merchantName) { entry.merchants5d[r.merchantName] = (entry.merchants5d[r.merchantName] || 0) + r.confirmedOrders; } }
  });
  state.inventoryTableData = Array.from(map.values()).map(m => {
    const cr = m.placed ? (m.confirmed / m.placed) : 0; const dr = m.confirmed ? (m.delivered / m.confirmed) : 0; const ndr = dr * cr; const cm3Pct = m.deliveredGmv ? (m.cm3 / m.deliveredGmv) : 0;
    const avg3d = m.conf3d / 3; const avg15d = m.conf15d / 15; const avgPlacedDaily = m.totalActiveDays.size ? (m.placed / m.totalActiveDays.size) : 0;
    let topMerch = "-"; let topMerchConf = 0;
    for (const [merch, conf] of Object.entries(m.merchants5d)) { if (conf > topMerchConf) { topMerchConf = conf; topMerch = merch; } }
    const contr5d = m.conf5d ? (topMerchConf / m.conf5d) : 0;
    const trendRatio = avg15d > 0 ? avg3d / avg15d : (avg3d > 0 ? 2 : 1);
    let trendStatus = "Stable"; let trendColor = "stable";
    if (trendRatio > 1.2) { trendStatus = "Hot  "; trendColor = "spike"; } else if (trendRatio < 0.8) { trendStatus = "Cooling  "; trendColor = "decline"; }
    return { ...m, cr: cr * 100, dr: dr * 100, ndr: ndr * 100, cm3Pct: cm3Pct * 100, avg3d, avg15d, avgPlacedDaily, topMerch, contr5d: contr5d * 100, trendStatus, trendColor };
  });
}

function applyInventorySearchAndSort() {
  const term = $("searchInventoryInput") ? $("searchInventoryInput").value.trim().toLowerCase() : "";
  state.filteredInventoryData = state.inventoryTableData.filter(m => { if (!term) return true; return String(m.skuId).toLowerCase().includes(term) || m.skuName.toLowerCase().includes(term) || String(m.category).toLowerCase().includes(term); });
  const { sortKeyInventory, sortDirInventory } = state; const dir = sortDirInventory === "asc" ? 1 : -1;
  state.filteredInventoryData.sort((a, b) => { const av = a[sortKeyInventory]; const bv = b[sortKeyInventory]; if (typeof av === "string") return av.localeCompare(bv) * dir; return (av - bv) * dir; });
  state.pageInventory = 0; renderPaginatedInventoryTable();
}

function renderPaginatedInventoryTable() {
  const tbody = $("inventoryTableBody"); if(!tbody) return; tbody.innerHTML = "";
  const start = state.pageInventory * PAGE_SIZE; const pageRows = state.filteredInventoryData.slice(start, start + PAGE_SIZE);
  pageRows.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-dim">#${start + idx + 1}</td>
      <td class="font-mono text-dim">${m.skuId}</td>
      <td class="font-bold text-light" style="white-space:normal; min-width: 150px; line-height: 1.4;">${m.skuName}</td>
      <td class="num"><span class="badge-outline ${m.stock > 10 ? 'green' : 'red'}">${fmtIntCell(Math.round(m.stock))}</span></td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.doh))}</td>
      <td class="text-dim">${m.category}</td>
      <td><span class="badge-outline ${m.availability === 'Out of Stock' ? 'red' : 'blue'}">${m.availability}</span></td>
      <td class="num font-bold text-blue">${fmtMoneyCompactCell(m.price)}</td>
      <td class="num font-bold text-green">${fmtMoneyCompactCell(m.profit)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.cr)}">${fmtPctCell(m.cr)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.dr)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPctCell(m.ndr)}</span></td>
      <td class="num text-light font-bold">${fmtMoneyCompactCell(m.cm3)}</td>
      <td class="num text-dim">${m.avgPlacedDaily.toFixed(1)}</td>
      <td class="num text-dim">${fmtIntCell(m.placedYday)}</td>
      <td class="num text-blue font-bold">${fmtIntCell(m.confYday)}</td>
      <td class="num text-orange font-bold">${m.avg3d.toFixed(1)}</td>
      <td class="num text-purple font-bold">${m.avg15d.toFixed(1)}</td>
      <td><span class="badge-status ${m.trendColor}">${m.trendStatus}</span></td>
      <td class="text-dim">${m.topMerch}</td>
      <td class="num font-bold">${fmtPctCell(m.contr5d)}</td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(state.filteredInventoryData.length / PAGE_SIZE));
  if($("rowCountInventory")) $("rowCountInventory").textContent = `${fmtInt.format(state.filteredInventoryData.length)} SKUs`;
  if($("pageIndicatorInventory")) $("pageIndicatorInventory").textContent = `Page ${state.pageInventory + 1} of ${totalPages}`;
  if($("prevPageInventory")) $("prevPageInventory").disabled = state.pageInventory === 0;
  if($("nextPageInventory")) $("nextPageInventory").disabled = state.pageInventory >= totalPages - 1;
  document.querySelectorAll("#inventoryTable thead th").forEach((th) => { if(th.dataset.ikey) { th.classList.toggle("sorted", th.dataset.ikey === state.sortKeyInventory); } });
}

function prepareAcmTableData(rows) {
  const map = new Map();
  const cm3Cutoff = getCm3LagCutoffTimestamp(rows); // بيانات المصدر هنا Main، فالـ CM3 لازم يرجع 4 أيام
  rows.forEach(r => {
    if (!r.acmName || r.acmName === "Unassigned") return;
    if (!map.has(r.acmName)) { map.set(r.acmName, { name: r.acmName, placed: 0, confirmed: 0, delivered: 0, placedGmv: 0, deliveredGmv: 0, confirmedGmv: 0, cm3: 0, cm3DeliveredGmv: 0, actualRetention: 0 }); }
    const entry = map.get(r.acmName); entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders; entry.deliveredGmv += r.deliveredGmv; entry.confirmedGmv += r.confirmedGmv;
    // cm3DeliveredGmv: نفس الـ deliveredGmv بس بكات أوف الـ CM3 بالظبط — ده اللي بيتحسب بيه cm3Pct
    // عشان مايبقاش عندنا CM3 واقفة عند يوم و GMV ماشية لحد آخر يوم موجود في الداتا (بيبوظ النسبة).
    // deliveredGmv العادي فاضل من غير لاج زي ما هو، مستخدم لأهداف الـ GMV والـ Run Rate بتاعت الـ ACM.
    if (isCm3RowEligible(r, cm3Cutoff)) { entry.cm3 += r.cm3; entry.cm3DeliveredGmv += r.deliveredGmv; }
  });
  state.merchantTableData.forEach(merch => {
    if (merch.acm && map.has(merch.acm)) {
      const currentRank = SEGMENT_RANKS[normalizeName(merch.currentSegment)] || 0; const projectedRank = SEGMENT_RANKS[normalizeName(merch.projectedSegment)] || 0;
      if (projectedRank > currentRank) { map.get(merch.acm).actualRetention += 1; }
    }
  });
  const normalizedTargets = {}; for(let key in state.acmTargets) { normalizedTargets[normalizeName(key)] = state.acmTargets[key]; }
  const selectedMonthStr = $("monthSelect") ? $("monthSelect").value : ""; let elapsedDays = 1; let totalDays = 30;
  if (selectedMonthStr) { const d = new Date(selectedMonthStr); if (!isNaN(d)) { const now = new Date(); totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) { elapsedDays = now.getDate() || 1; } else { elapsedDays = totalDays; } } }
  state.acmTableData = Array.from(map.values()).map(m => {
    const cr = m.placed ? (m.confirmed / m.placed) : 0; const dr = m.confirmed ? (m.delivered / m.confirmed) : 0; const ndr = (dr * cr) * 100; const cm3Pct = m.cm3DeliveredGmv ? (m.cm3 / m.cm3DeliveredGmv) * 100 : 0;
    const targetData = normalizedTargets[normalizeName(m.name)] || { targetGmv: 0, targetNdr: 0, targetCm3: 0, targetRetention: 0 };
    const targetGmv = targetData.targetGmv; const targetNdr = targetData.targetNdr; const targetCm3 = targetData.targetCm3; const targetRetention = targetData.targetRetention;
    const achievedPct = targetGmv > 0 ? (m.deliveredGmv / targetGmv) * 100 : 0; const runRate = (m.deliveredGmv / elapsedDays) * totalDays;
    const w = state.acmWeights; const gmvScore = targetGmv > 0 ? Math.min(m.deliveredGmv / targetGmv, 1) * w.gmv : 0; const ndrScore = targetNdr > 0 ? Math.min(ndr / targetNdr, 1) * w.ndr : 0; const cm3Score = targetCm3 > 0 ? Math.min(cm3Pct / targetCm3, 1) * w.cm3 : 0; const retentionScore = targetRetention > 0 ? Math.min(m.actualRetention / targetRetention, 1) * w.retention : 0;
    const finalScorePct = gmvScore + ndrScore + cm3Score + retentionScore;
    return { ...m, cr: cr * 100, dr: dr * 100, ndr: ndr, cm3Pct: cm3Pct, targetGmv, targetNdr, targetCm3, targetRetention, achievedPct, runRate, finalScorePct };
  });
}

function renderOverallAcmTargetsSummary() {
  let totalTarget = 0; let totalDelivered = 0; let totalRunRate = 0;
  state.acmTableData.forEach(m => { if(m.targetGmv > 0) { totalTarget += m.targetGmv; totalDelivered += m.deliveredGmv; totalRunRate += m.runRate; } });
  const pct = totalTarget > 0 ? (totalDelivered / totalTarget) * 100 : 0;
  if($("overallAcmTargetGmv")) $("overallAcmTargetGmv").textContent = fmtMoneyCompact(totalTarget);
  if($("overallAcmDeliveredGmv")) $("overallAcmDeliveredGmv").textContent = fmtMoneyCompact(totalDelivered);
  if($("overallAcmRunRateGmv")) $("overallAcmRunRateGmv").textContent = fmtMoneyCompact(totalRunRate);
  if($("overallAcmAchievedPct")) $("overallAcmAchievedPct").textContent = fmtPct(pct);
  const bar = $("overallAcmProgressBar");
  if(bar) { bar.style.width = `${Math.min(pct, 100)}%`; bar.className = "progress-fill"; if (pct >= 100) bar.classList.add("green"); else if (pct < 50) bar.classList.add("red"); else if (pct >= 50 && pct < 80) bar.classList.add("orange"); else bar.classList.add("blue"); }
}

function applyTableSearchAndSort() {
  const term = $("searchInput") ? $("searchInput").value.trim().toLowerCase() : "";
  state.filteredAcmData = state.acmTableData.filter(m => { if (!term) return true; return m.name.toLowerCase().includes(term); });
  const { sortKey, sortDir } = state; const dir = sortDir === "asc" ? 1 : -1;
  state.filteredAcmData.sort((a, b) => { const av = a[sortKey]; const bv = b[sortKey]; if (typeof av === "string") return av.localeCompare(bv) * dir; return (av - bv) * dir; });
  state.page = 0; renderPaginatedAcmTable();
}

function renderPaginatedAcmTable() {
  const tbody = $("acmTableBody"); if(!tbody) return; tbody.innerHTML = "";
  const start = state.page * PAGE_SIZE; const pageRows = state.filteredAcmData.slice(start, start + PAGE_SIZE);
  pageRows.forEach((m, idx) => {
    let gmvColor = m.targetGmv === 0 ? "dim" : (m.achievedPct >= 100 ? "green" : (m.achievedPct < 50 ? "red" : "orange"));
    let finalColor = m.finalScorePct >= 70 ? "green" : (m.finalScorePct >= 40 ? "orange" : "red");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-dim">#${start + idx + 1}</td>
      <td class="font-bold text-light">${m.name}</td>
      <td class="num font-bold"><div style="font-weight:600; font-size: 12px; color:var(--${finalColor})">${fmtPctCell(m.finalScorePct)}</div><div class="progress-bar"><div class="progress-fill ${finalColor}" style="width: ${Math.min(m.finalScorePct, 100)}%"></div></div></td>
      <td class="num text-dim font-bold">${m.targetGmv > 0 ? fmtMoneyCompactCell(m.targetGmv) : '-'}</td>
      <td class="num text-green font-bold">${fmtMoneyCompactCell(m.deliveredGmv)}</td>
      <td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${gmvColor})">${m.targetGmv > 0 ? m.achievedPct.toFixed(1) + '%' : 'N/A'}</div><div class="progress-bar"><div class="progress-fill ${gmvColor}" style="width: ${Math.min(m.achievedPct, 100)}%"></div></div></td>
      <td class="num font-bold text-blue">${fmtMoneyCompactCell(m.runRate)}</td>
      <td class="num text-dim">${m.targetNdr > 0 ? m.targetNdr + '%' : '-'}</td>
      <td class="num"><span class="badge-outline ${m.ndr >= m.targetNdr && m.targetNdr > 0 ? 'green' : 'red'}">${fmtPctCell(m.ndr)}</span></td>
      <td class="num text-dim">${m.targetCm3 > 0 ? m.targetCm3 + '%' : '-'}</td>
      <td class="num"><span class="badge-outline ${m.cm3Pct >= m.targetCm3 && m.targetCm3 > 0 ? 'green' : 'red'}">${fmtPctCell(m.cm3Pct)}</span></td>
      <td class="num text-dim font-bold">${m.targetRetention > 0 ? fmtIntCell(m.targetRetention) : '-'}</td>
      <td class="num"><span class="badge-outline ${m.actualRetention >= m.targetRetention && m.targetRetention > 0 ? 'green' : 'red'}">${fmtIntCell(m.actualRetention)}</span></td>
      <td class="num text-dim">${fmtIntCell(m.placed)}</td>
      <td class="num text-blue font-bold">${fmtIntCell(m.confirmed)}</td>
      <td class="num text-dim">${fmtIntCell(m.delivered)}</td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(state.filteredAcmData.length / PAGE_SIZE));
  if($("rowCount")) $("rowCount").textContent = `${fmtInt.format(state.filteredAcmData.length)} ACMs`;
  if($("pageIndicator")) $("pageIndicator").textContent = `Page ${state.page + 1} of ${totalPages}`;
  if($("prevPage")) $("prevPage").disabled = state.page === 0;
  if($("nextPage")) $("nextPage").disabled = state.page >= totalPages - 1;
  document.querySelectorAll("#acmTable th").forEach((th) => { if(th.dataset.key) th.classList.toggle("sorted", th.dataset.key === state.sortKey); });
}

function renderTrendTables(allRows, selectedAcm) {
  const wowTbody = $("wowTableBody"); const avgTbody = $("avgDailyTableBody");
  if(wowTbody) wowTbody.innerHTML = ""; if(avgTbody) avgTbody.innerHTML = "";
  if (!allRows || allRows.length === 0) return;
  let latestTs = 0; for (const r of allRows) { if (r.timestamp > latestTs) latestTs = r.timestamp; } if(latestTs === 0) return;
  const latestDate = new Date(latestTs); latestDate.setHours(0,0,0,0); const currentMonth = latestDate.getMonth(); const currentYear = latestDate.getFullYear(); const currentDay = latestDate.getDate();
  const lastMonthDate = new Date(latestDate); lastMonthDate.setMonth(currentMonth - 1); const lastMonth = lastMonthDate.getMonth(); const lastMonthYear = lastMonthDate.getFullYear();
  const startThisWeek = new Date(latestDate); startThisWeek.setDate(latestDate.getDate() - 6);
  const startLastWeek = new Date(latestDate); startLastWeek.setDate(latestDate.getDate() - 13);
  const endLastWeek = new Date(startThisWeek); endLastWeek.setDate(endLastWeek.getDate() - 1);
  const trendMap = new Map();
  allRows.forEach(r => {
    if (!r.acmName || r.acmName === "Unassigned" || r.timestamp === 0) return;
    if (selectedAcm !== "All" && r.acmName !== selectedAcm) return;
    if (!trendMap.has(r.acmName)) { trendMap.set(r.acmName, { name: r.acmName, thisWeek: 0, lastWeek: 0, currentMonthTotal: 0, lastMonthTotal: 0 }); }
    const entry = trendMap.get(r.acmName); const rDate = new Date(r.timestamp); rDate.setHours(0,0,0,0);
    if (rDate >= startThisWeek && rDate <= latestDate) { entry.thisWeek += r.confirmedOrders; } else if (rDate >= startLastWeek && rDate <= endLastWeek) { entry.lastWeek += r.confirmedOrders; }
    if (rDate.getMonth() === currentMonth && rDate.getFullYear() === currentYear && rDate.getDate() <= currentDay) { entry.currentMonthTotal += r.confirmedOrders; } else if (rDate.getMonth() === lastMonth && rDate.getFullYear() === lastMonthYear && rDate.getDate() <= currentDay) { entry.lastMonthTotal += r.confirmedOrders; }
  });
  const wowData = Array.from(trendMap.values()).map(m => {
    const change = m.thisWeek - m.lastWeek; let pct = 0;
    if (m.lastWeek > 0) pct = (change / m.lastWeek) * 100; else if (m.thisWeek > 0) pct = 100;
    let status = 'Stable'; let icon = ' '; let colorClass = 'neutral';
    if (pct > 10) { status = 'Spike'; icon = ' '; colorClass = 'positive'; } else if (pct < -10) { status = 'Decline'; icon = ' '; colorClass = 'negative'; }
    return { ...m, change, pct, status, icon, colorClass };
  }).sort((a, b) => b.pct - a.pct);
  if(wowTbody) {
    wowData.forEach((m, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="text-dim">#${idx + 1}</td><td class="font-bold text-light">${m.name}</td><td class="num text-blue font-bold">${fmtIntCell(m.thisWeek)}</td><td class="num text-dim">${fmtIntCell(m.lastWeek)}</td><td class="num"><span class="text-change ${m.colorClass}">${m.icon} ${m.change > 0 ? '+'+fmtIntCell(m.change) : fmtIntCell(m.change)}</span></td><td><span class="badge-status ${m.status.toLowerCase()}">${m.icon} ${m.status} ${m.pct > 0 ? '+'+m.pct.toFixed(1) : m.pct.toFixed(1)}%</span></td><td class="center" style="color: var(--${m.colorClass === 'positive' ? 'green' : m.colorClass === 'negative' ? 'red' : 'dim'}); font-size: 14px;">${m.colorClass === 'positive' ? ' ' : m.colorClass === 'negative' ? ' ' : ' '}</td>`;
      wowTbody.appendChild(tr);
    });
  }
  const momData = Array.from(trendMap.values()).map(m => {
    const activeDaysCount = currentDay || 1; const currentAvg = m.currentMonthTotal / activeDaysCount; const lastAvg = m.lastMonthTotal / activeDaysCount; const change = currentAvg - lastAvg; let pct = 0;
    if (lastAvg > 0) pct = (change / lastAvg) * 100; else if (currentAvg > 0) pct = 100;
    let status = 'Stable'; let icon = ' '; let colorClass = 'neutral';
    if (pct > 10) { status = 'Spike'; icon = ' '; colorClass = 'positive'; } else if (pct < -10) { status = 'Decline'; icon = ' '; colorClass = 'negative'; }
    return { ...m, currentAvg, lastAvg, change, pct, status, icon, colorClass };
  }).sort((a, b) => b.pct - a.pct);
  if(avgTbody) {
    momData.forEach((m, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="text-dim">#${idx + 1}</td><td class="font-bold text-light">${m.name}</td><td class="num text-blue font-bold">${fmtIntCell(Math.round(m.currentAvg))}</td><td class="num text-dim">${fmtIntCell(Math.round(m.lastAvg))}</td><td class="num"><span class="text-change ${m.colorClass}">${m.icon} ${m.change > 0 ? '+'+fmtIntCell(Math.round(m.change)) : fmtIntCell(Math.round(m.change))}</span></td><td><span class="badge-status ${m.status.toLowerCase()}">${m.icon} ${m.status} ${m.pct > 0 ? '+'+m.pct.toFixed(1) : m.pct.toFixed(1)}%</span></td><td class="center" style="color: var(--${m.colorClass === 'positive' ? 'green' : m.colorClass === 'negative' ? 'red' : 'dim'}); font-size: 14px;">${m.colorClass === 'positive' ? ' ' : m.colorClass === 'negative' ? ' ' : ' '}</td>`;
      avgTbody.appendChild(tr);
    });
  }
}

function prepareMerchantTableData(rows) {
  const map = new Map();
  const cm3Cutoff = getCm3LagCutoffTimestamp(rows); // بيانات المصدر هنا Main، فالـ CM3 لازم يرجع 4 أيام
  rows.forEach(r => {
    if (!r.merchantId || r.merchantId === "Unassigned") return;
    if (!map.has(r.merchantId)) { map.set(r.merchantId, { id: r.merchantId, name: r.merchantName, acm: r.acmName, placed: 0, confirmed: 0, delivered: 0, placedGmv: 0, deliveredGmv: 0, confirmedGmv: 0, cm3: 0, cm3DeliveredGmv: 0, skus: new Set() }); }
    const entry = map.get(r.merchantId); entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders; entry.placedGmv += r.placedGmv; entry.deliveredGmv += r.deliveredGmv; entry.confirmedGmv += r.confirmedGmv;
    // cm3DeliveredGmv بكات أوف الـ CM3 بالظبط — نفس المنطق: مايبقاش الـ CM3 لحد يوم والـ GMV لحد يوم تاني
    if (isCm3RowEligible(r, cm3Cutoff)) { entry.cm3 += r.cm3; entry.cm3DeliveredGmv += r.deliveredGmv; }
    if(r.sku && r.placedOrders > 0) entry.skus.add(r.sku);
  });
  const selectedMonthStr = $("monthSelect") ? $("monthSelect").value : ""; let elapsedDays = 1; let totalDays = 30;
  if (selectedMonthStr) { const d = new Date(selectedMonthStr); if (!isNaN(d)) { const now = new Date(); totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) { elapsedDays = now.getDate() || 1; } else { elapsedDays = totalDays; } } }
  state.merchantTableData = Array.from(map.values()).map(m => {
    const cr = m.placed ? (m.confirmed / m.placed) : 0; const dr = m.confirmed ? (m.delivered / m.confirmed) : 0; const ndr = dr * cr; const cm3Pct = m.cm3DeliveredGmv ? (m.cm3 / m.cm3DeliveredGmv) : 0;
    const targetData = state.merchantTargets[m.id] || { gmv: 0, placed: 0 }; const targetGmv = targetData.gmv; const targetPlaced = targetData.placed;
    const achievedPct = targetGmv > 0 ? (m.deliveredGmv / targetGmv) * 100 : 0; const runRate = (m.deliveredGmv / elapsedDays) * totalDays;
    const currentSegment = state.merchantSegmentsMap[m.id] || "In active"; const rrConfirmed = (m.confirmed / elapsedDays) * totalDays; const projectedSegment = getSegmentLogic(rrConfirmed);
    return { ...m, cr: cr * 100, dr: dr * 100, ndr: ndr * 100, cm3Pct: cm3Pct * 100, targetGmv, targetPlaced, achievedPct, runRate, currentSegment, rrConfirmed, projectedSegment, skuCount: m.skus.size };
  });
}

function renderOverallTargetSummary() {
  let totalTarget = 0; let totalDelivered = 0; let totalRunRate = 0;
  state.merchantTableData.forEach(m => { if(m.targetGmv > 0) { totalTarget += m.targetGmv; totalDelivered += m.deliveredGmv; totalRunRate += m.runRate; } });
  const pct = totalTarget > 0 ? (totalDelivered / totalTarget) * 100 : 0;
  if($("overallTargetGmv")) $("overallTargetGmv").textContent = fmtMoneyCompact(totalTarget);
  if($("overallDeliveredGmv")) $("overallDeliveredGmv").textContent = fmtMoneyCompact(totalDelivered);
  if($("overallRunRateGmv")) $("overallRunRateGmv").textContent = fmtMoneyCompact(totalRunRate);
  if($("overallAchievedPct")) $("overallAchievedPct").textContent = fmtPct(pct);
  const bar = $("overallProgressBar");
  if(bar) { bar.style.width = `${Math.min(pct, 100)}%`; bar.className = "progress-fill"; if (pct >= 100) bar.classList.add("green"); else if (pct < 50) bar.classList.add("red"); else if (pct >= 50 && pct < 80) bar.classList.add("orange"); else bar.classList.add("blue"); }
}

function renderTop10Merchants() {
  const tbody = $("top10MerchantBody"); if(!tbody) return; tbody.innerHTML = "";
  const top10 = [...state.merchantTableData].sort((a, b) => b.deliveredGmv - a.deliveredGmv).slice(0, 10);
  top10.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="text-dim">#${idx + 1}</td><td class="font-mono text-dim">${m.id || '-'}</td><td class="font-bold text-light">${m.name}</td><td class="text-dim">${m.acm}</td><td class="num text-blue font-bold">${fmtIntCell(m.confirmed)}</td><td class="num text-dim">${fmtIntCell(m.placed)}</td><td class="num text-dim">${fmtIntCell(m.delivered)}</td><td class="num"><span class="badge-outline ${getCrBadgeColor(m.cr)}">${fmtPctCell(m.cr)}</span></td><td class="num text-dim">${fmtPctCell(m.dr)}</td><td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPctCell(m.ndr)}</span></td><td class="num text-green font-bold">${fmtMoneyCompactCell(m.deliveredGmv)}</td><td class="num text-dim">${fmtMoneyCompactCell(m.confirmedGmv)}</td><td class="num text-dim">${fmtIntCell(m.skuCount)}</td>`;
    tbody.appendChild(tr);
  });
}

function applyMerchantSearchAndSort() {
  const term = $("searchMerchantInput") ? $("searchMerchantInput").value.trim().toLowerCase() : "";
  state.filteredMerchantData = state.merchantTableData.filter(m => { if (!term) return true; return m.name.toLowerCase().includes(term) || m.acm.toLowerCase().includes(term) || String(m.id).includes(term); });
  const { sortKeyMerchant, sortDirMerchant } = state; const dir = sortDirMerchant === "asc" ? 1 : -1;
  state.filteredMerchantData.sort((a, b) => { const av = a[sortKeyMerchant]; const bv = b[sortKeyMerchant]; if (typeof av === "string") return av.localeCompare(bv) * dir; return (av - bv) * dir; });
  state.pageMerchant = 0; renderPaginatedMerchantTable();
}

function renderPaginatedMerchantTable() {
  const tbody = $("merchantTableBody"); if(!tbody) return; tbody.innerHTML = "";
  const start = state.pageMerchant * PAGE_SIZE; const pageRows = state.filteredMerchantData.slice(start, start + PAGE_SIZE);
  pageRows.forEach((m, idx) => {
    let progressColor = "blue"; if(m.targetGmv === 0) progressColor = "dim"; else if(m.achievedPct >= 100) progressColor = "green"; else if(m.achievedPct < 50) progressColor = "red"; else if(m.achievedPct >= 50 && m.achievedPct < 80) progressColor = "orange";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id || '-'}</td><td class="font-bold text-light">${m.name}</td><td class="text-dim">${m.acm}</td><td class="num text-dim font-bold">${m.targetPlaced > 0 ? fmtIntCell(m.targetPlaced) : '-'}</td><td class="num text-dim font-bold">${m.targetGmv > 0 ? fmtMoneyCompactCell(m.targetGmv) : '-'}</td><td class="num text-green font-bold">${fmtMoneyCompactCell(m.deliveredGmv)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${m.targetGmv > 0 ? m.achievedPct.toFixed(1) + '%' : 'N/A'}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${Math.min(m.achievedPct, 100)}%"></div></div></td><td class="num font-bold text-light">${fmtMoneyCompactCell(m.runRate)}</td><td class="num text-dim">${fmtIntCell(m.placed)}</td><td class="num text-blue font-bold">${fmtIntCell(m.confirmed)}</td><td class="num text-dim">${fmtIntCell(m.delivered)}</td><td class="num font-bold text-light">${fmtMoneyCompactCell(m.cm3)}</td><td class="num font-bold text-purple">${fmtPctCell(m.cm3Pct)}</td><td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPctCell(m.ndr)}</span></td><td class="num font-bold text-light">${fmtPctCell(m.cm3Pct)}</td>`;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(state.filteredMerchantData.length / PAGE_SIZE));
  if($("rowCountMerchant")) $("rowCountMerchant").textContent = `${fmtInt.format(state.filteredMerchantData.length)} Merchants`;
  if($("pageIndicatorMerchant")) $("pageIndicatorMerchant").textContent = `Page ${state.pageMerchant + 1} of ${totalPages}`;
  if($("prevPageMerchant")) $("prevPageMerchant").disabled = state.pageMerchant === 0;
  if($("nextPageMerchant")) $("nextPageMerchant").disabled = state.pageMerchant >= totalPages - 1;
  document.querySelectorAll("#merchantTable thead th").forEach((th) => { if(th.dataset.mkey) th.classList.toggle("sorted", th.dataset.mkey === state.sortKeyMerchant); });
}

function applySegSearchAndSort() {
  const term = $("searchSegInput") ? $("searchSegInput").value.trim().toLowerCase() : "";
  state.filteredSegData = state.merchantTableData.filter(m => { if (!term) return true; return m.name.toLowerCase().includes(term) || m.acm.toLowerCase().includes(term) || String(m.id).includes(term); });
  const { sortKeySeg, sortDirSeg } = state; const dir = sortDirSeg === "asc" ? 1 : -1;
  state.filteredSegData.sort((a, b) => { const av = a[sortKeySeg]; const bv = b[sortKeySeg]; if (typeof av === "string") return av.localeCompare(bv) * dir; return (av - bv) * dir; });
  state.pageSeg = 0; renderPaginatedSegTable();
}

function renderPaginatedSegTable() {
  const tbody = $("segTableBody"); if(!tbody) return; tbody.innerHTML = "";
  const start = state.pageSeg * PAGE_SIZE; const pageRows = state.filteredSegData.slice(start, start + PAGE_SIZE);
  pageRows.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id || '-'}</td><td class="font-bold text-light">${m.name}</td><td class="text-dim">${m.acm}</td><td><span class="seg-badge ${getSegBadgeClass(m.currentSegment)}">${m.currentSegment}</span></td><td class="num font-bold text-light">${fmtIntCell(m.confirmed)}</td><td class="num font-bold text-blue">${fmtIntCell(Math.round(m.rrConfirmed))}</td><td><span class="seg-badge ${getSegBadgeClass(m.projectedSegment)}">${m.projectedSegment}</span></td>`;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(state.filteredSegData.length / PAGE_SIZE));
  if($("rowCountSeg")) $("rowCountSeg").textContent = `${fmtInt.format(state.filteredSegData.length)} Merchants`;
  if($("pageIndicatorSeg")) $("pageIndicatorSeg").textContent = `Page ${state.pageSeg + 1} of ${totalPages}`;
  if($("prevPageSeg")) $("prevPageSeg").disabled = state.pageSeg === 0;
  if($("nextPageSeg")) $("nextPageSeg").disabled = state.pageSeg >= totalPages - 1;
  document.querySelectorAll("#segTable thead th").forEach((th) => { if(th.dataset.skey) th.classList.toggle("sorted", th.dataset.skey === state.sortKeySeg); });
}

let pipelineControlsWired = false;
function pipelineWireControlsOnce() {
  if (pipelineControlsWired) return; pipelineControlsWired = true;
  document.querySelectorAll("#pipelineMetricToggle .segmented-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      document.querySelectorAll("#pipelineMetricToggle .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      pipelineChartMetric = btn.dataset.metric;
      renderPipelineChart(pipelineChartLastRows);
    });
  });
}

// Pipeline Velocity: بيدعم عرض المقياس بالـ Orders أو بالـ Pieces (Toggle
// فوق الشارت)، من غير ما يحتاج يطلب بيانات جديدة — نفس الـ rows المفلترة
// اللي بتتبعت لباقي كروت الأوفرفيو، وبس بيغيّر أي عمود يقرأ منه.
function renderPipelineChart(rows) {
  pipelineWireControlsOnce();
  pipelineChartLastRows = rows || [];
  const pipelineCanvas = document.getElementById('pipelineChart'); if(!pipelineCanvas) return; const ctx = pipelineCanvas.getContext('2d');
  const isPieces = pipelineChartMetric === "pieces";
  const placedField = isPieces ? "placedPieces" : "placedOrders";
  const confirmedField = isPieces ? "confirmedPieces" : "confirmedOrders";
  const placedLabel = isPieces ? "Placed Pieces" : "Placed";
  const confirmedLabel = isPieces ? "Confirmed Pieces" : "Confirmed";
  if ($("pipelineChartSubtitle")) $("pipelineChartSubtitle").textContent = `${confirmedLabel} (bars) vs ${placedLabel} (line) per day tracks daily performance`;

  const dailyData = {};
  rows.forEach(r => {
    if(!r.date) return;
    if(!dailyData[r.date]) { dailyData[r.date] = { confirmed: 0, placed: 0, ts: r.timestamp }; }
    dailyData[r.date].confirmed += r[confirmedField] || 0; dailyData[r.date].placed += r[placedField] || 0;
  });
  const sortedDates = Object.keys(dailyData).sort((a, b) => dailyData[a].ts - dailyData[b].ts);
  const labels = sortedDates.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const confirmedValues = sortedDates.map(d => dailyData[d].confirmed); const placedValues = sortedDates.map(d => dailyData[d].placed);
  if (pipelineChartInst) pipelineChartInst.destroy();
  Chart.defaults.color = '#94a3b8'; Chart.defaults.font.family = 'Inter';
  pipelineChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [ { type: 'line', label: placedLabel, data: placedValues, borderColor: '#475569', borderWidth: 2, pointBackgroundColor: '#0f172a', pointBorderColor: '#475569', pointRadius: 2, pointHoverRadius: 5, fill: false, tension: 0.4, order: 1 }, { type: 'bar', label: confirmedLabel, data: confirmedValues, backgroundColor: '#3b82f6', borderRadius: 4, order: 2 } ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { backgroundColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#cbd5e1', borderColor: '#334155', borderWidth: 1, padding: 10 } }, scales: { x: { grid: { display: false, drawBorder: false } }, y: { beginAtZero: true, grid: { color: '#1e293b', borderDash: [4, 4], drawBorder: false }, ticks: { callback: (v) => v >= 1000 ? (v/1000)+'k' : v } } } }
  });
}

function renderCategoryChart(rows) {
  const catCanvas = document.getElementById('categoryChart'); if(!catCanvas) return; const ctx = catCanvas.getContext('2d');
  const catData = {}; rows.forEach(r => { if(!catData[r.category]) catData[r.category] = 0; catData[r.category] += r.confirmedOrders; });
  const sortedCats = Object.keys(catData).map(key => ({ category: key, value: catData[key] })).sort((a, b) => b.value - a.value);
  const labels = sortedCats.map(item => item.category); const dataValues = sortedCats.map(item => item.value);
  if (categoryChartInst) categoryChartInst.destroy();
  categoryChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'Confirmed Demand', data: dataValues, backgroundColor: '#8b5cf6', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#c4b5fd', borderColor: '#334155', borderWidth: 1, padding: 10, displayColors: false } }, scales: { x: { grid: { color: '#1e293b', borderDash: [4, 4], drawBorder: false }, ticks: { callback: (v) => v >= 1000 ? (v/1000)+'k' : v } }, y: { grid: { display: false, drawBorder: false }, ticks: { color: '#e2e8f0', font: { weight: '500' } } } } }
  });
}

const cm3State = { scope: "overall", period: "weekly", wired: false };
let cm3PosNegChartInst = null; let cm3ContrChartInst = null;

function fmtCm3Money(n) {
  const sign = n < 0 ? "-" : ""; const abs = Math.abs(n);
  if (abs >= 1000000) return `${sign}EGP ${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}EGP ${Math.round(abs / 1000)}K`;
  return `${sign}EGP ${Math.round(abs)}`;
}
const fmtCm3MoneyCell = (n) => wrapRawCell(n, fmtCm3Money(n));

function cm3PeriodLabel(dateObj, mode) {
  const y = dateObj.getFullYear(); const mo = dateObj.getMonth() + 1; const day = dateObj.getDate();
  if (mode === "daily") return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (mode === "monthly") return `${y}-${String(mo).padStart(2, "0")}`;
  const p = Math.min(6, Math.ceil(day / 5)); return `${y}-${String(mo).padStart(2, "0")}-P${String(p).padStart(2, "0")}`;
}

function cm3PeriodSortKey(dateObj, mode) {
  if (mode === "monthly") return dateObj.getFullYear() * 12 + dateObj.getMonth();
  if (mode === "daily") { const d = new Date(dateObj); d.setHours(0, 0, 0, 0); return d.getTime(); }
  const day = dateObj.getDate(); const p = Math.min(6, Math.ceil(day / 5));
  return (dateObj.getFullYear() * 12 + dateObj.getMonth()) * 10 + p;
}

function cm3BuildCombos(rows, periodMode) {
  let latestTs = 0; rows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
  if (!latestTs) return null;
  const latestDate = new Date(latestTs); latestDate.setHours(0, 0, 0, 0);
  const cm3Cutoff = getCm3LagCutoffTimestamp(rows); // بيانات المصدر هنا Main، فالـ CM3 لازم يرجع 4 أيام
  const comboMap = new Map();
  rows.forEach(r => {
    if (!r.timestamp || !r.merchantId || !r.sku) return;
    const rd = new Date(r.timestamp); rd.setHours(0, 0, 0, 0);
    const period = cm3PeriodLabel(rd, periodMode); const periodSort = cm3PeriodSortKey(rd, periodMode);
    const key = `${r.merchantId}||${r.sku}||${period}`;
    if (!comboMap.has(key)) { comboMap.set(key, { merchantId: r.merchantId, merchantName: r.merchantName, sku: r.sku, category: r.category, period, periodSort, placedPieces: 0, cm3: 0 }); }
    const e = comboMap.get(key); e.placedPieces += r.placedPieces;
    if (isCm3RowEligible(r, cm3Cutoff)) e.cm3 += r.cm3;
  });
  const qualifying = Array.from(comboMap.values()).filter(c => c.placedPieces >= CM3_MIN_PLACED_PIECES);
  const periodSortMap = new Map();
  qualifying.forEach(c => { if (!periodSortMap.has(c.period)) periodSortMap.set(c.period, c.periodSort); });
  const allPeriodsSorted = Array.from(periodSortMap.keys()).sort((a, b) => periodSortMap.get(a) - periodSortMap.get(b));
  // displayPeriods = كل الفترات (أيام/أسابيع/شهور) الموجودة فعليًا في الـ rows
  // اللي وصلت هنا. النطاق الزمني (شهر واحد بس، ولا كل الشهور) بقى بيتحدد من
  // فلتر الشهر اللي فوق الداشبورد (monthSelect) قبل ما البيانات توصل للدالة
  // دي أصلاً — مش بتحديد ثابت هنا على "آخر شهر في الداتا" زي ما كان قبل كده
  // (ده اللي كان بيخلي اختيار "All Months" مايفرقش حاجة مع Weekly/Daily).
  const displayPeriods = allPeriodsSorted;
  return { qualifying, allPeriodsSorted, displayPeriods, latestDate };
}

function cm3EntityKey(combo, scope) {
  if (scope === "overall") return "ALL";
  if (scope === "category") return combo.category || "Uncategorized";
  if (scope === "product") return combo.sku || "Unknown SKU";
  return `${combo.merchantId} / ${combo.merchantName || combo.merchantId}`; 
}

function cm3BuildEntityMatrix(qualifying, scope) {
  const matrix = new Map();
  if (scope === "match") {
    qualifying.forEach(c => {
      const key = `${c.merchantId}||${c.sku}`;
      if (!matrix.has(key)) matrix.set(key, {
        label: `${c.merchantName || c.merchantId} - ${c.sku}`,
        merchantId: c.merchantId, merchantName: c.merchantName || c.merchantId, sku: c.sku, category: c.category,
        periods: new Map()
      });
      const entry = matrix.get(key); entry.periods.set(c.period, (entry.periods.get(c.period) || 0) + c.cm3);
    });
  } else {
    qualifying.forEach(c => {
      const key = cm3EntityKey(c, scope);
      if (!matrix.has(key)) matrix.set(key, { label: key, periods: new Map() });
      const entry = matrix.get(key); entry.periods.set(c.period, (entry.periods.get(c.period) || 0) + c.cm3);
    });
  }
  return matrix;
}

// ---------------------------------------------------------------------
// خريطة اسم الستاتس -> اسم مفتاح details (مستخدمة في cm3ComputeTransitionRows
// وفي الدريل داون تحت الجدول). موجودة هنا فوق عشان تتشارك بين الاتنين.
// ---------------------------------------------------------------------
const CM3_STATUS_DETAIL_KEY = {
  "Turned Positive": "turnedPositive", "Turned Negative": "turnedNegative", "Became Zero": "becameZero",
  "Stayed Negative": "stayedNegative", "Stayed Positive": "stayedPositive", "New Match": "newMatch"
};

function cm3ComputeTransitionRows(matrix, allPeriodsSorted, displayPeriods) {
  return displayPeriods.map(period => {
    const periodIdx = allPeriodsSorted.indexOf(period); const prevPeriod = periodIdx > 0 ? allPeriodsSorted[periodIdx - 1] : null;
    let turnedPositive = 0, turnedNegative = 0, becameZero = 0, stayedNegative = 0, stayedPositive = 0, newMatch = 0;
    let totalNegLastPeriod = 0, cm3NegLast = 0, cm3NegThis = 0, cm3PosThisRaw = 0, cm3NegThisRaw = 0;
    // details: عشان الدريل داون تحت الجدول — لكل ستاتس، الـ entities (matches/
    // categories/products حسب الـ scope) اللي وقعت جواه في الفترة دي بالظبط،
    // بهويتهم الكاملة (Merchant/SKU/Category) وقيم الـ CM3 قبل وبعد.
    const details = { turnedPositive: [], turnedNegative: [], becameZero: [], stayedNegative: [], stayedPositive: [], newMatch: [] };
    matrix.forEach(entity => {
      const prev = prevPeriod !== null ? (entity.periods.get(prevPeriod) || 0) : 0;
      const curr = entity.periods.get(period) || 0;
      let status;
      if (prev === 0) status = "New Match"; else if (prev < 0 && curr > 0) status = "Turned Positive"; else if (prev < 0 && curr === 0) status = "Became Zero"; else if (prev < 0 && curr < 0) status = "Stayed Negative"; else if (prev >= 0 && curr >= 0) status = "Stayed Positive"; else if (prev >= 0 && curr < 0) status = "Turned Negative"; else status = "";
      if (status === "Turned Positive") turnedPositive++; else if (status === "Turned Negative") turnedNegative++; else if (status === "Became Zero") becameZero++; else if (status === "Stayed Negative") stayedNegative++; else if (status === "Stayed Positive") stayedPositive++; else if (status === "New Match") newMatch++;
      const detailKey = CM3_STATUS_DETAIL_KEY[status];
      if (detailKey) {
        details[detailKey].push({
          label: entity.label, merchantId: entity.merchantId, merchantName: entity.merchantName,
          sku: entity.sku, category: entity.category, prevCm3: prev, currCm3: curr
        });
      }
      if (prev < 0) { totalNegLastPeriod++; cm3NegLast += prev; }
      if (curr < 0 && prev !== 0) cm3NegThis += curr;
      if (curr > 0) cm3PosThisRaw += curr; if (curr < 0) cm3NegThisRaw += curr;
    });
    const actionRate = totalNegLastPeriod ? ((turnedPositive + becameZero) / totalNegLastPeriod) * 100 : null;
    const recoveryRate = totalNegLastPeriod ? (turnedPositive / totalNegLastPeriod) * 100 : null;
    const contrNeg = cm3PosThisRaw ? Math.abs(cm3NegThisRaw / cm3PosThisRaw) * 100 : 0;
    return { period, turnedPositive, turnedNegative, becameZero, stayedNegative, stayedPositive, newMatch, totalNegLastPeriod, actionRate, recoveryRate, cm3NegLast, cm3NegThis, cm3PositiveTotal: cm3PosThisRaw, cm3NegativeTotal: cm3NegThisRaw, contrNeg, details };
  });
}

function computeCm3Analysis(periodMode, scope) {
  // بيحترم فلتر الشهر (monthSelect) وفلتر الـ ACM اللي فوق الداشبورد زي أي
  // سكشن تاني — قبل كده كان بيقرأ state.allParsedRows كامل من غير فلترة
  // خالص، فاختيار "All Months" أو شهر معين ماكانش بيفرق مع السكشن ده.
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const rows = (state.allParsedRows || []).filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));
  const built = cm3BuildCombos(rows, periodMode); if (!built) return null;
  const { qualifying, allPeriodsSorted, displayPeriods, latestDate } = built;
  const matchMatrix = cm3BuildEntityMatrix(qualifying, "match");
  const matchLevelRows = cm3ComputeTransitionRows(matchMatrix, allPeriodsSorted, displayPeriods);
  let scopedRows;
  if (scope === "match" || scope === "overall") { scopedRows = matchLevelRows; } else {
    const scopedMatrix = cm3BuildEntityMatrix(qualifying, scope); scopedRows = cm3ComputeTransitionRows(scopedMatrix, allPeriodsSorted, displayPeriods);
  }
  return { displayPeriods, matchLevelRows, scopedRows, latestDate };
}

function cm3ContrBadgeClass(pct) {
  if (pct <= CM3_NEGATIVE_CONTRIBUTION_TARGET) return "ok";
  if (pct <= CM3_NEGATIVE_CONTRIBUTION_TARGET * 1.5) return "warn";
  return "bad";
}

const CM3_TABLE_COLUMNS = [
  { key: "period", label: "Period", tip: "The day/week/month being compared. Only matches with at least 10 placed pieces in the period are counted." },
  { key: "turnedPositive", label: "Turned Positive", tip: "Matches whose CM3 flipped from negative to positive vs. the prior period. CM3 excludes the most recent 5 days." },
  { key: "turnedNegative", label: "Turned Negative", tip: "Matches whose CM3 flipped from positive to negative vs. the prior period. CM3 excludes the most recent 5 days." },
  { key: "becameZero", label: "Became Zero", tip: "Matches whose CM3 went from negative to exactly zero vs. the prior period. CM3 excludes the most recent 5 days." },
  { key: "stayedNegative", label: "Stayed Negative", tip: "Matches that were negative in both the prior and current period. CM3 excludes the most recent 5 days." },
  { key: "stayedPositive", label: "Stayed Positive", tip: "Matches that stayed at zero or positive CM3 in both periods. CM3 excludes the most recent 5 days." },
  { key: "newMatch", label: "New Match", tip: "Matches with no CM3 recorded in the prior period, so they're new this period. CM3 excludes the most recent 5 days." },
  { key: "totalNegLastPeriod", label: "Total Negative in Last Period", tip: "How many matches were CM3-negative in the prior period — the base used for Action/Recovery Rate." },
  { key: "actionRate", label: "Action Rate", tip: "Share of last period's negative matches that turned positive or reached zero this period." },
  { key: "recoveryRate", label: "Recovery Rate", tip: "Share of last period's negative matches that fully turned positive this period." },
  { key: "cm3NegLast", label: "Total CM3 Negative last period", tip: "Sum of CM3 for matches that were negative in the prior period, excluding the most recent 5 days." },
  { key: "cm3NegThis", label: "Total CM3 Negative this period", tip: "Sum of CM3 for matches still negative this period (excludes matches that reached zero), 5-day cutoff applied." },
  { key: "contrNeg", label: `CONTR% -VE (Target ${CM3_NEGATIVE_CONTRIBUTION_TARGET}%)`, tip: "Negative CM3 as a share of positive CM3 this period; both figures use the 5-day CM3 cutoff." }
];

const SCOPE_TITLES = { overall: "Overall Performance", category: "Performance by Category", product: "Performance by Product", match: "Performance by Match (Product per Merchant)" };

// ---------------------------------------------------------------------
// DRILL-DOWN — بيسمح للمستخدم يدوس على أي رقم من أعمدة الستاتس (Turned
// Positive/Negative, Became Zero, Stayed Negative/Positive, New Match) في
// جدول CM3 Target ويشوف تفاصيل الـ Matches (أو الكاتيجوريز/المنتجات حسب
// الـ Grouping المختار) اللي مكوّنة الرقم ده بالظبط، في قسم منفصل تحت
// الجدول (مش Modal ولا صف بيتفتح) — cm3TableRowsCache بتحتفظ بآخر صفوف
// اتعرضت عشان الدريل داون يقدر يرجعلها لما المستخدم يدوس على رقم.
// ---------------------------------------------------------------------
let cm3TableRowsCache = [];
let cm3DrilldownState = { periodIdx: null, statusKey: null, items: [] };

function renderCm3TargetTable(rows) {
  const head = $("cm3TargetTableHead"); const body = $("cm3TargetTableBody"); if (!head || !body) return;
  cm3TableRowsCache = rows || [];
  hideCm3Drilldown();
  head.innerHTML = CM3_TABLE_COLUMNS.map(c => `<th class="${c.key === "period" ? "" : "num"}" title="${(c.tip || "").replace(/"/g, "&quot;")}">${c.label}</th>`).join("");
  body.innerHTML = "";
  if (!rows || rows.length === 0) { body.innerHTML = `<tr><td colspan="${CM3_TABLE_COLUMNS.length}" class="text-dim center">No qualifying data for this range.</td></tr>`; return; }
  // بادج قابل للدوس عليه — بيحمل data-status (مفتاح details) + data-period-idx
  // (انديكس الصف في cm3TableRowsCache) عشان cm3TargetBodyClickHandler يعرف
  // يجيب التفاصيل الصح لما يتدوس عليه.
  const clickableBadge = (periodIdx, statusKey, cls, value) =>
    `<span class="badge-status ${cls} cm3-badge-clickable" data-period-idx="${periodIdx}" data-status="${statusKey}" title="اضغط لعرض تفاصيل الـ Matches">${fmtIntCell(value)}</span>`;
  rows.forEach((r, idx) => {
    const tr = document.createElement("tr"); const contrClass = cm3ContrBadgeClass(r.contrNeg);
    tr.innerHTML = `
      <td class="cm3-period-cell">${r.period}</td>
      <td class="num">${clickableBadge(idx, "turnedPositive", "turned-positive", r.turnedPositive)}</td>
      <td class="num">${clickableBadge(idx, "turnedNegative", "turned-negative", r.turnedNegative)}</td>
      <td class="num">${clickableBadge(idx, "becameZero", "became-zero", r.becameZero)}</td>
      <td class="num">${clickableBadge(idx, "stayedNegative", "stayed-negative", r.stayedNegative)}</td>
      <td class="num">${clickableBadge(idx, "stayedPositive", "stayed-positive", r.stayedPositive)}</td>
      <td class="num">${clickableBadge(idx, "newMatch", "new-match", r.newMatch)}</td>
      <td class="num text-dim font-bold">${fmtIntCell(r.totalNegLastPeriod)}</td>
      <td class="num font-bold ${r.actionRate === null ? "text-dim" : "text-blue"}">${r.actionRate === null ? "-" : fmtPctCell(r.actionRate)}</td>
      <td class="num font-bold ${r.recoveryRate === null ? "text-dim" : "text-green"}">${r.recoveryRate === null ? "-" : fmtPctCell(r.recoveryRate)}</td>
      <td class="num text-red">${fmtCm3MoneyCell(r.cm3NegLast)}</td>
      <td class="num text-red">${fmtCm3MoneyCell(r.cm3NegThis)}</td>
      <td class="num"><span class="contr-pill ${contrClass}">${fmtPctCell(r.contrNeg)}</span></td>
    `;
    body.appendChild(tr);
  });
}

const CM3_STATUS_LABELS = {
  turnedPositive: "Turned Positive", turnedNegative: "Turned Negative", becameZero: "Became Zero",
  stayedNegative: "Stayed Negative", stayedPositive: "Stayed Positive", newMatch: "New Match"
};

function hideCm3Drilldown() {
  cm3DrilldownState = { periodIdx: null, statusKey: null, items: [] };
  const section = $("cm3DrilldownSection");
  if (section) section.classList.add("hidden");
}

function showCm3Drilldown(periodIdx, statusKey) {
  const row = cm3TableRowsCache[periodIdx];
  const section = $("cm3DrilldownSection");
  if (!row || !row.details || !section) return;
  const items = row.details[statusKey] || [];
  cm3DrilldownState = { periodIdx, statusKey, items };
  if ($("cm3DrilldownTitle")) $("cm3DrilldownTitle").textContent = `${CM3_STATUS_LABELS[statusKey] || statusKey} — ${row.period}`;
  if ($("cm3DrilldownSub")) $("cm3DrilldownSub").textContent = `${fmtInt.format(items.length)} match(es) — دي التفاصيل اللي مكوّنة الرقم ده في جدول CM3 Target`;
  if ($("cm3DrilldownSearch")) $("cm3DrilldownSearch").value = "";
  renderCm3DrilldownTable(items);
  section.classList.remove("hidden");
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderCm3DrilldownTable(items) {
  const body = $("cm3DrilldownTableBody"); if (!body) return;
  if (!items || items.length === 0) { body.innerHTML = `<tr><td colspan="5" class="text-dim center">No matches for this status in this period.</td></tr>`; return; }
  body.innerHTML = items.map(it => `
    <tr>
      <td>${it.merchantName || it.label || "-"}</td>
      <td class="font-mono text-dim">${it.sku || "-"}</td>
      <td>${it.category || "-"}</td>
      <td class="num text-red">${fmtCm3MoneyCell(it.prevCm3)}</td>
      <td class="num ${it.currCm3 >= 0 ? "text-green" : "text-red"}">${fmtCm3MoneyCell(it.currCm3)}</td>
    </tr>
  `).join("");
}

function applyCm3DrilldownSearch() {
  const q = $("cm3DrilldownSearch") ? $("cm3DrilldownSearch").value.trim().toLowerCase() : "";
  const items = cm3DrilldownState.items || [];
  if (!q) { renderCm3DrilldownTable(items); return; }
  const filtered = items.filter(it =>
    (it.merchantName && it.merchantName.toLowerCase().includes(q)) ||
    (it.sku && it.sku.toLowerCase().includes(q)) ||
    (it.category && it.category.toLowerCase().includes(q)) ||
    (it.label && it.label.toLowerCase().includes(q))
  );
  renderCm3DrilldownTable(filtered);
}

let cm3DrilldownWired = false;
function cm3WireDrilldownOnce() {
  if (cm3DrilldownWired) return; cm3DrilldownWired = true;
  const body = $("cm3TargetTableBody");
  if (body) {
    body.addEventListener("click", (e) => {
      const el = e.target.closest(".cm3-badge-clickable");
      if (!el) return;
      const periodIdx = Number(el.dataset.periodIdx);
      const statusKey = el.dataset.status;
      if (Number.isNaN(periodIdx) || !statusKey) return;
      showCm3Drilldown(periodIdx, statusKey);
    });
  }
  if ($("cm3DrilldownClose")) $("cm3DrilldownClose").addEventListener("click", hideCm3Drilldown);
  if ($("cm3DrilldownSearch")) $("cm3DrilldownSearch").addEventListener("input", applyCm3DrilldownSearch);
}

function renderCm3Charts(overallRows) {
  const posNegCanvas = document.getElementById("cm3PosNegChart"); const contrCanvas = document.getElementById("cm3ContrChart");
  if (!posNegCanvas || !contrCanvas || typeof Chart === "undefined") return;
  const labels = overallRows.map(r => r.period); const posValues = overallRows.map(r => r.cm3PositiveTotal); const negValues = overallRows.map(r => r.cm3NegativeTotal); const contrValues = overallRows.map(r => r.contrNeg);
  if (cm3PosNegChartInst) cm3PosNegChartInst.destroy();
  cm3PosNegChartInst = new Chart(posNegCanvas.getContext("2d"), {
    type: "bar", data: { labels, datasets: [ { label: "Positive CM3", data: posValues, backgroundColor: "#10b981", borderRadius: 4 }, { label: "Negative CM3", data: negValues, backgroundColor: "#ef4444", borderRadius: 4 } ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } }, scales: { x: { grid: { display: false, drawBorder: false }, stacked: false }, y: { grid: { color: "#1e293b", borderDash: [4, 4], drawBorder: false }, ticks: { callback: v => fmtCm3Money(v) } } } }
  });
  if (cm3ContrChartInst) cm3ContrChartInst.destroy();
  cm3ContrChartInst = new Chart(contrCanvas.getContext("2d"), {
    type: "line", data: { labels, datasets: [ { label: "CONTR% -VE", data: contrValues, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.15)", fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: "#f59e0b" }, { label: `Target ${CM3_NEGATIVE_CONTRIBUTION_TARGET}%`, data: labels.map(() => CM3_NEGATIVE_CONTRIBUTION_TARGET), borderColor: "#ef4444", borderDash: [6, 4], pointRadius: 0, fill: false } ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } }, scales: { x: { grid: { display: false, drawBorder: false } }, y: { beginAtZero: true, grid: { color: "#1e293b", borderDash: [4, 4], drawBorder: false }, ticks: { callback: v => v + "%" } } } }
  });
}

function renderCm3Cards(overallRows, periodMode, displayPeriods) {
  // للـ Weekly/Daily: آخر فترة (Period) ممكن تكون لسه جديدة جدًا وبياناتها لسه
  // معدتش كات أوف الـ CM3 (CM3_LAG_DAYS = 4 أيام)، فبتظهر كلها أصفار مع إنها
  // مش فعليًا "مفيش فيها بيانات" — هي بس لسه بدري عليها. فبدل ما نعرض آخر
  // فترة في القايمة عمياني، بندور من الآخر لقدام على آخر فترة فيها أرقام
  // فعلاً (Positive أو Negative CM3 ≠ صفر) ونعرض دي. الـ Monthly مبيتغيرش
  // فيها حاجة — بتفضل زي ما هي دايمًا آخر شهر في القايمة.
  let last = null;
  if (periodMode === "monthly") {
    last = overallRows.length ? overallRows[overallRows.length - 1] : null;
  } else {
    for (let i = overallRows.length - 1; i >= 0; i--) {
      if (overallRows[i].cm3PositiveTotal !== 0 || overallRows[i].cm3NegativeTotal !== 0) { last = overallRows[i]; break; }
    }
    if (!last) last = overallRows.length ? overallRows[overallRows.length - 1] : null;
  }
  const totalPos = last ? last.cm3PositiveTotal : 0; const totalNeg = last ? last.cm3NegativeTotal : 0; const contr = last ? last.contrNeg : 0;
  if ($("cm3TotalVal")) $("cm3TotalVal").textContent = fmtCm3Money(totalPos + totalNeg);
  if ($("cm3PositiveVal")) $("cm3PositiveVal").textContent = fmtCm3Money(totalPos);
  if ($("cm3NegativeVal")) $("cm3NegativeVal").textContent = fmtCm3Money(totalNeg);
  if ($("cm3ContrVal")) $("cm3ContrVal").textContent = fmtPct(contr);
  if ($("cm3TotalSub")) $("cm3TotalSub").textContent = last ? `Latest period: ${last.period}` : "No data";
  const bar = $("cm3ContrBar");
  if (bar) { bar.style.width = `${Math.min(contr, 100)}%`; bar.className = "progress-fill"; bar.classList.add(contr <= CM3_NEGATIVE_CONTRIBUTION_TARGET ? "green" : (contr <= CM3_NEGATIVE_CONTRIBUTION_TARGET * 1.5 ? "orange" : "red")); }
  const rangeLabel = $("cm3RangeLabel");
  if (rangeLabel) {
    if (!displayPeriods.length) { rangeLabel.textContent = "No data"; }
    else { rangeLabel.textContent = `${displayPeriods[0]} - ${displayPeriods[displayPeriods.length - 1]}`; }
  }
}

function renderCm3OverallTable(rows) {
  const head = $("cm3TargetTableHead"); const body = $("cm3TargetTableBody"); if (!head || !body) return;
  head.innerHTML = `<th>Period</th><th class="num">Positive CM3</th><th class="num">Negative CM3</th><th class="num">CONTR% -VE (Target ${CM3_NEGATIVE_CONTRIBUTION_TARGET}%)</th>`; body.innerHTML = "";
  if (!rows || rows.length === 0) { body.innerHTML = `<tr><td colspan="4" class="text-dim center">No qualifying data for this range.</td></tr>`; return; }
  rows.forEach(r => {
    const contrClass = cm3ContrBadgeClass(r.contrNeg); const tr = document.createElement("tr");
    tr.innerHTML = `<td class="cm3-period-cell">${r.period}</td><td class="num text-green font-bold">${fmtCm3MoneyCell(r.cm3PositiveTotal)}</td><td class="num text-red font-bold">${fmtCm3MoneyCell(r.cm3NegativeTotal)}</td><td class="num"><span class="contr-pill ${contrClass}">${fmtPctCell(r.contrNeg)}</span></td>`;
    body.appendChild(tr);
  });
}

// -------------------------------------------------------------------------
// TARGETS COMMERCIAL — Target (state.commercialTargets, من CAT_TARGETS_GID)
// مقابل Actual (محسوبة لايف من MAIN_GID عبر computeCommercialActuals).
// -------------------------------------------------------------------------
const TC_CATEGORY_LABELS = { consumables: "Consumables", electronics: "Electronics", fashion: "Fashion", home: "Home", leisure: "Leisure", "grand total": "Grand Total" };
// نفس ترتيب وأسماء أعمدة شيت Targets_CAT بالظبط — أي حاجة مش موجودة في
// الشيت اتشالت من هنا (زي NDR%, Revenue, CR/DR/NDR Rev%, Placed/Confirmed/
// Delivered Daily لوحدهم)، وأي حاجة جديدة في الشيت (Count of SKUs,
// Contribution %, Refund Rate, Net Delivered After Refund, CM3/Piece,
// PPM/Piece, PPM%) اتضافت. اللي معندوش عمود Actual مقابل (a: null) معندوش
// مصدر بيانات لايف حالياً (زي الـ Refund/Net-After-Refund، مفيش عمود ريفند
// في شيت الـ Main) فبيظهر كـ "—" في عمود Actual.
const TC_METRIC_ROWS = [
  { label: "Count of SKUs", t: "skuCountTarget", a: "skuCount", fmt: "int" },
  { label: "Daily Target (Pcs/day)", t: "targetPlacedDaily", a: "confirmedDaily", fmt: "int" },
  { label: "Total Placed (Pcs)", t: "placedPiecesTarget", a: "placed", fmt: "int" },
  { label: "Contribution %", t: "targetContribution", a: "contribution", fmt: "pct" },
  { label: "Total Confirmed (Pcs)", t: "plannedCnfPieces", a: "confirmed", fmt: "int" },
  { label: "CR %", t: "targetCr", a: "crPct", fmt: "pct" },
  { label: "Total Delivered (Pcs)", t: "dlvPiecesTarget", a: "delivered", fmt: "int" },
  { label: "DR %", t: "targetDr", a: "drPct", fmt: "pct" },
  { label: "ASP", t: "aspDlvPlanned", a: "aspDlv", fmt: "money" },
  { label: "Total Delivered GMV", t: "targetGmv", a: "gmv", fmt: "money" },
  { label: "Refund Rate", t: "targetRefundRate", a: null, fmt: "pct" },
  { label: "Net Delivered (Pcs) After Refund", t: "netDlvPiecesTarget", a: null, fmt: "int" },
  { label: "Net Delivered GMV After Refund", t: "netDlvGmvTarget", a: null, fmt: "money" },
  { label: "CM3", t: "targetCm3", a: "cm3", fmt: "money" },
  { label: "CM3/Piece", t: "targetCm3PerPiece", a: "cm3PerPiece", fmt: "money" },
  { label: "CM3 %", t: "targetCm3Pct", a: "cm3Pct", fmt: "pct" },
  { label: "PPM", t: "targetPpm", a: "ppm", fmt: "money" },
  { label: "PPM/Piece", t: "targetPpmPerPiece", a: "ppmPerPiece", fmt: "money" },
  { label: "PPM %", t: "targetPpmPct", a: "ppmPct", fmt: "pct" }
];
function tcFmtValue(v, fmt) {
  if (v === null || v === undefined) return "—";
  if (fmt === "pct") return fmtPctCell(v);
  if (fmt === "money") return fmtMoneyCompactCell(v);
  return fmtIntCell(Math.round(v));
}
function tcAchievementBadge(achPct) {
  if (achPct === null) return { cls: "orange", text: "N/A" };
  if (achPct >= 100) return { cls: "green", text: "On Target" };
  if (achPct >= 85) return { cls: "orange", text: "Near Target" };
  return { cls: "red", text: "Below Target" };
}
function renderTargetsCommercialTable(targetRow, actualRow) {
  const body = $("tcTableBody"); if (!body) return;
  body.innerHTML = "";
  TC_METRIC_ROWS.forEach(row => {
    const targetVal = targetRow ? (targetRow[row.t] || 0) : 0;
    const actualVal = (row.a && actualRow) ? (actualRow[row.a] || 0) : null;
    const achPct = (!row.noAch && actualVal !== null && targetVal) ? (actualVal / targetVal) * 100 : null;
    const badge = tcAchievementBadge(achPct);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-bold text-light">${row.label}</td>
      <td class="num text-dim">${tcFmtValue(targetVal, row.tFmt || row.fmt)}</td>
      <td class="num font-bold">${tcFmtValue(actualVal, row.fmt)}</td>
      <td class="num">${achPct === null ? "—" : `<span class="badge-outline ${badge.cls}">${fmtPctCell(achPct)}</span>`}</td>
      <td class="center">${achPct === null ? `<span class="badge-status stable">N/A</span>` : `<span class="badge-status ${badge.cls === 'green' ? 'spike' : (badge.cls === 'red' ? 'decline' : 'stable')}">${badge.text}</span>`}</td>
    `;
    body.appendChild(tr);
  });
}
function tcUpdateKpiCard(prefix, targetPct, actualPct) {
  if ($(prefix + "Target")) $(prefix + "Target").textContent = `Target ${fmtPct(targetPct || 0)}`;
  if ($(prefix + "Val")) $(prefix + "Val").textContent = fmtPct(actualPct || 0);
  const bar = $(prefix + "Bar");
  if (bar) {
    const width = targetPct ? Math.min(100, (actualPct / targetPct) * 100) : 0;
    bar.style.width = `${Math.max(0, width)}%`;
    bar.className = "progress-fill " + (targetPct && actualPct >= targetPct ? "green" : (targetPct && actualPct >= targetPct * 0.85 ? "orange" : "red"));
  }
}
function renderTargetsCommercialView() {
  const cat = state.tcCategory || "grand total";
  const targetRow = state.commercialTargets ? state.commercialTargets[cat] : null;
  const actuals = computeCommercialActuals(state.allParsedRows || []);
  const actualRow = actuals[cat];

  if ($("tcTableTitle")) $("tcTableTitle").textContent = `Targets Commercial — ${TC_CATEGORY_LABELS[cat] || cat}`;
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  if ($("tcRangeLabel")) $("tcRangeLabel").textContent = selectedMonth || "All Time";

  tcUpdateKpiCard("tcCr", targetRow ? targetRow.targetCr : 0, actualRow ? actualRow.crPct : 0);
  tcUpdateKpiCard("tcDr", targetRow ? targetRow.targetDr : 0, actualRow ? actualRow.drPct : 0);
  tcUpdateKpiCard("tcCm3Pct", targetRow ? targetRow.targetCm3Pct : 0, actualRow ? actualRow.cm3Pct : 0);
  tcUpdateKpiCard("tcPpmPct", targetRow ? targetRow.targetPpmPct : 0, actualRow ? actualRow.ppmPct : 0);

  renderTargetsCommercialTable(targetRow, actualRow);
  tcWireControlsOnce();
}
let tcControlsWired = false;
function tcWireControlsOnce() {
  if (tcControlsWired) return; tcControlsWired = true;
  document.querySelectorAll("#tcCategoryToggle .segmented-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#tcCategoryToggle .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.tcCategory = btn.dataset.cat;
      renderTargetsCommercialView();
    });
  });
}

function renderCm3TargetView() {
  const analysis = computeCm3Analysis(cm3State.period, cm3State.scope);
  if ($("cm3TableTitle")) $("cm3TableTitle").textContent = `CM3 Target - ${SCOPE_TITLES[cm3State.scope]}`;
  if ($("cm3TableSub")) { $("cm3TableSub").textContent = cm3State.scope === "overall" ? "Total qualifying CM3 (Positive vs Negative) per period" : "Period-over-period status transitions"; }
  hideCm3Drilldown();
  if (!analysis) { renderCm3TargetTable([]); return; }
  renderCm3Cards(analysis.matchLevelRows, cm3State.period, analysis.displayPeriods);
  renderCm3Charts(analysis.matchLevelRows);
  if (cm3State.scope === "overall") renderCm3OverallTable(analysis.scopedRows); else renderCm3TargetTable(analysis.scopedRows);
  cm3WireControlsOnce();
  cm3WireDrilldownOnce();
}

function cm3WireControlsOnce() {
  if (cm3State.wired) return; cm3State.wired = true;
  document.querySelectorAll("#cm3ScopeToggle .segmented-btn").forEach(btn => { btn.addEventListener("click", () => { document.querySelectorAll("#cm3ScopeToggle .segmented-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); cm3State.scope = btn.dataset.scope; renderCm3TargetView(); }); });
  document.querySelectorAll("#cm3PeriodToggle .segmented-btn").forEach(btn => { btn.addEventListener("click", () => { document.querySelectorAll("#cm3PeriodToggle .segmented-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); cm3State.period = btn.dataset.period; renderCm3TargetView(); }); });
}

function renderCm3AnalystHeaders() {
  const thead = $("analystTableHead"); if(!thead) return;
  let html = "<tr>";
  if(analystState.scope === "merchant") {
    html += `<th data-akey="index" title="Row number in the current sort order.">#</th><th data-akey="id" title="Unique merchant identifier.">Merchant ID</th><th data-akey="name" title="Merchant's display name.">Merchant Name</th><th data-akey="placedPieces" class="num" title="Total pieces placed by this merchant. No cutoff applied.">Total Placed</th><th data-akey="confirmedPieces" class="num" title="Total pieces confirmed by this merchant. No cutoff applied.">Total Confirmed</th><th data-akey="deliveredPieces" class="num" title="Total pieces delivered by this merchant. No cutoff applied.">Total Delivered</th><th data-akey="cr" class="num" title="Confirmed ÷ Placed for this merchant. No cutoff applied.">CR%</th><th data-akey="dr" class="num" title="Delivered ÷ Confirmed for this merchant. No cutoff applied.">DR%</th><th data-akey="ndr" class="num" title="CR% × DR% combined delivery rate for this merchant.">NDR%</th><th data-akey="deliveredGmv" class="num" title="Total delivered order value for this merchant. No cutoff applied.">Delivered GMV</th><th data-akey="cm3" class="num" title="Merchant's total CM3, excluding the most recent 5 days of data.">Total CM3</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;" title="CM3 as a share of Delivered GMV; both use the 5-day CM3 cutoff.">CM3 %</th><th class="center" title="Profitability badge derived from CM3 %, so it reflects the same 5-day cutoff.">Status</th>`;
  } else if(analystState.scope === "category") {
    html += `<th data-akey="index" title="Row number in the current sort order.">#</th><th data-akey="category" title="Product category name.">Category</th><th data-akey="targetCm3" class="num text-dim" title="Planned CM3 target for this category.">Target CM3</th><th data-akey="cm3" class="num" title="Actual CM3 for this category, excluding the most recent 5 days of data.">Actual CM3</th><th data-akey="targetCm3PerPiece" class="num text-dim" title="Planned CM3-per-delivered-piece target for this category.">Target CM3/Pc</th><th data-akey="cm3PerPiece" class="num" title="Actual CM3 per delivered piece; both use the 5-day cutoff so they line up.">Actual CM3/Pc</th><th data-akey="targetCm3Pct" class="num text-dim" title="Planned CM3 margin target for this category.">Target CM3 %</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;" title="Actual CM3 as a share of Delivered GMV, using the 5-day CM3 cutoff.">Actual CM3 %</th><th class="center" title="Profitability badge derived from Actual CM3 %, reflecting the same 5-day cutoff.">Status</th>`;
  } else if(analystState.scope === "match") {
    html += `<th data-akey="index" title="Row number in the current sort order.">#</th><th data-akey="id" title="Unique merchant identifier.">Merchant ID</th><th data-akey="name" class="truncate-cell" title="Merchant's display name.">Merchant Name</th><th data-akey="sku" title="SKU code for this merchant-product match.">Product ID</th><th data-akey="skuName" class="truncate-cell" title="SKU display name.">Product Name</th><th data-akey="category" class="text-dim" title="Product category for this match.">Category</th><th data-akey="placedPieces" class="num" title="Total pieces placed for this match. No cutoff applied.">Total Placed</th><th data-akey="confirmed" class="num" title="Total pieces confirmed for this match. No cutoff applied.">Total Confirmed</th><th data-akey="delivered" class="num" title="Total pieces delivered for this match. No cutoff applied.">Total Delivered</th><th data-akey="cm3" class="num" title="This match's total CM3, excluding the most recent 5 days of data.">Total CM3</th><th data-akey="cm3PerPiece" class="num" title="CM3 per delivered piece; both figures use the same 5-day CM3 cutoff.">CM3 / Pc</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;" title="CM3 as a share of Delivered GMV, both using the 5-day CM3 cutoff.">CM3 %</th><th class="center" title="Profitability badge derived from CM3 %, reflecting the same 5-day cutoff.">Status</th>`;
  }
  html += "</tr>";
  thead.innerHTML = html;
  thead.querySelectorAll("th[data-akey]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.akey; if(key === "index") return;
      if(analystState.sortKey === key) { analystState.sortDir = analystState.sortDir === "asc" ? "desc" : "asc"; } else { analystState.sortKey = key; analystState.sortDir = "desc"; }
      applyCm3AnalystSearchAndSort();
    });
  });
}

// الصفحة دي (CM3 Analyst) بقت شغالة بمنطق كات أوف مختلف عن قبل، بطلب صريح:
//  • Placed / Confirmed / Delivered (أوردرات وقطع) + Delivered GMV (كعمود/
//    كارت مستقل) = من غير أي كات أوف خالص، الفترة/الشهر المفلتر كله كامل
//    (زي أي مكان تاني في الداشبورد بياخد Placed/Confirmed/Delivered من غير
//    لاج). CR%/DR%/NDR% بالتبعية بقوا من غير كات أوف برضو لأنهم متبنيين
//    على الأرقام دي.
//  • CM3 لوحدها لسه بتاخد كات أوف الـ CM3 (CM3_LAG_DAYS) عادي زي ما هي.
//  • CM3/Pc و CM3% — كل واحد فيهم بياخد نفس الكات أوف اللي بتاخده الـ CM3
//    نفسها في المقام بتاعه بالظبط: CM3/Pc بيتقسم على Delivered Pcs من نفس
//    الصفوف اللي عدت كات أوف الـ CM3 (مش إجمالي Delivered Pcs من غير كات
//    أوف)، وCM3% بيتقسم على Delivered GMV من نفس الصفوف كمان — عشان
//    البسط والمقام في النسبتين دول يفضلوا من نفس الفترة المقطوعة بالظبط.
function prepareCm3AnalystData(rows) {
  const map = new Map(); let totalGmv = 0; let totalCm3 = 0; let totalCm3Gmv = 0;
  const cm3Cutoff = getCm3LagCutoffTimestamp(rows);

  const keyFor = (r) => {
    if (analystState.scope === "merchant") return r.merchantId;
    if (analystState.scope === "category") return r.category;
    if (analystState.scope === "match") return r.merchantId + "||" + r.sku;
    return "";
  };
  const getEntry = (key, r) => {
    let e = map.get(key);
    if (!e) {
      e = {
        id: r.merchantId, name: r.merchantName || r.merchantId, sku: r.sku,
        skuName: (state.inventoryMap[r.sku] ? state.inventoryMap[r.sku].skuName : "Unknown"), category: r.category,
        placed: 0, confirmed: 0, delivered: 0, placedPieces: 0, confirmedPieces: 0, deliveredPieces: 0, deliveredGmv: 0,
        cm3: 0, cm3Gmv: 0, cm3DeliveredPieces: 0
      };
      map.set(key, e);
    }
    return e;
  };

  // Placed / Confirmed / Delivered / Delivered GMV — من غير أي كات أوف خالص.
  rows.forEach(r => {
    const key = keyFor(r);
    if (!key || key === "Unassigned") return;
    const entry = getEntry(key, r);
    entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders;
    entry.placedPieces += (r.placedPieces || r.placedOrders); entry.confirmedPieces += (r.confirmedPieces || r.confirmedOrders); entry.deliveredPieces += (r.deliveredPieces || r.deliveredOrders);
    entry.deliveredGmv += r.deliveredGmv;
    totalGmv += r.deliveredGmv;
  });

  // CM3 (وCM3/Pc وCM3% اللي مبنيين عليها) — بس من الصفوف اللي عدت كات أوف الـ CM3.
  rows.forEach(r => {
    if (!isCm3RowEligible(r, cm3Cutoff)) return;
    const key = keyFor(r);
    if (!key || key === "Unassigned") return;
    const entry = getEntry(key, r);
    entry.cm3 += r.cm3;
    entry.cm3Gmv += r.deliveredGmv;
    entry.cm3DeliveredPieces += (r.deliveredPieces || r.deliveredOrders);
    totalCm3 += r.cm3;
    totalCm3Gmv += r.deliveredGmv;
  });

  analystState.data = Array.from(map.values()).map(m => {
    const cr = m.placed ? (m.confirmed / m.placed) : 0; const dr = m.confirmed ? (m.delivered / m.confirmed) : 0; const ndr = dr * cr;
    const cm3Pct = m.cm3Gmv ? (m.cm3 / m.cm3Gmv) * 100 : 0;
    const cm3PerPiece = m.cm3DeliveredPieces ? (m.cm3 / m.cm3DeliveredPieces) : 0;
    const normalizedCategory = (m.category || "").trim().toLowerCase();
    const catTarget = state.categoryTargets[normalizedCategory] || { targetCm3: 0, targetCm3PerPiece: 0, targetCm3Pct: 0 };
    return { ...m, cr: cr * 100, dr: dr * 100, ndr: ndr * 100, cm3Pct, cm3PerPiece, targetCm3: catTarget.targetCm3, targetCm3PerPiece: catTarget.targetCm3PerPiece, targetCm3Pct: catTarget.targetCm3Pct };
  });
  if($("analystTotalGmv")) $("analystTotalGmv").textContent = fmtMoneyCompact(totalGmv);
  if($("analystTotalCm3")) $("analystTotalCm3").textContent = fmtMoneyCompact(totalCm3);
  if($("analystOverallCm3Pct")) $("analystOverallCm3Pct").textContent = fmtPct(totalCm3Gmv ? (totalCm3/totalCm3Gmv)*100 : 0);
  let topEntity = "-";
  if(analystState.data.length > 0) {
    const sorted = [...analystState.data].sort((a,b) => b.cm3 - a.cm3);
    if(analystState.scope === "merchant") topEntity = sorted[0].name; else if(analystState.scope === "category") topEntity = sorted[0].category; else if(analystState.scope === "match") topEntity = sorted[0].name + " - " + sorted[0].skuName;
  }
  if($("analystTopEntity")) $("analystTopEntity").textContent = topEntity;
  renderCm3AnalystHeaders(); applyCm3AnalystSearchAndSort();
}

function getCm3ProfitBadge(pct) {
  if (pct > 15) return '<span class="badge-outline green">Highly Profitable</span>';
  if (pct >= 5) return '<span class="badge-outline blue">Moderate</span>';
  if (pct >= 0) return '<span class="badge-outline orange">Low Margin</span>';
  return '<span class="badge-outline red">Loss Maker</span>';
}

function applyCm3AnalystSearchAndSort() {
  const term = $("searchAnalystInput") ? $("searchAnalystInput").value.trim().toLowerCase() : "";
  analystState.filtered = analystState.data.filter(m => { if (!term) return true; return (m.name && m.name.toLowerCase().includes(term)) || (m.id && String(m.id).toLowerCase().includes(term)) || (m.sku && String(m.sku).toLowerCase().includes(term)) || (m.skuName && m.skuName.toLowerCase().includes(term)) || (m.category && m.category.toLowerCase().includes(term)); });
  const { sortKey, sortDir } = analystState; const dir = sortDir === "asc" ? 1 : -1;
  analystState.filtered.sort((a, b) => { const av = a[sortKey]; const bv = b[sortKey]; if (typeof av === "string") return av.localeCompare(bv) * dir; return (av - bv) * dir; });
  analystState.page = 0; renderPaginatedCm3AnalystTable();
}

function renderPaginatedCm3AnalystTable() {
  const tbody = $("analystTableBody"); if(!tbody) return; tbody.innerHTML = "";
  const start = analystState.page * PAGE_SIZE; const pageRows = analystState.filtered.slice(start, start + PAGE_SIZE);
  pageRows.forEach((m, idx) => {
    let progressColor = "blue";
    if (m.cm3Pct > 15) progressColor = "green"; else if (m.cm3Pct >= 5) progressColor = "blue"; else if (m.cm3Pct >= 0) progressColor = "orange"; else progressColor = "red";
    let barWidth = Math.min(Math.abs(m.cm3Pct), 100); const tr = document.createElement("tr");
    
    if(analystState.scope === "merchant") {
      tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id}</td><td class="font-bold text-light">${m.name}</td><td class="num font-bold">${fmtIntCell(m.placedPieces)}</td><td class="num text-blue">${fmtIntCell(m.confirmedPieces)}</td><td class="num text-green">${fmtIntCell(m.deliveredPieces)}</td><td class="num"><span class="badge-outline ${getCrBadgeColor(m.cr)}">${fmtPctCell(m.cr)}</span></td><td class="num text-dim">${fmtPctCell(m.dr)}</td><td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPctCell(m.ndr)}</span></td><td class="num font-bold text-dim">${fmtMoneyCompactCell(m.deliveredGmv)}</td><td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompactCell(m.cm3)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPctCell(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td><td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>`;
    } else if(analystState.scope === "category") {
      tr.innerHTML = `
        <td class="text-dim">#${start + idx + 1}</td>
        <td class="font-bold text-light">${m.category}</td>
        <td class="num text-dim">${m.targetCm3 > 0 ? fmtMoneyCompactCell(m.targetCm3) : '-'}</td>
        <td class="num font-bold ${m.cm3 >= m.targetCm3 && m.targetCm3 > 0 ? 'text-green' : (m.cm3 >= 0 ? 'text-blue' : 'text-red')}">${fmtMoneyCompactCell(m.cm3)}</td>
        <td class="num text-dim">${m.targetCm3PerPiece > 0 ? fmtMoneyCompactCell(m.targetCm3PerPiece) : '-'}</td>
        <td class="num font-bold ${m.cm3PerPiece >= m.targetCm3PerPiece && m.targetCm3PerPiece > 0 ? 'text-green' : 'text-dim'}">${fmtMoneyCompactCell(m.cm3PerPiece)}</td>
        <td class="num text-dim">${m.targetCm3Pct > 0 ? m.targetCm3Pct.toFixed(1) + '%' : '-'}</td>
        <td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPctCell(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td>
        <td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>
      `;
    } else if(analystState.scope === "match") {
      tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id}</td><td class="font-bold text-light truncate-cell" title="${m.name}">${m.name}</td><td class="font-mono text-dim">${m.sku}</td><td class="text-dim truncate-cell" title="${m.skuName}">${m.skuName}</td><td class="text-dim">${m.category}</td><td class="num font-bold">${fmtIntCell(m.placedPieces)}</td><td class="num text-blue">${fmtIntCell(m.confirmed)}</td><td class="num text-green">${fmtIntCell(m.delivered)}</td><td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompactCell(m.cm3)}</td><td class="num font-bold">${fmtMoneyCompactCell(m.cm3PerPiece)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPctCell(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td><td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>`;
    }
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(analystState.filtered.length / PAGE_SIZE));
  if($("rowCountAnalyst")) $("rowCountAnalyst").textContent = `${fmtInt.format(analystState.filtered.length)} Entities`;
  if($("pageIndicatorAnalyst")) $("pageIndicatorAnalyst").textContent = `Page ${analystState.page + 1} of ${totalPages}`;
  if($("prevPageAnalyst")) $("prevPageAnalyst").disabled = analystState.page === 0;
  if($("nextPageAnalyst")) $("nextPageAnalyst").disabled = analystState.page >= totalPages - 1;
  document.querySelectorAll("#analystTableHead th").forEach((th) => { if(th.dataset.akey) th.classList.toggle("sorted", th.dataset.akey === analystState.sortKey); });
}

// الجدول ده لازم يحترم فلتر الشهر/الـ ACM اللي فوق الصفحة زي أي قسم تاني — فبنفلتر
// state.allParsedRows هنا بنفس منطق applyFilters() قبل ما نبني منها التحليل، عشان
// لو غيرت الشهر فوق (أو الـ ACM) الأرقام (ACTUAL CM3 / CM3 PER PIECE / CM3 %) تتغير معاه.
function renderCm3AnalystView() {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const filteredRows = state.allParsedRows.filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));
  prepareCm3AnalystData(filteredRows);
  analystWireControlsOnce();
}

function analystWireControlsOnce() {
  if (analystState.wired) return; analystState.wired = true;
  document.querySelectorAll("#analystScopeToggle .segmented-btn").forEach(btn => { btn.addEventListener("click", () => { document.querySelectorAll("#analystScopeToggle .segmented-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); analystState.scope = btn.dataset.scope; renderCm3AnalystView(); }); });
  if($("searchAnalystInput")) { $("searchAnalystInput").addEventListener("input", applyCm3AnalystSearchAndSort); }
  if($("prevPageAnalyst")) { $("prevPageAnalyst").addEventListener("click", () => { if (analystState.page > 0) { analystState.page -= 1; renderPaginatedCm3AnalystTable(); } }); }
  if($("nextPageAnalyst")) { $("nextPageAnalyst").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(analystState.filtered.length / PAGE_SIZE)); if (analystState.page < totalPages - 1) { analystState.page += 1; renderPaginatedCm3AnalystTable(); } }); }
}
// -------------------------------------------------------------------------
// SALES PLAN-ACM — التارجت اليومي بييجي من ACM_SALES_PLAN_GID (TAGER_ID/
// PRODUCT_ID/CATEGORY/ACM/4 تارجتس يومية)، والأداء الفعلي (Actuals) بيتحسب
// لايف من شيت الـ Main (MAIN_GID) بالمطابقة على Merchant ID + Product ID —
// مفيش شيت برفورمانس منفصل بيتقرا هنا خالص. "ACTUAL CONFIRMED/PLACED/DELIVERED"
// بتتحسب من أعمدة الـ Pieces (مش الأوردرات)، لأن قسم الـ Marketplace بيتابع
// الأداء على مستوى القطع. التارجت الشهري (Target MTD) = Daily Target ×
// عدد الأيام من أول الشهر لحد امبارح، وبيتفلتر بفلتر الشهر/الـ ACM بره فوق
// زي أي قسم تاني في الداشبورد.
// -------------------------------------------------------------------------
// دالة تحديد الـ Final Status (Performance Band) بناءً على % of MTD
// 0% = No Achievement | 1-49% = Critical | 50-69% = Needs Improvement
// 70-84% = Fair | 85-94% = Good | 95-104% = Excellent
// 105-119% = Overachiever | 120%+ = Upside
function getMpSalesPlanFinalStatus(pct) {
    if (pct <= 0) return { text: "No Achievement", cls: "gray" };
    if (pct < 50) return { text: "Critical", cls: "red" };
    if (pct < 70) return { text: "Needs Improvement", cls: "orange" };
    if (pct < 85) return { text: "Fair", cls: "yellow" };
    if (pct < 95) return { text: "Good", cls: "blue" };
    if (pct < 105) return { text: "Excellent", cls: "green" };
    if (pct < 120) return { text: "Overachiever", cls: "green" };
    return { text: "Upside", cls: "purple" };
}

// بيبني بيانات مقياس واحد (Placed/Confirmed/Delivered/GMV) مقابل هدفه اليومي:
// Target MTD = Daily Target × عدد الأيام من أول الشهر لحد امبارح (زي باقي
// الداشبورد)، Run Rate = إسقاط لو الأداء الحالي (من أول الشهر لحد آخر يوم
// بيانات) استمر بنفس المعدل لحد آخر يوم في الشهر (يعني "هيقفل الشهر كام"،
// مش بس MTD)، و Run Rate % = نسبة الإسقاط ده من التارجت الشهري الكامل
// (Daily Target × عدد أيام الشهر) — ده اللي بيجاوب سؤال "هيتحقق ولا لأ لو
// الوضع فضل زي ما هو".
function mpSpBuildMetric(dailyTarget, mtdActual, daysUntilYesterday, elapsedDays, currentMonthDays) {
    const mtdTarget = dailyTarget * daysUntilYesterday;
    const monthlyTarget = dailyTarget * currentMonthDays;
    const gap = mtdTarget - mtdActual;
    const runRate = (mtdActual / elapsedDays) * currentMonthDays;
    const achievedPct = mtdTarget > 0 ? (mtdActual / mtdTarget) * 100 : (mtdActual > 0 ? 100 : 0);
    const runRatePct = monthlyTarget > 0 ? (runRate / monthlyTarget) * 100 : (runRate > 0 ? 100 : 0);
    const status = getMpSalesPlanFinalStatus(achievedPct);
    return { dailyTarget, mtdTarget, monthlyTarget, mtdActual, gap, runRate, runRatePct, achievedPct, status };
}

function prepareMpSalesPlanData() {
    if (!state.acmSalesPlanData || state.acmSalesPlanData.length === 0) return;

    const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
    const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
    // الأداء الفعلي (Actuals) بقى بيتحسب لايف من شيت الـ Main (MAIN_GID) زي أي
    // سكشن تاني في الداشبورد، مش من شيت برفورمانس منفصل. المطابقة بتتم على
    // مستوى Merchant (TAGER_ID = MERCHANT_ID) + Product (PRODUCT_ID = SKU).
    const mainRowsAll = state.allParsedRows || [];
    const perfRows = mainRowsAll.filter(r => {
        return (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm);
    });

    let latestTs = 0; perfRows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
    const today = new Date(latestTs); today.setHours(0,0,0,0);
    const currentMonthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const elapsedDays = today.getDate() || 1;
    const daysUntilYesterday = Math.max(1, elapsedDays - 1);

    const startThisWeek = today.getTime() - (7 * 86400000);
    const startLastWeek = today.getTime() - (14 * 86400000);

    let totalSkus = 0; let achievedCount = 0; let missedCount = 0;
    let totalMtdTarget = 0; let totalMtdActual = 0;
    let countCritical = 0; let countGood = 0; let countExcellent = 0; let countUpside = 0;

    // فلترة خطة الـ ACM المختار من فوق كمان (مش بس صفوف الأداء)، عشان لو
    // حد مختار ACM معين يشوف الـ SKUs بتاعته بس مباشرة من عمود ACM في الشيت.
    let planRows = state.acmSalesPlanData;
    if (selectedAcm !== "All") planRows = planRows.filter(p => p.acm === selectedAcm);

    const mergedData = planRows.map(plan => {
        let raw = { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, thisWeekConfirmed: 0, lastWeekConfirmed: 0 };

        perfRows.forEach(r => {
            if (r.sku === plan.productId && r.merchantId === plan.tagerId) {
                // ACTUAL بيتحسب من الـ Pieces (مش الأوردرات)، زي قسم الـ Marketplace كله.
                raw.placed += r.placedPieces;
                raw.confirmed += r.confirmedPieces;
                raw.delivered += r.deliveredPieces;
                raw.deliveredGmv += r.deliveredGmv;
                const rTime = new Date(r.timestamp).setHours(0,0,0,0);
                if (rTime >= startThisWeek) raw.thisWeekConfirmed += r.confirmedPieces;
                else if (rTime >= startLastWeek && rTime < startThisWeek) raw.lastWeekConfirmed += r.confirmedPieces;
            }
        });

        // Adjust DLV GMV إجمالي الشهر كله في الشيت، فبنحوله لتارجت يومي
        // (÷ عدد أيام الشهر) قبل ما نحسبه — بالظبط زي Commercial Plan.
        // Confirmed يومي فعلاً، بياخد زي ما هو من غير أي تحويل.
        const gmvDailyTarget = plan.gmvMonthlyTarget > 0 ? (plan.gmvMonthlyTarget / currentMonthDays) : 0;

        const placedM = mpSpBuildMetric(plan.dailyPlacedTarget, raw.placed, daysUntilYesterday, elapsedDays, currentMonthDays);
        const confirmedM = mpSpBuildMetric(plan.dailyConfirmedTarget, raw.confirmed, daysUntilYesterday, elapsedDays, currentMonthDays);
        const deliveredM = mpSpBuildMetric(plan.dailyDlvTarget, raw.delivered, daysUntilYesterday, elapsedDays, currentMonthDays);
        const gmvM = mpSpBuildMetric(gmvDailyTarget, raw.deliveredGmv, daysUntilYesterday, elapsedDays, currentMonthDays);

        // Confirmed Pieces هو المقياس الأساسي اللي بيحدد "الحالة العامة" للصف
        // وكروت الملخص فوق (زي ما كان قبل كده، ده أساس عمود "Rounded Daily Confirmed").
        const mtdAchievedPct = confirmedM.achievedPct;
        const finalStatus = confirmedM.status;

        if (mtdAchievedPct < 50) countCritical++;
        else if (mtdAchievedPct < 85) countGood++;
        else if (mtdAchievedPct < 100) countExcellent++;
        else countUpside++;

        const wowDiff = raw.thisWeekConfirmed - raw.lastWeekConfirmed;
        let wowPct = 0;
        if (raw.lastWeekConfirmed > 0) wowPct = (wowDiff / raw.lastWeekConfirmed) * 100;
        else if (raw.thisWeekConfirmed > 0) wowPct = 100;

        let wowStatus = 'Stable'; let wowClass = 'stable'; let wowIcon = '➖';
        if (wowPct > 10) { wowStatus = 'Spike'; wowClass = 'spike'; wowIcon = '📈'; }
        else if (wowPct < -10) { wowStatus = 'Decline'; wowClass = 'decline'; wowIcon = '📉'; }

        totalSkus++;
        if (confirmedM.mtdActual >= confirmedM.mtdTarget) achievedCount++; else missedCount++;
        totalMtdTarget += confirmedM.mtdTarget; totalMtdActual += confirmedM.mtdActual;

        // Merchant Name بتيجي دلوقتي مباشرة من عمود TAGER_NAME في الشيت نفسه؛
        // لو فاضية لأي سبب، fallback لخريطة الـ Main (merchantInfoMap).
        const merchantName = plan.tagerName || ((state.merchantInfoMap || new Map()).get(plan.tagerId) || {}).merchantName || plan.tagerId;

        return {
            ...plan, merchantName,
            metrics: { placed: placedM, confirmed: confirmedM, delivered: deliveredM, gmv: gmvM },
            // نُسخ مسطّحة (flat) لكل مقياس عشان الترتيب (sortMpSalesPlan) يقدر
            // ياخد القيمة بـ row[key] مباشرة من غير تعقيد.
            placedDailyTarget: placedM.dailyTarget, placedMtdTarget: placedM.mtdTarget, placedMtdActual: placedM.mtdActual, placedGap: placedM.gap, placedRunRate: placedM.runRate, placedAchievedPct: placedM.achievedPct,
            confirmedDailyTarget: confirmedM.dailyTarget, confirmedMtdTarget: confirmedM.mtdTarget, confirmedMtdActual: confirmedM.mtdActual, confirmedGap: confirmedM.gap, confirmedRunRate: confirmedM.runRate, confirmedAchievedPct: confirmedM.achievedPct,
            deliveredDailyTarget: deliveredM.dailyTarget, deliveredMtdTarget: deliveredM.mtdTarget, deliveredMtdActual: deliveredM.mtdActual, deliveredGap: deliveredM.gap, deliveredRunRate: deliveredM.runRate, deliveredAchievedPct: deliveredM.achievedPct,
            gmvDailyTarget: gmvM.dailyTarget, gmvMtdTarget: gmvM.mtdTarget, gmvMtdActual: gmvM.mtdActual, gmvGap: gmvM.gap, gmvRunRate: gmvM.runRate, gmvAchievedPct: gmvM.achievedPct,
            // Aliases بتفضل بنفس اسم Confirmed (المقياس الأساسي) عشان أي كود تاني
            // بيتعامل مع mtdTarget/mtdActual/... بشكل عام يفضل شغال زي ما هو.
            mtdTarget: confirmedM.mtdTarget, mtdActual: confirmedM.mtdActual, gap: confirmedM.gap, runRate: confirmedM.runRate, mtdAchievedPct, finalStatus,
            wowDiff, wowPct, wowStatus, wowClass, wowIcon
        };
    });

    if($("mpSpTotalSkus")) $("mpSpTotalSkus").textContent = fmtInt.format(totalSkus);
    if($("mpSpAchieved")) $("mpSpAchieved").textContent = fmtInt.format(achievedCount);
    if($("mpSpMissed")) $("mpSpMissed").textContent = fmtInt.format(missedCount);
    if($("mpSpOverallMtdTarget")) $("mpSpOverallMtdTarget").textContent = fmtInt.format(Math.round(totalMtdTarget));
    if($("mpSpOverallMtdActual")) $("mpSpOverallMtdActual").textContent = fmtInt.format(totalMtdActual);
    if($("mpSpCountCritical")) $("mpSpCountCritical").textContent = fmtInt.format(countCritical);
    if($("mpSpCountGood")) $("mpSpCountGood").textContent = fmtInt.format(countGood);
    if($("mpSpCountExcellent")) $("mpSpCountExcellent").textContent = fmtInt.format(countExcellent);
    if($("mpSpCountUpside")) $("mpSpCountUpside").textContent = fmtInt.format(countUpside);

    state.mpSalesPlanDataPrepared = mergedData;
    applyMpSalesPlanFilterAndSort();
}

// دالة ترتيب الأعمدة
function sortMpSalesPlan(key) {
    if (state.mpSalesPlanSortKey === key) {
        state.mpSalesPlanSortDir = state.mpSalesPlanSortDir === "asc" ? "desc" : "asc";
    } else {
        state.mpSalesPlanSortKey = key;
        state.mpSalesPlanSortDir = "desc";
    }
    applyMpSalesPlanFilterAndSort();
}

// دالة الفلترة (Search) والترتيب
function applyMpSalesPlanFilterAndSort() {
    if (!state.mpSalesPlanDataPrepared) return;
    let data = [...state.mpSalesPlanDataPrepared];

    const searchInput = $("searchMpSalesPlanInput");
    const q = searchInput ? searchInput.value.toLowerCase() : "";
    if (q) {
        data = data.filter(d =>
            (d.productId && d.productId.toLowerCase().includes(q)) ||
            (d.productName && d.productName.toLowerCase().includes(q)) ||
            (d.acm && d.acm.toLowerCase().includes(q)) ||
            (d.category && d.category.toLowerCase().includes(q)) ||
            (d.tagerId && d.tagerId.toLowerCase().includes(q)) ||
            (d.merchantName && d.merchantName.toLowerCase().includes(q))
        );
    }

    const key = state.mpSalesPlanSortKey;
    const dir = state.mpSalesPlanSortDir === "asc" ? 1 : -1;

    data.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });

    renderMpSalesPlanTable(data);
}

// بيبني الأربع خلايا (MTD Target / Actual / Run Rate / Achievement%) لمقياس
// واحد (Placed/Confirmed/Delivered/GMV)، عشان مانكررش نفس الماركاب أربع مرات.
function mpSpMetricCellsHtml(m, isMoney) {
    const fmtV = (v) => isMoney ? fmtMoneyCompactCell(v) : fmtIntCell(Math.round(v));
    const achColor = m.achievedPct >= 100 ? 'green' : (m.achievedPct >= 85 ? 'orange' : 'red');
    const rrColor = m.runRatePct >= 100 ? 'green' : (m.runRatePct >= 85 ? 'orange' : 'red');
    return `
            <td class="num text-dim">${fmtV(m.mtdTarget)}</td>
            <td class="num font-bold">${fmtV(m.mtdActual)}</td>
            <td class="num"><span class="badge-outline ${rrColor}" title="Projected month-end close vs full monthly target">${fmtV(m.runRate)}</span></td>
            <td class="num"><span class="badge-outline ${achColor}">${fmtPctCell(m.achievedPct)}</span></td>`;
}

// دالة الرسم — بترسم صفحة واحدة بس (PAGE_SIZE صف) زي باقي جداول الداشبورد
// (Commercial Plan وغيره)، بدل ما ترندر كل الـ SKUs مرة واحدة.
function renderMpSalesPlanTable(data) {
    state.mpSalesPlanFiltered = data;
    state.mpSalesPlanPage = 0;
    renderPaginatedMpSalesPlanTable();
}

function renderPaginatedMpSalesPlanTable() {
    const tbody = $("mpSalesPlanTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const data = state.mpSalesPlanFiltered || [];
    const start = state.mpSalesPlanPage * PAGE_SIZE;
    const pageRows = data.slice(start, start + PAGE_SIZE);

    pageRows.forEach(m => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="font-mono text-dim">${m.productId}</td>
            <td class="font-bold truncate-cell" title="${m.productName}">${m.productName}</td>
            <td class="font-mono text-dim">${m.tagerId}</td>
            <td class="truncate-cell" title="${m.merchantName}">${m.merchantName}</td>
            <td class="text-dim">${m.category}</td>
            <td class="font-bold text-purple">${m.acm}</td>
            ${mpSpMetricCellsHtml(m.metrics.placed, false)}
            ${mpSpMetricCellsHtml(m.metrics.confirmed, false)}
            ${mpSpMetricCellsHtml(m.metrics.delivered, false)}
            ${mpSpMetricCellsHtml(m.metrics.gmv, true)}
            <td class="center"><span class="badge-status ${m.wowClass}">${m.wowIcon} ${m.wowPct > 0 ? '+' : ''}${m.wowPct.toFixed(1)}%</span></td>
            <td class="center"><span class="badge-outline ${m.finalStatus.cls}">${m.finalStatus.text}</span></td>
        `;
        tbody.appendChild(tr);
    });

    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    if ($("rowCountMpSalesPlan")) $("rowCountMpSalesPlan").textContent = `${fmtInt.format(data.length)} SKUs`;
    if ($("pageIndicatorMpSalesPlan")) $("pageIndicatorMpSalesPlan").textContent = `Page ${state.mpSalesPlanPage + 1} of ${totalPages}`;
    if ($("prevPageMpSalesPlan")) $("prevPageMpSalesPlan").disabled = state.mpSalesPlanPage === 0;
    if ($("nextPageMpSalesPlan")) $("nextPageMpSalesPlan").disabled = state.mpSalesPlanPage >= totalPages - 1;
}
// -------------------------------------------------------------------------
// COMMERCIAL DEBUNDLIZED — لكل Single SKU (من PRODUCTS_DEBUNDLE_MAP_GID)،
// بيجمع الديماند بتاعه من شيت الـ Main (MAIN_GID) على مستوى PRODUCT_ID، سواء
// كان الـ PRODUCT_ID ده هو نفسه الـ Single SKU أو بندل بيحتويه — في حالة
// البندل، القيم (Placed/Confirmed/Delivered/GMV/CM3) بتتضرب في PRODUCT_QUANTITY
// بتاعت الـ Single جوه البندل ده قبل ما تتجمع. أي PRODUCT_ID مش موجود في
// خريطة الديبندلايز أصلاً بيتجاهل (مش جزء من أي Single/Bundle معروف).
// CR%/DR%/NDR%/CM3/CM3% بتاخد بالظبط نفس الـ Lag Cut-off المستخدم في أي
// سكشن تاني مصدره MAIN_GID (CR_LAG_DAYS للـ CR، CM3_LAG_DAYS للـ DR والـ CM3).
// Target = Adjusted Target (يومي، Confirmed basis) من SINGLE_SKU_TARGETS_GID،
// و Target (MTD) = Daily Target × عدد الأيام من أول الشهر لحد امبارح.
// لو الـ Single SKU ملوش تارجت، hasTarget=false وبيتعرض "Not in Plan".
// -------------------------------------------------------------------------
function buildDebundleProductMap(debundleRows, cogsMap) {
  // PRODUCT_ID -> [{ singleId, quantity }, ...]
  // ملحوظة مهمة: نفس الـ PRODUCT_ID (البندل) بيتكرر على أكتر من صف في الشيت،
  // صف لكل Single SKU جوه البندل ده (كل صف بمقادير SINGLE_ID/PRODUCT_QUANTITY
  // مختلفة). فلازم نجمع كل الصفوف دي في array لكل PRODUCT_ID، مش نستخدم
  // Map.set عادي اللي كان بيدي override وبيسيب آخر صف بس (ده كان الـ bug).
  const productMap = new Map();
  const singlesList = new Map();  // SINGLE_ID -> SINGLE_NAME
  const stockBySingle = new Map(); // SINGLE_ID -> STOCK (عمود G في نفس الشيت)
  (debundleRows || []).forEach(r => {
    if (!r.productId || !r.singleId) return;
    if (!productMap.has(r.productId)) productMap.set(r.productId, []);
    productMap.get(r.productId).push({ singleId: r.singleId, quantity: r.quantity || 1 });
    if (!singlesList.has(r.singleId)) singlesList.set(r.singleId, r.singleName || r.singleId);
    if (r.stock) stockBySingle.set(r.singleId, r.stock);
  });
  // وزن كل Single جوه البندل، بالظبط زي شيت الـ BUNDLE TABLE المرجعي:
  //   Single Cogs (G) = COGS(SINGLE_ID) × PRODUCT_QUANTITY
  //   Bundle Cogs  (H) = مجموع Single Cogs لكل الـ Singles اللي جوه نفس الـ PRODUCT_ID
  //   %            (I) = Single Cogs ÷ Bundle Cogs  ← ده اللي بنوزع بيه GMV/CM3/PPM
  // للمنتجات اللي مش بندل (Single لوحده)، الصف الوحيد بياخد وزن = 1 تلقائيًا.
  productMap.forEach(mappings => {
    let bundleCogsTotal = 0;
    mappings.forEach(m => { m.cogs = ((cogsMap && cogsMap.get(m.singleId)) || 0) * m.quantity; bundleCogsTotal += m.cogs; });
    mappings.forEach(m => { m.cogsWeight = bundleCogsTotal > 0 ? (m.cogs / bundleCogsTotal) : 0; });
  });
  return { productMap, singlesList, stockBySingle };
}

// بيبني بيانات مقياس واحد (Placed/Confirmed/Delivered Pieces أو GMV) بنفس
// شكل الجروبات في Sales Plan-ACM بالظبط (Target MTD / Actual / Run Rate /
// Ach%) — لكن هنا التارجت اختياري (dailyTarget ممكن يكون null لو مفيش
// مصدر تارجت مستقل للمقياس ده)، وفي الحالة دي hasTarget=false وبيتعرض
// "Not in Plan" بدل الرقم.
function cdzBuildMetric(dailyTarget, mtdActual, daysUntilYesterday, elapsedDays, currentMonthDays) {
  const hasTarget = dailyTarget !== null && dailyTarget !== undefined && dailyTarget > 0;
  const mtdTarget = hasTarget ? dailyTarget * daysUntilYesterday : null;
  const runRate = (mtdActual / elapsedDays) * currentMonthDays;
  const achievedPct = (hasTarget && mtdTarget > 0) ? (mtdActual / mtdTarget) * 100 : null;
  return { hasTarget, dailyTarget, mtdTarget, mtdActual, runRate, achievedPct };
}

function computeCommercialDebundlized() {
  // من غير أي تجميع/توزيع بندل خالص: كل SKU (PRODUCT_ID، عمود A في شيت
  // الديبندلايز) بيتقرا لوحده منفصل تمامًا، وديماند بتاعه بييجي من صفوف شيت
  // الـ Main اللي فيها r.sku == نفس الـ PRODUCT_ID ده بالظبط (من غير ضرب في
  // Quantity ولا توزيع بوزن الـ COGS زي قبل كده).
  const skuList = new Map(); // PRODUCT_ID -> { name, stock, category }
  (state.debundleMap || []).forEach(r => {
    if (!r.productId) return;
    if (!skuList.has(r.productId)) {
      skuList.set(r.productId, { name: r.productName || r.singleName || r.productId, stock: r.stock || 0 });
    }
  });

  const mainRowsAll = state.allParsedRows || [];
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const rows = mainRowsAll.filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));

  const cm3CutoffTs = getCm3LagCutoffTimestamp(rows); // نفس الـ 4 أيام بتاعة الـ DR والـ CM3
  const crCutoffTs = getLagCutoffTimestamp(rows, CR_LAG_DAYS); // نفس اليومين بتاعة الـ CR

  let latestTs = 0; rows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
  const today = new Date(latestTs); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const d3Ms = todayMs - (3 * 86400000); // Avg Last 3 Days Confirmed
  const elapsedDays = today.getDate() || 1;
  const currentMonthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysUntilYesterday = Math.max(1, elapsedDays - 1);

  const buckets = new Map();
  function getBucket(id) {
    if (!buckets.has(id)) buckets.set(id, { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0, crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, conf3d: 0 });
    return buckets.get(id);
  }

  // إجمالي حقيقي غير مكرر لكل صف مرة واحدة بس، عشان التوتال ده يمثل نفس
  // أرقام الأوفرفيو الحقيقية ومينفعش يبقى أكبر من الكل.
  let overallDeliveredGmv = 0, overallCm3 = 0;

  rows.forEach(r => {
    if (!r.sku) return;
    overallDeliveredGmv += r.deliveredGmv;
    if (isCm3RowEligible(r, cm3CutoffTs)) overallCm3 += r.cm3;

    if (!skuList.has(r.sku)) return; // مش موجود في شيت الديبندلايز خالص (عمود A)
    const rDate = new Date(r.timestamp); rDate.setHours(0, 0, 0, 0); const rTime = rDate.getTime();

    // كل SKU بياخد قيمته الحقيقية كاملة زي ما هي — من غير توزيع أو ضرب في
    // Quantity ولا وزن COGS (مفيش تجميع/فك بندل خالص هنا دلوقتي).
    const b = getBucket(r.sku);
    b.placed += r.placedPieces; b.confirmed += r.confirmedPieces; b.delivered += r.deliveredPieces;
    if (rTime >= d3Ms) b.conf3d += r.confirmedPieces;
    if (isRowEligibleForLag(r, crCutoffTs)) { b.crPlaced += r.placedPieces; b.crConfirmed += r.confirmedPieces; }
    if (isRowEligibleForLag(r, cm3CutoffTs)) { b.drConfirmed += r.confirmedPieces; b.drDelivered += r.deliveredPieces; }
    if (isCm3RowEligible(r, cm3CutoffTs)) {
      b.deliveredGmv += r.deliveredGmv;
      b.cm3 += r.cm3;
      b.cm3Gmv += r.deliveredGmv;
    }
    // PPM (Total) و PPM/Piece — من غير أي كات أوف خالص (بطلب صريح)، بعكس
    // CM3/Delivered GMV اللي لسه بياخدوا كات أوف الـ CM3_LAG_DAYS فوق.
    b.ppm += (r.ppm || 0);
  });

  const targets = state.singleSkuTargets || {};
  const result = [];
  skuList.forEach((skuInfo, productId) => {
    const b = buckets.get(productId) || { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0, crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, conf3d: 0 };
    const crPct = b.crPlaced ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const cm3Pct = b.cm3Gmv ? (b.cm3 / b.cm3Gmv) * 100 : 0;
    // PPM/Piece: على إجمالي القطع المستلمة الكامل (b.delivered، من غير كات
    // أوف)، زي الـ PPM نفسه. CM3/Piece بقى مختلف: المقام لازم ياخد نفس كات
    // أوف الـ CM3 بالظبط (زي CM3%) — b.drDelivered أصلاً Delivered Pieces من
    // نفس الصفوف اللي عدت كات أوف الـ CM3 (نفس cm3CutoffTs)، فبنستخدمه هنا
    // بدل b.delivered الكامل.
    const cm3PerPiece = b.drDelivered ? (b.cm3 / b.drDelivered) : 0;
    const ppmPerPiece = b.delivered ? (b.ppm / b.delivered) : 0;

    const targetInfo = targets[productId];
    // شيت البلان بيكتب 0 لأي حاجة مش في البلان فعلياً — التارجت لازم يكون > 0
    // عشان نعتبره SKU "في البلان"، غير كده بيتعرض Not in Plan.
    // أربع تارجتس مستقلين دلوقتي (زي جروبات Sales Plan-ACM بالظبط):
    //   - Placed / Confirmed: يوميين فعلاً من الشيت، يتاخدوا زي ما هم.
    //   - Delivered PCS / GMV: إجمالي الشهر كله في الشيت، فبنحولهم لتارجت
    //     يومي (÷ عدد أيام الشهر) الأول قبل ما نحسب منهم MTD — عشان
    //     الـ MTD يفضل صحيح ومتناسب مع الأيام اللي فاتت فعلاً، مش الشهر كله.
    const hasTarget = !!(targetInfo && targetInfo.adjustedTarget > 0);
    const placedDailyTarget = (targetInfo && targetInfo.placedDailyTarget > 0) ? targetInfo.placedDailyTarget : null;
    const confirmedDailyTarget = hasTarget ? targetInfo.adjustedTarget : null;
    const dlvPcsDailyTarget = (targetInfo && targetInfo.dlvPcsMonthlyTarget > 0) ? (targetInfo.dlvPcsMonthlyTarget / currentMonthDays) : null;
    const dlvGmvDailyTarget = (targetInfo && targetInfo.dlvGmvMonthlyTarget > 0) ? (targetInfo.dlvGmvMonthlyTarget / currentMonthDays) : null;

    const placedM = cdzBuildMetric(placedDailyTarget, b.placed, daysUntilYesterday, elapsedDays, currentMonthDays);
    const confirmedM = cdzBuildMetric(confirmedDailyTarget, b.confirmed, daysUntilYesterday, elapsedDays, currentMonthDays);
    const deliveredM = cdzBuildMetric(dlvPcsDailyTarget, b.delivered, daysUntilYesterday, elapsedDays, currentMonthDays);
    const gmvM = cdzBuildMetric(dlvGmvDailyTarget, b.deliveredGmv, daysUntilYesterday, elapsedDays, currentMonthDays);

    // Aliases (زي ما كانت قبل كده) عشان أي كود تاني أو ترتيب بيعتمد على
    // mtdTarget/mtdActual/mtdAchPct/runRate العام يفضل شغال — دول بيمثلوا
    // مجموعة Confirmed تحديدًا (المقياس الأساسي اللي ليه تارجت حقيقي).
    const mtdTarget = confirmedM.mtdTarget; const dailyTarget = confirmedM.dailyTarget;
    const mtdActual = confirmedM.mtdActual; const mtdAchPct = confirmedM.achievedPct;
    const runRate = Math.round(confirmedM.runRate);

    // Status (آخر عمود في الجدول): بنفس الباكتس المستخدمة في Sales Plan-ACM
    // بالظبط (No Achievement/Critical/Needs Improvement/Fair/Good/Excellent/
    // Overachiever/Upside) — لو الـ SKU مش في البلان أصلاً (hasTarget=false)
    // بيبقى "Not in Plan" بدل ما يتحط في باكت وهمي مالوش تارجت يتقاس عليه.
    const finalStatus = hasTarget ? getMpSalesPlanFinalStatus(mtdAchPct) : { text: "Not in Plan", cls: "gray" };

    // Stock: من عمود H في شيت الديبندلايز (1409034448) — لنفس صف الـ SKU ده
    // بالظبط (عمود A)، من غير أي تجميع مع SKUs تانية.
    // DOH = Stock ÷ Avg Last 3 Days Confirmed.
    const stock = skuInfo.stock;
    const avg3dConfirmed = b.conf3d / 3;
    const doh = avg3dConfirmed > 0 ? Math.round(stock / avg3dConfirmed) : Math.round(stock || 0);

    result.push({
      singleId: productId, singleName: skuInfo.name,
      category: (targetInfo && targetInfo.category) || (state.inventoryMap[productId] ? state.inventoryMap[productId].category : "") || "Uncategorized",
      stock: Math.round(stock || 0), doh,
      hasTarget, dailyTarget, mtdTarget, mtdActual, mtdAchPct, runRate, finalStatus,
      metrics: { placed: placedM, confirmed: confirmedM, delivered: deliveredM, gmv: gmvM },
      // فلات كوبيز لكل جروب عشان الترتيب (sortCdz) يقدر ياخد القيمة بـ row[key] مباشرة.
      placedMtdTarget: placedM.mtdTarget, placedMtdActual: placedM.mtdActual, placedRunRate: placedM.runRate, placedAchievedPct: placedM.achievedPct,
      confirmedMtdTarget: confirmedM.mtdTarget, confirmedMtdActual: confirmedM.mtdActual, confirmedRunRate: confirmedM.runRate, confirmedAchievedPct: confirmedM.achievedPct,
      deliveredMtdTarget: deliveredM.mtdTarget, deliveredMtdActual: deliveredM.mtdActual, deliveredRunRate: deliveredM.runRate, deliveredAchievedPct: deliveredM.achievedPct,
      gmvMtdTarget: gmvM.mtdTarget, gmvMtdActual: gmvM.mtdActual, gmvRunRate: gmvM.runRate, gmvAchievedPct: gmvM.achievedPct,
      totalPlaced: b.placed, totalConfirmed: b.confirmed, totalDelivered: b.delivered,
      crPct, drPct, ndrPct, deliveredGmv: b.deliveredGmv, cm3: b.cm3, cm3Pct, cm3PerPiece, ppm: b.ppm, ppmPerPiece
    });
  });
  return { rows: result, overallDeliveredGmv, overallCm3, daysUntilYesterday };
}

// -------------------------------------------------------------------------
// Status (Commercial Plan) — بديل بكتات Critical/Good/Excellent/Upside
// القديمة. بتاخد نفس بيانات الـ SKUs المحسوبة فعلاً فوق (state.cdzDataPrepared
// / metrics.placed / metrics.confirmed) وبتجمعها بنفس الـ Status بالظبط اللي
// شايفينه في عمود "Status" بتاع الجدول التفصيلي تحت (getMpSalesPlanFinalStatus)
// — No Achievement / Critical / Needs Improvement / Fair / Good / Excellent /
// Overachiever / Upside — عشان يبقوا نفس التسمية والحدود بالظبط، مش تسمية
// تانية. الـ SKU اللي مفيهوش تارجت مستقل للمقياس ده (hasTarget=false) بيروح
// لباكت "Not in Plan" (زي نص الـ Status بتاعه في الجدول التفصيلي بالظبط).
// -------------------------------------------------------------------------
// cls بتاعت كل باكت هي بالظبط نفس الـ cls اللي getMpSalesPlanFinalStatus
// بترجعها لنفس النص ده (نفس ألوان badge-outline بتاعت عمود الـ Status في
// الجدول التفصيلي)، عشان اللون هنا وهناك يبقى نفسه بالظبط.
const CDZ_STATUS_BUCKETS = [
  { key: "noach", label: "No Achievement", range: "0%", cls: "gray" },
  { key: "critical", label: "Critical", range: "1% – 49%", cls: "red" },
  { key: "needsimp", label: "Needs Improvement", range: "50% – 69%", cls: "orange" },
  { key: "fair", label: "Fair", range: "70% – 84%", cls: "yellow" },
  { key: "good", label: "Good", range: "85% – 94%", cls: "blue" },
  { key: "excellent", label: "Excellent", range: "95% – 104%", cls: "green" },
  { key: "overachiever", label: "Overachiever", range: "105% – 119%", cls: "green" },
  { key: "upside", label: "Upside", range: "120%+", cls: "purple" },
  { key: "notinplan", label: "Not in Plan", range: "No Target", cls: "gray" },
];
const CDZ_STATUS_KEY_BY_TEXT = {
  "No Achievement": "noach", "Critical": "critical", "Needs Improvement": "needsimp",
  "Fair": "fair", "Good": "good", "Excellent": "excellent",
  "Overachiever": "overachiever", "Upside": "upside",
};

// بتستخدم نفس getMpSalesPlanFinalStatus المستخدمة أصلاً في عمود الـ Status
// بتاع الجدول التفصيلي — عشان الحدود والتسمية يبقوا نفس المصدر بالظبط
// ومفيش احتمال اختلاف بين العمود ده والملخص فوق.
function getCdzStatusBucketKey(hasTarget, pct) {
  if (!hasTarget) return "notinplan";
  const s = getMpSalesPlanFinalStatus(pct);
  return CDZ_STATUS_KEY_BY_TEXT[s.text] || "notinplan";
}

// بيبني صفوف باكت واحد (Placed أو Confirmed) — الأعمدة زي الشيت المرجعي
// بالظبط: Count / Total Daily Target / Total AVG (المعدل اليومي الفعلي حتى
// امبارح = MTD Actual ÷ نفس عدد الأيام المستخدم لحساب Target MTD) /
// Total Target MTD / Total MTD (Actual) / AVG ACH (= Total MTD ÷ Total
// Target MTD)، وفي الآخر صف Total إجمالي لكل الباكتات.
function computeCdzAchievementBuckets(metricKey) {
  const days = state.cdzDaysUntilYesterday || 1;
  const buckets = {};
  CDZ_STATUS_BUCKETS.forEach(b => { buckets[b.key] = { count: 0, dailyTarget: 0, mtdTarget: 0, mtdActual: 0 }; });

  // كل PRODUCT_ID بييجي مرة واحدة بس هنا (state.cdzDataPrepared مبني من Map
  // فريد لكل PRODUCT_ID)، فمفيش تكرار عد أصلاً. لكن باكت "Not in Plan" تحديدًا:
  // مينفعش ياخد أي SKU مالوش تارجت حتى لو مالوش أي حركة خالص الشهر ده (يعني
  // صفر Placed/Confirmed فعلي) — ده SKU مش نشط أصلاً ومش لازم يتحسب في
  // الملخص. لازم يقرا بس الـ SKUs اللي فعلاً "رفعت" (MTD Actual > 0) الشهر ده
  // من الماين شيت، مع إنها مالهاش تارجت مستقل للمقياس ده.
  (state.cdzDataPrepared || []).forEach(row => {
    const m = row.metrics && row.metrics[metricKey];
    if (!m) return;
    if (!m.hasTarget && !(m.mtdActual > 0)) return; // مفيش تارجت ومفيش نشاط فعلي — يتشال من الملخص خالص
    const key = getCdzStatusBucketKey(m.hasTarget, m.achievedPct);
    const b = buckets[key];
    b.count++;
    if (m.hasTarget) { b.dailyTarget += (m.dailyTarget || 0); b.mtdTarget += (m.mtdTarget || 0); }
    b.mtdActual += (m.mtdActual || 0);
  });

  const rows = CDZ_STATUS_BUCKETS.map(b => {
    const d = buckets[b.key];
    const avg = d.mtdActual / days;
    const achPct = d.mtdTarget > 0 ? (d.mtdActual / d.mtdTarget) * 100 : null;
    return { label: b.label, range: b.range, cls: b.cls, count: d.count, dailyTarget: d.dailyTarget, avg, mtdTarget: d.mtdTarget, mtdActual: d.mtdActual, achPct };
  });

  const totals = rows.reduce((acc, r) => {
    acc.count += r.count; acc.dailyTarget += r.dailyTarget; acc.avg += r.avg; acc.mtdTarget += r.mtdTarget; acc.mtdActual += r.mtdActual;
    return acc;
  }, { count: 0, dailyTarget: 0, avg: 0, mtdTarget: 0, mtdActual: 0 });
  const totalAchPct = totals.mtdTarget > 0 ? (totals.mtdActual / totals.mtdTarget) * 100 : null;
  rows.push({ label: "Total", range: "", cls: "", count: totals.count, dailyTarget: totals.dailyTarget, avg: totals.avg, mtdTarget: totals.mtdTarget, mtdActual: totals.mtdActual, achPct: totalAchPct, isTotal: true });

  return rows;
}

// خلية اسم الستاتيوس: التكست نفسه ملوّن بنفس لون عمود الـ Status في الجدول
// التفصيلي (من غير أي مربع/بوردر حواليه)، وتحته رينج الـ % بخط Inter صغير
// ودّي — مش نفس فونت الأرقام (JetBrains Mono) عشان يبان واضح إنه تسمية مش رقم.
function cdzStatusCellHtml(r) {
  if (r.isTotal) return `<span class="st-status-total-label">${r.label}</span>`;
  return `
    <span class="st-status-label ${r.cls}">${r.label}</span>
    <div class="st-status-range">${r.range}</div>`;
}

function renderCdzAchievementBucketTable(tbodyId, bucketRows) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = bucketRows.map(r => `
    <tr${r.isTotal ? ' class="st-grand-total"' : ""}>
      <td class="st-status-cell">${cdzStatusCellHtml(r)}</td>
      <td>${fmtIntCell(r.count)}</td>
      <td>${fmtIntCell(Math.round(r.dailyTarget))}</td>
      <td>${fmtIntCell(Math.round(r.avg))}</td>
      <td>${fmtIntCell(Math.round(r.mtdTarget))}</td>
      <td>${fmtIntCell(Math.round(r.mtdActual))}</td>
      <td>${r.achPct === null ? "—" : `<span class="badge-outline ${r.achPct >= 100 ? 'green' : (r.achPct >= 85 ? 'orange' : 'red')}">${fmtPctCell(r.achPct)}</span>`}</td>
    </tr>
  `).join("");
}

function renderCdzAchievementBuckets() {
  renderCdzAchievementBucketTable("cdzPlacedBucketBody", computeCdzAchievementBuckets("placed"));
  renderCdzAchievementBucketTable("cdzConfirmedBucketBody", computeCdzAchievementBuckets("confirmed"));
}

function prepareCommercialDebundlizedData() {
  const computed = computeCommercialDebundlized();
  state.cdzDataPrepared = computed.rows;
  state.cdzDaysUntilYesterday = computed.daysUntilYesterday;

  const totalSkus = state.cdzDataPrepared.length;
  const inPlan = state.cdzDataPrepared.filter(d => d.hasTarget).length;
  const achieved = state.cdzDataPrepared.filter(d => d.hasTarget && d.mtdTarget && d.mtdActual >= d.mtdTarget).length;
  // التوتال هنا بياخد الرقم الحقيقي الغير مكرر (كل أوردر اتحسب مرة واحدة بس)،
  // مش مجموع القيم لكل Single في الجدول اللي ممكن نفس الأوردر يتكرر فيها أكتر
  // من مرة لو كان جوه بندل بيحتوي على أكتر من Single.
  const totalGmv = computed.overallDeliveredGmv;
  const totalCm3 = computed.overallCm3;

  if ($("cdzTotalSkus")) $("cdzTotalSkus").textContent = fmtInt.format(totalSkus);
  if ($("cdzInPlan")) $("cdzInPlan").textContent = fmtInt.format(inPlan);
  if ($("cdzAchieved")) $("cdzAchieved").textContent = fmtInt.format(achieved);
  if ($("cdzTotalGmv")) $("cdzTotalGmv").textContent = fmtMoneyCompact(totalGmv);
  if ($("cdzTotalCm3")) $("cdzTotalCm3").textContent = fmtMoneyCompact(totalCm3);

  renderCdzAchievementBuckets();

  cdzWireControlsOnce();
  applyCdzFilterAndSort();
}

function sortCdz(key) {
  if (state.cdzSortKey === key) { state.cdzSortDir = state.cdzSortDir === "asc" ? "desc" : "asc"; }
  else { state.cdzSortKey = key; state.cdzSortDir = "desc"; }
  applyCdzFilterAndSort();
}

function applyCdzFilterAndSort() {
  if (!state.cdzDataPrepared) return;
  let data = [...state.cdzDataPrepared];

  const q = $("searchCdzInput") ? $("searchCdzInput").value.trim().toLowerCase() : "";
  if (q) {
    data = data.filter(d => (d.singleId && d.singleId.toLowerCase().includes(q)) || (d.singleName && d.singleName.toLowerCase().includes(q)) || (d.category && d.category.toLowerCase().includes(q)));
  }

  const key = state.cdzSortKey; const dir = state.cdzSortDir === "asc" ? 1 : -1;
  data.sort((a, b) => {
    let valA = a[key]; let valB = b[key];
    if (valA === null || valA === undefined) valA = -Infinity;
    if (valB === null || valB === undefined) valB = -Infinity;
    if (typeof valA === "string") return valA.localeCompare(valB) * dir;
    return (valA - valB) * dir;
  });

  state.cdzFiltered = data;
  state.cdzPage = 0;
  renderPaginatedCdzTable();
}

// بيبني الأربع خلايا (MTD Target / Actual / Run Rate / Ach%) لمقياس واحد،
// بنفس شكل mpSpMetricCellsHtml بتاعة Sales Plan-ACM، لكن بيتعامل كمان مع
// حالة "مفيش تارجت مستقل للمقياس ده" (hasTarget=false) فبيعرض "Not in Plan".
function cdzMetricCellsHtml(m, isMoney) {
  const fmtV = (v) => isMoney ? fmtMoneyCompactCell(v) : fmtIntCell(Math.round(v));
  const targetCell = m.hasTarget ? fmtV(m.mtdTarget) : `<span class="badge-outline dim">Not in Plan</span>`;
  const achColor = m.hasTarget ? (m.achievedPct >= 100 ? 'green' : (m.achievedPct >= 85 ? 'orange' : 'red')) : 'dim';
  const achCell = m.hasTarget ? `<span class="badge-outline ${achColor}">${fmtPctCell(m.achievedPct)}</span>` : "—";
  return `
      <td class="num text-dim">${targetCell}</td>
      <td class="num font-bold">${fmtV(m.mtdActual)}</td>
      <td class="num">${fmtV(m.runRate)}</td>
      <td class="num">${achCell}</td>`;
}

// بيرندر صفحة واحدة بس (PAGE_SIZE صف) بدل كل السنجل اسكيوهات مرة واحدة —
// ده اللي كان بيهنج الصفحة لو عدد الـ Single SKUs كبير.
function renderPaginatedCdzTable() {
  const tbody = $("cdzTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const start = state.cdzPage * PAGE_SIZE;
  const pageRows = state.cdzFiltered.slice(start, start + PAGE_SIZE);
  const frag = document.createDocumentFragment();
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim" style="white-space:nowrap;">${m.singleId}</td>
      <td class="font-bold truncate-cell" title="${m.singleName}">${m.singleName}</td>
      <td class="text-dim truncate-cell" style="max-width:110px;" title="${m.category}">${m.category}</td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.stock))}</td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.doh))}</td>
      ${cdzMetricCellsHtml(m.metrics.placed, false)}
      ${cdzMetricCellsHtml(m.metrics.confirmed, false)}
      ${cdzMetricCellsHtml(m.metrics.delivered, false)}
      ${cdzMetricCellsHtml(m.metrics.gmv, true)}
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
      <td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompactCell(m.cm3)}</td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.cm3PerPiece)}</td>
      <td class="num font-bold text-dim">${fmtMoneyCompactCell(m.ppm)}</td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.ppmPerPiece)}</td>
      <td class="num">${fmtPctCell(m.cm3Pct)}</td>
      <td class="center"><span class="badge-outline ${m.finalStatus.cls}">${m.finalStatus.text}</span></td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  const totalPages = Math.max(1, Math.ceil(state.cdzFiltered.length / PAGE_SIZE));
  if ($("rowCountCdz")) $("rowCountCdz").textContent = `${fmtInt.format(state.cdzFiltered.length)} SKUs`;
  if ($("pageIndicatorCdz")) $("pageIndicatorCdz").textContent = `Page ${state.cdzPage + 1} of ${totalPages}`;
  if ($("prevPageCdz")) $("prevPageCdz").disabled = state.cdzPage === 0;
  if ($("nextPageCdz")) $("nextPageCdz").disabled = state.cdzPage >= totalPages - 1;
}

let cdzControlsWired = false;
function cdzWireControlsOnce() {
  if (cdzControlsWired) return; cdzControlsWired = true;
  if ($("searchCdzInput")) $("searchCdzInput").addEventListener("input", applyCdzFilterAndSort);
  if ($("prevPageCdz")) $("prevPageCdz").addEventListener("click", () => { if (state.cdzPage > 0) { state.cdzPage -= 1; renderPaginatedCdzTable(); } });
  if ($("nextPageCdz")) $("nextPageCdz").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(state.cdzFiltered.length / PAGE_SIZE)); if (state.cdzPage < totalPages - 1) { state.cdzPage += 1; renderPaginatedCdzTable(); } });
}

// =========================================================================
// CM3 ANALYST / PRODUCTS (تحت Commercial Debundlized) — تحليل على مستوى
// المنتج (SKU) بس، مباشرة من شيت الـ Main (MAIN_GID)، بنفس منطق/كات أوف الـ
// CM3 (CM3_LAG_DAYS) المستخدم في أي سكشن تاني مصدره نفس الشيت.
//
// الداتا بتتقسم بفلاتر Day / Week(5D) / Month / Overall — كل فلتر بيقارن
// آخر Period متاح في الداتا (لحد كات أوف الـ CM3) بالـ Period اللي قبله،
// عشان نعرف كل منتج CM3% بتاعه زاد ولا نقص (Overall مفيهاش مقارنة، لأنها
// شاملة الرينج كله دفعة واحدة).
//
// PPM Target: بيتقرا من شيت الـ Category Targets (CAT_TARGETS_GID) اللي
// اتقرا أصلاً في state.commercialTargets (نفس الصف اللي المستخدم ضافه في
// آخر الشيت باسم "PPM Target" بيتقرا generic بمطابقة النص، مش برقم صف
// ثابت). PPM Actual% = PPM/Piece الفعلي ÷ الـ Target ده. أي منتج بيحقق أقل
// من 80% بيتوسم "Fix PPM".
// =========================================================================
const CM3AP_PPM_FIX_THRESHOLD = 80;

function cm3apPeriodKeyForRow(rd, mode) { return mode === "overall" ? "ALL" : cm3PeriodLabel(rd, mode); }
function cm3apPeriodSort(rd, mode) { return mode === "overall" ? 0 : cm3PeriodSortKey(rd, mode); }

// تارجت الـ PPM بتاع الكاتيجوري (لو موجود ومتحقق فيه)، وإلا بيرجع لـ Grand
// Total (الصف العام اللي في آخر الشيت) كـ fallback.
// تارجت الـ PPM بتاع الكاتيجوري — بيتقرا من عمود "Target PPM Pieces" في شيت
// الـ Category Targets: ده رقم (قيمة PPM المستهدفة للقطعة) مش نسبة%. لو مش
// موجود للكاتيجوري ده بيرجع لـ Grand Total (الصف العام في آخر الشيت) كـ fallback.
function cm3apTargetPpmFor(category) {
  const targets = state.commercialTargets || {};
  const norm = normalizeName(category);
  if (targets[norm] && targets[norm].targetPpmPerPiece > 0) return targets[norm].targetPpmPerPiece;
  return (targets["grand total"] && targets["grand total"].targetPpmPerPiece) || 0;
}

// =========================================================================
// PRODUCTS BREAKDOWN — SERIES VIEW (Daily / Weekly عمود لكل يوم/أسبوع)
// -------------------------------------------------------------------------
// لما الفلتر يكون Daily أو Weekly، الجدول بيوريّ صف واحد لكل SKU وعمود لكل
// يوم (Placed PCS D1, D2, D3...) أو لكل أسبوع (كل 5 أيام مجمّعين سوا =
// Placed PCS W1, W2, W3...) لكل المقاييس. الترقيم (D1/W1) بيبدأ من أول يوم
// موجود فعليًا في الداتا المفلترة بالشهر المختار، مش من تاريخ اليوم في
// الكالندر — يعني لو النهاردة رابع يوم موجود في الداتا هيتعرض كـ D4.
//
// Placed/Confirmed/Delivered (وأي حاجة متوقفة عليهم زي CR%/DR%/NDR%)
// بتُجمع من كل الصفوف من غير أي Lag، فمفيش يوم/أسبوع يطلع صفر لمجرد قربه
// من النهاردة. الأعمدة المعتمدة على الـ CM3 (GMV, CM3, CM3%, PPM,
// PPM/Piece, PPM Actual%, PPM/GMV%) لوحدها بتحترم كات أوف الـ
// CM3_LAG_DAYS (زي أي سكشن تاني في الداشبورد)، فمن الطبيعي إنها تفضل صفر
// لآخر كذا يوم لسه الـ CM3 متأخر عليهم فعلاً — ده مش باج.
// =========================================================================
const CM3AP_SERIES_METRICS = [
  { key: "placed", label: "Placed PCS", fmt: "int", tip: "Pieces placed for this SKU in this period. No cutoff applied." },
  { key: "confirmed", label: "Confirmed PCS", fmt: "int", tip: "Pieces confirmed for this SKU in this period. No cutoff applied." },
  { key: "delivered", label: "Delivered PCS", fmt: "int", tip: "Pieces delivered for this SKU in this period. No cutoff applied." },
  { key: "crPct", label: "CR%", fmt: "pct", tip: "Confirmed ÷ Placed pieces for this period. No lag applied." },
  { key: "drPct", label: "DR%", fmt: "pct", tip: "Delivered ÷ Confirmed pieces for this period. No lag applied." },
  { key: "ndrPct", label: "NDR%", fmt: "pct", tip: "CR% × DR% for this period. No lag applied." },
  { key: "deliveredAsp", label: "Delivered ASP", fmt: "money", tip: "Average delivered selling price per piece in this period." },
  { key: "deliveredGmv", label: "Delivered GMV", fmt: "money", tip: "Delivered revenue for this SKU in this period. No cutoff applied." },
  { key: "cm3", label: "CM3", fmt: "money", tip: "Contribution margin for this period, excluding the most recent 5 days — recent periods can show zero until they clear the cutoff." },
  { key: "cm3Pct", label: "CM3%", fmt: "pct", tip: "CM3 as a % of delivered GMV for this period, under the 5-day cutoff." },
  { key: "ppm", label: "Total PPM", fmt: "money", tip: "Promotional spend for this SKU in this period. No cutoff applied." },
  { key: "ppmPerPiece", label: "PPM/Piece", fmt: "money", tip: "Promotional spend per delivered piece in this period." },
  { key: "ppmActualPct", label: "PPM Actual%", fmt: "pct", tip: "PPM/Piece actual as a % of Target PPM for this period." },
  { key: "ppmGmvRatio", label: "PPM/GMV%", fmt: "pct", tip: "Promotional spend as a % of delivered GMV for this period." }
];

function cm3apSeriesFmtCell(v, fmt) {
  if (v === null || v === undefined) return '<span class="text-dim">-</span>';
  if (fmt === "pct") return fmtPctCell(v);
  if (fmt === "money") return fmtMoneyCompactCell(v);
  return fmtIntCell(v);
}

function buildCm3ApSeriesData(periodMode) {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const rows = (state.allParsedRows || []).filter(r => selectedMonth === "" || r.monthYear === selectedMonth);
  if (!rows.length) return { skuList: [], periodLabels: [] };

  const cm3Cutoff = getCm3LagCutoffTimestamp(rows);
  const crCutoff = getLagCutoffTimestamp(rows, CR_LAG_DAYS);

  // كل الأيام (تاريخ فقط، من غير وقت) اللي فيها أي صف، مرتبة زمنياً من الأقدم للأحدث.
  const dateSet = new Set();
  rows.forEach(r => { if (!r.sku) return; const d = new Date(r.timestamp); d.setHours(0, 0, 0, 0); dateSet.add(d.getTime()); });
  const sortedDays = Array.from(dateSet).sort((a, b) => a - b);
  if (!sortedDays.length) return { skuList: [], periodLabels: [] };

  // Daily: كل يوم لوحده. Weekly: كل 5 أيام (بالترتيب الزمني) مجمّعين في "أسبوع" واحد.
  const buckets = [];
  if (periodMode === "weekly") {
    for (let i = 0; i < sortedDays.length; i += 5) buckets.push({ label: `W${buckets.length + 1}`, days: sortedDays.slice(i, i + 5) });
  } else {
    sortedDays.forEach(() => buckets.push({ label: `D${buckets.length + 1}`, days: [sortedDays[buckets.length]] }));
  }
  const dayToBucket = new Map();
  buckets.forEach((b, idx) => b.days.forEach(d => dayToBucket.set(d, idx)));

  const skuMap = new Map();
  rows.forEach(r => {
    if (!r.sku) return;
    const d = new Date(r.timestamp); d.setHours(0, 0, 0, 0);
    const bIdx = dayToBucket.get(d.getTime());
    if (bIdx === undefined) return;
    if (!skuMap.has(r.sku)) skuMap.set(r.sku, { sku: r.sku, category: r.category || "Uncategorized", buckets: new Map() });
    const sEntry = skuMap.get(r.sku);
    if ((!sEntry.category || sEntry.category === "Uncategorized") && r.category) sEntry.category = r.category;
    if (!sEntry.buckets.has(bIdx)) {
      sEntry.buckets.set(bIdx, { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0, crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, ppmPerPieceWeighted: 0, ppmPerPieceWeight: 0, aspWeighted: 0, aspWeight: 0 });
    }
    const b = sEntry.buckets.get(bIdx);
    // Placed/Confirmed/Delivered/GMV/ASP/CR%/DR%/NDR% من غير أي Lag — دي كلها أرقام
    // فعلية جاهزة على مستوى نفس الصف (مش محسوبة لاحقًا)، فميطلعوش صفر لمجرد إن
    // اليوم/الأسبوع ده قريب من النهاردة.
    b.placed += r.placedPieces || 0; b.confirmed += r.confirmedPieces || 0; b.delivered += r.deliveredPieces || 0;
    b.deliveredGmv += r.deliveredGmv || 0;
    b.drConfirmed += r.confirmedPieces || 0; b.drDelivered += r.deliveredPieces || 0;
    b.crPlaced += r.placedPieces || 0; b.crConfirmed += r.confirmedPieces || 0;
    b.aspWeighted += (r.deliveredAsp || 0) * (r.deliveredPieces || 0);
    b.aspWeight += (r.deliveredPieces || 0);
    // الـ CM3 بيحترم كات أوف الـ CM3_LAG_DAYS، لأن عمود الربحية في الشيت نفسه
    // بيتأخر تعبيته أيام قبل ما يوصل — ده مش باج، ده طبيعة مصدر الداتا.
    if (isCm3RowEligible(r, cm3Cutoff)) {
      b.cm3 += r.cm3 || 0; b.cm3Gmv += r.deliveredGmv || 0;
    }
    // PPM (Total) و PPM/Piece — من غير أي كات أوف خالص (بطلب صريح)، بعكس CM3.
    b.ppm += (r.ppm || 0);
    b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0);
    b.ppmPerPieceWeight += (r.deliveredPieces || 0);
  });

  function metricsForBucket(b) {
    if (!b) return { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Pct: 0, ppm: 0, ppmPerPiece: 0, crPct: 0, drPct: 0, ndrPct: 0, deliveredAsp: 0 };
    const cm3Pct = b.cm3Gmv ? (b.cm3 / b.cm3Gmv) * 100 : 0;
    const ppmPerPiece = b.ppmPerPieceWeight ? (b.ppmPerPieceWeighted / b.ppmPerPieceWeight) : (b.delivered ? (b.ppm / b.delivered) : 0);
    const deliveredAsp = b.aspWeight ? (b.aspWeighted / b.aspWeight) : 0;
    const crPct = b.crPlaced ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    return { placed: b.placed, confirmed: b.confirmed, delivered: b.delivered, deliveredGmv: b.deliveredGmv, cm3: b.cm3, cm3Pct, ppm: b.ppm, ppmPerPiece, crPct, drPct, ndrPct, deliveredAsp };
  }

  const skuList = [];
  skuMap.forEach(s => {
    // بيتضم لو عنده أي Placed في أي يوم/أسبوع ضمن الرينج، مش بس آخر يوم — عشان
    // منتج نشط يوم 1/2/3 ومفيش عنده Placed في آخر يوم يفضل يظهر بالداتا الحقيقية بتاعته.
    const totalPlaced = Array.from(s.buckets.values()).reduce((sum, b) => sum + b.placed, 0);
    if (totalPlaced <= 0) return;
    const targetPpm = cm3apTargetPpmFor(s.category);
    const periodsData = buckets.map((bkt, idx) => {
      const m = metricsForBucket(s.buckets.get(idx));
      const ppmGmvRatio = m.deliveredGmv ? (m.ppm / m.deliveredGmv) * 100 : 0;
      // Actual PPM% = فعلي PPM/Piece (رقم كاش) ÷ Target PPM Pieces (رقم كاش برضو) — مش نسبة% لنسبة%.
      const ppmActualPct = targetPpm > 0 ? (m.ppmPerPiece / targetPpm) * 100 : null;
      return { ...m, ppmGmvRatio, ppmActualPct };
    });
    const skuName = (state.inventoryMap && state.inventoryMap[s.sku] && state.inventoryMap[s.sku].skuName) || "";
    skuList.push({ sku: s.sku, skuName, category: s.category || "Uncategorized", targetPpm, periodsData });
  });

  skuList.sort((a, b) => a.sku.localeCompare(b.sku));
  return { skuList, periodLabels: buckets.map(b => b.label) };
}

function buildCm3AnalystProductsData(periodMode) {
  // بيحترم فلتر الشهر العام اللي فوق الموقع (نفس شيت monthSelect المستخدم في كل
  // سكشن تاني) — لو مفيش شهر مختار (All Months) بيدي كل الداتا زي ما هي.
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const rows = (state.allParsedRows || []).filter(r => selectedMonth === "" || r.monthYear === selectedMonth);
  if (!rows.length) return { products: [], latestPeriod: null, prevPeriod: null };
  const cm3Cutoff = getCm3LagCutoffTimestamp(rows);
  const crCutoff = getLagCutoffTimestamp(rows, CR_LAG_DAYS); // نفس اليومين المستخدمين لـ CR% في أي مكان تاني

  // sku -> { category, periods: Map(period -> bucket) }
  const skuMap = new Map();
  // مقارنة "vs Previous Period" بتاعة الـ CM3% لازم تفضل شغالة حتى لو المستخدم فاتح
  // Overall (اللي مفيهوش غير Period واحد أصلاً فمفيش حاجة تتقارن بيها). فبنجمّع كمان
  // نسخة أسبوعية (Weekly) ثابتة من نفس الداتا بغض النظر عن الـ periodMode المختار،
  // وبنستخدمها بس لحساب آخر 2 Period فيهم نشاط فعلي — مش لعرض الأرقام نفسها.
  const deltaSkuMap = new Map();
  rows.forEach(r => {
    if (!r.sku) return;
    const rd = new Date(r.timestamp); rd.setHours(0, 0, 0, 0);
    const period = cm3apPeriodKeyForRow(rd, periodMode);
    const periodSort = cm3apPeriodSort(rd, periodMode);
    if (!skuMap.has(r.sku)) skuMap.set(r.sku, { sku: r.sku, category: r.category || "Uncategorized", periods: new Map() });
    const sEntry = skuMap.get(r.sku);
    if ((!sEntry.category || sEntry.category === "Uncategorized") && r.category) sEntry.category = r.category;
    if (!sEntry.periods.has(period)) {
      sEntry.periods.set(period, {
        period, periodSort, placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0,
        crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0,
        ppmPerPieceWeighted: 0, ppmPerPieceWeight: 0, aspWeighted: 0, aspWeight: 0
      });
    }
    const b = sEntry.periods.get(period);
    // زي أي حساب تاني مصدره MAIN_GID: Placed/Confirmed/Delivered/GMV/ASP/CR%/DR%/NDR%
    // من غير أي لاج — دي أرقام فعلية جاهزة على مستوى الصف. الـ CM3/CM3%/PPM بس
    // هما اللي بيحترموا كات أوف الـ 4 أيام بالظبط، لأن عمود الربحية بيتأخر تعبيته.
    b.placed += r.placedPieces; b.confirmed += r.confirmedPieces; b.delivered += r.deliveredPieces;
    b.deliveredGmv += r.deliveredGmv;
    b.drConfirmed += r.confirmedPieces; b.drDelivered += r.deliveredPieces;
    b.crPlaced += r.placedPieces; b.crConfirmed += r.confirmedPieces;
    b.aspWeighted += (r.deliveredAsp || 0) * (r.deliveredPieces || 0);
    b.aspWeight += (r.deliveredPieces || 0);
    if (isCm3RowEligible(r, cm3Cutoff)) {
      b.cm3 += r.cm3; b.cm3Gmv += r.deliveredGmv;
    }
    // PPM (Total) و PPM/Piece — من غير أي كات أوف خالص (بطلب صريح)، بعكس
    // CM3/CM3% اللي لسه بياخدوا كات أوف الـ 4 أيام فوق. PPM_PER_PIECE (عمود
    // AD) بيتقرا مباشرة من الشيت مش بيتحسب — بنعمله Weighted Average على
    // أساس الـ Delivered Pieces بتاعة كل صف عشان نجمع أكتر من صف/تاجر لنفس
    // الـ SKU صح.
    b.ppm += (r.ppm || 0);
    b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0);
    b.ppmPerPieceWeight += (r.deliveredPieces || 0);

    const wPeriod = cm3apPeriodKeyForRow(rd, "weekly");
    const wSort = cm3apPeriodSort(rd, "weekly");
    if (!deltaSkuMap.has(r.sku)) deltaSkuMap.set(r.sku, new Map());
    const dPeriods = deltaSkuMap.get(r.sku);
    if (!dPeriods.has(wPeriod)) dPeriods.set(wPeriod, { periodSort: wSort, placed: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0 });
    const db = dPeriods.get(wPeriod);
    db.placed += r.placedPieces; db.deliveredGmv += r.deliveredGmv;
    if (isCm3RowEligible(r, cm3Cutoff)) { db.cm3 += r.cm3; db.cm3Gmv += r.deliveredGmv; }
  });

  // كل الـ Periods الموجودة في الداتا كلها، مرتبة زمنياً.
  const periodSortMap = new Map();
  skuMap.forEach(s => s.periods.forEach(b => { if (!periodSortMap.has(b.period)) periodSortMap.set(b.period, b.periodSort); }));
  const allPeriodsSorted = Array.from(periodSortMap.keys()).sort((a, b) => periodSortMap.get(a) - periodSortMap.get(b));
  const latestPeriod = allPeriodsSorted.length ? allPeriodsSorted[allPeriodsSorted.length - 1] : null;
  const prevPeriod = allPeriodsSorted.length > 1 ? allPeriodsSorted[allPeriodsSorted.length - 2] : null;

  // نفس الفكرة، بس على الخريطة الأسبوعية الثابتة (للمقارنة فقط).
  const deltaPeriodSortMap = new Map();
  deltaSkuMap.forEach(dPeriods => dPeriods.forEach((b, p) => { if (!deltaPeriodSortMap.has(p)) deltaPeriodSortMap.set(p, b.periodSort); }));
  const deltaPeriodsSorted = Array.from(deltaPeriodSortMap.keys()).sort((a, b) => deltaPeriodSortMap.get(a) - deltaPeriodSortMap.get(b));

  function metricsFor(b) {
    if (!b) return { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Pct: 0, ppm: 0, ppmPerPiece: 0, crPct: 0, drPct: 0, ndrPct: 0, deliveredAsp: 0 };
    const cm3Pct = b.cm3Gmv ? (b.cm3 / b.cm3Gmv) * 100 : 0;
    // Actual PPM/Piece = عمود PPM_PER_PIECE (AD) نفسه، مش ناتج قسمة Total PPM على Delivered.
    // بيرجع لقسمة Total PPM (AB) / Delivered كـ fallback لو مفيش قيمة في عمود AD أصلاً.
    const ppmPerPiece = b.ppmPerPieceWeight ? (b.ppmPerPieceWeighted / b.ppmPerPieceWeight) : (b.delivered ? (b.ppm / b.delivered) : 0);
    const deliveredAsp = b.aspWeight ? (b.aspWeighted / b.aspWeight) : 0;
    const crPct = b.crPlaced ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    return { placed: b.placed, confirmed: b.confirmed, delivered: b.delivered, deliveredGmv: b.deliveredGmv, cm3: b.cm3, cm3Pct, ppm: b.ppm, ppmPerPiece, crPct, drPct, ndrPct, deliveredAsp };
  }

  // بيرجع آخر 2 Period أسبوعي (من الأحدث للأقدم) فيهم فعلاً نشاط لنفس المنتج —
  // بغض النظر عن الـ periodMode المختار في العرض، عشان "New" متظهرش غلط لمجرد
  // إن Overall مفيهوش غير Period واحد.
  function findLastTwoWeeksWithData(dPeriods) {
    if (!dPeriods) return [null, null];
    const found = [];
    for (let i = deltaPeriodsSorted.length - 1; i >= 0 && found.length < 2; i--) {
      const p = deltaPeriodsSorted[i];
      const b = dPeriods.get(p);
      // مهم: لازم يبقى فيه CM3 GMV فعلي (يعني تم تسليم حاجة بالفعل وعدت الـ CM3
      // Lag Cutoff) عشان الأسبوع ده يتحسب في المقارنة. لو استخدمنا Placed>0 بس
      // (زي الكود القديم)، أسبوع لسه معندوش أي Delivered (لسه في الطريق/مرتجع)
      // كان بيتحسب CM3%=0 (Fallback) وكأنها قيمة حقيقية، فيطلع دلتا وهمية ضخمة
      // (SKU يطلع Top Gainer/Decliner غلط لمجرد إنه لسه معندوش تسليم في آخر أسبوع).
      if (b && b.cm3Gmv > 0) found.push(b);
    }
    return [found[0] || null, found[1] || null];
  }

  const products = [];
  skuMap.forEach(s => {
    const curr = metricsFor(latestPeriod ? s.periods.get(latestPeriod) : null);
    if (curr.placed === 0 && curr.deliveredGmv === 0) return; // مفيش نشاط في آخر Period، اتجاهل
    const [wLatest, wPrev] = findLastTwoWeeksWithData(deltaSkuMap.get(s.sku));
    // مهم: الـ delta ولازم يكون مقارنة حقيقية بين آخر أسبوع فعلي فيه بيانات
    // والأسبوع اللي قبله بالظبط (مش بين متوسط الـ Period كله المختار فوق
    // زي "Overall" اللي بيجمع كل أسابيع الشهر مع بعض والأسبوع اللي قبل
    // الأخير). لو استخدمنا متوسط الشهر ككل كـ"الحالي"، منتج عمل Spike فجأة
    // في آخر أسبوع بس كان أداءه واطي بقية الشهر ممكن يطلع "نازل" غلط رغم إنه
    // في الحقيقة صاعد (Spike) — وده اللي كان بيحصل بالظبط.
    let deltaCm3Pct = null, prevCm3PctForDisplay = null, latestWeekCm3PctForDisplay = null;
    if (wLatest && wPrev) {
      const latestWeekCm3PctCalc = wLatest.cm3Gmv ? (wLatest.cm3 / wLatest.cm3Gmv) * 100 : 0;
      const prevCm3PctCalc = wPrev.cm3Gmv ? (wPrev.cm3 / wPrev.cm3Gmv) * 100 : 0;
      deltaCm3Pct = latestWeekCm3PctCalc - prevCm3PctCalc;
      prevCm3PctForDisplay = prevCm3PctCalc;
      latestWeekCm3PctForDisplay = latestWeekCm3PctCalc;
    }
    const hasPrev = deltaCm3Pct !== null;

    // Target PPM دلوقتي بيتقرا كرقم (Target PPM Pieces) مش نسبة% — فالمقارنة الصحيحة:
    // PPM/Piece الفعلي (رقم كاش) ÷ Target PPM Pieces (رقم كاش برضو).
    const targetPpm = cm3apTargetPpmFor(s.category);
    const ppmGmvRatio = curr.deliveredGmv ? (curr.ppm / curr.deliveredGmv) * 100 : 0;
    const ppmActualPct = targetPpm > 0 ? (curr.ppmPerPiece / targetPpm) * 100 : null;
    const needsFix = ppmActualPct !== null && ppmActualPct < CM3AP_PPM_FIX_THRESHOLD;
    const skuName = (state.inventoryMap && state.inventoryMap[s.sku] && state.inventoryMap[s.sku].skuName) || "";

    products.push({
      sku: s.sku, skuName, category: s.category || "Uncategorized",
      placed: curr.placed, confirmed: curr.confirmed, delivered: curr.delivered,
      crPct: curr.crPct, drPct: curr.drPct, ndrPct: curr.ndrPct, deliveredAsp: curr.deliveredAsp,
      deliveredGmv: curr.deliveredGmv, cm3: curr.cm3, cm3Pct: curr.cm3Pct,
      // prevCm3Pct/latestWeekCm3Pct دول بالظبط الرقمين اللي اتطرحوا من بعض عشان
      // يطلعوا deltaCm3Pct — مستخدمين بس في كروت Top Gainers/Decliners عشان
      // الأرقام المعروضة تتطابق حسابيًا مع الـ Delta تمامًا، من غير ما تتلخبط
      // بالـ cm3Pct العادي (اللي بيمثل الـ Period المختار فوق زي Overall).
      prevCm3Pct: hasPrev ? prevCm3PctForDisplay : null,
      latestWeekCm3Pct: hasPrev ? latestWeekCm3PctForDisplay : null,
      deltaCm3Pct,
      ppm: curr.ppm, ppmPerPiece: curr.ppmPerPiece, targetPpm, ppmActualPct, ppmGmvRatio,
      period: latestPeriod, status: targetPpm <= 0 ? "No Target" : (needsFix ? "Fix PPM" : "OK")
    });
  });

  return { products, latestPeriod, prevPeriod, allPeriodsSorted };
}

const cm3apState = { period: "overall", category: "All", sortKey: "cm3Pct", sortDir: "desc", sortKeySeries: null, sortDirSeries: "desc", page: 0, wired: false, catOptionsBuilt: false };
let cm3apDataAll = []; let cm3apFiltered = []; let cm3apMeta = { latestPeriod: null, prevPeriod: null };
let cm3apPipelineChartInst = null;
let cm3apSeriesAll = { skuList: [], periodLabels: [] };
let cm3apSeriesFiltered = [];
let cm3apStaticTheadHtml = null; // نسخة من الـ header الأصلي (Overall mode) عشان نرجعله زي ما هو

function restoreCm3apStaticThead() {
  const theadRow = document.querySelector("#cm3apTable thead tr");
  if (theadRow && cm3apStaticTheadHtml !== null) theadRow.innerHTML = cm3apStaticTheadHtml;
}

// قيمة السورت لأي عمود في جدول الـ Series (Daily/Weekly): "sku"/"skuName"/"category"/"targetPpm"
// ثابتين، وأي عمود مقياس بيتحدد بمفتاح "periodIndex|metricKey" (زي "2|drPct").
function cm3apSeriesSortValue(row, key) {
  if (key === "sku") return row.sku || "";
  if (key === "skuName") return row.skuName || "";
  if (key === "category") return row.category || "";
  if (key === "targetPpm") return row.targetPpm ?? -Infinity;
  const sep = key.indexOf("|");
  if (sep === -1) return -Infinity;
  const pIdx = parseInt(key.slice(0, sep), 10);
  const metricKey = key.slice(sep + 1);
  const period = row.periodsData ? row.periodsData[pIdx] : null;
  const v = period ? period[metricKey] : null;
  return (v === null || v === undefined) ? -Infinity : v;
}

function sortCm3apSeriesFiltered() {
  const key = cm3apState.sortKeySeries; if (!key) return;
  const dir = cm3apState.sortDirSeries === "asc" ? 1 : -1;
  cm3apSeriesFiltered.sort((a, b) => {
    const av = cm3apSeriesSortValue(a, key); const bv = cm3apSeriesSortValue(b, key);
    if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir;
  });
}

function sortCm3apSeries(key) {
  if (cm3apState.sortKeySeries === key) { cm3apState.sortDirSeries = cm3apState.sortDirSeries === "asc" ? "desc" : "asc"; }
  else { cm3apState.sortKeySeries = key; cm3apState.sortDirSeries = "desc"; }
  cm3apState.page = 0;
  sortCm3apSeriesFiltered();
  renderCm3apSeriesTable();
}

function cm3apSeriesSortArrow(key) {
  if (cm3apState.sortKeySeries !== key) return "";
  return cm3apState.sortDirSeries === "asc" ? " &#9650;" : " &#9660;";
}

// جدول الـ Products Breakdown في مود Daily/Weekly: عمود مقابل لكل يوم/أسبوع
// موجود في الداتا، لكل المقاييس. (Overall بيفضل زي ما هو بالجدول التقليدي.)
// كل عمود قابل للدوس عليه للسورت (تصاعدي/تنازلي)، مع سهم بيوري العمود المختار حاليًا.
function renderCm3apSeriesTable() {
  const theadRow = document.querySelector("#cm3apTable thead tr");
  const tbody = $("cm3apTableBody");
  if (!theadRow || !tbody) return;
  if (cm3apStaticTheadHtml === null) cm3apStaticTheadHtml = theadRow.innerHTML;

  const periodLabels = cm3apSeriesAll.periodLabels || [];
  const th = (key, label, extraClass, tip) => `<th class="${extraClass || ""}" style="cursor:pointer;" title="${((tip ? tip + " " : "") + "Click to sort").replace(/"/g, "&quot;")}" onclick="sortCm3apSeries('${key}')">${label}${cm3apSeriesSortArrow(key)}</th>`;
  let headHtml = th("sku", "SKU", "", "Unique product identifier.") + th("skuName", "SKU Name", "truncate-cell", "Product's display name.") + th("category", "Category", "truncate-cell", "Product category this SKU belongs to.");
  periodLabels.forEach((label, pIdx) => {
    const pColClass = `cm3ap-pcol-${pIdx % 4}`;
    CM3AP_SERIES_METRICS.forEach(m => { headHtml += th(`${pIdx}|${m.key}`, `${m.label} ${label}`, `num ${pColClass}`, m.tip); });
  });
  headHtml += th("targetPpm", "Target PPM", "num text-orange", "Target promotional spend per piece for this SKU's category (single column, not per-period).");
  theadRow.innerHTML = headHtml;

  const totalCols = 3 + periodLabels.length * CM3AP_SERIES_METRICS.length + 1;
  const start = cm3apState.page * PAGE_SIZE;
  const pageRows = cm3apSeriesFiltered.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="${totalCols}" class="text-dim center">No qualifying data for this range.</td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map(p => {
      let rowHtml = `<td class="font-mono text-light font-bold">${p.sku}</td><td class="truncate-cell text-dim" title="${p.skuName || ""}">${p.skuName || '<span class="text-dim">-</span>'}</td><td class="truncate-cell text-dim">${p.category}</td>`;
      p.periodsData.forEach((period, pIdx) => {
        const pColClass = `cm3ap-pcol-${pIdx % 4}`;
        CM3AP_SERIES_METRICS.forEach(m => { rowHtml += `<td class="num ${pColClass}">${cm3apSeriesFmtCell(period[m.key], m.fmt)}</td>`; });
      });
      rowHtml += `<td class="num text-orange">${p.targetPpm > 0 ? fmtMoneyCompactCell(p.targetPpm) : '<span class="text-dim">-</span>'}</td>`;
      return `<tr>${rowHtml}</tr>`;
    }).join("");
  }

  const totalPages = Math.max(1, Math.ceil(cm3apSeriesFiltered.length / PAGE_SIZE));
  if ($("rowCountCm3ap")) $("rowCountCm3ap").textContent = `${fmtInt.format(cm3apSeriesFiltered.length)} Products`;
  if ($("pageIndicatorCm3ap")) $("pageIndicatorCm3ap").textContent = `Page ${cm3apState.page + 1} of ${totalPages}`;
  if ($("prevPageCm3ap")) $("prevPageCm3ap").disabled = cm3apState.page === 0;
  if ($("nextPageCm3ap")) $("nextPageCm3ap").disabled = cm3apState.page >= totalPages - 1;
}

// بيقرر يرندر جدول الـ Overall التقليدي ولا جدول الـ Series (Daily/Weekly) —
// مستخدمة في أماكن بره applyCm3apFilterAndSort زي تحميل CSV.
function renderCm3apActiveTable() {
  if (cm3apState.period === "overall") { restoreCm3apStaticThead(); renderPaginatedCm3apTable(); }
  else { renderCm3apSeriesTable(); }
}

function populateCm3apCategoryFilter(products) {
  const sel = $("cm3apCategorySelect"); if (!sel) return;
  const current = sel.value || "All";
  const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="All">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join("");
  sel.value = cats.includes(current) ? current : "All";
}

function cm3apDeltaBadge(delta) {
  if (delta === null) return `<span class="badge-outline gray">New</span>`;
  const cls = delta > 0.05 ? "green" : (delta < -0.05 ? "red" : "gray");
  return `<span class="badge-outline ${cls}">${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%</span>`;
}

function cm3apStatusBadge(status) {
  if (status === "Fix PPM") return `<span class="badge-outline red">Fix PPM</span>`;
  if (status === "OK") return `<span class="badge-outline green">OK</span>`;
  return `<span class="badge-outline gray">No Target</span>`;
}

// بيب لاين جرافيكي (Placed -> Confirmed -> Delivered) مقسّم لكل Category على حدة
// (مش رقم واحد إجمالي)، لنفس الداتا المفلترة حالياً بحسب الـ Period المختار
// (Day/Week/Overall) والـ Category/Search — زي ستايل شارت "Pipeline Velocity"
// في الـ Overview بس بتاعة الـ Products هنا وبتتقسم Category.
function renderCm3apPipelineChart(products) {
  const canvas = document.getElementById("cm3apPipelineChart"); if (!canvas) return;

  const catMap = new Map();
  products.forEach(p => {
    const cat = p.category || "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { category: cat, placed: 0, confirmed: 0, delivered: 0 });
    const e = catMap.get(cat);
    e.placed += p.placed || 0; e.confirmed += p.confirmed || 0; e.delivered += p.delivered || 0;
  });
  const catRows = Array.from(catMap.values()).filter(c => c.placed > 0).sort((a, b) => b.placed - a.placed);

  const ctx = canvas.getContext("2d");
  if (cm3apPipelineChartInst) cm3apPipelineChartInst.destroy();
  Chart.defaults.color = "#94a3b8"; Chart.defaults.font.family = "Inter";

  if (!catRows.length) {
    const statsBox = $("cm3apPipelineStats");
    if (statsBox) statsBox.innerHTML = `<div class="text-dim">No qualifying data for this period.</div>`;
    return;
  }

  cm3apPipelineChartInst = new Chart(ctx, {
    type: "bar",
    data: {
      labels: catRows.map(c => c.category),
      datasets: [
        { label: "Placed", data: catRows.map(c => c.placed), backgroundColor: "#475569", borderRadius: 6 },
        { label: "Confirmed", data: catRows.map(c => c.confirmed), backgroundColor: "#3b82f6", borderRadius: 6 },
        { label: "Delivered", data: catRows.map(c => c.delivered), backgroundColor: "#10b981", borderRadius: 6 }
      ]
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { boxWidth: 12, color: "#e2e8f0" } },
        tooltip: { backgroundColor: "#1e293b", titleColor: "#f8fafc", bodyColor: "#cbd5e1", borderColor: "#334155", borderWidth: 1, padding: 10 }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: "#1e293b", borderDash: [4, 4], drawBorder: false }, ticks: { callback: (v) => v >= 1000 ? (v / 1000) + "k" : v } },
        y: { grid: { display: false, drawBorder: false }, ticks: { color: "#e2e8f0", font: { weight: "600" } } }
      }
    }
  });

  const statsBox = $("cm3apPipelineStats");
  if (statsBox) {
    statsBox.innerHTML = catRows.map(c => {
      const crPct = c.placed ? (c.confirmed / c.placed) * 100 : 0;
      const drPct = c.confirmed ? (c.delivered / c.confirmed) * 100 : 0;
      return `
      <div class="cm3ap-pipeline-stat">
        <div class="k">${c.category}</div>
        <div class="v"><span class="text-blue">CR ${fmtPctCell(crPct)}</span> &middot; <span class="text-green">DR ${fmtPctCell(drPct)}</span></div>
        <div class="sub">${fmtIntCell(c.placed)} &rarr; ${fmtIntCell(c.confirmed)} &rarr; ${fmtIntCell(c.delivered)} pcs</div>
      </div>`;
    }).join("");
  }
}

// بيرجع الميديان (الوسيط) بتاع مصفوفة أرقام — مستخدم عشان نحدد إيه هو
// "أداء عالي" (High Performer) بشكل نسبي للداتا الحالية، بدل رقم ثابت.
function cm3apMedian(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
// Top CM3% Decliners: مش أي منتج عمل سوينج كبير — لازم يكون أصلاً "منتج
// مهم" (عالي في الـ Delivered GMV وكان عالي في الـ CM3% قبل النزول)، وبعدين
// من بين المنتجات دي بس بناخد أسوأ نزول (فرق نقاط الـ CM3% بين آخر Period
// واللي قبله — زي مثال 10% -> 5% يبقى Declined بـ 5 نقاط).
function cm3apTopDecliners(withDelta, count) {
  const candidates = withDelta.filter(p => p.deliveredGmv > 0 && p.deltaCm3Pct < 0);
  const gmvMedian = cm3apMedian(candidates.map(p => p.deliveredGmv));
  const prevCm3Median = cm3apMedian(candidates.map(p => p.prevCm3Pct ?? 0));
  let pool = candidates.filter(p => p.deliveredGmv >= gmvMedian && (p.prevCm3Pct ?? 0) >= prevCm3Median);
  if (!pool.length) pool = candidates; // fallback لو الفلتر ضيّق الداتا لحد ما تفضى
  return [...pool].sort((a, b) => a.deltaCm3Pct - b.deltaCm3Pct).slice(0, count);
}
// Top CM3% Gainers: نفس فكرة الـ Decliners بالظبط لكن معكوسة، وبنفس المصدر
// بالظبط (p.deltaCm3Pct — آخر Period واللي قبله) عشان منتج واحد يستحيل
// يظهر في الكارتين مع بعض (Gainer لازم يكون Delta موجب، Decliner لازم يكون
// Delta سالب — الاتنين مبنيين على نفس الرقم بالظبط فمفيش تعارض تاني).
// برضو لازم يكون منتج مهم (عالي في الـ Delivered GMV وعالي في الـ CM3%
// الحالي بعد الزيادة)، وبعدين من بينهم أعلى زيادة نقاط.
function cm3apTopGainers(withDelta, count) {
  const candidates = withDelta.filter(p => p.deliveredGmv > 0 && p.deltaCm3Pct > 0);
  const gmvMedian = cm3apMedian(candidates.map(p => p.deliveredGmv));
  const cm3PctMedian = cm3apMedian(candidates.map(p => p.latestWeekCm3Pct ?? 0));
  let pool = candidates.filter(p => p.deliveredGmv >= gmvMedian && (p.latestWeekCm3Pct ?? 0) >= cm3PctMedian);
  if (!pool.length) pool = candidates; // fallback لو الفلتر ضيّق الداتا لحد ما تفضى
  return [...pool].sort((a, b) => b.deltaCm3Pct - a.deltaCm3Pct).slice(0, count);
}

function renderCm3apInsights(products, meta) {
  const box = $("cm3apInsights"); if (!box) return;
  if (!products.length) { box.innerHTML = `<div class="text-dim">No qualifying data for this period.</div>`; return; }

  const qualifying = products.filter(p => p.placed >= CM3_MIN_PLACED_PIECES);
  const withDelta = qualifying.filter(p => p.deltaCm3Pct !== null);
  const topGainers = cm3apTopGainers(withDelta, 3);
  const topDecliners = cm3apTopDecliners(withDelta, 3);
  const fixList = qualifying.filter(p => p.status === "Fix PPM").sort((a, b) => (a.ppmActualPct ?? 0) - (b.ppmActualPct ?? 0)).slice(0, 5);
  const negativeCm3 = qualifying.filter(p => p.cm3 < 0).length;

  const listItem = (p, valueHtml) => `<li><span class="font-mono text-dim">${p.sku}</span>${p.skuName ? `<span class="cm3ap-insight-name" title="${p.skuName}">${p.skuName}</span>` : ""} <span class="text-dim">(${p.category})</span> — ${valueHtml}</li>`;
  // الأرقام المعروضة هنا (prevCm3Pct -> latestWeekCm3Pct) هي بالظبط نفس
  // الرقمين اللي اتطرحوا من بعض عشان يطلعوا الـ Delta — فمينفعش تتلخبط
  // اتجاهاتها أبداً (Gainer يبان صاعد فعلاً، Decliner يبان نازل فعلاً).
  const movementValue = (p) => `${cm3apDeltaBadge(p.deltaCm3Pct)} <span class="text-dim">(${fmtPctCell(p.prevCm3Pct ?? 0)} &rarr; ${fmtPctCell(p.latestWeekCm3Pct ?? 0)}, ${fmtMoneyCompactCell(p.deliveredGmv)} GMV)</span>`;

  let html = `<div class="cm3ap-insights-grid">`;
  html += `<div class="cm3ap-insight-card"><h4 class="text-green">Top CM3% Gainers</h4><ul>${
    topGainers.length ? topGainers.map(p => listItem(p, movementValue(p))).join("") : `<li class="text-dim">No period-over-period data yet.</li>`
  }</ul></div>`;
  html += `<div class="cm3ap-insight-card"><h4 class="text-red">Top CM3% Decliners</h4><ul>${
    topDecliners.length ? topDecliners.map(p => listItem(p, movementValue(p))).join("") : `<li class="text-dim">No period-over-period data yet.</li>`
  }</ul></div>`;
  html += `<div class="cm3ap-insight-card"><h4 class="text-orange">Needs PPM Fix (Top 5 Worst)</h4><ul>${
    fixList.length ? fixList.map(p => listItem(p, `${fmtPctCell(p.ppmActualPct)} of target`)).join("") : `<li class="text-dim">Nothing below 80% of Target PPM right now.</li>`
  }</ul></div>`;
  html += `<div class="cm3ap-insight-card"><h4>Quick Read</h4><ul>
    <li>${fmtIntCell(qualifying.length)} qualifying products (Placed Pieces &ge; ${CM3_MIN_PLACED_PIECES}) out of ${fmtIntCell(products.length)} active this period.</li>
    <li>${fmtIntCell(negativeCm3)} product(s) delivering negative CM3.</li>
    <li>${fmtIntCell(qualifying.filter(p => p.status === "Fix PPM").length)} product(s) flagged Fix PPM (below ${CM3AP_PPM_FIX_THRESHOLD}% of target).</li>
    <li>Current period: <span class="text-dim">${meta.latestPeriod || "-"}</span>${meta.prevPeriod ? ` · Compared to <span class="text-dim">${meta.prevPeriod}</span>` : ""}</li>
  </ul></div>`;
  html += `</div>`;
  box.innerHTML = html;
}

// سكشن "Top Movers" تحت الـ Products Breakdown: توب 4 Positive وتوب 4 Drops (بار مرئي بسيط لكل واحد).
function renderCm3apMovers(products) {
  const box = $("cm3apMovers"); if (!box) return;
  const qualifying = products.filter(p => p.placed >= CM3_MIN_PLACED_PIECES);
  const withDelta = qualifying.filter(p => p.deltaCm3Pct !== null);
  // نفس منطق كارت الـ Insights بالظبط، ونفس المصدر بالظبط (deltaCm3Pct) —
  // Top Positive لازم يكون Delta موجب، Top Drops لازم يكون Delta سالب، فمفيش
  // منتج ممكن يظهر في العمودين مع بعض زي ما كان بيحصل قبل كده.
  const topPositive = cm3apTopGainers(withDelta, 3);
  // Top Drops: نفس منطق كارت الـ Decliners بالظبط — لازم يكونوا منتجات مهمة
  // فعلاً (عالية في Delivered GMV وكانت عالية في CM3% قبل النزول)، بعدين
  // أسوأ نزول بينهم (فرق نقاط الـ CM3%).
  const topDrops = cm3apTopDecliners(withDelta, 3);
  const maxPositive = Math.max(1, ...topPositive.map(p => Math.abs(p.deltaCm3Pct)));
  const maxDrop = Math.max(1, ...topDrops.map(p => Math.abs(p.deltaCm3Pct)));

  const positiveRow = (p) => {
    const width = Math.min(100, (Math.abs(p.deltaCm3Pct) / maxPositive) * 100);
    return `<div class="cm3ap-mover-row">
      <div class="cm3ap-mover-info">
        <div class="cm3ap-mover-sku">${p.sku}${p.skuName ? `<span class="cm3ap-mover-name" title="${p.skuName}"> ${p.skuName}</span>` : ""}<span class="cm3ap-mover-cat"> · ${p.category}</span></div>
        <div class="cm3ap-mover-bar-track"><div class="cm3ap-mover-bar-fill" style="width:${width}%; background:#10b981;"></div></div>
      </div>
      <div class="cm3ap-mover-value" style="color:#10b981;">+${p.deltaCm3Pct.toFixed(1)}%</div>
    </div>`;
  };
  const dropRow = (p) => {
    const width = Math.min(100, (Math.abs(p.deltaCm3Pct) / maxDrop) * 100);
    return `<div class="cm3ap-mover-row">
      <div class="cm3ap-mover-info">
        <div class="cm3ap-mover-sku">${p.sku}${p.skuName ? `<span class="cm3ap-mover-name" title="${p.skuName}"> ${p.skuName}</span>` : ""}<span class="cm3ap-mover-cat"> · ${p.category}</span></div>
        <div class="cm3ap-mover-bar-track"><div class="cm3ap-mover-bar-fill" style="width:${width}%; background:#ef4444;"></div></div>
      </div>
      <div class="cm3ap-mover-value" style="color:#ef4444;">${p.deltaCm3Pct >= 0 ? "+" : ""}${p.deltaCm3Pct.toFixed(1)}%</div>
    </div>`;
  };

  box.innerHTML = `
    <div class="cm3ap-mover-col">
      <h4 class="text-green">Top 3 CM3% Gainers</h4>
      ${topPositive.length ? topPositive.map(p => positiveRow(p)).join("") : `<div class="text-dim" style="font-size:12px;">No qualifying data yet.</div>`}
    </div>
    <div class="cm3ap-mover-col">
      <h4 class="text-red">Top 3 CM3% Decliners</h4>
      ${topDrops.length ? topDrops.map(p => dropRow(p)).join("") : `<div class="text-dim" style="font-size:12px;">No period-over-period data yet.</div>`}
    </div>
  `;
}

function prepareCm3AnalystProductsData() {
  const periodMode = cm3apState.period;
  const built = buildCm3AnalystProductsData(periodMode);
  cm3apDataAll = built.products;
  cm3apMeta = built;

  // بره Overall: نبني كمان جدول الـ Series (عمود لكل يوم/أسبوع) للـ Products Breakdown.
  cm3apSeriesAll = periodMode !== "overall" ? buildCm3ApSeriesData(periodMode) : { skuList: [], periodLabels: [] };

  populateCm3apCategoryFilter(cm3apDataAll);

  const totalProducts = cm3apDataAll.length;
  const totalGmv = cm3apDataAll.reduce((s, p) => s + p.deliveredGmv, 0);
  const totalCm3 = cm3apDataAll.reduce((s, p) => s + p.cm3, 0);
  const totalPpm = cm3apDataAll.reduce((s, p) => s + p.ppm, 0);
  const overallCm3Pct = totalGmv ? (totalCm3 / totalGmv) * 100 : 0;
  const overallPpmGmvRatio = totalGmv ? (totalPpm / totalGmv) * 100 : 0;
  const fixCount = cm3apDataAll.filter(p => p.status === "Fix PPM").length;

  // دلتا الـ CM3% الأوفرال (مش لكل منتج): مجموع الـ CM3/GMV بتاع الـ Period اللي فات
  // كله، مقارنة بمجموع الـ Period الحالي — عشان نعرف الأداء العام زاد ولا نقص.
  let overallDelta = null;
  {
    const prevBuilt = cm3apDataAll.filter(p => p.deltaCm3Pct !== null);
    if (prevBuilt.length) {
      // تقدير مبسط: متوسط مرجح بالـ GMV الحالي للـ delta بتاع كل منتج (بدل ما نعيد بناء الـ GMV بتاع الـ Period اللي فات بالكامل).
      const weightedDeltaSum = prevBuilt.reduce((s, p) => s + (p.deltaCm3Pct * (p.deliveredGmv || 1)), 0);
      const weightSum = prevBuilt.reduce((s, p) => s + (p.deliveredGmv || 1), 0);
      overallDelta = weightSum ? (weightedDeltaSum / weightSum) : null;
    }
  }

  if ($("cm3apTotalProducts")) $("cm3apTotalProducts").textContent = fmtInt.format(totalProducts);
  if ($("cm3apPeriodLabel")) $("cm3apPeriodLabel").textContent = `Period: ${built.latestPeriod || "-"}`;
  if ($("cm3apTotalGmv")) $("cm3apTotalGmv").textContent = fmtMoneyCompact(totalGmv);
  if ($("cm3apTotalCm3")) $("cm3apTotalCm3").textContent = fmtMoneyCompact(totalCm3);
  if ($("cm3apCm3Pct")) $("cm3apCm3Pct").textContent = fmtPct(overallCm3Pct);
  if ($("cm3apCm3PctDelta")) {
    const el = $("cm3apCm3PctDelta");
    if (overallDelta === null) { el.textContent = "vs previous period: -"; el.className = "metric-sub text-dim"; }
    else { el.innerHTML = `vs previous period: ${cm3apDeltaBadge(overallDelta)}`; el.className = "metric-sub"; }
  }
  if ($("cm3apPpmGmvRatio")) $("cm3apPpmGmvRatio").textContent = fmtPct(overallPpmGmvRatio);
  if ($("cm3apTotalPpm")) $("cm3apTotalPpm").textContent = fmtMoneyCompact(totalPpm);
  if ($("cm3apFixPpmCount")) $("cm3apFixPpmCount").textContent = fmtInt.format(fixCount);
  if ($("cm3apTableSub")) $("cm3apTableSub").textContent = periodMode === "overall"
    ? "Full Range Up To The CM3 Cutoff"
    : (periodMode === "daily"
      ? `Daily breakdown — One Column Per Day (D1..D${cm3apSeriesAll.periodLabels.length})`
      : `Weekly breakdown — Every 5 Days Grouped As One Week (W1..W${cm3apSeriesAll.periodLabels.length})`);
  if ($("cm3apRangeInfo")) { const selectedMonth = $("monthSelect") ? $("monthSelect").value : ""; $("cm3apRangeInfo").textContent = selectedMonth || "All Months"; }

  cm3apState.page = 0;
  applyCm3apFilterAndSort();
  cm3apWireControlsOnce();
}

function sortCm3ap(key) {
  if (cm3apState.sortKey === key) { cm3apState.sortDir = cm3apState.sortDir === "asc" ? "desc" : "asc"; }
  else { cm3apState.sortKey = key; cm3apState.sortDir = "desc"; }
  applyCm3apFilterAndSort();
}

// السرش والكاتيجوري بيفلتروا مش بس جدول الـ Products Breakdown، لكن كمان
// الـ Pipeline & Insights (الشارت + الكروت) وسكشن الـ Top Movers، عشان كل
// السكاشن دي تتحرك مع بعض مع أي فلتر بيتعمل.
function applyCm3apFilterAndSort() {
  const q = $("cm3apSearchInput") ? $("cm3apSearchInput").value.trim().toLowerCase() : "";
  const cat = $("cm3apCategorySelect") ? $("cm3apCategorySelect").value : "All";
  let data = [...cm3apDataAll];
  if (cat && cat !== "All") data = data.filter(p => p.category === cat);
  if (q) data = data.filter(p => p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.skuName || "").toLowerCase().includes(q));

  const key = cm3apState.sortKey; const dir = cm3apState.sortDir === "asc" ? 1 : -1;
  data.sort((a, b) => {
    let av = a[key]; let bv = b[key];
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });

  cm3apFiltered = data;
  cm3apState.page = 0;

  if (cm3apState.period === "overall") {
    restoreCm3apStaticThead();
    renderPaginatedCm3apTable();
  } else {
    cm3apSeriesFiltered = (cm3apSeriesAll.skuList || []).filter(p => {
      if (cat && cat !== "All" && p.category !== cat) return false;
      if (q && !(p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.skuName || "").toLowerCase().includes(q))) return false;
      return true;
    });
    sortCm3apSeriesFiltered();
    renderCm3apSeriesTable();
  }

  renderCm3apPipelineChart(data);
  renderCm3apInsights(data, cm3apMeta);
  renderCm3apMovers(data);
}

function renderPaginatedCm3apTable() {
  const tbody = $("cm3apTableBody"); if (!tbody) return;
  tbody.innerHTML = "";
  const start = cm3apState.page * PAGE_SIZE;
  const pageRows = cm3apFiltered.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="20" class="text-dim center">No products match this filter.</td></tr>`;
  } else {
    pageRows.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="font-mono text-light font-bold">${p.sku}</td>
        <td class="truncate-cell text-dim" title="${p.skuName || ""}">${p.skuName || '<span class="text-dim">-</span>'}</td>
        <td class="truncate-cell text-dim">${p.category}</td>
        <td class="num">${fmtIntCell(p.placed)}</td>
        <td class="num text-blue">${fmtIntCell(p.confirmed)}</td>
        <td class="num">${fmtIntCell(p.delivered)}</td>
        <td class="num">${fmtPctCell(p.crPct)}</td>
        <td class="num">${fmtPctCell(p.drPct)}</td>
        <td class="num">${fmtPctCell(p.ndrPct)}</td>
        <td class="num">${p.deliveredAsp ? fmtMoneyCompactCell(p.deliveredAsp) : '<span class="text-dim">-</span>'}</td>
        <td class="num text-green">${fmtMoneyCompactCell(p.deliveredGmv)}</td>
        <td class="num">${fmtMoneyCompactCell(p.cm3)}</td>
        <td class="num font-bold text-purple">${fmtPctCell(p.cm3Pct)}</td>
        <td class="num">${cm3apDeltaBadge(p.deltaCm3Pct)}</td>
        <td class="num">${fmtMoneyCompactCell(p.ppm)}</td>
        <td class="num">${fmtMoneyCompactCell(p.ppmPerPiece)}</td>
        <td class="num text-orange">${p.targetPpm > 0 ? fmtMoneyCompactCell(p.targetPpm) : '<span class="text-dim">-</span>'}</td>
        <td class="num">${p.ppmActualPct !== null ? fmtPctCell(p.ppmActualPct) : '<span class="text-dim">-</span>'}</td>
        <td class="num">${fmtPctCell(p.ppmGmvRatio)}</td>
        <td class="center">${cm3apStatusBadge(p.status)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const totalPages = Math.max(1, Math.ceil(cm3apFiltered.length / PAGE_SIZE));
  if ($("rowCountCm3ap")) $("rowCountCm3ap").textContent = `${fmtInt.format(cm3apFiltered.length)} Products`;
  if ($("pageIndicatorCm3ap")) $("pageIndicatorCm3ap").textContent = `Page ${cm3apState.page + 1} of ${totalPages}`;
  if ($("prevPageCm3ap")) $("prevPageCm3ap").disabled = cm3apState.page === 0;
  if ($("nextPageCm3ap")) $("nextPageCm3ap").disabled = cm3apState.page >= totalPages - 1;
}

function cm3apWireControlsOnce() {
  if (cm3apState.wired) return; cm3apState.wired = true;
  document.querySelectorAll("#cm3apPeriodToggle .segmented-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#cm3apPeriodToggle .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active"); cm3apState.period = btn.dataset.period; prepareCm3AnalystProductsData();
    });
  });
  if ($("cm3apCategorySelect")) $("cm3apCategorySelect").addEventListener("change", applyCm3apFilterAndSort);
  // السرش موجود في مكانين (Products Breakdown و Pipeline & Insights) ومتزامنين مع بعض:
  // كل واحد بيحدث التاني وبعدين بيطبق الفلتر، عشان تجربة استخدام واحدة موحدة.
  if ($("cm3apSearchInput")) $("cm3apSearchInput").addEventListener("input", () => {
    if ($("cm3apSearchInput2")) $("cm3apSearchInput2").value = $("cm3apSearchInput").value;
    applyCm3apFilterAndSort();
  });
  if ($("cm3apSearchInput2")) $("cm3apSearchInput2").addEventListener("input", () => {
    if ($("cm3apSearchInput")) $("cm3apSearchInput").value = $("cm3apSearchInput2").value;
    applyCm3apFilterAndSort();
  });
  if ($("prevPageCm3ap")) $("prevPageCm3ap").addEventListener("click", () => { if (cm3apState.page > 0) { cm3apState.page -= 1; renderCm3apActiveTable(); } });
  if ($("nextPageCm3ap")) $("nextPageCm3ap").addEventListener("click", () => {
    const totalRows = cm3apState.period === "overall" ? cm3apFiltered.length : cm3apSeriesFiltered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    if (cm3apState.page < totalPages - 1) { cm3apState.page += 1; renderCm3apActiveTable(); }
  });
}

// -------------------------------------------------------------------------
// PERFORMANCE-MATCHES (Marketplace) — بيبني صف لكل Match (ميرشنت x برودكت) من
// شيت الـ Main (MAIN_GID) زي أي سكشن تاني في الداشبورد، وبيحترم فلتر الشهر/الـ
// ACM اللي فوق الصفحة. شيت الـ Sales Plan Performance (الـ "Single") مستخدم
// فقط في سكشن Sales Plan-ACM ومش بيتلمس هنا خالص.
// CM3/CM3% بياخدوا نفس الـ CM3_LAG_DAYS المطبقة على أي حساب مصدره MAIN_GID.
// باقي الأرقام (Total Placed/Confirmed/Delivered, CR%, DR%, Delivered GMV,
// Placed ASP, CONTR%) بتتحسب من كل البيانات المتاحة من غير أي Lag.
// -------------------------------------------------------------------------
function prepareMpMatchesData() {
  const mainRowsAll = state.allParsedRows || [];
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const mainRows = mainRowsAll.filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));

  const cm3Cutoff = getCm3LagCutoffTimestamp(mainRows); // بيانات المصدر هنا Main، فالـ CM3 لازم يرجع CM3_LAG_DAYS أيام

  const map = new Map();
  const productConfirmedTotals = new Map();

  // مفاتيح المتاشات اللي ليها تارجت في الـ Sales Plan-ACM (Merchant + Product)،
  // عشان بعدين نقدر نميز أي ماتش "برة البلان" (مفيهوش تارجت خالص).
  const planKeys = new Set((state.acmSalesPlanData || []).map(p => p.tagerId + "||" + p.productId));

  // Placed Pieces: من غير كات أوف خالص (الرقم الكامل زي ما هو، مفيش لاج على
  // الـ Placed أصلاً). Confirmed/Delivered Pieces لسه بياخدوا كات أوف الـ 4
  // أيام (زي الـ CM3 بالظبط) عشان يبقوا مؤكدين/متسلمين فعلاً.
  let totalPlacedPcs = 0, totalConfirmedPcs = 0, totalDeliveredPcs = 0;
  let outPlacedPcs = 0, outConfirmedPcs = 0, outDeliveredGmv = 0, inPlanDeliveredGmv = 0, grandDeliveredGmv = 0;
  const outPlanKeysSeen = new Set();

  mainRows.forEach(r => {
    if (!r.sku || !r.merchantId) return;
    const key = r.merchantId + "||" + r.sku;
    if (!map.has(key)) {
      map.set(key, {
        productId: r.sku, productName: (state.inventoryMap[r.sku] ? state.inventoryMap[r.sku].skuName : "Unknown") || "Unknown", merchantId: r.merchantId, merchantName: r.merchantName || r.merchantId, acm: r.acmName || "Unassigned",
        totalPlaced: 0, totalConfirmed: 0, totalDelivered: 0, placedGmv: 0, deliveredGmv: 0,
        crConfirmed: 0, crPlaced: 0, drDelivered: 0, drConfirmed: 0, cm3: 0, cm3Gmv: 0
      });
    }
    const e = map.get(key);
    e.totalPlaced += r.placedPieces; e.totalConfirmed += r.confirmedPieces; e.totalDelivered += r.deliveredPieces;
    e.placedGmv += r.placedGmv; e.deliveredGmv += r.deliveredGmv;
    e.crConfirmed += r.confirmedPieces; e.crPlaced += r.placedPieces;
    e.drDelivered += r.deliveredPieces; e.drConfirmed += r.confirmedPieces;
    totalPlacedPcs += r.placedPieces;

    // GMV in-plan/out-plan: بدون كات أوف (زي كارت Total Delivered GMV بالظبط
    // — الـ GMV مالهاش لاج أصلاً، اللاج بس على الـ CM3).
    grandDeliveredGmv += r.deliveredGmv;
    if (planKeys.has(key)) inPlanDeliveredGmv += r.deliveredGmv;
    else { outDeliveredGmv += r.deliveredGmv; outPlanKeysSeen.add(key); outPlacedPcs += r.placedPieces; }

    if (isCm3RowEligible(r, cm3Cutoff)) {
      e.cm3 += r.cm3; e.cm3Gmv += r.deliveredGmv;
      totalConfirmedPcs += r.confirmedPieces; totalDeliveredPcs += r.deliveredPieces;
      if (!planKeys.has(key)) outConfirmedPcs += r.confirmedPieces;
    }
    productConfirmedTotals.set(r.sku, (productConfirmedTotals.get(r.sku) || 0) + r.confirmedPieces);
  });

  let totalGmv = 0, totalCm3 = 0, totalCm3Gmv = 0;
  mpMatchesState.data = Array.from(map.values()).map(e => {
    const crPct = e.crPlaced ? (e.crConfirmed / e.crPlaced) * 100 : 0;
    const drPct = e.drConfirmed ? (e.drDelivered / e.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const productTotalConfirmed = productConfirmedTotals.get(e.productId) || 0;
    const contrPct = productTotalConfirmed ? (e.totalConfirmed / productTotalConfirmed) * 100 : 0;
    const placedAsp = e.totalPlaced ? (e.placedGmv / e.totalPlaced) : 0;
    const cm3PerPiece = e.totalDelivered ? (e.cm3 / e.totalDelivered) : 0;
    const cm3Pct = e.cm3Gmv ? (e.cm3 / e.cm3Gmv) * 100 : 0;
    totalGmv += e.deliveredGmv; totalCm3 += e.cm3; totalCm3Gmv += e.cm3Gmv;
    return { ...e, crPct, drPct, ndrPct, contrPct, placedAsp, cm3PerPiece, cm3Pct };
  });

  // CM3% الإجمالي: لازم ياخد نفس أساس الـ CM3 (كات أوف الـ4 أيام) في البسط
  // والمقام مع بعض — يعني Total CM3 ÷ الـ Delivered GMV بتاعة نفس الفترة
  // المؤهلة بس (e.cm3Gmv)، مش إجمالي الـ GMV الكامل من غير كات أوف. غير كده
  // النسبة كانت هتطلع أقل من الحقيقي (فيه GMV آخر 4 أيام في المقام من غير
  // CM3 مقابله في البسط).
  const overallCm3Pct = totalCm3Gmv ? (totalCm3 / totalCm3Gmv) * 100 : 0;

  if($("mpMatchesTotal")) $("mpMatchesTotal").textContent = fmtInt.format(mpMatchesState.data.length);
  if($("mpMatchesTotalGmv")) $("mpMatchesTotalGmv").textContent = fmtMoneyCompact(totalGmv);
  if($("mpMatchesTotalCm3")) $("mpMatchesTotalCm3").textContent = fmtMoneyCompact(totalCm3);
  if($("mpMatchesCm3Pct")) $("mpMatchesCm3Pct").textContent = fmtPct(overallCm3Pct);
  if($("mpMatchesTotalPlacedPcs")) $("mpMatchesTotalPlacedPcs").textContent = fmtInt.format(totalPlacedPcs);
  if($("mpMatchesTotalConfirmedPcs")) $("mpMatchesTotalConfirmedPcs").textContent = fmtInt.format(totalConfirmedPcs);
  if($("mpMatchesTotalDeliveredPcs")) $("mpMatchesTotalDeliveredPcs").textContent = fmtInt.format(totalDeliveredPcs);
  if($("mpMatchesInPlanGmv")) $("mpMatchesInPlanGmv").textContent = fmtMoneyCompact(inPlanDeliveredGmv);
  if($("mpMatchesOutPlanGmv")) $("mpMatchesOutPlanGmv").textContent = fmtMoneyCompact(outDeliveredGmv);
  if($("mpMatchesGrandGmv")) $("mpMatchesGrandGmv").textContent = fmtMoneyCompact(grandDeliveredGmv);

  // "برة البلان" Coverage: نسبة الماتشات اللي مفيهاش تارجت في Sales Plan-ACM.
  // Placed/GMV من غير كات أوف؛ Confirmed لسه بياخد كات أوف الـ 4 أيام زي فوق.
  const outPlacedPct = totalPlacedPcs ? (outPlacedPcs / totalPlacedPcs) * 100 : 0;
  const outConfirmedPct = totalConfirmedPcs ? (outConfirmedPcs / totalConfirmedPcs) * 100 : 0;
  const outGmvPct = grandDeliveredGmv ? (outDeliveredGmv / grandDeliveredGmv) * 100 : 0;
  if($("mpMatchesOutPlanCount")) $("mpMatchesOutPlanCount").textContent = fmtInt.format(outPlanKeysSeen.size);
  if($("mpMatchesOutPlanTotalCount")) $("mpMatchesOutPlanTotalCount").textContent = fmtInt.format(mpMatchesState.data.length);
  if($("mpMatchesOutPlanPlacedPct")) $("mpMatchesOutPlanPlacedPct").textContent = fmtPct(outPlacedPct);
  if($("mpMatchesOutPlanConfirmedPct")) $("mpMatchesOutPlanConfirmedPct").textContent = fmtPct(outConfirmedPct);
  if($("mpMatchesOutPlanGmvPct")) $("mpMatchesOutPlanGmvPct").textContent = fmtPct(outGmvPct);

  applyMpMatchesSearchAndSort();
}

// =====================================================================
// POOR MATCHES (تحت CM3 Analyst) — نفس شيت "Matches" + "NDR_Summary" اللي
// بعتهم، لكن محسوبة لايف من MAIN_GID:
//
//   1) "دي مجمع الأيام كلها وواخد كات أوف 4 أيام" — يعني هنا كل حاجة
//      (Placed/Confirmed/Delivered/GMV/CM3/PPM) بتتجمع بس من الصفوف اللي
//      تاريخها لحد كات أوف الـ CM3 (CM3_LAG_DAYS = 4 أيام)، مش بس الـ CM3
//      زي باقي السكشنات — هنا الكات أوف ده بيتطبق على كل حاجة.
//   2) بيستبعد الصفوف اللي مفيهاش Merchant ID، والصفوف اللي الـ ACM بتاعها
//      "Telesales" (زي ملاحظة الشيت الأصلي "exclude missing ID's & telesales").
//   3) التجميع بيحصل على مستوى Match (Merchant × SKU)، وبيتشرط إن يكون
//      Placed Pieces > 50 (POOR_MATCHES_MIN_PLACED_PIECES).
//   4) NDR_BENCHMARK لكل Match = NDR% باقي الماتشات في نفس الـ Sub-Category
//      (من غير الماتش نفسه): (SUM(Delivered) للساب كات - delivered بتاعه) /
//      (SUM(Placed) للساب كات - placed بتاعه).
//   5) STATUS = "Bad" لو (Benchmark - Own NDR) > 3% (POOR_MATCHES_NDR_GAP_THRESHOLD)،
//      وIMPACT_PIECES = لو Bad: Placed × (Benchmark - Own NDR)، غير كده صفر —
//      ده تقدير "كام قطعة كانت هتتسلم زيادة" لو الماتش ده كان بيأدي بمعدل
//      الساب-كاتيجوري بتاعته بدل معدله هو.
//
// Sub-Category بتيجي من شيت الـ Products (PRODUCTS_GID) عن طريق الـ SKU؛
// لو مش موجودة بترجع للـ Category العادي كـ fallback.
// =====================================================================
// بيبني ماتشات (Merchant × SKU) + الـ Benchmark/Status/Impact بتاعتهم من أي
// مجموعة صفوف جاهزة (المفروض تكون اتفلترت بالفترة الزمنية المطلوبة قبل ما
// توصل هنا) — منطق مشترك بين الفترة الحالية وفترة المقارنة (الشهر اللي فات).
function buildPoorMatchesFromRows(rows) {
  const eligibleRows = (rows || []).filter(r => {
    if (!r.merchantId || !r.sku) return false; // exclude missing ID's
    if ((r.acmName || "").toLowerCase().includes("telesales")) return false; // exclude telesales
    return true;
  });

  // تجميع على مستوى Match (Merchant × SKU)
  const matchMap = new Map();
  eligibleRows.forEach(r => {
    const key = r.merchantId + "||" + r.sku;
    if (!matchMap.has(key)) {
      matchMap.set(key, {
        merchantId: r.merchantId, merchantName: r.merchantName || r.merchantId, sku: r.sku,
        category: r.category || "Uncategorized", acm: r.acmName || "Unassigned",
        placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, ppm: 0
      });
    }
    const m = matchMap.get(key);
    m.placed += r.placedPieces; m.confirmed += r.confirmedPieces; m.delivered += r.deliveredPieces;
    m.deliveredGmv += r.deliveredGmv; m.cm3 += r.cm3; m.ppm += (r.ppm || 0);
  });

  // شرط Placed Pieces > 50 + اسم المنتج (Inventory) + الساب كاتيجوري (Products)
  let matches = Array.from(matchMap.values()).filter(m => m.placed > POOR_MATCHES_MIN_PLACED_PIECES);
  matches.forEach(m => {
    m.productName = (state.inventoryMap[m.sku] ? state.inventoryMap[m.sku].skuName : "") || "Unknown";
    m.subCategory = (state.productsMap[m.sku] ? state.productsMap[m.sku].subCategory : "") || m.category;
    m.ndrPct = m.placed > 0 ? (m.delivered / m.placed) * 100 : 0; // NDR_PCS = Delivered/Placed بالظبط زي الشيت
  });

  if (!matches.length) return [];

  // NDR_BENCHMARK: مجموع Placed/Delivered لكل Sub-Category (من كل الماتشات المؤهلة).
  const subCatTotals = new Map();
  matches.forEach(m => {
    const t = subCatTotals.get(m.subCategory) || { placed: 0, delivered: 0 };
    t.placed += m.placed; t.delivered += m.delivered;
    subCatTotals.set(m.subCategory, t);
  });

  matches.forEach(m => {
    const t = subCatTotals.get(m.subCategory);
    const restPlaced = t.placed - m.placed; const restDelivered = t.delivered - m.delivered;
    const ndrBenchmarkFrac = restPlaced > 0 ? (restDelivered / restPlaced) : 0; // كسر (0-1) زي عمود X في الشيت
    m.ndrBenchmark = ndrBenchmarkFrac * 100; // % عشان نعرضها زي باقي المقاييس
    const gapFrac = ndrBenchmarkFrac - (m.ndrPct / 100);
    m.status = gapFrac > POOR_MATCHES_NDR_GAP_THRESHOLD ? "Bad" : "Good";
    m.impactPieces = m.status === "Bad" ? m.placed * gapFrac : 0;
  });

  return matches;
}

// PPM لكل ماتش (Merchant × SKU) من غير أي كات أوف خالص — بنفس شرط استبعاد
// الصفوف اللي معندهاش Merchant ID والصفوف اللي ACM بتاعتها "Telesales"
// المستخدم في buildPoorMatchesFromRows، عشان المفاتيح تتطابق مع matchMap.
function buildPpmByMatchNoCutoff(rows) {
  const ppmByMatch = new Map();
  (rows || []).forEach(r => {
    if (!r.merchantId || !r.sku) return;
    if ((r.acmName || "").toLowerCase().includes("telesales")) return;
    const key = r.merchantId + "||" + r.sku;
    ppmByMatch.set(key, (ppmByMatch.get(key) || 0) + (r.ppm || 0));
  });
  return ppmByMatch;
}

function computePoorMatches() {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const rowsFiltered = (state.allParsedRows || []).filter(r =>
    (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm)
  );
  if (!rowsFiltered.length) return [];

  const cutoffTs = getCm3LagCutoffTimestamp(rowsFiltered); // نفس كات أوف الـ 4 أيام، مطبق هنا على Placed/Confirmed/Delivered/CM3/NDR
  const eligibleRows = rowsFiltered.filter(r => isCm3RowEligible(r, cutoffTs)); // بس الصفوف اللي قبل/يوم الكات أوف
  const matches = buildPoorMatchesFromRows(eligibleRows);

  // PPM بس هو اللي بقى من غير كات أوف خالص (بطلب صريح) — بنجيبه من كل
  // الصفوف (rowsFiltered) مش بس eligibleRows، وبنعيد كتابة m.ppm بيه.
  const ppmByMatch = buildPpmByMatchNoCutoff(rowsFiltered);
  matches.forEach(m => { m.ppm = ppmByMatch.get(m.merchantId + "||" + m.sku) || 0; });

  return matches;
}

// -------------------------------------------------------------------------
// مقارنة MTD مع نفس الفترة بالظبط من الشهر اللي فات (Apples-to-apples):
// لو النهارده يوم 9 والكات أوف بيوقف عند يوم 5 (CM3_LAG_DAYS)، بترجع للشهر
// اللي فات وتاخد بالظبط من يوم 1 لحد يوم 5 برضو (نفس عدد الأيام)، وتبني
// نفس ماتشات Good/Bad عليها — عشان المقارنة تبقى بين نفس عدد الأيام في
// الشهرين، مش شهر كامل قدام كام يوم بس.
// -------------------------------------------------------------------------
function computePoorMatchesPreviousPeriod() {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const currentRows = (state.allParsedRows || []).filter(r =>
    (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm)
  );
  if (!currentRows.length) return null;

  const cutoffTs = getCm3LagCutoffTimestamp(currentRows);
  if (!cutoffTs) return null;
  const cutoffDate = new Date(cutoffTs); // آخر يوم داخل في حساب الفترة الحالية (زي يوم 5 في المثال)
  const cutoffDay = cutoffDate.getDate();

  const prevMonthRef = new Date(cutoffDate.getFullYear(), cutoffDate.getMonth() - 1, 1);
  const prevMonthStart = new Date(prevMonthRef.getFullYear(), prevMonthRef.getMonth(), 1).getTime();
  const prevMonthEnd = new Date(prevMonthRef.getFullYear(), prevMonthRef.getMonth(), cutoffDay, 23, 59, 59, 999).getTime();
  const prevLabel = `${prevMonthRef.toLocaleString("en-US", { month: "short", year: "numeric" })} (Day 1–${cutoffDay})`;

  // فلتر الـ ACM (لو محدد) بيتاخد في الاعتبار في فترة المقارنة كمان، عشان
  // المقارنة تفضل عادلة (نفس الـ ACM في الفترتين). فلتر الشهر مش بيتاخد
  // بالطبع، لأننا أصلاً بنركز على الشهر اللي فات مقصود.
  const prevRows = (state.allParsedRows || []).filter(r => {
    if (!(selectedAcm === "All" || r.acmName === selectedAcm)) return false;
    return r.timestamp >= prevMonthStart && r.timestamp <= prevMonthEnd;
  });

  return { matches: buildPoorMatchesFromRows(prevRows), label: prevLabel, cutoffDay };
}

function poorMatchesBucket(list, totalPlacedForContribution) {
  const placed = list.reduce((s, m) => s + m.placed, 0);
  const delivered = list.reduce((s, m) => s + m.delivered, 0);
  return {
    count: list.length, placed, delivered,
    ndr: placed > 0 ? (delivered / placed) * 100 : 0,
    contribution: totalPlacedForContribution > 0 ? (placed / totalPlacedForContribution) * 100 : 0
  };
}

function preparePoorMatchesData() {
  const matches = computePoorMatches();
  poorMatchesState.data = matches;

  // نفس ملخص "NDR_Summary": Total Placed/Delivered/NDR الحاليين، Missed
  // Deliveries (مجموع IMPACT_PIECES)، وExpected Delivered/NDR لو الماتشات
  // السيئة أدّت بمعدل الساب-كاتيجوري بتاعتها بدل معدلها هي.
  const totalPlaced = matches.reduce((s, m) => s + m.placed, 0);
  const totalDelivered = matches.reduce((s, m) => s + m.delivered, 0);
  const currentNdr = totalPlaced > 0 ? (totalDelivered / totalPlaced) * 100 : 0;
  const missedDeliveries = matches.reduce((s, m) => s + m.impactPieces, 0);
  const expectedDelivered = totalDelivered + missedDeliveries;
  const expectedNdr = totalPlaced > 0 ? (expectedDelivered / totalPlaced) * 100 : 0;

  const good = matches.filter(m => m.status === "Good");
  const bad = matches.filter(m => m.status === "Bad");

  // مقارنة MoM (نفس عدد الأيام بالظبط من الشهر اللي فات) لجدول Good/Bad Matches.
  const prev = computePoorMatchesPreviousPeriod();
  let prevSummary = null;
  if (prev && prev.matches.length) {
    const prevGood = prev.matches.filter(m => m.status === "Good");
    const prevBad = prev.matches.filter(m => m.status === "Bad");
    const prevTotalPlaced = prev.matches.reduce((s, m) => s + m.placed, 0);
    prevSummary = {
      label: prev.label,
      good: poorMatchesBucket(prevGood, prevTotalPlaced),
      bad: poorMatchesBucket(prevBad, prevTotalPlaced),
      total: poorMatchesBucket(prev.matches, prevTotalPlaced)
    };
  }

  poorMatchesState.summary = {
    totalPlaced, totalDelivered, currentNdr, missedDeliveries, expectedDelivered, expectedNdr,
    good: poorMatchesBucket(good, totalPlaced), bad: poorMatchesBucket(bad, totalPlaced), total: poorMatchesBucket(matches, totalPlaced),
    prev: prevSummary
  };

  applyPoorMatchesSearchAndSort();
  renderPoorMatchesSummary();
}

// -------------------------------------------------------------------------
// SELLTHROUGH PANEL — نفس حسبة شيت "Copy of New sellthrough & Inbound" بالظبط.
// ============================================================================
// المصادر الخام (زي ما هي في شيت الإكسل الأصلي):
//   1) metabaseSellthroughNeeded  <- شيت "EGY Sell-through rate needed da"
//      أعمدة: PRODUCT_ID, PRODUCT_NAME, CATEGORY_L1, PLC_QTY, CNF_QTY,
//              DLV_QTY, RTO_QTY, MONTH   (صف واحد لكل SKU لكل شهر)
//   2) metabaseBeginningInventory <- شيت "EGY Beginning Inventory #4132"
//      أعمدة: PRODUCT_ID, QTY, MONTH, PRODUCT_NAME, CATEGORY_L1
//   3) metabaseProductsInfo       <- شيت "Porducts_infor #4259"
//      أعمدة: PRODUCT_ID, BUNDLE_NAME, ..., CATEGORY_L1, ...
//   4) inboundRows                <- شيت "Inbound" (GID 565878313)
//      أعمدة: Date, Odoo_NO, SKU, RCV_QTY, Des, Category,
//              Receiving Month, First buy month
//
// المعادلات (زي أعمدة D..Q في "Copy of New sellthrough" بالظبط):
//   Beginning_Inventory (G) = SUMIFS(QTY WHERE PRODUCT_ID=sku, MONTH = begInvMonth)
//   CNF_QTY / DLV_QTY (E/F) = SUM(.. WHERE MONTH بين Start..End Sale Month)
//   BEGINNING_SALES (H)      = MIN(DLV_QTY, Beginning_Inventory)
//   Remaining from beginning (I) = DLV_QTY - BEGINNING_SALES
//   RTOS (J)                 = SUM(RTO_QTY WHERE MONTH = begInvMonth)
//   RETURN_SALES (K)         = MIN(I, RTOS)
//   Remaining from purchase sales (L) = DLV_QTY - (BEGINNING_SALES + RETURN_SALES)
//   TOTAL_PURCHASES (M)       = SUM(RCV_QTY WHERE Receiving Month = begInvMonth)
//   PURCHASES_SALES (N)       = MIN(L, TOTAL_PURCHASES)
//   SELLTHROUGH_RATE (O)      = DLV_QTY / (Beginning_Inventory + TOTAL_PURCHASES + RTOS)
//   SOLD_FROM_INBOUND (P)     = PURCHASES_SALES / TOTAL_PURCHASES
//   First buy? (Q)            = (First buy month للـ SKU في Inbound) == begInvMonth
//   Last receiving date (D)   = أحدث تاريخ استلام (Inbound) للـ SKU (كل الأزمنة)
//   مجموعة الـ SKU الأساسية = اتحاد SKUs الموجودة في الثلاث مصادر عند begInvMonth
//     بالظبط زي عمود A في الشيت الأصلي.
// ============================================================================

// شهر بصيغة "July 2026" — بنفس أسلوب الفلاتر التانية في الداشبورد (populateFilters).
function stMonthLabel(d) {
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}
// يحول أي قيمة تاريخ/نص جاية من Metabase أو الشيت لمفتاح شهر "July 2026".
function stMonthKeyFromValue(v) {
  if (!v && v !== 0) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return stMonthLabel(new Date(d.getFullYear(), d.getMonth(), 1));
}
// كل الشهور بين شهرين (شامل الطرفين)، بأي ترتيب.
function stMonthKeysBetween(startKey, endKey) {
  if (!startKey || !endKey) return [];
  const sd = new Date(startKey), ed = new Date(endKey);
  if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return [];
  let a = sd.getFullYear() * 12 + sd.getMonth();
  let b = ed.getFullYear() * 12 + ed.getMonth();
  if (a > b) { const t = a; a = b; b = t; }
  const out = [];
  for (let k = a; k <= b; k++) {
    out.push(stMonthLabel(new Date(Math.floor(k / 12), k % 12, 1)));
  }
  return out;
}

// تجميع كل الشهور الموجودة فعلياً في الداتا (من الثلاث مصادر) عشان نملي الفلاتر بيها.
function computeSellthroughMonthOptions() {
  const map = new Map(); // label -> Date (لغرض الترتيب)
  (state.metabaseSellthroughNeeded || []).forEach(row => {
    const key = stMonthKeyFromValue(row.MONTH);
    if (key) map.set(key, new Date(key));
  });
  (state.metabaseBeginningInventory || []).forEach(row => {
    const key = stMonthKeyFromValue(row.MONTH);
    if (key) map.set(key, new Date(key));
  });
  (state.inboundRows || []).forEach(row => {
    if (row.receivingMonthKey) map.set(row.receivingMonthKey, new Date(row.receivingMonthKey));
  });
  return Array.from(map.entries())
    .map(([key, date]) => ({ key, date }))
    .sort((a, b) => b.date - a.date); // الأحدث أولاً
}

// بتملى الأربع selects بتوع الفلاتر، وبتحافظ على أي اختيار سابق للمستخدم،
// وبتحط افتراضياً "أحدث شهر موجود في الداتا" لو مفيش اختيار محفوظ.
function populateSellthroughFilters() {
  const options = computeSellthroughMonthOptions();
  state.sellthroughMonthOptions = options;
  if (!options.length) return;

  const latestKey = options[0].key;
  const optionsHtml = options.map(o => `<option value="${o.key}">${o.key}</option>`).join("");

  const quickSelect = $("stMonthSelect");
  if (quickSelect) {
    const prevVal = quickSelect.value;
    quickSelect.innerHTML = `<option value="">All Months</option>${optionsHtml}`;
    quickSelect.value = options.some(o => o.key === prevVal) ? prevVal : "";
  }

  [
    { id: "stBegInvSelect", key: "begInv", placeholder: "Beginning Inventory" },
    { id: "stStartSaleMonthSelect", key: "startSale", placeholder: "Start Sale Month" },
    { id: "stEndSaleMonthSelect", key: "endSale", placeholder: "End Sale Month" }
  ].forEach(({ id, key, placeholder }) => {
    const el = $(id);
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>${optionsHtml}`;
    const savedVal = state.stFilters[key];
    const finalVal = savedVal && options.some(o => o.key === savedVal) ? savedVal : latestKey;
    el.value = finalVal;
    state.stFilters[key] = finalVal;
  });
}

// بيبني صفوف الـ Sellthrough (نفس معادلات الشيت) على حسب الفلاتر الحالية،
// من غير ما يعيد بناء الـ selects — ده اللي بيتنادى كل ما اليوزر يغيّر شهر.
// ---------------------------------------------------------------------
// كاش الفهارس (Indices) الخاصة بلوحة الـ Sellthrough. بيتبني مرة واحدة
// من الداتا الخام، وبيتعاد بناؤه بس لو الداتا الخام اتغيرت (بعد ريفريش
// من الشيت) — مش في كل مرة اليوزر يغيّر فلتر شهر. ده اللي بيخلي تغيير
// الفلاتر فوري وبيلغي الهنج اللي كان بيحصل قبل كده.
let _stIndexCache = null;

function getSellthroughIndices() {
  const src = {
    inbound: state.inboundRows,
    begInv: state.metabaseBeginningInventory,
    need: state.metabaseSellthroughNeeded,
    prodInfo: state.metabaseProductsInfo
  };

  // بصمة محتوى (مش مجرد مرجع الأراييز) — عشان لو الـ fetch رجع أراييز جديدة
  // بنفس المحتوى بالظبط (يحصل في كل ريفريش حتى لو الشيت متغيرش)، منعملش
  // إعادة بناء للفهارس من غير داعي.
  const fp = computeSellthroughSourceFingerprint();

  // لو نفس بصمة المحتوى زي المرة اللي فاتت، استخدم الكاش
  if (_stIndexCache && _stIndexCache._fp === fp) {
    return _stIndexCache;
  }

  // 1) بيانات المنتج (الاسم/الكاتيجوري) — ثابتة مش بتتفلتر بالشهر
  const productInfo = new Map();
  (src.prodInfo || []).forEach(row => {
    const sku = row.PRODUCT_ID || row.SKU || row.sku;
    if (!sku || productInfo.has(sku)) return;
    productInfo.set(sku, {
      name: row.BUNDLE_NAME || row.PRODUCT_NAME || row.NAME || row.name,
      cat: row.CATEGORY_L1 || row.CAT || row.category
    });
  });

  // 2) Inbound: التجميع بالشهر (Receiving Month) + أول شهر شراء + آخر تاريخ استلام
  //    + فهرس شهر -> مجموعة SKUs (عشان بناء skuSet يبقى O(1) بدل O(n) في كل فلتر)
  const inboundBySkuMonth = new Map();     // "sku|monthKey" -> إجمالي RCV_QTY
  const inboundFirstBuyMonth = new Map();  // sku -> أول شهر ظهر فيه SKU
  const inboundLastRec = new Map();        // sku -> {ts, text}
  const inboundNameCat = new Map();
  const skuByMonthInbound = new Map();     // monthKey -> Set(sku)
  (src.inbound || []).forEach(row => {
    if (!row.sku) return;
    if (row.rcvTs) {
      const cur = inboundLastRec.get(row.sku);
      if (!cur || row.rcvTs > cur.ts) inboundLastRec.set(row.sku, { ts: row.rcvTs, text: row.rcvDateText });
    }
    if (row.receivingMonthKey) {
      const k = row.sku + "|" + row.receivingMonthKey;
      inboundBySkuMonth.set(k, (inboundBySkuMonth.get(k) || 0) + (row.rcvQty || 0));
      let set = skuByMonthInbound.get(row.receivingMonthKey);
      if (!set) { set = new Set(); skuByMonthInbound.set(row.receivingMonthKey, set); }
      set.add(row.sku);
    }
    if (row.firstBuyMonthKey) {
      const curFirst = inboundFirstBuyMonth.get(row.sku);
      if (!curFirst || new Date(row.firstBuyMonthKey) < new Date(curFirst)) {
        inboundFirstBuyMonth.set(row.sku, row.firstBuyMonthKey);
      }
    }
    if (!inboundNameCat.has(row.sku)) inboundNameCat.set(row.sku, { name: row.name, cat: row.cat });
  });

  // 3) Beginning Inventory: التجميع بالشهر + فهرس شهر -> Set(sku)
  const beginInvBySkuMonth = new Map();
  const beginInvNameCat = new Map();
  const skuByMonthBegInv = new Map();
  (src.begInv || []).forEach(row => {
    const sku = row.PRODUCT_ID || row.SKU || row.sku;
    const mk = stMonthKeyFromValue(row.MONTH);
    if (!sku || !mk) return;
    const k = sku + "|" + mk;
    beginInvBySkuMonth.set(k, (beginInvBySkuMonth.get(k) || 0) + Number(row.QTY ?? row.Beginning_Inventory ?? row.inventory ?? 0));
    if (!beginInvNameCat.has(sku)) beginInvNameCat.set(sku, { name: row.PRODUCT_NAME, cat: row.CATEGORY_L1 });
    let set = skuByMonthBegInv.get(mk);
    if (!set) { set = new Set(); skuByMonthBegInv.set(mk, set); }
    set.add(sku);
  });

  // 4) Sellthrough Needed: التجميع بالشهر (CNF/DLV/RTO) + فهرس شهر -> Set(sku)
  const needBySkuMonth = new Map();
  const needNameCat = new Map();
  const skuByMonthNeed = new Map();
  (src.need || []).forEach(row => {
    const sku = row.PRODUCT_ID || row.SKU || row.sku;
    const mk = stMonthKeyFromValue(row.MONTH);
    if (!sku || !mk) return;
    const k = sku + "|" + mk;
    const cur = needBySkuMonth.get(k) || { cnf: 0, dlv: 0, rto: 0 };
    cur.cnf += Number(row.CNF_QTY || 0);
    cur.dlv += Number(row.DLV_QTY || 0);
    cur.rto += Number(row.RTO_QTY ?? row.RTOS ?? 0);
    needBySkuMonth.set(k, cur);
    if (!needNameCat.has(sku)) needNameCat.set(sku, { name: row.PRODUCT_NAME, cat: row.CATEGORY_L1 });
    let set = skuByMonthNeed.get(mk);
    if (!set) { set = new Set(); skuByMonthNeed.set(mk, set); }
    set.add(sku);
  });

  // ---------------------------------------------------------------------
  // STOCK & DOH — بنفس منطق "SKU TOTAL DEMAND OVERALL" (Debundled) المستخدم
  // في Current Inventory DOH بتاع Recommended Tracker/PPM Analyst
  // (buildDebundledStockDohIndex، الشير هيلبر فوق):
  //   • STOCK: بيتقرا مباشرة من شيت الديبندلايز (PRODUCTS_DEBUNDLE_MAP_GID)
  //     بمطابقة عمود A (PRODUCT_ID) مع الـ SKU — مش عمود D (SINGLE_ID) زي
  //     الأول — والقيمة من عمود H (STOCK).
  //   • DOH: الديماند (Confirmed آخر 3 أيام) بتتجمع "Overall" — يعني ديماند
  //     الـ Single SKU وهو بيتباع لوحده + ديماند كل البندلز اللي هو مكوّن
  //     جواها (كل بندل بيتضرب في PRODUCT_QUANTITY بتاعه فيه)، مش بس
  //     الديماند اللي طالع على نفس الـ SKU ده لوحده كسطر في MAIN_GID.
  // ---------------------------------------------------------------------
  const mainRows = state.allParsedRows || [];
  const { stockByProductId, singleOverallStats } = buildDebundledStockDohIndex(mainRows);
  // AVG 15D / DOH_15D — نفس منطق "SKU TOTAL DEMAND OVERALL" (Debundled) فوق،
  // بس على شباك 15 يوم بدل 3 أيام (buildDebundledStockDohIndex بقت بتاخد
  // windowDays كباراميتر تاني اختياري).
  const { singleOverallStats: singleOverallStats15d } = buildDebundledStockDohIndex(mainRows, 15);

  // ---------------------------------------------------------------------
  // Availability (WEBSITE_STATUS) / Is_Locked (IS_LOCKED) — من شيت Products
  // (PRODUCTS_GID). الـ SKU هنا جاي من مصادر Metabase (PRODUCT_ID)، فممكن
  // يختلف شكله شوية عن SKU_ID في شيت الـ Products (مسافات زيادة، حروف كبيرة/
  // صغيرة، ...). فبنبني فهرس تاني (Normalized: بعد trim + توحيد الحروف
  // لكابيتال) كـ fallback لو المطابقة المباشرة (exact) فشلت، عشان القراءة
  // متفضلش راجعة "-" لمجرد اختلاف شكلي بسيط في نص الـ SKU.
  const stNormalizeSku = (v) => (v || "").toString().trim().toUpperCase();
  const productsBySkuNormalized = new Map();
  Object.keys(state.productsMap || {}).forEach(sku => {
    const norm = stNormalizeSku(sku);
    if (norm && !productsBySkuNormalized.has(norm)) productsBySkuNormalized.set(norm, state.productsMap[sku]);
  });

  _stIndexCache = {
    _fp: fp,
    productInfo, inboundBySkuMonth, inboundFirstBuyMonth, inboundLastRec, inboundNameCat,
    beginInvBySkuMonth, beginInvNameCat, needBySkuMonth, needNameCat,
    skuByMonthInbound, skuByMonthBegInv, skuByMonthNeed,
    stockByProductId, singleOverallStats, singleOverallStats15d, productsBySkuNormalized, stNormalizeSku
  };
  return _stIndexCache;
}

// ---------------------------------------------------------------------
// "Last inbound status" فلتر — بيقسّم الـ SKUs حسب تاريخ آخر استلام إنباوند
// بتاعها (lastRecTs) لـ: "Before <current year>" (أي حاجة قبل السنة الحالية)،
// وبعدين رباعيات (Quarters) جوه السنة الحالية نفسها — Q1 = يناير..مارس،
// Q2 = أبريل..يونيو، Q3 = يوليو..سبتمبر، Q4 = أكتوبر..ديسمبر. السنة بتتحدد
// ديناميكيًا من تاريخ النهاردة (مش مكتوبة ثابتة) عشان تفضل صح مع الوقت.
// ---------------------------------------------------------------------
const ST_LAST_INBOUND_YEAR = new Date().getFullYear();

function stLastInboundBucket(ts) {
  if (ts === null || ts === undefined || isNaN(ts)) return null;
  const d = new Date(ts);
  const y = d.getFullYear();
  if (y < ST_LAST_INBOUND_YEAR) return "before";
  if (y > ST_LAST_INBOUND_YEAR) return "q4"; // future-dated edge case — bucket with the last quarter rather than drop it
  const m = d.getMonth(); // 0-11
  if (m <= 2) return "q1";
  if (m <= 5) return "q2";
  if (m <= 8) return "q3";
  return "q4";
}

function stLastInboundBucketLabel(bucket) {
  const y = ST_LAST_INBOUND_YEAR;
  if (bucket === "before") return `Before ${y}`;
  if (bucket === "q1") return `Q1 ${y} (Jan-Mar)`;
  if (bucket === "q2") return `Q2 ${y} (Apr-Jun)`;
  if (bucket === "q3") return `Q3 ${y} (Jul-Sep)`;
  if (bucket === "q4") return `Q4 ${y} (Oct-Dec)`;
  return bucket;
}

function recomputeSellthroughRows() {
  let { begInv: begInvKey, startSale: startKey, endSale: endKey } = state.stFilters;

  // لو المستخدم مختار "Last Inbound Status" بس لسه مايختارش الشهور التلاتة
  // (Beginning Inventory / Start Sale / End Sale) بنفسه، بنبني تلقائيًا رينج
  // يغطي كل الشهور المتاحة في الداتا (من أقدم شهر لأحدث شهر) عشان الفلتر
  // يجيب "داتا الشهور كلها" زي ما اتطلب، من غير ما يستنى اختيار يدوي. لو
  // المستخدم اختار أي واحد من التلاتة فلاتر دول بنفسه، بناخد اختياره زي ما هو
  // (بيبقى أولوية على الرينج التلقائي).
  let stAutoFullRangeApplied = false;
  if (state.stFilters.lastInboundStatus && (!begInvKey || !startKey || !endKey)) {
    const monthOpts = (state.sellthroughMonthOptions && state.sellthroughMonthOptions.length)
      ? state.sellthroughMonthOptions
      : computeSellthroughMonthOptions();
    if (monthOpts.length) {
      const sortedAsc = [...monthOpts].sort((a, b) => a.date - b.date);
      const earliestKey = sortedAsc[0].key;
      const latestKey = sortedAsc[sortedAsc.length - 1].key;
      begInvKey = begInvKey || earliestKey;
      startKey = startKey || earliestKey;
      endKey = endKey || latestKey;
      stAutoFullRangeApplied = true;
    }
  }

  const stSubtitleEl = $("stFiltersSubtitle");
  if (stSubtitleEl) {
    stSubtitleEl.textContent = stAutoFullRangeApplied
      ? `Apply filters to update the Sellthrough data — showing all available months (${begInvKey} → ${endKey}), narrowed by Last Inbound Status`
      : "Apply filters to update the Sellthrough data";
  }

  if (!begInvKey || !startKey || !endKey) { state.sellthroughDataPrepared = []; applySellthroughFiltersAndSort(); renderSellthroughSummaries([]); return; }

  // ---------------------------------------------------------------------
  // PERFORMANCE FIX: كل الخطوات اللي بتلف على الداتا الخام (inboundRows,
  // metabaseBeginningInventory, metabaseSellthroughNeeded, metabaseProductsInfo)
  // كانت بتتعمل من الصفر في كل مرة اليوزر يغيّر فلتر شهر — وده اللي كان
  // بيسبب الهنج. دلوقتي بنبنيها مرة واحدة بس (أول ما تفتح اللوحة أو لما
  // الداتا الخام نفسها تتغيّر بعد ريفريش)، ونخزنها في كاش. تغيير الفلاتر
  // بعد كده بيستخدم الكاش على طول من غير ما يعيد لف الآلاف من الصفوف.
  const idx = getSellthroughIndices();
  const {
    productInfo, inboundBySkuMonth, inboundFirstBuyMonth, inboundLastRec,
    inboundNameCat, beginInvBySkuMonth, beginInvNameCat, needBySkuMonth,
    needNameCat, skuByMonthInbound, skuByMonthBegInv, skuByMonthNeed,
    stockByProductId, singleOverallStats, singleOverallStats15d, productsBySkuNormalized, stNormalizeSku
  } = idx;

  // مجموعة الـ SKU الأساسية = اتحاد الموجودين في الثلاث مصادر عند begInvKey
  // (زي عمود A بالظبط) — دلوقتي بنعمل lookup على set محسوبة مسبقاً بدل ما
  // نلف على كل الصفوف الخام في كل مرة.
  const skuSet = new Set();
  (skuByMonthInbound.get(begInvKey) || []).forEach(sku => skuSet.add(sku));
  (skuByMonthNeed.get(begInvKey) || []).forEach(sku => skuSet.add(sku));
  (skuByMonthBegInv.get(begInvKey) || []).forEach(sku => skuSet.add(sku));

  const salesMonthKeys = stMonthKeysBetween(startKey, endKey);
  const rows = [];

  skuSet.forEach(sku => {
    let cnfQty = 0, dlvQty = 0;
    salesMonthKeys.forEach(mk => {
      const e = needBySkuMonth.get(sku + "|" + mk);
      if (e) { cnfQty += e.cnf; dlvQty += e.dlv; }
    });

    const begInv = beginInvBySkuMonth.get(sku + "|" + begInvKey) || 0;
    const begSales = Math.min(dlvQty, begInv);                 // H = IF(F>=G,G,F)
    const remBeg = dlvQty - begSales;                          // I = F - H
    const rtos = (needBySkuMonth.get(sku + "|" + begInvKey) || { rto: 0 }).rto; // J (بشهر begInv بس)
    const retSales = Math.min(remBeg, rtos);                   // K = IF(I>=J,J,I)
    const remPurSales = dlvQty - (begSales + retSales);        // L = F-(H+K)
    const totPur = inboundBySkuMonth.get(sku + "|" + begInvKey) || 0; // M
    const purSales = Math.min(remPurSales, totPur);            // N = IF(L>=M,M,L)
    const denom = begInv + totPur + rtos;
    const stRate = denom > 0 ? (dlvQty / denom) * 100 : 0;     // O
    const soldInb = totPur > 0 ? (purSales / totPur) * 100 : 0; // P
    const firstBuy = inboundFirstBuyMonth.get(sku) === begInvKey ? "Yes" : "No"; // Q

    // نفس السلسلة بالظبط لكن ببداية CNF_QTY (زي شيت "Confirmed" بالظبط، تاب E..N بس مبني على الكونفيرمد)
    const cBegSales = Math.min(cnfQty, begInv);
    const cRemBeg = cnfQty - cBegSales;
    const cRetSales = Math.min(cRemBeg, rtos);
    const cRemPurSales = cnfQty - (cBegSales + cRetSales);
    const cPurSales = Math.min(cRemPurSales, totPur);

    const lastRec = inboundLastRec.get(sku);
    const info = productInfo.get(sku) || needNameCat.get(sku) || beginInvNameCat.get(sku) || inboundNameCat.get(sku) || {};

    // Stock/DOH: نفس منطق "SKU TOTAL DEMAND OVERALL" (Debundled) — STOCK
    // بيتقرا من عمود A (PRODUCT_ID) في شيت الديبندلايز (عمود H)، والـ DOH
    // بيتحسب من ديماند الـ SKU ده Overall: هو لوحده + كل البندلز اللي هو
    // مكوّن جواها (كل بندل × الكمية بتاعته فيه) — نفس getSellthroughIndices فوق.
    const stock = stockByProductId.has(sku) ? stockByProductId.get(sku) : (state.inventoryMap[sku] ? state.inventoryMap[sku].stock : 0);
    const avg3dConfirmed = singleOverallStats(sku).avg;
    const doh = avg3dConfirmed > 0 ? Math.round(stock / avg3dConfirmed) : Math.round(stock || 0);
    // AVG 15D / DOH_15D: نفس منطق AVG 3D/DOH فوق بالظبط (Overall Debundled
    // demand)، بس على شباك آخر 15 يوم بدل آخر 3 أيام.
    const avg15dConfirmed = singleOverallStats15d(sku).avg;
    const doh15d = avg15dConfirmed > 0 ? Math.round(stock / avg15dConfirmed) : Math.round(stock || 0);

    // Availability / Is_Locked: من شيت Products (PRODUCTS_GID) عن طريق SKU —
    // مطابقة مباشرة الأول، وبعدين مطابقة بعد توحيد الشكل (trim + كابيتال)
    // لو الـ SKU في شيت الـ Metabase مكتوب بشكل مختلف شوية عن SKU_ID.
    const prodInfo = state.productsMap[sku] || productsBySkuNormalized.get(stNormalizeSku(sku)) || {};

    rows.push({
      sku,
      name: info.name || "Unknown",
      cat: info.cat || "Uncategorized",
      lastRecDate: lastRec ? lastRec.text : "-",
      lastRecTs: lastRec ? lastRec.ts : null,
      cnfQty, dlvQty, begInv, begSales, remBeg,
      rtos, retSales, remPurSales, totPur, purSales,
      stRate, soldInb, firstBuy,
      cBegSales, cRemBeg, cRetSales, cRemPurSales, cPurSales,
      stock: Math.round(stock || 0), doh,
      avg3d: avg3dConfirmed, avg15d: avg15dConfirmed, doh15d,
      websiteStatus: prodInfo.websiteStatus || "-", isLocked: prodInfo.isLocked || "-"
    });
  });

  // "Last inbound status" فلتر — لو المستخدم مختار قيمة (Before <year> أو
  // Quarter معين)، بنفلتر الصفوف هنا قبل ما تتخزن، عشان الفلتر يعكس صح في
  // الجدول الرئيسي وفي جداول الـ Summary (Confirmed/Delivered) مع بعض، مش
  // بس في الجدول — الاتنين بياخدوا نفس الـ rows المفلترة دي.
  const lastInboundStatusFilter = state.stFilters.lastInboundStatus;
  const filteredRows = lastInboundStatusFilter
    ? rows.filter(r => stLastInboundBucket(r.lastRecTs) === lastInboundStatusFilter)
    : rows;

  state.sellthroughDataPrepared = filteredRows;
  applySellthroughFiltersAndSort();
  renderSellthroughSummaries(filteredRows);
}

// =====================================================================
// SUMMARY SECTIONS (Confirmed / Delivered) — نفس تاب "Summary" بالظبط.
// كل قسم بيجمع صفوف الـ SKU (اللي فوق) على مستوى الـ CAT، لخمس كاتيجوريز
// ثابتة (زي الشيت بالظبط)، وبيحسب SELLTHROUGH% و INBOUND VS SOLD.
// =====================================================================
const ST_SUMMARY_CATS = ["Consumables", "Electronics", "Home", "Leisure", "Fashion"];

function computeSellthroughSummary(rows, mode) {
  // mode: "confirmed" -> pieces=CNF_QTY, begSales/retSales/purSales = c* fields
  //       "delivered" -> pieces=DLV_QTY, begSales/retSales/purSales = الحقول العادية
  const buckets = new Map(ST_SUMMARY_CATS.map(c => [c.toLowerCase(), {
    cat: c, pieces: 0, begInv: 0, begSales: 0, returns: 0, retSales: 0,
    totPur: 0, purSales: 0, rawPieces: 0
  }]));

  rows.forEach(r => {
    const key = (r.cat || "").trim().toLowerCase();
    const b = buckets.get(key);
    if (!b) return; // كاتيجوري مش من الخمسة الأساسيين (زي الشيت بالظبط، بيتجاهلها)
    const begSales = mode === "confirmed" ? r.cBegSales : r.begSales;
    const retSales = mode === "confirmed" ? r.cRetSales : r.retSales;
    const purSales = mode === "confirmed" ? r.cPurSales : r.purSales;
    b.begInv += r.begInv;
    b.begSales += begSales;
    b.returns += r.rtos;
    b.retSales += retSales;
    b.totPur += r.totPur;
    b.purSales += purSales;
    b.rawPieces += mode === "confirmed" ? r.cnfQty : r.dlvQty; // للـ OVERFLOW (زي عمود E أو F في شيت Confirmed/Delivered)
  });

  const out = [];
  let grand = { cat: "Grand Total", pieces: 0, begInv: 0, begSales: 0, returns: 0, retSales: 0, totPur: 0, purSales: 0, overflow: 0 };
  buckets.forEach(b => {
    const pieces = b.begSales + b.retSales + b.purSales;       // D = F+J+H (أو F+H+J)
    const overflow = b.rawPieces - pieces;                     // K = SUMIFS(raw) - D
    const denom = b.begInv + b.totPur + b.returns;
    const stRate = denom > 0 ? (pieces / denom) * 100 : 0;     // L
    const inboundVsSold = b.totPur > 0 ? (b.purSales / b.totPur) * 100 : 0; // M
    const row = { cat: b.cat, pieces, begInv: b.begInv, begSales: b.begSales, returns: b.returns, retSales: b.retSales, totPur: b.totPur, purSales: b.purSales, overflow, stRate, inboundVsSold };
    out.push(row);
    grand.pieces += pieces; grand.begInv += b.begInv; grand.begSales += b.begSales;
    grand.returns += b.returns; grand.retSales += b.retSales; grand.totPur += b.totPur;
    grand.purSales += b.purSales; grand.overflow += overflow;
  });
  const gDenom = grand.begInv + grand.totPur + grand.returns;
  grand.stRate = gDenom > 0 ? (grand.pieces / gDenom) * 100 : 0;
  grand.inboundVsSold = grand.totPur > 0 ? (grand.purSales / grand.totPur) * 100 : 0;
  out.push(grand);
  return out;
}

function renderSellthroughSummaryTable(tbodyId, summaryRows) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = summaryRows.map(r => `
    <tr${r.cat === "Grand Total" ? ' class="st-grand-total"' : ""}>
      <td>${r.cat}</td>
      <td>${fmtIntCell(r.pieces)}</td>
      <td>${fmtIntCell(r.begInv)}</td>
      <td>${fmtIntCell(r.begSales)}</td>
      <td>${fmtIntCell(r.returns)}</td>
      <td>${fmtIntCell(r.retSales)}</td>
      <td>${fmtIntCell(r.totPur)}</td>
      <td>${fmtIntCell(r.purSales)}</td>
      <td>${fmtIntCell(r.overflow)}</td>
      <td class="st-rate">${r.stRate.toFixed(1)}%</td>
      <td class="st-inbound">${r.inboundVsSold.toFixed(1)}%</td>
    </tr>
  `).join("");
}

function renderSellthroughSummaries(rows) {
  renderSellthroughSummaryTable("stConfirmedSummaryBody", computeSellthroughSummary(rows, "confirmed"));
  renderSellthroughSummaryTable("stDeliveredSummaryBody", computeSellthroughSummary(rows, "delivered"));
}

function simulateSellthroughProgress() {
  const overlay = $("stProgressOverlay");
  const bar = $("stProgressBar");
  const text = $("stProgressText");

  // ✅ الداتا اتجهزت قبل كده في نفس الجلسة، والمصدر الخام مش اتغيّر (مفيش
  // ريفريش جديد) — يبقى مفيش داعي نعمل لودينج ولا نعيد الحساب تاني.
  // البانل هيفضل زي ما هو (الجدول والملخصات لسه في الـ DOM من المرة اللي فاتت).
  if (state.sellthroughPrepared) {
    if (overlay) overlay.classList.add("hidden");
    return;
  }

  if (!overlay || !bar || !text) {
    prepareSellthroughData();
    state.sellthroughPrepared = true;
    return;
  }

  // 1. إظهار الشريط وتصفيره فوراً بدون أنيميشن عشان يبدأ من الصفر بجد
  overlay.classList.remove("hidden");
  bar.style.transition = "none";
  bar.style.width = "0%";
  text.textContent = "0%";

  // 2. نستنى المتصفح يرسم الـ 0% فعلاً (فريمين) قبل ما نبدأ أي حاجة
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bar.style.transition = "width 0.25s ease-out";
      bar.style.width = "55%";
      text.textContent = "55%";

      // 3. نستنى فريم كمان عشان نتأكد إن الـ 55% اتلون فعلاً على الشاشة،
      // بعدين نبدأ الشغل الحقيقي (build indices + compute rows) — مش تايمر
      // وهمي منفصل عن الشغل زي قبل كده.
      requestAnimationFrame(() => {
        setTimeout(() => {
          prepareSellthroughData();      // <-- الشغل الحقيقي بيحصل هنا بالظبط
          state.sellthroughPrepared = true;

          bar.style.transition = "width 0.15s ease-out";
          bar.style.width = "100%";
          text.textContent = "100%";

          // 4. دلوقتي 100% بجد معناها الداتا جاهزة وعلى الشاشة، فنقفل
          // اللودينج على طول من غير ما نستنى تايمر وهمي.
          requestAnimationFrame(() => overlay.classList.add("hidden"));
        }, 20);
      });
    });
  });
}

// ---------------------------------------------------------------------
// SELLTHROUGH TREND CHART — فوق جدول "Sellthrough & Inbound" مباشرة، نفس
// ستايل شارت "Pipeline Velocity" اللي في الـ Overview بالظبط بس بمقياس
// شهري. بتاخد كل شهور السنة الحالية اللي فيها بيانات Sellthrough فعلاً (من
// أي مصدر من التلاتة: Inbound/Beginning Inventory/Sellthrough Needed)،
// ولكل شهر M بتحسب (باعتبار M هو نفسه الـ Beginning Inventory Month
// وStart/End Sale Month مع بعض — يعني أداء الشهر ده في حد ذاته):
//   • Total Purchases = مجموع كميات الـ Inbound (RCV_QTY) في الشهر M
//   • Total Delivered/Confirmed = مجموع DLV_QTY أو CNF_QTY (حسب التوجل) في M
//   • Sellthrough % = مجموع DLV_QTY أو CNF_QTY ÷ (Beginning Inventory +
//     Total Purchases + RTOS) × 100 — نفس معادلة عمود O بالظبط بس Weighted
//     على مستوى الشهر ككل، مش لكل SKU لوحده.
// الشارت ده مستقل تمامًا عن فلاتر اللوحة فوق (Beginning Inventory/Start
// Sale Month/End Sale Month) — بيعرض الترند الشهري لكل السنة الحالية دايمًا.
// ---------------------------------------------------------------------
let sellthroughTrendMetric = "delivered"; // "delivered" | "confirmed"
let sellthroughTrendChartInst = null;

function buildSellthroughTrendData() {
  const idx = getSellthroughIndices();
  const { skuByMonthInbound, skuByMonthBegInv, skuByMonthNeed, beginInvBySkuMonth, inboundBySkuMonth, needBySkuMonth } = idx;

  const currentYear = new Date().getFullYear();
  const monthKeys = new Set();
  [skuByMonthInbound, skuByMonthBegInv, skuByMonthNeed].forEach(map => {
    Array.from((map || new Map()).keys()).forEach(mk => {
      const d = new Date(mk);
      if (!isNaN(d.getTime()) && d.getFullYear() === currentYear) monthKeys.add(mk);
    });
  });
  const sortedMonths = Array.from(monthKeys).sort((a, b) => new Date(a) - new Date(b));

  return sortedMonths.map(mk => {
    const skuSet = new Set();
    (skuByMonthInbound.get(mk) || []).forEach(sku => skuSet.add(sku));
    (skuByMonthNeed.get(mk) || []).forEach(sku => skuSet.add(sku));
    (skuByMonthBegInv.get(mk) || []).forEach(sku => skuSet.add(sku));

    let sumBegInv = 0, sumTotPur = 0, sumRtos = 0, sumDlv = 0, sumCnf = 0;
    skuSet.forEach(sku => {
      sumBegInv += beginInvBySkuMonth.get(sku + "|" + mk) || 0;
      sumTotPur += inboundBySkuMonth.get(sku + "|" + mk) || 0;
      const need = needBySkuMonth.get(sku + "|" + mk);
      if (need) { sumDlv += need.dlv || 0; sumCnf += need.cnf || 0; sumRtos += need.rto || 0; }
    });
    const denom = sumBegInv + sumTotPur + sumRtos;
    const stRateDelivered = denom > 0 ? (sumDlv / denom) * 100 : 0;
    const stRateConfirmed = denom > 0 ? (sumCnf / denom) * 100 : 0;
    return { month: mk, totalPurchases: sumTotPur, totalDelivered: sumDlv, totalConfirmed: sumCnf, stRateDelivered, stRateConfirmed };
  });
}

let sellthroughTrendWired = false;
function sellthroughTrendWireControlsOnce() {
  if (sellthroughTrendWired) return; sellthroughTrendWired = true;
  document.querySelectorAll("#sellthroughTrendMetricToggle .segmented-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      document.querySelectorAll("#sellthroughTrendMetricToggle .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      sellthroughTrendMetric = btn.dataset.metric;
      renderSellthroughTrendChart();
    });
  });
}

function renderSellthroughTrendChart() {
  sellthroughTrendWireControlsOnce();
  const canvas = document.getElementById("sellthroughTrendChart");
  if (!canvas || typeof Chart === "undefined") return;
  const data = buildSellthroughTrendData();
  const isConfirmed = sellthroughTrendMetric === "confirmed";
  const piecesLabel = isConfirmed ? "Total Confirmed" : "Total Delivered";
  if ($("sellthroughTrendSubtitle")) $("sellthroughTrendSubtitle").textContent = `Total Purchases vs ${piecesLabel} vs Sellthrough % — every month this year`;

  if (sellthroughTrendChartInst) { sellthroughTrendChartInst.destroy(); sellthroughTrendChartInst = null; }
  if (!data.length) return;

  const labels = data.map(d => { const dt = new Date(d.month); return isNaN(dt.getTime()) ? d.month : dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); });
  const purchasesValues = data.map(d => d.totalPurchases);
  const piecesValues = data.map(d => isConfirmed ? d.totalConfirmed : d.totalDelivered);
  const stRateValues = data.map(d => isConfirmed ? d.stRateConfirmed : d.stRateDelivered);

  sellthroughTrendChartInst = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Total Purchases", data: purchasesValues, borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.08)", fill: false, tension: 0.35, pointRadius: 3, pointBackgroundColor: "#3b82f6", yAxisID: "y" },
        { label: piecesLabel, data: piecesValues, borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.08)", fill: false, tension: 0.35, pointRadius: 3, pointBackgroundColor: "#10b981", yAxisID: "y" },
        { label: "Sellthrough %", data: stRateValues, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.08)", fill: false, tension: 0.35, pointRadius: 3, pointBackgroundColor: "#f59e0b", yAxisID: "y1", borderDash: [4, 3] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: "#1e293b", titleColor: "#f8fafc", bodyColor: "#cbd5e1", borderColor: "#334155", borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => ctx.dataset.yAxisID === "y1" ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` : `${ctx.dataset.label}: ${fmtInt.format(Math.round(ctx.parsed.y))}` }
        }
      },
      scales: {
        x: { grid: { display: false, drawBorder: false } },
        y: { beginAtZero: true, position: "left", grid: { color: "#1e293b", borderDash: [4, 4], drawBorder: false }, ticks: { callback: v => v >= 1000 ? (v / 1000) + "k" : v } },
        y1: { beginAtZero: true, position: "right", grid: { display: false, drawBorder: false }, ticks: { callback: v => v + "%" } }
      }
    }
  });
}

function prepareSellthroughData() {
  populateSellthroughFilters();
  recomputeSellthroughRows();
  renderSellthroughTrendChart();
}

function sortSellthrough(key) {
  if (state.sellthroughSortKey === key) {
    state.sellthroughSortDir = state.sellthroughSortDir === "asc" ? "desc" : "asc";
  } else {
    state.sellthroughSortKey = key;
    state.sellthroughSortDir = "desc";
  }
  applySellthroughFiltersAndSort();
}

function applySellthroughFiltersAndSort() {
  if (!state.sellthroughDataPrepared) return;
  
  let data = [...state.sellthroughDataPrepared];
  const searchInput = $("searchSellthroughInput");
  const q = searchInput ? searchInput.value.toLowerCase() : "";
  
  if (q) {
    data = data.filter(d => 
      String(d.sku).toLowerCase().includes(q) || 
      String(d.name).toLowerCase().includes(q) ||
      String(d.cat).toLowerCase().includes(q)
    );
  }

  const key = state.sellthroughSortKey;
  const dir = state.sellthroughSortDir === "asc" ? 1 : -1;
  
  data.sort((a, b) => {
    let valA = a[key];
    let valB = b[key];
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return -1 * dir;
    if (valA > valB) return 1 * dir;
    return 0;
  });

  state.filteredSellthroughData = data;
  state.sellthroughPage = 0;
  renderPaginatedSellthroughTable();
}

function renderPaginatedSellthroughTable() {
  const tbody = $("sellthroughTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  
  const start = state.sellthroughPage * PAGE_SIZE;
  const pageRows = state.filteredSellthroughData.slice(start, start + PAGE_SIZE);
  
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim">${m.sku}</td>
      <td class="font-bold text-light truncate-cell" title="${m.name}">${m.name}</td>
      <td class="text-dim">${m.cat}</td>
      <td class="text-dim">${m.lastRecDate}</td>
      <td class="num text-blue font-bold">${fmtIntCell(m.cnfQty)}</td>
      <td class="num text-green font-bold">${fmtIntCell(m.dlvQty)}</td>
      <td class="num text-light">${fmtIntCell(m.begInv)}</td>
      <td class="num text-dim">${fmtIntCell(m.begSales)}</td>
      <td class="num text-orange font-bold">${fmtIntCell(m.remBeg)}</td>
      <td class="num text-red font-bold">${fmtIntCell(m.rtos)}</td>
      <td class="num text-red">${fmtIntCell(m.retSales)}</td>
      <td class="num text-dim">${fmtIntCell(m.remPurSales)}</td>
      <td class="num text-blue">${fmtIntCell(m.totPur)}</td>
      <td class="num text-green">${fmtIntCell(m.purSales)}</td>
      <td class="num text-purple font-bold">${m.stRate.toFixed(1)}%</td>
      <td class="num font-bold">${m.soldInb.toFixed(1)}%</td>
      <td class="center"><span class="badge-outline ${m.firstBuy === 'Yes' ? 'green' : 'dim'}">${m.firstBuy}</span></td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.stock))}</td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.doh))}</td>
      <td class="center">${m.websiteStatus}</td>
      <td class="center"><span class="badge-outline ${String(m.isLocked).toLowerCase() === 'true' || String(m.isLocked).toLowerCase() === 'yes' ? 'red' : 'dim'}">${m.isLocked}</span></td>
      <td class="num text-blue">${fmtIntCell(Math.round(m.avg3d))}</td>
      <td class="num text-purple">${fmtIntCell(Math.round(m.avg15d))}</td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.doh15d))}</td>
    `;
    tbody.appendChild(tr);
  });

  const totalPages = Math.max(1, Math.ceil(state.filteredSellthroughData.length / PAGE_SIZE));
  if ($("rowCountSellthrough")) $("rowCountSellthrough").textContent = `${fmtInt.format(state.filteredSellthroughData.length)} Rows`;
  if ($("pageIndicatorSellthrough")) $("pageIndicatorSellthrough").textContent = `Page ${state.sellthroughPage + 1} of ${totalPages}`;
  if ($("prevPageSellthrough")) $("prevPageSellthrough").disabled = state.sellthroughPage === 0;
  if ($("nextPageSellthrough")) $("nextPageSellthrough").disabled = state.sellthroughPage >= totalPages - 1;
}

// تفعيل أحداث الضغط (Event Listeners) الخاصة بالبحث والتقليب
document.addEventListener("DOMContentLoaded", () => {
  if($("searchSellthroughInput")) $("searchSellthroughInput").addEventListener("input", applySellthroughFiltersAndSort);

  // فلتر الشهور السريع: بيحدد نفس الشهر لـ Beginning Inventory + Start/End Sale Month مع بعض.
  if ($("stMonthSelect")) $("stMonthSelect").addEventListener("change", (e) => {
    const val = e.target.value;
    if (val) {
      state.stFilters.begInv = val;
      state.stFilters.startSale = val;
      state.stFilters.endSale = val;
      if ($("stBegInvSelect")) $("stBegInvSelect").value = val;
      if ($("stStartSaleMonthSelect")) $("stStartSaleMonthSelect").value = val;
      if ($("stEndSaleMonthSelect")) $("stEndSaleMonthSelect").value = val;
      recomputeSellthroughRows();
    }
  });

  // الفلاتر التفصيلية الثلاثة (بتحدث الحسبة على طول من غير ما تعيد بناء الـ selects)
  [
    { id: "stBegInvSelect", key: "begInv" },
    { id: "stStartSaleMonthSelect", key: "startSale" },
    { id: "stEndSaleMonthSelect", key: "endSale" }
  ].forEach(({ id, key }) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", (e) => {
      if (!e.target.value) return; // متسمحش يفضى، لازم شهر محدد عشان الحسبة تشتغل
      state.stFilters[key] = e.target.value;
      recomputeSellthroughRows();
    });
  });

  // "Last inbound status" — فلتر اختياري (ممكن يفضل "All" من غير ما يمنع
  // الحسبة زي التلاتة اللي فوق)، بيبني الأوبشنز ديناميكيًا (Before <year>
  // + Q1..Q4 <year> بناء على السنة الحالية) مرة واحدة أول ما الصفحة تحمّل.
  const stLastInboundStatusSelect = $("stLastInboundStatusSelect");
  if (stLastInboundStatusSelect && stLastInboundStatusSelect.options.length <= 1) {
    ["before", "q1", "q2", "q3", "q4"].forEach(bucket => {
      const opt = document.createElement("option");
      opt.value = bucket;
      opt.textContent = stLastInboundBucketLabel(bucket);
      stLastInboundStatusSelect.appendChild(opt);
    });
  }
  if (stLastInboundStatusSelect) {
    stLastInboundStatusSelect.addEventListener("change", (e) => {
      state.stFilters.lastInboundStatus = e.target.value || "";
      recomputeSellthroughRows();
    });
  }

  if($("prevPageSellthrough")) $("prevPageSellthrough").addEventListener("click", () => {
    if (state.sellthroughPage > 0) { state.sellthroughPage -= 1; renderPaginatedSellthroughTable(); }
  });
  
  if($("nextPageSellthrough")) $("nextPageSellthrough").addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.filteredSellthroughData.length / 10));
    if (state.sellthroughPage < totalPages - 1) { state.sellthroughPage += 1; renderPaginatedSellthroughTable(); }
  });

  // تفعيل الترتيب عند الضغط على رؤوس الأعمدة
  document.querySelectorAll("#sellthroughTable thead th").forEach((th) => {
    if (th.dataset.stkey) {
      th.addEventListener("click", () => sortSellthrough(th.dataset.stkey));
    }
  });
});

function sortMpMatches(key) {
  if (mpMatchesState.sortKey === key) { mpMatchesState.sortDir = mpMatchesState.sortDir === "asc" ? "desc" : "asc"; } else { mpMatchesState.sortKey = key; mpMatchesState.sortDir = "desc"; }
  applyMpMatchesSearchAndSort();
}

function applyMpMatchesSearchAndSort() {
  const term = $("searchMpMatchesInput") ? $("searchMpMatchesInput").value.trim().toLowerCase() : "";
  mpMatchesState.filtered = mpMatchesState.data.filter(m => {
    if (!term) return true;
    return (m.productName && m.productName.toLowerCase().includes(term)) || (m.productId && String(m.productId).toLowerCase().includes(term)) ||
      (m.merchantName && m.merchantName.toLowerCase().includes(term)) || (m.merchantId && String(m.merchantId).toLowerCase().includes(term)) ||
      (m.acm && m.acm.toLowerCase().includes(term));
  });
  const { sortKey, sortDir } = mpMatchesState; const dir = sortDir === "asc" ? 1 : -1;
  mpMatchesState.filtered.sort((a, b) => { const av = a[sortKey]; const bv = b[sortKey]; if (typeof av === "string") return av.localeCompare(bv) * dir; return ((av || 0) - (bv || 0)) * dir; });
  mpMatchesState.page = 0;
  renderPaginatedMpMatchesTable();
}

function renderPaginatedMpMatchesTable() {
  const tbody = $("mpMatchesTableBody"); if (!tbody) return; tbody.innerHTML = "";
  const start = mpMatchesState.page * PAGE_SIZE;
  const pageRows = mpMatchesState.filtered.slice(start, start + PAGE_SIZE);
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim">${m.productId}</td>
      <td class="truncate-cell" title="${m.productName}">${m.productName}</td>
      <td class="font-mono text-dim">${m.merchantId}</td>
      <td class="truncate-cell" title="${m.merchantName}">${m.merchantName}</td>
      <td class="text-dim truncate-cell" style="max-width:120px;" title="${m.acm}">${m.acm}</td>
      <td class="num font-bold">${fmtIntCell(m.totalPlaced)}</td>
      <td class="num text-blue">${fmtIntCell(m.totalConfirmed)}</td>
      <td class="num text-green">${fmtIntCell(m.totalDelivered)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
      <td class="num font-bold text-dim">${fmtMoneyCompactCell(m.deliveredGmv)}</td>
      <td class="num">${fmtPctCell(m.contrPct)}</td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.placedAsp)}</td>
      <td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompactCell(m.cm3)}</td>
      <td class="num font-bold">${fmtMoneyCompactCell(m.cm3PerPiece)}</td>
      <td class="num text-purple">${fmtPctCell(m.cm3Pct)}</td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(mpMatchesState.filtered.length / PAGE_SIZE));
  if ($("rowCountMpMatches")) $("rowCountMpMatches").textContent = `${fmtInt.format(mpMatchesState.filtered.length)} Matches`;
  if ($("pageIndicatorMpMatches")) $("pageIndicatorMpMatches").textContent = `Page ${mpMatchesState.page + 1} of ${totalPages}`;
  if ($("prevPageMpMatches")) $("prevPageMpMatches").disabled = mpMatchesState.page === 0;
  if ($("nextPageMpMatches")) $("nextPageMpMatches").disabled = mpMatchesState.page >= totalPages - 1;
}

// =====================================================================
// NEW MATCHES (تحت Marketplace، بعد Performance-Matches مباشرة) — ماتشات
// (Merchant × SKU) "جديدة" بمعنى حرفي: أول ظهور ليها هو من يوم
// NEW_MATCH_START_DAY الشهر الحالي لحد النهاردة، ومعندهاش أي نشاط خالص:
//   1) في نفس الشهر الحالي قبل يوم NEW_MATCH_START_DAY، ولا
//   2) في الشهر اللي فات كله (بنستخدم بيانات شيت الـ Main بتاعة الشهر اللي
//      فات كاملة — مش بس جزء منه — عشان نتأكد إن الماتش فعلاً معندوش أي
//      نشاط في الشهر ده خالص).
// لو الماتش ظهر في أي واحدة من الفترتين دول، مبيبقاش "جديد" حتى لو كمان
// ظهر من يوم NEW_MATCH_START_DAY لحد النهاردة — بيتستبعد خالص.
// كل match (مفتاح Merchant×SKU) بيتجمّع مرة واحدة بس (Map)، فالعدّ في
// كروت الكاتيجوري تحت مش ممكن يبقى فيه تكرار لنفس الماتش.
//
// كاتيجوريز "Fashion" و"Taager Gomla" مستبعدة بالكامل من السكشن ده (مش
// كاتيجوريز حقيقية معتمدة هنا) — لا في الكروت ولا في الجدول.
//
// الأرقام:
//   - Total Placed/Confirmed/Delivered Pcs, Placed ASP, PPM%: من غير أي
//     لاج، من كل صفوف الفترة يوم NEW_MATCH_START_DAY -> النهاردة.
//   - CR% (Confirmed/Placed): كات أوف يومين (CR_LAG_DAYS)، على نفس فترة
//     يوم NEW_MATCH_START_DAY -> النهاردة.
//   - DR% (Delivered/Confirmed): كات أوف 4 أيام، على نفس الفترة.
//   - NDR% = CR% × DR%.
//   - CM3/CM3-Per-Piece/CM3%: نفس كات أوف الـ CM3_LAG_DAYS المطبق في أي
//     حتة تانية مصدرها MAIN_GID (Performance-Matches وغيره).
//   - Match Start: أقدم تاريخ ظهر فيه الماتش ده (من يوم
//     NEW_MATCH_START_DAY -> النهاردة، لأنه أصلاً معندوش نشاط قبل كده).
// =====================================================================
const NEW_MATCH_START_DAY = 10;
const NEW_MATCH_DR_LAG_DAYS = 4;
const NEW_MATCH_EXCLUDED_CATEGORIES = new Set(["fashion", "taager gomla"]);

function prepareMpNewMatchesData() {
  const mainRowsAll = state.allParsedRows || [];
  const now = new Date();
  const currentMonthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthYear = prevMonthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const thisMonthRows = mainRowsAll.filter(r => r.monthYear === currentMonthYear);
  const prevMonthRows = mainRowsAll.filter(r => r.monthYear === prevMonthYear);

  // ماتشات ظهرت في نفس الشهر الحالي قبل يوم NEW_MATCH_START_DAY — مستبعدة.
  const beforeStartKeys = new Set();
  // صفوف من يوم NEW_MATCH_START_DAY لحد النهاردة (البيانات أصلاً بتتسحب لحد
  // النهاردة، فمفيش داعي لقيد إضافي على "آخر تاريخ").
  const startDayRows = [];
  thisMonthRows.forEach(r => {
    if (!r.merchantId || !r.sku || !r.timestamp) return;
    const day = new Date(r.timestamp).getDate();
    const key = r.merchantId + "||" + r.sku;
    if (day < NEW_MATCH_START_DAY) beforeStartKeys.add(key);
    else startDayRows.push(r);
  });

  // ماتشات ظهرت في الشهر اللي فات (أي نشاط خالص، من كل بيانات الشهر اللي
  // فات المتاحة في شيت الـ Main، من غير أي قيد على الرينج) — مستبعدة.
  const prevMonthKeys = new Set();
  prevMonthRows.forEach(r => {
    if (!r.merchantId || !r.sku) return;
    prevMonthKeys.add(r.merchantId + "||" + r.sku);
  });

  const cm3Cutoff = getCm3LagCutoffTimestamp(startDayRows);
  const crCutoff = getLagCutoffTimestamp(startDayRows, CR_LAG_DAYS); // يومين
  const drCutoff = getLagCutoffTimestamp(startDayRows, NEW_MATCH_DR_LAG_DAYS); // 4 أيام

  const map = new Map();
  startDayRows.forEach(r => {
    const key = r.merchantId + "||" + r.sku;
    if (beforeStartKeys.has(key) || prevMonthKeys.has(key)) return; // مش ماتش جديد
    const inv = state.inventoryMap[r.sku];
    const category = (inv ? inv.category : "") || r.category || "Uncategorized";
    if (NEW_MATCH_EXCLUDED_CATEGORIES.has(category.trim().toLowerCase())) return; // Fashion / Taager Gomla مستبعدين

    if (!map.has(key)) {
      map.set(key, {
        sku: r.sku,
        skuName: (inv ? inv.skuName : "") || "Unknown",
        category,
        merchantId: r.merchantId, merchantName: r.merchantName || r.merchantId,
        placed: 0, confirmed: 0, delivered: 0, placedGmv: 0, deliveredGmv: 0, ppm: 0, cm3: 0, cm3Gmv: 0,
        crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0,
        matchStartTs: r.timestamp, matchStartDate: r.date
      });
    }
    const e = map.get(key);
    e.placed += r.placedPieces || 0; e.confirmed += r.confirmedPieces || 0; e.delivered += r.deliveredPieces || 0;
    e.placedGmv += r.placedGmv || 0; e.deliveredGmv += r.deliveredGmv || 0; e.ppm += r.ppm || 0;
    if (isRowEligibleForLag(r, crCutoff)) { e.crPlaced += r.placedPieces || 0; e.crConfirmed += r.confirmedPieces || 0; }
    if (isRowEligibleForLag(r, drCutoff)) { e.drConfirmed += r.confirmedPieces || 0; e.drDelivered += r.deliveredPieces || 0; }
    if (isCm3RowEligible(r, cm3Cutoff)) { e.cm3 += r.cm3 || 0; e.cm3Gmv += r.deliveredGmv || 0; }
    if (r.timestamp && r.timestamp < e.matchStartTs) { e.matchStartTs = r.timestamp; e.matchStartDate = r.date; } // أقدم ظهور للماتش
  });

  mpNewMatchesState.data = Array.from(map.values()).map(e => {
    const crPct = e.crPlaced ? (e.crConfirmed / e.crPlaced) * 100 : 0;
    const drPct = e.drConfirmed ? (e.drDelivered / e.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const cm3PerPiece = e.delivered ? (e.cm3 / e.delivered) : 0;
    const cm3Pct = e.cm3Gmv ? (e.cm3 / e.cm3Gmv) * 100 : 0;
    const placedAsp = e.placed ? (e.placedGmv / e.placed) : 0;
    const ppmPct = e.deliveredGmv ? (e.ppm / e.deliveredGmv) * 100 : 0;
    return { ...e, crPct, drPct, ndrPct, cm3PerPiece, cm3Pct, placedAsp, ppmPct };
  });

  if ($("mpNewMatchesTotal")) $("mpNewMatchesTotal").textContent = fmtInt.format(mpNewMatchesState.data.length);
  if ($("mpNewMatchesRangeLabel")) $("mpNewMatchesRangeLabel").textContent = `Day ${NEW_MATCH_START_DAY} - ${now.getDate()} ${currentMonthYear}`;

  renderMpNewMatchesCategoryBoxes();
  applyMpNewMatchesSearchAndSort();
}

// كارت لكل كاتيجوري فيها ماتش جديد واحد على الأقل، بعدد الماتشات الجديدة
// بتاعتها. العد هنا مبني على mpNewMatchesState.data اللي هي أصلاً مبنية من
// Map مفتاحها Merchant×SKU (سطر واحد بس لكل ماتش) — فمفيش أي تكرار ممكن
// يحصل هنا، كل ماتش بيتحسب مرة واحدة في الكاتيجوري بتاعته بالظبط.
function renderMpNewMatchesCategoryBoxes() {
  const grid = $("mpNewMatchesCategoryGrid"); if (!grid) return;
  const catCounts = new Map();
  mpNewMatchesState.data.forEach(m => { catCounts.set(m.category, (catCounts.get(m.category) || 0) + 1); });
  const cats = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]);
  if (!cats.length) {
    grid.innerHTML = `<div class="metric-card hover-glow"><div class="metric-title">No New Matches</div><div class="metric-value">0</div><div class="metric-sub text-dim">In the selected range</div></div>`;
    return;
  }
  grid.innerHTML = cats.map(([cat, count]) => `
    <div class="metric-card hover-glow">
      <div class="metric-title truncate-cell" title="${cat}">${cat} <span class="icon-box"></span></div>
      <div class="metric-value">${fmtInt.format(count)}</div>
      <div class="metric-sub text-dim">New Matches</div>
    </div>
  `).join("");
}

function sortMpNewMatches(key) {
  if (mpNewMatchesState.sortKey === key) { mpNewMatchesState.sortDir = mpNewMatchesState.sortDir === "asc" ? "desc" : "asc"; } else { mpNewMatchesState.sortKey = key; mpNewMatchesState.sortDir = "desc"; }
  applyMpNewMatchesSearchAndSort();
}

function applyMpNewMatchesSearchAndSort() {
  const term = $("searchMpNewMatchesInput") ? $("searchMpNewMatchesInput").value.trim().toLowerCase() : "";
  mpNewMatchesState.filtered = mpNewMatchesState.data.filter(m => {
    if (!term) return true;
    return (m.skuName && m.skuName.toLowerCase().includes(term)) || (m.sku && String(m.sku).toLowerCase().includes(term)) ||
      (m.merchantName && m.merchantName.toLowerCase().includes(term)) || (m.merchantId && String(m.merchantId).toLowerCase().includes(term)) ||
      (m.category && m.category.toLowerCase().includes(term));
  });
  const { sortKey, sortDir } = mpNewMatchesState; const dir = sortDir === "asc" ? 1 : -1;
  mpNewMatchesState.filtered.sort((a, b) => { const av = a[sortKey]; const bv = b[sortKey]; if (typeof av === "string") return av.localeCompare(bv) * dir; return ((av || 0) - (bv || 0)) * dir; });
  mpNewMatchesState.page = 0;
  renderPaginatedMpNewMatchesTable();
}

function renderPaginatedMpNewMatchesTable() {
  const tbody = $("mpNewMatchesTableBody"); if (!tbody) return; tbody.innerHTML = "";
  const start = mpNewMatchesState.page * PAGE_SIZE;
  const pageRows = mpNewMatchesState.filtered.slice(start, start + PAGE_SIZE);
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim">${m.sku}</td>
      <td class="truncate-cell" title="${m.skuName}">${m.skuName}</td>
      <td class="truncate-cell" title="${m.category}">${m.category}</td>
      <td class="font-mono text-dim">${m.merchantId}</td>
      <td class="truncate-cell" title="${m.merchantName}">${m.merchantName}</td>
      <td class="num font-bold">${fmtIntCell(m.placed)}</td>
      <td class="num text-blue">${fmtIntCell(m.confirmed)}</td>
      <td class="num text-green">${fmtIntCell(m.delivered)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
      <td class="num font-bold">${fmtMoneyCompactCell(m.cm3PerPiece)}</td>
      <td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompactCell(m.cm3)}</td>
      <td class="num text-purple">${fmtPctCell(m.cm3Pct)}</td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.placedAsp)}</td>
      <td class="num">${fmtPctCell(m.ppmPct)}</td>
      <td class="text-dim">${m.matchStartDate || "-"}</td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(mpNewMatchesState.filtered.length / PAGE_SIZE));
  if ($("rowCountMpNewMatches")) $("rowCountMpNewMatches").textContent = `${fmtInt.format(mpNewMatchesState.filtered.length)} Matches`;
  if ($("pageIndicatorMpNewMatches")) $("pageIndicatorMpNewMatches").textContent = `Page ${mpNewMatchesState.page + 1} of ${totalPages}`;
  if ($("prevPageMpNewMatches")) $("prevPageMpNewMatches").disabled = mpNewMatchesState.page === 0;
  if ($("nextPageMpNewMatches")) $("nextPageMpNewMatches").disabled = mpNewMatchesState.page >= totalPages - 1;
}

// ---- Poor Matches: ترتيب / بحث / رسم (نفس باترن Performance-Matches بالظبط) ----
function sortPoorMatches(key) {
  if (poorMatchesState.sortKey === key) { poorMatchesState.sortDir = poorMatchesState.sortDir === "asc" ? "desc" : "asc"; } else { poorMatchesState.sortKey = key; poorMatchesState.sortDir = "desc"; }
  applyPoorMatchesSearchAndSort();
}

function applyPoorMatchesSearchAndSort() {
  const term = $("searchPoorMatchesInput") ? $("searchPoorMatchesInput").value.trim().toLowerCase() : "";
  // الجدول بيعرض بس الماتشات "Bad" (السيئة) — ده أصلاً معنى "Poor Matches".
  let base = poorMatchesState.data.filter(m => m.status === "Bad");
  poorMatchesState.filtered = base.filter(m => {
    if (!term) return true;
    return (m.productName && m.productName.toLowerCase().includes(term)) || (m.sku && String(m.sku).toLowerCase().includes(term)) ||
      (m.merchantName && m.merchantName.toLowerCase().includes(term)) || (m.merchantId && String(m.merchantId).toLowerCase().includes(term)) ||
      (m.category && m.category.toLowerCase().includes(term)) || (m.subCategory && m.subCategory.toLowerCase().includes(term)) ||
      (m.acm && m.acm.toLowerCase().includes(term));
  });
  const { sortKey, sortDir } = poorMatchesState; const dir = sortDir === "asc" ? 1 : -1;
  poorMatchesState.filtered.sort((a, b) => { const av = a[sortKey]; const bv = b[sortKey]; if (typeof av === "string") return av.localeCompare(bv) * dir; return ((av || 0) - (bv || 0)) * dir; });
  poorMatchesState.page = 0;
  renderPaginatedPoorMatchesTable();
}

function renderPaginatedPoorMatchesTable() {
  const tbody = $("poorMatchesTableBody"); if (!tbody) return; tbody.innerHTML = "";
  const start = poorMatchesState.page * PAGE_SIZE;
  const pageRows = poorMatchesState.filtered.slice(start, start + PAGE_SIZE);
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim">${m.merchantId}</td>
      <td class="truncate-cell" title="${m.merchantName}">${m.merchantName}</td>
      <td class="font-mono text-dim">${m.sku}</td>
      <td class="truncate-cell" title="${m.productName}">${m.productName}</td>
      <td class="text-dim">${m.category}</td>
      <td class="text-dim truncate-cell" title="${m.subCategory}">${m.subCategory}</td>
      <td class="text-dim truncate-cell" style="max-width:120px;" title="${m.acm}">${m.acm}</td>
      <td class="num font-bold">${fmtIntCell(m.placed)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.ndrBenchmark)}</td>
      <td class="num font-bold text-red">${fmtIntCell(Math.round(m.impactPieces))}</td>
      <td class="center"><span class="badge-outline red">${m.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(poorMatchesState.filtered.length / PAGE_SIZE));
  if ($("rowCountPoorMatches")) $("rowCountPoorMatches").textContent = `${fmtInt.format(poorMatchesState.filtered.length)} Poor Matches`;
  if ($("pageIndicatorPoorMatches")) $("pageIndicatorPoorMatches").textContent = `Page ${poorMatchesState.page + 1} of ${totalPages}`;
  if ($("prevPagePoorMatches")) $("prevPagePoorMatches").disabled = poorMatchesState.page === 0;
  if ($("nextPagePoorMatches")) $("nextPagePoorMatches").disabled = poorMatchesState.page >= totalPages - 1;
}

// كروت وجدول الملخص (زي تاب NDR_Summary بالظبط: Total Placed/Delivered/NDR،
// Missed Deliveries، Expected Delivered/NDR، وجدول Good/Bad/Total).
function renderPoorMatchesSummary() {
  const s = poorMatchesState.summary; if (!s) return;
  if ($("pmTotalPlaced")) $("pmTotalPlaced").textContent = fmtInt.format(Math.round(s.totalPlaced));
  if ($("pmCurrentDelivered")) $("pmCurrentDelivered").textContent = fmtInt.format(Math.round(s.totalDelivered));
  if ($("pmCurrentNdr")) $("pmCurrentNdr").textContent = fmtPct(s.currentNdr);
  if ($("pmMissedDeliveries")) $("pmMissedDeliveries").textContent = fmtInt.format(Math.round(s.missedDeliveries));
  if ($("pmExpectedDelivered")) $("pmExpectedDelivered").textContent = fmtInt.format(Math.round(s.expectedDelivered));
  if ($("pmExpectedNdr")) $("pmExpectedNdr").textContent = fmtPct(s.expectedNdr);

  // عنوان فرعي بيوضح فترة المقارنة (نفس عدد الأيام من الشهر اللي فات).
  if ($("pmCompareLabel")) {
    $("pmCompareLabel").textContent = s.prev ? `vs ${s.prev.label}` : "No comparable data last month";
  }

  const tbody = $("pmStatusTableBody");
  if (tbody) {
    // Δ NDR بالنقاط (Percentage Points) بين الفترة الحالية والفترة المقارنة
    // من الشهر اللي فات — أخضر لو تحسّن، أحمر لو ساء، رمادي لو مفيش داتا مقارنة.
    const deltaBadge = (curr, prevBucket) => {
      if (!prevBucket) return `<span class="badge-outline dim">—</span>`;
      const delta = curr.ndr - prevBucket.ndr;
      const cls = delta > 0.05 ? "green" : (delta < -0.05 ? "red" : "dim");
      const arrow = delta > 0.05 ? "▲" : (delta < -0.05 ? "▼" : "➖");
      return `<span class="badge-outline ${cls}">${arrow} ${delta > 0 ? '+' : ''}${delta.toFixed(1)}pts</span>`;
    };
    const row = (label, cls, b, prevBucket) => `
      <tr>
        <td class="font-bold"><span class="badge-outline ${cls}">${label}</span></td>
        <td class="num">${fmtInt.format(b.count)}</td>
        <td class="num font-bold">${fmtIntCell(Math.round(b.placed))}</td>
        <td class="num">${fmtPctCell(b.ndr)}</td>
        <td class="num text-dim">${fmtPctCell(b.contribution)}</td>
        <td class="num text-dim">${prevBucket ? fmtIntCell(Math.round(prevBucket.placed)) : "—"}</td>
        <td class="num text-dim">${prevBucket ? fmtPctCell(prevBucket.ndr) : "—"}</td>
        <td class="num">${deltaBadge(b, prevBucket)}</td>
      </tr>`;
    tbody.innerHTML =
      row("Good", "green", s.good, s.prev ? s.prev.good : null) +
      row("Bad", "red", s.bad, s.prev ? s.prev.bad : null) +
      row("Total", "dim", s.total, s.prev ? s.prev.total : null);
  }
}

// =====================================================================
// AVAILABILITY LOCKING (تحت Poor Matches) — من شيت AVAILABILITY_LOCKING_GID.
// القفل هنا على مستوى الـ Single SKU مباشرة (PRODUCT_ID في الشيت ده =
// SINGLE_ID)، فبنستخدم نفس خريطة الديبندلايز المستخدمة في Commercial Plan
// (buildDebundleProductMap) عشان:
//   1) نعرف الـ Single SKUs كلها (سواء قايمة لوحدها أو جوه بندلات).
//   2) نوزّع ديماند "Placed Yesterday" بتاع أي PRODUCT_ID في MAIN_GID (بندل
//      أو سنجل) على كل Single جواه × PRODUCT_QUANTITY، بالظبط زي توزيع
//      القطع في Commercial Plan.
//
// تعريفات (زي الجدول اللي بعته بالظبط):
//   IN Stock SKUs   = عدد الـ Single SKUs اللي عندها Stock > 0.
//   Total AVB SKUs  = عدد الـ Single SKUs اللي WEBSITE_STATUS بتاعها
//                     "Available" فعليًا (من شيت Products) — مجموعة فرعية
//                     من IN Stock عادة، لأن مش كل اللي فيه Stock متاح على
//                     الموقع بالضرورة.
//   locked SKUs      = عدد الـ Single SKUs اللي عليها قفل نشط (Active) دلوقتي.
//   solo locked SKUs = زي اللي فوق، بس القفل من نوع "Solo" تحديدًا.
//   Placed Yesterday = إجمالي ديماند الأمس (Single-level) لكل الـ SKUs في
//                     الكاتيجوري (مش بس المقفولة).
//   locked demand / solo locked demand = نفس ديماند الأمس، لكن بس للـ SKUs
//                     المقفولة / المقفولة Solo.
//
// إضافات مني (زودتها كمقاييس مفيدة، مش موجودة في الجدول اللي بعته):
//   Remaining Locked Pieces = مجموع REMAINING_PIECES للقفلات النشطة.
//   Expiring ≤3 Days        = عدد الـ SKUs المقفولة اللي هتخلص خلال 3 أيام.
//   Stock at Risk %         = نسبة الـ Stock المقفول (Remaining Locked
//                     Pieces) من إجمالي الـ Stock بتاع الـ SKUs المقفولة —
//                     مؤشر لحجم الاستوك "المحبوس" حاليًا عن باقي التجار.
// =====================================================================
function alIsAvailable(status) {
  const s = (status || "").toString().trim().toLowerCase();
  if (!s) return false;
  if (s.includes("not available") || s.includes("unavailable") || s.includes("inactive") || s === "no" || s === "false" || s === "0") return false;
  return s.includes("available") || s === "yes" || s === "true" || s === "1" || s.includes("active");
}
function alIsLockActive(lock, todayMs) {
  const flag = (lock.flag || "").toString().trim().toLowerCase();
  // FLAG واضح إنه ملغي/متسحب -> مش نشط بغض النظر عن تاريخ الانتهاء
  if (flag.includes("cancel") || flag.includes("expired") || flag.includes("inactive") || flag.includes("released") || flag === "false" || flag === "0") return false;
  if (!lock.expiryTs) return true; // مفيش تاريخ انتهاء = قفل مستمر لحد ما يتلغى
  return lock.expiryTs >= todayMs;
}

function computeAvailabilityLocking() {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const mainRowsAll = state.allParsedRows || [];
  const mainRows = mainRowsAll.filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));

  const { productMap, singlesList, stockBySingle } = buildDebundleProductMap(state.debundleMap, state.cogsMap);

  let latestTs = 0; mainRows.forEach(r => { if (r.timestamp > latestTs) latestTs = r.timestamp; });
  const today = new Date(latestTs); today.setHours(0, 0, 0, 0); const todayMs = today.getTime();
  const ydayStart = todayMs - 86400000; const ydayEnd = todayMs; // [إمبارح 00:00, النهاردة 00:00)
  const d3Start = todayMs - (3 * 86400000); // آخر 3 أيام (Avg Last 3 Days Placed)

  // ديماند الأمس موزّع على مستوى Single SKU (× PRODUCT_QUANTITY)، بالظبط
  // زي توزيع القطع (Placed Pieces) في Commercial Plan.
  // ديماند الأمس موزّع على مستوى Single SKU (× PRODUCT_QUANTITY)، بالظبط
  // زي توزيع القطع (Placed Pieces) في Commercial Plan — ومعاها كمان نفس
  // التوزيع لكن على مستوى (تاجر × Single) عشان نعرف كل تاجر رفع كام على
  // الـ SKU ده بالذات (سواء اشتراه Single لوحده أو جوه بندل)، مش بس إجمالي
  // كل التجار مع بعض.
  const ydayDemandBySingle = new Map();
  const ydayDemandByMerchantSingle = new Map(); // "merchantId||singleId" -> pieces
  // نفس الفكرة بس على مستوى آخر 3 أيام (تاجر × Single) — مستخدمة لحساب
  // DOH بتاع الـ Remaining Pieces في كل قفل: كام يوم هتقضي القطع المتبقية
  // لو التاجر ده استمر يطلب بنفس معدل آخر 3 أيام.
  const d3DemandByMerchantSingle = new Map();
  mainRows.forEach(r => {
    if (!r.sku || r.timestamp < ydayStart || r.timestamp >= ydayEnd) return;
    const mappings = productMap.get(r.sku);
    if (!mappings || !mappings.length) return;
    mappings.forEach(mapping => {
      const qty = mapping.quantity || 1;
      const demand = r.placedPieces * qty;
      ydayDemandBySingle.set(mapping.singleId, (ydayDemandBySingle.get(mapping.singleId) || 0) + demand);
      if (r.merchantId) {
        const key = r.merchantId + "||" + mapping.singleId;
        ydayDemandByMerchantSingle.set(key, (ydayDemandByMerchantSingle.get(key) || 0) + demand);
      }
    });
  });
  mainRows.forEach(r => {
    if (!r.sku || r.timestamp < d3Start || r.timestamp >= ydayEnd || !r.merchantId) return;
    const mappings = productMap.get(r.sku);
    if (!mappings || !mappings.length) return;
    mappings.forEach(mapping => {
      const qty = mapping.quantity || 1;
      const key = r.merchantId + "||" + mapping.singleId;
      d3DemandByMerchantSingle.set(key, (d3DemandByMerchantSingle.get(key) || 0) + r.placedPieces * qty);
    });
  });

  const locksBySingle = new Map();
  (state.availabilityLockingRows || []).forEach(l => {
    if (!l.singleId) return;
    if (!locksBySingle.has(l.singleId)) locksBySingle.set(l.singleId, []);
    locksBySingle.get(l.singleId).push(l);
  });

  const rows = [];
  singlesList.forEach((singleName, singleId) => {
    const invInfo = state.inventoryMap[singleId] || {};
    const prodInfo = state.productsMap[singleId] || {};
    const targetInfo = (state.singleSkuTargets || {})[singleId];
    const category = invInfo.category || prodInfo.category || (targetInfo && targetInfo.category) || "Uncategorized";
    const stock = stockBySingle.has(singleId) ? stockBySingle.get(singleId) : (invInfo.stock || 0);
    const isAvailable = alIsAvailable(prodInfo.websiteStatus);

    const locks = locksBySingle.get(singleId) || [];
    const activeLocks = locks.filter(l => alIsLockActive(l, todayMs)).map(l => {
      const daysToExpiry = l.expiryTs ? Math.round((l.expiryTs - todayMs) / 86400000) : null;
      // ديماند الأمس بتاعة التاجر صاحب القفل ده تحديدًا على الـ SKU ده —
      // (سواء اشتراه هو Single لوحده أو جوه أي بندل بيحتوي عليه)، مش
      // إجمالي كل التجار مع بعض على نفس الـ SKU.
      const placedYdayMerchant = ydayDemandByMerchantSingle.get(l.tagerId + "||" + singleId) || 0;
      const avg3dPlacedMerchant = (d3DemandByMerchantSingle.get(l.tagerId + "||" + singleId) || 0) / 3;
      return { ...l, daysToExpiry, statusLabel: daysToExpiry === null ? "Active" : (daysToExpiry <= 3 ? "Expiring Soon" : "Active"), placedYdayMerchant, avg3dPlacedMerchant };
    });
    const hasLock = activeLocks.length > 0;
    // Solo Lock = الـ SKU ده مقفول (Active) على تاجر واحد بس دلوقتي — يعني
    // عدد التجار المختلفين (Merchant IDs) اللي ليهم قفل نشط على نفس الـ SKU
    // ده = 1 بالظبط. لو أكتر من تاجر واحد قافل نفس الـ SKU (حتى لو كل
    // القفلات نوعها "Solo" في عمود LOCKING_TYPE)، مبقاش "Solo" بمعنى
    // الحصرية — لأنه مش محجوز لتاجر واحد بس.
    const distinctLockedMerchants = new Set(activeLocks.map(l => l.tagerId));
    const hasSoloLock = hasLock && distinctLockedMerchants.size === 1;
    const remainingLockedPieces = activeLocks.reduce((s, l) => s + (l.remainingPieces || 0), 0);
    const isExpiringSoon = activeLocks.some(l => l.daysToExpiry !== null && l.daysToExpiry <= 3);

    rows.push({
      singleId, singleName: singleName || (invInfo.skuName || singleId), category, stock, isAvailable,
      placedYday: ydayDemandBySingle.get(singleId) || 0,
      hasLock, hasSoloLock, activeLocks, remainingLockedPieces, isExpiringSoon
    });
  });

  return rows;
}

function prepareAvailabilityLockingData() {
  const rows = computeAvailabilityLocking();
  state.availabilityLockingSkuRows = rows;

  const catMap = new Map();
  const emptyCat = () => ({
    category: "", inStockSkus: 0, totalAvbSkus: 0, lockedSkus: 0, soloLockedSkus: 0,
    placedYesterday: 0, lockedDemand: 0, soloLockedDemand: 0,
    remainingLockedPieces: 0, totalStock: 0
  });
  rows.forEach(r => {
    const cat = r.category || "Uncategorized";
    if (!catMap.has(cat)) { const c = emptyCat(); c.category = cat; catMap.set(cat, c); }
    const c = catMap.get(cat);
    // Stock at Risk % بيقارن بالـ Stock الكلي لكل الـ Single SKUs في
    // الكاتيجوري (مش بس اللي متقفلة) — فبنجمعه هنا لكل صف بغض النظر عن
    // حالة القفل.
    c.totalStock += r.stock;
    if (r.stock > 0) c.inStockSkus++;
    if (r.isAvailable) c.totalAvbSkus++;
    c.placedYesterday += r.placedYday;
    if (r.hasLock) { c.lockedSkus++; c.lockedDemand += r.placedYday; c.remainingLockedPieces += r.remainingLockedPieces; }
    if (r.hasSoloLock) { c.soloLockedSkus++; c.soloLockedDemand += r.placedYday; }
  });

  // Stock at Risk % = (مجموع REMAINING_PIECES بتاعة القفلات النشطة على
  // منتجات الكاتيجوري) ÷ (إجمالي الـ Stock الحالي لكل الـ Single SKUs في
  // الكاتيجوري، مقفولة أو مش مقفولة) × 100.
  const categoryRows = Array.from(catMap.values()).map(c => ({
    ...c, stockAtRiskPct: c.totalStock > 0 ? (c.remainingLockedPieces / c.totalStock) * 100 : 0
  })).sort((a, b) => b.placedYesterday - a.placedYesterday);

  const totals = categoryRows.reduce((acc, c) => {
    acc.inStockSkus += c.inStockSkus; acc.totalAvbSkus += c.totalAvbSkus; acc.lockedSkus += c.lockedSkus;
    acc.soloLockedSkus += c.soloLockedSkus; acc.placedYesterday += c.placedYesterday; acc.lockedDemand += c.lockedDemand;
    acc.soloLockedDemand += c.soloLockedDemand; acc.remainingLockedPieces += c.remainingLockedPieces;
    acc.totalStock += c.totalStock;
    return acc;
  }, { category: "Totals", inStockSkus: 0, totalAvbSkus: 0, lockedSkus: 0, soloLockedSkus: 0, placedYesterday: 0, lockedDemand: 0, soloLockedDemand: 0, remainingLockedPieces: 0, totalStock: 0 });
  totals.stockAtRiskPct = totals.totalStock > 0 ? (totals.remainingLockedPieces / totals.totalStock) * 100 : 0;

  state.availabilityLockingCategoryRows = categoryRows;
  state.availabilityLockingTotals = totals;

  // جدول تفصيلي على مستوى كل قفل لوحده (مش SKU) — كل صف من شيت اللوكينج
  // نفسه (لو الـ SKU عليه أكتر من قفل/تاجر، كل واحد بيظهر في صف لوحده)،
  // مُثرى بالـ Stock وديماند الأمس (إجمالي الـ SKU + ديماند التاجر ده نفسه
  // بس) والكاتيجوري بتاعة الـ SKU.
  const lockDetailRows = [];
  rows.forEach(r => {
    r.activeLocks.forEach(l => {
      lockDetailRows.push({
        singleId: r.singleId, singleName: r.singleName, category: r.category, stock: r.stock,
        placedYday: r.placedYday, placedYdayMerchant: l.placedYdayMerchant,
        tagerId: l.tagerId, merchantName: l.merchantName, lockingType: l.lockingType,
        allocatedQty: l.allocatedQty, usedQty: l.usedQty, remainingPieces: l.remainingPieces,
        expiryText: l.expiryText, startDateText: l.startDateText, daysToExpiry: l.daysToExpiry, statusLabel: l.statusLabel
      });
    });
  });
  availabilityLockingState.data = lockDetailRows;

  if ($("alTotalLockedSkus")) $("alTotalLockedSkus").textContent = fmtInt.format(totals.lockedSkus);
  if ($("alTotalSoloLockedSkus")) $("alTotalSoloLockedSkus").textContent = fmtInt.format(totals.soloLockedSkus);
  if ($("alRemainingLockedPieces")) $("alRemainingLockedPieces").textContent = fmtInt.format(Math.round(totals.remainingLockedPieces));
  if ($("alStockAtRiskPct")) $("alStockAtRiskPct").textContent = fmtPct(totals.stockAtRiskPct);

  renderAvailabilityLockingCategoryTable();
  applyAvailabilityLockingSearchAndSort();
}

function renderAvailabilityLockingCategoryTable() {
  const tbody = $("alCategoryTableBody");
  if (!tbody) return;
  const rowHtml = (c, isTotal) => `
    <tr${isTotal ? ' class="font-bold"' : ''}>
      <td class="${isTotal ? 'font-bold' : 'font-bold text-purple'}">${c.category}</td>
      <td class="num">${fmtIntCell(c.inStockSkus)}</td>
      <td class="num">${fmtIntCell(c.totalAvbSkus)}</td>
      <td class="num text-orange">${fmtIntCell(c.lockedSkus)}</td>
      <td class="num text-red">${fmtIntCell(c.soloLockedSkus)}</td>
      <td class="num font-bold">${fmtIntCell(Math.round(c.placedYesterday))}</td>
      <td class="num text-orange">${fmtIntCell(Math.round(c.lockedDemand))}</td>
      <td class="num text-red">${fmtIntCell(Math.round(c.soloLockedDemand))}</td>
      <td class="num"><span class="badge-outline ${c.stockAtRiskPct >= 50 ? 'red' : (c.stockAtRiskPct >= 25 ? 'orange' : 'green')}">${fmtPctCell(c.stockAtRiskPct)}</span></td>
    </tr>`;
  const categoryRows = state.availabilityLockingCategoryRows || [];
  const totals = state.availabilityLockingTotals || null;
  tbody.innerHTML = categoryRows.map(c => rowHtml(c, false)).join("") + (totals ? rowHtml(totals, true) : "");
}

function sortAvailabilityLocking(key) {
  if (availabilityLockingState.sortKey === key) { availabilityLockingState.sortDir = availabilityLockingState.sortDir === "asc" ? "desc" : "asc"; } else { availabilityLockingState.sortKey = key; availabilityLockingState.sortDir = "desc"; }
  applyAvailabilityLockingSearchAndSort();
}

function applyAvailabilityLockingSearchAndSort() {
  const term = $("searchAvailabilityLockingInput") ? $("searchAvailabilityLockingInput").value.trim().toLowerCase() : "";
  let data = (availabilityLockingState.data || []).filter(d => {
    if (!term) return true;
    return (d.singleId && String(d.singleId).toLowerCase().includes(term)) || (d.singleName && d.singleName.toLowerCase().includes(term)) ||
      (d.merchantName && d.merchantName.toLowerCase().includes(term)) || (d.tagerId && String(d.tagerId).toLowerCase().includes(term)) ||
      (d.category && d.category.toLowerCase().includes(term)) || (d.lockingType && d.lockingType.toLowerCase().includes(term));
  });
  const { sortKey, sortDir } = availabilityLockingState; const dir = sortDir === "asc" ? 1 : -1;
  data.sort((a, b) => { const av = a[sortKey]; const bv = b[sortKey]; if (typeof av === "string") return av.localeCompare(bv) * dir; return ((av || 0) - (bv || 0)) * dir; });
  availabilityLockingState.filtered = data;
  availabilityLockingState.page = 0;
  renderPaginatedAvailabilityLockingTable();
}

function renderPaginatedAvailabilityLockingTable() {
  const tbody = $("alLockTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const data = availabilityLockingState.filtered || [];
  const start = availabilityLockingState.page * PAGE_SIZE;
  const pageRows = data.slice(start, start + PAGE_SIZE);
  pageRows.forEach(l => {
    const tr = document.createElement("tr");
    const statusCls = l.statusLabel === "Expiring Soon" ? "orange" : "green";
    const typeCls = (l.lockingType || "").toLowerCase().includes("solo") ? "red" : "blue";
    tr.innerHTML = `
      <td class="font-mono text-dim">${l.singleId}</td>
      <td class="font-bold truncate-cell" title="${l.singleName}">${l.singleName}</td>
      <td class="text-dim">${l.category}</td>
      <td class="font-mono text-dim">${l.tagerId}</td>
      <td class="truncate-cell" title="${l.merchantName}">${l.merchantName}</td>
      <td class="center"><span class="badge-outline ${typeCls}">${l.lockingType}</span></td>
      <td class="num font-bold">${fmtIntCell(l.allocatedQty)}</td>
      <td class="num text-dim">${fmtIntCell(l.usedQty)}</td>
      <td class="num text-orange font-bold">${fmtIntCell(l.remainingPieces)}</td>
      <td class="num text-dim">${fmtIntCell(l.stock)}</td>
      <td class="num text-dim">${fmtIntCell(Math.round(l.placedYday))}</td>
      <td class="num font-bold text-purple">${fmtIntCell(Math.round(l.placedYdayMerchant))}</td>
      <td class="text-dim">${l.expiryText || "—"}</td>
      <td class="num">${l.daysToExpiry === null ? "—" : l.daysToExpiry}</td>
      <td class="center"><span class="badge-outline ${statusCls}">${l.statusLabel}</span></td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  if ($("rowCountAvailabilityLocking")) $("rowCountAvailabilityLocking").textContent = `${fmtInt.format(data.length)} Active Locks`;
  if ($("pageIndicatorAvailabilityLocking")) $("pageIndicatorAvailabilityLocking").textContent = `Page ${availabilityLockingState.page + 1} of ${totalPages}`;
  if ($("prevPageAvailabilityLocking")) $("prevPageAvailabilityLocking").disabled = availabilityLockingState.page === 0;
  if ($("nextPageAvailabilityLocking")) $("nextPageAvailabilityLocking").disabled = availabilityLockingState.page >= totalPages - 1;
}

// =========================================================================
// HEALTHY LOCKING (تحت Availability Locking) — بتاخد نفس صفوف القفلات
// النشطة (activeLocks) من computeAvailabilityLocking() وبتحكم على كل قفل:
// "صحي" (Healthy) — بيتستخدم فعلاً وفيه ديماند حالي عليه، "في خطر" (At Risk)
// — استخدام واطي أو قرب ينتهي، أو "مش صحي" (Unhealthy/Idle) — واقف من غير
// أي استخدام ولا ديماند، يعني استوك محبوس من غير أي فايدة وممكن يتفك.
//
// منطق التصنيف (Utilization% = Used Qty ÷ Allocated Qty):
//   - Unhealthy/Idle : Utilization% < 20  و  مفيش ديماند أمس من التاجر ده على
//                       الـ SKU ده خالص (placedYdayMerchant = 0). قفل واقف
//                       من غير أي حركة حقيقية.
//   - At Risk        : باقي على انتهاء القفل 3 أيام أو أقل (وفيه استوك لسه
//                       متبقي، يعني هيتحبس/يضيع لو محدش جدده)، أو Utilization%
//                       بين 20% و50% (استخدام واطي لكن مش صفر خالص).
//   - Healthy         : Utilization% ≥ 50% ومفيش خطر انتهاء قريب — القفل ده
//                       شغال وبيتستخدم فعلاً.
// =========================================================================
function hlComputeLockHealth(l) {
  const utilizationPct = l.allocatedQty > 0 ? (l.usedQty / l.allocatedQty) * 100 : 0;
  const hasRecentDemand = (l.placedYdayMerchant || 0) > 0;
  const expiringSoon = l.daysToExpiry !== null && l.daysToExpiry !== undefined && l.daysToExpiry <= 3;
  if (utilizationPct < 20 && !hasRecentDemand) {
    return { key: "unhealthy", text: "Unhealthy — Idle", cls: "red", utilizationPct };
  }
  if (expiringSoon && (l.remainingPieces || 0) > 0) {
    return { key: "risk", text: "At Risk — Expiring Soon", cls: "orange", utilizationPct };
  }
  if (utilizationPct < 50) {
    return { key: "risk", text: "At Risk — Low Usage", cls: "orange", utilizationPct };
  }
  return { key: "healthy", text: "Healthy", cls: "green", utilizationPct };
}

function hlEmptyGroup() {
  return { activeLocks: 0, healthy: 0, risk: 0, unhealthy: 0, utilWeighted: 0, lockedPieces: 0, idlePieces: 0 };
}
function hlAddToGroup(g, l, health) {
  g.activeLocks++;
  if (health.key === "healthy") g.healthy++; else if (health.key === "risk") g.risk++; else g.unhealthy++;
  g.utilWeighted += health.utilizationPct;
  g.lockedPieces += (l.remainingPieces || 0);
  if (health.key === "unhealthy") g.idlePieces += (l.remainingPieces || 0);
}
function hlFinalizeGroup(g) {
  return { ...g, avgUtilizationPct: g.activeLocks ? (g.utilWeighted / g.activeLocks) : 0 };
}

// بيحسب Delivered GMV لكل (Merchant × Single SKU) — بنفس منطق توزيع البندل
// المستخدم في Commercial Plan بالظبط (وزن الـ COGS بتاع كل Single داخل
// البندل × قيمة الأوردر)، من غير أي كات أوف (الـ GMV مالهاش لاج أصلاً).
// CONTR% في Renew Candidates = نصيب الـ Match ده من إجمالي الـ Delivered GMV
// كله — عشان نعرف مين أهم الـ SKUs اللي القفل بتاعها قرب يخلص.
function hlBuildGmvContribution() {
  const { productMap } = buildDebundleProductMap(state.debundleMap, state.cogsMap);
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const rows = (state.allParsedRows || []).filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));
  const gmvMap = new Map(); // "merchantId||singleId" -> gmv
  let totalGmv = 0;
  rows.forEach(r => {
    if (!r.sku || !r.merchantId) return;
    totalGmv += r.deliveredGmv;
    const mappings = productMap.get(r.sku);
    if (!mappings || !mappings.length) return;
    mappings.forEach(mapping => {
      const weight = mapping.cogsWeight || 0;
      const key = r.merchantId + "||" + mapping.singleId;
      gmvMap.set(key, (gmvMap.get(key) || 0) + r.deliveredGmv * weight);
    });
  });
  return { gmvMap, totalGmv };
}

function prepareHealthyLockingData() {
  const skuRows = computeAvailabilityLocking();
  const { gmvMap, totalGmv } = hlBuildGmvContribution();

  const matchRows = [];
  const categoryMap = new Map();
  const merchantMap = new Map();
  let totalLocks = 0, healthyCount = 0, riskCount = 0, unhealthyCount = 0;
  let utilSum = 0, idlePiecesTotal = 0, healthyPiecesTotal = 0;

  skuRows.forEach(r => {
    r.activeLocks.forEach(l => {
      const health = hlComputeLockHealth(l);
      totalLocks++;
      utilSum += health.utilizationPct;
      if (health.key === "healthy") { healthyCount++; healthyPiecesTotal += (l.remainingPieces || 0); }
      else if (health.key === "risk") riskCount++;
      else { unhealthyCount++; idlePiecesTotal += (l.remainingPieces || 0); }

      const gmvShare = gmvMap.get(l.tagerId + "||" + r.singleId) || 0;
      const contrGmvPct = totalGmv ? (gmvShare / totalGmv) * 100 : 0;
      // DOH بتاع الـ Remaining Pieces: كام يوم هتقضي القطع المتبقية في القفل
      // ده لو التاجر استمر يطلب بنفس معدل آخر 3 أيام (Avg Last 3 Days Placed).
      // لو مفيش ديماند خالص آخر 3 أيام، الـ DOH بيبقى null (يعني مش قادرين
      // نتوقع إمتى هيخلص من الإيقاع الحالي — مش إنه "مش هيخلص خالص").
      const remainingDoh = l.avg3dPlacedMerchant > 0 ? (l.remainingPieces || 0) / l.avg3dPlacedMerchant : null;

      matchRows.push({
        singleId: r.singleId, singleName: r.singleName, category: r.category, stock: r.stock,
        placedYday: r.placedYday, placedYdayMerchant: l.placedYdayMerchant, avg3dPlacedMerchant: l.avg3dPlacedMerchant, remainingDoh,
        tagerId: l.tagerId, merchantName: l.merchantName, lockingType: l.lockingType,
        allocatedQty: l.allocatedQty, usedQty: l.usedQty, remainingPieces: l.remainingPieces,
        utilizationPct: health.utilizationPct, expiryText: l.expiryText, daysToExpiry: l.daysToExpiry,
        healthKey: health.key, healthText: health.text, healthCls: health.cls,
        deliveredGmv: gmvShare, contrGmvPct
      });

      const cat = r.category || "Uncategorized";
      if (!categoryMap.has(cat)) categoryMap.set(cat, hlEmptyGroup());
      hlAddToGroup(categoryMap.get(cat), l, health);

      const mKey = l.tagerId || "Unassigned";
      if (!merchantMap.has(mKey)) merchantMap.set(mKey, { ...hlEmptyGroup(), tagerId: l.tagerId, merchantName: l.merchantName });
      hlAddToGroup(merchantMap.get(mKey), l, health);
    });
  });

  healthyLockingState.data = matchRows;

  const categoryRows = Array.from(categoryMap.entries()).map(([category, g]) => ({ category, ...hlFinalizeGroup(g) })).sort((a, b) => b.activeLocks - a.activeLocks);
  const merchantRows = Array.from(merchantMap.values()).map(g => hlFinalizeGroup(g)).sort((a, b) => b.activeLocks - a.activeLocks);
  state.healthyLockingCategoryRows = categoryRows;
  state.healthyLockingMerchantRows = merchantRows;
  healthyLockingState.merchantPage = 0;

  const avgUtilizationPct = totalLocks ? (utilSum / totalLocks) : 0;
  const healthScorePct = totalLocks ? (healthyCount / totalLocks) * 100 : 0;

  if ($("hlTotalLocks")) $("hlTotalLocks").textContent = fmtInt.format(totalLocks);
  if ($("hlHealthyLocks")) $("hlHealthyLocks").textContent = fmtInt.format(healthyCount);
  if ($("hlHealthyPct")) $("hlHealthyPct").textContent = fmtPct(totalLocks ? (healthyCount / totalLocks) * 100 : 0);
  if ($("hlRiskLocks")) $("hlRiskLocks").textContent = fmtInt.format(riskCount);
  if ($("hlRiskPct")) $("hlRiskPct").textContent = fmtPct(totalLocks ? (riskCount / totalLocks) * 100 : 0);
  if ($("hlUnhealthyLocks")) $("hlUnhealthyLocks").textContent = fmtInt.format(unhealthyCount);
  if ($("hlUnhealthyPct")) $("hlUnhealthyPct").textContent = fmtPct(totalLocks ? (unhealthyCount / totalLocks) * 100 : 0);
  if ($("hlAvgUtilization")) $("hlAvgUtilization").textContent = fmtPct(avgUtilizationPct);
  if ($("hlIdlePieces")) $("hlIdlePieces").textContent = fmtInt.format(Math.round(idlePiecesTotal));
  if ($("hlHealthyPieces")) $("hlHealthyPieces").textContent = fmtInt.format(Math.round(healthyPiecesTotal));
  if ($("hlHealthScore")) $("hlHealthScore").textContent = fmtPct(healthScorePct);

  renderHealthyLockingCategoryTable();
  renderHealthyLockingMerchantTable();
  renderHealthyLockingRecommendations();
  applyHealthyLockingSearchAndSort();
}

function renderHealthyLockingCategoryTable() {
  const tbody = $("hlCategoryTableBody");
  if (!tbody) return;
  const rows = state.healthyLockingCategoryRows || [];
  tbody.innerHTML = rows.map(c => `
    <tr>
      <td class="font-bold text-purple">${c.category}</td>
      <td class="num font-bold">${fmtIntCell(c.activeLocks)}</td>
      <td class="num text-green">${fmtIntCell(c.healthy)}</td>
      <td class="num text-orange">${fmtIntCell(c.risk)}</td>
      <td class="num text-red">${fmtIntCell(c.unhealthy)}</td>
      <td class="num"><span class="badge-outline ${c.avgUtilizationPct >= 50 ? 'green' : (c.avgUtilizationPct >= 20 ? 'orange' : 'red')}">${fmtPctCell(c.avgUtilizationPct)}</span></td>
      <td class="num">${fmtIntCell(Math.round(c.lockedPieces))}</td>
      <td class="num text-red">${fmtIntCell(Math.round(c.idlePieces))}</td>
    </tr>`).join("");
}

function renderHealthyLockingMerchantTable() {
  const tbody = $("hlMerchantTableBody");
  if (!tbody) return;
  const rows = state.healthyLockingMerchantRows || [];
  const page = healthyLockingState.merchantPage || 0;
  const start = page * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = pageRows.map(m => `
    <tr>
      <td class="font-mono text-dim">${m.tagerId}</td>
      <td class="font-bold truncate-cell" title="${m.merchantName}">${m.merchantName}</td>
      <td class="num font-bold">${fmtIntCell(m.activeLocks)}</td>
      <td class="num text-green">${fmtIntCell(m.healthy)}</td>
      <td class="num text-orange">${fmtIntCell(m.risk)}</td>
      <td class="num text-red">${fmtIntCell(m.unhealthy)}</td>
      <td class="num"><span class="badge-outline ${m.avgUtilizationPct >= 50 ? 'green' : (m.avgUtilizationPct >= 20 ? 'orange' : 'red')}">${fmtPctCell(m.avgUtilizationPct)}</span></td>
      <td class="num">${fmtIntCell(Math.round(m.lockedPieces))}</td>
      <td class="num text-red">${fmtIntCell(Math.round(m.idlePieces))}</td>
    </tr>`).join("");
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if ($("rowCountHlMerchant")) $("rowCountHlMerchant").textContent = `${fmtInt.format(rows.length)} Merchants`;
  if ($("pageIndicatorHlMerchant")) $("pageIndicatorHlMerchant").textContent = `Page ${page + 1} of ${totalPages}`;
  if ($("prevPageHlMerchant")) $("prevPageHlMerchant").disabled = page === 0;
  if ($("nextPageHlMerchant")) $("nextPageHlMerchant").disabled = page >= totalPages - 1;
}

// Release Candidates: أعلى 10 قفلات Unhealthy (مفيهاش استخدام ولا ديماند)
// مرتبة بأكبر Remaining Pieces — دي أكبر كتلة استوك محبوسة من غير أي فايدة.
// مستبعد منها كاتيجوري "Taager Gomla" و"Fashion" بالذات.
//
// Renew Candidates: أي قفل (أي حالة صحية) قرب يخلص، سواء بتاريخ الانتهاء
// (≤7 أيام) أو بالكمية (Remaining Pieces قربت من الصفر نسبة للـ Allocated،
// أو رقم صغير جدًا) — مستبعد منها قفلات ميرشنت "admin-service". الترتيب
// مش بس CONTR% لوحدها: بنجمع بين أعلى CONTR% (الأهم تجاريًا) وأقل DOH
// (الأقرب يخلص) في score واحد (CONTR% ÷ DOH)، فاللي يطلع فوق هو اللي مهم
// تجاريًا *و* قرب يخلص مع بعض — مش بس مهم، ولا بس قرب يخلص لوحده.
const HL_RELEASE_EXCLUDED_CATEGORIES = ["taager gomla", "tager gomla", "fashion"];
const HL_RENEW_EXCLUDED_MERCHANTS = ["admin-service", "admin service", "adminservice"];
function renderHealthyLockingRecommendations() {
  const data = healthyLockingState.data || [];
  const releaseRows = data.filter(d => {
    if (d.healthKey !== "unhealthy" || !((d.remainingPieces || 0) > 0)) return false;
    const catNorm = (d.category || "").trim().toLowerCase();
    return !HL_RELEASE_EXCLUDED_CATEGORIES.some(ex => catNorm.includes(ex));
  }).sort((a, b) => (b.remainingPieces || 0) - (a.remainingPieces || 0)).slice(0, 10);

  const renewRows = data.filter(d => {
    const merchantNorm = (d.merchantName || "").trim().toLowerCase();
    if (HL_RENEW_EXCLUDED_MERCHANTS.some(ex => merchantNorm.includes(ex))) return false;
    const expiringSoon = d.daysToExpiry !== null && d.daysToExpiry !== undefined && d.daysToExpiry <= 7;
    const qtyRunningOut = (d.allocatedQty > 0 && (d.remainingPieces / d.allocatedQty) <= 0.15) || ((d.remainingPieces || 0) <= 5);
    return expiringSoon || qtyRunningOut;
  }).map(d => {
    const expiringSoon = d.daysToExpiry !== null && d.daysToExpiry !== undefined && d.daysToExpiry <= 7;
    const qtyRunningOut = (d.allocatedQty > 0 && (d.remainingPieces / d.allocatedQty) <= 0.15) || ((d.remainingPieces || 0) <= 5);
    const reason = expiringSoon && qtyRunningOut ? "Expiring & Low Qty" : expiringSoon ? "Expiring Soon" : "Low Quantity";
    // dohForScore: لو مفيش ديماند آخر 3 أيام خالص (DOH = null) بنحطها 30 يوم
    // بس لأغراض الترتيب (مش القيمة المعروضة) عشان ميتصدرش الترتيب غلط —
    // مش معناها إنها مستعجلة، معناها إننا مش عارفين نتوقع بالإيقاع الحالي.
    const dohForScore = (d.remainingDoh === null || d.remainingDoh === undefined) ? 30 : Math.max(1, d.remainingDoh);
    const renewScore = (d.contrGmvPct || 0) / dohForScore;
    return { ...d, reason, renewScore };
  }).sort((a, b) => b.renewScore - a.renewScore).slice(0, 15);

  const releaseTbody = $("hlReleaseTableBody");
  if (releaseTbody) {
    releaseTbody.innerHTML = releaseRows.length ? releaseRows.map(d => `
      <tr>
        <td class="font-mono text-dim">${d.singleId}</td>
        <td class="font-bold truncate-cell" title="${d.singleName}">${d.singleName}</td>
        <td class="text-dim">${d.category}</td>
        <td class="truncate-cell" title="${d.merchantName}">${d.merchantName}</td>
        <td class="num">${fmtIntCell(d.allocatedQty)}</td>
        <td class="num text-dim">${fmtIntCell(d.usedQty)}</td>
        <td class="num"><span class="badge-outline red">${fmtPctCell(d.utilizationPct)}</span></td>
        <td class="num text-red font-bold">${fmtIntCell(d.remainingPieces)}</td>
        <td class="num">${d.daysToExpiry === null || d.daysToExpiry === undefined ? "—" : d.daysToExpiry}</td>
      </tr>`).join("") : `<tr><td colspan="9" class="text-dim center">No idle locks found — everything's being used 🎉</td></tr>`;
  }

  const renewTbody = $("hlRenewTableBody");
  if (renewTbody) {
    renewTbody.innerHTML = renewRows.length ? renewRows.map(d => `
      <tr>
        <td class="font-mono text-dim">${d.singleId}</td>
        <td class="font-bold truncate-cell" title="${d.singleName}">${d.singleName}</td>
        <td class="text-dim">${d.category}</td>
        <td class="font-mono text-dim">${d.tagerId}</td>
        <td class="truncate-cell" title="${d.merchantName}">${d.merchantName}</td>
        <td class="num font-bold text-purple">${fmtPctCell(d.contrGmvPct)}</td>
        <td class="num text-orange font-bold">${fmtIntCell(d.remainingPieces)}</td>
        <td class="num text-dim">${fmtIntCell(d.allocatedQty)}</td>
        <td class="num">${fmtIntCell(Math.round(d.placedYdayMerchant))}</td>
        <td class="num">${d.remainingDoh === null ? "—" : `<span class="badge-outline ${d.remainingDoh <= 3 ? 'red' : (d.remainingDoh <= 7 ? 'orange' : 'green')}">${Math.round(d.remainingDoh)}d</span>`}</td>
        <td class="num">${d.daysToExpiry === null || d.daysToExpiry === undefined ? "—" : d.daysToExpiry}</td>
        <td class="num"><span class="badge-outline ${d.stock > 0 ? 'green' : 'red'}">${fmtIntCell(Math.round(d.stock))}</span></td>
        <td class="center"><span class="badge-outline ${d.reason === 'Low Quantity' ? 'red' : (d.reason === 'Expiring Soon' ? 'orange' : 'purple')}">${d.reason}</span></td>
      </tr>`).join("") : `<tr><td colspan="13" class="text-dim center">No locks about to end right now</td></tr>`;
  }
}

function sortHealthyLocking(key) {
  if (healthyLockingState.sortKey === key) { healthyLockingState.sortDir = healthyLockingState.sortDir === "asc" ? "desc" : "asc"; } else { healthyLockingState.sortKey = key; healthyLockingState.sortDir = "desc"; }
  applyHealthyLockingSearchAndSort();
}

function applyHealthyLockingSearchAndSort() {
  const term = $("searchHealthyLockingInput") ? $("searchHealthyLockingInput").value.trim().toLowerCase() : "";
  let data = (healthyLockingState.data || []).filter(d => {
    if (!term) return true;
    return (d.singleId && String(d.singleId).toLowerCase().includes(term)) || (d.singleName && d.singleName.toLowerCase().includes(term)) ||
      (d.merchantName && d.merchantName.toLowerCase().includes(term)) || (d.tagerId && String(d.tagerId).toLowerCase().includes(term)) ||
      (d.category && d.category.toLowerCase().includes(term)) || (d.lockingType && d.lockingType.toLowerCase().includes(term));
  });
  const { sortKey, sortDir } = healthyLockingState; const dir = sortDir === "asc" ? 1 : -1;
  data.sort((a, b) => { const av = a[sortKey]; const bv = b[sortKey]; if (typeof av === "string") return av.localeCompare(bv) * dir; return ((av || 0) - (bv || 0)) * dir; });
  healthyLockingState.filtered = data;
  healthyLockingState.page = 0;
  renderPaginatedHealthyLockingTable();
}

function renderPaginatedHealthyLockingTable() {
  const tbody = $("hlMatchesTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const data = healthyLockingState.filtered || [];
  const start = healthyLockingState.page * PAGE_SIZE;
  const pageRows = data.slice(start, start + PAGE_SIZE);
  pageRows.forEach(l => {
    const tr = document.createElement("tr");
    const typeCls = (l.lockingType || "").toLowerCase().includes("solo") ? "red" : "blue";
    tr.innerHTML = `
      <td class="font-mono text-dim">${l.singleId}</td>
      <td class="font-bold truncate-cell" title="${l.singleName}">${l.singleName}</td>
      <td class="text-dim">${l.category}</td>
      <td class="font-mono text-dim">${l.tagerId}</td>
      <td class="truncate-cell" title="${l.merchantName}">${l.merchantName}</td>
      <td class="center"><span class="badge-outline ${typeCls}">${l.lockingType}</span></td>
      <td class="num font-bold">${fmtIntCell(l.allocatedQty)}</td>
      <td class="num text-dim">${fmtIntCell(l.usedQty)}</td>
      <td class="num">${fmtPctCell(l.utilizationPct)}</td>
      <td class="num text-orange font-bold">${fmtIntCell(l.remainingPieces)}</td>
      <td class="num font-bold text-purple">${fmtIntCell(Math.round(l.placedYdayMerchant))}</td>
      <td class="num">${l.daysToExpiry === null || l.daysToExpiry === undefined ? "—" : l.daysToExpiry}</td>
      <td class="center"><span class="badge-outline ${l.healthCls}">${l.healthText}</span></td>
    `;
    tbody.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  if ($("rowCountHealthyLocking")) $("rowCountHealthyLocking").textContent = `${fmtInt.format(data.length)} Matches`;
  if ($("pageIndicatorHealthyLocking")) $("pageIndicatorHealthyLocking").textContent = `Page ${healthyLockingState.page + 1} of ${totalPages}`;
  if ($("prevPageHealthyLocking")) $("prevPageHealthyLocking").disabled = healthyLockingState.page === 0;
  if ($("nextPageHealthyLocking")) $("nextPageHealthyLocking").disabled = healthyLockingState.page >= totalPages - 1;
}

// =========================================================================
// SEGMENTATION PANEL ENGINE — نفس حسبة شيت "EGY" بالظبط (يوليو TARGET/
// Actuals/Achievement%)، لكن الـ Actual بيتقرا لايف من شيت
// "New segmentation #6864" (NEW_SEGMENTATION_GID) بدل ما يبقى نسخة مجمدة.
//
// كل صف من الصفوف اللي كانت في شيت EGY (من صف 3 لحد صف 118) اتحول هنا لكائن
// { target, actual, ach } بنفس المعادلة اللي كانت مكتوبة بالظبط في العمود
// بتاع يوليو، بما فيها التفاصيل الغريبة (زي إن بعض صفوف الـ Achievement% بتقلب
// القسمة Target/Actual بدل Actual/Target، أو بتبقى قيمة ثابتة مكتوبة يدوي).
//
// ملحوظتين عدّلتهم عمدًا (موضّحين في رسالة التسليم):
// 1) صف "Churned -" في قسم الـ HVM (وبس هو) كانت صيغته في الشيت الأصلي بتتأكد
//    من عمود الشهر (B) مقابل خلية العنوان النصية "Actuals" بدل تاريخ الشهر
//    الفعلي — ده بيرجّع صفر دايمًا. استخدمت هنا شهر يوليو الفعلي زي باقي
//    الصفوف المطابقة، عشان الرقم يبقى حقيقي.
// 2) 6 صفوف (Loyal +New/+Promoted وفروعها، Potential Loyal +Re-activated/+New)
//    كان فيها رقم Actual مكتوب يدوي بدل معادلة SUMIFS حية — استبدلتهم بنفس
//    نمط SUMIFS المستخدم في كل صف مشابه، عشان الداشبورد يفضل بيقرأ لايف.
// =========================================================================

function segSumBy(data, field, filters, monthDate) {
  const eq = (a, b) => (a || "").toString().trim().toLowerCase() === (b || "").toString().trim().toLowerCase();
  let total = 0;
  for (const row of (data || [])) {
    if (!eq(row.country, SEG_PANEL_COUNTRY)) continue;
    if (monthDate && (!row.month || row.month.getFullYear() !== monthDate.getFullYear() || row.month.getMonth() !== monthDate.getMonth())) continue;
    if (filters.subSegment && !eq(row.subSegment, filters.subSegment)) continue;
    if (filters.status && !eq(row.status, filters.status)) continue;
    if (filters.segment && !eq(row.segment, filters.segment)) continue;
    if (filters.finalStatus && !eq(row.finalStatus, filters.finalStatus)) continue;
    total += row[field] || 0;
  }
  return total;
}

function safeRatio(num, den) {
  if (!den) return null;
  return num / den;
}

const SEG_ROWS_BY_ID = {};
function segDefRow(cfg) { SEG_ROWS_BY_ID[cfg.id] = cfg; }

// ---- HVM / Champions ------------------------------------------------
segDefRow({ id: "r3", section: "HVM (Champions)", label: "Last month merchants", unit: "count", top: true,
  target: () => 16,
  actual: (ctx) => ctx.sum("count", { subSegment: "Champions" }, SEG_PANEL_PREV_MONTH),
  ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r4", section: "HVM (Champions)", label: "Churned -", unit: "count",
  target: () => 0,
  actual: (ctx) => ctx.sum("count", { status: "Churned from champions" }, SEG_PANEL_MONTH),
  ach: () => ({ kind: "literal", ratio: 1 }) });
segDefRow({ id: "r5", section: "HVM (Champions)", label: "Demoted -", unit: "count",
  target: (ctx) => ctx.T("r6") + ctx.T("r7") + ctx.T("r8"),
  actual: (ctx) => ctx.A("r6") + ctx.A("r7") + ctx.A("r8"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.T("r5"), ctx.A("r5")) }) });
segDefRow({ id: "r6", section: "HVM (Champions)", label: "Demoted to loyal MVM", unit: "count", sub: true,
  target: () => 1, actual: (ctx) => ctx.sum("count", { status: "Demoted from champions to loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r7", section: "HVM (Champions)", label: "Demoted to potential loyal MVM", unit: "count", sub: true,
  target: () => 0, actual: (ctx) => ctx.sum("count", { status: "Demoted from champions to potential loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r8", section: "HVM (Champions)", label: "Demoted to LVM", unit: "count", sub: true,
  target: () => 0, actual: (ctx) => ctx.sum("count", { status: "Demoted from champions to LVM" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r9", section: "HVM (Champions)", label: "Retained", unit: "count",
  target: () => 15, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r9"), ctx.T("r9")) }) });
segDefRow({ id: "r10", section: "HVM (Champions)", label: "Re-activated +", unit: "count",
  target: () => 1, actual: (ctx) => ctx.sum("count", { status: "Re-activated", subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r10"), ctx.T("r10")) }) });
segDefRow({ id: "r11", section: "HVM (Champions)", label: "New +", unit: "count",
  target: () => 1, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r11"), ctx.T("r11")) }) });
segDefRow({ id: "r12", section: "HVM (Champions)", label: "Promoted +", unit: "count",
  target: (ctx) => ctx.T("r13") + ctx.T("r14") + ctx.T("r15"),
  actual: (ctx) => ctx.A("r13") + ctx.A("r14") + ctx.A("r15"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r12"), ctx.T("r12")) }) });
segDefRow({ id: "r13", section: "HVM (Champions)", label: "Promoted from loyal MVM", unit: "count", sub: true,
  target: () => 6, actual: (ctx) => ctx.sum("count", { status: "promoted from loyals to champions" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r14", section: "HVM (Champions)", label: "Promoted from potential loyal MVM", unit: "count", sub: true,
  target: () => 0, actual: (ctx) => ctx.sum("count", { status: "promoted from potential loyals to champions" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r15", section: "HVM (Champions)", label: "Promoted from LVM", unit: "count", sub: true,
  target: () => 0, actual: (ctx) => ctx.sum("count", { status: "promoted from LVM to Champions" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r16", section: "HVM (Champions)", label: "Total merchants", unit: "count", top: true,
  target: (ctx) => ctx.T("r3") + ctx.T("r10") + ctx.T("r11") + ctx.T("r12") - ctx.T("r4") - ctx.T("r5"),
  actual: (ctx) => ctx.sum("count", { subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r16"), ctx.T("r16")) }) });
segDefRow({ id: "r18", section: "HVM (Champions)", label: "Total confirmed orders", unit: "count",
  target: (ctx) => ctx.T("r19") * ctx.T("r16"), actual: (ctx) => ctx.sum("orders", { subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r18"), ctx.T("r18")) }) });
segDefRow({ id: "r19", section: "HVM (Champions)", label: "Confirmed orders per merchant", unit: "count",
  target: () => 3600, actual: (ctx) => safeRatio(ctx.A("r18"), ctx.A("r16")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r19"), ctx.T("r19")) }) });
segDefRow({ id: "r20", section: "HVM (Champions)", label: "Confirmed GMV", unit: "money",
  target: (ctx) => ctx.T("r18") * ctx.T("r21"), actual: (ctx) => ctx.sum("cnfGmv", { subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r20"), ctx.T("r20")) }) });
segDefRow({ id: "r21", section: "HVM (Champions)", label: "Confirmed AOV", unit: "money",
  target: () => 1020, actual: (ctx) => safeRatio(ctx.A("r20"), ctx.A("r18")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r21"), ctx.T("r21")) }) });
segDefRow({ id: "r22", section: "HVM (Champions)", label: "Total Delivered orders", unit: "count",
  target: (ctx) => ctx.T("r18") * ctx.T("r23"), actual: (ctx) => ctx.sum("dlvOrders", { subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r22"), ctx.T("r22")) }) });
segDefRow({ id: "r23", section: "HVM (Champions)", label: "DR%", unit: "percent",
  target: () => 0.5, actual: (ctx) => safeRatio(ctx.A("r22"), ctx.A("r18")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r23"), ctx.T("r23")) }) });
segDefRow({ id: "r24", section: "HVM (Champions)", label: "Delivered GMV", unit: "money",
  target: (ctx) => ctx.T("r22") * ctx.T("r25"), actual: (ctx) => ctx.sum("dlvGmv", { subSegment: "Champions" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r24"), ctx.T("r24")) }) });
segDefRow({ id: "r25", section: "HVM (Champions)", label: "Delivered AOV", unit: "money",
  target: () => 995, actual: (ctx) => safeRatio(ctx.A("r24"), ctx.A("r22")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r25"), ctx.T("r25")) }) });

// ---- Loyal MVM --------------------------------------------------------
segDefRow({ id: "r28", section: "Loyal MVM", label: "Last month merchants", unit: "count", top: true,
  target: (ctx) => ctx.A("r41", SEG_PANEL_PREV_MONTH), actual: (ctx) => ctx.sum("count", { subSegment: "Loyal" }, SEG_PANEL_PREV_MONTH),
  ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r29", section: "Loyal MVM", label: "Churned -", unit: "count",
  target: () => 0, actual: (ctx) => ctx.sum("count", { status: "Churned from loyals" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.T("r29"), ctx.A("r29")) }) });
segDefRow({ id: "r30", section: "Loyal MVM", label: "Demoted -", unit: "count",
  target: (ctx) => ctx.T("r31") + ctx.T("r32") + ctx.T("r33"), actual: (ctx) => ctx.A("r31") + ctx.A("r32"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.T("r30"), ctx.A("r30")) }) });
segDefRow({ id: "r31", section: "Loyal MVM", label: "Demoted to potential loyal MVM", unit: "count", sub: true,
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Demoted from loyals to potential loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r32", section: "Loyal MVM", label: "Demoted to LVM", unit: "count", sub: true,
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Demoted from loyals to LVM" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r33", section: "Loyal MVM", label: "Promoted to Champions -", unit: "count",
  target: () => 6, actual: (ctx) => ctx.A("r13"), ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r33"), ctx.T("r33")) }) });
segDefRow({ id: "r34", section: "Loyal MVM", label: "Retained", unit: "count",
  target: () => 13, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r34"), ctx.T("r34")) }) });
segDefRow({ id: "r35", section: "Loyal MVM", label: "Demoted from Champions +", unit: "count",
  target: () => 1, actual: (ctx) => ctx.A("r6"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r36", section: "Loyal MVM", label: "Re-activated +", unit: "count",
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Re-activated", subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r36"), ctx.T("r36")) }) });
segDefRow({ id: "r37", section: "Loyal MVM", label: "New +", unit: "count",
  target: () => 6, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r37"), ctx.T("r37")) }) });
segDefRow({ id: "r38", section: "Loyal MVM", label: "Promoted +", unit: "count",
  target: (ctx) => ctx.T("r39") + ctx.T("r40"), actual: (ctx) => ctx.A("r39") + ctx.A("r40"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r38"), ctx.T("r38")) }) });
segDefRow({ id: "r39", section: "Loyal MVM", label: "Promoted from potential loyal MVM", unit: "count", sub: true,
  target: () => 1, actual: (ctx) => ctx.sum("count", { status: "promoted from potential loyals to loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r40", section: "Loyal MVM", label: "Promoted from LVM", unit: "count", sub: true,
  target: () => 0, actual: (ctx) => ctx.sum("count", { status: "promoted from LVM to loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r41", section: "Loyal MVM", label: "Total merchants", unit: "count", top: true,
  target: (ctx) => ctx.T("r28") + ctx.T("r35") + ctx.T("r36") + ctx.T("r37") + ctx.T("r38") - ctx.T("r29") - ctx.T("r30") - ctx.T("r33"),
  actual: (ctx, m) => ctx.sum("count", { subSegment: "Loyal" }, m || SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r41"), ctx.T("r41")) }) });
segDefRow({ id: "r43", section: "Loyal MVM", label: "Total confirmed orders", unit: "count",
  target: (ctx) => ctx.T("r41") * 606, actual: (ctx) => ctx.sum("orders", { subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r43"), ctx.T("r43")) }) });
segDefRow({ id: "r44", section: "Loyal MVM", label: "Confirmed orders per merchant", unit: "count",
  target: () => 636.41, actual: (ctx) => safeRatio(ctx.A("r43"), ctx.A("r41")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r44"), ctx.T("r44")) }) });
segDefRow({ id: "r45", section: "Loyal MVM", label: "Confirmed GMV", unit: "money",
  target: (ctx) => ctx.T("r43") * ctx.T("r46"), actual: (ctx) => ctx.sum("cnfGmv", { subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r45"), ctx.T("r45")) }) });
segDefRow({ id: "r46", section: "Loyal MVM", label: "Confirmed AOV", unit: "money",
  target: () => 867.10, actual: (ctx) => safeRatio(ctx.A("r45"), ctx.A("r43")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r46"), ctx.T("r46")) }) });
segDefRow({ id: "r47", section: "Loyal MVM", label: "Total Delivered orders", unit: "count",
  target: (ctx) => ctx.T("r43") * ctx.T("r48"), actual: (ctx) => ctx.sum("dlvOrders", { subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r47"), ctx.T("r47")) }) });
segDefRow({ id: "r48", section: "Loyal MVM", label: "DR%", unit: "percent",
  target: () => 0.5, actual: (ctx) => safeRatio(ctx.A("r47"), ctx.A("r43")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r48"), ctx.T("r48")) }) });
segDefRow({ id: "r49", section: "Loyal MVM", label: "Delivered GMV", unit: "money",
  target: (ctx) => ctx.T("r47") * ctx.T("r50"), actual: (ctx) => ctx.sum("dlvGmv", { subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r49"), ctx.T("r49")) }) });
segDefRow({ id: "r50", section: "Loyal MVM", label: "Delivered AOV", unit: "money",
  target: () => 830, actual: (ctx) => safeRatio(ctx.A("r49"), ctx.A("r47")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r50"), ctx.T("r50")) }) });

// ---- Potential Loyal MVM ------------------------------------------------
segDefRow({ id: "r53", section: "Potential Loyal MVM", label: "Last month merchants", unit: "count", top: true,
  target: (ctx) => ctx.A("r66", SEG_PANEL_PREV_MONTH), actual: (ctx) => ctx.sum("count", { subSegment: "Potential Loyal" }, SEG_PANEL_PREV_MONTH),
  ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r54", section: "Potential Loyal MVM", label: "Churned -", unit: "count",
  target: () => 1, actual: (ctx) => ctx.sum("count", { status: "Churned from potential loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 1 }) });
segDefRow({ id: "r55", section: "Potential Loyal MVM", label: "Demoted -", unit: "count",
  target: () => 3, actual: (ctx) => ctx.sum("count", { status: "Demoted from potential loyals to LVM" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 0 }) });
segDefRow({ id: "r56", section: "Potential Loyal MVM", label: "Promoted to higher segments -", unit: "count",
  target: (ctx) => ctx.T("r57") + ctx.T("r58"), actual: (ctx) => ctx.A("r57") + ctx.A("r58"), ach: () => ({ kind: "literal", ratio: 0 }) });
segDefRow({ id: "r57", section: "Potential Loyal MVM", label: "Promoted to Champions", unit: "count", sub: true,
  target: () => 0, actual: (ctx) => ctx.A("r14"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r58", section: "Potential Loyal MVM", label: "Promoted to Loyal MVM", unit: "count", sub: true,
  target: () => 6, actual: (ctx) => ctx.A("r39"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r59", section: "Potential Loyal MVM", label: "Retained", unit: "count",
  target: () => 5, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Potential Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r59"), ctx.T("r59")) }) });
segDefRow({ id: "r60", section: "Potential Loyal MVM", label: "Demoted from higher segments +", unit: "count",
  target: () => 3, actual: (ctx) => ctx.A("r61") + ctx.A("r62"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r61", section: "Potential Loyal MVM", label: "Demoted from Champions", unit: "count", sub: true,
  target: (ctx) => ctx.T("r7"), actual: (ctx) => ctx.A("r7"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r62", section: "Potential Loyal MVM", label: "Demoted from Loyal MVM", unit: "count", sub: true,
  target: (ctx) => ctx.T("r31"), actual: (ctx) => ctx.A("r31"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r63", section: "Potential Loyal MVM", label: "Re-activated +", unit: "count",
  target: () => 3, actual: (ctx) => ctx.sum("count", { status: "Re-activated", subSegment: "Potential Loyal" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 0 }) });
segDefRow({ id: "r64", section: "Potential Loyal MVM", label: "New +", unit: "count",
  target: () => 1, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Potential Loyal" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 1 }) });
segDefRow({ id: "r65", section: "Potential Loyal MVM", label: "Promoted +", unit: "count",
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "promoted from LVM to potential loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 0 }) });
segDefRow({ id: "r66", section: "Potential Loyal MVM", label: "Total merchants", unit: "count", top: true,
  target: (ctx) => ctx.T("r53") + ctx.T("r60") + ctx.T("r63") + ctx.T("r64") + ctx.T("r65") - ctx.T("r54") - ctx.T("r55") - ctx.T("r56"),
  actual: (ctx, m) => ctx.sum("count", { subSegment: "Potential Loyal" }, m || SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r66"), ctx.T("r66")) }) });
segDefRow({ id: "r68", section: "Potential Loyal MVM", label: "Total confirmed orders", unit: "count",
  target: (ctx) => ctx.T("r69") * ctx.T("r66"), actual: (ctx) => ctx.sum("orders", { subSegment: "Potential Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r68"), ctx.T("r68")) }) });
segDefRow({ id: "r69", section: "Potential Loyal MVM", label: "Confirmed orders per merchant", unit: "count",
  target: () => 227.29, actual: (ctx) => safeRatio(ctx.A("r68"), ctx.A("r66")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r69"), ctx.T("r69")) }) });
segDefRow({ id: "r70", section: "Potential Loyal MVM", label: "Confirmed GMV", unit: "money",
  target: (ctx) => ctx.T("r68") * ctx.A("r71", SEG_PANEL_PREV_MONTH), actual: (ctx) => ctx.sum("cnfGmv", { subSegment: "Potential Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r70"), ctx.T("r70")) }) });
segDefRow({ id: "r71", section: "Potential Loyal MVM", label: "Confirmed AOV", unit: "money",
  target: (ctx) => safeRatio(ctx.T("r70"), ctx.T("r68")) || 0, actual: (ctx, m) => safeRatio(ctx.A("r70", m), ctx.A("r68", m)) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r71"), ctx.T("r71")) }) });
segDefRow({ id: "r72", section: "Potential Loyal MVM", label: "Total Delivered orders", unit: "count",
  target: (ctx) => ctx.T("r68") * ctx.T("r73"), actual: (ctx) => ctx.sum("dlvOrders", { subSegment: "Potential Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r72"), ctx.T("r72")) }) });
segDefRow({ id: "r73", section: "Potential Loyal MVM", label: "DR%", unit: "percent",
  target: () => 0.45, actual: (ctx) => safeRatio(ctx.A("r72"), ctx.A("r68")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r73"), ctx.T("r73")) }) });
segDefRow({ id: "r74", section: "Potential Loyal MVM", label: "Delivered GMV", unit: "money",
  target: (ctx) => ctx.T("r72") * ctx.T("r75"), actual: (ctx) => ctx.sum("dlvGmv", { subSegment: "Potential Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r74"), ctx.T("r74")) }) });
segDefRow({ id: "r75", section: "Potential Loyal MVM", label: "Delivered AOV", unit: "money",
  target: () => 1036, actual: (ctx) => safeRatio(ctx.A("r74"), ctx.A("r72")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r75"), ctx.T("r75")) }) });

// ---- LVM (Low Value / Occasional / Promising) --------------------------
// كل صفوف الـ % هنا (ما عدا الصفوف اللي بتجمّع صفوف تانية) بتتقسم على رقم
// ثابت واحد (Total merchants بتاع شهر أبريل) — بالظبط زي خلية $I$78 في شيت
// الإكسيل الأصلي (مرجع ثابت مش بيتغير مع الشهر).
segDefRow({ id: "r78", section: "LVM", label: "Last month merchants", unit: "count", top: true,
  target: () => 521, actual: (ctx) => ctx.A("r79") + ctx.A("r80") + ctx.A("r81"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r79", section: "LVM", label: "LVM (Low Value)", unit: "count", sub: true,
  target: () => 291, actual: (ctx) => ctx.sum("count", { subSegment: "Low Value" }, SEG_PANEL_PREV_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r79"), ctx.lvmBase()) }) });
segDefRow({ id: "r80", section: "LVM", label: "Occasional", unit: "count", sub: true,
  target: () => 77, actual: (ctx) => ctx.sum("count", { subSegment: "Occasional" }, SEG_PANEL_PREV_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r80"), ctx.lvmBase()) }) });
segDefRow({ id: "r81", section: "LVM", label: "Promising", unit: "count", sub: true,
  target: () => 17, actual: (ctx) => ctx.sum("count", { subSegment: "Promising" }, SEG_PANEL_PREV_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r81"), ctx.lvmBase()) }) });
segDefRow({ id: "r82", section: "LVM", label: "Churned", unit: "count",
  target: () => 227, actual: (ctx) => ctx.sum("count", { status: "Churned from LVM" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.T("r82"), ctx.A("r82")) }) });
segDefRow({ id: "r83", section: "LVM", label: "Retained", unit: "count",
  target: (ctx) => ctx.T("r84") + ctx.T("r85") + ctx.T("r86") + ctx.T("r87") + ctx.T("r88"),
  actual: (ctx) => ctx.A("r84") + ctx.A("r85") + ctx.A("r86") + ctx.A("r87") + ctx.A("r88"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r83"), ctx.T("r83")) }) });
segDefRow({ id: "r84", section: "LVM", label: "Low value", unit: "count", sub: true,
  target: () => 55, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Low Value" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r84"), ctx.lvmBase()) }) });
segDefRow({ id: "r85", section: "LVM", label: "Occasional", unit: "count", sub: true,
  target: () => 22, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Occasional" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r85"), ctx.lvmBase()) }) });
segDefRow({ id: "r86", section: "LVM", label: "Promising", unit: "count", sub: true,
  target: () => 10, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Promising" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r86"), ctx.lvmBase()) }) });
segDefRow({ id: "r87", section: "LVM", label: "Promoted", unit: "count", sub: true,
  target: () => 16, actual: (ctx) => ctx.sum("count", { segment: "LVM", finalStatus: "Promoted" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r87"), ctx.lvmBase()) }) });
segDefRow({ id: "r88", section: "LVM", label: "demoted", unit: "count", sub: true,
  target: () => 41, actual: (ctx) => ctx.sum("count", { segment: "LVM", finalStatus: "Demoted" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r88"), ctx.lvmBase()) }) });
segDefRow({ id: "r89", section: "LVM", label: "Re-activated", unit: "count",
  target: (ctx) => ctx.T("r90") + ctx.T("r91") + ctx.T("r92"), actual: (ctx) => ctx.A("r90") + ctx.A("r91") + ctx.A("r92"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r89"), ctx.T("r89")) }) });
segDefRow({ id: "r90", section: "LVM", label: "Low value", unit: "count", sub: true,
  target: () => 99, actual: (ctx) => ctx.sum("count", { status: "Re-activated", subSegment: "Low Value" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r90"), ctx.lvmBase()) }) });
segDefRow({ id: "r91", section: "LVM", label: "Occasional", unit: "count", sub: true,
  target: () => 15, actual: (ctx) => ctx.sum("count", { status: "Re-activated", subSegment: "Occasional" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r91"), ctx.lvmBase()) }) });
segDefRow({ id: "r92", section: "LVM", label: "Promising", unit: "count", sub: true,
  target: () => 10, actual: (ctx) => ctx.sum("count", { status: "Re-activated", subSegment: "Promising" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r92"), ctx.lvmBase()) }) });
segDefRow({ id: "r93", section: "LVM", label: "New", unit: "count",
  target: (ctx) => ctx.T("r94") + ctx.T("r95") + ctx.T("r96"), actual: (ctx) => ctx.A("r94") + ctx.A("r95") + ctx.A("r96"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r93"), ctx.T("r93")) }) });
segDefRow({ id: "r94", section: "LVM", label: "Low value", unit: "count", sub: true,
  target: () => 200, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Low Value" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r94"), ctx.lvmBase()) }) });
segDefRow({ id: "r95", section: "LVM", label: "Occasional", unit: "count", sub: true,
  target: () => 20, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Occasional" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r95"), ctx.lvmBase()) }) });
segDefRow({ id: "r96", section: "LVM", label: "Promising", unit: "count", sub: true,
  target: () => 7, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Promising" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r96"), ctx.lvmBase()) }) });
segDefRow({ id: "r97", section: "LVM", label: "Total merchants", unit: "count", top: true,
  target: (ctx) => ctx.T("r98") + ctx.T("r99") + ctx.T("r100"),
  actual: (ctx, m) => ctx.A("r98", m) + ctx.A("r99", m) + ctx.A("r100", m),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r97"), ctx.T("r97")) }) });
segDefRow({ id: "r98", section: "LVM", label: "Low value", unit: "count", sub: true,
  target: () => 343, actual: (ctx, m) => ctx.sum("count", { subSegment: "Low Value" }, m || SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r98"), ctx.lvmBase()) }) });
segDefRow({ id: "r99", section: "LVM", label: "Occasional", unit: "count", sub: true,
  target: () => 61, actual: (ctx, m) => ctx.sum("count", { subSegment: "Occasional" }, m || SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r99"), ctx.lvmBase()) }) });
segDefRow({ id: "r100", section: "LVM", label: "Promising", unit: "count", sub: true,
  target: () => 20, actual: (ctx, m) => ctx.sum("count", { subSegment: "Promising" }, m || SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r100"), ctx.lvmBase()) }) });
segDefRow({ id: "r102", section: "LVM", label: "Total confirmed orders", unit: "count",
  target: (ctx) => ctx.T("r103") * ctx.T("r97"), actual: (ctx) => ctx.sum("orders", { segment: "LVM" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r102"), ctx.T("r102")) }) });
segDefRow({ id: "r103", section: "LVM", label: "Confirmed orders per merchant", unit: "count",
  target: () => 10, actual: (ctx) => safeRatio(ctx.A("r102"), ctx.A("r97")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r103"), ctx.T("r103")) }) });
segDefRow({ id: "r104", section: "LVM", label: "Confirmed GMV", unit: "money",
  target: (ctx) => ctx.T("r102") * ctx.A("r105", SEG_PANEL_PREV_MONTH), actual: (ctx) => ctx.sum("cnfGmv", { segment: "LVM" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r104"), ctx.T("r104")) }) });
segDefRow({ id: "r105", section: "LVM", label: "Confirmed AOV", unit: "money",
  target: (ctx) => safeRatio(ctx.T("r104"), ctx.T("r102")) || 0, actual: (ctx, m) => safeRatio(ctx.A("r104", m), ctx.A("r102", m)) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r105"), ctx.T("r105")) }) });
segDefRow({ id: "r106", section: "LVM", label: "Total Delivered orders", unit: "count",
  target: (ctx) => ctx.T("r102") * ctx.T("r107"), actual: (ctx) => ctx.sum("dlvOrders", { segment: "LVM" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r106"), ctx.T("r106")) }) });
segDefRow({ id: "r107", section: "LVM", label: "DR%", unit: "percent",
  target: () => 0.48, actual: (ctx) => safeRatio(ctx.A("r106"), ctx.A("r102")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r107"), ctx.T("r107")) }) });
segDefRow({ id: "r108", section: "LVM", label: "Delivered GMV", unit: "money",
  target: (ctx) => ctx.T("r106") * ctx.A("r109", SEG_PANEL_PREV_MONTH), actual: (ctx) => ctx.sum("dlvGmv", { segment: "LVM" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r108"), ctx.T("r108")) }) });
segDefRow({ id: "r109", section: "LVM", label: "Delivered AOV", unit: "money",
  target: (ctx) => safeRatio(ctx.T("r108"), ctx.T("r106")) || 0, actual: (ctx, m) => safeRatio(ctx.A("r108", m), ctx.A("r106", m)) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r109"), ctx.T("r109")) }) });

// ---- Total (كل الشرائح مع بعض) -----------------------------------------
segDefRow({ id: "r113", section: "Total", label: "Total merchants", unit: "count", top: true,
  target: (ctx) => ctx.T("r16") + ctx.T("r41") + ctx.T("r66") + ctx.T("r97"),
  actual: (ctx) => ctx.A("r16") + ctx.A("r41") + ctx.A("r66") + ctx.A("r97"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r113"), ctx.T("r113")) }) });
segDefRow({ id: "r114", section: "Total", label: "Total confirmed orders", unit: "count",
  target: (ctx) => ctx.T("r18") + ctx.T("r43") + ctx.T("r68") + ctx.T("r102"),
  actual: (ctx) => ctx.A("r18") + ctx.A("r43") + ctx.A("r68") + ctx.A("r102"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r114"), ctx.T("r114")) }) });
segDefRow({ id: "r115", section: "Total", label: "Total confirmed GMV", unit: "money",
  target: (ctx) => ctx.T("r20") + ctx.T("r45") + ctx.T("r70") + ctx.T("r104"),
  actual: (ctx) => ctx.A("r20") + ctx.A("r45") + ctx.A("r70") + ctx.A("r104"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r115"), ctx.T("r115")) }) });
segDefRow({ id: "r116", section: "Total", label: "Confirmed AOV", unit: "money",
  target: (ctx) => safeRatio(ctx.T("r115"), ctx.T("r114")) || 0, actual: (ctx) => safeRatio(ctx.A("r115"), ctx.A("r114")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r116"), ctx.T("r116")) }) });
segDefRow({ id: "r117", section: "Total", label: "Total delivered orders", unit: "count",
  target: (ctx) => ctx.T("r22") + ctx.T("r47") + ctx.T("r72") + ctx.T("r106"),
  actual: (ctx) => ctx.A("r22") + ctx.A("r47") + ctx.A("r72") + ctx.A("r106"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r117"), ctx.T("r117")) }) });
segDefRow({ id: "r118", section: "Total", label: "Total delivered GMV", unit: "money",
  target: (ctx) => ctx.T("r24") + ctx.T("r49") + ctx.T("r74") + ctx.T("r108"),
  actual: (ctx) => ctx.A("r24") + ctx.A("r49") + ctx.A("r74") + ctx.A("r108"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r118"), ctx.T("r118")) }) });

const SEG_ROW_ORDER = ["r3","r4","r5","r6","r7","r8","r9","r10","r11","r12","r13","r14","r15","r16",
  "r18","r19","r20","r21","r22","r23","r24","r25",
  "r28","r29","r30","r31","r32","r33","r34","r35","r36","r37","r38","r39","r40","r41",
  "r43","r44","r45","r46","r47","r48","r49","r50",
  "r53","r54","r55","r56","r57","r58","r59","r60","r61","r62","r63","r64","r65","r66",
  "r68","r69","r70","r71","r72","r73","r74","r75",
  "r78","r79","r80","r81","r82","r83","r84","r85","r86","r87","r88","r89","r90","r91","r92","r93","r94","r95","r96","r97",
  "r102","r103","r104","r105","r106","r107","r108","r109",
  "r113","r114","r115","r116","r117","r118"];

function buildSegCtx() {
  const data = state.newSegRows || [];
  const targetCache = {};
  const actualCache = {};
  const monthKey = (m) => (m ? `${m.getFullYear()}-${m.getMonth()}` : "x");
  let lvmBaseCache = null;

  const ctx = {
    sum: (field, filters, monthDate) => segSumBy(data, field, filters, monthDate),
    T(id) {
      if (targetCache[id] !== undefined) return targetCache[id];
      targetCache[id] = 0; // guard against accidental self-reference loops
      const val = SEG_ROWS_BY_ID[id].target(ctx) || 0;
      targetCache[id] = val;
      return val;
    },
    A(id, monthDate) {
      const md = monthDate || SEG_PANEL_MONTH;
      const key = id + "|" + monthKey(md);
      if (actualCache[key] !== undefined) return actualCache[key];
      actualCache[key] = 0;
      const val = SEG_ROWS_BY_ID[id].actual(ctx, md) || 0;
      actualCache[key] = val;
      return val;
    },
    // مرجع ثابت (زي خلية $I$78 في شيت الإكسيل): إجمالي ميرشانتس الـ LVM
    // بتاع شهر أبريل 2026 — بيستخدم كقاسم لكل نسب الـ % في قسم LVM.
    lvmBase() {
      if (lvmBaseCache !== null) return lvmBaseCache;
      lvmBaseCache = ctx.A("r97", SEG_PANEL_APRIL_REF);
      return lvmBaseCache;
    }
  };
  return ctx;
}

function computeSegmentationPerformance() {
  const ctx = buildSegCtx();
  const results = [];
  SEG_ROW_ORDER.forEach((id) => {
    const row = SEG_ROWS_BY_ID[id];
    const target = ctx.T(id);
    const actual = ctx.A(id);
    const ach = row.ach(ctx);
    results.push({ id, section: row.section, label: row.label, unit: row.unit, top: !!row.top, sub: !!row.sub, target, actual, ach });
  });
  return results;
}

// All GIDs the dashboard needs, deduped/filtered — sent as one query string
// to the backend endpoint so it can read all of them in a single request.
const ALL_SHEET_GIDS = [
  MAIN_GID,
  TARGETS_GID && TARGETS_GID !== " " ? TARGETS_GID : null,
  SEGMENTATION_GID,
  TARGETS_ACM_GID && TARGETS_ACM_GID !== " _Targets_ACM_ " ? TARGETS_ACM_GID : null,
  INVENTORY_GID, PRODUCTS_GID, CAT_TARGETS_GID, ACM_SALES_PLAN_GID,
  NEW_SEGMENTATION_GID, INBOUND_GID,
  PRODUCTS_INFO_GID, BEGIN_INV_GID, SELLTHROUGH_NEEDED_GID,
  PRODUCTS_DEBUNDLE_MAP_GID, SINGLE_SKU_TARGETS_GID, COGS_GID, AVAILABILITY_LOCKING_GID,
  PRODUCTS_MATCHES_GID, MERCHANT_SKU_DAILY_GID
].filter(Boolean);

// Single round trip to the Apps Script backend (backend/Code.gs doGet).
// Returns { [gid]: {table:{rows}} | null }, same shape loadSheetViaJsonp
// used to resolve with, so parse*Sheet() below needs no changes.
async function fetchAllSheetsViaBackend() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_API_TIMEOUT_MS);
  try {
    const url = `${DATA_API_URL}?action=getData&gids=${ALL_SHEET_GIDS.join(",")}`;
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Backend getData failed");
    return json.sheets;
  } finally {
    clearTimeout(timer);
  }
}

// Human-readable names for the sync-status banner when a specific sheet
// fails to refresh (so "didn't update" is visible instead of silent).
const GID_LABELS = {
  [MAIN_GID]: "Main", [TARGETS_GID]: "Targets", [SEGMENTATION_GID]: "Segmentation",
  [TARGETS_ACM_GID]: "Targets ACM", [INVENTORY_GID]: "Inventory", [PRODUCTS_GID]: "Products",
  [CAT_TARGETS_GID]: "Category Targets", [ACM_SALES_PLAN_GID]: "Sales Plan-ACM",
  [NEW_SEGMENTATION_GID]: "New Segmentation",
  [INBOUND_GID]: "Inbound", [PRODUCTS_INFO_GID]: "Products Info",
  [BEGIN_INV_GID]: "Beginning Inventory", [SELLTHROUGH_NEEDED_GID]: "Sell-through Needed",
  [PRODUCTS_DEBUNDLE_MAP_GID]: "Products Debundle Map", [SINGLE_SKU_TARGETS_GID]: "Single SKU Targets",
  [COGS_GID]: "COGS", [AVAILABILITY_LOCKING_GID]: "Availability Locking",
  [PRODUCTS_MATCHES_GID]: "Products & Matches (Recommended Tracker)"
};

// Fetches all sheets and returns a plain snapshot object — does NOT touch
// global state, so it is safe to call in the background while old data is
// still on screen.
async function fetchAllSheetsSnapshot() {
  let newSegLoadError = null;
  let sheets;
  const staleGids = []; // GIDs that failed every attempt and fell back to old data

  if (DATA_API_URL) {
    // Preferred path: ONE request, read server-side via SpreadsheetApp —
    // no gviz, no rate limiting.
    sheets = await fetchAllSheetsViaBackend();
  } else {
    // Fallback: old per-sheet JSONP path (kept only so the app still works
    // if the backend endpoint hasn't been deployed/configured yet — this is
    // the path that was producing the "Timeout on GID: ..." errors).
    // Every optional sheet now records itself into staleGids on failure —
    // previously these failures were swallowed silently and the sync
    // status just said "Live — updated", hiding which sheet was actually
    // still stale.
    const track = (gid) => () => { staleGids.push(gid); return null; };
    const [
      mainPayload, targetsPayload, segPayload, acmTargetsPayload,
      invPayload, prodPayload, catTargetsPayload, planPayload,
      newSegPayload, inboundPayload,
      prodInfoPayload, begInvPayload, sellthroughNeededPayload,
      debundleMapPayload, singleSkuTargetsPayload, cogsPayload, availabilityLockingPayload,
      productsMatchesPayload, merchantSkuDailyPayload
    ] = await Promise.all([
      loadSheetWithRetry(MAIN_GID),
      TARGETS_GID && TARGETS_GID !== " " ? loadSheetWithRetry(TARGETS_GID).catch(track(TARGETS_GID)) : Promise.resolve(null),
      SEGMENTATION_GID ? loadSheetWithRetry(SEGMENTATION_GID).catch(track(SEGMENTATION_GID)) : Promise.resolve(null),
      TARGETS_ACM_GID && TARGETS_ACM_GID !== " _Targets_ACM_ " ? loadSheetWithRetry(TARGETS_ACM_GID).catch(track(TARGETS_ACM_GID)) : Promise.resolve(null),
      INVENTORY_GID ? loadSheetWithRetry(INVENTORY_GID).catch(track(INVENTORY_GID)) : Promise.resolve(null),
      PRODUCTS_GID ? loadSheetWithRetry(PRODUCTS_GID).catch(track(PRODUCTS_GID)) : Promise.resolve(null),
      CAT_TARGETS_GID ? loadSheetWithRetry(CAT_TARGETS_GID).catch(track(CAT_TARGETS_GID)) : Promise.resolve(null),
      ACM_SALES_PLAN_GID ? loadSheetWithRetry(ACM_SALES_PLAN_GID).catch(track(ACM_SALES_PLAN_GID)) : Promise.resolve(null),
      NEW_SEGMENTATION_GID ? loadSheetWithRetry(NEW_SEGMENTATION_GID).catch((err) => { newSegLoadError = err.message || String(err); staleGids.push(NEW_SEGMENTATION_GID); return null; }) : Promise.resolve(null),
      INBOUND_GID ? loadSheetWithRetry(INBOUND_GID).catch(track(INBOUND_GID)) : Promise.resolve(null),
      loadSheetWithRetry(PRODUCTS_INFO_GID).catch(track(PRODUCTS_INFO_GID)),
      loadSheetWithRetry(BEGIN_INV_GID).catch(track(BEGIN_INV_GID)),
      loadSheetWithRetry(SELLTHROUGH_NEEDED_GID).catch(track(SELLTHROUGH_NEEDED_GID)),
      PRODUCTS_DEBUNDLE_MAP_GID ? loadSheetWithRetry(PRODUCTS_DEBUNDLE_MAP_GID).catch(track(PRODUCTS_DEBUNDLE_MAP_GID)) : Promise.resolve(null),
      SINGLE_SKU_TARGETS_GID ? loadSheetWithRetry(SINGLE_SKU_TARGETS_GID).catch(track(SINGLE_SKU_TARGETS_GID)) : Promise.resolve(null),
      COGS_GID ? loadSheetWithRetry(COGS_GID).catch(track(COGS_GID)) : Promise.resolve(null),
      AVAILABILITY_LOCKING_GID ? loadSheetWithRetry(AVAILABILITY_LOCKING_GID).catch(track(AVAILABILITY_LOCKING_GID)) : Promise.resolve(null),
      PRODUCTS_MATCHES_GID ? loadSheetWithRetry(PRODUCTS_MATCHES_GID).catch(track(PRODUCTS_MATCHES_GID)) : Promise.resolve(null),
      MERCHANT_SKU_DAILY_GID ? loadSheetWithRetry(MERCHANT_SKU_DAILY_GID).catch(track(MERCHANT_SKU_DAILY_GID)) : Promise.resolve(null)
    ]);
    sheets = {
      [MAIN_GID]: mainPayload, [TARGETS_GID]: targetsPayload, [SEGMENTATION_GID]: segPayload,
      [TARGETS_ACM_GID]: acmTargetsPayload, [INVENTORY_GID]: invPayload, [PRODUCTS_GID]: prodPayload,
      [CAT_TARGETS_GID]: catTargetsPayload, [ACM_SALES_PLAN_GID]: planPayload,
      [NEW_SEGMENTATION_GID]: newSegPayload,
      [INBOUND_GID]: inboundPayload, [PRODUCTS_INFO_GID]: prodInfoPayload,
      [BEGIN_INV_GID]: begInvPayload, [SELLTHROUGH_NEEDED_GID]: sellthroughNeededPayload,
      [PRODUCTS_DEBUNDLE_MAP_GID]: debundleMapPayload, [SINGLE_SKU_TARGETS_GID]: singleSkuTargetsPayload,
      [COGS_GID]: cogsPayload, [AVAILABILITY_LOCKING_GID]: availabilityLockingPayload,
      [PRODUCTS_MATCHES_GID]: productsMatchesPayload, [MERCHANT_SKU_DAILY_GID]: merchantSkuDailyPayload
    };
    if (newSegLoadError) sheets.__newSegLoadError = newSegLoadError;
  }

  const mainPayload = sheets[MAIN_GID];
  const targetsPayload = sheets[TARGETS_GID];
  const segPayload = sheets[SEGMENTATION_GID];
  const acmTargetsPayload = sheets[TARGETS_ACM_GID];
  const invPayload = sheets[INVENTORY_GID];
  const prodPayload = sheets[PRODUCTS_GID];
  const catTargetsPayload = sheets[CAT_TARGETS_GID];
  const planPayload = sheets[ACM_SALES_PLAN_GID];
  const newSegPayload = sheets[NEW_SEGMENTATION_GID];
  const inboundPayload = sheets[INBOUND_GID];
  const prodInfoPayload = sheets[PRODUCTS_INFO_GID];
  const begInvPayload = sheets[BEGIN_INV_GID];
  const sellthroughNeededPayload = sheets[SELLTHROUGH_NEEDED_GID];
  const debundleMapPayload = sheets[PRODUCTS_DEBUNDLE_MAP_GID];
  const singleSkuTargetsPayload = sheets[SINGLE_SKU_TARGETS_GID];
  const cogsPayload = sheets[COGS_GID];
  const availabilityLockingPayload = sheets[AVAILABILITY_LOCKING_GID];
  const productsMatchesPayload = sheets[PRODUCTS_MATCHES_GID];
  const merchantSkuDailyPayload = sheets[MERCHANT_SKU_DAILY_GID];
  if (sheets.__newSegLoadError) newSegLoadError = sheets.__newSegLoadError;

  const allParsedRows = parseMainSheet(mainPayload);
  if (allParsedRows.length === 0) { throw new Error("No data streams detected."); }

  // شيت CAT_TARGETS_GID بيتقرا مرة واحدة بس (parseCommercialTargetsSheet)،
  // و categoryTargets (المستخدم في CM3 Analyst) بقى مشتق من نفس النتيجة.
  const commercialTargetsResult = catTargetsPayload ? parseCommercialTargetsSheet(catTargetsPayload) : state.commercialTargets;

  return {
    allParsedRows,
    merchantTargets: targetsPayload ? parseTargetsSheet(targetsPayload) : state.merchantTargets,
    merchantSegmentsMap: segPayload ? parseSegmentationSheet(segPayload) : state.merchantSegmentsMap,
    acmTargets: acmTargetsPayload ? parseAcmTargetsSheet(acmTargetsPayload) : state.acmTargets,
    inventoryMap: invPayload ? parseInventorySheet(invPayload) : state.inventoryMap,
    productsMap: prodPayload ? parseProductsSheet(prodPayload) : state.productsMap,
    categoryTargets: catTargetsPayload ? deriveCategoryTargetsFromCommercial(commercialTargetsResult) : state.categoryTargets,
    commercialTargets: commercialTargetsResult,
    acmSalesPlanData: planPayload ? parseAcmSalesPlanSheet(planPayload) : state.acmSalesPlanData, // <-- تارجت Sales Plan-ACM (الأداء الفعلي بيتحسب لايف من allParsedRows)
    newSegRows: newSegPayload ? parseNewSegmentationSheet(newSegPayload) : state.newSegRows, // <-- Segmentation Panel (Admin Panel)
    newSegLoadError: newSegPayload ? null : (newSegLoadError || state.newSegLoadError || "Could not load GID " + NEW_SEGMENTATION_GID + "."),
    inboundRows: inboundPayload ? parseInboundSheet(inboundPayload) : state.inboundRows,
    metabaseProductsInfo: prodInfoPayload ? parseProductsInfoSheet(prodInfoPayload) : state.metabaseProductsInfo,
    metabaseBeginningInventory: begInvPayload ? parseBeginningInventorySheet(begInvPayload) : state.metabaseBeginningInventory,
    metabaseSellthroughNeeded: sellthroughNeededPayload ? parseSellthroughNeededSheet(sellthroughNeededPayload) : state.metabaseSellthroughNeeded,
    debundleMap: debundleMapPayload ? parseDebundleMapSheet(debundleMapPayload) : state.debundleMap, // <-- Commercial Debundlized
    singleSkuTargets: singleSkuTargetsPayload ? parseSingleSkuTargetsSheet(singleSkuTargetsPayload) : state.singleSkuTargets,
    cogsMap: cogsPayload ? parseCogsSheet(cogsPayload) : state.cogsMap, // <-- Commercial Debundlized (وزن الـ Single داخل البندل)
    availabilityLockingRows: availabilityLockingPayload ? parseAvailabilityLockingSheet(availabilityLockingPayload) : state.availabilityLockingRows, // <-- Availability Locking
    productsMatchesRows: productsMatchesPayload ? parseProductsMatchesSheet(productsMatchesPayload) : state.productsMatchesRows, // <-- Recommended Tracker
    merchantSkuDailyRows: merchantSkuDailyPayload ? parseMerchantSkuDailySheet(merchantSkuDailyPayload) : state.merchantSkuDailyRows, // <-- Recommended Tracker (Day0..Day5)
    staleGids // sheets that failed every retry and are still showing old data
  };
}

// -------------------------------------------------------------------------
// بصمة خفيفة (زي computeSnapshotFingerprint) لكن خاصة بس بمصادر لوحة الـ
// Sellthrough (Inbound / Beginning Inventory / Sellthrough Needed / Products
// Info). بتتستخدم عشان نفرّق بين "الداتا الخام اتعمل لها fetch تاني" (بيحصل
// في كل مرة يفتح فيها اليوزر الصفحة) و"الداتا اتغيرت فعلاً" — عشان منعملش
// reset لعلم sellthroughPrepared ونرجع نعرض Loading Data من غير أي تغيير
// حقيقي وصل من الشيت.
// -------------------------------------------------------------------------
function computeSellthroughSourceFingerprint() {
  const inbound = state.inboundRows || [];
  const begInv = state.metabaseBeginningInventory || [];
  const need = state.metabaseSellthroughNeeded || [];
  const prodInfo = state.metabaseProductsInfo || [];
  const debundle = state.debundleMap || [];
  const mainRows = state.allParsedRows || [];

  let sumRcvQty = 0, maxRcvTs = 0;
  inbound.forEach(r => { sumRcvQty += r.rcvQty || 0; if (r.rcvTs > maxRcvTs) maxRcvTs = r.rcvTs; });

  let sumBegQty = 0;
  begInv.forEach(r => { sumBegQty += r.QTY || 0; });

  let sumCnf = 0, sumDlv = 0, sumRto = 0;
  need.forEach(r => { sumCnf += r.CNF_QTY || 0; sumDlv += r.DLV_QTY || 0; sumRto += r.RTO_QTY || 0; });

  // STOCK/DOH بقوا معتمدين على شيت الديبندلايز (debundleMap) وعلى MAIN_GID
  // (allParsedRows) — لازم أي تغيير فيهم (ريفريش جديد) يبطل الكاش، وإلا
  // هيفضل الـ Stock/DOH زي ما هو القديم من غير ما يتحدث.
  let sumStock = 0, maxMainTs = 0;
  debundle.forEach(r => { sumStock += r.stock || 0; });
  mainRows.forEach(r => { if (r.timestamp > maxMainTs) maxMainTs = r.timestamp; });

  return [
    inbound.length, Math.round(sumRcvQty), maxRcvTs,
    begInv.length, Math.round(sumBegQty),
    need.length, Math.round(sumCnf), Math.round(sumDlv), Math.round(sumRto),
    prodInfo.length,
    debundle.length, Math.round(sumStock),
    mainRows.length, maxMainTs
  ].join("|");
}

function applySnapshotToState(snapshot) {
  state.allParsedRows = snapshot.allParsedRows;
  state.merchantInfoMap = buildMerchantInfoMap(snapshot.allParsedRows); // <-- ACM/Merchant Name من شيت الـ Main
  state.merchantTargets = snapshot.merchantTargets;
  state.merchantSegmentsMap = snapshot.merchantSegmentsMap;
  state.acmTargets = snapshot.acmTargets;
  state.inventoryMap = snapshot.inventoryMap;
  state.productsMap = snapshot.productsMap;
  state.categoryTargets = snapshot.categoryTargets;
  state.commercialTargets = snapshot.commercialTargets;
  state.acmSalesPlanData = snapshot.acmSalesPlanData; 
  state.newSegRows = snapshot.newSegRows || [];
  state.newSegLoadError = snapshot.newSegLoadError || null;
  state.inboundRows = snapshot.inboundRows || [];
  state.metabaseProductsInfo = snapshot.metabaseProductsInfo || [];
  state.metabaseBeginningInventory = snapshot.metabaseBeginningInventory || [];
  state.metabaseSellthroughNeeded = snapshot.metabaseSellthroughNeeded || [];
  state.debundleMap = snapshot.debundleMap || [];
  state.singleSkuTargets = snapshot.singleSkuTargets || {};
  state.cogsMap = snapshot.cogsMap || state.cogsMap || new Map();
  state.availabilityLockingRows = snapshot.availabilityLockingRows || state.availabilityLockingRows || [];
  state.productsMatchesRows = snapshot.productsMatchesRows || state.productsMatchesRows || [];
  state.merchantSkuDailyRows = snapshot.merchantSkuDailyRows || state.merchantSkuDailyRows || [];
  // ترتيب أعمدة تواريخ الفيدباك (K فأكتر) زي ما هي في شيت الماتشات — معلقة
  // على الـ array نفسه من parseProductsMatchesSheet (rows.feedbackDateLabels).
  state.matchesFeedbackDateLabels = state.productsMatchesRows.feedbackDateLabels || state.matchesFeedbackDateLabels || [];
  // الداتا الخام اتحدثت (فتح أول مرة / ريفريش) — بس مش كل مرة اليوزر يفتح
  // اللوحة أو يرجعلها لازم نعمل reset. نقارن بصمة مصادر الـ Sellthrough بس:
  // لو نفسها زي قبل (يعني مفيش تحديث حقيقي وصل من الشيت)، نسيب
  // sellthroughPrepared زي ما هي — لو كانت true يفضل الجدول زي ما هو من
  // غير Loading Data تاني. لو فعلاً اتغيرت (أو أول مرة أصلاً)، نعمل reset
  // عشان تتحسب تاني مرة واحدة المرة الجاية اللي هتتفتح فيها.
  const newStFingerprint = computeSellthroughSourceFingerprint();
  if (state._stSourceFingerprint !== undefined && state._stSourceFingerprint !== newStFingerprint) {
    state.sellthroughPrepared = false;
  }
  state._stSourceFingerprint = newStFingerprint;
}
function renderCurrentState() {
  populateFilters(state.allParsedRows);
  applyFilters();
}

// loadData(isManualRefresh):
//  - Page load (isManualRefresh=false): if a cache exists, paint it INSTANTLY
//    (no spinner, no waiting on Google), then silently sync fresh data in the
//    background. If the background sync fails (timeout etc.), the cached
//    data just stays on screen with a small status note — the page never
//    goes blank/broken because of a slow sheet.
//  - Manual refresh (button, isManualRefresh=true): always attempts a fresh
//    fetch. If it fails, falls back to whatever cache is available instead
//    of wiping the screen with an error.
async function loadData(isManualRefresh = false) {
  const loadingEl = $("loadingState"); const errorEl = $("errorState"); const errorMsg = $("errorMsgText");
  const cache = await loadDataFromCache();
  let paintedFromCache = false;

  if (cache && !isManualRefresh) {
    applySnapshotToState(cache.data);
    renderCurrentState();
    if (loadingEl) loadingEl.classList.add("hidden");
    if (errorEl) errorEl.classList.add("hidden");
    setSyncStatus(`Cached — ${formatCacheTimestamp(cache.savedAt)}`);
    paintedFromCache = true;
  } else {
    if (loadingEl) loadingEl.classList.remove("hidden");
    if (errorEl) errorEl.classList.add("hidden");
  }

  try {
    const snapshot = await fetchAllSheetsSnapshot();
    const freshFingerprint = computeSnapshotFingerprint(snapshot);
    // لو الداتا اللي جت دلوقتي مطابقة تماماً لنفس الداتا المخزنة (الكاش)، فمفيش
    // داعي نعمل toast "Synchronized" ولا نغير حالة الـ sync — يفضل الشكل هادي
    // زي ما هو، ونكتفي بتحديث الكاش بصمت. الـ toast/رسالة "Live — updated"
    // بيظهروا بس لو فعلاً حصل تغيير في الداتا.
    const dataChanged = !paintedFromCache || !cache || cache.fingerprint !== freshFingerprint;
    applySnapshotToState(snapshot);
    renderCurrentState();
    saveDataToCache(snapshot);
    backupSnapshotToDrive(snapshot); // fire-and-forget; internally async (gzip), never awaited so it can't block the UI
    if (loadingEl) loadingEl.classList.add("hidden");
    if (errorEl) errorEl.classList.add("hidden");
    if (snapshot.staleGids && snapshot.staleGids.length > 0) {
      const names = snapshot.staleGids.map((gid) => GID_LABELS[gid] || gid).join(", ");
      setSyncStatus(`Live — updated ${formatCacheTimestamp(Date.now())} — ⚠ didn't refresh: ${names} (showing previous data for those)`);
      showToast();
    } else if (dataChanged) {
      setSyncStatus(`Live — updated ${formatCacheTimestamp(Date.now())}`);
      showToast();
    } else {
      setSyncStatus(`Up to date — ${formatCacheTimestamp(Date.now())}`);
    }
  } catch (error) {
    console.error("System Sync Error:", error);
    if (paintedFromCache) {
      // Already showing cached data — just report the failed sync quietly.
      setSyncStatus(`Sync failed — showing cache from ${formatCacheTimestamp(cache.savedAt)}`);
      return;
    }
    if (cache) {
      // Fresh fetch failed (e.g. manual refresh during an outage) but we do
      // have a cache — fall back to it instead of a dead error screen.
      applySnapshotToState(cache.data);
      renderCurrentState();
      if (loadingEl) loadingEl.classList.add("hidden");
      if (errorEl) errorEl.classList.add("hidden");
      setSyncStatus(`Sync failed — showing cache from ${formatCacheTimestamp(cache.savedAt)}`);
      return;
    }
    // No cache at all and the fetch failed — nothing to fall back to.
    if (loadingEl) loadingEl.classList.add("hidden");
    if (errorEl) errorEl.classList.remove("hidden");
    if (errorMsg) errorMsg.textContent = error.message;
    setSyncStatus("Sync failed");
  }
}

if($("searchInput")) $("searchInput").addEventListener("input", applyTableSearchAndSort);
if($("prevPage")) $("prevPage").addEventListener("click", () => { if (state.page > 0) { state.page -= 1; renderPaginatedAcmTable(); } });
if($("nextPage")) $("nextPage").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(state.filteredAcmData.length / PAGE_SIZE)); if (state.page < totalPages - 1) { state.page += 1; renderPaginatedAcmTable(); } });
document.querySelectorAll("#acmTable thead th").forEach((th) => { if (th.dataset.key) { th.addEventListener("click", () => { const key = th.dataset.key; if (state.sortKey === key) { state.sortDir = state.sortDir === "asc" ? "desc" : "asc"; } else { state.sortKey = key; state.sortDir = "desc"; } applyTableSearchAndSort(); }); }});

if($("searchMerchantInput")) $("searchMerchantInput").addEventListener("input", applyMerchantSearchAndSort);
if($("prevPageMerchant")) $("prevPageMerchant").addEventListener("click", () => { if (state.pageMerchant > 0) { state.pageMerchant -= 1; renderPaginatedMerchantTable(); } });
if($("nextPageMerchant")) $("nextPageMerchant").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(state.filteredMerchantData.length / PAGE_SIZE)); if (state.pageMerchant < totalPages - 1) { state.pageMerchant += 1; renderPaginatedMerchantTable(); } });
document.querySelectorAll("#merchantTable thead th").forEach((th) => { if (th.dataset.mkey) { th.addEventListener("click", () => { const key = th.dataset.mkey; if (state.sortKeyMerchant === key) { state.sortDirMerchant = state.sortDirMerchant === "asc" ? "desc" : "asc"; } else { state.sortKeyMerchant = key; state.sortDirMerchant = "desc"; } applyMerchantSearchAndSort(); }); }});

if($("searchSegInput")) $("searchSegInput").addEventListener("input", applySegSearchAndSort);
if($("prevPageSeg")) $("prevPageSeg").addEventListener("click", () => { if (state.pageSeg > 0) { state.pageSeg -= 1; renderPaginatedSegTable(); } });
if($("nextPageSeg")) $("nextPageSeg").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(state.filteredSegData.length / PAGE_SIZE)); if (state.pageSeg < totalPages - 1) { state.pageSeg += 1; renderPaginatedSegTable(); } });
document.querySelectorAll("#segTable thead th").forEach((th) => { if (th.dataset.skey) { th.addEventListener("click", () => { const key = th.dataset.skey; if (state.sortKeySeg === key) { state.sortDirSeg = state.sortDirSeg === "asc" ? "desc" : "asc"; } else { state.sortKeySeg = key; state.sortDirSeg = "desc"; } applySegSearchAndSort(); }); }});

if($("searchInventoryInput")) $("searchInventoryInput").addEventListener("input", applyInventorySearchAndSort);
if($("prevPageInventory")) $("prevPageInventory").addEventListener("click", () => { if (state.pageInventory > 0) { state.pageInventory -= 1; renderPaginatedInventoryTable(); } });
if($("nextPageInventory")) $("nextPageInventory").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(state.filteredInventoryData.length / PAGE_SIZE)); if (state.pageInventory < totalPages - 1) { state.pageInventory += 1; renderPaginatedInventoryTable(); } });
document.querySelectorAll("#inventoryTable thead th").forEach((th) => { if (th.dataset.ikey) { th.addEventListener("click", () => { const key = th.dataset.ikey; if (state.sortKeyInventory === key) { state.sortDirInventory = state.sortDirInventory === "asc" ? "desc" : "asc"; } else { state.sortKeyInventory = key; state.sortDirInventory = "desc"; } applyInventorySearchAndSort(); }); }});

if($("monthSelect")) $("monthSelect").addEventListener("change", applyFilters);
if($("acmSelect")) $("acmSelect").addEventListener("change", applyFilters);
if($("refreshBtn")) $("refreshBtn").addEventListener("click", () => loadData(true));
if($("retryBtn")) $("retryBtn").addEventListener("click", () => loadData(true));

// ==========================================
// DOWNLOAD CSV MODAL LOGIC
// ==========================================
const downloadModal = $("downloadModal");
const downloadOptions = $("downloadOptions");
const confirmDownloadBtn = $("confirmDownload");
const cancelDownloadBtn = $("cancelDownload");
let selectedTableForDownload = null;

$("downloadBtn").addEventListener("click", () => {
    const activeView = document.querySelector(".view-section.active-view") || document.querySelector(".view-section:not(.hidden)");
    if (!activeView) return;
    // كان بيدور بس على ".data-table" — فجداول الـ Summary (زي Confirmed/
    // Delivered Category Breakdown في Sellthrough، وPlaced/Confirmed — Status
    // في Commercial Plan) اللي بتستخدم كلاس ".st-summary-table" مختلف (للشكل
    // بتاعها المختلف عن الجداول العادية) كانت مش بتظهر في مودال الداونلود
    // خالص. دلوقتي بيدور على النوعين مع بعض في أي سكشن/جروب، عشان أي جدول
    // Summary زي ده يبقى قابل للتحميل زي أي جدول تاني.
    const tables = activeView.querySelectorAll(".data-table, .st-summary-table");
    downloadOptions.innerHTML = "";
    
    tables.forEach((t, index) => {
        const panel = t.closest(".panel, .table-panel");
        const h2 = panel ? panel.querySelector("h2") : null;
        const title = h2 ? h2.innerText : "Data Table " + (index + 1);
        
        const label = document.createElement("label");
        label.className = "radio-label";
        label.innerHTML = `<input type="radio" name="tableSelect" value="table_${index}"> ${title}`;
        label.onclick = () => { selectedTableForDownload = { el: t, title }; };
        downloadOptions.appendChild(label);
        
        if (index === 0) {
            label.querySelector("input").checked = true;
            selectedTableForDownload = { el: t, title };
        }
    });
    
    if (tables.length > 0) {
        downloadModal.classList.remove("hidden");
    } else {
        alert("No tables available in the current view to download.");
    }
});

cancelDownloadBtn.addEventListener("click", () => {
    downloadModal.classList.add("hidden");
});

confirmDownloadBtn.addEventListener("click", () => {
    if (!selectedTableForDownload) return;
    downloadModal.classList.add("hidden");
    
    // Save current pagination states
    const originalPage = {
        acm: state.page,
        merchant: state.pageMerchant,
        seg: state.pageSeg,
        inv: state.pageInventory,
        analyst: analystState.page,
        sellthrough: state.sellthroughPage,
        mpMatches: mpMatchesState.page,
        mpNewMatches: mpNewMatchesState.page,
        poorMatches: poorMatchesState.page,
        availabilityLocking: availabilityLockingState.page,
        mpSalesPlan: state.mpSalesPlanPage,
        cdz: state.cdzPage,
        cm3ap: cm3apState.page,
        recTracker: state.recTrackerPage,
        ppmAnalyst: ppmAnalystState.page,
        prodAn: prodAnState.page,
        pma: pmaState.page
    };

    // Set to page 0 and max size
    state.page = 0; state.pageMerchant = 0; state.pageSeg = 0; state.pageInventory = 0; analystState.page = 0;
    state.sellthroughPage = 0; mpMatchesState.page = 0; mpNewMatchesState.page = 0; state.cdzPage = 0; cm3apState.page = 0; poorMatchesState.page = 0; state.mpSalesPlanPage = 0; availabilityLockingState.page = 0;
    state.recTrackerPage = 0; ppmAnalystState.page = 0; prodAnState.page = 0; pmaState.page = 0;
    PAGE_SIZE = 999999;

    if (typeof renderPaginatedInventoryTable === 'function') renderPaginatedInventoryTable();
    if (typeof renderPaginatedRecommendedTrackerTable === 'function') renderPaginatedRecommendedTrackerTable();
    if (typeof renderPaginatedPpmAnalystTable === 'function') renderPaginatedPpmAnalystTable();
    if (typeof renderPaginatedProdAnTable === 'function') renderPaginatedProdAnTable();
    if (typeof renderPaginatedPmaTable === 'function') renderPaginatedPmaTable();
    if (typeof renderPaginatedAcmTable === 'function') renderPaginatedAcmTable();
    if (typeof renderPaginatedMerchantTable === 'function') renderPaginatedMerchantTable();
    if (typeof renderPaginatedSegTable === 'function') renderPaginatedSegTable();
    if (typeof renderPaginatedCm3AnalystTable === 'function') renderPaginatedCm3AnalystTable();
    if (typeof renderPaginatedSellthroughTable === 'function') renderPaginatedSellthroughTable();
    if (typeof renderPaginatedMpMatchesTable === 'function') renderPaginatedMpMatchesTable();
    if (typeof renderPaginatedMpNewMatchesTable === 'function') renderPaginatedMpNewMatchesTable();
    if (typeof renderPaginatedPoorMatchesTable === 'function') renderPaginatedPoorMatchesTable();
    if (typeof renderPaginatedAvailabilityLockingTable === 'function') renderPaginatedAvailabilityLockingTable();
    if (typeof renderPaginatedMpSalesPlanTable === 'function') renderPaginatedMpSalesPlanTable();
    if (typeof renderPaginatedCdzTable === 'function') renderPaginatedCdzTable();
    if (typeof renderCm3apActiveTable === 'function') renderCm3apActiveTable();
    
    // Wait for DOM to render all rows
    setTimeout(() => {
        downloadTableAsCsv(selectedTableForDownload.el, selectedTableForDownload.title);
        
        // Restore pagination
        PAGE_SIZE = 10;
        state.page = originalPage.acm;
        state.pageMerchant = originalPage.merchant;
        state.pageSeg = originalPage.seg;
        state.pageInventory = originalPage.inv;
        analystState.page = originalPage.analyst;
        state.sellthroughPage = originalPage.sellthrough;
        mpMatchesState.page = originalPage.mpMatches;
        mpNewMatchesState.page = originalPage.mpNewMatches;
        poorMatchesState.page = originalPage.poorMatches;
        availabilityLockingState.page = originalPage.availabilityLocking;
        state.mpSalesPlanPage = originalPage.mpSalesPlan;
        state.cdzPage = originalPage.cdz;
        cm3apState.page = originalPage.cm3ap;
        state.recTrackerPage = originalPage.recTracker;
        ppmAnalystState.page = originalPage.ppmAnalyst;
        prodAnState.page = originalPage.prodAn;
        pmaState.page = originalPage.pma;

        if (typeof renderPaginatedInventoryTable === 'function') renderPaginatedInventoryTable();
        if (typeof renderPaginatedAcmTable === 'function') renderPaginatedAcmTable();
        if (typeof renderPaginatedMerchantTable === 'function') renderPaginatedMerchantTable();
        if (typeof renderPaginatedSegTable === 'function') renderPaginatedSegTable();
        if (typeof renderPaginatedCm3AnalystTable === 'function') renderPaginatedCm3AnalystTable();
        if (typeof renderPaginatedSellthroughTable === 'function') renderPaginatedSellthroughTable();
        if (typeof renderPaginatedMpMatchesTable === 'function') renderPaginatedMpMatchesTable();
        if (typeof renderPaginatedMpNewMatchesTable === 'function') renderPaginatedMpNewMatchesTable();
        if (typeof renderPaginatedPoorMatchesTable === 'function') renderPaginatedPoorMatchesTable();
        if (typeof renderPaginatedAvailabilityLockingTable === 'function') renderPaginatedAvailabilityLockingTable();
        if (typeof renderPaginatedMpSalesPlanTable === 'function') renderPaginatedMpSalesPlanTable();
        if (typeof renderPaginatedCdzTable === 'function') renderPaginatedCdzTable();
        if (typeof renderCm3apActiveTable === 'function') renderCm3apActiveTable();
        if (typeof renderPaginatedRecommendedTrackerTable === 'function') renderPaginatedRecommendedTrackerTable();
        if (typeof renderPaginatedPpmAnalystTable === 'function') renderPaginatedPpmAnalystTable();
        if (typeof renderPaginatedProdAnTable === 'function') renderPaginatedProdAnTable();
        if (typeof renderPaginatedPmaTable === 'function') renderPaginatedPmaTable();
    }, 150);
});

// أي خلية (td/th) فيها رقم/فلوس متحسب بـ fmtIntCell / fmtPctCell /
// fmtMoneyCompactCell / fmtCm3MoneyCell بيبقى جواها span بيلف نفس النص المعروض ومعاه
// data-raw = القيمة الخام زي ما هي (بدون EGP ولا K ولا M ولا % ولا فواصل
// آلاف)، ومعاها كمان data-export لو محتاجين شكل مخصوص في الداونلود مختلف
// عن الرقم الخام البسيط — زي النسب المئوية اللي المفروض تنزل "49.0%"
// بعلامة الـ% معاها، مش رقم عشري خام.
//
// أهم حاجة تانية هنا: كل جداولنا فيها thead ممكن يكون على صف واحد أو صفين
// (زي Sales Plan-ACM: صف فيه "Placed Pieces" بـ colspan=4، وتحته صف فيه
// MTD Target/Actual/Run Rate/Ach%). لو مسكناها زي أي صف تاني (صف عناوين =
// عدد خلاياه الحقيقي، من غير مراعاة colspan/rowspan)، صف العناوين هيطلع
// بعدد أعمدة أقل من صفوف البيانات -> كل الأعمدة بعد أول عمود مجمّع بتتزحلق
// وتتلغبط. فبنبني Grid كاملة (زي إحداثيات) بنحط فيها كل خلية عنوان في كل
// الأعمدة اللي بتغطيها (colspan) وكل الصفوف اللي بتغطيها (rowspan)، وبعدين
// بندمج قيم كل عمود من كل صفوف العناوين في اسم واحد مفهوم
// ("Placed Pieces - MTD Target") — عشان صف العناوين النهائي يطلع بنفس عدد
// أعمدة صفوف البيانات بالظبط، ومحاذي صح.
function downloadTableAsCsv(tableEl, fileName) {
    const csvEscape = (val) => '"' + String(val).replace(/"/g, '""').replace(/(\r\n|\n|\r)/gm, " ").trim() + '"';
    const cellExportValue = (cell) => {
        const rawEl = cell.querySelector("[data-raw]");
        if (rawEl) {
            const exportVal = rawEl.getAttribute("data-export");
            if (exportVal !== null && exportVal !== "") return exportVal;
            const rawVal = parseFloat(rawEl.getAttribute("data-raw"));
            return Number.isFinite(rawVal) ? String(rawVal) : "0";
        }
        return cell.innerText || cell.textContent || "";
    };

    let csv = [];
    const thead = tableEl.querySelector("thead");
    const tbody = tableEl.querySelector("tbody");

    if (thead) {
        const headerRows = Array.from(thead.querySelectorAll("tr"));
        const grid = headerRows.map(() => []);
        headerRows.forEach((tr, rowIdx) => {
            let colIdx = 0;
            Array.from(tr.children).forEach(cell => {
                while (grid[rowIdx][colIdx] !== undefined) colIdx++;
                const text = (cell.innerText || cell.textContent || "").trim();
                const colspan = parseInt(cell.getAttribute("colspan") || "1", 10) || 1;
                const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10) || 1;
                for (let r = 0; r < rowspan; r++) {
                    if (!grid[rowIdx + r]) grid[rowIdx + r] = [];
                    for (let c = 0; c < colspan; c++) { grid[rowIdx + r][colIdx + c] = text; }
                }
                colIdx += colspan;
            });
        });
        const totalCols = Math.max(0, ...grid.map(r => r.length));
        const flatHeaders = [];
        for (let c = 0; c < totalCols; c++) {
            const parts = [];
            for (let r = 0; r < headerRows.length; r++) {
                const v = grid[r] ? grid[r][c] : undefined;
                if (v && parts[parts.length - 1] !== v) parts.push(v);
            }
            flatHeaders.push(parts.join(" - "));
        }
        csv.push(flatHeaders.map(csvEscape).join(","));
    }

    // صفوف البيانات: من الـ tbody لو موجود (الحالة العادية في كل جداولنا)،
    // وإلا (نادرًا، جدول من غير thead/tbody صريحين) بنرجع لكل الصفوف زي
    // ما كانت الطريقة القديمة، عشان مفيش جدول يفضل من غير داونلود خالص.
    const bodyRows = tbody ? Array.from(tbody.querySelectorAll("tr")) : (thead ? [] : Array.from(tableEl.querySelectorAll("tr")));
    bodyRows.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll("td, th"));
        const row = cells.map(cellExportValue);
        csv.push(row.map(csvEscape).join(","));
    });

    const csvFile = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv.join("\n")], {type: "text/csv;charset=utf-8;"});
    const downloadLink = document.createElement("a");
    downloadLink.download = (fileName || "Export") + ".csv";
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

setupTicker();
loadData(false);