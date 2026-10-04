# EP12/14/20 Leads 組字、搜尋重設及篩選讀回

Source `32156f8abfa6e4df47c1eab32cc5be8445006da6`，BASE `9c1a323192257675311cbd2bad364d49a2c89be1`。Leads原300ms搜尋timer會把未確認中文候選字提前寫入URL/API；延遲搜尋亦會將較新的stage改回舊值。本輪加入組字state與同步ref、compositionend最終DOM值，以及完整filter snapshot重啟debounce，保留既有cursor與workspace隔離。

有效首輪RED16：12FAIL（8組字、4stage）、4既有scope replacement PASS；首輪108GREEN。一次獨立final review C0/I1/M0找到同流程舊有residual：URL尚無query時，重設/清除篩選沒有清pending draft。作者唯一修正pass先取得16真RED（兩入口×pending/composing×四viewport），再加入共用reset：清draft/組字並同步提升reset revision，使舊callback在passive cleanup前亦失效。原覆核assessment保留，沒有第二次review或merge授權。

最終full daily-work124PASS/0FAIL/0SKIP（原92＋32新）；publisher獨立32PASS。390/768/1280/1440均驗samevalue end、sameidentity、workspace replacement、保留較新stage、兩reset入口、晚到compositionend及清除後英文搜尋。新32case未寫acceptednote/leadupdate/outbound；原92包括owned synthetic note正向用例，不能把整個124稱為零API mutation。命名units83Node＋8Bun及159Node＋9Bun通過；最終lint0errors/3既有warnings、typecheck/build分開exit0。每階段使用獨立檔名；RED afterAll JSON因failed-worker restart屬partial，完整logs與12＋16errorcontexts是RED依據，沒有重建或覆寫歷史JSON。

證據採actualTanStack route/AdminShell、owned syntheticAuth/API、DOM事件與controlledclock。只證明URL/API args與browser state；不證明真SQL搜尋、native OS IME、真Auth/provider/model或combinedGolden。所有Declined-to-judge與作者ruling/代價明錄；build是作者完成讀回。獨立publisher及exact-headCI另分層，提交前codeSha仍為BASE，以source Gitblob逐檔比對測試bytes。

Config/migration dry-run無SQL/serverDTO/config/provider delta；85 migration Gitblobs digest unchanged，latest20261003040000；registry沿舊readback，不捏造下一版本/runtime/provider IDs。28Hse120/20/45/10與04:17HKT保留，nativebaseline1/3、修復accepted0/3、trigger0；Property.hk EPS/EPT/EPW/dt/page1→terminal/detail/media仍需真驗，403/partial/index-only不可当撤盤，132候選held。原普通portal零EPWA、receipt/CAS/草稿/links/picker/身份/protectededit/outbound intents保留。

兩CSV只追加5dated欄，保留原49/40欄逐cell及39executionroots。原29PASS/9FAIL/22BLOCKED、22plannedNEW、execution40/28/14、1400候選（68business＋1332source）、408歷史觀察不變；NEW/candidate/skip均未升格。198舊raw hashes一致；歷史27PNG及1summary原bytes不可用仍保留限制/metadata。本輪12＋12階段PNG真bytes留存，但screenshots只佐證原session用例，不冒稱nativeIME按鈕證據。

Capability：選定owned Leads組字/重設/較新篩選READY；完整EP12/14/20角色/動作/combinedGolden NOT_READY；nativeIME/真Auth/provider/model/Property.hk/native schedule/production release BLOCKED。真發送、應用模型費用、production migration、manual deploy、merge/native trigger均0；已有canary/model具體提案仍未執行。

Rollback只revert本輪focused Leads source commit，無SQL/config rollback；保留此前修復、receipt、accepted-write journals、各階段證據及無關local dirt。來源/rulings/hash見ep14-leads-ime-readback.json；發布最終結果另見ignored publication readback。
