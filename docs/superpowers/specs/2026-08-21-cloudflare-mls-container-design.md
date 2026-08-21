# Cloudflare-Native MLS Container Design

Date: 2026-08-21

## Status

Approved in design by the user. This document replaces the VPS hosting and systemd scheduling portions of the approved 28Hse dual-source synchronization design. It does not replace the source, reconciliation, media, database, publication, or staged-activation contracts already implemented on `codex/28hse-dual-source-sync`.

This specification authorizes documentation only. It does not authorize a Cloudflare plan upgrade, R2 purchase, secret creation, live source request, Blob upload, production deployment, scheduled trigger, or publication. Those remain explicit rollout actions after the user reviews this written specification and approves an implementation plan.

## Context

The branch currently packages one integrated Node MLS command for a controlled VPS. That command owns source collection, health evaluation, reconciliation, media processing, the dedicated Neon advisory-lock session, atomic publication, and evidence generation. The current VPS unit allows up to four hours and schedules the job for 02:00 `Asia/Hong_Kong`.

The user chose to remove the VPS dependency and use Cloudflare-native compute. A plain scheduled Worker is not a safe substitute: the pipeline includes native `sharp` processing, Node networking and filesystem behavior, a potentially long-running crawl, and a dedicated database session that must remain open for the run. Cloudflare Containers provide the required Linux runtime, while a scheduled Cloudflare Workflow supplies durable control-plane state without moving the data or media stores.

## Approved Decisions

- Create a dedicated Cloudflare project for MLS execution; do not add MLS execution to the existing `workers/cron` project.
- Use a directly scheduled Cloudflare Workflow to control one one-shot Cloudflare Container per run attempt.
- Keep Neon as the canonical database and keep Vercel Blob as the owned listing-media store.
- Keep the current integrated Node orchestrator and direct unpooled Neon connection inside the Container.
- Do not use Hyperdrive because the publisher depends on one session-scoped PostgreSQL advisory lock for the whole run.
- Store operational evidence in a private R2 bucket for 90 days.
- Fail closed after any failed or unknown run. Do not retry source, media, or publication work automatically.
- Use a new dedicated Cloudflare project so its secrets, deployment, logs, schedules, and rollback are isolated.
- Treat Workers Paid and Containers availability as a hard pre-deployment gate because account capability is not yet confirmed.
- Preserve the current staged activation: manual shadow, seven approved healthy Hong Kong dates, manual first publish, then scheduled publication.

## Goals

- Remove all runtime and scheduling dependence on a user-managed VPS.
- Run the existing full Linux/Node MLS pipeline without weakening its Neon lock, publication, media, or safety contracts.
- Ensure one scheduled attempt per Hong Kong run date and suppress duplicate schedule delivery.
- Preserve manual, fail-closed recovery instead of automatically replaying side effects.
- Produce private, immutable, reviewable R2 evidence for every attempt.
- Keep the existing read-only Vercel status route as the operational status surface.
- Make shadow-to-publish promotion an explicit, independently auditable configuration change.

## Non-Goals

- Moving Neon data to D1 or another Cloudflare database.
- Moving Vercel Blob listing media to R2.
- Replacing the media pipeline with Cloudflare Images.
- Porting the MLS pipeline into the Workers runtime.
- Splitting the integrated publisher across retryable Workflow steps.
- Adding automatic retries, queues, fuzzy recovery, or a second publication path.
- Exposing a public HTTP endpoint that can start a production run.
- Changing source access, matching, reconciliation, staff-override, lifecycle, or atomic-publication rules.
- Removing historical VPS files before the Cloudflare replacement has passed its activation gates.

## Architecture

### 1. Dedicated Cloudflare project

Create a dedicated project, tentatively `workers/mls-container`, containing the Workflow, Container class, Docker image, configuration, and focused tests. The existing `workers/cron` project remains unchanged and cannot trigger the MLS publisher.

The project has no unauthenticated run-start route. Scheduled instances are created from the Workflow binding's cron schedule. Manual attempts are created only through authenticated Cloudflare operator surfaces such as Wrangler, the dashboard, or the Workflow API.

### 2. Scheduled Workflow

