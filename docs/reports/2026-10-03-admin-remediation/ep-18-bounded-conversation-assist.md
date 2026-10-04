# EP-18 bounded conversation SQL readback

The old function aggregated full history before JavaScript sliced ten messages. New SQL takes the most recent ten inside a LATERAL query, ordered by `created_at DESC, id DESC`, before aggregation. The existing `wa_can_read_conversation` ACL and bound parameters remain. The JavaScript slice is removed; the raw database result itself is bounded.

Owned loopback PostgreSQL 17, all 85 registered migrations, synthetic messages of equal size and identical timestamps:

| History | Before raw rows | After raw rows | Before payload bytes | After payload bytes |
|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 2 | 2 |
| 10 | 10 | 10 | 7,421 | 7,421 |
| 1,000 | 1,000 | 10 | 742,001 | 7,421 |
| 10,000 | 10,000 | 10 | 7,420,001 | 7,421 |
| 100,000 | 100,000 | 10 | 74,200,001 | 7,421 |

The same local sample's query time at 100,000 messages was about 1,183 ms before and 2.31 ms after. These are local observations, not cross-machine production thresholds. Full before/after `EXPLAIN (ANALYZE, BUFFERS)` and index readback are committed in `ep-18-measurements.json`. Existing `idx_whatsapp_messages_cursor` already covers `(conversation_id, created_at DESC, id DESC)`; no migration or pool tuning is needed.

Red probes failed on raw message counts/tie ordering. Green `test:conversation-assist:db`: seven PASS, no skip, including zero/ten/1k/10k/100k, independent ordering readback, unchanged summary semantics and denied actor returning zero raw rows. Existing permission tests eight PASS; typecheck/lint and test-wiring checks pass. No provider or production write occurred.

Rollback only if ordering/ACL regression is demonstrated; retain a ten-row SQL boundary instead of restoring full-history payloads. EP-05 changes hint semantics separately after this verified query change.
