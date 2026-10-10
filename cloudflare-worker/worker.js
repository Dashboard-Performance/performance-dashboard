/* ==========================================================================
   Performance Dashboard — Sync Cache Worker (Cloudflare Workers)
   --------------------------------------------------------------------------
   الغرض: يقف كطبقة كاش وسيطة سريعة ومجانية بين كل اليوزرز وبين Apps Script،
   بس لطلبات القراءة الكتيرة (action=getLastSync و action=getLastSyncMeta).

   ليه محتاجينه: كل يوزر فاتح/بيعمل رفرش للداشبورد كان بيضرب Apps Script
   مباشرة، وApps Script عنده حد أقصى لعدد التنفيذات المتزامنة — لما عدد
   الناس اللي بيفتحوا/يعملوا رفرش في نفس اللحظة يزيد، بعض الطلبات كانت
   بتفشل (404 من مسار script.googleusercontent.com/macros/echo بتاع جوجل).

   إزاي بيحل المشكلة: الـ Worker ده بيسحب نسخة واحدة بس من Apps Script كل
   5 دقايق (عن طريق Cron Trigger)، ويخزّنها في Cloudflare KV. أي طلب من أي
   يوزر بيتخدم فورًا من الـ KV cache ده — من غير ما يضرب Apps Script خالص.
   يعني 1000 يوزر فاتحين في نفس اللحظة = 1000 قراءة KV خفيفة جدًا (مجانية
   لحد 100,000 قراءة/يوم على Cloudflare)، بدل 1000 تنفيذ متزامن على
   Apps Script.

   لو الـ Cron فشل مرة (Apps Script كان واقف وقتها)، الـ Worker بيرجع آخر
   نسخة كانت متخزنة قبل كده بدل ما يرجع فشل لليوزر — تدهور تدريجي، مش انهيار
   فجائي.

   إعداد النشر (Deploy) — مرة واحدة بس:
   1) لو معندكش حساب Cloudflare، اعمل واحد مجاني على https://dash.cloudflare.com
   2) ثبّت الأداة المحلية (Wrangler) — تحتاج Node.js مثبت عندك:
        npm install -g wrangler
   3) من جوه الفولدر ده (cloudflare-worker/) في الترمينال:
        wrangler login
        wrangler kv namespace create "SYNC_CACHE"
      الأمر ده هيطلعلك id — انسخه وحطه مكان "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
      في ملف wrangler.toml المجاور لهذا الملف.
   4) انشر الـ Worker:
        wrangler deploy
      هيديك رابط زي: https://performance-dashboard-sync-cache.<your-subdomain>.workers.dev
   5) انسخ الرابط ده وحطه في js/app.js مكان قيمة SYNC_CDN_URL (فاضية حاليًا)،
      وارفع app.js المحدث على Vercel.
   ========================================================================== */

// تاب "Confirmed by Day" (Weekly Inventory & Inbound) — بيتقرا هنا مباشرة
// من Google Sheets (gviz) بدل ما يعدي على Apps Script خالص، عشان يبقى
// مستقل تمامًا عن أي مشكلة Deploy في الباك اند (اللي واجهناها فعليًا).
// نفس الـ Cron كل 5 دقايق (تحت في scheduled()) بيحدّثه، وأي طلب من أي
// يوزر بيتخدم من الـ KV Cache ده فورًا.
const CACHE_KEY_CONFIRMED_BY_DAY = "confirmed_by_day_v1";
const CONFIRMED_BY_DAY_GID = "964398740";
// بطلب صريح ("ليه مش بيوريني إنه فشل؟"): زي CACHE_KEY_MAIN_ERROR تحت بالظبط —
// لو الـ cron تاع الشيت ده فشل، كان بيتسجل بس في console.error (مش ظاهر في
// "Worker Sync Status" خالص، فكان بيبان زي إن مفيش أي مشكلة، بس التوقيت
// بيقدّم من غير سبب واضح). دلوقتي بيتسجل هنا وبيتبعت مع الرد عشان يظهر.
const CACHE_KEY_CONFIRMED_BY_DAY_ERROR = "confirmed_by_day_error_v1";
// v1.1.51: بصمة رخيصة لآخر نسخة اتكتبت فعليًا في CACHE_KEY_CONFIRMED_BY_DAY —
// راجع الكومنت الكبير فوق refreshConfirmedByDayCache تحت لشرح ليه محتاجينها.
const CACHE_KEY_CONFIRMED_BY_DAY_META = "confirmed_by_day_meta_v1";
// تاب "Incentive Merchants" (Incentives Tracker) — نفس فكرة Confirmed by Day
// فوق بالظبط: بيتقرا هنا مباشرة من Google Sheets (gviz)، مستقل تمامًا عن
// Apps Script، عشان نتجنب نفس مشكلة الـ Deploy اللي واجهناها مع GID
// 964398740 قبل كده.
const CACHE_KEY_INCENTIVE_MERCHANTS = "incentive_merchants_v1";
const INCENTIVE_MERCHANTS_GID = "1548963809";
// نفس فكرة CACHE_KEY_CONFIRMED_BY_DAY_ERROR فوق.
const CACHE_KEY_INCENTIVE_MERCHANTS_ERROR = "incentive_merchants_error_v1";
// نفس فكرة CACHE_KEY_CONFIRMED_BY_DAY_META فوق.
const CACHE_KEY_INCENTIVE_MERCHANTS_META = "incentive_merchants_meta_v1";
// شيت الـ Main (المصدر الأساسي لكل الداشبورد تقريبًا) — بيتقرا هنا مباشرة
// من Google Sheets (gviz) بدل ما يعتمد بس على نسخة Apps Script المجمّعة
// (getLastSync). السبب (بطلب صريح): لو اليوزر بيعمل تعديل/لصق داتا في
// الشيت وقت ما الـ Cron بتاع Apps Script بيشتغل، ممكن ياخد لقطة نص-متغيرة.
// هنا بنعمل "stability check" مستقل: كل Cron tick (كل 5 دقايق) بنسحب نسخة
// جديدة ونقارن بصمتها ببصمة آخر تشغيلة (مش نفس التشغيلة — بين تشغيلتين
// متتاليتين، يعني فاصل 5 دقايق حقيقي)، ومنعتبرش الشيت "مستقر" ونستخدمه إلا
// لو البصمتين متطابقتين. لو لسه بيتغيّر، بنفضل نخدّم آخر نسخة مستقرة معروفة
// بدل ما ننشر نسخة نص-متغيرة. البصمة نفسها (عدد الصفوف + أطوال أول/آخر صف)
// زي fetchSheetsPayloadStable_/sheetFingerprint_ في backend/Code.gs بالظبط.
const CACHE_KEY_MAIN = "main_sheet_v1";              // آخر نسخة "مستقرة" مؤكدة — دي اللي بتتخدم لليوزرز
const CACHE_KEY_MAIN_CANDIDATE = "main_sheet_candidate_v1"; // آخر قراءة خام (لمقارنة التشغيلة الجاية بيها)
// v1.1.34 (تصحيح): {stable, fetchedAt, rowCount} خفيفة جدًا، منفصلة تمامًا
// عن CACHE_KEY_MAIN الضخم — بتتحدث كل ما CACHE_KEY_MAIN يتحدث. الهدف إن
// handleGetMainMeta/getMainMeta ميحتاجش يعمل JSON.parse لجدول ممكن يكون
// عشرات الـ MB (33 ألف صف) بس عشان يجيب عدد الصفوف — ده كان بالظبط سبب
// "Failed to fetch": الـ CPU limit بتاع الـ Worker كان بيتعدى والتنفيذ
// بيتقفل فجأة من غير ما يرجع رد خالص (مش حتى إيرور JSON عادي).
const CACHE_KEY_MAIN_META = "main_sheet_meta_v1";
// v1.1.35: نفس الإيميل بالظبط المستخدم كـ PRESENCE_ADMIN_EMAIL في js/auth.js
// وbackend/Code.gs — بوابة بسيطة (مش أمان حقيقي، بس كافية هنا لأن أقصى ضرر
// ممكن يحصل هو حد يعمل refresh قبل معاده بشوية) لأكشن forceRefresh تحت.
const MANAGER_EMAIL = "youssef.hanafy@taager.com";
const OWNER_EMAILS = ["youssef.hanafy@taager.com", "somaya.youssef@taager.com"];
function isOwnerEmail(e) { return OWNER_EMAILS.indexOf(String(e || "").trim().toLowerCase()) !== -1; }
// v1.1.33: لو refreshMainCache فشلت جوه scheduled() (مثلاً الشيت كبير جدًا
// وتعدى حد الـ KV، أو gviz رجع رد غريب)، الفشل كان بيتسجل بس في console.error
// (مش شايفينه إلا لو شغّلت wrangler tail لحظتها). دلوقتي بنسجله هنا كمان عشان
// يظهر في "Worker Sync Status" جوه الداشبورد من غير ما تحتاج CLI خالص.
const CACHE_KEY_MAIN_ERROR = "main_sheet_error_v1";
const MAIN_GID = "2099497960";

// v1.1.46: كل الـ 21 شيت الباقيين (Inventory وكل حاجة تانية غير Main/
// Confirmed by Day/Incentive Merchants) بقوا بيتقروا من Apps Script بس
// (backend/Code.gs: LAST_SYNC_GIDS + runScheduledSync)، مش من الـ Worker
// خالص. السبب: Cloudflare Observability أثبتت إن الـ CPU budget الحقيقي
// لخطة الـ Worker (Free) حوالي 10ms بس لكل تشغيلة — أي شغل حقيقي (fetch +
// JSON.parse + fingerprint) لأي شيت كان بيعدّيه ويخلي scheduled() يفشل
// (exceededCpu) في كل تشغيلة تقريبًا، حتى مع batch صغير (3 شيت بس). ده كان
// السبب الحقيقي وراء إن "General Sync — Worker" كان دايمًا "عالق"/قديم في
// مودال "Worker Sync Status".
// Apps Script (Time-driven trigger، مش Cloudflare Worker) معندهوش نفس حد
// الـ CPU-ms ده (بيتحدد بالوقت الكلي للتنفيذة، دقايق مش milliseconds)،
// فبقى هو المصدر الوحيد لكل الـ 21 شيت — بيقراهم كلهم مع بعض في تنفيذة
// واحدة كل 5 دقايق (fetchSheetsPayloadStable_)، يعني كل الشيتات دي بتتحدث
// مع بعض فعلاً في نفس الوقت، مش متقسمة/متأخرة عن بعض زي لما كانت متقسمة
// بين مصدرين. راجع تعليق LAST_SYNC_GIDS جوه backend/Code.gs.
// الـ Worker فضل مسؤول بس عن Main (شيت واحد كبير، قراءة خفيفة نسبيًا لكل
// طلب) وConfirmed by Day وIncentive Merchants — دول مش جزء من "General
// Sync" ومعندهمش نفس المشكلة.

