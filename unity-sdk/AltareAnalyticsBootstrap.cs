// =============================================================================
// AltareAnalyticsBootstrap.cs  —  v2.1.0
// -----------------------------------------------------------------------------
// AltareAnalytics SDK'sini sahnelere dokunmadan otomatik baslatir.
// Drop-in: bu script projeye eklendiginde uygulama acilisinda kendiliginden
// devreye girer.
//
// PRIVACY/CONSENT (KVKK/GDPR):
// Consent panelinden gelen onayi (PlayerPrefs) kontrol eder. Onay yoksa
// SDK'yi baslatmaz; onay sonradan verilirse sessizce retry yaparak baslatir.
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
                Debug.Log($"[AltareBootstrap] AltareAnalytics baslatildi: {gameId} / {gameName}");
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[AltareBootstrap] AltareAnalytics.Initialize hata: " + e.Message);
            }
        }
    }
}
