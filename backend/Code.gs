/**
 * ============================================================================
 *  Performance Dashboard — Auth Backend (Google Apps Script Web App)
 * ============================================================================
 *  This is the server side of the login/sign-up system used by js/auth.js.
 *  It reads and appends rows in the "Users" sheet inside the same
 *  spreadsheet the dashboard already reads its data from.
 *
 *  Expected sheet (identified by its GID below) — row 1 = headers:
 *    User Name | Email | Password | Role
 *
 *  HOW TO DEPLOY
 *  1. Open the Google Sheet used by the dashboard (SHEET_ID below already
 *     matches the one in js/app.js).
 *  2. Make sure it has a tab/sheet whose GID is 1839838273, with the header
 *     row: "User Name", "Email", "Password", "Role".
 *  3. Extensions > Apps Script. Delete any boilerplate code and paste this
 *     whole file in.
 *  4. Deploy > New deployment > Select type: "Web app".
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  5. Copy the "Web app URL" you get and paste it into CONFIG.API_URL at
 *     the top of js/auth.js.
 *  6. Every time you edit this script, create a NEW deployment version
 *     (or use "Manage deployments" > Edit > New version) for changes to
 *     go live.
 *
 *  NOTE (v1.10.0): the "Computed Data" API (publish_computed_batch /
 *  getComputed / listComputed) and the getLastSync read cache now live in the
 *  Cloudflare Worker (cloudflare-worker/worker.js). Feedback saves are
 *  accepted by the Worker instantly and applied here in the background
 *  (save_match_feedback / save_decline_feedback / save_sales_plan_feedback).
 * ============================================================================
 */

var WEBSITE_EGY_SHEET_ID = "1Vg8P1EL5y_FqQSR7_uDI1XtB-gDe0Bkj7IqbiOzNgxA";
var USERS_SHEET_GID = 1839838273;
var ALLOWED_EMAIL_DOMAIN = "taager.com";
// Cloudflare Worker endpoint that serves the access config (people added by an admin).
var ACCESS_CONFIG_URL = "https://performance-dashboard-sync-cache.youssef-hanafy.workers.dev/?action=getAccess";

// Recommended Tracker — Products/Matches sheet. Columns (1-based):
// A Type | B PRODUCT_ID | C PRODUCT_NAME | D Merchant ID | E Merchant |
// F Stock | G Action | H Starting Cogs | I Merchant Starting AVG |
// J SKU Starting AVG | K+ one column per calendar day of feedback, header =
// that day's date label (e.g. "16-Aug"), each cell = that row's (match's)
// feedback text for that day, written by the logged-in Account Manager
// (handleSaveMatchFeedback). New rows also get appended here automatically
// with Type = "New Locked" whenever a Merchant × SKU has an active
// Availability Locking lock but no row yet (handleAddNewLockedMatches).
var PRODUCTS_MATCHES_GID = 1298408207;
var MATCHES_FEEDBACK_FIRST_COL = 11; // column K, 1-based

// Drive folder that snapshot backups get written to as .json files.
// Leave "" to auto-create/reuse a folder named BACKUP_FOLDER_NAME the first
// time a backup comes in (its ID gets logged — you can paste it here after
// to skip the lookup on every call), or paste a specific folder ID.
var BACKUP_FOLDER_ID = "";
var BACKUP_FOLDER_NAME = "Performance Dashboard Backups";
// How many snapshot files to keep in that folder before deleting the oldest.
// Every page load/refresh triggers a backup, so without this the folder
// grows without bound.
var BACKUP_KEEP_LAST_N = 30;

// ANALYST / SINGLE — DAILY. A real sheet tab (created automatically if
// missing) inside the same spreadsheet, rewritten from scratch on every
// publish with a rolling 30-day window of PPM Analyst / Single, but with
// every day computed independently (no lag cutoffs across days — see the
// big comment above buildPpmAnalystSingleDailyRows() in js/app.js for why).
// The browser computes the rows (same reasoning as COMPUTED DATA API below
// — reimplementing the debundle/PPM math here would mean two copies to keep
// in sync) and POSTs them to handlePublishAnalystSingleDaily(), which just
// writes them into this tab. Meta (last updated / row count) is kept in
// Script Properties so the dashboard's "Worker Sync Status" modal can show
// it and offer a manual "Force Refresh" without reading the whole sheet.
var ANALYST_SINGLE_DAILY_SHEET_NAME = "Analyst / Single";
var ANALYST_SINGLE_DAILY_PROP_KEY = "analystSingleDailyMeta";

// Shared secret used by handleListUsers (Users & Roles page). The Computed Data
// API that also used it moved to the Worker (env COMPUTED_API_KEYS there).
// v1.16.0: المفتاح مبقاش مكتوب في الكود — بيتقرا من Script Properties (Project Settings → Script Properties):
//   API_KEYS = مفتاح أو أكتر مفصولين بفاصلة (حط فيه نفس قيمة ADMIN_KEY بتاع الووركر عشان Users & Roles يشتغل).
function getApiKeys_() {
  var raw = PropertiesService.getScriptProperties().getProperty("API_KEYS") || "";
  return raw.split(",").map(function (k) { return k.trim(); }).filter(function (k) { return k.length >= 12; });
}

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  var action = payload.action;
  if (action === "signup") return handleSignup(payload);
  if (action === "login") return handleLogin(payload);
  if (action === "list_users") return handleListUsers(payload);
  if (action === "backup_chunk") return handleBackupChunk(payload);
  if (action === "save_match_feedback") return handleSaveMatchFeedback(payload);
  if (action === "add_new_locked_matches") return handleAddNewLockedMatches(payload);
  if (action === "publish_analyst_single_daily") return handlePublishAnalystSingleDaily(payload);
  if (action === "send_decline_digest") return handleSendDeclineDigest(payload);
  if (action === "save_decline_feedback") return handleSaveDeclineFeedback(payload);
  if (action === "get_decline_feedback") return handleGetDeclineFeedback(payload);
  if (action === "save_sales_plan_feedback") return handleSaveSalesPlanFeedback(payload);
  if (action === "get_sales_plan_feedback") return handleGetSalesPlanFeedback(payload);
  // v1.17.0 — password reset (called by the dashboard Worker only: payload.serviceKey must equal the WORKER_SERVICE_KEY property)
  if (action === "staff_user_check") return handleStaffUserCheck_(payload);
  // v1.17.0 — fast sign-in: the Worker checks the password itself (1,500 HMAC rounds take ~10 ms there, several seconds here)
  if (action === "staff_auth_record") return handleStaffAuthRecord_(payload);
  if (action === "staff_set_password") return handleStaffSetPassword_(payload);
  if (action === "staff_send_reset_mail") return handleStaffSendResetMail_(payload);
  // v1.17.0 — Supply Chain: actual returns (warehouse Return_RCV, "Product is good") — called by the dashboard Worker only
  if (action === "actual_returns") return handleActualReturns_(payload);
  // v1.17.0 — Decline Matches daily email sent BY THE DASHBOARD (Worker cron at 12:00): this script only builds it
  if (action === "decline_digest_build") return handleDeclineDigestBuild_(payload);
  if (action === "decline_digest_relay") return handleDeclineDigestRelay_(payload);
  // v1.17.0 — Planner DOH (Single SKUs) copied every day at 11:00 into the planning sheet (Worker cron calls this)
  if (action === "planner_doh_export") return handlePlannerDohExport_(payload);
  if (action === "planner_doh_rows") return handlePlannerDohRows_(payload);
  if (action === "supply_conversion_export") return handleSupplyConversionExport_(payload);
  if (action === "supply_conversion_rows") return handleSupplyConversionRows_(payload);
  if (action === "inv_category_rows") return handleInvCategoryRows_(payload);
  if (action === "inv_category_export") return handleInvCategoryExport_(payload);
  return jsonResponse({ success: false, message: "Unknown action." });
}

/**
 * Called by js/app.js (publishAnalystSingleDaily) — either automatically as
 * part of every publish cycle (js/app.js publishComputedSnapshots), or manually via the
 * "Force Refresh Analyst/Single Daily" button in the Worker Sync Status
 * modal. payload.rows = the full rolling-30-day window (every day computed
 * independently — see the comment above buildPpmAnalystSingleDailyRows() in
 * js/app.js). This writes straight
 * into a real sheet tab (ANALYST_SINGLE_DAILY_SHEET_NAME) in the same
 * spreadsheet, completely replacing its previous contents every time — it's
 * a snapshot of "last 30 days as of now", not an append-only log.
 *
 * A short script lock IS used here
 * because this writes to one shared sheet: if two people have the dashboard
 * open and their publishes land within the same second, writing at the same
 * time could interleave and corrupt the tab. If the lock can't be acquired
 * quickly, we just skip this publish — another one will follow soon (every
 * user's browser recomputes the same data from the same source), so losing
 * one publish attempt is harmless.
 */
