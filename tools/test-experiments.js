/**
 * Altare — A/B deney motoru testleri
 *
 *   node tools/test-experiments.js
 *
 * Firebase gerektirmez, emulator gerektirmez, ag gerektirmez.
 * Yanlis bir z-testi canli oyuna yanlis config yazdirir; bu testler
 * o zincirin ilk halkasidir.
 */

"use strict";

const E = require("../firebase/functions/experiments.js");

let gecen = 0, kalan = 0;
const hatalar = [];

function ok(ad, kosul, detay) {
  if (kosul) { gecen++; return; }
  kalan++;
  hatalar.push(ad + (detay ? "  →  " + detay : ""));
}

function yakin(ad, a, b, tolerans) {
  const t = tolerans == null ? 1e-6 : tolerans;
  ok(ad, Number.isFinite(a) && Math.abs(a - b) <= t,
     `beklenen ${b}, gelen ${a} (tolerans ${t})`);
}

function baslik(s) { console.log("\n── " + s + " " + "─".repeat(Math.max(0, 58 - s.length))); }

// ═══════════════════════════════════════════════════════════════════════════
baslik("1. FNV-1a 32-bit — standart test vektorleri");
// Bu vektorler FNV referans uygulamasindan gelir. C# tarafi ayni sonucu
// uretmezse atama bozulur ve deney sessizce anlamsizlasir.
// ═══════════════════════════════════════════════════════════════════════════

ok("fnv('') = 0x811c9dc5", E.fnv1a32("") === 0x811c9dc5, String(E.fnv1a32("")));
ok("fnv('a') = 0xe40c292c", E.fnv1a32("a") === 0xe40c292c, String(E.fnv1a32("a")));
ok("fnv('foobar') = 0xbf9cf968", E.fnv1a32("foobar") === 0xbf9cf968, String(E.fnv1a32("foobar")));
ok("cikti her zaman isaretsiz 32-bit", (() => {
  for (const s of ["", "a", "zzzz", "çğü", "player-0001"]) {
    const h = E.fnv1a32(s);
    if (!(Number.isInteger(h) && h >= 0 && h <= 0xffffffff)) return false;
  }
  return true;
})());
ok("UTF-8 (ASCII disi) baytlarindan hesaplanir", E.fnv1a32("ç") !== E.fnv1a32("c"));

// ═══════════════════════════════════════════════════════════════════════════
baslik("2. Kova atamasi — dagilim ve kararlilik");
// ═══════════════════════════════════════════════════════════════════════════

const OYUNCU = (i) => "anon-" + i + "-8f3b2c";
const N_SIM = 20000;

const deney50 = {
  id: "exp_abc123",
  exposurePct: 100,
  variants: [
    { key: "control", allocation: 50, values: {} },
    { key: "treatment", allocation: 50, values: { ad_frequency_interstitial: 90 } },
  ],
  primaryMetric: "session_length_avg",
  minSamplePerVariant: 100,
};

(() => {
  let a = 0, b = 0, yok = 0;
  for (let i = 0; i < N_SIM; i++) {
    const v = E.assignVariant(deney50, OYUNCU(i));
    if (v === "control") a++; else if (v === "treatment") b++; else yok++;
  }
  ok("exposurePct=100 → kimse disarida kalmaz", yok === 0, "disarida: " + yok);
  // %50/%50 icin 20000 denemede standart sapma ~%0.35; %2 sapma payi cok genis.
  const sapma = Math.abs(a - b) / N_SIM;
  ok("50/50 dagilim dengeli", sapma < 0.02,
     `control=${a} treatment=${b} sapma=${(sapma * 100).toFixed(2)}%`);
})();

(() => {
  const deney10 = Object.assign({}, deney50, { exposurePct: 10 });
  let icerde = 0;
  for (let i = 0; i < N_SIM; i++) if (E.assignVariant(deney10, OYUNCU(i))) icerde++;
  const oran = icerde / N_SIM;
  ok("exposurePct=10 → ~%10 oyuncu girer", Math.abs(oran - 0.10) < 0.015,
     `gelen %${(oran * 100).toFixed(2)}`);
})();

