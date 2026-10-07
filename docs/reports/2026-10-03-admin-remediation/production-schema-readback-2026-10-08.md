# Approved seven-migration production readback — 2026-10-08 HKT

The human explicitly approved the exact seven migrations in packet SHA256 `17d80ab31486d487098f8d855d6d2243e9decdf801a5ffdb645b0f6f6b08238e` at main `a1fb816b6325bdc1a505c25f3569df9ee0629db6`. Applied only those seven to `dawn-meadow-79190048 / br-polished-sea-aom4i1ct / neondb`; PostgreSQL `18.6 (6569466)`. [Machine evidence](production-schema-readback-2026-10-08.json) retains the exact hashes, timestamps and private proof hashes. No Worker rollout, dispatch, manual schedule, recipient addition, true send or model/provider call.

Fresh no-compute backup `br-ancient-block-aox3y3w1`, parent LSN `0/2607A070`, was ready before apply and expires **2026-10-15 00:44:29 HKT**. The earlier `br-empty-heart-ao0l70q3` backup remains retained. Owned Neon18.6 rehearsal applied and reran all seven canonical files; 126-table fingerprints stayed identical. The actual locked execution wrapper was also rehearsed without real-row mutation.

| Exact migration | Independent readback UTC | Registry rows |
| --- | --- | --- |
| 20261006110000_duty_manager.sql | 2026-10-07T16:53:40.905893+00:00 | 86 |
| 20261007100000_wa_access_unassigned.sql | 2026-10-07T16:54:27.039542+00:00 | 87 |
| 20261008100000_whatsapp_opt_out_evidence.sql | 2026-10-07T16:55:28.067868+00:00 | 88 |
| 20261008110000_outbound_unknown_resolution.sql | 2026-10-07T16:56:30.071111+00:00 | 89 |
| 20261009100000_contact_profile_name.sql | 2026-10-07T16:57:27.273236+00:00 | 90 |
| 20261009110000_inbound_lead_reopen.sql | 2026-10-07T16:58:44.133365+00:00 | 91 |
| 20261010100000_campaign_attempted_identity.sql | 2026-10-07T16:59:52.114153+00:00 | 92 |

Red readback showed seven absent /85 registered. Each file was committed separately with its full filename in the same transaction and then independently read back. Final fresh SELECT and existing pure drift helpers agree: **92 source migrations /92 registered /0 pending**. The credential-based `npm run check:migration-drift` database command was not run; helper evaluation used the explicit-target MCP SELECT rows.

Catalog:126 tables unchanged; columns1425→1438, functions236→237, triggers63→64, indexes339→340, CHECK233→235.13 new columns, three nullable FKs, one partial index, one trigger/new function and three replaced functions were read back. All affected constraints are validated. Four function definition fingerprints match the owned canonical rehearsal.

All126 original-column table projections passed before/after count and digest guards **inside each repeatable-read migration transaction**, excluding only the seven new registry rows. Each transaction covered21,354 projected old rows. This proves migration preservation; it does not freeze concurrent production writes between transactions. Old85 register rows retain digest `ea275c9548a549c9e906313e92417009`.

Opt-out cap was checked after the transaction held `AccessExclusiveLock`, immediately before the canonical UPDATE. Exactly **one** legacy row received new evidence; no existing opt-out flag or old field changed. No unstamped opt-out remains. Staff notification subject violations0, campaign identity backfill0, duty-manager flags true0.

Approved behavior includes manager company-wide WhatsApp reads, including unassigned/cross-branch, while correct/reply functions are unchanged. A new delayed/gap-fill inbound INSERT may reopen after a later staff close when `msg_at >= last_inbound_at`; reopening may allow a new lead even if `msg_at <= latest closed-lead updated_at`. Existing history was not replayed or reconciled.

**READY:** this exact production schema layer. **NOT_READY:** separate Worker/config rollout, new-source three-native schedule acceptance, staff roles/viewports and complete Golden journeys. **BLOCKED:** real provider/model acceptance and Property.hk full detail/media/EPS/EPT/EPW/dt evidence. Index-only observations remain held; no canonical ingest/withdrawal. Skip remains blocked.

Both CSVs append five execution columns: traceability84→89, UAT75→80. All previous cells and46 execution-evidence roots remain unchanged;29 PASS/9 FAIL/22 BLOCKED and22 planned NEW statuses are preserved. New schema-only annotations do not pass an entire case.

Rollback: preserve new evidence/columns and accepted receipts, outbound intents, campaign/lead/source identities and protected edits. Disable the affected feature, then separately review the scoped reverts or captured old definitions. Fresh backup is available; a restore needs separate approval and an owned drill. Do not overwrite intervening production data or clear opt-out flags/history.
