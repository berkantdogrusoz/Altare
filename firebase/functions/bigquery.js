// =============================================================================
// Altare — BigQuery olay ambari: SEMA, SATIR URETIMI ve MALIYET KORKULUKLARI
//
// BU DOSYA @google-cloud/bigquery'yi ICE AKTARMAZ ve AGA CIKMAZ.
// Tamami saf fonksiyondur, bu yuzden testte kutuphane ya da kimlik
// dogrulama gerekmez. Gercek istemci yalnizca index.js'te, kenarda kullanilir.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEDEN BIGQUERY — ve tasarrufun GERCEKTEN nereden geldigi
//
// Olculen sorun BigQuery'nin hizi degil, Firestore'un OKUMA faturasi:
//   buildSummaryData cagri basina 10.000 dokuman okuyor (EVENT_CAP).
//   aggregateDailyStats  30 dakikada bir -> ayda 1.440 kosu x 1 cagri
//   detectAnomalies      30 dakikada bir -> ayda 1.440 kosu x 2 cagri
//                        (simdiki pencere + BASELINE penceresi)
//   => oyun basina ayda 43,2M okuma TAVANI.
//
// Ve detectAnomalies'in baseline penceresi GECMIS veridir: bir daha asla
// degismez, yine de 30 dakikada bir bastan okunur. Ayni olaylar ayda
// binlerce kez faturalanir.
//
// BigQuery'nin kendisi bu olcekte neredeyse bedavadir (asagidaki maliyet
// notlarina bak). Kazanc, ayni olayi tekrar tekrar OKUMAMAKTAN gelir.
// Bu yuzden Faz 1 (bu dosya) tek basina PARA KAZANDIRMAZ — okuma yollari
// Faz 2'de tasinana kadar yalnizca boru hattini kurar.
// ─────────────────────────────────────────────────────────────────────────────
//
// MALIYET TASARIMI — dort korkuluk, hepsi bilincli:
//
//  1. BOLUMLEME (PARTITION BY event_date)
//     BigQuery TARANAN BAYT uzerinden ucretlendirir. Tarih bolumlemesi
//     olmadan "son 7 gun" sorgusu TUM tabloyu tarar. Bolumlemeyle
//     yalnizca 7 bolum okunur.
//
//  2. KUMELEME (CLUSTER BY game_id, event_name, player_anon_id)
//     Sirasi onemli: BigQuery onekten yararlanir. Her sorgumuz once
//     game_id'ye gore filtreliyor, sonra cogunlukla event_name'e.
//
//  3. require_partition_filter = true
//     Bolum filtresi olmayan sorguyu BigQuery REDDEDER. Bu, "birisi
//     WHERE'siz sorgu yazdi ve butun tabloyu taradi" kazasini MUMKUN
//     OLMAKTAN cikarir. Korkuluklarin en degerlisi budur: digerleri
//     maliyeti azaltir, bu ONLER.
//
//  4. BOLUM OMRU (partition expiration)
//     Depolama sonsuza kadar buyumesin. Kohort/retention analizi icin
//     bir yildan fazlasi gerekmiyor; 400 gun guvenli bir tavan.
//
// AYRICA: asla SELECT * yazma. BigQuery sutunlu bir depodur; yalnizca
// okudugun sutunlar icin odersin. event_params en genis sutun oldugu
// icin ona dokunmayan sorgular cok daha ucuzdur.
// =============================================================================

"use strict";

// Functions europe-west1'de calisiyor (index.js: setGlobalOptions).
// Dataset'i AYNI bolgeye koymak iki sey kazandirir: bolgeler arasi veri
// transferi ucreti olmaz ve yazim gecikmesi dusuk kalir.
// KVKK/GDPR acisindan da veri AB'de kalir.
const DATASET_KONUMU = "europe-west1";
const DATASET_ADI = "altare_analytics";
const TABLO_ADI = "events";

// Bolum omru. 400 gun = bir yil + kohortlarin olgunlasmasi icin pay.
const BOLUM_OMRU_GUN = 400;

/**
 * SEMA — TEK KAYNAK.
 *
 * `firestore` alani, bu sutunun Firestore olay dokumanindaki KARSILIGIDIR.
 * Iki depo ayrisirsa analizler sessizce farkli sonuc verir: Firestore'dan
 * hesaplanan retention ile BigQuery'den hesaplanan retention tutmaz ve
 * hangisinin dogru oldugunu kimse bilemez. tools/test-bigquery.js bu
 * eslesmeyi ingestEvents'in GERCEK yazimina karsi dogrular.
 *
 * null = Firestore'da karsiligi yok, BigQuery icin turetilir.
 */
