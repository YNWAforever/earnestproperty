# MLS Manual Production Shadow Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build an offline, fail-closed verifier and operator runbook for one manually triggered production MLS shadow run, with strict Cloudflare/Neon/R2 correlation and proof of zero Blob/publication side effects.

**Architecture:** A pure Node verifier consumes operator-captured JSON snapshots and never calls Cloudflare, Neon, R2, Vercel Blob, or MLS sources. The activation runbook keeps secret entry, unscheduled deployment, and the one live shadow as explicit operator actions, then directs the operator to run the verifier and retain its acceptance record.

**Tech Stack:** Node.js ESM, Node built-in node:test, node:fs/promises, PowerShell, Wrangler 4.125.0, Cloudflare Workers/Workflows/Containers, Neon Postgres, private R2, and existing MLS sync contracts.

## Global constraints

- Work only in C:/Users/laich/Documents/Earnestproperty/Earnestproperty/.worktrees/28hse-dual-source-sync.
- Preserve all existing unrelated dirt and the uncommitted src/lib/mls/orchestrator.mjs and src/lib/mls/orchestrator.test.mjs diagnostic slice. Do not stage those files.
- Do not call Wrangler, Docker, Neon, R2, Vercel Blob, an MLS source, a migration, a deployment, a schedule, or a publication during implementation. Tests use only local fixtures.
- Never print secret values. Fixtures use sentinel strings such as postgres://redacted.invalid/db and blob-token-redacted; verifier output contains only bounded failure codes and identity metadata.
- Every production-code change is preceded by a persisted test-only RED and followed by a focused GREEN.
- The verifier accepts only exact own-data records. Reject arrays, inherited properties, symbols, accessors, extra keys, prototype changes, non-primitive scalars, malformed timestamps, invalid IDs, and unsafe evidence paths without invoking untrusted conversions.
- Acceptance is fail-closed: any failed required check returns accepted:false; a rejected run exits with code 30.

## File map

| File | Purpose |
| --- | --- |
| scripts/mls/verify-shadow.mjs | Pure preflight/evidence verifier and CLI entrypoint. |
| scripts/mls/verify-shadow.test.mjs | RED/GREEN unit and CLI tests using only in-memory snapshots and temp files. |
| docs/mls-production-activation.md | Operator sequence for Vercel-secret copy, R2/Neon checks, unscheduled deployment, one manual shadow, and rollback. |
| docs/superpowers/specs/2026-08-23-mls-manual-production-shadow-readiness-design.md | Approved design; read-only reference, not modified by this plan. |

## Task 1: Build the pure fail-closed verifier

- [ ] RED: add the verifier test file before the module. Create scripts/mls/verify-shadow.test.mjs with node:test and assert/strict. Add these exact fixtures:
  - VALID_ATTEMPT_ID = scheduled:production:2026-08-23
  - VALID_RUN_ID = 00000000-0000-4000-8000-000000000001
  - VALID_WORKFLOW_ID = workflow-20260823-01
  - VALID_DEPLOYMENT_ID = deployment-20260823-01
  - VALID_PREFIX = mls-sync/production/2026-08-23/00000000-0000-4000-8000-000000000001/scheduled:production:2026-08-23
  - validPreflight() returns exact own keys account, worker, container, workflow, migration, secrets, r2, flags. Set account capability true; worker workersDev:false, routes:[], schedules:[]; container/workflow registered:true, deploymentId:VALID_DEPLOYMENT_ID; migration applied:true, version:2026-08-22-mls-evidence; secrets names:["DATABASE_URL_UNPOOLED","MLS_R2_ACCESS_KEY_ID","MLS_R2_SECRET_ACCESS_KEY","MLS_CRAWLER_CONTACT_URL","MLS_MEDIA_ALLOWED_HOSTS","CLOUDFLARE_ACCOUNT_ID","MLS_EVIDENCE_BUCKET","CLOUDFLARE_DEPLOYMENT_ID"]; R2 bucket:earnest-mls-evidence, objectLock:COMPLIANCE, retentionDays:90, lifecycleDays:90; flags mode:shadow, publishEnabled:false, mediaRightsConfirmed:false.
  - validEvidence() returns exact own keys identity, workflow, container, run, sources, neon, r2, statusRoute, sideEffects, redaction. Correlate all identity fields to the constants above; set all source health full; Neon shadow:true, healthy:true, lockReleased:true; R2 manifestPresent:true, manifestSha256:"a".repeat(64), objectKeys containing VALID_PREFIX/run.json, diagnostics.json, summary.json, manifest.json; status route attemptId, state:succeeded, exitCode:0, manifestPresent:true; side effects blobUploads:0, publicationAttempts:0; redaction secretsAbsent:true, credentialPatternsAbsent:true.
