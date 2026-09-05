-- Requires explicit disposable/staging migration approval. No provider dispatch is performed here.
CREATE TABLE IF NOT EXISTS whatsapp_outbound_intents (
 id uuid PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id),
 actor_staff_id uuid NOT NULL REFERENCES staff_users(id),
 kind text NOT NULL CHECK (kind IN ('text','template')),
 payload jsonb NOT NULL,
 payload_hash text NOT NULL CHECK (length(payload_hash)=64),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','dispatching','accepted','unknown','failed','cancelled')),
 message_id uuid NOT NULL,
 external_message_id text UNIQUE,
 error text,
 dispatch_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Existing duplicates must be explicitly reconciled before these constraints can be applied.
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_woztell_member_unique ON crm_contacts(whatsapp_member_id) WHERE whatsapp_member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_null_channel_unique ON whatsapp_conversations(woztell_member_id) WHERE channel_id IS NULL AND woztell_member_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS woztell_history_imports (
 id text PRIMARY KEY,
 cursor text,
 completed boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
