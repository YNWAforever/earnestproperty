# Codex implementation instructions — Earnest Property
## 28hse + Property.hk ingestion, snapshots, matching and merge — no Hermes

**Repository:** `YNWAforever/earnestproperty`  
**Reviewed branch:** `main`  
**Reviewed commit:** `b3c1929ab6e1758a6003d7b48c5a8e1c63163776`  
**Commit timestamp:** `2026-09-06T14:20:31Z`  
**Instruction date:** 2026-09-06  
**Business specification:** `docs/specs/28hse_propertyhk_scraping_merge_spec_no_hermes_v2.md`  
**Specification SHA-256:** `36075ecfbba247c7c8b3152d21366a2c28aa768b2b09ee52a4dfb3d8e579d164`

This is a repository-specific implementation brief, not an implemented patch or a claim that production was tested. It is grounded in the supplied v2 specification and the repository files identified in Appendix A. Proposed new paths and schema additions below are explicitly implementation instructions, not claims that they already exist.

---

## 1. Your assignment

Implement the supplied no-Hermes v2 specification **inside this existing application**, using the existing Neon/MLS/public-property infrastructure. Do not stop at another plan or produce a disconnected sample project.

Deliver two deterministic Python crawler/runner paths, immutable snapshots and CSV diff output, a Property.hk submission client and receiving API, and a shared server-side ingestion/publication implementation. Preserve the existing application, property identifiers, source history, staff overrides and public URLs.

The target sources are:

- **Primary:** 28hse agency `/agent/540`.
- **Secondary:** Property.hk branches `EPW`, `EPS`, `EPT`.

The pipeline must not require Hermes, an autonomous AI agent, LLM extraction, an LLM API key, a vector database or an agent scheduler. The word `agent` in the existing identifier `28hse_agent_540` refers to the estate agency: **keep that identifier; do not rename it merely because this task says “no Agent.”**

Implement code, migrations, fixtures, automated tests and a deployment/runbook handoff. Production activation is separate: do not run production migrations, change deployed secrets, enable publishing, disable existing deployed schedules, push a deployment or perform live bulk crawling merely to complete this coding task.

### 1.1 Instruction precedence

1. Follow the applicable repository `AGENTS.md` instructions, where present, and read `CLAUDE.md` for conventions.
2. The attached **no-Hermes v2 specification** defines the requested business behavior. Older Hermes instructions are not the target.
3. The checked-out repository defines the actual framework, schema, transaction boundary and integration points.
4. The differences documented in section 3 must be implemented deliberately as versioned behavior; do not silently pretend the old implementation already meets v2.
5. Paths proposed here may be adjusted to match the current checkout, but retain their responsibilities and document the mapping.

Inspect the current HEAD and working tree before editing. Do not reset to the reviewed commit or discard unrelated changes. If HEAD has advanced, verify the affected files again and record the delta in the implementation report.

### 1.2 Keep the scope narrow

Do not rebuild the marketing website, redesign the property UI, replace Neon, add an ORM, migrate the app to Next.js, remove unrelated AI/CRM features, alter WhatsApp campaigns, recreate staff accounts, or overwrite recently supplied company/agent assets.

The MD's Line 1 `/buy` market-monitoring workflow remains outside this task. The existing repository's `old_site` adapter is a different legacy source, not evidence that the requested Property.hk adapter already exists.

---

## 2. Repository facts that must shape the implementation

The following are observations from the reviewed commit, not proposed architecture. Recheck them against the current checkout. Source references are in Appendix A.

| Area | Observed implementation | Required consequence |
|---|---|---|
| App framework | TanStack Start and file-based TanStack Router; React; Vite/Nitro | Use `createFileRoute(...).server.handlers` for the HTTP endpoint. Do not write a Remix loader/action or Next.js API route. |
| Database | Neon Postgres, parameterized raw SQL, no ORM | Use the existing SQL and dedicated-client conventions. Do not introduce Prisma/Drizzle for this task. |
| Property storage | `properties`, with `listing_no`, `canonical_property_no`, `deal_type` and UUID `id` | Map the MD's conceptual `listings` onto existing storage. Do not build a second disconnected canonical `listings` table. |
| Source identifiers | `old_site` and `28hse_agent_540` | Preserve these persisted identities. Introduce a distinct Property.hk source rather than repurposing `old_site`. |
| Existing source adapters | `src/lib/mls/sources/28hse-agent.mjs` and `old-site.mjs` | Reuse applicable parsing/security concepts; add the requested Property.hk worker and contract. |
| Legacy source URLs | `old-site.mjs` targets `www.earnestproperty.com/property/c1`, `/c2`, `/c5` | These are not the Property.hk EPW/EPS/EPT URLs. Do not substitute them. |
| MLS state | Observations, links, per-field state, lifecycle state, change events and sync runs already exist | Extend/map these instead of duplicating the same responsibilities. |
| Public identity | `property_public_groups` and `property_public_members` preserve public IDs and offerings | Source matching changes must not break these aliases, public links or inquiry targets. |
| Scheduled MLS HTTP route | `src/routes/api.mls-sync.ts` is an authenticated **GET status route** | Keep its status behavior. It is not an existing POST snapshot ingestion endpoint. |
| Worker infrastructure | Cloudflare MLS container/workflow configuration and MLS CLI scripts exist | “No Hermes” does not mean deleting Cloudflare. Introduce the required worker path with an explicit publisher-ownership/cutover plan. |
| Committed defaults | MLS container config specifies `shadow`, publishing disabled and media rights unconfirmed | Treat these as committed configuration, not proof of the live deployment state. Do not flip them automatically. |
| Locking | `withMlsAdvisoryLock` uses a dedicated Neon client and lock name `earnestproperty:mls-sync` | New canonical writers must coordinate with the existing writer, not just acquire an unrelated lock. |
| Tests | Named npm scripts; Node tests for `.mjs`, Bun for relevant TS tests | There is no generic `npm test`. Use the actual scripts in `package.json`. |

### 2.1 Read these implementation files before editing

Read complete files in the current checkout; this handoff does not replace that step:

```text
CLAUDE.md
package.json
.env.example
vite.config.ts
vercel.ts

src/routes/api.mls-sync.ts
src/routes/api.mls-sync.test.mjs
src/routes/api.admin.woztell.send.ts
src/lib/neon/db.server.ts

src/lib/mls/source-contract.mjs
src/lib/mls/source-contract.d.mts
src/lib/mls/parse-28hse.mjs
src/lib/mls/sources/28hse-agent.mjs
src/lib/mls/sources/old-site.mjs
src/lib/mls/access-policy.mjs
src/lib/mls/health.mjs
src/lib/mls/match.mjs
src/lib/mls/reconcile.mjs
src/lib/mls/orchestrator.mjs
src/lib/mls/neon-lock.mjs
src/lib/mls/neon-db.mjs
src/lib/mls/sync-repository.mjs
src/lib/mls/sync-repository.d.mts
src/lib/mls/reporting.mjs

scripts/mls/sync.mjs
scripts/mls/approve-baseline.mjs
scripts/neon/apply-migrations.mjs
scripts/neon/check-migration-drift.mjs

neon/migrations/20260817120000_dual_source_listing_sync.sql
neon/migrations/20260906040000_property_public_identity.sql
src/lib/neon/public-data.server.ts
src/lib/neon/public-data.types.ts
src/lib/neon/property-identity.contract.test.mjs

workers/mls-container/wrangler.jsonc
workers/mls-container/src/
workers/mls-container/container/
docs/mls-production-activation.md
```

