# Altare — Değişiklik Kaydı

> Ne değişti, **neden önemliydi**, ne yapıldı. Yeni oturumlar en üste ekler.
>
> **Güncel durum panosu için:** [`ALTARE_SCALE_ROADMAP.md` §0.1](ALTARE_SCALE_ROADMAP.md)
> — bu dosya *ne yaptığımızı*, orası *nerede durduğumuzu* anlatır.

---

# Oturum: Huni (funnel) dönüşüm analizi — "oyuncular nerede kopuyor"

**Kapsam:** huni motoru + AI beslemesi + panel ·
⚠️ **`firebase deploy --only functions` + `firestore:rules` GEREKİR**

**Sorun:** *"Oyuncular tam olarak nerede kopuyor?"* sorusu cevapsızdı.
Panelde bölüm bazlı fail/complete sayıları vardı ama bunlar **sıralı bir yol
değil, bağımsız sayaçlardı**: tutorial'ı hiç görmeden bölüm bitiren bir
oyuncu ile tutorial'dan sonra bitiren oyuncu aynı sayılıyordu. AI da huni
sayısı istendiğinde *"bu metrik ölçülmüyor"* demek zorundaydı.

## 🟢 Tamamlananlar

### 1. Huni motoru — `firebase/functions/funnels.js` (yeni)

Yine Firebase'siz saf matematik (`node tools/test-funnels.js`).

| Karar | Neden böyle |
|---|---|
| Huni **küme kesişimi değil, sıralı yol** | "IAP satın alan oyuncu" ile "mağazayı GÖRDÜKTEN SONRA satın alan oyuncu" farklı şeyler. Adım N, adım N-1'den sonra olmak zorunda; yoksa mağazayı hiç görmemiş oyuncu "dönüştü" sayılır |
| ⚠️ **Olgunlaşma kuralı** | Retention'daki kohort tuzağının aynısı: huniye 10 dk önce giren oyuncu "koptu" sayılamaz. Sayılırsa dönüşüm yapay olarak düşer — ve **makul görünen** bir yanlış sayı üretir. Penceresi kapanmayanlar `inProgress` olarak ayrı raporlanır ki n'in neden küçük olduğu görünsün |
| Pencere zorunlu | Adım 1'i Ocak'ta, adım 2'yi Mart'ta yapan oyuncu "dönüştü" sayılmamalı |
| İlk gerçekleşme kuralı | Tek oyuncunun aynı adımı tekrar tekrar yapması sayıyı şişirmesin |
| Analiz birimi oyuncu | Olay bazında sayım çok oynayan oyuncuyu birden fazla sayar |
| `paramValue` metne çevrilerek karşılaştırılır | İstemciler tutarsız: `level` bazen `3`, bazen `"3"`. Bu tutarsızlık yüzünden huninin **sessizce boş çıkması** gerçek bir risk |

Çıktı: adım başına ulaşan oyuncu, önceki adımdan ve ilk adımdan dönüşüm,
**medyan geçiş süresi** (nerede takılıyor vs. nerede terk ediyor) ve **en
büyük kopuş adımı** — aksiyon alınacak tek nokta.

Hazır şablonlar: onboarding · monetizasyon · ödüllü reklam (TR+EN etiketli).
Boş bir "huni oluştur" formu kimseye yardım etmez.

### 2. ⚠️ AI'ın uydurma yasağı artık TEK KAYNAKTAN türetiliyor

Bu, huni işinin en önemli parçası. "Şunlar ölçülmüyor, sayı verme" listesi
**dört ayrı yerde elle yazılıydı** (TR/EN × ölçüldü/ölçülmedi). Huni ölçülmeye
başlayınca dördünü birden güncellemek gerekiyordu ve biri atlanırsa:

- ölçülen bir metrik "ölçülmüyor" listesinde kalır → AI gerçek veriyi
  kullanmaz, ürün kendi ölçümünü çöpe atar
