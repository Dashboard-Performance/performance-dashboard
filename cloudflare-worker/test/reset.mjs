// v1.17.0 — "Forgot your password?" for the staff dashboard.   node test/reset.mjs
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const kv = new Map();
const KV = { async get(k) { const v = kv.get(k); return v == null ? null : v; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
kv.set("access:config", JSON.stringify({ roles: { Commercial: { views: ["navOverview"] } }, users: {} }));
const USERS = { "a@taager.com": { name: "Aya", pw: "oldpass1" } }, mails = [], gs = [];
globalThis.fetch = async (u, o) => {
  u = String(u);
  if (u.startsWith("https://apps.example")) {
    const b = JSON.parse(o.body); gs.push(b);
    if (b.action === "login") { const x = USERS[b.email]; return new Response(JSON.stringify(x && x.pw === b.password ? { success: true, name: x.name, email: b.email, role: "Commercial" } : { success: false, message: "Incorrect password." })); }
    if (b.serviceKey !== "service-key-123456") return new Response(JSON.stringify({ success: false, message: "Not allowed" }));
    if (b.action === "staff_user_check") return new Response(JSON.stringify({ success: true, exists: !!USERS[b.email], name: USERS[b.email] ? USERS[b.email].name : "" }));
    if (b.action === "staff_set_password") { USERS[b.email].pw = b.password; return new Response(JSON.stringify({ success: true })); }
    if (b.action === "staff_send_reset_mail") { mails.push({ via: "apps", to: b.email, html: b.html }); return new Response(JSON.stringify({ success: true })); }
  }
  if (u === "https://api.resend.com/emails") { const b = JSON.parse(o.body); mails.push({ via: "resend", to: b.to[0], html: b.html }); return new Response("{}"); }
  if (u.startsWith("https://metabase.taager.com/")) return new Response("C0\n1\n");
  throw new Error("unexpected " + u);
};
const env = { SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://apps.example/exec", STAFF_SESSION_SECRET: "x".repeat(40), SERVICE_KEY: "service-key-123456", DASHBOARD_URL: "https://center-control.taager.app/", RESEND_API_KEY: "re_x", MAIL_FROM: "Taager <no-reply@mail.taager.app>" };
const call = async (q, body, tok, ip) => { const h = { "CF-Connecting-IP": ip || "1.1.1.1" }; if (tok) h["X-Staff-Token"] = tok; const r = await worker.fetch(new Request("https://w.example/?" + q, { method: body ? "POST" : "GET", headers: h, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; } return { s: r.status, j }; };

let r = await call("action=staffLogin", { email: "a@taager.com", password: "oldpass1" }); const oldTok = r.j.token;
ok(!!oldTok, "signed in with the old password");
r = await call("action=staffForgot", { email: "nobody@taager.com" });
ok(!r.j.success && r.j.code === "no_account" && r.j.steps[0].status === "fail" && r.j.steps[1].status === "skip" && mails.length === 0, "unknown email: 'Account found ✕', no email sent, clear message");
ok(JSON.parse(kv.get("pwreset:last")).step === "no-account", "the reason is also traced for the admin (pwreset:last)");
r = await call("action=staffForgot", { email: "A@taager.com" });
ok(r.j.success && r.j.code === "sent" && r.j.steps.every((x) => x.status === "ok") && r.j.triesLeft === 2 && mails.length === 1 && mails[0].to === "a@taager.com" && mails[0].via === "resend", "known email: both steps ✓, 2 of 3 tries left, email sent (Resend)");
ok(!/[\u0600-\u06FF]/.test(mails[0].html), "email is English only");
const tok = /#reset=([0-9a-f]{64})/.exec(mails[0].html)[1];
ok(JSON.parse(kv.get("pwreset:last")).step === "sent", "…and 'sent' when the email went out");
ok(/center-control\.taager\.app\/#reset=/.test(mails[0].html), "link opens the dashboard sign-in page");
ok(![...kv.keys()].some((k) => k.indexOf(tok) >= 0), "only a hash of the token is stored");
r = await call("action=staffReset", { token: tok, password: "short1" }); ok(r.s === 400 && /8/.test(r.j.message), "short password refused");
r = await call("action=staffReset", { token: tok, password: "onlyletters" }); ok(r.s === 400, "password needs letters + numbers");
r = await call("action=staffReset", { token: "f".repeat(64), password: "newpass123" }); ok(r.s === 400 && /expired|used/.test(r.j.message), "wrong token refused");
kv.set("staffauth:a@taager.com", "{}"); // the Worker's sign-in copy must go when the password changes
r = await call("action=staffReset", { token: tok, password: "newpass123" });
ok(r.j.success && r.j.email === "a@taager.com" && USERS["a@taager.com"].pw === "newpass123", "new password saved (Apps Script)");
ok(!kv.has("staffauth:a@taager.com"), "…and the Worker's sign-in copy of the old password is dropped");
r = await call("action=staffReset", { token: tok, password: "another123" }); ok(r.s === 400, "the link works only once");
r = await call("action=metabase&gid=2099497960", null, oldTok); ok(r.s === 401, "sessions from before the reset are signed out");
r = await call("action=staffLogin", { email: "a@taager.com", password: "oldpass1" }); ok(!r.j.token, "old password no longer works");
r = await call("action=staffLogin", { email: "a@taager.com", password: "newpass123" }); ok(!!r.j.token, "new password works");
r = await call("action=metabase&gid=2099497960", null, r.j.token); ok(r.s === 200, "…and the new session reads data");
r = await call("action=staffForgot", { email: "someone@gmail.com" }, null, "5.5.5.5");
ok(r.j.code === "not_staff" && r.j.steps[0].status === "fail", "non-staff email → clear status");
env.SERVICE_KEY = "wrong-key-123456789"; r = await call("action=staffForgot", { email: "a@taager.com" }, null, "6.6.6.6"); env.SERVICE_KEY = "service-key-123456";
ok(r.j.code === "service_error" && /WORKER_SERVICE_KEY|Not allowed/.test(r.j.message), "key mismatch with Apps Script → shown as 'account service' error");
// fallback to Apps Script mail when Resend is not set; limits
delete env.RESEND_API_KEY; mails.length = 0;
r = await call("action=staffForgot", { email: "a@taager.com" }, null, "2.2.2.2");
ok(mails.length === 1 && mails[0].via === "apps", "no Resend key → the email goes out through Apps Script");
r = await call("action=staffForgot", { email: "a@taager.com" }, null, "3.3.3.3");
ok(r.j.triesLeft === 0, "third email of the hour → 0 tries left");
r = await call("action=staffForgot", { email: "a@taager.com" }, null, "4.4.4.4");
ok(r.s === 429 && r.j.code === "rate_limited" && r.j.retryAfterSec > 0 && mails.length === 2, "fourth → 'try again in N minutes' with a countdown, nothing sent");
for (let i = 0; i < 12; i++) r = await call("action=staffForgot", { email: "x" + i + "@taager.com" }, null, "9.9.9.9");
ok(r.s === 429, "too many requests from one IP → 429");
ok(gs.filter((b) => b.action !== "login").every((b) => typeof b.serviceKey === "string" && b.serviceKey.length >= 16), "every Apps Script user call carries the service key");
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
