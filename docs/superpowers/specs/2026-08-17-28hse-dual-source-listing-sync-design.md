# 28Hse Dual-Source Listing Synchronization Design

Date: 2026-08-17

## Status

Approved in design by the user. This document defines the synchronization design only. It does not authorize a production migration, live scrape, deployment, scheduler change, or database write. Implementation planning begins after the user reviews this written specification.

## Background

Earnest Property already has a TypeScript/Node MLS pipeline that discovers old-site listing pages, fetches listing details, normalizes them, and upserts the public Neon-backed catalogue. The application also has a protected `/api/mls-sync` route, a scheduled Vercel entry point, and a Cloudflare job worker.

Earnest's public 28Hse agent profile at `https://www.28hse.com/agent/540` provides a second first-party listing feed. The original scraper brief proposed a separate Python, crawl4ai, pandas, and CSV pipeline. The approved design instead extends the existing Node pipeline because the current 28Hse pages expose the required listing data in server-rendered HTML and the repository already has the relevant parsing, normalization, import, safety, and Neon integration patterns.

The old Earnest website and the 28Hse agent profile remain permanent sources. Their observations are used to cross-check listings, while the public website exposes one canonical listing whenever an exact high-confidence identity match is available.

## Validation Basis

Design-time validation on 2026-08-17 confirmed that the public agent index and a representative public detail page exposed usable listing data in returned HTML, so the existing Node fetch-and-parse approach is the default. The observed `robots.txt` policy contained `User-agent: *` and `Allow: /`. Both findings can change and therefore do not replace the run-time access and template checks in this design. Observed inventory counts also changed between requests, so no fixed listing count or hard-coded final page is a valid completeness rule.

The repository's focused pre-design baselines passed:

- MLS: 12 of 12 tests.
- Migration: 10 of 10 tests.
- Cron: 4 of 4 tests.

These 26 passing checks show that the existing pipeline is a viable integration point; they are not evidence that the new adapter has been implemented or live-published.

## Approved Decisions

- Run one integrated Node synchronization pipeline on an Earnest-controlled VPS.
- Keep both the old Earnest website and 28Hse agent profile as permanent sources.
- Publish only content that Earnest owns or is authorized to republish.
- Do not republish 28Hse-generated mortgage, transport, school, estate editorial, platform, or engagement data.
- Preserve every source advertisement as an auditable observation but expose one canonical public listing for an exact match.
- Match across sources only by normalized Earnest property number plus deal type.
- Never fuzzy-merge an uncertain match. Keep missing or ambiguous identifiers separate and flag them for review.
- Protect staff overrides. For automated values, prefer 28Hse over the old site.
- Rehost eligible Earnest-owned listing images into owned storage and deduplicate them by content hash.
- Publish automatically only after the run passes health gates. Quarantine individual invalid records and abort unsafe batches.
- Use the existing `inactive` canonical status for a delisted property; record the delisting reason and time separately.
- Retain normalized database observations and change history indefinitely. Retain VPS crawl artifacts for 90 days.
- Keep Telegram notification support out of this implementation; reports and structured summary output will allow a later adapter.

## Goals

- Synchronize Earnest's sale and rental inventory from both approved public sources every day.
- Detect new, changed, unchanged, and inactive listings without turning incomplete crawls into false delistings.
- Deduplicate exact cross-source matches into one public property.
- Preserve source provenance, raw values, reconciliation decisions, and change history.
- Let a healthy 28Hse run publish safe new or changed records even when the old site is temporarily unavailable.
- Rehost eligible listing media so public pages do not depend on 28Hse assets.
- Produce deterministic, reviewable run reports and failure diagnostics.

## Non-Goals

- Scraping the wider 28Hse marketplace or other agents.
- Bypassing authentication, CAPTCHA, rate limits, robots directives, access blocks, or technical protections.
- Copying 28Hse-written listing descriptions, mortgage calculations, transport data, school data, estate editorial content, view counts, maps, floor plans, QR codes, VR tours, or branded platform assets.
- Using fuzzy address, price, area, title, image, or geospatial similarity to merge listings automatically.
- Replacing the public `properties` catalogue with a new public read model.
- Building a review dashboard, Telegram integration, or general-purpose crawler framework in the first implementation.
- Allowing the Vercel cron and VPS process to publish independently.

