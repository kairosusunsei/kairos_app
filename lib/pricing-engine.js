/**
 * Multi-tier pricing: consumer-facing minor units through agent-scale USD caps.
 * Amounts align with Stripe PaymentIntents (integer minor units).
 */
class PricingEngine {
  /**
   * @param {object} [opts]
   * @param {number} [opts.consumerAmountJpy] Minor units JPY (default 300)
   * @param {number} [opts.agentAmountUsdCents] USD cents (default 500_000 = $5,000)
   */
  constructor(opts = {}) {
    this.consumerAmountJpy = opts.consumerAmountJpy ?? 300;
    this.agentAmountUsdCents = opts.agentAmountUsdCents ?? 500_000;
  }

  /** @typedef {'consumer' | 'agent'} PricingTierId */

  /**
   * @param {PricingTierId} tierId
   * @returns {{ tierId: PricingTierId, currency: string, amountMinor: number, displayHint: string }}
   */
  quote(tierId) {
    if (tierId === 'consumer') {
      return {
        tierId,
        currency: 'jpy',
        amountMinor: this.consumerAmountJpy,
        displayHint: `${this.consumerAmountJpy} JPY`,
      };
    }
    if (tierId === 'agent') {
      return {
        tierId,
        currency: 'usd',
        amountMinor: this.agentAmountUsdCents,
        displayHint: `$${(this.agentAmountUsdCents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
      };
    }
    const err = new Error('invalid_pricing_tier');
    err.code = 'INVALID_TIER';
    throw err;
  }

  /**
   * @param {PricingTierId} tierId
   * @returns {boolean}
   */
  static isValidTier(tierId) {
    return tierId === 'consumer' || tierId === 'agent';
  }
}

module.exports = { PricingEngine };
