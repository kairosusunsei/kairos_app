/**
 * KAIROS supported locales — UI (public/locales) and /api/analyze must stay in sync.
 */
const SUPPORTED_LOCALES = ['ja', 'en', 'es', 'fr', 'de'];

const LOCALE_LABELS = {
  ja: 'Japanese',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

/** Stripe Checkout locale codes we pass through directly */
const STRIPE_CHECKOUT_LOCALES = new Set(['ja', 'en', 'es', 'fr', 'de']);

function normalizeLocale(code, acceptLanguageHeader) {
  const raw = String(code || '')
    .trim()
    .toLowerCase()
    .split('-')[0];
  if (SUPPORTED_LOCALES.includes(raw)) return raw;

  const accept = String(acceptLanguageHeader || '').toLowerCase();
  for (const loc of SUPPORTED_LOCALES) {
    if (accept.startsWith(loc)) return loc;
  }
  return 'ja';
}

function isSupportedLocale(code) {
  return SUPPORTED_LOCALES.includes(normalizeLocale(code));
}

function getDefaultUserInput(locale) {
  const map = {
    ja: 'おまakせ解析',
    en: 'Open-ended analysis',
    es: 'Análisis abierto',
    fr: 'Analyse libre',
    de: 'Offene Analyse',
  };
  return map[normalizeLocale(locale)] || map.ja;
}

function getStripeCheckoutLocale(locale) {
  const loc = normalizeLocale(locale);
  if (STRIPE_CHECKOUT_LOCALES.has(loc)) return loc;
  return 'auto';
}

function buildAnalyzeLocaleInstruction(locale) {
  const loc = normalizeLocale(locale);
  const lang = LOCALE_LABELS[loc] || LOCALE_LABELS.ja;
  return `【Locale Requirements — CRITICAL】
The client locale is "${loc}" (${lang}).
Generate ALL text fields (thoughtResonanceVector, mindTuning, deepSynchronicity) strictly in natural, warm, heartwarming ${lang}.
Do NOT mix languages. Do NOT output Japanese unless locale is "ja".`;
}

function buildCharLimitsBlock(accessTier, locale) {
  const loc = normalizeLocale(locale);
  const isJa = loc === 'ja';
  if (accessTier === 'full') {
    if (isJa) {
      return `【Character Limits — FULL (paid)】
thoughtResonanceVector: Under 300 characters (Japanese).
mindTuning: Under 300 characters (Japanese).
deepSynchronicity: Under 300 characters (Japanese).`;
    }
    return `【Character Limits — FULL (paid)】
thoughtResonanceVector: Under 80 words.
mindTuning: Under 80 words.
deepSynchronicity: Under 80 words.`;
  }
  if (isJa) {
    return `【Character Limits — TEASER (unpaid preview)】
thoughtResonanceVector: Under 100 characters (Japanese) only.
mindTuning: Generate internally but keep concise; client receives teaser only.
deepSynchronicity: Generate internally but keep concise; client receives teaser only.`;
  }
  return `【Character Limits — TEASER (unpaid preview)】
thoughtResonanceVector: Under 25 words only.
mindTuning: Generate internally but keep concise; client receives teaser only.
deepSynchronicity: Generate internally but keep concise; client receives teaser only.`;
}

function getSchemaFieldDescriptions(locale) {
  const lang = LOCALE_LABELS[normalizeLocale(locale)] || 'Japanese';
  return {
    thoughtResonanceVector: `Thought resonance vector in ${lang} only.`,
    mindTuning: `Mind tuning guidance in ${lang} only.`,
    deepSynchronicity: `Deep synchronicity insight in ${lang} only.`,
  };
}

const WARM_FALLBACK = {
  ja: {
    thoughtResonanceVector:
      'あなたの内なるリズムが、穏やかで光る前進の方向へと美しく整っています。',
    mindTuning:
      '深く息を吸い込み、肩の力をそっと抜いてください。優しい転換点が、すでに心の中で芽生えています。',
    deepSynchronicity:
      'あなたが感じる偶然の共鳴は、心が美しいつながりのパターンを認識しているサインです。',
  },
  en: {
    thoughtResonanceVector:
      'Your inner rhythm is aligning with a calm, luminous path forward today.',
    mindTuning:
      'Take a deep breath and soften your shoulders. A gentle turning point is already forming within you.',
    deepSynchronicity:
      'Every meaningful coincidence you notice is your mind recognizing a beautiful pattern of connection.',
  },
  es: {
    thoughtResonanceVector:
      'Tu ritmo interior se alinea con un camino sereno y luminoso hacia adelante.',
    mindTuning:
      'Respira profundo y suelta la tensión de los hombros. Un punto de inflexión amable ya está naciendo en ti.',
    deepSynchronicity:
      'Cada coincidencia significativa que notas es tu mente reconociendo un hermoso patrón de conexión.',
  },
  fr: {
    thoughtResonanceVector:
      'Ton rythme intérieur s’aligne sur un chemin serein et lumineux vers l’avant.',
    mindTuning:
      'Inspire profondément et détends tes épaules. Un tournant doux est déjà en train de naître en toi.',
    deepSynchronicity:
      'Chaque coïncidence significative que tu remarques est ton esprit qui reconnaît un beau motif de lien.',
  },
  de: {
    thoughtResonanceVector:
      'Dein innerer Rhythmus richtet sich auf einen ruhigen, lichtvollen Weg nach vorn aus.',
    mindTuning:
      'Atme tief ein und löse die Schultern. Ein sanfter Wendepunkt entsteht bereits in dir.',
    deepSynchronicity:
      'Jede bedeutsame Fügung, die du wahrnimmst, zeigt, dass dein Geist ein schönes Verbindungsmuster erkennt.',
  },
};

function getWarmFallbackPayload(locale) {
  const loc = normalizeLocale(locale);
  const pack = WARM_FALLBACK[loc] || WARM_FALLBACK.ja;
  return {
    synchronicityScore: 88,
    ...pack,
  };
}

module.exports = {
  SUPPORTED_LOCALES,
  normalizeLocale,
  isSupportedLocale,
  getDefaultUserInput,
  getStripeCheckoutLocale,
  buildAnalyzeLocaleInstruction,
  buildCharLimitsBlock,
  getSchemaFieldDescriptions,
  getWarmFallbackPayload,
};
