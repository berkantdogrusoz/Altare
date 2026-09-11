# Altare — Değişiklik Kaydı

> Ne değişti, **neden önemliydi**, ne yapıldı. Yeni oturumlar en üste ekler.
>
> **Güncel durum panosu için:** [`ALTARE_SCALE_ROADMAP.md` §0.1](ALTARE_SCALE_ROADMAP.md)
> — bu dosya *ne yaptığımızı*, orası *nerede durduğumuzu* anlatır.

---

# Oturum: AI veri bütünlüğü — ölçülmeyen metrik uydurması engellendi

**Kapsam:** `retentionD1Proxy` temizliği + AI prompt guard'ı · ⚠️ **Cloud
Functions deploy'u GEREKİR** (prompt değişiklikleri sunucuda)

## 🔎 Önce bir öz-düzeltme

Yol haritasının ilk sürümünde şöyle yazmıştım: *"`retentionD1Proxy` 'retention'
adıyla benchmark'ta sunuluyor."* Kodu tekrar okuyunca bunun **yanlış** olduğu
ortaya çıktı. Saklanan alan zaten doğru şekilde `sessionsPerPlayer` adıyla
yazılıyordu ve panel de "Oyuncu Başına Oturum" diye gösteriyordu. Sorun
yalnızca **kod içindeki iç değişken adındaydı** — kullanıcı hiçbir zaman
yanlış etiket görmedi. Doküman düzeltildi.

## 🟢 Tamamlananlar

### 1. İç değişken adı ve ters yazılmış yorum

`metrics.retentionD1Proxy` → `metrics.sessionsPerPlayer`. Ayrıca yorumda oran
**ters** yazılmıştı (`uniquePlayers / uniqueSessions`, oysa kod
`uniqueSessions / uniquePlayers` yapıyor). Gerçek retention'ın neden günlük
toplu istatistiklerden hesaplanamayacağı da koda not düşüldü.

### 2. ⭐ Asıl düzeltme: AI'ın retention uydurması engellendi

**Neydi:** `gameTypeBaseline`, her AI prompt'una `d1_retention_target: "35-45%"`
gibi hedefler besliyordu. Ama veri setinde **ölçülmüş retention yok.** Üstelik
sistem prompt'undaki örnekler doğrudan retention iddiası öğretiyordu:

```
- headline: (orn: "Level 18'de %47 drop-off, D-3 retention'ı %18 düşüşüyor.")
- expected_metric: (orn: "D-3 retention +12pp")
```

**Neden önemliydi:** Prompt'ta *"Veri yetersizse 'Veri yetersiz' yaz, asla
uydurma"* kuralı **zaten vardı** — ama hemen altındaki örnekler onu
baltalıyordu. Model örneği taklit eder. Yani stüdyoya gönderdiğimiz raporda
**doğrulanamaz retention rakamları** çıkabilirdi.

**Ne yapıldı:**
- Ortak bağlam bloğuna (`gameContextBlock`, TR+EN — tüm AI prompt'larına girer)
  **ÖLÇÜLMEYEN METRİKLER** uyarısı eklendi: retention/kohort/huni/LTV veride
  yok, baseline'daki değerler tür referansı, bu oyun için sayı iddia edilemez.
  Nitel yorum serbest, sayı uydurmak yasak.
- Uydurmayı öğreten iki örnek **ölçülebilir** metriklerle değiştirildi
  (`level_18_completion %9 → %25`, `crash_rate 0.8 → 0.3 / oturum`).

### 3. Panel: ölçemediğimiz metriği sormayı önermeyi bıraktık

Copilot'un önerdiği ilk soru **"Retention neden düşüyor?"** idi — ölçmediğimiz
bir metrik. Kullanıcıyı doğrudan "bu metrik ölçülmüyor" cevabına sürüklüyordu.
TR+EN, banner ve buton dahil, ölçülebilir bir soruyla değiştirildi:
*"Oturum süresi nerede kısalıyor?"*

## 🔴 Bu oturumda YAPILMAYANLAR

| Eksik | Neden |
|---|---|
| **Gerçek retention hesabı** | Günlük toplu istatistiklerden hesaplanamaz; oyuncu bazlı ilk-görülme tarihi gerekir → Faz 2, sütunlu veritabanıyla |
| Kohort / huni analizi | Aynı sebep |
| `EVENT_CAP` kırpması | Duruyor |

## ⚙️ Yayın durumu

- ✅ Commit `main`'de
- ⚠️ **`firebase deploy --only functions` GEREKLİ** — prompt değişiklikleri
  sunucu tarafında; deploy edilmeden AI eski örneklerle çalışmaya devam eder
- ✅ Panel değişikliği (copilot sorusu) site yayınıyla otomatik

---

# Oturum: SDK v3.0 — evrensel analitik istemcisi

**Kapsam:** `041a464` · Cloud Functions deploy'u gerektirmez (yalnızca istemci
+ panel) · ⏭️ Sitenin yayına alınması `main`'e merge ile otomatik

**Amaç:** *"SDK'ları bir oyun özelinde düşünme."* SDK'yı tür, motor ve altyapı
farketmeksizin her oyunda aynı çalışacak biçimde yeniden yazdık.

---

## 🟢 Tamamlananlar

### 1. Analitik katmanı Firebase'den tamamen çıkarıldı

**Neydi:** Her olay doğrudan Firestore'a yazılıyordu; bu, oyunun Firebase
Unity SDK'sını import etmesini **zorunlu** kılıyordu.

