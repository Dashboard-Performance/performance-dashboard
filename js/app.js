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
  "Core Systems Optimal",
  "Data Streams Encrypted",
  "Live Quantum Connection",
  "Welcome to Command Center"
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
  sellthroughMonthOptions: []
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
  if (unit === "money") return fmtMoneyCompact(value);
  if (unit === "percent") return fmtPct(value * 100);
  return fmtInt.format(Math.round(value));
}
function fmtSegAch(ach) {
  if (!ach || ach.kind === "dash") return `<span class="text-dim">-</span>`;
  if (ach.ratio === null || ach.ratio === undefined || !Number.isFinite(ach.ratio)) return `<span class="text-dim">-</span>`;
  return `<span class="font-bold ${segAchColor(ach.ratio)}">${fmtPct(ach.ratio * 100)}</span>`;
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
const SHEET_LOAD_TIMEOUT_MS = 25000;
// How many attempts (including the first) we make per GID before we
// actually give up on that sheet.
const SHEET_LOAD_MAX_ATTEMPTS = 3;
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
  return loadSheetViaJsonp(gid).catch((err) => {
    if (attemptsLeft <= 1) throw err;
    const delay = SHEET_LOAD_RETRY_BASE_MS * attemptNumber;
    console.warn(`GID ${gid} failed (attempt ${attemptNumber}): ${err.message}. Retrying in ${delay}ms...`);
    return new Promise((resolve) => setTimeout(resolve, delay)).then(() =>
      loadSheetWithRetry(gid, attemptsLeft - 1, attemptNumber + 1)
    );
  });
}

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
      tx.objectStore(IDB_STORE).put({ savedAt: Date.now(), data: snapshot }, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // Not fatal — the app just falls back to always fetching fresh next time.
    console.warn("Cache save failed:", e.message || e);
  }
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
// -------------------------------------------------------------------------
const DRIVE_BACKUP_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxN2rCqUtVV9JRcJdS-er__az_fDhYW8r1YwNgyuc3Kj2Yqrs2FJO2UpiCOq61tmVtM8A/exec";

