// =============================================================================
// AltareFirebase.cs  —  v2.0.0
// -----------------------------------------------------------------------------
// Altare'nin KENDI Firebase projesine (altare-312a1) bagli, oyunun default
// Firebase app'inden TAMAMEN BAGIMSIZ isimli FirebaseApp + anonim oturum.
//
// ⚠️ BU DOSYA ARTIK ISTEGE BAGLIDIR.
//    v3.0'dan itibaren AltareAnalytics HTTPS ile calisir ve Firebase'e HIC
//    ihtiyac duymaz. Bu dosya yalnizca su iki modul kullanilacaksa gerekir:
//      - AltareConfig      (canli Remote Config — Firestore dinleyicisi ister)
//      - AltarePlayerState (snapshot & rollback — Firestore + Functions ister)
//    Bu ikisini kullanmayan oyunlar AltareFirebase.cs / AltareConfig.cs /
//    AltarePlayerState.cs dosyalarini projeye HIC eklemeyebilir; Firebase
//    Unity SDK'sini de import etmeleri gerekmez.
//
// NEDEN ISIMLI APP:
//   Default instance oyunun kendi google-services.json'una baglanir. Kendi
//   Firebase projesi olan oyunlarda (orn. bir stüdyonun kendi projesi) veri
//   Altare'ye degil oyunun projesine giderdi. Isimli app bunu keser:
//   oyunun Firebase'i (Analytics, Remote Config, Crashlytics) hic etkilenmez.
//
// GUVENLIK NOTU:
//   Asagidaki degerler public web credential'laridir (sitedeki
//   js/firebase-config.js ile ayni) — gizli DEGILDIR. Gercek koruma
//   Firestore security rules + anonymous auth tarafindadir.
// =============================================================================

using System;
using UnityEngine;
using Firebase;
using Firebase.Auth;
using Firebase.Firestore;
using Firebase.Extensions;

namespace Altare.Analytics
{
    public static class AltareFirebase
    {
        public const string AppName = "altare";
        public const string FunctionsRegion = "europe-west1";

        // altare-312a1 public config — js/firebase-config.js ile senkron tutun.
        private const string ApiKey          = "AIzaSyDxHVD9iGm0WzPVDHvC0zRpvLBwhmVPdXs";
        private const string AppId           = "1:525350962277:web:8afd370efeafb936f4328c";
        private const string ProjectId       = "altare-312a1";
        private const string MessageSenderId = "525350962277";
        private const string StorageBucket   = "altare-312a1.firebasestorage.app";

        private static FirebaseApp _app;
        private static bool _hazirlaniyor;

        /// <summary>Bagimliliklar tamam ve anonim oturum acik mi?</summary>
        public static bool IsReady { get; private set; }

        /// <summary>
        /// Isimli Altare app'ini kurar ve anonim oturumu acar. Idempotent.
        /// v3.0 oncesinde bu isi AltareAnalytics yapiyordu; artik analitik
        /// Firebase'siz calistigi icin sorumluluk buraya tasindi.
        /// </summary>
        /// <param name="onReady">true = kullanima hazir, false = kullanilamaz.</param>
        public static void EnsureReady(Action<bool> onReady = null)
        {
            if (IsReady) { onReady?.Invoke(true); return; }
            if (_hazirlaniyor) { return; }
            _hazirlaniyor = true;

            FirebaseApp.CheckAndFixDependenciesAsync().ContinueWithOnMainThread(task =>
            {
                if (task.Result != DependencyStatus.Available)
                {
                    _hazirlaniyor = false;
                    Debug.LogWarning("[AltareFirebase] Bagimliliklar yok: " + task.Result);
                    onReady?.Invoke(false);
                    return;
                }

                try { EnsureApp(); }
                catch (Exception e)
                {
                    _hazirlaniyor = false;
                    Debug.LogWarning("[AltareFirebase] App olusturulamadi: " + e.Message);
                    onReady?.Invoke(false);
                    return;
                }

                Auth.SignInAnonymouslyAsync().ContinueWithOnMainThread(authTask =>
                {
                    _hazirlaniyor = false;
                    if (authTask.IsFaulted || authTask.IsCanceled)
                    {
                        Debug.LogWarning("[AltareFirebase] Anonim oturum acilamadi.");
                        onReady?.Invoke(false);
                        return;
                    }
                    IsReady = true;
                    Debug.Log("[AltareFirebase] Hazir -> project=" + ProjectId);
                    onReady?.Invoke(true);
                });
            });
        }

        /// <summary>
        /// Isimli app'i dondurur; yoksa gomulu config ile olusturur.
        /// CheckAndFixDependenciesAsync TAMAMLANDIKTAN sonra cagrilmalidir.
        /// </summary>
        public static FirebaseApp App
        {
            get { EnsureApp(); return _app; }
        }

        public static FirebaseAuth Auth => FirebaseAuth.GetAuth(App);
        public static FirebaseFirestore Db => FirebaseFirestore.GetInstance(App);

        public static void EnsureApp()
        {
            if (_app != null) return;

            try { _app = FirebaseApp.GetInstance(AppName); }
            catch (Exception) { _app = null; }
            if (_app != null) return;

            var options = new AppOptions
            {
                ApiKey          = ApiKey,
                AppId           = AppId,
                ProjectId       = ProjectId,
                MessageSenderId = MessageSenderId,
                StorageBucket   = StorageBucket,
            };
            _app = FirebaseApp.Create(options, AppName);
            Debug.Log("[AltareFirebase] named app ready -> project=" + ProjectId);
        }
    }
}
