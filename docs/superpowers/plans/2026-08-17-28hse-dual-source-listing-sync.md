# 28Hse Dual-Source Listing Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Earnest Property's existing Node MLS pipeline into a VPS-run, dual-source synchronization service that preserves old-site and 28Hse evidence, deduplicates exact listing identities, rehosts authorized images, and publishes canonical Neon changes only after safety gates pass.

**Architecture:** Add source adapters and pure decision modules around the existing Cheerio parser, then persist immutable observations and provenance in Neon. A dedicated Neon session holds a PostgreSQL advisory lock for the entire VPS run; a short interactive transaction publishes canonical changes atomically. The current `/api/mls-sync` route becomes a protected status endpoint, while a Node CLI and systemd timer become the only scheduled publisher.

**Tech Stack:** Node.js 22.15+ ESM, built-in `node:test` and global `WebSocket`, Cheerio 1.2, `@neondatabase/serverless` 1.1 (`Client` for the advisory-lock session and interactive publication; `neon` HTTP queries for status reads), Neon Postgres migrations, Vercel Blob's existing HTTP API, TanStack Start, and systemd on the VPS. Do not add Python, crawl4ai, pandas, a browser crawler, `ws`, or a new storage provider.

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-17-28hse-dual-source-listing-sync-design.md` as the approved behavior contract.
- Limit 28Hse access to public agent profile `540` and verify company licence `C-018613` on every run.
- Discover both deal types with server-rendered URLs: `/agent/540?buyRent=buy&page={n}&plan_id=540&propertyDoSearchVersion=2.0` and the equivalent `buyRent=rent` URL. Never infer deal type from the numeric property ID.
- Use two-to-three-second randomized pacing between 28Hse detail requests and at most three attempts for retryable failures.
- Abort the affected source on `403`, `429`, CAPTCHA, login/challenge pages, robots prohibition, identity mismatch, incomplete pagination, or repeated-page loops. Do not bypass access controls.
- Publish only Earnest-owned or explicitly authorized listing content. Never publish 28Hse mortgage, transport, school, estate editorial, engagement/view-count, map, floor-plan, QR-code, VR, or branded platform data.
- Treat robots permission as an access signal only. Before live crawling, the product owner separately records authorization to retrieve and republish the selected Earnest listing facts under applicable platform terms.
- `MLS_MEDIA_RIGHTS_CONFIRMED` defaults to `false`. Setting it to `true` is an operator attestation, not something code may infer from a CDN hostname.
- Media downloads require an exact operator-reviewed HTTPS hostname allowlist and public-address checks; network reachability never implies content rights.
- Match only normalized Earnest property number plus deal type. Never fuzzy-match title, address, estate, price, area, coordinates, or images.
- Preserve source observations even when a match is ambiguous. An ambiguous or missing property number cannot overwrite a canonical property.
- Reconciliation precedence is active staff override, then valid 28Hse value, then valid old-site value. A missing higher-priority value never erases a valid lower-priority value.
- Keep public reads on `properties`; source observations and reconciliation never run inside a public page request.
- Use the existing `inactive` property status for source delisting. Do not add a `delisted` enum value.
- A listing becomes inactive only after absence from both sources on two consecutive daily runs where both sources are healthy. A degraded day breaks the consecutive sequence.
- A healthy 28Hse run may publish safe new/changed/reactivated records while the old site is degraded, but degraded mode cannot advance inactivity. An unhealthy 28Hse run cannot publish canonical changes.
- Require both CLI mode `publish` and `MLS_PUBLISH_ENABLED=true`; also require an approved healthy shadow streak on seven consecutive Hong Kong dates before the repository accepts a publish batch.
- Retain normalized database evidence indefinitely and local artifacts for 90 days. Cleanup must verify every resolved target is beneath the configured MLS artifact directory.
- Keep Telegram integration out of scope; emit stable JSON and CSV reports for a future adapter.
- CI uses committed fixtures only. Live requests, database migrations, VPS scheduling, credentials, deployment, and production publication each require separate explicit authorization.
- Preserve unrelated workspace changes. Stage and commit only the paths listed in the active task.

---

## Validated Public URL Contract

Design-time validation on 2026-08-17 established these fixture-capture inputs:

- Agent profile: `https://www.28hse.com/agent/540`
- Sale discovery: `https://www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0`
- Rent discovery: `https://www.28hse.com/agent/540?buyRent=rent&page=1&plan_id=540&propertyDoSearchVersion=2.0`
- Representative detail: `https://www.28hse.com/buy/apartment/property-3972991`
- 28Hse robots policy: `https://www.28hse.com/robots.txt` returned `User-agent: *` / `Allow: /` during validation.
- Pagination accepts the `page` query and may canonicalize a `/agent/540/page-2` path back to the equivalent query form.

The adapter must build the query form itself, not blindly follow a displayed `rel=next` link, because the HTML link can omit the active `buyRent` filter. Advertised inventory counts and robots directives are volatile and must be parsed at run time rather than committed as expectations. The old-site robots response was not confirmed in this design pass, so its first authorized shadow run applies the RFC status rules below and fails closed if the policy is unreachable, explicitly prohibitive, or cannot be safely interpreted.

---

## Primary Operational Validation

- [Neon's serverless-driver documentation](https://neon.com/docs/serverless/serverless-driver) distinguishes one-shot HTTP queries from WebSocket-backed `Client`/`Pool` sessions and interactive transactions; the advisory lock and publication transaction therefore use one dedicated `Client` session.
- [The Neon driver repository](https://github.com/neondatabase/serverless) confirms that Node 22 has built-in WebSocket support for `Client`/`Pool` usage, while Node 21 and earlier require an added constructor.
- [Node 22 global API documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/globals.html) records stable global `WebSocket` support in Node 22.15, which is the VPS minimum in this plan.
- [systemd's calendar syntax source documentation](https://github.com/systemd/systemd/blob/main/man/systemd.time.xml) accepts installed IANA timezones after a calendar expression. The runbook still validates the exact expression locally with `systemd-analyze calendar` before installation.
- [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) defines longest-rule matching, allows access when `robots.txt` is unavailable via ordinary 4xx, and requires complete disallow when it is unreachable via network/5xx failure. This plan remains stricter for explicit 401/403/429 access controls.

---

## File Structure

### Persistence and contracts

- Create `neon/migrations/20260817120000_dual_source_listing_sync.sql` — provenance, run-ledger, field-state, lifecycle, and media schema.
- Modify `src/lib/control-plane/migration-versions.js` — register the new Neon migration.
- Create `src/lib/mls/mls-schema.test.mjs` — migration and manifest contract tests.
- Create `src/lib/mls/source-contract.mjs` and `source-contract.d.mts` — shared source/result/observation vocabulary and exact identity normalization.

### Source collection

- Create `src/lib/mls/sources/old-site.mjs` — permanent old-site adapter using existing parsers.
- Create `src/lib/mls/parse-28hse.mjs` — pure 28Hse index/detail parsers and challenge detection.
- Create `src/lib/mls/sources/28hse-agent.mjs` — robots-aware, paced, retrying 28Hse adapter.
- Create `src/lib/mls/access-policy.mjs` — wildcard robots evaluation and retry classification.
- Create `src/lib/mls/__fixtures__/28hse/*` — sanitized deterministic index, detail, robots, and challenge fixtures.
- Create `src/lib/mls/parse-28hse.test.mjs`, `source-contract.test.mjs`, and `source-adapters.test.mjs`.
- Modify `src/lib/mls/importer.mjs` and `importer.d.mts` — delegate old-site discovery to the adapter while retaining the legacy one-source API during rollout.

### Decisions and publication

- Create `src/lib/mls/health.mjs` and `health.test.mjs` — count, parse-rate, pagination, identity, and degraded-mode decisions.
- Create `src/lib/mls/match.mjs`, `reconcile.mjs`, and `reconcile.test.mjs` — exact grouping, staff override detection, field precedence, and lifecycle state.
- Create `src/lib/mls/neon-lock.mjs` and `neon-lock.test.mjs` — dedicated session advisory lock.
- Create `src/lib/mls/sync-repository.mjs`, `sync-repository.d.mts`, `sync-repository.test.mjs`, and `mls-db.integration.test.mjs` — run evidence, candidate reads, media records, source links, and atomic publication.
- Modify `src/lib/mls/neon-db.mjs` and `neon-db.d.mts` to add a read-only latest-run query while retaining the legacy importer until controlled cutover.

### Media, orchestration, and operations

- Create `src/lib/media/vercel-blob.mjs`, `vercel-blob.d.mts`, and `vercel-blob.test.mjs` — shared owned-storage adapter.
- Modify `src/routes/api.admin.media.upload.ts` and create `src/routes/api.admin.media.upload.test.mjs` — use the shared blob adapter without changing admin authorization or limits.
- Create `src/lib/mls/media.mjs` and `media.test.mjs` — media classification, magic-byte validation, hashing, deduplication, and preparation.
- Create `src/lib/mls/orchestrator.mjs`, `orchestrator.d.mts`, and `orchestrator.test.mjs` — the daily dual-source lifecycle.
- Create `src/lib/mls/reporting.mjs` and `reporting.test.mjs` — structured logs, JSON/CSV artifacts, and safe 90-day pruning.
- Create `scripts/mls/sync.mjs` and `scripts/mls/approve-baseline.mjs` — VPS commands.
- Modify `package.json`, `.env.example`, and `.gitignore` — scripts, explicit gates, and artifact exclusion.
- Modify `src/routes/api.mls-sync.ts`, `src/routes/api.mls-sync.test.mjs`, and `vercel.ts` — status-only endpoint and removal of the independent Vercel MLS publisher.
- Create `ops/systemd/earnest-mls-sync.service` and `ops/systemd/earnest-mls-sync.timer` — non-secret VPS templates.
- Create `src/lib/mls/ops-contract.test.mjs` — route, cron, systemd, and runbook cutover contracts.
- Replace `docs/mls-production-activation.md` — Neon/VPS shadow, cutover, rollback, and credential-source runbook.

---

### Task 1: Add the Dual-Source Persistence Schema

**Files:**

- Create: `neon/migrations/20260817120000_dual_source_listing_sync.sql`
- Modify: `src/lib/control-plane/migration-versions.js`
- Create: `src/lib/mls/mls-schema.test.mjs`

**Interfaces:**

- Consumes: existing `properties`, `media_assets`, `staff_users`, `deal_type`, and `property_status` from earlier Neon migrations.
- Produces: `listing_sync_runs`, `listing_source_observations`, `property_source_links`, `property_sync_fields`, `property_sync_state`, `listing_change_events`, `listing_media_records`, `properties.canonical_property_no`, and `media_assets.content_hash` for all later tasks.

- [ ] **Step 1: Write the failing schema contract test**

Create `src/lib/mls/mls-schema.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";

const version = "20260817120000_dual_source_listing_sync.sql";
const sql = readFileSync(new URL(`../../../neon/migrations/${version}`, import.meta.url), "utf8");

test("dual-source migration is registered", () => {
  assert.ok(MIGRATION_VERSIONS.includes(version));
});

test("dual-source migration creates every persistence boundary", () => {
  for (const relation of [
    "listing_sync_runs",
    "listing_source_observations",
    "property_source_links",
    "property_sync_fields",
    "property_sync_state",
    "listing_change_events",
    "listing_media_records",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${relation}\\b`, "i"), relation);
  }
  assert.match(sql, /ADD COLUMN IF NOT EXISTS canonical_property_no TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS content_hash TEXT/i);
  assert.match(sql, /baseline_approved_by TEXT/i);
});

test("source IDs are unique without overloading legacy_detail_id", () => {
  assert.match(
    sql,
    /UNIQUE \(source, external_listing_id, deal_type\)/i,
  );
  assert.doesNotMatch(sql, /DROP CONSTRAINT properties_legacy_detail_deal_type_key/i);
  assert.match(sql, /discovered_at TIMESTAMPTZ NOT NULL/i);
  assert.match(sql, /parse_warnings TEXT\[\] NOT NULL/i);
  assert.match(sql, /property_id UUID REFERENCES properties\(id\) ON DELETE SET NULL/i);
});

