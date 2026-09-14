/**
 * Altare — panel yüzey uyarlamasının GERÇEK TARAYICIDA doğrulanması
 *
 *     node tools/test-panel-surfaces-dom.mjs
 *
 * ⚠ test-all.sh'İN PARÇASI DEĞİL: Chromium gerektirir, oysa test-all.sh
 *   bilinçli olarak ağ/tarayıcı/emülatör istemez. Panel yerleşimine ya da
 *   gizleme mantığına dokunduğunda BUNU ELLE ÇALIŞTIR.
 *
 * NEDEN AYRI BİR TEST GEREKİYOR:
 * test-panel-surfaces.mjs saf mantığı doğruluyor — hangi yüzeyin görünmesi
 * GEREKTİĞİNİ. Ama "görünmeli" ile "görünüyor" arasında CSS var ve tam orada
 * gerçek bir hata çıktı: `.nav-tab{display:flex}`, tarayıcının
 * `[hidden]{display:none}` kuralını eziyordu. Öznitelik doğru atanıyor,
 * sekme ekranda kalıyordu. Aynı hata admin-only "Müşteri Yönetimi"
 * sekmesini de admin olmayan herkese gösteriyordu.
 *
 * Bu yüzden buradaki her kontrol ÖZNİTELİĞE DEĞİL, elemanın gerçekten
 * çizilip çizilmediğine bakar (offsetParent). Öznitelik testi bu hatayı
 * kaçırdı; hesaplanmış görünürlük testi yakalar.
 */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../panel.html', import.meta.url), 'utf8');
function blokAl(bas, kapanis = "\n        }") {
  const b = panel.indexOf(bas), e = panel.indexOf(kapanis, b);
  if (b < 0 || e < 0) throw new Error('bulunamadi: ' + bas);
  return panel.slice(b, e + kapanis.length);
}
const mantik = [
  blokAl("const YUZEY_KAYDI = {", "\n        };"),
  blokAl("const TIP_BEKLENTILERI = {", "\n        };"),
  blokAl("function cozumleYuzeyler(oyun) {"),
  blokAl("function uygulaYuzeyler(oyun) {"),
  blokAl("function renderYuzeyUyarisi(uyarilar) {"),
].join("\n\n");

// panel.html'i modul script'i ve Firebase importlari OLMADAN yukle:
// amac auth degil, YERLESIMIN kendisi.
const govde = panel.replace(/<script type="module">[\s\S]*?<\/script>/g, '');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const hatalar = [];
pg.on('pageerror', e => hatalar.push('JS: ' + e.message));
await pg.setContent(govde, { waitUntil: 'domcontentloaded' });
await pg.addScriptTag({ content: `
  function $(id){ return document.getElementById(id); }
  function escapeHtml(x){ return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function t(k){ return '['+k+']'; }
  ${mantik}
  window.__uygula = uygulaYuzeyler;
  // panel.html'deki wireTabs ile ayni davranis — modul script'i cikarildigi
  // icin harness'ta elle kuruluyor.
  document.querySelectorAll('.nav-tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
    const tgt = document.querySelector('.tab-view[data-tab="' + btn.dataset.tab + '"]');
    if (tgt) tgt.classList.add('active');
  }));
` });

const dur = () => pg.evaluate(() => {
  // ⚠ `el.hidden` OZNITELIGINE BAKMA. Bu testin ilk hali ona bakiyordu ve
  // tam bu yuzden gercek bir hatayi kacirdi: `.nav-tab{display:flex}`,
  // tarayicinin `[hidden]{display:none}` kuralini eziyordu — oznitelik
  // dogru atanmis ama sekme EKRANDA duruyordu. Tek gecerli olcut,
  // elemanin gercekten cizilip cizilmedigidir.
  const gorunurMu = (sec) => {
    const el = document.querySelector(sec);
    if (!el) return false;
    return el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
  };
  return {
  levelSekmesi: gorunurMu('.nav-tab[data-tab="levels"]'),
  failKarti:    gorunurMu('.kpi-card[data-surface="levels"]'),
  adsKarti:     gorunurMu('.kpi-card[data-surface="ads"]'),
  iapKarti:     gorunurMu('.kpi-card[data-surface="iap"]'),
  uyari:        gorunurMu('#surface-notice'),
  uyariMetni:   document.getElementById('surface-notice').textContent,
  aktifSekme:   document.querySelector('.nav-tab.active')?.dataset.tab || null,
  };
});

