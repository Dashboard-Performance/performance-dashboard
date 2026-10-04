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
 *  EXTERNAL "COMPUTED DATA" API (read the dashboard's live numbers from
 *  outside, per section/table) — see the big comment above COMPUTED_API_KEYS
 *  further down for how it works. Quick start:
 *  1. Change COMPUTED_API_KEYS below to your own secret key(s).
 *  2. Deploy a new version (step 6 above).
 *  3. Open the dashboard once (or wait for its next hourly auto-refresh) so
 *     it publishes its first snapshot.
 *  4. GET <Web app URL>?action=listComputed&key=YOUR_KEY to see what's
 *     available, then GET ...&action=getComputed&section=..&table=..&key=..
 *     to pull one table's live computed rows as JSON.
 * ============================================================================
 */

var SPREADSHEET_ID = "1Vg8P1EL5y_FqQSR7_uDI1XtB-gDe0Bkj7IqbiOzNgxA";
var USERS_SHEET_GID = 1839838273;
var ALLOWED_EMAIL_DOMAIN = "taager.com";

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

/**
 * ============================================================================
 *  COMPUTED DATA API — lets an outside consumer (a script, a BI tool, another
 *  team's app) pull the dashboard's already-computed numbers (exactly what a
 *  user sees in a given section/table — MTD targets, Achieved%, CR/DR%, etc.)
 *  over plain HTTP, without opening the dashboard in a browser.
 *
 *  WHY IT WORKS THIS WAY
 *  Every real computation (targets, lag cutoffs, debundling, run rates...)
 *  lives in js/app.js and runs client-side in the browser — reimplementing
 *  all of that a second time here in Apps Script would mean keeping two
 *  parallel copies of dozens of formulas in sync forever, which breaks
 *  quickly in practice. Instead: whenever the dashboard is open in a browser
 *  and finishes loading/refreshing its data (on page load, and every hourly
 *  auto-refresh, and on manual "Refresh"), it PUBLISHES its own already-
 *  computed tables here (see publishComputedSnapshots() in app.js). This
 *  endpoint just stores the latest one it received per (section, table) and
 *  serves it back on request — so the data is "live" as of the last time
 *  someone had the dashboard open, which in practice (a team dashboard that
 *  gets opened throughout the day, plus the hourly auto-refresh) stays fresh.
 *
 *  SETUP
 *  1. Change COMPUTED_API_KEYS below to your own secret key(s) — anyone with
 *     a key can read published data (not write it; only the dashboard itself
 *     can publish, since that goes through this same script, not a public key).
 *  2. Redeploy (Manage deployments > Edit > New version) so it's live.
 *
 *  CONSUME IT
 *    GET <deployment URL>?action=getComputed&section=commercialPlan&table=main&key=YOUR_KEY
 *    GET <deployment URL>?action=listComputed&key=YOUR_KEY   (see what's published)
 * ============================================================================
 */
var COMPUTED_API_KEYS = ["Admin-Panal-Center"]; // <-- replace before sharing this URL with anyone
var COMPUTED_SNAPSHOTS_FOLDER_ID = ""; // leave "" to auto-create/reuse, like BACKUP_FOLDER_ID above
var COMPUTED_SNAPSHOTS_FOLDER_NAME = "Performance Dashboard Computed Snapshots";

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
  if (action === "backup_chunk") return handleBackupChunk(payload);
  if (action === "save_match_feedback") return handleSaveMatchFeedback(payload);
  if (action === "add_new_locked_matches") return handleAddNewLockedMatches(payload);
  if (action === "publish_computed_batch") return handlePublishComputedBatch(payload);
  if (action === "publish_analyst_single_daily") return handlePublishAnalystSingleDaily(payload);
  if (action === "send_decline_digest") return handleSendDeclineDigest(payload);
  if (action === "save_decline_feedback") return handleSaveDeclineFeedback(payload);
  if (action === "get_decline_feedback") return handleGetDeclineFeedback(payload);
  return jsonResponse({ success: false, message: "Unknown action." });
}

/**
 * Called by js/app.js (publishComputedSnapshots) after every fresh data
 * load/refresh. payload.sections = [{ section, table, rows }, ...] — each
 * one overwrites whatever was previously published for that exact
 * (section, table) pair. No API key required here (this is the dashboard
 * itself publishing its own data, through the same trusted deployment) —
 * only reading it back (getComputed/listComputed) requires a key.
 */
