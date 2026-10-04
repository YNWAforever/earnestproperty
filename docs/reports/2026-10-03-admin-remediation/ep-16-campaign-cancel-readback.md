# EP-16 原 Campaign 取消恢復讀回

產品及測試 SHA：`f8b8a58f7ac28dbe205d4dae72a98019ac9ed2ac`。上一輪 campaign `d89b94d` 的32 browser／4 SQL，以及 clipboard `0927bd4` 的72／8仍各自保留，不把歷史結果改成這輪60／5。

有效 RED 使用 `ff213714` runtime 加新增未提交測試，六項中4 FAIL／2 PASS：舊帳戶取消回覆會在另一帳戶顯示成功；原取消操作沒有 durable read gate，造成 response lost、in-flight reload 及 storage refusal 三種失敗表現。這是兩個缺陷、四項失敗 assertions，並非四個獨立 server 缺陷。修復後 focused6 PASS；另有 corrupt／空物件／unknown version journal acceptance1 PASS，這是補充驗收，不是新的缺陷 RED。

介面先把原 Campaign ID 寫入所屬 actor 的 session journal，成功保留後才提交取消；未知結果、途中 reload 或獨立讀取失敗均保留原 journal，限制新取消及 queue，並提供只查原 Campaign 的 read action。只有該原 ID 讀回 cancelled 才解除限制；另一 actor 的畫面不接收舊成功提示。明確拒絕則解除所屬未提交記錄。損壞或不能讀寫的本機記錄保留並限制操作。恢復清理以目前 draft ID 比對，保留不同 ID 的草稿；成功訊息明示「已發出的訊息無法收回」。server cancellation、queue journal schema、jobs、receipts、outbound identities均沒有被重寫。

| 執行層 | 實際結果 | 邊界 |
|---|---|---|
| 四尺寸 browser |60 PASS／0 FAIL／0 SKIP；1440、1280、768、390各15 |actual campaign route／shell／staff store；synthetic Auth/API；owned loopback |
| 新 cancel journeys |28項，保留原queue32項 |確認與撤回、pending單次提交、actor切換、response lost／reload、原非terminal讀回、storage refusal、明確拒絕、corrupt journal；synthetic accepted history |
| 獨立 owned SQL |5 PASS／0 FAIL／0 SKIP；parent＋4subtests |fresh loopback PostgreSQL17／全部85 migrations；actual handlers及raw SQL；trusted manager actor，非真 JWT |
| SQL cancel讀回 |原in-flight sending row逐欄不變、未dispatch recipient取消；repeat cancellation false；原job ID／idempotency／payload不變；queue audit1／cancel audit1 |原accepted／dispatch boundary既有case保留；zero fetch guard及outbound intents0；没有種入真歷史intent或provider receipt |
| 回歸 |woztell Node159＋Bun9、enquiries103、shared synthetic browser115 PASS |shared fixture cancel port本輪新增合成行為，原來訊及queue cases仍通過 |
| 靜態／建置 |typecheck0、build0、lint0／三項既有warnings |各自package scripts；不代表正式部署 |

Browser 的in-flight reload會銷毀尚未解決的合成promise；它證明介面保留原記錄及不盲目重試，不代表真server transaction／worker restart。另一owned SQL層證明實際server mutation及independent raw readback，不宣稱browser直接接駁該SQL或真Auth。Synthetic accepted計數／history不是provider accepted或delivered證據。新SQL case在原本正確的server通過，沒有新增server修復聲稱。

四张 `campaign-cancel-confirmed-*` 截圖為取消成功畫面；390畫面確認已取消提示及「已發出的訊息無法收回」。另四张 `campaign-cancel-green-*` 檔名雖有cancel字樣，實際由原lost **queue** response case截圖，只作queue recovery證據，不作cancel recovery證据。各截圖及raw logs SHA256記在新增 `campaignCancellationFollowup`；原 `campaign-green-*` 圖片保留。整套四尺寸均檢查page無水平溢出；表格本身可橫向捲動。

