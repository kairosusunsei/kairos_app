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
const {
  buildPaymentRequiredPayload,
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  extractStripePaymentIntentId,
} = require(path.join(__dirname, '..', 'lib', 'x402-stripe-bridge.js'));
const { logAnalysisDecouplingStream } = require(path.join(__dirname, '..', 'lib', 'analysis-decoupling.js'));

const app = express();

const geo = require(path.join(__dirname, '..', 'lib', 'geo-block.js'));

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

const pricingEngine = new PricingEngine();

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
      console.error('STRIPE_WEBHOOK_SECRET is not configured');
      return response.status(503).json({ received: false, error: 'misconfigured' });
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
 */
app.get('/api/gemini-stream', async (req, res) => {
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
  if (bodyLocale === 'en' || bodyLocale === 'ja') return bodyLocale;
  const acceptLang = req.headers['accept-language'] || 'ja';
  return acceptLang.toLowerCase().startsWith('en') ? 'en' : 'ja';
}

function clampWarmScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 88;
  return Math.min(99, Math.max(77, Math.round(n)));
}

function formatAnalyzePayload(raw) {
  return {
    success: true,
    synchronicityScore: clampWarmScore(
      raw.synchronicityScore != null ? raw.synchronicityScore : raw.score,
    ),
    thoughtResonanceVector: String(
      raw.thoughtResonanceVector || raw.vector || '',
    ).trim(),
    mindTuning: String(raw.mindTuning || raw.advice || '').trim(),
    deepSynchronicity: String(raw.deepSynchronicity || raw.correlation || '').trim(),
  };
}

function warmAnalyzeFallback(locale) {
  if (locale === 'en') {
    return formatAnalyzePayload({
      synchronicityScore: 88,
      thoughtResonanceVector:
        'Your inner rhythm is aligning with a calm, luminous path forward today.',
      mindTuning:
        'Take a deep breath and soften your shoulders. A gentle turning point is already forming within you.',
      deepSynchronicity:
        'Every meaningful coincidence you notice is your mind recognizing a beautiful pattern of connection.',
    });
  }
  return formatAnalyzePayload({
    synchronicityScore: 88,
    thoughtResonanceVector:
      'あなたの内なるリズムが、穏やかで光る前進の方向へと美しく整っています。',
    mindTuning:
      '深く息を吸い込み、肩の力をそっと抜いてください。優しい転換点が、すでに心の中で芽生えています。',
    deepSynchronicity:
      'あなたが感じる偶然の共鳴は、心が美しいつながりのパターンを認識しているサインです。',
  });
}

app.post('/api/analyze', async (req, res) => {
  const locale = getClientLocale(req);
  const userInput =
    (req.body && (req.body.userInput || req.body.inputText)) || 'おまかせ解析';

  if (!process.env.GEMINI_API_KEY) {
    return res.status(200).json(warmAnalyzeFallback(locale));
  }

  const systemInstruction = `
You are "KAIROS," a premium AI self-awareness tech companion (not fortune-telling).
Read the user's current mind state or worry, and craft a warm message that brings emotional relief, self-validation, and a sense of meaningful synchronicity.

【STRICT RULES for the tone of the message】
NEVER use cold, academic, bureaucratic, fortune-telling, or analytical words.
You are strictly BANNED from using words like: "反社会的", "表象", "大衆消費行動", "戦略的助言", "深層相関", "予兆", "占い", "運命", "境界領域", "KPI", "統制", "ベクトル", "目的 (Strategic Objective)", "方策 (Strategic Measure)", "リテラシー", "サブカルチャー", "匿名化".
Speak like a gentle, wise companion who supports self-cognition and emotional clarity.
Reassure the user that they are doing beautifully, that their feelings matter, and that a positive inner turning point is blooming.

【Locale Requirements】
If the client locale is "en" (English), generate all text fields strictly in warm, comforting English.
If the client locale is "ja" (Japanese) or other, generate all text fields strictly in elegant, natural, heartwarming Japanese.

【Character Limits】
synchronicityScore: An encouraging number between 77 and 99. Never return anything below 77.
thoughtResonanceVector: A short, poetic thought-resonance direction. (Under 100 chars in Japanese / Under 30 words in English).
mindTuning: Warm, supportive mind-tuning guidance. (Under 200 chars in Japanese / Under 60 words in English).
deepSynchronicity: A beautiful explanation of deep synchronicity in their life right now. (Under 200 chars in Japanese / Under 60 words in English).
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
              description:
                'Thought resonance vector (思考共鳴ベクトル). Japanese if locale is ja, English if en.',
            },
            mindTuning: {
              type: 'string',
              description:
                'Mind tuning guidance (マインド・チューニング). Japanese if locale is ja, English if en.',
            },
            deepSynchronicity: {
              type: 'string',
              description:
                'Deep synchronicity insight (深層シンクロニシティ). Japanese if locale is ja, English if en.',
            },
          },
          required: [
            'synchronicityScore',
            'thoughtResonanceVector',
            'mindTuning',
            'deepSynchronicity',
          ],
        },
        temperature: 0.85,
        maxOutputTokens: 1000,
        systemInstruction,
      },
      contents: `The user's input: "${userInput}"`,
    });

    const resultData = JSON.parse(response.text);
    return res.status(200).json(formatAnalyzePayload(resultData));
  } catch (error) {
    console.error('KAIROS API Error:', error);
    return res.status(200).json(warmAnalyzeFallback(locale));
  }
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
    return {
      priceId: process.env.STRIPE_PRICE_SUBSCRIPTION,
      sessionMode: 'subscription',
      envName: 'STRIPE_PRICE_SUBSCRIPTION',
    };
  }
  return null;
}

app.get('/api/checkout', async (req, res) => {
  try {
    if (!stripe || !process.env.STRIPE_SECRET_KEY) {
      console.error('Stripe Checkout Error: STRIPE_SECRET_KEY is not configured');
      return res.status(503).send('Stripe Gateway Connection Error');
    }

    const { plan, locale } = req.query;
    const currentLocale = locale || 'ja';
    const resolved = resolveCheckoutPlan(plan);

    if (!resolved) {
      return res.status(400).send('Invalid billing plan selected.');
    }

    const { priceId, sessionMode, envName } = resolved;
    if (!priceId || !String(priceId).startsWith('price_')) {
      console.error(`Stripe Checkout Error: ${envName} is missing or invalid`);
      return res.status(503).send('Stripe Gateway Connection Error');
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: sessionMode,
      locale: currentLocale === 'ja' ? 'ja' : 'auto',
      success_url: 'https://get-kairos.online/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://get-kairos.online/canceled',
    });

    if (!session.url) {
      console.error('Stripe Checkout Error: session.url was empty');
      return res.status(500).send('Stripe Gateway Connection Error');
    }

    return res.redirect(303, session.url);
  } catch (error) {
    console.error('Stripe Checkout Error:', error.message);
    if (error.type) console.error('Stripe Checkout Error type:', error.type);
    if (error.code) console.error('Stripe Checkout Error code:', error.code);
    return res.status(500).send('Stripe Gateway Connection Error');
  }
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

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

module.exports = app;
