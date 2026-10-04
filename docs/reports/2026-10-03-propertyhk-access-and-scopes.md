# EP-09 — Property.hk scope 與合法完整存取缺口

| 分行 | 原用戶 dt | 原 audit index dt | 現況 |
|---|---|---|---|
| EPS | NTW | NTM、NTW | 各 dt approval／terminal/detail/media 未獨立核實 |
| EPT | NTM | NTM | branch/account 與真 detail 未核實 |
| EPW | NTW | NTM | 差異未解，不靜默替換 |

原 25 pages／454 advertisements／504 offers 是歷史 index-only 證據。原 detail 403 不當空 inventory 或撤盤。本轮公共 detail 讀取未取得可驗證 response，不能把工具讀取失敗當新 403 證據，也沒有绕過供應商安全驗證。

現有 Python collector/full gate 已保留 branch/dt scope、由 page1 至 terminal、detail completeness；122 Python tests PASS，包含缺頁/branch、403/429/timeout、terminal 重複與 malformed evidence。owned full-schema ingest 測試拒絕 incomplete envelope，accepted baseline 不變；synthetic positive publication 用真 image bytes，仍不是 provider detail 證據。

真接通精確缺口：認可 API/export/執行環境、公司 account identity、EPS/EPT/EPW 各 dt 的 approved manifest、每頁原始 checksum/unique IDs/terminal、asking_detail ID 的合法去識別 response、媒體 rights/hosts。不能用搜尋摘要拼 full，也不因 Crawl4AI 可用而假定能解 403。

Property.hk capability BLOCKED_EXTERNAL；不阻塞公開 AI/CRM/28Hse/其他本地修復。配置預期差異只有核實後的 source-account-branch-dt manifest；現在不新增 production scope、不改 accepted baseline、不做 absence apply。
