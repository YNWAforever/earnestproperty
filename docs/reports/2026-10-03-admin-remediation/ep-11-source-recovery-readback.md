# EP-11／19 來源切換及原操作恢復補驗

程式提交 `bf585c0adec25ec3d82c4eafb26b39f748802d77`。產品差異只在 WithdrawalReviewWorkspace：非分頁讀取開始即清除上一批候選、選擇及預覽；使用者切換來源時清除上一來源的確認結果。完整的原提交 journal、per-actor storage key、scope、record versions、TTL、server CAS、manual protection、active sibling／sale/rent policy及原結果讀回保留。沒有新 DTO、schema、migration、runtime/provider ID 或正式配置變更。

## 有效 RED → GREEN

兩個1280 actual-route RED各1 FAIL：①28Hse候選已選後切換Property.hk，後者讀取失敗，舊候選仍可見且保留選擇；②28Hse已確認結果，在成功切換Property.hk候選後仍顯示。錯誤及舊候選不是正常空態；舊來源結果也不能當新來源結果。

GREEN在1440／1280／768／390共36 PASS、0 FAIL／SKIP：新來源pending／failed不再顯示舊候選或預覽入口，失敗有明確提示；恢復讀取只顯示所選來源並歸零選擇。來源切換清除舊結果，同來源的已確認結果在正常refresh／原operation readback後保留。分頁讀取沿用既有追加規則，沒有擴大改寫。

角色重查／使用者切換本身沒有產品 RED：actual SyncContent的loading／actor key及現有generation guards已能清掉舊預覽、拒絕舊actor晚到error；本次只補回歸，沒有另套actor patch。合成viewer零公司資料讀取，manager不能dispatch；不能推論真JWT／租戶授權已驗收。

## 證據層次

- 新actual `/admin/property-sync`、AdminShell、staff-session store、components及CSS，四尺寸各9情境＝36。Auth及API明確synthetic；只容許owned loopback GET／HEAD，禁止外部或網路mutation。獨立固定build輸出，不與既有UI suites共享編譯目錄。
- 各stage、published0／held74及先前上架時間分開assert；採集／匯入完成不冒稱上架／公開核對完成。合成counts只測讀回，不是新的正式盤量。
- 取消預覽零apply；active-source conflict行禁止套用，真正提交只含已選合資格行。unknown withdrawal／dispatch在reload後查原idempotency key，零reapply／redispatch；上架重試提交原runId，支援診斷仍指向原request asset。這不是provider已恢復或raw evidence hash重新驗證。
- 既有component UI46 PASS、0SKIP（1440／390）；withdrawal policy12及segmented daily38 PASS、0SKIP。full85 migrations的新owned loopback Postgres withdrawal2 PASS：132合成歷史候選仍NOT_APPROVED／零撤盤，canonical active sibling阻止absence apply。browser與SQL是獨立層，沒有聲稱combined Auth／DB／provider journey。
- 此程式SHA的typecheck、lint、build分開exit0；lint維持3 baseline warnings。逐項raw log hashes及source SHA寫入execution-evidence.json，36case摘要在sync-recovery-browser-execution-summary.json。這是focused self review；不把先前獨立review冒稱涵蓋本slice。

## 動作對照及歷史

`sync-recovery-action-execution.csv`只對已執行assertions列原ID：ACT-13／14／15為LOCAL_PARTIAL；14個對應source控制候選是同一批logical actions的實際控制項，不能另當14個business actions。原SHA的控制行已對回，原baseline／reference欄保留。未執行的重試匯入、更多候選及較早紀錄控制不提升狀態。不是用render count或source occurrence推論PASS。

兩份CSV直接與原pack欄值比對：原60cases的29 PASS／9 FAIL／22 BLOCKED、22 planned NEW、共82cases及1400 action IDs保持；新execution40 PASS／28 PARTIAL／14 BLOCKED未變。408歷史render observations及此前每個source／PR-head結果保留各SHA。G09／G11仍NOT_READY。

## Config／migration dry-run、限制與rollback

此slice的config／migration／provider差異為0；唯一CI差異為既有owned job新增此36case script，仍無production secret。完整85 schema沿用owned migration harness；不套正式migration。28Hse120／20／45／10及04:17HKT配置不改，本次沒有新增native schedule或manual workflow。既有baseline可計full cycle1/3、修復分支正式0/3保持；Property.hk EPS／EPT／EPW＋dt真detail／media仍BLOCKED。403／partial／index-only不當absence，132歷史缺盤不直接下架。

本地來源狀態隔離及原operation UI恢復READY；正式Auth／所有roles、完整來源與provider恢復BLOCKED；三次native schedule及完整公開同revision旅程NOT_READY。沒有merge、正式deploy／config／migration、真發送或付費模型。

Rollback只回退本slice的來源狀態清理及其test wiring；保留相容schema、receipt、outbound intent、frozen evidence、歷史候選／人工override及pending原key。未知結果先查原operation；不以清storage、新operation或整庫restore作回退。全程回退及其他能力閘沿用release文件。
