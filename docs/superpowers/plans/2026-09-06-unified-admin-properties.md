# Unified admin property implementation plan

> Use superpowers:subagent-driven-development with independent review.

**Goal:** One property number, one admin row and workspace; independent sale/rental management.
**Architecture:** Existing persistent public membership remains identity authority. New grouped admin read boundary applies latest-per-deal ranking before filters, and stable group version tokens. Atomic scoped management writes preserve old rows and record group-level manual overrides; database trigger reapplies explicit overrides to incoming source writes so public reads retain current rules.
**Stack:** TanStack Start/React, TypeScript, Neon PostgreSQL, Bun/Node/Playwright.

## Constraints
Approved spec: docs/superpowers/specs/2026-09-06-unified-admin-property-design.md. Preserve unrelated files. No live customer writes/messages or production migrations during development. Use approved disposable branch br-quiet-hat-aoxbj2ue for isolated schema integration. Production schema rollout requires review of the concrete migration and approval.

## Interfaces
New src/lib/neon/admin-properties.types.ts:
- SharedPropertyFields: title_zh/title_en, estate_id, district_slug, address, saleable_area, bedrooms,bathrooms,floor,description,images,seo_title,seo_description,video_url. Nullable fields mirror AdminPropertyInput; title_zh string and images string[].
- ManagedOffering: id, dealType sale|rent, price/rent nullable number, status string, description nullable string, agentId/agentName nullable string, editable boolean.
- ManagedPropertySummary: propertyNo,title,estateName nullable string,image nullable string, saleableArea nullable number, offerings:{sale:ManagedOffering|null,rent:ManagedOffering|null}, version:string, editableShared:boolean,unlinked:boolean,reviewRequired:boolean.
- ManagedPropertyDetail extends summary: shared:SharedPropertyFields, history:{id,listingNo,dealType,status,sourceUpdatedAt:string|null,current:boolean}[],conflicts:{field:string,values:string[]}[],managementAvailable:boolean.
- PropertyGroupFilters: q?,status?,deal?:all|sale|rent,estateId?,agentId?,page?:number,pageSize?:number. Default status active; all includes ended/drafts. Filtering happens after ranking current offers and grouping; matching offer filters must apply to same offering.
- PropertyManagementInput: propertyNo,expectedVersion,scope:shared|sale|rent|all,payload:Partial<SharedPropertyFields> & {price?:number|null,rent?:number|null,status?:string,agentId?:string|null}. all only accepts status offline. Shared updates use changed fields only, so unresolved conflicts aren't guessed.
New src/lib/neon/admin-properties.ts exports fetchAdminPropertyGroups({data:filters}) -> {rows:ManagedPropertySummary[],total:number,page:number,pageSize:number}; fetchAdminManagedProperty({data:{id:string}}) -> detail|null resolves raw UUID or canonical number; saveAdminPropertyManagement({data:input})->{ok:true}.

## Task 1 Grouped read model and API
- [x] Create shared types and input contracts/tests first.
- [x] Add isolated admin-properties.server.ts read functions and wrappers in admin-properties.ts; preserve staff agent row scope, latest across all statuses before filters, unlinked visibility, exact grouped counts/page, raw aliases/history, conflicts and version token. No frontend files.
- [x] Unit and disposable schema SQL integration for duplicate sources/dual offers/withdrawals/agent isolation/count/page.

## Task 2 Atomic management and source protection
- [x] Create migration with persistent group overrides and source snapshots/history boundary plus BEFORE source-row write protection. Allowlist editable fields only; never override identity/source keys. No effects before admin opt-in edits.
- [x] Add atomic transactional management function with group/current-member locks, version conflict and field/deal-specific staff authorization; changed shared fields apply to current offers only; sale/rental saves isolated; missing offering can be added only with permission over group. Audit in same transaction. Never alter historic rows for normal admin edits.
- [x] Integrate server mutation via new module; test real SQL atomicity/races, imported new aliases and status corrections preserving manual overrides, source snapshot retention, unrelated groups unaffected. No production apply.

## Task 3 Admin list/workspace UI
- [x] Replace list presentation with one property row, independent prices/statuses, clear current/all filters, grouped paging, management/public canonical links.
- [x] Old /admin/listings/$id opens managed property workspace resolving ID and selecting its deal context. Shared data, independent offering panels and collapsed history/conflicts. Changed-field-only saves, unsaved guards, loading/retry/conflict feedback, clear per-offer status actions and explicit all-offer confirmation.
- [x] Preserve new listing route; after first creation old id resolves into workspace. Manual missing identity remains visible.
- [x] Synthetic browser and unit checks for shared conflicts, independent saves, old links, correct counts/filtering, mobile and permission denial.

## Task 4 Review and rollout
- [x] Relevant suites/typecheck/lint/build, independent review, migration artifact and disposable integration evidence.
- [ ] Present exact schema rollout for approval if needed; never claim production completed while gated.
