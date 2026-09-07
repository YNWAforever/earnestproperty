# Company-number ingestion readiness — 2026-09-07

## Implemented rules

- Explicit 28hse agent-provided company number identifies a property; numeric advertisement IDs remain separate source links. Existing source IDs resolve first.
- Sale and rent share the public property group but retain separate offer state. Existing UUIDs, aliases, media and staff overrides are preserved.
- New inventory starts as draft. Unknown district mappings remain staged. Property.hk matching policy is unchanged.
- Multiple advertisements for one company number and deal can share a canonical offer only when their material facts agree. Price or explicit terminal-state conflicts hold projection for review.
- Legacy field adoption requires exact agreement with the archived source baseline and preserves manual ownership. Collection completeness, count-drop, atomic receipt, replay and stale-batch safeguards remain enforced.
- Python parser version 2.2 is required by the daily workflow. Apply validates the approved direct Neon host and rejects unsupported connection query parameters before importing.

## Evidence

The frozen live collection from 2026-09-06T19:16:21.080323Z was reprocessed offline: 247 advertisements, 174 company numbers and 183 company/deal groups, with zero rejected records. This is not a new live collection. Two groups require price review: B069572 sale and A034601 sale.

Scoped database comparison found 104 existing company groups and 70 absent company numbers; 105 existing offer groups and 78 absent offers. There were no ambiguous public-group matches. An archived legacy-source comparison identified 117 physical rows with at least one matching field eligible for controlled adoption; this is not an applied update count.

Executed checks: Python 60 passed; ingestion Node 65 passed; daily workflow 4 passed; MLS regressions 603 passed; control regressions 95 passed; company database suite 5 passed and existing daily database suite 5 passed in the approved disposable database, run serially. Typecheck, build and scoped lint passed. The target-override regression failed before the fix, passed afterward, and received independent review approval.

## Operational state

The previously authorized additive production migration is recorded in 2026-09-07-daily-production-migration-result.md. This change has not created source links, imported records or enabled the daily apply schedule.

The cloned-production import rehearsal was blocked before execution by automatic approval review because it would set mls_ingestion_policies.publish_enabled=true. Explicit approval for that named ingestion-write switch is still required, first on the rehearsal clone and then production. New inventory remains draft under this policy. No claim is made that an import rehearsal passed.

After approval: rehearse and inspect receipts/draft status on the clone; verify the production target; apply the approved frozen batch; verify replay and canonical identity; then enable daily full collection with differential import. Retain immutable request/receipt evidence. Stop daily apply and disable the source policy to roll back activation; preserve receipts and inventory rather than deleting rows. Data reversal requires a reviewed compensating change.
