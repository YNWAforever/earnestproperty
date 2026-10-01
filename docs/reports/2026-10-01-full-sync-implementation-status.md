# 每日盤源同步實作紀錄

## 起點 / T0

- Checked 2026-10-01 04:03 UTC. origin matches YNWAforever/earnestproperty.
- main e8997f290045fde37625be99863d803f4f72c7b5; PR207 OPEN / DRAFT, head 1e2a3459691fc06ba0deb8b09cf8dd5f57a2fcd0, unmerged.
- Isolated native worktree / codex/full-property-sync-20261001 starts at PR207 head. Root modifications preserved; native checkout has a pre-existing bun.lockb mode change, left unstaged.
- ZIP SHA256 5f05410bb34fd9d0d44877b31ea25eb8aea379c0f816dbb2308e3bf2787b8745 verified. Safe extraction preflights all names, links, counts, total bytes and per-file limits before extraction. 12 files / 141230566 expanded bytes, ignored private directory.
- Ruling: raw-evidence.json is 139837939 bytes, larger than initial 128 MiB ceiling; raised extraction per-file ceiling to 256 MiB, retaining 1 GiB total and ratio 1000 limits. Cost if wrong: bounded additional local disk use; no publishing.
- Exact request SHA256 b458d085b60aeb241006daf0f11919a54a5e9ef490528854b594d522cac3bd55, 414631 bytes. 286 adverts (226 sale,60 rent), 22 pages, no rejects/failures. 46 new source IDs are not new properties; 132 historical absence candidates remain NOT_APPROVED. No withdrawals applied.
- Offline sample mappings PASS: 4033913/A072390,4034357/B059410,4034591/A057717. Current live qualifications remain unverified.
- Read-only production host verified against managed Actions variable and local managed connection: ep-divine-frost-aokzrg7f.c-2.ap-southeast-1.aws.neon.tech / neondb.
- Accepted receipt 60895ce3-6a1d-4225-84f1-455d6e47f181: 2026-09-24T21:45:54.421920Z /279 ads; canonical payload hash 6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e. Parser python-v2.2/policy no-hermes-v2, absence=false.
- Source links356 approved28hse; Property.hk0/no policy. Inventory532 active/16 draft/637 inactive; admin override rows0 (other existing ownership guards remain required).
- main schedule absent; PR207 restores04:17HK. Four most recent scheduled runs failed. DailyEnabled=true exists; private evidence repo/token missing.
- Baseline Node command: node --test src/lib/mls/ingestion-contract.test.mjs src/lib/mls/source-selection.test.mjs src/lib/mls/source-snapshot-gates.test.mjs src/lib/mls/daily-publication.test.mjs scripts/property-sync-daily.test.mjs src/lib/neon/featured-promotion.contract.test.mjs: exit0,58/58 PASS at base1e2a345.
- Baseline Python: .venv-sync/Scripts/python -m pytest scripts/property-sync/tests -q: exit0,68/68 PASS at base1e2a345. Isolated dependencies installed using existing locks/pinned requirements; no lock contents changed.

## Status

| Task | Code / offline | Live / production |
|---|---|---|
| T0 | PASS | read-only checks PASS; no mutation |
| T1-T5 | PENDING | evidence destination/baseline recovery gate |
| T6-T8 | PENDING | Property.hk access/identity/fixtures BLOCKED_EXTERNAL |
| T9-T10 | PENDING | authenticated UI + disposable integration pending |
| T11 | PENDING | 0/3 new scheduled cycles; MONITORING not stable |

## Shared interfaces / rulings

- T1→T2→T3: immutable manifest byte SHA differs from the ingestion canonical payload hash. Both must be recorded and checked; never compare raw SHA to a canonical hash.
- T3→T4: only the current accepted full receipt authorizes publication, retaining36h freshness and20 attempt cap.
- T7→T8: unverified Property.hk URL/ID/media contracts stay disabled; no synthetic selector promoted to live config.
- T2→T9: missing callbacks/never-started schedules need read-only health checks independently of stage success events.
- T9→T10: use existing server authorization/property mutation service; no client actor/UUID/version authority.
- Execution remains single agent as requested; local author review will be identified explicitly. Windows task evidence/checkboxes stored in these tracked reports; shell-specific skill bookkeeping replaced with equivalent entries.

## External gates

Private evidence repository/release + least-privilege credential and authoritative baseline recovery; reviewed merge/deploy/activation authority; verified disposable DB; Property.hk supported exact URLs/real fixtures/ID/media policy; production UI login; manual end-to-end and3 actual daily cycles.

## T1 implementation evidence

- RED: 5 missing manifest/privacy/authority/retention behaviors failed; existing11 passed. Additional interrupted archive/readback tests2 failed,16 passed.
- GREEN: `.venv-sync/Scripts/python -m pytest scripts/property-sync/tests/test_daily_artifacts.py -q` exit0,18/18 PASS at T1 working tree (base9775d8b); no source/network/DB writes.
- Implemented bounded hashes, atomic archive/final manifest, privacy+permissions, exact upload/download readback, canonical receipt authority checks and pinned release retention selection. Windows fsync requires a writable descriptor; verified fix with archive tests.
- T1 helpers READY; workflow wiring T2, read-only authority retrieval T3 pending. Private live permission/baseline migration BLOCKED_EXTERNAL. Retention deletion intentionally requires reviewed exact assets; no remote cleanup performed.
