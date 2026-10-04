# EP-14 — 手機收件匣、草稿及未知結果

既有 real-route/synthetic-auth-api browser runner 全量 95 PASS、0 FAIL、0 SKIP，涵蓋 390/768/1280/1440，加 360；agent-a 69、agent-b 2、manager 22、viewer 1、guest 1。它操作真 React route、AdminShell 及 CSS，自己的 loopback server，HTTP mutations/external network 禁止；不是正式登入/provider 送达證據。

新增 1440 長對話回歸和手機 close bounding-box assertion。先 RED：16×16；Sheet/Dialog close 改 44×44 後 GREEN。四尺寸截圖有實際檢視。切對話/延遲結果、草稿 identity、focus、keyboard 等效高度、stale permissions、note/reply intent、unknown outbound 只查原 reservation、cold-tab/reload、same-tick duplicates 都用既有 runner 保留。

319 個去重 rendered observations 出自 /admin/whatsapp、/admin/leads、/admin/blasts。它們只是可見 control observation；scenario PASS **不表示每個按鈕被操作**。原 68 個 business actions 和 1332 source occurrences 保留 ID/分母；映射另見 inventory CSV。未 render 的 routes/flag 仍 pending，G11 未關閉。

本地關鍵收件匣流程 READY；整體日常後台 NOT_READY（真角色/flag、所有 route 和完整代表動作驗收未齊）。回退只 presentation，保留 conversation drafts、outbound IDs 和 receipt ledger。