// v1.1.40: نفس فكرة PRESENCE_ADMIN_EMAIL/heartbeat بتاعة js/auth.js وbackend/
// Code.gs، بس اتنقلت هنا بالكامل — بيانات "مين أونلاين" مؤقتة بطبيعتها
// (مش سجل دائم محتاج يتخزن في شيت)، فمفيش داعي تعدي على Apps Script أصلاً
// عشانها. بنخزنها في نفس الـ KV.
const CACHE_KEY_PRESENCE = "presence_map_v1";
const PRESENCE_ONLINE_WINDOW_MS = 90 * 1000;
const PRESENCE_STALE_MS = 15 * 60 * 1000;
const ALLOWED_EMAIL_DOMAIN = "taager.com";

// Metabase public-link CORS proxy: pure streaming passthrough (no body parsing -> negligible CPU).
// Only metabase.taager.com public question/card endpoints are allowed.
async function handleMetabaseProxy(url) {
  const target = url.searchParams.get("url") || "";
  let t;
  try { t = new URL(target); } catch (e) { return jsonResponse({ success: false, message: "bad url" }, 400); }
  const okPath = /^\/(public\/question\/|api\/public\/card\/)[0-9a-f-]{36}(\.json|\/query\/(json|csv))?$/i.test(t.pathname);
  if (t.protocol !== "https:" || t.hostname !== "metabase.taager.com" || !okPath) {
    return jsonResponse({ success: false, message: "url not allowed" }, 403);
  }
  const r = await fetch(t.toString(), { redirect: "follow" });
  const h = corsHeaders();
  h["Content-Type"] = r.headers.get("Content-Type") || "application/octet-stream";
  h["Cache-Control"] = "no-store";
  return new Response(r.body, { status: r.status, headers: h });
}

// ---------------------------------------------------------------------------
// v1.4.0 — Roles/Access + Targets uploaded from the dashboard (stored in KV).
// Reads are public (same as the dashboard data); writes need X-Admin-Key ==
// env.ADMIN_KEY (wrangler secret put ADMIN_KEY). Values are passed through as
// raw text (no JSON parse) to stay within the free-plan CPU budget.
// ---------------------------------------------------------------------------
const TOWER_TARGET_TYPES = ["merchants", "acm", "category", "salesplan", "singlesku", "meta"];
const TOWER_MAX_BYTES = 20 * 1024 * 1024;
function towerAdminOk(request, env) {
  const key = request.headers.get("X-Admin-Key") || "";
  return !!env.ADMIN_KEY && key.length > 0 && key === env.ADMIN_KEY;
}
async function towerReadKv(env, key, emptyJson) {
  const txt = await env.SYNC_CACHE.get(key);
  return new Response(txt || emptyJson, { status: 200, headers: corsHeaders() });
}
async function towerWriteKv(request, env, key) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  if (!env.ADMIN_KEY) return jsonResponse({ success: false, message: "ADMIN_KEY secret is not set on the Worker." }, 500);
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  const text = await request.text();
  if (!text || text.length > TOWER_MAX_BYTES) return jsonResponse({ success: false, message: "Empty or too large body." }, 400);
  const c0 = text.trimStart().charAt(0);
  if (c0 !== "{" && c0 !== "[") return jsonResponse({ success: false, message: "Body must be JSON." }, 400);
  await env.SYNC_CACHE.put(key, text);
  return jsonResponse({ success: true, bytes: text.length });
}
function handleGetAccess(env) { return towerReadKv(env, "access:config", "null"); }
function handlePutAccess(request, env) { return towerWriteKv(request, env, "access:config"); }
function handleGetTargets(url, env) {
  const type = url.searchParams.get("type") || "";
  if (TOWER_TARGET_TYPES.indexOf(type) < 0) return jsonResponse({ success: false, message: "Unknown targets type." }, 400);
  return towerReadKv(env, "targets:" + type, "null");
}
function handlePutTargets(request, url, env) {
  const type = url.searchParams.get("type") || "";
  if (TOWER_TARGET_TYPES.indexOf(type) < 0) return jsonResponse({ success: false, message: "Unknown targets type." }, 400);
  return towerWriteKv(request, env, "targets:" + type);
}
function handleCheckAdminKey(request, env) {
  if (!env.ADMIN_KEY) return jsonResponse({ success: false, message: "ADMIN_KEY secret is not set on the Worker." }, 500);
  return towerAdminOk(request, env) ? jsonResponse({ success: true }) : jsonResponse({ success: false, message: "Wrong admin key." }, 403);
}

// ---------------------------------------------------------------------------
// v1.6.0 — Alerts Centre: admin sends in-app notifications to roles / people.
// KV key "alerts:log" = JSON array (newest first, max 300). Reads are filtered
// by the caller's email/role; writes need X-Admin-Key.
// ---------------------------------------------------------------------------
const TOWER_ALERTS_KEY = "alerts:log";
const TOWER_ALERTS_MAX = 300;
async function towerLoadAlerts(env) {
  const txt = await env.SYNC_CACHE.get(TOWER_ALERTS_KEY);
  if (!txt) return [];
  try { const a = JSON.parse(txt); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
async function handleGetAlerts(request, url, env) {
  const all = await towerLoadAlerts(env);
  if (url.searchParams.get("all") === "1") {
    if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
    return jsonResponse({ success: true, alerts: all });
  }
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const role = (url.searchParams.get("role") || "").trim();
  const mine = all.filter((a) => {
    const au = a.audience || {};
    if (au.all) return true;
    if (email && Array.isArray(au.users) && au.users.indexOf(email) >= 0) return true;
    if (role && Array.isArray(au.roles) && au.roles.indexOf(role) >= 0) return true;
    return false;
  }).slice(0, 50).map((a) => ({ id: a.id, at: a.at, title: a.title, body: a.body, severity: a.severity, about: a.about || null, link: a.link || "", by: a.by || "" }));
  return jsonResponse({ success: true, alerts: mine });
}
async function handleSendAlert(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  if (!env.ADMIN_KEY) return jsonResponse({ success: false, message: "ADMIN_KEY secret is not set on the Worker." }, 500);
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
  const title = String(b.title || "").trim().slice(0, 160), body = String(b.body || "").trim().slice(0, 2000);
  if (!title || !body) return jsonResponse({ success: false, message: "Title and message are required." }, 400);
  const au = b.audience || {};
  const audience = { all: !!au.all, roles: (Array.isArray(au.roles) ? au.roles : []).map(String).slice(0, 40), users: (Array.isArray(au.users) ? au.users : []).map((x) => String(x).toLowerCase()).slice(0, 500) };
  if (!audience.all && !audience.roles.length && !audience.users.length) return jsonResponse({ success: false, message: "Pick at least one recipient." }, 400);
  const sev = ["info", "warning", "critical"].indexOf(b.severity) >= 0 ? b.severity : "info";
  const about = b.about && b.about.label ? { type: String(b.about.type || "General").slice(0, 30), label: String(b.about.label).slice(0, 160) } : null;
  const alert = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(), title, body, severity: sev, audience, about, link: String(b.link || "").slice(0, 60), by: String(b.by || "").slice(0, 120) };
  const all = await towerLoadAlerts(env);
  all.unshift(alert);
  await env.SYNC_CACHE.put(TOWER_ALERTS_KEY, JSON.stringify(all.slice(0, TOWER_ALERTS_MAX)));
  return jsonResponse({ success: true, id: alert.id });
}
// ---------------------------------------------------------------------------
// v1.14.0 — Invite emails: when an admin adds a user in Control > Users & Roles,
// the dashboard asks the Worker to email them. Sent through Resend from a
// dedicated no-reply address (secret RESEND_API_KEY + var MAIL_FROM), so the
// mail never comes from a personal mailbox. Needs X-Admin-Key.
// ---------------------------------------------------------------------------
function inviteEsc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
async function handleSendInvites(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  if (!env.ADMIN_KEY) return jsonResponse({ success: false, message: "ADMIN_KEY secret is not set on the Worker." }, 500);
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return jsonResponse({ success: false, message: "Email is not set up: add RESEND_API_KEY (secret) and MAIL_FROM (variable) to the Worker." }, 500);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
  const list = (Array.isArray(b.invites) ? b.invites : []).slice(0, 20);
  // The link in the email is the Worker variable DASHBOARD_URL (set once, e.g. https://control.taager.app/). If it is not set, fall back to the https address the admin opened the dashboard from.
  const httpsOnly = (u) => (/^https:\/\/[^\s"<>]+$/.test(String(u || "")) ? String(u) : "");
  const link = httpsOnly(env.DASHBOARD_URL) || httpsOnly(b.url);
  if (!list.length) return jsonResponse({ success: false, message: "No invites to send." }, 400);
  if (!link) return jsonResponse({ success: false, message: "No public dashboard link: add the Worker variable DASHBOARD_URL (https://...) or open the dashboard from its https address." }, 400);
  const results = [];
  for (const it of list) {
    const email = String(it.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { results.push({ email, ok: false, error: "Bad email" }); continue; }
    const role = inviteEsc(String(it.role || "Viewer").slice(0, 60));
    const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">' +
      '<h2 style="margin:0 0 12px">You have been invited to the Taager Performance Dashboard</h2>' +
      '<p style="line-height:1.6">You now have access with the role <b>' + role + '</b>. Sign in with this email address (' + inviteEsc(email) + ') to get started.</p>' +
      '<p style="margin:24px 0"><a href="' + inviteEsc(link) + '" style="background:#0f9d7a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Open the dashboard</a></p>' +
      '<p style="color:#667;font-size:12px">This is an automated message, please do not reply.</p></div>';
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: "You've been invited to the Taager Performance Dashboard", html }) });
      if (r.ok) results.push({ email, ok: true }); else results.push({ email, ok: false, error: "Mail service " + r.status });
    } catch (e) { results.push({ email, ok: false, error: "Mail service unreachable" }); }
  }
  return jsonResponse({ success: results.every((x) => x.ok), results });
}
// ---------------------------------------------------------------------------
// v1.14.0 — Access requests: someone signs in but is not listed in People ->
// the dashboard posts requestAccess (public, no key) and shows "waiting for
// admin approval". KV "access:pending" = {email:{name,at}}. The admin lists
// them (getPending) and clears them (resolvePending) with X-Admin-Key.
// ---------------------------------------------------------------------------
async function towerLoadPending(env) {
  const txt = await env.SYNC_CACHE.get("access:pending");
  try { const o = JSON.parse(txt || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
async function handleRequestAccess(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
  const email = String(b.email || "").trim().toLowerCase().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonResponse({ success: false, message: "Bad email." }, 400);
  const p = await towerLoadPending(env);
  if (!p[email]) {
    if (Object.keys(p).length >= 200) return jsonResponse({ success: false, message: "Too many pending requests." }, 429);
    p[email] = { name: String(b.name || "").trim().slice(0, 80), at: new Date().toISOString(), invitedBy: String(b.invitedBy || "").trim().toLowerCase().slice(0, 120), role: String(b.role || "").slice(0, 60) };
    await env.SYNC_CACHE.put("access:pending", JSON.stringify(p));
  }
  return jsonResponse({ success: true });
}
async function handleGetPending(request, env) {
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  const p = await towerLoadPending(env);
  return jsonResponse({ success: true, pending: Object.keys(p).map((e) => ({ email: e, name: p[e].name || "", at: p[e].at || "", invitedBy: p[e].invitedBy || "", role: p[e].role || "" })) });
}
async function handleResolvePending(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
  const p = await towerLoadPending(env);
  (Array.isArray(b.emails) ? b.emails : []).forEach((e) => { delete p[String(e).toLowerCase()]; });
  await env.SYNC_CACHE.put("access:pending", JSON.stringify(p));
  return jsonResponse({ success: true });
}
async function handleDeleteAlert(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
  const all = await towerLoadAlerts(env);
  await env.SYNC_CACHE.put(TOWER_ALERTS_KEY, JSON.stringify(all.filter((a) => a.id !== b.id)));
  return jsonResponse({ success: true });
}

// ---------------------------------------------------------------------------
// v1.7.0 — Settings (metric cutoffs, alert thresholds/rules) + Activity Log.
// "settings:config" is public-read / admin-write. "activity:log" is admin-only
// (newest first, max 500).
// ---------------------------------------------------------------------------
function handleGetSettings(env) { return towerReadKv(env, "settings:config", "null"); }
function handlePutSettings(request, env) { return towerWriteKv(request, env, "settings:config"); }
async function handleGetActivity(request, env) {
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  const txt = await env.SYNC_CACHE.get("activity:log");
  let list = []; try { list = txt ? JSON.parse(txt) : []; } catch (e) {}
  return jsonResponse({ success: true, list: Array.isArray(list) ? list : [] });
}
async function handleLogActivity(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), type: String(b.type || "other").slice(0, 30), text: String(b.text || "").slice(0, 200), detail: String(b.detail || "").slice(0, 300), actor: String(b.actor || "").slice(0, 120), role: String(b.role || "").slice(0, 60) };
  if (!entry.text) return jsonResponse({ success: false, message: "text required." }, 400);
  const txt = await env.SYNC_CACHE.get("activity:log");
  let list = []; try { list = txt ? JSON.parse(txt) : []; } catch (e) {}
  if (!Array.isArray(list)) list = [];
  list.unshift(entry);
  await env.SYNC_CACHE.put("activity:log", JSON.stringify(list.slice(0, 500)));
  return jsonResponse({ success: true });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Release-Secret, X-Admin-Key",
    "Access-Control-Expose-Headers": "Content-Disposition",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: corsHeaders() });
}

