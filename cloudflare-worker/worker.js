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

const CACHE_KEY_PAYLOAD = "last_sync_payload_v1";
const CACHE_KEY_META = "last_sync_meta_v1";
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

// v1.1.40: باقي الـ 22 شيت (Inventory وكل حاجة تانية غير Main/Confirmed by
// Day/Incentive Merchants) بقوا بيتقروا هنا مباشرة من Google Sheets (gviz)
// بالظبط زي التلاتة فوق — بدل ما الـ Worker يستنى Apps Script (action=
// getLastSync) يعمل القراءة ويرجعها. نفس القايمة بالظبط اللي في
// LAST_SYNC_GIDS جوه backend/Code.gs (لازم تفضل متطابقة لو ضفت شيت جديد
// هناك). Apps Script نفسه فضل موجود ومطلوب بس للكتابة/تسجيل الدخول — القراءة
// بقت مستقلة تمامًا عنه.
const ALL_MIRROR_GIDS = [
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
  "22283311",    // BEGIN_INV_GID
  "548859670",   // SELLTHROUGH_NEEDED_GID
  "1409034448",  // PRODUCTS_DEBUNDLE_MAP_GID
  "1620722565",  // SINGLE_SKU_TARGETS_GID
  "1724469150",  // COGS_GID
  "2085802038",  // AVAILABILITY_LOCKING_GID
  "1298408207",  // PRODUCTS_MATCHES_GID
  "461854229",   // MERCHANT_SKU_DAILY_GID
  "620123165",   // MERCHANT_SEGMENTATION_GID
  "1289659887",  // WEEKLY_INVENTORY_GID
  "897709273",   // WAREHOUSE_REPACK_GID
  "964398740",   // CONFIRMED_BY_DAY_GID (موجود هنا كمان لأن getLastSync القديم كان شامله)
  "1548963809",  // INCENTIVE_MERCHANTS_GID (نفس الملاحظة فوق)
];
const CACHE_KEY_ALLSHEETS_CANDIDATE = "all_sheets_candidate_v1";
// نفس فكرة CACHE_KEY_MAIN_ERROR — لو refreshCache (الـ mirror العام بتاع
// getLastSyncMeta، اللي صف "General Sync" في المودال بيقراه) فشلت جوه
// scheduled()، بتتسجل هنا عشان تظهر بدل ما تختفي في console.error بس.
const CACHE_KEY_ALLSHEETS_ERROR = "all_sheets_error_v1";

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

