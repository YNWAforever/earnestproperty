# MLS Production Activation

This is the approval-gated operator contract for the Cloudflare-native MLS project. It separates code verification from account mutations, secret placement, live source access, media upload, deployment, schedule activation, and publication. The read-only status contract reports `publisher: cloudflare-container`. No provider command in this runbook is authorized by code approval.

## 1. Authority matrix

Record a separate approval for each boundary: code merge; the `20260817120000_dual_source_listing_sync.sql` migration; Workers Paid; private R2 bucket and token creation; secret placement; live source access; Vercel Blob upload; unscheduled Cloudflare deployment; schedule enablement; and publication. Approval of one row never authorizes another.

## 2. Preflight

Confirm the intended Cloudflare account/profile and that Containers and Workflows are available. These are read-only checks and must stop on account ambiguity or an unavailable product:

```powershell
npm.cmd exec wrangler -- whoami
npm.cmd exec wrangler -- workflows list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- containers list --config workers/mls-container/wrangler.jsonc
docker version
```

Run the local matrix before any account work:

```powershell
bun test workers/mls-container/src/run-contract.test.ts workers/mls-container/src/container.test.ts workers/mls-container/src/workflow.test.ts
npm.cmd exec tsc -- --noEmit -p workers/mls-container/tsconfig.json
npm.cmd exec prettier -- --check workers/mls-container/src
npm.cmd exec eslint -- workers/mls-container/src/container.ts workers/mls-container/src/container.test.ts workers/mls-container/src/workflow.ts workers/mls-container/src/workflow.test.ts workers/mls-container/src/index.ts
```

The retired VPS calendar is historical evidence only; if an auditor needs to compare the former wall-clock expression, inspect it with `systemd-analyze calendar '*-*-* 02:00:00 Asia/Hong_Kong'` without enabling a host schedule.

The Docker check is an operator prerequisite, not evidence that an image was built. Record only product availability, account identity, and pass/fail timestamps; never copy secret values into this runbook.

## 3. Manual shadow readiness verifier

### Legacy source access gate

Before requesting a new approval, prove that the legacy source is independently reachable and parseable. This is read-only evidence gathering; it does not authorize a source retry, deployment, Workflow trigger, schedule, secret placement, database write, or publication.

Use the approved independent legacy origin and canonical current-application host for this one proof. Save only the fetched response bodies in a uniquely named temporary directory, display the response metadata, and delete only that exact directory in `finally`:

