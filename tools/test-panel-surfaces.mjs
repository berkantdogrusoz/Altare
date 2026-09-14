/**
 * Altare — panel yüzey uyarlaması testi
 *
 *     node tools/test-panel-surfaces.mjs
 *
 * NEDEN VAR:
 * Bu özellik, panelden BÖLÜM GİZLİYOR. Yanlış çalışırsa sonuç "biraz çirkin"
 * değil, "müşteri verisini göremiyor" olur — ve gizlenen şeyin kaybolduğu
 * belli olmaz, çünkü gizlenmiş bir sekme tam olarak hiç var olmamış gibi
 * görünür. Sessiz veri kaybının arayüz hâli budur.
 *
 * Üç ayrı kayma (drift) riski var, üçü de sessiz:
 *
 *   1. EVENT ADI KAYMASI — panel.html'deki YUZEY_KAYDI, sunucunun
 *      buildSummaryData'da okuduğu event adlarına dayanıyor. Sunucuda
 *      'level_fail' yeniden adlandırılırsa panel ölü bir ada bakar ve
 *      Level Intelligence HER OYUNDA kaybolur. İki dosya, tek gerçek.
 *
 *   2. İŞARET KAYMASI — HTML'deki data-surface="x" ile YUZEY_KAYDI'ndaki
 *      anahtarlar ayrışırsa: kayıtta olmayan bir işaret hiç gizlenmez
 *      (özellik sessizce çalışmaz), işareti olmayan bir kayıt ise hiçbir
 *      şeyi gizlemez (ölü kod).
 *
 *   3. ÇEVİRİ KAYMASI — YUZEY_KAYDI'ndaki i18n anahtarları koda GÖMÜLÜ
 *      olarak (tanim.i18n) çağrılıyor, yani check-i18n.py'nin statik
 *      taraması bunları GÖREMEZ. Sözlükten biri düşerse uyarı metni
 *      ham anahtar olarak görünür.
 *
 * Ayrıca mantığın kendisi test ediliyor; en kritik kural şu:
 * VERİ VARKEN HİÇBİR YÜZEY GİZLENMEZ.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(join(KOK, "panel.html"), "utf8");
const sunucu = readFileSync(join(KOK, "firebase", "functions", "index.js"), "utf8");
const sozluk = readFileSync(join(KOK, "js", "i18n.js"), "utf8");

/** panel.html'den `const AD = { ... };` ya da `function AD(...) {...}` bloğunu çıkarır. */
function blokAl(bas, kapanis = "\n        }") {
  const b = panel.indexOf(bas);
  if (b < 0) throw new Error(`panel.html icinde '${bas}' bulunamadi — yeniden adlandirildiysa bu testi guncelle.`);
  const e = panel.indexOf(kapanis, b);
  if (e < 0) throw new Error("kapanis yok: " + bas);
  return panel.slice(b, e + kapanis.length);
}

const kaynak = [
  blokAl("const YUZEY_KAYDI = {", "\n        };"),
  blokAl("const TIP_BEKLENTILERI = {", "\n        };"),
  blokAl("function cozumleYuzeyler(oyun) {"),
].join("\n\n") + "\nexport { YUZEY_KAYDI, TIP_BEKLENTILERI, cozumleYuzeyler };\n";

const { YUZEY_KAYDI, TIP_BEKLENTILERI, cozumleYuzeyler } = await import(
  "data:text/javascript;base64," + Buffer.from(kaynak, "utf8").toString("base64"));

let g = 0, k = 0; const h = [];
const ok = (ad, c, d) => { if (c) g++; else { k++; h.push(ad + (d ? " → " + d : "")); } };