function handlePublishAnalystSingleDaily(payload) {
  var rows = payload.rows;
  if (!Array.isArray(rows)) return jsonResponse({ success: false, message: "rows must be an array." });
  // Sanity cap — a 30-day window should never come close to this even with
  // every SKU active every day; guards against a malformed/runaway payload.
  if (rows.length > 200000) return jsonResponse({ success: false, message: "Too many rows (" + rows.length + ")." });

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(5000);
  if (!gotLock) return jsonResponse({ success: false, message: "Busy — another publish is in progress, will retry on the next cycle." });

  try {
    var ss = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID);
    var sheet = ss.getSheetByName(ANALYST_SINGLE_DAILY_SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(ANALYST_SINGLE_DAILY_SHEET_NAME);

    var headers = [
      "Date", "SKU_ID", "SKU_NAME", "Category",
      "Placed Pcs", "Confirmed Pcs", "Delivered Pcs", "Placed GMV", "Delivered GMV",
      "CR%", "DR%", "NDR%", "Delivered ASP", "Priceing_PPM", "PPM%", "CM3", "CM3/Pcs", "CM3%"
    ];
    // Build the full values array first (no writes yet) so a bad row never
    // leaves the sheet half-cleared/half-written — either the whole thing
    // succeeds or the catch below leaves the previous good snapshot intact.
    var values = [headers];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      values.push([
        r.date ? new Date(r.date + "T00:00:00") : "",
        r.skuId || "", r.skuName || "", r.category || "",
        r.placedPieces || 0, r.confirmedPieces || 0, r.deliveredPieces || 0,
        r.placedGmv || 0, r.deliveredGmv || 0,
        (r.crPct || 0) / 100, (r.drPct || 0) / 100, (r.ndrPct || 0) / 100,
        r.deliveredAsp || 0, r.ppmSku || 0, (r.ppmPct || 0) / 100,
        r.cm3 || 0, r.cm3PerPiece || 0, (r.cm3Pct || 0) / 100
      ]);
    }

    sheet.clearContents();
    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
    if (values.length > 1) {
      sheet.getRange(2, 1, values.length - 1, 1).setNumberFormat("yyyy-mm-dd");
      [10, 11, 12, 15].forEach(function (col) {
        sheet.getRange(2, col, values.length - 1, 1).setNumberFormat("0.0%");
      });
    }
    sheet.setFrozenRows(1);

    var meta = { updatedAt: new Date().toISOString(), rowCount: rows.length };
    PropertiesService.getScriptProperties().setProperty(ANALYST_SINGLE_DAILY_PROP_KEY, JSON.stringify(meta));

    return jsonResponse({ success: true, rowCount: rows.length, updatedAt: meta.updatedAt });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Lightweight status for the "Worker Sync Status" modal — last time the
 * "Analyst / Single" tab was actually rewritten, and how many rows it has,
 * without reading the sheet itself.
 */
function handleGetAnalystSingleDailyMeta(e) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(ANALYST_SINGLE_DAILY_PROP_KEY);
    var meta = raw ? JSON.parse(raw) : null;
    return jsonResponse({ success: true, fetchedAt: meta ? meta.updatedAt : null, rowCount: meta ? meta.rowCount : null });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

/**
 * ============================================================================
 *  RECOMMENDED TRACKER — LIVE FEEDBACK WRITE-BACK
 * ============================================================================
 *  js/app.js (submitMatchFeedback) posts here whenever an Account Manager
 *  writes feedback on a match (Merchant × PRODUCT_ID) row in the
 *  Recommended Tracker. This writes it directly into the Products/Matches
 *  sheet (PRODUCTS_MATCHES_GID), into the column for TODAY's date — creating
 *  that date column (header = "16-Aug"-style label) the first time any
 *  feedback comes in for that day. If a match already has feedback for that
 *  same day, the cell is overwritten (last write wins — no history kept).
 * ============================================================================
 */
function handleSaveMatchFeedback(payload) {
  var merchantId = String(payload.merchantId || "").trim();
  var productId = String(payload.productId || "").trim();
  var feedback = String(payload.feedback || "").trim();
  var acmName = String(payload.acmName || "").trim();

  if (!merchantId || !productId) {
    return jsonResponse({ success: false, error: "Missing merchantId/productId." });
  }
  if (!feedback) {
    return jsonResponse({ success: false, error: "Feedback text is empty." });
  }
  if (!acmName) {
    return jsonResponse({ success: false, error: "Missing logged-in user name." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getMatchesSheet();
    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(sheet.getLastColumn(), MATCHES_FEEDBACK_FIRST_COL - 1);
    if (lastRow < 2) return jsonResponse({ success: false, error: "Matches sheet has no data rows." });

    // Column B = PRODUCT_ID, Column D = Merchant ID — find the row for this
    // exact match. If the same (merchant, product) pair appears more than
    // once, every matching row gets the feedback written (kept consistent).
    var idsRange = sheet.getRange(2, 2, lastRow - 1, 3).getValues(); // B:D -> [PRODUCT_ID, PRODUCT_NAME, Merchant ID]
    var matchingRows = [];
    for (var i = 0; i < idsRange.length; i++) {
      var rowProductId = String(idsRange[i][0] || "").trim();
      var rowMerchantId = String(idsRange[i][2] || "").trim();
      if (rowProductId === productId && rowMerchantId === merchantId) {
        matchingRows.push(i + 2); // sheet row number (1-based, +1 for header)
      }
    }
    if (!matchingRows.length) {
      return jsonResponse({ success: false, error: "No matching row found for this merchant/product." });
    }

    // Find (or create) today's date column, starting from K.
    var todayLabel = formatFeedbackDateLabel(new Date());
    var headerRange = lastCol >= MATCHES_FEEDBACK_FIRST_COL
      ? sheet.getRange(1, MATCHES_FEEDBACK_FIRST_COL, 1, lastCol - MATCHES_FEEDBACK_FIRST_COL + 1).getValues()[0]
      : [];
    var todayColIdx = -1; // 0-based within headerRange
    for (var h = 0; h < headerRange.length; h++) {
      if (String(headerRange[h] || "").trim() === todayLabel) { todayColIdx = h; break; }
    }
    var todayCol;
    if (todayColIdx === -1) {
      todayCol = lastCol + 1; // append a brand-new column at the end
      sheet.getRange(1, todayCol).setValue(todayLabel);
    } else {
      todayCol = MATCHES_FEEDBACK_FIRST_COL + todayColIdx;
    }

    // Overwrite (no history) — last feedback of the day replaces the cell.
    // Store the ACM name alongside the text so the cell is self-describing
    // in the sheet even without opening the dashboard.
    var cellValue = feedback + " — " + acmName;
    matchingRows.forEach(function (rowNum) {
      sheet.getRange(rowNum, todayCol).setValue(cellValue);
    });

    return jsonResponse({ success: true, dateLabel: todayLabel, rowsUpdated: matchingRows.length });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Matches the "16-Aug" style label already used as an example column header
// in the sheet — day-of-month (no leading zero) + "-" + 3-letter month name.
function formatFeedbackDateLabel(d) {
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d.getDate() + "-" + months[d.getMonth()];
}

/**
 * ============================================================================
 *  RECOMMENDED TRACKER — AUTO-ADD NEW LOCKED MATCHES
 * ============================================================================
 *  js/app.js (syncNewLockedMatchesToSheet, called from prepareRecommendedTrackerData)
 *  posts here whenever it finds a (Merchant × Single SKU) pair that has an
 *  active Availability Locking lock but no matching row in this sheet yet —
 *  i.e. someone locked a merchant/SKU but never added it as a tracked match.
 *  Each one gets appended as a brand-new row so it shows up in the sheet from
 *  then on exactly like any manually-added match, with:
 *    A Type = "New Locked"  B PRODUCT_ID  C PRODUCT_NAME  D Merchant ID
 *    E Merchant  F Stock  G Action (left blank)  H Starting Cogs
 *    I Merchant Starting AVG  J SKU Starting AVG
 *  Any (PRODUCT_ID, Merchant ID) pair that already exists in the sheet is
 *  skipped — checked server-side too (not just client-side), so two tabs/
 *  users racing to add the same one can't create a duplicate row.
 * ============================================================================
 */
function handleAddNewLockedMatches(payload) {
  var rows = payload.rows;
  if (!rows || !rows.length) return jsonResponse({ success: false, error: "No rows provided." });

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getMatchesSheet();
    var lastRow = sheet.getLastRow();

    // Existing (PRODUCT_ID, Merchant ID) pairs already in the sheet.
    var existingKeys = {};
    if (lastRow >= 2) {
      var idsRange = sheet.getRange(2, 2, lastRow - 1, 3).getValues(); // B:D -> [PRODUCT_ID, PRODUCT_NAME, Merchant ID]
      for (var i = 0; i < idsRange.length; i++) {
        var pid = String(idsRange[i][0] || "").trim();
        var mid = String(idsRange[i][2] || "").trim();
        if (pid && mid) existingKeys[pid + "||" + mid] = true;
      }
    }

    var toAppend = [];
    rows.forEach(function (r) {
      var productId = String(r.productId || "").trim();
      var merchantId = String(r.merchantId || "").trim();
      if (!productId || !merchantId) return;
      var key = productId + "||" + merchantId;
      if (existingKeys[key]) return; // already tracked — skip
      existingKeys[key] = true; // also guards against duplicates within this same request

      toAppend.push([
        "New Locked",                        // A Type
        productId,                           // B PRODUCT_ID
        String(r.productName || ""),         // C PRODUCT_NAME
        merchantId,                          // D Merchant ID
        String(r.merchant || ""),            // E Merchant
        Number(r.stock) || 0,                // F Stock
        "",                                  // G Action — left blank for an ACM to fill in
        Number(r.startingCogs) || 0,         // H Starting Cogs
        Number(r.merchantStartingAvg) || 0,  // I Merchant Starting AVG
        Number(r.skuStartingAvg) || 0        // J SKU Starting AVG
      ]);
    });

    if (toAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 10).setValues(toAppend);
    }

    return jsonResponse({ success: true, added: toAppend.length, skipped: rows.length - toAppend.length });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getMatchesSheet() {
  var ss = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === PRODUCTS_MATCHES_GID) return sheets[i];
  }
  throw new Error("Products/Matches sheet with GID " + PRODUCTS_MATCHES_GID + " was not found.");
}

// PRESENCE ("who's online") is no longer handled here — it moved entirely to
// Cloudflare Worker KV storage (js/auth.js talks to the Worker directly via
// action=heartbeat/getOnlineUsers on CONFIG.WORKER_URL), since presence data
// is ephemeral and doesn't need to live in a Google Sheet or Apps Script at
// all. See cloudflare-worker/worker.js: handleHeartbeat/handleGetOnlineUsers.

/**
 * Snapshot backups arrive as a sequence of small POSTs (see
 * backupSnapshotToDrive() in app.js) instead of one big one — the client
 * gzips the snapshot first, but even gzipped it can run 8MB+, which is
 * still over what Google's front-end accepts in a single request to an
 * Apps Script Web App ("413 Content Too Large"). Each chunk gets written
 * to a temp file named "<uploadId>.<chunkIndex>"; once the last chunk for
 * an uploadId arrives, all its pieces are read back in order, concatenated,
 * gunzipped, and written as the final snapshot-*.json file.
 */
function handleBackupChunk(payload) {
  try {
    var uploadId = String(payload.uploadId || "");
    var chunkIndex = Number(payload.chunkIndex);
    var totalChunks = Number(payload.totalChunks);
    var chunkData = String(payload.chunkData || "");
    if (!uploadId || !isFinite(chunkIndex) || !isFinite(totalChunks) || !chunkData) {
      return jsonResponse({ success: false, message: "Malformed chunk." });
    }

    var tmpFolder = getOrCreateChunkFolder();
    tmpFolder.createFile(uploadId + "." + chunkIndex, chunkData, MimeType.PLAIN_TEXT);

    if (chunkIndex === totalChunks - 1) {
      finalizeChunkedBackup(tmpFolder, uploadId, totalChunks);
    }

    cleanupStaleChunks(tmpFolder);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

function finalizeChunkedBackup(tmpFolder, uploadId, totalChunks) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var base64 = "";
    for (var i = 0; i < totalChunks; i++) {
      var files = tmpFolder.getFilesByName(uploadId + "." + i);
      if (!files.hasNext()) throw new Error("Missing chunk " + i + " for upload " + uploadId);
      base64 += files.next().getBlob().getDataAsString();
    }

    var gzBytes = Utilities.base64Decode(base64);
    var gzBlob = Utilities.newBlob(gzBytes, "application/x-gzip", "snapshot.json.gz");
    var jsonBlob = Utilities.ungzip(gzBlob);
    var jsonText = jsonBlob.getDataAsString();

    // Validate it's actually parseable JSON before writing it to Drive —
    // no point keeping a corrupt backup.
    JSON.parse(jsonText);

    var folder = getOrCreateBackupFolder();
    var fileName = "snapshot-" + Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd'T'HH-mm-ss'Z'") + ".json";
    folder.createFile(fileName, jsonText, MimeType.PLAIN_TEXT);

    pruneOldBackups(folder);

    // Clean up this upload's chunk files now that the final file is written.
    for (var j = 0; j < totalChunks; j++) {
      var toDelete = tmpFolder.getFilesByName(uploadId + "." + j);
      while (toDelete.hasNext()) toDelete.next().setTrashed(true);
    }
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateChunkFolder() {
  var backupFolder = getOrCreateBackupFolder();
  var name = "_tmp_chunks";
  var existing = backupFolder.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return backupFolder.createFolder(name);
}

// A chunk can be orphaned if a page closes mid-upload before the last
// chunk goes out. Without this, those partial files would sit in
// _tmp_chunks forever — sweep anything older than a day.
function cleanupStaleChunks(tmpFolder) {
  var cutoff = Date.now() - 24 * 60 * 60 * 1000;
  var files = tmpFolder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated().getTime() < cutoff) f.setTrashed(true);
  }
}

function getOrCreateBackupFolder() {
  if (BACKUP_FOLDER_ID) {
    return DriveApp.getFolderById(BACKUP_FOLDER_ID);
  }
  var existing = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (existing.hasNext()) return existing.next();
  var created = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  Logger.log("Created backup folder. Paste this into BACKUP_FOLDER_ID: " + created.getId());
  return created;
}

function pruneOldBackups(folder) {
  var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  var list = [];
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf("snapshot-") === 0) list.push(f);
  }
  if (list.length <= BACKUP_KEEP_LAST_N) return;
  list.sort(function (a, b) { return a.getDateCreated() - b.getDateCreated(); });
  var toDelete = list.length - BACKUP_KEEP_LAST_N;
  for (var i = 0; i < toDelete; i++) list[i].setTrashed(true);
}

/**
 * ============================================================================
 *  DATA API — v1.1.46: كل الـ 21 شيت الباقيين (غير Main/Confirmed by Day/
 *  Incentive Merchants، اللي ليهم مسارهم الخاص على الـ Worker) بقوا بيتقروا
 *  من هنا بس (Apps Script) — مش متقسمين مع الـ Cloudflare Worker زي الأول.
 *
 *  السبب: كان مقسّم نُص/نُص عشان حد الـ CPU بتاع الـ Worker، لكن Cloudflare
 *  Observability أثبتت إن الحد الحقيقي لخطة الـ Worker (Free) حوالي 10ms
 *  CPU بس لكل تشغيلة cron — رقم ضيق جدًا مستحيل يكفي لقراءة/تحليل حتى شيت
 *  واحد بشكل موثوق، فالـ Worker كان بيفشل (exceededCpu) في كل تشغيلة cron
 *  تقريبًا، وده كان سبب إن "General Sync — Worker" في مودال "Worker Sync
 *  Status" فاضل عالق/قديم دايمًا.
 *
 *  Apps Script (هنا، عن طريق Time-driven trigger) معندهوش نفس حد الـ
 *  CPU-ms ده (وقت التنفيذ بيتحدد بالدقايق مش الـ milliseconds — لحد 6
 *  دقايق)، فبقى هو المصدر الوحيد لكل الـ 21 شيت مع بعض، بنفس آلية الاستقرار
 *  القديمة (قراءتين بفاصل 6 ثواني، فحص نزول عدد الصفوف المفاجئ)، ومخزّنين
 *  في ملف على Drive. النتيجة: كل الـ 21 شيت دول بتتحدث فعليًا مع بعض في
 *  نفس الوقت كل 5 دقايق، مش متقسمة بين مصدرين بتوقيتات مختلفة زي الأول.
 *
 *  الفرونت اند (js/app.js، fetchAllSheetsSnapshot) لسه بيقرا من DATA_API_URL
 *  (هنا) وSYNC_CDN_URL (الـ Worker، لسه مسؤول عن Main/Confirmed by Day/
 *  Incentive Merchants بس) بالتوازي ويدمجهم — الكود ده اتصمم أصلاً يقبل أي
 *  توزيع بين المصدرين من غير أي تغيير.
 *
 *  ⚠️ SETUP MANUAL مطلوب: من محرر Apps Script → أيقونة الساعة (Triggers) →
 *  + Add Trigger → Function: runScheduledSync → Time-driven → Minutes timer
 *  → Every 5 minutes → Save. من غير الخطوة دي، runScheduledSync() مش هيتنفذ
 *  لوحده أبدًا.
 *
 *  Call: GET <deployment URL>?action=getLastSync[&group=irq] | getLastSyncMeta
 *  (v1.10.0: the Worker caches these two — Apps Script stays the producer.)
 * ============================================================================
 */
function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : null;
  // v1.16.0: once the Script Property SERVICE_KEY is set, the data reads below answer only the dashboard Worker
  // (it sends &k=<APPS_SCRIPT_SERVICE_KEY>). Browsers read the same data through the Worker, behind the staff login.
  var svc = PropertiesService.getScriptProperties().getProperty("SERVICE_KEY") || "";
  if (svc && /^(getLastSync|getLastSyncMeta|getLastSyncDebug|getAnalystSingleDailyMeta)$/.test(String(action)) && String((e && e.parameter && e.parameter.k) || "") !== svc) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Not authorized." })).setMimeType(ContentService.MimeType.JSON);
  }
  if (action === "getLastSync") return handleGetLastSync(e);
  if (action === "getLastSyncMeta") return handleGetLastSyncMeta(e);
  if (action === "getLastSyncDebug") return handleGetLastSyncDebug(e);
  if (action === "getAnalystSingleDailyMeta") return handleGetAnalystSingleDailyMeta(e);
  return jsonResponse({ success: false, message: "Unknown action." });
}

// v1.1.46: كل الـ 21 شيت (كل حاجة غير Main/Confirmed by Day/Incentive
// Merchants) بقوا بيتقروا من هنا بس — مش متقسمين مع الـ Worker زي الأول
// (راجع الكومنت فوق GENERAL_MIRROR_GIDS في worker.js). السبب: Cloudflare
// Observability أثبتت إن الـ CPU budget الحقيقي لخطة الـ Worker (Free)
// حوالي 10ms بس لكل تشغيلة cron، وده مستحيل يكفي لأي عدد شيتات حقيقي
// (fetch + JSON.parse + fingerprint) — فكان الـ Worker بيفشل (exceededCpu)
// في كل تشغيلة تقريبًا، وده سبب إن "General Sync — Worker" كان دايمًا
// عالق/قديم. Apps Script (Time-driven trigger هنا) معندهوش نفس حد الـ
// CPU-ms ده، فبقى هو المصدر الوحيد — بيقرا كل الـ 21 شيت مع بعض في تنفيذة
// واحدة كل 5 دقايق (fetchSheetsPayloadStable_ تحت)، يعني كل الشيتات دي
// بتتحدث فعليًا مع بعض في نفس الوقت، مش مقسّمة بين مصدرين مختلفين بتوقيتات
// مختلفة زي الأول.
// v1.3.48: اتشال 9 GIDs اتنقلوا لـ Metabase API (بيتقروا من المتصفح مباشرة — METABASE_SOURCES في js/app.js)
// + شيت Segmentation (891214324) اتلغى. الباقي (16 شيت) لسه بيتقرا من Google Sheets.
var LAST_SYNC_GIDS = [
  "1620722565",  // SINGLE_SKU_TARGETS_GID
  "1724469150",  // COGS_GID
  String(PRODUCTS_MATCHES_GID), // 1298408207
  "1289659887",  // WEEKLY_INVENTORY_GID
  "897709273",   // WAREHOUSE_REPACK_GID
  "757777690",   // SUPPLY_REPACK_GID (Targets > Supply Conversion)
  // v1.1.46: الـ 10 شيت دول كانوا بيتقروا من الـ Worker مباشرة
  // (GENERAL_MIRROR_GIDS في worker.js) — دلوقتي بقوا هنا زي كل شيت تاني.
  "115442405",   // TARGETS_GID
  "2042936628",  // TARGETS_ACM_GID
  "1780730573",  // INVENTORY_GID
  "1656655269",  // CAT_TARGETS_GID
  // "892918900" (ACM_SALES_PLAN_GID) — v1.18.0: no longer read; Sales Plan-ACM uses the month's uploaded targets
  "565878313",   // INBOUND_GID
  // v1.1.58 — Sellthrough Rate Panel EGY/IRQ toggle (Products Info فوق بيتشارك
  // مع IRQ، نفس الشيت بيتفلتر بعمود COUNTRY في app.js).
  "997714491",   // IRQ_SELLTHROUGH_NEEDED_GID
  "879952880",   // IRQ_INBOUND_GID
  "827189174",   // IRQ_BEGIN_INV_GID
  "775718300",   // IRQ_COGS_GID
  "133618857"    // IRQ_INVENTORY_GID — شيت "inv-IRQ" (v1.1.60)
];

var LAST_SYNC_FOLDER_NAME = "Performance Dashboard Last Sync";
var LAST_SYNC_FILE_NAME = "last_sync.json.gz";
// v1.3.53: شيتات العراق (5 شيتات ~25% من الحجم) في ملف منفصل — الداشبورد بيحمّلها في الخلفية
// (getLastSync&group=irq) بعد ما الداتا الأساسية تظهر، فرد getLastSync الأساسي بقى أصغر وأسرع.
var LAST_SYNC_IRQ_FILE_NAME = "last_sync_irq.json.gz";
var IRQ_SYNC_GIDS_ = ["997714491", "879952880", "827189174", "775718300", "133618857"];
function splitCoreAndIrqSheets_(sheets) {
  var core = {}, irq = {};
  Object.keys(sheets || {}).forEach(function (gid) {
    if (IRQ_SYNC_GIDS_.indexOf(gid) !== -1) irq[gid] = sheets[gid]; else core[gid] = sheets[gid];
  });
  return { core: core, irq: irq };
}
function writeGzFile_(folder, fileName, obj) {
  var gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), "application/json"), fileName);
  var old = folder.getFilesByName(fileName);
  while (old.hasNext()) { old.next().setTrashed(true); }
  folder.createFile(gz);
}
var LAST_SYNC_META_PROP_KEY = "last_sync_fetched_at_v1";

// بصمة رخيصة لشيت (عدد الصفوف + طول أول/آخر صف + طول الأعمدة) — كافية
// عمليًا لاكتشاف "الشيت لسه بيتغيّر وقت القراءة".
function sheetFingerprint_(sheet) {
  if (!sheet || !sheet.table || !sheet.table.rows) return null;
  var rows = sheet.table.rows;
  var n = rows.length;
  var first = n ? JSON.stringify(rows[0]) : "";
  var last = n ? JSON.stringify(rows[n - 1]) : "";
  return n + "|" + first.length + "|" + last.length + "|" + JSON.stringify(sheet.table.cols || []).length;
}

