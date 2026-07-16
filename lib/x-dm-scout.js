/**
 * X (Twitter) DM outreach candidate scout — manual-DM workflow helper.
 * Requires X API Bearer Token (Basic tier+ for search). Does NOT auto-send DMs.
 */

const BLOCKED_BIO = /占い|鑑定|霊視|タロット|fortune tell|psychic reading|mlm|副業で億|crypto signal/i;
const POSITIVE_BIO =
  /journal|journaling|psychology|cognitive|mindful|self.?insight|言語化|ジャーナリング|自己理解|深層心理|認知|習慣|metacog|synchronicity|ライティング|writer/i;

const SITE_URL = String(process.env.KAIROS_PUBLIC_URL || 'https://get-kairos.online').replace(
  /\/$/,
  '',
);

const SEARCH_QUERIES = [
  '(ジャーナリング OR 自己理解 OR 言語化) -is:retweet lang:ja',
  '(journaling OR "self insight" OR metacognition) -is:retweet lang:en',
  '(cognitive bias OR behavioral) (psychology OR habits) -is:retweet lang:en',
];

function ownerInviteUrl() {
  const ref = String(process.env.KAIROS_OWNER_REF || '').trim();
  if (ref && /^kairos_[a-z0-9_-]+$/i.test(ref)) {
    return `${SITE_URL}/invite?ref=${encodeURIComponent(ref)}`;
  }
  return `${SITE_URL}/`;
}

/**
 * 投稿から短いフック語を拾う（一斉コピペ感を減らす）。
 * @param {string} sample
 */
