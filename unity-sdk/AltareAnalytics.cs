// =============================================================================
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
//   AltareAnalytics.LogEvent("level_start", new Dictionary<string, object> {
//       { "level", currentLevel }
//   });
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
                Debug.LogWarning("[Altare] LogEvent called before Initialize — dropping: " + eventName);
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
                { "text", (text ?? "").Length > 80 ? (text.Substring(0, 80) + "…") : text ?? "" },
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
