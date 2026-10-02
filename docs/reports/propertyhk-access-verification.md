# Property.hk 存取及隔離解析核實（更新2026-10-02）

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

四個入口不證明三分行完整inventory：EPS的NTM與NTW第一頁不同，dt確實限制可見清單；EPT/EPW只驗已提供的NTM，其他地區範圍尚未核實。數字detail路徑可核對該廣告identity，但global/branch ID權威、內部盤號、exact unit、詳情欄位、真空頁、明示撤盤與media rights仍未證明。

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

需Property.hk允許的詳情存取或真實feed/HTML export（sale/rent/dual及空頁/終頁/明示撤盤），三分行完整dt範圍證明、IDscope語義、exact unit/盤號權威及圖片hosts/使用權。沒有要求在chat貼secret。取得後沿現有worker/ingestion gate在已核对disposable DB重驗；三分行完整才推進合併scope，首次absence仍off。28Hse其餘工作獨立繼續。

## 2026-10-01 歷史證據

當時完整三分行URL未提供。一次 `/asking_detail/6826616.html` 普通HTTPS讀取為403（1647bytes；SHA256 `dc85018fa4a68caed0b2f9c26d91cbcdfa02ab4869b39202a6f344d8c609ca5c`）。官方服務背景可讀但不是已授權inventory feed的證明；未聯絡provider、未宣稱權限。舊BLOCKED紀錄保留；本次新增入口/清單證據不抹去detail阻塞。
