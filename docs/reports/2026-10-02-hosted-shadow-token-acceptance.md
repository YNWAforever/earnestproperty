# 2026-10-02 — Managed evidence token／hosted shadow 驗收

## 狀態

- **PROPERTY_SYNC_EVIDENCE_TOKEN：VERIFIED**。Secret metadata updated_at2026-10-02T05:18:20Z（香港13:18），沒有讀出或保存token值。Hosted job用該managed token完成private repository/read→upload→download exact bytes。
- **Hosted 28Hse shadow：PASS**。[36968501981](https://github.com/YNWAforever/earnestproperty/actions/runs/36968501981)，workflow_dispatch／attempt1／main96f2ba88e59152751d9e1c3a5b8da8ebffbc52de／scopeagent:540／bootstrapfalse。
- **Hosted canary／daily：VERIFICATION_BLOCKED**。新增安全修復[PR212](https://github.com/YNWAforever/earnestproperty/pull/212)已完成、CI成功；另行merge授權仍待使用者回答。Daily仍false，manualapply variable不存在（off）；本輪不計scheduled，MONITORING0/3。
- **Property.hk／後台dispatch**：原live detail403／workflowtoken與角色驗收仍獨立blocked。本輪没有其正式apply或來源policy變更。

## Gate及逐stage

Reviewed PR211已merge/main96f2ba8；mainCI36956576544 SUCCESS。Workflowblob b6424da641981879831a0535cd25357b1ef42d14與本機核對相同；沒有active同scope作業時只dispatch一輪shadow。

| Stage | GitHub結論 | 真實意思 |
|---|---|---|
| preflight | SUCCESS | managed token讀private release；恢復今早operator archive，核對正式current fullreceipt與policy/parser/host |
| collect | SUCCESS | Linux普通獲准HTTPS完成sale/rent全pagination及details；raw/request/frozenmanifest私有upload/download byte/hash PASS |
| ingest | SUCCESS | 僅Validate shadow request；privatecompact receipt dry_run/full_snapshottrue、281offers，實際寫入0 |
| publish | SKIPPED | shadow按mode不公開；不能算publication PASS |
| verify | SUCCESS | safe summary而沒有public_verifiedproof；不能算public驗收PASS |
| record | SKIPPED | OBSERVABILITY flag未配置；沒有假稱live後台run已記錄 |

正式canary仍須實際ingest receipt／publisher report／public checker；metadata／job總SUCCESS不能替代以上stageproof。

## 原時間／counts／hash

Collector UUID64944b51-f39d-4c0a-b813-cd543f555b8f。原scraped_at2026-10-02T05:34:07.123821Z（香港13:34），不換成replay或publish時間。

- 281advertisements／281offers／281unique source IDs；sale222：15listing頁＋terminal16，rent59：4listing頁＋terminal5。
- crawl_complete=true；pages_failed0、worker_rejected_count0；frozen gate allowed/fulltrue、reasons[]、valid_unique_count281。
- Bridge dry_run summary：advertisement281／offer281、duplicates0／rejected0、properties_created0／properties_changed0／fields_changed0；receipt_idnull；不能當正式accepted ingestion。

| Private asset | Bytes | SHA-256 | Check |
|---|---:|---|---|
| request-36968501981-1.json | 407708 | 768c6dfe2ee6c9873a659dbb5a05c127fcd16575136f83716ffc0a02378ea8f2 | hostedpin＋independentdownload/verify PASS |
| raw-36968501981-1.tar.gz | 44504833 | c73e5bfe22dbcccae0d129bd49598fdf5f30faa63f4ac3f24576f6d51690286b | hostedpin＋independentbyteshash PASS；paths無absolute/../symlink，未extract |
| handoff-36968501981-1.json | Manifest schema1 | 按上述request/raw binding | reviewedgitSha96f2ba8、scope/parser/policy、originalUUID/time、fullgate PASS |
| compact-36968501981-1.tar.gz | 44445 | 94ed55f986db7b409740e5bef36d5dbd771668508bf021d90cc0d8459be1cbb9 | private readback／safe archive inspection，dryrunreceipt PASS |

來源原件／盤源contact／raw只保留private YNWAforever/earnestproperty-sync-evidence、property-sync-evidence release及本機ignoredprivate路徑；未建立publicrawartifact。

## 正式DB唯讀對帳

Actualserver確認neondb／br-polished-sea-aom4i1ct／ep-divine-frost-aokzrg7f，manageddirecthost相符；app_migrations81，無新migration。

Before/after shadow fullreceipt同為7e1cb08f-5ac9-486a-9b27-0439bb44f4e6；full_count281；hash9592455f1be804631be0083d5fdfa71604081aedab1f9ad8b1c81f00304644c1；originalscraped_at2026-10-02T01:44:32.218276Z unchanged。Policy28hse_agent_540/agent:540/no-hermes-v2/python-v2.2，publish_enabledtrue、absence_enabledfalse。

本輪開始前總properties1207／publicgroups665／members1207；overrides0／withdrawal0／outboundintents1。WhatsAppmessages已由早上68變69，唯讀方向核對為1則正常inbound；本agent沒有發真實訊息，不能把正常新增來訊誤報成任務送訊息或假稱整日messagecount不變。

## 新發現及已完成修復

`replay_bridge`原本把apply TimeoutExpired轉OUTCOME_UNKNOWN/503後，仍直接重送最多3次；舊test甚至期待unknown後下一次success推進baseline。這與使用者明確「未知先reconcile，不盲重送」要求衝突。Production沒有注入timeout或實際使用此unsafeapply；hosted只跑shadow。

[PR212](https://github.com/YNWAforever/earnestproperty/pull/212)，commit7b4281703600716e2e9538f3afecd14c798294d7：保存原bytes/attempt/unknownreceipt後即停，不第二次apply或advancebaseline；既有read-onlyreceipt reconciliation／acceptedarchive恢復流程是下一步。Knownunavailable-before-spawn/429保留最多3次及Retry-After上限；無DBshadowtimeout用bridge_timeout保留boundedretry。沒有新框架/writer/schema/permissions。

| Verification | Command／environment | Result |
|---|---|---|
| RED | python -m unittest discover -s scripts/property-sync/tests -p test_worker.py -k UnknownApplyOutcomeTests；原版，合成fixtures | 3FAIL、exit1：unknown/timeout被第二次success遮蓋，read-onlytimeout錯誤分類 |
| GREEN full Python | npm run test:property-sync:python；Windows，7b42817，無DB/providerwrite | 122/122PASS，exit0，0skip |
| Daily/publication gates | npm run test:property-sync:daily；Windows actualBash gates，7b42817 | 38/38PASS，exit0，0skip |
| Exact PR CI | [36969007889](https://github.com/YNWAforever/earnestproperty/actions/runs/36969007889)／7b42817 | ci/localPostgreSQL/handoff/no-link browsers SUCCESS；staging SKIPPED，previewSUCCESS |
| Hosted shadow | run36968501981／Linux main96f2ba8 | realfull/privatepin/dryrun PASS；不是新fixapply驗收 |

原audit-reference probes沒有改動。兩個worker舊錯誤期待改測安全transient retry及singleapplytimeout，另加3正向regression；不是改測試令壞行為合理化。依singleagent要求由同agent再次逐diff檢查，没有聲稱fresh reviewer或真provider未知提交測試。

## 下一步及rollback

1. PR212 reviewed merge（已向使用者提出獨立精確授權；PR211授權不擴張）。
2. 保持dailyfalse，在approvedmain對此exactfreshfrozenasset作replay-shadow核對版本後，受控replay-apply canary；下游不重新爬取，不改scraped_at。Manualapply僅在其gate通過後暫時true；observability需受控配置及readback，不能把SKIPPED當記錄成功。
3. 核對receipt/hash/currentacceptedarchive、source/canonical/publication/held/unknown、真public頁及原IDs/overrides/messages/withdrawal；符合後才按既有授權dailytrue。
4. 只計其後3個實際native scheduled全鏈驗收；現0/3。正常cadence04:17香港時間，GitHub可能延遲；manual/replay/skipped不算scheduledPASS。

保持daily/manual/admin/withdrawal開關off即停止新dispatch/apply；正在跑的transaction先read-onlyreceipt對帳。保留privatebaseline、history、UUID/publicaliases、人工覆寫及ownedmedia；不reset、drop、啟舊writer或自動下架。Token若失效則failclosed，重新核對受管理權限，不把CLI廣權token抄入Actions。
