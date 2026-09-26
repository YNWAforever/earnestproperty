-- Purpose-specific tests never create customer enquiries or SLA events.
CREATE TABLE IF NOT EXISTS staff_notification_test_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_hash text NOT NULL UNIQUE,
 actor_staff_id uuid NOT NULL REFERENCES staff_users(id),
 staff_id uuid NOT NULL REFERENCES staff_users(id),
 transport text NOT NULL CHECK (transport IN ('inbox_private_note','staff_whatsapp')),
 endpoint_id uuid NOT NULL REFERENCES staff_notification_endpoints(id),
 endpoint_version integer NOT NULL,
 message text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_test_preview_expiry ON staff_notification_test_previews(expires_at);

CREATE TABLE IF NOT EXISTS staff_notification_test_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 preview_id uuid NOT NULL REFERENCES staff_notification_test_previews(id),
 actor_staff_id uuid NOT NULL REFERENCES staff_users(id),
 staff_id uuid NOT NULL REFERENCES staff_users(id),
 transport text NOT NULL CHECK (transport IN ('inbox_private_note','staff_whatsapp')),
 endpoint_id uuid NOT NULL REFERENCES staff_notification_endpoints(id),
 endpoint_version integer NOT NULL,
 payload_hash text NOT NULL,
 job_id uuid REFERENCES ops_jobs(id),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','dispatching','accepted','unknown','failed','blocked')),
 claim_id uuid,
 provider_operation_id text,
 evidence_kind text,
 safe_error text,
 accepted_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_test_rate_cap ON staff_notification_test_attempts(actor_staff_id,endpoint_id,created_at DESC);
CREATE INDEX IF NOT EXISTS staff_test_dispatch_state ON staff_notification_test_attempts(state,created_at);