## Source and Content Boundaries

The 28Hse adapter is limited to public pages belonging to agent profile `540`. Each run must verify that the page still identifies Earnest Property and exposes company licence `C-018613` before accepting observations.

The crawler must check the applicable robots policy at run time. A `403`, `429`, CAPTCHA, unexpected login page, explicit prohibition, identity mismatch, or other access challenge stops the affected crawl. It must not rotate identities or attempt a bypass. A permissive robots file is an operational signal, not a grant of copyright or contractual permission.

Only first-party listing facts and copy that Earnest owns or is authorized to reuse may reach the canonical public record. Source-only fields may be retained internally for audit when permitted, but 28Hse-generated content must not be published. The product owner remains responsible for confirming the right to reuse Earnest's content and images from the profile.

## Architecture

### 1. VPS Orchestrator

A single Node command owns the daily dual-source cycle. It acquires a database advisory lock, creates the run record, calls each source adapter, evaluates health, reconciles observations, prepares media, and publishes the accepted batch.

The VPS scheduler runs the command daily at 02:00 Asia/Hong_Kong. A second invocation exits without work while the advisory lock is held. Scheduler, environment, and secret setup remain deployment concerns and must not be hard-coded.

The existing Vercel `/api/mls-sync` endpoint must stop acting as an independent scheduled publisher when VPS publication is enabled. It may remain as a protected manual trigger or health endpoint if it invokes the same orchestration boundary and lock. Vercel, Cloudflare, and VPS entry points must never create concurrent publishing paths.

### 2. Source Adapters

Each source adapter implements the same narrow contract:

1. Discover all sale and rental listing pages.
2. Fetch each detail page with source-appropriate pacing and retry rules.
3. Return raw source records plus discovery and parsing diagnostics.
4. Normalize the record into a shared source-observation shape without applying cross-source precedence.

The first adapters are:

- `old_site`: the current Earnest website parser, retained as permanent verification evidence.
- `28hse_agent_540`: a new fetch-and-HTML-parser adapter for the public Earnest agent profile.

The default 28Hse transport is the existing Node HTTP and Cheerio-style parsing stack. Browser automation is not a first-line dependency. It may be proposed later only if captured fixtures and a live VPS dry run prove that required public content is no longer available in returned HTML.

Requests to 28Hse use a randomized delay of two to three seconds and at most three attempts per page with bounded backoff. The adapter follows discovered sale and rental pagination; it does not hard-code a page count or infer deal type from the numeric listing ID. Deal type comes from the discovered link or page content.

### 3. Observation Store

Every successfully normalized source advertisement is stored as an immutable observation associated with its run. The observation preserves:

- Source name and external listing identifier.
- Raw source URL and deal type.
- Raw and normalized Earnest property number.
- Source fields used for reconciliation.
- Raw media references and media eligibility decisions.
- Discovery time, fetch time, parse version, and content hash.
- Validation state, quarantine reasons, and parse warnings.

New runs insert new observations rather than overwriting earlier evidence. Identical content can share a content hash, but the run-to-observation relationship remains auditable.

### 4. Canonical Matcher

The matcher joins observations only when both of these normalized keys are equal:

- Earnest property number.
- Deal type (`sale` or `rent`).

Normalization may remove presentation-only differences such as Unicode width, surrounding whitespace, repeated internal whitespace, and letter case. It must preserve the original value and must not remove meaningful characters or infer an identifier from title, address, price, area, image, or source listing ID.

An external source ID is not a canonical property identity. A 28Hse listing ID and an old-site detail ID are stored as separate source identities.

If the property number is missing, malformed, or maps to multiple candidate canonical records for the same deal type, the matcher creates no automatic link. The observation remains separate, is flagged for review, and cannot overwrite another property. This conservative rule may temporarily leave apparent duplicates visible, but it prevents false merges.

### 5. Reconciler

Reconciliation is field-aware:

1. An active staff override wins for the field it protects.
2. Otherwise, a present and valid 28Hse value wins.
3. Otherwise, a present and valid old-site value is used.
4. An absent, empty, quarantined, or invalid higher-priority value does not erase a valid lower-priority value.

The reconciler records which observation supplied each changed canonical field. View counts and other engagement counters are excluded from change detection and canonical reconciliation.