function computeSyncContentHash_(sheets, gids) {
  var parts = gids.map(function (gid) {
    return gid + ":" + (sheetFingerprint_(sheets[gid]) || "null");
  });
  var raw = parts.join("|");
  var digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return digestBytes.map(function (b) {
    var v = (b < 0) ? b + 256 : b;
    var hex = v.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

var SYNC_STABILITY_WAIT_MS = 6000;
var SUSPICIOUS_ROW_DROP_RATIO = 0.5;
var MIN_ROWS_FOR_DROP_CHECK = 20;
function sheetRowCount_(sheet) {
  return (sheet && sheet.table && sheet.table.rows) ? sheet.table.rows.length : 0;
}

function gvizRequest_(gid) {
  return {
    url: "https://docs.google.com/spreadsheets/d/" + WEBSITE_EGY_SHEET_ID + "/gviz/tq?gid=" + encodeURIComponent(gid) + "&tqx=out:json",
    muteHttpExceptions: true,
    followRedirects: true
  };
}

function fetchSheetsPayload_(gids) {
  var requests = gids.map(gvizRequest_);
  var responses = UrlFetchApp.fetchAll(requests);

  var sheets = {};
  var failedGids = [];
  gids.forEach(function (gid, i) {
    var parsed = parseGvizResponse(responses[i]);
    sheets[gid] = parsed;
    if (parsed === null) failedGids.push(gid);
  });

  if (failedGids.length) {
    Utilities.sleep(1000);
    var retryResponses = UrlFetchApp.fetchAll(failedGids.map(gvizRequest_));
    failedGids.forEach(function (gid, i) {
      var parsed = parseGvizResponse(retryResponses[i]);
      if (parsed !== null) sheets[gid] = parsed;
    });
  }

  return { fetchedAt: new Date().toISOString(), sheets: sheets };
}

function fetchSheetsPayloadStable_(gids, previousSheets) {
  var first = fetchSheetsPayload_(gids);
  Utilities.sleep(SYNC_STABILITY_WAIT_MS);
  var second = fetchSheetsPayload_(gids);

  var sheets = {};
  var unstableGids = [];
  gids.forEach(function (gid) {
    var a = first.sheets[gid], b = second.sheets[gid];
    var fpA = sheetFingerprint_(a), fpB = sheetFingerprint_(b);
    var isStable = (b && fpB !== null && fpA === fpB);

    if (isStable) {
      var prevSheet = previousSheets ? previousSheets[gid] : null;
      var prevCount = prevSheet ? sheetRowCount_(prevSheet) : 0;
      var newCount = sheetRowCount_(b);
      var suspicious = prevSheet && prevCount >= MIN_ROWS_FOR_DROP_CHECK && newCount < (prevCount * SUSPICIOUS_ROW_DROP_RATIO);
      if (suspicious) {
        sheets[gid] = prevSheet;
        unstableGids.push(gid);
      } else {
        sheets[gid] = b;
      }
    } else if (previousSheets && previousSheets[gid] != null) {
      sheets[gid] = previousSheets[gid];
      unstableGids.push(gid);
    } else {
      sheets[gid] = b || a;
      if (!isStable) unstableGids.push(gid);
    }
  });

  return { fetchedAt: second.fetchedAt, sheets: sheets, unstableGids: unstableGids };
}

// v1.3.51: الشيتات اللي محتواها متطابق بالظبط (زي Products & Matches و Inventory — نفس الـ 14,557 صف)
// بتتبعت مرة واحدة والباقي بيتبعت كـ {__alias: gid}. بيقلل حجم رد getLastSync (ده اللي بيبطّأ ويفشل
// عبر script.googleusercontent.com/macros/echo). الداشبورد بيفك الـ alias بعد الـ ungzip.
function aliasDuplicateSheets_(sheets) {
  var seen = {}, out = {};
  Object.keys(sheets || {}).forEach(function (gid) {
    var sh = sheets[gid];
    if (!sh || !sh.table || !sh.table.rows || sh.table.rows.length < 500) { out[gid] = sh; return; }
    var key = JSON.stringify(sh);
    if (seen[key]) { out[gid] = { __alias: seen[key] }; } else { seen[key] = gid; out[gid] = sh; }
  });
  return out;
}
function expandSheetAliases_(sheets) {
  Object.keys(sheets || {}).forEach(function (gid) {
    var sh = sheets[gid];
    if (sh && sh.__alias && sheets[sh.__alias]) sheets[gid] = sheets[sh.__alias];
  });
  return sheets;
}

// بتتنادى من الـ Time-driven trigger (راجع الكومنت فوق doGet للـ setup).
function runScheduledSync() {
  var folder = getOrCreateLastSyncFolder_();
  var previous = readLastSyncPayload_(folder);
  var payload = fetchSheetsPayloadStable_(LAST_SYNC_GIDS, previous ? previous.sheets : null);

  if (payload.unstableGids && payload.unstableGids.length) {
    PropertiesService.getScriptProperties().setProperty("last_sync_unstable_gids_v1", payload.unstableGids.join(","));
  } else {
    PropertiesService.getScriptProperties().deleteProperty("last_sync_unstable_gids_v1");
  }

  var split = splitCoreAndIrqSheets_(payload.sheets);
  // الـ IRQ الأول (لو الكتابة التانية فشلت، الأساسي يفضل على النسخة القديمة اللي فيها كل حاجة)
  writeGzFile_(folder, LAST_SYNC_IRQ_FILE_NAME, { success: true, fetchedAt: payload.fetchedAt, sheets: split.irq });
  writeGzFile_(folder, LAST_SYNC_FILE_NAME, { success: true, fetchedAt: payload.fetchedAt, sheets: aliasDuplicateSheets_(split.core) });
  var oldArchive = folder.getFilesByName("archive.gz");
  while (oldArchive.hasNext()) { oldArchive.next().setTrashed(true); }

  var props = PropertiesService.getScriptProperties();
  var contentHash = computeSyncContentHash_(payload.sheets, LAST_SYNC_GIDS);
  var previousHash = props.getProperty("last_sync_content_hash_v1");
  var isFirstRunEver = !props.getProperty(LAST_SYNC_META_PROP_KEY);
  props.setProperty("last_sync_content_hash_v1", contentHash);
  if (isFirstRunEver || previousHash !== contentHash) {
    props.setProperty(LAST_SYNC_META_PROP_KEY, payload.fetchedAt);
  }
}

function readLastSyncPayload_(folder) {
  try {
    var files = folder.getFilesByName(LAST_SYNC_FILE_NAME);
    if (!files.hasNext()) return null;
    var text = Utilities.ungzip(files.next().getBlob()).getDataAsString();
    var parsed = JSON.parse(text);
    if (parsed && parsed.sheets) {
      expandSheetAliases_(parsed.sheets);
      try {
        var irqFiles = folder.getFilesByName(LAST_SYNC_IRQ_FILE_NAME);
        if (irqFiles.hasNext()) {
          var irqParsed = JSON.parse(Utilities.ungzip(irqFiles.next().getBlob()).getDataAsString());
          Object.keys((irqParsed && irqParsed.sheets) || {}).forEach(function (g) { parsed.sheets[g] = irqParsed.sheets[g]; });
        }
      } catch (e2) { /* previous IRQ غير متاح — مش مشكلة */ }
    }
    return (parsed && parsed.sheets) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function handleGetLastSync(e) {
  try {
    var folder = getOrCreateLastSyncFolder_();
    if (e && e.parameter && e.parameter.group === "irq") {
      var irqFiles = folder.getFilesByName(LAST_SYNC_IRQ_FILE_NAME);
      if (!irqFiles.hasNext()) return jsonResponse({ success: true, fetchedAt: null, sheets: {} }); // لسه أول مزامنة بعد الديبلوي — الداشبورد بيكمل بمن غيرها
      var irqBlob = irqFiles.next().getBlob();
      return jsonResponse({ success: true, fetchedAt: PropertiesService.getScriptProperties().getProperty(LAST_SYNC_META_PROP_KEY) || null, gzBase64: Utilities.base64Encode(irqBlob.getBytes()) });
    }
    var files = folder.getFilesByName(LAST_SYNC_FILE_NAME);
    if (files.hasNext()) {
      var gzBlob = files.next().getBlob();
      var fetchedAt = PropertiesService.getScriptProperties().getProperty(LAST_SYNC_META_PROP_KEY) || null;
      var base64 = Utilities.base64Encode(gzBlob.getBytes());
      return jsonResponse({ success: true, fetchedAt: fetchedAt, gzBase64: base64 });
    }
    // Fallback: لسه مفيش أي مزامنة مركزية اتسجلت — بنرجع لجلب لايف عادي.
    var payload = fetchSheetsPayload_(LAST_SYNC_GIDS.filter(function (g) { return IRQ_SYNC_GIDS_.indexOf(g) === -1; }));
    var content = JSON.stringify({ success: true, fetchedAt: payload.fetchedAt, sheets: aliasDuplicateSheets_(payload.sheets) });
    var gz = Utilities.gzip(Utilities.newBlob(content, "application/json"));
    return jsonResponse({ success: true, fetchedAt: payload.fetchedAt, gzBase64: Utilities.base64Encode(gz.getBytes()) });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

function handleGetLastSyncMeta(e) {
  var props = PropertiesService.getScriptProperties();
  var fetchedAt = props.getProperty(LAST_SYNC_META_PROP_KEY) || null;
  var unstable = props.getProperty("last_sync_unstable_gids_v1") || null;
  return jsonResponse({ success: true, fetchedAt: fetchedAt, unstableGids: unstable ? unstable.split(",") : [] });
}

var LAST_SYNC_GID_LABELS_ = { "1620722565": "SKU Targets (Bundle & Single)",
  "1724469150": "COGS",
  "1298408207": "Products & Matches", "1289659887": "Weekly Inventory",
  "897709273": "Warehouse Repack",
  "757777690": "Repack (Supply Conversion)",
  "115442405": "Targets",
  "2042936628": "Targets ACM", "1780730573": "Inventory", "1656655269": "Category Targets",
  "565878313": "Inbound",
  "997714491": "IRQ Sell-through Needed", "879952880": "IRQ Inbound",
  "827189174": "IRQ Beginning Inventory", "775718300": "IRQ COGS",
  "133618857": "IRQ Inventory (inv-IRQ)"
};

function handleGetLastSyncDebug(e) {
  try {
    var folder = getOrCreateLastSyncFolder_();
    var cached = readLastSyncPayload_(folder);
    var source = cached ? "cached_file" : "live_fallback";
    var payload = cached || fetchSheetsPayload_(LAST_SYNC_GIDS);

    var report = LAST_SYNC_GIDS.map(function (gid) {
      var sheet = payload.sheets ? payload.sheets[gid] : undefined;
      var rows = (sheet && sheet.table && sheet.table.rows) ? sheet.table.rows.length : null;
      return {
        gid: gid,
        label: LAST_SYNC_GID_LABELS_[gid] || gid,
        status: sheet ? "ok" : "NULL/EMPTY",
        rowCount: rows
      };
    });

    var unstable = PropertiesService.getScriptProperties().getProperty("last_sync_unstable_gids_v1") || "";
    var unstableLabeled = unstable ? unstable.split(",").map(function (gid) { return LAST_SYNC_GID_LABELS_[gid] || gid; }) : [];

    return jsonResponse({ success: true, source: source, fetchedAt: payload.fetchedAt, sheets: report, unstableAtLastRun: unstableLabeled });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

function getOrCreateLastSyncFolder_() {
  var existing = DriveApp.getFoldersByName(LAST_SYNC_FOLDER_NAME);
  if (existing.hasNext()) return existing.next();
  return DriveApp.createFolder(LAST_SYNC_FOLDER_NAME);
}

function parseGvizResponse(res) {
  if (!res || res.getResponseCode() !== 200) return null;

  var text = res.getContentText();
  var match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) return null;

  try {
    var parsed = eval("(" + match[1] + ")");
    if (parsed && parsed.status === "error") return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function handleSignup(payload) {
  var name = String(payload.name || "").trim();
  var email = String(payload.email || "").trim().toLowerCase();
  var password = String(payload.password || "");
  var role = String(payload.role || "").trim();

  if (!name || !email || !password || !role) {
    return jsonResponse({ success: false, message: "All fields are required." });
  }
  if (!isAllowedEmail(email)) {
    return jsonResponse({
      success: false,
      message: "Sign up is only allowed with an @" + ALLOWED_EMAIL_DOMAIN + " email, or an email an admin invited.",
    });
  }
  if (password.length < 6) {
    return jsonResponse({ success: false, message: "Password must be at least 6 characters." });
  }
  // v1.15.49: محدش يسجل نفسه Admin / Country Manager — الأدمن هو اللي بيدي الرول ده من Users & Roles
  if (["admin", "country manager"].indexOf(role.toLowerCase()) !== -1) {
    return jsonResponse({ success: false, message: "This role can only be given by an admin." });
  }
  // v1.16.0: الميرشنتس ليهم بورتال منفصل — الداشبورد ده للموظفين بس
  if (role.toLowerCase() === "merchant" || role.toLowerCase() === "viewer") {
    return jsonResponse({ success: false, message: "Merchants sign in on the Taager merchant portal, not here." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var existingEmail = String(data[i][1] || "").trim().toLowerCase();
      if (existingEmail === email) {
        return jsonResponse({ success: false, message: "This email is already registered." });
      }
    }

    sheet.appendRow([name, email, hashPassword_(password), role]);
    return jsonResponse({ success: true, name: name, email: email, role: role });
  } finally {
    lock.releaseLock();
  }
}

function handleLogin(payload) {
  var email = String(payload.email || "").trim().toLowerCase();
  var password = String(payload.password || "");

  if (!email || !password) {
    return jsonResponse({ success: false, message: "Email and password are required." });
  }

  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][1] || "").trim().toLowerCase();
    if (rowEmail === email) {
      var rowPassword = String(data[i][2] || "");
      if (verifyPassword_(password, rowPassword)) {
        // v1.16.0: باسورد قديم متخزن نص عادي → يتحول لـ hash أول ما صاحبه يعمل لوجين صح
        if (rowPassword.indexOf("h1$") !== 0) { try { sheet.getRange(i + 1, 3).setValue(hashPassword_(password)); } catch (e) {} }
        return jsonResponse({
          success: true,
          name: data[i][0],
          email: rowEmail,
          role: data[i][3],
        });
      }
      return jsonResponse({ success: false, message: "Incorrect password." });
    }
  }

  return jsonResponse({ success: false, message: "No account found with this email." });
}

// v1.4.0: قائمة اليوزرز المسجلين (name/email/role فقط — مفيش باسوردات أبدًا) لصفحة
// Users & Roles. محمية بنفس مفتاح COMPUTED_API_KEYS.
function handleListUsers(payload) {
  var key = String(payload.key || "");
  if (!key || getApiKeys_().indexOf(key) < 0) {
    return jsonResponse({ success: false, message: "Wrong key." });
  }
  var data = getUsersSheet().getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var email = String(data[i][1] || "").trim().toLowerCase();
    if (!email) continue;
    users.push({ name: String(data[i][0] || ""), email: email, role: String(data[i][3] || "") });
  }
  return jsonResponse({ success: true, users: users });
}

// ============================================================================
//  v1.17.0 — "Forgot your password?" (the Worker makes the one-time link and checks it;
//  this script only looks the user up, saves the new password as a hash, and can send the email).
// ============================================================================
function workerKeyOk_(payload) {
  var k = PropertiesService.getScriptProperties().getProperty("WORKER_SERVICE_KEY") || "";
  return k.length >= 16 && String(payload.serviceKey || "") === k;
}
function findUserRow_(email) {
  email = String(email || "").trim().toLowerCase();
  var sheet = getUsersSheet(), data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][1] || "").trim().toLowerCase() === email) return { sheet: sheet, row: i + 1, name: data[i][0] };
  return null;
}
function handleStaffUserCheck_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  var u = findUserRow_(payload.email);
  return jsonResponse({ success: true, exists: !!u, name: u ? String(u.name || "") : "" });
}
function handleStaffAuthRecord_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  var u = findUserRow_(payload.email);
  if (!u) return jsonResponse({ success: true, exists: false });
  var row = u.sheet.getRange(u.row, 1, 1, 4).getValues()[0];
  return jsonResponse({ success: true, exists: true, name: String(row[0] || ""), email: String(row[1] || "").trim().toLowerCase(), role: String(row[3] || ""), hash: String(row[2] || "") });
}
function handleStaffSetPassword_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  var pw = String(payload.password || "");
  if (pw.length < 8) return jsonResponse({ success: false, message: "The password needs at least 8 characters." });
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var u = findUserRow_(payload.email);
    if (!u) return jsonResponse({ success: false, message: "No account found with this email." });
    u.sheet.getRange(u.row, 3).setValue(hashPassword_(pw));
    return jsonResponse({ success: true });
  } finally { lock.releaseLock(); }
}
function handleStaffSendResetMail_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  var u = findUserRow_(payload.email); // only ever to a real dashboard user
  if (!u) return jsonResponse({ success: false, message: "No account found with this email." });
  MailApp.sendEmail({ to: String(payload.email).trim().toLowerCase(), subject: String(payload.subject || "Reset your password").slice(0, 120), htmlBody: String(payload.html || ""), name: "Center Control", body: "Open this email in an HTML-capable client to reset your password." });
  return jsonResponse({ success: true });
}

function getUsersSheet() {
  var ss = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === USERS_SHEET_GID) return sheets[i];
  }
  throw new Error("Users sheet with GID " + USERS_SHEET_GID + " was not found.");
}

