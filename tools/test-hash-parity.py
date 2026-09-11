#!/usr/bin/env python3
"""
Altare — FNV-1a / kova atamasi PARITE testi.

    python3 tools/test-hash-parity.py

NEDEN VAR:
Deney atamasi iki yerde hesaplanir — Unity istemcisinde (hangi degerleri
uygulayacagini bilmek icin) ve Cloud Functions'ta (olculen metrigi hangi
varyanta yazacagini bilmek icin). Bu ikisi tek bir bit bile ayrisirsa deney
sessizce anlamsizlasir: hicbir hata mesaji cikmaz, sadece sonuclar rastgele
gruplara dagilir ve her deney "fark yok" der.

BU BETIK NEYI KANITLAR:
C# `uint` aritmetigi tanim geregi mod 2^32'dir ve `Encoding.UTF8.GetBytes`
ile Node'un `Buffer.from(s,'utf8')` ayni bayt dizisini uretir. Asagidaki
Python modeli C# kodunun BIREBIR transkripsiyonudur (maskeleme = uint tasmasi).
Model ile JavaScript ayni sonucu veriyorsa, C# da ayni sonucu verir.

C# kaynagi: unity-sdk/AltareExperiments.cs
JS kaynagi: firebase/functions/experiments.js
"""

import json
import subprocess
import sys
import os

MASK = 0xFFFFFFFF
FNV_OFFSET = 2166136261
FNV_PRIME = 16777619
BUCKET_SPACE = 10000

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fnv1a32(s: str) -> int:
    """C# transkripsiyonu:
         uint h = 2166136261;
         foreach (byte b in Encoding.UTF8.GetBytes(s)) { h ^= b; h *= 16777619; }
       Python'da uint tasmasi acik maskeleme ile modellenir.
    """
    h = FNV_OFFSET
    for b in s.encode("utf-8"):
        h = (h ^ b) & MASK
        h = (h * FNV_PRIME) & MASK
    return h


def exposure_bucket(exp_id: str, pid: str) -> int:
    return fnv1a32(exp_id + ":" + pid) % BUCKET_SPACE


def variant_bucket(exp_id: str, pid: str) -> int:
    return fnv1a32(exp_id + "#" + pid) % BUCKET_SPACE


def yuvarla(x: float) -> int:
    """JS Math.round / C# MidpointRounding.AwayFromZero ile ayni davranis.

    Python'un yerlesik round()'u banker's rounding kullanir (round(0.5) == 0),
    diger iki dil ise yarimi yukari yuvarlar. Pozitif degerlerde ikisi
    ayrisir; modelin sadik olmasi icin burada acikca yarim-yukari yapiyoruz.
    (Ayrica sunucu tarafi yuzdeleri %0.01 izgarasina zorladigi icin tam yarim
    deger pratikte hic olusmaz — bu ikinci savunma hattidir.)
    """
    import math
    return int(math.floor(x + 0.5))


def assign_variant(exp, pid):
    # Bos kimlik atanmaz — JS ve C# tarafinda da ayni koruma var.
    if not exp or not exp.get("id") or not pid:
        return None
    variants = exp.get("variants") or []
    if len(variants) < 2:
        return None
    pct = exp.get("exposurePct")
    if not isinstance(pct, (int, float)) or pct <= 0:
        return None
    giris_esigi = yuvarla(min(100, pct) * (BUCKET_SPACE / 100))
    if exposure_bucket(exp["id"], pid) >= giris_esigi:
        return None
    ic = variant_bucket(exp["id"], pid)
    kumulatif = 0
    for v in variants:
        kumulatif += yuvarla(float(v.get("allocation") or 0) * (BUCKET_SPACE / 100))
        if ic < kumulatif:
            return v["key"]
    return variants[-1]["key"]


# ── Test girdileri — ASCII, Turkce, emoji, GUID, bos, cok uzun ───────────────
GIRDILER = [
    "", "a", "foobar", "player-0001",
    "çğüşiöÇĞÜŞİÖ", "日本語テキスト", "emoji-🎮-oyun",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "altare-studio.chophero",
    "x" * 500,
    "  bosluklu  ", "\t\n satirli",
    "ANON_9f8e7d6c5b4a", "0", "-1", "null", "undefined",
]

