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
 *   - setAdminRole (callable, admin-only — bootstrap via console first)
 *       Toggles a custom auth claim {admin: true} for a target uid and mirrors
 *       the row into /users/{uid}. Allowlist of "panel users".
 *
 * Secrets (set via `firebase functions:secrets:set <NAME>`):
 *   - ANTHROPIC_API_KEY
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
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
const ANTHROPIC_MODEL = "claude-sonnet-4-5"; // Anthropic Sonnet 4.5 (latest stable)
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
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 },
  async (request) => {
    try {
      assertAdmin(request);

      const { gameId, gameName, timeRange = "last_24h" } = request.data || {};
      if (!gameId || typeof gameId !== "string") {
        throw new HttpsError("invalid-argument", "gameId is required.");
      }

      logger.info("generateAIReport start", { gameId, gameName, timeRange, uid: request.auth.uid });

      const windowMs = timeRange === "last_7d" ? 7 * 24 * 3600e3 : 24 * 3600e3;
      const since = admin.firestore.Timestamp.fromMillis(Date.now() - windowMs);

      const summary = await buildSummaryData(gameId, since);
      logger.info("summary built", { gameId, totalEvents: summary.totalEvents });

      if (summary.totalEvents === 0) {
        throw new HttpsError(
          "failed-precondition",
          "Bu zaman aralığında oyundan hiç event yok. AI raporu üretmek için önce veri akışı gerekli."
        );
      }

      const userPrompt = buildUserPrompt(gameId, gameName, timeRange, summary);

      const aiJson = await callAnthropic(
        ANTHROPIC_API_KEY.value(),
        LIVE_OPS_SYSTEM_PROMPT,
        userPrompt
      );

      logger.info("anthropic ok", { gameId, keys: Object.keys(aiJson || {}).length });

      const reportRef = await db
        .collection("games")
        .doc(gameId)
        .collection("ai_reports")
        .add({
          gameId,
          gameName: gameName || gameId,
          timeRange,
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
// createGame — callable, herhangi bir signed-in kullanici kendi oyununu yaratabilir
// Self-service B2B onboarding: musteri panele girer, "Yeni Oyun Ekle" der.
// ─────────────────────────────────────────────────────────────────────────────

exports.createGame = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }

  const { gameName, gameType, platforms } = request.data || {};
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

  await db.collection("games").doc(gameId).set({
    gameId,
    developerId: uid,
    gameName: gameName.trim(),
    gameType: typeof gameType === "string" ? gameType : "unknown",
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
      assertAdmin(request);

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
      assertAdmin(request);

      const {
        gameType = "puzzle",
        country = "tr",
        forceRefresh = false,
      } = request.data || {};

      const uid = request.auth.uid;
      const collectionId = `${gameType}-${country}`;

      logger.info("generateGameConcepts start", { uid, gameType, country, forceRefresh });

      // 1) Cache kontrol (3 gun TTL — pazar verisi gunluk degismez)
      const cacheRef = db.collection("game_concepts").doc(`${uid}_${collectionId}`);
      if (!forceRefresh) {
        const cacheSnap = await cacheRef.get();
        if (cacheSnap.exists) {
          const data = cacheSnap.data();
          const age = Date.now() - (data.cachedAt?.toMillis?.() || 0);
          if (age < CONCEPT_CACHE_TTL_MS && data.concepts) {
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
        GAME_CONCEPT_SYSTEM_PROMPT,
        userPrompt
      );

      logger.info("generateGameConcepts anthropic ok", {
        uid, conceptCount: Array.isArray(aiJson?.concepts) ? aiJson.concepts.length : 0,
      });

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
  const eventsSnap = await db
    .collection("games")
    .doc(gameId)
    .collection("events")
    .where("timestamp", ">=", sinceTs)
    .get();

  const events = eventsSnap.docs.map((d) => d.data());

  const counts = {};
  const sessions = new Set();
  const players = new Set();
  const levelStats = {}; // level -> { starts, completes, fails }
  let adWatches = 0;
  let rewardedAdWatches = 0;
  let purchases = 0;
  let purchaseRevenueUsd = 0;
  let crashes = 0;
  let fpsWarnings = 0;
  let totalSessionMs = 0;
  let sessionEnds = 0;
  const feedback = [];
  const devices = {};

  for (const e of events) {
    counts[e.eventName] = (counts[e.eventName] || 0) + 1;
    if (e.playerAnonId) players.add(e.playerAnonId);
    if (e.sessionId) sessions.add(e.sessionId);

    const p = e.eventParams || {};
    const lvl = p.level != null ? String(p.level) : null;
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
      const amt = parseFloat(p.amount_usd ?? p.amount ?? 0);
      if (Number.isFinite(amt)) purchaseRevenueUsd += amt;
    }
    if (e.eventName === "crash_detected") crashes++;
    if (e.eventName === "fps_warning") fpsWarnings++;
    if (e.eventName === "session_end") {
      const dur = parseFloat(p.duration_seconds ?? p.duration ?? 0);
      if (Number.isFinite(dur) && dur > 0) {
        totalSessionMs += dur * 1000;
        sessionEnds++;
      }
    }
    if (e.eventName === "player_feedback") {
      feedback.push({
        rating: p.rating ?? null,
        text: typeof p.text === "string" ? p.text.slice(0, 280) : "",
      });
    }
    if (e.deviceModel) {
      devices[e.deviceModel] = (devices[e.deviceModel] || 0) + 1;
    }
  }

  const topProblemLevels = Object.entries(levelStats)
    .map(([level, s]) => {
      const attempts = s.starts || s.fails + s.completes;
      const failRate = attempts > 0 ? s.fails / attempts : 0;
      return { level, ...s, attempts, failRate };
    })
    .filter((x) => x.attempts >= 5)
    .sort((a, b) => b.failRate - a.failRate)
    .slice(0, 5);

  const topDevices = Object.entries(devices)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([device, count]) => ({ device, count }));

  const avgSessionSeconds =
    sessionEnds > 0 ? Math.round(totalSessionMs / sessionEnds / 1000) : 0;

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
    fpsWarnings,
    avgSessionSeconds,
    topProblemLevels,
    topDevices,
    feedbackSamples: feedback.slice(0, 20),
  };
}

function buildUserPrompt(gameId, gameName, timeRange, summary) {
  return [
    `OYUN: ${gameName || gameId} (id: ${gameId})`,
    `ZAMAN ARALIĞI: ${timeRange}`,
    "",
    "ÖZET METRİKLER (JSON):",
    JSON.stringify(summary, null, 2),
    "",
    "Yukarıdaki gerçek veriye dayanarak istenen JSON şemasında bir Live-Ops raporu üret.",
    "Sadece JSON döndür, açıklayıcı metin ekleme.",
  ].join("\n");
}

async function callAnthropic(apiKey, systemPrompt, userPrompt) {
  if (!apiKey || typeof apiKey !== "string" || apiKey.length < 20) {
    throw new HttpsError(
      "failed-precondition",
      "Anthropic API key Cloud Functions secret'inde tanimli degil. " +
      "`firebase functions:secrets:set ANTHROPIC_API_KEY` ile ekleyip functions'i redeploy et."
    );
  }

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
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
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
    logger.error("anthropic error", { status: res.status, body: errBody, model: ANTHROPIC_MODEL });
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
    throw new HttpsError(code, detail, { httpStatus: res.status, model: ANTHROPIC_MODEL });
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || "";

  // Strip ```json fences if model added them despite instructions
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    logger.warn("AI response not pure JSON, returning as raw", { sample: cleaned.slice(0, 200) });
    return { raw: cleaned };
  }
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
