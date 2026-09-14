/**
 * Altare Sentinel — baseline kurulumu ve pencere güvenliği
 *
 *     node tools/test-sentinel.js
 *
 * Ağ, Firebase ya da emülatör gerektirmez.
 *
 * NEDEN VAR — burada tam olarak şu oldu:
 *
 * detectAnomalies "son 2 saat"i "son 7 gün"le karşılaştırdığını sanıyordu.
 * Baseline sorgusu `orderBy timestamp desc limit 10000` olduğu için aslında
 * 7 günün EN YENİ 10.000 event'ini alıyordu — trafikli bir oyunda ~1,6 saat.
 * Sentinel kendini kendisiyle karşılaştırıyordu ve hiçbir hata mesajı yoktu.
 *
 * Bu ilk hata, İKİNCİ bir hatayı da gizliyordu: `dau_drop` kuralı HAM SAYI
 * karşılaştırıyor. 2 saatlik tekil oyuncu ile 7 günlük tekil oyuncu aynı
 * büyüklük mertebesinde değildir; gerçek bir 7 günlük baseline'da bu kural
 * neredeyse her koşuda tetiklenirdi. Yani YALNIZCA baseline'ı düzeltmek
 * yanlış alarm seline yol açardı.
 *
 * Bu testin asıl işi o tuzağı kalıcı olarak kapatmak:
 *   • her kural pencere güvenliği açısından SINIFLANDIRILMIŞ olmalı
 *   • yeni bir ham-sayı kuralı eklenirse test KIRILIR ve yazan kişi
 *     "bu kural hangi pencereyi ölçüyor" sorusunu cevaplamak zorunda kalır
 */

const path = require("path");
const fs = require("fs");

const KOK = path.join(__dirname, "..");
const S = require(path.join(KOK, "firebase", "functions", "sentinel.js"));
const kaynak = fs.readFileSync(
  path.join(KOK, "firebase", "functions", "index.js"), "utf8");

let g = 0, k = 0; const hatalar = [];
const ok = (ad, c, d) => { if (c) g++; else { k++; hatalar.push(ad + (d ? " → " + d : "")); } };
const baslik = (s) => console.log("\n\x1b[1m" + s + "\x1b[0m");

// ═══════════════════════════════════════════════════════════════════════════
baslik("1. ⚠ PENCERE GÜVENLİĞİ — her kural sınıflandırılmış mı?");
// ═══════════════════════════════════════════════════════════════════════════

const kuralIdleri = (() => {
  const b = kaynak.indexOf("const ANOMALY_RULES = [");
  if (b < 0) throw new Error("ANOMALY_RULES bulunamadi — yeniden adlandirildiysa bu testi guncelle");
  const e = kaynak.indexOf("\n];", b);
  return [...kaynak.slice(b, e).matchAll(/^\s{4}id:\s*"([a-z0-9_]+)"/gm)].map((m) => m[1]);
})();

ok("kurallar bulundu", kuralIdleri.length >= 5, String(kuralIdleri.length));

// ⚠ ASIL KORUMA: sınıflandırılmamış kural = pencere tuzağının geri dönüşü.
for (const id of kuralIdleri) {
  ok(`'${id}' pencere guvenligi kaydinda`, !!S.PENCERE_GUVENLIGI[id],
     "sentinel.js PENCERE_GUVENLIGI'ne ekle — bu kural ham sayi mi karsilastiriyor, " +
     "oran mi? Cevaplanmazsa 2 saat ile 7 gun karsilastirilir ve kural surekli teter");
}
for (const id of Object.keys(S.PENCERE_GUVENLIGI)) {
  ok(`'${id}' hala var olan bir kural`, kuralIdleri.includes(id),
     "kayitta var ama ANOMALY_RULES'ta yok — olu kayit");
}

const gecerliTurler = ["oran", "ortalama", "yalnizca-simdi", "gunluk"];
for (const [id, d] of Object.entries(S.PENCERE_GUVENLIGI)) {
  ok(`'${id}' turu gecerli`, gecerliTurler.includes(d.tur), d.tur);
  ok(`'${id}' gerekce yazilmis`, !!d.gerekce && d.gerekce.length > 10);
}

