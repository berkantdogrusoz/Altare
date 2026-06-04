// =============================================================================
// concepts.js — Roadmap Önerileri sekmesi: AI Market Strategist
// -----------------------------------------------------------------------------
// generateGameConcepts Cloud Function'unu cagirir, gercek Play Store rakip +
// yorum verisinden 3 yeni oyun konsepti uretir, panel'de render eder.
// =============================================================================

import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db, functions, auth } from "/js/firebase-config.js";
import { getLanguage } from "/js/i18n.js";

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("concept-generate-btn");
    // Buton her zaman taze uretim ister; cache sadece sekme acilirken gosterilir.
    if (btn) btn.addEventListener("click", () => handleGenerate(true));

    // Sekme acildiginda cache'i hemen goster
    document.querySelectorAll(".nav-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            if (tab.getAttribute("data-tab") === "roadmap") {
                loadCachedConcepts();
            }
        });
    });
});

async function handleGenerate(forceRefresh) {
    const btn = document.getElementById("concept-generate-btn");
    const status = document.getElementById("concept-status");
    const gameType = document.getElementById("concept-gametype")?.value || "puzzle";
    const country = document.getElementById("concept-country")?.value || "tr";

    if (!btn || !status) return;

    btn.disabled = true;
    btn.textContent = "🧠 Üretiliyor…";
    status.innerHTML = `<span style="color: var(--accent);">AI ${gameType}/${country} pazarından konsept üretiyor… 30-60sn sürebilir.</span>`;

    try {
        const fn = httpsCallable(functions, "generateGameConcepts", { timeout: 180000 });
        const result = await fn({ gameType, country, forceRefresh, language: getLanguage() });
        const data = result.data || {};
        renderConcepts(data);
        const src = data.source === "cache" ? `Cache (${data.ageHours}sa önce)` : "Canlı üretim";
        status.innerHTML = `<span style="color: #5dd9a0;">✅ ${src} · ${data.competitorCount || 0} rakip analiz edildi</span>`;
    } catch (err) {
        const msg = err?.message || String(err);
        const code = (err?.code || "").replace(/^functions\//, "");
        const fullMsg = code === "failed-precondition"
            ? msg + " (Pazar Analizi sekmesinden Yenile bas önce)"
            : msg;
        status.innerHTML = `<span style="color: #ff8b8b;">Hata: ${escapeHtml(fullMsg)}</span>`;
        console.error("[concepts] generate failed", err);
    } finally {
        btn.disabled = false;
        btn.textContent = "⚡ Konsept Üret";
    }
}

async function loadCachedConcepts() {
    const user = auth.currentUser;
    if (!user) return;
    const gameType = document.getElementById("concept-gametype")?.value || "puzzle";
    const country = document.getElementById("concept-country")?.value || "tr";
    const cacheKey = `${user.uid}_${gameType}-${country}-${getLanguage()}`;

    try {
        const snap = await getDoc(doc(db, "game_concepts", cacheKey));
        if (!snap.exists()) return;
        const data = snap.data();
        if (!data.concepts) return;
        const ageMs = Date.now() - (data.cachedAt?.toMillis?.() || 0);
        const ageHours = Math.round(ageMs / 3600e3);
        renderConcepts({
            report: data.concepts,
            competitorCount: data.competitorCount || 0,
            source: "cache",
            ageHours,
        });
        const status = document.getElementById("concept-status");
        if (status) {
            status.innerHTML = `<span style="color: var(--muted);">Cache: ${data.competitorCount || 0} rakip · ${ageHours}sa önce üretildi</span>`;
        }
    } catch (err) {
        console.warn("[concepts] cache yuklenemedi", err);
    }
}

function renderConcepts(data) {
    const report = data.report || {};
    const overviewEl = document.getElementById("concept-market-overview");
    const listEl = document.getElementById("concept-list");
    const nextEl = document.getElementById("concept-next-steps");

    // Claude JSON parse fail durumunda { raw: "..." } gelir — kullaniciya goster
    if (report.raw && !report.concepts) {
        if (overviewEl) overviewEl.innerHTML = "";
        if (nextEl) nextEl.innerHTML = "";
        if (listEl) {
            listEl.innerHTML = `
                <div class="ai-report" style="border-left:3px solid #fbbf24;">
                    <h4>⚠️ AI cevabı JSON formatında değil</h4>
                    <p style="color:var(--muted);">Claude beklenen şemayı döndürmedi (büyük ihtimalle token limitinde kesildi veya markdown sardı). Aşağıda ham yanıt:</p>
                    <pre style="background:rgba(0,0,0,0.4);padding:12px;border-radius:6px;font-size:0.78rem;overflow:auto;max-height:400px;white-space:pre-wrap;">${escapeHtml(report.raw)}</pre>
                    <p style="font-size:0.82rem;margin-top:10px;">"⚡ Konsept Üret" butonuna bir daha bas — yeni deneme yapılır.</p>
                </div>
            `;
        }
        return;
    }

    if (overviewEl) overviewEl.innerHTML = renderOverview(report.market_overview);
    if (listEl) listEl.innerHTML = renderConceptList(report.concepts || []);
    if (nextEl) nextEl.innerHTML = renderNextSteps(report.next_steps);
}

function renderOverview(overview) {
    if (!overview) return "";
    const sat = overview.saturation || "—";
    const satColor = {
        low: "#5dd9a0", medium: "#fbbf24", high: "#fb923c", saturated: "#ef4444",
    }[sat] || "var(--muted)";
    const complaints = Array.isArray(overview.top_complaint_patterns) ? overview.top_complaint_patterns : [];
    const trends = Array.isArray(overview.top_trend_signals) ? overview.top_trend_signals : [];

    return `
        <div class="ai-report" style="margin-bottom: 14px;">
            <h4>📊 Pazar Genel Görünümü <span class="badge" style="background:${satColor};color:#000;margin-left:8px;">${escapeHtml(sat).toUpperCase()}</span></h4>
            <p>${escapeHtml(overview.saturation_note || "")}</p>
            ${complaints.length ? `
                <div style="margin-top: 12px;">
                    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;">Tekrarlayan Şikayetler</div>
                    ${complaints.map((c) => `
                        <div style="padding:8px 10px;background:rgba(239,68,68,0.08);border-left:2px solid #ef4444;margin-bottom:6px;border-radius:4px;">
                            <div style="font-weight:600;font-size:0.86rem;">${escapeHtml(c.pattern || "")} <span style="color:var(--muted);font-weight:400;">· ${escapeHtml(c.frequency_estimate || "")}</span></div>
                            ${c.sample_quote ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:3px;font-style:italic;">"${escapeHtml(c.sample_quote)}"</div>` : ""}
                        </div>
                    `).join("")}
                </div>
            ` : ""}
            ${trends.length ? `
                <div style="margin-top: 12px;">
                    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;">Trend Sinyalleri</div>
                    ${trends.map((t) => `
                        <div style="padding:8px 10px;background:rgba(74,222,128,0.08);border-left:2px solid #4ade80;margin-bottom:6px;border-radius:4px;">
                            <div style="font-weight:600;font-size:0.86rem;">${escapeHtml(t.signal || "")}</div>
                            <div style="font-size:0.78rem;color:var(--muted);margin-top:3px;">${escapeHtml(t.evidence || "")}</div>
                        </div>
                    `).join("")}
                </div>
            ` : ""}
        </div>
    `;
}

function renderConceptList(concepts) {
    if (!Array.isArray(concepts) || concepts.length === 0) {
        return `<div class="ai-report"><p style="color:var(--muted);">Henüz konsept yok. "Konsept Üret" basın.</p></div>`;
    }
    return concepts.map((c, i) => renderConceptCard(c, i + 1)).join("");
}

function renderConceptCard(c, idx) {
    const impactBadge = badge(c.impact, {
        high: "high", medium: "medium", low: "low",
    });
    const effortBadge = c.effort ? `<span class="badge ${c.effort === "low" ? "low" : c.effort === "high" ? "high" : "medium"}" style="margin-left:6px;">Effort: ${escapeHtml(c.effort)}</span>` : "";
    const confidenceBadge = c.confidence ? `<span class="badge" style="margin-left:6px;background:rgba(34,211,238,0.15);color:#22d3ee;">Confidence: ${escapeHtml(c.confidence)}</span>` : "";

    const mechanics = Array.isArray(c.mechanics) ? c.mechanics : [];
    const benchmarks = Array.isArray(c.competitor_benchmark) ? c.competitor_benchmark : [];
    const monet = c.monetization || {};

    return `
        <div class="ai-report" style="margin-bottom: 14px; border-left: 3px solid ${idx === 1 ? "#4ade80" : idx === 2 ? "#fbbf24" : "#22d3ee"};">
            <h4>
                Konsept ${idx} · ${escapeHtml(c.title || "—")}
                ${impactBadge}${effortBadge}${confidenceBadge}
            </h4>
            ${c.tagline ? `<div style="font-size:0.88rem;color:var(--muted);font-style:italic;margin-bottom:8px;">"${escapeHtml(c.tagline)}"</div>` : ""}
            <p><strong>Tür:</strong> ${escapeHtml(c.genre || "—")} · <strong>Hedef:</strong> ${escapeHtml(c.target_audience || "—")}</p>
            <p><strong>Hook:</strong> ${escapeHtml(c.hook || "—")}</p>

            <div style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.03);border-radius:6px;">
                <div style="font-size:0.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Core Loop</div>
                <div style="font-size:0.88rem;line-height:1.5;">${escapeHtml(c.core_loop || "—")}</div>
            </div>

            ${mechanics.length ? `
                <div style="margin-top:10px;">
                    <div style="font-size:0.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Mekanikler</div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        ${mechanics.map((m) => `<span class="tag">${escapeHtml(m)}</span>`).join("")}
                    </div>
                </div>
            ` : ""}

            <div style="margin-top:10px;padding:10px;background:rgba(34,211,238,0.06);border-left:2px solid #22d3ee;border-radius:4px;">
                <div style="font-size:0.76rem;color:#22d3ee;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">İlerleyiş Yapısı</div>
                <div style="font-size:0.86rem;line-height:1.5;">${escapeHtml(c.progression || "—")}</div>
            </div>

            ${monet.primary || monet.secondary ? `
                <div style="margin-top:10px;padding:10px;background:rgba(74,222,128,0.06);border-left:2px solid #4ade80;border-radius:4px;">
                    <div style="font-size:0.76rem;color:#4ade80;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Monetizasyon</div>
                    <div style="font-size:0.86rem;line-height:1.5;">
                        <strong>Birincil:</strong> ${escapeHtml(monet.primary || "—")}<br>
                        ${monet.secondary ? `<strong>İkincil:</strong> ${escapeHtml(monet.secondary)}<br>` : ""}
                        ${monet.rationale ? `<span style="color:var(--muted);font-size:0.82rem;">${escapeHtml(monet.rationale)}</span>` : ""}
                    </div>
                </div>
            ` : ""}

            <div style="margin-top:10px;padding:10px;background:rgba(251,191,36,0.06);border-left:2px solid #fbbf24;border-radius:4px;">
                <div style="font-size:0.76rem;color:#fbbf24;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">🎯 Farklılaşma</div>
                <div style="font-size:0.86rem;line-height:1.5;">${escapeHtml(c.differentiation || "—")}</div>
            </div>

            ${c.market_signal ? `
                <div class="quote" style="margin-top:10px;">
                    <strong>Pazar sinyali:</strong> ${escapeHtml(c.market_signal)}
                </div>
            ` : ""}

            ${benchmarks.length ? `
                <div style="margin-top:10px;">
                    <div style="font-size:0.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Rakip Benchmark</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
                        ${benchmarks.map((b) => `
                            <div style="padding:8px;background:rgba(0,0,0,0.25);border-radius:6px;">
                                <div style="font-weight:600;font-size:0.84rem;">${escapeHtml(b.app || "—")}</div>
                                <div style="font-size:0.78rem;color:var(--muted);">⭐ ${b.rating != null ? Number(b.rating).toFixed(1) : "—"} · ${escapeHtml(b.install || "—")}</div>
                                ${b.lesson ? `<div style="font-size:0.76rem;margin-top:4px;line-height:1.4;">${escapeHtml(b.lesson)}</div>` : ""}
                            </div>
                        `).join("")}
                    </div>
                </div>
            ` : ""}

            <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:0.82rem;">
                ${c.effort_estimate ? `<div><span style="color:var(--muted);">📅 Süre:</span> ${escapeHtml(c.effort_estimate)}</div>` : ""}
                ${c.engine_reuse ? `<div><span style="color:var(--muted);">⚙️ Engine reuse:</span> ${escapeHtml(c.engine_reuse)}</div>` : ""}
                ${c.risk ? `<div><span style="color:var(--muted);">⚠️ Risk:</span> ${escapeHtml(c.risk)}</div>` : ""}
            </div>
        </div>
    `;
}

function renderNextSteps(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return "";
    return `
        <div class="ai-report" style="margin-top: 14px;">
            <h4>🚀 Sıradaki Adımlar</h4>
            <ol style="margin:0;padding-left:20px;line-height:1.7;">
                ${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
            </ol>
        </div>
    `;
}

function badge(impact, map) {
    const lvl = (impact || "").toLowerCase();
    const cls = map[lvl] || "medium";
    if (!impact) return "";
    return `<span class="badge ${cls}" style="margin-left:8px;">Impact: ${escapeHtml(impact)}</span>`;
}

function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
}