The public route layer continues to read only canonical `properties`. It does not join or reconcile live source observations during a user request.

### 6. Media Ingestor

The media ingestor accepts only images that are known to be Earnest-owned and eligible for republication. It rejects or quarantines:

- 28Hse branding or platform graphics.
- QR codes, maps, floor plans, and VR assets.
- Images with uncertain ownership.
- Unsupported types, invalid payloads, and files outside configured size or dimension limits.

Eligible images are downloaded conservatively, validated by actual MIME type, hashed by content, and copied to owned object storage. An existing owned object with the same hash is reused. Canonical listings never hotlink 28Hse and reference only owned URLs. A new listing must have its selected primary image prepared before publication. An existing listing may retain its current owned media when the incoming observation has no newly eligible image; if the reconciler selects a replacement image and that image cannot be prepared, the listing is quarantined from that publication batch. Successfully uploaded but unreferenced objects are removed later by a separate safe orphan-cleanup process.

## Data Model

The existing `properties` table remains the canonical public catalogue. The implementation adds focused provenance tables rather than overloading `legacy_detail_id` with multiple source identities.

### `listing_sync_runs`

Stores one row per orchestration attempt:

- Run identifier and scheduled date.
- Start and finish timestamps.
- Mode: shadow or publish.
- Overall and per-source status.
- Discovery, fetch, parse, quarantine, match, publish, and inactivity counts.
- Previous-success and seven-run-median comparisons.
- Parser/configuration version.
- Failure code and safe diagnostic summary.

### `listing_source_observations`

Stores immutable normalized source evidence. Its logical identity includes run, source, external listing ID, and deal type. It includes raw values, normalized values, hashes, URLs, validation state, and quarantine reasons. Source-specific payload details should use a versioned JSON field only where a stable typed column is not warranted.

### `property_source_links`

Maps a canonical property to a source advertisement. It enforces one active mapping for `source + external_listing_id + deal_type`, records the exact-match key and link reason, and tracks first/last healthy sightings. This table, not the current `properties(legacy_detail_id, deal_type)` constraint, owns multi-source identity.

### `listing_change_events`

Records canonical lifecycle and field changes:

- Property and run identifiers.
- Change type: new, changed, inactive, reactivated, or link change.
- Field name where applicable.
- Old and new values.
- Winning source observation.
- Reason and timestamp.

Unchanged listings do not need one event per field; the run ledger and observation prove their successful sighting.

### Media Records

Media provenance records store source URL, content hash, owned object URL, detected MIME type, size, dimensions where available, eligibility state, rejection reason, and property association. The schema must allow one owned object to be reused by multiple observations without duplicate uploads.

### Canonical Status Compatibility

The existing `inactive` value represents a delisted public listing. The implementation must not introduce a conflicting `delisted` enum value merely to mirror report wording. The change ledger records that the inactivity reason was source delisting and stores the effective date.

## Daily Data Flow

1. Acquire the advisory lock and create a `listing_sync_runs` row.
2. Fetch and evaluate the current robots policy and 28Hse company identity.
3. Discover every sale and rental page from both source adapters.
4. Fetch detail pages with the configured pacing, at most three attempts, and per-page diagnostics.
5. Normalize observations and quarantine invalid identifiers, invalid prices, malformed pages, unsafe media, and parse failures.
6. Evaluate source completeness and run health before computing any public change.
7. Persist immutable observations and update healthy-sighting metadata.
8. Match exact property-number and deal-type identities.
9. Reconcile staff overrides, 28Hse values, and old-site fallback values.
10. Prepare and hash-deduplicate eligible media in owned storage.
11. Compute new, changed, unchanged, reactivated, and inactive candidates. Exclude view counts.
12. Re-evaluate batch gates, then publish canonical database changes and change events in one transaction.
13. Write CSV and JSON summaries, diffs, quarantines, and diagnostic artifacts.
14. Mark the run successful, degraded, quarantined, or failed and release the lock.

An unexpected process failure marks or later reconciles the run as failed. Rerunning the same scheduled date is idempotent: immutable observations may be reused or associated safely, source links remain unique, media hashes prevent duplicate objects, and canonical changes are not emitted twice.

## Health Gates and Failure Handling

### Healthy 28Hse Source

28Hse is healthy only when all of the following hold:

