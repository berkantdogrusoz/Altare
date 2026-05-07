// =============================================================================
// games.js — Self-Service Multi-Tenant Game Management
// -----------------------------------------------------------------------------
// "Oyunlarım" sekmesi: kullanicinin kendi oyunlarini listele + yeni oyun ekle
// "Musteri Yonetimi" sekmesi: admin-only musteri olusturma
//
// Cloud Functions cagrilari:
//   - createGame(gameName, gameType, platforms)
//   - listMyGames()
//   - deleteGame(gameId)
//   - createCustomer(email, displayName, studioName, tier)  [admin only]
// =============================================================================

import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { auth, functions } from "/js/firebase-config.js";

const GAME_TYPES = [
    { value: "match3", label: "Match-3" },
    { value: "puzzle", label: "Block Puzzle / Casual" },
    { value: "midcore", label: "Mid-Core" },
    { value: "rpg", label: "RPG" },
    { value: "action", label: "Action" },
    { value: "strategy", label: "Strategy" },
    { value: "simulation", label: "Simulation" },
    { value: "casino", label: "Casino" },
    { value: "other", label: "Diğer" },
];

const PLATFORMS = ["Android", "iOS", "WebGL", "PC"];

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

let currentUser = null;
let myGamesCache = [];

document.addEventListener("DOMContentLoaded", () => {
    // Tab degistiginde my-games sekmesindeysek listeyi yenile
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            if (tab === 'my-games') refreshMyGames();
        });
    });

    // "Yeni Oyun Ekle" butonu
    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) btnNewGame.addEventListener('click', openNewGameModal);

    // "Musteri Olustur" formu (admin)
    const formNewCustomer = document.getElementById('form-new-customer');
    if (formNewCustomer) formNewCustomer.addEventListener('submit', handleCreateCustomer);
});

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (!user) return;

    // Admin ise "Musteri Yonetimi" sekmesini aç
    user.getIdTokenResult().then((res) => {
        const isAdmin = res.claims?.admin === true;
        document.querySelectorAll('.admin-only').forEach(el => {
            el.hidden = !isAdmin;
        });
    });

    // Acilirken Oyunlarim listesini doldur
    refreshMyGames();
});

// ─────────────────────────────────────────────────────────────────────────────
// My Games — listele
// ─────────────────────────────────────────────────────────────────────────────

async function refreshMyGames() {
    const container = document.getElementById('my-games-list');
    if (!container) return;
    container.innerHTML = '<div class="empty">Yükleniyor...</div>';

    try {
        const fn = httpsCallable(functions, 'listMyGames');
        const result = await fn({});
        myGamesCache = result.data?.games || [];
        renderMyGames(myGamesCache);
    } catch (err) {
        container.innerHTML = `<div class="empty">Hata: ${escapeHtml(err.message || String(err))}</div>`;
    }
}

function renderMyGames(games) {
    const container = document.getElementById('my-games-list');
    if (!container) return;

    if (!games || games.length === 0) {
        container.innerHTML = `
            <div class="empty">
                Henüz oyun eklemedin. <strong>"+ Yeni Oyun Ekle"</strong> ile başla.
            </div>`;
        return;
    }

    container.innerHTML = `
        <table class="games-table">
            <thead>
                <tr>
                    <th>Oyun Adı</th>
                    <th>Game ID</th>
                    <th>Tür</th>
                    <th>Platform</th>
                    <th>Durum</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${games.map(g => `
                    <tr>
                        <td><strong>${escapeHtml(g.gameName)}</strong></td>
                        <td><code>${escapeHtml(g.gameId)}</code></td>
                        <td>${escapeHtml(g.gameType || '—')}</td>
                        <td>${(g.platforms || []).map(escapeHtml).join(', ')}</td>
                        <td><span class="badge ${g.status === 'active' ? 'medium' : 'low'}">${escapeHtml(g.status || 'active')}</span></td>
                        <td class="row-actions">
                            <button class="btn-link" data-action="select-game" data-game="${escapeHtml(g.gameId)}">Seç</button>
                            <button class="btn-link" data-action="show-credentials" data-game="${escapeHtml(g.gameId)}">SDK Bilgileri</button>
                            <button class="btn-link danger" data-action="delete-game" data-game="${escapeHtml(g.gameId)}">Sil</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Action handlers
    container.querySelectorAll('[data-action="select-game"]').forEach(btn => {
        btn.addEventListener('click', () => selectGame(btn.dataset.game));
    });
    container.querySelectorAll('[data-action="show-credentials"]').forEach(btn => {
        btn.addEventListener('click', () => showGameCredentials(btn.dataset.game));
    });
    container.querySelectorAll('[data-action="delete-game"]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteGame(btn.dataset.game));
    });
}

