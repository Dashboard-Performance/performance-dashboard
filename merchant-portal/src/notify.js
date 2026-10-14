// v1.17.0 — automatic merchant notifications (Command Loop).
// The staff dashboard computes the conditions (signals) twice a day — scores against the merchant's own history,
// DOH, locks — and this portal turns them into notifications with a lifecycle:
//   new → updated while the condition stays → resolved when it goes away (+ "back in stock" / "performance is back"),
//   cooldown before the same notification comes back, a daily cap per merchant, "not interested" mutes a SKU.
// Every number, threshold and on/off switch comes from the dashboard (Control → Command Loop → Merchant notifications).
// Read state is kept on the server per e-mail, so it is the same on every device.
// Merchants only ever see their own numbers: no CM3, no other merchants, no platform totals.

export const RULE_KIND = { N1: "action", N2: "action", N3: "action", N4: "action", N5: "action", N6: "action", N7: "update", N8: "update", RQ: "update" };
const SEV_RANK = { critical: 0, warning: 1, info: 2 };
function cairoDay(iso) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(iso ? new Date(iso) : new Date()); }
const MS_DAY = 864e5;

// prev = { items: [...], muted: { sku: untilIso } } ; sig = { skus, signals } for ONE merchant (or null) ; cfg = portal cfg from the dashboard
export function lifecycle(prev, sig, cfg, nowIso, extra) {
  const now = Date.parse(nowIso), today = cairoDay(nowIso);
  const st = { items: ((prev && prev.items) || []).map((x) => Object.assign({}, x)), muted: Object.assign({}, (prev && prev.muted) || {}) };
  Object.keys(st.muted).forEach((s) => { if (Date.parse(st.muted[s]) < now) delete st.muted[s]; });
  if (!cfg || !cfg.enabled) { st.items.forEach((x) => { if (x.status === "active") { x.status = "resolved"; x.resolvedAt = nowIso; x.why = "off"; } }); return prune(st, now); }
  const rules = cfg.rules || {}, skus = (sig && sig.skus) || {};
  const active = new Map(); st.items.forEach((x) => { if (x.status === "active") active.set(x.key, x); });
  const conds = ((sig && sig.signals) || []).filter((c) => rules[c.rule] && rules[c.rule].on !== false && !st.muted[c.sku]);
  const seen = new Set();
  // 1) still-true conditions update the existing notification
  const fresh = [];
  for (const c of conds) {
    const key = c.rule + "|" + c.sku; seen.add(key);
    const ex = active.get(key);
    if (ex) { ex.sev = c.sev; ex.data = c.data; ex.impact = c.impact || 0; ex.updatedAt = nowIso; ex.name = (skus[c.sku] && skus[c.sku].n) || ex.name; continue; }
    // cooldown: the same notification resolved a short while ago stays quiet
    const recent = st.items.find((x) => x.key === key && x.status === "resolved" && now - Date.parse(x.resolvedAt || x.updatedAt) < (cfg.cooldownDays || 0) * MS_DAY);
    if (recent) continue;
    fresh.push(c);
  }
  // 2) daily cap — the most important first
  const createdToday = st.items.filter((x) => x.auto && cairoDay(x.createdAt) === today).length;
  let room = Math.max(0, (cfg.maxNewPerDay == null ? 5 : cfg.maxNewPerDay) - createdToday);
  fresh.sort((a, b) => (SEV_RANK[a.sev] - SEV_RANK[b.sev]) || ((b.impact || 0) - (a.impact || 0)));
  const added = [];
  for (const c of fresh) {
    if (room <= 0) break; room--;
    added.push({ id: c.rule + "-" + c.sku + "-" + now.toString(36), key: c.rule + "|" + c.sku, rule: c.rule, sku: c.sku, name: (skus[c.sku] && skus[c.sku].n) || c.sku, sev: c.sev, kind: RULE_KIND[c.rule] || "action",
      status: "active", auto: true, createdAt: nowIso, updatedAt: nowIso, data: c.data, impact: c.impact || 0 });
  }
  st.items = added.concat(st.items);
  // 3) conditions that went away → resolved, with a positive follow-up where it makes sense
  for (const [key, x] of active) {
    if (seen.has(key)) continue;
    x.status = "resolved"; x.resolvedAt = nowIso; if (st.muted[x.sku]) x.why = "muted";
    if (x.why === "muted") continue;
    const s = skus[x.sku];
    if ((x.rule === "N3" || x.rule === "N4") && rules.N7 && rules.N7.on !== false && s && s.stock > 0 && (s.doh == null || s.doh >= (rules.N7.doh || 7)) && !/out of stock/i.test(s.avail || ""))
      st.items.unshift({ id: "N7-" + x.sku + "-" + now.toString(36), key: "N7|" + x.sku, rule: "N7", sku: x.sku, name: x.name, sev: "info", kind: "update", status: "resolved", auto: true, createdAt: nowIso, updatedAt: nowIso, resolvedAt: nowIso, data: { doh: s.doh } });
    if ((x.rule === "N1" || x.rule === "N2") && rules.N8 && rules.N8.on !== false && s && s.sc) {
      const v = x.rule === "N1" ? s.sc.demand : s.sc.cr;
      if (v != null && v >= (rules.N8.score || 90)) st.items.unshift({ id: "N8-" + x.sku + "-" + now.toString(36), key: "N8|" + x.sku, rule: "N8", sku: x.sku, name: x.name, sev: "info", kind: "update", status: "resolved", auto: true, createdAt: nowIso, updatedAt: nowIso, resolvedAt: nowIso, data: { score: v, metric: x.rule === "N1" ? "demand" : "cr" } });
    }
  }
  // 4) lock-request decisions from the Taager team
  ((extra && extra.requests) || []).forEach((r) => {
    if (["resolved", "cancelled"].indexOf(r.status) < 0) return;
    const key = "RQ|" + r.sku + "|" + r.at; if (st.items.some((x) => x.key === key)) return;
    st.items.unshift({ id: "RQ-" + r.sku + "-" + Date.parse(r.updated || nowIso).toString(36), key, rule: "RQ", sku: r.sku, name: (skus[r.sku] && skus[r.sku].n) || r.sku, sev: /reject/i.test(r.decision) || r.status === "cancelled" ? "warning" : "info", kind: "update", status: "resolved", auto: true,
      createdAt: r.updated || nowIso, updatedAt: r.updated || nowIso, resolvedAt: r.updated || nowIso, data: { decision: r.status === "cancelled" ? "Closed" : r.decision || "Done", outcome: r.outcome || "", qty: r.qty, kind: r.kind } });
  });
  return prune(st, now);
}
function prune(st, now) {
  st.items = st.items.filter((x) => x.status === "active" || now - Date.parse(x.resolvedAt || x.updatedAt) < 30 * MS_DAY).slice(0, 120);
  return st;
}