Also inspect newer migrations and the tests covering every module you change. Some files above are integration-read requirements, not files fully reviewed when this handoff was drafted; see Appendix A.

---

## 3. Explicit specification-to-code differences

Create `docs/mls-no-hermes-v2-mapping.md` recording how you resolve these differences. This is not permission to weaken validation globally.

### D01 — Python workers versus an existing Node MLS implementation

The MD explicitly requests deterministic Python crawlers and CLI entrypoints. Keep that delivery requirement. Isolate Python dependencies under a worker directory; do not convert the application backend to Python.

**Proposed adaptation:** Python produces the frozen source payload. A small Node CLI bridge applies the 28hse payload using the shared server-side MLS service. Property.hk sends its payload to the new HTTP endpoint, which calls the same service family. This retains the existing raw-SQL publication machinery without requiring Python to duplicate it.

Do not silently replace the Python deliverable with “the existing Node crawler is sufficient.” A Node-only alternative requires a documented change to the requested scope, not an implementation shortcut.

### D02 — Existing matching is not the requested four-field matching

`buildMatchKey()` currently combines a normalized agency property number and `deal_type`. The legacy source-link reason is `exact_property_no_and_deal_type`.

V2 requires a complete, exact, uniquely resolved unit identity:

```text
estate identity, including phase where necessary
+ block
+ exact floor
+ unit
+ compatible deal_type
```

Create a separately named/versioned unit key and matching policy. Do not put a concatenated address into `propertyNoRaw`, reuse a legacy property-number key to imply exact-unit evidence, or globally reinterpret existing persisted keys.

Preserve existing approved source relationships. Apply the v2 rule to new matching decisions; any migration of legacy relationships requires a reviewable report, not an automatic remerge of all inventory.

### D03 — Valid source identity does not require a legacy agency property number

The existing v1 observation constructor quarantines records without a normalized property number. The MD identifies a source advertisement by its real source ID, including when floor/unit information is missing.

Add an explicit v2 observation/validation path that separates:

- valid source identity;
- valid offer data;
- eligibility for exact-unit matching;
- eligibility for publication.

Do not forge a property number, mark an unknown unit as an exact match, or bypass all legacy quarantine checks. A source can be accepted and upserted repeatedly without qualifying for cross-source merging. Verify public-field prerequisites separately; preserve unpublishable data with an explicit reason rather than inventing required fields.

### D04 — Advertised listing totals are currently part of the crawl stop/health logic

The reviewed 28hse adapter stops when discovered IDs reach `advertisedCount` and treats changes to that total as an error. `health.mjs` also validates advertised/discovered count equality.

V2 instead requires actual distinct source IDs, verified pagination completion and a same-scope successful-applied baseline. Implement this deliberately in the v2 crawler and gate. Keep advertised totals as diagnostics, not as the completeness oracle.

Do not make the change by fabricating advertised totals to satisfy the old evaluator. Do not drop robots, company identity, challenge detection, bounded retries, loop detection or parser-integrity checks. Maintain legacy behavior outside the new versioned path until the controlled cutover.

### D05 — Existing health/run gates expect `old_site` and 28hse together

Do not send an invented healthy `old_site` result to reuse `evaluateRunGate()` for a Property.hk-only API request.

Implement source/scope-aware v2 gates and distinguish:

- structural crawl completion;
- accepted full-snapshot baseline;
- newest accepted write timestamp;
- publication readiness and operator approvals;
- permission to infer absence.

A partial-success batch may update valid records but must not advance the full-snapshot baseline or infer absence. Its accepted writes still need chronological protection against older batches.

Existing shadow approval and publication safeguards must remain enforced at the shared write boundary. Do not treat an approved shadow run as if its observations had already been applied to production inventory.

### D06 — `delisted` is not an existing canonical enum value

The existing canonical write model includes `draft`, `active`, `sold`, `rented`, `offline`, `inactive`. Existing change events include `inactive`, not `delisted`.

Map source-level v2 `delisted` to the existing canonical inactive/lifecycle representation with an explicit reason, or add a justified compatible migration. Do not insert unsupported enum values. Never translate crawler absence into `sold` or `rented`.

V2 policy is specific: an accepted full 28hse snapshot can mark its missing source IDs delisted; a matched Property.hk record must not automatically reactivate a delisted 28hse-primary listing. Property.hk absence detection remains **disabled by default**. Do not reuse the earlier “any source active means canonical active” proposal.

### D07 — Automated source priority and staff override are different layers

`property_sync_fields` and reconciliation support staff overrides. Preserve that repository protection.

Use this explicit compatibility policy:

```text
Automated candidate:
    valid raw 28hse value
    else approved Property.hk fallback on an established match

Public selected value:
    existing authorized staff override, if active
    else automated candidate
```

The MD determines priority between crawler sources. This instruction preserves the existing human-control exception rather than allowing a crawler to erase staff edits. Record both source conflict and manual-override provenance; do not label the manually selected value as a 28hse-provided value.

During adoption, do not blanket-label every legacy imported value as a human override simply because it differs from the new source. Equally, do not clear existing override flags. Establish the initial field baseline from persisted publication/import provenance; protect and review fields whose ownership cannot be established. Test this first-adoption case explicitly.

### D08 — Existing reconciliation excludes 28hse descriptions

The reviewed `sourceValue()` excludes `description` for `SOURCE_28HSE`. V2 says an available 28hse title/description must not be replaced by Property.hk text.

Implement this as an explicit v2 field policy, preserving raw title prefixes and staff overrides. Do not inherit the exclusion accidentally; do not change the legacy path globally without tests. The fallback allowlist remains narrow: the MD initially suggests `gross_area`, `saleable_area`, `bedrooms`. Do not make all nullable properties fillable by spreading an object.

### D09 — Public grouping must not become a backdoor around v2 matching

The existing public-identity trigger groups compatible offerings using `canonical_property_no` and physical-field checks. That is a distinct mechanism from the new exact-unit matcher.

For v2 records, ensure the trigger/public-group assignment cannot create a new cross-source equivalence that the v2 matcher rejected. In particular, do not copy an agency property number into a new canonical grouping key merely to force a Property.hk record into an existing public group.

