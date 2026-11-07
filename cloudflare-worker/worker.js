import { createLoop } from "./loop-api.js";
import { createUsage } from "./usage.js";
import { createMl } from "./ml.js"; // v1.17.8 — Usage Log (who opened the dashboard, when, for how long, which tabs)
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

// Metabase proxy: pure streaming passthrough (no body parsing -> negligible CPU).
// v1.16.0: the dashboard sends only the gid — the Metabase links live HERE, never in the browser code,
// and the proxy no longer forwards arbitrary URLs. Override a link with the secret METABASE_LINKS (JSON {gid: url}).
const METABASE_SOURCES = {
  "22283311": { label: "Beginning Inventory", url: "https://metabase.taager.com/public/question/d94cd9a2-79e9-4354-8b61-ba306e19a8a1.json" },
  "461854229": { label: "Merchant SKU Daily", url: "https://metabase.taager.com/public/question/fae5e3b3-770d-4263-84cd-5ec7bcb3235b.json" },
  "531154071": { label: "Products Info", url: "https://metabase.taager.com/public/question/e36159b1-ba09-4374-a982-636bd91de1df.json" },
  "548859670": { label: "Sell-through Needed", url: "https://metabase.taager.com/public/question/c56380be-b777-4785-ba01-8dac06da65b9.json" },
  "620123165": { label: "Merchant Segmentation", url: "https://metabase.taager.com/api/public/card/5761d362-9da0-4f6a-9c83-2d569d8c5f38/query/json" },
  "964398740": { label: "Confirmed by Day", url: "https://metabase.taager.com/public/question/f5b9a1ab-01b3-46b4-a8b8-cf55354fcca3.json" },
  "1304674893": { label: "New Segmentation", url: "https://metabase.taager.com/public/question/261252c6-61b8-4b74-a3d5-e3a4dd1ff2f4.json" },
  "1409034448": { label: "Products Debundle Map", url: "https://metabase.taager.com/public/question/022be39b-ece7-4252-ba69-62f034369919.json" },
  "1779314157": { label: "Products", url: "https://metabase.taager.com/public/question/7d6164a3-d064-445f-98cf-b55623a25957.json" },
  "2085802038": { label: "Availability Locking", url: "https://metabase.taager.com/public/question/6048f9a4-87b4-4a88-88d9-c2ac5e81e492.json" },
  "2099497960": { label: "Main", url: "https://metabase.taager.com/api/public/card/8ac644f8-153f-4c32-a2fb-98e72d6c9180/query/csv" },
  // v1.18.0 — Merchant Only: one row per (day x merchant x ACC_MANAGER), current month MTD + the whole previous month. ACM pages read it.
  "7100000001": { label: "Merchant Only", url: "https://metabase.taager.com/public/question/45b35431-c252-4a93-8021-41ae1fc53d8e.csv" },
  // v1.18.0 — Product Only: one row per (day x product x IS_PRIMARY), current month MTD + the whole previous month. Product / category pages read it.
  "7100000002": { label: "Product Only", url: "https://metabase.taager.com/public/question/b55fc346-3f40-4e09-b194-ecdb55b7037b.csv" }
};
function metabaseLink(env, gid) {
  if (env.METABASE_LINKS) { try { const o = JSON.parse(env.METABASE_LINKS); if (o[gid]) return String(o[gid]); } catch (e) {} }
  return METABASE_SOURCES[gid] ? METABASE_SOURCES[gid].url : "";
}
// v1.17.0 — "last good copy" guard for every Metabase source.
// When Metabase fails, times out, or returns a result that suddenly shrank (a partial / broken refresh),
// the dashboard (and the Command Loop engine) get the LAST GOOD copy instead, marked with
//   X-Data-Source: cache · X-Cached-At: <when it was fetched> · X-Cache-Reason: <why>
// so the numbers never collapse at once. A smaller result is accepted only after it stays the same for
// MB_ACCEPT_SMALLER_HOURS (a real change in the query), or when an owner accepts it (action=metabaseAccept).
const MB_TOTAL_DROP = 0.15;        // total rows fell by more than 15% → suspicious
const MB_MONTH_DROP = 0.10;        // Main: a month (seen in the last good copy) lost more than 10% of its rows → suspicious
const MB_ACCEPT_SMALLER_HOURS = 12;
const MB_SAVE_EVERY_MS = 10 * 60 * 1000;
const MB_FETCH_TIMEOUT_MS = 170000;
// v1.18.0 — PREWARM: the cron fetches every Metabase source every MB_PREWARM_EVERY_MIN minutes and keeps the copy in KV, and the
// dashboard is served that copy straight away while it is younger than MB_FRESH_MS — so opening the dashboard no longer waits on
// Metabase running every query live (that took minutes). The Refresh button asks for live (&live=1).
const MB_PREWARM_EVERY_MIN = 10;
const MB_FRESH_MS = 15 * 60 * 1000;
const MB_PREWARM_PARALLEL = 4;
const MB_MONTHS_GIDS = { "2099497960": true, "7100000001": true, "7100000002": true }; // CSV sources with a date in the first column (per-month check)
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function mbMonthOf(txt) {
  const t = String(txt || "").trim();
  let m = /^(\d{4})-(\d{1,2})/.exec(t); if (m) return m[1] + "-" + m[2].padStart(2, "0");
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); if (m) return m[3] + "-" + m[1].padStart(2, "0");
  m = /^([A-Za-z]{3})[a-z]*\.?\s+\d{1,2},?\s+(\d{4})/.exec(t); if (m && MON[m[1].toLowerCase()]) return m[2] + "-" + String(MON[m[1].toLowerCase()]).padStart(2, "0");
  return "";
}
// Cheap shape of a Metabase answer, straight from the bytes: { ok, kind, rows, months{YYYY-MM: rows}, why }
function mbShape(bytes, csv, withMonths) {
  const n = bytes.length; if (!n) return { ok: false, why: "empty answer" };
  let i = 0; while (i < n && (bytes[i] === 0xEF || bytes[i] === 0xBB || bytes[i] === 0xBF || bytes[i] <= 32)) i++;
  const c0 = bytes[i];
  if (csv) {
    if (c0 === 60 || c0 === 123 || c0 === 91) return { ok: false, why: "not CSV (Metabase error page / JSON)" };
    let rows = -1, start = i; const months = {}, dec = new TextDecoder(), seen = new Map();
    for (let j = i; j <= n; j++) {
      if (j === n || bytes[j] === 10) {
        if (j > start + 1) {
          rows++;
          if (withMonths && rows > 0) {
            let a = start, b; if (bytes[a] === 34) { a++; b = a; while (b < j && bytes[b] !== 34) b++; } else { b = a; while (b < j && bytes[b] !== 44) b++; }
            const raw = dec.decode(bytes.subarray(a, Math.min(b, a + 40)));
            let mo = seen.get(raw); if (mo === undefined) { mo = mbMonthOf(raw); seen.set(raw, mo); }
            if (mo) months[mo] = (months[mo] || 0) + 1;
          }
        }
        start = j + 1;
      }
    }
    if (rows < 1) return { ok: false, why: "no data rows" };
    return { ok: true, kind: "csv", rows, months: withMonths ? months : null };
  }
  if (c0 !== 91) {
    if (c0 === 123) { // {"data":{"rows":[...]}} (query/json of a card) or an error object
      const head = new TextDecoder().decode(bytes.subarray(i, Math.min(n, i + 400)));
      if (/"(error|status)"\s*:\s*"(failed|.*error)/i.test(head) || !/"rows"/.test(head)) return { ok: false, why: "Metabase error: " + head.replace(/\s+/g, " ").slice(0, 120) };
    } else return { ok: false, why: "not JSON" };
  }
  // count objects at depth 1 of the top-level array (or depth 3 inside data.rows arrays)
  let depth = 0, inStr = false, esc = false, rows = 0;
  for (let j = i; j < n; j++) {
    const ch = bytes[j];
    if (inStr) { if (esc) esc = false; else if (ch === 92) esc = true; else if (ch === 34) inStr = false; continue; }
    if (ch === 34) inStr = true;
    else if (ch === 91 || ch === 123) { if (depth === 1 && (ch === 123 || ch === 91) && c0 === 91) rows++; depth++; }
    else if (ch === 93 || ch === 125) depth--;
  }
  if (c0 === 123) { const t = new TextDecoder().decode(bytes); try { const j = JSON.parse(t); rows = j && j.data && Array.isArray(j.data.rows) ? j.data.rows.length : 0; } catch (e) { return { ok: false, why: "broken JSON" }; } }
  if (rows < 1) return { ok: false, why: "no data rows" };
  return { ok: true, kind: "json", rows, months: null };
}
// Is the new answer a sudden collapse vs the last good copy? → reason text, or "" when fine.
// Sources that show the CURRENT month only (they restart from ~0 on the 1st): a smaller answer in a new calendar month (Cairo) is normal, not a failure.
const MB_MONTH_RESET_GIDS = { "620123165": true }; // Merchant Segmentation
function cairoMonthOf(ms) { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date(ms)); } catch (e) { return new Date(ms).toISOString().slice(0, 7); } }
function mbShrunk(shape, good, gid) {
  if (!good || !good.rows) return "";
  if (MB_MONTH_RESET_GIDS[gid] && good.at && cairoMonthOf(Date.parse(good.at)) < cairoMonthOf(Date.now())) return "";   // the month changed since the last good copy
  if (shape.months && good.months) {
    const ks = Object.keys(good.months).sort(), oldest = ks[0];
    for (const k of ks) {
      if (k === oldest && ks.length > 1) continue; // the oldest month may roll out of the query window
      const was = good.months[k], now = shape.months[k] || 0;
      if (was >= 50 && now < was * (1 - MB_MONTH_DROP)) return k + " rows fell from " + was.toLocaleString("en-US") + " to " + now.toLocaleString("en-US");
    }
    // The query window moves with the calendar ("previous month + this month so far"): on the 1st the whole older month drops out, which is not a failure.
    // So the total is compared only over the months the new answer still covers.
    const nk = Object.keys(shape.months).sort();
    if (nk.length) {
      const inWindow = ks.filter((k) => k >= nk[0]).reduce((a, k) => a + good.months[k], 0);
      if (inWindow > 0 && shape.rows < inWindow * (1 - MB_TOTAL_DROP)) return "rows fell from " + inWindow.toLocaleString("en-US") + " to " + shape.rows.toLocaleString("en-US");
      return "";
    }
  }
  if (shape.rows < good.rows * (1 - MB_TOTAL_DROP)) return "rows fell from " + good.rows.toLocaleString("en-US") + " to " + shape.rows.toLocaleString("en-US");
  return "";
}
async function mbGunzip(buf) { return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(); }
async function mbGzipBytes(bytes) { return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(); }
// → { gz?:ArrayBuffer (cached copy, gzip), bytes?:Uint8Array (live), contentType, source:"live"|"cache", cachedAt, reason, status }
async function metabaseGuarded(env, gid, opts) {
  opts = opts || {};
  const target = metabaseLink(env, gid); if (!target) return { status: 404 };
  const csv = /\/csv(\?|$)|\.csv(\?|$)/i.test(target), metaKey = "mb:meta:" + gid, bodyKey = "mb:good:" + gid, susKey = "mb:sus:" + gid;
  const kv = env.SYNC_CACHE;
  let good = null; try { good = JSON.parse((await kv.get(metaKey)) || "null"); } catch (e) {}
  let bytes = null, ct = "", why = "";
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), MB_FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(target, { redirect: "follow", signal: ac.signal });
      ct = r.headers.get("Content-Type") || (csv ? "text/csv" : "application/json");
      if (!r.ok) why = "Metabase HTTP " + r.status; else bytes = new Uint8Array(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  } catch (e) { why = "Metabase did not answer (" + ((e && e.name === "AbortError") ? "timeout" : (e && e.message) || "network") + ")"; }
  let shape = null;
  if (bytes) { shape = mbShape(bytes, csv, !!MB_MONTHS_GIDS[gid]); if (!shape.ok) why = shape.why; }
  if (shape && shape.ok) {
    const shrunk = mbShrunk(shape, good, gid);
    if (shrunk) {
      // the same smaller answer for MB_ACCEPT_SMALLER_HOURS → accept it as the new normal
      let sus = null; try { sus = JSON.parse((await kv.get(susKey)) || "null"); } catch (e) {}
      const now = Date.now();
      if (!sus || Math.abs(sus.rows - shape.rows) > Math.max(5, sus.rows * 0.02)) { sus = { first: now, rows: shape.rows, why: shrunk }; await kv.put(susKey, JSON.stringify(sus)); }
      // v1.18.0 — a ONE-row answer is a broken export (Metabase's .json/.csv started returning only the first row of
      // Beginning Inventory on 1 Nov while the question itself shows every row), never a real change: it is not auto-accepted
      // after MB_ACCEPT_SMALLER_HOURS. An owner can still accept it on purpose (action=metabaseAccept).
      const brokenExport = shape.rows <= 1 && good.rows > 1;
      if ((brokenExport || now - sus.first < MB_ACCEPT_SMALLER_HOURS * 3600e3) && !(await kv.get("mb:accept:" + gid))) why = "incomplete answer (" + shrunk + (brokenExport ? " — one row only, not auto-accepted" : "") + ")";
    }
  }
  if (!why && bytes) {
    // healthy → keep it as the last good copy (at most every 10 minutes, or right away when it changed)
    const changed = !good || good.rows !== shape.rows || good.size !== bytes.length;
    if (opts.forceSave || changed || !good.at || Date.now() - Date.parse(good.at) > MB_SAVE_EVERY_MS) {
      try {
        const gz = await mbGzipBytes(bytes);
        if (gz.byteLength < 24 * 1024 * 1024) {
          await kv.put(bodyKey, gz);
          await kv.put(metaKey, JSON.stringify({ at: new Date().toISOString(), rows: shape.rows, months: shape.months, size: bytes.length, ct }));
          await kv.delete(susKey); await kv.delete("mb:accept:" + gid);
        }
      } catch (e) { console.warn("[metabase guard] could not save last good copy of " + gid + ":", e && e.message); }
    }
    return { bytes, contentType: ct, source: "live", status: 200, rows: shape.rows };
  }
  // problem → last good copy if we have one
  const gz = good ? await kv.get(bodyKey, { type: "arrayBuffer" }) : null;
  if (gz) {
    await kv.put("mb:last-problem:" + gid, JSON.stringify({ at: new Date().toISOString(), why, rows: shape && shape.ok ? shape.rows : null }));
    return { gz, contentType: good.ct || ct || (csv ? "text/csv" : "application/json"), source: "cache", cachedAt: good.at, reason: why, status: 200, rows: good.rows };
  }
  // nothing saved yet → pass the live answer through (or the error)
  if (bytes) return { bytes, contentType: ct, source: "live", status: 200, reason: why };
  return { status: 502, reason: why };
}
// The copy the prewarm cron (or the last live call) saved, if it is younger than MB_FRESH_MS. null = go live.
async function metabaseFresh(env, gid) {
  let good = null; try { good = JSON.parse((await env.SYNC_CACHE.get("mb:meta:" + gid)) || "null"); } catch (e) {}
  if (!good || !good.at || Date.now() - Date.parse(good.at) > MB_FRESH_MS) return null;
  if (await env.SYNC_CACHE.get("mb:sus:" + gid)) return null;                 // something looked wrong last time → let the guard decide live
  const gz = await env.SYNC_CACHE.get("mb:good:" + gid, { type: "arrayBuffer" });
  if (!gz) return null;
  return { gz, contentType: good.ct || "application/octet-stream", source: "prewarmed", fetchedAt: good.at, status: 200, rows: good.rows };
}
// Cron: refresh every source's saved copy. A KV lock keeps two runs from overlapping when Metabase is slow.
async function prewarmMetabase(env, force) {
  const minute = new Date().getUTCMinutes();
  if (!force && minute % MB_PREWARM_EVERY_MIN !== 0) return { skipped: "not this minute" };
  if (!env.SYNC_CACHE) return { skipped: "no KV" };
  if (await env.SYNC_CACHE.get("mb:prewarm:lock")) return { skipped: "already running" };
  await env.SYNC_CACHE.put("mb:prewarm:lock", new Date().toISOString(), { expirationTtl: 14 * 60 });
  const gids = Object.keys(METABASE_SOURCES), out = {};
  try {
    let i = 0;
    const worker = async () => {
      while (i < gids.length) {
        const gid = gids[i++], t0 = Date.now();
        try { const g = await metabaseGuarded(env, gid, { forceSave: true }); out[gid] = { source: g.source || "none", rows: g.rows || 0, ms: Date.now() - t0, reason: g.reason || "" }; }
        catch (e) { out[gid] = { error: (e && e.message) || String(e), ms: Date.now() - t0 }; }
      }
    };
    await Promise.all(Array.from({ length: MB_PREWARM_PARALLEL }, worker));
    await env.SYNC_CACHE.put("mb:prewarm:last", JSON.stringify({ at: new Date().toISOString(), sources: out }));
    return { ok: true, sources: out };
  } finally {
    await env.SYNC_CACHE.delete("mb:prewarm:lock").catch(() => {});
  }
}
async function handleMetabaseProxy(url, env) {
  const gid = String(url.searchParams.get("gid") || "");
  if (!metabaseLink(env, gid)) return jsonResponse({ success: false, message: "unknown source" }, 404);
  const live = url.searchParams.get("live") === "1";
  const g = (!live && await metabaseFresh(env, gid)) || await metabaseGuarded(env, gid);
  const h = corsHeaders();
  h["Cache-Control"] = "no-store, no-transform";
  h["X-Data-Source"] = g.source || "none";
  if (g.cachedAt) h["X-Cached-At"] = g.cachedAt;
  if (g.fetchedAt) h["X-Fetched-At"] = g.fetchedAt;
  if (g.reason) h["X-Cache-Reason"] = String(g.reason).replace(/[^\x20-\x7E]/g, " ").slice(0, 200);
  if (g.status !== 200) return new Response(JSON.stringify({ success: false, message: g.reason || "Metabase failed" }), { status: g.status || 502, headers: h });
  h["Content-Type"] = g.contentType;
  if (g.gz) { h["Content-Encoding"] = "gzip"; return new Response(g.gz, { status: 200, headers: h, encodeBody: "manual" }); }
  return new Response(g.bytes, { status: 200, headers: h });
}
// Same thing for code inside the Worker (Command Loop engine): a plain Response + where it came from.
async function metabaseResponse(env, gid) {
  const g = await metabaseGuarded(env, gid);
  if (g.status !== 200) throw new Error(g.reason || "Metabase failed (gid " + gid + ")");
  const body = g.gz ? await mbGunzip(g.gz) : g.bytes;
  const r = new Response(body, { headers: { "Content-Type": g.contentType || "application/octet-stream" } });
  r.dataSource = { source: g.source, cachedAt: g.cachedAt || null, reason: g.reason || "" };
  return r;
}
// Owner: "the smaller answer is right — use it now" (e.g. the query was changed on purpose).
async function handleMetabaseAccept(url, env) {
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase(), gid = String(url.searchParams.get("gid") || "");
  if (!isOwnerEmail(email)) return jsonResponse({ success: false, message: "Not authorized." }, 403);
  if (!metabaseLink(env, gid)) return jsonResponse({ success: false, message: "unknown source" }, 404);
  await env.SYNC_CACHE.put("mb:accept:" + gid, "1", { expirationTtl: 3600 });
  return jsonResponse({ success: true, message: "The next answer for " + gid + " will be accepted as the new normal." });
}
// v1.17.0 — Decline Matches daily email, sent BY THE DASHBOARD (not from a personal Gmail).
// The cron (every minute) checks Cairo time; between 12:00 and 14:59 it sends once per day:
// Apps Script builds the email (same data + design as before) → the Worker sends it with Resend
// from MAIL_FROM's address (mail.taager.app). If Resend fails it falls back to the old relay.
// Turn off with DECLINE_DIGEST = "off" in wrangler.toml.
const DIGEST_HOUR = 12, DIGEST_LAST_HOUR = 14, DIGEST_RETRY_MS = 15 * 60 * 1000, DIGEST_MAX_TRIES = 3;
function cairoNowParts(d) {
  const p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(d || new Date()).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour) };
}
// DECLINE_DIGEST: "test" = only DIGEST_TEST_TO gets it (default youssef.hanafy@taager.com), the team keeps getting the old email;
// "on" = the whole team, from the dashboard; "off" = nothing.
function digestMode(env) { const m = String(env.DECLINE_DIGEST || "test").trim().toLowerCase(); return m === "on" || m === "off" ? m : "test"; }
function digestTestTo(env) { return String(env.DIGEST_TEST_TO || "youssef.hanafy@taager.com").trim().toLowerCase(); }
function digestFrom(env) {
  if (env.DIGEST_FROM) return env.DIGEST_FROM;
  const m = String(env.MAIL_FROM || "").match(/<([^>]+)>/), addr = m ? m[1] : String(env.MAIL_FROM || "").trim();
  return addr ? "Marketplace Dashboard <" + addr + ">" : "";
}
async function sendDeclineDigest(env, opts) {
  opts = opts || {};
  const test = opts.test != null ? !!opts.test : digestMode(env) !== "on";
  const now = cairoNowParts(opts.now), key = "digest:decline:" + (opts.force ? "manual:" : "") + (test ? "test:" : "") + now.date;
  let st = null; try { st = JSON.parse((await env.SYNC_CACHE.get(key)) || "null"); } catch (e) {}
  if (!opts.force) {
    if (digestMode(env) === "off") return { skipped: "off" };
    if (now.hour < DIGEST_HOUR || now.hour > DIGEST_LAST_HOUR) return { skipped: "time" };
    if (st && (st.state === "sent" || st.state === "empty")) return { skipped: "done" };
    if (st && st.state === "running" && Date.now() - Date.parse(st.at) < 20 * 60 * 1000) return { skipped: "running" };
    if (st && st.state === "failed" && ((st.tries || 0) >= DIGEST_MAX_TRIES || Date.now() - Date.parse(st.at) < DIGEST_RETRY_MS)) return { skipped: "wait" };
  }
  const tries = ((st && st.tries) || 0) + 1, put = (o) => env.SYNC_CACHE.put(key, JSON.stringify(Object.assign({ date: now.date, tries, by: opts.by || "schedule", test }, o)), { expirationTtl: 4 * 86400 })
    .then(() => env.SYNC_CACHE.put("digest:decline:last", JSON.stringify(Object.assign({ date: now.date, tries, by: opts.by || "schedule", test }, o)), { expirationTtl: 30 * 86400 }));
  await put({ state: "running", at: new Date().toISOString() });
  try {
    const b = await callAppsScriptPost(env, { action: "decline_digest_build", serviceKey: env.SERVICE_KEY || "", test });
    if (!b || b.success !== true) throw new Error((b && (b.message || b.error)) || "Apps Script did not build the email");
    if (b.empty) { await put({ state: "empty", at: new Date().toISOString(), note: "No declining matches — nothing sent." }); return { state: "empty" }; }
    let to = (b.recipients || []).map((x) => String(x).trim().toLowerCase()).filter((x) => /@taager\.com$/.test(x));
    if (test) { to = [opts.testTo || digestTestTo(env)].filter((x) => /@taager\.com$/.test(x)); b.subject = "[TEST] " + b.subject; }
    if (!to.length) throw new Error("No recipients");
    let via = "", why = "";
    const from = digestFrom(env);
    if (env.RESEND_API_KEY && from) {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: b.subject, html: b.html, reply_to: env.DIGEST_REPLY_TO || undefined }) });
      if (r.ok) via = "dashboard"; else why = "Resend HTTP " + r.status + " " + (await r.text()).slice(0, 200);
    } else why = "RESEND_API_KEY / MAIL_FROM not set";
    if (!via) {
      const rr = await callAppsScriptPost(env, { action: "decline_digest_relay", serviceKey: env.SERVICE_KEY || "", subject: b.subject, html: b.html, testTo: test ? to[0] : undefined });
      if (!rr || rr.success !== true) throw new Error(why + " · relay: " + ((rr && (rr.message || rr.error)) || "failed"));
      via = "relay";
    }
    const done = { state: "sent", at: new Date().toISOString(), via, rows: b.rows, recipients: to.length, to: test ? to : undefined, subject: b.subject, note: why || undefined };
    await put(done);
    return done;
  } catch (e) {
    const fail = { state: "failed", at: new Date().toISOString(), message: String((e && e.message) || e).slice(0, 400) };
    await put(fail);
    return fail;
  }
}
async function handleDeclineDigestStatus(env) {
  let last = null; try { last = JSON.parse((await env.SYNC_CACHE.get("digest:decline:last")) || "null"); } catch (e) {}
  const mode = digestMode(env);
  return jsonResponse({ success: true, mode, on: mode !== "off", testTo: mode === "test" ? digestTestTo(env) : undefined, hour: DIGEST_HOUR + ":00 Cairo", from: digestFrom(env), resend: !!env.RESEND_API_KEY, last });
}
async function handleDeclineDigestSend(request, url, env) {
  // who is asking: the signed-in staff session (the email in the link is only used when the staff gate is off)
  let email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (staffGateOn(env)) { const ss = await staffSession(request, url, env, "declineDigestSend"); email = ss && ss.e ? String(ss.e).toLowerCase() : ""; }
  const test = url.searchParams.get("test") === "1" || digestMode(env) !== "on";
  if (!isOwnerEmail(email)) return jsonResponse({ success: false, message: "Not authorized." }, 403);
  let last = null; try { last = JSON.parse((await env.SYNC_CACHE.get("digest:decline:last")) || "null"); } catch (e) {}
  if (last && last.state === "running" && Date.now() - Date.parse(last.at) < 3 * 60 * 1000) return jsonResponse({ success: false, message: "Already sending — wait a minute." }, 429);
  const out = await sendDeclineDigest(env, { force: true, by: email, test, testTo: email });
  return jsonResponse(Object.assign({ success: out.state === "sent" || out.state === "empty" }, out));
}

