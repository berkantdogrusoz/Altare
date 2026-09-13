/**
 * Altare — panel huni kartı render testi
 *
 *     node tools/test-panel-funnels.mjs
 *
 * NEDEN VAR:
 * Huni kartı, "oyuncular nerede kopuyor" sorusunun görsel cevabı — müşterinin
 * bölüm tasarımı kararını doğrudan yönlendiriyor. İki tür hata mümkün:
 *   • Çalışma zamanı hatası → liste tümüyle boş görünür, sebep konsolda kalır
 *   • Sessiz yanlış çizim → çubuk genişliği veya yüzde yanlış hesaplanır ve
 *     makul göründüğü için fark edilmez
 * Özellikle "bozuk veri" bölümü önemli: CANLIDA henüz ölçülmemiş huniler
 * (lastResult yok), adım sayısı tanımla uyuşmayan eski sonuçlar ve sınır dışı
 * biggestDropStep değerleri olacak; render bunlarda çökmemek ZORUNDA.
 *
 * panel.html tek dosya olduğu için render fonksiyonları dosyadan çıkarılıp
 * minimal DOM stub'larıyla çalıştırılır. Çıkarma başarısız olursa test HATA
 * VERİR — sessizce "hiçbir şey test etmemek" en kötü sonuç olurdu.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(join(KOK, "panel.html"), "utf8");

function fonksiyonuAl(ad) {
  const b = panel.indexOf("function " + ad + "(");
  if (b < 0) throw new Error(`panel.html icinde '${ad}' bulunamadi — fonksiyon yeniden adlandirildiysa bu testi guncelle.`);
  const e = panel.indexOf("\n        }", b);
  if (e < 0) throw new Error("kapanis yok: " + ad);
  return panel.slice(b, e + "\n        }".length);
}

const kaynak = ["formatStepDuration", "renderFunnels"].map(fonksiyonuAl).join("\n\n") + `
const _kok = { innerHTML: "", textContent: "", querySelectorAll: () => [] };
const _bos = { innerHTML: "", textContent: "", querySelectorAll: () => [] };
function $(id) { return id === "funnel-list" ? _kok : _bos; }
function escapeHtml(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function t(k) { return "[" + k + "]"; }
export { renderFunnels, formatStepDuration, _kok };
`;
const { renderFunnels, formatStepDuration, _kok } = await import(
  "data:text/javascript;base64," + Buffer.from(kaynak, "utf8").toString("base64"));

let g = 0, k = 0; const h = [];
const ok = (ad, c, d) => { if (c) g++; else { k++; h.push(ad + (d ? " → " + d : "")); } };
const html = () => _kok.innerHTML;

const STEPS = [
  { eventName: "first_open", label: "Kurulum" },
  { eventName: "tutorial_start", label: "Tutorial başladı" },
  { eventName: "tutorial_complete", label: "Tutorial bitti" },
  { eventName: "level_complete", label: "İlk bölüm bitti" },
];
const SONUC = {
  windowHours: 24, lookbackDays: 14, entered: 500, completed: 150,
  overallConversion: 0.30, inProgress: 40, enteredIncludingInProgress: 540,
  biggestDropStep: 2, biggestDropRate: 0.50, warnings: [],
  steps: [
    { index:0, label:"Kurulum", reached:500, conversionFromPrev:1, conversionFromFirst:1, dropFromPrev:0, medianSecondsFromPrev:null },
    { index:1, label:"Tutorial başladı", reached:400, conversionFromPrev:0.8, conversionFromFirst:0.8, dropFromPrev:0.2, medianSecondsFromPrev:45 },
    { index:2, label:"Tutorial bitti", reached:200, conversionFromPrev:0.5, conversionFromFirst:0.4, dropFromPrev:0.5, medianSecondsFromPrev:180 },
    { index:3, label:"İlk bölüm bitti", reached:150, conversionFromPrev:0.75, conversionFromFirst:0.3, dropFromPrev:0.25, medianSecondsFromPrev:7200 },
  ],
};

renderFunnels([]);
ok("bos liste", html().includes("funnel.empty"));

// Olculmemis huni — en sik gorulen ilk hal
renderFunnels([{ id:"f1", name:"Onboarding hunisi", steps: STEPS }]);
ok("olculmemis huni cizilir", html().includes("Onboarding hunisi"));
ok("olculmemis: adim etiketleri var", html().includes("Kurulum"));
ok("olculmemis: 'henuz olculmedi' der", html().includes("funnel.notMeasuredYet"));
ok("olculmemis: sayilar em-dash", html().includes("—"));
ok("olculmemis: cokmez, olc butonu var", html().includes("data-funnel-measure"));

// Tam olculmus huni
renderFunnels([{ id:"f2", name:"Onboarding hunisi", steps: STEPS, lastResult: SONUC }]);
ok("genel donusum yuzde", html().includes("30.0%"));
ok("adim sayilari", html().includes(">500<") || html().includes("500 · 100.0%"));
ok("ilk adimdan donusum", html().includes("40.0%"));
ok("kopus yuzdesi negatif isaretli", html().includes("−50%"));
ok("en kotu adim isaretli", html().includes('funnel-step worst'));
ok("kopus notu adi ile", html().includes("funnel.worstStep") && html().includes("Tutorial bitti"));
ok("medyan sure gosterilir (45s)", html().includes("45s"));
ok("medyan sure dakika (180 -> 3dk)", html().includes("3dk"));
ok("medyan sure saat (7200 -> 2.0sa)", html().includes("2.0sa"));
ok("devam edenler gosterilir", html().includes("funnel.inProgress"));
ok("pencere gosterilir", html().includes("24sa"));
// Cubuk genisligi ilk adima gore oranli olmali
ok("cubuk genisligi oranli", html().includes("width:100%") && html().includes("width:40%"));

// Uyarilar
renderFunnels([{ id:"f3", name:"Bos huni", steps: STEPS,
  lastResult: { ...SONUC, entered: 0, overallConversion: null, biggestDropStep: null,
    warnings: ["hicbir oyuncu huniye girmedi — ilk adimin event adi dogru mu?"] } }]);
ok("uyari blogu cizilir", html().includes("funnel-warn"));
ok("uyari metni gecer", html().includes("event adi dogru mu"));
ok("entered=0'da kopus notu yok", !html().includes("funnel.worstStep"));

// Param filtreli adim
renderFunnels([{ id:"f4", name:"Bolum hunisi", steps: [
  { eventName:"level_complete", paramKey:"level", paramValue:1, label:"Bölüm 1" },
  { eventName:"level_complete", paramKey:"level", paramValue:2, label:"Bölüm 2" },
]}]);
ok("param filtresi gosterilir", html().includes("[level=1]"));

// Bozuk veri
for (const [ad, f] of [
  ["alansiz", { id:"x" }],
  ["steps null", { id:"y", steps: null }],
  ["lastResult steps yok", { id:"z", steps: STEPS, lastResult: { entered: 5 } }],
  ["steps sayisi uyusmuyor", { id:"w", steps: STEPS, lastResult: { ...SONUC, steps: [SONUC.steps[0]] } }],
  ["biggestDropStep sinir disi", { id:"v", steps: STEPS, lastResult: { ...SONUC, biggestDropStep: 99 } }],
  ["conversion null", { id:"u", steps: STEPS, lastResult: { ...SONUC, overallConversion: null } }],
]) {
  try { renderFunnels([f]); ok("cokmedi: " + ad, true); }
  catch (e) { ok("cokmedi: " + ad, false, e.message); }
}

ok("sure: 30sn", formatStepDuration(30) === "30s");
ok("sure: 90sn -> 2dk", formatStepDuration(90) === "2dk");
ok("sure: 5400 -> 1.5sa", formatStepDuration(5400) === "1.5sa");
ok("sure: 172800 -> 2.0g", formatStepDuration(172800) === "2.0g");
ok("sure: null", formatStepDuration(null) === null);
ok("sure: negatif", formatStepDuration(-5) === null);

console.log("\n" + "=".repeat(60));
if (k === 0) console.log(`✅  HUNI RENDER TESTLERI GECTI — ${g} kontrol`);
else { console.log(`❌  ${k} BASARISIZ / ${g + k}\n`); h.forEach(x => console.log("   ✗ " + x)); }
console.log("=".repeat(60));
process.exit(k === 0 ? 0 : 1);
