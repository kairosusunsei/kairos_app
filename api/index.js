require('dotenv').config();
const path = require('path');
const express = require('express');

function getStripeClient() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return require('stripe')(secret, {
    apiVersion: '2026-03-04.preview', // AIエージェント決済(MPP)に必須のバージョン
  });
}

const stripe = getStripeClient();
const { GoogleGenAI } = require('@google/genai');

const { PricingEngine } = require(path.join(__dirname, '..', 'lib', 'pricing-engine.js'));
const { defaultMetadataForKairos } = require(path.join(__dirname, '..', 'lib', 'iso20022-stripe-metadata.js'));
const { claimStripeWebhookEvent } = require(path.join(__dirname, '..', 'lib', 'webhook-event-store.js'));
const kairosTransactions = require(path.join(__dirname, '..', 'lib', 'kairos-transactions.js'));
const checkoutPending = require(path.join(__dirname, '..', 'lib', 'checkout-pending.js'));
const kairosLocale = require(path.join(__dirname, '..', 'lib', 'kairos-locale.js'));
const kairosCredits = require(path.join(__dirname, '..', 'lib', 'kairos-credits.js'));
kairosCredits.setStripeClient(stripe);
const {
  buildPaymentRequiredPayload,
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  extractStripePaymentIntentId,
} = require(path.join(__dirname, '..', 'lib', 'x402-stripe-bridge.js'));
const { logAnalysisDecouplingStream } = require(path.join(__dirname, '..', 'lib', 'analysis-decoupling.js'));
const shareCard = require(path.join(__dirname, '..', 'lib', 'share-card.js'));
const referralAttribution = require(path.join(__dirname, '..', 'lib', 'referral-attribution.js'));
const referralRewards = require(path.join(__dirname, '..', 'lib', 'referral-rewards.js'));
const socialImage = require(path.join(__dirname, '..', 'lib', 'social-image.js'));
const ogCard = require(path.join(__dirname, '..', 'lib', 'og-card.js'));
const rasterizeSvg = require(path.join(__dirname, '..', 'lib', 'rasterize-svg.js'));
const xDmScout = require(path.join(__dirname, '..', 'lib', 'x-dm-scout.js'));
const rateLimit = require(path.join(__dirname, '..', 'lib', 'rate-limit.js'));

const app = express();

const geo = require(path.join(__dirname, '..', 'lib', 'geo-block.js'));

const ANALYZE_RATE_LIMIT = Number(process.env.KAIROS_ANALYZE_RATE_LIMIT) || 30;
const ANALYZE_RATE_WINDOW_MS = Number(process.env.KAIROS_ANALYZE_RATE_WINDOW_MS) || 15 * 60 * 1000;
const GEMINI_STREAM_RATE_LIMIT = Number(process.env.KAIROS_GEMINI_STREAM_RATE_LIMIT) || 10;
const GEMINI_STREAM_RATE_WINDOW_MS =
  Number(process.env.KAIROS_GEMINI_STREAM_RATE_WINDOW_MS) || 60 * 60 * 1000;

async function enforceApiRateLimit(req, res, { scope, limit, windowMs, format }) {
  const ip = rateLimit.clientIp(req);
  const result = await rateLimit.checkRateLimit({
    key: `${scope}:${ip}`,
    limit,
    windowMs,
  });
  if (!result.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    res.set('Retry-After', String(retryAfterSec));
    if (format === 'sse') {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(429);
      res.write(`data: ${JSON.stringify({ error: 'rate_limit_exceeded', retryAfterSec })}\n\n`);
      res.end();
    } else {
      res.status(429).json({ error: 'rate_limit_exceeded', retryAfterSec });
    }
    return false;
  }
  res.set('X-RateLimit-Remaining', String(result.remaining));
  return true;
}

/** Vercel `x-vercel-ip-country` による物理ガード（CN / HK / MO）。middleware.ts と二重化。 */
app.use((req, res, next) => {
  const cc = geo.countryFromRequest(req);
  if (geo.isBlockedCountry(cc)) {
    return res.status(403).set(geo.blockedResponseHeaders()).send(geo.blockedPageHtml());
  }
  next();
});

// Gemini SDK（モデル ID は運用環境の GA に合わせる）
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const modelId = 'gemini-3.1-flash-lite';

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (endpointSecret) {
  console.log('[KAIROS] STRIPE_WEBHOOK_SECRET loaded (length=%d)', endpointSecret.length);
} else {
  console.warn('[KAIROS] STRIPE_WEBHOOK_SECRET is not set — POST /webhook returns 503');
}

const pricingEngine = new PricingEngine();

const TEASER_CHAR_LIMIT = 100;
const FULL_CHAR_LIMIT = 300;

/** 月額サブスクは権利ロジック未実装のため、明示的に true になるまで Checkout 不可 */
function isSubscriptionLaunchEnabled() {
  return process.env.KAIROS_SUBSCRIPTION_ENABLED === 'true';
}

/**
 * Stripe Checkout セッションが決済済みか検証（Webhook 未到着の race も API 照会で吸収）。
 * @returns {Promise<object|null>}
 */
async function retrievePaidCheckoutSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return null;
  }
  if (!stripe) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      console.log('[retrievePaidCheckoutSession] unpaid', {
        sessionId,
        paymentStatus: session.payment_status,
      });
      return null;
    }
    return session;
  } catch (err) {
    console.error('[retrievePaidCheckoutSession]', err.message);
    return null;
  }
}

/**
 * 決済済みセッションを記録し、プランに応じたクレジットを必ず付与（Webhook 未到着の保険）。
 */
