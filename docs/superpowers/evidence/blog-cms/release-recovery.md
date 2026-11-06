# Production backup and recovery package

Status: **metadata verified; fresh backup and restore proof outstanding**. Production unchanged.

Read-only provider metadata collected on 2026-11-05 reports project `dawn-meadow-79190048`, production branch `br-polished-sea-aom4i1ct`, PostgreSQL 18, history retention **21,600 seconds (six hours)** and an empty snapshot schedule. Eight manual snapshots exist, all dated October 26; newest is `snap-wispy-flower-aos73lyq`, created 2026-10-26T12:54:18Z. Neither their presence nor the retention setting proves this release can be restored.

## Required fresh recovery evidence

After the approved writer fence and drain, capture a new provider snapshot/backup bound to the exact branch, timestamp/LSN and approved release packet. Record provider readiness and retention, not just a successful create response. Restore to a **new isolated branch**, explicitly without finalizing/replacing production; record the returned branch/endpoint and prove it differs from production before any tests. Validate schema/migration ledger, all article revisions and privacy states, scoped hashes and unaffected-table coverage. The old local synthetic FAQ sentinel is not a full database restore test.

Creating the backup/restore branch is a provider mutation and is not executed by this preparation package. A reviewable request must name the snapshot operation, new branch naming, costs/expiry, isolated access, no public application binding and no finalize/replace step. Preserve evidence before separately approved cleanup. Provider documentation distinguishes restoring to a new branch from finalizing a replacement: [restore snapshot API](https://neon.com/docs/reference/api/snapshots/restore-snapshot), [history window](https://neon.com/docs/postgres/backup-restore/history-window).

## Media scope

The app uses Vercel Blob through `src/lib/media/vercel-blob.mjs`, with upload/finalization records in the database. A Neon snapshot does not itself demonstrate restoration of those external bytes. Bind the actual production Blob store/host, enumerate referenced objects and outstanding uploads, retain checksums/metadata in private evidence, and rehearse recovery into a separate isolated store or approved prefix. Never overwrite production object paths as a drill.

A local scan of the sealed 112-record registry found zero populated cover-image fields and zero `<img`/Markdown image markers. This narrowly describes the captured source; it does not establish absence of application assets, dynamically rendered estate media, existing media-library objects or future editor uploads. Public source assets are separately bound by the application source/build receipt. The storage gate remains open until the real store and restoration scope are verified.

## Failure handling

| Point | Stop/recovery action |
| --- | --- |
| Before production transaction | Stop; leave content unchanged and maintain the reviewed maintenance state. |
| Migration/import fails before COMMIT | Roll back the transaction; verify the baseline ledger and scoped fingerprints, retain error evidence. |
| COMMIT response lost | Read durable receipt against exact target/manifest; never blindly replay inserts or regenerate approval. |
| New renderer fails after successful import | Keep mutations fenced; forward-fix or use a reviewed compatible artifact. The original registry renderer can resurrect withdrawn articles and is not an approved automatic rollback. |
| A later editorial change must be repaired | Use targeted version-CAS repair preserving newer title/body, private drafts, publication state and unrelated rows. A whole-database restore is a separate incident decision, not routine rollback. |
| Suspected broad corruption | Restore to a separate branch for comparison first. Replacing production or switching endpoints requires a separate explicit recovery approval with data-loss window and unaffected-work analysis. |

Willy is the user-confirmed database/recovery and platform/deployment owner. Acceptable recovery time/data-loss window, fresh snapshot identity, isolated restore receipt and external-media recovery proof remain missing. Owner assignment does not approve backup creation, restoration or production changes. These gates cannot be marked PASS from read-only metadata or the local rehearsal.

## Offline recovery/media evidence tooling — 2026-11-06

Implementation: `scripts/blog-cms/recovery-evidence.ts` and
`scripts/blog-cms/recovery-receipt.ts`. These tools only read supplied local files
and write a new private offline receipt. They do not connect to Neon or Blob,
sign evidence, retrieve credentials, create resources, restore/finalize, copy or
delete objects, or grant production authority.

See the [exact approval request](recovery-approval-request.md), including the
captured shared Blob store and missing identity, timing, isolation and budget
fields. The [context template](recovery-context.template.json) is intentionally
incomplete and must fail validation. Follow the [CLI instructions](../../../../scripts/blog-cms/README.md#offline-recoverymedia-evidence).

Validation requires independently trusted Ed25519-sealed evidence, complete local
archive bytes, exact candidate/target binding, a maximum six-hour window,
provider-ready snapshot, new isolated restore, complete database/catalog/ledger/
privacy/unaffected-table comparisons, full media inventory and byte/metadata
comparison, referenced uploads, and separately approved cleanup readbacks.
Receipts expire and revalidation rechecks the signature, policy, archives and
current time. No asserted boolean satisfies any evidence gate.

**External evidence and release closure remain BLOCKED.** A successful synthetic
test or offline receipt does not independently prove provider actions occurred.
Raw evidence provenance and the reviewed authority/context remain external trust
requirements. Local blog-table snapshots remain insufficient for full recovery.
