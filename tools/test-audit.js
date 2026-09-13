/**
 * Altare — denetim kaydı (audit log) testleri
 *
 *     node tools/test-audit.js
 *
 * NEDEN VAR:
 * Denetim kaydının tek işi eksiksiz olmaktır. Bir mutasyon fonksiyonu
 * eklenip denetim çağrısı unutulursa kayıt sessizce delinir — ve bunun
 * hiçbir belirtisi olmaz: sistem çalışır, loglar akar, sadece o işlem
 * kayda geçmez. Denetçi de zaten olmayan bir satırı aramaz.
 *
 * Bu yüzden buradaki en önemli test 2. bölümdeki YAPISAL kontroldür:
 * `exports.X = onCall(...)` biçimindeki her fonksiyon ya "denetim yazmalı"
 * listesinde ya da "salt okunur" listesinde olmak ZORUNDA. Yeni bir
 * fonksiyon eklendiğinde test kırılır ve geliştiriciyi karar vermeye
 * zorlar.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const KOK = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(KOK, "firebase/functions/index.js"), "utf8");

let gecen = 0, kalan = 0;
const hatalar = [];
const ok = (ad, k, d) => {
  if (k) gecen++; else { kalan++; hatalar.push(ad + (d ? "  →  " + d : "")); }
};
const baslik = (s) => console.log("\n── " + s + " " + "─".repeat(Math.max(0, 52 - s.length)));

// ── Saf yardimcilari index.js'ten cikar ─────────────────────────────────────
function parcaAl(bas, bit, ad) {
  const b = src.indexOf(bas);
  if (b < 0) throw new Error(`index.js icinde '${ad}' baslangici yok`);
  const e = src.indexOf(bit, b);
  if (e < 0) throw new Error(`index.js icinde '${ad}' bitisi yok`);
  return src.slice(b, e);
}

const blok = parcaAl(
  "const DENETIM_EYLEMLERI = {",
  "async function denetimYaz(",
  "denetim yardimcilari"
);
const modul = {};
new Function("exports", blok + `
exports.DENETIM_EYLEMLERI = DENETIM_EYLEMLERI;
exports.denetimAyrinti = denetimAyrinti;
`)(modul);
const { DENETIM_EYLEMLERI, denetimAyrinti } = modul;

// ═══════════════════════════════════════════════════════════════════════════
baslik("1. Ayrıntı temizleme (denetimAyrinti)");
// Denetim kaydı Firestore'a yazılır: Infinity/NaN/fonksiyon/derin nesne
// yazımı patlatır ve o zaman KAYIT HİÇ OLUŞMAZ. Temizleyici bunu önler.
// ═══════════════════════════════════════════════════════════════════════════

ok("null/undefined → boş nesne",
   Object.keys(denetimAyrinti(null)).length === 0 &&
   Object.keys(denetimAyrinti(undefined)).length === 0);
ok("dizi → boş nesne (nesne bekliyoruz)",
   Object.keys(denetimAyrinti([1, 2, 3])).length === 0);
ok("metin girdi → boş nesne", Object.keys(denetimAyrinti("abc")).length === 0);

(() => {
  const r = denetimAyrinti({ a: 1, b: "x", c: true });
  ok("sayı/metin/bool korunur", r.a === 1 && r.b === "x" && r.c === true);
})();

(() => {
  const r = denetimAyrinti({ yok: null, tanimsiz: undefined, sifir: 0, bosMetin: "" });
  ok("null/undefined atılır", !("yok" in r) && !("tanimsiz" in r));
  // 0 ve "" geçerli değerlerdir — atılmamalı, yoksa "0 değişiklik yapıldı"
  // kaydı "değişiklik alanı hiç yok"a dönüşür.
  ok("0 ve boş metin KORUNUR", r.sifir === 0 && r.bosMetin === "");
})();

(() => {
  const r = denetimAyrinti({ inf: Infinity, nan: NaN, negInf: -Infinity });
  ok("Infinity/NaN atılır (Firestore kabul etmez)",
     Object.keys(r).length === 0, JSON.stringify(r));
})();

(() => {
  const r = denetimAyrinti({ fn: () => {}, derin: { a: { b: 1 } } });
  ok("fonksiyon ve iç içe nesne atılır", Object.keys(r).length === 0, JSON.stringify(r));
})();

(() => {
  const r = denetimAyrinti({ uzun: "x".repeat(1000) });
  ok("uzun metin kırpılır", r.uzun.length === 300, String(r.uzun.length));
})();

(() => {
  const buyuk = {};
  for (let i = 0; i < 50; i++) buyuk["k" + i] = i;
  ok("alan sayısı sınırlanır", Object.keys(denetimAyrinti(buyuk)).length === 20);
})();

(() => {
  const r = denetimAyrinti({ keys: ["a", "b", "c"] });
  ok("dizi değer korunur", Array.isArray(r.keys) && r.keys.length === 3);
  const uzunDizi = denetimAyrinti({ k: Array(50).fill("x") });
  ok("uzun dizi kırpılır", uzunDizi.k.length === 20, String(uzunDizi.k.length));
  const karmaDizi = denetimAyrinti({ k: [1, null, { a: 1 }] });
  ok("dizi öğeleri metne çevrilir", karmaDizi.k.every((x) => typeof x === "string"));
})();

// ═══════════════════════════════════════════════════════════════════════════
baslik("2. ⚠ YAPISAL — her mutasyon fonksiyonu denetim yazıyor mu?");
// ═══════════════════════════════════════════════════════════════════════════

/** Denetim kaydı yazmak ZORUNDA olanlar — veri değiştiriyorlar. */
const DENETIM_YAZMALI = [
  "applyAutoHeal", "rollbackAutoHeal",
  "createExperiment", "promoteToExperiment", "stopExperiment", "concludeExperiment",
  "createFunnel", "deleteFunnel",
  "createGame", "deleteGame",
  "createCustomer", "setAdminRole",
  "restorePlayerSnapshot",
  "deletePlayerData", "exportPlayerData",
];