const SEMA = [
  { ad: "event_date",       tip: "DATE",      firestore: null,
    not: "timestamp'ten turetilir — BOLUM ANAHTARI" },
  { ad: "timestamp",        tip: "TIMESTAMP", firestore: "timestamp" },
  { ad: "client_timestamp", tip: "TIMESTAMP", firestore: "clientTimestamp" },
  { ad: "game_id",          tip: "STRING",    firestore: "gameId" },
  { ad: "game_name",        tip: "STRING",    firestore: "gameName" },
  { ad: "event_name",       tip: "STRING",    firestore: "eventName" },
  { ad: "player_anon_id",   tip: "STRING",    firestore: "playerAnonId" },
  { ad: "session_id",       tip: "STRING",    firestore: "sessionId" },
  { ad: "platform",         tip: "STRING",    firestore: "platform" },
  { ad: "app_version",      tip: "STRING",    firestore: "appVersion" },
  { ad: "device_model",     tip: "STRING",    firestore: "deviceModel" },
  { ad: "gpu_model",        tip: "STRING",    firestore: "gpuModel" },
  { ad: "total_memory_mb",  tip: "INT64",     firestore: "totalMemoryMb" },
  { ad: "event_params",     tip: "JSON",      firestore: "eventParams",
    not: "EN GENIS SUTUN — dokunmayan sorgu cok daha ucuz" },
  { ad: "via",              tip: "STRING",    firestore: "via" },
];

const KUMELEME = ["game_id", "event_name", "player_anon_id"];

/** ISO gun anahtari (UTC). Bolum anahtari bundan uretilir. */
function gunAnahtari(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Milisaniyeye cevirir: Date, Firestore Timestamp, ISO metin ya da sayi. */
function msCevir(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v.toMillis === "function") {
    const m = v.toMillis();
    return Number.isFinite(m) ? m : null;
  }
  if (typeof v._seconds === "number") return v._seconds * 1000;
  if (typeof v === "string") {
    const m = Date.parse(v);
    return Number.isFinite(m) ? m : null;
  }
  return null;
}

/**
 * Firestore olay dokumanindan BigQuery satiri uretir.
 *
 * Girdi, ingestEvents'in Firestore'a YAZDIGI nesnenin AYNISIDIR; boylece
 * iki depo ayni kaynaktan beslenir ve ayrisamaz.
 *
 * @param {object} dok Firestore olay dokumani (serverTimestamp COZULMUS hali)
 * @param {number} [yazimMs] serverTimestamp yerine kullanilacak zaman
 * @returns {object|null} satir, ya da zorunlu alan eksikse null
 */
function satirYap(dok, yazimMs) {
  if (!dok || typeof dok !== "object") return null;

  const tsMs = msCevir(dok.timestamp) ?? (Number.isFinite(yazimMs) ? yazimMs : null);
  // Zamansiz satir BOLUMLENEMEZ. Bolumsuz satir require_partition_filter
  // altinda sorgulanamaz — yani sessizce erisilmez veri olur. Almamak daha iyi.
  if (tsMs == null) return null;

  const gun = gunAnahtari(tsMs);
  if (gun == null) return null;

  const gameId = String(dok.gameId || "").trim();
  const eventName = String(dok.eventName || "").trim();
  if (!gameId || !eventName) return null;

  const bellek = Number(dok.totalMemoryMb);

  return {
    event_date: gun,
    timestamp: new Date(tsMs).toISOString(),
    client_timestamp: (() => {
      const c = msCevir(dok.clientTimestamp);
      return c == null ? null : new Date(c).toISOString();
    })(),
    game_id: gameId,
    game_name: dok.gameName == null ? null : String(dok.gameName),
    event_name: eventName,
    player_anon_id: dok.playerAnonId == null ? null : String(dok.playerAnonId),
    session_id: dok.sessionId == null ? null : String(dok.sessionId),
    platform: dok.platform == null ? null : String(dok.platform),
    app_version: dok.appVersion == null ? null : String(dok.appVersion),
    device_model: dok.deviceModel == null ? null : String(dok.deviceModel),
    gpu_model: dok.gpuModel == null ? null : String(dok.gpuModel),
    total_memory_mb: Number.isFinite(bellek) ? Math.trunc(bellek) : null,
    // JSON sutunu: istemci metin bekliyor, nesne degil.
    event_params: dok.eventParams == null ? null : JSON.stringify(dok.eventParams),
    via: dok.via == null ? null : String(dok.via),
  };
}

