# Altare AI Live Game Intelligence — Pitch Deck v3

> Hazır kopyala-yapıştır içerik. İş planı, sunum, veya Google Slides için kullan.
> Veriler 2026 Haziran itibarıyla canlı sistemden alınmıştır.
> v3 update: sektörden gelen geri bildirimlere göre konumlandırma + 4 yeni feature.

---

## 1. KAPAK SLIDE

**ALTARE AI**
*The First Closed-Loop AI Live-Ops Platform for Game Studios*

> "Tek panel + tek SDK + tüm sektörün toplu zekası."

Tek satır: **B2B SaaS · Solo dev'den Rollic'e — Closed-Loop AI Live-Ops + Cross-Tenant Benchmark**

---

## 2. PROBLEM

> İndie + midcore stüdyolar oyunlarını yayınladıktan **sonra** kör uçuyor.

- **GameAnalytics** her oyunu çiziyor ama "ne yapmalıyım?" demiyor
- **Unity Analytics** sadece çıplak metrik, eylem önermez
- **AppsFlyer / Adjust** $$$, sadece UA optimize ediyor
- **ChatGPT/Claude** akıllı ama oyununa erişimi yok → tavsiye veremez
- **Studio CEO'su** her sabah panel açıp manuel sayı kontrol ediyor — eğer açarsa
- **Çoğu zaman bir sorunu fark etme süresi: 3-7 gün** — o zamana kadar retention çoktan bozulmuş

**Sonuç:** Stüdyolar live-ops yapamıyor, oyunlar Day-1'de ölüyor.

---

## 3. ÇÖZÜM — Altare AI (3 Katmanlı Closed-Loop)

| Katman | Ne Yapar | Rakip Yok |
|---|---|---|
| **👁️ Observe** | First-party events + Play Store rakip + GA4 toplu | GameAnalytics, Unity Analytics |
| **🚨 Sentinel** | 7/24 anomali tespit (8 kural) + bildirim | **Yok** |
| **💬 Copilot** | Free-form chat — gerçek verinle | **Yok** |
| **📊 Benchmark + Industry Index** | Senin verin vs kategori medyan + top %10 | **Yok** (cross-tenant) |
| **🩺 Auto-Heal** | AI reçete → tek tıkla canlı oyuna push (Remote Config) | **Yok** |
| **🎮 Device Intelligence** | GPU ailesi + RAM tier + ANR breakdown | **Yok** |
| **↺ Player State Rollback** | Whale kaybetti → snapshot'tan geri yükle | **Yok** |
| **🧠 AI Raporu** (game-type aware) | Claude ile haftalık BLUF + tür-spesifik baseline | data.ai (sadece market) |
| **🗺️ Roadmap AI** | Rakip yorumlarından yeni oyun konseptleri | **Yok** |

> **Tek Cümle Pozisyonlama:** *"GameAnalytics + Sentry + Mixpanel + Firebase Remote Config + Claude'un birleşimi — kompleksitesini kaldırmış, oyun stüdyolarına özel."*

---

## 4. ÜRÜN — Canlı Demo Verisi

