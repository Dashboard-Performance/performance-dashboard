// Static files served by the merchant portal Worker. Nothing here is secret: no URLs, keys or data —
// the browser only ever talks to this Worker's own /api/* endpoints.
// No inline <script> and no style="" attributes anywhere (the CSP forbids both).

const HEAD = (title, script) => `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/app.css">
<script src="/static/${script}" defer></script>
</head>`;

export const PORTAL_HTML = HEAD("Taager · Merchant portal", "portal.js") + `
<body>
<div id="boot" class="boot"><div class="spinner"></div></div>

<main id="auth" class="auth hidden">
  <div class="auth-card">
    <div class="brand"><span class="logo">T</span><div><b>Taager</b><small>Merchant portal</small></div></div>
    <form id="loginForm" class="form" autocomplete="on" novalidate>
      <h1>Sign in</h1>
      <label>Email<input id="lEmail" type="email" autocomplete="username" required></label>
      <label>Password<input id="lPass" type="password" autocomplete="current-password" required></label>
      <div class="msg" id="lMsg" role="alert"></div>
      <button class="btn primary" type="submit">Sign in</button>
      <button class="link hidden" type="button" id="toForgot">Forgot your password?</button>
    </form>
    <form id="forgotForm" class="form hidden" novalidate>
      <h1>Reset password</h1>
      <p class="dim">Enter your email. If it has an account, we will send you a link to choose a new password.</p>
      <label>Email<input id="fEmail" type="email" autocomplete="username" required></label>
      <div class="msg" id="fMsg" role="alert"></div>
      <button class="btn primary" type="submit">Send link</button>
      <button class="link" type="button" id="backLogin">Back to sign in</button>
    </form>
    <form id="setForm" class="form hidden" novalidate>
      <h1>Choose your password</h1>
      <p class="dim">At least 10 characters, with letters and numbers.</p>
      <label>New password<input id="sPass" type="password" autocomplete="new-password" required></label>
      <label>Repeat password<input id="sPass2" type="password" autocomplete="new-password" required></label>
      <div class="msg" id="sMsg" role="alert"></div>
      <button class="btn primary" type="submit">Save and continue</button>
    </form>
  </div>
</main>

<div id="app" class="app hidden">
  <header class="top">
    <div class="brand"><span class="logo">T</span><div><b id="mName">Your store</b><small id="mIds"></small></div></div>
    <div class="top-r">
      <select id="monthSel" aria-label="Month"></select>
      <button class="btn icon" id="themeBtn" type="button" title="Light / dark" aria-label="Switch theme">◐</button>
      <div class="menu">
        <button class="btn" id="menuBtn" type="button" aria-haspopup="true">Account ▾</button>
        <div class="menu-list hidden" id="menuList">
          <div class="menu-who" id="whoEmail"></div>
          <button type="button" id="chgBtn">Change password</button>
          <button type="button" id="outBtn">Sign out</button>
        </div>
      </div>
    </div>
  </header>

  <div class="content">
    <div class="note hidden" id="dataNote"></div>

    <section class="hero card">
      <div class="hero-l">
        <div id="ring" class="ring"></div>
        <div class="eq">
          <div class="chip"><span>CR</span><b id="crVal">0%</b><small>Confirmed ÷ Placed</small></div>
          <i>×</i>
          <div class="chip"><span>DR</span><b id="drVal">0%</b><small>Delivered ÷ Confirmed</small></div>
        </div>
      </div>
      <div class="hero-r">
        <div class="tile"><span class="lbl">Placed Pieces</span><b class="val" id="vPlaced">0</b><div class="sub" id="oPlaced"></div><div class="sub" id="rPlaced">Run Rate: —</div><div class="spark" id="sPlaced"></div></div>
        <div class="tile"><span class="lbl">Confirmed Pieces</span><b class="val" id="vConfirmed">0</b><div class="sub" id="oConfirmed"></div><div class="sub" id="rConfirmed">Run Rate: —</div><div class="spark" id="sConfirmed"></div></div>
        <div class="tile"><span class="lbl">Delivered Pieces</span><b class="val" id="vDelivered">0</b><div class="sub" id="oDelivered"></div><div class="sub" id="rDelivered">Run Rate: —</div><div class="spark" id="sDelivered"></div></div>
        <div class="tile"><span class="lbl">Delivered GMV</span><b class="val green" id="vGmv">EGP 0</b><div class="sub">&nbsp;</div><div class="sub" id="rGmv">Run Rate: —</div><div class="spark" id="sGmv"></div></div>
      </div>
    </section>

    <div class="row2">
      <section class="card">
        <div class="card-h">
          <div><h2>Monthly Pipeline</h2><p id="pipeSub">Confirmed Pieces (bars) vs Placed Pieces (line) per month</p></div>
          <div class="seg" id="pipeToggle"><button type="button" data-m="orders">Orders</button><button type="button" data-m="pieces" class="on">Pieces</button></div>
        </div>
        <div class="chart" id="pipeChart"></div>
      </section>
      <section class="card">
        <div class="card-h"><div><h2>Avg Placed Pcs</h2><p id="avgSub">Placed pieces ÷ days in the month</p></div></div>
        <div class="avg">
          <div class="avg-v" id="avgVal">0</div><div class="sub">pieces per day</div>
          <div class="spark wide" id="avgSpark"></div>
          <div class="avg-rows">
            <div><span>Placed pieces</span><b id="avgPcs">—</b></div>
            <div><span>Days counted</span><b id="avgDays">—</b></div>
            <div><span>Previous month</span><b id="avgPrev">—</b></div>
            <div><span>Change vs previous month</span><b id="avgChg">—</b></div>
            <div><span>Best month</span><b id="avgBest">—</b></div>
          </div>
        </div>
      </section>
    </div>
    <p class="foot dim" id="foot"></p>
  </div>
  <div class="tip hidden" id="tip"></div>
</div>

<div class="modal hidden" id="chgModal" role="dialog" aria-modal="true" aria-labelledby="chgTitle">
  <form class="modal-box form" id="chgForm" novalidate>
    <h1 id="chgTitle">Change password</h1>
    <label>Current password<input id="cCur" type="password" autocomplete="current-password" required></label>
    <label>New password<input id="cNew" type="password" autocomplete="new-password" required></label>
    <label>Repeat new password<input id="cNew2" type="password" autocomplete="new-password" required></label>
    <div class="msg" id="cMsg" role="alert"></div>
    <div class="row-btns"><button class="btn" type="button" id="chgCancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
  </form>
</div>
</body></html>`;

