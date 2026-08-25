# Cloudflare-Native MLS Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the branch's VPS/systemd MLS execution path with a dedicated, directly scheduled Cloudflare Workflow that launches one fail-closed Cloudflare Container per attempt, while keeping Neon as the canonical database, Vercel Blob as listing-media storage, and private R2 as immutable 90-day operational evidence.

**Architecture:** A dedicated `workers/mls-container` Worker exports `MlsRunWorkflow` and `MlsRunContainer`. The Workflow derives a deterministic Hong Kong run identity, delegates an idempotent claim/start RPC to the Container Durable Object, and polls a one-shot Node supervisor. The supervisor invokes the existing `scripts/mls/sync.mjs` pipeline unchanged in ownership: it keeps the direct unpooled Neon advisory-lock session, source collection, reconciliation, Vercel Blob upload, and atomic publication inside one process. The CLI gains an R2 whole-object reporter and deployment metadata, but filesystem reporting remains available for local/operator use. Base deployment has no schedule; a separate, structurally equivalent scheduled Wrangler config adds `0 18 * * *` only after the shadow gates are approved.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, Bun 1.3 tests for Worker TypeScript, TypeScript 5.8, Cloudflare Workflows, Cloudflare Containers with SQLite-backed Durable Objects, `@cloudflare/containers` 0.3.7, Wrangler 4.125.0, `@cloudflare/workers-types` 5.20260820.1, `@aws-sdk/client-s3` 3.1115.0 against R2's S3 API, Neon Postgres, Vercel Blob, native `sharp` 0.34, Docker `linux/amd64`, and private R2 bucket locks/lifecycle rules.

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-21-cloudflare-mls-container-design.md` as the approved behavior contract. The earlier dual-source design remains authoritative for sources, matching, reconciliation, media, database, and publication behavior.
- Create a dedicated `workers/mls-container` project. Do not modify `workers/cron` and do not add a second MLS trigger to it.
- Keep the current integrated Node orchestrator inside one Container attempt. Worker and Workflow code may not crawl sources, prepare/upload listing media, synthesize canonical proposals, hold the Neon advisory lock, or publish rows.
- Keep direct `DATABASE_URL_UNPOOLED` use. Do not add Hyperdrive, a pooled proxy, D1, Cloudflare Images, or an R2 listing-media path.
- A scheduled attempt is unique by deployment environment plus Hong Kong calendar date derived from `event.schedule.scheduledTime`. A duplicate delivery must return the claimed attempt and perform no source, Blob, R2, or database work.
- A manual retry has an explicit operator reason and distinct attempt suffix. It never resumes or overwrites an old attempt.
- Do not automatically rerun the integrated command after failure or unknown outcome. Workflow control-plane RPC retries are allowed only when the Durable Object makes them idempotent and proves that no second child can spawn.
- Preserve the existing PostgreSQL advisory lock as an independent concurrency barrier. `max_instances: 1` is a capacity guard, not a replacement for database locking.
- Shadow mode cannot upload Vercel Blob media or publish canonical rows. Publish requires explicit `--mode=publish`, `MLS_PUBLISH_ENABLED=true`, `MLS_MEDIA_RIGHTS_CONFIRMED=true`, and every existing repository/health/streak gate.
- R2 evidence uses unique keys below `mls-sync/<environment>/<HK-date>/<run-id>/<attempt-id>/`. Write the manifest last with `If-None-Match: *`; application code never deletes evidence.
- Never place secret values in source, Wrangler config, Docker build args, image layers, Workflow state, Durable Object state, object keys/metadata, test snapshots, or logs. `.dev.vars` stays ignored.
- The only production secrets are `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`, `MLS_R2_ACCESS_KEY_ID`, `MLS_R2_SECRET_ACCESS_KEY`, and the generated per-attempt supervisor token. Non-secret config remains explicit and defaults to shadow/disabled.
- The protected `/api/mls-sync` route stays read-only. It may report `publisher: "cloudflare-container"`; it may not start, retry, cancel, or publish a run.
- Preserve the four unrelated dirty paths (`.superpowers/sdd/progress.md`, `bun.lockb`, `src/generated/old-site-redirects.json`, and `src/routeTree.gen.ts`) and untracked `.codebase-memory/`. Use `npm.cmd`, not Bun, for dependency installation so `bun.lockb` is not rewritten.
- Do not apply the production migration, create a Cloudflare project/bucket/token, place credentials, make live source requests, upload Blob media, deploy Vercel or Cloudflare, enable a schedule, or enable publication while implementing this plan. Each remains a separately authorized rollout action.
- Build and static verification may use Docker and Wrangler dry-run only. If Workers Paid, Containers, Workflows, Docker, or account access is missing, record it as an external gate rather than weakening the implementation.

---

## Provider Contracts Fixed by This Plan

- Direct Workflow schedules live on the Workflow binding's `schedules` array. Production cron is exactly `0 18 * * *`; there is no top-level `scheduled()` handler.
- `MlsRunContainer` is a SQLite-backed Durable Object: `new_sqlite_classes`, never legacy `new_classes`.
- The Container image is `linux/amd64`, `instance_type: "standard-1"` (4 GiB memory), `max_instances: 1`, and has outbound internet enabled for the authorized source, Neon, Vercel Blob, and R2 endpoints.
- Per-attempt secrets/config enter through `startAndWaitForPorts({ startOptions: { envVars } })`; no build-time secret or global Container class `envVars` is used.
- R2 S3 requests use region `auto` and conditional `PutObject` with `IfNoneMatch: "*"`. A `412 PreconditionFailed` is an immutable-key collision, not a retry signal.
- A 90-day R2 bucket lock protects objects from overwrite/deletion; a 90-day-or-later lifecycle rule performs retention cleanup. Application credentials are bucket-scoped Object Read & Write and application code never issues `DeleteObject`.

## File Map

### Create

- `workers/mls-container/wrangler.jsonc`
- `workers/mls-container/wrangler.scheduled.jsonc`
- `workers/mls-container/tsconfig.json`
- `workers/mls-container/src/run-contract.ts`
- `workers/mls-container/src/run-contract.test.ts`
- `workers/mls-container/src/container.ts`
- `workers/mls-container/src/container.test.ts`
- `workers/mls-container/src/workflow.ts`
- `workers/mls-container/src/workflow.test.ts`
- `workers/mls-container/src/index.ts`
- `workers/mls-container/container/server.mjs`
- `workers/mls-container/container/server.test.mjs`
- `workers/mls-container/Dockerfile`
- `workers/mls-container/Dockerfile.dockerignore`
- `workers/mls-container/README.md`
- `src/lib/mls/r2-reporting.mjs`
- `src/lib/mls/r2-reporting.test.mjs`
- `scripts/mls/sync.test.mjs`

### Modify

- `package.json`
- `package-lock.json`
- `.gitignore`
- `.env.example`
- `src/lib/mls/reporting.mjs`
- `src/lib/mls/reporting.test.mjs`
- `scripts/mls/sync.mjs`
- `src/routes/api.mls-sync.ts`
- `src/routes/api.mls-sync.test.mjs`
- `src/lib/mls/ops-contract.test.mjs`
- `ops/systemd/earnest-mls-sync.service`
- `ops/systemd/earnest-mls-sync.timer`
- `docs/mls-production-activation.md`
- `docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md`

### Must remain unchanged

- `workers/cron/**`
- Neon migrations and migration manifest
- `src/lib/mls/orchestrator.mjs`
- `src/lib/mls/sync-repository.mjs`
- `src/lib/mls/media.mjs`
- Public property read paths

---

## Task 1: Scaffold the Dedicated Cloudflare Project and Run Contract

**Files:**

- Create: `workers/mls-container/src/run-contract.ts`
- Create: `workers/mls-container/src/run-contract.test.ts`
- Create: `workers/mls-container/wrangler.jsonc`
- Create: `workers/mls-container/wrangler.scheduled.jsonc`
- Create: `workers/mls-container/tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**

```ts
export type RunMode = "shadow" | "publish";
export type RunState = "pending" | "running" | "succeeded" | "failed" | "unknown";

export interface RunEnvelope {
  environment: "preview" | "production";
  hkDate: string;
  attemptId: string;
  kind: "scheduled" | "manual";
  mode: RunMode;
  scheduledTime: string;
  manualReason: string | null;
  commitSha: string;
}

export function hongKongDate(scheduledTime: number | string | Date): string;
export function scheduledAttemptId(environment: string, hkDate: string): string;
export function buildRunEnvelope(input: unknown): Readonly<RunEnvelope>;
export function transitionRunState(current: RunState, next: RunState): RunState;
```

- [ ] **Step 1: Write the failing pure run-contract tests**

Create `workers/mls-container/src/run-contract.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  buildRunEnvelope,
  hongKongDate,
  scheduledAttemptId,
  transitionRunState,
} from "./run-contract";

describe("Cloudflare MLS run identity", () => {
  test("derives the Hong Kong date across the UTC boundary", () => {
    expect(hongKongDate("2026-08-20T17:59:59.999Z")).toBe("2026-08-21");
    expect(hongKongDate("2026-08-20T18:00:00.000Z")).toBe("2026-08-21");
    expect(hongKongDate("2026-08-21T16:00:00.000Z")).toBe("2026-08-22");
  });

  test("uses one deterministic scheduled identity per environment and HK date", () => {
    expect(scheduledAttemptId("production", "2026-08-21")).toBe(
      "scheduled:production:2026-08-21",
    );
  });

  test("requires an explicit reason and suffix for a manual attempt", () => {
    expect(() =>
      buildRunEnvelope({
        environment: "production",
        scheduledTime: "2026-08-20T18:00:00.000Z",
        kind: "manual",
        mode: "shadow",
        manualReason: "",
        manualSuffix: "retry-0001",
        commitSha: "a".repeat(40),
      }),
    ).toThrow(/manual reason/i);
  });

  test("keeps terminal states immutable", () => {
    expect(transitionRunState("pending", "running")).toBe("running");
    expect(transitionRunState("running", "unknown")).toBe("unknown");
    expect(() => transitionRunState("failed", "running")).toThrow(/terminal/i);
  });
});
```

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
bun test workers/mls-container/src/run-contract.test.ts
```

Expected: FAIL with `Cannot find module './run-contract'`.

- [ ] **Step 3: Implement the exact immutable run contract**

Create `workers/mls-container/src/run-contract.ts`:

```ts
const HK_OFFSET_MS = 8 * 60 * 60 * 1_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TERMINAL_STATES = new Set<RunState>(["succeeded", "failed", "unknown"]);
const ALLOWED_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  pending: ["running", "failed", "unknown"],
  running: ["succeeded", "failed", "unknown"],
  succeeded: [],
  failed: [],
  unknown: [],
};

export type RunMode = "shadow" | "publish";
export type RunState = "pending" | "running" | "succeeded" | "failed" | "unknown";

export interface RunEnvelope {
  environment: "preview" | "production";
  hkDate: string;
  attemptId: string;
  kind: "scheduled" | "manual";
  mode: RunMode;
  scheduledTime: string;
  manualReason: string | null;
  commitSha: string;
}

interface EnvelopeInput {
  environment: "preview" | "production";
  scheduledTime: number | string | Date;
  kind: "scheduled" | "manual";
  mode: RunMode;
  manualReason?: string | null;
  manualSuffix?: string | null;
  commitSha: string;
}

function requireDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError("scheduled time is invalid");
  return value;
}

export function hongKongDate(scheduledTime: number | string | Date): string {
  const date = requireDate(new Date(scheduledTime));
  return new Date(date.getTime() + HK_OFFSET_MS).toISOString().slice(0, 10);
}

export function scheduledAttemptId(environment: string, hkDate: string): string {
  if (!/^(preview|production)$/.test(environment) || !DATE_PATTERN.test(hkDate)) {
    throw new TypeError("scheduled attempt identity is invalid");
  }
  return `scheduled:${environment}:${hkDate}`;
}

export function buildRunEnvelope(input: unknown): Readonly<RunEnvelope> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("run envelope input is invalid");
  }
  const value = input as EnvelopeInput;
  const scheduled = requireDate(new Date(value.scheduledTime));
  const hkDate = hongKongDate(scheduled);
  if (!/^(preview|production)$/.test(value.environment)) {
    throw new TypeError("run environment is invalid");
  }
  if (!/^(shadow|publish)$/.test(value.mode)) throw new TypeError("run mode is invalid");
  if (!SHA_PATTERN.test(value.commitSha)) throw new TypeError("commit SHA is invalid");
  let attemptId = scheduledAttemptId(value.environment, hkDate);
  let manualReason: string | null = null;
  if (value.kind === "manual") {
    manualReason = typeof value.manualReason === "string" ? value.manualReason.trim() : "";
    if (manualReason.length < 8 || manualReason.length > 240) {
      throw new TypeError("manual reason is invalid");
    }
    if (!SAFE_SUFFIX_PATTERN.test(value.manualSuffix ?? "")) {
      throw new TypeError("manual suffix is invalid");
    }
    attemptId = `${attemptId}:manual:${value.manualSuffix}`;
  } else if (value.kind !== "scheduled") {
    throw new TypeError("run kind is invalid");
  }
  return Object.freeze({
    environment: value.environment,
    hkDate,
    attemptId,
    kind: value.kind,
    mode: value.mode,
    scheduledTime: scheduled.toISOString(),
    manualReason,
    commitSha: value.commitSha,
  });
}

export function transitionRunState(current: RunState, next: RunState): RunState {
  if (TERMINAL_STATES.has(current)) throw new TypeError("run state is terminal");
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new TypeError(`run transition ${current} -> ${next} is invalid`);
  }
  return next;
}
```

- [ ] **Step 4: Run the focused test and capture GREEN**

Run:

```powershell
bun test workers/mls-container/src/run-contract.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Add fail-first static config assertions**

Append to `workers/mls-container/src/run-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";

function config(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
}

test("base deploy is private, unscheduled, and single-container", () => {
  const value = config("wrangler.jsonc") as any;
  expect(value.workers_dev).toBe(false);
  expect(value.routes).toBeUndefined();
  expect(value.containers).toEqual([
    {
      class_name: "MlsRunContainer",
      image: "./Dockerfile",
      max_instances: 1,
      instance_type: "standard-1",
    },
  ]);
  expect(value.migrations[0].new_sqlite_classes).toEqual(["MlsRunContainer"]);
  expect(value.workflows[0].schedules).toBeUndefined();
});

test("scheduled config differs only by the approved daily Workflow schedule", () => {
  const base = config("wrangler.jsonc") as any;
  const scheduled = config("wrangler.scheduled.jsonc") as any;
  expect(scheduled.workflows[0].schedules).toEqual(["0 18 * * *"]);
  delete scheduled.workflows[0].schedules;
  expect(scheduled).toEqual(base);
  expect(JSON.stringify(base)).not.toMatch(
    /DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|MLS_R2_SECRET_ACCESS_KEY/,
  );
});
```

Run:

```powershell
bun test workers/mls-container/src/run-contract.test.ts
```

Expected: FAIL because the Wrangler configs do not exist.

- [ ] **Step 6: Add pinned dependencies and the two deployment configs**

Run exactly:

```powershell
npm.cmd install --save-exact @aws-sdk/client-s3@3.1115.0 @cloudflare/containers@0.3.7
npm.cmd install --save-dev --save-exact @cloudflare/workers-types@5.20260820.1 wrangler@4.125.0
```

Confirm `bun.lockb` did not change from its pre-task state. Add these scripts to `package.json`:

```json
{
  "scripts": {
    "test:mls:cloudflare": "bun test workers/mls-container/src/*.test.ts && node --test workers/mls-container/container/*.test.mjs src/lib/mls/r2-reporting.test.mjs scripts/mls/sync.test.mjs",
    "check:mls:cloudflare": "tsc --noEmit -p workers/mls-container/tsconfig.json && wrangler deploy --dry-run --config workers/mls-container/wrangler.jsonc"
  }
}
```

Create `workers/mls-container/wrangler.jsonc` as strict JSON:

```json
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "earnest-mls-container",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-21",
  "workers_dev": false,
  "preview_urls": false,
  "containers": [
    {
      "class_name": "MlsRunContainer",
      "image": "./Dockerfile",
      "max_instances": 1,
      "instance_type": "standard-1"
    }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "MLS_RUN_CONTAINER", "class_name": "MlsRunContainer" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MlsRunContainer"] }
  ],
  "workflows": [
    {
      "name": "earnest-mls-runner",
      "binding": "MLS_RUN_WORKFLOW",
      "class_name": "MlsRunWorkflow"
    }
  ],
  "vars": {
    "MLS_ENVIRONMENT": "production",
    "MLS_SCHEDULED_MODE": "shadow",
    "MLS_PUBLISH_ENABLED": "false",
    "MLS_MEDIA_RIGHTS_CONFIRMED": "false",
    "MLS_EVIDENCE_RETENTION_DAYS": "90"
  }
}
```

Create `workers/mls-container/wrangler.scheduled.jsonc` with exactly the same content, adding only:

```json
"schedules": ["0 18 * * *"]
```

inside the single Workflow object.

Create `workers/mls-container/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "bun"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Add to `.gitignore`:

```gitignore
workers/mls-container/.dev.vars
workers/mls-container/.wrangler/
```

- [ ] **Step 7: Verify Task 1 and commit**

Run:

```powershell
bun test workers/mls-container/src/run-contract.test.ts
npm.cmd exec tsc -- --noEmit -p workers/mls-container/tsconfig.json
npm.cmd exec prettier -- --check workers/mls-container/src/run-contract.ts workers/mls-container/src/run-contract.test.ts workers/mls-container/wrangler.jsonc workers/mls-container/wrangler.scheduled.jsonc workers/mls-container/tsconfig.json package.json
git diff --check -- package.json package-lock.json .gitignore workers/mls-container
```

Expected: all pass. Then stage only Task 1 paths and commit:

```powershell
git add package.json package-lock.json .gitignore workers/mls-container/src/run-contract.ts workers/mls-container/src/run-contract.test.ts workers/mls-container/wrangler.jsonc workers/mls-container/wrangler.scheduled.jsonc workers/mls-container/tsconfig.json
git commit -m "feat: scaffold Cloudflare MLS runner"
```

---

## Task 2: Extract Artifact Serialization and Add Immutable R2 Reporting

**Files:**

- Modify: `src/lib/mls/reporting.mjs`
- Modify: `src/lib/mls/reporting.test.mjs`
- Create: `src/lib/mls/r2-reporting.mjs`
- Create: `src/lib/mls/r2-reporting.test.mjs`

**Interfaces:**

```js
export function buildRunArtifactObjects(run)
// -> frozen [{ name, body, contentType, byteLength, sha256 }]

export function buildEvidencePrefix({ environment, hkDate, runId, attemptId })
// -> "mls-sync/<environment>/<HK-date>/<run-id>/<attempt-id>"

export function createR2S3ObjectStore({ accountId, bucket, accessKeyId, secretAccessKey })
// -> { putIfAbsent({ key, body, contentType, metadata }): Promise<void> }

export function createR2Reporter({ objectStore, context, now })
// -> { writeRunArtifacts(run): Promise<{ prefix, manifestKey, objects }> }
```

- [ ] **Step 1: Write RED tests for pure artifact parity**

Extend `src/lib/mls/reporting.test.mjs` to import `buildRunArtifactObjects` and add:

```js
test("artifact serialization is deterministic and independent of storage", () => {
  const objects = buildRunArtifactObjects(reportFixture());
  assert.deepEqual(
    objects.map(({ name, contentType }) => [name, contentType]),
    [
      ["report.json", "application/json; charset=utf-8"],
      ["listings.csv", "text/csv; charset=utf-8"],
      ["observations.csv", "text/csv; charset=utf-8"],
      ["diagnostics.json", "application/json; charset=utf-8"],
    ],
  );
  assert.ok(objects.every((object) => object.byteLength === Buffer.byteLength(object.body)));
  assert.ok(objects.every((object) => /^[0-9a-f]{64}$/.test(object.sha256)));
  assert.doesNotMatch(objects.map((object) => object.body).join("\n"), /secret-token|<html>/i);
});
```

Run:

```powershell
node --test src/lib/mls/reporting.test.mjs
```

Expected: FAIL because `buildRunArtifactObjects` is not exported.

- [ ] **Step 2: Extract one pure serializer and retain filesystem behavior**

In `src/lib/mls/reporting.mjs`, add `createHash` to the `node:crypto` import and implement:

```js
function artifactObject(name, body, contentType) {
  return Object.freeze({
    name,
    body,
    contentType,
    byteLength: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}

export function buildRunArtifactObjects(run) {
  if (!run || typeof run !== "object") throw new TypeError("run is required");
  const safeRun = jsonSafe({
    runId: run.runId,
    scheduledFor: run.scheduledFor ?? dateForRun(run),
    mode: run.mode,
    status: run.status,
    evaluation: run.evaluation,
    gate: run.gate,
    counts: run.counts,
    quarantines: run.quarantines,
    proposals: run.proposals,
    failureCode: run.failureCode,
    failureSummary: run.failureSummary,
  });
  const listings = `${[csvRow(LISTINGS_HEADER), ...proposalRows(run).map(csvRow)].join("\n")}\n`;
  const observations = `${[
    csvRow(OBSERVATIONS_HEADER),
    ...observationRows(run).map(csvRow),
  ].join("\n")}\n`;
  return Object.freeze([
    artifactObject("report.json", `${JSON.stringify(safeRun, null, 2)}\n`, "application/json; charset=utf-8"),
    artifactObject("listings.csv", listings, "text/csv; charset=utf-8"),
    artifactObject("observations.csv", observations, "text/csv; charset=utf-8"),
    artifactObject(
      "diagnostics.json",
      `${JSON.stringify(jsonSafe(diagnosticsFor(run)), null, 2)}\n`,
      "application/json; charset=utf-8",
    ),
  ]);
}
```

Replace the four independently constructed values in `writeRunArtifacts` with a loop over `buildRunArtifactObjects(run)`, preserving the exact returned filesystem shape:

```js
const written = new Map(
  await Promise.all(
    buildRunArtifactObjects(run).map(async (artifact) => [
      artifact.name,
      await atomicWrite(runDirectory, artifact.name, artifact.body),
    ]),
  ),
);
return {
  directory: runDirectory,
  json: written.get("report.json"),
  listingsCsv: written.get("listings.csv"),
  observationsCsv: written.get("observations.csv"),
  diagnostics: written.get("diagnostics.json"),
};
```

Run:

```powershell
node --test src/lib/mls/reporting.test.mjs
```

Expected: PASS with the existing filesystem/symlink/pruning cases plus the new serialization case.

- [ ] **Step 3: Write RED tests for prefix safety, immutable writes, and manifest-last ordering**

Create `src/lib/mls/r2-reporting.test.mjs` with a small in-memory `putIfAbsent` fake and these assertions:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEvidencePrefix, createR2Reporter } from "./r2-reporting.mjs";

const context = Object.freeze({
  environment: "production",
  hkDate: "2026-08-21",
  attemptId: "scheduled:production:2026-08-21",
  mode: "shadow",
  commitSha: "a".repeat(40),
  containerDeploymentId: "deployment-1",
  workflowInstanceId: "workflow-1",
  containerId: "scheduled:production:2026-08-21",
});

test("builds one safe evidence prefix", () => {
  assert.equal(
    buildEvidencePrefix({ ...context, runId: "00000000-0000-4000-8000-000000000001" }),
    "mls-sync/production/2026-08-21/00000000-0000-4000-8000-000000000001/scheduled-production-2026-08-21",
  );
  assert.throws(() => buildEvidencePrefix({ ...context, runId: "../escape" }), /runId/i);
});

test("writes four immutable artifacts and the final manifest last", async () => {
  const writes = [];
  const objectStore = {
    async putIfAbsent(object) {
      writes.push(object);
    },
  };
  const reporter = createR2Reporter({
    objectStore,
    context,
    now: () => new Date("2026-08-21T02:30:00.000Z"),
  });
  const result = await reporter.writeRunArtifacts({
    runId: "00000000-0000-4000-8000-000000000001",
    scheduledFor: "2026-08-21",
    mode: "shadow",
    status: "shadow_healthy",
    counts: {},
    proposals: [],
    observations: [],
    quarantines: [],
    diagnostics: [],
  });
  assert.equal(writes.length, 5);
  assert.match(writes.at(-1).key, /manifest\.json$/);
  assert.ok(writes.every((write) => write.ifNoneMatch === "*"));
  assert.equal(result.manifestKey, writes.at(-1).key);
  const manifest = JSON.parse(writes.at(-1).body);
  assert.equal(manifest.artifacts.length, 4);
  assert.ok(manifest.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.sha256)));
});
```

Run:

```powershell
node --test src/lib/mls/r2-reporting.test.mjs
```

Expected: FAIL because `r2-reporting.mjs` does not exist.

- [ ] **Step 4: Implement the R2 reporter and S3 adapter**

Create `src/lib/mls/r2-reporting.mjs` with these exact boundaries:

```js
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { buildRunArtifactObjects } from "./reporting.mjs";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function segment(value, label) {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value) || value.includes("..")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.replaceAll(":", "-");
}

export function buildEvidencePrefix({ environment, hkDate, runId, attemptId }) {
  if (!/^(preview|production)$/.test(environment)) throw new TypeError("environment is invalid");
  if (!DATE_PATTERN.test(hkDate)) throw new TypeError("HK date is invalid");
  return [
    "mls-sync",
    environment,
    hkDate,
    segment(runId, "runId"),
    segment(attemptId, "attemptId"),
  ].join("/");
}

export function createR2S3ObjectStore({ accountId, bucket, accessKeyId, secretAccessKey }) {
  for (const [name, value] of Object.entries({ accountId, bucket, accessKeyId, secretAccessKey })) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} is required`);
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return Object.freeze({
    async putIfAbsent({ key, body, contentType, metadata }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          Metadata: metadata,
          IfNoneMatch: "*",
        }),
      );
    },
  });
}

export function createR2Reporter({ objectStore, context, now = () => new Date() }) {
  if (!objectStore || typeof objectStore.putIfAbsent !== "function") {
    throw new TypeError("R2 object store is required");
  }
  if (!SHA_PATTERN.test(context.commitSha)) throw new TypeError("commit SHA is invalid");
  return Object.freeze({
    async writeRunArtifacts(run) {
      const prefix = buildEvidencePrefix({ ...context, runId: run.runId });
      const artifacts = buildRunArtifactObjects(run);
      for (const artifact of artifacts) {
        await objectStore.putIfAbsent({
          key: `${prefix}/${artifact.name}`,
          body: artifact.body,
          contentType: artifact.contentType,
          ifNoneMatch: "*",
          metadata: { sha256: artifact.sha256 },
        });
      }
      const completedAt = now().toISOString();
      const manifest = {
        schemaVersion: 1,
        ...context,
        runId: run.runId,
        status: run.status,
        completedAt,
        artifacts: artifacts.map(({ name, byteLength, contentType, sha256 }) => ({
          name,
          byteLength,
          contentType,
          sha256,
        })),
      };
      const body = `${JSON.stringify(manifest, null, 2)}\n`;
      const manifestKey = `${prefix}/manifest.json`;
      await objectStore.putIfAbsent({
        key: manifestKey,
        body,
        contentType: "application/json; charset=utf-8",
        ifNoneMatch: "*",
        metadata: { completion: "terminal" },
      });
      return Object.freeze({
        prefix,
        manifestKey,
        objects: Object.freeze([...artifacts.map(({ name }) => `${prefix}/${name}`), manifestKey]),
      });
    },
  });
}
```

Add two more tests before GREEN:

- A second write to the same in-memory key throws a simulated `412 PreconditionFailed` and the reporter does not rewrite the manifest.
- A failure on artifact three means no `manifest.json` call occurs.

- [ ] **Step 5: Verify Task 2 and commit**

Run:

```powershell
node --test src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.test.mjs
npm.cmd exec prettier -- --check src/lib/mls/reporting.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.mjs src/lib/mls/r2-reporting.test.mjs
npm.cmd exec eslint -- src/lib/mls/reporting.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.mjs src/lib/mls/r2-reporting.test.mjs
git diff --check -- src/lib/mls/reporting.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.mjs src/lib/mls/r2-reporting.test.mjs
```

Expected: all pass. Commit only these four paths:

```powershell
git add src/lib/mls/reporting.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.mjs src/lib/mls/r2-reporting.test.mjs
git commit -m "feat: write MLS evidence to R2"
```

---
## Task 3: Make the MLS CLI Select Filesystem or R2 Evidence Explicitly

**Files:**

- Modify: `scripts/mls/sync.mjs`
- Create: `scripts/mls/sync.test.mjs`
- Modify: `.env.example`

**Interfaces:**

```js
export function readConfiguration(mode, environment = process.env)
export function createEvidenceReporter({ configuration, dependencies })
```

The configuration adds `evidenceBackend`, `scheduledFor`, `environment`, `attemptId`, `commitSha`, `containerDeploymentId`, `workflowInstanceId`, `containerId`, and the selected filesystem/R2 evidence values.

- [ ] **Step 1: Write RED configuration and reporter-selection tests**

Create `scripts/mls/sync.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MlsConfigurationError,
  createEvidenceReporter,
  readConfiguration,
} from "./sync.mjs";

function environment(overrides = {}) {
  return {
    DATABASE_URL_UNPOOLED: "postgresql://user:password@db.example.test/database",
    MLS_CRAWLER_CONTACT_URL: "https://earnestproperty.com/contact",
    MLS_MEDIA_ALLOWED_HOSTS: "images.example.test",
    MLS_MEDIA_RIGHTS_CONFIRMED: "false",
    MLS_PUBLISH_ENABLED: "false",
    MLS_EVIDENCE_BACKEND: "r2",
    MLS_ENVIRONMENT: "production",
    MLS_SCHEDULED_FOR: "2026-08-21",
    MLS_ATTEMPT_ID: "scheduled:production:2026-08-21",
    MLS_COMMIT_SHA: "a".repeat(40),
    CLOUDFLARE_DEPLOYMENT_ID: "deployment-1",
    MLS_WORKFLOW_INSTANCE_ID: "workflow-1",
    MLS_CONTAINER_ID: "scheduled:production:2026-08-21",
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    MLS_EVIDENCE_BUCKET: "earnest-mls-evidence",
    MLS_R2_ACCESS_KEY_ID: "r2-access-key",
    MLS_R2_SECRET_ACCESS_KEY: "r2-secret-key",
    ...overrides,
  };
}

test("reads an exact container-supplied run identity", () => {
  const configuration = readConfiguration("shadow", environment());
  assert.equal(configuration.evidenceBackend, "r2");
  assert.equal(configuration.scheduledFor, "2026-08-21");
  assert.equal(configuration.attemptId, "scheduled:production:2026-08-21");
  assert.equal(configuration.publishEnabled, false);
});

test("fails before work when required R2 credentials are missing", () => {
  assert.throws(
    () => readConfiguration("shadow", environment({ MLS_R2_SECRET_ACCESS_KEY: "" })),
    (error) =>
      error instanceof MlsConfigurationError &&
      /MLS_R2_SECRET_ACCESS_KEY/.test(error.message) &&
      !error.message.includes("r2-secret-key"),
  );
});

test("filesystem mode neither constructs R2 nor prunes outside its root", async () => {
  const calls = [];
  const selection = createEvidenceReporter({
    configuration: readConfiguration(
      "shadow",
      environment({ MLS_EVIDENCE_BACKEND: "filesystem", MLS_ARTIFACT_DIR: "C:/safe/mls" }),
    ),
    dependencies: {
      createFilesystemReporter: ({ root }) => ({ root, writeRunArtifacts: async () => ({}) }),
      createR2S3ObjectStore: () => {
        throw new Error("R2 must not be constructed");
      },
      createR2Reporter: () => {
        throw new Error("R2 must not be constructed");
      },
      pruneArtifacts: async (input) => calls.push(input),
    },
  });
  await selection.finalize();
  assert.deepEqual(calls, [{ root: "C:/safe/mls", retentionDays: 90 }]);
});
```

Run:

```powershell
node --test scripts/mls/sync.test.mjs
```

Expected: FAIL because `readConfiguration` does not accept an environment argument and `createEvidenceReporter` is missing.

- [ ] **Step 2: Refactor configuration reads without weakening existing gates**

Change `requiredEnvironment(name)` to `requiredEnvironment(environment, name)` and `readConfiguration(mode)` to `readConfiguration(mode, environment = process.env)`. Keep the current database/contact/host/publish/rights/Blob validations semantically unchanged, then add:

```js
const evidenceBackend = environment.MLS_EVIDENCE_BACKEND ?? "filesystem";
if (!/^(filesystem|r2)$/.test(evidenceBackend)) {
  throw new MlsConfigurationError("MLS_EVIDENCE_BACKEND must be filesystem or r2");
}
const scheduledFor = environment.MLS_SCHEDULED_FOR ?? scheduledForHongKong();
if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) {
  throw new MlsConfigurationError("MLS_SCHEDULED_FOR must be YYYY-MM-DD");
}
const evidence =
  evidenceBackend === "r2"
    ? Object.freeze({
        accountId: requiredEnvironment(environment, "CLOUDFLARE_ACCOUNT_ID"),
        bucket: requiredEnvironment(environment, "MLS_EVIDENCE_BUCKET"),
        accessKeyId: requiredEnvironment(environment, "MLS_R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnvironment(environment, "MLS_R2_SECRET_ACCESS_KEY"),
      })
    : Object.freeze({
        artifactRoot: requiredEnvironment(environment, "MLS_ARTIFACT_DIR"),
      });
```

Return the selected evidence values plus the exact metadata named in `Interfaces`. Preserve local filesystem compatibility only when `MLS_EVIDENCE_BACKEND` is absent by using explicit `local`, `manual-local`, and a forty-zero local sentinel; never synthesize production metadata.

- [ ] **Step 3: Implement the reporter selector and wire it into `main`**

Add imports for the R2 functions and implement:

```js
export function createEvidenceReporter({ configuration, dependencies }) {
  if (configuration.evidenceBackend === "filesystem") {
    const reporter = dependencies.createFilesystemReporter({
      root: configuration.evidence.artifactRoot,
    });
    return Object.freeze({
      reporter,
      async finalize() {
        await dependencies.pruneArtifacts({
          root: configuration.evidence.artifactRoot,
          retentionDays: 90,
        });
      },
    });
  }
  const objectStore = dependencies.createR2S3ObjectStore(configuration.evidence);
  const reporter = dependencies.createR2Reporter({
    objectStore,
    context: {
      environment: configuration.environment,
      hkDate: configuration.scheduledFor,
      attemptId: configuration.attemptId,
      mode: configuration.mode,
      commitSha: configuration.commitSha,
      containerDeploymentId: configuration.containerDeploymentId,
      workflowInstanceId: configuration.workflowInstanceId,
      containerId: configuration.containerId,
    },
  });
  return Object.freeze({ reporter, async finalize() {} });
}
```

Construct this selector before external work, pass its reporter to `runDualSourceSync`, use `configuration.scheduledFor` for the persisted run, capture returned object keys without bodies, and call `finalize()` in both success and existing cleanup paths.

- [ ] **Step 4: Add adversarial tests and reach GREEN**

Add cases proving publish requires both literal flags and the Blob token, shadow never requires/exposes the Blob token, R2 never calls `pruneArtifacts`, malformed metadata fails before reporter construction, and error messages reveal variable names but no supplied credentials.

Run:

```powershell
node --test scripts/mls/sync.test.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Document variables, verify, and commit**

Add empty/false declarations for all Task 3 variables to `.env.example`; never add real values. Run:

```powershell
node --check scripts/mls/sync.mjs
node --check scripts/mls/sync.test.mjs
node --test scripts/mls/sync.test.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.test.mjs
npm.cmd exec prettier -- --check scripts/mls/sync.mjs scripts/mls/sync.test.mjs .env.example
npm.cmd exec eslint -- scripts/mls/sync.mjs scripts/mls/sync.test.mjs
git diff --check -- scripts/mls/sync.mjs scripts/mls/sync.test.mjs .env.example
```

Expected: all pass. Commit only:

```powershell
git add scripts/mls/sync.mjs scripts/mls/sync.test.mjs .env.example
git commit -m "feat: select MLS evidence backend"
```

---

## Task 4: Build the One-Shot Node Supervisor and Container Image

**Files:**

- Create: `workers/mls-container/container/server.mjs`
- Create: `workers/mls-container/container/server.test.mjs`
- Create: `workers/mls-container/Dockerfile`
- Create: `workers/mls-container/Dockerfile.dockerignore`

**Interfaces:**

```js
export function createSupervisor({ spawnChild, now, setTimer, clearTimer, heartbeatMs, timeoutMs })
export function createSupervisorServer({ supervisor, token, port, host })
```

- [ ] **Step 1: Write RED single-start and child-argument tests**

Create a fake `EventEmitter` child and assert that two identical starts spawn once, a different second attempt throws, arguments are exactly `scripts/mls/sync.mjs --mode=shadow`, run metadata enters the child environment, and `MLS_SUPERVISOR_TOKEN` does not. Run:

```powershell
node --test workers/mls-container/container/server.test.mjs
```

Expected: FAIL because `server.mjs` does not exist.

- [ ] **Step 2: Implement the supervisor state machine**

The state has only `envelope`, `state`, start/heartbeat/completion timestamps, exit code, fixed failure code, child, and timers. Use this exact public projection:

```js
function publicStatus(state) {
  return Object.freeze({
    attemptId: state.envelope?.attemptId ?? null,
    state: state.state,
    startedAt: state.startedAt,
    heartbeatAt: state.heartbeatAt,
    completedAt: state.completedAt,
    exitCode: state.exitCode,
    failureCode: state.failureCode,
  });
}
```

`start` validates a 32–160 character URL-safe token, snapshots the envelope, spawns `process.execPath`, updates heartbeat every 30 seconds, sends `SIGTERM` at four hours, and makes terminal state immutable. Child exit `0` is `succeeded`; every nonzero exit is `failed` with an allowlisted code.

`createSupervisorServer` must return `200` for `/health`, accept at most 32 KiB JSON at authenticated `POST /run`, return allowlisted status at `GET /status`, and return `404` otherwise. Compare bearer tokens via SHA-256 digests and `timingSafeEqual`. On `SIGTERM`/`SIGINT`, forward once, close the server, and avoid synchronous `process.exit()`.

- [ ] **Step 3: Add timeout, signal, auth, and redaction tests**

Prove four-hour termination, platform signal forwarding, wrong-token rejection, no second spawn, and no database/Blob/R2 secrets in status. Run the focused suite until green.

- [ ] **Step 4: Add the reproducible image and native-media proof**

Create `workers/mls-container/Dockerfile`:

```dockerfile
FROM --platform=linux/amd64 node:22.23.2-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force
COPY scripts ./scripts
COPY src ./src
COPY workers/mls-container/container ./workers/mls-container/container
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "workers/mls-container/container/server.mjs"]
```

Create `workers/mls-container/Dockerfile.dockerignore` excluding Git, `.env*` except `.env.example`, `node_modules`, build outputs, `.wrangler`, docs, ops, and `workers/cron`. Run:

```powershell
docker build --platform linux/amd64 --file workers/mls-container/Dockerfile --tag earnest-mls-container:local .
docker run --rm --entrypoint node earnest-mls-container:local -e "import('sharp').then(async ({default:s})=>{const b=await s({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toBuffer();if(b.length<1)process.exit(1)})"
```

Expected: image and native `sharp` pass. Missing Docker is an external gate, not permission to change the media path.

- [ ] **Step 5: Verify and commit**

```powershell
node --check workers/mls-container/container/server.mjs
node --check workers/mls-container/container/server.test.mjs
node --test workers/mls-container/container/server.test.mjs
npm.cmd exec prettier -- --check workers/mls-container/container/server.mjs workers/mls-container/container/server.test.mjs
npm.cmd exec eslint -- workers/mls-container/container/server.mjs workers/mls-container/container/server.test.mjs
git diff --check -- workers/mls-container/container workers/mls-container/container/server.test.mjs
git add workers/mls-container/container/server.mjs workers/mls-container/container/server.test.mjs workers/mls-container/Dockerfile workers/mls-container/Dockerfile.dockerignore
git commit -m "feat: supervise one-shot MLS containers"
```

---

## Task 5: Implement the Idempotent Container Durable Object

**Files:**

- Create: `workers/mls-container/src/container.ts`
- Create: `workers/mls-container/src/container.test.ts`

**Interfaces:**

```ts
export interface AttemptRecord {
  envelope: RunEnvelope;
  state: RunState;
  workflowInstanceId: string;
  containerDeploymentId: string | null;
  containerId: string;
  neonRunId: string | null;
  evidencePrefix: string | null;
  manifestPresent: boolean;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  failureCode: string | null;
}

export class MlsRunContainer extends Container<Env> {
  claimAndStart(input: ClaimAndStartInput): Promise<AttemptRecord>;
  readAttempt(attemptId: string): Promise<AttemptRecord>;
}
```

- [ ] **Step 1: Write RED pure-coordinator tests**

Test an exported `createAttemptCoordinator` with fake store/container ports. Assert a duplicate scheduled claim returns the same record and calls `start` once; serialized stored state must not contain the database URL, Blob token, R2 secret, or control token. Run:

```powershell
bun test workers/mls-container/src/container.test.ts
```

Expected: FAIL because `container.ts` does not exist.

- [ ] **Step 2: Implement the pure fail-closed coordinator**

Use these ports:

```ts
interface AttemptStore {
  get(key: string): Promise<AttemptRecord | undefined>;
  put(key: string, value: AttemptRecord): Promise<void>;
}

interface ContainerPort {
  start(input: { envelope: RunEnvelope; token: string; envVars: Record<string, string> }): Promise<void>;
  status(): Promise<SupervisorStatus>;
  stop(): Promise<void>;
}
```

Persist under `attempt:<attemptId>`. Read before start, persist `pending` before the RPC, return an identical existing claim, reject envelope mismatch, classify definite rejection `failed/container_start_failed`, classify ambiguous response `unknown/container_start_outcome_unknown`, never restart terminal attempts, merge only allowlisted supervisor fields, and persist terminal state before stopping the Container.

- [ ] **Step 3: Add adversarial RED/GREEN cases**

Cover definite/ambiguous start failures, terminal immutability, caller mutation, accessor/extra/malformed supervisor values, mismatched IDs, and persistence-before-stop ordering. Run until all pass.

- [ ] **Step 4: Add the Cloudflare class wrapper**

Use `Container` with `defaultPort = 8080`, `requiredPorts = [8080]`, and `sleepAfter = "5h"`. `claimAndStart` generates a per-attempt token, passes it only in `startAndWaitForPorts({ startOptions: { envVars, enableInternet: true } })` and the authenticated `/run` request, then discards it. `startEnvironment` allowlists the Task 3 variables and never spreads `this.env`.

The actual start is:

```ts
await this.startAndWaitForPorts({
  ports: [8080],
  startOptions: { envVars, enableInternet: true },
  cancellationOptions: { portReadyTimeoutMS: 60_000 },
});
const response = await this.containerFetch("http://localhost/run", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(envelope),
});
if (response.status !== 202) throw new Error("container supervisor rejected the attempt");
```

Status fetches only when `this.ctx.container.running` is true. `onStop` turns a still-running record into `unknown`; `onError` stores fixed `container_runtime_error` without raw error text.

- [ ] **Step 5: Verify and commit**

```powershell
bun test workers/mls-container/src/container.test.ts
npm.cmd exec tsc -- --noEmit -p workers/mls-container/tsconfig.json
npm.cmd exec prettier -- --check workers/mls-container/src/container.ts workers/mls-container/src/container.test.ts
npm.cmd exec eslint -- workers/mls-container/src/container.ts workers/mls-container/src/container.test.ts
git diff --check -- workers/mls-container/src/container.ts workers/mls-container/src/container.test.ts
git add workers/mls-container/src/container.ts workers/mls-container/src/container.test.ts
git commit -m "feat: coordinate Cloudflare MLS containers"
```

---
## Task 6: Implement the Directly Scheduled Workflow

**Files:**

- Create: `workers/mls-container/src/workflow.ts`
- Create: `workers/mls-container/src/workflow.test.ts`
- Create: `workers/mls-container/src/index.ts`
- Modify: `workers/mls-container/src/container.ts`
- Modify: `workers/mls-container/src/container.test.ts`

**Interfaces:**

```ts
export interface ManualRunParams {
  kind: "manual";
  mode: "shadow" | "publish";
  reason: string;
  suffix: string;
  scheduledTime: string;
}

export interface WorkflowPorts {
  containerFor(attemptId: string): {
    claimAndStart(input: ClaimAndStartInput): Promise<AttemptRecord>;
    readAttempt(attemptId: string): Promise<AttemptRecord>;
    markUnknown(attemptId: string, failureCode: string): Promise<AttemptRecord>;
  };
}

export function runMlsWorkflow(input: {
  event: WorkflowEvent<ManualRunParams | Record<string, never>>;
  step: WorkflowStep;
  env: Env;
  ports: WorkflowPorts;
}): Promise<AttemptRecord>;
```

- [ ] **Step 1: Write RED scheduled/manual/duplicate tests**

Create `workers/mls-container/src/workflow.test.ts`:

```ts
import { expect, test } from "bun:test";

import { runMlsWorkflow } from "./workflow";

function stepFake() {
  return {
    async do(_name: string, configOrCallback: unknown, maybeCallback?: unknown) {
      const callback = typeof configOrCallback === "function" ? configOrCallback : maybeCallback;
      return (callback as () => Promise<unknown>)();
    },
    async sleep() {},
  };
}

test("derives one scheduled attempt from Cloudflare scheduledTime", async () => {
  const starts = [];
  const terminal = Object.freeze({
    envelope: { attemptId: "scheduled:production:2026-08-21" },
    state: "succeeded",
  });
  const result = await runMlsWorkflow({
    event: {
      instanceId: "workflow-1",
      workflowName: "earnest-mls-runner",
      timestamp: new Date("2026-08-20T18:00:00.000Z"),
      payload: {},
      schedule: { cron: "0 18 * * *", scheduledTime: Date.parse("2026-08-20T18:00:00.000Z") },
    },
    step: stepFake() as any,
    env: {
      MLS_ENVIRONMENT: "production",
      MLS_SCHEDULED_MODE: "shadow",
      MLS_GIT_COMMIT_SHA: "a".repeat(40),
    } as any,
    ports: {
      containerFor(attemptId) {
        expect(attemptId).toBe("scheduled:production:2026-08-21");
        return {
          async claimAndStart(input) {
            starts.push(input);
            return terminal as any;
          },
          async readAttempt() {
            throw new Error("terminal claim must not be polled");
          },
          async markUnknown() {
            throw new Error("terminal claim must not be changed");
          },
        };
      },
    },
  });
  expect(result.state).toBe("succeeded");
  expect(starts).toHaveLength(1);
});
```

Add a manual case requiring `reason`, `suffix`, and explicit `scheduledTime`, plus a duplicate case where two Workflow invocations receive the same stored scheduled attempt and only the fake Durable Object's first claim records a start.

Run:

```powershell
bun test workers/mls-container/src/workflow.test.ts
```

Expected: FAIL because `workflow.ts` does not exist.

- [ ] **Step 2: Implement envelope selection and fail-closed secret/config preflight**

Implement `buildEnvelopeFromEvent(event, env)` using `buildRunEnvelope`:

- Scheduled events require cron exactly `0 18 * * *`, use `event.schedule.scheduledTime`, force `kind: "scheduled"`, and use `env.MLS_SCHEDULED_MODE`.
- Manual events require `payload.kind === "manual"`, an explicit mode/reason/suffix/scheduledTime, and are accepted only through Workflow invocation because the Worker has no run route.
- `assertRuntimeConfiguration(env, mode)` checks only presence/shape and uses fixed variable names in errors. It never returns or serializes secrets.
- `publish` additionally requires literal `MLS_PUBLISH_ENABLED === "true"` and `MLS_MEDIA_RIGHTS_CONFIRMED === "true"`; the CLI/repository repeat these checks.

The Workflow passes only the envelope and `event.instanceId` through durable step output. Secrets flow directly from `env` to `MlsRunContainer.claimAndStart` and never become a step result.

- [ ] **Step 3: Implement idempotent start plus bounded durable polling**

Use the stable attempt ID to obtain `getContainer(env.MLS_RUN_CONTAINER, attemptId)`. The Workflow algorithm is:

```ts
const envelope = buildEnvelopeFromEvent(event, env);
assertRuntimeConfiguration(env, envelope.mode);
const container = ports.containerFor(envelope.attemptId);
let record = await step.do("claim-and-start", async () =>
  container.claimAndStart({
    envelope,
    workflowInstanceId: event.instanceId,
  }),
);
if (isTerminal(record.state)) return record;
for (let index = 1; index <= 240; index += 1) {
  await step.sleep(`poll-wait-${index}`, "1 minute");
  record = await step.do(`poll-status-${index}`, async () =>
    container.readAttempt(envelope.attemptId),
  );
  if (isTerminal(record.state)) return record;
}
return step.do("mark-deadline-unknown", async () =>
  container.markUnknown(envelope.attemptId, "workflow_poll_deadline"),
);
```

Do not add a Workflow restart/rollback handler. A retry of `claim-and-start` is safe only because Task 5 returns the existing claim and never starts another child.

Add `markUnknown` to Task 5's class/pure coordinator. It can transition only `pending` or `running`, persists `unknown` before `stop`, and returns an existing terminal record unchanged.

- [ ] **Step 4: Add failure and replay tests**

Prove:

- A claim RPC invoked twice starts one child.
- A failed record returns without calling `readAttempt` or starting again.
- An unknown record is terminal and cannot be manually resumed with the same suffix.
- 240 nonterminal polls call `markUnknown` once.
- A status transport error is caught, classified through `markUnknown("workflow_status_unknown")`, and never causes a new `claimAndStart`.
- Manual publish is rejected while either flag is false.
- No serialized step result or fixed error contains any value from the five secret variables.

Run:

```powershell
bun test workers/mls-container/src/run-contract.test.ts workers/mls-container/src/container.test.ts workers/mls-container/src/workflow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Export only the classes and a private default Worker**

Create `workers/mls-container/src/index.ts`:

```ts
export { MlsRunContainer } from "./container";
export { MlsRunWorkflow } from "./workflow";

export default {
  async fetch(): Promise<Response> {
    return new Response("Not Found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  },
};
```

Add a test that calls `fetch` with `/run`, `/retry`, `/status`, and `/` and receives `404` for all. This is intentional: manual invocation uses `wrangler workflows trigger`, while the application status route remains in TanStack/Vercel.

- [ ] **Step 6: Verify Task 6 and commit**

```powershell
bun test workers/mls-container/src/run-contract.test.ts workers/mls-container/src/container.test.ts workers/mls-container/src/workflow.test.ts
npm.cmd exec tsc -- --noEmit -p workers/mls-container/tsconfig.json
npm.cmd exec wrangler -- deploy --dry-run --config workers/mls-container/wrangler.jsonc
npm.cmd exec prettier -- --check workers/mls-container/src
npm.cmd exec eslint -- workers/mls-container/src
git diff --check -- workers/mls-container/src
git add workers/mls-container/src/container.ts workers/mls-container/src/container.test.ts workers/mls-container/src/workflow.ts workers/mls-container/src/workflow.test.ts workers/mls-container/src/index.ts
git commit -m "feat: schedule one-shot MLS workflows"
```

Expected: all local/static/dry-run checks pass without an account deployment.

---

## Task 7: Cut the Status and Operations Contracts Over to Cloudflare

**Files:**

- Modify: `src/routes/api.mls-sync.ts`
- Modify: `src/routes/api.mls-sync.test.mjs`
- Modify: `src/lib/mls/ops-contract.test.mjs`
- Modify: `ops/systemd/earnest-mls-sync.service`
- Modify: `ops/systemd/earnest-mls-sync.timer`

**Interfaces:**

- `GET /api/mls-sync` remains authenticated and returns `{ ok: true, publisher: "cloudflare-container", latestRun }`.
- The route still exports no mutation verb.
- Systemd files become inert historical references with no executable MLS command or active calendar.

- [ ] **Step 1: Write RED route and cutover assertions**

In `src/routes/api.mls-sync.test.mjs`, add:

```js
test("protected status identifies the Cloudflare Container publisher", () => {
  assert.match(source, /publisher:\s*["']cloudflare-container["']/);
  assert.doesNotMatch(source, /publisher:\s*["']vps["']/);
  assert.doesNotMatch(source, /\bPOST\b|\bPUT\b|\bDELETE\b/);
});
```

Replace the systemd-active assertions in `src/lib/mls/ops-contract.test.mjs` with fail-first checks for:

```js
assert.match(service, /RETIRED.*Cloudflare/i);
assert.match(timer, /RETIRED.*Cloudflare/i);
assert.doesNotMatch(service, /^ExecStart=.*scripts\/mls\/sync\.mjs/m);
assert.doesNotMatch(timer, /^OnCalendar=/m);
assert.match(baseConfig, /"workers_dev"\s*:\s*false/);
assert.doesNotMatch(baseConfig, /"schedules"/);
assert.match(scheduledConfig, /"schedules"\s*:\s*\[\s*"0 18 \* \* \*"\s*\]/);
assert.doesNotMatch(baseConfig + scheduledConfig, /DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|MLS_R2_SECRET_ACCESS_KEY/);
```

Also snapshot the current contents of `workers/cron/README.md`, `workers/cron/wrangler.jsonc`, and `workers/cron/src/index.ts` in the test and assert they contain no `MlsRunWorkflow`, `MlsRunContainer`, or `MLS_RUN_` tokens.

Run:

```powershell
node --test src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs
```

Expected: FAIL on the VPS publisher and active systemd contracts.

- [ ] **Step 2: Change only the publisher marker**

In `src/routes/api.mls-sync.ts`, replace exactly:

```ts
publisher: "vps"
```

with:

```ts
publisher: "cloudflare-container"
```

Do not add Workflow, R2, or Cloudflare API reads to the request path. Neon `latestRun` remains authoritative.

- [ ] **Step 3: Make both systemd units inert**

Replace `ops/systemd/earnest-mls-sync.service` with a historical marker that contains no `ExecStart` and cannot be manually started:

```ini
[Unit]
Description=RETIRED - Earnest MLS execution moved to Cloudflare Workflow and Container
Documentation=../../docs/mls-production-activation.md
RefuseManualStart=yes

[Service]
Type=oneshot
RemainAfterExit=no
```

Replace `ops/systemd/earnest-mls-sync.timer` with:

```ini
[Unit]
Description=RETIRED - Earnest MLS schedule moved to Cloudflare Workflow
Documentation=../../docs/mls-production-activation.md
RefuseManualStart=yes

[Timer]
Persistent=false
```

There is deliberately no `OnCalendar`, `Unit`, or `[Install] WantedBy`. Do not delete these files until Cloudflare production proof is accepted.

- [ ] **Step 4: Verify Task 7 and commit**

```powershell
node --test src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs
npm.cmd exec tsc -- --noEmit
npm.cmd exec prettier -- --check src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs
npm.cmd exec eslint -- src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs
git diff --check -- src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs ops/systemd/earnest-mls-sync.service ops/systemd/earnest-mls-sync.timer
git diff --exit-code -- workers/cron
git add src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs ops/systemd/earnest-mls-sync.service ops/systemd/earnest-mls-sync.timer
git commit -m "ops: retire VPS MLS scheduling"
```

Expected: all pass and `workers/cron` has no diff.

---

## Task 8: Replace the Activation Runbook and Document the Dedicated Project

**Files:**

- Create: `workers/mls-container/README.md`
- Replace: `docs/mls-production-activation.md`
- Modify: `docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md`
- Modify: `src/lib/mls/ops-contract.test.mjs`

**Interfaces:**

The runbook is the operator contract. It separates local verification, Cloudflare account/resource creation, secret placement, unscheduled deploy, manual shadow, seven-date approval, manual first publish, scheduled activation, and rollback. Every provider mutation remains a separately approved command block.

- [ ] **Step 1: Write RED runbook assertions**

Add exact static checks to `src/lib/mls/ops-contract.test.mjs` for these markers:

```js
for (const marker of [
  "Workers Paid",
  "wrangler.jsonc",
  "wrangler.scheduled.jsonc",
  "0 18 * * *",
  "MLS_SCHEDULED_MODE=shadow",
  "MLS_PUBLISH_ENABLED=false",
  "MLS_MEDIA_RIGHTS_CONFIRMED=false",
  "90-day bucket lock",
  "manual first publish",
  "seven approved healthy Hong Kong dates",
  "publication_outcome_unknown",
  "publisher: cloudflare-container",
  "No provider command in this runbook is authorized by code approval",
]) {
  assert.match(runbook, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), marker);
}
assert.doesNotMatch(runbook, /systemctl enable|systemctl start|place.*VPS/i);
```

Run:

```powershell
node --test src/lib/mls/ops-contract.test.mjs
```

Expected: FAIL because the current runbook still activates VPS/systemd.

- [ ] **Step 2: Write the project README**

`workers/mls-container/README.md` must include:

- The Workflow → Container DO → supervisor → existing CLI diagram.
- Base vs scheduled config purpose.
- All secret names and non-secret variable names, with no values.
- Local commands: focused tests, TypeScript, Wrangler dry-run, Docker build, native `sharp` probe.
- Manual local Workflow command:

```powershell
npm.cmd exec wrangler -- dev --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows trigger earnest-mls-runner '{"kind":"manual","mode":"shadow","reason":"local fixture verification","suffix":"local-0001","scheduledTime":"2026-08-20T18:00:00.000Z"}' --local --config workers/mls-container/wrangler.jsonc
```

- A warning that the Worker returns `404` for all HTTP routes and must not gain a run endpoint.
- Evidence key/manifest schema and no-delete rule.
- The explicit statement that Cloudflare control-plane retries cannot spawn a second integrated command.

- [ ] **Step 3: Replace the activation runbook with gated commands**

Write `docs/mls-production-activation.md` in this exact phase order:

1. **Authority matrix:** code merge, migration, Workers Paid, bucket/token creation, secret placement, live source access, Vercel Blob upload, unscheduled Cloudflare deploy, schedule enablement, and publication are separate approvals.
2. **Preflight:** verify the intended account/profile and available products with `npm.cmd exec wrangler -- whoami`, `workflows list`, and `containers list`; verify Docker locally. Stop on account ambiguity or unavailable Containers/Workflows.
3. **R2 evidence:** after separate approval, create a private bucket; add a 90-day bucket lock and `mls-sync/` 90-day lifecycle; list both rules and record their IDs. The credential is bucket-scoped Object Read & Write. Application code has no delete operation.
4. **Secrets:** use `wrangler secret put` interactively for each secret name; do not use command-line values, shell history, build args, `.env`, or Vercel-to-Cloudflare copy scripts.
5. **Unscheduled deployment:** deploy only `workers/mls-container/wrangler.jsonc`; verify `workers_dev=false`, no routes, no schedules, Container image, and Workflow registration.
6. **Manual production shadow:** use:

```powershell
npm.cmd exec wrangler -- workflows trigger earnest-mls-runner '{"kind":"manual","mode":"shadow","reason":"first production shadow after Cloudflare cutover","suffix":"shadow-0001","scheduledTime":"<approved UTC timestamp>"}' --config workers/mls-container/wrangler.jsonc
```

The timestamp is operator-supplied at execution time and must correspond to the intended Hong Kong evidence date. Record Workflow ID, attempt ID, Container deployment, Neon run UUID, R2 prefix, and manifest hash.

7. **Daily shadow:** only after manual proof, deploy `wrangler.scheduled.jsonc`. Verify Workflow description reports only `0 18 * * *`. Collect seven separately approved healthy HK dates.
8. **Manual first publish:** after media-rights authorization and a separate flag change, trigger one manual `publish`. Verify exact canonical/source-link/field/lifecycle/event/Blob/R2 evidence.
9. **Scheduled publish:** only after first-publish approval, update reviewed non-secret flags/mode, redeploy the scheduled config, and monitor seven scheduled dates.
10. **Rollback:** deploy the unscheduled config, set publish false/shadow, terminate a running Workflow only after reconciling Neon/Container state, preserve R2/Neon/Blob, and never re-enable systemd while Cloudflare may still run.

Include read-only inspection commands:

```powershell
npm.cmd exec wrangler -- workflows describe earnest-mls-runner --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows instances list earnest-mls-runner --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- workflows instances describe earnest-mls-runner latest --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- containers list --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- r2 bucket lock list <approved-bucket-name>
npm.cmd exec wrangler -- r2 bucket lifecycle list <approved-bucket-name>
```

Angle-bracket operands are execution-time operator inputs, not unresolved implementation gaps; the runbook must say they are resolved and recorded before the command runs.

- [ ] **Step 4: Mark the old design's operations section as superseded**

At the top of `docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md`, add a concise note linking `2026-08-21-cloudflare-mls-container-design.md` and stating that only VPS/systemd hosting/scheduling is superseded. Do not rewrite the source, matching, reconciliation, media, or publication contract.

- [ ] **Step 5: Verify and commit documentation**

```powershell
node --test src/lib/mls/ops-contract.test.mjs src/routes/api.mls-sync.test.mjs
npm.cmd exec prettier -- --check workers/mls-container/README.md docs/mls-production-activation.md docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md src/lib/mls/ops-contract.test.mjs
git diff --check -- workers/mls-container/README.md docs/mls-production-activation.md docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md src/lib/mls/ops-contract.test.mjs
git add workers/mls-container/README.md docs/mls-production-activation.md docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md src/lib/mls/ops-contract.test.mjs
git commit -m "docs: activate Cloudflare MLS operations"
```

Expected: all pass; no provider command has run.

---

## Task 9: Run the Complete Offline Acceptance Matrix and Request Review

**Files:**

- Modify only if a deterministic test exposes a defect in a Task 1–8 authorized path.
- Do not modify fixtures merely to silence a production-contract failure.

- [ ] **Step 1: Run focused Cloudflare and existing MLS suites**

```powershell
npm.cmd run test:mls:cloudflare
npm.cmd run test:mls
npm.cmd run test:cron
npm.cmd run test:migration
```

Expected: all deterministic tests pass; `test:migration` performs static/fixture validation only and does not apply a migration.

- [ ] **Step 2: Run static verification**

```powershell
npm.cmd exec tsc -- --noEmit
npm.cmd exec tsc -- --noEmit -p workers/mls-container/tsconfig.json
npm.cmd exec prettier -- --check package.json .env.example scripts/mls/sync.mjs scripts/mls/sync.test.mjs src/lib/mls/reporting.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.mjs src/lib/mls/r2-reporting.test.mjs src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs workers/mls-container docs/mls-production-activation.md
npm.cmd exec eslint -- scripts/mls/sync.mjs scripts/mls/sync.test.mjs src/lib/mls/reporting.mjs src/lib/mls/reporting.test.mjs src/lib/mls/r2-reporting.mjs src/lib/mls/r2-reporting.test.mjs src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs src/lib/mls/ops-contract.test.mjs workers/mls-container/src workers/mls-container/container
npm.cmd exec wrangler -- deploy --dry-run --config workers/mls-container/wrangler.jsonc
npm.cmd exec wrangler -- deploy --dry-run --config workers/mls-container/wrangler.scheduled.jsonc
git diff --check -- package.json package-lock.json .env.example .gitignore scripts/mls src/lib/mls src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs workers/mls-container ops/systemd docs/mls-production-activation.md docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md
```

Expected: all pass. If Wrangler dry-run needs network and the sandbox blocks it, rerun only the same dry-run with approval; never substitute a real deploy.

- [ ] **Step 3: Rebuild the image and run a fake-dependency smoke**

Build `earnest-mls-container:local`, rerun the native `sharp` probe, then run the supervisor with fake Task 3 ports so no source, database, Blob, or R2 network request can occur. Prove:

- `/health` becomes ready.
- One authenticated `/run` starts one child.
- A duplicate start does not spawn.
- Fake terminal evidence produces a manifest last.
- `SIGTERM` reaches the child and the image exits within the cleanup bound.

Record Docker absence as a blocked external acceptance item; do not claim Container verification if it did not run.

- [ ] **Step 4: Audit scope and secrets**

```powershell
git status --short
git diff --name-only 4512d0754e227b9e704cec7861cd4038f5a48748..HEAD
git diff -- workers/cron
rg -n "postgresql://|BLOB_READ_WRITE_TOKEN=.+|MLS_R2_SECRET_ACCESS_KEY=.+|BEGIN (RSA|OPENSSH) PRIVATE KEY" package.json package-lock.json .env.example scripts/mls src/lib/mls workers/mls-container docs ops/systemd
```

Expected:

- `workers/cron` diff is empty.
- The credential scan finds variable names/documentation only, never values or private keys.
- Only Tasks 1–8 paths plus the known unrelated dirty paths appear.
- `bun.lockb` remains exactly the user's pre-existing unstaged modification and was never staged.

- [ ] **Step 5: Request a fresh code review before branch integration**

Use `superpowers:requesting-code-review` against the implementation base and current HEAD. The reviewer must inspect at minimum:

- Duplicate scheduled delivery and Workflow replay.
- DO claim/start transaction ordering and terminal immutability.
- Secret flow and redaction.
- Four-hour timeout/SIGTERM/unknown-outcome behavior.
- R2 conditional writes, manifest-last ordering, and 90-day external retention contract.
- Shadow/publish gates and preservation of direct Neon locking.
- No public start route and no second scheduler.
- Docker/native `sharp` verification evidence.

Fix confirmed findings test-first, rerun the full matrix, and commit each bounded review wave separately.

- [ ] **Step 6: Stop at the rollout authority boundary**

Hand off the code with these still-unperformed actions explicitly listed:

- Workers Paid/Containers/Workflows account confirmation.
- Cloudflare project, private R2 bucket, bucket lock, lifecycle, and scoped token creation.
- Production secret placement.
- Any live source request, Neon migration/integration, Vercel Blob upload, Cloudflare or Vercel deploy.
- Manual production shadow, scheduled trigger, seven-date approval, manual first publish, or `MLS_PUBLISH_ENABLED=true`.

Do not run any of them until the user separately authorizes the named action and supplies an unambiguous target account/resource.

---

## Self-Review Corrections (Normative)

The self-review found two cross-process details that must override the earlier illustrative snippets:

### Terminal manifest ownership

- Task 2's `createR2Reporter().writeRunArtifacts(run)` writes only the four report objects and returns their immutable metadata. It must **not** write `manifest.json` yet.
- Add `createR2Reporter().finalizeTerminal(input)`. The CLI calls it exactly once after it has determined the final exit code. It writes `manifest.json` last with `IfNoneMatch: "*"`.
- The Task 2 manifest-order test therefore expects four writes after `writeRunArtifacts` and five only after `finalizeTerminal`. An artifact failure or missing terminal classification produces no manifest.
- `finalizeTerminal` accepts this exact shape:

```js
{
  runId,
  status,
  terminalClassification,
  exitCode,
  startedAt,
  completedAt,
  durationMs,
  neonRunId,
  artifactObjects
}
```

- Its manifest contains environment, Hong Kong date, attempt ID, mode, commit SHA, Container deployment ID, Workflow instance ID, Container ID, Neon run ID, started/completed timestamps, duration, terminal classification, exit code, and the four artifact names/sizes/content types/SHA-256 hashes.
- Task 3 adds `MLS_ATTEMPT_STARTED_AT` and `MLS_TERMINAL_STATUS_FILE` to the validated non-secret Container configuration. `createEvidenceReporter.finalize({ outcome, error, exitCode, completedAt })` delegates to `finalizeTerminal` for R2 and performs pruning only for filesystem mode.

### Supervisor-to-Durable-Object terminal handoff

- The supervisor gives the child an attempt-local status path such as `/tmp/earnest-mls-terminal.json`; this file is ephemeral IPC, not evidence storage.
- Before returning or rethrowing, the CLI atomically writes one exact, bounded JSON record:

```js
{
  attemptId,
  runId,
  neonRunId,
  status,
  exitCode,
  failureCode,
  evidencePrefix,
  manifestKey,
  manifestPresent
}
```

- The supervisor reads that file only after child exit, rejects accessors/extra keys/invalid IDs or paths, snapshots the record, and exposes only those allowlisted fields at `/status`.
- If the file is missing or malformed, the supervisor records `unknown/terminal_status_missing` even when the operating-system exit code is zero. A successful exit without a final R2 manifest is never `succeeded` in R2 mode.
- Task 5's `readAttempt` uses this validated supervisor record to populate `neonRunId`, `evidencePrefix`, and `manifestPresent` before persisting terminal state and stopping the Container.
- Add fail-first tests in Tasks 3–5 for manifest-last finalization, nonzero failure finalization, missing/malformed status IPC, success-without-manifest becoming unknown, and persistence of the Neon/evidence correlation fields.

### Docker ignore and formatting command

- Use `workers/mls-container/Dockerfile.dockerignore`; Docker automatically applies the Dockerfile-specific ignore file when the root context is built with `--file workers/mls-container/Dockerfile`.
- Do not pass `Dockerfile` or `Dockerfile.dockerignore` to Prettier because this repository has no formatter plugin for them. Verify them with the focused contract test, Docker build, and `git diff --check` instead.

These corrections are part of Tasks 2–5 acceptance and are not optional follow-up work.

---
## Implementation Completion Checklist

- [ ] Dedicated private Worker project exists and `workers/cron` is unchanged.
- [ ] Base config has no schedule; scheduled config has only `0 18 * * *`.
- [ ] Scheduled identity is one attempt per environment/HK date; manual identity is distinct.
- [ ] Duplicate delivery and Workflow replay cannot spawn a second command.
- [ ] Supervisor enforces one start, four hours, heartbeat, SIGTERM forwarding, and fixed terminal classes.
- [ ] Existing CLI keeps direct unpooled Neon locking and atomic publication.
- [ ] Shadow cannot upload/publish; publish retains all existing explicit gates.
- [ ] R2 writes immutable whole objects and manifest last; application has no delete path.
- [ ] Container image is `linux/amd64`, non-root, Node 22, and native `sharp` verified.
- [ ] Status route is read-only and reports `cloudflare-container`.
- [ ] VPS/systemd artifacts are inert, and no second MLS scheduler remains.
- [ ] Deterministic MLS, migration-contract, status, Worker, supervisor, reporting, type, lint, format, dry-run, and scope checks pass.
- [ ] Provider and production actions remain unperformed pending separate approvals.
