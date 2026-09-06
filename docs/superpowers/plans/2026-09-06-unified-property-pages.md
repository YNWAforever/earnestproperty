# Unified property pages implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** One verified property identity, one public card, one detail URL with independently actionable sale/rental offerings; audit every stored property.

**Architecture:** Keep `properties` rows as offering/source history and inquiry FK targets. Add persistent `property_public_groups(public_listing_no, canonical_property_no, review_required)` and `property_public_members(property_id, public_listing_no)` identity mappings. Group only consistent physical identities. Public reads rank latest offerings within each identity before filters/count/page limits; retain original IDs and selected offering for inquiries. Old listing URLs redirect to the stable group URL.

**Tech Stack:** PostgreSQL/Neon, TanStack Start, React, TypeScript, Node/Bun tests, Vercel.

## Global constraints

- User approved one property/card/detail and full data audit, retaining independent sale/rent status.
- Existing production repair/deployment authorization persists. Apply additive migrations first on approved Preview br-quiet-hat-aoxbj2ue, then production br-polished-sea-aom4i1ct after verification.
- Preserve all old property rows, inquiry references, source URLs, authored fields and unrelated local work. No guessed floor/area/price corrections. No customer messages or provider sends.
- Inconsistent physical values (estate, district, area, bedrooms, normalized floor) isolate identities for review. Similar title/photo alone is not identity proof. Group matching sale/rent from one original detail page where consistent.
- No migration approval prompt is needed: this implements the reviewed, explicitly approved scope. Any unexpected destructive action remains out of scope.

### Task 1: Audit and identity persistence

Files: migration `supabase/migrations/20260906040000_property_public_identity.sql`, new `src/lib/neon/property-identity.db.test.mjs`, audit `docs/audits/2026-09-06-property-data-audit.md`.

- [ ] Read-only audit all statuses, IDs, physical facts, prices, text, estate references and media; record exact counts and conflicting public identifiers.
- [ ] Write failing disposable DB test: same canonical/physical fields with multiple external IDs maps to one stable group; sale and rent share group; null values do not conflict; contradictory floors/area do not merge; existing rows survive; new import records get mapped.
- [ ] Add groups/members tables, deterministic safe initial grouping and guarded assignment trigger for future inserts. Source aliases remain stored. Conflicts use isolated stable slugs and review_required.
- [ ] Verify on approved disposable branch before applying production migration.

### Task 2: Public unit read model

Files: `src/lib/neon/public-data.server.ts`, `public-data.types.ts`, `src/lib/queries.ts`, `src/lib/neon/public-performance.db.test.mjs`, new `src/lib/neon/property-unit-query.ts` and tests as needed.

Interfaces: extend `NeonPropertyRow` with optional `public_listing_no: string` and `offerings: PropertyOffering[]`; `PropertyOffering = { id: string; listing_no: string; deal_type: "sale"|"rent"; price: number|null; rent: number|null; status: string }`. Existing `id` and `listing_no` remain offering identifiers. All list row types retain these new fields. Detail fetch accepts either public_listing_no or legacy listing_no and returns one unit with current sale/rent summaries.

- [ ] Regression tests cover all=one card, sale/rent filters preserve appropriate amounts, correct COUNT/LIMIT, inactive offering never shown as active, legacy detail lookup, conflict isolation.
- [ ] Select fresh offering per group+deal before user price filters; select one representative per group after filters. Aggregate both active offerings from the same unit. Sold/rented-only detail remains unavailable/noindex.
- [ ] Add stable URL/price helper shared by all cards and detail. Update compatibility dedup to prefer public identity only when grouped offerings are supplied.

### Task 3: Cards, detail and inquiry identity

Files: `src/routes/property.$listingNo.tsx`, `src/routes/listings.tsx`, `src/routes/index.tsx`, `src/routes/estate.$slug.tsx`, `src/routes/agents_.$slug.tsx`, `src/routes/videos.tsx`, `src/components/site/CorridorInventory.tsx`, associated tests and shared property presentation helper.

- [ ] Cards link to public_listing_no, display both available prices and remove misleading sale-only/rent-only title labels for dual offerings. All listing surfaces use the same helper.
- [ ] Detail loader redirects old aliases with 301 to stable URL. Head canonical/JSON-LD/share/saved item use unit URL. Display sale/rent options with independent state and prices.
- [ ] Inquiry, WhatsApp prefill, mortgage and analytics use selected active offering; persist the real offering property_id. Switching to rental never shows sale mortgage. No automatic inquiry submissions during verification.
- [ ] Verify meaningful rendering/payload tests and browser read-only live samples B054645 and B075535 plus a dual offer withdrawal fixture.

### Task 4: Source update continuity and release

Files: `src/lib/mls/neon-db.mjs`, source tests, audit/release report as needed.

- [ ] Verify future re-import aliases are assigned to the same unit and do not duplicate public cards; preserve old links/rows and stop ambiguous source records from silently replacing another physical identity.
- [ ] Review the full diff independently, run relevant test suites/typecheck/build, exercise real PostgreSQL counts/pagination/aliases on disposable DB.
- [ ] Apply additive migration using native Neon transaction connector, merge reviewed PR with CI/Preview green, verify production commit/alias and representative page redirects/content.
- [ ] Report all-data audit coverage and unresolved source conflicts without calling them corrected facts.
