# Altare

Altare resmi sitesi + **Altare AI Live Game Intelligence** platformu.

- **Site:** https://altarestudio.com.tr
- **Panel:** https://altarestudio.com.tr/panel.html (sadece yetkili admin)
- **Vizyon:** [`docs/ALTARE_AI_VISION.md`](docs/ALTARE_AI_VISION.md)
- **Ölçeklenme & yatırım yol haritası:** [`docs/ALTARE_SCALE_ROADMAP.md`](docs/ALTARE_SCALE_ROADMAP.md) — teknik borç, ürün öncelikleri, 12 aylık sıralama
- **Değişiklik kaydı:** [`docs/DEGISIKLIK_KAYDI.md`](docs/DEGISIKLIK_KAYDI.md) — ne değişti, neden önemliydi
- **Kurulum / deploy:** [`docs/SETUP.md`](docs/SETUP.md)

## Repo

```
.
├── index.html              # Marketing site (root)
├── panel.html              # /altare-ai-panel dashboard (admin-only)
├── login.html              # Firebase Auth giriş
├── js/                     # Firebase init + auth helpers
├── firebase/               # Firestore rules + Cloud Functions
├── unity-sdk/              # Drop-in Unity SDK (Firebase gerektirmez)
├── tools/                  # Testler — ağ/emulator/Unity gerekmez
└── docs/                   # Vizyon + kurulum + yol haritası
```

İlk kurulum için [`docs/SETUP.md`](docs/SETUP.md)'yi sırayla takip et.

## Testler

Deploy öncesi tek komut:

```bash
bash tools/test-all.sh
```

Ağ, Firebase emulator'ü veya Unity gerektirmez. Kontrol edilenler:
A/B deney motorunun istatistiği, huni analizinin sıralı-yol ve olgunlaşma
kuralları, AI'ın uydurma yasağının iki yönlü doğruluğu, istemci/sunucu hash
paritesi (C# ≡ JavaScript — tek bit ayrışma her deneyi sessizce
anlamsızlaştırır), JSON ayrıştırıcı, panel render'ı ve Unity SDK'nın
yapısal dengesi.

## ⚠️ Önce bunu oku

[`docs/ALTARE_KONUMLANDIRMA.md`](docs/ALTARE_KONUMLANDIRMA.md) — **Altare bir
oyun stüdyosudur.** Panel, stüdyonun hem kendi içinde kullandığı hem de
dışarıya sunduğu bir hizmettir. Ana site oyunları ve şirketi anlatır; panel
sonradan anlatılır. Bu bir tercih değil, sınırdır — site veya anlatı üzerinde
çalışmadan önce o dosyayı oku.

## Nerede durduğumuzu görmek için

[`docs/ALTARE_SCALE_ROADMAP.md` §0.1](docs/ALTARE_SCALE_ROADMAP.md) —
durum panosu: ne kapatıldı, ne açık, neden bekliyor.
[`docs/DEGISIKLIK_KAYDI.md`](docs/DEGISIKLIK_KAYDI.md) — ne değişti ve
**neden önemliydi**.
