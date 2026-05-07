# Altare

Altare resmi sitesi + **Altare AI Live Game Intelligence** platformu.

- **Site:** https://altarestudio.com.tr
- **Panel:** https://altarestudio.com.tr/panel.html (sadece yetkili admin)
- **Vizyon:** [`docs/ALTARE_AI_VISION.md`](docs/ALTARE_AI_VISION.md)
- **Kurulum / deploy:** [`docs/SETUP.md`](docs/SETUP.md)

## Repo

```
.
├── index.html              # Marketing site (root)
├── panel.html              # /altare-ai-panel dashboard (admin-only)
├── login.html              # Firebase Auth giriş
├── js/                     # Firebase init + auth helpers
├── firebase/               # Firestore rules + Cloud Functions
├── unity-sdk/              # AltareAnalytics.cs (drop-in Unity)
└── docs/                   # Vizyon + kurulum
```

İlk kurulum için [`docs/SETUP.md`](docs/SETUP.md)'yi sırayla takip et.
