// =============================================================================
// i18n.js — Altare Panel ceviri sistemi (TR / EN)
// -----------------------------------------------------------------------------
// Kullanim:
//   - HTML elementlerine data-i18n="key" ekle (textContent ceviri yapar)
//   - data-i18n-placeholder="key" (input placeholder)
//   - data-i18n-title="key" (title attribute)
//   - JS icinde: import { t } from '/js/i18n.js';  t('overview.title')
//   - Dil degistirmek: setLanguage('en')
//   - Mevcut dil: getLanguage()
// =============================================================================

const STORAGE_KEY = 'altare.lang';
const DEFAULT_LANG = 'tr';
const SUPPORTED = ['tr', 'en'];

const I18N = {
    tr: {
        // Topbar
        'topbar.tag': 'AI Panel · v1.0 · Canlı',
        'topbar.live': 'Canlı',
        'topbar.logout': 'Çıkış',

        // Sidebar sections
        'sidebar.studio': 'Stüdyo',
        'sidebar.gameIntel': 'Oyun Zekası',
        'sidebar.marketIntel': 'Pazar Zekası',
        'sidebar.ai': 'AI',

        // Sidebar tabs
        'tab.my-games': 'Oyunlarım',
        'tab.customers': 'Müşteri Yönetimi',
        'tab.integration': 'Entegrasyon Rehberi',
        'tab.overview': 'Genel Bakış',
        'tab.alerts': 'Sentinel Uyarıları',
        'tab.events': 'Canlı Event Stream',
        'tab.levels': 'Level Intelligence',
        'tab.performance': 'Crash & Performance',
        'tab.market': 'Pazar Analizi',
        'tab.benchmark': 'Benchmark',
        'tab.reviews': 'Yorum & Sentiment',
        'tab.ai-report': 'AI Raporu',
        'tab.roadmap': 'Roadmap Önerileri',

        // ── Sentinel Alerts ──
        'alerts.banner': '<strong>Altare Sentinel</strong> oyununu 7/24 izler. Crash patlaması, DAU düşüşü, performans bozulması veya whale tespiti gibi anomalilerde otomatik uyarı atar — panel açmana gerek yok.',
        'alerts.recent': 'Son Uyarılar',
        'alerts.empty': 'Henüz uyarı yok. Sentinel her 30 dakikada bir oyununu kontrol ediyor — anomali tespit ederse burada görürsün.',
        'alerts.markRead': 'Okundu işaretle',
        'alerts.unread': 'okunmamış',
        'alerts.severity.critical': 'KRİTİK',
        'alerts.severity.high': 'YÜKSEK',
        'alerts.severity.medium': 'ORTA',
        'alerts.severity.info': 'BİLGİ',

        // ── Benchmark ──
        'benchmark.banner': 'Senin oyununun metriklerini <strong>kategori medyanı</strong> ve <strong>top %10</strong> ile karşılaştırır. Hangi alanda geride kaldığını ve hangi alanda öndesin görürsün.',
        'benchmark.title': 'Kategori Karşılaştırması',
        'benchmark.run': '⚡ Benchmark Çalıştır',
        'benchmark.running': 'Benchmark çalışıyor...',
        'benchmark.empty': 'Önce "Pazar Analizi" sekmesinden ilgili kategori için rakipleri çek, sonra burada "Benchmark Çalıştır" bas.',
        'benchmark.you': 'Sen',
        'benchmark.median': 'Kategori medyanı',
        'benchmark.top10': 'Top %10',
        'benchmark.gap': 'Fark',

        // ── Copilot ──
        'copilot.banner': '<strong>AI Copilot</strong> oyunun verileriyle sohbet etmeni sağlar. "Retention neden düştü?", "Level 18\'i nasıl optimize ederim?", "Hangi cihazda en çok crash var?" gibi sorular sor.',
        'copilot.title': 'AI Copilot',
        'copilot.online': 'Çevrimiçi · Claude Sonnet 4.5',
        'copilot.greeting': 'Merhaba! 👋 Oyununun verileriyle ilgili bir şey sor. Event\'leri, level istatistiklerini ve son AI raporunu görebiliyorum.',
        'copilot.placeholder': 'Sorunu yaz...',
        'copilot.send': 'Gönder',
        'copilot.sending': 'Düşünüyor...',
        'copilot.q1': 'Retention neden düşüyor?',
        'copilot.q2': 'En problemli level hangisi?',
        'copilot.q3': 'Hangi cihazda crash var?',
        'copilot.q4': 'Reklam stratejimi nasıl iyileştiririm?',
        'copilot.error': 'Hata: cevap alınamadı.',

        // Page meta
        'page.last24h': 'Son 24 saat',

        // KPI labels
        'kpi.activeSession': 'Aktif Oturum',
        'kpi.events24h': '24s Event',
        'kpi.avgSession': 'Ortalama Oturum',
        'kpi.failRate': 'Fail Oranı',
        'kpi.adWatches': 'Reklam İzleme (24h)',
        'kpi.iapRevenue': 'IAP Geliri (24h)',
        'kpi.fpsWarnings': 'FPS Uyarısı',
        'kpi.crashes': 'Crash (24h)',
        'kpi.realtimeActive': 'Anlık Aktif',
        'kpi.dauToday': 'DAU (Bugün)',
        'kpi.wau7d': 'WAU (7 Gün)',
        'kpi.mau28d': 'MAU (28 Gün)',
        'kpi.sessionsToday': 'Oturum (Bugün)',
        'kpi.avgSessionDur': 'Ort. Oturum Süresi',
        'kpi.newUsers': 'Yeni Kullanıcı',
        'kpi.revenue': 'Gelir',

        // Sections
        'section.firebaseAnalytics': 'Firebase Analytics · Canlı Veriler',
        'section.aiSuggestedAction': 'Önerilen Aksiyon · AI Tespiti',
        'section.liveEventStream': 'Canlı Event Stream',
        'section.topProblemLevels': 'En Çok Fail Olan Level\'lar · Top 5',
        'section.levelDistribution': 'Level Aralık Dağılımı',
        'section.streamingLabel': 'Akışta',

        // Empty / placeholder
        'empty.noAIYet': 'Henüz AI analizi yapılmadı.',
        'empty.aiReportHint': 'sekmesinden ilk raporu üretebilirsin.',
        'empty.topLevels': 'Veri toplandığında en çok fail olan 5 level burada listelenecek.',
        'empty.levelFunnel': 'Level event\'leri toplandığında aralık bazlı tamamlama oranı burada görünecek.',
        'empty.noGames': 'Henüz oyun eklemedin.',
        'empty.loading': 'Yükleniyor...',

        // Top countries (GA4)
        'ga4.topCountries': 'Top Ülkeler (7 gün)',
        'ga4.error': 'Firebase Analytics bağlantısı kurulamadı.',
        'ga4.errorHint': 'GCP Console → APIs & Services → "Google Analytics Data API" etkinleştirilmiş olmalı.',

        // Concept generator
        'concept.btnGenerate': '⚡ Konsept Üret',
        'concept.generating': 'Üretiliyor...',
        'concept.title': 'Sıradaki Proje Önerileri · AI Market Strategist',
        'concept.banner': 'Gerçek Play Store rakip + yorum verisinden AI yeni oyun konseptleri üretir. Önce <strong>Pazar Analizi</strong> sekmesinden ilgili kategori için rakipleri çek, sonra burada <strong>"Konsept Üret"</strong> bas.',

        // My games
        'mygames.newGame': '+ Yeni Oyun Ekle',
        'mygames.colName': 'Oyun Adı',
        'mygames.colGameId': 'Game ID',
        'mygames.colType': 'Tür',
        'mygames.colPlatform': 'Platform',
        'mygames.colStatus': 'Durum',
        'mygames.actionSelect': 'Seç',
        'mygames.actionDownload': 'SDK İndir',
        'mygames.actionInfo': 'Bilgiler',
        'mygames.actionDelete': 'Sil',

        // Generic
        'btn.cancel': 'İptal',
        'btn.close': 'Kapat',
        'btn.ok': 'Tamam',
        'btn.save': 'Kaydet',

        // Language
        'lang.tr': 'Türkçe',
        'lang.en': 'English',
        'lang.switchTo': 'Dili değiştir',

        // ── Selector ──
        'selector.noGames': 'Henüz oyun yok — Oyunlarım > + Yeni Oyun Ekle',

        // ── My Games ──
        'mygames.banner': 'Bu sekmede kendi oyunlarını görüyorsun. <strong>"Yeni Oyun Ekle"</strong> ile bir Unity projesi için tracking başlatabilirsin — sistem otomatik <code>gameId</code> üretir, SDK\'yı senin için hazırlar.',
        'mygames.title': 'Oyunlarım',

        // ── Customer Management (admin) ──
        'customers.banner': '<strong>Admin paneli</strong> · B2B sözleşme imzalanan müşterileri buradan oluşturursun. Sistem otomatik olarak Firebase Auth user + developers profili oluşturur, password reset linki üretir.',
        'customers.title': 'Müşteri Ekle',
        'customers.email': 'Email',
        'customers.studio': 'Stüdyo adı',
        'customers.tier.indie': 'Indie ($0)',
        'customers.tier.studio': 'Studio ($49/ay)',
        'customers.tier.enterprise': 'Enterprise (özel)',
        'customers.btnCreate': 'Müşteri Oluştur',

        // ── Integration Guide ──
        'integ.banner': 'Her oyunda kullanılabilen <strong>drop-in Unity SDK</strong>. Aşağıdaki adımları sırayla takip et — 5 dakikada veri akmaya başlar. SDK otomatik olarak oturum, performans ve crash verilerini toplar.',
        'integ.s1.title': '1. SDK\'yı Projene Ekle',
        'integ.s1.p1': 'Oyun ekledikten sonra <strong>"Oyunlarım"</strong> sekmesinde her oyunun yanında <em>"SDK İndir"</em> butonu çıkar. İndirdiğin zip içinde:',
        'integ.s1.li1': '<code>AltareAnalytics.cs</code> — Unity drop-in SDK (Assets klasörüne at)',
        'integ.s1.li2': '<code>AltareAnalyticsBootstrap.cs</code> — otomatik başlangıç + KVKK/GDPR consent (gameId pre-filled)',
        'integ.s1.li3': '<code>AltareConfig.json</code> — gameId + ayarlar pre-filled',
        'integ.s1.li4': '<code>SampleUsage.cs</code> — örnek event çağrıları',
        'integ.s1.li5': '<code>KURULUM_REHBERI_TR.txt</code> / <code>SETUP_GUIDE_EN.txt</code> — adım adım kurulum (TR + EN)',
        'integ.s1.p2': '<strong>Firebase Unity SDK gerekli:</strong> Authentication + Firestore modüllerini <a href="https://firebase.google.com/download/unity" target="_blank" rel="noopener">resmi siteden</a> indir, Unity\'e import et.',

        'integ.s2.title': '2. Bootstrap — Tek Satırlık Initialize',
        'integ.s2.pathA': '<strong>Yol A (Önerilen):</strong> <code>AltareAnalyticsBootstrap.cs</code> dosyasını projeye at — başka bir şey yapma. Bootstrap, KVKK/GDPR onayını kontrol eder ve SDK\'yı otomatik başlatır. <code>GameId</code> ve <code>GameName</code> zip\'te pre-filled gelir.',
        'integ.s2.pathB': '<strong>Yol B (Manuel):</strong> Bootstrap kullanmıyorsan sahnenin en üst MonoBehaviour\'ında:',
        'integ.s2.note': 'SDK otomatik olarak <code>sessionId</code> üretir. Her oturum ve app resume\'da yeni bir session başlatılır — panelde <strong>Aktif Oturum</strong> sayısı buna göre ölçülür. Ayrıca <code>first_open</code> ve <code>app_open</code> event\'lerini otomatik gönderir.',

        'integ.s3.title': '3. Event Çağrıları — Standart Taxonomy',
        'integ.s3.autoTitle': '<strong>Otomatik Event\'ler (manuel çağırma yok):</strong>',
        'integ.s3.auto1': '<code>session_start</code> — uygulama açılışında ve resume\'da',
        'integ.s3.auto2': '<code>session_end</code> — uygulama pause/quit\'te (duration_seconds dahil)',
        'integ.s3.auto3': '<code>fps_warning</code> — FPS &lt;30 düşünce (5sn aralıkla kontrol, 60sn cooldown)',
        'integ.s3.auto4': '<code>crash_detected</code> — beklenmeyen kapanmalarda',

        'integ.s4.title': '4. Firebase Setup (her oyun için bir kere)',
        'integ.s4.li1': 'Firebase Console → projeye Android app ekle (paket adı eşleşmeli)',
        'integ.s4.li2': '<code>google-services.json</code> dosyasını <code>Assets/</code> köküne koy',
        'integ.s4.li3': 'Authentication → Sign-in method → <strong>Anonymous</strong> provider\'ı Enable yap',
        'integ.s4.li4': 'Firestore Database → Rules\'da oyunun event yazmasına izin ver (varsayılan kurallar bunu destekler)',
        'integ.s4.li5': 'Build → telefona kur → ilk açılışta event akmaya başlar',

        'integ.s5.title': '5. Doğrulama Checklist',
        'integ.s5.li1': 'Oyunu telefonda aç, 1-2 dakika oyna',
        'integ.s5.li2': '<strong>"Canlı Event Stream"</strong> sekmesinde <code>session_start</code> event\'i görünmeli',
        'integ.s5.li3': 'Level başlat/bitir → <code>level_start</code> + <code>level_complete</code> akmalı',
        'integ.s5.li4': '<strong>"Genel Bakış"</strong>\'ta Aktif Oturum &gt; 0 olmalı',
        'integ.s5.li5': 'Reklam izlet → <code>ad_watched</code> event\'i geldiğini onayla',
        'integ.s5.li6': '24 saat veri biriktikten sonra <em>"AI Raporu"</em> üretebilirsin',
        'integ.s5.trouble': '<strong>Sorun mu var?</strong> Unity Console\'da <code>[Altare]</code> ile başlayan logları kontrol et. <code>[Altare] Ready. uid=...</code> mesajı görmüyorsan Firebase SDK kurulumunu tekrar kontrol et. <code>google-services.json</code> eksik veya paket adı uyumsuz olabilir.',

        'integ.s6.title': '6. Her Event\'te Gönderilen Veriler',
        'integ.s6.intro': 'SDK her event\'te şu alanları otomatik doldurur — ek bir şey yapmanıza gerek yok:',
        'integ.s6.gameId': 'Oyun kimliği (initialize\'da verilen)',
        'integ.s6.sessionId': 'Her oturum için benzersiz UUID (otomatik üretilir)',
        'integ.s6.playerAnonId': 'Anonim oyuncu kimliği (cihazda saklanır, PII yok)',
        'integ.s6.platform': 'Android / iOS / Editor',
        'integ.s6.appVersion': 'Oyun sürümü (Application.version)',
        'integ.s6.deviceModel': 'Cihaz modeli (Samsung SM-A217F vb.)',

        // ── Roadmap (concepts) ──
        'roadmap.banner': 'Gerçek Play Store rakip + yorum verisinden AI yeni oyun konseptleri üretir. Önce <strong>Pazar Analizi</strong> sekmesinden ilgili kategori için rakipleri çek, sonra burada <strong>"Konsept Üret"</strong> bas.',

        // ── AI Report ──
        'ai.btnGenerate': 'Yeni AI Raporu Üret',
        'ai.lastReport': 'Henüz rapor yok',
        'ai.emptyTitle': 'Henüz AI raporu üretilmedi.',
        'ai.emptyBody': 'Yukarıdaki <em>Yeni AI Raporu Üret</em> butonuna basarak ilk raporu üretebilirsin. Cloud Function event verilerini analiz edip Claude\'a gönderir, sonucu burada görürsün.',

        // ── Market Analysis ──
        'market.competitorSnapshot': 'Rakip Snapshot · Play Store',
        'market.refresh': '↻ Yenile',
        'market.trendSignals': 'Trend Sinyalleri',
        'market.trendMeta': 'Son 30 gün · kategori yorumları',

        // ── Reviews ──
        'reviews.banner': 'Yorum sentiment\'ı şu an demo. Google Play Review API entegre edildiğinde gerçek yorumlar buraya akacak.',
        'reviews.compareTitle': 'Yorum Sentiment Karşılaştırma',
        'reviews.compareMeta': 'Bu oyun vs kategori top 3',

        // ── Performance ──
        'perf.fpsWarn24h': 'FPS Uyarısı (24h)',

        // ── Range selector ──
        'range.last24h': 'Son 24 saat',
        'range.last7d': 'Son 7 gün',

        // ── Countries ──
        'country.tr': 'Türkiye',
        'country.us': 'USA',
        'country.de': 'Almanya',
        'country.jp': 'Japonya',
    },

    en: {
        // Topbar
        'topbar.tag': 'AI Panel · v1.0 · Live',
        'topbar.live': 'Live',
        'topbar.logout': 'Logout',

        // Sidebar sections
        'sidebar.studio': 'Studio',
        'sidebar.gameIntel': 'Game Intelligence',
        'sidebar.marketIntel': 'Market Intelligence',
        'sidebar.ai': 'AI',

        // Sidebar tabs
        'tab.my-games': 'My Games',
        'tab.customers': 'Customer Management',
        'tab.integration': 'Integration Guide',
        'tab.overview': 'Overview',
        'tab.alerts': 'Sentinel Alerts',
        'tab.events': 'Live Event Stream',
        'tab.levels': 'Level Intelligence',
        'tab.performance': 'Crash & Performance',
        'tab.market': 'Market Analysis',
        'tab.benchmark': 'Benchmark',
        'tab.reviews': 'Reviews & Sentiment',
        'tab.ai-report': 'AI Report',
        'tab.roadmap': 'Roadmap Suggestions',

        // ── Sentinel Alerts ──
        'alerts.banner': '<strong>Altare Sentinel</strong> watches your game 24/7. Crash spikes, DAU drops, performance degradation or whale detection — automatic alerts without you opening the panel.',
        'alerts.recent': 'Recent Alerts',
        'alerts.empty': 'No alerts yet. Sentinel checks your game every 30 minutes — anomalies will appear here.',
        'alerts.markRead': 'Mark as read',
        'alerts.unread': 'unread',
        'alerts.severity.critical': 'CRITICAL',
        'alerts.severity.high': 'HIGH',
        'alerts.severity.medium': 'MEDIUM',
        'alerts.severity.info': 'INFO',

        // ── Benchmark ──
        'benchmark.banner': 'Compares your game\'s metrics against <strong>category median</strong> and <strong>top 10%</strong>. See where you\'re ahead and where you lag.',
        'benchmark.title': 'Category Comparison',
        'benchmark.run': '⚡ Run Benchmark',
        'benchmark.running': 'Running benchmark...',
        'benchmark.empty': 'First fetch competitors from "Market Analysis" tab for the relevant category, then click "Run Benchmark" here.',
        'benchmark.you': 'You',
        'benchmark.median': 'Category median',
        'benchmark.top10': 'Top 10%',
        'benchmark.gap': 'Gap',

        // ── Copilot ──
        'copilot.banner': '<strong>AI Copilot</strong> lets you chat with your game data. Ask things like "Why is retention dropping?", "How can I optimize Level 18?", "Which device crashes most?"',
        'copilot.title': 'AI Copilot',
        'copilot.online': 'Online · Claude Sonnet 4.5',
        'copilot.greeting': 'Hi! 👋 Ask anything about your game data. I can see events, level stats and the latest AI report.',
        'copilot.placeholder': 'Type your question...',
        'copilot.send': 'Send',
        'copilot.sending': 'Thinking...',
        'copilot.q1': 'Why is retention dropping?',
        'copilot.q2': 'Which level is the most problematic?',
        'copilot.q3': 'Which devices crash most?',
        'copilot.q4': 'How can I improve my ad strategy?',
        'copilot.error': 'Error: could not get response.',

        // Page meta
        'page.last24h': 'Last 24 hours',

        // KPI labels
        'kpi.activeSession': 'Active Sessions',
        'kpi.events24h': '24h Events',
        'kpi.avgSession': 'Avg. Session',
        'kpi.failRate': 'Fail Rate',
        'kpi.adWatches': 'Ad Watches (24h)',
        'kpi.iapRevenue': 'IAP Revenue (24h)',
        'kpi.fpsWarnings': 'FPS Warnings',
        'kpi.crashes': 'Crashes (24h)',
        'kpi.realtimeActive': 'Realtime Active',
        'kpi.dauToday': 'DAU (Today)',
        'kpi.wau7d': 'WAU (7 Days)',
        'kpi.mau28d': 'MAU (28 Days)',
        'kpi.sessionsToday': 'Sessions (Today)',
        'kpi.avgSessionDur': 'Avg. Session Duration',
        'kpi.newUsers': 'New Users',
        'kpi.revenue': 'Revenue',

        // Sections
        'section.firebaseAnalytics': 'Firebase Analytics · Live Data',
        'section.aiSuggestedAction': 'Suggested Action · AI Insight',
        'section.liveEventStream': 'Live Event Stream',
        'section.topProblemLevels': 'Top Problem Levels · Top 5',
        'section.levelDistribution': 'Level Distribution',
        'section.streamingLabel': 'Streaming',

        // Empty / placeholder
        'empty.noAIYet': 'No AI analysis yet.',
        'empty.aiReportHint': 'tab to generate your first report.',
        'empty.topLevels': 'Once data is collected, top 5 failing levels will appear here.',
        'empty.levelFunnel': 'Once level events are collected, completion rates will appear here.',
        'empty.noGames': 'You haven\'t added any games yet.',
        'empty.loading': 'Loading...',

        // Top countries (GA4)
        'ga4.topCountries': 'Top Countries (7 days)',
        'ga4.error': 'Firebase Analytics connection failed.',
        'ga4.errorHint': 'GCP Console → APIs & Services → "Google Analytics Data API" must be enabled.',

        // Concept generator
        'concept.btnGenerate': '⚡ Generate Concepts',
        'concept.generating': 'Generating...',
        'concept.title': 'Next Project Suggestions · AI Market Strategist',
        'concept.banner': 'AI generates new game concepts from real Play Store competitor + review data. First fetch competitors from <strong>Market Analysis</strong> tab for the relevant category, then click <strong>"Generate Concepts"</strong> here.',

        // My games
        'mygames.newGame': '+ Add New Game',
        'mygames.colName': 'Game Name',
        'mygames.colGameId': 'Game ID',
        'mygames.colType': 'Type',
        'mygames.colPlatform': 'Platform',
        'mygames.colStatus': 'Status',
        'mygames.actionSelect': 'Select',
        'mygames.actionDownload': 'Download SDK',
        'mygames.actionInfo': 'Info',
        'mygames.actionDelete': 'Delete',

        // Generic
        'btn.cancel': 'Cancel',
        'btn.close': 'Close',
        'btn.ok': 'OK',
        'btn.save': 'Save',

        // Language
        'lang.tr': 'Türkçe',
        'lang.en': 'English',
        'lang.switchTo': 'Switch language',

        // ── Selector ──
        'selector.noGames': 'No games yet — go to My Games > + Add New Game',

        // ── My Games ──
        'mygames.banner': 'Here you see your own games. Use <strong>"Add New Game"</strong> to start tracking a Unity project — the system generates a <code>gameId</code> automatically and prepares the SDK for you.',
        'mygames.title': 'My Games',

        // ── Customer Management (admin) ──
        'customers.banner': '<strong>Admin panel</strong> · Create customers who signed B2B contracts. The system automatically creates a Firebase Auth user + developer profile and generates a password reset link.',
        'customers.title': 'Add Customer',
        'customers.email': 'Email',
        'customers.studio': 'Studio name',
        'customers.tier.indie': 'Indie ($0)',
        'customers.tier.studio': 'Studio ($49/mo)',
        'customers.tier.enterprise': 'Enterprise (custom)',
        'customers.btnCreate': 'Create Customer',

        // ── Integration Guide ──
        'integ.banner': 'A <strong>drop-in Unity SDK</strong> for every game. Follow the steps below in order — data starts flowing in 5 minutes. The SDK automatically collects session, performance, and crash data.',
        'integ.s1.title': '1. Add the SDK to Your Project',
        'integ.s1.p1': 'After adding a game, an <em>"Download SDK"</em> button appears next to each game in <strong>"My Games"</strong>. The downloaded zip contains:',
        'integ.s1.li1': '<code>AltareAnalytics.cs</code> — Unity drop-in SDK (place in Assets folder)',
        'integ.s1.li2': '<code>AltareAnalyticsBootstrap.cs</code> — auto-init + KVKK/GDPR consent (gameId pre-filled)',
        'integ.s1.li3': '<code>AltareConfig.json</code> — gameId + settings pre-filled',
        'integ.s1.li4': '<code>SampleUsage.cs</code> — example event calls',
        'integ.s1.li5': '<code>KURULUM_REHBERI_TR.txt</code> / <code>SETUP_GUIDE_EN.txt</code> — step-by-step setup guide (TR + EN)',
        'integ.s1.p2': '<strong>Firebase Unity SDK required:</strong> download Authentication + Firestore modules from the <a href="https://firebase.google.com/download/unity" target="_blank" rel="noopener">official site</a> and import them into Unity.',

        'integ.s2.title': '2. Bootstrap — One-Line Initialize',
        'integ.s2.pathA': '<strong>Option A (Recommended):</strong> drop <code>AltareAnalyticsBootstrap.cs</code> into your project — that\'s it. Bootstrap checks KVKK/GDPR consent and initializes the SDK automatically. <code>GameId</code> and <code>GameName</code> come pre-filled in the zip.',
        'integ.s2.pathB': '<strong>Option B (Manual):</strong> if you don\'t use Bootstrap, add this to the top MonoBehaviour of your scene:',
        'integ.s2.note': 'The SDK automatically generates a <code>sessionId</code>. A new session starts on every launch and app resume — the panel\'s <strong>Active Sessions</strong> count is measured by this. It also sends <code>first_open</code> and <code>app_open</code> events automatically.',

        'integ.s3.title': '3. Event Calls — Standard Taxonomy',
        'integ.s3.autoTitle': '<strong>Automatic Events (no manual call needed):</strong>',
        'integ.s3.auto1': '<code>session_start</code> — on app launch and resume',
        'integ.s3.auto2': '<code>session_end</code> — on app pause/quit (includes duration_seconds)',
        'integ.s3.auto3': '<code>fps_warning</code> — when FPS drops below 30 (checked every 5s, 60s cooldown)',
        'integ.s3.auto4': '<code>crash_detected</code> — on unexpected shutdowns',

        'integ.s4.title': '4. Firebase Setup (once per game)',
        'integ.s4.li1': 'Firebase Console → add Android app to the project (package name must match)',
        'integ.s4.li2': 'Place <code>google-services.json</code> in <code>Assets/</code> root',
        'integ.s4.li3': 'Authentication → Sign-in method → Enable <strong>Anonymous</strong> provider',
        'integ.s4.li4': 'Firestore Database → Rules must allow game event writes (default rules already do)',
        'integ.s4.li5': 'Build → install on phone → events start flowing on first launch',

        'integ.s5.title': '5. Validation Checklist',
        'integ.s5.li1': 'Open the game on a phone, play for 1-2 minutes',
        'integ.s5.li2': 'The <code>session_start</code> event should appear in <strong>"Live Event Stream"</strong>',
        'integ.s5.li3': 'Start/finish a level → <code>level_start</code> + <code>level_complete</code> should flow',
        'integ.s5.li4': 'Active Sessions &gt; 0 in <strong>"Overview"</strong>',
        'integ.s5.li5': 'Watch an ad → confirm <code>ad_watched</code> event arrives',
        'integ.s5.li6': 'After 24 hours of data, you can generate an <em>"AI Report"</em>',
        'integ.s5.trouble': '<strong>Trouble?</strong> Check logs starting with <code>[Altare]</code> in Unity Console. If you don\'t see <code>[Altare] Ready. uid=...</code>, re-check the Firebase SDK setup. <code>google-services.json</code> may be missing or the package name may not match.',

        'integ.s6.title': '6. Data Sent With Every Event',
        'integ.s6.intro': 'The SDK fills these fields automatically on every event — no extra work needed:',
        'integ.s6.gameId': 'Game identifier (passed to Initialize)',
        'integ.s6.sessionId': 'Unique UUID per session (auto-generated)',
        'integ.s6.playerAnonId': 'Anonymous player ID (stored on device, no PII)',
        'integ.s6.platform': 'Android / iOS / Editor',
        'integ.s6.appVersion': 'Game version (Application.version)',
        'integ.s6.deviceModel': 'Device model (e.g. Samsung SM-A217F)',

        // ── Roadmap (concepts) ──
        'roadmap.banner': 'AI generates new game concepts from real Play Store competitor + review data. First fetch competitors from the <strong>Market Analysis</strong> tab for the relevant category, then click <strong>"Generate Concepts"</strong> here.',

        // ── AI Report ──
        'ai.btnGenerate': 'Generate New AI Report',
        'ai.lastReport': 'No reports yet',
        'ai.emptyTitle': 'No AI report generated yet.',
        'ai.emptyBody': 'Click the <em>Generate New AI Report</em> button above to create the first report. The Cloud Function analyzes event data, sends it to Claude, and shows the result here.',

        // ── Market Analysis ──
        'market.competitorSnapshot': 'Competitor Snapshot · Play Store',
        'market.refresh': '↻ Refresh',
        'market.trendSignals': 'Trend Signals',
        'market.trendMeta': 'Last 30 days · category reviews',

        // ── Reviews ──
        'reviews.banner': 'Review sentiment is currently a demo. Real reviews will flow here once the Google Play Review API is integrated.',
        'reviews.compareTitle': 'Review Sentiment Comparison',
        'reviews.compareMeta': 'This game vs category top 3',

        // ── Performance ──
        'perf.fpsWarn24h': 'FPS Warnings (24h)',

        // ── Range selector ──
        'range.last24h': 'Last 24 hours',
        'range.last7d': 'Last 7 days',

        // ── Countries ──
        'country.tr': 'Turkey',
        'country.us': 'USA',
        'country.de': 'Germany',
        'country.jp': 'Japan',
    },
};

