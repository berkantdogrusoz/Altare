/**
 * Altare — BigQuery şeması, satır üretimi ve maliyet korkulukları
 *
 *     node tools/test-bigquery.js
 *
 * Ağ, kimlik doğrulama ya da @google-cloud/bigquery GEREKTİRMEZ:
 * firebase/functions/bigquery.js bilinçli olarak saf tutuldu.
 *
 * NEDEN VAR — üç ayrı sessiz hata sınıfı:
 *
 *  1. ŞEMA KAYMASI (en tehlikelisi)
 *     Olay dokümanı Firestore'da ve BigQuery'de AYNI alanları taşımak
 *     zorunda. Biri değişip öbürü unutulursa iki depodan hesaplanan aynı
 *     metrik FARKLI çıkar — retention Firestore'da %32, BigQuery'de %29 —
 *     ve hangisinin doğru olduğunu kimse bilemez. Hiçbir hata mesajı
 *     çıkmaz; sadece sayılar tutmaz.
 *
 *  2. MALİYET KORKULUĞUNUN SESSİZCE DÜŞMESİ
 *     Bölümleme, kümeleme, require_partition_filter ve bölüm ömrü DDL'de
 *     birer satır. Biri silinirse tablo yine ÇALIŞIR — sadece faturası
 *     katlanır. Test etmezsek fark etmenin tek yolu fatura olur.
 *
 *  3. BÖLÜMLENEMEZ SATIR
 *     Zamanı olmayan satır bölümlenemez; require_partition_filter altında
 *     da sorgulanamaz. Yani yazılır ama BİR DAHA ERİŞİLEMEZ. Sessiz veri
 *     kaybının en sinsi hâli — satır orada, kimse göremiyor.
 */

const path = require("path");
const fs = require("fs");

const KOK = path.join(__dirname, "..");
const BQ = require(path.join(KOK, "firebase", "functions", "bigquery.js"));
const kaynak = fs.readFileSync(
  path.join(KOK, "firebase", "functions", "index.js"), "utf8");

let g = 0, k = 0; const hatalar = [];
const ok = (ad, c, d) => { if (c) g++; else { k++; hatalar.push(ad + (d ? " → " + d : "")); } };
const baslik = (s) => console.log("\n\x1b[1m" + s + "\x1b[0m");

// ═══════════════════════════════════════════════════════════════════════════
baslik("1. ⚠ ŞEMA PARİTESİ — Firestore dokümanı ≡ BigQuery şeması");
// ═══════════════════════════════════════════════════════════════════════════

// ingestEvents'in Firestore'a YAZDIĞI nesnenin alanlarını kaynaktan çıkar.
const dokBlok = (() => {
  const b = kaynak.indexOf("const dok = {");
  if (b < 0) throw new Error(
    "index.js icinde 'const dok = {' bulunamadi — ingestEvents yeniden " +
    "yazildiysa bu testi guncelle. Sessizce gecmesine IZIN VERME.");
  const e = kaynak.indexOf("\n        };", b);
  return kaynak.slice(b, e);
})();
const firestoreAlanlari = new Set(
  [...dokBlok.matchAll(/^\s{10}([A-Za-z_][A-Za-z0-9_]*)\s*[,:]/gm)].map((m) => m[1]));

ok("Firestore dokuman alanlari cikarildi", firestoreAlanlari.size >= 10,
   `bulunan: ${firestoreAlanlari.size}`);

// Her BigQuery sütunu ya bir Firestore alanına bağlı, ya da türetilmiş.
for (const s of BQ.SEMA) {
  if (s.firestore === null) continue;
  ok(`'${s.ad}' <- Firestore.${s.firestore}`, firestoreAlanlari.has(s.firestore),
     "BigQuery bu alani bekliyor ama ingestEvents artik yazmiyor");
}

