/* Taager Merchant Portal — separate Cloudflare Worker (v1.0.0, shipped with dashboard v1.16.0).
 *
 * What a merchant gets: their own Over View numbers, per month, for THEIR Merchant ID(s):
 *   Net delivery rate (CR × DR), Placed / Confirmed / Delivered pieces and orders, Delivered GMV (with run rate),
 *   a month-by-month trend and the average placed pieces per day.
 *
 * Data source: ONE Metabase question only — the merchant query ("Merchant Segmentation", 5761d362-…).
 * This Worker is never given the Main export or any other company query (least privilege).
 *
 * Why it is safe to send to merchants:
 *   - The browser never sees a Metabase link, a Google Sheet, an API key or another merchant's rows.
 *     This Worker reads the merchant query itself (secret MERCHANT_QUERY_URL, or a Metabase API key) and keeps
 *     only the counts above — the ACM name, the segment labels and the country are dropped before storing.
 *   - Every /api/data call is filtered on the server by the Merchant IDs saved on the account in KV —
 *     not by anything the browser sends.
 *   - Passwords: PBKDF2-SHA256 (100k iterations, per-user salt). Sessions: signed HttpOnly cookie,
 *     12 h, revoked when an admin disables the account or issues a new password link.
 *   - Login is rate limited, every response carries a strict Content-Security-Policy, and there is
 *     no inline script anywhere (script-src 'self').
 */
import { PORTAL_HTML, ADMIN_HTML, APP_CSS, PORTAL_JS, ADMIN_JS, FAVICON_SVG } from "./ui.js";
import { DASH_HTML, DASH_JS } from "./dash.js";
import { DASH_CSS, DASH_CSS_EXTRA } from "./dash-css.js";

const VERSION = "1.2.0";
const COOKIE = "__Host-mp_s";
const SESSION_HOURS = 12;
const LINK_HOURS = 72;
const PBKDF2_ITER = 100000; // the Workers runtime caps PBKDF2 at 100k iterations
const MIN_PASSWORD = 10;
const DEFAULT_SHARDS = 32;
const DEFAULT_MAX_AGE_MIN = 40;
// Column positions of the merchant query — the same positions js/app.js (parseMerchantSegmentationSheet) reads.
// Override with the QUERY_COLUMNS variable (JSON) if the Metabase question ever changes.
const DEFAULT_COLS = { month: 0, merchantId: 2, merchantName: 3, deliveredGmv: 5, segmentation: 12, placedOrders: 6, confirmedOrders: 7, deliveredOrders: 8, placedPieces: 14, confirmedPieces: 15, deliveredPieces: 16 };

// ============================================================================ entry
export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      console.error("portal error", e && e.stack || e);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshData(env, "cron").catch((e) => console.error("cron refresh failed", e)));
  }
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;

  // ---- static (no secrets in any of these)
  if (m === "GET" && (p === "/" || p === "/set-password")) return page(PORTAL_HTML);
  if (m === "GET" && p === "/admin") return page(ADMIN_HTML);
  if (m === "GET" && p === "/dashboard") return page(DASH_HTML);
  if (m === "GET" && p === "/static/dash.css") return asset(DASH_CSS + DASH_CSS_EXTRA, "text/css; charset=utf-8");
  if (m === "GET" && p === "/static/dash.js") return asset(DASH_JS, "text/javascript; charset=utf-8");
  if (m === "GET" && p === "/static/app.css") return asset(APP_CSS, "text/css; charset=utf-8");
  if (m === "GET" && p === "/static/portal.js") return asset(PORTAL_JS, "text/javascript; charset=utf-8");
  if (m === "GET" && p === "/static/admin.js") return asset(ADMIN_JS, "text/javascript; charset=utf-8");
  if (m === "GET" && p === "/favicon.svg") return asset(FAVICON_SVG, "image/svg+xml");
  if (m === "GET" && p === "/robots.txt") return asset("User-agent: *\nDisallow: /\n", "text/plain");

  if (!p.startsWith("/api/")) return json({ error: "Not found" }, 404);
  if (!env.PORTAL_KV) return json({ error: "PORTAL_KV binding is missing." }, 500);

  // ---- every state-changing call must come from this site (CSRF guard on top of SameSite=Strict)
  if (m !== "GET" && m !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "Bad origin" }, 403);
    if (request.headers.get("X-Portal") !== "1") return json({ error: "Bad request" }, 400);
  }

  // ---- public API
  if (p === "/api/config" && m === "GET") return json({ emailEnabled: emailEnabled(env), version: VERSION });
  if (p === "/api/login" && m === "POST") return login(request, env);
  if (p === "/api/logout" && m === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  if (p === "/api/password/set" && m === "POST") return setPasswordFromLink(request, env);
  if (p === "/api/password/forgot" && m === "POST") return forgotPassword(request, env, url);

  // ---- admin API (X-Admin-Key == secret ADMIN_KEY)
  if (p.startsWith("/api/admin/")) {
    if (!(await adminOk(request, env))) return json({ error: "Wrong admin key." }, 403);
    return adminRoute(request, env, ctx, url);
  }

  // ---- signed-in merchant API
  const who = await currentAccount(request, env);
  if (!who) return json({ error: "Please sign in." }, 401, { "Set-Cookie": clearCookie() });
  if (p === "/api/me" && m === "GET") return json({ email: who.email, name: who.name || "", merchantIds: who.merchantIds });
  if (p === "/api/data" && m === "GET") return merchantData(who, env, ctx);
  if (p === "/api/targets" && m === "GET") return merchantTargets(who, env, url);
  if (p === "/api/salesplan" && m === "GET") return merchantSalesPlan(who, env, url);
  if (p === "/api/inventory" && m === "GET") return merchantInventory(who, env);
  if (p === "/api/incentives" && m === "GET") return merchantIncentives(who, env);
  if (p === "/api/alerts" && m === "GET") return merchantAlerts(who, env);
  if (p === "/api/password/change" && m === "POST") return changePassword(request, env, who);
  return json({ error: "Not found" }, 404);
}

// ============================================================================ responses
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
function secHeaders(extra) {
  return Object.assign({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow"
  }, extra || {});
}
function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: secHeaders(Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra || {})) });
}
function page(html) { return new Response(html, { headers: secHeaders({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }) }); }
function asset(body, type) { return new Response(body, { headers: secHeaders({ "Content-Type": type, "Cache-Control": "no-cache" }) }); }
async function body(request) {
  const t = await request.text();
  if (t.length > 20000) throw new HttpError(413, "Request too large.");
  try { return JSON.parse(t || "{}"); } catch (e) { throw new HttpError(400, "Bad request."); }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ============================================================================ crypto helpers
const enc = new TextEncoder();
function b64u(bytes) { let s = ""; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(str) { str = String(str).replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "="; const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
function hex(bytes) { return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(""); }
function randomToken(n) { const b = new Uint8Array(n || 32); crypto.getRandomValues(b); return b64u(b); }
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function sha256Hex(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function pbkdf2(password, saltB64, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(saltB64), iterations: iter }, key, 256);
  return b64u(bits);
}
async function makePasswordRecord(password) {
  const salt = randomToken(16);
  return { alg: "pbkdf2-sha256", iter: PBKDF2_ITER, salt, hash: await pbkdf2(password, salt, PBKDF2_ITER) };
}
async function checkPassword(password, rec) {
  if (!rec || !rec.hash) { await pbkdf2(password, "AAAAAAAAAAAAAAAAAAAAAA", PBKDF2_ITER); return false; } // same work either way
  return safeEqual(await pbkdf2(password, rec.salt, rec.iter || PBKDF2_ITER), rec.hash);
}
function passwordProblem(pw) {
  pw = String(pw || "");
  if (pw.length < MIN_PASSWORD) return "Use at least " + MIN_PASSWORD + " characters.";
  if (pw.length > 200) return "That password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use letters and numbers.";
  return "";
}
async function adminOk(request, env) {
  const k = request.headers.get("X-Admin-Key") || "";
  return !!env.ADMIN_KEY && String(env.ADMIN_KEY).length >= 16 && k.length > 0 && safeEqual(await sha256Hex(k), await sha256Hex(env.ADMIN_KEY));
}

// ============================================================================ accounts
const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 160);
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
function normIds(v) {
  const list = Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/);
  return Array.from(new Set(list.map((x) => String(x).trim()).filter((x) => /^[A-Za-z0-9_-]{1,40}$/.test(x)))).slice(0, 50);
}
async function getAccount(env, email) { const t = await env.PORTAL_KV.get("acct:" + normEmail(email)); return t ? JSON.parse(t) : null; }
async function putAccount(env, a) { a.updatedAt = new Date().toISOString(); await env.PORTAL_KV.put("acct:" + a.email, JSON.stringify(a)); }
function publicAccount(a) {
  return { email: a.email, name: a.name || "", merchantIds: a.merchantIds || [], status: a.status, hasPassword: !!(a.pw && a.pw.hash), createdAt: a.createdAt, lastLoginAt: a.lastLoginAt || "" };
}