// v1.17.0 — Planner DOH (Single SKUs) copied into the planning Google Sheet every day at 11:00 Cairo.
// The Apps Script computes the table (same rules as the dashboard page) and writes it; the Worker only times it.
// Retries every 15 min (max 3 tries) until 13:59. Off with PLANNER_DOH_EXPORT = "off".
const PDOH_HOUR = 11, PDOH_LAST_HOUR = 13;
async function runPlannerDohExport(env, opts) {
  opts = opts || {};
  const now = cairoNowParts(opts.now), key = "export:plannerdoh:" + (opts.force ? "manual:" : "") + now.date;
  let st = null; try { st = JSON.parse((await env.SYNC_CACHE.get(key)) || "null"); } catch (e) {}
  if (!opts.force) {
    if (String(env.PLANNER_DOH_EXPORT || "on").toLowerCase() === "off") return { skipped: "off" };
    if (now.hour < PDOH_HOUR || now.hour > PDOH_LAST_HOUR) return { skipped: "time" };
    if (st && st.state === "done") return { skipped: "done" };
    if (st && st.state === "running" && Date.now() - Date.parse(st.at) < 20 * 60 * 1000) return { skipped: "running" };
    if (st && st.state === "failed" && ((st.tries || 0) >= 3 || Date.now() - Date.parse(st.at) < 15 * 60 * 1000)) return { skipped: "wait" };
  }
  const tries = ((st && st.tries) || 0) + 1;
  const put = (o) => { const v = JSON.stringify(Object.assign({ date: now.date, tries, by: opts.by || "schedule" }, o)); return env.SYNC_CACHE.put(key, v, { expirationTtl: 4 * 86400 }).then(() => env.SYNC_CACHE.put("export:plannerdoh:last", v, { expirationTtl: 30 * 86400 })); };
  await put({ state: "running", at: new Date().toISOString() });
  try {
    const payload = await pdohLoad(env);
    if (!payload) throw new Error("The dashboard has not sent a Planner DOH table yet — open Supply Chain → Planner DOH once and it will.");
    const r = await pdohWrite(env, payload);
    // sentAt = when the dashboard last sent this table; the daily run only rewrites what it was given.
    const done = { state: "done", at: new Date().toISOString(), rows: r.rows, yday: r.yday, sentAt: payload.sentAt || "" };
    await put(done); return done;
  } catch (e) {
    const fail = { state: "failed", at: new Date().toISOString(), message: String((e && e.message) || e).slice(0, 400) };
    await put(fail); return fail;
  }
}
async function handlePlannerDohExport(request, url, env) {
  let email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (staffGateOn(env)) { const ss = await staffSession(request, url, env, "plannerDohExport"); email = ss && ss.e ? String(ss.e).toLowerCase() : ""; }
  if (url.searchParams.get("run") !== "1") { let last = null; try { last = JSON.parse((await env.SYNC_CACHE.get("export:plannerdoh:last")) || "null"); } catch (e) {} return jsonResponse({ success: true, hour: PDOH_HOUR + ":00 Cairo", on: String(env.PLANNER_DOH_EXPORT || "on").toLowerCase() !== "off", last }); }
  if (!isOwnerEmail(email)) return jsonResponse({ success: false, message: "Not authorized." }, 403);
  const out = await runPlannerDohExport(env, { force: true, by: email });
  return jsonResponse(Object.assign({ success: out.state === "done" }, out));
}