// Ve tersi: Firestore'a yazılan hiçbir alan sessizce düşmemeli.
const semadaki = new Set(BQ.SEMA.map((s) => s.firestore).filter(Boolean));
for (const alan of firestoreAlanlari) {
  ok(`Firestore.${alan} BigQuery semasinda karsiligi var`, semadaki.has(alan),
     "Firestore'a yaziliyor ama BigQuery'ye GITMIYOR — ambar eksik veri tutar");
}

ok("sema bos degil", BQ.SEMA.length > 5);
ok("her sutunun adi ve tipi var", BQ.SEMA.every((s) => s.ad && s.tip));
ok("sutun adlari benzersiz",
   new Set(BQ.SEMA.map((s) => s.ad)).size === BQ.SEMA.length);

// ═══════════════════════════════════════════════════════════════════════════
baslik("2. ⚠ MALİYET KORKULUKLARI — DDL");
// ═══════════════════════════════════════════════════════════════════════════

const ddl = BQ.tabloDDL("test-proje");

ok("BÖLÜMLEME var (event_date)", /PARTITION BY event_date/.test(ddl),
   "bolumleme olmadan 'son 7 gun' sorgusu TUM tabloyu tarar");
ok("KÜMELEME var", /CLUSTER BY /.test(ddl));
ok("kumeleme game_id ile BASLIYOR", /CLUSTER BY game_id\b/.test(ddl),
   "BigQuery onekten yararlanir; her sorgumuz once game_id'ye gore filtreliyor");
ok("require_partition_filter = TRUE", /require_partition_filter\s*=\s*TRUE/i.test(ddl),
   "bu olmadan filtresiz sorgu TUM tabloyu tarar ve fatura patlar");
ok("bolum omru ayarli", /partition_expiration_days\s*=\s*\d+/.test(ddl),
   "yoksa depolama sonsuza kadar buyur");
ok("bolum omru makul (90-1000 gun)",
   BQ.BOLUM_OMRU_GUN >= 90 && BQ.BOLUM_OMRU_GUN <= 1000, String(BQ.BOLUM_OMRU_GUN));
ok("DDL tum sutunlari iceriyor", BQ.SEMA.every((s) => ddl.includes(s.ad + " " + s.tip)));
ok("IF NOT EXISTS — tekrar calistirilabilir", /CREATE TABLE IF NOT EXISTS/.test(ddl));

