# One property admin workspace

Status: approved by user on 2026-09-06; implementation in progress.

## Verified problem
Production read-only query confirms both reported row IDs map to canonical/public listing number R075733. Latest sale is HK$6,700,000 and latest rent is HK$18,000/month, both active. The same group has eight older inactive source records. Backend listAdminListings currently reads properties rows directly and current edit/status operations address individual source row IDs. The public site already has persistent property_public_members grouping.

## Recommended model
One property number, one admin row, one management page. Each property contains independent sale and rental offerings. Group exclusively by verified identity mapping/property number; never by similar estate, title or address. Missing identity stays visibly unlinked until assigned; it must not disappear.

Keep original source IDs, inquiry foreign keys, audit history and old editor links. The management page is a unified workspace, not destructive deletion of source records. Existing source edit URLs resolve to the property workspace and select their sale/rent section. Public preview uses the stable canonical URL.

## List
Columns: thumbnail/property name and number; estate/building/unit facts where available; sale price and sale status; monthly rent and rental status; responsible staff; update/conflict indicator; Manage and public preview.

Example: R075733 | 碧堤半島 第07座 | HK$670萬 / 出售中 | HK$18,000每月 / 出租中 | 管理.

No price is shown as zero when absent. No missing unit or floor is invented. Missing offering shows 未放售/未放租, distinct from a paused or completed offering. Sale/rent filter matches the offering but still returns one property row and retains the other offering's context. Counts/page boundaries operate on property groups before slicing, not deduplication of an already limited source page. Default current supply view; ended/unlisted and source history remain searchable separately.

## Management page
Header: neutral property title without 租盤/售盤 duplication, canonical number, both offering summaries and one public preview.

Sections:
1. 物業資料: shared factual fields, images and shared page copy. Save once for the property.
2. 租售管理: two side-by-side panels on desktop, stacked on mobile. Each has its own price, status, offering-specific note and responsible staff. Each save names its scope explicitly: 儲存出售條件 or 儲存出租條件.
3. 來源與紀錄: source aliases, timestamps, raw records and admin history, collapsed by default. Historic records are not current competing listings and cannot resurrect an older active offer.

Shared edits require explicit field-level reconciliation if current sale/rent physical facts disagree. Show a conflict badge and both values; user may still manage prices/status without guessing shared facts. Server enforces permissions for every affected offering; grouping cannot grant an agent access to another agent's row. Partial scope is clearly read-only or inaccessible as appropriate.

## Status actions
Replace generic 下架 with 下架出售 / 下架出租 at the offering. 已租 changes rental only by default; 已售 changes sale only by default. Completion confirmation may offer a separate explicit option to close the other offering, showing current values and resulting states before saving. The other offering is not silently closed. 全部下架 is an explicit property-wide action with confirmation and atomic permission checks.

If rental completes and sale remains active, list shows 已租 plus 出售中 rather than treating the whole property as closed. A transaction record is not automatically inferred merely from changing listing status.

## Writes and synchronization
Resolve the latest member for each deal across all statuses before filtering, matching the existing public identity rules. Mutations check the expected current offering/version and fail with a refresh/compare path on concurrent changes. Shared-field writes are atomic and audited; historical source payloads are preserved.

Manual management values and source facts need a documented precedence/persistence boundary: background import must not silently undo an admin price/status/shared-field correction. Use explicit persisted admin overrides or equivalent existing mechanism, with source differences exposed for review. Implementation planning must verify whether additional schema is required before rollout; this design does not authorize an unreviewed data migration or bulk rewrite.

## Alternatives
- List-only grouping is smaller but leaves duplicate editors and conflicting shared edits; insufficient for daily management.
- Recommended unified workspace keeps source history and independent offers while giving admin one record to manage.
- Flatten everything into one status/price row loses sale/rental distinctions and linked history; avoid.

## Acceptance
R075733 appears once; sale/rent values match existing records; its eight old rows are available only as history. Editing rental cannot change sale price/status; explicit all-offer actions are atomic. Shared edits survive reload and defined synchronization behavior. Counts/filtering/paging use groups; withdrawn latest source prevents older resurrection. Old editor/public links still work. Test admin/manager/agent access, concurrency, unsaved changes and 390px mobile using synthetic data before approved rollout.
