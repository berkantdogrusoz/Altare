/**
 * Altare — huni (funnel) analizi testleri
 *
 *     node tools/test-funnels.js
 *
 * Huni sayıları müşterinin "oyuncular nerede kopuyor" kararını doğrudan
 * yönlendirir. Yanlış bir sayı yanlış bir bölüm tasarımına yol açar ve
 * makul göründüğü için de fark edilmez — bu testlerin varlık sebebi bu.
 */

"use strict";

const F = require("../firebase/functions/funnels.js");

let gecen = 0, kalan = 0;
const hatalar = [];

function ok(ad, kosul, detay) {
  if (kosul) { gecen++; return; }
  kalan++;
  hatalar.push(ad + (detay ? "  →  " + detay : ""));
}
function yakin(ad, a, b, tol) {
  const t = tol == null ? 1e-9 : tol;
  ok(ad, Number.isFinite(a) && Math.abs(a - b) <= t, `beklenen ${b}, gelen ${a}`);
}
function baslik(s) {
  console.log("\n── " + s + " " + "─".repeat(Math.max(0, 56 - s.length)));
}

const SN = 1000, DK = 60 * SN, SA = 60 * DK, GUN = 24 * SA;
const T0 = Date.parse("2026-09-01T10:00:00Z");

const HUNI = {
  name: "Onboarding",
  windowHours: 24,
  steps: [
    { eventName: "first_open", label: "Kurulum" },
    { eventName: "tutorial_start", label: "Tutorial başladı" },
    { eventName: "tutorial_complete", label: "Tutorial bitti" },
    { eventName: "level_complete", label: "İlk bölüm bitti" },
  ],
};

const ev = (ad, ms, params) => ({ eventName: ad, timestampMs: ms, eventParams: params || {} });

/** Oyuncu haritası kur. */
function harita(kayitlar) {
  const m = new Map();
  for (const [pid, olaylar] of Object.entries(kayitlar)) m.set(pid, olaylar);
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════
baslik("1. Tanım doğrulama");
// ═══════════════════════════════════════════════════════════════════════════

ok("geçerli tanım hatasız", F.validateFunnel(HUNI).length === 0,
   JSON.stringify(F.validateFunnel(HUNI)));

const hataVar = (mut, parca) =>
  F.validateFunnel(Object.assign({}, HUNI, mut)).some((h) => h.includes(parca));

ok("tek adımlı huni reddedilir",
   hataVar({ steps: [{ eventName: "a" }] }, "en az 2 adim"));
ok("çok fazla adım reddedilir",
   hataVar({ steps: Array(13).fill({ eventName: "a" }) }, "en fazla"));
ok("geçersiz eventName reddedilir",
   hataVar({ steps: [{ eventName: "kötü ad!" }, { eventName: "b" }] }, "eventName"));
ok("paramKey varken paramValue şart",
   hataVar({ steps: [{ eventName: "a", paramKey: "level" }, { eventName: "b" }] },
           "paramValue de gerekli"));
ok("aşırı pencere reddedilir", hataVar({ windowHours: 5000 }, "windowHours"));
ok("sıfır pencere reddedilir", hataVar({ windowHours: 0 }, "windowHours"));
ok("kısa isim reddedilir", hataVar({ name: "ab" }, "name"));

// ═══════════════════════════════════════════════════════════════════════════
baslik("2. Adım eşleştirme");
// ═══════════════════════════════════════════════════════════════════════════

ok("event adı eşleşir",
   F.stepMatches({ eventName: "level_start" }, ev("level_start", T0)));
ok("farklı event eşleşmez",
   !F.stepMatches({ eventName: "level_start" }, ev("level_end", T0)));
ok("param filtresi eşleşir",
   F.stepMatches({ eventName: "level_complete", paramKey: "level", paramValue: 1 },
                 ev("level_complete", T0, { level: 1 })));
ok("param değeri farklıysa eşleşmez",
   !F.stepMatches({ eventName: "level_complete", paramKey: "level", paramValue: 1 },
                  ev("level_complete", T0, { level: 2 })));
ok("param yoksa eşleşmez",
   !F.stepMatches({ eventName: "level_complete", paramKey: "level", paramValue: 1 },
                  ev("level_complete", T0, {})));
// İstemciler tutarsız: level bazen 3, bazen "3". Metne çevirerek karşılaştırmak
// huninin sessizce boş çıkmasını engelliyor.
ok("sayı/metin tipi farkı tolere edilir (3 ≡ '3')",
   F.stepMatches({ eventName: "lc", paramKey: "level", paramValue: 3 },
                 ev("lc", T0, { level: "3" })) &&
   F.stepMatches({ eventName: "lc", paramKey: "level", paramValue: "3" },
                 ev("lc", T0, { level: 3 })));

// ═══════════════════════════════════════════════════════════════════════════
baslik("3. Oyuncu yolu yürüme");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  const tam = [
    ev("first_open", T0),
    ev("tutorial_start", T0 + 1 * DK),
    ev("tutorial_complete", T0 + 5 * DK),
    ev("level_complete", T0 + 10 * DK),
  ];
  const r = F.walkPlayer(HUNI.steps, tam, 24);
  ok("tam yol → derinlik 4", r.depth === 4, String(r.depth));
  ok("adım zamanları kaydedildi", r.stepTimes.every((x) => x != null));
})();

