# Master plan execution reconciliation — 2026-10-04

核對 master plan `.audit/remediation-20261003/supplied-plan.md` 全部 EP-00–21 的 Steps、Interfaces、dependencies，以及兩份 CSV 的 execution 欄。此文件是現有執行證據的 reconciliation；原計劃 checkbox／原審核狀態不改寫為已驗收。

核對 baseline：implementation `110a8cee8a9ce0260474619121aedf006fe8fdc4`，own publisher `64a31b9da4b212b3179bc89978f559b8b083c5b7`，remote main `51cb0e9c08269ebabeb0b593d4dea611b9246c32`。兩個 owned checkout 的 tracked source 同步；僅原有 `bun.lockb` 未提交。TanStack Start/React/Neon raw SQL，沿用現有85 migrations；沒有新增 production migration/config/provider/runtime ID。

當前22 tasks：8 LOCAL_VERIFIED、11 LOCAL_PARTIAL、1 BLOCKED_ACCEPTANCE、1 BLOCKED_EXTERNAL、1 BLOCKED_RELEASE。LOCAL_VERIFIED 只表示相應本地契約，不代表完整正式 capability READY。原60 cases 29 PASS/9 FAIL/22 BLOCKED、22 planned NEW、execution 40 PASS/28 PARTIAL/14 BLOCKED、82 cases、1400 IDs（68 business/1332 source candidates）、408 歷史 render observations 保留。

