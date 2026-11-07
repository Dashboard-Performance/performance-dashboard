// v1.19.0 — ML Forecast plumbing. The model itself runs in Python on GitHub Actions (taager-ml-forecast); this file only
//   1) lets that job read the few Metabase sources it needs WITHOUT the Metabase links ever leaving the Worker  (GET  ?action=mlSource&gid=…)
//   2) stores what the job produced                                                                            (POST ?action=mlPut&kind=latest|locked[&month=YYYY-MM])
//   3) serves it to the dashboard (staff session) and back to the job (service key)                            (GET  ?action=mlGet[&month=…|&list=1])
//
// A "locked" forecast is the number for a month that was frozen on the day that month started. It is WRITE-ONCE: a second write for the same
// month is refused (409), so nobody (and no re-run of the job) can quietly change a number after the month began.
// Auth: mlSource / mlPut need the service key (X-Service-Key = SERVICE_KEY or ADMIN_KEY, same as the Command Loop); mlGet also accepts a staff session.
// Storage: KV (SYNC_CACHE) — keys ml:latest, ml:locked:YYYY-MM, ml:locked:index.

export const ML_GIDS = {
  "7100000002": "Product Only",
  "2099497960": "Main",
  "1409034448": "Products Debundle Map",
  "1779314157": "Products",
  "22283311": "EGY Beginning Inventory"
};
const MAX_BYTES = 12 * 1024 * 1024;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACTIONS = new Set(["mlSource", "mlPut", "mlGet"]);

export function createMl({ jsonResponse, serviceOk, metabaseProxy }) {
  const isMlAction = (a) => ACTIONS.has(a);
  async function handle(action, request, url, env) {
    if (!env.SYNC_CACHE) return jsonResponse({ success: false, message: "KV not bound." }, 500);
    if (action === "mlSource") {
      if (!(await serviceOk(request, env))) return jsonResponse({ success: false, message: "Service key required." }, 401);
      const gid = String(url.searchParams.get("gid") || "");
      if (!ML_GIDS[gid]) return jsonResponse({ success: false, message: "This source is not available to the ML job." }, 403);
      return metabaseProxy(url, env);
    }
    if (action === "mlPut") {
      if (request.method !== "POST") return jsonResponse({ success: false, message: "POST only." }, 405);
      if (!(await serviceOk(request, env))) return jsonResponse({ success: false, message: "Service key required." }, 401);
      const kind = String(url.searchParams.get("kind") || ""), month = String(url.searchParams.get("month") || "");
      if (kind !== "latest" && kind !== "locked") return jsonResponse({ success: false, message: "kind must be latest or locked." }, 400);
      if (kind === "locked" && !MONTH_RE.test(month)) return jsonResponse({ success: false, message: "locked needs month=YYYY-MM." }, 400);
      const text = await request.text();
      if (text.length > MAX_BYTES) return jsonResponse({ success: false, message: "Payload too large." }, 413);
      let body; try { body = JSON.parse(text); } catch (e) { return jsonResponse({ success: false, message: "Body must be JSON." }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ success: false, message: "Body must be a JSON object." }, 400);
      if (kind === "locked") {
        if (body.month !== month || !body.rows || typeof body.rows !== "object") return jsonResponse({ success: false, message: "Locked payload needs month and rows." }, 400);
        const key = "ml:locked:" + month;
        if (await env.SYNC_CACHE.get(key)) return jsonResponse({ success: false, code: "locked", message: "Month " + month + " is already locked and cannot be changed." }, 409);
        await env.SYNC_CACHE.put(key, text);
        let idx = []; try { idx = JSON.parse((await env.SYNC_CACHE.get("ml:locked:index")) || "[]"); } catch (e) {}
        if (idx.indexOf(month) < 0) idx.push(month);
        idx.sort();
        await env.SYNC_CACHE.put("ml:locked:index", JSON.stringify(idx));
        return jsonResponse({ success: true, locked: month, months: idx });
      }
      await env.SYNC_CACHE.put("ml:latest", text);
      return jsonResponse({ success: true, bytes: text.length });
    }
    if (action === "mlGet") {
      // staff session was already checked by the Worker gate; the service key is accepted by the gate for this action too
      const month = String(url.searchParams.get("month") || "");
      if (url.searchParams.get("list")) {
        let idx = []; try { idx = JSON.parse((await env.SYNC_CACHE.get("ml:locked:index")) || "[]"); } catch (e) {}
        return jsonResponse({ success: true, months: idx });
      }
      const key = month ? (MONTH_RE.test(month) ? "ml:locked:" + month : "") : "ml:latest";
      if (!key) return jsonResponse({ success: false, message: "month must be YYYY-MM." }, 400);
      const text = await env.SYNC_CACHE.get(key);
      if (!text) return jsonResponse({ success: false, code: "empty", message: month ? "Nothing locked for " + month + " yet." : "The model has not published anything yet." }, 404);
      return new Response(text, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
    }
    return jsonResponse({ success: false, message: "unknown ml action" }, 404);
  }
  return { isMlAction, handle };
}