// "gunluk" turdeki kurallar ctx'i KULLANMAK ZORUNDA — yoksa yine yanlis
// pencereyle karsilastiriyorlardir.
const kuralBlok = kaynak.slice(kaynak.indexOf("const ANOMALY_RULES = ["),
                               kaynak.indexOf("\n];", kaynak.indexOf("const ANOMALY_RULES = [")));
const dauBlok = kuralBlok.slice(kuralBlok.indexOf('id: "dau_drop"'),
                                kuralBlok.indexOf('id: "dau_drop"') + 1600);
ok("dau_drop ctx.bugun kullaniyor (24sa vs 24sa)", /ctx\s*&&\s*ctx\.bugun|ctx\.bugun/.test(dauBlok),
   "ham sayi karsilastiran tek kural; ctx olmadan yine 2sa'i 7 gunle karsilastirir");
ok("dau_drop artik now.uniquePlayers'a BAKMIYOR", !/now\.uniquePlayers/.test(dauBlok),
   "now 2 saatlik pencere — gunluk ortalamayla karsilastirilamaz");
ok("detectAnomalies kurallara ctx geciriyor",
   /rule\.check\(nowStats,\s*baselineStats,\s*kuralCtx\)/.test(kaynak));

// ═══════════════════════════════════════════════════════════════════════════
baslik("2. BASELINE KURULUMU");
// ═══════════════════════════════════════════════════════════════════════════

const GUNLER = [
  { gun: "2026-09-10", uniquePlayers: 100, uniqueSessions: 300, crashes: 3, anrs: 1,
    fpsWarnings: 10, memoryWarnings: 2, purchases: 4, purchaseRevenueUsd: 12.5,
    avgSessionSeconds: 200, totalEvents: 9000 },
  { gun: "2026-09-11", uniquePlayers: 120, uniqueSessions: 400, crashes: 4, anrs: 0,
    fpsWarnings: 12, memoryWarnings: 1, purchases: 6, purchaseRevenueUsd: 20,
    avgSessionSeconds: 180, totalEvents: 11000 },
  { gun: "2026-09-12", uniquePlayers: 110, uniqueSessions: 300, crashes: 2, anrs: 2,
    fpsWarnings: 8, memoryWarnings: 0, purchases: 5, purchaseRevenueUsd: 15,
    avgSessionSeconds: 190, totalEvents: 10000 },
];
const b = S.baselineKur(GUNLER);

ok("sayilabilir alanlar TOPLANIR", b.crashes === 9 && b.uniqueSessions === 1000);
ok("totalEvents toplanir", b.totalEvents === 30000);
ok("gelir toplanir", b.purchaseRevenueUsd === 47.5, String(b.purchaseRevenueUsd));

// uniquePlayers TOPLANAMAZ: ayni oyuncu birden cok gun gorunur.
ok("uniquePlayers TOPLANMAZ, gunluk ORTALAMA alinir", b.uniquePlayers === 110,
   `${b.uniquePlayers} (toplam 330 olsaydi HATALI olurdu)`);
ok("gunluk ortalama ayrica tasinir", b._gunlukOrtalamaOyuncu === 110);

// Agirlikli ortalama: (200*300 + 180*400 + 190*300) / 1000 = 189
ok("avgSessionSeconds oturum sayisina gore AGIRLIKLI", b.avgSessionSeconds === 189,
   `${b.avgSessionSeconds} — duz ortalama 190 olurdu (yanlis)`);

ok("kaynak isaretli", b._kaynak === "gunluk_ozet");
ok("gun sayisi tasiniyor", b._gunSayisi === 3);

// Oran kurallari dogru calismali: 9/1000 = %0,9
ok("cok gunluk crash orani dogru", Math.abs(b.crashes / b.uniqueSessions - 0.009) < 1e-9);

