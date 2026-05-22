/**
 * x402 HTTP transport (v2-shaped) with Stripe PaymentIntent as the settlement rail
 * encoded inside PaymentRequired.accepts[].extra.
 */

const X402_VERSION = 2;

/**
 * @param {object} p
 * @param {string} p.resourceUrl
 * @param {string} p.resourceDescription
 * @param {string} p.mimeType
 * @param {object} p.quote { currency, amountMinor }
 * @param {object} p.paymentIntent Stripe PI object (id, client_secret)
 * @param {string} p.publishableKey
 * @param {string} [p.connectedAccountId] optional Stripe account id for payTo display
 */
function buildPaymentRequiredPayload(p) {
  const amountStr = String(p.quote.amountMinor);
  return {
    x402Version: X402_VERSION,
    error: 'PAYMENT-SIGNATURE header is required',
    resource: {
      url: p.resourceUrl,
      description: p.resourceDescription,
      mimeType: p.mimeType || 'application/json',
    },
    accepts: [
      {
        scheme: 'stripe.payment_intent_v1',
        network: 'stripe:payment_intents',
        amount: amountStr,
        asset: p.quote.currency,
        payTo: p.connectedAccountId || 'stripe:platform',
        maxTimeoutSeconds: 86_400,
        extra: {
          stripePaymentIntentId: p.paymentIntent.id,
          clientSecret: p.paymentIntent.client_secret,
          publishableKey: p.publishableKey,
        },
      },
    ],
  };
}

function encodePaymentRequiredHeader(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodePaymentSignatureHeader(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * After agent completes PI, retry includes PAYMENT-SIGNATURE with payload referencing PI id.
 * @param {object} decoded
 * @returns {string|null}
 */
function extractStripePaymentIntentId(decoded) {
  const pl = decoded && decoded.payload;
  if (!pl) return null;
  return pl.stripePaymentIntentId || pl.paymentIntentId || null;
}

module.exports = {
  buildPaymentRequiredPayload,
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  extractStripePaymentIntentId,
};