(() => {
  const deney70_30 = Object.assign({}, deney50, {
    variants: [
      { key: "control", allocation: 70, values: {} },
      { key: "treatment", allocation: 30, values: { x: 1 } },
    ],
  });
  let a = 0, b = 0;
  for (let i = 0; i < N_SIM; i++) {
    const v = E.assignVariant(deney70_30, OYUNCU(i));
    if (v === "control") a++; else if (v === "treatment") b++;
  }
  ok("70/30 tahsis uygulanir", Math.abs(a / N_SIM - 0.70) < 0.02,
     `control oran %${((a / N_SIM) * 100).toFixed(2)}`);
})();

ok("atama deterministik (ayni girdi → ayni cikti)", (() => {
  for (let i = 0; i < 500; i++) {
    const p = OYUNCU(i);
    if (E.assignVariant(deney50, p) !== E.assignVariant(deney50, p)) return false;
  }
  return true;
})());

ok("exposurePct buyutulunce MEVCUT oyuncular varyant DEGISTIRMEZ", (() => {
  // Tasarim: varyant hash'i giris hash'inden ayridir. Boylece "%10 ile basla,
  // sonra %50'ye cik" yapildiginda ilk gruptakiler ayni varyantta kalir.
  const d10 = Object.assign({}, deney50, { exposurePct: 10 });
  const d50 = Object.assign({}, deney50, { exposurePct: 50 });
  for (let i = 0; i < 5000; i++) {
    const p = OYUNCU(i);
    const v10 = E.assignVariant(d10, p);
    if (!v10) continue;                       // ilk turda disarida
    if (E.assignVariant(d50, p) !== v10) return false;
  }
  return true;
})());

ok("farkli deneyler bagimsiz kova kullanir", (() => {
  const d2 = Object.assign({}, deney50, { id: "exp_xyz789" });
  let ayni = 0;
  for (let i = 0; i < 5000; i++) {
    const p = OYUNCU(i);
    if (E.assignVariant(deney50, p) === E.assignVariant(d2, p)) ayni++;
  }
  // Bagimsiz olsalardi ~%50 ortusme beklenir; %70+ ortusme tasarimin bozuk
  // oldugunu (tasima/carryover) gosterir.
  return ayni / 5000 < 0.60;
})());

ok("exposurePct=0 → kimse girmez",
   E.assignVariant(Object.assign({}, deney50, { exposurePct: 0 }), OYUNCU(1)) === null);
ok("tek varyant → deney gecersiz, atama yok",
   E.assignVariant(Object.assign({}, deney50, {
     variants: [{ key: "control", allocation: 100 }] }), OYUNCU(1)) === null);

// ═══════════════════════════════════════════════════════════════════════════
baslik("3. resolveValues — taban + varyant birlesimi");
// ═══════════════════════════════════════════════════════════════════════════

(() => {
  const taban = { ad_frequency_interstitial: 60, level_18_moves_limit: 25 };
  let kontrolGoruldu = false, denemeGoruldu = false;
  for (let i = 0; i < 200; i++) {
    const r = E.resolveValues(taban, deney50, OYUNCU(i));
    if (r.variant === "control") {
      kontrolGoruldu = true;
      ok("kontrol grubu taban degerleri alir",
         r.values.ad_frequency_interstitial === 60 && r.values.level_18_moves_limit === 25);
    } else if (r.variant === "treatment") {
      denemeGoruldu = true;
      ok("deneme grubu override alir", r.values.ad_frequency_interstitial === 90);
      ok("override edilmeyen key taban degerde kalir", r.values.level_18_moves_limit === 25);
    }
    if (kontrolGoruldu && denemeGoruldu) break;
  }
  ok("her iki grup da uretildi", kontrolGoruldu && denemeGoruldu);

  const disarida = E.resolveValues(taban, Object.assign({}, deney50, { exposurePct: 0 }), OYUNCU(1));
  ok("deney disindaki oyuncu SADECE taban degerleri alir",
     disarida.variant === null && disarida.values.ad_frequency_interstitial === 60);

  const kopya = { a: 1 };
  E.resolveValues(kopya, deney50, OYUNCU(3));
  ok("taban nesne mutasyona ugramaz", Object.keys(kopya).length === 1);
})();

