// =============================================================================
// Altare Sentinel — BASELINE KURULUMU ve PENCERE GUVENLIGI
//
// Bu dosya Firebase'i ICE AKTARMAZ ve aga cikmaz: tamami saf fonksiyon.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEDEN YAZILDI — BIRBIRINI MASKELEYEN IKI HATA
//
// detectAnomalies "son 2 saat"i "son 7 gun"le karsilastiriyordu. Baseline
// buildSummaryData(gameId, now - 7 gun) ile aliniyordu, ama o sorgu soyle:
//
//     .where("timestamp", ">=", since).orderBy("timestamp", "desc").limit(10000)
//
// Yani 7 gunun EN YENI 10.000 event'i. Gunde 150k event ureten bir oyunda
// bu ~1,6 SAAT eder. "7 gunluk baseline" aslinda son 1,6 saatti.
//
//   HATA 1 (sessiz): baseline gercekte baseline degildi. Simdiki pencere
//           (2sa) ile neredeyse ayni araligi olcuyordu, yani Sentinel
//           "kendini kendisiyle" karsilastiriyordu. Hicbir hata mesaji yok.
//
//   HATA 2 (gizli): dau_drop kurali HAM SAYI karsilastiriyor —
//           (baseline.uniquePlayers - now.uniquePlayers) / baseline.uniquePlayers
//           2 saatlik tekil oyuncu ile 7 gunluk tekil oyuncu ayni buyukluk
//           mertebesinde DEGILDIR. Gercek bir 7 gunluk baseline'da bu kural
//           neredeyse HER KOSUDA tetiklenirdi.
//
// IKISI BIRBIRINI MASKELIYORDU: baseline kirpildigi icin now ≈ baseline
// oluyor ve dau_drop susuyordu. YALNIZCA baseline'i duzeltmek, gizli olan
// ikinci hatayi ortaya cikarip yanlis alarm seline yol acardi. Bu yuzden
// ikisi birlikte cozuldu.
//
// ─────────────────────────────────────────────────────────────────────────────
// COZUM: baseline ham event yerine GUNLUK OZET dokumanlarindan kurulur.
//
// aggregateDailyStats zaten games/{gameId}/stats/{YYYY-MM-DD} altina tam
// ozeti yaziyor. Baseline'i oradan kurmak:
//   • ~6 DOKUMAN okur, 10.000 degil  (~%99,9 daha az okuma)
//   • GERCEK bir cok gunluk baseline verir, son 1,6 saati degil
//   • ekstra hicbir sey yazmaz — veri zaten uretiliyordu
// =============================================================================

"use strict";

/**
 * PENCERE GUVENLIGI KAYDI — her kural icin "pencere boyu degisirse bozulur mu".
 *
 * ORAN / ORTALAMA kurallari guvenlidir: crashes/uniqueSessions gibi bir oran,
 * 2 saatte de 7 gunde de ayni anlama gelir.
 *
 * HAM SAYI kurallari guvenli DEGILDIR: 2 saatteki 40 oyuncu ile 7 gundeki
 * 4000 oyuncu karsilastirilamaz. Bunlarin AYNI UZUNLUKTA iki pencereyi
 * karsilastirmasi gerekir.
 *
 * Bu kayit sussa da fark edilmeyecek bir hatayi gorunur kilar: yeni bir kural
 * ham sayi karsilastirmasiyla eklenirse tools/test-sentinel.js KIRILIR ve
 * yazan kisi "bu kural hangi pencereyi olcuyor" sorusunu cevaplamak zorunda
 * kalir.
 */
