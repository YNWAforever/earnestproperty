# MLS Production Activation

This runbook is the approval-gated handoff for moving dual-source MLS scheduling to the VPS. It documents code and operator checks only; it does not install a service, apply a migration, scrape a source, upload a Blob, deploy Vercel, or publish canonical data.

## Credential and source map

Place values only in the approved secret manager or `/etc/earnestproperty/mls-sync.env`; never commit them, paste them into a unit file, or print them in shell history.

- `DATABASE_URL_UNPOOLED`: Neon direct connection panel, restricted to the approved production database and least-privilege role.
- `BLOB_READ_WRITE_TOKEN`: the approved Vercel Blob store for MLS media. The token value is never recorded in this runbook.
- `CRON_SECRET`: retained in Vercel for the read-only `/api/mls-sync` status route and other protected control-plane routes.
- `MLS_CRAWLER_CONTACT_URL`: public contact URL sent to source operators; it is not a credential.
- `MLS_MEDIA_RIGHTS_CONFIRMED=false` and `MLS_PUBLISH_ENABLED=false` are the initial gates. Keep both false until the approvals below are recorded.
- `MLS_MEDIA_ALLOWED_HOSTS` must list only the reviewed image hosts. Do not infer a host from an unreviewed listing.

## Preflight and authorization boundary

Record the owner authorization for the selected content, media rights, and platform access before any production action. Migration approval, credential placement, live scraping, Blob upload, Vercel deployment, systemd installation, and production publication are separate authorization events; approval of one does not authorize another.

The operator must verify, without exposing secrets:

1. The VPS account, `/opt/earnestproperty/current`, `/var/lib/earnestproperty/mls-sync`, and `/etc/earnestproperty/mls-sync.env` ownership and permissions.
2. Node.js 22.15 or newer and the actual executable paths (`command -v node`, `node --version`, `command -v npm`, `npm --version`). Adjust `ExecStart` in the service template if the VPS npm path differs from `/usr/bin/npm`.
3. `node -e 'console.log(typeof WebSocket)'` prints `function`.
4. The release commit and lockfile are the reviewed versions; the VPS checkout has no unrelated edits.
5. DNS/HTTPS egress to both source domains, Blob, Neon, and the public status endpoint; record only pass/fail and timestamps.
6. Artifact and log directories are writable by `earnest-mls` and no broader filesystem path is writable by the service.
7. Clock, timezone, and NTP health. Before installing the timer, run:

   ```bash
   systemd-analyze calendar '*-*-* 02:00:00 Asia/Hong_Kong'
   ```

   Record that the next elapse is 02:00 Hong Kong time on that VPS.
8. No secret appears in shell history, process listings, repository files, unit files, or captured diagnostics.

## Migration approval gate

Review the exact migration `20260817120000_dual_source_listing_sync.sql`, its checksum, rollback implications, and the target database identity. A separately authorized operator must apply it and record migration output without connection strings or tokens. Do not continue on a failed, partially applied, or unexpected-schema result.

## Observation backfill and seven daily shadow runs

The first shadow run persists immutable observations and exact proposed source links without changing public canonical fields. Run the seven daily shadow runs only after the migration gate is complete:

```bash
npm run mls:shadow
```

For every run, retain the run UUID and review JSON/CSV diagnostics, both source deal counts, exact identity matches, ambiguity/conflict/quarantine outcomes, lifecycle evidence, and media outcomes. Before a run counts toward cutover, record owner media-rights confirmation, review `MLS_MEDIA_ALLOWED_HOSTS`, set only `MLS_MEDIA_RIGHTS_CONFIRMED=true`, and keep `MLS_PUBLISH_ENABLED=false`. Parsing-only runs with rights unconfirmed do not prove media readiness and do not count toward the seven.

After an acceptable run, and only with the designated reviewer, approve its baseline:

```bash
npm run mls:approve-baseline -- --run={UUID} --reviewer={operator-id}
```

A missing approval, degraded source, unresolved quarantine, rights failure, or unexpected count drift resets the evidence clock rather than being waived.

## Cutover approval gate

After seven approved healthy shadow dates, deploy the reviewed release that removes the Vercel MLS cron. Verify that Vercel retains only the control-plane worker and send-queue fallback crons. Install the service and timer templates for review, but do not enable or start the timer yet. Keep `MLS_PUBLISH_ENABLED=false` until first-publish approval.

The protected status route is read-only and should return `publisher: "vps"` plus `latestRun`; it must never start an importer or publish work.

## First publish

With a separately recorded first-publish approval, start the service once manually, inspect the run status, artifacts, diagnostics, and representative public samples, and verify canonical identities, links, fields, media ownership, and audit events. Enable the timer only after that acceptance record is complete.

## Seven monitored live runs

For seven monitored live runs, record one canonical property for each exact identity path, source changes, reactivations, media reuse/new ownership, and the two-run healthy-absence inactivity behavior. Confirm the status endpoint, run artifacts, database counts, and public samples after each run. Stop and investigate on any degraded source, unexpected quarantine, ownership mismatch, duplicate identity, or event inconsistency.

## Rollback

Set `MLS_PUBLISH_ENABLED=false`, stop and disable `earnest-mls-sync.timer`, and preserve the database evidence, run artifacts, logs, and Blob media. `npm run mls:legacy-sync` is an operator-only fallback and must not be started automatically. Reversing already-published canonical values is a separate approved operation that adds forward compensating change events; never delete or rewrite audit history.

## Production boundary

Migration, credential placement, live scraping, Blob upload, Vercel deployment, systemd installation, timer enablement, and production publication each require their own explicit authorization. Code verification in this repository is complete only when the deterministic checks pass; it is not evidence that rollout has been authorized or performed.