/** Tablo DDL'i — dort korkulugun hepsi burada. */
function tabloDDL(projeId) {
  const tam = `\`${projeId}.${DATASET_ADI}.${TABLO_ADI}\``;
  const sutunlar = SEMA.map((s) => `  ${s.ad} ${s.tip}`).join(",\n");
  return [
    `CREATE TABLE IF NOT EXISTS ${tam} (`,
    sutunlar,
    `)`,
    `PARTITION BY event_date`,
    `CLUSTER BY ${KUMELEME.join(", ")}`,
    `OPTIONS (`,
    `  partition_expiration_days = ${BOLUM_OMRU_GUN},`,
    // Korkuluklarin en degerlisi: bolum filtresi olmayan sorguyu REDDEDER.
    `  require_partition_filter = TRUE,`,
    `  description = "Altare olay ambari. Bolum: event_date. Sorgularda ` +
      `event_date filtresi ZORUNLU."`,
    `)`,
  ].join("\n");
}

/**
 * Bir sorgunun korkuluklara uyup uymadigini SORMADAN ONCE denetler.
 *
 * require_partition_filter zaten sunucu tarafinda reddeder, ama hata
 * calisma aninda ve kullanicinin yuzunde patlar. Burada erken yakalanir.
 * SELECT * ayrica reddedilir: sutunlu depoda en pahali sey odur.
 *
 * @returns {string[]} sorun listesi (bos = temiz)
 */
function sorguyuDenetle(sql) {
  const sorunlar = [];
  const s = String(sql || "");
  const duz = s.replace(/\s+/g, " ").toLowerCase();

  if (!duz.includes("event_date")) {
    sorunlar.push(
      "bolum filtresi YOK: sorguda event_date gecmiyor — require_partition_filter " +
      "bunu reddeder ve filtresiz calissa TUM tabloyu tarardi");
  }
  if (/select\s+\*/.test(duz)) {
    sorunlar.push(
      "SELECT * var: sutunlu depoda taranan her sutun icin odenir; " +
      "yalnizca gereken sutunlari sec");
  }
  if (!duz.includes("game_id")) {
    sorunlar.push(
      "game_id filtresi YOK: kumeleme onekten yararlanir, game_id olmadan " +
      "kumeleme kazanci kaybolur");
  }
  return sorunlar;
}

/**
 * SILME SORGUSU — KVKK md. 7 / GDPR md. 17 "unutulma hakki".
 *
 * NEDEN AYRI BIR FONKSIYON: olaylar artik iki depoya birden yaziliyor.
 * Yalnizca Firestore'dan silmek, gizlilik politikasinda verilen sozu
 * TUTMAMAK demektir — oyuncunun butun olay gecmisi BigQuery'de kalir.
 *
 * BOLUM FILTRESI ZORUNLU: tablo require_partition_filter ile kuruldu, yani
 * event_date filtresi olmayan bir DELETE sunucu tarafinda REDDEDILIR. Burada
 * bilincli olarak TUM olasi bolumleri kapsayan bir aralik veriliyor:
 * bolum omru BOLUM_OMRU_GUN oldugundan ondan eski bolum zaten yoktur.
 * Dar bir aralik vermek, silinmesi gereken eski olaylari KACIRIRDI.
 *
 * @param {string} projeId
 * @param {{gameId:string, playerAnonId?:string}} olcut
 * @returns {{query:string, params:object}}
 */
function silmeSorgusu(projeId, olcut) {
  const gameId = olcut && olcut.gameId;
  if (!gameId) throw new Error("silmeSorgusu: gameId zorunlu");

  const tam = `\`${projeId}.${DATASET_ADI}.${TABLO_ADI}\``;
  const params = { gameId };
  const kosullar = [
    // Bolum filtresi — hem zorunlu hem de TUM bolumleri kapsiyor.
    `event_date > DATE_SUB(CURRENT_DATE(), INTERVAL ${BOLUM_OMRU_GUN + 1} DAY)`,
    "game_id = @gameId",
  ];

  // playerAnonId verilmezse OYUNUN TAMAMI silinir (deleteGame yolu).
  // Verilirse yalnizca o oyuncu (deletePlayerData yolu).
  if (olcut.playerAnonId) {
    kosullar.push("player_anon_id = @playerAnonId");
    params.playerAnonId = olcut.playerAnonId;
  }

  return { query: `DELETE FROM ${tam} WHERE ${kosullar.join(" AND ")}`, params };
}

module.exports = {
  DATASET_ADI, TABLO_ADI, DATASET_KONUMU, BOLUM_OMRU_GUN,
  SEMA, KUMELEME,
  gunAnahtari, msCevir, satirYap, tabloDDL, sorguyuDenetle, silmeSorgusu,
};
