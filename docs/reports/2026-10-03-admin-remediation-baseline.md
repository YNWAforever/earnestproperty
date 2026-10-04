# EarnestProperty 修復基準（2026-10-03 香港時間）

遠端 main／原審核均為 `51cb0e9c08269ebabeb0b593d4dea611b9246c32`。修復使用 Codex 管理的獨立工作目錄及 `codex/admin-remediation-20261003` 分支，原主目錄的舊分支及未提交工作保留。原包的文件是規格與歷史證據；本次實作授權來自使用者本輪指令。

外層實作 ZIP SHA256：`592ccad5466966abbd153163395d0e346c3e7f41306c16d57eb1aeff0d78167a`。內含原審核 ZIP：`ffcfe4160a23080caee6b0bf7ca126df298cf29a3ae60bd14394486ba6acb2d2`，符合指定值。兩份 manifest 分別 84/84 及 74/74 通過。全部先驗 archive 路徑，再解壓至此 chat 的獨立輸入目錄。

Node 24.18.0、Bun 1.3.14、Docker 29.7.2。依未修改的 package-lock.json 執行 npm ci（不執行 install hooks）；原生 worktree setup 帶入的 bun.lockb 修改不屬修復且不提交。工作目錄只有 `.env.example`；可寫測試移除繼承的 DB／AI／WhatsApp 憑證。

EP-00 新回歸在修改前以「Compiled server graph must not be created inside src」失敗。原 paired invocation 有時先掃描完而通過，不能當不存在競態。修復將整個編譯 graph 放在獨立 OS temp，透過語法解析重寫 imports，保留套件解析及退出清理。client secret scan 的產品來源範圍沒有縮小；同一掃描函式對九種 secret 的真正 source sentinel 全部拒絕，正常 source 通過。

EP-00 paired tests：31 PASS／0 FAIL／0 SKIP；typecheck exit 0；lint exit 0，三個既有 React refresh warnings。受控 loopback Docker Postgres 17：81 個完整 migrations，19 PASS／0 FAIL／0 SKIP，含八個併發 intent、CAS、撤回 consent、unknown outcome、signed receipt、重送及 Golden A 的同環境保存讀回。provider transport 與 delivered/read 收據是 synthetic；未向真租戶發送。container 在測試結束後刪除。

原 UAT 60 cases 的 29 PASS／9 FAIL／22 BLOCKED 保留在 baseline_status；22 NEW cases 是待驗收目標。新 execution 欄與歷史結果分開。production runtime／worker revision／實際 flags、真 provider／model、四裝置及 restore 不由本次 local tests 推定通過。

回退僅限測試 harness；保留完整 client secret scan。下一步按 EP-01→EP-02→EP-03→EP-04 完成資料可靠性，並獨立核對配置缺口。
