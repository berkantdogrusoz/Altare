/**
 * Altare — A/B Deney Motoru (saf matematik katmani)
 * ============================================================================
 *
 * Bu dosyada FIREBASE YOKTUR. Sebep: deney mantiginin kalbi (kova atamasi,
 * istatistiksel anlamlilik, karar kurallari) deploy etmeden, emulator
 * calistirmadan, tek bir `node` komutuyla test edilebilmelidir. Yanlis bir
 * z-testi canli oyuna yanlis config yazdirir; bu kodun test edilebilir olmasi
 * opsiyonel degildir.
 *
 * ---------------------------------------------------------------------------
 * TASARIM KARARLARI (neden boyle)
 * ---------------------------------------------------------------------------
 *
 * 1) ATAMA SUNUCU TARAFINDA YENIDEN HESAPLANABILIR.
 *    Atama, (experimentId, playerAnonId) ikilisinin saf bir fonksiyonudur.
 *    Sunucu her olayda playerAnonId'yi zaten biliyor, dolayisiyla oyuncunun
 *    hangi varyantta oldugunu istemci soylemese de hesaplayabilir. Bu,
 *    istemcinin yalan soylemesine karsi koruma saglar.
 *
 * 2) AMA ATAMA TEK BASINA YETMEZ — "EXPOSURE" SARTTIR.
 *    Sunucunun bir oyuncuyu B grubuna atamasi, o oyuncunun B degerlerini
 *    GERCEKTEN gordugu anlamina gelmez: eski bir istemci (ornegin guncellenmeyen
 *    ChopHero) Remote Config'i hic okumaz. Onlari deneye dahil etmek, etkiyi
 *    sulandirip her deneyi "fark yok" gosterir (dilution bias).
 *    Bu yuzden oyuncu ancak istemci `altare_experiment_exposure` olayini
 *    gonderirse deneye GIRER. Sektor standardi budur (exposure/activation event).
 *
 * 3) ANALIZ BIRIMI OYUNCUDUR, OLAY DEGIL.
 *    Olay bazinda test yapmak sahte bagimsizlik (pseudo-replication) uretir:
 *    100 oturum acan tek bir oyuncu, 100 farkli oyuncu gibi sayilir ve p-degeri
 *    yapay olarak kucuk cikar. Her metrik once oyuncu basina tek bir sayiya
 *    indirgenir, test o sayilar uzerinde yapilir.
 *
 * 4) ERKEN BAKMA (peeking) ENGELLENIR.
 *    p-degerine her gun bakip "anlamli oldu" demek yanlis pozitif oranini
 *    %5'ten %20'lere cikarir. Bu yuzden minimum ornek buyuklugune ULASILMADAN
 *    kazanan ILAN EDILMEZ; o ana kadarki sonuc "bilgi amacli" isaretlenir.
 *
 * 5) GUARDRAIL'LER TEK YONLU VE DAHA KATIDIR.
 *    Kazanan ilan etmek icin p<0.05 ararken, deneyi guvenlik gerekcesiyle
 *    otomatik durdurmak icin p<0.01 aranir. Sebep asimetrik: iyi bir deneyi
 *    gurultuden dolayi durdurmak, kotu bir deneyi bir gun fazla calistirmaktan
 *    daha maliyetlidir (her durdurma guveni asindirir).
 */

"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// 1. DETERMINISTIK KOVA ATAMASI
//    C# karsiligi: unity-sdk/AltareExperiments.cs — IKISI BIT BIT AYNI
//    SONUCU URETMEK ZORUNDADIR. Degistirirsen iki tarafi birden degistir ve
//    tools/test-experiments.js parite testini calistir.
// ═══════════════════════════════════════════════════════════════════════════

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
/** Kova cozunurlugu: %0.01 hassasiyet. */
const BUCKET_SPACE = 10000;

/**
 * FNV-1a 32-bit. UTF-8 baytlari uzerinden calisir.
 * C# tarafinda `uint` aritmetigi dogal olarak mod 2^32'dir; burada
 * Math.imul + >>> 0 ile ayni davranis saglanir.
 */
function fnv1a32(str) {
  const bytes = Buffer.from(String(str), "utf8");
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ bytes[i]) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** Deneye GIRIS kovasi (0..9999). */
function exposureBucket(experimentId, playerAnonId) {
  return fnv1a32(experimentId + ":" + playerAnonId) % BUCKET_SPACE;
}

