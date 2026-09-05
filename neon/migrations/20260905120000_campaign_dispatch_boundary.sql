-- Dispatch reservation is irreversible because the provider may have accepted it.
ALTER TABLE whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz;
-- Legacy in-flight requests cannot safely be assumed undispatched.
UPDATE whatsapp_campaign_recipients
SET dispatch_started_at = COALESCE(queued_at, now())
WHERE status = 'sending' AND dispatch_started_at IS NULL;
-- Ownership identifies the exact claim attempt, even when one worker ID is reused.
ALTER TABLE whatsapp_campaign_recipients ADD COLUMN IF NOT EXISTS claim_job_id uuid;
ALTER TABLE whatsapp_campaign_recipients ADD COLUMN IF NOT EXISTS claim_worker_id text;
ALTER TABLE whatsapp_campaign_recipients ADD COLUMN IF NOT EXISTS claim_attempt integer;
ALTER TABLE whatsapp_campaign_recipients ADD COLUMN IF NOT EXISTS dispatch_job_id uuid;
ALTER TABLE whatsapp_campaign_recipients ADD COLUMN IF NOT EXISTS dispatch_worker_id text;
ALTER TABLE whatsapp_campaign_recipients ADD COLUMN IF NOT EXISTS dispatch_attempt integer;
