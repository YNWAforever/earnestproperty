# Task 6 — recovery/media evidence implementation report

Date: 2026-11-06. Workspace:
`C:\Users\laich\.codex\worktrees\earnest-blog-cms\Earnestproperty`.
Branch: `codex/blog-cms-release`.
Verified starting HEAD: `858458194fc35722b5fa63af9cfb6d07d749b2d2`.
The initial working tree was clean. No subagents were spawned.

## Result and boundary

**Implementation readiness: PASS for the scoped offline implementation.**
**External recovery/media evidence: BLOCKED / NOT COLLECTED.**
**Production authorization and release closure: NOT GRANTED.**

Implemented strict offline recovery evidence validation, expiring receipt
issuance/reverification, synthetic tests, an exact proposed snapshot/restore/
media-isolation/cleanup approval request, and an intentionally incomplete
context template. The local commit containing this report records the complete
deliverable; its resulting hash is reported in the final response.

No provider snapshot/branch/store was created, restored, finalized or deleted.
No provider or production database connection, data access, object upload/read/
delete, credential/token-value retrieval, push, merge or deployment occurred.
No signing authority was provisioned. Tests create only synthetic local files
and ephemeral synthetic Ed25519 keys. Production remains unchanged.

## Inputs and discovery

Read the task brief and `docs/superpowers/evidence/blog-cms/release-recovery.md`
first, then the supplied value-free metadata, repository instructions and RTK
instructions. The code graph search for recovery/receipt symbols returned no
matches; repository file reads were then used to inspect the existing release
target, evidence, controls, packet tests, CLI and approval conventions.

The provided Neon observation timestamp is
`2026-11-06T20:42:29.6986673+08:00`. Captured scope: project
`dawn-meadow-79190048`, branch `br-polished-sea-aom4i1ct`, PostgreSQL 18,
`aws-ap-southeast-1`, 21,600-second history, eight October 26 manual snapshots.
Newest: `snap-wispy-flower-aos73lyq`, `2026-10-26T12:54:18Z`. The supplied
recovery document reports an empty snapshot schedule; the saved JSON does not
include that API response, so the approval request calls for refreshing it.

Blob metadata identifies `store_sEHe3hQ90qGByxQA`, `earnestproperty-media`,
`hkg1`, public, 1,789 objects / 226,336,431 bytes, shared across production,
preview and development. It lacks its own capture timestamp and source host/
object inventory. Its counts are not treated as current completeness proof.

Exact locally rehashed input bytes:

| File | SHA-256 |
| --- | --- |
| `recovery-read-only-observations.json` | `b4e7414a05b41349631d8426fb9ab5566c8ccc7d808f535f4c73b135bb9e2668` |
| `recovery-blob-metadata.json` | `74dbe44a20bfead1a9e6e35a5430ffb86cf1deba1564fc81aa9429af7f1d8a98` |

## Deliverables

- `scripts/blog-cms/recovery-evidence.ts`: strict context/envelope schemas,
  independently supplied Ed25519 public-key verification, complete evidence
  validation, receipt construction and full receipt reverification.
- `scripts/blog-cms/recovery-receipt.ts`: `issue` and `verify` CLI modes; explicit
  local inputs only, no environment loading/provider clients/signing keys, new
  private receipt files only, generic non-sensitive CLI failures.
- `scripts/blog-cms/recovery-evidence.test.ts`: 52 synthetic tests, including
  full signed happy paths, prefix isolation, rejection cases and real CLI process
  invocation. No external services or production fixtures.
- `docs/superpowers/evidence/blog-cms/recovery-approval-request.md`: known exact
  source IDs, proposed snapshot/restore/store/prefix names, staged returned-ID
  binding, read-only verification scope, isolation, cost/lifetime/expiry fields,
  separate cleanup approval, stop conditions and authority handoff.
- `docs/superpowers/evidence/blog-cms/recovery-context.template.json`: actual
  captured resource IDs/counts and explicit null blockers for unknown fields.
  A test proves this incomplete template cannot issue a receipt.
