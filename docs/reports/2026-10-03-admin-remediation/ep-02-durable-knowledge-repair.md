# EP-02 local verification and migration review

Baseline: `51cb0e9c08269ebabeb0b593d4dea611b9246c32`. EP-01 read gate remains enabled before repair. No production migration or rebuild was run.

Source mutations now invalidate only affected sources and enqueue `ai.knowledge.repair@1` in the same PostgreSQL transaction. Pending source revisions persist independently of worker leases. Repair acknowledges the captured request revision with CAS, and leaves newer work pending. Repairs use lexical chunks without embedding/model calls; explicit existing full rebuild keeps its original provider behavior.

The additive candidate migration `20261003010000_ai_knowledge_durable_repair.sql` follows the existing migration registry and adds one request table plus transaction-bound triggers. The owned loopback PostgreSQL 17 fixture applied all 82 registered migrations. No rows or historical receipts/intents are deleted by this migration. Targeted withdrawal retains historical chunks, marks them unavailable, and keeps unrelated active listings usable.

Red evidence reproduced missing canonical revisions and durable repair. A further positive test exposed a missing revision in the chunk DTO mapping; corrected here. Green `npm run test:ai-knowledge:db`: 19 pass, zero fail/skip. This runs the real normal/fallback SQL, valid cited answers, source changes during generation, committed versus rolled-back price changes, interruption/restart, replay, and withdrawal readback. Provider ports are synthetic; these results do not prove real provider acceptance.

Existing `test:control-plane`: 105 pass, zero skip. Existing content-copilot regression script passed. Typecheck and lint pass (three pre-existing React refresh warnings). Logs are in `.audit/remediation-20261003/ep02-*` on the isolated checkout; the committed database tests reproduce them without production credentials.

Deployment review must verify the new handler is available before enabling the migration's triggers, and verify the existing worker schedule/readback. Formal migration, runtime configuration and real model spend require separate authorization. There is no production target in this local test harness.

Rollback: stop new repair effects by disabling the eight `ep_knowledge_*` triggers after review; retain the repair request table, queued jobs, source history and EP-01 read gate. Do not restore an old database snapshot over subsequent CRM/receipt activity. Re-enable the handler/triggers and drain retained requests to recover.