async function syncPaidSessionAndCredits(sessionId) {
  const session = await retrievePaidCheckoutSession(sessionId);
  if (!session) return { paidRecord: null, grant: null, session: null };

  const paidRecord = kairosTransactions.recordPaidSession(session);
  const grant = await kairosCredits.grantFromCheckoutSession(session);
  const refCode = session.metadata && session.metadata.referralCode;
  if (refCode && session.payment_status === 'paid') {
    await referralAttribution.recordConversion(refCode, {
      amountJpy: session.amount_total || 0,
      plan: session.metadata && session.metadata.plan,
      sessionId: session.id,
    });
    await referralRewards.processReferralReward(stripe, session);
  }
  return { paidRecord, grant, session };
}

async function verifyCheckoutSessionPaid(sessionId) {
  const synced = await syncPaidSessionAndCredits(sessionId);
  return synced.paidRecord;
}

async function resolveAnalyzeAccess({ kairosUserId, checkoutSessionId }) {
  let uid = kairosCredits.normalizeUserId(kairosUserId);
  let grant = null;
  let paidRecord = null;
  let sessionUserMismatch = false;

  if (checkoutSessionId) {
    const synced = await syncPaidSessionAndCredits(checkoutSessionId);
    grant = synced.grant;
    if (synced.session) {
      const sessionUid =
        kairosCredits.normalizeUserId(synced.session.metadata && synced.session.metadata.kairosUserId) ||
        kairosCredits.normalizeUserId(synced.session.client_reference_id);
      if (sessionUid) {
        if (!uid) {
          sessionUserMismatch = true;
        } else if (uid !== sessionUid) {
          sessionUserMismatch = true;
          uid = null;
        }
      }
      if (!sessionUserMismatch && uid) {
        paidRecord = synced.paidRecord;
      }
    }
  }

  const balance = uid ? await kairosCredits.getBalance(uid) : 0;
  return {
    kairosUserId: uid,
    balance,
    canFull: balance > 0 && !sessionUserMismatch,
    paidRecord,
    grant,
    sessionUserMismatch,
  };
}

/**
 * 決済セッション metadata から入力テキストを復元（sessionStorage 消失対策）。
 */
async function resolveInputFromCheckoutSession(sessionId) {
  if (!sessionId || !stripe) return '';
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const fromMeta = session.metadata && session.metadata.inputText;
    return fromMeta ? String(fromMeta).trim() : '';
  } catch (err) {
    console.error('[resolveInputFromCheckoutSession]', err.message);
    return '';
  }
}