- Updated `release-recovery.md` and `scripts/blog-cms/README.md` with the
  implementation boundary, private package layout, exact CLI commands, schema
  contract, signing convention and limitations.

## Requirement coverage

| Required evidence | Enforced offline contract |
| --- | --- |
| Exact candidate and target | Final HEAD and packet digest, full project/branch/endpoint/host/database/role/system identity/version in the reviewed context; its canonical digest is signed with the entire evidence record and bound into receipts. |
| Sealing and freshness | Ed25519 public key from independently reviewed context; strict envelopes reject unknown fields/boolean shortcuts; canonical base64 signature; windows at most six hours; chronology, future/expired observations, retention and receipt expiry checked. |
| Provider backup | Only `neon-provider-snapshot`, `ready`, exact approved name/returned ID, LSN, creation/readiness/history/retention and hash-verified provider-readback archive; snapshot follows drained writer fence. |
| New isolated restore | Only `restore-new-branch`; exact snapshot and approved name; same project/database/version; distinct source branch/endpoint/host; exact isolation label, empty application bindings and required provider/isolation archives. No finalize/replace operation exists. |
| Full database recovery | Only `full-database`; exact independently reviewed full catalog membership; mandatory article/revision/blog/ledger/media tables plus unaffected-table coverage; duplicate/missing tables fail; schema and every table count/digest compare exactly; article/revision privacy counts and digests match; catalog and verification archives must be present and hash-valid. |
| Production media inventory | Exact reviewed source store/host/prefix/count/bytes, unique scoped objects, complete inventory archive, every upload intent accounted for as completed or held, reference resolution and held disposition archive. |
| Media isolation and copies | Separate store and host, or explicitly approved collision-free prefix with isolation archive; exact one-to-one source/destination keys, bytes, SHA-256 and metadata digests; original bytes present/rehashed/length-checked, signed destination readback archive required. |
| Cleanup | Exact isolated branch and destination, separately bound approval, exact unique copied-key deletion set, zero scoped remaining objects, deleted branch state, cleanup after verification and required provider/readback archive. |
| Receipts | Hash-sealed result bound to context, full signed envelope, archive hashes, candidate and target; expires at earliest context/evidence/retention deadline; verification reconstructs expected receipt and rechecks all evidence, archives and current time. Rehashing an edited receipt cannot authorize changed scope or extend validity. |
| Local blog snapshots | Explicitly rejected as provider snapshot/full-database scope; documentation repeatedly states their insufficiency. |

The signing authority must review actual raw archives, complete row/object
coverage, provenance, capture methods and approval. Offline validation verifies
authenticated record consistency and bytes; it cannot independently establish
that a provider operation happened. The context and public key must not be
selected by an untrusted evidence submitter. Receipt `productionAuthorized` is
always false, and `closure` always `REQUIRES_INDEPENDENT_REVIEW`.

## Approval proposal

Proposed snapshot: `blog-cms-858458194fc3-recovery-01`.
Proposed new branch: `blog-cms-858458194fc3-restore-01`.
Proposed isolation label: `blog-cms-recovery-858458194fc3-01`.
Proposed separate media store: `earnestproperty-blog-recovery-858458194fc3-01`,
region `hkg1`, proposed private access subject to support/readback approval.
Proposed destination prefix: `recovery/blog-cms-858458194fc3-01/`.

These names identify the proposal based on the starting head; they do not bind
the eventual release packet. Final HEAD/packet, exact production endpoint and
system identity, refreshed complete catalog/inventory, source host, returned
destination IDs/host, operator/access controls, UTC windows, RTO/data-loss
acceptance, budget/cost estimate, evidence retention and independent authority
remain mandatory missing inputs. Proposed isolated-resource lifetime is at most
24 hours, with exact deadlines to approve. Receipt validity remains at most six
hours. Cleanup has its own approval and never implies writer reopening.

Creation must first be approved for exact source IDs/proposed names and limits;
returned IDs are then read back and bound by reviewed context amendment before
restore/copy/cleanup. Existing/shared resources cannot be silently substituted.
Same-store prefix mode requires a separately reviewed replacement media plan;
it is not approved by the default separate-store proposal.

