# EP-17 品質更正的當前權限讀回

本批基線 `2805a025687ed50bd8dad49d6909117db5de33ce`；修正 `6b061aa546ad8b6044ebfdcf1907574c82e2d177`。兩個品質寫入入口改為在同一 SQL statement內讀回當前 active staff、auth account binding及 admin grant；鎖定staff與grant至immutable revision寫入完成。request-entry/cached admin檢查仍先fail closed；失效權限403，當前admin才可取得missing source404。品質更正仍限admin；資格核實原有manager分行政策不變，沒有把降為manager的舊admin保留全域寫入權。

原owned full85 baseline16 PASS。新測試產生8個direct leaf RED：inquiry/event各inactive、role revoked、account rebound、downgraded manager，全部 Missing expected rejection。完整RED14 PASS/10 FAIL含parent，另有既有qualification duplicate-outcome case0fulfilled、原因UNPROVEN；不能算為本批品質缺陷或擅自歸因。相同fixture在GREEN及exact source均通過。首次GREEN0 PASS/1 FAIL於Docker run ETIMEDOUT、migrations/cases尚未開始；原log保留，helper/timeout不改，沒有停止其他workloads。unchanged retry及committed source各24 PASS/0 FAIL/SKIP，actual full85 PG17 migrations。8個denial以獨立raw SQL核對history/source完整arrays不變；current-admin positive修訂仍保留changed_by/reason/day、append-only歷史、原source/event身份與同scope報表分母。正向fixture現在具有真實staff_roles admin grant；test actor的role字串本身不是授權。

analytics65+Bun3、no-link99+Bun9 PASS/0 FAIL/SKIP；typecheck/lint/build分開exit0，lint3baselinewarnings。沒有UI source改動或新本機按鈕操作；舊四viewport/role/CSV及action紀錄保持原SHA。PR exact-head完整CI及既有UI回歸另記publication-readback；不把synthetic UI ports當combined SQL/Auth。沒有新DTO/schema/migration/runtime/provider ID，config/package/workflow diff0；all85只dry-run於owned DB，未套production。formal首頁/admin anonymous GET200僅availability，不是deployedSHA/Auth/schema驗收。

fresh-context Astra一次read-only whole-branch review：inspected Critical0/Important0/Minor0，focused兩個writer和累積AI/CRM revision/public knowledge repair/quality draft/batch draft/campaign journal/schema保留路徑為抽樣；並非逐行完整審核。Reviewer只讀本批raw24PASS logs，沒有獨立執行suite。declined範圍及裁決：真Auth/session、未知已commit結果復原、production app/worker/schema/native schedule、Property.hk full completeness/132held、provider/model真行為、production-scale及所有role/action/phantom concurrency，維持BLOCKED/NOT_READY；錯判代價為錯權限、重複不明寫入、錯撤盤/發送/预算或虛構全面驗收。未知qual/quality committed outcome仍不聲稱已修復。Minor none；沒有第二審閱或額外fix pass。198 cumulative changed files僅抽樣。

全部11項declined裁決及誤判代價：

1. 真Auth/session admission、expiry及revocation propagation：BLOCKED，否則虛構登入授權已驗。
2. 每role/scope/route/flag及combined UI/Auth/DB：NOT_READY，否則虛構跨scope／全journey驗收。
3. unknown committed quality/qualification outcome：BLOCKED，否則可能重複不明revision／qualification。
4. event occurrence/source-time同時變更：NOT_READY，actor locks未涵蓋該驗收，否則誤報香港日／並發讀回。
5. 所有grant-lock interleaving及source phantom組合：NOT_READY；新denial tests於call前改權限，cited controlledinterleave為FAQ，否則過度聲稱全面併發保證。
6. 原duplicate qualification及Docker啟動失敗根因：UNPROVEN，保留失敗紀錄；PASS retry不解釋原因，否則掩蓋intermittent regression／環境問題。
7. production app/worker/schema/config及native schedules：BLOCKED／NOT_READY，否則虛構正式驗收及cycle數。
8. Property.hk真terminal/detail/media及132held：BLOCKED，否則錯撤盤。
9. paid model/provider delivery/cost/transport uncertainty：BLOCKED，否則意外發送／費用／不安全重試。
10. production-scale及所有歷史artifact：scale NOT_READY；author另外讀回deep舊keys／trackedreports／三個最近批次的available recorded raw hashes，但並非reviewer exhaustive benchmark/hash audit，否則過度聲稱效能／歷史審核。
11. native clipboard/IME/platform：BLOCKED，否則synthetic UI掩蓋原生平台輸入／clipboard錯誤。

CSV只追加EP17、NEW17/TEST44/45/46 execution結果/SHA/環境/證據。原60的29 PASS/9 FAIL/22 BLOCKED、22 planned NEW、82cases、execution40 PASS/28 PARTIAL/14 BLOCKED保持；NEW17仍PARTIAL、TEST46仍BLOCKED。新JSON key performanceQualityActorFollowup；所有旧keys/report/action/sourcecontrol1400 IDs、408render觀察與raw hashes保留，沒有新按鈕PASS。原AIprobe PASS仍表示audited缺陷存在。28Hse120/20/45/10及04:17HKT unchanged：baseline1/3，repairedproduction0/3，新agent-triggered collection0，manual/replay/skip/watchdog不算nativeDaily。Property.hk EPS/EPT/EPW和approved dt須page1→terminal+真detail/media；403/partial/index-only不能撤盤，132held。

Rollback先限制兩個quality write入口再回退相容server；讀回原sources/events/quality revisions/actor/reason及qualification/run/provenance，保留immutable歷史/receipts/outbound intents；不delete證據、不restore整個DB、不把unknown變production，未核對original history前不重試uncertain write。普通portal零EPWA及parser/receipt/CAS/draft隔離/batchlinks/Inbox picker/source-account-branch-ad-offer-canonical/protected edits保留。無merge、production deployment/config/migration、真send/provider request/paid application-model call。

owned current-admin quality revisions **READY**；trueAuth/combined/unknown committed outcome/provider **BLOCKED**；完整role/action及repaired三次native **NOT_READY**。