// ---------------------------------------------------------------------------
// v1.16.0 — Password hashing: "h1$<iterations>$<saltHex>$<hashHex>" (iterated HMAC-SHA256 with a random salt).
// Plain-text rows (older accounts) still log in once and are rewritten as a hash on that login.
// ---------------------------------------------------------------------------
var PW_ITERATIONS_ = 1500;
function bytesToHex_(bytes) { return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join(""); }
function pwDigest_(password, saltHex, iterations) {
  var h = Utilities.computeHmacSha256Signature(saltHex, password);
  for (var i = 1; i < iterations; i++) h = Utilities.computeHmacSha256Signature(h, Utilities.newBlob(password).getBytes());
  return bytesToHex_(h);
}
function hashPassword_(password) {
  var salt = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random())).slice(0, 32);
  return "h1$" + PW_ITERATIONS_ + "$" + salt + "$" + pwDigest_(password, salt, PW_ITERATIONS_);
}
function verifyPassword_(password, stored) {
  stored = String(stored || "");
  if (stored.indexOf("h1$") !== 0) return stored !== "" && stored === password; // legacy plain text
  var p = stored.split("$"); if (p.length !== 4) return false;
  var calc = pwDigest_(password, p[2], Number(p[1]) || PW_ITERATIONS_), want = p[3], diff = calc.length ^ want.length;
  for (var i = 0; i < Math.min(calc.length, want.length); i++) diff |= calc.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

function isAllowedEmail(email) {
  var re = new RegExp("^[^\\s@]+@" + ALLOWED_EMAIL_DOMAIN.replace(".", "\\.") + "$", "i");
  if (re.test(email)) return true;
  // v1.15.1: anyone an admin added in Control > Users & Roles may sign up, whatever the email domain.
  try {
    var svcKey = PropertiesService.getScriptProperties().getProperty("WORKER_SERVICE_KEY") || "";
    var res = UrlFetchApp.fetch(ACCESS_CONFIG_URL, { muteHttpExceptions: true, headers: svcKey ? { "X-Service-Key": svcKey } : {} });
    var cfg = JSON.parse(res.getContentText());
    var u = cfg && cfg.users && cfg.users[String(email).trim().toLowerCase()];
    var role = u && (typeof u === "string" ? u : u.role);
    return !!u && role !== "Merchant" && role !== "Viewer"; // v1.16.0: merchants use the merchant portal
  } catch (e) { return false; }
}


// ============================================================================
//  DECLINE WATCH — daily "Top 20 declining matches" email
//  Called by the dashboard's "Send me this email" button (js/app.js ->
//  sendDeclineDigestEmail). The browser only sends the computed rows; the
//  recipients are fixed HERE (never taken from the request), and the HTML is
//  built server-side from escaped values, so the endpoint can't be used to
//  mail arbitrary people or arbitrary content.
//
//  NOTE: the first time you deploy this, Apps Script asks to authorize the
//  "Send email as you" (MailApp) and "Connect to an external service" (UrlFetchApp) scopes — run any function once from the
//  editor (e.g. testDeclineDigest below) and accept, then redeploy a NEW
//  version of the web app.
// ============================================================================
// ALL emails (the daily 12:00 digest and the one-time intro) go to you + this team list.
var DECLINE_TEAM_RECIPIENTS = [
  "mohamed.rihan@taager.com",
  "somaya.youssef@taager.com",
  "omar.afifi@taager.com",
  "mai.gamal@taager.com",
  "diina.bahgat@taager.com",
  "mayar.maged@taager.com",
  "marwan.gamal@taager.com",
  "amgad.metwally@taager.com",
  "fady.safwat@taager.com",
  "mohamed.khalaf@taager.com",
  "sanaa.lotfy@taager.com",
  "nada.sherif@taager.com",
  "nada.amer@taager.com",
  "asmaa.adel@taager.com",
  "mostafa.medhat@taager.com",
  "nada.atef@taager.com",
  "mahmoud.sameh@taager.com",
  "rawda.emam@taager.com",
  "mohamed.arafa@taager.com",
  "sherif.hafez@taager.com",
  "aya.ahmed@taager.com",
  "mostafa.ashraf@taager.com",
  "youssef.elbaroudy@taager.com"
];
var DECLINE_DIGEST_RECIPIENTS = ["youssef.hanafy@taager.com"].concat(DECLINE_TEAM_RECIPIENTS);
// DELIVERY: if DECLINE_MAIL_RELAY_URL is set, the email is sent by the small
// "Mail Relay" script (backend/MailRelay.gs) deployed from a normal Gmail
// account — this avoids the taager.com DMARC rejection (550 5.7.26) when the
// company domain has no DKIM set up. Leave "" to send directly with MailApp.
var DECLINE_MAIL_RELAY_URL = "https://script.google.com/macros/s/AKfycbxqje_Zf7gNPivcDkmNfjwt2CtApUFD8L2IeQJdxqcyeoyXbpPRHc8DWlhC6aaHWCtP/exec"; // Mail Relay deployed under the taager.com account
var DECLINE_MAIL_RELAY_SECRET = "METUY8tMu1u7vH1pG7tto-3fBTQVZj-Y"; // must match RELAY_SECRET in MailRelay.gs
var DECLINE_DIGEST_MAX_ROWS = 20;
var DECLINE_DIGEST_MIN_GAP_MS = 20 * 1000; // basic flood guard between sends

function handleSendDeclineDigest(payload) {
  try {
    if (["youssef.hanafy@taager.com", "somaya.youssef@taager.com"].indexOf(String(payload.requestedBy || "").trim().toLowerCase()) === -1) {
      return jsonResponse({ success: false, message: "Not allowed." });
    }
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty("DECLINE_DIGEST_LAST_SENT") || 0);
    if (Date.now() - last < DECLINE_DIGEST_MIN_GAP_MS) {
      return jsonResponse({ success: false, message: "Please wait a few seconds before sending again." });
    }
    var rows = (payload.rows || []).slice(0, DECLINE_DIGEST_MAX_ROWS);
    if (!rows.length) return jsonResponse({ success: false, message: "No rows to send." });
    var meta = payload.meta || {};
    var html = buildDeclineDigestHtml_(rows, meta);
    var subject = "Marketplace Decline Matches — " + String(meta.dateLabel || "");
    sendDeclineMail_(subject, html); // the dashboard button sends to everyone in DECLINE_DIGEST_RECIPIENTS (only YOU can press it)
    props.setProperty("DECLINE_DIGEST_LAST_SENT", String(Date.now()));
    return jsonResponse({ success: true, sentTo: DECLINE_DIGEST_RECIPIENTS.length + " people" });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

function sendDeclineMail_(subject, html, recipients) {
  var to = (recipients && recipients.length ? recipients : DECLINE_DIGEST_RECIPIENTS).join(",");
  if (DECLINE_MAIL_RELAY_URL && DECLINE_MAIL_RELAY_URL.indexOf("http") === 0) {
    var resp = UrlFetchApp.fetch(DECLINE_MAIL_RELAY_URL, {
      method: "post", contentType: "application/json", muteHttpExceptions: true, followRedirects: true,
      payload: JSON.stringify({ secret: DECLINE_MAIL_RELAY_SECRET, to: to, subject: subject, html: html })
    });
    var out;
    try { out = JSON.parse(resp.getContentText()); } catch (e) {
      var snippet = resp.getContentText().replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
      throw new Error("Mail relay returned an unexpected response (HTTP " + resp.getResponseCode() + "): " + snippet);
    }
    if (!out || out.success !== true) throw new Error("Mail relay: " + (out && out.message ? out.message : "failed"));
    return;
  }
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: "Marketplace Dashboard",
    body: "Decline Matches — open this email in an HTML-capable client to see the table." });
}

// Run from the Apps Script editor: sends the FULL design preview (20 sample
// rows, clearly labelled SAMPLE DATA) to DECLINE_DIGEST_RECIPIENTS. Also
// authorizes MailApp / UrlFetchApp the first time.
function testDeclineDigest() {
  var names = ["Wireless Earbuds Pro","Smart Watch Series 5","Hair Dryer 2200W","Air Fryer 5L","LED Desk Lamp","Phone Case Bundle","Yoga Mat Premium","Blender 600W","Bluetooth Speaker Mini","Electric Kettle 1.7L","Men Sneakers Classic","Kids Backpack","Power Bank 20000mAh","Ceramic Cookware Set","Facial Cleansing Brush","Gaming Mouse RGB","Trimmer Pro Kit","Car Phone Holder","Steam Iron 2400W","Water Bottle 1L"];
  var merch = ["Nile Trade","Delta Goods","Cairo Prime","Alex Hub","Giza Select","Sphinx Retail","Oasis Store","Lotus Market"];
  var acms = ["Ahmed S.","Mona K.","Omar T.","Sara H."];
  var rows = [], top = 0;
  for (var i = 0; i < 20; i++) {
    var base = 300 - i * 8, drop = 240 - i * 9, stock = (i % 5 === 0) ? 0 : 80 + i * 17, hasLock = (i % 4 === 1);
    top += drop;
    rows.push({ skuId: "SKU-" + (10400 + i * 37), skuName: names[i], merchantId: String(100200 + (i % 8) * 113), merchantName: merch[i % 8], acm: acms[i % 4],
      base: base, y: base - drop, drop: drop, dropPct: drop / base * 100, impactPct: 15 + (i * 7) % 45, skuSharePct: (i % 3 === 0) ? 100 : 30 + (i * 11) % 55,
      contrPct: drop / 3300 * 100, lostGmv: drop * (120 + i * 9), stock: stock, locked: hasLock ? 40 + i * 3 : 0, hasLock: hasLock,
      cause: stock === 0 ? "Out of stock" : (hasLock ? "Low stock + Locked Qty" : "Demand drop") });
  }
  var html = buildDeclineDigestHtml_(rows, { dateLabel: "Sample", totalDrop: 3300, topDrop: top, lostGmv: 600000, lostGmvTop: rows.reduce(function (a, r) { return a + r.lostGmv; }, 0), acm: "All", dashboardUrl: "", sample: true });
  sendDeclineMail_("Decline Matches \u00b7 SAMPLE DATA (design preview)", html);
}


// ============================================================================
//  DECLINE MATCHES — FEEDBACK (tab "Decline Feedback" in the dashboard sheet)
//  One row per (Decline Day, Merchant ID, SKU ID). A match that already has a
//  row for that day is LOCKED for everyone except role "Admin": non-admin
//  users get {success:false, locked:true} and the sheet is not touched.
//  Admins updating a locked match overwrite that same row (never a new row);
//  a new day appends new rows with the new date.
// ============================================================================
var DECLINE_FEEDBACK_SHEET = "Decline Feedback";
var DECLINE_FEEDBACK_HEADERS = ["Feedback Date", "Decline Day", "SKU ID", "SKU Name", "Merchant ID", "Merchant Name", "ACM", "4D Avg", "Yesterday", "Drop", "Lost GMV", "Likely Cause", "Feedback", "Submitted By", "Submitted By Email"];

function getDeclineFeedbackSheet_() {
  var ss = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID);
  var sh = ss.getSheetByName(DECLINE_FEEDBACK_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DECLINE_FEEDBACK_SHEET);
    sh.getRange(1, 1, 1, DECLINE_FEEDBACK_HEADERS.length).setValues([DECLINE_FEEDBACK_HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange("A:B").setNumberFormat("@");
    sh.getRange("C:C").setNumberFormat("@");
    sh.getRange("E:E").setNumberFormat("@");
  }
  return sh;
}

function ddSafeText_(v) {
  var x = String(v === null || v === undefined ? "" : v);
  return /^[=+\-@]/.test(x) ? "'" + x : x;
}

// A "Decline Day" cell can come back from the sheet as a Date if Sheets ever
// auto-converted it; normalise both shapes to "yyyy-MM-dd" so the row lookup
// below always matches (otherwise every save would append a duplicate row).
function ddNormDay_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, DD_TIMEZONE, "yyyy-MM-dd");
  return String(v === null || v === undefined ? "" : v).trim();
}

// Role comes from the Users sheet (looked up by email), never from the request.
function ddUserRole_(email) {
  email = String(email || "").trim().toLowerCase();
  if (!email) return "";
  try {
    var data = getUsersSheet().getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1] || "").trim().toLowerCase() === email) return String(data[i][3] || "").trim();
    }
  } catch (err) {}
  return "";
}

function handleSaveDeclineFeedback(payload) {
  var feedback = String(payload.feedback || "").trim();
  var day = String(payload.declineDay || "").trim();
  var row = payload.row || {};
  var userName = String(payload.userName || "").trim();
  var skuId = String(row.skuId || "").trim(), merchantId = String(row.merchantId || "").trim();
  if (!skuId || !merchantId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return jsonResponse({ success: false, error: "Missing match details." });
  if (!feedback) return jsonResponse({ success: false, error: "Feedback text is empty." });
  if (!userName) return jsonResponse({ success: false, error: "Missing logged-in user name." });
  if (feedback.length > 2000) feedback = feedback.substring(0, 2000);
  var isAdmin = ddUserRole_(payload.userEmail) === "Admin";

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = getDeclineFeedbackSheet_();
    var now = Utilities.formatDate(new Date(), DD_TIMEZONE, "yyyy-MM-dd HH:mm");
    var num = function (v) { var x = Number(v); return isFinite(x) ? Math.round(x * 10) / 10 : 0; };
    var vals = [now, day, skuId, ddSafeText_(row.skuName), merchantId, ddSafeText_(row.merchantName), ddSafeText_(row.acm),
      num(row.base), num(row.y), num(row.drop), Math.round(num(row.lostGmv)), ddSafeText_(row.cause), ddSafeText_(feedback), ddSafeText_(userName), ddSafeText_(payload.userEmail)];
    var last = sh.getLastRow(), target = -1;
    if (last >= 2) {
      var keys = sh.getRange(2, 2, last - 1, 4).getValues(); // B..E = day, sku, skuName, merchantId
      for (var i = 0; i < keys.length; i++) {
        if (ddNormDay_(keys[i][0]) === day && String(keys[i][1]).trim() === skuId && String(keys[i][3]).trim() === merchantId) { target = i + 2; break; }
      }
    }
    if (target !== -1 && !isAdmin) {
      // Already submitted for this match/day -> locked. Do not write anything.
      var ex = sh.getRange(target, 1, 1, DECLINE_FEEDBACK_HEADERS.length).getValues()[0];
      return jsonResponse({
        success: false, locked: true,
        error: "Feedback for this match was already submitted and is locked.",
        existing: { feedback: String(ex[12] || ""), by: String(ex[13] || ""), at: String(ex[0] || "") }
      });
    }
    if (target === -1) target = last + 1;
    if (target > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
    sh.getRange(target, 1, 1, 5).setNumberFormat("@"); // keep Feedback Date / Day / SKU / Merchant as text so they never turn into Dates
    sh.getRange(target, 1, 1, vals.length).setValues([vals]);
    return jsonResponse({ success: true, at: now, updated: target <= last });
  } finally {
    lock.releaseLock();
  }
}

function handleGetDeclineFeedback(payload) {
  var day = String(payload.declineDay || "").trim();
  var items = {};
  var sh = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID).getSheetByName(DECLINE_FEEDBACK_SHEET);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, DECLINE_FEEDBACK_HEADERS.length).getValues().forEach(function (r) {
      if (ddNormDay_(r[1]) !== day) return;
      items[String(r[4]).trim() + "||" + String(r[2]).trim()] = { feedback: String(r[12] || ""), by: String(r[13] || ""), at: String(r[0] || "") };
    });
  }
  return jsonResponse({ success: true, items: items });
}

// Run once to create the "Decline Feedback" tab (it is also created on the first feedback).
function setupDeclineFeedbackSheet() { getDeclineFeedbackSheet_(); }

// ============================================================================
//  SALES PLAN FEEDBACK  (dashboard page: Account Manager > Sales Plan - Feedback)
//  Tab "Sales Plan Feedback". One row per (Feedback Date, Product ID, Merchant ID):
//  saving again the SAME day edits that row; a new day appends a new row.
//  Fixed columns A:E are kept as text so IDs/dates never turn into numbers/Dates.
// ============================================================================
var SP_FEEDBACK_SHEET = "Sales Plan Feedback";
var SP_MAX_NEW_MERCHANTS = 5;
var SP_FEEDBACK_HEADERS = ["Feedback Date", "Product ID", "Product Name", "Merchant ID", "Merchant Name", "Category", "ACM",
  "Placed MTD Target", "Placed Actual", "Placed Run Rate", "Placed Ach %", "Avg Placed Daily", "Gap Plan", "Remaining Days",
  "Old Target Placed Daily", "New Target Placed Daily", "Feedback", "New Merchant ID(s)", "Submitted By", "Submitted By Email", "Saved At",
  "Adjusted Target (Existing Merchant)", "No. of New Merchants", "Comment (Reason)"];
// Columns 25.. = New Merchant 1 ID, New Merchant 1 Target, New Merchant 2 ID, ... (up to SP_MAX_NEW_MERCHANTS)
(function () {
  for (var i = 1; i <= SP_MAX_NEW_MERCHANTS; i++) { SP_FEEDBACK_HEADERS.push("New Merchant " + i + " ID"); SP_FEEDBACK_HEADERS.push("New Merchant " + i + " Target"); }
})();
var SP_FEEDBACK_OPTIONS = [
  "Merchant will scale on new target",
  "Reduce merchant target - add new merchant",
  "Merchant will stop - add new merchant",
  "Stock issue",
  "No Feedback"
];
var SP_STOCK_ISSUE = "Stock issue"; // no target change, plan sheet untouched
function spNoChange_(fb) { return fb === "Stock issue" || fb === "No Feedback"; } // "No Feedback" is handled exactly like Stock issue
var SP_NEEDS_NEW_MERCHANT = {
  "Reduce merchant target - add new merchant": true,
  "Merchant will stop - add new merchant": true
};

function getSalesPlanFeedbackSheet_() {
  var ss = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID);
  var sh = ss.getSheetByName(SP_FEEDBACK_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SP_FEEDBACK_SHEET);
    if (sh.getMaxColumns() < SP_FEEDBACK_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), SP_FEEDBACK_HEADERS.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, SP_FEEDBACK_HEADERS.length).setValues([SP_FEEDBACK_HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange("A:B").setNumberFormat("@");
    sh.getRange("D:D").setNumberFormat("@");
    sh.getRange("R:R").setNumberFormat("@");
  } else if (sh.getLastColumn() < SP_FEEDBACK_HEADERS.length) {
    // Tab created by an older version of the dashboard: add the new header cells.
    if (sh.getMaxColumns() < SP_FEEDBACK_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), SP_FEEDBACK_HEADERS.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, SP_FEEDBACK_HEADERS.length).setValues([SP_FEEDBACK_HEADERS]).setFontWeight("bold");
  }
  return sh;
}

// v1.18.0 — owner's decision: nothing is written to (or read from) the "Sales_Plan-ACM" tab any more.
// Sales Plan-ACM reads the month's uploaded targets (Control → Targets Upload) and applies the feedback saved here
// (Adjusted Target / new merchants, from the feedback date on) in the dashboard itself.

