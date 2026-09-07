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

## Local installation and evidence

Windows PowerShell from the repository root:

```powershell
python -m venv scripts/property-sync/.venv
scripts/property-sync/.venv/Scripts/python.exe -m pip install -r scripts/property-sync/requirements.txt
npm run test:property-sync
npm run test:property-sync:python
scripts/property-sync/.venv/Scripts/python.exe scripts/property-sync/run_28hse_sync.py --dry-run --synthetic-fixture
scripts/property-sync/.venv/Scripts/python.exe scripts/property-sync/run_propertyhk_sync.py --dry-run --synthetic-fixture
```

On Linux use `python3` for venv creation and `.venv/bin/python` instead of `.venv/Scripts/python.exe`. The named Python test script selects the correct venv path. Optional `requirements-browser.txt` pins Crawl4AI; its browser runtime is not part of verified offline coverage. No Hermes/LLM dependency is required.

`npm run test:property-sync:db` uses only the explicitly approved disposable `ASTRA_TEST_DATABASE_URL` with `ASTRA_TEST_BRANCH_ID=br-quiet-hat-aoxbj2ue`; inject these through the test environment. It skips if the URL is absent and fails for a different branch or the production connection. Fixtures create and drop uniquely named isolated schemas. A skip is not database verification. Do not point any existing destructive database suite at production.

## Worker and server configuration

Copy `scripts/property-sync/config/sources.example.json` to an operator-owned location. Keep all deployed secrets outside it. Fill verified Property.hk EPW/EPS/EPT URL templates, company/licence identity, allowed paths, selectors, required-detail fields and `id_scope` (`global` or `branch`) only after fixture verification. Each branch URL must include `{page}`. `id_scope_verified` must be true only when verified; false/null fails before crawling. Synthetic paths/selectors in tests must never be promoted as live configuration.

Server policy rows are an independent authority in `mls_ingestion_policies`:

| Setting                                                                 | Meaning                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source / scope_id                                                       | `28hse_agent_540` / `agent:540`, or `propertyhk` / `branches:EPW,EPS,EPT`                                                                                                                                                                                                                                                          |
| policy_version                                                          | `no-hermes-v2`; a new version requires a reviewed code/schema compatibility change, not merely editing an environment variable                                                                                                                                                                                                     |
| parser_version                                                          | Exact frozen payload parser version; immutable once referenced by receipts                                                                                                                                                                                                                                                         |
| owner / publish_enabled                                                 | Both must explicitly authorize the v2 writer; defaults are disabled                                                                                                                                                                                                                                                                |
| bootstrap_approved_at / bootstrap_approved_by / bootstrap_approval_note | Recorded operator approval for the first full baseline                                                                                                                                                                                                                                                                             |
| id_scope                                                                | Property.hk verified global or branch-local semantics; match worker configuration                                                                                                                                                                                                                                                  |
| config.source_url_identity                                              | Property.hk `{ "verified": true, "path_template": "<operator-verified exact path containing {id}>" }`; branch-local templates must include `{branch}`. No query, fragment, percent-encoded or arbitrary regex identity is accepted. If live URLs need a different verified grammar, extend and test the adapter before activation. |
| config.district_slugs                                                   | Reviewed exact source district name to existing canonical lower-kebab slug mapping. Missing mappings stage new rows and cannot overwrite existing district filters. No raw Chinese location is written as a slug.                                                                                                                  |
| config.aliases                                                          | Optional reviewed exact identity alias map; never supplied as request authority                                                                                                                                                                                                                                                    |
| Full sync quota                                                         | At most one new full sync per source/scope per hour; successful receipt replay is exempt                                                                                                                                                                                                                                           |
| config.max_batches_per_hour                                             | Separate positive general batch ceiling, default 60, including partial batches; it does not raise the full-sync limit                                                                                                                                                                                                              |
| config.absence_enabled                                                  | False by default; only approved complete 28hse runs can infer absence. Property.hk absence is always off.                                                                                                                                                                                                                          |
| config.public_contacts_enabled                                          | Strict boolean true required to expose a fresh source contact separately from staff profiles; default off                                                                                                                                                                                                                          |

The shipped 28hse parser emits `python-v2.2`; the unchanged Property.hk parser emits `python-v2.0`. After the schema is approved and applied, these optional policy rows remain disabled:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'));
INSERT INTO mls_ingestion_policies
  (source, scope_id, policy_version, parser_version, id_scope)
VALUES
  ('28hse_agent_540', 'agent:540', 'no-hermes-v2', 'python-v2.2', 'global'),
  ('propertyhk', 'branches:EPW,EPS,EPT', 'no-hermes-v2', 'python-v2.0', NULL)
ON CONFLICT DO NOTHING;
COMMIT;
```

Activation is a separate approved transaction under that same lock: record verified configuration/ID scope, bootstrap approval identity/note/time, then transfer owner and publication permission for one source at a time. Stop the competing schedule through its operator before transfer. Do not alter deployed schedules or enable these settings merely to test installation.

Environment names:

- `DATABASE_URL_UNPOOLED`: existing managed server/28hse bridge connection. Python does not write the database.
- `PROPERTYHK_SYNC_SECRET`: independently generated machine bearer secret shared by approved worker and receiver.
- `PROPERTYHK_SYNC_URL`: exact HTTPS receiver URL, normally `https://earnestproperty.vercel.app/api/admin/propertyhk-sync`.
- `PROPERTYHK_SYNC_MAX_BYTES`: receiver byte ceiling, default 5242880; bridge also caps frozen files at 5242880 bytes.
- Worker `sync_allowed_origins`: explicitly include the receiver origin. Redirects are refused, so credentials cannot follow them.

