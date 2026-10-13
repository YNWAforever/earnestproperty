# T-UX04 — all eight editor routes

Source: a8e2c77a51feca30d40e563731ec5e8817389c70 + task diff; final clean-head verification pending

- Baseline: 10 leave-guard browser cases passed; transactions 76 Node/PGlite + 5 component cases passed; estate 27 contracts passed. Agent metadata contract exposed the extracted navigation owner and was updated to read that owner; 17/17 then passed.
- New RED: 6 real editor width/breadcrumb failures at 1440px.
- After migration: all 40 normal geometry instances (8 editors + overview/leads, each x4), two long-title cases, skip focus and three editor draft/collapse/cancel cases passed (46 total). Leave guards 10/10 passed.
- Property regression run: 143/144 passed, with a single 20s timeout at 1280px role-change. No assertion detail was emitted. Retained the failure log. The exact same case and timeout, with trace enabled and no code change, passed 3/3 repeats. This does not erase the original failure; full final-head regression remains required.
- Transactions 76 Node/PGlite + 5 component, estate 27, agents 17 and typecheck passed after migration.
- Seven form routes now share form896; managed property detail remains standard1440. All eight provide breadcrumbs and return links. No submit handler, dirty guard, validation, media upload or CAS code changed.
- Layout evidence is synthetic API only. Real Auth/DB saves and native keyboard remain separate acceptance gates.

Owned UI uses actual React routes with synthetic Auth/API. No normal Auth, real provider or human acceptance claim. Run logs are private under .audit/admin-ux-20261013/. Browser contexts and servers were disposed; no production writes. Historical F/RPK/UC statuses are unchanged.