function handlePublishComputedBatch(payload) {
  var sections = payload.sections;
  if (!sections || !sections.length) return jsonResponse({ success: false, message: "No sections provided." });

  // ملحوظة مهمة: عمدًا من غير LockService.getScriptLock() هنا (بعكس باقي
  // الـ handlers التانية في الملف ده). getScriptLock() قفل عام على المشروع
  // كله — أي حاجة تانية بتستخدمه (login/signup/heartbeat/feedback...) بتقف
  // تستنى لحد ما يتفك. الداشبورد بيبعت 27 طلب نشر متتالي (واحد لكل سكشن)
  // كل مرة يعمل ريفريش، وبعضهم بيكتب ملفات كبيرة على Drive (آلاف الصفوف) —
  // لو استخدمنا نفس القفل العام هنا، أي طلب تسجيل دخول أو heartbeat بيوصل
  // في نفس اللحظة كان بيستنى ورا الـ 27 طلب دول، وده اللي كان بيسبب
  // الـ "blocked by CORS policy" اللي كان بيظهر فجأة (الطلب بيتأخر جدًا أو
  // بيتقطع من جوجل، والرد اللي بيرجع في الحالة دي مالوش CORS headers خالص).
  // هنا مش محتاجين قفل أصلاً: كل سكشن بيكتب في ملف خاص بيه بس (section__table.json)،
  // فمفيش تعارض حقيقي بين الطلبات دي وبعضها.
  try {
    var folder = getOrCreateComputedSnapshotsFolder();
    var publishedAt = new Date().toISOString();
    var results = [];
    sections.forEach(function (s) {
      var section = sanitizeComputedName(s.section);
      var table = sanitizeComputedName(s.table);
      if (!section || !table) { results.push({ section: s.section, table: s.table, ok: false, error: "Invalid section/table name." }); return; }

      var fileName = section + "__" + table + ".json";
      var content = JSON.stringify({
        section: section,
        table: table,
        updatedAt: publishedAt,
        rowCount: Array.isArray(s.rows) ? s.rows.length : 0,
        rows: s.rows || []
      });

      var existing = folder.getFilesByName(fileName);
      if (existing.hasNext()) {
        existing.next().setContent(content);
      } else {
        folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
      }
      results.push({ section: section, table: table, ok: true });
    });
    return jsonResponse({ success: true, publishedAt: publishedAt, results: results });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

/**
 * Called by js/app.js (publishAnalystSingleDaily) — either automatically as
 * part of every publishComputedSnapshots() cycle, or manually via the
 * "Force Refresh Analyst/Single Daily" button in the Worker Sync Status
 * modal. payload.rows = the full rolling-30-day window (every day computed
 * independently — see the comment above buildPpmAnalystSingleDailyRows() in
 * js/app.js). Unlike handlePublishComputedBatch above, this writes straight
 * into a real sheet tab (ANALYST_SINGLE_DAILY_SHEET_NAME) in the same
 * spreadsheet, completely replacing its previous contents every time — it's
 * a snapshot of "last 30 days as of now", not an append-only log.
 *
 * A short script lock IS used here (unlike handlePublishComputedBatch)
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
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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

function handleGetComputed(e) {
  var keyCheck = requireComputedApiKey(e);
  if (keyCheck) return keyCheck;

  var section = sanitizeComputedName((e.parameter && e.parameter.section) || "");
  var table = sanitizeComputedName((e.parameter && e.parameter.table) || "");
  if (!section || !table) return jsonResponse({ success: false, message: "section and table query params are required." });

  try {
    var folder = getOrCreateComputedSnapshotsFolder();
    var fileName = section + "__" + table + ".json";
    var files = folder.getFilesByName(fileName);
    if (!files.hasNext()) {
      return jsonResponse({ success: false, message: "No data published yet for section='" + section + "', table='" + table + "'." });
    }
    var content = files.next().getBlob().getDataAsString();
    var parsed = JSON.parse(content);
    return jsonResponse({ success: true, section: parsed.section, table: parsed.table, updatedAt: parsed.updatedAt, rowCount: parsed.rowCount, rows: parsed.rows });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

function handleListComputed(e) {
  var keyCheck = requireComputedApiKey(e);
  if (keyCheck) return keyCheck;

  try {
    var folder = getOrCreateComputedSnapshotsFolder();
    var files = folder.getFiles();
    var list = [];
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      if (!/\.json$/.test(name)) continue;
      var parts = name.replace(/\.json$/, "").split("__");
      var entry = { section: parts[0] || "", table: parts[1] || "" };
      try {
        var parsed = JSON.parse(f.getBlob().getDataAsString());
        entry.updatedAt = parsed.updatedAt;
        entry.rowCount = parsed.rowCount;
      } catch (err) { /* skip metadata, keep the name-derived entry */ }
      list.push(entry);
    }
    return jsonResponse({ success: true, available: list });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

