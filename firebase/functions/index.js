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

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
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
// AI prompts
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_OPS_SYSTEM_PROMPT = `You are the Live-Ops Expert role of the Altare AI engine.
You analyse first-party event data from a single mobile game and produce a
data-driven live-ops report for the studio.

HARD RULES
- No generic advice. Every recommendation must reference a number from the data.
- If data is insufficient for a section, write "Insufficient data" — do not invent.
- Use Turkish for the prose. Section headings stay in the structure below.
- Output strictly the JSON object specified — no prose before or after.

OUTPUT JSON SHAPE
{
  "summary":            string,        // 2-3 sentence executive summary
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
// generateAIReport — callable
// ─────────────────────────────────────────────────────────────────────────────

exports.generateAIReport = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 },
  async (request) => {
    assertAdmin(request);

    const { gameId, gameName, timeRange = "last_24h" } = request.data || {};
    if (!gameId || typeof gameId !== "string") {
      throw new HttpsError("invalid-argument", "gameId is required.");
    }

    const windowMs = timeRange === "last_7d" ? 7 * 24 * 3600e3 : 24 * 3600e3;
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - windowMs);

    const summary = await buildSummaryData(gameId, since);

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

    return {
      success: true,
      reportId: reportRef.id,
      report: aiJson,
      eventCount: summary.totalEvents,
    };
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
  const res = await fetch(ANTHROPIC_URL, {
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

  if (!res.ok) {
    const errBody = await res.text();
    logger.error("anthropic error", { status: res.status, body: errBody });
    throw new HttpsError("internal", `Anthropic API ${res.status}`);
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
