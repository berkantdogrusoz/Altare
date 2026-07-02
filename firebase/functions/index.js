/**
 * Altare AI Live Game Intelligence — Cloud Functions
 *
 * Functions:
 *   - generateAIReport (callable, admin-only)
 *       Reads recent events from Firestore, calls Anthropic Claude, persists
 *       the structured report into games/{gameId}/ai_reports.
 *
 *   - aggregateDailyStats (scheduled, every 30 min)
 *       Rolls up the last 24h of events per game into games/{gameId}/stats/{day}.
 *
 *   - fetchAnalyticsOverview (callable, admin-only)
 *       Queries GA4 Data API for realtime users, DAU/WAU/MAU, engagement, countries.
 *
 *   - setAdminRole (callable, admin-only — bootstrap via console first)
 *       Toggles a custom auth claim {admin: true} for a target uid and mirrors
 *       the row into /users/{uid}. Allowlist of "panel users".
 *
 * Secrets (set via `firebase functions:secrets:set <NAME>`):
 *   - ANTHROPIC_API_KEY
 *
 * Environment config (firebase functions:config:set or defineString):
 *   - GA4_PROPERTY_ID — Google Analytics 4 property numeric ID (e.g. "123456789")
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
// HARD GUARANTEE: never throw "Cannot use undefined as a Firestore value".
// google-play-scraper and external APIs frequently return undefined for
// optional fields (inAppProductPrice, minInstalls, adSupported, ...).
// Setting this once means every db.set/.add/.update silently drops undefineds.
db.settings({ ignoreUndefinedProperties: true });

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const GA4_PROPERTY_ID = defineString("GA4_PROPERTY_ID", { default: "" });
const ANTHROPIC_MODELS = {
  // Sonnet 4.5 — default, hizli, JSON sema icin mukemmel
  SONNET: "claude-sonnet-4-5",
  // Opus 4.8 — daha pahali (5x) ama causal reasoning + cok adimli plan + risk
  // degerlendirme cok daha iyi. Auto-Heal recetelerinde ve kritik strategy AI'da.
  OPUS:   "claude-opus-4-8",
  // Haiku 4.5 — en ucuz + en hizli, basit kararlar icin (ileri kullanim)
  HAIKU:  "claude-haiku-4-5-20251001",
};
const ANTHROPIC_MODEL = ANTHROPIC_MODELS.SONNET; // genel default (geriye uyum)
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────────

function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
}

function assertSignedIn(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }
}

// Game ownership check: admin can access any game, developer can access only
// games where developerId matches their uid.
async function assertOwnsGameOrAdmin(request, gameId) {
  assertSignedIn(request);
  if (request.auth.token.admin === true) return;
  if (!gameId || typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }
  const snap = await db.collection("games").doc(gameId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Game not found.");
  }
  const data = snap.data();
  if (data.developerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "You don't own this game.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore safety: strip `undefined` recursively so .set()/.add() never throws
// "Cannot use undefined as a Firestore value". Arrays preserve indices, objects
// drop the key entirely. Functions / symbols are dropped too.
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeForFirestore(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  const t = typeof value;
  if (t === "function" || t === "symbol") return null;
  if (t !== "object") return value;
  if (value instanceof Date) return value;
  // Firestore native types (Timestamp, GeoPoint, DocumentReference, FieldValue)
  // expose internal `_delegate`/`_methodName` etc. Treat any object that isn't
  // a plain object/array as opaque and pass it through.
  if (Array.isArray(value)) {
    return value.map(sanitizeForFirestore);
  }
  const proto = Object.getPrototypeOf(value);
  const isPlain = proto === Object.prototype || proto === null;
  if (!isPlain) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = sanitizeForFirestore(v);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI prompts
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_OPS_SYSTEM_PROMPT = `Sen Altare AI motorunun Live-Ops Expert rolusun.
Tek bir mobil oyunun first-party event verilerini analiz edip stüdyo için
**deger odakli** bir live-ops raporu uretiyorsun.

KATI KURALLAR
- Asla genel tavsiye yok. Her oneri verideki bir sayiya/orana referans vermek zorunda.
- Veri yetersizse "Veri yetersiz" yaz, asla uydurma.
- Tum metinler Turkce. JSON anahtarlari Ingilizce sabit (sema).
- Sadece belirtilen JSON nesnesini dondur — once/sonra metin yazma.

VURGU PRENSIBI (BLUF — Bottom Line Up Front)
Raporun en kritik yapisi 'executive_briefing' alani. Stüdyo paneli acar acmaz
"BU HAFTA NE YAPMALIYIM?" sorusunun cevabini buradan goruyor. Bu yuzden:
- headline: 1 cumle, net deger ifadesi (orn: "Level 18'de %47 drop-off, D-3 retention'i %18 dususuyor.")
- value_summary: 1-2 cumle, beklenen ETKI (DAU/retention/ARPDAU/monetization).
- critical_actions: en fazla 3 madde, urgency='critical' veya 'high'. Hepsi BU HAFTA yapilabilir olmali.
- opportunities: 1-2 madde, urgency='medium' veya 'low'. Trend/fırsat yakalama.

Her aksiyonda:
- title: kisa, eylem-fiil ile baslayan (orn: "Level 18'e hint sistemi ekle")
- urgency: "critical" | "high" | "medium" | "low"
- impact: "critical" | "high" | "medium" | "low"  -> beklenen is etkisi
- rationale: VERIDEKI ozel sayilarla destekli (orn: "402sn ort. oturum / 3 fps_warning Samsung S908E'de")
- expected_metric: olcebilecegi sayisal hedef (orn: "D-3 retention +12pp" veya "level_18_completion 53% -> 78%")
- timeline: "bu hafta" | "2 hafta" | "1 ay" | "sonraki sprint"

OUTPUT JSON SHAPE (kati)
{
  "executive_briefing": {
    "headline":      string,
    "value_summary": string,
    "critical_actions": [
      {
        "title": string,
        "urgency": "critical"|"high",
        "impact":  "critical"|"high"|"medium"|"low",
        "rationale": string,
        "expected_metric": string,
        "timeline": string
      }
    ],
    "opportunities": [
      {
        "title": string,
        "urgency": "medium"|"low",
        "impact":  "critical"|"high"|"medium"|"low",
        "rationale": string,
        "expected_metric": string,
        "timeline": string
      }
    ]
  },
  "summary":            string,
  "overall_health":     string,
  "player_behavior":    string,
  "level_difficulty":   string,
  "top_problem_levels": [ { "level": string, "fail_rate": number, "note": string } ],
  "monetization":       string,
  "performance":        string,
  "feedback_summary":   string,
  "pre_marketing_risk": string,
  "immediate_actions":  [ { "title": string, "priority": "critical"|"high"|"medium"|"low", "rationale": string } ],
  "next_update":        string
}`;

// ─────────────────────────────────────────────────────────────────────────────
// GAME_CONCEPT_SYSTEM_PROMPT — yeni oyun fikri uretici (Market Analyst rolu)
// Gercek Play Store rakip + yorum verisinden, indie/midcore studio icin
// 3 spesifik oyun konsepti uretir. Mekanik, ilerleyiş, monetizasyon, risk dahil.
// ─────────────────────────────────────────────────────────────────────────────

const GAME_CONCEPT_SYSTEM_PROMPT = `Sen Altare AI'in Market Strategist rolusun.
Gercek Play Store rakip verisi (top oyunlar, install/rating, en yardimci yorumlar)
ve studio'nun mevcut oyun portfoyu sana verilir. Cikti olarak indie/midcore stuido
icin **3 yeni oyun konsepti** uretirsin.

KATI KURALLAR
- Asla genel tavsiye yok. Her konsept rakip yorumlarindaki bir sikayet kalibina
  VEYA rating/install trendine ozel olarak referans verir (orn:
  "Block Blast yorumlarinin %X'i reklam fazlasindan sikayet -> reduced-ad mode").
- Generik "battle royale yap" gibi cikti yasak. Pazardaki bos koltuga oturt.
- Studio'nun mevcut engine'leri reuse edilebilirse soyle (effort dusurur).
- Tum metinler Turkce. JSON anahtarlari Ingilizce sabit.
- SADECE JSON dondur. Once/sonra metin, markdown fence yazma.

ANALIZ AKISI (zihninde)
1. Top rakiplerin install/rating dagilimina bak -> kategori doygun mu, fragmente mi?
2. En cok yardimci alan yorumlardaki tekrarlayan sikayet kaliplarini cikar
   (reklam, zorluk, monetizasyon, tema, performans, tekrar, vs.).
3. Bu sikayetlerin **her biri bir farklilasma firsati**.
4. Studio engine'lerini dusun: reuse edilebilen mekanikler dusuk efor.
5. 3 konsept: 1 high-impact + risky, 1 medium-impact + safe reuse,
   1 low-effort hizli launch.

OUTPUT JSON SHAPE (kati)
{
  "market_overview": {
    "category": string,
    "country":  string,
    "saturation": "low"|"medium"|"high"|"saturated",
    "saturation_note": string,
    "top_complaint_patterns": [
      { "pattern": string, "frequency_estimate": string, "sample_quote": string }
    ],
    "top_trend_signals": [
      { "signal": string, "evidence": string }
    ]
  },
  "concepts": [
    {
      "title":       string,
      "tagline":     string,
      "genre":       string,
      "hook":        string,
      "core_loop":   string,
      "mechanics":   [string],
      "progression": string,
      "monetization": {
        "primary":   string,
        "secondary": string,
        "rationale": string
      },
      "differentiation":      string,
      "market_signal":        string,
      "competitor_benchmark": [
        { "app": string, "rating": number, "install": string, "lesson": string }
      ],
      "target_audience":   string,
      "effort_estimate":   string,
      "engine_reuse":      string,
      "risk":              string,
      "impact":            "high"|"medium"|"low",
      "effort":            "low"|"medium"|"high",
      "confidence":        "low"|"medium"|"high"
    }
  ],
  "next_steps": [string]
}`;

// ─────────────────────────────────────────────────────────────────────────────
// generateAIReport — callable
// ─────────────────────────────────────────────────────────────────────────────

exports.generateAIReport = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    try {
      const { gameId, gameName, timeRange = "last_24h", language = "tr" } = request.data || {};
      await assertOwnsGameOrAdmin(request, gameId);
      const lang = language === "en" ? "en" : "tr";

      logger.info("generateAIReport start", { gameId, gameName, timeRange, lang, uid: request.auth.uid });

      const windowMs = timeRange === "last_7d" ? 7 * 24 * 3600e3 : 24 * 3600e3;
      const since = admin.firestore.Timestamp.fromMillis(Date.now() - windowMs);

      const summary = await buildSummaryData(gameId, since);
      logger.info("summary built", { gameId, totalEvents: summary.totalEvents });

      if (summary.totalEvents === 0) {
        throw new HttpsError(
          "failed-precondition",
          lang === "en"
            ? "No events from this game in the selected time range. Data flow is required before generating an AI report."
            : "Bu zaman aralığında oyundan hiç event yok. AI raporu üretmek için önce veri akışı gerekli."
        );
      }

      const gameCtx = await getGameContext(gameId);
      const userPrompt = buildUserPrompt(gameId, gameName, timeRange, summary, lang, gameCtx);

      const aiJson = await callAnthropic(
        ANTHROPIC_API_KEY.value(),
        localizeSystemPrompt(LIVE_OPS_SYSTEM_PROMPT, lang),
        userPrompt,
        { maxTokens: 8192 }  // AI Report uzun — 4096 yetmiyor, JSON truncate oluyordu
      );

      logger.info("anthropic ok", { gameId, keys: Object.keys(aiJson || {}).length, hasRaw: !!(aiJson && aiJson.raw) });

      // GUVENLIK AGI: eger hala raw geliyorsa (JSON parse edilemedi), sessizce
      // bozuk kayit yapma — hata dondur. Boylece kullanici "rapor uretilemedi"
      // gorur, raw JSON ekrana basilmaz.
      if (aiJson && aiJson.raw && !aiJson.executive_briefing && !aiJson.summary) {
        logger.error("AI report still raw after prefill+8192 tokens", {
          gameId,
          rawLength: typeof aiJson.raw === "string" ? aiJson.raw.length : null,
          rawSample: typeof aiJson.raw === "string" ? aiJson.raw.slice(0, 300) : String(aiJson.raw).slice(0, 300),
        });
        throw new HttpsError(
          "internal",
          lang === "en"
            ? "AI response could not be parsed as valid JSON. Please try again."
            : "AI yaniti gecerli JSON olarak ayristirilamadi. Lutfen tekrar dene."
        );
      }

      const reportRef = await db
        .collection("games")
        .doc(gameId)
        .collection("ai_reports")
        .add({
          gameId,
          gameName: gameName || gameId,
          timeRange,
          language: lang,
          provider: "anthropic",
          model: ANTHROPIC_MODEL,
          report: aiJson,
          summaryData: summary,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: request.auth.uid,
        });

      logger.info("report saved", { gameId, reportId: reportRef.id });

      return {
        success: true,
        reportId: reportRef.id,
        report: aiJson,
        eventCount: summary.totalEvents,
      };
    } catch (err) {
      // HttpsError'ı olduğu gibi geçir (istemciye dogru mesaj gitsin)
      if (err instanceof HttpsError) {
        logger.warn("generateAIReport HttpsError", { code: err.code, message: err.message });
        throw err;
      }
      // Beklenmedik hatayı detaylı logla, kullanıcıya açıklayıcı mesaj at
      logger.error("generateAIReport unhandled", {
        message: err?.message || String(err),
        stack: err?.stack,
        name: err?.name,
      });
      const detailMsg = (err && err.message) ? err.message : "bilinmeyen hata";
      throw new HttpsError(
        "internal",
        `AI raporu uretilemedi: ${detailMsg}`,
        { reason: err?.name || "Error", detail: detailMsg }
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// aggregateDailyStats — scheduled every 30 min
// ─────────────────────────────────────────────────────────────────────────────

exports.aggregateDailyStats = onSchedule(
  { schedule: "every 30 minutes", timeZone: "Europe/Istanbul" },
  async () => {
    const gamesSnap = await db.collection("games").get();
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600e3);

    const tasks = gamesSnap.docs.map(async (doc) => {
      const gameId = doc.id;
      try {
        const summary = await buildSummaryData(gameId, since);
        const todayKey = new Date().toISOString().slice(0, 10);
        await db
          .collection("games")
          .doc(gameId)
          .collection("stats")
          .doc(todayKey)
          .set(
            { ...summary, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        logger.info("stats updated", { gameId, totalEvents: summary.totalEvents });
      } catch (err) {
        logger.error("stats failed", { gameId, error: err.message });
      }
    });

    await Promise.all(tasks);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-TENANT BENCHMARK AGGREGATOR — network effect moat
// Tum oyunlarin verisini (anonim) toplar, kategori bazli sektorel benchmark
// hesaplar. Cikti industry_benchmarks/{gameType}/{day}.
// Hicbir oyunun verisi kimliklendirilebilir degil — sadece quantile metrikler.
// ─────────────────────────────────────────────────────────────────────────────

exports.aggregateIndustryBenchmark = onSchedule(
  { schedule: "every 6 hours", timeZone: "Europe/Istanbul" },
  async () => {
    const gamesSnap = await db.collection("games").get();
    const todayKey = new Date().toISOString().slice(0, 10);

    // Group games by type
    const byType = {};
    for (const gameDoc of gamesSnap.docs) {
      const g = gameDoc.data();
      const type = g.gameType || "unknown";
      if (!byType[type]) byType[type] = [];
      byType[type].push(g.gameId || gameDoc.id);
    }

    function quantile(arr, q) {
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * q);
      return sorted[Math.min(idx, sorted.length - 1)];
    }
    function avg(arr) {
      if (!arr.length) return null;
      return arr.reduce((s, x) => s + x, 0) / arr.length;
    }

    for (const [gameType, gameIds] of Object.entries(byType)) {
      if (gameIds.length < 3) {
        // Privacy: need at least 3 games per category to anonymize
        logger.info("skipping benchmark — too few games", { gameType, count: gameIds.length });
        continue;
      }

      // Pull each game's latest daily stats (last 7 days avg)
      const metrics = {
        avgSessionSeconds: [],
        failRates: [],
        crashRates: [],
        fpsWarnRates: [],
        adsPerSession: [],
        iapRevenuePerPlayer: [],
        retentionD1Proxy: [], // uniquePlayers / uniqueSessions as a weak proxy
      };

      for (const gameId of gameIds) {
        try {
          const statsSnap = await db.collection("games").doc(gameId)
            .collection("stats").orderBy("updatedAt", "desc").limit(7).get();
          if (statsSnap.empty) continue;
          for (const s of statsSnap.docs) {
            const d = s.data();
            if (d.uniqueSessions > 5) {
              if (Number.isFinite(d.avgSessionSeconds) && d.avgSessionSeconds > 0)
                metrics.avgSessionSeconds.push(d.avgSessionSeconds);
              const fails = (d.eventCounts && d.eventCounts.level_fail) || 0;
              const completes = (d.eventCounts && d.eventCounts.level_complete) || 0;
              if (fails + completes >= 10) metrics.failRates.push(fails / (fails + completes));
              if (d.uniqueSessions > 0) {
                metrics.crashRates.push((d.crashes || 0) / d.uniqueSessions);
                metrics.fpsWarnRates.push((d.fpsWarnings || 0) / d.uniqueSessions);
                metrics.adsPerSession.push(
                  ((d.adWatches || 0) + (d.rewardedAdWatches || 0)) / d.uniqueSessions
                );
              }
              if (d.uniquePlayers > 0) {
                metrics.iapRevenuePerPlayer.push((d.purchaseRevenueUsd || 0) / d.uniquePlayers);
                if (d.uniqueSessions > 0) {
                  metrics.retentionD1Proxy.push(d.uniqueSessions / d.uniquePlayers);
                }
              }
            }
          }
        } catch (e) {
          logger.warn("benchmark fetch failed", { gameId, error: e.message });
        }
      }

      const benchmark = {
        gameType,
        gameCount: gameIds.length,
        sampleSize: metrics.avgSessionSeconds.length,
        avgSessionSeconds: {
          median: quantile(metrics.avgSessionSeconds, 0.5),
          top10: quantile(metrics.avgSessionSeconds, 0.9),
          avg: avg(metrics.avgSessionSeconds),
        },
        levelFailRate: {
          median: quantile(metrics.failRates, 0.5),
          top10: quantile(metrics.failRates, 0.1), // lower fail rate is better
          avg: avg(metrics.failRates),
        },
        crashRate: {
          median: quantile(metrics.crashRates, 0.5),
          top10: quantile(metrics.crashRates, 0.1), // lower is better
          avg: avg(metrics.crashRates),
        },
        fpsWarnRate: {
          median: quantile(metrics.fpsWarnRates, 0.5),
          top10: quantile(metrics.fpsWarnRates, 0.1),
          avg: avg(metrics.fpsWarnRates),
        },
        adsPerSession: {
          median: quantile(metrics.adsPerSession, 0.5),
          top10: quantile(metrics.adsPerSession, 0.9),
          avg: avg(metrics.adsPerSession),
        },
        iapRevenuePerPlayer: {
          median: quantile(metrics.iapRevenuePerPlayer, 0.5),
          top10: quantile(metrics.iapRevenuePerPlayer, 0.9),
          avg: avg(metrics.iapRevenuePerPlayer),
        },
        sessionsPerPlayer: {
          median: quantile(metrics.retentionD1Proxy, 0.5),
          top10: quantile(metrics.retentionD1Proxy, 0.9),
          avg: avg(metrics.retentionD1Proxy),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection("industry_benchmarks").doc(gameType)
        .collection("daily").doc(todayKey).set(benchmark);
      await db.collection("industry_benchmarks").doc(gameType).set({
        latestKey: todayKey,
        latest: benchmark,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info("industry benchmark updated", { gameType, sample: benchmark.sampleSize });
    }
  }
);

// Callable: kullanici kendi gameType'inin industry benchmark'ini cekebilir
exports.getIndustryBenchmark = onCall(async (request) => {
  assertSignedIn(request);
  const { gameId } = request.data || {};
  if (!gameId) throw new HttpsError("invalid-argument", "gameId required");
  await assertOwnsGameOrAdmin(request, gameId);

  const gameSnap = await db.collection("games").doc(gameId).get();
  if (!gameSnap.exists) throw new HttpsError("not-found", "Game not found");
  const gameType = gameSnap.data().gameType || "unknown";

  const benchSnap = await db.collection("industry_benchmarks").doc(gameType).get();
  if (!benchSnap.exists) {
    return {
      success: false,
      reason: "not_enough_data",
      message: "Yeterli oyun sayısı yok (min 3). Bu kategori için sektörel benchmark henüz hazır değil.",
      gameType,
    };
  }
  return { success: true, gameType, ...benchSnap.data() };
});

// ─────────────────────────────────────────────────────────────────────────────
// detectAnomalies — scheduled every 30 min
// Altare Sentinel: oyunculari 7/24 izler, anomali tespit ederse uyari atar.
// Uyarilar games/{gameId}/alerts altina yazilir, panel'de Uyarilar sekmesinde
// gosterilir + okunmamis sayisi bildirim olarak akar.
// ─────────────────────────────────────────────────────────────────────────────

const ANOMALY_RULES = [
  {
    id: "crash_spike",
    severity: "critical",
    title_tr: "Crash patlamasi tespit edildi",
    title_en: "Crash spike detected",
    check: (now, baseline) => {
      if (now.crashes < 5) return null;
      const baseRate = baseline.crashes / Math.max(baseline.uniqueSessions, 1);
      const nowRate = now.crashes / Math.max(now.uniqueSessions, 1);
      if (baseRate > 0 && nowRate > baseRate * 3) {
        return {
          metric: "crashes",
          delta_pct: Math.round((nowRate / baseRate - 1) * 100),
          rationale_tr: `Crash orani son aralikta %${Math.round(nowRate * 100)} (baseline %${Math.round(baseRate * 100)})`,
          rationale_en: `Crash rate spiked to ${Math.round(nowRate * 100)}% (baseline ${Math.round(baseRate * 100)}%)`,
        };
      }
      return null;
    },
  },
  {
    id: "dau_drop",
    severity: "high",
    title_tr: "DAU son 14 gun dibinde",
    title_en: "DAU at 14-day low",
    check: (now, baseline) => {
      if (baseline.uniquePlayers < 10) return null;
      const drop = (baseline.uniquePlayers - now.uniquePlayers) / baseline.uniquePlayers;
      if (drop > 0.4) {
        return {
          metric: "uniquePlayers",
          delta_pct: -Math.round(drop * 100),
          rationale_tr: `Aktif oyuncu ${baseline.uniquePlayers} -> ${now.uniquePlayers} (%${Math.round(drop * 100)} dusus)`,
          rationale_en: `Active players ${baseline.uniquePlayers} -> ${now.uniquePlayers} (${Math.round(drop * 100)}% drop)`,
        };
      }
      return null;
    },
  },
  {
    id: "fps_degradation",
    severity: "high",
    title_tr: "Performans bozulmasi",
    title_en: "Performance degradation",
    check: (now, baseline) => {
      const fpsRate = now.fpsWarnings / Math.max(now.uniqueSessions, 1);
      const baseFpsRate = baseline.fpsWarnings / Math.max(baseline.uniqueSessions, 1);
      if (now.fpsWarnings < 20) return null;
      if (baseFpsRate > 0 && fpsRate > baseFpsRate * 2) {
        return {
          metric: "fpsWarnings",
          delta_pct: Math.round((fpsRate / baseFpsRate - 1) * 100),
          rationale_tr: `FPS uyarilari oturum basina ${baseFpsRate.toFixed(1)} -> ${fpsRate.toFixed(1)}`,
          rationale_en: `FPS warnings per session ${baseFpsRate.toFixed(1)} -> ${fpsRate.toFixed(1)}`,
        };
      }
      return null;
    },
  },
  {
    id: "session_length_drop",
    severity: "medium",
    title_tr: "Ortalama oturum suresi dusuyor",
    title_en: "Average session length dropping",
    check: (now, baseline) => {
      if (now.avgSessionSeconds < 30 || baseline.avgSessionSeconds < 30) return null;
      const drop = (baseline.avgSessionSeconds - now.avgSessionSeconds) / baseline.avgSessionSeconds;
      if (drop > 0.3) {
        return {
          metric: "avgSessionSeconds",
          delta_pct: -Math.round(drop * 100),
          rationale_tr: `Ort. oturum ${baseline.avgSessionSeconds}sn -> ${now.avgSessionSeconds}sn (%${Math.round(drop * 100)} dusus)`,
          rationale_en: `Avg. session ${baseline.avgSessionSeconds}s -> ${now.avgSessionSeconds}s (${Math.round(drop * 100)}% drop)`,
        };
      }
      return null;
    },
  },
  {
    id: "whale_detected",
    severity: "info",
    title_tr: "Whale tespit edildi",
    title_en: "Whale player detected",
    check: (now, baseline) => {
      if (now.purchaseRevenueUsd >= 50 && now.purchases <= 5) {
        return {
          metric: "purchaseRevenueUsd",
          delta_pct: null,
          rationale_tr: `Tek aralikta $${now.purchaseRevenueUsd.toFixed(2)} gelir, sadece ${now.purchases} satin alma — whale aday adayi`,
          rationale_en: `$${now.purchaseRevenueUsd.toFixed(2)} revenue from only ${now.purchases} purchases — likely whale`,
        };
      }
      return null;
    },
  },
  {
    id: "first_revenue",
    severity: "info",
    title_tr: "Ilk gelir tespit edildi",
    title_en: "First revenue detected",
    check: (now, baseline) => {
      if (baseline.purchaseRevenueUsd === 0 && now.purchaseRevenueUsd > 0) {
        return {
          metric: "purchaseRevenueUsd",
          delta_pct: null,
          rationale_tr: `Oyununuz ilk kez para kazandi: $${now.purchaseRevenueUsd.toFixed(2)} (${now.purchases} satin alma)`,
          rationale_en: `Your game just made its first money: $${now.purchaseRevenueUsd.toFixed(2)} (${now.purchases} purchases)`,
        };
      }
      return null;
    },
  },
  // Umut Can'in onerisi: ANR spike (Android Not Responding)
  {
    id: "anr_spike",
    severity: "critical",
    title_tr: "ANR (uygulama yaniti yok) patlamasi",
    title_en: "ANR spike detected",
    check: (now, baseline) => {
      if (now.anrs < 3) return null;
      const baseRate = (baseline.anrs || 0) / Math.max(baseline.uniqueSessions, 1);
      const nowRate = now.anrs / Math.max(now.uniqueSessions, 1);
      if (nowRate > Math.max(baseRate * 3, 0.02)) {
        return {
          metric: "anrs",
          delta_pct: baseRate > 0 ? Math.round((nowRate / baseRate - 1) * 100) : null,
          rationale_tr: `Son aralikta ${now.anrs} ANR (oturum basina %${(nowRate*100).toFixed(2)}). Genelde alt seviye cihaz veya thread blocking sebep.`,
          rationale_en: `${now.anrs} ANRs in window (per session: ${(nowRate*100).toFixed(2)}%). Usually low-end device or thread blocking.`,
        };
      }
      return null;
    },
  },
  // Umut Can'in onerisi: Memory pressure (low memory cihazlarda)
  {
    id: "memory_pressure",
    severity: "high",
    title_tr: "Bellek baskisi tespit edildi",
    title_en: "Memory pressure detected",
    check: (now, baseline) => {
      const memWarn = now.memoryWarnings || 0;
      if (memWarn < 10) return null;
      const baseRate = (baseline.memoryWarnings || 0) / Math.max(baseline.uniqueSessions, 1);
      const nowRate = memWarn / Math.max(now.uniqueSessions, 1);
      if (nowRate > Math.max(baseRate * 2, 0.05)) {
        return {
          metric: "memoryWarnings",
          delta_pct: baseRate > 0 ? Math.round((nowRate / baseRate - 1) * 100) : null,
          rationale_tr: `${memWarn} bellek uyarisi (oturum basina ${(nowRate).toFixed(2)}). Alt seviye RAM'li cihazlar etkileniyor olabilir.`,
          rationale_en: `${memWarn} memory warnings (${(nowRate).toFixed(2)} per session). Low-RAM devices likely affected.`,
        };
      }
      return null;
    },
  },
  // GPU-specific anomaly — Umut Can: "Adreno vs Mali vs PowerVR farkli davranis"
  {
    id: "gpu_family_crash",
    severity: "high",
    title_tr: "Belirli GPU ailesinde crash yogunlugu",
    title_en: "GPU-family crash concentration",
    check: (now, baseline) => {
      if (!Array.isArray(now.gpuBreakdown) || now.gpuBreakdown.length < 2) return null;
      // Bir GPU ailesinde crash yogunluğu varsa tetikle
      for (const g of now.gpuBreakdown) {
        if (g.count < 20) continue;
        const crashRate = g.crashes / g.count;
        if (g.crashes >= 5 && crashRate > 0.05) {
          return {
            metric: "gpuCrash",
            delta_pct: null,
            rationale_tr: `${g.family} GPU'lu cihazlarda %${(crashRate*100).toFixed(1)} crash orani (${g.crashes}/${g.count} event). Diger GPU ailelerine kiyasla anormal.`,
            rationale_en: `${g.family} GPU devices show ${(crashRate*100).toFixed(1)}% crash rate (${g.crashes}/${g.count} events). Anomalous vs other GPU families.`,
          };
        }
      }
      return null;
    },
  },
];

exports.detectAnomalies = onSchedule(
  { schedule: "every 30 minutes", timeZone: "Europe/Istanbul" },
  async () => {
    const gamesSnap = await db.collection("games").get();

    const tasks = gamesSnap.docs.map(async (gameDoc) => {
      const gameId = gameDoc.id;
      const gameData = gameDoc.data();
      try {
        // Now window: last 2h. Baseline window: previous 7 days (24h chunk).
        const nowSince = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 3600e3);
        const baselineSince = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 3600e3);

        const [nowStats, baselineStats] = await Promise.all([
          buildSummaryData(gameId, nowSince),
          buildSummaryData(gameId, baselineSince),
        ]);

        if (nowStats.totalEvents < 10) {
          // not enough signal
          return;
        }

        for (const rule of ANOMALY_RULES) {
          // Dedupe: same rule fired within last 6h -> skip
          const recentDedupe = await db
            .collection("games").doc(gameId)
            .collection("alerts")
            .where("ruleId", "==", rule.id)
            .where("createdAt", ">", admin.firestore.Timestamp.fromMillis(Date.now() - 6 * 3600e3))
            .limit(1).get();
          if (!recentDedupe.empty) continue;

          const result = rule.check(nowStats, baselineStats);
          if (!result) continue;

          await db.collection("games").doc(gameId).collection("alerts").add({
            gameId,
            gameName: gameData.gameName || gameId,
            ruleId: rule.id,
            severity: rule.severity,
            title_tr: rule.title_tr,
            title_en: rule.title_en,
            ...result,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          logger.info("sentinel alert fired", { gameId, ruleId: rule.id, severity: rule.severity });
        }
      } catch (err) {
        logger.error("anomaly detection failed", { gameId, error: err.message });
      }
    });

    await Promise.all(tasks);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// markAlertRead — callable, kullanici uyariyi okudu olarak isaretler
// ─────────────────────────────────────────────────────────────────────────────

exports.markAlertRead = onCall(async (request) => {
  assertSignedIn(request);
  const { gameId, alertId, read = true } = request.data || {};
  await assertOwnsGameOrAdmin(request, gameId);
  if (!alertId) {
    throw new HttpsError("invalid-argument", "alertId is required.");
  }
  await db.collection("games").doc(gameId).collection("alerts").doc(alertId)
    .set({ read: read === true }, { merge: true });
  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-HEAL: closed-loop AI live-ops
// Sentinel uyarisi tetiklendiginde, AI Doctor causalcause analizi yapip,
// somut Remote Config degisikligi onerir. Kullanici "Uygula" derse degisiklik
// games/{gameId}/config/active doc'una yazilir; oyun anlik okur (rebuild yok).
// Snapshot ile rollback garantili.
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_HEAL_SYSTEM_PROMPT_TR = `Sen Altare AI'in Live-Ops Doctor rolusun.
Bir oyun anomalisini (Sentinel uyarisi) ve oyunun gerçek metriklerini alirsin.
Cikti olarak guvenli, geri alinabilir bir Remote Config recetesi onerirsin.

KATI KURALLAR
- Asla kod degisikligi onerme. Sadece config value (Remote Config) degisikligi.
- Her degisiklik: yeni deger + eski deger + neden + hedef metrik + beklenen etki.
- Risk seviyesi degerlendir: low / medium / high. High ise A/B test zorunlu.
- Eger veri yetersizse "veri_yetersiz: true" donderr, change array bos olsun.
- Tum dogal dil metinleri Turkce. JSON anahtarlari Ingilizce sabit.
- Sadece JSON dondur, oncesinde/sonrasinda metin yok.

NEDEN-SONUC ZINCIRI (zihninde):
1. Hangi metrik bozuldu? Sayisi ne?
2. Bu metrik hangi config key'lerden etkilenir? (level zorlugu, reklam sikligi,
   IAP fiyati, FPS limit, particle count, vb.)
3. Hangi degisiklik bu metrigi en az risk ile iyilestirir?
4. Yan etki nedir? (Level 18'i kolaylastirmak level 19 retention'a etki yapar)
5. Geri alma plani: hangi sinyali gormeyince geri al? (kac saat sonra?)

CONFIG KEY ISIM CONVENTION (musteri bunlari kendi koduyla esler):
- level_{N}_target_score, level_{N}_moves_limit, level_{N}_time_limit
- ad_frequency_interstitial, ad_frequency_rewarded, ad_cooldown_seconds
- iap_starter_discount_pct, iap_currency_inflation_factor
- fps_target, particle_quality_low_end, low_end_device_threshold_mb

OUTPUT JSON SHAPE (kati)
{
  "diagnosis": string,
  "root_cause_hypothesis": string,
  "confidence": "low"|"medium"|"high",
  "risk_level": "low"|"medium"|"high",
  "data_sufficient": boolean,
  "changes": [
    {
      "key": string,
      "current_value": number|string,
      "new_value": number|string,
      "value_type": "int"|"float"|"string"|"bool",
      "rationale": string,
      "target_metric": string,
      "expected_delta": string
    }
  ],
  "side_effects": string,
  "monitor_window_hours": number,
  "success_criteria": string,
  "rollback_trigger": string,
  "ab_test_required": boolean,
  "warnings": [ string ]
}`;

exports.generateAutoHeal = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    try {
      const { gameId, alertId, language = "tr" } = request.data || {};
      await assertOwnsGameOrAdmin(request, gameId);
      const lang = language === "en" ? "en" : "tr";

      // Load alert
      if (!alertId) throw new HttpsError("invalid-argument", "alertId required");
      const alertSnap = await db.collection("games").doc(gameId)
        .collection("alerts").doc(alertId).get();
      if (!alertSnap.exists) throw new HttpsError("not-found", "Alert not found");
      const alert = { id: alertSnap.id, ...alertSnap.data() };

      // Load recent stats (24h)
      const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600e3);
      const summary = await buildSummaryData(gameId, since);

      // Current active config (if any)
      let currentConfig = {};
      try {
        const cfgSnap = await db.collection("games").doc(gameId)
          .collection("config").doc("active").get();
        if (cfgSnap.exists) currentConfig = cfgSnap.data().values || {};
      } catch {}

      // Latest AI report context (helps causal reasoning)
      let latestReport = null;
      try {
        const repSnap = await db.collection("games").doc(gameId).collection("ai_reports")
          .orderBy("createdAt", "desc").limit(1).get();
        if (!repSnap.empty) latestReport = repSnap.docs[0].data().report;
      } catch {}

      const gameCtxMeta = await getGameContext(gameId);
      const ctx = {
        alert: {
          id: alert.id,
          ruleId: alert.ruleId,
          severity: alert.severity,
          title: lang === "en" ? alert.title_en : alert.title_tr,
          rationale: lang === "en" ? alert.rationale_en : alert.rationale_tr,
          metric: alert.metric,
          delta_pct: alert.delta_pct,
        },
        recent_stats_24h: summary,
        active_config: currentConfig,
        latest_ai_report: latestReport,
      };

      const userPrompt = [
        gameContextBlock(gameCtxMeta, lang),
        lang === "en" ? "ALERT + STATS DATA (JSON):" : "UYARI + İSTATİSTİK VERİSİ (JSON):",
        JSON.stringify(ctx, null, 2),
        "",
        lang === "en"
          ? "Generate a safe, reversible Remote Config prescription to address this alert. Return JSON only."
          : "Bu uyariyi cozecek guvenli, geri alinabilir bir Remote Config recetesi uret. Sadece JSON dondur.",
      ].join("\n");

      const aiJson = await callAnthropic(
        ANTHROPIC_API_KEY.value(),
        localizeSystemPrompt(AUTO_HEAL_SYSTEM_PROMPT_TR, lang),
        userPrompt,
        { model: ANTHROPIC_MODELS.OPUS, maxTokens: 4096 }  // truncate onleme
      );

      // Persist as proposed prescription
      const prescRef = await db.collection("games").doc(gameId)
        .collection("auto_heal").add({
          alertId, gameId,
          gameName: alert.gameName || gameId,
          language: lang,
          prescription: aiJson,
          status: "proposed",
          model: ANTHROPIC_MODELS.OPUS,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: request.auth.uid,
        });

      logger.info("auto-heal proposed", {
        gameId, alertId, prescriptionId: prescRef.id,
        risk: aiJson.risk_level, changes: (aiJson.changes || []).length,
      });

      return { success: true, prescriptionId: prescRef.id, prescription: aiJson };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("generateAutoHeal unhandled", { message: err.message });
      throw new HttpsError("internal", "Auto-heal recetesi uretilemedi: " + err.message);
    }
  }
);

// applyAutoHeal — receteyi games/{gameId}/config/active'a uygular,
// snapshot ile rollback'i garantiler.
exports.applyAutoHeal = onCall(async (request) => {
  assertSignedIn(request);
  const { gameId, prescriptionId } = request.data || {};
  await assertOwnsGameOrAdmin(request, gameId);
  if (!prescriptionId) throw new HttpsError("invalid-argument", "prescriptionId required");

  const prescRef = db.collection("games").doc(gameId).collection("auto_heal").doc(prescriptionId);
  const prescSnap = await prescRef.get();
  if (!prescSnap.exists) throw new HttpsError("not-found", "Prescription not found");
  const presc = prescSnap.data();

  if (presc.status !== "proposed") {
    throw new HttpsError("failed-precondition", "Prescription is not in 'proposed' state.");
  }
  const changes = (presc.prescription && presc.prescription.changes) || [];
  if (!changes.length) {
    throw new HttpsError("failed-precondition", "Prescription has no changes to apply.");
  }
  if (presc.prescription.data_sufficient === false) {
    throw new HttpsError("failed-precondition", "Prescription marked data-insufficient by AI.");
  }

  // High risk + a/b required ama biz simdilik direkt apply ediyoruz —
  // A/B test feature'i v2'de. Yine de high-risk'i admin'e zorla.
  if (presc.prescription.risk_level === "high" && request.auth.token.admin !== true) {
    throw new HttpsError(
      "permission-denied",
      "High-risk receteler sadece admin tarafindan onaylanabilir (A/B test v2'de gelecek)."
    );
  }

  const configRef = db.collection("games").doc(gameId).collection("config").doc("active");
  const currentSnap = await configRef.get();
  const currentValues = currentSnap.exists ? (currentSnap.data().values || {}) : {};

  // Build new config
  const newValues = { ...currentValues };
  for (const c of changes) {
    if (typeof c.key === "string" && c.key.length > 0) {
      newValues[c.key] = c.new_value;
    }
  }

  await configRef.set({
    values: newValues,
    snapshot_before: currentValues,
    appliedFrom: prescriptionId,
    appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    appliedBy: request.auth.uid,
    version: admin.firestore.FieldValue.increment(1),
  }, { merge: true });

  await prescRef.update({
    status: "applied",
    appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    appliedBy: request.auth.uid,
  });

  // Mark linked alert as read
  if (presc.alertId) {
    try {
      await db.collection("games").doc(gameId).collection("alerts")
        .doc(presc.alertId).set({ read: true, autoHealedBy: prescriptionId }, { merge: true });
    } catch {}
  }

  logger.info("auto-heal applied", { gameId, prescriptionId, changeCount: changes.length });
  return { success: true, applied: changes.length };
});

// rollbackAutoHeal — snapshot_before'a geri don.
exports.rollbackAutoHeal = onCall(async (request) => {
  assertSignedIn(request);
  const { gameId, prescriptionId } = request.data || {};
  await assertOwnsGameOrAdmin(request, gameId);
  if (!prescriptionId) throw new HttpsError("invalid-argument", "prescriptionId required");

  const configRef = db.collection("games").doc(gameId).collection("config").doc("active");
  const configSnap = await configRef.get();
  if (!configSnap.exists) {
    throw new HttpsError("failed-precondition", "No active config to roll back.");
  }
  const cfg = configSnap.data();
  if (!cfg.snapshot_before) {
    throw new HttpsError("failed-precondition", "No snapshot available for rollback.");
  }

  await configRef.set({
    values: cfg.snapshot_before,
    rolledBackFrom: prescriptionId,
    rolledBackAt: admin.firestore.FieldValue.serverTimestamp(),
    rolledBackBy: request.auth.uid,
    version: admin.firestore.FieldValue.increment(1),
  }, { merge: true });

  await db.collection("games").doc(gameId).collection("auto_heal").doc(prescriptionId)
    .update({
      status: "rolled_back",
      rolledBackAt: admin.firestore.FieldValue.serverTimestamp(),
      rolledBackBy: request.auth.uid,
    });

  logger.info("auto-heal rolled back", { gameId, prescriptionId });
  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER STATE SNAPSHOT & ROLLBACK — Yigit Ozturk'un onerisi
// Whale oyuncu progress kaybetti → tek tikla geri yukle.
// Bugli patch oyunculari broken state'e atti → snapshot'tan restore.
// Oyun her N dakikada bir snapshot atar (SDK: AltarePlayerState),
// admin "rollback" tikladiginda eski state geri yazilir.
// ─────────────────────────────────────────────────────────────────────────────

// writePlayerSnapshot: SDK'dan gelir, anonim uyumlu (oyun yazar)
exports.writePlayerSnapshot = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
  const { gameId, playerAnonId, state, label } = request.data || {};
  if (!gameId || !playerAnonId || !state) {
    throw new HttpsError("invalid-argument", "gameId, playerAnonId, state required.");
  }
  if (typeof state !== "object" || Array.isArray(state)) {
    throw new HttpsError("invalid-argument", "state must be a plain object.");
  }
  // Size cap — bigger snapshots should go through dedicated callable with chunking
  const serialized = JSON.stringify(state);
  if (serialized.length > 100 * 1024) {
    throw new HttpsError("invalid-argument", "snapshot too large (>100KB).");
  }
  const docRef = db.collection("games").doc(gameId)
    .collection("player_snapshots").doc(playerAnonId)
    .collection("history").doc();
  await docRef.set({
    playerAnonId,
    state,
    label: typeof label === "string" ? label.slice(0, 80) : "auto",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sizeBytes: serialized.length,
  });
  // Maintain a "latest" pointer for fast lookups
  await db.collection("games").doc(gameId)
    .collection("player_snapshots").doc(playerAnonId)
    .set({
      latestSnapshotId: docRef.id,
      latestAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  return { success: true, snapshotId: docRef.id };
});

// listPlayerSnapshots: admin/owner browses available snapshots
exports.listPlayerSnapshots = onCall(async (request) => {
  assertSignedIn(request);
  const { gameId, playerAnonId, limit: limitN = 20 } = request.data || {};
  await assertOwnsGameOrAdmin(request, gameId);
  if (!playerAnonId) throw new HttpsError("invalid-argument", "playerAnonId required.");
  const snap = await db.collection("games").doc(gameId)
    .collection("player_snapshots").doc(playerAnonId)
    .collection("history").orderBy("createdAt", "desc").limit(Math.min(limitN, 50)).get();
  const snapshots = snap.docs.map((d) => ({
    id: d.id,
    label: d.data().label,
    sizeBytes: d.data().sizeBytes,
    createdAt: d.data().createdAt?.toMillis ? d.data().createdAt.toMillis() : null,
  }));
  return { success: true, snapshots };
});

// restorePlayerSnapshot: owner/admin restore — writes the chosen state back as "active"
exports.restorePlayerSnapshot = onCall(async (request) => {
  assertSignedIn(request);
  const { gameId, playerAnonId, snapshotId } = request.data || {};
  await assertOwnsGameOrAdmin(request, gameId);
  if (!playerAnonId || !snapshotId) {
    throw new HttpsError("invalid-argument", "playerAnonId + snapshotId required.");
  }
  const snapRef = db.collection("games").doc(gameId)
    .collection("player_snapshots").doc(playerAnonId)
    .collection("history").doc(snapshotId);
  const snap = await snapRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Snapshot not found.");
  // Write to /restore/active for the SDK to pick up
  await db.collection("games").doc(gameId)
    .collection("player_snapshots").doc(playerAnonId)
    .set({
      pendingRestore: {
        snapshotId,
        state: snap.data().state,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        requestedBy: request.auth.uid,
      },
    }, { merge: true });
  logger.info("player state restore queued", { gameId, playerAnonId, snapshotId });
  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// generateBenchmark — callable
// First-party metrics + Play Store kategori verisini birlestirir, Claude'a
// "kategori medyani vs top %10 vs sen" karsilastirmasi yaptirir.
// ─────────────────────────────────────────────────────────────────────────────

const BENCHMARK_SYSTEM_PROMPT_TR = `Sen Altare AI'in Benchmark Analyst rolusun.
Bir oyunun gercek metrikleri ve ayni kategorinin Play Store top oyunlarinin
ortalama install/rating verisi sana verilir. Cikti olarak metrik bazli
karsilastirma + tek bir "next action" cikartmalisin.

KATI KURALLAR
- Tum metinler Turkce. JSON anahtarlari Ingilizce sabit.
- Sadece JSON dondur, açiklayici metin ekleme.
- Spesifik sayilarla destekle. "Ortalama" gibi mubhem kelime yok.

OUTPUT JSON SHAPE
{
  "headline": string,
  "summary": string,
  "metrics": [
    {
      "name": string,
      "you": number,
      "median": number,
      "top10": number,
      "verdict": "leading"|"on_par"|"lagging"|"critical",
      "note": string
    }
  ],
  "biggest_gap": {
    "metric": string,
    "you_value": string,
    "category_value": string,
    "lift_needed": string
  },
  "next_action": {
    "title": string,
    "rationale": string,
    "expected_lift": string
  }
}`;

exports.generateBenchmark = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 90 },
  async (request) => {
    try {
      const { gameId, gameType = "puzzle", country = "tr", language = "tr" } = request.data || {};
      await assertOwnsGameOrAdmin(request, gameId);
      const lang = language === "en" ? "en" : "tr";

      // First-party stats (last 7d)
      const since = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 3600e3);
      const summary = await buildSummaryData(gameId, since);

      // Market intel
      const collectionId = `${gameType}-${country}`;
      const marketDocRef = db.collection("market_intel").doc(collectionId);
      const marketSnap = await marketDocRef.get();
      let competitors = [];
      if (marketSnap.exists) {
        const compsRef = marketDocRef.collection("competitors").orderBy("rank").limit(20);
        const compsSnap = await compsRef.get();
        competitors = compsSnap.docs.map((d) => {
          const c = d.data();
          return {
            name: c.title || c.appId,
            rating: parseFloat(c.score) || null,
            installs: parseInt(c.minInstalls, 10) || null,
            ratingCount: parseInt(c.ratings, 10) || null,
          };
        }).filter((c) => c.rating && c.installs);
      }

      if (competitors.length < 3) {
        throw new HttpsError(
          "failed-precondition",
          lang === "en"
            ? "Not enough market data for this category. Go to Market Analysis tab and fetch competitors first."
            : "Bu kategori için yeterli pazar verisi yok. Önce Pazar Analizi sekmesinden rakipleri çek."
        );
      }

      // Compute medians + top10
      const ratings = competitors.map((c) => c.rating).sort((a, b) => a - b);
      const installs = competitors.map((c) => c.installs).sort((a, b) => a - b);
      const median = (arr) => arr[Math.floor(arr.length / 2)];
      const top10 = (arr) => arr[Math.floor(arr.length * 0.9)];

      const benchmarkInput = {
        you: {
          uniquePlayers: summary.uniquePlayers,
          uniqueSessions: summary.uniqueSessions,
          avgSessionSeconds: summary.avgSessionSeconds,
          totalEvents: summary.totalEvents,
          fpsWarnings: summary.fpsWarnings,
          crashes: summary.crashes,
          adWatches: summary.adWatches,
          purchaseRevenueUsd: summary.purchaseRevenueUsd,
          failRate: (() => {
            const fails = (summary.eventCounts && summary.eventCounts.level_fail) || 0;
            const completes = (summary.eventCounts && summary.eventCounts.level_complete) || 0;
            const denom = fails + completes;
            return denom > 0 ? Math.round((fails / denom) * 100) : null;
          })(),
        },
        category: {
          gameType,
          country,
          competitor_count: competitors.length,
          rating_median: median(ratings).toFixed(2),
          rating_top10: top10(ratings).toFixed(2),
          installs_median: median(installs),
          installs_top10: top10(installs),
          top_3_names: competitors.slice(0, 3).map((c) => c.name),
        },
      };

      const gameCtxMeta = await getGameContext(gameId);
      const userPrompt = [
        gameContextBlock(gameCtxMeta, lang),
        lang === "en" ? "YOUR GAME + CATEGORY DATA (JSON):" : "OYUN VE KATEGORI VERİSİ (JSON):",
        JSON.stringify(benchmarkInput, null, 2),
        "",
        lang === "en"
          ? "Generate a benchmark report comparing the player to category median and top 10%. Return JSON only."
          : "Oyunun durumunu kategori medyanı ve top %10 ile karşılaştır. Sadece JSON dön.",
      ].filter(Boolean).join("\n");

      const aiJson = await callAnthropic(
        ANTHROPIC_API_KEY.value(),
        localizeSystemPrompt(BENCHMARK_SYSTEM_PROMPT_TR, lang),
        userPrompt,
        { maxTokens: 4096 }  // truncate onleme (benchmark 7 metrik)
      );

      // Save snapshot
      const bRef = await db.collection("games").doc(gameId).collection("benchmarks").add({
        gameId,
        gameType, country, language: lang,
        input: benchmarkInput,
        report: aiJson,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
      });

      return { success: true, benchmarkId: bRef.id, report: aiJson, input: benchmarkInput };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("generateBenchmark unhandled", { message: err.message });
      throw new HttpsError("internal", "Benchmark uretilemedi: " + err.message);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// askCopilot — callable
// Live-Ops Copilot: kullanici serbest soru sorar, Claude oyununun gercek
// verisine bakarak cevap verir. Bu, surekli rapor uretmenin yerine "ne
// sorarsan sor" deneyimi sunar.
// ─────────────────────────────────────────────────────────────────────────────

const COPILOT_SYSTEM_PROMPT_TR = `Sen Altare AI Live-Ops Copilot'sun.
Bir indie/midcore studio'nun bir oyununun first-party event verisine
erisimin var. Geliştirici ile sohbet ediyorsun.

KATI KURALLAR
- Cevap kisa, doğrudan ve eylem-odakli. Asla "genel" tavsiye yok.
- Her tespiti verideki bir sayiya/orana baglar.
- Veri yetersizse acikca soyle.
- Cevap maksimum 5-6 cumle. Madde kullanabilirsin.
- Tum metinler Turkce. Markdown kullanma.
- Soru oyun verisiyle alakali degilse nazikce yonlendir.

CEVAP STILI
- Once tespit (veriden) → sonra eylem (ne yapilmali)
- Sayilari belirgin yaz: "Level 18'de 412 baslangic, 38 tamamlama (%9 win rate)"
- Cihaz/level/event ismi varsa code style ile yaz (` + "`Level 18`, `Samsung SM-A908`" + `)`;

exports.askCopilot = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    try {
      const { gameId, question, language = "tr", chatId = null } = request.data || {};
      await assertOwnsGameOrAdmin(request, gameId);
      const lang = language === "en" ? "en" : "tr";

      if (!question || typeof question !== "string" || question.trim().length < 3) {
        throw new HttpsError("invalid-argument", "Question too short.");
      }

      const since = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 3600e3);
      const summary = await buildSummaryData(gameId, since);

      // Latest AI report context (optional)
      let latestReport = null;
      try {
        const repSnap = await db.collection("games").doc(gameId).collection("ai_reports")
          .orderBy("createdAt", "desc").limit(1).get();
        if (!repSnap.empty) {
          const d = repSnap.docs[0].data();
          latestReport = d.report;
        }
      } catch {}

      const gameCtxMeta = await getGameContext(gameId);
      const ctx = {
        summary_7d: summary,
        latest_ai_report: latestReport,
      };

      const userPrompt = [
        gameContextBlock(gameCtxMeta, lang),
        lang === "en" ? "GAME STATS (JSON):" : "OYUN İSTATİSTİKLERİ (JSON):",
        JSON.stringify(ctx, null, 2),
        "",
        lang === "en" ? "DEVELOPER QUESTION:" : "GELİŞTİRİCİNİN SORUSU:",
        question.trim().slice(0, 800),
      ].filter(Boolean).join("\n");

      const answer = await callAnthropic(
        ANTHROPIC_API_KEY.value(),
        localizeSystemPrompt(COPILOT_SYSTEM_PROMPT_TR, lang),
        userPrompt,
        { maxTokens: 1024, raw: true }
      );

      // Persist
      const chatRef = chatId
        ? db.collection("games").doc(gameId).collection("copilot_chats").doc(chatId)
        : db.collection("games").doc(gameId).collection("copilot_chats").doc();
      await chatRef.set({
        gameId, language: lang,
        question, answer,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        uid: request.auth.uid,
      }, { merge: true });

      return { success: true, answer, chatId: chatRef.id };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("askCopilot unhandled", { message: err.message });
      throw new HttpsError("internal", "Copilot cevap uretemedi: " + err.message);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// fetchAnalyticsOverview — callable, admin-only
// GA4 Data API'den gerçek Firebase Analytics verisi çeker (DAU, WAU, MAU,
// aktif kullanıcılar, ortalama etkileşim süresi, ülke dağılımı).
// ─────────────────────────────────────────────────────────────────────────────

exports.fetchAnalyticsOverview = onCall(
  {
    timeoutSeconds: 30,
    serviceAccount: "firebase-adminsdk-fbsvc@altare-312a1.iam.gserviceaccount.com",
  },
  async (request) => {
    assertAdmin(request);

    const propertyId = GA4_PROPERTY_ID.value();
    if (!propertyId) {
      throw new HttpsError(
        "failed-precondition",
        "GA4_PROPERTY_ID tanımlı değil. Firebase Console → Project Settings → " +
        "Integrations → Google Analytics'ten Property ID'yi al, sonra: " +
        "firebase functions:config:set ga4.property_id=\"XXXXXXXXX\" veya " +
        ".env dosyasına GA4_PROPERTY_ID=XXXXXXXXX ekle."
      );
    }

    const { BetaAnalyticsDataClient } = require("@google-analytics/data");
    const client = new BetaAnalyticsDataClient();

    try {
      const [report] = await client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [
          { startDate: "1daysAgo", endDate: "today" },
          { startDate: "7daysAgo", endDate: "today" },
          { startDate: "28daysAgo", endDate: "today" },
        ],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "averageSessionDuration" },
          { name: "screenPageViews" },
          { name: "newUsers" },
          { name: "totalRevenue" },
        ],
      });

      const [realtime] = await client.runRealtimeReport({
        property: `properties/${propertyId}`,
        metrics: [{ name: "activeUsers" }],
      });

      const [countryReport] = await client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 10,
      });

      const parseRow = (row) => ({
        activeUsers: parseInt(row.metricValues[0]?.value || "0", 10),
        sessions: parseInt(row.metricValues[1]?.value || "0", 10),
        avgSessionDuration: parseFloat(row.metricValues[2]?.value || "0"),
        pageViews: parseInt(row.metricValues[3]?.value || "0", 10),
        newUsers: parseInt(row.metricValues[4]?.value || "0", 10),
        revenue: parseFloat(row.metricValues[5]?.value || "0"),
      });

      const ranges = {};
      for (const row of report.rows || []) {
        const rangeIdx = parseInt(row.metricValues?.[0]?.oneValue?.dateRange || "0", 10);
        const key = ["day", "week", "month"][rangeIdx] || `range${rangeIdx}`;
        ranges[key] = parseRow(row);
      }

      if (report.rows && report.rows.length >= 3) {
        ranges.day = parseRow(report.rows[0]);
        ranges.week = parseRow(report.rows[1]);
        ranges.month = parseRow(report.rows[2]);
      } else if (report.rows && report.rows.length > 0) {
        ranges.day = parseRow(report.rows[0]);
      }

      const realtimeUsers = realtime.rows && realtime.rows.length > 0
        ? parseInt(realtime.rows[0].metricValues[0]?.value || "0", 10)
        : 0;

      const countries = (countryReport.rows || []).map((r) => ({
        country: r.dimensionValues[0]?.value || "unknown",
        users: parseInt(r.metricValues[0]?.value || "0", 10),
      }));

      return {
        success: true,
        realtimeUsers,
        ranges,
        countries,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error("fetchAnalyticsOverview failed", { error: err.message });
      throw new HttpsError("internal", "GA4 verisi çekilemedi: " + err.message);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// createGame — callable, herhangi bir signed-in kullanici kendi oyununu yaratabilir
// Self-service B2B onboarding: musteri panele girer, "Yeni Oyun Ekle" der.
// ─────────────────────────────────────────────────────────────────────────────

exports.createGame = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }

  const {
    gameName,
    gameType,
    platforms,
    coreLoop,        // level-based | session-based | endless | roguelike | open-world
    monetization,    // iap-heavy | ad-heavy | hybrid | premium
    deviceTier,      // low-end | mid-range | flagship | cross-platform
    description,     // free text, 2-3 sentence game description
  } = request.data || {};
  if (!gameName || typeof gameName !== "string" || gameName.trim().length < 2) {
    throw new HttpsError("invalid-argument", "Oyun adi en az 2 karakter olmali.");
  }
  if (gameName.length > 60) {
    throw new HttpsError("invalid-argument", "Oyun adi en fazla 60 karakter olmali.");
  }

  const uid = request.auth.uid;
  const slug = slugify(gameName);
  if (!slug) {
    throw new HttpsError("invalid-argument", "Oyun adi gecerli karakter icermiyor.");
  }

  // Developer profili var mi? Yoksa otomatik bir minimum profil olustur.
  const devRef = db.collection("developers").doc(uid);
  const devSnap = await devRef.get();
  const studioSlug = devSnap.exists
    ? slugify(devSnap.data().studioName || devSnap.data().displayName || "studio") || "studio"
    : "studio";
  if (!devSnap.exists) {
    const claims = (request.auth.token || {});
    await devRef.set({
      uid,
      email: claims.email || null,
      displayName: claims.name || claims.email || null,
      studioName: claims.name || "Studio",
      tier: claims.admin ? "enterprise" : "indie",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // gameId: studioSlug.gameSlug (uniqueness icin gerekirse suffix)
  const baseId = `${studioSlug}.${slug}`;
  const gameId = await reserveUniqueGameId(baseId);

  const apiKey = generateApiKey();

  const platformsArr = Array.isArray(platforms) && platforms.length
    ? platforms.filter((p) => typeof p === "string").slice(0, 4)
    : ["Android"];

  // Validate AI-context fields (whitelist for safety)
  const validCoreLoops = ["level-based", "session-based", "endless", "roguelike", "open-world", "other"];
  const validMonet = ["iap-heavy", "ad-heavy", "hybrid", "premium", "free-to-play", "other"];
  const validDeviceTiers = ["low-end", "mid-range", "flagship", "cross-platform"];

  await db.collection("games").doc(gameId).set({
    gameId,
    developerId: uid,
    gameName: gameName.trim(),
    gameType: typeof gameType === "string" ? gameType : "unknown",
    coreLoop: validCoreLoops.includes(coreLoop) ? coreLoop : "level-based",
    monetization: validMonet.includes(monetization) ? monetization : "hybrid",
    deviceTier: validDeviceTiers.includes(deviceTier) ? deviceTier : "cross-platform",
    description: typeof description === "string" ? description.slice(0, 500) : "",
    platforms: platformsArr,
    apiKey,
    status: "active",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Developer'in gameIds dizisini guncelle
  await devRef.set(
    {
      gameIds: admin.firestore.FieldValue.arrayUnion(gameId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info("game created", { gameId, uid });
  return { success: true, gameId, apiKey };
});

// ─────────────────────────────────────────────────────────────────────────────
// listMyGames — callable, kullanicinin kendi oyunlarini listeler
// ─────────────────────────────────────────────────────────────────────────────

exports.listMyGames = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }
  const uid = request.auth.uid;

  const snap = await db.collection("games").where("developerId", "==", uid).get();
  const games = snap.docs.map((d) => {
    const data = d.data();
    return {
      gameId: data.gameId || d.id,
      gameName: data.gameName,
      gameType: data.gameType,
      platforms: data.platforms || [],
      status: data.status || "active",
      apiKey: data.apiKey,
      createdAt: data.createdAt ? data.createdAt.toMillis() : null,
    };
  });

  // Admin ise: tum oyunlari da listele (ek bilgi olarak)
  let allGames = null;
  if (request.auth.token.admin === true) {
    const allSnap = await db.collection("games").get();
    allGames = allSnap.docs.map((d) => {
      const data = d.data();
      return {
        gameId: data.gameId || d.id,
        gameName: data.gameName || d.id,
        developerId: data.developerId || null,
      };
    });
  }

  return { success: true, games, allGames };
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteGame — callable, sahibi VEYA admin silebilir
// ─────────────────────────────────────────────────────────────────────────────

exports.deleteGame = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }
  const { gameId } = request.data || {};
  if (!gameId || typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }

  const gameRef = db.collection("games").doc(gameId);
  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) {
    throw new HttpsError("not-found", "Oyun bulunamadi.");
  }

  const data = gameSnap.data();
  const isOwner = data.developerId === request.auth.uid;
  const isAdminClaim = request.auth.token.admin === true;
  if (!isOwner && !isAdminClaim) {
    throw new HttpsError("permission-denied", "Bu oyunu silme yetkin yok.");
  }

  await deleteCollectionRecursive(gameRef.collection("events"), 200);
  await deleteCollectionRecursive(gameRef.collection("feedback"), 200);
  await deleteCollectionRecursive(gameRef.collection("ai_reports"), 100);
  await deleteCollectionRecursive(gameRef.collection("stats"), 100);
  await gameRef.delete();

  if (data.developerId) {
    await db.collection("developers").doc(data.developerId).set(
      {
        gameIds: admin.firestore.FieldValue.arrayRemove(gameId),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  logger.info("game deleted", { gameId, by: request.auth.uid });
  return { success: true, gameId };
});

// ─────────────────────────────────────────────────────────────────────────────
// createCustomer — admin-only, B2B sozlesme sonrasi musteri olusturur
// ─────────────────────────────────────────────────────────────────────────────

exports.createCustomer = onCall(async (request) => {
  assertAdmin(request);

  const { email, displayName, studioName, tier } = request.data || {};
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "Email gerekli.");
  }

  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (e) {
    // Kullanici yoksa olustur
    const tempPassword = generateApiKey().slice(0, 16) + "Aa1!";
    user = await admin.auth().createUser({
      email,
      emailVerified: false,
      displayName: displayName || studioName || email,
      password: tempPassword,
    });

    // Password reset link uret (musteri ilk login'de kendi sifresini koyar)
    const resetLink = await admin.auth().generatePasswordResetLink(email);
    logger.info("customer created", { email, uid: user.uid });

    // developers/{uid} olustur
    await db.collection("developers").doc(user.uid).set({
      uid: user.uid,
      email,
      displayName: displayName || studioName || email,
      studioName: studioName || "",
      tier: tier || "indie",
      gameIds: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: request.auth.uid,
    });

    return {
      success: true,
      uid: user.uid,
      email,
      resetLink,
      tempPassword, // admin gosterip musteriye iletecek (TODO: email automation)
      isNewUser: true,
    };
  }

  // Mevcut kullanici — sadece developer profilini garanti et
  await db.collection("developers").doc(user.uid).set(
    {
      uid: user.uid,
      email,
      displayName: displayName || user.displayName || email,
      studioName: studioName || "",
      tier: tier || "indie",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, uid: user.uid, email, isNewUser: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchMarketIntel — callable, Play Store'dan canli rakip+yorum verisi ceker
// google-play-scraper ile public verileri kullanir (ToS uyumlu).
// Sonuclar Firestore'da market_intel/{collectionId} altina cache lenir.
// ─────────────────────────────────────────────────────────────────────────────

const PLAY_STORE_CATEGORIES = {
  "puzzle": "GAME_PUZZLE",
  "match3": "GAME_PUZZLE",
  "midcore": "GAME_ROLE_PLAYING",
  "rpg": "GAME_ROLE_PLAYING",
  "action": "GAME_ACTION",
  "strategy": "GAME_STRATEGY",
  "simulation": "GAME_SIMULATION",
  "casino": "GAME_CASINO",
};

exports.fetchMarketIntel = onCall(
  { timeoutSeconds: 90, memory: "512MiB" },
  async (request) => {
    try {
      assertSignedIn(request);

      const { gameType = "puzzle", country = "tr", topN = 10 } = request.data || {};
      const playCategory = PLAY_STORE_CATEGORIES[gameType] || "GAME_PUZZLE";

      logger.info("fetchMarketIntel start", { gameType, playCategory, country, topN });

      const gplay = require("google-play-scraper");
      const gpModule = gplay && gplay.default ? gplay.default : gplay;

      // Top N free oyunlari kategoride cek
      const topResults = await gpModule.list({
        category: playCategory,
        collection: "TOP_FREE",
        country,
        num: Math.min(Math.max(topN, 5), 30),
      });

      const competitors = [];
      for (const app of topResults) {
        try {
          const detail = await gpModule.app({ appId: app.appId, country });
          const reviewSnap = await gpModule.reviews({
            appId: app.appId,
            country,
            sort: gpModule.sort?.HELPFULNESS || 2,
            num: 5,
          });
          const reviews = (reviewSnap?.data || []).map((r) => ({
            score: r.score,
            text: typeof r.text === "string" ? r.text.slice(0, 280) : "",
            date: r.date || null,
          }));
          competitors.push({
            appId: app.appId,
            title: detail.title,
            developer: detail.developer,
            icon: detail.icon,
            score: detail.score,
            installs: detail.installs,
            minInstalls: detail.minInstalls,
            ratings: detail.ratings,
            free: detail.free,
            price: detail.price,
            currency: detail.currency,
            adSupported: detail.adSupported,
            offersIAP: detail.offersIAP,
            inAppPurchaseRange: detail.inAppProductPrice,
            genre: detail.genre,
            url: detail.url,
            description: typeof detail.description === "string"
              ? detail.description.slice(0, 600)
              : "",
            topReviews: reviews,
            scrapedAt: admin.firestore.Timestamp.now(),
          });
        } catch (e) {
          logger.warn("competitor detail failed", { appId: app.appId, err: e?.message });
        }
      }

      const collectionId = `${gameType}-${country}`;
      const docRef = db.collection("market_intel").doc(collectionId);
      await docRef.set({
        gameType,
        country,
        playCategory,
        competitorCount: competitors.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
      }, { merge: true });

      const compCollection = docRef.collection("competitors");
      // Eski rakipleri batch sil (yenisini yazacaz)
      const oldSnap = await compCollection.limit(50).get();
      if (!oldSnap.empty) {
        const batch = db.batch();
        oldSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      // Yeni rakipleri yaz
      const writeBatch = db.batch();
      competitors.forEach((c) => {
        writeBatch.set(compCollection.doc(c.appId), sanitizeForFirestore(c));
      });
      await writeBatch.commit();

      logger.info("fetchMarketIntel done", {
        gameType, country, competitorCount: competitors.length,
      });

      return {
        success: true,
        gameType,
        country,
        competitorCount: competitors.length,
        competitors: competitors.slice(0, 30),
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("fetchMarketIntel unhandled", {
        message: err?.message, stack: err?.stack, name: err?.name,
      });
      throw new HttpsError(
        "internal",
        `Pazar verisi cekilemedi: ${err?.message || "hata"}`,
        { reason: err?.name || "Error", detail: err?.message || "" }
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// generateGameConcepts — callable, admin-only
// Market scraper'in topladigi rakip + yorum verisinden 3 yeni oyun konsepti
// uretir. Studio'nun mevcut oyunlarini da context'e koyar (engine reuse).
// Sonuc Firestore'da game_concepts/{studioId}/concepts altina yazilir.
// ─────────────────────────────────────────────────────────────────────────────

const CONCEPT_CACHE_TTL_MS = 3 * 24 * 3600 * 1000; // 3 gun

exports.generateGameConcepts = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    try {
      assertSignedIn(request);

      const {
        gameType = "puzzle",
        country = "tr",
        forceRefresh = false,
        language = "tr",
      } = request.data || {};
      const lang = language === "en" ? "en" : "tr";

      const uid = request.auth.uid;
      const collectionId = `${gameType}-${country}-${lang}`;

      logger.info("generateGameConcepts start", { uid, gameType, country, forceRefresh });

      // 1) Cache kontrol (3 gun TTL — pazar verisi gunluk degismez)
      // Cache'te concepts dizisi YOKSA (eski/bozuk yazim) atla, live uretim yap.
      const cacheRef = db.collection("game_concepts").doc(`${uid}_${collectionId}`);
      if (!forceRefresh) {
        const cacheSnap = await cacheRef.get();
        if (cacheSnap.exists) {
          const data = cacheSnap.data();
          const age = Date.now() - (data.cachedAt?.toMillis?.() || 0);
          const hasValidConcepts = data.concepts
            && Array.isArray(data.concepts.concepts)
            && data.concepts.concepts.length > 0;
          if (age < CONCEPT_CACHE_TTL_MS && hasValidConcepts) {
            logger.info("concept cache hit", { uid, ageHours: Math.round(age / 3600e3) });
            return {
              success: true,
              source: "cache",
              ageHours: Math.round(age / 3600e3),
              gameType,
              country,
              report: data.concepts,
              competitorCount: data.competitorCount || 0,
            };
          }
          if (cacheSnap.exists && !hasValidConcepts) {
            logger.info("concept cache invalid (no concepts array) — going live", { uid });
          }
        }
      }

      // 2) Market verisini cek (admin daha once fetchMarketIntel cagirdi mi?)
      const intelRef = db.collection("market_intel").doc(collectionId);
      const intelSnap = await intelRef.get();
      if (!intelSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          `Bu kategori (${gameType}/${country}) icin pazar verisi yok. Once Pazar Analizi sekmesinden "Yenile" basip rakipleri cek.`
        );
      }
      const compSnap = await intelRef
        .collection("competitors")
        .orderBy("minInstalls", "desc")
        .limit(10)
        .get();
      const competitors = compSnap.docs.map((d) => d.data());
      if (competitors.length === 0) {
        throw new HttpsError(
          "failed-precondition",
          "Pazar verisi bos. Once Pazar Analizi sekmesinden rakipleri cek."
        );
      }

      // 3) Studio context — kullanicinin mevcut oyunlari (engine reuse icin)
      const studioGamesSnap = await db
        .collection("games")
        .where("developerId", "==", uid)
        .get();
      const studioGames = studioGamesSnap.docs.map((d) => {
        const g = d.data();
        return {
          gameId: g.gameId || d.id,
          gameName: g.gameName || d.id,
          gameType: g.gameType || "unknown",
          platforms: g.platforms || [],
        };
      });

      // Admin ise tum oyunlari da gor (Royal Dreams gibi seed oyunlar dahil)
      if (request.auth.token.admin === true && studioGames.length === 0) {
        const allSnap = await db.collection("games").limit(20).get();
        allSnap.docs.forEach((d) => {
          const g = d.data();
          studioGames.push({
            gameId: g.gameId || d.id,
            gameName: g.gameName || d.id,
            gameType: g.gameType || "unknown",
            platforms: g.platforms || [],
          });
        });
      }

      // 4) Rakip ozetini kompakt formata cek (Claude'a fazla token yedirme)
      const compactCompetitors = competitors.map((c) => ({
        title: c.title,
        developer: c.developer,
        genre: c.genre,
        rating: c.score,
        ratingsCount: c.ratings,
        installs: c.installs,
        minInstalls: c.minInstalls,
        free: c.free,
        adSupported: c.adSupported,
        offersIAP: c.offersIAP,
        topReviews: Array.isArray(c.topReviews)
          ? c.topReviews.slice(0, 5).map((r) => ({
              score: r.score,
              text: typeof r.text === "string" ? r.text.slice(0, 220) : "",
            }))
          : [],
      }));

      const userPrompt = [
        "KATEGORI: " + gameType,
        "ULKE: " + country,
        "",
        "STUDIO MEVCUT OYUNLARI (engine reuse degerlendirmesi icin):",
        JSON.stringify(studioGames, null, 2),
        "",
        "PAZAR RAKIPLERI (top " + compactCompetitors.length + " — install/rating/yorum):",
        JSON.stringify(compactCompetitors, null, 2),
        "",
        "Yukaridaki GERCEK PLAY STORE verisine dayanarak 3 oyun konsepti uret.",
        "Her konseptin market_signal alani somut bir rakip/yorum referansi vermek zorunda.",
        "Sadece JSON dondur.",
      ].join("\n");

      logger.info("generateGameConcepts calling anthropic", {
        uid, gameType, competitorCount: compactCompetitors.length, studioGameCount: studioGames.length,
      });

      const aiJson = await callAnthropic(
        ANTHROPIC_API_KEY.value(),
        localizeSystemPrompt(GAME_CONCEPT_SYSTEM_PROMPT, lang),
        userPrompt,
        { maxTokens: 8192 }
      );

      logger.info("generateGameConcepts anthropic ok", {
        uid,
        conceptCount: Array.isArray(aiJson?.concepts) ? aiJson.concepts.length : 0,
        hasRaw: !!aiJson?.raw,
        rawLength: aiJson?.raw ? aiJson.raw.length : 0,
      });

      // Eger parse fail olduysa cache'e yazma — bir daha denesin
      if (aiJson && aiJson.raw && !aiJson.concepts) {
        logger.warn("generateGameConcepts parse fail — cache yazilmadi", {
          uid, sample: String(aiJson.raw).slice(0, 300),
        });
        return {
          success: false,
          source: "live",
          parseError: true,
          gameType, country,
          competitorCount: compactCompetitors.length,
          report: aiJson,
        };
      }

      // 5) Firestore'a kaydet (cache + history)
      await cacheRef.set(sanitizeForFirestore({
        uid,
        gameType,
        country,
        competitorCount: compactCompetitors.length,
        studioGameCount: studioGames.length,
        concepts: aiJson,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      }));

      // Tarihsel kayit da tut (her uretim ayri dokuman)
      await db.collection("game_concepts").doc(`${uid}_${collectionId}`)
        .collection("history").add(sanitizeForFirestore({
          gameType, country,
          concepts: aiJson,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }));

      return {
        success: true,
        source: "live",
        gameType,
        country,
        competitorCount: compactCompetitors.length,
        studioGameCount: studioGames.length,
        report: aiJson,
      };
    } catch (err) {
      if (err instanceof HttpsError) {
        logger.warn("generateGameConcepts HttpsError", { code: err.code, message: err.message });
        throw err;
      }
      logger.error("generateGameConcepts unhandled", {
        message: err?.message, stack: err?.stack, name: err?.name,
      });
      throw new HttpsError(
        "internal",
        `Oyun konsepti uretilemedi: ${err?.message || "hata"}`,
        { reason: err?.name || "Error", detail: err?.message || "" }
      );
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// setAdminRole — callable, admin-only
// ─────────────────────────────────────────────────────────────────────────────

exports.setAdminRole = onCall(async (request) => {
  assertAdmin(request);

  const { uid, admin: makeAdmin } = request.data || {};
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  const user = await admin.auth().getUser(uid);
  const newClaims = { ...(user.customClaims || {}), admin: makeAdmin === true };
  await admin.auth().setCustomUserClaims(uid, newClaims);

  await db.collection("users").doc(uid).set(
    {
      email: user.email || null,
      displayName: user.displayName || null,
      admin: makeAdmin === true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, uid, admin: makeAdmin === true };
});

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function buildSummaryData(gameId, sinceTs) {
  // Hard cap: en fazla 10K event isle (timeout korumasi).
  // Büyük oyunlarda 24sa'de 30K+ event olabilir, hepsini cekmek 60sn+ surer.
  // En yeni 10K en temsili veri (orderBy timestamp desc + limit).
  const EVENT_CAP = 10000;
  const t0 = Date.now();
  const eventsSnap = await db
    .collection("games")
    .doc(gameId)
    .collection("events")
    .where("timestamp", ">=", sinceTs)
    .orderBy("timestamp", "desc")
    .limit(EVENT_CAP)
    .get();

  const events = eventsSnap.docs.map((d) => d.data());
  const truncated = events.length >= EVENT_CAP;
  logger.info("buildSummaryData", {
    gameId,
    eventCount: events.length,
    truncated,
    queryMs: Date.now() - t0,
  });

  const counts = {};
  const sessions = new Set();
  const players = new Set();
  const levelStats = {}; // level -> { starts, completes, fails }
  let adWatches = 0;
  let rewardedAdWatches = 0;
  let purchases = 0;
  let purchaseRevenueUsd = 0;
  let crashes = 0;
  let anrs = 0;
  let fpsWarnings = 0;
  let memoryWarnings = 0;
  let totalSessionMs = 0;
  let sessionEnds = 0;
  const feedback = [];
  const devices = {}; // deviceModel -> count
  // Device intelligence — Umut Can'in onerisi: GPU + memory + tier breakdown
  const gpuFamilies = {}; // "Adreno"|"Mali"|"PowerVR"|"Apple"|"unknown" -> { count, crashes, anrs }
  const deviceCrashes = {}; // deviceModel -> { crashes, anrs, sessions }
  const memoryBuckets = { low: 0, mid: 0, high: 0, unknown: 0 }; // <2GB / 2-4GB / >=4GB
  let totalFpsSamples = 0, fpsSum = 0;
  let minFps = Infinity, maxFps = 0;

  function classifyGpu(gpuName) {
    if (!gpuName || typeof gpuName !== "string") return "unknown";
    const g = gpuName.toLowerCase();
    if (g.includes("adreno")) return "Adreno";
    if (g.includes("mali")) return "Mali";
    if (g.includes("powervr") || g.includes("imagination")) return "PowerVR";
    if (g.includes("apple")) return "Apple";
    if (g.includes("nvidia") || g.includes("tegra")) return "NVIDIA";
    if (g.includes("intel")) return "Intel";
    return "other";
  }

  function classifyMemoryTier(mb) {
    if (!mb || !Number.isFinite(mb)) return "unknown";
    if (mb < 2048) return "low";    // <2GB
    if (mb < 4096) return "mid";    // 2-4GB
    return "high";                  // 4GB+
  }

  for (const e of events) {
    counts[e.eventName] = (counts[e.eventName] || 0) + 1;
    if (e.playerAnonId) players.add(e.playerAnonId);
    if (e.sessionId) sessions.add(e.sessionId);

    const p = e.eventParams || {};
    // Level identifier — kabul edilenler: level, level_id, level_number, lvl
    const lvlRaw = p.level ?? p.level_id ?? p.level_number ?? p.lvl;
    const lvl = lvlRaw != null ? String(lvlRaw) : null;
    if (lvl) {
      if (!levelStats[lvl]) levelStats[lvl] = { starts: 0, completes: 0, fails: 0 };
      if (e.eventName === "level_start") levelStats[lvl].starts++;
      if (e.eventName === "level_complete") levelStats[lvl].completes++;
      if (e.eventName === "level_fail") levelStats[lvl].fails++;
    }

    if (e.eventName === "ad_watched") adWatches++;
    if (e.eventName === "rewarded_ad_watched") rewardedAdWatches++;
    if (e.eventName === "iap_purchase_success") {
      purchases++;
      const amt = parseFloat(
        p.amount_usd ?? p.amount ?? p.price_usd ?? p.price ??
        p.value ?? p.revenue ?? 0
      );
      if (Number.isFinite(amt)) purchaseRevenueUsd += amt;
    }
    if (e.eventName === "crash_detected") crashes++;
    if (e.eventName === "anr_detected") anrs++;
    if (e.eventName === "memory_warning") memoryWarnings++;
    if (e.eventName === "fps_warning") {
      fpsWarnings++;
      const avg = parseFloat(p.avg_fps ?? p.fps);
      if (Number.isFinite(avg) && avg >= 0) {
        fpsSum += avg; totalFpsSamples++;
        if (avg < minFps) minFps = avg;
        if (avg > maxFps) maxFps = avg;
      }
    }
    if (e.eventName === "session_end") {
      const dur = parseFloat(
        p.duration_seconds ?? p.duration ?? p.session_duration ?? p.duration_s ?? 0
      );
      if (Number.isFinite(dur) && dur > 0) {
        totalSessionMs += dur * 1000;
        sessionEnds++;
      }
    }
    if (e.eventName === "player_feedback") {
      feedback.push({
        rating: p.rating ?? p.stars ?? p.score ?? null,
        text: typeof (p.text ?? p.comment ?? p.message) === "string"
              ? (p.text ?? p.comment ?? p.message).slice(0, 280) : "",
      });
    }
    if (e.deviceModel) {
      devices[e.deviceModel] = (devices[e.deviceModel] || 0) + 1;
      if (!deviceCrashes[e.deviceModel]) {
        deviceCrashes[e.deviceModel] = { crashes: 0, anrs: 0, sessions: 0, fps_warnings: 0 };
      }
      if (e.eventName === "crash_detected") deviceCrashes[e.deviceModel].crashes++;
      if (e.eventName === "anr_detected") deviceCrashes[e.deviceModel].anrs++;
      if (e.eventName === "session_start") deviceCrashes[e.deviceModel].sessions++;
      if (e.eventName === "fps_warning") deviceCrashes[e.deviceModel].fps_warnings++;
    }
    // GPU family aggregation
    const gpu = p.gpu_model ?? p.gpu ?? e.gpuModel;
    const fam = classifyGpu(gpu);
    if (!gpuFamilies[fam]) gpuFamilies[fam] = { count: 0, crashes: 0, anrs: 0, fps_warnings: 0 };
    gpuFamilies[fam].count++;
    if (e.eventName === "crash_detected") gpuFamilies[fam].crashes++;
    if (e.eventName === "anr_detected") gpuFamilies[fam].anrs++;
    if (e.eventName === "fps_warning") gpuFamilies[fam].fps_warnings++;
    // Memory tier (RAM)
    const totalMb = parseFloat(p.total_memory_mb ?? p.ram_mb ?? e.totalMemoryMb);
    memoryBuckets[classifyMemoryTier(totalMb)]++;
  }

  const topProblemLevels = Object.entries(levelStats)
    .map(([level, s]) => {
      const attempts = s.starts || s.fails + s.completes;
      const failRate = attempts > 0 ? s.fails / attempts : 0;
      return { level, ...s, attempts, failRate };
    })
    .filter((x) => x.attempts >= 1)
    .sort((a, b) => b.failRate - a.failRate)
    .slice(0, 5);

  const topDevices = Object.entries(devices)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([device, count]) => ({ device, count }));

  // Device crash-rate intelligence (Umut Can's ask)
  const topProblemDevices = Object.entries(deviceCrashes)
    .map(([device, s]) => ({
      device,
      crashes: s.crashes,
      anrs: s.anrs,
      fps_warnings: s.fps_warnings,
      sessions: s.sessions,
      crashRate: s.sessions > 0 ? s.crashes / s.sessions : 0,
    }))
    .filter((x) => x.crashes + x.anrs + x.fps_warnings >= 1)
    .sort((a, b) => (b.crashes + b.anrs * 2) - (a.crashes + a.anrs * 2))
    .slice(0, 10);

  const gpuBreakdown = Object.entries(gpuFamilies)
    .map(([family, s]) => ({
      family,
      eventCount: s.count,
      crashes: s.crashes,
      anrs: s.anrs,
      fps_warnings: s.fps_warnings,
    }))
    .filter((x) => x.eventCount >= 1)
    .sort((a, b) => b.eventCount - a.eventCount);

  const avgSessionSeconds =
    sessionEnds > 0 ? Math.round(totalSessionMs / sessionEnds / 1000) : 0;
  const avgFps = totalFpsSamples > 0 ? Math.round(fpsSum / totalFpsSamples) : null;

  return {
    totalEvents: events.length,
    uniquePlayers: players.size,
    uniqueSessions: sessions.size,
    eventCounts: counts,
    adWatches,
    rewardedAdWatches,
    purchases,
    purchaseRevenueUsd: Math.round(purchaseRevenueUsd * 100) / 100,
    crashes,
    anrs,
    fpsWarnings,
    memoryWarnings,
    avgSessionSeconds,
    avgFps,
    minFps: minFps === Infinity ? null : minFps,
    maxFps: maxFps || null,
    topProblemLevels,
    allLevelStats: Object.entries(levelStats)
      .map(([level, s]) => ({
        level,
        starts: s.starts,
        completes: s.completes,
        fails: s.fails,
      }))
      .sort((a, b) => {
        const na = parseInt(a.level, 10);
        const nb = parseInt(b.level, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.level.localeCompare(b.level);
      }),
    topDevices,
    topProblemDevices,
    gpuBreakdown,
    memoryBuckets,
    feedbackSamples: feedback.slice(0, 20),
  };
}

// Game-type aware context — Umut Can'in onerisi: AI'a oyun turune ozel
// baseline'lar ve yorum kalibi ver. Generic "level fail rate %30" cikartilmaz —
// Match-3'te %30 yuksek, RPG'de cok dusuk olabilir.
async function getGameContext(gameId) {
  try {
    const snap = await db.collection("games").doc(gameId).get();
    if (!snap.exists) return null;
    const g = snap.data();
    return {
      gameName: g.gameName || gameId,
      gameType: g.gameType || "unknown",
      coreLoop: g.coreLoop || "level-based",
      monetization: g.monetization || "hybrid",
      deviceTier: g.deviceTier || "cross-platform",
      description: g.description || "",
      platforms: g.platforms || [],
    };
  } catch (e) {
    logger.warn("getGameContext failed", { gameId, error: e.message });
    return null;
  }
}

// Returns a paragraph to prepend to the user prompt with game-specific context.
function gameContextBlock(ctx, lang) {
  if (!ctx) return "";
  const baseline = gameTypeBaseline(ctx.gameType, ctx.coreLoop);
  if (lang === "en") {
    return [
      "=== GAME CONTEXT ===",
      `Game: ${ctx.gameName}`,
      `Type: ${ctx.gameType} · Core Loop: ${ctx.coreLoop} · Monetization: ${ctx.monetization} · Target Device Tier: ${ctx.deviceTier}`,
      ctx.description ? `Description: ${ctx.description}` : "",
      `Industry baselines for this type: ${JSON.stringify(baseline)}`,
      "IMPORTANT: Interpret metrics in the context of this game type. A 'high fail rate' means different things for Match-3 vs Idle vs RPG. Use the baselines above as reference.",
      "",
    ].filter(Boolean).join("\n");
  }
  return [
    "=== OYUN BAĞLAMI ===",
    `Oyun: ${ctx.gameName}`,
    `Tür: ${ctx.gameType} · Core Loop: ${ctx.coreLoop} · Monetizasyon: ${ctx.monetization} · Hedef Cihaz: ${ctx.deviceTier}`,
    ctx.description ? `Açıklama: ${ctx.description}` : "",
    `Bu tür için sektör baseline'ları: ${JSON.stringify(baseline)}`,
    "ÖNEMLİ: Metrikleri bu oyun türü bağlamında yorumla. 'Yüksek fail rate' Match-3 ile Idle veya RPG için farklı anlam taşır. Yukarıdaki baseline'ları referans al.",
    "",
  ].filter(Boolean).join("\n");
}

// Type-specific industry baselines (sektörel ortalama beklentiler).
// Bunlar generic — ileride cross-tenant verisinden gerçek hesaplanacak.
function gameTypeBaseline(gameType, coreLoop) {
  const T = (gameType || "").toLowerCase();
  if (T === "match3" || T === "puzzle") {
    return {
      d1_retention_target: "30-40%", d7_retention_target: "12-18%",
      avg_session_minutes: "5-10", level_fail_rate_normal: "15-30%",
      ad_per_session_typical: "2-4", iap_conversion_rate: "1-3%",
    };
  }
  if (T === "idle" || T === "hyper-casual" || T === "hypercasual") {
    return {
      d1_retention_target: "35-45%", d7_retention_target: "8-12%",
      avg_session_minutes: "2-5", level_fail_rate_normal: "5-15%",
      ad_per_session_typical: "4-8", iap_conversion_rate: "0.5-1.5%",
    };
  }
  if (T === "midcore" || T === "rpg" || T === "strategy") {
    return {
      d1_retention_target: "40-50%", d7_retention_target: "20-28%",
      avg_session_minutes: "12-25", level_fail_rate_normal: "10-25%",
      ad_per_session_typical: "1-3", iap_conversion_rate: "3-7%",
    };
  }
  if (T === "action" || T === "fps" || T === "racing") {
    return {
      d1_retention_target: "35-45%", d7_retention_target: "15-22%",
      avg_session_minutes: "8-15", level_fail_rate_normal: "20-35%",
      ad_per_session_typical: "2-4", iap_conversion_rate: "2-5%",
    };
  }
  if (T === "casino" || T === "slots") {
    return {
      d1_retention_target: "45-55%", d7_retention_target: "25-35%",
      avg_session_minutes: "10-20", level_fail_rate_normal: "n/a",
      ad_per_session_typical: "1-3", iap_conversion_rate: "5-10%",
    };
  }
  return {
    d1_retention_target: "30-40%", d7_retention_target: "12-18%",
    avg_session_minutes: "5-10", level_fail_rate_normal: "15-25%",
    ad_per_session_typical: "2-4", iap_conversion_rate: "1-3%",
  };
}

function localizeSystemPrompt(prompt, language) {
  if (language !== "en") return prompt;
  // For English requests, append an explicit override that takes precedence
  // over Turkish instructions embedded in the prompt template.
  return prompt + "\n\n" +
    "LANGUAGE OVERRIDE (highest priority):\n" +
    "- IGNORE any rule in this prompt that says \"Tum metinler Turkce\" or " +
    "\"Tüm metinler Türkçe\" or any other Turkish-only directive.\n" +
    "- Generate ALL natural-language text fields in fluent professional English.\n" +
    "- Keep JSON keys exactly as specified (English) — do not translate keys.\n" +
    "- Keep enum/literal values exactly as specified (e.g. \"critical\", \"high\", " +
    "\"medium\", \"low\", \"this week\", etc. — translate enum values like \"bu hafta\" " +
    "to \"this week\", \"2 hafta\" to \"2 weeks\", \"1 ay\" to \"1 month\", " +
    "\"sonraki sprint\" to \"next sprint\").\n" +
    "- Tone: professional, data-driven, B2B SaaS.\n";
}

function buildUserPrompt(gameId, gameName, timeRange, summary, language, gameCtx) {
  const ctxBlock = gameContextBlock(gameCtx, language);
  if (language === "en") {
    return [
      ctxBlock,
      `GAME: ${gameName || gameId} (id: ${gameId})`,
      `TIME RANGE: ${timeRange}`,
      "",
      "SUMMARY METRICS (JSON):",
      JSON.stringify(summary, null, 2),
      "",
      "Based on the real data above, generate a Live-Ops report in the specified JSON schema.",
      "Return JSON only — no explanatory text before or after. All natural-language fields in English.",
    ].filter(Boolean).join("\n");
  }
  return [
    ctxBlock,
    `OYUN: ${gameName || gameId} (id: ${gameId})`,
    `ZAMAN ARALIĞI: ${timeRange}`,
    "",
    "ÖZET METRİKLER (JSON):",
    JSON.stringify(summary, null, 2),
    "",
    "Yukarıdaki gerçek veriye dayanarak istenen JSON şemasında bir Live-Ops raporu üret.",
    "Sadece JSON döndür, açıklayıcı metin ekleme.",
  ].filter(Boolean).join("\n");
}

async function callAnthropic(apiKey, systemPrompt, userPrompt, options) {
  if (!apiKey || typeof apiKey !== "string" || apiKey.length < 20) {
    throw new HttpsError(
      "failed-precondition",
      "Anthropic API key Cloud Functions secret'inde tanimli degil. " +
      "`firebase functions:secrets:set ANTHROPIC_API_KEY` ile ekleyip functions'i redeploy et."
    );
  }

  const maxTokens = (options && Number.isFinite(options.maxTokens)) ? options.maxTokens : 4096;
  const model = (options && typeof options.model === "string" && options.model.length > 5)
    ? options.model
    : ANTHROPIC_MODEL;
  const rawMode = options && options.raw === true;

  // JSON GARANTISI: raw mode degilse "assistant prefill" teknigi kullan.
  // Son mesaji { role: "assistant", content: "{" } yaparsak Claude yanitini
  // "{" ile devam ettirmek ZORUNDA kalir — markdown fence (```json) veya
  // onek/sonek metin EKLEYEMEZ. Industry-standard JSON enforcement.
  const messages = rawMode
    ? [{ role: "user", content: userPrompt }]
    : [
        { role: "user", content: userPrompt },
        { role: "assistant", content: "{" },
      ];

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages,
        // stop_sequences yok — JSON tam donsun
      }),
    });
  } catch (netErr) {
    logger.error("anthropic network error", { message: netErr?.message, name: netErr?.name });
    throw new HttpsError(
      "unavailable",
      `Anthropic'e baglanilamadi: ${netErr?.message || "ag hatasi"}`
    );
  }

  if (!res.ok) {
    const errBody = await res.text();
    logger.error("anthropic error", { status: res.status, body: errBody, model });
    let detail = `Anthropic API ${res.status}`;
    try {
      const parsed = JSON.parse(errBody);
      if (parsed?.error?.message) detail += ` — ${parsed.error.message}`;
    } catch (_) {
      if (errBody && errBody.length < 200) detail += ` — ${errBody.slice(0, 200)}`;
    }
    // 401/403 → key sorunu, 404 → model not found, 429 → rate limit
    const code = res.status === 401 || res.status === 403
      ? "permission-denied"
      : res.status === 404
        ? "failed-precondition"
        : res.status === 429
          ? "resource-exhausted"
          : "internal";
    throw new HttpsError(code, detail, { httpStatus: res.status, model });
  }

  const data = await res.json();
  let text = data?.content?.[0]?.text || "";

  // Raw mode: text cevap istenmis (Copilot gibi free-form yanitlar icin)
  if (rawMode) {
    return text.trim();
  }

  // PREFILL FIX: yanit "{" prefill'i ile baslatilmisti. Response prefill'i
  // ICERMEZ, yani Claude'un cevabi ilk "{"-sonrasi karakterlerle basliyor.
  // Basina "{" geri ekle ki tam JSON olsun. Defensive: eger Claude zaten
  // "{" ile baslamissa (nadiren) cift ekleme.
  const trimmedText = text.trimStart();
  if (!trimmedText.startsWith("{")) {
    text = "{" + text;
  }

  // ROBUST JSON extraction — prefill sonrasi yine de defansif ol.
  // 1) Cevabin tamamini JSON.parse dene
  // 2) Markdown fence (```json ... ```) icindeki ilk bloğu cikar, dene
  // 3) İlk '{' ile son '}' arasini dene (greedy substring)
  // 4) Hala basarisiz -> raw fallback
  const stripped = text.trim();

  function tryParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  // 1) Full text
  let parsed = tryParse(stripped);
  if (parsed && typeof parsed === "object") return parsed;

  // 2) ```json fences
  const fence = stripped.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fence && fence[1]) {
    parsed = tryParse(fence[1].trim());
    if (parsed && typeof parsed === "object") return parsed;
  }

  // 3) Greedy: ilk { ile son } arasi
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = stripped.slice(firstBrace, lastBrace + 1);
    parsed = tryParse(candidate);
    if (parsed && typeof parsed === "object") return parsed;
  }

  // 4) Fallback
  logger.warn("AI response not pure JSON after 3 strategies", {
    sample: stripped.slice(0, 300),
    length: stripped.length,
  });
  return { raw: stripped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-tenant helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(s) {
  if (typeof s !== "string") return "";
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function generateApiKey() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "altr_";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

async function reserveUniqueGameId(baseId) {
  const base = baseId.slice(0, 50);
  let candidate = base;
  for (let attempt = 0; attempt < 8; attempt++) {
    const ref = db.collection("games").doc(candidate);
    const snap = await ref.get();
    if (!snap.exists) return candidate;
    candidate = `${base}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
  }
  // Fallback: random suffix
  return `${base}-${Date.now().toString(36)}`;
}

async function deleteCollectionRecursive(collectionRef, batchSize) {
  while (true) {
    const snap = await collectionRef.limit(batchSize).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < batchSize) return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — Altare Discover (login gerektirmez)
// ═══════════════════════════════════════════════════════════════════════════

const PUBLIC_CORS_ORIGINS = [
  "https://altarestudio.com.tr",
  "https://www.altarestudio.com.tr",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
];

const PUBLIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;       // 24h
const PUBLIC_RATE_LIMIT_PER_HOUR = 30;                  // IP basina

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = PUBLIC_CORS_ORIGINS.includes(origin) ? origin : PUBLIC_CORS_ORIGINS[0];
  res.set("Access-Control-Allow-Origin", allowed);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

function ipHash(req) {
  const raw = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.ip || "unknown";
  const first = String(raw).split(",")[0].trim();
  return crypto.createHash("sha256").update(first).digest("hex").slice(0, 24);
}

async function checkAndIncrementRate(req, key) {
  const hourKey = new Date().toISOString().slice(0, 13);
  const docId = `${ipHash(req)}_${hourKey}_${key}`;
  const ref = db.collection("public_rate_limit").doc(docId);
  try {
    const snap = await ref.get();
    const current = snap.exists ? (snap.data().count || 0) : 0;
    if (current >= PUBLIC_RATE_LIMIT_PER_HOUR) return false;
    await ref.set({
      count: current + 1,
      hourKey,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000),
    }, { merge: true });
    return true;
  } catch (e) {
    logger.warn("rate limit check failed", { err: e.message });
    return true;
  }
}

// ─── publicMarketSearch ─────────────────────────────────────────────────
exports.publicMarketSearch = onRequest(
  { timeoutSeconds: 80, memory: "512MiB", cors: false },
  async (req, res) => {
    if (applyCors(req, res)) return;
    try {
      const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
      const category = String(params.category || "puzzle").toLowerCase();
      const country = String(params.country || "tr").toLowerCase();
      const limit = Math.min(Math.max(parseInt(params.limit || "12", 10), 4), 24);

      if (!(await checkAndIncrementRate(req, "search"))) {
        res.status(429).json({ error: "rate_limit", message: "Saatlik istek limiti doldu. Kayit olunca limit kalkar." });
        return;
      }

      const cacheKey = `${category}-${country}-${limit}`;
      const cacheRef = db.collection("public_market_cache").doc(cacheKey);
      const cacheSnap = await cacheRef.get();
      if (cacheSnap.exists) {
        const data = cacheSnap.data();
        const age = Date.now() - (data.cachedAt?.toMillis() || 0);
        if (age < PUBLIC_CACHE_TTL_MS && Array.isArray(data.results)) {
          res.json({ source: "cache", ageMinutes: Math.round(age / 60000), category, country, limit, results: data.results });
          return;
        }
      }

      const playCategory = PLAY_STORE_CATEGORIES[category] || "GAME_PUZZLE";
      const gplay = require("google-play-scraper");
      const gpModule = gplay && gplay.default ? gplay.default : gplay;

      const list = await gpModule.list({
        category: playCategory,
        collection: "TOP_FREE",
        country,
        num: limit,
      });

      const results = [];
      for (const app of list) {
        try {
          const detail = await gpModule.app({ appId: app.appId, country });
          results.push({
            appId: detail.appId,
            title: detail.title,
            developer: detail.developer,
            icon: detail.icon,
            screenshots: (detail.screenshots || []).slice(0, 4),
            score: detail.score,
            ratings: detail.ratings,
            installs: detail.installs,
            minInstalls: detail.minInstalls,
            free: detail.free,
            adSupported: detail.adSupported,
            offersIAP: detail.offersIAP,
            inAppProductPrice: detail.inAppProductPrice,
            genre: detail.genre,
            summary: typeof detail.summary === "string" ? detail.summary.slice(0, 240) : "",
            url: detail.url,
          });
        } catch (e) {
          logger.warn("public detail failed", { appId: app.appId, err: e?.message });
        }
      }

      const cleanResults = sanitizeForFirestore(results);

      await cacheRef.set({
        category, country, limit,
        results: cleanResults,
        cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({ source: "live", category, country, limit, results: cleanResults });
    } catch (err) {
      logger.error("publicMarketSearch unhandled", { message: err?.message, stack: err?.stack });
      res.status(500).json({ error: "internal", message: err?.message || "hata" });
    }
  }
);

// ─── publicGameInsight ──────────────────────────────────────────────────
const PUBLIC_INSIGHT_PROMPT = "Sen Altare AI Live Game Intelligence'in halka acik 'Pazar Kasif' rolusun.\n" +
  "Sana bir mobil oyunun bilgileri ve top yorumlari verilir. Indie gelistirici icin 3 spesifik, veri-odakli farklilasma onerisi uretirsin.\n\n" +
  "KATI KURALLAR\n" +
  "- Asla genel tavsiye yok. Her oneri yorumdaki bir kalibi/sikayeti veya install trendini referans alir.\n" +
  "- Tum metinler TR. JSON sema bozulmaz.\n" +
  "- Sadece JSON dondur, once/sonra metin yazma.\n\n" +
  "OUTPUT JSON\n" +
  "{\n" +
  "  \"headline\": string,\n" +
  "  \"value_summary\": string,\n" +
  "  \"strengths\": [string],\n" +
  "  \"weaknesses\": [string],\n" +
  "  \"suggestions\": [\n" +
  "    { \"title\": string, \"rationale\": string, \"differentiation\": string }\n" +
  "  ]\n" +
  "}";

exports.publicGameInsight = onRequest(
  { timeoutSeconds: 90, memory: "512MiB", cors: false, secrets: [ANTHROPIC_API_KEY] },
  async (req, res) => {
    if (applyCors(req, res)) return;
    try {
      const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
      const appId = String(params.appId || "").trim();
      const country = String(params.country || "tr").toLowerCase();
      if (!appId) {
        res.status(400).json({ error: "missing_appId" });
        return;
      }

      if (!(await checkAndIncrementRate(req, "insight"))) {
        res.status(429).json({ error: "rate_limit", message: "Saatlik AI insight limiti doldu." });
        return;
      }

      const cacheRef = db.collection("public_game_insights").doc(`${appId}_${country}`);
      const cacheSnap = await cacheRef.get();
      if (cacheSnap.exists) {
        const data = cacheSnap.data();
        const age = Date.now() - (data.cachedAt?.toMillis() || 0);
        if (age < PUBLIC_CACHE_TTL_MS && data.insight) {
          res.json({
            source: "cache",
            ageMinutes: Math.round(age / 60000),
            appId, country,
            gameData: data.gameData,
            insight: data.insight,
          });
          return;
        }
      }

      const gplay = require("google-play-scraper");
      const gpModule = gplay && gplay.default ? gplay.default : gplay;

      const detail = await gpModule.app({ appId, country });
      const reviewSnap = await gpModule.reviews({
        appId, country,
        sort: gpModule.sort?.HELPFULNESS || 2,
        num: 8,
      });
      const reviews = (reviewSnap?.data || []).map((r) => ({
        score: r.score,
        text: typeof r.text === "string" ? r.text.slice(0, 280) : "",
      }));

      const userPromptParts = [
        "OYUN: " + detail.title,
        "Gelistirici: " + (detail.developer || "?"),
        "Kategori: " + (detail.genre || "—"),
        "Rating: " + (detail.score || "?") + " (" + (detail.ratings || 0) + " oy)",
        "Indirme: " + (detail.installs || "?"),
        "Monetizasyon: " + (detail.offersIAP ? "IAP " : "") + (detail.adSupported ? "Ads " : "") + (detail.free ? "Free" : "Paid"),
        "Aciklama: " + (typeof detail.description === "string" ? detail.description.slice(0, 500) : ""),
        "",
        "EN COK YARDIMCI YORUMLAR:",
        JSON.stringify(reviews, null, 2),
        "",
        "Yukaridaki gercek veriye dayanarak 3 farklilasma onerisi uret. Sadece JSON.",
      ];

      const aiJson = await callAnthropic(
        ANTHROPIC_API_KEY.value(),
        PUBLIC_INSIGHT_PROMPT,
        userPromptParts.join("\n")
      );

      const gameData = {
        title: detail.title,
        developer: detail.developer,
        score: detail.score,
        ratings: detail.ratings,
        installs: detail.installs,
        icon: detail.icon,
        url: detail.url,
        genre: detail.genre,
      };

      await cacheRef.set(sanitizeForFirestore({
        appId, country,
        title: detail.title,
        gameData,
        insight: aiJson,
        cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      }));

      res.json({ source: "live", appId, country, gameData, insight: aiJson });
    } catch (err) {
      logger.error("publicGameInsight unhandled", { message: err?.message });
      res.status(500).json({ error: "internal", message: err?.message || "hata" });
    }
  }
);