function truncateText(value, maxLen) {
  const s = String(value || '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function publicPaymentIntentUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${host}/api/payment-intent`;
}

/**
 * Stripe Webhook: 署名検証にはリクエストボディを JSON パース前のまま渡す必要がある。
 * このルートを express.json() より必ず先に登録する（Vercel サーバーレスでも同順序を維持）。
 */
app.post(
  '/webhook',
  express.raw({ type: 'application/json', limit: '2mb' }),
  async (request, response) => {
    const sig = request.headers['stripe-signature'];
    if (!endpointSecret) {
      console.error('[Webhook] STRIPE_WEBHOOK_SECRET is not configured');
      return response.status(503).json({ received: false, error: 'misconfigured' });
    }
    if (!stripe) {
      console.error('[Webhook] STRIPE_SECRET_KEY is not configured');
      return response.status(503).json({ received: false, error: 'stripe_not_configured' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
      console.log(`Webhook signature error: ${err.message}`);
      return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    const shouldProcess = await claimStripeWebhookEvent(event.id, event.type);
    if (!shouldProcess) {
      return response.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;

      console.log('[Webhook] checkout.session.completed', {
        eventId: event.id,
        sessionId: session.id,
        paymentStatus: session.payment_status,
        mode: session.mode,
        plan: session.metadata && session.metadata.plan,
        clientReferenceId: userId || null,
      });

      const recorded = kairosTransactions.recordPaidSession(session);
      const creditGrant = await kairosCredits.grantFromCheckoutSession(session);
      if (recorded) {
        console.log('[Webhook] kairos_transactions recorded', {
          sessionId: recorded.sessionId,
          plan: recorded.plan,
          paidAt: recorded.paidAt,
        });
      }
      if (creditGrant.granted) {
        console.log('[Webhook] kairos_credits granted', creditGrant);
      }

      const refCode = session.metadata && session.metadata.referralCode;
      if (refCode && session.payment_status === 'paid') {
        await referralAttribution.recordConversion(refCode, {
          amountJpy: session.amount_total || 0,
          plan: session.metadata && session.metadata.plan,
          sessionId: session.id,
        });
        const referralReward = await referralRewards.processReferralReward(stripe, session);
        if (referralReward.ok) {
          console.log('[Webhook] referral_reward', referralReward);
        }
      }

      if (userId && process.env.GEMINI_API_KEY) {
        console.log(`\n--- 解析解禁プロセス開始: ${userId} ---`);
        try {
          console.log(` 行動分析モデル実行中（${modelId}）...`);
          await logAnalysisDecouplingStream(ai, modelId, userId);
        } catch (aiErr) {
          console.error('AI 生成エラー:', aiErr.message);
        }
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const userId = pi.metadata && pi.metadata.client_reference_id;
      if (userId && process.env.GEMINI_API_KEY) {
        console.log(`\n--- 解析解禁プロセス開始 (PaymentIntent): ${userId} ---`);
        try {
          console.log(` 行動分析モデル実行中（${modelId}）...`);
          await logAnalysisDecouplingStream(ai, modelId, userId);
        } catch (aiErr) {
          console.error('AI 生成エラー:', aiErr.message);
        }
      }
    }

    response.json({ received: true });
  }
);

// ローカル検証用（Vercel 本番では public は CDN から配信され express.static は無視される）
app.use(express.static(path.join(__dirname, '..', 'public')));

const tokushohoHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>特定商取引法に基づく表記 | KAIROS</title>
  <style>
    :root { color-scheme: dark; --bg:#0f0e0c; --fg:#e8e4dc; --muted:#9a958c; --accent:#c9a227; }
    body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; }
    header { display:flex; align-items:center; gap:12px; padding:20px 24px; border-bottom:1px solid #2a2620; }
    header h1 { font-size:1.1rem; font-weight:600; margin:0; letter-spacing:0.04em; }
    main { max-width:720px; margin:0 auto; padding:32px 24px 48px; }
    h2 { font-size:0.85rem; color:var(--accent); text-transform:uppercase; letter-spacing:0.12em; margin:28px 0 8px; }
    dl { margin:0 0 12px; }
    dt { color:var(--muted); font-size:0.8rem; margin-top:12px; }
    dd { margin:4px 0 0; }
    .note { font-size:0.85rem; color:var(--muted); margin-top:32px; }
  </style>
</head>
<body>
  <header>
    <img src="/scarab.svg" width="40" height="40" alt="" decoding="async"/>
    <h1>KAIROS — 特定商取引法に基づく表記</h1>
  </header>
  <main>
    <h2>販売事業者</h2>
    <dl>
      <dt>事業者名称</dt><dd>KAIROS Behavioral Analytics 運営事務局</dd>
      <dt>運営責任者</dt><dd>井伊聖二</dd>
      <dt>所在地</dt><dd>〒104-0061 東京都中央区銀座１丁目１２番４号 N&amp;E BLD.６F</dd>
      <dt>お問い合わせ先</dt>
      <dd>
        電話：050-1792-9036<br/>
        メール：<a href="mailto:kairos.official.owner@gmail.com" style="color:#c9a227">kairos.official.owner@gmail.com</a><br/>
        受付時間：10:00〜18:00（土日祝を除く）
      </dd>
    </dl>

    <h2>販売価格・追加費用</h2>
    <dl>
      <dt>販売価格</dt>
      <dd>
        ・KAIROS Single Scan：300円<br/>
        ・KAIROS 5回一括セット券：1,000円<br/>
        ・KAIROS Monthly Premium：2,000円（毎月自動更新）<br/>
        ※すべて消費税込みの金額です。
      </dd>
      <dt>商品代金以外の必要料金</dt>
      <dd>インターネット接続料金その他、お客様の通信環境に係る費用はお客様の負担となります。</dd>
    </dl>

    <h2>支払方法・時期</h2>
    <dl>
      <dt>支払方法</dt>
      <dd>クレジットカード決済（Stripeによる即時決済）</dd>
      <dt>支払時期</dt>
      <dd>決済時（申込み手続完了時に決済が行われます）</dd>
    </dl>

    <h2>サービス提供時期</h2>
    <dl>
      <dt>提供時期</dt>
      <dd>決済手続き完了後、画面上でのテキストデータの自動生成および描画により即時提供します。</dd>
    </dl>

    <h2>返品・キャンセル</h2>
    <dl>
      <dt>返品・キャンセル（返金）</dt>
      <dd>デジタルコンテンツという商品の性質上、決済完了後はいかなる理由があっても返金、返品、購入キャンセル、決済取り消しには一切応じられません。</dd>
    </dl>

    <h2>動作環境</h2>
    <dl>
      <dt>推奨環境</dt>
      <dd>各ブラウザの最新版、および当サービスが案内する動作環境に準拠</dd>
    </dl>

    <p class="note"><a href="/" style="color:#c9a227">トップページへ戻る</a></p>
  </main>
</body>
</html>`;

app.get('/legal/tokushoho', (req, res) => {
  res.type('html').send(tokushohoHtml);
});

/**
 * デモ用: Gemini ストリームを SSE で返す。クライアントは受信チャンクごとに視覚フィードバック可能。
 * 本番は同一サイト Referer 必須 + IP レート制限。KAIROS_GEMINI_STREAM_ENABLED=false で無効化可。
 */
app.get('/api/gemini-stream', async (req, res) => {
  if (process.env.KAIROS_GEMINI_STREAM_ENABLED === 'false') {
    return res.status(404).json({ error: 'not_found' });
  }
  if (process.env.VERCEL_ENV === 'production' && !rateLimit.isSameSiteReferer(req)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const allowed = await enforceApiRateLimit(req, res, {
    scope: 'gemini-stream',
    limit: GEMINI_STREAM_RATE_LIMIT,
    windowMs: GEMINI_STREAM_RATE_WINDOW_MS,
    format: 'sse',
  });
  if (!allowed) return;

  if (!process.env.GEMINI_API_KEY) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.write(`data: ${JSON.stringify({ error: 'GEMINI_API_KEY is not configured' })}\n\n`);
    return res.end();
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    const result = await ai.models.generateContentStream({
      model: modelId,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                'KAIROS のAI自己認知インターフェース向けに、心に寄り添う短いシンクロニシティ・メッセージを1段落で生成せよ。装飾記号は使わず、120文字以内。',
            },
          ],
        },
      ],
      config: {
        systemInstruction:
          'あなたはKAIROSのAI自己認知コンパニオンとして、温かく詩的なシンクロニシティ・メッセージのみを返す。語彙は公式体系（行動分析・深層心理・シンクロニシティ・解析解禁）に整合させよ。',
        maxOutputTokens: 200,
        temperature: 0.9,
      },
    });

    for await (const chunk of result) {
      if (chunk.text) {
        send({ text: chunk.text });
      }
    }
    send({ done: true });
  } catch (err) {
    send({ error: err.message || 'stream_failed' });
  }
  res.end();
});

// Webhook 以外の JSON API 用（現状未使用だが、将来のルートで raw ボディを壊さないよう webhook 登録後に限定）
app.use(express.json({ limit: '1mb' }));

function getClientLocale(req) {
  const bodyLocale = req.body && req.body.locale;
  const queryLocale = req.query && req.query.locale;
  return kairosLocale.normalizeLocale(
    bodyLocale || queryLocale,
    req.headers['accept-language'],
  );
}

function clampWarmScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 88;
  return Math.min(99, Math.max(77, Math.round(n)));
}

function parseGeminiJson(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('empty_model_response');
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced) s = fenced[1].trim();
  return JSON.parse(s);
}

function matchesWarmFallback(locale, resultData) {
  const warm = kairosLocale.getWarmFallbackPayload(locale);
  const vec = String(resultData.thoughtResonanceVector || '').trim();
  const mind = String(resultData.mindTuning || '').trim();
  const deep = String(resultData.deepSynchronicity || '').trim();
  return (
    vec === warm.thoughtResonanceVector &&
    mind === warm.mindTuning &&
    deep === warm.deepSynchronicity
  );
}

function formatAnalyzePayload(raw, accessTier, extras) {
  const tier = accessTier === 'full' ? 'full' : 'teaser';
  const charLimit = tier === 'full' ? FULL_CHAR_LIMIT : TEASER_CHAR_LIMIT;
  const meta = extras || {};

  const thoughtResonanceVector = truncateText(
    raw.thoughtResonanceVector || raw.vector || '',
    charLimit,
  );
  const mindTuningFull = String(raw.mindTuning || raw.advice || '').trim();
  const deepFull = String(raw.deepSynchronicity || raw.correlation || '').trim();

  const out = {
    success: true,
    accessTier: tier,
    locked: tier !== 'full',
    generatedBy: meta.generatedBy || 'gemini',
    creditsRemaining: meta.creditsRemaining != null ? meta.creditsRemaining : undefined,
    creditsExhausted: !!meta.creditsExhausted,
    purchaseRequired: !!meta.purchaseRequired,
    synchronicityScore: clampWarmScore(
      raw.synchronicityScore != null ? raw.synchronicityScore : raw.score,
    ),
    thoughtResonanceVector,
    mindTuning:
      tier === 'full'
        ? truncateText(mindTuningFull, FULL_CHAR_LIMIT)
        : '',
    deepSynchronicity:
      tier === 'full'
        ? truncateText(deepFull, FULL_CHAR_LIMIT)
        : '',
    teaserHint:
      tier === 'teaser'
        ? truncateText(mindTuningFull || deepFull, TEASER_CHAR_LIMIT)
        : null,
  };
  if (meta.inputEcho) out.inputEcho = meta.inputEcho;
  if (meta.fallbackReason) out.fallbackReason = meta.fallbackReason;
  return out;
}

function warmAnalyzeFallback(locale, accessTier, extras) {
  const tier = accessTier === 'full' ? 'full' : 'teaser';
  const payload = formatAnalyzePayload(
    kairosLocale.getWarmFallbackPayload(locale),
    tier,
    { ...extras, generatedBy: 'fallback' },
  );
  payload.locale = kairosLocale.normalizeLocale(locale);
  return payload;
}

app.post('/api/analyze', async (req, res) => {
  const allowed = await enforceApiRateLimit(req, res, {
    scope: 'analyze',
    limit: ANALYZE_RATE_LIMIT,
    windowMs: ANALYZE_RATE_WINDOW_MS,
  });
  if (!allowed) return;

  const locale = getClientLocale(req);
  const checkoutSessionId = String(
    (req.body && (req.body.checkoutSessionId || req.body.session_id)) || '',
  ).trim();
  const kairosUserId = String((req.body && req.body.kairosUserId) || '').trim();
  const analyzeRequestId = String((req.body && req.body.analyzeRequestId) || '').trim();

  const access = await resolveAnalyzeAccess({ kairosUserId, checkoutSessionId });
  const accessTier = access.canFull ? 'full' : 'teaser';
  const responseExtras = {
    creditsRemaining: access.balance,
    creditsExhausted: !access.canFull,
    purchaseRequired: !access.canFull,
  };

  let userInput =
    (req.body && (req.body.userInput || req.body.inputText)) || '';
  userInput = String(userInput).trim();
  if (!userInput && checkoutSessionId) {
    const recovered = await resolveInputFromCheckoutSession(checkoutSessionId);
    if (recovered) userInput = recovered;
  }
  if (!userInput) userInput = kairosLocale.getDefaultUserInput(locale);
  const inputEcho = truncateText(userInput, 120);

  if (!access.canFull) {
    const fb = warmAnalyzeFallback(locale, 'teaser', {
      creditsRemaining: 0,
      creditsExhausted: true,
      purchaseRequired: true,
    });
    fb.locale = kairosLocale.normalizeLocale(locale);
    if (access.kairosUserId) fb.kairosUserId = access.kairosUserId;
    return res.status(200).json(fb);
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'gemini_not_configured',
      creditsRemaining: access.balance,
      inputEcho,
    });
  }

  const charLimitsBlock = kairosLocale.buildCharLimitsBlock(accessTier, locale);
  const localeInstruction = kairosLocale.buildAnalyzeLocaleInstruction(locale);
  const fieldDesc = kairosLocale.getSchemaFieldDescriptions(locale);

  const systemInstruction = `
You are "KAIROS," a premium AI self-awareness tech companion (not fortune-telling).
Read the user's current mind state or worry, and craft a warm message that brings emotional relief, self-validation, and a sense of meaningful synchronicity.

【STRICT RULES for the tone of the message】
NEVER use cold, academic, bureaucratic, fortune-telling, or analytical words.
You are strictly BANNED from using words like: "反社会的", "表象", "大衆消費行動", "戦略的助言", "深層相関", "予兆", "占い", "運命", "境界領域", "KPI", "統制", "ベクトル", "目的 (Strategic Objective)", "方策 (Strategic Measure)", "リテラシー", "サブカルチャー", "匿名化".
Speak like a gentle, wise companion who supports self-cognition and emotional clarity.
Reassure the user that they are doing beautifully, that their feelings matter, and that a positive inner turning point is blooming.

【Input binding — mandatory】
You MUST weave at least one concrete detail from the user's input (a named person, place, object, worry, or exact phrase they wrote) into thoughtResonanceVector and mindTuning.
Do NOT output generic encouragement that could apply to anyone without reading their text.
Never copy canned template sentences; every field must feel unique to this input.

${localeInstruction}

【Character Limits】
synchronicityScore: An encouraging number between 77 and 99. Never return anything below 77.
${charLimitsBlock}
`;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            synchronicityScore: {
              type: 'integer',
              description:
                'Synchronicity score (シンクロニシティ・スコア): 77-99, uplifting only.',
            },
            thoughtResonanceVector: {
              type: 'string',
              description: fieldDesc.thoughtResonanceVector,
            },
            mindTuning: {
              type: 'string',
              description: fieldDesc.mindTuning,
            },
            deepSynchronicity: {
              type: 'string',
              description: fieldDesc.deepSynchronicity,
            },
          },
          required: [
            'synchronicityScore',
            'thoughtResonanceVector',
            'mindTuning',
            'deepSynchronicity',
          ],
        },
        temperature: 0.72,
        maxOutputTokens: 1000,
        systemInstruction,
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Analyze ONLY this user input and respond in JSON.\n---\n${userInput}\n---`,
            },
          ],
        },
      ],
    });

    const resultData = parseGeminiJson(response.text);
    if (matchesWarmFallback(locale, resultData)) {
      throw new Error('generic_template_response');
    }

    const consumeKey = kairosCredits.buildConsumeKey(
      access.kairosUserId,
      checkoutSessionId,
      analyzeRequestId,
    );
    const consumed = await kairosCredits.tryConsumeCredit(access.kairosUserId, consumeKey);
    if (!consumed.ok) {
      const fb = warmAnalyzeFallback(locale, 'teaser', {
        creditsRemaining: consumed.balance,
        creditsExhausted: true,
        purchaseRequired: true,
      });
      fb.locale = kairosLocale.normalizeLocale(locale);
      return res.status(200).json(fb);
    }

    const payload = formatAnalyzePayload(resultData, 'full', {
      creditsRemaining: consumed.balance,
      creditsExhausted: consumed.balance <= 0,
      purchaseRequired: false,
      generatedBy: 'gemini',
      inputEcho,
    });
    payload.locale = kairosLocale.normalizeLocale(locale);
    if (access.kairosUserId) payload.kairosUserId = access.kairosUserId;
    if (consumed.balance <= 0 && access.kairosUserId) {
      const lastGrantPlan = await kairosCredits.getLastGrantPlan(access.kairosUserId);
      if (lastGrantPlan) payload.lastGrantPlan = lastGrantPlan;
    }
    if (access.paidRecord) {
      payload.checkoutSessionId = access.paidRecord.sessionId;
      payload.paidAt = access.paidRecord.paidAt;
    }
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[analyze] gemini_failed', {
      message: error.message,
      model: modelId,
      inputEcho,
      kairosUserId: access.kairosUserId,
    });
    if (access.canFull) {
      return res.status(503).json({
        success: false,
        error: 'generation_failed',
        detail: error.message,
        creditsRemaining: access.balance,
        inputEcho,
      });
    }
    const fb = warmAnalyzeFallback(locale, 'teaser', responseExtras);
    fb.locale = kairosLocale.normalizeLocale(locale);
    fb.inputEcho = inputEcho;
    fb.fallbackReason = error.message;
    return res.status(200).json(fb);
  }
});

