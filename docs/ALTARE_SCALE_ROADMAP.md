# Altare — Ölçeklenme & Yatırım Yol Haritası

> **Bu doküman ne DEĞİL:** vizyon (bkz. `ALTARE_AI_VISION.md`), pitch anlatısı
> (bkz. `ALTARE_PITCH_DECK.md`), özellik listesi (bkz. `ALTARE_FULL_SPEC.md`).
>
> **Bu doküman ne:** BiGG yatırımı sonrası "ciddi veri platformu" hedefine
> giderken **hangi teknik kararların bizi taşıyacağı, hangilerinin bizi baştan
> yazdıracağı**. Mevcut kod tabanının satır satır incelenmesine dayanır —
> genel startup tavsiyesi değil, Altare'ye özel tespitlerdir.
>
> Son güncelleme: 2026-09 · Kapsam: `firebase/functions/`, `unity-sdk/`, `panel.html`

---

## 0. Tek cümlelik özet

**Ürün fikri doğru, mimari yanlış yerde duruyor.** Kapalı döngü (Auto-Heal) ve
sektörel benchmark gerçek birer rekabet avantajı; ama event akışı doküman
başına ücretlendirilen bir veritabanında tutuluyor ve bu, ölçeklendiğimizde
hem finansal hem teknik olarak sürdürülemez. Yatırım öncesi çözülmesi gereken
tek yapısal borç budur.

---

## 0.1 DURUM PANOSU

> Bu bölüm **her oturumdan sonra güncellenir.** Amacı tek soruya dürüst cevap
> vermek: *nerede duruyoruz?*

### Skor

| Alan | Durum | Oran |
|---|---|---|
| **Denetimde çıkan canlı hatalar** | ✅ Hepsi kapatıldı ve yayında | **8 / 8** |
| **Faz 1** — maliyet + veri kaybı | 🟢 Neredeyse tamam | **7 / 8** |
| **Faz 2** — veri katmanı + retention + huni | 🟡 İlerliyor | **4 / 6** |
| **Faz 3** — A/B test + kurumsal güven | 🟢 Neredeyse tamam | **3 / 4** |
| **Paralel** — benchmark, çoklu platform, KVKK | 🔴 Başlanmadı | **0 / 4** |
| **Yol haritası toplamı** | 🟡 İlerliyor | **14 / 22** |

### Daha güvenli miyiz? — Evet, ama sınırlı biçimde

**Kapatılanlar (hepsi canlıyı etkileyen gerçek risklerdi):**

- Auto-Heal artık çalışıyor — ürünün kalbi ölü değil
- SDK doğru projeye yazıyor ve her oyunda başlıyor — veri gerçekten akıyor
- `ingestEvents` şema paritesi kuruldu → **yanlış Sentinel alarmı → canlı oyuna
  hatalı config yazımı** zinciri kırıldı
- Yanlış API anahtarı artık reddediliyor; anahtarlar kriptografik üretiliyor
- Panelden inen SDK paketi derleniyor
- **Gerçek retention ölçülüyor** — kohort bazlı D1/D7/D30, uydurma değil
- **Auto-Heal artık ölçülüyor** — reçete %100 trafiğe değil, %10'luk bir
  dilime uygulanıp kontrol grubuyla karşılaştırılabiliyor; zarar veriyorsa
  sistem kendiliğinden durduruyor (§4.2)
- **Remote Config ve A/B artık Firebase'siz** — `AltareConfig.cs` Firebase
  olmayan bir projede derlenmiyordu bile; A/B de bu kanaldan dağıtıldığı için
  Faz 3'ün tamamı yalnızca Firebase'li oyunlarda çalışabilirdi
- **Panelden inen pakette sessiz sürüm kayması kapatıldı** — gömülü yedek
  kopyalar v2.1.0'da donmuştu (Firestore'a doğrudan yazan, "veri panele hiç
  ulaşmıyor" hatasının kaynağı olan sürüm); fetch bir kez başarısız olsa
  müşteri sessizce o bozuk SDK'yı indiriyordu

**Hâlâ açık olanlar — bunları bilerek taşıyoruz:**

