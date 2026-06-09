/**
 * 紹介トラッキング（Postgres 永続 + インメモリ fallback）。
 * ?ref=kairos_xxx を訪問・決済に紐付け。スパム的な自動投稿は行わない。
 */
const { Pool } = require('pg');

/** @type {Map<string, { visits: number, conversions: number, revenueJpy: number, lastAt: string }>} */
const byReferrer = new Map();

const MAX_REFERRERS = 5000;

let pool = null;

function usePg() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!usePg()) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

function normalizeReferralCode(raw) {
  const code = String(raw || '').trim().slice(0, 64);
  if (!code) return null;
  if (!/^kairos_[a-z0-9_-]+$/i.test(code)) return null;
  return code;
}

function prune() {
  if (byReferrer.size <= MAX_REFERRERS) return;
  const sorted = [...byReferrer.entries()].sort((a, b) =>
    String(a[1].lastAt).localeCompare(String(b[1].lastAt)),
  );
  const remove = byReferrer.size - MAX_REFERRERS + 100;
  for (let i = 0; i < remove && i < sorted.length; i += 1) {
    byReferrer.delete(sorted[i][0]);
  }
}

function touchReferrerMemory(code) {
  const row = byReferrer.get(code) || { visits: 0, conversions: 0, revenueJpy: 0, lastAt: '' };
  row.lastAt = new Date().toISOString();
  byReferrer.set(code, row);
  prune();
  return row;
}

