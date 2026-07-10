// =============================================================================
// AltareFirebase.cs  —  v1.0.0
// -----------------------------------------------------------------------------
// Altare'nin KENDI Firebase projesine (altare-312a1) bagli, oyunun default
// Firebase app'inden TAMAMEN BAGIMSIZ isimli FirebaseApp.
//
// NEDEN VAR:
//   - Eski SDK surumleri FirebaseFirestore.DefaultInstance kullaniyordu.
//     Default instance oyunun kendi google-services.json'una baglanir; kendi
//     Firebase projesi olan oyunlarda (orn. pixel-pour-77f13) eventler
//     Altare'ye degil oyunun projesine yaziliyordu → panel hic veri gormuyordu.
//   - Hic Firebase entegrasyonu olmayan oyunlarda ise default app hic
//     olusamiyordu ve SDK calismiyordu.
//
// COZUM:
//   FirebaseApp.Create(options, "altare") ile isimli ikinci app kurulur.
//   - Oyunun kendi Firebase'i (Analytics, Remote Config, Crashlytics...)
//     hicbir sekilde etkilenmez, dokunulmaz.
//   - Oyunda google-services.json OLMASA BILE calisir — tum config asagida
//     gomulu. Sadece Firebase Unity SDK'nin Auth + Firestore (+ Functions,
//     PlayerState kullanilacaksa) modullerinin import edilmesi yeterli.
//
// GUVENLIK NOTU:
//   Asagidaki degerler public web credential'laridir (sitedeki
//   js/firebase-config.js ile ayni) — gizli DEGILDIR, gizlenmesi de gerekmez.
//   Gercek koruma Firestore security rules + anonymous auth tarafindadir:
//   anonim istemciler yalnizca sema dogrulamasindan gecen event/feedback
//   yazabilir, hicbir seyi okuyamaz/silemez.
// =============================================================================

using System;
using UnityEngine;
using Firebase;
using Firebase.Auth;
using Firebase.Firestore;

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

        /// <summary>
        /// Isimli Altare app'ini dondurur; yoksa gomulu config ile olusturur.
        /// FirebaseApp.CheckAndFixDependenciesAsync() TAMAMLANDIKTAN sonra
        /// cagrilmalidir (AltareAnalytics.Boot bunu garanti eder).
        /// </summary>
        public static FirebaseApp App
        {
            get
            {
                EnsureApp();
                return _app;
            }
        }

        /// <summary>altare-312a1'e bagli Auth (anonim oturum burada acilir).</summary>
        public static FirebaseAuth Auth => FirebaseAuth.GetAuth(App);

        /// <summary>altare-312a1'e bagli Firestore (events/feedback/config).</summary>
        public static FirebaseFirestore Db => FirebaseFirestore.GetInstance(App);

        public static void EnsureApp()
        {
            if (_app != null) return;

            // Onceden olusturulduysa yeniden kullan (domain reload vb.)
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
            Debug.Log("[AltareFirebase] named app ready → project=" + ProjectId);
        }
    }
}
