// Local smoke test: runs the Worker in Node with an in-memory KV and a fake Main CSV.
//   node test/smoke.mjs            → runs the checks
//   node test/smoke.mjs --serve    → also serves the portal on http://localhost:8787 (for manual testing)
import http from "node:http";
import worker, { __test } from "../src/worker.js";

// ---------------------------------------------------------------- fake KV
function makeKV() {
  const m = new Map();
  const live = (k) => { const e = m.get(k); if (!e) return null; if (e.exp && e.exp < Date.now()) { m.delete(k); return null; } return e; };
  return {
    _m: m,
    async get(k, o) { const e = live(k); if (!e) return null; const t = (o && o.type) || (typeof o === "string" ? o : "text"); if (t === "arrayBuffer") return e.v instanceof ArrayBuffer ? e.v : new TextEncoder().encode(e.v).buffer; return typeof e.v === "string" ? e.v : new TextDecoder().decode(e.v); },
    async put(k, v, o) { m.set(k, { v, exp: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); },
    async delete(k) { m.delete(k); },
    async list({ prefix, cursor }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix || "") && live(k)).map((name) => ({ name })), list_complete: true }; }
  };
}

// ---------------------------------------------------------------- fake merchant query (same column positions as the real one)
function mainCsv() {
  const head = ["MONTH", "COUNTRY", "TAGER_ID", "TAGER_NAME", "ACM", "DELIVERED_GMV", "PLACED_ORDERS", "CONFIRMED_ORDERS", "DELIVERED_ORDERS", "CR", "DR", "NDR", "SEGMENT", "NEW_SEGMENT", "PLACED_PCS", "CONFIRMED_PCS", "DELIVERED_PCS", "NEXT_SEG", "PREV_SEG", "FT_MVM", "FT_HVM", "FIRST_MONTH"];
  const lines = [head.join(",")];
  const row = (month, mid, name, gmv, po, co, dO, pp, cp, dp) => {
    const c = [month, "EG", mid, name, "Secret ACM", gmv, po, co, dO, "0.7", "0.6", "0.42", "Gold", "Platinum", pp, cp, dp, "Platinum", "Silver", "", "", ""];
    return c.map((v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(",");
  };
  lines.push(row("2026-09-01T00:00:00Z", "1001", 'Store "A", Cairo', "20,000.25", 200, 150, 100, 260, 190, 130));
  lines.push(row("October, 2026", "1001", 'Store "A", Cairo', "31,010", 280, 200, 140, 320, 220, 160));
  lines.push(row("2026-10-01T00:00:00Z", "2002", "Other Store", 9000, 500, 400, 300, 600, 450, 330));
  return lines.join("\r\n") + "\r\n";
}

const mails = [];
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url === "https://metabase.example/api/public/card/5761d362-9da0-4f6a-9c83-2d569d8c5f38/query/csv") {
    const text = mainCsv(); let i = 0;
    // stream it in awkward chunk sizes to exercise the chunk boundaries of the CSV parser
    const stream = new ReadableStream({ pull(ctrl) { if (i >= text.length) return ctrl.close(); const n = 7 + (i % 13); ctrl.enqueue(new TextEncoder().encode(text.slice(i, i + n))); i += n; } });
    return new Response(stream, { status: 200 });
  }
  if (url === "https://api.resend.com/emails") { mails.push(JSON.parse(opts.body)); return new Response("{}", { status: 200 }); }
  if (url.startsWith("https://dash.example")) return new Response(JSON.stringify({ users: { "m3@shop.com": { role: "Merchant", merchantId: "2002", name: "M3" }, "staff@taager.com": { role: "Commercial" } } }));
  throw new Error("unexpected fetch " + url);
};

const env = { PORTAL_KV: makeKV(), ADMIN_KEY: "admin-key-1234567890", SESSION_SECRET: "s".repeat(40), MERCHANT_QUERY_URL: "https://metabase.example/public/question/5761d362-9da0-4f6a-9c83-2d569d8c5f38", RESEND_API_KEY: "x", MAIL_FROM: "Taager <no-reply@example.com>", DASHBOARD_WORKER_URL: "https://dash.example/" };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const ORIGIN = "https://portal.example";
async function call(path, { method = "GET", body, cookie, admin, headers = {} } = {}) {
  const h = Object.assign({ "X-Portal": "1", Origin: ORIGIN, "CF-Connecting-IP": "1.2.3.4" }, headers);
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie; if (admin) h["X-Admin-Key"] = admin;
  const r = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), env, ctx);
  const sc = r.headers.get("Set-Cookie"); let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, j, cookie: sc ? sc.split(";")[0] : null, headers: r.headers };
}
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } }

// ---------------------------------------------------------------- checks
console.log("CSV parser");
{
  const rows = []; const p = __test.csvParser((r) => rows.push(r));
  ['a,"b,1",c\r', '\n"x ""q""",', '"",z\n'].forEach((c) => p.push(c)); p.end();
  ok(JSON.stringify(rows) === JSON.stringify([["a", "b,1", "c"], ['x "q"', "", "z"]]), "quotes, commas, escaped quotes and CRLF across chunks");
}

console.log("Data build");
const meta = await __test.refreshData(env, "test");
ok(meta.merchants === 2, "2 merchants");
ok(meta.latestMonth === "2026-10", "latest month (ISO and 'October, 2026' both read)");
ok(meta.rows === 3, "3 merchant-month rows");
const metaKeys = [...env.PORTAL_KV._m.keys()];
const shardText = await (async () => { const b = await env.PORTAL_KV.get("data:shard:" + __test.shardOf("1001", 32), { type: "arrayBuffer" }); return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); })();
ok(!/Secret ACM|Gold|Platinum|Silver|"EG"/.test(shardText), "no ACM, segment or country stored");

