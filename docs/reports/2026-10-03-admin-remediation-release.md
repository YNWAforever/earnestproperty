# EarnestProperty — 分批 PR 與營運交接

本回合完成可獨立的安全修復及本地驗證，沒有 merge、正式部署、production migration、正式 scope/config mutation、真客戶發送或模型 spend。GitHub PR自動Preview已成功。正式 alias 唯讀仍是 baseline51cb0e9；修復版本尚未正式啟用。完整實作包的首回合目標已覆蓋，EP-06–21 的外部及完整產品驗收仍逐項列明，不能視為22任務全結案。

## Review 分批

1. EP-00：compiled fixture race、完整 secret scan及 owned full-schema harness。
2. EP-01/02：canonical/full revision read gate、回答輸出前重新驗證、transactional durable repair。
3. EP-03/04：嚴格 CRM eligibility/schema、actor/scope/source request/save/apply、run/provenance及未知結果。
4. EP-18/05及後續本地修復：SQL最近10則、方法/成本/分數/草稿如實呈現；canonical撤盤、scoped overview/card filters、44×44 close、owned setup/publication/maintenance、Golden/restore、50列batch failure CSV／subset counts、report unavailable status及後續 readiness 證據。各task保留聚焦commit。

Draft PR按base依序：[216 EP-00](https://github.com/YNWAforever/earnestproperty/pull/216) → [217 EP-01/02](https://github.com/YNWAforever/earnestproperty/pull/217) → [218 EP-03/04](https://github.com/YNWAforever/earnestproperty/pull/218) → [219 後續本地修復及owned驗收](https://github.com/YNWAforever/earnestproperty/pull/219)。初版四批CI及Preview均success；late EP-16/17附加至219後重新核CI，具體head/status讀回另記，沒有自動merge。

每批跟前一批 base，不平行套同檔的 admin-data/EP-05/18。各批只 review 該範圍；第4批中的 Property.hk 真存取未解除，不阻塞前3批。最後 code review 與 exact source test evidence 見本輪驗證報告及執行 CSV。

## Migration / config dry-run

從 registry取得新增4個版本：20261003010000_ai_knowledge_durable_repair.sql、20261003020000_crm_analysis_contract.sql、20261003030000_crm_analysis_runs.sql、20261003040000_content_proposal_source_guard.sql。schema 從原81至85，在多個新建 owned PostgreSQL17 真執行並做 rollback/replay/CAS/FK/readback；沒有 production apply。

10000：持久 dirty requests＋同交易 ops job enqueue，既有8類來源 mutation invalidate；不做 embeddings spend。20000：nullable result metadata，歷史結果不改稱新模型成功。30000：CRM runs、actor/source guards與 provenance，舊 profile 保留。40000：proposal captured source revision、authenticated account binding及全部internal evidence dependency snapshots，legacy unversioned proposal 只供 preview。都是 additive；正式 rollout 前由 DB owner核 production registry/checksum及 locks，先 owned/approved preview dry-run，再另行審批正式 apply。舊 worker未知新 job handler可能先保留/失敗；新 worker可用原 request恢復，不刪 dirty ledger。

預期 production configuration 差異本輪為**零**。28Hse daily=true、manual apply=false 保持；無新來源 scope/flag、phone endpoint 或model設定。WhatsApp每個已核實 account/branch/channel/folder/user 的新 review version才可成具體配置差異；Property.hk branch/dt manifest仍未核實。runtime/provider/model IDs未知就列UNKNOWN，不以fixture或預設值代替。

## Gates

| gate | 本地／唯讀證據 | 正式／完整能力 |
|---|---|---|
| G00 baseline | app alias/SHA已讀回；owned85 migrations | BLOCKED：worker/schema/flags/tenant readback未知 |
| G01 static/build | typecheck/lint/local build PASS；EP00 race修正 | local READY；正式deploy另驗 |
| G02 deterministic AI | strict/schema/eligibility/current revision/in-flight PASS | local READY；真模型品質另列 |
| G03 Golden A | same-schema owned链／zero EPWA PASS | local READY；真canary不替代 |
| G04 provider canary | mock ports契約、replay/unknown PASS | BLOCKED：指定真test目標與租戶能力 |
| G05 Golden B | authorised request→review/apply→DB/run讀回 PASS | local READY；真model品質/usage budget BLOCKED |
| G06 Golden C | save→canonical→public SQL→repair→fresh retrieval PASS | local READY；正式同盤/public browser待驗 |
| G07 Property.hk | owned full gate/positive publication/media/replay PASS | BLOCKED_EXTERNAL：branch/dt/detail/media approval |
| G08 28Hse schedule | config/private full receipt已核；既有main native1/3，修復分支正式0/3 | NOT_READY：餘下2次native及逐盤/public讀回；首次published0 |
| G09 roles/devices | 115 real-route＋14 wizard＋28 property＋20 Ops保留原SHA；EP-15 staff40／owned SQL2 source f596c9a；EP-14 mobile AI28／shared115 source a13e918；8 DB identities | NOT_READY：8真login sessions、native IME、完整route/actions；synthetic API不當真Auth |
| G10 concurrency/restore | owned CAS/unknown/restart／clone restore/readback PASS | local鏈READY；部署worker/正式恢復能力仍待驗 |
| G11 coverage | original60/68/1332 IDs及408 rendered observations保留；ACT-27新增local action PARTIAL，source Button候選對回同一操作，component occurrence不當button PASS | NOT_READY：逐動作/角色/flag/route reconciliation未完成 |

## 具體 canary preview（未執行）

WhatsApp：最多1個 test inbound event、1個 confirmed assignment、1個 internal acknowledgement、1個 designated staff phone test、1個 human test reply；零普通 portal EPWA。Customer/staff recipient 必須為整合 owner 指定的測試身份，目前**未提供**，公開網站公司 CTA 號碼不能當本次 test recipient。channel/account/branch/Folder/provider user均從tenant readback取得。先看consent/window/approved template；所有 outbound沿原 intents，unknown只 reconcile。不做 bulk/customer campaign。

AI：EV04/05/09/11/12 各3次，共最多15個 generation；每run最多1次，無自動retry，固定source revision與schema。actual provider/model從server runtime讀回，目前UNKNOWN；沒有現成usage/cost證據所以不填虛構單價或已核實budget。proposal的總spend上限為USD5，需實際provider計價/usage可量化及具體授權才可執行；未知成本即停、不以NULL當0。deterministic regression不需要此budget，已完成。

正式變更：僅在上述preview與code review完成、指定owned/staging target及DB owner確認後，提出4 additive migrations＋該批app/worker的確切SHA/checksum差異。本回合沒有這些目標身份/新正式權限，不作production mutation；發布後須重新登入真roles讀回，不由Vercel READY推論schema/capability。

## Owner 與安全恢復

| owner（角色；未捏造人名） | 下次讀回 | 安全行動 |
|---|---|---|
| 技術/release owner | PR base/order、app alias、worker revision、flags | 逐capability啟用；維持AI read gate |
| DB owner | 現有registry/checksums、preview drift及locks | additive migration；未知apply查receipt；不還原整個正式庫 |
| 盤源 owner | 28Hse full hash/stages/private scope及3次native schedule | frozen evidence/同run恢復；403/漏頁不撤盤 |
| Property.hk整合 owner | EPS/EPT/EPW所有approved dt、真detail/media | 完整證據後才enable；不绕過驗證 |
| WhatsApp整合 owner | 指定test recipients、directory/membership/consent/window/receipt | capture保留；unknown查原intent、不可換ID重送 |
| QA/主管 | 8 roles/sessions、全route/flag、剩餘ACT reconciliation | card/filter/export獨立读回；blocked不刪除 |

回退：停對應scope新effects、保留raw receipt/enquiries/profiles/human review/dirty jobs/outbound ledger；回上一兼容app/config，migration additions保留。canonical保護與stale read gate不撤回；合法資料修正按operation/revision逐筆確認，保留期間新查詢。owned restore是在新clone演練，不能套production。

Ruling：Windows下以.audit ledger＋tracked reports保存任務進度，因skill shell scripts不支援本包EP-00編號；風險是人工 bookkeeping，已以immutable CSV IDs、SHA及回歸核對減低。按計劃復用已修main的nav/parser/receipt/CAS/Inbox picker/bulk/segmented sync，避免另造身份/狀態機。部分指定新e2e入口改用既有受控real-route harness及owned test入口；50-row batch、property UI及分開owned SQL已補驗，完整同一browser/Auth/SQL/Blob integration仍待正確隔離目標；缺少的正式roles/全route驗收仍明示，未冒稱同等覆蓋。

本地可review修復READY；F01/F03/F04/F08的production啟用BLOCKED，F02/F07真接駁BLOCKED，F05整體UX驗收NOT_READY，F06按28Hse NOT_READY／Property.hk BLOCKED分開。本回合結束後沒有自動監看或三日驗收承諾。

後續EP-13／19來源 `a3f24df`：樓盤修改凍結preview、validation focus及Ops persistent error／unknown原job新讀回guard，48 browser＋7分開owned SQL PASS；affected modules與typecheck/lint/build分開通過。原audit CSV environment/blocker從原包恢復，新增execution欄保存新證據；29／9／22不變。配置／migration／provider差異零。詳見[兩項補驗](2026-10-03-admin-remediation/ep-13-19-local-readback.md)及[native1/3界限](2026-10-03-property-sync-readiness.md)。本批不冒稱舊independent review覆蓋新source。

後續EP-15來源 `f596c9a`：試送回應遺失／unknown後保留原request journal，只讀原結果；queued／dispatching／unknown禁止新preview，端點版本變更須明確重新預覽。四尺寸staff40、共享owned UI88、獨立full85 setup SQL2及通知Node21＋Bun14 PASS，typecheck／lint／build各exit0；歷史102／104保留原SHA。配置／migration／provider差異零；focused self review不當另一輪獨立review。真phone／provider／Auth仍BLOCKED，全產品NOT_READY。詳見[EP-15補驗及回退](2026-10-03-admin-remediation/ep-15-local-readback.md)。

後續EP-05／14來源 `a13e918`：AI read outage不再畫成正常空結果；安全錯誤與只讀重試，沿原request/conversation guard，保留manual draft及overwrite choice。四尺寸mobile28、shared115、no-link99＋Bun9、woztell159＋Bun9 PASS；typecheck／lint／build各exit0。新browser suite使用固定獨立編譯目錄。ACT-27只有synthetic agent-a的局部操作證據，原baseline／source候選／1400分母不改；native IME／true Auth及full coverage仍待驗。配置／migration／provider差異零，focused self review。詳見[EP-14補驗及回退](2026-10-03-admin-remediation/ep-14-ai-recovery-readback.md)。

後續EP-11／19程式 `bf585c0adec25ec3d82c4eafb26b39f748802d77`：兩個有效RED各1 FAIL→新來源讀取先清舊候選／選擇及來源切換清舊結果GREEN。四viewport actual source-sync route36及既有component UI46 PASS／0SKIP；full85 owned withdrawal2（132 NOT_APPROVED／零撤盤、active sibling阻止apply）、policy12／daily38及typecheck／lint／build各PASS／exit0，lint3 baseline warnings。unknown withdrawal／dispatch在reload後核原key，stage retry保留原runId；既有role recheck／actor boundary通過且未改。ACT-13／14／15及14個重疊source控制候選LOCAL_PARTIAL，不能重複計business actions；原29/9/22、planned22NEW、execution40/28/14、82cases／1400IDs／408歷史observations保持。formal Auth／source／provider仍BLOCKED，native schedule本批新增0、baseline1/3及修復正式0/3不變。詳見[來源恢復分層證據](2026-10-03-admin-remediation/ep-11-source-recovery-readback.md)。

後續EP-12程式 `266f8c75c2917a476436ffb54f32c0c91ce3a454`：same-user角色／staff binding與partial-source last-read時間三個有效RED各1 FAIL→32 actual overview/leads/shell/staff-store synthetic Auth/API browser PASS四尺寸。identity含user/binding/sorted roles；scope/revoked membership清舊值、晚到舊actor回應丟棄；失敗card顯示其自己的HK最後成功讀回時間，非provider freshness。independent full85 owned SQL4、shared115（已含原overview12）、command-center82+8/team95+31及typecheck／lint／build PASS，lint3 baseline warnings。ACT03及兩個重疊source controls LOCAL_PARTIAL，Link只驗open-leads。原29/9/22、22NEW、execution40/28/14、82cases／1400IDs／408歷史observations保持。正式Auth/deep-link/expiry/full roles/actions仍NOT_READY或BLOCKED；native新增0、baseline1/3／repair formal0/3不變。詳見[每日總覽分層證據](2026-10-03-admin-remediation/ep-12-daily-work-readback.md)。

後續EP-16程式 `d89b94d4fbfe3f6401f8e02e47c7e0ea15fcb07e`：unknown/inflight reload及actor dialog三個RED、late actor success／storage request／mobile overflow各1 RED→per-user原Campaign journal提交前保存、原結果read-only gate跨同tab reload、actor workspace／晚到queue response隔離、storage不可用零提交，default grid修390 pageWidth1396。32 actual campaign/shell/staff-store synthetic Auth/API browser四尺寸PASS；independent full85 SQL4確認既有CAS／consent／cancel history guard；shared115/woztell159+9/enquiries103及static/build PASS，lint3 baseline warnings。中途18/14 layout及test type error保留且修正。ACT46/48/49＋5重疊controls LOCAL_PARTIAL，cancel Button未稱已驗；原29/9/22、22NEW、execution40/28/14及82/1400/408歷史保持。runtime config/migration/provider差異0；native新增0，baseline1/3／repair formal0/3。詳見[推廣恢復補驗及rollback](2026-10-03-admin-remediation/ep-16-campaign-recovery-readback.md)。
