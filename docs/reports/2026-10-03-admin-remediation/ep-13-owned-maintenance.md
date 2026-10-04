# EP-13 — 樓盤維護保存及獨立讀回

`test:property-maintenance:owned:db` 5 PASS、0 SKIP；完整 85 migrations 新建 owned PostgreSQL17。呼叫現有 saveAdminPropertyManagement，另一 reader 使用 getAdminManagedProperty 和 raw SQL；沒有正式盤或 media provider 寫入。

共享標題、描述和圖片 metadata 次序保持於 canonical 成員，人工 overrides 保留；只改 sale price 不改 rent；兩個同 expected version 的並發保存只有一個成功、另一 409 且無 partial write；已停用 actor 的 cached manager 權限不能寫入。main 原有管理 API／CAS 不重寫。

既有 admin-properties suite 29 Node＋26 Bun PASS；CMS save/recovery 53 Node＋4 Bun PASS。真相片 upload/rights/provider、50-row real UI bulk、正式角色 session 另層待驗，metadata-order PASS 不當 real upload PASS。

回退回上一 app presentation，保留 protected edits、new enquiries 和 audit；不能整庫 restore。撤盤與 AI revision 使用同一現有 canonical 身份。