/**
 * 決済済み Checkout セッションの検証（フロント E2E / 手動確認用）。
 */
app.get('/api/unseal', async (req, res) => {
  const sessionId = String(req.query.session_id || req.query.checkoutSessionId || '').trim();
  const kairosUserId = String(req.query.kairosUserId || '').trim();
  const access = await resolveAnalyzeAccess({ kairosUserId, checkoutSessionId: sessionId });

  if (!access.canFull) {
    return res.status(402).json({
      success: false,
      error: 'payment_required',
      accessTier: 'teaser',
      creditsRemaining: access.balance,
      creditsExhausted: true,
      purchaseRequired: true,
    });
  }
  return res.status(200).json({
    success: true,
    accessTier: 'full',
    checkoutSessionId: access.paidRecord && access.paidRecord.sessionId,
    plan: access.paidRecord && access.paidRecord.plan,
    paidAt: access.paidRecord && access.paidRecord.paidAt,
    creditsRemaining: access.balance,
    kairosUserId: access.kairosUserId,
    grant: access.grant,
  });
});

app.get('/api/credits', async (req, res) => {
  const kairosUserId = String(req.query.kairosUserId || '').trim();
  const uid = kairosCredits.normalizeUserId(kairosUserId);
  if (!uid) {
    return res.status(400).json({ error: 'invalid_kairos_user_id' });
  }
  const balance = await kairosCredits.getBalance(uid);
  return res.status(200).json({
    success: true,
    kairosUserId: uid,
    creditsRemaining: balance,
    canAnalyze: balance > 0,
  });
});