// ═══════════════════════════════════════════════════════════════════════════
baslik("4. Deney dogrulama");
// ═══════════════════════════════════════════════════════════════════════════

const gecerli = {
  name: "Reklam araligi testi",
  exposurePct: 20,
  variants: [
    { key: "control", allocation: 50, values: {} },
    { key: "treatment", allocation: 50, values: { ad_frequency_interstitial: 90 } },
  ],
  primaryMetric: "session_length_avg",
  minSamplePerVariant: 200,
};

ok("gecerli tanim hatasiz", E.validateExperiment(gecerli).length === 0,
   JSON.stringify(E.validateExperiment(gecerli)));

function hataIcerir(mutasyon, parca) {
  const h = E.validateExperiment(Object.assign({}, gecerli, mutasyon));
  return h.some((x) => x.includes(parca));
}
ok("tahsis toplami 100 degilse reddedilir", hataIcerir({
  variants: [{ key: "control", allocation: 50, values: {} },
             { key: "treatment", allocation: 30, values: {} }] }, "100'e toplanmali"));
ok("control varyanti yoksa reddedilir", hataIcerir({
  variants: [{ key: "a", allocation: 50, values: {} },
             { key: "b", allocation: 50, values: {} }] }, "'control' olmali"));
ok("control deger degistiremez", hataIcerir({
  variants: [{ key: "control", allocation: 50, values: { x: 1 } },
             { key: "treatment", allocation: 50, values: {} }] }, "kontrol grubu deger degistiremez"));
ok("tekrar eden varyant key'i reddedilir", hataIcerir({
  variants: [{ key: "control", allocation: 34, values: {} },
             { key: "control", allocation: 33, values: {} },
             { key: "treatment", allocation: 33, values: {} }] }, "tekrar ediyor"));
ok("exposurePct > 100 reddedilir", hataIcerir({ exposurePct: 140 }, "exposurePct"));
ok("bilinmeyen primaryMetric reddedilir", hataIcerir({ primaryMetric: "ltv" }, "primaryMetric"));

// %0.01 IZGARASI — parite korumasi (bkz. experiments.js / izgaradaMi).
// Izgara disi bir yuzde, yuvarlamayi JS/C#/Python'da ayristirabilecek tam
// yarim degerler uretir; girdiyi kisitlayarak o sinifi tamamen kaldiriyoruz.
ok("izgara disi exposurePct reddedilir", hataIcerir({ exposurePct: 12.505 }, "%0.01 adimi"));
ok("izgara disi allocation reddedilir", hataIcerir({
  variants: [{ key: "control", allocation: 66.665, values: {} },
             { key: "treatment", allocation: 33.335, values: {} }] }, "%0.01 adimi"));
ok("2 ondalikli yuzde KABUL edilir", E.validateExperiment(Object.assign({}, gecerli, {
  exposurePct: 12.5,
  variants: [{ key: "control", allocation: 66.67, values: {} },
             { key: "treatment", allocation: 33.33, values: {} }] })).length === 0,
  JSON.stringify(E.validateExperiment(Object.assign({}, gecerli, {
    exposurePct: 12.5,
    variants: [{ key: "control", allocation: 66.67, values: {} },
               { key: "treatment", allocation: 33.33, values: {} }] }))));
ok("tek varyant reddedilir", hataIcerir({
  variants: [{ key: "control", allocation: 100, values: {} }] }, "en az 2 varyant"));

ok("dondurulmus alan degisimi yakalanir", (() => {
  const d = E.frozenFieldChanges(gecerli, Object.assign({}, gecerli, { exposurePct: 50 }));
  return d.length === 1 && d[0] === "exposurePct";
})());
ok("dondurulmamis alan degisimi serbest",
   E.frozenFieldChanges(gecerli, Object.assign({}, gecerli, { name: "yeni ad" })).length === 0);

// ═══════════════════════════════════════════════════════════════════════════
baslik("5. Istatistik cekirdegi");
// ═══════════════════════════════════════════════════════════════════════════

