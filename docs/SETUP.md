# Altare AI Panel — Kurulum & Deploy Rehberi

Bu doküman, Altare AI Live Game Intelligence platformunu sıfırdan canlıya almak için adım adım talimatları içerir. Sıraya uy — her adım bir öncekine bağlı.

> **Firebase Project ID:** `altare-312a1`
> **Site:** `altarestudio.com.tr` (GitHub Pages — `berkantdogrusoz/Altare`)
> **Functions Region:** `europe-west1`

---

## 1. Firebase Console — Web App Ekle

Şu an Firebase'de sadece Android app (`com.Altare.BlastMatch`) kayıtlı. Panel için bir Web app eklemen gerekiyor.

1. https://console.firebase.google.com/project/altare-312a1/settings/general
2. **Your apps** bölümünde **Add app** → **`</>` (Web)** ikonu.
3. App nickname: `Altare AI Panel`
4. **Set up Firebase Hosting** → işaretsiz bırak (GitHub Pages kullanıyoruz).
5. **Register app** bas.
6. Çıkan `firebaseConfig` objesinden `apiKey` ve `appId` değerlerini kopyala.
7. `js/firebase-config.js` dosyasında şu satırları doldur:

```js
apiKey: "REPLACE_WITH_WEB_API_KEY",   // ← apiKey buraya
appId:  "REPLACE_WITH_WEB_APP_ID",    // ← appId buraya
```

> Diğer alanlar (`authDomain`, `projectId`, `storageBucket`, `messagingSenderId`) zaten dolu — proje sabit değerleri.

---

## 2. Firebase Authentication — Email/Password Aç

1. https://console.firebase.google.com/project/altare-312a1/authentication/providers
2. **Get started** veya **Sign-in method** sekmesinde:
   - **Email/Password** → **Enable** → **Save**
   - **Anonymous** → **Enable** → **Save** (Unity SDK bunu kullanacak)
3. **Settings** → **Authorized domains**:
   - `altarestudio.com.tr` ekle (yoksa)
   - `localhost` zaten ekli olmalı (geliştirme için)

---

## 3. Firestore Database — Oluştur

1. https://console.firebase.google.com/project/altare-312a1/firestore
2. **Create database** → **Production mode** seç → **eur3 (europe-west)** location.
3. Database oluşunca, **Rules** sekmesi `firebase/firestore.rules` dosyasındakiyle değiştirilecek (CLI ile yapılacak — adım 5).

---

## 4. Firebase CLI Kurulumu

Local makinede (Windows / WSL):

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase use altare-312a1
```

`firebase use` komutu mevcut `firebase/.firebaserc` dosyası yoksa onu oluşturur. Eğer ister:

```bash
firebase use --add altare-312a1
```

ve alias olarak `default` ver.

---

## 5. Firestore Rules + Indexes Deploy

```bash
cd firebase
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

Index oluşturulması 1-5 dakika sürer. Console'dan **Firestore → Indexes** sekmesinden takip edebilirsin.

---

## 6. Cloud Functions — Plan Yükseltme + API Key

Cloud Functions, Anthropic API'sine HTTPS isteği atıyor. Bunun için **Blaze (pay-as-you-go)** plan gerekli — Spark ücretsiz plan dış HTTPS çağrılarını engelliyor.

### 6a. Blaze plan'a geç

1. https://console.firebase.google.com/project/altare-312a1/usage/details
2. **Modify plan** → **Blaze** seç → kart bilgilerini gir.
3. Aylık bütçe sınırı ekle (önerilen: **$25/ay** → kazara fatura riskine karşı).

> AI raporlarını manuel + günde 1-2 kez üreteceksen aylık fatura $1-3 arasında kalır. Aggregate Cloud Function'ı her 30 dk çalışıyor (free tier yeter, ücretsiz).

### 6b. Anthropic API Key

1. https://console.anthropic.com/settings/keys
2. **Create Key** → adı `altare-cloud-functions`.
3. Çıkan key'i kopyala (`sk-ant-…`).