// ---- sessions: "<b64url(json)>.<hmac>"; the account is re-read from KV on every request
function secret(env) {
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 32) throw new HttpError(500, "SESSION_SECRET is not set (32+ characters).");
  return String(env.SESSION_SECRET);
}
async function issueSession(env, a) {
  const payload = b64u(enc.encode(JSON.stringify({ e: a.email, tv: a.tv || 0, exp: Date.now() + SESSION_HOURS * 3600e3 })));
  return payload + "." + (await hmac(secret(env), payload));
}
function sessionCookie(tok) { return COOKIE + "=" + tok + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_HOURS * 3600; }
function clearCookie() { return COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"; }
function readCookie(request) {
  const c = request.headers.get("Cookie") || "";
  const m = c.split(/;\s*/).find((x) => x.startsWith(COOKIE + "="));
  return m ? m.slice(COOKIE.length + 1) : "";
}
async function currentAccount(request, env) {
  const tok = readCookie(request); if (!tok || tok.length > 800) return null;
  const [payload, sig] = tok.split(".");
  if (!payload || !sig || !safeEqual(sig, await hmac(secret(env), payload))) return null;
  let s; try { s = JSON.parse(new TextDecoder().decode(unb64u(payload))); } catch (e) { return null; }
  if (!s || !s.e || !s.exp || s.exp < Date.now()) return null;
  const a = await getAccount(env, s.e);
  if (!a || a.status !== "active" || (a.tv || 0) !== s.tv) return null;
  return a;
}

// ---- rate limit (KV, per IP and per email, 15 minutes)
async function hit(env, key, limit) {
  const k = "rl:" + key, n = parseInt((await env.PORTAL_KV.get(k)) || "0", 10) + 1;
  await env.PORTAL_KV.put(k, String(n), { expirationTtl: 900 });
  return n > limit;
}
async function blocked(env, key, limit) { return parseInt((await env.PORTAL_KV.get("rl:" + key)) || "0", 10) >= limit; }

async function login(request, env) {
  let b; try { b = await body(request); } catch (e) { return json({ error: e.message }, e.status || 400); }
  const email = normEmail(b.email), pw = String(b.password || "").slice(0, 200);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (!okEmail(email) || !pw) return json({ error: "Enter your email and password." }, 400);
  if ((await blocked(env, "ip:" + ip, 40)) || (await blocked(env, "em:" + email, 8))) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
  const a = await getAccount(env, email);
  const ok = await checkPassword(pw, a && a.pw);
  if (!ok || !a || a.status !== "active") {
    await hit(env, "ip:" + ip, 40); await hit(env, "em:" + email, 8);
    return json({ error: "Wrong email or password." }, 401);
  }
  await env.PORTAL_KV.delete("rl:em:" + email);
  a.lastLoginAt = new Date().toISOString(); await putAccount(env, a);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await issueSession(env, a)) });
}

// ---- one-time links (set / reset password). Only a SHA-256 of the token is stored.
async function newLink(env, email, origin) {
  const tok = randomToken(32);
  await env.PORTAL_KV.put("tok:" + (await sha256Hex(tok)), JSON.stringify({ email, exp: Date.now() + LINK_HOURS * 3600e3 }), { expirationTtl: LINK_HOURS * 3600 });
  return portalBase(env, origin) + "/set-password#t=" + tok; // in the hash: never sent to servers / logs / referrers
}
function portalBase(env, origin) { return (/^https:\/\/[^\s"<>]+$/.test(String(env.PORTAL_URL || "")) ? String(env.PORTAL_URL) : origin).replace(/\/+$/, ""); }
async function setPasswordFromLink(request, env) {
  let b; try { b = await body(request); } catch (e) { return json({ error: e.message }, e.status || 400); }
  const tok = String(b.token || ""), pw = String(b.password || "");
  if (!tok || tok.length > 100) return json({ error: "This link is not valid." }, 400);
  const prob = passwordProblem(pw); if (prob) return json({ error: prob }, 400);
  const k = "tok:" + (await sha256Hex(tok)), rec = JSON.parse((await env.PORTAL_KV.get(k)) || "null");
  if (!rec || rec.exp < Date.now()) return json({ error: "This link has expired. Ask Taager for a new one." }, 400);
  const a = await getAccount(env, rec.email);
  if (!a || a.status === "disabled") return json({ error: "This account is not active." }, 403);
  await env.PORTAL_KV.delete(k);
  a.pw = await makePasswordRecord(pw); a.status = "active"; a.tv = (a.tv || 0) + 1; a.lastLoginAt = new Date().toISOString();
  await putAccount(env, a);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await issueSession(env, a)) });
}
async function changePassword(request, env, a) {
  let b; try { b = await body(request); } catch (e) { return json({ error: e.message }, e.status || 400); }
  if (await blocked(env, "chg:" + a.email, 8)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
  if (!(await checkPassword(String(b.current || ""), a.pw))) { await hit(env, "chg:" + a.email, 8); return json({ error: "Your current password is wrong." }, 400); }
  const prob = passwordProblem(b.next); if (prob) return json({ error: prob }, 400);
  a.pw = await makePasswordRecord(String(b.next)); a.tv = (a.tv || 0) + 1; await putAccount(env, a); // signs out other devices
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await issueSession(env, a)) });
}
async function forgotPassword(request, env, url) {
  let b; try { b = await body(request); } catch (e) { return json({ error: e.message }, e.status || 400); }
  const email = normEmail(b.email), ip = request.headers.get("CF-Connecting-IP") || "local";
  if (!emailEnabled(env)) return json({ error: "Ask your Taager account manager for a new password link." }, 400);
  if (!okEmail(email) || (await hit(env, "fp:" + ip, 10)) || (await hit(env, "fpe:" + email, 3))) return json({ ok: true }); // same answer every time
  const a = await getAccount(env, email);
  if (a && a.status !== "disabled") {
    const link = await newLink(env, email, url.origin);
    await sendMail(env, email, "Reset your Taager merchant portal password", mailHtml("Reset your password", "Use the button below to choose a new password. The link works for " + LINK_HOURS + " hours.", link, "Choose a new password"));
  }
  return json({ ok: true });
}

// ============================================================================ email (optional, via Resend)
function emailEnabled(env) { return !!(env.RESEND_API_KEY && env.MAIL_FROM); }
function escHtml(t) { return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function mailHtml(title, text, link, button) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111"><h2 style="margin:0 0 12px">' + escHtml(title) + '</h2><p style="line-height:1.6">' + escHtml(text) + '</p>' +
    '<p style="margin:24px 0"><a href="' + escHtml(link) + '" style="background:#0f9d7a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">' + escHtml(button) + '</a></p>' +
    '<p style="color:#666;font-size:12px">If you did not expect this email you can ignore it.</p></div>';
}
async function sendMail(env, to, subject, html) {
  if (!emailEnabled(env)) return false;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }) });
  return r.ok;
}

