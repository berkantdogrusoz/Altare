// =============================================================================
// AltareAnalytics.cs  —  v2.3.0
// -----------------------------------------------------------------------------
// Drop-in Unity client for the Altare AI Live Game Intelligence platform.
//
// v2.3 highlights:
//   - Memory pressure tracking (memory_warning when low/anomalous)
//   - ANR (Android Not Responding) detection via main-thread heartbeat
//   - GPU model + RAM fingerprinting per event (deviceParams)
//   - Circuit breaker: if Firebase fails repeatedly, SDK disables itself
//     and never blocks the game. Stability above analytics.
//   - LogMemoryWarning / LogANR public APIs for engine-level hooks
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
//   - GPU/RAM are coarse device fingerprint — never PII.
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
            if (_instance._circuitOpen)
            {
                // Circuit breaker open — silently drop. Game must not be blocked.
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

        /// <summary>Manuel memory warning — kullanici kendi MemoryProfiler'indan tetikleyebilir.</summary>
        public static void LogMemoryWarning(long usedMb = -1, long totalMb = -1, string source = "manual")
        {
            var p = new Dictionary<string, object> { { "source", source } };
            if (usedMb > 0) p["used_mb"] = usedMb;
            if (totalMb > 0) p["total_memory_mb"] = totalMb;
            LogEvent("memory_warning", p);
        }

        /// <summary>Manuel ANR — uzun frame veya main-thread block tetikleyici.</summary>
        public static void LogANR(float frameTimeMs, string source = "auto")
        {
            LogEvent("anr_detected", new Dictionary<string, object> {
                { "frame_time_ms", Mathf.RoundToInt(frameTimeMs) },
                { "source", source },
            });
        }

        public static void SubmitFeedback(int rating, string text)
        {
            if (_instance == null || _instance._circuitOpen) return;
            _instance.WriteFeedback(rating, text);
        }

        public static string PlayerAnonId => _instance != null ? _instance._playerAnonId : null;
        public static string GameId => _instance != null ? _instance._gameId : null;
        public static bool IsHealthy => _instance != null && _instance._ready && !_instance._circuitOpen;

        private const string PrefsPlayerIdKey = "altare.playerAnonId";

        private static AltareAnalytics _instance;

        private string _gameId;
        private string _gameName;
        private string _playerAnonId;
        private string _sessionId;
        private string _platform;
        private string _appVersion;
        private string _deviceModel;
        private string _gpuModel;
        private long _totalMemoryMb;
        private bool _isFirstOpen;

        private FirebaseFirestore _db;
        private bool _ready;
        private bool _initFailed;

        // Circuit breaker (Mücahit'in stability endişesi)
        private bool _circuitOpen = false;
        private int _consecutiveWriteFailures = 0;
        private const int CircuitBreakerThreshold = 10;

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

        // ANR detection (Umut Can'in onerisi)
        private const float AnrFrameThresholdSec = 5f;  // Android ANR threshold
        private float _lastFrameTime;
        private float _lastAnrAt = -999f;

        // Memory tracking (Umut Can'in onerisi)
        private const float MemoryCheckIntervalSec = 30f;
        private float _memoryCheckTimer;
        private long _lastReportedMemoryMb = 0;
        private float _lastMemoryWarnAt = -999f;
        private const long MemoryWarningGrowthMb = 100;  // >100MB pressure jump

        private void Boot()
        {
            try
            {
                _playerAnonId = LoadOrCreatePlayerId(out _isFirstOpen);
                _sessionId = Guid.NewGuid().ToString("N");
                _platform = Application.platform.ToString();
                _appVersion = Application.version;
                _deviceModel = SystemInfo.deviceModel;
                _gpuModel = SystemInfo.graphicsDeviceName;
                _totalMemoryMb = SystemInfo.systemMemorySize;
                _sessionStartTime = Time.realtimeSinceStartup;
                _lastFrameTime = Time.realtimeSinceStartup;
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Altare] Boot init failed (non-fatal): " + e.Message);
                TripCircuit("boot");
                return;
            }

            FirebaseApp.CheckAndFixDependenciesAsync().ContinueWithOnMainThread(task =>
            {
                if (task.Result != DependencyStatus.Available)
                {
                    _initFailed = true;
                    Debug.LogWarning("[Altare] Firebase deps unavailable: " + task.Result + " — SDK disabled, game continues.");
                    TripCircuit("firebase_deps");
                    return;
                }
                FirebaseAuth.DefaultInstance.SignInAnonymouslyAsync()
                    .ContinueWithOnMainThread(authTask =>
                    {
                        if (authTask.IsFaulted || authTask.IsCanceled)
                        {
                            _initFailed = true;
                            Debug.LogWarning("[Altare] Anonymous auth failed — SDK disabled, game continues.");
                            TripCircuit("auth");
                            return;
                        }
                        _db = FirebaseFirestore.DefaultInstance;
                        _ready = true;
                        Debug.Log("[Altare] Ready. gameId=" + _gameId
                                  + " playerAnonId=" + _playerAnonId
                                  + " sessionId=" + _sessionId);
                        if (_isFirstOpen)
                            LogEvent("first_open", null);
                        LogEvent("app_open", new Dictionary<string, object> {
                            { "is_first_open", _isFirstOpen },
                            { "gpu", _gpuModel },
                            { "ram_mb", _totalMemoryMb },
                        });
                        LogSessionStart();
                        FlushBuffer();
                    });
            });
        }

        private void TripCircuit(string reason)
        {
            _circuitOpen = true;
            _ready = false;
            Debug.LogWarning("[Altare] Circuit breaker tripped: " + reason + ". Analytics disabled for this session.");
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
            if (_db == null || _circuitOpen) return;

            try
            {
                var payload = new Dictionary<string, object>
                {
                    { "gameId",        _gameId },
                    { "gameName",      _gameName },
                    { "playerAnonId",  _playerAnonId },
                    { "sessionId",     _sessionId },
                    { "eventName",     pending.eventName },
                    { "eventParams",   EnrichParams(pending.parameters) },
                    { "timestamp",     FieldValue.ServerTimestamp },
                    { "clientTimestamp", Timestamp.FromDateTime(pending.clientTimestampUtc) },
                    { "platform",      _platform },
                    { "appVersion",    _appVersion },
                    { "deviceModel",   _deviceModel },
                    { "gpuModel",      _gpuModel },
                    { "totalMemoryMb", _totalMemoryMb },
                };

                _db.Collection("games").Document(_gameId)
                   .Collection("events").Document()
                   .SetAsync(payload)
                   .ContinueWithOnMainThread(t =>
                   {
                       if (t.IsFaulted)
                       {
                           _consecutiveWriteFailures++;
                           Debug.LogWarning("[Altare] event write failed (" + pending.eventName
                                            + "): " + t.Exception?.GetBaseException()?.Message);
                           if (_consecutiveWriteFailures >= CircuitBreakerThreshold)
                           {
                               TripCircuit("write_failures_threshold");
                           }
                       }
                       else
                       {
                           _consecutiveWriteFailures = 0;
                       }
                   });
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Altare] WriteEvent exception (non-fatal): " + e.Message);
                _consecutiveWriteFailures++;
                if (_consecutiveWriteFailures >= CircuitBreakerThreshold) TripCircuit("write_exceptions");
            }
        }

        private Dictionary<string, object> EnrichParams(Dictionary<string, object> p)
        {
            // Ensure gpu and ram are always available for device-tier analysis
            if (p == null) p = new Dictionary<string, object>();
            if (!p.ContainsKey("gpu_model")) p["gpu_model"] = _gpuModel;
            if (!p.ContainsKey("total_memory_mb")) p["total_memory_mb"] = _totalMemoryMb;
            return p;
        }

        private void WriteFeedback(int rating, string text)
        {
            if (_db == null || _circuitOpen)
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
            if (!_ready || _circuitOpen) return;

            // FPS check
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

            // ANR check — measure frame duration; if >5sn (ANR threshold) report
            float dt = Time.realtimeSinceStartup - _lastFrameTime;
            _lastFrameTime = Time.realtimeSinceStartup;
            if (dt > AnrFrameThresholdSec && Time.realtimeSinceStartup - _lastAnrAt > 60f)
            {
                _lastAnrAt = Time.realtimeSinceStartup;
                LogANR(dt * 1000f, "auto");
            }

            // Memory check
            _memoryCheckTimer += Time.unscaledDeltaTime;
            if (_memoryCheckTimer >= MemoryCheckIntervalSec)
            {
                _memoryCheckTimer = 0;
                long usedMb = (long)(UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong() / (1024L * 1024L));
                if (_lastReportedMemoryMb > 0 &&
                    usedMb - _lastReportedMemoryMb > MemoryWarningGrowthMb &&
                    Time.realtimeSinceStartup - _lastMemoryWarnAt > 120f)
                {
                    _lastMemoryWarnAt = Time.realtimeSinceStartup;
                    LogMemoryWarning(usedMb, _totalMemoryMb, "growth");
                }
                _lastReportedMemoryMb = usedMb;
            }
        }

        private void OnApplicationLowMemory()
        {
            // Unity'nin native low-memory signal'i
            if (_ready && !_circuitOpen)
            {
                long usedMb = (long)(UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong() / (1024L * 1024L));
                LogMemoryWarning(usedMb, _totalMemoryMb, "system");
            }
        }

        private void OnApplicationPause(bool pauseStatus)
        {
            if (!_ready || _circuitOpen) return;
            if (pauseStatus)
            {
                LogSessionEnd(Time.realtimeSinceStartup - _sessionStartTime);
            }
            else
            {
                _sessionId = Guid.NewGuid().ToString("N");
                _sessionStartTime = Time.realtimeSinceStartup;
                _lastFrameTime = Time.realtimeSinceStartup;
                LogSessionStart();
            }
        }

        private void OnApplicationQuit()
        {
            _quitting = true;
            if (!_ready || _circuitOpen) return;
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
