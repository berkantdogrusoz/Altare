#!/usr/bin/env bash
# Altare — tum testler. Deploy oncesi bunu calistir.
#
#   bash tools/test-all.sh
#
# Hicbiri ag, Firebase emulatoru ya da Unity gerektirmez.

set -u
cd "$(dirname "$0")/.."

basarisiz=0
calistir() {
  local ad="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$ad"
  if "$@"; then :; else basarisiz=$((basarisiz + 1)); fi
}

calistir "A/B deney motoru (atama + istatistik + karar kurallari)" \
  node tools/test-experiments.js
calistir "Huni analizi (sirali yol + olgunlasma + donusum)" \
  node tools/test-funnels.js
calistir "AI baglam blogu (uydurma yasagi tek kaynaktan)" \
  node tools/test-ai-context.js
calistir "Denetim kaydi (eksiksizlik + degismezlik)" \
  node tools/test-audit.js
calistir "Istemci/sunucu hash paritesi (C# modeli ≡ JavaScript)" \
  python3 tools/test-hash-parity.py
calistir "AltareJson ayristirici (≡ JSON.parse)" \
  node tools/test-json-parser.js
calistir "Panel deney karti render'i" \
  node tools/test-panel-experiments.mjs
calistir "Panel huni karti render'i" \
  node tools/test-panel-funnels.mjs
calistir "Panel denetim kaydi render'i" \
  node tools/test-panel-audit.mjs
calistir "Unity SDK C# yapisal denge" \
  python3 tools/check-csharp.py
# ⚠ Bunu ATLAMA: panel.html'in icindeki modul blogu TEK PARCA ayristirilir.
# Render testleri fonksiyonlari tek tek cikarip calistirdigi icin
# "ayni isimde iki fonksiyon" gibi MODUL SEVIYESI hatalari goremez —
# oyle bir hata sayfanin TUM JS'ini oldurur ve bir kez canliya cikti.
calistir "HTML ici script bloklari (modul seviyesi sozdizimi)" \
  python3 tools/check-html-js.py
# Ceviri kaymasi bu depoda tekrar tekrar cikti: bir yere eklenen anahtar
# obur yere eklenmiyor ve HICBIR BELIRTI olmuyor — dil degisince metin
# oldugu gibi kaliyor.
calistir "Ceviri sozlukleri (EN/TR butunlugu)" \
  python3 tools/check-i18n.py

printf '\n\033[1m▶ Sozdizimi\033[0m\n'
for f in firebase/functions/index.js firebase/functions/experiments.js \
         firebase/functions/funnels.js js/games.js js/i18n.js; do
  if node --check "$f"; then echo "✓ $f"; else
    echo "✗ $f"; basarisiz=$((basarisiz + 1)); fi
done
if python3 -c "import json,sys;json.load(open('firebase/firestore.indexes.json'))"; then
  echo "✓ firebase/firestore.indexes.json"
else
  echo "✗ firebase/firestore.indexes.json"; basarisiz=$((basarisiz + 1))
fi

echo
echo "================================================================"
if [ "$basarisiz" -eq 0 ]; then
  echo "✅  HER SEY GECTI — deploy edilebilir"
else
  echo "❌  $basarisiz ADIM BASARISIZ — deploy ETME"
fi
echo "================================================================"
exit "$basarisiz"
