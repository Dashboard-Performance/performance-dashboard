/* ==========================================================================
   Performance Dashboard — Login / Sign Up Gate
   --------------------------------------------------------------------------
   This file is fully self-contained: it injects its own CSS and its own
   HTML overlay at runtime, so nothing in index.html / style.css / app.js
   had to be touched except ONE line (the <script src="js/auth.js"> tag).

   HOW IT WORKS
   1) The moment this script runs (it is the first thing in <body>), it
      injects a CSS rule that hides every other element in <body> and shows
      only the auth overlay — so the dashboard never "flashes" before login.
   2) If a valid session is already saved in localStorage, the gate is
      skipped instantly and the dashboard is shown as normal.
   3) Sign up only accepts emails ending with "@taager.com".
   4) Login / Sign up both talk to a Google Apps Script Web App that reads
      and writes the "Users" sheet (see CONFIG.API_URL below + backend/Code.gs).
   5) On successful login/signup, the session (name, email, role) is saved
      to localStorage so the user is NOT asked to log in again on this
      device/browser until they press "Logout".
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  CONFIG — edit these two values only
   * ------------------------------------------------------------------ */
  const CONFIG = {
    // Paste the "Web app URL" you get after deploying backend/Code.gs
    // (Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone)
    API_URL: "https://script.google.com/macros/s/AKfycbwJw0dlXgmSt9E04YYcMzvLln0M1NQpraPvuFcxDiE5VnHLR4HWfMJAlMsJzmO1deDaGg/exec",

    // Only emails ending with this domain are allowed to sign up
    ALLOWED_DOMAIN: "taager.com",

    // Roles offered in the Sign Up form — edit freely
    // v1.15.49: "Admin" اتشال من التسجيل — أي حد كان يقدر يسجل نفسه Admin ويشوف كل حاجة
    // v1.16.0: الميرشنتس اتنقلوا لبورتال منفصل (merchant-portal/) — الداشبورد ده للموظفين بس
    ROLES: ["Account Manager", "Commercial", "Marketplace"],

    // localStorage key used to keep the user logged in
    STORAGE_KEY: "taagerDashboardSession",

    // Only this account ever sees the "who's online" widget. Everyone else's
    // client still sends heartbeats (so the count stays accurate), but the
    // panel itself is never built for them, and the backend refuses to hand
    // the list back to any other email regardless.
    PRESENCE_ADMIN_EMAIL: "youssef.hanafy@taager.com",
    OWNER_EMAILS: ["youssef.hanafy@taager.com", "somaya.youssef@taager.com"],
    // v1.1.40: heartbeat/getOnlineUsers نقلوا بالكامل للـ Cloudflare Worker
    // (مش Apps Script) — بيانات "مين أونلاين" مؤقتة بطبيعتها ومحتاجاش تتخزن
    // في شيت جوجل، فده أخف على السيرفرين. نفس رابط SYNC_CDN_URL في js/app.js
    // بالظبط (الملف ده مستقل عن app.js فمكرّرينه هنا).
    WORKER_URL: "https://performance-dashboard-sync-cache.youssef-hanafy.workers.dev",
    // v1.1.1: من 30 ثانية لـ 45 — بيقلل عدد الطلبات الخلفية (heartbeat +
    // presence) اللي بتضرب نفس الـ Apps Script deployment بمقدار الثلث تقريبًا،
    // من غير ما يأثر على دقة عداد "Online" بشكل محسوس عمليًا.
    // v1.1.32: من 20 ثانية لـ 30 — بيقلل عدد الطلبات المتزامنة على نفس
    // الـ deployment أكتر (راجع startPresence/buildPresenceWidget تحت كمان
    // — دلوقتي مفصولين عن بعض بفاصل زمني عشان ميضربوش الباك اند في نفس
    // اللحظة بالظبط).
    // v1.1.51: من 30 ثانية لـ 60 — كل heartbeat بيكتب على Cloudflare Workers
    // KV، واللي مسموح بيه على الخطة المجانية 1000 كتابة/يوم بس لكل الحسابات
    // مجتمعة. بـ 30 ثانية، شخص واحد فاتح الموقع لساعتين كان لوحده بياخد
    // ~240 كتابة. تقليل الفاصل لـ 60 ثانية بيوفر نص الاستهلاك من غير ما يأثر
    // فعليًا على دقة "مين أونلاين" — لسه أصغر بكتير من نافذة اعتبار المستخدم
    // "أونلاين" في الباك اند (PRESENCE_ONLINE_WINDOW_MS = 90 ثانية في
    // cloudflare-worker/worker.js)، فمفيش خطر إن حد يظهر "أوفلاين" غلط بين
    // نبضتين.
    HEARTBEAT_INTERVAL_MS: 60000,
  };

  /* ------------------------------------------------------------------ *
   *  0) Immediately hide the dashboard until we know the auth state
   * ------------------------------------------------------------------ */
  const existingSession = readSession();
  // v1.17.0 — the link in the "reset your password" email opens the dashboard with #reset=<token>
  const RESET_TOKEN = (function () { const m = /[#&]reset=([0-9a-f]{64})/.exec(location.hash || ""); return m ? m[1] : ""; })();

  const gateStyle = document.createElement("style");
  gateStyle.id = "authGateStyle";
  if (!existingSession || RESET_TOKEN) {
    gateStyle.textContent = `body > *:not(#authOverlay){display:none !important;}`;
  }
  document.head.appendChild(gateStyle);

  injectAuthStyles();

  if (!existingSession || RESET_TOKEN) {
    buildOverlay();
  } else {
    // Already logged in on this device — just wire up the logout control
    // once the rest of the dashboard has loaded.
    onDomReady(() => {
      injectUserBadge(existingSession);
      startPresence(existingSession);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */
  function onDomReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.email && parsed.name) return parsed;
      return null;
    } catch (err) {
      return null;
    }
  }

  // v1.16.0 — staff sign-in through the Worker + the token on every Worker call
  function staffLogin(email, password) {
    return fetch(CONFIG.WORKER_URL + "?action=staffLogin", { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ email: email, password: password }) })
      .then((r) => r.json().catch(() => ({ success: false, message: "Server error " + r.status })));
  }
  (function wrapFetch() {
    const orig = window.fetch;
    if (!orig || orig.__twStaff) return;
    const wrapped = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const toWorker = CONFIG.WORKER_URL && url.indexOf(CONFIG.WORKER_URL) === 0 && url.indexOf("action=staffLogin") < 0;
      const s = toWorker ? readSession() : null;
      if (s && s.token) {
        init = Object.assign({}, init || {});
        const h = new Headers(init.headers || (typeof input !== "string" && input.headers) || undefined);
        if (!h.has("X-Staff-Token")) h.set("X-Staff-Token", s.token);
        init.headers = h;
      }
      return orig.call(this, input, init).then((res) => {
        if (toWorker && res.status === 401 && s) {
          res.clone().json().then((j) => { if (j && j.code === "staff_auth") { clearSession(); location.reload(); } }).catch(() => {});
        }
        return res;
      });
    };
    wrapped.__twStaff = true;
    window.fetch = wrapped;
  })();

  function saveSession(user) {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
  }

  // بطلب صريح: مفيش أي timeout هنا زمان — لو نفس الـ Apps Script deployment
  // (اللي بيستقبل كمان المزامنة المركزية/الـ backup/نشر الـ Computed API/
  // heartbeats) كان مزنوق ومتأخر في الرد، طلب اللوجن كان بيفضل معلق "للأبد"
  // من غير أي رسالة خطأ — وبما إن الصفحة كلها مخفية لحد ما اللوجن ينجح، ده
  // كان بيبان زي إن الشاشة كلها "اتجمدت". الـ 25 ثانية دي كافية جدًا لطلب
  // لوجن عادي (حتى لو السيرفر مزحوم شوية)، وبترجع رسالة واضحة بدل ما تفضل
  // مستنية من غير نهاية.
  const AUTH_API_TIMEOUT_MS = 25000;
  // Login attempt budget: shorter than the general timeout so a stalled call is retried instead of hanging.
  const LOGIN_ATTEMPT_MS = 12000;

  // v1.1.1: ⚠️ ردود أي Apps Script Web App (كبيرة أو صغيرة — حتى heartbeat
  // الصغيرة دي) بتتوصّل فعليًا عن طريق تحويل داخلي لمسار
  // script.googleusercontent.com/macros/echo. لو التنفيذ ورا الرابط ده اتأخر
  // بسبب زحمة تنفيذات متزامنة على نفس الـ deployment (heartbeat + presence +
  // sync + backup + login كلهم بيشاركوا نفس الرابط)، بيرجع 404 (صفحة HTML)
  // بدل الرد الحقيقي، فـ res.json() بيرمي SyntaxError. ده فشل عابر بحت من
  // عند جوجل، مش خطأ في بياناتنا — بنتعامل معاه بمحاولة تانية سريعة (retry)
  // تلقائية في callApi() تحت، بدل ما نسيب heartbeat/presence "يفوتوا" بلاش.
  function callApiOnce(payload, timeoutMs) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf("PASTE_YOUR") === 0) {
      return Promise.reject(
        new Error("Auth backend is not configured yet. Set CONFIG.API_URL in js/auth.js")
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || AUTH_API_TIMEOUT_MS);
    return fetch(CONFIG.API_URL, {
      method: "POST",
      // text/plain avoids a CORS pre-flight request against Apps Script
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(
        (res) => res.json().catch((parseErr) => {
          throw new Error("TRANSIENT_NON_JSON_RESPONSE: " + (parseErr && parseErr.message));
        }),
        (fetchErr) => {
          if (fetchErr && fetchErr.name === "AbortError") {
            throw new Error("Server is busy right now — please try again in a moment.");
          }
          throw new Error("Could not reach the server. Please check your connection.");
        }
      )
      .finally(() => clearTimeout(timer));
  }

  function callApi(payload, attempt, timeoutMs) {
    attempt = attempt || 1;
    return callApiOnce(payload, timeoutMs).catch((err) => {
      const msg = (err && err.message) || "";
      const isTransient = msg.indexOf("TRANSIENT_NON_JSON_RESPONSE") === 0;
      if (isTransient && attempt < 3) {
        // محاولتين إضافيتين (بدل واحدة) بفاصل بسيط — بما إن الـ Cloudflare
        // Worker بقى بياخد طلبات القراءة الكبيرة عن Apps Script، فمفيش خوف
        // من إن المحاولة الإضافية دي تزود الزحمة، وبتقلل احتمال ظهور فشل
        // ظاهر لليوزر أكتر.
        return new Promise((resolve) => setTimeout(resolve, 800 * attempt)).then(() => callApi(payload, attempt + 1, timeoutMs));
      }
      if (isTransient) {
        throw new Error("Server is busy right now — please try again in a moment.");
      }
      throw err;
    });
  }

  /* ------------------------------------------------------------------ *
   *  1) Styles for the overlay (scoped under #authOverlay)
   * ------------------------------------------------------------------ */
  function injectAuthStyles() {
    const css = `
    #authOverlay{position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);
      background:radial-gradient(900px 520px at 12% -8%,color-mix(in srgb,var(--accent,#2dd4a8) 16%,transparent),transparent 70%),
                 radial-gradient(700px 480px at 100% 110%,color-mix(in srgb,var(--purple,#a78bfa) 12%,transparent),transparent 70%),
                 var(--bg,#04070b);
      color:var(--text,#f6f8fb);font-family:"Inter",-apple-system,sans-serif;overflow-y:auto;}
    #authOverlay *{box-sizing:border-box;}
    .auth-hero{display:flex;flex-direction:column;justify-content:center;gap:34px;padding:56px clamp(32px,6vw,96px);}
    .auth-logo{display:flex;align-items:center;gap:12px;font-size:17px;font-weight:700;letter-spacing:-.01em;}
    .auth-mark{width:40px;height:40px;border-radius:13px;display:grid;place-items:center;font-weight:800;font-size:18px;
      color:var(--accent-ink,#04251d);background:linear-gradient(145deg,var(--accent,#2dd4a8),var(--purple,#a78bfa));
      box-shadow:0 8px 24px -8px color-mix(in srgb,var(--accent,#2dd4a8) 60%,transparent);}
    .auth-hero h1{margin:0;font-size:clamp(28px,3.2vw,42px);line-height:1.12;letter-spacing:-.025em;font-weight:700;max-width:14em;}
    .auth-hero h1 span{color:var(--accent,#2dd4a8);}
    .auth-hero p{margin:0;max-width:30em;font-size:15px;line-height:1.6;color:var(--text2,#aab6c6);}
    .auth-points{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none;}
    .auth-points li{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--text2,#aab6c6);}
    .auth-points li::before{content:"";width:8px;height:8px;border-radius:50%;flex:none;background:var(--accent,#2dd4a8);
      box-shadow:0 0 0 4px color-mix(in srgb,var(--accent,#2dd4a8) 18%,transparent);}
    .auth-side{display:flex;align-items:center;justify-content:center;padding:32px 24px;}
    .auth-card{width:100%;max-width:420px;background:var(--panel,#0b111a);border:1px solid var(--line,#17212e);border-radius:20px;
      padding:34px 32px 28px;box-shadow:0 30px 80px -30px rgba(0,0,0,.55);animation:authIn .45s cubic-bezier(.2,.7,.2,1) both;}
    @keyframes authIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
    .auth-minibrand{display:none;align-items:center;gap:10px;font-weight:700;font-size:15px;margin-bottom:22px;}
    .auth-minibrand .auth-mark{width:34px;height:34px;border-radius:11px;font-size:15px;}
    .auth-title{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em;}
    .auth-sub{margin:6px 0 22px;font-size:13px;color:var(--text-dim,#74839a);line-height:1.5;}
    .auth-tabs{display:flex;background:var(--panel2,#0f1722);border:1px solid var(--line,#17212e);border-radius:12px;padding:4px;margin-bottom:22px;}
    .auth-tab{flex:1;background:transparent;border:none;padding:9px 0;font-size:13px;font-weight:600;color:var(--text-dim,#74839a);
      border-radius:9px;cursor:pointer;transition:background .18s,color .18s;font-family:inherit;}
    .auth-tab:hover{color:var(--text,#f6f8fb);}
    .auth-tab.active{background:var(--panel3,#141e2c);color:var(--text,#f6f8fb);box-shadow:0 1px 3px rgba(0,0,0,.25);}
    .auth-form{display:none;flex-direction:column;gap:6px;}
    .auth-link{background:none;border:0;padding:6px 0 0;margin-top:6px;color:var(--accent,#2dd4a8);font:inherit;font-size:13px;font-weight:600;cursor:pointer;align-self:center;}
    .auth-link:hover{text-decoration:underline;}
    .auth-ok{font-size:13px;color:var(--green,#34d399);line-height:1.5;min-height:0;}
    .auth-ok:empty{display:none;}
    .auth-steps{list-style:none;margin:10px 0 2px;padding:0;display:flex;flex-direction:column;gap:6px;}
    .auth-steps:empty{display:none;}
    .auth-step{display:flex;gap:10px;align-items:flex-start;font-size:13px;padding:8px 10px;border:1px solid var(--line-light,#223044);border-radius:10px;background:var(--panel2,#0f1722);}
    .auth-step b{font-weight:600;display:block;color:var(--text,#f6f8fb);}
    .auth-step em{font-style:normal;color:var(--text-dim,#74839a);font-size:12px;}
    .auth-step-ic{width:20px;height:20px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--line-light,#223044);color:var(--text-dim,#74839a);}
    .auth-step.ok .auth-step-ic{background:color-mix(in srgb,var(--green,#34d399) 20%,transparent);color:var(--green,#34d399);}
    .auth-step.fail .auth-step-ic{background:color-mix(in srgb,var(--red,#fb7185) 20%,transparent);color:var(--red,#fb7185);}
    .auth-step.skip{opacity:.55;}
    .auth-step-ic .auth-spin{margin:0;width:12px;height:12px;}
    .auth-tries{font-size:12px;color:var(--text-dim,#74839a);}
    .auth-tries:empty{display:none;}
    .auth-form.active{display:flex;}
    .auth-form label{font-size:12px;font-weight:600;color:var(--text2,#aab6c6);margin-top:12px;}
    .auth-form input,.auth-form select{width:100%;height:44px;padding:0 14px;background:var(--panel2,#0f1722);border:1px solid var(--line-light,#223044);
      border-radius:11px;color:var(--text,#f6f8fb);font-size:14px;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s;}
    .auth-form input::placeholder{color:var(--dim,#4f5d71);}
    .auth-form input:focus,.auth-form select:focus{border-color:var(--accent,#2dd4a8);
      box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#2dd4a8) 20%,transparent);}
    .auth-form select{cursor:pointer;}
    .auth-password-wrap{position:relative;display:flex;align-items:center;}
    .auth-password-wrap input{padding-right:62px;}
    .auth-toggle-pass{position:absolute;right:8px;padding:6px 8px;font-size:12px;color:var(--accent,#2dd4a8);cursor:pointer;font-weight:600;
      user-select:none;border-radius:7px;}
    .auth-toggle-pass:hover{background:color-mix(in srgb,var(--accent,#2dd4a8) 12%,transparent);}
    .auth-error{display:none;margin-top:12px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.45;
      color:var(--red,#fb7185);background:color-mix(in srgb,var(--red,#fb7185) 10%,transparent);
      border:1px solid color-mix(in srgb,var(--red,#fb7185) 28%,transparent);}
    .auth-error:not(:empty){display:block;}
    .auth-hint{min-height:18px;margin-top:10px;font-size:12px;color:var(--text-dim,#74839a);text-align:center;line-height:1.4;}
    .auth-submit{margin-top:6px;height:46px;display:flex;align-items:center;justify-content:center;gap:10px;background:var(--accent,#2dd4a8);
      color:var(--accent-ink,#04251d);border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;
      transition:transform .15s,box-shadow .15s,opacity .15s;font-family:inherit;
      box-shadow:0 10px 24px -12px color-mix(in srgb,var(--accent,#2dd4a8) 70%,transparent);}
    .auth-submit:hover{transform:translateY(-1px);}
    .auth-submit:active{transform:none;}
    .auth-submit:disabled{opacity:.75;cursor:progress;transform:none;}
    .auth-spin{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:authSpin .7s linear infinite;}
    @keyframes authSpin{to{transform:rotate(360deg)}}
    .auth-footnote{text-align:center;margin-top:18px;font-size:12px;color:var(--text-dim,#74839a);}
    @media (max-width:860px){
      #authOverlay{grid-template-columns:1fr;}
      .auth-hero{display:none;}
      .auth-minibrand{display:flex;}
      .auth-card{padding:28px 22px 24px;}
    }
    @media (prefers-reduced-motion:reduce){.auth-card{animation:none}.auth-spin{animation-duration:1.6s}}
    .auth-profile{display:flex;align-items:center;gap:10px;padding-bottom:14px;margin-bottom:14px;
      border-bottom:1px solid #27272a;}
    .auth-avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);
      display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;
      font-family:"Inter",sans-serif;flex-shrink:0;letter-spacing:0;text-transform:uppercase;}
    .auth-profile-info{flex:1;min-width:0;}
    .auth-profile-name{font-size:12px;font-weight:700;color:#fff;font-family:"Inter",sans-serif;
      text-transform:none;letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .auth-profile-role{font-size:10px;color:#a1a1aa;font-family:'JetBrains Mono',monospace;
      text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;}
    .auth-logout-icon{background:transparent;border:1px solid #3f3f46;color:#a1a1aa;border-radius:6px;
      width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;
      flex-shrink:0;transition:all .2s;font-size:13px;line-height:1;}
    .auth-logout-icon:hover{border-color:#ef4444;color:#ef4444;background:rgba(239,68,68,0.08);}
    `;
    const styleEl = document.createElement("style");
    styleEl.id = "authOverlayStyles";
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  /* ------------------------------------------------------------------ *
   *  2) Build overlay markup + wire events
   * ------------------------------------------------------------------ */
  function buildOverlay() {
    const roleOptions = CONFIG.ROLES.map((r) => `<option value="${r}">${r}</option>`).join("");

    const overlay = document.createElement("div");
    overlay.id = "authOverlay";
    overlay.innerHTML = `
      <section class="auth-hero" aria-hidden="true">
        <div class="auth-logo"><span class="auth-mark">T</span>Center Control</div>
        <h1>Your team's performance, <span>in one calm place.</span></h1>
        <p>Live numbers across hubs, merchants and SKUs, with access and alerts that reach the right person.</p>
        <ul class="auth-points">
          <li>Live performance across every hub</li>
          <li>Role-based access for each team</li>
          <li>Alerts sent straight to the people who own them</li>
        </ul>
      </section>
      <section class="auth-side">
        <div class="auth-card">
          <div class="auth-minibrand"><span class="auth-mark">T</span>Center Control</div>
          <h2 class="auth-title" id="authTitle">Welcome back</h2>
          <p class="auth-sub" id="authSub">Sign in to open the dashboard.</p>
          <div class="auth-tabs" role="tablist">
            <button type="button" class="auth-tab active" data-tab="login" role="tab">Login</button>
            <button type="button" class="auth-tab" data-tab="signup" role="tab">Sign Up</button>
          </div>

          <form id="authLoginForm" class="auth-form active" autocomplete="on">
            <label for="authLoginEmail">Email</label>
            <input type="email" id="authLoginEmail" placeholder="name@${CONFIG.ALLOWED_DOMAIN}" autocomplete="username" required />
            <label for="authLoginPassword">Password</label>
            <div class="auth-password-wrap">
              <input type="password" id="authLoginPassword" placeholder="Your password" autocomplete="current-password" required />
              <span class="auth-toggle-pass" data-target="authLoginPassword" role="button" tabindex="0">Show</span>
            </div>
            <div class="auth-error" id="authLoginError" role="alert"></div>
            <button type="submit" class="auth-submit" id="authLoginSubmit">Login</button>
            <button type="button" class="auth-link" id="authForgotLink">Forgot your password?</button>
            <div class="auth-ok" id="authLoginOk" role="status"></div>
            <div class="auth-hint" id="authLoginHint"></div>
          </form>

          <form id="authForgotForm" class="auth-form" autocomplete="on">
            <label for="authForgotEmail">Work email</label>
            <input type="email" id="authForgotEmail" placeholder="name@${CONFIG.ALLOWED_DOMAIN}" autocomplete="username" required />
            <ul class="auth-steps" id="authForgotSteps" aria-live="polite"></ul>
            <div class="auth-error" id="authForgotError" role="alert"></div>
            <div class="auth-ok" id="authForgotOk" role="status"></div>
            <div class="auth-tries" id="authForgotTries"></div>
            <button type="submit" class="auth-submit" id="authForgotSubmit">Send reset link</button>
            <button type="button" class="auth-link" data-back="1">Back to sign in</button>
          </form>

          <form id="authResetForm" class="auth-form" autocomplete="off">
            <label for="authResetPassword">New password</label>
            <div class="auth-password-wrap">
              <input type="password" id="authResetPassword" placeholder="At least 8 characters, letters + numbers" autocomplete="new-password" required />
              <span class="auth-toggle-pass" data-target="authResetPassword" role="button" tabindex="0">Show</span>
            </div>
            <label for="authResetConfirm">Repeat the new password</label>
            <input type="password" id="authResetConfirm" placeholder="Repeat the password" autocomplete="new-password" required />
            <div class="auth-error" id="authResetError" role="alert"></div>
            <button type="submit" class="auth-submit" id="authResetSubmit">Save new password</button>
            <button type="button" class="auth-link" data-back="1">Back to sign in</button>
          </form>

          <form id="authSignupForm" class="auth-form" autocomplete="on">
            <label for="authSignupName">Full name</label>
            <input type="text" id="authSignupName" placeholder="e.g. Your name" autocomplete="name" required />
            <label for="authSignupEmail">Email</label>
            <input type="email" id="authSignupEmail" placeholder="name@${CONFIG.ALLOWED_DOMAIN}" autocomplete="username" required />
            <label for="authSignupRole">Role</label>
            <select id="authSignupRole" required>${roleOptions}</select>
            <label for="authSignupPassword">Password</label>
            <div class="auth-password-wrap">
              <input type="password" id="authSignupPassword" placeholder="At least 6 characters" autocomplete="new-password" required />
              <span class="auth-toggle-pass" data-target="authSignupPassword" role="button" tabindex="0">Show</span>
            </div>
            <label for="authSignupPasswordConfirm">Confirm password</label>
            <input type="password" id="authSignupPasswordConfirm" placeholder="Repeat the password" autocomplete="new-password" required />
            <div class="auth-error" id="authSignupError" role="alert"></div>
            <button type="submit" class="auth-submit" id="authSignupSubmit">Create account</button>
            <div class="auth-hint" id="authSignupHint"></div>
          </form>

          <div class="auth-footnote">Access is restricted to @${CONFIG.ALLOWED_DOMAIN} and invited accounts</div>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);

    // Tabs
    overlay.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        overlay.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
        overlay.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
        tab.classList.add("active");
        overlay.querySelector(`#auth${cap(tab.dataset.tab)}Form`).classList.add("active");
        const signup = tab.dataset.tab === "signup";
        overlay.querySelector("#authTitle").textContent = signup ? "Create your account" : "Welcome back";
        overlay.querySelector("#authSub").textContent = signup
          ? "Join with your work email. New accounts are approved by an admin."
          : "Sign in to open the dashboard.";
      });
    });

    // Show/hide password
    overlay.querySelectorAll(".auth-toggle-pass").forEach((btn) => {
      const toggle = () => {
        const input = document.getElementById(btn.dataset.target);
        const isPass = input.type === "password";
        input.type = isPass ? "text" : "password";
        btn.textContent = isPass ? "Hide" : "Show";
      };
      btn.addEventListener("click", toggle);
      btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });

    // Prefill remembered email if present (edge case: cleared session but kept email)
    const rememberedEmail = localStorage.getItem("taagerDashboardLastEmail");
    if (rememberedEmail) {
      document.getElementById("authLoginEmail").value = rememberedEmail;
    }
    // Wake the Apps Script container now, so the first sign-in doesn't pay the cold start.
    try { fetch(CONFIG.API_URL + "?action=ping", { mode: "no-cors", cache: "no-store" }).catch(() => {}); } catch (e) {}
    setTimeout(() => {
      const el = document.getElementById(rememberedEmail ? "authLoginPassword" : "authLoginEmail");
      if (el) el.focus();
    }, 60);

    wireLoginForm(overlay);
    wireSignupForm(overlay);
    wireResetForms(overlay);

    function cap(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }

  // Shows a spinner on the button and, if the server is slow, a calm explanation instead of a frozen screen.
  function startBusy(btn, hintEl, label) {
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spin"></span>' + label;
    hintEl.textContent = "";
    const t = setTimeout(() => {
      hintEl.textContent = "Waking up the server — the first sign-in can take a few seconds.";
    }, 3500);
    return function stop(text) {
      clearTimeout(t);
      hintEl.textContent = "";
      btn.disabled = false;
      btn.textContent = text;
    };
  }

  function finishAuth(res, mode) {
    const user = { name: res.name, email: res.email, role: res.role };
    if (res.token) user.token = res.token; // v1.16.0: staff session signed by the Worker
    saveSession(user);
    // data that loaded before sign-in was refused by the Worker — reload once with the new session
    if (res.token) { localStorage.setItem("taagerDashboardLastEmail", user.email); location.reload(); return; }
    localStorage.setItem("taagerDashboardLastEmail", user.email);
    if (mode === "signup") localStorage.setItem("twWelcomeSignup", user.email);
    unlockDashboard(user);
  }

  // v1.17.0 — Forgot password → email with a one-time link → new password
  function showPanel(overlay, which) {
    overlay.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    overlay.querySelector("#auth" + which + "Form").classList.add("active");
    const tabs = overlay.querySelector(".auth-tabs");
    if (tabs) tabs.style.display = which === "Login" || which === "Signup" ? "" : "none";
    overlay.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === which.toLowerCase()));
    const T = { Login: ["Welcome back", "Sign in to open the dashboard."], Forgot: ["Forgot your password?", "Type your work email — we'll send you a link to choose a new password."], Reset: ["Choose a new password", "This link works once. After saving, sign in with the new password."] }[which];
    if (T) { overlay.querySelector("#authTitle").textContent = T[0]; overlay.querySelector("#authSub").textContent = T[1]; }
  }
  function postWorker(action, body) {
    return fetch(CONFIG.WORKER_URL + "?action=" + action, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
      .then((r) => r.json().catch(() => ({ success: false, message: "Server error " + r.status })));
  }
  function wireResetForms(overlay) {
    overlay.querySelector("#authForgotLink").addEventListener("click", () => {
      overlay.querySelector("#authForgotEmail").value = overlay.querySelector("#authLoginEmail").value.trim();
      overlay.querySelector("#authForgotError").textContent = ""; overlay.querySelector("#authForgotOk").textContent = "";
      showPanel(overlay, "Forgot"); setTimeout(() => overlay.querySelector("#authForgotEmail").focus(), 30);
    });
    overlay.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => {
      if (RESET_TOKEN) history.replaceState(null, "", location.pathname + location.search);
      showPanel(overlay, "Login");
    }));
    let forgotTimer = null;
    function forgotCountdown(btn, triesEl, sec) {
      clearInterval(forgotTimer);
      const end = Date.now() + sec * 1000;
      const tick = () => {
        const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        if (!left) { clearInterval(forgotTimer); btn.disabled = false; btn.textContent = "Send reset link"; triesEl.textContent = "You can request a new reset email now."; return; }
        btn.disabled = true; btn.textContent = "Try again in " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
      };
      tick(); forgotTimer = setInterval(tick, 1000);
    }
    overlay.querySelector("#authForgotForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const err = overlay.querySelector("#authForgotError"), ok = overlay.querySelector("#authForgotOk"), btn = overlay.querySelector("#authForgotSubmit");
      const stepsEl = overlay.querySelector("#authForgotSteps"), triesEl = overlay.querySelector("#authForgotTries");
      err.textContent = ""; ok.textContent = ""; triesEl.textContent = "";
      const email = overlay.querySelector("#authForgotEmail").value.trim();
      if (!email) { err.textContent = "Enter your work email."; return; }
      const ICON = { ok: "✓", fail: "✕", skip: "–", run: "" };
      const draw = (steps) => { stepsEl.innerHTML = steps.map((s) => '<li class="auth-step ' + s.status + '"><span class="auth-step-ic">' + (s.status === "run" ? '<span class="auth-spin"></span>' : ICON[s.status] || "") + '</span><span><b>' + escapeHtml(s.label) + '</b>' + (s.detail ? '<em>' + escapeHtml(s.detail) + '</em>' : "") + "</span></li>").join(""); };
      draw([{ label: "Account check", status: "run" }, { label: "Reset email", status: "skip" }]);
      btn.disabled = true; btn.innerHTML = '<span class="auth-spin"></span>Checking…';
      let wait = 0;
      postWorker("staffForgot", { email: email })
        .then((r) => {
          r = r || {};
          if (r.steps && r.steps.length) draw(r.steps); else stepsEl.innerHTML = "";
          if (r.success) ok.textContent = r.message; else err.textContent = r.message || "Something went wrong. Please try again.";
          if (typeof r.triesLeft === "number") triesEl.textContent = r.triesLeft > 0 ? "Reset emails left this hour: " + r.triesLeft + " of 3." : "No reset emails left this hour.";
          if (r.code === "rate_limited" || (r.success && r.triesLeft === 0)) wait = r.retryAfterSec || 900;
        })
        .catch(() => { stepsEl.innerHTML = ""; err.textContent = "Could not reach the server. Please try again."; })
        .finally(() => { if (wait) forgotCountdown(btn, triesEl, wait); else { btn.disabled = false; btn.textContent = "Send reset link"; } });
    });
    overlay.querySelector("#authResetForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const err = overlay.querySelector("#authResetError"), btn = overlay.querySelector("#authResetSubmit");
      const p1 = overlay.querySelector("#authResetPassword").value, p2 = overlay.querySelector("#authResetConfirm").value;
      err.textContent = "";
      if (p1.length < 8) { err.textContent = "The password needs at least 8 characters."; return; }
      if (!/[A-Za-z]/.test(p1) || !/[0-9]/.test(p1)) { err.textContent = "Use letters and numbers in the password."; return; }
      if (p1 !== p2) { err.textContent = "The two passwords are different."; return; }
      btn.disabled = true; btn.innerHTML = '<span class="auth-spin"></span>Saving…';
      postWorker("staffReset", { token: RESET_TOKEN, password: p1 })
        .then((r) => {
          if (!r || !r.success) { err.textContent = (r && r.message) || "Could not save the password."; return; }
          clearSession(); // every old session is signed out after a reset
          history.replaceState(null, "", location.pathname + location.search);
          if (r.email) overlay.querySelector("#authLoginEmail").value = r.email;
          overlay.querySelector("#authLoginPassword").value = "";
          overlay.querySelector("#authLoginOk").textContent = "Password changed ✓ Sign in with your new password.";
          showPanel(overlay, "Login"); setTimeout(() => overlay.querySelector("#authLoginPassword").focus(), 30);
        })
        .catch(() => { err.textContent = "Could not reach the server. Please try again."; })
        .finally(() => { btn.disabled = false; btn.textContent = "Save new password"; });
    });
    if (RESET_TOKEN) { showPanel(overlay, "Reset"); setTimeout(() => overlay.querySelector("#authResetPassword").focus(), 60); }
  }

  function wireLoginForm(overlay) {
    const form = overlay.querySelector("#authLoginForm");
    const errorEl = overlay.querySelector("#authLoginError");
    const submitBtn = overlay.querySelector("#authLoginSubmit");
    const hintEl = overlay.querySelector("#authLoginHint");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorEl.textContent = "";

      const email = overlay.querySelector("#authLoginEmail").value.trim();
      const password = overlay.querySelector("#authLoginPassword").value;
      if (!password) {
        errorEl.textContent = "Please enter your password.";
        return;
      }

      const stop = startBusy(submitBtn, hintEl, "Signing in…");
      // v1.16.0: sign-in goes through the Worker — it checks the password with Apps Script and returns the staff token.
      staffLogin(email, password)
        .then((res) => {
          if (!res || !res.success) {
            errorEl.textContent = (res && res.message) || "Invalid email or password.";
            return;
          }
          finishAuth(res, "login");
        })
        .catch((err) => {
          errorEl.textContent = err.message || "Something went wrong. Please try again.";
        })
        .finally(() => stop("Login"));
    });
  }

  function wireSignupForm(overlay) {
    const form = overlay.querySelector("#authSignupForm");
    const errorEl = overlay.querySelector("#authSignupError");
    const submitBtn = overlay.querySelector("#authSignupSubmit");
    const hintEl = overlay.querySelector("#authSignupHint");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorEl.textContent = "";

      const name = overlay.querySelector("#authSignupName").value.trim();
      const email = overlay.querySelector("#authSignupEmail").value.trim();
      const role = overlay.querySelector("#authSignupRole").value;
      const password = overlay.querySelector("#authSignupPassword").value;
      const confirm = overlay.querySelector("#authSignupPasswordConfirm").value;

      if (!name) {
        errorEl.textContent = "Please enter your full name.";
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = "Password must be at least 6 characters.";
        return;
      }
      if (password !== confirm) {
        errorEl.textContent = "Passwords do not match.";
        return;
      }

      const stop = startBusy(submitBtn, hintEl, "Creating account…");
      // The server decides who may sign up (taager.com or an admin-invited email).
      callApi({ action: "signup", name: name, email: email, password: password, role: role })
        .then((res) => {
          if (!res || !res.success) {
            errorEl.textContent = (res && res.message) || "Could not create the account.";
            return;
          }
          // the account exists now — sign in through the Worker to get the staff token
          return staffLogin(email, password).then((r2) => {
            if (!r2 || !r2.success) { errorEl.textContent = (r2 && r2.message) || "Account created — please sign in."; return; }
            finishAuth(r2, "signup");
          });
        })
        .catch((err) => {
          errorEl.textContent = err.message || "Something went wrong. Please try again.";
        })
        .finally(() => stop("Create account"));
    });
  }

  /* ------------------------------------------------------------------ *
   *  3) Unlock dashboard after successful auth
   * ------------------------------------------------------------------ */
  function unlockDashboard(user) {
    const gate = document.getElementById("authGateStyle");
    if (gate) gate.textContent = "";
    const overlay = document.getElementById("authOverlay");
    if (overlay) overlay.remove();
    window.dispatchEvent(new Event("taager-auth"));
    onDomReady(() => {
      injectUserBadge(user);
      startPresence(user);
    });
  }

  /* ------------------------------------------------------------------ *
   *  4) Profile card + Logout, injected at the top of the sidebar
   *     footer (right above "Live System Sync")
   * ------------------------------------------------------------------ */
  function injectUserBadge(user) {
    if (document.getElementById("authUserBadge")) return; // already injected
    const footer = document.querySelector(".sidebar-footer");
    if (!footer) return;

    const wrap = document.createElement("div");
    wrap.id = "authUserBadge";
    wrap.className = "auth-profile";
    wrap.innerHTML = `
      <div class="auth-avatar">${escapeHtml(getInitials(user.name))}</div>
      <div class="auth-profile-info">
        <div class="auth-profile-name">${escapeHtml(user.name)}</div>
        <div class="auth-profile-role">${escapeHtml(user.role)}</div>
      </div>
      <button type="button" class="auth-logout-icon" title="Logout">⏻</button>
    `;

    wrap.querySelector(".auth-logout-icon").addEventListener("click", () => {
      clearSession();
      window.location.reload();
    });

    footer.prepend(wrap);
  }

  /* ------------------------------------------------------------------ *
   *  5) Presence — heartbeat for everyone, "who's online" widget for
   *     PRESENCE_ADMIN_EMAIL only
   * ------------------------------------------------------------------ */
  // v1.1.3: التاب لما يبقى مخفي (تاب تاني مفتوح، أو التاب ده في الخلفية)،
  // المتصفح بيعلّق الشبكة عليه (ERR_NETWORK_IO_SUSPENDED) — مفيش داعي نحاول
  // نبعت heartbeat/presence أصلاً وقتها، بنسيبهم يستأنفوا أول ما التاب يرجع مرئي.
  function isTabVisible() {
    return typeof document === "undefined" || document.visibilityState !== "hidden";
  }

  // v1.1.32: فاصل بسيط (4 ثواني) قبل أول heartbeat — عشان ميضربش نفس
  // اللحظة بالظبط اللي فيها loadData الأساسية بتضرب الباك اند وقت تحميل
  // الصفحة (كانت الاتنين بيحصلوا سوا عند t=0، ده كان بيزود احتمال الـ 404
  // العابر). الـ setInterval بعد كده بيفضل شغال بنفس الفاصل الزمني عادي.
  function startPresence(user) {
    setTimeout(() => sendHeartbeat(user), 4000);
    setInterval(() => { if (isTabVisible()) sendHeartbeat(user); }, CONFIG.HEARTBEAT_INTERVAL_MS);

    if (CONFIG.OWNER_EMAILS.indexOf(String(user.email || "").trim().toLowerCase()) !== -1) {
      injectPresenceStyles();
      buildPresenceWidget(user);
    }
  }

  function sendHeartbeat(user) {
    if (!CONFIG.WORKER_URL) return;
    const url = `${CONFIG.WORKER_URL}?action=heartbeat&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name || "")}`;
    fetch(url, { method: "GET", cache: "no-store" }).catch(() => {
      /* silent — a missed heartbeat just means one skipped "online" tick */
    });
  }

  function injectPresenceStyles() {
    const css = `
    .presence-widget{position:relative;display:inline-flex;z-index:9500;font-family:"Inter",-apple-system,sans-serif;}
    .presence-pill{display:flex;align-items:center;gap:7px;background:#18181b;border:1px solid #27272a;
      border-radius:20px;padding:7px 14px 7px 10px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.35);
      transition:border-color .2s;font-family:inherit;}
    .presence-pill:hover{border-color:#3f3f46;}
    .presence-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;
      box-shadow:0 0 0 0 rgba(34,197,94,0.55);animation:presencePulse 2s infinite;}
    @keyframes presencePulse{
      0%{box-shadow:0 0 0 0 rgba(34,197,94,0.55);}
      70%{box-shadow:0 0 0 6px rgba(34,197,94,0);}
      100%{box-shadow:0 0 0 0 rgba(34,197,94,0);}
    }
    .presence-count{font-size:12px;font-weight:700;color:#fafafa;}
    .presence-label{font-size:11px;font-weight:600;color:#a1a1aa;letter-spacing:0.3px;}
    .presence-panel{position:absolute;top:calc(100% + 8px);right:0;width:280px;max-height:340px;overflow-y:auto;
      background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.45);
      padding:8px;}
    .presence-panel.hidden{display:none;}
    .presence-panel-header{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 10px 8px;
      border-bottom:1px solid #27272a;margin-bottom:6px;}
    .presence-panel-title{font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.5px;}
    .presence-panel-sub{font-size:10px;color:#52525b;font-family:'JetBrains Mono',monospace;}
    .presence-row{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;}
    .presence-row:hover{background:#09090b;}
    .presence-avatar{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);
      display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;
      flex-shrink:0;text-transform:uppercase;}
    .presence-row-info{flex:1;min-width:0;}
    .presence-row-name{font-size:12px;font-weight:600;color:#fafafa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .presence-row-email{font-size:10px;color:#71717a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .presence-row-time{font-size:10px;color:#22c55e;font-family:'JetBrains Mono',monospace;flex-shrink:0;}
    .presence-empty{padding:16px 8px;text-align:center;font-size:11px;color:#52525b;}
    `;
    const styleEl = document.createElement("style");
    styleEl.id = "presenceStyles";
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  function buildPresenceWidget(user) {
    if (document.getElementById("presenceWidget")) return;

    const widget = document.createElement("div");
    widget.id = "presenceWidget";
    widget.className = "presence-widget";
    widget.innerHTML = `
      <button type="button" class="presence-pill" id="presencePillBtn" title="Who's online">
        <span class="presence-dot"></span>
        <span class="presence-count" id="presenceCount">—</span>
        <span class="presence-label">Online</span>
      </button>
      <div class="presence-panel hidden" id="presencePanel">
        <div class="presence-panel-header">
          <span class="presence-panel-title">Active Now</span>
          <span class="presence-panel-sub" id="presenceUpdatedAt"></span>
        </div>
        <div class="presence-list" id="presenceList"></div>
      </div>
    `;
    const actionsRow = document.querySelector(".topbar-actions");
    if (actionsRow) {
      actionsRow.prepend(widget);
    } else {
      document.body.appendChild(widget);
    }

    const pillBtn = widget.querySelector("#presencePillBtn");
    const panel = widget.querySelector("#presencePanel");

    pillBtn.addEventListener("click", () => {
      const willOpen = panel.classList.contains("hidden");
      panel.classList.toggle("hidden");
      if (willOpen) refreshPresence(user);
    });

    document.addEventListener("click", (e) => {
      if (!widget.contains(e.target)) panel.classList.add("hidden");
    });

    // v1.1.32: فاصل تاني (14 ثانية) — بعيد عن أول heartbeat (4 ثواني) وعن
    // نص الدورة (15 ثانية) عشان الـ presence refresh والـ heartbeat يفضلوا
    // بعيدين عن بعض على مدار الوقت، مش بس أول مرة (الاتنين بيشتغلوا بنفس
    // الفاصل الزمني الكامل HEARTBEAT_INTERVAL_MS، فالفرق الأولي ده بيفضل
    // ثابت طول عمر الصفحة).
    setTimeout(() => refreshPresence(user), 14000);
    setInterval(() => { if (isTabVisible()) refreshPresence(user); }, CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  function refreshPresence(user) {
    if (!CONFIG.WORKER_URL) return;
    const url = `${CONFIG.WORKER_URL}?action=getOnlineUsers&requesterEmail=${encodeURIComponent(user.email)}`;
    fetch(url, { method: "GET", cache: "no-store" })
      .then((res) => res.json())
      .then((res) => {
        if (!res || !res.success) return;
        renderPresence(res.users || [], res.now || Date.now());
      })
      .catch(() => {
        /* silent — widget just keeps showing the last known state */
      });
  }

  function renderPresence(users, now) {
    const countEl = document.getElementById("presenceCount");
    const listEl = document.getElementById("presenceList");
    const updatedEl = document.getElementById("presenceUpdatedAt");
    if (!countEl || !listEl) return;

    countEl.textContent = String(users.length);
    updatedEl.textContent = "now";

    if (!users.length) {
      listEl.innerHTML = `<div class="presence-empty">No one else is online right now.</div>`;
      return;
    }

    listEl.innerHTML = users
      .map((u) => {
        const secondsAgo = Math.max(0, Math.round((now - u.lastSeen) / 1000));
        return `
        <div class="presence-row">
          <div class="presence-avatar">${escapeHtml(getInitials(u.name))}</div>
          <div class="presence-row-info">
            <div class="presence-row-name">${escapeHtml(u.name)}</div>
            <div class="presence-row-email">${escapeHtml(u.email)}</div>
          </div>
          <div class="presence-row-time">${formatSecondsAgo(secondsAgo)}</div>
        </div>`;
      })
      .join("");
  }

  function formatSecondsAgo(seconds) {
    if (seconds < 10) return "now";
    if (seconds < 60) return seconds + "s";
    return Math.round(seconds / 60) + "m";
  }

  function getInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0].charAt(0) + parts[parts.length - 1].charAt(0);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }
})();
