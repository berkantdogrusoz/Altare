// =============================================================================
// AltareAnalyticsBootstrap.cs  —  v3.0.0
// -----------------------------------------------------------------------------
// AltareAnalytics SDK'sini sahnelere dokunmadan otomatik baslatir.
// Drop-in: bu script projeye eklendiginde uygulama acilisinda kendiliginden
// devreye girer.
//
// PRIVACY/CONSENT (KVKK/GDPR) — v2.2 ile OPT-OUT modeli:
//   Eski davranis (v2.1) opt-in idi: kullanici acikca onay (key==1) vermeden
//   SDK HIC baslamiyordu. Consent ekrani olmayan oyunlarda anahtar hic
//   yazilmadigi icin SDK sonsuza kadar bekliyor, panele veri gitmiyordu.
//
//   Yeni varsayilan (RequireExplicitConsent = false):
//     - Anahtar hic yoksa (-1) veya 1 ise  → SDK baslar (anonim veri, PII yok)
//     - Anahtar acikca 0 ise               → SDK baslamaz (kullanici reddetti)
//   Consent ekrani olan oyunlar secimi AltareAnalytics.SetAnalyticsConsent()
//   ile yazar; red sonradan gelirse SDK kendini durdurur.
//
//   Kati opt-in gereken pazarlar icin RequireExplicitConsent = true yap —
//   v2.1 davranisi aynen geri gelir (yalniz key==1 ile baslar).
//
// HER OYUN ICIN AYARLANACAK (tek yapilandirma noktasi):
//   GameId    = "your-game-id"   // Panel -> Oyunlarim listesindeki GAME ID
//   GameName  = "Your Game Name" // Panel'de gosterilen ad
//   ApiKey    = "altr_..."       // Panel -> SDK Bilgileri
// =============================================================================

using UnityEngine;

public static class AltareAnalyticsBootstrap
{
    private const string GameId = "your-game-id";
    private const string GameName = "Your Game Name";

    /// Panel -> Oyunlarim -> <oyun> -> SDK Bilgileri'ndeki anahtar (altr_...).
    /// Bos birakilabilir (sunucu gecis donemindedir) ama VERILMESI onerilir.
    private const string ApiKey = "";

    // true → kati opt-in: kullanici acikca onaylamadan (key==1) baslamaz.
    // false (varsayilan) → opt-out: acikca reddedilmedikce (key==0) baslar.
    private const bool RequireExplicitConsent = false;

    private const string ConsentAnalyticsKey = "app_consent_analytics";
    private const float ConsentPollIntervalSec = 5f;

    private static bool installed;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Install()
    {
        if (installed) return;
        installed = true;

        if (ConsentAllows())
        {
            StartSdk();
            return;
        }

        BootstrapHost.EnsureExists().StartConsentWatch(StartSdk);
    }

    private static bool ConsentAllows()
    {
        int v = PlayerPrefs.GetInt(ConsentAnalyticsKey, -1); // -1 = hic sorulmamis
        if (RequireExplicitConsent) return v == 1;
        return v != 0; // sadece acik red (0) engeller
    }

    private static void StartSdk()
    {
        Reflective.TryInvokeInitialize(GameId, GameName, ApiKey);
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
                if (ConsentAllows())
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

        public static void TryInvokeInitialize(string gameId, string gameName, string apiKey)
        {
            System.Type t = System.Type.GetType("Altare.Analytics.AltareAnalytics, Assembly-CSharp")
                            ?? System.Type.GetType("Altare.Analytics.AltareAnalytics");

            if (t == null)
            {
                if (!warned)
                {
                    warned = true;
                    Debug.Log("[AltareBootstrap] AltareAnalytics sinifi projede yok. " +
                              "AltareAnalytics.cs dosyasini Assets/ altina kopyalayinca aktif olur.");
                }
                return;
            }

            const System.Reflection.BindingFlags Bayrak =
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static;

            // v3.0: Initialize(gameId, gameName, apiKey, endpoint) — son iki
            // parametre istege bagli. Once 4'lu imzayi ara.
            System.Reflection.MethodInfo m = t.GetMethod("Initialize", Bayrak, null,
                new[] { typeof(string), typeof(string), typeof(string), typeof(string) }, null);
            object[] argumanlar = m != null
                ? new object[] { gameId, gameName, apiKey, null }
                : null;

            // v2.x geriye uyum: yalnizca (gameId, gameName) varsa onu kullan.
            if (m == null)
            {
                m = t.GetMethod("Initialize", Bayrak, null,
                    new[] { typeof(string), typeof(string) }, null);
                argumanlar = new object[] { gameId, gameName };
                if (m != null && !string.IsNullOrEmpty(apiKey))
                {
                    Debug.LogWarning("[AltareBootstrap] Eski SDK surumu: apiKey desteklenmiyor, " +
                                     "yok sayildi. unity-sdk/ dosyalarini guncelleyin.");
                }
            }

            if (m == null)
            {
                Debug.LogWarning("[AltareBootstrap] AltareAnalytics.Initialize bulunamadi.");
                return;
            }

            try
            {
                m.Invoke(null, argumanlar);
                Debug.Log($"[AltareBootstrap] AltareAnalytics baslatildi: {gameId} / {gameName}"
                          + (string.IsNullOrEmpty(apiKey) ? " (apiKey YOK)" : ""));
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[AltareBootstrap] AltareAnalytics.Initialize hata: " + e.Message);
            }
        }
    }
}
