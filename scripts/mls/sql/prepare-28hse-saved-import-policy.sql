-- REVIEW ONLY. Prepared locally; NOT applied. Not an automatic migration.
-- Owner must review the target, parser handoff, bootstrap approval, and mappings.
-- Identity policy is embedded in config.company_number_identity (no new table).
-- Intentionally do not replace an existing live parser, approvals or mappings.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'));

INSERT INTO mls_ingestion_policies (
 source, scope_id, policy_version, parser_version, owner, publish_enabled,
 bootstrap_approved_at, bootstrap_approved_by, bootstrap_approval_note, id_scope, config
) VALUES (
 '28hse_agent_540', 'agent:540', 'no-hermes-v2', 'saved-capture-import-v1',
 'no-hermes-v2', true, now(), 'owner',
 'Owner-reviewed saved-capture import; selected records only; no absence inference',
 'global', jsonb_build_object(
   'absence_enabled', false,
   'company_number_identity', jsonb_build_object(
     'version', 'company-number-v1', 'approved', true,
     'approved_by', 'owner', 'approved_at', now()
   ),
   'estate_mappings', '{}'::jsonb
 )
) ON CONFLICT (source, scope_id, policy_version) DO NOTHING;

-- Fill ONLY an entirely absent identity-policy member. Do not override a
-- partially configured or explicitly unapproved policy: preflight reports it.
UPDATE mls_ingestion_policies
SET config = jsonb_set(config, '{company_number_identity}', jsonb_build_object(
  'version', 'company-number-v1', 'approved', true,
  'approved_by', 'owner', 'approved_at', now()
)), updated_at = now()
WHERE source = '28hse_agent_540' AND scope_id = 'agent:540'
  AND policy_version = 'no-hermes-v2'
  AND NOT (config ? 'company_number_identity');
COMMIT;

-- The first insertion intentionally has no estate mappings. Every proposal
-- must be owner-reviewed, matched to the REAL target estate UUID/district and
-- explicitly installed before preflight can pass. No guesses are enabled here.
-- Existing parser mismatches, disabled/bootstrap states and partial policies
-- require a separately reviewed patch; this script deliberately leaves them.
