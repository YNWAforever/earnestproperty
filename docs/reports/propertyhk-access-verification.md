# Property.hk 存取及隔離解析核實（更新2026-10-11）

## 2026-10-11 荃灣dt補讀：六入口index readback

用戶批准後，以已批准EPT／NTM、EPW／NTM入口只改`dt=NTW`，讀取EPT／NTW、EPW／NTW。這兩個入口是**推算候選**，只記在ignored私有`candidate-entry-urls.json`（`approved_by_company=false`），未併入`approved-entry-urls.json`。同樣EarnestPropertyBot/2.0、robots核對、≥3秒間隔；第2頁起只跟頁面jumpForm的`next_url`，沒有猜頁或超出終頁。HTTP範圍2026-10-10T20:33Z至20:45Z（香港10月11日），共9個index請求，0個detail請求；EPW／NTW第6頁首次read timeout（非4xx），隔10秒重讀一次200。

`main`版`inspect_property_agent_index`逐頁PASS（公司、精確牌照、agent/dt/SID、jumpForm、欄名）。連同2026-10-07私有capture離線合併核對：

| 入口 | 證據日期 | 頁 | 獨立廣告 | 售租offers | 地區 | 牌照 |
|---|---|---:|---:|---:|---|---|
| EPS／NTM | 2026-10-07 | 4/4 | 61 | 67 | 屯門 | C-018613-A000 |
| EPS／NTW | 2026-10-07 | 7/7 | 138 | 154 | 荃灣 | C-018613-A000 |
| EPT／NTM | 2026-10-07 | 9/9 | 168 | 195 | 屯門 | C-018613-A003 |
| EPT／NTW（候選） | 2026-10-11 | 2/2 | 30 | 32 | 荃灣 | C-018613-A003 |
| EPW／NTM | 2026-10-07 | 3/3 | 46 | 49 | 屯門 | C-018613-A005 |
| EPW／NTW（候選） | 2026-10-11 | 7/7 | 120 | 138 | 荃灣 | C-018613-A005 |

每入口第1頁至終頁連續、終頁無`next_url`、入口內無重覆廣告ID；六入口兩兩ID交集0，合計563個獨立廣告（不是canonical物業數）。EPS／NTW及EPW／NTW各有1個無報價廣告列為unclassified，不計offer。`dt`是單一地區（NTM=屯門、NTW=荃灣），頁面沒有其他dt連結，所以屯門／荃灣以外是否仍有分行dt**未能由頁面證明**。

結論：EPT、EPW原先缺荃灣dt，舊「EPW用NTW或NTM」差異實為兩者皆有。此readback只推進index scope證據；兩個候選入口待公司確認，`details_verified=false`、`full_branch_scope_verified=false`、`eligible_for_absence=false`、`production_writes=0`不變，detail 403阻塞不變。

## 真實入口與清單證據

使用者提供獲准原始SID入口：EPS／NTM、EPS／NTW、EPT／NTM、EPW／NTM。保留原query；SID／原HTML／contacts只存在ignored私有證據，不進public repository。普通EarnestPropertyBot/2.0 HTTP遵守robots及2–3秒間隔；沒有代理、換身份、challenge cookies或繞過驗證。

| 原入口scope | 真實index頁 | 廣告數 | 分開售租offers | 牌照 | 隔離index結果 |
|---|---:|---:|---:|---|---|
| EPS／NTM 麗都花園 | 1–4 | 65 | 69 | C-018613-A000 | PASS |
| EPS／NTW 麗都花園 | 1–9 | 178 | 194 | C-018613-A000 | PASS |
| EPT／NTM 青龍頭村 | 1–9 | 168 | 195 | C-018613-A003 | PASS |
| EPW／NTM 海韻花園 | 1–3 | 43 | 46 | C-018613-A005 | PASS |