let g=0,k=0; const h=[];
const ok=(ad,c,d)=>{ if(c)g++; else {k++; h.push(ad+(d?' → '+d:''));} };

// 1) Veri yok -> hepsi gorunur, uyari yok
await pg.evaluate(() => window.__uygula({ gameType: 'casino', observedEvents: [] }));
let s = await dur();
ok('veri yok: level sekmesi gorunur', s.levelSekmesi);
ok('veri yok: uyari cikmaz', !s.uyari);

// 2) Kullanicinin sikayeti: casino, level yok
await pg.evaluate(() => window.__uygula({ gameType: 'casino',
  observedEvents: ['first_open','session_start','ad_watched','iap_purchase_success'] }));
s = await dur();
ok('casino: level SEKMESI gizlendi', !s.levelSekmesi);
ok('casino: fail orani KARTI gizlendi', !s.failKarti);
ok('casino: reklam karti gorunur', s.adsKarti);
ok('casino: iap karti gorunur', s.iapKarti);
ok('casino: level beklenmedigi icin uyari YOK', !s.uyari);

// 3) match3 ama level eventi hic gelmemis -> gizle AMA sebebini soyle
await pg.evaluate(() => window.__uygula({ gameType: 'match3',
  observedEvents: ['first_open','session_start'] }));
s = await dur();
ok('match3/level yok: sekme gizli', !s.levelSekmesi);
ok('match3/level yok: UYARI cikar', s.uyari);
ok('uyari eksik event adlarini yazar', s.uyariMetni.includes('level_start'));
ok('uyari yuzey adini yazar', s.uyariMetni.includes('surface.levels'));

// 4) EN KRITIK DOM DAVRANISI: acik sekme gizlenirse kullanici bos ekranda kalmamali
await pg.evaluate(() => {
  window.__uygula({ gameType: 'match3', observedEvents: [] });       // hepsi acik
  document.querySelector('.nav-tab[data-tab="levels"]').click();      // Level'a gec
});
ok('once Level sekmesi aktif', (await dur()).aktifSekme === 'levels');
await pg.evaluate(() => window.__uygula({ gameType: 'casino', observedEvents: ['ad_watched'] }));
s = await dur();
ok('aktif sekme gizlenince Genel Bakis\'a doner', s.aktifSekme === 'overview');
ok('geri donuste level sekmesi gercekten gizli', !s.levelSekmesi);

// 5) Geri donusluluk: level eventi gelirse sekme geri gelir
await pg.evaluate(() => window.__uygula({ gameType: 'casino', observedEvents: ['ad_watched','level_start'] }));
s = await dur();
ok('level eventi gelince sekme GERI GELIR', s.levelSekmesi);
// casino'da iap beklenir ve iap_purchase_success hic gelmemis — uyari
// HAKLI OLARAK duruyor, ama artik levels'tan bahsetmemeli.
ok('geri gelince uyari artik levels demiyor', !s.uyariMetni.includes('surface.levels'));
ok('uyari hala iap icin duruyor (dogru)', s.uyariMetni.includes('surface.iap'));

// 6) AYNI KOK SEBEP — admin-only sekme. `.nav-tab{display:flex}` yuzunden
//    `hidden` islemiyordu ve "Musteri Yonetimi" admin OLMAYAN herkese
//    gorunuyordu (sunucu assertAdmin ile korumali, veri sizmiyor; ama
//    kullanici tiklayip yetki hatasi aliyordu). Ayni kural ikisini de
//    duzeltti, ikisi de burada bekcili olsun.
const adminGorunur = async (isAdmin) => pg.evaluate((a) => {
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = !a; });
  const el = document.querySelector('.nav-tab.admin-only');
  return !!el && el.offsetParent !== null;
}, isAdmin);
ok('admin DEGILSE musteri sekmesi gizli', (await adminGorunur(false)) === false);
ok('admin ISE musteri sekmesi gorunur', (await adminGorunur(true)) === true);

await b.close();
ok('sayfada JS hatasi yok', hatalar.length === 0, hatalar.join(' | '));
console.log('\n' + '='.repeat(60));
if (k===0) console.log(`✅  DOM DAVRANISI GECTI — ${g} kontrol`);
else { console.log(`❌  ${k} BASARISIZ / ${g+k}\n`); h.forEach(x=>console.log('   ✗ '+x)); }
console.log('='.repeat(60));
process.exit(k===0?0:1);
