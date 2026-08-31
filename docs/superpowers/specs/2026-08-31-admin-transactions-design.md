# Admin Transactions (create/verify/publish) — Design

**Status:** Approved, ready for planning.

## Problem

`transactions` has existed since the original schema, and P5's
`transaction_provenance` migration added a full verification/publish gate
(`source`, `source_url`, `verification_state` enum, `verified_at`,
`agent_id`, `published`, `block`, `floor_band`, `social_state`). Every
public query (`fetchRecentTransactions`, `fetchDistrictTransactions`,
`fetchEstateTransactions`) already correctly filters on `published = true
AND verification_state = 'verified'`. `/transactions`, the district
transaction chart, and every estate page's transaction table already
render correctly against that filter.

**The gap**: no admin UI, no server function, no import script — nothing in
the entire codebase has ever written a row to `transactions`. Confirmed by
grep: zero `INSERT INTO transactions` anywhere in `src/` or
`scripts/`, and no seed data in any migration. The table has zero rows in
production. This was found while writing P8's `FRONTEND_DATA_CONTRACT.md`
handoff doc (2026-08-31) and flagged as the highest-value real gap left
after the master plan's P0–P8 phases all shipped.

## Data source model

Confirmed with the user: these are **the agency's own closed deals**, not
scraped/imported market data. The site's own branding
("晉誠地產最新成交" — Earnest Property's own recent transactions) already
implies this, and unlike `properties` there is no existing sync pipeline for
transactions to plug into. A staff member logs a deal after it closes, the
same way `admin.listings.tsx` lets staff create/edit a listing by hand.

**Explicitly out of scope for this phase** (confirmed): linking transaction
entry to the listings table (e.g. a "record as transaction" action when a
listing's `status` flips to `sold`/`rented`). Standalone entry only — works
even for deals that were never listed on this site (off-market/pocket
listings). Revisit if duplicate data entry becomes a real pain point later.

## Access model

Mirrors the closest existing precedent, `saveAdminProperty`'s
`agentScope()`:
- `agent` role: can create a transaction; can only see/edit transactions
  they themselves logged (`agent_id = actor.staffId`, ignoring any
  caller-supplied `agent_id` on insert, same guard `saveAdminProperty`
  already applies).
- `manager`/`admin`: see and edit every transaction, regardless of who
  logged it.
- **No second-person verification gate** (confirmed with the user) — the
  same staff member who logs a deal can mark it verified and published in
  the same form submission. This differs from `cms.publish`, which is
  manager/admin-only for CMS content; transactions don't need that split
  since the person logging their own closed deal is the authority on
  whether it's real.

## Verification/publish UI

The DB's `verification_state` enum has 3 values (`unverified`, `pending`,
`verified`) plus a separate `published` boolean — 4 real states in
combination. **The form exposes one checkbox**: "已核實並發布" (verified
and published). Checked → `verification_state = 'verified'`, `published =
true`. Unchecked → both stay at their column defaults
(`unverified`/`false`). `pending` remains a valid, untouched DB value (no
migration change) but this v1 form never sets it — nothing in the current
product needs a 3-way distinction, and a select can replace the checkbox
later without a schema change if that need shows up.

## Layout

Full-page admin CRUD, matching `admin.listings.tsx`'s exact shape (chosen
over a list+slide-over-panel alternative, compared side by side and
approved) — list view with search/filter, separate new/edit pages, one URL
per record. Not a smaller/lighter pattern, even though the form itself is
short — consistency with the rest of this admin CRM (Listings, Estates,
Agents) was judged more valuable than saving a few files for one route.

## Files

- `src/routes/admin.transactions.tsx` — list: table of estate / deal type /
  price / date / verification+publish status, search/filter, link to
  new/edit. Mirrors `admin.listings.tsx`'s loader/component shape.
- `src/routes/admin.transactions_.new.tsx` — create form.
- `src/routes/admin.transactions_.$id.tsx` — edit form.
- `src/lib/neon/admin-data.server.ts` — new `listAdminTransactions`,
  `getAdminTransaction`, `saveAdminTransaction`, mirroring
  `saveAdminProperty`'s shape (including the `agentScope()` ownership
  guard).
- `src/lib/neon/admin-data.ts` — `createServerFn` wrappers for the three
  above, Zod-validated input.
- `src/lib/neon/admin-data.types.ts` — the new input/row types.
- Admin nav: add a "成交管理" entry (`AdminShell`'s existing sidebar nav,
  wherever Listings/Estates/Agents are already listed).

## Form fields

| Field | Source | Notes |
|---|---|---|
| Estate | Dropdown, `fetchEstateOptions()` | Required by the form/Zod validator (public rendering joins on it — a transaction with no estate would show as broken), even though the DB column itself allows null |
| Deal type | 買賣/租賃 radio | `deal_type` enum, matches `properties`' existing radio pattern |
| Price | Number input, required | Unlike `properties` (separate `price`/`rent` columns), `transactions` has one `price` column for both deal types — the public page already formats it deal-type-aware (`formatManDisplay`, no separate rent formatting). The form's label should switch between "成交價" and "月租" based on the selected deal type, same single field/column underneath. |
| Saleable area | Number input, required | Feeds the stored `saleable_psf` — compute and store at write time, not on read (unlike `properties`, which computes PSF client-side because it has no stored column; `transactions.saleable_psf` already exists as a real column) |
| Deal date | Date input, required | `deal_date` — every public query orders on this (`ORDER BY deal_date DESC`), so a null date would sort unpredictably |
| Unit / Block / Floor band | 3 optional text inputs | `unit`, `block`, `floor_band` |
| Source | Text, defaults to the current staff member's name | `source` — free text, not a hardcoded enum; e.g. an agent's own name, or "本行成交" for an older/imported-by-hand deal |
| Source URL | Optional text | `source_url` |
| 已核實並發布 | Checkbox | See "Verification/publish UI" above |

`social_state` is not in this form — confirmed unused everywhere in the
codebase (zero references outside the migration that added it); out of
scope, not touched.

## Testing

Mirror the existing pattern for `admin.listings.tsx`/`admin-data.server.ts`
— a `.contract.test.mjs` proving the real SQL shape (transpile-and-inline
harness, same as `transaction-search.contract.test.mjs` already does for
the *public* transaction queries) plus a route-level test asserting the
form fields, the `agentScope()` guard, and the single-checkbox
verify+publish behavior (both flags flip together, never independently).

## Explicitly out of scope

- Listing-to-transaction linkage (see "Data source model" above).
- A second-person verification/approval queue.
- Any change to the public `/transactions` page, district transaction
  chart, or estate transaction table — all three already query correctly;
  they just need rows to exist.
- Bulk import / CSV upload of historical transactions — not requested;
  revisit only if manually logging deals one at a time turns out to be a
  real bottleneck.
