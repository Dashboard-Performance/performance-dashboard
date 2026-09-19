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
// تاب "Incentive Merchants" (Incentives Tracker) — نفس فكرة Confirmed by Day
// فوق بالظبط: بيتقرا هنا مباشرة من Google Sheets (gviz)، مستقل تمامًا عن
// Apps Script، عشان نتجنب نفس مشكلة الـ Deploy اللي واجهناها مع GID
// 964398740 قبل كده.
const CACHE_KEY_INCENTIVE_MERCHANTS = "incentive_merchants_v1";
const INCENTIVE_MERCHANTS_GID = "1548963809";
// نفس فكرة CACHE_KEY_CONFIRMED_BY_DAY_ERROR فوق.
const CACHE_KEY_INCENTIVE_MERCHANTS_ERROR = "incentive_merchants_error_v1";
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

async function refreshConfirmedByDayCache(env) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  const rawTable = await fetchGvizSheetRaw(sheetId, CONFIRMED_BY_DAY_GID);
  const nowIso = new Date().toISOString();
  const payloadText = '{"success":true,"fetchedAt":"' + nowIso + '","table":' + rawTable + "}";
  await env.SYNC_CACHE.put(CACHE_KEY_CONFIRMED_BY_DAY, payloadText);
  return { success: true, fetchedAt: nowIso, rawResponseText: payloadText };
}

