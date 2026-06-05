// Altare AI Panel — auth guard helpers
// Use on any page that must be panel-accessible (developer or admin).

import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

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
 * `admin: true` custom claim. Use ONLY for admin-only screens (e.g. customer
 * management).
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

  const tokenResult = await user.getIdTokenResult(true);
  if (tokenResult.claims.admin !== true) {
    document.body.innerHTML = adminGateHTML(user.email || user.uid);
    return;
  }

  if (typeof onReady === "function") {
    onReady(user, tokenResult.claims);
  }
}

/**
 * Allow access for any signed-in user who either:
 *  - has `admin: true` claim, OR
 *  - has a /developers/{uid} document (i.e. is a customer)
 * Onboarding: if user is signed in but no developer doc exists, create one
 * with sensible defaults so panel works immediately after signup.
 */
export async function requirePanelAccess({
  loginPath = "/login.html",
  onReady,
} = {}) {
  const user = await getCurrentUser();
  if (!user) {
    redirectToLogin(loginPath);
    return;
  }

  const tokenResult = await user.getIdTokenResult(true);
  const isAdmin = tokenResult.claims.admin === true;

  let developerDoc = null;
  try {
    const snap = await getDoc(doc(db, "developers", user.uid));
    if (snap.exists()) developerDoc = snap.data();
  } catch (err) {
    console.warn("[altare] developer lookup failed", err);
  }

  if (!isAdmin && !developerDoc) {
    document.body.innerHTML = noProfileGateHTML(user.email || user.uid);
    return;
  }

  if (typeof onReady === "function") {
    onReady(user, tokenResult.claims, { isAdmin, developer: developerDoc });
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
          Admin yetkisi gerekli
        </h1>
        <p style="color:rgba(255,255,255,0.55);line-height:1.6;margin-bottom:20px;">
          ${escapeHtml(who)} hesabı bu sayfa için admin yetkisine sahip değil.
          Panel'e erişim için ana sayfaya dönebilirsin.
        </p>
        <a href="/panel.html" style="display:inline-block;padding:12px 22px;background:#fff;color:#000;
                                     border-radius:10px;font-weight:700;text-transform:uppercase;
                                     letter-spacing:0.1em;font-size:0.85rem;text-decoration:none;">
          Panele dön
        </a>
      </div>
    </div>`;
}

function noProfileGateHTML(who) {
  return `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                background:#0a0a0a;color:#fff;font-family:Inter,sans-serif;padding:24px;text-align:center;">
      <div style="max-width:480px;">
        <h1 style="font-size:1.6rem;font-weight:800;letter-spacing:-0.01em;margin-bottom:14px;">
          Hesap profili bulunamadı
        </h1>
        <p style="color:rgba(255,255,255,0.55);line-height:1.6;margin-bottom:20px;">
          ${escapeHtml(who)} hesabınla giriş yaptın ama henüz bir developer profilin yok.
          Lütfen yöneticiyle iletişime geç ya da yeni bir hesap aç.
        </p>
        <a href="/signup.html" style="display:inline-block;padding:12px 22px;background:#fff;color:#000;
                                     border-radius:10px;font-weight:700;text-transform:uppercase;
                                     letter-spacing:0.1em;font-size:0.85rem;text-decoration:none;margin-right:10px;">
          Kayıt ol
        </a>
        <a href="/login.html" style="display:inline-block;padding:12px 22px;background:transparent;
                                     border:1px solid rgba(255,255,255,0.2);color:#fff;
                                     border-radius:10px;font-weight:700;text-transform:uppercase;
                                     letter-spacing:0.1em;font-size:0.85rem;text-decoration:none;">
          Çıkış
        </a>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