```powershell
$legacyOrigin = [Uri] "<approved-independent-legacy-origin>"
$canonicalCurrentApplicationHost = "<canonical-current-application-host>"
$legacyGateDirectory = Join-Path ([IO.Path]::GetTempPath()) ("earnest-mls-legacy-gate-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $legacyGateDirectory -ErrorAction Stop | Out-Null
try {
  $robotsPath = Join-Path $legacyGateDirectory "robots.txt"
  $seedPath = Join-Path $legacyGateDirectory "property-c1.html"
  $detailPath = Join-Path $legacyGateDirectory "property-detail.html"

  $robotsResponse = Invoke-WebRequest -Uri ([Uri]::new($legacyOrigin, "/robots.txt")) -OutFile $robotsPath -PassThru -MaximumRedirection 5
  $seedResponse = Invoke-WebRequest -Uri ([Uri]::new($legacyOrigin, "/property/c1")) -OutFile $seedPath -PassThru -MaximumRedirection 5

  @(
    [pscustomobject]@{
      request = "robots.txt"
      httpStatus = $robotsResponse.StatusCode
      finalUrl = $robotsResponse.BaseResponse.ResponseUri.AbsoluteUri
      contentType = $robotsResponse.Headers["Content-Type"]
    }
    [pscustomobject]@{
      request = "/property/c1"
      httpStatus = $seedResponse.StatusCode
      finalUrl = $seedResponse.BaseResponse.ResponseUri.AbsoluteUri
      contentType = $seedResponse.Headers["Content-Type"]
    }
  ) | Format-List

  if ($robotsResponse.Headers["Content-Type"] -notmatch "^text/plain") { throw "robots.txt is not text" }
  if ($seedResponse.BaseResponse.ResponseUri.Host -eq $canonicalCurrentApplicationHost) { throw "seed resolved to the canonical current application" }
  if ($seedResponse.BaseResponse.ResponseUri.Host -ne $legacyOrigin.Host) { throw "seed did not remain on the approved independent legacy origin" }
  if ($seedResponse.BaseResponse.ResponseUri.AbsolutePath -eq "/") { throw "seed resolved to a homepage fallback" }

  node --input-type=module -e 'import { readFileSync } from "node:fs"; import { CRAWLER_USER_AGENT, parseRobots } from "./src/lib/mls/access-policy.mjs"; const policy = parseRobots(readFileSync(process.argv[1], "utf8"), CRAWLER_USER_AGENT); console.log(JSON.stringify({ crawlerUserAgent: CRAWLER_USER_AGENT, safelyInterpretable: policy.safelyInterpretable, propertyC1Allowed: policy.isAllowed("/property/c1") })); if (!policy.safelyInterpretable || !policy.isAllowed("/property/c1")) throw new Error("robots policy is not safe for /property/c1");' $robotsPath

  $detailMatch = [regex]::Match((Get-Content -Raw -LiteralPath $seedPath), "/property-detail/\\d+\\.html")
  if (-not $detailMatch.Success) { throw "seed has no legacy detail link" }
  $detailUri = [Uri]::new($seedResponse.BaseResponse.ResponseUri, $detailMatch.Value)
  $detailResponse = Invoke-WebRequest -Uri $detailUri -OutFile $detailPath -PassThru -MaximumRedirection 5
  [pscustomobject]@{
    request = $detailUri.AbsoluteUri
    httpStatus = $detailResponse.StatusCode
    finalUrl = $detailResponse.BaseResponse.ResponseUri.AbsoluteUri
    contentType = $detailResponse.Headers["Content-Type"]
  } | Format-List
  if ($detailResponse.BaseResponse.ResponseUri.Host -ne $legacyOrigin.Host) { throw "detail did not remain on the approved independent legacy origin" }
  if ($detailResponse.BaseResponse.ResponseUri.AbsolutePath -eq "/") { throw "detail resolved to a homepage fallback" }

  node --input-type=module -e 'import { readFileSync } from "node:fs"; import { parseListingDetail } from "./src/lib/mls/parse-old-site.mjs"; const listing = parseListingDetail(readFileSync(process.argv[1], "utf8"), process.argv[2]); console.log(JSON.stringify({ parsed: Boolean(listing), externalId: listing?.externalId ?? null })); if (!listing) throw new Error("legacy detail parser returned no listing");' $detailPath $detailResponse.BaseResponse.ResponseUri.AbsoluteUri
} finally {
  Remove-Item -LiteralPath $legacyGateDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
```

robots.txt must be a parseable robots policy and must allow /property/c1 for the configured crawler user agent. The legacy seed response must come from an independent legacy origin, not the canonical current application or a homepage fallback. It must expose at least one /property-detail/<id>.html link, and one fetched detail page must parse with the existing legacy parser.

Any redirect to HTML/homepage, missing legacy link, denial, or parse failure is an immediate stop. **STOP: do not trigger or retry the shadow Workflow.** Preserve the read-only evidence for review and request a new explicit approval only after every check succeeds.

### Manual shadow readiness checks

This section is a manual, approval-gated readiness check. It does not authorize automatic schedule activation or publication. Keep the run in `shadow` with `publishEnabled:false`; the later, separately approved scheduled-deployment and first-publish examples remain outside this section.

