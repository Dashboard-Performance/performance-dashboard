/**
 * ============================================================================
 *  MAIL RELAY — tiny Apps Script that only sends the Decline Watch email.
 *  Deploy it from a NORMAL Gmail account (not a taager.com one), so the
 *  message is signed by gmail.com and isn't rejected by taager.com's DMARC.
 *
 *  SETUP (2 minutes)
 *  1. Signed in to that Gmail account: script.google.com > New project, paste
 *     this whole file.
 *  2. Run testRelay once from the editor and accept the permissions (it
 *     sends a small test email to the first allowed recipient).
 *  3. Deploy > New deployment > Web app: Execute as = Me,
 *     Who has access = Anyone. Copy the Web app URL.
 *  4. Paste that URL into DECLINE_MAIL_RELAY_URL in the dashboard's Code.gs,
 *     redeploy Code.gs as a NEW version.
 *
 *  SAFETY: it only accepts requests carrying RELAY_SECRET, and only sends to
 *  addresses in ALLOWED_RECIPIENTS, so it can't be used to mail anyone else.
 *  The first emails may land in Spam — mark "Not spam" once.
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
    MailApp.sendEmail({ to: to.join(","), subject: subject, htmlBody: html, body: plain, name: RELAY_SENDER_NAME, replyTo: "youssef.hanafy@taager.com" });
    return out_({ success: true });
  } catch (err) {
    return out_({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

function doGet() { return out_({ success: true, message: "Mail relay is up." }); }

function testRelay() {
  MailApp.sendEmail({ to: ALLOWED_RECIPIENTS[0], subject: "Mail relay test", htmlBody: "<p>Mail relay works &#10003;</p>", name: RELAY_SENDER_NAME });
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
