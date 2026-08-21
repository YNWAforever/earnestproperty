# Cloudflare MLS container runner

This project owns the Cloudflare control plane for one MLS synchronization
attempt. It does not replace the source adapters, reconciliation rules, media
ownership checks, Neon transaction, or publication gates in
scripts/mls/sync.mjs.

## Runtime shape

```text
Workflow: MlsRunWorkflow
    |
    | idempotent claim/start RPC keyed by attempt ID
    v
Container Durable Object: MlsRunContainer
    |
    | one authenticated request to the private container port
    v
One-shot Node supervisor on :8080
    |
    | exactly one child process per claimed attempt
    v
Existing CLI: scripts/mls/sync.mjs
    |
    +--> source adapters and health gates
    +--> direct DATABASE_URL_UNPOOLED Neon session
    +--> Vercel Blob media preparation for an authorized publish run
    +--> private R2 evidence and terminal manifest
```

The Worker has no public run route. Every HTTP route returns 404; the
authenticated /run and /status endpoints exist only on the private container
loopback address. Do not add a Worker endpoint that starts, retries, cancels,
or publishes an attempt.

The Durable Object persists the claim before starting a child. Control-plane
retries return the existing attempt record and cannot spawn a second integrated
command. Terminal state is immutable. An ambiguous start, status, or terminal
evidence result is recorded as unknown and is not automatically rerun.

## Deployment configurations

wrangler.jsonc is the base configuration. It is private, has no HTTP routes,
has no Workflow schedule, and is used for local verification, an unscheduled
deployment, and the first manual shadow proof.

wrangler.scheduled.jsonc is structurally equivalent to the base file and adds
only the approved Workflow schedule 0 18 \* \* \*. Deploy it only after the
manual shadow proof and the separately approved daily-shadow gate. The base
defaults are MLS_SCHEDULED_MODE=shadow, MLS_PUBLISH_ENABLED=false, and
MLS_MEDIA_RIGHTS_CONFIRMED=false.

## Runtime names

Values are supplied at execution time. This document intentionally records
names only; it contains no secret values.

### Secrets

| Name                     | Boundary                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| DATABASE_URL_UNPOOLED    | Direct Neon connection used by the existing CLI.                                                                                   |
| BLOB_READ_WRITE_TOKEN    | Vercel Blob write token, required only for an authorized publish run.                                                              |
| MLS_R2_ACCESS_KEY_ID     | Bucket-scoped R2 S3 access key.                                                                                                    |
| MLS_R2_SECRET_ACCESS_KEY | Bucket-scoped R2 S3 secret.                                                                                                        |
| MLS_SUPERVISOR_TOKEN     | Generated per attempt and passed only to the private supervisor request; it is never persisted in attempt state or child evidence. |

The Cloudflare CLI credential used by an operator is separate from application
runtime secrets. Do not copy operator credentials into Wrangler vars, the
Container image, Workflow state, or this repository.

### Non-secret configuration and run identity

