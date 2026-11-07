// v1.17.0 — fast sign-in: the password is checked in the Worker (same digest as backend/Code.gs pwDigest_), Apps Script only returns the row.
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n); };
const kv = new Map(); const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
kv.set("access:config", JSON.stringify({ requireApproval: false, roles: { Admin: { views: "*", admin: true } }, users: {} }));
// hash made with Python's hmac exactly like Code.gs: h = HMAC(key=password, salt); 1,499 × h = HMAC(key=password, h)
const HASH = "h1$1500$a1b2c3d4e5f60718293a4b5c6d7e8f90$5da644244af858fce71b32f5d13f844b0878b751768f4a6a399d4cb3428acfa2";
let calls = { rec: 0, login: 0 }, record = { success: true, exists: true, name: "Youssef", email: "y@taager.com", role: "Admin", hash: HASH };
globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body);
  if (b.action === "staff_auth_record") { calls.rec++; return new Response(JSON.stringify(b.serviceKey === "service-key-123456" ? record : { success: false, message: "Not allowed" })); }
  if (b.action === "login") { calls.login++; return new Response(JSON.stringify(b.password === "Sup3r-Secret" || b.password === "legacy-pw" ? { success: true, name: "Y", email: b.email, role: "Admin" } : { success: false, message: "Incorrect password." })); }
  throw new Error("unexpected " + b.action); };
const env = { SYNC_CACHE: KV, APPS_SCRIPT_URL: "https://apps.example/exec", STAFF_SESSION_SECRET: "x".repeat(40), SERVICE_KEY: "service-key-123456" };
const login = async (email, password) => { const r = await worker.fetch(new Request("https://w/?action=staffLogin", { method: "POST", body: JSON.stringify({ email, password }) }), env, {}); return r.json(); };
let t0 = Date.now(), j = await login("y@taager.com", "Sup3r-Secret");
ok(j.success && j.token && j.role === "Admin" && calls.rec === 1 && calls.login === 0, "right password → checked in the Worker, no slow Apps Script login (" + (Date.now() - t0) + " ms)");
// second sign-in: from the Worker's own copy, no Apps Script at all — even if the Apps Script is down
const rec0 = calls.rec, saveFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Apps Script down"); };
t0 = Date.now(); j = await login("y@taager.com", "Sup3r-Secret");
ok(j.success && j.token && calls.rec === rec0, "second sign-in uses the Worker's copy — works even with the Apps Script down (" + (Date.now() - t0) + " ms)");
globalThis.fetch = saveFetch;
// a copy older than 24 h is refreshed first
const c = JSON.parse(kv.get("staffauth:y@taager.com")); c.at -= 25 * 3600e3; kv.set("staffauth:y@taager.com", JSON.stringify(c));
j = await login("y@taager.com", "Sup3r-Secret"); ok(j.success && calls.rec === rec0 + 1, "a copy older than 24 h → fresh row from the Apps Script first");
j = await login("y@taager.com", "wrong-one");
ok(!j.success && !j.token && calls.login === 1, "wrong password → the Apps Script decides (nobody is locked out by a mismatch)");
ok(calls.rec >= rec0 + 2, "…and a wrong password re-checks a fresh row before giving up (password may have changed)");
record = Object.assign({}, record, { hash: "legacy-pw" }); calls.login = 0; kv.delete("staffauth:y@taager.com");
j = await login("y@taager.com", "legacy-pw");
ok(j.success && calls.login === 1, "plain-text (old) password → old Apps Script login, which also upgrades it to a hash");
record = { success: true, exists: false }; j = await login("nobody@taager.com", "x123456789");
ok(!j.success && /No account/.test(j.message), "unknown email → clear message");
ok(!kv.has("staffauth:nobody@taager.com"), "no copy is kept for unknown emails");
env.SERVICE_KEY = "other-key-1234567"; record = { success: true, exists: true, name: "Y", email: "y@taager.com", role: "Admin", hash: HASH }; calls.login = 0;
j = await login("y@taager.com", "Sup3r-Secret");
ok(j.success && calls.login === 1, "service key mismatch / old Apps Script → falls back to the old login");
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