function requireComputedApiKey(e) {
  var key = (e.parameter && e.parameter.key) || "";
  if (COMPUTED_API_KEYS.indexOf(key) === -1) {
    return jsonResponse({ success: false, message: "Missing or invalid API key." });
  }
  return null;
}

function sanitizeComputedName(name) {
  return String(name || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
}

function getOrCreateComputedSnapshotsFolder() {
  if (COMPUTED_SNAPSHOTS_FOLDER_ID) {
    return DriveApp.getFolderById(COMPUTED_SNAPSHOTS_FOLDER_ID);
  }
  var existing = DriveApp.getFoldersByName(COMPUTED_SNAPSHOTS_FOLDER_NAME);
  if (existing.hasNext()) return existing.next();
  var created = DriveApp.createFolder(COMPUTED_SNAPSHOTS_FOLDER_NAME);
  Logger.log("Created computed-snapshots folder. Paste this into COMPUTED_SNAPSHOTS_FOLDER_ID: " + created.getId());
  return created;
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
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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
 *  Call: GET <deployment URL>?action=getComputed&section=..&table=..&key=..
 *        GET <deployment URL>?action=listComputed&key=..
 * ============================================================================
 */
function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : null;
  if (action === "getLastSync") return handleGetLastSync(e);
  if (action === "getLastSyncMeta") return handleGetLastSyncMeta(e);
  if (action === "getLastSyncDebug") return handleGetLastSyncDebug(e);
  if (action === "getComputed") return handleGetComputed(e);
  if (action === "listComputed") return handleListComputed(e);
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
var LAST_SYNC_GIDS = [
  "22283311",    // BEGIN_INV_GID — أكبر شيت في القايمة
  "548859670",   // SELLTHROUGH_NEEDED_GID
  "1409034448",  // PRODUCTS_DEBUNDLE_MAP_GID
  "1620722565",  // SINGLE_SKU_TARGETS_GID
  "1724469150",  // COGS_GID
  "2085802038",  // AVAILABILITY_LOCKING_GID
  String(PRODUCTS_MATCHES_GID), // 1298408207
  "461854229",   // MERCHANT_SKU_DAILY_GID
  "620123165",   // MERCHANT_SEGMENTATION_GID
  "1289659887",  // WEEKLY_INVENTORY_GID
  "897709273",   // WAREHOUSE_REPACK_GID
  // v1.1.46: الـ 10 شيت دول كانوا بيتقروا من الـ Worker مباشرة
  // (GENERAL_MIRROR_GIDS في worker.js) — دلوقتي بقوا هنا زي كل شيت تاني.
  "115442405",   // TARGETS_GID
  "891214324",   // SEGMENTATION_GID
  "2042936628",  // TARGETS_ACM_GID
  "1780730573",  // INVENTORY_GID
  "1779314157",  // PRODUCTS_GID
  "1656655269",  // CAT_TARGETS_GID
  "892918900",   // ACM_SALES_PLAN_GID
  "1304674893",  // NEW_SEGMENTATION_GID
  "565878313",   // INBOUND_GID
  "531154071",   // PRODUCTS_INFO_GID
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
    url: "https://docs.google.com/spreadsheets/d/" + SPREADSHEET_ID + "/gviz/tq?gid=" + encodeURIComponent(gid) + "&tqx=out:json",
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

  var content = JSON.stringify({ success: true, fetchedAt: payload.fetchedAt, sheets: payload.sheets });
  var gzBlob = Utilities.gzip(Utilities.newBlob(content, "application/json"), LAST_SYNC_FILE_NAME);

  var existing = folder.getFilesByName(LAST_SYNC_FILE_NAME);
  while (existing.hasNext()) { existing.next().setTrashed(true); }
  var oldArchive = folder.getFilesByName("archive.gz");
  while (oldArchive.hasNext()) { oldArchive.next().setTrashed(true); }
  folder.createFile(gzBlob);

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
    return (parsed && parsed.sheets) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function handleGetLastSync(e) {
  try {
    var folder = getOrCreateLastSyncFolder_();
    var files = folder.getFilesByName(LAST_SYNC_FILE_NAME);
    if (files.hasNext()) {
      var gzBlob = files.next().getBlob();
      var fetchedAt = PropertiesService.getScriptProperties().getProperty(LAST_SYNC_META_PROP_KEY) || null;
      var base64 = Utilities.base64Encode(gzBlob.getBytes());
      return jsonResponse({ success: true, fetchedAt: fetchedAt, gzBase64: base64 });
    }
    // Fallback: لسه مفيش أي مزامنة مركزية اتسجلت — بنرجع لجلب لايف عادي.
    var payload = fetchSheetsPayload_(LAST_SYNC_GIDS);
    var content = JSON.stringify({ success: true, fetchedAt: payload.fetchedAt, sheets: payload.sheets });
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

var LAST_SYNC_GID_LABELS_ = {
  "22283311": "Beginning Inventory", "548859670": "Sell-through Needed",
  "1409034448": "Products Debundle Map", "1620722565": "Single SKU Targets",
  "1724469150": "COGS", "2085802038": "Availability Locking",
  "1298408207": "Products & Matches", "461854229": "Merchant SKU Daily",
  "620123165": "Merchant Segmentation", "1289659887": "Weekly Inventory",
  "897709273": "Warehouse Repack",
  "115442405": "Targets", "891214324": "Segmentation",
  "2042936628": "Targets ACM", "1780730573": "Inventory",
  "1779314157": "Products", "1656655269": "Category Targets",
  "892918900": "ACM Sales Plan", "1304674893": "New Segmentation",
  "565878313": "Inbound", "531154071": "Products Info",
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
      message: "Sign up is only allowed with an @" + ALLOWED_EMAIL_DOMAIN + " email.",
    });
  }
  if (password.length < 6) {
    return jsonResponse({ success: false, message: "Password must be at least 6 characters." });
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

    sheet.appendRow([name, email, password, role]);
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
      if (rowPassword === password) {
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

function getUsersSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === USERS_SHEET_GID) return sheets[i];
  }
  throw new Error("Users sheet with GID " + USERS_SHEET_GID + " was not found.");
}

function isAllowedEmail(email) {
  var re = new RegExp("^[^\\s@]+@" + ALLOWED_EMAIL_DOMAIN.replace(".", "\\.") + "$", "i");
  return re.test(email);
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
    if (String(payload.requestedBy || "").trim().toLowerCase() !== "youssef.hanafy@taager.com") {
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
    sendDeclineMail_(subject, html, ["youssef.hanafy@taager.com"]); // the dashboard button only ever sends to you
    props.setProperty("DECLINE_DIGEST_LAST_SENT", String(Date.now()));
    return jsonResponse({ success: true, sentTo: "youssef.hanafy@taager.com" });
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
//  One row per (Decline Day, Merchant ID, SKU ID). Saving again the same day
//  overwrites that row; a new day appends new rows with the new date.
// ============================================================================
var DECLINE_FEEDBACK_SHEET = "Decline Feedback";
var DECLINE_FEEDBACK_HEADERS = ["Feedback Date", "Decline Day", "SKU ID", "SKU Name", "Merchant ID", "Merchant Name", "ACM", "4D Avg", "Yesterday", "Drop", "Lost GMV", "Likely Cause", "Feedback", "Submitted By", "Submitted By Email"];

function getDeclineFeedbackSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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
        if (String(keys[i][0]) === day && String(keys[i][1]) === skuId && String(keys[i][3]) === merchantId) { target = i + 2; break; }
      }
    }
    if (target === -1) target = last + 1;
    sh.getRange(target, 1, 1, vals.length).setValues([vals]);
    return jsonResponse({ success: true, at: now });
  } finally {
    lock.releaseLock();
  }
}

