# Public newest listing order — 2026-09-07

## Reproduced cause

Public search labelled its default order 最新上架, but sorted featured records first, then legacy last_seen_at, then created_at. Production read-only aggregation confirmed 77 active offers created on September 7, all without legacy last_seen_at; the newest legacy last_seen_at remains August 24. The old query's first page therefore contains older records even though new active inventory exists.

## Fix

Newest search sorts site-created date descending with ID as stable tie breaker. The same order selects the representative among current eligible offers for a company property number, so a newer rental offer is not hidden behind its older sale offer. Authoritative current-offer ranking and terminal suppression are unchanged; one company property number still yields one result. Other sort tie breakers and dedicated featured sections are unchanged.

Grid/list freshness stamps select the latest valid stored updated_at, last_seen_at or created_at. They no longer require source_site, which is absent on new pipeline records. No current-time fallback and no fabricated source-check timestamp are used. The label indicates record freshness, not an assertion that the external advertisement was checked today.

## Evidence

The actual generated search SQL was executed read-only against the production branch with output limited to public property numbers and timestamps. Old first-page records date from August 21–24. The corrected first page contains 12 September 7 records, including A060282, C020617, A074657 and R075925. No business data was changed.

- test:listing-search: 75 passed.
- test:property-experience: 142 Bun and 143 Node tests passed.
- TypeScript, focused ESLint and production build passed.
- Static independent review: no actionable regression found; existing same-deal source-state precedence deliberately preserved.

Actual web/browser deployment validation remains a release check. This task does not change the daily collector or its accepted baseline, update production timestamps, publish additional offers, or run a migration. Deployment requires the normal approved application release; rollback is reverting this code change, with no database rollback required.
