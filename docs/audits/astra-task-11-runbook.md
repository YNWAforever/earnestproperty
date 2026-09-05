# Task 11: operational readiness and release runbook

Date: 2026-09-06. Working checkout: `audit-20260905`. **NO-GO for production.** The development handoff identifies the source branch; the incomplete release packet still lacks verified current CI, staged provider/staff acceptance and recovery evidence. This document plans the remaining work and does not authorize migrations, delivery, configuration or deployment.

## Verified development evidence

The coordinating runner reports that all **38 local migrations** were applied to the approved disposable Neon target, project `dawn-meadow-79190048`, branch `br-quiet-hat-aoxbj2ue`: upgraded Preview database `neondb` and empty database `astra_empty_20260905`. Verified database fixtures: bootstrap 1, CRM 1, CMS 16 groups, outbound 3, large paging, and public query fixture 1. No unreported numerical count is assigned to large paging. The accompanying JSON stores these observations separately from release acceptance because they are not yet linked to an immutable release commit and evidence URL.

Root verified14/14 combined production-build Chromium cases; see astra-tasks-7-11-handoff.md for exact scope and transfer results. This does not establish all public or authenticated journeys, axe acceptance, transfer budgets, or production field Web Vitals. Prior PR #112 / baseline `6d5c016` CI and Vercel success concern older code and must not populate current release proof fields.

## Configuration inventory: names and sources only

The authoritative variable-to-source map is `CONFIGURATION` in `scripts/operations/release-readiness.mjs`. It covers:

| Capability | Variables | Operator source |
| --- | --- | --- |
| Database/Auth | `DATABASE_URL_UNPOOLED` or `DATABASE_URL`; `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` | Exact Neon project, branch, database and Auth settings |
| WhatsApp Bot/history | `WOZTELL_ENABLED`, `WOZTELL_BOT_ACCESS_TOKEN`, `WOZTELL_OPEN_API_TOKEN`, `WOZTELL_CHANNEL_ID`, `WOZTELL_CHANNEL_SECRET` | Approved WozTell channel and Bot/Open API settings |
| Uploads | `BLOB_READ_WRITE_TOKEN` | Intended Vercel Blob store |
| MLS evidence/publication | `CLOUDFLARE_ACCOUNT_ID`, `MLS_EVIDENCE_BUCKET`, `MLS_R2_ACCESS_KEY_ID`, `MLS_R2_SECRET_ACCESS_KEY`, `MLS_PUBLISH_ENABLED`, `MLS_MEDIA_RIGHTS_CONFIRMED` | Restricted Cloudflare R2 credentials and explicit rights/publication approval |
| YouTube | `YOUTUBE_API_KEY` | Google Cloud project credential |
| AI Gateway | `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL`, `AI_GATEWAY_EMBEDDING_MODEL` | Approved Gateway project/models |
| Content copilot/research | `OPENCODE_GO_API_KEY`, `OPENCODE_GO_BASE_URL`, `OPENCODE_GO_MODEL`, `TAVILY_API_KEY` | Approved provider settings |
| GA4 | `VITE_GA4_MEASUREMENT_ID`, `VITE_GA4_MANUAL_EVENTS_CONFIRMED` | Selected GA4 web stream; confirmation only after Enhanced Measurement is disabled for this manual-event integration |
| Operations | `CRON_SECRET`, `CONTROL_PLANE_APPROVAL_SECRET` | Server-only operator-managed configuration |

Run `node scripts/operations/release-readiness.mjs --evidence docs/audits/astra-release-evidence.incomplete.json` in the intended controlled environment. The command reads configuration presence and the supplied local file; it makes no provider request. It prints variable names/presence and structural missing-gate labels, never credential values. A developer shell inventory is not evidence of deployed Preview or production configuration. Collect each environment independently; do not copy secrets into reports, URLs or source files.

GA4 was selected, but no actual measurement ID or manual-events confirmation has been supplied. Tracking therefore remains disabled. Configuration presence and an enabled flag are distinct from successful provider evidence. The readiness evaluator validates completeness, status labels, HTTPS evidence references and matching commit identifiers; it does not verify the truth/content of external evidence, perform a restore, inspect deployment identity or grant approval. Even a complete packet returns `productionAuthorized: false`.

