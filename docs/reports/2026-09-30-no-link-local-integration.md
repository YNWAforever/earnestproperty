# 2026-09-30 本機完整免連結 golden

結果：**LOCAL_INTEGRATION_VERIFIED / VERIFICATION_BLOCKED for release**。

Code commit：`26f47d56a76e3bb43f16c51e3f74f13e48abafa0`；沿用 PR #206 的隔離 worktree。根 checkout 及正式環境未改。

## 發現及修復

完整 77-file schema 的 signed inbound、parser 及 MLS 配對成功，但自動 follow-up 留在 review。早前精簡 PGlite fixture 把 scope 填成 `28hse`，沒有載入真正 scope constraint，漏掉了生產 schema 只容許 `28hse_agent_540` 的事實。SQL 同時拿 portal reference 的 `28hse` label 與 MLS namespace 比較，錯誤回傳 `publication_stale_or_owner_changed`。

`associatePortalEnquiry` 亦沒有把 resolver 的 mapping ID/version snapshot 寫入 reference resolution。只修 namespace 後，完整 golden 仍失敗為 `staff_mapping_stale`。兩者分別經同一測試重現，再恢復完整 scope/snapshot 邊界至 GREEN。

修復保留所有 capture／permissions／provider／existing owner guards。新增 `20260930090000_whatsapp_no_link_source_authority.sql` 只替換既有 function 的 namespace 比較；原八個 fix-pack SQL 及 69 個 audit-baseline SQL 不變。Reference 現保留完整 `MatchResult.snapshot`。原五個 audit probes 保留；PGlite preparation fixture 改用 schema 合法的 namespace。

## 環境及已執行鏈

`npm.cmd run test:no-link:local-postgres` 在 committed `26f47d5` exit 0，7/7，零 skip。Node 24.18.0、`pg@8.22.0`、Postgres 17；Docker image 固定為 `pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0`。每次只建立自己擁有、隨機名、綁定 127.0.0.1 的 disposable container，套用全部 78 migrations，最後移除。沒有接受 remote database URL。

真正執行 SQL 的 pool 有八條 connection；DB module boundary 用 Node module mock 接上此 pool，其他 server handler、signature、ingest、worker、parser、association、assignment、ack、outbound reservation／finish 及 delivery triggers 用實際程式。新 Node module-mocking API 有 experimental warning。Staff actor inputs 和 provider adapter／receipts 是合成資料；沒有 HTTP Auth session 或 browser。

最近 committed run 的可追溯 row chain：

| 階段                            | 合成 row ID／結果                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 有效 HMAC webhook／原文 receipt | `bbfb73c8-ea21-4023-a110-c0cb8329d64c`，原文完全相同，projected                                                              |
| Transcript／worker event        | `289ebadc-8361-4a0b-bf80-acddccd28f8b`，active/new activation/canary snapshot                                                |
| MLS、staff mapping／enquiry     | `bd7a1771-e7ee-4d6f-9014-086b77e22d97`，P1 UUID、外部字串 ID `4033349`；requested/publication S1                             |
| Provider request                | `e0292b24-eb05-4acb-b415-dbdcb658a208`；accepted 後 unknown，matching fake authoritative readback 才 confirmed               |
| S1 工作接手                     | `bcb66307-5eb2-4569-96d4-15d8a4c57190`；S2 denied／stale version denied，S1 acknowledged                                     |
| Customer reply intent           | `7e5ac0b9-e3fb-4f90-999a-9d4ccb6d7039`；八個 concurrent requests 只建一個 intent/message/job                                 |
| Delivered／read                 | signed synthetic `synthetic-reply-provider-id` receipt；one human-response row；late DELIVERED 不把 READ 降級；work resolved |

固定樣本提取 28Hse、`4033349`、`鄧錦雄 Terence Tang`、碧堤半島、sale、HKD 12,680,000。Canonical URL 只去 `t`；verified synthetic transport customer name 為 `Synthetic Customer`。S1 是 synthetic UUID，不是推測的 Terence production ID。Tracking links、opens 均為零；沒有 click／campaign／conversion 證據。External fetch port 呼叫數為零，沒有 portal／LLM／真 provider 請求。

## 七項 checks 及界線

1. 完整固定樣本鏈：有效 HMAC、耐久化、真正 worker／SQL、mapping、假分派 readback、接手、回覆及 delivered/read；accepted 不算 human reply，S2 直接操作 denied，duplicate dispatch 不再 send。
2. Shadow：照樣存 receipt/parser/enquiry；零 effect SQL、assignment/outbound/notification/link 增量；之後 active 設定不能升級舊 observe event。
3. 第二盤：distinct enquiry，缺 mapping 照樣 triage；原 conversation confirmed S1 不變，S2 不能讀全段 history，新 enquiry 不能直接 reply。
4. 缺 provider ID：同秒同文兩次各保留 receipt/event/message；有不同真 ID 的重複文字保留為第三個 event。
5. Workflow schema outage：原文已存而回 200/blocked_schema；恢復後 receipt repair 只以 observe 投影，不產生 effects。
6. Accepted assignment timeout：一個 irreversible fake call，unknown；重執行 blocked，再 authoritative reconcile confirmed，沒有第二次 call。
7. 撤回 reply consent：queued intent 在真正 dispatch SQL 重驗並 cancelled；fake send port 零呼叫。

另重跑 `test:no-link` 96 Node/PGlite + 9 Bun UI、`test:whatsapp-enquiries` 103、`test:control-plane` 104，全部 exit 0；lint/typecheck/build exit 0。Lint 留三個既有 React Refresh warnings；build 留既有 upstream Vite/annotation/chunk warnings。這些都是本地 code-tree 證據，CI 在 PR 上另記。

## Migration readback

`python scripts/neon/verify-no-link-migrations-local.py earnest-no-link-qa-upgrade-20260930`，commit `26f47d5`，exit 0。69 baseline + 9 additive = 78；clean `epclean_399ce73e`、baseline-upgrade `epupgrade_399ce73e` 各 78/78，rerun 全 skip。

Normalized clean/upgrade schema SHA-256 一致：`dbcacd1faca46b677b9cacabe882c0599173c49a2637e4e10ecb3b5c5ec7714d`。Verifier 同時核對 manifest、baseline diff，及已演練八個 fix-pack migration 不變。Container 已停止並移除；未套 Neon／production。已有 immutable review decisions／reference snapshots不批量改寫，不盲 replay。

## 仍未完成的 release evidence

18 UC／76 原 AC 的 full acceptance 仍為 BLOCKED；rendered action executions 仍是 0/1,290（811 BLOCKED_EXTERNAL，479 NOT_TESTED）。本次沒有把 SQL/server actor assertions 當 browser actions。

必需的 isolated Neon identity／multi-session latency／old-new readers、真 Auth／多角色 browser／手機版、current tenant MLS/provider Folder readback、consented real receiving topology／staff notification／customer delivered receipt，以及 PropertyHK approved URL sample仍是外部 gate。Formal-site release 與其他 critical journeys 維持 VERIFICATION_BLOCKED；PropertyHK automatic mapping 維持 NOT_READY。Shadow → canary → production 及 rollback 見既有 runbook。Production deploy／migration／config／真實訊息／merge 均未獲本次 continue 授權，未執行。
