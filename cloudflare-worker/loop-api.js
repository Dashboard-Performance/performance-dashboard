// =============================================================================
// v1.17.0 — Command Loop: cases/tasks store (D1), runs, follow-up, SLA, endpoints.
// See loop.js for the engine. Wired into worker.js via createLoop(helpers).
// =============================================================================
import {
  DEFAULT_CONFIG, REASONS, CLOSED, ADMIN_ROLES, LOOP_VERSION, GIDS,
  mergeConfig, cairoToday, cairoHour, addDays, dayDiff, normAcm, num,
  loadMain, loadInventory, loadDebundle, parseLocks, parseProductsInfo, parseProducts, runEngine, caseKey, csvParser, portalCfg, SECTION_TEAM, TEAMS, parseCategoryTargets
} from "./loop.js";

const OPEN_STATES = ["open", "in_progress", "waiting", "done", "watch"];
const SKU_FAMILIES = ["STOCK", "LISTING", "PRICE", "DEMAND_SKU", "CR_SKU", "DR_SKU", "CM3_SKU", "WATCH"];
const NO_FOLLOWUP = ["LOCK_REQUEST", "MANUAL", "RELAUNCH", "LOCK_LOW", "LOCK_EXPIRING"];
const JSON_COLS = ["evidence", "children"];

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS loop_cases (
    id TEXT PRIMARY KEY, ckey TEXT, reason TEXT, family TEXT, level TEXT, metric TEXT,
    tager_id TEXT, product_id TEXT, merchant_name TEXT, product_name TEXT, category TEXT, acm TEXT, acms TEXT,
    section TEXT, assignee TEXT, status TEXT, priority INTEGER DEFAULT 0, impact REAL DEFAULT 0, score REAL,
    evidence TEXT, children TEXT, parent_id TEXT, blocked_by TEXT, eta TEXT, qty REAL,
    action TEXT, outcome TEXT, note TEXT, title TEXT, source TEXT,
    created_at TEXT, updated_at TEXT, last_seen TEXT, cleared_at TEXT, due_at TEXT, followup_at TEXT, done_at TEXT, closed_at TEXT,
    escalation INTEGER DEFAULT 0, recovered_gmv REAL, score_after REAL, flag_date TEXT, created_by TEXT, updated_by TEXT, touched INTEGER DEFAULT 0)`,
  "CREATE INDEX IF NOT EXISTS loop_cases_ckey ON loop_cases(ckey)",
  "CREATE INDEX IF NOT EXISTS loop_cases_status ON loop_cases(status)",
  "CREATE INDEX IF NOT EXISTS loop_cases_tager ON loop_cases(tager_id)",
  `CREATE TABLE IF NOT EXISTS loop_events (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, at TEXT, actor TEXT, type TEXT, text TEXT, data TEXT)`,
  "CREATE INDEX IF NOT EXISTS loop_events_case ON loop_events(case_id)"
];
let schemaReady = false;
async function ensureSchema(db) { if (schemaReady) return; for (const q of SCHEMA) await db.prepare(q).run(); schemaReady = true; }
export function _resetSchemaFlag() { schemaReady = false; }

const COLS = ["id", "ckey", "reason", "family", "level", "metric", "tager_id", "product_id", "merchant_name", "product_name", "category", "acm", "acms", "section", "assignee", "status", "priority", "impact", "score",
  "evidence", "children", "parent_id", "blocked_by", "eta", "qty", "action", "outcome", "note", "title", "source", "created_at", "updated_at", "last_seen", "cleared_at", "due_at", "followup_at", "done_at", "closed_at",
  "escalation", "recovered_gmv", "score_after", "flag_date", "created_by", "updated_by", "touched"];
function rowOut(r) { if (!r) return r; const o = Object.assign({}, r); JSON_COLS.forEach((k) => { try { o[k] = o[k] ? JSON.parse(o[k]) : (k === "children" ? [] : {}); } catch (e) { o[k] = k === "children" ? [] : {}; } }); return o; }
function insertStmt(db, c) {
  const vals = COLS.map((k) => { const v = c[k]; if (JSON_COLS.indexOf(k) >= 0) return JSON.stringify(v == null ? (k === "children" ? [] : {}) : v); return v === undefined ? null : v; });
  return db.prepare("INSERT INTO loop_cases (" + COLS.join(",") + ") VALUES (" + COLS.map(() => "?").join(",") + ")").bind(...vals);
}
function updateStmt(db, id, set) {
  const keys = Object.keys(set).filter((k) => COLS.indexOf(k) >= 0 && k !== "id");
  const vals = keys.map((k) => (JSON_COLS.indexOf(k) >= 0 ? JSON.stringify(set[k]) : set[k] === undefined ? null : set[k]));
  return db.prepare("UPDATE loop_cases SET " + keys.map((k) => k + "=?").join(",") + " WHERE id=?").bind(...vals, id);
}
function eventStmt(db, caseId, actor, type, text, data) { return db.prepare("INSERT INTO loop_events (case_id, at, actor, type, text, data) VALUES (?,?,?,?,?,?)").bind(caseId, new Date().toISOString(), actor || "system", type, String(text || "").slice(0, 1000), data ? JSON.stringify(data) : null); }
async function batch(db, stmts) { for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50)); }
const hoursFrom = (iso, h) => new Date(Date.parse(iso) + h * 3600e3).toISOString();

export function titleOf(c) {
  const R = REASONS[c.reason] || { label: c.reason }, p = c.product_name || c.product_id || "", m = c.merchant_name || c.tager_id || "";
  switch (c.level) {
    case "sku": return R.label + " — " + p;
    case "merchant": return R.label + " — " + m;
    case "match": return R.label + " — " + m + " × " + p;
    case "category": return R.label + " — " + (c.category || p);
    case "acmall": return R.label + " — " + (c.acm || "") + ((c.children || []).length ? " (" + c.children.length + " merchants down)" : "");
    case "acm": return R.label + " (" + ((c.children || []).length || "") + " merchants) — " + p;
    default: return c.title || R.label;
  }
}

// ----------------------------------------------------------------------------- who owns what (from Users & Roles)
export function roleViews(access, role) {
  const r = access && access.roles && access.roles[role];
  if (ADMIN_ROLES.indexOf(role) >= 0) return "*";
  if (!r) return [];
  return r.views === "*" ? "*" : Array.isArray(r.views) ? r.views : [];
}
function userEntry(access, email) { const u = access && access.users && access.users[email]; return typeof u === "string" ? { role: u } : (u || null); }
export function whoIs(access, email, tokenRole, helpers) {
  email = String(email || "").toLowerCase();
  const u = userEntry(access, email) || {};
  let role = u.role || ((access && access.trustLoginRole === false) ? "" : (tokenRole || "")) || (access && access.defaultRole) || "";
  if (!u.role && role) { const rr = access && access.roles && access.roles[role]; if (ADMIN_ROLES.indexOf(role) >= 0 || (rr && (rr.admin || rr.views === "*"))) role = (access && access.defaultRole) || ""; } // full-access roles need an explicit listing in Users & Roles
  const isAdmin = (helpers && helpers.isOwner && helpers.isOwner(email)) || ADMIN_ROLES.indexOf(u.role || "") >= 0;
  const views = isAdmin ? "*" : roleViews(access, role);
  return { email, role: isAdmin && !role ? "Admin" : role, isAdmin, views, acm: normAcm(u.acm || ""), acmLabel: u.acm || "", inactive: u.status === "inactive" };
}
// emails that would get the case (empty → ownerless: only Admin / Country Manager see it)
const normRole = (r) => String(r || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function teamOf(c, cfg) { const route = (cfg.routing && cfg.routing[c.reason]) || {}; return route.team ? String(route.team) : (SECTION_TEAM[c.section] || ""); }
export function roleInTeam(role, team) { const r = normRole(role), t = normRole(team); return !!t && (r === t || (" " + r + " ").indexOf(" " + t + " ") >= 0); }
// Owners: the team that owns the task's section (role name = team, e.g. "Marketplace"), active, not Admin / CM.
// "By ACM" narrows it to the merchant's ACM. Nobody in that team → everyone whose role can open the section (old rule).
export function assigneesOf(c, access, cfg) {
  if (c.assignee) return [c.assignee];
  const route = (cfg.routing && cfg.routing[c.reason]) || {}, team = teamOf(c, cfg), byTeam = [], byPage = [];
  const users = (access && access.users) || {};
  for (const email of Object.keys(users)) {
    const u = userEntry(access, email); if (!u || u.status === "inactive" || ADMIN_ROLES.indexOf(u.role) >= 0) continue;
    if (route.byAcm && (!u.acm || !c.acm || normAcm(u.acm) !== normAcm(c.acm))) continue;
    if (team && roleInTeam(u.role, team)) byTeam.push(email);
    const v = roleViews(access, u.role); if (v !== "*" && v.indexOf(c.section) >= 0) byPage.push(email);
  }
  return byTeam.length ? byTeam : byPage;
}
export function testOn(cfg) { return !!(cfg && cfg.testMode && cfg.testMode.on); }
export function testRecipients(cfg) { return ((cfg && cfg.testMode && cfg.testMode.recipients) || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean); }
export function isTester(me, cfg) { return testRecipients(cfg).indexOf(String(me.email || "").toLowerCase()) >= 0; }
export function canSee(c, me, cfg, access) {
  if (testOn(cfg)) return isTester(me, cfg); // test mode: only the test recipients see any task
  if (me.isAdmin) return true;
  if (c.assignee) return c.assignee === me.email;
  const route = (cfg.routing && cfg.routing[c.reason]) || {};
  if (access && access.users && userEntry(access, me.email)) return assigneesOf(c, access, cfg).indexOf(me.email) >= 0; // same rule as the owners list
  if (route.byAcm && !(me.acm && me.acm === normAcm(c.acm))) return false;
  const team = teamOf(c, cfg); if (team && roleInTeam(me.role, team)) return true; // signed in with a team role, not listed in Users & Roles
  if (me.views !== "*" && me.views.indexOf(c.section) < 0) return false;
  return true;
}
function adminEmails(access, helpers) {
  const out = new Set((helpers && helpers.ownerEmails) || []);
  const users = (access && access.users) || {};
  Object.keys(users).forEach((e) => { const u = userEntry(access, e); if (u && ADMIN_ROLES.indexOf(u.role) >= 0 && u.status !== "inactive") out.add(e); });
  return [...out];
}

// ----------------------------------------------------------------------------- reconcile engine output with the case table
export async function reconcile(db, run, cfg, nowIso) {
  await ensureSchema(db);
  const today = run.today, T = cfg.tasks;
  const openRows = ((await db.prepare("SELECT * FROM loop_cases WHERE status IN ('open','in_progress','waiting','done','watch')").all()).results || []).map(rowOut);
  const byKey = new Map(); openRows.forEach((r) => byKey.set(r.ckey, r));
  const since = new Date(Date.parse(nowIso) - T.dismissDays * 864e5).toISOString();
  const dismissed = new Set(((await db.prepare("SELECT ckey FROM loop_cases WHERE status='cancelled' AND closed_at >= ?").bind(since).all()).results || []).map((r) => r.ckey));
  const stmts = [], created = [], seen = new Set(), res = { created, updated: 0, cleared: 0, resolved: 0, chained: [] };
  const acmsOf = (kids, acm) => { const a = new Set(); if (acm) a.add(normAcm(acm)); (kids || []).forEach((k) => { if (k.acm) a.add(normAcm(k.acm)); }); return a.size ? "|" + [...a].join("|") + "|" : ""; };
  let newLeft = T.maxNewPerRun > 0 ? T.maxNewPerRun : Infinity; res.heldBack = 0;
  const ordered = run.cands.slice().sort((a, b) => (b.impact || 0) - (a.impact || 0));
  for (const c of ordered) {
    if (!byKey.has(c.ckey) && !c.watch && c.reason !== "LOCK_REQUEST") { if (newLeft <= 0) { res.heldBack++; continue; } }
    seen.add(c.ckey);
    const route = cfg.routing[c.reason] || {}, ex = byKey.get(c.ckey);
    const base = { reason: c.reason, family: (REASONS[c.reason] || {}).family || c.reason, level: c.level, metric: c.metric || "", tager_id: c.mid || "", product_id: c.sku || "",
      merchant_name: c.merchantName || "", product_name: c.productName || "", category: c.category || "", acm: c.acm || "", acms: acmsOf(c.children, c.acm),
      impact: c.impact || 0, score: c.score == null ? null : c.score, evidence: Object.assign({ asOf: today }, c.ev), children: c.children || [], last_seen: nowIso, cleared_at: null };
    if (ex) {
      const set = Object.assign({}, base);
      if (ex.section !== route.section && !ex.touched && !ex.assignee) set.section = route.section; // routing changed in Settings
      set.title = titleOf(Object.assign({}, ex, set));
      if (!ex.touched && c.ev && c.ev.suggestedQty != null) set.qty = c.ev.suggestedQty; // keep the suggestion fresh until someone acts
      if (ex.status === "watch" && !c.watch) set.status = "open";
      stmts.push(updateStmt(db, ex.id, set)); res.updated++;
      continue;
    }
    if (dismissed.has(c.ckey)) continue;
    if (!c.watch && c.reason !== "LOCK_REQUEST") newLeft--;
    const id = "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const row = Object.assign({ id, ckey: c.ckey, section: route.section || "navOverview", assignee: null, status: c.watch ? "watch" : "open", priority: 0, parent_id: null, blocked_by: null, eta: null,
      qty: c.ev && c.ev.suggestedQty != null ? c.ev.suggestedQty : null, action: null, outcome: null, note: null, source: "engine", created_at: nowIso, updated_at: nowIso,
      due_at: c.watch || !route.sla ? null : hoursFrom(nowIso, route.sla), followup_at: null, done_at: null, closed_at: null, escalation: 0, recovered_gmv: null, score_after: null,
      flag_date: today, created_by: "engine", updated_by: null, touched: 0 }, base);
    row.title = titleOf(row);
    stmts.push(insertStmt(db, row), eventStmt(db, id, "engine", "created", (c.watch ? "Watching: " : "Flagged: ") + row.title, { impact: row.impact, score: row.score }));
    created.push(row); byKey.set(c.ckey, row);
    // a product-wide case replaces the partial watch on the same metric
    if (["DEMAND_SKU", "CR_SKU", "DR_SKU"].indexOf(row.family) >= 0) {
      const w = byKey.get("WATCH|sku|" + c.sku + "|" + (c.metric || ""));
      if (w && w.status === "watch") { seen.add(w.ckey); stmts.push(updateStmt(db, w.id, { status: "upgraded", closed_at: nowIso, updated_at: nowIso, outcome: "Upgraded to " + row.title }), eventStmt(db, w.id, "engine", "upgraded", "Became product-wide → " + id)); }
    }
  }
  // blocked_by: a merchant/match drop waits for an open lock case on the same match
  for (const c of [...created, ...openRows]) {
    if (["MATCH_DROP"].indexOf(c.reason) < 0 || CLOSED.indexOf(c.status) >= 0) continue;
    const lk = byKey.get("LOCK|match|" + c.tager_id + ":" + c.product_id) || byKey.get("LOCK_REQUEST|match|" + c.tager_id + ":" + c.product_id);
    if (lk && lk.id !== c.blocked_by && OPEN_STATES.indexOf(lk.status) >= 0 && lk.status !== "done") { stmts.push(updateStmt(db, c.id, { blocked_by: lk.id, status: c.status === "open" ? "waiting" : c.status }), eventStmt(db, c.id, "engine", "blocked", "Waiting on " + lk.title)); }
  }
  // v1.17.0 — lock tasks that now wait for stock: the Supply Chain stock task comes first; the lock task comes back when stock arrives
  const held = new Map((run.lockHeld || []).map((h) => [h.ckey, h])); res.lockHeld = 0;
  for (const r of openRows) {
    const h = held.get(r.ckey); if (!h || seen.has(r.ckey) || r.source !== "engine") continue;
    seen.add(r.ckey); res.lockHeld++;
    const sk = byKey.get("STOCK|sku|" + h.sku);
    if (!r.touched && r.status === "open") {
      stmts.push(updateStmt(db, r.id, { status: "auto_cleared", closed_at: nowIso, updated_at: nowIso, cleared_at: nowIso, outcome: "On hold — no free stock. Supply Chain first; this comes back when stock arrives." }),
        eventStmt(db, r.id, "engine", "auto_cleared", "No free stock to raise the lock — moved to the Supply Chain stock task" + (sk ? " (" + sk.title + ")" : "")));
    } else if (sk && sk.id && r.blocked_by !== sk.id && ["open", "in_progress"].indexOf(r.status) >= 0) {
      stmts.push(updateStmt(db, r.id, { status: "waiting", blocked_by: sk.id, updated_at: nowIso }), eventStmt(db, r.id, "engine", "blocked", "Waiting on " + sk.title + " (no free stock)"));
    }
  }
  // cases whose condition is gone
  for (const r of openRows) {
    if (seen.has(r.ckey) || r.source !== "engine") continue;
    if (r.family === "STOCK") {
      const st = run.invState && run.invState.get(r.product_id);
      const back = st && st.known !== false && !(st.stock <= 0 || /out of stock/i.test(st.avail || "")) && (st.doh == null || st.doh >= cfg.diagnose.dohRecovered);
      if (back) {
        stmts.push(updateStmt(db, r.id, { status: "resolved", closed_at: nowIso, updated_at: nowIso, cleared_at: r.cleared_at || nowIso, outcome: r.outcome || "Stock is back (DOH " + st.doh + ")" }), eventStmt(db, r.id, "engine", "resolved", "Stock is back — closed automatically"));
        res.resolved++;
        if (T.chainRelaunch && cfg.routing.RELAUNCH && cfg.routing.RELAUNCH.enabled !== false) {
          const byAcm = {};
          (r.children || []).filter((k) => k.acm && k.h > 0).forEach((k) => { (byAcm[k.acm] || (byAcm[k.acm] = [])).push(k); });
          for (const acm of Object.keys(byAcm)) {
            const id = "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), route = cfg.routing.RELAUNCH;
            const row = { id, ckey: "RELAUNCH|acm|" + acm + ":" + r.product_id + "|" + r.id, reason: "RELAUNCH", family: "RELAUNCH", level: "acm", metric: "", tager_id: "", product_id: r.product_id, merchant_name: "", product_name: r.product_name, category: r.category,
              acm, acms: "|" + normAcm(acm) + "|", section: route.section, assignee: null, status: "open", priority: 0, impact: Math.round(r.impact || 0), score: null, evidence: { note: "Stock is back on " + r.product_name, parent: r.title, asOf: today },
              children: byAcm[acm], parent_id: r.id, blocked_by: null, eta: null, qty: null, action: null, outcome: null, note: null, source: "chain", created_at: nowIso, updated_at: nowIso, last_seen: nowIso, cleared_at: null,
              due_at: hoursFrom(nowIso, route.sla || 24), followup_at: null, done_at: null, closed_at: null, escalation: 0, recovered_gmv: null, score_after: null, flag_date: today, created_by: "chain", updated_by: null, touched: 0 };
            row.title = titleOf(row);
            stmts.push(insertStmt(db, row), eventStmt(db, id, "engine", "created", "Chained from " + r.title), eventStmt(db, r.id, "engine", "chained", "Relaunch task for " + acm + " (" + byAcm[acm].length + " merchants)"));
            res.chained.push(row); created.push(row);
          }
        }
        continue;
      }
    }
    if (r.status === "watch" || (r.status === "open" && !r.touched && T.autoClearUntouched)) {
      stmts.push(updateStmt(db, r.id, { status: "auto_cleared", closed_at: nowIso, updated_at: nowIso, cleared_at: r.cleared_at || nowIso, outcome: "Condition cleared before anyone acted" }), eventStmt(db, r.id, "engine", "auto_cleared", "Condition is gone — closed automatically"));
      res.cleared++;
    } else if (!r.cleared_at) { stmts.push(updateStmt(db, r.id, { cleared_at: nowIso }), eventStmt(db, r.id, "engine", "cleared", "Condition is gone (case stays open until someone closes it)")); }
  }
  // blockers that closed → unblock
  const openIds = new Set(openRows.filter((r) => ["open", "in_progress", "waiting"].indexOf(r.status) >= 0).map((r) => r.id).concat(created.map((r) => r.id)));
  for (const r of openRows) if (r.blocked_by && r.status === "waiting" && !openIds.has(r.blocked_by)) stmts.push(updateStmt(db, r.id, { status: "open", blocked_by: null, updated_at: nowIso }), eventStmt(db, r.id, "engine", "unblocked", "The blocking task is done"));
  await batch(db, stmts);
  return res;
}

// follow-up (D+N re-score) and SLA escalation
export async function followUpAndSla(db, run, cfg, nowIso, notify) {
  await ensureSchema(db);
  const T = cfg.tasks, stmts = [], out = { recovered: 0, notRecovered: 0, escalated: [] };
  const due = ((await db.prepare("SELECT * FROM loop_cases WHERE status='done' AND followup_at IS NOT NULL AND followup_at <= ?").bind(nowIso).all()).results || []).map(rowOut);
  for (const c of due) {
    let x = null;
    if (run) { if (c.reason === "PPM_LOW") { const v = run.ppmPct && run.ppmPct.get(c.product_id); x = v == null ? null : { sc: { ppm: v }, ev: {} }; } else if (c.level === "sku") x = run.sScore.get(c.product_id); else if (c.level === "merchant") x = run.mScore.get(c.tager_id); else if (c.level === "match") x = run.xScore.get(c.tager_id + "|" + c.product_id); else if (c.level === "category") x = run.cScore && run.cScore.get(c.category); else if (c.level === "acmall") x = run.aScore && run.aScore.get(c.acm); }
    if (!run) continue;
    const metrics = String(c.metric || "demand").split(",").filter(Boolean);
    const vals = x ? metrics.map((m) => x.sc[m]).filter((v) => v != null) : [];
    const after = vals.length ? Math.min(...vals) : null;
    const isSkuSupply = ["STOCK", "LISTING"].indexOf(c.family) >= 0;
    // no score at follow-up (no orders any more / too little volume) is NOT a recovery
    const recovered = isSkuSupply ? !!c.cleared_at : (after != null && after >= (c.reason === "PPM_LOW" ? cfg.diagnose.ppmFixPct : T.recoverScore));
    if (recovered) {
      const ev = c.evidence && c.evidence.metrics && c.evidence.metrics.demand;
      const gmv = ev && x && x.ev.demand ? Math.max(0, (x.rAvg - ev.r) * (x.asp || 0)) : 0;
      stmts.push(updateStmt(db, c.id, { status: "resolved", closed_at: nowIso, updated_at: nowIso, score_after: after, recovered_gmv: Math.round(gmv) }), eventStmt(db, c.id, "engine", "recovered", "Follow-up: score " + (after == null ? "n/a" : after) + " ≥ " + T.recoverScore + " — recovered", { after, gmv: Math.round(gmv) }));
      out.recovered++;
    } else {
      const route = cfg.routing[c.reason] || {};
      stmts.push(updateStmt(db, c.id, { status: "open", score_after: after, followup_at: null, done_at: null, escalation: (c.escalation || 0) + 1, due_at: hoursFrom(nowIso, route.sla || 24), updated_at: nowIso }), eventStmt(db, c.id, "engine", "not_recovered", after == null ? "Follow-up: no orders / too little volume to score — reopened and escalated" : "Follow-up: score " + after + " < " + T.recoverScore + " — reopened and escalated"));
      out.notRecovered++; out.escalated.push(Object.assign({}, c, { escalation: (c.escalation || 0) + 1, _why: "not recovered" }));
    }
  }
  // SLA
  const late = ((await db.prepare("SELECT * FROM loop_cases WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < ?").bind(nowIso).all()).results || []).map(rowOut);
  for (const c of late) {
    const route = cfg.routing[c.reason] || {}, sla = route.sla || 24, age = (Date.parse(nowIso) - Date.parse(c.created_at)) / 3600e3;
    let lvl = c.escalation || 0;
    if (lvl < 1) lvl = 1;
    if (lvl < 2 && age >= sla * T.escalateLevel2) lvl = 2;
    if (lvl !== (c.escalation || 0)) { stmts.push(updateStmt(db, c.id, { escalation: lvl, updated_at: nowIso }), eventStmt(db, c.id, "engine", "escalated", lvl === 1 ? "Past SLA (" + sla + "h)" : "Past " + T.escalateLevel2 + "× SLA — escalated to Admin / Country Manager")); out.escalated.push(Object.assign({}, c, { escalation: lvl, _why: "late" })); }
  }
  await batch(db, stmts);
  return out;
}

// ----------------------------------------------------------------------------- factory: everything the Worker needs
const SERVICE_ACTIONS = ["loopPortalSignals", "loopMerchantRequest", "loopPortalCatalog", "loopCpaSync"];
export function createLoop(H) {
  // H = { jsonResponse, staffSession, serviceOk, accessCfg, metabaseLink, loadAlerts, saveAlerts, ownerEmails, isOwner, gzipText }
  const json = H.jsonResponse;
  let cfgCache = { at: 0, v: null };
  async function getConfig(env, fresh) {
    if (!fresh && cfgCache.v && Date.now() - cfgCache.at < 60000) return cfgCache.v;
    let over = null; try { over = JSON.parse((await env.SYNC_CACHE.get("loop:config")) || "null"); } catch (e) {}
    const v = mergeConfig(DEFAULT_CONFIG, over || {}); cfgCache = { at: Date.now(), v }; return v;
  }
  async function gzJson(obj) { return H.gzipText(JSON.stringify(obj)); }
  async function ungzJson(buf) { if (!buf) return null; const t = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); return JSON.parse(t); }
  async function readGz(env, key) { try { return await ungzJson(await env.SYNC_CACHE.get(key, { type: "arrayBuffer" })); } catch (e) { return null; } }

  async function pushStaffAlerts(env, list) {
    if (!list.length) return;
    const cfgNow = await getConfig(env);
    if (testOn(cfgNow)) { // test mode: every bell notification goes to the test recipients only, marked [TEST] with who would have got it
      const to = testRecipients(cfgNow); if (!to.length) return;
      list = list.map((a) => Object.assign({}, a, { title: "[TEST] " + a.title, body: (a.body || "") + "\n\nWould go to: " + ((a.audience && (a.audience.users || []).concat(a.audience.roles || []).join(", ")) || "—"), audience: { all: false, roles: [], users: to } }));
    }
    const all = await H.loadAlerts(env);
    list.forEach((a) => all.unshift(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(), severity: "info", link: "loopTasks", by: "system", about: { type: "General", label: "Command Loop" } }, a)));
    await H.saveAlerts(env, all);
  }
  function groupNotices(cases, access, cfg, title) {
    const per = new Map(); // email → cases
    const owners = adminEmails(access, H);
    for (const c of cases) {
      let to = assigneesOf(c, access, cfg);
      if (!to.length) to = owners; // ownerless → Admin / Country Manager
      to.forEach((e) => { let a = per.get(e); if (!a) { a = []; per.set(e, a); } a.push(c); });
    }
    const out = [];
    for (const [email, cs] of per) out.push({ title: title(cs), body: cs.slice(0, 6).map((c) => "• " + c.title).join("\n") + (cs.length > 6 ? "\n… +" + (cs.length - 6) + " more" : ""), audience: { all: false, roles: [], users: [email] }, severity: cs.some((c) => c.escalation >= 2) ? "critical" : "warning" });
    return out;
  }

  async function fetchOk(u, init) { const r = await fetch(u, init); if (!r.ok) throw new Error("HTTP " + r.status + " from " + String(u).split("?")[0].slice(0, 80)); return r; }
  async function loadAll(env, cfg) {
    const today = cairoToday(), sheet = env.SHEET_ID, warn = [];
    const mainUrl = H.metabaseLink(env, GIDS.main); if (!mainUrl) throw new Error("No link for the Main query.");
    // Metabase sources go through the Worker's "last good copy" guard: a broken / partial answer → the last good one + a warning
    const mb = (gid, label) => (H.metabaseResponse ? H.metabaseResponse(env, gid).then((r) => { const s = r.dataSource; if (s && s.source === "cache") warn.push(label + ": Metabase " + (s.reason || "problem") + " — using the copy from " + s.cachedAt); return r; }) : fetchOk(H.metabaseLink(env, gid)));
    const mainP = mb(GIDS.main, "Main").then((r) => loadMain(r, today));
    const opt = (name, p) => p.catch((e) => { warn.push(name + ": " + (e && e.message || e)); return null; });
    const g = (gid) => "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(sheet) + "/gviz/tq?gid=" + gid + "&tqx=out:csv&tq=" + encodeURIComponent("select *");
    const tbl = async (r) => { const ct = r.headers.get("Content-Type") || ""; if (ct.indexOf("json") >= 0) { const j = await r.json(); const arr = Array.isArray(j) ? j : []; const header = arr.length ? Object.keys(arr[0]) : []; return { header, rows: arr.map((o) => header.map((h) => o[h])) }; } const rows = []; let header = null; const p = csvParser((c) => { if (!header) header = c; else if (!(c.length === 1 && c[0] === "")) rows.push(c); }); p.push(await r.text()); p.end(); return { header: header || [], rows }; };
    const lockUrl = H.metabaseLink(env, GIDS.locks), infoUrl = H.metabaseLink(env, GIDS.productsInfo), prodUrl = H.metabaseLink(env, GIDS.products);
    const catT = async () => { const kv = await env.SYNC_CACHE.get("targets:category"); if (kv) { try { const t = parseCategoryTargets(JSON.parse(kv)); if (t) return t; } catch (e) {} } return parseCategoryTargets(await tbl(await fetchOk(g(GIDS.catTargets)))); };
    const [main, inv, deb, locks, info, prices, products, catTargets] = await Promise.all([
      mainP,
      opt("Inventory", fetchOk(g(GIDS.inventory)).then(loadInventory)),
      opt("Debundle map", fetchOk(g(GIDS.debundle)).then(loadDebundle)),
      opt("Availability Locking", (lockUrl ? mb(GIDS.locks, "Availability Locking") : fetchOk(g(GIDS.locks))).then(tbl).then(parseLocks)),
      opt("Products Info", infoUrl ? mb(GIDS.productsInfo, "Products Info").then(tbl).then(parseProductsInfo) : Promise.resolve(null)),
      env.SYNC_CACHE.get("loop:prices").then((t) => (t ? JSON.parse(t) : {})).catch(() => ({})),
      opt("Products", prodUrl ? mb(GIDS.products, "Products").then(tbl).then(parseProducts) : Promise.resolve(null)),
      opt("Category Targets", catT())
    ]);
    return { D: { main, inv, deb, locks, info, prices, products, catTargets }, warn };
  }

  async function runNow(env, why, actor) {
    if (await env.SYNC_CACHE.get("loop:lock")) return { skipped: "A run is already in progress." };
    await env.SYNC_CACHE.put("loop:lock", why + " " + new Date().toISOString(), { expirationTtl: 900 });
    const t0 = Date.now(), nowIso = new Date().toISOString();
    const prev = JSON.parse((await env.SYNC_CACHE.get("loop:run")) || "{}");
    try {
      const cfg = await getConfig(env, true);
      const { D, warn } = await loadAll(env, cfg);
      const run = runEngine(D, cfg, nowIso);
      run.warnings = warn.concat(run.warnings);
      let rec = null, fu = null;
      if (env.LOOP_DB) {
        rec = await reconcile(env.LOOP_DB, run, cfg, nowIso);
        fu = await followUpAndSla(env.LOOP_DB, run, cfg, nowIso);
      } else run.warnings.unshift("D1 database (LOOP_DB) is not bound — tasks are not being created. See DEPLOY-v1.17.0.md.");
      await Promise.all([
        env.SYNC_CACHE.put("loop:scores", await gzJson(run.scores)),
        env.SYNC_CACHE.put("loop:signals", await gzJson(run.signals)),
        env.SYNC_CACHE.put("loop:prices", JSON.stringify(run.prices)),
        env.SYNC_CACHE.put("loop:catalog", await gzJson({ builtAt: nowIso, items: run.catalog }))
      ]);
      if (env.LOOP_DB && rec) {
        const access = await H.accessCfg(env);
        const alerts = [];
        const fresh = rec.created.filter((c) => c.status !== "watch");
        if (cfg.tasks.notifyNewTasks && fresh.length) alerts.push(...groupNotices(fresh, access, cfg, (cs) => cs.length + " new task" + (cs.length > 1 ? "s" : "") + " for you (Command Loop)"));
        if (cfg.tasks.notifyEscalations && fu && fu.escalated.length) {
          const lvl2 = fu.escalated.filter((c) => c.escalation >= 2);
          alerts.push(...groupNotices(fu.escalated, access, cfg, (cs) => cs.length + " task" + (cs.length > 1 ? "s are" : " is") + " overdue / not recovered"));
          if (lvl2.length) alerts.push({ title: "Escalated: " + lvl2.length + " task(s) past " + cfg.tasks.escalateLevel2 + "× SLA", body: lvl2.slice(0, 8).map((c) => "• " + c.title).join("\n"), audience: { all: false, roles: ADMIN_ROLES.slice(), users: adminEmails(access, H) }, severity: "critical" });
        }
        await pushStaffAlerts(env, alerts);
      }
      const info = { at: nowIso, ok: true, why, by: actor || "system", ms: Date.now() - t0, slot: prev.slot, sla: prev.sla, stats: run.stats, warnings: run.warnings,
        created: rec ? rec.created.length : 0, updated: rec ? rec.updated : 0, cleared: rec ? rec.cleared : 0, resolved: rec ? rec.resolved : 0, chained: rec ? rec.chained.length : 0, heldBack: rec ? rec.heldBack || 0 : 0, lockHeld: rec ? rec.lockHeld || 0 : 0,
        recovered: fu ? fu.recovered : 0, notRecovered: fu ? fu.notRecovered : 0, escalated: fu ? fu.escalated.length : 0 };
      await saveRun(env, info);
      return info;
    } catch (e) {
      const info = Object.assign({}, prev, { at: nowIso, ok: false, why, by: actor || "system", ms: Date.now() - t0, error: String(e && e.message || e) });
      await saveRun(env, info);
      return info;
    } finally { await env.SYNC_CACHE.delete("loop:lock"); }
  }
  async function saveRun(env, info) {
    await env.SYNC_CACHE.put("loop:run", JSON.stringify(info));
    let hist = []; try { hist = JSON.parse((await env.SYNC_CACHE.get("loop:runs")) || "[]"); } catch (e) {}
    hist.unshift({ at: info.at, ok: info.ok, why: info.why, by: info.by, ms: info.ms, created: info.created, cleared: info.cleared, resolved: info.resolved, escalated: info.escalated, error: info.error || "", warnings: (info.warnings || []).length });
    await env.SYNC_CACHE.put("loop:runs", JSON.stringify(hist.slice(0, 40)));
  }

  // cron (every minute): run at the configured Cairo hours; SLA check once an hour
  async function scheduled(env) {
    const cfg = await getConfig(env);
    if (!cfg.engine.enabled) return;
    const now = new Date(), h = cairoHour(now), today = cairoToday(now), slot = today + "T" + h;
    let last = {}; try { last = JSON.parse((await env.SYNC_CACHE.get("loop:run")) || "{}"); } catch (e) {}
    if (cfg.engine.runHours.indexOf(h) >= 0 && last.slot !== slot) {
      await env.SYNC_CACHE.put("loop:run", JSON.stringify(Object.assign({}, last, { slot })));
      await runNow(env, "schedule " + h + ":00");
      return;
    }
    if (env.LOOP_DB && last.sla !== slot) {
      await env.SYNC_CACHE.put("loop:run", JSON.stringify(Object.assign({}, last, { sla: slot })));
      const fu = await followUpAndSla(env.LOOP_DB, null, cfg, now.toISOString());
      if (fu.escalated.length && cfg.tasks.notifyEscalations) {
        const access = await H.accessCfg(env);
        await pushStaffAlerts(env, groupNotices(fu.escalated, access, cfg, (cs) => cs.length + " task" + (cs.length > 1 ? "s are" : " is") + " overdue"));
      }
    }
  }

  // ---------------------------------------------------------------- endpoints
  async function me(request, url, env) {
    const s = await H.staffSession(request, url, env, "loop");
    if (!s || s.pending) return null;
    return whoIs(await H.accessCfg(env), s.e, s.r, H);
  }
  async function body(request) { try { return JSON.parse(await request.text()); } catch (e) { return null; } }
  async function getCase(db, id) { return rowOut(await db.prepare("SELECT * FROM loop_cases WHERE id=?").bind(id).first()); }
  async function listCases(db, where, args, limit) { return ((await db.prepare("SELECT * FROM loop_cases" + (where ? " WHERE " + where : "") + " ORDER BY impact DESC LIMIT " + (limit || 5000)).bind(...(args || [])).all()).results || []).map(rowOut); }
  function restrictFor(c, who) { // someone who sees the case only as FYI (their merchants are affected) does not get CM3
    if (who.isAdmin || who.views === "*" || who.views.indexOf(c.section) >= 0) return c;
    const ev = Object.assign({}, c.evidence || {});
    if (ev.scores) { ev.scores = Object.assign({}, ev.scores); delete ev.scores.cm3; }
    if (ev.metrics) { ev.metrics = Object.assign({}, ev.metrics); delete ev.metrics.cm3; }
    return Object.assign({}, c, { evidence: ev });
  }
  function decorate(c, access, cfg) {
    const route = cfg.routing[c.reason] || {}, owners = assigneesOf(c, access, cfg);
    const sla = c.due_at ? (Date.parse(c.due_at) - Date.now()) / 3600e3 : null;
    return Object.assign(c, { owners, ownerless: !owners.length, actions: route.actions || [], reasonLabel: (REASONS[c.reason] || {}).label || c.reason, slaHoursLeft: sla == null ? null : Math.round(sla * 10) / 10 });
  }

  async function handle(action, request, url, env, ctx) {
    // ---- service (merchant portal) — never a staff session
    if (SERVICE_ACTIONS.indexOf(action) >= 0) {
      if (!(await H.serviceOk(request, env))) return json({ success: false, message: "Service key required." }, 403);
      if (action === "loopPortalSignals") return portalSignals(request, env);
      if (action === "loopPortalCatalog") return portalCatalog(request, env);
      if (action === "loopCpaSync") return cpaSync(request, env);
      return merchantRequest(request, env);
    }
    if (H.staffGateOn && !H.staffGateOn(env)) return json({ success: false, message: "The Command Loop needs staff sign-in: set the STAFF_SESSION_SECRET secret on the dashboard Worker (32+ characters, see DEPLOY-v1.16.0.md)." }, 503);
    const who = await me(request, url, env);
    if (!who) return json({ success: false, code: "staff_auth", message: "Please sign in again (the Command Loop needs a staff session)." }, 401);
    if (who.inactive) return json({ success: false, message: "Your account is inactive." }, 403);
    const cfg = await getConfig(env);
    const adminOnly = ["loopMerchantPreview", "loopConfig", "loopConfigPut", "loopAdminList", "loopAdminUpdate", "loopCreate", "loopRun", "loopRunInfo", "loopScores", "loopStats", "loopExport", "loopDelete", "loopConfigReset"];
    if (adminOnly.indexOf(action) >= 0 && !who.isAdmin) return json({ success: false, message: "Admin / Country Manager only." }, 403);
    const db = env.LOOP_DB;
    const needDb = ["loopTasks", "loopTask", "loopUpdate", "loopAdminList", "loopAdminUpdate", "loopCreate", "loopStats", "loopExport", "loopDelete", "loopMe"];
    if (needDb.indexOf(action) >= 0) { if (!db) return json({ success: false, message: "The Command Loop database (D1 binding LOOP_DB) is not set up yet — see DEPLOY-v1.17.0.md." }, 503); await ensureSchema(db); }
    const access = await H.accessCfg(env);

    if (action === "loopMe") {
      const open = await listCases(db, "status IN ('open','in_progress','waiting','done')");
      const mine = open.filter((c) => canSee(c, who, cfg, access) && (who.isAdmin ? true : true));
      return json({ success: true, me: who, version: LOOP_VERSION, counts: { mine: mine.filter((c) => !who.isAdmin || assigneesOf(c, access, cfg).indexOf(who.email) >= 0).length, late: mine.filter((c) => c.due_at && c.due_at < new Date().toISOString() && ["open", "in_progress"].indexOf(c.status) >= 0).length },
        sections: cfg.routing, reasons: REASONS });
    }
    if (action === "loopTasks") {
      const scope = url.searchParams.get("scope") || "mine", section = url.searchParams.get("section") || "", st = url.searchParams.get("status") || "active";
      const where = st === "closed" ? "status IN ('resolved','auto_cleared','cancelled','upgraded') AND closed_at >= ?" : "status IN ('open','in_progress','waiting','done','watch')";
      const args = st === "closed" ? [new Date(Date.now() - 30 * 864e5).toISOString()] : [];
      let rows = (await listCases(db, where, args)).filter((c) => canSee(c, who, cfg, access));
      if (section) rows = rows.filter((c) => c.section === section);
      if (scope === "mine" && who.isAdmin && url.searchParams.get("all") !== "1" && !(testOn(cfg) && isTester(who, cfg))) rows = rows.filter((c) => { const o = assigneesOf(c, access, cfg); return o.indexOf(who.email) >= 0 || !o.length || c.escalation >= 2; });
      const fyi = [];
      if (who.acm && scope === "mine" && (!testOn(cfg) || isTester(who, cfg))) {
        const sku = await listCases(db, "status IN ('open','in_progress','waiting','done','watch') AND acms LIKE ?", ["%|" + who.acm + "|%"]);
        sku.filter((c) => SKU_FAMILIES.indexOf(c.family) >= 0 && !rows.some((r) => r.id === c.id)).forEach((c) => fyi.push(decorate(restrictFor(c, who), access, cfg)));
      }
      return json({ success: true, testMode: testOn(cfg) ? { recipients: testRecipients(cfg), you: isTester(who, cfg) } : null, tasks: rows.map((c) => decorate(c, access, cfg)), fyi, maxPerPerson: cfg.tasks.maxPerPerson, asOf: (JSON.parse((await env.SYNC_CACHE.get("loop:run")) || "{}")).at || null });
    }
    if (action === "loopTask") {
      const c = await getCase(db, url.searchParams.get("id") || "");
      if (!c || !canSee(c, who, cfg, access)) { if (!c || testOn(cfg) || !who.acm || String(c.acms || "").indexOf("|" + who.acm + "|") < 0) return json({ success: false, message: "Not found." }, 404); }
      const ev = ((await db.prepare("SELECT * FROM loop_events WHERE case_id=? ORDER BY id DESC LIMIT 200").bind(c.id).all()).results || []);
      const kids = ((await db.prepare("SELECT id,title,status,acm,reason FROM loop_cases WHERE parent_id=?").bind(c.id).all()).results || []);
      const parent = c.parent_id ? await db.prepare("SELECT id,title,status,eta FROM loop_cases WHERE id=?").bind(c.parent_id).first() : null;
      const blocker = c.blocked_by ? await db.prepare("SELECT id,title,status,eta FROM loop_cases WHERE id=?").bind(c.blocked_by).first() : null;
      return json({ success: true, task: decorate(restrictFor(c, who), access, cfg), events: ev, linked: kids, parent, blocker, canEdit: who.isAdmin || canSee(c, who, cfg, access) });
    }
    if (action === "loopUpdate") return updateTask(request, env, db, who, cfg, access);
    // RE-CPA plans (Merchants → RE-CPA): any staff member; one plan per merchant ID (or a general one), plus the merchant's own plan from the portal (read-only here)
    if (action === "loopCpaGet") {
      const mid = String(url.searchParams.get("mid") || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40) || "_";
      const [st, mt] = await Promise.all([env.SYNC_CACHE.get("cpa:staff:" + mid), mid === "_" ? null : env.SYNC_CACHE.get("cpa:merchant:" + mid)]);
      return json({ success: true, cfg: cfg.cpa, staff: st ? JSON.parse(st) : null, merchant: mt ? JSON.parse(mt) : null });
    }
    if (action === "loopCpaSave") {
      const b = await body(request) || {}, mid = String(b.mid || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40) || "_";
      const rows = cleanCpaRows(b.rows);
      await env.SYNC_CACHE.put("cpa:staff:" + mid, JSON.stringify({ rows, updatedAt: new Date().toISOString(), by: who.email }));
      return json({ success: true, saved: rows.length });
    }
    if (action === "loopCpaCatalog") { const cat = await readGz(env, "loop:catalog"); return json({ success: true, builtAt: cat ? cat.builtAt : null, cfg: cfg.cpa, items: cat ? cat.items : {} }); }
    if (action === "loopConfig") return json({ success: true, config: cfg, defaults: DEFAULT_CONFIG, reasons: REASONS, teams: [...new Set(TEAMS.concat(Object.keys((access && access.roles) || {}).filter((r) => ADMIN_ROLES.indexOf(r) < 0 && r !== "Merchant")))], sectionTeam: SECTION_TEAM });
    if (action === "loopConfigPut") {
      const b = await body(request); if (!b || !b.config) return json({ success: false, message: "config missing" }, 400);
      const merged = mergeConfig(DEFAULT_CONFIG, b.config);
      const bad = validateConfig(merged); if (bad) return json({ success: false, message: bad }, 400);
      await env.SYNC_CACHE.put("loop:config", JSON.stringify(Object.assign(merged, { updatedAt: new Date().toISOString(), updatedBy: who.email })));
      cfgCache = { at: 0, v: null };
      return json({ success: true, config: merged });
    }
    if (action === "loopConfigReset") { await env.SYNC_CACHE.delete("loop:config"); cfgCache = { at: 0, v: null }; return json({ success: true, config: DEFAULT_CONFIG }); }
    if (action === "loopAdminList") {
      const days = Math.min(365, +url.searchParams.get("days") || 30);
      const rows = await listCases(db, "status IN ('open','in_progress','waiting','done','watch') OR closed_at >= ?", [new Date(Date.now() - days * 864e5).toISOString()], 8000);
      return json({ success: true, tasks: rows.map((c) => decorate(c, access, cfg)), users: Object.keys(access.users || {}).map((e) => { const u = userEntry(access, e); return { email: e, role: u.role, acm: u.acm || "" }; }) });
    }
    if (action === "loopAdminUpdate") {
      const b = await body(request); if (!b || !Array.isArray(b.ids) || !b.ids.length) return json({ success: false, message: "ids missing" }, 400);
      const set = {}, s = b.set || {}, now = new Date().toISOString(), text = [];
      if ("assignee" in s) { set.assignee = s.assignee ? String(s.assignee).toLowerCase().slice(0, 160) : null; text.push("assignee → " + (set.assignee || "auto (by section)")); }
      if (s.section) { set.section = String(s.section).slice(0, 60); text.push("section → " + set.section); }
      if ("acm" in s) { set.acm = String(s.acm || "").slice(0, 80); text.push("ACM → " + (set.acm || "none")); }
      if (s.priority != null) { set.priority = Math.max(-1, Math.min(3, +s.priority || 0)); text.push("priority → " + set.priority); }
      if (s.dueHours != null) { set.due_at = hoursFrom(now, +s.dueHours || 24); set.escalation = 0; text.push("SLA reset → " + s.dueHours + "h"); }
      if (s.followupDays != null) { set.followup_at = hoursFrom(now, (+s.followupDays || 0) * 24); text.push("follow-up in " + s.followupDays + "d"); }
      if (s.status) {
        const allowed = ["open", "in_progress", "waiting", "done", "resolved", "cancelled", "watch"];
        if (allowed.indexOf(s.status) < 0) return json({ success: false, message: "bad status" }, 400);
        set.status = s.status; text.push("status → " + s.status);
        if (CLOSED.indexOf(s.status) >= 0) set.closed_at = now; else set.closed_at = null;
        if (s.status === "done") { set.done_at = now; set.followup_at = hoursFrom(now, cfg.tasks.followUpDays * 24); }
      }
      if (s.outcome) set.outcome = String(s.outcome).slice(0, 1000);
      if (!Object.keys(set).length) return json({ success: false, message: "Nothing to change." }, 400);
      Object.assign(set, { updated_at: now, updated_by: who.email, touched: 1 });
      const stmts = [];
      b.ids.slice(0, 2000).forEach((id) => { stmts.push(updateStmt(db, String(id), set), eventStmt(db, String(id), who.email, "admin", text.join(" · ") + (s.note ? " — " + s.note : ""))); });
      await batch(db, stmts);
      return json({ success: true, changed: b.ids.length });
    }
    if (action === "loopDelete") {
      const b = await body(request); if (!b || !Array.isArray(b.ids)) return json({ success: false, message: "ids missing" }, 400);
      const stmts = []; b.ids.slice(0, 2000).forEach((id) => { stmts.push(db.prepare("DELETE FROM loop_cases WHERE id=?").bind(String(id)), db.prepare("DELETE FROM loop_events WHERE case_id=?").bind(String(id))); });
      await batch(db, stmts); return json({ success: true, deleted: b.ids.length });
    }
    if (action === "loopCreate") {
      const b = await body(request) || {}, now = new Date().toISOString();
      const title = String(b.title || "").trim().slice(0, 200); if (!title) return json({ success: false, message: "Title is required." }, 400);
      const reason = REASONS[b.reason] ? b.reason : "MANUAL", route = cfg.routing[reason] || cfg.routing.MANUAL;
      const id = "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const row = { id, ckey: "MANUAL|" + id, reason, family: (REASONS[reason] || {}).family || "MANUAL", level: "manual", metric: "", tager_id: String(b.mid || "").slice(0, 40), product_id: String(b.sku || "").slice(0, 60), merchant_name: "", product_name: "", category: "",
        acm: String(b.acm || "").slice(0, 80), acms: b.acm ? "|" + normAcm(b.acm) + "|" : "", section: String(b.section || route.section || "navOverview"), assignee: b.assignee ? String(b.assignee).toLowerCase() : null, status: "open", priority: +b.priority || 0, impact: +b.impact || 0, score: null,
        evidence: { note: String(b.note || "").slice(0, 2000) }, children: [], parent_id: b.parentId || null, blocked_by: b.blockedBy || null, eta: null, qty: null, action: null, outcome: null, note: String(b.note || "").slice(0, 2000), title, source: "manual",
        created_at: now, updated_at: now, last_seen: now, cleared_at: null, due_at: hoursFrom(now, +b.dueHours || route.sla || 48), followup_at: null, done_at: null, closed_at: null, escalation: 0, recovered_gmv: null, score_after: null, flag_date: cairoToday(), created_by: who.email, updated_by: null, touched: 1 };
      await batch(db, [insertStmt(db, row), eventStmt(db, id, who.email, "created", "Manual task: " + title)]);
      const to = assigneesOf(row, access, cfg);
      if (to.length) await pushStaffAlerts(env, [{ title: "New task from " + who.email, body: title, audience: { all: false, roles: [], users: to }, severity: "warning" }]);
      return json({ success: true, task: decorate(row, access, cfg) });
    }
    if (action === "loopRun") {
      const info = await runNow(env, "manual", who.email);
      return json({ success: !info.skipped && info.ok !== false, run: info, message: info.skipped || info.error || "" });
    }
    if (action === "loopRunInfo") {
      let runs = []; try { runs = JSON.parse((await env.SYNC_CACHE.get("loop:runs")) || "[]"); } catch (e) {}
      return json({ success: true, last: JSON.parse((await env.SYNC_CACHE.get("loop:run")) || "null"), runs, running: !!(await env.SYNC_CACHE.get("loop:lock")), d1: !!env.LOOP_DB });
    }
    if (action === "loopMerchantPreview") {
      const mid = String(url.searchParams.get("mid") || "").replace(/[^0-9]/g, "").slice(0, 40), sig = await readGz(env, "loop:signals");
      const m = sig && sig.merchants && sig.merchants[mid];
      return json({ success: true, mid, asOf: sig ? sig.asOf : null, testMode: testOn(cfg), signals: m ? m.signals : [], skus: m ? Object.fromEntries(Object.entries(m.skus).map(([k, v]) => [k, { n: v.n, doh: v.doh, stock: v.stock, sc: v.sc, lock: v.lock || null }])) : {} });
    }
    if (action === "loopScores") { const s = await readGz(env, "loop:scores"); return json({ success: true, scores: s }); }
    if (action === "loopStats") return json({ success: true, stats: await stats(db, access, cfg), reasons: REASONS });
    if (action === "loopExport") {
      const rows = await listCases(db, "", [], 20000);
      const cols = ["id", "flag_date", "reason", "level", "tager_id", "merchant_name", "product_id", "product_name", "acm", "section", "assignee", "status", "impact", "score", "action", "outcome", "eta", "created_at", "due_at", "done_at", "followup_at", "closed_at", "score_after", "recovered_gmv", "escalation"];
      const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const csv = cols.join(",") + "\n" + rows.map((r) => cols.map((k) => esc(r[k])).join(",")).join("\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Access-Control-Allow-Origin": "*", "Content-Disposition": "attachment; filename=command-loop-follow-up-log.csv", "Cache-Control": "no-store" } });
    }
    return json({ success: false, message: "Unknown Command Loop action." }, 400);
  }

  async function updateTask(request, env, db, who, cfg, access) {
    const b = await body(request); if (!b || !b.id) return json({ success: false, message: "id missing" }, 400);
    const c = await getCase(db, String(b.id)); if (!c) return json({ success: false, message: "Not found." }, 404);
    if (!canSee(c, who, cfg, access)) return json({ success: false, message: "This task is not yours." }, 403);
    const now = new Date().toISOString(), set = { updated_at: now, updated_by: who.email, touched: 1 }, ev = [], op = String(b.op || "");
    const note = String(b.note || "").slice(0, 2000);
    if (op === "start") { set.status = "in_progress"; ev.push(["status", "Started"]); }
    else if (op === "action") { if (!b.action) return json({ success: false, message: "Pick an action." }, 400); set.action = String(b.action).slice(0, 200); set.status = c.status === "open" ? "in_progress" : c.status; ev.push(["action", "Action: " + set.action + (note ? " — " + note : "")]); }
    else if (op === "eta") { const e = /^\d{4}-\d{2}-\d{2}$/.test(String(b.eta || "")) ? b.eta : null; if (!e) return json({ success: false, message: "ETA must be a date." }, 400); set.eta = e; if (c.status === "open") set.status = "in_progress"; ev.push(["eta", "ETA set to " + e]); }
    else if (op === "qty") { set.qty = Math.max(0, num(b.qty)); ev.push(["qty", "Quantity set to " + set.qty]); }
    else if (op === "wait") { set.status = "waiting"; ev.push(["status", "Waiting" + (note ? ": " + note : "")]); }
    else if (op === "done") {
      const outcome = String(b.outcome || "").trim(); if (!outcome) return json({ success: false, message: "Write the outcome before closing." }, 400);
      set.outcome = outcome.slice(0, 1000); if (b.action) set.action = String(b.action).slice(0, 200); set.done_at = now;
      if (NO_FOLLOWUP.indexOf(c.reason) >= 0 || c.status === "watch") { set.status = "resolved"; set.closed_at = now; ev.push(["resolved", "Closed: " + set.outcome]); }
      else { set.status = "done"; set.followup_at = hoursFrom(now, cfg.tasks.followUpDays * 24); ev.push(["done", "Done: " + set.outcome + " — follow-up on " + set.followup_at.slice(0, 10)]); }
    }
    else if (op === "reopen") { if (["cancelled", "upgraded"].indexOf(c.status) >= 0 && !who.isAdmin) return json({ success: false, message: "Only Admin / Country Manager can reopen a dismissed task." }, 403); set.status = "open"; set.closed_at = null; set.followup_at = null; ev.push(["status", "Reopened" + (note ? ": " + note : "")]); }
    else if (op === "comment") { if (!note) return json({ success: false, message: "Empty comment." }, 400); ev.push(["comment", note]); }
    else if (op === "cancel") { if (!who.isAdmin) return json({ success: false, message: "Only Admin / Country Manager can dismiss a task." }, 403); set.status = "cancelled"; set.closed_at = now; ev.push(["cancelled", "Dismissed" + (note ? ": " + note : "")]); }
    else return json({ success: false, message: "Unknown op." }, 400);
    if (note && op !== "comment" && op !== "action") set.note = note;
    if (b.reply != null && c.reason === "LOCK_REQUEST") { set.evidence = Object.assign({}, c.evidence || {}, { reply: String(b.reply).slice(0, 500) }); ev.push(["reply", "Reply to the merchant: " + set.evidence.reply]); }
    const stmts = [updateStmt(db, c.id, set)].concat(ev.map((e) => eventStmt(db, c.id, who.email, e[0], e[1])));
    // a closed blocker frees its waiting tasks; a stock ETA is copied to the chained relaunch tasks
    if (set.status && CLOSED.concat(["done"]).indexOf(set.status) >= 0) {
      const waiting = ((await db.prepare("SELECT id FROM loop_cases WHERE blocked_by=? AND status='waiting'").bind(c.id).all()).results || []);
      waiting.forEach((w) => stmts.push(updateStmt(db, w.id, { status: "open", blocked_by: null, updated_at: now }), eventStmt(db, w.id, "system", "unblocked", "Unblocked: " + c.title + " is " + set.status)));
    }
    await batch(db, stmts);
    return json({ success: true, task: decorate(await getCase(db, c.id), access, cfg) });
  }

  function cleanCpaRows(list) {
    const keep = ["sku", "n", "price", "profit", "asp", "cr", "dr", "src", "productNdr", "ndrOverride", "market", "cpa", "conv"];
    return (Array.isArray(list) ? list : []).slice(0, 300).map((r) => { const o = {}; keep.forEach((k) => { const v = r && r[k]; o[k] = v == null ? "" : typeof v === "number" ? v : String(v).slice(0, 200); }); return o; }).filter((r) => r.sku);
  }
  async function portalCatalog(request, env) {
    const b = await body(request) || {}, cfg = await getConfig(env), cat = await readGz(env, "loop:catalog"), items = (cat && cat.items) || {};
    const show = cfg.cpa.showProductAverages;
    const pack = (sku) => { const x = items[sku]; if (!x) return null; return { sku, n: x[0], price: x[1], profit: x[2], cr: show ? x[3] : null, dr: show ? x[4] : null, cat: x[5], asp: x[7] == null ? null : x[7] }; };
    if (b.sku) return json({ success: true, cfg: cfg.cpa, item: pack(String(b.sku).trim().slice(0, 60)) });
    const q = String(b.q || "").trim().toLowerCase().slice(0, 60); if (q.length < 3) return json({ success: true, items: [] });
    const out = []; for (const sku of Object.keys(items)) { if (sku.toLowerCase().indexOf(q) >= 0 || String(items[sku][0]).toLowerCase().indexOf(q) >= 0) { out.push({ sku, n: items[sku][0] }); if (out.length >= 30) break; } }
    return json({ success: true, items: out });
  }
  async function cpaSync(request, env) {
    const b = await body(request) || {}, mid = String(b.mid || "").replace(/[^0-9]/g, "").slice(0, 40); if (!mid) return json({ success: false, message: "mid missing" }, 400);
    await env.SYNC_CACHE.put("cpa:merchant:" + mid, JSON.stringify({ rows: cleanCpaRows(b.rows), updatedAt: new Date().toISOString(), by: String(b.email || "").slice(0, 160) }));
    return json({ success: true });
  }
  async function stats(db, access, cfg) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString(), nowIso = new Date().toISOString();
    const rows = await listCases(db, "status IN ('open','in_progress','waiting','done','watch') OR created_at >= ? OR closed_at >= ?", [since, since], 20000);
    const bySection = {}, byReason = {}, byAction = {}, byOwner = {};
    let open = 0, late = 0, ownerless = 0, resolved30 = 0, recovered = 0, followups = 0, gmv = 0, tta = [], esc2 = 0;
    for (const c of rows) {
      const isOpen = ["open", "in_progress", "waiting", "done"].indexOf(c.status) >= 0;
      const s = bySection[c.section] || (bySection[c.section] = { open: 0, late: 0, resolved: 0, impact: 0 });
      const r = byReason[c.reason] || (byReason[c.reason] = { open: 0, resolved: 0, recovered: 0, notRecovered: 0 });
      if (isOpen) { open++; s.open++; r.open++; s.impact += c.impact || 0; const ow = assigneesOf(c, access, cfg); if (!ow.length) ownerless++; ow.forEach((e) => { const o = byOwner[e] || (byOwner[e] = { open: 0, late: 0 }); o.open++; if (c.due_at && c.due_at < nowIso && ["open", "in_progress"].indexOf(c.status) >= 0) o.late++; }); }
      if (isOpen && c.due_at && c.due_at < nowIso && ["open", "in_progress"].indexOf(c.status) >= 0) { late++; s.late++; }
      if (c.escalation >= 2 && isOpen) esc2++;
      if (c.status === "resolved" && c.closed_at >= since) { resolved30++; s.resolved++; r.resolved++; gmv += c.recovered_gmv || 0; }
      if (c.score_after != null) { followups++; const ok = c.status === "resolved"; if (ok) { recovered++; r.recovered++; } else r.notRecovered++; if (c.action) { const a = byAction[c.reason + " · " + c.action] || (byAction[c.reason + " · " + c.action] = { n: 0, ok: 0 }); a.n++; if (ok) a.ok++; } }
      if (c.done_at && c.created_at) tta.push((Date.parse(c.done_at) - Date.parse(c.created_at)) / 3600e3);
    }
    tta.sort((a, b) => a - b);
    const playbook = Object.keys(byAction).map((k) => ({ key: k, n: byAction[k].n, rate: Math.round((byAction[k].ok / byAction[k].n) * 100) })).sort((a, b) => b.rate - a.rate || b.n - a.n);
    return { open, late, ownerless, escalated: esc2, resolved30, recoveryRate: followups ? Math.round((recovered / followups) * 100) : null, followups, gmvRecovered: Math.round(gmv), medianHoursToAction: tta.length ? Math.round(tta[Math.floor(tta.length / 2)] * 10) / 10 : null, bySection, byReason, byOwner, playbook };
  }

  // ---------------------------------------------------------------- portal side
  async function portalSignals(request, env) {
    const b = await body(request) || {}; const mids = Array.isArray(b.mids) ? b.mids.map(String).slice(0, 5000) : [];
    const sig = await readGz(env, "loop:signals");
    const out = { success: true, asOf: sig ? sig.asOf : null, cfg: portalCfg(await getConfig(env)), /* live settings: test mode / switches apply at once */ merchants: {}, alts: sig ? sig.alts : {}, requests: {}, eta: {} };
    if (!sig) return json(out);
    mids.forEach((m) => { if (sig.merchants[m]) out.merchants[m] = sig.merchants[m]; });
    if (env.LOOP_DB && mids.length) {
      await ensureSchema(env.LOOP_DB);
      const since = new Date(Date.now() - 21 * 864e5).toISOString();
      for (let i = 0; i < mids.length; i += 90) {
        const part = mids.slice(i, i + 90), q = part.map(() => "?").join(",");
        const rq = ((await env.LOOP_DB.prepare("SELECT tager_id, product_id, status, qty, action, outcome, created_at, updated_at, evidence FROM loop_cases WHERE reason='LOCK_REQUEST' AND tager_id IN (" + q + ") AND (closed_at IS NULL OR closed_at >= ?)").bind(...part, since).all()).results || []);
        rq.forEach((r) => { let ev = {}; try { ev = JSON.parse(r.evidence || "{}"); } catch (e) {} (out.requests[r.tager_id] || (out.requests[r.tager_id] = [])).push({ sku: r.product_id, status: r.status, qty: r.qty, asked: ev.askedQty, kind: ev.kind, decision: r.action || "", outcome: ev.reply || "", at: r.created_at, updated: r.updated_at }); });
      }
      const skus = new Set(); Object.values(out.merchants).forEach((m) => Object.keys(m.skus || {}).forEach((s) => skus.add(s)));
      const etas = ((await env.LOOP_DB.prepare("SELECT product_id, eta FROM loop_cases WHERE family='STOCK' AND eta IS NOT NULL AND status IN ('open','in_progress','waiting','done')").all()).results || []);
      etas.forEach((r) => { if (skus.has(r.product_id)) out.eta[r.product_id] = r.eta; });
    }
    return json(out);
  }
  async function merchantRequest(request, env) {
    const b = await body(request) || {}, cfg = await getConfig(env);
    if (!cfg.merchant.lockRequests) return json({ success: false, message: "Lock requests are switched off." }, 403);
    if (!env.LOOP_DB) return json({ success: false, message: "Requests are not available yet." }, 503);
    await ensureSchema(env.LOOP_DB);
    const mid = String(b.mid || "").trim().slice(0, 40), sku = String(b.sku || "").trim().slice(0, 60), kind = b.kind === "extend" ? "extend" : "increase";
    if (!/^\d+$/.test(mid) || !sku) return json({ success: false, message: "Bad request." }, 400);
    const rl = "loop:rq:" + mid + ":" + cairoToday(), n = +(await env.SYNC_CACHE.get(rl)) || 0;
    if (n >= 20) return json({ success: false, message: "Too many requests today." }, 429);
    await env.SYNC_CACHE.put(rl, String(n + 1), { expirationTtl: 172800 });
    const qty = Math.max(0, Math.min(1e6, Math.round(num(b.qty)))), now = new Date().toISOString(), note = String(b.note || "").slice(0, 500);
    const sig = await readGz(env, "loop:signals"), m = sig && sig.merchants[mid], sk = m && m.skus[sku];
    const ckey = "LOCK_REQUEST|match|" + mid + ":" + sku, db = env.LOOP_DB, route = cfg.routing.LOCK_REQUEST;
    const ex = rowOut(await db.prepare("SELECT * FROM loop_cases WHERE ckey=? AND status IN ('open','in_progress','waiting')").bind(ckey).first());
    const evidence = { kind, askedQty: qty, note, by: String(b.email || "").slice(0, 160), lock: sk && sk.lock ? sk.lock : null, asOf: cairoToday() };
    if (ex) {
      await batch(db, [updateStmt(db, ex.id, { qty, evidence: Object.assign({}, ex.evidence, evidence), updated_at: now, last_seen: now }), eventStmt(db, ex.id, "merchant:" + mid, "request", "Merchant updated the request: " + kind + " " + qty + (note ? " — " + note : ""))]);
      return json({ success: true, id: ex.id, updated: true });
    }
    const id = "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const row = { id, ckey, reason: "LOCK_REQUEST", family: "LOCK_REQUEST", level: "match", metric: "", tager_id: mid, product_id: sku, merchant_name: String(b.merchantName || b.name || mid).slice(0, 120), product_name: (sk && sk.n) || sku, category: (sk && sk.cat) || "", acm: "", acms: "",
      section: route.section, assignee: null, status: "open", priority: 1, impact: 0, score: null, evidence, children: [], parent_id: null, blocked_by: null, eta: null, qty, action: null, outcome: null, note, title: "", source: "merchant",
      created_at: now, updated_at: now, last_seen: now, cleared_at: null, due_at: hoursFrom(now, route.sla || 24), followup_at: null, done_at: null, closed_at: null, escalation: 0, recovered_gmv: null, score_after: null, flag_date: cairoToday(), created_by: "merchant:" + mid, updated_by: null, touched: 0 };
    row.title = titleOf(row) + " (" + kind + (qty ? " " + qty : "") + ")";
    await batch(db, [insertStmt(db, row), eventStmt(db, id, "merchant:" + mid, "created", "Merchant asked to " + kind + " the lock" + (qty ? " by " + qty : "") + (note ? " — " + note : ""))]);
    const access = await H.accessCfg(env);
    const to = assigneesOf(row, access, cfg);
    await pushStaffAlerts(env, [{ title: "Lock request from merchant " + row.merchant_name, body: row.title, audience: { all: false, roles: to.length ? [] : ADMIN_ROLES.slice(), users: to.length ? to : adminEmails(access, H) }, severity: "warning" }]);
    return json({ success: true, id });
  }

  return { handle, scheduled, runNow, getConfig, isLoopAction: (a) => /^loop[A-Z]/.test(String(a || "")) };
}

export function validateConfig(c) {
  const S = c.scoring;
  if (!(S.threshold > 0 && S.threshold <= 200)) return "Threshold must be between 1 and 200.";
  for (const k of Object.keys(S.windows)) {
    const w = S.windows[k];
    for (const part of ["r", "h"]) { const a = w[part]; if (!Array.isArray(a) || a.length !== 2 || !(a[0] >= 1) || !(a[1] >= a[0]) || a[1] > 13) return "Window " + k + "." + part + " must be [from, to] with 1 ≤ from ≤ to ≤ 13."; }
    if (w.h[0] <= w.r[1]) return "Window " + k + ": the history must start after the recent window ends.";
  }
  const mw = c.merchant.window; if (!(mw.r[0] >= 1 && mw.r[1] >= mw.r[0] && mw.h[0] > mw.r[1] && mw.h[1] >= mw.h[0] && mw.h[1] <= 13)) return "Merchant window is not valid.";
  if (!(c.cpa.shipping >= 0 && c.cpa.shipping <= 1000)) return "RE-CPA shipping fee must be 0–1000.";
  if (!(c.cpa.safetyPct >= 0 && c.cpa.safetyPct < 100)) return "RE-CPA safety must be 0–99%.";
  if (!Array.isArray(c.engine.runHours) || c.engine.runHours.some((h) => !(h >= 0 && h <= 23))) return "Run hours must be 0–23.";
  for (const r of Object.keys(c.routing)) { const x = c.routing[r]; if (!x || typeof x.section !== "string" || !x.section) return "Routing " + r + " needs a section."; if (!(x.sla >= 0)) return "Routing " + r + ": SLA must be ≥ 0."; }
  return null;
}
