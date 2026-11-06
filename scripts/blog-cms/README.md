# Blog content reconciliation/import (Task5)

## Production release preparation

`bun --no-env-file scripts/blog-cms/production-prepare.ts` prepares an offline,
exact-target draft from the pinned captured source and prints aggregate bindings.
It has no database connection or production write executor. The draft retains
missing database, backup, fence, approval and execution gates; matching hashes
never authorize release. Existing owned-container commands below remain owned-only.
See the [production release package](../../docs/superpowers/evidence/blog-cms/release-request.md)
for current evidence, automatic-deployment coupling and separately required approvals.

Task9 adds a read-only **pre-import** freshness adapter:

```text
bun run --no-env-file scripts/blog-cms/verify-manifest.ts --manifest <existing-manifest.json> --sources <fresh-source-bundle.json> --container <owned-full-id> --target owned:<owned-full-id>:postgres --revision <reviewed-source-revision> --fingerprint <approved-manifest-sha256>
```

It opens only the existing owned-Docker target, captures the complete current DB in a
read-only transaction, rebuilds the observed inventory, and compares it to the immutable
approved manifest. Exit 0 requires exact equality and no missing/conflicting sources;
all rejection/failure paths exit 1. Changed DB versions, URL/source sets, target, revision
or approval never become a new approved fingerprint. It neither writes data nor authorizes
activation (`activationAuthorized:false`). The source revision identifies imported source
data; application source/output/receipt identity is a **separate** build gate.

Run this before import under a proven write pause. After import, the database has legitimately
changed: use the existing `import.ts --verify` receipt command below, not pre-import equality.
Its exit 2 drift result blocks acceptance. Neither verifier supplies a sustained write fence
or an HTTP/CDN deployment mechanism. There is no production write adapter. See
[`cutover.md`](../../docs/superpowers/evidence/blog-cms/cutover.md) for the review-only release
and recovery package, local rehearsal commands and BLOCKED hosted steps.

These are offline operations tools. They do not load application connection configuration.
All commands below run from the Earnestproperty worktree with Bun's `--no-env-file`.
The only database adapter accepts an inspected **owned local harness container**; there is
no external/production URL mode and no automatic migration application.

## Sources and private artifacts

`SourceBundle` in `src/lib/blog/import-snapshots.ts` contains:

- `sourceRevision`: exact reviewed source SHA.
- `registry`: full, unfiltered `blogArticles` array, not `publishedBlogArticles()`.
- `sitemap`: the approved snapshot JSON, with HTTP status, count, exact URLs and observation time.
- `presentation`: approved main/category copy snapshot, including navigation keys and canonical URLs.

For the reviewed base, use source SHA
`8b49d0a21c867c401c4d41db393e43c8db76a74d` and the two controller JSON files under
`docs/superpowers/evidence/blog-cms/`. Serialize the full registry and those snapshots
into one source bundle. Do not substitute an empty array for a failed read.

Manifest/inventory/backup outputs must be new files under
`.private-sync-evidence/blog-import/` (already ignored by Git). The CLI refuses
overwrites and paths outside that directory. Source bundles and inventories can contain
private drafts; do not commit them. Standard output is a summary or receipt, without bodies.
The checked-in `src/lib/blog/fixtures/import-source.json` contains synthetic public-safe data.

## Read-only accounting

```text
bun run --no-env-file scripts/blog-cms/inventory.ts --sources .private-sync-evidence/blog-import/sources.json --target UNKNOWN_LIVE_DATABASE --output .private-sync-evidence/blog-import/inventory.json
bun run --no-env-file scripts/blog-cms/reconcile.ts --inventory .private-sync-evidence/blog-import/inventory.json --output .private-sync-evidence/blog-import/manifest.json
bun run --no-env-file scripts/blog-cms/import.ts --manifest .private-sync-evidence/blog-import/manifest.json
```

These commands do not connect to a database. Without a DB snapshot, database counts are
null, `source:database` remains unresolved and `ready` is false. Public URL matches are
accounted for using the reviewed deployed registry body/metadata, not an invented scrape.
Unknown public-only content remains unresolved. `editorial-standards` is an explicit
non-article exclusion; its route is preserved.

