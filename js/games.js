// =============================================================================
// games.js — Self-Service Multi-Tenant Game Management + SDK Download
// -----------------------------------------------------------------------------
// "Oyunlarım" sekmesi: kullanicinin kendi oyunlarini listele + yeni oyun ekle
// "Musteri Yonetimi" sekmesi: admin-only musteri olusturma
// SDK indirme: JSZip ile client-side zip olusturma (AltareAnalytics.cs + config)
//
// Cloud Functions cagrilari:
//   - createGame(gameName, gameType, platforms)
//   - listMyGames()
//   - deleteGame(gameId)
//   - createCustomer(email, displayName, studioName, tier)  [admin only]
// =============================================================================

import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { auth, functions } from "/js/firebase-config.js";

let _jsZipLoaded = false;
function ensureJSZip() {
    if (_jsZipLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = () => { _jsZipLoaded = true; resolve(); };
        s.onerror = () => reject(new Error('JSZip yuklenemedi'));
        document.head.appendChild(s);
    });
}

const GAME_TYPES = [
    { value: "match3", label: "Match-3" },
    { value: "puzzle", label: "Block Puzzle / Casual" },
    { value: "midcore", label: "Mid-Core" },
    { value: "rpg", label: "RPG" },
    { value: "action", label: "Action" },
    { value: "strategy", label: "Strategy" },
    { value: "simulation", label: "Simulation" },
    { value: "casino", label: "Casino" },
    { value: "other", label: "Diğer" },
];

const PLATFORMS = ["Android", "iOS", "WebGL", "PC"];

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

let currentUser = null;
let myGamesCache = [];

document.addEventListener("DOMContentLoaded", () => {
    // Tab degistiginde my-games sekmesindeysek listeyi yenile
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            if (tab === 'my-games') refreshMyGames();
        });
    });

    // "Yeni Oyun Ekle" butonu
    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) btnNewGame.addEventListener('click', openNewGameModal);

    // "Musteri Olustur" formu (admin)
    const formNewCustomer = document.getElementById('form-new-customer');
    if (formNewCustomer) formNewCustomer.addEventListener('submit', handleCreateCustomer);
});

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (!user) return;

    // Admin ise "Musteri Yonetimi" sekmesini aç
    user.getIdTokenResult().then((res) => {
        const isAdmin = res.claims?.admin === true;
        document.querySelectorAll('.admin-only').forEach(el => {
            el.hidden = !isAdmin;
        });
    });

    // Acilirken Oyunlarim listesini doldur
    refreshMyGames();
});

// ─────────────────────────────────────────────────────────────────────────────
// My Games — listele
// ─────────────────────────────────────────────────────────────────────────────

async function refreshMyGames() {
    const container = document.getElementById('my-games-list');
    if (!container) return;
    container.innerHTML = '<div class="empty">Yükleniyor...</div>';

    try {
        const fn = httpsCallable(functions, 'listMyGames');
        const result = await fn({});
        myGamesCache = result.data?.games || [];
        renderMyGames(myGamesCache);
    } catch (err) {
        container.innerHTML = `<div class="empty">Hata: ${escapeHtml(err.message || String(err))}</div>`;
    }
}

function renderMyGames(games) {
    const container = document.getElementById('my-games-list');
    if (!container) return;

    if (!games || games.length === 0) {
        container.innerHTML = `
            <div class="empty">
                Henüz oyun eklemedin. <strong>"+ Yeni Oyun Ekle"</strong> ile başla.
            </div>`;
        return;
    }

    container.innerHTML = `
        <table class="games-table">
            <thead>
                <tr>
                    <th>Oyun Adı</th>
                    <th>Game ID</th>
                    <th>Tür</th>
                    <th>Platform</th>
                    <th>Durum</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${games.map(g => `
                    <tr>
                        <td><strong>${escapeHtml(g.gameName)}</strong></td>
                        <td><code>${escapeHtml(g.gameId)}</code></td>
                        <td>${escapeHtml(g.gameType || '—')}</td>
                        <td>${(g.platforms || []).map(escapeHtml).join(', ')}</td>
                        <td><span class="badge ${g.status === 'active' ? 'medium' : 'low'}">${escapeHtml(g.status || 'active')}</span></td>
                        <td class="row-actions">
                            <button class="btn-link" data-action="select-game" data-game="${escapeHtml(g.gameId)}">Sec</button>
                            <button class="btn-link" data-action="download-sdk" data-game="${escapeHtml(g.gameId)}" style="color: var(--green, #34a853);">SDK Indir</button>
                            <button class="btn-link" data-action="show-credentials" data-game="${escapeHtml(g.gameId)}">Bilgiler</button>
                            <button class="btn-link danger" data-action="delete-game" data-game="${escapeHtml(g.gameId)}">Sil</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Action handlers
    container.querySelectorAll('[data-action="select-game"]').forEach(btn => {
        btn.addEventListener('click', () => selectGame(btn.dataset.game));
    });
    container.querySelectorAll('[data-action="show-credentials"]').forEach(btn => {
        btn.addEventListener('click', () => showGameCredentials(btn.dataset.game));
    });
    container.querySelectorAll('[data-action="delete-game"]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteGame(btn.dataset.game));
    });
    container.querySelectorAll('[data-action="download-sdk"]').forEach(btn => {
        btn.addEventListener('click', () => downloadSDK(btn.dataset.game));
    });
}

