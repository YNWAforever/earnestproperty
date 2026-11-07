# Production writer control register and approval packet

Task 5's register and validator are **implementation-ready locally**; no live
fence activation, drain, per-writer denial proof or reopening has occurred.
The concrete task-5 deliverables are the sanitized
[36-control register](writer-control-register.json) and the
[separate activation, bounded acceptance-access and reopening requests](writer-fence-approval-request.md).
They supersede the preliminary proposal below where it lacks exact scope or
pre-state. The register is a **BLOCKED_NOT_ACTIVATED proposal**, never live proof
or an execution capability. Willy remains owner without action approval.
Amended generation 02 pins the original evidence/capture times and expiry; it
does not refresh them. Acceptance access has its own narrowly scoped approval
before general reopening. Valid upload-receipt retries require application and
DB metadata denial proof; Blob denial alone cannot prove finalization is fenced.

Captured GitHub metadata shows `OWNER_PUBLICATION_DAILY_ENABLED=true`,
`OWNER_PUBLICATION_MANUAL_APPLY_ENABLED=true`, `PROPERTY_SYNC_DAILY_ENABLED=true`,
`PROPERTY_SYNC_OBSERVABILITY_ENABLED=true`, `IMPORT_TARGET_ENV=production` and
`IMPORT_BLOB_TARGET_ENV=production`. Publication, manual dispatch and metadata
finalizers therefore require concrete controls. Current run/queue drain is not
proven. The supplied writer JSON contains no Cloudflare trigger fields; the
register labels cron expressions as repository configuration pending live proof.

Exact provider ingress rules, complete deployment/credential-holder inventory,
database identity isolation and Blob deny mechanisms remain unresolved external
steps requiring owner review and separate approval. No provider changes are made
or inferred. Unknown writers/state cannot be cleared by `fence=true`.

## Preliminary design retained for context

Status: **designed, not activated or proven**. No production permissions, sessions, jobs, triggers or access states were changed. This document is not an executable maintenance switch.

## Evidence and scope

An owner session at 2026-11-05 20:48 SGT used PostgreSQL-enforced `REPEATABLE READ READ ONLY`. It observed zero articles, zero article revisions and 95 migrations. `neondb_owner` owns articles, shared CMS revisions, media assets and migration history, and has BYPASSRLS and CREATEROLE. Thirteen idle owner sessions and one active owner session were visible. Session counts are a point-in-time observation, not drain evidence; the active session includes the collector.

The generic CMS revision engine, the new blog repository, direct SQL/importers and media uploads all require consideration. Revoking staff access alone is insufficient. A table owner can bypass ordinary grants or undo a trigger, and privileged provider sessions remain outside application authorization.

| Writer | Evidence | Required control and reopening |
| --- | --- | --- |
| Current and old Vercel CMS/server functions | `admin-cms.server.ts`, generic CMS mutation functions, deployment aliases | Block mutation traffic across custom domains and immutable deployment URLs; drain outstanding requests. Restore exactly the saved routing/access state after acceptance. |
| New blog editor/settings/category mutations | `blog-repository.server.ts`, migration `20261105140000` | Keep mutation access closed through migration, import and artifact verification; initially admit only approved acceptance actors. |
| Content copilot and shared CMS revisions | `content-copilot-repository.server.ts`, `cms_content_revisions` | Include copilot publish/draft paths. Locking shared revisions affects other CMS resources; plan and announce that downtime. |
| Scheduled workflows and worker jobs | `.github/workflows/property-sync-daily.yml`, price/status workflow, `workers/` | Inventory production credentials and active runs with platform owner. Pause only identified conflicting writers or use a reviewed broader maintenance window. Preserve current enablement values; do not enable previously disabled jobs on reopen. |
| Direct SQL, importers, migration tools, provider/admin consoles | Live owner privileges and existing owner sessions | Establish exclusive operator control and freeze privileged changes. Separate release-session credentials from runtime credentials before relying on role fencing. Enumerate holders; no secret values in evidence. |
| Media upload and processing | `api.admin.media.upload.ts`, `media-upload-service`, Vercel Blob adapter | Pause upload/finalization/deletion/variant jobs; drain pending work; preserve object references and bytes. Database locks alone do not fence Blob writes. |
| Staff reactivation and access-management paths | Existing staff/auth controls | Prevent another admin from reopening access during cutover; capture prior access states and restore only those states. |

## Proposed mechanism and evidence required

1. Platform owner records the exact routing/job controls, immutable deployment URLs, active invocations and credential consumers. The present metadata does not enumerate every holder of the shared owner connection. Do not claim complete writer coverage until this is signed off.
2. Database owner chooses a sustained fence with a separate release identity and an independently verified privileged-operator freeze. A shared owner role is not a safe allowlist: allowing that role also allows old application instances. Creating roles, changing grants, rotating credentials, installing a write guard or terminating sessions each requires a separately approved production change. No speculative commands are supplied as approved operations.
3. Under the sustained fence, acquire bounded transaction locks on article/revision/category/settings/feature/map/receipt and migration-ledger tables, then recheck the complete inventory. These locks protect the migration/import transaction only; COMMIT releases them, so they cannot replace the sustained fence through deployment verification. Before new tables exist, take locks on the existing baseline tables and acquire new-table locks after DDL in the same controlled transaction.
4. Prove rejected writes from each former writer and drain completion. Do not perform probe writes in production under this preparation authorization. Record target, role, source deployment/job, rejection, time, outstanding transaction count, fence generation and operator. No queued writes may leak through when locks release.
5. Keep the fence active through fresh backup, manifest approval, migration/import, artifact activation, public checks and private acceptance. Reopening is a distinct approved step after expected outcomes pass. On failure, preserve the fence and use the bounded recovery path; do not automatically restart jobs or reactivate staff.

## Gate disposition

Willy is the user-confirmed platform/deployment and database/recovery owner. Writer inventory is concrete but provider/credential-holder coverage and exact controls remain **BLOCKED** pending target-specific control review and proof. Owner assignment does not authorize activation of the fence. No claim of a proven all-writer pause is made. This is a substantive production prerequisite, not a missing boolean that a CLI flag may override.
