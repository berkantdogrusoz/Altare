#!/usr/bin/env python3
"""
Altare — hukuki sayfaların (gizlilik + kullanım şartları) bütünlük denetimi.

    python3 tools/check-legal.py

NEDEN VAR:
Bu depoda "liste kayması" defalarca çıktı — AI uydurma yasağı listesi,
denetim kaydı eylem listesi, çeviri sözlükleri. Hepsinin ortak hatası aynı:
bir yere eklenen şey öbür yere eklenmiyor ve HİÇBİR BELİRTİ OLMUYOR.

Hukuki sayfalarda bu, listenin en tehlikeli hâli. İki dil de HTML'in içinde
duruyor; biri güncellenip öbürü unutulursa:

  • Türkçe okuyan bir kullanıcıya EKSİK aydınlatma metni gösterilir —
    bu yalnızca çirkin değil, KVKK md. 10 karşısında hatalı.
  • İçindekiler bir bölüme işaret eder ama bölüm yoktur; bağlantı
    hiçbir yere gitmez ve kimse fark etmez.
  • Aynı id iki dilde birden bulunursa tarayıcı YANLIŞ dilin bölümüne
    atlar — gizli blok olduğu için de sayfa boş kaymış gibi görünür.

Üçü de sessizdir. Bu betik üçünü de yakalar.
"""

import io
import os
import re
import sys

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HEDEFLER = ["privacy-policy.html", "terms-of-service.html"]

# Türkçe blokta bu kelimeler Türkçe karakter İÇERMEK ZORUNDA.
TURKCE_TUZAKLARI = [
    ("Gizlilik Politikasi", "Politikası"), ("Kullanim Sartlari", "Kullanım Şartları"),
    ("Icindekiler", "İçindekiler"), ("Haklariniz", "Haklarınız"),
    ("Degisiklikler", "Değişiklikler"), ("Iletisim", "İletişim"),
    ("Cocuklar", "Çocuklar"), ("Saklama suresi", "süresi"),
]


def blok_ayikla(metin, dil):
    """`<div data-doc-lang="xx">` bloğunu, eşleşen kapanışına kadar al."""
    acilis = re.search(r'<div data-doc-lang="' + dil + r'"[^>]*>', metin)
    if not acilis:
        return None

    # İç içe <div>'leri sayarak eşleşen </div>'i bul.
    i = acilis.end()
    derinlik = 1
    for m in re.finditer(r"<(/?)div\b", metin[i:]):
        derinlik += -1 if m.group(1) else 1
        if derinlik == 0:
            return metin[i:i + m.start()]
    return None