- ölçülmeyen bir metrik listeden düşerse → **AI sayı uydurur** ve müşteri o
  sayıya göre karar verir

Artık `OLCULEBILIR_METRIKLER` kayıt defteri var: bir metrik ölçülmeye
başladığı anda yasaktan **kendiliğinden** çıkıyor, ölçüm yoksa yasak
**kendiliğinden** duruyor. `tools/test-ai-context.js` bunu iki yönlü
doğruluyor (60 kontrol).

### 3. Panel — Level Intelligence sekmesinde "Dönüşüm Hunileri"

Daralan çubuklar, adım başına oyuncu + dönüşüm yüzdesi, medyan geçiş süresi,
en büyük kopuş adımı kırmızı işaretli. Tek tıkla hazır huni ekleme, "Şimdi
Ölç", uyarı blokları.

**Yan bulgu:** aynı sekmedeki "Level Aralık Dağılımı" bölümü **"Funnel"** diye
etiketlenmişti ama huni değil — bağımsız aralık sayaçları. `retentionD1Proxy`
ile aynı türde yanıltıcı etiket; düzeltildi.

## 🔴 Bu oturumda YAPILMAYANLAR

| Ne | Neden |
|---|---|
| Event akışını ClickHouse'a taşımak | **Altyapı kararı sende:** ClickHouse Cloud mu BigQuery mi, bütçe, KVKK için bölge |
| `EVENT_CAP` / `FUNNEL_EVENT_CAP` kırpması | ClickHouse'a bağlı. Şimdilik kırpma olursa rapor bunu **açıkça işaretliyor** |
| Panelden özel (şablon dışı) huni oluşturma formu | `createFunnel` ucu destekliyor, panelde form yok — şablonlar ilk ihtiyacı karşılıyor |
| Denetim kaydı + veri silme API'si | Faz 3'ün kalan tek kalemi |

## 🐛 Testin yakaladığı hata

EN huni bloğunda adım satırları **Türkçe kalmıştı** (`"önceki adımdan %80"`)
ve yüzde işareti Türkçe konumundaydı. AI karışık dilde bağlam alıyordu —
`localizeSystemPrompt`'un tüm amacı bunu önlemek. Ayrıca şablon adım
etiketleri sadece Türkçeydi, yani EN kullanıcı Türkçe etiketli huni alıyordu.
İkisi de düzeltildi; test artık EN şablonda Türkçe karakter olmadığını da
kontrol ediyor.

## Testler

`bash tools/test-all.sh` — ağ, emulator, Unity gerekmez.

| Ne | Kontrol |
|---|---|
| Huni analizi (sıralı yol, olgunlaşma, dönüşüm) | 85 |
| AI bağlam bloğu (uydurma yasağı iki yönlü) | 60 |
| Panel huni kartı render'ı (bozuk/eksik veri dahil) | 34 |
| *(önceki oturumlardan)* A/B motoru · parite · JSON · panel deney | 116 · 1919 · 43 · 40 |

## Yayın durumu

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules
```

`firestore:indexes` bu iş için **gerekmiyor** — huni sorgusu yalnızca
`timestamp` üzerinden, o da otomatik indeksli.

İlk huni sonucu: panelden hazır bir huni ekleyip **"Şimdi Ölç"** e bas, ya da
6 saatte bir çalışan `computeFunnels` işini bekle. Anlamlı bir oran için
huninin penceresi (onboarding'de 24 saat) kadar veri birikmiş olması lazım.

---

# Oturum: A/B test altyapısı — Auto-Heal artık ölçülüyor (Faz 3)

**Kapsam:** deney motoru + guardrail nöbetçisi + SDK'nın Firebase'den
kurtulması + panel arayüzü ·
⚠️ **`firebase deploy --only functions` + `firestore:rules,firestore:indexes` GEREKİR**

**Sorun:** Auto-Heal reçeteleri **%100 trafiğe** uygulanıyordu. Metrik sonra
düzeldiğinde bunun reçeteden mi, mevsimsellikten mi, yeni bir güncellemeden
mi geldiğini söylemenin yolu **yoktu**. *"Düzeldi"* demek ile *"düzelttik"*
demek arasındaki fark tam olarak budur.

**Döngü artık şöyle:**

```
Anomali → AI reçetesi → %10'da DENEY → ölç
                                        ├─ kazandıysa → yaygınlaştır
                                        └─ zarar veriyorsa → OTOMATİK durdur