function assertAdminKey(req, res) {
  const expected = process.env.KAIROS_ADMIN_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'admin_not_configured' });
    return false;
  }
  const provided = String(req.get('x-kairos-admin-key') || '').trim();
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function sendShareCardSvg(req, res) {
  const params = socialImage.parseSocialImageQuery(req.query);
  const svg = shareCard.buildShareCardSvg(params);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(svg);
}

function sendShareCardPng(req, res) {
  const params = socialImage.parseSocialImageQuery(req.query);
  const svg = shareCard.buildShareCardSvg(params);
  const png = rasterizeSvg.rasterizeSvgToPng(svg, { width: 1080 });
  if (!png) {
    return res.status(503).json({
      error: 'png_unavailable',
      hint: 'Install @resvg/resvg-js or use client-side PNG export from SVG.',
      svgUrl: socialImage.buildShareCardImageUrl(params, false),
    });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(png);
}

function sendOgSvg(req, res) {
  const params = socialImage.parseSocialImageQuery(req.query);
  const svg = ogCard.buildOgCardSvg(params);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(svg);
}

function sendOgPng(req, res) {
  const params = socialImage.parseSocialImageQuery(req.query);
  const svg = ogCard.buildOgCardSvg(params);
  const png = rasterizeSvg.rasterizeSvgToPng(svg, { width: 1200 });
  if (!png) {
    return res.status(503).json({
      error: 'png_unavailable',
      hint: 'Install @resvg/resvg-js for crawler-friendly og:image PNG.',
      svgUrl: socialImage.buildOgImageUrl(params, false),
    });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(png);
}

app.get('/api/share-card', sendShareCardSvg);
app.get('/api/share-card.png', sendShareCardPng);

app.get('/api/og', sendOgSvg);
app.get('/api/og.png', sendOgPng);

app.get('/api/og/meta', (req, res) => {
  const params = socialImage.parseSocialImageQuery(req.query);
  const meta = ogCard.buildOgMeta(params);
  return res.status(200).json({ success: true, ...meta });
});

app.get('/invite', async (req, res) => {
  const params = socialImage.parseSocialImageQuery(req.query);
  if (params.ref) {
    await referralAttribution.recordVisit(params.ref);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).send(ogCard.buildInviteLandingHtml(params));
});

app.get('/api/share-card/fixtures', (req, res) => {
  const fixtures = shareCard.PREVIEW_FIXTURES.map((f) => ({
    ...f,
    imageUrl: `/api/share-card?score=${f.score}&locale=${f.locale}&teaser=${encodeURIComponent(f.teaser)}${f.ref ? `&ref=${encodeURIComponent(f.ref)}` : ''}`,
    tweetText: shareCard.buildTweetText(f.locale, f.ref),
  }));
  return res.status(200).json({ success: true, fixtures });
});

app.get('/api/referral/rewards', async (req, res) => {
  const referrerId =
    req.query.kairosUserId || req.query.ref || (req.body && req.body.referralCode) || '';
  const stats = await referralRewards.getReferrerRewardStats(referrerId);
  if (!stats.ok) {
    return res.status(400).json(stats);
  }
  return res.status(200).json({ success: true, ...stats });
});

app.post('/api/referral/visit', async (req, res) => {
  const code =
    (req.body && req.body.referralCode) ||
    req.query.ref ||
    '';
  const result = await referralAttribution.recordVisit(code);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  return res.status(200).json({ success: true, ...result });
});

app.get('/api/admin/metrics', async (req, res) => {
  if (!assertAdminKey(req, res)) return;

  const referrals = await referralAttribution.getSummary();
  const out = {
    success: true,
    generatedAt: new Date().toISOString(),
    referrals,
    stripe: null,
  };

  if (!stripe) {
    return res.status(200).json(out);
  }

  try {
    const sessions = await stripe.checkout.sessions.list({ limit: 100, status: 'complete' });
    let totalJpy = 0;
    let count = 0;
    const byPlan = { single: 0, bundle: 0, subscription: 0, other: 0 };
    for (const s of sessions.data) {
      if (s.payment_status !== 'paid') continue;
      count += 1;
      const amt = s.amount_total || 0;
      if (s.currency === 'jpy') totalJpy += amt;
      const plan = (s.metadata && s.metadata.plan) || 'other';
      if (byPlan[plan] != null) byPlan[plan] += 1;
      else byPlan.other += 1;
    }
    out.stripe = {
      recentPaidSessions: count,
      recentRevenueJpy: totalJpy,
      byPlan,
      note: 'Stripe list limit 100 most recent complete sessions',
    };
  } catch (err) {
    out.stripe = { error: err.message };
  }

  return res.status(200).json(out);
});

/**
 * PricingPlanSelector からの遷移を受け、Stripe Checkout へ 303 リダイレクト。
 * plan: single | bundle | subscription
 */
function resolveCheckoutPlan(plan) {
  if (plan === 'single') {
    return {
      priceId: process.env.STRIPE_PRICE_SINGLE,
      sessionMode: 'payment',
      envName: 'STRIPE_PRICE_SINGLE',
    };
  }
  if (plan === 'bundle') {
    return {
      priceId: process.env.STRIPE_PRICE_BUNDLE,
      sessionMode: 'payment',
      envName: 'STRIPE_PRICE_BUNDLE',
    };
  }
  if (plan === 'subscription') {
    if (!isSubscriptionLaunchEnabled()) {
      return null;
    }
    return {
      priceId: process.env.STRIPE_PRICE_SUBSCRIPTION,
      sessionMode: 'subscription',
      envName: 'STRIPE_PRICE_SUBSCRIPTION',
    };
  }
  return null;
}

async function validateStripePriceForMode(priceId, sessionMode, envName) {
  if (!stripe) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active) {
      return { ok: false, reason: 'price_inactive', priceType: price.type };
    }
    if (sessionMode === 'payment' && price.type !== 'one_time') {
      console.error(`Stripe Checkout Error: ${envName} must be one_time price, got ${price.type}`);
      return { ok: false, reason: 'price_type_mismatch', priceType: price.type };
    }
    if (sessionMode === 'subscription' && price.type !== 'recurring') {
      console.error(`Stripe Checkout Error: ${envName} must be recurring price, got ${price.type}`);
      return { ok: false, reason: 'price_type_mismatch', priceType: price.type };
    }
    return {
      ok: true,
      priceType: price.type,
      livemode: price.livemode,
      unit_amount: price.unit_amount,
      currency: price.currency,
    };
  } catch (err) {
    console.error(`Stripe Checkout Error: retrieve ${envName}:`, err.message);
    return { ok: false, reason: 'price_retrieve_failed', message: err.message };
  }
}

