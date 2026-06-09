/**
 * 紹介リワード: 友だちの有料決済完了時に招待者へ +1 解析クレジット（1段・自動）。
 * Postgres 必須推奨（DATABASE_URL）。悪用防止: 自己紹介・重複・日次上限。
 */
const { Pool } = require('pg');
const referralAttribution = require('./referral-attribution');
const ledger = require('./kairos-credits-ledger');

const REWARD_CREDITS = 1;
const DAILY_CAP_PER_REFERRER = 20;
const ELIGIBLE_PLANS = new Set(['single', 'bundle']);

let pool = null;

function usePg() {
  return ledger.usePg();
}

function getPool() {
  if (!usePg()) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

async function ensureReferralTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS kairos_referral_rewards (
      grant_key text PRIMARY KEY,
      referrer_user_id text NOT NULL,
      buyer_user_id text,
      checkout_session_id text NOT NULL UNIQUE,
      plan text,
      amount_jpy integer,
      credits_added integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS kairos_referral_rewards_referrer_day
    ON kairos_referral_rewards (referrer_user_id, created_at DESC);
  `);
}

function startOfUtcDay() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function grantKeyForSession(sessionId) {
  return `referral_${String(sessionId || '').slice(0, 120)}`;
}

function buyerIdFromSession(session) {
  const meta = (session && session.metadata) || {};
  return (
    ledger.normalizeUserId(meta.kairosUserId) ||
    ledger.normalizeUserId(session && session.client_reference_id)
  );
}

async function countReferrerRewardsToday(referrerId) {
  if (!usePg()) return 0;
  const p = getPool();
  const client = await p.connect();
  try {
    await ensureReferralTables(client);
    const res = await client.query(
      `SELECT COUNT(*)::int AS n FROM kairos_referral_rewards
       WHERE referrer_user_id = $1 AND created_at >= $2::timestamptz`,
      [referrerId, startOfUtcDay()],
    );
    return res.rows[0] ? res.rows[0].n : 0;
  } finally {
    client.release();
  }
}

async function recordReferralRewardRow(client, row) {
  await client.query(
    `INSERT INTO kairos_referral_rewards (
      grant_key, referrer_user_id, buyer_user_id, checkout_session_id, plan, amount_jpy, credits_added
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (grant_key) DO NOTHING`,
    [
      row.grantKey,
      row.referrerId,
      row.buyerId,
      row.sessionId,
      row.plan,
      row.amountJpy,
      row.creditsAdded,
    ],
  );
}

/**
 * @param {import('stripe')|null} stripe
 * @param {import('stripe').Stripe.Checkout.Session} session
 */
async function processReferralReward(stripe, session) {
  if (!session || session.payment_status !== 'paid') {
    return { ok: false, reason: 'not_paid' };
  }

  const refCode = referralAttribution.normalizeReferralCode(
    session.metadata && session.metadata.referralCode,
  );
  if (!refCode) {
    return { ok: false, reason: 'no_referral' };
  }

  const plan = String((session.metadata && session.metadata.plan) || '').trim();
  if (!ELIGIBLE_PLANS.has(plan)) {
    return { ok: false, reason: 'plan_not_eligible', plan };
  }

  const buyerId = buyerIdFromSession(session);
  if (!buyerId) {
    return { ok: false, reason: 'no_buyer_id' };
  }

  if (refCode.toLowerCase() === buyerId.toLowerCase()) {
    return { ok: false, reason: 'self_referral' };
  }

  const sessionId = session.id;
  if (!sessionId) {
    return { ok: false, reason: 'no_session_id' };
  }

  const grantKey = grantKeyForSession(sessionId);

  if (usePg()) {
    const todayCount = await countReferrerRewardsToday(refCode);
    if (todayCount >= DAILY_CAP_PER_REFERRER) {
      return { ok: false, reason: 'daily_cap', referrerId: refCode, todayCount };
    }
  }

  const grant = await ledger.grantBonusCredits(stripe, refCode, grantKey, REWARD_CREDITS);

  if (usePg() && grant.granted) {
    const p = getPool();
    const client = await p.connect();
    try {
      await ensureReferralTables(client);
      await recordReferralRewardRow(client, {
        grantKey,
        referrerId: refCode,
        buyerId,
        sessionId,
        plan,
        amountJpy: Number(session.amount_total) || 0,
        creditsAdded: REWARD_CREDITS,
      });
    } finally {
      client.release();
    }
  }

  if (grant.granted) {
    console.log('[referral_reward] granted', {
      referrerId: refCode,
      buyerId,
      sessionId,
      balance: grant.balance,
    });
  }

  return {
    ok: grant.granted,
    reason: grant.granted ? 'granted' : grant.duplicate ? 'duplicate' : grant.reason || 'not_granted',
    referrerId: refCode,
    buyerId,
    creditsAdded: grant.creditsAdded,
    balance: grant.balance,
    duplicate: grant.duplicate,
  };
}

async function getReferrerRewardStats(referrerId) {
  const uid = referralAttribution.normalizeReferralCode(referrerId);
  if (!uid) return { ok: false, reason: 'invalid_referrer' };
  if (!usePg()) {
    return { ok: true, referrerId: uid, totalRewards: null, todayRewards: null, persistent: false };
  }
  const p = getPool();
  const client = await p.connect();
  try {
    await ensureReferralTables(client);
    const totalRes = await client.query(
      'SELECT COUNT(*)::int AS n FROM kairos_referral_rewards WHERE referrer_user_id = $1',
      [uid],
    );
    const todayRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM kairos_referral_rewards
       WHERE referrer_user_id = $1 AND created_at >= $2::timestamptz`,
      [uid, startOfUtcDay()],
    );
    return {
      ok: true,
      referrerId: uid,
      totalRewards: totalRes.rows[0].n,
      todayRewards: todayRes.rows[0].n,
      dailyCap: DAILY_CAP_PER_REFERRER,
      rewardCredits: REWARD_CREDITS,
      persistent: true,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  REWARD_CREDITS,
  DAILY_CAP_PER_REFERRER,
  ELIGIBLE_PLANS,
  processReferralReward,
  getReferrerRewardStats,
};
