# BigQuery olay ambarı

**Bölge:** `europe-west1` · **Dataset:** `altare_analytics` · **Tablo:** `events`

---

## Neden yapıldı — para nerede yanıyor

Sorun BigQuery'nin hızı değil, **Firestore'un okuma faturası**. Koddaki
sabitlerden hesaplandı, tahmin değil:

`buildSummaryData` çağrı başına **10.000 doküman** okuyor (`EVENT_CAP`).

| İş | Sıklık | Çağrı/ay | Okuma/ay | $/oyun/ay |
|---|---|---|---|---|
| `aggregateDailyStats` | 30 dakikada bir | 1.440 | 14,4M | ~$8,6 |
| `detectAnomalies` | 30 dakikada bir | 2.880 *(now + baseline)* | 28,8M | ~$17,3 |
| **Toplam** | | | **43,2M** | **~$25,9** |

6 oyunda **~$155/ay**. Bu bir tavan — pencerede 10.000'den az event varsa
okuma o kadar olur.

Asıl israf şurada: `detectAnomalies`'in **baseline penceresi geçmiş
veridir, bir daha asla değişmez** — yine de 30 dakikada bir baştan okunuyor.
Aynı olaylar ayda binlerce kez faturalanıyor.

> **Önemli:** BigQuery'nin kendisi bu ölçekte neredeyse bedava olacak
> (aşağıya bak). Tasarruf, aynı olayı tekrar tekrar **okumamaktan** geliyor.
> Yani bu faz (boru hattı) tek başına **para kazandırmaz** — okuma yolları
> Faz 2'de taşınana kadar sadece altyapıyı kurar.

---

## Kurulum — bir kez, elle

### 1. Deploy

Kodun canlıya çıkması gerek (yeni fonksiyon `setupBigQuery` ve BigQuery
yazım yolu):

```bash
cd firebase
firebase deploy --only functions
```

Tek fonksiyonu deploy etmek yeterliyse:

```bash
firebase deploy --only functions:setupBigQuery,functions:ingestEvents,functions:detectAnomalies,functions:aggregateDailyStats
```

Panel değişiklikleri (Altyapı sekmesi) GitHub Pages'ten gelir — `main`'e
push yeterli, ayrı deploy yok.

### 2. Butona bas

Panelde **Altyapı → Veri Ambarını Kur**. Sekme yalnızca admin'e görünür.

Dataset'i `europe-west1`'de oluşturur ve tabloyu dört korkulukla kurar.
Tekrar basmak zararsızdır (`exists()` kontrolü + `CREATE TABLE IF NOT
EXISTS`).

> **Yetki hatası alırsan** Functions servis hesabının BigQuery izni yok
> demektir. Cloud Console → IAM'den servis hesabına
> `roles/bigquery.dataEditor` + `roles/bigquery.jobUser` ver. Buton bu hatada
> ne yapman gerektiğini zaten ekrana yazıyor.

Dataset'i `europe-west1`'de oluşturur ve tabloyu dört korkulukla kurar.
Çağrılana kadar olaylar **yalnızca Firestore'a** yazılır ve loglara açık bir
uyarı düşer — sessizce kaybolmaz.

Otomatik değil, çünkü her yazımda "yoksa oluştur" denemek, tablo gerçekten
oluşamadığında (yetki, kota) sonsuz deneme demektir ve her denemenin bedeli
vardır.

**Dataset konumu sonradan değiştirilemez.** `europe-west1` seçildi çünkü
Functions da orada (bölgeler arası transfer ücreti yok, gecikme düşük) ve
veri KVKK/GDPR açısından AB'de kalıyor.

---

## Dört maliyet korkuluğu

BigQuery **taranan bayt** üzerinden ücretlendirir. DDL'deki dört satır:

1. **`PARTITION BY event_date`** — bölümleme olmadan "son 7 gün" sorgusu tüm
   tabloyu tarar. Bölümlemeyle sadece 7 bölüm okunur.
2. **`CLUSTER BY game_id, event_name, player_anon_id`** — sıra önemli,
   BigQuery önekten yararlanır. Her sorgumuz önce `game_id` filtreliyor.
3. **`require_partition_filter = TRUE`** — bölüm filtresi olmayan sorguyu
   BigQuery **reddeder**. Diğer üçü maliyeti azaltır; **bu önler.** En
   değerlisi budur: "biri `WHERE`'siz sorgu yazdı ve tüm tabloyu taradı"
   kazası artık mümkün değil.
4. **`partition_expiration_days = 400`** — depolama sonsuza kadar büyümesin.
   Bir yıl + kohortların olgunlaşması için pay.

Ayrıca: **asla `SELECT *` yazma.** Sütunlu depoda yalnızca okuduğun sütunlar
için ödersin. `event_params` en geniş sütun; ona dokunmayan sorgular çok daha
ucuz.

`bigquery.js` içindeki `sorguyuDenetle(sql)` bu üç hatayı sorgu
çalıştırılmadan **önce** yakalar.

---

## Bu ölçekte maliyet

Kaba hesap: ~150k event/gün, satır başına ~300 bayt → **~1,35 GB/ay**.

- **Depolama:** ilk 10 GB ücretsiz. Bir yıl sonra ~16 GB → aylık birkaç sent.
- **Sorgu:** aylık ilk 1 TiB ücretsiz. Bölümlenmiş 30 günlük sorgu ~1,35 GB
  tarar — uzun süre ücretsiz katmanın içinde kalır.