export const ADMIN_HTML = HEAD("Taager · Merchant portal admin", "admin.js") + `
<body class="admin">
<header class="top">
  <div class="brand"><span class="logo">T</span><div><b>Merchant portal</b><small>Admin</small></div></div>
  <div class="top-r"><button class="btn icon" id="themeBtn" type="button" aria-label="Switch theme">◐</button></div>
</header>
<div class="content">
  <section class="card" id="keyCard">
    <h2>Admin key</h2>
    <p class="dim">The ADMIN_KEY secret of this Worker. Kept in this tab only and forgotten when you close it.</p>
    <div class="inline"><input type="password" id="key" placeholder="ADMIN_KEY" autocomplete="off"><button class="btn primary" id="keyGo" type="button">Open</button><span class="msg" id="keyMsg"></span></div>
  </section>

  <div id="adm" class="hidden">
    <section class="card">
      <div class="card-h"><div><h2>Data</h2><p>The portal reads one Metabase question only — the merchant query — and keeps the counts per merchant per month. It refreshes on the schedule in wrangler.toml.</p></div>
        <button class="btn" id="refreshBtn" type="button">Refresh now</button></div>
      <div id="dataBox" class="kv"></div>
      <details class="cols"><summary>Check the column mapping</summary><div id="colBox"></div></details>
    </section>

    <section class="card">
      <div class="card-h"><div><h2>Merchant accounts</h2><p>Each account sees only the Merchant IDs listed on it.</p></div>
        <button class="btn" id="importBtn" type="button">Import merchants from the dashboard</button></div>
      <form class="inline add" id="addForm" novalidate>
        <input id="aEmail" type="email" placeholder="merchant@email.com" required>
        <input id="aName" placeholder="Name (optional)">
        <input id="aIds" placeholder="Merchant ID(s), comma separated" required>
        <label class="check"><input type="checkbox" id="aMail" checked> Email the link</label>
        <button class="btn primary" type="submit">Add / update</button>
      </form>
      <div class="msg" id="accMsg"></div>
      <div class="links hidden" id="linkBox"></div>
      <input type="search" id="q" placeholder="Search accounts" class="search">
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Name</th><th>Merchant IDs</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody id="accBody"></tbody></table></div>
    </section>
  </div>
</div>
</body></html>`;

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#2dd4a8"/><text x="32" y="44" font-family="Arial,sans-serif" font-size="34" font-weight="800" text-anchor="middle" fill="#04251d">T</text></svg>`;