To collect an owned target, obtain the full container ID from a currently running
`withOwnedPostgres` callback, after the harness applies the real migration manifest.
The target string must be exactly `owned:<full-container-id>:postgres`.

```text
bun run --no-env-file scripts/blog-cms/inventory.ts --sources .private-sync-evidence/blog-import/sources.json --target owned:<id>:postgres --container <id> --backup-output .private-sync-evidence/blog-import/backup.json --output .private-sync-evidence/blog-import/owned-inventory.json
bun run --no-env-file scripts/blog-cms/reconcile.ts --inventory .private-sync-evidence/blog-import/owned-inventory.json --output .private-sync-evidence/blog-import/owned-manifest.json
```

Alternatively `inventory.ts --database <snapshot.json>` consumes a previously captured
snapshot file; it does not connect. Database capture uses a repeatable-read read-only
transaction, deterministic pagination, count/unique-key checks, all live articles and
**all article revision rows**, irrespective of author/state. Missing tables fail or
remain unresolved. This backup is a blog-table snapshot, not a full database restore rehearsal.

## Explicit apply and verification

First review the manifest conflicts/unresolved list, fingerprint, source revision, source
digest, exact target and backup. Compute the backup file's SHA-256, for example:
`(Get-FileHash -LiteralPath .private-sync-evidence/blog-import/backup.json -Algorithm SHA256).Hash.ToLowerInvariant()`.

Only when every blocker is resolved and this exact owned target is authorized:

```text
bun run --no-env-file scripts/blog-cms/import.ts --apply --manifest .private-sync-evidence/blog-import/owned-manifest.json --sources .private-sync-evidence/blog-import/sources.json --container <id> --target owned:<id>:postgres --fingerprint <manifest-sha256> --backup .private-sync-evidence/blog-import/backup.json --backup-sha256 <backup-file-sha256>
bun run --no-env-file scripts/blog-cms/import.ts --verify --manifest .private-sync-evidence/blog-import/owned-manifest.json --sources .private-sync-evidence/blog-import/sources.json --container <id> --target owned:<id>:postgres --fingerprint <manifest-sha256>
```

The source bundle is re-read and its digest/revision must match. Target verification
checks full Docker ID, harness name, pinned image, running state, loopback binding,
database/user and PostgreSQL system identifier. Application/test URL variables are refused.
An object cast to `VerifiedImportTarget` is not enough: handles are registered privately.

Apply checks backup bytes/digest/identity and the complete current DB snapshot before
writing under `blog_lock()` and table locks. One manifest is one transaction: category
resolution, tightly gated placeholder copy initialization, article inserts, matching
revisions and durable immutable receipt all commit or all roll back. Existing history
is never reseeded with version 1; active drafts and historical slug claims block collisions.
Existing editorial state/content/copy is authoritative. Normalization is restricted to
missing category references after snapshot and row-version checks.

A repeated **same manifest** reads its receipt and performs no data writes. If anything
in the protected blog snapshot changed, it reports `verification: "changed"`; it never
repairs an editor's change. Interruption before commit has no checkpoint and safely retries
from the original snapshot. Loss of the response after commit resumes the durable receipt.
Concurrent same-manifest callers get one import and one replay.

Exit status: 0 = successful execution (inspect `ready` for dry-run readiness);
1 = rejected/failed operation; 2 = receipt verified but current state has drifted.
Drift is not acceptance. Receipt `counts` describe the original committed import;
`writes` counts article inserts on this invocation (zero on replay), not DDL or receipt rows.

Reload imported identities using Task4 `getArticlePreview`; use the returned `editState`
tokens unchanged. No ordinary first-publish command is used for import. Nullable/future
publication dates are preserved; unpublished imports use an archived initial revision
and remain unpublished when saved as drafts.

## Verification and remaining gates

```text
bun test --no-env-file src/lib/blog/reconcile.test.ts src/lib/blog/import-snapshots.test.ts
bun test --no-env-file src/lib/neon/blog-import.integration.test.ts
```

The second command starts and cleans up its own pinned container; it accepts no database URL.
Task5 source/owned-fixture acceptance does not establish live inventory, live schema,
browser/editor acceptance, deployment or release completeness. Tasks8/9 own broader
acceptance and cutover, after controller review and separate target-specific authorization.