function backupSnapshotToDrive(snapshot) {
  if (!DRIVE_BACKUP_WEBHOOK_URL) return; // disabled
  try {
    fetch(DRIVE_BACKUP_WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors", // Apps Script doesn't return CORS headers; we don't need to read the response anyway.
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({ savedAt: Date.now(), data: snapshot })
    }).catch((e) => console.warn("Drive backup failed (non-fatal):", e.message));
  } catch (e) {
    console.warn("Drive backup failed (non-fatal):", e.message);
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

function parseMainSheet(payload) {
  const rawRows = payload?.table?.rows ?? [];
  const rows = [];
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
    
    rows.push({
      date: dateStr, monthYear: monthYear, timestamp: isNaN(d.getTime()) ? 0 : d.getTime(),
      merchantId: cellText(c[1]), merchantName: cellText(c[2]), sku: cellText(c[3]), category: cellText(c[5]) || "Uncategorized",
      placedOrders: placedOrders, confirmedOrders: confirmedOrders, deliveredOrders: cellNumber(c[11]),
      placedGmv: placedGmv, deliveredGmv: cellNumber(c[22]), cm3: cellNumber(c[28]),
      acmName: cellText(c[31]) || "Unassigned", confirmedGmv: confirmedGmv,
      placedPieces: cellNumber(c[CM3_PLACED_PIECES_COL]),
      confirmedPieces: cellNumber(c[16]), deliveredPieces: cellNumber(c[17])
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
      map[skuId] = { skuName: cellText(c[1]), stock: cellNumber(c[2]), doh: cellNumber(c[3]), category: cellText(c[4]), availability: cellText(c[5]), isLocked: cellText(c[6]) };
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
        <div class="lb-stats"><div class="lb-ndr">${fmtPct(item.ndr)}</div><div class="lb-orders">${fmtInt.format(item.orders)} orders</div></div>
      `;
      lbContainer.appendChild(li);
    });
  }
  if($("sidebarUpdated")) $("sidebarUpdated").textContent = `Last sync: ${new Date().toLocaleTimeString()}`;
  renderPipelineChart(rows); renderCategoryChart(rows);
  prepareMerchantTableData(rows); prepareAcmTableData(rows); prepareMpSalesPlanData(); prepareInventoryTableData(rows);
  renderOverallAcmTargetsSummary();
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
  return { confirmedOrders: totalConfirmed, deliveredGmv, confirmedGmv, cr: cr * 100, dr: dr * 100, ndr: (dr * cr) * 100, activeSkus: skus.size, activeMerchants: merchants.size };
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
      <td class="num"><span class="badge-outline ${m.stock > 10 ? 'green' : 'red'}">${m.stock}</span></td>
      <td class="num font-bold text-dim">${m.doh}</td>
      <td class="text-dim">${m.category}</td>
      <td><span class="badge-outline ${m.availability === 'Out of Stock' ? 'red' : 'blue'}">${m.availability}</span></td>
      <td class="num font-bold text-blue">${fmtMoneyCompact(m.price)}</td>
      <td class="num font-bold text-green">${fmtMoneyCompact(m.profit)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.cr)}">${fmtPct(m.cr)}</span></td>
      <td class="num text-dim">${fmtPct(m.dr)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPct(m.ndr)}</span></td>
      <td class="num text-light font-bold">${fmtMoneyCompact(m.cm3)}</td>
      <td class="num text-dim">${m.avgPlacedDaily.toFixed(1)}</td>
      <td class="num text-dim">${fmtInt.format(m.placedYday)}</td>
      <td class="num text-blue font-bold">${fmtInt.format(m.confYday)}</td>
      <td class="num text-orange font-bold">${m.avg3d.toFixed(1)}</td>
      <td class="num text-purple font-bold">${m.avg15d.toFixed(1)}</td>
      <td><span class="badge-status ${m.trendColor}">${m.trendStatus}</span></td>
      <td class="text-dim">${m.topMerch}</td>
      <td class="num font-bold">${fmtPct(m.contr5d)}</td>
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
      <td class="num font-bold"><div style="font-weight:600; font-size: 12px; color:var(--${finalColor})">${fmtPct(m.finalScorePct)}</div><div class="progress-bar"><div class="progress-fill ${finalColor}" style="width: ${Math.min(m.finalScorePct, 100)}%"></div></div></td>
      <td class="num text-dim font-bold">${m.targetGmv > 0 ? fmtMoneyCompact(m.targetGmv) : '-'}</td>
      <td class="num text-green font-bold">${fmtMoneyCompact(m.deliveredGmv)}</td>
      <td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${gmvColor})">${m.targetGmv > 0 ? m.achievedPct.toFixed(1) + '%' : 'N/A'}</div><div class="progress-bar"><div class="progress-fill ${gmvColor}" style="width: ${Math.min(m.achievedPct, 100)}%"></div></div></td>
      <td class="num font-bold text-blue">${fmtMoneyCompact(m.runRate)}</td>
      <td class="num text-dim">${m.targetNdr > 0 ? m.targetNdr + '%' : '-'}</td>
      <td class="num"><span class="badge-outline ${m.ndr >= m.targetNdr && m.targetNdr > 0 ? 'green' : 'red'}">${fmtPct(m.ndr)}</span></td>
      <td class="num text-dim">${m.targetCm3 > 0 ? m.targetCm3 + '%' : '-'}</td>
      <td class="num"><span class="badge-outline ${m.cm3Pct >= m.targetCm3 && m.targetCm3 > 0 ? 'green' : 'red'}">${fmtPct(m.cm3Pct)}</span></td>
      <td class="num text-dim font-bold">${m.targetRetention > 0 ? fmtInt.format(m.targetRetention) : '-'}</td>
      <td class="num"><span class="badge-outline ${m.actualRetention >= m.targetRetention && m.targetRetention > 0 ? 'green' : 'red'}">${fmtInt.format(m.actualRetention)}</span></td>
      <td class="num text-dim">${fmtInt.format(m.placed)}</td>
      <td class="num text-blue font-bold">${fmtInt.format(m.confirmed)}</td>
      <td class="num text-dim">${fmtInt.format(m.delivered)}</td>
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
      tr.innerHTML = `<td class="text-dim">#${idx + 1}</td><td class="font-bold text-light">${m.name}</td><td class="num text-blue font-bold">${fmtInt.format(m.thisWeek)}</td><td class="num text-dim">${fmtInt.format(m.lastWeek)}</td><td class="num"><span class="text-change ${m.colorClass}">${m.icon} ${m.change > 0 ? '+'+fmtInt.format(m.change) : fmtInt.format(m.change)}</span></td><td><span class="badge-status ${m.status.toLowerCase()}">${m.icon} ${m.status} ${m.pct > 0 ? '+'+m.pct.toFixed(1) : m.pct.toFixed(1)}%</span></td><td class="center" style="color: var(--${m.colorClass === 'positive' ? 'green' : m.colorClass === 'negative' ? 'red' : 'dim'}); font-size: 14px;">${m.colorClass === 'positive' ? ' ' : m.colorClass === 'negative' ? ' ' : ' '}</td>`;
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
      tr.innerHTML = `<td class="text-dim">#${idx + 1}</td><td class="font-bold text-light">${m.name}</td><td class="num text-blue font-bold">${fmtInt.format(Math.round(m.currentAvg))}</td><td class="num text-dim">${fmtInt.format(Math.round(m.lastAvg))}</td><td class="num"><span class="text-change ${m.colorClass}">${m.icon} ${m.change > 0 ? '+'+fmtInt.format(Math.round(m.change)) : fmtInt.format(Math.round(m.change))}</span></td><td><span class="badge-status ${m.status.toLowerCase()}">${m.icon} ${m.status} ${m.pct > 0 ? '+'+m.pct.toFixed(1) : m.pct.toFixed(1)}%</span></td><td class="center" style="color: var(--${m.colorClass === 'positive' ? 'green' : m.colorClass === 'negative' ? 'red' : 'dim'}); font-size: 14px;">${m.colorClass === 'positive' ? ' ' : m.colorClass === 'negative' ? ' ' : ' '}</td>`;
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
    tr.innerHTML = `<td class="text-dim">#${idx + 1}</td><td class="font-mono text-dim">${m.id || '-'}</td><td class="font-bold text-light">${m.name}</td><td class="text-dim">${m.acm}</td><td class="num text-blue font-bold">${fmtInt.format(m.confirmed)}</td><td class="num text-dim">${fmtInt.format(m.placed)}</td><td class="num text-dim">${fmtInt.format(m.delivered)}</td><td class="num"><span class="badge-outline ${getCrBadgeColor(m.cr)}">${fmtPct(m.cr)}</span></td><td class="num text-dim">${fmtPct(m.dr)}</td><td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPct(m.ndr)}</span></td><td class="num text-green font-bold">${fmtMoneyCompact(m.deliveredGmv)}</td><td class="num text-dim">${fmtMoneyCompact(m.confirmedGmv)}</td><td class="num text-dim">${fmtInt.format(m.skuCount)}</td>`;
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
    tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id || '-'}</td><td class="font-bold text-light">${m.name}</td><td class="text-dim">${m.acm}</td><td class="num text-dim font-bold">${m.targetPlaced > 0 ? fmtInt.format(m.targetPlaced) : '-'}</td><td class="num text-dim font-bold">${m.targetGmv > 0 ? fmtMoneyCompact(m.targetGmv) : '-'}</td><td class="num text-green font-bold">${fmtMoneyCompact(m.deliveredGmv)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${m.targetGmv > 0 ? m.achievedPct.toFixed(1) + '%' : 'N/A'}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${Math.min(m.achievedPct, 100)}%"></div></div></td><td class="num font-bold text-light">${fmtMoneyCompact(m.runRate)}</td><td class="num text-dim">${fmtInt.format(m.placed)}</td><td class="num text-blue font-bold">${fmtInt.format(m.confirmed)}</td><td class="num text-dim">${fmtInt.format(m.delivered)}</td><td class="num font-bold text-light">${fmtMoneyCompact(m.cm3)}</td><td class="num font-bold text-purple">${fmtPct(m.cm3Pct)}</td><td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPct(m.ndr)}</span></td><td class="num font-bold text-light">${fmtPct(m.cm3Pct)}</td>`;
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
    tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id || '-'}</td><td class="font-bold text-light">${m.name}</td><td class="text-dim">${m.acm}</td><td><span class="seg-badge ${getSegBadgeClass(m.currentSegment)}">${m.currentSegment}</span></td><td class="num font-bold text-light">${fmtInt.format(m.confirmed)}</td><td class="num font-bold text-blue">${fmtInt.format(Math.round(m.rrConfirmed))}</td><td><span class="seg-badge ${getSegBadgeClass(m.projectedSegment)}">${m.projectedSegment}</span></td>`;
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
      <td class="num"><span class="badge-status turned-positive">${fmtInt.format(r.turnedPositive)}</span></td>
      <td class="num"><span class="badge-status turned-negative">${fmtInt.format(r.turnedNegative)}</span></td>
      <td class="num"><span class="badge-status became-zero">${fmtInt.format(r.becameZero)}</span></td>
      <td class="num"><span class="badge-status stayed-negative">${fmtInt.format(r.stayedNegative)}</span></td>
      <td class="num"><span class="badge-status stayed-positive">${fmtInt.format(r.stayedPositive)}</span></td>
      <td class="num"><span class="badge-status new-match">${fmtInt.format(r.newMatch)}</span></td>
      <td class="num text-dim font-bold">${fmtInt.format(r.totalNegLastPeriod)}</td>
      <td class="num font-bold ${r.actionRate === null ? "text-dim" : "text-blue"}">${r.actionRate === null ? "-" : fmtPct(r.actionRate)}</td>
      <td class="num font-bold ${r.recoveryRate === null ? "text-dim" : "text-green"}">${r.recoveryRate === null ? "-" : fmtPct(r.recoveryRate)}</td>
      <td class="num text-red">${fmtCm3Money(r.cm3NegLast)}</td>
      <td class="num text-red">${fmtCm3Money(r.cm3NegThis)}</td>
      <td class="num"><span class="contr-pill ${contrClass}">${fmtPct(r.contrNeg)}</span></td>
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
    tr.innerHTML = `<td class="cm3-period-cell">${r.period}</td><td class="num text-green font-bold">${fmtCm3Money(r.cm3PositiveTotal)}</td><td class="num text-red font-bold">${fmtCm3Money(r.cm3NegativeTotal)}</td><td class="num"><span class="contr-pill ${contrClass}">${fmtPct(r.contrNeg)}</span></td>`;
    body.appendChild(tr);
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
      tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id}</td><td class="font-bold text-light">${m.name}</td><td class="num font-bold">${fmtInt.format(m.placedPieces)}</td><td class="num text-blue">${fmtInt.format(m.confirmedPieces)}</td><td class="num text-green">${fmtInt.format(m.deliveredPieces)}</td><td class="num"><span class="badge-outline ${getCrBadgeColor(m.cr)}">${fmtPct(m.cr)}</span></td><td class="num text-dim">${fmtPct(m.dr)}</td><td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPct(m.ndr)}</span></td><td class="num font-bold text-dim">${fmtMoneyCompact(m.deliveredGmv)}</td><td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompact(m.cm3)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPct(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td><td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>`;
    } else if(analystState.scope === "category") {
      tr.innerHTML = `
        <td class="text-dim">#${start + idx + 1}</td>
        <td class="font-bold text-light">${m.category}</td>
        <td class="num text-dim">${m.targetCm3 > 0 ? fmtMoneyCompact(m.targetCm3) : '-'}</td>
        <td class="num font-bold ${m.cm3 >= m.targetCm3 && m.targetCm3 > 0 ? 'text-green' : (m.cm3 >= 0 ? 'text-blue' : 'text-red')}">${fmtMoneyCompact(m.cm3)}</td>
        <td class="num text-dim">${m.targetCm3PerPiece > 0 ? fmtMoneyCompact(m.targetCm3PerPiece) : '-'}</td>
        <td class="num font-bold ${m.cm3PerPiece >= m.targetCm3PerPiece && m.targetCm3PerPiece > 0 ? 'text-green' : 'text-dim'}">${fmtMoneyCompact(m.cm3PerPiece)}</td>
        <td class="num text-dim">${m.targetCm3Pct > 0 ? m.targetCm3Pct.toFixed(1) + '%' : '-'}</td>
        <td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPct(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td>
        <td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>
      `;
    } else if(analystState.scope === "match") {
      tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id}</td><td class="font-bold text-light truncate-cell" title="${m.name}">${m.name}</td><td class="font-mono text-dim">${m.sku}</td><td class="text-dim truncate-cell" title="${m.skuName}">${m.skuName}</td><td class="text-dim">${m.category}</td><td class="num font-bold">${fmtInt.format(m.placedPieces)}</td><td class="num text-blue">${fmtInt.format(m.confirmed)}</td><td class="num text-green">${fmtInt.format(m.delivered)}</td><td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompact(m.cm3)}</td><td class="num font-bold">${fmtMoneyCompact(m.cm3PerPiece)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPct(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td><td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>`;
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
            wowDiff, wowPct, wowStatus, wowClass, wowIcon
        };
    });

    if($("mpSpTotalSkus")) $("mpSpTotalSkus").textContent = fmtInt.format(totalSkus);
    if($("mpSpAchieved")) $("mpSpAchieved").textContent = fmtInt.format(achievedCount);
    if($("mpSpMissed")) $("mpSpMissed").textContent = fmtInt.format(missedCount);
    if($("mpSpOverallMtdTarget")) $("mpSpOverallMtdTarget").textContent = fmtInt.format(Math.round(totalMtdTarget));
    if($("mpSpOverallMtdActual")) $("mpSpOverallMtdActual").textContent = fmtInt.format(totalMtdActual);

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
            <td class="num text-orange font-bold">${fmtInt.format(Math.round(m.mtdTarget))}</td>
            <td class="num text-blue font-bold">${fmtInt.format(m.mtdActual)}</td>
            <td class="num text-green font-bold">${fmtMoneyCompact(m.deliveredGmv)}</td>
            <td class="num"><span class="badge-outline ${mtdColor}">${fmtPct(m.mtdAchievedPct)}</span></td>
            <td class="num text-red font-bold">${fmtInt.format(m.gap > 0 ? Math.round(m.gap) : 0)}</td>
            <td class="num text-blue">${fmtInt.format(Math.round(m.runRate))}</td>
            <td class="center"><span class="badge-status ${m.wowClass}">${m.wowIcon} ${m.wowStatus} ${m.wowPct > 0 ? '+' : ''}${m.wowPct.toFixed(1)}% (${m.wowDiff > 0 ? '+' : ''}${m.wowDiff})</span></td>
        `;
        tbody.appendChild(tr);
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
    const finalVal = savedVal && options.some(o => o.key === savedVal) ? savedVal : "";
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

  // لو نفس مراجع (references) الأراييز الخام زي المرة اللي فاتت، استخدم الكاش
  if (
    _stIndexCache &&
    _stIndexCache._src.inbound === src.inbound &&
    _stIndexCache._src.begInv === src.begInv &&
    _stIndexCache._src.need === src.need &&
    _stIndexCache._src.prodInfo === src.prodInfo
  ) {
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

  _stIndexCache = {
    _src: src,
    productInfo, inboundBySkuMonth, inboundFirstBuyMonth, inboundLastRec, inboundNameCat,
    beginInvBySkuMonth, beginInvNameCat, needBySkuMonth, needNameCat,
    skuByMonthInbound, skuByMonthBegInv, skuByMonthNeed
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
    needNameCat, skuByMonthInbound, skuByMonthBegInv, skuByMonthNeed
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

    rows.push({
      sku,
      name: info.name || "Unknown",
      cat: info.cat || "Uncategorized",
      lastRecDate: lastRec ? lastRec.text : "-",
      cnfQty, dlvQty, begInv, begSales, remBeg,
      rtos, retSales, remPurSales, totPur, purSales,
      stRate, soldInb, firstBuy,
      cBegSales, cRemBeg, cRetSales, cRemPurSales, cPurSales
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
      <td>${fmtInt.format(r.pieces)}</td>
      <td>${fmtInt.format(r.begInv)}</td>
      <td>${fmtInt.format(r.begSales)}</td>
      <td>${fmtInt.format(r.returns)}</td>
      <td>${fmtInt.format(r.retSales)}</td>
      <td>${fmtInt.format(r.totPur)}</td>
      <td>${fmtInt.format(r.purSales)}</td>
      <td>${fmtInt.format(r.overflow)}</td>
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

  if (!overlay || !bar || !text) {
    prepareSellthroughData();
    return;
  }

  // 1. إظهار الشريط وتصفيره فوراً بدون أنيميشن عشان يبدأ من الصفر بجد
  overlay.classList.remove("hidden");
  bar.style.transition = "none";
  bar.style.width = "0%";
  text.textContent = "0%";

  // 2. تأخير بسيط جداً عشان المتصفح يطبق الصفر قبل ما نبدأ
  setTimeout(() => {
    // نرجع الأنيميشن ونسرعه شوية عشان يمشي مع الأرقام
    bar.style.transition = "width 0.2s linear";
    
    let progress = 0;
    
    // 3. العداد هيزيد كل 80 ملي ثانية (سرعة مناسبة للعين)
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 12) + 4; // زيادة عشوائية
      
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        bar.style.width = "100%";
        text.textContent = "100%";

        // 4. هنا السر! هنستنى نص ثانية (500ms) عشان الشريط الأزرق يلحق يوصل للآخر 100%
        // قبل ما نشغل الداتا التقيلة اللي بتجمد الشاشة
        setTimeout(() => {
          prepareSellthroughData();
          overlay.classList.add("hidden");
        }, 500);
        
      } else {
        bar.style.width = progress + "%";
        text.textContent = progress + "%";
      }
    }, 80);
    
  }, 50);
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
  
  const PAGE_SIZE = 10;
  const start = state.sellthroughPage * PAGE_SIZE;
  const pageRows = state.filteredSellthroughData.slice(start, start + PAGE_SIZE);
  
  pageRows.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono text-dim">${m.sku}</td>
      <td class="font-bold text-light truncate-cell" title="${m.name}">${m.name}</td>
      <td class="text-dim">${m.cat}</td>
      <td class="text-dim">${m.lastRecDate}</td>
      <td class="num text-blue font-bold">${fmtInt.format(m.cnfQty)}</td>
      <td class="num text-green font-bold">${fmtInt.format(m.dlvQty)}</td>
      <td class="num text-light">${fmtInt.format(m.begInv)}</td>
      <td class="num text-dim">${fmtInt.format(m.begSales)}</td>
      <td class="num text-orange font-bold">${fmtInt.format(m.remBeg)}</td>
      <td class="num text-red font-bold">${fmtInt.format(m.rtos)}</td>
      <td class="num text-red">${fmtInt.format(m.retSales)}</td>
      <td class="num text-dim">${fmtInt.format(m.remPurSales)}</td>
      <td class="num text-blue">${fmtInt.format(m.totPur)}</td>
      <td class="num text-green">${fmtInt.format(m.purSales)}</td>
      <td class="num text-purple font-bold">${m.stRate.toFixed(1)}%</td>
      <td class="num font-bold">${m.soldInb.toFixed(1)}%</td>
      <td class="center"><span class="badge-outline ${m.firstBuy === 'Yes' ? 'green' : 'dim'}">${m.firstBuy}</span></td>
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
      <td class="num font-bold">${fmtInt.format(m.totalPlaced)}</td>
      <td class="num text-blue">${fmtInt.format(m.totalConfirmed)}</td>
      <td class="num text-green">${fmtInt.format(m.totalDelivered)}</td>
      <td class="num"><span class="badge-outline ${getCrBadgeColor(m.crPct)}">${fmtPct(m.crPct)}</span></td>
      <td class="num text-dim">${fmtPct(m.drPct)}</td>
      <td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndrPct)}">${fmtPct(m.ndrPct)}</span></td>
      <td class="num font-bold text-dim">${fmtMoneyCompact(m.deliveredGmv)}</td>
      <td class="num">${fmtPct(m.contrPct)}</td>
      <td class="num text-dim">${fmtMoneyCompact(m.placedAsp)}</td>
      <td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompact(m.cm3)}</td>
      <td class="num font-bold">${fmtMoneyCompact(m.cm3PerPiece)}</td>
      <td class="num text-purple">${fmtPct(m.cm3Pct)}</td>
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

