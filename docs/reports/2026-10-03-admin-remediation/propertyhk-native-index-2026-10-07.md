# Property.hk native index 修復及實際讀回（2026-10-07）

已把真實 `agent.php` parser 接入 `crawl_propertyhk.py --index-only`，並修復 EPS／NTW 第 4 頁售價、租金皆 `--` 時整頁中斷的問題。該廣告現在保留為 `no_quoted_offer`，沒有推斷 sale/rent 或撤盤；其他廣告及後續頁面繼續採集。

基準 main `f7ebe9c4bb8a800daa3111b5e3a8d0ee838358cf`。Collector commit `ba201620ed9764569c0ea24a443c7b43ffb115b0`；離線 continuation 修復及驗證 SHA `95a8cb4cfaa0c860d8f6b4cd88ce47b87f9af0f5`。這是 EP-09 的可獨立完成來源採集修復；EP-09／EP-10 全來源驗收仍有外部 gate。

## 本次真實資料

普通 EarnestPropertyBot/2.0 HTTP，遵守 robots 和既有 2–3 秒節奏。只用四個原有 approved page-one URLs／SID，跟隨實際 jumpForm；沒有代理、cookies、身份切換或詳情存取繞過。採集起點 `2026-10-07T12:05:22.742541Z`（香港 20:05），run `c5294512-9a4b-44c2-9671-bb28f026cc6c`。

| 原入口 | 已公布並讀回的頁 | scope 廣告 | 租售 offers | 租售未確認廣告 |
|---|---:|---:|---:|---:|
| EPS／NTM | 1–4 | 61 | 67 | 0 |
| EPS／NTW | 1–7 | 139 | 154 | 1 |
| EPT／NTM | 1–9 | 168 | 195 | 0 |
| EPW／NTM | 1–3 | 46 | 49 | 0 |
| 合計 | 23 | 414 | 465 | 1 |

這些是分 scope 廣告／offers，並非 canonical 物業數。保留 branch、dt、advertisement ID、offer type、更新日期、頁碼及 raw-page hash，沒有跨 district 合併 ID。2026-10-02 的 25頁／454廣告／504offers 原始歷史保留；本次數量变化不能用來判定撤盤，歷史132缺盤候選沒有套用下架。

先前真實中斷頁 SHA256 `97d7f1ab414e1348eecda188326d1fc5deda1864437dc16c797f5872f95741f2` 在修復後 exact-byte replay 得到20廣告、22offers、1未確認廣告。重新採集完整四入口為24次 HTTP 回應（robots1＋index23），全部200；修復前的部分採集證據另存。

輸出 `observations.csv`／`observations.jsonl`、`unclassified-advertisements.jsonl`、原始回應及兩份 manifests 都保留在 ignored 私有證據。CSV SHA256 `15751a3bfa7085f94de21d0d0c58de3aae5bfcbb34880c326f27679fc6209ef1`。完整 artifact hashes 见同名 JSON；SID、原HTML、contact 不進 public repository 或公共 CI artifacts。

## 必要測試及獨立讀回

- 首批 native CLI RED：13 failed／122 passed；初次 GREEN135。Terminal filter RED1；真實 `--/--` 回歸 RED3；離線 chain RED2。最後 `npm run test:property-sync:python`：142 passed、0 failed、0 skipped。
- `test:property-sync`：75 passed；`test:property-sync:daily`：38 passed；沒有 skip 被當作通過。
- Typecheck、build 分開執行，均 exit0；lint exit0、原有3個 warning。真正的 secret boundary／source ingestion gate 保留。
- 離線 verifier 逐檔核對 size／SHA、page1→terminal、公司／精確牌照及分 scope IDs。合併前 review 指出 filter-chain 漏洞；現在 page1 綁定 approved query，後頁綁定前頁公布的 next_url，兩個獨立有效但 drifted 的頁面測試已先 red 後 green。
- 額外用 BeautifulSoup 直接數 desktop DOM，獨立比對 CSV／JSONL／未確認紀錄：414廣告、465offers、1未確認完全一致；所有輸出 hash 一致，沒有建立 `request.json`。
- 獨立 reviewer 已讀回 `95a8cb4`，原 Important finding 已解決，index-only slice 可合併。完整 CI／merge 證據另行讀回，不能由這個本地結果推定 production acceptance。

## Full sync 尚未 READY

本次正常 detail probe 只有一次，HTTP403、1647bytes，SHA256 `b93c49380ce0f7c3aadbf441894ba1b1cb498858e45ebff6de28f3cd2c9540ad`。使用者確認只有原有公開入口；沒有取得認可 detail feed／export／API。因此沒有再嘗試被拒詳情或 alternate detail 路徑。

| Capability | 結果 | 原因／證據 |
|---|---|---|
| 四個 approved 入口 index 採集／匯出 | READY | 23連續頁、CSV／JSONL／raw獨立一致 |
| 三分行全部 dt inventory scope | BLOCKED | 只核實表中入口；EPW／NTM 不證明 EPW／NTW，其他範圍未獲證據 |
| 真 detail／media／exact unit／盤號與 ID 權威 | BLOCKED | detail403；scope、媒體權限及 mapping 未證明 |
| Canonical ingestion／publication | BLOCKED | 不具備完整來源及身份／media 證據 |
| Production full sync | NOT_READY | 沒有 full receipt／accepted baseline advancement |

所有輸出固定 `full_snapshot=false`、`details_verified=false`、`id_scope_verified=false`、`full_branch_scope_verified=false`、`eligible_for_absence=false`、`publish_allowed=false`、`baseline_advanced=false`。`success=true`／`index_complete` 只代表清單收集完整；`sync_status=blocked_detail_verification` 明列另一層阻塞。

## 設定／migration dry-run、歷史及 rollback

Native command `--index-only --dry-run` 不讀 DB secrets，不經 POST／Node apply，沒有更新 config、migration、production schedule 或 worker dispatch。沒有新增 migration，套用0；provider runtime model calls／budget、recipients／sends 都是0。既有 full worker、receipt、CAS、protected edits、其他來源 offers 和 accepted baseline 路徑保留。

Traceability 22列／UAT82列只追加5個本次 execution 欄：原59／50欄所有值完全相同。原29PASS／9FAIL／22BLOCKED、22planned NEW cases 均保留；execution-evidence 原41個 root 完全相同，再加本次 root。這次沒有新增 Auth／四viewport／Golden A/B/C／CAS／unknown outcome／worker restart／restore 或3次 native schedule acceptance；歷史證據保留，manual read 不改稱 schedule。

需要 rollback 時可只 revert 本次兩個 source commits `95a8cb4`、`ba201620`；先保留私有輸出及 manifests。此 slice 沒有 production DB／schema／config 寫入，沒有需要回復的 production migration。完整同步需要取得允許的真詳情及完整 branch/dt/identity/media 證據後，以 owned DB 重驗，再另行審閱正式變更目標。
