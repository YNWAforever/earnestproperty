# EP-06 — 接駁核實及保存讀回

本地結果：`test:whatsapp-setup:db` 1 PASS、0 SKIP；完整 85 migrations 的新建 owned PostgreSQL17。provider directory 是明確標示的 synthetic paginated fixture，沒有正式接駁或試送。

既有 main 已有 Inbox picker、provider membership verification、review evidence 和版本 CAS；本次沒有重寫它們。新增測試直接呼叫 saveInboxFolder → verifyInboxSelection → saveReviewedStaffChannel，再以獨立 SQL 讀回 version、evidence、audit。核實 user/folder/channel 身份而非同名；過期版本、provider outage、錯 ID、已離職同事皆拒絕，零 EPWA 增量。assignment-ready 與 phone-notification-ready 分開；前者成功不能代替 consent/window/endpoint。

正式 config preview：本回合沒有 production DB/provider 憑證，所以 source namespace、公司 account、branch、channel、Folder、provider user、review version 和 notification endpoint 的**現值 UNKNOWN**；原審核 scopes=0／legacy mapping=1 是歷史，不當作現值。待租戶獨立讀回後，逐個保存已核實的 28Hse account/branch scope；Property.hk 只用 EP-09 已核實 scope。預期差異是新增 versioned scope/review，保留 legacy history、receipts 和未處理查詢，不批量重建映射。

回退：停新 assignment/phone effects、回復上一 approved mapping/review version；capture 和 receipt/outbound ledger 保留。正式 provider directory、membership、phone delivery 仍 BLOCKED；local setup contract READY。