// v1.17.0 — Supply conversion (Supply Chain) copied into its own planning sheet every day at 11:30 Cairo.
// Half an hour after Planner DOH and before the Decline email, so two Apps Script runs never overlap.
// The Apps Script builds and writes the table (action supply_conversion_export); the Worker only times it.
// Retries every 15 min (max 3 tries) until 13:59. Off with SUPPLY_CONVERSION_EXPORT = "off".
const PSC_AT_MIN = 11 * 60 + 30, PSC_LAST_MIN = 13 * 60 + 59;
function cairoMinutes(d) {
  const p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d || new Date()).forEach((x) => { p[x.type] = x.value; });
  return Number(p.hour) * 60 + Number(p.minute);
}
async function runSupplyConversionExport(env, opts) {
  opts = opts || {};
  const now = cairoNowParts(opts.now), mins = cairoMinutes(opts.now);
  const key = "export:supplyconv:" + (opts.force ? "manual:" : "") + now.date;
  let st = null; try { st = JSON.parse((await env.SYNC_CACHE.get(key)) || "null"); } catch (e) {}
  if (!opts.force) {
    if (String(env.SUPPLY_CONVERSION_EXPORT || "on").toLowerCase() === "off") return { skipped: "off" };
    if (mins < PSC_AT_MIN || mins > PSC_LAST_MIN) return { skipped: "time" };
    if (st && st.state === "done") return { skipped: "done" };
    if (st && st.state === "running" && Date.now() - Date.parse(st.at) < 20 * 60 * 1000) return { skipped: "running" };
    if (st && st.state === "failed" && ((st.tries || 0) >= 3 || Date.now() - Date.parse(st.at) < 15 * 60 * 1000)) return { skipped: "wait" };
  }
  const tries = ((st && st.tries) || 0) + 1;
  const put = (o) => { const v = JSON.stringify(Object.assign({ date: now.date, tries, by: opts.by || "schedule" }, o)); return env.SYNC_CACHE.put(key, v, { expirationTtl: 4 * 86400 }).then(() => env.SYNC_CACHE.put("export:supplyconv:last", v, { expirationTtl: 30 * 86400 })); };
  await put({ state: "running", at: new Date().toISOString() });
  try {
    const r = await callAppsScriptPost(env, { action: "supply_conversion_export", serviceKey: env.SERVICE_KEY || "" });
    if (!r || r.success !== true) throw new Error((r && (r.message || r.error)) || "Apps Script did not write the sheet");
    const done = { state: "done", at: new Date().toISOString(), month: r.month, skus: r.skus };
    await put(done); return done;
  } catch (e) {
    const fail = { state: "failed", at: new Date().toISOString(), message: String((e && e.message) || e).slice(0, 400) };
    await put(fail); return fail;
  }
}
async function handleSupplyConversionExport(request, url, env) {
  let email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (staffGateOn(env)) { const ss = await staffSession(request, url, env, "supplyConversionExport"); email = ss && ss.e ? String(ss.e).toLowerCase() : ""; }
  if (url.searchParams.get("run") !== "1") {
    let last = null; try { last = JSON.parse((await env.SYNC_CACHE.get("export:supplyconv:last")) || "null"); } catch (e) {}
    return jsonResponse({ success: true, at: "11:30 Cairo", on: String(env.SUPPLY_CONVERSION_EXPORT || "on").toLowerCase() !== "off", last });
  }
  if (!isOwnerEmail(email)) return jsonResponse({ success: false, message: "Not authorized." }, 403);
  const out = await runSupplyConversionExport(env, { force: true, by: email });
  return jsonResponse(Object.assign({ success: out.state === "done" }, out));
}

