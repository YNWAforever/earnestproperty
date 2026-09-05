-- Measured on approved disposable Singapore Preview with 100,000 equal-time
-- messages: EXPLAIN execution 490.83 ms -> 26.30 ms; 20 warm HTTP p95 151 ms.
-- Existing (conversation_id, created_at) index cannot satisfy the id tie-break.
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_cursor
  ON whatsapp_messages (conversation_id, created_at DESC, id DESC);
