// =============================================================================
// AltarePlayerState.cs  —  v2.3.0
// -----------------------------------------------------------------------------
// Altare Player State Snapshot & Rollback
//
// Whale oyuncu progress kaybetti? Bug'li patch oyunculari broken state'e atti?
// Bu modul ile oyununuz periyodik veya manuel state snapshot'i atar. Stüdyo
// panel'inden "Restore" tikladiginda oyun degisikligi anlik ceker ve oyuncunun
// onceki state'ini geri yukler.
//
// Kullanim:
//
//   // Bootstrap'tan sonra:
//   AltarePlayerState.Initialize();
//
//   // Her N dakikada bir veya milestone'da snapshot at:
//   AltarePlayerState.SaveSnapshot(new Dictionary<string, object> {
//       { "coins", PlayerData.Coins },
//       { "level", PlayerData.Level },
//       { "inventory", PlayerData.Inventory },
//   }, label: "post_purchase");
//
//   // Pending restore'u dinle (panel tarafindan tetiklendiginde):
//   AltarePlayerState.OnRestoreRequested += (state) => {
//       PlayerData.RestoreFrom(state);
//   };
// =============================================================================

using System;
using System.Collections.Generic;
using UnityEngine;
using Firebase.Firestore;
using Firebase.Functions;
using Firebase.Extensions;

namespace Altare.Analytics
{
    public static class AltarePlayerState
    {
        public static event Action<Dictionary<string, object>> OnRestoreRequested;
        public static event Action<string> OnSnapshotSaved;  // snapshotId

        private static bool _initialized;
        private static ListenerRegistration _listener;
        private static string _lastSeenSnapshotId;

        public static void Initialize()
        {
            if (_initialized) return;
            _initialized = true;

            var gameId = AltareAnalytics.GameId;
            var playerAnonId = AltareAnalytics.PlayerAnonId;
            if (string.IsNullOrEmpty(gameId) || string.IsNullOrEmpty(playerAnonId))
            {
                // AltareAnalytics hazir degil; 2sn'de bir tekrar dene
                _initialized = false;
                AltarePlayerStateRetry.Schedule();
                return;
            }
            SubscribeToRestores(gameId, playerAnonId);
        }

        public static void SaveSnapshot(Dictionary<string, object> state, string label = "auto")
        {
            if (!AltareAnalytics.IsHealthy)
            {
                Debug.LogWarning("[AltarePlayerState] SDK not healthy — snapshot dropped.");
                return;
            }
            var gameId = AltareAnalytics.GameId;
            var playerAnonId = AltareAnalytics.PlayerAnonId;
            if (string.IsNullOrEmpty(gameId) || string.IsNullOrEmpty(playerAnonId)) return;

            try
            {
                var functions = FirebaseFunctions.GetInstance("europe-west1");
                var data = new Dictionary<string, object>
                {
                    { "gameId", gameId },
                    { "playerAnonId", playerAnonId },
                    { "state", state ?? new Dictionary<string, object>() },
                    { "label", label ?? "auto" },
                };
                functions.GetHttpsCallable("writePlayerSnapshot").CallAsync(data)
                    .ContinueWithOnMainThread(t =>
                    {
                        if (t.IsFaulted)
                        {
                            Debug.LogWarning("[AltarePlayerState] snapshot save failed: " + t.Exception?.GetBaseException()?.Message);
                            return;
                        }
                        try
                        {
                            var res = t.Result.Data as Dictionary<object, object>;
                            if (res != null && res.TryGetValue("snapshotId", out object idObj))
                            {
                                string id = idObj?.ToString();
                                if (!string.IsNullOrEmpty(id))
                                {
                                    try { OnSnapshotSaved?.Invoke(id); } catch {}
                                }
                            }
                        }
                        catch (Exception e)
                        {
                            Debug.LogWarning("[AltarePlayerState] parse error: " + e.Message);
                        }
                    });
            }
            catch (Exception e)
            {
                Debug.LogWarning("[AltarePlayerState] SaveSnapshot exception: " + e.Message);
            }
        }

        private static void SubscribeToRestores(string gameId, string playerAnonId)
        {
            try
            {
                var db = FirebaseFirestore.DefaultInstance;
                var docRef = db.Collection("games").Document(gameId)
                    .Collection("player_snapshots").Document(playerAnonId);
                _listener = docRef.Listen(snapshot =>
                {
                    try
                    {
                        if (!snapshot.Exists) return;
                        var data = snapshot.ToDictionary();
                        if (!data.TryGetValue("pendingRestore", out object pendingObj)) return;
                        if (!(pendingObj is Dictionary<string, object> pending)) return;

                        string snapshotId = pending.TryGetValue("snapshotId", out object idObj) ? idObj?.ToString() : null;
                        if (string.IsNullOrEmpty(snapshotId)) return;
                        if (snapshotId == _lastSeenSnapshotId) return;
                        _lastSeenSnapshotId = snapshotId;

                        if (pending.TryGetValue("state", out object stateObj) && stateObj is Dictionary<string, object> state)
                        {
                            Debug.Log("[AltarePlayerState] restore requested: " + snapshotId);
                            try { OnRestoreRequested?.Invoke(state); } catch (Exception e) {
                                Debug.LogError("[AltarePlayerState] restore handler error: " + e.Message);
                            }
                        }
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning("[AltarePlayerState] restore listen error: " + e.Message);
                    }
                });
            }
            catch (Exception e)
            {
                Debug.LogError("[AltarePlayerState] subscribe error: " + e.Message);
            }
        }

        private class AltarePlayerStateRetry : MonoBehaviour
        {
            private static AltarePlayerStateRetry _host;
            public static void Schedule()
            {
                if (_host != null) return;
                var go = new GameObject("[AltarePlayerStateRetry]");
                UnityEngine.Object.DontDestroyOnLoad(go);
                _host = go.AddComponent<AltarePlayerStateRetry>();
                _host.StartCoroutine(_host.Retry());
            }
            private System.Collections.IEnumerator Retry()
            {
                while (!_initialized)
                {
                    yield return new WaitForSeconds(2f);
                    Initialize();
                }
            }
        }
    }
}