| Risk | Durum | Neden bekliyor |
|---|---|---|
| Event akışı doküman başına ücretli DB'de | 🔴 Dokunulmadı | Faz 2'nin kendisi. Ölçeklenince hem maliyet hem sorgu duvarı. |
| `EVENT_CAP = 10000` kırpması | 🔴 Duruyor | AI raporları hâlâ **eksik veriyle** çalışıyor |
| ~~SDK event başına 1 yazma, çökmede kayıp~~ | ✅ Kapatıldı | SDK v3.0 |
| `ingestEvents` anahtarı **zorunlu değil** | 🟡 Yumuşak geçiş | ChopHero güncellenmeyecek; zorunlu yapılırsa akış kesilir |
| ChopHero `sessionId` göndermiyor | 🟡 Kabul edildi | Kullanıcı kararı. O oyunun oturum metriği yanlış kalır. |
| ~~`retentionD1Proxy` yanıltıcı adı~~ | ✅ Düzeltildi | AI'ın retention uydurması da engellendi (§4.4) |
| ~~A/B testi yok, Auto-Heal ölçülemiyor~~ | ✅ Kapatıldı | §4.2 — deney altyapısı + guardrail nöbetçisi |
| ~~Huni (funnel) dönüşüm analizi~~ | ✅ Kapatıldı | Sıralı yol + olgunlaşma kuralı; ölçülünce AI'ın yasağı otomatik kalkıyor |
| Denetim kaydı, veri silme API'si, DPA | 🔴 Yok | Faz 3 / §5. Kurumsal satışın ön koşulu. |

### Testler — neyin doğruluğu kanıtlı

Deploy öncesi tek komut: `bash tools/test-all.sh` (ağ, emulator, Unity gerekmez)

