/**
 * Altare — AI bağlam bloğu testleri (uydurma yasağı)
 *
 *     node tools/test-ai-context.js
 *
 * NEDEN VAR:
 * AI'a ne ölçtüğümüzü ve ne ÖLÇMEDİĞİMİZİ söyleyen blok, ürünün doğruluk
 * garantisidir. İki yönlü hata mümkün:
 *   • Ölçülmeyen bir metrik "ölçülüyor" gibi sunulursa → AI sayı UYDURUR
 *     ve müşteri o sayıya göre karar verir.
 *   • Ölçülen bir metrik "ölçülmüyor" listesinde kalırsa → AI gerçek veriyi
 *     kullanmaz, ürün kendi ölçümünü çöpe atar.
 * Liste daha önce dört ayrı yerde elle yazılıydı; huni ölçülmeye başlayınca
 * dördünü birden güncellemek gerekiyordu. Bu testler o kaymayı yakalar.
 *
 * index.js Firebase'e bağlı olduğu için ilgili saf fonksiyonlar dosyadan
 * çıkarılıp çalıştırılır. Çıkarma başarısız olursa test HATA VERİR.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const KOK = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(KOK, "firebase/functions/index.js"), "utf8");

// ── Saf fonksiyonlari cikar ─────────────────────────────────────────────────
function parcaAl(baslangic, bitis, ad) {
  const b = src.indexOf(baslangic);
  if (b < 0) throw new Error(`index.js icinde '${ad}' baslangici bulunamadi`);
  const e = src.indexOf(bitis, b);
  if (e < 0) throw new Error(`index.js icinde '${ad}' bitisi bulunamadi`);
  return src.slice(b, e);
}

// OLCULEBILIR_METRIKLER'den gameTypeBaseline'in sonuna kadar olan blok
// tum yardimci fonksiyonlari kapsiyor.
const blok = parcaAl(
  "const OLCULEBILIR_METRIKLER = [",
  "function gameTypeBaseline(",
  "metrik kayit defteri"
);

const modul = {};
new Function("exports", blok + `
exports.olculmeyenler = olculmeyenler;
exports.retentionBlokTR = retentionBlokTR;
exports.retentionBlokEN = retentionBlokEN;
exports.huniBlokTR = huniBlokTR;
exports.huniBlokEN = huniBlokEN;
exports.huniSatirlari = huniSatirlari;
exports.retentionSatirlari = retentionSatirlari;
exports.deneyBloku = deneyBloku;
exports.yuzde = yuzde;
`)(modul);

const {
  olculmeyenler, retentionBlokTR, retentionBlokEN,
  huniBlokTR, huniBlokEN, deneyBloku, yuzde,
} = modul;

let gecen = 0, kalan = 0;
const hatalar = [];
const ok = (ad, k, d) => {
  if (k) gecen++; else { kalan++; hatalar.push(ad + (d ? "  →  " + d : "")); }
};
const baslik = (s) => console.log("\n── " + s + " " + "─".repeat(Math.max(0, 54 - s.length)));

// ── Ornek veriler ───────────────────────────────────────────────────────────
const RETENTION = {
  d1: { rate: 34.2, cohortDay: "2026-09-08", cohortSize: 412 },
  d7: { rate: 14.1, cohortDay: "2026-09-02", cohortSize: 388 },
};
const HUNILER = [{
  name: "Onboarding hunisi", windowHours: 24, entered: 500,
  overallConversion: 0.30,
  steps: [
    { label: "Kurulum", reached: 500, conversionFromPrev: 1 },
    { label: "Tutorial başladı", reached: 400, conversionFromPrev: 0.80 },
    { label: "Tutorial bitti", reached: 200, conversionFromPrev: 0.50 },
    { label: "İlk bölüm bitti", reached: 150, conversionFromPrev: 0.75 },
  ],
  biggestDropStep: 2, biggestDropRate: 0.50,
}];

// ═══════════════════════════════════════════════════════════════════════════
baslik("1. Yasak listesi bağlamdan türetiliyor");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  const bos = olculmeyenler({}, "tr");
  ok("hiçbir şey ölçülmemişken retention yasak", bos.some((x) => x.includes("retention")));
  ok("hiçbir şey ölçülmemişken huni yasak", bos.some((x) => x.includes("huni")));
  ok("LTV her durumda yasak", bos.includes("LTV"));
  ok("churn her durumda yasak", bos.some((x) => x.includes("churn")));
})();

(() => {
  const r = olculmeyenler({ retention: RETENTION }, "tr");
  ok("retention ölçülünce yasaktan ÇIKAR", !r.some((x) => x.includes("retention")),
     JSON.stringify(r));
  ok("retention ölçülse de huni yasak kalır", r.some((x) => x.includes("huni")));
})();

(() => {
  const r = olculmeyenler({ funnels: HUNILER }, "tr");
  ok("huni ölçülünce yasaktan ÇIKAR", !r.some((x) => x.includes("huni")),
     JSON.stringify(r));
  ok("huni ölçülse de retention yasak kalır", r.some((x) => x.includes("retention")));
})();

(() => {
  const r = olculmeyenler({ retention: RETENTION, funnels: HUNILER }, "tr");
  ok("ikisi de ölçülünce sadece LTV/churn/segment kalır", r.length === 3,
     JSON.stringify(r));
})();

(() => {
  // BOŞ huni dizisi "ölçülüyor" saymamalı — aksi halde AI'a ölçüm var
  // izlenimi verip uydurma kapısını açardık.
  const r = olculmeyenler({ funnels: [] }, "tr");
  ok("boş huni dizisi ölçüm SAYILMAZ", r.some((x) => x.includes("huni")));
})();

(() => {
  const en = olculmeyenler({}, "en");
  ok("EN listesi İngilizce", en.some((x) => x.includes("funnel conversion rates")) &&
     en.some((x) => x.includes("churn rate")));
  ok("TR ve EN aynı sayıda öğe", en.length === olculmeyenler({}, "tr").length);
})();

// ═══════════════════════════════════════════════════════════════════════════
baslik("2. Retention bloğu — dört durum");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  const b = retentionBlokTR({});
  ok("ölçülmemiş TR: yasak başlığı", b.includes("ASLA SAYI VERME"));
  ok("ölçülmemiş TR: baseline'ın tür referansı olduğu söylenir",
     b.includes("TÜR REFERANSIDIR"));
  ok("ölçülmemiş TR: nitel yoruma izin verilir", b.includes("NİTEL"));
  ok("ölçülmemiş TR: huni de yasak listesinde", b.includes("huni"));
})();

(() => {
  const b = retentionBlokTR({ retention: RETENTION });
  ok("ölçülmüş TR: gerçek sayılar var", b.includes("D1=%34.2") && b.includes("D7=%14.1"));
  ok("ölçülmüş TR: kohort günü ve n var",
     b.includes("2026-09-08") && b.includes("n=412"));
  ok("ölçülmüş TR: ölçülen başlığı", b.includes("ÖLÇÜLEN RETENTION"));
  ok("ölçülmüş TR: 'ASLA SAYI VERME' başlığı YOK", !b.includes("ASLA SAYI VERME"));
  ok("ölçülmüş TR: D30 ölçülmediği için UYDURULMAZ", !b.includes("D30"));
  ok("ölçülmüş TR: baseline ayrımı korunur", b.includes("TÜR REFERANSIDIR"));
})();

(() => {
  const b = retentionBlokEN({ retention: RETENTION });
  ok("ölçülmüş EN: gerçek sayılar", b.includes("D1=%34.2"));
  ok("ölçülmüş EN: İngilizce başlık", b.includes("MEASURED RETENTION"));
  ok("ölçülmüş EN: genre reference ayrımı", b.includes("GENRE REFERENCE"));
})();

ok("ölçülmemiş EN: yasak başlığı", retentionBlokEN({}).includes("NEVER STATE A NUMBER"));

// ═══════════════════════════════════════════════════════════════════════════
baslik("3. Huni bloğu");
// ═══════════════════════════════════════════════════════════════════════════

ok("huni yoksa blok BOŞ (gürültü yapmaz)", huniBlokTR({}) === "");
ok("boş huni dizisinde blok boş", huniBlokTR({ funnels: [] }) === "");

(() => {
  const b = huniBlokTR({ funnels: HUNILER });
  ok("huni adı yazılır", b.includes("Onboarding hunisi"));
  ok("adım sayıları yazılır", b.includes("Kurulum: 500"));
  ok("adım dönüşümü YÜZDE olarak", b.includes("%80.0"),
     "0.8 ham oran olarak geçmiş olabilir");
  ok("genel dönüşüm yüzde", b.includes("%30.0"));
  ok("n yazılır", b.includes("n=500"));
  ok("pencere yazılır", b.includes("24sa"));
  ok("en büyük kopuş adı ile gösterilir",
     b.includes("en büyük kopuş") && b.includes("Tutorial bitti"));
  ok("olgunlaşma açıklaması var — n'in neden küçük olduğu",
     b.includes("penceresi KAPANMIŞ"));
  ok("aksiyon yönlendirmesi var", b.includes("aksiyon"));
})();

(() => {
  const b = huniBlokEN({ funnels: HUNILER });
  ok("EN huni bloğu İngilizce", b.includes("MEASURED FUNNEL CONVERSIONS"));
  ok("EN'de yüzde işareti doğru yerde", b.includes("80.0%"));
  ok("EN olgunlaşma açıklaması", b.includes("window has CLOSED"));
})();

// Yüzde dönüşümü — modelin 0.42'yi "%0.42" sanması gerçek bir hata kaynağı.
ok("yuzde(0.4237) = 42.4", yuzde(0.4237) === "42.4");
ok("yuzde(1) = 100.0", yuzde(1) === "100.0");
ok("yuzde(null) = null", yuzde(null) === null);
ok("yuzde(undefined) = null", yuzde(undefined) === null);

// ═══════════════════════════════════════════════════════════════════════════
baslik("4. Deney bloğu");
// ═══════════════════════════════════════════════════════════════════════════

ok("deney yoksa blok boş", deneyBloku(null, "tr") === "");
ok("boş dizide blok boş", deneyBloku([], "tr") === "");

(() => {
  const b = deneyBloku([{
    id: "e1", name: "Reklam testi", exposurePct: 10,
    primaryMetric: "session_length_avg",
    keys: ["ad_frequency_interstitial"], verdict: null,
  }], "tr");
  ok("deney adı yazılır", b.includes("Reklam testi"));
  ok("test edilen anahtar yazılır", b.includes("ad_frequency_interstitial"));
  ok("katılım yüzdesi yazılır", b.includes("%10"));
  // En kritik satır: bu anahtara dokunma talimatı. Dokunulursa kontrol grubu
  // da deneme değerine geçer ve deney sessizce geçersiz olur.
  ok("anahtara dokunmama talimatı var", b.includes("DEĞİŞİKLİK ÖNERME"));
  ok("gerekçe açıklanır (deneyi geçersiz kılar)", b.includes("geçersiz"));
})();

(() => {
  const b = deneyBloku([{
    id: "e1", name: "Ad test", exposurePct: 10,
    primaryMetric: "session_length_avg", keys: ["x"], verdict: "winner",
  }], "en");
  ok("EN deney bloğu İngilizce", b.includes("RUNNING EXPERIMENTS"));
  ok("EN'de dokunmama talimatı", b.includes("DO NOT propose changes"));
})();

// ═══════════════════════════════════════════════════════════════════════════
baslik("5. Sınır durumları — çökmemeli");
// ═══════════════════════════════════════════════════════════════════════════

for (const [ad, ctx] of [
  ["null bağlam", null],
  ["boş nesne", {}],
  ["retention boş nesne", { retention: {} }],
  ["huni adımsız", { funnels: [{ name: "x", entered: 5 }] }],
  ["huni null adımlar", { funnels: [{ name: "x", entered: 5, steps: null }] }],
  ["biggestDropStep sınır dışı",
   { funnels: [{ name: "x", entered: 5, steps: [{ label: "a", reached: 5 }], biggestDropStep: 9 }] }],
  ["dönüşüm null", { funnels: [{ name: "x", entered: 5, overallConversion: null, steps: [] }] }],
]) {
  try {
    retentionBlokTR(ctx); retentionBlokEN(ctx);
    huniBlokTR(ctx); huniBlokEN(ctx);
    olculmeyenler(ctx, "tr"); olculmeyenler(ctx, "en");
    ok("çökmedi: " + ad, true);
  } catch (e) {
    ok("çökmedi: " + ad, false, e.message);
  }
}

console.log("\n" + "═".repeat(60));
if (kalan === 0) {
  console.log(`✅  TUM TESTLER GECTI — ${gecen} kontrol`);
} else {
  console.log(`❌  ${kalan} BASARISIZ / ${gecen + kalan} kontrol\n`);
  for (const h of hatalar) console.log("   ✗ " + h);
}
console.log("═".repeat(60));
process.exit(kalan === 0 ? 0 : 1);