合計25頁、454個scope廣告、504個sale/rent offers，**不是canonical物業數**。HTTP採集範圍2026-10-01T18:30:38Z至18:39:14Z（香港10月2日）。Pagination使用實際jumpForm的action、hidden fields、p placeholder及共N頁；沒有猜URL、刪SID或超出終頁讀取。重覆mobile DOM不重算；第一頁至最後非空頁連續、頁數一致、同scope沒有重覆廣告ID。

`inspect_property_agent_index`核對公司/精確牌照、原agent/dt/SID、欄名、checkbox廣告ID與asking_detail路徑一致，解析金額/面積/來源更新日期，sale/rent各成offer。它只輸出index_only觀察；沒有套用generic synthetic selectors到正式worker，沒有建立internal UUID、unit mapping或company number。

## 詳情仍受阻，合併基準未推進

第一個正常詳情讀取 `/asking_detail/6826118.html` HTTP403，SHA-256 `93cce75aeca63fad355a16670d0b5dab32e93d4fdadd2c9a8f1b94c4c277c00b`。立即停止所有詳情請求；其餘本已允許的branch index採集獨立完成，沒有改路徑去取得被拒的詳情。

四個入口不證明三分行完整inventory：EPS的NTM與NTW第一頁不同，dt確實限制可見清單；EPT/EPW只驗已提供的NTM，其他地區範圍尚未核實（2026-10-11已補讀候選NTW，見上節）。數字detail路徑可核對該廣告identity，但global/branch ID權威、內部盤號、exact unit、詳情欄位、真空頁、明示撤盤與media rights仍未證明。

因此每份驗證報告固定 `full_snapshot=false`、`details_verified=false`、`id_scope_verified=false`、`full_branch_scope_verified=false`、`eligible_for_absence=false`、`production_writes=0`。正式source policy、schedule、publish、absence均未啟用，production apply0，原accepted baseline不變。三行入口可讀不等於完整3/3 ingestion通過。

## 可重跑的隔離驗證

```bash
# PRIVATE下含原始approved-entry-urls.json、capture-manifest.json及URL hash命名的.raw。
# 原HTML和SID不可提交、上傳public artifact或加入public CI fixtures。
python scripts/property-sync/verify_propertyhk_index_evidence.py \
  --manifest PRIVATE/capture-manifest.json \
  --entries PRIVATE/approved-entry-urls.json \
  --out PRIVATE/verified-index-report.json
```

此命令完全offline、不連DB/網絡；先核對檔案範圍、size/SHA，再驗連續頁及解析。真實private capture實跑exit0，25/25 index pages通過；整條source仍BLOCKED_EXTERNAL。18個synthetic結構/負向tests覆蓋錯公司/牌照、branch/dt/SID/頁數混入、錯ID、金額、日期、空頁/challenge、hash/path tamper與缺頁；它們不代替真實詳情/DB/provider驗收。

## 最小剩餘外部資料

需Property.hk允許的詳情存取或真實feed/HTML export（sale/rent/dual及空頁/終頁/明示撤盤），三分行完整dt範圍證明（含公司確認EPT／NTW、EPW／NTW候選入口，及屯門／荃灣以外有否其他dt）、IDscope語義、exact unit/盤號權威及圖片hosts/使用權。沒有要求在chat貼secret。取得後沿現有worker/ingestion gate在已核对disposable DB重驗；三分行完整才推進合併scope，首次absence仍off。28Hse其餘工作獨立繼續。

## 2026-10-01 歷史證據

當時完整三分行URL未提供。一次 `/asking_detail/6826616.html` 普通HTTPS讀取為403（1647bytes；SHA256 `dc85018fa4a68caed0b2f9c26d91cbcdfa02ab4869b39202a6f344d8c609ca5c`）。官方服務背景可讀但不是已授權inventory feed的證明；未聯絡provider、未宣稱權限。舊BLOCKED紀錄保留；本次新增入口/清單證據不抹去detail阻塞。
