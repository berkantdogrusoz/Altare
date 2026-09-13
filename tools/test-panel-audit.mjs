/**
 * Altare — panel denetim kaydı render testi
 *
 *     node tools/test-panel-audit.mjs
 *
 * NEDEN VAR:
 * Denetim kaydı, kurumsal bir müşteriye "sistemi denetleyebilirsin" demenin
 * görünen yüzü. Buradaki bir çizim hatası iki yönlü zarar verir:
 *   • Reddedilen bir girişim normal bir satır gibi görünürse denetçi onu
 *     kaçırır — kaydın varlık sebebi tam olarak o satırdır
 *   • Çalışma zamanı hatası listeyi boş gösterir ve "hiçbir şey olmamış"
 *     izlenimi verir, ki bu boş bir kayıttan daha kötüdür
 *
 * panel.html tek dosya olduğu için render fonksiyonu dosyadan çıkarılıp
 * minimal DOM stub'larıyla çalıştırılır. Çıkarma başarısız olursa test
 * HATA VERİR.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(join(KOK, "panel.html"), "utf8");

function fonksiyonuAl(ad) {
  const b = panel.indexOf("function " + ad + "(");
  if (b < 0) {
    throw new Error(`panel.html icinde '${ad}' bulunamadi — ` +
      "fonksiyon yeniden adlandirildiysa bu testi guncelle.");
  }
  const e = panel.indexOf("\n        }", b);
  if (e < 0) throw new Error(`'${ad}' kapanisi bulunamadi (girinti degisti mi?)`);
  return panel.slice(b, e + "\n        }".length);
}

const kaynak = fonksiyonuAl("renderAuditLog") + `
const _kok = { innerHTML: "", textContent: "", querySelectorAll: () => [] };
const _bos = { innerHTML: "", textContent: "", querySelectorAll: () => [] };
function $(id) { return id === "audit-list" ? _kok : _bos; }
function escapeHtml(x) {
  return String(x == null ? "" : x).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function getLanguage() { return "tr"; }
function t(k) { return "[" + k + "]"; }
export { renderAuditLog, _kok };
`;

const { renderAuditLog, _kok } = await import(
  "data:text/javascript;base64," + Buffer.from(kaynak, "utf8").toString("base64")
);

let gecen = 0, kalan = 0;
const hatalar = [];
const ok = (ad, k, d) => {
  if (k) gecen++; else { kalan++; hatalar.push(ad + (d ? "  →  " + d : "")); }
};
const html = () => _kok.innerHTML;
const baslik = (s) => console.log("\n── " + s + " " + "─".repeat(Math.max(0, 50 - s.length)));

const AT = "2026-09-13T08:30:00.000Z";

baslik("1. Boş durumlar");
renderAuditLog([]);
ok("boş liste çökmez", html().includes("audit.noEntries"));
renderAuditLog(null);
ok("null liste çökmez", html().includes("audit.noEntries"));

baslik("2. Normal kayıt");
renderAuditLog([{
  id: "a1", action: "auto_heal.apply", result: "success",
  actorUid: "u123", actorEmail: "dev@studio.com", actorIsAdmin: false,
  gameId: "royal-dreams", targetId: "presc_abc", at: AT,
  details: { changeCount: 2, keys: ["ad_frequency_interstitial", "fps_target"] },
}]);
ok("eylem adı yazılır", html().includes("auto_heal.apply"));
ok("aktör e-postası yazılır", html().includes("dev@studio.com"));
ok("hedef yazılır", html().includes("presc_abc"));
ok("ayrıntılar yazılır", html().includes("changeCount=2"));
ok("dizi ayrıntı birleştirilir", html().includes("ad_frequency_interstitial|fps_target"));
ok("normal kayıt 'denied' işaretli DEĞİL", !html().includes("audit-badge denied"));
ok("admin rozeti yok (admin değil)", !html().includes("audit-badge admin"));

baslik("3. ⚠ Reddedilen girişim — kaydın varlık sebebi");
renderAuditLog([{
  id: "a2", action: "auto_heal.apply", result: "denied",
  reason: "yuksek_risk_deneye_yonlendirildi",
  actorUid: "u999", actorEmail: "intern@studio.com", actorIsAdmin: false,
  gameId: "royal-dreams", targetId: "presc_xyz", at: AT, details: { riskLevel: "high" },
}]);
ok("satır 'denied' sınıfıyla işaretli", html().includes('class="audit-row denied"'));
ok("reddedildi rozeti var", html().includes("audit-badge denied"));
ok("gerekçe gösterilir", html().includes("yuksek_risk_deneye_yonlendirildi"));
ok("gerekçe kendi stilinde", html().includes("audit-reason"));

baslik("4. Sistem aktörü — otomatik guardrail durdurması");
renderAuditLog([{
  id: "a3", action: "experiment.auto_stop_guardrail", result: "success",
  reason: "guardrail_breach",
  actorUid: "system", actorEmail: null, actorIsAdmin: false,
  gameId: "royal-dreams", targetId: "exp_1", at: AT,
  details: { breaches: ["crash_free_rate"], exposurePct: 10 },
}]);
ok("sistem satırı işaretli", html().includes("audit-row system"));
ok("sistem aktörü çevrilmiş etiketle", html().includes("audit.systemActor"));
ok("e-posta yoksa uid sızmaz", !html().includes(">system<"));

baslik("5. Admin rozeti");
renderAuditLog([{
  id: "a4", action: "admin.role_set", result: "success",
  actorUid: "u1", actorEmail: "boss@studio.com", actorIsAdmin: true,
  targetId: "u2", at: AT, details: { admin: true },
}]);
ok("admin rozeti gösterilir", html().includes("audit-badge admin"));

baslik("6. XSS — kayıt içeriği kullanıcıdan gelebilir");
renderAuditLog([{
  id: "a5", action: '<img src=x onerror=alert(1)>', result: "success",
  actorUid: "u1", actorEmail: '<script>alert(2)</script>', actorIsAdmin: false,
  targetId: '"><b>kotu</b>', at: AT,
  details: { note: "<svg onload=alert(3)>" },
}]);
ok("eylem kaçışlanır", !html().includes("<img src=x"));
ok("e-posta kaçışlanır", !html().includes("<script>alert(2)"));
ok("hedef kaçışlanır", !html().includes('"><b>kotu</b>'));
ok("ayrıntı kaçışlanır", !html().includes("<svg onload"));
ok("kaçışlanmış hali görünür", html().includes("&lt;img src=x"));

baslik("7. Bozuk / eksik veri — CANLIDA OLUR");
for (const [ad, kayit] of [
  ["alansız kayıt", { id: "x" }],
  ["details null", { id: "y", action: "a.b", details: null, at: AT }],
  ["at null", { id: "z", action: "a.b", at: null }],
  ["at geçersiz metin", { id: "w", action: "a.b", at: "bozuk-tarih" }],
  ["aktör yok", { id: "v", action: "a.b", at: AT, actorUid: null, actorEmail: null }],
  ["details boş nesne", { id: "u", action: "a.b", at: AT, details: {} }],
]) {
  try { renderAuditLog([kayit]); ok("çökmedi: " + ad, true); }
  catch (e) { ok("çökmedi: " + ad, false, e.message); }
}

baslik("8. Çoklu kayıt");
renderAuditLog([
  { id: "1", action: "game.create", result: "success", actorUid: "u1", at: AT, details: {} },
  { id: "2", action: "funnel.create", result: "success", actorUid: "u1", at: AT, details: {} },
  { id: "3", action: "game.delete", result: "denied", reason: "yetki yok", actorUid: "u2", at: AT, details: {} },
]);
ok("üç satır da çizilir", (html().match(/class="audit-row/g) || []).length === 3);
ok("yalnızca reddedilen 'denied' sınıfında",
   (html().match(/audit-row denied/g) || []).length === 1);

console.log("\n" + "═".repeat(60));
if (kalan === 0) {
  console.log(`✅  TUM TESTLER GECTI — ${gecen} kontrol`);
} else {
  console.log(`❌  ${kalan} BASARISIZ / ${gecen + kalan} kontrol\n`);
  for (const h of hatalar) console.log("   ✗ " + h);
}
console.log("═".repeat(60));
process.exit(kalan === 0 ? 0 : 1);