- Agent identity and licence `C-018613` match.
- Robots policy permits the requested public paths.
- Sale and rental discovery both terminate normally.
- No page gaps, repeated pagination loops, access challenges, or unexpected page templates are detected.
- The unique listing count is non-zero.
- The count is not more than 30 percent below either the previous successful run or the rolling median of the previous seven successful runs.
- At least 98 percent of discovered detail pages parse successfully after at most three attempts.
- Duplicate external IDs, missing core identifiers, invalid deal types, and invalid prices remain within explicit fixture-backed tolerances.

Failed detail pages inside the allowed threshold are quarantined individually and cannot generate canonical changes or inactivity evidence. The threshold does not excuse incomplete pagination or an access challenge.

The count gate applies to the combined inventory and separately to each deal type that has a non-zero historical baseline. During shadow bootstrap, the first complete and manually reviewed run establishes the initial baseline. Later shadow runs compare against the previous complete run and the median of up to seven available complete runs. Automated publication cannot begin until the required seven healthy shadow runs have established sufficient history.

### Healthy Old-Site Source

The old-site adapter is healthy only when every configured listing-index family terminates normally, its applicable robots policy permits access, no page gap, loop, challenge, or unexpected template is detected, the same combined and per-deal count gates pass, and at least 98 percent of discovered details parse after at most three attempts. Its failed details follow the same quarantine and inactivity rules as 28Hse observations. The 28Hse-specific agent identity check does not apply to the old site.

### Publication Rules

- A fully healthy 28Hse run may publish safe new, changed, or reactivated listings after reconciliation and media preparation.
- A temporarily unhealthy old-site adapter puts the run into degraded mode. Healthy 28Hse new and changed records may still publish, but no listing may become inactive.
- An unhealthy 28Hse adapter blocks canonical publication for the run. Old-site observations may still be retained as evidence, but they cannot replace the authoritative automated feed.
- A listing becomes inactive only after it is absent from both sources on two consecutive daily runs in which both sources were healthy and the listing was eligible for comparison.
- A quarantined or failed observation is unknown, not absent, and cannot advance the inactivity counter.
- A count drop greater than 30 percent, incomplete discovery, database failure, reconciliation invariant failure, or advisory-lock failure leaves the public catalogue unchanged.
- Database publication is atomic. If any canonical write or change-event write fails, the transaction rolls back.
- Media objects are prepared before the database transaction. A failed listing upload removes that listing from the batch; orphan cleanup handles any already uploaded, unreferenced objects safely afterward.

## Reporting, Retention, and Operations

Each run emits structured JSON logs and a stable process exit code. Logs must include the run identifier and aggregate counts without secrets or full page payloads.

The VPS retains these artifacts for 90 days:

- Per-source discovery snapshots.
- Normalized CSV or JSON observation snapshots.
- New, changed, reactivated, and inactivity-candidate diffs.
- Quarantine and parse-failure reports.
- Diagnostic HTML for failed or changed page templates where retention is permitted.
- A summary containing new, changed, inactive, unchanged, quarantined, and per-source health counts.

Normalized database observations, source links, run ledgers, and canonical change history are retained indefinitely unless a later approved data-retention policy changes that rule.

Reports must make degraded runs and blocked inactivity decisions obvious. A future Telegram adapter may consume the structured summary; the initial implementation does not send messages.

## Testing Strategy

### Parser and Fixture Tests

Maintain sanitized, immutable fixtures for:

- 28Hse agent sale and rental indexes.
- Multiple pagination pages and the final page.
- Detail variants for sale, rent, missing optional fields, and changed layout.
- Empty, malformed, 404, rate-limit, CAPTCHA, login, and access-challenge responses.
- Old-site records used in exact-match and conflict cases.

Tests cover property IDs, source links, deal types, Earnest property numbers, title, estate, district, price, saleable and gross area, rooms, tags, dates, null handling, and eligible image selection. Pagination tests prove that the adapter detects gaps, repeated pages, unexpected loops, and normal termination without a hard-coded page count.

### Matching and Reconciliation Tests

Tests prove that:

