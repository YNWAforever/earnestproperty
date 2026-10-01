-- Additive minimum intake store. It does not depend on optional enquiry, jobs or
-- notification schema. Normalized evidence is restricted to the server access path.
CREATE TABLE IF NOT EXISTS whatsapp_inbound_receipts (
  id uuid PRIMARY KEY,
  tenant_key text NOT NULL,
  provider text NOT NULL,
  app_id text NOT NULL,
  channel_id text NOT NULL,
  member_id text,
  event_kind text NOT NULL,
  origin text NOT NULL,
  provider_message_id text,
  identity_key text,
  similarity_key text NOT NULL,
  normalized_event jsonb NOT NULL,
  body_digest text NOT NULL,
  capture_mode text NOT NULL CHECK (capture_mode IN ('off','observe','active')),
  activation_id uuid,
  effects_eligible boolean NOT NULL DEFAULT false,
  provider_occurred_at timestamptz,
  received_at timestamptz NOT NULL,
  projection_state text NOT NULL DEFAULT 'pending'
    CHECK (projection_state IN ('pending','projected','blocked_schema','failed')),
  block_reason text,
  attempt_count integer NOT NULL DEFAULT 1,
  lease_until timestamptz,
  projected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_inbound_receipts_repair
  ON whatsapp_inbound_receipts (received_at,id)
  WHERE projection_state IN ('pending','blocked_schema','failed');
CREATE INDEX IF NOT EXISTS wa_inbound_receipts_similarity
  ON whatsapp_inbound_receipts (tenant_key,app_id,channel_id,similarity_key,received_at);
