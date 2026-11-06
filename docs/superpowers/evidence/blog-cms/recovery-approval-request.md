# Exact recovery drill approval request

Status: **PROPOSED / NOT APPROVED / NOT EXECUTED**. Willy is the user-confirmed
database/recovery and platform owner. Ownership is not approval. This document
requests later, separately reviewed actions; it does not request execution in the
current task. No snapshot, branch, store, object, credential or production data
was created, read through a provider, changed or deleted by this implementation.

## Captured scope and its limits

The supplied local Neon metadata was captured at
`2026-11-06T20:42:29.6986673+08:00`. It identifies project
`dawn-meadow-79190048`, production branch `br-polished-sea-aom4i1ct`, PostgreSQL
18, region `aws-ap-southeast-1`, and 21,600-second history. Eight old manual
snapshots are listed; newest is `snap-wispy-flower-aos73lyq`, created
`2026-10-26T12:54:18Z`. The supplied recovery package reports no schedule; the
saved observations JSON does not itself contain a schedule response. Refresh
that read-only response before approval. Old snapshots and history settings do
not establish a fresh ready backup.

The supplied Blob metadata identifies `store_sEHe3hQ90qGByxQA`,
`earnestproperty-media`, public access, `hkg1`, 1,789 objects / 226,336,431 bytes,
team `team_qvzlsFmfCsLkgItSypqHjw3z`, project
`prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5`, connected to production, preview and
development. It has no capture timestamp and no host/path inventory. These
counts are a captured baseline, not current completeness proof. The shared
store makes a normal preview environment insufficient isolation.

Local input SHA-256 values (exact saved bytes):

- `recovery-read-only-observations.json`:
  `b4e7414a05b41349631d8426fb9ab5566c8ccc7d808f535f4c73b135bb9e2668`.
- `recovery-blob-metadata.json`:
  `74dbe44a20bfead1a9e6e35a5430ffb86cf1deba1564fc81aa9429af7f1d8a98`.

The source task starts at `858458194fc35722b5fa63af9cfb6d07d749b2d2` on
`codex/blog-cms-release`. Resource names below use that base as a stable proposal
identifier. Approval must bind the **final** reviewed release HEAD and exact
packet bytes; the base identifier is not the final candidate digest.

## Request A: CREATE-SNAPSHOT-AND-ISOLATED-RESTORE

Proposed exact operation: create **one new provider snapshot** of project
`dawn-meadow-79190048`, branch `br-polished-sea-aom4i1ct`, named
`blog-cms-858458194fc3-recovery-01`, after the independently approved sustained
writer fence and drain. Record returned snapshot ID, branch binding, LSN,
creation/readiness timestamps, retained-until timestamp, history bounds and
provider readiness readback. No old snapshot substitution or create-response-only
success is permitted.

Restore that returned snapshot to **one new branch**, proposed name
`blog-cms-858458194fc3-restore-01`, in the same project and region, PostgreSQL 18,
database `neondb`. Capture the returned branch ID, direct endpoint ID/host,
database, observer role, numeric PostgreSQL version and system identifier. New
branch, endpoint and host must differ from production. A physical clone may
share a system identifier; that identifier alone never proves isolation.

Apply isolation label `blog-cms-recovery-858458194fc3-01`; restrict access to
named approved operators, with no application bindings, aliases, webhooks,
scheduled jobs, external writers or public application routes. Capture the actual
provider/network/access-policy readbacks and binding inventory. If enforcement
requires credential provisioning or rotation, stop for its own exact approval;
this request does not authorize token retrieval or new credentials.

No finalize/replace, production endpoint switch, production DDL/DML, migration,
import, push, merge, deploy or application activation is allowed. Read-only
verification of production baseline data and isolated restored data requires the
explicit collection scope below; none has been performed by this task.

Proposed resource lifetime: at most 24 hours for the isolated branch and snapshot
until evidence is preserved; approval must specify exact UTC creation, retention
and cleanup deadlines. The receipt itself lasts **at most six hours**, and never
past the approved window or snapshot retention. There is no automatic deletion
or production rollback at expiry.

## Request B: INVENTORY-AND-ISOLATED-MEDIA-COPY

Default proposal: enumerate and read the entire source store
`store_sEHe3hQ90qGByxQA` under prefix `""`, including all pages, object metadata,
byte lengths and SHA-256 checksums. Reconcile all referenced objects and every
`media_upload_intents` record, including held incomplete/finalization states.
Keep raw URLs, bytes, draft/revision content and detailed records in restricted
private archives. The source scan's zero cover/image markers is not evidence
that this store is empty.