- [ ] RED: run the focused test. Execute node --test scripts/mls/verify-shadow.test.mjs. Expected result before implementation: module-load failure ERR_MODULE_NOT_FOUND for ./verify-shadow.mjs. Append the exact command and failure to ignored .superpowers/sdd/mls-shadow-readiness-report.md.
- [ ] GREEN: implement scripts/mls/verify-shadow.mjs with these exports:
    export function verifyShadowPreflight(snapshot) { return { accepted, failures, checks }; }
    export function verifyShadowEvidence(snapshot) { return { accepted, failures, checks, identity }; }
    export function buildShadowAcceptanceRecord({ preflight, evidence, checkedAt }) { return frozen JSON-safe record; }
  Use descriptor-safe exact own-data records and these constants:
    const ATTEMPT = /^scheduled:(preview|production):\d{4}-\d{2}-\d{2}(?::manual:[a-z0-9][a-z0-9-]{7,63})?$/;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const SHA256 = /^[0-9a-f]{64}$/i;
    const FAILURE = /^[a-z][a-z0-9_-]{0,79}$/;
    const REQUIRED_SECRET_NAMES = ["DATABASE_URL_UNPOOLED","MLS_R2_ACCESS_KEY_ID","MLS_R2_SECRET_ACCESS_KEY","MLS_CRAWLER_CONTACT_URL","MLS_MEDIA_ALLOWED_HOSTS","CLOUDFLARE_ACCOUNT_ID","MLS_EVIDENCE_BUCKET","CLOUDFLARE_DEPLOYMENT_ID"];
  verifyShadowPreflight emits stable failure codes only: cloudflare_capability_unavailable, workers_dev_enabled, routes_present, schedules_present, container_not_registered, workflow_not_registered, migration_not_applied, shadow_environment_invalid, publish_flag_enabled, media_rights_flag_enabled, missing_secret_name:<name>, r2_bucket_invalid, r2_lock_invalid, r2_lifecycle_invalid. It accepts only with an empty failure list.
  verifyShadowEvidence correlates identity.attemptId, identity.workflowId, identity.deploymentId, identity.runId, identity.evidencePrefix; requires successful workflow/container and matching deployment; requires succeeded terminal status with exitCode 0 and a present manifest; requires full health for every configured source; requires Neon shadow/healthy/lockReleased; requires four R2 objects, exact prefix, and SHA-256; requires status-route correlation; requires sideEffects.blobUploads === 0 and sideEffects.publicationAttempts === 0; and requires both redaction booleans. It emits only: attempt_id_invalid, shadow_identity_invalid, workflow_attempt_mismatch, workflow_deployment_mismatch, workflow_not_successful, container_not_successful, run_identity_mismatch, evidence_prefix_mismatch, manifest_missing, source_health_not_full, neon_shadow_not_healthy, manifest_invalid, status_route_mismatch, blob_side_effect_detected, publication_side_effect_detected, redaction_check_failed.
  buildShadowAcceptanceRecord requires both accepted inputs and a valid millisecond UTC checkedAt, then returns a frozen object with only accepted, checkedAt, preflightChecks, evidenceChecks, identity. It never includes snapshots or secrets.
- [ ] GREEN: add passing verifier tests. Assert valid fixtures are accepted; mutate one required condition at a time and assert the exact bounded code. Include malformed objects, accessors, inherited fields, extra keys, symbol keys, non-string IDs, invalid UUID/SHA-256, path traversal, credential-bearing free text, Blob/publication counts above zero, and caller mutation after verification. Assert coercion counters stay zero and returned checks/identity are frozen snapshots.
- [ ] GREEN verification and commit. Run node --test scripts/mls/verify-shadow.test.mjs (target 25 tests), node --check scripts/mls/verify-shadow.mjs, npx prettier --check scripts/mls/verify-shadow.mjs scripts/mls/verify-shadow.test.mjs, npx eslint scripts/mls/verify-shadow.mjs scripts/mls/verify-shadow.test.mjs, and git -c core.filemode=false diff --check -- scripts/mls/verify-shadow.mjs scripts/mls/verify-shadow.test.mjs. Stage only the two verifier paths and commit feat: verify MLS shadow evidence.

## Task 2: Add the CLI and bounded acceptance output