// v1.17.0 — Supply Chain: ACTUAL returns (warehouse scans, "Product is good") from the Return_Archive_YYYY-MM sheet,
// read by the Apps Script backend (action actual_returns). Cached 20 min; a failed or suddenly smaller answer keeps the last good copy.
const RET_FRESH_MS = 20 * 60 * 1000;
async function handleActualReturns(url, env) {
  const now = new Date(), cairo = new Date(now.getTime() + 2 * 3600e3);
  let month = String(url.searchParams.get("month") || "");
  if (!/^\d{4}-\d{2}$/.test(month)) month = cairo.toISOString().slice(0, 7);
  const key = "returns:actual:" + month;
  let good = null; try { good = JSON.parse((await env.SYNC_CACHE.get(key)) || "null"); } catch (e) {}
  const force = url.searchParams.get("refresh") === "1";
  if (good && !force && Date.now() - Date.parse(good.at) < RET_FRESH_MS) return jsonResponse(Object.assign({ success: true, source: "live" }, good));
  let why = "";
  if (!env.APPS_SCRIPT_URL) why = "APPS_SCRIPT_URL is not set on the Worker";
  else {
    try {
      const j = await callAppsScriptPost(env, { action: "actual_returns", serviceKey: env.SERVICE_KEY || "", month });
      if (!j || !j.success) why = (j && (j.message || j.error)) || "Apps Script failed";
      else if (good && good.total > 0 && (j.total || 0) < good.total * 0.85) why = "returns total fell from " + Math.round(good.total).toLocaleString("en-US") + " to " + Math.round(j.total || 0).toLocaleString("en-US");
      else {
        const fresh = { at: new Date().toISOString(), month, file: j.file || "", fileUpdated: j.fileUpdated || null, lastScan: j.lastScan || null, rows: j.rows || 0, total: j.total || 0, skus: j.skus || {} };
        await env.SYNC_CACHE.put(key, JSON.stringify(fresh));
        return jsonResponse(Object.assign({ success: true, source: "live" }, fresh));
      }
    } catch (e) { why = "Apps Script did not answer (" + ((e && e.message) || "network") + ")"; }
  }
  if (good) return jsonResponse(Object.assign({ success: true, source: "cache", cachedAt: good.at, reason: why }, good));
  return jsonResponse({ success: false, month, message: why }, 502);
}
async function handleMetabaseStatus(env) {
  const out = {};
  for (const gid of Object.keys(METABASE_SOURCES)) {
    const [m, p] = await Promise.all([env.SYNC_CACHE.get("mb:meta:" + gid), env.SYNC_CACHE.get("mb:last-problem:" + gid)]);
    const meta = m ? JSON.parse(m) : null;
    out[gid] = { label: METABASE_SOURCES[gid].label, lastGood: meta ? { at: meta.at, rows: meta.rows } : null, lastProblem: p ? JSON.parse(p) : null };
  }
  let prewarm = null; try { prewarm = JSON.parse((await env.SYNC_CACHE.get("mb:prewarm:last")) || "null"); } catch (e) {}
  return jsonResponse({ success: true, sources: out, prewarm: prewarm ? { at: prewarm.at, everyMin: MB_PREWARM_EVERY_MIN, freshMin: MB_FRESH_MS / 60000 } : null });
}

// ---------------------------------------------------------------------------
// v1.4.0 — Roles/Access + Targets uploaded from the dashboard (stored in KV).
// Reads are public (same as the dashboard data); writes need X-Admin-Key ==
// env.ADMIN_KEY (wrangler secret put ADMIN_KEY). Values are passed through as
// raw text (no JSON parse) to stay within the free-plan CPU budget.
// ---------------------------------------------------------------------------
const TOWER_TARGET_TYPES = ["merchants", "acm", "category", "salesplan", "singlesku", "meta", "supplyplan", "segplan"]; // v1.17: + monthly plans (js/plans.js)
// v1.15.17 — each target type is stored per month: "<type>.<YYYY-MM>" (e.g. "merchants.2026-11", "meta.2026-11").
// The plain "<type>" key (no month) is the older single upload and stays readable as a fallback.
function towerTargetTypeOk(type) {
  const m = /^([a-z]+)(?:\.(\d{4})-(0[1-9]|1[0-2]))?$/.exec(type || "");
  return !!m && TOWER_TARGET_TYPES.indexOf(m[1]) >= 0;
}
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
// v1.16.0: Admin / Country Manager (any role with full access) can only belong to @taager.com emails.
async function handlePutAccess(request, env) {
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
  const text = await request.clone().text();
  let cfg; try { cfg = JSON.parse(text); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
  const roles = (cfg && cfg.roles) || {}, users = (cfg && cfg.users) || {};
  const bad = Object.keys(users).filter((em) => { const u = users[em], r = roles[typeof u === "string" ? u : (u && u.role)]; return r && (r.admin || r.views === "*") && !STAFF_DOMAIN_RE.test(em); });
  if (bad.length) return jsonResponse({ success: false, message: "Admin roles are for @taager.com emails only: " + bad.slice(0, 5).join(", ") }, 400);
  _cfgCache = { at: 0, cfg: null };
  return towerWriteKv(request, env, "access:config");
}
function handleGetTargets(url, env) {
  const type = url.searchParams.get("type") || "";
  if (!towerTargetTypeOk(type)) return jsonResponse({ success: false, message: "Unknown targets type." }, 400);
  return towerReadKv(env, "targets:" + type, "null");
}
// v1.16.1 — merchant portal: reads ONLY the Merchant Targets upload (TAGER_ID / name / Target GMV / Target Placed)
// for one month, with the service key. Month key only ("merchants.YYYY-MM"); the plain "merchants" upload only when no month is asked.
async function handleGetPortalTargets(request, url, env) {
  if (!(await serviceOk(request, env))) return jsonResponse({ success: false, message: "Service key required." }, 403);
  const month = url.searchParams.get("month") || "";
  // v1.18.0 — strict per month, same as the dashboard: a month that has no upload of its own returns null
  // (it used to fall back to the older plain upload, so November showed October's targets). No month asked = the plain upload.
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return towerReadKv(env, "targets:merchants." + month, "null");
  return towerReadKv(env, "targets:merchants", "null");
}
// v1.16.2 — merchant portal: alerts addressed to the Merchant role or to one merchant e-mail. Never "all"-only (staff) alerts.
async function handleGetPortalAlerts(request, url, env) {
  if (!(await serviceOk(request, env))) return jsonResponse({ success: false, message: "Service key required." }, 403);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const all = await towerLoadAlerts(env);
  const mine = all.filter((a) => {
    const au = a.audience || {};
    if (email && Array.isArray(au.users) && au.users.indexOf(email) >= 0) return true;
    if (Array.isArray(au.roles) && au.roles.indexOf("Merchant") >= 0) return true;
    return false;
  }).slice(0, 50).map((a) => ({ id: a.id, at: a.at, title: a.title, body: a.body, severity: a.severity, link: a.link || "" }));
  return jsonResponse({ success: true, alerts: mine });
}
function handlePutTargets(request, url, env) {
  const type = url.searchParams.get("type") || "";
  if (!towerTargetTypeOk(type)) return jsonResponse({ success: false, message: "Unknown targets type." }, 400);
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
  const portal = httpsOnly(env.PORTAL_URL).replace(/\/+$/, "");
  for (const it of list) {
    const email = String(it.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { results.push({ email, ok: false, error: "Bad email" }); continue; }
    const roleRaw = String(it.role || "Viewer").slice(0, 60), role = inviteEsc(roleRaw);
    let html, subject = "You've been invited to the Taager Performance Dashboard";
    if (roleRaw === "Merchant" && portal) {
      // Merchants never use this dashboard: create their portal account and mail them the portal's set-password link.
      let plink = portal + "/", note = "";
      try {
        const mid = String(it.merchantId || "").trim();
        const pk = env.PORTAL_ADMIN_KEY || env.ADMIN_KEY;
        if (mid && pk) {
          const pr = await fetch(portal + "/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Key": pk, "X-Portal": "1" },
            body: JSON.stringify({ email, name: String(it.name || ""), merchantIds: [mid], email_link: false, sendLink: true }) });
          const pj = await pr.json().catch(() => ({}));
          if (pr.ok && pj.link && httpsOnly(pj.link)) plink = pj.link; else note = "portal " + pr.status + (pj && pj.error ? " " + pj.error : "");
        } else note = !mid ? "no Merchant ID" : "PORTAL_ADMIN_KEY not set";
      } catch (e) { note = "portal unreachable"; }
      subject = "Your Taager merchant portal account";
      html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">' +
        '<h2 style="margin:0 0 12px">Welcome to the Taager merchant portal</h2>' +
        '<p style="line-height:1.6">Your account (' + inviteEsc(email) + ') is ready. Choose a password to see your orders, targets and performance.</p>' +
        '<p style="margin:24px 0"><a href="' + inviteEsc(plink) + '" style="background:#0f9d7a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">' + (plink === portal + "/" ? "Open the merchant portal" : "Choose your password") + '</a></p>' +
        '<p style="color:#667;font-size:12px">This is an automated message, please do not reply.</p></div>';
      if (note) results.push({ email, ok: true, warn: note });
      try {
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject, html }) });
        if (!note) results.push(r.ok ? { email, ok: true } : { email, ok: false, error: "Mail service " + r.status });
        else if (!r.ok) results[results.length - 1] = { email, ok: false, error: "Mail service " + r.status };
      } catch (e) { results.push({ email, ok: false, error: "Mail service unreachable" }); }
      continue;
    }
    html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">' +
      '<h2 style="margin:0 0 12px">You have been invited to the Taager Performance Dashboard</h2>' +
      '<p style="line-height:1.6">You now have access with the role <b>' + role + '</b>. Sign in with this email address (' + inviteEsc(email) + ') to get started.</p>' +
      '<p style="margin:24px 0"><a href="' + inviteEsc(link) + '" style="background:#0f9d7a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Open the dashboard</a></p>' +
      '<p style="color:#667;font-size:12px">This is an automated message, please do not reply.</p></div>';
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject, html }) });
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
    // v1.15.49: قبل كده الطلب كان بيتخزن بس ومحدش بيعرف بيه غير لو فتح Users & Roles بنفسه
    try { await notifyAccessRequest(env, email, p[email]); } catch (e) {}
  }
  return jsonResponse({ success: true });
}
// Inbox alert (Admin + Country Manager + approvers) + email to the approvers (if Resend is set up).
async function notifyAccessRequest(env, email, entry) {
  let cfg = {};
  try { cfg = JSON.parse((await env.SYNC_CACHE.get("access:config")) || "{}") || {}; } catch (e) {}
  if (Array.isArray(cfg.rejected) && cfg.rejected.indexOf(email) >= 0) return; // already declined: no new noise
  const okEmail = (x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x);
  const approvers = (Array.isArray(cfg.approvers) ? cfg.approvers : []).map((x) => String(x).trim().toLowerCase()).filter(okEmail).slice(0, 50);
  const users = Array.from(new Set(approvers.concat([MANAGER_EMAIL])));
  const who = entry.name ? entry.name + " (" + email + ")" : email;
  const body = entry.invitedBy
    ? entry.invitedBy + " invited " + who + (entry.role ? " with the suggested role " + entry.role : "") + ". Open Users & Roles to approve or decline."
    : who + " signed in and is waiting for approval. Open Users & Roles to pick a role and approve or decline.";
  const alert = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(), title: "Access request: " + who, body, severity: "warning",
    audience: { all: false, roles: ["Admin", "Country Manager"], users }, about: { type: "General", label: "Access request" }, link: "towerRoles", by: "system" };
  const all = await towerLoadAlerts(env);
  all.unshift(alert);
  await env.SYNC_CACHE.put(TOWER_ALERTS_KEY, JSON.stringify(all.slice(0, TOWER_ALERTS_MAX)));
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !approvers.length) return;
  const link = /^https:\/\/[^\s"<>]+$/.test(String(env.DASHBOARD_URL || "")) ? String(env.DASHBOARD_URL) : "";
  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">New access request</h2><p style="line-height:1.6">' + inviteEsc(body) + '</p>' +
    (link ? '<p style="margin:24px 0"><a href="' + inviteEsc(link) + '" style="background:#0f9d7a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Open the dashboard</a></p>' : "") + '</div>';
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: approvers, subject: "Access request: " + who, html }) });
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

