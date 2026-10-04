# EP-16／17 本地補驗及最小修復

程式 SHA `523a636c3c68bbd262cd67d2c2a5904d43270b99`。聚焦 commits：EP-16 `5679359de31daa29390bb21982a0fa9ecb066393`；EP-17 `523a636c3c68bbd262cd67d2c2a5904d43270b99`。首四批 PR 已具體交付後，交付清單另有可獨立本地補驗的50列操作和報表讀回，故本回合繼續完成，不歸因於缺真 provider。

## EP-16

RED：新50列 regression要求45成功／5已確認失敗分開CSV，既有匯出仍輸出46行成功檔，Bun26 PASS／1 FAIL。修復後同一 package script Node29／Bun27 PASS；全部CSV欄位沿用 formula neutralisation。success CSV schema及既有消費者不改；failure CSV含原 row key、公開盤號、租售、來源、投放、outcome、reason，沒有假連結。未提交／未知結果不列作失敗。

四尺寸390／768／1280／1440真 wizard操作50列CSV：中文盤名、前置零、售租各25、可信 reference候選，duplicate／invalid阻止lookup及commit，missing current offer／denied read保留輸入；核對後一次提交，40 created／7 reused／1 stale blocked／2 failed。50行逐列DOM讀回，success CSV47行＋header，failure CSV3行＋header；重載後查原batch及3失敗行修復，不重做47成功行。server/model均是synthetic API；沒有把mock scope拒絕當成真server ACL證據。

第二個RED：重載後按「只修正已知失敗的3行」，摘要顯示0或先前50筆租售。改為從當前已保留rows派生摘要，四尺寸同一操作GREEN。既有draft／batch／chunk identities、原outbound ledger均保留。

50列未知commit：合成API先保存operation再中斷response及read，browser持久uncertain；reload後查同一operation，50行讀回，新增commit為0，operation仍只有1個。這證明UI journal/readback契約，非真DB durability；真transaction/CAS已另列owned SQL evidence。

既有9＋新5＝14 browser PASS／0 FAIL／0 SKIP。早期測試中的兩個fixture錯誤（把同一可信mapping重複50次、reload覆蓋journal）已修正；不記作產品RED或安全缺陷。owned loopback，所有遠端request封鎖；沒有真send。

## EP-17

RED：四尺寸flag關閉時沒有狀態原因。新增「銷售及代理績效暫未啟用」，說明不是無查詢／成交；沒有自動開旗標。GREEN：四尺寸明示原因，performance report adapter讀取0次。

四尺寸以真 `calculateSalesPerformance`、`selectPerformanceRecords`、actual analytics route／dashboard／table／CSV依同一fixture驗：3 production enquiries，排除test/spam/unknown、其他分行及HKT次日boundary；卡片3→明細3→CSV3行，28Hse filter1→明細1。tracked open／message source／unknown origin各1，click ratio維持未有足夠資料；1 confirmed assignment及1 internal acknowledgement不當human reply；1真human_response給15分鐘／2未回覆。sale＋rent成交共2，但買賣成交額只為HK$10m。沒有用AI score當成交率。

新增8 analytics browser情境及既有107共115 PASS／0 FAIL／0 SKIP；`npm run test:analytics` Node65＋Bun3 PASS。Auth/API讀取是synthetic；計算／presentation／匯出是真source。沒有冒稱真登入、正式flag、真SQL與畫面同時已验。

## 證據及限制

`batch-browser-execution-summary.json`、`browser-execution-summary.json`保留每scenario的width／actor／status／source SHA。原60測試29 PASS／9 FAIL／22 BLOCKED不改；22 NEW仍依完整計劃分層判斷，EP-16／17保持PARTIAL，不以本地補驗關閉provider/runtime gates。完整roles/routes/actions/G11仍NOT_READY；rendered observation不能推論action PASS。

typecheck、lint（0 error／3 baseline warning）、build分開exit0。這批只有client CSV／summary／availability及test fixture變更，沒有新migration/config/provider差異。回退可回前一compatible app；已存batch/chunk/outbound/protected edits及server再驗scope/revision不移除。
