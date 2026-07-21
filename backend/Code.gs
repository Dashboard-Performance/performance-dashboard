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
  return jsonResponse({ success: false, message: "Unknown action." });
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