function tweetHookPhrase(sample) {
  const t = String(sample || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const slice = t.slice(0, 24);
  return slice.length < t.length ? `${slice}…` : slice;
}

/**
 * 手動DM/リプ用ドラフト（自動送信しない）。
 * 方針: 公開リプ優先・初手は問いのみ（URL/製品名なし）・紹介は2往復後。
 * 体験捏造なし。感情の型（情景・問い・リズム）で人間味を出す。
 * @param {{ username?: string, name?: string, sampleTweet?: string }} [candidate]
 */
function buildDmDrafts(candidate) {
  const user = candidate && candidate.username ? `@${candidate.username}` : '（候補の@名）';
  const name = (candidate && candidate.name) || '';
  const sample = (candidate && candidate.sampleTweet) || '';
  const invite = ownerInviteUrl();
  const hook = tweetHookPhrase(sample);
  const who = name ? `${name}さん、` : '';

  const jaOpen = hook
    ? `${who}「${hook}」——同じ悩みが戻る夜って、出来事より先に「またこの感覚か」が来る。\nあなたは、その感覚に名前をつけてますか？`
    : `${who}同じ悩みが戻る夜って、出来事より先に「またこの感覚か」が来る。\nあなたは、その感覚に名前をつけてますか？`;

  const enOpen = hook
    ? `Hi${name ? ` ${name}` : ''} — “${hook}”\nWhen the same worry returns, the feeling arrives before the story.\nDo you have a name for that feeling?`
    : `Hi${name ? ` ${name}` : ''} — when the same worry returns, the feeling arrives before the story.\nDo you have a name for that feeling?`;

  return {
    ja: [
      {
        id: 'A-open',
        label: '① 問いオープナー（URL・製品名なし／リプ推奨・DMは相手反応後）',
        text: jaOpen,
      },
      {
        id: 'B-soft',
        label: '② ソフト紹介（2往復あと・興味が出てから／成約導線）',
        text: `${user} さん、ありがとうございます。\n「名前のない不安」を1行にして眺める用に KAIROS があります。今日1回、無料でスコアと抜粋まで。\n見たいときだけ → ${invite}\n不要なら無視で大丈夫です。`,
      },
      {
        id: 'C-ja-short',
        label: '③ 公開リプ短文（製品名なし・主戦場）',
        text: `同じ悩みが戻るとき、状況より「反応の型」を1語でメモすると、少し輪郭が出ることがあります。あなたは何を書いてますか？`,
      },
    ],
    en: [
      {
        id: 'A-en-open',
        label: '① Question opener (no URL / no product — reply first)',
        text: enOpen,
      },
      {
        id: 'B-en-soft',
        label: '② Soft intro (after 2 replies — free preview CTA)',
        text: `Thanks${name ? ` ${name}` : ''}.\nKAIROS turns one line into a free daily preview (score + excerpt) for recurring patterns.\nOnly if useful: ${invite} — otherwise ignore, totally fine.`,
      },
      {
        id: 'C-en-short',
        label: '③ Public reply short (no product — primary)',
        text: `When the same worry returns, naming the reaction in one word often helps more than retelling the story. What do you write down?`,
      },
    ],
  };
}

function attachDmDrafts(report) {
  const drafts = buildDmDrafts();
  const manualDrafts = drafts;

  if (!report.candidates || report.candidates.length === 0) {
    return { ...report, dmDrafts: manualDrafts, perCandidateDrafts: [] };
  }

  const perCandidateDrafts = report.candidates.map((c) => ({
    username: c.username,
    profileUrl: c.profileUrl,
    drafts: buildDmDrafts(c),
  }));

  return { ...report, dmDrafts: manualDrafts, perCandidateDrafts };
}

/**
 * @param {object} user
 * @param {object} tweet
 */
function scoreCandidate(user, tweet) {
  const bio = String(user.description || '');
  if (BLOCKED_BIO.test(bio)) return -1;

  let score = 0;
  if (POSITIVE_BIO.test(bio)) score += 4;

  const metrics = tweet.public_metrics || {};
  const likes = Number(metrics.like_count || 0);
  const replies = Number(metrics.reply_count || 0);
  score += Math.min(6, Math.floor(Math.log10(likes + 1) * 2));
  score += Math.min(3, replies);

  const followers = Number(user.public_metrics && user.public_metrics.followers_count);
  if (followers >= 500 && followers <= 50000) score += 3;
  else if (followers > 50 && followers < 500) score += 2;

  if (user.verified) score -= 2;
  return score;
}

/**
 * @param {string} bearerToken
 * @param {string} query
 * @param {number} maxResults
 */
async function searchRecentTweets(bearerToken, query, maxResults) {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(100, Math.max(10, maxResults))),
    'tweet.fields': 'author_id,public_metrics,created_at,text',
    expansions: 'author_id',
    'user.fields': 'username,name,description,public_metrics,verified',
  });

  const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API search failed (${res.status}): ${body.slice(0, 400)}`);
  }

  return res.json();
}

/**
 * @param {object} payload
 * @returns {Array<{ username: string, name: string, score: number, bio: string, sampleTweet: string, profileUrl: string, searchQuery: string }>}
 */
function extractCandidates(payload, query) {
  const usersById = new Map();
  for (const u of payload.includes && payload.includes.users ? payload.includes.users : []) {
    usersById.set(u.id, u);
  }

  const seen = new Set();
  const out = [];

  for (const tweet of payload.data || []) {
    const user = usersById.get(tweet.author_id);
    if (!user || !user.username) continue;
    if (seen.has(user.id)) continue;
    seen.add(user.id);

    const score = scoreCandidate(user, tweet);
    if (score < 0) continue;

    out.push({
      username: user.username,
      name: user.name || user.username,
      score,
      bio: String(user.description || '').slice(0, 200),
      sampleTweet: String(tweet.text || '').replace(/\s+/g, ' ').slice(0, 180),
      profileUrl: `https://x.com/${user.username}`,
      searchQuery: query,
    });
  }

  return out;
}

/**
 * @param {{ bearerToken?: string, limit?: number }} [opts]
 */
async function runDmScout(opts) {
  const bearerToken = (opts && opts.bearerToken) || process.env.X_BEARER_TOKEN || '';
  const limit = (opts && opts.limit) || 5;

  if (!bearerToken) {
    return attachDmDrafts({
      ok: false,
      reason: 'missing_x_bearer_token',
      message: 'Set X_BEARER_TOKEN (X API v2 Bearer). Search requires Basic tier or higher.',
      candidates: [],
      candidateCount: 0,
      generatedAt: new Date().toISOString(),
      manualSearchUrls: SEARCH_QUERIES.map(
        (q) => `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`,
      ),
    });
  }

  const all = [];
  for (const query of SEARCH_QUERIES) {
    try {
      const payload = await searchRecentTweets(bearerToken, query, 25);
      all.push(...extractCandidates(payload, query));
    } catch (err) {
      console.error('[x-dm-scout] query failed', query, err.message);
    }
  }

  const ranked = [...all]
    .sort((a, b) => b.score - a.score)
    .filter((row, idx, arr) => arr.findIndex((x) => x.username === row.username) === idx)
    .slice(0, limit);

  return attachDmDrafts({
    ok: true,
    generatedAt: new Date().toISOString(),
    candidateCount: ranked.length,
    candidates: ranked,
    manualSearchUrls: SEARCH_QUERIES.map(
      (q) => `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`,
    ),
  });
}