新增證據：[browser execution summary](campaign-cancel-browser-execution-summary.json)、[action execution](campaign-cancel-action-execution.csv)、[execution evidence](execution-evidence.json) 的 `campaignCancellationFollowup`，及兩份traceability/UAT CSV。只追加EP16、NEW16與原TEST42實際結果，TEST43真template／recipient gate仍BLOCKED；原29 PASS／9 FAIL／22 BLOCKED、22planned NEW、82cases、execution40 PASS／28 PARTIAL／14 BLOCKED均不改。

ACT46／48／49及六個重疊source controls為9筆LOCAL_PARTIAL。原候選ACT-S-0713在基準`admin.blasts.tsx:821`，本輪確實操作row取消Button；ACT-S-0733草稿內取消Button未操作，不把它當通過。新取消read control没有捏造原action ID。1400 IDs、source候選原欄及408歷史render observations均保留；不能把9筆重疊controls當成9個完整新能力。

Config／migration dry-run：本輪沒有新增migration、schema、runtime/provider IDs、production config、flags或schedule；85 migrations僅在fresh owned database驗證。28Hse120／20／45／10及04:17HKT維持；新增native0，baseline eligible1/3、修復分支production0/3。manual／replay／skip不能充當schedule。Property.hk EPS/EPT/EPW及dt完整page1→terminal＋detail/media待真存取；403／漏頁／index-only不能授權撤盤，歷史132候選仍held。

Fresh-context whole-branch審閱：range51cb0e9..f8b8a58，focusff213714..f8b8a58，在已檢查路徑未發現具體Critical／Important。Reviewer核對actor remount／late response、journal先保留才提交、exact original cancelled讀回、functional draft清理及server authorization／dispatch boundary；亦檢查source revision／durable repair、AI actor/source CAS／CRM schema/action、scoped overview／analytics及bulk recovery一致性，不是整個branch每一檔案逐項審計。

Reviewer獨立執行AI contracts13 PASS、CRM regression6 PASS／0 FAIL／0 SKIP及base..HEAD diff check。第一次CRM invocation缺少module-mocks參數，在執行測試前失敗；修正必要參數後6 PASS，是reviewer invocation問題，不能當product RED。沒有獨立重跑browser／owned SQL／typecheck／lint／build。本輪minor截圖命名問題已由上述layer及logs明示為queue證據，沒有把它宣稱cancel recovery。Build產生routeTree檔案的line-ending差異經git diff確認沒有內容變更，primary只復原該生成檔，保留無關bun.lockb。

Reviewer未判定的範圍逐項保留：真Auth／API／expiry；provider accepted／delivery／template及真取消；native clipboard／IME；production flags／schema／locks／worker／deployment；完整roles／scopes／routes／actions與combined UI-SQL；Property.hk逐dt及detail/media；三次native schedules。裁定為保留對應BLOCKED／NOT_READY，primary另做remote exact-head CI與不可變CSV／hash讀回。錯誤假設的代價是把隔離測試誤當正式權限、delivery、worker、全量來源或完整actions證明，可能導致錯誤撤盤或重複操作；本審閱不能放行這些正式變更。沒有未處理的新Critical／Important，minor證據問題已明示處理。正式browser-staging skip仍BLOCKED。

Rollback：先停用新queue／cancel提交並查回原Campaign ID；保留未知取消／queue journals、原jobs／recipients／receipts／dispatch開始及accepted紀錄、人工草稿及歷史outbound identities。回復這次UI修正會失去durable cancellation gate與actor late-feedback保護。這輪没有刪資料、取消真Campaign、merge、deploy、production migration、真發送或paid model呼叫。

Capability：owned原Campaign取消恢復 **READY**；真Auth／provider／combined UI-SQL／完整roles／flags **BLOCKED**；完整actions及三次修復後native schedule **NOT_READY**。Remote exact-head CI需另行讀回，不能由local build或PR Preview替代正式驗收。
