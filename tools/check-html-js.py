#!/usr/bin/env python3
"""
Altare — HTML içindeki <script type="module"> bloklarının sözdizimi denetimi.

    python3 tools/check-html-js.py

NEDEN VAR — ACI BİR DERSTEN:
panel.html'e aynı isimde ikinci bir `formatDuration` fonksiyonu eklendi.
ES modülünde bu bir SyntaxError'dır: tarayıcı bloğun TAMAMINI ayrıştıramaz,
yani panelin BÜTÜN JavaScript'i ölür — bir fonksiyon değil, hepsi.

Ve hiçbir şey bunu yakalamadı:
  • Render testleri fonksiyonları tek tek çıkarıp çalıştırdığı için geçti
  • test-all.sh yalnızca .js dosyalarını `node --check`'ten geçiriyordu;
    panel.html'in içindeki kod hiç denetlenmiyordu
  • Hata canlıya çıktı ve bir sonraki oturumda tesadüfen fark edildi

Bu betik o boşluğu kapatır: HTML'deki her modül bloğu diske yazılıp
`node --check` ile TAM olarak ayrıştırılır — parça parça değil, bütün olarak.
"""

import os
import re
import subprocess
import sys
import tempfile

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Denetlenecek HTML dosyaları. Yeni bir sayfa modül scripti kazanırsa buraya ekle.
HEDEFLER = ["panel.html", "index.html", "login.html", "signup.html", "discover.html"]

BLOK = re.compile(r'<script\b([^>]*)>(.*?)</script>', re.S | re.I)
TIP = re.compile(r'type\s*=\s*["\']([^"\']+)["\']', re.I)
SRC = re.compile(r'\bsrc\s*=', re.I)


def main() -> int:
    toplam_hata = 0
    denetlenen = 0

    for ad in HEDEFLER:
        yol = os.path.join(KOK, ad)
        if not os.path.isfile(yol):
            continue
        with open(yol, encoding="utf-8") as f:
            html = f.read()

        bloklar = []
        for m in BLOK.finditer(html):
            nitelikler, govde = m.group(1), m.group(2)
            if SRC.search(nitelikler):
                continue                      # harici dosya, ayrıca denetlenir
            if not govde.strip():
                continue
            t = TIP.search(nitelikler)
            tip = t.group(1).lower() if t else "text/javascript"
            if tip not in ("module", "text/javascript", "application/javascript"):
                continue                      # JSON-LD, şablon vb.
            # Blok başlangıcının satır numarası — hata mesajını okunur kılar.
            satir = html[:m.start(2)].count("\n") + 1
            bloklar.append((tip, govde, satir))

        if not bloklar:
            print(f"·  {ad:<18} gömülü script yok")
            continue

        for i, (tip, govde, satir) in enumerate(bloklar):
            denetlenen += 1
            uzanti = ".mjs" if tip == "module" else ".js"
            with tempfile.NamedTemporaryFile(
                "w", suffix=uzanti, delete=False, encoding="utf-8"
            ) as tf:
                tf.write(govde)
                gecici = tf.name
            try:
                r = subprocess.run(
                    ["node", "--check", gecici], capture_output=True, text=True
                )
            finally:
                os.unlink(gecici)

            etiket = f"{ad} [blok {i + 1}, satır {satir}, {tip}]"
            if r.returncode == 0:
                print(f"✓  {etiket} — {len(govde.splitlines())} satır")
            else:
                toplam_hata += 1
                print(f"✗  {etiket}")
                for l in r.stderr.strip().splitlines()[:12]:
                    print("     " + l)

    print("\n" + "=" * 64)
    if denetlenen == 0:
        print("⚠  Hiç gömülü script bulunamadı — hedef listesi doğru mu?")
        return 1
    if toplam_hata == 0:
        print(f"✅  {denetlenen} gömülü script bloğu sözdizimsel olarak sağlam")
    else:
        print(f"❌  {toplam_hata} blok AYRIŞTIRILAMIYOR — o sayfanın TÜM JS'i ölü")
    print("=" * 64)
    return 0 if toplam_hata == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