function handleGetDeclineFeedback(payload) {
  var day = String(payload.declineDay || "").trim();
  var items = {};
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DECLINE_FEEDBACK_SHEET);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, DECLINE_FEEDBACK_HEADERS.length).getValues().forEach(function (r) {
      if (String(r[1]) !== day) return;
      items[String(r[4]) + "||" + String(r[2])] = { feedback: String(r[12] || ""), by: String(r[13] || ""), at: String(r[0] || "") };
    });
  }
  return jsonResponse({ success: true, items: items });
}

// Run once to create the "Decline Feedback" tab (it is also created on the first feedback).
function setupDeclineFeedbackSheet() { getDeclineFeedbackSheet_(); }

// ============================================================================
//  REAL NUMBERS, computed here from the Google Sheet (no dashboard needed).
//  Same logic as the dashboard's Decline Matches page:
//   Drop = avg(DAY2..DAY5) - DAY1 (Placed), listed only if Drop >= 3 pcs; ranked by Drop; Contr% vs total drop;
//   Impact on SKU = Drop / SKU's 4-day avg across all merchants;
//   Stock from the Inventory tab; Locked = active lock remaining pieces.
// ============================================================================
var DD_DAILY_GID = 461854229;       // MERCHANT_SKU_DAILY_GID
var DD_MAIN_GID = 2099497960;      // MAIN_GID (daily rows: PLACED_ASP col X, placed pcs col P)
var DD_INVENTORY_GID = 1780730573;  // INVENTORY_GID
var DD_LOCKING_GID = 2085802038;    // AVAILABILITY_LOCKING_GID
var DD_MIN_DROP = 3;
var DD_EXCLUDED_MERCHANTS = { "1160154": true }; // excluded from Decline Matches (drops, totals, MTD lost); actual Avg Placed still counts them
var DD_TOP_N = 20;
var DD_TIMEZONE = "Africa/Cairo";
// Avg Placed Target (pieces/day) per month, key YYYY-MM. Update at the start of each month.
var DD_AVG_PLACED_TARGETS = { "2026-10": 5429 };
var DD_DASHBOARD_URL = "https://performance-center-taager.vercel.app/"; // optional: paste your dashboard link to get an "Open in Dashboard" button

