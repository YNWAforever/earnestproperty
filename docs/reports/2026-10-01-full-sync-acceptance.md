# 每日盤源同步驗收 — 2026-10-01

## 狀態與範圍

單agent順序實作T0–T11，沿PR207 head1e2a345，保留既有homepage newest/private evidence/daily schedule修正。最後fresh fetch：main=e8997f290045fde37625be99863d803f4f72c7b5；PR207仍OPEN／DRAFT／unmerged，CI4項SUCCESS、stagingSKIPPED、VercelSUCCESS。這些是PR207結果，不能套用到新PR。

本次交付是可審閱code/tests/UI/runbook。**未完成正式A/B/C live acceptance；不是COMPLETE或穩定上線。0/3scheduled cycles，MONITORING。** 無production mutation、migration、dispatch、deploy、merge、true WhatsApp/email或bulk withdrawal。

| Journey | Local implementation／rehearsal | Live status |
|---|---|---|
| A28Hse collect→private freeze→ingest→publish→homepage | READY；隔離SQL、exact ZIP regression、process failure、owned-media fake ports、public query fixtures | VERIFICATION_BLOCKED：private evidence/token/current baseline recovery＋reviewedrelease/manualfresh E2E未完成 |
| BProperty.hk EPS/EPT/EPW | READY gated code；三分行synthetic parser、3/3gate、source-aware SQL publication與canonical復用 | BLOCKED_EXTERNAL：正常detail403、三原入口/SID/realfixtures/ID/media未核實；policy及schedule維持off |
| C盤源同步／受控重試／撤盤review | READY：actual DB RBAC/concurrency、realReact/CSS mobile/desktop synthetic browser、off flags | VERIFICATION_BLOCKED：兩個migration/release/token/live login未完成；沒有正式下架 |
| 3daily cycles | 0/3 | MONITORING；未開始新正式scheduled cycles |

## Task／finding／focused commits

| Task | Finding／結果 | Commit | 外部狀態 |
|---|---|---|---|
| T0 | ZIP/hash/ancestry/working tree/production authority只讀核對；隔離worktree | 9775d8b | PASS read-only |
| T1 | 私有hash/readback/authority／不可變handoff；reviewedretention/unknown DELETE核對 | 94c25bd、015ee45 | destination/token/accepted archive recovery BLOCKED |
| T2 | collect120／ingest20／publish45／verify10，durablecheckpoints；downstream不再爬；08:15HK只讀watchdog | b420876 | hosted stagedmanualrun/cost/cancelarchive未驗 |
| T3 | direct host/neondb預寫入guard；currentreceiptreconcile；replay idempotency | 515aa23 | production baseline保持，只讀 |
| T4 | backlog穩定輪轉、actualheld、unknownCOMMIT、20 attempts及36h保留 | f095848 | 正式媒體/publication未执行 |
| T5 | 沿PR207 newest query；canonicalwww verifier；last_seen不洗排序 | 98f843c | homepage HTTP200只有read-onlybrand；3currentdetails／livebrowser未驗 |
| T6 | 明確未接通；403停止、不去SID猜入口 | 7f7189b | 全3分行BLOCKED_EXTERNAL |
| T7 | p1→terminal/pageproof，3/3full才apply、sourceisolated accepted archives、dual offers | 6b3b58a | real parser/selectors/IDscope待provider |
| T8 | 相容HK-onlysecondary一致性、actualrawSQL sourcepublication／ownedmediacodec；原priority/override保留 | a77d847 | 正式serverpolicy／firstapply／HKschedule未啟用 |
| T9 | 4cards/stages/30hstale/metadata、freshRBAC、allowlistedworkflowonlydispatch／dedupe | 543881b | 新migration/login/managedworkflowtoken/release待驗 |
| T10 | absence review version、15minpreview、partial/idempotentapply、actualDBrole/clock/version重查、manualinactiveoverride | cd320a0 | withdrawalflagoff；132historicalNOT_APPROVED |
| T11 | exactprivateZIP regression、132syntheticDB review、新migrationtool、CIwiring／sourcegate/rollback/manual | 本報告所在commit（git log -- docs/reports/2026-10-01-full-sync-acceptance.md） | live gates保留；3cycles0/3 |