// ============================================================================ admin
async function adminRoute(request, env, ctx, url) {
  const p = url.pathname, m = request.method;
  let b = {}; if (m === "POST") { try { b = await body(request); } catch (e) { return json({ error: e.message }, e.status || 400); } }
  if (p === "/api/admin/check") return json({ ok: true, emailEnabled: emailEnabled(env) });
  if (p === "/api/admin/status" && m === "GET") return json(await dataStatus(env));
  if (p === "/api/admin/refresh" && m === "POST") {
    ctx.waitUntil(refreshData(env, "admin").catch((e) => console.error("admin refresh failed", e)));
    return json({ ok: true, message: "Refresh started — it can take a few minutes." });
  }
  if (p === "/api/admin/accounts" && m === "GET") {
    const out = []; let cursor;
    do {
      const page = await env.PORTAL_KV.list({ prefix: "acct:", cursor });
      const recs = await Promise.all(page.keys.map((k) => env.PORTAL_KV.get(k.name)));
      recs.forEach((t) => { if (t) out.push(publicAccount(JSON.parse(t))); });
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    out.sort((x, y) => x.email.localeCompare(y.email));
    return json({ accounts: out });
  }
  if (p === "/api/admin/accounts" && m === "POST") {
    const email = normEmail(b.email), ids = normIds(b.merchantIds);
    if (!okEmail(email)) return json({ error: "Enter a valid email." }, 400);
    if (!ids.length) return json({ error: "Enter at least one Merchant ID." }, 400);
    let a = await getAccount(env, email), created = false;
    if (!a) { a = { email, status: "invited", tv: 0, pw: null, createdAt: new Date().toISOString() }; created = true; }
    a.name = String(b.name || a.name || "").trim().slice(0, 120); a.merchantIds = ids;
    if (a.status !== "active" && a.status !== "invited") a.status = a.status || "invited";
    await putAccount(env, a);
    let link = "", mailed = false;
    if (created || b.sendLink) { link = await newLink(env, email, url.origin); if (b.email_link !== false && emailEnabled(env)) mailed = await sendMail(env, email, "Your Taager merchant portal account", mailHtml("Welcome to the Taager merchant portal", "Your account is ready. Choose a password to see your performance. The link works for " + LINK_HOURS + " hours.", link, "Choose your password")); }
    return json({ ok: true, account: publicAccount(a), link, mailed });
  }
  if (p === "/api/admin/accounts/link" && m === "POST") {
    const a = await getAccount(env, b.email); if (!a) return json({ error: "No such account." }, 404);
    if (a.status === "disabled") return json({ error: "Enable the account first." }, 400);
    a.tv = (a.tv || 0) + 1; await putAccount(env, a); // the old password keeps working, open sessions are signed out
    const link = await newLink(env, a.email, url.origin);
    const mailed = b.email_link !== false && emailEnabled(env) ? await sendMail(env, a.email, "Set your Taager merchant portal password", mailHtml("Set your password", "Use the button below to choose a password. The link works for " + LINK_HOURS + " hours.", link, "Choose a password")) : false;
    return json({ ok: true, link, mailed });
  }
  if (p === "/api/admin/accounts/status" && m === "POST") {
    const a = await getAccount(env, b.email); if (!a) return json({ error: "No such account." }, 404);
    a.status = b.status === "disabled" ? "disabled" : (a.pw && a.pw.hash ? "active" : "invited");
    a.tv = (a.tv || 0) + 1; await putAccount(env, a); // signs the merchant out everywhere
    return json({ ok: true, account: publicAccount(a) });
  }
  if (p === "/api/admin/accounts/delete" && m === "POST") {
    await env.PORTAL_KV.delete("acct:" + normEmail(b.email));
    return json({ ok: true });
  }
  if (p === "/api/admin/import-dashboard" && m === "POST") return importFromDashboard(env, url, b);
  return json({ error: "Not found" }, 404);
}

// Copies the Merchant users that were set up in the staff dashboard (Control → Users & Roles) into the portal.
async function importFromDashboard(env, url, b) {
  const base = String(env.DASHBOARD_WORKER_URL || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) return json({ error: "Set the DASHBOARD_WORKER_URL variable first." }, 400);
  const r = await fetch(base + "?action=getAccess", { headers: env.DASHBOARD_SERVICE_KEY ? { "X-Service-Key": env.DASHBOARD_SERVICE_KEY } : {} });
  if (!r.ok) return json({ error: "The dashboard Worker answered " + r.status + "." }, 502);
  const cfg = await r.json().catch(() => null);
  const users = (cfg && cfg.users) || {}, out = [];
  for (const em of Object.keys(users)) {
    const u = typeof users[em] === "string" ? { role: users[em] } : users[em];
    if (!u || (u.role !== "Merchant" && u.role !== "Viewer")) continue;
    const email = normEmail(em), ids = normIds(u.merchantId);
    if (!okEmail(email) || !ids.length) { out.push({ email, skipped: "no Merchant ID" }); continue; }
    let a = await getAccount(env, email);
    if (a) { a.merchantIds = normIds(a.merchantIds.concat(ids)); if (!a.name && u.name) a.name = String(u.name).slice(0, 120); await putAccount(env, a); out.push({ email, updated: true }); continue; }
    a = { email, name: String(u.name || "").slice(0, 120), merchantIds: ids, status: "invited", tv: 0, pw: null, createdAt: new Date().toISOString() };
    await putAccount(env, a);
    const link = await newLink(env, email, url.origin);
    const mailed = b.email_link !== false && emailEnabled(env) ? await sendMail(env, email, "Your Taager merchant portal account", mailHtml("Welcome to the Taager merchant portal", "Your account is ready. Choose a password to see your performance. The link works for " + LINK_HOURS + " hours.", link, "Choose your password")) : false;
    out.push({ email, created: true, link, mailed });
  }
  return json({ ok: true, results: out });
}

// ============================================================================ data
// KV layout: data:meta (JSON) + data:shard:<n> (gzip JSON { merchantId: { n: name, r: rows } }).
// A row = [month "YYYY-MM", placedOrders, confirmedOrders, deliveredOrders, placedPcs, confirmedPcs, deliveredPcs, deliveredGmv]
function shardCount(env) { const n = parseInt(env.DATA_SHARDS || "", 10); return n >= 1 && n <= 256 ? n : DEFAULT_SHARDS; }
function shardOf(id, n) { let h = 0x811c9dc5; const s = String(id); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0) % n; }
function columns(env) {
  if (!env.QUERY_COLUMNS) return DEFAULT_COLS;
  try { return Object.assign({}, DEFAULT_COLS, JSON.parse(env.QUERY_COLUMNS)); } catch (e) { return DEFAULT_COLS; }
}
async function readMeta(env) { const t = await env.PORTAL_KV.get("data:meta"); return t ? JSON.parse(t) : null; }
async function dataStatus(env) {
  const meta = await readMeta(env), err0 = JSON.parse((await env.PORTAL_KV.get("data:error")) || "null"), derr = JSON.parse((await env.PORTAL_KV.get("data:dailyError")) || "null");
  let err = err0 || (derr ? { at: derr.at, message: "Daily numbers: " + derr.message } : null);
  const spE = JSON.parse((await env.PORTAL_KV.get("data:spError")) || "null"), spM = await readSpMeta(env); if (spE && !err) { err = { at: spE.at, message: "Sales Plan: " + spE.message }; }
  const incE = JSON.parse((await env.PORTAL_KV.get("data:incError")) || "null"), invE = JSON.parse((await env.PORTAL_KV.get("data:invError")) || "null");
  if (incE && !err) err = { at: incE.at, message: "Incentives: " + incE.message };
  if (invE && !err) err = { at: invE.at, message: "Inventory: " + invE.message };
  const invM = JSON.parse((await env.PORTAL_KV.get("inv:meta")) || "null"), incD = JSON.parse((await env.PORTAL_KV.get("inc:data")) || "null");
  return { inventory: invM ? { builtAt: invM.builtAt, latest: invM.latest, merchants: invM.merchants, rows: invM.rows } : null, incentives: incD ? { builtAt: incD.builtAt, month: incD.month, merchants: Object.keys(incD.rows || {}).length } : null, meta, salesPlan: spM ? { builtAt: spM.builtAt, latest: spM.latest, merchants: spM.merchants, planRows: spM.planRows, actRows: spM.actRows } : null, lastError: err, daily: env.DAILY_QUERY_URL ? "DAILY_QUERY_URL" : "not configured", source: env.METABASE_API_KEY ? "Metabase API key (merchant query)" : (env.MERCHANT_QUERY_URL ? "MERCHANT_QUERY_URL" : "not configured"), columns: columns(env), refreshing: !!(await env.PORTAL_KV.get("data:lock")) };
}

const shardCache = new Map(); // isolate memory: "<builtAt>:<n>" -> parsed shard
async function readShard(env, meta, n) {
  const ck = meta.builtAt + ":" + n;
  if (shardCache.has(ck)) return shardCache.get(ck);
  const buf = await env.PORTAL_KV.get("data:shard:" + n, { type: "arrayBuffer" });
  const obj = buf ? JSON.parse(await gunzip(buf)) : {};
  if (shardCache.size > 64) shardCache.clear();
  shardCache.set(ck, obj);
  return obj;
}
async function merchantData(a, env, ctx) {
  const meta = await readMeta(env);
  const maxAge = (parseInt(env.DATA_MAX_AGE_MIN || "", 10) || DEFAULT_MAX_AGE_MIN) * 60e3;
  if (!meta || Date.now() - Date.parse(meta.builtAt) > maxAge) ctx.waitUntil(refreshData(env, "stale").catch((e) => console.error("refresh failed", e)));
  if (!meta) return json({ error: "Your numbers are being prepared. Please try again in a few minutes." }, 503);
  const merchants = [], rows = [], byId = [];
  const daily = await readDaily(env).catch(() => null);
  for (const id of a.merchantIds || []) {
    const sh = await readShard(env, meta, shardOf(id, meta.shards));
    const m = sh[id];
    merchants.push({ id, name: (m && m.n) || "" });
    byId.push({ id, name: (m && m.n) || "", rows: m ? m.r : [], daily: (daily && daily.byId && daily.byId[id]) || [] });
    if (m) m.r.forEach((r) => rows.push(r));
  }
  rows.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return json({ updatedAt: meta.builtAt, dailyAt: daily ? daily.builtAt : null, dailyOn: !!env.DAILY_QUERY_URL, latestMonth: meta.latestMonth, merchants, rows, byId });
}

