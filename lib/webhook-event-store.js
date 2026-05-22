/**
 * Idempotent Stripe webhook handling.
 * Set DATABASE_URL (Postgres) on multi-instance hosts (e.g. Vercel); otherwise an in-memory
 * Set is used (single-process dev only — duplicates possible across cold starts).
 */
const { Pool } = require('pg');

const TABLE = 'processed_webhook_events';

let pool = null;
/** @type {Set<string>|null} */
let memoryIds = null;

function useMemoryStore() {
  return !process.env.DATABASE_URL;
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

async function ensurePgTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id bigserial PRIMARY KEY,
      stripe_event_id text NOT NULL UNIQUE,
      event_type text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      payload_digest text
    );
  `);
}

/**
 * Claims an event idempotently. Returns true if this worker should process the event.
 * @param {string} stripeEventId
 * @param {string} eventType
 * @returns {Promise<boolean>}
 */
async function claimStripeWebhookEvent(stripeEventId, eventType) {
  if (useMemoryStore()) {
    if (!memoryIds) memoryIds = new Set();
    if (memoryIds.has(stripeEventId)) return false;
    memoryIds.add(stripeEventId);
    return true;
  }

  const p = getPool();
  const client = await p.connect();
  try {
    await ensurePgTable(client);
    const ins = await client.query(
      `INSERT INTO ${TABLE} (stripe_event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (stripe_event_id) DO NOTHING
       RETURNING id`,
      [stripeEventId, eventType]
    );
    return ins.rowCount === 1;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { claimStripeWebhookEvent, closePool };