export const APP_CSS = `
:root{--accent:#2dd4a8;--accent-ink:#04251d;--bg:#04070b;--bg2:#070b11;--panel:#0b111a;--panel2:#0f1722;--panel3:#141e2c;--line:#17212e;--line2:#223044;--text:#f6f8fb;--text2:#aab6c6;--dim:#74839a;--green:#34d399;--red:#fb7185;--orange:#fbbf24;--purple:#a78bfa;--blue:#60a5fa;--r:14px;color-scheme:dark}
html[data-theme=light]{--accent:#0ea58a;--accent-ink:#fff;--bg:#f3f6fb;--bg2:#fff;--panel:#fff;--panel2:#f7f9fd;--panel3:#edf1f8;--line:#e3e8f1;--line2:#d3dae8;--text:#0e1a2e;--text2:#44526b;--dim:#6a7791;--green:#0f9d6b;--red:#e0444b;--orange:#d98a0a;--purple:#7c5cf0;--blue:#2f7de1;color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.hidden{display:none!important}
.dim{color:var(--dim)}
h1{font-size:20px;margin:0 0 6px;letter-spacing:-.01em}
h2{font-size:15px;margin:0;font-weight:650}
p{margin:0}
button,input,select{font:inherit;color:inherit}
input,select{min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--panel);color:var(--text);outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 20%,transparent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--line2);background:var(--panel);font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,filter .15s}
.btn:hover{background:var(--panel3)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{filter:brightness(1.08)}
.btn.small{min-height:30px;padding:0 10px;font-size:12px;border-radius:8px}
.btn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 40%,var(--line2))}
.btn.icon{width:38px;padding:0}
.btn[disabled]{opacity:.5;pointer-events:none}
.link{background:none;border:0;color:var(--accent);cursor:pointer;padding:4px 0;font-weight:600}
.msg{min-height:18px;font-size:13px;color:var(--dim)}
.msg.err{color:var(--red)} .msg.ok{color:var(--green)}
.boot{position:fixed;inset:0;display:grid;place-items:center}
.spinner{width:34px;height:34px;border-radius:50%;border:3px solid var(--line2);border-top-color:var(--accent);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand small{display:block;color:var(--dim);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.logo{flex:none;width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-weight:800;color:var(--accent-ink);background:linear-gradient(145deg,var(--accent),color-mix(in srgb,var(--accent) 45%,#000))}

/* auth */
.auth{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(800px 360px at 80% -10%,color-mix(in srgb,var(--accent) 12%,transparent),transparent 70%)}
.auth-card{width:min(400px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 30px 60px -30px rgba(0,0,0,.6)}
.auth-card .brand{margin-bottom:22px}
.form{display:flex;flex-direction:column;gap:12px}
.form label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:var(--text2)}

/* app */
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 24px;background:color-mix(in srgb,var(--bg2) 85%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.top-r{display:flex;align-items:center;gap:8px}
.content{max-width:1280px;margin:0 auto;padding:22px 24px 48px;display:flex;flex-direction:column;gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:18px;box-shadow:0 12px 32px -22px rgba(0,0,0,.7);min-width:0}
.card-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.card-h p{color:var(--dim);font-size:12.5px;margin-top:3px}
.note{padding:10px 14px;border-radius:12px;font-size:13px;color:var(--orange);background:color-mix(in srgb,var(--orange) 9%,var(--panel));border:1px solid color-mix(in srgb,var(--orange) 30%,var(--line))}
.menu{position:relative}
.menu-list{position:absolute;right:0;top:calc(100% + 6px);min-width:220px;background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:6px;box-shadow:0 20px 40px -16px rgba(0,0,0,.6);display:flex;flex-direction:column}
.menu-list button{text-align:left;background:none;border:0;padding:9px 10px;border-radius:8px;cursor:pointer}
.menu-list button:hover{background:var(--panel3)}
.menu-who{padding:8px 10px;color:var(--dim);font-size:12px;border-bottom:1px solid var(--line);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis}

.hero{display:grid;grid-template-columns:320px 1fr;padding:0;overflow:hidden;background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 7%,var(--panel)),var(--panel) 60%)}
.hero-l{padding:22px 18px 20px;display:flex;flex-direction:column;align-items:center;gap:14px;border-right:1px solid var(--line)}
.ring svg{display:block}
.ring .track{stroke:var(--line2)} .ring .bar{stroke:var(--accent)}
.ring .big{font-size:38px;font-weight:800;fill:var(--text);letter-spacing:-1px} .ring .cap{font-size:12px;fill:var(--dim)}
.eq{display:flex;align-items:center;gap:12px} .eq i{font-style:normal;color:var(--dim);font-size:18px}
.chip{min-width:92px;padding:8px 12px;border:1px solid var(--line2);border-radius:12px;text-align:center;background:var(--panel);display:flex;flex-direction:column;gap:2px}
.chip span{font-size:11px;font-weight:700;color:var(--dim)} .chip b{font-size:20px;font-weight:800} .chip small{font-size:10.5px;color:var(--dim)}
.hero-r{display:grid;grid-template-columns:1fr 1fr}
.tile{padding:18px 22px 12px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);min-width:0}
.tile:nth-child(2n){border-right:0} .tile:nth-last-child(-n+2){border-bottom:0}
.lbl{font-size:12px;font-weight:700;color:var(--dim)}
.val{font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.15} .val.green{color:var(--green)}
.sub{font-size:12px;color:var(--dim)}
.spark{margin-top:auto;padding-top:8px;max-width:220px;height:38px} .spark.wide{max-width:none;height:78px;padding:4px 0 10px}
.spark svg{display:block;width:100%}
.s-area{opacity:.14}
.k-placed{stroke:var(--blue);fill:var(--blue)} .k-confirmed{stroke:var(--purple);fill:var(--purple)} .k-delivered{stroke:var(--accent);fill:var(--accent)} .k-gmv{stroke:var(--green);fill:var(--green)} .k-avg{stroke:var(--orange);fill:var(--orange)}
.s-line{fill:none!important;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.row2{display:grid;grid-template-columns:1.6fr 1fr;gap:16px}
.seg{display:inline-flex;padding:3px;border-radius:10px;background:var(--panel2);border:1px solid var(--line)}
.seg button{border:0;background:none;padding:6px 12px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--text2);cursor:pointer}
.seg button.on{background:var(--accent);color:var(--accent-ink)}
.chart{position:relative;min-height:120px} .chart.cats{min-height:0}
.chart>svg{display:block;max-width:100%}
.grid-l{stroke:var(--line);stroke-dasharray:3 4} .ax{fill:var(--dim);font-size:10.5px}
.bar-c{fill:var(--accent);opacity:.85} .line-p{fill:none;stroke:var(--text2);stroke-width:2} .dot-p{fill:var(--panel);stroke:var(--text2);stroke-width:1.5}
.hov{fill:transparent;cursor:crosshair} .hov:hover{fill:color-mix(in srgb,var(--accent) 8%,transparent)}
.cat-bar{fill:var(--purple)} .cat-lbl{fill:var(--text2);font-size:12px} .cat-val{fill:var(--text);font-size:12px;font-weight:700}
.legend{display:flex;gap:16px;justify-content:center;font-size:12px;color:var(--dim);margin-top:6px}
.legend span{display:inline-flex;align-items:center;gap:6px} .legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.legend .lc{background:var(--accent)} .legend .lp{background:var(--text2);height:3px;border-radius:2px}
.empty{height:100%;display:grid;place-items:center;color:var(--dim);font-size:13px;min-height:120px}
.avg-v{font-size:36px;font-weight:800;letter-spacing:-.03em}
.avg-rows>div{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line);font-size:13px} .avg-rows span{color:var(--dim)}
.tip{position:fixed;z-index:50;pointer-events:none;background:var(--panel3);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12px;box-shadow:0 10px 28px -10px rgba(0,0,0,.8);white-space:nowrap}
.tip b{display:block;margin-bottom:2px}
.foot{font-size:12px;text-align:center}
.modal{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(0,0,0,.5);padding:20px}
.modal-box{width:min(420px,100%);background:var(--panel);border:1px solid var(--line2);border-radius:16px;padding:24px}
.row-btns{display:flex;justify-content:flex-end;gap:8px}

/* admin */
.admin .content{max-width:1200px}
.inline{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.inline input{flex:1 1 180px} .inline input[type=checkbox]{flex:none;width:16px;height:16px;min-height:0;padding:0;accent-color:var(--accent)} .check{white-space:nowrap;flex:none}
#adm{display:flex;flex-direction:column;gap:16px}
.check{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text2)} .check input{min-height:0}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.kv div{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.kv span{display:block;font-size:11px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.05em} .kv b{font-size:15px;word-break:break-word}
.kv .bad b{color:var(--red)}
.cols{margin-top:12px} .cols summary{cursor:pointer;color:var(--accent);font-weight:600;font-size:13px}
.search{margin:12px 0 8px;width:100%;max-width:320px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);padding:9px 12px;background:var(--panel2);border-bottom:1px solid var(--line)}
.tbl td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tr:last-child td{border-bottom:0}
.tbl td.acts{text-align:right;white-space:nowrap} .tbl td.acts .btn{margin-left:4px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid var(--line2);color:var(--dim)}
.pill.active{color:var(--green);border-color:color-mix(in srgb,var(--green) 35%,var(--line2))}
.pill.invited{color:var(--orange);border-color:color-mix(in srgb,var(--orange) 35%,var(--line2))}
.pill.disabled{color:var(--red);border-color:color-mix(in srgb,var(--red) 35%,var(--line2))}
.links{margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--panel2);display:flex;flex-direction:column;gap:8px}
.links div{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px}
.links code{flex:1 1 260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.ok-t{color:var(--green)} .bad-t{color:var(--red)}

@media (max-width:1000px){.hero{grid-template-columns:1fr}.hero-l{border-right:0;border-bottom:1px solid var(--line)}.row2{grid-template-columns:1fr}}
@media (max-width:620px){.hero-r{grid-template-columns:1fr}.tile{border-right:0!important}.tile:nth-last-child(2){border-bottom:1px solid var(--line)}.top{padding:10px 14px;flex-wrap:wrap}.top .brand{flex:1 1 100%}.top-r{flex:1 1 100%;justify-content:flex-end}#monthSel{flex:1}.content{padding:16px 14px 40px}.val{font-size:26px}.top .menu .btn{padding:0 10px}}
`;

