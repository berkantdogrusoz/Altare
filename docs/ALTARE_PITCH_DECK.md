# Altare AI Live Game Intelligence — Pitch Deck

> Hazır kopyala-yapıştır içerik. İş planı, sunum, veya Google Slides için kullan.
> Veriler 2026 Haziran itibarıyla canlı sistemden alınmıştır.

---

## 1. KAPAK SLIDE

**ALTARE AI**
*Live Game Intelligence Platform*

> "Geliştirici uyumadan biz oyunu izliyoruz."

Tek satır: **B2B SaaS · Indie + Midcore Stüdyolar için 7/24 AI Live-Ops Operatörü**

---

## 2. PROBLEM

> İndie stüdyolar oyunlarını yayınladıktan **sonra** kör uçuyor.

- **GameAnalytics** her oyunu çiziyor ama "ne yapmalıyım?" demiyor
- **Unity Analytics** sadece çıplak metrik veriyor, eylem önermiyor
- **AppsFlyer / Adjust** $$$, sadece UA optimize ediyor, oyun-içi körlüğü çözmüyor
- **Studio CEO'su** her sabah panel açıp manuel sayı kontrol ediyor — eğer açarsa
- **Çoğu zaman bir sorunu fark etme süresi: 3-7 gün** — o zamana kadar retention çoktan bozulmuş

**Sonuç:** İndie stüdyolar live-ops yapamıyor, oyunlar Day-1'de ölüyor.

---

## 3. ÇÖZÜM — Altare AI

Altare 3 katmanlı bir Live-Ops platformudur:

| Katman | Ne Yapar | Rakip Yok |
|---|---|---|
| **🔍 Observe** | Tüm event'leri, FPS, crash, IAP, retention'ı toplar | GameAnalytics, Unity Analytics |
| **🚨 Sentinel** | 7/24 anomali tespiti + otomatik uyarı | **Yok** |
| **💬 Copilot** | Veriyle sohbet — "retention neden düştü?" sor, cevap al | **Yok** |
| **📊 Benchmark** | First-party + Play Store rakip verisini birleştirip karşılaştırır | **Yok** |
| **🧠 AI Raporu** | Claude ile haftalık BLUF formatlı live-ops raporu | data.ai (sadece market) |
| **🗺️ Roadmap AI** | Rakip yorumlarından yeni oyun konseptleri üretir | **Yok** |

> **Tek Cümle Pozisyonlama:** *"GameAnalytics + Sentry + Mixpanel + Claude'un birleşimi — sadece indie/midcore'a özel."*

---

## 4. ÜRÜN — Canlı Demo Verisi (2026 Haziran)

Royal Dreams (flagship test oyunu):

- **Aktif Oturum:** 624 / 24h
- **Toplam Event:** 3,722
- **Ortalama Oturum:** 2dk 25sn
- **Crash-free Rate:** %98.1
- **DAU:** 3,003 · **WAU:** 1,608 · **MAU:** 476
- **Top Market:** Endonezya (1,453), Türkiye (105)
- **AI Tespiti:** "Level 1'de %100 completion bloğu — 149 başlangıç, 0 tamamlanma — teknik bug. Acil bastan tasarla."

> Bu içgörü manuel olarak fark edilemezdi — 6 metriği çapraz okuyup teşhis koymak gerekiyor. Claude bunu otomatik yapıyor.

---

## 5. ÜRÜN ÖZELLİKLERİ — TAM LİSTE

### Studio
- ✅ **Oyunlarım** — Self-service oyun ekleme, gameId + API key üretimi
- ✅ **Müşteri Yönetimi** (admin) — B2B sözleşme sonrası account oluşturma
- ✅ **Entegrasyon Rehberi** — 6 adım Türkçe + İngilizce SDK kurulumu

### Game Intelligence
- ✅ **Genel Bakış** — 8 KPI: Aktif Oturum, Event, Ortalama Oturum, Fail Oranı, Reklam, IAP, FPS, Crash
- ✅ **Sentinel Uyarıları** — 6 anomali kuralı (crash spike, DAU drop, FPS degradation, session length drop, whale detection, first revenue)
- ✅ **Canlı Event Stream** — Real-time Firestore listener, son 40 event
- ✅ **Level Intelligence** — Top 5 problem level + tam level funnel (yeşil win / kırmızı fail bar)
- ✅ **Crash & Performance** — FPS uyarıları, top problem cihazlar