## Remaining blocking acceptance

- Freeze the intended change set into an exact 40-character commit and obtain passing required CI and a matching Preview deployment. Record durable evidence URLs without credentials or query strings. Repeat affected checks after changes; do not relabel old observations as current-commit results.
- Supply an approved staff staging URL and synthetic staff accounts/roles. Verify server role/ownership scope, CMS save/reopen/restore/publish/archive and concurrent drafts, CRM search/links/consent, upload recovery, and WhatsApp retry/ambiguous-delivery behavior. Record p50/p95 duration, query count, response size and fixture scale. These measurements are not available yet.
- Complete the public and private browser journeys, privacy document transitions, forms without real submissions, gallery/video/saved-listing/pagination/back navigation, keyboard and axe checks. Record like-for-like mobile transfer/visual measurements; local lab results do not establish production field targets.
- Obtain approved positive provider test plans and recipients. Distinguish disabled configuration, explicit provider rejection, timeout/unknown outcome, database failure, exhausted retries, job-lease recovery and rollback failure. Use synthetic/fake delivery until actual provider/recipient actions have explicit authorization. Never blindly retry an ambiguous outbound send; reconcile durable intent/provider evidence first.
- Collect read-only MLS and YouTube last-successful-run and last-content-observed timestamps with source IDs and observed time. Evaluate freshness against the expected schedule. Historical public listing dates alone prove neither freshness nor failure. Keep MLS media-rights and publication gates intact.
- Record migration drift monitoring success for the exact release. Compare the complete ordered migration manifest/checksums against the intended target before preparing the deployment delta; the 38-file disposable inventory is not a production execution instruction.
- Supply exact production database target, approved test recipients, monitoring owner, restore proof and a concrete rollback artifact/action. All remain unspecified. Complete `providerCapabilities` and `syncFreshness` evidence independently of injected `providerFailures` evidence.

## Planned production order, after final specific approval

1. Assemble the exact commit, immutable deployment, ordered target-specific migration delta, verified backup/restore record, approved provider switches/test recipients, monitoring owner and rollback plan into a reviewable packet. The release JSON must pass structural validation and its evidence must be independently reviewed.
2. Obtain approval for that specific production migration/deployment/provider action, identifying target, scope and order. Disposable Preview testing approval does not authorize production. No execution begins from this runbook alone.
3. Establish the approved backup/checkpoint and any required write/worker pause; confirm target identity and recovery procedure. Apply only the reviewed migration delta in dependency order. Validate constraints, public counts, staff scope, draft isolation and lead links before advancing.
4. Deploy the exact approved build. Verify representative public and staff flows against that deployment while keeping unapproved outbound/publication/provider features disabled. Enable only the approved integrations, one capability at a time, using the agreed test cohort and diagnostic IDs.
5. Check errors, queue/lease state, ambiguous sends, projection integrity, uploads, analytics privacy and source freshness against recorded acceptance limits. The named owner monitors the agreed observation window and records the result.

## Stop and rollback

Stop progression on migration/schema validation failure, unauthorized scope exposure, lost drafts/links, incorrect publication visibility, failed persistence, duplicate or ambiguous delivery, or failed deployment acceptance. Disable/stop further affected dispatch and publication using the approved control path; preserve bounded diagnostic IDs and state for reconciliation. Do not automatically re-send uncertain deliveries.

For an application-only regression, redeploy the approved prior immutable artifact only after checking compatibility with the migrated schema. Database rollback is not automatically achieved by redeployment: use the rehearsed target-specific restore/recovery procedure, with approved write pause and reconciliation of writes since the checkpoint. Do not improvise destructive down-migrations or delete customer data. The production target, rollback artifact, RPO/RTO, restore proof and responsible owner must be concrete before release approval.

The accompanying `astra-release-evidence.incomplete.json` intentionally remains incomplete and must fail readiness validation. No production/provider action was performed while writing these documents.