Create one **separate** Blob store, proposed name
`earnestproperty-blog-recovery-858458194fc3-01`, region `hkg1`, proposed private
access, with no production/preview/development connections. Exact access-mode
support, returned store ID/host and operator access controls require provider
readback and approval before copying. Copy only the approved manifest into
prefix `recovery/blog-cms-858458194fc3-01/`, preserving source-relative paths.
Read back destination bytes and metadata and compare every key, length,
checksum and metadata digest. Never overwrite or delete source objects.

An alternative same-store prefix is **not approved by this default request**.
If a separate store is unavailable, submit a replacement approval identifying
`store_sEHe3hQ90qGByxQA`, exact source host, exact non-overlapping destination
prefix, complete collision inventory, and independently enforceable access
denies for all production/preview/development writers. An empty prefix or
prefix string alone is not isolation. The offline schema supports an explicitly
approved prefix with full inventory, signed isolation archive and cleanup proof.

Proposed media lifetime: at most 24 hours, with exact UTC deadlines to fill.
Captured source volume is about 226 MB; current inventory may differ. Snapshot
storage, branch compute/storage, Blob operations/storage and source/destination
read/egress costs are **UNKNOWN**. Fill an exact currency/cost ceiling and current
provider estimate before approval; no spend is implicitly authorized.

## Request C: CLEANUP-ISOLATED-DRILL-RESOURCES

Separate approval after evidence preservation must name the actual returned
isolated branch/endpoint, separate store ID/host or approved prefix, and exact
copied object manifest. Delete only these approved drill resources; retain the
fresh source snapshot until its separately approved retention/deletion deadline.
The offline cleanup record requires the branch ID, state `deleted`, exact deleted
object keys, zero remaining scoped objects, destination binding, completion time,
approval archive and provider deletion/list/readback archive. If a temporary
store is retained empty or deleted, record that disposition in the archive.
Unknown outcomes remain blocked; never retry an ambiguous deletion against a
different target. Cleanup does not authorize reopening writers.

## Required non-secret approval fields

Complete every field in a private reviewed request before any action:

```text
requestId / actions = explicit A, B and (separately) C scope
releaseHead / packetSha256 = final reviewed head / exact packet bytes hash
sourceTarget = project, branch, direct endpoint ID/host, port 5432, neondb,
               observer role, systemIdentifier, exact numeric serverVersion
sourceRegion / historyRetentionSeconds = aws-ap-southeast-1 / refreshed readback
snapshotName / restoreBranchName / isolationLabel = exact proposed names above
snapshotId / newBranchId / newEndpointId / newHost = returned IDs, bound by readback
fenceGeneration / fenceReceiptSha256 / drainedAt = active independently proven fence
baselineCollectionScope = full schema/catalog/ledger, every article/revision/privacy
                          row, media references/intents and all unaffected tables
tableNames / catalogSha256 / baselineArchiveSha256 = full reviewed coverage
sourceStoreId / sourceHost / sourcePrefix / inventoryCount / inventoryBytes = refreshed
destinationStrategy / destinationStoreId / host / region / access / prefix = exact
operatorPrincipals / networkRules / isolationPlanSha256 / applicationBindings = exact
approvalStartsAt / approvalExpiresAt / snapshotRetainUntil / cleanupDeadline = UTC
RTOSeconds / maximumDataLossSeconds = owner-accepted measured acceptance limits
currency / costCeiling / providerEstimateSha256 = exact approved budget
operator / independentVerifier / approver / approvalReference = named identities
evidenceRetention / privateArchiveLocation / evidencePublicKeyFingerprint = exact
cleanupApprovalSha256 / deletionManifestSha256 = separately approved exact resources
```

Returned IDs cannot be invented before creation. Approve creation only with
exact proposed names, source IDs, limits and stop conditions; then obtain a
read-only readback and a reviewed context amendment binding returned destination
IDs **before restore/copy/cleanup**. Subsequent evidence binds that final context.
No wildcard authorizes a different existing resource. Missing system identity
requires a separately authorized read-only observation; it cannot be inferred
from branch metadata. Do not retrieve connection strings or token values.

Stop on expired approval/evidence, unknown writers, failed drain, missing provider
readiness, target drift, shared destination access, incomplete pagination,
checksum/schema/ledger/privacy/unaffected-table mismatch, unresolved upload,
missing cost ceiling, exceeded lifetime or ambiguous outcome. Preserve evidence
and maintain the separate writer fence; no automatic restore/finalize/reopen.

## Offline handoff and closure

[The context template](recovery-context.template.json) intentionally contains null
blockers. It is **rejected** by the validator until an independent reviewer fills
and seals the actual policy values. The reviewed public verification key is
supplied separately from the evidence envelope; accepting a key chosen by the
evidence submitter is not independent trust.

