/* ═══════════════════════════════════════════════════════════════════════
   ALTARE — hukuki sayfalarin tema + dil anahtari.

   NEDEN index.html'deki i18n SOZLUGU KULLANILMIYOR:
   Hukuki metin uzun ve bicimli (baslik, liste, tablo, baglanti). Onu
   JavaScript string'ine sikistirmak metni okunmaz, denetlenmesi zor ve
   kacis karakteri hatalarina acik hale getirir. Bunun yerine IKI DIL DE
   HTML'in icinde duruyor; burasi yalnizca hangisinin gorunecegine karar
   veriyor. Boylece metin gercek HTML olarak kaliyor: aranabilir,
   fark (diff) alinabilir, avukat okuyabilir.

   Dil ve tema tercihi index.html ile AYNI localStorage anahtarlarini
   kullanir — site ile hukuki sayfalar arasinda gecerken tercih korunur.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── Tema ───
    var temaDugmesi = document.getElementById('theme-toggle');
    var temaMeta = document.getElementById('meta-theme-color');

    function temaUygula(tema) {
        document.documentElement.setAttribute('data-theme', tema);
        if (temaMeta) {
            temaMeta.setAttribute('content', tema === 'light' ? '#faf8f5' : '#0a0a0a');
        }
        try { localStorage.setItem('altare-theme', tema); } catch (e) { }
    }

    if (temaDugmesi) {
        temaDugmesi.addEventListener('click', function () {
            var simdiki = document.documentElement.getAttribute('data-theme');
            temaUygula(simdiki === 'light' ? 'dark' : 'light');
        });
    }
    // head'deki blok data-theme'i zaten kurdu; burada yalnizca tarayici
    // cubugunun rengi hizalaniyor.
    if (temaMeta) {
        temaMeta.setAttribute('content',
            document.documentElement.getAttribute('data-theme') === 'light'
                ? '#faf8f5' : '#0a0a0a');
    }

    // ─── Dil ───
    var langEn = document.getElementById('lang-en');
    var langTr = document.getElementById('lang-tr');
    var bloklar = document.querySelectorAll('[data-doc-lang]');

    // Navigasyon ve altbilgi iki dil blogunun DISINDA duruyor (ikisi icin
    // ortak). Onlar da cevrilmezse TR secili sayfada menu Ingilizce kalir —
    // metin Turkce, cerceve Ingilizce olur. Kisa oldugu icin oz nitelikle
    // tasiniyor: data-t-en / data-t-tr.
    var cerceve = document.querySelectorAll('[data-t-en][data-t-tr]');

    function dilUygula(dil) {
        if (dil !== 'tr') dil = 'en';
        document.documentElement.lang = dil;

        for (var i = 0; i < bloklar.length; i++) {
            var blok = bloklar[i];
            // display:none degil, hidden: ekran okuyucu da atlasin.
            blok.hidden = blok.getAttribute('data-doc-lang') !== dil;
        }

        for (var j = 0; j < cerceve.length; j++) {
            var el = cerceve[j];
            var metin = el.getAttribute('data-t-' + dil);
            // aria-label tasiyan ogede (tema dugmesi) etiketi, digerlerinde
            // gorunen metni degistir.
            if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', metin);
            else el.textContent = metin;
        }

        var baslik = document.querySelector('[data-doc-lang="' + dil + '"] [data-doc-title]');
        if (baslik) document.title = baslik.getAttribute('data-doc-title');

        if (langEn) langEn.classList.toggle('active-lang', dil === 'en');
        if (langTr) langTr.classList.toggle('active-lang', dil === 'tr');

        try { localStorage.setItem('altare-lang', dil); } catch (e) { }
    }

    if (langEn) langEn.addEventListener('click', function () { dilUygula('en'); });
    if (langTr) langTr.addEventListener('click', function () { dilUygula('tr'); });

    var kayitli = null;
    try { kayitli = localStorage.getItem('altare-lang'); } catch (e) { }
    // Tercih yoksa tarayici diline bak — Turkiye'den gelen bir kullaniciya
    // KVKK aydinlatma metnini Ingilizce gostermek dogru degil.
    if (!kayitli) {
        kayitli = (navigator.language || 'en').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en';
    }
    dilUygula(kayitli);
})();