## Offline recovery/media evidence

`recovery-evidence.ts` validates a strict signed evidence package and emits a
checksum-sealed receipt. It does not perform a recovery drill or authorize
production. The context must be independently reviewed, including the public
verification key, final release HEAD, exact packet digest, full target identity,
full table catalog, source store/host/prefix/count/bytes, approved destination,
names, isolation label, approval hashes and validity window. Never use a public
key supplied by an untrusted evidence submitter as the trust baseline.

Start from
`docs/superpowers/evidence/blog-cms/recovery-context.template.json`; its null
fields are intentional blockers. The companion `recovery-approval-request.md`
specifies the exact proposed actions and required external approvals. Refresh
metadata before approval; the captured 1,789 objects and 226,336,431 bytes are
not guaranteed current. A local blog-table snapshot cannot replace the provider
snapshot/full-database restore package.

The complete evidence record shape is the strict schema in
`recovery-evidence.ts`; `recovery-evidence.test.ts` supplies a fully synthetic
example with ephemeral test signing keys. An independent authority seals the
complete record, including its reviewed `contextSha256`, as `{record, signature}`
using Ed25519 over the UTF-8 `canonical(record)` representation. No signing key is
accepted by the CLI. All times are integer Unix milliseconds. Evidence windows
must fit the context window and last at most 21,600,000 ms; observation chronology,
snapshot history/retention and current receipt expiry are checked independently.

Keep the complete package in restricted local evidence storage. Archive files
and original media bytes go in one directory, each named by its lowercase
64-character SHA-256 without extension; no directories, symlinks or arbitrary
filenames are accepted there. Required archive bytes are rehashed. Media bytes
also match recorded lengths. The signed destination readback archive must prove
those same bytes were read from the isolated destination. Table/privacy/metadata
digests are compared as signed attestations backed by the verification archives;
the tool cannot infer raw export provenance or inspect a live provider. The
authority must review full canonicalization, pagination and complete row/metadata
coverage before sealing. Opaque archive hashes alone do not authenticate a
provider; the independently trusted signature is required as well.

CLI JSON inputs are limited to 16 MiB each; total archive bytes to 512 MiB. Larger
packages fail closed and require a separately reviewed streaming implementation;
never drop objects or evidence to fit the limit. The reviewed table catalog must
include all schemas/tables, including unaffected tables; the validator checks exact
catalog membership and complete before/after counts and fingerprints, not samples.

```text
bun run --no-env-file scripts/blog-cms/recovery-receipt.ts issue --context .private-sync-evidence/blog-recovery/context.json --evidence .private-sync-evidence/blog-recovery/evidence.json --artifacts .private-sync-evidence/blog-recovery/artifacts --receipt .private-sync-evidence/blog-recovery/receipt.json
bun run --no-env-file scripts/blog-cms/recovery-receipt.ts verify --context .private-sync-evidence/blog-recovery/context.json --evidence .private-sync-evidence/blog-recovery/evidence.json --artifacts .private-sync-evidence/blog-recovery/artifacts --receipt .private-sync-evidence/blog-recovery/receipt.json
```

There are no provider, credential, environment-loading, signing, apply, cleanup
or clock-override switches. Receipt output must be a new file under
`.private-sync-evidence/blog-recovery/`; overwrites, traversal and symlink/junction
output ancestors fail. Both modes revalidate the complete package. `verify`
requires the existing receipt to match the validated package and remain current.
Standard output contains only status, authorization=false, receipt hash and
expiry; failures report a generic error, never raw private evidence. Exit 0 means
offline verification succeeded; exit 1 means rejection. Output always retains
`productionAuthorized: false` and `closure: REQUIRES_INDEPENDENT_REVIEW`.

This receipt cannot be submitted as the executor's `production-recovery-v1`
envelope. Independent recovery authority review and signing remain separate;
this tooling neither provisions that authority nor changes executor gates.

Focused offline verification:

```text
bun test --no-env-file scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/release-controls.test.ts scripts/blog-cms/release-packet.test.ts scripts/blog-cms/writer-control-register.test.ts
```