The authority signs the complete `blog-recovery-evidence-v2` record after
reviewing raw provider/read-only archives, their provenance, capture methods and
the actual approval. Use Ed25519 over UTF-8 canonical JSON (the repository's
`canonical` function); the envelope is `{record, signature}` with canonical
base64 signature. Never put a signing private key in this tool or checkout.

The final reviewed `blog-recovery-context-v2` must include `snapshotId`, the full
`restoredTarget` (project/branch/endpoint/host/port/database/role/system identifier/
version), and `cleanupIdentity` containing that full target, exact destination
store/host/prefix/strategy and exact ordered deletion-key list. Restore and
cleanup evidence must match these approved values, not merely differ from
production. Copy destination must match the same context destination. New returned
IDs require a reprovisioned reviewed context and newly sealed evidence binding its
digest, along with applicable amended approvals. An internally consistent
substitution under the old context is rejected. V1 packages/receipts cannot be
reused. Signature verification uses the original canonical record and rejects any
schema transformation, including silently trimmed identifiers.

All archive references must resolve to local bytes named by SHA-256. Whole-store
inventory is matched to the reviewed context count/bytes; all copied byte hashes
and lengths match originals; table-name coverage matches the independently
reviewed full catalog, with exact baseline/restored counts and row digests.
Full schema digest includes schema objects, constraints, policies, grants,
functions and sequences; row digests cover deterministic complete rows, not
sampled columns. `app_migrations` is covered as a full table. Privacy evidence
includes all article states and every revision/author, not only published rows.
The full verification archive must document canonicalization and coverage.
Referenced uploads include completed and held pending intents with no automatic
retry. Zero counts require explicit full enumeration evidence.

For `media_upload_intents`, `media_assets`, `articles` and `cms_content_revisions`,
provide complete canonical JSON row-array archives sorted by exact `id` (strictly
increasing, no duplicates). Encode using UTF-8 `canonical(rows)` with no newline;
the file SHA-256 must equal the corresponding baseline/restored table fingerprint.
These contain all captured columns and every row/state, including media assets
without intents and revisions for every CMS resource. A typed manifest must
include every row, its fingerprint and exact extracted source paths/values;
even rows without media have explicit empty reference arrays. This is a complete
table capture, not a reference-only projection or an independently asserted list.

Upload digest must equal the captured `media_upload_intents` fingerprint. Upload
reference identity and pathname come directly from the captured rows; completion
requires both URL and completion timestamp. Pending paths that exist in the
inventory use `pending-object-held`; absent paths use `pending-absent-held` and a
null resolved object key, while retaining the exact captured pathname. Completed
rows use `completed-object`. All remain bound to the held-disposition archive;
no replay or finalization is authorized by a disposition.

The validator derives reference sources from raw row fields, nested JSON/editor
content and legacy HTML/Markdown media. Every source-host URL must be HTTPS,
canonical and resolve within the exact prefix and complete inventory; a missing
source object cannot be excluded. External/static sources and conservatively
detected non-media URLs require exact `excludedReferenceValues` in the reviewed
context. Unsupported/ambiguous source syntax is not live acceptance; reconcile it
or extend the reviewed extractor and tests before signing. Full scope and raw
export provenance remain the independent reviewer's responsibility.

Fix round 2 parses supported Markdown/HTML/CSS media syntax before applying any
external exclusion. Numeric/named HTML entities are interpreted for target
classification while the manifest retains the original encoded source (or full
original CSS attribute/value). Encoded source-host references must resolve to the
inventory; exclusions cannot hide missing objects. Reference-style Markdown and
HTML inline backgrounds cannot be accepted with empty reference coverage.
Unsupported or ambiguous syntax fails closed, including unresolved/duplicate
Markdown definitions, malformed HTML, `srcset`, CSS escapes/dynamic functions,
stylesheets/imports, repeated encoding and percent-encoded candidates. Consult
the CLI README for the supported parser contract before preparing evidence.

Fix round 3 additionally rejects doctypes/document-level carriers before the
fragment parser can discard them, and requires every source start tag and its
attributes to survive into the inspected tree. Tree absence or an empty manifest
is never sufficient evidence of absent media. Unsupported wrappers or dropped
carriers require a separately reviewed parser/scope decision; an exclusion or
known inventory object cannot authorize them. External approvals remain blocked.

Implementation readiness, authenticated offline record consistency, external
provider proof and release closure are separate. An offline receipt is
checksum-sealed, expires, and is bound to candidate, target, context, signed
evidence and archives. It always states `productionAuthorized: false` and
`closure: REQUIRES_INDEPENDENT_REVIEW`. It is not a `production-recovery-v1`
executor envelope. Only the independently provisioned recovery authority may
issue that separate executor attestation after reviewing this package. No
automatic conversion, authority provisioning or live executor changes are part
of this task. A local blog-table snapshot remains explicitly insufficient for
full database recovery, even when its checksums match.