逐taskred/green/command/exit/environment見full-sync-implementation-status.md。Code author自審，未使用subagents或聲稱independent external code review。原audit reference及缺陷probes沒有修改。

## 最低矩陣：19case，未測live保留分母

PASS只指右列明示的isolated層級；含必需live片段的case整列BLOCKED_EXTERNAL。矩陣13/19在所指定isolated層級PASS、6/19含必需live片段BLOCKED_EXTERNAL；沒有19/19正式PASS之主張。

| Case | 狀態 | 已執行證據 | 未測／剩餘 |
|---|---|---|---|
| A01 | PASS disposable Neon | 原private request hash／timestamp不變、disposable schema；最終1/1PASS、0skip、611.8s：286ads→197canonical、286observations、284links、1receipt、inactive0；replay identical、3aliases正確 | 原10m runner timeout如實保留；20m runner通過，197屬synthetic mapping fixture，不推production新增數 |
| A02 | BLOCKED_EXTERNAL | stagedworkflowcontract、UIseparatefailedpublication、publication-only不collector；localsynthetic26journeys | 真hostedpublication失敗/retry以及privateassetreadback |
| A03 | PASS isolated process | 真subprocessexit17後rawcheckpoint可讀；incomplete非full、不apply | hostedhardcancel未上傳部分只能missing evidence |
| A04 | PASS unit＋Neon | wronghost/scope/hash/sourcepolicy prewrite拒絕；receiptimmutableidentity | production不做故意wrongtargetwrite |
| A05 | PASS readonly＋fixtures | freshmain無schedule／Sep24baseline；30hstale/neverconnected/failure不顯示0成功；watchdog獨立 | 正式新watchdog/UI未部署 |
| A06 | BLOCKED_EXTERNAL | exactZIP三樣本4033913/A072390、4034357/B059410、4034591/A057717兩層mapping | 當前fresh來源/livedetail/photo資格；不强上已撤盤 |
| A07 | PASS PGlite queries | 實際SQL資料fixture：activeacceptedlinks/newest/canonical去重/last_seen不bump／inactive不見 | productionhomepage新版排序未部署 |
| B01 | BLOCKED_EXTERNAL | 3branchsyntheticp1→terminal＋Neonfullgate1/1 | 正式三原SID/dt頁／realparse／fullcount |
| B02 | PASS gates＋Neon | EPS9page／missingbranch／403／fakeempty／dropcollapse／invalid URL拒絕整輪；no baseline advance | provider403只讀現場證據，不繞過 |
| B03 | BLOCKED_EXTERNAL | global/branchscopecollision、sameIDsale/rent parserfixtures及SQLoffer隔離 | suppliercontract／跨branch真實ID證據 |
| B04 | PASS reconciliation＋Neon | consistentHK-onlysecondary有限合併；price/identity/lifecycle矛盾仍review；原atomic26/26 | 不把synthetic規則當已核實livepolicy |
| B05 | PASS Neon | exactcanonical跨source、sale/rentpublicgroup、override/UUID/alias/provenance保持 | productioncrosssource未apply |
| B06 | BLOCKED_EXTERNAL | HK synthetic3/3→SQLimport/replay→ownedphoto1fakeports→public1→nextingestion1canonical；1/1 | 真mediahost/rights/sourceURL/config/firstbaseline与freshlivepublic |
| C01 | PASS Neon＋unit | 真SQL132synthetichistoricalcandidates，100+32boundedpagination，全部NOT_APPROVED；强行review applyblocked、inactive0、IDs/132links保持 | 原ZIP132實際production候選未套用；禁止直接下架 |
| C02 | PASS gate＋syntheticUI | 403/fakeempty/drop>30%failclosed、失敗保留資料；live403另記 | 無production盲爬／fault injection |
| C03 | PASS multisessionNeon | 15minDBclockexpiry、source更新／staffversion競爭拒絕、2clients only1winner | 正式不故意做race |
| C04 | PASS Neon＋UI | duplicate/idempotent、peritempartial、realCOMMITacklost→readback、readonlyUIreconcile；nextactor/publicqueryreadback | realprovider/productiontimeout未注入 |
| C05 | PASS service＋DB | clientroleforgeryagent actualDBdeny、manager dispatchdeny、invalidURL/ref/source/host/id/subset；redirect/timeoutfailclosed | liveauthenticatedserverFn/browser token尚未接通 |
| C06 | BLOCKED_EXTERNAL | actualReact/CSSChromium1440/390、26journeys、nohorizontaloverflow；names/nextstep/denied/failed/retry | 真新員工liveauth/mobile，未拿synthetic當prodpass |