// ---------------------------------------------------------------------------------------- shared helpers
const SHARED_JS = `
"use strict";
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function api(path, opts) {
  opts = opts || {};
  var o = { method: opts.method || "GET", credentials: "same-origin", cache: "no-store", headers: { "X-Portal": "1" } };
  if (opts.body !== undefined) { o.method = opts.method || "POST"; o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.body); }
  if (opts.admin) o.headers["X-Admin-Key"] = opts.admin;
  return fetch(path, o).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || ("Error " + r.status)); e.status = r.status; throw e; }
      return j;
    });
  });
}
function msg(id, text, cls) { var e = $(id); if (!e) return; e.textContent = text || ""; e.className = "msg" + (cls ? " " + cls : ""); }
(function theme() {
  var t = null; try { t = localStorage.getItem("mpTheme"); } catch (e) {}
  if (!t) t = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#themeBtn")) return;
    var n = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", n); try { localStorage.setItem("mpTheme", n); } catch (er) {}
  });
})();
`;

// ---------------------------------------------------------------------------------------- merchant page
// The numbers below follow js/app.js of the staff dashboard line for line (computeMetrics, renderOverviewHero,
// renderPipelineChart, renderCategoryChart) so a merchant sees exactly what the Over View shows for them.
export const PORTAL_JS = SHARED_JS + `
var D = { rows: [], merchants: [], updatedAt: "" }, pipeMetric = "pieces", cfg = { emailEnabled: false };
var fmtInt = new Intl.NumberFormat("en-US");
function fmtPct(n) { return (n || 0).toFixed(1) + "%"; }
function fmtMoney(n) { if (!n) return "EGP 0"; var s = n < 0 ? "-" : "", a = Math.abs(n); if (a >= 1e6) return s + "EGP " + (a / 1e6).toFixed(2) + "M"; if (a >= 1e3) return s + "EGP " + Math.round(a / 1e3) + "K"; return s + "EGP " + Math.round(a); }
var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function monthTitle(k) { var p = k.split("-"); return MONTHS[+p[1] - 1] + " " + p[0]; }

// ---- views
function show(id) { ["boot", "auth", "app"].forEach(function (x) { $(x).classList.toggle("hidden", x !== id); }); }
function authForm(id) { ["loginForm", "forgotForm", "setForm"].forEach(function (x) { $(x).classList.toggle("hidden", x !== id); }); show("auth"); var f = $(id).querySelector("input"); if (f) f.focus(); }
function linkToken() { var m = /[#&]t=([A-Za-z0-9_-]{20,100})/.exec(location.hash || ""); return m ? m[1] : ""; }

function start() {
  api("/api/config").then(function (c) { cfg = c; $("toForgot").classList.toggle("hidden", !c.emailEnabled); }).catch(function () {});
  if (location.pathname === "/set-password" && linkToken()) { authForm("setForm"); return; }
  api("/api/me").then(enter).catch(function () { authForm("loginForm"); });
}
function enter(me) {
  $("whoEmail").textContent = me.email;
  show("app"); $("boot").classList.add("hidden");
  loadData();
}
function loadData() {
  $("dataNote").classList.add("hidden");
  return api("/api/data").then(function (d) {
    D = d;
    var names = d.merchants.map(function (m) { return m.name; }).filter(Boolean);
    $("mName").textContent = names.length ? names.join(" · ") : "Your store";
    $("mIds").textContent = "Merchant ID " + d.merchants.map(function (m) { return m.id; }).join(", ");
    fillMonths();
    render();
    $("foot").textContent = "Numbers updated " + new Date(d.updatedAt).toLocaleString();
    if (!d.rows.length) note("No orders yet for your Merchant ID. If this looks wrong, contact your Taager account manager.");
  }).catch(function (e) {
    if (e.status === 401) { authForm("loginForm"); return; }
    note(e.message);
  });
}
function note(t) { var n = $("dataNote"); n.textContent = t; n.classList.remove("hidden"); }
function fillMonths() {
  var set = {}; D.rows.forEach(function (r) { set[r[0]] = 1; });
  var cur = ymd(new Date()).slice(0, 7); var keys = Object.keys(set).sort().reverse();
  var sel = $("monthSel"), first = !sel.options.length, keep = sel.value;
  sel.innerHTML = '<option value="">All Months</option>' + keys.map(function (k) { return '<option value="' + k + '">' + monthTitle(k) + "</option>"; }).join("");
  sel.value = !first && (keep === "" || set[keep]) ? keep : (set[cur] ? cur : (keys[0] || ""));
}
function rowsOfMonth() { var k = $("monthSel").value; return k ? D.rows.filter(function (r) { return r[0] === k; }) : D.rows.slice(); }

// ---- calculations (row = [month "YYYY-MM", placedOrders, confirmedOrders, deliveredOrders, placedPcs, confirmedPcs, deliveredPcs, deliveredGmv])
// Same definitions as the staff dashboard: CR = Confirmed ÷ Placed, DR = Delivered ÷ Confirmed, NDR = CR × DR,
// Run Rate = month-to-date ÷ days passed × days in the month (the current month runs up to yesterday).
function sumRows(rows) { var T = { po: 0, co: 0, do: 0, pp: 0, cp: 0, dp: 0, gmv: 0 }; rows.forEach(function (r) { T.po += r[1]; T.co += r[2]; T.do += r[3]; T.pp += r[4]; T.cp += r[5]; T.dp += r[6]; T.gmv += r[7]; }); return T; }
function daysIn(k) { var p = k.split("-"); return new Date(+p[0], +p[1], 0).getDate(); }
function daysCounted(k) { var now = new Date(), cur = ymd(now).slice(0, 7); if (k !== cur) return daysIn(k); return Math.max(1, now.getDate() - 1); }
function byMonth() { var o = {}; D.rows.forEach(function (r) { var t = o[r[0]] || (o[r[0]] = []); t.push(r); }); return o; }
function monthsUpTo(k, n) { var all = Object.keys(byMonth()).sort(); if (k) all = all.filter(function (m) { return m <= k; }); return all.slice(-n); }

// ---- svg helpers (classes only: the CSP blocks inline styles)
function spark(values, cls, w, h) {
  if (!values || values.length < 2) return "";
  var max = Math.max.apply(null, values), min = Math.min.apply(null, values), span = (max - min) || 1;
  var pts = values.map(function (v, i) { return [(i * (w - 2) / (values.length - 1)) + 1, h - 3 - ((v - min) / span) * (h - 6)]; });
  var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("");
  return '<svg viewBox="0 0 ' + w + " " + h + '" height="' + h + '" preserveAspectRatio="none" aria-hidden="true"><path class="s-area ' + cls + '" stroke="none" d="' + line + "L" + (w - 1) + " " + h + "L1 " + h + 'Z"/><path class="s-line ' + cls + '" d="' + line + '"/></svg>';
}
function ring(pct) {
  var S = 200, r = 82, cx = S / 2, c = 2 * Math.PI * r, len = c * 0.75, v = Math.max(0, Math.min(100, pct || 0)) / 100, rot = "rotate(135 " + cx + " " + cx + ")";
  return '<svg viewBox="0 0 ' + S + " " + S + '" width="' + S + '" height="' + S + '" role="img" aria-label="Net delivery rate ' + pct.toFixed(1) + '%">' +
    '<circle class="track" cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + len + " " + c + '" transform="' + rot + '"/>' +
    '<circle class="bar" cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + Math.max(2, len * v) + " " + c + '" transform="' + rot + '"/>' +
    '<text class="big" x="' + cx + '" y="' + (cx + 6) + '" text-anchor="middle">' + pct.toFixed(1) + '%</text><text class="cap" x="' + cx + '" y="' + (cx + 30) + '" text-anchor="middle">Net delivery rate</text></svg>';
}
function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function shortMonth(k) { var p = k.split("-"); return MONTHS[+p[1] - 1].slice(0, 3) + " " + p[0].slice(2); }

function render() {
  var k = $("monthSel").value, rows = rowsOfMonth(), T = sumRows(rows), set = function (id, v) { $(id).textContent = v; };
  var cr = T.po ? T.co / T.po : 0, dr = T.co ? T.do / T.co : 0;
  $("ring").innerHTML = ring(cr * dr * 100);
  set("crVal", fmtPct(cr * 100)); set("drVal", fmtPct(dr * 100));
  set("vPlaced", fmtInt.format(Math.round(T.pp))); set("vConfirmed", fmtInt.format(Math.round(T.cp))); set("vDelivered", fmtInt.format(Math.round(T.dp)));
  set("oPlaced", fmtInt.format(Math.round(T.po)) + " orders"); set("oConfirmed", fmtInt.format(Math.round(T.co)) + " orders"); set("oDelivered", fmtInt.format(Math.round(T.do)) + " orders");
  set("vGmv", fmtMoney(T.gmv));
  var cur = ymd(new Date()).slice(0, 7);
  if (k === cur) {
    var f = daysIn(k) / daysCounted(k);
    set("rPlaced", "Run Rate: " + fmtInt.format(Math.round(T.pp * f)) + " by EOM"); set("rConfirmed", "Run Rate: " + fmtInt.format(Math.round(T.cp * f)) + " by EOM");
    set("rDelivered", "Run Rate: " + fmtInt.format(Math.round(T.dp * f)) + " by EOM"); set("rGmv", "Run Rate: " + fmtMoney(T.gmv * f) + " by EOM");
  } else { ["rPlaced", "rConfirmed", "rDelivered", "rGmv"].forEach(function (id) { set(id, k ? "Full month" : "All months"); }); }

  // sparklines + charts: the 12 months up to the selected one
  var BM = byMonth(), months = monthsUpTo(k, 12), M = months.map(function (m) { var t = sumRows(BM[m]); t.k = m; return t; });
  $("sPlaced").innerHTML = spark(M.map(function (x) { return x.pp; }), "k-placed", 150, 30);
  $("sConfirmed").innerHTML = spark(M.map(function (x) { return x.cp; }), "k-confirmed", 150, 30);
  $("sDelivered").innerHTML = spark(M.map(function (x) { return x.dp; }), "k-delivered", 150, 30);
  $("sGmv").innerHTML = spark(M.map(function (x) { return x.gmv; }), "k-gmv", 150, 30);

  // Avg placed pieces per day
  var avgOf = function (x) { return x.pp / daysCounted(x.k); };
  if (k) {
    var days = daysCounted(k), avg = T.pp / days, i = months.indexOf(k), prev = i > 0 ? M[i - 1] : null, pa = prev ? avgOf(prev) : 0;
    set("avgSub", k === cur ? "Placed pieces ÷ days passed this month (up to yesterday)" : "Placed pieces ÷ days in the month");
    set("avgVal", fmtInt.format(Math.round(avg))); set("avgPcs", fmtInt.format(Math.round(T.pp))); set("avgDays", fmtInt.format(days));
    set("avgPrev", prev ? fmtInt.format(Math.round(pa)) + " · " + shortMonth(prev.k) : "—");
    set("avgChg", prev && pa ? (avg >= pa ? "+" : "") + fmtPct((avg / pa - 1) * 100) : "—");
  } else {
    var dTot = M.reduce(function (a, x) { return a + daysCounted(x.k); }, 0);
    set("avgSub", "Placed pieces ÷ days, last 12 months"); set("avgVal", fmtInt.format(Math.round(dTot ? M.reduce(function (a, x) { return a + x.pp; }, 0) / dTot : 0)));
    set("avgPcs", fmtInt.format(Math.round(T.pp))); set("avgDays", fmtInt.format(dTot)); set("avgPrev", "—"); set("avgChg", "—");
  }
  var best = M.slice().sort(function (a, b) { return avgOf(b) - avgOf(a); })[0];
  set("avgBest", best ? fmtInt.format(Math.round(avgOf(best))) + " · " + shortMonth(best.k) : "—");
  $("avgSpark").innerHTML = spark(M.map(avgOf), "k-avg", 400, 70);
  renderPipe(M);
}

function renderPipe(M) {
  var pieces = pipeMetric === "pieces", box = $("pipeChart");
  $("pipeSub").textContent = (pieces ? "Confirmed Pieces" : "Confirmed Orders") + " (bars) vs " + (pieces ? "Placed Pieces" : "Placed Orders") + " (line) per month";
  if (!M.length) { box.innerHTML = '<div class="empty">No orders yet</div>'; return; }
  var W = Math.max(300, box.clientWidth || 760), H = 270, L = 50, R = 10, Tp = 10, B = 28, iw = W - L - R, ih = H - Tp - B;
  var cv = M.map(function (x) { return pieces ? x.cp : x.co; }), pv = M.map(function (x) { return pieces ? x.pp : x.po; });
  var max = niceMax(Math.max.apply(null, cv.concat(pv))), n = M.length, step = iw / n, bw = Math.max(4, Math.min(40, step * 0.55));
  var y = function (v) { return Tp + ih - (v / max) * ih; }, s = "";
  for (var g = 0; g <= 4; g++) { var gv = max * g / 4, gy = y(gv); s += '<line class="grid-l" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/><text class="ax" x="' + (L - 6) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + fmtInt.format(Math.round(gv)) + "</text>"; }
  var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));
  M.forEach(function (x, i) {
    var cx = L + step * i + step / 2;
    s += '<rect class="bar-c" x="' + (cx - bw / 2) + '" y="' + y(cv[i]) + '" width="' + bw + '" height="' + Math.max(0, Tp + ih - y(cv[i])) + '" rx="3"/>';
    if (i % every === 0 || i === n - 1) s += '<text class="ax" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + shortMonth(x.k) + "</text>";
  });
  if (n > 1) s += '<path class="line-p" d="' + pv.map(function (v, i) { return (i ? "L" : "M") + (L + step * i + step / 2).toFixed(1) + " " + y(v).toFixed(1); }).join("") + '"/>';
  pv.forEach(function (v, i) { s += '<circle class="dot-p" cx="' + (L + step * i + step / 2) + '" cy="' + y(v) + '" r="3"/>'; });
  M.forEach(function (x, i) { s += '<rect class="hov" data-i="' + i + '" x="' + (L + step * i) + '" y="' + Tp + '" width="' + step + '" height="' + ih + '"/>'; });
  box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' + s + '</svg><div class="legend"><span><i class="lc"></i>' + (pieces ? "Confirmed Pieces" : "Confirmed Orders") + '</span><span><i class="lp"></i>' + (pieces ? "Placed Pieces" : "Placed Orders") + "</span></div>";
  box.querySelectorAll(".hov").forEach(function (r) {
    r.addEventListener("mousemove", function (e) { var i = +r.getAttribute("data-i"); tip(e, monthTitle(M[i].k), [[pieces ? "Placed Pieces" : "Placed Orders", pv[i]], [pieces ? "Confirmed Pieces" : "Confirmed Orders", cv[i]], ["Delivered GMV (EGP)", M[i].gmv]]); });
    r.addEventListener("mouseleave", hideTip);
  });
}
function tip(e, title, lines) {
  var t = $("tip"); t.innerHTML = "<b>" + esc(title) + "</b>" + lines.map(function (l) { return esc(l[0]) + ": " + fmtInt.format(Math.round(l[1])); }).join("<br>");
  t.classList.remove("hidden");
  var x = e.clientX + 14, yy = e.clientY + 14; if (x + t.offsetWidth > innerWidth - 8) x = e.clientX - t.offsetWidth - 14;
  t.style.left = x + "px"; t.style.top = yy + "px";
}
function hideTip() { $("tip").classList.add("hidden"); }

// ---- wiring
$("loginForm").addEventListener("submit", function (e) {
  e.preventDefault(); msg("lMsg", "Signing in…");
  api("/api/login", { body: { email: $("lEmail").value, password: $("lPass").value } })
    .then(function () { $("lPass").value = ""; msg("lMsg", ""); return api("/api/me").then(enter); })
    .catch(function (er) { msg("lMsg", er.message, "err"); });
});
$("toForgot").addEventListener("click", function () { $("fEmail").value = $("lEmail").value; authForm("forgotForm"); });
$("backLogin").addEventListener("click", function () { authForm("loginForm"); });
$("forgotForm").addEventListener("submit", function (e) {
  e.preventDefault(); msg("fMsg", "Sending…");
  api("/api/password/forgot", { body: { email: $("fEmail").value } })
    .then(function () { msg("fMsg", "If that email has an account, a link is on its way.", "ok"); })
    .catch(function (er) { msg("fMsg", er.message, "err"); });
});
$("setForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if ($("sPass").value !== $("sPass2").value) { msg("sMsg", "The two passwords are different.", "err"); return; }
  msg("sMsg", "Saving…");
  api("/api/password/set", { body: { token: linkToken(), password: $("sPass").value } })
    .then(function () { history.replaceState(null, "", "/"); return api("/api/me").then(enter); })
    .catch(function (er) { msg("sMsg", er.message, "err"); });
});
$("monthSel").addEventListener("change", render);
var rsT = 0; window.addEventListener("resize", function () { clearTimeout(rsT); rsT = setTimeout(function () { if (!$("app").classList.contains("hidden") && D.rows) render(); }, 150); });
$("pipeToggle").addEventListener("click", function (e) {
  var b = e.target.closest("button"); if (!b) return;
  pipeMetric = b.getAttribute("data-m");
  this.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
  render();
});
$("menuBtn").addEventListener("click", function (e) { e.stopPropagation(); $("menuList").classList.toggle("hidden"); });
document.addEventListener("click", function () { $("menuList").classList.add("hidden"); });
$("outBtn").addEventListener("click", function () { api("/api/logout", { body: {} }).finally(function () { location.replace("/"); }); });
$("chgBtn").addEventListener("click", function () { ["cCur", "cNew", "cNew2"].forEach(function (i) { $(i).value = ""; }); msg("cMsg", ""); $("chgModal").classList.remove("hidden"); $("cCur").focus(); });
$("chgCancel").addEventListener("click", function () { $("chgModal").classList.add("hidden"); });
$("chgForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if ($("cNew").value !== $("cNew2").value) { msg("cMsg", "The two new passwords are different.", "err"); return; }
  msg("cMsg", "Saving…");
  api("/api/password/change", { body: { current: $("cCur").value, next: $("cNew").value } })
    .then(function () { msg("cMsg", "Password changed ✓", "ok"); setTimeout(function () { $("chgModal").classList.add("hidden"); }, 900); })
    .catch(function (er) { msg("cMsg", er.message, "err"); });
});
document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("app").classList.contains("hidden")) loadData(); });
start();
`;

