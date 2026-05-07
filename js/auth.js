// Altare AI Panel — auth guard helpers
// Use on any page that must be admin-only.

import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { auth } from "./firebase-config.js";

/**
 * Resolve to the current user once Firebase has restored its persisted state.
 */
export function getCurrentUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/**
 * Hard-redirect away from the page unless the user is signed in AND has the
 * `admin: true` custom claim. Call this at the very top of admin pages.
 *
 * @param {object} opts
 * @param {string} [opts.loginPath="/login.html"]  Where to send anonymous users.
 * @param {(user: import('firebase/auth').User, claims: object) => void} [opts.onReady]
 *        Invoked once authentication has been verified. Receives the user and
 *        their decoded ID-token claims.
 */
export async function requireAdmin({
  loginPath = "/login.html",
  onReady,
} = {}) {
  const user = await getCurrentUser();
  if (!user) {
    redirectToLogin(loginPath);
    return;
  }

  // Force-refresh once on entry so newly granted claims propagate without a
  // manual sign-out / sign-in cycle.
  const tokenResult = await user.getIdTokenResult(true);
  if (tokenResult.claims.admin !== true) {
    document.body.innerHTML = adminGateHTML(user.email || user.uid);
    return;
  }

  if (typeof onReady === "function") {
    onReady(user, tokenResult.claims);
  }
}

export async function altareSignOut(redirectTo = "/login.html") {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[altare] sign-out failed:", err);
  }
  window.location.href = redirectTo;
}

function redirectToLogin(loginPath) {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `${loginPath}?next=${next}`;
}

function adminGateHTML(who) {
  return `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                background:#0a0a0a;color:#fff;font-family:Inter,sans-serif;padding:24px;text-align:center;">
      <div style="max-width:480px;">
        <h1 style="font-size:1.6rem;font-weight:800;letter-spacing:-0.01em;margin-bottom:14px;">
          Yetkisiz erişim
        </h1>
        <p style="color:rgba(255,255,255,0.55);line-height:1.6;margin-bottom:20px;">
          ${escapeHtml(who)} hesabı Altare AI Panel için yetkilendirilmemiş.
          Erişim almak için bir admin'e <code>admin: true</code> rolü vermesini söyleyin.
        </p>
        <a href="/login.html" style="display:inline-block;padding:12px 22px;background:#fff;color:#000;
                                     border-radius:10px;font-weight:700;text-transform:uppercase;
                                     letter-spacing:0.1em;font-size:0.85rem;text-decoration:none;">
          Giriş ekranına dön
        </a>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
