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

This section is a manual, approval-gated readiness check. It does not authorize automatic schedule activation or publication. Keep the run in `shadow` with `publishEnabled:false`; the later, separately approved scheduled-deployment and first-publish examples remain outside this section.

1. Only after the separately approved secret-placement gate, copy Vercel Production variables interactively. Map `DATABASE_URL_UNPOOLED` to the Neon production value, `BLOB_READ_WRITE_TOKEN` to the Vercel Blob token retained for a later publish only, and the R2 keys to the private evidence bucket. Do not put values in files, command history, Docker arguments, or logs.
2. Run the read-only capability, secret-name, and lock checks below. Record names and booleans only, including Cloudflare capability, Container and Workflow registration, migration status, object-lock status, and `publishEnabled:false`.
3. With the distinct unscheduled-deployment approval, deploy only the reviewed base configuration. Verify `workers_dev=false`, no routes, no schedules, and `MLS_PUBLISH_ENABLED=false`.
4. With the distinct manual-shadow approval, trigger exactly one manual production shadow workflow. Capture the Workflow, attempt, deployment, Neon run, R2 prefix, terminal-status, and side-effect snapshots.
5. Run the verifier CLI and retain its JSON acceptance output.
6. Stop and roll back if any check fails. Do not retry, publish, enable a schedule, or run a migration rollback automatically.

Read-only checks (record names and booleans, never values):

```powershell
npm.cmd exec wrangler -- secret list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- containers list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- r2 bucket lock list <approved-bucket-name>
npm.cmd exec wrangler -- r2 bucket lifecycle list <approved-bucket-name>
```

Unscheduled deployment, after its separate approval:

```powershell
npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.jsonc
```

Verifier acceptance record:

```powershell
node scripts/mls/verify-shadow.mjs --preflight <path> --evidence <path> --output <path>
```

| Captured snapshot    | Source                                 | Acceptance rule                                                         |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Workflow and attempt | Workflow status                        | One manual shadow attempt reaches a terminal success state.             |
| Deployment           | Container and Workflow describe output | Both report the reviewed deployment identifier.                         |
| Neon run             | Shadow-run record                      | It is healthy, remains shadow-only, and releases its lock.              |
| R2 prefix            | Private evidence-bucket manifest       | The exact prefix has the required manifest artifacts and lock coverage. |
| Terminal status      | Workflow, Container, and status route  | States correlate, exit code is zero, and the manifest is present.       |
| Side effects         | Shadow evidence summary                | Blob uploads and publication attempts are both zero.                    |

If a check fails, preserve evidence and stop for explicit operator direction. The following rollback examples are intentionally commented; they are not executable defaults:

```powershell
# npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.jsonc
# npm.cmd exec wrangler -- workflows instances list earnest-mls-runner --config workers/mls-container/wrangler.jsonc
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