let _currentLang = (function() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && SUPPORTED.includes(saved)) return saved;
    } catch {}
    return DEFAULT_LANG;
})();

export function getLanguage() {
    return _currentLang;
}

export function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) return;
    _currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    document.documentElement.lang = lang;
    applyTranslations(document);
    window.dispatchEvent(new CustomEvent('altare-lang-changed', { detail: { lang } }));
}

export function t(key, fallback) {
    const dict = I18N[_currentLang] || I18N[DEFAULT_LANG];
    const v = dict[key];
    if (v != null) return v;
    if (fallback != null) return fallback;
    const def = I18N[DEFAULT_LANG][key];
    return def != null ? def : key;
}

export function applyTranslations(root = document) {
    if (!root || !root.querySelectorAll) return;

    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const val = t(key);
        if (val.indexOf('<') !== -1) {
            el.innerHTML = val;
        } else {
            el.textContent = val;
        }
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) el.setAttribute('placeholder', t(key));
    });

    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (key) el.setAttribute('title', t(key));
    });

    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.getAttribute('data-i18n-html');
        if (key) el.innerHTML = t(key);
    });
}

export function initLanguageToggle(buttonId = 'lang-toggle') {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    const render = () => {
        const lang = getLanguage();
        btn.textContent = lang === 'tr' ? 'EN' : 'TR';
        btn.setAttribute('title', t('lang.switchTo'));
    };
    render();
    btn.addEventListener('click', () => {
        setLanguage(getLanguage() === 'tr' ? 'en' : 'tr');
        render();
    });
}

// Auto-apply on first import (will pick up data-i18n attributes already in DOM)
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.lang = _currentLang;
            applyTranslations(document);
        });
    } else {
        document.documentElement.lang = _currentLang;
        applyTranslations(document);
    }
}