- [ ] RED: extend scripts/mls/verify-shadow.test.mjs before adding CLI code. Import mkdtemp, readFile, rm, writeFile from node:fs/promises and tmpdir from node:os. Add tests that call main(["--preflight", preflightPath, "--evidence", evidencePath, "--output", outputPath], deps), assert exit 0 and output accepted:true; call it with bad evidence, assert exit 30 and only bounded failure codes; assert missing arguments return 2 with no file writes; assert output directory creation is rejected rather than writing outside the requested path; assert a credential in rejected input never appears in stdout, stderr, or output.
- [ ] RED: run node --test scripts/mls/verify-shadow.test.mjs. Expected failure is main is not exported or an equivalent missing-CLI export while Task 1 remains green. Append the exact result to the ignored report.
- [ ] GREEN: export main(argv, dependencies = {}). Accept only the exact --preflight path --evidence path --output path argument set. Use injected readFile, writeFile, mkdir, and now for tests. Read bounded UTF-8 JSON (256 KiB), call the pure verifiers, build the acceptance record, create only the explicitly requested parent directory when it is an existing directory or direct child, write UTF-8 JSON with a trailing newline, return 0 if accepted and 30 otherwise, and return 2 for usage/read/parse errors. Sanitize thrown errors to cli_input_invalid or cli_output_invalid; never serialize raw errors. Direct execution is:
    if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
      const exitCode = await main(process.argv.slice(2));
      process.exitCode = exitCode;
    }
- [ ] GREEN verification and commit. Run node --test scripts/mls/verify-shadow.test.mjs (target 31 tests), node --check on both verifier files, Prettier, ESLint, and scoped diff checks. Stage only the verifier paths and commit feat: add MLS shadow verifier CLI.

## Task 3: Update the operator runbook without expanding live authority

- [ ] RED: add a runbook contract test to scripts/mls/verify-shadow.test.mjs. Read docs/mls-production-activation.md and assert it contains these exact PowerShell shapes: npm.cmd exec wrangler -- secret list --config workers/mls-container/wrangler.jsonc; npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.jsonc; node scripts/mls/verify-shadow.mjs --preflight <path> --evidence <path> --output <path>. Assert it contains shadow, publishEnabled:false, BLOB_READ_WRITE_TOKEN, migration, and rollback; assert it contains no secret values and no automatic schedule/publish command. The RED must fail if any exact command is absent.
- [ ] GREEN: edit only docs/mls-production-activation.md. Add a Manual shadow readiness verifier section after preflight:
  1. Copy Vercel Production variables interactively; map DATABASE_URL_UNPOOLED to the Neon production value, BLOB_READ_WRITE_TOKEN to the Vercel Blob token for later publish only, R2 keys to the private evidence bucket, and do not put values in files, command history, Docker args, or logs.
  2. Run read-only secret/capability/lock checks and record names/booleans only.
  3. Run the unscheduled deployment with workers_dev=false, no routes, no schedules, and MLS_PUBLISH_ENABLED=false.
  4. Trigger exactly one manual production shadow workflow; capture Workflow, attempt, deployment, Neon run, R2 prefix, terminal-status, and side-effect snapshots.
  5. Run the verifier CLI and retain the JSON acceptance output.
  6. Stop and roll back if any check fails; do not retry, publish, enable a schedule, or run a migration rollback automatically.
  Include a compact table mapping each captured snapshot field to its source and acceptance rule. Include rollback commands as commented PowerShell examples, not executable defaults.
- [ ] GREEN verification. Run the runbook contract test; run git -c core.filemode=false diff --check -- docs/mls-production-activation.md scripts/mls/verify-shadow.test.mjs; inspect the diff to confirm no secret literals or live action was added. Stage only the documentation and test paths and commit docs: add gated MLS shadow verification runbook.

## Task 4: Final offline acceptance gate

- [ ] Run node --test scripts/mls/verify-shadow.test.mjs and record the exact final count.
- [ ] Run node --check scripts/mls/verify-shadow.mjs and node --check scripts/mls/verify-shadow.test.mjs.
- [ ] Run npx prettier --check scripts/mls/verify-shadow.mjs scripts/mls/verify-shadow.test.mjs.
- [ ] Run npx eslint scripts/mls/verify-shadow.mjs scripts/mls/verify-shadow.test.mjs.
- [ ] Run git -c core.filemode=false diff --check -- scripts/mls/verify-shadow.mjs scripts/mls/verify-shadow.test.mjs docs/mls-production-activation.md.
- [ ] Run git status --short and confirm only the two verifier files, the runbook, and the ignored evidence report are attributable to this plan; preserve all pre-existing unrelated dirt.
- [ ] Do not run any live/provider/build action. Report provider/live/build as not run.
- [ ] Commit only if all gates pass with feat: complete MLS manual shadow readiness verifier after explicit path staging; otherwise leave the failure uncommitted and report the exact gate.

