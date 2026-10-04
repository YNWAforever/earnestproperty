# Production schema repair — 2026-10-05

4 份已存在 main `29e839e50e0fa7af627fed6a24be67d62fef0377` 的 additive migrations 已在明確人類批准後套用至 Neon production `dawn-meadow-79190048 / br-polished-sea-aom4i1ct`。原 GitHub drift failure 的原因是 registry81、對應新 objects 全部缺少；現在 registry85、pending0，獨立 catalog 與 owned clone 一致，exact-main [GitHub drift37232450305](https://github.com/YNWAforever/earnestproperty/actions/runs/37232450305) completed success。此份是實際執行讀回；完整 capability 驗收仍按下表分層。

| 驗證層                               | 實際結果                                                                                                                 | 界限                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Immutable preview/config             | 4檔 SHA256/Git blob 與 approved target相同；schema diff31214bytes；app/worker/flags/provider配置差異0                    | runner沒有dry-run flag，沒有捏造dry-run成功                                     |
| Owned Neon production-derived branch | PostgreSQL18.6(4e955f5)，RED drift1 → apply0 → GREEN drift0；2tables/8columns/11functions/8triggers/1index               | clone為production sibling，backup TTL不能有child；不是production restore        |
| 正式授權及身份                       | 直接回答「批准這 4 份 production migrations，按上述目標與限制執行」；fresh authenticated API及SQL project/branch IDs吻合 | 初次automatic approval review拒絕且未啟動；明確批准後執行，舊拒絕紀錄保留       |
| Production執行                       | PostgreSQL18.6(6569466)，RED1 → existing `npm run neon:migrate`0 → GREEN0；81 skipped、exact4 applied                    | 每檔DDL＋registry同交易；4檔並非整批atomic，未知結果不可盲重跑                  |
| 正式獨立讀回                         | registry85/pending0、exact catalog與owned clone相同；84既有public表/9628rows before/after SHA256相同                     | 只排除8個新增nullable metadata欄；不含managed Auth schema，無客戶row values保存 |
| GitHub獨立唯讀驗證                   | workflow_dispatch37232450305，head29e839e，migration-version test及drift成功                                             | 這是read-only drift驗證，不是28Hse native schedule／worker dispatch             |
| 既有執行歷史                         | 399個凍結raw hash observations在publisher/implementation皆一致；CSV22tasks/82cases原cell及40evidence roots保留           | 27歷史PNG＋1summary原bytes不可用的限制保持                                      |

套用檔案：

| Migration                                          | Git blob                                   | SHA256                                                             |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `20261003010000_ai_knowledge_durable_repair.sql`   | `2932b0fc37313ef93781046195845a6bd087fdfb` | `25c487da84f92fa72f38cf505c29bb3e236df9ce51776ab91746917cd6a2d80b` |
| `20261003020000_crm_analysis_contract.sql`         | `80964eae5d72cd16b6769abadce5437d4d423bdd` | `488d549d1e7c0e2a25583dd9f4659478aa861e7ee0bde6e22315f85a21a40259` |
| `20261003030000_crm_analysis_runs.sql`             | `66ca9b08df47e821d5400652cb7f9353b57641fd` | `d0697440b8402e5d83445f7654ab0578ee352489133ad65d20104a8d4ec71873` |
| `20261003040000_content_proposal_source_guard.sql` | `26d8d23f1b525a6fa0634fceb77426c90af1c979` | `6e0a4720837afb6f07928874312dc3136351c2cadfa093c25d5eeed3a799d774` |

新增的source triggers日後可enqueue `ai.knowledge.repair@1`；既有targeted automatic repair使用 `allowEmbeddings:false`。本步agent發起 recipients0、sends0、application-model calls0、budget0、worker dispatch0、native schedule triggers0、manual deployments0；沒有批量覆寫profiles、修復production知識資料或重放outbound intents。來源/canonical/account/branch/ad/offer、protected人工修改、receipts及outbound history保留。

兩份CSV各追加5個 `execution_2026_10_05_production_schema_*` 欄：Traceability54→59欄，UAT45→50欄；相關7tasks/22cases記 `PRODUCTION_SCHEMA_VERIFIED_ONLY`。既有execution_status及原29PASS/9FAIL/22BLOCKED、22planned NEW保持，沒有把schema套用當作model/provider/UI case整體PASS。execution-evidence40→41roots，舊40roots逐個相等。完整JSON、raw path/bytes/SHA256及append-only proof見 [production-schema-readback-2026-10-05.json](production-schema-readback-2026-10-05.json)；raw保存在 `.audit/remediation-20261003/migration-drift-production-approved-20261005/`。主mainCI37226459698的796owned UI/232owned SQL、separate lint/typecheck/build是既有證據，這步沒有重命名為production同旅程驗收。

| Capability                                               | 結論      | Open gate／負責角色                                                                              |
| -------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| 本次approved production schema／migration parity         | READY     | DB owner按85registry及immutable checksums維護；原drift failure已解                               |
| 已有bounded deterministic／owned regression契約          | READY     | 依原各SHA及環境證據；不提升至正式Auth/provider                                                   |
| 真Auth、全roles/crossscope、四viewport完整Golden共同旅程 | NOT_READY | QA／技術owner補正式sessions與同journey讀回                                                       |
| 28Hse三次修復後native daily schedule                     | NOT_READY | 盤源owner補private receipts及3次；最後已驗repaired0/3，本步沒有新native acceptance               |
| Property.hk EPS/EPT/EPW及逐dt full採集                   | BLOCKED   | 整合owner取得合法存取、page1→terminal＋真detail/media；403/漏頁/index-only不作撤盤，132候選held  |
| 真provider/model canaries                                | BLOCKED   | 整合owner指定recipient/channel/window；AI owner讀回actual provider/model、可審閱budget與具體授權 |
| 完整formal release                                       | BLOCKED   | Release owner完成其餘app/worker/flags／canary／營運gate；這4份schema批准不是其餘正式effects授權  |

Backup `br-empty-heart-ao0l70q3`（parent production、LSN `0/25005728`、無compute）保留至 **2026-10-11T20:07:40Z／2026-10-12 04:07:40 HKT**。Owned test `br-mute-heart-aobbtsju` 至2026-10-05T20:11:40Z。需要backup延長或restore時另提具體差異，不移除expiry或套整庫restore。回退先停相應新effects、保留additive schema及dirty/outbox/read gate、保留期間accepted writes和receipt/outbound intent；兼容app/config回退不恢復stale公開AI路徑。查registry／原operation結果後才處理unknown outcome，不重跑已套DDL、不drop新表。

Raw catalog helper仍有舊underclaim欄 `projectContextVerifiedByApi:false/branchIdVerifiedByApi:false` 及generic「objects present，不盲replay」文字；其原bytes不改。新execution wrapper已核fresh API＋actual SQL IDs，final85/pending0及exact catalog assertions通過。Vercel production sensitive URL不能literal比較的限制保持，沒有據此捏造完整app/worker配置等價。
