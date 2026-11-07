// v1.17.8 — Usage Log: who opened the dashboard, when, for how long, which tabs, which downloads.
//
//   POST ?action=usagePing   (any signed-in staff user — the browser sends a small update every ~90 s while the dashboard is on screen,
//                             and when the tab is hidden / closed). The e-mail comes from the signed staff token, never from the body,
//                             so nobody can log activity under somebody else's name.
//   GET  ?action=usageLog    (Admin only, same X-Admin-Key as Activity Log) → sessions + tabs + downloads for a Cairo date range.
//
// Storage: the Command Loop D1 database (binding LOOP_DB) — the tables are created automatically on the first update
// (CREATE TABLE IF NOT EXISTS), so nothing needs to be created by hand. Anything older than 6 months is deleted automatically.
// One "session" = one open dashboard tab (page load). Time only counts while the tab is on screen: a hidden tab or a sleeping computer adds nothing.

const RETENTION_DAYS = 183;
const MAX_TABS_PER_PING = 60, MAX_DOWNLOADS_PER_PING = 30;
const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const DAY_MS = 86400000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS usage_sessions (
    sid TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, role TEXT,
    started_at TEXT NOT NULL, last_seen TEXT NOT NULL, open_ms INTEGER NOT NULL DEFAULT 0, active_ms INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS usage_sessions_day ON usage_sessions (day)`,
  `CREATE INDEX IF NOT EXISTS usage_sessions_email ON usage_sessions (email, started_at)`,
  `CREATE TABLE IF NOT EXISTS usage_tabs (
    sid TEXT NOT NULL, seg INTEGER NOT NULL, at TEXT NOT NULL, tab TEXT NOT NULL, ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sid, seg))`,
  `CREATE TABLE IF NOT EXISTS usage_downloads (
    sid TEXT NOT NULL, n INTEGER NOT NULL, at TEXT NOT NULL, what TEXT, rows INTEGER, tab TEXT, PRIMARY KEY (sid, n))`
];

const cairoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
export function cairoDay(iso) { return cairoFmt.format(new Date(iso)); }
const clip = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const intIn = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo; };
const isoOk = (v) => typeof v === "string" && v.length <= 40 && !isNaN(Date.parse(v));

export function createUsage(deps) {
  const { jsonResponse, staffSession, towerAdminOk } = deps;
  let schemaReady = false;
  async function ensureSchema(db) {
    if (schemaReady) return;
    for (const q of SCHEMA) await db.prepare(q).run();
    schemaReady = true;
  }

  async function prune(db) {
    const cutoff = cairoDay(new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString());
    const old = "(SELECT sid FROM usage_sessions WHERE day < ?)";
    await db.batch([
      db.prepare("DELETE FROM usage_tabs WHERE sid IN " + old).bind(cutoff),
      db.prepare("DELETE FROM usage_downloads WHERE sid IN " + old).bind(cutoff),
      db.prepare("DELETE FROM usage_sessions WHERE day < ?").bind(cutoff)
    ]);
  }

  async function ping(request, url, env) {
    if (request.method !== "POST") return jsonResponse({ success: false, message: "POST required." }, 405);
    const db = env.LOOP_DB;
    if (!db) return jsonResponse({ success: false, message: "LOOP_DB is not bound on the Worker." }, 503);
    const ss = await staffSession(request, url, env, "usagePing");
    if (!ss || ss.pending || !ss.e) return jsonResponse({ success: false, code: "staff_auth", message: "Please sign in again." }, 401);
    let b;
    try { b = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
    if (!b || typeof b !== "object") return jsonResponse({ success: false, message: "Body must be JSON." }, 400);
    const sid = String(b.sid || "");
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(sid)) return jsonResponse({ success: false, message: "Bad session id." }, 400);

    await ensureSchema(db);
    const now = Date.now(), nowIso = new Date(now).toISOString();
    const email = String(ss.e).trim().toLowerCase();                       // identity = the signed token
    const startedMs = isoOk(b.startedAt) ? Date.parse(b.startedAt) : now;
    const started = (startedMs > now + 5 * 60000 || startedMs < now - 7 * DAY_MS) ? nowIso : new Date(startedMs).toISOString();
    const openMs = intIn(b.openMs, 0, DAY_MS), activeMs = Math.min(openMs, intIn(b.activeMs, 0, DAY_MS));
    const stmts = [
      db.prepare(
        `INSERT INTO usage_sessions (sid, email, name, role, started_at, last_seen, open_ms, active_ms, day) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(sid) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name,
           open_ms = MAX(usage_sessions.open_ms, excluded.open_ms), active_ms = MAX(usage_sessions.active_ms, excluded.active_ms)
         WHERE usage_sessions.email = excluded.email`
      ).bind(sid, email, clip(b.name, 80), clip(ss.r, 40), started, nowIso, openMs, activeMs, cairoDay(started))
    ];
    for (const t of (Array.isArray(b.tabs) ? b.tabs : []).slice(0, MAX_TABS_PER_PING)) {
      if (!t || !isoOk(t.at) || !clip(t.tab, 120)) continue;
      // only into a session that belongs to the caller (the session row of this update is written first, in the same batch)
      stmts.push(db.prepare(
        `INSERT INTO usage_tabs (sid, seg, at, tab, ms) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM usage_sessions WHERE sid = ? AND email = ?)
         ON CONFLICT(sid, seg) DO UPDATE SET ms = MAX(usage_tabs.ms, excluded.ms)`
      ).bind(sid, intIn(t.n, 0, 100000), new Date(t.at).toISOString(), clip(t.tab, 120), intIn(t.ms, 0, DAY_MS), sid, email));
    }
    for (const d of (Array.isArray(b.downloads) ? b.downloads : []).slice(0, MAX_DOWNLOADS_PER_PING)) {
      if (!d || !isoOk(d.at) || !clip(d.what, 160)) continue;
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO usage_downloads (sid, n, at, what, rows, tab) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM usage_sessions WHERE sid = ? AND email = ?)`
      ).bind(sid, intIn(d.n, 0, 100000), new Date(d.at).toISOString(), clip(d.what, 160), d.rows == null ? null : intIn(d.rows, 0, 50000000), clip(d.tab, 120), sid, email));
    }
    await db.batch(stmts);
    if (Math.random() < 0.005) { try { await prune(db); } catch (e) {} }   // ~ once per 200 updates
    return jsonResponse({ success: true });
  }

  async function log(request, url, env) {
    if (!towerAdminOk(request, env)) return jsonResponse({ success: false, message: "Wrong admin key." }, 403);
    const db = env.LOOP_DB;
    if (!db) return jsonResponse({ success: false, message: "LOOP_DB is not bound on the Worker." }, 503);
    await ensureSchema(db);
    const dayRe = /^\d{4}-\d{2}-\d{2}$/, today = cairoDay(new Date().toISOString());
    let from = url.searchParams.get("from") || today, to = url.searchParams.get("to") || from;
    if (!dayRe.test(from) || !dayRe.test(to)) return jsonResponse({ success: false, message: "from / to must be YYYY-MM-DD." }, 400);
    if (from > to) { const t = from; from = to; to = t; }
    const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) return jsonResponse({ success: false, message: "Bad e-mail." }, 400);
    const where = "s.day >= ? AND s.day <= ?" + (email ? " AND s.email = ?" : "");
    const args = email ? [from, to, email] : [from, to];
    const SESSION_LIMIT = 3000;
    const sessions = ((await db.prepare("SELECT s.sid, s.email, s.name, s.role, s.started_at, s.last_seen, s.open_ms, s.active_ms, s.day FROM usage_sessions s WHERE " + where + " ORDER BY s.started_at DESC LIMIT " + SESSION_LIMIT).bind(...args).all()).results || []);
    const tabs = ((await db.prepare("SELECT t.sid, t.seg, t.at, t.tab, t.ms FROM usage_tabs t JOIN usage_sessions s ON s.sid = t.sid WHERE " + where + " ORDER BY t.at LIMIT 40000").bind(...args).all()).results || []);
    const downloads = ((await db.prepare("SELECT d.sid, d.n, d.at, d.what, d.rows, d.tab FROM usage_downloads d JOIN usage_sessions s ON s.sid = d.sid WHERE " + where + " ORDER BY d.at LIMIT 10000").bind(...args).all()).results || []);
    const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    const online = ((await db.prepare("SELECT DISTINCT email FROM usage_sessions WHERE last_seen >= ?").bind(onlineSince).all()).results || []).map((r) => r.email);
    return jsonResponse({ success: true, now: new Date().toISOString(), from, to, retentionDays: RETENTION_DAYS, truncated: sessions.length >= SESSION_LIMIT, sessions, tabs, downloads, online });
  }

  return {
    prune,
    isUsageAction: (a) => a === "usagePing" || a === "usageLog",
    handle: (action, request, url, env) => (action === "usagePing" ? ping(request, url, env) : log(request, url, env))
  };
}
