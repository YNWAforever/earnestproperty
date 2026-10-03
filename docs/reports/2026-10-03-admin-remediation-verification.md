# EarnestProperty — 本輪修復及分層驗證

原基準 main/audit SHA `51cb0e9c08269ebabeb0b593d4dea611b9246c32`。outer ZIP 的實際 SHA256 是 592ccad5466966abbd153163395d0e346c3e7f41306c16d57eb1aeff0d78167a；用戶所列 ffcfe416… 是內含原 audit ZIP。84/84＋74/74 manifests 已核對。原工作目錄 dirty，採用獨立 attached worktree，既有 bun.lockb 修改沒有 stage。

## 隔離鏈及測試層次

| 驗證 | actual 結果 | 可證明／不能替代 |
|---|---|---|
| EP-00 paired compiler＋secret sentinels | RED 29/30 → GREEN31/31；9 秘密名稱仍拒絕 | race 消除；没有 source scan 豁免 |
| public knowledge owned SQL | 21 PASS、0 SKIP | normal/fallback canonical/full revision、in-flight、commit repair/restart、overlapping publication/reactivation；非真模型品質 |
| CRM/content persistence owned SQL | 34 PASS、0 SKIP | request/save/apply actor/auth/source及全部引用版本、run identity、cancel/replay/unknown outcome、protected human review |
| inverted CRM probes | 6 PASS | 真函式＋synthetic transport；原 probe PASS 仍代表舊缺陷，原證據保留 |
| conversation assist | 8 PASS、0 SKIP | 最近10則／100k資料、SQL bytes/plan、ACL、明確deadline；非生产 latency |
| provider setup owned SQL | 1 PASS、0 SKIP | paginated identity/evidence/version/audit、獨立 capability；非正式 directory/phone |
| Property.hk owned SQL/media | 4 PASS、0 SKIP | dual offers、aliases/full gate、real decoded bytes through fake owned blob、replay；非真 detail |
| withdrawal owned SQL | 2 PASS、0 SKIP | active canonical sale sibling、合法 sale-only 保留 rent、stale/replay、132 historical 全不下架 |
| property maintenance owned SQL | 5 PASS、0 SKIP | actual server save＋另一 reader、photo metadata order、sale/rent CAS、revoked writer；非真 upload |
| Golden A/B/C，同一 full schema | 23 PASS、0 SKIP | signed receipt→enquiry→resolution→confirmed assignment→ack→human reply；CRM review/tag→SQL；price→canonical→repair→fresh AI |
| owned restore | Golden 其中1项；最終683674-byte dump | 新 clone record counts/FK／receipt replay无重複；原 DB 還原後新寫入保留；非正式 restore |
| real-route synthetic browser | 115 PASS、0 SKIP | 390/768/1280/1440＋360、草稿/focus/keyboard/unknown/reload/跨actor、報表flag／drilldown／CSV；非真 auth/provider |
| source-sync UI | 46 PASS | 真 component／synthetic API，1440/390；非4尺寸全站驗收 |
| wizard/bulk browser | 14 PASS、0 SKIP | 真 wizard／synthetic API；四尺寸50列匯入／結果／重載／success與failure CSV／unknown原operation恢復，沒有 send；非真 provider membership |

owned SQL 每次新建 loopback Docker PostgreSQL17、核 container/port/name/pinned image，85 migrations 全部真执行。不是把 Neon URL guard 改成接受任意 localhost。Model、provider、portal、Blob transports 是明確 synthetic；零真發送／模型 spend。8 concurrent actor identities 是真 DB pool 並發，不是8個正式 Neon Auth login sessions。

## 已有 main 的獨立回歸

| task/module | suites／PASS | 實作判定 |
|---|---|---|
| EP-07 no-link | Node99＋Bun9；enquiries103；Golden A | 保留 receipts/parser/assignment/outbound intents、zero EPWA；真 canary blocked |
| EP-08/09 sync | daily38；Python122；admin17 | 保留分段 sync/full gate；真 scope／3 native schedule 待驗 |
| EP-12 navigation/session/overview | command-center82＋Bun8；team95＋Bun31 | main 已有 grouped nav、safe redirect/scoped policies；没有更換 auth；新增scope/as-of/error/permission loss、open card/list owned4及四viewport12驗證；真auth和完整team/inventory/flags仍待驗 |
| EP-13 editor/CMS | properties29＋Bun27；CMS53＋Bun4 | 既有 save/CAS/dirty recovery 保留，owned server readback 新增 |
| EP-15 staff setup | notifications21＋Bun14；wizard/bulk9 | 既有 Inbox picker/review 四步保留；real phone delivery blocked |
| EP-16 bulk/campaign | enquiries103；WozTell159＋Bun9；browser campaign scenarios；wizard14 | 50-row UI import／一次提交／逐列讀回／success及failure CSV／只修3失敗行／unknown原operation恢復已補驗；真queue/send/Auth/SQL UI integration仍待驗 |
| EP-17 metrics | analytics65＋Bun3；四尺寸新增8 browser scenarios | actual dashboard／drilldown／CSV／HKT boundary／quality／source／human response已補驗；flag-off理由明示不當0，沒有自動啟用；真runtime flag/Auth/SQL combined仍待驗 |
| EP-19 operations | operations17＋Bun8；sync-admin17；sync UI46 | error/partial/held/unknown恢复保留；全部正式 ops routes/operator session 待驗 |