function appendDmDraftSection(lines, drafts, title) {
  lines.push(`## ${title}`, '');
  for (const d of drafts.ja || []) {
    lines.push(`### ${d.label}`, '', '```', d.text, '```', '');
  }
  if (drafts.en && drafts.en.length) {
    lines.push('### English variants', '');
    for (const d of drafts.en) {
      lines.push(`**${d.label}**`, '', '```', d.text, '```', '');
    }
  }
}

function formatReportMarkdown(report) {
  const seoWeekly = require('./seo-weekly-loop.js');
  const lines = [
    `# KAIROS X DM Scout — ${report.generatedAt || new Date().toISOString()}`,
    '',
    '> Manual DM only. No auto-send. Review each profile before contacting.',
    '',
  ];

  if (!report.ok) {
    lines.push(`**Status:** ${report.reason}`, '', report.message || '', '');
    lines.push('## Manual search URLs（今日の5人をここから選ぶ）', '');
    for (const url of report.manualSearchUrls || []) {
      lines.push(`- ${url}`);
    }
    lines.push('', '---', '');
    appendDmDraftSection(lines, report.dmDrafts || buildDmDrafts(), 'DM文例（コピペ用・手動送信）');
    lines.push(
      '**運用:** 公開リプ③/①を優先 / DMは相手が先に反応した人だけ / ①は問いのみ→2往復後に②（無料プレビューCTA） / 1日最大5通 / テンプレ一斉送信禁止',
      '',
    );
    seoWeekly.appendWeeklySeoChecklistIfMonday(lines);
    return lines.join('\n');
  }

  lines.push(`**Candidates:** ${report.candidateCount}`, '');
  (report.perCandidateDrafts || []).forEach((row, i) => {
    const c = report.candidates[i];
    lines.push(
      `## ${i + 1}. @${c.username} (score ${c.score})`,
      `- Profile: ${c.profileUrl}`,
      `- Name: ${c.name}`,
      `- Bio: ${c.bio || '(empty)'}`,
      `- Sample: ${c.sampleTweet}`,
      `- Found via: \`${c.searchQuery}\``,
      '',
    );
    appendDmDraftSection(lines, row.drafts, `DM文例 for @${c.username}`);
  });

  lines.push('## Manual search URLs', '');
  for (const url of report.manualSearchUrls || []) {
    lines.push(`- ${url}`);
  }
  lines.push(
    '',
    '**運用:** 公開リプ③/①を優先 / DMは相手が先に反応した人だけ / ①は問いのみ→2往復後に②（無料プレビューCTA） / 1日最大5通 / テンプレ一斉送信禁止',
    '',
  );
  seoWeekly.appendWeeklySeoChecklistIfMonday(lines);

  return lines.join('\n');
}

/**
 * @param {string} toEmail
 * @param {string} subject
 * @param {string} textBody
 * @param {{ from?: string }} [opts]
 */
async function sendNotifyEmail(toEmail, subject, textBody, opts) {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    (opts && opts.from) ||
    process.env.KAIROS_GROWTH_EMAIL_FROM ||
    process.env.KAIROS_SCOUT_EMAIL_FROM ||
    'KAIROS <onboarding@resend.dev>';
  if (!apiKey || !toEmail) return { sent: false, reason: 'missing_resend_or_email' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject,
      text: textBody,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { sent: false, reason: `resend_${res.status}`, detail: errText.slice(0, 200), from };
  }

  let id = null;
  try {
    const json = await res.json();
    id = json && json.id ? json.id : null;
  } catch {
    /* ignore */
  }

  return { sent: true, id, from };
}

module.exports = {
  runDmScout,
  formatReportMarkdown,
  sendNotifyEmail,
  buildDmDrafts,
  SEARCH_QUERIES,
  ownerInviteUrl,
};
