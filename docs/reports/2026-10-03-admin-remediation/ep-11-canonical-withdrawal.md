# EP-11 — 撤盤按 canonical 成員及售租資格再驗

重現：兩次相隔 25 小時的完整、covered 28Hse snapshot 中缺少舊 sale ad，但同一 public listing 的另一 property member 有 active Property.hk sale offer。舊 SQL 只讀 candidate property，preview 錯誤 allowed；apply 卻會影響整組 sale 成員。

最小修正：來源 states、人工 protected fields、conflicts 和 open reviews 讀同一 canonical 的成員。決定撤盤的 states 限於本次 sale/rent deal；因此有效另一 sale 會擋下 sale 撤盤，獨立 rent 不會被誤當 sale terminal/conflict，且保留公開 rent。

RED→GREEN：active sibling 缺陷 0/1→1/1；sale-only 正向回歸先觀察錯誤 blocked，再修成 allowed。最後 `test:property-withdrawal:owned:db` 2 PASS、0 SKIP，完整 85 migrations；同時涵蓋來源在 preview 後改變即 blocked、相同 operation replay/readback、合法 sale withdrawal／rent 仍公開／durable AI repair pending。既有 rule suite 12 PASS。

132 歷史候選現在直接在新建 owned full-schema PostgreSQL 測試：分頁 100＋32，全部 NOT_APPROVED，confirmed apply 零 inactive，原 source links 和 public identities 不變。此為 synthetic 歷史保護測試，沒有讀寫正式 132 筆。

正式 apply 仍需要新 full evidence、actor/version/TTL、scope 和人工覆核。Property.hk absence 保持 disabled；另一來源不完整不當撤盤。回退停批量 effects，按 operation audit 逐笔核實，不以舊庫覆蓋新查詢。