| Ne | Kontrol |
|---|---|
| A/B deney motoru — atama, istatistik, karar kuralları | 116 |
| Huni analizi — sıralı yol, olgunlaşma, dönüşüm | 85 |
| AI bağlam bloğu — uydurma yasağı iki yönlü | 60 |
| İstemci/sunucu hash paritesi (C# modeli ≡ JavaScript) | 1919 |
| `AltareJson` ayrıştırıcı (≡ `JSON.parse`, 400 fuzz yapısı dahil) | 43 |
| Panel deney kartı render'ı (bozuk/eksik veri dahil) | 40 |
| Panel huni kartı render'ı (bozuk/eksik veri dahil) | 34 |
| Unity SDK C# yapısal denge | 6 dosya |

Bunlar süs değil: parite testi, istemci ile sunucunun **tek bit** ayrışması
hâlinde her deneyin sessizce "fark yok" demesini engelliyor — o hata hiçbir
log üretmez, yalnızca sonuçları rastgeleleştirir.

### Tek cümlelik dürüst özet

**Yanan evi söndürdük, evin oturma odasını da döşedik; temel hâlâ eski.**
Bugün çalışan, güvenli, demoya hazır ve artık **kendi etkisini ölçebilen**
bir sistem var. Ölçeğe ve yatırımcı denetimine dayanacak bir sistem için
kalan tek yapısal borç Faz 2'nin veri katmanı (§2) — event akışı hâlâ
doküman başına ücretlendirilen bir veritabanında.

---

## 1. Mevcut durum — dürüst envanter

### Sağlam olan (dokunma, koru)

| Alan | Durum |
|---|---|
| Kapalı döngü mimarisi | Anomali → AI teşhis → Remote Config reçetesi → uygula → geri al. **Ürünün kalbi.** |
| Multi-tenant izolasyon | `developerId` bazlı Firestore rules, default-deny, AI çıktılarına client yazamıyor |
| Unity SDK v3.0 | **Firebase gerektirmiyor** — toplu gönderim, diske yazan kuyruk, akıllı retry. Her tür oyuna 2 dosyayla girer. |
| Circuit breaker | SDK arka arkaya hata alırsa kendini kapatıyor, oyunu asla bloklamıyor |
| `ingestEvents` HTTP ucu | **Stratejik olarak en değerli son eklemelerden biri** — bkz. §2.3 |
| AI katmanı | Katmanlı model yönlendirme (Opus/Sonnet/Haiku), rapor + copilot + benchmark + konsept |

### Kırılgan olan (bu doküman bunun içindir)

| Alan | Sorun | Durum | Bölüm |
|---|---|---|---|
| Event depolama | Doküman başına ücretli DB'de append-heavy analitik yük | 🔴 Duruyor | §2 |
| ~~SDK gönderim~~ | ~~Event başına 1 yazma, bellekte tampon, çökmede kayıp~~ | ✅ v3.0'da kapatıldı | §3 |
| ~~Ürün derinliği~~ | ~~Retention / kohort / huni analizi yok~~ | ✅ Üçü de eklendi | §4.4 |
| Kurumsal hazırlık | Veri silme API'si, denetim kaydı, DPA yok | 🔴 Duruyor | §5 |
| ~~Ingest şema/kimlik~~ | ~~`sessionId` eksikti, kimlik doğrulaması yoktu~~ | ✅ Kapatıldı | §7 Faz 1 |

---

## 2. KRİTİK: Veri katmanı

### 2.1 Sorun — kanıtlarıyla

Şu an `AltareAnalytics.WriteEvent` her event için Firestore'a **ayrı bir
doküman** yazıyor. Firestore doküman başına ücretlendirir; okuma da ayrı
ücretlidir. Bu, analitik iş yükü için yanlış fiyat modelidir.

**Kodun kendisi bunu zaten itiraf ediyor.** `buildSummaryData` içinde:

```js
// Hard cap: en fazla 10K event isle (timeout korumasi).
// Büyük oyunlarda 24sa'de 30K+ event olabilir, hepsini cekmek 60sn+ surer.
const EVENT_CAP = 10000;
```

Yani şu an veriyi **kırparak** hayatta kalıyoruz. Bu bir yama, çözüm değil.
30 bin event'in 10 bini işlenip 20 bini atılıyorsa, ürettiğimiz AI raporu ve
benchmark **eksik veriye dayanıyor** demektir. Bu, satış konuşmasında
savunulamaz bir noktadır.

### 2.2 Maliyet büyüklüğü (mertebe tahmini)

> Aşağıdaki rakamlar **yaklaşık ve illüstratiftir** — güncel Firestore
> fiyatlarıyla kendi bölgemize göre yeniden modellenmelidir. Amaç kesin
> rakam vermek değil, **mertebe farkını** göstermektir.

100 bin günlük aktif kullanıcılı **tek** bir oyun, oturum başına ~50 event
gönderirse günde ~5 milyon yazma eder. 20 oyunlu bir portföyde bu günde
~100 milyon yazma demektir. Doküman başına ücretlendirmede bu, aylık
**dört haneli dolar** bandına çıkar — üstelik bu sadece *yazma*; her AI
raporu ve her 30 dakikada bir çalışan toplulaştırma o dokümanları tekrar
*okur*.

Sütunlu (columnar) bir analitik veritabanında aynı hacim, mertebe olarak
**onlarca kat** daha ucuza oturur; çünkü fiyat satır başına değil, depolama
ve hesaplama üzerinden işler.

### 2.3 Çözüm — ama her şeyi taşıma

**Doğru hamle: event akışını taşı, operasyonel veriyi bırak.**

| Firestore'da KALSIN | Analitik veritabanına TAŞINSIN |
|---|---|
| Auth, `developers/`, `games/` | Ham event akışı (yüksek hacim, sadece ekleme) |
| Remote Config dağıtımı (canlı dinleyici şart) | Tüm toplu metrikler, huniler, kohortlar |
| Alertler, Auto-Heal reçeteleri | Retention eğrileri, segment kırılımları |
| AI raporları, copilot geçmişi | Cross-tenant benchmark hesaplamaları |
| Player state snapshot'ları | Cihaz/GPU/bellek istatistikleri |

Firestore bu ilk sütunda **iyidir** — küçük dokümanlar, gerçek zamanlı
dinleyiciler, düşük hacim. Onu oradan sökmek gereksiz risk olur.

**Hedef teknoloji: ClickHouse.** Sektör standardı — PostHog, Plausible ve
benzeri ürünlerin hepsi bunun üzerinde çalışır. Alternatif: BigQuery
(operasyon yükü daha az, sorgu başına ücretli). Karar kriteri: öngörülebilir
maliyet isteniyorsa ClickHouse, sıfır operasyon isteniyorsa BigQuery.

### 2.4 Geçişi mümkün kılan dikiş: `ingestEvents`

`exports.ingestEvents` HTTP ucu eklenmiş durumda. **Bu, farkında olmadan
yapılmış en stratejik hamledir**, çünkü:

```
ESKİ:  SDK → Firestore (doğrudan, sıkı bağlı)
YENİ:  SDK → ingestEvents (HTTP) → [arkada ne olursa olsun]
```

SDK bu uca POST atmaya başladığı an, arkadaki depolama **SDK'ya hiç
dokunmadan** değiştirilebilir. Yayındaki oyunlara güncelleme göndermeden
altyapı değiştirebilmek demektir bu — geçişin tek gerçekçi yolu.

**Aksiyon:** SDK'nın varsayılan gönderim yolunu `ingestEvents` yap, Firestore
doğrudan yazımını yedek yol olarak bırak.

---

## 3. SDK olgunlaşması

Şu anki SDK bir "analitik SDK'sı"ndan çok "Firestore istemcisi" gibi
davranıyor. Gerçek bir veri platformunun SDK'sında olması gerekenler:

| Özellik | Şu an | Olması gereken | Neden |
|---|---|---|---|
| **Toplu gönderim** | Event başına 1 yazma | 50 event veya 30 sn'de 1 istek | Maliyet ve pil tüketiminde onlarca kat kazanç |
| **Kalıcı kuyruk** | Bellekte, 256 sınırlı, çökmede kayıp | Diske yazan kuyruk | Çevrimdışı oyuncu / uçak modu / çökme = veri kaybı yok |
| **Yeniden deneme** | Yok (circuit breaker sadece kapatıyor) | Üstel geri çekilmeli retry | Geçici ağ hatasında event kaybolmasın |
| **Sıkıştırma** | Yok | gzip'li tek istek | Bant genişliği ve maliyet |
| **Şema versiyonu** | Yok | `schema_version` alanı | Geriye uyumlu şema evrimi |
| **Çoklu platform** | Sadece Unity | Godot, native iOS/Android, web, Unreal | "Her kategoriden oyun" hedefi bunu zorunlu kılıyor |

HTTP ucu üzerinden gidildiğinde çoklu platform desteği **ucuzlar** — her
platform için ayrı Firebase entegrasyonu değil, sadece bir HTTP istemcisi
yazmak yeterli olur.

---

# 4. ⭐ ÜRÜN — asıl değer burada

> **Bu bölüm bu dokümanın kalbidir.** §2 ve §3 "çökmemek için" yapılacaklar;
> bu bölüm "kazanmak için" yapılacaklar. Teknik borç ödemek bizi hayatta
> tutar, aşağıdakiler bizi **vazgeçilmez** yapar.

## 4.1 Altın kural: Dashboard tutmaz, aksiyon tutar

**Bir stüdyo panele iki hafta bakar, sonra açmayı bırakır.**

Bu, veri ürünlerinin en acımasız gerçeğidir. Dashboard bir *rapor*tur;
raporun rakibi Excel'dir ve Excel bedavadır. Grafik eklemek, kart eklemek,
renk güzelleştirmek **tutunma (retention) üretmez** — sadece ilk izlenimi
iyileştirir.

Müşteriyi tutan şey, ürünün **onun yerine iş yapmasıdır.** Altare'nin
farkı burada: panel veriyi *göstermiyor*, veriye *müdahale ediyor*.

**Karar kuralı:** Yeni bir özellik önerildiğinde tek soru şudur —
*"Bu, stüdyonun yerine bir iş yapıyor mu, yoksa ona bir şey mi gösteriyor?"*
Gösteriyorsa sıraya alınır. İş yapıyorsa öne alınır.

## 4.2 Moat #1: Kapalı döngü — ve onun doğal evrimi

Mevcut döngü:

```
Anomali tespit → AI teşhis → Remote Config reçetesi → uygula → ölç → geri al
```

**Bunu orta segmentte yapan yok.** Firebase gösterir ama müdahale etmez.
GameAnalytics gösterir ama müdahale etmez. Mixpanel/Amplitude gösterir ama
müdahale etmez. Müdahale eden araçlar (LiveOps platformları) ise AI ile
teşhis koymaz ve pahalıdır.

### ✅ Bir sonraki seviye KURULDU: A/B test altyapısı

Kapalı döngünün doğal evrimi tamamlandı:

| Önce | Şimdi |
|---|---|
| "Bu değişikliği uygula" | "Bu değişikliği %10'a uygula, ölç, kazanırsa yaygınlaştır" |

Döngü artık şöyle:

```
Anomali → AI reçetesi → %10'da DENEY → ölç
                                        ├─ kazandıysa → yaygınlaştır
                                        └─ zarar veriyorsa → OTOMATİK durdur
```

**Neden bu kadar önemli:** daha önce bir reçete %100 trafiğe uygulanıyordu.
Metrik sonra düzeldiğinde bunun reçeteden mi, mevsimsellikten mi, yeni bir
güncellemeden mi geldiğini söylemenin yolu **yoktu**. *"Düzeldi"* demek ile
*"düzelttik"* demek arasındaki fark tam olarak budur — ve yatırımcı
sunumunda da, kurumsal satışta da önemli olan bu farktır.

**Kurulan parçalar:**

| Parça | Nerede |
|---|---|
| Deterministik bölümleme (FNV-1a, oyuncu sabit grupta kalır) | `firebase/functions/experiments.js` + `unity-sdk/AltareExperiments.cs` |
| İstatistiksel anlamlılık (iki oran z-testi, Welch t, güven aralığı) | `experiments.js` — harici bağımlılık yok |
| Erken bakma (peeking) koruması | minimum örneklem dolmadan kazanan ilan edilmez |
| Guardrail nöbetçisi (çökme/oturum/gelir kötüleşirse otomatik durdur) | `monitorExperiments`, 6 saatte bir |
| Panel arayüzü | `panel.html` → Auto-Heal sekmesi |

**Satış konuşmasının merkezi bu özelliktir.** Stüdyo "verimi görüyorum"
için değil, **"deneyi otomatik yürütüyorsunuz"** için para verir.

## 4.3 Moat #2: Sektörel benchmark — ve kritik kütle tuzağı

Ağ etkisi (network effect) budur ve **kopyalanamayan tek şeydir**:

```
Daha çok oyun → daha iyi benchmark → daha çok oyun
```

Rakip bir ürün kodumuzu birebir kopyalasa bile bu döngüyü kopyalayamaz,
çünkü veri bizde birikiyor.

**⚠️ Ama kritik uyarı: 3 oyunla benchmark anlamsızdır.** "Sektör ortalaması"
diye sunduğumuz şey aslında 3 oyunun ortalamasıysa, bunu fark eden ilk
müşteri ürüne olan güvenini kaybeder — ve haklı olur.

**Kritik kütleye kadar strateji:** Benchmark'ı **halka açık Play Store
verisiyle besle.** `market_intel` tarafında bu altyapının başlangıcı zaten
var (`google-play-scraper`). Kaç oyuna dayandığı **şeffaf biçimde
gösterilmeli** — "12 oyun · 4.2M oturum bazında" gibi. Şeffaflık burada
zayıflık değil, güven üretir.

## 4.4 ⚠️ En büyük ürün eksiği: Retention ve kohort yok

**`buildSummaryData` incelendiğinde görülüyor:** oturum, oyuncu, level,
reklam, IAP, çökme, FPS, bellek — hepsi var. **Ama D1/D7/D30 retention ve
kohort analizi yok.**

### Ve daha kritik bir tutarsızlık var

Kod tabanında retention üç yerde geçiyor ve **üçü de gerçek retention
değil:**

| Yer | Ne var | Sorun |
|---|---|---|
| `aggregateIndustryBenchmark` | ~~`retentionD1Proxy`~~ → `sessionsPerPlayer` | ✅ **Düzeltildi.** İç değişken adı yanıltıcıydı (ve yorumdaki oran ters yazılmıştı). *Düzeltme notu: bu dokümanın ilk sürümünde "benchmark'ta retention adıyla sunuluyor" yazmıştım — bu **yanlıştı**. Saklanan alan ve panel etiketi zaten doğru şekilde "Oyuncu Başına Oturum" idi; sorun yalnızca kod içindeydi.* |
| `gameTypeBaseline` | `d1_retention_target: "30-40%"` | Bunlar **hedef** değerler, ölçüm değil. AI prompt'una besleniyor. |
| AI system prompt'ları | "D-3 retention +12pp" gibi örnekler | AI'dan retention üzerine yorum yapması isteniyor |

**Sonuç:** AI'a *"iyi retention şudur"* diye hedef veriyoruz ve *"retention
hakkında yorum yap"* diyoruz — ama **ölçülmüş gerçek retention verisini hiç
vermiyoruz.** AI göremediği bir metrik hakkında akıl yürütüyor.

Bu, ürünün en zayıf noktasıdır: teknik bir eksiklikten öte, **AI çıktısının
güvenilirliğini doğrudan etkiliyor.** Bir stüdyo raporu okuyup "bu retention
rakamı nereden geldi" diye sorduğunda verecek cevabımız olmalı.

**✅ Yapıldı:** İç değişken `sessionsPerPlayer` olarak yeniden adlandırıldı,
ters yazılmış yorum düzeltildi ve gerçek retention'ın neden günlük toplu
istatistiklerden hesaplanamayacağı koda not düşüldü.

**✅ Asıl düzeltme — AI'ın uydurması engellendi:** Tüm AI prompt'larına giren
ortak bağlam bloğuna (`gameContextBlock`, TR+EN) **ÖLÇÜLMEYEN METRİKLER**
uyarısı eklendi: veri setinde retention/kohort/huni/LTV olmadığı, baseline'daki
retention değerlerinin tür referansı olduğu ve bu oyun için sayı iddia
edilemeyeceği açıkça yazıyor. Ayrıca sistem prompt'undaki **uydurmayı öğreten
iki örnek** (`"D-3 retention'ı %18 düşüyor"`, `expected_metric: "D-3 retention
+12pp"`) ölçülebilir metriklerle değiştirildi — prompt'ta "asla uydurma" kuralı
zaten vardı ama örnekler onu baltalıyordu.

**✅ Yasak listesi artık TEK KAYNAKTAN türetiliyor.** Liste dört ayrı yerde
elle yazılıydı (TR/EN × ölçüldü/ölçülmedi). Huni ölçülmeye başladığında
dördünü birden güncellemek gerekiyordu ve biri atlanırsa AI ölçülen bir
metriği "ölçülmüyor" sanacak ya da — daha kötüsü — ölçülmeyen bir metrik
için sayı uyduracaktı. Kayma tam böyle olur. Artık
`OLCULEBILIR_METRIKLER` kayıt defteri var: bir metrik ölçülmeye başladığı
anda yasak listesinden **kendiliğinden** çıkıyor, ölçüm yoksa yasak
**kendiliğinden** duruyor. `tools/test-ai-context.js` bunu iki yönlü
doğruluyor (60 kontrol).

**✅ Panel:** Copilot'un önerdiği "Retention neden düşüyor?" sorusu ölçülebilir
bir soruyla değiştirildi (TR+EN, banner ve buton dahil) — ölçmediğimiz bir
metriği kullanıcıya sormak için önermek doğru değildi.

Bu, mobil oyun dünyasında **kabul edilebilir bir eksik değildir**, çünkü:

- Retention, mobil oyunun **birincil** metriğidir
- Bir stüdyonun kendi yatırımcısına gösterdiği ilk grafiktir
- "Oyun analitiği platformu" iddiasının **giriş bileti**dir

Retention olmadan yapılan satış görüşmesinde ilk soru bu olur ve cevabımız
yoksa görüşme orada biter.

**İyi haber:** bu, §2'deki geçişle **aynı işin parçası.** Kohort sorgusu
Firestore'da neredeyse imkânsızken, sütunlu veritabanında tek sorgudur. Bu
yüzden ikisi birlikte planlanmalıdır — ayrı iki proje değil, tek projedir.

**Eklenecek metrik seti:**

| Metrik | Neden |
|---|---|
| D1 / D7 / D30 retention (**gerçek**, proxy değil) | Giriş bileti |
| Kohort tabloları (kurulum haftasına göre) | Güncellemenin etkisini gösterir |
| Huni analizi (tutorial, satın alma akışı) | Nerede kaybediyoruz sorusunun cevabı |
| ARPDAU / ARPPU / LTV | Para tarafı |
| Level zorluk eğrisi | *(kısmen var — geliştirilmeli)* |

## 4.5 Ürün önceliklendirme özeti

| Öncelik | Neden |
|---|---|
| **1. Retention + kohort** | Giriş bileti. Bu olmadan diğerleri konuşulmuyor. |
| **2. A/B test altyapısı** | Asıl satış argümanı. Kapalı döngünün üstüne kurulur. |
| **3. Benchmark kritik kütlesi** | Ağ etkisi. Halka açık veriyle beslenmeli. |
| **4. Daha fazla grafik/kart** | **En sona.** Dashboard tutmaz. |

---

## 5. Kurumsal güven — ücretsiz araçtan geçiş sebebi

Stüdyolar ücretsiz araçlardan (Firebase, GameAnalytics) ancak **güven** için
ayrılır. Ücretli bir platformdan beklenenler:

| Gereksinim | Neden kritik |
|---|---|
| **Veri silme API'si** | KVKK/GDPR "unutulma hakkı". AB'li stüdyo bunu sormadan sözleşme imzalamaz. |
| **DPA (veri işleme sözleşmesi)** | Kurumsal satın almanın ön koşulu |
| **Verinin nerede tutulduğu** | Şu an `eur3` — bu **açıkça beyan edilmeli** |
| **Denetim kaydı (audit log)** | Auto-Heal **canlı oyuna müdahale ediyor**. "Kim, ne zaman, hangi config değişikliğini uyguladı" sorusunun cevabı olmalı. |
| **Çalışma süresi taahhüdü + durum sayfası** | Veri kaybı korkusunu giderir |

**Denetim kaydı özellikle önemlidir:** ürünümüz müşterinin canlı oyununa
yazıyor. Bir stüdyo "sizin AI'ınız oyunumu bozdu" dediğinde, elimizde kim
neyi ne zaman onayladığının kaydı olmalı. Bu hem hukuki koruma hem satış
argümanıdır.

---

## 6. Ne YAPMAMALI

| Yapma | Neden |
|---|---|
| **Firebase'i baştan yazma** | Auth, hosting, gerçek zamanlı dinleyiciler çözülmüş problemler. Katma değerimiz orada değil. |
| **Mixpanel/Amplitude ile özellik yarışı** | Onlar genel amaçlı ve pahalı. Kazanma şeklimiz oyun-native olmak ve aksiyon döngüsü. |
| **Node.js 20 / firebase-functions yükseltmesi (şimdi)** | İkisi de kırıcı değişiklik, **bütün** fonksiyonları etkiler. Node 20 kapanışı 30 Ekim 2026 — acele yok. Demo sonrası, ayrı branch. |
| **Her şeyi aynı anda taşımak** | Operasyonel veri Firestore'da iyi çalışıyor. Sadece event akışı taşınacak. |
| **Panele önce grafik eklemek** | Bkz. §4.1 |

---

## 7. Sıralama — 12 ay

> BiGG bütçesi çoğunlukla maaş demektir; asıl soru "12-18 ayda ne yapıldı".
> Aşağıdaki sıralama **her adımda çalışan bir ürün** bırakacak şekilde
> tasarlanmıştır — hiçbir aşamada "6 ay geliştirdik, hiçbir şey çalışmıyor"
> durumu oluşmaz.

### Faz 1 (0-3 ay) — Maliyeti düşür, hiçbir şeyi bozma

- [x] **`ingestEvents` şema paritesi** — uç `sessionId`/`gpuModel`/`totalMemoryMb`
      yazmıyordu. `uniqueSessions`, Sentinel'de crash/ANR/FPS/bellek oranlarının
      **paydası** olduğu için eksik `sessionId` yanlış alarm → Auto-Heal → canlı
      oyuna config yazımı zincirini tetikleyebilirdi.
- [x] **`ingestEvents` kimlik doğrulaması** — uç hiç doğrulama yapmıyordu;
      `gameId`'yi bilen herkes sahte event basabiliyordu. `X-Altare-Key` zorunlu
      hale getirildi (timing-safe karşılaştırma).
- [x] **API anahtarı üretimi** — `Math.random()` → `crypto.randomBytes`.
- [x] **SDK v3.0 — toplu gönderim** — 50 olay / 30 sn / arka plana atılma
      tetikleyicileriyle tek istek. 50 ayrı ağ turu ve faturalanan Cloud
      Function çağrısı → **1**.
- [x] **SDK v3.0 — diske yazan kuyruk** — olaylar sunucu onaylayana kadar
      kalıcı depolamada. Çökme / uçak modu / uygulama kapatma artık veri
      kaybettirmiyor; sonraki açılışta kurtarılıyor.
- [x] **SDK v3.0 — akıllı yeniden deneme** — kalıcı hatalar (400/404/413,
      401/403) ölçümü kapatır; geçici hatalar (ağ, 429, 5xx) üstel geri
      çekilmeyle denenir. Sonsuz retry döngüsü kapatıldı.
- [x] **SDK'nın varsayılan yolu `ingestEvents`** — analitik artık Firebase
      gerektirmiyor; Firebase'i olmayan oyun 2 `.cs` dosyasıyla çalışıyor.
- [ ] gzip sıkıştırma (küçük ek kazanç — ertelendi)

**Çıktı:** event başına maliyet düşer, veri kaybı biter, mevcut müşteri hiçbir
değişiklik hissetmez.

> **Not:** Yukarıdaki üç madde, SDK bu uca bağlanmadan **önce** kapatılması
> zorunlu kapılardı. Uç henüz istemcisiz olduğu için hiçbiri kırıcı değildi —
> bu pencere kapanmadan yapıldı.

### Faz 2 (3-6 ay) — Veri katmanı + giriş bileti
- [ ] Event akışını ClickHouse'a taşı (Firestore operasyonel veride kalır)
- [ ] `EVENT_CAP` kırpmasını kaldır — tam veri üzerinden çalış
- [x] **Gerçek retention (D1/D7/D30) + kohort** — oyuncu rollup'ı
      (`games/{gameId}/players/{playerAnonId}`) + 6 saatte bir çalışan
      `computeRetention`. Kohort yalnızca `first_open` görülen oyunculardan
      kurulur (SDK'yı bugün takıp herkesi "yeni kurulum" sayma tuzağı önlendi).
      ClickHouse beklenmeden Firestore üzerinde çalışıyor; geçişte aynen taşınır.
- [x] **Huni (funnel) dönüşüm analizi** — sıralı yol olarak: her adım
      öncekinden *sonra* gerçekleşmiş olmak zorunda (bağımsız sayaç değil).
      Olgunlaşma kuralı retention'daki kohort tuzağının aynısını kapatıyor:
      penceresi kapanmamış oyuncu "koptu" sayılmıyor. Hazır şablonlar
      (onboarding / monetizasyon / ödüllü reklam), medyan geçiş süreleri ve
      en büyük kopuş adımı. `firebase/functions/funnels.js`
- [x] **`retentionD1Proxy` temizliği** — iç değişken adı düzeltildi; AI
      prompt'larına "bu metrikler ölçülmüyor, sayı uydurma" guard'ı eklendi;
      uydurmayı öğreten prompt örnekleri ve panelin önerdiği ölçülemez soru
      değiştirildi (§4.4)
- [x] **Ölçülen retention AI prompt'una besleniyor** — `gameContextBlock`
      artık dinamik: ölçüm varsa gerçek sayıyı verir, yoksa uydurma yasağı
      devreye girer. Huni/LTV için yasak her durumda sürüyor.

**Çıktı:** panel aynı görünür, altı değişir; artık "oyun analitiği platformu" denebilir.

### Faz 3 (6-12 ay) — Asıl satış argümanı
- [x] **A/B test altyapısı** — deterministik bölümleme (FNV-1a, istemci ve
      sunucu bit bit aynı kovayı hesaplar) + iki oran z-testi / Welch t +
      güven aralıkları + gereken örneklem hesabı. Harici bağımlılık yok.
      `firebase/functions/experiments.js`
- [x] **Auto-Heal'i deneye dönüştür** — reçetede artık iki buton var:
      "⚡ Uygula" ve "🧪 %10'da Test Et". AI `ab_test_required: true`
      dediğinde ya da risk yüksekse doğrudan uygulama **kapanır** ve deney
      yolu zorunlu olur (`force: true` ile aşılabilir, admin şartı sürer).
- [x] **Guardrail nöbetçisi** — deneme grubu ölçülebilir biçimde zarar
      veriyorsa (çökme / oturum süresi / gelir) `monitorExperiments` deneyi
      kimse tıklamadan durdurur ve sahibine uyarı yazar.
- [ ] Denetim kaydı + veri silme API'si

**Çıktı:** kimsede olmayan bir özellik seti.

### Paralel yürüyen (sürekli)
- [ ] Benchmark'ı halka açık veriyle besle, kaç oyuna dayandığını şeffaf göster
- [ ] Çoklu platform SDK (Godot, native, web) — HTTP ucu sayesinde ucuz
- [ ] KVKK/DPA evrakları
- [ ] `INGEST_REQUIRE_API_KEY = true` (yalnızca `ingest_no_key` logları
      sıfırlandıktan sonra — ChopHero güncellenmediği sürece AÇILMAMALI)

---

## 8. Yatırımcı teknik incelemesine hazırlık

Teknik ekip mutlaka şunları soracak. Cevaplar **şimdiden** hazır olmalı:

| Soru | Hazır olması gereken cevap |
|---|---|
| "Event başına maliyetiniz ne? 100 milyon event'te ne oluyor?" | Mevcut model + geçiş planı. **Planın elde olması zayıflık değil, olgunluk kanıtıdır.** |
| "Veri kaybı senaryonuz ne?" | Diske yazan kuyruk + retry (Faz 1 çıktısı) |
| "Rakip kodunuzu kopyalarsa ne olur?" | Ağ etkisi (§4.3) — veri kopyalanamaz |
| "AI müşterinin oyununu bozarsa?" | Geri alma mekanizması + denetim kaydı + risk seviyesi etiketi |
| "KVKK/GDPR uyumluluğunuz?" | Anonim UUID, PII yok, `eur3` bölgesi, silme API'si (Faz 3) |
| "Neden Firebase'i kullanan biri size geçsin?" | Firebase gösterir, biz **müdahale ederiz** (§4.2) |

---

## 9. Kapanış — tek cümle

**§2 ve §3 çökmemek için, §4 kazanmak için.**

Teknik borcu ödemek bizi masada tutar; kapalı döngüyü A/B teste çevirmek ve
retention'ı eklemek bizi kazandırır. İkisini karıştırmamak — ve altyapı
işine boğulup ürün tarafını ertelememek — önümüzdeki 12 ayın en önemli
disiplinidir.