// v1.1.40 (إعادة كتابة كاملة): بدل ما نستنى Apps Script يقرا الـ 22 شيت
// ويرجعهملنا مجمّعين (action=getLastSync)، بقينا نقراهم إحنا مباشرة من
// Google (gviz) بالظبط زي Main/Confirmed by Day/Incentive Merchants —
// Apps Script بقى مش جزء من مسار القراءة خالص. نفس فكرة الاستقرار
// المستخدمة مع Main (مقارنة بصمة كل GID مع آخر تشغيلة، فاصل 5 دقايق حقيقي
// بينهم) بس هنا لكل الـ 22 GID مع بعض: أي GID بصمته اتطابقت مع المرة اللي
// فاتت بيتحدّث، وأي GID لسه بيتغيّر بنفضل خادمين آخر نسخة مستقرة معروفة
// بتاعته لحد ما يستقر. الـ timestamp العام (fetchedAt) بيتحدث بس لو أي GID
// فعليًا اتحدّث — نفس فكرة computeSyncContentHash_ بتاعة Code.gs (عشان
// الفرونت اند miss يعملش رفرش كامل من غير داعي كل 5 دقايق).
async function refreshCache(env) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  const nowIso = new Date().toISOString();

  const results = await Promise.all(ALL_MIRROR_GIDS.map(async (gid) => {
    try {
      const raw = await fetchGvizSheet(sheetId, gid);
      const inner = raw && raw.table ? raw.table : null;
      const fp = sheetFingerprint(inner);
      return { gid, raw, fp, ok: true };
    } catch (err) {
      return { gid, ok: false, error: (err && err.message) || String(err) };
    }
  }));

  const candidateRaw = await env.SYNC_CACHE.get(CACHE_KEY_ALLSHEETS_CANDIDATE);
  const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;
  const newCandidateFingerprints = {};
  results.forEach((r) => { if (r.ok) newCandidateFingerprints[r.gid] = r.fp; });
  await env.SYNC_CACHE.put(
    CACHE_KEY_ALLSHEETS_CANDIDATE,
    JSON.stringify({ fingerprints: newCandidateFingerprints, fetchedAt: nowIso })
  );

  const existingPayloadRaw = await env.SYNC_CACHE.get(CACHE_KEY_PAYLOAD);
  const existingPayload = existingPayloadRaw ? JSON.parse(existingPayloadRaw) : null;
  const existingSheets = (existingPayload && existingPayload.sheets) || {};

  const sheets = {};
  const unstableGids = [];
  results.forEach((r) => {
    if (!r.ok) {
      if (existingSheets[r.gid]) sheets[r.gid] = existingSheets[r.gid];
      unstableGids.push(r.gid);
      return;
    }
    const prevFp = candidate && candidate.fingerprints ? candidate.fingerprints[r.gid] : undefined;
    if (r.fp !== null && prevFp !== undefined && prevFp === r.fp) {
      sheets[r.gid] = r.raw; // البصمة اتطابقت مع آخر تشغيلة — مستقر، نخدّمه
    } else if (existingSheets[r.gid]) {
      sheets[r.gid] = existingSheets[r.gid]; // لسه بيتغيّر — نفضل آخر نسخة مستقرة معروفة
      unstableGids.push(r.gid);
    } else {
      sheets[r.gid] = r.raw; // أول تشغيلة خالص لهذا الـ GID — مفيش بديل نرجعله
      unstableGids.push(r.gid);
    }
  });

  // منحدّثش fetchedAt العام غير لو حصل تغيير حقيقي في أي GID عن آخر نسخة
  // "مخدومة" فعليًا — عشان lastSyncMetaPollTick بتاع الفرونت اند ميعملش
  // رفرش كامل كل 5 دقايق من غير داعي.
  const combinedFingerprint = JSON.stringify(
    ALL_MIRROR_GIDS.map((gid) => gid + ":" + (sheets[gid] && sheets[gid].table ? sheetFingerprint(sheets[gid].table) : "null"))
  );
  const prevCombinedRaw = await env.SYNC_CACHE.get(CACHE_KEY_META);
  const prevCombined = prevCombinedRaw ? JSON.parse(prevCombinedRaw) : null;
  const contentChanged = !prevCombined || prevCombined.contentFingerprint !== combinedFingerprint;
  const effectiveFetchedAt = contentChanged || !prevCombined ? nowIso : prevCombined.fetchedAt;

  const json = { success: true, fetchedAt: effectiveFetchedAt, sheets, unstableGids };

  await env.SYNC_CACHE.put(CACHE_KEY_PAYLOAD, JSON.stringify(json));
  await env.SYNC_CACHE.put(
    CACHE_KEY_META,
    JSON.stringify({ success: true, fetchedAt: effectiveFetchedAt, unstableGids, contentFingerprint: combinedFingerprint })
  );
  return json;
}

