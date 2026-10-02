# 2026-10-02 — 28Hse hosted canary及每日同步

## 已完成

使用者明確授權後，[PR #212](https://github.com/YNWAforever/earnestproperty/pull/212)已合併；正式版本d1eb1c08b446d589c20aa9ef2caaa43ef88153f0已部署。[Main CI](https://github.com/YNWAforever/earnestproperty/actions/runs/36971681145)的ci、local PostgreSQL、handoff及no-link browser均成功；browser-staging仍SKIPPED，不能算真實職員登入。

PR修復apply timeout／OUTCOME_UNKNOWN後的盲重送：保留原request及attempt後停止，先核對receipt。回歸Python122/122、daily38/38通過；原版三個RED failure保留於既有證據。沒有新migration、writer或框架更換。

## 實際 rollout

- [Replay-shadow](https://github.com/YNWAforever/earnestproperty/actions/runs/36971886350)通過：使用既有凍結原件，沒有再次採集或業務寫入。
- [Single hosted canary](https://github.com/YNWAforever/earnestproperty/actions/runs/36972256552)六個stage均成功；私有archive下載、hash、安全還原、authoritative receipt及資料保護均獨立核對。
- 公開HTTP checker與真Chromium均通過。桌面／手機各六個owned loaded covers；十五個指定售租詳情的全部實際gallery images正常，包含本次新公開盤A057717及既有continuity樣本。
- 同步execution metadata已接通。每日流程已獲准啟用，暫時manual apply已關閉；來源absence及後台撤盤保持off。
- 匯入job實際924秒，仍在既有20分鐘job限時內；後續須監測實際duration及timeout，保留既有deadline、發佈嘗試上限及freshness。

完整receipt、DB身份、私有asset/hash pins及逐筆readback保存在既有私有證據庫及operator私有release紀錄。本公開摘要不載入這些敏感欄位。首次完整證據推送曾被auto-review拒絕，未推送；其後改為此刪敏摘要，沒有繞過拒絕或公開raw／credential。

## 三次實際每日排程

**MONITORING 0/3。** 正常cadence每日香港04:17，GitHub可能延遲；只有啟用後真正native scheduled事件及完整private／receipt／publication／public證據才計PASS。Manual、replay、failure、skipped及缺proof仍留分母。

| Cycle | Native scheduled run | Status |
|---|---|---|
| 1 | 尚未執行 | MONITORING／未驗證 |
| 2 | 尚未執行 | MONITORING／未驗證 |
| 3 | 尚未執行 | MONITORING／未驗證 |

既有香港09:00 heartbeat持續唯讀監測至三個實際cycles驗收完成；有故障或需要使用者行動才通知。沒有把manual成功寫成穩定每日上線。

## Critical journeys

| Journey | Status | Remaining gate |
|---|---|---|
| A28Hse pipeline | READY／每日啟用 | 三個實際scheduled cycles仍MONITORING |
| BProperty.hk | BLOCKED_EXTERNAL | 合法detail存取及完整scope／ID／media隔離驗收 |
| C後台盤源同步 | VERIFICATION_BLOCKED | 後台受管憑證、真登入角色及受控retry驗收 |

## Rollback

停此來源的新daily／manual apply後，先唯讀核對正在執行的結果及receipt。保留accepted history、私有baseline、UUID／public aliases、人工覆寫、owned media及已套用schema；未知先reconcile，禁止blind replay／recrawl。Property.hk及後台撤盤維持各自gate；沒有新migration、批量撤盤、真WhatsApp/email或無關cron變更。