async function createCheckoutSessionAndRedirect(res, {
  plan,
  locale,
  inputText,
  kairosUserId,
  referralCode,
}) {
  if (!stripe || !process.env.STRIPE_SECRET_KEY) {
    console.error('Stripe Checkout Error: STRIPE_SECRET_KEY is not configured');
    return res.status(503).send('Stripe Gateway Connection Error');
  }

  const currentLocale = kairosLocale.normalizeLocale(locale, null);
  const resolved = resolveCheckoutPlan(plan);

  if (!resolved) {
    return res.status(400).send('Invalid billing plan selected.');
  }

  const { priceId, sessionMode, envName } = resolved;
  if (!priceId || !String(priceId).startsWith('price_')) {
    console.error(`Stripe Checkout Error: ${envName} is missing or invalid`);
    return res.status(503).send('Stripe Gateway Connection Error');
  }

  const priceCheck = await validateStripePriceForMode(priceId, sessionMode, envName);
  if (!priceCheck.ok) {
    return res.status(503).send('Stripe Gateway Connection Error');
  }

  if (plan === 'bundle' && priceCheck.unit_amount !== 1000) {
    console.error(
      `Stripe Checkout Error: ${envName} must be 1000 JPY, got ${priceCheck.unit_amount}`,
    );
    return res.status(503).send('Stripe Gateway Connection Error');
  }
  if (plan === 'single' && priceCheck.unit_amount !== 300) {
    console.error(
      `Stripe Checkout Error: ${envName} must be 300 JPY, got ${priceCheck.unit_amount}`,
    );
    return res.status(503).send('Stripe Gateway Connection Error');
  }

  let stripeCustomerId = null;
  const normalizedUid = kairosCredits.normalizeUserId(kairosUserId);
  if (normalizedUid) {
    stripeCustomerId = await kairosCredits.ensureStripeCustomerId(normalizedUid);
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: sessionMode,
    locale: kairosLocale.getStripeCheckoutLocale(currentLocale),
    metadata: {
      plan: String(plan),
      inputText: String(inputText || '').slice(0, 500),
      kairosUserId: String(kairosUserId || '').slice(0, 128),
      referralCode: String(referralCode || '').slice(0, 64),
    },
    client_reference_id: String(kairosUserId || '').slice(0, 200) || undefined,
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
    success_url: 'https://get-kairos.online/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://get-kairos.online/canceled',
  });

  if (!session.url) {
    console.error('Stripe Checkout Error: session.url was empty');
    return res.status(500).send('Stripe Gateway Connection Error');
  }

  return res.redirect(303, session.url);
}

