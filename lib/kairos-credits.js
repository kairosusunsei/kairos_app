/**
 * 解析クレジット台帳（5回セット / 都度1回）。
 * 決済セッション ID ごとに付与を一度だけ記録（Webhook 未到着時の API 照会でも同じ）。
 * Vercel インメモリ — 同一ユーザー ID はブラウザ localStorage の kairos_user_id で紐付け。
 */

const CREDITS_BY_PLAN = {
  single: 1,
  bundle: 5,
};

/** @type {Map<string, { credits: number, updatedAt: string }>} */
const balances = new Map();

/** @type {Set<string>} checkout session ids that already triggered a grant */
const grantedSessions = new Set();

/** @type {Set<string>} consume keys (idempotent analyze) */
const consumedKeys = new Set();

const MAX_USERS = 2000;

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
  const id = String(raw || '').trim();
  if (!id || id.length > 128) return null;
  if (!/^kairos_[a-z0-9_-]+$/i.test(id)) return null;
  return id;
}

function creditsForPlan(plan) {
  const n = CREDITS_BY_PLAN[String(plan || '')];
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getBalance(kairosUserId) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid) return 0;
  const row = balances.get(uid);
  return row && Number.isFinite(row.credits) ? Math.max(0, row.credits) : 0;
}

function addCredits(kairosUserId, amount) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid || !Number.isFinite(amount) || amount <= 0) return getBalance(uid);

  const prev = getBalance(uid);
  const next = prev + amount;
  balances.set(uid, { credits: next, updatedAt: new Date().toISOString() });
  pruneBalances();
  return next;
}

/**
 * Stripe Checkout 完了時にクレジット付与（冪等: 同一 session.id は1回のみ）。
 * @param {import('stripe').Stripe.Checkout.Session} session
 * @returns {{ granted: boolean, creditsAdded: number, balance: number, kairosUserId: string|null }}
 */
function grantFromCheckoutSession(session) {
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
      balance: getBalance(kairosUserId),
      kairosUserId,
      duplicate: true,
    };
  }

  grantedSessions.add(sessionId);
  const balance = addCredits(kairosUserId, toAdd);

  console.log('[kairos_credits] granted', {
    sessionId,
    kairosUserId,
    plan,
    creditsAdded: toAdd,
    balance,
  });

  return { granted: true, creditsAdded: toAdd, balance, kairosUserId, plan };
}

/**
 * フル解析1回分を消費（成功後にのみ呼ぶこと）。同一 consumeKey は二重消費しない。
 * @returns {{ ok: boolean, balance: number, reason?: string }}
 */
function tryConsumeCredit(kairosUserId, consumeKey) {
  const uid = normalizeUserId(kairosUserId);
  if (!uid) return { ok: false, balance: 0, reason: 'invalid_user' };

  const key = String(consumeKey || '').trim();
  if (!key) return { ok: false, balance: getBalance(uid), reason: 'missing_consume_key' };

  if (consumedKeys.has(key)) {
    return { ok: true, balance: getBalance(uid), duplicate: true };
  }

  const current = getBalance(uid);
  if (current <= 0) {
    return { ok: false, balance: 0, reason: 'no_credits' };
  }

  balances.set(uid, {
    credits: current - 1,
    updatedAt: new Date().toISOString(),
  });
  consumedKeys.add(key);

  const balance = getBalance(uid);
  console.log('[kairos_credits] consumed', { kairosUserId: uid, consumeKey: key, balance });
  return { ok: true, balance };
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

module.exports = {
  CREDITS_BY_PLAN,
  normalizeUserId,
  creditsForPlan,
  getBalance,
  grantFromCheckoutSession,
  tryConsumeCredit,
  buildConsumeKey,
};
