#!/usr/bin/env python3
"""
Altare — çeviri (i18n) bütünlük denetimi.

    python3 tools/check-i18n.py

NEDEN VAR:
Bu depoda "liste kayması" tekrar tekrar çıktı — AI'ın uydurma yasağı listesi,
denetim kaydı eylem listesi, ve çeviri sözlükleri. Hepsinin ortak hatası aynı:
bir yere eklenen şey öbür yere eklenmiyor ve HİÇBİR BELİRTİ OLMUYOR.

Çeviride bu şöyle görünür:
  • Anahtar TR'de yok  → dil değiştirilince o metin İngilizce kalır
  • Anahtar EN'de yok  → İngilizce sürümde Türkçe metin görünür
  • Anahtar hiç kullanılmıyor → ölü kod, kimse fark etmez
  • Türkçe metinde Türkçe karakter yok ("Hakkimizda") → kalitesiz görünür

Dördü de sessizdir. Bu betik dördünü de yakalar.
"""

import io
import os
import re
import sys

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Türkçe'de bu kelimeler özel karakter İÇERMEK ZORUNDA.
# Sol taraf "yanlış yazım", sağ taraf doğrusu.
TURKCE_TUZAKLARI = [
    ("Hakkimizda", "Hakkımızda"), ("Iletisim", "İletişim"),
    ("Cevrimdisi", "Çevrimdışı"), ("Kurulus", "Kuruluş"),
    ("Yayinlanan", "Yayınlanan"), ("Stüdyosu", None),   # None = zaten doğru
    ("savas", "savaş"), ("gecen", "geçen"), ("Bulmaca", None),
    ("Oyunlarimiz", "Oyunlarımız"), ("Portföy", None),
    ("Tüm haklari", "Tüm hakları"), ("Indirme", "İndirme"),
    ("Bizе", None),
]


def sozlukleri_ayikla(metin, ad):
    """`en: { ... }` ve `tr: { ... }` bloklarını ve içlerindeki anahtarları al."""
    out = {}
    for dil in ("en", "tr"):
        # Blok, kendi girinti düzeyindeki kapanış süslüsüne kadar sürer.
        m = re.search(r"^(\s*)" + dil + r":\s*\{\n(.*?)\n\1\}", metin, re.S | re.M)
        if not m:
            return None, f"{ad}: '{dil}' sözlüğü bulunamadı"
        out[dil] = set(re.findall(r"^\s*'([a-zA-Z0-9_.-]+)':", m.group(2), re.M))
        out[dil + "_metin"] = m.group(2)
    return out, None


def denetle(ad, html_yollari, sozluk_yolu):
    """Bir çeviri kümesini denetler. Döner: hata listesi."""
    hatalar = []

    kaynak = io.open(os.path.join(KOK, sozluk_yolu), encoding="utf-8").read()
    sozlukler, hata = sozlukleri_ayikla(kaynak, sozluk_yolu)
    if hata:
        return [hata]

    en, tr = sozlukler["en"], sozlukler["tr"]

    # HTML'de gerçekten kullanılan anahtarlar
    kullanilan = set()
    for yol in html_yollari:
        h = io.open(os.path.join(KOK, yol), encoding="utf-8").read()
        kullanilan |= set(re.findall(
            r'data-i18n(?:-html|-placeholder)?="([a-zA-Z0-9_.-]+)"', h))
        kullanilan |= set(re.findall(r"\bt\('([a-zA-Z0-9_.-]+)'\)", h))

    for k in sorted(kullanilan - en):
        hatalar.append(f"EN sözlüğünde YOK (İngilizce'de çevrilmez): {k}")
    for k in sorted(kullanilan - tr):
        hatalar.append(f"TR sözlüğünde YOK (Türkçe'de İngilizce kalır): {k}")
    for k in sorted(en - tr):
        hatalar.append(f"yalnızca EN'de var: {k}")
    for k in sorted(tr - en):
        hatalar.append(f"yalnızca TR'de var: {k}")

    # Türkçe karakter tuzakları
    tr_metin = sozlukler["tr_metin"]
    for yanlis, dogru in TURKCE_TUZAKLARI:
        if dogru and re.search(r"[>'\s]" + re.escape(yanlis) + r"[<'\s.,]", tr_metin):
            hatalar.append(f"Türkçe karakteri eksik: '{yanlis}' -> '{dogru}'")

    if not hatalar:
        # Dinamik anahtarlar (t('x.' + y)) statik taramada görünmez, o yüzden
        # "ölü anahtar" yalnızca bilgi olarak yazılır, hata sayılmaz.
        olu = sorted((en & tr) - kullanilan)
        durum = f"{len(en)} anahtar · EN≡TR"
        if olu:
            durum += f" · {len(olu)} anahtar statik taramada görünmedi (dinamik olabilir)"
        print(f"✓  {ad:<26} {durum}")
    return hatalar


def main() -> int:
    kumeler = [
        # (ad, iceren HTML dosyalari, ceviri sozlugunun bulundugu dosya)
        ("index.html (site)", ["index.html"], "index.html"),
        ("panel.html + i18n.js", ["panel.html"], "js/i18n.js"),
    ]

    toplam = 0
    for ad, htmller, sozluk in kumeler:
        eksikler = [y for y in htmller + [sozluk]
                    if not os.path.isfile(os.path.join(KOK, y))]
        if eksikler:
            print(f"·  {ad:<26} atlandı (yok: {', '.join(eksikler)})")
            continue
        hatalar = denetle(ad, htmller, sozluk)
        if hatalar:
            toplam += len(hatalar)
            print(f"✗  {ad}")
            for h in hatalar[:25]:
                print("     " + h)
            if len(hatalar) > 25:
                print(f"     … ve {len(hatalar) - 25} tane daha")

    print("\n" + "=" * 64)
    if toplam == 0:
        print("✅  Çeviri sözlükleri bütün — kayma yok")
    else:
        print(f"❌  {toplam} çeviri sorunu")
    print("=" * 64)
    return 0 if toplam == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