/**
 * Varyant kovasi (0..9999) — giris kovasindan AYRI hash.
 * Neden ayri: ayni hash kullanilsaydi exposurePct degistiginde varyant
 * dagilimi da kayardi ve "%10 ile basla, %50'ye cik" senaryosunda oyuncular
 * varyant degistirirdi.
 */
function variantBucket(experimentId, playerAnonId) {
  return fnv1a32(experimentId + "#" + playerAnonId) % BUCKET_SPACE;
}

/**
 * Bir oyuncunun varyantini hesaplar.
 * @returns {string|null} varyant key'i, ya da oyuncu deney disindaysa null.
 */
function assignVariant(exp, playerAnonId) {
  if (!exp || !exp.id || !playerAnonId) return null;
  const variants = Array.isArray(exp.variants) ? exp.variants : [];
  if (variants.length < 2) return null;

  const pct = Number(exp.exposurePct);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const girisEsigi = Math.round(Math.min(100, pct) * (BUCKET_SPACE / 100));
  if (exposureBucket(exp.id, playerAnonId) >= girisEsigi) return null;

  const ic = variantBucket(exp.id, playerAnonId);
  let kumulatif = 0;
  for (const v of variants) {
    kumulatif += Math.round(Number(v.allocation || 0) * (BUCKET_SPACE / 100));
    if (ic < kumulatif) return v.key;
  }
  // Yuvarlama artigi: son varyanta dus (tahsisler 100'e toplanmali, dogrulama
  // bunu zaten zorunlu kiliyor — bu sadece savunma amacli).
  return variants[variants.length - 1].key;
}

/**
 * Bir oyuncu icin nihai config degerlerini uretir:
 * taban degerler + (varsa) varyantin uzerine yazdigi degerler.
 */