function selectGame(gameId) {
    // Üst game-selector dropdown'una bu oyunu sec ve eventStream'e gec
    const selector = document.getElementById('game-selector');
    if (selector) {
        // Eger option yoksa ekle
        const exists = Array.from(selector.options).some(o => o.value === gameId);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = gameId;
            const game = myGamesCache.find(g => g.gameId === gameId);
            opt.textContent = game ? game.gameName : gameId;
            selector.appendChild(opt);
        }
        selector.value = gameId;
        selector.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Overview sekmesine gec
    const tabBtn = document.querySelector('.nav-tab[data-tab="overview"]');
    if (tabBtn) tabBtn.click();
}

function showGameCredentials(gameId) {
    const game = myGamesCache.find(g => g.gameId === gameId);
    if (!game) return;
    const apiKey = game.apiKey || '(yok)';
    const initSnippet = `AltareAnalytics.Initialize("${gameId}", "${game.gameName}");`;

    showModal(`
        <h3>SDK Bilgileri · ${escapeHtml(game.gameName)}</h3>
        <div class="kv">
            <div class="kv-row"><span class="kv-key">Game ID</span><code class="kv-val">${escapeHtml(gameId)}</code></div>
            <div class="kv-row"><span class="kv-key">API Key</span><code class="kv-val">${escapeHtml(apiKey)}</code></div>
        </div>
        <p style="margin-top: 16px;"><strong>Unity Initialize:</strong></p>
        <pre class="code-block">${escapeHtml(initSnippet)}</pre>
        <div style="margin-top: 16px; padding: 14px; background: rgba(52,168,83,0.08); border: 1px solid rgba(52,168,83,0.2); border-radius: 8px;">
            <p style="margin: 0 0 10px; font-size: 0.9rem;"><strong>SDK Paketi</strong> — zip icinde her sey hazir:</p>
            <ul style="margin: 0 0 12px; padding-left: 18px; font-size: 0.85rem; color: var(--text-dim);">
                <li><code>AltareAnalytics.cs</code> — drop-in Unity SDK (v2.1)</li>
                <li><code>AltareAnalyticsBootstrap.cs</code> — otomatik baslangic + KVKK/GDPR consent</li>
                <li><code>AltareConfig.json</code> — gameId + ayarlar (pre-filled)</li>
                <li><code>SampleUsage.cs</code> — ornek event cagrilari</li>
                <li><code>KURULUM_REHBERI.txt</code> — adim adim Turkce kurulum</li>
            </ul>
            <button class="primary-btn" id="modal-download-sdk" style="width: 100%; padding: 10px; font-size: 0.95rem;">SDK Indir (.zip)</button>
        </div>
        <div class="modal-actions" style="margin-top: 12px;">
            <button class="btn-link" data-modal-close>Kapat</button>
        </div>
    `);

    const dlBtn = document.getElementById('modal-download-sdk');
    if (dlBtn) dlBtn.addEventListener('click', () => downloadSDK(gameId));
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Download — client-side zip generation
// ─────────────────────────────────────────────────────────────────────────────

async function downloadSDK(gameId) {
    const game = myGamesCache.find(g => g.gameId === gameId);
    if (!game) { alert('Oyun bulunamadi.'); return; }

    try {
        await ensureJSZip();
    } catch {
        alert('Zip kutuphanesi yuklenemedi. Lutfen internet baglantini kontrol et.');
        return;
    }

    const zip = new JSZip();
    const folder = zip.folder(`AltareSDK_${sanitizeFileName(game.gameName)}`);

    folder.file('AltareAnalytics.cs', generateSDKScript());
    folder.file('AltareAnalyticsBootstrap.cs', generateBootstrapScript(game));
    folder.file('AltareConfig.json', generateConfig(game));
    folder.file('SampleUsage.cs', generateSampleUsage(game));
    folder.file('KURULUM_REHBERI.txt', generateSetupGuide(game));

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AltareSDK_${sanitizeFileName(game.gameName)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function sanitizeFileName(name) {
    return (name || 'game').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
}

function generateBootstrapScript(game) {
    return `// =============================================================================
// AltareAnalyticsBootstrap.cs  —  v2.1.0
// -----------------------------------------------------------------------------
// AltareAnalytics SDK'sini sahnelere dokunmadan otomatik baslatir.
// Drop-in: bu script projeye eklendiginde uygulama acilisinda kendiliginden
// devreye girer.
//
// PRIVACY/CONSENT (KVKK/GDPR):
// Consent panelinden gelen onayi (PlayerPrefs) kontrol eder. Onay yoksa
// SDK'yi baslatmaz; onay sonradan verilirse sessizce retry yaparak baslatir.
// =============================================================================

using UnityEngine;

public static class AltareAnalyticsBootstrap
{
    // ── Oyun ayarlari (pre-filled) ──
    private const string GameId = "${game.gameId}";
    private const string GameName = "${game.gameName}";

    private const string ConsentAnalyticsKey = "app_consent_analytics";
    private const float ConsentPollIntervalSec = 5f;

    private static bool installed;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Install()
    {
        if (installed) return;
        installed = true;

        if (HasAnalyticsConsent())
        {
            StartSdk();
            return;
        }

        BootstrapHost.EnsureExists().StartConsentWatch(StartSdk);
    }

    private static bool HasAnalyticsConsent()
    {
        return PlayerPrefs.GetInt(ConsentAnalyticsKey, 0) == 1;
    }

    private static void StartSdk()
    {
        Reflective.TryInvokeInitialize(GameId, GameName);
    }

    private class BootstrapHost : MonoBehaviour
    {
        private static BootstrapHost instance;

        public static BootstrapHost EnsureExists()
        {
            if (instance != null) return instance;
            GameObject go = new GameObject("[AltareAnalyticsBootstrap]");
            DontDestroyOnLoad(go);
            instance = go.AddComponent<BootstrapHost>();
            return instance;
        }

        public void StartConsentWatch(System.Action onConsentGranted)
        {
            StartCoroutine(WatchConsent(onConsentGranted));
        }

        private System.Collections.IEnumerator WatchConsent(System.Action onConsentGranted)
        {
            while (true)
            {
                if (PlayerPrefs.GetInt(ConsentAnalyticsKey, 0) == 1)
                {
                    onConsentGranted?.Invoke();
                    yield break;
                }
                yield return new WaitForSeconds(ConsentPollIntervalSec);
            }
        }
    }

    private static class Reflective
    {
        private static bool warned;

        public static void TryInvokeInitialize(string gameId, string gameName)
        {
            System.Type t = System.Type.GetType("Altare.Analytics.AltareAnalytics, Assembly-CSharp")
                            ?? System.Type.GetType("Altare.Analytics.AltareAnalytics");

            if (t == null)
            {
                if (!warned)
                {
                    warned = true;
                    Debug.Log("[AltareBootstrap] AltareAnalytics class henuz projede yok. " +
                              "Firebase Auth+Firestore modulleri import edilince + SDK kopyalaninca aktif olur.");
                }
                return;
            }

            System.Reflection.MethodInfo m = t.GetMethod(
                "Initialize",
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static,
                null,
                new[] { typeof(string), typeof(string) },
                null);

            if (m == null)
            {
                Debug.LogWarning("[AltareBootstrap] AltareAnalytics.Initialize(string,string) bulunamadi.");
                return;
            }

            try
            {
                m.Invoke(null, new object[] { gameId, gameName });
                Debug.Log("[AltareBootstrap] AltareAnalytics baslatildi: " + gameId + " / " + gameName);
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[AltareBootstrap] AltareAnalytics.Initialize hata: " + e.Message);
            }
        }
    }
}
`;
}

function generateConfig(game) {
    return JSON.stringify({
        gameId: game.gameId,
        gameName: game.gameName,
        apiKey: game.apiKey || '',
        gameType: game.gameType || 'puzzle',
        platforms: game.platforms || ['Android'],
        sdkVersion: '2.0.0',
        firebaseProject: 'altare-312a1',
        region: 'europe-west1',
    }, null, 2);
}

function generateSampleUsage(game) {
    return `// =============================================================================
// SampleUsage.cs — Altare SDK Ornek Kullanim
// Oyun: ${game.gameName} (${game.gameId})
// =============================================================================
//
// Bu dosya ornek event cagrilarini icerir. Kendi oyun kodunuza entegre edin.
// AltareAnalytics.cs dosyasini Assets/ klasorunuze ekledikten sonra
// asagidaki kodlari ilgili yerlere kopyalayin.
//
// Firebase Unity SDK gereksinimleri:
//   1. https://firebase.google.com/download/unity adresinden indirin
//   2. FirebaseAuth.unitypackage import edin
//   3. FirebaseFirestore.unitypackage import edin
//   4. google-services.json dosyasini Assets/ kokunne yerlestirin
//
// =============================================================================

using System.Collections.Generic;
using UnityEngine;
using Altare.Analytics;

// ─────────────────────────────────────────────────────────────────────────────
// 1. BOOTSTRAP — Oyun acilisinda bir kere cagirin
// ─────────────────────────────────────────────────────────────────────────────

public class GameBootstrap : MonoBehaviour
{
    void Start()
    {
        // Tek satirlik baslangic — gameId ve gameName config'den gelir
        AltareAnalytics.Initialize("${game.gameId}", "${game.gameName}");

        // SDK otomatik olarak sunlari yapar:
        // - session_start event'i gonderir
        // - Anonim oyuncu ID'si olusturur (PlayerPrefs'te saklar)
        // - FPS izleme baslatir (< 30 FPS ise fps_warning gonderir)
        // - Uygulama kapandiginda session_end gonderir
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. LEVEL EVENT'LERI — Her level baslangic/bitis/kaybetmede cagirin
// ─────────────────────────────────────────────────────────────────────────────

public class LevelManager : MonoBehaviour
{
    private int currentLevel = 1;

    public void OnLevelStart()
    {
        AltareAnalytics.LogEvent("level_start", new Dictionary<string, object> {
            { "level", currentLevel }
        });
    }

    public void OnLevelComplete(int score)
    {
        AltareAnalytics.LogEvent("level_complete", new Dictionary<string, object> {
            { "level", currentLevel },
            { "score", score }
        });
    }

    public void OnLevelFail(int movesUsed)
    {
        AltareAnalytics.LogEvent("level_fail", new Dictionary<string, object> {
            { "level", currentLevel },
            { "moves_used", movesUsed }
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. REKLAM EVENT'LERI — Reklam izlendiginde cagirin
// ─────────────────────────────────────────────────────────────────────────────

public class AdManager : MonoBehaviour
{
    public void OnInterstitialAdWatched()
    {
        AltareAnalytics.LogEvent("ad_watched", new Dictionary<string, object> {
            { "placement", "interstitial" }
        });
    }

    public void OnRewardedAdWatched(string rewardType)
    {
        AltareAnalytics.LogEvent("rewarded_ad_watched", new Dictionary<string, object> {
            { "placement", rewardType }  // ornegin: "extra_lives", "skip_level", "double_coins"
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. IAP (UYGULAMA ICI SATIN ALMA) — Basarili satin almada cagirin
// ─────────────────────────────────────────────────────────────────────────────

public class IAPManager : MonoBehaviour
{
    public void OnPurchaseSuccess(string sku, float priceUsd)
    {
        AltareAnalytics.LogEvent("iap_purchase_success", new Dictionary<string, object> {
            { "sku", sku },
            { "amount_usd", priceUsd }
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PLAYER FEEDBACK — Oyuncu geri bildiriminde cagirin (opsiyonel)
// ─────────────────────────────────────────────────────────────────────────────

public class FeedbackUI : MonoBehaviour
{
    public void SubmitPlayerFeedback(int rating, string comment)
    {
        // rating: 1-5 arasi, comment: serbest metin
        AltareAnalytics.SubmitFeedback(rating, comment);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. CUSTOM EVENT'LER — Oyuna ozel herhangi bir event gonderin
// ─────────────────────────────────────────────────────────────────────────────
//
// AltareAnalytics.LogEvent("tutorial_complete", new Dictionary<string, object> {
//     { "step", 5 },
//     { "duration_seconds", 120 }
// });
//
// AltareAnalytics.LogEvent("achievement_unlocked", new Dictionary<string, object> {
//     { "achievement_id", "first_win" },
//     { "level", 1 }
// });
//
// AltareAnalytics.LogEvent("store_item_purchased", new Dictionary<string, object> {
//     { "item_id", "gold_pack_500" },
//     { "currency", "coins" },
//     { "amount", 500 }
// });
`;
}

function generateSetupGuide(game) {
    return `================================================================================
ALTARE SDK KURULUM REHBERI
Oyun: ${game.gameName}
Game ID: ${game.gameId}
================================================================================

Bu rehber Altare AI Live Game Intelligence SDK'sini Unity projenize
entegre etmeniz icin adim adim talimatlari icerir.

================================================================================
GEREKSINIMLER
================================================================================

- Unity 2021.3 veya ustu
- Firebase Unity SDK (Authentication + Firestore)
  Indirme: https://firebase.google.com/download/unity
- Firebase projesi (altare-312a1) ile eslesmis google-services.json

================================================================================
ADIM 1: Firebase Unity SDK Kurulumu
================================================================================

1. https://firebase.google.com/download/unity adresinden SDK'yi indirin
2. Unity'de Assets > Import Package > Custom Package secin
3. Sirayla import edin:
   - FirebaseAuth.unitypackage
   - FirebaseFirestore.unitypackage
4. Import tamamlandiginda Unity Console'da hata olmadigini kontrol edin

================================================================================
ADIM 2: google-services.json Yerlestirme
================================================================================

1. Firebase Console'a gidin: https://console.firebase.google.com
2. Altare projesini secin (altare-312a1)
3. Project Settings > Your apps > Android uygulamanizi secin
   (Yoksa "Add app" ile Android uygulamasi ekleyin — paket adiniz:
   com.altarestudio.${sanitizeFileName(game.gameName).toLowerCase()})
4. google-services.json dosyasini indirin
5. Bu dosyayi Unity projenizde Assets/ kok klasorune kopyalayin

================================================================================
ADIM 3: Anonymous Authentication Aktif Etme
================================================================================

1. Firebase Console > Authentication > Sign-in method
2. "Anonymous" provider'i bulun ve "Enable" yapin
3. Save'leyin

Bu adim gerekli cunku SDK oyunculari anonim olarak dogrular.
Oyunculardan email/telefon ISTENMEZ — tamamen arka planda calisir.

================================================================================
ADIM 4: SDK Dosyalarini Projeye Ekleme
================================================================================

1. Bu zip'ten cikan dosyalari Unity projenizde
   Assets/Plugins/Altare/ klasorune kopyalayin:
   - AltareAnalytics.cs (ana SDK)
   - AltareAnalyticsBootstrap.cs (otomatik baslangic + KVKK consent)
   (klasor yoksa olusturun)

2. Unity'nin dosyalari compile etmesini bekleyin (Console'da hata olmamali)

NOT: AltareAnalyticsBootstrap.cs GameId ve GameName'i sizin oyununuz
icin onceden doldurulmus olarak gelir. Ek bir ayar yapmaniza gerek yok.

================================================================================
ADIM 5: Baslangic Kodu (Bootstrap)
================================================================================

Oyununuzun en ust sahnesindeki bir MonoBehaviour'a ekleyin:

    using Altare.Analytics;

    void Start()
    {
        AltareAnalytics.Initialize("${game.gameId}", "${game.gameName}");
    }

BU KADAR! SDK artik otomatik olarak sunlari yapar:
  - session_start event'i gonderir
  - Anonim oyuncu ID olusturur
  - FPS izleme baslatir (< 30 FPS ise uyari gonderir)
  - Uygulama kapandiginda session_end gonderir

================================================================================
ADIM 6: Level + Reklam + IAP Event'lerini Ekleyin
================================================================================

SampleUsage.cs dosyasindaki ornekleri kendi kodunuza entegre edin:

  Level baslangici:
    AltareAnalytics.LogEvent("level_start", new() { { "level", lvl } });

  Level tamamlama:
    AltareAnalytics.LogEvent("level_complete", new() { { "level", lvl }, { "score", s } });

  Level kaybetme:
    AltareAnalytics.LogEvent("level_fail", new() { { "level", lvl } });

  Reklam izleme:
    AltareAnalytics.LogEvent("ad_watched", new() { { "placement", "interstitial" } });

  Odulli reklam:
    AltareAnalytics.LogEvent("rewarded_ad_watched", new() { { "placement", "extra_lives" } });

  IAP satin alma:
    AltareAnalytics.LogEvent("iap_purchase_success", new() { { "sku", "gold_100" }, { "amount_usd", 1.99 } });

================================================================================
ADIM 7: Test ve Dogrulama
================================================================================

1. Unity'de Build & Run (Android cihaza veya emulatorde)
2. Oyunu acin, 1-2 dakika oynayin
3. Altare Panel'e gidin: https://altarestudio.com.tr/panel.html
4. "Canli Event Stream" sekmesinde session_start + level_start gormelisiniz
5. "Genel Bakis"'ta Aktif Oturum > 0 olmali

SORUN GIDERME:
- Unity Console'da [Altare] ile baslayan loglari kontrol edin
- "[Altare] Ready. uid=..." mesaji goruyorsaniz SDK calisiyor demektir
- Gormuyorsaniz: google-services.json eksik veya paket adi uyumsuz olabilir
- Firebase Console > Authentication'da anonim kullanicilarin olusup
  olusmadigini kontrol edin
- Firestore'da games/${game.gameId}/events/ koleksiyonuna veri gelip
  gelmedegini kontrol edin

================================================================================
DESTEK
================================================================================

Sorun yasarsaniz:
- Panel: https://altarestudio.com.tr/panel.html (Entegrasyon Rehberi sekmesi)
- Email: berkant@altarestudio.com.tr

SDK Surumu: 2.0.0
Tarih: ${new Date().toISOString().slice(0, 10)}
================================================================================
`;
}

function generateSDKScript() {
    return `// =============================================================================
// AltareAnalytics.cs  —  v2.1.0
// -----------------------------------------------------------------------------
// Drop-in Unity client for the Altare AI Live Game Intelligence platform.
// Authenticates the device anonymously with Firebase Auth and writes events
// into Firestore at  games/{gameId}/events/{eventId}.
//
// Usage:
//   void Start() {
//       AltareAnalytics.Initialize("your-game-id", "Your Game Name");
//   }
//
// Required Unity packages:
//   - Firebase Authentication
//   - Firebase Firestore
//
// Privacy notes:
//   - Stores only an anonymous UUID (playerAnonId) in PlayerPrefs.
//   - Never collects email, phone, location, or 3rd-party app data.
// =============================================================================

using System;
using System.Collections.Generic;
using UnityEngine;
using Firebase;
using Firebase.Auth;
using Firebase.Firestore;
using Firebase.Extensions;

namespace Altare.Analytics
{
    public class AltareAnalytics : MonoBehaviour
    {
        // Public static API

        public static void Initialize(string gameId, string gameName)
        {
            if (_instance != null) return;
            if (string.IsNullOrWhiteSpace(gameId))
                throw new ArgumentException("gameId is required", nameof(gameId));

            var go = new GameObject("[AltareAnalytics]");
            DontDestroyOnLoad(go);
            _instance = go.AddComponent<AltareAnalytics>();
            _instance._gameId = gameId.Trim();
            _instance._gameName = string.IsNullOrWhiteSpace(gameName) ? gameId : gameName.Trim();
            _instance.Boot();
        }

        public static void LogEvent(string eventName, Dictionary<string, object> parameters = null)
        {
            if (string.IsNullOrWhiteSpace(eventName)) return;
            if (_instance == null)
            {
                Debug.LogWarning("[Altare] LogEvent called before Initialize -- dropping: " + eventName);
                return;
            }
            _instance.EnqueueEvent(eventName, parameters);
        }

        public static void LogSessionStart() => LogEvent("session_start", null);

        public static void LogSessionEnd(float durationSeconds)
        {
            LogEvent("session_end", new Dictionary<string, object> {
                { "duration_seconds", durationSeconds }
            });
        }

        public static void SubmitFeedback(int rating, string text)
        {
            if (_instance == null) return;
            _instance.WriteFeedback(rating, text);
        }

        public static string PlayerAnonId => _instance != null ? _instance._playerAnonId : null;

        // Internals

        private const string PrefsPlayerIdKey = "altare.playerAnonId";

        private static AltareAnalytics _instance;

        private string _gameId;
        private string _gameName;
        private string _playerAnonId;
        private string _sessionId;
        private string _platform;
        private string _appVersion;
        private string _deviceModel;
        private bool _isFirstOpen;

        private FirebaseFirestore _db;
        private bool _ready;
        private bool _initFailed;

        private readonly Queue<PendingEvent> _buffer = new Queue<PendingEvent>(64);

        private float _sessionStartTime;
        private bool _quitting;

        private const float FpsCheckIntervalSec = 5f;
        private const float FpsWarningThreshold = 30f;
        private const float FpsWarningCooldownSec = 60f;
        private float _fpsAccum;
        private int _fpsFrames;
        private float _fpsCheckTimer;
        private float _lastFpsWarnAt = -999f;

        private void Boot()
        {
            _playerAnonId = LoadOrCreatePlayerId(out _isFirstOpen);
            _sessionId = Guid.NewGuid().ToString("N");
            _platform = Application.platform.ToString();
            _appVersion = Application.version;
            _deviceModel = SystemInfo.deviceModel;
            _sessionStartTime = Time.realtimeSinceStartup;

            FirebaseApp.CheckAndFixDependenciesAsync().ContinueWithOnMainThread(task =>
            {
                if (task.Result != DependencyStatus.Available)
                {
                    _initFailed = true;
                    Debug.LogError("[Altare] Firebase deps unavailable: " + task.Result);
                    return;
                }
                FirebaseAuth.DefaultInstance.SignInAnonymouslyAsync()
                    .ContinueWithOnMainThread(authTask =>
                    {
                        if (authTask.IsFaulted || authTask.IsCanceled)
                        {
                            _initFailed = true;
                            Debug.LogError("[Altare] Anonymous auth failed: " + authTask.Exception);
                            return;
                        }
                        _db = FirebaseFirestore.DefaultInstance;
                        _ready = true;
                        Debug.Log("[Altare] Ready. uid=" + authTask.Result.User.UserId
                                  + " playerAnonId=" + _playerAnonId
                                  + " sessionId=" + _sessionId);
                        if (_isFirstOpen)
                            LogEvent("first_open", null);
                        LogEvent("app_open", new Dictionary<string, object> {
                            { "is_first_open", _isFirstOpen }
                        });
                        LogSessionStart();
                        FlushBuffer();
                    });
            });
        }

        private string LoadOrCreatePlayerId(out bool created)
        {
            string id = PlayerPrefs.GetString(PrefsPlayerIdKey, null);
            if (string.IsNullOrEmpty(id))
            {
                id = Guid.NewGuid().ToString("N");
                PlayerPrefs.SetString(PrefsPlayerIdKey, id);
                PlayerPrefs.Save();
                created = true;
                return id;
            }
            created = false;
            return id;
        }

        private void EnqueueEvent(string eventName, Dictionary<string, object> parameters)
        {
            var pending = new PendingEvent
            {
                eventName = eventName,
                parameters = parameters != null
                    ? new Dictionary<string, object>(parameters)
                    : new Dictionary<string, object>(),
                clientTimestampUtc = DateTime.UtcNow,
            };

            if (!_ready)
            {
                if (_buffer.Count > 256) _buffer.Dequeue();
                _buffer.Enqueue(pending);
                return;
            }
            WriteEvent(pending);
        }

        private void FlushBuffer()
        {
            while (_buffer.Count > 0)
            {
                WriteEvent(_buffer.Dequeue());
            }
        }

        private void WriteEvent(PendingEvent pending)
        {
            if (_db == null) return;

            var payload = new Dictionary<string, object>
            {
                { "gameId",        _gameId },
                { "gameName",      _gameName },
                { "playerAnonId",  _playerAnonId },
                { "sessionId",     _sessionId },
                { "eventName",     pending.eventName },
                { "eventParams",   pending.parameters ?? new Dictionary<string, object>() },
                { "timestamp",     FieldValue.ServerTimestamp },
                { "clientTimestamp", Timestamp.FromDateTime(pending.clientTimestampUtc) },
                { "platform",      _platform },
                { "appVersion",    _appVersion },
                { "deviceModel",   _deviceModel },
            };

            _db.Collection("games").Document(_gameId)
               .Collection("events").Document()
               .SetAsync(payload)
               .ContinueWithOnMainThread(t =>
               {
                   if (t.IsFaulted)
                   {
                       Debug.LogWarning("[Altare] event write failed (" + pending.eventName
                                        + "): " + t.Exception?.GetBaseException()?.Message);
                   }
               });
        }

        private void WriteFeedback(int rating, string text)
        {
            if (_db == null)
            {
                LogEvent("player_feedback", new Dictionary<string, object> {
                    { "rating", rating },
                    { "text", text ?? "" },
                });
                return;
            }
            var payload = new Dictionary<string, object>
            {
                { "gameId",       _gameId },
                { "gameName",     _gameName },
                { "playerAnonId", _playerAnonId },
                { "rating",       rating },
                { "text",         text ?? "" },
                { "platform",     _platform },
                { "appVersion",   _appVersion },
                { "deviceModel",  _deviceModel },
                { "timestamp",    FieldValue.ServerTimestamp },
            };
            _db.Collection("games").Document(_gameId)
               .Collection("feedback").Document()
               .SetAsync(payload);

            LogEvent("player_feedback", new Dictionary<string, object> {
                { "rating", rating },
                { "text", (text ?? "").Length > 80 ? (text.Substring(0, 80) + "\\u2026") : text ?? "" },
            });
        }

        private void Update()
        {
            if (!_ready) return;

            _fpsAccum += Time.unscaledDeltaTime;
            _fpsFrames++;
            _fpsCheckTimer += Time.unscaledDeltaTime;

            if (_fpsCheckTimer >= FpsCheckIntervalSec)
            {
                float avg = _fpsFrames > 0 && _fpsAccum > 0 ? _fpsFrames / _fpsAccum : 60f;
                _fpsAccum = 0; _fpsFrames = 0; _fpsCheckTimer = 0;

                if (avg < FpsWarningThreshold &&
                    Time.realtimeSinceStartup - _lastFpsWarnAt > FpsWarningCooldownSec)
                {
                    _lastFpsWarnAt = Time.realtimeSinceStartup;
                    LogEvent("fps_warning", new Dictionary<string, object> {
                        { "avg_fps", Mathf.RoundToInt(avg) },
                        { "device", _deviceModel },
                    });
                }
            }
        }

        private void OnApplicationPause(bool pauseStatus)
        {
            if (!_ready) return;
            if (pauseStatus)
            {
                LogSessionEnd(Time.realtimeSinceStartup - _sessionStartTime);
            }
            else
            {
                _sessionId = Guid.NewGuid().ToString("N");
                _sessionStartTime = Time.realtimeSinceStartup;
                LogSessionStart();
            }
        }

        private void OnApplicationQuit()
        {
            _quitting = true;
            if (!_ready) return;
            LogSessionEnd(Time.realtimeSinceStartup - _sessionStartTime);
        }

        private struct PendingEvent
        {
            public string eventName;
            public Dictionary<string, object> parameters;
            public DateTime clientTimestampUtc;
        }
    }
}
`;
}

async function handleDeleteGame(gameId) {
    if (!confirm(`"${gameId}" oyununu silmek istediğine emin misin? Tüm event verileri kaybolur.`)) return;
    try {
        const fn = httpsCallable(functions, 'deleteGame');
        await fn({ gameId });
        await refreshMyGames();
    } catch (err) {
        alert('Silme hatası: ' + (err.message || String(err)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// New Game Modal
// ─────────────────────────────────────────────────────────────────────────────

function openNewGameModal() {
    showModal(`
        <h3>Yeni Oyun Ekle</h3>
        <form id="new-game-form" class="form-stack">
            <label>
                <span>Oyun Adı *</span>
                <input type="text" name="gameName" required minlength="2" maxlength="60" placeholder="Royal Dreams">
            </label>
            <label>
                <span>Tür</span>
                <select name="gameType">
                    ${GAME_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                </select>
            </label>
            <fieldset>
                <legend>Platform</legend>
                ${PLATFORMS.map((p, i) => `
                    <label class="checkbox">
                        <input type="checkbox" name="platforms" value="${p}" ${i === 0 ? 'checked' : ''}> ${p}
                    </label>
                `).join('')}
            </fieldset>
            <div class="modal-actions">
                <button type="button" class="btn-link" data-modal-close>İptal</button>
                <button type="submit" class="primary-btn">Oluştur</button>
            </div>
        </form>
        <div id="new-game-result"></div>
    `);

    const form = document.getElementById('new-game-form');
    if (form) form.addEventListener('submit', handleCreateGame);
}

async function handleCreateGame(e) {
    e.preventDefault();
    const form = e.target;
    const gameName = form.gameName.value.trim();
    const gameType = form.gameType.value;
    const platforms = Array.from(form.querySelectorAll('input[name="platforms"]:checked'))
        .map(cb => cb.value);

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Oluşturuluyor...'; }

    try {
        const fn = httpsCallable(functions, 'createGame');
        const result = await fn({ gameName, gameType, platforms });
        const data = result.data || {};
        const resultDiv = document.getElementById('new-game-result');
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="success-box" style="margin-top: 16px;">
                    <h4>Oyun olusturuldu!</h4>
                    <div class="kv" style="margin-top: 8px;">
                        <div class="kv-row"><span class="kv-key">Game ID</span><code class="kv-val">${escapeHtml(data.gameId)}</code></div>
                        <div class="kv-row"><span class="kv-key">API Key</span><code class="kv-val">${escapeHtml(data.apiKey || '')}</code></div>
                    </div>
                    <p style="margin-top: 12px;"><strong>Unity Initialize:</strong></p>
                    <pre class="code-block">AltareAnalytics.Initialize("${escapeHtml(data.gameId)}", "${escapeHtml(gameName)}");</pre>
                    <button class="primary-btn" id="new-game-download-sdk"
                        style="margin-top: 12px; width: 100%; padding: 10px;">SDK Indir (.zip)</button>
                </div>
            `;
            const dlBtn2 = document.getElementById('new-game-download-sdk');
            if (dlBtn2) {
                myGamesCache.push({ gameId: data.gameId, gameName: gameName, apiKey: data.apiKey, gameType, platforms });
                dlBtn2.addEventListener('click', () => downloadSDK(data.gameId));
            }
        }
        await refreshMyGames();
    } catch (err) {
        const resultDiv = document.getElementById('new-game-result');
        if (resultDiv) {
            resultDiv.innerHTML = `<div class="error-box" style="margin-top: 12px;">Hata: ${escapeHtml(err.message || String(err))}</div>`;
        }
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Oluştur'; }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Admin (admin-only)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCreateCustomer(e) {
    e.preventDefault();
    const email = document.getElementById('customer-email').value.trim();
    const studioName = document.getElementById('customer-studio').value.trim();
    const tier = document.getElementById('customer-tier').value;

    const resultDiv = document.getElementById('new-customer-result');
    if (resultDiv) resultDiv.innerHTML = '<div class="empty">Oluşturuluyor...</div>';

    try {
        const fn = httpsCallable(functions, 'createCustomer');
        const result = await fn({ email, studioName, displayName: studioName, tier });
        const data = result.data || {};
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="success-box" style="margin-top: 16px;">
                    <h4>✅ Müşteri oluşturuldu</h4>
                    <div class="kv">
                        <div class="kv-row"><span class="kv-key">Email</span><code class="kv-val">${escapeHtml(data.email)}</code></div>
                        <div class="kv-row"><span class="kv-key">UID</span><code class="kv-val">${escapeHtml(data.uid)}</code></div>
                        ${data.tempPassword ? `<div class="kv-row"><span class="kv-key">Geçici Şifre</span><code class="kv-val">${escapeHtml(data.tempPassword)}</code></div>` : ''}
                        ${data.resetLink ? `<div class="kv-row"><span class="kv-key">Reset Link</span><code class="kv-val" style="word-break: break-all;">${escapeHtml(data.resetLink)}</code></div>` : ''}
                    </div>
                    <p style="margin-top: 12px; color: var(--muted);">Bu bilgileri müşteriye email ile gönder. (Otomatik email Phase 3'te eklenir.)</p>
                </div>
            `;
        }
        e.target.reset();
    } catch (err) {
        if (resultDiv) {
            resultDiv.innerHTML = `<div class="error-box">Hata: ${escapeHtml(err.message || String(err))}</div>`;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal helper
// ─────────────────────────────────────────────────────────────────────────────

function showModal(innerHtml) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-card">${innerHtml}</div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
        if (e.target?.dataset?.modalClose !== undefined) closeModal();
    });

    document.addEventListener('keydown', escListener);
}

function closeModal() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    document.removeEventListener('keydown', escListener);
}

function escListener(e) {
    if (e.key === 'Escape') closeModal();
}

// ─────────────────────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}