app.post('/api/checkout/prepare', (req, res) => {
  const plan = (req.body && req.body.plan) || 'single';
  const locale = kairosLocale.normalizeLocale(
    (req.body && req.body.locale) || 'ja',
    req.headers['accept-language'],
  );
  const inputText = (req.body && (req.body.inputText || req.body.userInput)) || '';
  const kairosUserId = String((req.body && req.body.kairosUserId) || '').trim();
  if (!kairosCredits.normalizeUserId(kairosUserId)) {
    return res.status(400).json({ error: 'invalid_kairos_user_id' });
  }
  if (!resolveCheckoutPlan(plan)) {
    return res.status(400).json({ error: 'invalid_plan' });
  }
  const referralCode = referralAttribution.normalizeReferralCode(
    (req.body && req.body.referralCode) || '',
  );
  const prepareId = checkoutPending.createPending({
    plan,
    locale,
    inputText,
    kairosUserId,
    referralCode: referralCode || '',
  });
  const creditsGranted = kairosCredits.creditsForPlan(plan);
  return res.status(200).json({
    prepareId,
    plan,
    creditsGranted,
    label:
      plan === 'bundle'
        ? 'bundle_5'
        : plan === 'subscription'
          ? 'subscription'
          : 'single',
  });
});

app.get('/api/checkout', async (req, res) => {
  try {
    let plan = req.query.plan;
    let locale = req.query.locale;
    let inputText = '';
    let kairosUserId = '';
    let referralCode = referralAttribution.normalizeReferralCode(req.query.referralCode || '');

    const prepareId = req.query.prepareId;
    if (prepareId) {
      const pending = checkoutPending.consumePending(String(prepareId));
      if (!pending) {
        return res.status(400).send('Checkout prepare session expired. Please try again.');
      }
      plan = pending.plan;
      locale = pending.locale;
      inputText = pending.inputText;
      kairosUserId = pending.kairosUserId || '';
      if (!referralCode && pending.referralCode) {
        referralCode = referralAttribution.normalizeReferralCode(pending.referralCode);
      }
    }

    return await createCheckoutSessionAndRedirect(res, {
      plan: plan || 'single',
      locale: locale || 'ja',
      inputText,
      kairosUserId,
      referralCode: referralCode || '',
    });
  } catch (error) {
    console.error('Stripe Checkout Error:', error.message);
    if (error.type) console.error('Stripe Checkout Error type:', error.type);
    if (error.code) console.error('Stripe Checkout Error code:', error.code);
    return res.status(500).send('Stripe Gateway Connection Error');
  }
});

app.get('/api/status', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'kairos',
    supportedLocales: kairosLocale.SUPPORTED_LOCALES,
    webhookSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    priceIdsConfigured: Boolean(
      process.env.STRIPE_PRICE_SINGLE &&
        process.env.STRIPE_PRICE_BUNDLE &&
        process.env.STRIPE_PRICE_SUBSCRIPTION,
    ),
    singleOnlyLaunch: process.env.KAIROS_SINGLE_ONLY === 'true',
    subscriptionLaunchEnabled: isSubscriptionLaunchEnabled(),
  });
});