// ─────────────────────────────────────────────────────────────────────────
// 1. EVENT ADI PARİTESİ — panel kaydı ≡ sunucunun okuduğu adlar
// ─────────────────────────────────────────────────────────────────────────
for (const [id, tanim] of Object.entries(YUZEY_KAYDI)) {
  for (const ad of tanim.events) {
    // Sunucuda `e.eventName === "level_start"` gibi bir karşılaştırma olmalı.
    const gecer = sunucu.includes(`"${ad}"`) || sunucu.includes(`'${ad}'`);
    ok(`sunucu '${ad}' adini taniyor (${id})`, gecer,
      "panel bu adi bekliyor ama firebase/functions/index.js icinde hic gecmiyor");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. İŞARET PARİTESİ — HTML data-surface ≡ YUZEY_KAYDI anahtarları
// ─────────────────────────────────────────────────────────────────────────
const htmlIsaretleri = new Set(
  [...panel.matchAll(/data-surface="([a-z0-9-]+)"/g)].map((m) => m[1]));
const kayitAnahtarlari = new Set(Object.keys(YUZEY_KAYDI));

for (const i of htmlIsaretleri) {
  ok(`data-surface="${i}" kayitta var`, kayitAnahtarlari.has(i),
    "HTML'de isaretli ama YUZEY_KAYDI'nda yok — hicbir zaman gizlenmez");
}
for (const a of kayitAnahtarlari) {
  ok(`'${a}' kaydinin HTML'de isareti var`, htmlIsaretleri.has(a),
    "YUZEY_KAYDI'nda var ama hicbir elemanda data-surface yok — olu kayit");
}

// TIP_BEKLENTILERI yalnizca var olan yuzeylere isaret etmeli.
for (const [tip, liste] of Object.entries(TIP_BEKLENTILERI)) {
  for (const y of liste) {
    ok(`TIP_BEKLENTILERI.${tip} -> '${y}' kayitta var`, kayitAnahtarlari.has(y),
      "beklenti listesinde olmayan yuzey — teshis metni hic uretilemez");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. ÇEVİRİ PARİTESİ — check-i18n.py bunlari GOREMEZ (dinamik cagri)
// ─────────────────────────────────────────────────────────────────────────
const trBlok = sozluk.slice(sozluk.indexOf("tr: {"), sozluk.indexOf("en: {"));
const enBlok = sozluk.slice(sozluk.indexOf("en: {"));
const gerekliAnahtarlar = [
  ...Object.values(YUZEY_KAYDI).map((d) => d.i18n),
  "surface.missingTitle", "surface.missingHint",
];
for (const anahtar of gerekliAnahtarlar) {
  ok(`TR sozlugunde '${anahtar}'`, trBlok.includes(`'${anahtar}'`));
  ok(`EN sozlugunde '${anahtar}'`, enBlok.includes(`'${anahtar}'`));
}

// ─────────────────────────────────────────────────────────────────────────
// 4. MANTIK
// ─────────────────────────────────────────────────────────────────────────
const gorunurler = (o) => Object.entries(cozumleYuzeyler(o))
  .filter(([, d]) => d.gorunur).map(([id]) => id).sort();

// EN KRİTİK KURAL: hic veri yoksa HICBIR SEY gizlenmez.
// Yeni entegrasyon yapan kullaniciya yarim panel gostermek, ona
// "burasi bozuk" dedirtir.
ok("veri yok -> hepsi gorunur",
  gorunurler({ gameType: "casino", observedEvents: [] }).length === Object.keys(YUZEY_KAYDI).length);
ok("observedEvents yok (eski oyun) -> hepsi gorunur",
  gorunurler({ gameType: "casino" }).length === Object.keys(YUZEY_KAYDI).length);
ok("oyun nesnesi yok -> hepsi gorunur, cokmez",
  gorunurler(null).length === Object.keys(YUZEY_KAYDI).length);
ok("observedEvents bozuk tip -> cokmez",
  gorunurler({ observedEvents: "level_start" }).length === Object.keys(YUZEY_KAYDI).length);

// Level'i olan oyun — kullanicinin sikayetinin tersi
const levelli = { gameType: "match3", observedEvents: ["first_open", "level_start", "level_complete"] };
ok("level eventi VAR -> levels gorunur", cozumleYuzeyler(levelli).levels.gorunur);
ok("reklam eventi YOK -> ads gizli", !cozumleYuzeyler(levelli).ads.gorunur);
ok("match3'te reklam beklenirdi -> teshis uretilir", cozumleYuzeyler(levelli).ads.beklenmisti);

// Kullanicinin sikayeti: level'i olmayan oyunda level bolumu
const levelsiz = { gameType: "casino", observedEvents: ["first_open", "session_start", "ad_watched"] };
ok("level eventi YOK -> levels gizli", !cozumleYuzeyler(levelsiz).levels.gorunur);
ok("casino'da level beklenmez -> teshis URETILMEZ", !cozumleYuzeyler(levelsiz).levels.beklenmisti);
ok("reklam eventi VAR -> ads gorunur", cozumleYuzeyler(levelsiz).ads.gorunur);
ok("gizlenen yuzey eksik eventleri bildirir",
  cozumleYuzeyler(levelsiz).levels.eksik.includes("level_start"));
ok("gorunen yuzeyde eksik listesi bos",
  cozumleYuzeyler(levelsiz).ads.eksik.length === 0);

// Etiket YANLIS olsa bile gozlem kazanir — tasarimin can alici noktasi.
const yanlisEtiket = { gameType: "casino", observedEvents: ["level_start"] };
ok("etiket 'casino' ama level eventi var -> levels YINE gorunur",
  cozumleYuzeyler(yanlisEtiket).levels.gorunur);
const etiketsiz = { gameType: null, observedEvents: ["level_complete"] };
ok("gameType yok ama level eventi var -> levels gorunur",
  cozumleYuzeyler(etiketsiz).levels.gorunur);
ok("bilinmeyen gameType -> cokmez, teshis uretmez",
  !cozumleYuzeyler({ gameType: "zzz", observedEvents: ["first_open"] }).levels.beklenmisti);

// Her yuzey icin: kendi eventlerinden HERHANGI BIRI yeterli olmali
for (const [id, tanim] of Object.entries(YUZEY_KAYDI)) {
  for (const ad of tanim.events) {
    ok(`'${id}': tek basina '${ad}' gorunur kilar`,
      cozumleYuzeyler({ observedEvents: [ad] })[id].gorunur);
  }
}

console.log("\n" + "=".repeat(60));
if (k === 0) console.log(`✅  YUZEY UYARLAMASI TESTLERI GECTI — ${g} kontrol`);
else { console.log(`❌  ${k} BASARISIZ / ${g + k}\n`); h.forEach((x) => console.log("   ✗ " + x)); }
console.log("=".repeat(60));
process.exit(k === 0 ? 0 : 1);
