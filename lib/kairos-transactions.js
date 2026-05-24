/**
 * Minimal paid-session ledger (kairos_transactions equivalent).
 * In-memory on Vercel serverless — survives warm instances only.
 * Authoritative payment proof: Stripe checkout.sessions.retrieve in api/index.js.
 */

/** @type {Map<string, object>} */
const paidSessions = new Map();

const MAX_ENTRIES = 500;

function pruneIfNeeded() {
  if (paidSessions.size <= MAX_ENTRIES) return;
  const oldest = [...paidSessions.entries()].sort(
    (a, b) => String(a[1].paidAt).localeCompare(String(b[1].paidAt)),
  );
  const removeCount = paidSessions.size - MAX_ENTRIES + 50;
  for (let i = 0; i < removeCount && i < oldest.length; i += 1) {
    paidSessions.delete(oldest[i][0]);
  }
}

/**
 * @param {import('stripe').Stripe.Checkout.Session} session
 */
function recordPaidSession(session) {
  if (!session || !session.id) return null;
  if (session.payment_status !== 'paid') return null;

  const record = {
    sessionId: session.id,
    plan: (session.metadata && session.metadata.plan) || null,
    paymentStatus: session.payment_status,
    mode: session.mode || null,
    amountTotal: session.amount_total,
    currency: session.currency,
    paidAt: new Date().toISOString(),
  };

  paidSessions.set(session.id, record);
  pruneIfNeeded();
  return record;
}

function getPaidSession(sessionId) {
  if (!sessionId) return null;
  return paidSessions.get(sessionId) || null;
}

function isPaid(sessionId) {
  const rec = getPaidSession(sessionId);
  return !!(rec && rec.paymentStatus === 'paid');
}

function listRecent(limit = 20) {
  return [...paidSessions.values()]
    .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)))
    .slice(0, limit);
}

module.exports = {
  recordPaidSession,
  getPaidSession,
  isPaid,
  listRecent,
};