## 動作coverage及層級

- Portablecode：ingestion75、daily37（包括新manualdisposableworkflowguard及實際verification shell）、admin12、withdrawal5、release migration3、listingpriority36、listingsearch91Node＋12Bun、media5。每套exit0/0skip；不合計重跑的重疊case。
- Python：97/97exit0，包括realprocesscheckpoint、propertyhk syntheticselectors/fullgate、privatehash/retention ports。
- PGlite：public newest/search實際SQLfixture；不是Neon或production。
- RealNeon：核對project dawn-meadow-79190048／disposable br-young-breeze-ao85rtx1／endpoint ep-square-leaf-aobruyvf／dedicated earnest_audit_acceptance_20260927後才fixtureDDL。原六套serial41/41baselinePASS；原atomicrepository26/26最後T8重驗；HKfullgate1/1、HKpublication1/1、28publication與nextingestion各1/1、T9metadata1/1、T10withdraw1/1、132historical1/1。ExactZIP1/1PASS/0skip、611.8s，另記A01。隨機schema清理；沒有fixture指向inheritedneondb或production。
- Syntheticbrowser：actualReact/CSSChromium，desktop1440/mobile390，26/26；providerrequests0／DBwrites0。包括loading/empty/failure/denied、history75rows、pagination、retrydoubleclick、invalidreason/cancel、expiry、partial、unknownreconcile。Liveauth及公開照片未測保留分母。Finalrerunfirstlocalhost navigation30s曾timeout；boundeddiagnostics加入後warm及forcedcold各26/26PASS，未重現；保留該失敗、不冒稱根因已修。
- FullTypeScript：tsc --noEmit exit0；localproduction buildexit0。NewUIhookchanges再驗tsc/UI26PASS。YAML35/phasebudgets/permissions與bash語法有效。舊lockbytes不變；nativeworktreebun.lockb mode差異未stage。
- ActionsCI新增admin/withdrawal/release/Pythonretention/syntheticUIchecks；另manual disposable workflow先guard，四組DBtest逐組serial，不注入production/Blob/workflow/evidencecredentials。新PRremoteCI狀態另在交付補記。
- Highrisk：成功、直接越權、invalid、cancel、duplicate、stale、timeoutunknown、refresh/nextactor/publicreadback都有對應上述測試；正式故障注入未做。權限/consent/providerlive層不混算。

## Live逐來源與實際正式操作

| Source | 最新已核實情況 | 本session正式write |
|---|---|---|
| 28Hse agent540 | productioncurrent fullreceipt60895ce3-6a1d-4225-84f1-455d6e47f181；Sep24T21:45:54.421920Z／279ads；sourceapprovedlinks356；stale；privatebaseline recovery未通過 | 0 |
| Property.hk EPS | 原p9／SID/dt/approvedp1未實測，無serverpolicy | 0 |
| Property.hk EPT | 原SID/dt/pagination/IDscope未核實 | 0 |
| Property.hk EPW | 同上；三branch共用scope3/3gate | 0 |
| Public homepage | 308到exactcanonicalwww後HTTP200，brandPASS，detailsVerified0 | 0 |

