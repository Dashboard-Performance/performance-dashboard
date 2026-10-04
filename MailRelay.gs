/**
 * ============================================================================
 *  MAIL RELAY — tiny Apps Script that only sends the Decline Watch email.
 *  Deploy it from your taager.com account. It sends through the Gmail API as
 *  that account (From = your taager.com address).
 *
 *  SETUP
 *  1. Paste this whole file (replace everything), then Save.
 *  2. Services (+ in the left bar) > "Gmail API" > Add (keep the name "Gmail").
 *  3. Run testRelay once from the editor and accept the permissions (it sends
 *     a small test email to the first allowed recipient = you).
 *  4. Deploy > Manage deployments > Edit (pencil) > Version: New version >
 *     Deploy.  (The URL stays the same. WITHOUT a new version the old code
 *     keeps running.)
 *
 *  SAFETY: it only accepts requests carrying RELAY_SECRET, and only sends to
 *  addresses in ALLOWED_RECIPIENTS, so it can't be used to mail anyone else.
 * ============================================================================
 */
var RELAY_SECRET = "METUY8tMu1u7vH1pG7tto-3fBTQVZj-Y"; // same value as DECLINE_MAIL_RELAY_SECRET in Code.gs
var ALLOWED_RECIPIENTS = [
  "youssef.hanafy@taager.com",
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
]; // only these addresses can ever receive mail through the relay
var RELAY_SENDER_NAME = "Marketplace Dashboard"; // the name recipients see in their Inbox

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.secret !== RELAY_SECRET) return out_({ success: false, message: "Unauthorized." });
    var to = String(p.to || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    if (!to.length) return out_({ success: false, message: "No recipient." });
    var allowed = ALLOWED_RECIPIENTS.map(function (s) { return s.toLowerCase(); });
    for (var i = 0; i < to.length; i++) if (allowed.indexOf(to[i]) === -1) return out_({ success: false, message: "Recipient not allowed: " + to[i] });
    if (!p.html || String(p.html).length > 400000) return out_({ success: false, message: "Bad body." });
    // One single email to everyone, with a real plain-text part and a reply-to.
    var html = String(p.html);
    var plain = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/tr>|<\/li>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&middot;/g, "-").replace(/&minus;/g, "-").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim().slice(0, 6000);
    var subject = String(p.subject || "Decline Watch").slice(0, 200);
    sendViaGmailApi_(to, subject, plain, html);
    return out_({ success: true });
  } catch (err) {
    return out_({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

function doGet() { return out_({ success: true, message: "Mail relay is up." }); }

function testRelay() {
  sendViaGmailApi_([ALLOWED_RECIPIENTS[0]], "Mail relay test", "Mail relay works", "<p>Mail relay works &#10003;</p>");
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }


// Sends through the Gmail API as the account that owns this script (From = that
// account's taager.com address). REQUIRES the Gmail API advanced service:
//   Apps Script editor -> Services (+) -> "Gmail API" -> Add.
function sendViaGmailApi_(toList, subject, plain, html) {
  var me = Session.getEffectiveUser().getEmail();
  var b64 = function (t) { return Utilities.base64Encode(Utilities.newBlob(t).getBytes()); };
  var chunk = function (t) { return t.replace(/(.{76})/g, "$1\r\n"); };
  var boundary = "mr_" + Utilities.getUuid().replace(/-/g, "");
  var mime = [
    "From: " + RELAY_SENDER_NAME + " <" + me + ">",
    "To: " + toList.join(", "),
    "Reply-To: " + me,
    "Subject: =?UTF-8?B?" + b64(subject) + "?=",
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"",
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    chunk(b64(plain)),
    "--" + boundary,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    chunk(b64(html)),
    "--" + boundary + "--",
    ""
  ].join("\r\n");
  Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(mime) }, "me");
}
