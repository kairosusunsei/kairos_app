/**
 * シェアカード / OG 画像の共通クエリ正規化。
 */

const SITE_URL = String(process.env.KAIROS_PUBLIC_URL || 'https://get-kairos.online').replace(
  /\/$/,
  '',
);

function normalizeLocale(locale) {
  const base = String(locale || 'ja').split('-')[0].toLowerCase();
  if (['ja', 'en', 'es', 'fr', 'de', 'it', 'pt'].includes(base)) return base;
  return 'en';
}

function clampScore(score) {
  const n = parseInt(score, 10);
  if (!Number.isFinite(n)) return 88;
  return Math.min(99, Math.max(77, n));
}

function truncate(text, max) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function normalizeReferralRef(raw) {
  const code = String(raw || '').trim().slice(0, 64);
  if (!code) return '';
  if (!/^kairos_[a-z0-9_-]+$/i.test(code)) return '';
  return code;
}

/**
 * @param {Record<string, string|undefined>} query
 */
function parseSocialImageQuery(query) {
  const q = query || {};
  const locale = normalizeLocale(q.locale);
  return {
    score: clampScore(q.score),
    teaser: truncate(q.teaser, locale === 'ja' ? 72 : 96),
    locale,
    ref: normalizeReferralRef(q.ref),
  };
}

function buildInviteUrl(ref) {
  if (!ref) return `${SITE_URL}/`;
  return `${SITE_URL}/invite?ref=${encodeURIComponent(ref)}`;
}

function buildLandingUrl(ref) {
  if (!ref) return `${SITE_URL}/`;
  return `${SITE_URL}/?ref=${encodeURIComponent(ref)}`;
}

function buildOgImageUrl(params, raster) {
  const q = new URLSearchParams();
  if (params.score != null) q.set('score', String(params.score));
  if (params.teaser) q.set('teaser', params.teaser);
  if (params.locale) q.set('locale', params.locale);
  if (params.ref) q.set('ref', params.ref);
  const ext = raster ? '.png' : '';
  const qs = q.toString();
  return `${SITE_URL}/api/og${ext}${qs ? `?${qs}` : ''}`;
}

function buildShareCardImageUrl(params, raster) {
  const q = new URLSearchParams();
  q.set('score', String(params.score != null ? params.score : 88));
  if (params.teaser) q.set('teaser', params.teaser);
  if (params.locale) q.set('locale', params.locale);
  if (params.ref) q.set('ref', params.ref);
  const suffix = raster ? '.png' : '';
  return `${SITE_URL}/api/share-card${suffix}?${q.toString()}`;
}

module.exports = {
  SITE_URL,
  normalizeLocale,
  clampScore,
  truncate,
  normalizeReferralRef,
  parseSocialImageQuery,
  buildInviteUrl,
  buildLandingUrl,
  buildOgImageUrl,
  buildShareCardImageUrl,
};
