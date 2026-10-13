# T-UX08 — Layered role and daily-workflow evidence

Source: 2a23c48e84b78ac756f9314bf95fcb70e0125b50 + task diff; final clean-head verification pending

Implementation source SHA: 2a23c48e84b78ac756f9314bf95fcb70e0125b50. Only reporting files changed during this task.

- 772/772 existing owned browser workflow cases passed (11.4 minutes): daily work, workspace identity, staff setup, identity/lead conflict, campaigns, attention, safer actions, performance readback, link batches, mobile inbox and sync recovery. Synthetic Auth/API, owned loopback only.
- 225/225 tests across seven owned PostgreSQL suites passed, with zero skips. Golden 23; property maintenance 6; lead integrity 41; contact identity/ingest 46; campaign 38; operations 20; opt-out/outbound intent 51. Each harness uses a newly named pinned PostgreSQL 17 loopback container and 93 migrations. Actual server/SQL functions are exercised with mocked staff/provider/model boundaries. Network/provider effects are denied or explicitly stubbed. Independent readbacks cover receipts, original intent, CAS, branch/actor limits and revoked writers.
- Golden restore readback preserved FK/provenance/replay identity and a recent write in the original owned database; no production database participated. Eight concurrent synthetic actor sessions are not normal Neon Auth sessions.
- Team/Auth: 106 Node +44 Bun passed; CMS: 60 Node +31 Bun passed; safe redirect/CSV/formula/presentation: 11 Bun passed. The five safe-redirect cases were also run separately. No live model invocation.
- Before/after container inventory was empty. Harnesses stopped and removed only their owned IDs. Browser contexts/HTTP servers disposed. No production writes, real recipient sends or paid provider canary.

All 50 new cases now have case-specific actual evidence, SHA, original target roles, environment/layer and cleanup. They remain partial because their required full normal-session journeys have not been executed. The immutable input retains 50 not-tested statuses. Earlier generic case links (including T-UX05 inbox evidence accidentally attached to property/transaction cases) are superseded by this explicit per-case mapping; historical task reports are retained.

role-route-execution.csv contains all 100 unique route/role pairs, separate sidebar, source read, write, synthetic UI and normal Auth results. All 100 normal-Auth direct-route/read pairs are blocked, not passed. A user request for an isolated full app URL and four role sessions remains unanswered. The existing CMS revision engine allows agent own-draft/resource reads independent of admin/manager directory navigation; static new-estate form has no route-specific denial. These policy differences are recorded without changing backend ACLs.

Normal Auth→server→DB/provider, native mobile IME/keyboard, authorized HKWTIA post-login comparison, deployed version and human UAT remain unverified. No legacy F01–08/RPK01–07/UC01–20 is closed. Release recommendation remains HOLD pending those gates. Detailed SQL counts/timing/log hashes: ux08-sql-results.json.

Owned UI uses actual React routes with synthetic Auth/API. No normal Auth, real provider or human acceptance claim. Run logs are private under .audit/admin-ux-20261013/. Browser contexts and servers were disposed; no production writes. Historical F/RPK/UC statuses are unchanged.
