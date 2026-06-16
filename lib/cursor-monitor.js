/**
 * Cursor 公式ページ監視 — changelog / pricing / blog の変化を検知し日本語レポートを生成。
 * 初回実行はベースライン保存のみ（メールなし）。2回目以降で変化があれば通知。
 */

const crypto = require('crypto');
const { Pool } = require('pg');

const SOURCES = [
  { id: 'changelog', url: 'https://cursor.com/changelog', label: '変更履歴 (changelog)' },
  { id: 'pricing', url: 'https://cursor.com/pricing', label: '料金 (pricing)' },
  { id: 'blog', url: 'https://cursor.com/blog', label: '公式ブログ (blog)' },
];

const FETCH_TIMEOUT_MS = 20000;

const RED_PATTERNS = [
  { re: /spacex|acqui(sition|re)|merger|anysphere/i, note: 'SpaceX / Anysphere 買収関連' },
  { re: /deprecat|discontinu|sunset|shut\s*down|end\s+of\s+life/i, note: '機能廃止・サービス終了の可能性' },
  { re: /remove\s+(claude|gpt|openai|anthropic)/i, note: '外部モデル利用の制限・削除' },
  { re: /price\s+increase|raising\s+prices|higher\s+pricing/i, note: '値上げの明示' },
  { re: /grok\s+only|exclusive\s+to\s+grok/i, note: 'Grok 限定化の可能性' },
];

const YELLOW_PATTERNS = [
  { re: /\$?\d+\s*\/\s*mo|per\s+seat|teams?\s+premium|pro\+|ultra/i, note: '料金・プラン変更' },
  { re: /usage\s+limit|token\s+limit|rate\s+limit|included\s+usage|billing/i, note: '利用枠・課金ルール' },
  { re: /composer|mcp|hooks?|skills?|cloud\s+agent/i, note: '開発機能（Composer / MCP / Hooks）' },
  { re: /model\s+access|frontier\s+model|third[- ]party/i, note: 'モデル提供・API連携' },
];

let pool = null;

function usePg() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!usePg()) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  }
  return pool;
}

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cursor_watch_snapshots (
      source_id text PRIMARY KEY,
      content_hash text NOT NULL,
      content_preview text,
      fetched_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS cursor_watch_runs (
      id serial PRIMARY KEY,
      generated_at timestamptz NOT NULL DEFAULT now(),
      changes_detected integer NOT NULL DEFAULT 0,
      baseline_only boolean NOT NULL DEFAULT false,
      report_json jsonb
    );
  `);
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function preview(text, max = 480) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'KAIROS-CursorWatch/1.0 (+https://get-kairos.online)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const html = await res.text();
    return htmlToText(html);
  } finally {
    clearTimeout(timer);
  }
}

async function loadSnapshots() {
  if (!usePg()) return {};
  const p = getPool();
  const client = await p.connect();
  try {
    await ensureTables(client);
    const { rows } = await client.query(
      `SELECT source_id, content_hash, content_preview, fetched_at
       FROM cursor_watch_snapshots`,
    );
    const map = {};
    for (const row of rows) {
      map[row.source_id] = row;
    }
    return map;
  } finally {
    client.release();
  }
}

async function saveSnapshot(sourceId, hash, textPreview) {
  if (!usePg()) return { persisted: false };
  const p = getPool();
  const client = await p.connect();
  try {
    await ensureTables(client);
    await client.query(
      `INSERT INTO cursor_watch_snapshots (source_id, content_hash, content_preview, fetched_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (source_id) DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         content_preview = EXCLUDED.content_preview,
         fetched_at = now()`,
      [sourceId, hash, textPreview],
    );
    return { persisted: true };
  } finally {
    client.release();
  }
}

async function saveRun(report) {
  if (!usePg()) return { persisted: false };
  const p = getPool();
  const client = await p.connect();
  try {
    await ensureTables(client);
    const ins = await client.query(
      `INSERT INTO cursor_watch_runs (generated_at, changes_detected, baseline_only, report_json)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        report.generatedAt,
        report.changes.length,
        report.baselineOnly,
        report,
      ],
    );
    return { persisted: true, runId: ins.rows[0].id };
  } finally {
    client.release();
  }
}

function assessImpact(changeTexts) {
  const combined = changeTexts.join('\n');
  const redHits = [];
  const yellowHits = [];

  for (const p of RED_PATTERNS) {
    if (p.re.test(combined)) redHits.push(p.note);
  }
  for (const p of YELLOW_PATTERNS) {
    if (p.re.test(combined)) yellowHits.push(p.note);
  }

  const systems = [
    {
      name: 'KAIROS 本番サイト (get-kairos.online)',
      level: 'green',
      note: 'Vercel 上で動作。Cursor の変更とは独立。',
    },
    {
      name: 'Stripe 決済・紹介ボーナス (+1回)',
      level: 'green',
      note: '影響なし。',
    },
    {
      name: 'Neon Postgres（クレジット台帳）',
      level: 'green',
      note: '影響なし。',
    },
    {
      name: 'Gemini API（解析エンジン）',
      level: 'green',
      note: 'Cursor とは別契約。通常は影響なし。',
    },
    {
      name: 'Cursor 開発環境（このリポジトリの編集・デプロイ）',
      level: redHits.length ? 'red' : yellowHits.length ? 'yellow' : 'green',
      note: redHits.length
        ? '料金・機能・モデル提供に重大な変更の可能性。早めに changelog を確認してください。'
        : yellowHits.length
          ? '開発時の利用枠・料金・機能に変化の可能性。次回作業前に確認推奨。'
          : '現時点で重大な影響は検出されていません。',
    },
  ];

  let overall = 'green';
  if (redHits.length) overall = 'red';
  else if (yellowHits.length) overall = 'yellow';

  return { overall, redHits, yellowHits, systems };
}