`MlsRunWorkflow` is the control plane. Its production schedule is `0 18 * * *`, which corresponds to 02:00 Hong Kong because Hong Kong does not observe daylight-saving time. It derives the authoritative Hong Kong run date from Cloudflare's scheduled timestamp, not from Container-local time.

The Workflow:

1. Derives the environment, Hong Kong run date, attempt identifier, requested mode, and deployed commit.
2. Validates non-secret configuration and required-secret presence without logging secret values.
3. Claims a deterministic attempt record before any source request or external write.
4. Starts the matching Container through its Durable Object binding.
5. Polls durable Container status at bounded intervals while sleeping durably between checks.
6. Records terminal success, failure, or unknown outcome and points to the R2 evidence prefix.

The Workflow does not crawl sources, upload media, hold the Neon lock, or publish properties. Those activities stay inside one Container execution so retries cannot split or reorder the established transaction boundary.

### 3. Container identity and Durable Object state

`MlsRunContainer` extends Cloudflare's Container-backed Durable Object. A scheduled attempt uses a deterministic identity derived from environment and Hong Kong run date. A manual rerun adds an explicit, unique attempt suffix.

Durable state records:

- Environment, run date, attempt identifier, and requested mode.
- Workflow instance, Container deployment, and application commit identifiers.
- `pending`, `running`, `succeeded`, `failed`, or `unknown` state.
- Start, heartbeat, termination, and completion timestamps.
- Exit code or redacted failure classification.
- Neon run identifier when available.
- R2 evidence prefix and final-manifest presence.

A duplicate scheduled delivery for an already claimed date returns the existing state and performs no source, Blob, or database work. The existing Neon advisory lock remains a second independent concurrency barrier.

### 4. Container supervisor

The Container image is a reproducible Linux image containing the repository's supported Node runtime, production dependencies, and native `sharp` support. It runs a small supervisor as PID 1 rather than invoking the MLS command directly.

The supervisor:

- Accepts one authenticated internal start instruction.
- Validates an immutable run envelope and refuses a second start.
- Invokes the existing MLS command in `shadow` or `publish` mode.
- Streams only redacted structured diagnostics.
- Reports heartbeats and terminal state to the Container Durable Object.
- Enforces the existing four-hour application deadline.
- Forwards `SIGTERM` and cancellation to the Node child process.
- Allows the child to release the Neon lock, finish database cleanup, and finalize evidence before exit.

The Workflow's bounded polling keeps the Container active while work is running. The Container lifecycle configuration must not stop an active job before the four-hour application timeout. On completion, the supervisor exits so the instance can scale to zero.

### 5. Existing MLS pipeline

The Container invokes the existing command and preserves its ownership boundaries:

- Source adapters own source discovery and parsing.
- Health evaluation owns source-run gating.
- Reconciliation owns staff overrides, provenance, and canonical proposals.
- Media preparation owns URL validation, hashing, `sharp` checks, and Vercel Blob upload.
- The repository owns run persistence, the dedicated unpooled Neon session, advisory locking, and atomic publication.
- The orchestrator owns the single integrated run lifecycle.

No Worker or Workflow code may independently publish, upload listing media, or synthesize canonical proposals.

### 6. R2 evidence

Use a private, dedicated R2 bucket for operational evidence. Each attempt writes only beneath:

```text
mls-sync/<environment>/<HK-date>/<run-id>/<attempt-id>/
```

The evidence writer preserves the current JSON and CSV report semantics and adds a final manifest containing:

- Environment, run date, attempt identifier, and mode.
- Git commit and Container deployment identifiers.
- Workflow instance, Container identity, and Neon run identifier.
- Started, completed, and duration timestamps.
- Terminal classification and exit code.
- Artifact names, byte sizes, content types, and SHA-256 hashes.

Artifacts use unique attempt-prefixed keys and are never overwritten. The manifest is written last; its presence is the completion marker. A bucket lifecycle rule removes evidence after 90 days. Application code never performs evidence deletion. The R2 credential is limited to the evidence bucket, and bucket retention controls protect the 90-day evidence window.

R2 is not treated as a POSIX filesystem. The implementation uses whole-object writes and does not depend on filesystem rename, symlink, or atomic-directory behavior.

## Run identity and modes