Introduce narrowly scoped identity-policy metadata or a compatible grouping guard if necessary. Preserve already issued public aliases and existing member rows. Test this at the database boundary, not only in the pure matcher.

### D10 — The requested source name must not rewrite legacy source history

Map the wire source `28hse` to existing internal `28hse_agent_540` at the adapter boundary. Add a distinct internal `propertyhk` value through the source codec, types, SQL constraints and validators.

Do not globally search-and-replace `old_site` with `propertyhk`. Old-site image URLs on a Property.hk image host do not establish that the old-site feed is the requested three-branch feed.

---

## 4. Target integration architecture

The following is the proposed repository adaptation of MD sections 3, 4 and 23.

```text
VPS / controlled worker environment
  scheduler + source/scope lock
    |
    +-- Python run_28hse_sync.py
    |     crawl_agent540.py -> raw evidence -> deterministic parser
    |     -> immutable snapshot -> completeness -> diff
    |     -> fixed source payload
    |     -> NEW Node apply-source-snapshot.mjs CLI bridge
    |            |
    |            +-- shared server ingestion / reconciliation / publication
    |
    +-- Python run_propertyhk_sync.py
          crawl_propertyhk.py -> EPW/EPS/EPT evidence -> snapshot
          -> completeness -> fixed request.json -> sync_propertyhk.py
          -> POST /api/admin/propertyhk-sync
                 |
                 +-- auth + size/schema + receipt + quota + scope gates
                 +-- shared server ingestion / reconciliation / publication

Shared Neon write boundary
  existing MLS writer lock + source/scope coordination
  one dedicated connection for the transaction
  source observations/state + links + contacts + properties
  + field provenance + conflicts + events + receipt + applied baseline

Existing public read model
  properties -> public groups/members -> stable URLs/offerings/aliases
```

### 4.1 Non-negotiable boundaries

- No browser, crawl or remote listing fetch inside the receiving API.
- No separate Python canonical-property SQL writer.
- No second canonical database.
- No HTTP invocation of the existing status route as if it accepted ingestion.
- No use of an internal TanStack server function as the external Python HTTP protocol.
- No independently committed `publishBatch()` followed by a receipt write outside its transaction.
- No two publishers with conflicting authority merely because they run at different times.

The Node bridge is **new work**. It must consume already collected observations; do not make it call `scripts/mls/sync.mjs` in a way that recrawls the sites and discards the Python snapshot.

### 4.2 Files to add or adapt

These are proposed paths, not an assertion that all of them already exist. Prefer fewer cohesive modules over mechanical file proliferation.

```text
scripts/property-sync/
  requirements.txt                  # pinned worker-only dependencies
  crawl_agent540.py
  diff_agent540.py
  crawl_propertyhk.py
  sync_propertyhk.py
  run_28hse_sync.py
  run_propertyhk_sync.py
  config/sources.example.json
  scraping/
    source_28hse.py
    source_propertyhk.py
    validation.py
    snapshots.py
    completeness.py
  tests/
    fixtures/28hse/
    fixtures/propertyhk/
    test_diff_agent540.py
    test_propertyhk_parser.py
    test_completeness.py
    test_sync_client.py

scripts/mls/apply-source-snapshot.mjs

src/routes/api.admin.propertyhk-sync.ts
src/routes/api.admin.propertyhk-sync.test.mjs

src/lib/mls/
  ingestion-contract.mjs + ingestion-contract.d.mts
  unit-identity.mjs + unit-identity.d.mts
  source-snapshot-gates.mjs
  source-ingestion.mjs
  propertyhk-sync.server.ts          # server-only HTTP integration boundary
  [existing repository/reconciliation modules extended where needed]
  [associated .test.mjs files]

neon/migrations/<new_timestamp>_propertyhk_ingestion_v2.sql

docs/mls-no-hermes-v2-mapping.md
docs/deployment/property-sync-no-hermes.md
docs/property-sync-runbook.md
```

The Python subdirectory is a documented path adaptation of the MD's root-level CLI examples, not a change of functionality. Preserve root compatibility wrappers only if an existing script/automation contract actually needs them; do not overwrite a root `requirements.txt` or `AGENTS.md` blindly.

Keep `.server.ts` files server-only. Reusable pure MLS logic should follow the existing `.mjs`/`.d.mts` and Node-test conventions. Generate the route tree through the normal tooling; never hand-edit `src/routeTree.gen.ts`.

---

## 5. Data model mapping and additive migrations

Map responsibilities first. Add only what the existing tables cannot represent safely.

| MD concept | Repository mapping / implementation action |
|---|---|
| Canonical listing / offer | Preserve `properties.id`, `listing_no`, `canonical_property_no`, `deal_type`. |
| Public identity | Preserve `property_public_groups` and `property_public_members`; guard v2 assignment as described in D09. |
| Source observation history | Extend `listing_source_observations`; retain raw and normalized values, source timestamps and validation evidence. |
| Source-to-property relationship | Extend `property_source_links`; preserve unique source/external ID/deal identity and old link reasons. |
| Current accepted source state | Add a sidecar or carefully extend source state with latest accepted observation, source lifecycle and identity version. Do not confuse link status with listing availability. |
| Field provenance and staff overrides | Reuse `property_sync_fields.winning_observation_id`, override fields and publication state; add selection reason/policy metadata where missing. |
| Canonical lifecycle | Reuse `property_sync_state`, with source-specific v2 lifecycle decisions recorded separately where necessary. |
| Change history | Reuse `listing_change_events`; map `delisted` to supported lifecycle/event vocabulary explicitly. |
| Run audit | Extend/map `listing_sync_runs`; keep existing consumers compatible. |
| Batch idempotency | Add a receipt keyed by source/scope/scraped timestamp, with payload hash, processing outcome, stored response and run link. |
| Full-snapshot baseline | Add explicit source/scope/policy baseline references; separate these from last accepted write time and reviewed shadow calibration. |
| Contacts | Add source-owned whole-contact storage; no changes to staff identities or public agent profile records from crawler data. |
| Cross-source conflicts | Add a persistent conflict ledger, with both observations, values, times, resolution and repeated-conflict tracking. |
| Branch membership | Add source/branch memberships if one verified source ID occurs in multiple branches. |
| Matching review | Persist ambiguity/identity-change reasons and evidence; reuse an existing suitable review mechanism only after inspection. |

### 5.1 Identity and constraints

The existing DB uses `(source, external_listing_id, deal_type)` uniqueness. Retain the offer dimension so sale and rent cannot overwrite each other. Explain how this represents the MD's source-record key and whether a parent advertisement identity is needed.

Confirm Property.hk ID scope from authorized fixtures/configuration. If IDs are branch-local, make the normalized external identity unambiguous and preserve raw ID plus branch. If IDs are global, do not create one duplicate source record per branch; preserve multiple branch memberships.