// Fetches all 7 sheets (main sheet is mandatory, the rest are best-effort)
// and returns a plain snapshot object — does NOT touch global state, so it
// is safe to call in the background while old data is still on screen.
async function fetchAllSheetsSnapshot() {
  let newSegLoadError = null;
  const [
    mainPayload, targetsPayload, segPayload, acmTargetsPayload, 
    invPayload, prodPayload, catTargetsPayload, planPayload, 
    salesPlanPerfPayload, newSegPayload, inboundPayload,
    prodInfoPayload, begInvPayload, sellthroughNeededPayload
  ] = await Promise.all([
    loadSheetWithRetry(MAIN_GID),
    TARGETS_GID && TARGETS_GID !== " " ? loadSheetWithRetry(TARGETS_GID).catch(() => null) : Promise.resolve(null),
    SEGMENTATION_GID ? loadSheetWithRetry(SEGMENTATION_GID).catch(() => null) : Promise.resolve(null),
    TARGETS_ACM_GID && TARGETS_ACM_GID !== " _Targets_ACM_ " ? loadSheetWithRetry(TARGETS_ACM_GID).catch(() => null) : Promise.resolve(null),
    INVENTORY_GID ? loadSheetWithRetry(INVENTORY_GID).catch(() => null) : Promise.resolve(null),
    PRODUCTS_GID ? loadSheetWithRetry(PRODUCTS_GID).catch(() => null) : Promise.resolve(null),
    CAT_TARGETS_GID ? loadSheetWithRetry(CAT_TARGETS_GID).catch(() => null) : Promise.resolve(null),
    ACM_SALES_PLAN_GID ? loadSheetWithRetry(ACM_SALES_PLAN_GID).catch(() => null) : Promise.resolve(null),
    SALES_PLAN_PERF_GID ? loadSheetWithRetry(SALES_PLAN_PERF_GID).catch(() => null) : Promise.resolve(null),
    NEW_SEGMENTATION_GID ? loadSheetWithRetry(NEW_SEGMENTATION_GID).catch((err) => { newSegLoadError = err.message || String(err); return null; }) : Promise.resolve(null),
    INBOUND_GID ? loadSheetWithRetry(INBOUND_GID).catch(() => null) : Promise.resolve(null),
    loadSheetWithRetry(PRODUCTS_INFO_GID).catch(() => null),
    loadSheetWithRetry(BEGIN_INV_GID).catch(() => null),
    loadSheetWithRetry(SELLTHROUGH_NEEDED_GID).catch(() => null)
  ]);

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
    acmSalesPlanData: planPayload ? parseAcmSalesPlanSheet(planPayload) : state.acmSalesPlanData, // <-- إضافة البيانات
    salesPlanPerfRows: salesPlanPerfPayload ? parseSalesPlanPerformanceSheet(salesPlanPerfPayload) : state.salesPlanPerfRows, // <-- برفورمانس الـ Sales Plan
    newSegRows: newSegPayload ? parseNewSegmentationSheet(newSegPayload) : state.newSegRows, // <-- Segmentation Panel (Admin Panel)
    newSegLoadError: newSegPayload ? null : (newSegLoadError || state.newSegLoadError || "Could not load GID " + NEW_SEGMENTATION_GID + "."),
    inboundRows: inboundPayload ? parseInboundSheet(inboundPayload) : state.inboundRows,
    metabaseProductsInfo: prodInfoPayload ? parseProductsInfoSheet(prodInfoPayload) : state.metabaseProductsInfo,
    metabaseBeginningInventory: begInvPayload ? parseBeginningInventorySheet(begInvPayload) : state.metabaseBeginningInventory,
    metabaseSellthroughNeeded: sellthroughNeededPayload ? parseSellthroughNeededSheet(sellthroughNeededPayload) : state.metabaseSellthroughNeeded
  };
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
  state.acmSalesPlanData = snapshot.acmSalesPlanData; 
  state.salesPlanPerfRows = snapshot.salesPlanPerfRows;
  state.newSegRows = snapshot.newSegRows || [];
  state.newSegLoadError = snapshot.newSegLoadError || null;
  state.inboundRows = snapshot.inboundRows || [];
  state.metabaseProductsInfo = snapshot.metabaseProductsInfo || [];
  state.metabaseBeginningInventory = snapshot.metabaseBeginningInventory || [];
  state.metabaseSellthroughNeeded = snapshot.metabaseSellthroughNeeded || [];
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
    setSyncStatus(`Cached — ${formatCacheTimestamp(cache.savedAt)} — syncing…`);
    paintedFromCache = true;
  } else {
    if (loadingEl) loadingEl.classList.remove("hidden");
    if (errorEl) errorEl.classList.add("hidden");
  }

  try {
    const snapshot = await fetchAllSheetsSnapshot();
    applySnapshotToState(snapshot);
    renderCurrentState();
    saveDataToCache(snapshot);
    backupSnapshotToDrive(snapshot);
    if (loadingEl) loadingEl.classList.add("hidden");
    if (errorEl) errorEl.classList.add("hidden");
    setSyncStatus(`Live — updated ${formatCacheTimestamp(Date.now())}`);
    showToast();
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
        analyst: analystState.page
    };
    
    // Set to page 0 and max size
    state.page = 0; state.pageMerchant = 0; state.pageSeg = 0; state.pageInventory = 0; analystState.page = 0;
    PAGE_SIZE = 999999; 
    
    if (typeof renderPaginatedInventoryTable === 'function') renderPaginatedInventoryTable();
    if (typeof renderPaginatedAcmTable === 'function') renderPaginatedAcmTable();
    if (typeof renderPaginatedMerchantTable === 'function') renderPaginatedMerchantTable();
    if (typeof renderPaginatedSegTable === 'function') renderPaginatedSegTable();
    if (typeof renderPaginatedCm3AnalystTable === 'function') renderPaginatedCm3AnalystTable();
    
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
        
        if (typeof renderPaginatedInventoryTable === 'function') renderPaginatedInventoryTable();
        if (typeof renderPaginatedAcmTable === 'function') renderPaginatedAcmTable();
        if (typeof renderPaginatedMerchantTable === 'function') renderPaginatedMerchantTable();
        if (typeof renderPaginatedSegTable === 'function') renderPaginatedSegTable();
        if (typeof renderPaginatedCm3AnalystTable === 'function') renderPaginatedCm3AnalystTable();
    }, 150);
});

function downloadTableAsCsv(tableEl, fileName) {
    let csv = [];
    const rows = tableEl.querySelectorAll("tr");
    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll("td, th");
        for (let j = 0; j < cols.length; j++) {
            let text = cols[j].innerText || cols[j].textContent;
            text = text.replace(/"/g, '""').replace(/(\r\n|\n|\r)/gm, " ");
            row.push('"' + text.trim() + '"');
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