(() => {
  const yarim = [
    ev("first_open", T0),
    ev("tutorial_start", T0 + 1 * DK),
    // tutorial_complete YOK
    ev("level_complete", T0 + 10 * DK),
  ];
  const r = F.walkPlayer(HUNI.steps, yarim, 24);
  ok("ara adım eksikse orada kopar", r.depth === 2, String(r.depth));
  ok("kopuştan sonraki adım SAYILMAZ", r.stepTimes[3] === null);
})();

(() => {
  // ⚠ SIRA ÖNEMLİ: tutorial_complete, tutorial_start'tan ÖNCE.
  // Küme kesişimi mantığı bunu "dönüştü" sayardı — huni saymamalı.
  const tersSira = [
    ev("first_open", T0),
    ev("tutorial_complete", T0 + 1 * DK),
    ev("tutorial_start", T0 + 5 * DK),
  ];
  const r = F.walkPlayer(HUNI.steps, tersSira, 24);
  ok("ters sıradaki adım dönüşüm saymaz", r.depth === 2, String(r.depth));
  // tutorial_start bulundu (adım 2), ama ondan SONRA tutorial_complete yok.
})();

(() => {
  const pencereAsan = [
    ev("first_open", T0),
    ev("tutorial_start", T0 + 1 * DK),
    ev("tutorial_complete", T0 + 30 * SA),   // 24 saatlik pencereden SONRA
  ];
  const r = F.walkPlayer(HUNI.steps, pencereAsan, 24);
  ok("pencere dışındaki adım sayılmaz", r.depth === 2, String(r.depth));
})();

(() => {
  const tekrarli = [
    ev("first_open", T0),
    ev("tutorial_start", T0 + 1 * DK),
    ev("tutorial_start", T0 + 2 * DK),        // tekrar
    ev("tutorial_complete", T0 + 5 * DK),
    ev("level_complete", T0 + 6 * DK),
    ev("level_complete", T0 + 7 * DK),        // tekrar
  ];
  const r = F.walkPlayer(HUNI.steps, tekrarli, 24);
  ok("tekrarlar sayıyı şişirmez", r.depth === 4);
  yakin("ilk gerçekleşme alınır", r.stepTimes[1], T0 + 1 * DK);
})();

ok("huniye hiç girmeyen → derinlik 0",
   F.walkPlayer(HUNI.steps, [ev("level_start", T0)], 24).depth === 0);