DENEYLER = [
    {"id": "exp_abc123", "exposurePct": 100,
     "variants": [{"key": "control", "allocation": 50},
                  {"key": "treatment", "allocation": 50}]},
    {"id": "exp_xyz789", "exposurePct": 10,
     "variants": [{"key": "control", "allocation": 70},
                  {"key": "treatment", "allocation": 30}]},
    {"id": "exp_uc_yollu", "exposurePct": 60,
     "variants": [{"key": "control", "allocation": 34},
                  {"key": "b", "allocation": 33},
                  {"key": "c", "allocation": 33}]},
    {"id": "deney_türkçe_id", "exposurePct": 25,
     "variants": [{"key": "control", "allocation": 50},
                  {"key": "treatment", "allocation": 50}]},
    # Kesirli yuzdeler — yuvarlama yolunu gercekten dolasan durum.
    {"id": "exp_kesirli", "exposurePct": 12.5,
     "variants": [{"key": "control", "allocation": 66.67},
                  {"key": "treatment", "allocation": 33.33}]},
    {"id": "exp_kucuk_dilim", "exposurePct": 0.5,
     "variants": [{"key": "control", "allocation": 99.5},
                  {"key": "treatment", "allocation": 0.5}]},
]

OYUNCULAR = GIRDILER + ["sim-%d" % i for i in range(300)]


def main():
    # 1) Python modeli ile JS uygulamasini karsilastir.
    js = r"""
    const E = require(process.argv[1]);
    const girdi = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
    const out = { hash: {}, assign: {} };
    for (const s of girdi.girdiler) out.hash[s] = E.fnv1a32(s);
    for (const exp of girdi.deneyler) {
      out.assign[exp.id] = {};
      for (const p of girdi.oyuncular) out.assign[exp.id][p] = E.assignVariant(exp, p);
    }
    process.stdout.write(JSON.stringify(out));
    """
    girdi_yolu = "/tmp/altare_parite_girdi.json"
    with open(girdi_yolu, "w", encoding="utf-8") as f:
        json.dump({"girdiler": GIRDILER, "deneyler": DENEYLER,
                   "oyuncular": OYUNCULAR}, f)

    modul = os.path.join(KOK, "firebase", "functions", "experiments.js")
    p = subprocess.run(
        ["node", "-e", js, "--", modul, girdi_yolu],
        capture_output=True, text=True,
    )
    if p.returncode != 0:
        print("node calistirilamadi:\n" + p.stderr)
        return 1
    js_out = json.loads(p.stdout)

    gecen = kalan = 0
    hatalar = []

    for s in GIRDILER:
        beklenen = fnv1a32(s)
        gelen = js_out["hash"][s]
        if beklenen == gelen:
            gecen += 1
        else:
            kalan += 1
            hatalar.append(f"hash uyusmuyor: {s!r} → C#-model={beklenen} JS={gelen}")

    for exp in DENEYLER:
        for pid in OYUNCULAR:
            beklenen = assign_variant(exp, pid)
            gelen = js_out["assign"][exp["id"]][pid]
            if beklenen == gelen:
                gecen += 1
            else:
                kalan += 1
                hatalar.append(
                    f"atama uyusmuyor: {exp['id']} / {pid!r} → "
                    f"C#-model={beklenen} JS={gelen}")

    # 2) Sabit referans vektorleri — C# dosyasi bunlari yorum olarak tasir,
    #    boylece Unity tarafinda elle dogrulanabilir.
    print("\nC# tarafinda dogrulanacak referans degerler:")
    for s in ["", "a", "foobar", "altare-studio.chophero", "çğü"]:
        print(f'  fnv1a32({s!r:<28}) = {fnv1a32(s)}')
    ornek = DENEYLER[0]
    for pid in ["sim-0", "sim-1", "sim-2", "player-0001"]:
        print(f'  assign(exp_abc123, {pid!r:<16}) = {assign_variant(ornek, pid)}'
              f'   (giris kovasi {exposure_bucket("exp_abc123", pid)},'
              f' varyant kovasi {variant_bucket("exp_abc123", pid)})')

    print("\n" + "=" * 64)
    if kalan == 0:
        print(f"✅  PARITE TAM — {gecen} kontrol (C# modeli ≡ JavaScript)")
    else:
        print(f"❌  {kalan} UYUSMAZLIK / {gecen + kalan} kontrol\n")
        for h in hatalar[:20]:
            print("   ✗ " + h)
    print("=" * 64)
    return 0 if kalan == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
