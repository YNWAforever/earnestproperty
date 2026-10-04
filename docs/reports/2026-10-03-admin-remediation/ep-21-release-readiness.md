# EP-21 發布證據 checker 與交接讀回（2026-10-04）

本次新增 offline checker 已完成本地實作；EP-21 正式驗收仍為 **BLOCKED_RELEASE**。本輪沒有 app/server/worker/config/schema 變更，沒有真發送、application-model 花費、production migration、manual deploy、merge 或 native schedule trigger。

Assessor source：`b157b66cd4b061d0306c90a22a788384d4974216`。固定證據 subject：`f985cad43c0c327201ebbd3b18bf414f655f37e7`；[CI37205841916](https://github.com/YNWAforever/earnestproperty/actions/runs/37205841916) 與 Vercel preview metadata 已獨立讀回 success。這是此前 app source 的證據，不稱為新增 checker 發布 head 的 CI；新 head 狀態另記 PR。固定 snapshot 隨時間可能失效，不延長 timestamp 或改稱已正式驗收。

原 checker 只核 passed/SHA/URL，能把 synthetic role/provider、手動 schedule、未知 runtime/model budget、來源控制項候選與有風險 rollback 接受成 review-ready。新增 `earnest-admin-remediation/v1` packet 按 G00–G11及 capability 驗證，CLI 必須提供完整 `--expected-commit`。對應 Git commit 的85份 SQL filename＋Git blob identity 產生獨立 SHA256 manifest；schema 最新 `20261003040000`，control-plane registry1 仍另列。沒有捏造下一 migration 或 runtime/provider IDs。

```powershell
npm.cmd run test:control-plane
npm.cmd run ops:release-readiness -- --evidence docs/reports/2026-10-03-admin-remediation/ep21-release-evidence-packet.json --expected-commit f985cad43c0c327201ebbd3b18bf414f655f37e7
```

第二個命令預期 exit2：owner未指派、正式 gates 未達標，`productionAuthorized:false`。此工具核對 operator packet 的 shape/commit/layer/時效，不會連 provider/DB、讀 credential 值、執行 mutation 或驗證 remote URL 的內容；證據本身須 owner 獨立讀回。無 recordKind 的舊 generic格式相容；本 remediation 必须用版本化格式，不可用舊格式代替 G00–G11。

RED／GREEN 原始 log hashes、每層環境、subject／assessor SHA、CLI expected/actual及零effects見 [readback JSON](ep21-release-readiness-readback.json)。首輪116 tests：106PASS/10FAIL，包含1個尚未存在 output shape 的正向 control，不把該項當產品缺陷；實際 negatives 修復後116PASS。第二輪120：116PASS/4FAIL→120PASS；JSON timestamp objects121：120PASS/1FAIL→121PASS。最终 123 PASS／0FAIL／0SKIP；lint0errors/3既有warnings，typecheck/build分開exit0。

獨立Astra審閱C0/I2/M0；兩項Important各RED→GREEN，123/121/2FAIL→123PASS。要求非零完成send＋同SHA/count receipt；native首次runAttempt1且receipt綁定原runId/attempt，不能接受保留schedule event的手動rerun。作者一輪fix，沒有二次審閱；reviewer獨立21 checker tests及2536 malformed mutations為修正前層，不當完整product CI。

| gate/capability | 本地層 | 正式層與下一步 |
|---|---|---|
| G01 static、G02 deterministic AI | READY | provider模型品質另列；沒有prod授權 |
| G03 Golden A、G10 clone restore/CAS/unknown/restart | READY，owned SQL | 真Auth/provider不是這層證據；正式worker/近期寫入須另讀回 |
| G05 Golden B | READY，owned SQL/provenance | NOT_READY；真provider/model/runtime、usage/cost/budget及15rubric runs未核實 |
| G06 Golden C/canonical/public AI | READY，owned SQL | NOT_READY；指定同盤真public browser/正式source讀回 |
| G09 四viewport角色/scope | READY，736 owned actual-route synthetic Auth/API | NOT_READY；真8 sessions／nativeIME／combined stack及全動作覆蓋未達標 |
| G08 28Hse | baseline1/3、修復正式0/3、agenttrigger0 | NOT_READY；3跨日native full private receipts＋逐盤public讀回，manual/replay不替代 |
| G11 coverage | 保留60核心／68business／1332source／408歷史observations | NOT_READY；source候選不計已驗按鈕，skip維持blocked |
| G00 deployment、G04 WA、G07 Property.hk | 離線/owned契約分層保留 | BLOCKED；正式app/worker/schema/flags、真tenant/testrecipients、EPS/EPT/EPW各dt terminal/detail/media待核 |

機器結果：本地 proof 分別 READY；全部正式 capability 目前 BLOCKED，因 G00 未齊及 monitoring owner 未指派；其中 UX/roles/coverage/28Hse native 分項 NOT_READY。Property.hk 的 G07 只依賴 Property.hk capability，已有 positive control確認獨立 propertyCore 不受該 gate 牽連。其他來源有效 offer／人工override及132held candidates沒有改动，403/漏頁/index-only不當撤盤。

具體下一步及owner仍沿 [既有 release handoff](../2026-10-03-admin-remediation-release.md)：release/DB owner核對四additive migrations及指定app/worker/flags差異；WA整合owner提供核實tenant/account/branch/channel/Folder和1個staff、1個customer測試身份與consent/window/template，最多1inbound、1assignment、1internalack、1staff-phone-test、1human-test-reply；AI owner提供actualprovider/model/runtime讀回及usage/cost evidence，EV04/05/09/11/12各3次、maxattempt1、最多15generation、proposalUSD5尚未授權。沒有實際身份／預算不真發送或付費模型；不能把公司CTA当testrecipient。盤源owner取得三次自然native及Property.hk完整scope，QA owner補真sessions/actions。角色owner不捏造已指派人名。

Rollback：逐scope停新effects，維持AI read gate，保留capture/receipt/outbound intents/dirty jobs/run provenance/人工protectededits和期間新寫入；unknown查原operation/receipt，只讀reconcile不盲重發。不對正式庫套全庫restore，既有additive schema保持兼容。回退offlinechecker只需回上一compatible code；沒有schema/config撤銷需求。

歷史：原29PASS/9FAIL/22BLOCKED、22planned NEW、execution40/28/14、原task statuses完全保留。新增 EP21 日期欄及 execution-evidence root，不覆蓋舊單元。此前27個PNG hash mismatch限制及原metadata/hash如實保留；本次不重跑或改寫舊artifact。本地raw EP21檔案採新namespace，每份hash存readback。SKIP＝BLOCKED。

本次 rulings：版本化admin格式與舊generic相容（代價：legacy不具有新gates，admin明確指定新格式）；offline packet validation不能取代真人/remote readback（代價：owner仍须審實證）；依用戶歷史證據要求保留workspace（代價：本地disk占用）。沒有 deferred minors。

審閱 declined rulings（每項保留代價）：

1. Earlier EP13–20 product fixes — Already reviewed completed scope; new checker reviewed in full branch context — cost if wrong: Earlier fixes are not newly independently re-reviewed.
2. Live CI/preview, production, provider/model/Auth/receipts — Candidate CI/preview independently read; all unknown real operational evidence remains blocked — cost if wrong: Operator claims require separate factual verification.
3. Actual model cost/latency and per-rubric results — Offline schema/declaration boundary retained; real runtime/usage/cost/15-runs are still an explicit gate — cost if wrong: True model quality and costs remain unverified.
4. Individual raw sync stage results — FullReadback attestation retains private receipt dependency; native first-attempt metadata and receipt binding now mandatory — cost if wrong: Stage contents still require source owner readback.
5. Receipt signing, URL reachability and authenticity — Offline packet tool performs no fetch or signing verification and never authorizes production — cost if wrong: Packet truth cannot be established by structure alone.
6. Legacy generic packet — Backward compatibility retained; remediation handoff mandates versioned contract and explicit candidate — cost if wrong: Generic callers do not get new admin gates.
7. Historical counts and action reconciliation — Old cells/root values frozen and independently compared; candidates and skipped formal gates not promoted — cost if wrong: Full underlying action audit remains incomplete.
8. Assigning operational owners or production authority — External handoff remains unassigned/blocked; no invented named owner or authorization — cost if wrong: Release cannot proceed until actual owner/authority supplied.
9. Full suite/static/build/CLI evidence independence — Author123 full-suite pass and named command logs separately recorded; reviewer21 checker cases/2536 malformed shapes pre-fix — cost if wrong: Independent reviewer did not execute full product/CI matrix.
10. Unrelated lockfile/generated artifacts — Explicit staging only two scripts and selected new reports; preserve all unrelated edits — cost if wrong: Unrelated local work stays outside this PR delta.