yakin("erf(0) = 0", E.erf(0), 0, 1e-9);
yakin("erf(1) = 0.8427008", E.erf(1), 0.8427008, 2e-7);
yakin("erf(-1) = -0.8427008", E.erf(-1), -0.8427008, 2e-7);
yakin("normalCdf(0) = 0.5", E.normalCdf(0), 0.5, 1e-9);
yakin("normalCdf(1.96) = 0.975", E.normalCdf(1.959964), 0.975, 2e-7);
yakin("normalCdf(-1.96) = 0.025", E.normalCdf(-1.959964), 0.025, 2e-7);
yakin("inverseNormalCdf(0.975) = 1.959964", E.inverseNormalCdf(0.975), 1.959964, 1e-5);
yakin("inverseNormalCdf(0.80) = 0.8416212", E.inverseNormalCdf(0.80), 0.8416212, 1e-5);
yakin("inverseNormalCdf(0.5) = 0", E.inverseNormalCdf(0.5), 0, 1e-9);
ok("inverseNormalCdf sinir disi → NaN",
   Number.isNaN(E.inverseNormalCdf(0)) && Number.isNaN(E.inverseNormalCdf(1)));

// Ders kitabi ornegi: p1=0.40 (40/100), p2=0.55 (55/100) → z=2.1240, p=0.0337
(() => {
  const r = E.twoProportionTest(40, 100, 55, 100, 0.05);
  yakin("iki oran testi: z", r.z, 2.1240, 1e-3);
  yakin("iki oran testi: p", r.p, 0.0337, 1e-3);
  yakin("iki oran testi: mutlak fark", r.absoluteDiff, 0.15, 1e-9);
  yakin("iki oran testi: bagil artis", r.relativeLift, 0.375, 1e-9);
  ok("guven araligi farki icerir", r.ci[0] < 0.15 && r.ci[1] > 0.15);
  ok("anlamli sonucta GA sifiri icermez", r.ci[0] > 0, JSON.stringify(r.ci));
})();

(() => {
  // Ayni oranlar, kucuk orneklem → anlamsiz olmali.
  const r = E.twoProportionTest(4, 10, 6, 10, 0.05);
  ok("kucuk orneklem anlamli cikmaz", r.p > 0.05, "p=" + r.p);
  ok("anlamsiz sonucta GA sifiri icerir", r.ci[0] < 0 && r.ci[1] > 0);
})();

(() => {
  const r = E.twoProportionTest(50, 100, 50, 100, 0.05);
  yakin("fark yoksa z=0", r.z, 0, 1e-12);
  yakin("fark yoksa p=1", r.p, 1, 1e-12);
})();
ok("p-degeri asla 1'i asmaz", (() => {
  for (let z = -0.01; z <= 0.01; z += 0.0005) if (E.twoSidedP(z) > 1) return false;
  return true;
})());

// Welch: [1..5] vs [6..10] → t=5, df=8 (elle hesaplanabilir)
(() => {
  const r = E.welchTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], 0.05);
  yakin("welch: t", r.t, 5, 1e-12);
  yakin("welch: df", r.df, 8, 1e-12);
  yakin("welch: kontrol ortalamasi", r.baseline, 3, 1e-12);
  yakin("welch: deneme ortalamasi", r.treatment, 8, 1e-12);
  yakin("welch: standart sapma", r.sd1, Math.sqrt(2.5), 1e-12);
  ok("welch normal yaklasimi isaretli", r.normalApproximation === true);
})();
ok("welch: 2'den az ornek → null", E.welchTest([1], [2, 3], 0.05) === null);

// DEJENERE DURUM — ayrik metriklerde gercekten olusur ("herkes tam 1 oturum").
// Naif bir `se>0 ? t : 0` guardi burada net bir farki p=1 ile "fark yok"
// ilan eder; bu testler o hatanin geri gelmesini engeller.
(() => {
  const r = E.welchTest(Array(300).fill(4), Array(300).fill(2), 0.05);
  ok("welch: sifir varyans + gercek fark → 'fark yok' DEMEZ", r.p < 0.05, "p=" + r.p);
  ok("welch: dejenere durum isaretli", r.zeroVariance === true);
  ok("welch: dejenere durumda t sonsuz degil (Firestore icin)",
     r.t === null || Number.isFinite(r.t));
  yakin("welch: fark dogru", r.absoluteDiff, -2, 1e-12);
})();
(() => {
  const r = E.welchTest(Array(300).fill(4), Array(300).fill(4), 0.05);
  ok("welch: sifir varyans + fark yok → p=1", r.p === 1);
  ok("welch: gercekten ayni olunca dejenere isaretlenmez", r.zeroVariance === false);
})();