// بيقرا شيت واحد مباشرة من Google Sheets (gviz) — نفس بالظبط الطريقة
// القديمة اللي كانت مستخدمة قبل ما نعمل الباك اند المركزي، بس هنا شغالة
// من على سيرفر Cloudflare (مش من متصفح كل يوزر لوحده). النتيجة بترجع بنفس
// شكل { table: { cols, rows } } اللي parseConfirmedByDaySheet() في app.js
// متعودة عليه، فمفيش أي تغيير مطلوب في منطق الـ parsing.
async function fetchGvizSheet(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?gid=${encodeURIComponent(gid)}&tqx=out:json`;
  const res = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`gviz responded with status ${res.status}`);
  const text = await res.text();
  const match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error("Unexpected gviz response shape (sheet/gid not public or wrong id?)");
  // gviz بيرجّع Date(y,m,d,...) حرفي مش JSON صالح. الباك اند (Code.gs) بيحلها
  // بـ eval() لأن Apps Script بيسمح بيه — لكن Cloudflare Workers بيمنع
  // eval()/new Function() تمامًا افتراضيًا ("Code generation from strings
  // disallowed"). فبدل eval بنستبدل أي Date(...) جايه فعلاً كـ *قيمة* (يعني
  // بعد "v": مباشرة) بنص JSON صالح — من غير ما نحتاج نفكه فعليًا لتاريخ
  // حقيقي، لأننا أصلاً مش بنستخدم قيمته (الفرونت اند بيقرا الـ "f" المنسّق
  // بس، مش "v"). العلامة "v": شرط عشان منستبدلش أي نص عادي جوه string لو
  // حصل واحتوى على كلمة "Date(" بالصدفة (زي اسم منتج فيه أقواس).
  const jsonSafeText = match[1].replace(/"v":Date\(([^)]*)\)/g, (m, inner) => '"v":"Date(' + inner + ')"');
  let parsed;
  try {
    parsed = JSON.parse(jsonSafeText);
  } catch (parseErr) {
    // نطلع سياق حوالين مكان الخطأ بالظبط عشان نقدر نشخص أي مشكلة تانية في
    // شكل الداتا من غير ما نحتاج نجيب الـ raw response يدويًا.
    const posMatch = /position (\d+)/.exec(parseErr.message);
    const pos = posMatch ? parseInt(posMatch[1], 10) : null;
    const snippet = pos !== null ? jsonSafeText.slice(Math.max(0, pos - 120), pos + 120) : "";
    throw new Error(
      "Failed to parse gviz JSON for gid " + gid + ": " + parseErr.message +
      (snippet ? " | context: ..." + snippet + "..." : "")
    );
  }
  if (parsed && parsed.status === "error") throw new Error("gviz returned status=error for gid " + gid);
  return parsed;
}

// v1.1.48: نسخة "خام" من fetchGvizSheet فوق — بترجع نص الـ JSON بعد فك
// setResponse() وتصحيح Date(...) بس، من غير JSON.parse خالص. السبب: اكتشفنا
// (Observability) إن الـ exceededCpu مكنش بس بسبب الـ 21 general-mirror
// (اتحلت في v1.1.46) — كان لسه بيحصل لـ Main (35 ألف صف) وConfirmed by Day
// (~640KB) لوحدهم، لأن JSON.parse لجدول بالحجم ده بياخد CPU حقيقي (بعكس
// fetch() نفسه، اللي وقت الانتظار بتاعه مبيتحسبش على budget الـ Worker
// خالص). فبدل ما نحوّل النص لـ object ضخم في الميموري بس عشان نخزّنه تاني
// كـ نص (JSON.stringify)، بنفضل نص طول الوقت: تخزين، فحص خطأ، بصمة تغيّر،
// وحتى تقدير عدد الصفوف — كل ده بعمليات نص رخيصة (indexOf/regex/slice) بدل
// تحويل كامل للبيانات.
async function fetchGvizSheetRaw(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?gid=${encodeURIComponent(gid)}&tqx=out:json`;
  const res = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`gviz responded with status ${res.status}`);
  const text = await res.text();
  const match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error("Unexpected gviz response shape (sheet/gid not public or wrong id?)");
  const jsonSafeText = match[1].replace(/"v":Date\(([^)]*)\)/g, (m, inner) => '"v":"Date(' + inner + ')"');
  // فحص خفيف للخطأ — "status":"error" بيظهر قريب من أول النص دايمًا في رد
  // gviz، فبنفحص أول 300 حرف بس (indexOf رخيص) بدل JSON.parse كامل.
  if (jsonSafeText.slice(0, 300).indexOf('"status":"error"') !== -1) {
    throw new Error("gviz returned status=error for gid " + gid);
  }
  return jsonSafeText;
}

// بيدخل حقل جديد (key:valueJsonText) جوه نص JSON object موجود بالفعل — بإضافة
// ",\"key\":value" قبل الـ "}" الأخيرة مباشرة. عملية نصية رخيصة جدًا (slice +
// concat) بدل ما نعمل JSON.parse لكل النص (ممكن يبقى مئات الـ KB) بس عشان
// نضيف حقل واحد صغير زي lastError.
function appendJsonField(jsonText, key, valueJsonText) {
  const trimmed = jsonText.replace(/\s+$/, "");
  if (trimmed.charAt(trimmed.length - 1) !== "}") return jsonText;
  return trimmed.slice(0, -1) + ',"' + key + '":' + valueJsonText + "}";
}

