/**
 * Altare — AltareJson ayristirici testi
 *
 *     node tools/test-json-parser.js
 *
 * NEDEN VAR:
 * AltareConfig.cs icindeki AltareJson, sunucudan gelen canli config ile oyun
 * arasindaki TEK gecittir. Yanlis ayristirilan bir deger dogrudan oyunun
 * davranisini degistirir (reklam sikligi, bolum zorlugu, IAP fiyati).
 * Unity olmadan C# calistiramadigimiz icin ayristiricinin ALGORITMASI burada
 * JavaScript'e BIREBIR cevrilmistir ve referans JSON.parse'a karsi test edilir.
 * C# tarafi bu transkripsiyonun aynisidir; algoritma dogruysa o da dogrudur.
 *
 * Ayni teknik FNV-1a paritesinde de kullanildi (tools/test-hash-parity.py).
 */

"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// AltareConfig.cs → AltareJson BIREBIR TRANSKRIPSIYONU
// C#'ta `ref int i` olan yer burada { i } kutusuyla modellenir.
// ═══════════════════════════════════════════════════════════════════════════

function Parse(s) {
  if (s === null || s === undefined || s === "") return null;
  const p = { i: 0 };
  const sonuc = Deger(s, p);
  BosluGec(s, p);
  if (p.i < s.length) throw new Error("JSON sonrasi fazla karakter: " + p.i);
  return sonuc;
}

function BosluGec(s, p) {
  while (p.i < s.length) {
    const c = s[p.i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") p.i++;
    else break;
  }
}

function Deger(s, p) {
  BosluGec(s, p);
  if (p.i >= s.length) throw new Error("beklenmedik son");
  const c = s[p.i];
  if (c === "{") return Nesne(s, p);
  if (c === "[") return Dizi(s, p);
  if (c === '"') return Metin(s, p);
  if (Esles(s, p, "true")) return true;
  if (Esles(s, p, "false")) return false;
  if (Esles(s, p, "null")) return null;
  return Sayi(s, p);
}

function Esles(s, p, kelime) {
  if (p.i + kelime.length > s.length) return false;
  for (let k = 0; k < kelime.length; k++) if (s[p.i + k] !== kelime[k]) return false;
  p.i += kelime.length;
  return true;
}

function Nesne(s, p) {
  const d = {};
  p.i++;
  BosluGec(s, p);
  if (p.i < s.length && s[p.i] === "}") { p.i++; return d; }
  for (;;) {
    BosluGec(s, p);
    if (p.i >= s.length || s[p.i] !== '"') throw new Error("anahtar bekleniyordu");
    const anahtar = Metin(s, p);
    BosluGec(s, p);
    if (p.i >= s.length || s[p.i] !== ":") throw new Error("':' bekleniyordu");
    p.i++;
    d[anahtar] = Deger(s, p);
    BosluGec(s, p);
    if (p.i >= s.length) throw new Error("nesne kapanmadi");
    if (s[p.i] === ",") { p.i++; continue; }
    if (s[p.i] === "}") { p.i++; return d; }
    throw new Error("',' veya '}' bekleniyordu: " + p.i);
  }
}

function Dizi(s, p) {
  const l = [];
  p.i++;
  BosluGec(s, p);
  if (p.i < s.length && s[p.i] === "]") { p.i++; return l; }
  for (;;) {
    l.push(Deger(s, p));
    BosluGec(s, p);
    if (p.i >= s.length) throw new Error("dizi kapanmadi");
    if (s[p.i] === ",") { p.i++; continue; }
    if (s[p.i] === "]") { p.i++; return l; }
    throw new Error("',' veya ']' bekleniyordu: " + p.i);
  }
}

function Metin(s, p) {
  p.i++;
  let sb = "";
  while (p.i < s.length) {
    const c = s[p.i++];
    if (c === '"') return sb;
    if (c !== "\\") { sb += c; continue; }
    if (p.i >= s.length) break;
    const k = s[p.i++];
    switch (k) {
      case '"':  sb += '"';    break;
      case "\\": sb += "\\";   break;
      case "/":  sb += "/";    break;
      case "b":  sb += "\b";   break;
      case "f":  sb += "\f";   break;
      case "n":  sb += "\n";   break;
      case "r":  sb += "\r";   break;
      case "t":  sb += "\t";   break;
      case "u": {
        if (p.i + 4 > s.length) throw new Error("eksik \\u");
        let kod = 0;
        for (let k2 = 0; k2 < 4; k2++) kod = kod * 16 + OnaltilikBasamak(s[p.i + k2]);
        p.i += 4;
        sb += String.fromCharCode(kod);
        break;
      }
      default: throw new Error("bilinmeyen kacis: \\" + k);
    }
  }
  throw new Error("metin kapanmadi");
}

function OnaltilikBasamak(c) {
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "a" && c <= "f") return c.charCodeAt(0) - 97 + 10;
  if (c >= "A" && c <= "F") return c.charCodeAt(0) - 65 + 10;
  throw new Error("gecersiz onaltilik basamak: " + c);
}