function selectGame(gameId) {
    // Üst game-selector dropdown'una bu oyunu sec ve eventStream'e gec
    const selector = document.getElementById('game-selector');
    if (selector) {
        // Eger option yoksa ekle
        const exists = Array.from(selector.options).some(o => o.value === gameId);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = gameId;
            const game = myGamesCache.find(g => g.gameId === gameId);
            opt.textContent = game ? game.gameName : gameId;
            selector.appendChild(opt);
        }
        selector.value = gameId;
        selector.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Overview sekmesine gec
    const tabBtn = document.querySelector('.nav-tab[data-tab="overview"]');
    if (tabBtn) tabBtn.click();
}

function showGameCredentials(gameId) {
    const game = myGamesCache.find(g => g.gameId === gameId);
    if (!game) return;
    const apiKey = game.apiKey || '(yok)';
    const initSnippet = `AltareAnalytics.Initialize("${gameId}", "${game.gameName}");`;

    showModal(`
        <h3>SDK Bilgileri · ${escapeHtml(game.gameName)}</h3>
        <div class="kv">
            <div class="kv-row"><span class="kv-key">Game ID</span><code class="kv-val">${escapeHtml(gameId)}</code></div>
            <div class="kv-row"><span class="kv-key">API Key</span><code class="kv-val">${escapeHtml(apiKey)}</code></div>
        </div>
        <p style="margin-top: 16px;"><strong>Unity Initialize Çağrısı:</strong></p>
        <pre class="code-block">${escapeHtml(initSnippet)}</pre>
        <p style="margin-top: 12px; color: var(--muted);">SDK indirme zip'i (AltareAnalytics.cs + AltareConfig.json + INTEGRATION_GUIDE.pdf) yakında gelecek. Şimdilik <strong>Entegrasyon Rehberi</strong> sekmesindeki adımları takip et.</p>
        <div class="modal-actions">
            <button class="primary-btn" data-modal-close>Tamam</button>
        </div>
    `);
}

