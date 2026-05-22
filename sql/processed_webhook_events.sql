-- Idempotent Stripe webhook processing (physical deduplication by event id).
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id bigserial PRIMARY KEY,
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_digest text
);

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_received_at
  ON processed_webhook_events (received_at DESC);