### Market Intelligence
- ✅ **Pazar Analizi** — Canlı Play Store scraper, 6 kategori × 4 ülke
- ✅ **Benchmark** — First-party + kategori medyan + top %10 karşılaştırma
- ✅ **Yorum & Sentiment** — Kategori top 3 vs senin oyunun

### AI
- ✅ **AI Copilot** — Free-form chat, gerçek verine soru sor
- ✅ **AI Raporu** — Claude Sonnet 4.5 ile BLUF formatlı live-ops raporu (TR/EN)
- ✅ **Roadmap Önerileri** — AI Market Strategist, rakip yorumlarından yeni oyun konsepti

### Altyapı
- ✅ **Drop-in Unity SDK** (v2.1) — Tek satırlık Initialize, KVKK/GDPR consent, otomatik session/FPS/crash
- ✅ **Firebase Analytics GA4 entegrasyonu** — DAU/WAU/MAU/ülke dağılımı
- ✅ **TR/EN dil desteği** — Panel ve AI raporları otomatik dil takibi
- ✅ **Multi-tenant güvenlik** — Her müşteri sadece kendi verisini görür

---

## 6. TEKNOLOJI YIĞINI

```
Frontend:  HTML + Vanilla JS (no React tax) + Firebase SDK v11
Backend:   Firebase Cloud Functions Gen2 (Node 20) + Firestore
AI:        Anthropic Claude Sonnet 4.5
Analytics: Google Analytics Data API (GA4)
Data:      google-play-scraper (Play Store, ToS uyumlu)
SDK:       Unity C# (drop-in, Firebase Auth + Firestore)
Hosting:   Firebase Hosting + Cloudflare CDN
Sec:       Anonymous Auth + Custom Claims + Firestore Rules
```

**Maliyet/ay (100 oyun, 1M event):** ~$80
**Marjin:** ~%85 (her müşteri için $19-49 plan)

---

## 7. PAZAR

**TAM (Total Addressable Market):**
- 800K+ aktif Unity geliştiricisi (2026)
- ~30K indie/midcore stüdyo (1-50 kişilik)
- **Yıllık harcama (analytics + tools):** $1.2B

**SAM (Serviceable):**
- Türkçe + İngilizce konuşan, mobil-first stüdyolar: ~8K
- Yıllık ortalama tool harcaması: $600
- **SAM: ~$4.8M**

**SOM (3 yıl):**
- %5 penetrasyon → 400 müşteri × $300/yıl ARPU = **$120K ARR**
- %15 penetrasyon (yıl 5) → **$360K ARR**

---

## 8. RAKIP ANALIZI

| Rakip | Güçlü | Zayıf | Altare Farkı |
|---|---|---|---|
| **GameAnalytics** | Bedava, popüler | Sadece dashboard, AI yok, "ne yapmalıyım?" demiyor | AI Sentinel + Copilot + Benchmark |
| **Unity Analytics** | Engine entegre | Çıplak metrik, Live-Ops desteği yok | Action-oriented AI raporları |
| **AppsFlyer** | UA güçlü | $$$, oyun-içi körlük | İndie fiyatı, oyun-içi odaklı |
| **data.ai** | Market verisi | Sadece market, kendi oyununuza körsünüz | İkisini birleştirir (first-party + market) |
| **Mixpanel** | Esnek | Oyun-spesifik değil, AI yok | Oyun şablonları + Live-Ops AI |

**Altare'nin unfair advantage'ı:**
1. **Tek panelde:** First-party + Market + AI Copilot + Sentinel
2. **İndie fiyatı:** $0 (Indie tier) → $49/ay (Studio) → custom (Enterprise)
3. **Türkçe-native** — bölgesel stüdyo dostu, Anglo-Sakson rakiplerin gözden kaçırdığı pazar

---

## 9. İŞ MODELI

| Tier | Fiyat | Hedef | İçindekiler |
|---|---|---|---|
| **Indie** | $0 / ay | Tek oyun, <10K DAU | Tüm panel, AI Raporu (haftada 1), Sentinel, Copilot (10 mesaj/gün) |
| **Studio** | $49 / ay | 1-5 oyun, <100K DAU | Sınırsız AI, Roadmap konseptleri, Benchmark, e-posta uyarıları |
| **Enterprise** | $299+ / ay | 5+ oyun, white-label | Custom dashboard, dedicated support, API access, on-prem opt. |

**Revenue projection (3 yıl):**

