# Live inventory continuation — 2026-11-05

**Latest outcome:** the user confirmed binding and owner READ ONLY access. Live inventory is now collected and validated: 0 database article rows, 0 article revisions, and 112 source/public articles. See [live-reconciliation.md](live-reconciliation.md) for current evidence and remaining release gates. The preparation-time status below is retained as history.

Public/source capture is complete. Database content capture is NOT_RUN, pending the two user confirmations recorded below. Production remains unchanged; no push, merge, deployment, database writes, role changes or grants occurred.

## Completed

- [Public/source inventory](live-public-inventory.md): nine HTTP 200 GET observations, main plus all seven category pages, 112 exact registry/sitemap article URL matches and one separately excluded policy route. Thirteen deployed source files captured at `8b49d0a21c867c401c4d41db393e43c8db76a74d`. Controller independently verified all 46 entries in the final capture seal, zero hash mismatches. The bundle contains 112 registry records, 113 blog sitemap URLs and eight presentation pages.
- [Access checks](live-access-check.md): explicitly targeted `neondb` sessions enforce read-only repeatable-read; candidate schema is legacy, 95 applied migrations, none of the proposed three blog versions present. Existing `migration_monitor` cannot SELECT articles/revisions. The owner can connect, but is a privileged login rather than a dedicated reader.
- Separate collector: `scripts/blog-cms/live-inventory.ts`, with injectable interactive and one-transaction batch interfaces. No connection defaults, credential loading or application/importer edits. It preserves authoritative database JSON text, all article revisions/authors/states and related metadata; missing tables have unknown counts. Unsafe numeric values block normalization rather than silently rounding. Both missing-content and incomplete-read conditions remain explicit.

## Verification

Implementer recorded 23/23 collector tests and a focused strict TypeScript check passing after fixes. Tests use synthetic in-memory PGlite and fake adapters, not production. Independent scoped review accepted both initial findings (empty legacy mapping keys and JSON numeric precision) with no remaining actionable finding in that scope.

An earlier broader regression run recorded 30 pass / 1 fail, with Bun child `CouldntReadCurrentDirectory`. Controller reran exactly the failing existing test outside the sandbox:

```powershell
bun test --no-env-file src/lib/blog/import-snapshots.test.ts --test-name-pattern 'CLI defaults to dry run'
```

Result: exit 0, 1 pass / 0 fail, 8.72s. The historical failure remains recorded; this is the focused follow-up, not a new claim that the whole broader suite was rerun. `git diff --check` also passed.

Collector source SHA-256: `5e1672bd937c375c3f1243ff1e51f3275e7f736bce5d3161ea1236831ff307a3`.
Collector tests SHA-256: `9d785b09acb039053db4bad6702b4803ed38419fceb97b52999ec6bbdeb329b3`.

Detailed commands and initial/fix evidence: `.superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/collector-report.md`. No fresh full application build or HTTP acceptance was run for this operational-tool addition. The prior complete-source build receipt is historical and must be refreshed before release.

## Pending inputs and next action

1. Confirm whether the current production deployment uses project `dawn-meadow-79190048`, branch `br-polished-sea-aom4i1ct`, endpoint `ep-divine-frost-aokzrg7f`, database `neondb`. Vercel returns only sensitive-setting metadata, not an endpoint value. Record an owner confirmation as USER_CONFIRMED, never AUTOMATED proof.
2. Confirm use of the existing owner connection strictly within enforced READ ONLY transactions, or require a dedicated read-only login. No login or privilege changes are authorized or needed for the first option. No password/connection string should be sent in chat.

After those answers: create the explicit target/binding receipt, refresh schema metadata, build the tested capture batch, execute it in one read-only repeatable-read transaction with timeouts, validate the complete results, and store raw JSON privately with a sanitized count/hash receipt. Preserve missing schema and normalization gaps; do not install migrations to complete the capture. Current live article/revision/private-draft counts remain UNKNOWN. Release approval is not requested and release remains blocked.
