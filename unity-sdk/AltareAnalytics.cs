// =============================================================================
// AltareAnalytics.cs  —  v3.0.0
// -----------------------------------------------------------------------------
// Altare AI Live Game Intelligence — evrensel Unity analitik istemcisi.
//
// TASARIM ILKESI: Bu SDK hicbir oyuna ozel degildir. Tur, motor, altyapi
// farketmeksizin ayni sekilde calisir. Tek yapilandirma noktasi
// Initialize(gameId, gameName, apiKey) cagrisidir.
//
// ─── v3.0 — NE DEGISTI, NEDEN ─────────────────────────────────────────────
//
// 1) FIREBASE BAGIMLILIGI KALKTI (analitik yolunda)
//    Eskiden her event dogrudan Firestore'a yaziliyordu; bu, oyunun
//    Firebase Unity SDK'sini import etmesini ZORUNLU kiliyordu. Artik
//    olaylar HTTPS ile Altare'nin `ingestEvents` ucuna gonderiliyor.
//    Sonuc: Firebase'i OLMAYAN oyunlar da yalnizca bu .cs dosyalarini
//    kopyalayarak calisir. (Remote Config ve PlayerState modulleri hala
//    Firebase ister — onlar istege baglidir.)
//
// 2) TOPLU GONDERIM (batching)
//    Eskiden her event ANINDA ayri bir istek/yazim uretiyordu; 50 event =
//    50 ag turu. Artik olaylar biriktirilip tek istekte gonderiliyor:
//    50 event dolunca VEYA 30 sn gecince VEYA oyun arka plana atilinca.
//    Kazanc: ag turu ve faturalanan Cloud Function cagrisi ~50 kat azalir,
//    pil tuketimi duser.
//    NOT: Firestore dokuman basina ucretlendirdigi icin depolama maliyeti
//    bu adimda DEGISMEZ — o kazanc sutunlu veritabani gecisinde gelir.
//
// 3) DISKE YAZAN KUYRUK
//    Eskiden tampon yalnizca bellekteydi: oyun cokerse, oyuncu ucak
//    modundayken kapatirsa olaylar UCUYORDU. Artik kuyruk kalici
//    depolamaya yazilir ve sunucu "aldim" diyene kadar SILINMEZ.
//
// 4) AKILLI YENIDEN DENEME
//    Hata tipleri ayrildi. Kalici hatalar (bozuk govde, bilinmeyen oyun,
//    gecersiz anahtar) sonsuz donguye sokmaz — olcum kapatilir. Gecici
//    hatalar (ag, 429, 5xx) ustel geri cekilmeyle tekrar denenir.
//
// ─── KULLANIM ─────────────────────────────────────────────────────────────
//
//   void Start() {
//       AltareAnalytics.Initialize("oyun-kimligi", "Oyun Adi", "altr_...");
//   }
//   AltareAnalytics.LogEvent("level_start", new() { { "level", 5 } });
//
// apiKey panelde: Oyunlarim -> <oyun> -> SDK Bilgileri.
//
// GEREKSINIM: Yok. Sadece Unity. (Firebase modulleri yalnizca AltareConfig
// / AltarePlayerState kullanilacaksa gerekir.)
//
// GIZLILIK: Yalnizca anonim UUID (playerAnonId) saklanir. E-posta, telefon,
// konum, reklam kimligi TOPLANMAZ. GPU/RAM kaba cihaz sinifidir, PII degil.
// =============================================================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace Altare.Analytics
{
    public class AltareAnalytics : MonoBehaviour
    {
        // ─────────────────────────────────────────────────────────────────
        // Ayarlar
        // ─────────────────────────────────────────────────────────────────

        /// <summary>Sunucu istek basina en fazla 50 olay kabul ediyor.</summary>
        private const int YiginBoyutu = 50;

        /// <summary>Yigin dolmasa bile bu araliktan sonra gonder.</summary>
        private const float GonderimAraligiSn = 30f;

        /// <summary>
        /// Kuyruk tavani. Uzun cevrimdisi oturumda sinirsiz birikmesin;
        /// tavana gelince EN ESKI olay dusurulur (yeni veri daha degerli).
        /// </summary>
        private const int KuyrukTavani = 2000;

        /// <summary>Kac olayda bir kuyruk diske yazilsin.</summary>
        private const int DiskeYazmaAraligi = 25;

        private const string KuyrukDosyaAdi = "altare_events.jsonl";
        private const string VarsayilanUc =
            "https://europe-west1-altare-312a1.cloudfunctions.net/ingestEvents";

        private const string PrefsPlayerIdKey = "altare.playerAnonId";
        public const string ConsentPrefsKey = "app_consent_analytics";

        // Ustel geri cekilme: 2, 4, 8, 16, 32, 60, 60...
        private const float IlkBekleme = 2f;
        private const float EnUzunBekleme = 60f;

        // ─────────────────────────────────────────────────────────────────
        // Public API
        // ─────────────────────────────────────────────────────────────────

        /// <summary>
        /// SDK'yi baslatir. Idempotent — birden fazla cagri zararsizdir.
        /// </summary>
        /// <param name="gameId">Panelde kayitli oyun kimligi (zorunlu).</param>
        /// <param name="gameName">Panelde gorunen ad.</param>
        /// <param name="apiKey">Panel -> SDK Bilgileri'ndeki anahtar. Bos
        /// birakilabilir (sunucu gecis donemindedir) ama VERILMESI onerilir.</param>
        /// <param name="endpoint">Ozel uc; normalde bos birakilir.</param>
        public static void Initialize(string gameId, string gameName,
                                      string apiKey = null, string endpoint = null)
        {
            if (_instance != null) return;
            if (string.IsNullOrWhiteSpace(gameId))
                throw new ArgumentException("gameId zorunlu", nameof(gameId));

            var go = new GameObject("[AltareAnalytics]");
            go.hideFlags = HideFlags.HideInHierarchy;
            DontDestroyOnLoad(go);

            _instance = go.AddComponent<AltareAnalytics>();
            _instance._gameId = gameId.Trim();
            _instance._gameName = string.IsNullOrWhiteSpace(gameName) ? gameId : gameName.Trim();
            _instance._apiKey = (apiKey ?? "").Trim();
            _instance._uc = string.IsNullOrWhiteSpace(endpoint) ? VarsayilanUc : endpoint.Trim();
            _instance.Boot();
        }

        public static void LogEvent(string eventName, Dictionary<string, object> parameters = null)
        {
            if (string.IsNullOrWhiteSpace(eventName)) return;
            if (_instance == null)
            {
                Debug.LogWarning("[Altare] Initialize cagrilmadan LogEvent — dusuruldu: " + eventName);
                return;
            }
            _instance.Kuyruga(eventName, parameters);
        }

        public static void LogSessionStart() => LogEvent("session_start", null);

        public static void LogSessionEnd(float durationSeconds)
        {
            LogEvent("session_end", new Dictionary<string, object> {
                { "duration_seconds", durationSeconds }
            });
        }

        /// <summary>Manuel memory warning.</summary>
        public static void LogMemoryWarning(long usedMb = -1, long totalMb = -1, string source = "manual")
        {
            var p = new Dictionary<string, object> { { "source", source } };
            if (usedMb > 0) p["used_mb"] = usedMb;
            if (totalMb > 0) p["total_memory_mb"] = totalMb;
            LogEvent("memory_warning", p);
        }

        /// <summary>Manuel ANR — uzun frame veya main-thread block.</summary>
        public static void LogANR(float frameTimeMs, string source = "auto")
        {
            LogEvent("anr_detected", new Dictionary<string, object> {
                { "frame_time_ms", Mathf.RoundToInt(frameTimeMs) },
                { "source", source },
            });
        }

        /// <summary>
        /// Oyuncu geri bildirimi. Olay akisina `player_feedback` olarak gider;
        /// ayri bir altyapi gerektirmez.
        /// </summary>
        public static void SubmitFeedback(int rating, string text)
        {
            var t = text ?? "";
            LogEvent("player_feedback", new Dictionary<string, object> {
                { "rating", rating },
                { "text", t.Length > 280 ? t.Substring(0, 280) : t },
            });
            Flush();
        }

        /// <summary>Bekleyen olaylari hemen gondermeyi dener.</summary>
        public static void Flush()
        {
            if (_instance != null) _instance._hemenGonder = true;
        }

        /// <summary>
        /// KVKK/GDPR onayi. Consent ekrani olan oyunlar kullanicinin secimini
        /// buradan yazar. Red gelirse SDK durur ve diskteki kuyruk silinir.
        /// </summary>
        public static void SetAnalyticsConsent(bool granted)
        {
            PlayerPrefs.SetInt(ConsentPrefsKey, granted ? 1 : 0);
            PlayerPrefs.Save();
            if (!granted && _instance != null)
            {
                _instance._kuyruk.Clear();
                _instance.DiskiTemizle();
                _instance.Kapat("consent_revoked");
            }
        }

        public static string PlayerAnonId => _instance != null ? _instance._playerAnonId : null;
        public static string GameId => _instance != null ? _instance._gameId : null;
        public static string GameName => _instance != null ? _instance._gameName : null;
        public static string SessionId => _instance != null ? _instance._sessionId : null;
        public static bool IsHealthy => _instance != null && !_instance._kapali;

        /// <summary>
        /// Panel anahtari. AltareConfig bunu getGameConfig cagrisinda
        /// X-Altare-Key basligi olarak kullanir — kimlik tek yerde tutulur,
        /// her modulde ayri ayri yapilandirilmasi gerekmez.
        /// </summary>
        public static string ApiKey => _instance != null ? _instance._apiKey : null;

        /// <summary>Olay ucunun kok adresi — AltareConfig kendi ucunu bundan turetir.</summary>
        public static string EndpointBase
        {
            get
            {
                string uc = _instance != null ? _instance._uc : null;
                if (string.IsNullOrEmpty(uc)) uc = VarsayilanUc;
                int i = uc.LastIndexOf('/');
                return i > 0 ? uc.Substring(0, i) : uc;
            }
        }

        /// <summary>Tanilama: su an gonderilmeyi bekleyen olay sayisi.</summary>
        public static int PendingEventCount => _instance != null ? _instance._kuyruk.Count : 0;

        // ─────────────────────────────────────────────────────────────────
        // Durum
        // ─────────────────────────────────────────────────────────────────

        private static AltareAnalytics _instance;

        private string _gameId;
        private string _gameName;
        private string _apiKey;
        private string _uc;

        private string _playerAnonId;
        private string _sessionId;
        private string _platform;
        private string _appVersion;
        private string _deviceModel;
        private string _gpuModel;
        private long _totalMemoryMb;
        private bool _isFirstOpen;

        private bool _kapali;
        private bool _hemenGonder;
        private bool _gonderimSuruyor;
        private int _diskSayaci;
        private float _bekleme = IlkBekleme;

        private readonly List<Kayit> _kuyruk = new List<Kayit>(64);
        private string _kuyrukYolu;

        private float _oturumBaslangici;

        // Izleme (FPS / ANR / bellek) — motor bagimsiz, her oyunda ayni
        private const float FpsKontrolAraligi = 5f;
        private const float FpsEsigi = 30f;
        private const float FpsUyariBekleme = 60f;
        private float _fpsToplam; private int _fpsKare; private float _fpsSayac; private float _sonFpsUyari = -999f;

        private const float AnrEsigiSn = 5f;
        private float _sonKareZamani; private float _sonAnr = -999f;

        private const float BellekKontrolAraligi = 30f;
        private float _bellekSayac; private long _sonBellekMb; private float _sonBellekUyari = -999f;
        private const long BellekArtisEsigiMb = 100;

        private struct Kayit
        {
            public string ad;
            public Dictionary<string, object> parametreler;
            public string zamanIso;
        }

        // ─────────────────────────────────────────────────────────────────
        // Kurulum
        // ─────────────────────────────────────────────────────────────────

        private void Boot()
        {
            try
            {
                _kuyrukYolu = Path.Combine(Application.persistentDataPath, KuyrukDosyaAdi);

                _playerAnonId = KimlikYukleVeyaUret(out _isFirstOpen);
                _sessionId = Guid.NewGuid().ToString("N");
                _platform = Application.platform.ToString();
                _appVersion = Application.version;
                _deviceModel = SystemInfo.deviceModel;
                _gpuModel = SystemInfo.graphicsDeviceName;
                _totalMemoryMb = SystemInfo.systemMemorySize;
                _oturumBaslangici = Time.realtimeSinceStartup;
                _sonKareZamani = Time.realtimeSinceStartup;

                DiskiYukle();
            }
            catch (Exception e)
            {
                // Olcum ugruna oyun patlatilmaz — bu SDK'nin temel kurali.
                Debug.LogWarning("[Altare] Kurulum hatasi (olumcul degil): " + e.Message);
                Kapat("boot");
                return;
            }

            Debug.Log("[Altare] Hazir. gameId=" + _gameId
                      + " session=" + _sessionId
                      + " bekleyen=" + _kuyruk.Count);

            if (_isFirstOpen) LogEvent("first_open", null);
            LogEvent("app_open", new Dictionary<string, object> {
                { "is_first_open", _isFirstOpen },
                { "gpu", _gpuModel },
                { "ram_mb", _totalMemoryMb },
            });
            LogSessionStart();

            StartCoroutine(GonderimDongusu());
        }

        private string KimlikYukleVeyaUret(out bool yeni)
        {
            string id = PlayerPrefs.GetString(PrefsPlayerIdKey, null);
            if (string.IsNullOrEmpty(id))
            {
                id = Guid.NewGuid().ToString("N");
                PlayerPrefs.SetString(PrefsPlayerIdKey, id);
                PlayerPrefs.Save();
                yeni = true;
                return id;
            }
            yeni = false;
            return id;
        }

        private void Kapat(string sebep)
        {
            _kapali = true;
            Debug.LogWarning("[Altare] Olcum kapatildi: " + sebep);
        }

        // ─────────────────────────────────────────────────────────────────
        // Kuyruk + disk kaliciligi
        // ─────────────────────────────────────────────────────────────────

        private void Kuyruga(string ad, Dictionary<string, object> p)
        {
            if (_kapali) return;

            var kayit = new Kayit
            {
                ad = ad,
                parametreler = ParametreleriZenginlestir(p),
                zamanIso = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            };

            // Tavan asilirsa en eskiyi dusur — yeni veri daha temsili.
            if (_kuyruk.Count >= KuyrukTavani) _kuyruk.RemoveAt(0);
            _kuyruk.Add(kayit);

            if (++_diskSayaci >= DiskeYazmaAraligi)
            {
                _diskSayaci = 0;
                DiskeYaz();
            }
            if (_kuyruk.Count >= YiginBoyutu) _hemenGonder = true;
        }

        private Dictionary<string, object> ParametreleriZenginlestir(Dictionary<string, object> p)
        {
            var d = p != null ? new Dictionary<string, object>(p) : new Dictionary<string, object>();
            // Cihaz sinifi analizi her event'te elde olsun.
            if (!d.ContainsKey("gpu_model")) d["gpu_model"] = _gpuModel;
            if (!d.ContainsKey("total_memory_mb")) d["total_memory_mb"] = _totalMemoryMb;
            return d;
        }

        /// <summary>
        /// Kuyrugu diske yazar. Cokme/kapanma sonrasi veri kaybini onler.
        /// Her olayda degil, DiskeYazmaAraligi'nda bir + duraklama/cikista
        /// yazilir — surekli I/O mobilde takilmaya yol acar.
        /// </summary>
        private void DiskeYaz()
        {
            if (string.IsNullOrEmpty(_kuyrukYolu)) return;
            try
            {
                if (_kuyruk.Count == 0) { DiskiTemizle(); return; }

                var sb = new StringBuilder(_kuyruk.Count * 128);
                for (int i = 0; i < _kuyruk.Count; i++)
                {
                    sb.Append('{');
                    Alan(sb, "eventName", _kuyruk[i].ad); sb.Append(',');
                    Alan(sb, "clientTimestamp", _kuyruk[i].zamanIso); sb.Append(',');
                    sb.Append("\"eventParams\":");
                    ParametreYaz(sb, _kuyruk[i].parametreler);
                    sb.Append("}\n");
                }
                File.WriteAllText(_kuyrukYolu, sb.ToString());
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Altare] Kuyruk diske yazilamadi: " + e.Message);
            }
        }

        private void DiskiYukle()
        {
            try
            {
                if (!File.Exists(_kuyrukYolu)) return;
                var satirlar = File.ReadAllLines(_kuyrukYolu);
                int yuklenen = 0;
                foreach (var satir in satirlar)
                {
                    if (string.IsNullOrWhiteSpace(satir)) continue;
                    var k = SatirdanKayit(satir);
                    if (k.HasValue)
                    {
                        if (_kuyruk.Count >= KuyrukTavani) _kuyruk.RemoveAt(0);
                        _kuyruk.Add(k.Value);
                        yuklenen++;
                    }
                }
                if (yuklenen > 0)
                    Debug.Log("[Altare] Onceki oturumdan " + yuklenen + " olay kurtarildi.");
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Altare] Kuyruk okunamadi: " + e.Message);
            }
        }

        /// <summary>
        /// Diskteki satiri geri okur. Tam bir JSON ayristiricisi degil —
        /// yalnizca kendi yazdigimiz formati cozer; ham JSON parametreleri
        /// oldugu gibi tasinir (yeniden serilestirilmez).
        /// </summary>
        private Kayit? SatirdanKayit(string satir)
        {
            try
            {
                string ad = DegerCek(satir, "eventName");
                string zaman = DegerCek(satir, "clientTimestamp");
                if (string.IsNullOrEmpty(ad)) return null;

                int i = satir.IndexOf("\"eventParams\":", StringComparison.Ordinal);
                string ham = null;
                if (i >= 0)
                {
                    int bas = satir.IndexOf('{', i);
                    if (bas >= 0)
                    {
                        int derinlik = 0; bool metinde = false; bool kacis = false;
                        for (int j = bas; j < satir.Length; j++)
                        {
                            char c = satir[j];
                            if (kacis) { kacis = false; continue; }
                            if (c == '\\') { kacis = true; continue; }
                            if (c == '"') { metinde = !metinde; continue; }
                            if (metinde) continue;
                            if (c == '{') derinlik++;
                            else if (c == '}') { derinlik--; if (derinlik == 0) { ham = satir.Substring(bas, j - bas + 1); break; } }
                        }
                    }
                }

                var p = new Dictionary<string, object>();
                if (!string.IsNullOrEmpty(ham)) p[HamAnahtar] = ham;

                return new Kayit
                {
                    ad = ad,
                    parametreler = p,
                    zamanIso = string.IsNullOrEmpty(zaman)
                        ? DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)
                        : zaman,
                };
            }
            catch { return null; }
        }

        /// <summary>Diskten okunan ham JSON parametre blogunu tasiyan ozel anahtar.</summary>
        private const string HamAnahtar = "__altare_raw__";

        /// <summary>
        /// Diskteki satirdan bir metin alani okur ve JSON kacislarini COZER.
        /// Naif "ters bolu sonrasini oldugu gibi al" yaklasimi \n'i 'n', 'i
        /// 'u0001' yapip veriyi sessizce bozuyordu — asagidaki tam cozum sart.
        /// </summary>
        private static string DegerCek(string satir, string anahtar)
        {
            string iz = "\"" + anahtar + "\":\"";
            int i = satir.IndexOf(iz, StringComparison.Ordinal);
            if (i < 0) return null;
            int bas = i + iz.Length;
            var sb = new StringBuilder();
            for (int j = bas; j < satir.Length; j++)
            {
                char c = satir[j];
                if (c == '"') break;
                if (c != '\\') { sb.Append(c); continue; }
                if (j + 1 >= satir.Length) break;

                char k = satir[++j];
                switch (k)
                {
                    case '"':  sb.Append('"');  break;
                    case '\\': sb.Append('\\'); break;
                    case '/':  sb.Append('/');  break;
                    case 'n':  sb.Append('\n'); break;
                    case 'r':  sb.Append('\r'); break;
                    case 't':  sb.Append('\t'); break;
                    case 'b':  sb.Append('\b'); break;
                    case 'f':  sb.Append('\f'); break;
                    case 'u':
                        if (j + 4 < satir.Length &&
                            int.TryParse(satir.Substring(j + 1, 4),
                                         NumberStyles.HexNumber,
                                         CultureInfo.InvariantCulture, out int kod))
                        {
                            sb.Append((char)kod);
                            j += 4;
                        }
                        break;
                    default:
                        // Bilinmeyen kacis: karakteri oldugu gibi koru.
                        sb.Append(k);
                        break;
                }
            }
            return sb.ToString();
        }

        private void DiskiTemizle()
        {
            try { if (File.Exists(_kuyrukYolu)) File.Delete(_kuyrukYolu); }
            catch (Exception e) { Debug.LogWarning("[Altare] Kuyruk silinemedi: " + e.Message); }
        }

        // ─────────────────────────────────────────────────────────────────
        // Gonderim
        // ─────────────────────────────────────────────────────────────────

        private IEnumerator GonderimDongusu()
        {
            float sayac = 0f;
            while (!_kapali)
            {
                yield return null;
                sayac += Time.unscaledDeltaTime;

                bool zamanGeldi = sayac >= GonderimAraligiSn;
                if ((zamanGeldi || _hemenGonder) && !_gonderimSuruyor && _kuyruk.Count > 0)
                {
                    sayac = 0f;
                    _hemenGonder = false;
                    yield return Gonder();
                }
                else if (zamanGeldi)
                {
                    sayac = 0f;
                }
            }
        }

        private IEnumerator Gonder()
        {
            _gonderimSuruyor = true;

            int adet = Mathf.Min(_kuyruk.Count, YiginBoyutu);
            var yigin = _kuyruk.GetRange(0, adet);
            string govde = GovdeYap(yigin);

            UnityWebRequest istek = null;
            try
            {
                istek = new UnityWebRequest(_uc, "POST");
                istek.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(govde));
                istek.downloadHandler = new DownloadHandlerBuffer();
                istek.SetRequestHeader("Content-Type", "application/json");
                if (!string.IsNullOrEmpty(_apiKey))
                    istek.SetRequestHeader("X-Altare-Key", _apiKey);
                istek.timeout = 20;
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Altare] Istek kurulamadi: " + e.Message);
                _gonderimSuruyor = false;
                yield break;
            }

            yield return istek.SendWebRequest();

            bool basarili = istek.result == UnityWebRequest.Result.Success;
            long kod = istek.responseCode;
            string cevap = null;
            try { cevap = istek.downloadHandler != null ? istek.downloadHandler.text : null; } catch { }
            istek.Dispose();

            if (basarili)
            {
                // SADECE gonderilen kadarini sil — bu sirada eklenenler kalsin.
                _kuyruk.RemoveRange(0, Mathf.Min(adet, _kuyruk.Count));
                _bekleme = IlkBekleme;
                DiskeYaz();
            }
            else if (kod == 400 || kod == 404 || kod == 413)
            {
                // KALICI govde/yapilandirma hatasi: bilinmeyen gameId, bozuk
                // govde, cok fazla olay. Tekrar denemek sonsuz dongudur.
                Debug.LogError("[Altare] Kalici hata " + kod + " — olcum kapatildi. " + cevap);
                _kuyruk.Clear();
                DiskiTemizle();
                Kapat("http_" + kod);
            }
            else if (kod == 401 || kod == 403)
            {
                // KALICI kimlik hatasi: yanlis/eksik API anahtari. Kendiliginden
                // duzelmez; tekrar denemek 30 sn'de bir sonsuza kadar bos istek
                // uretir ve faturalanir. Yuksek sesle logla ve dur.
                Debug.LogError("[Altare] API anahtari gecersiz (" + kod + "). " +
                               "Panel -> SDK Bilgileri'ndeki anahtari Initialize'a ver. " +
                               "Olcum kapatildi.");
                Kapat("auth_" + kod);
            }
            else
            {
                // GECICI: ag hatasi, 429, 5xx. Kuyrugu KORU, ustel geri cekilme.
                Debug.LogWarning("[Altare] Gonderim basarisiz (" + kod + "), " +
                                 _bekleme.ToString("0") + " sn sonra tekrar denenecek.");
                DiskeYaz();
                yield return new WaitForSecondsRealtime(_bekleme);
                _bekleme = Mathf.Min(_bekleme * 2f, EnUzunBekleme);
            }

            _gonderimSuruyor = false;
        }

        // ─────────────────────────────────────────────────────────────────
        // JSON — elle uretiliyor (sifir bagimlilik)
        // ─────────────────────────────────────────────────────────────────

        private string GovdeYap(List<Kayit> yigin)
        {
            var sb = new StringBuilder(256 + yigin.Count * 128);
            sb.Append('{');
            Alan(sb, "gameId", _gameId); sb.Append(',');
            Alan(sb, "gameName", _gameName); sb.Append(',');
            Alan(sb, "playerAnonId", _playerAnonId); sb.Append(',');
            // sessionId KRITIK: sunucuda uniqueSessions bundan sayilir ve
            // uniqueSessions, anomali oranlarinin paydasidir. Eksik olursa
            // Sentinel yanlis alarm uretir.
            Alan(sb, "sessionId", _sessionId); sb.Append(',');
            Alan(sb, "platform", _platform); sb.Append(',');
            Alan(sb, "appVersion", _appVersion); sb.Append(',');
            Alan(sb, "deviceModel", _deviceModel); sb.Append(',');
            Alan(sb, "gpuModel", _gpuModel); sb.Append(',');
            sb.Append("\"totalMemoryMb\":").Append(_totalMemoryMb).Append(',');
            sb.Append("\"events\":[");
            for (int i = 0; i < yigin.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('{');
                Alan(sb, "eventName", yigin[i].ad); sb.Append(',');
                Alan(sb, "clientTimestamp", yigin[i].zamanIso); sb.Append(',');
                sb.Append("\"eventParams\":");
                ParametreYaz(sb, yigin[i].parametreler);
                sb.Append('}');
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static void ParametreYaz(StringBuilder sb, Dictionary<string, object> p)
        {
            // Diskten kurtarilan kayitlar ham JSON tasir — oldugu gibi yaz.
            if (p != null && p.Count == 1 && p.ContainsKey(HamAnahtar))
            {
                sb.Append(p[HamAnahtar] as string ?? "{}");
                return;
            }

            sb.Append('{');
            if (p != null)
            {
                bool ilk = true;
                foreach (var kv in p)
                {
                    if (kv.Key == HamAnahtar) continue;
                    if (!ilk) sb.Append(',');
                    ilk = false;
                    Metin(sb, kv.Key); sb.Append(':');
                    DegerYaz(sb, kv.Value);
                }
            }
            sb.Append('}');
        }

        private static void DegerYaz(StringBuilder sb, object v)
        {
            if (v == null) { sb.Append("null"); return; }
            switch (v)
            {
                case bool b: sb.Append(b ? "true" : "false"); return;
                case string s: Metin(sb, s); return;
                case float f:
                    sb.Append(float.IsNaN(f) || float.IsInfinity(f)
                        ? "null" : f.ToString("R", CultureInfo.InvariantCulture));
                    return;
                case double d:
                    sb.Append(double.IsNaN(d) || double.IsInfinity(d)
                        ? "null" : d.ToString("R", CultureInfo.InvariantCulture));
                    return;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case decimal m: sb.Append(m.ToString(CultureInfo.InvariantCulture)); return;
                default:
                    // Bilinmeyen tip: metne cevir. Sunucu zaten sanitize ediyor.
                    Metin(sb, Convert.ToString(v, CultureInfo.InvariantCulture));
                    return;
            }
        }

        private static void Alan(StringBuilder sb, string ad, string deger)
        {
            Metin(sb, ad); sb.Append(':'); Metin(sb, deger ?? "");
        }

        private static void Metin(StringBuilder sb, string s)
        {
            sb.Append('"');
            if (s != null)
            {
                foreach (char c in s)
                {
                    switch (c)
                    {
                        case '"': sb.Append("\\\""); break;
                        case '\\': sb.Append("\\\\"); break;
                        case '\n': sb.Append("\\n"); break;
                        case '\r': sb.Append("\\r"); break;
                        case '\t': sb.Append("\\t"); break;
                        case '\b': sb.Append("\\b"); break;
                        case '\f': sb.Append("\\f"); break;
                        default:
                            if (c < 0x20 || c == 0x7F)
                                sb.Append("\\u").Append(((int)c).ToString("x4"));
                            else sb.Append(c);
                            break;
                    }
                }
            }
            sb.Append('"');
        }

        // ─────────────────────────────────────────────────────────────────
        // Izleme — FPS / ANR / bellek (motor bagimsiz)
        // ─────────────────────────────────────────────────────────────────

        private void Update()
        {
            if (_kapali) return;

            // FPS
            _fpsToplam += Time.unscaledDeltaTime;
            _fpsKare++;
            _fpsSayac += Time.unscaledDeltaTime;
            if (_fpsSayac >= FpsKontrolAraligi)
            {
                float ort = (_fpsKare > 0 && _fpsToplam > 0) ? _fpsKare / _fpsToplam : 60f;
                _fpsToplam = 0; _fpsKare = 0; _fpsSayac = 0;
                if (ort < FpsEsigi && Time.realtimeSinceStartup - _sonFpsUyari > FpsUyariBekleme)
                {
                    _sonFpsUyari = Time.realtimeSinceStartup;
                    LogEvent("fps_warning", new Dictionary<string, object> {
                        { "avg_fps", Mathf.RoundToInt(ort) },
                        { "device", _deviceModel },
                    });
                }
            }

            // ANR — kare suresi esigi asarsa
            float dt = Time.realtimeSinceStartup - _sonKareZamani;
            _sonKareZamani = Time.realtimeSinceStartup;
            if (dt > AnrEsigiSn && Time.realtimeSinceStartup - _sonAnr > 60f)
            {
                _sonAnr = Time.realtimeSinceStartup;
                LogANR(dt * 1000f, "auto");
            }

            // Bellek
            _bellekSayac += Time.unscaledDeltaTime;
            if (_bellekSayac >= BellekKontrolAraligi)
            {
                _bellekSayac = 0;
                long kullanilanMb = (long)(UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong() / (1024L * 1024L));
                if (_sonBellekMb > 0 &&
                    kullanilanMb - _sonBellekMb > BellekArtisEsigiMb &&
                    Time.realtimeSinceStartup - _sonBellekUyari > 120f)
                {
                    _sonBellekUyari = Time.realtimeSinceStartup;
                    LogMemoryWarning(kullanilanMb, _totalMemoryMb, "growth");
                }
                _sonBellekMb = kullanilanMb;
            }
        }

        private void OnApplicationLowMemory()
        {
            if (_kapali) return;
            long kullanilanMb = (long)(UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong() / (1024L * 1024L));
            LogMemoryWarning(kullanilanMb, _totalMemoryMb, "system");
        }

        private void OnApplicationPause(bool duraklatildi)
        {
            if (_kapali) return;
            if (duraklatildi)
            {
                LogSessionEnd(Time.realtimeSinceStartup - _oturumBaslangici);
                DiskeYaz();      // arka plana atilma = olasi olum; once diske yaz
                _hemenGonder = true;
            }
            else
            {
                // Yeni oturum: sessionId yenilenir.
                _sessionId = Guid.NewGuid().ToString("N");
                _oturumBaslangici = Time.realtimeSinceStartup;
                _sonKareZamani = Time.realtimeSinceStartup;
                LogSessionStart();
            }
        }

        private void OnApplicationQuit()
        {
            if (_kapali) return;
            LogSessionEnd(Time.realtimeSinceStartup - _oturumBaslangici);
            // Cikista senkron ag cagrisi ANR'ye yol acar; bunun yerine diske
            // yaz — sonraki acilista DiskiYukle() kurtarir. Veri KAYBOLMAZ.
            DiskeYaz();
        }
    }
}
