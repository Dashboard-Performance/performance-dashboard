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

/* merchant targets table (same look as the staff dashboard's Merchant Targets view) */
.table-card{padding:0;overflow:hidden}
.table-card .card-h{padding:18px 18px 0}
.table-card .ttl{border-left:3px solid var(--blue);padding-left:12px}
.table-controls input{width:260px;max-width:100%}
.table-card .table-wrap{border:0;border-radius:0;border-top:1px solid var(--line);margin-top:6px}
.data{min-width:1500px}
.data th{white-space:nowrap;cursor:pointer;user-select:none}
.data th.sorted{color:var(--accent)}
.data td.num,.data th.num{text-align:right}
.data td{white-space:nowrap}
.data td.nm{font-weight:700;color:var(--text);white-space:normal;min-width:160px}
.data .mono{font-family:ui-monospace,"JetBrains Mono",Consolas,monospace;color:var(--dim)}
.data .b{font-weight:700}
.c-blue{color:var(--blue)} .c-green{color:var(--green)} .c-red{color:var(--red)} .c-orange{color:var(--orange)}
.pv{font-weight:600;font-size:11px}
.pbar{height:4px;border-radius:99px;background:var(--line2);margin-top:4px;min-width:64px;overflow:hidden}
.pfill{height:100%;border-radius:99px}
.f-green{background:var(--green)} .f-red{background:var(--red)} .f-orange{background:var(--orange)} .f-blue{background:var(--blue)}
.table-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--dim);flex-wrap:wrap}
.pager{display:flex;align-items:center;gap:10px}
.emptyrow td{text-align:center;color:var(--dim);padding:28px 12px;white-space:normal}
.w0{width:0%}.w1{width:1%}.w2{width:2%}.w3{width:3%}.w4{width:4%}.w5{width:5%}.w6{width:6%}.w7{width:7%}.w8{width:8%}.w9{width:9%}.w10{width:10%}.w11{width:11%}.w12{width:12%}.w13{width:13%}.w14{width:14%}.w15{width:15%}.w16{width:16%}.w17{width:17%}.w18{width:18%}.w19{width:19%}.w20{width:20%}.w21{width:21%}.w22{width:22%}.w23{width:23%}.w24{width:24%}.w25{width:25%}.w26{width:26%}.w27{width:27%}.w28{width:28%}.w29{width:29%}.w30{width:30%}.w31{width:31%}.w32{width:32%}.w33{width:33%}.w34{width:34%}.w35{width:35%}.w36{width:36%}.w37{width:37%}.w38{width:38%}.w39{width:39%}.w40{width:40%}.w41{width:41%}.w42{width:42%}.w43{width:43%}.w44{width:44%}.w45{width:45%}.w46{width:46%}.w47{width:47%}.w48{width:48%}.w49{width:49%}.w50{width:50%}.w51{width:51%}.w52{width:52%}.w53{width:53%}.w54{width:54%}.w55{width:55%}.w56{width:56%}.w57{width:57%}.w58{width:58%}.w59{width:59%}.w60{width:60%}.w61{width:61%}.w62{width:62%}.w63{width:63%}.w64{width:64%}.w65{width:65%}.w66{width:66%}.w67{width:67%}.w68{width:68%}.w69{width:69%}.w70{width:70%}.w71{width:71%}.w72{width:72%}.w73{width:73%}.w74{width:74%}.w75{width:75%}.w76{width:76%}.w77{width:77%}.w78{width:78%}.w79{width:79%}.w80{width:80%}.w81{width:81%}.w82{width:82%}.w83{width:83%}.w84{width:84%}.w85{width:85%}.w86{width:86%}.w87{width:87%}.w88{width:88%}.w89{width:89%}.w90{width:90%}.w91{width:91%}.w92{width:92%}.w93{width:93%}.w94{width:94%}.w95{width:95%}.w96{width:96%}.w97{width:97%}.w98{width:98%}.w99{width:99%}.w100{width:100%}
`;

// ---------------------------------------------------------------------------------------- shared helpers
export const SHARED_JS = `
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
// Sign-in / password pages. Once signed in, the merchant lands on /dashboard (the staff dashboard's design, see dash.js).
var cfg = { emailEnabled: false };
function show(id) { ["boot", "auth"].forEach(function (x) { $(x).classList.toggle("hidden", x !== id); }); }
function authForm(id) { ["loginForm", "forgotForm", "setForm"].forEach(function (x) { $(x).classList.toggle("hidden", x !== id); }); show("auth"); var f = $(id).querySelector("input"); if (f) f.focus(); }
function linkToken() { var m = /[#&]t=([A-Za-z0-9_-]{20,100})/.exec(location.hash || ""); return m ? m[1] : ""; }
function enter() { location.replace("/dashboard"); }
function start() {
  api("/api/config").then(function (c) { cfg = c; $("toForgot").classList.toggle("hidden", !c.emailEnabled); }).catch(function () {});
  if (location.pathname === "/set-password" && linkToken()) { authForm("setForm"); return; }
  api("/api/me").then(enter).catch(function () { authForm("loginForm"); });
}
$("loginForm").addEventListener("submit", function (e) {
  e.preventDefault(); msg("lMsg", "Signing in…");
  api("/api/login", { body: { email: $("lEmail").value, password: $("lPass").value } })
    .then(function () { $("lPass").value = ""; msg("lMsg", ""); enter(); })
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
    .then(function () { history.replaceState(null, "", "/"); enter(); })
    .catch(function (er) { msg("sMsg", er.message, "err"); });
});
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
      kv("Daily source", s.daily || "—", s.daily === "not configured") + kv("Latest month in data", m.latestMonth || "—") + kv("Merchants", m.merchants != null ? m.merchants : "—") + kv("Rows kept", m.rows != null ? m.rows : "—") +
      kv("Build time", m.ms ? Math.round(m.ms / 1000) + " s" : "—") + (s.refreshing ? kv("Status", "Refreshing now…") : "") +
      kv("Sales Plan", s.salesPlan ? "built " + new Date(s.salesPlan.builtAt).toLocaleString() + " · " + s.salesPlan.planRows + " plan rows" : "not built yet", !s.salesPlan) +
      kv("Incentives", s.incentives ? "built " + new Date(s.incentives.builtAt).toLocaleString() + " · " + s.incentives.merchants + " merchant(s) on an incentive plan" : "not built yet", !s.incentives) +
      kv("Inventory", s.inventory ? "built " + new Date(s.inventory.builtAt).toLocaleString() + " · " + s.inventory.rows + " SKU rows" : "not built yet", !s.inventory) +
      (s.lastError ? kv("Last error · " + new Date(s.lastError.at).toLocaleString(), s.lastError.message, true) : "");
    var hdr = m.header || [];
    $("colBox").innerHTML = '<p class="dim">Each field must sit on the column whose header matches it. If one is wrong, set the QUERY_COLUMNS variable.</p><div class="table-wrap"><table class="tbl"><thead><tr><th>Field</th><th>Column #</th><th>Header in the export</th></tr></thead><tbody>' +
      Object.keys(s.columns).map(function (k) { return "<tr><td>" + esc(k) + "</td><td>" + s.columns[k] + "</td><td>" + (hdr.length ? esc(hdr[s.columns[k]] || "— missing —") : "build first") + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }).catch(function (e) { $("dataBox").innerHTML = kv("Error", e.message, true); });
}
var PARTS = [["daily", "Daily numbers"], ["salesplan", "Sales Plan"], ["incentives", "Incentives"], ["inventory", "Inventory"], ["notifications", "Notifications (Command Loop)"]];
$("refreshBtn").addEventListener("click", function () {
  var b = this, label = b.textContent; b.disabled = true; b.textContent = "Refreshing: main data…";
  var fails = [];
  adm("/api/admin/refresh", { light: true }).then(function () { return new Promise(function (r) { setTimeout(r, 6000); }); }).then(function () {
    return PARTS.reduce(function (p, part, i) {
      return p.then(function () {
        b.textContent = "Refreshing " + (i + 1) + "/" + PARTS.length + ": " + part[1] + "…";
        return adm("/api/admin/refresh", { part: part[0] }).then(function (r) { if (r && r.ok === false) fails.push(part[1] + ": " + r.error); }).catch(function (e) { fails.push(part[1] + ": " + e.message); });
      });
    }, Promise.resolve());
  }).catch(function (e) { fails.push(e.message); }).then(function () {
    b.disabled = false; b.textContent = label; loadStatus();
    if (fails.length) alert("Some parts failed: " + fails.join(" | ")); 
  });
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
