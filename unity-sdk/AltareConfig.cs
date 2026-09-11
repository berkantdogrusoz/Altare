// =============================================================================
// AltareConfig.cs — v3.0.0
// -----------------------------------------------------------------------------
// Altare Closed-Loop Remote Config + A/B deney istemcisi.
//
// ⚠ v3.0'DA NE DEGISTI — FIREBASE ARTIK GEREKMIYOR
//   v2.x bir Firestore dinleyicisi kullaniyordu ve bu, Firebase Unity SDK'sini
//   ZORUNLU kiliyordu: Firebase'i olmayan bir projede bu dosya DERLENMIYORDU
//   bile. Altare'nin hedef kitlesinin buyuk kismi Firebase entegre etmiyor,
//   dolayisiyla hem Remote Config hem de A/B deneyleri o oyunlara hic
//   ulasamiyordu.
//   v3.0 duz HTTPS/JSON kullanir. Bagimlilik yok, ek paket yok.
//
// KULLANIM (degismedi):
//
//   AltareAnalytics.Initialize("oyun.kimligi", "Oyun Adi", "altr_...");
//   AltareConfig.Initialize();
//
//   // Eski:  int targetScore = 5000;
//   // Yeni:
//   int targetScore = AltareConfig.GetInt("level_18_target_score", 5000);
//
// Sunucu bir deger degistirdiginde (Auto-Heal recetesi ya da A/B deneyi)
// oyun bir sonraki yoklamada otomatik ceker — yeni APK gerekmez.
//
// A/B DENEYLERI:
//   Ekstra bir sey yapmaniza gerek yok. Bir deney calisiyorsa GetInt/GetFloat/...
//   zaten bu oyuncunun varyantina ait degeri dondurur ve maruz kalma olayi
//   otomatik gonderilir. Varyanti dogrudan sormak isterseniz:
//       AltareExperiments.GetVariant("exp_abc123")
//
// GEREKEN DOSYALAR: AltareAnalytics.cs + AltareExperiments.cs + bu dosya.
//   (AltareFirebase.cs yalnizca anlik guncelleme istiyorsaniz gerekir —
//    opsiyoneldir, bkz. AltareFirebase.AttachRealtimeConfig.)
// =============================================================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace Altare.Analytics
{
    public static class AltareConfig
    {
        // ─── Ayarlar ───

        /// <summary>Normal yoklama araligi (sn).</summary>
        public static float PollIntervalSeconds = 60f;
        /// <summary>Hata sonrasi ilk bekleme (sn); ust sinira kadar ikiye katlanir.</summary>
        private const float IlkBekleme = 10f;
        private const float EnUzunBekleme = 300f;
        private const int ZamanAsimiSn = 15;

        // ─── Public API ───

        /// <summary>
        /// Baslatir. AltareAnalytics.Initialize() cagrildiktan sonra cagir.
        /// Idempotent.
        /// </summary>
        public static void Initialize()
        {
            if (_baslatildi) return;
            _baslatildi = true;
            AltareConfigHost.Baslat();
        }

        public static int GetInt(string key, int defaultValue)
        {
            object v;
            if (_values.TryGetValue(key, out v))
            {
                if (v is long) return (int)(long)v;
                if (v is int) return (int)v;
                if (v is double) return (int)(double)v;
                if (v is float) return (int)(float)v;
                int p;
                if (v is string && int.TryParse((string)v, out p)) return p;
                if (v is bool) return ((bool)v) ? 1 : 0;
            }
            return defaultValue;
        }

        public static float GetFloat(string key, float defaultValue)
        {
            object v;
            if (_values.TryGetValue(key, out v))
            {
                if (v is double) return (float)(double)v;
                if (v is float) return (float)v;
                if (v is long) return (float)(long)v;
                if (v is int) return (float)(int)v;
                float p;
                if (v is string && float.TryParse((string)v,
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out p)) return p;
            }
            return defaultValue;
        }

        public static string GetString(string key, string defaultValue)
        {
            object v;
            if (_values.TryGetValue(key, out v) && v != null)
            {
                if (v is string) return (string)v;
                if (v is double)
                    return ((double)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
                return v.ToString();
            }
            return defaultValue;
        }

        public static bool GetBool(string key, bool defaultValue)
        {
            object v;
            if (_values.TryGetValue(key, out v))
            {
                if (v is bool) return (bool)v;
                if (v is string)
                {
                    string s = ((string)v).ToLowerInvariant();
                    return s == "true" || s == "1" || s == "yes";
                }
                if (v is double) return (double)v != 0;
                if (v is long) return (long)v != 0;
                if (v is int) return (int)v != 0;
            }
            return defaultValue;
        }

        /// <summary>Yerel kopya guncellendiginde tetiklenir.</summary>
        public static event Action OnConfigUpdated;

        /// <summary>Su an aktif tum config key'leri (debug icin).</summary>
        public static IReadOnlyDictionary<string, object> AllValues => _values;

        /// <summary>Sunucudan en az bir kez basariyla deger cekildi mi?</summary>
        public static bool HasFetched { get; private set; }

        /// <summary>Beklemeden hemen yeniden cek (orn. oyun on plana dondugunde).</summary>
        public static void Refresh()
        {
            if (_baslatildi) AltareConfigHost.HemenCek();
        }

        /// <summary>
        /// Opsiyonel anlik kanal (AltareFirebase) icin giris noktasi.
        /// Firestore dinleyicisinden gelen ham dokumani isler.
        /// </summary>
        public static void PushRealtimeConfig(Dictionary<string, object> ham)
        {
            if (ham == null) return;
            Uygula(ham, "realtime");
        }

        // ─── Ic isleyis ───

        private static bool _baslatildi;
        private static readonly Dictionary<string, object> _values =
            new Dictionary<string, object>();

        private static void Uygula(Dictionary<string, object> ham, string kaynak)
        {
            try
            {
                object tabanHam;
                ham.TryGetValue("values", out tabanHam);
                var taban = tabanHam as Dictionary<string, object>;

                object deneylerHam;
                ham.TryGetValue("experiments", out deneylerHam);

                // Deney degerleri taban degerlerin UZERINE yazilir; oyuncu
                // deney disindaysa taban degerler aynen gecerlidir.
                var nihai = AltareExperiments.Uygula(taban, deneylerHam);

                _values.Clear();
                foreach (var kv in nihai) _values[kv.Key] = kv.Value;
                HasFetched = true;

                Debug.Log("[AltareConfig] guncellendi (" + kaynak + "): " +
                          _values.Count + " key, " +
                          AltareExperiments.Assignments.Count + " aktif deney.");
                try { if (OnConfigUpdated != null) OnConfigUpdated(); }
                catch (Exception e)
                {
                    Debug.LogWarning("[AltareConfig] OnConfigUpdated dinleyicisi hata verdi: " + e.Message);
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning("[AltareConfig] config islenemedi: " + e.Message);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // YOKLAMA (polling) — MonoBehaviour host
        // ─────────────────────────────────────────────────────────────────────

        private class AltareConfigHost : MonoBehaviour
        {
            private static AltareConfigHost _host;
            private static bool _hemenCek;

            public static void Baslat()
            {
                if (_host != null) return;
                var go = new GameObject("[AltareConfig]");
                UnityEngine.Object.DontDestroyOnLoad(go);
                go.hideFlags = HideFlags.HideAndDontSave;
                _host = go.AddComponent<AltareConfigHost>();
                _host.StartCoroutine(_host.Dongu());
            }

            public static void HemenCek() { _hemenCek = true; }

            private IEnumerator Dongu()
            {
                float bekleme = IlkBekleme;

                // AltareAnalytics'in kimligi yuklemesini bekle: gameId olmadan
                // istek atilamaz, playerAnonId olmadan deney atamasi yapilamaz.
                while (string.IsNullOrEmpty(AltareAnalytics.GameId) ||
                       string.IsNullOrEmpty(AltareAnalytics.PlayerAnonId))
                {
                    yield return new WaitForSeconds(1f);
                }

                while (true)
                {
                    bool basarili = false;
                    yield return Cek(sonuc => basarili = sonuc);

                    if (basarili)
                    {
                        bekleme = IlkBekleme;
                        float gecen = 0f;
                        while (gecen < PollIntervalSeconds && !_hemenCek)
                        {
                            yield return new WaitForSeconds(1f);
                            gecen += 1f;
                        }
                        _hemenCek = false;
                    }
                    else
                    {
                        // Hata: son bilinen degerler KORUNUR, oyun etkilenmez.
                        yield return new WaitForSeconds(bekleme);
                        bekleme = Mathf.Min(bekleme * 2f, EnUzunBekleme);
                    }
                }
            }

            private IEnumerator Cek(Action<bool> bitti)
            {
                string url = AltareAnalytics.EndpointBase + "/getGameConfig?gameId=" +
                             UnityWebRequest.EscapeURL(AltareAnalytics.GameId);

                UnityWebRequest istek = null;
                try
                {
                    istek = UnityWebRequest.Get(url);
                    istek.timeout = ZamanAsimiSn;
                    string anahtar = AltareAnalytics.ApiKey;
                    if (!string.IsNullOrEmpty(anahtar))
                        istek.SetRequestHeader("X-Altare-Key", anahtar);
                }
                catch (Exception e)
                {
                    Debug.LogWarning("[AltareConfig] istek olusturulamadi: " + e.Message);
                    if (istek != null) istek.Dispose();
                    bitti(false);
                    yield break;
                }

                yield return istek.SendWebRequest();

                bool ok = false;
                try
                {
                    long kod = istek.responseCode;
                    bool agHatasi =
#if UNITY_2020_2_OR_NEWER
                        istek.result != UnityWebRequest.Result.Success;
#else
                        istek.isNetworkError || istek.isHttpError;
#endif
                    if (!agHatasi && kod >= 200 && kod < 300)
                    {
                        var ham = AltareJson.Parse(istek.downloadHandler.text)
                                  as Dictionary<string, object>;
                        if (ham != null) { Uygula(ham, "http"); ok = true; }
                        else Debug.LogWarning("[AltareConfig] yanit JSON nesnesi degil.");
                    }
                    else if (kod == 404)
                    {
                        // Panelde kayitli olmayan gameId — yeniden denemek
                        // faydasiz, ama oyunu da bloklamayalim.
                        Debug.LogWarning("[AltareConfig] gameId panelde bulunamadi: " +
                                         AltareAnalytics.GameId);
                    }
                    else if (kod == 401 || kod == 403)
                    {
                        Debug.LogWarning("[AltareConfig] API anahtari reddedildi — " +
                                         "Remote Config devre disi.");
                    }
                    else
                    {
                        Debug.Log("[AltareConfig] cekilemedi (kod " + kod + "), tekrar denenecek.");
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning("[AltareConfig] yanit islenemedi: " + e.Message);
                }
                finally
                {
                    istek.Dispose();
                }

                bitti(ok);
            }
        }

        // ═════════════════════════════════════════════════════════════════════
        // AltareJson — kucuk, bagimsiz JSON okuyucu
        //
        // NEDEN ELDE YAZILDI: Unity'nin JsonUtility'si Dictionary<string,object>
        // ve heterojen tipleri okuyamaz; Newtonsoft ise oyuna zorunlu bir paket
        // ekler. Altare'nin sozu "iki dosya ekle, calissin" — o yuzden
        // bagimlilik yok.
        //
        // Uretilen tipler: Dictionary<string,object> · List<object> · string ·
        //                  double · bool · null
        //
        // Bu ayristiricinin ALGORITMASI JavaScript'e birebir cevrilip
        // JSON.parse'a karsi test edilir:  node tools/test-json-parser.js
        // ═════════════════════════════════════════════════════════════════════

        internal static class AltareJson
        {
            public static object Parse(string s)
            {
                if (string.IsNullOrEmpty(s)) return null;
                int i = 0;
                object sonuc = Deger(s, ref i);
                BosluGec(s, ref i);
                if (i < s.Length) throw new FormatException("JSON sonrasi fazla karakter: " + i);
                return sonuc;
            }

            private static void BosluGec(string s, ref int i)
            {
                while (i < s.Length)
                {
                    char c = s[i];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
                    else break;
                }
            }

            private static object Deger(string s, ref int i)
            {
                BosluGec(s, ref i);
                if (i >= s.Length) throw new FormatException("beklenmedik son");
                char c = s[i];
                if (c == '{') return Nesne(s, ref i);
                if (c == '[') return Dizi(s, ref i);
                if (c == '"') return Metin(s, ref i);
                if (Esles(s, ref i, "true")) return true;
                if (Esles(s, ref i, "false")) return false;
                if (Esles(s, ref i, "null")) return null;
                return Sayi(s, ref i);
            }

            private static bool Esles(string s, ref int i, string kelime)
            {
                if (i + kelime.Length > s.Length) return false;
                for (int k = 0; k < kelime.Length; k++)
                    if (s[i + k] != kelime[k]) return false;
                i += kelime.Length;
                return true;
            }

            private static Dictionary<string, object> Nesne(string s, ref int i)
            {
                var d = new Dictionary<string, object>();
                i++;                                   // '{'
                BosluGec(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (true)
                {
                    BosluGec(s, ref i);
                    if (i >= s.Length || s[i] != '"') throw new FormatException("anahtar bekleniyordu");
                    string anahtar = Metin(s, ref i);
                    BosluGec(s, ref i);
                    if (i >= s.Length || s[i] != ':') throw new FormatException("':' bekleniyordu");
                    i++;
                    d[anahtar] = Deger(s, ref i);
                    BosluGec(s, ref i);
                    if (i >= s.Length) throw new FormatException("nesne kapanmadi");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return d; }
                    throw new FormatException("',' veya '}' bekleniyordu: " + i);
                }
            }

            private static List<object> Dizi(string s, ref int i)
            {
                var l = new List<object>();
                i++;                                   // '['
                BosluGec(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(Deger(s, ref i));
                    BosluGec(s, ref i);
                    if (i >= s.Length) throw new FormatException("dizi kapanmadi");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return l; }
                    throw new FormatException("',' veya ']' bekleniyordu: " + i);
                }
            }

            private static string Metin(string s, ref int i)
            {
                i++;                                   // acilis '"'
                var sb = new StringBuilder();
                while (i < s.Length)
                {
                    char c = s[i++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (i >= s.Length) break;
                    char k = s[i++];
                    switch (k)
                    {
                        case '"':  sb.Append('"');  break;
                        case '\\': sb.Append('\\'); break;
                        case '/':  sb.Append('/');  break;
                        case 'b':  sb.Append('\b'); break;
                        case 'f':  sb.Append('\f'); break;
                        case 'n':  sb.Append('\n'); break;
                        case 'r':  sb.Append('\r'); break;
                        case 't':  sb.Append('\t'); break;
                        case 'u':
                        {
                            if (i + 4 > s.Length) throw new FormatException("eksik \\u");
                            int kod = 0;
                            for (int k2 = 0; k2 < 4; k2++)
                            {
                                kod = kod * 16 + OnaltilikBasamak(s[i + k2]);
                            }
                            i += 4;
                            sb.Append((char)kod);
                            break;
                        }
                        default: throw new FormatException("bilinmeyen kacis: \\" + k);
                    }
                }
                throw new FormatException("metin kapanmadi");
            }

            private static int OnaltilikBasamak(char c)
            {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                throw new FormatException("gecersiz onaltilik basamak: " + c);
            }

            private static object Sayi(string s, ref int i)
            {
                int bas = i;
                if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
                while (i < s.Length)
                {
                    char c = s[i];
                    if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' ||
                        c == '+' || c == '-') i++;
                    else break;
                }
                if (i == bas) throw new FormatException("sayi bekleniyordu: " + bas);
                string parca = s.Substring(bas, i - bas);
                double d;
                if (!double.TryParse(parca, System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out d))
                {
                    throw new FormatException("gecersiz sayi: " + parca);
                }
                return d;
            }
        }
    }
}