// Ornek buyuklugu: p1=0.20, mde=%10, alpha=0.05, power=0.80 → 6507/varyant
yakin("gereken ornek (oran)", E.requiredSampleForRate(0.20, 0.10, 0.05, 0.8), 6507, 1);
ok("daha buyuk etki → daha az ornek",
   E.requiredSampleForRate(0.20, 0.30, 0.05, 0.8) < E.requiredSampleForRate(0.20, 0.10, 0.05, 0.8));
ok("gecersiz girdi → null",
   E.requiredSampleForRate(0, 0.1, 0.05, 0.8) === null &&
   E.requiredSampleForRate(0.2, 0, 0.05, 0.8) === null);
ok("gereken ornek (ortalama) makul",
   E.requiredSampleForMean(10, 100, 0.05, 0.05, 0.8) > 0);

// ═══════════════════════════════════════════════════════════════════════════
baslik("6. Olay → oyuncu ozeti");
// ═══════════════════════════════════════════════════════════════════════════

const GUN = 86400000;
const T0 = Date.parse("2026-09-01T10:00:00Z");

function olay(pid, ad, ms, params, sid) {
  return { playerAnonId: pid, eventName: ad, timestampMs: ms,
           eventParams: params || {}, sessionId: sid || "s1" };
}

(() => {
  const olaylar = [
    // Maruz kalmadan ONCE — sayilmamali
    olay("p1", "level_complete", T0 - 5 * 60000),
    olay("p1", "iap_purchase_success", T0 - 60000, { amount_usd: 9.99 }),
    // Maruz kalma
    olay("p1", E.EXPOSURE_EVENT, T0, { experiment_id: "exp_1", variant: "treatment" }),
    // Sonra
    olay("p1", "level_start", T0 + 1000),
    olay("p1", "level_complete", T0 + 2000),
    olay("p1", "level_fail", T0 + 3000),
    olay("p1", "session_end", T0 + 4000, { duration_seconds: 300 }),
    olay("p1", "iap_purchase_success", T0 + 5000, { amount_usd: 4.99 }),
    olay("p1", "crash_detected", T0 + 6000),
    olay("p1", "rewarded_ad_watched", T0 + 7000),
    // Ertesi gun dondu
    olay("p1", "session_end", T0 + GUN + 1000, { duration_seconds: 100 }, "s2"),
  ];
  const simdi = T0 + 3 * GUN;
  const m = E.summarizePlayers(olaylar, simdi);
  const o = m.get("p1");

  ok("oyuncu ozeti olustu", !!o);
  ok("maruz kalma oncesi olaylar HARIC", o.purchases === 1 && o.revenue === 4.99,
     `purchases=${o.purchases} revenue=${o.revenue}`);
  ok("istemci varyanti okundu", o.clientVariant === "treatment");
  ok("bolum sayaclari dogru",
     o.levelStarts === 1 && o.levelCompletes === 1 && o.levelFails === 1);
  ok("oturum sureleri toplandi", o.sessionDurations.length === 2);
  ok("cokme sayildi", o.crashes === 1);
  ok("odullu reklam sayildi", o.rewardedAds === 1);
  ok("oturum kimlikleri tekil", o.sessions.size === 2, String(o.sessions.size));
  ok("D1 uygun (3 gun gecti)", o.d1Eligible === true);
  ok("D1 donusu tespit edildi", o.returnedD1 === true);
})();

(() => {
  // Dun maruz kalan oyuncu D1 icin HENUZ uygun degil.
  const dun = T0;
  const olaylar = [olay("p2", E.EXPOSURE_EVENT, dun, { variant: "control" })];
  const m = E.summarizePlayers(olaylar, dun + GUN + 3600000); // ~1.2 gun sonra
  ok("D1 penceresi kapanmadan uygun sayilmaz", m.get("p2").d1Eligible === false);

  const m2 = E.summarizePlayers(olaylar, dun + 2 * GUN + 1000);
  ok("D1 penceresi kapaninca uygun", m2.get("p2").d1Eligible === true);
})();

