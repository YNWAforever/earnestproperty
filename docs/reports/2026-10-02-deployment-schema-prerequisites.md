# PR208/209 部署前：未授權 WhatsApp schema prerequisite

2026-10-02 正式唯讀核對：whatsapp_inbound_receipts 不存在。main 的 handleWoztellWebhook 在有效signature/scope後先呼叫storeInboundReceipt；缺schema會回503 WA_RECEIPT_STORE_UNAVAILABLE，與off/observe/active無關。不能安全把已合併main部署後才忽略這項缺口。

以下10檔為repo已有未套用migration，並非本次新增；使用者目前只授權另兩個盤源migration。本清單沒有授權或執行以下DDL。已逐檔讀取SQL。2026-10-02 在核對的 disposable br-young-breeze-ao85rtx1 / earnest_audit_acceptance_20260927 真Neon以同一transaction逐檔執行10/10 DDL PASS；未知actor enquiry read為false；最後ROLLBACK，原receipts表仍不存在，properties/inquiries/messages/staff前後均0。這是DDL rehearsal，非provider驗收。主線CI36896501015已通過；本次安全版本CI36901183471的local PostgreSQL、no-link browser、handoff browser三項亦已PASS。production仍待明確授權，不运行無篩選全repo migrate。

| Existing migration | SHA-256 of Git blob at cbcab28 | SQL operations |
|---|---|---|
| 20260929100000_whatsapp_inbound_receipts.sql | 3dcce51c9f0d3cf54d10f8c07504173cf7eb4435a13a5d6b0a60d88733f8db64 | CREATE INDEX, CREATE TABLE, update |
| 20260929101000_whatsapp_receipt_identity.sql | b2e4c7d52143a79aff5504181c1ee1f12b7aae0ed35006fdc7389258d41e864d | ALTER TABLE, CREATE UNIQUE INDEX |
| 20260929102000_whatsapp_portal_resolution.sql | baec4e87eb73c74e2365d57b82ee7ce02ed7ceb6fc686c03b027a275cc21ea80 | CREATE INDEX, CREATE OR REPLACE FUNCTION, CREATE TABLE, DROP TRIGGER |
| 20260929103000_whatsapp_no_link_episodes.sql | 5b564c5bace2b8a9f5fe61d19fd2c47ab76915d58cb6d63148ea051417325641 | CREATE INDEX, CREATE OR REPLACE FUNCTION, CREATE TABLE, INSERT INTO, UPDATE |
| 20260929104000_whatsapp_enquiry_access.sql | 792d882aaea3ee587c4d5e0f4ccbffc25b968532f3403654db2941604cefdf89 | ALTER TABLE, CREATE OR REPLACE FUNCTION, CREATE TABLE, DROP TRIGGER, INSERT INTO, UPDATE |
| 20260929105000_whatsapp_no_link_effects.sql | 672dfd11a88e857918fe3895faa7dba7641b5bd68ed6ab7dd08e1d24f91199c9 | CREATE OR REPLACE FUNCTION, CREATE TABLE, DROP TRIGGER, INSERT INTO, UPDATE |
| 20260929106000_whatsapp_enquiry_resolution_guard.sql | b1deeb170a342bc17246bbbc11cac637f3ab256b2c3604079ff32f96588a17aa | CREATE OR REPLACE FUNCTION, DROP TRIGGER |
| 20260929107000_whatsapp_forwarded_enquiries.sql | e7f04c71997f11d5d09557ddc0cc26330a7cd468813cb89b57d1fa60688f28a2 | CREATE INDEX, CREATE OR REPLACE FUNCTION, CREATE TABLE, INSERT INTO, UPDATE, update |
| 20260930090000_whatsapp_no_link_source_authority.sql | 03b6dbd824c7ce12a577a380809e220342cb6165c46b890ea88fc5068b461246 | CREATE OR REPLACE FUNCTION, INSERT INTO, UPDATE |
| 20261001090000_whatsapp_outbound_unknown_reservation.sql | 74362d204b4bf22de1b7b91eeb21ae18c9902fa4e2d68ca57f68e804b489ffc0 | CREATE INDEX, CREATE OR REPLACE FUNCTION, DROP TRIGGER |