def denetle(dosya):
    """Tek bir hukuki sayfayı denetler. Döner: hata listesi."""
    hatalar = []
    metin = io.open(os.path.join(KOK, dosya), encoding="utf-8").read()

    bloklar = {}
    for dil in ("en", "tr"):
        b = blok_ayikla(metin, dil)
        if b is None:
            hatalar.append(f"'{dil}' dil bloğu bulunamadı (data-doc-lang)")
        else:
            bloklar[dil] = b
    if len(bloklar) != 2:
        return hatalar, 0

    sayilar = {}
    for dil, blok in bloklar.items():
        # Sekme başlığı: dil değişince document.title bununla güncelleniyor.
        if 'data-doc-title="' not in blok:
            hatalar.append(f"{dil}: data-doc-title yok — dil değişince sekme başlığı sabit kalır")

        bolumler = re.findall(r"<section\b", blok)
        numaralar = re.findall(r'<span class="n">(\d+)</span>', blok)
        idler = re.findall(r'<h2 id="([^"]+)"', blok)
        toc = re.findall(r'<a href="#([^"]+)"', blok)

        sayilar[dil] = (len(bolumler), numaralar, idler, toc)

        if len(bolumler) != len(numaralar):
            hatalar.append(
                f"{dil}: {len(bolumler)} <section> var ama {len(numaralar)} numara — "
                "bir bölüm numarasız")
        if len(idler) != len(numaralar):
            hatalar.append(
                f"{dil}: {len(idler)} <h2 id> var ama {len(numaralar)} numara — "
                "bir bölüme bağlantı verilemez")

        # Numaralar 01'den başlayıp kesintisiz artmalı.
        beklenen = [f"{n:02d}" for n in range(1, len(numaralar) + 1)]
        if numaralar != beklenen:
            hatalar.append(f"{dil}: bölüm numaraları sırasız/atlamalı: "
                           f"{' '.join(numaralar)}")

        # İçindekiler ile bölümler birebir örtüşmeli.
        ic_toc = [t for t in toc if t in idler]
        eksik_toc = [i for i in idler if i not in toc]
        if eksik_toc:
            hatalar.append(f"{dil}: içindekilerde YOK: {', '.join(eksik_toc)}")
        kirik = [t for t in toc if t not in idler and not t.startswith("http")]
        if kirik:
            hatalar.append(f"{dil}: içindekiler olmayan bölüme işaret ediyor: "
                           f"{', '.join(kirik)}")
        if len(ic_toc) != len(set(ic_toc)):
            hatalar.append(f"{dil}: içindekilerde tekrar eden bağlantı var")

    # ── İki dil arasında kayma ──
    en_bolum, en_num = sayilar["en"][0], sayilar["en"][1]
    tr_bolum, tr_num = sayilar["tr"][0], sayilar["tr"][1]
    if en_bolum != tr_bolum:
        hatalar.append(
            f"DİL KAYMASI: EN'de {en_bolum} bölüm, TR'de {tr_bolum} bölüm — "
            "bir dile eklenen bölüm öbürüne eklenmemiş")
    elif en_num != tr_num:
        hatalar.append(f"DİL KAYMASI: bölüm numaraları farklı "
                       f"(EN: {' '.join(en_num)} / TR: {' '.join(tr_num)})")

    # ── id çakışması: iki dil AYNI id'yi kullanamaz ──
    ortak = set(sayilar["en"][2]) & set(sayilar["tr"][2])
    if ortak:
        hatalar.append(
            "İki dilde de aynı id var, tarayıcı yanlış (gizli) bloğa atlar: "
            + ", ".join(sorted(ortak)))

    # ── Türkçe karakter tuzakları ──
    for yanlis, dogru in TURKCE_TUZAKLARI:
        if yanlis in bloklar["tr"]:
            hatalar.append(f"Türkçe karakteri eksik: '{yanlis}' -> '{dogru}'")

    # ── Çerçeve (navigasyon + altbilgi) ──
    # Bunlar iki dil bloğunun DIŞINDA, ikisi için ortak duruyor; çevirisi
    # data-t-en / data-t-tr ile taşınıyor. Yeni bir bağlantı bu niteliksiz
    # eklenirse TR sayfada İngilizce kalır ve hiçbir belirti olmaz.
    for kap in ("nav-links", "footer-links"):
        m = re.search(r'class="' + kap + r'"[^>]*>(.*?)</(?:ul|div)>', metin, re.S)
        if not m:
            hatalar.append(f"'{kap}' bulunamadı")
            continue
        for bag in re.findall(r"<a\b[^>]*>", m.group(1)):
            if "data-t-en=" not in bag or "data-t-tr=" not in bag:
                etiket = re.search(r'href="([^"]*)"', bag)
                hatalar.append(
                    f"{kap}: çevirisiz bağlantı (data-t-en/data-t-tr yok): "
                    + (etiket.group(1) if etiket else bag[:50]))

    return hatalar, en_bolum


def main() -> int:
    toplam = 0
    for dosya in HEDEFLER:
        yol = os.path.join(KOK, dosya)
        if not os.path.isfile(yol):
            print(f"·  {dosya:<26} atlandı (yok)")
            continue
        hatalar, bolum = denetle(dosya)
        if hatalar:
            toplam += len(hatalar)
            print(f"✗  {dosya}")
            for h in hatalar:
                print("     " + h)
        else:
            print(f"✓  {dosya:<26} {bolum} bölüm · EN≡TR · içindekiler tam")

    print("\n" + "=" * 64)
    if toplam == 0:
        print("✅  Hukuki sayfalar bütün — dil kayması yok")
    else:
        print(f"❌  {toplam} sorun")
    print("=" * 64)
    return 0 if toplam == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