同一測試出现在两任務列不重算 aggregate。Node/Bun/Python 按 package.json 指定 runner，无 npm test。最後 typecheck、lint（0 errors，3 baseline warnings）和 local build 各自 exit0。local build 不是正式 deploy，G00 schema/worker/flag 不由 build 成功推斷。

## 歷史與未完成驗收

兩份指定 CSV 僅新增 execution 欄位，原29 PASS／9 FAIL／22 BLOCKED、60 core IDs 及22 NEW planned cases原值保留。NEW case不因檔案存在全標PASS。1400 action IDs（68代表＋1332source candidates）在 action mapping 保留；408 rendered observations 去重，但仍 observation-only，G11未完成。

正式 alias 已唯讀核實：Vercel dpl_E97EZatvQ3Uuz2i9i7Cfx8HYxP6e、www.earnestproperty.com、main51cb0e9、TanStack Start、READY。這是舊正式 app metadata；worker/schema/runtime flags/roles未讀回，不能稱修復已部署。ops:release-readiness 在無正式 env/acceptance 下 exit2，保持 blocked。

F01/F03/F04/F08：local修復 READY，正式 runtime/canary BLOCKED；F02/F07：local contract READY、真租戶接駁/收送 BLOCKED；F05：NOT_READY（部份本地UX回歸，尚有全route/roles/flags/G11）；F06：Property.hk BLOCKED，28Hse三次排程 NOT_READY。EP-20/21不是全站結案；按 release 文件逐 capability補證。

首輪程式 `c8710def5cc74bef3833e7f3f0b1c695590a701b`：affected owned suites90 PASS（21＋34＋23＋8＋4），未受改動的owned setup/publication/withdrawal/maintenance12 PASS，總102，0 SKIP；Copilot Node77＋Bun34、六個反向safety probes、control-plane105；當時四viewport實際路由107；typecheck/lint/build各自exit0。Astra四項Important及一項Minor已按[review resolution](2026-10-03-admin-remediation/independent-review-resolution.md)完成同一fix pass；EP-12後續slice以本地測試另證，不冒稱重新獨立review。

本地補驗程式 `523a636c3c68bbd262cd67d2c2a5904d43270b99`：EP-16 failed CSV／subset summary及EP-17 disabled reporting原因已各自RED→GREEN；115 real-route＋14 wizard browser在此SHA exact重跑PASS、0SKIP。詳見[EP-16／17補驗](2026-10-03-admin-remediation/ep-16-17-local-readback.md)。這批沒有SQL/schema/provider/config變更，owned102原SHA分項證據保留；新的遠端CI在PR head再跑owned套件，不以舊測試SHA冒稱新來源已重跑。全部四批draft PR initial CI＋Preview成功；正式browser-staging仍SKIPPED而保持blocked。

新execution為40 PASS／28 PARTIAL／14 BLOCKED，僅表示各行註明的本地／唯讀層次，不能代替全部正式用例；原歷史29／9／22不改。

後續程式 `a3f24df9921a573e1aa429262bc62cb0b3eb9074`：EP-13 preview／非法值focus、EP-19 persistent error／unknown command須原job新讀回，四viewport48 browser PASS／0 SKIP；full85 owned property6＋Ops1 PASS／0 SKIP，control-plane105、properties Node29＋Bun27、operations Node17＋Bun8 PASS。typecheck/lint/build各自exit0，lint3 baseline warnings。之前owned102及EP-16/17證據仍保留各SHA；遠端PR head結果另記，不混算。詳見[EP-13／19](2026-10-03-admin-remediation/ep-13-19-local-readback.md)。

CSV直接與原實作包比對，trace原 `verification_environment`／`blocker`恢復planned值，新 `execution_environment`／`execution_blocker`另列實際環境及限制，baseline29/9/22不動。1400 action IDs保持，尚未按完整動作關G11。native37079390201既有main完整cycle1/3，修復分支正式0/3；published0／held74／unknown0，只有首頁HTTPverify，詳細公開同版本驗收仍NOT_READY。[排程證據及界限](2026-10-03-property-sync-readiness.md)。

後續EP-15程式 `f596c9a45f530dfae91924538d241aa9c6e24733`：試送unknown原request journal遺失的有效RED1 FAIL，修復後staff settings四尺寸40 PASS／0 SKIP，涵蓋四步設定、同名分頁、denied／expired／empty／outage、reload及原request恢復、endpoint captured version。共享owned UI88（property28／Ops20／staff40）PASS／0 SKIP；full85 owned setup SQL2及notifications Node21＋Bun14 PASS；typecheck／lint／build分開exit0，lint3 baseline warnings。原102／104歷史aggregate保留SHA，新PR-head結果另記。實際SQL request／job／audit各1，mock wake1，跨actor read拒絕；不是combined Auth／SQL browser或真worker／phone證據。兩份CSV原值直接比對原包不變，execution仍40 PASS／28 PARTIAL／14 BLOCKED。詳見[EP-15分層讀回](2026-10-03-admin-remediation/ep-15-local-readback.md)，formal capability維持BLOCKED／NOT_READY。
