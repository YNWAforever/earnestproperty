-- Additive execution metadata; existing receipts remain the ingestion authority.
-- Rollback disables dispatch/reporting; retain these records and existing inventory.
CREATE TABLE IF NOT EXISTS property_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source text NOT NULL CHECK(source IN ('28hse_agent_540','propertyhk')),
 scope_id text NOT NULL,
 workflow_run_id text CHECK(workflow_run_id ~ '^[0-9]{1,30}$'),
 workflow_attempt integer NOT NULL DEFAULT 1 CHECK(workflow_attempt BETWEEN 1 AND 1000),
 UNIQUE(workflow_run_id,workflow_attempt),
 git_sha text CHECK(git_sha ~ '^[a-f0-9]{40}$'),
 operation text NOT NULL DEFAULT 'collect' CHECK(operation IN ('collect','ingestion','publication')),
 idempotency_key uuid UNIQUE,
 requested_by uuid REFERENCES staff_users(id),
 dispatch_status text NOT NULL DEFAULT 'not_requested' CHECK(dispatch_status IN ('not_requested','reserved','accepted','failed','unknown')),
 request_asset text CHECK(request_asset ~ '^request-[0-9]+-[0-9]+\.json$'),
 request_hash text CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 receipt_id uuid REFERENCES mls_ingestion_receipts(id),
 stages jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(stages)='object'),
 branches jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(branches)='object'),
 counts jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(counts)='object'),
 error_code text CHECK(error_code ~ '^[A-Za-z0-9_]{1,100}$'),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), revision bigint NOT NULL DEFAULT 1,
 CHECK((source='28hse_agent_540' AND scope_id='agent:540') OR (source='propertyhk' AND scope_id='branches:EPW,EPS,EPT'))
);
CREATE INDEX IF NOT EXISTS property_sync_runs_history ON property_sync_runs(started_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS property_sync_runs_source_history ON property_sync_runs(source,started_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS mls_ingestion_receipts_accepted_history ON mls_ingestion_receipts(accepted_at DESC,id DESC) WHERE full_snapshot;

CREATE OR REPLACE FUNCTION reserve_property_sync_operation(p_source text,p_operation text,p_key uuid,p_actor uuid,p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_existing property_sync_runs%ROWTYPE;v_base property_sync_runs%ROWTYPE;v_new property_sync_runs%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=p_actor AND s.active AND r.role::text='admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF p_source NOT IN ('28hse_agent_540','propertyhk') OR p_operation NOT IN ('collect','ingestion','publication') OR p_key IS NULL THEN RAISE EXCEPTION 'INVALID_OPERATION';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('earnestproperty:sync-dispatch:'||p_source));
 SELECT * INTO v_existing FROM property_sync_runs WHERE idempotency_key=p_key;
 IF FOUND THEN
   IF v_existing.source<>p_source OR v_existing.operation<>p_operation OR v_existing.requested_by<>p_actor THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
   RETURN to_jsonb(v_existing)||jsonb_build_object('newly_reserved',false);
 END IF;
 IF p_operation='collect' AND EXISTS(SELECT 1 FROM property_sync_runs WHERE source=p_source AND stages::text LIKE '%"unknown"%') THEN RAISE EXCEPTION 'SYNC_OPERATION_UNKNOWN_RECONCILE';END IF;
 IF EXISTS(SELECT 1 FROM property_sync_runs WHERE source=p_source AND dispatch_status IN ('reserved','accepted','unknown') AND finished_at IS NULL) THEN RAISE EXCEPTION 'SYNC_OPERATION_IN_PROGRESS_RECONCILE';END IF;
 IF EXISTS(SELECT 1 FROM property_sync_runs WHERE requested_by=p_actor AND started_at>clock_timestamp()-interval '1 minute') THEN RAISE EXCEPTION 'SYNC_OPERATION_RATE_LIMIT';END IF;
 IF p_operation<>'collect' THEN
   SELECT * INTO v_base FROM property_sync_runs WHERE id=p_run AND source=p_source;
   IF NOT FOUND OR v_base.request_asset IS NULL OR v_base.request_hash IS NULL THEN RAISE EXCEPTION 'EXACT_FROZEN_REQUEST_REQUIRED';END IF;
   IF p_operation='publication' AND NOT EXISTS(SELECT 1 FROM mls_ingestion_receipts r JOIN mls_ingestion_scopes s ON s.full_receipt_id=r.id WHERE r.id=v_base.receipt_id AND r.full_snapshot AND r.payload_hash=v_base.request_hash AND r.response->>'success'='true') THEN RAISE EXCEPTION 'CURRENT_FULL_RECEIPT_REQUIRED';END IF;
 END IF;
 INSERT INTO property_sync_runs(source,scope_id,operation,idempotency_key,requested_by,dispatch_status,request_asset,request_hash,receipt_id)
 VALUES(p_source,CASE p_source WHEN 'propertyhk' THEN 'branches:EPW,EPS,EPT' ELSE 'agent:540' END,p_operation,p_key,p_actor,'reserved',v_base.request_asset,v_base.request_hash,v_base.receipt_id) RETURNING * INTO v_new;
 INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(p_actor,'property.sync.request','property_sync_run',v_new.id,jsonb_build_object('source',p_source,'operation',p_operation,'requestRun',p_run));
 RETURN to_jsonb(v_new)||jsonb_build_object('newly_reserved',true);
END $$;
