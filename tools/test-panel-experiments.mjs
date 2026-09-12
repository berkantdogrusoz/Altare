/**
 * Altare — panel A/B deney karti render testi
 *
 *     node tools/test-panel-experiments.mjs
 *
 * NEDEN VAR:
 * Deney kartlari panelin yatirimci sunumunda gosterilecek yuzeyi. Buradaki
 * bir calisma zamani hatasi (tanimsiz alan, eksik analiz nesnesi) tum listeyi
 * bos gosterir ve sebebi konsolda kalir. Ozellikle 7. bolum onemli: CANLIDA
 * eksik/bozuk deney dokumanlari olacak (yeni baslamis deneyin lastAnalysis'i
 * yoktur, kirpilmis analizde metrics null olabilir) ve render bunlarda
 * cokmemek ZORUNDA.
 *
 * NASIL:
 * panel.html tek dosya oldugu icin render fonksiyonlari dosyadan cikarilip
 * minimal DOM stublariyla calistirilir. Cikarma basarisiz olursa test HATA
 * VERIR — sessizce "hicbir sey test etmemek" en kotu sonuc olurdu.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(join(KOK, "panel.html"), "utf8");

// ── Render fonksiyonlarini panel.html'den cikar ──────────────────────────────
function fonksiyonuAl(src, ad) {
  const bas = src.indexOf("function " + ad + "(");
  if (bas < 0) throw new Error(`panel.html icinde '${ad}' bulunamadi — ` +
    "fonksiyon yeniden adlandirildiysa bu testi guncelle.");
  const kapanis = src.indexOf("\n        }", bas);
  if (kapanis < 0) throw new Error(`'${ad}' kapanisi bulunamadi (girinti degisti mi?)`);
  return src.slice(bas, kapanis + "\n        }".length);
}

const kaynak = ["formatMetricValue", "formatP", "renderExperiments"]
  .map((ad) => fonksiyonuAl(panel, ad)).join("\n\n") + `

// ─── DOM + i18n stublari ───
const _kok = { innerHTML: "", textContent: "", querySelectorAll: () => [] };
const _bos = { innerHTML: "", textContent: "", querySelectorAll: () => [] };
function $(id) { return id === "exp-list" ? _kok : _bos; }
function escapeHtml(x) {
  return String(x == null ? "" : x).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function getLanguage() { return "tr"; }
function t(k) { return "[" + k + "]"; }
export { renderExperiments, formatMetricValue, formatP, _kok };
`;

// Cikarilan kodun gercekten uc fonksiyonu da tasidigini dogrula.
for (const ad of ["formatMetricValue", "formatP", "renderExperiments"]) {
  if (!kaynak.includes("function " + ad + "(")) {
    throw new Error("cikarma bozuk: " + ad + " harness'ta yok");
  }
}
// data: URL olarak import — diske gecici dosya yazmaya gerek yok.
const { renderExperiments, formatMetricValue, formatP, _kok } = await import(
  "data:text/javascript;base64," + Buffer.from(kaynak, "utf8").toString("base64")
);

// ── Test cercevesi ──────────────────────────────────────────────────────────
let gecen = 0, kalan = 0;
const hatalar = [];
const ok = (ad, kosul, detay) => {
  if (kosul) gecen++;
  else { kalan++; hatalar.push(ad + (detay ? "  →  " + detay : "")); }
};
const html = () => _kok.innerHTML;

const ts = { toDate: () => new Date("2026-09-10T12:00:00Z") };
const ikiVaryant = (degerler) => [
  { key: "control", allocation: 50, values: {} },
  { key: "treatment", allocation: 50, values: degerler || { ad_frequency_interstitial: 90 } },
];

console.log("\n── 1. Bos liste ───────────────────────────────────────────");
renderExperiments([]);
ok("bos liste cokmez ve bos durum gosterir", html().includes("exp.empty"));

console.log("── 2. Analizi olmayan yeni deney (en sik gorulen hal) ─────");
renderExperiments([{
  id: "e1", name: "Reklam araligi", status: "running", exposurePct: 10,
  minSamplePerVariant: 200, startedAt: ts, hypothesis: "Reklam cok sik",
  variants: ikiVaryant(),
}]);
ok("deney cizilir", html().includes("Reklam araligi"));
ok("hipotez gosterilir", html().includes("Reklam cok sik"));
ok("analiz yoksa verdict gosterilmez", !html().includes("exp-verdict"));
ok("kontrol grubu 'mevcut degerler' der", html().includes("exp.currentValues"));
ok("deneme grubu degeri yazilir", html().includes("ad_frequency_interstitial=90"));
ok("olc + durdur butonlari var",
   html().includes("data-exp-analyze") && html().includes("data-exp-stop"));
ok("kazanan yokken yayginlastir butonu YOK", !html().includes("data-exp-ship"));

console.log("── 3. Kazananli tam analiz ────────────────────────────────");
const kazananAnaliz = {
  verdict: "winner", winner: "treatment", primaryMetric: "session_length_avg",
  perVariantExposed: { control: 612, treatment: 588 },
  mismatchedPlayers: 0, mismatchRate: 0, exposedPlayers: 1200,
  sufficientSample: true, requiredSamplePerVariant: 430, warnings: [],
  metrics: {
    session_length_avg: {
      type: "mean", label_tr: "Ortalama oturum suresi (sn)",
      label_en: "Avg session length (s)", higherIsBetter: true, guardrail: true,
      n: { control: 612, treatment: 588 },
      vs_control: { treatment: {
        baseline: 302.4, treatment: 401.8, absoluteDiff: 99.4,
        relativeLift: 0.3287, p: 0.0004, n1: 612, n2: 588, improved: true } },
    },
    crash_free_rate: {
      type: "rate", label_tr: "Cokmesiz oyuncu orani",
      label_en: "Crash-free player rate", higherIsBetter: true, guardrail: true,
      n: { control: 612, treatment: 588 },
      vs_control: { treatment: {
        baseline: 0.981, treatment: 0.979, absoluteDiff: -0.002,
        relativeLift: -0.00204, p: 0.78, n1: 612, n2: 588, improved: false } },
    },
  },
};
renderExperiments([{
  id: "e2", name: "Kazanan deney", status: "running", exposurePct: 10,
  minSamplePerVariant: 200, startedAt: ts, lastAnalysis: kazananAnaliz,
  variants: ikiVaryant(),
}]);
ok("kazanan verdict'i gosterilir", html().includes("exp.verdict.winner"));
ok("yayginlastir butonu cikar", html().includes("data-exp-ship"));
ok("birincil metrik yildizla isaretli", html().includes("★"));
ok("bagil artis dogru", html().includes("+32.9%"));
ok("p-degeri formatlanir", html().includes("p&lt;0.001"));
// Ortalama metrikte buyuk degerler ondaliksiz gosterilir (302.4 sn -> "302"):
// oturum suresi icin ondalik okunabilirlige katki yapmaz.
ok("ortalama metrik ham sayi olarak", html().includes("302") && html().includes("402"));
ok("oran metrigi yuzde olarak", html().includes("98.1%"));
ok("guardrail etiketi gosterilir", html().includes("exp.guardrail"));
ok("varyant basina n gosterilir", html().includes("n=612"));
ok("kotulesen metrik 'down' renginde", html().includes('class="lift down"'));

console.log("── 4. Guardrail ihlali + uyarilar ─────────────────────────");
renderExperiments([{
  id: "e3", name: "Zararli deney", status: "stopped", exposurePct: 10,
  minSamplePerVariant: 200, startedAt: ts,
  stoppedReason: "guardrail_breach: crash_free_rate",
  lastAnalysis: { ...kazananAnaliz, verdict: "guardrail_breach", winner: null,
    warnings: ["olaylar_kirpildi: en yeni olaylar analiz disi kaldi"] },
  variants: ikiVaryant({ x: 1 }),
}]);
ok("ihlal verdict'i gosterilir", html().includes("exp.verdict.guardrail_breach"));
ok("durdurma sebebi gosterilir", html().includes("guardrail_breach: crash_free_rate"));
ok("uyari blogu cizilir", html().includes("exp-warn"));
ok("durdurulmus deneyde 'durdur' butonu yok", !html().includes("data-exp-stop"));
ok("durdurulmusta 'vazgec' butonu var", html().includes("data-exp-abandon"));

console.log("── 5. Sonuclanmis deney ───────────────────────────────────");
renderExperiments([{
  id: "e4", name: "Bitmis deney", status: "concluded", exposurePct: 10,
  startedAt: ts, shippedVariant: "treatment", variants: ikiVaryant({ x: 1 }),
}]);
ok("sonuclanmista aksiyon butonu yok", !html().includes("exp-actions"));
ok("yayginlastirilan varyant yazilir", html().includes("exp.shipped"));

console.log("── 6. Siralama ────────────────────────────────────────────");
renderExperiments([
  { id: "a", name: "BITMIS", status: "concluded", exposurePct: 10, startedAt: ts,
    variants: ikiVaryant({ x: 1 }) },
  { id: "b", name: "CALISAN", status: "running", exposurePct: 10, startedAt: ts,
    variants: ikiVaryant({ y: 1 }) },
]);
ok("calisan deney her zaman ustte",
   html().indexOf("CALISAN") < html().indexOf("BITMIS"));

console.log("── 7. Bozuk / eksik veri (CANLIDA OLUR) ───────────────────");
const bozuklar = [
  ["alansiz dokuman", { id: "x", status: "running" }],
  ["bos varyant dizisi", { id: "y", status: "running", variants: [] }],
  ["variants null + metrics null", { id: "z", status: "running", variants: null,
    lastAnalysis: { verdict: "winner", metrics: null } }],
  ["bos metrik nesnesi", { id: "w", status: "running", variants: [{ key: "control" }],
    lastAnalysis: { metrics: { m: {} } } }],
  ["startedAt yok", { id: "v", status: "running", exposurePct: 10,
    variants: ikiVaryant() }],
  ["vs_control icinde null test", { id: "u", status: "running", exposurePct: 10,
    variants: ikiVaryant(), lastAnalysis: { verdict: "no_difference",
      metrics: { m: { type: "mean", vs_control: { treatment: null } } } } }],
];
for (const [ad, bozuk] of bozuklar) {
  try { renderExperiments([bozuk]); ok("cokmedi: " + ad, true); }
  catch (e) { ok("cokmedi: " + ad, false, e.message); }
}

console.log("── 8. Bicimlendirme yardimcilari ──────────────────────────");
ok("oran yuzdeye cevrilir", formatMetricValue(0.3287, "rate") === "32.9%");
ok("kucuk ortalama 2 ondalik", formatMetricValue(3.14159, "mean") === "3.14");
ok("buyuk ortalama ondaliksiz", formatMetricValue(302.44, "mean") === "302");
ok("null -> tire", formatMetricValue(null, "mean") === "—");
ok("sonsuz -> tire", formatMetricValue(Infinity, "mean") === "—");
ok("kucuk p", formatP(0.0001) === "p<0.001");
ok("normal p", formatP(0.042) === "p=0.042");
ok("null p -> bos", formatP(null) === "");

console.log("\n" + "=".repeat(64));
if (kalan === 0) {
  console.log(`✅  TUM TESTLER GECTI — ${gecen} kontrol`);
} else {
  console.log(`❌  ${kalan} BASARISIZ / ${gecen + kalan} kontrol\n`);
  for (const h of hatalar) console.log("   ✗ " + h);
}
console.log("=".repeat(64));
process.exit(kalan === 0 ? 0 : 1);