1. Only after the separately approved secret-placement gate, copy Vercel Production variables interactively. Map `DATABASE_URL_UNPOOLED` to the Neon production value, `BLOB_READ_WRITE_TOKEN` to the Vercel Blob token retained for a later publish only, and the R2 keys to the private evidence bucket. Do not put values in files, command history, Docker arguments, or logs.
2. Run the read-only capability, runtime-name, migration, object-lock, and lifecycle checks. Record names and booleans only.
3. Record the reviewed commit SHA and the same Container/Workflow deployment identifier in the preflight capture. A repository value is not runtime provenance.
4. With the distinct unscheduled-deployment approval, deploy only the reviewed base configuration. Verify `workers_dev=false`, no routes, no schedules, and `MLS_PUBLISH_ENABLED=false`.
5. With the distinct manual-shadow approval, trigger exactly one manual production shadow Workflow from the later manual-shadow section. Capture the Workflow, attempt, authenticated private Container status, Neon run/lock, R2 objects/manifest, side effects, and redaction results below.
6. Run the verifier CLI and retain its frozen, secret-free JSON acceptance output.
7. Stop and roll back if any check fails. Do not retry, publish, enable a schedule, or run a migration rollback automatically.

Read-only capability and configuration checks:

```powershell
npm.cmd exec wrangler -- secret list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- containers list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- r2 bucket lock list <approved-bucket-name>
npm.cmd exec wrangler -- r2 bucket lifecycle list <approved-bucket-name>
```

Unscheduled deployment, only after its separate approval:

```powershell
npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.jsonc
```

Capture the exact Workflow instance and attempt after the separately approved manual shadow has been triggered:

```powershell
npm.cmd exec wrangler -- workflows instances list earnest-mls-runner --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows instances describe earnest-mls-runner <workflow-instance-id> --config workers/mls-container/wrangler.jsonc
```

Capture the authenticated private Container `/status` response only from the approved diagnostic context. Build `$statusHeaders` there from the ephemeral in-memory authorization material; never print or persist that map:

```powershell
$status = Invoke-RestMethod -Method Get -Uri "http://localhost/status" -Headers $statusHeaders
$status | ConvertTo-Json -Depth 8
```

Capture the exact Neon shadow run and confirm the advisory lock can be acquired and released after the run. Both `acquired_after_run` and `released_probe` must be true; the probe uses one session and releases anything it acquires:

```powershell
psql "$env:DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -c "SELECT id::text AS run_id, scheduled_for::text, mode, status, source_status, counts, failure_code FROM listing_sync_runs WHERE id = '<run-id>'::uuid;"
psql "$env:DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -c "SELECT pg_try_advisory_lock(hashtext('earnestproperty:mls-sync')) AS acquired_after_run;" -c "SELECT pg_advisory_unlock(hashtext('earnestproperty:mls-sync')) AS released_probe;"
psql "$env:DATABASE_URL_UNPOOLED" -X -v ON_ERROR_STOP=1 -c "SELECT count(*)::int AS publication_attempts FROM listing_change_events WHERE run_id = '<run-id>'::uuid;"
```

Capture the private R2 prefix, complete object list, per-artifact metadata, terminal manifest, and hash. The expected object names are `report.json`, `listings.csv`, `observations.csv`, `diagnostics.json`, and `manifest.json`:

```powershell
aws s3api list-objects-v2 --endpoint-url "https://$env:CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" --bucket <approved-bucket-name> --prefix <exact-evidence-prefix> --output json
$artifactNames = @("report.json", "listings.csv", "observations.csv", "diagnostics.json")
$artifactNames | ForEach-Object { aws s3api head-object --endpoint-url "https://$env:CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" --bucket <approved-bucket-name> --key "<exact-evidence-prefix>/$($_)" --output json }
aws s3api get-object --endpoint-url "https://$env:CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" --bucket <approved-bucket-name> --key "<exact-evidence-prefix>/manifest.json" <captured-manifest-path>
Get-FileHash -Algorithm SHA256 <captured-manifest-path>
```

Derive `blobUploads` from `report.json.counts.mediaUploaded` and `publicationAttempts` from the Neon count above. Both must be zero. Scan the complete capture bundle before setting the redaction booleans; any match is a failed gate:

```powershell
rg -n --pcre2 "(Authorization|postgres(?:ql)?://|access[_-]?token|secret[_-]?access|private[_-]?key|password)" <capture-bundle-directory>
```

Use these exact JSON shapes. Replace angle-bracket operands from the captured outputs, keep the listed keys exact, and never paste a credential value.