### 6c. Functions deploy

```bash
cd firebase/functions
npm install
cd ..

# API key'i secret olarak ekle (interaktif, ekrana yazmaz):
firebase functions:secrets:set ANTHROPIC_API_KEY

# Functions deploy
firebase deploy --only functions
```

Deploy başarılıysa şu üç function aktif olur:
- `generateAIReport` (callable, admin-only)
- `aggregateDailyStats` (her 30 dk, otomatik)
- `setAdminRole` (callable, admin-only — admin allowlist yönetimi)

---

## 7. İlk Admin Hesabını Oluştur

Email/Password auth açık olduğu için, ilk admin'i Console'dan manuel ekliyoruz.

### 7a. Auth'tan kullanıcı oluştur

1. https://console.firebase.google.com/project/altare-312a1/authentication/users
2. **Add user** → email + şifre gir → **Add user**.
3. Oluşan kullanıcının **User UID**'sini kopyala.

### 7b. Admin claim'i set et

İki yol var. **Yol A** (önerilen) Cloud Shell'den:

1. https://console.firebase.google.com → sağ üst **Cloud Shell** ikonu (`>_`).
2. Şu komutu çalıştır (UID'yi yapıştır):

```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'altare-312a1' });
admin.auth().setCustomUserClaims('PASTE_UID_HERE', { admin: true })
  .then(() => console.log('OK')).catch(e => console.error(e));
"
```

**Yol B** (local makineden, gcloud CLI gerektirir):

```bash
gcloud auth application-default login
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'altare-312a1' });
admin.auth().setCustomUserClaims('PASTE_UID_HERE', { admin: true })
  .then(() => console.log('OK')).catch(e => console.error(e));
"
```

Sonraki admin'leri panel üzerinden `setAdminRole` callable function'ıyla ekleyebilirsin (henüz UI yok — Cloud Function elle çağrılır).

---

## 8. Site Deploy (GitHub Pages)

Site GitHub Pages'de yayında. Yeni dosyalar (`login.html`, `js/`, `panel.html` güncel) push'landığında otomatik deploy olur.

```bash
git add .
git commit -m "feat: Altare AI Panel — Firebase + auth + Firestore wiring"
git push origin claude/urgent-task-help-CWsny
```

> Branch'i `main`'e merge ettiğinde production deploy gerçekleşir.

---

## 9. Test — End-to-End

### 9a. Login akışı

1. https://altarestudio.com.tr/login.html
2. 7. adımdaki email/şifre ile giriş yap.
3. Başarılı login → `/panel.html` yönlendirme.
4. Sağ üstte adın ve avatar görünmeli.
5. **Çıkış** butonu çalışıyor olmalı.

### 9b. Empty state'ler

Henüz Unity'den event gelmediği için:
- Genel Bakış: KPI'lar `—` gösteriyor
- Canlı Event Stream: empty state mesajı
- Level Intelligence: empty state mesajı
- AI Raporu: "Henüz rapor üretilmedi"

### 9c. Manuel event yazımı (test için)

Cloud Shell'den (veya local Node) bir test event'i yaz:

```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'altare-312a1' });
const db = admin.firestore();
db.collection('games').doc('royal-dreams').collection('events').add({
  gameId: 'royal-dreams',
  gameName: 'Royal Dreams',
  playerAnonId: 'test-player-001',
  eventName: 'level_start',
  eventParams: { level: 18 },
  timestamp: admin.firestore.FieldValue.serverTimestamp(),
  platform: 'Android',
  appVersion: '1.0.0',
  deviceModel: 'Test Device',
}).then(r => console.log('OK', r.id));
"
```

Panel'in **Canlı Event Stream** sekmesi anında bu event'i göstermeli.

### 9d. AI raporu üretimi

1. Panel → **AI Raporu** sekmesi
2. **Yeni AI Raporu Üret** butonuna bas
3. ~10-30 saniye sonra Claude'dan dönen rapor render olmalı
4. **Genel Bakış** sekmesinde de "Önerilen Aksiyon" kartı dolmalı

> Eğer çıkıyorsa "Bu zaman aralığında oyundan hiç event yok" hatası → daha çok test event'i yazıp tekrar dene.

---

## 10. Unity Entegrasyonu

Royal Dreams (veya başka bir oyun) Unity projesine:

1. **Firebase Unity SDK** indir: https://firebase.google.com/download/unity
   - Sadece **Authentication** + **Firestore** modüllerini import et.
2. `unity-sdk/AltareAnalytics.cs` dosyasını projenin `Assets/Scripts/Altare/` klasörüne kopyala.
3. `google-services.json` dosyasını Firebase Console → Project Settings → Android app'ten indir, `Assets/` kökü altına koy.
4. Bootstrap'ında (örn. `GameRoot.cs` `Start()`):
   ```csharp
   using Altare.Analytics;
   void Start() {
       AltareAnalytics.Initialize("royal-dreams", "Royal Dreams");
   }
   ```
5. Gameplay event'lerini ekle:
   ```csharp
   AltareAnalytics.LogEvent("level_start",    new() { { "level", level } });
   AltareAnalytics.LogEvent("level_complete", new() { { "level", level }, { "score", score } });
   AltareAnalytics.LogEvent("level_fail",     new() { { "level", level }, { "moves_used", moves } });
   AltareAnalytics.LogEvent("ad_watched",     new() { { "placement", "continue" } });
   AltareAnalytics.LogEvent("iap_purchase_success", new() { { "sku", sku }, { "amount_usd", price } });
   ```
6. Build → install → oyna. Event'ler `games/royal-dreams/events/*` altına anında düşer.

> Crimson Scar için aynı SDK, sadece `Initialize("crimson-scar", "Crimson Scar")` çağrısı yeter. Panel'in oyun seçicisinden Crimson Scar'a geçip canlı veriyi görebilirsin.

---

## 11. Üretim Notları

- **Maliyet**: Firestore okuma/yazma + Cloud Functions invocation + Anthropic token kullanımı. Aylık $5-30 bandında kalmalı (1 aktif oyun + günlük 2-3 AI raporu varsayımı).
- **Quota**: Firestore default 1M reads/day free → AI panel 1-2 admin için sorun değil.
- **Index oluşumu**: Yeni bir `eventName` ile filter yaparsan Firestore index isteyebilir, console'daki link tıklanır.
- **Yeni oyun ekleme**: Panel'in `GAME_NAMES` mapping'ine ID + display ad ekle, Unity'de `Initialize` çağrısını yap → bitti.
- **Pazar scraper'ı (Faz 2)**: `market-scraper/` klasörü henüz yok; google-play-scraper paketiyle Cloud Run job olarak yazılacak ve `market_intel/{categoryId}/competitors/*` koleksiyonuna yazacak.

---

## 12. Sorun Giderme

| Belirti | Olası Sebep | Çözüm |
|---|---|---|
| Login sonrası "Yetkisiz erişim" sayfası | Custom claim `admin: true` set edilmemiş | Adım 7b'yi tekrar et, sonra logout/login |
| Panel'de KPI'lar hep `—` | `aggregateDailyStats` Cloud Function henüz çalışmadı veya event yok | 30 dakika bekle veya Functions Console'dan elle tetikle |
| `generateAIReport` 403 / unauthenticated | Login token eski | Çıkış yap, tekrar gir |
| `generateAIReport` "API 401" | Anthropic key hatalı | `firebase functions:secrets:set ANTHROPIC_API_KEY` ile yeniden gir, redeploy |
| Unity build → "Firebase init failed" | `google-services.json` yok / yanlış paket adı | Console'dan tekrar indir, `Assets/` köküne koy |
| Firestore "permission denied" Unity'de | Anonymous auth devre dışı | Adım 2'de Anonymous provider'ı aç |