// تقدير رخيص لعدد الصفوف من النص الخام مباشرة (من غير parsing) — كل صف في
// رد gviz شكله {"c":[...]}، وده مفتاح مش موجود في تعريفات الأعمدة (cols)،
// فعدّ عدد مرات ظهور "c":[ بيديني عدد الصفوف الفعلي تقريبًا.
function estimateRowCount(rawText) {
  const m = rawText.match(/"c":\[/g);
  return m ? m.length : null;
}

// بصمة رخيصة جدًا مبنية على النص الخام مباشرة (من غير أي parsing) — بتاخد
// طول النص + عينات صغيرة (120 حرف) من 6 نقاط موزعة على طول النص. كافية
// عمليًا لاكتشاف أي تعديل حقيقي في الشيت (أي تغيير في أي مكان هيغيّر الطول
// أو يقع جوه واحدة من العينات على الأقل في أغلب الحالات)، بنفس فكرة
// sheetFingerprint القديمة (المبنية على object متحلل) بس من غير تكلفة الـ
// parsing خالص.
function rawTextFingerprint(text) {
  if (!text) return null;
  const len = text.length;
  const windowLen = 120;
  const numSamples = 6;
  let out = String(len);
  for (let i = 0; i < numSamples; i++) {
    const pos = Math.floor((len * i) / numSamples);
    out += "|" + text.slice(pos, pos + windowLen);
  }
  return out;
}

// v1.1.51: مشكلة اتكشفت بعد ما رجّعنا الـ Cron لدقيقة واحدة (v1.1.47) +
// حلينا الـ exceededCpu (v1.1.48): Cloudflare KV عندها حد 1,000 كتابة
// (write) في اليوم بس على خطة Free. كل تشغيلة cron ناجحة كانت بتكتب في KV
// حتى لو الداتا نفسها **متغيّرتش خالص** من آخر مرة — يعني شيت مستقر وهادي
// كان لسه بيتكتب في KV كل دقيقة (1,440 كتابة/يوم بس من الشيت ده، والتلاتة
// شيتات مع بعض كانوا بيعدوا الـ 1,000 بسرعة جدًا في نص اليوم). لما الـ
// quota تخلص، أي كتابة تانية في KV (حتى heartbeat بتاع "مين أونلاين") كانت
// بتفشل بـ exception (Error 1101) — ده سبب ظهور "Online: 0" رغم إن
// اليوزرز فاتحين فعلاً. وكمان كل تحديث (حتى لو نفس الداتا بالظبط) كان بيغيّر
// "fetchedAt"، فالفرونت اند (mainMetaPollTick) كان بيعتبرها "نسخة جديدة"
// ويعمل تحميل كامل لجدول الـ Main (25+ ميجا بايت) وparsing كامل على الـ
// main thread — وده السبب الحقيقي وراء "بيتجمد كل شوية": كان بيحصل كل
// دقيقة أو اتنين تقريبًا حتى لو مفيش أي تغيير حقيقي في الداتا.
//
// الحل: بصمة "آخر نسخة اتكتبت فعليًا" (META) منفصلة عن أي حاجة بنقارن بيها
// الاستقرار — لو الداتا الجديدة طابقت آخر نسخة مكتوبة بالفعل، منعملش أي
// كتابة KV خالص (صفر) ونرجع نفس الـ fetchedAt القديم زي ما هو. الكتابة
// بتحصل بس أول مرة أو لما الداتا فعلاً تتغيّر — يعني في يوم عادي (الداتا
// بتتغيّر كذا مرة بس مش كل دقيقة) هتبقى كتابات KV قليلة جدًا، وfetchedAt
// هيفضل ثابت (بمعنى صحيح: "آخر تحديث حقيقي") لحد ما حاجة تتغيّر فعلاً —
// وده كمان بيوقف التحميل الكامل المتكرر بتاع الفرونت اند تلقائيًا.
async function refreshConfirmedByDayCache(env, forceWrite) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  const rawTable = await fetchGvizSheetRaw(sheetId, CONFIRMED_BY_DAY_GID);
  const fp = rawTextFingerprint(rawTable);
  const nowIso = new Date().toISOString();
  const metaRaw = await env.SYNC_CACHE.get(CACHE_KEY_CONFIRMED_BY_DAY_META);
  const meta = metaRaw ? JSON.parse(metaRaw) : null;
  const payloadText = '{"success":true,"fetchedAt":"' + (meta && !forceWrite && meta.fingerprint === fp ? meta.fetchedAt || nowIso : nowIso) + '","table":' + rawTable + "}";
  if (!forceWrite && meta && meta.fingerprint === fp) {
    // نفس الداتا بالظبط زي آخر مرة اتكتبت — صفر كتابات KV (توفير الـ quota).
    return { success: true, fetchedAt: meta.fetchedAt || nowIso, rawResponseText: payloadText, unchanged: true };
  }
  await Promise.all([
    env.SYNC_CACHE.put(CACHE_KEY_CONFIRMED_BY_DAY, payloadText),
    env.SYNC_CACHE.put(CACHE_KEY_CONFIRMED_BY_DAY_META, JSON.stringify({ fingerprint: fp, fetchedAt: nowIso })),
  ]);
  return { success: true, fetchedAt: nowIso, rawResponseText: payloadText };
}