Define count identity explicitly. The MD count gate uses distinct source advertisements, not branch memberships or duplicated cards. If one verified advertisement contains both sale and rent offers, retain distinct offer state but report advertisement and offer counts separately. Never compare an old advertisement-count baseline with a new offer-count baseline without a versioned bootstrap.

The existing `property_source_links.match_key` is non-null and its reason constraint accepts only the legacy exact-property-number reason. Update these constraints deliberately for source-ID-only links and exact-unit-v2 links. **Do not use a fake exact-match key to satisfy a NOT NULL constraint.** Persist the actual matching basis and version.

A source advertisement that has no exact unit identity must still reuse its existing source relationship on the next run. A generated internal listing number, if required, must be explicitly internal and allocated once under a uniqueness constraint. Never write it into the raw remote property-ID/property-number field or present it as source evidence.

### 5.2 Preserve precision and null semantics

Keep monetary values exact in the accepted source representation. Preserve fractional area evidence even where the existing public write model expects integer areas; do not silently round before comparison or matching. Define an explicit projection/quarantine rule and test it.

Zero bedrooms may be valid. Null, empty, zero and `面議` are not interchangeable. Compare sale price with sale price and rent with rent, never across deal types.

### 5.3 History and migration discipline

Add a new timestamped migration under `neon/migrations/`. Do not edit an already applied migration, drop source-history tables, rewrite property UUIDs, bulk rebuild canonical groups or delete duplicate-looking properties to make tests pass.

Update all affected source CHECK constraints, link-reason constraints, types, validators, serializers and SQL queries together. Update migration-registration/drift machinery if the current repository requires it.

Document forward migration, preflight checks and application rollback. After v2 data has been written, old code may not understand the new source: rollback must disable affected publication safely and retain evidence, not shrink CHECK constraints over existing rows or delete data.

---

## 6. Worker implementation requirements

### 6.1 Configuration

Implement the v2 source configuration, including:

```text
28hse: scope agent:540
  list template https://www.28hse.com/agent/540?page={page}
  bounded retries and request pacing
  max_drop_ratio 0.30

Property.hk: scope branches:EPW,EPS,EPT
  explicit configured EPW/EPS/EPT URLs
  verified pagination and parser rules
  absence_detection_enabled false

timezone: Asia/Hong_Kong
```

Do not invent the Property.hk URLs, endpoint patterns, selectors or global-ID semantics. The reviewed old-site adapter is not a substitute. Missing required URLs must fail with a configuration error, not produce a “successful empty inventory.”

A source-page URL or detail selector found in the repository is a candidate for validation, not proof that the current live site still uses it.

### 6.2 28hse

Implement the MD's crawler and diff behavior with reusable offline fixtures:

- Preserve true source `property_id`, raw ID, raw title and company prefixes.
- Deduplicate repeated listing cards by source ID, not page position.
- Traverse until a verified normal endpoint/empty list. A safe page ceiling ends with `incomplete`, not success.
- Preserve source identity checks, HTTPS-origin restrictions, robots/access policy, challenge detection and bounded retries.
- Fetch necessary details deterministically; unknown block/floor/unit remains null.
- Use 2–3 second request pacing as the starting configuration, subject to stricter permitted-source requirements. Specify whether retry configuration counts retries or total attempts; do not introduce an untested off-by-one change from the existing JS `maxAttempts` convention.
- Persist source evidence and parser version. Never use an LLM to repair missing identities.
- Compare accepted full snapshots by named CSV columns and cleaned source ID.
- Emit `new`, `delisted`, `changed`, `unchanged`; preserve old/new field values and first-seen time on reactivation.

Existing JS parser/fixture behavior is a useful reference. If Python ports the extraction, add shared golden input/output fixtures or parity checks so the Python and Node paths cannot silently interpret the same price or identity differently.

### 6.3 Property.hk

Deliver the crawler itself, not only the API endpoint:

1. Visit each configured branch and its verified pages.
2. Record branch-level completion, failures, discovered identities and detail completion.
3. Preserve real source IDs, detail URLs, raw fields and complete contact objects.
4. Resolve cross-branch ID scope from evidence; retain memberships.
5. Freeze the payload only after validation and structural completeness checks.
6. Submit the same immutable payload on retry.

The default batch covers all three branches. A failed required branch blocks business writes even if another branch grows enough to hide the drop in the combined total.

### 6.4 Snapshot and diff artifacts

Use per-source/per-scope/per-run directories following MD section 10:

```text
snapshots/<source>/<scope>/<date>/<run_id>/
  listings.csv      # UTF-8-sig
  records.jsonl
  manifest.json
  request.json     # when submitted; fixed content for every retry

diff_report/28hse/<date>/<run_id>/changes.csv
```

Include `run_id`, source, scope, `scraped_at`, parser/schema version, failed pages, rejected records, branch completion and distinct counts. Never store credentials or an Authorization header in these artifacts.

Keep failed evidence separately. A successful crawl followed by a failed apply does not advance the last-applied baseline. Retry the frozen payload instead of manufacturing a new timestamp.

### 6.5 Completeness and partial success

Use **observed valid distinct identities**, not advertised counts or duplicated cards:

```text
previous = same source/scope/policy, previous full successfully applied count
current  = valid distinct identities in this candidate snapshot

previous > 0 and (previous - current) / previous > 0.30
    => reject business writes
```

The threshold is strictly greater than 30%; passing it is not proof of completeness.

Any required-page failure, blocked page, unrecognized template, missing branch, pagination loop or required-detail failure invalidates full-snapshot status. Do not infer absence from a smaller set of successfully parsed records.

A structurally complete batch with isolated record-validation errors may apply valid records if the gates permit, as specified in the MD. Return `partial_success`; preserve rejects; do not infer absence or advance the full baseline. Track accepted write ordering independently so an older full batch cannot undo those newer accepted values.

The first accepted full run bootstraps its scope without declaring existing historical rows absent. New scopes/parser policies require their own calibration and reviewed bootstrap.

---

## 7. Property.hk API and ingestion contract

### 7.1 HTTP route

Add:

```text
POST /api/admin/propertyhk-sync
src/routes/api.admin.propertyhk-sync.ts
```

Follow the repository's TanStack server route convention. Keep the route thin and lazily import server-only handling. Use `Response.json` and typed safe errors. Preserve the existing GET status route unchanged in responsibility.

Authenticate the dedicated machine credential:

```text
Authorization: Bearer <PROPERTYHK_SYNC_SECRET>
```

Use length-checked timing-safe comparison, with the existing MLS route as a reference. Missing server configuration should produce a safe unavailable response; invalid credentials return 401. Do not accept an ordinary caller as staff by forging `agentScope` or a staff JWT.

The credential is bound server-side to Property.hk and the allowed branch scope. The caller must not choose arbitrary source aliases, a target property UUID, a publication mode, an approved baseline or staff-override values.