const PENCERE_GUVENLIGI = {
  crash_spike:          { tur: "oran",     gerekce: "crashes / uniqueSessions" },
  fps_degradation:      { tur: "oran",     gerekce: "fpsWarnings / uniqueSessions" },
  anr_spike:            { tur: "oran",     gerekce: "anrs / uniqueSessions" },
  memory_pressure:      { tur: "oran",     gerekce: "memoryWarnings / uniqueSessions" },
  session_length_drop:  { tur: "ortalama", gerekce: "avgSessionSeconds — zaten ortalama" },
  whale_detected:       { tur: "yalnizca-simdi", gerekce: "baseline'a hic bakmaz" },
  gpu_family_crash:     { tur: "yalnizca-simdi", gerekce: "now.gpuBreakdown icinde oran" },
  first_revenue:        { tur: "gunluk",   gerekce: "baseline'da HIC gelir yok mu — " +
                                                    "pencere ne kadar UZUNSA o kadar dogru" },
  // Tek ham-sayi kurali. GUNLUK pencereye baglandi: bugunun DAU'su (24sa)
  // onceki gunlerin GUNLUK ORTALAMASI ile karsilastirilir. Ikisi de 24 saat.
  dau_drop:             { tur: "gunluk",   gerekce: "bugunun DAU'su vs gunluk ortalama — " +
                                                    "iki taraf da 24 saat" },
};

/** Sayiya cevirir; sayi degilse 0. */
function sayi(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Gunluk ozet dokumanlarindan baseline kurar.
 *
 * @param {object[]} gunler aggregateDailyStats'in yazdigi gunluk ozetler
 * @returns {object|null} baseline ozeti, ya da kullanilabilir gun yoksa null
 */
function baselineKur(gunler) {
  const liste = (Array.isArray(gunler) ? gunler : []).filter(
    (g) => g && typeof g === "object");
  if (liste.length === 0) return null;

  const topla = (alan) => liste.reduce((t, g) => t + sayi(g[alan]), 0);

  // SAYILABILIR alanlar toplanir. Oran kurallari bunlari uniqueSessions
  // toplamina boler, dolayisiyla cok gunluk oran DOGRU cikar.
  const uniqueSessions = topla("uniqueSessions");
  const totalEvents = topla("totalEvents");

  // uniquePlayers TOPLANAMAZ: ayni oyuncu birden cok gun gorunur, toplam
  // gercek tekil sayisini asar. Dogru olcut GUNLUK ORTALAMA — "tipik bir
  // gunde kac oyuncu" sorusunun cevabi ve dau_drop'un ihtiyaci olan sey.
  const gunlukOrtalamaOyuncu = topla("uniquePlayers") / liste.length;

  // avgSessionSeconds oturum sayisina gore AGIRLIKLI ortalanir; duz ortalama
  // 10 oturumluk sakin bir gunu 10.000 oturumluk gunle esit sayardi.
  const agirlikliSure = liste.reduce(
    (t, g) => t + sayi(g.avgSessionSeconds) * sayi(g.uniqueSessions), 0);
  const avgSessionSeconds = uniqueSessions > 0
    ? agirlikliSure / uniqueSessions
    : (liste.reduce((t, g) => t + sayi(g.avgSessionSeconds), 0) / liste.length);

  return {
    // Kurallarin bekledigi alan adlari birebir korunur.
    totalEvents,
    uniqueSessions,
    uniquePlayers: Math.round(gunlukOrtalamaOyuncu),
    crashes: topla("crashes"),
    anrs: topla("anrs"),
    fpsWarnings: topla("fpsWarnings"),
    memoryWarnings: topla("memoryWarnings"),
    purchases: topla("purchases"),
    purchaseRevenueUsd: Math.round(topla("purchaseRevenueUsd") * 100) / 100,
    avgSessionSeconds: Math.round(avgSessionSeconds),
    // Kaynagi ve kapsami acikca tasi: uyari metninde ve loglarda kullanilir,
    // ayrica "baseline neydi" sorusu sonradan cevaplanabilir olur.
    _kaynak: "gunluk_ozet",
    _gunSayisi: liste.length,
    _gunlukOrtalamaOyuncu: Math.round(gunlukOrtalamaOyuncu),
  };
}

/**
 * Baseline guvenilir mi? Az veriyle alarm uretmek, alarm uretmemekten kotudur:
 * musteri bir kez bos yere korkutulunca sonrakine de inanmaz.
 */
function baselineYeterliMi(baseline, enAzGun = 2) {
  if (!baseline) return false;
  if (sayi(baseline._gunSayisi) < enAzGun) return false;
  // Hic oturum yoksa her oran 0'a bolunur ve anlamsiz sonuc uretir.
  if (sayi(baseline.uniqueSessions) <= 0) return false;
  return true;
}

module.exports = { PENCERE_GUVENLIGI, baselineKur, baselineYeterliMi };