async function handleGetLastSync(env) {
  try {
    let cached = await env.SYNC_CACHE.get(CACHE_KEY_PAYLOAD);
    if (!cached) {
      // لسه مفيش أي نسخة متخزّنة خالص (أول تشغيلة قبل أول Cron) — نسحب
      // واحدة لايف دلوقتي بدل ما نرجع فشل لليوزر الأول.
      const fresh = await refreshCache(env);
      return jsonResponse(fresh);
    }
    return new Response(cached, { headers: corsHeaders() });
  } catch (err) {
    // فشل السحب اللايف (نادر — بس لو حصل أول تشغيلة والسيرفر واقف) — مفيش
    // حاجة نرجعها، نبلغ اليوزر بوضوح.
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

async function handleGetLastSyncMeta(env) {
  try {
    let cached = await env.SYNC_CACHE.get(CACHE_KEY_META);
    if (!cached) {
      await refreshCache(env);
      cached = await env.SYNC_CACHE.get(CACHE_KEY_META);
    }
    const errorRaw = await env.SYNC_CACHE.get(CACHE_KEY_ALLSHEETS_ERROR);
    const lastError = errorRaw ? JSON.parse(errorRaw) : null;
    const parsed = cached ? JSON.parse(cached) : { success: false, message: "No cache yet" };
    return jsonResponse({ ...parsed, lastError });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
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

async function refreshConfirmedByDayCache(env) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  const table = await fetchGvizSheet(sheetId, CONFIRMED_BY_DAY_GID);
  const payload = { success: true, fetchedAt: new Date().toISOString(), table };
  await env.SYNC_CACHE.put(CACHE_KEY_CONFIRMED_BY_DAY, JSON.stringify(payload));
  return payload;
}

async function handleGetConfirmedByDay(env) {
  try {
    let cached = await env.SYNC_CACHE.get(CACHE_KEY_CONFIRMED_BY_DAY);
    let payload;
    if (!cached) {
      payload = await refreshConfirmedByDayCache(env);
    } else {
      payload = JSON.parse(cached);
    }
    const errorRaw = await env.SYNC_CACHE.get(CACHE_KEY_CONFIRMED_BY_DAY_ERROR);
    const lastError = errorRaw ? JSON.parse(errorRaw) : null;
    return jsonResponse({ ...payload, lastError });
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

// نفس sheetFingerprint_ في backend/Code.gs بالظبط — بصمة رخيصة (عدد الصفوف
// + أطوال أول/آخر صف + طول الأعمدة) بدل مقارنة كل خلية بخلية، كافية عمليًا
// لاكتشاف أي تعديل حقيقي في الشيت من غير ما تبطّئ الـ Worker.
function sheetFingerprint(table) {
  if (!table || !table.rows) return null;
  const rows = table.rows;
  const n = rows.length;
  const first = n ? JSON.stringify(rows[0]) : "";
  const last = n ? JSON.stringify(rows[n - 1]) : "";
  return n + "|" + first.length + "|" + last.length + "|" + JSON.stringify(table.cols || []).length;
}

async function refreshMainCache(env) {
  const sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID env var is not configured in wrangler.toml");
  const table = await fetchGvizSheet(sheetId, MAIN_GID);
  // ⚠️ تصحيح مهم: fetchGvizSheet بيرجع الـ wrapper الخارجي كامل
  // ({version,reqId,status,sig,table:{cols,rows}})، مش {cols,rows} مباشرة.
  // sheetFingerprint (وحساب عدد الصفوف تحت) لازم يشتغلوا على table.table
  // (المستوى الداخلي الفعلي) — كنا بنمرر الـ wrapper الخارجي غلط، فكانت
  // sheetFingerprint بترجع null على طول (table.rows مكنش موجود خالص على
  // الـ wrapper)، يعني الشرط "البصمتين متطابقتين" مستحيل يتحقق أبدًا —
  // ده كان السبب الحقيقي وراء إنها "مش بتستقر" مهما استنينا أو عملنا
  // Force Refresh.
  const innerTable = table && table.table ? table.table : null;
  const fp = sheetFingerprint(innerTable);
  const nowIso = new Date().toISOString();

  const candidateRaw = await env.SYNC_CACHE.get(CACHE_KEY_MAIN_CANDIDATE);
  const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;
  const attemptRowCount = innerTable && Array.isArray(innerTable.rows) ? innerTable.rows.length : null;

  // نسجّل القراءة الخام دي كـ "مرشح" للمرة الجاية، في كل الأحوال — عشان
  // التشغيلة اللي بعدها (كل 5 دقايق) تقارن نفسها بيها. rowCount هنا بس
  // عشان نوريه في getMainMeta كـ "آخر محاولة" حتى لو لسه ماتطابقتش —
  // عشان توضح إن الـ Worker شغال وبيحاول فعلاً، مش واقف.
  await env.SYNC_CACHE.put(CACHE_KEY_MAIN_CANDIDATE, JSON.stringify({ fingerprint: fp, fetchedAt: nowIso, rowCount: attemptRowCount }));

  if (fp !== null && candidate && candidate.fingerprint === fp) {
    // البصمة اتطابقت مع آخر تشغيلة (فاصل 5 دقايق حقيقي بينهم) — الشيت
    // مستقر، مفيش تعديل شغال عليه دلوقتي. آمن نخدّمه لليوزرز.
    const payload = { success: true, fetchedAt: nowIso, stable: true, table };
    const rowCount = attemptRowCount;
    await Promise.all([
      env.SYNC_CACHE.put(CACHE_KEY_MAIN, JSON.stringify(payload)),
      env.SYNC_CACHE.put(CACHE_KEY_MAIN_META, JSON.stringify({ stable: true, fetchedAt: nowIso, rowCount })),
    ]);
    return payload;
  }

  // لسه بيتغيّر (أو دي أول تشغيلة خالص) — منستخدمش القراءة دي. بنفضل
  // مستخدمين آخر نسخة "مستقرة" معروفة بدل ما ننشر لقطة نص-متغيرة — بس من
  // غير ما نعمل JSON.parse للنسخة القديمة (اللي ممكن تبقى عشرات الـ MB)
  // عشان بس نرجعها كـ return value محدش بيستخدمه أصلًا (الكولر الوحيد
  // اللي بيوصل هنا فعليًا هو scheduled() تحت، وهو مش بيستخدم القيمة
  // الراجعة خالص) — ده كان سبب حقيقي لتعدي الـ CPU limit وفشل الـ cron
  // بصمت كل 5 دقايق.
  const hasExisting = await env.SYNC_CACHE.get(CACHE_KEY_MAIN).then((v) => !!v);
  if (hasExisting) return { success: true, stable: false, skippedReparse: true };

  // مفيش أي نسخة مستقرة اتسجلت قبل كده خالص (أول تشغيلة من عمر الـ Worker) —
  // مضطرين نستخدم القراءة دي زي ما هي عشان الداشبورد مايفضلش فاضي، بس
  // بعلامة stable:false توضح إنها لسه ماتأكدتش.
  const bootstrapPayload = { success: true, fetchedAt: nowIso, stable: false, table };
  const bootstrapRowCount = attemptRowCount;
  await Promise.all([
    env.SYNC_CACHE.put(CACHE_KEY_MAIN, JSON.stringify(bootstrapPayload)),
    env.SYNC_CACHE.put(CACHE_KEY_MAIN_META, JSON.stringify({ stable: false, fetchedAt: nowIso, rowCount: bootstrapRowCount })),
  ]);
  return bootstrapPayload;
}

async function handleGetMain(env) {
  try {
    let cached = await env.SYNC_CACHE.get(CACHE_KEY_MAIN);
    if (!cached) {
      const fresh = await refreshMainCache(env);
      return jsonResponse(fresh);
    }
    return new Response(cached, { headers: corsHeaders() });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

// v1.1.42: كان بيستنى الأربع تحديثات مع بعض (Main + Confirmed by Day +
// Incentive Merchants + الـ General Sync بتاع الـ 22 شيت) قبل ما يرد —
// قراءة وتحليل 22 شيت (بعضهم عشرات الآلاف من الصفوف، زي Beginning Inventory)
// فوق Main (34 ألف صف) في نفس الـ request كانت بتعدّي حدود تنفيذ الـ Worker
// (CPU/duration)، فالتنفيذ كان بيتقفل فجأة من غير ما يرجع أي رد خالص — ده
// اللي المتصفح بيشوفه كـ "Failed to fetch" (نفس بالظبط سبب مشكلة getMainMeta
// القديمة، راجع تعليق refreshMainCache فوق). الحل: منستناش الـ General Sync
// (الأتقل بكتير، 22 شيت) قبل ما نرد — بنبعته لـ ctx.waitUntil() يشتغل في
// الخلفية بعد ما نرجع رد سريع، والتلاتة التانيين (كل واحد شيت واحد بس، أخف
// بكتير) بيفضلوا متستناة عادي عشان يبانوا في الرد على طول.
//
// بوابة بسيطة بإيميل الـ Manager (نفس فكرة "Worker Sync Status" في الفرونت
// اند). المهم: ده مش bypass لشرط الاستقرار — لسه بيمر بنفس منطق المقارنة
// بين بصمتين متتاليتين جوه refreshMainCache/refreshCache بالظبط، بس بيخلي
// "المتتاليتين" تحصل دلوقتي بدل ما تستنى 5 دقايق.
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

    // General Sync (22 شيت) بتشتغل في الخلفية بعد الرد — مش قبله. نسجّل
    // نجاحها/فشلها في CACHE_KEY_ALLSHEETS_ERROR زي scheduled() بالظبط عشان
    // تظهر في المودال حتى لو فشلت في الخلفية.
    const generalSyncPromise = refreshCache(env).then(
      () => env.SYNC_CACHE.delete(CACHE_KEY_ALLSHEETS_ERROR).catch(() => {}),
      (err) => {
        console.error("[forceRefresh general sync] failed:", err && err.message);
        return env.SYNC_CACHE.put(
          CACHE_KEY_ALLSHEETS_ERROR,
          JSON.stringify({ message: (err && err.message) || String(err), at: new Date().toISOString() })
        ).catch(() => {});
      }
    );
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(generalSyncPromise);
    } else {
      // fallback نادر (لو ctx مش متاح لأي سبب) — لسه أحسن من قفل الرد كله
      generalSyncPromise.catch(() => {});
    }

    // منرجعش الجداول الكاملة هنا (ممكن تبقى عشرات الـ MB) — بس ملخص خفيف
    // يورّي حصل إيه، الفرونت اند هيعمل getMainMeta/getConfirmedByDay/
    // getIncentiveMerchants/getLastSyncMeta عادي بعد كده عشان يجيب التفاصيل
    // الكاملة. الـ General Sync (lastSync) بيفضل شغال في الخلفية وقت ما
    // بيوصل الرد ده — النتيجة بتظهر في المودال بعد كام ثانية، مش فورًا.
    return jsonResponse({
      success: true,
      main: { stable: !!main.stable, fetchedAt: main.fetchedAt || null, skippedReparse: !!main.skippedReparse },
      confirmedByDay: { fetchedAt: confirmedByDay.fetchedAt || null },
      incentiveMerchants: { fetchedAt: incentiveMerchants.fetchedAt || null },
      lastSync: { started: true },
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

    if (action === "getLastSync") return handleGetLastSync(env);
    if (action === "getLastSyncMeta") return handleGetLastSyncMeta(env);
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
          "Unknown action. This worker only serves getLastSync/getLastSyncMeta/getConfirmedByDay/getIncentiveMerchants/getMain/getMainMeta/forceRefresh/heartbeat/getOnlineUsers — every other action (login, backup, computed publish) still goes directly to Apps Script.",
      },
      400
    );
  },

  // Cron Trigger (كل 5 دقايق — راجع wrangler.toml) — بيسحب نسخة جديدة من
  // Apps Script ويخزّنها، من غير أي يوزر مستني الرد ده. لو فشلت المحاولة دي
  // (Apps Script واقف وقتها)، آخر نسخة كانت متخزنة تفضل زي ما هي وتتخدم
  // لليوزرز عادي لحد المحاولة الناجحة اللي بعدها.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        refreshCache(env).then(
          () => env.SYNC_CACHE.delete(CACHE_KEY_ALLSHEETS_ERROR).catch(() => {}),
          (err) => {
            console.error("[scheduled refresh] failed (will retry next cron tick):", err && err.message);
            return env.SYNC_CACHE.put(
              CACHE_KEY_ALLSHEETS_ERROR,
              JSON.stringify({ message: (err && err.message) || String(err), at: new Date().toISOString() })
            ).catch(() => {});
          }
        ),
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