### 7.2 Payload compatibility

Implement MD section 16's business fields and versioned `meta`. Preserve `source`, `branches`, `scraped_at`, `listings`, row-level `branch_code`, and the documented response semantics.

The existing observation schema requires `source_url`; therefore extend both worker and API v2 schemas to carry the **actual** `source_url`. Require it for accepted v2 observations. Do not fabricate it or insert a placeholder URL to satisfy the DB.

Also version any additions for:

- branch memberships;
- raw source evidence and precise normalized values;
- exact-unit identity components and normalization version;
- branch-level completeness evidence;
- worker rejection count and eligible-for-absence evidence.

Worker-supplied normalized identities and health booleans are evidence, not authority. Revalidate source/scope and required raw/normalized consistency server-side. The API cannot prove live crawl completeness from a boolean; validate the submitted structure, scoped counts and evidence, and fail closed on contradictions.

The external envelope version and internal observation-schema version are distinct. Do not overwrite `OBSERVATION_SCHEMA_VERSION` globally just to match the payload's `schema_version: "2.0"`; introduce explicit codecs/backward compatibility.

### 7.3 Processing order

```text
bounded request / authentication
  -> safe JSON parse and batch validation
  -> canonical payload hash and source/scope/time receipt key
  -> completed receipt check
       same key + same hash: replay stored success/partial result
       same key + different hash: 409
  -> NEW batch quota check
  -> acquire shared MLS writer lock and defined scope coordination
  -> recheck receipt, quota, chronology, publication ownership and baseline
  -> evaluate source completeness and per-record validation
  -> create deterministic matching/reconciliation proposal
  -> atomic accepted business writes + outcome receipt + eligible baseline
  -> safe summary response
```

A successful identical retry must not consume another full-sync quota. A general abuse limit can still apply. Enforce the one-new-full-sync-per-hour policy using shared storage, not a process-local map. Treat authenticated credential scope as the principal; do not trust arbitrary forwarded IP headers to establish identity.

Respect `Retry-After` in the Python client. Keep payload/run/time unchanged on transport retry. Use bounded backoff for temporary network/5xx errors; do not blindly loop on validation, auth, conflict or completeness failures.

### 7.4 Status and counters

Implement the MD's status mapping, not the older presentation's conflicting example:

| HTTP | Meaning |
|---|---|
| 200 | Applied success, partial success, or identical completed replay |
| 400 | Malformed JSON / invalid batch envelope |
| 401 | Unauthorized |
| 409 | Same receipt key with different content, stale batch, or scoped state conflict |
| 413 | Configured payload-size limit exceeded |
| 422 | Completeness gate rejection |
| 429 | New batch quota exceeded; include Retry-After |
| 500 / 503 | Safe internal/unavailable response; no stack trace, SQL or secrets |

Return the receipt/run ID, `status`, `replayed`, validation errors and defined summary counters. Keep `skipped_conflict` as a distinct-record count and `conflicts_created` as an event count; neither is an extra mutually exclusive row outcome.

Account for duplicate input identities separately. Exact duplicate rows may collapse; conflicting duplicate source identities must be reported/quarantined, not resolved by whichever row appears last.

Do not return raw contact data or full internal observation payloads merely for debugging. Use bounded summaries and access-controlled diagnostic evidence.

---

## 8. Source-first matching and merge implementation

### 8.1 Decision order

Implement and test the following order for both sources:

```text
1. Resolve normalized source identity and deal type.
2. Find the existing accepted source record/link first.
3. If found:
     reuse its property relationship;
     detect identity change;
     preserve the observation;
     review a material identity change rather than silently relinking.
4. If not found:
     build an exact unit key only from complete verified identity components;
     query compatible cross-source candidates for the same offer type;
     link only when exactly one unambiguous eligible candidate exists.
5. Otherwise create a separate stable source/offer representation;
     record a review item where ambiguity exists.
6. Project allowed fields from accepted source observations.
7. Preserve contacts as whole source-owned objects.
8. Record source conflicts and field provenance.
```

Support both arrival orders: when a new 28hse source uniquely matches an existing Property.hk-primary offer, promote the automated primary source while preserving its existing property UUID, public aliases and history. Do not create a second canonical row solely because the preferred source arrived later.

Do not apply the exact-unit matcher to collapse multiple 28hse advertisements merely because they have similar attributes. The MD separates within-source ID synchronization from cross-source matching.

Multiple existing aliases inside a public group do not mean “pick the first property UUID.” Resolve an established authorized source relationship or send the ambiguous target to review. The public group and the writable offer row are not interchangeable identifiers.

### 8.2 Exact unit evidence

Require complete estate identity, phase context where relevant, block, **exact** floor and unit. Use the repository's existing estate/alias registry where appropriate, but inspect its coverage and collisions first.

`高層`, `中層`, `低層` cannot become numeric floors. Preserve block suffixes, phases, unit leading zeros and raw strings. A match query that returns two candidates is ambiguous even when a database sort produces a deterministic first row.

Do not use price, area, agent name, photos or title similarity as a replacement for the four fields. Do not fill a missing 28hse unit from Property.hk and then claim the unit was an independent exact match.

A property-number match may be review evidence but is not sufficient for a **new** v2 cross-source automatic relationship.

### 8.3 Field selection and conflict logging

Compute the automated primary value from the accepted **raw source observations**, not the already merged `properties` row.

- A valid 28hse value wins over a different Property.hk value.
- Property.hk only fills explicitly approved missing fields after a valid relationship exists.
- Retain title prefixes and raw descriptions. Do not overwrite existing primary text.
- When 28hse later provides a formerly missing field, replace the automated fallback and update provenance.
- Preserve an authorized staff override as described in D07.
- Retain the previous accepted field evidence when a new malformed observation is rejected; do not turn parsing failure into an empty-value overwrite.

Store both source observations, values, observation times and resolution in the conflict ledger. Replays do not create duplicate conflict events. Persistent identical disagreements may update last-seen tracking rather than generating an identical alert every day.

### 8.4 Contact and media safety

Never combine a 28hse contact's name with another Property.hk contact's phone. Select one complete usable contact with a source relationship and freshness/state evidence. Do not use a delisted source contact as the automatic active primary contact.

Crawled agents are not authenticated staff. Do not auto-create or update staff accounts, staff ownership, verified public profiles, namecards or QR codes from scraped contact strings. Any linking to an existing staff identity must use an explicit verified mapping.

The MD does not add image/video merging to this release. Preserve existing images, owned-media references, staff assets and media-rights checks. Do not empty image arrays, hotlink arbitrary source URLs or pretend the committed media-rights flag is authorization. New rows without required public assets/fields must have an explicit draft/review path under the existing publication policy; no invented media.

---

## 9. Atomic publication, concurrency and lifecycle

### 9.1 Use one actual database session