```json
{
  "account": { "capability": true },
  "worker": { "workersDev": false, "routes": [], "schedules": [] },
  "container": {
    "registered": true,
    "deploymentId": "<container-and-workflow-deployment-id>"
  },
  "workflow": {
    "registered": true,
    "deploymentId": "<container-and-workflow-deployment-id>",
    "commitSha": "<reviewed-40-character-commit-sha>"
  },
  "migration": {
    "applied": true,
    "version": "20260817120000_dual_source_listing_sync.sql"
  },
  "secrets": {
    "names": [
      "DATABASE_URL_UNPOOLED",
      "MLS_R2_ACCESS_KEY_ID",
      "MLS_R2_SECRET_ACCESS_KEY",
      "MLS_CRAWLER_CONTACT_URL",
      "MLS_MEDIA_ALLOWED_HOSTS",
      "CLOUDFLARE_ACCOUNT_ID",
      "MLS_EVIDENCE_BUCKET",
      "CLOUDFLARE_DEPLOYMENT_ID"
    ]
  },
  "r2": {
    "bucket": "earnest-mls-evidence",
    "objectLock": "COMPLIANCE",
    "retentionDays": 90,
    "lifecycleDays": 90
  },
  "flags": {
    "mode": "shadow",
    "publishEnabled": false,
    "mediaRightsConfirmed": false
  }
}
```

The optional runtime-name inventory may additionally include documented non-secret names and `BLOB_READ_WRITE_TOKEN`, which remains publish-only and is never required for shadow. Unknown names fail closed.

```json
{
  "identity": {
    "attemptId": "<scheduled-production-attempt-id>",
    "workflowId": "<workflow-instance-id>",
    "deploymentId": "<container-and-workflow-deployment-id>",
    "commitSha": "<reviewed-40-character-commit-sha>",
    "runId": "<run-uuid>",
    "evidencePrefix": "<exact-evidence-prefix>"
  },
  "workflow": {
    "attemptId": "<scheduled-production-attempt-id>",
    "deploymentId": "<container-and-workflow-deployment-id>",
    "state": "succeeded"
  },
  "container": {
    "deploymentId": "<container-and-workflow-deployment-id>",
    "state": "succeeded",
    "exitCode": 0
  },
  "run": {
    "attemptId": "<scheduled-production-attempt-id>",
    "workflowId": "<workflow-instance-id>",
    "deploymentId": "<container-and-workflow-deployment-id>",
    "commitSha": "<reviewed-40-character-commit-sha>",
    "runId": "<run-uuid>",
    "evidencePrefix": "<exact-evidence-prefix>"
  },
  "sources": {
    "configured": ["old_site", "28hse_agent_540"],
    "health": { "old_site": "full", "28hse_agent_540": "full" }
  },
  "neon": { "shadow": true, "healthy": true, "lockReleased": true },
  "r2": {
    "evidencePrefix": "<exact-evidence-prefix>",
    "manifestPresent": true,
    "manifestSha256": "<64-character-lowercase-sha256>",
    "objectKeys": [
      "<exact-evidence-prefix>/report.json",
      "<exact-evidence-prefix>/listings.csv",
      "<exact-evidence-prefix>/observations.csv",
      "<exact-evidence-prefix>/diagnostics.json",
      "<exact-evidence-prefix>/manifest.json"
    ],
    "objects": [
      {
        "name": "report.json",
        "key": "<exact-evidence-prefix>/report.json",
        "byteLength": 0,
        "contentType": "application/json; charset=utf-8",
        "sha256": "<report-sha256>"
      },
      {
        "name": "listings.csv",
        "key": "<exact-evidence-prefix>/listings.csv",
        "byteLength": 0,
        "contentType": "text/csv; charset=utf-8",
        "sha256": "<listings-sha256>"
      },
      {
        "name": "observations.csv",
        "key": "<exact-evidence-prefix>/observations.csv",
        "byteLength": 0,
        "contentType": "text/csv; charset=utf-8",
        "sha256": "<observations-sha256>"
      },
      {
        "name": "diagnostics.json",
        "key": "<exact-evidence-prefix>/diagnostics.json",
        "byteLength": 0,
        "contentType": "application/json; charset=utf-8",
        "sha256": "<diagnostics-sha256>"
      }
    ],
    "manifest": {
      "schemaVersion": 1,
      "environment": "production",
      "hkDate": "<Hong-Kong-date>",
      "attemptId": "<scheduled-production-attempt-id>",
      "mode": "shadow",
      "commitSha": "<reviewed-40-character-commit-sha>",
      "containerDeploymentId": "<container-and-workflow-deployment-id>",
      "workflowInstanceId": "<workflow-instance-id>",
      "containerId": "<container-id>",
      "runId": "<run-uuid>",
      "status": "shadow_healthy",
      "terminalClassification": "shadow_healthy",
      "exitCode": 0,
      "startedAt": "<millisecond-UTC-start>",
      "completedAt": "<millisecond-UTC-completion>",
      "durationMs": 0,
      "neonRunId": "<neon-run-uuid>",
      "artifacts": [
        {
          "name": "report.json",
          "byteLength": 0,
          "contentType": "application/json; charset=utf-8",
          "sha256": "<report-sha256>"
        },
        {
          "name": "listings.csv",
          "byteLength": 0,
          "contentType": "text/csv; charset=utf-8",
          "sha256": "<listings-sha256>"
        },
        {
          "name": "observations.csv",
          "byteLength": 0,
          "contentType": "text/csv; charset=utf-8",
          "sha256": "<observations-sha256>"
        },
        {
          "name": "diagnostics.json",
          "byteLength": 0,
          "contentType": "application/json; charset=utf-8",
          "sha256": "<diagnostics-sha256>"
        }
      ]
    }
  },
  "statusRoute": {
    "attemptId": "<scheduled-production-attempt-id>",
    "state": "succeeded",
    "exitCode": 0,
    "manifestPresent": true
  },
  "sideEffects": { "blobUploads": 0, "publicationAttempts": 0 },
  "redaction": { "secretsAbsent": true, "credentialPatternsAbsent": true }
}
```

