# Homepage latest inventory — 2026-09-07

The homepage used a separate featured-first query, so the listings-page newest-order fix did not affect its six cards. New ingestion rows also lacked legacy source metadata, hiding their update stamp.

The existing homepage query now uses created_at DESC, id ASC both for the eligible canonical representative and final ordering. Authoritative offer ranking, publication filters, staff featured values, identity, aliases, corridor filtering and one-card-per-property behavior remain intact. The section is labelled 最新放盤 and no longer promises same-day new stock. Its stamp uses the latest valid record timestamp through propertyUpdatedAt.

Validation executed:
- test:homepage: 17 passed.
- test:listing-search: 75 Node tests + 12 Bun tests passed.
- site.test.mjs and estate-conversion.test.mjs: 51 passed.
- typecheck, focused ESLint, production build and git diff --check passed.
- The actual generated homepage SQL was executed read-only against production. The first six public identities were A060282, A062602, B059723, A052440, R047571 and B055385; all were created on September 7 and belong to the corridor.

No database writes, migrations, schedule changes or deployment were performed. Post-deployment homepage browser verification remains required. Rollback by reverting this commit; no data rollback is required.