function handleSaveSalesPlanFeedback(payload) {
  var feedback = String(payload.feedback || "").trim();
  var comment = String(payload.comment || "").trim();
  var row = payload.row || {};
  var userName = String(payload.userName || "").trim();
  var productId = String(row.productId || "").trim(), merchantId = String(row.merchantId || "").trim();
  if (!productId || !merchantId) return jsonResponse({ success: false, error: "Missing match details." });
  if (SP_FEEDBACK_OPTIONS.indexOf(feedback) === -1) return jsonResponse({ success: false, error: "Pick a feedback option." });
  if (!comment) return jsonResponse({ success: false, error: "Comment (why the target wasn't achieved) is required." });
  if (comment.length > 2000) comment = comment.substring(0, 2000);
  if (!userName) return jsonResponse({ success: false, error: "Missing logged-in user name." });

  var adj = (feedback === "Merchant will stop - add new merchant") ? 0 : Number(payload.adjustedTarget);
  if (spNoChange_(feedback)) { adj = Number(row.oldDailyTarget); if (!isFinite(adj) || adj < 0) adj = 0; }
  else if (!isFinite(adj) || adj < 0 || payload.adjustedTarget === "" || payload.adjustedTarget === null || payload.adjustedTarget === undefined) {
    if (feedback !== "Merchant will stop - add new merchant") return jsonResponse({ success: false, error: "Adjusted target (existing merchant) is required." });
  }

  var merchants = [];
  if (SP_NEEDS_NEW_MERCHANT[feedback]) {
    var list = payload.newMerchants;
    if (!list || !list.length) return jsonResponse({ success: false, error: "Add at least one new merchant." });
    if (list.length > SP_MAX_NEW_MERCHANTS) return jsonResponse({ success: false, error: "Max " + SP_MAX_NEW_MERCHANTS + " new merchants." });
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var id = String((list[i] && list[i].id) || "").trim(), tg = Number(list[i] && list[i].target);
      if (!id) return jsonResponse({ success: false, error: "New merchant #" + (i + 1) + ": Merchant ID is required." });
      if (id.length > 40) id = id.substring(0, 40);
      if (!isFinite(tg) || tg <= 0) return jsonResponse({ success: false, error: "New merchant #" + (i + 1) + ": target must be greater than 0." });
      if (id === merchantId) return jsonResponse({ success: false, error: "New merchant can't be the same as the current merchant." });
      if (seen[id]) return jsonResponse({ success: false, error: "Duplicate new Merchant ID: " + id });
      seen[id] = true;
      merchants.push({ id: id, target: Math.round(tg * 10) / 10, name: String((list[i] && list[i].name) || "").trim().substring(0, 120) });
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = getSalesPlanFeedbackSheet_();
    var today = Utilities.formatDate(new Date(), DD_TIMEZONE, "yyyy-MM-dd");
    var now = Utilities.formatDate(new Date(), DD_TIMEZONE, "yyyy-MM-dd HH:mm");
    var num = function (v) { var x = Number(v); return isFinite(x) ? Math.round(x * 10) / 10 : 0; };
    var vals = [today, productId, ddSafeText_(row.productName), merchantId, ddSafeText_(row.merchantName), ddSafeText_(row.category), ddSafeText_(row.acm),
      num(row.mtdTarget), num(row.mtdActual), num(row.runRate), num(row.achPct), num(row.avgDaily), num(row.gap), num(row.remainingDays),
      num(row.oldDailyTarget), num(row.newDailyTarget), feedback, merchants.map(function (m) { return m.id; }).join(", "), ddSafeText_(userName), ddSafeText_(payload.userEmail), now,
      num(adj), merchants.length, ddSafeText_(comment)];
    for (var j = 0; j < SP_MAX_NEW_MERCHANTS; j++) {
      if (merchants[j]) { vals.push(merchants[j].id); vals.push(merchants[j].target); } else { vals.push(""); vals.push(""); }
    }
    var last = sh.getLastRow(), target = -1;
    if (last >= 2) {
      var keys = sh.getRange(2, 1, last - 1, 4).getValues(); // A..D = date, productId, name, merchantId
      for (var k = 0; k < keys.length; k++) {
        if (ddNormDay_(keys[k][0]) === today && String(keys[k][1]).trim() === productId && String(keys[k][3]).trim() === merchantId) { target = k + 2; break; }
      }
    }
    var prevNewIds = [];
    if (target !== -1) { // same-day re-save: remember which new merchants this feedback added before
      var old = sh.getRange(target, 1, 1, 24 + SP_MAX_NEW_MERCHANTS * 2).getValues()[0];
      for (var pj = 0; pj < SP_MAX_NEW_MERCHANTS; pj++) { var pid = String(old[24 + pj * 2] === undefined ? "" : old[24 + pj * 2]).trim(); if (pid) prevNewIds.push(pid); }
    }
    if (target === -1) target = last + 1;
    if (target > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
    sh.getRange(target, 1, 1, 5).setNumberFormat("@");
    sh.getRange(target, 18).setNumberFormat("@");
    for (var c = 0; c < SP_MAX_NEW_MERCHANTS; c++) sh.getRange(target, 25 + c * 2).setNumberFormat("@"); // merchant IDs stay text; targets stay numbers
    sh.getRange(target, 1, 1, vals.length).setValues([vals]);
    var planSync = { ok: true, skipped: true, reason: "dashboard applies the feedback to the month's uploaded plan" };
    return jsonResponse({ success: true, at: now, date: today, updated: target <= last, planSync: planSync });
  } finally {
    lock.releaseLock();
  }
}

// Latest feedback per (Merchant || Product) for the given month ("yyyy-MM").
function handleGetSalesPlanFeedback(payload) {
  var month = String(payload.month || "").trim();
  var items = {};
  var sh = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID).getSheetByName(SP_FEEDBACK_SHEET);
  if (sh && sh.getLastRow() >= 2) {
    var width = Math.max(sh.getLastColumn(), 1);
    sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(function (r) {
      var d = ddNormDay_(r[0]);
      if (month && d.substring(0, 7) !== month) return;
      var k = String(r[3]).trim() + "||" + String(r[1]).trim();
      var ms = [];
      for (var j = 0; j < SP_MAX_NEW_MERCHANTS; j++) {
        var id = String(r[24 + j * 2] === undefined ? "" : r[24 + j * 2]).trim();
        if (id) ms.push({ id: id, target: Number(r[25 + j * 2]) || 0 });
      }
      var it = { date: d, feedback: String(r[16] || ""), adjTarget: r[21] === "" || r[21] === undefined ? null : Number(r[21]), merchants: ms,
        comment: String(r[23] || ""), newTarget: Number(r[15]) || 0, by: String(r[18] || ""), at: String(r[20] || "") };
      // v1.18.0 — every feedback of the month for the match (oldest first) so the dashboard applies each target change from its own day
      var hist = (items[k] && items[k].history) || [];
      hist.push({ date: it.date, feedback: it.feedback, adjTarget: it.adjTarget, merchants: it.merchants, by: it.by, at: it.at });
      if (!items[k] || items[k].date <= d) { it.history = hist; items[k] = it; } else items[k].history = hist;
    });
    Object.keys(items).forEach(function (k) { items[k].history.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at < b.at ? -1 : 1); }); });
  }
  return jsonResponse({ success: true, items: items });
}

// Run once to create the "Sales Plan Feedback" tab (it is also created on the first save).
function setupSalesPlanFeedbackSheet() { getSalesPlanFeedbackSheet_(); }

// ============================================================================
//  REAL NUMBERS, computed here from the Google Sheet (no dashboard needed).
//  Same logic as the dashboard's Decline Matches page:
//   Drop = avg(DAY2..DAY5) - DAY1 (Placed), listed only if Drop >= 3 pcs; ranked by Drop; Contr% vs total drop;
//   Impact on SKU = Drop / SKU's 4-day avg across all merchants;
//   Stock from the Inventory tab; Locked = active lock remaining pieces.
// ============================================================================
// v1.3.48: الـ digest بقى بيقرا Main / Availability Locking / Merchant SKU Daily من Metabase API
// (نفس الروابط اللي في METABASE_SOURCES بتاع js/app.js) — الأعمدة بنفس ترتيب الشيت القديم بالظبط.
// Inventory (GID تحت) لسه بيتقرا من Google Sheet.
var DD_DAILY_URL   = "https://metabase.taager.com/public/question/fae5e3b3-770d-4263-84cd-5ec7bcb3235b.json";   // Merchant SKU Daily (461854229)
var DD_DAILY_FMT   = "json";
var DD_MAIN_URL    = "https://metabase.taager.com/api/public/card/8ac644f8-153f-4c32-a2fb-98e72d6c9180/query/csv"; // Main (2099497960): PLACED_PIECES col P, PLACED_GMV col V
var DD_MAIN_FMT    = "csv";
var DD_LOCKING_URL = "https://metabase.taager.com/public/question/6048f9a4-87b4-4a88-88d9-c2ac5e81e492.json";   // Availability Locking (2085802038)
var DD_LOCKING_FMT = "json";
var DD_INVENTORY_GID = 1780730573;  // INVENTORY_GID — لسه Google Sheet
var DD_MIN_DROP = 3;
var DD_EXCLUDED_MERCHANTS = { "1160154": true }; // excluded from Decline Matches (drops, totals, MTD lost); actual Avg Placed still counts them
var DD_TOP_N = 20;
var DD_TIMEZONE = "Africa/Cairo";
// Avg Placed Target (pieces/day) per month, key YYYY-MM. Update at the start of each month.
var DD_AVG_PLACED_TARGETS = { "2026-10": 5429 }; // months not listed here: Category Targets (Grand Total → Total Placed) ÷ days in the month
var DD_CAT_TARGETS_GID = 1656655269;
// Daily Placed target of the current month from the Category Targets tab: the "Grand Total" row, "Total Placed" column
// (the month's placed target, e.g. 208,699) ÷ the days of the month. 0 when the tab or the row / column is missing.
function ddDailyPlacedTarget_(ss, monthKey) {
  if (DD_AVG_PLACED_TARGETS[monthKey]) return DD_AVG_PLACED_TARGETS[monthKey];
  try {
    var vals = ddSheetByGid_(ss, DD_CAT_TARGETS_GID).getDataRange().getValues();
    var norm = function (v) { return String(v === null || v === undefined ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); };
    var hr = -1, cCat = -1, cPl = -1;
    for (var i = 0; i < Math.min(vals.length, 15) && hr < 0; i++) {
      for (var j = 0; j < vals[i].length; j++) { var h = norm(vals[i][j]); if (h === "category") cCat = j; if (h === "total placed" || h === "total placed pcs") cPl = j; }
      if (cCat >= 0 && cPl >= 0) hr = i; else { cCat = -1; cPl = -1; }
    }
    if (hr < 0) return 0;
    for (var r = hr + 1; r < vals.length; r++) {
      if (norm(vals[r][cCat]) === "grand total") {
        var monthly = Number(String(vals[r][cPl]).replace(/,/g, "")) || 0;
        var p = monthKey.split("-"), days = new Date(Number(p[0]), Number(p[1]), 0).getDate();
        return monthly > 0 ? monthly / days : 0;
      }
    }
  } catch (e) { Logger.log("ddDailyPlacedTarget_: " + e); }
  return 0;
}
var DD_DASHBOARD_URL = "https://performance-center-taager.vercel.app/"; // optional: paste your dashboard link to get an "Open in Dashboard" button

// Metabase public link -> 2D array بنفس شكل sheet.getDataRange().getValues() (صف الهيدر الأول).
// JSON: array of objects (ترتيب الأعمدة = ترتيب المفاتيح) | CSV: Utilities.parseCsv.
// التواريخ ISO بتتحول لـ Date (منتصف الليل بتوقيت السكربت) عشان كود الـ digest اللي بيعمل `instanceof Date` يشتغل زي الشيت.
function ddMetabaseValues_(url, format) {
  var text = null, lastErr = null;
  for (var attempt = 1; attempt <= 3 && text === null; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      var code = res.getResponseCode();
      if (code !== 200) throw new Error("HTTP " + code + ": " + String(res.getContentText()).slice(0, 200));
      text = res.getContentText();
    } catch (e) { lastErr = e; if (attempt < 3) Utilities.sleep(1500 * attempt); }
  }
  if (text === null) throw new Error("Metabase fetch failed (" + url + "): " + (lastErr && lastErr.message));
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var conv = function (v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") {
      var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(v);
      if (m) {
        var midnight = !m[4] || (m[4] === "00" && m[5] === "00" && m[6] === "00" && (!m[7] || /^(Z|[+-]00:?00)$/.test(m[7])));
        return midnight ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
      }
      return v;
    }
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  };
  if (format === "csv") {
    var grid = Utilities.parseCsv(text);
    return grid.map(function (row, i) { return i === 0 ? row : row.map(conv); });
  }
  var arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error("Metabase returned a non-array response (" + url + "): " + text.slice(0, 200));
  if (!arr.length) return [];
  var keys = Object.keys(arr[0]);
  var out = [keys];
  for (var i = 0; i < arr.length; i++) out.push(keys.map(function (k) { return conv(arr[i][k]); }));
  return out;
}

function ddSheetByGid_(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getSheetId() === gid) return sheets[i];
  throw new Error("Sheet with GID " + gid + " not found.");
}

function computeDeclineDigest_() {
  var ss = SpreadsheetApp.openById(WEBSITE_EGY_SHEET_ID);
  var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
  var s = function (v) { return String(v === null || v === undefined ? "" : v).trim(); };

  var inv = {};
  ddSheetByGid_(ss, DD_INVENTORY_GID).getDataRange().getValues().forEach(function (r, i) {
    var id = s(r[0]); if (!id || id === "SKU_ID") return;
    inv[id] = { name: s(r[1]), stock: Math.round(n(r[2])) };
  });

  var todayMs = new Date().setHours(0, 0, 0, 0);
  var lockRemaining = {}, lockActive = {};
  ddMetabaseValues_(DD_LOCKING_URL, DD_LOCKING_FMT).forEach(function (r) {
    var single = s(r[0]), tager = s(r[2]);
    if (!single || single === "PRODUCT_ID" || !tager) return;
    if (s(r[4]) === "") return; // ALLOCATED_QUANTITY blank = no lock (merchant is open)
    var flag = s(r[9]).toLowerCase();
    if (flag.indexOf("cancel") > -1 || flag.indexOf("expired") > -1 || flag.indexOf("inactive") > -1 || flag.indexOf("released") > -1 || flag === "false" || flag === "0") return;
    var exp = r[7] instanceof Date ? r[7].getTime() : (s(r[7]) ? new Date(s(r[7])).getTime() : null);
    if (exp && !isNaN(exp) && exp < todayMs) return;
    var k = tager + "||" + single;
    lockActive[k] = true;
    lockRemaining[k] = (lockRemaining[k] || 0) + n(r[12]);
  });

  // ASP per match = total Placed GMV (Main col V) / total Placed pcs (col P) over the last 4 days that had placed pcs (before today).
  var aspByMatch = {};
  ddMetabaseValues_(DD_MAIN_URL, DD_MAIN_FMT).forEach(function (r) {
    var tg = s(r[1]), sk = s(r[3]), pcs = n(r[15]), gmvv = n(r[21]);
    if (!tg || !sk || !(pcs > 0) || !(gmvv > 0)) return;
    var dt = r[0] instanceof Date ? r[0].getTime() : new Date(s(r[0])).getTime();
    if (!dt || isNaN(dt) || dt >= todayMs) return;
    var k = tg + "||" + sk, m = aspByMatch[k] || (aspByMatch[k] = {});
    var e = m[dt] || (m[dt] = { pcs: 0, gmv: 0 });
    e.pcs += pcs; e.gmv += gmvv;
  });
  Object.keys(aspByMatch).forEach(function (k) {
    var m = aspByMatch[k], ds = Object.keys(m).map(Number).sort(function (a, b) { return b - a; }).slice(0, 4), p = 0, g = 0;
    ds.forEach(function (d) { p += m[d].pcs; g += m[d].gmv; });
    aspByMatch[k] = p > 0 ? g / p : 0;
  });
  var aspOf = function (tager, sku, fallback) { return aspByMatch[tager + "||" + sku] || fallback; };

  var skuBase = {}, skuDrop = {}, cand = [], totalDrop = 0, lostGmv = 0, dailyRows = [];
  ddMetabaseValues_(DD_DAILY_URL, DD_DAILY_FMT).forEach(function (r) {
    var sku = s(r[0]), tager = s(r[2]);
    if (!sku || sku === "SKU_ID" || !tager) return;
    var days = []; for (var q = 0; q < 32; q++) days.push(n(r[13 + q])); dailyRows.push({ d: days, ex: !!DD_EXCLUDED_MERCHANTS[tager] });
    if (DD_EXCLUDED_MERCHANTS[tager]) return;
    var v = [n(r[15]), n(r[16]), n(r[17]), n(r[18])];            // DAY2..DAY5
    var base = (v[0] + v[1] + v[2] + v[3]) / 4, y = n(r[14]);     // DAY1 = yesterday
    var drop = base - y;
    skuBase[sku] = (skuBase[sku] || 0) + base;
    if (drop > 0) { skuDrop[sku] = (skuDrop[sku] || 0) + drop; totalDrop += drop; lostGmv += drop * aspOf(tager, sku, n(r[12])); }
    var sd = Math.sqrt(v.reduce(function (a, x) { return a + (x - base) * (x - base); }, 0) / 3);
    if (drop >= DD_MIN_DROP) cand.push({ sku: sku, tager: tager, name: s(r[1]), mname: s(r[3]), acm: s(r[4]), base: base, y: y, drop: drop, asp: aspOf(tager, sku, n(r[12])) });
  });

  cand.sort(function (a, b) { return b.drop - a.drop; });
  var rows = cand.slice(0, DD_TOP_N).map(function (c) {
    var key = c.tager + "||" + c.sku, i = inv[c.sku] || {};
    var stock = i.stock || 0, hasLock = !!lockActive[key];
    return {
      skuId: c.sku, skuName: c.name || i.name || "", merchantId: c.tager, merchantName: c.mname || c.tager, acm: c.acm,
      base: c.base, y: c.y, drop: c.drop, dropPct: c.base ? c.drop / c.base * 100 : 0,
      impactPct: skuBase[c.sku] ? c.drop / skuBase[c.sku] * 100 : 0, skuSharePct: skuDrop[c.sku] ? c.drop / skuDrop[c.sku] * 100 : 0,
      contrPct: totalDrop ? c.drop / totalDrop * 100 : 0,
      stock: stock, locked: Math.round(lockRemaining[key] || 0), hasLock: hasLock,
      asp: c.asp, lostGmv: c.drop * c.asp,
      cause: [stock <= 0 ? "Out of stock" : (stock < c.base ? "Low stock" : ""), (hasLock && lockRemaining[key] < c.base) ? "Locked Qty" : ""].filter(function (x) { return x; }).join(" + ") || "Demand drop"
    };
  });
  var topDrop = rows.reduce(function (a, r) { return a + r.drop; }, 0);
  var topGmv = rows.reduce(function (a, r) { return a + r.lostGmv; }, 0);
  // MTD: full days of the current month = DAY1..DAY(dom-1)
  var dom = Number(Utilities.formatDate(new Date(), DD_TIMEZONE, "d")), mtdDays = Math.min(dom - 1, 31), mtdPlaced = 0, mtdLost = 0, mtdGain = 0;
  for (var k = 1; k <= mtdDays; k++) {
    dailyRows.forEach(function (row) {
      var d = row.d;
      var cur = d[k] || 0; mtdPlaced += cur;
      var sum = 0, cnt = 0;
      for (var j = k + 1; j <= Math.min(k + 4, 31); j++) { sum += d[j] || 0; cnt++; }
      if (cnt && !row.ex) { var b = sum / cnt; if (b > cur) mtdLost += b - cur; else mtdGain += cur - b; }
    });
  }
  var monthKey = Utilities.formatDate(new Date(), DD_TIMEZONE, "yyyy-MM");
  var dateLabel = Utilities.formatDate(new Date(Date.now() - 86400000), DD_TIMEZONE, "EEE, dd MMM yyyy");
  return { rows: rows, meta: { dateLabel: dateLabel, totalDrop: totalDrop, topDrop: topDrop, acm: "All", dashboardUrl: DD_DASHBOARD_URL,
    lostGmv: lostGmv, lostGmvTop: topGmv, mtdLost: mtdLost, mtdGain: mtdGain, mtdDays: mtdDays, mtdPlaced: mtdPlaced, avgActual: mtdDays ? mtdPlaced / mtdDays : 0, avgTarget: ddDailyPlacedTarget_(ss, monthKey) } };
}