```

## 🟢 Tamamlananlar

### 1. Deney motoru — `firebase/functions/experiments.js` (yeni)

Firebase'siz saf matematik katmanı. **Neden ayrı dosya:** deploy etmeden,
emulator çalıştırmadan, tek `node` komutuyla test edilebilsin diye. Yanlış
bir z-testi canlı oyuna yanlış config yazdırır; bu kodun test edilebilir
olması opsiyonel değil.

| Karar | Neden böyle |
|---|---|
| Atama sunucuda **yeniden hesaplanabilir** (FNV-1a, saf fonksiyon) | İstemcinin yalan söylemesine karşı koruma |
| Ama atama tek başına yetmez — **exposure olayı şart** | Sunucu atamayı hesaplayabilir, ama oyuncunun değerleri *gerçekten gördüğünü* bilemez. Eski bir istemci config'i hiç okumuyor olabilir; onları deneye katmak etkiyi sulandırıp her deneyi "fark yok" gösterir (dilution bias) |
| Giriş ve varyant hash'leri **ayrı** | `exposurePct` büyütüldüğünde mevcut oyuncular varyant değiştirmesin ("%10 ile başla, %50'ye çık" çalışsın) |
| Analiz birimi **oyuncu**, olay değil | Olay bazında test sahte bağımsızlık (pseudo-replication) üretir: 100 oturum açan tek oyuncu 100 oyuncu gibi sayılır ve p-değeri yapay olarak küçülür |
| Minimum örneklem dolmadan **kazanan ilan edilmez** | p-değerine her gün bakmak yanlış pozitif oranını %5'ten %20'lere çıkarır (peeking) |
| Guardrail'ler tek yönlü ve **daha katı** (p<0.01) | İyi bir deneyi gürültüden durdurmak, kötü bir deneyi bir gün fazla çalıştırmaktan pahalıdır — her durdurma güveni aşındırır |

İstatistik tamamen elde yazıldı (Cloud Functions'a scipy kurulamaz):
`erf` (Abramowitz–Stegun 7.1.26), ters normal (Acklam), iki oran z-testi
(test havuzlanmış, güven aralığı ayrık varyansla — doğru kombinasyon),
Welch t-testi, gereken örneklem hesabı.

**Metrikler:** çökmesiz oyuncu oranı · D1 dönüş · IAP dönüşüm · ödüllü
reklam · ortalama oturum süresi · oyuncu başına oturum · tamamlanan bölüm ·
bölüm başarısızlık oranı · oyuncu başına gelir. Her metriğin kendi
**uygunluk** kuralı var — örneğin D1'de penceresi kapanmamış oyuncu paydaya
girmez, yoksa "dönmedi" sayılır ve retention yapay olarak düşük çıkar.

### 2. Guardrail nöbetçisi — `monitorExperiments` (6 saatte bir)

Deneme grubu ölçülebilir biçimde zarar veriyorsa (çökme / oturum süresi /
gelir) deney **kimse tıklamadan** durur, oyuncular önceki değerlere döner ve
sahibine uyarı yazılır. Sessizce durdurmak güveni aşındırır.

### 3. Auto-Heal artık deney yoluna bağlı

Reçetede iki buton var: **⚡ Uygula** ve **🧪 %10'da Test Et**.
AI `ab_test_required: true` dediğinde ya da risk yüksekse doğrudan uygulama
**kapanır** — `force: true` ile aşılabilir (acil müdahale), yüksek riskte
admin şartı sürer. Ayrıca bir deneyde ölçülen anahtarı aynı anda herkese
yazmak **engellendi**: o, kontrol grubunu da deneme değerine taşıyıp deneyi
sessizce geçersiz kılar.

AI prompt'u da düzeltildi: eskiden "High ise A/B test zorunlu" yazıyordu ama
A/B **yoktu** — temenniydi. Artık gerçek bir yol.

### 4. ⚠️ SDK Firebase'den kurtuldu — bu bir gap'ti

`AltareConfig.cs` `using Firebase.Firestore` içeriyordu, yani **Firebase'i
olmayan bir projede derlenmiyordu bile.** A/B deneyleri de bu kanaldan
dağıtıldığı için **Faz 3'ün tamamı yalnızca Firebase'li oyunlarda
çalışabilirdi** — "birçok oyunda Firebase olmayacak" şartıyla doğrudan
çelişiyordu.

v3.0'da düz HTTPS'e geçti (yeni `getGameConfig` ucu, gameId başına 30 sn
bellekte önbellek → Firestore okuması oyuncu sayısıyla değil oyun sayısıyla
ölçeklenir). Firebase artık yalnızca `AltarePlayerState` ve **isteğe bağlı**
anlık güncelleme için gerekli. Bağımlılık yönü de düzeltildi: opsiyonel dosya
çekirdeğe bağımlı, tersi değil.

`AltareJson` — küçük, bağımsız JSON okuyucu (Unity'nin `JsonUtility`'si
`Dictionary<string,object>` okuyamaz, Newtonsoft ise oyuna zorunlu paket
ekler).

### 5. ⚠️ Panelden inen pakette sessiz sürüm kayması kapatıldı

`js/games.js` içindeki gömülü yedek kopyalar **v2.1.0'da donmuştu** — yani
Firestore'a doğrudan yazan, *"veri panele hiç ulaşmıyor"* hatasının **kaynağı
olan** sürüm. Fetch bir kez başarısız olsa müşteri sessizce o bozuk SDK'yı
indiriyor ve bunu anlamasının hiçbir yolu olmuyordu.

Yedekler kaldırıldı (~690 satır); dosya alınamazsa indirme artık **açıkça
duruyor**. Sessiz sürüm kayması, açık bir hatadan çok daha pahalıdır.

### 6. Panel arayüzü

Auto-Heal sekmesinde yeni **🧪 A/B Deneyleri** bölümü: varyantlar ve
oyuncu sayıları, birincil metrik yıldızlı, bağıl artış + p-değeri + n,
guardrail etiketleri, uyarı blokları, ve duruma göre aksiyonlar
(Şimdi Ölç / Yaygınlaştır / Durdur / Vazgeç). TR+EN tam (39 anahtar × 2).

## 🔴 Bu oturumda YAPILMAYANLAR

| Ne | Neden |
|---|---|
| Event akışını ClickHouse'a taşımak | **Altyapı kararı sende:** ClickHouse Cloud mu BigQuery mi, bütçe, KVKK için bölge. Provision edilmeden başlanamaz. |
| `EVENT_CAP = 10000` kırpması | ClickHouse'a bağlı |
| Huni (funnel) dönüşüm analizi | Sırada, ClickHouse'a bağlı değil |
| Denetim kaydı + veri silme API'si | Faz 3'ün kalan kalemi |
| Çok kollu deney (3+ varyant) panelden oluşturma | `createExperiment` ucu destekliyor, panelde form yok — Auto-Heal yolu 2 kollu |

## 🐛 Kendi kodumda bulup düzelttiğim hata

Welch testinde `se > 0 ? t : 0` guard'ı, **her iki grupta varyans sıfırken**
net bir farkı `p=1` ile *"fark yok"* ilan ediyordu. Ayrık metriklerde bu
gerçekten olur: "her oyuncu tam 1 oturum açtı". Sessiz ve tehlikeli bir hata
— testte 4 vs 2 oturum farkı "anlamsız" çıktığı için yakalandı. Dejenere
durum artık ayrıca ele alınıyor ve raporda işaretleniyor.

## ⚠️ İstemci/sunucu paritesi — sessiz hata sınıfı

Atama iki yerde hesaplanıyor. **Tek bit** ayrışırsa deney sessizce
anlamsızlaşır: hata mesajı çıkmaz, yalnızca sonuçlar rastgele gruplara
dağılır ve her deney "fark yok" der. Üç savunma katmanı:

1. `tools/test-hash-parity.py` — C# `uint` semantiğini birebir modelleyip
   JS ile karşılaştırır (1919 kontrol, Türkçe/emoji/GUID girdiler dahil)
2. `AltareExperiments.SelfTest()` — aynı referans değerleri Unity içinde
   doğrular (IL2CPP/farklı .NET sürümünde sapma olursa yakalar)
3. Yüzdeler **%0.01 ızgarasına** zorlanır: tam yarım değerde JS `Math.round`,
   C# `AwayFromZero` ve Python banker's rounding **üç farklı** sonuç verir.
   Girdiyi kısıtlayarak o sınıfı tamamen kaldırdık — üç dilde yuvarlama
   davranışını eşleştirmeye çalışmaktan çok daha sağlam.

## Testler

`bash tools/test-all.sh` — ağ, emulator, Unity gerekmez.

| Ne | Kontrol |
|---|---|
| A/B deney motoru (atama, istatistik, karar kuralları) | 116 |
| İstemci/sunucu hash paritesi | 1919 |
| `AltareJson` ayrıştırıcı (≡ `JSON.parse`, 400 fuzz yapısı) | 43 |
| Panel deney kartı render'ı (bozuk/eksik veri dahil) | 40 |
| Unity SDK C# yapısal denge | 6 dosya |

## Yayın durumu

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules,firestore:indexes
```

