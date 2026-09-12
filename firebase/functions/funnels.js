/**
 * Altare — Huni (funnel) dönüşüm analizi (saf matematik katmanı)
 * ============================================================================
 *
 * Bu dosyada FIREBASE YOKTUR — `node tools/test-funnels.js` ile doğrudan
 * test edilir. Sebep: huni sayıları müşterinin "oyuncular nerede kopuyor"
 * kararını doğrudan yönlendirir; yanlış bir sayı yanlış bir bölüm tasarımına
 * yol açar.
 *
 * ---------------------------------------------------------------------------
 * TASARIM KARARLARI (neden böyle)
 * ---------------------------------------------------------------------------
 *
 * 1) HUNİ BİR KÜME KESİŞİMİ DEĞİL, SIRALI BİR YOLDUR.
 *    "IAP satın alan oyuncu sayısı" ile "mağazayı gördükten SONRA satın alan
 *    oyuncu sayısı" farklı şeylerdir. Adım N, adım N-1'den SONRA gerçekleşmiş
 *    olmak zorundadır; aksi halde mağazayı hiç görmemiş bir oyuncu
 *    "dönüştü" sayılır ve huni anlamsızlaşır.
 *
 * 2) ⚠ OLGUNLAŞMA TUZAĞI — RETENTION'DAKİ KOHORT TUZAĞININ AYNISI.
 *    Huniye 10 dakika önce giren bir oyuncu, henüz bitirmeye VAKTİ olmadığı
 *    için "koptu" sayılamaz. Sayılırsa dönüşüm oranı yapay olarak düşük
 *    çıkar — ve en kötüsü, makul görünen bir yanlış sayı üretir.
 *    Bu yüzden yalnızca PENCERESİ KAPANMIŞ oyuncular orana girer; hâlâ
 *    içeride olanlar `inProgress` olarak ayrıca raporlanır ki kullanıcı
 *    n'in neden küçük olduğunu görsün.
 *
 * 3) PENCERE ZORUNLU.
 *    Adım 1'i Ocak'ta, adım 2'yi Mart'ta yapan oyuncu "dönüştü" sayılmamalı.
 *    Her adım, oyuncunun adım-1 anından en fazla `windowHours` sonra
 *    gerçekleşmiş olmalıdır.
 *
 * 4) İLK GERÇEKLEŞME KURALI.
 *    Adım N için, adım N-1'den sonraki EN ERKEN olay alınır (standart
 *    "ilk yol" tanımı). Böylece tek bir oyuncunun aynı adımı tekrar tekrar
 *    yapması sayıyı şişirmez.
 *
 * 5) ANALİZ BİRİMİ OYUNCU.
 *    Olay bazında sayım, çok oynayan oyuncuyu birden fazla kez sayar.
 */

"use strict";

/** Adım başına ölçülecek azami oyuncu — maliyet tavanı. */
const MAX_PLAYERS = 20000;
/** Varsayılan pencere: 7 gün. Onboarding hunileri için genelde fazlasıyla yeterli. */
const DEFAULT_WINDOW_HOURS = 168;
/** Bir hunide izin verilen azami adım. */
const MAX_STEPS = 12;

// ═══════════════════════════════════════════════════════════════════════════
// 1. TANIM DOĞRULAMA
// ═══════════════════════════════════════════════════════════════════════════