// RUN THIS to send the real email now (to DECLINE_DIGEST_RECIPIENTS).
// v1.17.0: the daily email is now sent by the dashboard itself (Worker). If the old 12:00 trigger
// still fires, it does nothing while the Worker has built the email in the last 36 hours.
// Running it by hand from the editor still sends.
function sendDeclineDigestNow(e) {
  if (e && e.triggerUid) {
    var wAt = Number(PropertiesService.getScriptProperties().getProperty("DECLINE_DIGEST_WORKER_AT") || 0);
    if (Date.now() - wAt < 36 * 3600 * 1000) { Logger.log("Skipped: the dashboard (Worker) sends this email now."); return; }
  }
  var d = computeDeclineDigest_();
  if (!d.rows.length) { Logger.log("No declining matches found - nothing sent."); return; }
  sendDeclineMail_("Marketplace Decline Matches — " + d.meta.dateLabel, buildDeclineDigestHtml_(d.rows, d.meta));
  Logger.log("Sent Top " + d.rows.length + " to " + DECLINE_DIGEST_RECIPIENTS.join(", "));
}

// RUN THIS to TEST the digest data (Metabase sources) WITHOUT sending any email — results in View > Logs.
function testDeclineDigestMetabase() {
  var d = computeDeclineDigest_();
  Logger.log("Rows: " + d.rows.length + " | totalDrop: " + Math.round(d.meta.totalDrop) + " | lostGmv: " + Math.round(d.meta.lostGmv) + " | mtdPlaced: " + Math.round(d.meta.mtdPlaced));
  d.rows.slice(0, 5).forEach(function (r) { Logger.log(r.skuId + " | " + r.merchantName + " | ACM " + r.acm + " | base " + r.base.toFixed(1) + " -> " + r.y + " | stock " + r.stock + " | " + r.cause); });
}

// RUN THIS ONCE to schedule the email every day at 12:00 Cairo time.
function installDailyDeclineTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "sendDeclineDigestNow") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendDeclineDigestNow").timeBased().everyDays(1).atHour(12).inTimezone(DD_TIMEZONE).create();
  Logger.log("Daily trigger installed: 12:00 " + DD_TIMEZONE);
}

// ============================================================================
//  v1.17.0 — PLANNER DOH (Single SKUs) -> planning sheet
//  NOTHING is calculated here. The dashboard already builds this exact table for its
//  "Planner DOH — Single SKUs" page (js/app.js dohComputeRows) and posts it (action
//  planner_doh_rows); this only writes those rows into the sheet, so the sheet can never
//  disagree with the page — and this script never reads the Main query again, which is
//  what used to make this export time out before it wrote anything.
//  The last payload is kept in Script Properties, so the daily 11:00 run can rewrite it even on a
//  day nobody opened the dashboard — with the note saying when it last came in.
//      SKU | Name | Category | Stock | Placed Yesterday | Avg 3D Confirmed | CR% | DR% | NDR%
//      | CR% Used | Placed x CR | Diff | DOH (Placed x CR) | DOH (Avg 3D)      — columns A..N only
// ============================================================================
// v1.18.0 — moved to "Supply Chain ROP" → tab "PLANNER DOH" (was 1LSvaSIvl4Gapb28FICNGMKyMOlrsyTr9pEbeFpW-c1w / gid 693802633)
var PDOH_TARGET_SHEET_ID = "1EAq7r0MrtyCX41LJdXzIEMuPsSWzjBULb8klKDzzw1g";
var PDOH_TARGET_GID = 347559848;
var PDOH_PROP = "PLANNER_DOH_LAST";   // the last table the dashboard sent

// The dashboard posts the table it already has on screen.
function handlePlannerDohRows_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  try {
    var rows = payload && payload.rows;
    if (!rows || !rows.length) return jsonResponse({ success: false, message: "No rows." });
    // The dashboard sends each row as a compact array in the order named by payload.cols, because the
    // field names alone were most of the request for a few thousand SKUs. Objects are still accepted
    // so an older dashboard that has not been reloaded yet keeps working.
    var COLS = ["sku", "name", "cat", "stock", "placedYday", "avg3", "cr", "dr", "ndr", "crUsed", "expConf", "diff", "dohPlaced", "dohAvg3"];
    var cols = (payload.cols && payload.cols.length) ? payload.cols : COLS;
    var at = {};
    for (var ci = 0; ci < cols.length; ci++) at[String(cols[ci])] = ci;
    var pick = function (r, name) {
      if (Object.prototype.toString.call(r) === "[object Array]") {
        var i = at[name];
        return i === undefined ? null : r[i];
      }
      return r[name];
    };
    var keep = {
      rows: rows.map(function (r) {
        return { sku: pscTxt_(pick(r, "sku")), name: pscTxt_(pick(r, "name")), cat: pscTxt_(pick(r, "cat")),
                 stock: pscNum_(pick(r, "stock")), placedYday: pscNum_(pick(r, "placedYday")), avg3: pscNum_(pick(r, "avg3")),
                 cr: pscPctOrNull_(pick(r, "cr")), dr: pscPctOrNull_(pick(r, "dr")), ndr: pscPctOrNull_(pick(r, "ndr")),
                 crUsed: pscPctOrNull_(pick(r, "crUsed")), expConf: pscNum_(pick(r, "expConf")), diff: pscNum_(pick(r, "diff")),
                 dohPlaced: pscNumOrNull_(pick(r, "dohPlaced")), dohAvg3: pscNumOrNull_(pick(r, "dohAvg3")) };
      }),
      yday: pscTxt_(payload.yday), params: payload.params || {}, floored: pscNum_(payload.floored),
      asOf: pscTxt_(payload.asOf), receivedAt: new Date().toISOString()
    };
    var r = writePlannerDoh_(keep);
    // Only a small record is kept here: Script Properties cap at 9KB per value, which a few thousand
    // SKUs blow straight through. The Worker holds the payload itself for the 11:00 rewrite.
    PropertiesService.getScriptProperties().setProperty(PDOH_PROP, JSON.stringify({
      rows: keep.rows.length, yday: keep.yday, floored: keep.floored, params: keep.params,
      asOf: keep.asOf, receivedAt: keep.receivedAt
    }));
    return jsonResponse({ success: true, rows: r.rows, yday: r.yday });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

// A rate the dashboard could not measure stays blank in the sheet rather than being written as 0% —
// "no placed pieces in the window" and "0% conversion" are not the same thing to a planner.
function pscPctOrNull_(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}
function pscNumOrNull_(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function writePlannerDoh_(d) {
  // Every value here is the dashboard's own — nothing is worked out in this script.
  var r1 = function (v) { return v === null || v === undefined || !isFinite(v) ? "" : Math.round(v * 10) / 10; };
  var pc = function (v) { return v === null || v === undefined || !isFinite(v) ? "" : Math.round(v * 10) / 1000; }; // 55.3 -> 0.553 (shown as 55.3%)
  var head = ["SKU", "Name", "Category", "Stock", "Placed Yesterday", "Avg 3D Confirmed", "CR%", "DR%", "NDR%", "CR% Used", "Placed × CR", "Diff (Placed×CR − Avg 3D)", "DOH (Placed × CR)", "DOH (Avg 3D)"];
  var out = [head].concat(d.rows.map(function (r) {
    return [r.sku, ddSafeText_(r.name), ddSafeText_(r.cat), Math.round(r.stock), Math.round(r.placedYday), r1(r.avg3),
            pc(r.cr), pc(r.dr), pc(r.ndr), pc(r.crUsed), r1(r.expConf), r1(r.diff), r1(r.dohPlaced), r1(r.dohAvg3)];
  }));
  var ss = SpreadsheetApp.openById(PDOH_TARGET_SHEET_ID), sh = ddSheetByGid_(ss, PDOH_TARGET_GID);
  // A USER lock, not the script lock: the script lock is held for minutes by the big publishes (Analyst / Single daily, feedback saves ...), which made this
  // write fail with "Lock timeout: another process was holding the lock for too long". This write goes to the planning sheet and nothing else writes
  // there at the same time except another Planner DOH write, and the user lock still serialises exactly those.
  var lock = LockService.getUserLock();
  try { lock.waitLock(45000); }
  catch (lockErr) { throw new Error("A previous Planner DOH write is still running — wait a minute and press Send to sheet again."); }
  try {
    // write columns A..N ONLY. Columns O, P, Q (and anything further right) belong to the
    // planning team and are never read, cleared or touched here.
    var nCols = head.length; // 14 = A..N
    var maxRows = sh.getMaxRows();
    if (out.length > maxRows) { sh.insertRowsAfter(maxRows, out.length - maxRows); maxRows = sh.getMaxRows(); }
    var used = Math.min(maxRows, Math.max(sh.getLastRow(), out.length));
    // ONE write instead of "clear, then write": rows below the new table (left over from a longer yesterday) are written as blanks in the same call.
    // The planning team's formulas in O.. read this tab, so every separate change made them recalculate again — which is what made this take minutes.
    var blank = []; for (var bi = 0; bi < nCols; bi++) blank.push("");
    while (out.length < used) out.push(blank);
    sh.getRange(1, 1, out.length, nCols).setValues(out);
    if (out.length > 1) {
      // formats only when they are not already there (setting them again changes nothing but costs time)
      if (sh.getRange(2, 1).getNumberFormat() !== "@") sh.getRange(2, 1, out.length - 1, 1).setNumberFormat("@");
      if (sh.getRange(2, 7).getNumberFormat() !== "0.0%") sh.getRange(2, 7, out.length - 1, 4).setNumberFormat("0.0%");
    }
    sh.getRange(1, 1, 1, nCols).setFontWeight("bold");
    var P = d.params || {};
    sh.getRange(1, 1).setNote("Planner DOH — Single SKUs · these are the dashboard's own numbers, nothing is recalculated here." +
      "\nPlaced yesterday: " + d.yday +
      "\nSent by the dashboard: " + String(d.receivedAt).slice(0, 16).replace("T", " ") + " UTC" +
      "\nWritten to this tab: " + Utilities.formatDate(new Date(), DD_TIMEZONE, "yyyy-MM-dd HH:mm") + " Cairo" +
      (P.cutoffDays ? "\nCutoff " + P.cutoffDays + "d, window " + P.windowDays + "d, CR ≤ " + P.crFloorBelow + "% → " + P.crFloorTo + "%" : "") +
      (d.floored ? " · CR floored on " + d.floored + " SKUs" : "") +
      "\nColumns A–N only — O onwards are left untouched.");
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  return { rows: d.rows.length, yday: d.yday };
}

function pdohLast_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PDOH_PROP);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// Status only. The 11:00 Cairo rewrite is driven by the Worker, which holds the payload and posts
// it as planner_doh_rows — this script never stores or recomputes the table.
function handlePlannerDohExport_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  var d = pdohLast_();
  if (!d) return jsonResponse({ success: false, message: "The dashboard has not sent a Planner DOH table yet — open Supply Chain → Planner DOH once and it will." });
  return jsonResponse({ success: true, rows: d.rows, yday: d.yday, sentAt: d.receivedAt });
}

// What this script last wrote, and when the dashboard sent it. The table itself is written by the
// dashboard (Supply Chain → Planner DOH → "Send to sheet") or by the 11:00 Cairo run, both of which
// come in through planner_doh_rows — there is nothing to recompute here.
function plannerDohStatus() {
  var d = pdohLast_();
  if (!d) { Logger.log("Planner DOH: nothing written yet — open the dashboard (Supply Chain → Planner DOH) and press Send to sheet."); return; }
  Logger.log("Planner DOH: last wrote " + d.rows + " Single SKUs (placed " + d.yday + "), sent by the dashboard at " + d.receivedAt + ".");
}


// ============================================================================
//  v1.17.0 — INVENTORY & DOH PER CATEGORY -> its own tab in the planning sheet
//  NOTHING is calculated here. The dashboard's Supply Chain → Inventory Aging page already works
//  these out and posts them (action inv_category_rows); this only writes them, so the sheet can
//  never disagree with the page.
//      Category | SKUs in stock | Pieces | Inventory value | DOH (value) | DOH (pcs)
// ============================================================================
var PIC_TARGET_SHEET_ID = "1qaugR6FocPVpDFMjZNnPFy24K2T9MN5IFg02cZHUvK4";
var PIC_TARGET_GID = 398126694;
var PIC_PROP = "INV_CATEGORY_LAST";

function handleInvCategoryRows_(payload) {
  // The Worker is the only caller now, and it always sends the key.
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  try {
    var rows = payload && payload.rows;
    if (!rows || !rows.length) return jsonResponse({ success: false, message: "No rows." });
    var keep = {
      rows: rows.map(function (r) {
        return { category: pscTxt_(r.category), skus: pscNum_(r.skus), pcs: pscNum_(r.pcs),
                 value: pscNum_(r.value), dohValue: pscNum_(r.dohValue), dohPcs: pscNum_(r.dohPcs) };
      }),
      asOf: pscTxt_(payload.asOf), monthLabel: pscTxt_(payload.monthLabel),
      elapsed: pscNum_(payload.elapsed), daysInMonth: pscNum_(payload.daysInMonth),
      receivedAt: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty(PIC_PROP, JSON.stringify(keep));
    var r = writeInvCategory_(keep);
    return jsonResponse({ success: true, rows: r.rows });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

function writeInvCategory_(d) {
  // Every value here is the dashboard's own — nothing is worked out in this script.
  var r1 = function (v) { return v === null || v === undefined || !isFinite(v) ? "" : Math.round(v * 10) / 10; };
  var head = ["Category", "SKUs in stock", "Pieces", "Inventory value", "DOH (value)", "DOH (pcs)"];
  var out = [head].concat(d.rows.map(function (r) {
    return [ddSafeText_(r.category), Math.round(r.skus), Math.round(r.pcs), Math.round(r.value), r1(r.dohValue), r1(r.dohPcs)];
  }));
  var ss = SpreadsheetApp.openById(PIC_TARGET_SHEET_ID), sh = ddSheetByGid_(ss, PIC_TARGET_GID);
  // USER lock, same as writePlannerDoh_: the script lock is held for minutes by the big publishes, which can fail this write with "Lock timeout".
  var lock = LockService.getUserLock();
  try { lock.waitLock(45000); }
  catch (lockErr) { throw new Error("Another write to the planning sheet is still running — wait a minute and press Send to sheet again."); }
  try {
    var nCols = head.length, maxRows = sh.getMaxRows();
    if (out.length > maxRows) { sh.insertRowsAfter(maxRows, out.length - maxRows); maxRows = sh.getMaxRows(); }
    var used = Math.min(maxRows, Math.max(sh.getLastRow(), out.length));
    if (used > 0) sh.getRange(1, 1, used, nCols).clearContent(); // columns A..F only
    sh.getRange(1, 1, out.length, nCols).setValues(out);
    sh.getRange(1, 1, 1, nCols).setFontWeight("bold");
    if (out.length > 1) {
      sh.getRange(2, 2, out.length - 1, 3).setNumberFormat("#,##0");   // SKUs · Pieces · Inventory value
      sh.getRange(2, 5, out.length - 1, 2).setNumberFormat("#,##0.0"); // the two DOH columns
      sh.getRange(out.length, 1, 1, nCols).setFontWeight("bold");      // the TOTAL row
    }
    sh.getRange(1, 1).setNote("Inventory & DOH per category — these are the dashboard's own numbers, nothing is recalculated here." +
      "\nSupply Chain → Inventory Aging, all categories · as of " + d.asOf +
      (d.monthLabel ? " (" + d.monthLabel + ", day " + d.elapsed + " of " + d.daysInMonth + ")" : "") +
      "\nSent by the dashboard: " + String(d.receivedAt).slice(0, 16).replace("T", " ") + " UTC" +
      "\nWritten to this tab: " + Utilities.formatDate(new Date(), DD_TIMEZONE, "yyyy-MM-dd HH:mm") + " Cairo" +
      "\nPieces and value are Good item stock only. DOH (value) = inventory value ÷ 15-day avg daily demand value; DOH (pcs) = pieces ÷ 15-day avg daily demand pieces." +
      "\nColumns A–F only — G onwards are left untouched.");
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  return { rows: d.rows.length };
}

function picLast_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PIC_PROP);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// The daily run: rewrite the last table the dashboard sent.
function handleInvCategoryExport_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  try {
    var d = picLast_();
    if (!d || !d.rows || !d.rows.length) {
      return jsonResponse({ success: false, message: "The dashboard has not sent the per-category table yet — open Supply Chain → Inventory Aging once and it will." });
    }
    var r = writeInvCategory_(d);
    return jsonResponse({ success: true, rows: r.rows, sentAt: d.receivedAt });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

// RUN THIS by hand to rewrite the tab from the last table the dashboard sent
// (also authorizes access to that sheet the first time).
function exportInvCategoryNow() {
  var d = picLast_();
  if (!d || !d.rows || !d.rows.length) {
    Logger.log("Inventory per category: nothing to write yet — open the dashboard (Supply Chain → Inventory Aging) so it can send the table.");
    return;
  }
  var r = writeInvCategory_(d);
  Logger.log("Inventory per category: " + r.rows + " rows written. Sent by the dashboard at " + d.receivedAt + ".");
}

// ============================================================================
//  v1.17.0 — SUPPLY CONVERSION -> its own Google Sheet tab
//  NOTHING is calculated here. The dashboard already computes the Supply conversion table for
//  Supply Chain -> "Supply conversion — <Month>" and posts it (action supply_conversion_rows);
//  this only writes those rows into the sheet, so the sheet can never disagree with the page.
//  The last payload is kept in Script Properties, so the daily 11:30 run can rewrite it even on a
//  day nobody opened the dashboard — with the note saying when it last came in.
//      Metric | Actual | Planned | Target% | Converted | Conversion % | Converted vs Actual
// ============================================================================
var PSC_TARGET_SHEET_ID = "1qaugR6FocPVpDFMjZNnPFy24K2T9MN5IFg02cZHUvK4";
var PSC_TARGET_GID = 1516662734;
var PSC_PROP = "SUPPLY_CONVERSION_LAST";   // the last table the dashboard sent

function pscNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function pscTxt_(v) { return String(v === null || v === undefined ? "" : v).trim(); }

// The dashboard posts the table it already has on screen.
function handleSupplyConversionRows_(payload) {
  try {
    var rows = payload && payload.rows;
    if (!rows || !rows.length) return jsonResponse({ success: false, message: "No rows." });
    var keep = {
      rows: rows.map(function (r) {
        return { metric: pscTxt_(r.metric), actual: pscNum_(r.actual), planned: pscNum_(r.planned),
                 targetPct: pscNum_(r.targetPct), converted: pscNum_(r.converted),
                 conversionPct: pscNum_(r.conversionPct), convertedVsActual: pscNum_(r.convertedVsActual) };
      }),
      monthKey: pscTxt_(payload.monthKey), monthLabel: pscTxt_(payload.monthLabel),
      elapsed: pscNum_(payload.elapsed), daysInMonth: pscNum_(payload.daysInMonth),
      skus: pscNum_(payload.skus), excluded: pscNum_(payload.excluded),
      excludedEnds: (payload.excludedEnds || []).map(pscTxt_),
      importPos: (payload.importPos || []).map(pscTxt_), importLines: pscNum_(payload.importLines),
      asOf: pscTxt_(payload.asOf), receivedAt: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty(PSC_PROP, JSON.stringify(keep));
    writeSupplyConversion_(keep);
    return jsonResponse({ success: true, rows: keep.rows.length, month: keep.monthKey });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

function writeSupplyConversion_(d) {
  // Every value here is the dashboard's own — nothing is worked out in this script.
  var head = ["Metric", "Actual", "Planned", "Target%", "Converted", "Conversion %", "Converted vs Actual"];
  var out = [head];
  d.rows.forEach(function (r) {
    out.push([r.metric, Math.round(r.actual), Math.round(r.planned), r.targetPct,
              Math.round(r.converted), r.conversionPct, r.convertedVsActual]);
  });
  var ss = SpreadsheetApp.openById(PSC_TARGET_SHEET_ID), sh = ddSheetByGid_(ss, PSC_TARGET_GID);
  // USER lock, same as writePlannerDoh_: the script lock is held for minutes by the big publishes, which can fail this write with "Lock timeout".
  var lock = LockService.getUserLock();
  try { lock.waitLock(45000); }
  catch (lockErr) { throw new Error("Another write to the planning sheet is still running — wait a minute and press Send to sheet again."); }
  try {
    var nCols = head.length, maxRows = sh.getMaxRows();
    if (out.length > maxRows) { sh.insertRowsAfter(maxRows, out.length - maxRows); maxRows = sh.getMaxRows(); }
    var used = Math.min(maxRows, Math.max(sh.getLastRow(), out.length));
    if (used > 0) sh.getRange(1, 1, used, nCols).clearContent(); // columns A..G only
    sh.getRange(1, 1, out.length, nCols).setValues(out);
    sh.getRange(1, 1, 1, nCols).setFontWeight("bold");
    sh.getRange(2, 2, out.length - 1, 2).setNumberFormat("#,##0");   // Actual · Planned
    sh.getRange(2, 4, out.length - 1, 1).setNumberFormat("0%");       // Target% (shown only)
    sh.getRange(2, 5, out.length - 1, 1).setNumberFormat("#,##0");    // Converted
    sh.getRange(2, 6, out.length - 1, 2).setNumberFormat("0.00%");    // Conversion % · Converted vs Actual
    sh.getRange(1, 1).setNote("Supply conversion — " + d.monthLabel + " · these are the dashboard's own numbers, nothing is recalculated here." +
      "\nSent by the dashboard: " + String(d.receivedAt).slice(0, 16).replace("T", " ") + " UTC" +
      "\nWritten to this tab: " + Utilities.formatDate(new Date(), DD_TIMEZONE, "yyyy-MM-dd HH:mm") + " Cairo" +
      "\nDay " + d.elapsed + " of " + d.daysInMonth + " · " + d.skus + " single SKUs" +
      (d.excluded ? " · " + d.excluded + " packaging SKUs left out (" + d.excludedEnds.join(", ") + ")" : "") +
      (d.importPos.length ? "\nImportation POs: " + d.importPos.join(", ") + " (" + d.importLines + " inbound lines)" : "") +
      "\nConversion % = Converted ÷ Planned · Converted vs Actual = Converted ÷ Actual" +
      "\nTarget% is shown for reference only — nothing above is multiplied by it.");
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  return { rows: d.rows.length, month: d.monthKey };
}

function pscLast_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PSC_PROP);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// Called by the Worker at 11:30 Cairo — rewrites the last table the dashboard sent.
function handleSupplyConversionExport_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  var d = pscLast_();
  if (!d) return jsonResponse({ success: false, code: "no_data", message: "The dashboard has not sent the Supply conversion table yet — open the dashboard once with the admin key." });
  try { var r = writeSupplyConversion_(d); return jsonResponse({ success: true, month: r.month, rows: r.rows, receivedAt: d.receivedAt }); }
  catch (err) { return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) }); }
}

// RUN THIS to rewrite the sheet from the last table the dashboard sent (also authorizes the spreadsheet).
function exportSupplyConversionNow() {
  var d = pscLast_();
  if (!d) { Logger.log("Nothing to write yet — open the dashboard once (with the admin key) so it sends the table."); return; }
  var r = writeSupplyConversion_(d);
  Logger.log("Supply conversion " + d.monthLabel + " written · " + r.rows + " rows · sent by the dashboard at " + d.receivedAt);
}

// RUN THIS ONCE after the Worker starts sending the email — removes the old 12:00 trigger.
function removeDailyDeclineTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "sendDeclineDigestNow") { ScriptApp.deleteTrigger(t); n++; } });
  Logger.log(n ? "Removed " + n + " daily trigger(s). The dashboard sends the email now." : "No daily trigger found.");
}

