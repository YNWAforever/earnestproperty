-- Phase 1 observation only. No historical backfill, provider actions or active defaults.
CREATE TABLE IF NOT EXISTS whatsapp_enquiry_events (
 id uuid PRIMARY KEY,
 dedupe_key text NOT NULL UNIQUE CHECK(length(dedupe_key)=64),
 origin text NOT NULL CHECK(origin='live_webhook'),
 app_id text NOT NULL,
 channel_id text NOT NULL,
 member_id text NOT NULL,
 external_message_id text NOT NULL,
 message_id uuid REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('customer_message','customer_survey_answer','staff_outbound','automated_outbound','unverified_outbound')),
 occurred_at timestamptz,
 received_at timestamptz NOT NULL DEFAULT now(),
 timing text NOT NULL CHECK(timing IN ('fresh','stale','future','invalid_or_missing')),
 identity_quality text NOT NULL CHECK(identity_quality IN ('provider_id','synthetic_ambiguous')),
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 capture_mode text NOT NULL DEFAULT 'observe' CHECK(capture_mode='observe'),
 effects_eligible boolean NOT NULL DEFAULT false CHECK(effects_eligible=false),
 processing_state text NOT NULL DEFAULT 'pending' CHECK(processing_state IN ('pending','observed','suppressed')),
 processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS whatsapp_enquiry_events_pending_idx ON whatsapp_enquiry_events(received_at,id) WHERE processing_state='pending';
COMMENT ON TABLE whatsapp_enquiry_events IS 'Live observation ledger; raw content stays in transcript. Synthetic identity may conflate identical same-time messages. No active effects in Phase 1.';