// ----------------------------------------------------------------------------- Worker side
export function createNotify(H) {
  // H = { json, body, HttpError, accountMerchantIds, normEmail, hit, shardOf }
  // State is kept in NS shard keys ("ntf:s:<n>" = { merchantId: {...} }) so a refresh is ~2×NS KV calls whatever the number of merchants.
  const NS = 16, skey = (mid) => "ntf:s:" + H.shardOf(String(mid), NS);
  async function readShard(env, key) { try { return JSON.parse((await env.PORTAL_KV.get(key)) || "{}") || {}; } catch (e) { return {}; } }
  async function readMid(env, mid) { const sh = await readShard(env, skey(mid)); return sh[String(mid)] || null; }
  async function writeMid(env, mid, d) { const k = skey(mid), sh = await readShard(env, k); sh[String(mid)] = d; await env.PORTAL_KV.put(k, JSON.stringify(sh)); }
  const base = (env) => String(env.DASHBOARD_WORKER_URL || "").replace(/\/+$/, "");
  async function dash(env, action, payload) {
    if (!/^https:\/\//.test(base(env)) || !env.DASHBOARD_SERVICE_KEY) throw new Error("DASHBOARD_WORKER_URL / DASHBOARD_SERVICE_KEY are not set.");
    const r = await fetch(base(env) + "?action=" + action, { method: "POST", headers: { "X-Service-Key": env.DASHBOARD_SERVICE_KEY, "Content-Type": "text/plain" }, body: JSON.stringify(payload) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok || !j || j.success === false) throw new Error((j && j.message) || "Dashboard answered HTTP " + r.status);
    return j;
  }
  // cron job (PART "notifications")
  async function refreshNotifications(env) {
    const want = [...(await H.accountMerchantIds(env))].filter((x) => /^\d+$/.test(x));
    if (!want.length) return null;
    const j = await dash(env, "loopPortalSignals", { mids: want });
    const nowIso = new Date().toISOString(); let changed = 0;
    const byShard = new Map(); want.forEach((mid) => { const k = skey(mid); if (!byShard.has(k)) byShard.set(k, []); byShard.get(k).push(mid); });
    for (const [k, mids] of byShard) {
      const prevT = (await env.PORTAL_KV.get(k)) || "{}"; let prevSh = {}; try { prevSh = JSON.parse(prevT) || {}; } catch (e) {}
      const sh = {};
      for (const mid of mids) {
        const prev = prevSh[mid] || null, sig = j.merchants[mid] || null;
        const st = lifecycle(prev && prev.state, sig, j.cfg, nowIso, { requests: (j.requests || {})[mid] || [] });
        const eta = {}; Object.keys((sig && sig.skus) || {}).forEach((s) => { if (j.eta && j.eta[s]) eta[s] = j.eta[s]; });
        sh[mid] = { state: st, skus: (sig && sig.skus) || {}, requests: (j.requests || {})[mid] || [], eta, asOf: j.asOf };
        if (JSON.stringify(sh[mid]) !== JSON.stringify(prev)) changed++;
      }
      const txt = JSON.stringify(sh); // merchants without a portal account any more are dropped here
      if (txt !== prevT) await env.PORTAL_KV.put(k, txt);
    }
    await env.PORTAL_KV.put("ntf:meta", JSON.stringify({ builtAt: nowIso, asOf: j.asOf, cfg: j.cfg, alts: j.alts || {}, merchants: want.length, changed }));
    await env.PORTAL_KV.delete("data:ntfError");
    return { merchants: want.length, changed };
  }
  async function readAll(env, a) {
    const out = [];
    const cache = {};
    for (const mid of a.merchantIds || []) { const k = skey(mid); if (!cache[k]) cache[k] = await readShard(env, k); const d = cache[k][String(mid)]; if (d) out.push([String(mid), d]); }
    return out;
  }
  async function readSet(env, email) { try { return JSON.parse((await env.PORTAL_KV.get("ntfread:" + H.normEmail(email))) || "[]"); } catch (e) { return []; } }

  async function list(a, env, manual) {
    const all = await readAll(env, a), meta = JSON.parse((await env.PORTAL_KV.get("ntf:meta")) || "null");
    const items = [];
    all.forEach(([mid, d]) => (d.state.items || []).forEach((x) => items.push(Object.assign({ mid, eta: (d.eta || {})[x.sku] || null, req: (d.requests || []).filter((r) => r.sku === x.sku && ["open", "in_progress", "waiting"].indexOf(r.status) >= 0)[0] || null }, x))));
    items.sort((p, q) => (p.status === "active" ? 0 : 1) - (q.status === "active" ? 0 : 1) || SEV_RANK[p.sev] - SEV_RANK[q.sev] || Date.parse(q.updatedAt) - Date.parse(p.updatedAt));
    return { items, alerts: manual.alerts || [], unavailable: !!manual.unavailable, read: await readSet(env, a.email), asOf: meta ? meta.asOf : null, builtAt: meta ? meta.builtAt : null,
      lockRequests: !!(meta && meta.cfg && meta.cfg.lockRequests), enabled: !!(meta && meta.cfg && meta.cfg.enabled) };
  }
  async function markRead(request, env, a) {
    const b = await H.body(request), ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 500);
    const cur = await readSet(env, a.email), set = new Set(cur); ids.forEach((i) => set.add(i.slice(0, 120)));
    await env.PORTAL_KV.put("ntfread:" + H.normEmail(a.email), JSON.stringify([...set].slice(-1500)));
    return H.json({ ok: true });
  }
  function ownMid(a, mid) { mid = String(mid || ""); if ((a.merchantIds || []).map(String).indexOf(mid) < 0) throw new H.HttpError(403, "Not your merchant ID."); return mid; }
  async function mute(request, env, a) {
    const b = await H.body(request), mid = ownMid(a, b.mid), sku = String(b.sku || "").slice(0, 60); if (!sku) throw new H.HttpError(400, "SKU missing.");
    const meta = JSON.parse((await env.PORTAL_KV.get("ntf:meta")) || "null"), days = (meta && meta.cfg && meta.cfg.muteDays) || 30;
    const d = (await readMid(env, mid)) || { state: { items: [], muted: {} }, skus: {}, requests: [], eta: {} };
    d.state.muted = d.state.muted || {}; d.state.muted[sku] = new Date(Date.now() + days * MS_DAY).toISOString();
    const now = new Date().toISOString();
    (d.state.items || []).forEach((x) => { if (x.sku === sku && x.status === "active") { x.status = "resolved"; x.resolvedAt = now; x.why = "muted"; } });
    await writeMid(env, mid, d);
    return H.json({ ok: true, until: d.state.muted[sku] });
  }
  async function sku(url, env, a) {
    const want = String(url.searchParams.get("sku") || "").slice(0, 60), all = await readAll(env, a), meta = JSON.parse((await env.PORTAL_KV.get("ntf:meta")) || "null");
    let hitMid = url.searchParams.get("mid") || "", d = null;
    for (const [mid, x] of all) if ((!hitMid || hitMid === mid) && x.skus && x.skus[want]) { hitMid = mid; d = x; break; }
    if (!d) return H.json({ sku: want, found: false, lockRequests: !!(meta && meta.cfg && meta.cfg.lockRequests), mid: (a.merchantIds || [])[0] || "" });
    const s = d.skus[want], cat = s.cat, A = meta && meta.cfg && meta.cfg.alternatives;
    const mine = new Set(Object.keys(d.skus));
    const alts = A && A.on && meta.alts && meta.alts[cat] ? meta.alts[cat].filter((x) => !mine.has(x.sku)).slice(0, A.max || 3) : [];
    return H.json({ found: true, mid: hitMid, sku: want, data: s, eta: (d.eta || {})[want] || null, requests: (d.requests || []).filter((r) => r.sku === want), alts, asOf: d.asOf,
      notes: (d.state.items || []).filter((x) => x.sku === want).slice(0, 10), muted: !!(d.state.muted || {})[want], lockRequests: !!(meta && meta.cfg && meta.cfg.lockRequests) });
  }
  async function lockRequest(request, env, a) {
    const b = await H.body(request), mid = ownMid(a, b.mid), skuId = String(b.sku || "").trim().slice(0, 60);
    if (!skuId) throw new H.HttpError(400, "SKU missing.");
    if (await H.hit(env, "lockreq:" + mid, 15)) throw new H.HttpError(429, "Too many requests. Please try again later.");
    const qty = Math.max(0, Math.min(1e6, Math.round(+b.qty || 0)));
    const r = await dash(env, "loopMerchantRequest", { mid, sku: skuId, kind: b.kind === "extend" ? "extend" : "increase", qty, note: String(b.note || "").slice(0, 500), email: a.email, merchantName: a.name || "" });
    // show it as pending right away (the next refresh brings the real status)
    const d = await readMid(env, mid);
    if (d) { d.requests = (d.requests || []).filter((x) => !(x.sku === skuId && ["open", "in_progress", "waiting"].indexOf(x.status) >= 0)); d.requests.unshift({ sku: skuId, status: "open", qty, asked: qty, kind: b.kind === "extend" ? "extend" : "increase", at: new Date().toISOString() }); await writeMid(env, mid, d); }
    return H.json({ ok: true, id: r.id });
  }
  // ---------------------------------------------------------------- RE-CPA (plan per account; a copy goes to the Taager dashboard per merchant ID)
  async function cpaCfg(env) { const meta = JSON.parse((await env.PORTAL_KV.get("ntf:meta")) || "null"); return (meta && meta.cfg && meta.cfg.cpa) || { shipping: 99, safetyPct: 20, minOwnPieces: 20, showProductAverages: true, portal: true }; }
  async function cpaGuard(env) { const c = await cpaCfg(env); if (c.portal === false) throw new H.HttpError(403, "RE-CPA is not available right now."); return c; }
  async function cpaGet(env, a) { const c = await cpaGuard(env); const t = await env.PORTAL_KV.get("cpa:" + H.normEmail(a.email)); return H.json({ cfg: c, plan: t ? JSON.parse(t) : null }); }
  const CPA_KEYS = ["sku", "n", "price", "profit", "cr", "dr", "src", "productNdr", "ndrOverride", "market", "cpa", "conv"];
  async function cpaSave(request, env, a) {
    await cpaGuard(env);
    const b = await H.body(request);
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 200).map((r) => { const o = {}; CPA_KEYS.forEach((k) => { const v = r && r[k]; o[k] = v == null ? "" : typeof v === "number" ? v : String(v).slice(0, 200); }); return o; }).filter((r) => r.sku);
    const plan = { rows, updatedAt: new Date().toISOString() };
    await env.PORTAL_KV.put("cpa:" + H.normEmail(a.email), JSON.stringify(plan));
    // share it with the Taager team (Merchants → RE-CPA → "Merchant's own plan")
    for (const mid of (a.merchantIds || []).filter((x) => /^\d+$/.test(String(x)))) { try { await dash(env, "loopCpaSync", { mid: String(mid), email: a.email, rows }); } catch (e) {} }
    return H.json({ ok: true, saved: rows.length });
  }
  async function cpaSku(url, env, a) {
    const c = await cpaGuard(env), want = String(url.searchParams.get("sku") || "").trim().slice(0, 60); if (!want) throw new H.HttpError(400, "SKU missing.");
    let own = null, name = "", pr = null, pf = null;
    for (const [, d] of await readAll(env, a)) {
      const s = d.skus && d.skus[want]; if (!s) continue; name = s.n || name; if (s.pr != null) pr = s.pr; if (s.pf != null) pf = s.pf;
      if (s.d && s.c && s.dl) { const sum = (arr, i0, i1) => arr.slice(i0, i1).reduce((x, y) => x + (y || 0), 0); const p = sum(s.d, 0, 14), cc = sum(s.c, 0, 14), c2 = sum(s.c, 5, 14), d2 = sum(s.dl, 5, 14); if (p >= (c.minOwnPieces || 20) && c2 > 0) own = { cr: cc / p, dr: d2 / c2 }; }
    }
    let item = null; try { item = (await dash(env, "loopPortalCatalog", { sku: want })).item; } catch (e) {}
    if (!item && !name) return H.json({ item: null });
    const prodNdr = item && item.cr != null && item.dr != null ? item.cr * item.dr : null;
    const pick = own || (item && item.cr != null ? { cr: item.cr, dr: item.dr } : { cr: null, dr: null });
    return H.json({ item: { sku: want, n: (item && item.n) || name, price: item && item.price != null ? item.price : pr, profit: item && item.profit != null ? item.profit : pf, cr: pick.cr, dr: pick.dr, src: own ? "merchant" : item && item.cr != null ? "product" : "", productNdr: prodNdr } });
  }
  async function cpaLookup(url, env, a) {
    await cpaGuard(env);
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 60); if (q.length < 3) return H.json({ items: [] });
    try { return H.json({ items: (await dash(env, "loopPortalCatalog", { q })).items || [] }); } catch (e) { return H.json({ items: [] }); }
  }
  return { refreshNotifications, list, markRead, mute, sku, lockRequest, cpaGet, cpaSave, cpaSku, cpaLookup };
}
