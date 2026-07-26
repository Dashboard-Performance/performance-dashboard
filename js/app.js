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
const ACM_SALES_PLAN_GID = "892918900"; // شيت التارجت اليومي الخاص بالـ Sales Plan (SINGLE_ID / TAGER_ID / Daily Target)
const SALES_PLAN_PERF_GID = "1857010960"; // شيت البرفورمانس الخاص بالـ Sales Plan - معمول على Single SKU Demand (نفس مستوى البلان)
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
const SEG_PANEL_MONTH = new Date(2026, 6, 1);       // يوليو 2026 — الشهر اللي بنحسب أداءه
const SEG_PANEL_PREV_MONTH = new Date(2026, 5, 1);  // يونيو 2026 — "الشهر اللي فات" (EOMONTH(month,-2)+1 في شيت الإكسيل)
const SEG_PANEL_APRIL_REF = new Date(2026, 3, 1);   // أبريل 2026 — مرجع ثابت بيستخدمه شيت الإكسيل الأصلي (خلية $I$78) لحساب % من إجمالي الميرشانتس بتاعت الـ LVM

let PAGE_SIZE = 10;
const CM3_PLACED_PIECES_COL = 15;
const CM3_MIN_PLACED_PIECES = 10;
const CM3_NEGATIVE_CONTRIBUTION_TARGET = 15;

// أي حساب في السورس كود بيسحب قيمة CM3 من شيت البرفورمانس الـ Main العادي (MAIN_GID)
// لازم يرجع بـ 4 أيام لورا ويقرأ الـ CM3 على أساس التاريخ ده، لأن قيمة الـ CM3 بتاخد وقت
// عشان تتقفل (Confirmed/Delivered/Returns...) وآخر 4 أيام بيكونوا لسه مش نهائيين.
// ده بيتطبق فقط على الحسابات اللي مصدرها MAIN_GID — شيت الـ Sales Plan الجديد (SALES_PLAN_PERF_GID)
// مش داخل في القاعدة دي.
const CM3_LAG_DAYS = 4;

// -------------------------------------------------------------------------
// ملحوظة: سكشن Performance-Matches بقى بيقرأ من شيت الـ Main (MAIN_GID) زي أي
// سكشن تاني، فبيستخدم نفس قاعدة الـ CM3_LAG_DAYS اللي فوق ومفيش لاج خاص بيه.
// شيت الـ Sales Plan Performance (SALES_PLAN_PERF_GID / الـ "Single") بقى
// مستخدم فقط في سكشن Sales Plan-ACM.
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
  mpSalesPlanSortKey: "mtdActual",
  mpSalesPlanSortDir: "desc",
  allParsedRows: [], merchantTargets: {}, merchantSegmentsMap: {}, acmTargets: {}, newSegRows: [], newSegLoadError: null,
  acmSalesPlanData: [],
  salesPlanPerfRows: [], // صفوف شيت البرفورمانس الجديد الخاص بالـ Sales Plan (SALES_PLAN_PERF_GID)
  acmWeights: { gmv: 40, ndr: 20, cm3: 30, retention: 10 },
  inventoryMap: {}, productsMap: {}, categoryTargets: {},
  commercialTargets: {}, tcCategory: "grand total",
  debundleMap: [], singleSkuTargets: {}, cogsMap: new Map(), // Commercial Debundlized (PRODUCTS_DEBUNDLE_MAP_GID / SINGLE_SKU_TARGETS_GID / COGS_GID)
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
  stFilters: { begInv: null, startSale: null, endSale: null },
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
let pipelineChartInst = null;
let categoryChartInst = null;
const $ = (id) => document.getElementById(id);
let jsonpCounter = 0;

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
const navCm3Target = $("navCm3Target");
const navCm3Analyst = $("navCm3Analyst");
const navMpSalesPlan = $("navMpSalesPlan");
const navMpMatches = $("navMpMatches");
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
  if(navInventory) navInventory.classList.remove("active");
  if(navAcmPerf) navAcmPerf.classList.remove("active");
  if(navMerchantPerf) navMerchantPerf.classList.remove("active");
  if(navTargetsCommercial) navTargetsCommercial.classList.remove("active");
  if(navCommercialDebundlized) navCommercialDebundlized.classList.remove("active");
  if(navCm3AnalystProducts) navCm3AnalystProducts.classList.remove("active");
  if(navCm3Target) navCm3Target.classList.remove("active");
  if(navCm3Analyst) navCm3Analyst.classList.remove("active");
  if(navMpSalesPlan) navMpSalesPlan.classList.remove("active");
  if(navMpMatches) navMpMatches.classList.remove("active");
  if(navSegmentationPanel) navSegmentationPanel.classList.remove("active");
  if(navSellthroughPanel) navSellthroughPanel.classList.remove("active");

  let activeSection = null;
  if (viewName === "overview") { activeSection = $("viewOverview"); if(navOverview) navOverview.classList.add("active"); } 
  else if (viewName === "inventory") { activeSection = $("viewInventory"); if(navInventory) navInventory.classList.add("active"); } 
  else if (viewName === "acmPerformance") { activeSection = $("viewAcmPerformance"); if(navAcmPerf) navAcmPerf.classList.add("active"); } 
  else if (viewName === "merchantPerformance") { activeSection = $("viewMerchantPerformance"); if(navMerchantPerf) navMerchantPerf.classList.add("active"); } 
  else if (viewName === "targetsCommercial") { activeSection = $("viewTargetsCommercial"); if(navTargetsCommercial) navTargetsCommercial.classList.add("active"); renderTargetsCommercialView(); }
  else if (viewName === "commercialDebundlized") { activeSection = $("viewCommercialDebundlized"); if(navCommercialDebundlized) navCommercialDebundlized.classList.add("active"); prepareCommercialDebundlizedData(); }
  else if (viewName === "cm3AnalystProducts") { activeSection = $("viewCm3AnalystProducts"); if(navCm3AnalystProducts) navCm3AnalystProducts.classList.add("active"); prepareCm3AnalystProductsData(); }
  else if (viewName === "cm3Target") { activeSection = $("viewCm3Target"); if(navCm3Target) navCm3Target.classList.add("active"); renderCm3TargetView(); } 
  else if (viewName === "cm3Analyst") { activeSection = $("viewCm3Analyst"); if(navCm3Analyst) navCm3Analyst.classList.add("active"); renderCm3AnalystView(); }
  else if (viewName === "mpSalesPlan") { activeSection = $("viewMpSalesPlan"); if(navMpSalesPlan) navMpSalesPlan.classList.add("active"); prepareMpSalesPlanData(); }
  else if (viewName === "mpMatches") { activeSection = $("viewMpMatches"); if(navMpMatches) navMpMatches.classList.add("active"); prepareMpMatchesData(); }
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
if(navInventory) navInventory.addEventListener("click", () => switchView("inventory"));
if(navAcmPerf) navAcmPerf.addEventListener("click", () => switchView("acmPerformance"));
if(navMerchantPerf) navMerchantPerf.addEventListener("click", () => switchView("merchantPerformance"));
if(navTargetsCommercial) navTargetsCommercial.addEventListener("click", () => switchView("targetsCommercial"));
if(navCommercialDebundlized) navCommercialDebundlized.addEventListener("click", () => switchView("commercialDebundlized"));
if(navCm3AnalystProducts) navCm3AnalystProducts.addEventListener("click", () => switchView("cm3AnalystProducts"));
if(navCm3Target) navCm3Target.addEventListener("click", () => switchView("cm3Target"));
if(navCm3Analyst) navCm3Analyst.addEventListener("click", () => switchView("cm3Analyst"));
if(navMpSalesPlan) navMpSalesPlan.addEventListener("click", () => switchView("mpSalesPlan"));
if(navMpMatches) navMpMatches.addEventListener("click", () => switchView("mpMatches"));
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
    (snapshot.acmSalesPlanData || []).length, (snapshot.salesPlanPerfRows || []).length,
    (snapshot.debundleMap || []).length, Object.keys(snapshot.singleSkuTargets || {}).length,
    (snapshot.inboundRows || []).length, (snapshot.newSegRows || []).length
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
        let ndrText = cellText(c[2]); let ndrNum = parseFloat(ndrText.replace(/[^\d.-]/g, '')) || 0;
        if (ndrNum > 0 && ndrNum <= 1 && ndrText.indexOf('%') === -1) ndrNum *= 100;
        let cm3Text = cellText(c[3]); let cm3Num = parseFloat(cm3Text.replace(/[^\d.-]/g, '')) || 0;
        if (cm3Num > 0 && cm3Num <= 1 && cm3Text.indexOf('%') === -1) cm3Num *= 100;
        let retention = cellNumber(c[4]);
        acmTargetsMap[acmName] = { targetGmv: gmv, targetNdr: ndrNum, targetCm3: cm3Num, targetRetention: retention };
      }
      for (let j = 1; j < c.length - 1; j++) {
        const cellStr = normalizeName(cellText(c[j]));
        if (!cellStr) continue;
        let weightText = cellText(c[j + 1]); let weightVal = parseFloat(weightText.replace(/[^\d.-]/g, '')) || 0;
        if (weightVal > 0 && weightVal <= 1 && weightText.indexOf('%') === -1) weightVal *= 100;
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

function parseProductsSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const map = {};
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const skuId = cellText(c[0]);
    if (skuId && skuId !== "SKU_ID") { map[skuId] = { price: cellNumber(c[4]), profit: cellNumber(c[6]) }; }
  }
  return map;
}

function parseCategoryTargetsSheet(payload) {
  const map = {};
  try {
    const rawRows = payload?.table?.rows ?? [];
    for (let i = 0; i < rawRows.length; i++) {
      const c = rawRows[i].c || [];
      if (!c || c.length === 0) continue;
      
      // توحيد اسم القسم بحروف صغيرة لمطابقته لاحقاً بدون أخطاء مسافات أو حروف
      const catName = cellText(c[0]).trim().toLowerCase(); 
      
      // إزالة شرط الـ array المحددة لتشمل جميع الأقسام الموجودة في الشيت
      if (catName && catName !== "category") { 
        let pctText = cellText(c[13]); // تأكد أن التارجت في عمود N
        let pctNum = parseFloat(pctText.replace(/[^\d.-]/g, '')) || 0;
        if (pctNum > 0 && pctNum <= 1 && pctText.indexOf('%') === -1) {
          pctNum *= 100;
        }
        
        map[catName] = {
          targetCm3: cellNumber(c[11]), // تأكد أن التارجت في عمود L
          targetCm3PerPiece: cellNumber(c[12]), // تأكد أن التارجت في عمود M
          targetCm3Pct: pctNum
        };
      }
    }
  } catch(e) {
    console.error("Parse Error in Category Targets:", e);
  }
  return map;
}

