-- Keep provider member IDs and registered telephone recipients in distinct namespaces.
ALTER TABLE staff_notification_endpoints DROP CONSTRAINT IF EXISTS staff_notification_endpoints_transport_check;
ALTER TABLE staff_notification_endpoints ADD CONSTRAINT staff_notification_endpoints_transport_check
  CHECK (transport IN ('inbox_private_note', 'staff_whatsapp', 'website_lead_phone'));
ALTER TABLE staff_notification_endpoints DROP CONSTRAINT IF EXISTS website_lead_phone_canonical;
ALTER TABLE staff_notification_endpoints ADD CONSTRAINT website_lead_phone_canonical
  CHECK (transport <> 'website_lead_phone' OR destination_reference ~ '^852[4-9][0-9]{7}$');

-- The route recorded at intake owns the notification even after a flag change or a retry.
CREATE OR REPLACE FUNCTION enquiry_enqueue_forward(source text, subject uuid, channel text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE job uuid;
BEGIN
  IF source IS NULL OR source NOT IN ('website','whatsapp') OR NOT enquiry_forwarding_is_enabled(channel) THEN RETURN NULL; END IF;
  IF source='website' AND NOT EXISTS (
    SELECT 1 FROM crm_leads l JOIN enquiry_notification_recipients copy ON copy.recipient_key='copy'
    WHERE l.id=subject AND l.source='website' AND l.created_at>=copy.enabled_since
      AND COALESCE(l.enquiry_routing_context->>'notificationRoute','') NOT IN ('staff_phone','staff_phone_paused')
  ) THEN RETURN NULL; END IF;
  IF source='whatsapp' AND NOT enquiry_forwarding_whatsapp_eligible(subject,channel) THEN RETURN NULL; END IF;
  INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
  VALUES('woztell.enquiry.forward',1,jsonb_build_object('source',source,'subjectId',subject::text),'queued',3,now(),'enquiry-forward:'||source||':'||subject::text)
  ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO job;
  RETURN job;
END $$;