The request body has a 15-second read deadline (503 on timeout). New-batch quota returns 429 with Retry-After. Errors are redacted; raw HTML, phones and payloads belong only in restricted evidence storage. The HTTP route never starts a crawler. New canonical records remain drafts for owned-media and content review; existing images and staff profiles are never overwritten.

## Collect, apply and replay

Authorized live collection commands (not executed by this coding task):

```sh
scripts/property-sync/.venv/bin/python scripts/property-sync/run_28hse_sync.py --config /etc/earnest/sources.json --root /var/lib/earnest-sync --dry-run
scripts/property-sync/.venv/bin/python scripts/property-sync/run_propertyhk_sync.py --config /etc/earnest/sources.json --root /var/lib/earnest-sync --dry-run
```

Dry-run collects evidence but never POSTs, invokes the bridge, advances a baseline, sends notifications or changes database state. Synthetic mode additionally performs no source requests. 28hse normal mode applies only when the deployment-owned worker config explicitly has `publishEnabled: true`; the server DB policy must independently allow it. Property.hk normal mode submits to the authenticated receiver, whose DB policy remains authoritative.

Replay an already-collected 28hse artifact without recrawling:

```sh
node scripts/mls/apply-source-snapshot.mjs --payload /var/lib/earnest-sync/<run>/request.json
# Only after operator activation:
node scripts/mls/apply-source-snapshot.mjs --payload /var/lib/earnest-sync/<run>/request.json --apply
```

Replay Property.hk with the exact original bytes and timestamp:

```sh
scripts/property-sync/.venv/bin/python scripts/property-sync/sync_propertyhk.py --payload /var/lib/earnest-sync/<run>/request.json --config /etc/earnest/sources.json --root /var/lib/earnest-sync
```

The HTTP client makes at most three attempts for temporary network/5xx failures, with bounded backoff. It respects Retry-After; waits beyond its configured ceiling require later operator replay. It does not blindly retry 400/401/409/413/422. A success/full receipt advances the local baseline; partial or dry-run does not. A receipt replay older than the local baseline cannot move it backward.

Snapshots include immutable request JSON, BOM CSV, JSONL, raw HTML, gate/manifest evidence and a separate receipt. `diff_agent540.py --old <csv> --new <csv> --output <new-path>` compares named columns and preserves old/new values. Do not overwrite an artifact to repair it. Failed crawl recovery creates a new run after fixing the cause; transport recovery replays the same artifact.

## Scheduler example (operator installation only)

Use one dependency-controlled nightly job rather than assuming 02:00 completes before 03:00. An operator-owned shell wrapper can run from the checkout:

```sh
#!/bin/sh
set -eu
umask 077
PY=scripts/property-sync/.venv/bin/python
PRIMARY_RESULT=$(mktemp)
trap 'rm -f "$PRIMARY_RESULT"' EXIT
"$PY" scripts/property-sync/run_28hse_sync.py --config /etc/earnest/sources.json --root /var/lib/earnest-sync > "$PRIMARY_RESULT"
"$PY" -c 'import json,sys; r=json.load(open(sys.argv[1])); sys.exit(0 if r.get("success") is True and r.get("status")=="success" and r.get("baseline_advanced") is True else 1)' "$PRIMARY_RESULT"
"$PY" scripts/property-sync/run_propertyhk_sync.py --config /etc/earnest/sources.json --root /var/lib/earnest-sync
```

A systemd service should set `WorkingDirectory` to the checkout, use a dedicated unprivileged user, `UMask=0077`, an operator-managed `EnvironmentFile` and `ExecStart` pointing to that wrapper. A timer may use `OnCalendar=*-*-* 02:00:00 Asia/Hong_Kong` with `Persistent=true`. Equivalent cron installations must explicitly use Hong Kong time and the same dependency wrapper. Neither example was installed or live-tested. Local per-scope lock files prevent overlapping workers; confirm a crashed worker is stopped before manually clearing its stale lock. Canonical writers also share the database advisory lock and ownership fence.

## Incident recovery and retention

| Outcome                                           | Recovery                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Missing branch/selector/ID configuration          | Obtain verified inputs; do not manufacture zero inventory                                                |
| Challenge, unknown DOM, failed page/detail/branch | Preserve raw evidence; repair access/parser and collect a new complete run                               |
| More than 30% drop                                | Review source evidence and inventory change; do not remove the gate or substitute advertised totals      |
| 401                                               | Correct managed secret/origin configuration; retain payload                                              |
| 409 different hash or stale batch                 | Inspect receipts and chronology; never change timestamp merely to force old data through                 |
| 422                                               | Fix completeness; partial evidence cannot establish absence                                              |
| 429                                               | Respect Retry-After; replay original bytes                                                               |
| 503/uncertain COMMIT                              | Replay same payload; the committed receipt determines whether work already succeeded                     |
| Identity ambiguity/correction                     | Inspect mls_ingestion_reviews; keep existing UUIDs/aliases and hold projection until approved correction |
| Unknown field ownership                           | Review provenance/overrides; do not mark every import as a staff override                                |

No automatic evidence purge is included. Retain all observations referenced by links, contacts, field winners, conflicts, receipts or full baselines. Store local raw evidence with restricted permissions and an operator-approved retention period; never purge referenced baseline artifacts. Rollback only disables scheduling/publishing. Source ownership remains fenced until a separate reviewed transfer, and all public IDs/history remain intact.

Daily full-collection/differential-import workflow and activation gates: see [property-sync-daily.md](property-sync-daily.md). Python v2.1 adds explicit sold/rented source lifecycle and negotiable amounts. Used parser policies must never be edited in place; an existing applied v2.0 policy requires a separate reviewed compatibility migration before v2.1 activation.