ok("boş olay listesi → derinlik 0",
   F.walkPlayer(HUNI.steps, [], 24).depth === 0);

// ═══════════════════════════════════════════════════════════════════════════
baslik("4. Huni analizi — dönüşüm oranları");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  // 100 oyuncu: 100 kurulum, 80 tutorial başlat, 40 tutorial bitir, 30 bölüm.
  const kayitlar = {};
  for (let i = 0; i < 100; i++) {
    const o = [ev("first_open", T0)];
    if (i < 80) o.push(ev("tutorial_start", T0 + 1 * DK));
    if (i < 40) o.push(ev("tutorial_complete", T0 + 5 * DK));
    if (i < 30) o.push(ev("level_complete", T0 + 10 * DK));
    kayitlar["p" + i] = o;
  }
  // Pencere kapandıktan (24sa) çok sonra ölçüyoruz → hepsi olgun.
  const r = F.analyzeFunnel(HUNI, harita(kayitlar), T0 + 5 * GUN);

  ok("giriş sayısı doğru", r.entered === 100, String(r.entered));
  ok("devam eden yok (hepsi olgun)", r.inProgress === 0, String(r.inProgress));
  ok("adım sayıları doğru",
     r.steps.map((s) => s.reached).join(",") === "100,80,40,30",
     r.steps.map((s) => s.reached).join(","));
  yakin("adım 2 önceki adımdan dönüşüm", r.steps[1].conversionFromPrev, 0.80);
  yakin("adım 3 önceki adımdan dönüşüm", r.steps[2].conversionFromPrev, 0.50);
  yakin("adım 3 ilk adımdan dönüşüm", r.steps[2].conversionFromFirst, 0.40);
  yakin("genel dönüşüm", r.overallConversion, 0.30);
  ok("tamamlayan sayısı", r.completed === 30);

  // En büyük kopuş: 80 → 40 = %50 (adım 2→3). 100→80 %20, 40→30 %25.
  ok("en büyük kopuş doğru adımda", r.biggestDropStep === 2, String(r.biggestDropStep));
  yakin("en büyük kopuş oranı", r.biggestDropRate, 0.50);
})();

(() => {
  // Geçiş süreleri: her oyuncu farklı hızda → medyan anlamlı olmalı.
  const kayitlar = {};
  for (let i = 0; i < 21; i++) {
    kayitlar["p" + i] = [
      ev("first_open", T0),
      ev("tutorial_start", T0 + (i + 1) * DK),    // 1..21 dakika
      ev("tutorial_complete", T0 + (i + 1) * DK + 2 * DK),
      ev("level_complete", T0 + (i + 1) * DK + 4 * DK),
    ];
  }
  const r = F.analyzeFunnel(HUNI, harita(kayitlar), T0 + 5 * GUN);
  // 21 oyuncu, 1..21 dk → medyan 11 dk = 660 sn
  yakin("adım 2 medyan geçiş süresi", r.steps[1].medianSecondsFromPrev, 11 * 60);
  yakin("adım 3 medyan geçiş süresi", r.steps[2].medianSecondsFromPrev, 2 * 60);
  ok("adım 1'in geçiş süresi yok", r.steps[0].medianSecondsFromPrev === null);
})();

