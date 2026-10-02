# EP-03 strict CRM analysis and action eligibility

The original audit's AI01–03 PASS statuses meant defects were reproduced; that evidence remains immutable. New product tests invert those expectations: test/missing-contact records cannot receive contact suggestions, schema-empty/unknown-enum/illegal-action outputs cannot be recorded as model validated, and even structurally valid model actions must pass the server eligibility policy.

New Zod 3 strict schema requires all five fields, bounded strings/tags, finite confidence in [0,1] and defined enums. Model and fallback share the ordered policy: test → mark test; missing destination → complete contact/review; unverified source → verify/review; service and marketing permission remain separate. Displayed next actions come from a fixed enum label, never a model action string. Model tag suggestions remain suggestions; the existing factual auto-apply allowlist is retained. Test profiles receive score zero.

Server SQL derives contactability, test provenance, source checks, current inbound service window/channel and marketing consent from persisted facts. The prompt contains needed CRM fields and eligibility booleans, excluding raw phone/email/note/token. Unknown contact/source/channel fails closed. Analysis creates no outbound intents or publish effects.

Additive candidate migration `20261003020000_crm_analysis_contract.sql` adds result kind/action type/validation code to profiles. Historical rows remain NULL for new metadata; they are not relabelled as validated. All 83 migrations applied on owned loopback PostgreSQL 17. This is local dry-run evidence, not production application.

Verification: `test:crm-analysis` six PASS, no skip, including actual JSON provider parsing behind mocked HTTP. `test:crm-analysis:db` real full-schema SQL persistence/readback verified test and missing-contact profiles, fallback metadata and zero outbound intents. Existing content-copilot tests and TypeScript pass; lint has zero errors and the three existing React refresh warnings. Logs: `.audit/remediation-20261003/ep03-*`.

EP-04 will independently close current-actor/source-version validation at request/save/apply; EP-03 alone does not establish that capability. Production/provider/model acceptance remains pending. Rollback preserves the action gate and honest result kind, retains additive columns/history, and may show the previous verified profile; do not restore canned immediate-contact fallback.
