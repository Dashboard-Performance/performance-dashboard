// v1.17.0 — Decline Matches daily email sent by the dashboard (Worker cron), not from a personal Gmail.
const RealDate = Date; let NOW = RealDate.parse("2026-10-18T08:30:00Z"); // 10:30 Cairo
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const kv = new Map(); const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
let calls = { build: 0, relay: 0, resend: 0 }, resendOk = true, buildAns = null, lastResend = null;
globalThis.fetch = async (u, o) => {
  u = String(u);
  if (u.indexOf("api.resend.com") > -1) { calls.resend++; lastResend = JSON.parse(o.body); return new Response(resendOk ? '{"id":"1"}' : '{"message":"domain not verified"}', { status: resendOk ? 200 : 403 }); }
  if (u.indexOf("apps.example") > -1) { const b = JSON.parse(o.body);
    if (b.action === "decline_digest_build") { calls.build++; return new Response(JSON.stringify(b.serviceKey === "svc-1234567890abcdef" ? buildAns : { success: false, message: "Not allowed" })); }
    if (b.action === "decline_digest_relay") { calls.relay++; return new Response(JSON.stringify({ success: true, sentTo: 3 })); }
  }
  throw new Error("other source offline in this test"); };
const env = { DECLINE_DIGEST: "on", PLANNER_DOH_EXPORT: "off", SUPPLY_CONVERSION_EXPORT: "off", INV_CATEGORY_EXPORT: "off", SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://apps.example/exec", SERVICE_KEY: "svc-1234567890abcdef", RESEND_API_KEY: "re_x", MAIL_FROM: "Taager Dashboard <no-reply@mail.taager.app>" };
buildAns = { success: true, subject: "Marketplace Decline Matches — Sat, 17 Oct 2026", html: "<b>table</b>", recipients: ["youssef.hanafy@taager.com", "a@taager.com", "evil@gmail.com"], rows: 20 };
const tick = async () => { const w = []; await worker.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };

await tick(); ok(calls.build === 0, "before 12:00 Cairo → nothing is sent");
NOW = RealDate.parse("2026-10-18T10:01:00Z"); await tick(); // 12:01 Cairo
ok(calls.build === 1 && calls.resend === 1 && calls.relay === 0, "12:01 Cairo → built by Apps Script, sent by the dashboard (Resend)");
ok(lastResend.from === "Marketplace Dashboard <no-reply@mail.taager.app>", "sender = Marketplace Dashboard <no-reply@mail.taager.app> (not a personal Gmail)");
ok(lastResend.to.length === 2 && lastResend.to.indexOf("evil@gmail.com") < 0, "only @taager.com recipients");
ok(lastResend.subject === buildAns.subject && lastResend.html === "<b>table</b>", "same subject and design as before");
NOW += 60e3; await tick(); NOW += 3600e3; await tick();
ok(calls.build === 1 && calls.resend === 1, "only once a day (next ticks do nothing)");
let st = await (await worker.fetch(new Request("https://w/?action=declineDigestStatus"), env, {})).json();
ok(st.success && st.last && st.last.state === "sent" && st.last.via === "dashboard" && st.last.recipients === 2, "status shows: sent via the dashboard, 2 people");

// next day: Resend fails → the old relay still delivers
NOW = RealDate.parse("2026-10-19T10:00:30Z"); resendOk = false; await tick();
st = JSON.parse(kv.get("digest:decline:2026-10-19"));
ok(calls.relay === 1 && st.state === "sent" && st.via === "relay" && /403/.test(st.note), "Resend fails → falls back to the old relay, reason kept");
resendOk = true;

// a day where Apps Script fails → retried after 15 min, max 3 tries
NOW = RealDate.parse("2026-10-20T10:00:00Z"); const goodAns = buildAns; buildAns = { success: false, message: "Metabase timeout" };
await tick(); st = JSON.parse(kv.get("digest:decline:2026-10-20"));
ok(st.state === "failed" && /Metabase timeout/.test(st.message), "build fails → marked failed with the reason");
NOW += 5 * 60e3; await tick(); ok(calls.build === 3, "…no retry before 15 minutes");
buildAns = goodAns; NOW += 11 * 60e3; await tick(); st = JSON.parse(kv.get("digest:decline:2026-10-20"));
ok(st.state === "sent" && st.tries === 2, "…retried after 15 min and sent (try 2)");

// no declining matches → nothing sent, marked empty
NOW = RealDate.parse("2026-10-21T10:00:00Z"); buildAns = { success: true, empty: true }; const r0 = calls.resend; await tick();
ok(calls.resend === r0 && JSON.parse(kv.get("digest:decline:2026-10-21")).state === "empty", "no declining matches → no email");
buildAns = goodAns;

// after 15:00 Cairo nothing new starts
NOW = RealDate.parse("2026-10-22T13:10:00Z"); const b0 = calls.build; await tick(); ok(calls.build === b0, "after 15:00 Cairo → not sent late");

// owner "send now"
let j = await (await worker.fetch(new Request("https://w/?action=declineDigestSend&email=someone@taager.com"), env, {})).json();
ok(!j.success && calls.build === b0, "send now: non-owner refused");
j = await (await worker.fetch(new Request("https://w/?action=declineDigestSend&email=youssef.hanafy@taager.com"), env, {})).json();
ok(j.success && j.state === "sent" && calls.build === b0 + 1, "send now: owner → sent immediately");

// TEST mode: only Youssef gets it, "[TEST]" subject, the old trigger is not stopped
env.DECLINE_DIGEST = "test"; NOW = RealDate.parse("2026-10-24T10:00:00Z"); let lastBuild = null;
const f0 = globalThis.fetch; globalThis.fetch = async (u, o) => { if (String(u).indexOf("apps.example") > -1) lastBuild = JSON.parse(o.body); return f0(u, o); };
await tick();
ok(lastResend.to.length === 1 && lastResend.to[0] === "youssef.hanafy@taager.com" && /^\[TEST\] /.test(lastResend.subject), "test mode → only youssef.hanafy@taager.com, subject starts with [TEST]");
ok(lastBuild && lastBuild.test === true, "test mode tells Apps Script it is a test (old 12:00 email to the team keeps running)");
resendOk = false; NOW = RealDate.parse("2026-10-25T10:00:00Z"); await tick(); resendOk = true;
ok(lastBuild.action === "decline_digest_relay" && lastBuild.testTo === "youssef.hanafy@taager.com", "test mode + Resend fails → the relay is asked to send to you only");
st = await (await worker.fetch(new Request("https://w/?action=declineDigestStatus"), env, {})).json();
ok(st.mode === "test" && st.testTo === "youssef.hanafy@taager.com", "status shows TEST mode and who gets it");
j = await (await worker.fetch(new Request("https://w/?action=declineDigestSend&test=1&email=somaya.youssef@taager.com"), env, {})).json();
ok(j.state === "sent" && lastResend.to.join() === "somaya.youssef@taager.com", "test button → goes to the owner who pressed it only");
globalThis.fetch = f0;
// switched off
env.DECLINE_DIGEST = "off"; NOW = RealDate.parse("2026-10-23T10:00:00Z"); const b1 = calls.build; await tick();
ok(calls.build === b1, "DECLINE_DIGEST = off → not sent");
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