`firestore:indexes` **şart**: deney analizi maruz kalma olaylarını
`eventName` + `timestamp` bileşik index'i üzerinden çekiyor. İndeks
olmadan analiz hata verir.

Site (panel + SDK dosyaları) GitHub Pages ile `main`'den otomatik yayına
girer — ek işlem yok.

---

# Oturum: GERÇEK retention — kohort bazlı D1/D7/D30

**Kapsam:** oyuncu rollup + `computeRetention` + AI beslemesi + panel ·
⚠️ **`firebase deploy --only functions` + `firestore:rules` GEREKİR**

**Karar:** Bu iş yol haritasında Faz 2'ye, ClickHouse geçişinin arkasına
konmuştu. Ama asıl eksik olan şey **depolama değil, oyuncu bazlı ilk-görülme
verisiydi.** Onu toplamaya bugün başlarsak retention bugün çalışır ve geçişte
aynen taşınır — bu yüzden ClickHouse beklenmeden yapıldı.

## 🟢 Tamamlananlar

### 1. Oyuncu rollup'ı — retention'ın temeli

`games/{gameId}/players/{playerAnonId}` — oyuncu başına **tek** doküman
(gün başına değil, doküman sayısı oyuncu sayısıyla sınırlı kalsın diye):

```
cohortDay    : "YYYY-MM-DD" | null   -> YALNIZCA first_open görüldüğünde
firstSeenDay : "YYYY-MM-DD"          -> bizim ilk kaydımız
lastSeenDay  : "YYYY-MM-DD"
activeDays   : [gün...]              -> son 35 gün (D30 için yeterli)
```