## Verification evidence

Test-first implementation used the TDD and verification-before-completion skills.
The initial contract run failed on the absent receipt implementation (2 failures);
negative rejection tests alone were not treated as proof. The subsequent CLI
contract run failed explicitly with `RECOVERY_CLI_NOT_IMPLEMENTED` (47 pass /
1 fail). Logs: `task-6-red.log`, `task-6-cli-red.log`.

Initial sandbox Bun runs also reported parent-directory
`Cannot read directory C:\Users\laich\: EPERM`. Clean offline test reruns
outside that sandbox restriction succeeded. The initial focused lint found
`no-control-regex` in object-key validation; it was corrected to an explicit
character-code check. No unresolved test/type/lint failure remains.

Final commands/results:

1. `bun test --no-env-file scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/release-controls.test.ts scripts/blog-cms/release-packet.test.ts scripts/blog-cms/writer-control-register.test.ts`
   — **PASS: 92 tests, 0 failures, 225 assertions, four files**, exit 0.
   Log: `task-6-focused-final.log`. Includes 52 recovery tests plus 40 adjacent
   release/control/register tests; this is not a full repository suite claim.
2. `npm run typecheck` — **PASS**, exit 0.
   Log: `task-6-typecheck.log`.
3. `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --strict --types bun scripts/blog-cms/recovery-evidence.ts scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/recovery-receipt.ts`
   — **PASS**, exit 0. Log: `task-6-script-typecheck-final.log`. This explicitly
   covers scripts omitted by the application tsconfig.
4. `node node_modules/eslint/bin/eslint.js scripts/blog-cms/recovery-evidence.ts scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/recovery-receipt.ts`
   — **PASS: zero errors/warnings**, exit 0.
   Log: `task-6-focused-lint-final.log`.
5. Prettier applied to all three TS files and the JSON template; `git diff --check`
   passed. A final format/diff check precedes the local commit.

Not run: full repository suite, provider acceptance, DB/container recovery,
production/media collection, browser/hosted acceptance, build/deployment or CI.
The user requested focused offline validation and prohibited production/provider
actions. No focused run is represented as full-platform or external acceptance.

## Review and remaining concerns

Self-review checked signature/context substitution, expiry/renewal, snapshot and
restore ordering, source-vs-destination identity, full-table coverage, privacy,
pending upload/reference completeness, object key traversal/collisions,
checksum/metadata drift, cleanup target/order, receipt tampering and CLI refusal
of overwrites/out-of-root paths/mutation switches. The CLI stores no keys and
prints no private payloads. Receipt outputs are restricted to
`.private-sync-evidence/blog-recovery/`; junction/symlink ancestors are rejected.

1. No fresh provider snapshot/restore/isolation/cleanup evidence or actual
   approval exists. Existing manual snapshots and six-hour history do not clear
   this gate. The Blob store is shared across three environments.
2. Independent signer/context trust and raw archive provenance remain required.
   DB/schema/privacy/metadata comparisons consume signed full-coverage digests,
   backed by hash-verified private archives; this tool is not a SQL exporter,
   provider audit collector or parser for arbitrary backup formats.
3. CLI input limits are 16 MiB per JSON and 512 MiB total archive bytes. Oversized
   packages reject; they require separately reviewed streaming support, never
   omitted evidence. The captured object-byte total fits, but real full-database
   archives may exceed this limit.
4. The existing executor's `production-recovery-v1` envelope is unchanged. This
   offline receipt cannot be supplied as that envelope and cannot issue a live
   capability. Separate independently provisioned recovery-authority review and
   signing remain required; there is no automatic conversion or release closure.
5. Local blog-table snapshots remain explicitly insufficient for full database
   recovery, irrespective of their local test/checksum success.

Only the requested implementation, documentation and this report are committed
locally. Raw provider metadata/private evidence and transient verification logs
remain in their existing ignored workspace location. No push, merge or deploy.

