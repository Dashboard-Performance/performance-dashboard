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
  // disallowed"). التاب ده (Confirmed by Day) مفيهوش أي عمود تاريخ أصلاً
  // (بس PRODUCT_ID/SKU_NAME/CATEGORY_L1 + أرقام)، فبدل eval بنستبدل أي
  // Date(...) لو ظهر بنص عادي (JSON صالح) — من غير ما نحتاج نفكه فعليًا
  // لتاريخ حقيقي، لأننا أصلاً مش بنستخدم قيمته.
  const jsonSafeText = match[1].replace(/Date\([^)]*\)/g, (m) => JSON.stringify(m));
  const parsed = JSON.parse(jsonSafeText);
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

    return jsonResponse(
      {
        success: false,
        message:
          "Unknown action. This worker only serves getLastSync/getLastSyncMeta/getConfirmedByDay — every other action (login, heartbeat, backup, computed publish) still goes directly to Apps Script.",
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
      ])
    );
  },
};
