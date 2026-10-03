# EP-14 AI 建議故障恢復、延遲回應及草稿補驗

程式提交 `a13e9187a76b0d3c379a43130a5ccc1975a00085`。EP-05／14 的產品差異僅在現有 WhatsApp route 及 WhatsappAiSuggestions：保留原 conversation/request generation guard、per-actor/per-conversation drafts、overwrite confirmation、outbound journal；新增錯誤 state、只讀重試 callback 及失敗／載入中時不能套用舊建議。既有 AdminConversationAiAssist DTO 不变；沒有新 schema、migration、provider ID、production config 或 paid model call。

## RED → GREEN 及診斷界限

有效 RED：1280 真 route 收到 synthetic AI read outage，建議面板沒有 failure alert，只顯示「此對話暫未有建議」。修改前1 FAIL。GREEN：顯示安全的「未能載入建議」與44px重試入口，不外露底層 error/reference；重新載入沿原 conversation read function，恢復後不清人工草稿、reload仍讀回。成功的 null 結果維持正常空態，沒有虛構 failure 或分析。

最初巢狀 details selector失敗是fixture問題，未計產品 RED。第一輪產品 GREEN有26 PASS及兩個 keyboard assertion失敗：Chromium border intersection為0.991，不足一個CSS pixel；改為0.99 intersection、一 pixel可見邊界與trial click hit-test，沒有改產品佈局，也沒有以真send驗可操作性。

共用115 runner首次114 PASS／1 contact1280 readback timeout；不能據此判定新產品回歸或已證編譯競態。單獨診斷1 PASS／114 filtered；filtered仍不作全量成功。已確認兩runner可重写同一編譯輸出，新suite改用固定且受assert限制的 `.audit/no-link-browser-mobile-ai`；原runner仍用原目錄。之後完整serial115和mobile28均PASS／0 SKIP。單一contact timeout未再重現，原因未證實；若再次出現，保留原診斷並調查，不加自動retry掩蓋。

## 四尺寸及獨立讀回

1440／1280／768／390各7情境，共28 PASS／0 FAIL／0 SKIP。使用actual admin.whatsapp、AdminShell、composer、detail panel、AI component及CSS。Auth、rules API與provider model是explicit synthetic；owned loopback只容許GET/HEAD，mutation/external request禁止，outbound adapter calls及其他mutation calls各0。

覆蓋故障→明確重試、成功null空態、A→B的晚到成功／error、A→B→A時同conversation較舊request被拒、草稿與focus保留、overwrite取消／明確接受及reload讀回。540px height是虛擬鍵盤等效高度；長中英文草稿、late result後focus、send trial hit-test及手機close44×44／Escape／重開草稿都通過。這不是原生OS IME驗收；只有synthetic agent-a，不能推論8個真Auth sessions或所有roles／flags。

同一程式SHA完整覆驗：mobile28及shared real-route115 PASS／0 SKIP；no-link Node99＋Bun9、woztell／AI component Node159＋Bun9 PASS；typecheck、lint、build分開exit0，lint3 baseline warnings。原owned102／104及上一PR-head105、115／14／48／40各自記錄的歷史SHA保留，不把新28當新owned SQL。這批沒有SQL mutation變更；PR-head full85 owned suite再讀回，真 Auth／SQL／browser combined journey仍待驗。

## ACT 對照與未完成能力

ACT-27「查看及套用回覆建議至草稿」有明確操作、覆寫取消／接受、reload及zero-send assertion，新增LOCAL_PARTIAL。ACT-S-0148原Button候選對到該實際操作，與ACT-27是同一logical action，不雙倍計算。ACT-S-1079是caller component occurrence，只對回AiAssistPanel→WhatsappAiSuggestions，不標為另一個已驗按鈕。新retry沒有捏造原audit ID；原1400 IDs／分母及baseline欄位保持。[逐列局部動作證據](mobile-ai-action-execution.csv)。

兩份CSV原29 PASS／9 FAIL／22 BLOCKED及22 NEW保留；execution仍40 PASS／28 PARTIAL／14 BLOCKED。TEST-33／47僅既有本地層次，NEW-05／14／20仍PARTIAL，TEST-49仍BLOCKED。歷史408 rendered observations不被新操作覆蓋；G09／G11仍NOT_READY，無法從scenario PASS推論每個source control均已操作。

## Dry-run、review與回退

本批 schema／migration／production config／provider差異零。focused self review及本批regression evidence，不延伸舊independent review。回退本批presentation可回前一兼容UI；保留actor/conversation draft keys、request generation、receipts、original outbound intents、protected edits與EP-15原試送journal，不重發或清除unknown。

本批本地錯誤呈現及草稿行為READY；全產品NOT_READY，真Auth／native IME／provider／model品質／全route-role-flag gates另列BLOCKED或待驗收。28Hse仍baseline native1/3、修復正式0/3；Property.hk真detail/media仍BLOCKED。沒有merge、部署、正式migration、真發送或paid model spend。
