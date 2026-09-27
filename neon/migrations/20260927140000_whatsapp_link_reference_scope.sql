-- A verified staff reference belongs to its source namespace at the final write boundary.
-- Existing rows are unchanged; new or edited versions cannot cross source scopes.
CREATE OR REPLACE FUNCTION wa_link_reference_source_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference_mapping_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff_external_references r
    WHERE r.id=NEW.reference_mapping_id
      AND r.namespace LIKE NEW.placement_source::text || '/%'
  ) THEN
    RAISE EXCEPTION 'STAFF_REFERENCE_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_link_reference_source_scope ON whatsapp_tracking_link_versions;
CREATE TRIGGER wa_link_reference_source_scope
  BEFORE INSERT OR UPDATE OF reference_mapping_id,placement_source
  ON whatsapp_tracking_link_versions FOR EACH ROW
  EXECUTE FUNCTION wa_link_reference_source_scope();
