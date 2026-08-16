CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Provider credentials, messages, and response payloads remain provider-owned.
-- This application-only table stores only the safe lifecycle outcome needed to
-- make staff identity requests idempotent and visible to operators.
CREATE TABLE IF NOT EXISTS staff_identity_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('invite', 'resend_invitation', 'password_reset', 'session_revocation')),
  actor_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  target_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  target_email text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'succeeded', 'retryable_failure', 'terminal_failure')),
  safe_error_code text,
  request_id uuid NOT NULL,
  retry_after timestamptz,
  provider_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

-- CREATE TABLE IF NOT EXISTS does not backfill constraints on a relation that
-- existed before this migration began, so guards keep a retry safe while still
-- failing loudly for incompatible data.
DO $$
BEGIN
  ALTER TABLE staff_identity_actions
    ADD CONSTRAINT staff_identity_actions_action_check
    CHECK (action IN ('invite', 'resend_invitation', 'password_reset', 'session_revocation'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE staff_identity_actions
    ADD CONSTRAINT staff_identity_actions_state_check
    CHECK (state IN ('pending', 'succeeded', 'retryable_failure', 'terminal_failure'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE staff_identity_actions
    ADD CONSTRAINT staff_identity_actions_idempotency_key_key UNIQUE (idempotency_key);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_identity_actions_target_action_created_at
  ON staff_identity_actions (target_staff_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_identity_actions_pending_retryable
  ON staff_identity_actions (created_at DESC)
  WHERE state IN ('pending', 'retryable_failure');

-- The table is intentionally not available to anonymous/public database roles.
REVOKE ALL ON TABLE staff_identity_actions FROM PUBLIC;
