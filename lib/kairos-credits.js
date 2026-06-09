/**
 * 解析クレジット台帳（5回セット / 都度1回）。
 * 永続化: lib/kairos-credits-ledger.js（Postgres または Stripe Customer）
 * 開発用フォールバック: 同一プロセス内インメモリ
 */
const ledger = require('./kairos-credits-ledger');

const CREDITS_BY_PLAN = ledger.CREDITS_BY_PLAN;

/** @type {import('stripe')|null} */
let stripeClient = null;

/** @type {Map<string, { credits: number, updatedAt: string }>} */
const balances = new Map();

/** @type {Set<string>} */
const grantedSessions = new Set();

/** @type {Set<string>} */
const consumedKeys = new Set();

const MAX_USERS = 2000;

function setStripeClient(stripe) {
  stripeClient = stripe || null;
}

function usePersistentLedger() {
  return ledger.usePg() || Boolean(stripeClient);
}

function pruneBalances() {
  if (balances.size <= MAX_USERS) return;
  const sorted = [...balances.entries()].sort((a, b) =>
    String(a[1].updatedAt).localeCompare(String(b[1].updatedAt)),
  );
  const remove = balances.size - MAX_USERS + 100;
  for (let i = 0; i < remove && i < sorted.length; i += 1) {
    balances.delete(sorted[i][0]);
  }
}

function normalizeUserId(raw) {
  return ledger.normalizeUserId(raw);
}

function creditsForPlan(plan) {
  return ledger.creditsForPlan(plan);
}

function getMemoryBalance(kairosUserId) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid) return 0;
  const row = balances.get(uid);
  return row && Number.isFinite(row.credits) ? Math.max(0, row.credits) : 0;
}

function setMemoryBalance(kairosUserId, amount) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid || !Number.isFinite(amount)) return;
  balances.set(uid, {
    credits: Math.max(0, amount),
    updatedAt: new Date().toISOString(),
  });
  pruneBalances();
}

function memoryGrantFromSession(session) {
  if (!session || session.payment_status !== 'paid') {
    return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: null };
  }

  const sessionId = session.id;
  if (!sessionId) {
    return { granted: false, creditsAdded: 0, balance: 0, kairosUserId: null };
  }

  const meta = session.metadata || {};
  const kairosUserId =
    normalizeUserId(meta.kairosUserId) ||
    normalizeUserId(session.client_reference_id);
  const plan = meta.plan || null;
  const toAdd = creditsForPlan(plan);

  if (!kairosUserId || toAdd === 0) {
    return { granted: false, creditsAdded: 0, balance: 0, kairosUserId };
  }

  if (grantedSessions.has(sessionId)) {
    return {
      granted: false,
      creditsAdded: 0,
      balance: getMemoryBalance(kairosUserId),
      kairosUserId,
      duplicate: true,
    };
  }

  grantedSessions.add(sessionId);
  const balance = getMemoryBalance(kairosUserId) + toAdd;
  setMemoryBalance(kairosUserId, balance);

  return { granted: true, creditsAdded: toAdd, balance, kairosUserId, plan };
}

function memoryTryConsume(kairosUserId, consumeKey) {
  const uid = normalizeUserId(kairosUserId);
  const key = String(consumeKey || '').trim();
  if (!uid) return { ok: false, balance: 0, reason: 'invalid_user' };
  if (!key) return { ok: false, balance: getMemoryBalance(uid), reason: 'missing_consume_key' };

  if (consumedKeys.has(key)) {
    return { ok: true, balance: getMemoryBalance(uid), duplicate: true };
  }

  const current = getMemoryBalance(uid);
  if (current <= 0) {
    return { ok: false, balance: 0, reason: 'no_credits' };
  }

  setMemoryBalance(uid, current - 1);
  consumedKeys.add(key);
  return { ok: true, balance: getMemoryBalance(uid) };
}

/**
 * @param {string} kairosUserId
 * @returns {Promise<number>}
 */
async function getBalance(kairosUserId) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid) return 0;

  if (usePersistentLedger()) {
    const balance = await ledger.getBalance(stripeClient, uid);
    setMemoryBalance(uid, balance);
    return balance;
  }

  return getMemoryBalance(uid);
}

/**
 * @param {import('stripe').Stripe.Checkout.Session} session
 */
async function grantFromCheckoutSession(session) {
  if (usePersistentLedger()) {
    const result = await ledger.grantFromCheckoutSession(stripeClient, session);
    if (result.kairosUserId) {
      setMemoryBalance(result.kairosUserId, result.balance);
      if (session && session.id && result.granted) {
        grantedSessions.add(session.id);
      }
    }
    return result;
  }

  return memoryGrantFromSession(session);
}

/**
 * @returns {Promise<{ ok: boolean, balance: number, reason?: string, duplicate?: boolean }>}
 */
async function tryConsumeCredit(kairosUserId, consumeKey) {
  if (usePersistentLedger()) {
    const result = await ledger.tryConsumeCredit(stripeClient, kairosUserId, consumeKey);
    const uid = normalizeUserId(kairosUserId);
    if (uid) setMemoryBalance(uid, result.balance);
    return result;
  }

  return memoryTryConsume(kairosUserId, consumeKey);
}

function buildConsumeKey(kairosUserId, checkoutSessionId, analyzeRequestId) {
  if (analyzeRequestId) {
    return `req:${String(analyzeRequestId).slice(0, 120)}`;
  }
  if (checkoutSessionId) {
    return `cs:${checkoutSessionId}`;
  }
  return `uid:${kairosUserId}:${Date.now()}`;
}

async function ensureStripeCustomerId(kairosUserId) {
  if (!stripeClient) return null;
  return ledger.ensureStripeCustomerId(stripeClient, kairosUserId);
}

async function getLastGrantPlan(kairosUserId) {
  if (!usePersistentLedger()) return null;
  return ledger.getLastGrantPlan(stripeClient, kairosUserId);
}

/**
 * @param {string} kairosUserId
 * @param {string} grantKey
 * @param {number} [credits]
 */
async function grantBonusCredits(kairosUserId, grantKey, credits) {
  const result = await ledger.grantBonusCredits(stripeClient, kairosUserId, grantKey, credits);
  const uid = normalizeUserId(kairosUserId);
  if (uid && Number.isFinite(result.balance)) {
    setMemoryBalance(uid, result.balance);
  }
  return result;
}

module.exports = {
  CREDITS_BY_PLAN,
  setStripeClient,
  normalizeUserId,
  creditsForPlan,
  getBalance,
  grantFromCheckoutSession,
  grantBonusCredits,
  tryConsumeCredit,
  buildConsumeKey,
  ensureStripeCustomerId,
  getLastGrantPlan,
};
