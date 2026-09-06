# Unified admin property management — implementation and rollout review

Approved model: one canonical property number, one admin row, one management page. Branch: `codex/unified-admin-properties`.

## Delivered behavior

- `/admin/listings` groups before pagination and shows sale/rental prices and statuses together, with exact property count, search including old aliases, estate/agent/type/status filters and current/all views.
- Existing source UUID edit links resolve the same workspace and select their sale/rental scope. Shared data/photos, sale and rent are saved independently. Source records and enquiry references remain intact.
- Only changed shared fields are saved; explicit conflict confirmation can deliberately unify the currently displayed value. Switching scope warns about unsaved work. Uploads and save operations prevent conflicting edits.
- Separate sale/rental withdrawal and a confirmed whole-property withdrawal. Historical sources remain visible, and agents only see/edit authorized offerings.
- Persistent manual overrides survive source imports and new aliases. Atomic version checks reject stale saves. Source snapshots and transactional audit preserve evidence.
- Manual properties remain grouped after adding a second offering and changing physical facts. Staff handover updates protected assignments so future imports cannot restore departed staff.
- Public property introduction remains separate from offering-specific notes.

## Validation

- Focused management unit/contract checks: 4 Node tests and 4 Bun tests passed.
- Admin route regressions: 38 passed.
- Property experience regressions: 141 passed.
- MLS regressions: 603 passed.
- Disposable PostgreSQL: 2 suites passed on approved branch `br-quiet-hat-aoxbj2ue`, each using and dropping an isolated schema. Covers grouping, latest withdrawn sources, access isolation, paging, stale versions, concurrent saves, rollback on audit failure, source imports, manual identity and staff handover.
- Synthetic browser verification: single grouped row, old rental link, rent-only and changed-shared payloads, explicit baseline conflict resolution, unsaved switch guard, cancel whole-property withdrawal, preserve draft on conflict and 390px mobile layout. Fixture requests block real admin writes.
- TypeScript, targeted lint and production build checked locally.
- Independent review findings corrected; public shared/offer copy rendering additionally verified before handoff.

## Concrete production step — approval pending

Migration: `neon/migrations/20260906120000_admin_property_management.sql`.

Adds two tables (`admin_property_overrides`, `admin_property_source_snapshots`), a snapshot lookup index, three functions and one BEFORE property-write trigger. It does not delete source listings or rewrite existing property payloads. Manual protection starts only after an administrator saves an override. A management save briefly serializes property writers; readers continue.

Proposed destination: existing Earnest Property production Neon branch `br-polished-sea-aom4i1ct`, database `neondb`, followed by reviewed application release to the existing Vercel project for `earnestproperty.vercel.app`. No production migration, deployment or customer-data mutation has been performed for this change.

After approval: check migration drift/current release, apply this one migration transactionally through the established migration runner, release the reviewed branch, verify authenticated grouped management read and canonical public pages. Do not create test listings or change live prices merely to verify deployment.

Rollback: stop management writes and revert application release first. Remove the protection trigger/functions only after review, retaining override/snapshot tables as evidence. Removing protection does not automatically reverse edits already materialized into properties.