// Bozuk / eksik veri
ok("bos liste -> null", S.baselineKur([]) === null);
ok("null -> null", S.baselineKur(null) === null);
ok("dizi olmayan -> null", S.baselineKur("gun") === null);
ok("icinde null olan liste cokmez", !!S.baselineKur([null, GUNLER[0], undefined]));
ok("eksik alanlar 0 sayilir", S.baselineKur([{ uniqueSessions: 10 }]).crashes === 0);
ok("metin alanlar cokmez",
   S.baselineKur([{ uniquePlayers: "yuz", uniqueSessions: 10 }]).uniquePlayers === 0);
ok("oturum yoksa avgSession duz ortalama",
   S.baselineKur([{ avgSessionSeconds: 100 }, { avgSessionSeconds: 200 }]).avgSessionSeconds === 150);

// ═══════════════════════════════════════════════════════════════════════════
baslik("3. YETERLİLİK — az veriyle alarm üretme");
// ═══════════════════════════════════════════════════════════════════════════

ok("3 gun yeterli", S.baselineYeterliMi(b));
ok("1 gun YETERSIZ", !S.baselineYeterliMi(S.baselineKur([GUNLER[0]])));
ok("null YETERSIZ", !S.baselineYeterliMi(null));
ok("oturum yoksa YETERSIZ",
   !S.baselineYeterliMi(S.baselineKur([{ uniquePlayers: 5 }, { uniquePlayers: 6 }])),
   "her oran 0'a bolunur ve anlamsiz sonuc uretir");
ok("esik ayarlanabilir", S.baselineYeterliMi(S.baselineKur([GUNLER[0]]), 1));

// ═══════════════════════════════════════════════════════════════════════════
baslik("4. detectAnomalies BAĞLANTISI");
// ═══════════════════════════════════════════════════════════════════════════

// Gercek govde siniri: bir sonraki top-level exports'a kadar.
const dtBlok = (() => {
  const b = kaynak.indexOf("exports.detectAnomalies");
  const m = /^exports\.[A-Za-z0-9_]+\s*=/m.exec(kaynak.slice(b + 10));
  return m ? kaynak.slice(b, b + 10 + m.index) : kaynak.slice(b);
})();
// Yorumlari at: aciklama metni "buildSummaryData"dan bahsedince sayim sisiyor.
const dtKod = dtBlok.replace(/\/\/[^\n]*/g, "");

