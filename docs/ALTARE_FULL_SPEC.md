# Altare AI — Full Platform Spec v3.0 (ChatGPT/Claude Input)

> **NASIL KULLANILIR:** Bu dokümanın TAMAMINI bir LLM'e (ChatGPT, Claude, Gemini)
> yapıştır. Sonra istediğin iş dosyasını/sunumu/email/pitch'i isteyebilirsin.
> LLM tüm ürün özelliklerini, mimarisini, fiyatlandırmasını, moat'ını bilecek.
>
> **TAVSİYE EDİLEN İLK MESAJ:**
> *"Aşağıdaki spec benim ürünüm Altare AI'ın tam dokümanı. Bunu öğren, sorularıma
> sadece bu spec içindeki bilgilerle cevap ver. Hiçbir şeyi uydurma. Anladıysan
> 'hazırım' de, sonra soracağım."*

---

## 1. ÜRÜN ÖZETİ

**İsim:** Altare AI
**Versiyon:** 3.0 (Haziran 2026 — sektör feedback'i sonrası major update)
**Kategori:** B2B SaaS · The First **Closed-Loop AI Live-Ops** Platform with **Cross-Tenant Network Effect**
**Hedef Kitle:** Solo geliştiriciden Rollic ölçeğine — tüm mobil oyun stüdyoları
**Geliştirici:** Berkant Doğrusöz (Türkiye, solo founder)
**Canlı URL:** altarestudio.com.tr/panel.html
**Self-Signup:** altarestudio.com.tr/signup.html

**Tek Cümle Pozisyonlama (v3):**
> *"Tek panel + tek SDK + tüm sektörün toplu zekası."*
> *"Diğerleri gözlemler. Altare hareket eder."*

**3 Katmanlı Moat (Kompetitif Avantaj):**
1. **Action Moat** — Closed-loop: Detect → AI prescribe → Remote Config push → Snapshot rollback. ChatGPT/Claude yapamaz (SDK + multi-tenant backend gerekli).
2. **Network Effect Moat** — 50+ oyun platformda olunca Industry Benchmark rakipsiz. Tek başına kimsenin bu verisi yok.
3. **Domain Moat** — Game-type aware AI playbook'ları (Match-3 vs Idle vs RPG farklı yorumlar).

---

## 2. SEKTÖR ONAYI (Haziran 2026 LOI'ler)

Üç sektör insiderinden alınan geri bildirim ürüne dönüştü:

| Kim | Geri Bildirim | Ürün Yanıtı |
|---|---|---|
| **Mücahit DEMİRCİ** | "Tek SDK'da game analytics + crashlytics + admob + Sentinel + Auto-Heal + AI = mükemmel. SDK stabilite kritik (Homa bile yaşıyor). Indie'lerde para yok, Rollic alır, modülleri kendi SDK'larına eklemek isteyebilirler." | ✅ Modüler SDK, Circuit Breaker pattern, pricing pivot |
| **Yiğit Öztürk** | "Custom DB rahat, Firebase 100M+ row işkence. Auto-Heal güzel ama her bug remote config ile çözülmez. DB rollback olsa güzel olurdu." | ✅ Industry Benchmark (aggregated), Auto-Heal honest scope, Player State Rollback |
| **Umut Can Eryıldız** | "Claude ile herkes kendi tool'unu yapıyor (commodity riski). AI sadece sizin oyun türüne göre kurgulu. Memory + ANR + GPU farklı davranışlar (Adreno, Mali, PowerVR) kritik." | ✅ Cross-tenant network effect, Game-Type Aware AI wizard, Device Intelligence + new SDK events |

---

## 3. TEKNİK MİMARİ

```
[Unity Oyun]
   │
   ├── AltareAnalytics.cs       → Events + circuit breaker + GPU/RAM/ANR/memory
   ├── AltareAnalyticsBootstrap → KVKK/GDPR consent + auto-init
   ├── AltareConfig.cs           → Remote config real-time (Auto-Heal target)
   └── AltarePlayerState.cs     → 🆕 Snapshot + restore listener
         │
         ▼
[Firestore: games/{gameId}/events/...]
         │
         ├─► aggregateDailyStats (her 30dk)
         ├─► detectAnomalies (her 30dk)               → alerts/{id}
         ├─► aggregateIndustryBenchmark (her 6 saat)  → industry_benchmarks/{type}
         └─► (callable functions on demand)
              ├─► generateAIReport         (Sonnet 4.5, game-type aware)
              ├─► generateAutoHeal         (Opus 4.8, kritik kararlar)
              ├─► applyAutoHeal             → config/active
              ├─► rollbackAutoHeal          → snapshot_before
              ├─► askCopilot                (Sonnet 4.5)
              ├─► generateBenchmark
              ├─► getIndustryBenchmark      🆕 cross-tenant
              ├─► generateGameConcepts
              ├─► fetchMarketIntel
              ├─► fetchAnalyticsOverview    (admin-only GA4)
              ├─► writePlayerSnapshot       🆕
              ├─► listPlayerSnapshots       🆕
              └─► restorePlayerSnapshot     🆕

[Panel] onSnapshot ► tüm Firestore collection'larını real-time
```

**Stack:**
- Frontend: Vanilla HTML/JS + Firebase SDK v11
- Backend: Firebase Cloud Functions Gen2 (Node 20) + Firestore
- AI: **Tiered Routing** — Sonnet 4.5 (default) + Opus 4.8 (Auto-Heal)
- Analytics: Google Analytics Data API (GA4)
- Data: google-play-scraper (Play Store, ToS uyumlu)
- SDK: Unity C# **4 dosya** (modüler — sadece istenenler kullanılır)
- Hosting: Firebase Hosting + Cloudflare CDN
- Auth: Firebase Auth (Anonymous + Email/Password) + Custom Claims
- Cost: ~$80/ay (100 oyun, 1M event) · Margin: ~%85

---

## 4. KULLANICI ROLLERİ

| Rol | Erişim |
|---|---|
| **Anonymous SDK** (oyuncu, otomatik) | Sadece kendi event'lerini yazar, config + restore okur |
| **Developer** (müşteri, self-signup) | Kendi oyunlarını tam yönetir, Industry Benchmark görür |
| **Admin** (founder) | Her şey + Müşteri Yönetimi + Firebase Analytics global + setAdminRole |

Self-signup: `signup.html` → e-posta + şifre + stüdyo adı → 30 saniyede panelde.

---

## 5. SDK v2.3 — Modüler Drop-in Unity Library Kit

Müşteri "SDK İndir" butonuyla zip alır. İçinde **9 dosya** (4 SDK + 5 yardımcı):

### SDK Dosyaları (Modüler)

**1. `AltareAnalytics.cs` (v2.3)** — Ana SDK
- `Initialize("gameId", "Game Name")` — tek satır
- Anonim Firebase Auth + sessionId per app launch
- Event API: `LogEvent("level_start", new() { { "level", n } })`
- `SubmitFeedback(rating, text)`
- **🆕 LogMemoryWarning(usedMb, totalMb)**
- **🆕 LogANR(frameTimeMs)** — auto-detect: frame >5sn = ANR
- **🆕 GPU + Total RAM fingerprint** her event'in deviceParams'ında
- **🆕 Circuit Breaker** — 10 ardışık Firebase fail = SDK kendini disabler, oyun ASLA bloklanmaz
- **🆕 IsHealthy** public property — geliştirici kontrol edebilir
- Otomatik event'ler: `first_open`, `app_open`, `session_start/end`, `fps_warning`, **`memory_warning`**, **`anr_detected`**

**2. `AltareAnalyticsBootstrap.cs`** — Otomatik başlangıç
- `[RuntimeInitializeOnLoadMethod]` ile sahne olmadan başlar
- KVKK/GDPR consent kontrol (`PlayerPrefs.GetInt("app_consent_analytics")`)
- GameId/GameName zip'te pre-filled gelir
- Onay gelene kadar 5sn'de bir polling

**3. `AltareConfig.cs`** — Closed-Loop Remote Config Client
- `Initialize()` + `GetInt/GetFloat/GetString/GetBool(key, default)`
- Firestore real-time listener (`games/{gameId}/config/active`)
- Auto-Heal değişiklik push edince oyun anlık çeker
- `OnConfigUpdated` event
- **APK rebuild olmadan oyun davranışı değiştirme**

**4. `AltarePlayerState.cs` 🆕** — Player State Snapshot & Rollback
- `SaveSnapshot(state, label)` — periyodik veya milestone'da
- `OnRestoreRequested` event — panel restore tetiklediğinde
- `OnSnapshotSaved` event
- Reflection ile AltareAnalytics'tan gameId/playerAnonId çekiyor
- Real-time listener (`pendingRestore` field'ını izler)
- **Whale lost progress veya bugged patch için tek tıkla geri yükle**

### Standart Event Taxonomy

**Otomatik (SDK çağırır):**
- `first_open`, `app_open`, `session_start`, `session_end`
- `fps_warning` (FPS <30, 60sn cooldown)
- **`memory_warning`** (low memory veya 100MB+ growth)
- **`anr_detected`** (frame >5sn)
- `crash_detected` (Unity native)

**Manuel (geliştirici çağırır):**
- `level_start`, `level_complete`, `level_fail`
- `ad_watched`, `rewarded_ad_watched`
- `iap_purchase_success`
- `player_feedback`

### Her Event'te Otomatik Alanlar

`gameId`, `gameName`, `playerAnonId`, `sessionId`, `eventName`, `eventParams`, `timestamp`, `clientTimestamp`, `platform`, `appVersion`, `deviceModel`, **`gpuModel`**, **`totalMemoryMb`**

### Defansif Field Naming (backend yaygın alternatifleri tanır)

- IAP amount: `amount_usd | amount | price_usd | price | value | revenue`
- Level ID: `level | level_id | level_number | lvl`
- Session duration: `duration_seconds | duration | session_duration | duration_s`
- Feedback: `rating|stars|score`, `text|comment|message`

---

## 6. PANEL SEKMELERİ (Sidebar) — v3

### STÜDYO
- **Oyunlarım** — Self-service oyun ekleme, **🆕 5 soruluk wizard** (tür + coreLoop + monetization + deviceTier + description), gameId + apiKey üretimi, SDK İndir butonu
- **Müşteri Yönetimi** (admin-only) — B2B müşteri oluşturma + password reset link
- **Entegrasyon Rehberi** — Türkçe + İngilizce 7 adım

### OYUN ZEKASI
- **Genel Bakış** — 12 KPI: Aktif Oturum, 24s Event, Ort. Oturum, Fail Oranı, Reklam, IAP, FPS, Crash + Firebase Analytics kartları (admin-only) + AI Tespiti
- **Sentinel Uyarıları** — Real-time uyarılar, sidebar'da kırmızı badge
- **Auto-Heal** — AI reçeteleri geçmişi, **🆕 honest scope banner** (config-driven sınırlama)
- **🆕 Device Intelligence** — 4 KPI (ANR / memory / avgFPS / low-RAM ratio) + GPU Family + Problem Devices + RAM Tier
- **🆕 Oyuncu State Rollback** — playerAnonId lookup + snapshot history + tek tıkla restore
- **Canlı Event Stream** — Real-time son 40 event
- **Level Intelligence** — Top 5 problem level + tüm level funnel
- **Crash & Performance** — Genişletilmiş

### PAZAR ZEKASI
- **Pazar Analizi** — Canlı Play Store scraper
- **Benchmark** — Senin oyunun vs Play Store kategori (rakip)
- **🆕 Sektör Benchmark** — Cross-tenant aggregate (Altare'deki tüm aynı tür oyunların anonim medyanı + top %10)
- **Yorum & Sentiment** — Demo (Phase 2: Google Play Review API)

### AI
- **AI Raporu** — **🆕 Game-type aware** (Match-3'te %30 fail normal vs Idle'da yüksek), BLUF formatlı
- **Roadmap Önerileri** — AI Market Strategist (3 oyun konsepti)

### FLOATING WIDGET (sağ alt köşe)
- **AI Copilot** — Robot mark'lı yuvarlak buton, tıklayınca chat
  - Custom Altare SVG mark (hexagonal, blink animation)
  - Free-form soru → gerçek veriyle cevap
  - Context: son 7 gün stats + son AI raporu + **🆕 game-type baseline**

---

## 7. SENTİNEL — 9 ANOMALİ KURALI (v3, +3 yeni)

`detectAnomalies` her 30 dakikada bir çalışır. Her oyun için:
- **Now window:** son 2 saat
- **Baseline window:** son 7 gün
- **Dedupe:** aynı kural 6 saat içinde tekrar tetiklenmez

| Rule ID | Severity | Trigger |
|---|---|---|
| `crash_spike` | critical | Crash/session oranı baseline'in 3x üzeri (min 5 crash) |
| `dau_drop` | high | Aktif oyuncu %40+ düşüş |
| `fps_degradation` | high | FPS uyarı oranı baseline'in 2x üzeri |
| `session_length_drop` | medium | Ort. oturum %30+ düşüş |
| `whale_detected` | info | Tek aralıkta $50+ revenue, ≤5 satın alma |
| `first_revenue` | info | İlk kez gelir geldi |
| **`anr_spike` 🆕** | critical | ANR/session 3x baseline veya >%2 |
| **`memory_pressure` 🆕** | high | memory_warning patlaması, baseline'in 2x üzeri |
| **`gpu_family_crash` 🆕** | high | Belirli GPU ailesinde >%5 crash rate (min 5 crash, 20 event) |

---

## 8. AUTO-HEAL — CLOSED-LOOP AI LIVE-OPS (Honest Scope)

**Akış:**
1. Sentinel uyarı atar → panel'de **"🩺 AI Çözüm Öner"** butonu
2. `generateAutoHeal` → **Claude Opus 4.8** reçete üretir (Sonnet değil — causal reasoning + risk + multi-step planning)
3. Modal açılır: diagnosis, root cause, risk, **changes (key: old → new)**, success criteria, rollback trigger, warnings
4. "Uygula" → snapshot alınır + `games/{gameId}/config/active.values` güncellenir
5. Oyun `AltareConfig.cs` ile **anlık çeker** (no rebuild)
6. Yanlış giderse → `rollbackAutoHeal` → snapshot'tan dönüş

**🆕 Honest Scope (Yiğit önerisi):**
Panel'de sarı banner — kullanıcıyı yanıltmamak için:
> "Auto-Heal **config-driven sorunları** çözer (level zorluk, reklam frekansı, IAP fiyatı, FPS limiti, particle quality). Kod kaynaklı bug'lar için Crash & Performance + AI Copilot. State bozulmaları için **Player State Rollback**."

**Risk Gating:** `risk_level: "high"` reçeteler sadece admin onayı ile uygulanır.

**Standart Config Key Naming Convention:**
- `level_{N}_target_score`, `level_{N}_moves_limit`, `level_{N}_time_limit`
- `ad_frequency_interstitial`, `ad_frequency_rewarded`, `ad_cooldown_seconds`
- `iap_starter_discount_pct`, `iap_currency_inflation_factor`
- `fps_target`, `particle_quality_low_end`, `low_end_device_threshold_mb`

---

## 9. 🆕 GAME-TYPE AWARE AI (Umut Can çözümü)

**Problem:** Generic AI "level fail %30 yüksek" der ama Match-3'te %30 normal, RPG'de çok düşük.

**Çözüm:** Her oyun yaratılırken 5 soruluk wizard:
1. **Tür** — match3 / puzzle / idle / midcore / rpg / action / casino / hyper-casual / strategy
2. **Core Loop** — level-based / session-based / endless / roguelike / open-world
3. **Monetizasyon** — hybrid / iap-heavy / ad-heavy / premium / free-to-play
4. **Hedef Cihaz** — cross-platform / low-end / mid-range / flagship
5. **Açıklama** — 2-3 cümle (opsiyonel)

Bu metadata her AI call'da prompt'a inject edilir + tür-spesifik **endüstri baseline'ları** veriliyor:

```javascript
gameTypeBaseline("match3") = {
  d1_retention_target: "30-40%",
  d7_retention_target: "12-18%",
  avg_session_minutes: "5-10",
  level_fail_rate_normal: "15-30%",
  ad_per_session_typical: "2-4",
  iap_conversion_rate: "1-3%",
}
```

AI artık "%30 fail Match-3'te normal" der, generic bir baseline yerine.

---

## 10. 🆕 DEVICE INTELLIGENCE (Umut Can somut feature)

**SDK v2.3 ile yeni eventler:**
- `memory_warning` (Unity OnApplicationLowMemory + 30sn growth >100MB tracker)
- `anr_detected` (frame >5sn)
- `gpu_model` + `total_memory_mb` her event'in deviceParams'ında

**Backend `buildSummaryData` aggregations:**
- **gpuFamilies:** Adreno / Mali / PowerVR / Apple / NVIDIA / Intel / other / unknown sınıflandırma
  - Her aile için: count, crashes, anrs, fps_warnings
- **topProblemDevices:** crash + ANR*2 skoru ile top 10 cihaz modeli
- **memoryBuckets:** `<2GB` (low) / `2-4GB` (mid) / `4GB+` (high) / unknown
- **avgFps, minFps, maxFps:** fps_warning event'lerinden

**Panel "Device Intelligence" sekmesi:**
- 4 yeni KPI: ANR / memory warn / avg FPS / low-RAM ratio
- **GPU Family Breakdown** bar chart (renk: crash rate)
- **Problemli Cihaz Modelleri** (crash + ANR + FPS skoru)
- **RAM Tier Dağılımı** (low/mid/high)

---

## 11. 🆕 PLAYER STATE ROLLBACK (Yiğit önerisi)

**Use case:** Whale oyuncu progress kaybetti / bugged patch oyuncuları broken state'e attı / yanlış inventory verildi → tek tıkla geri yükle.

**SDK tarafı (AltarePlayerState.cs):**
```csharp
// Oyun acilisinda:
AltarePlayerState.Initialize();

// Periyodik veya milestone'da snapshot:
AltarePlayerState.SaveSnapshot(new Dictionary<string, object> {
    { "coins", PlayerData.Coins },
    { "level", PlayerData.Level },
    { "inventory", PlayerData.Inventory },
}, label: "post_purchase");

// Restore listener:
AltarePlayerState.OnRestoreRequested += (state) => {
    PlayerData.RestoreFrom(state);
};
```

**Cloud Functions:**
- `writePlayerSnapshot` — anonim SDK auth ile yazar (100KB cap)
- `listPlayerSnapshots` — owner/admin browses snapshots
- `restorePlayerSnapshot` — `pendingRestore` queue'e koyar, SDK ceker

**Panel "Oyuncu State Rollback" sekmesi:**
- playerAnonId arama input'u
- Snapshot history listesi (label + tarih + size)
- "↺ Geri Yükle" butonu → confirm modal → restore queue
- Oyuncu oyununa girince state geri yüklenir

**Firestore:** `games/{gameId}/player_snapshots/{playerAnonId}/history/{snapshotId}`

---

## 12. 🆕 INDUSTRY BENCHMARK / NETWORK EFFECT MOAT (Umut Can commodity riskine yanıt)

**Problem:** "ChatGPT/Claude ile herkes kendi tool'unu yapabiliyor" → commodity tehlikesi.

**Çözüm:** 50+ oyun platformda olunca **cross-tenant aggregate** — kimsenin tek başına yapamayacağı şey.

**Scheduled Function (`aggregateIndustryBenchmark`):**
- Her 6 saatte bir çalışır
- Oyunları `gameType` ile gruplar
- **Min 3 oyun** gerekli per kategori (privacy)
- Quantile hesaplar: median, top10, avg
- 7 metrik aggregate:
  1. avgSessionSeconds
  2. levelFailRate
  3. crashRate
  4. fpsWarnRate
  5. adsPerSession
  6. iapRevenuePerPlayer
  7. sessionsPerPlayer

**Firestore:** `industry_benchmarks/{gameType}/daily/{day}`

**Callable (`getIndustryBenchmark`):** Kullanıcı kendi tipinin sektör benchmark'ini çeker.

**Panel "Sektör Benchmark" sekmesi:** Median + top10 + avg gösterimi per metrik.

**Privacy:** Tek bir oyunun verisi cikartilamaz (min 3 oyun, quantile-only).

**Bu Altare'nin asıl moat'ı çünkü:**
- Solo dev kendi tool'unu yapsa bile başka oyunların verisi olmaz
- ChatGPT'nin oyunlar arası benchmark verisi yok
- 50 oyun = $5K/ay paid feature satılabilir

---

## 13. 🆕 SDK CIRCUIT BREAKER (Mücahit stability endişesi)

**Problem:** "Homa bile SDK stabilite problemi yaşıyor. Indie için kritik."

**Çözüm:** SDK çökerse oyunu ASLA bloklamaz.

```csharp
// AltareAnalytics.cs v2.3
private bool _circuitOpen = false;
private int _consecutiveWriteFailures = 0;
private const int CircuitBreakerThreshold = 10;

// 10 ardışık Firebase fail → TripCircuit()
// SDK kendini disabler, oyun devam eder
// Tüm public API'ler circuit check yapıyor
// LogEvent / LogMemoryWarning / LogANR / SubmitFeedback hepsi safe
// WriteEvent try-catch sarmalanmış
// public bool IsHealthy => _ready && !_circuitOpen
```

**Trigger sebepleri:**
- Boot init exception
- Firebase deps unavailable
- Anonymous auth fail
- 10 ardışık write failure
- Write exception threshold

**Sonuç:** Müşteri "SDK çöktü oyunum hatalı çalışıyor" diye şikayet edemez.

---

## 14. 🆕 MODÜLER SDK (Mücahit white-label önerisi)

**Problem:** Büyük stüdyolar kendi SDK'ları varken Altare'yi monolitik almak istemez. "Modülleri kendi SDK'larına eklemek isteyebilirler."

**Çözüm:** 4 dosya tamamen bağımsız:
- `AltareAnalytics.cs` — Ana SDK (standalone)
- `AltareAnalyticsBootstrap.cs` — opsiyonel (auto-init)
- `AltareConfig.cs` — opsiyonel (sadece Auto-Heal için)
- `AltarePlayerState.cs` — opsiyonel (sadece rollback için)

**Public Hosting:**
- `firebase.json` ignore'dan `unity-sdk/**` kaldırıldı
- `altarestudio.com.tr/unity-sdk/AltareAnalytics.cs` browser'da açılır
- Müşteri tek tek modül indirebilir (CDN-friendly)

**SDK Download akışı:**
- `downloadSDK()` `/unity-sdk/` üzerinden fetch → drift olmaz
- Per-game bootstrap inject (gameId placeholders replace)
- Fallback: embedded JS string copies

---

## 15. TIERED AI MODEL ROUTING (Maliyet Optimizasyonu)

```
Copilot sohbet         → Sonnet 4.5   (hız önemli)
AI Raporu              → Sonnet 4.5   (yapılandırılmış JSON)
Benchmark              → Sonnet 4.5   (karşılaştırma basit)
Industry Benchmark     → Sonnet 4.5   (aggregate analysis)
Roadmap konsept        → Sonnet 4.5   (yaratıcı tek atış)
Sentinel teşhis        → kural-tabanlı (LLM gerekmez)
Auto-Heal REÇETE       → Opus 4.8     (kritik, canlıya gidiyor)
Stratejik AI (v2)      → Opus 4.8     (Studio+ tier'a özel)
```

**Maliyet:**
- Sonnet: $3 input / $15 output per 1M token
- Opus: $15 input / $75 output per 1M token (5x)
- Auto-Heal reçetesi ≈ $0.15
- Studio plan'da ($99/ay) tamamen rahat

---

## 16. FIRESTORE VERİ ŞEMASI (Full v3)

```
/developers/{uid}                       B2B müşteri profilleri
  { uid, email, displayName, studioName, tier, gameIds[], createdAt }

/games/{gameId}                          Multi-tenant oyun kaydı
  { gameId, gameName, gameType, coreLoop, monetization, deviceTier,
    description, platforms[], developerId, apiKey, status, createdAt }

  /events/{eventId}                      Unity SDK yazar (anonymous)
    { gameId, gameName, playerAnonId, sessionId, eventName, eventParams,
      timestamp, clientTimestamp, platform, appVersion, deviceModel,
      gpuModel, totalMemoryMb }                                      🆕 GPU/RAM

  /feedback/{feedbackId}                 Player feedback
  /stats/{YYYY-MM-DD}                    aggregateDailyStats yazar
  /alerts/{alertId}                      Sentinel uyarıları (9 kural)
  /ai_reports/{reportId}                 Claude raporları
  /auto_heal/{prescriptionId}            AI Doctor reçeteleri
  /benchmarks/{benchmarkId}              Benchmark snapshot'ları
  /copilot_chats/{chatId}                Copilot geçmiş sohbet
  /config/active                          Closed-Loop Remote Config
    { values: { key: value }, snapshot_before, appliedFrom, version }

  /player_snapshots/{playerAnonId}       🆕 State rollback
    { latestSnapshotId, pendingRestore: { snapshotId, state, requestedAt } }
    /history/{snapshotId}                Snapshot geçmişi
      { playerAnonId, state, label, createdAt, sizeBytes }

/market_intel/{gameType-country}         Play Store scraper
  /competitors/{appId}                   Rakip oyun verisi
  /reviews/{reviewId}                    Yorum verisi

/game_concepts/{uid_type-country-lang}   AI Market Strategist cache

/industry_benchmarks/{gameType}          🆕 Cross-tenant aggregate
  /daily/{YYYY-MM-DD}                    Günlük snapshot
    { gameType, gameCount, sampleSize,
      avgSessionSeconds: {median, top10, avg},
      levelFailRate, crashRate, fpsWarnRate,
      adsPerSession, iapRevenuePerPlayer, sessionsPerPlayer }

/users/{uid}                              Admin allowlist mirror
```

---

## 17. CLOUD FUNCTIONS (16 callable + 3 scheduled)

**Scheduled (otomatik):**
- `aggregateDailyStats` — Her 30dk, oyun istatistiklerini hesaplar
- `detectAnomalies` — Her 30dk, 9 anomali kuralını çalıştırır
- **`aggregateIndustryBenchmark` 🆕** — Her 6 saat, cross-tenant aggregate

**Callable (signed-in developer):**
- `createGame` — Yeni oyun + wizard metadata (gameType, coreLoop, monetization, deviceTier, description)
- `listMyGames` — Developer'ın kendi oyunları
- `deleteGame` — Cascade delete (events, stats, alerts, vb.)
- `markAlertRead` — Sentinel uyarısı okundu

**Callable (gameId-owner check):**
- `generateAIReport` — Claude Sonnet raporu, **game-type aware**
- `generateAutoHeal` — Claude Opus reçetesi
- `applyAutoHeal` — Reçeteyi `config/active`a uygula
- `rollbackAutoHeal` — Snapshot'tan geri dön
- `generateBenchmark` — Kategori karşılaştırma
- `askCopilot` — Free-form chat (game-type aware)
- **`getIndustryBenchmark` 🆕** — Kendi tipinin sektör verisi
- **`writePlayerSnapshot` 🆕** — Player state snapshot save
- **`listPlayerSnapshots` 🆕** — Snapshot history
- **`restorePlayerSnapshot` 🆕** — Restore queue

**Callable (signed-in):**
- `fetchMarketIntel` — Play Store scraper
- `generateGameConcepts` — AI Market Strategist

**Callable (admin-only):**
- `createCustomer` — B2B müşteri + password reset link
- `setAdminRole` — Admin rolü ata/kaldır
- `fetchAnalyticsOverview` — GA4 global (Phase 2: per-customer)

**HTTP (public, login gerektirmez):**
- `publicMarketSearch` — Pazarlama sitesi için
- `publicGameInsight` — Public single-game insight

---

## 18. GÜVENLİK MODELİ

**Firestore rules özet:**
- `/developers/{uid}` — Self-create + self-update (tier admin tarafından)
- `/games/{gameId}` — `developerId` field ile sahiplik (multi-tenant izolasyonu)
- `/games/{gameId}/events` — Anonymous SDK yazar (event shape validation), owner okur
- `/games/{gameId}/config/{configId}` — Anonymous SDK okur, Cloud Functions yazar
- **`/games/{gameId}/player_snapshots/{playerAnonId}/history/...` 🆕** — Anonymous SDK okur (restore listen), Cloud Functions yazar (write/restore)
- `/market_intel/**` — Signed-in herkes okur (public Play Store)
- **`/industry_benchmarks/{gameType}` 🆕** — Signed-in herkes okur (anonim aggregate)
- Default deny

**Cloud Function helpers:**
- `assertSignedIn(request)` — auth zorunlu
- `assertAdmin(request)` — admin claim zorunlu
- `assertOwnsGameOrAdmin(request, gameId)` — developer kendi oyunlarında, admin her şey
- `sanitizeForFirestore(value)` — undefined alanları siler

---

## 19. İŞ MODELİ (v3 — Sektör feedback'i sonrası)

| Tier | Fiyat | Hedef | İçindekiler |
|---|---|---|---|
| **Indie** | **$0 / ay forever** | Solo dev | Tüm panel, Sentinel, basic AI Report, **network effect kanalı** |
| **Studio** | **$99 / ay** | 5-20 kişi | Auto-Heal, Industry Benchmark, sınırsız AI, Player Rollback, e-posta uyarıları |
| **Enterprise** | **$500-2K / ay** | Mid-tier (Rollic ölçeği) | Modüler SDK integration, white-glove, custom AI, dedicated support |
| **Publisher** | **$5K+ / ay** | Büyük yayıncı | White-label, on-prem opt, dedicated infra |

**Auto-Heal tier gate:** Indie tier'da Sentinel görür, "AI Çözüm Öner" Studio+ özelliği.

**Maliyet/müşteri:**
- Sonnet kullanımı: ~$0.30/ay
- Opus (Auto-Heal): ~$1.50/ay
- Toplam: ~$2/müşteri/ay
- Margin: **%97+** Studio tier'da

**Revenue projection (3 yıl):**
- Yıl 1: 60 müşteri (50 free + 8 Studio + 2 Enterprise) → **$33K ARR**
- Yıl 2: 350 müşteri (250 free + 80 Studio + 20 Enterprise) → **$335K ARR**
- Yıl 3: 1,000 müşteri (700 free + 250 Studio + 50 Enterprise) → **$1.2M ARR**

---

## 20. UI ÖZELLİKLERİ

- **TR/EN dil toggle** — Topbar'da EN/TR butonu, `localStorage.altare.lang`
- **AI raporları otomatik dil takibi** — Panel dilinde üretir
- **Real-time everywhere** — Firestore onSnapshot (alerts, events, ai_reports, auto_heal, stats, **player_snapshots**)
- **Floating Copilot Widget** — Sağ alt köşe, özel SVG mark (hexagonal Altare)
- **Sentinel badge** — Sidebar'da kırmızı yuvarlak okunmamış sayısı
- **Mobile responsive** — 520px altı tam ekran copilot

---

## 21. RAKİP ANALİZİ

| Rakip | Güçlü | Zayıf | Altare Farkı |
|---|---|---|---|
| **GameAnalytics** | Bedava, popüler | Pasif, AI yok | Closed-loop + Cross-tenant |
| **Unity Analytics** | Engine entegre | Çıplak metrik | AI-driven actions |
| **AppsFlyer** | UA güçlü | $$$, oyun-içi körlük | Oyun-içi + indie fiyatı |
| **data.ai** | Market verisi | Sadece market | First-party + market birleşik |
| **Mixpanel** | Esnek | Oyun-spesifik değil | Game-type aware |
| **ChatGPT/Claude (raw)** | Akıllı | Oyununa erişim yok | SDK + telemetri + closed-loop |
| **"Kendi yapsam?"** | Solo dev kontrolü | Network effect yok | 50+ oyunun benchmark'ı sende olamaz |

**Altare'nin 3 katmanlı moat'ı:**
1. **Closed-loop:** detect → AI prescribe → apply → rollback
2. **First-party + Market + Cross-tenant** veri birleşimi
3. **Game-type aware AI** playbook'lar (Match-3 ≠ Idle ≠ RPG)

---

## 22. ROADMAP

**Phase 1 (Tamamlandı, Haziran 2026):**
- ✅ Sentinel (9 kural)
- ✅ Auto-Heal (Closed-loop Remote Config)
- ✅ AI Copilot (floating widget)
- ✅ Benchmark + Industry Benchmark (network effect)
- ✅ Device Intelligence (GPU/RAM/ANR)
- ✅ Player State Rollback
- ✅ Game-Type Aware AI
- ✅ Modüler SDK + Circuit Breaker
- ✅ TR/EN i18n
- ✅ Self-service signup

**Phase 2 (1-3 ay):**
- A/B testing — Auto-Heal varyantları (3 reçete, %20-%20-%60 split)
- E-posta uyarıları (Sentinel kritik → mail + Discord webhook)
- Aggregate market reports (50+ oyun verisi → $200-2K rapor satışı)
- Per-customer Firebase Analytics (kendi GA4 property'sini bağlasın)

**Phase 3 (3-6 ay):**
- Crashlytics-style stack trace toplama
- Push notification kanalı (mobile)
- Webhook/API export (büyük yayıncılar)
- BigQuery sink (custom DB rahatlığı için Yiğit'in talebi)

**Phase 4 (6+ ay):**
- White-label SaaS (büyük stüdyo kendi marka altında)
- Multi-engine: Godot, Unreal SDK
- Server-side game state mirror (Yiğit'in tam DB rollback talebi)

---

## 23. MEVCUT TRACTION (Haziran 2026)

- ✅ **Royal Dreams** canlıda: 3,003 DAU, %98.1 crash-free
- ✅ Endonezya pazarı patladı (1,453 aktif, organik)
- ✅ AI raporları (Sonnet 4.5) + Auto-Heal (Opus 4.8) çalışıyor
- ✅ Self-service signup açık
- ✅ SDK v2.3 indirilebilir (4 modüler dosya)
- ✅ TR + EN dil desteği tam
- ✅ AdMob app-ads.txt doğrulandı
- ✅ Multi-tenant güvenlik tam (her müşteri sadece kendi verisi)
- ✅ **3 sektör insiderinden onay** (Mücahit, Yiğit, Umut Can)

---

## 24. SIK SORULAN SORULAR

**Q: ChatGPT/Claude da AI cevap veriyor, Altare neyi farklı yapıyor?**
A: ChatGPT'nin oyunuzun event verisine erişimi yok. Altare SDK olduğu için gerçek telemetriyi okur. Ayrıca:
- Auto-Heal ile **eylem** alır (chat değil, gerçek config push)
- Cross-tenant Industry Benchmark (tek başına yapamazsın)
- Game-Type aware AI (Match-3 vs Idle vs RPG farklı yorumlar)

**Q: SDK'yı projeme entegre edersem oyunum çöker mi?**
A: Hayır. v2.3'te Circuit Breaker pattern var — SDK 10 ardışık Firebase fail edince kendini disabler, oyun **ASLA bloklanmaz**. `IsHealthy` property ile kontrol edebilirsin.

**Q: Hangi veriler toplanır? KVKK uyumlu mu?**
A: Sadece anonim event verisi (playerAnonId UUID, cihazda saklanır). E-posta, telefon, location, kişisel veri YOK. KVKK + GDPR uyumlu. Bootstrap script consent kontrol eder, onay yoksa SDK başlamaz.

**Q: Yeni APK build gerektirmiyor mu?**
A: Auto-Heal değişiklikleri için hayır. SDK'da `AltareConfig.GetInt(...)` kullanılan değerler Firestore'dan çekilir, real-time güncellenir. Yeni level eklemek için tabii ki build gerekir.

**Q: Industry Benchmark için minimum kaç oyun lazım?**
A: Privacy için **min 3 oyun per kategori**. Match-3'te 5 oyunluk benchmark gösterilir, RPG'de 2 oyun varsa "yeterli veri yok" mesajı gelir.

**Q: Auto-Heal her bug'ı çözebilir mi?**
A: Hayır — bu yanlış pozisyonlama olur. Auto-Heal **config-driven sorunları** çözer (level zorluk, reklam frekansı, IAP, FPS limiti). Kod kaynaklı bug için **Crash & Performance + AI Copilot**, state bozulması için **Player State Rollback** kullanın. Banner'da bunu açık yazıyoruz.

**Q: Modüler SDK ne demek?**
A: 4 dosya bağımsız çalışır. Büyük stüdyo sadece istediği modülü kendi SDK'sına alabilir:
- Sadece Analytics → `AltareAnalytics.cs`
- + Auto-Heal → `AltareConfig.cs` eklerek
- + Rollback → `AltarePlayerState.cs` eklerek
- Bootstrap opsiyonel (kendi init'i varsa)

**Q: Aylık maliyet ne kadar?**
A: Indie tier $0 forever. Studio $99/ay. Enterprise $500-2K. Altare'nin altyapı maliyeti müşteri başına ~$2/ay, %97+ marj Studio tier'da.

**Q: Hangi engine desteği var?**
A: Şu an Unity (drop-in C# SDK). Godot ve Unreal Phase 4'te.

**Q: Self-host edebilir miyim?**
A: Enterprise tier'da on-prem opsiyonu olabilir, talep et. Standart kullanım Firebase üzerinden multi-tenant.

**Q: Yiğit Öztürk'ün dediği "DB rollback" ile sizinki aynı mı?**
A: Bizim **player state rollback** (oyuncu seviyesinde). Tam server-side DB rollback (tüm oyun state'i) Phase 4'te gelecek. Şu an oyuncunun kendi state'ini snapshot'tan geri yükleyebilirsiniz.

---

## 25. KISA TAGLİNELAR (Pazarlama İçin)

- "Diğerleri gözlemler. Altare hareket eder."
- "Oyununuzu uyurken iyileştiren AI."
- "Tek panel + tek SDK + tüm sektörün toplu zekası."
- "Closed-loop AI Live-Ops + Cross-tenant intelligence."
- "Tespit → Reçete → 30 saniyede canlı oyunda."
- "Solo dev'den Rollic'e — herkes için aynı altyapı."

---

## 26. İLETİŞİM + BAĞLANTILAR

- **Site:** altarestudio.com.tr
- **Self-signup:** altarestudio.com.tr/signup.html
- **Panel:** altarestudio.com.tr/panel.html
- **SDK download:** altarestudio.com.tr/unity-sdk/ (public)
- **Email:** berkant@altarestudio.com.tr
- **Founder:** Berkant Doğrusöz (LinkedIn'de aktif)

---

*Doküman: 16 Haziran 2026 · Versiyon: 3.0.0*
*Sürüm Notları: Yiğit Öztürk, Mücahit DEMİRCİ, Umut Can Eryıldız geri bildirimleri ürüne dönüştü.*
*Royal Dreams test verileri canlıdan alınmıştır.*