### Scheduled identity

The scheduled identity is the production environment plus the Hong Kong calendar date derived from `event.schedule.scheduledTime`. A duplicate event for that identity is a no-op even if it has a different Workflow instance identifier.

### Manual identity

A manual attempt includes an operator-supplied reason and a generated attempt identifier. It never overwrites or resumes a prior attempt. Operators may create it only after inspecting the prior Neon state and R2 evidence.

### Shadow mode

The scheduled mode remains `shadow` throughout validation and the seven-date evidence period. Shadow runs may make authorized live source requests and validate media, but they cannot upload media or publish canonical changes.

### Publish mode

Publication requires all of the following:

1. The invocation explicitly requests `publish`.
2. `MLS_PUBLISH_ENABLED` is exactly `true` in the deployed Cloudflare configuration.
3. `MLS_MEDIA_RIGHTS_CONFIRMED` is exactly `true`.
4. Existing source-health, streak, approval, lifecycle, and repository gates pass.

The Workflow never turns either flag on. The first publish is a manual attempt. Scheduled publication begins only after that attempt is verified and the scheduled mode is deliberately changed.

## Secrets and configuration

### Secrets

The following values are Cloudflare secrets and are passed to the Container only at startup:

- `DATABASE_URL_UNPOOLED`
- `BLOB_READ_WRITE_TOKEN`
- Bucket-scoped R2 access key and secret, or equivalent short-lived bucket-scoped credentials

Secrets must not appear in the image, Docker build arguments, source tree, Wrangler configuration, Workflow state, R2 object metadata, diagnostic output, or Vercel configuration copied for convenience. Local development uses only an ignored `.dev.vars` file.

### Non-secret variables

- `MLS_CRAWLER_CONTACT_URL`
- `MLS_MEDIA_ALLOWED_HOSTS`
- `MLS_EVIDENCE_BUCKET`
- `CLOUDFLARE_ACCOUNT_ID`
- `MLS_SCHEDULED_MODE=shadow|publish`
- `MLS_PUBLISH_ENABLED=false|true`
- `MLS_MEDIA_RIGHTS_CONFIRMED=false|true`
- `MLS_EVIDENCE_RETENTION_DAYS=90`
- Application environment and expected deployment identifiers

Flags default to false. Changing them is a separately reviewed rollout action, not an implementation default.

## Error handling and retries

- There is no automatic rerun of the integrated Container command.
- Side-effecting Workflow operations use deterministic attempt state so a platform replay cannot start the command twice.
- A non-zero exit, timeout, source block, health failure, publication rejection, artifact failure, or missing terminal manifest marks the attempt failed.
- An ambiguous Container or database commit outcome is recorded as `unknown`, never assumed rolled back, and cannot be retried until an operator reconciles Neon state.
- Failure diagnostics pass through the existing credential, HTML, URL, and SQL-parameter redaction boundaries before reaching logs or R2.
- Raw listing payloads, fetched HTML, credentials, database parameters, and Blob tokens do not enter Cloudflare lifecycle logs.
- `SIGTERM` is forwarded to the child process. The supervisor waits for bounded cleanup and then exits with the child's terminal classification.
- A failed attempt cannot change the scheduled mode or publication flags.

## Status and observability

Neon remains authoritative for MLS run and publication state. Durable Object state describes Cloudflare execution state, while R2 stores supporting evidence.

The existing protected `/api/mls-sync` route remains read-only. Its public contract changes only where needed to identify `cloudflare-container` as the publisher and to expose the latest database-backed status already allowed by the route. It must not start, retry, or cancel a run.

Cloudflare observability records Workflow and Container lifecycle events using structured, redacted fields. Operators correlate Cloudflare, Neon, and R2 using the attempt identifier and Neon run identifier.

## Verification strategy

### Deterministic tests

Add focused tests for:

- UTC-to-Hong-Kong run-date derivation.
- Scheduled and manual attempt identifiers.
- Duplicate scheduled delivery suppression.
- Durable state transitions and terminal-state immutability.
- Secret-presence checks that never read or render secret values.
- Shadow and publish mode gates.
- Zero automatic side-effect retries.
- Supervisor single-start behavior, four-hour timeout, cancellation, and `SIGTERM` forwarding.
- Container exit, missing heartbeat, unknown outcome, and cleanup precedence.
- R2 key validation, immutable object writes, manifest-last completion, hashes, and redaction.
- Read-only status-route publisher metadata.

