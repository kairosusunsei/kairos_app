/**
 * 解析完了ステータス文言の分岐をオフライン検証（有料 Stripe 不要）
 */
const assert = require('assert');
const ledger = require('../lib/kairos-credits-ledger');

function planFromCreditsAdded(creditsAdded) {
  if (creditsAdded === ledger.CREDITS_BY_PLAN.bundle) return 'bundle';
  if (creditsAdded === ledger.CREDITS_BY_PLAN.single) return 'single';
  return null;
}

function resolveAnalyzeStatusMessage(payload, t) {
  if (!payload) return t('statusAnalyzed');
  if (payload.purchaseRequired) return t('creditsExhausted');
  if (typeof payload.creditsRemaining === 'number' && payload.creditsRemaining > 0) {
    return t('statusAnalyzedWithCredits').replace('{n}', String(payload.creditsRemaining));
  }
  if (payload.creditsRemaining === 0 && payload.lastGrantPlan === 'bundle') {
    return t('statusBundleExhausted');
  }
  if (payload.creditsRemaining === 0 && payload.lastGrantPlan === 'single') {
    return t('statusSingleExhausted');
  }
  return t('statusAnalyzed');
}

const ja = {
  statusAnalyzed: '解析が完了しました。',
  statusAnalyzedWithCredits: '解析完了。残り {n} 回',
  statusBundleExhausted:
    '解析完了。5回セットをすべて使用しました。続けるにはプランをご購入ください。',
  statusSingleExhausted:
    '解析完了。ご購入分の解析を使用しました。続けるにはプランをご購入ください。',
  creditsExhausted: '利用回数がありません。',
};

assert.strictEqual(planFromCreditsAdded(5), 'bundle');
assert.strictEqual(planFromCreditsAdded(1), 'single');
assert.strictEqual(planFromCreditsAdded(99), null);

assert.strictEqual(
  resolveAnalyzeStatusMessage({ creditsRemaining: 4, lastGrantPlan: 'bundle' }, (k) => ja[k]),
  '解析完了。残り 4 回',
);

assert.strictEqual(
  resolveAnalyzeStatusMessage({ creditsRemaining: 0, lastGrantPlan: 'bundle' }, (k) => ja[k]),
  ja.statusBundleExhausted,
);

assert.strictEqual(
  resolveAnalyzeStatusMessage({ creditsRemaining: 0, lastGrantPlan: 'single' }, (k) => ja[k]),
  ja.statusSingleExhausted,
);

assert.strictEqual(
  resolveAnalyzeStatusMessage({ creditsRemaining: 0 }, (k) => ja[k]),
  ja.statusAnalyzed,
);

assert.strictEqual(
  resolveAnalyzeStatusMessage({ purchaseRequired: true, creditsRemaining: 0 }, (k) => ja[k]),
  ja.creditsExhausted,
);

console.log('[verify-analyze-status-message] all assertions passed');