// ---------------------------------------------------------------------------
// v1.16.0 — Staff sessions. Login goes through this Worker: it checks the password with Apps Script
// (server to server), allows only @taager.com emails or staff listed in Users & Roles (never Merchants),
// and returns a signed token the dashboard sends back as X-Staff-Token on every call.
// ---------------------------------------------------------------------------
const STAFF_DOMAIN_RE = /@taager\.com$/i;
const STAFF_SESSION_DAYS = 7;
// actions that keep their own protection (API key / admin key / upload secret) and are called by other servers
const STAFF_OPEN = new Set(["getComputed", "listComputed", "publishComputed", "releaseUpload", "checkAdminKey"]);
function staffGateOn(env) { return !!env.STAFF_SESSION_SECRET && String(env.STAFF_SESSION_SECRET).length >= 32; }
const _enc = new TextEncoder();
function b64url(bytes) { let s = ""; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64url(str) { str = String(str).replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "="; return atob(str); }
async function hmacB64(secret, data) {
  const key = await crypto.subtle.importKey("raw", _enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, _enc.encode(data)));
}
function sameStr(a, b) { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
let _cfgCache = { at: 0, cfg: null };
async function accessCfg(env) {
  if (Date.now() - _cfgCache.at < 60000 && _cfgCache.cfg) return _cfgCache.cfg;
  let cfg = {}; try { cfg = JSON.parse((await env.SYNC_CACHE.get("access:config")) || "{}") || {}; } catch (e) {}
  _cfgCache = { at: Date.now(), cfg }; return cfg;
}
// Who may sign in to the staff dashboard: @taager.com, or someone an admin listed with a staff (non-Merchant) role.
async function staffEligible(env, email) {
  email = String(email || "").toLowerCase();
  const cfg = await accessCfg(env), u0 = cfg.users && cfg.users[email], u = typeof u0 === "string" ? { role: u0 } : u0;
  if (u && u.status === "inactive") return false;
  if (Array.isArray(cfg.rejected) && cfg.rejected.indexOf(email) >= 0 && !u) return false;
  if (u && (u.role === "Merchant" || u.role === "Viewer")) return false;
  return STAFF_DOMAIN_RE.test(email) || !!u;
}
// Who may READ data: eligible, and — when "Require admin approval" is on — already approved (listed in People).
async function staffAllowed(env, email) {
  email = String(email || "").toLowerCase();
  if (!(await staffEligible(env, email))) return false;
  const cfg = await accessCfg(env);
  return !cfg.requireApproval || email === MANAGER_EMAIL || !!(cfg.users && cfg.users[email]);
}
// ---------------------------------------------------------------------------
// v1.17.0 — staff password reset: email link (1 hour, one use) → new password saved as a hash in the Users sheet (Apps Script).
// The answer is always the same whether the email exists or not, so nobody can probe which emails have accounts.
const RESET_HOURS = 1, RESET_MIN_PASSWORD = 8;
const _pwChanged = new Map();
async function pwChangedAt(env, email) {
  const k = String(email || "").toLowerCase(), hit = _pwChanged.get(k);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const v = +(await env.SYNC_CACHE.get("pwchanged:" + k)) || 0;
  if (_pwChanged.size > 500) _pwChanged.clear();
  _pwChanged.set(k, { at: Date.now(), v }); return v;
}
async function sha256Hex(t) { const b = await crypto.subtle.digest("SHA-256", _enc.encode(t)); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function resetMailHtml(name, link) {
  const e = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Reset your Center Control password</h2>' +
    '<p style="line-height:1.6">Hi ' + e(name || "") + ', someone (hopefully you) asked to reset the password of your Taager Center Control account.</p>' +
    '<p style="margin:24px 0"><a href="' + e(link) + '" style="background:#0f9d7a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Choose a new password</a></p>' +
    '<p style="line-height:1.6;color:#555;font-size:13px">The link works once and expires in ' + RESET_HOURS + ' hour. If you did not ask for this, ignore this email — your password stays the same.</p>' +
    '<p style="line-height:1.6;color:#555;font-size:12px">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">' + e(link) + '</span></p>' +
'</div>';
}
async function sendResetMail(env, to, name, link) {
  const subject = "Reset your Center Control password", html = resetMailHtml(name, link);
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }) });
    if (r.ok) return "resend";
    try { await resetTrace(env, to, "resend-failed", "HTTP " + r.status + " " + (await r.text()).slice(0, 300)); } catch (e) {}
  }
  // fallback: Apps Script sends it from the account that owns the script
  const res = await callAppsScriptPost(env, { action: "staff_send_reset_mail", serviceKey: env.SERVICE_KEY || "", email: to, subject, html });
  if (res && res.success) return "apps-script";
  throw new Error((res && (res.message || res.error)) || "no mail channel");
}
async function resetTrace(env, email, step, detail) {
  try { await env.SYNC_CACHE.put("pwreset:last", JSON.stringify({ at: new Date().toISOString(), email, step, detail: String(detail || "").slice(0, 500) }), { expirationTtl: 7 * 86400 }); } catch (e) {}
}
// Every step answers with its real status, so the sign-in page can show exactly what happened:
//   steps: [{ key: "account" | "email", label, status: "ok" | "fail" | "skip", detail }], code, triesLeft, retryAfterSec
const RESET_MAX_PER_HOUR = 3;
function forgotAnswer(code, message, steps, extra) {
  return jsonResponse(Object.assign({ success: code === "sent", code, message, steps }, extra || {}), code === "rate_limited" ? 429 : 200);
}
function maskEmail(e) { const [u, d] = String(e).split("@"); return (u.length <= 2 ? u.charAt(0) + "*" : u.slice(0, 2) + "*".repeat(Math.min(6, u.length - 2))) + "@" + d; }
async function handleStaffForgot(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Bad request." }, 400); }
  const email = String(b.email || "").trim().toLowerCase().slice(0, 160);
  const ACC = "Account check", MAIL = "Reset email";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return forgotAnswer("invalid_email", "Enter a valid work email.", []);
  const ip = request.headers.get("CF-Connecting-IP") || "x", kIp = "rl:reset:ip:" + ip, kEm = "rl:reset:em:" + email;
  const nIp = +(await env.SYNC_CACHE.get(kIp)) || 0;
  if (nIp >= 10) return forgotAnswer("rate_limited", "Too many requests from this network. Try again in 15 minutes.", [], { retryAfterSec: 900, triesLeft: 0 });
  await env.SYNC_CACHE.put(kIp, String(nIp + 1), { expirationTtl: 900 });
  // per-address limit: only emails that really went out count (stored as { n, first })
  let lim = { n: 0, first: Date.now() }; try { const t = await env.SYNC_CACHE.get(kEm); if (t) { const x = JSON.parse(t); lim = typeof x === "number" ? { n: x, first: Date.now() } : x; } } catch (e) {}
  if (Date.now() - lim.first >= 3600e3) lim = { n: 0, first: Date.now() };
  const retryAfterSec = Math.max(60, Math.ceil((lim.first + 3600e3 - Date.now()) / 1000));
  if (lim.n >= RESET_MAX_PER_HOUR) {
    await resetTrace(env, email, "rate-limited", RESET_MAX_PER_HOUR + " emails already sent this hour");
    return forgotAnswer("rate_limited", "You already got " + RESET_MAX_PER_HOUR + " reset emails this hour. Try again in " + Math.ceil(retryAfterSec / 60) + " minutes — or use the last email you received.", [], { triesLeft: 0, retryAfterSec });
  }
  const left = RESET_MAX_PER_HOUR - lim.n;
  try {
    if (!(await staffEligible(env, email))) {
      await resetTrace(env, email, "not-staff", "not @taager.com and not listed in Users & Roles (or inactive / Merchant)");
      return forgotAnswer("not_staff", "This email cannot use Center Control. Merchants sign in at the merchant portal.", [{ key: "account", label: ACC, status: "fail", detail: "Not a Taager staff email" }, { key: "email", label: MAIL, status: "skip" }], { triesLeft: left });
    }
    const chk = await callAppsScriptPost(env, { action: "staff_user_check", serviceKey: env.SERVICE_KEY || "", email });
    if (!chk || !chk.success) {
      const why = (chk && (chk.message || chk.error)) || "no answer";
      await resetTrace(env, email, "apps-script", why + (/unknown action/i.test(why) ? " → paste the new backend/Code.gs and Deploy a NEW version" : ""));
      return forgotAnswer("service_error", "We could not check your account right now. Please tell the dashboard admin (account service: " + why + ").", [{ key: "account", label: ACC, status: "fail", detail: "Account service not reachable" }, { key: "email", label: MAIL, status: "skip" }], { triesLeft: left });
    }
    if (!chk.exists) {
      await resetTrace(env, email, "no-account", "this email is not in the Users sheet (Apps Script)");
      return forgotAnswer("no_account", "There is no Center Control account with this email. Check the spelling, or sign up first.", [{ key: "account", label: ACC, status: "fail", detail: "No account with this email" }, { key: "email", label: MAIL, status: "skip" }], { triesLeft: left });
    }
    const tok = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((x) => x.toString(16).padStart(2, "0")).join("");
    await env.SYNC_CACHE.put("pwreset:" + (await sha256Hex(tok)), JSON.stringify({ email, exp: Date.now() + RESET_HOURS * 3600e3 }), { expirationTtl: RESET_HOURS * 3600 });
    const base = /^https:\/\/[^\s"<>]+$/.test(String(env.DASHBOARD_URL || "")) ? String(env.DASHBOARD_URL).replace(/#.*$/, "") : "https://center-control.taager.app/";
    let via;
    try { via = await sendResetMail(env, email, chk.name || "", base + "#reset=" + tok); }
    catch (e) {
      await resetTrace(env, email, "error", String(e && e.message || e));
      await env.SYNC_CACHE.put("pwreset:lastError", JSON.stringify({ at: new Date().toISOString(), message: String(e && e.message || e) }));
      return forgotAnswer("mail_error", "Your account was found, but the email could not be sent. Try again in a few minutes or tell the dashboard admin.", [{ key: "account", label: ACC, status: "ok", detail: chk.name ? "Hi " + chk.name : "" }, { key: "email", label: MAIL, status: "fail", detail: "Email service error" }], { triesLeft: left });
    }
    lim.n++; await env.SYNC_CACHE.put(kEm, JSON.stringify(lim), { expirationTtl: 3600 });
    await resetTrace(env, email, "sent", "via " + via);
    return forgotAnswer("sent", "Reset link sent to " + maskEmail(email) + ". It works once and expires in " + RESET_HOURS + " hour. Check your inbox (and spam).", [{ key: "account", label: ACC, status: "ok", detail: chk.name ? "Hi " + chk.name : "" }, { key: "email", label: MAIL, status: "ok", detail: "to " + maskEmail(email) }], { triesLeft: RESET_MAX_PER_HOUR - lim.n, retryAfterSec: Math.max(60, Math.ceil((lim.first + 3600e3 - Date.now()) / 1000)) });
  } catch (e) {
    await resetTrace(env, email, "error", String(e && e.message || e));
    return forgotAnswer("service_error", "Something went wrong. Please try again in a minute.", [], { triesLeft: left });
  }
}
async function handleStaffReset(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Bad request." }, 400); }
  const tok = String(b.token || ""), password = String(b.password || "");
  if (!/^[0-9a-f]{64}$/.test(tok)) return jsonResponse({ success: false, message: "This reset link is not valid. Ask for a new one." }, 400);
  if (password.length < RESET_MIN_PASSWORD || password.length > 200) return jsonResponse({ success: false, message: "The password needs at least " + RESET_MIN_PASSWORD + " characters." }, 400);
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return jsonResponse({ success: false, message: "Use letters and numbers in the password." }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "x", kIp = "rl:resetset:ip:" + ip, n = +(await env.SYNC_CACHE.get(kIp)) || 0;
  if (n >= 20) return jsonResponse({ success: false, message: "Too many attempts. Try again in 15 minutes." }, 429);
  await env.SYNC_CACHE.put(kIp, String(n + 1), { expirationTtl: 900 });
  const key = "pwreset:" + (await sha256Hex(tok)), rec = JSON.parse((await env.SYNC_CACHE.get(key)) || "null");
  if (!rec || !(rec.exp > Date.now())) return jsonResponse({ success: false, message: "This reset link has expired or was already used. Ask for a new one." }, 400);
  const res = await callAppsScriptPost(env, { action: "staff_set_password", serviceKey: env.SERVICE_KEY || "", email: rec.email, password });
  if (!res || !res.success) return jsonResponse({ success: false, message: (res && (res.message || res.error)) || "Could not save the password. Try again." }, 502);
  await Promise.all([env.SYNC_CACHE.delete(key), env.SYNC_CACHE.put("pwchanged:" + rec.email, String(Date.now())), env.SYNC_CACHE.delete("staffauth:" + rec.email)]);
  _pwChanged.delete(rec.email);
  return jsonResponse({ success: true, email: rec.email, message: "Password changed. Sign in with the new password." });
}

async function staffSession(request, url, env, action) {
  const tok = request.headers.get("X-Staff-Token") || url.searchParams.get("st") || "";
  const [payload, sig] = String(tok).split(".");
  if (!payload || !sig || tok.length > 600) return null;
  if (!sameStr(sig, await hmacB64(env.STAFF_SESSION_SECRET, payload))) return null;
  let s; try { s = JSON.parse(unb64url(payload)); } catch (e) { return null; }
  if (!s || !s.e || !(s.exp > Date.now())) return null;
  // v1.17.0: a password reset signs out every session issued before it
  const pc = await pwChangedAt(env, s.e);
  if (pc && s.exp - STAFF_SESSION_DAYS * 86400000 < pc) return null;
  if (!(await staffEligible(env, s.e))) return null;
  // someone still waiting for approval may only ask for access and see whether they were approved
  if (action === "requestAccess" || action === "getAccess") return s;
  return (await staffAllowed(env, s.e)) ? s : { pending: true };
}
async function serviceOk(request, env) {
  const k = request.headers.get("X-Service-Key") || "";
  return !!k && ((env.SERVICE_KEY && String(env.SERVICE_KEY).length >= 16 && sameStr(k, env.SERVICE_KEY)) || (env.ADMIN_KEY && sameStr(k, env.ADMIN_KEY)));
}
// Same as backend/Code.gs pwDigest_: h = HMAC-SHA256(key=password, saltHex), then (iterations−1) × h = HMAC-SHA256(key=password, h)
async function pwDigestHex(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey("raw", _enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  let h = new Uint8Array(await crypto.subtle.sign("HMAC", key, _enc.encode(saltHex)));
  for (let i = 1; i < iterations; i++) h = new Uint8Array(await crypto.subtle.sign("HMAC", key, h));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
}
// v1.17.0 — sign-in without waiting for the Apps Script: the user's row (name, role, password hash) is kept in KV
// ("staffauth:<email>") and the password is checked here. The row is refreshed from the Apps Script in the background
// after a sign-in (every 10 min at most); a row older than 24 h, a password that does not match the cached hash, or a
// password reset always goes back to the Apps Script first. Nobody is ever locked out by the cache.
const AUTH_FRESH_MS = 10 * 60 * 1000, AUTH_MAX_AGE_MS = 24 * 3600 * 1000;
async function fetchAuthRecord(env, email) {
  if (!env.SERVICE_KEY || !env.APPS_SCRIPT_URL) return null;
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 25000);
  let rec;
  try {
    const r = await fetch(env.APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "staff_auth_record", serviceKey: env.SERVICE_KEY, email }), redirect: "follow", signal: ac.signal });
    rec = JSON.parse(await r.text());
  } finally { clearTimeout(t); }
  if (!rec || !rec.success || typeof rec.exists !== "boolean") return null; // old Apps Script / key problem
  if (!rec.exists) { await env.SYNC_CACHE.delete("staffauth:" + email); return { exists: false }; }
  const out = { exists: true, name: String(rec.name || ""), email: String(rec.email || email), role: String(rec.role || ""), hash: String(rec.hash || ""), at: Date.now() };
  if (/^h1\$/.test(out.hash)) await env.SYNC_CACHE.put("staffauth:" + email, JSON.stringify(out), { expirationTtl: 30 * 86400 });
  return out;
}
async function hashMatches(hash, password) {
  const p = String(hash || "").split("$");
  if (p.length !== 4 || p[0] !== "h1") return null;             // legacy plain text → old path (it also upgrades the row to a hash)
  const n = Number(p[1]); if (!(n > 0 && n <= 20000)) return null;
  const calc = await pwDigestHex(password, p[2], n);
  let diff = calc.length ^ p[3].length; for (let i = 0; i < Math.min(calc.length, p[3].length); i++) diff |= calc.charCodeAt(i) ^ p[3].charCodeAt(i);
  return diff === 0;
}
async function fastStaffLogin(env, email, password, ctx) {
  let cached = null; try { cached = JSON.parse((await env.SYNC_CACHE.get("staffauth:" + email)) || "null"); } catch (e) {}
  if (cached && Date.now() - cached.at < AUTH_MAX_AGE_MS && (await hashMatches(cached.hash, password)) === true) {
    if (Date.now() - cached.at > AUTH_FRESH_MS) { const job = fetchAuthRecord(env, email).catch(() => null); if (ctx && ctx.waitUntil) ctx.waitUntil(job); }
    return { success: true, name: cached.name, email: cached.email, role: cached.role, fast: "cache" };
  }
  const rec = await fetchAuthRecord(env, email);                 // not cached / stale / password changed → fresh row
  if (!rec) return null;
  if (!rec.exists) return { success: false, message: "No account found with this email." };
  if ((await hashMatches(rec.hash, password)) !== true) return null; // no match here → let the Apps Script decide (never locks anyone out)
  return { success: true, name: rec.name, email: rec.email, role: rec.role, fast: "apps-script row" };
}
async function handleStaffLogin(request, env, ctx) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Bad request." }, 400); }
  const email = String(b.email || "").trim().toLowerCase().slice(0, 160), password = String(b.password || "").slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !password) return jsonResponse({ success: false, message: "Enter your email and password." }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "x", kIp = "rl:staff:ip:" + ip, kEm = "rl:staff:em:" + email;
  const [nIp, nEm] = await Promise.all([env.SYNC_CACHE.get(kIp), env.SYNC_CACHE.get(kEm)]);
  if ((+nIp || 0) >= 40 || (+nEm || 0) >= 10) return jsonResponse({ success: false, message: "Too many attempts. Try again in 15 minutes." }, 429);
  // v1.17.0 — fast path: the Apps Script only hands over the stored row (service key) and the password is checked here.
  // Anything unexpected (old Apps Script, legacy plain-text password, a hash that does not match) → the old Apps Script login.
  let res = null;
  try { res = await fastStaffLogin(env, email, password, ctx); } catch (e) { res = null; }
  if (!res) res = await callAppsScriptPost(env, { action: "login", email, password });
  if (!res || !res.success) {
    await Promise.all([env.SYNC_CACHE.put(kIp, String((+nIp || 0) + 1), { expirationTtl: 900 }), env.SYNC_CACHE.put(kEm, String((+nEm || 0) + 1), { expirationTtl: 900 })]);
    return jsonResponse({ success: false, message: (res && res.message) || "Invalid email or password." });
  }
  if (!(await staffEligible(env, email))) return jsonResponse({ success: false, message: "This dashboard is for Taager staff. Merchants use the Taager merchant portal." }, 403);
  let token = "";
  if (staffGateOn(env)) {
    const payload = b64url(_enc.encode(JSON.stringify({ e: email, r: String(res.role || "").slice(0, 40), exp: Date.now() + STAFF_SESSION_DAYS * 86400000 })));
    token = payload + "." + (await hmacB64(env.STAFF_SESSION_SECRET, payload));
  }
  return jsonResponse({ success: true, name: res.name, email: res.email || email, role: res.role, token });
}