Verifier acceptance record:

```powershell
node scripts/mls/verify-shadow.mjs --preflight <path> --evidence <path> --output <path>
```

If a check fails, preserve evidence and stop for explicit operator direction. These rollback commands are intentionally commented and require a separate rollback approval. They terminate the recorded Workflow instance, remove the recorded Container application, restore the exact prior base configuration captured before deployment, and redeploy that prior base. They are not executable defaults:

```powershell
# npm.cmd exec wrangler workflows instances terminate earnest-mls-runner <workflow-instance-id> --config workers/mls-container/wrangler.jsonc
# npm.cmd exec wrangler containers delete <container-application-name> --config workers/mls-container/wrangler.jsonc
# Copy-Item -LiteralPath <recorded-prior-base-config> -Destination workers/mls-container/wrangler.jsonc
# npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.jsonc
```

## 4. R2 evidence resource

After a separate approval, create a private Workers Paid R2 bucket for the approved project. Add a **90-day bucket lock** for immutable evidence and an `mls-sync/` 90-day lifecycle rule. List both rules and record their IDs, bucket name, and region. The application credential is bucket-scoped Object Read & Write. Application code has no delete operation; retention and deletion are provider policy, not a runtime command.

Read-only inspection after the operator has resolved and recorded the bucket name:

```powershell
npm.cmd exec wrangler -- r2 bucket lock list <approved-bucket-name>
npm.cmd exec wrangler -- r2 bucket lifecycle list <approved-bucket-name>
```

Angle-bracket operands are execution-time operator inputs. Resolve and record them before a command runs; they are not implementation placeholders.

## 5. Secrets

After separate secret-placement approval, use interactive `wrangler secret put` for each approved name. Do not pass values on a command line, put them in shell history, Docker build args, `.env` files, or Vercel-to-Cloudflare copy scripts. Names only:

