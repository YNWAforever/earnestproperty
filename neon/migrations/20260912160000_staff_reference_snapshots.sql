-- Exact source/account aliases and immutable intake evidence; no real mappings seeded.
CREATE TABLE IF NOT EXISTS staff_external_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), namespace text NOT NULL CHECK(length(namespace) BETWEEN 1 AND 160),
 external_reference text NOT NULL CHECK(length(external_reference) BETWEEN 1 AND 160),
 staff_id uuid NOT NULL REFERENCES staff_users(id),
 mapping_version integer NOT NULL CHECK(mapping_version>0), valid_from timestamptz NOT NULL, valid_until timestamptz,
 verified_by uuid NOT NULL REFERENCES staff_users(id),
 verified_at timestamptz NOT NULL DEFAULT now(), verification_ref text NOT NULL,
 CHECK(valid_until IS NULL OR valid_until>valid_from), UNIQUE(namespace,external_reference,mapping_version)
);
CREATE INDEX IF NOT EXISTS staff_references_lookup ON staff_external_references(namespace,external_reference,valid_from);
CREATE OR REPLACE FUNCTION wa_reference_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(NEW.namespace,NEW.external_reference)::text,0));
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'valid_until') IS DISTINCT FROM (to_jsonb(OLD)-'valid_until') THEN RAISE EXCEPTION 'STAFF_REFERENCE_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND (OLD.valid_until IS NOT NULL OR NEW.valid_until IS NULL) THEN RAISE EXCEPTION 'STAFF_REFERENCE_RETIRED'; END IF;
 IF EXISTS(SELECT 1 FROM staff_external_references r WHERE r.id<>NEW.id AND r.namespace=NEW.namespace AND r.external_reference=NEW.external_reference AND tstzrange(r.valid_from,r.valid_until,'[)') && tstzrange(NEW.valid_from,NEW.valid_until,'[)')) THEN RAISE EXCEPTION 'STAFF_REFERENCE_OVERLAP'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_reference_overlap ON staff_external_references;
CREATE TRIGGER staff_reference_overlap BEFORE INSERT OR UPDATE ON staff_external_references FOR EACH ROW EXECUTE FUNCTION wa_reference_overlap();
DROP TRIGGER IF EXISTS staff_reference_no_delete ON staff_external_references;
CREATE TRIGGER staff_reference_no_delete BEFORE DELETE ON staff_external_references FOR EACH ROW EXECUTE FUNCTION wa_immutable_attribution();
ALTER TABLE inquiries
 ADD COLUMN IF NOT EXISTS property_responsible_staff_id_at_intake uuid REFERENCES staff_users(id),
 ADD COLUMN IF NOT EXISTS incoming_staff_reference text,
 ADD COLUMN IF NOT EXISTS reference_namespace text,
 ADD COLUMN IF NOT EXISTS reference_mapping_id uuid REFERENCES staff_external_references(id),
 ADD COLUMN IF NOT EXISTS reference_mapping_version integer,
 ADD COLUMN IF NOT EXISTS reference_resolution text;
CREATE OR REPLACE FUNCTION wa_intake_staff_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snap jsonb; ref record;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.requested_staff_id,NEW.property_responsible_staff_id_at_intake,NEW.incoming_staff_reference,NEW.reference_namespace,NEW.reference_mapping_id,NEW.reference_mapping_version,NEW.reference_resolution) IS DISTINCT FROM (OLD.requested_staff_id,OLD.property_responsible_staff_id_at_intake,OLD.incoming_staff_reference,OLD.reference_namespace,OLD.reference_mapping_id,OLD.reference_mapping_version,OLD.reference_resolution) THEN RAISE EXCEPTION 'STAFF_INTAKE_IDENTITY_IMMUTABLE'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.source<>'whatsapp' THEN RETURN NEW; END IF;
 SELECT context_snapshot INTO snap FROM whatsapp_link_opens WHERE id=NEW.link_open_id;
 NEW.property_responsible_staff_id_at_intake:=(snap->>'propertyResponsibleStaffIdAtIntake')::uuid;
 NEW.incoming_staff_reference:=snap->>'incomingStaffReference'; NEW.reference_namespace:=snap->>'referenceNamespace';
 IF NEW.incoming_staff_reference IS NOT NULL OR NEW.reference_namespace IS NOT NULL THEN
  SELECT * INTO ref FROM staff_external_references WHERE namespace=NEW.reference_namespace AND external_reference=NEW.incoming_staff_reference AND (snap->>'referenceMappingId' IS NULL OR id=(snap->>'referenceMappingId')::uuid) AND (snap->>'referenceMappingVersion' IS NULL OR mapping_version=(snap->>'referenceMappingVersion')::integer) AND valid_from<=NEW.webhook_received_at AND (valid_until IS NULL OR valid_until>NEW.webhook_received_at) AND verified_at<=NEW.webhook_received_at;
  IF NOT FOUND THEN NEW.reference_resolution:='reference_unresolved';NEW.association_review:=true;
  ELSIF NEW.requested_staff_id IS NOT NULL AND NEW.requested_staff_id<>ref.staff_id THEN NEW.reference_resolution:='reference_conflict';NEW.association_review:=true;
  ELSE NEW.requested_staff_id:=ref.staff_id;NEW.reference_mapping_id:=ref.id;NEW.reference_mapping_version:=ref.mapping_version;NEW.reference_resolution:='resolved'; END IF;
 ELSE NEW.reference_resolution:=CASE WHEN NEW.requested_staff_id IS NOT NULL THEN 'resolved' ELSE 'reference_unresolved' END;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_intake_staff_snapshot ON inquiries;
CREATE TRIGGER wa_intake_staff_snapshot BEFORE INSERT OR UPDATE ON inquiries FOR EACH ROW EXECUTE FUNCTION wa_intake_staff_snapshot();

ALTER TABLE whatsapp_tracking_link_versions ADD COLUMN IF NOT EXISTS reference_mapping_id uuid REFERENCES staff_external_references(id);