const LEVEL_LABEL = {
  green: '🟢 影響なし',
  yellow: '🟡 要確認',
  red: '🔴 要対応',
};

function formatJapaneseReport(report) {
  const lines = [];
  const now = report.generatedAt || new Date().toISOString();
  const jst = new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  lines.push('KAIROS Cursor 監視レポート');
  lines.push(`検出日時: ${jst} (JST)`);
  lines.push('');

  if (report.baselineOnly) {
    lines.push('【初回ベースライン保存】');
    lines.push('監視を開始しました。次回以降、ページに変化があればこのメールでお知らせします。');
    lines.push('');
    for (const s of report.sources) {
      lines.push(`- ${s.label}: 保存済み (${s.hash.slice(0, 12)}…)`);
    }
    return lines.join('\n');
  }

  if (!report.changes.length) {
    lines.push('【変化なし】');
    lines.push('changelog / pricing / blog に前回からの変更はありません。');
    return lines.join('\n');
  }

  lines.push(`【変更を ${report.changes.length} 件検出】`);
  lines.push('');

  for (const ch of report.changes) {
    lines.push(`■ ${ch.label}`);
    lines.push(`  URL: ${ch.url}`);
    lines.push(`  前回取得: ${ch.previousAt || '（初回）'}`);
    lines.push(`  抜粋: ${ch.previewNew}`);
    lines.push('');
  }

  const impact = report.impact;
  lines.push('■ あなたのシステムへの影響（自動判定）');
  lines.push(`  総合: ${LEVEL_LABEL[impact.overall] || impact.overall}`);
  if (impact.redHits.length) {
    lines.push(`  重大キーワード: ${impact.redHits.join(' / ')}`);
  }
  if (impact.yellowHits.length) {
    lines.push(`  注意キーワード: ${impact.yellowHits.join(' / ')}`);
  }
  lines.push('');

  for (const sys of impact.systems) {
    lines.push(`  ${LEVEL_LABEL[sys.level]} ${sys.name}`);
    lines.push(`    → ${sys.note}`);
  }
  lines.push('');

  lines.push('■ 推奨アクション');
  if (impact.overall === 'red') {
    lines.push('  1. cursor.com/changelog を開いて詳細を確認');
    lines.push('  2. Cursor ダッシュボードで料金・利用枠を確認');
    lines.push('  3. 必要なら Claude Code 等の代替を検討');
    lines.push('  4. KAIROS 本番は独立しているため、ユーザー向けサービスは継続可能');
  } else if (impact.overall === 'yellow') {
    lines.push('  1. 次の開発作業前に changelog を確認');
    lines.push('  2. 利用枠に不安があれば cursor.com/dashboard を確認');
    lines.push('  3. KAIROS 本番への影響は通常ありません');
  } else {
    lines.push('  今すぐの対応は不要です。念のため changelog を一読してください。');
  }

  lines.push('');
  lines.push('---');
  lines.push('このメールは KAIROS 自動監視 (cursor-watch) から送信されています。');
  lines.push('停止する場合は Vercel の Cron 設定を無効化してください。');

  return lines.join('\n');
}

/**
 * @param {{ now?: Date }} [opts]
 */
async function runCursorWatch(opts) {
  const now = (opts && opts.now) || new Date();
  const generatedAt = now.toISOString();
  const previous = await loadSnapshots();

  const sources = [];
  const changes = [];
  const errors = [];
  let baselineNeeded = false;

  for (const src of SOURCES) {
    try {
      const text = await fetchPageText(src.url);
      const hash = contentHash(text);
      const textPreview = preview(text);
      const prev = previous[src.id];

      sources.push({
        id: src.id,
        label: src.label,
        url: src.url,
        hash,
        fetchedAt: generatedAt,
      });

      if (!prev) {
        baselineNeeded = true;
        await saveSnapshot(src.id, hash, textPreview);
        continue;
      }

      if (prev.content_hash !== hash) {
        changes.push({
          id: src.id,
          label: src.label,
          url: src.url,
          previousAt: prev.fetched_at,
          previewOld: prev.content_preview || '',
          previewNew: textPreview,
        });
      }

      await saveSnapshot(src.id, hash, textPreview);
    } catch (err) {
      errors.push({ sourceId: src.id, label: src.label, error: err.message });
    }
  }

  const baselineOnly = baselineNeeded && changes.length === 0;
  const changeTexts = changes.map((c) => `${c.previewNew} ${c.previewOld}`);
  const impact = changes.length ? assessImpact(changeTexts) : { overall: 'green', redHits: [], yellowHits: [], systems: [] };

  const report = {
    ok: errors.length < SOURCES.length,
    generatedAt,
    baselineOnly,
    changes,
    sources,
    errors,
    impact,
    changeCount: changes.length,
  };

  report.text = formatJapaneseReport(report);

  try {
    report.persistence = await saveRun(report);
  } catch (err) {
    report.persistence = { persisted: false, error: err.message };
  }

  return report;
}

module.exports = {
  runCursorWatch,
  formatJapaneseReport,
  SOURCES,
};