// -------------------------------------------------------------------------
// TARGETS COMMERCIAL (Commercial dropdown) — بيقرأ من نفس شيت الـ Category
// Targets (CAT_TARGETS_GID / gid=1656655269)، بس من البلوك التاني اللي شكله
// "Metric في عمود A، وكل قسم (Consumables/Electronics/Home/Leisure/Grand Total)
// في عمود لوحده" — زي بالظبط الجدول اللي اتبعت. القراءة هنا بتتم بمطابقة
// نص التسمية (Label) مش بمطابقة رقم عمود/صف ثابت، عشان تفضل شغالة حتى لو
// اتحرك البلوك في الشيت.
// -------------------------------------------------------------------------
const TC_CATEGORY_ORDER = ["consumables", "electronics", "home", "leisure", "grand total"];
const TC_PCT_KEYS = new Set(["targetCr", "targetDr", "targetNdr", "crRevPct", "drRevPct", "ndrRevPct", "targetPpm"]);
const TC_LABEL_MAP = {
  "placed pieces target": "placedPiecesTarget",
  "planed cnf pieces": "plannedCnfPieces",
  "planned cnf pieces": "plannedCnfPieces",
  "cnf pieces target": "plannedCnfPieces",
  "dlv pieces target": "dlvPiecesTarget",
  "delivered pieces target": "dlvPiecesTarget",
  "target cr%": "targetCr",
  "target cr %": "targetCr",
  "target dr": "targetDr",
  "target dr%": "targetDr",
  "target ndr": "targetNdr",
  "target ndr%": "targetNdr",
  "target placed daily": "targetPlacedDaily",
  "target cnf daily": "targetCnfDaily",
  "target confirmed daily": "targetCnfDaily",
  "target dlv daily": "targetDlvDaily",
  "target delivered daily": "targetDlvDaily",
  "cr rev %": "crRevPct",
  "cr rev%": "crRevPct",
  "dr rev %": "drRevPct",
  "dr rev%": "drRevPct",
  "ndr rev %": "ndrRevPct",
  "ndr rev%": "ndrRevPct",
  "target revenue": "targetRevenue",
  "target gmv": "targetGmv",
  "target cm3": "targetCm3",
  "target ppm": "targetPpm",
  "target ppm pieces": "targetPpmPieces",
  "target ppm/piece": "targetPpmPieces",
  "target ppm per piece": "targetPpmPieces",
  "ppm pieces target": "targetPpmPieces",
  "ppm per piece target": "targetPpmPieces",
  "ppm/piece target": "targetPpmPieces",
  "asp dlv planed": "aspDlvPlanned",
  "asp dlv planned": "aspDlvPlanned",
  "asp dlv target": "aspDlvPlanned"
};
function tcNormalize(str) {
  return (str || "").toString().trim().toLowerCase().replace(/[^\w%]+/g, " ").replace(/\s+/g, " ").trim();
}
function tcFuzzyMatchLabel(label) {
  const has = (s) => label.indexOf(s) !== -1;
  if (has("cnf") && has("piece") && !has("daily")) return "plannedCnfPieces";
  if (has("dlv") && has("piece") && !has("daily")) return "dlvPiecesTarget";
  if (has("placed") && has("piece") && !has("daily")) return "placedPiecesTarget";
  if (has("cr") && has("rev")) return "crRevPct";
  if (has("dr") && has("rev") && !has("ndr")) return "drRevPct";
  if (has("ndr") && has("rev")) return "ndrRevPct";
  if (has("placed") && has("daily")) return "targetPlacedDaily";
  if ((has("cnf") || has("confirmed")) && has("daily")) return "targetCnfDaily";
  if ((has("dlv") || has("delivered")) && has("daily")) return "targetDlvDaily";
  if (has("ndr")) return "targetNdr";
  if (has("dr") && !has("ndr")) return "targetDr";
  if (has("cr") && !has("ndr")) return "targetCr";
  if (has("revenue")) return "targetRevenue";
  if (has("gmv")) return "targetGmv";
  if (has("cm3")) return "targetCm3";
  if (has("ppm") && has("piece")) return "targetPpmPieces";
  if (has("ppm")) return "targetPpm";
  if (has("asp")) return "aspDlvPlanned";
  return null;
}
function parseCommercialTargetsSheet(payload) {
  const result = {};
  TC_CATEGORY_ORDER.forEach(cat => { result[cat] = {}; });
  try {
    const rawRows = payload?.table?.rows ?? [];
    const rawCols = payload?.table?.cols ?? [];

    // الخطوة 1: تحديد عمود كل قسم. جوجل شيتس (gviz) غالبًا بيحط صف العناوين
    // في table.cols (label) مش في table.rows — فده أول مكان نتأكد منه، عشان
    // ده كان سبب رئيسي في إن الـ fallback الثابت (أعمدة 1..5) كان بيقرأ من
    // عمود غلط ويطلع نسب Achievement% غريبة (زي 10205%).
    let colMap = null;
    const colsTempMap = {}; let colsMatches = 0;
    rawCols.forEach((col, idx) => {
      const t = tcNormalize(col && col.label);
      if (TC_CATEGORY_ORDER.includes(t) && colsTempMap[t] === undefined) { colsTempMap[t] = idx; colsMatches++; }
    });
    if (colsMatches >= 3) colMap = colsTempMap;

    // لو مفيش عناوين في table.cols، ندور على صف عناوين جوه table.rows.
    if (!colMap) {
      for (const r of rawRows) {
        const c = r.c || [];
        const tempMap = {}; let matches = 0;
        c.forEach((cell, idx) => {
          const t = tcNormalize(cellText(cell));
          if (TC_CATEGORY_ORDER.includes(t) && tempMap[t] === undefined) { tempMap[t] = idx; matches++; }
        });
        if (matches >= 3) { colMap = tempMap; break; }
      }
    }

    // الخطوة 2: كل صف، نقرأ اسم المقياس من عمود A ونطابقه بالـ label map،
    // وبعدين نقرأ قيم الأقسام. لو مفيش colMap ثابت اتلقى (لا في cols ولا في
    // rows)، بنقرأ القيم positionally من نفس الصف: أول 5 خلايا فيها رقم بعد
    // عمود A بالترتيب Consumables -> Electronics -> Home -> Leisure -> Grand Total
    // (بالظبط زي الترتيب في الجدول اللي اتبعت)، بدل ما نخمن رقم عمود ثابت.
    rawRows.forEach(r => {
      const c = r.c || [];
      if (!c.length) return;
      const label = tcNormalize(cellText(c[0]));
      if (!label) return;
      const key = TC_LABEL_MAP[label] || tcFuzzyMatchLabel(label);
      if (!key) return;

      if (colMap) {
        TC_CATEGORY_ORDER.forEach(cat => {
          const colIdx = colMap[cat];
          if (colIdx === undefined || !c[colIdx]) return;
          const rawText = cellText(c[colIdx]);
          let num = cellNumber(c[colIdx]);
          if (TC_PCT_KEYS.has(key) && num > 0 && num <= 1 && rawText.indexOf('%') === -1) num *= 100;
          result[cat][key] = num;
        });
      } else {
        const valueCells = [];
        for (let i = 1; i < c.length && valueCells.length < TC_CATEGORY_ORDER.length; i++) {
          if (c[i] && cellText(c[i]) !== "") valueCells.push(c[i]);
        }
        TC_CATEGORY_ORDER.forEach((cat, idx) => {
          const cell = valueCells[idx];
          if (!cell) return;
          const rawText = cellText(cell);
          let num = cellNumber(cell);
          if (TC_PCT_KEYS.has(key) && num > 0 && num <= 1 && rawText.indexOf('%') === -1) num *= 100;
          result[cat][key] = num;
        });
      }
    });

    // تارجت CM3% محسوبة (مش موجودة في الشيت): TOTAL CM3 / TOTAL GMV لكل قسم.
    TC_CATEGORY_ORDER.forEach(cat => {
      const d = result[cat];
      d.targetCm3Pct = d.targetGmv ? (d.targetCm3 / d.targetGmv) * 100 : 0;
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
function tcEmptyBucket() { return { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0, crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, dateSet: new Set() }; }
function tcFinalizeBucket(b) {
  const crPct = b.crPlaced ? (b.crConfirmed / b.crPlaced) * 100 : 0;
  const drPct = b.drConfirmed ? (b.drDelivered / b.drConfirmed) * 100 : 0;
  const ndrPct = (crPct * drPct) / 100;
  const activeDays = b.dateSet.size || 1;
  const cm3Pct = b.cm3Gmv ? (b.cm3 / b.cm3Gmv) * 100 : 0;
  const aspDlv = b.delivered ? (b.deliveredGmv / b.delivered) : 0;
  return {
    placed: b.placed, confirmed: b.confirmed, delivered: b.delivered, crPct, drPct, ndrPct,
    placedDaily: b.placed / activeDays, cnfDaily: b.confirmed / activeDays, dlvDaily: b.delivered / activeDays,
    revenue: b.deliveredGmv, gmv: b.deliveredGmv, cm3: b.cm3, ppm: b.ppm, aspDlv, cm3Pct
  };
}
function computeCommercialActuals(mainRowsAll) {
  const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
  const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
  const rows = (mainRowsAll || []).filter(r => (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acmName === selectedAcm));
  const cm3CutoffTs = getCm3LagCutoffTimestamp(rows); // 4 أيام (CM3_LAG_DAYS) — نفس كات أوف الـ CM3 والـ DR
  const crCutoffTs = getLagCutoffTimestamp(rows, CR_LAG_DAYS); // يومين — خاص بالـ CR بس

  const CATS = ["consumables", "electronics", "home", "leisure"];
  const buckets = {}; CATS.forEach(c => buckets[c] = tcEmptyBucket());

  rows.forEach(r => {
    const catNorm = (r.category || "").trim().toLowerCase();
    if (!buckets[catNorm]) return;
    const b = buckets[catNorm];
    b.placed += r.placedPieces; b.confirmed += r.confirmedPieces; b.delivered += r.deliveredPieces;
    b.deliveredGmv += r.deliveredGmv;
    if (r.date) b.dateSet.add(r.date);
    if (isRowEligibleForLag(r, crCutoffTs)) { b.crPlaced += r.placedPieces; b.crConfirmed += r.confirmedPieces; }
    if (isRowEligibleForLag(r, cm3CutoffTs)) { b.drConfirmed += r.confirmedPieces; b.drDelivered += r.deliveredPieces; }
    if (isCm3RowEligible(r, cm3CutoffTs)) { b.cm3 += r.cm3; b.cm3Gmv += r.deliveredGmv; b.ppm += (r.ppm || 0); }
  });

  const results = {};
  const grand = tcEmptyBucket();
  CATS.forEach(cat => {
    const b = buckets[cat];
    results[cat] = tcFinalizeBucket(b);
    grand.placed += b.placed; grand.confirmed += b.confirmed; grand.delivered += b.delivered;
    grand.deliveredGmv += b.deliveredGmv; grand.cm3 += b.cm3; grand.cm3Gmv += b.cm3Gmv; grand.ppm += b.ppm;
    grand.crPlaced += b.crPlaced; grand.crConfirmed += b.crConfirmed;
    grand.drConfirmed += b.drConfirmed; grand.drDelivered += b.drDelivered;
    b.dateSet.forEach(d => grand.dateSet.add(d));
  });
  results["grand total"] = tcFinalizeBucket(grand);
  return results;
}

function parseAcmSalesPlanSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const plan = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const singleId = cellText(c[0]);
    // تخطي صف العناوين
    if (singleId && singleId !== "SINGLE_ID") {
      plan.push({
        singleId: singleId,
        singleName: cellText(c[1]),
        tagerId: cellText(c[2]),
        fullName: cellText(c[3]),
        dailyTarget: cellText(c[4]) // <-- قراءة العمود E (الخامس) كهدف يومي مباشر
      });
    }
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
// الأعمدة: PRODUCT_ID, PRODUCT_NAME, IS_BUNDLE, SINGLE_ID, SINGLE_NAME, PRODUCT_QUANTITY, STOCK (عمود G)
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
      stock: cellNumber(c[6]) || 0 // العمود G — الاستوك الخاص بالـ SINGLE_ID
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// شيت تارجتس الـ Single SKU (SINGLE_SKU_TARGETS_GID / gid=1620722565).
// Adjusted Target = تارجت يومي على أساس Confirmed.
// الأعمدة: ID, NAME, Category, Adjusted Target
// -------------------------------------------------------------------------
function parseSingleSkuTargetsSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const map = {};
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const id = cellText(c[0]).trim();
    if (!id || id === "ID") continue;
    map[id] = { name: cellText(c[1]), category: cellText(c[2]), adjustedTarget: cellNumber(c[3]) };
  }
  return map;
}

// شيت البرفورمانس الجديد الخاص بالـ Sales Plan (SALES_PLAN_PERF_GID / gid=1857010960).
// معمول على مستوى Single SKU Demand بالظبط زي البلان (ACM_SALES_PLAN_GID)، فمفيش داعي
// لمطابقة يدوية مع شيت الـ Main الكبير — الصف هنا أصلاً TAGER_ID + PRODUCT_ID + PERIOD_FILTER.
// ترتيب الأعمدة (0-based) زي ما وصلت بالظبط:
// 0 PERIOD_FILTER, 1 TAGER_ID, 2 TAGER_NAME, 3 PRODUCT_ID, 4 PRODUCT_NAME, 5 CATEGORY,
// 6 SUB_CATEGORY, 7 ITEM_TYPE, 8 ACTIVE_DAYS, 9 PLACED_ORDERS, 10 CONFIRMED_ORDERS,
// 11 DELIVERED_ORDERS, 12 CR_ORDERS, 13 DR_ORDERS, 14 NDR_ORDERS, 15 PLACED_PIECES,
// 16 CONFIRMED_PIECES, 17 DELIVERED_PIECES, 18 CR_PCS, 19 DR_PCS, 20 NDR_PCS,
// 21 PLACED_GMV, 22 DELIVERED_GMV, 23 PLACED_ASP, 24 DELIVERED_ASP, 25 MERCH_MARGIN,
// 26 MERCH_MARGIN_PIECE, 27 DELIVERED_PPM, 28 CM3, 29 PPM_PER_PIECE, 30 CM3_PER_PIECE, 31 ACM
function parseSalesPlanPerformanceSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
  for (const r of rawRows) {
    const c = r.c || [];
    if (!c || c.length === 0) continue;
    const tagerId = cellText(c[1]);
    const productId = cellText(c[3]);
    // تخطي أي صف فاضي أو صف عناوين
    if (!tagerId && !productId) continue;
    if (tagerId === "TAGER_ID" || productId === "PRODUCT_ID") continue;

    const periodStr = cellText(c[0]);
    const d = new Date(periodStr);
    const hasValidDate = !isNaN(d.getTime());
    const monthYear = hasValidDate ? d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) : "Unknown Month";

    rows.push({
      periodFilter: periodStr,
      monthYear: monthYear,
      timestamp: hasValidDate ? d.getTime() : 0,
      tagerId: tagerId,
      tagerName: cellText(c[2]),
      productId: productId,
      productName: cellText(c[4]),
      category: cellText(c[5]) || "Uncategorized",
      subCategory: cellText(c[6]),
      itemType: cellText(c[7]),
      activeDays: cellNumber(c[8]),
      placedOrders: cellNumber(c[9]),
      confirmedOrders: cellNumber(c[10]),
      deliveredOrders: cellNumber(c[11]),
      crOrders: cellNumber(c[12]),
      drOrders: cellNumber(c[13]),
      ndrOrders: cellNumber(c[14]),
      placedPieces: cellNumber(c[15]),
      confirmedPieces: cellNumber(c[16]),
      deliveredPieces: cellNumber(c[17]),
      crPcs: cellNumber(c[18]),
      drPcs: cellNumber(c[19]),
      ndrPcs: cellNumber(c[20]),
      placedGmv: cellNumber(c[21]),
      deliveredGmv: cellNumber(c[22]),
      placedAsp: cellNumber(c[23]),
      deliveredAsp: cellNumber(c[24]),
      merchMargin: cellNumber(c[25]),
      merchMarginPiece: cellNumber(c[26]),
      deliveredPpm: cellNumber(c[27]),
      cm3: cellNumber(c[28]),
      ppmPerPiece: cellNumber(c[29]),
      cm3PerPiece: cellNumber(c[30]),
      acm: cellText(c[31]) || "Unassigned"
    });
  }
  return rows;
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
// span عادي ومعاه data-raw = الرقم الحقيقي الخام زي ما هو. الداونلود
// (downloadTableAsCsv) بيدور على data-raw ده ولو لقاه بينزل الرقم الخام زي
// ما هو (number مش text، من غير EGP ولا K ولا فواصل) - غير كده بيرجع للنص
// المعروض العادي زي ما كان.
// -------------------------------------------------------------------------
function wrapRawCell(raw, text) {
  const safeRaw = Number.isFinite(raw) ? raw : 0;
  return `<span class="raw-num" data-raw="${safeRaw}">${text}</span>`;
}
const fmtIntCell = (n) => wrapRawCell(n, fmtInt.format(n));
const fmtPctCell = (n) => wrapRawCell(n, fmtPct(n));
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
  if ($("viewCm3Target") && $("viewCm3Target").classList.contains("active-view")) renderCm3TargetView();
  if ($("viewCm3Analyst") && $("viewCm3Analyst").classList.contains("active-view")) renderCm3AnalystView();
  if ($("viewMpMatches") && $("viewMpMatches").classList.contains("active-view")) prepareMpMatchesData();
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
  const cr = totalPlaced ? (totalConfirmed / totalPlaced) : 0;
  const dr = totalConfirmed ? (totalDelivered / totalConfirmed) : 0;
  return { placedOrders: totalPlaced, confirmedOrders: totalConfirmed, deliveredGmv, confirmedGmv, cr: cr * 100, dr: dr * 100, ndr: (dr * cr) * 100, activeSkus: skus.size, activeMerchants: merchants.size };
}