| Task | 現有 execution layer | 已有實作／證據 | 尚欠驗收／工作 | 既有證據 |
|---|---|---|---|---|
| EP-00 | LOCAL_VERIFIED | 隔離 baseline、暫存編譯競態、安全掃描 | 正式 app/worker/schema SHA 未確認 | `docs/reports/2026-10-03-admin-remediation-baseline.md` |
| EP-01 | LOCAL_VERIFIED | 正常／fallback canonical read gate、完整 revision | 正式 read gate 啟用、真 model 語義驗收 | [independent-review-resolution.md](independent-review-resolution.md) |
| EP-02 | LOCAL_VERIFIED | durable invalidation/rebuild、commit/restart/replay | 正式 worker 運行及 embedding/model budget | [independent-review-resolution.md](independent-review-resolution.md) |
| EP-03 | LOCAL_VERIFIED | strict enums/action、test/missing-contact eligibility | 真 provider/model contract quality | [ep-03-crm-contract.md](ep-03-crm-contract.md) |
| EP-04 | LOCAL_VERIFIED | request/save/apply actor/scope/source、run provenance；37 owned SQL | 正式模型輸出及人工 apply journey | [ep-04-cited-source-transition-readback.md](ep-04-cited-source-transition-readback.md) |
| EP-05 | LOCAL_VERIFIED | 分析 method/status/cost、錯誤恢復、deterministic urgency | 真模型 usage/cost 完整讀回 | [ep-14-ai-recovery-readback.md](ep-14-ai-recovery-readback.md) |
| EP-06 | LOCAL_PARTIAL | 分 source/channel、staff/Folder/review preview 與 owned save/readback | 正式租戶 verified scopes、Folder、provider user、review；真 Auth | [ep-15-local-readback.md](ep-15-local-readback.md) |
| EP-07 | LOCAL_PARTIAL | Golden A、receipt/CAS/replay/unknown/restart；普通 portal 零 EPWA | 真接單→指定職員通知→回覆的 provider receipts | `docs/reports/2026-10-03-admin-remediation-verification.md` |
| EP-08 | BLOCKED_ACCEPTANCE | 120/20/45/10 分段、04:17 HKT 配置及 private/recovery 契約 | 完整 private receipt 讀回；三次修復後 native schedule 目前 0/3 | [ep-11-source-recovery-readback.md](ep-11-source-recovery-readback.md) |
| EP-09 | BLOCKED_EXTERNAL | EPS/EPT/EPW/dt paging、403/partial/index-only full gate | 獲准真 scope page1→terminal＋detail/media；403 不能作撤盤 | `docs/reports/2026-10-03-propertyhk-access-and-scopes.md` |
| EP-10 | LOCAL_PARTIAL | owned publication/source identity positive fixtures | 依 EP-09 真 full scopes 及 EP-06 verified mapping 完成接單 | [ep-10-owned-publication.md](ep-10-owned-publication.md) |
| EP-11 | LOCAL_VERIFIED | withdrawal preview/confirm 版本與 sibling/manual override 保護 | 正式 full/comparable absence；132 歷史候選保持 held | [ep-11-source-recovery-readback.md](ep-11-source-recovery-readback.md) |
| EP-12 | LOCAL_PARTIAL | scoped/as-of 今日待辦、partial error、same-filter keyboard；本次補 Leads session 隔離 | 真 Auth deep-link/expiry/logout/revocation、全部 roles/route/branch-only 變更 | [ep-12-daily-work-readback.md](ep-12-daily-work-readback.md) |
| EP-13 | LOCAL_PARTIAL | property/media/bulk actual route 保存讀回及 conflict/protected edits | 正式 media、完整 role/flag/property 操作矩陣 | [ep-13-19-local-readback.md](ep-13-19-local-readback.md) |
| EP-14 | LOCAL_PARTIAL | 四 viewport 手機 Inbox/AI error/late response/draft focus | 真 IME／裝置、provider 接單／回覆 | [ep-14-ai-recovery-readback.md](ep-14-ai-recovery-readback.md) |
| EP-15 | LOCAL_PARTIAL | staff setup 候選、同名/empty/outage/denied、owned request recovery | 正式 provider member/Folder/session/save 能力 | [ep-15-local-readback.md](ep-15-local-readback.md) |
| EP-16 | LOCAL_PARTIAL | 50-row links preview/chunk/result/CAS/recovery、campaign cancel 原 request 恢復 | native clipboard、真指定推廣受眾/recipient/budget/發送 | [ep-16-campaign-cancel-readback.md](ep-16-campaign-cancel-readback.md) |
| EP-17 | LOCAL_PARTIAL | 88 owned SQL／164 synthetic browser；qualification final source、quality CAS/recovery | 真 Auth/provider attribution、全部 report/filter/time/concurrency 組合 | [ep-17-qualification-replay-readback.md](ep-17-qualification-replay-readback.md); [ep-17-performance-read-actor-readback.md](ep-17-performance-read-actor-readback.md); [ep-17-qualification-readback-recovery.md](ep-17-qualification-readback-recovery.md); [ep-17-quality-recovery-cas.md](ep-17-quality-recovery-cas.md); [ep-17-qualification-final-source-gate.md](ep-17-qualification-final-source-gate.md) |
| EP-18 | LOCAL_VERIFIED | 0/10/1k/10k/100k bounded reads、cursor/ties/ACL；7 owned DB | 正式資料分佈負載與 latency（未以 local fixture 冒認） | [ep-18-bounded-conversation-assist.md](ep-18-bounded-conversation-assist.md) |
| EP-19 | LOCAL_PARTIAL | 分階段 timestamps/counts、original run/hash recovery、unknown only read original intent | 正式 worker/provider/schema alignment、terminal support recovery | [ep-11-source-recovery-readback.md](ep-11-source-recovery-readback.md) |
| EP-20 | LOCAL_PARTIAL | Golden A/B/C 23 owned PASS、85 migrations、8 DB actors、pg_dump clone/restore/replay | 真 Auth＋UI＋PG＋provider 同旅程、全部1400 action mappings；未覆寫29/9/22 | [ep-11-source-recovery-readback.md](ep-11-source-recovery-readback.md) |
| EP-21 | BLOCKED_RELEASE | 聚焦 commits、draft PR、config/migration dry-run、blocker/rollback runbook | 依 EP-20＋EP-08 正式 canary/release 授權及驗收 | `docs/reports/2026-10-03-admin-remediation-release.md` |

本次繼續 EP-12 step4：真實 Leads route 在 Auth user object 沒有改變、僅職員 role/binding 變動時，未訂閱 staff identity，原列表及 selection 可保留。共享 shell 在 lookup unknown 亦放行私人 children/header actions。已用穩定 Auth user 的 synthetic fixture 重現六個 RED（降權、重綁、late success、late403、unknown verification、initial pending）。最小修復按既有 user/staff/sorted roles 重建 Leads workspace；未核實時不掛載 Leads reads，shell 隱藏私人 presentation 並提供重新檢查。沿用 server ACL 及 actor-keyed forwarded draft；分層驗收見本次 EP-12 報告，完整 EP-12 仍 PARTIAL。