// ============================================================================
//  v1.17.0 — SHARED SNAPSHOT (R2)
//  Cold start: before this, anyone opening the dashboard on a browser that had
//  never loaded it saw zeros until the whole sheet load finished. Whoever
//  loads fresh data now pushes the gzipped snapshot here, and anyone with an
//  empty local cache pulls it in one request and paints straight away, then
//  syncs in the background exactly as before.
//  Staff-gated like every other action — the snapshot carries CM3/PPM, so it
//  must never be reachable with the link alone.
// ============================================================================
const SNAP_KEY = "snapshot/latest.json.gz";
const SNAP_MAX_BYTES = 60 * 1024 * 1024;   // sanity ceiling; the real file is ~8MB gzipped

function snapBucket(env) { return env.SNAPSHOTS || null; }

async function snapHeadMeta(env) {
  const b = snapBucket(env); if (!b) return null;
  const h = await b.head(SNAP_KEY).catch(() => null);
  if (!h) return null;
  const m = h.customMetadata || {};
  return { savedAt: +m.savedAt || 0, fp: m.fp || "", by: m.by || "", bytes: h.size || +m.bytes || 0, at: m.at || "" };
}

// The dashboard posts the gzipped snapshot as the raw request body.
async function handleSnapshotPut(request, url, env) {
  const b = snapBucket(env);
  if (!b) return jsonResponse({ success: false, code: "no_bucket", message: "Shared snapshot is off — no R2 bucket bound (SNAPSHOTS)." }, 503);
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST only." }, 405);
  const savedAt = +url.searchParams.get("savedAt") || Date.now();
  const fp = String(url.searchParams.get("fp") || "").slice(0, 200);
  const by = String(url.searchParams.get("email") || "").slice(0, 120);
  const cur = await snapHeadMeta(env);
  // Nothing to gain from rewriting the same numbers, or from replacing a newer push with an older one.
  if (cur && fp && cur.fp === fp) return jsonResponse({ success: true, skipped: "same", savedAt: cur.savedAt });
  if (cur && cur.savedAt > savedAt) return jsonResponse({ success: true, skipped: "older", savedAt: cur.savedAt });
  const body = await request.arrayBuffer();
  if (!body || body.byteLength < 100) return jsonResponse({ success: false, message: "Empty snapshot." }, 400);
  if (body.byteLength > SNAP_MAX_BYTES) return jsonResponse({ success: false, message: "Snapshot too large (" + body.byteLength + " bytes)." }, 413);
  await b.put(SNAP_KEY, body, {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
    customMetadata: { savedAt: String(savedAt), fp: fp, by: by, bytes: String(body.byteLength), at: new Date().toISOString() },
  });
  return jsonResponse({ success: true, savedAt: savedAt, bytes: body.byteLength });
}

