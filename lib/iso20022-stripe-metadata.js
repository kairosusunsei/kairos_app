/**
 * Maps ISO 20022-style Purpose (Purp) and Structured Remittance (Strd) into
 * Stripe PaymentIntent metadata (string key/value, size-limited).
 *
 * Purp: CategoryPurpose — external purpose code (Cd).
 * Strd: Creditor reference / remittance lines (compact JSON).
 */

const STRIPE_META_MAX = 500;

/**
 * @param {object} input
 * @param {string} input.purposeCode ISO purpose category code (e.g. SUBS, COMT)
 * @param {string} input.creditorReference Structured creditor reference (Strd/CdtrRefInf)
 * @param {string[]} [input.additionalRemittanceInfo] AddtlRmtInf lines
 * @param {string} [input.serviceContext] Human-readable service line (non-ISO auxiliary)
 * @returns {Record<string, string>}
 */
function buildIso20022StripeMetadata(input) {
  const strd = {
    Strd: {
      CdtrRefInf: {
        Tp: { CdOrPrtry: { Cd: 'SCOR' } },
        Ref: String(input.creditorReference || '').slice(0, 35),
      },
      AddtlRmtInf: (input.additionalRemittanceInfo || []).map((s) => String(s).slice(0, 140)),
    },
  };

  let strdJson = JSON.stringify(strd);
  if (strdJson.length > STRIPE_META_MAX) {
    strdJson = JSON.stringify({
      Strd: { CdtrRefInf: { Ref: String(input.creditorReference).slice(0, 24) } },
    }).slice(0, STRIPE_META_MAX);
  }

  return {
    iso20022_purp_cd: String(input.purposeCode || 'SUBS').slice(0, 4),
    iso20022_strd_json: strdJson,
    iso20022_context: String(input.serviceContext || 'KAIROS behavioral analytics').slice(0, STRIPE_META_MAX),
  };
}

/**
 * Default purpose for digital access / subscription-style settlement.
 * @param {string} clientReferenceId
 * @param {string} tierLabel
 */
function defaultMetadataForKairos(clientReferenceId, tierLabel) {
  return buildIso20022StripeMetadata({
    purposeCode: 'SUBS',
    creditorReference: `KAIROS|${tierLabel}|${clientReferenceId}`.replace(/[^A-Za-z0-9|._-]/g, '_').slice(0, 35),
    additionalRemittanceInfo: [`Behavioral analytics — ${tierLabel}`, `Ref ${clientReferenceId}`.slice(0, 140)],
    serviceContext: 'KAIROS analysis decoupling settlement',
  });
}

module.exports = { buildIso20022StripeMetadata, defaultMetadataForKairos };