Dependencies 首批00→01→02→03→04及18→05已具本地實作。EP-10 的真來源分支依09/06，EP-21正式 release依20/08；不以缺 Property.hk/provider/model budget 停下獨立本地修復。EP-20 owned restore/replay 已有 PASS，不重做並不冒稱 production restore；TEST-58 新 execution PASS 與原狀態並存。

Capability：本地 deterministic/owned DB/readback 契約按個別 evidence READY；EP-12/role-route exhaustive acceptance、三次修復後 native schedule 為 NOT_READY；真 Auth/provider/Property.hk detail-media/model budget、正式 app/worker/schema alignment 及 production release/migration 為 BLOCKED。普通 portal 零 EPWA、原 parser/receipt/CAS/Inbox picker/草稿隔離、source/account/branch/ad/offer/canonical、protected edits、receipt/outbound intent 歷史保留。

28Hse 原生台帳保留 baseline1/3、repaired0/3、agent-triggered0；自然 workflow37160712576 success 尚未讀到完整私人 receipt，不提升 acceptance。Manual/replay/skip 不是 schedule。Property.hk403/漏頁/index-only 不是 absence；132 candidates held，其他來源有效 offers 及人工 override 一同核對。

Formal 調整仍須具體可審閱目標／差異／recipient/count/budget。此 continuation 未 merge、deploy、send、花費 application-model budget 或套 production migration。

本次 source4f91ec4＋3c14cd0完成 EP-12 step4 的選定 scope／unknown gate／過期 action continuation 修复。唯一 review Important 已由作者一輪 RED→GREEN 修正，沒有二次審閱；最終92 UI、115 shared UI、4 owned SQL及分開 typecheck/build 通過。完整 EP-12仍 PARTIAL，詳見 [ep-12-session-workspace-isolation.md](ep-12-session-workspace-isolation.md)。


EP13 continuation BASEf220fce5dbf9c6737e3961f69abeb6b0e543ebfb→source82a03ec470faaffdcc1d759292b943e6d4823fed: selected step4 property scope/lifetime gap red20UI/2pure→exact136UI/115shared/20Ops/40staff/6ownedSQL/29Node+30Bun;separate staticPASS. Resolved membership gates current list/editor, stale callbacks stop bulk/link/save/upload continuations and preserve accepted effects. One sampled wholebranch review C0/I1/M0, author fixedI1, no secondreview; all declinedrulings recorded. FullEP13 remainsLOCAL_PARTIAL/NEW13PARTIAL; task counts/status baselines preserved. Details: [ep-13-property-scope-lifetime.md](ep-13-property-scope-lifetime.md).

EP13 CI compatibility continuation test74873e076ef9c7c04b3b39ddb1b24cca74c42d03/runtime82a03ec470faaffdcc1d759292b943e6d4823fed: exactCI37193043713 only stale cancellation regex fails;209SQL/648UI per-layer PASS retained without overall promotion. Actual local RED81/1→GREEN82Node+8Bun and159Node+9Bun. Explicit dual guard on all three settled paths; runtime unchanged, new exact CI pending, statuses unchanged. [Details](ep-13-ci-contract-readback.md).

EP13–20 development source `39d21a294a67e84c4f71c15abb62b658803926fc`: resolved workspace and post-credential dispatch gates; preserved accepted property/media/mapping/job/outbound/batch effects; delayed handoff/journal/child continuation regressions fixed. Final732 fourviewport UI/209 ownedSQL/12 named unit suites and separate static checks PASS. One review C0/I4/M0, one author fix pass, no second review. Existing task/baseline/execution columns stay unchanged; new dated execution columns append. All seven declined author rulings, config/registry/schema dry-run, rollback and 27 historical PNG hash mismatch limitations are explicit in [EP13–20 report](ep-13-20-development.md). Full tasks except selected bounded EP18 remain PARTIAL; true Auth/provider/model/Property.hk/native scheduling/release gates are not promoted.