- **Yazım:** streaming insert, ~1,35 GB/ay → aylık birkaç sent.

**Sonuç: BigQuery şu an neredeyse sıfır.** Kazanç Firestore tarafında.

> Fiyatlar değişebilir; buradakiler büyüklük mertebesi için. Kesin rakam için
> Google Cloud fiyat sayfasına bak.

---

## Faz planı

- **Faz 1 — yapıldı.** Boru hattı, şema, korkuluklar, testler.
- **Faz 2 — asıl tasarruf.** Okuma yollarını BigQuery'ye taşı, **30
  dakikalık işlerden başlayarak** (`detectAnomalies`, `aggregateDailyStats`);
  para orada. Her biri Firestore sonucuyla karşılaştırılarak doğrulanmalı.
- **Faz 3.** BigQuery kanıtlandıktan sonra Firestore event saklama süresini
  kısalt (canlı akış için 7 gün yeter) — Firestore depolama + okuma maliyeti
  daha da düşer.

### Hızlı kazanç — **yapıldı** (Faz 2'den bağımsız)

`detectAnomalies`'in baseline'ı artık ham event yerine günlük özet
dokümanlarından kuruluyor:

| | okuma/ay | $/oyun/ay |
|---|---|---|
| Önce (2 × `buildSummaryData`) | 28,8M | ~$17,3 |
| Sonra (1 × `buildSummaryData` + ~8 doküman) | 14,4M | ~$8,65 |
| **Kazanç** | **14,4M (%50)** | **~$8,6** — 6 oyunda ~$52/ay |

Bunun yanında **iki gerçek hata** düzeldi. İkisi birbirini maskeliyordu:

1. Baseline sorgusu `orderBy timestamp desc limit 10000` olduğu için "7
   günlük baseline" aslında **7 günün en yeni 10.000 event'i** idi — günde
   150k event üreten bir oyunda ~1,6 saat. Sentinel kendini kendisiyle
   karşılaştırıyordu.
2. `dau_drop` kuralı **ham sayı** karşılaştırıyordu: 2 saatlik tekil oyuncu
   vs 7 günlük. Gerçek bir 7 günlük baseline'da neredeyse her koşuda
   tetiklenirdi — ama baseline kırpıldığı için `now ≈ baseline` oluyor ve
   kural susuyordu.

Yani **yalnızca baseline'ı düzeltmek yanlış alarm seline yol açardı.** İkisi
birlikte çözüldü: `dau_drop` artık bugünün DAU'sunu önceki günlerin günlük
ortalamasıyla karşılaştırıyor — iki taraf da 24 saat.

`sentinel.js` içindeki `PENCERE_GUVENLIGI` kaydı bu tuzağı kalıcı olarak
kapatıyor: yeni bir kural ham sayı karşılaştırırsa test kırılır ve yazan kişi
"bu kural hangi pencereyi ölçüyor" sorusunu cevaplamak zorunda kalır.

### `aggregateDailyStats` saatliğe alındı

| | okuma/ay | $/oyun/ay |
|---|---|---|
| 30 dakikada bir | 14,4M | ~$8,6 |
| **Saatlik** | **7,2M** | **~$4,3** |
| Kazanç | %50 | ~$4,3 — 6 oyunda ~$26/ay |

Tazelik kaybının kimseyi vurmadığı kontrol edildi: KPI kartları **24 saatlik
yuvarlanan** toplamlar (30 dakikada zaten kayda değer değişmez), sektör
benchmark günlük toplama, Sentinel baseline'ı ise **önceki günlerin**
özetlerini kullanıyor. Anlık görünüm isteyen kullanıcı zaten **Canlı Event
Stream** sekmesinde ve orası gerçek zamanlı.

Yavaşlayan tazelik **görünür kılındı**: panel artık başlıkta
`veri: 38 dk önce` yazıyor (`stats.updatedAt`). Aksi halde yanındaki canlı
saat, sayıların o dakikaya ait olduğunu ima etmeye devam ederdi.

### Toplam kazanç

| Kalem | Önce | Sonra |
|---|---|---|
| `detectAnomalies` | ~$17,3 | ~$8,65 |
| `aggregateDailyStats` | ~$8,6 | ~$4,3 |
| **Oyun başına toplam** | **~$25,9** | **~$13,0** |
| **6 oyun** | **~$155/ay** | **~$78/ay** |

---

## Doğrulama durumu — dürüst sınır

`tools/test-bigquery.js` (83 kontrol, `test-all.sh` içinde) şunları doğrular:
şema paritesi (Firestore dokümanı ≡ BigQuery şeması), dört korkuluğun DDL'de
bulunması, bölge AB'de ve Functions ile aynı, satır üretimi (zaman biçimleri,
`serverTimestamp` sentineli, bozuk veri), sorgu denetimi, yazım yolunun olay
akışını bloklamaması.

**Ama:** bu ortamdan gerçek BigQuery'ye erişim yok. Şema, DDL ve satır
üretimi test edildi; **canlı bir `insert` hiç çalıştırılmadı.** İlk gerçek
doğrulama `setupBigQuery` çağrıldıktan sonra, logları ve tabloya düşen ilk
satırları kontrol ederek yapılmalı.
