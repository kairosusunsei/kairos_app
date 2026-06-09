/**
 * Open Graph 用 1200×630 SVG と invite ランディング HTML。
 */

const social = require('./social-image.js');

const OG_LABELS = {
  ja: {
    title: 'KAIROS — 行動分析レポート',
    description: 'テキストから深層心理レポートを生成。シンクロニシティ・スコアで予兆を可視化。',
    siteName: 'KAIROS',
    scoreLabel: 'シンクロニシティ・スコア',
    cta: 'あなたも解析解禁',
  },
  en: {
    title: 'KAIROS — Behavioral Analytics',
    description: 'Turn your text into a deep psychological report with a Synchronicity Score.',
    siteName: 'KAIROS',
    scoreLabel: 'Synchronicity Score',
    cta: 'Unseal your report',
  },
};

function escapeXml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtml(raw) {
  return escapeXml(raw);
}

function labelsFor(locale) {
  const base = social.normalizeLocale(locale);
  return OG_LABELS[base] || OG_LABELS.en;
}

/**
 * Open Graph 推奨 1200×630
 * @param {{ score?: number, teaser?: string, locale?: string, ref?: string }} opts
 */
function buildOgCardSvg(opts) {
  const locale = social.normalizeLocale(opts && opts.locale);
  const labels = labelsFor(locale);
  const score = social.clampScore(opts && opts.score);
  const teaser = social.truncate(
    opts && opts.teaser,
    locale === 'ja' ? 56 : 72,
  );
  const ref = social.normalizeReferralRef(opts && opts.ref);
  const inviteUrl = social.buildInviteUrl(ref);

  const teaserLine =
    teaser ||
    (locale === 'ja' ? '深層心理レポートの抜粋' : 'Excerpt from a behavioral analytics report');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="og-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f0731"/>
      <stop offset="55%" stop-color="#140a3d"/>
      <stop offset="100%" stop-color="#0a0524"/>
    </linearGradient>
    <linearGradient id="og-gold" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#e4c78a"/>
      <stop offset="100%" stop-color="#9b773d"/>
    </linearGradient>
    <radialGradient id="og-glow" cx="72%" cy="38%" r="42%">
      <stop offset="0%" stop-color="#00f0ff" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#00f0ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#og-bg)"/>
  <rect x="32" y="32" width="1136" height="566" rx="20" fill="none" stroke="url(#og-gold)" stroke-width="5"/>
  <circle cx="900" cy="260" r="220" fill="url(#og-glow)"/>
  <text x="72" y="96" fill="#c9a56a" font-family="Georgia, serif" font-size="30" font-weight="700" letter-spacing="4">${escapeXml(labels.siteName)}</text>
  <text x="72" y="148" fill="#fdf8f0" font-family="Georgia, serif" font-size="42" font-weight="800">${escapeXml(labels.title)}</text>
  <text x="72" y="210" fill="#9b773d" font-family="system-ui, sans-serif" font-size="22" font-weight="700" letter-spacing="2">${escapeXml(labels.scoreLabel)}</text>
  <text x="72" y="310" fill="#fdf8f0" font-family="Georgia, serif" font-size="120" font-weight="900">${score}</text>
  <rect x="72" y="350" width="720" height="120" rx="12" fill="#0f0731" fill-opacity="0.55" stroke="#9b773d" stroke-width="2" stroke-opacity="0.45"/>
  <text x="96" y="410" fill="#d8d0c4" font-family="system-ui, sans-serif" font-size="26" font-weight="600">${escapeXml(teaserLine)}</text>
  <text x="72" y="520" fill="#00d4ff" font-family="system-ui, sans-serif" font-size="28" font-weight="700">${escapeXml(labels.cta)}</text>
  <text x="72" y="572" fill="#e4c78a" font-family="system-ui, sans-serif" font-size="24" font-weight="800">get-kairos.online</text>
  <text x="1128" y="572" text-anchor="end" fill="#7eb8d4" font-family="monospace, sans-serif" font-size="18">${escapeXml(inviteUrl.replace(/^https:\/\//, ''))}</text>
</svg>`;
}

/**
 * @param {{ score?: number, teaser?: string, locale?: string, ref?: string }} params
 */
function buildOgMeta(params) {
  const locale = social.normalizeLocale(params && params.locale);
  const labels = labelsFor(locale);
  const ref = social.normalizeReferralRef(params && params.ref);
  const pageUrl = ref ? social.buildInviteUrl(ref) : `${social.SITE_URL}/`;
  const imageUrl = social.buildOgImageUrl(
    {
      score: params && params.score,
      teaser: params && params.teaser,
      locale,
      ref,
    },
    true,
  );
  const title = ref
    ? locale === 'ja'
      ? `KAIROS 招待 — シンクロニシティ ${social.clampScore(params && params.score)}`
      : `KAIROS invite — Synchronicity ${social.clampScore(params && params.score)}`
    : labels.title;

  return {
    title,
    description: labels.description,
    pageUrl,
    imageUrl,
    imageWidth: 1200,
    imageHeight: 630,
    locale: locale === 'ja' ? 'ja_JP' : 'en_US',
    siteName: labels.siteName,
    landingUrl: social.buildLandingUrl(ref),
  };
}

function metaTag(attr, name, content) {
  if (!content) return '';
  return `<meta ${attr}="${escapeHtml(name)}" content="${escapeHtml(content)}"/>`;
}

/**
 * クローラ向け invite ランディング（JS なしでも OG 可）。
 * @param {{ score?: number, teaser?: string, locale?: string, ref?: string }} params
 */
function buildInviteLandingHtml(params) {
  const meta = buildOgMeta(params || {});
  const locale = social.normalizeLocale(params && params.locale);
  const ref = social.normalizeReferralRef(params && params.ref);
  const cta =
    locale === 'ja' ? '解析を始める' : locale === 'en' ? 'Start analysis' : 'Start analysis';
  const lead =
    locale === 'ja'
      ? 'あなたの言葉から、深層心理レポート（行動分析）を生成します。'
      : 'Generate a deep behavioral analytics report from your text.';

  const visitScript = ref
    ? `<script>fetch('/api/referral/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({referralCode:${JSON.stringify(ref)}})}).catch(function(){});</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="${locale === 'ja' ? 'ja' : 'en'}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeHtml(meta.description)}"/>
  <link rel="canonical" href="${escapeHtml(meta.pageUrl)}"/>
  ${metaTag('property', 'og:type', 'website')}
  ${metaTag('property', 'og:site_name', meta.siteName)}
  ${metaTag('property', 'og:title', meta.title)}
  ${metaTag('property', 'og:description', meta.description)}
  ${metaTag('property', 'og:url', meta.pageUrl)}
  ${metaTag('property', 'og:image', meta.imageUrl)}
  ${metaTag('property', 'og:image:width', String(meta.imageWidth))}
  ${metaTag('property', 'og:image:height', String(meta.imageHeight))}
  ${metaTag('property', 'og:locale', meta.locale)}
  ${metaTag('name', 'twitter:card', 'summary_large_image')}
  ${metaTag('name', 'twitter:title', meta.title)}
  ${metaTag('name', 'twitter:description', meta.description)}
  ${metaTag('name', 'twitter:image', meta.imageUrl)}
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0731;color:#f2ebe0;font-family:system-ui,sans-serif;padding:1.5rem}
    main{max-width:28rem;text-align:center;border:2px solid #9b773d;border-radius:.5rem;padding:2rem;background:rgba(15,7,49,.92)}
    a{display:inline-block;margin-top:1.25rem;padding:.85rem 1.5rem;border:2px solid #9b773d;color:#fff9ef;text-decoration:none;font-weight:800;letter-spacing:.08em}
    p{line-height:1.6;color:#d8d0c4}
    h1{font-size:1.25rem;color:#e4c78a;margin:0 0 1rem}
  </style>
</head>
<body>
  <main>
    <h1>KAIROS</h1>
    <p>${escapeHtml(lead)}</p>
    <a href="${escapeHtml(meta.landingUrl)}">${escapeHtml(cta)}</a>
  </main>
  ${visitScript}
</body>
</html>`;
}

module.exports = {
  buildOgCardSvg,
  buildOgMeta,
  buildInviteLandingHtml,
};
