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

let PAGE_SIZE = 10;
const CM3_PLACED_PIECES_COL = 15;
const CM3_MIN_PLACED_PIECES = 10;
const CM3_NEGATIVE_CONTRIBUTION_TARGET = 15;

const TICKER_MESSAGES = [
  "Core Systems Optimal",
  "Data Streams Encrypted",
  "Live Quantum Connection",
  "Welcome to Command Center"
];

const SEGMENT_RANKS = { "in active": 0, "low value": 1, "occasional": 2, "promising": 3, "potential loyalist": 4, "loyal merchants": 5, "champions": 6 };

const state = {
  allParsedRows: [], merchantTargets: {}, merchantSegmentsMap: {}, acmTargets: {},
  acmWeights: { gmv: 40, ndr: 20, cm3: 30, retention: 10 },
  inventoryMap: {}, productsMap: {}, categoryTargets: {},
  acmTableData: [], filteredAcmData: [], sortKey: "finalScorePct", sortDir: "desc", page: 0,
  merchantTableData: [], filteredMerchantData: [], sortKeyMerchant: "deliveredGmv", sortDirMerchant: "desc", pageMerchant: 0,
  filteredSegData: [], sortKeySeg: "rrConfirmed", sortDirSeg: "desc", pageSeg: 0,
  inventoryTableData: [], filteredInventoryData: [], sortKeyInventory: "conf3d", sortDirInventory: "desc", pageInventory: 0
};
const analystState = {
  scope: "merchant", data: [], filtered: [], sortKey: "cm3Pct", sortDir: "desc", page: 0, wired: false
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

function switchView(viewName) {
  document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active-view'); el.classList.add('hidden'); });
  if(navOverview) navOverview.classList.remove("active");
  if(navInventory) navInventory.classList.remove("active");
  if(navAcmPerf) navAcmPerf.classList.remove("active");
  if(navMerchantPerf) navMerchantPerf.classList.remove("active");
  if(navCm3Target) navCm3Target.classList.remove("active");
  if(navCm3Analyst) navCm3Analyst.classList.remove("active");
  
  let activeSection = null;
  if (viewName === "overview") { activeSection = $("viewOverview"); if(navOverview) navOverview.classList.add("active"); } 
  else if (viewName === "inventory") { activeSection = $("viewInventory"); if(navInventory) navInventory.classList.add("active"); } 
  else if (viewName === "acmPerformance") { activeSection = $("viewAcmPerformance"); if(navAcmPerf) navAcmPerf.classList.add("active"); } 
  else if (viewName === "merchantPerformance") { activeSection = $("viewMerchantPerformance"); if(navMerchantPerf) navMerchantPerf.classList.add("active"); } 
  else if (viewName === "cm3Target") { activeSection = $("viewCm3Target"); if(navCm3Target) navCm3Target.classList.add("active"); renderCm3TargetView(); } 
  else if (viewName === "cm3Analyst") { activeSection = $("viewCm3Analyst"); if(navCm3Analyst) navCm3Analyst.classList.add("active"); renderCm3AnalystView(); }
  
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
      placedPieces: cellNumber(c[CM3_PLACED_PIECES_COL])
    });
  }
  return rows;
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
  prepareMerchantTableData(rows); prepareAcmTableData(rows); prepareInventoryTableData(rows);
  renderOverallAcmTargetsSummary();
  if ($("viewCm3Target") && $("viewCm3Target").classList.contains("active-view")) renderCm3TargetView();
  if ($("viewCm3Analyst") && $("viewCm3Analyst").classList.contains("active-view")) renderCm3AnalystView();
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
    entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders; entry.cm3 += r.cm3; entry.deliveredGmv += r.deliveredGmv;
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
  rows.forEach(r => {
    if (!r.acmName || r.acmName === "Unassigned") return;
    if (!map.has(r.acmName)) { map.set(r.acmName, { name: r.acmName, placed: 0, confirmed: 0, delivered: 0, placedGmv: 0, deliveredGmv: 0, confirmedGmv: 0, cm3: 0, actualRetention: 0 }); }
    const entry = map.get(r.acmName); entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders; entry.deliveredGmv += r.deliveredGmv; entry.confirmedGmv += r.confirmedGmv; entry.cm3 += r.cm3;
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
    const cr = m.placed ? (m.confirmed / m.placed) : 0; const dr = m.confirmed ? (m.delivered / m.confirmed) : 0; const ndr = (dr * cr) * 100; const cm3Pct = m.deliveredGmv ? (m.cm3 / m.deliveredGmv) * 100 : 0;
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
  rows.forEach(r => {
    if (!r.merchantId || r.merchantId === "Unassigned") return;
    if (!map.has(r.merchantId)) { map.set(r.merchantId, { id: r.merchantId, name: r.merchantName, acm: r.acmName, placed: 0, confirmed: 0, delivered: 0, placedGmv: 0, deliveredGmv: 0, confirmedGmv: 0, cm3: 0, skus: new Set() }); }
    const entry = map.get(r.merchantId); entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders; entry.placedGmv += r.placedGmv; entry.deliveredGmv += r.deliveredGmv; entry.confirmedGmv += r.confirmedGmv; entry.cm3 += r.cm3;
    if(r.sku && r.placedOrders > 0) entry.skus.add(r.sku);
  });
  const selectedMonthStr = $("monthSelect") ? $("monthSelect").value : ""; let elapsedDays = 1; let totalDays = 30;
  if (selectedMonthStr) { const d = new Date(selectedMonthStr); if (!isNaN(d)) { const now = new Date(); totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) { elapsedDays = now.getDate() || 1; } else { elapsedDays = totalDays; } } }
  state.merchantTableData = Array.from(map.values()).map(m => {
    const cr = m.placed ? (m.confirmed / m.placed) : 0; const dr = m.confirmed ? (m.delivered / m.confirmed) : 0; const ndr = dr * cr; const cm3Pct = m.deliveredGmv ? (m.cm3 / m.deliveredGmv) : 0;
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
  const comboMap = new Map();
  rows.forEach(r => {
    if (!r.timestamp || !r.merchantId || !r.sku) return;
    const rd = new Date(r.timestamp); rd.setHours(0, 0, 0, 0);
    const period = cm3PeriodLabel(rd, periodMode); const periodSort = cm3PeriodSortKey(rd, periodMode);
    const key = `${r.merchantId}||${r.sku}||${period}`;
    if (!comboMap.has(key)) { comboMap.set(key, { merchantId: r.merchantId, merchantName: r.merchantName, sku: r.sku, category: r.category, period, periodSort, placedPieces: 0, cm3: 0 }); }
    const e = comboMap.get(key); e.placedPieces += r.placedPieces; e.cm3 += r.cm3;
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
    html += `<th data-akey="index">#</th><th data-akey="id">Merchant ID</th><th data-akey="name">Merchant Name</th><th data-akey="cr" class="num">CR%</th><th data-akey="dr" class="num">DR%</th><th data-akey="ndr" class="num">NDR%</th><th data-akey="deliveredGmv" class="num">Delivered GMV</th><th data-akey="cm3" class="num">Total CM3</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;">CM3 %</th><th class="center">Status</th>`;
  } else if(analystState.scope === "category") {
    html += `<th data-akey="index">#</th><th data-akey="category">Category</th><th data-akey="targetCm3" class="num text-dim">Target CM3</th><th data-akey="cm3" class="num">Actual CM3</th><th data-akey="targetCm3PerPiece" class="num text-dim">Target CM3/Pc</th><th data-akey="cm3PerPiece" class="num">Actual CM3/Pc</th><th data-akey="targetCm3Pct" class="num text-dim">Target CM3 %</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;">Actual CM3 %</th><th class="center">Status</th>`;
  } else if(analystState.scope === "match") {
    html += `<th data-akey="index">#</th><th data-akey="id">Merchant ID</th><th data-akey="name">Merchant Name</th><th data-akey="sku">Product ID</th><th data-akey="skuName" style="max-width:200px; white-space:normal;">Product Name</th><th data-akey="category" class="text-dim">Category</th><th data-akey="placedPieces" class="num">Total Placed</th><th data-akey="confirmed" class="num">Total Confirmed</th><th data-akey="delivered" class="num">Total Delivered</th><th data-akey="cm3" class="num">Total CM3</th><th data-akey="cm3PerPiece" class="num">CM3 / Pc</th><th data-akey="cm3Pct" class="num" style="min-width: 120px;">CM3 %</th><th class="center">Status</th>`;
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

function prepareCm3AnalystData(rows) {
  const map = new Map(); let totalGmv = 0; let totalCm3 = 0;
  rows.forEach(r => {
    let key = "";
    if (analystState.scope === "merchant") key = r.merchantId; else if (analystState.scope === "category") key = r.category; else if (analystState.scope === "match") key = r.merchantId + "||" + r.sku;
    if (!key || key === "Unassigned") return;
    if (!map.has(key)) { map.set(key, { id: r.merchantId, name: r.merchantName || r.merchantId, sku: r.sku, skuName: (state.inventoryMap[r.sku] ? state.inventoryMap[r.sku].skuName : "Unknown"), category: r.category, placed: 0, confirmed: 0, delivered: 0, placedPieces: 0, deliveredGmv: 0, cm3: 0 }); }
    const entry = map.get(key);
    entry.placed += r.placedOrders; entry.confirmed += r.confirmedOrders; entry.delivered += r.deliveredOrders; entry.placedPieces += (r.placedPieces || r.placedOrders); entry.deliveredGmv += r.deliveredGmv; entry.cm3 += r.cm3;
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
      tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id}</td><td class="font-bold text-light">${m.name}</td><td class="num"><span class="badge-outline ${getCrBadgeColor(m.cr)}">${fmtPct(m.cr)}</span></td><td class="num text-dim">${fmtPct(m.dr)}</td><td class="num"><span class="badge-outline ${getNdrBadgeColor(m.ndr)}">${fmtPct(m.ndr)}</span></td><td class="num font-bold text-dim">${fmtMoneyCompact(m.deliveredGmv)}</td><td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompact(m.cm3)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPct(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td><td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>`;
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
      tr.innerHTML = `<td class="text-dim">#${start + idx + 1}</td><td class="font-mono text-dim">${m.id}</td><td class="font-bold text-light">${m.name}</td><td class="font-mono text-dim">${m.sku}</td><td class="text-dim" style="max-width:200px; white-space:normal; line-height: 1.3;">${m.skuName}</td><td class="text-dim">${m.category}</td><td class="num font-bold">${fmtInt.format(m.placedPieces)}</td><td class="num text-blue">${fmtInt.format(m.confirmed)}</td><td class="num text-green">${fmtInt.format(m.delivered)}</td><td class="num font-bold ${m.cm3 >= 0 ? 'text-green' : 'text-red'}">${fmtMoneyCompact(m.cm3)}</td><td class="num font-bold">${fmtMoneyCompact(m.cm3PerPiece)}</td><td class="num"><div style="font-weight:600; font-size: 11px; color:var(--${progressColor})">${fmtPct(m.cm3Pct)}</div><div class="progress-bar"><div class="progress-fill ${progressColor}" style="width: ${barWidth}%"></div></div></td><td class="center">${getCm3ProfitBadge(m.cm3Pct)}</td>`;
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

function renderCm3AnalystView() { prepareCm3AnalystData(state.allParsedRows); analystWireControlsOnce(); }

function analystWireControlsOnce() {
  if (analystState.wired) return; analystState.wired = true;
  document.querySelectorAll("#analystScopeToggle .segmented-btn").forEach(btn => { btn.addEventListener("click", () => { document.querySelectorAll("#analystScopeToggle .segmented-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); analystState.scope = btn.dataset.scope; renderCm3AnalystView(); }); });
  if($("searchAnalystInput")) { $("searchAnalystInput").addEventListener("input", applyCm3AnalystSearchAndSort); }
  if($("prevPageAnalyst")) { $("prevPageAnalyst").addEventListener("click", () => { if (analystState.page > 0) { analystState.page -= 1; renderPaginatedCm3AnalystTable(); } }); }
  if($("nextPageAnalyst")) { $("nextPageAnalyst").addEventListener("click", () => { const totalPages = Math.max(1, Math.ceil(analystState.filtered.length / PAGE_SIZE)); if (analystState.page < totalPages - 1) { analystState.page += 1; renderPaginatedCm3AnalystTable(); } }); }
}

// Fetches all 7 sheets (main sheet is mandatory, the rest are best-effort)
// and returns a plain snapshot object — does NOT touch global state, so it
// is safe to call in the background while old data is still on screen.
async function fetchAllSheetsSnapshot() {
  const [mainPayload, targetsPayload, segPayload, acmTargetsPayload, invPayload, prodPayload, catTargetsPayload] = await Promise.all([
    loadSheetWithRetry(MAIN_GID),
    TARGETS_GID && TARGETS_GID !== " " ? loadSheetWithRetry(TARGETS_GID).catch(() => null) : Promise.resolve(null),
    SEGMENTATION_GID ? loadSheetWithRetry(SEGMENTATION_GID).catch(() => null) : Promise.resolve(null),
    TARGETS_ACM_GID && TARGETS_ACM_GID !== " _Targets_ACM_ " ? loadSheetWithRetry(TARGETS_ACM_GID).catch(() => null) : Promise.resolve(null),
    INVENTORY_GID ? loadSheetWithRetry(INVENTORY_GID).catch(() => null) : Promise.resolve(null),
    PRODUCTS_GID ? loadSheetWithRetry(PRODUCTS_GID).catch(() => null) : Promise.resolve(null),
    CAT_TARGETS_GID ? loadSheetWithRetry(CAT_TARGETS_GID).catch(() => null) : Promise.resolve(null)
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
    categoryTargets: catTargetsPayload ? parseCategoryTargetsSheet(catTargetsPayload) : state.categoryTargets
  };
}

function applySnapshotToState(snapshot) {
  state.allParsedRows = snapshot.allParsedRows;
  state.merchantTargets = snapshot.merchantTargets;
  state.merchantSegmentsMap = snapshot.merchantSegmentsMap;
  state.acmTargets = snapshot.acmTargets;
  state.inventoryMap = snapshot.inventoryMap;
  state.productsMap = snapshot.productsMap;
  state.categoryTargets = snapshot.categoryTargets;
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