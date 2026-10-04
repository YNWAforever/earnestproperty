# EP14/20 中文搜尋組字修復及 modal wrapping 讀回

Source `283a887f955aa0f15652963554ae6136469eb7aa`，BASE `ac30bf95ab92a5911bd89e0b7722d380a494babc`。搜尋欄原有300ms debounce會在中文組字停頓或組字前已排程timer時，把尚未確認的候選字提前寫到URL與讀取API。本輪加入同步ref阻擋queued callback及React state取消effect timer；compositionend讀最終DOM值並重新啟動debounce，最終文字沒變仍能搜尋。普通英文trim、對話草稿、焦點和原讀取資格保留；未改server、DTO、SQL或provider。

有效 RED12 collected：8 composition FAIL（URL提前出現合成客戶）、4既有modal boundary/desktop controls PASS，零skip及harness failure。RED afterAll JSON在failed-worker restarts後只有最後1PASS，明確標作partial；12case計數只引用完整log與8errorcontexts，未重建或改寫該JSON。修正後full WhatsApp76PASS（原64＋新增12）；4個viewport390/768/1280/1440均驗組字停頓、待執行timer、same-value end、英文trim及草稿焦點。另驗actual modal最後Close Tab→first、ShiftTab→last，關閉前輪P3未跨首尾的本地驗證缺口；desktop inline為positive control，沒有改Radix trap runtime。159Node＋9Bun WhatsApp tests通過；lint0 errors/3既有warnings、typecheck及build分開exit0。suite codeSha在提交前為BASE；本提交Git blob與實際source bytes逐檔比對，publisher/exact-head CI另記publication。

一次獨立Astra finalreview C0/I0；完整回覆、Minor及Declined-to-judge作者rulings存raw/JSON/ledger。這份證據採實際TanStack route和AdminShell，owned synthetic Auth/API，DOM CompositionEvent/InputEvent和Playwright controlled clock。它證明browser state machine，不能當OS/native keyboard、真Auth/SQL/provider/model、完整各role/action、同鏈Golden或production验收。

Config/migration dry-run：無SQL、DTO、server、config/provider delta；85 immutable Git migrations digest不變，latest20261003040000；只沿用舊registry readback，不apply production SQL、不捏造下一migration/runtime/provider/model IDs。Formal native schedule baseline1/3、修復0/3、agenttrigger0；120/20/45/10及04:17HKT保留。Property.hk EPS/EPT/EPW/dt/terminal/detail/media、403/partial/index-only不可當撤盤、132 held候選保留。真canary recipient/scope/count/budget沿EP21具體提案仍未執行。

兩CSV追加5個dated execution欄；Trace原44欄/UAT原35欄逐cell不變，execution-evidence原38roots保留。原29PASS/9FAIL/22BLOCKED、22plannedNEW、40/28/14、1400 candidates(68business+1332source)、408historical observations不變；候選controls、skip及planned NEW均不升格。前輪27PNG與1份daily summary原bytes不可用限制仍明示，原hash/status metadata保留，不重建成已驗原件。本輪所有phase檔名隔離，無新增覆寫；46EP21、68keyboard和27keyboard-publication raw hashes一致。

Capability：本輪owned DOM composition及選定modal wrapping READY；完整EP14/20角色/actions/combinedGolden NOT_READY；nativeIME/trueAuth/provider/model/PropertyHK/native schedule/production release BLOCKED。真發送、應用模型費用、production migration、手動deploy、merge及native trigger均0。

Rollback：只revert本輪focused IME source commit，無SQL/config需rollback；保留此前修復、accepted-write journals/receipts、歷史證據和無關local dirt。

Rulings及代價見ep20-ime-progress.md和ep20-ime-final-review.json；待判項與Minor不隱藏為PASS。