// KVKK: veri AB'de kalmali. Dataset konumu SONRADAN DEGISTIRILEMEZ.
ok("dataset konumu AB", /^europe-/.test(BQ.DATASET_KONUMU), BQ.DATASET_KONUMU);
// Functions europe-west1'de; ayni bolge = bolgeler arasi transfer ucreti yok.
const fnBolge = (kaynak.match(/setGlobalOptions\(\{\s*region:\s*"([^"]+)"/) || [])[1];
ok("dataset, Functions ile AYNI bolgede", fnBolge === BQ.DATASET_KONUMU,
   `functions=${fnBolge} dataset=${BQ.DATASET_KONUMU} — farkliysa transfer ucreti doger`);

// ═══════════════════════════════════════════════════════════════════════════
baslik("3. SATIR ÜRETİMİ");
// ═══════════════════════════════════════════════════════════════════════════

const TS = Date.UTC(2026, 8, 14, 10, 30, 0);
const tamDok = {
  gameId: "chophero", gameName: "ChopHero", playerAnonId: "p-1", sessionId: "s-1",
  eventName: "level_start", eventParams: { level: 3, mode: "normal" },
  timestamp: { toMillis: () => TS }, clientTimestamp: { toMillis: () => TS - 1000 },
  platform: "Android", appVersion: "1.2.0", deviceModel: "SM-S908E",
  gpuModel: "Adreno 730", totalMemoryMb: 8192, via: "http",
};

const satir = BQ.satirYap(tamDok);
ok("satir uretildi", !!satir);
ok("bolum anahtari dogru", satir.event_date === "2026-09-14", satir && satir.event_date);
ok("timestamp ISO", satir.timestamp === new Date(TS).toISOString());
ok("client_timestamp ISO", satir.client_timestamp === new Date(TS - 1000).toISOString());
ok("game_id", satir.game_id === "chophero");
ok("event_name", satir.event_name === "level_start");
ok("total_memory_mb sayi", satir.total_memory_mb === 8192);
ok("event_params METIN (JSON sutunu metin bekler)", typeof satir.event_params === "string");
ok("event_params cozulebilir", JSON.parse(satir.event_params).level === 3);
ok("satir tam olarak sema sutunlarini tasiyor",
   JSON.stringify(Object.keys(satir).sort()) ===
   JSON.stringify(BQ.SEMA.map((s) => s.ad).sort()));

// serverTimestamp sentineli: Firestore'a yazilirken HENUZ COZULMEMIS olur.
// Bu durumda yazim zamanina dusulmeli, satir DUSURULMEMELI.
const sentinel = { ...tamDok, timestamp: { _methodName: "serverTimestamp" } };
const s2 = BQ.satirYap(sentinel, TS);
ok("serverTimestamp sentineli -> yazim zamanina duser", !!s2 && s2.event_date === "2026-09-14");
ok("sentinel + yazim zamani YOK -> satir DUSURULUR",
   BQ.satirYap({ ...sentinel }, undefined) === null,
   "zamansiz satir bolumlenemez ve bir daha ERISILEMEZ — almamak dogru");

// Bölümlenemez/anlamsız satırlar reddedilmeli
for (const [ad, d] of [
  ["null", null],
  ["metin", "olay"],
  ["gameId yok", { ...tamDok, gameId: "" }],
  ["eventName yok", { ...tamDok, eventName: "" }],
  ["timestamp bozuk", { ...tamDok, timestamp: "ne-zaman" }],
]) {
  ok(`reddedilir: ${ad}`, BQ.satirYap(d) === null);
}

// Eksik istege bagli alanlar satiri DUSURMEMELI, null olmali
const az = BQ.satirYap({ gameId: "g", eventName: "e", timestamp: { toMillis: () => TS } });
ok("az alanli dokuman kabul edilir", !!az);
ok("eksik alanlar null", az.gpu_model === null && az.session_id === null);
ok("eksik eventParams null", az.event_params === null);

// Farkli zaman bicimleri
ok("Date kabul", BQ.satirYap({ ...tamDok, timestamp: new Date(TS) }).event_date === "2026-09-14");
ok("ISO metin kabul", BQ.satirYap({ ...tamDok, timestamp: new Date(TS).toISOString() }).event_date === "2026-09-14");
ok("ms sayi kabul", BQ.satirYap({ ...tamDok, timestamp: TS }).event_date === "2026-09-14");
ok("_seconds kabul", BQ.satirYap({ ...tamDok, timestamp: { _seconds: TS / 1000 } }).event_date === "2026-09-14");

// Gun siniri UTC'ye gore
ok("gun siniri UTC", BQ.gunAnahtari(Date.UTC(2026, 8, 14, 23, 59, 59)) === "2026-09-14");
ok("gun siniri ertesi", BQ.gunAnahtari(Date.UTC(2026, 8, 15, 0, 0, 0)) === "2026-09-15");
ok("gecersiz zaman -> null", BQ.gunAnahtari(NaN) === null);

// ═══════════════════════════════════════════════════════════════════════════
baslik("4. SORGU DENETİMİ — pahalı sorguyu SORMADAN ÖNCE yakala");
// ═══════════════════════════════════════════════════════════════════════════

const temiz = "SELECT player_anon_id FROM t WHERE event_date >= '2026-01-01' AND game_id = 'x'";
ok("temiz sorgu gecer", BQ.sorguyuDenetle(temiz).length === 0,
   JSON.stringify(BQ.sorguyuDenetle(temiz)));

const bolumsuz = "SELECT player_anon_id FROM t WHERE game_id = 'x'";
ok("bolum filtresi yoksa yakalanir",
   BQ.sorguyuDenetle(bolumsuz).some((x) => /bolum filtresi/i.test(x)));

const yildiz = "SELECT * FROM t WHERE event_date >= '2026-01-01' AND game_id = 'x'";
ok("SELECT * yakalanir", BQ.sorguyuDenetle(yildiz).some((x) => /SELECT \*/i.test(x)));

const oyunsuz = "SELECT player_anon_id FROM t WHERE event_date >= '2026-01-01'";
ok("game_id filtresi yoksa yakalanir",
   BQ.sorguyuDenetle(oyunsuz).some((x) => /game_id/i.test(x)));

ok("bos sorgu -> sorun listelenir", BQ.sorguyuDenetle("").length > 0);
ok("null sorgu cokmez", Array.isArray(BQ.sorguyuDenetle(null)));

// ═══════════════════════════════════════════════════════════════════════════
baslik("5. YAZIM YOLU — olay akışını asla bloklamamalı");
// ═══════════════════════════════════════════════════════════════════════════

const bqBlok = kaynak.slice(kaynak.indexOf("async function bigQueryYaz"),
                            kaynak.indexOf("exports.setupBigQuery"));
ok("bigQueryYaz try/catch ile sarili", /try\s*\{/.test(bqBlok) && /catch/.test(bqBlok),
   "BigQuery duserse oyunun telemetrisi DURMAMALI");
ok("tablo yoksa NE YAPILACAGINI soyler", /setupBigQuery/.test(bqBlok),
   "yoksa bu log 'bir sey olmadi' diye gecistirilir");
ok("bayrakla kapatilabilir", /ALTARE_BQ_ENABLED/.test(kaynak));
// Tembel yukleme: agir paket MODUL TEPESINDE require edilirse her soguk
// baslangic bedel oder — BigQuery'ye hic yazmayan cagrilar bile.
// Dogru kontrol "bir yerde require var mi" degil, "modul TEPESINDE degil mi".
const bqRequireSatirlari = kaynak.split("\n")
  .map((satir, i) => ({ satir, i }))
  .filter(({ satir }) => satir.includes('require("@google-cloud/bigquery")'));
ok("@google-cloud/bigquery require ediliyor", bqRequireSatirlari.length > 0);
ok("require'lar fonksiyon ICINDE (modul tepesinde degil)",
   bqRequireSatirlari.every(({ satir }) => /^\s+/.test(satir)),
   "girintisiz require = modul seviyesi = her soguk baslangicta yuklenir");
ok("BigQuery yazimi batch.commit()'TEN SONRA",
   kaynak.indexOf("await batch.commit()") < kaynak.indexOf("await bigQueryYaz("),
   "Firestore birincil depo — once oranin garanti olmasi gerekir");
ok("@google-cloud/bigquery package.json'da",
   fs.readFileSync(path.join(KOK, "firebase", "functions", "package.json"), "utf8")
     .includes("@google-cloud/bigquery"));
ok("bigquery.js istemciyi ICE AKTARMAZ (saf kalmali)",
   !fs.readFileSync(path.join(KOK, "firebase", "functions", "bigquery.js"), "utf8")
      .includes('require("@google-cloud/bigquery")'),
   "saf kalmazsa bu test kutuphane ve kimlik dogrulama ister");

console.log("\n" + "=".repeat(60));
if (k === 0) console.log(`✅  BIGQUERY TESTLERI GECTI — ${g} kontrol`);
else { console.log(`❌  ${k} BASARISIZ / ${g + k}\n`); hatalar.forEach((x) => console.log("   ✗ " + x)); }
console.log("=".repeat(60));
process.exit(k === 0 ? 0 : 1);