Study the full `sync-repository.mjs` before modifying it. Its declaration exposes `publishBatch`, publication gate/conflict/outcome-unknown errors, source links, field states and exact update tokens; the implementation is not a generic unconstrained upsert helper.

Use a dedicated Neon client under `withMlsAdvisoryLock`, with all transaction statements on the same client. Do not issue `BEGIN`, updates and `COMMIT` through independent HTTP query helpers and assume session affinity.

Preserve lock-session validation, optimistic update checks and timestamp precision. An update token represented as a six-digit UTC PostgreSQL timestamp must not be rounded through a JavaScript millisecond `Date` and then treated as equivalent.

### 9.2 One logical batch, one accepted outcome

Within the same accepted transaction, commit:

- accepted observations/current-source state and links;
- affected canonical property fields;
- contacts and branch memberships;
- provenance/staff-override-compatible field state;
- conflicts and change events;
- the completed idempotency receipt;
- the newest accepted write watermark;
- the full-snapshot baseline, **only if eligible**.

Diagnostic run-start/failure records and untrusted raw evidence can be stored outside the accepted transaction, clearly marked as not applied.

If current `publishBatch()` owns the transaction, extend/refactor that boundary to include the receipt/state updates, or expose a carefully controlled transaction-aware equivalent. Do not nest an independently committing publication call inside a supposed outer transaction. Retain validation/reconciliation proof checks rather than bypassing them with ad hoc SQL.

On an uncertain commit outcome, check/replay the same receipt before allowing a new batch. Do not assume a timeout means rollback.

### 9.3 Multiple writers and deadlocks

The existing global MLS writer lock must coordinate the new bridge and API with any legacy publisher. Additional source/scope locks should have a documented consistent acquisition order. Cross-source exact-unit creation can race even when each source has its own lock; test that race.

An advisory lock prevents simultaneous writes, but it does not prevent an old policy overwriting a new policy in the next run. Add an explicit publication-owner/policy fence or equivalent checked at the shared write boundary. Default the new path to non-publishing until the operator-approved cutover.

Do not remove optimistic conflict detection against staff edits. A publication that races an admin update must retain that edit or fail safely, not force its proposal through.

### 9.4 Lifecycle policy

Apply the MD's v2 lifecycle rules only to the source/scope owned by the v2 policy:

- A complete, accepted 28hse snapshot can mark previously seen missing 28hse source identities delisted.
- Map the canonical lifecycle to the existing supported inactive representation and record why.
- Preserve authorized manual statuses/overrides; do not auto-reactivate staff-offline/sold/rented properties.
- A still-active Property.hk source does not automatically revive a 28hse-primary delisted property.
- Property.hk absence detection is server-controlled and **false by default**.
- Failure/blocked/partial runs do not become absence evidence.
- Preserve first-seen time when a known source reappears.
- Track source freshness separately; a job's attempt time is not the source's last accepted confirmation time.

Do not globally change the old run gate or legacy consecutive-absence policy. Record the versioned cutover and scope ownership so each row has a clear lifecycle authority.

### 9.5 Dry-run, shadow and publishing are distinct

| Mode | Allowed effects |
|---|---|
| Worker `--dry-run` | Local evidence, parser output, diff and validation report only. No POST, DB writes, alerts with external side effects or baseline advancement. |
| Shadow | Permitted diagnostic observations/proposals under the existing shadow contract. No public-property/contact mutation and no applied inventory baseline advancement. |
| Publish | Requires configured authority, existing operator approval gates, healthy source evidence and atomic accepted transaction. |

A reviewed shadow count can help bootstrap publication readiness, but it is not a successfully applied full inventory. Keep those pointers and meanings separate.

---

## 10. Implement in reviewable work packages

Complete the following locally without asking the user to choose an ORM, a new framework or a second database. Record unavoidable live-source prerequisites, but continue all independent implementation and fixture tests.

### WP0 — Inventory and mapping

Inspect current HEAD, repository guidance, source adapters, schema/migrations, publication repository, public grouping and existing tests. Produce the section-3 mapping document and a list of source fixtures/configuration still required.

**Done when:** every MD responsibility has an existing or proposed repository home, and each behavior difference has a deliberate versioned resolution.

### WP1 — Contracts, normalization and migrations

Implement the v2 envelope/observation codec, exact-unit identity, source key mapping, completeness state, receipts, source state, contacts/conflicts and minimal schema changes. Preserve existing types and old source history. Add source/privacy/public-group guards as needed.

**Done when:** pure tests and migration contract tests cover the new source and keys, no-legacy-property-number records, phase/floor/offer distinctions, constraint compatibility and no destructive rewrites.

### WP2 — Python workers, snapshots and diff

Implement both source workers, frozen payload builder, CLI runner, snapshot manifests and CSV diff. Use actual authorized fixtures where available; mark constructed fixtures as synthetic. Implement blocked/unknown-template handling and missing-configuration failure honestly.

**Done when:** both source adapters have offline tests, all branch failures remain visible, no LLM dependency exists, retries preserve payload identity and dry-run has zero remote-write side effects.

### WP3 — Shared server ingestion and matching

Implement source-first upsert, exact-unit-v2 matching, conflict/provenance, human override compatibility, chronological guards and atomic publication with receipts. Add the Node bridge for 28hse.

**Done when:** deterministic repeat input has no extra canonical rows; rollback includes receipts/baselines; ambiguous targets cannot be linked or silently joined by the public-identity trigger.

### WP4 — Property.hk receiving API and client

Implement the thin POST route, machine auth, bounded payload handling, source-bound scope, idempotent replay before quota, safe errors and the Python HTTP client.

**Done when:** request/response contract tests and transport retry tests cover the MD status matrix, mixed valid/invalid rows and uncertain commit outcomes without invoking a crawler inside the route.

### WP5 — Public compatibility and operator handoff

Add only the minimum transport/read-model changes needed to preserve stable public identity, primary contact selection and source freshness. Retain current UI and staff-media behavior. Wire test scripts/CI, deployment instructions, scheduler examples, shadow evaluation, publisher cutover and rollback.

**Done when:** regressions demonstrate original public URLs and inquiry targets survive, and an operator can replay a snapshot without a recrawl or accidental secondary takeover.

---

## 11. Required automated tests

Implement all business cases T01–T28 from MD section 26. The following abbreviated checklist is a traceability index, not a replacement for the original descriptions.

