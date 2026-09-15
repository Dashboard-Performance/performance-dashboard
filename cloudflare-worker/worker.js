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
// تاب "Incentive Merchants" (Incentives Tracker) — نفس فكرة Confirmed by Day
// فوق بالظبط: بيتقرا هنا مباشرة من Google Sheets (gviz)، مستقل تمامًا عن
// Apps Script، عشان نتجنب نفس مشكلة الـ Deploy اللي واجهناها مع GID
// 964398740 قبل كده.
const CACHE_KEY_INCENTIVE_MERCHANTS = "incentive_merchants_v1";
const INCENTIVE_MERCHANTS_GID = "1548963809";
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

// بيسحب نسخة جديدة من Apps Script (action=getLastSync) ويخزّنها في KV —
// النسخة الكاملة (gzBase64) وكمان نسخة خفيفة للـ meta (fetchedAt بس) عشان
// getLastSyncMeta يفضل رخيص جدًا زي ما هو أصلاً.
async function refreshCache(env) {
  const res = await fetch(`${env.APPS_SCRIPT_URL}?action=getLastSync`, {
    method: "GET",
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`Apps Script responded with status ${res.status}`);
  const json = await res.json();
  if (!json || !json.success) throw new Error((json && json.message) || "Apps Script getLastSync returned success:false");

  await env.SYNC_CACHE.put(CACHE_KEY_PAYLOAD, JSON.stringify(json));
  await env.SYNC_CACHE.put(
    CACHE_KEY_META,
    JSON.stringify({ success: true, fetchedAt: json.fetchedAt, unstableGids: json.unstableGids || [] })
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
    return new Response(cached || JSON.stringify({ success: false, message: "No cache yet" }), { headers: corsHeaders() });
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
    if (!cached) {
      const fresh = await refreshConfirmedByDayCache(env);
      return jsonResponse(fresh);
    }
    return new Response(cached, { headers: corsHeaders() });
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
    if (!cached) {
      const fresh = await refreshIncentiveMerchantsCache(env);
      return jsonResponse(fresh);
    }
    return new Response(cached, { headers: corsHeaders() });
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
  const fp = sheetFingerprint(table);
  const nowIso = new Date().toISOString();

  const candidateRaw = await env.SYNC_CACHE.get(CACHE_KEY_MAIN_CANDIDATE);
  const candidate = candidateRaw ? JSON.parse(candidateRaw) : null;

  // نسجّل القراءة الخام دي كـ "مرشح" للمرة الجاية، في كل الأحوال — عشان
  // التشغيلة اللي بعدها (كل 5 دقايق) تقارن نفسها بيها.
  await env.SYNC_CACHE.put(CACHE_KEY_MAIN_CANDIDATE, JSON.stringify({ fingerprint: fp, fetchedAt: nowIso }));

  if (fp !== null && candidate && candidate.fingerprint === fp) {
    // البصمة اتطابقت مع آخر تشغيلة (فاصل 5 دقايق حقيقي بينهم) — الشيت
    // مستقر، مفيش تعديل شغال عليه دلوقتي. آمن نخدّمه لليوزرز.
    const payload = { success: true, fetchedAt: nowIso, stable: true, table };
    const rowCount = table && table.rows && Array.isArray(table.rows) ? table.rows.length : null;
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
  const bootstrapRowCount = table && table.rows && Array.isArray(table.rows) ? table.rows.length : null;
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

// v1.1.35: بدل ما تستنى الـ cron التلقائي (كل 5 دقايق)، الأكشن ده بيسحب
// نسخة جديدة فورًا دلوقتي من التلات شيتات مع بعض ويحدّث الكاش المشترك على
// طول — أي يوزر بيفتح الداشبورد بعدها هيشوف النتيجة على طول (لو استقرت).
// بوابة بسيطة بإيميل الـ Manager (نفس فكرة "Worker Sync Status" في الفرونت
// اند). المهم: ده مش bypass لشرط الاستقرار — لسه بيمر بنفس منطق المقارنة
// بين بصمتين متتاليتين جوه refreshMainCache بالظبط، بس بيخلي "المتتاليتين"
// تحصل دلوقتي بدل ما تستنى 5 دقايق.
async function handleForceRefresh(request, env) {
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
    // منرجعش الجداول الكاملة هنا (ممكن تبقى عشرات الـ MB) — بس ملخص خفيف
    // يورّي حصل إيه، الفرونت اند هيعمل getMainMeta/getConfirmedByDay/
    // getIncentiveMerchants عادي بعد كده عشان يجيب التفاصيل الكاملة.
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
    const [metaRaw, errorRaw] = await Promise.all([
      env.SYNC_CACHE.get(CACHE_KEY_MAIN_META),
      env.SYNC_CACHE.get(CACHE_KEY_MAIN_ERROR),
    ]);
    const lastError = errorRaw ? JSON.parse(errorRaw) : null;
    if (!metaRaw) {
      return jsonResponse({ success: true, stable: false, fetchedAt: null, rowCount: null, lastError });
    }
    const meta = JSON.parse(metaRaw);
    return jsonResponse({ success: true, stable: !!meta.stable, fetchedAt: meta.fetchedAt || null, rowCount: meta.rowCount === undefined ? null : meta.rowCount, lastError });
  } catch (err) {
    return jsonResponse({ success: false, message: (err && err.message) || String(err) }, 502);
  }
}

export default {
  async fetch(request, env) {
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
    if (action === "forceRefresh") return handleForceRefresh(request, env);

    return jsonResponse(
      {
        success: false,
        message:
          "Unknown action. This worker only serves getLastSync/getLastSyncMeta/getConfirmedByDay/getIncentiveMerchants/getMain/getMainMeta/forceRefresh — every other action (login, heartbeat, backup, computed publish) still goes directly to Apps Script.",
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
        refreshCache(env).catch((err) => {
          console.error("[scheduled refresh] failed (will retry next cron tick):", err && err.message);
        }),
        refreshConfirmedByDayCache(env).catch((err) => {
          console.error("[scheduled refresh confirmedByDay] failed (will retry next cron tick):", err && err.message);
        }),
        refreshIncentiveMerchantsCache(env).catch((err) => {
          console.error("[scheduled refresh incentiveMerchants] failed (will retry next cron tick):", err && err.message);
        }),
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