async function handleGetConfirmedByDay(env) {
  try {
    let cachedText = await env.SYNC_CACHE.get(CACHE_KEY_CONFIRMED_BY_DAY);
    if (!cachedText) {
      const fresh = await refreshConfirmedByDayCache(env);
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

async function refreshIncentiveMerchantsCache(env) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  const table = await fetchGvizSheet(sheetId, INCENTIVE_MERCHANTS_GID);
  const payload = { success: true, fetchedAt: new Date().toISOString(), table };
  await env.SYNC_CACHE.put(CACHE_KEY_INCENTIVE_MERCHANTS, JSON.stringify(payload));
  return payload;
}

async function handleGetIncentiveMerchants(env) {
  try {
    let cached = await env.SYNC_CACHE.get(CACHE_KEY_INCENTIVE_MERCHANTS);
    let payload;
    if (!cached) {
      payload = await refreshIncentiveMerchantsCache(env);
    } else {
      payload = JSON.parse(cached);
    }
    const errorRaw = await env.SYNC_CACHE.get(CACHE_KEY_INCENTIVE_MERCHANTS_ERROR);
    const lastError = errorRaw ? JSON.parse(errorRaw) : null;
    return jsonResponse({ ...payload, lastError });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

async function refreshMainCache(env) {
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

  // نسجّل القراءة الخام دي كـ "مرشح" للمرة الجاية، في كل الأحوال — عشان
  // التشغيلة اللي بعدها تقارن نفسها بيها. الكائن المخزن هنا صغير جدًا
  // (بصمة نصية + رقمين)، مش الجدول الضخم نفسه، فـ JSON.parse/stringify ليه
  // رخيص جدًا.
  await env.SYNC_CACHE.put(CACHE_KEY_MAIN_CANDIDATE, JSON.stringify({ fingerprint: fp, fetchedAt: nowIso, rowCount }));

  if (fp !== null && candidate && candidate.fingerprint === fp) {
    // البصمة اتطابقت مع آخر تشغيلة — الشيت مستقر، مفيش تعديل شغال عليه
    // دلوقتي. آمن نخدّمه لليوزرز. بنبني نص الرد بـ concatenation مباشرة —
    // من غير JSON.stringify لأي object فيه الجدول الضخم.
    const payloadText = '{"success":true,"fetchedAt":"' + nowIso + '","stable":true,"table":' + rawTable + "}";
    await Promise.all([
      env.SYNC_CACHE.put(CACHE_KEY_MAIN, payloadText),
      env.SYNC_CACHE.put(CACHE_KEY_MAIN_META, JSON.stringify({ stable: true, fetchedAt: nowIso, rowCount })),
    ]);
    return { success: true, fetchedAt: nowIso, stable: true, rawResponseText: payloadText };
  }

  // لسه بيتغيّر (أو دي أول تشغيلة خالص) — منستخدمش القراءة دي، ومفيش أي
  // إعادة تخزين لنسخة قديمة (ولا حتى قراءتها) — أرخص حالة ممكنة.
  const hasExisting = await env.SYNC_CACHE.get(CACHE_KEY_MAIN).then((v) => !!v);
  if (hasExisting) return { success: true, stable: false, skippedReparse: true };

  // مفيش أي نسخة مستقرة اتسجلت قبل كده خالص (أول تشغيلة من عمر الـ Worker) —
  // مضطرين نستخدم القراءة دي زي ما هي عشان الداشبورد مايفضلش فاضي، بس
  // بعلامة stable:false توضح إنها لسه ماتأكدتش.
  const bootstrapText = '{"success":true,"fetchedAt":"' + nowIso + '","stable":false,"table":' + rawTable + "}";
  await Promise.all([
    env.SYNC_CACHE.put(CACHE_KEY_MAIN, bootstrapText),
    env.SYNC_CACHE.put(CACHE_KEY_MAIN_META, JSON.stringify({ stable: false, fetchedAt: nowIso, rowCount })),
  ]);
  return { success: true, fetchedAt: nowIso, stable: false, rawResponseText: bootstrapText };
}

async function handleGetMain(env) {
  try {
    let cached = await env.SYNC_CACHE.get(CACHE_KEY_MAIN);
    if (!cached) {
      const fresh = await refreshMainCache(env);
      if (fresh && fresh.rawResponseText) {
        return new Response(fresh.rawResponseText, { headers: corsHeaders() });
      }
      return jsonResponse(fresh);
    }
    return new Response(cached, { headers: corsHeaders() });
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
  if (email !== MANAGER_EMAIL.toLowerCase()) {
    return jsonResponse({ success: false, message: "Not authorized." }, 403);
  }
  try {
    const [main, confirmedByDay, incentiveMerchants] = await Promise.all([
      refreshMainCache(env),
      refreshConfirmedByDayCache(env),
      refreshIncentiveMerchantsCache(env),
    ]);

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
  if (requesterEmail !== MANAGER_EMAIL.toLowerCase()) {
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

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "getConfirmedByDay") return handleGetConfirmedByDay(env);
    if (action === "getIncentiveMerchants") return handleGetIncentiveMerchants(env);
    if (action === "getMain") return handleGetMain(env);
    if (action === "getMainMeta") return handleGetMainMeta(env);
    if (action === "forceRefresh") return handleForceRefresh(request, env, ctx);
    if (action === "heartbeat") return handleHeartbeat(request, env);
    if (action === "getOnlineUsers") return handleGetOnlineUsers(request, env);

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
        refreshConfirmedByDayCache(env).then(
          () => env.SYNC_CACHE.delete(CACHE_KEY_CONFIRMED_BY_DAY_ERROR).catch(() => {}),
          (err) => {
            console.error("[scheduled refresh confirmedByDay] failed (will retry next cron tick):", err && err.message);
            return env.SYNC_CACHE.put(
              CACHE_KEY_CONFIRMED_BY_DAY_ERROR,
              JSON.stringify({ message: (err && err.message) || String(err), at: new Date().toISOString() })
            ).catch(() => {});
          }
        ),
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
        refreshMainCache(env).then(
          () => env.SYNC_CACHE.delete(CACHE_KEY_MAIN_ERROR).catch(() => {}),
          (err) => {
            console.error("[scheduled refresh main] failed (will retry next cron tick):", err && err.message);
            return env.SYNC_CACHE.put(
              CACHE_KEY_MAIN_ERROR,
              JSON.stringify({ message: (err && err.message) || String(err), at: new Date().toISOString() })
            ).catch(() => {});
          }
        ),
      ])
    );
  },
};
