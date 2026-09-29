-- Additive guard for manual corrections of no-link requested salesperson.
-- The original intake identity stays immutable; only the enquiry override is checked.
CREATE OR REPLACE FUNCTION wa_verify_no_link_requested_override()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_staff uuid;
BEGIN
  IF NEW.source<>'whatsapp' OR
    (NEW.enquiry_resolution->>'requestedStaffId') IS NOT DISTINCT FROM
    (OLD.enquiry_resolution->>'requestedStaffId') THEN RETURN NEW; END IF;
  selected_staff:=NULLIF(NEW.enquiry_resolution->>'requestedStaffId','')::uuid;
  IF selected_staff IS NULL OR NOT EXISTS(
    SELECT 1 FROM whatsapp_enquiry_reference_links WHERE inquiry_id=NEW.id
  ) THEN RETURN NEW; END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM whatsapp_enquiry_reference_links link
    JOIN whatsapp_portal_interpretations interpretation
      ON interpretation.id=link.interpretation_id
    JOIN whatsapp_inbound_receipts receipt ON receipt.id=link.receipt_id
    JOIN whatsapp_portal_source_scopes scope
      ON scope.channel_id=receipt.channel_id
      AND scope.source=CASE WHEN link.source='28hse' THEN '28hse_agent_540' ELSE 'propertyhk' END
      AND scope.scope_id=link.scope_id AND scope.enabled
    JOIN staff_external_references reference
      ON reference.namespace=scope.staff_namespace
      AND reference.external_reference=interpretation.interpretation->>'requestedStaffText'
      AND reference.staff_id=selected_staff
      AND reference.valid_from<=now()
      AND (reference.valid_until IS NULL OR reference.valid_until>now())
      AND reference.verified_at<=now()
    JOIN staff_users staff ON staff.id=reference.staff_id AND staff.active
    WHERE link.inquiry_id=NEW.id
  ) THEN RAISE EXCEPTION 'WA_ENQUIRY_STAFF_MAPPING_STALE'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_no_link_requested_override_guard ON inquiries;
CREATE TRIGGER wa_no_link_requested_override_guard
  BEFORE UPDATE OF enquiry_resolution ON inquiries FOR EACH ROW
  EXECUTE FUNCTION wa_verify_no_link_requested_override();