`ingestEvents` her yığından sonra günceller. Aynı oyuncu için gün içinde
tekrar yazmamak için bellekte önbellek var — yığınlar 30 sn'de bir geliyor
ama rollup günde **bir kez** değişiyor.

### 2. ⚠️ Kohort tuzağı — ve nasıl önlendiği

**Tuzak:** Aylardır oynayan bir oyuncuyu bugün ilk kez görürsek "yeni
kurulum" sanırız. SDK'yı yeni takan bir oyunda **bütün oyuncular** aynı gün
kohortuna düşer, ertesi gün çoğu dönmez ve retention **yapay olarak çöker.**
Sonra bu sahte rakamı stüdyoya rapor ederiz.

**Çözüm:** Kohorta yalnızca **`first_open` event'i görülmüş** oyuncular
girer. `first_open` yoksa oyuncu aktivitede sayılır ama kohortta sayılmaz.
Yani retention, SDK entegrasyonundan sonra kurulan gerçek yeni oyuncular
üzerinden hesaplanır.

### 3. `computeRetention` — 6 saatte bir

Standart tanım: `DN = (kohort gününde kuran VE D+N gününde aktif olan) /
(kohort gününde kuran)`.

Bir pencere **ancak dolduğunda** hesaplanır (D+N günü geçmiş olmalı) ve
tamamlanan kohort tekrar hesaplanmaz. Çıktı:
`games/{gameId}/retention/{cohortDay}`.