function validateFunnel(f) {
  const hatalar = [];
  if (!f || typeof f !== "object") return ["funnel govdesi yok"];

  if (!f.name || String(f.name).trim().length < 3) {
    hatalar.push("name en az 3 karakter olmali");
  }

  const steps = Array.isArray(f.steps) ? f.steps : [];
  if (steps.length < 2) {
    hatalar.push("huni en az 2 adim icermeli (giris + en az bir donusum)");
  }
  if (steps.length > MAX_STEPS) {
    hatalar.push(`en fazla ${MAX_STEPS} adim olabilir (su an ${steps.length})`);
  }
  steps.forEach((s, i) => {
    if (!s || typeof s !== "object") {
      hatalar.push(`adim ${i + 1}: nesne olmali`);
      return;
    }
    if (typeof s.eventName !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(s.eventName)) {
      hatalar.push(`adim ${i + 1}: eventName A-Za-z0-9_ olmali (max 64)`);
    }
    if (s.paramKey != null) {
      if (typeof s.paramKey !== "string" || s.paramKey.length > 64) {
        hatalar.push(`adim ${i + 1}: paramKey metin olmali (max 64)`);
      }
      if (s.paramValue == null) {
        hatalar.push(`adim ${i + 1}: paramKey verildiyse paramValue de gerekli`);
      }
    }
  });

  const w = Number(f.windowHours);
  if (!Number.isFinite(w) || w <= 0 || w > 24 * 90) {
    hatalar.push("windowHours 0-2160 (90 gun) arasi olmali");
  }
  return hatalar;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ADIM EŞLEŞTİRME
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bir olay, bir huni adımına uyuyor mu?
 * paramValue karşılaştırması metne çevrilerek yapılır: Firestore'da
 * `level` bazen 3, bazen "3" olarak gelir (istemciler tutarsız) ve bu
 * tutarsızlık yüzünden huninin sessizce boş çıkması gerçek bir risktir.
 */
function stepMatches(step, event) {
  if (!step || !event) return false;
  if (event.eventName !== step.eventName) return false;
  if (step.paramKey == null) return true;
  const p = event.eventParams || {};
  const v = p[step.paramKey];
  if (v == null) return false;
  return String(v) === String(step.paramValue);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. OYUNCU BAŞINA YOL YÜRÜME
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bir oyuncunun zaman sırasına dizilmiş olayları üzerinde huniyi yürür.
 *
 * @returns {{ depth:number, stepTimes:(number|null)[] }}
 *          depth = ulaştığı adım sayısı (0 = huniye hiç girmedi)
 */
function walkPlayer(steps, olaylar, windowHours) {
  const stepTimes = new Array(steps.length).fill(null);
  const pencereMs = windowHours * 3600 * 1000;

  // Adım 1: ilk eşleşen olay.
  let i = 0;
  for (; i < olaylar.length; i++) {
    if (stepMatches(steps[0], olaylar[i])) {
      stepTimes[0] = olaylar[i].timestampMs;
      i++;
      break;
    }
  }
  if (stepTimes[0] == null) return { depth: 0, stepTimes };

  const sonTarih = stepTimes[0] + pencereMs;
  let derinlik = 1;

  // Sonraki adımlar: her biri ÖNCEKİNDEN SONRA ve pencere içinde.
  for (let s = 1; s < steps.length; s++) {
    let bulundu = null;
    for (; i < olaylar.length; i++) {
      const e = olaylar[i];
      if (e.timestampMs > sonTarih) break;          // pencere kapandı
      if (stepMatches(steps[s], e)) { bulundu = e.timestampMs; i++; break; }
    }
    if (bulundu == null) break;                      // burada koptu
    stepTimes[s] = bulundu;
    derinlik++;
  }

  return { depth: derinlik, stepTimes };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. ANALİZ
// ═══════════════════════════════════════════════════════════════════════════

function medyan(dizi) {
  if (!dizi.length) return null;
  const a = dizi.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Huniyi hesaplar.
 *
 * @param {object} funnel   { steps, windowHours }
 * @param {Map<string, Array>} oyuncuOlaylari  playerAnonId -> olaylar
 *        (her olay: { eventName, eventParams, timestampMs })
 * @param {number} simdiMs
 */
function analyzeFunnel(funnel, oyuncuOlaylari, simdiMs) {
  const steps = funnel.steps || [];
  const windowHours = Number(funnel.windowHours) || DEFAULT_WINDOW_HOURS;
  const simdi = Number.isFinite(simdiMs) ? simdiMs : Date.now();
  const pencereMs = windowHours * 3600 * 1000;

  const adimSayilari = new Array(steps.length).fill(0);
  // Adım geçişleri arasındaki süreler — "nerede takılıyor" sorusunun cevabı.
  const gecisSureleri = steps.map(() => []);
  let devamEden = 0;
  let girisYapan = 0;
  let kirpilanOyuncu = 0;

  let islenen = 0;
  for (const [, olaylar] of oyuncuOlaylari) {
    if (islenen >= MAX_PLAYERS) { kirpilanOyuncu++; continue; }
    islenen++;

    // Zaman sırası şart: huni sıralı yol tanımına dayanıyor.
    const sirali = olaylar
      .filter((e) => e && Number.isFinite(e.timestampMs))
      .sort((a, b) => a.timestampMs - b.timestampMs);
    if (!sirali.length) continue;

    const { depth, stepTimes } = walkPlayer(steps, sirali, windowHours);
    if (depth === 0) continue;                       // huniye hiç girmedi

    girisYapan++;

    // OLGUNLAŞMA: penceresi kapanmamış oyuncu orana GİRMEZ (bkz. dosya başı #2).
    // İstisna: huniyi tamamen bitirdiyse sonucu kesindir, beklemeye gerek yok.
    const penceresiKapandi = simdi >= stepTimes[0] + pencereMs;
    const tamamladi = depth === steps.length;
    if (!penceresiKapandi && !tamamladi) { devamEden++; continue; }

    for (let s = 0; s < depth; s++) adimSayilari[s]++;
    for (let s = 1; s < depth; s++) {
      gecisSureleri[s].push((stepTimes[s] - stepTimes[s - 1]) / 1000);
    }
  }

  const taban = adimSayilari[0] || 0;
  const adimlar = steps.map((s, i) => {
    const n = adimSayilari[i];
    const onceki = i === 0 ? n : adimSayilari[i - 1];
    return {
      index: i,
      eventName: s.eventName,
      label: s.label || s.eventName,
      paramKey: s.paramKey == null ? null : s.paramKey,
      paramValue: s.paramValue == null ? null : s.paramValue,
      reached: n,
      conversionFromPrev: i === 0 ? 1 : (onceki > 0 ? n / onceki : null),
      conversionFromFirst: taban > 0 ? n / taban : null,
      dropFromPrev: i === 0 ? 0 : (onceki > 0 ? (onceki - n) / onceki : null),
      medianSecondsFromPrev: i === 0 ? null : medyan(gecisSureleri[i]),
    };
  });

  // En büyük kopuş — aksiyon alınacak tek nokta.
  let enBuyukKopusAdimi = null;
  let enBuyukKopusOrani = 0;
  for (let i = 1; i < adimlar.length; i++) {
    const d = adimlar[i].dropFromPrev;
    if (d != null && d > enBuyukKopusOrani) {
      enBuyukKopusOrani = d;
      enBuyukKopusAdimi = i;
    }
  }

  const tamamlayan = adimSayilari[steps.length - 1] || 0;

  return {
    computedAt: new Date(simdi).toISOString(),
    windowHours,
    steps: adimlar,
    entered: taban,
    completed: tamamlayan,
    overallConversion: taban > 0 ? tamamlayan / taban : null,
    inProgress: devamEden,
    enteredIncludingInProgress: girisYapan,
    biggestDropStep: enBuyukKopusAdimi,
    biggestDropRate: enBuyukKopusAdimi == null ? null : enBuyukKopusOrani,
    playersScanned: islenen,
    playersTruncated: kirpilanOyuncu,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. HAZIR HUNİ ŞABLONLARI
//    Boş bir "huni oluştur" formu kimseye yardım etmez; oyun türüne göre
//    anlamlı bir başlangıç noktası verir.
// ═══════════════════════════════════════════════════════════════════════════

const PRESETS = {
  onboarding: {
    name_tr: "Onboarding hunisi",
    name_en: "Onboarding funnel",
    windowHours: 24,
    steps: [
      { eventName: "first_open", label_tr: "Kurulum", label_en: "Install" },
      { eventName: "tutorial_start", label_tr: "Tutorial başladı", label_en: "Tutorial started" },
      { eventName: "tutorial_complete", label_tr: "Tutorial bitti", label_en: "Tutorial completed" },
      { eventName: "level_start", label_tr: "İlk bölüm başladı", label_en: "First level started" },
      { eventName: "level_complete", label_tr: "İlk bölüm bitti", label_en: "First level completed" },
    ],
  },
  monetization: {
    name_tr: "Monetizasyon hunisi",
    name_en: "Monetization funnel",
    windowHours: 168,
    steps: [
      { eventName: "session_start", label_tr: "Oturum", label_en: "Session" },
      { eventName: "shop_open", label_tr: "Mağaza açıldı", label_en: "Shop opened" },
      { eventName: "iap_purchase_start", label_tr: "Satın alma başladı", label_en: "Purchase started" },
      { eventName: "iap_purchase_success", label_tr: "Satın alma tamamlandı", label_en: "Purchase completed" },
    ],
  },
  rewarded_ad: {
    name_tr: "Ödüllü reklam hunisi",
    name_en: "Rewarded ad funnel",
    windowHours: 24,
    steps: [
      { eventName: "level_fail", label_tr: "Bölüm başarısız", label_en: "Level failed" },
      { eventName: "rewarded_ad_offered", label_tr: "Reklam teklif edildi", label_en: "Ad offered" },
      { eventName: "rewarded_ad_watched", label_tr: "Reklam izlendi", label_en: "Ad watched" },
      { eventName: "level_complete", label_tr: "Bölüm tamamlandı", label_en: "Level completed" },
    ],
  },
};

/**
 * Şablonu belirli bir dilde somut huni tanımına çevirir.
 * Etiket, huni OLUŞTURULURKEN seçilip dokümana yazılır — huni onu kuran
 * kişiye aittir, sonradan dil değiştirmek etiketleri değiştirmez.
 */
function presetToFunnel(key, lang) {
  const p = PRESETS[key];
  if (!p) return null;
  const en = lang === "en";
  return {
    name: en ? p.name_en : p.name_tr,
    windowHours: p.windowHours,
    steps: p.steps.map((s) => ({
      eventName: s.eventName,
      label: en ? s.label_en : s.label_tr,
    })),
    preset: key,
  };
}

module.exports = {
  validateFunnel, stepMatches, walkPlayer, analyzeFunnel, medyan,
  PRESETS, presetToFunnel, MAX_PLAYERS, MAX_STEPS, DEFAULT_WINDOW_HOURS,
};
