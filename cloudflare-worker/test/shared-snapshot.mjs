// v1.17.0 — shared snapshot on R2: cold start paints the last snapshot somebody else loaded
const worker = (await import("../worker.js")).default;
let pass = 0, fail = 0; const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + n + (c ? "" : " :: " + JSON.stringify(x))); };

const kv = new Map();
const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } };

// a stand-in R2 bucket
function makeBucket() {
  const store = new Map();
  return {
    _store: store,
    async head(k) { const o = store.get(k); return o ? { size: o.body.byteLength, customMetadata: o.customMetadata } : null; },
    async get(k) { const o = store.get(k); return o ? { body: o.body, customMetadata: o.customMetadata, httpMetadata: o.httpMetadata } : null; },
    async put(k, body, opts) { store.set(k, { body, customMetadata: (opts || {}).customMetadata || {}, httpMetadata: (opts || {}).httpMetadata || {} }); },
  };
}
const gzBody = (n) => new Uint8Array(n).fill(0x1f).buffer;
const envOf = (bucket) => ({ SYNC_CACHE: KV, SNAPSHOTS: bucket, APPS_SCRIPT_URL: "https://apps.example/exec", DECLINE_DIGEST: "off", PLANNER_DOH_EXPORT: "off", SUPPLY_CONVERSION_EXPORT: "off", INV_CATEGORY_EXPORT: "off" });
const hit = (env, qs, init) => worker.fetch(new Request("https://w/?action=" + qs, init), env, { waitUntil() {} });

const B = makeBucket(), env = envOf(B);

// ---- before anyone has pushed one
let r = await hit(env, "snapshotGet");
let j = await r.json();
ok(r.status === 404 && j.code === "no_snapshot", "nothing pushed yet → a clear 404, not a broken page", j);
j = await (await hit(env, "snapshotMeta")).json();
ok(j.success && j.on === true && j.last === null, "meta says the bucket is there but empty", j);

// ---- the first push
r = await hit(env, "snapshotPut&savedAt=1000&fp=AAA&email=a@taager.com", { method: "POST", body: gzBody(5000) });
j = await r.json();
ok(j.success && j.bytes === 5000, "the dashboard's push is stored", j);
const stored = B._store.get("snapshot/latest.json.gz");
ok(stored.httpMetadata.contentEncoding === "gzip" && stored.httpMetadata.contentType === "application/json",
   "stored still gzipped, so it is served without re-compressing it for every reader");
ok(stored.customMetadata.by === "a@taager.com" && stored.customMetadata.fp === "AAA", "who pushed it and which data is recorded", stored.customMetadata);

// ---- reading it back
r = await hit(env, "snapshotGet");
ok(r.status === 200 && r.headers.get("Content-Encoding") === "gzip", "served gzipped — the browser inflates it itself", r.status);
ok(r.headers.get("X-Snapshot-Saved-At") === "1000" && /X-Snapshot-Saved-At/.test(r.headers.get("Access-Control-Expose-Headers") || ""),
   "the age is readable cross-origin, so a stale snapshot can be spotted");
ok((await r.arrayBuffer()).byteLength === 5000, "the bytes come back whole");

// ---- the same numbers pushed again by the next person to open the dashboard
const before = B._store.get("snapshot/latest.json.gz").body;
j = await (await hit(env, "snapshotPut&savedAt=2000&fp=AAA", { method: "POST", body: gzBody(9999) })).json();
ok(j.success && j.skipped === "same" && B._store.get("snapshot/latest.json.gz").body === before,
   "identical data is not rewritten — no R2 write per person who opens the page", j);

// ---- a browser that had stale data in a tab must not overwrite a newer push
j = await (await hit(env, "snapshotPut&savedAt=500&fp=OLD", { method: "POST", body: gzBody(5000) })).json();
ok(j.success && j.skipped === "older" && B._store.get("snapshot/latest.json.gz").customMetadata.fp === "AAA",
   "an older snapshot never replaces a newer one", j);

// ---- newer data does replace it
j = await (await hit(env, "snapshotPut&savedAt=3000&fp=BBB", { method: "POST", body: gzBody(6000) })).json();
ok(j.success && !j.skipped, "newer data is written", j);
j = await (await hit(env, "snapshotMeta")).json();
ok(j.last.fp === "BBB" && j.last.savedAt === 3000 && j.last.bytes === 6000, "meta follows the newest push", j.last);

// ---- refusals
j = await (await hit(env, "snapshotPut&savedAt=4000&fp=CCC", { method: "POST", body: new Uint8Array(10).buffer })).json();
ok(!j.success && /Empty/.test(j.message), "an empty body is refused", j);
r = await hit(env, "snapshotPut&savedAt=4000&fp=DDD");
ok(r.status === 405, "GET cannot write the snapshot", r.status);
j = await (await hit(env, "snapshotPut&savedAt=5000&fp=EEE", { method: "POST", body: new Uint8Array(70 * 1024 * 1024).buffer })).json();
ok(!j.success && /too large/i.test(j.message), "an absurdly large body is refused before it reaches R2", j);
ok(B._store.get("snapshot/latest.json.gz").customMetadata.fp === "BBB", "none of the refused pushes changed what is stored");

// ---- with no bucket bound the dashboard just loads the sheets as before
const envNo = envOf(null); delete envNo.SNAPSHOTS;
r = await hit(envNo, "snapshotGet"); j = await r.json();
ok(r.status === 503 && j.code === "no_bucket", "no bucket → a plain 'off', which the dashboard treats as 'load the sheets'", j);
j = await (await hit(envNo, "snapshotMeta")).json();
ok(j.success && j.on === false, "meta says it is off rather than failing", j);

// ---- the staff gate covers it like every other action
const envGate = Object.assign(envOf(makeBucket()), { STAFF_SESSION_SECRET: "test-secret-at-least-32-characters-long-xyz" });
r = await hit(envGate, "snapshotGet");
j = await r.json();
ok(r.status === 401 && j.code === "staff_auth", "no staff session → refused: the snapshot carries CM3/PPM", j);
r = await hit(envGate, "snapshotPut&savedAt=1&fp=X", { method: "POST", body: gzBody(5000) });
ok(r.status === 401, "and it cannot be written without one either", r.status);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
