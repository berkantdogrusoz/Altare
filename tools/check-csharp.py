#!/usr/bin/env python3
"""
Altare — Unity SDK C# yapisal denetimi.

    python3 tools/check-csharp.py

NEDEN VAR:
Bu depoda C# derleyicisi yok (Unity tarafinda derleniyor). Elle duzenlenen
bir dosyada dengesiz kalan tek bir susli parantez, kullanici paketi indirip
Unity'ye attiginda derleme hatasi olarak patlar — yani hatayi MUSTERI bulur.
Bu betik o sinifi burada yakalar.

NASIL:
Naif bir regex ISE YARAMAZ — "https://" bir yorum sanilir, Turkce kesme
isareti ('Panel'de) karakter sabiti sanilir. Bu yuzden asagida gercek bir
tokenizer durum makinesi var: yorumlari, metinleri (@"" verbatim dahil) ve
karakter sabitlerini dogru ayirir, sonra yalnizca KOD uzerinde denge sayar.
"""

import os
import sys

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SDK = os.path.join(KOK, "unity-sdk")

# Bootstrap bilerek global namespace'tedir: Inspector'dan surukle-birak
# eklenebilmesi ve SDK'ya derleme zamani bagimliligi olmamasi icin
# (AltareAnalytics'e reflection ile erisir). Bu bir eksiklik degil, tasarim.
NAMESPACE_MUAF = {"AltareAnalyticsBootstrap.cs"}


def kodu_ayikla(src: str):
    """Yorum / metin / karakter sabitlerini bosluga cevirir, kodu birakir.

    Doner: (kod, bulgular) — bulgular yapisal uyarilardir.
    """
    out = []
    bulgular = []
    i, n = 0, len(src)
    satir = 1

    while i < n:
        c = src[i]
        ileri = src[i + 1] if i + 1 < n else ""

        if c == "\n":
            satir += 1
            out.append("\n")
            i += 1
            continue

        # ── satir yorumu ──
        if c == "/" and ileri == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue

        # ── blok yorumu ──
        if c == "/" and ileri == "*":
            i += 2
            kapandi = False
            while i < n:
                if src[i] == "\n":
                    satir += 1
                    out.append("\n")
                if src[i] == "*" and i + 1 < n and src[i + 1] == "/":
                    i += 2
                    kapandi = True
                    break
                i += 1
            if not kapandi:
                bulgular.append(f"satir {satir}: blok yorumu kapanmamis (/* ... )")
            continue

        # ── verbatim metin: @"..."  (icinde "" kacistir) ──
        if c == "@" and ileri == '"':
            i += 2
            kapandi = False
            while i < n:
                if src[i] == "\n":
                    satir += 1
                    out.append("\n")
                if src[i] == '"':
                    if i + 1 < n and src[i + 1] == '"':
                        i += 2
                        continue
                    i += 1
                    kapandi = True
                    break
                i += 1
            if not kapandi:
                bulgular.append(f"satir {satir}: verbatim metin kapanmamis (@\")")
            continue

        # ── normal metin: "..." ──
        if c == '"':
            basladi = satir
            i += 1
            kapandi = False
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "\n":
                    break                      # normal metin satir asamaz
                if src[i] == '"':
                    i += 1
                    kapandi = True
                    break
                i += 1
            if not kapandi:
                bulgular.append(f"satir {basladi}: metin sabiti kapanmamis (\")")
            continue

        # ── karakter sabiti: 'c' / '\n' / 'A' ──
        # DIKKAT: Turkce metinlerdeki kesme isareti ("Panel'de") kod DISINDA
        # kaldigi icin buraya hic gelmez; buraya gelen tek tirnak gercekten
        # karakter sabitidir. Yine de yanlis eslesmeyi onlemek icin kapanisi
        # ayni satirda ve en fazla 10 karakter icinde ariyoruz.
        if c == "'":
            j = i + 1
            if j < n and src[j] == "\\":
                j += 2
                while j < n and src[j] not in ("'", "\n") and j - i < 12:
                    j += 1
            elif j < n and src[j] != "\n":
                j += 1
            if j < n and src[j] == "'":
                i = j + 1
                continue
            bulgular.append(f"satir {satir}: kapanmamis karakter sabiti (')")
            i += 1
            continue

        out.append(c)
        i += 1

    return "".join(out), bulgular


def dengele(kod: str):
    """Susli/koseli/normal parantez dengesini satir bilgisiyle dogrular."""
    esler = {")": "(", "]": "[", "}": "{"}
    yigin = []
    hatalar = []
    satir = 1
    for ch in kod:
        if ch == "\n":
            satir += 1
        elif ch in "([{":
            yigin.append((ch, satir))
        elif ch in ")]}":
            if not yigin:
                hatalar.append(f"satir {satir}: fazladan '{ch}'")
                continue
            acik, acik_satir = yigin.pop()
            if acik != esler[ch]:
                hatalar.append(
                    f"satir {satir}: '{ch}' ile eslesmeyen acilis "
                    f"'{acik}' (satir {acik_satir})")
    for acik, acik_satir in yigin:
        hatalar.append(f"satir {acik_satir}: '{acik}' kapanmamis")
    return hatalar


def main():
    if not os.path.isdir(SDK):
        print("unity-sdk/ bulunamadi")
        return 1

    dosyalar = sorted(f for f in os.listdir(SDK) if f.endswith(".cs"))
    if not dosyalar:
        print("unity-sdk/ icinde .cs dosyasi yok")
        return 1

    toplam_hata = 0
    for ad in dosyalar:
        yol = os.path.join(SDK, ad)
        with open(yol, encoding="utf-8") as f:
            src = f.read()

        kod, bulgular = kodu_ayikla(src)
        hatalar = bulgular + dengele(kod)

        # Tokenizer'in saglamligi icin: interpolasyonlu metin ($"...{x}...")
        # icindeki susli parantezler kod sanilir. Simdilik kullanmiyoruz;
        # kullanilirsa bu denetim guncellenmeli.
        if '$"' in kod:
            hatalar.append(
                'interpolasyonlu metin ($"...") kullanilmis — bu denetim onu '
                "dogru sayamaz, tokenizer guncellenmeli")

        # Dosya gercekten bir C# tipi tanimliyor mu?
        if "class " not in src and "struct " not in src:
            hatalar.append("dosyada class/struct tanimi yok")
        # Cekirdek moduller ortak namespace'te olmali ki birbirini gorsun.
        if ad not in NAMESPACE_MUAF and "namespace Altare.Analytics" not in src:
            hatalar.append("'namespace Altare.Analytics' bulunamadi")

        if hatalar:
            toplam_hata += len(hatalar)
            print(f"\n❌ {ad}")
            for h in hatalar:
                print("   ✗ " + h)
        else:
            satir_sayisi = src.count("\n") + 1
            print(f"✓ {ad:<28} {satir_sayisi:>5} satir — denge tamam")

    print("\n" + "=" * 64)
    if toplam_hata == 0:
        print(f"✅  {len(dosyalar)} C# dosyasi yapisal olarak saglam")
    else:
        print(f"❌  {toplam_hata} yapisal sorun")
    print("=" * 64)
    return 0 if toplam_hata == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