/** Stripe Price ID の実体診断（本番トラブルシュート用） */
app.get('/api/checkout-health', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ ok: false, error: 'stripe_not_configured' });
  }
  const plans = [
    { plan: 'single', priceId: process.env.STRIPE_PRICE_SINGLE, sessionMode: 'payment' },
    { plan: 'bundle', priceId: process.env.STRIPE_PRICE_BUNDLE, sessionMode: 'payment' },
    { plan: 'subscription', priceId: process.env.STRIPE_PRICE_SUBSCRIPTION, sessionMode: 'subscription' },
  ];
  const out = {};
  for (const row of plans) {
    if (row.plan === 'subscription' && !isSubscriptionLaunchEnabled()) {
      out[row.plan] = {
        priceId: row.priceId || null,
        sessionMode: row.sessionMode,
        ok: false,
        reason: 'disabled_at_launch',
        message: 'Subscription checkout is disabled until entitlement logic ships.',
      };
      continue;
    }
    if (!row.priceId) {
      out[row.plan] = { ok: false, reason: 'env_missing' };
      continue;
    }
    const check = await validateStripePriceForMode(row.priceId, row.sessionMode, row.plan);
    out[row.plan] = { priceId: row.priceId, sessionMode: row.sessionMode, ...check };
  }
  return res.status(200).json({ ok: true, plans: out });
});

/**
 * Stripe PaymentIntents + ISO 20022 メタデータ。
 * - 人間 (X-KAIROS-Payer: human): UI 決済用 clientSecret を返す。
 * - AI エージェント (X-KAIROS-Payer: agent): 初回 402 + PAYMENT-REQUIRED (x402)、署名後は Stripe で検証。
 */
app.post('/api/payment-intent', async (req, res) => {
  if (!stripe || !process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'stripe_not_configured' });
  }

  const payer = String(req.get('x-kairos-payer') || 'human').toLowerCase();
  let tierId = req.body && req.body.tier;
  if (!tierId && payer === 'human') tierId = 'consumer';
  if (!PricingEngine.isValidTier(tierId)) {
    return res.status(400).json({ error: 'invalid_or_missing_tier', allowed: ['consumer', 'agent'] });
  }

  let quote;
  try {
    quote = pricingEngine.quote(tierId);
  } catch (e) {
    return res.status(400).json({ error: e.code || 'invalid_tier' });
  }

  const clientReferenceId = String((req.body && req.body.clientReferenceId) || `anon-${Date.now()}`).slice(0, 200);
  const isoMeta = defaultMetadataForKairos(clientReferenceId, quote.tierId);

  if (payer === 'agent') {
    const sigHeader = req.get('payment-signature');
    if (sigHeader) {
      if (!req.body || !req.body.tier) {
        return res.status(400).json({ error: 'tier_required_for_agent_verification' });
      }
      const decoded = decodePaymentSignatureHeader(sigHeader);
      const piId = extractStripePaymentIntentId(decoded);
      if (!piId) {
        return res.status(400).json({ error: 'invalid_payment_signature' });
      }
      let retrieved;
      try {
        retrieved = await stripe.paymentIntents.retrieve(piId);
      } catch (e) {
        return res.status(400).json({ error: 'payment_intent_retrieve_failed', message: e.message });
      }
      if (retrieved.status !== 'succeeded') {
        return res.status(402).json({ error: 'payment_not_settled', status: retrieved.status });
      }
      if (retrieved.currency !== quote.currency || retrieved.amount !== quote.amountMinor) {
        return res.status(400).json({ error: 'amount_mismatch' });
      }
      const metaTier = retrieved.metadata && retrieved.metadata.pricing_tier;
      if (metaTier && metaTier !== quote.tierId) {
        return res.status(400).json({ error: 'tier_mismatch' });
      }
      const settlement = {
        success: true,
        transaction: piId,
        network: 'stripe:payment_intents',
        payer: 'agent',
      };
      res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(settlement), 'utf8').toString('base64'));
      return res.json({
        ok: true,
        paymentIntentId: piId,
        tier: quote.tierId,
        iso20022: { purp: retrieved.metadata && retrieved.metadata.iso20022_purp_cd },
      });
    }
  }

  const metadata = {
    client_reference_id: clientReferenceId,
    pricing_tier: quote.tierId,
    ...isoMeta,
  };

  const idempotencyKey = req.get('idempotency-key') || undefined;

  let pi;
  try {
    const createOpts = {
      amount: quote.amountMinor,
      currency: quote.currency,
      automatic_payment_methods: { enabled: true },
      metadata,
      description: `KAIROS behavioral analytics settlement (${quote.tierId})`,
    };
    pi = idempotencyKey
      ? await stripe.paymentIntents.create(createOpts, { idempotencyKey })
      : await stripe.paymentIntents.create(createOpts);
  } catch (e) {
    return res.status(502).json({ error: 'stripe_create_failed', message: e.message });
  }

  if (payer === 'agent') {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
    const required = buildPaymentRequiredPayload({
      resourceUrl: publicPaymentIntentUrl(req),
      resourceDescription: 'KAIROS programmatic settlement (agent tier)',
      mimeType: 'application/json',
      quote,
      paymentIntent: pi,
      publishableKey,
    });
    res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(required));
    return res.status(402).json({});
  }

  return res.json({
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    currency: quote.currency,
    amountMinor: quote.amountMinor,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    iso20022: {
      purp: metadata.iso20022_purp_cd,
      strd: metadata.iso20022_strd_json,
    },
  });
});

/** Vercel Cron: daily X DM scout candidates (no auto-DM). Auth: Bearer CRON_SECRET */
app.get('/api/cron/dm-scout', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!secret || token !== secret) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const report = await xDmScout.runDmScout({ limit: 5 });
  const markdown = xDmScout.formatReportMarkdown(report);

  let email = { sent: false };
  const notifyEmail = process.env.KAIROS_SCOUT_NOTIFY_EMAIL;
  if (notifyEmail) {
    const day = (report.generatedAt || new Date().toISOString()).slice(0, 10);
    email = await xDmScout.sendNotifyEmail(
      notifyEmail,
      `KAIROS X DM Scout — ${day}`,
      markdown,
    );
  }

  return res.status(200).json({
    ok: report.ok,
    generatedAt: report.generatedAt || new Date().toISOString(),
    candidateCount: report.candidateCount || 0,
    candidates: report.candidates || [],
    email,
    markdown,
  });
});

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

module.exports = app;