console.log("Security basics");
let r = await call("/api/data");
ok(r.status === 401, "data needs sign-in");
r = await call("/api/login", { method: "POST", body: { email: "a@b.com", password: "x" }, headers: { "X-Portal": "" } });
ok(r.status === 400, "POST without X-Portal header refused");
r = await call("/api/login", { method: "POST", body: { email: "a@b.com", password: "x" }, headers: { Origin: "https://evil.example" } });
ok(r.status === 403, "cross-site POST refused");
r = await call("/api/admin/accounts", { admin: "wrong-key-wrong-key" });
ok(r.status === 403, "admin API needs the key");
r = await call("/");
ok(/script-src 'self'/.test(r.headers.get("Content-Security-Policy")) && r.headers.get("X-Frame-Options") === "DENY", "CSP + frame protection on pages");
ok(!/metabase|workers\.dev|api_key|ADMIN/i.test(r.j), "portal page has no internal URLs");

console.log("Accounts + login");
r = await call("/api/admin/accounts", { method: "POST", admin: env.ADMIN_KEY, body: { email: "Owner@Shop.com", name: "Store A", merchantIds: "1001" } });
ok(r.status === 200 && r.j.link.includes("/set-password#t="), "account created with a password link");
ok(mails.length === 1 && mails[0].to[0] === "owner@shop.com", "welcome email sent");
const tok = r.j.link.split("#t=")[1];
r = await call("/api/password/set", { method: "POST", body: { token: tok, password: "short" } });
ok(r.status === 400, "weak password refused");
r = await call("/api/password/set", { method: "POST", body: { token: tok, password: "GoodPassw0rd!" } });
ok(r.status === 200 && r.cookie && r.cookie.startsWith("__Host-mp_s="), "password set → signed in");
r = await call("/api/password/set", { method: "POST", body: { token: tok, password: "GoodPassw0rd!" } });
ok(r.status === 400, "link works only once");
r = await call("/api/login", { method: "POST", body: { email: "owner@shop.com", password: "GoodPassw0rd!" } });
const cookie = r.cookie;
ok(r.status === 200 && cookie, "login works");

console.log("Merchant data is filtered on the server");
r = await call("/api/data", { cookie });
ok(r.status === 200 && r.j.merchants.length === 1 && r.j.merchants[0].id === "1001", "only own Merchant ID");
ok(r.j.merchants[0].name === 'Store "A", Cairo', "merchant name");
ok(r.j.rows.length === 2 && r.j.rows.every((x) => x.length === 8) && !JSON.stringify(r.j).includes("Other Store") && !JSON.stringify(r.j).includes("9000"), "no rows of the other merchant");
const oct = r.j.rows.find((x) => x[0] === "2026-10"), sep = r.j.rows.find((x) => x[0] === "2026-09");
ok(oct && oct[4] === 320 && oct[7] === 31010 && sep && sep[7] === 20000.25, "numbers match (Oct: 320 placed pcs, EGP 31,010)");
ok(r.headers.get("Cache-Control") === "no-store", "API responses are not cached");

console.log("Session protection");
const [p0, s0] = cookie.split("=")[1].split(".");
const forged = JSON.parse(Buffer.from(p0, "base64url").toString()); forged.e = "m3@shop.com";
r = await call("/api/data", { cookie: "__Host-mp_s=" + Buffer.from(JSON.stringify(forged)).toString("base64url") + "." + s0 });
ok(r.status === 401, "tampered cookie refused");
r = await call("/api/admin/accounts/status", { method: "POST", admin: env.ADMIN_KEY, body: { email: "owner@shop.com", status: "disabled" } });
r = await call("/api/data", { cookie });
ok(r.status === 401, "disabled account is signed out at once");
r = await call("/api/admin/accounts/status", { method: "POST", admin: env.ADMIN_KEY, body: { email: "owner@shop.com", status: "active" } });

console.log("Rate limit");
let last;
for (let i = 0; i < 9; i++) last = await call("/api/login", { method: "POST", body: { email: "owner@shop.com", password: "WrongPassw0rd" } });
ok(last.status === 429, "too many wrong passwords → 429");
r = await call("/api/login", { method: "POST", body: { email: "nobody@shop.com", password: "WrongPassw0rd" } });
ok(r.status === 401 && r.j.error === "Wrong email or password.", "same message for unknown email");

console.log("Import from the staff dashboard");
r = await call("/api/admin/import-dashboard", { method: "POST", admin: env.ADMIN_KEY, body: {} });
ok(r.status === 200 && r.j.results.length === 1 && r.j.results[0].created, "only Merchant users imported");

await Promise.allSettled(waits);
console.log(`\n${pass} passed, ${fail} failed`);

if (process.argv.includes("--serve")) {
  // keep the accounts: owner@shop.com / GoodPassw0rd!  (rate limit cleared)
  for (const k of [...env.PORTAL_KV._m.keys()]) if (k.startsWith("rl:")) env.PORTAL_KV._m.delete(k);
  http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const h = new Headers(); for (const [k, v] of Object.entries(req.headers)) h.set(k, Array.isArray(v) ? v.join(", ") : v);
    h.set("CF-Connecting-IP", "127.0.0.1");
    const r2 = await worker.fetch(new Request("http://localhost:8787" + req.url, { method: req.method, headers: h, body: chunks.length ? Buffer.concat(chunks) : undefined }), env, ctx);
    const hdrs = {}; r2.headers.forEach((v, k) => { hdrs[k] = v; });
    res.writeHead(r2.status, hdrs); res.end(Buffer.from(await r2.arrayBuffer()));
  }).listen(8787, () => console.log("serving on http://localhost:8787  (owner@shop.com / GoodPassw0rd!)"));
} else if (fail) process.exit(1);
