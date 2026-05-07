# Altare AI Live Game Intelligence System

## Kritik Linkler

- **Altare GitHub:** https://github.com/berkantdogrusoz/Altare
- **Altare Web Sitesi:** Yayında (şirket sitesi)
- **TÜBİTAK BiGG sunumu:** 13 Temmuz 2026
- **Başvuru başlığı:** "Altare, AI destekli mobil oyun geliştirme"

> Bu doküman Altare şirket vizyonunu, Altare AI Live Game Intelligence platformunun mimarisini ve uzun vadeli iş modelini içerir. Royal Dreams (bu repo) ve Crimson Scar (eş proje) bu sistemin ilk entegre olacağı oyunlardır.

---

## 1. Vizyon

Altare sadece mobil oyun yapan bir stüdyo değil, **AI destekli mobil oyun geliştirme/operasyon platformu**dur.

Tek cümle: *"Indie/küçük stüdyoların kanayan yarası olan 'oyunum yayınlandı, şimdi ne yapacağım?' sorusunu çözen AI operating system'i kuruyoruz — ve bunu önce kendi oyunlarımızda kanıtlıyoruz."*

---

## 2. Üç Aşamalı Büyüme

### Aşama 1: Bugün (Solo / küçük stüdyo)
- Çıktı: Royal Dreams (5. oyun) + Crimson Scar (mid-core, dungeon map)
- Gelir hedefi: ilk hit, IAP/reklam geliri, kullanıcı tabanı
- AI rolü: kendi oyunlarımızda dogfooding — Altare AI'ı kendi ihtiyacımız için yapıyoruz
- BiGG için kanıt: "kendi acımızdan doğdu, kendimiz kullanıyoruz" hikayesi

### Aşama 2: Validation (BiGG yatırımı sonrası)
- Çıktı: 2-3 ek Altare oyunu + Altare AI Panel iç kullanımda olgun
- Gelir: kendi oyunlarımızdan + AI sayesinde retention/monetizasyon yükselişi
- Kanıt birikimi: case study'ler ("Royal Dreams Level X drop-off'unu AI ile çözdük, retention %Y arttı")
- AI rolü: live-ops + market intel + roadmap önerisi

### Aşama 3: Scale (2-3 yıl sonra)

**A. Publisher arm**
- Diğer stüdyoların oyunlarını yayınlıyoruz
- Altare AI Panel'i bu oyunlara da entegre ediyoruz
- Revenue share modeli — biz pazarlama + AI live-ops, onlar oyun yapımı

**B. SaaS Panel (B2B)**
- Stüdyolara abonelik: Altare AI Panel — aylık fee / studio
- Tier'lar: Indie / Studio / Enterprise
- Bu noktada Altare bir **game studio** değil, **game intelligence platform** olarak konumlanır

### Pozisyonlama (aşamalara göre)
- **Aşama 1:** "Mobil oyun stüdyosuyuz."
- **Aşama 2:** "AI ile kendi oyunlarımızı optimize eden stüdyoyuz."
- **Aşama 3:** "Indie stüdyoların AI live-ops platformuyuz — biz de kullanıyoruz."

### Aşama Geçiş Kriterleri
| Geçiş | Şart |
|---|---|
| 1 → 2 | BiGG fonu + ilk oyunda anlamlı kullanıcı tabanı |
| 2 → 3 | Altare AI Panel dahili olarak en az 3 oyunda kanıt + ilk publishing partneri |
| 3+ | SaaS müşteri sayısı + publishing portfolio |

---

## 3. Sistem Mimarisi (Üst Seviye)

```
                   ┌── First-party events (Firebase)         (Katman 1)
                   │
Altare AI Engine ──┤
                   │
                   └── Public market data (Play Store)        (Katman 2)
                              │
                              ↓
                    AI Analysis Pipeline
                    (Live-ops + Market + Strategy roles)
                              ↓
                    Altare Web Panel (/altare-ai-panel)
                    ├── Game Health Tab    (Katman 1)
                    ├── Market Intel Tab   (Katman 2)
                    └── Roadmap Tab        (cross-katman öneriler)
```

**Detaylı pipeline:**

```
Unity Game (AltareAnalytics.cs)
      ↓ event log
Firebase (Firestore)
      ↓ real-time
Next.js Backend API
      ↓ POST /api/altare-ai-report
OpenAI / Claude (Live-Ops + Market Analyst + Product Strategist prompt'ları)
      ↓ structured report
Altare Web Panel — şirket içi dashboard
```

---

## 4. İki Katman

### Katman 1 — Internal Game Ops
Bizim oyunlarımızdan toplanan first-party veri → live-ops kararları

**Toplanacak veriler:**
- Altare oyunlarındaki `level_start`, `level_fail`, `level_complete` gibi oynanış event'leri
- Session süresi, günlük oynama sayısı, oyunda kalma süresi
- Reklam izleme ve IAP satın alma event'leri
- Crash, FPS uyarısı, cihaz modeli, oyun versiyonu (teknik kalite sinyalleri)
- Oyuncunun oyun içinden gönderdiği feedback
- Google Play'de Altare oyunlarına yazılan store yorumları