EP13–20 first exactCI37203311589 at5491dba failed; author compatibility and actual resize-race repairs source `308099a38815543789b486840dca63a1180c8894`:643MLS/14handoff/115legacy/180affected actual-route UI plus final named units/typecheck/lint/build PASS. First CI ownedSQL232 PASS (209prior+23no-link). Four deterministic resize cases RED→GREEN; prior732snapshot preserved; next expected fullmatrix736. All prior ledger fields/root entries retained; new dated compatibility columns append. See [CI compatibility readback](ep-13-20-ci-compatibility-readback.md); no full acceptance/native/release promotion.


EP21 offline checker source `b157b66cd4b061d0306c90a22a788384d4974216`：實際RED分層及唯一審閱C0/I2/M0的一輪作者fix後123PASS/0FAIL/0SKIP；lint0errors、typecheck/build分開exit0。候選app subjectf985cad 的實際CI37205841916/preview success與85 immutable Git migrations獨立讀回；CLI expected2/actual2，productionAuthorized:false，正式EP21維持BLOCKED_RELEASE。已補非零completed canary receipt及native first-attempt/originalreceipt binding，防schedule event保留的manualrerun。新CSV五日期欄保留所有旧cells，execution-evidence新增root保留旧roots；原29/9/22、22NEW及40/28/14不變。無app/config/schema/provider/send/model/prod變更；baseline native1/3、修復0/3、新trigger0，既有27PNG歷史限制保留。見[EP21分層交接](ep-21-release-readiness.md)。


EP14/20 keyboard follow-up source `83b28eb7a608144728699772f1b7f86d95e67857`：original RED6focus failures及deferred-close validRED2後，shared DOM-owned opener回復；WhatsApp64/daily92、team126/commandcentre91/static PASS。新dated CSV5欄保留39/30旧欄及37 evidence roots。local bounded keyboard READY，fulltask NOT_READY，formalexternal BLOCKED；minor trapboundary未验。新增1歷史summary原bytes不可用明示，27PNG限制保留；全部oldstatus/hashmetadata保留。詳細見[本輪焦點讀回](ep-20-keyboard-focus-followup.md)。


EP14/20 composition follow-up `283a887f955aa0f15652963554ae6136469eb7aa`：有效RED8compositionFAIL/4positivePASS後，fullWhatsApp76、159Node+9Bun與separate static0；owned DOM composition和modal first/last wrapping READY（前輪P3 boundary本地驗證已補），fulltask NOT_READY/nativeIME和formalexternal BLOCKED。追加CSV5dated欄保留44/35原欄及38oldroots，old46/68/27hashes一致；歷史27PNG+1summary限制保留。本輪無server/DTO/config/SQL/provider變更或production effects。見[本輪組字讀回](ep-20-ime-composition-followup.md)。


EP12/14/20 Leads continuation `32156f8abfa6e4df47c1eab32cc5be8445006da6`：初始RED12FAIL4PASS、覆核resetRED16FAIL後full124及publisher32PASS；C0/I1/M0一次覆核、作者單pass關閉Important。選定owned組字/重設/較新filter READY；fulltask NOT_READY/nativeIME與formalexternal BLOCKED。追加CSV5dated欄保留49/40欄及39roots，198舊raw hashes一致；歷史27PNG+1summary限制不變。無serverDTO/config/SQL/provider變更或productioneffects。見[Leads讀回](ep-14-leads-ime-followup.md)。


Production schema continuation 2026-10-05：4份existing main29e839e additive SQL在exact human approval後套用指定Neon production；81→85、獨立catalog與ownedNeon18.6相同、84legacy tables/9628rows fingerprints一致、exact-main GitHub37232450305 drift success。CSV追加5dated execution欄及execution-evidence第41root，所有旧cells／40roots保留，原29/9/22＋22planned NEW不提升。Schema parity READY；完整roles/Golden/native3daily NOT_READY，真Auth/provider/model/Property.hk及整體release仍BLOCKED。agent sends/model/worker/native/manualdeploy0；backup至2026-10-12 04:07:40HKT，回退保留additive schema及新accepted資料，不作production restore。舊本回合未套migration／禁止production的段落是相應歷史紀錄，本次exact4授權及實際執行見 [正式schema讀回](production-schema-repair-2026-10-05.md)。