| Yıl | Toplam Müşteri | Free | Paid | ARR |
|---|---|---|---|---|
| 1 | 50 | 40 | 10 (×$49) | $5,880 |
| 2 | 250 | 180 | 70 | $41,160 |
| 3 | 800 | 500 | 300 | $176,400 |

---

## 10. GO-TO-MARKET

**Faz 1 (0-3 ay): Türkiye Indie Topluluğu**
- BIGG TEAM / TUBITAK programları içindeki indie stüdyolar (~50 hedef)
- TalkGameDev, GameTR Discord, Unity Türkiye topluluğu
- Royal Dreams case study (gerçek veri ile)
- **Hedef:** 10 paying customer

**Faz 2 (3-9 ay): EU + MENA**
- Polonya, Almanya, BAE, İsrail indie sahnesi
- Unite konferansları, GDC side-events
- İngilizce content marketing
- **Hedef:** 75 paying customer

**Faz 3 (9-18 ay): Global Self-Service**
- Product-led growth (signup.html'den 30sn'de panelde)
- ProductHunt, IndieHackers, Reddit gamedev
- **Hedef:** 300 paying customer

---

## 11. TRACTION (Gerçek Veriler)

✅ **Sistem canlıda:** altarestudio.com.tr
✅ **Royal Dreams entegre** — 3,003 DAU, %98.1 crash-free
✅ **Endonezya pazarına girmiş** — 1,453 aktif oyuncu
✅ **AI raporları üretiliyor** (Claude Sonnet 4.5)
✅ **Self-service signup açık** (signup.html)
✅ **SDK indirilebilir** (Unity drop-in zip)
✅ **TR + EN dil desteği**
✅ **AdMob app-ads.txt doğrulandı**

---

## 12. TAKIM + İHTIYAÇ

**Berkant Doğrusöz** — Founder, Full-Stack
- Solo geliştirici, Unity + Web + AI
- Royal Dreams oyununu yaptı ve canlıya aldı

**Aranan (büyüme sonrası):**
- Front-end developer (panel UX iyileştirme)
- Customer Success (onboarding + müşteri ilişkileri)
- Sales (B2B outreach)

**Fon İhtiyacı:** TUBITAK BIGG aşaması — ürün hazır, 6-12 ay pazarlama runway

---

## 13. KAPANIŞ

> **GameAnalytics size sayı verir. Altare size eylem verir.**

> Altare AI ile geliştirici uyurken oyun izleniyor. Sabah açtığında "şu level'da bug var, şu cihazda crash arttı, kategori medyanın üstündesin" diyen bir copilot bekliyor.

> Bu sadece bir panel değil — **AI Live-Ops Operatörü.**

**altarestudio.com.tr/signup.html — 30 saniyede dene.**

---

## EK A — TEKNIK MIMARI ŞEMASI

```
[Unity Oyun] --SDK--> [Firestore games/{gameId}/events]
                          |
                          ├─> [aggregateDailyStats] --30dk--> [stats/{day}]
                          ├─> [detectAnomalies]    --30dk--> [alerts/{id}] --bildirim--> [Panel]
                          └─> [Panel real-time onSnapshot] ---> [Müşteri Dashboard]

[Müşteri Soru] --askCopilot--> [Claude + Game Context] --> [Cevap]
[Konsept İstek] --generateGameConcepts--> [Play Store Scraper + Claude] --> [3 oyun fikri]
[Benchmark]   --generateBenchmark--> [First-party + Play Store + Claude] --> [Karşılaştırma]
[AI Rapor]    --generateAIReport--> [Claude BLUF formatlı] --> [Live-Ops Raporu]
```

## EK B — KOMPETITIF MOAT

1. **Veri Birleştirme Moat'ı:** İlk-parti event + Play Store market verisini tek panelde birleştirmek — hiçbir rakip yapmıyor
2. **AI Copilot Moat'ı:** Free-form sohbet ile gerçek veriye sorgu — generic AI panellerinden ileri
3. **Sentinel Moat'ı:** Proactive notification — rakipler pasif dashboard
4. **Bölgesel Moat:** Türkçe + İngilizce native, MENA + TR pazarı için ideal
5. **Self-Service Moat:** 30 saniye signup → SDK indir → canlı veri (rakipler sales-led)

---

*Bu doküman 13 Haziran 2026 itibarıyla canlı sistemden hazırlanmıştır. Tüm rakamlar gerçek veriden alınmıştır.*