function computeLeaderboard(rows) {
  const map = new Map();
  rows.forEach(r => {
    if (!r.acmName || r.acmName === "Unassigned") return;
    const entry = map.get(r.acmName) || { name: r.acmName, placed: 0, confirmed: 0, delivered: 0 };
    entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders;
    map.set(r.acmName, entry);
  });
  return Array.from(map.values()).filter(m => m.placed > 0).map(m => {
    const cr = m.placed ? (m.confirmed / m.placed) : 0;
    const dr = m.confirmed ? (m.delivered / m.confirmed) : 0;
    return { name: m.name, orders: m.confirmed, ndr: (dr * cr) * 100 };
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

function renderPipelineChart(rows) {
  const pipelineCanvas = document.getElementById('pipelineChart'); if(!pipelineCanvas) return; const ctx = pipelineCanvas.getContext('2d');
  const dailyData = {};
  rows.forEach(r => {
    if(!r.date) return;
    if(!dailyData[r.date]) { dailyData[r.date] = { confirmed: 0, placed: 0, ts: r.timestamp }; }
    dailyData[r.date].confirmed += r.confirmedOrders; dailyData[r.date].placed += r.placedOrders;
  });
  const sortedDates = Object.keys(dailyData).sort((a, b) => dailyData[a].ts - dailyData[b].ts);
  const labels = sortedDates.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const confirmedValues = sortedDates.map(d => dailyData[d].confirmed); const placedValues = sortedDates.map(d => dailyData[d].placed);
  if (pipelineChartInst) pipelineChartInst.destroy();
  Chart.defaults.color = '#94a3b8'; Chart.defaults.font.family = 'Inter';
  pipelineChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [ { type: 'line', label: 'Placed', data: placedValues, borderColor: '#475569', borderWidth: 2, pointBackgroundColor: '#0f172a', pointBorderColor: '#475569', pointRadius: 2, pointHoverRadius: 5, fill: false, tension: 0.4, order: 1 }, { type: 'bar', label: 'Confirmed', data: confirmedValues, backgroundColor: '#3b82f6', borderRadius: 4, order: 2 } ] },
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
  let displayPeriods;
  if (periodMode === "monthly") { displayPeriods = allPeriodsSorted; } else {
    const monthStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
    const monthStartSort = cm3PeriodSortKey(monthStart, periodMode); const latestSort = cm3PeriodSortKey(latestDate, periodMode);
    displayPeriods = allPeriodsSorted.filter(p => { const sortKey = periodSortMap.get(p); return sortKey >= monthStartSort && sortKey <= latestSort; });
  }
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
      if (!matrix.has(key)) matrix.set(key, { label: `${c.merchantName || c.merchantId} - ${c.sku}`, periods: new Map() });
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

function cm3ComputeTransitionRows(matrix, allPeriodsSorted, displayPeriods) {
  return displayPeriods.map(period => {
    const periodIdx = allPeriodsSorted.indexOf(period); const prevPeriod = periodIdx > 0 ? allPeriodsSorted[periodIdx - 1] : null;
    let turnedPositive = 0, turnedNegative = 0, becameZero = 0, stayedNegative = 0, stayedPositive = 0, newMatch = 0;
    let totalNegLastPeriod = 0, cm3NegLast = 0, cm3NegThis = 0, cm3PosThisRaw = 0, cm3NegThisRaw = 0;
    matrix.forEach(entity => {
      const prev = prevPeriod !== null ? (entity.periods.get(prevPeriod) || 0) : 0;
      const curr = entity.periods.get(period) || 0;
      let status;
      if (prev === 0) status = "New Match"; else if (prev < 0 && curr > 0) status = "Turned Positive"; else if (prev < 0 && curr === 0) status = "Became Zero"; else if (prev < 0 && curr < 0) status = "Stayed Negative"; else if (prev >= 0 && curr >= 0) status = "Stayed Positive"; else if (prev >= 0 && curr < 0) status = "Turned Negative"; else status = "";
      if (status === "Turned Positive") turnedPositive++; else if (status === "Turned Negative") turnedNegative++; else if (status === "Became Zero") becameZero++; else if (status === "Stayed Negative") stayedNegative++; else if (status === "Stayed Positive") stayedPositive++; else if (status === "New Match") newMatch++;
      if (prev < 0) { totalNegLastPeriod++; cm3NegLast += prev; }
      if (curr < 0 && prev !== 0) cm3NegThis += curr;
      if (curr > 0) cm3PosThisRaw += curr; if (curr < 0) cm3NegThisRaw += curr;
    });
    const actionRate = totalNegLastPeriod ? ((turnedPositive + becameZero) / totalNegLastPeriod) * 100 : null;
    const recoveryRate = totalNegLastPeriod ? (turnedPositive / totalNegLastPeriod) * 100 : null;
    const contrNeg = cm3PosThisRaw ? Math.abs(cm3NegThisRaw / cm3PosThisRaw) * 100 : 0;
    return { period, turnedPositive, turnedNegative, becameZero, stayedNegative, stayedPositive, newMatch, totalNegLastPeriod, actionRate, recoveryRate, cm3NegLast, cm3NegThis, cm3PositiveTotal: cm3PosThisRaw, cm3NegativeTotal: cm3NegThisRaw, contrNeg };
  });
}

function computeCm3Analysis(periodMode, scope) {
  const built = cm3BuildCombos(state.allParsedRows, periodMode); if (!built) return null;
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
  { key: "period", label: "Period" }, { key: "turnedPositive", label: "Turned Positive" }, { key: "turnedNegative", label: "Turned Negative" },
  { key: "becameZero", label: "Became Zero" }, { key: "stayedNegative", label: "Stayed Negative" }, { key: "stayedPositive", label: "Stayed Positive" },
  { key: "newMatch", label: "New Match" }, { key: "totalNegLastPeriod", label: "Total Negative in Last Period" }, { key: "actionRate", label: "Action Rate" },
  { key: "recoveryRate", label: "Recovery Rate" }, { key: "cm3NegLast", label: "Total CM3 Negative last period" }, { key: "cm3NegThis", label: "Total CM3 Negative this period" },
  { key: "contrNeg", label: `CONTR% -VE (Target ${CM3_NEGATIVE_CONTRIBUTION_TARGET}%)` }
];

const SCOPE_TITLES = { overall: "Overall Performance", category: "Performance by Category", product: "Performance by Product", match: "Performance by Match (Product per Merchant)" };

function renderCm3TargetTable(rows) {
  const head = $("cm3TargetTableHead"); const body = $("cm3TargetTableBody"); if (!head || !body) return;
  head.innerHTML = CM3_TABLE_COLUMNS.map(c => `<th class="${c.key === "period" ? "" : "num"}">${c.label}</th>`).join("");
  body.innerHTML = "";
  if (!rows || rows.length === 0) { body.innerHTML = `<tr><td colspan="${CM3_TABLE_COLUMNS.length}" class="text-dim center">No qualifying data for this range.</td></tr>`; return; }
  rows.forEach(r => {
    const tr = document.createElement("tr"); const contrClass = cm3ContrBadgeClass(r.contrNeg);
    tr.innerHTML = `
      <td class="cm3-period-cell">${r.period}</td>
      <td class="num"><span class="badge-status turned-positive">${fmtIntCell(r.turnedPositive)}</span></td>
      <td class="num"><span class="badge-status turned-negative">${fmtIntCell(r.turnedNegative)}</span></td>
      <td class="num"><span class="badge-status became-zero">${fmtIntCell(r.becameZero)}</span></td>
      <td class="num"><span class="badge-status stayed-negative">${fmtIntCell(r.stayedNegative)}</span></td>
      <td class="num"><span class="badge-status stayed-positive">${fmtIntCell(r.stayedPositive)}</span></td>
      <td class="num"><span class="badge-status new-match">${fmtIntCell(r.newMatch)}</span></td>
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
  const last = overallRows.length ? overallRows[overallRows.length - 1] : null;
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
    else if (periodMode === "monthly") { rangeLabel.textContent = `${displayPeriods[0]} - ${displayPeriods[displayPeriods.length - 1]}`; }
    else { rangeLabel.textContent = `Month-to-date: ${displayPeriods[0]} - ${displayPeriods[displayPeriods.length - 1]}`; }
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
const TC_CATEGORY_LABELS = { consumables: "Consumables", electronics: "Electronics", home: "Home", leisure: "Leisure", "grand total": "Grand Total" };
const TC_METRIC_ROWS = [
  { label: "Placed Pieces", t: "placedPiecesTarget", a: "placed", fmt: "int" },
  { label: "Confirmed (CNF) Pieces", t: "plannedCnfPieces", a: "confirmed", fmt: "int" },
  { label: "Delivered (DLV) Pieces", t: "dlvPiecesTarget", a: "delivered", fmt: "int" },
  { label: "CR %", t: "targetCr", a: "crPct", fmt: "pct" },
  { label: "DR %", t: "targetDr", a: "drPct", fmt: "pct" },
  { label: "NDR %", t: "targetNdr", a: "ndrPct", fmt: "pct" },
  { label: "Placed Daily", t: "targetPlacedDaily", a: "placedDaily", fmt: "int" },
  { label: "Confirmed Daily", t: "targetCnfDaily", a: "cnfDaily", fmt: "int" },
  { label: "Delivered Daily", t: "targetDlvDaily", a: "dlvDaily", fmt: "int" },
  { label: "CR Rev %", t: "crRevPct", a: null, fmt: "pct" },
  { label: "DR Rev %", t: "drRevPct", a: null, fmt: "pct" },
  { label: "NDR Rev %", t: "ndrRevPct", a: null, fmt: "pct" },
  { label: "Revenue", t: "targetRevenue", a: "revenue", fmt: "money" },
  { label: "GMV", t: "targetGmv", a: "gmv", fmt: "money" },
  { label: "CM3", t: "targetCm3", a: "cm3", fmt: "money" },
  { label: "PPM", t: "targetPpm", a: "ppm", fmt: "money", tFmt: "pct", noAch: true },
  { label: "ASP DLV", t: "aspDlvPlanned", a: "aspDlv", fmt: "money" },
  { label: "CM3 %", t: "targetCm3Pct", a: "cm3Pct", fmt: "pct" }
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
  tcUpdateKpiCard("tcNdr", targetRow ? targetRow.targetNdr : 0, actualRow ? actualRow.ndrPct : 0);
  tcUpdateKpiCard("tcCm3Pct", targetRow ? targetRow.targetCm3Pct : 0, actualRow ? actualRow.cm3Pct : 0);

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
  if (!analysis) { renderCm3TargetTable([]); return; }
  renderCm3Cards(analysis.matchLevelRows, cm3State.period, analysis.displayPeriods);
  renderCm3Charts(analysis.matchLevelRows);
  if (cm3State.scope === "overall") renderCm3OverallTable(analysis.scopedRows); else renderCm3TargetTable(analysis.scopedRows);
  cm3WireControlsOnce();
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
    html += `<th data-akey="index">#</th><th data-akey="id">Merchant ID</th><th data-akey="name">Merchant Name</th><th data-akey="placedPieces" class="num">Total Placed</th><th data-akey="confirmedPieces" class="num">Total Confirmed</th><th data-akey="deliveredPieces" class="num">Total Delivered</th><th data-akey="cr" class="num">CR%</th><th data-akey="dr" class="num">DR%</th><th data-akey="ndr" class="num">NDR%</th><th data-akey="deliveredGmv" class="num">Delivered GMV</th><th data-akey="cm3" class="num">Total CM3</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;">CM3 %</th><th class="center">Status</th>`;
  } else if(analystState.scope === "category") {
    html += `<th data-akey="index">#</th><th data-akey="category">Category</th><th data-akey="targetCm3" class="num text-dim">Target CM3</th><th data-akey="cm3" class="num">Actual CM3</th><th data-akey="targetCm3PerPiece" class="num text-dim">Target CM3/Pc</th><th data-akey="cm3PerPiece" class="num">Actual CM3/Pc</th><th data-akey="targetCm3Pct" class="num text-dim">Target CM3 %</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;">Actual CM3 %</th><th class="center">Status</th>`;
  } else if(analystState.scope === "match") {
    html += `<th data-akey="index">#</th><th data-akey="id">Merchant ID</th><th data-akey="name" class="truncate-cell">Merchant Name</th><th data-akey="sku">Product ID</th><th data-akey="skuName" class="truncate-cell">Product Name</th><th data-akey="category" class="text-dim">Category</th><th data-akey="placedPieces" class="num">Total Placed</th><th data-akey="confirmed" class="num">Total Confirmed</th><th data-akey="delivered" class="num">Total Delivered</th><th data-akey="cm3" class="num">Total CM3</th><th data-akey="cm3PerPiece" class="num">CM3 / Pc</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;">CM3 %</th><th class="center">Status</th>`;
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

// الصفحة دي (CM3 Analyst) كلها أصلاً مخصصة لتحليل الـ CM3، فكل رقم فيها (Placed / Confirmed /
// Delivered / Delivered GMV / CM3) لازم يتحسب من نفس الفترة المقطوعة (بعد استبعاد آخر
// CM3_LAG_DAYS أيام) — مش الـ CM3 لوحدها بتاخد كات أوف والباقي ماشي لحد آخر يوم في الداتا.
// ده بالظبط زي لو حد فلتر التاريخ يدوي في الشيت وشال آخر 4 أيام قبل ما يعمل SUM.
function prepareCm3AnalystData(rows) {
  const map = new Map(); let totalGmv = 0; let totalCm3 = 0;
  const cm3Cutoff = getCm3LagCutoffTimestamp(rows);
  const eligibleRows = rows.filter(r => isCm3RowEligible(r, cm3Cutoff));
  eligibleRows.forEach(r => {
    let key = "";
    if (analystState.scope === "merchant") key = r.merchantId; else if (analystState.scope === "category") key = r.category; else if (analystState.scope === "match") key = r.merchantId + "||" + r.sku;
    if (!key || key === "Unassigned") return;
    if (!map.has(key)) { map.set(key, { id: r.merchantId, name: r.merchantName || r.merchantId, sku: r.sku, skuName: (state.inventoryMap[r.sku] ? state.inventoryMap[r.sku].skuName : "Unknown"), category: r.category, placed: 0, confirmed: 0, delivered: 0, placedPieces: 0, confirmedPieces: 0, deliveredPieces: 0, deliveredGmv: 0, cm3: 0 }); }
    const entry = map.get(key);
    entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders; entry.placedPieces += (r.placedPieces || r.placedOrders); entry.confirmedPieces += (r.confirmedPieces || r.confirmedOrders); entry.deliveredPieces += (r.deliveredPieces || r.deliveredOrders); entry.deliveredGmv += r.deliveredGmv; entry.cm3 += r.cm3;
    totalGmv += r.deliveredGmv; totalCm3 += r.cm3;
  });
  analystState.data = Array.from(map.values()).map(m => {
    const cr = m.placed ? (m.confirmed / m.placed) : 0; const dr = m.confirmed ? (m.delivered / m.confirmed) : 0; const ndr = dr * cr; 
    const cm3Pct = m.deliveredGmv ? (m.cm3 / m.deliveredGmv) * 100 : 0; 
    const cm3PerPiece = m.delivered ? (m.cm3 / m.delivered) : 0;
    const normalizedCategory = (m.category || "").trim().toLowerCase();
    const catTarget = state.categoryTargets[normalizedCategory] || { targetCm3: 0, targetCm3PerPiece: 0, targetCm3Pct: 0 };
    return { ...m, cr: cr * 100, dr: dr * 100, ndr: ndr * 100, cm3Pct, cm3PerPiece, targetCm3: catTarget.targetCm3, targetCm3PerPiece: catTarget.targetCm3PerPiece, targetCm3Pct: catTarget.targetCm3Pct };
  });
  if($("analystTotalGmv")) $("analystTotalGmv").textContent = fmtMoneyCompact(totalGmv);
  if($("analystTotalCm3")) $("analystTotalCm3").textContent = fmtMoneyCompact(totalCm3);
  if($("analystOverallCm3Pct")) $("analystOverallCm3Pct").textContent = fmtPct(totalGmv ? (totalCm3/totalGmv)*100 : 0);
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
// MARKETPLACE SALES PLAN — نفس منطق ونفس مصدري بيانات "Sales Plan-ACM" بالظبط
// (ACM_SALES_PLAN_GID لهدف اليومي/SKU + SALES_PLAN_PERF_GID لأداء الـ Single SKU
// gid=1857010960)، الفرق الوحيد إن "ACTUAL CONFIRMED" هنا بيتقرا من عمود
// CONFIRMED_PIECES (العمود Q / index 16) مش من CONFIRMED_ORDERS، لأن قسم
// الـ Marketplace بيتابع الأداء على مستوى القطع (Pieces) مش الأوردرات.
// التارجت الشهري (Target MTD) = Daily Target × عدد الأيام من أول الشهر لحد امبارح،
// وبيتفلتر بفلتر الشهر/الـ ACM بره فوق زي أي قسم تاني في الداشبورد.
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

function prepareMpSalesPlanData() {
    if (!state.acmSalesPlanData || state.acmSalesPlanData.length === 0) return;

    const selectedMonth = $("monthSelect") ? $("monthSelect").value : "";
    const selectedAcm = $("acmSelect") ? $("acmSelect").value : "All";
    const perfRowsAll = state.salesPlanPerfRows || [];
    const perfRows = perfRowsAll.filter(r => {
        return (selectedMonth === "" || r.monthYear === selectedMonth) && (selectedAcm === "All" || r.acm === selectedAcm);
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

    const mergedData = state.acmSalesPlanData.map(plan => {
        let metrics = { confirmed: 0, thisWeekConfirmed: 0, lastWeekConfirmed: 0, deliveredGmv: 0 };

        perfRows.forEach(r => {
            if (r.productId === plan.singleId && r.tagerId === plan.tagerId) {
                // ACTUAL CONFIRMED بيتحسب من CONFIRMED_PIECES (عمود Q) مش من CONFIRMED_ORDERS
                metrics.confirmed += r.confirmedPieces;
                metrics.deliveredGmv += r.deliveredGmv;
                const rTime = new Date(r.timestamp).setHours(0,0,0,0);
                if (rTime >= startThisWeek) metrics.thisWeekConfirmed += r.confirmedPieces;
                else if (rTime >= startLastWeek && rTime < startThisWeek) metrics.lastWeekConfirmed += r.confirmedPieces;
            }
        });

        // قراءة التارجت اليومي من العمود E مباشرة بدون أي عمليات
        const dailyTarget = plan.dailyTarget;

        // حساب التارجت لحد امبارح (نضرب اليومي في عدد الأيام اللي فاتت)
        const mtdTarget = dailyTarget * daysUntilYesterday;
        const mtdActual = metrics.confirmed;

        const gap = mtdTarget - mtdActual;
        const runRate = (mtdActual / elapsedDays) * currentMonthDays;
        const mtdAchievedPct = mtdTarget > 0 ? (mtdActual / mtdTarget) * 100 : 0;
        const finalStatus = getMpSalesPlanFinalStatus(mtdAchievedPct);

        // تجميع الأعداد للكروت الأربعة (Critical / Good / Excellent / Upside)
        if (mtdAchievedPct < 50) countCritical++;
        else if (mtdAchievedPct < 85) countGood++;
        else if (mtdAchievedPct < 100) countExcellent++;
        else countUpside++;

        const wowDiff = metrics.thisWeekConfirmed - metrics.lastWeekConfirmed;
        let wowPct = 0;
        if (metrics.lastWeekConfirmed > 0) wowPct = (wowDiff / metrics.lastWeekConfirmed) * 100;
        else if (metrics.thisWeekConfirmed > 0) wowPct = 100;

        let wowStatus = 'Stable'; let wowClass = 'stable'; let wowIcon = '➖';
        if (wowPct > 10) { wowStatus = 'Spike'; wowClass = 'spike'; wowIcon = '📈'; }
        else if (wowPct < -10) { wowStatus = 'Decline'; wowClass = 'decline'; wowIcon = '📉'; }

        totalSkus++;
        if (mtdActual >= mtdTarget) achievedCount++; else missedCount++;
        totalMtdTarget += mtdTarget; totalMtdActual += mtdActual;

        // Merchant Name بييجي من شيت الـ Main عن طريق الـ Merchant ID (TAGER_ID)
        const merchantName = ((state.merchantInfoMap || new Map()).get(plan.tagerId) || {}).merchantName || plan.tagerId;

        return {
            ...plan, ...metrics, merchantName, gap, runRate, dailyTarget, mtdTarget, mtdActual, mtdAchievedPct,
            wowDiff, wowPct, wowStatus, wowClass, wowIcon, finalStatus
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
            d.singleId.toLowerCase().includes(q) ||
            d.singleName.toLowerCase().includes(q) ||
            d.fullName.toLowerCase().includes(q) ||
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

// دالة الرسم
function renderMpSalesPlanTable(data) {
    const tbody = $("mpSalesPlanTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    data.forEach(m => {
        const tr = document.createElement("tr");
        const mtdColor = m.mtdActual >= m.mtdTarget ? 'green' : 'red';
        tr.innerHTML = `
            <td class="font-mono text-dim">${m.singleId}</td>
            <td class="font-bold" style="max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${m.singleName}">${m.singleName}</td>
            <td class="font-mono text-dim">${m.tagerId}</td>
            <td class="truncate-cell" title="${m.merchantName}">${m.merchantName}</td>
            <td class="font-bold">${m.fullName}</td>
            <td class="num text-dim font-bold">${Number(m.dailyTarget).toFixed(1)}</td>
            <td class="num text-orange font-bold">${fmtIntCell(Math.round(m.mtdTarget))}</td>
            <td class="num text-blue font-bold">${fmtIntCell(m.mtdActual)}</td>
            <td class="num text-green font-bold">${fmtMoneyCompactCell(m.deliveredGmv)}</td>
            <td class="num"><span class="badge-outline ${mtdColor}">${fmtPctCell(m.mtdAchievedPct)}</span></td>
            <td class="num text-red font-bold">${fmtIntCell(m.gap > 0 ? Math.round(m.gap) : 0)}</td>
            <td class="num text-blue">${fmtIntCell(Math.round(m.runRate))}</td>
            <td class="center"><span class="badge-status ${m.wowClass}">${m.wowIcon} ${m.wowStatus} ${m.wowPct > 0 ? '+' : ''}${m.wowPct.toFixed(1)}% (${m.wowDiff > 0 ? '+' : ''}${m.wowDiff})</span></td>
            <td class="center"><span class="badge-outline ${m.finalStatus.cls}">${m.finalStatus.text}</span></td>
        `;
        tbody.appendChild(tr);
    });
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

function computeCommercialDebundlized() {
  const { productMap, singlesList, stockBySingle } = buildDebundleProductMap(state.debundleMap, state.cogsMap);

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

  // إجمالي حقيقي غير مكرر لكل صف مرة واحدة بس (مش لكل Single جوه البندل)، عشان
  // التوتال ده يمثل نفس أرقام الأوفرفيو الحقيقية ومينفعش يبقى أكبر من الكل.
  let overallDeliveredGmv = 0, overallCm3 = 0;

  rows.forEach(r => {
    if (!r.sku) return;
    const mappings = productMap.get(r.sku);
    if (!mappings || !mappings.length) return; // مش جزء من خريطة الديبندلايز خالص
    const rDate = new Date(r.timestamp); rDate.setHours(0, 0, 0, 0); const rTime = rDate.getTime();

    // التوتال بتاع الفلوس (Delivered GMV / CM3) بتاع الصف/الأوردر ده بيتحسب مرة واحدة بس
    // هنا (زي أي مكان تاني في الداشبورد)، مش لكل Single جوه البندل — عشان منضاعفهوش.
    overallDeliveredGmv += r.deliveredGmv;
    if (isCm3RowEligible(r, cm3CutoffTs)) overallCm3 += r.cm3;

    // بندل ممكن يحتوي على أكتر من Single SKU مختلف — لازم نوزع الديماند (القطع) بتاعه
    // على كل واحد فيهم (كل واحد بالـ quantity الخاصة بيه)، مش واحد بس.
    mappings.forEach(mapping => {
      const qty = mapping.quantity || 1;
      const b = getBucket(mapping.singleId);
      b.placed += r.placedPieces * qty; b.confirmed += r.confirmedPieces * qty; b.delivered += r.deliveredPieces * qty;
      if (rTime >= d3Ms) b.conf3d += r.confirmedPieces * qty; // ديماند الـ Single (ديبندلايز) آخر 3 أيام
      if (isRowEligibleForLag(r, crCutoffTs)) { b.crPlaced += r.placedPieces * qty; b.crConfirmed += r.confirmedPieces * qty; }
      if (isRowEligibleForLag(r, cm3CutoffTs)) { b.drConfirmed += r.confirmedPieces * qty; b.drDelivered += r.deliveredPieces * qty; }
      // GMV/CM3/PPM الخاصة بالـ Single: مش بناخد قيمة الأوردر كاملة (ده كان بيضاعفها لو
      // البندل فيه أكتر من Single)، ولا بنوزعها بالقطع — بنوزعها بنفس منطق الملف
      // المرجعي (BUNDLE TABLE): وزن الـ COGS بتاع الـ Single ده داخل نفس البندل
      // (mapping.cogsWeight) × قيمة الأوردر الكاملة، بنفس الكات أوف بتاع الـ CM3.
      if (isCm3RowEligible(r, cm3CutoffTs)) {
        const weight = mapping.cogsWeight || 0;
        b.deliveredGmv += r.deliveredGmv * weight;
        b.cm3 += r.cm3 * weight;
        b.ppm += (r.ppm || 0) * weight;
        b.cm3Gmv += r.deliveredGmv * weight;
      }
    });
  });

  const targets = state.singleSkuTargets || {};
  const result = [];
  singlesList.forEach((singleName, singleId) => {
    const b = buckets.get(singleId) || { placed: 0, confirmed: 0, delivered: 0, deliveredGmv: 0, cm3: 0, cm3Gmv: 0, ppm: 0, crPlaced: 0, crConfirmed: 0, drConfirmed: 0, drDelivered: 0, conf3d: 0 };
    const crPct = b.crPlaced ? (b.crConfirmed / b.crPlaced) * 100 : 0;
    const drPct = b.drConfirmed ? (b.drDelivered / b.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const cm3Pct = b.cm3Gmv ? (b.cm3 / b.cm3Gmv) * 100 : 0;
    // CM3/Piece و PPM/Piece: نفس منطق شيت الـ Single المرجعي (G2=E2/C2، H2=F2/C2)
    // — بيتقسموا على إجمالي القطع المستلمة (DLV Pieces) بتاعة الـ Single ده.
    const cm3PerPiece = b.delivered ? (b.cm3 / b.delivered) : 0;
    const ppmPerPiece = b.delivered ? (b.ppm / b.delivered) : 0;

    const targetInfo = targets[singleId];
    // شيت البلان بيكتب 0 لأي حاجة مش في البلان فعلياً — التارجت لازم يكون > 0
    // عشان نعتبره Single SKU "في البلان"، غير كده بيتعرض Not in Plan.
    const hasTarget = !!(targetInfo && targetInfo.adjustedTarget > 0);
    const dailyTarget = hasTarget ? targetInfo.adjustedTarget : null;
    const mtdTarget = hasTarget ? dailyTarget * daysUntilYesterday : null;
    const mtdActual = b.confirmed; // نفس أساس الـ Adjusted Target (Confirmed)
    const mtdAchPct = (hasTarget && mtdTarget) ? (mtdActual / mtdTarget) * 100 : null;
    // Run Rate: توقع قفل نهاية الشهر بناءً على معدل الأداء الحالي (Confirmed)
    // - نفس المعادلة المستخدمة في باقي أقسام الداشبورد: (MTD Actual ÷ الأيام اللي فاتت) × إجمالي أيام الشهر.
    const runRate = Math.round((mtdActual / elapsedDays) * currentMonthDays);

    // Stock: من عمود G في شيت الديبندلايز (1409034448) — الاستوك الخاص بالـ SINGLE_ID.
    // DOH = Stock ÷ Avg Last 3 Days Confirmed (ديبندلايز، على مستوى الـ Single ككل).
    const stock = stockBySingle.has(singleId) ? stockBySingle.get(singleId) : (state.inventoryMap[singleId] ? state.inventoryMap[singleId].stock : 0);
    const avg3dConfirmed = b.conf3d / 3;
    const doh = avg3dConfirmed > 0 ? Math.round(stock / avg3dConfirmed) : Math.round(stock || 0);

    result.push({
      singleId, singleName,
      category: (targetInfo && targetInfo.category) || (state.inventoryMap[singleId] ? state.inventoryMap[singleId].category : "") || "Uncategorized",
      stock: Math.round(stock || 0), doh,
      hasTarget, dailyTarget, mtdTarget, mtdActual, mtdAchPct, runRate,
      totalPlaced: b.placed, totalConfirmed: b.confirmed, totalDelivered: b.delivered,
      crPct, drPct, ndrPct, deliveredGmv: b.deliveredGmv, cm3: b.cm3, cm3Pct, cm3PerPiece, ppm: b.ppm, ppmPerPiece
    });
  });
  return { rows: result, overallDeliveredGmv, overallCm3 };
}

function prepareCommercialDebundlizedData() {
  const computed = computeCommercialDebundlized();
  state.cdzDataPrepared = computed.rows;

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
    const targetCell = m.hasTarget ? fmtIntCell(Math.round(m.mtdTarget)) : `<span class="badge-outline orange">Not in Plan</span>`;
    const dailyCell = m.hasTarget ? Number(m.dailyTarget).toFixed(1) : "—";
    const achCell = (m.hasTarget && m.mtdAchPct !== null) ? `<span class="badge-outline ${m.mtdAchPct >= 100 ? 'green' : (m.mtdAchPct >= 85 ? 'orange' : 'red')}">${fmtPctCell(m.mtdAchPct)}</span>` : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim" style="white-space:nowrap;">${m.singleId}</td>
      <td class="font-bold truncate-cell" title="${m.singleName}">${m.singleName}</td>
      <td class="text-dim truncate-cell" style="max-width:110px;" title="${m.category}">${m.category}</td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.stock))}</td>
      <td class="num font-bold text-dim">${fmtIntCell(Math.round(m.doh))}</td>
      <td class="num text-orange font-bold">${targetCell}</td>
      <td class="num text-dim">${dailyCell}</td>
      <td class="num text-blue font-bold">${fmtIntCell(m.mtdActual)}</td>
      <td class="num">${achCell}</td>
      <td class="num font-bold text-green">${fmtIntCell(m.runRate)}</td>
      <td class="num">${fmtIntCell(m.totalPlaced)}</td>
      <td class="num">${fmtIntCell(m.totalConfirmed)}</td>
      <td class="num">${fmtIntCell(m.totalDelivered)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPctCell(m.crPct)}</span></td>
      <td class="num text-dim">${fmtPctCell(m.drPct)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPctCell(m.ndrPct)}</span></td>
      <td class="num font-bold text-dim">${fmtMoneyCompactCell(m.deliveredGmv)}</td>
      <td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompactCell(m.cm3)}</td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.cm3PerPiece)}</td>
      <td class="num font-bold text-dim">${fmtMoneyCompactCell(m.ppm)}</td>
      <td class="num text-dim">${fmtMoneyCompactCell(m.ppmPerPiece)}</td>
      <td class="num">${fmtPctCell(m.cm3Pct)}</td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  const totalPages = Math.max(1, Math.ceil(state.cdzFiltered.length / PAGE_SIZE));
  if ($("rowCountCdz")) $("rowCountCdz").textContent = `${fmtInt.format(state.cdzFiltered.length)} Single SKUs`;
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
  if (targets[norm] && targets[norm].targetPpmPieces > 0) return targets[norm].targetPpmPieces;
  return (targets["grand total"] && targets["grand total"].targetPpmPieces) || 0;
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
  { key: "placed", label: "Placed PCS", fmt: "int" },
  { key: "confirmed", label: "Confirmed PCS", fmt: "int" },
  { key: "delivered", label: "Delivered PCS", fmt: "int" },
  { key: "crPct", label: "CR%", fmt: "pct" },
  { key: "drPct", label: "DR%", fmt: "pct" },
  { key: "ndrPct", label: "NDR%", fmt: "pct" },
  { key: "deliveredAsp", label: "Delivered ASP", fmt: "money" },
  { key: "deliveredGmv", label: "Delivered GMV", fmt: "money" },
  { key: "cm3", label: "CM3", fmt: "money" },
  { key: "cm3Pct", label: "CM3%", fmt: "pct" },
  { key: "ppm", label: "Total PPM", fmt: "money" },
  { key: "ppmPerPiece", label: "PPM/Piece", fmt: "money" },
  { key: "ppmActualPct", label: "PPM Actual%", fmt: "pct" },
  { key: "ppmGmvRatio", label: "PPM/GMV%", fmt: "pct" }
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
    // الـ CM3/PPM لوحدهم بيحترموا كات أوف الـ CM3_LAG_DAYS، لأن عمود الربحية في
    // الشيت نفسه بيتأخر تعبيته أيام قبل ما يوصل — ده مش باج، ده طبيعة مصدر الداتا.
    if (isCm3RowEligible(r, cm3Cutoff)) {
      b.cm3 += r.cm3 || 0; b.cm3Gmv += r.deliveredGmv || 0; b.ppm += (r.ppm || 0);
      b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0);
      b.ppmPerPieceWeight += (r.deliveredPieces || 0);
    }
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
      b.cm3 += r.cm3; b.cm3Gmv += r.deliveredGmv; b.ppm += (r.ppm || 0);
      // PPM_PER_PIECE (عمود AD) بيتقرا مباشرة من الشيت مش بيتحسب — بنعمله Weighted Average
      // على أساس الـ Delivered Pieces بتاعة كل صف عشان نجمع أكتر من صف/تاجر لنفس الـ SKU صح.
      b.ppmPerPieceWeighted += (r.ppmPerPiece || 0) * (r.deliveredPieces || 0);
      b.ppmPerPieceWeight += (r.deliveredPieces || 0);
    }

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
      if (b && (b.placed > 0 || b.deliveredGmv > 0)) found.push(b);
    }
    return [found[0] || null, found[1] || null];
  }

  const products = [];
  skuMap.forEach(s => {
    const curr = metricsFor(latestPeriod ? s.periods.get(latestPeriod) : null);
    if (curr.placed === 0 && curr.deliveredGmv === 0) return; // مفيش نشاط في آخر Period، اتجاهل
    const [wLatest, wPrev] = findLastTwoWeeksWithData(deltaSkuMap.get(s.sku));
    let deltaCm3Pct = null, prevCm3PctForDisplay = null;
    if (wLatest && wPrev) {
      const latestCm3Pct = wLatest.cm3Gmv ? (wLatest.cm3 / wLatest.cm3Gmv) * 100 : 0;
      const prevCm3PctCalc = wPrev.cm3Gmv ? (wPrev.cm3 / wPrev.cm3Gmv) * 100 : 0;
      deltaCm3Pct = latestCm3Pct - prevCm3PctCalc;
      prevCm3PctForDisplay = prevCm3PctCalc;
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
      prevCm3Pct: hasPrev ? prevCm3PctForDisplay : null, deltaCm3Pct,
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
  const th = (key, label, extraClass) => `<th class="${extraClass || ""}" style="cursor:pointer;" title="Click to sort" onclick="sortCm3apSeries('${key}')">${label}${cm3apSeriesSortArrow(key)}</th>`;
  let headHtml = th("sku", "SKU") + th("skuName", "SKU Name", "truncate-cell") + th("category", "Category", "truncate-cell");
  periodLabels.forEach((label, pIdx) => {
    const pColClass = `cm3ap-pcol-${pIdx % 4}`;
    CM3AP_SERIES_METRICS.forEach(m => { headHtml += th(`${pIdx}|${m.key}`, `${m.label} ${label}`, `num ${pColClass}`); });
  });
  headHtml += th("targetPpm", "Target PPM", "num text-orange");
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

function renderCm3apInsights(products, meta) {
  const box = $("cm3apInsights"); if (!box) return;
  if (!products.length) { box.innerHTML = `<div class="text-dim">No qualifying data for this period.</div>`; return; }

  const qualifying = products.filter(p => p.placed >= CM3_MIN_PLACED_PIECES);
  const withDelta = qualifying.filter(p => p.deltaCm3Pct !== null);
  const topGainers = [...withDelta].sort((a, b) => b.deltaCm3Pct - a.deltaCm3Pct).slice(0, 4);
  const topDecliners = [...withDelta].sort((a, b) => a.deltaCm3Pct - b.deltaCm3Pct).slice(0, 4);
  const fixList = qualifying.filter(p => p.status === "Fix PPM").sort((a, b) => (a.ppmActualPct ?? 0) - (b.ppmActualPct ?? 0)).slice(0, 5);
  const negativeCm3 = qualifying.filter(p => p.cm3 < 0).length;

  const listItem = (p, valueHtml) => `<li><span class="font-mono text-dim">${p.sku}</span>${p.skuName ? `<span class="cm3ap-insight-name" title="${p.skuName}">${p.skuName}</span>` : ""} <span class="text-dim">(${p.category})</span> — ${valueHtml}</li>`;

  let html = `<div class="cm3ap-insights-grid">`;
  html += `<div class="cm3ap-insight-card"><h4 class="text-green">Top CM3% Gainers</h4><ul>${
    topGainers.length ? topGainers.map(p => listItem(p, cm3apDeltaBadge(p.deltaCm3Pct))).join("") : `<li class="text-dim">No period-over-period data yet.</li>`
  }</ul></div>`;
  html += `<div class="cm3ap-insight-card"><h4 class="text-red">Top CM3% Decliners</h4><ul>${
    topDecliners.length ? topDecliners.map(p => listItem(p, cm3apDeltaBadge(p.deltaCm3Pct))).join("") : `<li class="text-dim">No period-over-period data yet.</li>`
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
  const qualifying = products.filter(p => p.placed >= CM3_MIN_PLACED_PIECES && p.deltaCm3Pct !== null);
  const topPositive = [...qualifying].sort((a, b) => b.deltaCm3Pct - a.deltaCm3Pct).slice(0, 4);
  const topDrops = [...qualifying].sort((a, b) => a.deltaCm3Pct - b.deltaCm3Pct).slice(0, 4);
  const maxAbs = Math.max(1, ...qualifying.map(p => Math.abs(p.deltaCm3Pct)));

  const row = (p, colorVar) => {
    const width = Math.min(100, (Math.abs(p.deltaCm3Pct) / maxAbs) * 100);
    return `<div class="cm3ap-mover-row">
      <div class="cm3ap-mover-info">
        <div class="cm3ap-mover-sku">${p.sku}${p.skuName ? `<span class="cm3ap-mover-name" title="${p.skuName}"> ${p.skuName}</span>` : ""}<span class="cm3ap-mover-cat"> · ${p.category}</span></div>
        <div class="cm3ap-mover-bar-track"><div class="cm3ap-mover-bar-fill" style="width:${width}%; background:${colorVar};"></div></div>
      </div>
      <div class="cm3ap-mover-value" style="color:${colorVar};">${p.deltaCm3Pct >= 0 ? "+" : ""}${p.deltaCm3Pct.toFixed(1)}%</div>
    </div>`;
  };

  box.innerHTML = `
    <div class="cm3ap-mover-col">
      <h4 class="text-green">Top 4 Positive (CM3% &Delta;)</h4>
      ${topPositive.length ? topPositive.map(p => row(p, "#10b981")).join("") : `<div class="text-dim" style="font-size:12px;">No period-over-period data yet.</div>`}
    </div>
    <div class="cm3ap-mover-col">
      <h4 class="text-red">Top 4 Drops (CM3% &Delta;)</h4>
      ${topDrops.length ? topDrops.map(p => row(p, "#ef4444")).join("") : `<div class="text-dim" style="font-size:12px;">No period-over-period data yet.</div>`}
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
    if (isCm3RowEligible(r, cm3Cutoff)) { e.cm3 += r.cm3; e.cm3Gmv += r.deliveredGmv; }
    productConfirmedTotals.set(r.sku, (productConfirmedTotals.get(r.sku) || 0) + r.confirmedPieces);
  });

  let totalGmv = 0, totalCm3 = 0;
  mpMatchesState.data = Array.from(map.values()).map(e => {
    const crPct = e.crPlaced ? (e.crConfirmed / e.crPlaced) * 100 : 0;
    const drPct = e.drConfirmed ? (e.drDelivered / e.drConfirmed) * 100 : 0;
    const ndrPct = (crPct * drPct) / 100;
    const productTotalConfirmed = productConfirmedTotals.get(e.productId) || 0;
    const contrPct = productTotalConfirmed ? (e.totalConfirmed / productTotalConfirmed) * 100 : 0;
    const placedAsp = e.totalPlaced ? (e.placedGmv / e.totalPlaced) : 0;
    const cm3PerPiece = e.totalDelivered ? (e.cm3 / e.totalDelivered) : 0;
    const cm3Pct = e.cm3Gmv ? (e.cm3 / e.cm3Gmv) * 100 : 0;
    totalGmv += e.deliveredGmv; totalCm3 += e.cm3;
    return { ...e, crPct, drPct, ndrPct, contrPct, placedAsp, cm3PerPiece, cm3Pct };
  });

  if($("mpMatchesTotal")) $("mpMatchesTotal").textContent = fmtInt.format(mpMatchesState.data.length);
  if($("mpMatchesTotalGmv")) $("mpMatchesTotalGmv").textContent = fmtMoneyCompact(totalGmv);
  if($("mpMatchesTotalCm3")) $("mpMatchesTotalCm3").textContent = fmtMoneyCompact(totalCm3);

  applyMpMatchesSearchAndSort();
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
  // STOCK & DOH — بنفس مصدر ونفس معادلة Commercial Debundlized بالظبط:
  // STOCK من عمود G في شيت الديبندلايز (PRODUCTS_DEBUNDLE_MAP_GID)، وDOH =
  // Stock ÷ متوسط آخر 3 أيام Confirmed. هنا مفيش داعي لأي ديبندلايز/بندل
  // لأن الداتا في لوحة الـ Sellthrough سينجل SKU أصلاً، فبنقرأ الاستوك
  // والكونفيرمد على مستوى نفس الـ SKU مباشرة.
  // ---------------------------------------------------------------------
  const stockBySingle = new Map();
  (state.debundleMap || []).forEach(r => {
    if (r.singleId && r.stock && !stockBySingle.has(r.singleId)) stockBySingle.set(r.singleId, r.stock);
  });

  const mainRows = state.allParsedRows || [];
  let mainLatestTs = 0;
  mainRows.forEach(r => { if (r.timestamp > mainLatestTs) mainLatestTs = r.timestamp; });
  const mainToday = new Date(mainLatestTs); mainToday.setHours(0, 0, 0, 0);
  const mainD3Ms = mainToday.getTime() - (3 * 86400000);
  const conf3dBySku = new Map();
  mainRows.forEach(r => {
    if (!r.sku || r.timestamp < mainD3Ms) return;
    conf3dBySku.set(r.sku, (conf3dBySku.get(r.sku) || 0) + (r.confirmedPieces || 0));
  });

  _stIndexCache = {
    _fp: fp,
    productInfo, inboundBySkuMonth, inboundFirstBuyMonth, inboundLastRec, inboundNameCat,
    beginInvBySkuMonth, beginInvNameCat, needBySkuMonth, needNameCat,
    skuByMonthInbound, skuByMonthBegInv, skuByMonthNeed,
    stockBySingle, conf3dBySku
  };
  return _stIndexCache;
}

function recomputeSellthroughRows() {
  const { begInv: begInvKey, startSale: startKey, endSale: endKey } = state.stFilters;
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
    stockBySingle, conf3dBySku
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

    // Stock/DOH: نفس المصدر بتاع Commercial Debundlized (عمود G في شيت
    // الديبندلايز)، وDOH = Stock ÷ متوسط آخر 3 أيام Confirmed من MAIN_GID.
    const stock = stockBySingle.has(sku) ? stockBySingle.get(sku) : (state.inventoryMap[sku] ? state.inventoryMap[sku].stock : 0);
    const avg3dConfirmed = (conf3dBySku.get(sku) || 0) / 3;
    const doh = avg3dConfirmed > 0 ? Math.round(stock / avg3dConfirmed) : Math.round(stock || 0);

    rows.push({
      sku,
      name: info.name || "Unknown",
      cat: info.cat || "Uncategorized",
      lastRecDate: lastRec ? lastRec.text : "-",
      cnfQty, dlvQty, begInv, begSales, remBeg,
      rtos, retSales, remPurSales, totPur, purSales,
      stRate, soldInb, firstBuy,
      cBegSales, cRemBeg, cRetSales, cRemPurSales, cPurSales,
      stock: Math.round(stock || 0), doh
    });
  });

  state.sellthroughDataPrepared = rows;
  applySellthroughFiltersAndSort();
  renderSellthroughSummaries(rows);
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

function prepareSellthroughData() {
  populateSellthroughFilters();
  recomputeSellthroughRows();
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
  target: () => 18,
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
  target: () => 17, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Champions" }, SEG_PANEL_MONTH),
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
  target: () => 4, actual: (ctx) => ctx.sum("count", { status: "promoted from loyals to champions" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
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
  target: () => 3, actual: (ctx) => ctx.sum("count", { status: "Churned from loyals" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.T("r29"), ctx.A("r29")) }) });
segDefRow({ id: "r30", section: "Loyal MVM", label: "Demoted -", unit: "count",
  target: (ctx) => ctx.T("r31") + ctx.T("r32") + ctx.T("r33"), actual: (ctx) => ctx.A("r31") + ctx.A("r32"),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.T("r30"), ctx.A("r30")) }) });
segDefRow({ id: "r31", section: "Loyal MVM", label: "Demoted to potential loyal MVM", unit: "count", sub: true,
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Demoted from loyals to potential loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r32", section: "Loyal MVM", label: "Demoted to LVM", unit: "count", sub: true,
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Demoted from loyals to LVM" }, SEG_PANEL_MONTH), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r33", section: "Loyal MVM", label: "Promoted to Champions -", unit: "count",
  target: () => 4, actual: (ctx) => ctx.A("r13"), ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r33"), ctx.T("r33")) }) });
segDefRow({ id: "r34", section: "Loyal MVM", label: "Retained", unit: "count",
  target: () => 18, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r34"), ctx.T("r34")) }) });
segDefRow({ id: "r35", section: "Loyal MVM", label: "Demoted from Champions +", unit: "count",
  target: () => 1, actual: (ctx) => ctx.A("r6"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r36", section: "Loyal MVM", label: "Re-activated +", unit: "count",
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Re-activated", subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r36"), ctx.T("r36")) }) });
segDefRow({ id: "r37", section: "Loyal MVM", label: "New +", unit: "count",
  target: () => 8, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Loyal" }, SEG_PANEL_MONTH),
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
  target: () => 600, actual: (ctx) => safeRatio(ctx.A("r43"), ctx.A("r41")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r44"), ctx.T("r44")) }) });
segDefRow({ id: "r45", section: "Loyal MVM", label: "Confirmed GMV", unit: "money",
  target: (ctx) => ctx.T("r43") * ctx.T("r46"), actual: (ctx) => ctx.sum("cnfGmv", { subSegment: "Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r45"), ctx.T("r45")) }) });
segDefRow({ id: "r46", section: "Loyal MVM", label: "Confirmed AOV", unit: "money",
  target: () => 850, actual: (ctx) => safeRatio(ctx.A("r45"), ctx.A("r43")) || 0,
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
  target: () => 840, actual: (ctx) => safeRatio(ctx.A("r49"), ctx.A("r47")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r50"), ctx.T("r50")) }) });

// ---- Potential Loyal MVM ------------------------------------------------
segDefRow({ id: "r53", section: "Potential Loyal MVM", label: "Last month merchants", unit: "count", top: true,
  target: (ctx) => ctx.A("r66", SEG_PANEL_PREV_MONTH), actual: (ctx) => ctx.sum("count", { subSegment: "Potential Loyal" }, SEG_PANEL_PREV_MONTH),
  ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r54", section: "Potential Loyal MVM", label: "Churned -", unit: "count",
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Churned from potential loyals" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 1 }) });
segDefRow({ id: "r55", section: "Potential Loyal MVM", label: "Demoted -", unit: "count",
  target: () => 5, actual: (ctx) => ctx.sum("count", { status: "Demoted from potential loyals to LVM" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 0 }) });
segDefRow({ id: "r56", section: "Potential Loyal MVM", label: "Promoted to higher segments -", unit: "count",
  target: (ctx) => ctx.T("r57") + ctx.T("r58"), actual: (ctx) => ctx.A("r57") + ctx.A("r58"), ach: () => ({ kind: "literal", ratio: 0 }) });
segDefRow({ id: "r57", section: "Potential Loyal MVM", label: "Promoted to Champions", unit: "count", sub: true,
  target: () => 0, actual: (ctx) => ctx.A("r14"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r58", section: "Potential Loyal MVM", label: "Promoted to Loyal MVM", unit: "count", sub: true,
  target: () => 1, actual: (ctx) => ctx.A("r39"), ach: () => ({ kind: "dash" }) });
segDefRow({ id: "r59", section: "Potential Loyal MVM", label: "Retained", unit: "count",
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "Retained", subSegment: "Potential Loyal" }, SEG_PANEL_MONTH),
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
  target: () => 2, actual: (ctx) => ctx.sum("count", { status: "New merchant", subSegment: "Potential Loyal" }, SEG_PANEL_MONTH), ach: () => ({ kind: "literal", ratio: 1 }) });
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
  target: () => 214, actual: (ctx) => safeRatio(ctx.A("r68"), ctx.A("r66")) || 0,
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
  target: () => 0.48, actual: (ctx) => safeRatio(ctx.A("r72"), ctx.A("r68")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r73"), ctx.T("r73")) }) });
segDefRow({ id: "r74", section: "Potential Loyal MVM", label: "Delivered GMV", unit: "money",
  target: (ctx) => ctx.T("r72") * ctx.T("r75"), actual: (ctx) => ctx.sum("dlvGmv", { subSegment: "Potential Loyal" }, SEG_PANEL_MONTH),
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r74"), ctx.T("r74")) }) });
segDefRow({ id: "r75", section: "Potential Loyal MVM", label: "Delivered AOV", unit: "money",
  target: () => 904, actual: (ctx) => safeRatio(ctx.A("r74"), ctx.A("r72")) || 0,
  ach: (ctx) => ({ kind: "pct", ratio: safeRatio(ctx.A("r75"), ctx.T("r75")) }) });

// ---- LVM (Low Value / Occasional / Promising) --------------------------
// كل صفوف الـ % هنا (ما عدا الصفوف اللي بتجمّع صفوف تانية) بتتقسم على رقم
// ثابت واحد (Total merchants بتاع شهر أبريل) — بالظبط زي خلية $I$78 في شيت
// الإكسيل الأصلي (مرجع ثابت مش بيتغير مع الشهر).
segDefRow({ id: "r78", section: "LVM", label: "Last month merchants", unit: "count", top: true,
  target: () => 411, actual: (ctx) => ctx.A("r79") + ctx.A("r80") + ctx.A("r81"), ach: () => ({ kind: "dash" }) });
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
  SALES_PLAN_PERF_GID, NEW_SEGMENTATION_GID, INBOUND_GID,
  PRODUCTS_INFO_GID, BEGIN_INV_GID, SELLTHROUGH_NEEDED_GID,
  PRODUCTS_DEBUNDLE_MAP_GID, SINGLE_SKU_TARGETS_GID, COGS_GID
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
  [CAT_TARGETS_GID]: "Category Targets", [ACM_SALES_PLAN_GID]: "Sales Plan",
  [SALES_PLAN_PERF_GID]: "Sales Plan Performance", [NEW_SEGMENTATION_GID]: "New Segmentation",
  [INBOUND_GID]: "Inbound", [PRODUCTS_INFO_GID]: "Products Info",
  [BEGIN_INV_GID]: "Beginning Inventory", [SELLTHROUGH_NEEDED_GID]: "Sell-through Needed",
  [PRODUCTS_DEBUNDLE_MAP_GID]: "Products Debundle Map", [SINGLE_SKU_TARGETS_GID]: "Single SKU Targets",
  [COGS_GID]: "COGS"
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
      salesPlanPerfPayload, newSegPayload, inboundPayload,
      prodInfoPayload, begInvPayload, sellthroughNeededPayload,
      debundleMapPayload, singleSkuTargetsPayload, cogsPayload
    ] = await Promise.all([
      loadSheetWithRetry(MAIN_GID),
      TARGETS_GID && TARGETS_GID !== " " ? loadSheetWithRetry(TARGETS_GID).catch(track(TARGETS_GID)) : Promise.resolve(null),
      SEGMENTATION_GID ? loadSheetWithRetry(SEGMENTATION_GID).catch(track(SEGMENTATION_GID)) : Promise.resolve(null),
      TARGETS_ACM_GID && TARGETS_ACM_GID !== " _Targets_ACM_ " ? loadSheetWithRetry(TARGETS_ACM_GID).catch(track(TARGETS_ACM_GID)) : Promise.resolve(null),
      INVENTORY_GID ? loadSheetWithRetry(INVENTORY_GID).catch(track(INVENTORY_GID)) : Promise.resolve(null),
      PRODUCTS_GID ? loadSheetWithRetry(PRODUCTS_GID).catch(track(PRODUCTS_GID)) : Promise.resolve(null),
      CAT_TARGETS_GID ? loadSheetWithRetry(CAT_TARGETS_GID).catch(track(CAT_TARGETS_GID)) : Promise.resolve(null),
      ACM_SALES_PLAN_GID ? loadSheetWithRetry(ACM_SALES_PLAN_GID).catch(track(ACM_SALES_PLAN_GID)) : Promise.resolve(null),
      SALES_PLAN_PERF_GID ? loadSheetWithRetry(SALES_PLAN_PERF_GID).catch(track(SALES_PLAN_PERF_GID)) : Promise.resolve(null),
      NEW_SEGMENTATION_GID ? loadSheetWithRetry(NEW_SEGMENTATION_GID).catch((err) => { newSegLoadError = err.message || String(err); staleGids.push(NEW_SEGMENTATION_GID); return null; }) : Promise.resolve(null),
      INBOUND_GID ? loadSheetWithRetry(INBOUND_GID).catch(track(INBOUND_GID)) : Promise.resolve(null),
      loadSheetWithRetry(PRODUCTS_INFO_GID).catch(track(PRODUCTS_INFO_GID)),
      loadSheetWithRetry(BEGIN_INV_GID).catch(track(BEGIN_INV_GID)),
      loadSheetWithRetry(SELLTHROUGH_NEEDED_GID).catch(track(SELLTHROUGH_NEEDED_GID)),
      PRODUCTS_DEBUNDLE_MAP_GID ? loadSheetWithRetry(PRODUCTS_DEBUNDLE_MAP_GID).catch(track(PRODUCTS_DEBUNDLE_MAP_GID)) : Promise.resolve(null),
      SINGLE_SKU_TARGETS_GID ? loadSheetWithRetry(SINGLE_SKU_TARGETS_GID).catch(track(SINGLE_SKU_TARGETS_GID)) : Promise.resolve(null),
      COGS_GID ? loadSheetWithRetry(COGS_GID).catch(track(COGS_GID)) : Promise.resolve(null)
    ]);
    sheets = {
      [MAIN_GID]: mainPayload, [TARGETS_GID]: targetsPayload, [SEGMENTATION_GID]: segPayload,
      [TARGETS_ACM_GID]: acmTargetsPayload, [INVENTORY_GID]: invPayload, [PRODUCTS_GID]: prodPayload,
      [CAT_TARGETS_GID]: catTargetsPayload, [ACM_SALES_PLAN_GID]: planPayload,
      [SALES_PLAN_PERF_GID]: salesPlanPerfPayload, [NEW_SEGMENTATION_GID]: newSegPayload,
      [INBOUND_GID]: inboundPayload, [PRODUCTS_INFO_GID]: prodInfoPayload,
      [BEGIN_INV_GID]: begInvPayload, [SELLTHROUGH_NEEDED_GID]: sellthroughNeededPayload,
      [PRODUCTS_DEBUNDLE_MAP_GID]: debundleMapPayload, [SINGLE_SKU_TARGETS_GID]: singleSkuTargetsPayload,
      [COGS_GID]: cogsPayload
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
  const salesPlanPerfPayload = sheets[SALES_PLAN_PERF_GID];
  const newSegPayload = sheets[NEW_SEGMENTATION_GID];
  const inboundPayload = sheets[INBOUND_GID];
  const prodInfoPayload = sheets[PRODUCTS_INFO_GID];
  const begInvPayload = sheets[BEGIN_INV_GID];
  const sellthroughNeededPayload = sheets[SELLTHROUGH_NEEDED_GID];
  const debundleMapPayload = sheets[PRODUCTS_DEBUNDLE_MAP_GID];
  const singleSkuTargetsPayload = sheets[SINGLE_SKU_TARGETS_GID];
  const cogsPayload = sheets[COGS_GID];
  if (sheets.__newSegLoadError) newSegLoadError = sheets.__newSegLoadError;

  const allParsedRows = parseMainSheet(mainPayload);
  if (allParsedRows.length === 0) { throw new Error("No data streams detected."); }

  return {
    allParsedRows,
    merchantTargets: targetsPayload ? parseTargetsSheet(targetsPayload) : state.merchantTargets,
    merchantSegmentsMap: segPayload ? parseSegmentationSheet(segPayload) : state.merchantSegmentsMap,
    acmTargets: acmTargetsPayload ? parseAcmTargetsSheet(acmTargetsPayload) : state.acmTargets,
    inventoryMap: invPayload ? parseInventorySheet(invPayload) : state.inventoryMap,
    productsMap: prodPayload ? parseProductsSheet(prodPayload) : state.productsMap,
    categoryTargets: catTargetsPayload ? parseCategoryTargetsSheet(catTargetsPayload) : state.categoryTargets,
    commercialTargets: catTargetsPayload ? parseCommercialTargetsSheet(catTargetsPayload) : state.commercialTargets,
    acmSalesPlanData: planPayload ? parseAcmSalesPlanSheet(planPayload) : state.acmSalesPlanData, // <-- إضافة البيانات
    salesPlanPerfRows: salesPlanPerfPayload ? parseSalesPlanPerformanceSheet(salesPlanPerfPayload) : state.salesPlanPerfRows, // <-- برفورمانس الـ Sales Plan
    newSegRows: newSegPayload ? parseNewSegmentationSheet(newSegPayload) : state.newSegRows, // <-- Segmentation Panel (Admin Panel)
    newSegLoadError: newSegPayload ? null : (newSegLoadError || state.newSegLoadError || "Could not load GID " + NEW_SEGMENTATION_GID + "."),
    inboundRows: inboundPayload ? parseInboundSheet(inboundPayload) : state.inboundRows,
    metabaseProductsInfo: prodInfoPayload ? parseProductsInfoSheet(prodInfoPayload) : state.metabaseProductsInfo,
    metabaseBeginningInventory: begInvPayload ? parseBeginningInventorySheet(begInvPayload) : state.metabaseBeginningInventory,
    metabaseSellthroughNeeded: sellthroughNeededPayload ? parseSellthroughNeededSheet(sellthroughNeededPayload) : state.metabaseSellthroughNeeded,
    debundleMap: debundleMapPayload ? parseDebundleMapSheet(debundleMapPayload) : state.debundleMap, // <-- Commercial Debundlized
    singleSkuTargets: singleSkuTargetsPayload ? parseSingleSkuTargetsSheet(singleSkuTargetsPayload) : state.singleSkuTargets,
    cogsMap: cogsPayload ? parseCogsSheet(cogsPayload) : state.cogsMap, // <-- Commercial Debundlized (وزن الـ Single داخل البندل)
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

  let sumRcvQty = 0, maxRcvTs = 0;
  inbound.forEach(r => { sumRcvQty += r.rcvQty || 0; if (r.rcvTs > maxRcvTs) maxRcvTs = r.rcvTs; });

  let sumBegQty = 0;
  begInv.forEach(r => { sumBegQty += r.QTY || 0; });

  let sumCnf = 0, sumDlv = 0, sumRto = 0;
  need.forEach(r => { sumCnf += r.CNF_QTY || 0; sumDlv += r.DLV_QTY || 0; sumRto += r.RTO_QTY || 0; });

  return [
    inbound.length, Math.round(sumRcvQty), maxRcvTs,
    begInv.length, Math.round(sumBegQty),
    need.length, Math.round(sumCnf), Math.round(sumDlv), Math.round(sumRto),
    prodInfo.length
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
  state.salesPlanPerfRows = snapshot.salesPlanPerfRows;
  state.newSegRows = snapshot.newSegRows || [];
  state.newSegLoadError = snapshot.newSegLoadError || null;
  state.inboundRows = snapshot.inboundRows || [];
  state.metabaseProductsInfo = snapshot.metabaseProductsInfo || [];
  state.metabaseBeginningInventory = snapshot.metabaseBeginningInventory || [];
  state.metabaseSellthroughNeeded = snapshot.metabaseSellthroughNeeded || [];
  state.debundleMap = snapshot.debundleMap || [];
  state.singleSkuTargets = snapshot.singleSkuTargets || {};
  state.cogsMap = snapshot.cogsMap || state.cogsMap || new Map();
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
    const tables = activeView.querySelectorAll(".data-table");
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
        cdz: state.cdzPage,
        cm3ap: cm3apState.page
    };
    
    // Set to page 0 and max size
    state.page = 0; state.pageMerchant = 0; state.pageSeg = 0; state.pageInventory = 0; analystState.page = 0;
    state.sellthroughPage = 0; mpMatchesState.page = 0; state.cdzPage = 0; cm3apState.page = 0;
    PAGE_SIZE = 999999; 
    
    if (typeof renderPaginatedInventoryTable === 'function') renderPaginatedInventoryTable();
    if (typeof renderPaginatedAcmTable === 'function') renderPaginatedAcmTable();
    if (typeof renderPaginatedMerchantTable === 'function') renderPaginatedMerchantTable();
    if (typeof renderPaginatedSegTable === 'function') renderPaginatedSegTable();
    if (typeof renderPaginatedCm3AnalystTable === 'function') renderPaginatedCm3AnalystTable();
    if (typeof renderPaginatedSellthroughTable === 'function') renderPaginatedSellthroughTable();
    if (typeof renderPaginatedMpMatchesTable === 'function') renderPaginatedMpMatchesTable();
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
        state.cdzPage = originalPage.cdz;
        cm3apState.page = originalPage.cm3ap;
        
        if (typeof renderPaginatedInventoryTable === 'function') renderPaginatedInventoryTable();
        if (typeof renderPaginatedAcmTable === 'function') renderPaginatedAcmTable();
        if (typeof renderPaginatedMerchantTable === 'function') renderPaginatedMerchantTable();
        if (typeof renderPaginatedSegTable === 'function') renderPaginatedSegTable();
        if (typeof renderPaginatedCm3AnalystTable === 'function') renderPaginatedCm3AnalystTable();
        if (typeof renderPaginatedSellthroughTable === 'function') renderPaginatedSellthroughTable();
        if (typeof renderPaginatedMpMatchesTable === 'function') renderPaginatedMpMatchesTable();
        if (typeof renderPaginatedCdzTable === 'function') renderPaginatedCdzTable();
        if (typeof renderCm3apActiveTable === 'function') renderCm3apActiveTable();
    }, 150);
});

// أي خلية (td/th) فيها رقم/فلوس متحسب بـ fmtIntCell / fmtPctCell /
// fmtMoneyCompactCell / fmtCm3MoneyCell بيبقى جواها span بيلف نفس النص المعروض ومعاه
// data-raw = القيمة الخام زي ما هي (بدون EGP ولا K ولا M ولا % ولا فواصل
// آلاف). هنا بندور على الـ span ده أول حاجة، ولو موجود بننزل الرقم الخام
// زي ما هو (Number مش Text)، وغير كده (خلايا نصوص عادية زي الاسم/الـ ID)
// بنرجع لنفس السلوك القديم (نص جوه quotes).
function downloadTableAsCsv(tableEl, fileName) {
    let csv = [];
    const rows = tableEl.querySelectorAll("tr");
    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll("td, th");
        for (let j = 0; j < cols.length; j++) {
            const rawEl = cols[j].querySelector("[data-raw]");
            if (rawEl) {
                const rawVal = parseFloat(rawEl.getAttribute("data-raw"));
                row.push(Number.isFinite(rawVal) ? String(rawVal) : "0");
            } else {
                let text = cols[j].innerText || cols[j].textContent;
                text = text.replace(/"/g, '""').replace(/(\r\n|\n|\r)/gm, " ");
                row.push('"' + text.trim() + '"');
            }
        }
        csv.push(row.join(","));
    }
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