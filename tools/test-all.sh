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
# Olay dokumani Firestore'da ve BigQuery'de AYNI alanlari tasimak ZORUNDA.
# Ayrisirlarsa iki depodan hesaplanan ayni metrik farkli cikar ve hangisinin
# dogru oldugu belli olmaz — hicbir hata mesaji da cikmaz. Ayrica maliyet
# korkuluklari (bolumleme, require_partition_filter) DDL'de birer satir:
# biri silinirse tablo yine CALISIR, sadece faturasi katlanir.
calistir "BigQuery (sema paritesi + maliyet korkuluklari)" \
  node tools/test-bigquery.js
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
# Bu ozellik panelden BOLUM GIZLIYOR. Yanlis calisirsa musteri verisini
# goremez ve gizlenmis bir sekme hic var olmamis gibi gorunur — sessiz veri
# kaybinin arayuz hali. Ayrica panel kaydi, SUNUCUNUN okudugu event adlarina
# dayaniyor: iki dosya, tek gercek.
calistir "Panel yuzey uyarlamasi (oyun tipi + gozlenen eventler)" \
  node tools/test-panel-surfaces.mjs
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
# Hukuki sayfalarda iki dil de HTML'in icinde duruyor. Biri guncellenip
# oburu unutulursa Turkce okuyana EKSIK aydinlatma metni gosterilir —
# cirkin degil, KVKK md. 10 karsisinda hatali. Hicbir belirtisi yok.
calistir "Hukuki sayfalar (EN/TR bolum + icindekiler paritesi)" \
  python3 tools/check-legal.py

printf '\n\033[1m▶ Sozdizimi\033[0m\n'
for f in firebase/functions/index.js firebase/functions/experiments.js \
         firebase/functions/funnels.js js/games.js js/i18n.js; do
  if node --check "$f"; then echo "✓ $f"; else
    echo "✗ $f"; basarisiz=$((basarisiz + 1)); fi
done
# NODE SURUMU PARITESI — bu tam olarak bir kez sessizce kaydi:
# dd8482a "Node 22'ye gecis" package.json'i guncelledi, firebase.json'i
# ATLADI. Dagitimda firebase.json KAZANIYOR, yani "gecis" commit'inden
# sonra bile fonksiyonlar Node 20'de calisiyordu. Hicbir hata cikmadi.
if python3 - <<'PYEOF'
import json, re, sys
fb = json.load(open('firebase/firebase.json'))
pkg = json.load(open('firebase/functions/package.json'))
rt = fb['functions'][0].get('runtime', '')          # "nodejs22"
eng = pkg.get('engines', {}).get('node', '')        # "22"
a = re.sub(r'\D', '', rt)
b = re.sub(r'\D', '', eng)
if a and a == b:
    print(f"✓ node surumu: firebase.json={rt} ≡ package.json engines={eng}")
    sys.exit(0)
print(f"✗ NODE SURUMU AYRISMIS: firebase.json={rt!r} vs package.json engines={eng!r}")
print("  dagitimda firebase.json kazanir — kod baska surum bekliyor olabilir")
sys.exit(1)
PYEOF
then :; else basarisiz=$((basarisiz + 1)); fi

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