// ---------------------------------------------------------------------------------------- admin page
export const ADMIN_JS = SHARED_JS + `
var KEY = ""; try { KEY = sessionStorage.getItem("mpAdminKey") || ""; } catch (e) {}
var ACC = [];
function adm(path, body, method) { return api(path, { admin: KEY, body: body, method: method }); }
function openAdmin() {
  msg("keyMsg", "Checking…");
  adm("/api/admin/check").then(function (j) {
    try { sessionStorage.setItem("mpAdminKey", KEY); } catch (e) {}
    msg("keyMsg", "");
    $("keyCard").classList.add("hidden"); $("adm").classList.remove("hidden");
    $("aMail").checked = !!j.emailEnabled; $("aMail").disabled = !j.emailEnabled;
    loadStatus(); loadAccounts();
  }).catch(function (e) { msg("keyMsg", e.message, "err"); try { sessionStorage.removeItem("mpAdminKey"); } catch (er) {} });
}
$("keyGo").addEventListener("click", function () { KEY = $("key").value.trim(); openAdmin(); });
$("key").addEventListener("keydown", function (e) { if (e.key === "Enter") { KEY = $("key").value.trim(); openAdmin(); } });
if (KEY) openAdmin();

function kv(label, value, bad) { return '<div' + (bad ? ' class="bad"' : "") + '><span>' + esc(label) + "</span><b>" + esc(value) + "</b></div>"; }
function loadStatus() {
  adm("/api/admin/status").then(function (s) {
    var m = s.meta || {};
    $("dataBox").innerHTML = kv("Source", s.source, s.source === "not configured") + kv("Last build", m.builtAt ? new Date(m.builtAt).toLocaleString() : "never", !m.builtAt) +
      kv("Latest month in data", m.latestMonth || "—") + kv("Merchants", m.merchants != null ? m.merchants : "—") + kv("Rows kept", m.rows != null ? m.rows : "—") +
      kv("Build time", m.ms ? Math.round(m.ms / 1000) + " s" : "—") + (s.refreshing ? kv("Status", "Refreshing now…") : "") +
      (s.lastError ? kv("Last error · " + new Date(s.lastError.at).toLocaleString(), s.lastError.message, true) : "");
    var hdr = m.header || [];
    $("colBox").innerHTML = '<p class="dim">Each field must sit on the column whose header matches it. If one is wrong, set the QUERY_COLUMNS variable.</p><div class="table-wrap"><table class="tbl"><thead><tr><th>Field</th><th>Column #</th><th>Header in the export</th></tr></thead><tbody>' +
      Object.keys(s.columns).map(function (k) { return "<tr><td>" + esc(k) + "</td><td>" + s.columns[k] + "</td><td>" + (hdr.length ? esc(hdr[s.columns[k]] || "— missing —") : "build first") + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }).catch(function (e) { $("dataBox").innerHTML = kv("Error", e.message, true); });
}
$("refreshBtn").addEventListener("click", function () {
  var b = this; b.disabled = true;
  adm("/api/admin/refresh", {}).then(function () { setTimeout(loadStatus, 1500); }).catch(function (e) { alert(e.message); }).finally(function () { setTimeout(function () { b.disabled = false; loadStatus(); }, 8000); });
});

function loadAccounts() { adm("/api/admin/accounts").then(function (j) { ACC = j.accounts || []; drawAccounts(); }).catch(function (e) { msg("accMsg", e.message, "err"); }); }
function drawAccounts() {
  var q = $("q").value.trim().toLowerCase();
  var list = ACC.filter(function (a) { return !q || (a.email + " " + a.name + " " + a.merchantIds.join(" ")).toLowerCase().indexOf(q) >= 0; });
  $("accBody").innerHTML = list.map(function (a) {
    var e = esc(a.email);
    return "<tr><td>" + e + "</td><td>" + esc(a.name || "—") + "</td><td>" + esc(a.merchantIds.join(", ")) + '</td><td><span class="pill ' + a.status + '">' + a.status + "</span></td><td>" + (a.lastLoginAt ? esc(new Date(a.lastLoginAt).toLocaleString()) : "—") + '</td>' +
      '<td class="acts"><button class="btn small" data-link="' + e + '">New password link</button>' +
      (a.status === "disabled" ? '<button class="btn small" data-on="' + e + '">Enable</button>' : '<button class="btn small" data-off="' + e + '">Disable</button>') +
      '<button class="btn small danger" data-del="' + e + '">Delete</button></td></tr>';
  }).join("") || '<tr><td colspan="6" class="dim">No accounts yet.</td></tr>';
}
$("q").addEventListener("input", drawAccounts);
function showLinks(items) {
  var box = $("linkBox"), withLinks = items.filter(function (x) { return x.link; });
  if (!withLinks.length) { box.classList.add("hidden"); return; }
  box.innerHTML = '<b>Password links (valid 72 hours)</b>' + withLinks.map(function (x) {
    return "<div><span>" + esc(x.email) + "</span><code>" + esc(x.link) + '</code><button class="btn small" type="button" data-copy="' + esc(x.link) + '">Copy</button>' + (x.mailed ? '<span class="ok-t">emailed ✓</span>' : '<span class="dim">send it yourself</span>') + "</div>";
  }).join("");
  box.classList.remove("hidden");
}
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("button"); if (!b) return;
  var mail = $("aMail").checked;
  if (b.dataset.copy) { navigator.clipboard.writeText(b.dataset.copy).then(function () { b.textContent = "Copied ✓"; }); return; }
  if (b.dataset.link) adm("/api/admin/accounts/link", { email: b.dataset.link, email_link: mail }).then(function (j) { showLinks([{ email: b.dataset.link, link: j.link, mailed: j.mailed }]); loadAccounts(); }).catch(function (er) { msg("accMsg", er.message, "err"); });
  if (b.dataset.off) adm("/api/admin/accounts/status", { email: b.dataset.off, status: "disabled" }).then(loadAccounts).catch(function (er) { msg("accMsg", er.message, "err"); });
  if (b.dataset.on) adm("/api/admin/accounts/status", { email: b.dataset.on, status: "active" }).then(loadAccounts).catch(function (er) { msg("accMsg", er.message, "err"); });
  if (b.dataset.del && confirm("Delete the account " + b.dataset.del + "?")) adm("/api/admin/accounts/delete", { email: b.dataset.del }).then(loadAccounts).catch(function (er) { msg("accMsg", er.message, "err"); });
});
$("addForm").addEventListener("submit", function (e) {
  e.preventDefault(); msg("accMsg", "Saving…");
  adm("/api/admin/accounts", { email: $("aEmail").value, name: $("aName").value, merchantIds: $("aIds").value, email_link: $("aMail").checked })
    .then(function (j) { msg("accMsg", "Saved ✓", "ok"); showLinks([{ email: j.account.email, link: j.link, mailed: j.mailed }]); $("aEmail").value = $("aName").value = $("aIds").value = ""; loadAccounts(); })
    .catch(function (er) { msg("accMsg", er.message, "err"); });
});
$("importBtn").addEventListener("click", function () {
  if (!confirm("Create portal accounts for every Merchant user set up in the staff dashboard (Users & Roles)?")) return;
  msg("accMsg", "Importing…");
  adm("/api/admin/import-dashboard", { email_link: $("aMail").checked }).then(function (j) {
    var c = j.results.filter(function (x) { return x.created; }).length, u = j.results.filter(function (x) { return x.updated; }).length, s = j.results.filter(function (x) { return x.skipped; }).length;
    msg("accMsg", "Created " + c + ", updated " + u + (s ? ", skipped " + s + " without a Merchant ID" : "") + ".", "ok");
    showLinks(j.results); loadAccounts();
  }).catch(function (er) { msg("accMsg", er.message, "err"); });
});
`;
