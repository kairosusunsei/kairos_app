/**
 * 解析クレジットの永続台帳（Vercel マルチインスタンス対応）。
 * 優先: Postgres (DATABASE_URL) → Stripe Customer metadata → 呼び出し元のインメモリ
 */
const { Pool } = require('pg');

const META_USER = 'kairos_user_id';
const META_BALANCE = 'kairos_credit_balance';
const META_CONSUME_KEYS = 'kairos_consume_keys';
const META_LAST_PLAN = 'kairos_last_plan';
const SESSION_GRANT_FLAG = 'kairos_grant_applied';

const CREDITS_BY_PLAN = {
  single: 1,
  bundle: 5,
};

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

function creditsForPlan(plan) {
  const n = CREDITS_BY_PLAN[String(plan || '')];
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeUserId(raw) {
  const id = String(raw || '').trim();
  if (!id || id.length > 128) return null;
  if (!/^kairos_[a-z0-9_-]+$/i.test(id)) return null;
  return id;
}

function parseBalance(meta) {
  const n = parseInt(String(meta || '0'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseConsumeKeys(meta) {
  const raw = String(meta || '').trim();
  if (!raw) return [];
  return raw.split(',').map((k) => k.trim()).filter(Boolean);
}

async function ensurePgTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS kairos_credit_balances (
      kairos_user_id text PRIMARY KEY,
      credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS kairos_credit_grants (
      checkout_session_id text PRIMARY KEY,
      kairos_user_id text NOT NULL,
      credits_added integer NOT NULL CHECK (credits_added > 0),
      granted_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS kairos_credit_consumes (
      consume_key text PRIMARY KEY,
      kairos_user_id text NOT NULL,
      consumed_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function pgGetBalance(uid) {
  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTables(client);
    const res = await client.query(
      'SELECT credits FROM kairos_credit_balances WHERE kairos_user_id = $1',
      [uid],
    );
    return res.rows[0] ? Math.max(0, res.rows[0].credits) : 0;
  } finally {
    client.release();
  }
}

async function pgGrant(uid, sessionId, toAdd) {
  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTables(client);
    await client.query('BEGIN');
    const dup = await client.query(
      'SELECT 1 FROM kairos_credit_grants WHERE checkout_session_id = $1',
      [sessionId],
    );
    if (dup.rowCount > 0) {
      await client.query('COMMIT');
      return { granted: false, balance: await pgGetBalance(uid), duplicate: true };
    }
    await client.query(
      `INSERT INTO kairos_credit_grants (checkout_session_id, kairos_user_id, credits_added)
       VALUES ($1, $2, $3)`,
      [sessionId, uid, toAdd],
    );
    await client.query(
      `INSERT INTO kairos_credit_balances (kairos_user_id, credits, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (kairos_user_id) DO UPDATE SET
         credits = kairos_credit_balances.credits + EXCLUDED.credits,
         updated_at = now()`,
      [uid, toAdd],
    );
    await client.query('COMMIT');
    return { granted: true, balance: await pgGetBalance(uid) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function pgConsume(uid, consumeKey) {
  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTables(client);
    await client.query('BEGIN');
    const dup = await client.query(
      'SELECT 1 FROM kairos_credit_consumes WHERE consume_key = $1',
      [consumeKey],
    );
    if (dup.rowCount > 0) {
      await client.query('COMMIT');
      return { ok: true, balance: await pgGetBalance(uid), duplicate: true };
    }
    const balRes = await client.query(
      'SELECT credits FROM kairos_credit_balances WHERE kairos_user_id = $1 FOR UPDATE',
      [uid],
    );
    const current = balRes.rows[0] ? balRes.rows[0].credits : 0;
    if (current <= 0) {
      await client.query('ROLLBACK');
      return { ok: false, balance: 0, reason: 'no_credits' };
    }
    await client.query(
      'INSERT INTO kairos_credit_consumes (consume_key, kairos_user_id) VALUES ($1, $2)',
      [consumeKey, uid],
    );
    await client.query(
      `UPDATE kairos_credit_balances SET credits = credits - 1, updated_at = now()
       WHERE kairos_user_id = $1`,
      [uid],
    );
    await client.query('COMMIT');
    return { ok: true, balance: await pgGetBalance(uid) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function stripeFindCustomer(stripe, uid) {
  try {
    const result = await stripe.customers.search({
      query: `metadata['${META_USER}']:'${uid}'`,
      limit: 1,
    });
    return result.data[0] || null;
  } catch (err) {
    console.error('[kairos_credits_ledger] customer search failed', err.message);
    return null;
  }
}

async function stripeEnsureCustomer(stripe, uid) {
  const existing = await stripeFindCustomer(stripe, uid);
  if (existing) return existing;
  return stripe.customers.create({
    metadata: {
      [META_USER]: uid,
      [META_BALANCE]: '0',
      [META_CONSUME_KEYS]: '',
    },
  });
}

async function stripeGetBalance(stripe, uid) {
  const customer = await stripeFindCustomer(stripe, uid);
  if (!customer) return 0;
  return parseBalance(customer.metadata && customer.metadata[META_BALANCE]);
}

async function stripeMarkSessionGranted(stripe, sessionId, existingMeta) {
  try {
    await stripe.checkout.sessions.update(sessionId, {
      metadata: {
        ...(existingMeta || {}),
        [SESSION_GRANT_FLAG]: '1',
      },
    });
  } catch (err) {
    console.error('[kairos_credits_ledger] session grant flag update failed', err.message);
  }
}

async function stripeReconcileGrants(stripe, uid) {
  let startingAfter;
  let grantTotal = 0;
  for (let page = 0; page < 5; page += 1) {
    const list = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'complete',
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (!list.data.length) break;
    for (const session of list.data) {
      const meta = session.metadata || {};
      const sessionUid =
        normalizeUserId(meta.kairosUserId) ||
        normalizeUserId(session.client_reference_id);
      if (sessionUid !== uid || session.payment_status !== 'paid') continue;
      if (meta[SESSION_GRANT_FLAG] === '1') continue;
      const toAdd = creditsForPlan(meta.plan);
      if (toAdd <= 0) continue;
      const customer = await stripeEnsureCustomer(stripe, uid);
      const prev = parseBalance(customer.metadata && customer.metadata[META_BALANCE]);
      await stripe.customers.update(customer.id, {
        metadata: {
          ...(customer.metadata || {}),
          [META_USER]: uid,
          [META_BALANCE]: String(prev + toAdd),
          [META_LAST_PLAN]: String(meta.plan || ''),
        },
      });
      await stripeMarkSessionGranted(stripe, session.id, meta);
      grantTotal += toAdd;
    }
    if (!list.has_more) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return grantTotal;
}

async function stripeGrant(stripe, session) {
  const sessionId = session.id;
  const meta = session.metadata || {};
  const uid =
    normalizeUserId(meta.kairosUserId) ||
    normalizeUserId(session.client_reference_id);
  const toAdd = creditsForPlan(meta.plan);
  if (!uid || toAdd <= 0) {
    return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: uid };
  }
  if (meta[SESSION_GRANT_FLAG] === '1') {
    return {
      granted: false,
      creditsAdded: 0,
      balance: await stripeGetBalance(stripe, uid),
      kairosUserId: uid,
      duplicate: true,
    };
  }

  const customer = await stripeEnsureCustomer(stripe, uid);
  const prev = parseBalance(customer.metadata && customer.metadata[META_BALANCE]);
  const balance = prev + toAdd;
  await stripe.customers.update(customer.id, {
    metadata: {
      ...(customer.metadata || {}),
      [META_USER]: uid,
      [META_BALANCE]: String(balance),
      [META_LAST_PLAN]: String(meta.plan || ''),
    },
  });
  await stripeMarkSessionGranted(stripe, sessionId, meta);

  return { granted: true, creditsAdded: toAdd, balance, kairosUserId: uid, plan: meta.plan };
}

function planFromCreditsAdded(creditsAdded) {
  if (creditsAdded === CREDITS_BY_PLAN.bundle) return 'bundle';
  if (creditsAdded === CREDITS_BY_PLAN.single) return 'single';
  return null;
}

async function pgGetLastGrantPlan(uid) {
  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTables(client);
    const res = await client.query(
      `SELECT credits_added FROM kairos_credit_grants
       WHERE kairos_user_id = $1
       ORDER BY granted_at DESC
       LIMIT 1`,
      [uid],
    );
    if (!res.rows[0]) return null;
    return planFromCreditsAdded(res.rows[0].credits_added);
  } finally {
    client.release();
  }
}

async function stripeGetLastGrantPlan(stripe, uid) {
  const customer = await stripeFindCustomer(stripe, uid);
  if (!customer) return null;
  const plan = customer.metadata && customer.metadata[META_LAST_PLAN];
  const normalized = String(plan || '').trim();
  if (normalized === 'bundle' || normalized === 'single' || normalized === 'subscription') {
    return normalized;
  }
  return null;
}

async function stripeConsume(stripe, uid, consumeKey) {
  const customer = await stripeFindCustomer(stripe, uid);
  if (!customer) return { ok: false, balance: 0, reason: 'no_customer' };

  const meta = customer.metadata || {};
  const keys = parseConsumeKeys(meta[META_CONSUME_KEYS]);
  if (keys.includes(consumeKey)) {
    return { ok: true, balance: parseBalance(meta[META_BALANCE]), duplicate: true };
  }

  const bal = parseBalance(meta[META_BALANCE]);
  if (bal <= 0) return { ok: false, balance: 0, reason: 'no_credits' };

  const nextKeys = [...keys, consumeKey].slice(-40);
  await stripe.customers.update(customer.id, {
    metadata: {
      ...meta,
      [META_USER]: uid,
      [META_BALANCE]: String(bal - 1),
      [META_CONSUME_KEYS]: nextKeys.join(','),
    },
  });
  return { ok: true, balance: bal - 1 };
}

/**
 * @param {import('stripe')|null} stripe
 * @param {string} kairosUserId
 */
async function getBalance(stripe, kairosUserId) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid) return 0;

  if (usePg()) {
    return pgGetBalance(uid);
  }

  if (stripe) {
    let balance = await stripeGetBalance(stripe, uid);
    if (balance <= 0) {
      await stripeReconcileGrants(stripe, uid);
      balance = await stripeGetBalance(stripe, uid);
    }
    return balance;
  }

  return 0;
}

/**
 * @param {import('stripe')|null} stripe
 * @param {import('stripe').Stripe.Checkout.Session} session
 */
/**
 * 紹介ボーナス等、Checkout 以外の付与（冪等キーは grantKey で一意）。
 * @param {import('stripe')|null} stripe
 * @param {string} kairosUserId
 * @param {string} grantKey 例: referral_cs_xxx
 * @param {number} [creditsToAdd]
 */
async function grantBonusCredits(stripe, kairosUserId, grantKey, creditsToAdd = 1) {
  const uid = normalizeUserId(kairosUserId);
  const key = String(grantKey || '').trim().slice(0, 128);
  const toAdd = Number.isFinite(creditsToAdd) && creditsToAdd > 0 ? Math.floor(creditsToAdd) : 0;
  if (!uid || !key || toAdd <= 0) {
    return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: uid, reason: 'invalid' };
  }

  if (usePg()) {
    const result = await pgGrant(uid, key, toAdd);
    return {
      granted: result.granted,
      creditsAdded: result.granted ? toAdd : 0,
      balance: result.balance,
      kairosUserId: uid,
      duplicate: result.duplicate,
      grantKey: key,
    };
  }

  if (stripe) {
    const customer = await stripeEnsureCustomer(stripe, uid);
    const meta = customer.metadata || {};
    const keys = parseConsumeKeys(meta.kairos_referral_grant_keys);
    if (keys.includes(key)) {
      return {
        granted: false,
        creditsAdded: 0,
        balance: parseBalance(meta[META_BALANCE]),
        kairosUserId: uid,
        duplicate: true,
        grantKey: key,
      };
    }
    const prev = parseBalance(meta[META_BALANCE]);
    const balance = prev + toAdd;
    keys.push(key);
    const trimmed = keys.slice(-80);
    await stripe.customers.update(customer.id, {
      metadata: {
        ...meta,
        [META_USER]: uid,
        [META_BALANCE]: String(balance),
        kairos_referral_grant_keys: trimmed.join(','),
      },
    });
    return { granted: true, creditsAdded: toAdd, balance, kairosUserId: uid, grantKey: key };
  }

  return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: uid, reason: 'ledger_unavailable' };
}

async function grantFromCheckoutSession(stripe, session) {
  if (!session || session.payment_status !== 'paid') {
    return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: null };
  }

  const meta = session.metadata || {};
  const uid =
    normalizeUserId(meta.kairosUserId) ||
    normalizeUserId(session.client_reference_id);
  const toAdd = creditsForPlan(meta.plan);

  if (!uid || toAdd === 0) {
    return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: uid };
  }

  if (usePg()) {
    const result = await pgGrant(uid, session.id, toAdd);
    return {
      granted: result.granted,
      creditsAdded: result.granted ? toAdd : 0,
      balance: result.balance,
      kairosUserId: uid,
      plan: meta.plan,
      duplicate: result.duplicate,
    };
  }

  if (stripe) {
    return stripeGrant(stripe, session);
  }

  return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: uid };
}

/**
 * @param {import('stripe')|null} stripe
 */
async function tryConsumeCredit(stripe, kairosUserId, consumeKey) {
  const uid = normalizeUserId(kairosUserId);
  const key = String(consumeKey || '').trim();
  if (!uid) return { ok: false, balance: 0, reason: 'invalid_user' };
  if (!key) return { ok: false, balance: 0, reason: 'missing_consume_key' };

  if (usePg()) {
    return pgConsume(uid, key);
  }

  if (stripe) {
    return stripeConsume(stripe, uid, key);
  }

  return { ok: false, balance: 0, reason: 'ledger_unavailable' };
}

/**
 * Checkout 用 Stripe Customer ID（決済と残高を同一顧客に紐付け）
 * @param {import('stripe')} stripe
 */
async function ensureStripeCustomerId(stripe, kairosUserId) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid || !stripe) return null;
  const customer = await stripeEnsureCustomer(stripe, uid);
  return customer.id;
}

/**
 * 直近の付与プラン（クレジット使い切り時の UI 文言用）
 * @param {import('stripe')|null} stripe
 * @param {string} kairosUserId
 * @returns {Promise<string|null>}
 */
async function getLastGrantPlan(stripe, kairosUserId) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid) return null;
  if (usePg()) {
    return pgGetLastGrantPlan(uid);
  }
  if (stripe) {
    return stripeGetLastGrantPlan(stripe, uid);
  }
  return null;
}

module.exports = {
  CREDITS_BY_PLAN,
  normalizeUserId,
  creditsForPlan,
  usePg,
  getBalance,
  grantBonusCredits,
  grantFromCheckoutSession,
  tryConsumeCredit,
  ensureStripeCustomerId,
  getLastGrantPlan,
};
