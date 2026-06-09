'use strict';

const { Pool } = require('pg');

const TABLE = 'rate_limit_buckets';

let pool = null;
/** @type {Map<string, { count: number, resetAt: number }>|null} */
let memoryBuckets = null;

function useMemoryStore() {
  return !process.env.DATABASE_URL;
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

async function ensurePgTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      bucket_key text PRIMARY KEY,
      window_start timestamptz NOT NULL,
      hit_count int NOT NULL DEFAULT 0
    );
  `);
}

/**
 * Fixed-window rate limit. Uses Postgres when DATABASE_URL is set; otherwise in-memory (per instance).
 * @param {{ key: string, limit: number, windowMs: number }} opts
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterMs: number }>}
 */
async function checkRateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindow = Math.max(1000, Number(windowMs) || 60000);

  if (useMemoryStore()) {
    if (!memoryBuckets) memoryBuckets = new Map();
    let bucket = memoryBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + safeWindow };
      memoryBuckets.set(key, bucket);
    }
    bucket.count += 1;
    const allowed = bucket.count <= safeLimit;
    return {
      allowed,
      remaining: Math.max(0, safeLimit - bucket.count),
      retryAfterMs: allowed ? 0 : Math.max(0, bucket.resetAt - now),
    };
  }

  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTable(client);
    const windowStart = new Date(Math.floor(now / safeWindow) * safeWindow);
    const upsert = await client.query(
      `INSERT INTO ${TABLE} (bucket_key, window_start, hit_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (bucket_key) DO UPDATE SET
         hit_count = CASE
           WHEN ${TABLE}.window_start = $2 THEN ${TABLE}.hit_count + 1
           ELSE 1
         END,
         window_start = CASE
           WHEN ${TABLE}.window_start = $2 THEN ${TABLE}.window_start
           ELSE $2
         END
       RETURNING hit_count, window_start`,
      [key, windowStart],
    );
    const row = upsert.rows[0];
    const hitCount = Number(row.hit_count) || 0;
    const rowStart = new Date(row.window_start).getTime();
    const resetAt = rowStart + safeWindow;
    const allowed = hitCount <= safeLimit;
    return {
      allowed,
      remaining: Math.max(0, safeLimit - hitCount),
      retryAfterMs: allowed ? 0 : Math.max(0, resetAt - now),
    };
  } finally {
    client.release();
  }
}

/** @param {{ headers: Record<string, string | string[] | undefined> }} req */
function clientIp(req) {
  try {
    const { ipAddress } = require('@vercel/functions');
    const fromVercel = ipAddress(req);
    if (fromVercel) return fromVercel;
  } catch (_) {
    /* @vercel/functions unavailable outside Vercel */
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  return 'unknown';
}

/**
 * @param {{ headers: Record<string, string | string[] | undefined>, get?: (name: string) => string }} req
 */
function isSameSiteReferer(req) {
  const hostHeader = req.headers['x-forwarded-host'] || (req.get && req.get('host')) || '';
  const siteHost = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');
  if (!siteHost) return false;

  const refererRaw = req.headers.referer || req.headers.origin || '';
  const referer = String(Array.isArray(refererRaw) ? refererRaw[0] : refererRaw).trim();
  if (!referer) return false;

  try {
    const refHost = new URL(referer).hostname.toLowerCase();
    if (refHost === siteHost) return true;
    if (refHost.endsWith('.vercel.app') && siteHost.endsWith('.vercel.app')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

module.exports = {
  checkRateLimit,
  clientIp,
  isSameSiteReferer,
};
