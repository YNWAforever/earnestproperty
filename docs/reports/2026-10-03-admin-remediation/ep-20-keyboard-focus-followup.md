# EP14/20 鍵盤焦點及 deferred close 修復讀回

Source `83b28eb7a608144728699772f1b7f86d95e67857`，BASE `20ab7863fb3fff491629bdb6c6d2bfd6131324c9`；本輪修正 controlled AdminDetailPanel 關閉後失去 opener 焦點，並讓延遲舊 close callback 只消耗自己的 DOM 面板記錄。手機/平板 Escape 或鍵盤關閉可回到原對話按鈕；重新開啟保留中文/英文草稿，晚到 AI response 不重開面板或搶焦點。

有效 RED：原路徑12 collected／6 desktop PASS／6 mobile-tablet FAIL；獨立 Astra 審閱 C0/I1/M1 的 Important 另有4 collected／2 PASS／2 FAIL。第一版 held-event harness4PASS會讓 Radix default fallback 提前補焦點，不當 RED；diagnostic 與有效 RED 都保留。作者只做一輪 fix，未二次派 reviewer。最後 full WhatsApp64PASS（原48＋新增16）及 daily92PASS，零 FAIL/SKIP；team95Node＋31Bun、command-centre83Node＋8Bun 通過。lint0 errors／3既有warnings，typecheck與build分開exit0。提交前 suite 的 codeSha 為BASE，app WeakMap component與本提交相同。test hook null listener no-op/type narrowing在64PASS後補上並freshtypecheck0；publisher16及 exact-head CI64另驗最後test bytes，記本輪 publication readback。

實際 TanStack routes、AdminShell、staff store 與 Radix；Auth/API 是 owned synthetic adapter。SQL、真Auth、provider/model/nativeIME、同一 browser＋SQL Golden、各role/跨scope與全controls不能由此宣告通過。Deferred minor P3：既有新測試只驗 interior Tab/ShiftTab 留在面板，未跨首尾證明 trap wrapping；不當完整 trap 驗收。

配置/migration dry-run：本輪無 SQL、DTO、server、配置或 provider 變更。85 immutable Git migrations digest保留，latest20261003040000；不捏造下一版本/runtime/model IDs、不apply production SQL。見 ep20-keyboard-config-migration-dry-run.json。正式 native schedule仍 baseline1/3、修复0/3、agenttrigger0；120/20/45/10及04:17HKT不重定義。Property.hk EPS/EPT/EPW/dt/full terminal/detail/media gate及132 held候選不變。真canary recipient/scope/count/budget沿 EP21已具體列出的提案，尚未執行。

兩份CSV各追加5個 dated execution欄；旧Trace39欄、UAT30欄逐cell不變，execution-evidence原37 roots保留。原29PASS/9FAIL/22BLOCKED、22 plannedNEW、40/28/14、1400 candidates（68business＋1332source）、408歷史rendered observations不變；source候選與skip不升格。

歷史證據限制：daily harness舊版未讀新prefix，本輪首次92PASS重寫1份舊summary；original hash299e12e8e6f29a0b54464317f899e7ddc12e68596f3fd3c2a984ecdefd17bda7保留，但原bytes無法從兩個isolated checkout或現存精確hash summary副本復原，不再引用為有效歷史proof。新run保存ep20-keyboard-daily-initial-summary.json及raw log；daily summary與12PNG輸出已改phaseprefix，後續跑完驗hash。先前27PNG限制保留，46EP21 raw hashes全部一致。未改原hash、原status或偽造舊bytes。

Capability：這輪owned keyboard focus/draft return READY；完整EP14/20角色、全controls、同鏈Golden NOT_READY；trueAuth/nativeIME/provider/model/PropertyHK/native schedule/production release BLOCKED。正式staging skip仍BLOCKED。真發送、應用模型費用、production migration、手動deploy、merge、native trigger均0。

Rollback：只revert本輪focused UI source commit；無schema/config需rollback；保留所有日期證據，不reset先前修復或無關lock/generated改動。

Rulings：

1. True authentication and server authorization — Keep synthetic Auth/API proof distinct; formal gate BLOCKED. — cost if wrong: Synthetic scope checks cannot establish real session authorization.
2. Owned PostgreSQL and combined Golden journeys — No DB edit; prior ownedPG proof stays separate from this actual-route browser. Full combined acceptance NOT_READY. — cost if wrong: Separate layers can miss integration defects.
3. Real providers/models/message delivery/production — No invocation or budget; IDs unknown and formal gates BLOCKED. — cost if wrong: Live runtime behavior and costs remain unverified.
4. Native mobile keyboard and IME composition — Chromium viewports only; nativeIME gate BLOCKED. — cost if wrong: Device-specific focus/viewport effects may differ.
5. Earlier EP13-21 findings and unrelated lock/generated changes — Previously reviewed scope retained; unrelated dirt unstaged. — cost if wrong: New focused review cannot reaffirm every old code path.
6. Overall build/lint/typecheck and other suites — Author independently runs existing scripts and preserves raw logs; reviewer did not rerun. — cost if wrong: Author verification has no second independent execution.
7. New fallback destination if opener disappears — Shared panel rejects detached/nonfocusable opener and retains newer focus; no route fallback invented. — cost if wrong: If original opener disappears focus may remain body; role/scope-specific fallback needs consumer policy.
8. Evidence phase prefix採安全新名稱，保留舊metadata；代價是期待舊summary檔名的外部讀取者須使用新readback。當前package/CI stdout計數未依賴舊檔名。
9. 歷史1summary原bytes unavailable明示，不能重建為已驗原件；代價是該歷史proof不可用，current92及後續fresh證據獨立保留。