| Name                        | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| MLS_ENVIRONMENT             | preview or production deployment environment.                                |
| MLS_SCHEDULED_MODE          | Scheduled mode; keep shadow until the scheduled-publish gate.                |
| MLS_PUBLISH_ENABLED         | Explicit publish flag; the base default is false.                            |
| MLS_MEDIA_RIGHTS_CONFIRMED  | Explicit media-rights gate; the base default is false.                       |
| MLS_CRAWLER_CONTACT_URL     | Public contact URL for source requests.                                      |
| MLS_MEDIA_ALLOWED_HOSTS     | Reviewed image host allow-list.                                              |
| MLS_EVIDENCE_BACKEND        | r2 for the deployed Container; filesystem is for local-only verification.    |
| MLS_EVIDENCE_BUCKET         | Approved private R2 bucket name.                                             |
| MLS_EVIDENCE_RETENTION_DAYS | Retention configuration; the approved baseline is 90 days.                   |
| MLS_GIT_COMMIT_SHA          | Reviewed 40-character release identity.                                      |
| CLOUDFLARE_ACCOUNT_ID       | Non-secret account identity used to build the R2 endpoint.                   |
| CLOUDFLARE_DEPLOYMENT_ID    | Non-secret deployment identity recorded in evidence.                         |
| MLS_SCHEDULED_FOR           | Hong Kong evidence date for the attempt.                                     |
| MLS_ATTEMPT_ID              | Deterministic scheduled or explicitly suffixed manual identity.              |
| MLS_WORKFLOW_INSTANCE_ID    | Workflow instance identity recorded by the CLI.                              |
| MLS_CONTAINER_ID            | Container Durable Object identity recorded by the CLI.                       |
| MLS_ATTEMPT_STARTED_AT      | Supervisor start timestamp.                                                  |
| MLS_TERMINAL_STATUS_FILE    | Container-local terminal status path.                                        |
| MLS_ARTIFACT_DIR            | Local-only filesystem evidence directory; not used for deployed R2 evidence. |

## Local verification

Run these checks with fixture or fake dependencies only. They do not authorize
an account mutation, migration, live source request, Blob upload, deployment,
schedule change, or publication.

```powershell
node --test src/lib/mls/ops-contract.test.mjs src/routes/api.mls-sync.test.mjs
bun test workers/mls-container/src/*.test.ts
node --test workers/mls-container/container/*.test.mjs src/lib/mls/r2-reporting.test.mjs scripts/mls/sync.test.mjs
npm.cmd exec tsc -- --noEmit -p workers/mls-container/tsconfig.json
npm.cmd exec wrangler -- deploy --dry-run --config workers/mls-container/wrangler.jsonc
```

Build the image locally for the linux/amd64 target, then probe the native
sharp module without starting a real synchronization:

```powershell
docker build --platform linux/amd64 -t earnest-mls-container:local workers/mls-container
docker run --rm --platform linux/amd64 --entrypoint node earnest-mls-container:local -e "import('sharp').then(() => console.log('sharp:ok'))"
```

If Docker is unavailable, record the external acceptance gate; do not claim an
image or native-module check passed. Any container smoke must inject fake
source, Neon, Blob, and R2 dependencies and must not make a live request.

To exercise a local Workflow manually, use the unscheduled configuration and
the explicit manual payload below:

```powershell
npm.cmd exec wrangler -- dev --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows trigger earnest-mls-runner '{"kind":"manual","mode":"shadow","reason":"local fixture verification","suffix":"local-0001","scheduledTime":"2026-08-20T18:00:00.000Z"}' --local --config workers/mls-container/wrangler.jsonc
```

## R2 evidence contract

Every attempt uses the immutable prefix:

```text
mls-sync/<environment>/<HK-date>/<run-id>/<attempt-id>/
```

The four artifact objects are report.json, listings.csv, observations.csv,
and diagnostics.json. Each object records its key, byte length, content type,
and SHA-256 digest. The terminal manifest.json is written last with a
conditional If-None-Match: \* write. A manifest contains the schema version,
environment, Hong Kong date, attempt and release identity, Workflow/Container
deployment identities, run status, terminal classification, timestamps, Neon
run identity, and the complete artifact metadata.

R2 is private. A 90-day bucket lock and a 90-day-or-later lifecycle rule cover
the mls-sync/ prefix. Application code has no delete operation; an immutable
key collision is evidence of a conflict, not a retry instruction. Do not put
connection strings, tokens, or supervisor credentials in an object key,
metadata, manifest, log, or test snapshot.

## Operational handoff

The approval-gated phase order, provider command boundaries, shadow evidence
requirements, first publish proof, scheduled activation, and rollback contract
are in docs/mls-production-activation.md. Code merge never authorizes a
provider command. In particular, the presence of MLS_PUBLISH_ENABLED or
MLS_MEDIA_RIGHTS_CONFIRMED in a config file is not evidence that publication or
media upload was authorized.