function Sayi(s, p) {
  const bas = p.i;
  if (p.i < s.length && (s[p.i] === "-" || s[p.i] === "+")) p.i++;
  while (p.i < s.length) {
    const c = s[p.i];
    if ((c >= "0" && c <= "9") || c === "." || c === "e" || c === "E" ||
        c === "+" || c === "-") p.i++;
    else break;
  }
  if (p.i === bas) throw new Error("sayi bekleniyordu: " + bas);
  const parca = s.substring(bas, p.i);
  const d = Number(parca);
  if (!Number.isFinite(d)) throw new Error("gecersiz sayi: " + parca);
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTLER
// ═══════════════════════════════════════════════════════════════════════════

let gecen = 0, kalan = 0;
const hatalar = [];

function ok(ad, kosul, detay) {
  if (kosul) { gecen++; return; }
  kalan++;
  hatalar.push(ad + (detay ? "  →  " + detay : ""));
}

/** Referans JSON.parse ile ayni sonucu veriyor mu? */
function esit(json) {
  let beklenen, gelen;
  try { beklenen = JSON.parse(json); }
  catch (e) { ok("REFERANS bozuk (test hatasi): " + json, false, e.message); return; }
  try { gelen = Parse(json); }
  catch (e) { ok("ayristirici hata verdi: " + json, false, e.message); return; }
  const a = JSON.stringify(beklenen), b = JSON.stringify(gelen);
  ok("eslesti: " + (json.length > 60 ? json.slice(0, 57) + "..." : json),
     a === b, `beklenen ${a}, gelen ${b}`);
}

/** Bozuk girdi SESSIZCE gecmemeli — hata firlatmali. */
function reddetmeli(json, ad) {
  let hataAldi = false;
  try { Parse(json); } catch (e) { hataAldi = true; }
  ok("reddedildi: " + (ad || json), hataAldi, "sessizce kabul edildi");
}

console.log("\n── Temel tipler ───────────────────────────────────────────");
esit('{}');
esit('[]');
esit('null');
esit('true');
esit('false');
esit('0');
esit('-1');
esit('3.14');
esit('1e3');
esit('-2.5E-3');
esit('"merhaba"');
esit('""');

console.log("── Gercek getGameConfig yaniti ────────────────────────────");
esit(JSON.stringify({
  values: {
    ad_frequency_interstitial: 60,
    level_18_moves_limit: 25,
    fps_target: 30.5,
    low_end_mode: true,
    welcome_text: "Hoş geldin!",
  },
  experiments: [
    {
      id: "exp_abc123",
      exposurePct: 10,
      variants: [
        { key: "control", allocation: 50, values: {} },
        { key: "treatment", allocation: 50, values: { ad_frequency_interstitial: 90 } },
      ],
    },
  ],
  version: 12,
}));

console.log("── Ic ice yapilar ─────────────────────────────────────────");
esit('{"a":{"b":{"c":{"d":[1,2,[3,[4]]]}}}}');
esit('[[[[[]]]]]');
esit('[{"x":1},{"x":2},{"x":3}]');
esit('{"bos_nesne":{},"bos_dizi":[],"sifir":0,"yanlis":false,"hic":null}');

console.log("── Kacis dizileri ─────────────────────────────────────────");
esit('"tirnak: \\" ters: \\\\ egik: \\/"');
esit('"satir:\\nsekme:\\tgeri:\\bform:\\fdonus:\\r"');
esit('"\\u0041\\u00e7\\u011f\\u00fc"');          // A ç ğ ü
esit('"\\u0000\\u001f"');                        // kontrol karakterleri
esit('{"anahtar\\nsatirli":"deger"}');           // anahtarda da kacis
esit(JSON.stringify({ "çğüşiöÇĞÜŞİÖ": "türkçe değer" }));
esit(JSON.stringify({ emoji: "🎮 oyun" }));      // vekil cift (surrogate pair)

console.log("── Bosluk toleransi ───────────────────────────────────────");
esit('  {  "a"  :  1  ,  "b"  :  [  2  ,  3  ]  }  ');
esit('{\n\t"a":\r\n1\n}');

console.log("── Sayi bicimleri ─────────────────────────────────────────");
esit('{"a":0,"b":-0.5,"c":1e10,"d":1E-10,"e":123456789012,"f":0.000001}');

console.log("── Bozuk girdi reddedilmeli ───────────────────────────────");
reddetmeli('{', "kapanmamis nesne");
reddetmeli('[1,2', "kapanmamis dizi");
reddetmeli('"kapanmamis metin', "kapanmamis metin");
reddetmeli('{"a":1}xx', "sonrasinda fazla karakter");
reddetmeli('{"a"1}', "eksik iki nokta");
reddetmeli('{a:1}', "tirnaksiz anahtar");
reddetmeli('{"a":}', "eksik deger");
reddetmeli('[1,,2]', "bos oge");
reddetmeli('"\\q"', "bilinmeyen kacis");
reddetmeli('"\\u00"', "eksik \\u basamagi");
reddetmeli('"\\uZZZZ"', "gecersiz onaltilik");
reddetmeli('tru', "eksik anahtar kelime");
reddetmeli('{"a":1,}', "sondaki virgul");

console.log("── Bos / null girdi ───────────────────────────────────────");
ok("bos metin → null", Parse("") === null);
ok("null girdi → null", Parse(null) === null);

console.log("── Rastgele derin yapilar (fuzz) ──────────────────────────");
(() => {
  // Deterministik sozde-rastgele: test her kosuda ayni girdileri uretsin.
  let tohum = 12345;
  const rnd = () => {
    tohum = (tohum * 1103515245 + 12345) & 0x7fffffff;
    return tohum / 0x7fffffff;
  };
  const uret = (derinlik) => {
    const r = rnd();
    if (derinlik > 4 || r < 0.30) {
      const t = rnd();
      if (t < 0.2) return null;
      if (t < 0.4) return rnd() < 0.5;
      if (t < 0.7) return Math.round(rnd() * 1e6) / 100;
      return "s" + Math.floor(rnd() * 1e6) + "_çğü\"\\\n\t";
    }
    if (r < 0.65) {
      const n = Math.floor(rnd() * 5);
      const a = [];
      for (let k = 0; k < n; k++) a.push(uret(derinlik + 1));
      return a;
    }
    const n = Math.floor(rnd() * 5);
    const o = {};
    for (let k = 0; k < n; k++) o["k" + k + "_çğ\"\\"] = uret(derinlik + 1);
    return o;
  };
  let tamam = 0;
  for (let n = 0; n < 400; n++) {
    const metin = JSON.stringify(uret(0));
    try {
      if (JSON.stringify(Parse(metin)) === JSON.stringify(JSON.parse(metin))) tamam++;
    } catch (e) { /* asagida sayilir */ }
  }
  ok("400 rastgele yapinin tamami eslesti", tamam === 400, tamam + "/400");
})();

console.log("\n" + "═".repeat(64));
if (kalan === 0) {
  console.log(`✅  TUM TESTLER GECTI — ${gecen} kontrol (AltareJson ≡ JSON.parse)`);
} else {
  console.log(`❌  ${kalan} BASARISIZ / ${gecen + kalan} kontrol\n`);
  for (const h of hatalar) console.log("   ✗ " + h);
}
console.log("═".repeat(64));
process.exit(kalan === 0 ? 0 : 1);