(() => {
  // Ayni oyuncu iki kez maruz kalirsa ILK maruz kalma gecerlidir.
  const olaylar = [
    olay("p3", E.EXPOSURE_EVENT, T0 + 10000, { variant: "control" }),
    olay("p3", E.EXPOSURE_EVENT, T0, { variant: "control" }),
    olay("p3", "level_complete", T0 + 5000),
  ];
  const o = E.summarizePlayers(olaylar, T0 + 3 * GUN).get("p3");
  ok("ilk maruz kalma kazanir", o.firstExposureMs === T0);
  ok("ilk maruz kalma sonrasi olay sayilir", o.levelCompletes === 1);
})();

ok("hic maruz kalmayan oyuncu ozete girmez",
   E.summarizePlayers([olay("p9", "level_complete", T0)], T0 + GUN).size === 0);

ok("sacma oturum suresi (>24sa) atilir", (() => {
  const o = E.summarizePlayers([
    olay("p4", E.EXPOSURE_EVENT, T0, { variant: "control" }),
    olay("p4", "session_end", T0 + 1000, { duration_seconds: 999999 }),
    olay("p4", "session_end", T0 + 2000, { duration_seconds: -5 }),
  ], T0 + 3 * GUN).get("p4");
  return o.sessionDurations.length === 0;
})());

// ═══════════════════════════════════════════════════════════════════════════
baslik("7. Analiz — karar kurallari");
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sentetik deney uretir. Oyuncular SUNUCU atamasindan gecer, yani gercek
 * kova mantigi test edilir — sahte gruplama degil.
 */
function sentetik(exp, nOyuncu, uretici, simdi) {
  const olaylar = [];
  for (let i = 0; i < nOyuncu; i++) {
    const pid = "sim-" + i;
    const v = E.assignVariant(exp, pid);
    if (!v) continue;
    olaylar.push(olay(pid, E.EXPOSURE_EVENT, T0, { variant: v }));
    for (const e of uretici(v, i, pid)) olaylar.push(e);
  }
  return E.analyzeExperiment(exp, E.summarizePlayers(olaylar, simdi), simdi);
}

const simdi = T0 + 5 * GUN;

// ── 7a. Gercek kazanan: deneme grubunda oturum suresi belirgin daha uzun
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_win", primaryMetric: "session_length_avg", minSamplePerVariant: 100,
  });
  // Deterministik "gurultu": oyuncu indeksine bagli, testin her kosuda ayni
  // sonucu vermesi icin rastgelelik YOK.
  const r = sentetik(exp, 1200, (v, i, pid) => [
    olay(pid, "session_end", T0 + 1000,
         { duration_seconds: (v === "treatment" ? 400 : 300) + (i % 40) }),
  ], simdi);
  ok("7a verdict = winner", r.verdict === "winner", r.verdict);
  ok("7a kazanan treatment", r.winner === "treatment", String(r.winner));
  ok("7a ornek yeterli", r.sufficientSample === true);
  ok("7a uyumsuzluk yok", r.mismatchedPlayers === 0);
  const t = r.metrics.session_length_avg.vs_control.treatment;
  ok("7a artis ~100sn", Math.abs(t.absoluteDiff - 100) < 5, String(t.absoluteDiff));
  ok("7a p cok kucuk", t.p < 0.001, String(t.p));
})();

// ── 7b. Gercekten fark yok → "no_difference" (yanlis pozitif uretmemeli)
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_null", primaryMetric: "session_length_avg", minSamplePerVariant: 100,
  });
  const r = sentetik(exp, 1200, (v, i, pid) => [
    olay(pid, "session_end", T0 + 1000, { duration_seconds: 300 + (i % 40) }),
  ], simdi);
  ok("7b verdict = no_difference", r.verdict === "no_difference", r.verdict);
  ok("7b kazanan yok", r.winner === null);
})();

