# Altare — Değişiklik Kaydı

> Ne değişti, **neden önemliydi**, ne yapıldı. Yeni oturumlar en üste ekler.

---

# Oturum: Site/panel hazırlık → SDK v2.4 → ingest sertleştirme

**Kapsam:** `a662475 … 49940ea` · 10 commit · Cloud Functions deploy edildi ✅

Bu oturum "site jüriye hazır mı" sorusuyla başladı, denetim sırasında **canlıyı
etkileyen 8 ayrı hata** çıktı. Hepsi düzeltildi ve yayına alındı.

---

## 🔴 Kritik düzeltmeler

### 1. Auto-Heal tamamen çalışmıyordu
`a662475`

**Neydi:** `generateAutoHeal`, Claude'u "assistant prefill" tekniğiyle çağırıyordu.
Anthropic bu tekniği 4.6+ modellerinde kaldırdı — Opus 4.8'e giden **her istek 400
dönüyordu.**

**Neden önemliydi:** Ürünün kalbi olan kapalı döngünün reçete üretim adımı
tamamen ölüydü. Panelde "Reçete Üret" her seferinde hata veriyordu — jüri
demosunda patlayacak türden.

**Ne yapıldı:** Model prefill destekliyorsa (Sonnet 4.5, Haiku 4.5) eski davranış
korunuyor; desteklemiyorsa prefill'siz gidiyor ve mevcut çok-stratejili JSON
ayıklayıcı devreye giriyor. 7 model senaryosuyla test edildi.

---

### 2. SDK verileri yanlış Firebase projesine yazıyordu
`44c96cd`

**Neydi:** SDK her yerde `FirebaseFirestore.DefaultInstance` kullanıyordu. Default
instance oyunun **kendi** `google-services.json`'ına bağlanır.

**Neden önemliydi:** Kendi Firebase'i olan bir oyunda (örn. `pixel-pour-77f13`)
eventler Altare'ye değil oyunun kendi projesine yazılıyordu — `altare-312a1`'i
dinleyen panel **hiç veri görmüyordu.** Hiç Firebase'i olmayan oyunlarda ise SDK
zaten çalışamıyordu. Yani "her oyun panele veri verir" iddiası doğru değildi.

**Ne yapıldı:** Yeni `AltareFirebase.cs` — gömülü config'le isimli bir `"altare"`
FirebaseApp kuruyor. Oyunun kendi Firebase'ine (Analytics, Remote Config,
Crashlytics) **hiç dokunulmuyor**; `google-services.json` artık gerekmiyor.
Analytics, Config ve PlayerState modüllerinin hepsi bu isimli app'e bağlandı.

---

### 3. SDK çoğu kullanıcıda hiç başlamıyordu
`44c96cd`

**Neydi:** Bootstrap opt-in consent bekliyordu — `app_consent_analytics=1`
yazılmadan SDK başlamıyor, 5 saniyede bir sonsuza kadar bekliyordu. Consent
ekranı olmayan oyunlarda bu anahtarı yazan hiçbir kod yoktu.

**Neden önemliydi:** SDK doğru projeye yazsa bile hiç ayağa kalkmıyordu.
2. maddeyle birlikte "veri gelmiyor" şikâyetinin ikinci yarısı buydu.

**Ne yapıldı:** Opt-out modeline geçildi — açıkça reddedilmedikçe (anahtar `0`)
başlar. Veri zaten anonim UUID, PII yok. Consent ekranı olan oyunlar için tek
satırlık `AltareAnalytics.SetAnalyticsConsent(true/false)` API'si eklendi; katı
opt-in gereken pazarlar için `RequireExplicitConsent = true` anahtarı bırakıldı.

---

### 4. Panelden inen SDK paketi derlenmiyordu
`ef34305`

**Neydi:** `games.js`'in indirme fonksiyonu `/unity-sdk/`'dan 4 dosya çekiyordu;
v2.4'ün yeni **zorunlu** dosyası `AltareFirebase.cs` listede yoktu.

**Neden önemliydi:** Panelden SDK indiren her müşteri, `AltareFirebase` referansı
çözülemeyen ve Unity'de **derlenmeyen** bir paket alacaktı. Yani ilk izlenim
"ürün bozuk" olacaktı.

