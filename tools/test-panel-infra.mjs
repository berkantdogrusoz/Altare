/**
 * Altare — Altyapı sekmesi / setupBigQuery butonu (GERÇEK TARAYICI)
 *
 *     node tools/test-panel-infra.mjs
 *
 * ⚠ test-all.sh'İN PARÇASI DEĞİL: Chromium gerektirir.
 *
 * NEDEN VAR:
 * Bu buton GERİ ALINAMAZ bir şey yapıyor — BigQuery dataset'i oluşturuyor ve
 * dataset konumu sonradan DEĞİŞTİRİLEMEZ. Yanlış bölgede oluşursa verinin
 * AB'den çıkması demek. O yüzden hem başarı hem hata yolu doğrulanıyor.
 *
 * Özellikle yetki hatası önemli: Functions servis hesabının BigQuery izni
 * yoksa çağrı burada patlar. Kullanıcıya sadece "hata" demek yetmez —
 * NE YAPACAĞINI söylemeli, yoksa ekranda kalakalır.
 *
 * httpsCallable sahte: ağ, kimlik doğrulama ya da gerçek BigQuery gerekmez.
 */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const panel = readFileSync(new URL('../panel.html', import.meta.url),'utf8');
function blokAl(bas, kap="\n        }"){ const b=panel.indexOf(bas), e=panel.indexOf(kap,b);
  if(b<0||e<0) throw new Error('bulunamadi: '+bas); return panel.slice(b,e+kap.length); }
const govde = panel.replace(/<script type="module">[\s\S]*?<\/script>/g,'');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const pg = await (await b.newContext({viewport:{width:1440,height:800}})).newPage();
const hatalar=[]; pg.on('pageerror',e=>hatalar.push(e.message));
await pg.setContent(govde,{waitUntil:'domcontentloaded'});
await pg.addScriptTag({content:`
  function $(id){return document.getElementById(id);}
  function escapeHtml(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  const SOZ={'infra.bq.running':'Kuruluyor…','infra.bq.ok':'Veri ambarı hazır','infra.bq.fail':'Kurulum başarısız',
    'infra.bq.table':'Tablo','infra.bq.region':'Bölge','infra.bq.expiry':'Bölüm ömrü (gün)',
    'infra.bq.next':'Bundan sonraki olaylar hem Firestore\\'a hem BigQuery\\'ye yazılır.',
    'infra.bq.permHint':'Yetki hatası: Functions servis hesabına BigQuery izni ver (roles/bigquery.dataEditor + roles/bigquery.jobUser).'};
  function t(k){return SOZ[k]||('['+k+']');}
  let SENARYO='ok';
  window.__senaryo = s => { SENARYO = s; };
  function httpsCallable(){ return async () => {
    if (SENARYO==='ok') return {data:{projeId:'altare-x',dataset:'altare_analytics',tablo:'events',konum:'europe-west1',bolumOmruGun:400}};
    if (SENARYO==='yetki') throw new Error('PERMISSION_DENIED: BigQuery API access denied');
    throw new Error('beklenmedik hata');
  };}
  const functions = {};
  ${blokAl("function wireInfraSetup() {")}
  wireInfraSetup();
`});
let g=0,k=0; const h=[]; const ok=(a,c,d)=>{c?g++:(k++,h.push(a+(d?' → '+d:'')));};
const oku = () => pg.evaluate(()=>({html:document.getElementById('setup-bq-result').innerHTML,
  kilitli:document.getElementById('btn-setup-bq').disabled}));

ok('buton var', await pg.evaluate(()=>!!document.getElementById('btn-setup-bq')));
// Sekme gorunumu .active ile aciliyor; tiklamadan once elle ac.
await pg.evaluate(()=>{
  document.querySelectorAll('.tab-view').forEach(v=>v.classList.remove('active'));
  document.querySelector('.tab-view[data-tab="infra"]').classList.add('active');
});
// admin degilse sekme gizli olmali
ok('Altyapi sekmesi admin-only', await pg.evaluate(()=>{
  const el=document.querySelector('.nav-tab[data-tab="infra"]');
  return !!el && el.classList.contains('admin-only') && el.offsetParent===null;}));

await pg.click('#btn-setup-bq'); await pg.waitForTimeout(250);
let r=await oku();
ok('basarida success-box', r.html.includes('success-box'), r.html.slice(0,120));
ok('tablo adi gosteriliyor', r.html.includes('altare_analytics.events'));
ok('bolge gosteriliyor', r.html.includes('europe-west1'));
ok('bolum omru gosteriliyor', r.html.includes('400'));
ok('buton tekrar acildi', r.kilitli===false);

await pg.evaluate(()=>window.__senaryo('yetki'));
await pg.click('#btn-setup-bq'); await pg.waitForTimeout(250);
r=await oku();
ok('yetki hatasinda error-box', r.html.includes('error-box'));
ok('yetki hatasinda COZUM yaziyor', r.html.includes('bigquery.dataEditor'), r.html.slice(0,200));

await pg.evaluate(()=>window.__senaryo('baska'));
await pg.click('#btn-setup-bq'); await pg.waitForTimeout(250);
r=await oku();
ok('genel hatada error-box', r.html.includes('error-box'));
ok('genel hatada yetki ipucu YOK', !r.html.includes('bigquery.dataEditor'));

await pg.evaluate(()=>document.querySelectorAll('.admin-only').forEach(e=>{e.hidden=false;}));
await pg.evaluate(()=>window.__senaryo('ok'));
await pg.click('#btn-setup-bq'); await pg.waitForTimeout(250);
await b.close();
ok('JS hatasi yok', hatalar.length===0, hatalar.join('|'));
console.log('\n'+(k===0?`✅ ALTYAPI SEKMESI GECTI — ${g} kontrol`:`❌ ${k} BASARISIZ / ${g+k}`));
h.forEach(x=>console.log('  ✗ '+x)); process.exit(k===0?0:1);