test("lifecycle state uses inactive rather than a new delisted enum", () => {
  assert.doesNotMatch(sql, /ALTER TYPE property_status ADD VALUE ['"]delisted/i);
  assert.match(sql, /consecutive_absent_healthy_runs/i);
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```powershell
node --test src/lib/mls/mls-schema.test.mjs
```

Expected: FAIL because the migration file does not exist and is not in `MIGRATION_VERSIONS`.

- [ ] **Step 3: Create the migration**

Create `neon/migrations/20260817120000_dual_source_listing_sync.sql` with this complete schema:

```sql
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS canonical_property_no TEXT;

UPDATE properties
SET canonical_property_no = upper(regexp_replace(trim(legacy_property_no), '\\s+', '', 'g'))
WHERE canonical_property_no IS NULL
  AND legacy_property_no IS NOT NULL
  AND trim(legacy_property_no) <> '';

CREATE INDEX IF NOT EXISTS idx_properties_canonical_property_no_deal
  ON properties (canonical_property_no, deal_type);

CREATE TABLE IF NOT EXISTS listing_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'publish')),
  status TEXT NOT NULL CHECK (status IN (
    'running', 'shadow_healthy', 'healthy', 'degraded', 'blocked', 'failed', 'lock_skipped'
  )),
  parser_version TEXT NOT NULL,
  source_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  baselines JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_code TEXT,
  failure_summary TEXT,
  baseline_approved_at TIMESTAMPTZ,
  baseline_approved_by TEXT,
  baseline_approval_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_sync_runs_started
  ON listing_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_sync_runs_status
  ON listing_sync_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS listing_source_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES listing_sync_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('old_site', '28hse_agent_540')),
  external_listing_id TEXT NOT NULL,
  deal_type deal_type NOT NULL,
  source_url TEXT NOT NULL,
  property_no_raw TEXT,
  property_no_normalized TEXT,
  payload JSONB NOT NULL,
  media_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash TEXT NOT NULL,
  validation_state TEXT NOT NULL CHECK (validation_state IN ('valid', 'quarantined')),
  quarantine_reasons TEXT[] NOT NULL DEFAULT '{}',
  parse_warnings TEXT[] NOT NULL DEFAULT '{}',
  discovered_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, source, external_listing_id, deal_type)
);

CREATE INDEX IF NOT EXISTS idx_listing_observations_match
  ON listing_source_observations (property_no_normalized, deal_type, run_id);
CREATE INDEX IF NOT EXISTS idx_listing_observations_source_external
  ON listing_source_observations (source, external_listing_id, deal_type, fetched_at DESC);

CREATE TABLE IF NOT EXISTS property_source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('old_site', '28hse_agent_540')),
  external_listing_id TEXT NOT NULL,
  deal_type deal_type NOT NULL,
  match_key TEXT NOT NULL,
  link_reason TEXT NOT NULL CHECK (link_reason = 'exact_property_no_and_deal_type'),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected')),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_run_id UUID NOT NULL REFERENCES listing_sync_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_listing_id, deal_type)
);

CREATE INDEX IF NOT EXISTS idx_property_source_links_property
  ON property_source_links (property_id, status);
CREATE INDEX IF NOT EXISTS idx_property_source_links_match
  ON property_source_links (match_key, status);

CREATE TABLE IF NOT EXISTS property_sync_fields (
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  last_published_value JSONB,
  override_value JSONB,
  active_override BOOLEAN NOT NULL DEFAULT false,
  winning_observation_id UUID REFERENCES listing_source_observations(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, field_name)
);

CREATE TABLE IF NOT EXISTS property_sync_state (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  consecutive_absent_healthy_runs INT NOT NULL DEFAULT 0 CHECK (consecutive_absent_healthy_runs >= 0),
  last_evaluated_run_id UUID REFERENCES listing_sync_runs(id) ON DELETE SET NULL,
  inactive_reason TEXT,
  inactive_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES listing_sync_runs(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('new', 'changed', 'inactive', 'reactivated', 'link_change')),
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,
  winning_observation_id UUID REFERENCES listing_source_observations(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_change_events_property
  ON listing_change_events (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_change_events_run
  ON listing_change_events (run_id, change_type);

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_content_hash_key
  ON media_assets (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS listing_media_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID NOT NULL REFERENCES listing_source_observations(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT,
  owned_media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  detected_mime TEXT,
  size_bytes BIGINT,
  width INT,
  height INT,
  eligibility TEXT NOT NULL CHECK (eligibility IN ('eligible', 'rejected', 'upload_failed')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (observation_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_listing_media_records_hash
  ON listing_media_records (content_hash)
  WHERE content_hash IS NOT NULL;
```

- [ ] **Step 4: Register the migration**

Append the new filename to `MIGRATION_VERSIONS` in `src/lib/control-plane/migration-versions.js`:

```js
  "20260816120000_staff_identity_actions.sql",
  "20260817120000_dual_source_listing_sync.sql",
]);
```

- [ ] **Step 5: Run schema and migration-manifest tests**

Run:

```powershell
node --test src/lib/mls/mls-schema.test.mjs src/lib/control-plane/migration-versions.test.mjs
```

Expected: all schema and manifest tests PASS. Do not run `npm.cmd run neon:migrate`; applying the migration to any database is a later authorization gate.

- [ ] **Step 6: Commit the schema boundary**

```powershell
git add neon/migrations/20260817120000_dual_source_listing_sync.sql src/lib/control-plane/migration-versions.js src/lib/mls/mls-schema.test.mjs
git commit -m "feat: add dual-source MLS persistence schema"
```

---

### Task 2: Introduce the Shared Observation Contract and Old-Site Adapter

**Files:**

- Create: `src/lib/mls/source-contract.mjs`
- Create: `src/lib/mls/source-contract.d.mts`
- Create: `src/lib/mls/source-contract.test.mjs`
- Create: `src/lib/mls/sources/old-site.mjs`
- Create: `src/lib/mls/source-adapters.test.mjs`
- Modify: `src/lib/mls/importer.mjs`
- Modify: `src/lib/mls/importer.d.mts`

**Interfaces:**

- Consumes: `parseListingIndex`, `parseListingDetail`, `normalizeListingDetail`, a Fetch-compatible function for the new adapter, and the current old-site seed URLs.
- Produces: normalized immutable observations shared by both adapters while retaining the existing `createMlsImporter` API for rollback.

- [ ] **Step 1: Write failing normalization and adapter tests**

Create `src/lib/mls/source-contract.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  createObservation,
  normalizePropertyNo,
} from "./source-contract.mjs";

test("property identity normalizes conservatively", () => {
  assert.equal(normalizePropertyNo(" c 003097 "), "C003097");
  assert.equal(normalizePropertyNo("Ａ- 12"), "A-12");
  assert.equal(normalizePropertyNo(""), null);
  assert.equal(normalizePropertyNo("C/12"), null);
  assert.equal(buildMatchKey(" c003097 ", "sale"), "sale:C003097");
  assert.equal(buildMatchKey(null, "rent"), null);
});

test("observation hash is stable and carries exact match identity", () => {
  const input = {
    source: SOURCE_28HSE,
    externalId: "3972991",
    dealType: "sale",
    sourceUrl: "https://www.28hse.com/buy/apartment/property-3972991",
    propertyNoRaw: "C003097",
    fields: { title_zh: "西半山單位", price: 12000000 },
    rawFields: { priceText: "售 $1,200萬" },
    mediaCandidates: [],
    discoveredAt: "2026-08-17T01:59:00.000Z",
    fetchedAt: "2026-08-17T02:00:00.000Z",
  };
  const first = createObservation(input);
  const second = createObservation({ ...input, fields: { price: 12000000, title_zh: "西半山單位" } });
  assert.equal(first.matchKey, "sale:C003097");
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.source, SOURCE_28HSE);
  assert.equal(SOURCE_OLD_SITE, "old_site");
});
```

Add a case to `src/lib/mls/source-adapters.test.mjs` that feeds one existing old-site index fixture and detail fixture through `createOldSiteSourceAdapter({ fetchImpl: fakeResponseFetch, sleep: async () => {}, random: () => 0, now: fixedClock, signal: new AbortController().signal })` and asserts:

```js
assert.equal(result.source, "old_site");
assert.equal(result.observations.length, 1);
assert.equal(result.observations[0].dealType, "sale");
assert.equal(result.observations[0].matchKey, "sale:C003097");
assert.equal(result.paginationComplete, true);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
node --test src/lib/mls/source-contract.test.mjs src/lib/mls/source-adapters.test.mjs
```

Expected: FAIL because the source contract and old-site adapter do not exist.

- [ ] **Step 3: Implement the source contract**

Create `src/lib/mls/source-contract.mjs` with these exports:

```js
import { createHash } from "node:crypto";

export const SOURCE_OLD_SITE = "old_site";
export const SOURCE_28HSE = "28hse_agent_540";
export const DEAL_TYPES = Object.freeze(["sale", "rent"]);
export const MLS_PARSER_VERSION = "dual-source-v1";
export const OBSERVATION_SCHEMA_VERSION = 1;

export function normalizePropertyNo(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return normalized && /^[A-Z0-9-]+$/.test(normalized) ? normalized : null;
}

export function buildMatchKey(propertyNo, dealType) {
  const normalized = normalizePropertyNo(propertyNo);
  return normalized && DEAL_TYPES.includes(dealType)
    ? `${dealType}:${normalized}`
    : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function stableObservationHash(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function createObservation(input) {
  if (![SOURCE_OLD_SITE, SOURCE_28HSE].includes(input.source)) {
    throw new TypeError("Unsupported MLS source");
  }
  if (!DEAL_TYPES.includes(input.dealType) || !input.externalId || !input.sourceUrl) {
    throw new TypeError("Observation identity is incomplete");
  }
  const propertyNoNormalized = normalizePropertyNo(input.propertyNoRaw);
  const quarantineReasons = [...new Set(input.quarantineReasons ?? [])];
  if (!propertyNoNormalized) quarantineReasons.push("missing_or_invalid_property_number");
  const fields = input.fields ?? {};
  if (input.dealType === "sale" && !(Number(fields.price) > 0)) {
    quarantineReasons.push("missing_or_invalid_sale_price");
  }
  if (input.dealType === "rent" && !(Number(fields.rent) > 0)) {
    quarantineReasons.push("missing_or_invalid_rent");
  }
  const hashInput = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    source: input.source,
    externalId: String(input.externalId),
    dealType: input.dealType,
    propertyNoNormalized,
    fields,
    rawFields: input.rawFields ?? {},
    mediaCandidates: input.mediaCandidates ?? [],
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  };
  return Object.freeze({
    ...hashInput,
    sourceUrl: input.sourceUrl,
    propertyNoRaw: input.propertyNoRaw ?? null,
    matchKey: buildMatchKey(propertyNoNormalized, input.dealType),
    discoveredAt: input.discoveredAt ?? input.fetchedAt,
    fetchedAt: input.fetchedAt,
    contentHash: stableObservationHash(hashInput),
    validationState: quarantineReasons.length ? "quarantined" : "valid",
    quarantineReasons: [...new Set(quarantineReasons)],
    parseWarnings: [...new Set(input.parseWarnings ?? [])],
  });
}
```

Define matching types in `src/lib/mls/source-contract.d.mts`. The normalized source field map follows canonical names where a direct column exists; `estate_slug` remains a source lookup key that must be resolved to canonical `estate_id` before publication. It must not include platform-only fields:

```ts
export type MlsSource = "old_site" | "28hse_agent_540";
export type DealType = "sale" | "rent";

export interface ListingFields {
  title_zh?: string | null;
  title_en?: string | null;
  estate_slug?: string | null;
  district_slug?: string | null;
  address?: string | null;
  price?: number | null;
  rent?: number | null;
  saleable_area?: number | null;
  gross_area?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor?: string | null;
  orientation?: string | null;
  features?: string[] | null;
  description?: string | null;
  status?: "draft" | "active" | "sold" | "rented" | "offline" | "inactive" | null;
}

export interface MediaCandidate {
  url: string;
  category: "listing_photo" | "map" | "floorplan" | "qr" | "vr" | "branded" | "unknown";
  isPrimary: boolean;
}

export interface SourceObservation {
  schemaVersion: 1;
  source: MlsSource;
  externalId: string;
  dealType: DealType;
  sourceUrl: string;
  propertyNoRaw: string | null;
  propertyNoNormalized: string | null;
  matchKey: string | null;
  fields: ListingFields;
  rawFields: Record<string, unknown>;
  mediaCandidates: MediaCandidate[];
  sourceUpdatedAt: string | null;
  discoveredAt: string;
  fetchedAt: string;
  contentHash: string;
  validationState: "valid" | "quarantined";
  quarantineReasons: string[];
  parseWarnings: string[];
}

export interface SourceRunResult {
  source: MlsSource;
  identityValid: boolean;
  robotsAllowed: boolean;
  paginationComplete: boolean;
  challengeDetected: boolean;
  advertisedCounts: Record<DealType, number>;
  pageCounts: Record<DealType, number>;
  discovered: number;
  observations: SourceObservation[];
  failures: Array<{ externalId?: string; code: string; detail: string }>;
  diagnostics: Array<{
    sourceUrl: string;
    responseStatus: number | null;
    attempts: number;
    templateFingerprint: string | null;
    selectorCounts: Record<string, number>;
    failureCode: string | null;
  }>;
  conflictingDuplicateIds: string[];
}
```

- [ ] **Step 4: Wrap the existing old-site parser**

Implement `createOldSiteSourceAdapter({ fetchImpl, sleep, random, now, signal })` in `src/lib/mls/sources/old-site.mjs`. From the first task, the adapter must preserve response status/headers rather than accepting a text-only callback; Task 4 adds the complete policy behavior. It must:

1. Export `DEFAULT_OLD_SITE_SEED_URLS` using the importer’s existing sale and rent seeds.
2. Discover every paginated index URL with the existing `parseListingIndex` logic.
3. Fetch and normalize every unique detail ID.
4. Convert each normalized row with `createObservation`, using the legacy detail ID as `externalId` and the index seed as the authoritative deal type. Set source `estate_slug` with the existing exported `resolveEstateSlug(detail)`; do not pass a null `estate_id` through as an automated source value. Preserve source label/value text in `rawFields`, index discovery time in `discoveredAt`, and non-fatal parser notices in `parseWarnings`.
5. Return a complete `SourceRunResult`; for every discovered link, emit either a valid observation or a quarantined stub observation carrying source ID, deal type, URL, discovery/fetch time, and failure reasons. Never silently discard a failed detail.
6. Preserve old-site description and image candidates because those are first-party inputs.

Export a pure `discoverOldSitePages({ fetchText, seedUrls, maxPages })` helper for the existing importer. Refactor `createMlsImporter` to call that helper with its legacy text-only callback, but keep its public `discover()` and `sync()` return shapes unchanged. The legacy wrapper cannot claim policy health; only the final adapter used by the dual-source orchestrator can. Re-export the old seed constant if existing tests import it. Update `importer.d.mts` without deleting any legacy declarations.

- [ ] **Step 5: Run the contract, adapter, and legacy MLS tests**

Run:

```powershell
node --test src/lib/mls/source-contract.test.mjs src/lib/mls/source-adapters.test.mjs src/lib/mls/mls-fixtures.test.mjs
```

Expected: PASS, including the unchanged legacy importer behavior.

- [ ] **Step 6: Commit the shared source boundary**

```powershell
git add src/lib/mls/source-contract.mjs src/lib/mls/source-contract.d.mts src/lib/mls/source-contract.test.mjs src/lib/mls/sources/old-site.mjs src/lib/mls/source-adapters.test.mjs src/lib/mls/importer.mjs src/lib/mls/importer.d.mts
git commit -m "refactor: add shared MLS source contract"
```

---

### Task 3: Parse 28Hse Agent and Detail Pages Without Platform Content

**Files:**

- Create: `src/lib/mls/parse-28hse.mjs`
- Create: `src/lib/mls/parse-28hse.test.mjs`
- Create: `src/lib/mls/__fixtures__/28hse/agent-sale-page-1.html`
- Create: `src/lib/mls/__fixtures__/28hse/agent-sale-page-2.html`
- Create: `src/lib/mls/__fixtures__/28hse/agent-rent-page-1.html`
- Create: `src/lib/mls/__fixtures__/28hse/detail-sale-3972991.html`
- Create: `src/lib/mls/__fixtures__/28hse/detail-rent-3976155.html`
- Create: `src/lib/mls/__fixtures__/28hse/detail-missing-optional.html`
- Create: `src/lib/mls/__fixtures__/28hse/detail-changed-layout.html`
- Create: `src/lib/mls/__fixtures__/28hse/empty.html`
- Create: `src/lib/mls/__fixtures__/28hse/malformed.html`
- Create: `src/lib/mls/__fixtures__/28hse/login.html`
- Create: `src/lib/mls/__fixtures__/28hse/challenge.html`

**Interfaces:**

- Consumes: sanitized server-rendered HTML fixtures shaped like the validated public pages.
- Produces: pure index summaries and `SourceObservation` values with an explicit allowlist of public fields and media candidates.

- [ ] **Step 1: Commit sanitized, deterministic fixtures**

Create minimal UTF-8 fixtures containing only these structural inputs:

| Fixture | Required invariant |
|---|---|
| `agent-sale-page-1.html` | licence `C-018613`, advertised sale count, two unique sale anchors, page-one marker |
| `agent-sale-page-2.html` | same licence, final sale anchor, a duplicate prior anchor, page-two marker |
| `agent-rent-page-1.html` | same licence, advertised rent count, one rent anchor |
| `detail-sale-3972991.html` | `物業編號: C003097 (代理提供)`, table-left/right rows, gallery photo, plus mortgage/school/map/view-count decoys |
| `detail-rent-3976155.html` | rental price, usable area, rooms, property number, listing gallery photo |
| `detail-missing-optional.html` | valid identity/price with no optional area, room, floor, orientation, or gallery values |
| `detail-changed-layout.html` | required values moved outside the allowlisted label/value structure; must quarantine as unexpected template |
| `empty.html` / `malformed.html` / `login.html` | empty body, truncated markup, and unexpected login wall failure modes |
| `challenge.html` | CAPTCHA/challenge heading and no listing body |

Remove scripts, analytics IDs, unrelated user data, and complete editorial copy. Do not capture a fresh live page while implementing this task; a fixture refresh is a separately approved network action.

- [ ] **Step 2: Write the failing parser tests**

Create `src/lib/mls/parse-28hse.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  build28HseAgentUrl,
  detect28HseChallenge,
  parse28HseAgentIndex,
  parse28HseDetail,
} from "./parse-28hse.mjs";

const fixture = (name) =>
  readFileSync(new URL("./__fixtures__/28hse/" + name, import.meta.url), "utf8");

test("builds deal-specific page URLs instead of following rel=next", () => {
  assert.equal(
    build28HseAgentUrl("rent", 2),
    "https://www.28hse.com/agent/540?buyRent=rent&page=2&plan_id=540&propertyDoSearchVersion=2.0",
  );
});

test("extracts exact agent identity, advertised count, and unique links", () => {
  const page = parse28HseAgentIndex(fixture("agent-sale-page-1.html"), {
    dealType: "sale",
    pageUrl: build28HseAgentUrl("sale", 1),
  });
  assert.equal(page.companyLicence, "C-018613");
  assert.match(page.companyName, /晉誠地產|Earnest Property/i);
  assert.equal(page.dealType, "sale");
  assert.equal(page.links.length, 2);
  assert.ok(page.advertisedCount >= page.links.length);
});

test("detail parser allowlists listing facts and excludes platform modules", () => {
  const item = parse28HseDetail(fixture("detail-sale-3972991.html"), {
    sourceUrl: "https://www.28hse.com/buy/apartment/property-3972991",
    dealType: "sale",
    summaryTitle: "Earnest Property - 西半山單位",
    fetchedAt: "2026-08-17T02:00:00.000Z",
  });
  assert.equal(item.externalId, "3972991");
  assert.equal(item.propertyNoNormalized, "C003097");
  assert.equal(item.fields.title_zh, "Earnest Property - 西半山單位");
  assert.equal(item.fields.description, undefined);
  assert.equal(item.fields.view_count, undefined);
  assert.ok(item.mediaCandidates.every((candidate) => candidate.category === "listing_photo"));
  assert.ok(item.mediaCandidates.every((candidate) => !/map|floorplan|qr|vr/i.test(candidate.url)));
});

test("challenge pages are detected before parsing", () => {
  assert.equal(detect28HseChallenge(fixture("challenge.html")), true);
  assert.throws(
    () => parse28HseAgentIndex(fixture("challenge.html"), {
      dealType: "sale",
      pageUrl: build28HseAgentUrl("sale", 1),
    }),
    /challenge/i,
  );
});

test("missing optional values stay null while changed or malformed templates quarantine", () => {
  const optional = parse28HseDetail(fixture("detail-missing-optional.html"), {
    sourceUrl: "https://www.28hse.com/rent/apartment/property-3977001",
    dealType: "rent",
    summaryTitle: "Earnest Property - Rental",
    discoveredAt: "2026-08-17T01:59:00.000Z",
    fetchedAt: "2026-08-17T02:00:00.000Z",
  });
  assert.equal(optional.validationState, "valid");
  assert.equal(optional.fields.saleable_area ?? null, null);
  for (const name of ["detail-changed-layout.html", "empty.html", "malformed.html"]) {
    assert.throws(() => parse28HseDetail(fixture(name), {
      sourceUrl: "https://www.28hse.com/buy/apartment/property-3977002",
      dealType: "sale",
      summaryTitle: "Earnest Property - Invalid fixture",
      discoveredAt: "2026-08-17T01:59:00.000Z",
      fetchedAt: "2026-08-17T02:00:00.000Z",
    }), /template|parse|empty/i);
  }
  assert.equal(detect28HseChallenge(fixture("login.html")), true);
});
```

- [ ] **Step 3: Run the parser test and verify it fails**

Run:

```powershell
node --test src/lib/mls/parse-28hse.test.mjs
```

Expected: FAIL because `parse-28hse.mjs` does not exist.

- [ ] **Step 4: Implement the pure parser**

Implement these exports in `src/lib/mls/parse-28hse.mjs`:

- `build28HseAgentUrl(dealType, page)` — validate `sale|rent` and a positive integer; map sale to `buy` and rent to `rent`; construct the exact query URL.
- `detect28HseChallenge(html)` — return true for known CAPTCHA, Cloudflare challenge, login wall, access-denied, or empty challenge-shell signatures; do not solve or bypass them.
- `parse28HseAgentIndex(html, context)` — validate the source URL/deal path, extract company name and `C-018613`, parse the displayed count for the active deal type, and collect unique anchors matching only `/\/(buy|rent)\/[^"?#]*\/property-(\d+)/`. Each link is `{ externalId, url, summaryTitle }`; the adapter stamps `discoveredAt` when it accepts the link. Return `{ companyName, companyLicence, advertisedCount, dealType, links, pageFingerprint }`, with a SHA-256 fingerprint of sorted external IDs.
- `parse28HseDetail(html, context)` — use table label/value pairs (`.table_left`/`.table_right` plus an explicit fallback label map) to read property number, sale/rent amount, usable/gross area, rooms, address, floor, orientation, and listing tags. Use `summaryTitle` rather than the platform page title. Preserve original strings only for those allowlisted listing facts in `rawFields`; do not retain platform/editorial module text. Pass index `discoveredAt` separately from detail `fetchedAt`.

Use the existing old-site money and area helpers if they are exported; otherwise move those pure helpers to a shared file and keep re-exports so old tests stay green. Return `createObservation(observationInput)` directly.

The detail allowlist is:

```js
const ALLOWED_28HSE_FIELDS = new Set([
  "title_zh",
  "title_en",
  "estate_slug",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "status",
]);
```

Gallery extraction must start from explicit listing-gallery containers and classify every accepted image as `listing_photo`. It must reject URLs or surrounding elements that indicate map, floor plan/unit plan, QR, VR, logo, avatar, ad, or 28Hse branding. The parser must never return descriptions, mortgage calculations, transport, school, estate editorial, view counts, coordinates, or platform badges.

Scope licence, advertised count, listing title, and anchors to the active agent-profile/results containers rather than scripts, navigation, recommended agents, or sponsored modules. Parse comma-separated decimal counts and reject multiple contradictory licence/count candidates as an unexpected template.

Missing optional values are valid nulls. Missing/invalid property number, non-positive price for the active deal type, missing title/district, or an unrecognized required-value layout must be quarantined or thrown as a parse failure so it counts against the 98% threshold.

- [ ] **Step 5: Run parser and existing normalization tests**

Run:

```powershell
node --test src/lib/mls/parse-28hse.test.mjs src/lib/mls/mls-fixtures.test.mjs
```

Expected: PASS with no network access.

- [ ] **Step 6: Commit the parser and fixtures**

```powershell
git add src/lib/mls/parse-28hse.mjs src/lib/mls/parse-28hse.test.mjs src/lib/mls/__fixtures__/28hse
git commit -m "feat: parse authorized 28Hse listing fields"
```

---

### Task 4: Enforce Robots, Pacing, Retries, and Complete Pagination

**Files:**

- Create: `src/lib/mls/access-policy.mjs`
- Create: `src/lib/mls/sources/28hse-agent.mjs`
- Modify: `src/lib/mls/sources/old-site.mjs`
- Modify: `src/lib/mls/source-adapters.test.mjs`
- Create: `src/lib/mls/__fixtures__/28hse/robots-allow.txt`
- Create: `src/lib/mls/__fixtures__/28hse/robots-disallow.txt`
- Create: `src/lib/mls/__fixtures__/old-site/robots-allow.txt`
- Create: `src/lib/mls/__fixtures__/old-site/robots-disallow.txt`

**Interfaces:**

- Consumes: `build28HseAgentUrl`, `parse28HseAgentIndex`, `parse28HseDetail`, an injectable Fetch-compatible function, sleep function, clock, and RNG.
- Produces: one complete `SourceRunResult` for `28hse_agent_540` with explicit failure categories and no hidden retry or bypass behavior.

- [ ] **Step 1: Write failing access-policy and adapter tests**

Add cases to `src/lib/mls/source-adapters.test.mjs`:

```js
test("robots evaluator uses the most-specific matching rule and Allow wins ties", () => {
  const policy = parseRobots(fixture("robots-allow.txt"), "EarnestPropertyBot");
  assert.equal(policy.isAllowed("/agent/540"), true);
  assert.equal(policy.isAllowed("/private/export"), false);
});

test("403 and 429 are terminal but network, 408, and 5xx are retryable", () => {
  assert.equal(classifyFetchFailure({ status: 403 }), "terminal_access");
  assert.equal(classifyFetchFailure({ status: 429 }), "terminal_access");
  assert.equal(classifyFetchFailure({ status: 503 }), "retryable");
  assert.equal(classifyFetchFailure({ status: 408 }), "retryable");
  assert.equal(classifyFetchFailure({ networkError: true }), "retryable");
});

test("robots status handling distinguishes unavailable from unreachable", () => {
  assert.equal(classifyRobotsResponse({ status: 404 }), "allow_unavailable");
  assert.equal(classifyRobotsResponse({ status: 410 }), "allow_unavailable");
  assert.equal(classifyRobotsResponse({ status: 403 }), "terminal_access");
  assert.equal(classifyRobotsResponse({ status: 429 }), "terminal_access");
  assert.equal(classifyRobotsResponse({ status: 503 }), "disallow_unreachable");
  assert.equal(classifyRobotsResponse({ networkError: true }), "disallow_unreachable");
});

test("28Hse adapter preserves the active deal filter across pagination", async () => {
  const requested = [];
  const sleeps = [];
  const adapter = create28HseAgentSourceAdapter({
    fetchImpl: fakeFixtureFetch(requested),
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    random: () => 0.5,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });
  const result = await adapter.collect();
  assert.ok(requested.some((url) => url.includes("buyRent=buy&page=2")));
  assert.ok(requested.some((url) => url.includes("buyRent=rent&page=1")));
  assert.equal(requested.some((url) => /page-2/.test(url)), false);
  assert.equal(result.identityValid, true);
  assert.equal(result.paginationComplete, true);
  assert.equal(result.observations.length, result.discovered);
  assert.ok(sleeps.every((value) => value === 2500));
});

test("repeated pages and access challenges fail closed", async () => {
  const result = await repeatedPageAdapter().collect();
  assert.equal(result.paginationComplete, false);
  assert.ok(result.failures.some((failure) => failure.code === "pagination_loop"));
});

test("old-site adapter also checks robots, retries safely, and reports page loops", async () => {
  const allowed = await oldSitePolicyHarness("robots-allow.txt").collect();
  const denied = await oldSitePolicyHarness("robots-disallow.txt").collect();
  assert.equal(allowed.robotsAllowed, true);
  assert.equal(denied.robotsAllowed, false);
  assert.equal(denied.observations.length, 0);
});
```

The fake fetch must map exact URLs to committed fixtures and throw on an unknown URL. It must never fall through to the network.

- [ ] **Step 2: Run the adapter tests and verify they fail**

Run:

```powershell
node --test src/lib/mls/source-adapters.test.mjs
```

Expected: FAIL because the access policy and 28Hse adapter exports do not exist.

- [ ] **Step 3: Implement the access policy**

In `src/lib/mls/access-policy.mjs` implement:

- `parseRobots(text, userAgent)` with wildcard `*`, end marker `$`, user-agent groups, longest matching rule, allow-on-equal-specificity behavior, and a conservative numeric `crawlDelaySeconds` when supplied.
- `classifyFetchFailure({ status, networkError })` returning `terminal_access` for 401/403/429, `retryable` for network errors/408/5xx, and `terminal_response` otherwise.
- `classifyRobotsResponse(...)` following RFC 9309: successful 2xx parses applicable rules; 404/410 is `allow_unavailable`; 401/403/429 remains terminal under this project's stricter policy; 5xx, timeout, DNS, and network failure is `disallow_unreachable`. Follow at most five robots redirects, reapplying fixed-origin/approved-host safety on every hop.
- `createPolicyFetch({ fetchImpl, sleep, random, signal, maxAttempts = 3 })`, returning response text, status, and attempt count. Combine the run signal with each request timeout, make retry delays abortable, use `2000 + Math.floor(random() * 1001)` milliseconds, and never retry an access-control response.

Use `AbortSignal.timeout(30_000)` per page request (15 seconds for robots) and classify a timeout as retryable. Cap response bodies before parsing (2 MB for index/detail HTML and 512 KB for robots); an oversized response is a terminal unexpected-template failure, not something to buffer without limit.

Send a stable, honest user agent and an operator contact URL configured by `MLS_CRAWLER_CONTACT_URL`; do not impersonate a browser. Parse every valid robots line and honor applicable rules. If malformed content leaves no safely interpretable applicable policy, fail closed and require operator review.
Honor a finite crawl delay. If a declared delay exceeds the configured 30-second per-request run budget, mark the source unhealthy with `crawl_delay_exceeds_run_budget` rather than ignoring it or occupying the worker indefinitely.

- [ ] **Step 4: Implement the 28Hse source adapter**

In `src/lib/mls/sources/28hse-agent.mjs` export `create28HseAgentSourceAdapter({ fetchImpl, sleep, random, now, signal })`. Its `collect()` method must:

1. Fetch and evaluate `https://www.28hse.com/robots.txt` before agent or detail pages.
2. Collect sale and rent independently with `build28HseAgentUrl(dealType, page)`.
3. Validate licence `C-018613` and a normalized company-name alias containing `晉誠地產` or `Earnest Property` on every index page.
4. Stop successfully only when unique IDs equal the advertised count for that deal type.
5. Fail pagination when a page yields zero new IDs before the count is met, repeats a fingerprint, changes the active deal type, or exceeds a configurable ceiling defaulting to 100 pages.
6. Treat the external numeric ID plus the already-known deal type as source identity; the same numeric ID in different deal types remains two observations.
7. Fetch details sequentially. Apply a fresh two-to-three-second delay before every detail request after the first, and use the retry policy for retryable failures only.
8. Abort the source immediately on `403`, `429`, challenge HTML, identity mismatch, or robots denial. Return collected evidence but set the corresponding health flags false.
9. Record each non-access detail failure in `failures`, create a quarantined stub observation for that discovered source ID, and continue so the later 98% parse-rate gate can decide. Thus `observations.length === discovered` for any source that completed discovery.
10. Detect duplicate external IDs whose parsed property numbers conflict and populate `conflictingDuplicateIds`.
11. Emit only bounded/redacted `diagnostics` metadata for every failed request or changed template; never place HTML or headers in that array.

Resolve relative links against the fixed source origin and reject any index, detail, pagination, or redirect URL whose scheme is not HTTPS or whose hostname leaves that source's approved origin. Do not let scraped markup choose an arbitrary fetch host.

Update `createOldSiteSourceAdapter` to use the same robots evaluator, challenge/access classification, bounded three-attempt policy, pagination fingerprint/zero-new-item checks, and explicit failure result. The old site does not inherit the mandatory inter-detail two-to-three-second 28Hse delay unless its live robots policy requests a crawl delay, but it must honor any applicable crawl-delay value conservatively. A quarantined or failed old-site detail stays unknown for that source identity.

- [ ] **Step 5: Run all source-layer tests**

Run:

```powershell
node --test src/lib/mls/source-contract.test.mjs src/lib/mls/parse-28hse.test.mjs src/lib/mls/source-adapters.test.mjs
```

Expected: PASS, deterministic pacing assertions included, with zero live HTTP requests.

- [ ] **Step 6: Commit policy and adapter**

```powershell
git add src/lib/mls/access-policy.mjs src/lib/mls/sources/28hse-agent.mjs src/lib/mls/sources/old-site.mjs src/lib/mls/source-adapters.test.mjs src/lib/mls/__fixtures__/28hse/robots-allow.txt src/lib/mls/__fixtures__/28hse/robots-disallow.txt src/lib/mls/__fixtures__/old-site/robots-allow.txt src/lib/mls/__fixtures__/old-site/robots-disallow.txt
git commit -m "feat: add policy-safe 28Hse source adapter"
```

---

### Task 5: Encode Source Health and Publication Modes

**Files:**

- Create: `src/lib/mls/health.mjs`
- Create: `src/lib/mls/health.test.mjs`

**Interfaces:**

- Consumes: `SourceRunResult` objects plus up to seven prior successful count snapshots.
- Produces: deterministic source-health decisions and one run mode: `blocked`, `degraded`, or `full`.

- [ ] **Step 1: Write failing health-gate tests**

Create `src/lib/mls/health.test.mjs` with table-driven coverage:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateRunGate, evaluateSourceHealth, median } from "./health.mjs";

const healthyResult = (source, overrides = {}) => ({
  source,
  identityValid: true,
  robotsAllowed: true,
  paginationComplete: true,
  challengeDetected: false,
  advertisedCounts: { sale: 60, rent: 40 },
  pageCounts: { sale: 3, rent: 2 },
  discovered: 100,
  observations: Array.from({ length: 100 }, (_, index) => ({
    externalId: String(index + 1),
    validationState: index === 99 ? "quarantined" : "valid",
  })),
  failures: [{ externalId: "100", code: "parse_failed", detail: "fixture" }],
  diagnostics: [],
  conflictingDuplicateIds: [],
  ...overrides,
});

test("median is deterministic for odd and even histories", () => {
  assert.equal(median([8, 2, 5]), 5);
  assert.equal(median([2, 4, 6, 8]), 5);
});

test("healthy source requires identity, complete pagination, counts, and 98 percent parsing", () => {
  const decision = evaluateSourceHealth(healthyResult("28hse_agent_540"), {
    previousSuccessful: { sale: 62, rent: 39 },
    rollingCounts: [
      { sale: 61, rent: 40 },
      { sale: 60, rent: 41 },
      { sale: 59, rent: 39 },
    ],
  });
  assert.equal(decision.healthy, true);
  assert.equal(decision.parseRate, 0.99);
});

test("a drop greater than 30 percent fails per deal and combined", () => {
  const decision = evaluateSourceHealth(
    healthyResult("old_site", {
      advertisedCounts: { sale: 20, rent: 40 },
      discovered: 60,
      observations: Array.from({ length: 60 }, (_, index) => ({
        externalId: String(index),
        validationState: "valid",
      })),
      failures: [],
    }),
    {
      previousSuccessful: { sale: 60, rent: 40 },
      rollingCounts: [{ sale: 60, rent: 40 }],
    },
  );
  assert.equal(decision.healthy, false);
  assert.ok(decision.reasons.includes("sale_count_below_floor"));
  assert.ok(decision.reasons.includes("combined_count_below_floor"));
});

test("28Hse failure blocks publication; old-site failure permits no-inactivity degraded mode", () => {
  const ok = { healthy: true, source: "28hse_agent_540" };
  const bad28 = { healthy: false, source: "28hse_agent_540" };
  const badOld = { healthy: false, source: "old_site" };
  assert.equal(evaluateRunGate({ oldSite: badOld, hse28: bad28 }).mode, "blocked");
  assert.deepEqual(
    evaluateRunGate({ oldSite: badOld, hse28: ok }),
    {
      mode: "degraded",
      mayPublishUpserts: true,
      mayAdvanceInactivity: false,
      reasons: ["old_site_unhealthy"],
    },
  );
});
```

Also assert unhealthy results for zero inventory, `identityValid=false`, `robotsAllowed=false`, `paginationComplete=false`, challenge detection, parse rate below 0.98, and any conflicting duplicate ID.

- [ ] **Step 2: Run the health test and verify it fails**

Run:

```powershell
node --test src/lib/mls/health.test.mjs
```

Expected: FAIL because `health.mjs` does not exist.

- [ ] **Step 3: Implement source health**

Implement `median(values)` and:

```js
evaluateSourceHealth(sourceResult, {
  previousSuccessful,
  rollingCounts,
  maximumDropFraction = 0.30,
  minimumParseRate = 0.98,
})
```

For sale, rent, and combined totals, calculate the minimum allowed count as the larger of 70% of the immediately previous successful run and 70% of the rolling median. Use integer-safe comparisons without rounding the observed count upward. A source is healthy only when:

- identity and robots are valid;
- no challenge was detected;
- both deal types completed pagination;
- total inventory is nonzero;
- every per-deal and combined count passes its floor when history exists;
- valid observations divided by discovered IDs is at least 0.98 after the adapter's three attempts;
- every discovered ID has a syntactically valid external ID and deal type;
- missing/invalid property numbers, non-positive deal prices, unexpected templates, and other core validation failures are quarantined and therefore count against the same 2% maximum failure budget;
- no source ID has conflicting property numbers.

When no prior successful history exists, return `baselineRequired: true`. Structural health can still be true for shadow review, but it cannot authorize publishing.

- [ ] **Step 4: Implement combined run modes**

Implement `evaluateRunGate({ oldSite, hse28 })`:

| 28Hse | Old site | Mode | Upserts/reactivation | Inactivity |
|---|---|---|---|---|
| unhealthy | any | `blocked` | no | no |
| healthy | unhealthy | `degraded` | yes | no |
| healthy | healthy | `full` | yes | yes |

Include stable reason codes. Baseline-required results can generate shadow artifacts but return `mayPublishUpserts: false` until operator approval is recorded by the repository.

- [ ] **Step 5: Run the health test**

Run:

```powershell
node --test src/lib/mls/health.test.mjs
```

Expected: PASS for every health and mode permutation.

- [ ] **Step 6: Commit health decisions**

```powershell
git add src/lib/mls/health.mjs src/lib/mls/health.test.mjs
git commit -m "feat: add MLS publication health gates"
```

---

### Task 6: Match Exactly, Reconcile Provenance, and Protect Staff Overrides

**Files:**

- Create: `src/lib/mls/match.mjs`
- Create: `src/lib/mls/reconcile.mjs`
- Create: `src/lib/mls/reconcile.test.mjs`

**Interfaces:**

- Consumes: valid observations, existing canonical rows, source links, `property_sync_fields` state, and `property_sync_state`.
- Produces: exact source groups, quarantines, proposed canonical field values with provenance, and lifecycle transitions.

- [ ] **Step 1: Write failing exact-match tests**

Create `src/lib/mls/reconcile.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { groupExactMatches, matchCanonicalProperty } from "./match.mjs";
import {
  detectStaffOverride,
  nextLifecycleState,
  normalizeCanonicalFieldValue,
  reconcileProperty,
  validateCanonicalProposal,
} from "./reconcile.mjs";

test("deduplicates only exact property number plus deal type", () => {
  const groups = groupExactMatches([
    observation("old_site", "old-1", "C003097", "sale"),
    observation("28hse_agent_540", "3972991", " c 003097 ", "sale"),
    observation("28hse_agent_540", "3976155", "C003097", "rent"),
    observation("28hse_agent_540", "3977000", null, "sale"),
  ]);
  assert.equal(groups.matched.get("sale:C003097").length, 2);
  assert.equal(groups.matched.get("rent:C003097").length, 1);
  assert.equal(groups.quarantined.length, 1);
});

test("multiple canonical candidates are quarantined instead of guessed", () => {
  const outcome = matchCanonicalProperty(
    { matchKey: "sale:C003097" },
    [
      { id: "p1", canonical_property_no: "C003097", deal_type: "sale" },
      { id: "p2", canonical_property_no: "C003097", deal_type: "sale" },
    ],
  );
  assert.equal(outcome.kind, "ambiguous");
  assert.deepEqual(outcome.candidateIds, ["p1", "p2"]);
});

test("staff override wins, then 28Hse, then old site; missing values do not erase", () => {
  const result = reconcileProperty({
    current: { id: "p1", price: 11000000, description: "Staff copy" },
    fieldStates: {
      price: {
        last_published_value: 10000000,
        override_value: null,
        active_override: false,
      },
      description: {
        last_published_value: "Old source copy",
        override_value: "Staff copy",
        active_override: true,
      },
    },
    observations: [
      observation("old_site", "old-1", "C003097", "sale", {
        price: 10500000,
        description: "Old source updated copy",
      }),
      observation("28hse_agent_540", "3972991", "C003097", "sale", {
        price: 10800000,
      }),
    ],
  });
  assert.equal(result.fields.price.value, 11000000);
  assert.equal(result.fields.price.source, "staff_override");
  assert.equal(result.fields.description.value, "Staff copy");
});

test("database numeric strings and reordered feature sets do not create false overrides", () => {
  assert.equal(normalizeCanonicalFieldValue("price", "10000000"), 10000000);
  assert.deepEqual(
    normalizeCanonicalFieldValue("features", ["Sea view", "Balcony", "Sea view"]),
    ["Balcony", "Sea view"],
  );
});

test("a later staff edit refreshes an already-active override", () => {
  const decision = detectStaffOverride(12000000, {
    last_published_value: 10000000,
    override_value: 11000000,
    active_override: true,
  });
  assert.equal(decision.value, 12000000);
  assert.equal(decision.nextState.override_value, 12000000);
  assert.equal(decision.nextState.last_published_value, 10000000);
});

test("degraded days reset absence and two full healthy absences inactivate", () => {
  assert.equal(
    nextLifecycleState({ consecutive: 1, seen: false, mayAdvanceInactivity: false }).consecutive,
    0,
  );
  const once = nextLifecycleState({ consecutive: 0, seen: false, mayAdvanceInactivity: true });
  const twice = nextLifecycleState({
    consecutive: once.consecutive,
    seen: false,
    mayAdvanceInactivity: true,
  });
  assert.equal(once.statusChange, null);
  assert.equal(twice.statusChange, "inactive");
});

test("source estate slug resolves to estate_id and required canonical fields fail closed", () => {
  const resolved = reconcileProperty(reconcileFixture({
    estateIdsBySlug: new Map([["bal-residence", "estate-1"]]),
  }));
  assert.equal(resolved.fields.estate_id.value, "estate-1");
  assert.deepEqual(validateCanonicalProposal({
    ...resolved.canonical,
    title_zh: "",
  }), ["missing_title_zh"]);
});
```

The local `observation(source, externalId, propertyNo, dealType, fields)` test builder must call `createObservation` so normalization is tested through the real contract.

- [ ] **Step 2: Run the reconciliation test and verify it fails**

Run:

```powershell
node --test src/lib/mls/reconcile.test.mjs
```

Expected: FAIL because match and reconciliation modules do not exist.

- [ ] **Step 3: Implement exact grouping and canonical matching**

In `src/lib/mls/match.mjs`:

- `groupExactMatches(observations)` groups only valid observations with non-null `matchKey`.
- Quarantine missing/invalid keys with a stable reason; never fall back to other attributes.
- `matchCanonicalProperty(group, candidates)` requires an exact normalized `canonical_property_no` and `deal_type`. Return exactly one of `existing`, `new`, or `ambiguous`.
- Existing active `property_source_links` can identify the same canonical row, but a link whose current normalized identity conflicts must produce a `link_identity_conflict` quarantine, not an automatic relink.
- Generate a new canonical `listing_no` deterministically as `{propertyNo}-{preferredExternalId}-{S|R}`; preserve the existing `listing_no` on updates.

- [ ] **Step 4: Implement field precedence and automatic override detection**

Define:

```js
export const RECONCILED_FIELDS = Object.freeze([
  "title_zh",
  "title_en",
  "estate_id",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
  "images",
  "status",
]);
```

`detectStaffOverride(currentValue, state)` must:

1. When `active_override=true` and current canonical value still equals `override_value`, return it. If staff changed the canonical value again, refresh `override_value` from current and return the new staff value.
2. When state exists and current canonical value differs from `last_published_value`, activate an override using the current value.
3. During initial backfill, when no field state exists and the current canonical value differs from the newly reconciled source value, preserve the current value as an override.
4. Treat explicit `null` as a possible staff override; do not confuse it with a missing property.

Detected overrides are sticky and are never cleared merely because a later source/current value happens to match. This first implementation reports active and newly detected overrides but does not add an override-management UI or silently reclaim a field; clearing one is a separately approved metadata operation until a reviewed staff workflow is designed.

`last_published_value` means the last automated value written while no override won; during initial bootstrap only, seed it with the reviewed source baseline that the override prevented from being written. Preserve it while an override is active and update only `override_value` when staff edits the protected field again. This separation is required for correct drift detection and a future explicit override-release workflow.

Before reconciliation, resolve each exact source `estate_slug` through a repository-provided `Map<slug, estate_id>`. An unknown slug supplies no `estate_id` and therefore cannot erase a valid old-site/canonical value. Never write a slug into the UUID `properties.estate_id` column.

For each field, `reconcileProperty` selects active staff override, then non-missing valid 28Hse, then non-missing valid old-site value. The 28Hse observation cannot supply `description`. The `images` field uses the same staff-override detection but receives its automated winning value only after Task 7 prepares owned media. Return `{ value, source, observationId, changed, nextFieldState }` per field so publication can persist provenance.

Normalize comparison types before override/change detection: coerce Postgres `NUMERIC` price/rent strings to finite safe numbers; coerce integer fields to integers; trim automated text; deduplicate and sort `features` as a set; preserve `images` order; and compare stable JSON values. Automated empty strings/arrays are missing fallbacks, while a stored staff override may deliberately be null or empty. This prevents driver type differences from creating false staff overrides or change events.

Add `validateCanonicalProposal`. A new proposal is not publishable without non-empty `listing_no`, `title_zh`, `district_slug`, exact `deal_type`, positive `price` for sale or `rent` for rental, valid canonical status, and prepared owned primary image. An update cannot set a required column to null. Return stable quarantine codes rather than letting a database constraint abort the entire otherwise-healthy batch.

For new rows, set `featured=false`, `management_fee=NULL`, `video_url=NULL`, `floorplan_url=NULL`, and `source_site='dual-source-mls'`; set legacy columns only from a linked old-site observation. On updates, leave `featured`, management fee, video, floor plan, and every other non-reconciled staff/admin field untouched.

- [ ] **Step 5: Implement lifecycle transitions**

`nextLifecycleState({ consecutive, seen, mayAdvanceInactivity, currentStatus, hasStatusOverride })` must:

- reset the absence counter to zero when seen;
- reset it to zero on any blocked or degraded day;
- increment only on a full run where the listing is absent from both sources;
- propose `inactive` on the second consecutive qualifying absence;
- propose `active` when a source-linked inactive listing reappears, unless staff has an active status override;
- emit no duplicate transition when status is already correct.

- [ ] **Step 6: Run reconciliation and source-contract tests**

Run:

```powershell
node --test src/lib/mls/source-contract.test.mjs src/lib/mls/reconcile.test.mjs
```

Expected: PASS, including exact sale/rent separation and conservative ambiguity handling.

- [ ] **Step 7: Commit the decision layer**

```powershell
git add src/lib/mls/match.mjs src/lib/mls/reconcile.mjs src/lib/mls/reconcile.test.mjs
git commit -m "feat: reconcile exact MLS identities"
```

---

### Task 7: Share Vercel Blob Storage and Prepare Only Authorized Media

**Files:**

- Create: `src/lib/media/vercel-blob.mjs`
- Create: `src/lib/media/vercel-blob.d.mts`
- Create: `src/lib/media/vercel-blob.test.mjs`
- Modify: `src/routes/api.admin.media.upload.ts`
- Create: `src/routes/api.admin.media.upload.test.mjs`
- Create: `src/lib/mls/media.mjs`
- Create: `src/lib/mls/media.test.mjs`

**Interfaces:**

- Consumes: explicit media-rights attestation, listing-photo candidates, injectable HTTP and blob stores, repository-verified current owned image URLs, and repository hash lookups.
- Produces: content-hash-deduplicated `media_assets` references or listing-level quarantine reasons.

- [ ] **Step 1: Write failing shared-storage and media tests**

Create tests that prove:

```js
test("blob adapter sends the existing token and returns owned URL metadata", async () => {
  const calls = [];
  const store = createVercelBlobStore({
    token: "test-token",
    fetchImpl: recordingBlobFetch(calls),
  });
  const saved = await store.put({
    pathname: "mls/sha256.jpg",
    body: new Uint8Array([0xff, 0xd8, 0xff]),
    contentType: "image/jpeg",
  });
  assert.equal(saved.url, "https://owned.example/mls/sha256.jpg");
  assert.equal(calls[0].headers.authorization, "Bearer test-token");
});

test("rights default false and platform media categories are rejected", async () => {
  const result = await prepareListingMedia({
    rightsConfirmed: false,
    observation: observationWithPhotos(),
    currentImages: [],
    isNew: true,
    fetchImpl: neverCalledFetch,
    repository: fakeMediaRepository(),
    blobStore: fakeBlobStore(),
  });
  assert.equal(result.publishable, false);
  assert.ok(result.reasons.includes("media_rights_not_confirmed"));
});

test("magic bytes, size, and content hash control upload and deduplication", async () => {
  const repository = fakeMediaRepository({
    knownHash: "existing-hash",
    knownAsset: { id: "asset-1", url: "https://owned.example/existing.webp" },
  });
  const result = await prepareListingMedia(mediaFixture({ repository }));
  assert.deepEqual(result.images, ["https://owned.example/existing.webp"]);
  assert.equal(result.uploadCount, 0);
});

test("new listings require a primary; existing listings retain only when no replacement was selected", async () => {
  const missingNew = await prepareListingMedia(mediaFixture({ isNew: true, candidates: [] }));
  const retained = await prepareListingMedia(mediaFixture({
    isNew: false,
    candidates: [],
    currentImages: ["https://owned.example/current.webp"],
  }));
  const failedReplacement = await prepareListingMedia(mediaFixture({
    isNew: false,
    candidates: [selectedReplacementCandidate()],
    currentImages: ["https://owned.example/current.webp"],
    fetchImpl: failingImageFetch,
  }));
  assert.equal(missingNew.publishable, false);
  assert.equal(retained.publishable, true);
  assert.equal(failedReplacement.publishable, false);
});

test("shadow validation never writes to Blob", async () => {
  const result = await prepareListingMedia(mediaFixture({ mode: "validate" }));
  assert.equal(result.publishable, true);
  assert.equal(result.uploadCount, 0);
  assert.equal(result.wouldUploadCount, 1);
});

test("media fetch rejects SSRF targets and cross-host redirects", async () => {
  for (const url of [
    "http://images.28hse.test/photo.jpg",
    "https://127.0.0.1/photo.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://unapproved.example/photo.jpg",
  ]) {
    const result = await prepareListingMedia(mediaFixture({
      candidateUrl: url,
      allowedMediaHosts: ["images.28hse.test"],
    }));
    assert.equal(result.publishable, false);
    assert.ok(result.reasons.includes("unsafe_media_url"));
  }
});
```

Create `src/routes/api.admin.media.upload.test.mjs` as a source contract test that reads the route and asserts it still calls the existing staff-authorization helper, retains `5 * 1024 * 1024`, retains the four accepted MIME types, and delegates storage to `createVercelBlobStore`. This adds coverage without exporting or weakening the route handler.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
node --test src/lib/media/vercel-blob.test.mjs src/lib/mls/media.test.mjs
```

Expected: FAIL because the shared blob and MLS media modules do not exist.

- [ ] **Step 3: Extract the shared Vercel Blob adapter**

Implement `createVercelBlobStore({ token, fetchImpl = fetch })` in `src/lib/media/vercel-blob.mjs`. Validate a non-empty token, encode but do not flatten the supplied pathname, invoke the same Vercel Blob HTTP endpoint and headers currently used by the admin route, and return `{ url, downloadUrl, pathname, contentType, size }`.

Refactor `src/routes/api.admin.media.upload.ts` to call this adapter while preserving:

- the existing staff authorization;
- accepted JPEG, PNG, WebP, and AVIF formats;
- the existing 5 MB limit;
- current response and error shapes.

Run the route's existing tests after the refactor; this task must not alter admin behavior.

- [ ] **Step 4: Implement MLS media validation and preparation**

In `src/lib/mls/media.mjs` implement:

- `detectImageMime(bytes)` using magic bytes for JPEG, PNG, WebP, and AVIF; reject extension-only claims.
- `sha256(bytes)` and a deterministic owned pathname `mls/{first-two-hash-chars}/{hash}.{extension}`.
- A 30-second timeout and 5 MB streaming hard limit: reject an excessive `Content-Length` before reading and stop the stream once accumulated bytes exceed the limit. Add header-based dimension extraction when the format exposes dimensions without a new native dependency. Reject a detected width/height above 12,000 pixels or more than 40 million pixels total; record null dimensions when the supported header cannot expose them safely.
- `prepareListingMedia(input)` that accepts the shared run `AbortSignal`, accepts only candidates already classified `listing_photo`, rechecks URL/context rejection markers, downloads sequentially with the same access-failure rules, hashes before upload, reuses an existing `media_assets.content_hash` match, and records every candidate result. Its explicit `mode` is `validate` for shadow runs and `upload` for publishing. Validation mode performs no Blob write and reports `wouldUploadCount`; upload mode returns owned URLs.

Treat every media URL as untrusted. Require HTTPS, no embedded credentials, no raw IP hostname, and an exact hostname present in operator-reviewed `MLS_MEDIA_ALLOWED_HOSTS`. Resolve hostnames with an injectable `resolveHost` dependency before each request and reject loopback, private, link-local, multicast, and reserved IPv4/IPv6 ranges. Disable automatic redirects; follow at most two redirects only after repeating the full scheme/host/address check. Tests inject fixed public/private address results and perform no DNS. Constrain parsed detail and pagination URLs to their fixed source origin as well. A host allowlist controls network reachability only and must never imply republication rights.

Code must not infer ownership permission from the 28Hse/CDN host. `rightsConfirmed=false` blocks all 28Hse downloads and uploads. A new listing cannot publish without an eligible primary image. An existing listing may retain its already-owned canonical media when no replacement candidate was selected; if reconciliation selected a replacement and preparation fails, quarantine that listing rather than silently retaining the old image.

Treat a current canonical URL as owned only when it has a matching `media_assets.url` row or uses the exact first-party `https://www.earnestproperty.com` origin. Never retain a 28Hse/CDN URL merely because it is already stored in `properties.images`, and do not let a staff image override bypass this invariant.

After upload/reuse, persist `listing_media_records.property_id` when the canonical property already exists. For a new property, keep it null until the atomic publication transaction assigns the new property UUID, then update `listing_media_records.property_id` in that transaction. New sync-created assets use `owner_type='mls-shared'`, `owner_id=NULL`, and `created_by=NULL` because one hash may serve several properties. When reusing an existing admin asset, preserve its owner metadata; the media-record join supplies multi-property provenance.

Do not delete unreferenced media in this project. Blob cleanup needs a separate retention design and authorization.

- [ ] **Step 5: Run media, admin-route, and focused type checks**

Run:

```powershell
node --test src/lib/media/vercel-blob.test.mjs src/lib/mls/media.test.mjs src/routes/api.admin.media.upload.test.mjs
npm.cmd run build:dev
```

Expected: media and route tests PASS; the repository's configured development build completes without a regression attributable to these files.

- [ ] **Step 6: Commit media extraction and preparation**

```powershell
git add src/lib/media/vercel-blob.mjs src/lib/media/vercel-blob.d.mts src/lib/media/vercel-blob.test.mjs src/routes/api.admin.media.upload.ts src/routes/api.admin.media.upload.test.mjs src/lib/mls/media.mjs src/lib/mls/media.test.mjs
git commit -m "feat: prepare authorized MLS media"
```

---

### Task 8: Hold a Dedicated Neon Lock and Persist Run Evidence

**Files:**

- Create: `src/lib/mls/neon-lock.mjs`
- Create: `src/lib/mls/neon-lock.test.mjs`
- Create: `src/lib/mls/sync-repository.mjs`
- Create: `src/lib/mls/sync-repository.d.mts`
- Create: `src/lib/mls/sync-repository.test.mjs`

**Interfaces:**

- Consumes: `DATABASE_URL_UNPOOLED`, standardized observations, source-health snapshots, and an injectable Neon `Client` factory.
- Produces: a session-scoped run lock, durable run ledger/evidence, count history, candidate/provenance reads, and shadow approvals.

- [ ] **Step 1: Write failing advisory-lock tests**

Create `src/lib/mls/neon-lock.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { withMlsAdvisoryLock } from "./neon-lock.mjs";

test("one dedicated session holds and always releases the run lock", async () => {
  const client = fakeClient({ acquired: true });
  const result = await withMlsAdvisoryLock({
    connectionString: "postgres://test",
    createClient: () => client,
    work: async (lockedClient) => {
      assert.equal(lockedClient, client);
      return "done";
    },
  });
  assert.equal(result, "done");
  assert.deepEqual(client.events, ["connect", "lock", "unlock", "end"]);
});

test("missing Node WebSocket support fails before opening a database session", async () => {
  await assert.rejects(
    withMlsAdvisoryLock({
      connectionString: "postgres://test",
      WebSocketImpl: undefined,
      createClient: () => {
        throw new Error("must not construct");
      },
      work: async () => {},
    }),
    /Node 22.15|WebSocket/i,
  );
});

test("lock contention skips work and closes the session", async () => {
  const client = fakeClient({ acquired: false });
  let ran = false;
  const result = await withMlsAdvisoryLock({
    connectionString: "postgres://test",
    createClient: () => client,
    work: async () => {
      ran = true;
    },
  });
  assert.equal(result.kind, "lock_unavailable");
  assert.equal(ran, false);
  assert.deepEqual(client.events, ["connect", "lock", "end"]);
});

test("an exception still unlocks and ends the session", async () => {
  const client = fakeClient({ acquired: true });
  await assert.rejects(
    withMlsAdvisoryLock({
      connectionString: "postgres://test",
      createClient: () => client,
      work: async () => {
        throw new Error("boom");
      },
    }),
    /boom/,
  );
  assert.deepEqual(client.events, ["connect", "lock", "unlock", "end"]);
});

test("client closes even when the explicit unlock query fails", async () => {
  const client = fakeClient({ acquired: true, unlockError: new Error("unlock failed") });
  await assert.rejects(withMlsAdvisoryLock({
    connectionString: "postgres://test",
    createClient: () => client,
    work: async () => "done",
  }), /unlock failed/);
  assert.equal(client.events.at(-1), "end");
});

test("failed connection setup still closes the client", async () => {
  const client = fakeClient({ connectError: new Error("connect failed") });
  await assert.rejects(withMlsAdvisoryLock({
    connectionString: "postgres://test",
    createClient: () => client,
    work: async () => "unreachable",
  }), /connect failed/);
  assert.equal(client.events.at(-1), "end");
});
```

- [ ] **Step 2: Write failing repository behavior tests**

In `src/lib/mls/sync-repository.test.mjs` use a scripted fake query client to assert:

- while the advisory lock is held, `beginRun` first marks any leftover older `running` row `failed` with `orphaned_run_reconciled`, because no legitimate prior publisher can still hold the same lock; it then inserts the new `running` row and returns a UUID;
- `saveObservations` inserts immutable payload, media candidates, hash, validation state, and reasons with `ON CONFLICT ... DO NOTHING`;
- observation payload is versioned and contains normalized `fields`, `rawFields`, `sourceUpdatedAt`, `parseWarnings`, and separate discovery/fetch timestamps;
- `recordRunEvaluation` persists source health, baselines, and counts while status remains `running` so the publication transaction can independently recheck its gate;
- `finishRun` records status, source health, counts, baselines, and failure summary;
- count history includes only source snapshots marked healthy and uses at most the latest successful snapshot per `scheduled_for` date;
- `approveShadowRun(runId, { reviewer, note })` rejects a non-shadow or unhealthy run and records reviewer, redacted note, and timestamp for a healthy shadow run;
- `getApprovedHealthyShadowStreak(beforeDate)` collapses reruns to one approved `shadow_healthy` run per `scheduled_for` date, walks backward across consecutive dates, and returns `{ length, lastDate }`; a gap or degraded/unapproved date ends the streak;
- repository tests prove seven reruns on one date yield streak one and that a missing calendar date resets the later streak;
- candidate lookup normalizes stored `canonical_property_no` or legacy fallback with the same `normalizePropertyNo` function and uses exact deal type;
- `saveProposedLinks` writes only exact links to an existing canonical property with `status='proposed'` during backfill/shadow; ambiguous and not-yet-created properties remain report-only;
- proposed-link upserts never revive a `rejected` link, and publication quarantines any source identity whose stored link is rejected or conflicts with the current exact key;
- current-media ownership lookup returns only exact `media_assets.url` matches; the media module separately recognizes the fixed first-party Earnest origin;
- no method mutates `properties` before the later explicit publication method.

- [ ] **Step 3: Run lock and repository tests and verify they fail**

Run:

```powershell
node --test src/lib/mls/neon-lock.test.mjs src/lib/mls/sync-repository.test.mjs
```

Expected: FAIL because lock and repository modules do not exist.

- [ ] **Step 4: Implement the dedicated advisory lock**

Implement `withMlsAdvisoryLock` using `Client` from `@neondatabase/serverless` by default:

```js
import { Client } from "@neondatabase/serverless";

const LOCK_NAME = "earnestproperty:mls-sync";

export async function withMlsAdvisoryLock({
  connectionString,
  createClient = (config) => new Client(config),
  WebSocketImpl = globalThis.WebSocket,
  work,
}) {
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required");
  if (typeof WebSocketImpl !== "function") {
    throw new Error("Node 22.15+ global WebSocket is required");
  }
  const client = createClient({
    connectionString,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });
  let acquired = false;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [LOCK_NAME],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) return { kind: "lock_unavailable" };
    return await work(client);
  } finally {
    try {
      if (connected && acquired) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
      }
    } finally {
      await client.end();
    }
  }
}
```

The supplied client is the same live session used by the run repository and later publication transaction. Do not replace this with `neon()` HTTP calls: a stateless HTTP query cannot hold a session-level lock across the crawl. Node 22.15+ supplies stable global `WebSocket` support; fail preflight rather than adding `ws` or silently changing transports.

- [ ] **Step 5: Implement the run-evidence repository**

Export `createSyncRepository({ client })` with these methods and exact responsibilities:

```ts
interface SyncRepository {
  beginRun(input: {
    scheduledFor: string;
    mode: "shadow" | "publish";
    parserVersion: string;
  }): Promise<{ runId: string }>;
  saveObservations(runId: string, observations: SourceObservation[]): Promise<PersistedObservationRef[]>;
  getHealthyCountHistory(source: MlsSource, limit?: number): Promise<CountSnapshot[]>;
  recordRunEvaluation(runId: string, evaluation: RunEvaluation): Promise<void>;
  assertLockSession(): Promise<void>;
  finishRun(runId: string, result: RunCompletion): Promise<void>;
  approveShadowRun(runId: string, approval: {
    reviewer: string;
    note?: string;
  }): Promise<void>;
  getApprovedHealthyShadowStreak(beforeDate: string): Promise<{
    length: number;
    lastDate: string | null;
  }>;
  findCanonicalCandidates(matchKeys: string[]): Promise<CanonicalProperty[]>;
  loadSourceLinks(externalIdentities: ExternalIdentity[]): Promise<SourceLink[]>;
  saveProposedLinks(runId: string, links: ProposedSourceLink[]): Promise<void>;
  loadEstateIdsBySlug(slugs: string[]): Promise<Map<string, string>>;
  loadFieldStates(propertyIds: string[]): Promise<PropertySyncField[]>;
  loadLifecycleStates(propertyIds: string[]): Promise<PropertySyncState[]>;
  findMediaByHash(hash: string): Promise<MediaAsset | null>;
  findMediaByUrls(urls: string[]): Promise<MediaAsset[]>;
  registerOwnedMedia(input: OwnedMediaInput): Promise<MediaAsset>;
  saveMediaRecord(input: ListingMediaRecordInput): Promise<void>;
  getLatestRun(): Promise<ListingSyncRun | null>;
}
```

Use parameterized queries only. Chunk observation and match-key writes to bounded batches of at most 200 rows. JSON values must be passed as serialized parameters, not interpolated SQL. `saveObservations` returns repository-originated references for every inserted or already-present immutable observation. Each `PersistedObservationRef` has exactly seven fields: canonical UUID `id`, `source`, `externalId`, `dealType`, `propertyNoNormalized`, `matchKey`, and `contentHash`. Reconciliation must receive those references unchanged as `persistedObservationRefs` and require the complete UUID-to-identity binding for every automated field, prepared media, and legacy provenance. Because the SQL migration cannot perform Unicode NFKC, candidate discovery performs one narrow identity projection (`id, listing_no, canonical_property_no, legacy_property_no, deal_type, updated_at`), normalizes both identifiers in Node, and filters by exact requested keys; it must not load public copy or media columns. Publishing writes the normalized value back to `canonical_property_no`. Run evidence and proposed links are written outside the canonical publication transaction so a blocked or failed publication retains diagnostic observations without changing public fields.

`registerOwnedMedia` must handle an admin upload racing the synchronizer: insert against the partial content-hash unique index with conflict-safe semantics, then select and return the winning asset. Never overwrite its existing URL or owner metadata on conflict.
`assertLockSession` issues a lightweight query on the same dedicated client. Call it immediately before any publish-mode Blob upload and again at transaction start; a dead session means the advisory lock was lost, so fail without canonical publication.

- [ ] **Step 6: Run lock and repository tests**

Run:

```powershell
node --test src/lib/mls/neon-lock.test.mjs src/lib/mls/sync-repository.test.mjs
```

Expected: PASS, including unlock-on-error and approval validation.

- [ ] **Step 7: Commit locking and evidence persistence**

```powershell
git add src/lib/mls/neon-lock.mjs src/lib/mls/neon-lock.test.mjs src/lib/mls/sync-repository.mjs src/lib/mls/sync-repository.d.mts src/lib/mls/sync-repository.test.mjs
git commit -m "feat: persist locked MLS run evidence"
```

---

### Task 9: Publish Canonical Changes in One Serializable Transaction

**Files:**

- Modify: `src/lib/mls/sync-repository.mjs`
- Modify: `src/lib/mls/sync-repository.d.mts`
- Modify: `src/lib/mls/sync-repository.test.mjs`
- Create: `src/lib/mls/mls-db.integration.test.mjs`

**Interfaces:**

- Consumes: a health-approved publication batch containing canonical proposals, exact source links, field provenance, lifecycle changes, and expected row versions.
- Produces: atomic updates to `properties` and all synchronization side tables, or a complete rollback with no partially public state.

- [ ] **Step 1: Write failing publication transaction tests**

Extend `src/lib/mls/sync-repository.test.mjs` with a stateful fake client:

```js
test("publish requires mode, environment gate, and a seven-date approved streak", async () => {
  const repository = createSyncRepository({ client: fakeClient({ approvedShadowStreak: 6 }) });
  await assert.rejects(
    repository.publishBatch({
      runId: "run-1",
      mode: "publish",
      publishEnabled: true,
      proposals: [],
    }),
    /seven approved healthy shadow runs/i,
  );
  await assert.rejects(
    repository.publishBatch({
      runId: "run-1",
      mode: "shadow",
      publishEnabled: true,
      proposals: [],
    }),
    /publish mode/i,
  );
});

test("canonical, link, field, lifecycle, and event writes share one transaction", async () => {
  const client = fakePublicationClient({ approvedShadowStreak: 7 });
  const repository = createSyncRepository({ client });
  await repository.publishBatch(approvedBatch());
  assert.equal(client.events[0], "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.equal(client.events.at(-1), "COMMIT");
  for (const table of [
    "properties",
    "property_source_links",
    "property_sync_fields",
    "property_sync_state",
    "listing_change_events",
  ]) {
    assert.ok(client.sql.some((statement) => statement.includes(table)), table);
  }
});

test("row-version conflict or any write failure rolls back everything", async () => {
  const client = fakePublicationClient({ updatedAtConflict: true, approvedShadowStreak: 7 });
  const repository = createSyncRepository({ client });
  await assert.rejects(repository.publishBatch(approvedBatch()), /publication conflict/i);
  assert.equal(client.events.at(-1), "ROLLBACK");
  assert.equal(client.events.includes("COMMIT"), false);
});
```

Add idempotency coverage: publishing an unchanged proposal must create no `listing_change_events` row and must not update `properties.updated_at`.

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```powershell
node --test src/lib/mls/sync-repository.test.mjs
```

Expected: FAIL because `publishBatch` is not implemented.

- [ ] **Step 3: Add the publication batch contract**

Add this method to `SyncRepository`:

```ts
publishBatch(input: {
  runId: string;
  mode: "shadow" | "publish";
  publishEnabled: boolean;
  proposals: Array<{
    kind: "new" | "update";
    propertyId?: string;
    expectedUpdatedAt?: string;
    canonical: CanonicalPropertyWrite;
    links: SourceLinkWrite[];
    fields: ReconciledFieldWrite[];
    lifecycle: PropertySyncStateWrite;
    events: ListingChangeEventWrite[];
  }>;
}): Promise<{ inserted: number; updated: number; events: number }>;
```

The repository, not only the CLI, enforces:

1. `mode === "publish"`;
2. `publishEnabled === true`;
3. the run exists, is still `running`, and its already-persisted 28Hse evaluation is healthy;
4. an approved healthy shadow streak of at least seven consecutive `scheduled_for` dates, whose approval timestamps predate the publish run and whose last date is the publish run's Hong Kong date or the immediately preceding date.

- [ ] **Step 4: Implement serializable publication**

Within one `try/catch/finally`:

1. Verify the dedicated session is alive, then run `BEGIN ISOLATION LEVEL SERIALIZABLE` on that same client.
2. Recheck the run and shadow gates inside the transaction.
3. For updates, `SELECT id, updated_at FROM properties WHERE id = $1 FOR UPDATE` and compare with `expectedUpdatedAt`. Throw `PublicationConflictError` on a mismatch.
4. Insert new or update changed canonical `properties` rows. Populate `canonical_property_no` but do not overwrite `legacy_detail_id` with 28Hse identity.
5. Upsert exact `property_source_links` as `active`, preserving the earliest observation `first_seen_at` and advancing `last_seen_at`/`last_seen_run_id` only from an observation whose source passed health for this run.
6. Upsert every `property_sync_fields` entry, including newly detected staff overrides and the winning observation ID.
7. Upsert `property_sync_state`. A degraded plan must contain counter zero and no inactivity event.
8. Attach prepared `listing_media_records.property_id` to the canonical UUID without changing owner metadata on a hash-shared `media_assets` row.
9. Insert only real `listing_change_events`; unchanged fields and repeated lifecycle states create none.
10. Commit.
11. On any exception, issue `ROLLBACK` and rethrow a stable typed error.

Sort proposals by existing property UUID or deterministic new `listing_no` before locking rows. This provides a consistent lock order if another staff process updates properties concurrently. Do not wrap the multi-minute crawl or media downloads in this transaction.

- [ ] **Step 5: Add an opt-in disposable-database integration test**

Create `src/lib/mls/mls-db.integration.test.mjs`. Register the test with `skip: !process.env.DATABASE_URL_TEST`. When present, require `MLS_TEST_DATABASE_CONFIRMED=true` and compare parsed username, hostname, port, and database path against `DATABASE_URL_UNPOOLED`; fail if they identify the same target even when query parameters differ. Using UUIDs generated inside the test, insert one run and canonical fixture, publish one batch, and assert the exact canonical value plus rows in `property_source_links`, `property_sync_fields`, `property_sync_state`, `listing_media_records`, and `listing_change_events`. Capture the row counts, provoke an `expectedUpdatedAt` conflict, assert `PublicationConflictError`, then assert every captured count and canonical value is unchanged. Finally delete only the test-owned run/property rows in foreign-key-safe order.

The test never applies migrations itself: the explicitly approved disposable branch must already be migrated. It owns and cleans only rows tagged with its generated UUIDs. Never point it at production.

- [ ] **Step 6: Run repository tests; run DB integration only when authorized**

Always run:

```powershell
node --test src/lib/mls/sync-repository.test.mjs
```

Expected: PASS.

Only with an explicitly approved disposable Neon test branch:

```powershell
node --test src/lib/mls/mls-db.integration.test.mjs
```

Expected: PASS against the disposable database. Otherwise report the integration test as SKIPPED, not passed.

- [ ] **Step 7: Commit atomic publication**

```powershell
git add src/lib/mls/sync-repository.mjs src/lib/mls/sync-repository.d.mts src/lib/mls/sync-repository.test.mjs src/lib/mls/mls-db.integration.test.mjs
git commit -m "feat: publish MLS changes atomically"
```

---

### Task 10: Orchestrate One Evidence-First Dual-Source Run

**Files:**

- Create: `src/lib/mls/orchestrator.mjs`
- Create: `src/lib/mls/orchestrator.d.mts`
- Create: `src/lib/mls/orchestrator.test.mjs`

**Interfaces:**

- Consumes: already-locked repository session, both adapters, health/match/reconcile/media modules, mode, publish flag, clock, and parser version.
- Produces: one complete run result and publication plan; observations are durable before any canonical write is considered.

- [ ] **Step 1: Write failing end-to-end orchestration tests with fakes**

Create `src/lib/mls/orchestrator.test.mjs` with no network or database dependencies:

```js
test("unhealthy 28Hse persists evidence and blocks every canonical write", async () => {
  const harness = syncHarness({
    hse28: unhealthy28HseResult("challenge_detected"),
    oldSite: healthyOldSiteResult(),
    mode: "publish",
    publishEnabled: true,
  });
  const result = await harness.run();
  assert.equal(result.mode, "blocked");
  assert.equal(harness.repository.savedObservations.length > 0, true);
  assert.equal(harness.repository.publishCalls.length, 0);
});

test("degraded old site allows safe 28Hse upserts but resets inactivity", async () => {
  const harness = syncHarness({
    hse28: healthy28HseResult(),
    oldSite: unhealthyOldSiteResult(),
    mode: "publish",
    publishEnabled: true,
  });
  const result = await harness.run();
  assert.equal(result.mode, "degraded");
  assert.ok(result.proposals.every((proposal) => proposal.lifecycle.consecutive === 0));
  assert.equal(result.proposals.some((proposal) =>
    proposal.events.some((event) => event.changeType === "inactive")), false);
});

test("two full healthy absences inactivate once and reappearance reactivates", async () => {
  const dayOne = await syncHarness(fullHealthyAbsence({ consecutive: 0 })).run();
  const dayTwo = await syncHarness(fullHealthyAbsence({ consecutive: 1 })).run();
  const returned = await syncHarness(fullHealthyReappearance({ currentStatus: "inactive" })).run();
  assert.equal(dayOne.events.some((event) => event.changeType === "inactive"), false);
  assert.equal(dayTwo.events.filter((event) => event.changeType === "inactive").length, 1);
  assert.equal(returned.events.filter((event) => event.changeType === "reactivated").length, 1);
});

test("exact duplicate sources yield one canonical proposal and ambiguity yields none", async () => {
  const result = await syncHarness(exactAndAmbiguousFixtures()).run();
  assert.equal(result.proposals.filter((proposal) => proposal.matchKey === "sale:C003097").length, 1);
  assert.ok(result.quarantines.some((item) => item.reason === "ambiguous_canonical_match"));
});

test("a media failure quarantines one listing without discarding the healthy batch", async () => {
  const result = await syncHarness(oneMediaFailureFixture()).run();
  assert.equal(result.quarantines.filter((item) => item.reason === "no_eligible_primary_image").length, 1);
  assert.equal(result.proposals.length > 0, true);
});

test("a linked quarantined detail is unknown and breaks the absence sequence", async () => {
  const result = await syncHarness(linkedQuarantinedObservation({ consecutive: 1 })).run();
  assert.equal(result.proposals[0].lifecycle.consecutive, 0);
  assert.equal(result.events.some((event) => event.changeType === "inactive"), false);
});

test("an unchanged rerun produces no property update or duplicate event", async () => {
  const harness = syncHarness(unchangedFixture());
  const result = await harness.run();
  assert.equal(result.events.length, 0);
  assert.equal(result.proposals.every((proposal) => proposal.hasCanonicalChange === false), true);
});
```

Also cover adapter exceptions, observation-save failure, publication rollback propagation, shadow mode with zero public writes, and `media mode = validate` in shadow versus `upload` in publish.

- [ ] **Step 2: Run the orchestrator test and verify it fails**

Run:

```powershell
node --test src/lib/mls/orchestrator.test.mjs
```

Expected: FAIL because the orchestrator does not exist.

- [ ] **Step 3: Define the orchestration entry point**

Export:

```ts
runDualSourceSync(input: {
  scheduledFor: string;
  mode: "shadow" | "publish";
  publishEnabled: boolean;
  mediaRightsConfirmed: boolean;
  parserVersion: string;
  adapters: {
    oldSite: { collect(): Promise<SourceRunResult> };
    hse28: { collect(): Promise<SourceRunResult> };
  };
  repository: SyncRepository;
  media: MediaPreparer;
  reporter: RunReporter;
  signal: AbortSignal;
  now: () => Date;
}): Promise<SyncRunResult>;
```

Require the CLI to call this only inside `withMlsAdvisoryLock`. Do not open another database session from the orchestrator.

- [ ] **Step 4: Implement the evidence-first sequence**

The exact sequence is:

1. `beginRun` before fetching either source.
2. Collect both adapters with `Promise.allSettled` so one unexpected exception becomes an explicit unhealthy source result and does not erase the other source's evidence.
3. `saveObservations` for both results before health evaluation or reconciliation.
4. Load the prior successful and seven-run rolling counts for each source.
5. Evaluate both source-health decisions and the combined run mode.
6. Persist that decision with `recordRunEvaluation` before any reconciliation, media, or canonical transaction.
7. If blocked, build no canonical proposal and finish `blocked`. In publish mode, also check `publishEnabled` and the seven-consecutive-date approved shadow streak before media; fail closed with no Blob writes when readiness is missing. The transaction rechecks these gates later.
8. In degraded mode, reconcile only healthy 28Hse observations against existing canonical/state values. Do not consume partial current-run old-site values and reset every evaluated absence counter.
9. In full mode, group both sources by exact match key, load candidates/links/field/lifecycle state and estate slug-to-ID mappings in bounded batches, and reconcile fields and absences.
10. Build per-property `seen`, `absent`, and `unknown` states from active source links. A quarantined/failed detail for a linked external identity is `unknown`, not absent, and resets the consecutive counter because that listing was not eligible for comparison.
11. Quarantine missing identity, unknown estate mapping for a required new record, ambiguous candidates, link conflicts, canonical invariant failures, and listing-level media failure independently. They remain in reports but cannot publish.
12. Save exact proposed links to existing canonical rows as `status='proposed'` during shadow/backfill. Missing and ambiguous matches remain report-only; no public property field changes.
13. Immediately before publish-mode media, call `assertLockSession`, then prepare media with `mode: "validate"` in shadow and `mode: "upload"` in publish.
14. In shadow, never call `publishBatch`. Build a `shadow_healthy` result only when source health passes and no run-level gate is blocked; listing quarantines remain visible for manual approval.
15. In publish, call `publishBatch` once with all publishable proposals and build a `healthy` or `degraded` result only after commit succeeds.
16. Call the injected `reporter.writeRunArtifacts` with the complete proposed final result, then call `finishRun`. Tests use a fake reporter until Task 11 supplies the filesystem implementation.
17. On an unexpected exception, build a redacted minimal failure result, attempt the reporter when possible, then attempt `finishRun(runId, failureCompletion)` and rethrow. If artifact writing fails after a canonical commit, record/log `artifact_write_failed_after_publish` explicitly; do not claim the transaction rolled back. Never include credentials, HTML bodies, or SQL parameters in the summary.

Return counts for discovered, parsed, quarantined, exact groups, new, changed, inactive, reactivated, retained override fields, existing media reused, media validated/uploaded/rejected, and source failures.

- [ ] **Step 5: Run orchestrator and all pure decision tests**

Run:

```powershell
node --test src/lib/mls/health.test.mjs src/lib/mls/reconcile.test.mjs src/lib/mls/media.test.mjs src/lib/mls/orchestrator.test.mjs
```

Expected: PASS for blocked, degraded, full, shadow, publish, failure, and idempotent paths.

- [ ] **Step 6: Commit the orchestrator**

```powershell
git add src/lib/mls/orchestrator.mjs src/lib/mls/orchestrator.d.mts src/lib/mls/orchestrator.test.mjs
git commit -m "feat: orchestrate dual-source MLS runs"
```

---

### Task 11: Add Safe Reports, CLI Commands, Configuration, and Retention

**Files:**

- Create: `src/lib/mls/reporting.mjs`
- Create: `src/lib/mls/reporting.test.mjs`
- Create: `scripts/mls/sync.mjs`
- Create: `scripts/mls/approve-baseline.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `SyncRunResult`, environment configuration, filesystem artifact root, and the locked orchestration entry point.
- Produces: redacted JSON logs, JSON/CSV artifacts, deterministic process exit codes, an explicit shadow-approval command, and safe 90-day local retention.

- [ ] **Step 1: Write failing reporting and retention tests**

Create `src/lib/mls/reporting.test.mjs`:

```js
test("report artifacts contain provenance and decisions but no raw HTML or secrets", async () => {
  const root = await makeTemporaryArtifactRoot();
  const paths = await writeRunArtifacts({
    root,
    run: reportFixture(),
  });
  const json = JSON.parse(await readFile(paths.json, "utf8"));
  const csv = await readFile(paths.listingsCsv, "utf8");
  const observationsCsv = await readFile(paths.observationsCsv, "utf8");
  const diagnostics = JSON.parse(await readFile(paths.diagnostics, "utf8"));
  assert.equal(json.runId, "run-1");
  assert.match(csv, /source,external_id,deal_type,property_no,match_key,decision/);
  assert.match(observationsCsv, /title_zh,estate_slug,district_slug,address,price,rent/);
  assert.doesNotMatch(observationsCsv, /view_count|mortgage|school|transport|editorial/i);
  assert.doesNotMatch(JSON.stringify({ json, diagnostics }), /test-token|postgres:|<html/i);
  assert.equal(toCsvCell("=1+1"), "'=1+1");
});

test("retention removes only old run directories beneath the configured root", async () => {
  const fixture = await retentionFixture();
  const result = await pruneArtifacts({
    root: fixture.root,
    now: new Date("2026-08-17T02:00:00.000Z"),
    retentionDays: 90,
  });
  assert.deepEqual(result.removed, [fixture.oldRun]);
  assert.equal(await exists(fixture.recentRun), true);
  assert.equal(await exists(fixture.outsideSentinel), true);
});

test("retention rejects broad roots, traversal, and symlinks", async () => {
  await assert.rejects(() => pruneArtifacts({ root: "/", retentionDays: 90 }), /unsafe artifact root/i);
  await assert.rejects(() => pruneArtifacts(symlinkEscapeFixture()), /symlink|outside artifact root/i);
});
```

Add a second test in `src/lib/mls/reporting.test.mjs` that reads `scripts/mls/sync.mjs` and verifies the mode and environment flags are both passed to the repository, secrets are never logged, and the advisory lock wraps `runDualSourceSync`.

- [ ] **Step 2: Run the reporting tests and verify they fail**

Run:

```powershell
node --test src/lib/mls/reporting.test.mjs
```

Expected: FAIL because reporting does not exist.

- [ ] **Step 3: Implement redacted JSON and CSV reporting**

`writeRunArtifacts({ root, run })` must create:

```text
{resolved-root}/{YYYY-MM-DD}/{run-id}/report.json
{resolved-root}/{YYYY-MM-DD}/{run-id}/listings.csv
{resolved-root}/{YYYY-MM-DD}/{run-id}/observations.csv
{resolved-root}/{YYYY-MM-DD}/{run-id}/diagnostics.json
```

`report.json` contains run metadata, source health/reasons, baselines, counts, quarantines, change events, and media outcomes. `diagnostics.json` contains response status, retry count, template fingerprint, selector counts, failure codes, and redacted source URL for failed or changed templates. Raw diagnostic HTML is disabled in this implementation because retention permission has not been established; adding it later requires a separate content/privacy review.

The `listings.csv` decision header is exactly:

```text
source,external_id,deal_type,property_no,match_key,canonical_property_id,decision,changed_fields,quarantine_reasons,content_hash,source_url
```

The `observations.csv` normalized-content header is exactly:

```text
source,external_id,deal_type,property_no,title_zh,title_en,estate_slug,district_slug,address,price,rent,saleable_area,gross_area,bedrooms,bathrooms,floor,orientation,features,description,eligible_media_count,source_updated_at,validation_state,quarantine_reasons,content_hash,source_url
```

Only allowlisted normalized listing facts enter `observations.csv`. Do not include raw platform modules, `rawFields`, descriptions from 28Hse, media query tokens, or engagement data.

Export `toCsvCell` for direct tests. Escape CSV fields according to RFC 4180 and prefix text beginning with `=`, `+`, `-`, `@`, tab, or carriage return with a single quote to prevent spreadsheet formula injection; JSON retains the exact value. Do not write raw HTML, downloaded media bytes, database URLs, authorization headers, environment values, or Blob tokens. Log one JSON object per line to stdout with `timestamp`, `level`, `event`, `runId`, `source`, `code`, and numeric counts only.

Write each artifact to a uniquely named temporary file inside the final run directory, flush and close it, then atomically rename it to the final name. On failure, remove only those run-local temporary files after the same containment/symlink checks; never expose a partially written final report.

- [ ] **Step 4: Implement safe 90-day pruning**

`pruneArtifacts` must resolve the configured root once, reject filesystem roots and the repository/workspace root, use `lstat` to reject symlinked date/run directories, accept only `YYYY-MM-DD/{UUID}` descendants, and verify `path.relative(root, target)` neither begins with `..` nor becomes absolute before recursive removal. Unit tests must use an OS temporary directory; production artifacts are never touched by tests.

- [ ] **Step 5: Implement the locked synchronization CLI**

In `scripts/mls/sync.mjs`:

1. Load existing `.env` and `.env.local` files with Node's environment-file API only when present, without overriding already supplied process variables.
2. Parse exactly `--mode=shadow` or `--mode=publish`; default to shadow.
3. Validate `DATABASE_URL_UNPOOLED` and `MLS_CRAWLER_CONTACT_URL`. Require a non-empty, syntactically valid `MLS_MEDIA_ALLOWED_HOSTS` before any media validation/download; validate `BLOB_READ_WRITE_TOKEN` only when upload mode can be reached.
4. Treat only the literal string `true` as enabled for `MLS_PUBLISH_ENABLED` and `MLS_MEDIA_RIGHTS_CONFIRMED`. If `--mode=publish` is requested while the publication flag is not true, exit 30 before acquiring the lock or making network requests; operators use `mls:shadow` for evidence collection.
5. Construct both adapters, repository, media preparer, and filesystem reporter, then call `runDualSourceSync` only inside `withMlsAdvisoryLock`. The orchestrator writes artifacts before final run status.
6. Preserve the returned artifact paths for blocked/degraded/failed runs when a run ID exists; run pruning after artifact creation.
7. Never print configuration values. Log only presence booleans and stable error codes.

Derive `scheduledFor` with `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)` and explicitly compose `YYYY-MM-DD` rather than trusting the VPS timezone or locale formatting. Store timestamps as UTC ISO strings.
Pass the exported `MLS_PARSER_VERSION` to every run and persist `OBSERVATION_SCHEMA_VERSION` inside each observation payload; do not use an untracked environment string as the parser version.

Install one-shot `SIGINT`/`SIGTERM` handlers that abort the shared run `AbortController`, let the orchestrator record a safe `process_interrupted` failure when possible, and unwind through the advisory-lock `finally` block. A second signal may terminate immediately; the next locked run reconciles any leftover `running` row.

Use these process exit codes:

| Code | Meaning |
|---:|---|
| `0` | healthy full or healthy shadow |
| `2` | completed degraded run |
| `20` | source-health publication block |
| `30` | invalid/missing configuration |
| `40` | database, atomic-publication, or artifact-persistence failure |
| `75` | advisory lock unavailable |

- [ ] **Step 6: Implement explicit healthy-shadow approval**

`scripts/mls/approve-baseline.mjs --run={UUID} --reviewer={operator-id} [--note={short-note}]` must:

- require `DATABASE_URL_UNPOOLED`;
- validate the UUID syntax;
- require a non-empty reviewer identifier and cap the optional redacted note at 200 characters;
- show only the run ID, timestamp, source counts, health reasons, and artifact location;
- call `approveShadowRun` only for a completed `shadow_healthy` run and persist reviewer, note, and approval time;
- never approve a run automatically from the daily CLI.

Approval is immutable: update only when `baseline_approved_at IS NULL` and reject attempts to overwrite reviewer or note.

Invoking this command writes an approval timestamp to Neon and therefore requires operator intent each time. Seven distinct healthy shadow runs must be reviewed and approved before publication.

- [ ] **Step 7: Update scripts and explicit configuration map**

Merge these keys into the existing `package.json scripts` object. Preserve every unrelated script and preserve `mls:import`; do not replace the full scripts object with this excerpt:

```json
{
  "scripts": {
    "mls:legacy-sync": "node scripts/old-site-migration/import.mjs --max=200",
    "mls:shadow": "node scripts/mls/sync.mjs --mode=shadow",
    "mls:sync": "node scripts/mls/sync.mjs --mode=publish",
    "mls:approve-baseline": "node scripts/mls/approve-baseline.mjs",
    "test:mls": "node --test src/lib/mls/mls-fixtures.test.mjs src/lib/mls/mls-schema.test.mjs src/lib/mls/source-contract.test.mjs src/lib/mls/parse-28hse.test.mjs src/lib/mls/source-adapters.test.mjs src/lib/mls/health.test.mjs src/lib/mls/reconcile.test.mjs src/lib/mls/neon-lock.test.mjs src/lib/mls/sync-repository.test.mjs src/lib/mls/media.test.mjs src/lib/mls/orchestrator.test.mjs src/lib/mls/reporting.test.mjs src/lib/media/vercel-blob.test.mjs src/routes/api.admin.media.upload.test.mjs",
    "test:mls:db": "node --test src/lib/mls/mls-db.integration.test.mjs"
  }
}
```

Add this documented server-only map to `.env.example`:

```dotenv
# --- VPS dual-source MLS synchronization ---
# Neon dashboard -> direct/unpooled connection string for the VPS only.
DATABASE_URL_UNPOOLED=""
# Vercel Blob project store -> read/write token; required only for publish uploads.
BLOB_READ_WRITE_TOKEN=""
# Public operator/contact page included in the honest crawler user agent.
MLS_CRAWLER_CONTACT_URL=""
# Double publication gate. Keep false through all shadow runs.
MLS_PUBLISH_ENABLED="false"
# Operator attestation that 28Hse listing photos are Earnest-owned/authorized.
MLS_MEDIA_RIGHTS_CONFIRMED="false"
# Comma-separated exact HTTPS media hostnames reviewed for outbound access.
# This network allowlist does not grant content rights.
MLS_MEDIA_ALLOWED_HOSTS=""
# Absolute VPS path recommended: /var/lib/earnestproperty/mls-sync
MLS_ARTIFACT_DIR="artifacts/mls-sync"
```

Add `artifacts/mls-sync/` to `.gitignore`. Do not add example secrets, production URLs, or database identifiers.

- [ ] **Step 8: Run CLI/reporting tests and package scripts**

Run:

```powershell
node --test src/lib/mls/reporting.test.mjs src/lib/mls/orchestrator.test.mjs
npm.cmd run test:mls
```

Expected: PASS with fixture-only collection, temporary artifact directories, no database, and no live HTTP.

- [ ] **Step 9: Commit the operator CLI**

```powershell
git add src/lib/mls/reporting.mjs src/lib/mls/reporting.test.mjs scripts/mls/sync.mjs scripts/mls/approve-baseline.mjs package.json .env.example .gitignore
git commit -m "feat: add VPS MLS synchronization commands"
```

---

### Task 12: Cut Over Scheduling to the VPS and Make Vercel Status-Only

**Files:**

- Modify: `src/lib/mls/neon-db.mjs`
- Modify: `src/lib/mls/neon-db.d.mts`
- Modify: `src/routes/api.mls-sync.ts`
- Modify: `src/routes/api.mls-sync.test.mjs`
- Modify: `vercel.ts`
- Create: `ops/systemd/earnest-mls-sync.service`
- Create: `ops/systemd/earnest-mls-sync.timer`
- Create: `src/lib/mls/ops-contract.test.mjs`
- Replace: `docs/mls-production-activation.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: the latest `listing_sync_runs` row and existing `CRON_SECRET` authorization.
- Produces: a protected read-only status route, one 02:00 Hong Kong VPS timer, and an explicit migration/shadow/cutover/rollback runbook.

- [ ] **Step 1: Rewrite the route and scheduling tests first**

Update `src/routes/api.mls-sync.test.mjs` to require:

```js
test("mls route is protected and read-only", () => {
  assert.match(source, /authorization/i);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /status:\s*401/);
  assert.match(source, /getLatestSyncRun/);
  assert.doesNotMatch(source, /createMlsImporter|\.sync\s*\(/);
});

test("Vercel no longer schedules MLS but retains control-plane safety crons", () => {
  assert.doesNotMatch(vercel, /\/api\/mls-sync/);
  assert.match(vercel, /\/api\/admin\/control-plane\/worker/);
  assert.match(vercel, /\/api\/admin\/jobs\/send-queue/);
});
```

Retain the existing once-per-day Vercel validation and Cloudflare job-drain tests.

Create `src/lib/mls/ops-contract.test.mjs` to read the systemd units and runbook and assert:

- timer schedule contains `02:00:00 Asia/Hong_Kong` and `Persistent=true`;
- service uses `User=earnest-mls`, `WorkingDirectory=/opt/earnestproperty/current`, `EnvironmentFile=/etc/earnestproperty/mls-sync.env`, and `npm run mls:sync`;
- writable scope is limited to `/var/lib/earnestproperty/mls-sync`;
- runbook contains migration, seven healthy shadows, seven monitored live runs, double publication gate, status verification, and rollback sections;
- neither unit contains credential values.

- [ ] **Step 2: Run cron/ops tests and verify they fail**

Run:

```powershell
npm.cmd run test:cron
node --test src/lib/mls/ops-contract.test.mjs
```

Expected: FAIL because Vercel still schedules the publisher and the VPS units do not exist.

- [ ] **Step 3: Add a read-only latest-run query and status route**

Add `getLatestSyncRun()` to `createNeonMlsDb`. It issues one parameter-free select from `listing_sync_runs` ordered by `started_at DESC LIMIT 1` and returns only:

```ts
{
  id: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
  mode: "shadow" | "publish";
  status: string;
  sourceStatus: unknown;
  counts: unknown;
  failureCode: string | null;
  failureSummary: string | null;
} | null
```

Change `GET /api/mls-sync` to:

1. Require `Authorization: Bearer {CRON_SECRET}` with constant-time-safe exact comparison where practical.
2. Return 503 when `CRON_SECRET` or `DATABASE_URL` is absent.
3. Call only `getLatestSyncRun()`.
4. Return `{ ok: true, publisher: "vps", latestRun }`.
5. Never discover, fetch, reconcile, upload, or publish.

Do not add a mutation method. Keep public listing pages reading canonical `properties` as before.

- [ ] **Step 4: Remove only the Vercel MLS cron**

Delete `{ path: "/api/mls-sync", schedule: "0 20 * * *" }` from `vercel.ts`. Retain the control-plane and send-queue fallback crons and update the surrounding comment from three daily entries to two. Do not add MLS scheduling to the Cloudflare worker.

- [ ] **Step 5: Add hardened non-secret systemd templates**

Create `ops/systemd/earnest-mls-sync.service`:

```ini
[Unit]
Description=Earnest Property dual-source MLS synchronization
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=earnest-mls
Group=earnest-mls
WorkingDirectory=/opt/earnestproperty/current
EnvironmentFile=/etc/earnestproperty/mls-sync.env
ExecStart=/usr/bin/npm run mls:sync
TimeoutStartSec=4h
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/earnestproperty/mls-sync

[Install]
WantedBy=multi-user.target
```

Create `ops/systemd/earnest-mls-sync.timer`:

```ini
[Unit]
Description=Run Earnest MLS synchronization daily at 02:00 Hong Kong time

[Timer]
OnCalendar=*-*-* 02:00:00 Asia/Hong_Kong
Persistent=true
Unit=earnest-mls-sync.service

[Install]
WantedBy=timers.target
```

The runbook must require the operator to verify the actual `node`/`npm` paths and adjust `ExecStart` before installation if the VPS differs. Do not install, enable, or start these units in this task.

- [ ] **Step 6: Replace the production activation runbook**

`docs/mls-production-activation.md` must contain these concrete sections:

1. **Credential/source map** — `DATABASE_URL_UNPOOLED` from the Neon direct connection panel; `BLOB_READ_WRITE_TOKEN` from the project's Vercel Blob store; `CRON_SECRET` retained on Vercel for status and other protected cron routes; `MLS_CRAWLER_CONTACT_URL` is public; both boolean gates begin false.
2. **Preflight** — record owner authorization for the selected content and platform access, then verify VPS user/directories, Node 22.15+, `typeof WebSocket === "function"`, repository commit, DNS/HTTPS egress, artifact permissions, clock/timezone, and that no secret appears in shell history or unit files. Before installing the timer, run `systemd-analyze calendar '*-*-* 02:00:00 Asia/Hong_Kong'` and record that its next elapse is 02:00 Hong Kong time on that VPS.
3. **Migration approval gate** — review and separately authorize applying `20260817120000_dual_source_listing_sync.sql`. Record migration output without connection strings.
4. **Observation backfill and seven daily shadow runs** — the first shadow persists immutable observations and exact proposed links to existing canonical rows without changing public fields. Before a shadow counts toward cutover, record the owner's media-rights confirmation, review `MLS_MEDIA_ALLOWED_HOSTS`, set only `MLS_MEDIA_RIGHTS_CONFIRMED=true`, and keep publication false. For every shadow, invoke `npm run mls:shadow`, review JSON/CSV/diagnostics, compare both deal counts, inspect ambiguity/conflict/quarantine/media outcomes, and invoke `npm run mls:approve-baseline -- --run={UUID} --reviewer={operator-id}` only after each acceptable run. Parsing-only runs performed while rights remain unconfirmed do not prove media readiness and do not count toward the seven.
5. **Cutover approval gate** — deploy the release that removes the Vercel MLS cron, verify Vercel's remaining crons, install but do not yet start the timer, and keep the publication flag false pending the first-publish approval.
6. **First publish** — start the service manually once, inspect status/artifacts/public samples, and enable the timer only after acceptance.
7. **Seven monitored live runs** — verify one canonical property per exact identity, changes, reactivations, and two-run inactivity behavior daily.
8. **Rollback** — set `MLS_PUBLISH_ENABLED=false`, stop/disable the timer, preserve database evidence/artifacts, and leave Blob media intact. `npm run mls:legacy-sync` is an operator-only fallback and must not be started automatically. Reversing already published canonical values is a separate approved operation that must add forward compensating change events; never delete or rewrite audit history.

State explicitly that migration, credential placement, live scraping, Blob upload, Vercel deployment, systemd installation, and production publication remain separate authorization events.

- [ ] **Step 7: Include ops contract in the MLS test script**

Append `src/lib/mls/ops-contract.test.mjs` to the explicit `test:mls` command in `package.json`.

- [ ] **Step 8: Run route, ops, build, and existing scheduler tests**

Run:

```powershell
npm.cmd run test:cron
node --test src/lib/mls/ops-contract.test.mjs
npm.cmd run build:dev
```

Expected: route and scheduler tests PASS, both non-MLS Vercel crons remain, Cloudflare job draining remains mapped, and the development build passes.

- [ ] **Step 9: Commit the scheduling cutover**

```powershell
git add src/lib/mls/neon-db.mjs src/lib/mls/neon-db.d.mts src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs vercel.ts ops/systemd/earnest-mls-sync.service ops/systemd/earnest-mls-sync.timer src/lib/mls/ops-contract.test.mjs docs/mls-production-activation.md package.json
git commit -m "ops: move MLS scheduling to the VPS"
```

---

### Task 13: Verify the Implementation and Execute the Gated Rollout

**Files:**

- Verify: every file listed in Tasks 1–12
- Update only if evidence requires it: `docs/mls-production-activation.md`

**Interfaces:**

- Consumes: completed implementation commits, fixture tests, optional disposable Neon evidence, and separately approved production access.
- Produces: a code-verification record, then seven approved shadows, a controlled cutover, seven monitored live runs, or an explicit no-go with preserved evidence.

- [ ] **Step 1: Record checkout and unrelated-change boundaries**

Run:

```powershell
git status --short
git log --oneline -15
git diff --check
```

Expected: implementation commits are present; `git diff --check` reports no whitespace errors. Do not stage, discard, or rewrite unrelated pre-existing changes.

- [ ] **Step 2: Run all deterministic MLS and regression checks**

Run:

```powershell
npm.cmd run test:mls
npm.cmd run test:migration
npm.cmd run test:cron
node --test src/lib/control-plane/migration-versions.test.mjs
npm.cmd run build:dev
```

Expected: all fixture/unit/contract/migration/cron tests pass and the development build succeeds. Confirm the test output shows no live 28Hse request, no Blob write, and no database connection.

Run the full lint separately:

```powershell
npm.cmd run lint
```

Expected: PASS. If unrelated pre-existing lint failures exist, record their exact files and prove every touched JS/TS file passes a focused local ESLint invocation; do not misreport the full baseline as passing.

- [ ] **Step 3: Verify the optional database boundary honestly**

Without `DATABASE_URL_TEST`:

```powershell
npm.cmd run test:mls:db
```

Expected: SKIPPED.

After separate approval and creation of a disposable Neon branch, set only `DATABASE_URL_TEST` and `MLS_TEST_DATABASE_CONFIRMED=true` for the test process, apply the migration to that branch through the repository's reviewed migration command, run the integration test, and discard the branch through the provider's approved workflow. Never reuse production `DATABASE_URL_UNPOOLED` and never print either URL.

- [ ] **Step 4: Perform focused implementation review**

Use `superpowers:requesting-code-review` before declaring the code ready. Review against the approved design and specifically verify:

- the 28Hse allowlist contains no editorial, mortgage, school, transport, view, map, floor-plan, QR, VR, or platform-branded publication path;
- robots, 403/429, CAPTCHA, identity mismatch, and pagination-loop behavior fail closed;
- source observations survive blocked and rolled-back runs;
- exact property number plus deal type is the only match key;
- staff overrides, including explicit null, survive synchronization;
- degraded runs never advance inactivity;
- media rights default false and shadow mode writes no Blob objects;
- advisory lock and serializable transaction release/rollback on every error;
- route, Vercel, and VPS cannot independently publish at the same time;
- artifact deletion cannot escape its configured root;
- logs and artifacts contain no secrets or raw HTML.

Resolve actionable findings with focused tests and one or more explicit follow-up commits. Re-run Steps 1–3 after any fix.

- [ ] **Step 5: Stop at the production authorization boundary**

At this point code can be ready, but rollout is not complete. Obtain separate explicit approval before each of:

1. applying the production migration;
2. placing Neon/Blob credentials on the VPS;
3. making live 28Hse/old-site requests;
4. writing production shadow evidence;
5. uploading Blob media;
6. deploying the Vercel cron/status change;
7. installing or enabling systemd units;
8. setting `MLS_PUBLISH_ENABLED=true` and publishing canonical changes.

An approval for one item does not authorize the next.

- [ ] **Step 6: Run and approve seven daily shadows**

After the migration and live-shadow approvals, obtain and record media-rights confirmation, review exact outbound media hosts, set `MLS_MEDIA_RIGHTS_CONFIRMED=true` plus `MLS_MEDIA_ALLOWED_HOSTS`, keep `MLS_PUBLISH_ENABLED=false`, and run once per day:

```bash
npm run mls:shadow
npm run mls:approve-baseline -- --run={reviewed-run-uuid} --reviewer={operator-id}
```

For each run, record:

- agent identity `C-018613`;
- robots/access result and no challenge;
- sale/rent advertised, discovered, parsed, and quarantined counts;
- comparison with prior successful run and rolling median;
- parse rate at least 98%;
- pagination completion and zero conflicting source IDs;
- exact matches, new/changed/reactivation/inactivity previews;
- staff overrides retained;
- media reuse/validation/rejection, with zero Blob uploads;
- artifact paths and reviewer identity/time.

Any missing, unhealthy, unapproved, or degraded date resets the consecutive streak. Such a run may be diagnostically useful but does not count toward the seven approved healthy shadows. Do not approve unexplained count movement or ambiguity.

- [ ] **Step 7: Audit canonical duplicates before cutover**

With approved read access, run the reviewed equivalent of:

```sql
SELECT canonical_property_no, deal_type, count(*) AS candidate_count
FROM properties
WHERE canonical_property_no IS NOT NULL
GROUP BY canonical_property_no, deal_type
HAVING count(*) > 1;
```

Expected: zero rows. If rows exist, stop. The synchronizer must quarantine them as ambiguous; an operator must resolve canonical ownership separately. Do not automatically merge or delete properties.

- [ ] **Step 8: Perform the coordinated cutover**

Only after seven approved healthy shadows:

1. Deploy the release that makes `/api/mls-sync` status-only and removes only its Vercel cron.
2. Verify the Vercel deployment lists the two unrelated safety crons and no MLS cron.
3. Verify the protected status endpoint returns `publisher: "vps"` and the latest shadow run.
4. Install the reviewed systemd files and environment file with least-privilege ownership; leave the timer disabled.
5. Reconfirm that media rights and the outbound host allowlist match the approved shadow configuration.
6. Set `MLS_PUBLISH_ENABLED=true` only with the separate publication approval.
7. Start the service manually once and inspect its exit code, JSON/CSV artifacts, latest-run status, database change events, and a sample of public sale/rent listings.
8. Enable the timer only after the first publish is accepted.

This is a coordinated operator procedure, not an implementation-session command sequence.

- [ ] **Step 9: Monitor seven live daily runs**

For each of the next seven runs confirm:

- exactly one run holds the advisory lock;
- 28Hse is healthy before any public write;
- degraded mode publishes no inactivity;
- one exact identity produces one canonical public property;
- field changes cite the winning observation or staff override;
- reappearance reactivates correctly;
- absence changes status only on the second consecutive full healthy day;
- media URLs are owned Blob URLs and hashes deduplicate;
- public listing counts and representative pages agree with committed canonical rows;
- no legacy Vercel MLS execution appears.

The rollout is accepted only after all seven monitored runs pass. Until then, report code completion and rollout state separately.

- [ ] **Step 10: Roll back safely on any production anomaly**

Immediately:

1. set `MLS_PUBLISH_ENABLED=false`;
2. stop and disable `earnest-mls-sync.timer`;
3. preserve `listing_sync_runs`, observations, change events, and local artifacts;
4. do not delete Blob media;
5. keep the Vercel status endpoint read-only;
6. use `mls:legacy-sync` only after a separate operator decision and only if its source is known healthy.

If already published canonical values must be reversed, prepare a separately reviewed forward compensation against the latest event state, verify no later staff edit would be overwritten, and append compensating `listing_change_events`. Do not delete events, observations, links, runs, or media to simulate rollback.

Fix forward with a new tested commit and restart the seven-live-run observation window. Never bypass health checks or manually mark a failed run healthy.

---

## Definition of Done

Implementation is code-complete when Tasks 1–12 are committed, deterministic checks pass, the disposable-database test is either passed with approved evidence or explicitly skipped, and focused code review has no unresolved findings.

Production rollout is complete only when the migration and credential gates were separately approved, seven healthy shadows were reviewed and approved, the Vercel publisher was removed before the VPS timer was enabled, the first publish was accepted, and seven subsequent live runs passed monitoring. Code completion alone is not production completion.