// ═══════════════════════════════════════════════════════════════════════════
baslik("5. ⚠ OLGUNLAŞMA TUZAĞI — en kritik davranış");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  // 50 olgun oyuncu (%40 dönüşüm) + 50 huniye AZ ÖNCE girmiş oyuncu.
  // Yeni girenler "koptu" sayılırsa dönüşüm %20'ye düşer — yanlış ama
  // makul görünen bir sayı. Olgunlaşma kuralı bunu engellemek için var.
  const simdi = T0 + 10 * GUN;
  const kayitlar = {};
  for (let i = 0; i < 50; i++) {
    const o = [ev("first_open", T0)];                 // 10 gün önce → olgun
    if (i < 20) {
      o.push(ev("tutorial_start", T0 + 1 * DK));
      o.push(ev("tutorial_complete", T0 + 2 * DK));
      o.push(ev("level_complete", T0 + 3 * DK));
    }
    kayitlar["olgun" + i] = o;
  }
  for (let i = 0; i < 50; i++) {
    // 10 dakika önce girdi, henüz bitirmeye vakti olmadı
    kayitlar["yeni" + i] = [ev("first_open", simdi - 10 * DK)];
  }

  const r = F.analyzeFunnel(HUNI, harita(kayitlar), simdi);

  ok("penceresi kapanmayanlar orana GİRMEZ", r.entered === 50, String(r.entered));
  ok("devam edenler ayrıca raporlanır", r.inProgress === 50, String(r.inProgress));
  ok("toplam giriş ayrıca görünür",
     r.enteredIncludingInProgress === 100, String(r.enteredIncludingInProgress));
  yakin("dönüşüm DOĞRU (%40), yapay olarak düşmedi", r.overallConversion, 0.40);
})();

(() => {
  // Pencere kapanmadan huniyi BİTİREN oyuncu beklemeye gerek yok — sayılmalı.
  const simdi = T0 + 30 * DK;
  const kayitlar = {
    hizli: [
      ev("first_open", T0),
      ev("tutorial_start", T0 + 1 * DK),
      ev("tutorial_complete", T0 + 2 * DK),
      ev("level_complete", T0 + 3 * DK),
    ],
    yavas: [ev("first_open", T0)],          // hâlâ pencerede, bitirmedi
  };
  const r = F.analyzeFunnel(HUNI, harita(kayitlar), simdi);
  ok("huniyi bitiren, pencere kapanmasa da sayılır",
     r.entered === 1 && r.completed === 1, `entered=${r.entered} completed=${r.completed}`);
  ok("bitirmeyen hâlâ 'devam eden'", r.inProgress === 1, String(r.inProgress));
})();

// ═══════════════════════════════════════════════════════════════════════════
baslik("6. Sınır durumları — çökmemeli");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  const r = F.analyzeFunnel(HUNI, new Map(), T0 + 5 * GUN);
  ok("boş veri çökmez", r.entered === 0);
  ok("boş veride dönüşüm null", r.overallConversion === null);
  ok("boş veride kopuş adımı null", r.biggestDropStep === null);
})();

(() => {
  // Hiç kimse huniye girmiyor
  const r = F.analyzeFunnel(HUNI, harita({ p1: [ev("level_start", T0)] }), T0 + 5 * GUN);
  ok("girişsiz huni çökmez", r.entered === 0 && r.completed === 0);
})();

(() => {
  // Zaman damgası bozuk olaylar atılmalı, çökmemeli
  const r = F.analyzeFunnel(HUNI, harita({
    p1: [
      { eventName: "first_open", timestampMs: null, eventParams: {} },
      { eventName: "first_open", timestampMs: T0, eventParams: {} },
      { eventName: "tutorial_start", timestampMs: NaN, eventParams: {} },
      { eventName: "tutorial_start", timestampMs: T0 + DK, eventParams: {} },
    ],
  }), T0 + 5 * GUN);
  ok("bozuk zaman damgası atılır, kalan işlenir", r.entered === 1 && r.steps[1].reached === 1,
     `entered=${r.entered} adim2=${r.steps[1].reached}`);
})();

(() => {
  // Olaylar KARIŞIK sırada geliyor (Firestore sıralaması garantili değilse)
  const r = F.analyzeFunnel(HUNI, harita({
    p1: [
      ev("level_complete", T0 + 10 * DK),
      ev("first_open", T0),
      ev("tutorial_complete", T0 + 5 * DK),
      ev("tutorial_start", T0 + 1 * DK),
    ],
  }), T0 + 5 * GUN);
  ok("karışık sıralı olaylar önce sıralanır", r.completed === 1, String(r.completed));
})();