// ── 7c. Kontrol kazanir (deneme kotulestirdi)
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_lose", primaryMetric: "sessions_per_player", minSamplePerVariant: 100,
  });
  // Gercekci varyans: her oyuncunun oturum sayisi farkli. (Sifir varyans
  // ozel durumu ayrica 5. bolumde test ediliyor.)
  const r = sentetik(exp, 1200, (v, i, pid) => {
    const n = (v === "treatment" ? 1 : 4) + (i % 3);
    const out = [];
    for (let k = 0; k < n; k++) out.push(olay(pid, "level_start", T0 + 1000 * k, {}, "s" + k));
    return out;
  }, simdi);
  ok("7c verdict = control_wins", r.verdict === "control_wins", r.verdict);
  ok("7c kazanan control", r.winner === "control");
})();

// ── 7d. Ornek yetersiz → kazanan ILAN EDILMEZ (erken bakma korumasi)
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_small", primaryMetric: "session_length_avg", minSamplePerVariant: 5000,
  });
  const r = sentetik(exp, 400, (v, i, pid) => [
    olay(pid, "session_end", T0 + 1000,
         { duration_seconds: (v === "treatment" ? 900 : 300) + (i % 10) }),
  ], simdi);
  ok("7d verdict = insufficient_sample", r.verdict === "insufficient_sample", r.verdict);
  ok("7d devasa etkiye ragmen kazanan ilan edilmez", r.winner === null);
  ok("7d ornek yetersiz isaretli", r.sufficientSample === false);
})();

// ── 7e. Guardrail ihlali → ornek yeterli olmasa bile durdurma sinyali
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_crash", primaryMetric: "sessions_per_player", minSamplePerVariant: 100000,
  });
  const r = sentetik(exp, 1200, (v, i, pid) => {
    const out = [olay(pid, "level_start", T0 + 1000)];
    // Deneme grubunda oyuncularin %40'i cokuyor, kontrolde %2.
    const cokuyor = v === "treatment" ? i % 5 < 2 : i % 50 === 0;
    if (cokuyor) out.push(olay(pid, "crash_detected", T0 + 2000));
    return out;
  }, simdi);
  ok("7e verdict = guardrail_breach", r.verdict === "guardrail_breach", r.verdict);
  ok("7e ihlal crash_free_rate'te", r.guardrailBreaches.some((x) => x.metric === "crash_free_rate"),
     JSON.stringify(r.guardrailBreaches.map((x) => x.metric)));
  ok("7e guardrail ornek yetersizligini EZER", r.sufficientSample === false);
})();

// ── 7f. Guardrail IYILESIRSE ihlal sayilmaz (tek yonlu olmali)
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_fix", primaryMetric: "sessions_per_player", minSamplePerVariant: 100,
  });
  const r = sentetik(exp, 1200, (v, i, pid) => {
    const out = [olay(pid, "level_start", T0 + 1000)];
    const cokuyor = v === "treatment" ? i % 50 === 0 : i % 5 < 2;   // deneme DAHA IYI
    if (cokuyor) out.push(olay(pid, "crash_detected", T0 + 2000));
    return out;
  }, simdi);
  ok("7f iyilesme ihlal sayilmaz", r.guardrailBreaches.length === 0,
     JSON.stringify(r.guardrailBreaches));
})();

// ── 7g. Istemci/sunucu atama uyusmazligi → sonuc "okunamaz" isaretlenir
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_tamper", primaryMetric: "session_length_avg", minSamplePerVariant: 10,
  });
  const olaylar = [];
  for (let i = 0; i < 600; i++) {
    const pid = "tam-" + i;
    const sunucu = E.assignVariant(exp, pid);
    if (!sunucu) continue;
    // Oyuncularin %30'u YANLIS varyant bildiriyor (bozuk istemci / kurcalama).
    const bildirilen = i % 10 < 3
      ? (sunucu === "control" ? "treatment" : "control")
      : sunucu;
    olaylar.push(olay(pid, E.EXPOSURE_EVENT, T0, { variant: bildirilen }));
    olaylar.push(olay(pid, "session_end", T0 + 1000, { duration_seconds: 300 }));
  }
  const r = E.analyzeExperiment(exp, E.summarizePlayers(olaylar, simdi), simdi);
  ok("7g verdict = assignment_mismatch", r.verdict === "assignment_mismatch", r.verdict);
  ok("7g uyumsuz oyuncular sayildi", r.mismatchedPlayers > 100, String(r.mismatchedPlayers));
  ok("7g uyumsuzluk orani ~%30", Math.abs(r.mismatchRate - 0.30) < 0.05,
     String(r.mismatchRate));
})();

