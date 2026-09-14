/**
 * Altare — panel veri tazeliği göstergesi (GERÇEK TARAYICI)
 *
 *     node tools/test-panel-freshness.mjs
 *
 * ⚠ test-all.sh'İN PARÇASI DEĞİL: Chromium gerektirir.
 *
 * NEDEN VAR:
 * aggregateDailyStats SAATLİK çalışıyor (maliyet: koşu başına 10.000 doküman
 * okuma). Yani KPI kartları 60 dakikaya kadar eski olabilir. Başlıkta yalnızca
 * canlı saat göstermek, sayıların o dakikaya ait olduğunu İMA EDER — yanlış
 * izlenim, eksik bilgiden kötüdür. Bu gösterge o boşluğu kapatıyor.
 *
 * Buradaki kontroller bozuk updatedAt biçimlerinde de çökmediğini doğruluyor:
 * Firestore Timestamp'i olmayan bir doküman gerçek hayatta görülür.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const panel = readFileSync(new URL('../panel.html', import.meta.url),'utf8');
function blokAl(bas, kap="\n        }"){ const b=panel.indexOf(bas), e=panel.indexOf(kap,b);
  if(b<0||e<0) throw new Error('bulunamadi: '+bas); return panel.slice(b,e+kap.length); }
const govde = panel.replace(/<script type="module">[\s\S]*?<\/script>/g,'');
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await (await b.newContext({viewport:{width:1440,height:420}})).newPage();
const hatalar=[]; pg.on('pageerror',e=>hatalar.push(e.message));
await pg.setContent(govde,{waitUntil:'domcontentloaded'});
await pg.addScriptTag({content:`
  function $(id){return document.getElementById(id);}
  const SOZ={'page.freshNow':'veri: az önce','page.freshAgo':'veri: {dk} dk önce',
             'page.freshAt':'Özet verisi saat {saat} itibarıyla. Saatlik güncellenir.'};
  function t(k){return SOZ[k]||('['+k+']');}
  ${blokAl("function renderStatsFreshness(stats) {")}
  window.__f = renderStatsFreshness;
`});
const oku = () => pg.evaluate(()=>({ metin:document.getElementById('stats-fresh').textContent,
                                     ipucu:document.getElementById('stats-fresh').title }));
let g=0,k=0; const h=[]; const ok=(a,c,d)=>{c?g++:(k++,h.push(a+(d?' → '+d:'')));};

await pg.evaluate(()=>window.__f(null));
let r=await oku(); ok('veri yoksa gizli', r.metin==='', JSON.stringify(r));

await pg.evaluate(()=>window.__f({updatedAt:{toMillis:()=>Date.now()-20*1000}}));
r=await oku(); ok('20sn once -> "az once"', r.metin.includes('az önce'), r.metin);

await pg.evaluate(()=>window.__f({updatedAt:{toMillis:()=>Date.now()-47*60*1000}}));
r=await oku(); ok('47dk once -> "47 dk once"', r.metin.includes('47'), r.metin);
ok('ipucunda saat var', /\d{1,2}[:.]\d{2}/.test(r.ipucu), r.ipucu);

// Saatlik yazimda en kotu durum: ~60 dk
await pg.evaluate(()=>window.__f({updatedAt:{toMillis:()=>Date.now()-60*60*1000}}));
r=await oku(); ok('60dk gosterilir (saatlik en kotu durum)', r.metin.includes('60'), r.metin);

// Bozuk updatedAt cokmemeli
for (const [ad,v] of [['updatedAt yok',{}],['toMillis yok',{updatedAt:{}}],['null',{updatedAt:null}]]) {
  try { await pg.evaluate(x=>window.__f(x),v); ok('cokmez: '+ad,true); }
  catch(e){ ok('cokmez: '+ad,false,e.message); }
}
await pg.evaluate(()=>window.__f({updatedAt:{toMillis:()=>Date.now()-38*60*1000}}));
await b.close();
ok('JS hatasi yok', hatalar.length===0, hatalar.join('|'));
console.log('\n'+(k===0?`✅ TAZELIK GOSTERGESI GECTI — ${g} kontrol`:`❌ ${k} BASARISIZ`));
h.forEach(x=>console.log('  ✗ '+x)); process.exit(k===0?0:1);