## Fix round 1/5 — exact resource and database-reference bindings

Starting commit verified: `a403005700700cdb4909a0e15ef8de3773989d6f` on
`codex/blog-cms-release`; working tree was clean. This section supersedes initial
readiness claims wherever the review findings exposed insufficient validation.
All three Important findings and the linked signature defect are addressed in
this local fix. External recovery/media evidence, action approvals and release
closure remain **BLOCKED**. No subagents were used.

### Findings reproduced before fixes

Added six synthetic regressions against the starting implementation. All six
failed as expected because the old validator accepted: unrelated upload digest;
invented held upload identity; substituted restored branch/endpoint/host plus
matching cleanup branch; substituted snapshot IDs; a captured standalone asset
whose object was missing; and whitespace edits to a sealed snapshot identifier
without resealing. Existing 52 recovery tests still passed.

Command: `bun test --no-env-file scripts/blog-cms/recovery-evidence.test.ts`.
Result: **52 pass / 6 fail**, exit 1, 86 assertions.
Log: `task-6-fix1-red.log`. Tests ran outside the previously established Bun
sandbox parent-directory restriction; they use only synthetic local files.

### Fixes and evidence model changes

1. **Upload rows and references:** new `recovery-reference-manifest.ts` reads the
   complete local `media_upload_intents` row-array archive identified by the
   baseline database fingerprint. It checks canonical UTF-8 bytes, complete row
   count, unique ordered IDs, unchanged parsed values and SHA-256; baseline and
   restored fingerprints must already match. `uploads.rowsSha256` must equal
   this exact table fingerprint. Every upload reference is independently derived
   from the captured ID, pathname, URL/completion state and inventory presence.
   Arbitrary identity/path/state/null substitutions fail. Pending rows preserve
   their captured pathname and use an explicit `pending-object-held` or
   `pending-absent-held` disposition; completed rows use `completed-object`.
   Present pending objects must remain inventoried/copied, and the existing
   held-disposition archive remains mandatory. No replay/finalization occurs.
2. **Approved returned identities:** v2 reviewed context pins `snapshotId`, full
   `restoredTarget` and `cleanupIdentity` (complete target, exact destination and
   ordered deletion keys). Snapshot/restore/copy/cleanup must match these values
   exactly, in addition to isolation checks. Tests reject coordinated evidence
   substitutions under unchanged context, including branch, endpoint, host,
   database, role and system identity. A positive test reprovisions exact context
   values and applicable approval archives, rotates the synthetic public key,
   seals the new context digest, and verifies successful offline validation;
   old context and old receipt replay both fail.
3. **Complete typed media reference manifest:** all rows of `media_upload_intents`,
   `media_assets`, `articles` and `cms_content_revisions` require full canonical
   row-array captures bound to the respective DB fingerprints. The manifest has
   a typed source table, captured row ID/hash and exact source paths/values for
   every row, including empty reference lists. References are independently
   enumerated across all row fields, nested JSON/editor content and legacy
   HTML/Markdown sources; every revision resource/state is included. Source-host
   URLs must resolve within the exact store/host/prefix inventory. Standalone
   assets require no upload intent to be included. Missing standalone/nested
   media, missing manifest rows and altered paths/values/store identity fail.
   The four canonical row archives are added to receipt artifact hashes and
   revalidated on receipt verification.
4. **Original signature encoding:** removed transforming `.trim()` validation.
   Padded identifiers are rejected, and parsed context/envelope must preserve
   original canonical representations exactly. Signature verification uses the
   original `canonical(record)` bytes. Regressions reject edits without resealing,
   resealed padded identifiers and normalized-context substitutions.

The revised contract uses `blog-recovery-context-v2`,
`blog-recovery-evidence-v2` and `blog-recovery-receipt-v2`; v1 inputs are rejected.
The context template retains explicit null blockers for actual returned IDs and
cleanup identity. The approval request, recovery document and CLI README now
describe reprovisioning, complete captures, typed references and dispositions.