// ============================================================================ Merchant Targets
// The staff dashboard's Merchant Targets upload (TAGER_ID | name | Target GMV | Target Placed) is read from the dashboard Worker
// with the service key, parsed like js/app.js parseTargetsSheet, and only the signed-in merchant's own IDs are returned.
const targetsCache = new Map(); // "YYYY-MM" -> { at, map }   (isolate memory only; the full map is never sent to a browser)
const tText = (c) => (c == null ? "" : String(c.f != null ? c.f : (c.v != null ? c.v : "")));
const tNum = (c) => { if (!c) return 0; if (typeof c.v === "number") return c.v; const n = parseFloat(String(c.f != null ? c.f : (c.v != null ? c.v : "0")).replace(/[%,]/g, "")); return Number.isFinite(n) ? n : 0; };
function parseTargets(payload) {
  const rows = (payload && payload.table && payload.table.rows) || [], out = {};
  let col = null;
  const norm = (c) => tText(c).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const r of rows) {
    const c = (r && r.c) || [];
    if (!c.length) continue;
    const id = tText(c[0]).trim();
    if (!id) continue;
    const key = id.toLowerCase().replace(/[\s_]+/g, "");
    if (key === "tagerid" || key === "merchantid" || key === "id") {
      const m = { gmv: -1, placed: -1 };
      c.forEach((cell, i) => { const h = norm(cell); if (h.includes("gmv")) m.gmv = i; else if (h.includes("placed")) m.placed = i; });
      if (m.gmv >= 0 && m.placed >= 0) col = m;
      continue;
    }
    let g, pl;
    if (col) { g = col.gmv; pl = col.placed; } else if (c.length >= 5) { g = 3; pl = 4; } else { g = 2; pl = 3; }
    out[id] = { gmv: tNum(c[g]), placed: tNum(c[pl]), name: tText(c[1]).trim() };
  }
  return out;
}
async function loadTargetsMap(env, month) {
  const hit = targetsCache.get(month);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.map;
  const base = String(env.DASHBOARD_WORKER_URL || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("DASHBOARD_WORKER_URL is not set.");
  if (!env.DASHBOARD_SERVICE_KEY) throw new Error("DASHBOARD_SERVICE_KEY secret is not set.");
  const res = await fetch(base + "?action=getPortalTargets&month=" + encodeURIComponent(month), { headers: { "X-Service-Key": env.DASHBOARD_SERVICE_KEY } });
  if (res.status === 403) throw new Error("The dashboard did not accept DASHBOARD_SERVICE_KEY.");
  if (!res.ok) throw new Error("The dashboard answered HTTP " + res.status + ".");
  let payload = null;
  try { payload = JSON.parse(await res.text()); } catch (e) { payload = null; }
  const map = parseTargets(payload);
  if (targetsCache.size > 24) targetsCache.clear();
  targetsCache.set(month, { at: Date.now(), map });
  return map;
}
async function merchantTargets(a, env, url) {
  const month = url.searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "Bad month." }, 400);
  let map;
  try { map = await loadTargetsMap(env, month); } catch (e) { console.error("targets failed", e && e.message); return json({ month, targets: {}, note: "Targets are not available right now. Please try again later." }); }
  const targets = {};
  for (const id of a.merchantIds || []) if (map[id]) targets[id] = { gmv: map[id].gmv, placed: map[id].placed, name: map[id].name };
  return json({ month, targets });
}

