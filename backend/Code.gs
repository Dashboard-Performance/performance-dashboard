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
  return jsonResponse({ success: false, message: "Unknown action." });
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