**Ne yapıldı:** Zip'e eklendi (site erişilemezse devreye giren gömülü yedek
kopyayla birlikte). TR/EN kurulum rehberleri yeni mimariye göre yeniden yazıldı:
`google-services.json` gerekmiyor, anonymous auth Altare tarafında hazır, 5 `.cs`
dosyasının tamamı kopyalanmalı. Sürüm etiketleri 2.4.0'a çekildi.

---

### 5. `ingestEvents` `sessionId` yazmıyordu — yanlış alarm zinciri
`ed7221c`

**Neydi:** HTTP olay ucu `sessionId`, `gpuModel`, `totalMemoryMb` alanlarını
yazmıyordu; SDK'nın doğrudan Firestore yazımı ise yazıyor. İki yol **farklı şema**
üretiyordu.

**Neden önemliydi — bu en tehlikelisiydi:** `buildSummaryData`, `uniqueSessions`'ı
`e.sessionId`'den sayıyor. Ve `uniqueSessions`, `detectAnomalies` içinde
crash/ANR/FPS/bellek oranlarının **paydası**. Eksik olunca
`Math.max(uniqueSessions, 1)` devreye girer ve oranlar ham sayılara eşitlenir.
Taban veri (SDK, sessionId'li) ile yeni veri (HTTP, sessionId'siz)
karşılaştırıldığında **alarm garanti yanılırdı** — ve o alarm Auto-Heal'i
tetikleyip **canlı oyuna config yazabilirdi.**

**Ne yapıldı:** Şema paritesi kuruldu (13 alan → tam eşleşme). `sessionId` eksik
gelirse `logger.warn` düşüyor, sessizce bozulmuyor.

---

### 6. `ingestEvents` hiç kimlik doğrulaması yapmıyordu
`82b2fbe`

**Neydi:** Uç, gelen isteğin kim olduğunu hiç kontrol etmiyordu.

**Neden önemliydi:** `gameId` bir sır değil — panelde görünür, APK'dan çıkarılır.
Öğrenen herkes sahte event basıp veri akışını zehirleyebilirdi. Mevcut rate limit
de `playerAnonId` üzerindeydi ve o değer saldırgan kontrolünde — döndürerek
aşılabiliyordu. Zehirlenmiş veri → yanlış Sentinel alarmı → Auto-Heal → canlı
oyuna config yazımı zinciri açıktı.