| Case | Required proof |
|---|---|
| T01–T03 | Duplicate cards dedupe; HTTP-200 challenge is not empty; failed page blocks completeness even with only a 5% count drop. |
| T04–T08 | New/delisted/changed behavior; ID cleaning; comparison uses last successfully applied full snapshot. |
| T09–T10 | 200 to 120 rejects business writes; failed branch cannot be hidden by growth elsewhere. |
| T11–T13 | Same-payload replay; different-content key conflict; older batch cannot overwrite newer state. |
| T14–T20 | Four-field unique match only; no area/price shortcut; phase preserved; floor band not exact; existing missing-unit source reused; ambiguity review; sale/rent separation. |
| T21–T23 | Primary value plus conflict; 28hse later supersedes fallback; contact name/phone never spliced across people. |
| T24–T28 | Invalid row partial success/no absence; transaction rollback; bootstrap; concurrency; strict dry-run. |

### 11.1 Repository-specific regression cases

Add focused tests proving:

1. `28hse` wire identity maps to `28hse_agent_540`; `old_site` is never rewritten as `propertyhk`.
2. A real source ID without an agency property number is accepted into v2 source storage without inventing a property number or passing the legacy exact matcher.
3. Existing approved source relationships and original property UUIDs remain stable.
4. A new Property.hk record cannot join a public group through a trigger when the v2 exact matcher rejected the relationship.
5. Existing `public_listing_no`, aliases, sale/rent offerings and inquiry targets remain compatible after reconciliation; also test identity corrections.
6. Staff overrides and concurrently edited values are not overwritten; update-token precision is preserved.
7. Existing media/namecards/QR codes/profile ownership are untouched by crawler contact changes.
8. A valid 28hse raw description is considered by the v2 source policy, without changing legacy policy or bypassing staff overrides.
9. Changing an advertised listing total alone does not prematurely finish the v2 crawl or fake its count baseline; parser/challenge errors still block it.
10. A successful identical replay inside the quota window returns the prior result; a different new batch is quota-controlled.
11. A partial-success batch does not advance the complete baseline, but its accepted newer values cannot be undone by an older batch.
12. A receipt failure or conflict-ledger failure causes the entire accepted business transaction to roll back.
13. Two source scopes attempting to create/link the same exact unit cannot create contradictory targets; use the same writer-lock discipline.
14. A legacy publisher cannot overwrite v2-owned state sequentially after the lock is released; test the owner/policy fence.
15. The Property.hk route never starts a browser, fetches listing pages, or accepts a caller's arbitrary target property ID/publish authorization.
16. `GET /api/mls-sync` remains a status endpoint and returns a truthful status contract.
17. Property.hk absence remains disabled by default, and secondary active state does not revive primary delisted state.
18. A failed/blocked parser result remains failed even if it contains some usable records and fabricated-looking success metadata is supplied.
19. Conflicting duplicate source IDs within one payload cannot use last-row-wins behavior.
20. A commit-result timeout can be resolved by the same receipt without duplicate changes, observations, contacts or conflicts.
21. Property.hk-first then 28hse arrival preserves the existing property/public IDs and promotes automated source priority without erasing staff overrides.
22. Initial adoption does not turn all legacy imported values into fabricated staff overrides or erase genuine overrides when field ownership is unknown.
23. Advertisement counts, offer counts and branch-membership counts cannot be substituted for one another in baseline comparison.

Use real behavior assertions and database transaction tests where possible; static source-text tests alone do not prove rollback, concurrency or deduplication.

### 11.2 Commands and test wiring

Use the package manager and lockfile convention of the current checkout; do not create a second lockfile or upgrade unrelated dependencies.

These named scripts existed in the reviewed `package.json`; recheck before running:

```bash
npm run typecheck
npm run test:mls
npm run test:cron
npm run test:listing-search
npm run test:admin-properties
npm run test:property-experience
npm run test:control-plane
npm run check:migration-drift
```

Add and wire new tests to an appropriate named script, for example a **new** `test:property-sync` script, and to the relevant CI path. Do not merely create test files that no existing command runs.

Worker commands below are deliverables to implement, not existing scripts at the reviewed commit:

```bash
python3 -m venv scripts/property-sync/.venv
scripts/property-sync/.venv/bin/python -m pip install \
  -r scripts/property-sync/requirements.txt
scripts/property-sync/.venv/bin/python -m pytest \
  scripts/property-sync/tests
```

Use isolated test credentials for DB suites. Inspect their setup first; never point destructive integration-test fixtures at production just because `DATABASE_URL` is set.

Relevant existing DB scripts include:

```bash
npm run test:mls:db
npm run test:admin-properties:db
npm run test:public-performance:db
```

If modifying worker packaging or MLS container integration, also run:

```bash
npm run test:mls:cloudflare
npm run check:mls:cloudflare
```

Run lint/build checks appropriate to the touched files. `npm run build` does not replace type checking and its prebuild script requires configured site environment values. Missing environment or Bun/DB/browser tooling must be reported as blocked/skipped, not converted into a success claim or “fixed” by removing checks.

Separate four outcomes in the final report: offline parser/unit tests; API/service behavior tests; isolated DB integration tests; authorized live-site smoke tests. No live smoke test means no claim that current production selectors are verified.

---

## 12. Deployment and operational handoff

Deliver a runbook; do not perform these production actions automatically.

### 12.1 Configuration and secrets

Retain the MD's `PROPERTYHK_SYNC_URL` and `PROPERTYHK_SYNC_SECRET`. Keep secrets in managed environment/service files, never committed config, cron command arguments, snapshots or logs. Add placeholder documentation to `.env.example` as appropriate, without exposing real values.

Validate the submission endpoint's HTTPS origin. Reject redirects or revalidate them so a bearer token cannot be forwarded to an arbitrary host. Crawl URLs must stay within their explicitly allowed source scope.

Configure and document:

- verified branch URLs and parser versions;
- source/scope policy version;
- new-batch quota and request-size limits;
- freshness rules and Property.hk absence disabled;
- publisher ownership and disabled-by-default activation;
- observation/receipt retention and access controls;
- worker and canonical-writer lock behavior.

Only purge evidence in accordance with a defined retention policy that preserves any referenced baseline/receipt/history dependencies.

### 12.2 Schedule and cutover

Provide cron/systemd examples using the Python runner paths. The MD's 02:00/03:00 HKT sequence is an example; enforce dependencies using run outcomes, not an assumption that an earlier job finishes within one hour.

Before activating a new publisher:

1. Deploy backward-compatible schema and code with publishing disabled.
2. Run offline checks and isolated DB integration tests.
3. Validate source access and actual branch fixtures in an authorized environment.
4. Run shadow comparisons and obtain the existing required baseline/publication approval.
5. Establish the first full applied baseline without mass historical delisting.
6. Transfer the defined source/scope publication ownership, preventing a competing legacy path from applying contradictory policy.
7. Enable one authorized publisher path and inspect summaries/conflicts.

Do not infer the live Cloudflare/Vercel status from checked-in flags. Confirm deployed configuration through the operator's authorized process during activation.

### 12.3 Recovery paths

Document recovery for incomplete crawling, missing branch config, parser changes, count-drop rejection, auth failure, quota response, API timeout, DB rollback, commit-outcome-unknown, stale batch and identity ambiguity.

