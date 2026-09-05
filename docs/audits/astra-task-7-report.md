# Task 7 — complete, bounded admin retrieval

Implemented authorized `CursorPage<T>` retrieval for leads, contacts, conversations, messages, estates, articles, videos, FAQs and media. The server validates per-resource filters, clamps pages to 50, binds all values, scopes agents before filtering/counting, and uses timestamp plus UUID keysets. Cursor bindings include actor, resource and filters. Search applies to the complete authorized dataset. Private active CMS drafts replace their corresponding live row only for their author; full edit recovery remains the existing by-ID service.

The three admin routes now use server pages. Lead filters and cursor survive URL navigation; intent/source and FAQ scope allow explicit values, with page values only serving as optional suggestions, so options outside a current page remain searchable. CMS reads only its active tab and refreshes that resource after changes. Media excludes archived assets. The generic contact endpoint is available for complete bounded contact search; the current UI has no separate contact browser or contact selector (lead detail carries its existing contact identity), so no existing selector was left capped.

Inbox older pages prepend and deduplicate history. New polling fetches only the newer keyset page plus a separate ownership-checked, maximum-50-ID status reconciliation page. Outbound IDs rotate through loaded history so older unknown/accepted/delivered transitions are eventually reconciled. Reply text is not reset by polling. The viewport uses a prepend height anchor and only follows new messages when already near the bottom. Older loading fences polling; selection/request sequences reject stale responses. Save refresh updates both cursor state/ref and metadata only within its current request guard.

Traversal now uses stable created_at for conversations/live content/video lists. Since CMS draft created_at intentionally changes during save, migration `20260905181000_cms_browse_order.sql` adds an insertion-time browse_created_at. Drafts overriding live resources use the live creation time; draft-only rows use this stable field. Publication of a new resource changes dataset membership and explicit refresh resets the page. No immutable snapshot across concurrent insert/delete/filter changes is promised.

## Verification

- New paging suite: **14/14 passed**, including complete deterministic traversal of 10,000 leads, 10,000 contacts, 1,000 content rows and 100,000 equal-time messages; actor/filter cursor isolation; parameterized SQL; extracted actual delayed inbox loader preserving typing; older-load polling fence; bounded status IDs; actual older unknown-to-accepted reconciliation without moving the newer cursor.
- Combined CMS/paging regression run before the final four paging additions: **44/44 passed** (CMS recovery, atomic adapter and editor wiring retained). Cache dependency was added to the explicit test ports after its new production import; assertions were preserved.
- Focused route/source parse passed. Final focused ESLint passed with zero errors/warnings after order/status additions. Shared typecheck/build are coordinated by the parent.
- Executed `scripts/test-admin-pagination-db.mjs` on explicitly approved disposable branch **br-quiet-hat-aoxbj2ue**, Singapore. Every run created a random `paging_test_*` schema, used transaction-local search_path, inserted only synthetic fixtures, and dropped its own schema in finally. No application tables or provider calls were used.
- Real SQL checked response bounds, next-page disjointness at tied timestamps, a full-dataset rare lead filter, agent count=5,000 of 10,000, and zero messages/count for another agent. Final created_at/browse query revision also passed the same fixture.
- Full EXPLAIN ANALYZE/BUFFERS plans: `astra-task-7-explain.jsonl` and final-query rerun `astra-task-7-explain-latest.jsonl`.

## Measured index

Initial 100,000-message query execution was 731 ms. Deferring response JSON decoration to the final bounded aggregation reduced execution to **490.83 ms**, with a **581 ms** one-shot database HTTP round trip. A fixture-only `(conversation_id, created_at DESC, id DESC)` index reduced execution to **26.30 ms** and **151 ms p95 over 20 warm HTTP samples**. This measured predicate/order supports migration `20260905180000_admin_message_paging.sql`; the old two-column index cannot fully satisfy equal-time UUID ordering. The migration is not speculative. Parent owns applying the migrations to the approved branch.

For the same before/after run, leads/contacts/estates were 50 rows each, approximately 18,900/8,116/10,293 response bytes; single HTTP reads were 221/111/108 ms. Message response was approximately 10,111 bytes. These are database harness measurements from the local Windows caller to Singapore, not authenticated staging endpoint p95. Only the indexed message case has 20 warm samples; cold starts and deployed endpoint/browser performance remain acceptance gates. Do not treat the 500 ms staging endpoint budget as proven.

Authenticated desktop/mobile visual scroll and reply interaction acceptance remains open. Synthetic SQL and extracted handler tests cover the data/control behavior but do not substitute for browser layout evidence.

Final-query repeat: indexed message execution **24.89 ms**, 20 warm HTTP samples **144 ms p95**; unindexed execution491.79ms, one-shot750ms. Other one-shot reads: leads249ms, contacts175ms, estates101ms. This variability reinforces the distinction between local database measurements and the unmeasured staging endpoint budget.