// ── 7h. Varyant bildirmeyen istemci (eski SDK) analiz DISI kalmaz,
//        sunucu atamasi kullanilir.
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_noclient", primaryMetric: "session_length_avg", minSamplePerVariant: 100,
  });
  const olaylar = [];
  for (let i = 0; i < 800; i++) {
    const pid = "nc-" + i;
    const v = E.assignVariant(exp, pid);
    if (!v) continue;
    olaylar.push(olay(pid, E.EXPOSURE_EVENT, T0, {}));      // variant YOK
    olaylar.push(olay(pid, "session_end", T0 + 1000,
      { duration_seconds: (v === "treatment" ? 400 : 300) + (i % 30) }));
  }
  const r = E.analyzeExperiment(exp, E.summarizePlayers(olaylar, simdi), simdi);
  ok("7h uyumsuzluk sayilmaz", r.mismatchedPlayers === 0);
  ok("7h sunucu atamasiyla sonuc uretildi", r.verdict === "winner", r.verdict);
})();

// ── 7i. D1 metrigi: penceresi kapanmamis oyuncular paydaya GIRMEZ
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_d1", primaryMetric: "d1_return", minSamplePerVariant: 10,
  });
  const olaylar = [];
  // 200 oyuncu 5 gun once (uygun), 200 oyuncu bugun (uygun degil)
  for (let i = 0; i < 400; i++) {
    const pid = "d1-" + i;
    const v = E.assignVariant(exp, pid);
    if (!v) continue;
    const eskimi = i < 200;
    const ms = eskimi ? T0 : simdi - 3600000;
    olaylar.push(olay(pid, E.EXPOSURE_EVENT, ms, { variant: v }));
    if (eskimi && i % 3 === 0) olaylar.push(olay(pid, "level_start", ms + GUN + 1000));
  }
  const r = E.analyzeExperiment(exp, E.summarizePlayers(olaylar, simdi), simdi);
  const toplamD1 = Object.values(r.metrics.d1_return.n).reduce((a, b) => a + b, 0);
  ok("7i sadece penceresi kapanan oyuncular sayilir",
     toplamD1 > 150 && toplamD1 <= 200, "n=" + toplamD1);
  ok("7i maruz kalan toplam daha buyuk", r.exposedPlayers > toplamD1,
     `exposed=${r.exposedPlayers} d1n=${toplamD1}`);
})();

// ── 7j. Guardrail metrikleri istenmese bile HER ZAMAN hesaplanir
(() => {
  const exp = Object.assign({}, deney50, {
    id: "exp_gr", primaryMetric: "sessions_per_player", minSamplePerVariant: 10,
  });
  const r = sentetik(exp, 400, (v, i, pid) => [olay(pid, "level_start", T0 + 1000)], simdi);
  for (const g of E.GUARDRAIL_METRICS) {
    ok("7j guardrail hesaplandi: " + g, !!r.metrics[g]);
  }
})();

// ── 7k. Sifir maruz kalma → cokme yok, temiz sonuc
(() => {
  const exp = Object.assign({}, deney50, { id: "exp_empty", minSamplePerVariant: 10 });
  const r = E.analyzeExperiment(exp, new Map(), simdi);
  ok("7k bos deney coktrmez", r.verdict === "insufficient_sample", r.verdict);
  ok("7k maruz kalan = 0", r.exposedPlayers === 0);
})();

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(64));
if (kalan === 0) {
  console.log(`✅  TUM TESTLER GECTI — ${gecen} kontrol`);
} else {
  console.log(`❌  ${kalan} BASARISIZ / ${gecen + kalan} kontrol\n`);
  for (const h of hatalar) console.log("   ✗ " + h);
}
console.log("═".repeat(64));
process.exit(kalan === 0 ? 0 : 1);
