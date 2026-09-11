// =============================================================================
// AltareExperiments.cs — v1.0.0
// -----------------------------------------------------------------------------
// Altare A/B deney istemcisi.
//
// NE ISE YARAR
// Auto-Heal bir config degisikligi onerdiginde, o degisikligi TUM oyunculara
// birden uygulamak yerine kucuk bir dilime (orn. %10) uygulayip geri kalanla
// karsilastirabilirsiniz. "Degisiklik ise yaradi mi?" sorusunun olculebilir
// cevabi budur.
//
// NASIL CALISIR
// Oyuncunun hangi gruba dustugu SUNUCUYA SORULMAZ — (deneyId, oyuncuId)
// ikilisinden deterministik olarak hesaplanir. Bu sayede:
//   • ag gecikmesi yok, deney anlik baslar
//   • oyuncu her acilista AYNI grupta kalir (cihaz degistirse bile, anon id ayni ise)
//   • sunucu ayni hesabi tekrar yapip metrigi dogru varyanta yazabilir
//
// ⚠ KRITIK — PARITE
// Bu dosyadaki Fnv1a32 / AssignVariant, sunucudaki
// firebase/functions/experiments.js ile BIT BIT AYNI sonucu uretmek
// ZORUNDADIR. Tek bir bit ayrisirsa deney sessizce anlamsizlasir: hata mesaji
// cikmaz, sadece her deney "fark yok" der.
// Birini degistirirsen digerini de degistir ve su iki testi calistir:
//     node tools/test-experiments.js
//     python3 tools/test-hash-parity.py
// Asagidaki SelfTest() ayni referans degerleri Unity icinde dogrular.
//
// KULLANIM
// Ek bir sey yapmaniza gerek YOK — AltareConfig.Initialize() bunu otomatik
// devreye alir ve GetInt/GetFloat/... cagrilari zaten oyuncunun varyantina
// ait degerleri dondurur.
//
// Config degeri disinda bir sey degistirmek isterseniz (orn. farkli bir UI
// akisi) varyanti dogrudan sorabilirsiniz:
//
//     if (AltareExperiments.GetVariant("exp_abc123") == "treatment") { ... }
//
// =============================================================================

