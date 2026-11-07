// v1.19.0 — ML Forecast endpoints. Run: node test/ml.mjs
process.env.TZ = "UTC";
const worker = (await import("../worker.js")).default;
const kvm = new Map();
const KV = { async get(k) { return kvm.get(k) ?? null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); }, async list() { return { keys: [] }; } };
kvm.set("access:config", JSON.stringify({ requireApproval: false, roles: { Admin: { views: "*", admin: true } }, users: {} }));
let mbCalls = [];
globalThis.fetch = async (u, o) => {
  u = String(u);
  if (u.startsWith("https://apps.example")) { const b = JSON.parse(o.body); return new Response(JSON.stringify({ success: true, name: "N", email: b.email, role: "Admin" }), { status: 200 }); }
  if (u.startsWith("https://metabase.taager.com")) { mbCalls.push(u); return new Response('DATE_GROUP,PRODUCT_ID\n2026-10-01,SKU1\n', { status: 200, headers: { "content-type": "text/csv" } }); }
  throw new Error("unexpected " + u);
};
const env = { SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://apps.example/exec", STAFF_SESSION_SECRET: "x".repeat(40), ADMIN_KEY: "admin-key-123456", SERVICE_KEY: "service-key-1234567" };
const ctx = { waitUntil() {} };
const call = async (q, { method = "GET", body, tok, svc } = {}) => {
  const h = {}; if (tok) h["X-Staff-Token"] = tok; if (svc) h["X-Service-Key"] = svc;
  const r = await worker.fetch(new Request("https://w.example/?" + q, { method, headers: h, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) }), env, ctx);
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, t };
};
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const tok = (await call("action=staffLogin", { method: "POST", body: { email: "amira@taager.com", password: "pw" } })).j.token;
const SVC = "service-key-1234567";

ok((await call("action=mlSource&gid=7100000002")).s === 401, "source: no credentials → 401");
ok((await call("action=mlSource&gid=7100000002", { tok })).s === 401, "source: a staff session alone is not enough (needs the service key)");
ok((await call("action=mlSource&gid=7100000002", { svc: "wrong-key-wrong-key" })).s === 401, "source: wrong service key → 401");
let r = await call("action=mlSource&gid=7100000002", { svc: SVC });
ok(r.s === 200 && /DATE_GROUP/.test(r.t) && mbCalls.length === 1, "source: Product Only is served with the service key");
ok((await call("action=mlSource&gid=22283311", { svc: SVC })).s === 200, "source: Beginning Inventory is on the ML list");
ok((await call("action=mlSource&gid=531154071", { svc: SVC })).s === 403, "source: a source that is not on the ML list → 403");
ok((await call("action=mlSource&gid=999", { svc: SVC })).s === 403, "source: unknown gid → 403");

const latest = { generatedAt: "2026-10-31T01:00:00Z", asOf: "2026-10-30", live: { month: "2026-11", rows: { SKU1: [100, 80, 130] } } };
ok((await call("action=mlPut&kind=latest", { svc: SVC })).s === 405, "put: must be POST");
ok((await call("action=mlPut&kind=latest", { method: "POST", body: latest })).s === 401, "put: no credentials → 401");
ok((await call("action=mlPut&kind=latest", { method: "POST", tok, body: latest })).s === 401, "put: a staff session alone cannot write");
ok((await call("action=mlPut&kind=nope", { method: "POST", svc: SVC, body: latest })).s === 400, "put: bad kind → 400");
ok((await call("action=mlPut&kind=latest", { method: "POST", svc: SVC, body: "not json" })).s === 400, "put: body must be JSON");
ok((await call("action=mlPut&kind=latest", { method: "POST", svc: SVC, body: [1, 2] })).s === 400, "put: body must be an object");
ok((await call("action=mlPut&kind=latest", { method: "POST", svc: SVC, body: latest })).j.success === true, "put latest → ok");
r = await call("action=mlGet", { tok });
ok(r.s === 200 && r.j.live.rows.SKU1[0] === 100, "get: a staff session reads the latest results");
r = await call("action=mlGet", { svc: SVC });
ok(r.s === 200 && r.j.asOf === "2026-10-30", "get: the job can read them back with the service key");
ok((await call("action=mlGet")).s === 401, "get: no credentials → 401");
await call("action=mlPut&kind=latest", { method: "POST", svc: SVC, body: { ...latest, asOf: "2026-10-31" } });
ok((await call("action=mlGet", { tok })).j.asOf === "2026-10-31", "latest can be overwritten (it is the live forecast)");

const lock = { month: "2026-11", frozenAt: "2026-10-31", rows: { SKU1: [105, 85, 140] } };
ok((await call("action=mlPut&kind=locked", { method: "POST", svc: SVC, body: lock })).s === 400, "locked: needs month=YYYY-MM in the URL");
ok((await call("action=mlPut&kind=locked&month=2026-13", { method: "POST", svc: SVC, body: lock })).s === 400, "locked: month 13 is rejected");
ok((await call("action=mlPut&kind=locked&month=2026-12", { method: "POST", svc: SVC, body: lock })).s === 400, "locked: body month must match the URL month");
ok((await call("action=mlPut&kind=locked&month=2026-11", { method: "POST", svc: SVC, body: { month: "2026-11" } })).s === 400, "locked: rows are required");
r = await call("action=mlPut&kind=locked&month=2026-11", { method: "POST", svc: SVC, body: lock });
ok(r.s === 200 && r.j.locked === "2026-11" && r.j.months.join() === "2026-11", "locked: first write is accepted");
r = await call("action=mlPut&kind=locked&month=2026-11", { method: "POST", svc: SVC, body: { ...lock, rows: { SKU1: [999, 1, 2000] } } });
ok(r.s === 409 && r.j.code === "locked", "locked: a second write for the same month is refused (409)");
ok((await call("action=mlGet&month=2026-11", { tok })).j.rows.SKU1[0] === 105, "locked: the number is still the original one");
await call("action=mlPut&kind=locked&month=2026-10", { method: "POST", svc: SVC, body: { ...lock, month: "2026-10" } });
ok((await call("action=mlGet&list=1", { tok })).j.months.join() === "2026-10,2026-11", "list of locked months, sorted");
ok((await call("action=mlGet&month=2025-01", { tok })).s === 404, "get: a month that was never locked → 404");
ok((await call("action=mlGet&month=abc", { tok })).s === 400, "get: bad month → 400");
const big = JSON.stringify({ x: "a".repeat(12 * 1024 * 1024 + 10) });
ok((await call("action=mlPut&kind=latest", { method: "POST", svc: SVC, body: big })).s === 413, "put: payload over 12 MB → 413");
ok((await call("action=mlGet", { tok })).j.asOf === "2026-10-31", "…and the stored latest is untouched by the refused write");
console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
