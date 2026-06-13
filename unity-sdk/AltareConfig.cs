// =============================================================================
// AltareConfig.cs — v2.2.0
// -----------------------------------------------------------------------------
// Altare Closed-Loop Remote Config client.
//
// Oyununuzun bazi sabitlerini (level zorlugu, reklam sikligi, IAP fiyatlari)
// Unity kodundan cikarip server'dan okutursunuz. Sentinel bir anomali tespit
// ettiginde, AI Doctor bu sabitleri otomatik degistirir, oyun anlik ceker —
// yeni APK build/upload gerekmez.
//
// KULLANIM (cok basit):
//
//   // Oyun acilisinda bir kere:
//   AltareConfig.Initialize();
//
//   // Eski:
//   int targetScore = 5000;
//
//   // Yeni — server'dan ceker, default 5000 verir:
//   int targetScore = AltareConfig.GetInt("level_18_target_score", 5000);
//
// AltareAnalytics.Initialize() ile birlikte calismasini saglar — bagimli.
// =============================================================================

using System;
using System.Collections.Generic;
using UnityEngine;
using Firebase.Firestore;
using Firebase.Extensions;

namespace Altare.Analytics
{
    public static class AltareConfig
    {
        // ─── Public API ───

        /// <summary>
        /// Initialize. AltareAnalytics.Initialize() cagrildiktan sonra cagir.
        /// Idempotent.
        /// </summary>
        public static void Initialize()
        {
            if (_initialized) return;
            _initialized = true;
            string gameId = AltareAnalytics.PlayerAnonId != null
                ? GetGameIdFromAnalytics()
                : null;
            if (string.IsNullOrEmpty(gameId))
            {
                // AltareAnalytics henuz baslamamis — 2sn'de bir tekrar dene
                _initialized = false;
                AltareConfigRetry.Schedule();
                return;
            }
            SubscribeToConfig(gameId);
        }

        public static int GetInt(string key, int defaultValue)
        {
            if (_values.TryGetValue(key, out object v))
            {
                if (v is long l) return (int)l;
                if (v is int i) return i;
                if (v is double d) return (int)d;
                if (v is string s && int.TryParse(s, out int parsed)) return parsed;
            }
            return defaultValue;
        }

        public static float GetFloat(string key, float defaultValue)
        {
            if (_values.TryGetValue(key, out object v))
            {
                if (v is double d) return (float)d;
                if (v is float f) return f;
                if (v is long l) return (float)l;
                if (v is int i) return (float)i;
                if (v is string s && float.TryParse(s,
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out float parsed)) return parsed;
            }
            return defaultValue;
        }

        public static string GetString(string key, string defaultValue)
        {
            if (_values.TryGetValue(key, out object v) && v != null)
                return v.ToString();
            return defaultValue;
        }

        public static bool GetBool(string key, bool defaultValue)
        {
            if (_values.TryGetValue(key, out object v))
            {
                if (v is bool b) return b;
                if (v is string s) return s == "true" || s == "1";
                if (v is long l) return l != 0;
            }
            return defaultValue;
        }

        /// <summary>Local kopyanin guncellenip guncellenmedigini ogrenmek icin event.</summary>
        public static event Action OnConfigUpdated;

        /// <summary>Su an aktif olan tum config key'leri (debug icin).</summary>
        public static IReadOnlyDictionary<string, object> AllValues => _values;

        // ─── Internals ───

        private static bool _initialized;
        private static readonly Dictionary<string, object> _values = new Dictionary<string, object>();
        private static ListenerRegistration _listener;

        private static string GetGameIdFromAnalytics()
        {
            // AltareAnalytics gameId'i private tutuyor; reflection ile alir
            // (gelecekte AltareAnalytics.GameId public property eklenirse buna gerek kalmaz)
            try
            {
                var t = typeof(AltareAnalytics);
                var field = t.GetField("_gameId",
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
                if (field != null) return field.GetValue(null) as string;
                // Try instance singleton
                var instanceField = t.GetField("_instance",
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
                if (instanceField != null)
                {
                    var inst = instanceField.GetValue(null);
                    if (inst != null)
                    {
                        var gameIdField = t.GetField("_gameId",
                            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                        if (gameIdField != null) return gameIdField.GetValue(inst) as string;
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning("[AltareConfig] gameId alimnamadi: " + e.Message);
            }
            return null;
        }

        private static void SubscribeToConfig(string gameId)
        {
            try
            {
                var db = FirebaseFirestore.DefaultInstance;
                var docRef = db.Collection("games").Document(gameId)
                    .Collection("config").Document("active");
                _listener = docRef.Listen(snapshot =>
                {
                    try
                    {
                        if (!snapshot.Exists)
                        {
                            Debug.Log("[AltareConfig] aktif config yok (henuz uygulama yok).");
                            return;
                        }
                        var data = snapshot.ToDictionary();
                        if (data.TryGetValue("values", out object vObj) && vObj is Dictionary<string, object> vMap)
                        {
                            _values.Clear();
                            foreach (var kv in vMap) _values[kv.Key] = kv.Value;
                            Debug.Log("[AltareConfig] guncellendi: " + _values.Count + " key.");
                            try { OnConfigUpdated?.Invoke(); } catch { }
                        }
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning("[AltareConfig] snapshot parse hata: " + e.Message);
                    }
                });
            }
            catch (Exception e)
            {
                Debug.LogError("[AltareConfig] subscribe hata: " + e.Message);
            }
        }

        private class AltareConfigRetry : MonoBehaviour
        {
            private static AltareConfigRetry _host;
            public static void Schedule()
            {
                if (_host != null) return;
                var go = new GameObject("[AltareConfigRetry]");
                UnityEngine.Object.DontDestroyOnLoad(go);
                _host = go.AddComponent<AltareConfigRetry>();
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