Royal Dreams (flagship test oyunu, Haziran 2026):
- **Aktif Oturum:** 624 / 24h
- **DAU:** 3,003 · **WAU:** 1,608 · **MAU:** 476
- **Crash-free Rate:** %98.1
- **Top Market:** Endonezya (1,453), Türkiye (105)
- **AI Tespiti (Auto-Heal'in tetiklediği):** "Level 1'de %100 completion bloğu — Level 1 zorluğunu remote config ile düşür → fail rate beklentisi %78 → %42"

---

## 5. KOMPETITIF MOAT — Neden Rakipsiz?

Sektörden gelen geri bildirim: *"Claude/GPT ile herkes kendi panel'ini yapabiliyor."* — DOĞRU. O yüzden bizim moat'ımız panel değil, **3 katmanlı yapısal avantaj**:

### 🏰 Moat 1: Closed-Loop Action
Diğerleri gözlemler, biz **eylem alır**. Sentinel detect → AI prescribe → Remote Config push → Snapshot rollback. ChatGPT'nin yapamayacağı şey çünkü oyun SDK'sı + multi-tenant backend lazım.

### 🏰 Moat 2: Cross-Tenant Network Effect
50+ oyun platformda olunca: **"Sen Match-3 yapıyorsun. Sektör medyanı D1 retention %35. Sen %22'desin. Top %10 oyunlar şu 3 mekaniği kullanıyor."** Bu rakipsiz çünkü tek başına kimsenin 50 oyunun verisi yok.

### 🏰 Moat 3: Game-Type Aware AI
Generic AI "level fail %30 yüksek" der. Bizim AI: *"Match-3'te %30 normal, Idle'da yüksek, RPG'de cok dusuk."* — Çünkü oyun tipini ve core loop'unu biliyoruz, Claude Opus prompt'ları o context'le çalışıyor.

---

## 6. ÜRÜN ÖZELLİKLERİ — TAM LİSTE (v3)

### Studio
- ✅ **Oyunlarım** — Game-type wizard (tür + coreLoop + monetization + deviceTier)
- ✅ **Müşteri Yönetimi** (admin)
- ✅ **Entegrasyon Rehberi** — Türkçe + İngilizce 7 adım

### Game Intelligence
- ✅ **Genel Bakış** — 12 KPI (yeni: ANR, memory warn, avg FPS, low-RAM ratio)
- ✅ **Sentinel Uyarıları** — 8 anomali kuralı (crash_spike, dau_drop, fps_degradation, session_length_drop, whale_detected, first_revenue, **anr_spike**, **memory_pressure**, **gpu_family_crash**)
- ✅ **Auto-Heal** — Claude Opus 4.8 reçete + Remote Config push + snapshot rollback
- ✅ **🆕 Device Intelligence** — GPU ailesi (Adreno/Mali/PowerVR/Apple), RAM tier, problemli cihaz modelleri
- ✅ **🆕 Player State Rollback** — Whale lookup + snapshot history + tek tıkla restore
- ✅ **Canlı Event Stream** — Real-time
- ✅ **Level Intelligence** — Funnel chart
- ✅ **Crash & Performance** — Genişletilmiş ANR + memory tracking

### Market Intelligence
- ✅ **Pazar Analizi** — Play Store scraper
- ✅ **Benchmark** — Kategori medyan
- ✅ **🆕 Sektör Benchmark** — Cross-tenant aggregate (Altare-içi 50+ oyun)
- ✅ **Yorum & Sentiment**

### AI
- ✅ **AI Copilot** (sağ alt köşe floating widget, özel Altare mark)
- ✅ **AI Raporu** — Game-type aware, BLUF formatlı
- ✅ **Roadmap Önerileri** — AI Market Strategist

### SDK (v2.3) — Drop-in Unity Library Kit
- ✅ `AltareAnalytics.cs` — sessionId, FPS, ANR, **memory pressure**, **GPU fingerprint**, **circuit breaker** (Mücahit'in stability endişesi)
- ✅ `AltareAnalyticsBootstrap.cs` — KVKK/GDPR consent, auto-init
- ✅ `AltareConfig.cs` — Remote config real-time listener
- ✅ **🆕 `AltarePlayerState.cs`** — Snapshot save + restore listener
- ✅ Modüler — büyük stüdyolar sadece istedikleri modülü kendi SDK'larına ekleyebilir

---

## 7. TEKNOLOJI YIĞINI

```
Frontend:  HTML + Vanilla JS (no React tax) + Firebase SDK v11
Backend:   Firebase Cloud Functions Gen2 (Node 20) + Firestore
AI:        Tiered routing
           ├── Sonnet 4.5 (Copilot, AI Report, Benchmark, Concepts)
           └── Opus 4.8 (Auto-Heal recipes — kritik kararlar)
Analytics: Google Analytics Data API (GA4)
Data:      google-play-scraper (Play Store, ToS uyumlu)
SDK:       Unity C# 4 dosya (Analytics + Bootstrap + Config + PlayerState)
           ├── Circuit breaker (SDK ölürse oyunu killetmez)
           └── KVKK/GDPR consent flow
Hosting:   Firebase Hosting + Cloudflare CDN
Sec:       Anonymous Auth + Custom Claims + Firestore Rules (multi-tenant)
```

---

## 8. PAZAR (Updated Segmentation — feedback'e göre)

Sektörden geri bildirim: *"Indie'de para yok, Rollic-Homa boyu alır, kendi SDK'larına entegre etmek isterler."* → tier matrisi güncellendi:

| Segment | Eski | Yeni |
|---|---|---|
| **Solo Dev** | Indie tier $0 → $49 | **Top of funnel** (free forever, network effect kanalı) |
| **Small Studio (5-20)** | Studio $49 | **Sweet spot** $99/ay |
| **Mid-tier (Rollic ölçeği)** | Enterprise $299+ | **Asıl para** $500-2K/ay (modüler SDK) |
| **Big Publisher** | Yoktu | **White-label** $5K+/ay |

**TAM:** ~$1.2B global game analytics + tools harcaması
**SAM:** ~$4.8M (Türkçe + İngilizce konuşan, mobil-first stüdyolar)
**SOM (3 yıl):** $360K ARR (yıl 5 → $1.2M ARR)

---

## 9. RAKIP ANALİZİ

| Rakip | Güçlü | Zayıf | Altare Farkı |
|---|---|---|---|
| **GameAnalytics** | Bedava, popüler | Pasif, AI yok | Closed-loop + Cross-tenant |
| **Unity Analytics** | Engine entegre | Çıplak metrik | AI-driven actions |
| **AppsFlyer** | UA güçlü | $$$, oyun-içi körlük | Oyun-içi odaklı + indie fiyatı |
| **data.ai** | Market verisi | Sadece market | First-party + market birleşik |
| **Mixpanel** | Esnek | Oyun-spesifik değil | Game-type aware |
| **ChatGPT/Claude (raw)** | Akıllı | Oyunla bağlantısı yok | SDK + telemetri + closed-loop |
| **"Kendi yapsam?"** | Solo dev kontrolü | Network effect yok | 50+ oyunun benchmark'ı sende olamaz |

---

## 10. SEKTÖRDEN ONAY (LinkedIn LOI)

Junior+senior 3 industry insider feedback'i (Haziran 2026):

> *"Tek SDK'da game analytics + crashlytics + admob + Sentinel + Auto-Heal + AI yorumlaması = mükemmel. Tek panelde her şeyi görmek gerçekten mükemmel."*
> — **Mücahit DEMİRCİ**

> *"Custom DB'den çok rahat, big datadan veri çekmek işkence. Auto-Heal güzel mesela sizdeki, ekiplere satmak için 'değişik birkaç şey bulmak' lazım."*
> — **Yiğit Öztürk**

> *"Performans analizi kısmını mantıklı buldum, memory + GPU farklı davranışlar (Adreno, Mali, PowerVR) çok kritik."*
> — **Umut Can Eryıldız**

Üç geri bildirim de ürüne dönüştü:
- Mücahit → SDK modüler hale getirildi + stability circuit breaker
- Yiğit → Player State Rollback feature'ı + DB rollback altyapısı
- Umut Can → Device Intelligence + GPU/RAM/ANR tracking

---

## 11. İŞ MODELİ (Updated)

| Tier | Fiyat | Hedef | İçindekiler |
|---|---|---|---|
| **Indie** | $0/ay forever | Solo dev | Tüm panel, Sentinel, basic AI Report |
| **Studio** | **$99/ay** | 5-20 kişi | Auto-Heal, Industry Benchmark, sınırsız AI, Player Rollback |
| **Enterprise** | $500-2K/ay | Mid-tier (Rollic ölçeği) | Modüler SDK integration, white-glove, custom AI |
| **Publisher** | $5K+/ay | Büyük yayıncı | White-label, on-prem opt, dedicated infra |

**Revenue projection (3 yıl):**

| Yıl | Toplam Müşteri | Free | Paid Studio | Enterprise | ARR |
|---|---|---|---|---|---|
| 1 | 60 | 50 | 8 (×$99) | 2 (×$1K) | $33K |
| 2 | 350 | 250 | 80 | 20 | $335K |
| 3 | 1,000 | 700 | 250 | 50 | $1.2M |

---

## 12. GO-TO-MARKET

**Faz 1 (0-3 ay): Türkiye Indie Validation**
- BIGG TEAM / TUBITAK programları (~50 hedef)
- 3 sektör insiderinin (Mücahit, Yiğit, Umut Can) tavsiyesi → snowball
- Royal Dreams case study
- **Hedef:** 10 paying customer + 50 free indie

**Faz 2 (3-9 ay): EU + MENA Studios**
- Polonya, Almanya, BAE, İsrail orta ölçek stüdyolar
- Modüler SDK pitch → büyüklere
- **Hedef:** 100 paying customer

**Faz 3 (9-18 ay): Global PLG**
- Self-service (signup.html, 30sn onboarding)
- ProductHunt, IndieHackers, Reddit
- **Hedef:** 500+ paying customer + 50 enterprise

---

## 13. TAKIM + İHTİYAÇ

**Berkant Doğrusöz** — Founder, Full-Stack + Game Dev
- Solo developer, Unity + Web + AI
- Royal Dreams oyununu yaptı (3K DAU canlı)
- 8 haftada Altare AI platformunun tüm core'unu yazdı

**Aranan (büyüme sonrası):**
- Front-end developer
- Customer Success
- Sales (B2B outreach + enterprise)

**Fon İhtiyacı:** TUBITAK BIGG aşaması — ürün hazır, 6-12 ay pazarlama runway

---

## 14. KAPANIŞ

> **GameAnalytics size sayı verir. Altare size eylem verir + sektörel zekayı verir.**

> Solo dev'den Rollic'e — herkes için aynı altyapı, aynı AI, aynı toplu zeka. Modüler SDK ile büyük stüdyolar istedikleri parçayı seçer. Indie'ler için bedava (network effect kanalımız).

> **Diğerleri gözlemler. Altare hareket eder.**

**altarestudio.com.tr/signup.html — 30 saniyede dene.**

---

## EK A — DOSYA ÖZETİ

```
SDK (v2.3, 4 dosya):
├── AltareAnalytics.cs        — events + circuit breaker + GPU/RAM/ANR/memory
├── AltareAnalyticsBootstrap  — KVKK consent + auto-init
├── AltareConfig.cs           — remote config listener (Auto-Heal hands)
└── AltarePlayerState.cs      — snapshot + restore listener

Cloud Functions (Gen2, 16 callable + 3 scheduled):
├── Scheduled: aggregateDailyStats, detectAnomalies, aggregateIndustryBenchmark
├── Game ownership: generateAIReport, generateAutoHeal, applyAutoHeal,
│                   rollbackAutoHeal, generateBenchmark, askCopilot,
│                   getIndustryBenchmark, writePlayerSnapshot,
│                   listPlayerSnapshots, restorePlayerSnapshot
├── Signed-in: fetchMarketIntel, generateGameConcepts, listMyGames,
│              createGame, deleteGame, markAlertRead
└── Admin: createCustomer, setAdminRole, fetchAnalyticsOverview

Firestore Collections:
├── developers/{uid}                       (B2B müşteri profilleri)
├── games/{gameId}                         (multi-tenant, developerId field)
│   ├── events/                            (Unity SDK yazar, anonymous)
│   ├── feedback/, ai_reports/, stats/     (per-day rollup)
│   ├── alerts/                            (Sentinel)
│   ├── auto_heal/                         (Opus reçeteleri)
│   ├── benchmarks/, copilot_chats/        (history)
│   ├── config/active                      (Remote Config — Auto-Heal target)
│   └── player_snapshots/{playerAnonId}    (State rollback)
│       └── history/
├── market_intel/{type-country}/competitors+reviews
├── game_concepts/{uid_type-country-lang}
├── industry_benchmarks/{gameType}/daily/{day}    🆕 cross-tenant
└── users/{uid}                            (admin allowlist)
```

---

## EK B — KOMPETITIF MOAT (3-Layer)

1. **Action Moat:** Closed-loop (Sentinel → AI Doctor → Remote Config push → rollback) — ChatGPT/Claude yapamaz çünkü SDK + backend gerekli
2. **Data Moat (Network Effect):** 50+ oyun platformda olunca cross-tenant benchmark **rakipsiz**. Çıkış engeli yüksek (veri burada).
3. **Domain Moat:** Game-type aware AI playbook'ları — generic Claude/GPT veremez

---

## EK C — SEKTÖREL FEEDBACK → PRODUCT ROADMAP MAPPING

| Geri Bildirim | Kim | Ürün Yanıtı |
|---|---|---|
| "Tek SDK'da her şey" | Mücahit | Modüler SDK + tek-paket onboarding |
| "Indie cebinde para yok" | Mücahit | Pricing pivot: Indie free forever, Studio $99 |
| "SDK stabilite kritik (Homa bile yaşıyor)" | Mücahit | Circuit breaker pattern eklendi |
| "Custom DB rahat, Firebase 100M+ row işkence" | Yiğit | aggregateIndustryBenchmark + materialized views |
| "Auto-Heal sadece config ile çözülemez" | Yiğit | Honest scope banner + Player State Rollback eklendi |
| "DB rollback olsa güzel" | Yiğit | AltarePlayerState.cs + 3 callable function |
| "Modülleri kendi SDK'larına eklemek isteyebilirler" | Mücahit | Modüler dosya yapısı + her dosya bağımsız çalışıyor |
| "AI generic değil, oyun-türü spesifik olmalı" | Umut Can | Game-type wizard + game-type aware prompts + tür baseline |
| "Memory + ANR + GPU breakdown lazım" | Umut Can | memory_warning + anr_detected events + Device Intelligence tab |
| "Adreno vs Mali farklı davranır" | Umut Can | gpu_family_crash anomaly rule + GPU breakdown UI |
| "Şirketler kendi tool'larını yapıyor (commodity riski)" | Umut Can | Network effect moat → aggregateIndustryBenchmark |

---

*Doküman: 16 Haziran 2026. Versiyon: 3.0.0*
*İletişim: berkant@altarestudio.com.tr*
