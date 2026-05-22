/**
 * Gemini による構造化深層心理レポート（行動分析）生成と封印用レダクション。
 */

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

const OMEN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    synchronicityScore: { type: 'integer', minimum: 77, maximum: 99 },
    thoughtResonanceVector: { type: 'string' },
    mindTuning: { type: 'string' },
    deepSynchronicity: { type: 'string' },
  },
  required: [
    'synchronicityScore',
    'thoughtResonanceVector',
    'mindTuning',
    'deepSynchronicity',
  ],
  additionalProperties: false,
};

/**
 * @param {Buffer} buf
 * @param {string} mime
 * @returns {import('@google/genai').Part | null}
 */
function bufferToInlinePart(buf, mime) {
  if (!buf || !mime || !ALLOWED_MIME.has(mime)) return null;
  return {
    inlineData: {
      mimeType: mime,
      data: buf.toString('base64'),
    },
  };
}

/**
 * @param {Array<{ buffer?: Buffer, mimetype?: string }>} files
 * @param {string} [pasteText]
 * @returns {{ parts: import('@google/genai').Part[], skipped: string[] }}
 */
function buildAnalysisParts(files, pasteText) {
  const parts = [];
  const skipped = [];
  for (const f of files || []) {
    const mime = String(f.mimetype || '').toLowerCase();
    const p = f.buffer && bufferToInlinePart(f.buffer, mime);
    if (p) parts.push(p);
    else if (f.mimetype) skipped.push(f.mimetype);
  }
  const paste = typeof pasteText === 'string' ? pasteText.trim() : '';
  if (paste) {
    parts.push({
      text: `【コピペ／手入力テキスト】\n${paste.slice(0, 120_000)}`,
    });
  }
  return { parts, skipped };
}

function maskLikeLength(s, cap = 96) {
  const n = Math.min(Math.max(12, (s && s.length) || 24), cap);
  return '█'.repeat(n);
}

/**
 * 決済未完了時: 数値・本文を伏字化（クライアント側ぼかしと併用）。
 * @param {object} full
 */
function sealOmenForResponse(full) {
  return {
    synchronicityScore: null,
    thoughtResonanceVector: maskLikeLength(full.thoughtResonanceVector),
    mindTuning: maskLikeLength(full.mindTuning),
    deepSynchronicity: maskLikeLength(full.deepSynchronicity),
  };
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/**
 * @param {string} raw
 */
function parseOmenJson(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('empty_model_output');
  let t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence) t = fence[1].trim();
  const obj = JSON.parse(t);
  const score = obj.synchronicityScore != null ? obj.synchronicityScore : obj.omen_score;
  return {
    synchronicityScore: clampScore(score),
    thoughtResonanceVector: String(
      obj.thoughtResonanceVector || obj.fate_vector || '',
    ).trim(),
    mindTuning: String(obj.mindTuning || obj.strategic_advice || '').trim(),
    deepSynchronicity: String(obj.deepSynchronicity || obj.leaked_context || '').trim(),
  };
}

/**
 * @param {import('@google/genai').GoogleGenAI} ai
 * @param {string} modelId
 * @param {import('@google/genai').Part[]} parts
 */
async function generateOmenJson(ai, modelId, parts) {
  const result = await ai.models.generateContent({
    model: modelId,
    contents: [
      {
        role: 'user',
        parts: [
          ...parts,
          {
            text:
              '上記は観測素材である。KAIROS のAI自己認知テックとして、深層心理レポートを次の JSON スキーマに厳密に従って出力せよ（説明文やコードフェンスは付与しない）。\n' +
              '- synchronicityScore: 77–99 の整数。励ましのシンクロニシティ・スコアとして解釈せよ。\n' +
              '- thoughtResonanceVector: 思考共鳴ベクトル。簡潔な日本語 1–3 文で。\n' +
              '- mindTuning: マインド・チューニング。温かく実行可能な心の整え方を日本語で。\n' +
              '- deepSynchronicity: 深層シンクロニシティ。今の人生の美しいつながりを日本語で。\n' +
              '禁止: 占い・予兆・運命・学術的冷たい語彙、違法行為の指示、特定個人への攻撃、医療・法律の専門的判断の代行を装う表現。',
          },
        ],
      },
    ],
    config: {
      systemInstruction:
        'あなたは KAIROS のAI自己認知テック・コンパニオンである。語彙は公式体系に整合させよ（行動分析・深層心理・シンクロニシティ・解析解禁）。' +
        '占い・予兆・運命・戦略的助言・深層相関などの旧表現は出力に含めない。',
      responseMimeType: 'application/json',
      responseJsonSchema: OMEN_JSON_SCHEMA,
      temperature: 0.75,
      maxOutputTokens: 2048,
    },
  });

  const raw = result.text;
  return parseOmenJson(raw);
}

module.exports = {
  ALLOWED_MIME,
  buildAnalysisParts,
  sealOmenForResponse,
  generateOmenJson,
};