// Worker → builds today's email (same data and design as sendDeclineDigestNow) and returns it; the Worker sends it.
function handleDeclineDigestBuild_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  try {
    // test runs (only you get it) do NOT stop the old 12:00 trigger — the team keeps getting the old email until you switch to "on"
    if (!payload.test) PropertiesService.getScriptProperties().setProperty("DECLINE_DIGEST_WORKER_AT", String(Date.now()));
    var d = computeDeclineDigest_();
    if (!d.rows.length) return jsonResponse({ success: true, empty: true, dateLabel: d.meta.dateLabel });
    return jsonResponse({ success: true, subject: "Marketplace Decline Matches \u2014 " + d.meta.dateLabel, html: buildDeclineDigestHtml_(d.rows, d.meta),
      recipients: DECLINE_DIGEST_RECIPIENTS, rows: d.rows.length, dateLabel: d.meta.dateLabel });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) });
  }
}
// Worker fallback: if its own mail service fails, send the already-built email through the old relay
// (always to DECLINE_DIGEST_RECIPIENTS — the caller cannot choose recipients).
function handleDeclineDigestRelay_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  try {
    if (!payload.html || !payload.subject) return jsonResponse({ success: false, message: "Nothing to send." });
    var test = String(payload.testTo || "").trim().toLowerCase();
    if (test) {
      if (DECLINE_DIGEST_RECIPIENTS.map(function (x) { return x.toLowerCase(); }).indexOf(test) === -1) return jsonResponse({ success: false, message: "Test address is not a recipient." });
      sendDeclineMail_(String(payload.subject).slice(0, 160), String(payload.html), [test]);
      return jsonResponse({ success: true, sentTo: 1 });
    }
    sendDeclineMail_(String(payload.subject).slice(0, 160), String(payload.html));
    return jsonResponse({ success: true, sentTo: DECLINE_DIGEST_RECIPIENTS.length });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

function ddEsc_(v) {
  return String(v === null || v === undefined ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function ddTrunc_(v, n) { v = String(v === null || v === undefined ? "" : v); return v.length > n ? v.slice(0, n - 1) + "\u2026" : v; }
function ddNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function ddInt_(v) { return Math.round(ddNum_(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

function buildDeclineDigestHtml_(rows, meta) {
  var totalDrop = ddNum_(meta.totalDrop), topDrop = ddNum_(meta.topDrop);
  var share = totalDrop ? topDrop / totalDrop * 100 : 0;
  var oos = 0, locked = 0, keyDrivers = 0, tb = 0, ty = 0;
  var trs = "", cards = "";
  rows.forEach(function (r, i) {
    var base = ddNum_(r.base), y = ddNum_(r.y), drop = ddNum_(r.drop), stock = ddNum_(r.stock);
    var causeParts = String(r.cause || "").split(" + ").filter(function (x) { return x === "Out of stock" || x === "Low stock" || x === "Locked Qty"; });
    var cause = causeParts.length ? causeParts.join(" + ") : "Demand drop";
    var hasStockIssue = causeParts.indexOf("Out of stock") > -1 || causeParts.indexOf("Low stock") > -1, hasLockIssue = causeParts.indexOf("Locked Qty") > -1;
    var kd = ddNum_(r.skuSharePct) >= 50;
    if (hasStockIssue) oos++; if (hasLockIssue) locked++; if (kd) keyDrivers++;
    tb += base; ty += y;
    var bg = i % 2 ? "#F7F9FC" : "#FFFFFF";
    var tdp = "padding:9px 6px;";
    // phone cards: only shown by the phone CSS below, so their look lives in the <style> classes (keeps the email small for Gmail)
    var chips = (causeParts.length ? causeParts : ["Demand drop"]).map(function (c) { return '<span class="ch ' + (c === "Locked Qty" ? "cl" : c === "Demand drop" ? "cd" : "cs") + '">' + ddEsc_(c) + '</span>'; }).join("") + (kd ? '<span class="ch cs">KEY DRIVER</span>' : '');
    cards += '<div class="cc' + (i % 2 ? ' ca' : '') + '"><table width="100%" cellpadding="0" cellspacing="0"><tr><td class="c1"><span class="cg">#' + (i + 1) + '</span> <b>' + ddEsc_(r.skuId) + '</b><div class="cg">' + ddEsc_(ddTrunc_(r.skuName, 38)) + '</div></td>' +
      '<td align="right" class="c2"><div class="cdr">&minus;' + drop.toFixed(1) + '</div><div class="cr">&minus;' + ddNum_(r.dropPct).toFixed(0) + '%</div></td></tr></table>' +
      '<div class="cl1"><b>' + ddEsc_(r.merchantId) + '</b> &middot; ' + ddEsc_(ddTrunc_(r.merchantName, 26)) + (r.acm ? ' &middot; ACM ' + ddEsc_(r.acm) : '') + '</div>' +
      '<div class="cl1">4D avg <b>' + base.toFixed(1) + '</b> &rarr; yesterday <b>' + ddInt_(y) + '</b> &middot; Lost GMV <b class="cr">&minus;' + ddInt_(r.lostGmv) + '</b><br>Stock <b' + (stock <= 0 ? ' class="cr"' : '') + '>' + ddInt_(stock) + '</b> &middot; Locked <b>' + (r.hasLock ? ddInt_(r.locked) : "&ndash;") + '</b> &middot; Impact on SKU <b' + (kd ? ' class="cr"' : '') + '>&minus;' + ddNum_(r.impactPct).toFixed(1) + '%</b></div>' +
      '<div>' + chips + '</div></div>';
    trs += '<tr style="background:' + bg + '">' +
      '<td style="' + tdp + 'color:#8A97A6;font-size:12px">' + (i + 1) + '</td>' +
      '<td style="' + tdp + 'min-width:120px"><div style="font-weight:700;color:#14243A;font-size:13px;white-space:nowrap">' + ddEsc_(r.skuId) + '</div><div style="color:#7A889A;font-size:11px;margin-top:2px">' + ddEsc_(ddTrunc_(r.skuName, 40)) + '</div></td>' +
      '<td style="' + tdp + 'min-width:90px"><div style="font-weight:700;color:#14243A;font-size:13px;white-space:nowrap">' + ddEsc_(r.merchantId) + '</div><div style="color:#7A889A;font-size:11px;margin-top:2px">' + ddEsc_(ddTrunc_(r.merchantName, 28)) + '</div></td>' +
      '<td style="' + tdp + 'color:#4A5B6E;font-size:12px;white-space:nowrap">' + ddEsc_(r.acm) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#5A6B7B;font-size:13px">' + base.toFixed(1) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#14243A;font-size:13px">' + ddInt_(y) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#B42318;font-weight:700;font-size:13px">&minus;' + drop.toFixed(1) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#B42318;font-size:12px">&minus;' + ddNum_(r.dropPct).toFixed(0) + '%</td>' +
      '<td style="' + tdp + 'min-width:120px"><div style="font-size:13px;font-weight:700;white-space:nowrap;color:' + (kd ? "#B42318" : "#14243A") + '">&minus;' + ddNum_(r.impactPct).toFixed(1) + '% <span style="font-size:11px;font-weight:400;color:#7A889A">of SKU</span></div>' +
        '<div style="font-size:11px;color:#7A889A;margin-top:2px">' + ddNum_(r.skuSharePct).toFixed(0) + '% of SKU\'s drop' + (kd ? ' <span style="background:#FDECEC;color:#B42318;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;white-space:nowrap;display:inline-block">KEY DRIVER</span>' : '') + '</div></td>' +
      '<td style="' + tdp + 'width:92px"><div style="font-size:12px;color:#14243A;font-weight:600">' + ddNum_(r.contrPct).toFixed(1) + '%</div><div style="background:#E6EBF2;height:4px;border-radius:2px;margin-top:4px"><div style="background:#2F5D8A;height:4px;border-radius:2px;width:' + Math.min(100, ddNum_(r.contrPct) * 6).toFixed(0) + '%"></div></div></td>' +
      '<td align="right" style="' + tdp + 'color:#B42318;font-weight:700;font-size:13px">&minus;' + ddInt_(r.lostGmv) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#14243A;font-size:12px">' + (ddNum_(meta.lostGmv) ? ddNum_(r.lostGmv) / ddNum_(meta.lostGmv) * 100 : 0).toFixed(1) + '%</td>' +
      '<td align="right" style="' + tdp + 'font-size:13px;color:' + (stock <= 0 ? "#B42318;font-weight:700" : "#14243A") + '">' + ddInt_(stock) + '</td>' +
      '<td align="right" style="' + tdp + 'font-size:13px;color:#5A6B7B">' + (r.hasLock ? ddInt_(r.locked) : "&ndash;") + '</td>' +
      '<td style="' + tdp + '">' + (causeParts.length ? causeParts : ["Demand drop"]).map(function (c) { var k = c === "Locked Qty" ? ["#FFF4E0", "#B54708"] : c === "Demand drop" ? ["#E8EEF7", "#1F3F5F"] : ["#FDECEC", "#B42318"]; return '<span style="background:' + k[0] + ';color:' + k[1] + ';font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;white-space:nowrap;display:inline-block;margin:1px 2px 1px 0">' + ddEsc_(c) + '</span>'; }).join("") + '</td></tr>';
  });
  var kpi = function (label, val, sub, col) {
    return '<div class="kpi" style="display:inline-block;vertical-align:top;width:25%;font-size:14px;box-sizing:border-box;padding:0 5px 10px"><div style="background:#F4F7FB;border:1px solid #E1E8F0;border-radius:10px;padding:14px;min-height:92px"><div style="font-size:11px;color:#6B7A8C;text-transform:uppercase;letter-spacing:.6px">' + label + '</div><div style="font-size:24px;font-weight:700;color:' + (col || "#14243A") + ';margin-top:4px">' + val + '</div><div style="font-size:11px;color:#8A97A6;margin-top:2px;line-height:1.4">' + sub + '</div></div></div>';
  };
  var th = function (t, a) { return '<th align="' + (a || "left") + '" style="padding:8px 6px;line-height:1.3;vertical-align:bottom;font-size:11px;color:#6B7A8C;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #D5DEE9;font-weight:700">' + t + '</th>'; };
  var tgt = ddNum_(meta.avgTarget), act = ddNum_(meta.avgActual), gapTxt = "&mdash;", gapSub = "set this month's target", gapCol = "#14243A";
  if (tgt && !ddNum_(meta.mtdDays)) { gapSub = "target " + ddInt_(tgt) + "/day &middot; no full day yet"; }
  else if (tgt) { var gap = act - tgt; gapTxt = ddInt_(act) + " / day"; gapSub = (gap >= 0 ? "+" : "&minus;") + ddInt_(Math.abs(gap)) + " (" + (gap >= 0 ? "+" : "&minus;") + Math.abs(gap / tgt * 100).toFixed(1) + "%) vs target " + ddInt_(tgt) + (ddNum_(meta.mtdPlaced) ? " &middot; " + ddInt_(meta.mtdPlaced) + " pcs over " + ddNum_(meta.mtdDays) + " full day(s)" : ""); gapCol = gap >= 0 ? "#067647" : "#B42318"; }
  var dashUrl = DD_DASHBOARD_URL ? DD_DASHBOARD_URL.split("#")[0].split("?")[0] + "?view=decline" : "";
  var fbNote = '<tr><td class="pad" style="padding:0 30px 6px"><div style="background:#FFF8E6;border:1px solid #F5DFA6;border-radius:8px;padding:12px 14px;font-size:13px;color:#7A5A00;line-height:1.5"><b>Action needed:</b> please open the <b>Decline Matches</b> page in the dashboard, filter by your name, and write your feedback on each of your matches.</div></td></tr>';
  var btn = fbNote + (dashUrl ? '<tr><td align="center" style="padding:18px 30px 26px"><a href="' + ddEsc_(dashUrl) + '" style="display:inline-block;background:#2F5D8A;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px">Open Decline Matches</a></td></tr>' : '');
  var acmNote = meta.acm && meta.acm !== "All" ? ' · ACM: ' + ddEsc_(meta.acm) : '';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Decline Matches</title>' +
  '<style>.cc{border:1px solid #E1E8F0;border-radius:10px;padding:10px 12px;margin:0 0 8px;background:#fff}.ca{background:#F7F9FC}.c1{vertical-align:top;font-size:13px;color:#14243A;line-height:1.35}.c2{vertical-align:top;white-space:nowrap;padding-left:8px}.cg{color:#7A889A;font-size:12px}.cdr{color:#B42318;font-weight:700;font-size:16px}.cr{color:#B42318!important;font-size:inherit}.cl1{font-size:12px;color:#4A5B6E;margin-top:5px;line-height:1.45}.cl1 b{color:#14243A}.ch{font-size:11px;font-weight:700;padding:2px 7px;border-radius:9px;display:inline-block;margin:4px 3px 0 0}.cs{background:#FDECEC;color:#B42318}.cl{background:#FFF4E0;color:#B54708}.cd{background:#E8EEF7;color:#1F3F5F}' +
  '@media only screen and (max-width:900px){.dt{display:none!important;max-height:0!important;overflow:hidden!important}.mc{display:block!important;max-height:none!important;overflow:visible!important}.pad{padding-left:10px!important;padding-right:10px!important}.kpi{width:50%!important}.hd{font-size:21px!important}.outer{padding:10px 4px!important}}@media only screen and (max-width:380px){.kpi{width:100%!important}}</style></head>' +
  '<body style="margin:0;background:#EAEFF5;font-family:Segoe UI,Arial,Helvetica,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#EAEFF5"><tr><td align="center" class="outer" style="padding:28px 12px">' +
  '<!--[if mso]><table width="1200" cellpadding="0" cellspacing="0"><tr><td><![endif]-->' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:1200px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #D9E1EB">' +
  '<tr><td class="pad" style="background:#1F3F5F;padding:24px 30px"><table cellpadding="0" cellspacing="0"><tr>' +
  '<td style="vertical-align:middle"><div style="font-size:11px;color:#9FB6CF;letter-spacing:1.4px;text-transform:uppercase">Marketplace &middot; Daily Digest</div><div class="hd" style="font-size:26px;font-weight:700;color:#fff;margin-top:4px">Decline Matches</div>' +
  '<div style="font-size:13px;color:#C9D8E8;margin-top:4px">Top ' + rows.length + ' matches that pulled Placed down yesterday &middot; ' + ddEsc_(meta.dateLabel) + acmNote + '</div></td></tr></table></td></tr>' +
  (meta.sample ? '<tr><td style="background:#FFF4E0;color:#B54708;font-size:12px;font-weight:700;padding:8px 30px;letter-spacing:.4px">SAMPLE DATA &mdash; design preview only, these numbers are not real.</td></tr>' : '') +
  '<tr><td class="pad" style="padding:24px 20px 0;font-size:0">' +
  kpi("Total Placed drop", "&minus;" + ddInt_(totalDrop), "pieces vs. 4-day avg", "#B42318") +
  kpi("Lost GMV (Placed)", "&minus;" + ddInt_(meta.lostGmv), "Top " + rows.length + ": &minus;" + ddInt_(meta.lostGmvTop), "#B42318") +
  kpi("Lost Placed MTD vs Target", ddNum_(meta.mtdDays) ? ((ddNum_(meta.mtdGain) - ddNum_(meta.mtdLost)) >= 0 ? "+" : "&minus;") + ddInt_(Math.abs(ddNum_(meta.mtdGain) - ddNum_(meta.mtdLost))) : "&mdash;", ddNum_(meta.mtdDays) ? "net vs previous 4-day avg &middot; lost &minus;" + ddInt_(meta.mtdLost) + " &middot; gained +" + ddInt_(meta.mtdGain) + " &middot; " + ddNum_(meta.mtdDays) + " full day(s)" : "no full day yet this month", (ddNum_(meta.mtdGain) - ddNum_(meta.mtdLost)) >= 0 ? "#067647" : "#B42318") +
  kpi("Avg Placed MTD vs Target", gapTxt, gapSub, gapCol) +
  '' +
  kpi("Top " + rows.length + " Drop Share", share.toFixed(0) + "%", "of the total drop") +
  kpi("Stock issue", oos, "out of / low stock, of the Top " + rows.length, "#B42318") +
  kpi("Key drivers", keyDrivers, "merchants driving 50%+ of their SKU's drop", "#B42318") +
  kpi("Locked Qty", locked, "of the Top " + rows.length, "#B54708") +
  '</td></tr>' +
  '<tr><td class="pad" style="padding:4px 30px 6px"><div style="font-size:13px;color:#4A5B6E;line-height:1.55">The ' + rows.length + ' matches below account for <b>' + share.toFixed(0) + '%</b> of yesterday\'s Placed decline. <b>' + oos + '</b> have a stock issue, out of or low stock (a Supply issue) and <b>' + locked + '</b> have a lock quantity issue (a Marketplace issue), so those can be checked first by the relevant team.</div></td></tr>' +
  '<tr><td class="pad mc" style="display:none;max-height:0;overflow:hidden;mso-hide:all;padding:12px 10px 4px">' + cards +
  '<div style="border-radius:10px;padding:10px 12px;background:#EEF3F9;font-size:12px;color:#14243A;line-height:1.5"><b>Top ' + rows.length + ' total:</b> 4D avg ' + tb.toFixed(1) + ' &rarr; ' + ddInt_(ty) + ' &middot; <b style="color:#B42318">&minus;' + (tb - ty).toFixed(1) + '</b> pcs &middot; Lost GMV <b style="color:#B42318">&minus;' + ddInt_(meta.lostGmvTop) + '</b> &middot; ' + share.toFixed(0) + '% of the drop</div></td></tr>' +
  '<tr><td class="dt" style="padding:12px 22px 8px"><div style="overflow-x:auto"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
  th("#") + th("SKU ID / Name") + th("Merchant ID / Name") + th("ACM") + th("4D avg", "right") + th("Yesterday", "right") + th("Drop", "right") + th("Drop %", "right") + th("Impact on SKU") + th("Contr%") + th("Lost GMV", "right") + th("GMV Contr%", "right") + th("Stock", "right") + th("Locked", "right") + th("Likely cause") +
  '</tr>' + trs +
  '<tr style="background:#EEF3F9"><td></td><td colspan="3" style="padding:11px 8px;font-weight:700;color:#14243A;font-size:13px">Top ' + rows.length + ' total</td><td align="right" style="padding:11px 8px;font-weight:700;font-size:13px">' + tb.toFixed(1) + '</td><td align="right" style="padding:11px 8px;font-weight:700;font-size:13px">' + ddInt_(ty) + '</td><td align="right" style="padding:11px 8px;font-weight:700;color:#B42318;font-size:13px">&minus;' + (tb - ty).toFixed(1) + '</td><td align="right" style="padding:11px 8px;font-weight:700;color:#B42318;font-size:12px">&minus;' + (tb ? ((tb - ty) / tb * 100).toFixed(0) : 0) + '%</td><td></td><td style="padding:11px 8px;font-weight:700;font-size:12px">' + share.toFixed(1) + '%</td><td align="right" style="padding:11px 8px;font-weight:700;color:#B42318;font-size:13px">&minus;' + ddInt_(meta.lostGmvTop) + '</td><td align="right" style="padding:11px 8px;font-weight:700;font-size:12px">' + (ddNum_(meta.lostGmv) ? ddNum_(meta.lostGmvTop) / ddNum_(meta.lostGmv) * 100 : 0).toFixed(1) + '%</td><td colspan="3"></td></tr>' +
  '</table></div></td></tr>' + btn +
  '<tr><td class="pad" style="background:#F4F7FB;padding:16px 30px;border-top:1px solid #E1E8F0"><div style="font-size:11px;color:#7A889A;line-height:1.6"><b>How to read:</b> Drop = average Placed over the 4 days before yesterday minus yesterday\'s Placed, in pieces. A match is listed if its drop is at least 3 pieces. Contr% = the match\'s share of the total drop across all declining matches. Impact on SKU = this merchant\'s drop as % of the SKU\'s 4-day average Placed across all merchants, plus its share of the SKU\'s total drop (KEY DRIVER = 50% or more). Likely cause: Out of stock = SKU stock is 0; Low stock = SKU stock is below the match\'s 4-day average; a match can have a stock issue and a lock issue together; Locked Qty = the merchant has an active lock whose remaining quantity is below his 4-day average; otherwise Demand drop. Lost GMV = drop &times; ASP. Lost Placed MTD = net change (gains minus drops) vs. each day\'s previous 4-day average, summed over all matches and the full days of the current month. Avg Placed MTD vs Target compares the average daily Placed since the start of the month (total Placed over full days / number of days) to the monthly target.<br>Marketplace Performance Dashboard</div></td></tr>' +
  '</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>';
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// ============================================================================
//  ONE-TIME INTRO / KICKOFF EMAIL (first email each recipient list receives)
//  1) Put the real addresses in DECLINE_INTRO_RECIPIENTS (one list at a time).
//  2) Run sendDeclineIntroEmail() from the editor. Leave the default to send
//     only to yourself as a test.
// ============================================================================
var DECLINE_INTRO_RECIPIENTS = DECLINE_DIGEST_RECIPIENTS;

function buildDeclineIntroHtml_() {
  var url = DD_DASHBOARD_URL + "?view=decline";
  var f = "font-family:Segoe UI,Arial,sans-serif;";
  return '<div style="' + f + 'max-width:640px;margin:0 auto;color:#1D2939;">' +
    '<div style="background:#0B1F3A;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;">' +
      '<div style="font-size:12px;letter-spacing:.08em;opacity:.7;">MARKETPLACE</div>' +
      '<div style="font-size:20px;font-weight:700;margin-top:2px;">Daily Decline Matches — what is changing</div></div>' +
    '<div style="border:1px solid #E4E7EC;border-top:0;padding:22px;border-radius:0 0 10px 10px;font-size:14px;line-height:1.6;">' +
    '<p style="margin:0 0 12px;">Hi team,</p>' +
    '<p style="margin:0 0 12px;">Starting now, an <b>automatic email will be sent every day at 12:00 (Cairo time)</b> listing the Top 20 Merchant × SKU matches whose Placed dropped yesterday compared with their previous 4-day average, with the lost pieces, lost GMV and the likely cause (stock, locked quantity or demand).</p>' +
    '<p style="margin:0 0 6px;"><b>What we need from each ACM, every day:</b></p>' +
    '<ol style="margin:0 0 14px;padding-left:20px;">' +
      '<li><b>Reason of decline</b> for each of your matches in the list. If the system shows <i>Demand drop</i>, please tell us what the actual reason is (e.g. price change, product quality, merchant issue, competitor, seasonality).</li>' +
      '<li><b>Action</b> that will be taken (who does what, and by when).</li></ol>' +
    '<p style="margin:0 0 6px;"><b>How to submit:</b></p>' +
    '<ol style="margin:0 0 16px;padding-left:20px;">' +
      '<li>Click the button below to open <b>Marketplace → Decline Matches</b> in the dashboard.</li>' +
      '<li>Choose your name in the ACM filter at the top, so you only see your merchants.</li>' +
      '<li>Write the reason + action in the <b>Feedback</b> box of each row and press Save. Feedback is stored per day.</li></ol>' +
    '<p style="margin:0 0 18px;"><a href="' + url + '" style="background:#1570EF;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">Open Decline Matches</a></p>' +
    '<p style="margin:0 0 4px;">Quick guide to the cause labels: <b>Out of stock / Low stock</b> = Supply issue, <b>Locked Qty</b> = Marketplace issue, <b>Demand drop</b> = needs your input.</p>' +
    '<p style="margin:14px 0 0;color:#667085;font-size:12px;">This is the only kickoff message — from tomorrow you will receive the regular daily digest at 12:00. Thank you for your support.</p>' +
    '</div></div>';
}

function sendDeclineIntroEmail() {
  sendDeclineMail_("Marketplace Decline Matches — daily email at 12:00 & feedback needed", buildDeclineIntroHtml_(), DECLINE_INTRO_RECIPIENTS);
  Logger.log("Intro sent to " + DECLINE_INTRO_RECIPIENTS.join(", "));
}

// يمسح ملفات آخر مزامنة المحفوظة (عشان أول مزامنة بعدها تبدأ من صفر من غير مقارنة بنسخة قديمة).
function resetLastSyncFiles() {
  var folder = getOrCreateLastSyncFolder_();
  [LAST_SYNC_FILE_NAME, LAST_SYNC_IRQ_FILE_NAME].forEach(function (n) {
    var it = folder.getFilesByName(n);
    while (it.hasNext()) { it.next().setTrashed(true); }
  });
  PropertiesService.getScriptProperties().deleteProperty("last_sync_content_hash_v1");
}


// ============================================================================
//  v1.17.0 — Actual returns for Supply Chain → Supply conversion (Returns row)
//  Same as the Inventory Aging sheet ("Returns & Beg" tab):
//    file  Return_Archive_YYYY-MM  →  tab Return_RCV (A:O)
//    SUM(Quantity [G]) WHERE Product Condition Return [J] = "Product is good"  GROUP BY Product Code [E]
//  The file is found by its name for the month (no URL to update every month).
//  Override for a month: Script property RETURNS_ARCHIVE_<YYYY-MM> = the file URL or ID.
// ============================================================================
// v1.18.0 — the exact file per month (used before the search by name). Add the new month's file here, or leave it out and the
// file named Return_Archive_YYYY-MM is found by its name as before.
var RETURNS_ARCHIVE_IDS = {
  "2026-11": "1oifWHi0O5TtBVL_az_k1IEBJ3I8HU9pUleuPSduPda8"
};
function handleActualReturns_(payload) {
  if (!workerKeyOk_(payload)) return jsonResponse({ success: false, message: "Not allowed (WORKER_SERVICE_KEY)." });
  return jsonResponse(computeActualReturns_(payload.month));
}
// v1.17.0 — split out of handleActualReturns_ so the Supply conversion export can reuse it.
function computeActualReturns_(monthIn) {
  var payload = { month: monthIn };
  var month = String(payload.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) month = Utilities.formatDate(new Date(), "Africa/Cairo", "yyyy-MM");
  var name = "Return_Archive_" + month, file = null;
  try {
    var ov = PropertiesService.getScriptProperties().getProperty("RETURNS_ARCHIVE_" + month) || RETURNS_ARCHIVE_IDS[month] || "";
    if (ov) { var id = (/\/d\/([a-zA-Z0-9_-]+)/.exec(ov) || [null, ov])[1]; file = DriveApp.getFileById(id); }
    else {
      var it = DriveApp.getFilesByName(name), best = null;
      while (it.hasNext()) { var f = it.next(); if (f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue; if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f; }
      file = best;
    }
  } catch (err) { return ({ success: false, message: "Could not open the returns archive for " + month + ": " + err.message }); }
  if (!file) return ({ success: false, code: "no_file", message: "No file named " + name + " is shared with the script account." });
  var ss = SpreadsheetApp.openById(file.getId()), sh = ss.getSheetByName("Return_RCV");
  if (!sh) return ({ success: false, message: "Tab Return_RCV not found in " + file.getName() });
  var last = sh.getLastRow();
  if (last < 2) return ({ success: true, month: month, file: file.getName(), rows: 0, total: 0, skus: {} });
  var data = sh.getRange(2, 1, last - 1, 15).getValues(), skus = {}, total = 0, rows = 0, lastScan = null;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (r[9] !== "Product is good") continue;
    var sku = String(r[4] == null ? "" : r[4]).trim(); if (!sku) continue;
    var q = typeof r[6] === "number" ? r[6] : 0;
    skus[sku] = (skus[sku] || 0) + q; total += q; rows++;
    if (r[0] instanceof Date && (!lastScan || r[0] > lastScan)) lastScan = r[0];
  }
  return ({ success: true, month: month, file: file.getName(), fileUpdated: file.getLastUpdated().toISOString(), rows: rows, total: total, lastScan: lastScan ? lastScan.toISOString() : null, skus: skus });
}

// Run this once from the Apps Script editor (select testActualReturns → Run):
// it asks for the Drive permission if needed and logs what the dashboard would get.
function testActualReturns() {
  var k = PropertiesService.getScriptProperties().getProperty("WORKER_SERVICE_KEY") || "";
  var month = Utilities.formatDate(new Date(), "Africa/Cairo", "yyyy-MM");
  var out = JSON.parse(handleActualReturns_({ serviceKey: k, month: month }).getContent());
  Logger.log("success=" + out.success + " · " + (out.message || "") + " · file=" + (out.file || "-") + " · rows=" + (out.rows || 0) + " · total pieces=" + (out.total || 0) + " · SKUs=" + Object.keys(out.skus || {}).length + (k.length < 16 ? " · WARNING: WORKER_SERVICE_KEY is missing or shorter than 16 characters" : ""));
}