**TOPLANMAYACAK / DENENMEYECEK:**
- Kullanıcının başka uygulamaları
- PII (email, isim, telefon, lokasyon)
- Genel Google Play hesap verisi

### Katman 2 — Market Intelligence
Public store verisi → roadmap / ideation / farklılaşma stratejisi

**Veri kaynakları (hepsi public/legal):**
- Google Play public store listing (kategori, rating, install count, description/vaatler)
- Public Play Store yorumları (Top N most helpful, son N gün)
- App Store eşleniği (RSS feed + paid API'lerden seçim)
- Trend metrikleri (paid: Sensor Tower / data.ai / AppMagic — MVP'de google-play-scraper yeterli)

---

## 5. AI'ın 3 Rolü

1. **Live-Ops Expert** — *"Bugün oyununda neyi düzeltmeliyim?"*
2. **Market Analyst** — *"Kategorinde ne oluyor, kim ne vaat ediyor, yorumlar ne diyor?"*
3. **Product Strategist** — *"Sıradaki oyun ne olmalı, mevcut hit'lerden hangisini farklılaştırarak alabiliriz?"*

### Beklenen AI Çıktı Şablonu (örnek hibrit cümle)

> *"Royal Dreams Level 18'de drop-off var. Aynı kategoride Top 10'daki X oyunu bu noktada hint sistemi sunuyor, yorumlarda 'yardımsız geçilmiyor' diyenler %23'tü ve patch'le düzelttiler. Önerim: Hint sistemi + drop-off level'larda yumuşatma. Yan fırsat: Kategoride 'cozy decoration' temasının yorumlarda parlamış olduğunu görüyorum, sıradaki projede bunu Match-3'le hibritleyebilirsin."*

### AI Rapor Bölümleri

**Katman 1 (live-ops):**
1. Overall Game Health
2. Player Behavior Analysis
3. Level Difficulty & Drop-off
4. Top 3 Problematic Levels
5. Monetization Insights (Ads / IAP)
6. Crash & Performance Issues
7. Player Feedback Summary
8. Pre-Marketing Risk Analysis
9. Top 5 Immediate Actions
10. Next Update Recommendations
11. Priority Labels (Critical / High / Medium / Low)

**Katman 2 (market intel — yeni):**
- Competitor Snapshot (kategoride Top N oyun, rating dağılımı, fiyatlama, monetizasyon modeli)
- Review Sentiment Comparison (bizim oyunumuz vs rakipler — neye övgü, neye şikayet)
- Promise Analysis (rakiplerin store description/vaatleri vs gerçek deneyim — boşluklar)
- Trend Signals (kategoride yükselen mekanikler/temalar)
- **Next Project Recommendations** — "Bu hit oyunu şu farkla yapsan tutar" gibi data-driven öneri
- **Differentiation Map** — boş kalan/zayıf işlenmiş niche'ler

### AI Kuralları
- No generic advice
- Must be data-driven
- If data is insufficient, state it clearly

---

## 6. Modüller (8 Parça)

### Part 1 — Unity SDK (`AltareAnalytics.cs`)
Reusable, drop-in script. Oyunlara minimum invasive entegre olur.

```
CLASS: AltareAnalytics
FUNCTIONS:
  - Initialize(gameId, gameName)
  - LogEvent(eventName, parameters)

REQUIRED EVENTS:
  - session_start / session_end
  - level_start / level_complete / level_fail
  - moves_left
  - boosters_used
  - ad_watched / rewarded_ad_watched
  - iap_purchase_success
  - player_feedback
  - fps_warning
  - crash_detected

EVENT STRUCTURE:
{
  gameId, gameName,
  playerAnonId,        // lokal UUID, anonymous
  eventName, eventParams,
  timestamp, platform,
  appVersion, deviceModel
}
```

### Part 2 — Firebase Data Layer (Firestore)
```
games/{gameId}/events/{eventId}
games/{gameId}/feedback/{feedbackId}
games/{gameId}/ai_reports/{reportId}
games/{gameId}/stats/{dailyStats}

market_intel/{categoryId}/competitors/{appId}
market_intel/{categoryId}/trends/{snapshotId}
roadmap_suggestions/{suggestionId}
```

Gereklilikler:
- Real-time listeners (`onSnapshot`)
- Aggregation desteği
- Last 24h / 7 days queries

### Part 3 — Altare Web Panel (Next.js)
**Route:** `/altare-ai-panel`

**Tab'lar:**
1. Game Selector
2. Live Event Stream
3. Game Health Dashboard (Katman 1)
4. Level Intelligence
5. Crash & Performance
6. Player Feedback / Reviews
7. AI Report Panel
8. Market Intel (Katman 2 — yeni)
9. Roadmap (cross-katman öneriler — yeni)

**Live Metrics:**
active sessions, total events, fail rate, most failed level, avg session duration, ad interactions, purchase count, fps warnings / crash count

**Erişim:** Altare çalışanlarına şirket sitesi üzerinden login ile (klasik gizli dashboard).

### Part 4 — Backend API
**Endpoint:** `POST /api/altare-ai-report`

**Request:**
```
{
  gameId, gameName,
  timeRange: "last_24h" | "last_7d",
  provider: "openai" | "claude",
  summaryData: {
    levelStats, sessionStats,
    monetizationStats, crashStats,
    feedbackText
  }
}
```

**Response:**
```
{ success: true, report: string, createdAt: timestamp }
```

### Part 5 — AI Analysis Engine
3 ayrı system prompt: live-ops expert, market analyst, product strategist. Provider switch (OpenAI/Claude). Output structured (yukarıdaki bölümler).

### Part 6 — Otomasyon
- **Manual:** "Generate AI Report" butonu
- **Automatic:** her 30-60 dakika cron / scheduler
- Saved to: `games/{gameId}/ai_reports`

### Part 7 — Güvenlik
- API keys server-side only, frontend'de yok
- Firestore rules — write kısıtlı
- Player IDs anonymous
- No personal data collection
- Market scraper public store endpoint'lerini kullanır, ToS-safe yöntemler

### Part 8 — Extensibility
- Multi-game (gameId based)
- Easy Unity integration (drop-in script)
- Future BigQuery integration
- Future Google Play Review API integration
- Aşama 3'te tenant isolation (SaaS müşterileri ayrı namespace)

---

## 7. MVP Teslim Kriterleri

- Unity test event'leri Firebase'e başarıyla gidiyor
- Firebase event'leri saklıyor
- Panel canlı veriyi gösteriyor
- "Generate AI Report" butonu çalışıyor
- AI raporu UI'da render ediliyor
- Royal Dreams entegre
- Sistem başka oyunlar için reusable

---

## 8. BiGG Pitch Çekirdek

> *"Biz sadece oyun yapan bir stüdyo değiliz. Indie/küçük stüdyoların kanayan yarası olan 'oyunum yayınlandı, şimdi ne yapacağım?' sorusunu çözen AI operating system'i kuruyoruz — ve bunu önce kendi oyunlarımızda kanıtlıyoruz."*

| Boyut | Avantaj |
|---|---|
| Pazar | Indie/solo dev pain = milyonlarca dev, hepsi acı çekiyor |
| Moat | Kendi oyunlarımızdan veri = AI'ı kalibre eden gerçek battlefield |
| Defensibility | Aşama 3'te ürün AI panel; oyunlar case study |
| Revenue diversity | Game IAP + Publishing share + SaaS = 3 kol |
| AI hype-uyumu | "AI mobil oyun ops" — TÜBİTAK BiGG için tatlı kombinasyon |

---

## 9. Kritik Yasal Çizgi

| OK | NOT OK |
|---|---|
| First-party Altare oyun event'leri | Kullanıcının başka uygulamaları |
| Anonim `playerAnonId` (UUID) | PII (email, isim, telefon) |
| Cihaz modeli, OS versiyonu | Lokasyon |
| Kullanıcının kendi gönderdiği in-game feedback | Genel Google Play hesap verisi |
| Public Play Store listing/rating/yorum | Scraping ToS ihlal eden yöntemler |

---

## 10. Geliştirme Sırası (Local sonrası başlangıç)

1. **Unity SDK** (`AltareAnalytics.cs`) — Royal Dreams'e drop-in entegre
2. **Firebase** schema + security rules
3. **Backend** Next.js API skeleton + AI report endpoint
4. **Market scraper** Node.js job (google-play-scraper paketi)
5. **Panel** Next.js UI — 3 tab (Health / Market / Roadmap)
6. **AI prompt engineering** — 3 rol için ayrı system prompt'lar
7. **Crimson Scar** entegrasyonu (Royal Dreams pattern'iyle)

Her adım minimum invasive: mevcut oyun kodları bozulmaz, sadece event log çağrıları eklenir.

---

## 11. Repo Organizasyonu

```
Altare/
├── unity-sdk/          # AltareAnalytics.cs + Unity package
├── firebase/           # Firestore rules + Cloud Functions
├── docs/               # ALTARE_AI_VISION.md
├── js/                 # Web shared modules (firebase init, auth)
├── assets/             # Static site assets
├── index.html          # Marketing site
├── panel.html          # /altare-ai-panel dashboard
├── login.html          # Auth gate
└── ...                 # privacy/terms/sitemap
```

---

## 12. Sözlük

| Terim | Anlam |
|---|---|
| Altare | Şirket adı + platform adı |
| Royal Dreams | 5. oyun, Match-3 + Match Game (Kingdom modu) + Block Puzzle (Tetris) |
| Crimson Scar | Eş proje, mid-core dungeon mapli oyun |
| AltareAnalytics | Unity SDK class adı |
| Altare Panel | Web dashboard (Next.js) |
| Live-Ops | Yayınlanmış oyunun canlı yönetimi (events, balancing, hotfix) |
| First-party data | Bizim oyunumuzdan, kullanıcı consent'i ile toplanan veri |
| BiGG | TÜBİTAK Bireysel Genç Girişim destek programı |
