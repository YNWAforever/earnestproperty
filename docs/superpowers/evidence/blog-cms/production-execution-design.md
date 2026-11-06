# Remaining production executor implementation contract

This is the concrete implementation boundary for the release package. **Not implemented, not approved to execute.** The offline draft adapter cannot write. The existing `src/lib/neon/blog-import.ts` remains restricted to inspected owned Docker targets.

## Reuse without weakening the owned guard

Extract the current snapshot, plan validation and mutation/receipt sequence into an internal transaction core. Keep connection construction and capability storage outside it. The owned entry point must continue to inspect its exact container/image/name/loopback, database/system identifier and environment exclusions before invoking the core. Re-run its full target-guard and actual PG17/PG18 regressions after extraction.

The separate production entry point must construct its own capability from an explicitly approved, secret-safe direct connection with TLS verification and exact endpoint/database/session identity. It must never accept a caller-provided `verified=true`, an arbitrary query hook advertised as a verified target, an owned identity retagged as production, or the default application connection loader. Provider project/branch-to-endpoint mapping and SQL session identity are distinct checks. The currently USER_CONFIRMED application binding must retain that evidence label until stronger proof exists.

No currently selected production identity permits safe fencing by itself: the runtime owner is shared, and allowing it also allows old writers. Final role/credential design must follow the named database/platform owners' writer-control review. This dependency is why a hypothetical generic production client is not supplied as a runnable release tool.

## Transaction boundary to implement and rehearse

1. Validate the exact approved release packet, source bytes, full application/operational-code identity, migration byte hashes, target identity, expiry/window, backup restoration receipt and sustained-fence generation. Absence is a stop, never an override flag.
2. Use one pinned direct connection. Set bounded lock/statement/idle-in-transaction timeouts; verify session database/role/endpoint association. Acquire the advisory blog lock where available and the existing baseline table/ledger locks before the first content-changing statement. Acquire corresponding new-table locks after DDL. Check potential existing generic CMS lock order to avoid deadlock.
3. Recollect the locked complete pre-migration baseline and compare with its approved fingerprint/schema/95-entry ledger. Do not compare the production 95-state to a fabricated 98-state snapshot. Any row, revision, source or ledger drift aborts.
4. Apply exactly the three reviewed migrations and ledger entries atomically. Capture their actual post-migration state; deterministic transformation/normalization must be covered by the approved packet and independently verified. No automatic acceptance of migration-created random IDs/timestamps by relabeling the local snapshot. If the design requires two phases, each needs its own approval and sustained fence; do not silently split atomic scope.
5. Execute the shared import semantics against the verified normalized state: retain authoritative DB content/history, reject collisions and unsupported source, initialize approved placeholders only, preserve null dates and fixed slugs, create matching initial revisions, preserve ordered eligible features, and avoid unrelated writes.
6. Commit an atomic durable receipt bound to the approved production release fingerprint and actual post-import state. On retry or lost response, verify the matching receipt before treating expected post-import changes as stale input; report newer editorial drift with zero repair writes. The receipt must distinguish migration and import completion and support recovery when a COMMIT response is lost.
7. Release transaction locks only after verified commit. The external sustained fence must remain effective across connection loss, process exit, artifact activation, CDN checks and explicit reopening. No finally-block may automatically reopen production.

## Required acceptance matrix

| Case | Required result |
| --- | --- |
| Wrong project/branch/endpoint/database/role, swapped TLS host or owned target | Reject before mutation |
| Missing/expired/fabricated approval, backup or fence evidence | Reject before mutation |
| Changed source/migration/app/core bytes or nested identity | Reject; never regenerate approval |
| Concurrent direct SQL or generic CMS writer; fence loss | Block/reject safely; bounded timeout and no partial changes |
| Missing/extra migration version; unsupported legacy schema | Abort before DDL/content writes |
| Failure between migrations/import/receipt insertion | Full rollback within approved atomic scope |
| Successful COMMIT followed by lost response | Receipt-based retry, no duplicate records/history/ledger or silent repair |
| All 112 exact source records | Existing URLs/content preserved, matching history, CMS editable, seven categories/eight scopes |
| New private drafts, publication edits or withdrawal after release | Retry reports drift and preserves newer work |
| Targeted repair with stale/current CAS token | Stale rejected; current repair changes only approved fields |

Test first with a newly owned PG18 target using the real transaction core and distinct synthetic roles/fence controls, then in an explicitly approved isolated Neon environment. Local test injection is not exposed as the production capability constructor. Independent review and a fresh full source/build receipt are required after implementation; the current preparation receipt cannot certify future executor code.
