/**
 * Checkout 直前の入力テキスト一時保持（sessionStorage 消失対策）。
 * Vercel serverless インメモリ — 同一 warm instance 内のみ有効。
 * 永続の正本: Stripe Checkout Session metadata.inputText
 */

const crypto = require('crypto');

/** @type {Map<string, object>} */
const pending = new Map();

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 200;

function prune() {
  const now = Date.now();
  for (const [id, rec] of pending) {
    if (now - rec.createdAt > TTL_MS) pending.delete(id);
  }
  if (pending.size <= MAX_ENTRIES) return;
  const sorted = [...pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const remove = pending.size - MAX_ENTRIES + 20;
  for (let i = 0; i < remove && i < sorted.length; i += 1) {
    pending.delete(sorted[i][0]);
  }
}

function createPending({ plan, locale, inputText }) {
  prune();
  const prepareId = crypto.randomBytes(16).toString('hex');
  pending.set(prepareId, {
    plan: String(plan || 'single'),
    locale: String(locale || 'ja'),
    inputText: String(inputText || '').slice(0, 500),
    createdAt: Date.now(),
  });
  return prepareId;
}

function consumePending(prepareId) {
  if (!prepareId) return null;
  prune();
  const rec = pending.get(prepareId);
  if (!rec) return null;
  if (Date.now() - rec.createdAt > TTL_MS) {
    pending.delete(prepareId);
    return null;
  }
  pending.delete(prepareId);
  return rec;
}

module.exports = { createPending, consumePending };