/**
 * Denetim yazması GEREKMEYENLER ve NEDEN.
 * Buradaki gerekçeler kasıtlı: her biri ya salt okunur, ya kendi kaydını
 * kirletecek kadar sık, ya da zaten başka bir kaydın parçası.
 */
const DENETIM_GEREKMEZ = {
  generateAIReport: "AI raporu üretir — oyunun davranışını değiştirmez",
  generateAutoHeal: "reçete ÖNERİR; asıl denetlenecek an applyAutoHeal",
  generateBenchmark: "salt okunur analiz",
  generateGameConcepts: "salt okunur üretim",
  askCopilot: "sohbet — canlı oyuna dokunmaz",
  getIndustryBenchmark: "salt okunur",
  fetchAnalyticsOverview: "salt okunur (GA4)",
  fetchMarketIntel: "harici pazar verisi çeker, oyuna dokunmaz",
  listMyGames: "salt okunur",
  listPlayerSnapshots: "salt okunur",
  listFunnelPresets: "salt okunur sabit liste",
  listAuditLog: "denetim kaydını OKUR — kendini loglaması döngü yaratır",
  analyzeExperimentNow: "hesaplama; sonucu yazar ama oyuna dokunmaz",
  analyzeFunnelNow: "hesaplama; sonucu yazar ama oyuna dokunmaz",
  markAlertRead: "okundu işareti — denetim kaydını gürültüye boğar",
  writePlayerSnapshot: "SDK'dan otomatik gelir, oyuncu başına dakikada bir",
};

// Tum onCall fonksiyonlarini bul
const onCallAdlari = [...src.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=\s*onCall/gm)]
  .map((m) => m[1]);

ok("onCall fonksiyonları bulundu", onCallAdlari.length > 10,
   String(onCallAdlari.length));

/** Bir exports bloğunun gövdesini kabaca al (sonraki exports'a kadar). */
function govde(ad) {
  const bas = src.search(new RegExp(`^exports\\.${ad}\\s*=\\s*onCall`, "m"));
  if (bas < 0) return "";
  const sonraki = src.slice(bas + 10).search(/^exports\.[A-Za-z0-9_]+\s*=/m);
  return sonraki < 0 ? src.slice(bas) : src.slice(bas, bas + 10 + sonraki);
}

for (const ad of DENETIM_YAZMALI) {
  const g = govde(ad);
  ok(`denetim yazıyor: ${ad}`, g.includes("denetimYaz("),
     g ? "gövdesinde denetimYaz( yok" : "fonksiyon bulunamadı");
}

// ⚠ Asıl koruma: LİSTEDE OLMAYAN yeni fonksiyon varsa test KIRILIR.
const bilinen = new Set([...DENETIM_YAZMALI, ...Object.keys(DENETIM_GEREKMEZ)]);
const siniflandirilmamis = onCallAdlari.filter((a) => !bilinen.has(a));
ok("sınıflandırılmamış onCall fonksiyonu yok",
   siniflandirilmamis.length === 0,
   "şunlar için karar ver — denetim yazmalı mı, yoksa salt okunur mu? " +
   JSON.stringify(siniflandirilmamis));

// Ters yön: listede olup artık var olmayan fonksiyonlar (ölü liste)
const mevcut = new Set(onCallAdlari);
const olu = [...bilinen].filter((a) => !mevcut.has(a));
ok("listede ölü fonksiyon adı yok", olu.length === 0, JSON.stringify(olu));

// ═══════════════════════════════════════════════════════════════════════════
baslik("3. Reddedilen girişimler de kayda giriyor mu?");
// Denetçiyi asıl ilgilendiren budur: yetkisiz biri neyi denedi?
// ═══════════════════════════════════════════════════════════════════════════

