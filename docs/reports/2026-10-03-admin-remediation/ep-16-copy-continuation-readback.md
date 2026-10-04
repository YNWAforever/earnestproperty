# EP-16 複製提示與原批次 50＋10 續跑讀回

產品及測試 SHA：`0927bd498d776f50b9430fa9a3009500545a1100`。這是新增實作與執行證據；上一輪 `653695a` 的 60 browser／7 SQL 及更早 44／56 結果保留各自 SHA，並非被改成 72／8。

兩個缺陷均先重現再修正：原批次已確認 50 行後續跑至 60 行，舊「全部已複製」提示仍存在；複製 50 行的延遲回覆也會在 60 行結果上顯示成功。有效 RED：兩個提示數量 assertion 均 expected0／received1。最初含未加引號 pipe 的測試參數被 npm 轉交 shell，零測試執行；`ep16-copy-continuation-red.log` 是指令接線失敗，不能當缺陷 RED。修正後提示綁定 batch ID 與當次複製的 codes；複製等待期間停用再次複製。結果清單改變後，舊成功／失敗提示及延遲回覆均不能代表新結果。

| 執行層 | 實際結果 | 邊界 |
|---|---|---|
| 四尺寸 browser |72 PASS／0 FAIL／0 SKIP；1440、1280、768、390 各18 |實際 links route、wizard、import、client、result、shell、staff store；synthetic Auth/API；GET/HEAD owned loopback |
| Clipboard |拒絕後重試精確50；讀回原50後續跑10再複製精確60；pending停用；late50不能確認60 |模擬 `writeText` 接收端，沒有讀寫使用者剪貼簿；正式 OS 權限／native clipboard 未驗 |
| 獨立 owned SQL |8 PASS／0 FAIL／0 SKIP；parent＋7subtests |fresh loopback PostgreSQL17／全部85 migrations；實際 handlers/raw SQL；trusted actor port，並非真 JWT 或 combined UI/SQL |
| SQL 50＋10 |讀回原50收據，fresh60 preview為reuse50/create10；實際client只提交原secondchunk10；兩份收據、60不同codes／ids及逐行property/deal/source/placement |新增60為獨立合成 `other` placements、sale/rent各30；不代表browser混合website/28hse資料直連此SQL環境 |
| 回歸 |properties Node29＋Bun28 PASS／0 FAIL／0 SKIP |existingbatch／draft／CSV contracts |
| 靜態／建置 |typecheck0、build0、lint0，三項既有warnings |分開package scripts；build成功不等於正式發佈 |

Browser 實際操作 CSV 匯入60、核對與預覽、firstchunk50回覆遺失、reload、查回原收據、繼續同一批次只提交10、確認60及再次reload/read。捕獲兩次commit為50／10，batch與chunk IDs維持原journal，不重送已確認50，terminal清理所屬草稿。拒絕、pending、success 的 clipboard ports 全為隔離合成資料。Synthetic fixture 額外10筆 codes 按公開樓編數字產生，避免第二chunk從index0重複第一chunk codes；這是fixture修正，沒有宣稱正式server重複codes。

SQL 在原有50測試及manual1之後建立獨立60 placements，raw links／versions由51增至111，exact readback為50／10。獨立查詢逐行核對存儲結果；成功CSV61行，provider requests、outbound intents、conversations及真實發送均0。新SQL acceptance在原本正確的server上通過，是新增驗收覆蓋，並非新的server缺陷RED。

證據：[browser execution summary](link-bulk-copy-continuation-browser-execution-summary.json)、[action execution](link-bulk-copy-continuation-action-execution.csv)、[execution evidence](execution-evidence.json) 的新增 `linkBulkClipboardContinuationFollowup`，及兩份traceability/UAT CSV。ignored raw logs、八張四尺寸截圖及SHA256記在新增entry；截圖是完整suite既有50行結果／新草稿畫面，60行續跑以action assertions及独立SQL讀回證明。舊八張截圖使用原filename保留，新截圖使用 `bulk-continuation-*`。

ACT59–62及19個重疊source controls維持LOCAL_PARTIAL。原候選ACT-S-0388基準為`WhatsappBatchResult.tsx:63`，本輪實際操作copy Button；ACT-S-0433已操作原50讀回後繼續10。控制項與business action重疊，不能相加成23個新的完整業務能力。新草稿入口没有捏造原action ID。1400原IDs、408歷史render observations、原60 cases的29PASS／9FAIL／22BLOCKED、22planned NEW、共82cases和execution40PASS／28PARTIAL／14BLOCKED均保留。NEW16仍PARTIAL。

Config／migration dry-run：沒有新增schema/migration、runtime/provider IDs、production config、flags或schedule變更；現況85 migrations只在fresh owned database驗證。保留28Hse120／20／45／10及04:17HKT配置；本輪新增native0，baseline eligible1/3，修復分支正式0/3。手動／replay／skip不能補schedule驗收。Property.hk逐EPS/EPT/EPW及dt完整page1→terminal＋detail/media仍待真存取；403／partial／index-only不能觸發撤盤，歷史132候選仍held。

獨立fresh-context whole-branch審閱：range51cb0e9..0927bd4、focusf9a30b6..0927bd4，已檢查路徑未發現具體Critical／Important。Reviewer獨立執行actual component in-memory clipboard scenarios及pure batch/draft/AI presentation16PASS；72browser／8SQL是讀取author logs，沒有獨立重跑。涵蓋canonical revision/output gate、durable invalidation、AI eligibility／actor/source guard、canonical sibling保護、bounded讀取及receipt/draft/actor recovery的一致性；不是181files逐一完整審計。新action CSV沿用「copy-all not operated」造成文字矛盾，已只修正新文件及generator，並重新驗證immutable evidence／hash。沒有此輪deferred minor。

Reviewer未判定的範圍逐項保留：native clipboard；真Auth／expiry／fullroles／flags／combinedUI-SQL；provider／send／paidmodel；production app／worker／schema／deploy／nativecycles；Propertyhk完整來源／livewithdrawal；原1400actions及archive逐項重審；unrelatedbun.lockb與未commit的author evidence。裁定為保留對應BLOCKED／NOT_READY，並由primary另讀回remoteCI及不可變baseline/hash；代價是仍不能證明正式權限、delivery／model品質、native裝置、完整來源或全action驗收。不能用本審閱放行falsewithdrawal或production。bun.lockb保留，generatedrouteTree只復原build造成的line-ending churn。

Rollback：停用bulk建立前先查回原batch/chunk/draft lineage，保留unknown journal、deferred與人工最新edits、links/versions/receipts及historical outbound identities；若回復這個介面修正，舊clipboard提示可再次誤代表新結果。這輪没有刪資料或production mutation。Remote exact-head CI另行讀回後追加；本文件不能自行證明正式app／worker／schema一致。

Capability：owned bulk clipboard feedback／原50＋10 continuation **READY**；真Auth／全role／flags／combined UI-SQL／native clipboard／provider **BLOCKED**；full action reconciliation及三次修復後native schedule **NOT_READY**。沒有merge、deploy、production migration、真發送或付費model呼叫。