The existing repository, reconciliation, media, health, migration-contract, orchestration, and status-route suites must remain green.

### Container verification

- Build the production Docker image locally with the supported Node version.
- Prove `sharp` loads and processes a bounded fixture.
- Run the Container with fake source, Neon, Blob, and R2 dependencies.
- Prove a duplicate start does not spawn a second child.
- Prove `SIGTERM` reaches the child and cleanup completes.
- Prove the process exits and scales down after terminal evidence is written.

### Cloudflare preflight

Before production resource creation, verify:

- The intended account is on Workers Paid.
- Containers, Workflows, R2, and required limits are available.
- Docker and a current Wrangler version are available to deploy the project.
- The target account, environment, Worker name, R2 bucket, and secret destinations are unambiguous.

### Non-production Cloudflare proof

Deploy first to a non-production environment using a disposable Neon test branch or database, a private test R2 bucket, fake or explicitly authorized source fixtures, and no production Blob token. Verify scheduling, one-shot lifecycle, duplicate suppression, evidence, redaction, and scale-to-zero behavior.

## Production rollout

1. Confirm Workers Paid and Containers availability.
2. Create the dedicated private R2 evidence bucket and 90-day lifecycle/retention policy.
3. Create the dedicated Cloudflare project with no production schedule.
4. Install production secrets without printing or copying their values into logs.
5. Deploy with `MLS_SCHEDULED_MODE=shadow`, `MLS_PUBLISH_ENABLED=false`, and `MLS_MEDIA_RIGHTS_CONFIRMED=false`.
6. Run one manually triggered production shadow attempt.
7. Verify the Neon run, advisory-lock release, R2 manifest and hashes, Cloudflare lifecycle, redaction, and `/api/mls-sync` result.
8. Enable the daily shadow schedule at `0 18 * * *`.
9. Collect and explicitly approve seven healthy Hong Kong run dates.
10. Confirm media rights, set the two publication flags with explicit authorization, and execute the first publish manually.
11. Verify canonical writes, source links, field provenance, lifecycle, change events, Blob ownership, R2 evidence, and status output.
12. Only after approval, change the scheduled mode to `publish`.
13. Monitor the first seven scheduled publication dates before declaring steady state.
14. Retire the VPS/systemd path only after Cloudflare publication is proven and no independent scheduler remains enabled.

## Rollback

- Disable the Workflow schedule.
- Set `MLS_SCHEDULED_MODE=shadow` and `MLS_PUBLISH_ENABLED=false`.
- Roll back the Worker and Container deployment if the control plane is defective.
- Revoke or rotate Cloudflare-held secrets when exposure is suspected.
- Preserve Neon history, R2 evidence, and Vercel Blob objects.
- Do not reverse the already-applied database migration unless a separate schema review authorizes it.
- Do not re-enable VPS publication while a Cloudflare Container or Workflow attempt is running.

## Success criteria

- The MLS synchronization no longer depends on a VPS or systemd.
- Exactly one scheduled attempt can perform work for each Hong Kong date.
- Duplicate delivery and overlapping manual attempts cannot create a second publisher.
- The current direct Neon advisory lock and atomic publication contracts remain intact.
- The native media pipeline runs successfully in the production Container image.
- Shadow mode cannot publish or upload media.
- Publication remains impossible until all explicit flags and existing gates pass.
- Failures and unknown outcomes stop without automatic reruns.
- Every terminal attempt has correlated Neon status and private R2 evidence; complete attempts have a final manifest.
- No credentials, database parameters, fetched HTML bodies, or raw listing payloads leak into Cloudflare logs or evidence metadata.
- The production schedule remains disabled until the seven-date shadow and manual-first-publish gates are satisfied.

## Superseded operational material

Implementation will update the prior design and production activation runbook so they no longer instruct operators to install credentials on a VPS or enable systemd. Historical systemd files may remain temporarily for rollback reference, but they must be clearly marked retired and must never be enabled alongside the Cloudflare schedule.