// The one and only data source of the portal: the merchant query.
async function fetchMerchantQuery(env) {
  if (env.METABASE_API_KEY && env.METABASE_URL && env.MERCHANT_CARD_ID) {
    const u = String(env.METABASE_URL).replace(/\/+$/, "") + "/api/card/" + encodeURIComponent(env.MERCHANT_CARD_ID) + "/query/csv";
    return fetch(u, { method: "POST", headers: { "x-api-key": env.METABASE_API_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: "format_rows=false" });
  }
  if (env.MERCHANT_QUERY_URL) {
    // accept the link in any of its forms: /public/question/<uuid>, …/<uuid>.json, /api/public/card/<uuid>/query/json|csv
    const m = /^(https:\/\/[^/]+)\/(?:public\/question|api\/public\/card)\/([0-9a-f-]{36})/i.exec(String(env.MERCHANT_QUERY_URL));
    if (!m) throw new Error("MERCHANT_QUERY_URL is not a Metabase public question link.");
    return fetch(m[1] + "/api/public/card/" + m[2] + "/query/csv", { headers: { Accept: "text/csv" } });
  }
  throw new Error("No data source: set the MERCHANT_QUERY_URL secret, or METABASE_URL + METABASE_API_KEY + MERCHANT_CARD_ID.");
}

// Streaming CSV parser (same rules as js/app.js metabaseParseCsv), so the whole export never sits in memory.
function csvParser(onRow) {
  let row = [], field = "", inQ = false, quoteSeen = false, first = true, skipLF = false;
  return {
    push(chunk) {
      if (first) { if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1); first = false; }
      let i0 = 0;
      if (skipLF && chunk.charCodeAt(0) === 10) i0 = 1; // "\r" ended the last chunk, "\n" starts this one
      skipLF = false;
      for (let i = i0; i < chunk.length; i++) {
        const ch = chunk.charCodeAt(i);
        if (inQ) {
          if (ch === 34) { inQ = false; quoteSeen = true; continue; }
          const j = chunk.indexOf('"', i); if (j === -1) { field += chunk.slice(i); break; }
          field += chunk.slice(i, j); i = j - 1; continue;
        }
        if (ch === 34) { if (quoteSeen) field += '"'; inQ = true; quoteSeen = false; continue; } // "" inside quotes
        quoteSeen = false;
        if (ch === 44) { row.push(field); field = ""; continue; }
        if (ch === 10 || ch === 13) { if (ch === 13) { if (i + 1 === chunk.length) skipLF = true; else if (chunk.charCodeAt(i + 1) === 10) i++; } row.push(field); field = ""; onRow(row); row = []; continue; }
        let j = i + 1; // copy the whole run of ordinary characters at once
        while (j < chunk.length) { const c2 = chunk.charCodeAt(j); if (c2 === 44 || c2 === 10 || c2 === 13 || c2 === 34) break; j++; }
        field += chunk.slice(i, j); i = j - 1;
      }
    },
    end() { if (field !== "" || row.length) { row.push(field); onRow(row); } }
  };
}
const num = (v) => { if (v == null || v === "") return 0; const n = parseFloat(String(v).replace(/[%,]/g, "")); return Number.isFinite(n) ? n : 0; };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "2026-10-01T00:00:00Z" / "2026-10" / "October, 2026" / "Oct 2026" → "2026-10"
function normMonth(v) {
  const s = String(v || "").trim();
  let m = /^(\d{4})-(\d{1,2})/.exec(s); if (m) return m[1] + "-" + m[2].padStart(2, "0");
  m = /([A-Za-z]{3})[A-Za-z]*[\s,.-]+(\d{4})/.exec(s); if (m && MONTHS.indexOf(m[1].toLowerCase()) >= 0) return m[2] + "-" + String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0");
  const t = Date.parse(s); if (!Number.isFinite(t)) return "";
  const d = new Date(t); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

async function refreshData(env, why) {
  if (await env.PORTAL_KV.get("data:lock")) return { skipped: "already running" };
  await env.PORTAL_KV.put("data:lock", why + " " + new Date().toISOString(), { expirationTtl: 600 });
  const t0 = Date.now();
  try {
    const C = columns(env), S = shardCount(env);
    const res = await fetchMerchantQuery(env);
    if (!res.ok) throw new Error("Data source answered HTTP " + res.status);
    const by = new Map(); let header = null, rowCount = 0, kept = 0, latest = "";
    const parser = csvParser((c) => {
      if (!header) { header = c.slice(0, 40); return; }
      if (c.length === 1 && c[0] === "") return;
      rowCount++;
      const month = normMonth(c[C.month]), mid = String(c[C.merchantId] || "").trim();
      if (!month || !mid || mid === "TAGER_ID") return;
      let m = by.get(mid); if (!m) { m = { n: "", g: new Map() }; by.set(mid, m); }
      if (c[C.merchantName]) m.n = String(c[C.merchantName]).slice(0, 120);
      let r = m.g.get(month); if (!r) { r = [month, 0, 0, 0, 0, 0, 0, 0, ""]; m.g.set(month, r); }
      if (C.segmentation >= 0 && c[C.segmentation]) r[8] = String(c[C.segmentation]).trim().slice(0, 40);
      r[1] += num(c[C.placedOrders]); r[2] += num(c[C.confirmedOrders]); r[3] += num(c[C.deliveredOrders]);
      r[4] += num(c[C.placedPieces]); r[5] += num(c[C.confirmedPieces]); r[6] += num(c[C.deliveredPieces]); r[7] += num(c[C.deliveredGmv]);
      if (month > latest) latest = month; kept++;
    });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; parser.push(value); }
    parser.end();
    if (!header) throw new Error("The data source returned nothing.");
    if (/^\s*[{<]/.test(header.join(","))) throw new Error("The data source did not return CSV: " + header.join(",").slice(0, 120));
    if (kept === 0) throw new Error("No usable rows (" + rowCount + " rows read). Check QUERY_COLUMNS against the header.");
    // never replace good data with a near-empty export (same guard as the dashboard)
    const prev = await readMeta(env);
    if (prev && prev.rows > 1000 && kept < prev.rows * 0.2) throw new Error("Only " + kept + " rows this time vs " + prev.rows + " before — kept the previous data.");

    const shards = Array.from({ length: S }, () => ({}));
    by.forEach((m, id) => {
      const rows = Array.from(m.g.values()).map((r) => { for (let i = 1; i < 8; i++) r[i] = Math.round(r[i] * 100) / 100; return r; });
      rows.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      shards[shardOf(id, S)][id] = { n: m.n, r: rows };
    });
    for (let i = 0; i < S; i++) await env.PORTAL_KV.put("data:shard:" + i, await gzip(JSON.stringify(shards[i])));
    const meta = { builtAt: new Date().toISOString(), rows: kept, sourceRows: rowCount, merchants: by.size, shards: S, latestMonth: latest, header, why, ms: Date.now() - t0 };
    await env.PORTAL_KV.put("data:meta", JSON.stringify(meta));
    await env.PORTAL_KV.delete("data:error");
    shardCache.clear();
    // Daily numbers (Daily Pipeline): optional second source, never allowed to break the monthly data above.
    try { await refreshDaily(env); } catch (e) { await env.PORTAL_KV.put("data:dailyError", JSON.stringify({ at: new Date().toISOString(), message: String(e && e.message || e) })); }
    // Sales Plan: Google Sheet tabs (targets + actuals), also never allowed to break the data above.
    try { await refreshSalesPlan(env); } catch (e) { await env.PORTAL_KV.put("data:spError", JSON.stringify({ at: new Date().toISOString(), message: String(e && e.message || e) })); }
    try { await refreshIncentives(env); } catch (e) { await env.PORTAL_KV.put("data:incError", JSON.stringify({ at: new Date().toISOString(), message: String(e && e.message || e) })); }
    try { await refreshInventory(env); } catch (e) { await env.PORTAL_KV.put("data:invError", JSON.stringify({ at: new Date().toISOString(), message: String(e && e.message || e) })); }
    return meta;
  } catch (e) {
    await env.PORTAL_KV.put("data:error", JSON.stringify({ at: new Date().toISOString(), message: String(e && e.message || e), why }));
    throw e;
  } finally {
    await env.PORTAL_KV.delete("data:lock");
  }
}
// ============================================================================ daily numbers
// Source: the DAILY_QUERY_URL secret = the "Merchant SKU Daily" Metabase question (one row per SKU × merchant).
// Columns (js/app.js parseMerchantSkuDailySheet): 2 TAGER_ID, 13..44 DAY0..DAY31 placed pieces (DAY0 = today, DAY1 = yesterday ...),
// 45..76 DAY_0_CONFIRMED..DAY_31_CONFIRMED confirmed pieces. Only the merchants that have a portal account are kept, summed per day;
// every other column (ACM, SKU, other merchants) is dropped while streaming. Days are merged into what is already stored,
// so the history grows past the 32-day window of the query (kept for 93 days).
const DAILY = { merchantId: 2, placed0: 13, confirmed0: 45, days: 32 };
function cairoToday() { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); return p; } // YYYY-MM-DD
function addDays(ymd, n) { const t = Date.parse(ymd + "T00:00:00Z") + n * 864e5; const d = new Date(t); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
async function accountMerchantIds(env) {
  const ids = new Set(); let cursor;
  do {
    const page = await env.PORTAL_KV.list({ prefix: "acct:", cursor });
    for (const k of page.keys) { const t = await env.PORTAL_KV.get(k.name); if (!t) continue; try { (JSON.parse(t).merchantIds || []).forEach((i) => ids.add(String(i))); } catch (e) {} }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}
async function refreshDaily(env) {
  if (!env.DAILY_QUERY_URL) return null;
  const m0 = /^(https:\/\/[^/]+)\/(?:public\/question|api\/public\/card)\/([0-9a-f-]{36})/i.exec(String(env.DAILY_QUERY_URL));
  if (!m0) throw new Error("DAILY_QUERY_URL is not a Metabase public question link.");
  const want = await accountMerchantIds(env), today = cairoToday();
  const res = await fetch(m0[1] + "/api/public/card/" + m0[2] + "/query/csv", { headers: { Accept: "text/csv" } });
  if (!res.ok) throw new Error("Daily source answered HTTP " + res.status);
  const by = new Map(), statsBy = new Map(); let header = null, rowCount = 0, kept = 0;
  const parser = csvParser((c) => {
    if (!header) { header = c.slice(0, 80); return; }
    if (c.length === 1 && c[0] === "") return;
    rowCount++;
    const mid = String(c[DAILY.merchantId] || "").trim();
    if (!mid || !want.has(mid)) return;
    const sku0 = String(c[0] || "").trim();
    if (sku0) { let sm = statsBy.get(mid); if (!sm) { sm = {}; statsBy.set(mid, sm); } sm[sku0] = [Math.round(pctOf(c[8]) * 100) / 100, Math.round(pctOf(c[9]) * 100) / 100, Math.round(num(c[12]) * 100) / 100]; }
    let m = by.get(mid); if (!m) { m = new Map(); by.set(mid, m); }
    for (let n = 0; n < DAILY.days; n++) {
      const pp = num(c[DAILY.placed0 + n]), cp = num(c[DAILY.confirmed0 + n]);
      const day = addDays(today, -n);
      let r = m.get(day); if (!r) { r = [day, 0, 0, 0, 0, 0, 0, 0]; m.set(day, r); }
      r[4] += pp; r[5] += cp;
    }
    kept++;
  });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; parser.push(value); }
  parser.end();
  if (!header) throw new Error("The daily source returned nothing.");
  if (/^\s*[{<]/.test(header.join(","))) throw new Error("The daily source did not return CSV.");
  if (header.length < 70) throw new Error("The daily source has " + header.length + " columns, expected 77 (Merchant SKU Daily).");
  // merge into the stored history (new days overwrite, older days stay), keep 93 days
  const prev = await readDaily(env).catch(() => null), out = {}, cutoff = addDays(today, -93);
  const ids = new Set([...Object.keys((prev && prev.byId) || {}), ...by.keys()]);
  ids.forEach((id) => {
    const merged = new Map(); (((prev && prev.byId && prev.byId[id]) || [])).forEach((r) => merged.set(r[0], r));
    if (by.has(id)) by.get(id).forEach((r, day) => { for (let i = 4; i < 6; i++) r[i] = Math.round(r[i] * 100) / 100; merged.set(day, r); });
    out[id] = Array.from(merged.values()).filter((r) => r[0] >= cutoff).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  });
  // per-match CR_2_DAY / DR_5_DAYS / ASP (columns 8, 9, 12 — js/app.js parseMerchantSkuDailySheet) for Sales Plan; skipped if the header is not what we expect
  if (/cr/i.test(header[8] || "") && /dr/i.test(header[9] || "") && /asp/i.test(header[12] || "")) {
    const so = {}; statsBy.forEach((v, id) => { so[id] = v; });
    await env.PORTAL_KV.put("data:stats", await gzip(JSON.stringify({ builtAt: new Date().toISOString(), byId: so }))); statsCache = null;
  } else await env.PORTAL_KV.put("data:spError", JSON.stringify({ at: new Date().toISOString(), message: "Merchant SKU Daily columns 8/9/12 are not CR / DR / ASP (" + [header[8], header[9], header[12]].join(" | ") + ") — CR/DR/ASP not updated." }));
  await env.PORTAL_KV.put("data:daily", await gzip(JSON.stringify({ builtAt: new Date().toISOString(), rows: kept, sourceRows: rowCount, merchants: by.size, byId: out })));
  await env.PORTAL_KV.delete("data:dailyError");
  dailyCache = null;
  return { rows: kept };
}
let dailyCache = null; // { at, obj }
let statsCache = null;
async function readStats(env) {
  if (statsCache && Date.now() - statsCache.at < 60e3) return statsCache.obj;
  const buf = await env.PORTAL_KV.get("data:stats", { type: "arrayBuffer" });
  const obj = buf ? JSON.parse(await gunzip(buf)) : null;
  statsCache = { at: Date.now(), obj };
  return obj;
}
// same rule as js/app.js merchantSkuDailyPercent: always on a 0-100 scale ("0.6" and "60%" both mean 60)
function pctOf(v) { const t = String(v == null ? "" : v).trim(); if (!t) return 0; const n = parseFloat(t.replace(/[%,]/g, "")); if (!Number.isFinite(n)) return 0; if (t.indexOf("%") >= 0) return n; return n > 0 && n <= 1 ? n * 100 : n; }
async function readDaily(env) {
  if (dailyCache && Date.now() - dailyCache.at < 60e3) return dailyCache.obj;
  const buf = await env.PORTAL_KV.get("data:daily", { type: "arrayBuffer" });
  const obj = buf ? JSON.parse(await gunzip(buf)) : null;
  dailyCache = { at: Date.now(), obj };
  return obj;
}
async function gzip(text) { return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(); }
async function gunzip(buf) { return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); }


// ============================================================================ Sales Plan
// Targets: Google Sheet tab "Sales Plan-ACM (daily)" (js/app.js ACM_SALES_PLAN_GID / parseAcmSalesPlanSheet): SKU ID | Name | Category | Merchant ID | Merchant | Target Placed Daily (F) | New Target Daily (G) | Match Flag (H) | Last Target Update (I).
// Actuals: the Google Sheet tab that mirrors the Main query (CREATION_DATE | TAGER_ID | ... | PRODUCT_ID (D) | ... | PLACED_PIECES (P) | CONFIRMED_PIECES (Q) | DELIVERED_PIECES (R) | ... | DELIVERED_GMV (W)).
// Both tabs are read on the server with a gviz query that only asks for the merchants that have a portal account; nothing here is ever sent to a browser except the signed-in merchant's own matches.
// CR% / DR% / ASP per match come from the Merchant SKU Daily query (stored by refreshDaily as data:stats).
const SP_DEFAULT = { sheet: "1Vg8P1EL5y_FqQSR7_uDI1XtB-gDe0Bkj7IqbiOzNgxA", actuals: "444785453", targets: "892918900" };
function spCfg(env) { return { sheet: String(env.SHEET_ID || SP_DEFAULT.sheet), actuals: String(env.SP_ACTUALS_GID || SP_DEFAULT.actuals), targets: String(env.SP_TARGETS_GID || SP_DEFAULT.targets) }; }
async function gvizCsv(cfg, gid, q) {
  const res = await fetch("https://docs.google.com/spreadsheets/d/" + encodeURIComponent(cfg.sheet) + "/gviz/tq?gid=" + encodeURIComponent(gid) + "&tqx=out:csv&tq=" + encodeURIComponent(q), { headers: { Accept: "text/csv" } });
  if (!res.ok) throw new Error("Google Sheets answered HTTP " + res.status + " for tab " + gid + " (is it shared with 'anyone with the link'?)");
  return res;
}
async function eachCsvRow(res, cb) {
  let header = null;
  const parser = csvParser((c) => { if (!header) { header = c; return; } if (c.length === 1 && c[0] === "") return; cb(c); });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; parser.push(value); }
  parser.end();
  if (!header) throw new Error("Google Sheets returned nothing.");
  if (/^\s*</.test(String(header[0]))) throw new Error("Google Sheets did not return CSV (tab not shared?).");
  return header;
}
const spShardCache = new Map();
let spMetaCache = null;
async function readSpMeta(env) {
  if (spMetaCache && Date.now() - spMetaCache.at < 30e3) return spMetaCache.v;
  const t = await env.PORTAL_KV.get("sp:meta"); const v = t ? JSON.parse(t) : null;
  spMetaCache = { at: Date.now(), v };
  return v;
}
async function readSpShard(env, meta, n) {
  const key = meta.builtAt + ":" + n, hit = spShardCache.get(key); if (hit) return hit;
  const buf = await env.PORTAL_KV.get("sp:shard:" + n, { type: "arrayBuffer" });
  const obj = buf ? JSON.parse(await gunzip(buf)) : {};
  if (spShardCache.size > 16) spShardCache.clear();
  spShardCache.set(key, obj);
  return obj;
}
async function refreshSalesPlan(env) {
  const cfg = spCfg(env), t0 = Date.now(), want = await accountMerchantIds(env);
  if (!want.size) return null;
  // 1) targets (small tab: read it all, keep only the merchants with an account)
  const plans = new Map(), skuSet = new Map(); let planRows = 0;
  await eachCsvRow(await gvizCsv(cfg, cfg.targets, "select *"), (c) => {
    const sku = String(c[0] || "").trim(), mid = String(c[3] || "").trim();
    if (!sku || !mid || !want.has(mid) || sku === "Product ID" || sku === "SKU ID") return;
    const nr = String(c[6] == null ? "" : c[6]).trim(), nn = nr === "" ? null : parseFloat(nr.replace(/,/g, ""));
    const dm = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(c[8] || ""));
    const upd = dm ? dm[1] + "-" + dm[2].padStart(2, "0") + "-" + dm[3].padStart(2, "0") : "";
    let a = plans.get(mid); if (!a) { a = []; plans.set(mid, a); }
    a.push([sku, String(c[1] || "").slice(0, 200), String(c[2] || "").trim().slice(0, 60) || "Uncategorized", mid, String(c[4] || "").slice(0, 120), num(c[5]), nn !== null && Number.isFinite(nn) ? nn : null, String(c[7] || "").trim().slice(0, 30), upd]);
    let st = skuSet.get(mid); if (!st) { st = new Set(); skuSet.set(mid, st); } st.add(sku); planRows++;
  });
  // 2) latest data day (the dashboard's "today" = the newest day in the data)
  let latest = "";
  await eachCsvRow(await gvizCsv(cfg, cfg.actuals, "select max(A)"), (c) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(String(c[0] || "")); if (m) latest = m[1]; });
  if (!latest) latest = cairoToday();
  // 3) actuals for the merchants that have a plan: last 3 months, only the SKUs that are in their plan
  const lp = latest.split("-"); let y = +lp[0], mo = +lp[1] - 2; while (mo < 1) { mo += 12; y--; }
  const since = y + "-" + String(mo).padStart(2, "0") + "-01";
  const ids = Array.from(skuSet.keys()).filter((x) => /^\d+$/.test(x)), act = new Map(), seen = new Set(); let actRows = 0, read = 0;
  for (let i = 0; i < ids.length; i += 30) {
    const cond = ids.slice(i, i + 30).map((x) => "B = " + x).join(" or ");
    await eachCsvRow(await gvizCsv(cfg, cfg.actuals, "select A,B,D,P,Q,R,W where (" + cond + ") and A >= date '" + since + "'"), (c) => {
      read++;
      const dm = /(\d{4}-\d{2}-\d{2})/.exec(String(c[0] || "")); if (!dm) return;
      const mid = String(c[1] || "").trim(), sku = String(c[2] || "").trim(), st = skuSet.get(mid);
      if (!st || !st.has(sku)) return;
      const key = dm[1] + "|" + mid + "|" + sku; if (seen.has(key)) return; seen.add(key); // same de-dup as parseMainSheet (first row wins)
      const pp = num(c[3]), cp = num(c[4]), dp = num(c[5]), gm = num(c[6]);
      if (!pp && !cp && !dp && !gm) return;
      let a = act.get(mid); if (!a) { a = []; act.set(mid, a); }
      a.push([dm[1], sku, Math.round(pp * 100) / 100, Math.round(cp * 100) / 100, Math.round(dp * 100) / 100, Math.round(gm * 100) / 100]); actRows++;
    });
  }
  if (!planRows) throw new Error("No Sales Plan rows found for the merchants that have an account (tab " + cfg.targets + ").");
  // 4) store (sharded by merchant; a shard is only rewritten when it changed)
  const S = 8, shards = Array.from({ length: S }, () => ({})), prev = await readSpMeta(env), fps = [];
  ids.forEach((id) => { shards[shardOf(id, S)][id] = { p: plans.get(id) || [], a: act.get(id) || [] }; });
  for (let i = 0; i < S; i++) {
    const json = JSON.stringify(shards[i]), fp = await sha256Hex(json); fps.push(fp);
    if (!prev || !prev.fps || prev.fps[i] !== fp || prev.shards !== S) await env.PORTAL_KV.put("sp:shard:" + i, await gzip(json));
  }
  const meta = { builtAt: new Date().toISOString(), latest, since, shards: S, merchants: ids.length, planRows, actRows, sheetRows: read, ms: Date.now() - t0, fps };
  await env.PORTAL_KV.put("sp:meta", JSON.stringify(meta));
  await env.PORTAL_KV.delete("data:spError");
  spMetaCache = null; spShardCache.clear();
  return meta;
}
async function merchantSalesPlan(a, env, url) {
  const month = url.searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "Bad month." }, 400);
  const meta = await readSpMeta(env);
  if (!meta) return json({ month, today: null, plans: [], act: [], stats: {}, note: "Sales Plan is being prepared. Please try again in a few minutes." });
  const stats = (await readStats(env).catch(() => null)) || { byId: {} };
  const plans = [], act = [], st = {};
  for (const id of a.merchantIds || []) {
    const e = (await readSpShard(env, meta, shardOf(id, meta.shards)))[id]; if (!e) continue;
    e.p.forEach((p) => { plans.push(p); const s = stats.byId && stats.byId[id] && stats.byId[id][p[0]]; if (s) st[p[0] + "|" + id] = s; });
    e.a.forEach((r) => { if (r[0].slice(0, 7) === month) act.push([r[0], r[1], id, r[2], r[3], r[4], r[5]]); });
  }
  let today = null; const lm = meta.latest.slice(0, 7);
  if (month === lm) today = meta.latest; else if (month < lm) { const p = month.split("-"); today = month + "-" + String(new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate()).padStart(2, "0"); }
  return json({ month, today, builtAt: meta.builtAt, plans, act, stats: st });
}

