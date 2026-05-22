'use strict';

/** ISO 3166-1 alpha-2: physical guard jurisdictions */
const BLOCKED_COUNTRY_CODES = new Set(['CN', 'HK', 'MO']);

function normalizeCountry(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return '';
  return headerValue.trim().toUpperCase();
}

function isBlockedCountry(countryCode) {
  return countryCode && BLOCKED_COUNTRY_CODES.has(countryCode);
}

/** @param {{ headers: Record<string, string | string[] | undefined> }} req */
function countryFromRequest(req) {
  const raw = req.headers['x-vercel-ip-country'];
  if (Array.isArray(raw)) return normalizeCountry(raw[0]);
  return normalizeCountry(raw);
}

function blockedResponseHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  };
}

function blockedPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet"/>
  <meta name="googlebot" content="noindex, nofollow, noarchive"/>
  <meta name="bingbot" content="noindex, nofollow, noarchive"/>
  <title>403 — Access restricted | KAIROS</title>
  <style>
    :root { color-scheme: dark; --bg:#0a0908; --fg:#e4e0d8; --muted:#7a756d; }
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      font-family:system-ui,sans-serif; background:var(--bg); color:var(--fg); padding:24px; text-align:center; }
    p { max-width:28rem; line-height:1.6; color:var(--muted); font-size:0.95rem; }
    h1 { font-size:1rem; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; margin:0 0 12px; }
  </style>
</head>
<body>
  <div>
    <h1>403 Forbidden</h1>
    <p>This behavioral analytics surface is not offered in your detected region. No further action is available.</p>
  </div>
</body>
</html>`;
}

module.exports = {
  BLOCKED_COUNTRY_CODES,
  normalizeCountry,
  isBlockedCountry,
  countryFromRequest,
  blockedPageHtml,
  blockedResponseHeaders,
};