async function ensurePgTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS kairos_referral_stats (
      referral_code text PRIMARY KEY,
      visits bigint NOT NULL DEFAULT 0,
      conversions bigint NOT NULL DEFAULT 0,
      revenue_jpy bigint NOT NULL DEFAULT 0,
      last_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS kairos_referral_conversions (
      checkout_session_id text PRIMARY KEY,
      referral_code text NOT NULL,
      plan text,
      amount_jpy integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS kairos_referral_conversions_code_idx
    ON kairos_referral_conversions (referral_code, created_at DESC);
  `);
}

async function recordVisitPg(code) {
  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTables(client);
    const ins = await client.query(
      `INSERT INTO kairos_referral_stats (referral_code, visits, last_at)
       VALUES ($1, 1, now())
       ON CONFLICT (referral_code) DO UPDATE SET
         visits = kairos_referral_stats.visits + 1,
         last_at = now()
       RETURNING visits, conversions, revenue_jpy`,
      [code],
    );
    const row = ins.rows[0];
    return {
      ok: true,
      referralCode: code,
      visits: Number(row.visits),
      conversions: Number(row.conversions),
      revenueJpy: Number(row.revenue_jpy),
      storage: 'postgres',
    };
  } finally {
    client.release();
  }
}

function recordVisitMemory(code) {
  const row = touchReferrerMemory(code);
  row.visits += 1;
  return { ok: true, referralCode: code, visits: row.visits, storage: 'memory' };
}

async function recordVisit(referralCode) {
  const code = normalizeReferralCode(referralCode);
  if (!code) return { ok: false, reason: 'invalid_code' };
  if (usePg()) {
    try {
      return await recordVisitPg(code);
    } catch (err) {
      console.error('[referral-attribution] recordVisit pg failed, fallback memory', err.message);
    }
  }
  return recordVisitMemory(code);
}

/**
 * @param {string} referralCode
 * @param {{ amountJpy?: number, plan?: string, sessionId?: string }} meta
 */
async function recordConversionPg(code, meta) {
  const sessionId = meta && meta.sessionId ? String(meta.sessionId).trim() : '';
  if (!sessionId) {
    const p = getPool();
    const client = await p.connect();
    try {
      await ensurePgTables(client);
      const amount = Number(meta && meta.amountJpy);
      const amountJpy = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
      const upsert = await client.query(
        `INSERT INTO kairos_referral_stats (referral_code, conversions, revenue_jpy, last_at)
         VALUES ($1, 1, $2, now())
         ON CONFLICT (referral_code) DO UPDATE SET
           conversions = kairos_referral_stats.conversions + 1,
           revenue_jpy = kairos_referral_stats.revenue_jpy + $2,
           last_at = now()
         RETURNING visits, conversions, revenue_jpy`,
        [code, amountJpy],
      );
      const row = upsert.rows[0];
      return {
        ok: true,
        referralCode: code,
        conversions: Number(row.conversions),
        revenueJpy: Number(row.revenue_jpy),
        skipped: 'no_session_id',
        storage: 'postgres',
      };
    } finally {
      client.release();
    }
  }

  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTables(client);
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT 1 FROM kairos_referral_conversions WHERE checkout_session_id = $1`,
      [sessionId],
    );
    if (dup.rowCount > 0) {
      await client.query('ROLLBACK');
      const cur = await client.query(
        `SELECT visits, conversions, revenue_jpy FROM kairos_referral_stats WHERE referral_code = $1`,
        [code],
      );
      const row = cur.rows[0] || { visits: 0, conversions: 0, revenue_jpy: 0 };
      return {
        ok: true,
        referralCode: code,
        conversions: Number(row.conversions),
        revenueJpy: Number(row.revenue_jpy),
        duplicate: true,
        sessionId,
        storage: 'postgres',
      };
    }

    const amount = Number(meta && meta.amountJpy);
    const amountJpy = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
    const plan = meta && meta.plan ? String(meta.plan).slice(0, 32) : null;

    await client.query(
      `INSERT INTO kairos_referral_conversions (checkout_session_id, referral_code, plan, amount_jpy)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, code, plan, amountJpy],
    );

    const upsert = await client.query(
      `INSERT INTO kairos_referral_stats (referral_code, conversions, revenue_jpy, last_at)
       VALUES ($1, 1, $2, now())
       ON CONFLICT (referral_code) DO UPDATE SET
         conversions = kairos_referral_stats.conversions + 1,
         revenue_jpy = kairos_referral_stats.revenue_jpy + $2,
         last_at = now()
       RETURNING visits, conversions, revenue_jpy`,
      [code, amountJpy],
    );

    await client.query('COMMIT');
    const row = upsert.rows[0];
    return {
      ok: true,
      referralCode: code,
      conversions: Number(row.conversions),
      revenueJpy: Number(row.revenue_jpy),
      sessionId,
      plan,
      storage: 'postgres',
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function recordConversionMemory(code, meta) {
  const row = touchReferrerMemory(code);
  row.conversions += 1;
  const amount = Number(meta && meta.amountJpy);
  if (Number.isFinite(amount) && amount > 0) {
    row.revenueJpy += amount;
  }
  return {
    ok: true,
    referralCode: code,
    conversions: row.conversions,
    revenueJpy: row.revenueJpy,
    sessionId: meta && meta.sessionId,
    plan: meta && meta.plan,
    storage: 'memory',
  };
}

async function recordConversion(referralCode, meta) {
  const code = normalizeReferralCode(referralCode);
  if (!code) return { ok: false, reason: 'invalid_code' };
  if (usePg()) {
    try {
      return await recordConversionPg(code, meta || {});
    } catch (err) {
      console.error('[referral-attribution] recordConversion pg failed, fallback memory', err.message);
    }
  }
  return recordConversionMemory(code, meta || {});
}

async function getSummaryPg() {
  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTables(client);
    const agg = await client.query(`
      SELECT
        COALESCE(SUM(visits), 0)::bigint AS visits,
        COALESCE(SUM(conversions), 0)::bigint AS conversions,
        COALESCE(SUM(revenue_jpy), 0)::bigint AS revenue_jpy
      FROM kairos_referral_stats
    `);
    const totals = {
      visits: Number(agg.rows[0].visits),
      conversions: Number(agg.rows[0].conversions),
      revenueJpy: Number(agg.rows[0].revenue_jpy),
    };

    const top = await client.query(`
      SELECT referral_code, visits, conversions, revenue_jpy, last_at
      FROM kairos_referral_stats
      ORDER BY conversions DESC, visits DESC
      LIMIT 50
    `);

    const referrers = top.rows.map((r) => ({
      referralCode: r.referral_code,
      visits: Number(r.visits),
      conversions: Number(r.conversions),
      revenueJpy: Number(r.revenue_jpy),
      lastAt: r.last_at ? new Date(r.last_at).toISOString() : '',
    }));

    return { totals, referrers, storage: 'postgres' };
  } finally {
    client.release();
  }
}

function getSummaryMemory() {
  const referrers = [...byReferrer.entries()]
    .map(([code, row]) => ({
      referralCode: code,
      visits: row.visits,
      conversions: row.conversions,
      revenueJpy: row.revenueJpy,
      lastAt: row.lastAt,
    }))
    .sort((a, b) => b.conversions - a.conversions || b.visits - a.visits);

  const totals = referrers.reduce(
    (acc, r) => {
      acc.visits += r.visits;
      acc.conversions += r.conversions;
      acc.revenueJpy += r.revenueJpy;
      return acc;
    },
    { visits: 0, conversions: 0, revenueJpy: 0 },
  );

  return { totals, referrers: referrers.slice(0, 50), storage: 'memory' };
}

async function getSummary() {
  if (usePg()) {
    try {
      return await getSummaryPg();
    } catch (err) {
      console.error('[referral-attribution] getSummary pg failed, fallback memory', err.message);
    }
  }
  return getSummaryMemory();
}

module.exports = {
  normalizeReferralCode,
  recordVisit,
  recordConversion,
  getSummary,
  usePg,
};
