# EP-13／19 獨立本地補驗

最終程式 SHA：`a3f24df9921a573e1aa429262bc62cb0b3eb9074`。聚焦提交：EP-13 `3f364427ce0b67e263981ad8d4be09c47700f7e4`；EP-19 `a3f24df9921a573e1aa429262bc62cb0b3eb9074`。本報告與兩份逐情境 browser JSON 同時保存，舊來源 SHA 的證據不改寫。

## EP-13

目前 editor 是 `AdminPropertyWorkspace`，復用原 schema／CAS／sale-rent scope／ImageUploader。狀態修改先展示凍結的 before/after 與 scope，再以 captured expectedVersion 確認；取消保留草稿。非法小數面積／房數與負數價格會標明並聚焦首個錯誤，不呼叫 save。保存與來源差異顯示 HKT 時間及可讀欄位名稱，保留人工 protected values。

有效 RED：1280 editor 情境因缺 preview、非法面積未 focus 而2 FAIL／4 PASS；負數價格焦點再1 FAIL。最小修復後，四尺寸1440／1280／768／390，各7情境，共28 PASS／0 FAIL／0 SKIP：preview cancel/confirm/fresh read、schema focus、dirty scope cancel、upload failure保留文字及相片排序、CAS conflict與save後read失敗、50筆sale-only partial、unknown outcome停止餘下chunks並要求讀回。這是真路由／元件／CSS，Auth/API/media傳輸為 synthetic，owned loopback封鎖遠端；不是正式登入或真 Blob upload。

另一 owned PostgreSQL17、完整85 migrations，actual server writer＋獨立 reader 6 PASS／0 SKIP。新增50個雙用途盤，以actual writer令第49行 stale、在第50行寫入前撤銷 staff，經原10個chunks：48 sale offline、2已確認拒絕，50 rent全部 active，protected文字全部保留。不是把 raw SQL 不改 updated_at 的變動冒稱正確 CAS fixture。其餘既有 tests包含相片metadata order、分開售租、dirty read/CAS/revoked writer。UI 與 SQL 是兩個分層證據，完整同一browser/Auth/SQL/Blob journey仍待目標。

早期fixture的auth object identity／selector包含表單值、SQL enum cast及timestamp-less競態設定已更正，不列產品 RED。正式T027001相片／公開查詢／全盤價格沒有由synthetic editor測試推論通過。

## EP-19

有效 RED：1280 Ops情境 persistent inline error及unknown guard缺失，2 FAIL／2 PASS。保留 support request reference；unknown command結果在成功的新讀取包含原job前禁止retry/cancel，舊的in-flight response不能解鎖。命令不建立新job或更換identity。既有30秒poll只有具權限、成功且含原job的新資料才可解除；viewer的jobs policy保留，manager仍有原retry權限。

四尺寸各5情境，共20 PASS／0 FAIL／0 SKIP：403持續錯誤／reference、cancel確認不寫及原job queued/audit重載、unknown後read失敗保持鎖定、舊response延遲返回不解鎖、讀取失敗保留jobs及viewer無jobs控制項。使用actual Ops route／純role policy，API與Auth synthetic，沒有真worker/provider呼叫。fixture中審計tab字樣及manager權限誤判已修正，不列產品缺陷。

另以actual `retryJob` SQL在full85 owned DB驗1 PASS：註冊handler `ai.knowledge.repair@1`、原合法payload，兩個併發retry只有一個成功，同job/idempotency/payload保留、attempt2/max3、原job queued，只有一筆同交易audit；再次retry queued不生新job/audit。只替換wake port記錄呼叫，零真wake。這證明SQL identity/state/audit，不等同真JWT／provider/worker驗收。

## 最終檢查、配置及交接

同一程式SHA：owned browser48、property SQL6、Ops SQL1、control-plane105全部 PASS／0 SKIP；properties Node29＋Bun27、operations Node17＋Bun8 PASS。typecheck、lint、build分開exit0，lint僅3個既有warnings。新的CI必須在PR head重跑，不把舊102 owned aggregate改称此SHA結果。

這兩批沒有新migration、DTO、runtime/provider ID、production flag/config差異；85版本owned基準沿原四個additive migration dry-run。全程零production mutation／真send／paid model call。舊獨立review的四Important／一Minor fix紀錄保留；本批為focused self review與單獨驗證，不冒稱已重做獨立review。

CSV直接與實作包原檔比對：原22任務、60歷史cases與22 NEW、29 PASS／9 FAIL／22 BLOCKED及1400 action IDs保留。發現先前trace bookkeeping替換了原 planned environment/blocker；本批從原CSV恢復這兩欄，新增 `execution_environment`／`execution_blocker`保存本輪讀回；UAT原execution欄依設計更新。新execution仍40 PASS／28 PARTIAL／14 BLOCKED，沒有以看到控制項推論action PASS。

回退可逐一回退兩個聚焦app提交；保留原CAS／protected edits、receipt、dirty requests、jobs/audit及outbound intents。未知結果先查原job/operation，不換ID重送。不要以整庫restore撤銷回退期間的新合法資料。全產品仍NOT_READY；本地兩項修復READY，真Auth/Blob/worker及完整role/route驗收BLOCKED。
