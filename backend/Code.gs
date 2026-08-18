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

// ----------------------------------------------------------------------------
// PRESENCE ("who's online") — only this email is allowed to read the list of
// currently active users. Anyone else's request for the list is refused
// server-side, even if they somehow call the endpoint directly.
// ----------------------------------------------------------------------------
var PRESENCE_ADMIN_EMAIL = "youssef.hanafy@taager.com";
// A user counts as "online" if their last heartbeat was within this window.
// The client sends a heartbeat every 30s, so 90s comfortably survives one
// missed beat (e.g. a brief network hiccup) without flickering offline.
var PRESENCE_ONLINE_WINDOW_MS = 90 * 1000;
// Entries older than this are dropped from storage entirely on every write,
// so the stored map never grows unbounded over time.
var PRESENCE_STALE_MS = 15 * 60 * 1000;
var PRESENCE_PROP_KEY = "presence_map_v1";

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
  if (action === "heartbeat") return handleHeartbeat(payload);
  if (action === "get_online_users") return handleGetOnlineUsers(payload);
  if (action === "save_match_feedback") return handleSaveMatchFeedback(payload);
  if (action === "add_new_locked_matches") return handleAddNewLockedMatches(payload);
  return jsonResponse({ success: false, message: "Unknown action." });
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

/**
 * ============================================================================
 *  PRESENCE — lightweight "who's online" tracking
 * ============================================================================
 *  The client (js/auth.js) pings action=heartbeat every 30s while the
 *  dashboard tab is open, identifying itself by email/name. Those pings are
 *  kept in a single small JSON blob in PropertiesService (no sheet writes,
 *  no quota pressure). Only PRESENCE_ADMIN_EMAIL can read the list back via
 *  action=get_online_users — everyone else gets a generic refusal, so the
 *  feature stays invisible/unusable to any other account even if they
 *  inspect the network calls.
 * ============================================================================
 */
function handleHeartbeat(payload) {
  var email = String(payload.email || "").trim().toLowerCase();
  var name = String(payload.name || "").trim();

  if (!email || !isAllowedEmail(email)) {
    return jsonResponse({ success: false, message: "Not authorized." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var map = getPresenceMap();
    map[email] = { name: name || email, lastSeen: Date.now() };
    savePresenceMap(pruneStalePresence(map));
    return jsonResponse({ success: true });
  } finally {
    lock.releaseLock();
  }
}

function handleGetOnlineUsers(payload) {
  var requesterEmail = String(payload.requesterEmail || "").trim().toLowerCase();

  if (requesterEmail !== PRESENCE_ADMIN_EMAIL.toLowerCase()) {
    // Deliberately vague — do not confirm/deny that this feature exists.
    return jsonResponse({ success: false, message: "Not authorized." });
  }

  var map = pruneStalePresence(getPresenceMap());
  var cutoff = Date.now() - PRESENCE_ONLINE_WINDOW_MS;
  var online = [];

  Object.keys(map).forEach(function (email) {
    var entry = map[email];
    if (entry.lastSeen >= cutoff) {
      online.push({ email: email, name: entry.name, lastSeen: entry.lastSeen });
    }
  });

  online.sort(function (a, b) { return b.lastSeen - a.lastSeen; });

  return jsonResponse({ success: true, now: Date.now(), users: online });
}

function getPresenceMap() {
  var raw = PropertiesService.getScriptProperties().getProperty(PRESENCE_PROP_KEY);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function savePresenceMap(map) {
  PropertiesService.getScriptProperties().setProperty(PRESENCE_PROP_KEY, JSON.stringify(map));
}

function pruneStalePresence(map) {
  var cutoff = Date.now() - PRESENCE_STALE_MS;
  var cleaned = {};
  Object.keys(map).forEach(function (email) {
    if (map[email] && map[email].lastSeen >= cutoff) cleaned[email] = map[email];
  });
  return cleaned;
}

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
 *  DATA API — replaces the old client-side "14 parallel JSONP calls to
 *  docs.google.com/.../gviz/tq" approach used by js/app.js.
 *
 *  WHY THIS EXISTS
 *  The dashboard used to fire ~14 simultaneous script-tag requests at
 *  Google's public gviz endpoint (one per sheet/GID) on every load and every
 *  manual refresh. Google throttles that many concurrent requests against
 *  the same spreadsheet, so several of them would time out (visible as
 *  repeating "Timeout on GID: ..." + "__sheetCb... is not defined" errors in
 *  the console). When the MAIN sheet was one of the ones that timed out, the
 *  whole refresh failed and the app silently fell back to the old cached
 *  data — which is why numbers like Total Confirmed on Overview looked
 *  "stuck" and out of sync with the sheet itself.
 *
 *  This endpoint reads every requested sheet directly with SpreadsheetApp
 *  (no gviz, no rate limiting, one round trip for everything) and returns
 *  them all in a single JSON response, shaped exactly like the old gviz
 *  `{ table: { rows: [{ c: [{v}, ...] }] } }` payloads so the existing
 *  parse*Sheet() functions in app.js don't need to change at all.
 *
 *  Call: GET <deployment URL>?action=getData&gids=123,456,789
 * ============================================================================
 */
function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : null;
  if (action === "getData") return handleGetData(e);
  return jsonResponse({ success: false, message: "Unknown action." });
}

function handleGetData(e) {
  try {
    var gidsParam = String((e.parameter && e.parameter.gids) || "").trim();
    if (!gidsParam) return jsonResponse({ success: false, message: "No gids provided." });

    var requestedGids = gidsParam.split(",").map(function (g) { return g.trim(); }).filter(Boolean);

    var result = {};
    requestedGids.forEach(function (gid) {
      result[gid] = fetchGvizTable(gid);
    });

    return jsonResponse({ success: true, fetchedAt: new Date().toISOString(), sheets: result });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || String(err) });
  }
}

// Fetches ONE sheet's data from Google's own gviz endpoint — same endpoint
// the old client-side JSONP calls used — but from the Apps Script server,
// one GID at a time (sequential, inside this single forEach loop above),
// so it never competes with 13 other simultaneous requests the way the
// browser did. This is both faster AND avoids the rate limiting that
// caused the original "Timeout on GID: ..." errors.
//
// (SpreadsheetApp.getDataRange().getValues() was tried first, but forces a
// full formula recalculation of the sheet on every call, which is why it
// was slow/hanging on the large MAIN sheet — gviz reads Google's already
// -computed cache instead, which is why it's fast even for big sheets.)
function fetchGvizTable(gid) {
  var url = "https://docs.google.com/spreadsheets/d/" + SPREADSHEET_ID +
    "/gviz/tq?gid=" + encodeURIComponent(gid) + "&tqx=out:json";
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return null;

  var text = res.getContentText();
  var match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) return null;

  try {
    // gviz embeds raw `Date(y,m,d[,h,m,s])` literals for date cells, which
    // isn't valid JSON (that's exactly why the old client code had to run
    // this as executed <script> JS instead of JSON.parse). eval() does the
    // same thing here, server-side, on Google's own gviz response for this
    // spreadsheet only — app.js only ever reads the `.f` (formatted text)
    // field for dates, so the exact value `Date(...)` evaluates to doesn't
    // matter, it just needs to not throw.
    var parsed = eval("(" + match[1] + ")");
    if (parsed && parsed.status === "error") return null;
    return parsed; // { table: { cols, rows } } — same shape as before
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

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
