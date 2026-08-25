-- createAdminAudienceFromSegment (admin-data.server.ts) previously always
-- INSERTed a new whatsapp_audiences row, so clicking 建立收件群組 a second
-- time -- a plain double-click, or re-syncing after editing the segment's
-- prompt -- silently created a duplicate audience with the same name, with no
-- way to tell them apart. This column lets that function look up "does an
-- audience already exist for this segment" and UPDATE it instead.
ALTER TABLE whatsapp_audiences
  ADD COLUMN IF NOT EXISTS source_segment_id UUID REFERENCES crm_segments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_audiences_source_segment_id
  ON whatsapp_audiences(source_segment_id)
  WHERE source_segment_id IS NOT NULL;