- `DATABASE_URL_UNPOOLED`
- `BLOB_READ_WRITE_TOKEN` (publish only)
- `MLS_R2_ACCESS_KEY_ID`
- `MLS_R2_SECRET_ACCESS_KEY`
- `MLS_CRAWLER_CONTACT_URL` (non-secret contact URL)
- `MLS_MEDIA_ALLOWED_HOSTS` (non-secret reviewed host list)
- `MLS_PUBLISH_ENABLED` (non-secret gate)
- `MLS_MEDIA_RIGHTS_CONFIRMED` (non-secret gate)
- `CLOUDFLARE_ACCOUNT_ID`, `MLS_EVIDENCE_BUCKET`, and `CLOUDFLARE_DEPLOYMENT_ID` (non-secret identifiers)

The supervisor token is generated per Container start and is never a Workflow step result or durable attempt field.

## 6. Unscheduled deployment

Only after the unscheduled deployment approval, deploy the base configuration:

```powershell
npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.jsonc
```

Verify from the reviewed configuration and read-only describe output that `workers_dev=false`, there are no routes, there are no schedules, the Container image is registered, and the Workflow is registered. Keep `MLS_SCHEDULED_MODE=shadow`, `MLS_PUBLISH_ENABLED=false`, and `MLS_MEDIA_RIGHTS_CONFIRMED=false` until the later approvals.

## 7. Manual production shadow

After separate live-source and manual-shadow approval, trigger one manual shadow. The timestamp is operator-supplied at execution time and must represent the intended Hong Kong evidence date:

```powershell
npm.cmd exec wrangler -- workflows trigger earnest-mls-runner '{"kind":"manual","mode":"shadow","reason":"first production shadow after Cloudflare cutover","suffix":"shadow-0001","scheduledTime":"<approved UTC timestamp>"}' --config workers/mls-container/wrangler.jsonc
```

Record the Workflow ID, attempt ID, Container deployment, Neon run UUID, R2 evidence prefix, and manifest hash. A `publication_outcome_unknown` result is an ambiguous commit state: reconcile Neon, R2, Blob, and the Container record before retrying; never infer rollback from it.

## 8. Seven daily shadow approval

Only after the manual shadow proof is accepted, deploy the scheduled configuration. Verify the Workflow description reports only `0 18 * * *` and collect **seven approved healthy Hong Kong dates**. Each date must include source health, exact match counts, quarantine and lifecycle evidence, media validation, R2 manifest presence, and owner approval.

```powershell
npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.scheduled.jsonc
```

## 9. Manual first publish

After media-rights authorization, a separate publish-flag change approval, and seven approved healthy shadow dates, trigger exactly one manual `publish` using the same Workflow command with `"mode":"publish"` and an operator-approved suffix. Verify canonical identity, source links, field/lifecycle/event evidence, media rights, Vercel Blob URLs, R2 artifacts, and the Neon run UUID before accepting the result.

## 10. Seven monitored live runs (scheduled publish)

Only after the manual first-publish approval, update the reviewed non-secret mode/flags and redeploy the scheduled configuration. Monitor seven scheduled dates. Stop on degraded source health, unexpected quarantine, ownership mismatch, duplicate identity, missing manifest, Blob rights failure, or any event inconsistency.

## 11. Rollback

Use the unscheduled configuration, set the reviewed gates back to shadow/false, and reconcile any running Workflow and Container state before terminating it. Preserve Neon, R2, and Blob evidence. Do not reactivate retired host scheduling while Cloudflare may still run. Reversing already-published canonical values is a separate approved compensating operation; never delete or rewrite audit history.

Read-only inspection commands:

```powershell
npm.cmd exec wrangler -- workflows describe earnest-mls-runner --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows instances list earnest-mls-runner --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows instances describe earnest-mls-runner latest --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- containers list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- r2 bucket lock list <approved-bucket-name>
npm.cmd exec wrangler -- r2 bucket lifecycle list <approved-bucket-name>
```

The existing `npm run mls:shadow` and `npm run mls:legacy-sync` commands remain local/operator references only; neither is an automatic Cloudflare or host schedule.

## Production boundary

Migration, credential placement, live scraping, Vercel Blob upload, Cloudflare deployment, schedule enablement, and production publication each require explicit authorization and independent evidence. Code verification here is not rollout proof.
