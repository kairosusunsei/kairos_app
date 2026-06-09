/**
 * 紹介用シェアカード（SVG）。外部画像生成ライブラリ不要。
 * 1080×1080 — X / 保存用
 */

const social = require('./social-image.js');
const { buildQrSvgGroup } = require('./qr-svg.js');

const LABELS = {
  ja: {
    kicker: 'KAIROS — 行動分析レポート',
    scoreLabel: 'シンクロニシティ・スコア',
    cta: 'あなたも解析解禁',
    hashtag: '#エンタメカイロス',
  },
  en: {
    kicker: 'KAIROS — Behavioral Analytics',
    scoreLabel: 'Synchronicity Score',
    cta: 'Unseal your report',
    hashtag: '#EntertainKAIROS',
  },
};

function escapeXml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const normalizeLocale = social.normalizeLocale;
const clampScore = social.clampScore;
const truncate = social.truncate;

/**
 * @param {object} opts
 * @param {number} [opts.score]
 * @param {string} [opts.teaser] thoughtResonanceVector excerpt
 * @param {string} [opts.locale]
 * @param {string} [opts.ref] referral code (kairos_user_id)
 * @param {string} [opts.siteUrl]
 */
function buildShareCardSvg(opts) {
  const locale = normalizeLocale(opts && opts.locale);
  const labels = LABELS[locale] || LABELS.en;
  const score = clampScore(opts && opts.score);
  const teaser = truncate(opts && opts.teaser, locale === 'ja' ? 72 : 96);
  const ref = social.normalizeReferralRef(opts && opts.ref);
  const landing = social.buildInviteUrl(ref);
  const qrTarget = ref ? landing : `${social.SITE_URL}/`;
  const qrSvg = buildQrSvgGroup(qrTarget, 868, 748, 148);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f0731"/>
      <stop offset="55%" stop-color="#140a3d"/>
      <stop offset="100%" stop-color="#0a0524"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#e4c78a"/>
      <stop offset="100%" stop-color="#9b773d"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="45%">
      <stop offset="0%" stop-color="#00f0ff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#00f0ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <rect x="48" y="48" width="984" height="984" rx="24" fill="none" stroke="url(#gold)" stroke-width="6"/>
  <rect x="72" y="72" width="936" height="936" rx="16" fill="none" stroke="#9b773d" stroke-width="2" stroke-opacity="0.45"/>
  <circle cx="540" cy="380" r="280" fill="url(#glow)"/>
  <text x="540" y="118" text-anchor="middle" fill="#c9a56a" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-weight="700" letter-spacing="6">${escapeXml(labels.kicker)}</text>
  <text x="540" y="300" text-anchor="middle" fill="#9b773d" font-family="system-ui, sans-serif" font-size="28" font-weight="700" letter-spacing="4">${escapeXml(labels.scoreLabel)}</text>
  <text x="540" y="430" text-anchor="middle" fill="#fdf8f0" font-family="Georgia, serif" font-size="160" font-weight="900" filter="url(#shadow)">${score}</text>
  <rect x="140" y="500" width="800" height="220" rx="16" fill="#0f0731" fill-opacity="0.55" stroke="#9b773d" stroke-width="2" stroke-opacity="0.5"/>
  <text x="540" y="560" text-anchor="middle" fill="#d8d0c4" font-family="system-ui, sans-serif" font-size="32" font-weight="600">${escapeXml(teaser || (locale === 'ja' ? '深層心理レポートの抜粋' : 'Excerpt from your report'))}</text>
  <text x="540" y="640" text-anchor="middle" fill="#00d4ff" font-family="system-ui, sans-serif" font-size="28" font-weight="700">${escapeXml(labels.cta)}</text>
  <text x="430" y="820" text-anchor="middle" fill="#e4c78a" font-family="system-ui, sans-serif" font-size="34" font-weight="800" letter-spacing="2">get-kairos.online</text>
  <text x="430" y="872" text-anchor="middle" fill="#ff9500" font-family="system-ui, sans-serif" font-size="24" font-weight="700">${escapeXml(labels.hashtag)}</text>
  <text x="430" y="918" text-anchor="middle" fill="#7eb8d4" font-family="monospace, sans-serif" font-size="18">${escapeXml(landing)}</text>
  ${qrSvg}
  <text x="942" y="918" text-anchor="middle" fill="#9b773d" font-family="system-ui, sans-serif" font-size="16" font-weight="700">SCAN</text>
</svg>`;
}

/** 固定テストケース（プレビュー・QA用） */
const PREVIEW_FIXTURES = [
  {
    id: 'ja-standard',
    title: 'TC1 — 日本語・標準（スコア89）',
    score: 89,
    teaser: '今夜の会話で、あなたが選んだ言葉が静かに道を開いています。',
    locale: 'ja',
    ref: 'kairos_preview_01',
  },
  {
    id: 'ja-high',
    title: 'TC2 — 日本語・高スコア（99）',
    score: 99,
    teaser: 'いま感じている迷いは、次の一歩の前触れとして整いつつあります。',
    locale: 'ja',
    ref: 'kairos_preview_02',
  },
  {
    id: 'en-standard',
    title: 'TC3 — English',
    score: 91,
    teaser: 'What you wrote tonight is already shaping a clearer next move.',
    locale: 'en',
    ref: 'kairos_preview_en',
  },
  {
    id: 'ja-long-teaser',
    title: 'TC4 — 長文抜粋（省略確認）',
    score: 87,
    teaser:
      'これは非常に長い思考共鳴ベクトルのサンプル文です。カード上では約七十二文字で切り詰められ、末尾に省略記号が付きます。読みやすさを優先します。',
    locale: 'ja',
    ref: 'kairos_preview_long',
  },
  {
    id: 'ja-minimal',
    title: 'TC5 — 最小入力',
    score: 77,
    teaser: '',
    locale: 'ja',
    ref: '',
  },
];

function buildTweetText(locale, ref) {
  const code = social.normalizeReferralRef(ref);
  const url = social.buildInviteUrl(code);
  if (normalizeLocale(locale) === 'ja') {
    return `深層心理レポートを解析解禁しました。あなたも試してみてください ${url} #エンタメカイロス`;
  }
  return `I unlocked my KAIROS behavioral analytics report. Try yours: ${url} #EntertainKAIROS`;
}

module.exports = {
  buildShareCardSvg,
  buildTweetText,
  PREVIEW_FIXTURES,
  normalizeLocale,
};
