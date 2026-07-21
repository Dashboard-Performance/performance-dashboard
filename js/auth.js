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
    API_URL: "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE",

    // Only emails ending with this domain are allowed to sign up
    ALLOWED_DOMAIN: "taager.com",

    // Roles offered in the Sign Up form — edit freely
    ROLES: ["Admin", "Account Manager", "Commercial", "Marketplace", "Viewer"],

    // localStorage key used to keep the user logged in
    STORAGE_KEY: "taagerDashboardSession",
  };

  /* ------------------------------------------------------------------ *
   *  0) Immediately hide the dashboard until we know the auth state
   * ------------------------------------------------------------------ */
  const existingSession = readSession();

  const gateStyle = document.createElement("style");
  gateStyle.id = "authGateStyle";
  if (!existingSession) {
    gateStyle.textContent = `body > *:not(#authOverlay){display:none !important;}`;
  }
  document.head.appendChild(gateStyle);

  injectAuthStyles();

  if (!existingSession) {
    buildOverlay();
  } else {
    // Already logged in on this device — just wire up the logout control
    // once the rest of the dashboard has loaded.
    onDomReady(() => injectUserBadge(existingSession));
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

  function saveSession(user) {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
  }

  function isTaagerEmail(email) {
    const re = new RegExp("^[^\\s@]+@" + CONFIG.ALLOWED_DOMAIN.replace(".", "\\.") + "$", "i");
    return re.test(String(email || "").trim());
  }

  function callApi(payload) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf("https://script.google.com/macros/s/AKfycbwJw0dlXgmSt9E04YYcMzvLln0M1NQpraPvuFcxDiE5VnHLR4HWfMJAlMsJzmO1deDaGg/exec") === 0) {
      return Promise.reject(
        new Error("Auth backend is not configured yet. Set CONFIG.API_URL in js/auth.js")
      );
    }
    return fetch(CONFIG.API_URL, {
      method: "POST",
      // text/plain avoids a CORS pre-flight request against Apps Script
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .catch(() => {
        throw new Error("Could not reach the server. Please check your connection.");
      });
  }

  /* ------------------------------------------------------------------ *
   *  1) Styles for the overlay (scoped under #authOverlay)
   * ------------------------------------------------------------------ */
  function injectAuthStyles() {
    const css = `
    #authOverlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at 30% 20%,rgba(59,130,246,0.12),transparent 45%),
                 radial-gradient(circle at 80% 80%,rgba(139,92,246,0.12),transparent 45%),#09090b;
      font-family:"Inter",-apple-system,sans-serif;padding:20px;}
    #authOverlay *{box-sizing:border-box;}
    .auth-card{width:100%;max-width:380px;background:#18181b;border:1px solid #27272a;border-radius:14px;
      padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,0.45);}
    .auth-brand{text-align:center;font-size:13px;font-weight:700;color:#fff;letter-spacing:0.5px;
      background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:9px 14px;border-radius:8px;margin:0 auto 22px auto;
      display:block;width:fit-content;text-shadow:0 1px 2px rgba(0,0,0,0.3);}
    .auth-tabs{display:flex;background:#09090b;border:1px solid #27272a;border-radius:8px;padding:4px;margin-bottom:22px;}
    .auth-tab{flex:1;background:transparent;border:none;padding:9px 0;font-size:12px;font-weight:600;color:#a1a1aa;
      border-radius:6px;cursor:pointer;letter-spacing:0.3px;transition:all .2s;font-family:inherit;}
    .auth-tab.active{background:#3b82f6;color:#fff;box-shadow:0 0 12px rgba(59,130,246,0.35);}
    .auth-form{display:none;flex-direction:column;gap:6px;}
    .auth-form.active{display:flex;}
    .auth-form label{font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.5px;
      margin-top:10px;}
    .auth-form input,.auth-form select{width:100%;padding:10px 12px;background:#09090b;border:1px solid #27272a;
      border-radius:7px;color:#fafafa;font-size:13px;font-family:inherit;outline:none;transition:border-color .2s;}
    .auth-form input:focus,.auth-form select:focus{border-color:#3b82f6;}
    .auth-form select{cursor:pointer;}
    .auth-password-wrap{position:relative;display:flex;align-items:center;}
    .auth-password-wrap input{padding-right:56px;}
    .auth-toggle-pass{position:absolute;right:10px;font-size:11px;color:#3b82f6;cursor:pointer;font-weight:600;
      user-select:none;}
    .auth-error{min-height:16px;color:#ef4444;font-size:12px;margin-top:10px;line-height:1.4;}
    .auth-submit{margin-top:14px;background:#3b82f6;color:#fff;border:none;border-radius:7px;padding:11px 0;
      font-size:13px;font-weight:700;letter-spacing:0.3px;cursor:pointer;transition:all .2s;
      box-shadow:0 0 12px rgba(59,130,246,0.3);font-family:inherit;}
    .auth-submit:hover{box-shadow:0 0 18px rgba(59,130,246,0.5);transform:translateY(-1px);}
    .auth-submit:disabled{opacity:0.6;cursor:not-allowed;transform:none;}
    .auth-footnote{text-align:center;margin-top:20px;font-size:11px;color:#52525b;letter-spacing:0.2px;}
    .auth-user-badge{display:flex;align-items:center;gap:8px;font-size:11px;color:#a1a1aa;
      font-family:'JetBrains Mono',monospace;}
    .auth-user-badge b{color:#fff;}
    .auth-logout-btn{font-family:inherit;font-size:12px;font-weight:600;padding:6px 14px;border-radius:6px;
      border:1px solid #3f3f46;background:transparent;color:#fafafa;cursor:pointer;transition:all .2s;}
    .auth-logout-btn:hover{background:rgba(255,255,255,0.05);border-color:#ef4444;color:#ef4444;}
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
      <div class="auth-card">
        <span class="auth-brand">Performance Analytics</span>
        <div class="auth-tabs">
          <button type="button" class="auth-tab active" data-tab="login">Login</button>
          <button type="button" class="auth-tab" data-tab="signup">Sign Up</button>
        </div>

        <form id="authLoginForm" class="auth-form active" autocomplete="on">
          <label>Email</label>
          <input type="email" id="authLoginEmail" placeholder="name@${CONFIG.ALLOWED_DOMAIN}" autocomplete="username" required />
          <label>Password</label>
          <div class="auth-password-wrap">
            <input type="password" id="authLoginPassword" placeholder="••••••••" autocomplete="current-password" required />
            <span class="auth-toggle-pass" data-target="authLoginPassword">Show</span>
          </div>
          <div class="auth-error" id="authLoginError"></div>
          <button type="submit" class="auth-submit" id="authLoginSubmit">Login</button>
        </form>

        <form id="authSignupForm" class="auth-form" autocomplete="off">
          <label>Full Name</label>
          <input type="text" id="authSignupName" placeholder="e.g. Ahmed Mostafa" required />
          <label>Email</label>
          <input type="email" id="authSignupEmail" placeholder="name@${CONFIG.ALLOWED_DOMAIN}" required />
          <label>Role</label>
          <select id="authSignupRole" required>${roleOptions}</select>
          <label>Password</label>
          <div class="auth-password-wrap">
            <input type="password" id="authSignupPassword" placeholder="At least 6 characters" required />
            <span class="auth-toggle-pass" data-target="authSignupPassword">Show</span>
          </div>
          <label>Confirm Password</label>
          <input type="password" id="authSignupPasswordConfirm" placeholder="••••••••" required />
          <div class="auth-error" id="authSignupError"></div>
          <button type="submit" class="auth-submit" id="authSignupSubmit">Create Account</button>
        </form>

        <div class="auth-footnote">Access is restricted to @${CONFIG.ALLOWED_DOMAIN} accounts</div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Tabs
    overlay.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        overlay.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
        overlay.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
        tab.classList.add("active");
        overlay.querySelector(`#auth${cap(tab.dataset.tab)}Form`).classList.add("active");
      });
    });

    // Show/hide password
    overlay.querySelectorAll(".auth-toggle-pass").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        const isPass = input.type === "password";
        input.type = isPass ? "text" : "password";
        btn.textContent = isPass ? "Hide" : "Show";
      });
    });

    // Prefill remembered email if present (edge case: cleared session but kept email)
    const rememberedEmail = localStorage.getItem("taagerDashboardLastEmail");
    if (rememberedEmail) {
      document.getElementById("authLoginEmail").value = rememberedEmail;
    }

    wireLoginForm(overlay);
    wireSignupForm(overlay);

    function cap(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }

  function wireLoginForm(overlay) {
    const form = overlay.querySelector("#authLoginForm");
    const errorEl = overlay.querySelector("#authLoginError");
    const submitBtn = overlay.querySelector("#authLoginSubmit");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorEl.textContent = "";

      const email = overlay.querySelector("#authLoginEmail").value.trim();
      const password = overlay.querySelector("#authLoginPassword").value;

      if (!isTaagerEmail(email)) {
        errorEl.textContent = `Please use your @${CONFIG.ALLOWED_DOMAIN} email.`;
        return;
      }
      if (!password) {
        errorEl.textContent = "Please enter your password.";
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in...";

      callApi({ action: "login", email: email, password: password })
        .then((res) => {
          if (!res || !res.success) {
            errorEl.textContent = (res && res.message) || "Invalid email or password.";
            return;
          }
          const user = { name: res.name, email: res.email, role: res.role };
          saveSession(user);
          localStorage.setItem("taagerDashboardLastEmail", user.email);
          unlockDashboard(user);
        })
        .catch((err) => {
          errorEl.textContent = err.message || "Something went wrong. Please try again.";
        })
        .finally(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = "Login";
        });
    });
  }

  function wireSignupForm(overlay) {
    const form = overlay.querySelector("#authSignupForm");
    const errorEl = overlay.querySelector("#authSignupError");
    const submitBtn = overlay.querySelector("#authSignupSubmit");

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
      if (!isTaagerEmail(email)) {
        errorEl.textContent = `Sign up is only allowed with an @${CONFIG.ALLOWED_DOMAIN} email.`;
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

      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account...";

      callApi({ action: "signup", name: name, email: email, password: password, role: role })
        .then((res) => {
          if (!res || !res.success) {
            errorEl.textContent = (res && res.message) || "Could not create the account.";
            return;
          }
          const user = { name: res.name, email: res.email, role: res.role };
          saveSession(user);
          localStorage.setItem("taagerDashboardLastEmail", user.email);
          unlockDashboard(user);
        })
        .catch((err) => {
          errorEl.textContent = err.message || "Something went wrong. Please try again.";
        })
        .finally(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Account";
        });
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
    onDomReady(() => injectUserBadge(user));
  }

  /* ------------------------------------------------------------------ *
   *  4) Small "logged in as ... / Logout" control in the top bar
   * ------------------------------------------------------------------ */
  function injectUserBadge(user) {
    if (document.getElementById("authUserBadge")) return; // already injected
    const actions = document.querySelector(".topbar-actions");
    if (!actions) return;

    const wrap = document.createElement("div");
    wrap.id = "authUserBadge";
    wrap.className = "auth-user-badge";
    wrap.innerHTML = `<span>Signed in as <b>${escapeHtml(user.name)}</b> (${escapeHtml(user.role)})</span>`;

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "auth-logout-btn";
    logoutBtn.textContent = "Logout";
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.reload();
    });

    actions.prepend(logoutBtn);
    actions.prepend(wrap);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }
})();