Full capture format: all columns of every row, sorted by exact `id` using
code-unit ordering, encoded as `canonical(rows)` with no trailing newline.
External/static/non-media values conservatively detected by the scanner require
exact reviewed `excludedReferenceValues`; source-host references cannot use that
exception. Unsupported/ambiguous source syntax requires reconciliation or a
reviewed extractor extension before acceptance. Export completeness/provenance,
independent context/public-key trust and actual provider proof remain external
requirements; this code does not collect live data or authorize production.

### Additional self-review regression

A narrowly scoped synthetic probe found a protocol-relative source-host value
could use the external-reference exception. Added a failing regression first:
`bun test --no-env-file scripts/blog-cms/recovery-evidence.test.ts -t 'fix1 cannot exclude'`
returned **0 pass / 1 fail / 79 filtered**, exit 1.
Log: `task-6-fix1-source-host-red.log`. Host classification now recognizes
protocol-relative source URLs, then rejects their noncanonical encoding; an
external exception cannot hide them. Final tests include this regression.

### Commands and results

- Expanded recovery-only run after the principal fixes:
  `bun test --no-env-file scripts/blog-cms/recovery-evidence.test.ts` — **75 pass /
  0 fail**, exit 0, 112 assertions. Log: `task-6-fix1-tests-expanded.log`.
  Later tests add legacy markup, exact external exclusions, raw capture ordering/
  completeness, source-store identity and protocol-relative rejection.
- Initial combined focused run while typecheck/lint ran concurrently:
  **118 pass / 1 fail**, exit 1. The existing release-packet test
  `rejects inconsistent rehashed migrationSha256` exceeded its 5,000 ms limit
  (5,272.45 ms). No recovery test failed. This is retained, not represented as
  a passing run. Log: `task-6-fix1-focused-final.log`.
- Final combined command, run by itself after the last hardening change:
  `bun test --no-env-file scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/release-controls.test.ts scripts/blog-cms/release-packet.test.ts scripts/blog-cms/writer-control-register.test.ts`
  — **120 pass / 0 fail**, exit 0, **269 assertions**, four files, 11.77 seconds.
  This includes 80 recovery tests and 40 adjacent release/control/register tests.
  Log: `task-6-fix1-focused-verified.log`.
- `npm run typecheck` — **PASS**, exit 0.
  Log: `task-6-fix1-typecheck.log`.
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --strict --types bun scripts/blog-cms/recovery-evidence.ts scripts/blog-cms/recovery-reference-manifest.ts scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/recovery-receipt.ts`
  — **PASS**, exit 0 after final code changes.
  Log: `task-6-fix1-script-typecheck-verified.log`.
- `node node_modules/eslint/bin/eslint.js scripts/blog-cms/recovery-evidence.ts scripts/blog-cms/recovery-reference-manifest.ts scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/recovery-receipt.ts`
  — **PASS**, exit 0, zero errors/warnings; log: `task-6-fix1-lint-verified.log`. The first lint run
  found one `no-useless-escape` violation in JSON-prefix detection; that regex
  was replaced with a direct character check before final verification.
- `node node_modules/prettier/bin/prettier.cjs --check scripts/blog-cms/recovery-evidence.ts scripts/blog-cms/recovery-reference-manifest.ts scripts/blog-cms/recovery-evidence.test.ts scripts/blog-cms/recovery-receipt.ts docs/superpowers/evidence/blog-cms/recovery-context.template.json`
  — **PASS**. `git diff --check` — **PASS**.

Verification is scoped to the amended offline code and adjacent focused tests;
it is not full repository/CI/provider/hosted acceptance. The earlier timeout is
resolved by the clean final run, with no edits to the adjacent packet test.
Resource limits remain 16 MiB per CLI JSON and 512 MiB total archives; complete
raw table captures may exceed that bound and must fail closed rather than omit
rows. Local blog-table snapshots remain insufficient for full recovery.

No provider or production changes, production data access, credential/token
retrieval, push, merge or deployment occurred. The fix and this appended report
are committed locally; all external evidence/approval gates remain blocked.
