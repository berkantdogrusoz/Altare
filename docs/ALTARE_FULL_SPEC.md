# Altare AI — Full Platform Spec (ChatGPT/Claude Input)

> Bu dokümanı bir LLM'e (ChatGPT, Claude, Gemini) yapıştır. Altare AI'in tüm
> özelliklerini öğrenecek, sorularına bağlamla cevap verebilecek.

---

## 1. ÜRÜN ÖZETI

**İsim:** Altare AI
**Kategori:** B2B SaaS · Closed-Loop AI Live-Ops Platform
**Hedef Kitle:** İndie + midcore mobil oyun stüdyoları (Unity'de geliştirenler)
**Tek Cümle:** *"Diğerleri gözlemler. Altare hareket eder."*
**Pozisyon:** GameAnalytics + Sentry + Mixpanel + Claude AI birleşimi, sadece indie/midcore'a özel.
**Geliştirici:** Berkant Doğrusöz (Türkiye, solo founder)
**Canlı Adres:** altarestudio.com.tr/panel.html
**Self-Signup:** altarestudio.com.tr/signup.html

**Anahtar Fark (moat):** Çoğu analytics paneli pasif (sayı gösterir, durur).
Altare *aktif* — AI anomali tespit eder, somut config değişikliği önerir,
"Uygula" tıklayınca **30 saniyede** canlı oyuna gider (yeni APK build yok,
Play Store onayı yok). Snapshot ile rollback garantili.

---

## 2. TEKNIK MIMARI

```
[Unity Oyun]
   │
   ├── AltareAnalytics.cs       → Event yazar (Firestore)
   ├── AltareAnalyticsBootstrap → KVKK/GDPR consent + auto-init
   └── AltareConfig.cs           → Remote config okur (real-time)
         │
         ▼
[Firestore: games/{gameId}/events/...]
         │
         ├─► aggregateDailyStats (her 30dk)    → stats/{day}
         ├─► detectAnomalies (her 30dk)        → alerts/{id}   ← Sentinel
         └─► (callable functions on demand)
              ├─► generateAIReport              → ai_reports/
              ├─► generateAutoHeal              → auto_heal/    ← Opus
              ├─► applyAutoHeal                 → config/active
              ├─► rollbackAutoHeal              → config/active
              ├─► askCopilot                    → copilot_chats/
              ├─► generateBenchmark             → benchmarks/
              ├─► generateGameConcepts          → game_concepts/
              ├─► fetchMarketIntel              → market_intel/
              └─► fetchAnalyticsOverview        → GA4 Data API

[Panel (altarestudio.com.tr/panel.html)]
   onSnapshot ─► tüm Firestore koleksiyonlarını real-time dinler
```

**Stack:**
- Frontend: Vanilla HTML/JS + Firebase SDK v11 (no React)
- Backend: Firebase Cloud Functions Gen2 (Node 20), Firestore
- AI: Anthropic Claude Sonnet 4.5 (default) + Opus 4.8 (Auto-Heal)
- Analytics: Google Analytics Data API (GA4)
- Data: google-play-scraper (Play Store, ToS uyumlu)
- SDK: Unity C# (drop-in)
- Hosting: Firebase Hosting + Cloudflare CDN
- Auth: Firebase Auth (Anonymous + Email/Password) + Custom Claims

**Maliyet:** ~$80/ay (100 oyun, 1M event). Marjin: ~%85.

---

## 3. KULLANICI ROLLERI

| Rol | Erişim |
|---|---|
| **Anonymous SDK** (oyuncu, otomatik) | Sadece kendi event'lerini yazar, config okur |
| **Developer** (müşteri) | Kendi oyunlarını yönetir, panel'in tüm özellikleri (Müşteri Yönetimi + GA4 hariç) |
| **Admin** (sen) | Her şey + Müşteri Yönetimi + Firebase Analytics global + setAdminRole |

Self-signup: `signup.html` → e-posta + şifre + stüdyo adı → 30 saniyede panelde.

---

## 4. SDK (Unity)

Müşteri "SDK İndir" butonuyla zip alır. İçinde 7 dosya:

1. `AltareAnalytics.cs` — Ana SDK (v2.2)
   - Tek satır init: `AltareAnalytics.Initialize("game-id", "Game Name")`
   - Anonim Firebase Auth, otomatik sessionId, FPS izleme, crash detection
   - Event API: `LogEvent("level_start", new() { { "level", n } })`
   - `SubmitFeedback(rating, text)`

2. `AltareAnalyticsBootstrap.cs` — Otomatik başlangıç
   - `[RuntimeInitializeOnLoadMethod]` ile sahne olmadan başlar
   - KVKK/GDPR consent kontrol (`PlayerPrefs.GetInt("app_consent_analytics")`)
   - GameId/GameName zip'te pre-filled gelir

3. `AltareConfig.cs` — **Closed-Loop Remote Config Client (YENİ)**
   - `AltareConfig.Initialize()`
   - `AltareConfig.GetInt/GetFloat/GetString/GetBool(key, default)`
   - Firestore real-time listener (games/{gameId}/config/active)
   - Auto-Heal bir değişiklik push edince oyun anlık çeker
   - `OnConfigUpdated` event

4. `AltareConfig.json` — gameId, gameName, apiKey, sdk version (pre-filled)

5. `SampleUsage.cs` — 6 bölüm örnek kod (Bootstrap, Level, Reklam, IAP, Feedback, Custom)

6. `KURULUM_REHBERI_TR.txt` — Türkçe 7 adım rehber

7. `SETUP_GUIDE_EN.txt` — English 7-step guide

**Standart event taxonomy:**
- Otomatik: `first_open`, `app_open`, `session_start`, `session_end`, `fps_warning`, `crash_detected`
- Manuel (geliştirici çağırır): `level_start`, `level_complete`, `level_fail`, `ad_watched`, `rewarded_ad_watched`, `iap_purchase_success`, `player_feedback`

**Her event'te otomatik gönderilen alanlar:**
`gameId`, `gameName`, `playerAnonId`, `sessionId`, `eventName`, `eventParams`, `timestamp`, `clientTimestamp`, `platform`, `appVersion`, `deviceModel`

**Defansif field naming (backend yaygın alternatifleri de tanır):**
- IAP amount: `amount_usd | amount | price_usd | price | value | revenue`
- Level ID: `level | level_id | level_number | lvl`
- Session duration: `duration_seconds | duration | session_duration | duration_s`

---

## 5. PANEL SEKMELERI (Sidebar)

### STÜDYO
- **Oyunlarım** — Self-service oyun ekleme, gameId + API key üretimi, SDK İndir butonu, "Yeni Oyun Ekle"
- **Müşteri Yönetimi** (admin-only) — B2B müşteri oluşturma, password reset link üretimi
- **Entegrasyon Rehberi** — 6 adımlı SDK kurulum kılavuzu, kod örnekleri, troubleshooting

### OYUN ZEKASI
- **Genel Bakış** — 8 KPI: Aktif Oturum, 24s Event, Ort. Oturum, Fail Oranı, Reklam İzleme, IAP Geliri, FPS Uyarısı, Crash + Firebase Analytics kartları (DAU/WAU/MAU/anlık aktif/ülke dağılımı — admin-only) + AI Tespiti kartı
- **Sentinel Uyarıları** (YENİ) — 7/24 anomali tespit listesi, sidebar'da kırmızı badge ile okunmamış sayısı, real-time
- **Auto-Heal** (YENİ) — AI reçeteleri geçmişi (proposed/applied/rolled_back), Uygula/Geri Al butonları
- **Canlı Event Stream** — Real-time son 40 event akışı
- **Level Intelligence** — Top 5 problem level + tüm level funnel (yeşil win / kırmızı fail bar chart)
- **Crash & Performance** — FPS uyarıları, top problem cihazlar

### PAZAR ZEKASI
- **Pazar Analizi** — Canlı Play Store scraper, 6 kategori (puzzle, match3, midcore, action, strategy, simulation) × 4 ülke (TR, US, DE, JP), rakip kartları + trend sinyalleri
- **Benchmark** (YENİ) — First-party stats + Play Store kategori medyan/top%10 karşılaştırma, AI verdict (leading/on_par/lagging/critical), biggest_gap, next_action
- **Yorum & Sentiment** — Kategori top 3 vs senin oyunun (şu an demo, Play Review API entegrasyonu Phase 2)

### AI
- **AI Raporu** — Claude Sonnet 4.5 ile BLUF formatlı haftalık live-ops raporu (TR/EN otomatik), JSON schema: `executive_briefing { headline, value_summary, critical_actions[], opportunities[] }`, `summary`, `overall_health`, `player_behavior`, `level_difficulty`, `top_problem_levels[]`, `monetization`, `performance`, `feedback_summary`, `pre_marketing_risk`, `immediate_actions[]`, `next_update`
- **Roadmap Önerileri** — AI Market Strategist, Play Store rakip yorumlarından 3 yeni oyun konsepti üretir (high-impact/medium-safe/low-effort triad)

### FLOATING WIDGET (sağ alt köşe)
- **AI Copilot** (YENİ) — Robot mark'lı yuvarlak buton, tıklayınca chat penceresi
  - Free-form soru: "retention neden düştü?", "hangi cihazda crash var?", "level 18'i nasıl optimize ederim?"
  - Claude Sonnet 4.5, context: son 7 gün event summary + en son AI raporu
  - Enter ile gönder, Shift+Enter yeni satır, ESC kapat
  - Suggestion chip'leri, geçmiş sohbet kaydı

---

## 6. SENTİNEL — 6 ANOMALI KURALI

`detectAnomalies` her 30 dakikada bir çalışır. Her oyun için:
- **Now window:** son 2 saat
- **Baseline window:** son 7 gün (24h chunk)
- **Dedupe:** aynı kural 6 saat içinde tekrar tetiklenmez

| Rule ID | Severity | Trigger |
|---|---|---|
| `crash_spike` | critical | Crash/session oranı baseline'in 3x üzeri (min 5 crash) |
| `dau_drop` | high | Aktif oyuncu %40+ düşüş (baseline ≥10 player) |
| `fps_degradation` | high | FPS uyarı/session oranı baseline'in 2x üzeri (min 20 warn) |
| `session_length_drop` | medium | Ort. oturum %30+ düşüş (min 30sn baseline) |
| `whale_detected` | info | Tek aralıkta $50+ revenue, ≤5 satın alma |
| `first_revenue` | info | İlk kez gelir geldi (baseline = 0) |

Her uyarı `games/{gameId}/alerts/{alertId}` doc'una yazılır:
```json
{
  "ruleId": "crash_spike",
  "severity": "critical",
  "title_tr": "Crash patlamasi tespit edildi",
  "title_en": "Crash spike detected",
  "metric": "crashes",
  "delta_pct": 320,
  "rationale_tr": "...",
  "rationale_en": "...",
  "read": false,
  "createdAt": Timestamp
}
```

---

## 7. AUTO-HEAL — CLOSED-LOOP AI LIVE-OPS

**Akış:**

1. Sentinel uyarı atar → panel'de "🩺 AI Çözüm Öner" butonu (sadece critical/high/medium uyarılarda)
2. Müşteri tıklar → `generateAutoHeal` callable çalışır:
   - Alert + 24sa stats + active config + son AI raporu Opus'a verilir
   - Claude Opus 4.8 reçete üretir (Sonnet değil — causal reasoning + risk + multi-step planning daha iyi)
3. Modal açılır, reçete gösterilir:
   ```
   Diagnosis: "Level 18 oyuncuları %78 kaybediyor"
   Root Cause: "Hedef skor 5000 çok yüksek, zorluk pik"
   Risk: medium
   Changes:
     level_18_target_score   5000 → 3500
     level_18_moves_limit    20   → 25
   Success Criteria: "24sa içinde fail rate <%50"
   Rollback Trigger: "24sa sonra iyileşme yoksa"
   Warnings: ["Level 19 retention'a yan etki olabilir"]
   ```
4. "Uygula" tıklanır → `applyAutoHeal`:
   - Snapshot alınır (`snapshot_before`) — rollback garantisi
   - `games/{gameId}/config/active.values` güncellenir
   - Oyun `AltareConfig.cs` ile **anlık çeker** (Firestore real-time)
   - Alert "read" + `autoHealedBy` ile işaretlenir
5. Yanlış giderse → `rollbackAutoHeal` → snapshot'tan dönüş

**Risk Gating:** `risk_level: "high"` reçeteler sadece admin onayı ile uygulanır (A/B test feature v2'de).

**Reçete JSON Schema:**
```json
{
  "diagnosis": "string",
  "root_cause_hypothesis": "string",
  "confidence": "low|medium|high",
  "risk_level": "low|medium|high",
  "data_sufficient": true,
  "changes": [
    {
      "key": "level_18_target_score",
      "current_value": 5000,
      "new_value": 3500,
      "value_type": "int",
      "rationale": "...",
      "target_metric": "level_18_completion",
      "expected_delta": "%9 → %42"
    }
  ],
  "side_effects": "string",
  "monitor_window_hours": 24,
  "success_criteria": "string",
  "rollback_trigger": "string",
  "ab_test_required": false,
  "warnings": ["string"]
}
```

**Standart config key naming:**
- `level_{N}_target_score`, `level_{N}_moves_limit`, `level_{N}_time_limit`
- `ad_frequency_interstitial`, `ad_frequency_rewarded`, `ad_cooldown_seconds`
- `iap_starter_discount_pct`, `iap_currency_inflation_factor`
- `fps_target`, `particle_quality_low_end`, `low_end_device_threshold_mb`

---

## 8. TIERED AI MODEL ROUTING

```
Copilot sohbet        → Sonnet 4.5 (hız önemli)
AI Raporu haftalık    → Sonnet 4.5 (yapılandırılmış JSON)
Benchmark             → Sonnet 4.5 (karşılaştırma basit)
Roadmap konsept       → Sonnet 4.5 (yaratıcı, tek atış)
Sentinel teşhis       → kural-tabanlı (LLM gerekmez)
Auto-Heal REÇETE      → Opus 4.8 (kritik, canlıya gidiyor)
Stratejik AI (v2)     → Opus 4.8 (Studio+ tier'a özel)
```

**Maliyet:**
- Sonnet: $3 input / $15 output per 1M token
- Opus: $15 input / $75 output per 1M token (5x)
- Bir Auto-Heal reçetesi ≈ $0.15. Studio plan'da ($49/ay) sorunsuz.

---

## 9. FIRESTORE VERI ŞEMASI

```
/developers/{uid}                       — B2B müşteri profilleri
  { uid, email, displayName, studioName, tier, gameIds[], createdAt }

/games/{gameId}                          — Multi-tenant oyun kaydı
  { gameId, gameName, gameType, platforms[], developerId, apiKey, status, createdAt }

  /events/{eventId}                      — Unity SDK yazar (anonymous)
    { gameId, gameName, playerAnonId, sessionId, eventName, eventParams,
      timestamp, clientTimestamp, platform, appVersion, deviceModel }

  /feedback/{feedbackId}                 — Player feedback (rating + text)

  /stats/{YYYY-MM-DD}                    — aggregateDailyStats yazar
    { totalEvents, uniquePlayers, uniqueSessions, eventCounts, adWatches,
      purchaseRevenueUsd, crashes, fpsWarnings, avgSessionSeconds,
      topProblemLevels[], allLevelStats[], topDevices[], feedbackSamples[] }

  /alerts/{alertId}                      — Sentinel anomali uyarıları
  /ai_reports/{reportId}                 — Claude AI raporları
  /auto_heal/{prescriptionId}            — AI Doctor reçeteleri
  /benchmarks/{benchmarkId}              — Benchmark snapshot'ları
  /copilot_chats/{chatId}                — Copilot sohbet geçmişi
  /config/active                         — Closed-Loop Remote Config
    { values: { key: value }, snapshot_before, appliedFrom, version }

/market_intel/{gameType-country}         — Play Store scraper sonuçları
  /competitors/{appId}                   — Rakip oyun verisi
  /reviews/{reviewId}                    — Yorum verisi

/game_concepts/{uid_gameType-country-lang} — AI Market Strategist cache
  /history/{historyId}                   — Geçmiş üretimler

/users/{uid}                              — Admin allowlist mirror
```

---

## 10. CLOUD FUNCTIONS (Callable + Scheduled)

**Scheduled:**
- `aggregateDailyStats` — Her 30dk, tüm oyunların son 24sa event'lerini özetler
- `detectAnomalies` — Her 30dk, 6 anomali kuralını her oyun için çalıştırır

**Callable (signed-in developer):**
- `createGame` — Yeni oyun + gameId + apiKey üretimi
- `listMyGames` — Developer'ın kendi oyunları (developerId match)
- `deleteGame` — Oyunu sil (cascade: events, stats, alerts, vb.)
- `markAlertRead` — Sentinel uyarısını okundu olarak işaretle
- `generateAIReport` (gameId-owner) — Claude Sonnet raporu üretir
- `generateAutoHeal` (gameId-owner) — Claude Opus reçetesi üretir
- `applyAutoHeal` (gameId-owner) — Reçeteyi config/active'a uygula
- `rollbackAutoHeal` (gameId-owner) — Snapshot'tan geri dön
- `generateBenchmark` (gameId-owner) — Kategori karşılaştırma
- `askCopilot` (gameId-owner) — Free-form chat
- `fetchMarketIntel` (signed-in) — Play Store scraper
- `generateGameConcepts` (signed-in) — AI Market Strategist

**Callable (admin-only):**
- `createCustomer` — B2B müşteri oluştur + password reset link
- `setAdminRole` — Admin rolü ata/kaldır
- `fetchAnalyticsOverview` — GA4 global verisi (Phase 2: per-customer)

**HTTP (public, login gerektirmez):**
- `publicMarketSearch` — Pazarlama sitesi için Play Store arama
- `publicGameInsight` — Tek oyunun public insight'ı

---

## 11. GÜVENLIK MODELI

**Firestore rules özet:**
- `/developers/{uid}` — Self-create + self-update (tier admin tarafından)
- `/games/{gameId}` — `developerId` field ile sahiplik. Multi-tenant izolasyonu
- `/games/{gameId}/events` — Anonymous SDK yazar (event shape validation), owner okur
- `/games/{gameId}/config/{configId}` — Anonymous SDK okur (oyun config çeker), Cloud Functions yazar
- `/market_intel/**` — Signed-in herkes okur (public Play Store verisi), Cloud Functions yazar
- Default deny

**Cloud Function helpers:**
- `assertSignedIn(request)` — auth zorunlu
- `assertAdmin(request)` — admin claim zorunlu
- `assertOwnsGameOrAdmin(request, gameId)` — developer kendi oyununda çalışabilir, admin her şey
- `sanitizeForFirestore(value)` — undefined alanları siler (Firestore strict mode safety)

---

## 12. İŞ MODELI

| Tier | Fiyat | Hedef | İçindekiler |
|---|---|---|---|
| **Indie** | $0/ay | Tek oyun, <10K DAU | Tüm panel, AI Raporu (haftada 1), Sentinel, Copilot (10 mesaj/gün) |
| **Studio** | $49/ay | 1-5 oyun, <100K DAU | Sınırsız AI, **Auto-Heal**, Roadmap konseptleri, Benchmark, e-posta uyarıları |
| **Enterprise** | $299+/ay | 5+ oyun, white-label | Custom dashboard, dedicated support, API access, on-prem opt. |

**Auto-Heal'in tier gate'i:** Indie tier'da Sentinel görür, "AI Çözüm Öner" Studio+ özelliğidir.

---

## 13. UI ÖZELLIKLERI

- **TR/EN dil toggle** — Topbar'da EN/TR butonu, `localStorage.altare.lang`, sayfa yenilense de hatırlar
- **AI raporları otomatik dil takibi** — Panel TR ise rapor TR, EN ise EN üretilir
- **Real-time everywhere** — Firestore onSnapshot listener'ları (alerts, events, ai_reports, auto_heal, stats)
- **Floating Copilot Widget** — Sağ alt köşede özel SVG mark (hexagonal Altare mark, 2 göz, animated blink + tilt)
- **Sentinel badge** — Sidebar'da okunmamış uyarı sayısı (kırmızı yuvarlak)
- **Mobile responsive** — 520px altı tam ekran copilot

---

## 14. RAKIP ANALIZI

| Rakip | Güçlü | Zayıf | Altare Farkı |
|---|---|---|---|
| **GameAnalytics** | Bedava, popüler | Pasif dashboard, AI yok | **AI Sentinel + Auto-Heal + Copilot** |
| **Unity Analytics** | Engine entegre | Çıplak metrik, eylem önermez | Action-oriented AI raporları |
| **AppsFlyer** | UA güçlü | $$$, oyun-içi körlük | İndie fiyatı, oyun-içi odaklı |
| **data.ai** | Market verisi | Sadece market | First-party + market birleşik |
| **Mixpanel** | Esnek | Oyun-spesifik değil | Oyun şablonları + Live-Ops AI |
| **ChatGPT/Claude (raw)** | Genel zeka | Oyununla bağlantısı yok | SDK + telemetri + closed-loop |

**Altare'nin moat'ı:**
1. **Closed-loop:** detect → AI prescribe → apply → rollback
2. **First-party + Market birleşik** veri
3. **Multi-tenant SDK** infrastructure (general AI yapamaz)
4. **Türkçe-native** (Anglo-Sakson rakiplerin görmediği pazar)
5. **Self-service** (30sn signup, sales-led değil)

---

## 15. ROADMAP (Phase 2/3)

**Phase 2 (1-3 ay):**
- A/B testing — Auto-Heal varyantları (3 farklı reçete, %20 oyuncuya, winner'ı seç)
- E-posta uyarıları (Sentinel kritik alert → e-mail + Discord webhook)
- Aggregate market reports (50+ oyun anonimleştirilmiş veri → $200-2K rapor satışı)

**Phase 3 (3-6 ay):**
- Per-customer Firebase Analytics (müşteri kendi GA4 property ID'sini bağlar)
- Push notification kanalı (Sentinel → mobile push)
- Webhook/API export (büyük yayıncılar için)
- Crashlytics-style stack trace toplama (şu an sadece `crash_detected` event)

**Phase 4 (6+ ay):**
- White-label SaaS (büyük stüdyo kendi marka altında)
- Multi-engine support (Godot, Unreal SDK)

---

## 16. MEVCUT TRACTION (Haziran 2026)

- **Royal Dreams** canlıda: 3,003 DAU, %98.1 crash-free
- Endonezya pazarı patladı (1,453 aktif oyuncu, organik)
- AI raporları üretiliyor (Claude Sonnet 4.5)
- Auto-Heal canlıda (Claude Opus 4.8)
- Self-service signup açık
- SDK indirilebilir (v2.2, 7 dosya zip)
- TR + EN dil desteği tam
- AdMob app-ads.txt doğrulandı
- Multi-tenant güvenlik tam (her müşteri sadece kendi verisi)

---

## 17. KULLANICI AKIŞI (End-to-End)

**Yeni müşteri yolu:**

1. `altarestudio.com.tr/signup.html` → e-posta + şifre + stüdyo adı (30sn)
2. Panel'e otomatik yönlendirme, "Henüz oyun yok — + Yeni Oyun Ekle"
3. Oyunlarım → Yeni Oyun Ekle → sistem otomatik `gameId` + `apiKey` üretir
4. SDK İndir butonu → zip iner (5 dakika entegre)
5. Unity'de `AltareAnalytics.Initialize()` çağrılır → event'ler akmaya başlar
6. Panel'de Canlı Event Stream'de `session_start` görülür
7. 24 saat veri biriktikten sonra AI Raporu üretilebilir
8. Sentinel 30 dakikada bir tarama yapar → anomali olursa uyarı
9. Auto-Heal → AI Çözüm Öner → Uygula → 30sn'de canlı
10. AI Copilot (sağ alt) → soru sor, gerçek veriyle cevap al

---

## 18. SIK SORULAN SORULAR

**Q: ChatGPT/Claude da AI cevap veriyor, Altare neyi farklı yapıyor?**
A: ChatGPT'nin oyunuzun event verisine erişimi yok. Altare SDK olduğu için
gerçek telemetriyi okur, hangi cihazda hangi level'da kaç oyuncu kaldığını
bilir. Ayrıca Auto-Heal ile **eylem** alır — chat değil, gerçek config push.

**Q: Hangi veriler toplanır? KVKK uyumlu mu?**
A: Sadece anonim event verisi (playerAnonId UUID, cihazda saklanır).
E-posta, telefon, location, kişisel veri YOK. KVKK + GDPR uyumlu. Bootstrap
script consent kontrol eder, onay yoksa SDK başlamaz.

**Q: Yeni APK build gerektirmiyor mu?**
A: Auto-Heal değişiklikleri için hayır. SDK'da `AltareConfig.GetInt(...)`
kullanılan değerler Firestore'dan çekilir, real-time güncellenir. Yeni level
eklemek vb. için tabii ki build gerekir (kod değişikliği).

**Q: Aylık maliyet ne kadar?**
A: Indie tier $0 (tek oyun, <10K DAU). Studio $49/ay. Enterprise custom.
Altare'nin altyapı maliyeti müşteri başına ~$0.30-1.50/ay, %85 marjla.

**Q: Hangi engine desteği var?**
A: Şu an Unity (drop-in C# SDK). Godot ve Unreal Phase 4'te.

**Q: Self-host edebilir miyim?**
A: Enterprise tier'da on-prem opsiyonu olabilir, talep et. Standart kullanım
Firebase üzerinden multi-tenant.

---

## 19. KISA TAGLINELAR

- "Diğerleri gözlemler. Altare hareket eder."
- "Oyununuzu uyurken iyileştiren AI."
- "Closed-loop AI Live-Ops for indie game studios."
- "Tespit → Reçete → 30 saniyede canlı oyunda."

---

*Doküman: 15 Haziran 2026. Versiyon: 2.2.0*
*İletişim: berkant@altarestudio.com.tr*
