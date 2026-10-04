# 獨立審查與一次修正

獨立 reviewer：GPT-6 Astra，read-only，審查 `51cb0e9` → `4c5863c` 的完整 production diff／四個新 migrations／owned helpers／tests。沒有寫資料、呼叫 provider 或另開 reviewer。Critical 0；Important 4；Minor 1。曾用實際 context loader/service＋fake ports 獨立重現 cited listing 10m→12m仍 generated/apply 的缺陷；這不是正式模型或資料庫 acceptance。

| finding | 本輪裁決／修正 | 必要證據 |
|---|---|---|
| 舊 repair A 在新 repair B ack 後覆寫索引 | Important，接受。source publish 在 transaction 先鎖 publication，再按 captured/current 完整 revision CAS；失敗者不能 upsert/delete/insert。absence reconciliation 使用當前 canonical eligibility | controlled A15m→B16m publish/ack→A resume；舊 absence→reactivation。RED 18/21（含 parent）→GREEN21/21，0 SKIP |
| context 先讀、start後取新 revision | Important，接受。resource 明確 projection與 `ep_content_source_revision` 同一 SELECT snapshot；start 必須傳 captured revision，保存該值，completion再核 | context→mutation→start 必須拒絕，沒有 model call；raw proposal provenance讀回 |
| article所用 listing/FAQ evidence失去版本 | Important，接受。所有 supplied internal chunks保留 server-derived chunk/source IDs及revision，存入 nullable依賴快照；start/completion/apply 共用 current canonical eligibility/revision；unversioned search不得作 factual evidence | 改價／撤盤／FAQ改動／FAQ刪除在save及apply均拒絕；實際loader/service→repository→raw SQL證明來源快照真的傳過整條鏈 |
| content actor未核 authenticated account binding | Important，接受。server-resolved authUserId經start/complete/decision，proposal保留request binding；staff SHARE lock下核active、auth binding、真roles及scope | manager article不涉及listing agent hash，account rebinding在completion及apply分別拒絕；不能靠target hash偶然擋住 |
| 外層仍標「AI 回覆建議」 | Minor，接受。改「規則回覆建議（只作草稿）」；保留內層method及草稿限制 | actual-route browser regression107 PASS；沒有發送 |

內容 regression：RED21/33（12 failure包含 parent）→GREEN34/34，0 SKIP；新增一項實際 context/service/persistence整合驗證。Copilot existing package：Node77＋Bun34 PASS。重要四項在同一 final fix pass處理；沒有把原 defect-probe PASS當作修好，也沒有再請另一 reviewer。

EP-12後續獨立核對另發現overview全公司客戶數會顯示給agent、卡片無相同open filter。已用actual server、full85 schema重現3個葉測試失敗；修正為共用scoped pagination totals、same-filter links、scope/as-of、失敗保留last success、權限失效清舊數、request epoch。owned4 PASS及四viewport12 browser assertions（包含在107）通過。這個後續slice不冒稱已由上一個read-only reviewer重新審查。

Reviewer沒有裁決正式provider/model費用、production migration/locks/worker兼容、8真auth sessions、全route/flags/actions、真Property.hk details及3次native schedule。這些限制維持 BLOCKED/NOT_READY，不能以本地green替代。沒有拒絕 Important finding；Minor已修。production未merge/deploy/migrate/send。
