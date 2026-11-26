-- A channel starts acknowledging new enquiries only after its greeting is configured.
CREATE TABLE whatsapp_customer_greetings (
  app_id text NOT NULL,
  channel_id text NOT NULL,
  sender_phone text NOT NULL CHECK (sender_phone ~ '^[1-9][0-9]{7,14}$'),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4096),
  enabled_since timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (app_id, channel_id)
);

ALTER TABLE whatsapp_service_actions ALTER COLUMN survey_id DROP NOT NULL;
ALTER TABLE whatsapp_service_actions DROP CONSTRAINT whatsapp_service_actions_purpose_check;
ALTER TABLE whatsapp_service_actions ADD CONSTRAINT whatsapp_service_actions_purpose_check CHECK (
  (purpose='customer_greeting' AND survey_id IS NULL) OR
  (purpose IN ('after_hours_ack','survey','survey_thanks','manager_ack') AND survey_id IS NOT NULL)
);
CREATE UNIQUE INDEX wa_one_customer_greeting_per_enquiry ON whatsapp_service_actions(inquiry_id)
  WHERE purpose='customer_greeting';

-- Both preparing and claiming the reply use the original signed inbound and current contact.
CREATE VIEW whatsapp_customer_greeting_targets AS
SELECT e.id AS event_id,i.id AS inquiry_id,i.conversation_id,w.contact_id,e.member_id,e.app_id,e.channel_id,
       g.policy_id,g.id AS activation_id,cfg.body
FROM whatsapp_customer_greetings cfg
JOIN whatsapp_enquiry_events e ON e.app_id=cfg.app_id AND e.channel_id=cfg.channel_id
JOIN inquiries i ON i.id=e.inquiry_id AND i.intake_message_id=e.message_id
JOIN whatsapp_enquiry_activations g ON g.id=e.activation_id AND g.ended_at IS NULL
JOIN whatsapp_service_policies p ON p.id=g.policy_id AND p.status='approved'
JOIN whatsapp_messages m ON m.id=e.message_id AND m.external_message_id=e.external_message_id AND m.direction='inbound'
JOIN whatsapp_conversations w ON w.id=i.conversation_id AND w.id=m.conversation_id AND w.channel_id=e.channel_id
  AND w.woztell_member_id=e.member_id AND m.channel_id=w.channel_id AND m.woztell_member_id=w.woztell_member_id
JOIN crm_contacts c ON c.id=w.contact_id AND c.id=m.contact_id AND c.id=i.crm_contact_id
JOIN whatsapp_inbound_receipts r ON r.identity_key=e.external_message_id AND r.member_id=e.member_id
  AND r.app_id=e.app_id AND r.channel_id=e.channel_id AND r.provider='woztell' AND r.origin='live_webhook'
  AND r.event_kind='customer_message' AND r.normalized_event->>'direction'='inbound'
  AND r.capture_mode='active' AND r.activation_id=g.id
WHERE e.origin='live_webhook' AND e.kind='customer_message' AND e.effects_eligible
  AND e.capture_mode='active' AND e.timing='fresh' AND e.identity_quality='provider_id' AND e.processing_state<>'suppressed'
  AND r.received_at>=cfg.enabled_since AND r.provider_occurred_at>=cfg.enabled_since AND r.block_reason IS NULL
  AND e.occurred_at>=cfg.enabled_since AND i.created_at>=cfg.enabled_since AND e.occurred_at>now()-interval '24 hours'
  AND w.last_inbound_at>=now()-interval '24 hours' AND NOT c.opted_out_whatsapp
  AND i.source='whatsapp' AND i.status NOT IN ('closed','resolved','spam')
  AND NOT EXISTS (SELECT 1 FROM crm_contact_identity_reviews v WHERE v.conversation_id=w.id AND v.reason='whatsapp_identity_conflict' AND v.status='open')
  AND NOT EXISTS (SELECT 1 FROM enquiry_notification_recipients d WHERE d.channel_id=e.channel_id AND d.destination_reference=e.member_id)
  AND cfg.sender_phone <> ALL (ARRAY(SELECT regexp_replace(coalesce(n,''),'[^0-9]','','g') FROM unnest(ARRAY[r.normalized_event->>'fromPhone',e.member_id,c.phone,c.normalized_phone]) n))
  AND NOT EXISTS (SELECT 1 FROM staff_notification_internal_events x WHERE x.channel_id=e.channel_id AND x.member_id=e.member_id)
  AND NOT EXISTS (SELECT 1 FROM enquiry_forwarding_decisions d WHERE d.app_id=e.app_id AND d.channel_id=e.channel_id AND d.member_id=e.member_id AND d.subject_kind='sender_member' AND d.decision='staff_bound')
  AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[enquiry_notification_phone(r.normalized_event->>'fromPhone'),
      enquiry_notification_phone(e.member_id),enquiry_notification_phone(c.phone),enquiry_notification_phone(c.normalized_phone)]) n(phone)
    WHERE n.phone=cfg.sender_phone OR EXISTS(SELECT 1 FROM staff_users s WHERE s.active AND n.phone IN (enquiry_notification_phone(s.phone),enquiry_notification_phone(s.whatsapp)))
      OR EXISTS(SELECT 1 FROM enquiry_notification_recipients d WHERE d.phone=n.phone)
  );