ok("medyan tek sayı", F.medyan([3, 1, 2]) === 2);
ok("medyan çift sayı", F.medyan([1, 2, 3, 4]) === 2.5);
ok("medyan boş → null", F.medyan([]) === null);

// ═══════════════════════════════════════════════════════════════════════════
baslik("7. Hazır şablonlar");
// ═══════════════════════════════════════════════════════════════════════════

for (const ad of Object.keys(F.PRESETS)) {
  const sablon = F.PRESETS[ad];
  ok("şablonun TR+EN adı var: " + ad, !!sablon.name_tr && !!sablon.name_en);
  ok("şablon adımları TR+EN etiketli: " + ad,
     sablon.steps.every((s) => !!s.label_tr && !!s.label_en));

  for (const lang of ["tr", "en"]) {
    const f = F.presetToFunnel(ad, lang);
    const hatalar = F.validateFunnel(f);
    ok(`şablon ${lang} geçerli: ${ad}`, hatalar.length === 0, JSON.stringify(hatalar));
    ok(`şablon ${lang} adımları etiketli: ${ad}`, f.steps.every((s) => !!s.label));
    ok(`şablon ${lang} preset anahtarını taşır: ${ad}`, f.preset === ad);
  }
  // EN kullanıcı Türkçe etiket ALMAMALI — bu gerçek bir kaymaydı.
  const en = F.presetToFunnel(ad, "en");
  ok("EN şablonda Türkçe etiket yok: " + ad,
     en.steps.every((s) => !/[çğıöşüÇĞİÖŞÜ]/.test(s.label)),
     JSON.stringify(en.steps.map((s) => s.label)));
}
ok("bilinmeyen şablon → null", F.presetToFunnel("yok_boyle", "tr") === null);

// ═══════════════════════════════════════════════════════════════════════════
baslik("8. Param filtreli huni (bölüm hunisi)");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  const bolumHunisi = {
    name: "İlk 3 bölüm",
    windowHours: 48,
    steps: [
      { eventName: "level_complete", paramKey: "level", paramValue: 1, label: "Bölüm 1" },
      { eventName: "level_complete", paramKey: "level", paramValue: 2, label: "Bölüm 2" },
      { eventName: "level_complete", paramKey: "level", paramValue: 3, label: "Bölüm 3" },
    ],
  };
  const kayitlar = {};
  for (let i = 0; i < 60; i++) {
    const o = [ev("level_complete", T0, { level: 1 })];
    if (i < 45) o.push(ev("level_complete", T0 + 10 * DK, { level: 2 }));
    if (i < 15) o.push(ev("level_complete", T0 + 20 * DK, { level: 3 }));
    kayitlar["p" + i] = o;
  }
  const r = F.analyzeFunnel(bolumHunisi, harita(kayitlar), T0 + 5 * GUN);
  ok("param filtreli adım sayıları",
     r.steps.map((s) => s.reached).join(",") === "60,45,15",
     r.steps.map((s) => s.reached).join(","));
  yakin("bölüm 2→3 dönüşümü", r.steps[2].conversionFromPrev, 15 / 45);
  ok("en büyük kopuş bölüm 3'te", r.biggestDropStep === 2);
  ok("adım etiketleri korunur", r.steps[0].label === "Bölüm 1");
  ok("param bilgisi raporda", r.steps[1].paramKey === "level" && r.steps[1].paramValue === 2);
})();

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(62));
if (kalan === 0) {
  console.log(`✅  TUM TESTLER GECTI — ${gecen} kontrol`);
} else {
  console.log(`❌  ${kalan} BASARISIZ / ${gecen + kalan} kontrol\n`);
  for (const h of hatalar) console.log("   ✗ " + h);
}
console.log("═".repeat(62));
process.exit(kalan === 0 ? 0 : 1);
