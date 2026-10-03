# EP-16 推廣活動原提交恢復與帳戶隔離補驗

程式 `d89b94d4fbfe3f6401f8e02e47c7e0ea15fcb07e`；main重新讀回仍51cb0e9。產品差異只在admin.blasts：提交前保存per-user sessionStorage journal（version＋原campaignId）；同頁重載／離開再返回先核原Campaign，不新造server intent。帳戶切換重建workspace，舊queue response不更新新actor畫面／toast；原actor journal保留待讀回。儲存失敗零queue request。default grid指定單欄minmax，表格在卡片內捲動。沒有新DTO／SQL／migration／runtime/provider ID或production配置。

## 有效RED及中途結果

原1280三個RED：unknown response後reload與in-flight reload都缺原結果gate；切換帳戶保留舊確認dialog。第四RED舊actor延遲queue成功顯示在新actor；第五REDstorage不可寫仍呼叫queue一次。最小journal／actor guard後desktop通過，四尺寸第一次完整run為18 PASS／14 FAIL，所有14敗在768／390整頁overflow。390獨立RED量到pageWidth1396；單欄grid修正後GREEN。上述六個valid失敗有獨立log／hash。新增fixture曾TS2717重複global type，已修正；這是test wiring錯誤，保留失敗紀錄，不列產品RED或PASS。

## 分層驗證

- 1440／1280／768／390各8情境＝32 PASS、0FAIL／SKIP。unknown與inflight reload保留原gate；普通refresh不清journal；原結果讀取失敗／campaign不在scope時繼續保留，重載仍不可新queue；回原actor恢復，其他actor不見舊dialog；晚到成功不進新actor；storage failure沒有API mutation。成功只稱加入佇列、未冒稱delivered，保留待發送2。
- actual campaign route／AdminShell／staff store／CSS；Auth/API synthetic，owned loopback GET/HEAD only，獨立build目錄。四尺寸overflow assertions及screenshots保留；390修前／後已目視核對。sessionStorage只保障同tab reload，未聲稱跨tab／browser restart durability；server job／outbound intent仍原設計。
- 新owned PostgreSQL17/full85 migrations 4 PASS：actual queueAdminCampaign並發／重複只建原job1、queue audit1；consent改拒收後零job；cancel只取消undispatched，已dispatch／sent history、external ref及原job/idempotency payload保留。外部wake fake，不跑provider/worker；是既有SQL guard讀回，不冒稱本次新修server。這層不替代request Auth／租戶ACL或真delivery。
- exact source woztell Node159＋Bun9、enquiries Node103、shared actual-route115 PASS；shared中的既有campaign cases是同source回歸，不另當new32。typecheck／lint／build分開exit0，lint3 baseline warnings。所有raw logs/images hashes記execution-evidence.json；focused self review，舊independent review不涵蓋本slice。

owned SQL首次exact-source並行run在migration前連線中斷（0 PASS／1 FAIL）；保留原log。單獨fresh container重跑4 PASS；成因仍未證實，不把啟動失敗當產品RED或通過證據。

## 動作與歷史

ACT-46／48／49 LOCAL_PARTIAL。ACT49只有UI原結果核對＋SQL取消guard，未稱取消Button已驗收。原source0705／0708／0711／0712／0721為實際已按控制；五個source controls重疊logical business actions，不另加五個business actions。AdminConfirmDialog／其他component occurrence不當已驗按鈕，modal readback／其他未執行controls不升格。

兩份CSV保留原29 PASS／9 FAIL／22 BLOCKED、22 planned NEW、82 cases、execution40 PASS／28 PARTIAL／14 BLOCKED、1400 IDs及408歷史render observations；EP16／NEW16仍PARTIAL。真approved template全文／目的地／recipient membership、八真Auth sessions／full routes/actions及canary仍BLOCKED或NOT_READY。

## Config／migration dry-run與rollback

runtime config／migration／provider差異0；CI只加owned browser32及owned SQL4兩script，無production secrets。full85只在新owned harness dry-run，未套production migration。保留普通portal零EPWA、parser/receipt/CAS/drafts/bulk links/Inbox picker、canonical/source/account/branch/ad/offer、人工edits與歷史outbound intents。此slice沒有native run，baseline1/3及修復正式0/3、28Hse120/20/45/10與04:17HKT保持；Property.hk full detail/media仍BLOCKED。

local campaign reload／actor recovery READY；正式provider/Auth/full role/action coverage BLOCKED或NOT_READY。未merge／正式deploy/config/migration／真send／paid model。Rollback先停新queue再回compatible app，保留原browser journal與server campaign/job/outbound identities；未知結果核原Campaign，不清記錄重送，不抹已accepted歷史。舊版app不讀新browser journal，回退後需先由支援核對pending原結果才恢復queue。
