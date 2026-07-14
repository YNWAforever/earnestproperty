CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ops_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  permission text NOT NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  payload_version integer NOT NULL CHECK (payload_version > 0),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_summary text,
  idempotency_key text NOT NULL,
  actor_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS ops_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ops_jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'cancelled')),
  error_code text,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS ops_migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id text NOT NULL,
  checksum text NOT NULL,
  plan_summary text NOT NULL,
  schema_fingerprint text NOT NULL,
  approved_by_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  executed_by_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  result text NOT NULL CHECK (result IN ('succeeded', 'failed')),
  request_id uuid NOT NULL,
  error_code text,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ops_audit_logs_request_id
  ON ops_audit_logs (request_id);
CREATE INDEX IF NOT EXISTS idx_ops_audit_logs_created_at
  ON ops_audit_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ops_jobs_queue
  ON ops_jobs (run_after, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_ops_jobs_lease
  ON ops_jobs (lease_expires_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_ops_job_attempts_job_id
  ON ops_job_attempts (job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_ops_migration_runs_request_id
  ON ops_migration_runs (request_id);
CREATE INDEX IF NOT EXISTS idx_ops_migration_runs_migration_id
  ON ops_migration_runs (migration_id, started_at DESC);

CREATE OR REPLACE FUNCTION prevent_ops_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ops_audit_logs is append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'ops_audit_logs_append_only'
      AND tgrelid = 'ops_audit_logs'::regclass
  ) THEN
    CREATE TRIGGER ops_audit_logs_append_only
      BEFORE UPDATE OR DELETE ON ops_audit_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_ops_audit_mutation();
  END IF;
END
$$;
