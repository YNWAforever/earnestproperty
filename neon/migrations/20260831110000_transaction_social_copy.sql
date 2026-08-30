-- Content Copilot's new "social" action generates FB/IG zh-HK copy for a
-- transaction (see the P6c2 plan). transactions.social_state (P5) tracks
-- whether/how a verified deal has been used in a social post -- a status,
-- not the copy itself. These two nullable columns hold the actual text.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS social_copy_fb TEXT,
  ADD COLUMN IF NOT EXISTS social_copy_ig TEXT;
