# EP-12 每日總覽權限範圍及局部失敗補驗

程式提交 `266f8c75c2917a476436ffb54f32c0c91ce3a454`。最新main仍為原審核51cb0e9；已有server scope／同filter cards保留。本slice產品差異只在admin.index：讀取身份由user ID改為user ID＋已核職員binding＋排序後roles；loading／denied期間不讀總覽，scope改變清舊值並沿用epoch丟棄晚到回應。各失敗來源卡片顯示自己的最後成功讀取時間。沒有更換Auth provider、新DTO／SQL／schema／migration／runtime或provider ID。

## 有效RED → GREEN

三個1280 RED各1 FAIL：同一user manager→agent仍見全公司7而非自己2；相同user／agent role但staff-a→staff-b仍見2而非3；team在09:05HKT refresh失敗保留7，缺少其09:00最後成功讀取時間。前兩個RED在原user-only identity；時間RED在identity修復後、時間顯示修復前，各raw hash分開保存。

GREEN在1440／1280／768／390各8情境＝32 PASS、0 FAIL／SKIP。角色及binding重查後更新scope並清除受限team／audit；舊manager成功及舊actor403不能覆蓋新結果；membership revoked零overview read，恢復同user重新讀；真正0、temporary error保留last success、403清值可區分。partial team failure不遮蔽其他成功來源，team metric及follow-up panel保留固定09:00最後讀取時間；這是瀏覽器成功讀回時間，不聲稱provider資料freshness。鍵盤Enter開啟open-leads同filter列表並reload保持filter，四尺寸無水平溢出。

## 分層證據

- Browser使用actual overview／leads routes、AdminShell、staff-session store及CSS；Auth／API synthetic。獨立固定build目錄，只容許owned loopback GET／HEAD。沒有真JWT／租戶／provider／worker／模型，不能替代完整8角色或session expiry驗收。
- 獨立新owned PostgreSQL17/full85 migrations：4 PASS、0 FAIL／SKIP，actual server scoped handlers、card/list totals及獨立SQL一致，agent不能看到他人counts。沒有把browser及SQL合成完整真Auth journey。
- 既有shared actual-route115 PASS、0FAIL／SKIP，已包含早前12 overview assertions，沒有額外計12；command-center Node82＋Bun8及team Node95＋Bun31 PASS。此SHA typecheck／lint／build分開exit0，lint3 baseline warnings。
- raw log hashes在execution-evidence.json的dailyWorkFollowup；32 case摘要daily-work-browser-execution-summary.json。Focused self review；先前獨立review沒有冒稱涵蓋本slice。

## 動作及歷史

ACT-03、原source Button ACT-S-0905及source Link ACT-S-0906有明確action assertions，LOCAL_PARTIAL；Button及Link是同一logical business action控制，不另當兩個business actions。Link只驗open-leads variant；其他metric routes未升格。原source reference行保留，不靠render count推論PASS。

兩份CSV原60 cases的29 PASS／9 FAIL／22 BLOCKED及22 planned NEW保持；新execution40 PASS／28 PARTIAL／14 BLOCKED、82 cases／1400 action IDs／408歷史render observations不變。EP-12／NEW-12仍PARTIAL；真Auth登入／續期／登出、safe deep-link、完整inventory/team filters／roles／flag action reconciliation仍待驗。

## Config／migration dry-run及rollback

產品runtime config／migration／provider差異0；CI只在既有owned job加入32 case script，無production secrets。完整85 schema只在owned harness dry-run；正式migration未套。普通portal零EPWA、parser／receipts／CAS／drafts／人工protected edits／歷史outbound intents保留。

本地staff-scope daily overview recovery READY；正式Auth及完整routes／roles／actions NOT_READY或BLOCKED。Property.hk完整EPS／EPT／EPW＋dt/detail/media仍BLOCKED；本slice新增native schedule0，baseline1/3及修復分支正式0/3保持，28Hse120／20／45／10及04:17HKT不改。沒有merge、正式deploy／config／migration、真發送或paid model call。

Rollback只回退本slice的route identity／last-read顯示及其test wiring；server scope仍保留，Auth provider／schema不變。保留receipt、draft、frozen evidence、人工override及原pending operation key；unknown outcome仍查原identity，不清journal重送。