// Served still gzipped. Browsers that get Content-Encoding: gzip inflate it themselves;
// the dashboard also sniffs the gzip magic bytes, so it works either way.
async function handleSnapshotGet(env) {
  const b = snapBucket(env);
  if (!b) return jsonResponse({ success: false, code: "no_bucket", message: "Shared snapshot is off." }, 503);
  const obj = await b.get(SNAP_KEY);
  if (!obj) return jsonResponse({ success: false, code: "no_snapshot", message: "No shared snapshot yet — the first person to load the dashboard creates it." }, 404);
  const m = obj.customMetadata || {};
  const h = corsHeaders();
  h["Content-Type"] = "application/json";
  h["Content-Encoding"] = "gzip";
  h["Access-Control-Expose-Headers"] = h["Access-Control-Expose-Headers"] + ", X-Snapshot-Saved-At, X-Snapshot-Fp";
  h["X-Snapshot-Saved-At"] = String(m.savedAt || "");
  h["X-Snapshot-Fp"] = String(m.fp || "");
  return new Response(obj.body, { headers: h });
}

async function handleSnapshotMeta(env) {
  if (!snapBucket(env)) return jsonResponse({ success: true, on: false, last: null });
  return jsonResponse({ success: true, on: true, last: await snapHeadMeta(env) });
}

// ---------------------------------------------------------------------------
//  v1.17.0 — PLANNER DOH relay
//  The dashboard computes the table and sends it here; the Worker writes it to the sheet through
//  Apps Script and keeps a copy, so the 11:00 Cairo run can rewrite it on a day nobody opened the
//  dashboard. The copy lives here rather than in Script Properties, whose 9KB-per-value limit a few
//  thousand SKUs blow straight through. Going through the Worker also means the browser gets a real
//  answer back (Apps Script is no-cors from the page), so the button can report what actually
//  happened instead of only that the request left.
// ---------------------------------------------------------------------------
const PDOH_PAYLOAD_KEY = "export:plannerdoh:payload";

async function pdohStore(env, payload) {
  const body = JSON.stringify(payload);
  if (env.SNAPSHOTS) { await env.SNAPSHOTS.put(PDOH_PAYLOAD_KEY, body, { httpMetadata: { contentType: "application/json" } }); return "r2"; }
  await env.SYNC_CACHE.put(PDOH_PAYLOAD_KEY, body, { expirationTtl: 7 * 86400 });   // KV fallback: 25MB per value
  return "kv";
}
async function pdohLoad(env) {
  try {
    if (env.SNAPSHOTS) { const o = await env.SNAPSHOTS.get(PDOH_PAYLOAD_KEY); return o ? JSON.parse(await o.text()) : null; }
    const t = await env.SYNC_CACHE.get(PDOH_PAYLOAD_KEY);
    return t ? JSON.parse(t) : null;
  } catch (e) { return null; }
}

// Hands a stored payload to Apps Script, which only writes it.
async function pdohWrite(env, payload) {
  const r = await callAppsScriptPost(env, Object.assign({ action: "planner_doh_rows", serviceKey: env.SERVICE_KEY || "" }, payload));
  if (!r || r.success !== true) throw new Error((r && (r.message || r.error)) || "Apps Script did not write the sheet");
  return r;
}

// The dashboard posts the table here.
// v1.17.0 — Inventory & DOH per category -> its own tab, every day at 11:45 Cairo, just after the
// Supply conversion run so the two never hit the same Apps Script deployment at once.
const PIC_AT_MIN = 11 * 60 + 45, PIC_LAST_MIN = 13 * 60 + 59;
async function runInvCategoryExport(env, opts) {
  opts = opts || {};
  const now = cairoNowParts(opts.now), mins = cairoMinutes(opts.now);
  const key = "export:invcat:" + (opts.force ? "manual:" : "") + now.date;
  let st = null; try { st = JSON.parse((await env.SYNC_CACHE.get(key)) || "null"); } catch (e) {}
  if (!opts.force) {
    if (String(env.INV_CATEGORY_EXPORT || "on").toLowerCase() === "off") return { skipped: "off" };
    if (mins < PIC_AT_MIN || mins > PIC_LAST_MIN) return { skipped: "time" };
    if (st && st.state === "done") return { skipped: "done" };
    if (st && st.state === "running" && Date.now() - Date.parse(st.at) < 20 * 60 * 1000) return { skipped: "running" };
    if (st && st.state === "failed" && ((st.tries || 0) >= 3 || Date.now() - Date.parse(st.at) < 15 * 60 * 1000)) return { skipped: "wait" };
  }
  const tries = ((st && st.tries) || 0) + 1;
  const put = (o) => { const v = JSON.stringify(Object.assign({ date: now.date, tries, by: opts.by || "schedule" }, o)); return env.SYNC_CACHE.put(key, v, { expirationTtl: 4 * 86400 }).then(() => env.SYNC_CACHE.put("export:invcat:last", v, { expirationTtl: 30 * 86400 })); };
  await put({ state: "running", at: new Date().toISOString() });
  try {
    const r = await callAppsScriptPost(env, { action: "inv_category_export", serviceKey: env.SERVICE_KEY || "" });
    if (!r || r.success !== true) throw new Error((r && (r.message || r.error)) || "Apps Script did not write the sheet");
    const done = { state: "done", at: new Date().toISOString(), rows: r.rows, sentAt: r.sentAt || "" };
    await put(done); return done;
  } catch (e) {
    const fail = { state: "failed", at: new Date().toISOString(), message: String((e && e.message) || e).slice(0, 400) };
    await put(fail); return fail;
  }
}
// The dashboard posts the per-category table here rather than straight to Apps Script: going
// through the Worker means it gets a real answer back (Apps Script is no-cors from the page, so a
// refusal there — an action the deployment does not know yet, for one — looked like success).
async function handleInvCategoryRows(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST only." }, 405);
  let payload = null;
  try { payload = await request.json(); } catch (e) { return jsonResponse({ success: false, message: "Could not read the table." }, 400); }
  if (!payload || !payload.rows || !payload.rows.length) return jsonResponse({ success: false, message: "No rows." }, 400);
  try {
    const r = await callAppsScriptPost(env, Object.assign({ action: "inv_category_rows", serviceKey: env.SERVICE_KEY || "" }, payload));
    if (!r || r.success !== true) throw new Error((r && (r.message || r.error)) || "Apps Script did not write the sheet");
    await env.SYNC_CACHE.put("export:invcat:last", JSON.stringify({ date: cairoNowParts().date, by: "dashboard", state: "done",
      at: new Date().toISOString(), rows: r.rows, sentAt: new Date().toISOString() }), { expirationTtl: 30 * 86400 });
    return jsonResponse({ success: true, rows: r.rows });
  } catch (e) {
    return jsonResponse({ success: false, message: String((e && e.message) || e).slice(0, 400) }, 502);
  }
}

async function handleInvCategoryExport(request, url, env) {
  let email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (staffGateOn(env)) { const ss = await staffSession(request, url, env, "invCategoryExport"); email = ss && ss.e ? String(ss.e).toLowerCase() : ""; }
  if (url.searchParams.get("run") !== "1") {
    let last = null; try { last = JSON.parse((await env.SYNC_CACHE.get("export:invcat:last")) || "null"); } catch (e) {}
    return jsonResponse({ success: true, at: "11:45 Cairo", on: String(env.INV_CATEGORY_EXPORT || "on").toLowerCase() !== "off", last });
  }
  if (!isOwnerEmail(email)) return jsonResponse({ success: false, message: "Not authorized." }, 403);
  const out = await runInvCategoryExport(env, { force: true, by: email });
  return jsonResponse(Object.assign({ success: out.state === "done" }, out));
}