ok('yetki sarmalayıcısı "denied" yazıyor',
   src.includes('result: "denied"') &&
   src.includes("async function yetkiKontroluDenetimli("));

(() => {
  const g = govde("applyAutoHeal");
  const redSayisi = (g.match(/result: "denied"/g) || []).length;
  // İki reddetme yolu var: (a) riskli reçete deneye yönlendirildi,
  // (b) yüksek riskli force için admin gerekiyor.
  ok("applyAutoHeal iki reddetme yolunu da yazıyor", redSayisi >= 2,
     "bulunan: " + redSayisi);
})();

for (const ad of ["deletePlayerData", "exportPlayerData"]) {
  ok(`${ad} yetkiyi denetimli kontrol ediyor`,
     govde(ad).includes("yetkiKontroluDenetimli("));
}

// Sistem aktörü: guardrail otomatik durdurma. İnsan aktör yok ama kayıt şart.
ok("otomatik guardrail durdurması kayda giriyor",
   src.includes("EXPERIMENT_AUTOSTOP"));
ok("sistem aktörü null request ile yazıyor",
   src.includes("denetimYaz(null, DENETIM_EYLEMLERI.EXPERIMENT_AUTOSTOP"));
ok('aktör yoksa "system" yazılıyor',
   src.includes('.uid) || "system"'));

// ═══════════════════════════════════════════════════════════════════════════
baslik("4. Eylem sözlüğü tutarlı mı?");
// ═══════════════════════════════════════════════════════════════════════════

const eylemler = Object.entries(DENETIM_EYLEMLERI);
ok("eylem sözlüğü dolu", eylemler.length >= 15, String(eylemler.length));
ok("eylem değerleri benzersiz",
   new Set(eylemler.map(([, v]) => v)).size === eylemler.length);
ok("eylem değerleri 'alan.fiil' biçiminde",
   eylemler.every(([, v]) => /^[a-z_]+\.[a-z_]+$/.test(v)),
   JSON.stringify(eylemler.filter(([, v]) => !/^[a-z_]+\.[a-z_]+$/.test(v))));

// Tanımlanıp hiç kullanılmayan eylem = ya unutulmuş bir bağlama noktası,
// ya da ölü tanım. İkisi de temizlenmeli.
const kullanilmayan = eylemler.filter(([k]) => {
  const kullanim = (src.match(new RegExp(`DENETIM_EYLEMLERI\\.${k}\\b`, "g")) || []).length;
  return kullanim < 1;    // tanım `X: "a.b"` biçiminde; bu regex'e takılmaz,
                         // yani 0 = gerçekten hiç kullanılmamış

});
ok("tanımlı her eylem en az bir yerde kullanılıyor",
   kullanilmayan.length === 0,
   JSON.stringify(kullanilmayan.map(([k]) => k)));

// ═══════════════════════════════════════════════════════════════════════════
baslik("5. Değişmezlik ve gizlilik");
// ═══════════════════════════════════════════════════════════════════════════

const rules = fs.readFileSync(path.join(KOK, "firebase/firestore.rules"), "utf8");
ok("audit_log kuralı tanımlı", rules.includes("match /audit_log/{entryId}"));
ok("audit_log istemciye tamamen kapalı",
   /match \/audit_log\/\{entryId\} \{\s*allow read, write: if false;/.test(rules),
   "kural bulundu ama 'allow read, write: if false' değil");

ok("denetim yazımı asıl işlemi bloklamıyor (try/catch)",
   /async function denetimYaz\([\s\S]{0,1200}?catch \(err\)/.test(src));
ok("denetim yazımı sessizce kaybolmuyor (logger.error)",
   src.includes("DENETIM KAYDI YAZILAMADI"));

// Silme ucu ne SİLMEDİĞİNİ de söylemeli — dürüstlük, uyum açısından şart.
ok("silme ucu kapsamını açıkça bildiriyor",
   govde("deletePlayerData").includes("note:"));

// listAuditLog yetki kademesi: admin her şeyi, sahip yalnızca kendi oyununu
(() => {
  const g = govde("listAuditLog");
  ok("listAuditLog admin olmayanı kendi oyununa kısıtlıyor",
     g.includes('request.auth.token.admin !== true') && g.includes('where("gameId", "==", gameId)'));
  ok("listAuditLog admin olmayandan gameId istiyor",
     g.includes("Admin degilsen gameId vermelisin"));
})();

console.log("\n" + "═".repeat(60));
if (kalan === 0) {
  console.log(`✅  TUM TESTLER GECTI — ${gecen} kontrol`);
} else {
  console.log(`❌  ${kalan} BASARISIZ / ${gecen + kalan} kontrol\n`);
  for (const h of hatalar) console.log("   ✗ " + h);
}
console.log("═".repeat(60));
process.exit(kalan === 0 ? 0 : 1);
