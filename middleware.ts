import { next } from '@vercel/functions';

/** Keep in sync with lib/geo-block.js (Express physical guard). */
const BLOCKED_COUNTRY_CODES = new Set(['CN', 'HK', 'MO']);

function normalizeCountry(headerValue: string | null): string {
  if (!headerValue || typeof headerValue !== 'string') return '';
  return headerValue.trim().toUpperCase();
}

function isBlockedCountry(countryCode: string): boolean {
  return Boolean(countryCode && BLOCKED_COUNTRY_CODES.has(countryCode));
}

function blockedPageHtml(): string {
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

export default function middleware(request: Request) {
  const country = normalizeCountry(request.headers.get('x-vercel-ip-country'));
  if (isBlockedCountry(country)) {
    return new Response(blockedPageHtml(), {
      status: 403,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
      },
    });
  }
  return next();
}