async function handlePlannerDohRows(request, url, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST only." }, 405);
  let payload = null;
  try { payload = await request.json(); } catch (e) { return jsonResponse({ success: false, message: "Could not read the table." }, 400); }
  if (!payload || !payload.rows || !payload.rows.length) return jsonResponse({ success: false, message: "No rows." }, 400);
  payload.sentAt = new Date().toISOString();
  try {
    const stored = await pdohStore(env, payload);
    const r = await pdohWrite(env, payload);
    await env.SYNC_CACHE.put("export:plannerdoh:last", JSON.stringify({ date: cairoNowParts().date, by: "dashboard", state: "done",
      at: new Date().toISOString(), rows: r.rows, yday: r.yday, sentAt: payload.sentAt }), { expirationTtl: 30 * 86400 });
    return jsonResponse({ success: true, rows: r.rows, yday: r.yday, stored });
  } catch (e) {
    // The copy is already stored, so the 11:00 run can still write it even if this attempt failed.
    return jsonResponse({ success: false, message: String((e && e.message) || e).slice(0, 400) }, 502);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Release-Secret, X-Admin-Key, X-Staff-Token, X-Service-Key",
    "Access-Control-Expose-Headers": "Content-Disposition, X-Data-Source, X-Cached-At, X-Cache-Reason, X-Fetched-At",
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
// v1.18.0 — GitHub sometimes answers a write with 500 / 502 / 503 (or 403 secondary rate limit) when many blobs are
// created in a row: retry those up to 3 times with a short back-off before giving up.
async function ghApi(env, method, path, body) {
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 800 * attempt));
    const r = await fetch("https://api.github.com/repos/" + env.GITHUB_REPO + path, {
      method, headers: ghHeaders(env, { Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) return r.json();
    const txt = (await r.text()).slice(0, 200);
    last = "GitHub " + method + " " + path.split("?")[0] + " → " + r.status + ": " + txt;
    const retry = r.status >= 500 || r.status === 429 || (r.status === 403 && /secondary rate|abuse/i.test(txt));
    if (!retry) break;
  }
  throw new Error(last);
}
// git blob id of a file = sha1("blob <size>\0" + bytes) — lets the publish skip every file that did not change
async function gitBlobSha(bytes) {
  const head = new TextEncoder().encode("blob " + bytes.length + "\0");
  const all = new Uint8Array(head.length + bytes.length); all.set(head, 0); all.set(bytes, head.length);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
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
  // only the files that changed are sent (same bytes = same git blob id as in the branch) — a normal release is a few
  // files instead of ~120 blob calls, which is what made GitHub answer 500 half-way through
  const have = new Map();
  try {
    const cur = await ghApi(env, "GET", "/git/trees/" + parentCommit.tree.sha + "?recursive=1");
    (cur.tree || []).forEach((e) => { if (e.type === "blob") have.set(e.path, e.sha); });
  } catch (e) { /* no listing → send everything */ }
  const tree = [];
  let changed = 0;
  for (const f of files) {
    const sha = await gitBlobSha(f.data);
    if (have.get(f.name) === sha) continue;
    const blob = await ghApi(env, "POST", "/git/blobs", { content: bytesToB64(f.data), encoding: "base64" });
    tree.push({ path: f.name, mode: "100644", type: "blob", sha: blob.sha }); changed++;
  }
  const igText = "releases/\nbackend/\ncloudflare-worker/\n*.zip\n", igSha = await gitBlobSha(new TextEncoder().encode(igText));
  if (have.get(".vercelignore") !== igSha) { const ig = await ghApi(env, "POST", "/git/blobs", { content: igText, encoding: "utf-8" }); tree.push({ path: ".vercelignore", mode: "100644", type: "blob", sha: ig.sha }); }
  if (!tree.length) return { files: files.length, changed: 0, commit: parent.slice(0, 7), unchanged: true };
  const newTree = await ghApi(env, "POST", "/git/trees", { base_tree: parentCommit.tree.sha, tree });
  const commit = await ghApi(env, "POST", "/git/commits", { message: "Deploy dashboard v" + version + " (via Worker Sync Status upload)", tree: newTree.sha, parents: [parent] });
  await ghApi(env, "PATCH", "/git/refs/heads/" + encodeURIComponent(branch), { sha: commit.sha });
  return { files: files.length, changed, commit: commit.sha.slice(0, 7) };
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
  const vm = rawName.match(/v?(\d+)[._](\d+)[._](\d+)/i);   // v1.18.0 or v1_18_0 (Performance_dashboard_v1_18_0_glass.zip)
  const version = vm ? vm[1] + "." + vm[2] + "." + vm[3] : "unknown";
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
// v1.16.0: مفيش مفتاح افتراضي مكتوب في الكود — المفاتيح من الـ secret COMPUTED_API_KEYS بس
// (wrangler secret put COMPUTED_API_KEYS). لو مش متظبط، getComputed/listComputed مقفولين.
function computedKeys(env) {
  const raw = (env && env.COMPUTED_API_KEYS) ? String(env.COMPUTED_API_KEYS) : "";
  return raw.split(",").map(x => x.trim()).filter(x => x.length >= 12);
}
function sanitizeComputedName(name) { return String(name || "").trim().replace(/[^A-Za-z0-9_-]/g, ""); }

async function handlePublishComputed(request, env) {
  if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
  // v1.16.0: قبل كده أي حد كان يقدر يكتب أرقام مزيفة هنا من غير أي مفتاح
  if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
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
  const r = await fetch(env.APPS_SCRIPT_URL + "?" + qs + (env.APPS_SCRIPT_SERVICE_KEY ? "&k=" + encodeURIComponent(env.APPS_SCRIPT_SERVICE_KEY) : ""), { redirect: "follow" });
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
  try { return JSON.parse(txt); } catch (e) {
    const snip = txt.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
    return { success: false, error: "Server returned an invalid response (HTTP " + r.status + (snip ? ": " + snip : "") + ")", transient: true };
  }
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

// v1.17.0 — Command Loop wiring (the module never touches anything else in this Worker)
const LOOP = createLoop({
  jsonResponse, staffSession, staffGateOn, serviceOk, accessCfg, metabaseLink, metabaseResponse, gzipText,
  loadAlerts: towerLoadAlerts,
  saveAlerts: (env, all) => env.SYNC_CACHE.put(TOWER_ALERTS_KEY, JSON.stringify(all.slice(0, TOWER_ALERTS_MAX))),
  ownerEmails: OWNER_EMAILS, isOwner: isOwnerEmail
});

// v1.17.8 — Usage Log (tracking + Control > Usage Log). Uses the Command Loop D1 database (LOOP_DB); tables are created on first use.
const USAGE = createUsage({ jsonResponse, staffSession, towerAdminOk });
// v1.19.0 — ML Forecast (the Python job on GitHub Actions reads sources / writes results through here)
const ML = createMl({ jsonResponse, serviceOk, metabaseProxy: handleMetabaseProxy });

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // v1.16.0 — staff gate: every data/query action needs a Taager staff session issued by this Worker
    // (staffLogin). Active once the STAFF_SESSION_SECRET secret is set. Merchants never get one.
    if (action === "staffLogin") return handleStaffLogin(request, env, ctx);
    // v1.17.0 — "Forgot your password?" on the dashboard sign-in page (no session needed)
    if (action === "staffForgot") return handleStaffForgot(request, env);
    if (action === "staffReset") return handleStaffReset(request, env);
    if (staffGateOn(env) && !STAFF_OPEN.has(action)) {
      const okService = (action === "getAccess" || action === "getPortalTargets" || action === "getPortalAlerts" || action === "loopPortalSignals" || action === "loopMerchantRequest" || action === "loopPortalCatalog" || action === "loopCpaSync" || action === "mlSource" || action === "mlPut" || action === "mlGet") && (await serviceOk(request, env));
      const ss = okService ? null : await staffSession(request, url, env, action);
      if (!okService && !ss) return jsonResponse({ success: false, code: "staff_auth", message: "Please sign in again." }, 401);
      if (ss && ss.pending) return jsonResponse({ success: false, code: "staff_pending", message: "Waiting for admin approval." }, 403);
    }

    // v1.17.0 — Command Loop (scores, tasks, merchant notifications) — see loop.js / loop-api.js
    if (USAGE.isUsageAction(action)) return USAGE.handle(action, request, url, env);
    if (ML.isMlAction(action)) return ML.handle(action, request, url, env);
    if (LOOP.isLoopAction(action)) return LOOP.handle(action, request, url, env, ctx);
    if (action === "metabase") return handleMetabaseProxy(url, env);
    if (action === "metabaseStatus") return handleMetabaseStatus(env);
    if (action === "actualReturns") return handleActualReturns(url, env);
    if (action === "metabaseAccept") return handleMetabaseAccept(url, env);
    if (action === "declineDigestStatus") return handleDeclineDigestStatus(env);
    if (action === "declineDigestSend") return handleDeclineDigestSend(request, url, env);
    if (action === "plannerDohExport") return handlePlannerDohExport(request, url, env);
    if (action === "supplyConversionExport") return handleSupplyConversionExport(request, url, env);
    if (action === "invCategoryExport") return handleInvCategoryExport(request, url, env);
    if (action === "invCategoryRows") return handleInvCategoryRows(request, env);
    if (action === "getAccess") return handleGetAccess(env);
    if (action === "putAccess") return handlePutAccess(request, env);
    if (action === "getPortalTargets") return handleGetPortalTargets(request, url, env);
    if (action === "getPortalAlerts") return handleGetPortalAlerts(request, url, env);
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
    if (action === "plannerDohRows") return handlePlannerDohRows(request, url, env);
    if (action === "snapshotPut") return handleSnapshotPut(request, url, env);
    if (action === "snapshotGet") return handleSnapshotGet(env);
    if (action === "snapshotMeta") return handleSnapshotMeta(env);
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
        prewarmMetabase(env).catch((err) => console.error("[scheduled prewarmMetabase] failed:", err && err.message)),
        LOOP.scheduled(env).catch((err) => console.error("[scheduled loop] failed:", err && err.message)),
        flushFeedbackQueue(env).catch((err) => console.error("[scheduled flushFeedbackQueue] failed:", err && err.message)),
        sendDeclineDigest(env).catch((err) => console.error("[scheduled declineDigest] failed:", err && err.message)),
        runPlannerDohExport(env).catch((err) => console.error("[scheduled plannerDoh] failed:", err && err.message)),
        runSupplyConversionExport(env)
          .then(() => runInvCategoryExport(env))
          .catch((err) => console.error("[scheduled supplyConversion / invCategory] failed:", err && err.message)),
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