**Neden önemliydi:** "Her kategoriden oyun, illa Firebase entegre bile
olmayacak" hedefinin önündeki tek engel buydu.

**Ne yapıldı:** Olaylar artık HTTPS ile `ingestEvents` ucuna gidiyor.

| Önce | Şimdi |
|---|---|
| Firebase Unity SDK indir + Auth + Firestore import et | — |
| `google-services.json` yerleştir | — |
| 5 `.cs` dosyası kopyala | **2 `.cs` dosyası kopyala** |

Firebase yalnızca **isteğe bağlı** iki modül için gerekli kaldı:
`AltareConfig` (canlı Remote Config) ve `AltarePlayerState` (rollback).
Bu ikisinin Firebase kurulumu `AltareFirebase`'e taşındı — artık kendi
anonim oturumunu açıyor, analitiğe bağımlı değil.

### 2. Toplu gönderim

**Neydi:** Her olay anında ayrı bir yazım/istek üretiyordu; 50 olay = 50 ağ turu.

**Ne yapıldı:** 50 olay / 30 saniye / arka plana atılma tetikleyicileriyle
tek istek. Ağ turu ve faturalanan Cloud Function çağrısı **50 → 1**.

> ⚠️ **Dürüst not:** Firestore doküman başına ücretlendirdiği için
> **depolama maliyeti bu adımda değişmez.** O kazanç sütunlu veritabanı
> geçişinde (Faz 2) gelir. Toplu gönderim o geçişin **ön koşuludur**.

### 3. Diske yazan kuyruk

**Neydi:** Tampon yalnızca bellekteydi — oyun çökerse, oyuncu uçak modundayken
kapatırsa olaylar uçuyordu.

**Ne yapıldı:** Olaylar sunucu onaylayana kadar kalıcı depolamada tutuluyor,
sonraki açılışta kurtarılıyor. Veri kaybı bitti.

### 4. Akıllı yeniden deneme

**Neden önemliydi:** ChopHero istemcisinde tespit ettiğim tuzak — 401'i
"geçici hata" sanıp 30 saniyede bir sonsuza kadar denemek — bu SDK'da
baştan imkânsız olmalıydı.

**Ne yapıldı:** Hata taksonomisi ayrıldı:

| Hata | Davranış |
|---|---|
| 400 / 404 / 413 (gövde, bilinmeyen oyun) | Kalıcı → ölçüm kapatılır |
| 401 / 403 (geçersiz anahtar) | Kalıcı → yüksek sesle loglanır, kapatılır |
| Ağ / 429 / 5xx | Geçici → üstel geri çekilmeyle denenir |

### 5. `sessionId` artık gönderiliyor

Sunucuda `uniqueSessions` bundan sayılıyor ve o değer anomali oranlarının
paydası. Eksikliği Sentinel'i yanıltıyordu.

### 6. Panel: API anahtarı otomatik gömülüyor

Panelden inen zip'teki bootstrap'a `GameId`, `GameName` **ve `ApiKey`**
önceden dolu geliyor — müşteri elle yapıştırmıyor.

---

## 🔍 Test — ve bulunan bir bug

Ortamda Unity olmadığı için derleme yapılamadı; yerine statik analiz ve
mantık portu uygulandı:

- 5 dosyada token bazlı denge kontrolü (kaba regex Türkçe apostrofları char
  literal sanıyordu; düzgün bir C# durum makinesi yazıldı) — **tam**
- 17 iç metot tanımlı, `AltareAnalytics`'te Firebase referansı **sıfır**
- Elle yazılan JSON + diskten geri okuma **11/11** kenar durum geçti

**🐞 Bulunan bug:** Diskten geri okuma JSON kaçışlarını çözmüyordu — satır
sonu karakteri `n` harfine, unicode kaçışı düz metne dönüşüp **veriyi
sessizce bozuyordu.** Tam kaçış çözümü yazıldı, testler yeşile döndü.

---

## 🔴 Bu oturumda YAPILMAYANLAR

Bilinçli olarak ertelendi — sıradaki işler:

| Eksik | Neden bekliyor |
|---|---|
| **gzip sıkıştırma** | Toplu gönderimin yanında kazancı küçük; ertelendi |
| **`retentionD1Proxy` düzeltmesi** | Sıradaki iş — küçük ama bütünlük açısından kritik |
| **Gerçek retention / kohort / huni** | Faz 2; sütunlu veritabanıyla birlikte planlanmalı |
| **`EVENT_CAP = 10000` kırpması** | Duruyor — AI raporları hâlâ eksik veriyle çalışıyor |
| **ClickHouse geçişi** | Faz 2'nin kendisi; asıl maliyet kazancı burada |
| **A/B test altyapısı** | Faz 3 — asıl satış argümanı |
| **Denetim kaydı / veri silme API'si / DPA** | Faz 3; kurumsal satışın ön koşulu |
| **ChopHero istemcisinin güncellenmesi** | Kullanıcı kararıyla olduğu gibi bırakıldı |

> **Bunun sonucu:** `INGEST_REQUIRE_API_KEY` bayrağı **`false` kalmalı.**
> ChopHero anahtar göndermiyor; zorunlu yapılırsa o oyunun akışı kesilir.

---

## ⚙️ Yayın durumu

- ✅ Commit `main`'de
- ✅ Panelden inen SDK artık v3.0 (site `main`'den yayınlanıyor)
- ⚠️ **Cloud Functions deploy'u gerekmez** — bu oturum yalnızca istemci ve
  panel tarafına dokundu
- ⏭️ Yayındaki oyun build'leri yeni SDK'yı ancak güncellenince alır

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