function resolveValues(baseValues, exp, playerAnonId) {
  const out = Object.assign({}, baseValues || {});
  const key = assignVariant(exp, playerAnonId);
  if (!key) return { values: out, variant: null };
  const v = (exp.variants || []).find((x) => x.key === key);
  if (v && v.values) Object.assign(out, v.values);
  return { values: out, variant: key };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. DENEY TANIMI DOGRULAMA
//    Kural: CALISIRKEN TANIM DEGISMEZ. Sunucunun atamayi sonradan yeniden
//    hesaplayabilmesi buna dayanir; exposurePct veya tahsisler degisirse
//    gecmis olaylar yanlis varyanta atfedilir ve sonuc sessizce bozulur.
// ═══════════════════════════════════════════════════════════════════════════

/** Tanim degistiginde atamayi bozan alanlar — bunlar dondurulur. */
const IMMUTABLE_FIELDS = ["exposurePct", "variants"];

/**
 * Yuzde degeri %0.01 izgarasina oturuyor mu?
 *
 * NEDEN VAR — bu bir uslup kurali degil, PARITE KORUMASIDIR:
 * atama esigi `round(pct * 100)` ile hesaplanir ve bu yuvarlama uc ayri
 * dilde yapilir. Tam yarim degerde (orn. 1250.5) uc dil UC FARKLI sonuc
 * verir: JS Math.round yukari, C# MidpointRounding.AwayFromZero disariya,
 * Python round() cift sayiya (banker's rounding). Boyle bir sapma istemci
 * ile sunucuyu ayri kovalara dusurur ve deney sessizce anlamsizlasir.
 * Girdiyi izgaraya zorlayarak yarim deger olasiligini tamamen kaldiriyoruz —
 * yuvarlama davranisini uc dilde eslestirmeye calismaktan cok daha saglam.
 */
function izgaradaMi(x) {
  return Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;
}

function validateExperiment(exp) {
  const hatalar = [];
  if (!exp || typeof exp !== "object") return ["experiment govde yok"];

  if (!exp.name || String(exp.name).trim().length < 3) {
    hatalar.push("name en az 3 karakter olmali");
  }

  const pct = Number(exp.exposurePct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    hatalar.push("exposurePct 0-100 arasi olmali");
  } else if (!izgaradaMi(pct)) {
    hatalar.push("exposurePct en fazla 2 ondalik basamak olmali (%0.01 adimi): " + pct);
  }

  const variants = Array.isArray(exp.variants) ? exp.variants : [];
  if (variants.length < 2) {
    hatalar.push("en az 2 varyant gerekli (kontrol + en az bir deneme)");
  } else {
    const keyler = new Set();
    let toplam = 0;
    for (const v of variants) {
      if (!v || typeof v.key !== "string" || !/^[a-z0-9_]{1,24}$/.test(v.key)) {
        hatalar.push("varyant key'i a-z0-9_ olmali (max 24): " + JSON.stringify(v && v.key));
        continue;
      }
      if (keyler.has(v.key)) hatalar.push("varyant key'i tekrar ediyor: " + v.key);
      keyler.add(v.key);
      const a = Number(v.allocation);
      if (!Number.isFinite(a) || a <= 0) hatalar.push(`varyant ${v.key}: allocation > 0 olmali`);
      else {
        toplam += a;
        if (!izgaradaMi(a)) {
          hatalar.push(`varyant ${v.key}: allocation en fazla 2 ondalik basamak olmali (%0.01 adimi)`);
        }
      }
      if (v.values && (typeof v.values !== "object" || Array.isArray(v.values))) {
        hatalar.push(`varyant ${v.key}: values duz bir nesne olmali`);
      }
    }
    if (Math.abs(toplam - 100) > 0.01) {
      hatalar.push(`tahsisler 100'e toplanmali (su an ${toplam})`);
    }
    if (!keyler.has("control")) {
      hatalar.push("bir varyantin key'i 'control' olmali (referans grubu)");
    }
    // Kontrol grubu tanim geregi MEVCUT DURUMDUR: uzerine deger yazamaz.
    const kontrol = variants.find((v) => v && v.key === "control");
    if (kontrol && kontrol.values && Object.keys(kontrol.values).length > 0) {
      hatalar.push("kontrol grubu deger degistiremez — 'control.values' bos olmali");
    }
  }

  if (!exp.primaryMetric || !METRICS[exp.primaryMetric]) {
    hatalar.push("primaryMetric taninmiyor: " + String(exp.primaryMetric));
  }
  const minN = Number(exp.minSamplePerVariant);
  if (!Number.isFinite(minN) || minN < 1) {
    hatalar.push("minSamplePerVariant >= 1 olmali");
  }
  return hatalar;
}

/** Calisan bir deneyde hangi alanlar degistirilmis? */
function frozenFieldChanges(eski, yeni) {
  const degisen = [];
  for (const f of IMMUTABLE_FIELDS) {
    if (JSON.stringify(eski[f]) !== JSON.stringify(yeni[f])) degisen.push(f);
  }
  return degisen;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ISTATISTIK
//    Harici bagimlilik yok — Cloud Functions'a scipy kurulamaz.
// ═══════════════════════════════════════════════════════════════════════════

/** Abramowitz & Stegun 7.1.26 — mutlak hata < 1.5e-7. */
function erf(x) {
  // Yaklasim x=0'da tam sifir vermez (~5e-10 artik birakir); bu da p-degerinin
  // 1'i asmasina yol acabilir ve raporda hata gibi gorunur. Orijini sabitle.
  if (x === 0) return 0;
  const isaret = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return isaret * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Iki yonlu p-degeri. Yaklasim artigi yuzunden [0,1] disina tasmasin. */
function twoSidedP(z) {
  if (!Number.isFinite(z)) return 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * Ters normal (Acklam yaklasimi) — ornek buyuklugu hesabinda z_(1-a/2) ve
 * z_power icin gerekir. Bagil hata < 1.15e-9.
 */
function inverseNormalCdf(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
             -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
             3.754408661907416e0];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Iki oran testi (pooled z). Guven araligi UNPOOLED standart hatayla
 * hesaplanir — dogru kombinasyon budur: test H0 altinda havuzlanmis
 * varyansi kullanir, aralik ise gozlenen varyanslari.
 */
function twoProportionTest(x1, n1, x2, n2, alpha) {
  if (!(n1 > 0 && n2 > 0)) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const fark = p2 - p1;

  const pHavuz = (x1 + x2) / (n1 + n2);
  const seHavuz = Math.sqrt(pHavuz * (1 - pHavuz) * (1 / n1 + 1 / n2));
  // seHavuz = 0 ancak pHavuz 0 veya 1 iken olur; her iki durumda da iki oran
  // esittir (herkes 0 ya da herkes 1), yani fark zaten 0'dir. Oranlarda
  // Welch'teki dejenere durum ortaya cikmaz.
  const z = seHavuz > 0 ? fark / seHavuz : 0;

  const seAyri = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const zKritik = inverseNormalCdf(1 - (alpha || 0.05) / 2);

  return {
    test: "two_proportion_z",
    baseline: p1, treatment: p2,
    absoluteDiff: fark,
    relativeLift: p1 > 0 ? fark / p1 : null,
    z, p: twoSidedP(z),
    ci: [fark - zKritik * seAyri, fark + zKritik * seAyri],
    n1, n2,
  };
}

/**
 * Welch t-testi (esit olmayan varyans). p-degeri normal yaklasimla
 * hesaplanir; df >= 30'da fark 4. haneden sonradir, minSamplePerVariant
 * zaten bunun cok uzerindedir. df yine de raporlanir ki kucuk orneklemde
 * sonucun okunusu bilinsin.
 */
function welchTest(orn1, orn2, alpha) {
  const n1 = orn1.length, n2 = orn2.length;
  if (n1 < 2 || n2 < 2) return null;

  const ort = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const m1 = ort(orn1), m2 = ort(orn2);
  const vari = (a, m) => a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
  const s1 = vari(orn1, m1), s2 = vari(orn2, m2);

  const se = Math.sqrt(s1 / n1 + s2 / n2);
  const fark = m2 - m1;

  // DEJENERE DURUM — her iki grupta da varyans sifir.
  // Ayrik metriklerde gercekten olur ("her oyuncu tam 1 oturum acti").
  // Burada t = fark/0'dir; naif bir `se>0 ? t : 0` guardi net bir farki
  // p=1 ile "fark yok" ilan eder — sessiz ve tehlikeli bir hata.
  // Dogrusu: fark sifirsa gercekten fark yoktur; fark varsa gruplar tam
  // ayrismistir (p→0), ama klasik normal-teori testi burada gecerli
  // olmadigi icin sonuc ISARETLENIR ve t sonsuz degil null dondurulur
  // (Firestore Infinity kabul etmez).
  let t = null, p, dejenere = false;
  if (se > 0) {
    t = fark / se;
    p = twoSidedP(t);
  } else if (fark === 0) {
    t = 0; p = 1;
  } else {
    dejenere = true; p = 0;
  }

  const pay = Math.pow(s1 / n1 + s2 / n2, 2);
  const payda = Math.pow(s1 / n1, 2) / (n1 - 1) + Math.pow(s2 / n2, 2) / (n2 - 1);
  const df = payda > 0 ? pay / payda : n1 + n2 - 2;

  const zKritik = inverseNormalCdf(1 - (alpha || 0.05) / 2);
  return {
    test: "welch_t",
    baseline: m1, treatment: m2,
    absoluteDiff: fark,
    relativeLift: m1 !== 0 ? fark / Math.abs(m1) : null,
    sd1: Math.sqrt(s1), sd2: Math.sqrt(s2),
    t, df, p,
    ci: [fark - zKritik * se, fark + zKritik * se],
    n1, n2,
    normalApproximation: true,
    zeroVariance: dejenere,
  };
}

/**
 * Oran metrigi icin varyant basina gereken ornek buyuklugu.
 * mde = tespit edilmek istenen BAGIL degisim (0.10 = %10 iyilesme).
 */
function requiredSampleForRate(baselineRate, mde, alpha, power) {
  const p1 = Number(baselineRate);
  if (!(p1 > 0 && p1 < 1) || !(mde > 0)) return null;
  const p2 = Math.min(0.999999, p1 * (1 + mde));
  const za = inverseNormalCdf(1 - (alpha || 0.05) / 2);
  const zb = inverseNormalCdf(power || 0.8);
  const n = (Math.pow(za + zb, 2) * (p1 * (1 - p1) + p2 * (1 - p2))) /
            Math.pow(p2 - p1, 2);
  return Math.ceil(n);
}

/** Ortalama metrigi icin varyant basina gereken ornek buyuklugu. */
function requiredSampleForMean(sd, baselineMean, mde, alpha, power) {
  const delta = Math.abs(Number(baselineMean) * Number(mde));
  if (!(sd > 0) || !(delta > 0)) return null;
  const za = inverseNormalCdf(1 - (alpha || 0.05) / 2);
  const zb = inverseNormalCdf(power || 0.8);
  return Math.ceil((2 * Math.pow(za + zb, 2) * sd * sd) / (delta * delta));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. METRIK KAYIT DEFTERI
//    Her metrik: oyuncu basina TEK bir sayiya indirgenir.
//    - type "rate": oyuncu ya sagladi ya saglamadi (0/1) -> iki oran testi
//    - type "mean": oyuncu basina surekli deger        -> Welch t
//    - eligible:   oyuncu bu metrige dahil mi (orn. D1 icin 1 gun gecmis mi)
//    - higherIsBetter: yonu; guardrail otomatik durdurmasi buna bakar
//    - guardrail: kotulesmesi deneyi durdurur
// ═══════════════════════════════════════════════════════════════════════════

const METRICS = {
  crash_free_rate: {
    type: "rate", higherIsBetter: true, guardrail: true,
    label_tr: "Çökmesiz oyuncu oranı", label_en: "Crash-free player rate",
    eligible: (o) => o.eventCount > 0,
    value: (o) => (o.crashes + o.anrs === 0 ? 1 : 0),
  },
  d1_return: {
    type: "rate", higherIsBetter: true, guardrail: false,
    label_tr: "Ertesi gün dönüş (D1)", label_en: "Next-day return (D1)",
    // Sadece maruz kaldigi gunun ERTESI GUNU GECMIS oyuncular sayilir;
    // dun deneye giren bir oyuncu "donmedi" sayilamaz.
    eligible: (o) => o.d1Eligible === true,
    value: (o) => (o.returnedD1 ? 1 : 0),
  },
  iap_conversion: {
    type: "rate", higherIsBetter: true, guardrail: false,
    label_tr: "IAP dönüşüm oranı", label_en: "IAP conversion rate",
    eligible: (o) => o.eventCount > 0,
    value: (o) => (o.purchases > 0 ? 1 : 0),
  },
  rewarded_ad_engagement: {
    type: "rate", higherIsBetter: true, guardrail: false,
    label_tr: "Ödüllü reklam izleme oranı", label_en: "Rewarded ad engagement",
    eligible: (o) => o.eventCount > 0,
    value: (o) => (o.rewardedAds > 0 ? 1 : 0),
  },
  session_length_avg: {
    type: "mean", higherIsBetter: true, guardrail: true,
    label_tr: "Ortalama oturum süresi (sn)", label_en: "Avg session length (s)",
    eligible: (o) => o.sessionDurations.length > 0,
    value: (o) => o.sessionDurations.reduce((s, v) => s + v, 0) / o.sessionDurations.length,
  },
  sessions_per_player: {
    type: "mean", higherIsBetter: true, guardrail: false,
    label_tr: "Oyuncu başına oturum", label_en: "Sessions per player",
    eligible: (o) => o.eventCount > 0,
    value: (o) => o.sessions.size,
  },
  levels_completed: {
    type: "mean", higherIsBetter: true, guardrail: false,
    label_tr: "Tamamlanan bölüm sayısı", label_en: "Levels completed",
    eligible: (o) => o.levelStarts > 0,
    value: (o) => o.levelCompletes,
  },
  level_fail_rate: {
    type: "mean", higherIsBetter: false, guardrail: false,
    label_tr: "Bölüm başarısızlık oranı", label_en: "Level fail rate",
    eligible: (o) => o.levelStarts > 0,
    value: (o) => o.levelFails / o.levelStarts,
  },
  revenue_per_player: {
    type: "mean", higherIsBetter: true, guardrail: true,
    label_tr: "Oyuncu başına gelir (USD)", label_en: "Revenue per player (USD)",
    eligible: (o) => o.eventCount > 0,
    value: (o) => o.revenue,
    // Gelir agir kuyrukludur (tek balina ortalamayi tasir); t-testi burada
    // zayiftir. Rapor bunu acikca yazar.
    heavyTailed: true,
  },
};

const GUARDRAIL_METRICS = Object.keys(METRICS).filter((k) => METRICS[k].guardrail);

// ═══════════════════════════════════════════════════════════════════════════
// 5. OLAYLARI OYUNCU BASINA OZETE INDIRGEME
// ═══════════════════════════════════════════════════════════════════════════

const EXPOSURE_EVENT = "altare_experiment_exposure";

function bosOzet() {
  return {
    firstExposureMs: null,
    exposureDay: null,
    clientVariant: null,
    sessions: new Set(),
    sessionDurations: [],
    activeDays: new Set(),
    crashes: 0, anrs: 0,
    purchases: 0, revenue: 0,
    rewardedAds: 0,
    levelStarts: 0, levelCompletes: 0, levelFails: 0,
    eventCount: 0,
    d1Eligible: false,
    returnedD1: false,
  };
}

function gunAnahtari(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function gunEkle(key, n) {
  const t = Date.parse(key + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

function olayMs(e) {
  const t = e && (e.timestampMs != null ? e.timestampMs : e.clientTimestampMs);
  return Number.isFinite(Number(t)) ? Number(t) : null;
}

/**
 * Olaylari oyuncu basina ozete cevirir.
 *
 * KRITIK KURAL: bir oyuncunun metrikleri YALNIZCA deneye maruz kaldigi
 * andan SONRAKI olaylardan hesaplanir. Aksi halde deneyden onceki davranis
 * sonuca karisir ve etki olculemez.
 *
 * @param {Array} events  Normalize edilmis olaylar:
 *                        { playerAnonId, eventName, eventParams, timestampMs, sessionId }
 * @param {number} simdiMs  "Su an" — D1 uygunlugu icin.
 */
function summarizePlayers(events, simdiMs) {
  const simdi = Number.isFinite(simdiMs) ? simdiMs : Date.now();
  const oyuncular = new Map();

  // 1. GECIS: maruz kalma anlarini bul (ilk exposure kazanir).
  for (const e of events) {
    if (!e || e.eventName !== EXPOSURE_EVENT) continue;
    const pid = e.playerAnonId;
    const ms = olayMs(e);
    if (!pid || ms == null) continue;
    let o = oyuncular.get(pid);
    if (!o) { o = bosOzet(); oyuncular.set(pid, o); }
    if (o.firstExposureMs == null || ms < o.firstExposureMs) {
      o.firstExposureMs = ms;
      o.exposureDay = gunAnahtari(ms);
      const p = e.eventParams || {};
      o.clientVariant = p.variant != null ? String(p.variant) : null;
    }
  }

  // D1 uygunlugu: maruz kalma gunu + 1 TAMAMEN gecmis olmali.
  for (const o of oyuncular.values()) {
    if (o.exposureDay == null) continue;
    const d1 = gunEkle(o.exposureDay, 1);
    const d2Baslangic = Date.parse(gunEkle(o.exposureDay, 2) + "T00:00:00Z");
    o.d1Eligible = Number.isFinite(d2Baslangic) && simdi >= d2Baslangic;
    o._d1Gun = d1;
  }

  // 2. GECIS: maruz kalma sonrasi olaylari topla.
  for (const e of events) {
    if (!e) continue;
    const pid = e.playerAnonId;
    const o = pid ? oyuncular.get(pid) : null;
    if (!o || o.firstExposureMs == null) continue;
    const ms = olayMs(e);
    if (ms == null || ms < o.firstExposureMs) continue;

    o.eventCount++;
    if (e.sessionId) o.sessions.add(e.sessionId);
    const gun = gunAnahtari(ms);
    o.activeDays.add(gun);
    if (o._d1Gun && gun === o._d1Gun) o.returnedD1 = true;

    const p = e.eventParams || {};
    switch (e.eventName) {
      case "crash_detected": o.crashes++; break;
      case "anr_detected": o.anrs++; break;
      case "rewarded_ad_watched": o.rewardedAds++; break;
      case "level_start": o.levelStarts++; break;
      case "level_complete": o.levelCompletes++; break;
      case "level_fail": o.levelFails++; break;
      case "iap_purchase_success": {
        o.purchases++;
        const tutar = parseFloat(
          p.amount_usd != null ? p.amount_usd :
          p.amount != null ? p.amount :
          p.price_usd != null ? p.price_usd :
          p.price != null ? p.price :
          p.value != null ? p.value :
          p.revenue != null ? p.revenue : 0
        );
        if (Number.isFinite(tutar) && tutar > 0) o.revenue += tutar;
        break;
      }
      case "session_end": {
        const sn = parseFloat(
          p.duration_seconds != null ? p.duration_seconds :
          p.duration != null ? p.duration :
          p.session_duration != null ? p.session_duration :
          p.duration_s != null ? p.duration_s : 0
        );
        if (Number.isFinite(sn) && sn > 0 && sn < 86400) o.sessionDurations.push(sn);
        break;
      }
      default: break;
    }
  }

  return oyuncular;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. ANALIZ
// ═══════════════════════════════════════════════════════════════════════════

const ALPHA = 0.05;
/** Guardrail otomatik durdurmasi icin daha kati esik (bkz. dosya basi #5). */
const GUARDRAIL_ALPHA = 0.01;

/**
 * Deneyi analiz eder.
 *
 * @param {object} exp      Dondurulmus deney tanimi.
 * @param {Map} oyuncular   summarizePlayers ciktisi.
 * @param {number} simdiMs
 * @returns rapor nesnesi
 */
function analyzeExperiment(exp, oyuncular, simdiMs) {
  const varyantlar = (exp.variants || []).map((v) => v.key);
  const kontrol = "control";
  const denemeler = varyantlar.filter((k) => k !== kontrol);

  // Atama: SUNUCU otoritedir. Istemcinin bildirdigi varyant sadece
  // dogrulama icindir — uyusmazlik ya istemci hatasi ya da kurcalamadir,
  // her iki durumda da o oyuncu analiz disi birakilir ve sayilir.
  const gruplar = new Map(varyantlar.map((k) => [k, []]));
  let uyumsuz = 0;
  let atanmamis = 0;

  for (const [pid, o] of oyuncular) {
    if (o.firstExposureMs == null) continue;
    const sunucu = assignVariant(exp, pid);
    if (!sunucu) { atanmamis++; continue; }
    if (o.clientVariant && o.clientVariant !== sunucu) { uyumsuz++; continue; }
    const g = gruplar.get(sunucu);
    if (g) g.push(o);
  }

  const toplamMaruz = Array.from(gruplar.values()).reduce((s, a) => s + a.length, 0);
  const uyumsuzlukOrani = toplamMaruz + uyumsuz > 0
    ? uyumsuz / (toplamMaruz + uyumsuz) : 0;

  // Hangi metrikler olculecek: birincil + tum guardrail'ler + istenen ikincil.
  const istenen = new Set([exp.primaryMetric].concat(GUARDRAIL_METRICS)
    .concat(Array.isArray(exp.secondaryMetrics) ? exp.secondaryMetrics : []));

  const sonuclar = {};
  for (const mKey of istenen) {
    const m = METRICS[mKey];
    if (!m) continue;
    const perVaryant = {};
    for (const vk of varyantlar) {
      const uygun = (gruplar.get(vk) || []).filter((o) => m.eligible(o));
      perVaryant[vk] = { ornekler: uygun.map((o) => m.value(o)), n: uygun.length };
    }
    const kontrolOrn = perVaryant[kontrol] ? perVaryant[kontrol].ornekler : [];

    const karsilastirmalar = {};
    for (const vk of denemeler) {
      const denemeOrn = perVaryant[vk].ornekler;
      let test = null;
      if (m.type === "rate") {
        const x1 = kontrolOrn.reduce((s, v) => s + v, 0);
        const x2 = denemeOrn.reduce((s, v) => s + v, 0);
        test = twoProportionTest(x1, kontrolOrn.length, x2, denemeOrn.length, ALPHA);
      } else {
        test = welchTest(kontrolOrn, denemeOrn, ALPHA);
      }
      if (test) {
        test.higherIsBetter = m.higherIsBetter;
        test.improved = m.higherIsBetter
          ? test.absoluteDiff > 0
          : test.absoluteDiff < 0;
        if (m.heavyTailed) test.heavyTailedWarning = true;
      }
      karsilastirmalar[vk] = test;
    }

    sonuclar[mKey] = {
      type: m.type,
      label_tr: m.label_tr, label_en: m.label_en,
      higherIsBetter: m.higherIsBetter,
      guardrail: !!m.guardrail,
      n: Object.fromEntries(varyantlar.map((vk) => [vk, perVaryant[vk].n])),
      vs_control: karsilastirmalar,
    };
  }

  // ── Karar ──
  const minN = Number(exp.minSamplePerVariant) || 0;
  const birincil = sonuclar[exp.primaryMetric];
  const birincilN = birincil ? Object.values(birincil.n) : [];
  const yeterliOrnek = birincilN.length > 0 && birincilN.every((n) => n >= minN);

  // Guardrail ihlali: herhangi bir guardrail metriginde ISTATISTIKSEL OLARAK
  // ANLAMLI KOTULESME. Ornek yetersizligi burada beklenmez — guvenlik
  // sinyali gecikmemelidir; buna karsilik esik daha katidir (0.01).
  const ihlaller = [];
  for (const mKey of GUARDRAIL_METRICS) {
    const r = sonuclar[mKey];
    if (!r) continue;
    for (const vk of denemeler) {
      const t = r.vs_control[vk];
      if (!t) continue;
      if (!t.improved && t.p < GUARDRAIL_ALPHA) {
        ihlaller.push({
          metric: mKey, variant: vk, p: t.p,
          baseline: t.baseline, treatment: t.treatment,
          label_tr: r.label_tr, label_en: r.label_en,
        });
      }
    }
  }

  let verdict, winner = null;
  if (ihlaller.length > 0) {
    verdict = "guardrail_breach";
  } else if (uyumsuzlukOrani > 0.05) {
    // Istemci/sunucu atamasi tutmuyorsa sonuc OKUNAMAZ. Sessizce "fark yok"
    // demek en tehlikeli hata olurdu.
    verdict = "assignment_mismatch";
  } else if (!yeterliOrnek) {
    verdict = "insufficient_sample";
  } else {
    const kazananlar = denemeler.filter((vk) => {
      const t = birincil && birincil.vs_control[vk];
      return t && t.p < ALPHA && t.improved;
    });
    const kaybedenler = denemeler.filter((vk) => {
      const t = birincil && birincil.vs_control[vk];
      return t && t.p < ALPHA && !t.improved;
    });
    if (kazananlar.length > 0) {
      verdict = "winner";
      // Birden fazla kazanan varsa en buyuk etkiyi sec.
      winner = kazananlar.sort((a, b) => {
        const ta = birincil.vs_control[a], tb = birincil.vs_control[b];
        return Math.abs(tb.absoluteDiff) - Math.abs(ta.absoluteDiff);
      })[0];
    } else if (kaybedenler.length === denemeler.length) {
      verdict = "control_wins";
      winner = kontrol;
    } else {
      verdict = "no_difference";
    }
  }

  // Kalan ornek ihtiyaci — "daha ne kadar beklemeliyim?" sorusunun cevabi.
  let gerekenN = null;
  if (birincil && exp.mde) {
    const m = METRICS[exp.primaryMetric];
    const kt = birincil.vs_control[denemeler[0]];
    if (kt) {
      gerekenN = m.type === "rate"
        ? requiredSampleForRate(kt.baseline, exp.mde, ALPHA, 0.8)
        : requiredSampleForMean(kt.sd1, kt.baseline, exp.mde, ALPHA, 0.8);
    }
  }

  return {
    computedAt: new Date(simdiMs || Date.now()).toISOString(),
    exposedPlayers: toplamMaruz,
    perVariantExposed: Object.fromEntries(
      varyantlar.map((vk) => [vk, (gruplar.get(vk) || []).length])
    ),
    mismatchedPlayers: uyumsuz,
    mismatchRate: uyumsuzlukOrani,
    unassignedExposures: atanmamis,
    primaryMetric: exp.primaryMetric,
    minSamplePerVariant: minN,
    sufficientSample: yeterliOrnek,
    requiredSamplePerVariant: gerekenN,
    metrics: sonuclar,
    guardrailBreaches: ihlaller,
    verdict,
    winner,
    alpha: ALPHA,
    guardrailAlpha: GUARDRAIL_ALPHA,
  };
}

module.exports = {
  // atama
  fnv1a32, exposureBucket, variantBucket, assignVariant, resolveValues,
  BUCKET_SPACE,
  // dogrulama
  validateExperiment, frozenFieldChanges, IMMUTABLE_FIELDS,
  // istatistik
  erf, normalCdf, twoSidedP, inverseNormalCdf,
  twoProportionTest, welchTest,
  requiredSampleForRate, requiredSampleForMean,
  // metrik + analiz
  METRICS, GUARDRAIL_METRICS, EXPOSURE_EVENT,
  summarizePlayers, analyzeExperiment,
  ALPHA, GUARDRAIL_ALPHA,
  // yardimci (test icin)
  gunAnahtari, gunEkle,
};
