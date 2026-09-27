-- Record the reviewed route at preview and lock mutable facts while a chunk commits.
ALTER TABLE whatsapp_link_batch_previews
  ADD COLUMN IF NOT EXISTS mapping_versions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(mapping_versions)='object');

ALTER FUNCTION wa_commit_link_batch_chunk(uuid,uuid,uuid,text,text,jsonb,text,jsonb)
  RENAME TO wa_commit_link_batch_chunk_v1;

CREATE FUNCTION wa_commit_link_batch_chunk(
 p_actor uuid,p_batch uuid,p_chunk uuid,p_token_hash text,p_chunk_hash text,
 p_rows jsonb,p_channel text,p_codes jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
 snap whatsapp_link_batch_previews%ROWTYPE;
 r jsonb; d jsonb; staff uuid; mapped_staff uuid; mapped_namespace text;
 expected_version integer; current_version integer;
BEGIN
 -- A committed operation must remain readable after the mapping changes.
 IF EXISTS(SELECT 1 FROM whatsapp_link_batch_operations op
   WHERE op.batch_id=p_batch AND op.chunk_id=p_chunk) THEN
   RETURN wa_commit_link_batch_chunk_v1(
     p_actor,p_batch,p_chunk,p_token_hash,p_chunk_hash,p_rows,p_channel,p_codes);
 END IF;
 SELECT * INTO snap FROM whatsapp_link_batch_previews WHERE batch_id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_PREVIEW_EXPIRED_OR_UNAUTHORIZED'; END IF;
 PERFORM 1 FROM staff_users WHERE id=p_actor FOR SHARE;
 PERFORM 1 FROM staff_roles WHERE staff_user_id=p_actor AND role IN ('admin','manager') FOR SHARE;
 FOR r IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
   d := r->'input';
   IF NULLIF(d->>'propertyId','') IS NOT NULL THEN
     PERFORM 1 FROM properties WHERE id=(d->>'propertyId')::uuid FOR SHARE;
     PERFORM 1 FROM property_public_members WHERE property_id=(d->>'propertyId')::uuid FOR SHARE;
   END IF;
   mapped_staff := NULL;
   IF NULLIF(d->>'referenceMappingId','') IS NOT NULL THEN
     SELECT ref.staff_id,ref.namespace INTO mapped_staff,mapped_namespace
       FROM staff_external_references ref
       WHERE ref.id=(d->>'referenceMappingId')::uuid FOR SHARE;
     IF mapped_namespace IS NULL OR mapped_namespace NOT LIKE (d->>'placementSource')||'/%' THEN
       RAISE EXCEPTION 'WA_LINK_REFERENCE_SCOPE_CHANGED';
     END IF;
   END IF;
   staff := COALESCE(NULLIF(d->>'requestedStaffId','')::uuid,mapped_staff);
   IF staff IS NOT NULL THEN
     PERFORM 1 FROM staff_users WHERE id=staff FOR SHARE;
     PERFORM 1 FROM staff_roles WHERE staff_user_id=staff FOR SHARE;
     SELECT m.version INTO current_version FROM whatsapp_staff_channels m
       WHERE m.staff_id=staff AND m.channel_id=p_channel FOR SHARE;
     expected_version := NULLIF(snap.mapping_versions->>(r->>'rowKey'),'')::integer;
     IF expected_version IS NOT NULL AND current_version IS DISTINCT FROM expected_version THEN
       RAISE EXCEPTION 'WA_LINK_MAPPING_CHANGED';
     END IF;
   END IF;
 END LOOP;
 RETURN wa_commit_link_batch_chunk_v1(
   p_actor,p_batch,p_chunk,p_token_hash,p_chunk_hash,p_rows,p_channel,p_codes);
END $$;