async function handleGetConfirmedByDay(env) {
  try {
    let cachedText = await env.SYNC_CACHE.get(CACHE_KEY_CONFIRMED_BY_DAY);
    if (!cachedText) {
      const fresh = await refreshConfirmedByDayCache(env, true);
      cachedText = fresh.rawResponseText;
    }
    const errorRaw = await env.SYNC_CACHE.get(CACHE_KEY_CONFIRMED_BY_DAY_ERROR);
    // v1.1.48: بنضيف lastError كنص مباشرة جوه الرد الخام (appendJsonField)
    // بدل JSON.parse(cached) + {...payload, lastError} + jsonResponse — ده
    // كان بيحصل مع *كل طلب قراءة* من أي يوزر (مش بس كل 5 دقايق زي الـ cron)،
    // يعني كان أغلى تكلفة CPU فعلية في الملف ده كله.
    const finalText = appendJsonField(cachedText, "lastError", errorRaw || "null");
    return new Response(finalText, { headers: corsHeaders() });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

// نفس فكرة refreshConfirmedByDayCache فوق بالظبط (raw text + بصمة + دمج
// كتابات KV) — قبل كده كان بيستخدم fetchGvizSheet (parsed) ويكتب في KV كل
// تشغيلة cron من غير أي مقارنة، وده كان بيساهم في استهلاك الـ 1,000
// كتابة/يوم برضو.
async function refreshIncentiveMerchantsCache(env, forceWrite) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  const rawTable = await fetchGvizSheetRaw(sheetId, INCENTIVE_MERCHANTS_GID);
  const fp = rawTextFingerprint(rawTable);
  const nowIso = new Date().toISOString();
  const metaRaw = await env.SYNC_CACHE.get(CACHE_KEY_INCENTIVE_MERCHANTS_META);
  const meta = metaRaw ? JSON.parse(metaRaw) : null;
  const payloadText = '{"success":true,"fetchedAt":"' + (meta && !forceWrite && meta.fingerprint === fp ? meta.fetchedAt || nowIso : nowIso) + '","table":' + rawTable + "}";
  if (!forceWrite && meta && meta.fingerprint === fp) {
    return { success: true, fetchedAt: meta.fetchedAt || nowIso, rawResponseText: payloadText, unchanged: true };
  }
  await Promise.all([
    env.SYNC_CACHE.put(CACHE_KEY_INCENTIVE_MERCHANTS, payloadText),
    env.SYNC_CACHE.put(CACHE_KEY_INCENTIVE_MERCHANTS_META, JSON.stringify({ fingerprint: fp, fetchedAt: nowIso })),
  ]);
  return { success: true, fetchedAt: nowIso, rawResponseText: payloadText };
}

async function handleGetIncentiveMerchants(env) {
  try {
    let cachedText = await env.SYNC_CACHE.get(CACHE_KEY_INCENTIVE_MERCHANTS);
    if (!cachedText) {
      const fresh = await refreshIncentiveMerchantsCache(env, true);
      cachedText = fresh.rawResponseText;
    }
    const errorRaw = await env.SYNC_CACHE.get(CACHE_KEY_INCENTIVE_MERCHANTS_ERROR);
    const finalText = appendJsonField(cachedText, "lastError", errorRaw || "null");
    return new Response(finalText, { headers: corsHeaders() });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

// v1.1.49: بعد إصلاح exceededCpu (v1.1.48)، ظهرت مشكلة تانية مختلفة تمامًا:
// KV عنده حد أقصى لحجم القيمة الواحدة 25MB بالظبط (26,214,400 byte)، وجدول
// Main بقى حجمه كـ نص JSON خام بيتخطى الحد ده (شفناها فعليًا: "KV PUT failed:
// 413 Value length of 27093643 exceeds limit of 26214400"). الحل: نضغط
// (gzip) النص قبل ما نخزنه في KV — Cloudflare Workers فيها CompressionStream
// جاهزة (تنفيذ native سريع جدًا، مش JS عادي، فتكلفتها على CPU budget أقل
// بكتير من فرق حجمها). وبما إن الـ gzip بتاعتنا بتحصل مرة واحدة بس لما
// الشيت "يستقر" (نفس شرط الاستقرار القديم)، مش مع كل طلب قراءة، فالتكلفة
// دي بتتحمل مرة كل تشغيلة ناجحة بس. وكمان بنخدّم النسخة المضغوطة لليوزر
// مباشرة بهيدر Content-Encoding: gzip — المتصفح بيفك الضغط تلقائيًا فمفيش
// أي تكلفة فك ضغط على الـ Worker خالص وقت القراءة.
async function gzipText(text) {
  const bytes = new TextEncoder().encode(text);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Response(cs.readable).arrayBuffer();
}

async function refreshMainCache(env, forceWrite) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  // v1.1.48: بنقرا النص الخام بس (من غير JSON.parse) — ده كان السبب
  // الحقيقي المتبقي وراء exceededCpu بعد ما شلنا الـ 21 general-mirror في
  // v1.1.46: JSON.parse لجدول Main (35 ألف صف) لوحده كان بياخد وقت CPU أكتر
  // من الـ ~10ms budget بتاع خطة Cloudflare Free.
  const rawTable = await fetchGvizSheetRaw(sheetId, MAIN_GID);
  const fp = rawTextFingerprint(rawTable);
  const nowIso = new Date().toISOString();
  const rowCount = estimateRowCount(rawTable);

  const candidateRaw = await env.SYNC_CACHE.get(CACHE_KEY_MAIN_CANDIDATE);
  const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;

  // v1.1.51: لو نفس البصمة دي اتكتبت فعلاً قبل كده في CACHE_KEY_MAIN (علامة
  // written:true)، يبقى الداتا لسه زي ما هي من آخر تحديث حقيقي — صفر
  // كتابات KV خالص (راجع الكومنت الكبير فوق refreshConfirmedByDayCache
  // لشرح كامل ليه ده مهم جدًا لخطة Cloudflare Free).
  if (!forceWrite && fp !== null && candidate && candidate.fingerprint === fp && candidate.written) {
    return { success: true, fetchedAt: candidate.fetchedAt || nowIso, stable: true, unchanged: true };
  }

  if (fp !== null && candidate && candidate.fingerprint === fp) {
    // البصمة اتطابقت مع آخر تشغيلة (وده أول مرة تتطابق، لسه ماتكتبتش) —
    // الشيت مستقر، مفيش تعديل شغال عليه دلوقتي. آمن نخدّمه لليوزرز. بنبني
    // نص الرد بـ concatenation مباشرة — من غير JSON.stringify لأي object
    // فيه الجدول الضخم.
    const payloadText = '{"success":true,"fetchedAt":"' + nowIso + '","stable":true,"table":' + rawTable + "}";
    const compressed = await gzipText(payloadText);
    await Promise.all([
      env.SYNC_CACHE.put(CACHE_KEY_MAIN, compressed),
      env.SYNC_CACHE.put(CACHE_KEY_MAIN_META, JSON.stringify({ stable: true, fetchedAt: nowIso, rowCount })),
      env.SYNC_CACHE.put(CACHE_KEY_MAIN_CANDIDATE, JSON.stringify({ fingerprint: fp, fetchedAt: nowIso, rowCount, written: true })),
    ]);
    return { success: true, fetchedAt: nowIso, stable: true, rawResponseText: payloadText };
  }

  // لسه بيتغيّر (أو دي أول تشغيلة خالص) — نسجّل القراءة الخام دي كـ "مرشح"
  // للمرة الجاية بس (written:false)، عشان التشغيلة اللي بعدها تقارن نفسها
  // بيه، من غير أي كتابة لـ CACHE_KEY_MAIN نفسه.
  await env.SYNC_CACHE.put(CACHE_KEY_MAIN_CANDIDATE, JSON.stringify({ fingerprint: fp, fetchedAt: nowIso, rowCount, written: false }));

  const hasExisting = await env.SYNC_CACHE.get(CACHE_KEY_MAIN).then((v) => !!v);
  if (hasExisting) return { success: true, stable: false, skippedReparse: true };

  // مفيش أي نسخة مستقرة اتسجلت قبل كده خالص (أول تشغيلة من عمر الـ Worker) —
  // مضطرين نستخدم القراءة دي زي ما هي عشان الداشبورد مايفضلش فاضي، بس
  // بعلامة stable:false توضح إنها لسه ماتأكدتش.
  const bootstrapText = '{"success":true,"fetchedAt":"' + nowIso + '","stable":false,"table":' + rawTable + "}";
  const compressedBootstrap = await gzipText(bootstrapText);
  await Promise.all([
    env.SYNC_CACHE.put(CACHE_KEY_MAIN, compressedBootstrap),
    env.SYNC_CACHE.put(CACHE_KEY_MAIN_META, JSON.stringify({ stable: false, fetchedAt: nowIso, rowCount })),
  ]);
  return { success: true, fetchedAt: nowIso, stable: false, rawResponseText: bootstrapText };
}

async function handleGetMain(env) {
  try {
    // v1.1.49: الـ KV بقى مخزن فيه bytes مضغوطة (gzip)، مش نص — لازم نقراها
    // كـ arrayBuffer، ونرجعها للمتصفح زي ما هي مع هيدر Content-Encoding:
    // gzip عشان يفك الضغط لوحده تلقائيًا (نفس آلية أي رد HTTP مضغوط عادي).
    let cachedBuf = await env.SYNC_CACHE.get(CACHE_KEY_MAIN, { type: "arrayBuffer" });
    if (!cachedBuf) {
      const fresh = await refreshMainCache(env, true);
      if (fresh && fresh.rawResponseText) {
        return new Response(fresh.rawResponseText, { headers: corsHeaders() });
      }
      return jsonResponse(fresh);
    }
    const headers = corsHeaders();
    headers["Content-Encoding"] = "gzip";
    // v1.1.49 (تصحيح): من غير encodeBody:"manual"، Cloudflare's edge بتحاول
    // كمان تضغط الرد بتاعنا (لأنه Content-Type: application/json و
    // Accept-Encoding: gzip من المتصفح)، فبيحصل ضغط مزدوج — bytes اتضغطت
    // مرتين. المتصفح بيفك مرة واحدة بس (تلقائي حسب هيدر Content-Encoding)
    // ويفضل معاه نص مضغوط لسه (طلعت شكلها بايتس عشوائية مش JSON). ده اللي
    // كان بيحصل فعليًا وشفناه لما فتحنا الرابط مباشرة. الحل: encodeBody:
    // "manual" بيقول لـ Cloudflare "الـ body ده متضغوط بالفعل زي ما الهيدر
    // بيقول، متلمسوش" — پاس-ثرو خام من غير أي تعديل. وبرضو بنضيف
    // "no-transform" لهيدر Cache-Control — من غيرها، بعض نقاط Cloudflare
    // (edge POPs) بتتجاهل encodeBody:"manual" وتعيد ضغط الرد تاني برضو
    // (مشكلة موثقة رسميًا من Cloudflare نفسها).
    headers["Cache-Control"] = "no-store, no-transform";
    return new Response(cachedBuf, { headers, encodeBody: "manual" });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

// v1.1.46: بعد ما شلنا الـ General Sync (21 شيت) من الـ Worker خالص (بقت
// على Apps Script بس، راجع الكومنت فوق LAST_SYNC_GIDS/scheduled() تحت)،
// forceRefresh بقى بيحدّث بس التلاتة اللي لسه على الـ Worker: Main +
// Confirmed by Day + Incentive Merchants — التلاتة دول خفيفين بما يكفي إنهم
// يتستنوا مع بعض في نفس الرد من غير أي مشكلة CPU.
//
// بوابة بسيطة بإيميل الـ Manager (نفس فكرة "Worker Sync Status" في الفرونت
// اند). المهم: ده مش bypass لشرط الاستقرار — لسه بيمر بنفس منطق المقارنة
// بين بصمتين متتاليتين جوه refreshMainCache بالظبط، بس بيخلي "المتتاليتين"
// تحصل دلوقتي بدل ما تستنى 5 دقايق.
async function handleForceRefresh(request, env, ctx) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (!isOwnerEmail(email)) {
    return jsonResponse({ success: false, message: "Not authorized." }, 403);
  }
  try {
    // v1.3.48: Main/Confirmed by Day بقوا من Metabase — بس Incentive Merchants لسه على الـ Worker.
    const main = {}, confirmedByDay = {};
    const incentiveMerchants = await refreshIncentiveMerchantsCache(env);

    return jsonResponse({
      success: true,
      main: { stable: !!main.stable, fetchedAt: main.fetchedAt || null, skippedReparse: !!main.skippedReparse },
      confirmedByDay: { fetchedAt: confirmedByDay.fetchedAt || null },
      incentiveMerchants: { fetchedAt: incentiveMerchants.fetchedAt || null },
    });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

// v1.1.33: نسخة خفيفة جدًا من getMain — من غير الجدول الكامل (اللي ممكن
// يبقى عشرات الـ MB)، بس metadata (stable/fetchedAt/عدد الصفوف/آخر خطأ لو
// فيه). الهدف: تسمح لكل اليوزرز (مش بس الـ Manager) إنهم يعملوا "poll" خفيف
// كل شوية عشان يكتشفوا لما الـ Main تتحدث فعليًا، من غير ما يحمّلوا الجدول
// الضخم كامل كل مرة.
async function handleGetMainMeta(env) {
  try {
    // بنقرا CACHE_KEY_MAIN_META الخفيفة بس (راجع تعليقها فوق) — مفيش أي
    // JSON.parse لجدول ضخم هنا خالص، القراءة دي رخيصة جدًا مهما كان حجم
    // شيت الـ Main.
    const [metaRaw, errorRaw, candidateRaw] = await Promise.all([
      env.SYNC_CACHE.get(CACHE_KEY_MAIN_META),
      env.SYNC_CACHE.get(CACHE_KEY_MAIN_ERROR),
      env.SYNC_CACHE.get(CACHE_KEY_MAIN_CANDIDATE),
    ]);
    const lastError = errorRaw ? JSON.parse(errorRaw) : null;
    // lastAttempt: آخر مرة الـ Worker حاول يقرا الشيت فعلاً، حتى لو لسه
    // ماستقرتش (مطابقتش القراءة اللي قبلها) — عشان توضح إن فيه محاولات
    // شغالة بالفعل، مش إن الـ Worker واقف.
    const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;
    const lastAttempt = candidate ? { fetchedAt: candidate.fetchedAt || null, rowCount: candidate.rowCount === undefined ? null : candidate.rowCount } : null;
    if (!metaRaw) {
      return jsonResponse({ success: true, stable: false, fetchedAt: null, rowCount: null, lastError, lastAttempt });
    }
    const meta = JSON.parse(metaRaw);
    return jsonResponse({ success: true, stable: !!meta.stable, fetchedAt: meta.fetchedAt || null, rowCount: meta.rowCount === undefined ? null : meta.rowCount, lastError, lastAttempt });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

function isAllowedEmail(email) {
  const re = new RegExp("^[^\\s@]+@" + ALLOWED_EMAIL_DOMAIN.replace(".", "\\.") + "$", "i");
  return re.test(String(email || "").trim());
}

async function getPresenceMap(env) {
  const raw = await env.SYNC_CACHE.get(CACHE_KEY_PRESENCE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function pruneStalePresence(map) {
  const cutoff = Date.now() - PRESENCE_STALE_MS;
  const cleaned = {};
  Object.keys(map).forEach((email) => {
    if (map[email] && map[email].lastSeen >= cutoff) cleaned[email] = map[email];
  });
  return cleaned;
}

// v1.1.40: نقلنا heartbeat/get_online_users هنا بالكامل (بدل ما يعدوا على
// Apps Script) — بيانات "مين أونلاين" مؤقتة بطبيعتها ومحتاجاش تتخزن في
// شيت جوجل خالص، فـ KV هنا كافي وأخف بكتير. نفس المنطق بالظبط اللي كان في
// handleHeartbeat/handleGetOnlineUsers جوه backend/Code.gs (PRESENCE_ONLINE_
// WINDOW_MS/PRESENCE_STALE_MS/PRESENCE_ADMIN_EMAIL).
async function handleHeartbeat(request, env) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  const name = String(url.searchParams.get("name") || "").trim();
  if (!email || !isAllowedEmail(email)) {
    return jsonResponse({ success: false, message: "Not authorized." });
  }
  const map = await getPresenceMap(env);
  map[email] = { name: name || email, lastSeen: Date.now() };
  await env.SYNC_CACHE.put(CACHE_KEY_PRESENCE, JSON.stringify(pruneStalePresence(map)));
  return jsonResponse({ success: true });
}

async function handleGetOnlineUsers(request, env) {
  const url = new URL(request.url);
  const requesterEmail = String(url.searchParams.get("requesterEmail") || "").trim().toLowerCase();
  if (!isOwnerEmail(requesterEmail)) {
    return jsonResponse({ success: false, message: "Not authorized." });
  }
  const map = pruneStalePresence(await getPresenceMap(env));
  const cutoff = Date.now() - PRESENCE_ONLINE_WINDOW_MS;
  const online = [];
  Object.keys(map).forEach((email) => {
    const entry = map[email];
    if (entry.lastSeen >= cutoff) online.push({ email, name: entry.name, lastSeen: entry.lastSeen });
  });
  online.sort((a, b) => b.lastSeen - a.lastSeen);
  return jsonResponse({ success: true, now: Date.now(), users: online });
}


// ===== v1.3.28: Release Upload / Download (GitHub) =====
// الـ GitHub token بيتخزن هنا بس (Worker secret) — مش في كود الداشبورد خالص.
// Worker settings → Variables:
//   GITHUB_TOKEN   (Secret)  fine-grained PAT: Contents = Read and write على الريبو ده بس
//   RELEASE_SECRET (Secret)  كلمة سر بتكتبها وانت بترفع نسخة جديدة
//   GITHUB_REPO    (Text)    owner/repo  (مثال: Dashboard-Performance/performance-dashboard)
//   GITHUB_BRANCH  (Text)    اختياري، الافتراضي main
// الملفات بتتحفظ في الريبو تحت releases/ (كل نسخة + latest.json).
const RELEASE_DIR = "releases";

function ghHeaders(env, extra) {
  return Object.assign({
    Authorization: "Bearer " + env.GITHUB_TOKEN,
    "User-Agent": "performance-dashboard-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  }, extra || {});
}
function ghUrl(env, path) {
  return "https://api.github.com/repos/" + env.GITHUB_REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
}
function ghBranch(env) { return env.GITHUB_BRANCH || "main"; }
function releaseConfigured(env) { return !!(env.GITHUB_TOKEN && env.GITHUB_REPO); }

async function ghGetFile(env, path) {
  return fetch(ghUrl(env, path) + "?ref=" + encodeURIComponent(ghBranch(env)), { headers: ghHeaders(env, { Accept: "application/vnd.github+json" }) });
}
async function ghPutFile(env, path, bytesB64, message) {
  let sha;
  const ex = await ghGetFile(env, path);
  if (ex.ok) { sha = (await ex.json()).sha; }
  const body = { message, content: bytesB64, branch: ghBranch(env) };
  if (sha) body.sha = sha;
  const r = await fetch(ghUrl(env, path), { method: "PUT", headers: ghHeaders(env, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
  if (!r.ok) throw new Error("GitHub " + r.status + ": " + (await r.text()).slice(0, 300));
  return r.json();
}
function bytesToB64(bytes) {
  let bin = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
async function readLatestMeta(env) {
  const r = await fetch(ghUrl(env, RELEASE_DIR + "/latest.json") + "?ref=" + encodeURIComponent(ghBranch(env)), { headers: ghHeaders(env, { Accept: "application/vnd.github.raw+json" }) });
  if (!r.ok) return null;
  try { return JSON.parse(await r.text()); } catch (_e) { return null; }
}

async function handleReleaseInfo(env) {
  if (!releaseConfigured(env)) return jsonResponse({ success: false, message: "GitHub is not configured on the worker (GITHUB_TOKEN / GITHUB_REPO)." }, 501);
  const meta = await readLatestMeta(env);
  if (!meta) return jsonResponse({ success: true, latest: null });
  return jsonResponse({ success: true, latest: meta });
}

async function handleReleaseDownload(env) {
  if (!releaseConfigured(env)) return jsonResponse({ success: false, message: "GitHub is not configured on the worker." }, 501);
  const meta = await readLatestMeta(env);
  if (!meta || !meta.path) return jsonResponse({ success: false, message: "No release uploaded yet." }, 404);
  const r = await fetch(ghUrl(env, meta.path) + "?ref=" + encodeURIComponent(ghBranch(env)), { headers: ghHeaders(env, { Accept: "application/vnd.github.raw+json" }) });
  if (!r.ok) return jsonResponse({ success: false, message: "GitHub " + r.status }, 502);
  const h = corsHeaders();
  h["Content-Type"] = "application/zip";
  h["Content-Disposition"] = 'attachment; filename="' + meta.filename.replace(/"/g, "") + '"';
  return new Response(r.body, { status: 200, headers: h });
}


// ----- v1.3.29: publish the uploaded zip as the live site (single atomic commit) -----
// الزيب بيتفك جوه الـ Worker، وكل ملفات الموقع بتتكتب في الريبو في commit واحد
// → Vercel (الموصّل بالريبو) بينشر لوحده. backend/ و cloudflare-worker/ و releases/
// مش بيتنشروا كموقع (فيهم أسرار الباك اند) + .vercelignore بيمنع Vercel يقدّمهم.
const SITE_SKIP_PREFIXES = ["backend/", "cloudflare-worker/", "releases/", "__MACOSX/", ".git/"];

async function inflateRaw(u8) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Bad zip (no central directory).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Bad zip entry.");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue;
    const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lelen;
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error("Unsupported zip compression for " + name);
    out.push({ name, data });
  }
  return out;
}
async function ghApi(env, method, path, body) {
  const r = await fetch("https://api.github.com/repos/" + env.GITHUB_REPO + path, {
    method, headers: ghHeaders(env, { Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error("GitHub " + method + " " + path.split("?")[0] + " → " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}
async function publishSiteFromZip(env, zipBytes, version) {
  let files = await unzipEntries(zipBytes);
  files = files.filter((f) => !/(^|\/)\.DS_Store$/.test(f.name));
  if (!files.some((f) => f.name === "index.html")) {
    const first = files.length ? files[0].name.split("/")[0] + "/" : "";
    if (first && files.every((f) => f.name.startsWith(first))) files = files.map((f) => ({ name: f.name.slice(first.length), data: f.data }));
  }
  if (!files.some((f) => f.name === "index.html") || !files.some((f) => f.name === "js/app.js"))
    throw new Error("Zip must contain index.html and js/app.js (site NOT updated).");
  files = files.filter((f) => !SITE_SKIP_PREFIXES.some((pre) => f.name.startsWith(pre)) && !/\.zip$/i.test(f.name));
  const branch = ghBranch(env);
  const ref = await ghApi(env, "GET", "/git/ref/heads/" + encodeURIComponent(branch));
  const parent = ref.object.sha;
  const parentCommit = await ghApi(env, "GET", "/git/commits/" + parent);
  const tree = [];
  for (const f of files) {
    const blob = await ghApi(env, "POST", "/git/blobs", { content: bytesToB64(f.data), encoding: "base64" });
    tree.push({ path: f.name, mode: "100644", type: "blob", sha: blob.sha });
  }
  const ig = await ghApi(env, "POST", "/git/blobs", { content: "releases/\nbackend/\ncloudflare-worker/\n*.zip\n", encoding: "utf-8" });
  tree.push({ path: ".vercelignore", mode: "100644", type: "blob", sha: ig.sha });
  const newTree = await ghApi(env, "POST", "/git/trees", { base_tree: parentCommit.tree.sha, tree });
  const commit = await ghApi(env, "POST", "/git/commits", { message: "Deploy dashboard v" + version + " (via Worker Sync Status upload)", tree: newTree.sha, parents: [parent] });
  await ghApi(env, "PATCH", "/git/refs/heads/" + encodeURIComponent(branch), { sha: commit.sha });
  return { files: files.length, commit: commit.sha.slice(0, 7) };
}

async function handleReleaseUpload(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  if (!releaseConfigured(env) || !env.RELEASE_SECRET) return jsonResponse({ success: false, message: "Upload is not configured on the worker (GITHUB_TOKEN / GITHUB_REPO / RELEASE_SECRET)." }, 501);
  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (!isOwnerEmail(email)) return jsonResponse({ success: false, message: "Not authorized." }, 403);
  if ((request.headers.get("X-Release-Secret") || "") !== env.RELEASE_SECRET) return jsonResponse({ success: false, message: "Wrong upload password." }, 403);
  const rawName = String(url.searchParams.get("filename") || "").trim();
  if (!/\.zip$/i.test(rawName)) return jsonResponse({ success: false, message: "Only .zip files are accepted." }, 400);
  const vm = rawName.match(/v?(\d+\.\d+\.\d+)/i);
  const version = vm ? vm[1] : "unknown";
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return jsonResponse({ success: false, message: "Empty or too large (max 25MB)." }, 400);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return jsonResponse({ success: false, message: "Not a valid zip file." }, 400);
  const filename = "Performance dashboard v" + version + ".zip";
  const path = RELEASE_DIR + "/" + filename;
  try {
    await ghPutFile(env, path, bytesToB64(bytes), "Upload dashboard v" + version + " (via Worker Sync Status)");
    const meta = { version, filename, path, size: bytes.length, uploadedAt: new Date().toISOString(), uploadedBy: email };
    await ghPutFile(env, RELEASE_DIR + "/latest.json", btoa(JSON.stringify(meta, null, 2)), "Set latest release to v" + version);
    let published = null, publishError = null;
    try { published = await publishSiteFromZip(env, bytes, version); }
    catch (e) { publishError = (e && e.message) || String(e); }
    return jsonResponse({ success: true, latest: meta, published, publishError });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}


// ===========================================================================
// v1.10.0 — حاجات اتنقلت من backend/Code.gs (Apps Script) للـ Worker عشان السرعة:
//   (1) Computed Snapshots (publish/get/list) — بقت متخزنة في KV بدل Drive.
//   (2) getLastSync / getLastSyncMeta — Read-through cache: الـ cron بيسحب النسخة
//       الجاهزة من Apps Script (اللي بيقرا الشيتات) ويخزنها هنا، واليوزرز بيقروا
//       من الـ edge مباشرة. (قراءة الشيتات نفسها لسه في Apps Script — بتحتاج صلاحيات Google.)
//   (3) Feedback (match / decline / sales-plan): الحفظ بيرجّع نجاح فورًا ويتكتب في
//       الشيت في الخلفية مع إعادة محاولة أوتوماتيك — مفيش Error بسبب بطء/تقطيع Apps Script.
// ===========================================================================
const COMPUTED_DEFAULT_KEYS = ["Admin-Panal-Center"];
function computedKeys(env) {
  const raw = (env && env.COMPUTED_API_KEYS) ? String(env.COMPUTED_API_KEYS) : "";
  const list = raw.split(",").map(x => x.trim()).filter(Boolean);
  return list.length ? list : COMPUTED_DEFAULT_KEYS;
}
function sanitizeComputedName(name) { return String(name || "").trim().replace(/[^A-Za-z0-9_-]/g, ""); }

async function handlePublishComputed(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  let payload;
  try { payload = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Invalid request body." }, 400); }
  const sections = payload && payload.sections;
  if (!Array.isArray(sections) || !sections.length) return jsonResponse({ success: false, message: "No sections provided." }, 400);
  const publishedAt = new Date().toISOString();
  const results = [];
  for (const s of sections) {
    const section = sanitizeComputedName(s && s.section), table = sanitizeComputedName(s && s.table);
    if (!section || !table) { results.push({ section: s && s.section, table: s && s.table, ok: false, error: "Invalid section/table name." }); continue; }
    const rows = Array.isArray(s.rows) ? s.rows : [];
    const body = JSON.stringify({ section, table, updatedAt: publishedAt, rowCount: rows.length, rows });
    if (body.length > 24 * 1024 * 1024) { results.push({ section, table, ok: false, error: "Too large for KV (>24MB)." }); continue; }
    try {
      await env.SYNC_CACHE.put("computed:" + section + "__" + table, body, { metadata: { section, table, updatedAt: publishedAt, rowCount: rows.length } });
      results.push({ section, table, ok: true });
    } catch (e) { results.push({ section, table, ok: false, error: (e && e.message) || String(e) }); }
  }
  return jsonResponse({ success: true, publishedAt, results });
}
function computedKeyCheck(url, env) {
  const key = url.searchParams.get("key") || "";
  return computedKeys(env).indexOf(key) === -1 ? jsonResponse({ success: false, message: "Missing or invalid API key." }, 403) : null;
}
async function handleGetComputed(url, env) {
  const bad = computedKeyCheck(url, env); if (bad) return bad;
  const section = sanitizeComputedName(url.searchParams.get("section")), table = sanitizeComputedName(url.searchParams.get("table"));
  if (!section || !table) return jsonResponse({ success: false, message: "section and table query params are required." }, 400);
  const txt = await env.SYNC_CACHE.get("computed:" + section + "__" + table);
  if (!txt) return jsonResponse({ success: false, message: "No data published yet for section='" + section + "', table='" + table + "'." }, 404);
  // الرد = نفس شكل Apps Script القديم: { success:true, ...الملف }
  return new Response('{"success":true,' + txt.trimStart().slice(1), { status: 200, headers: corsHeaders() });
}
async function handleListComputed(url, env) {
  const bad = computedKeyCheck(url, env); if (bad) return bad;
  const available = []; let cursor;
  do {
    const page = await env.SYNC_CACHE.list({ prefix: "computed:", cursor });
    page.keys.forEach(k => { const m = k.metadata || {}; available.push({ section: m.section || "", table: m.table || "", updatedAt: m.updatedAt, rowCount: m.rowCount }); });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return jsonResponse({ success: true, available });
}

// ---- getLastSync read-through cache --------------------------------------
const LASTSYNC_KEYS = { general: "lastsync:general_v1", irq: "lastsync:irq_v1", meta: "lastsync:meta_v1" };
async function appsScriptGet(env, qs) {
  const r = await fetch(env.APPS_SCRIPT_URL + "?" + qs, { redirect: "follow" });
  return await r.text();
}
async function refreshLastSyncCache(env) {
  const metaTxt = await appsScriptGet(env, "action=getLastSyncMeta");
  let meta; try { meta = JSON.parse(metaTxt); } catch (e) { throw new Error("getLastSyncMeta: non-JSON response"); }
  if (!meta || meta.success === false) throw new Error("getLastSyncMeta failed");
  const prevTxt = await env.SYNC_CACHE.get(LASTSYNC_KEYS.meta);
  let prev = null; try { prev = prevTxt ? JSON.parse(prevTxt) : null; } catch (e) {}
  if (prev && prev.fetchedAt && prev.fetchedAt === meta.fetchedAt) return { changed: false }; // نفس النسخة — مفيش كتابة KV
  const [g, irq] = await Promise.all([appsScriptGet(env, "action=getLastSync"), appsScriptGet(env, "action=getLastSync&group=irq")]);
  const gOk = g.charAt(0) === "{" && g.indexOf('"success":true') > -1, iOk = irq.charAt(0) === "{" && irq.indexOf('"success":true') > -1;
  if (!gOk) throw new Error("getLastSync: bad response");
  await env.SYNC_CACHE.put(LASTSYNC_KEYS.general, g);
  if (iOk) await env.SYNC_CACHE.put(LASTSYNC_KEYS.irq, irq);
  await env.SYNC_CACHE.put(LASTSYNC_KEYS.meta, metaTxt);
  return { changed: true };
}
async function handleGetLastSync(url, env, ctx) {
  const group = url.searchParams.get("group") === "irq" ? "irq" : "general";
  const txt = await env.SYNC_CACHE.get(LASTSYNC_KEYS[group]);
  if (txt) return new Response(txt, { status: 200, headers: corsHeaders() });
  // لسه الكاش فاضي (أول تشغيل) — نمرر لـ Apps Script مباشرة ونملأ الكاش في الخلفية.
  const live = await appsScriptGet(env, "action=getLastSync" + (group === "irq" ? "&group=irq" : ""));
  if (ctx) ctx.waitUntil(refreshLastSyncCache(env).catch(() => {}));
  return new Response(live, { status: 200, headers: corsHeaders() });
}
async function handleGetLastSyncMeta(env) {
  const txt = await env.SYNC_CACHE.get(LASTSYNC_KEYS.meta);
  if (txt) return new Response(txt, { status: 200, headers: corsHeaders() });
  return new Response(await appsScriptGet(env, "action=getLastSyncMeta"), { status: 200, headers: corsHeaders() });
}

// ---- Feedback: instant ack + background apply to the Google Sheet ----------
const FB_SAVE_ACTIONS = ["save_match_feedback", "save_decline_feedback", "save_sales_plan_feedback"];
const FB_GET_ACTIONS = ["get_decline_feedback", "get_sales_plan_feedback"];
const FB_MAX_TRIES = 15;
const FB_TRANSIENT = /lock|busy|try again|timed? ?out|too many|temporar|exceeded|server error|invalid response/i;
async function callAppsScriptPost(env, payload) {
  const r = await fetch(env.APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), redirect: "follow" });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { return { success: false, error: "Server returned an invalid response", transient: true }; }
}
async function handleFeedback(request, env, ctx) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  let payload;
  try { payload = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, error: "Invalid request body." }, 400); }
  const action = payload && payload.action;
  if (FB_GET_ACTIONS.indexOf(action) > -1) return handleFeedbackGet(payload, env, ctx);
  if (FB_SAVE_ACTIONS.indexOf(action) < 0) return jsonResponse({ success: false, error: "Unknown feedback action." }, 400);
  // فحوصات خفيفة بس (الباك اند بيعمل الفحص الكامل وقت الكتابة في الشيت)
  if (!String(payload.userName || "").trim() && action !== "save_match_feedback") return jsonResponse({ success: false, error: "Missing logged-in user name." }, 400);
  if (action === "save_match_feedback" && (!String(payload.feedback || "").trim() || !payload.merchantId || !payload.productId)) return jsonResponse({ success: false, error: "Missing feedback details." }, 400);
  if (action === "save_decline_feedback" && (!String(payload.feedback || "").trim() || !payload.row || !payload.row.skuId || !payload.row.merchantId || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.declineDay || "")))) return jsonResponse({ success: false, error: "Missing match details." }, 400);
  if (action === "save_sales_plan_feedback" && (!payload.row || !payload.row.productId || !payload.row.merchantId || !String(payload.comment || "").trim())) return jsonResponse({ success: false, error: "Missing match details or comment." }, 400);
  const id = Date.now().toString().padStart(14, "0") + "-" + crypto.randomUUID().slice(0, 8);
  const item = { id, payload, tries: 0, at: new Date().toISOString() };
  await env.SYNC_CACHE.put("fbq:" + id, JSON.stringify(item), { expirationTtl: 7 * 86400 });
  ctx.waitUntil(flushFeedbackQueue(env));
  return jsonResponse({ success: true, queued: true, id, at: item.at.substring(0, 16).replace("T", " "), date: String(item.at).substring(0, 10) });
}
async function processFeedbackItem(env, key, item) {
  let res;
  try { res = await callAppsScriptPost(env, item.payload); } catch (e) { res = { success: false, error: (e && e.message) || "network error", transient: true }; }
  const p = item.payload;
  const sameUserLocked = res && res.locked && res.existing && String(res.existing.by || "") === String(p.userName || "") && String(res.existing.feedback || "") === String(p.feedback || "").substring(0, 2000);
  if (res && (res.success === true || sameUserLocked)) { await env.SYNC_CACHE.delete(key); return "ok"; }
  const err = String((res && (res.error || res.message)) || "unknown error");
  const transient = !!(res && res.transient) || FB_TRANSIENT.test(err);
  item.tries = (item.tries || 0) + 1;
  if (!transient || item.tries >= FB_MAX_TRIES) {
    // فشل نهائي: نحفظه في قايمة الفاشل (للمراجعة عن طريق getFeedbackStatus) ونشيله من الطابور
    await env.SYNC_CACHE.put("fbfail:" + item.id, JSON.stringify({ id: item.id, action: p.action, error: err, at: new Date().toISOString(), user: p.userName || p.userEmail || "", payload: p }), { expirationTtl: 30 * 86400 });
    await env.SYNC_CACHE.delete(key); return "failed";
  }
  item.next = Date.now() + Math.min(60000 * item.tries, 300000); // 1m,2m,3m... بحد أقصى 5 دقايق
  await env.SYNC_CACHE.put(key, JSON.stringify(item), { expirationTtl: 7 * 86400 });
  return "retry";
}
async function flushFeedbackQueue(env) {
  const lock = await env.SYNC_CACHE.get("fb:flush");
  if (lock && Date.now() - Number(lock) < 45000) return { skipped: true };
  await env.SYNC_CACHE.put("fb:flush", String(Date.now()), { expirationTtl: 60 });
  const page = await env.SYNC_CACHE.list({ prefix: "fbq:", limit: 50 });
  let ok = 0, retry = 0, failed = 0;
  for (const k of page.keys) { // ids مرتبة بالوقت => ترتيب الحفظ محفوظ
    const txt = await env.SYNC_CACHE.get(k.name); if (!txt) continue;
    let item; try { item = JSON.parse(txt); } catch (e) { await env.SYNC_CACHE.delete(k.name); continue; }
    if (item.next && item.next > Date.now()) continue;
    const r = await processFeedbackItem(env, k.name, item);
    if (r === "ok") ok++; else if (r === "retry") retry++; else failed++;
  }
  await env.SYNC_CACHE.delete("fb:flush").catch(() => {});
  return { ok, retry, failed };
}
async function pendingFeedback(env) {
  const out = []; const page = await env.SYNC_CACHE.list({ prefix: "fbq:", limit: 200 });
  for (const k of page.keys) { const t = await env.SYNC_CACHE.get(k.name); if (t) { try { out.push(JSON.parse(t)); } catch (e) {} } }
  return out;
}
async function handleFeedbackGet(payload, env, ctx) {
  // كاش قصير (25 ثانية) على الـ edge لقراءة الشيت، وبعدين نضيف فوقه اللي لسه في الطابور
  const cacheKey = new Request("https://fbcache.invalid/" + encodeURIComponent(JSON.stringify(payload)));
  let base = null;
  try { const hit = await caches.default.match(cacheKey); if (hit) base = await hit.json(); } catch (e) {}
  if (!base) {
    try { base = await callAppsScriptPost(env, payload); } catch (e) { base = null; }
    if (base && base.success) { try { ctx.waitUntil(caches.default.put(cacheKey, new Response(JSON.stringify(base), { headers: { "Cache-Control": "max-age=25", "Content-Type": "application/json" } }))); } catch (e) {} }
  }
  if (!base || !base.success) base = { success: true, items: {}, stale: true };
  const items = base.items || {};
  const pend = await pendingFeedback(env);
  pend.forEach(q => {
    const p = q.payload, at = String(q.at).substring(0, 16).replace("T", " ");
    if (payload.action === "get_decline_feedback" && p.action === "save_decline_feedback" && String(p.declineDay) === String(payload.declineDay)) {
      items[String(p.row.merchantId).trim() + "||" + String(p.row.skuId).trim()] = { feedback: String(p.feedback || ""), by: p.userName || "", at };
    } else if (payload.action === "get_sales_plan_feedback" && p.action === "save_sales_plan_feedback") {
      const d = String(q.at).substring(0, 10);
      if (payload.month && d.substring(0, 7) !== String(payload.month)) return;
      const r = p.row || {}, k = String(r.merchantId).trim() + "||" + String(r.productId).trim();
      items[k] = { date: d, feedback: String(p.feedback || ""), adjTarget: Number(p.adjustedTarget), merchants: (p.newMerchants || []).map(m => ({ id: m.id, target: Number(m.target) })), comment: String(p.comment || ""), newTarget: Number(r.newDailyTarget) || 0, by: p.userName || "", at };
    }
  });
  return jsonResponse({ success: true, items, pending: pend.length });
}
async function handleFeedbackStatus(env) {
  const pend = await env.SYNC_CACHE.list({ prefix: "fbq:" }), fail = await env.SYNC_CACHE.list({ prefix: "fbfail:" });
  const failed = [];
  for (const k of fail.keys.slice(0, 50)) { const t = await env.SYNC_CACHE.get(k.name); if (t) { try { const f = JSON.parse(t); delete f.payload; failed.push(f); } catch (e) {} } }
  return jsonResponse({ success: true, pending: pend.keys.length, failedCount: fail.keys.length, failed });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "metabase") return handleMetabaseProxy(url);
    if (action === "getAccess") return handleGetAccess(env);
    if (action === "putAccess") return handlePutAccess(request, env);
    if (action === "getTargets") return handleGetTargets(url, env);
    if (action === "putTargets") return handlePutTargets(request, url, env);
    if (action === "getAlerts") return handleGetAlerts(request, url, env);
    if (action === "sendAlert") return handleSendAlert(request, env);
    if (action === "deleteAlert") return handleDeleteAlert(request, env);
    if (action === "sendInvites") return handleSendInvites(request, env);
    if (action === "requestAccess") return handleRequestAccess(request, env);
    if (action === "getPending") return handleGetPending(request, env);
    if (action === "resolvePending") return handleResolvePending(request, env);
    if (action === "getSettings") return handleGetSettings(env);
    if (action === "putSettings") return handlePutSettings(request, env);
    if (action === "getActivity") return handleGetActivity(request, env);
    if (action === "logActivity") return handleLogActivity(request, env);
    if (action === "checkAdminKey") return handleCheckAdminKey(request, env);
    if (action === "getConfirmedByDay") return handleGetConfirmedByDay(env);
    if (action === "getIncentiveMerchants") return handleGetIncentiveMerchants(env);
    if (action === "getMain") return handleGetMain(env);
    if (action === "getMainMeta") return handleGetMainMeta(env);
    if (action === "forceRefresh") return handleForceRefresh(request, env, ctx);
    if (action === "heartbeat") return handleHeartbeat(request, env);
    if (action === "releaseInfo") return handleReleaseInfo(env);
    if (action === "releaseDownload") return handleReleaseDownload(env);
    if (action === "releaseUpload") return handleReleaseUpload(request, env);
    if (action === "getOnlineUsers") return handleGetOnlineUsers(request, env);
    if (action === "publishComputed") return handlePublishComputed(request, env);
    if (action === "getComputed") return handleGetComputed(url, env);
    if (action === "listComputed") return handleListComputed(url, env);
    if (action === "getLastSync") return handleGetLastSync(url, env, ctx);
    if (action === "getLastSyncMeta") return handleGetLastSyncMeta(env);
    if (action === "fb") return handleFeedback(request, env, ctx);
    if (action === "getFeedbackStatus") return handleFeedbackStatus(env);

    return jsonResponse(
      {
        success: false,
        message:
          "Unknown action. This worker only serves getConfirmedByDay/getIncentiveMerchants/getMain/getMainMeta/forceRefresh/heartbeat/getOnlineUsers — the general sheet sync (getLastSync/getLastSyncMeta) now goes directly to Apps Script, and every other action (login, backup, computed publish) still goes directly to Apps Script too.",
      },
      400
    );
  },

  // Cron Trigger (كل 5 دقايق — راجع wrangler.toml) — بيسحب نسخة جديدة من
  // الشيتات اللي لسه على الـ Worker (Main/Confirmed by Day/Incentive
  // Merchants بس، v1.1.46) ويخزّنها، من غير أي يوزر مستني الرد ده. لو فشلت
  // المحاولة دي، آخر نسخة كانت متخزنة تفضل زي ما هي وتتخدم لليوزرز عادي لحد
  // المحاولة الناجحة اللي بعدها.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        refreshLastSyncCache(env).catch((err) => console.error("[scheduled refreshLastSyncCache] failed (retry next tick):", err && err.message)),
        flushFeedbackQueue(env).catch((err) => console.error("[scheduled flushFeedbackQueue] failed:", err && err.message)),
        // v1.3.48: Confirmed by Day اتنقل لـ Metabase — مفيش refresh من Google Sheets.
        refreshIncentiveMerchantsCache(env).then(
          () => env.SYNC_CACHE.delete(CACHE_KEY_INCENTIVE_MERCHANTS_ERROR).catch(() => {}),
          (err) => {
            console.error("[scheduled refresh incentiveMerchants] failed (will retry next cron tick):", err && err.message);
            return env.SYNC_CACHE.put(
              CACHE_KEY_INCENTIVE_MERCHANTS_ERROR,
              JSON.stringify({ message: (err && err.message) || String(err), at: new Date().toISOString() })
            ).catch(() => {});
          }
        ),
        // v1.3.48: Main اتنقل لـ Metabase (CSV) — مفيش refresh من Google Sheets.
      ])
    );
  },
};