function ddSheetByGid_(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getSheetId() === gid) return sheets[i];
  throw new Error("Sheet with GID " + gid + " not found.");
}

function computeDeclineDigest_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
  var s = function (v) { return String(v === null || v === undefined ? "" : v).trim(); };

  var inv = {};
  ddSheetByGid_(ss, DD_INVENTORY_GID).getDataRange().getValues().forEach(function (r, i) {
    var id = s(r[0]); if (!id || id === "SKU_ID") return;
    inv[id] = { name: s(r[1]), stock: Math.round(n(r[2])) };
  });

  var todayMs = new Date().setHours(0, 0, 0, 0);
  var lockRemaining = {}, lockActive = {};
  ddSheetByGid_(ss, DD_LOCKING_GID).getDataRange().getValues().forEach(function (r) {
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
  ddSheetByGid_(ss, DD_MAIN_GID).getDataRange().getValues().forEach(function (r) {
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
  ddSheetByGid_(ss, DD_DAILY_GID).getDataRange().getValues().forEach(function (r) {
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
    lostGmv: lostGmv, lostGmvTop: topGmv, mtdLost: mtdLost, mtdGain: mtdGain, mtdDays: mtdDays, mtdPlaced: mtdPlaced, avgActual: mtdDays ? mtdPlaced / mtdDays : 0, avgTarget: DD_AVG_PLACED_TARGETS[monthKey] || 0 } };
}

// RUN THIS to send the real email now (to DECLINE_DIGEST_RECIPIENTS).
function sendDeclineDigestNow() {
  var d = computeDeclineDigest_();
  if (!d.rows.length) { Logger.log("No declining matches found - nothing sent."); return; }
  sendDeclineMail_("Marketplace Decline Matches — " + d.meta.dateLabel, buildDeclineDigestHtml_(d.rows, d.meta));
  Logger.log("Sent Top " + d.rows.length + " to " + DECLINE_DIGEST_RECIPIENTS.join(", "));
}

// RUN THIS ONCE to schedule the email every day at 12:00 Cairo time.
function installDailyDeclineTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "sendDeclineDigestNow") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendDeclineDigestNow").timeBased().everyDays(1).atHour(12).inTimeZone(DD_TIMEZONE).create();
  Logger.log("Daily trigger installed: 12:00 " + DD_TIMEZONE);
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
  var trs = "";
  rows.forEach(function (r, i) {
    var base = ddNum_(r.base), y = ddNum_(r.y), drop = ddNum_(r.drop), stock = ddNum_(r.stock);
    var causeParts = String(r.cause || "").split(" + ").filter(function (x) { return x === "Out of stock" || x === "Low stock" || x === "Locked Qty"; });
    var cause = causeParts.length ? causeParts.join(" + ") : "Demand drop";
    var hasStockIssue = causeParts.indexOf("Out of stock") > -1 || causeParts.indexOf("Low stock") > -1, hasLockIssue = causeParts.indexOf("Locked Qty") > -1;
    var kd = ddNum_(r.skuSharePct) >= 50;
    if (hasStockIssue) oos++; if (hasLockIssue) locked++; if (kd) keyDrivers++;
    tb += base; ty += y;
    var bg = i % 2 ? "#F7F9FC" : "#FFFFFF";
    var tdp = "padding:10px 8px;";
    trs += '<tr style="background:' + bg + '">' +
      '<td style="' + tdp + 'color:#8A97A6;font-size:12px">' + (i + 1) + '</td>' +
      '<td style="' + tdp + 'min-width:150px"><div style="font-weight:700;color:#14243A;font-size:13px;white-space:nowrap">' + ddEsc_(r.skuId) + '</div><div style="color:#7A889A;font-size:11px;margin-top:2px;white-space:nowrap">' + ddEsc_(ddTrunc_(r.skuName, 40)) + '</div></td>' +
      '<td style="' + tdp + 'min-width:110px"><div style="font-weight:700;color:#14243A;font-size:13px;white-space:nowrap">' + ddEsc_(r.merchantId) + '</div><div style="color:#7A889A;font-size:11px;margin-top:2px;white-space:nowrap">' + ddEsc_(ddTrunc_(r.merchantName, 28)) + '</div></td>' +
      '<td style="' + tdp + 'color:#4A5B6E;font-size:12px;white-space:nowrap">' + ddEsc_(r.acm) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#5A6B7B;font-size:13px">' + base.toFixed(1) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#14243A;font-size:13px">' + ddInt_(y) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#B42318;font-weight:700;font-size:13px">&minus;' + drop.toFixed(1) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#B42318;font-size:12px">&minus;' + ddNum_(r.dropPct).toFixed(0) + '%</td>' +
      '<td style="' + tdp + 'white-space:nowrap"><div style="font-size:13px;font-weight:700;color:' + (kd ? "#B42318" : "#14243A") + '">&minus;' + ddNum_(r.impactPct).toFixed(1) + '% <span style="font-size:11px;font-weight:400;color:#7A889A">of SKU</span></div>' +
        '<div style="font-size:11px;color:#7A889A;margin-top:2px">' + ddNum_(r.skuSharePct).toFixed(0) + '% of SKU\'s drop' + (kd ? ' <span style="background:#FDECEC;color:#B42318;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px">KEY DRIVER</span>' : '') + '</div></td>' +
      '<td style="' + tdp + 'width:92px"><div style="font-size:12px;color:#14243A;font-weight:600">' + ddNum_(r.contrPct).toFixed(1) + '%</div><div style="background:#E6EBF2;height:4px;border-radius:2px;margin-top:4px"><div style="background:#2F5D8A;height:4px;border-radius:2px;width:' + Math.min(100, ddNum_(r.contrPct) * 6).toFixed(0) + '%"></div></div></td>' +
      '<td align="right" style="' + tdp + 'color:#B42318;font-weight:700;font-size:13px">&minus;' + ddInt_(r.lostGmv) + '</td>' +
      '<td align="right" style="' + tdp + 'color:#14243A;font-size:12px">' + (ddNum_(meta.lostGmv) ? ddNum_(r.lostGmv) / ddNum_(meta.lostGmv) * 100 : 0).toFixed(1) + '%</td>' +
      '<td align="right" style="' + tdp + 'font-size:13px;color:' + (stock <= 0 ? "#B42318;font-weight:700" : "#14243A") + '">' + ddInt_(stock) + '</td>' +
      '<td align="right" style="' + tdp + 'font-size:13px;color:#5A6B7B">' + (r.hasLock ? ddInt_(r.locked) : "&ndash;") + '</td>' +
      '<td style="' + tdp + '">' + (causeParts.length ? causeParts : ["Demand drop"]).map(function (c) { var k = c === "Locked Qty" ? ["#FFF4E0", "#B54708"] : c === "Demand drop" ? ["#E8EEF7", "#1F3F5F"] : ["#FDECEC", "#B42318"]; return '<span style="background:' + k[0] + ';color:' + k[1] + ';font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;white-space:nowrap;display:inline-block;margin:1px 2px 1px 0">' + ddEsc_(c) + '</span>'; }).join("") + '</td></tr>';
  });
  var kpi = function (label, val, sub, col) {
    return '<td width="25%" style="padding:0 5px;vertical-align:top"><div style="background:#F4F7FB;border:1px solid #E1E8F0;border-radius:10px;padding:14px"><div style="font-size:11px;color:#6B7A8C;text-transform:uppercase;letter-spacing:.6px">' + label + '</div><div style="font-size:24px;font-weight:700;color:' + (col || "#14243A") + ';margin-top:4px">' + val + '</div><div style="font-size:11px;color:#8A97A6;margin-top:2px">' + sub + '</div></div></td>';
  };
  var th = function (t, a) { return '<th align="' + (a || "left") + '" style="white-space:nowrap;padding:10px 8px;font-size:11px;color:#6B7A8C;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #D5DEE9;font-weight:700">' + t + '</th>'; };
  var tgt = ddNum_(meta.avgTarget), act = ddNum_(meta.avgActual), gapTxt = "&mdash;", gapSub = "set this month's target", gapCol = "#14243A";
  if (tgt && !ddNum_(meta.mtdDays)) { gapSub = "target " + ddInt_(tgt) + "/day &middot; no full day yet"; }
  else if (tgt) { var gap = act - tgt; gapTxt = ddInt_(act) + " / day"; gapSub = (gap >= 0 ? "+" : "&minus;") + ddInt_(Math.abs(gap)) + " (" + (gap >= 0 ? "+" : "&minus;") + Math.abs(gap / tgt * 100).toFixed(1) + "%) vs target " + ddInt_(tgt) + (ddNum_(meta.mtdPlaced) ? " &middot; " + ddInt_(meta.mtdPlaced) + " pcs over " + ddNum_(meta.mtdDays) + " full day(s)" : ""); gapCol = gap >= 0 ? "#067647" : "#B42318"; }
  var dashUrl = DD_DASHBOARD_URL ? DD_DASHBOARD_URL.split("#")[0].split("?")[0] + "?view=decline" : "";
  var fbNote = '<tr><td style="padding:0 30px 6px"><div style="background:#FFF8E6;border:1px solid #F5DFA6;border-radius:8px;padding:12px 14px;font-size:13px;color:#7A5A00;line-height:1.5"><b>Action needed:</b> please open the <b>Decline Matches</b> page in the dashboard, filter by your name, and write your feedback on each of your matches.</div></td></tr>';
  var btn = fbNote + (dashUrl ? '<tr><td align="center" style="padding:18px 30px 26px"><a href="' + ddEsc_(dashUrl) + '" style="display:inline-block;background:#2F5D8A;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px">Open Decline Matches</a></td></tr>' : '');
  var acmNote = meta.acm && meta.acm !== "All" ? ' · ACM: ' + ddEsc_(meta.acm) : '';
  return '<!doctype html><html><head><meta charset="utf-8"><title>Decline Matches</title></head>' +
  '<body style="margin:0;background:#EAEFF5;font-family:Segoe UI,Arial,Helvetica,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#EAEFF5"><tr><td align="center" style="padding:28px 12px">' +
  '<table width="1040" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #D9E1EB">' +
  '<tr><td style="background:#1F3F5F;padding:24px 30px"><table cellpadding="0" cellspacing="0"><tr>' +
  '<td style="vertical-align:middle"><div style="font-size:11px;color:#9FB6CF;letter-spacing:1.4px;text-transform:uppercase">Marketplace &middot; Daily Digest</div><div style="font-size:26px;font-weight:700;color:#fff;margin-top:4px">Decline Matches</div>' +
  '<div style="font-size:13px;color:#C9D8E8;margin-top:4px">Top ' + rows.length + ' matches that pulled Placed down yesterday &middot; ' + ddEsc_(meta.dateLabel) + acmNote + '</div></td></tr></table></td></tr>' +
  (meta.sample ? '<tr><td style="background:#FFF4E0;color:#B54708;font-size:12px;font-weight:700;padding:8px 30px;letter-spacing:.4px">SAMPLE DATA &mdash; design preview only, these numbers are not real.</td></tr>' : '') +
  '<tr><td style="padding:24px 25px 0"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
  kpi("Total Placed drop", "&minus;" + ddInt_(totalDrop), "pieces vs. 4-day avg", "#B42318") +
  kpi("Lost GMV (Placed)", "&minus;" + ddInt_(meta.lostGmv), "Top " + rows.length + ": &minus;" + ddInt_(meta.lostGmvTop), "#B42318") +
  kpi("Lost Placed MTD vs Target", ddNum_(meta.mtdDays) ? ((ddNum_(meta.mtdGain) - ddNum_(meta.mtdLost)) >= 0 ? "+" : "&minus;") + ddInt_(Math.abs(ddNum_(meta.mtdGain) - ddNum_(meta.mtdLost))) : "&mdash;", ddNum_(meta.mtdDays) ? "net vs previous 4-day avg &middot; lost &minus;" + ddInt_(meta.mtdLost) + " &middot; gained +" + ddInt_(meta.mtdGain) + " &middot; " + ddNum_(meta.mtdDays) + " full day(s)" : "no full day yet this month", (ddNum_(meta.mtdGain) - ddNum_(meta.mtdLost)) >= 0 ? "#067647" : "#B42318") +
  kpi("Avg Placed MTD vs Target", gapTxt, gapSub, gapCol) +
  '</tr></table></td></tr>' +
  '<tr><td style="padding:10px 25px 6px"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
  kpi("Top " + rows.length + " Drop Share", share.toFixed(0) + "%", "of the total drop") +
  kpi("Stock issue", oos, "out of / low stock, of the Top " + rows.length, "#B42318") +
  kpi("Key drivers", keyDrivers, "merchants driving 50%+ of their SKU's drop", "#B42318") +
  kpi("Locked Qty", locked, "of the Top " + rows.length, "#B54708") +
  '</tr></table></td></tr>' +
  '<tr><td style="padding:14px 30px 6px"><div style="font-size:13px;color:#4A5B6E;line-height:1.55">The ' + rows.length + ' matches below account for <b>' + share.toFixed(0) + '%</b> of yesterday\'s Placed decline. <b>' + oos + '</b> have a stock issue, out of or low stock (a Supply issue) and <b>' + locked + '</b> have a lock quantity issue (a Marketplace issue), so those can be checked first by the relevant team.</div></td></tr>' +
  '<tr><td style="padding:12px 22px 8px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
  th("#") + th("SKU ID / Name") + th("Merchant ID / Name") + th("ACM") + th("4D avg", "right") + th("Yesterday", "right") + th("Drop", "right") + th("Drop %", "right") + th("Impact on SKU") + th("Contr%") + th("Lost GMV", "right") + th("GMV Contr%", "right") + th("Stock", "right") + th("Locked", "right") + th("Likely cause") +
  '</tr>' + trs +
  '<tr style="background:#EEF3F9"><td></td><td colspan="3" style="padding:11px 8px;font-weight:700;color:#14243A;font-size:13px">Top ' + rows.length + ' total</td><td align="right" style="padding:11px 8px;font-weight:700;font-size:13px">' + tb.toFixed(1) + '</td><td align="right" style="padding:11px 8px;font-weight:700;font-size:13px">' + ddInt_(ty) + '</td><td align="right" style="padding:11px 8px;font-weight:700;color:#B42318;font-size:13px">&minus;' + (tb - ty).toFixed(1) + '</td><td align="right" style="padding:11px 8px;font-weight:700;color:#B42318;font-size:12px">&minus;' + (tb ? ((tb - ty) / tb * 100).toFixed(0) : 0) + '%</td><td></td><td style="padding:11px 8px;font-weight:700;font-size:12px">' + share.toFixed(1) + '%</td><td align="right" style="padding:11px 8px;font-weight:700;color:#B42318;font-size:13px">&minus;' + ddInt_(meta.lostGmvTop) + '</td><td align="right" style="padding:11px 8px;font-weight:700;font-size:12px">' + (ddNum_(meta.lostGmv) ? ddNum_(meta.lostGmvTop) / ddNum_(meta.lostGmv) * 100 : 0).toFixed(1) + '%</td><td colspan="3"></td></tr>' +
  '</table></td></tr>' + btn +
  '<tr><td style="background:#F4F7FB;padding:16px 30px;border-top:1px solid #E1E8F0"><div style="font-size:11px;color:#7A889A;line-height:1.6"><b>How to read:</b> Drop = average Placed over the 4 days before yesterday minus yesterday\'s Placed, in pieces. A match is listed if its drop is at least 3 pieces. Contr% = the match\'s share of the total drop across all declining matches. Impact on SKU = this merchant\'s drop as % of the SKU\'s 4-day average Placed across all merchants, plus its share of the SKU\'s total drop (KEY DRIVER = 50% or more). Likely cause: Out of stock = SKU stock is 0; Low stock = SKU stock is below the match\'s 4-day average; a match can have a stock issue and a lock issue together; Locked Qty = the merchant has an active lock whose remaining quantity is below his 4-day average; otherwise Demand drop. Lost GMV = drop &times; ASP. Lost Placed MTD = net change (gains minus drops) vs. each day\'s previous 4-day average, summed over all matches and the full days of the current month. Avg Placed MTD vs Target compares the average daily Placed since the start of the month (total Placed over full days / number of days) to the monthly target.<br>Marketplace Performance Dashboard</div></td></tr>' +
  '</table></td></tr></table></body></html>';
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