- Formatting-only identifier differences normalize to one exact key.
- Sale and rental advertisements with the same property number remain separate canonical deal records.
- Missing, malformed, or ambiguous property numbers do not merge.
- Staff field overrides beat both automated sources.
- Valid 28Hse values beat valid old-site values.
- Missing or invalid 28Hse fields fall back without erasing valid old-site values.
- View-count changes do not produce canonical change events.
- Repeated identical runs are idempotent.

### Gate and Lifecycle Tests

Tests exercise the 30 percent drop comparisons, seven-run median, 98 percent parse threshold, page loops, access challenges, identity mismatch, per-record quarantine, degraded old-site mode, blocked 28Hse mode, two-consecutive-healthy-day inactivity, reactivation, advisory locking, and transaction rollback.

### Media Tests

Use a fake object store to test MIME validation, size limits, content hashing, duplicate reuse, platform-asset rejection, failed uploads, canonical owned URLs, and safe orphan selection. Tests must not depend on live third-party media.

### Database and Regression Tests

Run database integration tests only against an isolated disposable database. Cover migrations, uniqueness, source links, atomic publication, rollback, idempotency, locks, field provenance, and lifecycle history.

The repository's existing focused suites remain required baselines:

- MLS tests.
- Migration tests.
- Cron tests.

A live 28Hse request is not part of deterministic CI. Live validation happens from the authorized VPS during shadow rollout.

## Staged Rollout

### Phase 1: Fixtures and Schema

Capture approved fixtures, add the source-adapter contract and persistence schema, and keep `publish=false`. Schema changes are applied only after separate production authorization.

### Phase 2: Observation Backfill

Populate source observations and proposed source links without changing the public catalogue. Produce ambiguity, duplicate, conflict, and media-eligibility reports for review.

### Phase 3: Seven-Day Shadow Run

Run the complete VPS cycle for seven consecutive healthy daily runs with publication disabled. Compare discovered counts and proposed canonical changes with the current catalogue. Review every proposed exact cross-source link, conflict category, inactivity candidate, and quarantine class. The phase passes only with zero known false deactivations.

### Phase 4: Controlled Cutover

Enable VPS publication and disable the independent Vercel cron publisher in the same release. Confirm the advisory lock and protected manual path before the first published run. Deployment, scheduler mutation, production secrets, and live writes require separate explicit authorization.

### Phase 5: Seven-Day Monitored Publication

Monitor the next seven successful daily runs. Review run health, published diffs, quarantine counts, source conflicts, media failures, and inactivity decisions each day. Any unexplained systemic anomaly returns the pipeline to shadow mode.

## Rollback

The immediate rollback is to disable the VPS publish flag or schedule and restore the prior protected sync operating mode if needed. Disabling publication does not delete observations or history.

Canonical changes are reversible from `listing_change_events` and the last successful publication state. A rollback tool must create compensating history rather than delete audit records. Database schema rollback is a separately reviewed migration and is not required merely to stop publication.

Object storage cleanup must never run as part of emergency rollback. Unreferenced objects remain harmless until a later verified cleanup.

## Acceptance Criteria

- Both sale and rental inventory are discovered completely from both permanent sources during healthy runs.
- Every source advertisement has auditable provenance and a stable source identity.
- Exact normalized Earnest property number plus deal type produces one canonical public listing.
- Uncertain matches never fuzzy-merge and are visible in review reports.
- Staff overrides remain protected, and 28Hse wins valid automated conflicts over the old site.
- View-count changes never create public listing changes.
- Incomplete, challenged, or anomalous crawls never publish unsafe changes or false inactivity.
- Inactivity requires absence from both healthy sources on two consecutive healthy daily runs.
- Eligible images are served from owned storage and hash-deduplicated; ineligible platform assets are not republished.
- Publication is idempotent and database-atomic.
- Required CSV/JSON reports, diagnostics, run counts, and exit codes are produced.
- Parser, matching, reconciliation, health-gate, media, database, MLS, migration, and cron tests pass.
- Seven consecutive healthy shadow runs complete with zero known false deactivations.
- Seven subsequent monitored publication runs complete without an unresolved systemic anomaly.

## Implementation Boundary

This specification is focused enough for one implementation plan, but the plan should preserve staged checkpoints: schema and fixtures, adapters and observations, matching and reconciliation, media, publication gates, VPS operation, shadow validation, and controlled cutover. Reaching a later checkpoint does not imply authorization for production migration, credentials, live crawling, scheduling, deployment, or publication.
