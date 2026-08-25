# MLS Manual Production Shadow Readiness

Date: 2026-08-23

## Status

Design approved by the user. This document defines the next rollout phase for
the Cloudflare-native MLS runtime. It does not itself authorize secret
placement, deployment, live source requests, schedule enablement, Blob writes,
or canonical publication.

## Goal

Provide a safe, reviewable path to one manual production shadow run using the
existing Cloudflare Workflow and Container runtime. The phase must prove the
full control-plane and evidence path while keeping publication and media
side-effects disabled.

## Agreed scope

- Use the existing production Cloudflare project, production Neon database,
  live MLS sources, and private R2 evidence bucket.
- Use Vercel Production as the operator's source of truth for Cloudflare secret
  values. Values are entered interactively and are never printed, committed,
  placed in Docker arguments, or stored in verifier output.
- Run exactly one manual `shadow` attempt with
  `MLS_PUBLISH_ENABLED=false` and `MLS_MEDIA_RIGHTS_CONFIRMED=false`.
- Require strict cross-system acceptance: Cloudflare terminal success, source
  health, Neon run state and lock release, R2 manifest and hashes, redacted
  diagnostics, read-only status output, and proof of zero Blob/publication
  writes.
- Keep schedule enablement, first publish, scheduled publication, and VPS
  retirement out of this phase.

## Architecture

The phase adds an operator workflow around the existing runtime rather than a
new public control plane:

1. An offline verifier checks reviewed configuration, required secret names,
   disabled routes/schedules, shadow flags, migration evidence, and R2 policy.
2. The operator enters approved Vercel Production values into Wrangler,
   deploys the unscheduled configuration, and verifies the deployment shape.
3. The operator triggers one manual Workflow attempt with an approved Hong
   Kong evidence date, reason, and unique suffix.
4. The verifier correlates the attempt across Workflow, Container, Neon, R2,
   and the read-only status surface.
5. The verifier emits a bounded acceptance record containing identifiers,
   terminal classification, hashes, and side-effect checks.

The phase does not add an unauthenticated run-start endpoint, automatic retry,
or a privileged activation UI.

## Components and data flow

### Offline verifier

Add a pure verifier under `scripts/mls/verify-shadow.mjs` with separate
preflight and terminal-evidence checks. It consumes operator-captured,
descriptor-safe snapshots rather than calling providers itself.

Preflight inputs include Cloudflare account/configuration metadata, deployment
shape, R2 lock/lifecycle metadata, migration status, and secret names only.
Terminal inputs include the attempt ID, Workflow and Container identifiers,
Neon run state, R2 prefix/manifest/hashes, read-only status output, and bounded
side-effect counters.

### Operator runbook

Update `docs/mls-production-activation.md` with the exact PowerShell sequence:

1. Capture read-only account, configuration, migration, R2, and secret-name
   preflight evidence.
2. Enter Vercel Production values interactively with Wrangler secret commands.
3. Deploy the unscheduled configuration and capture its deployment ID.
4. Verify `workers_dev=false`, no routes, no schedules, the Container image,
   and the Workflow registration.
5. Trigger one manual `shadow` attempt using the approved Hong Kong timestamp.
6. Capture the Cloudflare, Neon, R2, and status-route snapshots.
7. Run the verifier and store its acceptance result with the phase evidence.

### Acceptance record

The acceptance record must correlate the attempt ID, Workflow instance,
Container deployment, Neon run UUID, R2 evidence prefix, manifest hash, and
status-route result. It must state that no Blob upload and no canonical
publication occurred.

## Error handling

The verifier fails closed and stops the phase on the first invalid gate:

- Preflight failure stops before secret entry, deployment, or triggering.
- Secret or deployment failure stops before a shadow starts.
- A source-health block is recorded as not accepted with its stable diagnostic;
  it is never retried automatically.
- An unknown terminal result preserves Cloudflare, Neon, and R2 evidence and
  requires manual reconciliation.
- Any identity, manifest, hash, redaction, Blob, or publication mismatch
  rejects acceptance, even if the process exit code is zero.

## Testing and verification

The verifier tests remain offline and fake-only. They cover:

- valid preflight and successful shadow evidence;
- missing/extra secret names without value exposure;
- mismatched attempt, Workflow, Container, Neon, or R2 identities;
- missing, tampered, or non-final manifests;
- source-health blocks and unknown outcomes;
- unexpected Blob or canonical-publication activity;
- credential, URL, HTML, and database-detail redaction.

The existing MLS, Cloudflare, Neon, R2, migration, and status-route suites
must remain green. No Docker, provider, source, Blob, database, deployment,
schedule, or publication action is part of the offline test suite.

## Rollout gates

1. **Code gate:** the verifier and runbook are reviewed and approved.
2. **Secret gate:** Vercel Production is confirmed as the operator source;
   Wrangler receives values interactively and only names are recorded.
3. **Deployment gate:** the unscheduled Cloudflare deployment is private,
   route-free, schedule-free, and shadow-configured.
4. **Shadow gate:** one manual production attempt runs with both publication
   flags false.
5. **Evidence gate:** strict cross-system evidence is accepted and stored.

This phase ends after the evidence gate. It does not enable a schedule, upload
Blob media, publish canonical listings, or retire the historical VPS path.

## Rollback

On failure, stop the Workflow, preserve Neon and R2 evidence, keep all
publication flags false, and revert the unscheduled deployment if necessary.
Do not retry automatically, delete evidence, or roll back the applied database
migration. Schedule enablement, first publish, and VPS retirement remain
separate approvals.

## Success criteria

- Exactly one manual shadow attempt is correlated across all systems.
- The source-health result is accepted and the Neon advisory lock is released.
- A complete immutable R2 manifest and hashes are present.
- Diagnostics and acceptance output contain no credentials, raw HTML, or SQL
  parameters.
- No Vercel Blob upload or canonical publication occurs.
- The operator has a reviewable acceptance record and a clear stop/rollback
  path for any later rollout phase.
