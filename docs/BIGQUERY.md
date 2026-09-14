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

Deploy sonrası panelden/CLI'dan **bir kez** çağır (admin gerekir):

```
setupBigQuery()
```

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

**Faz 2'den bağımsız, çok daha ucuz bir hızlı kazanç var:** `detectAnomalies`
baseline penceresini önbelleğe al ya da rollup'tan oku. Geçmiş veri
değişmiyor; 30 dakikada bir yeniden okumanın hiçbir karşılığı yok. Tek başına
bu, yukarıdaki $17,3/oyun/ay kaleminin büyük kısmını siler.

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
