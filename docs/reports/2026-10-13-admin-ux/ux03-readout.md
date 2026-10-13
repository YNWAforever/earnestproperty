# T-UX03 — daily lists and authorized shortcuts

Source: 59043559e96bb7331e785dd4deff59cccf119bbb + task diff; final clean-head verification pending

- Before migration: property owned suite 144 passed; daily/attention/safer-actions baseline 174 passed.
- New role regressions: 5 expected failures (property-sync at four viewports, command-center from agent leads).
- After migration: 341 browser checks passed (174 daily/attention/safer-actions, 144 property, 8 navigation, 15 layout). Command-center contracts: 127 Node + 94 Bun + 7 disposable-DB checks passed. Typecheck passed.
- Five routes explicitly use standard width. Existing primary actions moved to the header; filters and selection actions remain with their current handlers. Listings keep disabled bulk scope and block the moved creation link while a batch is pending.
- Agent cannot see either manager-only shortcut; manager retains the sync shortcut. Server role/capability and scope checks unchanged.
- Existing tests that parsed old inline nav metadata were updated to import its new owner. Duplicate destination, exact-active, query, business wording, badges and ACL checks retained. No acceptance assertions were weakened.
- 100 normal geometry instances remain a pending denominator until T-UX07.

Owned UI uses actual React routes with synthetic Auth/API. No normal Auth, real provider or human acceptance claim. Run logs are private under .audit/admin-ux-20261013/. Browser contexts and servers were disposed; no production writes. Historical F/RPK/UC statuses are unchanged.
