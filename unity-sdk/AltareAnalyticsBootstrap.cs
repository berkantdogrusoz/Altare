// =============================================================================
// AltareAnalyticsBootstrap.cs  —  v2.2.0
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
// HER OYUN ICIN AYARLANACAK:
//   GameId    = "your-game-id"   // Firestore'da games/{GameId}/events
//   GameName  = "Your Game Name" // Panel'de gosterilen ad
// =============================================================================

using UnityEngine;

public static class AltareAnalyticsBootstrap
{
    private const string GameId = "your-game-id";
    private const string GameName = "Your Game Name";

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
                Debug.Log($"[AltareBootstrap] AltareAnalytics baslatildi: {gameId} / {gameName}");
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[AltareBootstrap] AltareAnalytics.Initialize hata: " + e.Message);
            }
        }
    }
}