**Ne yapıldı:** `X-Altare-Key` başlığı, oyunun kayıtlı `apiKey`'i ile
`timingSafeEqual` kullanılarak doğrulanıyor (timing attack'a kapalı).

---

### 7. API anahtarları tahmin edilebilir üretiliyordu
`82b2fbe`

**Neydi:** `generateApiKey()` `Math.random()` kullanıyordu.

**Neden önemliydi:** `Math.random()` kriptografik olarak güvenli değildir,
çıktısı tahmin edilebilir. Bir güvenlik incelemesinin ya da yatırımcı teknik
denetiminin doğrudan işaret edeceği türden bir zafiyet.

**Ne yapıldı:** `crypto.randomBytes(24)` ile değiştirildi. Mevcut anahtarlar
geçerli kalıyor, yalnızca yeni oyunlar etkileniyor. 5000 üretimde çakışma yok.

---

### 8. Öz-düzeltme: zorunlu anahtar canlı istemciyi kesecekti
`a055981`

**Neydi:** 6. maddede anahtarı **zorunlu** yapmıştım. Gerekçem "ucun henüz
istemcisi yok" idi — Altare deposunda aramış, bulamamıştım. **Ama istemci başka
depodaydı:** `shadow-weaver` → `Assets/_Game/Scripts/Services/AltareAnalytics.cs`
(ChopHero, canlı).

**Neden önemliydi:** Deploy edilseydi ChopHero 401 alacaktı. Üstelik istemcinin
kalıcı-hata listesi `[404, 400, 413]` — **401 orada yok.** Yani 401 "geçici hata"
sayılıp tampon korunur ve **30 saniyede bir sonsuza kadar** tekrar denenirdi:
veri tamamen kesilir, üstüne her denemede faturalanan bir Cloud Function çağrısı
yanardı. Mobil istemcide zorunlu auth'a anında geçilemez — eski build'ler
oyuncunun telefonunda kalır.

**Ne yapıldı:** Yumuşak geçişe (grace period) çevrildi:

| Durum | Davranış |
|---|---|
| Anahtar gönderilmiş, doğru | Kabul |
| Anahtar gönderilmiş, **yanlış** | **401** — saldırgan yine giremez |
| Anahtar yok | Kabul + `ingest_no_key` uyarı logu |
| Oyun dokümanında anahtar yok | Kabul + hata logu (500 değil) |

Zorunlu moda geçiş şartı: `ingest_no_key` logları sıfırlanınca
`INGEST_REQUIRE_API_KEY = true` + redeploy. **ChopHero güncellenmeyeceği için bu
bayrak şimdilik `false` kalmalı.**

---

## 📄 Dokümantasyon

| Dosya | İçerik | Commit |
|---|---|---|
| `docs/ALTARE_SCALE_ROADMAP.md` | Ölçeklenme & yatırım yol haritası — teknik borç, ürün öncelikleri, 12 aylık sıralama, yatırımcı denetim soruları | `0fdbb0d` `553a884` |
| `firebase/functions/.env.example` | GA4 deploy tuzağını kalıcı kapatan şablon | `2a8fea1` |
| `docs/SETUP.md` | Unity entegrasyonu v2.4'e göre yeniden yazıldı + 3 yeni sorun giderme satırı | `44c96cd` `2a8fea1` |
| `README.md` | Yol haritası linki | `0fdbb0d` |

---

## 🔍 Tespit edildi, henüz düzeltilmedi

Bunlar **bilinçli olarak** sıraya alındı — yol haritasında karşılıkları var.

### `retentionD1Proxy` gerçek retention değil
`aggregateIndustryBenchmark` içinde:
```js
metrics.retentionD1Proxy.push(d.uniqueSessions / d.uniquePlayers);
```
Bu **oyuncu başına oturum sayısı**, retention değil. Gerçek D1 retention =
(1. gün geri dönen oyuncu) / (0. gün kuran oyuncu). Tamamen farklı iki büyüklük
ve "retention" adıyla benchmark'ta sunuluyor.

**Daha kötüsü:** AI'a `d1_retention_target: "30-40%"` gibi **hedefler** besleniyor
ve retention hakkında yorum yapması isteniyor, ama **ölçülmüş gerçek retention
hiç verilmiyor.** AI göremediği bir metrik hakkında akıl yürütüyor.

> Yanlış isimlendirilmiş metrik, hiç olmayan metrikten daha tehlikelidir.

### Gerçek retention / kohort / huni analizi yok
Mobil oyunun birincil metriği. Sütunlu veritabanı geçişiyle birlikte
planlanmalı — Firestore'da pratik değil.

### ChopHero istemcisi `sessionId` göndermiyor
Kullanıcı kararıyla **şimdilik olduğu gibi bırakıldı.** Sonucu: panelde ChopHero
için "Aktif Oturum" 0 görünür ve Sentinel oranları payda 1 ile hesaplanır.

---

## ⚙️ Yayın durumu

- ✅ Tüm commit'ler `main`'de
- ✅ Cloud Functions deploy edildi
- ✅ Site (GitHub Pages) `main`'den yayında — panelden inen SDK artık v2.4
- ⏭️ Yayındaki eski oyun build'leri güncellenene kadar eski davranışta kalır

---

## ⏭️ Sıradaki işler

Detaylar: [`ALTARE_SCALE_ROADMAP.md`](ALTARE_SCALE_ROADMAP.md)

1. SDK toplu gönderim + diske yazan kuyruk + retry *(Faz 1)*
2. `retentionD1Proxy` düzeltmesi *(küçük, bütünlük için kritik)*
3. Gerçek retention + kohort + huni *(Faz 2 — giriş bileti)*
4. Event akışını ClickHouse'a taşı *(Faz 2)*
5. A/B test altyapısı *(Faz 3 — asıl satış argümanı)*

---

## 📌 Not: bu oturuma ait olmayan commit

`d182a35` (ChopHero amiral gemisi + `ingestEvents` HTTP ucu) **başka bir oturumda**
yazıldı. Bu oturum o ucu devraldı, inceledi ve 5-8. maddelerdeki hataları düzeltti.
