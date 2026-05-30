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
        'tab.events': 'Canlı Event Stream',
        'tab.levels': 'Level Intelligence',
        'tab.performance': 'Crash & Performance',
        'tab.market': 'Pazar Analizi',
        'tab.reviews': 'Yorum & Sentiment',
        'tab.ai-report': 'AI Raporu',
        'tab.roadmap': 'Roadmap Önerileri',

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
        'tab.events': 'Live Event Stream',
        'tab.levels': 'Level Intelligence',
        'tab.performance': 'Crash & Performance',
        'tab.market': 'Market Analysis',
        'tab.reviews': 'Reviews & Sentiment',
        'tab.ai-report': 'AI Report',
        'tab.roadmap': 'Roadmap Suggestions',

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
