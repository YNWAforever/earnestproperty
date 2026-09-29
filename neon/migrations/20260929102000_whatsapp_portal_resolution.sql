-- Explicit, reviewed channel-to-source authority. No rows are seeded by this migration.
CREATE TABLE IF NOT EXISTS whatsapp_portal_source_scopes (
  channel_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('28hse_agent_540','propertyhk')),
  scope_id text NOT NULL,
  staff_namespace text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  verified_by uuid NOT NULL REFERENCES staff_users(id),
  verified_at timestamptz NOT NULL,
  verification_ref text NOT NULL CHECK (length(verification_ref) BETWEEN 3 AND 300),
  PRIMARY KEY(channel_id,source,scope_id)
);
CREATE INDEX IF NOT EXISTS wa_portal_scopes_active
  ON whatsapp_portal_source_scopes(channel_id,source) WHERE enabled;

-- Interpretation and source-version evidence is append-only per parser version.
CREATE TABLE IF NOT EXISTS whatsapp_portal_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES whatsapp_inbound_receipts(id),
  parser_version text NOT NULL,
  interpretation jsonb NOT NULL CHECK (jsonb_typeof(interpretation)='object'),
  resolution jsonb NOT NULL CHECK (jsonb_typeof(resolution)='array'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(receipt_id,parser_version)
);
CREATE OR REPLACE FUNCTION wa_portal_interpretation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WA_PORTAL_INTERPRETATION_IMMUTABLE';
END $$;
DROP TRIGGER IF EXISTS wa_portal_interpretation_no_change ON whatsapp_portal_interpretations;
CREATE TRIGGER wa_portal_interpretation_no_change BEFORE UPDATE OR DELETE
  ON whatsapp_portal_interpretations FOR EACH ROW EXECUTE FUNCTION wa_portal_interpretation_immutable();