A transport timeout is recovered by replaying the original payload/receipt. A failed crawl is recovered with a new run after the cause is fixed. A genuine mass inventory drop requires controlled review/override evidence, not removal of the global completeness gate.

Rollback disables the new publisher and retains snapshots, receipts, source links, conflicts and public IDs. Do not delete v2 records or weaken constraints to make old code run over new data silently.

---

## 13. Deliverable checklist and final Codex response

The task is complete only when the code and evidence support the following, or a specific unresolvable prerequisite is clearly listed:

- [ ] Repository mapping for every relevant v2 requirement and section-3 difference.
- [ ] Deterministic 28hse and Property.hk Python workers, runners and frozen payload handling.
- [ ] Immutable snapshots, manifest and named-column CSV diff.
- [ ] New 28hse Node snapshot-apply bridge using shared server logic.
- [ ] New authenticated Property.hk HTTP receiving route and Python client.
- [ ] Source-ID-first upsert and versioned exact-unit matching.
- [ ] Source priority, staff override compatibility, whole contacts and conflict/provenance storage.
- [ ] Additive Neon migrations and source/check/type compatibility.
- [ ] Atomic receipt/publication/baseline behavior and coordinated writer ownership.
- [ ] Public ID, alias, offering and inquiry-target regression coverage.
- [ ] All T01–T28 cases traced to automated tests; repository-specific regressions added.
- [ ] Named test scripts/CI wiring and truthful executed/skipped results.
- [ ] Deployment, source configuration, scheduler, replay and rollback runbook.
- [ ] No Hermes/LLM runtime dependency in this pipeline; unrelated AI features preserved.
- [ ] No production activation, real-message sending or unapproved data rewrite performed.

Your final implementation response must contain:

```text
1. Current branch/commit and reviewed-baseline differences.
2. Implemented changes, grouped by worker / API / schema / matching / publication.
3. Changed files and existing modules reused.
4. Explicit specification-to-repository policy mappings.
5. Test commands actually executed and their results.
6. Tests not executed, with exact missing prerequisites.
7. Remaining live-source configuration/fixture verification, if any.
8. Migration, deployment, publisher cutover and rollback instructions.
9. Confirmation of what was NOT changed in production or unrelated app areas.
```

Do not report “production ready” if the three Property.hk URLs/selectors/ID semantics or live-source verification remain unconfirmed. Continue implementing testable components and fail-closed integration paths rather than fabricating those details.

---

## Appendix A. Review evidence and limits

### A.1 Reviewed baseline

All repository observations in this handoff refer to:

```text
repository: YNWAforever/earnestproperty
commit: b3c1929ab6e1758a6003d7b48c5a8e1c63163776
commit time: 2026-09-06T14:20:31Z
```

To inspect a pinned source in a GitHub session with repository access, use:

```text
https://github.com/YNWAforever/earnestproperty/blob/b3c1929ab6e1758a6003d7b48c5a8e1c63163776/<path>
```

No signed download URL, repository token, database secret or Cloudflare account identifier is needed in this instruction document.

### A.2 Evidence inventory

| Reference | Evidence inspected | Supports |
|---|---|---|
| R1 | `CLAUDE.md`, complete returned text | Framework, raw SQL/no ORM, server-only conventions, named tests, generated route tree, migration/config locations. |
| R2 | `package.json`, scripts and returned dependency excerpt | Actual MLS/test/CLI commands and existing workflow tooling. |
| R3 | `src/lib/mls/source-contract.mjs`, complete returned text | Existing source names, property-number key, v1 observation validation and hashing. |
| R4 | `src/routes/api.mls-sync.ts`, complete returned text | GET-only status route, auth pattern, publisher label. |
| R5 | `neon/migrations/20260817120000_dual_source_listing_sync.sql`, complete returned text | Existing MLS tables, uniqueness, source/link-reason/status constraints and field state. |
| R6 | `src/lib/mls/neon-lock.mjs`, complete returned text | Dedicated connection, shared advisory lock and cleanup discipline. |
| R7 | `src/lib/mls/sync-repository.d.mts`, complete first content section | Existing persistence/publication API, exact update tokens, statuses and proposal types. The large implementation file was not exhaustively audited for this handoff. |
| R8 | `src/lib/mls/health.mjs`, complete first content section | Advertised-count health checks, property-number validity, existing source-pair gates and baseline logic. |
| R9 | `src/lib/mls/sources/28hse-agent.mjs`, returned implementation excerpt including traversal | Source identity/access controls, advertised-count-dependent traversal and bounded fetch patterns. |
| R10 | `src/lib/mls/sources/old-site.mjs`, returned implementation excerpt | Actual earnestproperty.com seed URLs and separation from the requested Property.hk feed. |
| R11 | `src/lib/mls/match.mjs`, returned implementation excerpt | Legacy exact-property-number matching, strict observations and ambiguity handling. |
| R12 | `src/lib/mls/reconcile.mjs`, returned implementation excerpt | Staff-override detection, source priority, 28hse-description exclusion, media/provenance controls. |
| R13 | `neon/migrations/20260906040000_property_public_identity.sql`, complete returned text | Persistent public-group/member tables, insert/update triggers and alias-preservation behavior. |
| R14 | `src/lib/neon/property-identity.contract.test.mjs`, complete returned text | Public identity, offering and alias compatibility contract. |
| R15 | `workers/mls-container/wrangler.jsonc`, complete returned text | Committed Cloudflare container/workflow configuration and disabled publishing defaults, not live status. |
| R16 | `docs/audits/2026-09-06-property-data-audit.md`, complete returned text | Repository-documented history of alias groups and physical-field disagreements. Its data counts were not independently rechecked. |
| R17 | Scoped MLS directory/source trees | Existing module locations and the two inspected adapter files. |
| S1 | Supplied no-Hermes v2 specification, all 1,393 lines | Target requirements, fields, payload, source priority, lifecycle, Python workers, T01–T28 and rollout expectations. |

Do not cite an empty code-search result as proof that an implementation cannot exist elsewhere. Inspect the actual current source tree before creating or replacing files.

### A.3 Limits

This handoff is based on a read-only repository review and the supplied specification. It does not assert that every repository file was audited, that the large persistence implementation was fully read, that any test suite was executed, or that deployed database/configuration state was inspected.

Property.hk branch URLs, selectors and source-ID scope remain required verification inputs. No live 28hse/Property.hk crawl or source reuse authorization was established by this review. Preserve these limits in the implementation report until there is actual evidence to replace them.

### A.4 Supplemental framework reference

The official TanStack Start server-route guide was consulted only to confirm the general server-route handler pattern, not to alter the business specification or upgrade the repository's installed packages:

```text
https://tanstack.com/start/latest/docs/framework/react/guide/server-routes
```

The checked-in package versions and functioning route examples remain the implementation baseline.
