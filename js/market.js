// =============================================================================
// market.js — Pazar Analizi sekmesi: canli Play Store rakip + yorum verisi
// -----------------------------------------------------------------------------
// fetchMarketIntel Cloud Function'ini cagirir, sonucu Firestore'dan okur,
// rakip kartlarini dinamik render eder.
// =============================================================================

import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { collection, getDocs, query, orderBy, limit, doc, getDoc }
    from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db, functions } from "/js/firebase-config.js";

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById('market-refresh-btn');
    if (btn) btn.addEventListener('click', handleRefresh);

    // Sekme acildiginda mevcut cache'i hemen goster
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.getAttribute('data-tab') === 'market') {
                loadCachedMarketData();
            }
        });
    });
});

async function handleRefresh() {
    const btn = document.getElementById('market-refresh-btn');
    const status = document.getElementById('market-status');
    const gameType = document.getElementById('market-gametype').value;
    const country = document.getElementById('market-country').value;

    if (!btn || !status) return;

    btn.disabled = true;
    btn.textContent = '⏳ Çekiliyor...';
    status.innerHTML = `<span style="color: var(--accent);">Play Store'dan ${gameType} kategorisi (${country}) çekiliyor... 30-60sn sürebilir.</span>`;

    try {
        const fn = httpsCallable(functions, 'fetchMarketIntel');
        const result = await fn({ gameType, country, topN: 10 });
        const data = result.data || {};
        renderCompetitors(data.competitors || []);
        const updatedAt = new Date().toLocaleString('tr-TR');
        status.innerHTML = `<span style="color: #5dd9a0;">✅ ${data.competitorCount || 0} rakip çekildi · ${updatedAt}</span>`;
        // Fallback markup'ı kapat
        const fb = document.getElementById('competitor-grid-fallback');
        if (fb) fb.style.display = 'none';
    } catch (err) {
        const msg = err?.message || String(err);
        status.innerHTML = `<span style="color: #ff8b8b;">Hata: ${escapeHtml(msg)}</span>`;
    } finally {
        btn.disabled = false;
        btn.textContent = '↻ Yenile';
    }
}

async function loadCachedMarketData() {
    const gameType = document.getElementById('market-gametype')?.value || 'puzzle';
    const country = document.getElementById('market-country')?.value || 'tr';
    const collectionId = `${gameType}-${country}`;

    try {
        const metaSnap = await getDoc(doc(db, 'market_intel', collectionId));
        if (!metaSnap.exists()) return;

        const compRef = collection(db, 'market_intel', collectionId, 'competitors');
        const snap = await getDocs(query(compRef, orderBy('minInstalls', 'desc'), limit(20)));
        const competitors = snap.docs.map(d => d.data());
        if (competitors.length === 0) return;

        renderCompetitors(competitors);
        const status = document.getElementById('market-status');
        const meta = metaSnap.data();
        const updatedAt = meta.updatedAt?.toDate
            ? meta.updatedAt.toDate().toLocaleString('tr-TR')
            : 'bilinmiyor';
        if (status) {
            status.innerHTML = `<span style="color: var(--muted);">Cache: ${competitors.length} rakip · son güncelleme ${updatedAt}</span>`;
        }
        const fb = document.getElementById('competitor-grid-fallback');
        if (fb) fb.style.display = 'none';
    } catch (err) {
        console.warn('[market] cache yüklenemedi', err);
    }
}

function renderCompetitors(competitors) {
    const grid = document.getElementById('competitor-grid-live');
    if (!grid) return;
    grid.innerHTML = '';

    competitors.forEach(c => {
        const card = document.createElement('div');
        card.className = 'comp-card';
        card.innerHTML = `
            ${c.icon ? `<img src="${escapeAttr(c.icon)}" alt="" style="width: 48px; height: 48px; border-radius: 10px; float: right; margin: -4px -4px 8px 8px;">` : ''}
            <div class="comp-name">${escapeHtml(c.title || c.appId)}</div>
            <div class="comp-genre">${escapeHtml(c.developer || '—')} · ${escapeHtml(c.genre || '')}</div>
            <div class="comp-stats" style="margin-top: 8px;">
                <div class="comp-stat"><div class="v mono">${c.score ? c.score.toFixed(1) : '—'}</div><div class="l">Rating</div></div>
                <div class="comp-stat"><div class="v mono">${formatInstalls(c.minInstalls || 0)}</div><div class="l">Install</div></div>
                <div class="comp-stat"><div class="v mono">${c.offersIAP ? '$$' : (c.adSupported ? 'Ads' : '—')}</div><div class="l">Monet.</div></div>
            </div>
            ${renderReviews(c.topReviews)}
            ${c.url ? `<a href="${escapeAttr(c.url)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;font-size:0.78rem;color:var(--accent);">Play Store →</a>` : ''}
        `;
        grid.appendChild(card);
    });
}

function renderReviews(reviews) {
    if (!Array.isArray(reviews) || reviews.length === 0) return '';
    const top = reviews.slice(0, 2);
    return `
        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);">
            <div style="font-size: 0.74rem; color: var(--muted); margin-bottom: 6px;">Top yorumlar:</div>
            ${top.map(r => `
                <div style="font-size: 0.78rem; color: var(--fg, #fff); margin-bottom: 6px; line-height: 1.4;">
                    <span style="color: #fbbf24;">${'★'.repeat(Math.round(r.score || 0))}</span>
                    <span style="color: var(--muted);">·</span>
                    ${escapeHtml((r.text || '').slice(0, 140))}${r.text && r.text.length > 140 ? '…' : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function formatInstalls(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B+';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + 'M+';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K+';
    return String(n);
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

function escapeAttr(s) {
    return escapeHtml(s);
}