async function handleDeleteGame(gameId) {
    if (!confirm(`"${gameId}" oyununu silmek istediğine emin misin? Tüm event verileri kaybolur.`)) return;
    try {
        const fn = httpsCallable(functions, 'deleteGame');
        await fn({ gameId });
        await refreshMyGames();
    } catch (err) {
        alert('Silme hatası: ' + (err.message || String(err)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// New Game Modal
// ─────────────────────────────────────────────────────────────────────────────

function openNewGameModal() {
    showModal(`
        <h3>Yeni Oyun Ekle</h3>
        <form id="new-game-form" class="form-stack">
            <label>
                <span>Oyun Adı *</span>
                <input type="text" name="gameName" required minlength="2" maxlength="60" placeholder="Royal Dreams">
            </label>
            <label>
                <span>Tür</span>
                <select name="gameType">
                    ${GAME_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                </select>
            </label>
            <fieldset>
                <legend>Platform</legend>
                ${PLATFORMS.map((p, i) => `
                    <label class="checkbox">
                        <input type="checkbox" name="platforms" value="${p}" ${i === 0 ? 'checked' : ''}> ${p}
                    </label>
                `).join('')}
            </fieldset>
            <div class="modal-actions">
                <button type="button" class="btn-link" data-modal-close>İptal</button>
                <button type="submit" class="primary-btn">Oluştur</button>
            </div>
        </form>
        <div id="new-game-result"></div>
    `);

    const form = document.getElementById('new-game-form');
    if (form) form.addEventListener('submit', handleCreateGame);
}

async function handleCreateGame(e) {
    e.preventDefault();
    const form = e.target;
    const gameName = form.gameName.value.trim();
    const gameType = form.gameType.value;
    const platforms = Array.from(form.querySelectorAll('input[name="platforms"]:checked'))
        .map(cb => cb.value);

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Oluşturuluyor...'; }

    try {
        const fn = httpsCallable(functions, 'createGame');
        const result = await fn({ gameName, gameType, platforms });
        const data = result.data || {};
        const resultDiv = document.getElementById('new-game-result');
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="success-box" style="margin-top: 16px;">
                    <h4>✅ Oyun oluşturuldu!</h4>
                    <div class="kv" style="margin-top: 8px;">
                        <div class="kv-row"><span class="kv-key">Game ID</span><code class="kv-val">${escapeHtml(data.gameId)}</code></div>
                        <div class="kv-row"><span class="kv-key">API Key</span><code class="kv-val">${escapeHtml(data.apiKey || '')}</code></div>
                    </div>
                    <p style="margin-top: 12px;"><strong>Unity Initialize:</strong></p>
                    <pre class="code-block">AltareAnalytics.Initialize("${escapeHtml(data.gameId)}", "${escapeHtml(gameName)}");</pre>
                </div>
            `;
        }
        await refreshMyGames();
    } catch (err) {
        const resultDiv = document.getElementById('new-game-result');
        if (resultDiv) {
            resultDiv.innerHTML = `<div class="error-box" style="margin-top: 12px;">Hata: ${escapeHtml(err.message || String(err))}</div>`;
        }
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Oluştur'; }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Admin (admin-only)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCreateCustomer(e) {
    e.preventDefault();
    const email = document.getElementById('customer-email').value.trim();
    const studioName = document.getElementById('customer-studio').value.trim();
    const tier = document.getElementById('customer-tier').value;

    const resultDiv = document.getElementById('new-customer-result');
    if (resultDiv) resultDiv.innerHTML = '<div class="empty">Oluşturuluyor...</div>';

    try {
        const fn = httpsCallable(functions, 'createCustomer');
        const result = await fn({ email, studioName, displayName: studioName, tier });
        const data = result.data || {};
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="success-box" style="margin-top: 16px;">
                    <h4>✅ Müşteri oluşturuldu</h4>
                    <div class="kv">
                        <div class="kv-row"><span class="kv-key">Email</span><code class="kv-val">${escapeHtml(data.email)}</code></div>
                        <div class="kv-row"><span class="kv-key">UID</span><code class="kv-val">${escapeHtml(data.uid)}</code></div>
                        ${data.tempPassword ? `<div class="kv-row"><span class="kv-key">Geçici Şifre</span><code class="kv-val">${escapeHtml(data.tempPassword)}</code></div>` : ''}
                        ${data.resetLink ? `<div class="kv-row"><span class="kv-key">Reset Link</span><code class="kv-val" style="word-break: break-all;">${escapeHtml(data.resetLink)}</code></div>` : ''}
                    </div>
                    <p style="margin-top: 12px; color: var(--muted);">Bu bilgileri müşteriye email ile gönder. (Otomatik email Phase 3'te eklenir.)</p>
                </div>
            `;
        }
        e.target.reset();
    } catch (err) {
        if (resultDiv) {
            resultDiv.innerHTML = `<div class="error-box">Hata: ${escapeHtml(err.message || String(err))}</div>`;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal helper
// ─────────────────────────────────────────────────────────────────────────────

function showModal(innerHtml) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-card">${innerHtml}</div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
        if (e.target?.dataset?.modalClose !== undefined) closeModal();
    });

    document.addEventListener('keydown', escListener);
}

function closeModal() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    document.removeEventListener('keydown', escListener);
}

function escListener(e) {
    if (e.key === 'Escape') closeModal();
}

// ─────────────────────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}
