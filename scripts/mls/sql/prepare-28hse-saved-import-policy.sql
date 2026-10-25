-- REVIEW ONLY: do NOT execute as part of build or migration automation.
-- Existing primary parser python-v2.2 and all daily-sync settings stay intact.
-- Secondary approval is accepted ONLY by the operator-controlled partial importer.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'));
-- BEGIN PARSER GUARD DDL (also exercised only in disposable-schema tests)
-- Keep the existing 3-column policy FK. Replace only the over-restrictive
-- 4-column FK with an approval guard; receipts retain their REAL parser.
CREATE OR REPLACE FUNCTION mls_saved_capture_receipt_parser_guard_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE receipt mls_ingestion_receipts%ROWTYPE;
DECLARE policy mls_ingestion_policies%ROWTYPE;
BEGIN
  SELECT * INTO receipt FROM mls_ingestion_receipts WHERE id=NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO policy FROM mls_ingestion_policies
    WHERE source=receipt.source AND scope_id=receipt.scope_id
      AND policy_version=receipt.policy_version FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MLS_RECEIPT_POLICY_MISSING'; END IF;
  IF receipt.parser_version=policy.parser_version THEN RETURN NULL; END IF;
  IF receipt.source='28hse_agent_540' AND receipt.scope_id='agent:540'
    AND receipt.policy_version='no-hermes-v2'
    AND receipt.parser_version='saved-capture-import-v1'
    AND NOT receipt.full_snapshot
    AND policy.config#>>'{saved_capture_import,parser_version}'='saved-capture-import-v1'
    AND policy.config#>'{saved_capture_import,approved}'='true'::jsonb
    AND length(trim(coalesce(policy.config#>>'{saved_capture_import,approved_by}','')))>0
    AND current_setting('app.saved_capture_import',true)='saved-capture-import-v1'
  THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'MLS_RECEIPT_PARSER_NOT_APPROVED';
END;
$$;
DROP TRIGGER IF EXISTS mls_saved_capture_receipt_parser_guard ON mls_ingestion_receipts;
CREATE CONSTRAINT TRIGGER mls_saved_capture_receipt_parser_guard
  AFTER INSERT OR UPDATE ON mls_ingestion_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION mls_saved_capture_receipt_parser_guard_fn();

-- Preserve the old FK's protection against invalidating accepted primary receipts.
CREATE OR REPLACE FUNCTION mls_primary_parser_preserve_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parser_version IS DISTINCT FROM OLD.parser_version AND EXISTS (
    SELECT 1 FROM mls_ingestion_receipts r WHERE r.source=OLD.source
      AND r.scope_id=OLD.scope_id AND r.policy_version=OLD.policy_version
      AND r.parser_version=OLD.parser_version
  ) THEN RAISE EXCEPTION 'MLS_PRIMARY_PARSER_HAS_RECEIPTS'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mls_primary_parser_preserve ON mls_ingestion_policies;
CREATE TRIGGER mls_primary_parser_preserve BEFORE UPDATE OF parser_version
  ON mls_ingestion_policies FOR EACH ROW EXECUTE FUNCTION mls_primary_parser_preserve_fn();
ALTER TABLE mls_ingestion_receipts DROP CONSTRAINT IF EXISTS mls_receipt_policy_parser_fk;
-- END PARSER GUARD DDL

UPDATE mls_ingestion_policies
SET config = jsonb_set(config, '{saved_capture_import}', jsonb_build_object(
  'parser_version', 'saved-capture-import-v1',
  'approved', true, 'approved_by', 'owner', 'approved_at', now()
)), updated_at = now()
WHERE source = '28hse_agent_540' AND scope_id = 'agent:540'
  AND policy_version = 'no-hermes-v2' AND owner = 'no-hermes-v2'
  AND parser_version = 'python-v2.2'
  AND NOT (config ? 'saved_capture_import');

-- Owner-approved company identity is needed if not already configured.
-- Never replace a partial or explicitly unapproved identity policy.
UPDATE mls_ingestion_policies
SET config = jsonb_set(config, '{company_number_identity}', jsonb_build_object(
  'version', 'company-number-v1', 'approved', true,
  'approved_by', 'owner', 'approved_at', now()
)), updated_at = now()
WHERE source = '28hse_agent_540' AND scope_id = 'agent:540'
  AND policy_version = 'no-hermes-v2' AND owner = 'no-hermes-v2'
  AND parser_version = 'python-v2.2'
  AND NOT (config ? 'company_number_identity');
COMMIT;
-- Idempotent: existing approval members are preserved, including revocations.
-- Missing/different policies are reported by preflight, never inserted here.
-- No estate mappings, publication switches, baselines or primary parser changes.