using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Altare.Analytics
{
    public static class AltareExperiments
    {
        // ─────────────────────────────────────────────────────────────────────
        // DETERMINISTIK KOVA ATAMASI — sunucu ikizi: experiments.js
        // ─────────────────────────────────────────────────────────────────────

        private const uint FnvOffset = 2166136261u;
        private const uint FnvPrime = 16777619u;
        /// <summary>Kova cozunurlugu: %0.01 hassasiyet.</summary>
        public const int BucketSpace = 10000;

        /// <summary>
        /// FNV-1a 32-bit, UTF-8 baytlari uzerinden.
        /// C#'ta `uint` aritmetigi dogal olarak mod 2^32'dir (unchecked baglam);
        /// JS tarafinda ayni davranis Math.imul + >>> 0 ile saglanir.
        /// </summary>
        public static uint Fnv1a32(string s)
        {
            if (s == null) s = string.Empty;
            byte[] baytlar = Encoding.UTF8.GetBytes(s);
            uint h = FnvOffset;
            for (int i = 0; i < baytlar.Length; i++)
            {
                h ^= baytlar[i];
                h *= FnvPrime;
            }
            return h;
        }

        /// <summary>Deneye GIRIS kovasi (0..9999).</summary>
        public static int ExposureBucket(string experimentId, string playerAnonId)
        {
            return (int)(Fnv1a32(experimentId + ":" + playerAnonId) % (uint)BucketSpace);
        }

        /// <summary>
        /// Varyant kovasi (0..9999) — giris kovasindan AYRI hash.
        /// Neden ayri: ayni hash kullanilsaydi exposurePct buyutuldugunde
        /// mevcut oyuncular varyant degistirirdi ("%10 ile basla, %50'ye cik"
        /// senaryosu bozulurdu).
        /// </summary>
        public static int VariantBucket(string experimentId, string playerAnonId)
        {
            return (int)(Fnv1a32(experimentId + "#" + playerAnonId) % (uint)BucketSpace);
        }

        /// <summary>
        /// Oyuncunun varyantini hesaplar. Oyuncu deney disindaysa null doner.
        /// </summary>
        public static string AssignVariant(Deney deney, string playerAnonId)
        {
            if (deney == null || string.IsNullOrEmpty(deney.Id)) return null;
            if (string.IsNullOrEmpty(playerAnonId)) return null;
            if (deney.Varyantlar == null || deney.Varyantlar.Count < 2) return null;
            if (deney.ExposurePct <= 0.0) return null;

            double pct = Math.Min(100.0, deney.ExposurePct);
            int girisEsigi = (int)Math.Round(pct * (BucketSpace / 100.0),
                                             MidpointRounding.AwayFromZero);
            if (ExposureBucket(deney.Id, playerAnonId) >= girisEsigi) return null;

            int ic = VariantBucket(deney.Id, playerAnonId);
            int kumulatif = 0;
            for (int i = 0; i < deney.Varyantlar.Count; i++)
            {
                kumulatif += (int)Math.Round(
                    deney.Varyantlar[i].Allocation * (BucketSpace / 100.0),
                    MidpointRounding.AwayFromZero);
                if (ic < kumulatif) return deney.Varyantlar[i].Key;
            }
            // Yuvarlama artigi — tahsisler 100'e toplanmali (sunucu bunu
            // zorunlu kiliyor); bu sadece savunma amacli.
            return deney.Varyantlar[deney.Varyantlar.Count - 1].Key;
        }

        // ─────────────────────────────────────────────────────────────────────
        // VERI MODELI
        // ─────────────────────────────────────────────────────────────────────

        public class Varyant
        {
            public string Key;
            public double Allocation;
            public Dictionary<string, object> Values;
        }

        public class Deney
        {
            public string Id;
            public double ExposurePct;
            public List<Varyant> Varyantlar;
        }

        // ─────────────────────────────────────────────────────────────────────
        // PUBLIC API
        // ─────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Bu oyuncunun bir deneydeki varyanti. Deney yoksa ya da oyuncu
        /// deney disindaysa null.
        /// </summary>
        public static string GetVariant(string experimentId)
        {
            if (string.IsNullOrEmpty(experimentId)) return null;
            string v;
            return _atamalar.TryGetValue(experimentId, out v) ? v : null;
        }

        /// <summary>Su an aktif olan tum atamalar (deneyId → varyant). Debug icin.</summary>
        public static IReadOnlyDictionary<string, string> Assignments => _atamalar;

        /// <summary>Bir varyanta atandiginda tetiklenir (deneyId, varyant).</summary>
        public static event Action<string, string> OnAssigned;

        // ─────────────────────────────────────────────────────────────────────
        // AltareConfig TARAFINDAN CAGRILIR
        // ─────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Config dokumanindaki deney tanimlarini isler, oyuncuyu atar ve
        /// taban degerlerin uzerine varyant degerlerini yazar.
        /// </summary>
        /// <param name="tabanDegerler">config/active icindeki "values".</param>
        /// <param name="hamDeneyler">config/active icindeki "experiments" dizisi.</param>
        /// <returns>Oyuna sunulacak nihai degerler.</returns>
        public static Dictionary<string, object> Uygula(
            Dictionary<string, object> tabanDegerler, object hamDeneyler)
        {
            var sonuc = new Dictionary<string, object>();
            if (tabanDegerler != null)
                foreach (var kv in tabanDegerler) sonuc[kv.Key] = kv.Value;

            List<Deney> deneyler = Ayristir(hamDeneyler);
            if (deneyler.Count == 0)
            {
                // Calisan deney kalmadi — eski atamalari temizle ki bir sonraki
                // deney yeniden maruz kalma olayi uretebilsin.
                _atamalar.Clear();
                return sonuc;
            }

            string oyuncu = AltareAnalytics.PlayerAnonId;
            if (string.IsNullOrEmpty(oyuncu))
            {
                // Analitik henuz hazir degil: deney UYGULANMAZ.
                // Sebep: atama yapip maruz kalma olayini gonderemezsek sunucu
                // o oyuncuyu deneye dahil edemez, ama oyuncu deney degerlerini
                // gormus olur — olculemeyen bir degisiklik en kotusudur.
                return sonuc;
            }

            var canli = new HashSet<string>();
            foreach (var d in deneyler)
            {
                canli.Add(d.Id);
                string varyant = AssignVariant(d, oyuncu);
                if (varyant == null) continue;

                _atamalar[d.Id] = varyant;

                var v = d.Varyantlar.Find(x => x.Key == varyant);
                if (v != null && v.Values != null)
                    foreach (var kv in v.Values) sonuc[kv.Key] = kv.Value;

                MaruzKalmaBildir(d.Id, varyant);
            }

            // Artik calismayan deneylerin atamalarini dus.
            var silinecek = new List<string>();
            foreach (var k in _atamalar.Keys) if (!canli.Contains(k)) silinecek.Add(k);
            foreach (var k in silinecek) { _atamalar.Remove(k); _bildirilen.Remove(k); }

            return sonuc;
        }

        // ─────────────────────────────────────────────────────────────────────
        // MARUZ KALMA (exposure) OLAYI
        //
        // Sunucu bir oyuncuyu deneye ANCAK bu olayi gorurse dahil eder.
        // Sebep: sunucu atamayi kendisi hesaplayabilir, ama oyuncunun deney
        // degerlerini GERCEKTEN gordugunu bilemez — eski bir istemci Remote
        // Config'i hic okumuyor olabilir. Onlari deneye katmak etkiyi
        // sulandirip her deneyi "fark yok" gosterir.
        // ─────────────────────────────────────────────────────────────────────

        private static void MaruzKalmaBildir(string deneyId, string varyant)
        {
            // Oturum basina deney basina TEK kere. Config dokumani her
            // guncellendiginde snapshot yeniden tetiklenir; her seferinde olay
            // gondermek kuyrugu sisirir ve maliyet uretir.
            string anahtar = deneyId + "|" + varyant;
            string mevcut;
            if (_bildirilen.TryGetValue(deneyId, out mevcut) && mevcut == anahtar) return;
            _bildirilen[deneyId] = anahtar;

            try
            {
                AltareAnalytics.LogEvent("altare_experiment_exposure",
                    new Dictionary<string, object>
                    {
                        { "experiment_id", deneyId },
                        { "variant", varyant },
                    });
                if (OnAssigned != null) OnAssigned(deneyId, varyant);
                Debug.Log("[AltareExperiments] " + deneyId + " → " + varyant);
            }
            catch (Exception e)
            {
                Debug.LogWarning("[AltareExperiments] maruz kalma olayi gonderilemedi: " + e.Message);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // FIRESTORE AYRISTIRMA — savunmaci
        // ─────────────────────────────────────────────────────────────────────

        private static List<Deney> Ayristir(object ham)
        {
            var cikti = new List<Deney>();
            var liste = ham as System.Collections.IEnumerable;
            if (liste == null || ham is string) return cikti;

            foreach (var oge in liste)
            {
                var m = oge as Dictionary<string, object>;
                if (m == null) continue;

                var d = new Deney
                {
                    Id = Metin(m, "id"),
                    ExposurePct = Sayi(m, "exposurePct", 0.0),
                    Varyantlar = new List<Varyant>(),
                };
                if (string.IsNullOrEmpty(d.Id)) continue;

                object vHam;
                if (!m.TryGetValue("variants", out vHam)) continue;
                var vListe = vHam as System.Collections.IEnumerable;
                if (vListe == null) continue;

                foreach (var vOge in vListe)
                {
                    var vm = vOge as Dictionary<string, object>;
                    if (vm == null) continue;
                    string key = Metin(vm, "key");
                    if (string.IsNullOrEmpty(key)) continue;

                    object degerHam;
                    Dictionary<string, object> degerler = null;
                    if (vm.TryGetValue("values", out degerHam))
                        degerler = degerHam as Dictionary<string, object>;

                    d.Varyantlar.Add(new Varyant
                    {
                        Key = key,
                        Allocation = Sayi(vm, "allocation", 0.0),
                        Values = degerler,
                    });
                }

                if (d.Varyantlar.Count >= 2) cikti.Add(d);
            }
            return cikti;
        }

        private static string Metin(Dictionary<string, object> m, string k)
        {
            object v;
            return m.TryGetValue(k, out v) && v != null ? v.ToString() : null;
        }

        private static double Sayi(Dictionary<string, object> m, string k, double varsayilan)
        {
            object v;
            if (!m.TryGetValue(k, out v) || v == null) return varsayilan;
            if (v is double) return (double)v;
            if (v is float) return (float)v;
            if (v is long) return (long)v;
            if (v is int) return (int)v;
            double p;
            if (v is string && double.TryParse((string)v,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out p)) return p;
            return varsayilan;
        }

        private static readonly Dictionary<string, string> _atamalar =
            new Dictionary<string, string>();
        private static readonly Dictionary<string, string> _bildirilen =
            new Dictionary<string, string>();

        // ─────────────────────────────────────────────────────────────────────
        // SELF-TEST — sunucu paritesini Unity icinde dogrular.
        //
        // Referans degerler tools/test-hash-parity.py ciktisidir; ayni degerler
        // firebase/functions/experiments.js tarafindan da uretilir.
        // Bir platformda (IL2CPP, farkli .NET surumu, Burst) sapma olursa
        // burada yakalanir.
        //
        //     Debug.Log(AltareExperiments.SelfTest());
        // ─────────────────────────────────────────────────────────────────────

        public static string SelfTest()
        {
            var sb = new StringBuilder();
            int gecen = 0, kalan = 0;

            Action<string, bool> kontrol = (ad, sonuc) =>
            {
                if (sonuc) gecen++;
                else { kalan++; sb.Append("  ✗ ").Append(ad).Append('\n'); }
            };

            kontrol("fnv('') = 2166136261", Fnv1a32("") == 2166136261u);
            kontrol("fnv('a') = 3826002220", Fnv1a32("a") == 3826002220u);
            kontrol("fnv('foobar') = 3214735720", Fnv1a32("foobar") == 3214735720u);
            kontrol("fnv('altare-studio.chophero') = 457346627",
                    Fnv1a32("altare-studio.chophero") == 457346627u);
            kontrol("fnv('çğü') = 3967266485 (UTF-8)", Fnv1a32("çğü") == 3967266485u);

            var ornek = new Deney
            {
                Id = "exp_abc123",
                ExposurePct = 100,
                Varyantlar = new List<Varyant>
                {
                    new Varyant { Key = "control",   Allocation = 50 },
                    new Varyant { Key = "treatment", Allocation = 50 },
                },
            };
            kontrol("giris kovasi(sim-0) = 1737", ExposureBucket("exp_abc123", "sim-0") == 1737);
            kontrol("varyant kovasi(sim-0) = 7428", VariantBucket("exp_abc123", "sim-0") == 7428);
            kontrol("atama(sim-0) = treatment", AssignVariant(ornek, "sim-0") == "treatment");
            kontrol("atama(sim-1) = treatment", AssignVariant(ornek, "sim-1") == "treatment");
            kontrol("atama(sim-2) = control", AssignVariant(ornek, "sim-2") == "control");
            kontrol("atama(player-0001) = control", AssignVariant(ornek, "player-0001") == "control");
            kontrol("bos oyuncu kimligi atanmaz", AssignVariant(ornek, "") == null);
            kontrol("exposurePct=0 → atama yok",
                    AssignVariant(new Deney { Id = "exp_abc123", ExposurePct = 0,
                        Varyantlar = ornek.Varyantlar }, "sim-0") == null);

            string bas = kalan == 0
                ? "[AltareExperiments] ✅ sunucu paritesi tam — " + gecen + " kontrol\n"
                : "[AltareExperiments] ❌ " + kalan + " UYUSMAZLIK / " + (gecen + kalan) +
                  " kontrol — DENEYLER GUVENILIR DEGIL\n";
            return bas + sb.ToString();
        }
    }
}