ok("baseline artik buildSummaryData'dan GELMIYOR",
   (dtKod.match(/buildSummaryData\(/g) || []).length === 1,
   `${(dtKod.match(/buildSummaryData\(/g) || []).length} cagri var — ikisi kaldiysa ` +
   "pahali baseline okumasi duruyor demektir");
ok("gunluk ozetlerden kuruluyor", /SENTINEL\.baselineKur\(/.test(dtBlok));
ok("yeterlilik kontrol ediliyor", /baselineYeterliMi\(/.test(dtBlok));
ok("BUGUN baseline'a KATILMIYOR", /g\.gun\s*!==\s*bugunKey/.test(dtBlok),
   "bugun simdiki pencereyle ortusur, anomaliyi kendi baseline'ina karistirir");
ok("dokuman kimligine gore siralaniyor", /FieldPath\.documentId\(\)/.test(dtBlok),
   "YYYY-MM-DD kimlikte sozluk sirasi = tarih sirasi; updatedAt eksik olabilir");
ok("baseline gun sayisi sabiti var", /SENTINEL_BASELINE_GUN/.test(kaynak));
ok("buildSummaryData truncated DONDURUYOR",
   /return \{\s*(?:\/\/[^\n]*\n\s*)*truncated,/.test(kaynak),
   "eskiden yalnizca loglaniyordu; cagiran kirpilmayi ogrenemiyordu");
ok("sentinel.js Firebase ICE AKTARMAZ (saf kalmali)",
   !fs.readFileSync(path.join(KOK, "firebase", "functions", "sentinel.js"), "utf8")
      .includes('require("firebase'));

// ═══════════════════════════════════════════════════════════════════════════
baslik("5. ⚠ ZAMANLANMIŞ İŞ SIKLIĞI — doğrudan fatura kalemi");
// ═══════════════════════════════════════════════════════════════════════════
// Her buildSummaryData çağrısı 10.000 doküman okuyor. Sıklık sessizce
// artırılırsa maliyet de aynı oranda artar ve hiçbir test kırılmaz —
// fark etmenin tek yolu fatura olur. Bu yüzden sıklıklar burada sabitli.

/** Bir onSchedule dışa aktarımının schedule metnini al. */
function zamanlama(ad) {
  const b = kaynak.indexOf(`exports.${ad} = onSchedule`);
  if (b < 0) return null;
  const m = /schedule:\s*"([^"]+)"/.exec(kaynak.slice(b, b + 400));
  return m ? m[1] : null;
}

const DK = { "every 30 minutes": 30, "every 60 minutes": 60, "every 1 hours": 60,
             "every 6 hours": 360 };
const beklenen = {
  // 10.000 okuma/koşu — saatlik. 30 dakikaya düşürülürse maliyet İKİYE KATLANIR.
  aggregateDailyStats: 60,
  // Ani sıçrama dedektörü: kısa pencere gerekiyor, 30 dakika bilinçli.
  // Artık koşu başına 1 buildSummaryData + ~8 doküman okuyor (eskiden 2 × 10.000).
  detectAnomalies: 30,
};

for (const [ad, dk] of Object.entries(beklenen)) {
  const z = zamanlama(ad);
  ok(`${ad} zamanlamasi bulundu`, !!z, "onSchedule bulunamadi");
  ok(`${ad} = ${dk} dakikada bir`, z && DK[z] === dk,
     `${z} bulundu — degistirildiyse maliyet etkisini hesapla ve bu testi guncelle`);
}

// aggregateDailyStats, detectAnomalies'ten SEYREK olmali degil: baseline
// gunluk ozetlerden kuruldugu icin ozetler yeterince sik yazilmali.
ok("gunluk ozet, anomali kosusundan cok seyrek degil",
   DK[zamanlama("aggregateDailyStats")] <= 4 * DK[zamanlama("detectAnomalies")],
   "ozetler cok seyrek yazilirsa baseline bayatlar");

// ═══════════════════════════════════════════════════════════════════════════
baslik("6. DÜRÜSTLÜK — yavaşlayan tazelik GÖRÜNÜR mü?");
// ═══════════════════════════════════════════════════════════════════════════
// Toplamalar saatlik yazilirken baslikta yalnizca canli saat gostermek,
// sayilarin o dakikaya ait oldugunu ima eder. Yanlis izlenim, eksik
// bilgiden kotudur.
const panel = fs.readFileSync(path.join(KOK, "panel.html"), "utf8");
ok("panelde tazelik gostergesi var", /id="stats-fresh"/.test(panel));
ok("tazelik stats.updatedAt'ten okunuyor",
   /updatedAt[\s\S]{0,120}toMillis/.test(panel));
ok("renderStats tazeligi cagiriyor", /renderStats\(stats\)\s*\{\s*renderStatsFreshness\(stats\)/.test(panel));
const sozluk = fs.readFileSync(path.join(KOK, "js", "i18n.js"), "utf8");
for (const anahtar of ["page.freshNow", "page.freshAgo", "page.freshAt"]) {
  ok(`'${anahtar}' TR sozlugunde`,
     sozluk.slice(sozluk.indexOf("tr: {"), sozluk.indexOf("en: {")).includes(anahtar));
  ok(`'${anahtar}' EN sozlugunde`, sozluk.slice(sozluk.indexOf("en: {")).includes(anahtar));
}

console.log("\n" + "=".repeat(60));
if (k === 0) console.log(`✅  SENTINEL TESTLERI GECTI — ${g} kontrol`);
else { console.log(`❌  ${k} BASARISIZ / ${g + k}\n`); hatalar.forEach((x) => console.log("   ✗ " + x)); }
console.log("=".repeat(60));
process.exit(k === 0 ? 0 : 1);
