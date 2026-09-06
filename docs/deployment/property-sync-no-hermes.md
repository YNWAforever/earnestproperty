# Property ingestion v2 deployment (disabled until approved)

This coding change does not activate a production publisher. The original specification and repository policy mapping are in ../specs/28hse_propertyhk_scraping_merge_spec_no_hermes_v2.md and ../mls-no-hermes-v2-mapping.md.

## Additive schema

The existing HTTP migration runner submits statements separately. For this ingestion migration, use the dedicated-session operator helper so DDL and app_migrations registration commit together. All earlier repository migrations must already be recorded. Default execution is local-only:

```sh
node scripts/mls/migrate-ingestion-v2.mjs
```

Only after operator migration approval, set DATABASE_URL_UNPOOLED through the managed environment and run:

```sh
node scripts/mls/migrate-ingestion-v2.mjs --apply
```

Never put a connection string on the command line. A commit timeout is outcome-unknown: inspect the matching app_migrations row before retrying. The helper skips an already-recorded migration. No downgrade migration removes v2 history or constrains new sources back to the old set.

## Policy boundaries

Schema defaults leave both publisher ownership and publication disabled. Operators must create reviewed versioned source policies before activation. Valid source/scope pairs are 28hse_agent_540 / agent:540 and propertyhk / branches:EPW,EPS,EPT. Each policy fixes parser_version, id_scope and verified source configuration. The receipt parser foreign key prevents changing a used policy parser in place; introduce a reviewed new policy version instead of rewriting historical evidence.

A full baseline is the accepted receipt's response.summary.advertisement_count, bound to its source/scope/policy and full_snapshot state. Reviewed shadow calibration is not an applied full baseline. First application must not mark legacy inventory absent.

Property.hk branch URLs, DOM/pagination fixtures and global versus branch-local source IDs remain unverified. Keep configuration empty/fail-closed until an authorized operator provides and validates them. A successful offline fixture run does not establish current live selectors or source reuse rights.

## Cutover order

1. Review and apply backward-compatible schema; deploy code with publishing disabled.
2. Run offline suites and isolated transaction tests.
3. Verify authorized live source access, complete sale/rent and all EPW/EPS/EPT traversal, parser versions and source-ID semantics.
4. Collect immutable snapshots in dry-run/shadow and inspect gate results, proposed relationships, conflicts, human overrides and drafts missing public prerequisites.
5. Approve source policy/bootstrap and one canonical publisher. Transfer ownership under the shared earnestproperty:mls-sync lock; old writers cannot overwrite v2-owned properties after this transfer.
6. Apply the first full snapshot, verify its receipt, stable property IDs/aliases and observed timestamps, then enable the authorized schedule.

## Rollback

Disable the new publisher and stop its schedule through the approved operator procedure. Retain properties, issued public IDs, source links, observations, contacts, conflicts, receipts and baselines. Do not return ownership to the legacy publisher merely by toggling a flag: legacy field/absence policy differs, so require an explicit comparison and approved transfer before resuming it. Do not drop the new source constraints or delete v2 records to make old code accept them.

Worker run/replay commands and scheduler examples will be recorded in the completed worker runbook after WP2/WP3 integration verification.