單次正常Property.hk detail請求2026-10-01T05:04:36.912Z403/challenge，沒有代理／challengecookie／繞過；不推論獲准feed或部署環境永遠不可用。Currentproductionhostname已managedvar/localread-only匹配；URL與secret沒有印出。

## Migration／config／回退

只新增20261001120000_property_sync_operations.sql及20261001130000_property_withdrawal_review.sql，manifestregistered、isolatedDDL驗證，正式read-only --check已驗directhost/neondb/serverbranch及五個coreprerequisites，兩檔pending/applied[]；freshauthority仍60895ce3/279ads。Disposablefinalreadback properties0/customschemas[]。正式未套用。Migration helper預設noDBdryrun；operator --check read-only，--apply須host/serverbranch/prerequisite/hash與explicitapproval。沒有自動跑全repo pendingmigrations。

新增flags均off；詳細confignames、shadow→canary→production、最小external需求、20/36limits、phasebudgets、unknownrecovery、privatecleanup及SME五步手冊在[恢復與回退runbook](../runbooks/property-source-daily-recovery.md)。Rollback停止此source新daily/apply/dispatch/review、等transaction並對帳、留history/media/IDs/currentbaseline；錯data用新reviewedcompensatingoperation。沒有直接重啟舊writer或無條件restore。

## Scheduled監測

Manualfreshproduction E2E尚未執行。Cycle1/2/3皆未執行：**0/3MONITORING**。未建立提醒／heartbeatautomation或真實外部訊息。正式release需上述owner完成gate後各記錄scheduled runURL/commit/hashes/receipt/source/canonical/publiccounts/elapsed及recovery，三次才可聲稱穩定每日同步。


### PR208 CI follow-up

PR208 firstLinuxCI failed at exactmigrationchecksum guard: WindowsnewSQLfileshadCRLF whileGitblob/LinuxhadLF. ProductionSQLwasnotapplied. PositiveGitblobregressionreproducedfailure locally; onlytwoNEWmigrationpaths nowhave eol=lf attributes andLFchecksum pins. OldappliedSQLandprivateZIP/request/rawbytesunchanged. Updatedhashes areinrunbook. Authorwillrecord finalremotecheck resultinPRhandoff; firstfailure remainsvisible.

SecondLinuxCIpassedallnewgates(including26syntheticUI/Python97),thenexistingCommandCenterhard-coded16-entryexpectationfailedafterapproved17thsource-syncentry. Positive17-entry/label/EDITORSregressionupdated; duplicate/groupassertionspreserved. Localcommand-center82Node+8BunPASS. NounrelatedCRM/WhatsAppfeaturelogicmodified;finalrequiredCIreruntrackedinPR.

ThirdCIlaterfailedattest-wiringclassifyingnew3DBsuitesasportable. ExplicitDB/private-fixtureregistrationandguardedprivate-regressionmanualjobadded; ordinaryCIcoveragecheckretained. Control-plane105/105PASS, daily+wiring16/16PASSlocally. Privatejobreadsprivateassetwithdedicatedread-onlytoken,checks414631bytes/exactSHA/verifieddisposabletarget,nopublicartifact; nojob/token/assetconfiguredordispatchedthissession. ThisoptionalhostedprivateCIgate remainsUNRUN/BLOCKED_EXTERNAL, notlocalZIPPASSorproductioncycleevidence.


### 續作：公開驗證 proof 修復

發現 summary-only verify job success 曾被記成公開驗證成功；四個正向回歸先失敗，現改為只有實際HTTP checker通過後的 native public_verified=true 才可成功。Shadow／發佈失敗未執行檢查維持 pending；成功發佈缺 proof 顯示 unknown；HTTP檢查失敗不升級。實際Git Bash執行四種合成分支驗證輸出順序；daily37/37、admin12/12、job-wake17/17 PASS／0skip。此 HTTP proof不代表live browser驗收；13/19 isolated PASS、6/19 live BLOCKED_EXTERNAL、0/3 MONITORING不變。更新的hostedCI結果在PR記錄。