// ============================================================================ shared helpers for the sheet-based tabs
const dayOf = (v) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(String(v || "")); return m ? m[1] : ""; };
function monthKeyOf(v) {
  const t = String(v || "").trim(); if (!t) return "";
  let m = /^(\d{4})-(\d{1,2})/.exec(t); if (m) return m[1] + "-" + m[2].padStart(2, "0");
  const d = new Date(t); return isNaN(d.getTime()) ? "" : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function daysInMonthKey(k) { const p = k.split("-"); return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(); }
async function latestDataDay(env, cfg) {
  let latest = "";
  await eachCsvRow(await gvizCsv(cfg, cfg.actuals, "select max(A)"), (c) => { const d = dayOf(c[0]); if (d) latest = d; });
  return latest || cairoToday();
}
// Stores merchant-keyed objects in gz shards (rewriting only the shards that changed) + a small meta record. prefix = "inv" -> inv:shard:i / inv:meta.
async function putShards(env, prefix, S, byId, extraMeta) {
  const shards = Array.from({ length: S }, () => ({}));
  Object.keys(byId).forEach((id) => { shards[shardOf(id, S)][id] = byId[id]; });
  const pt = await env.PORTAL_KV.get(prefix + ":meta"), prev = pt ? JSON.parse(pt) : null, fps = [];
  for (let i = 0; i < S; i++) {
    const js = JSON.stringify(shards[i]), fp = await sha256Hex(js); fps.push(fp);
    if (!prev || !prev.fps || prev.fps[i] !== fp || prev.shards !== S) await env.PORTAL_KV.put(prefix + ":shard:" + i, await gzip(js));
  }
  const meta = Object.assign({ builtAt: new Date().toISOString(), shards: S, fps }, extraMeta || {});
  await env.PORTAL_KV.put(prefix + ":meta", JSON.stringify(meta));
  return meta;
}
const shardMemo = new Map();
async function getShardedFor(env, prefix, ids) {
  const mt = await env.PORTAL_KV.get(prefix + ":meta"); if (!mt) return null;
  const meta = JSON.parse(mt), out = {};
  for (const id of ids) {
    const n = shardOf(id, meta.shards), ck = prefix + ":" + meta.builtAt + ":" + n;
    let sh = shardMemo.get(ck);
    if (!sh) { const buf = await env.PORTAL_KV.get(prefix + ":shard:" + n, { type: "arrayBuffer" }); sh = buf ? JSON.parse(await gunzip(buf)) : {}; if (shardMemo.size > 48) shardMemo.clear(); shardMemo.set(ck, sh); }
    if (sh[id]) out[id] = sh[id];
  }
  return { meta, byId: out };
}

// ============================================================================ Inventory (only the SKUs the merchant works on)
// A merchant's SKUs = SKUs with placed orders in the last 30 days of the Main tab + the SKUs of their Sales Plan.
// Stock/name/category/availability: "Inventory" tab (js/app.js parseInventorySheet: SKU_ID | name | stock | doh | category | availability | locked).
// DOH: exactly buildDebundledStockDohIndex — stock of the single from the Products Debundle Map (col H), demand = confirmed PIECES of ALL merchants over the 3 days
// before today (one aggregated number per SKU; bundles are split into their singles x quantity; a bundle uses its weakest single). Only that DOH number leaves the Worker, never another merchant's figures.
// Per-SKU activity (placed / confirmed orders) is the merchant's OWN rows only.
const INV_GIDS = { inventory: "1780730573", debundle: "1409034448" };
async function refreshInventory(env) {
  const cfg = spCfg(env), t0 = Date.now(), want = await accountMerchantIds(env);
  if (!want.size) return null;
  const today = cairoToday(), latest = await latestDataDay(env, cfg);
  // 1) Sales Plan SKUs (names used when the SKU is not in the Inventory tab)
  const plan = new Map(), planName = new Map();
  await eachCsvRow(await gvizCsv(cfg, cfg.targets, "select *"), (c) => {
    const sku = String(c[0] || "").trim(), mid = String(c[3] || "").trim();
    if (!sku || !mid || !want.has(mid) || sku === "Product ID" || sku === "SKU ID") return;
    let s = plan.get(mid); if (!s) { s = new Set(); plan.set(mid, s); } s.add(sku); planName.set(sku, String(c[1] || "").slice(0, 200));
  });
  // 2) the merchant's own activity, last 30 days
  const since = addDays(latest, -30), yday = addDays(latest, -1), d3 = addDays(latest, -3), d15 = addDays(latest, -15);
  const act = new Map(), seen = new Set(), ids = Array.from(want).filter((x) => /^\d+$/.test(x)); let read = 0;
  for (let i = 0; i < ids.length; i += 30) {
    const cond = ids.slice(i, i + 30).map((x) => "B = " + x).join(" or ");
    await eachCsvRow(await gvizCsv(cfg, cfg.actuals, "select A,B,D,J,K where (" + cond + ") and A >= date '" + since + "'"), (c) => {
      read++;
      const d = dayOf(c[0]); if (!d) return;
      const mid = String(c[1] || "").trim(), sku = String(c[2] || "").trim(); if (!want.has(mid) || !sku) return;
      const key = d + "|" + mid + "|" + sku; if (seen.has(key)) return; seen.add(key);
      const po = num(c[3]), co = num(c[4]);
      let m = act.get(mid); if (!m) { m = new Map(); act.set(mid, m); }
      let e = m.get(sku); if (!e) { e = { placed: 0, py: 0, cy: 0, c3: 0, c15: 0 }; m.set(sku, e); }
      e.placed += po;
      if (d === yday) { e.py += po; e.cy += co; }
      if (d >= d3) e.c3 += co;
      if (d >= d15) e.c15 += co;
    });
  }
  // 3) Inventory tab (only the SKUs we need) + Debundle map + overall demand
  const need = new Set(); plan.forEach((s) => s.forEach((x) => need.add(x))); act.forEach((m) => m.forEach((e, sku) => { if (e.placed > 0) need.add(sku); }));
  const invMap = new Map();
  await eachCsvRow(await gvizCsv(cfg, INV_GIDS.inventory, "select *"), (c) => {
    const sku = String(c[0] || "").trim(); if (!sku || sku === "SKU_ID" || !need.has(sku)) return;
    invMap.set(sku, { name: String(c[1] || "").slice(0, 200), stock: Math.round(num(c[2])), category: String(c[4] || "").trim().slice(0, 60), availability: String(c[5] || "").trim().slice(0, 40) });
  });
  const bundleMap = new Map(), stockBy = new Map(), isBundle = new Map();
  await eachCsvRow(await gvizCsv(cfg, INV_GIDS.debundle, "select *"), (c) => {
    const pid = String(c[0] || "").trim(), single = String(c[3] || "").trim(); if (!pid || pid === "PRODUCT_ID" || !single) return;
    const q = num(c[5]) || 1, stock = num(c[7]) || 0;
    if (!bundleMap.has(pid)) bundleMap.set(pid, []); bundleMap.get(pid).push({ singleId: single, quantity: q });
    if (!stockBy.has(pid)) stockBy.set(pid, stock);
    if (!isBundle.has(pid)) isBundle.set(pid, /^(true|yes|1)$/i.test(String(c[2] || "").trim()));
  });
  const W = 3, wFrom = addDays(today, -W), conf = new Map();
  await eachCsvRow(await gvizCsv(cfg, cfg.actuals, "select D, sum(Q) where A >= date '" + wFrom + "' and A < date '" + today + "' group by D"), (c) => {
    const sku = String(c[0] || "").trim(), v = num(c[1]); if (!sku || !v) return;
    const maps = bundleMap.get(sku);
    if (maps && maps.length) maps.forEach((mp) => conf.set(mp.singleId, (conf.get(mp.singleId) || 0) + v * (mp.quantity || 1)));
    else conf.set(sku, (conf.get(sku) || 0) + v);
  });
  const single = (id) => { const stock = stockBy.has(id) ? stockBy.get(id) : 0, avg = Math.round((conf.get(id) || 0) / W); return { avg, doh: avg > 0 ? stock / avg : stock || 0 }; };
  const getDoh = (sku) => {
    const maps = bundleMap.get(sku) || [], bundle = isBundle.get(sku) || maps.length > 1;
    if (bundle && maps.length) {
      const w = maps.map((mp) => single(mp.singleId)).filter((s) => s.avg > 0);
      if (w.length) { const b = w.reduce((mn, s) => (s.doh < mn.doh ? s : mn), w[0]); return { avg: b.avg, doh: b.doh }; }
      return { avg: 0, doh: stockBy.has(sku) ? stockBy.get(sku) || 0 : 0 };
    }
    return single(sku);
  };
  // 4) rows per merchant: [sku, name, category, stock, doh, availability, placedYday, confirmedYday, confirmed3d, confirmed15d, placed30d]
  const byId = {}; let nRows = 0;
  want.forEach((mid) => {
    const skus = new Set(plan.get(mid) || []), m = act.get(mid);
    if (m) m.forEach((e, sku) => { if (e.placed > 0) skus.add(sku); });
    const rows = [];
    skus.forEach((sku) => {
      const inv = invMap.get(sku), e = (m && m.get(sku)) || { placed: 0, py: 0, cy: 0, c3: 0, c15: 0 }, di = getDoh(sku);
      const stock = inv ? inv.stock : 0, doh = di.avg > 0 ? di.doh : Math.round(stock || 0);
      rows.push([sku, (inv && inv.name) || planName.get(sku) || "Unknown", (inv && inv.category) || "Uncategorized", stock, Math.round(doh * 10) / 10, (inv && inv.availability) || "Unknown", e.py, e.cy, e.c3, e.c15, e.placed]);
    });
    if (rows.length) { byId[mid] = rows; nRows += rows.length; }
  });
  const meta = await putShards(env, "inv", 8, byId, { latest, today, merchants: Object.keys(byId).length, rows: nRows, sheetRows: read, ms: Date.now() - t0 });
  await env.PORTAL_KV.delete("data:invError");
  return meta;
}
async function merchantInventory(a, env) {
  const got = await getShardedFor(env, "inv", a.merchantIds || []);
  if (!got) return json({ rows: [], latest: null, note: "Inventory is being prepared. Please try again in a few minutes." });
  const rows = []; Object.keys(got.byId).forEach((id) => got.byId[id].forEach((r) => rows.push(r)));
  return json({ builtAt: got.meta.builtAt, latest: got.meta.latest, rows });
}

// ============================================================================ Incentives Tracker (only merchants that appear in the incentive config tab)
// Config tab (js/app.js parseIncentiveMerchantsSheet, gid 1548963809): Merchant ID | Name | Status | Tier | Target Confirmed Orders | Bonus / Extra Order | Total Incentive.
// Actuals: confirmed orders this month from the "Merchant Segmentation" tab (gid 620123165: A month, C TAGER_ID, H confirmed orders) - like prepareIncentiveMerchantsData.
// The ACM column of the staff tracker is never sent.
const INC_GIDS = { config: "1548963809", seg: "620123165" };
async function refreshIncentives(env) {
  const cfg = spCfg(env), want = await accountMerchantIds(env);
  if (!want.size) return null;
  const rows = {};
  await eachCsvRow(await gvizCsv(cfg, INC_GIDS.config, "select *"), (c) => {
    const mid = String(c[0] || "").trim(); if (!mid || /^merchant[ _]?id$/i.test(mid) || !want.has(mid)) return;
    rows[mid] = { n: String(c[1] || "").slice(0, 120), status: String(c[2] || "").slice(0, 40), tier: String(c[3] || "").slice(0, 60), target: num(c[4]), bonus: num(c[5]), total: num(c[6]) };
  });
  const month = cairoToday().slice(0, 7), mtd = {};
  if (Object.keys(rows).length) {
    await eachCsvRow(await gvizCsv(cfg, INC_GIDS.seg, "select A,C,H"), (c) => {
      const mid = String(c[1] || "").trim(); if (!rows[mid] || monthKeyOf(c[0]) !== month) return;
      mtd[mid] = (mtd[mid] || 0) + num(c[2]);
    });
  }
  Object.keys(rows).forEach((id) => { rows[id].mtd = mtd[id] || 0; });
  await env.PORTAL_KV.put("inc:data", JSON.stringify({ builtAt: new Date().toISOString(), month, rows }));
  await env.PORTAL_KV.delete("data:incError");
  return { merchants: Object.keys(rows).length, month };
}
// Same formulas as prepareIncentiveMerchantsData for one merchant and one covered month (elapsed days = day of the month, run rate = MTD / elapsed x days in month).
function incDerive(r, today) {
  const month = today.slice(0, 7), totalDays = Math.max(1, daysInMonthKey(month)), elapsed = Math.max(1, parseInt(today.slice(8, 10), 10) || 1);
  const target = r.target || 0, mtd = r.mtd || 0, runRate = (mtd / elapsed) * totalDays;
  const targetMtd = (target / totalDays) * elapsed;
  const attActual = target > 0 ? (mtd / target) * 100 : (mtd > 0 ? 100 : 0), attRun = target > 0 ? (runRate / target) * 100 : (runRate > 0 ? 100 : 0);
  const achieved = mtd >= target, onTrack = !achieved && runRate >= target;
  const extra = Math.max(0, mtd - target), earned = extra * (r.bonus || 0);
  const bonusTarget = target > 0 && runRate >= target ? target * (r.bonus || 0) : 0;
  return { tier: r.tier || "", status: achieved ? "achieved" : onTrack ? "on-track" : "at-risk", target, targetMtd, mtd, runRate, attActual, attRun, bonusPerOrder: r.bonus || 0, extra, earned, bonusTarget, totalBonus: bonusTarget + earned };
}
async function merchantIncentives(a, env) {
  const t = await env.PORTAL_KV.get("inc:data");
  if (!t) return json({ rows: [], month: null, ready: false });
  const d = JSON.parse(t), today = cairoToday(), rows = [];
  for (const id of a.merchantIds || []) { const r = d.rows && d.rows[id]; if (r) rows.push(Object.assign({ id, name: r.n }, incDerive(r, today))); }
  return json({ ready: true, builtAt: d.builtAt, month: today.slice(0, 7), dataMonth: d.month, rows });
}

// ============================================================================ Alert Center (alerts sent from the staff dashboard to the Merchant role or to this merchant's e-mail)
const alertsCache = new Map();
async function merchantAlerts(a, env) {
  const email = normEmail(a.email), hit = alertsCache.get(email);
  if (hit && Date.now() - hit.at < 60e3) return json(hit.v);
  const base = String(env.DASHBOARD_WORKER_URL || "").replace(/\/+$/, "");
  let v;
  try {
    if (!/^https:\/\//.test(base) || !env.DASHBOARD_SERVICE_KEY) throw new Error("not configured");
    const r = await fetch(base + "?action=getPortalAlerts&email=" + encodeURIComponent(email), { headers: { "X-Service-Key": env.DASHBOARD_SERVICE_KEY } });
    const j = r.ok ? JSON.parse(await r.text()) : null;
    if (!j || !Array.isArray(j.alerts)) throw new Error("bad answer");
    v = { alerts: j.alerts.map((x) => ({ id: String(x.id || ""), at: String(x.at || ""), title: String(x.title || "").slice(0, 160), body: String(x.body || "").slice(0, 2000), severity: ["info", "warning", "critical"].indexOf(x.severity) >= 0 ? x.severity : "info", link: String(x.link || "").slice(0, 20) })) };
  } catch (e) { return json({ alerts: [], unavailable: true }); }
  if (alertsCache.size > 200) alertsCache.clear();
  alertsCache.set(email, { at: Date.now(), v });
  return json(v);
}

// exported for the local test (test/smoke.mjs)
export const __test = { refreshInventory, refreshIncentives, merchantInventory, merchantIncentives, merchantAlerts, incDerive, refreshSalesPlan, merchantSalesPlan, refreshDaily, readDaily, csvParser, normMonth, shardOf, refreshData, passwordProblem };