### 4. Ölçülen retention AI'a besleniyor — döngü kapandı

Bir önceki oturumda AI'a *"retention ölçülmüyor, sayı uydurma"* demiştik.
Artık `gameContextBlock` **dinamik**:

| Durum | AI'a giden |
|---|---|
| Ölçüm var | `D1=%42.3 (kohort 2026-09-09, n=812)` + "bunlar GERÇEK ölçüm" |
| Ölçüm yok | "henüz retention ölçümü YOK, sayı uydurma" |

Her iki durumda da baseline'daki hedeflerin **tür referansı** olduğu, bu
oyunun ölçümü olmadığı ayrıca belirtiliyor. Huni/LTV için yasak **her
durumda** sürüyor — onlar hâlâ ölçülmüyor.

### 5. Panel — üç yeni KPI kartı

D1 / D7 / D30, her birinin altında hangi kohorttan geldiği ve kohort boyu.
Bu şeffaflık bilinçli: D1 dünkü kohorttan, D30 31 gün öncekinden gelir —
tarihler farklı olmasa şaşırtıcı olurdu.

## 🔍 Test

- Gün aritmetiği 8/8: ay sonu, yıl sonu, artık yıl, negatif, bozuk girdi
- Pencere uygunluğu: kohort N gün önceyse yalnızca `N > pencere` olanlar
- Retention sayımı: elle kurulmuş 4 oyunculu kohortta D1/D7/D30 doğrulandı
- AI bağlam bloğu 4 durumda: ölçüm var/yok × TR/EN — kısmi veride (yalnız D1
  hazır) D7/D30 **uydurulmuyor**
- Panel render: her pencere kendi en yeni **tamamlanmış** kohortundan geliyor
- `firestore.indexes.json` değişmedi — sorgular tek alanlı, Firestore
  otomatik indeksliyor

## 🔴 Bu oturumda YAPILMAYANLAR

| Eksik | Neden |
|---|---|
| **Huni (funnel) analizi** | Ayrı bir iş; level akışı var ama dönüşüm hunisi yok |
| **Geriye dönük retention** | Rollup bugünden itibaren birikiyor; ilk D1 ~2 gün, D30 ~31 gün sonra çıkar |
| **Eski SDK yolu** | Doğrudan Firestore yazan eski build'ler rollup üretmez; v3.0'a geçtikçe kapanır |
| ClickHouse, A/B test, denetim kaydı | Faz 2/3'te duruyor |

## ⚙️ Yayın durumu

- ✅ Commit `main`'de
- ⚠️ **`firebase deploy --only functions`** — yeni `computeRetention` job'ı ve
  prompt değişikliği
- ⚠️ **`firebase deploy --only firestore:rules`** — `players/` ve `retention/`
  koleksiyonları için okuma kuralı; **bu olmadan panel kartları boş kalır**
- ⏳ İlk D1 değeri, deploy'dan **~2 gün sonra** görünür (kohortun dolması lazım)

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
