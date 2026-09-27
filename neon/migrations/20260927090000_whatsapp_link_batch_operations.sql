-- Additive batch identities. Historical link codes, immutable versions and opens are untouched.
CREATE TABLE IF NOT EXISTS whatsapp_link_batch_previews (
 batch_id uuid PRIMARY KEY,
 actor_staff_id uuid NOT NULL REFERENCES staff_users(id),
 channel_id text NOT NULL,
 token_hash text NOT NULL,
 payload_hash text NOT NULL,
 rows jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 1000)
);
CREATE INDEX IF NOT EXISTS wa_link_batch_preview_expiry ON whatsapp_link_batch_previews(expires_at);
CREATE TABLE IF NOT EXISTS whatsapp_link_batch_operations (
 batch_id uuid NOT NULL REFERENCES whatsapp_link_batch_previews(batch_id),
 chunk_id uuid NOT NULL,
 actor_staff_id uuid NOT NULL REFERENCES staff_users(id),
 payload_hash text NOT NULL,
 state text NOT NULL CHECK (state IN ('committed','rejected')),
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,chunk_id)
);
CREATE TABLE IF NOT EXISTS whatsapp_link_batch_rows (
 batch_id uuid NOT NULL REFERENCES whatsapp_link_batch_previews(batch_id),
 row_key uuid NOT NULL,
 chunk_id uuid NOT NULL,
 placement_key text NOT NULL,
 link_id uuid NOT NULL REFERENCES whatsapp_tracking_links(id),
 outcome text NOT NULL CHECK (outcome IN ('created','reused')),
 PRIMARY KEY(batch_id,row_key),
 FOREIGN KEY(batch_id,chunk_id) REFERENCES whatsapp_link_batch_operations(batch_id,chunk_id)
);
CREATE TABLE IF NOT EXISTS whatsapp_tracking_link_placements (
 placement_key text PRIMARY KEY CHECK(length(placement_key)=64),
 placement_id text NOT NULL,
 link_id uuid NOT NULL UNIQUE REFERENCES whatsapp_tracking_links(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_link_batch_operations_actor ON whatsapp_link_batch_operations(actor_staff_id,created_at DESC);

CREATE OR REPLACE FUNCTION wa_commit_link_batch_chunk(
 p_actor uuid,p_batch uuid,p_chunk uuid,p_token_hash text,p_chunk_hash text,
 p_rows jsonb,p_channel text,p_codes jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
 snap whatsapp_link_batch_previews%ROWTYPE;
 previous whatsapp_link_batch_operations%ROWTYPE;
 r jsonb; d jsonb; rk uuid; pk text; offer_id uuid; source_id uuid;
 wanted_staff uuid; ref_staff uuid; effective_staff uuid; ref_id uuid; reserved uuid; candidate uuid;
 candidates integer; reason text; blocked boolean := false; output jsonb := '[]'::jsonb;
 created uuid; result_code text; result_version integer; item jsonb; code text;
BEGIN
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'WA_LINK_BATCH_LIMIT';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
 SELECT * INTO previous FROM whatsapp_link_batch_operations WHERE batch_id=p_batch AND chunk_id=p_chunk;
 IF FOUND THEN
   IF previous.actor_staff_id<>p_actor OR previous.payload_hash<>p_chunk_hash THEN
     RAISE EXCEPTION 'BATCH_PAYLOAD_CONFLICT';
   END IF;
   RETURN jsonb_build_object('batchId',p_batch,'chunkId',p_chunk,'state',previous.state,'rows',previous.result);
 END IF;
 SELECT * INTO snap FROM whatsapp_link_batch_previews WHERE batch_id=p_batch FOR UPDATE;
 IF NOT FOUND OR snap.actor_staff_id<>p_actor OR snap.token_hash<>p_token_hash OR snap.channel_id<>p_channel OR snap.expires_at<=now() THEN
   RAISE EXCEPTION 'BATCH_PREVIEW_EXPIRED_OR_UNAUTHORIZED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles sr ON sr.staff_user_id=s.id
   WHERE s.id=p_actor AND s.active AND sr.role IN ('admin','manager')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'rowKey' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'WA_LINK_DUPLICATE_ROW_KEY';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'placementKey' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'WA_LINK_DUPLICATE_PLACEMENT';
 END IF;
 -- Lock all placements in a stable order. Competing actors cannot each mint the same placement.
 FOR pk IN SELECT DISTINCT x->>'placementKey' FROM jsonb_array_elements(p_rows) x ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(pk,0));
 END LOOP;
 FOR r IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
   rk := (r->>'rowKey')::uuid; pk := r->>'placementKey'; d := r->'input'; reason := NULL;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap.rows) x WHERE x->>'rowKey'=rk::text AND x=r) THEN
     RAISE EXCEPTION 'BATCH_PAYLOAD_CONFLICT';
   END IF;
   IF EXISTS(SELECT 1 FROM whatsapp_link_batch_rows x WHERE x.batch_id=p_batch AND x.row_key=rk) THEN
     reason := 'BATCH_ROW_ALREADY_COMMITTED';
   END IF;
   IF d->>'enabled'<>'true' OR d->>'placementVerified'<>'true' THEN reason := 'PLACEMENT_UNVERIFIED'; END IF;
   wanted_staff := NULLIF(d->>'requestedStaffId','')::uuid;
   ref_id := NULLIF(d->>'referenceMappingId','')::uuid;
   source_id := NULLIF(d->>'propertyId','')::uuid;
   IF source_id IS NOT NULL THEN
     SELECT p.id INTO offer_id FROM property_public_members pm JOIN properties p ON p.id=pm.property_id
      WHERE pm.public_listing_no=d->>'publicListingNo' AND p.deal_type::text=d->>'dealType'
      ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,
        p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC LIMIT 1;
     IF offer_id IS DISTINCT FROM source_id OR NOT EXISTS(SELECT 1 FROM properties p WHERE p.id=offer_id AND p.status::text='active')
       THEN reason := 'WA_LINK_PUBLIC_OFFER_UNAVAILABLE'; END IF;
   ELSIF d->>'entryPointType'='sales' THEN reason := 'WA_LINK_OFFER_CONTEXT_REQUIRED'; END IF;
   ref_staff := NULL;
   IF ref_id IS NOT NULL THEN
     SELECT sr.staff_id INTO ref_staff FROM staff_external_references sr WHERE sr.id=ref_id
       AND sr.valid_from<=now() AND (sr.valid_until IS NULL OR sr.valid_until>now()) AND sr.verified_at<=now();
     IF ref_staff IS NULL OR (wanted_staff IS NOT NULL AND ref_staff<>wanted_staff)
       THEN reason := 'STAFF_REFERENCE_CONFLICT_OR_EXPIRED'; END IF;
   END IF;
   effective_staff := COALESCE(wanted_staff,ref_staff);
   IF effective_staff IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM staff_users s JOIN staff_roles sr ON sr.staff_user_id=s.id
      JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=p_channel
      WHERE s.id=effective_staff AND s.active AND sr.role IN ('admin','manager','agent')
       AND m.eligible AND m.retired_at IS NULL AND m.verified_at IS NOT NULL AND m.verification_ref IS NOT NULL
   ) THEN reason := 'WA_LINK_STAFF_NOT_READY'; END IF;
   SELECT x.link_id INTO reserved FROM whatsapp_tracking_link_placements x WHERE x.placement_key=pk;
   SELECT count(*)::integer,min(l.id::text)::uuid INTO candidates,candidate
     FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version
     WHERE v.enabled AND v.placement_verified_at IS NOT NULL AND v.channel_id=p_channel
      AND v.placement_source=d->>'placementSource' AND v.entry_point_type=d->>'entryPointType'
      AND v.public_listing_no IS NOT DISTINCT FROM d->>'publicListingNo'
      AND v.property_id IS NOT DISTINCT FROM source_id
      AND v.deal_type IS NOT DISTINCT FROM d->>'dealType'
      AND v.requested_staff_id IS NOT DISTINCT FROM wanted_staff
      AND v.reference_mapping_id IS NOT DISTINCT FROM ref_id
      AND v.branch_id IS NOT DISTINCT FROM d->>'branchId'
      AND v.external_listing_id IS NOT DISTINCT FROM d->>'externalListingId'
      AND v.video_id IS NOT DISTINCT FROM d->>'videoId'
      AND (EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id AND x.placement_key=pk)
        OR (NOT EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id)
          AND ((d->>'placementSource'='website' AND r->>'placementId'='website:primary')
            OR d->>'placementSource' IN ('28hse','youtube'))));
   IF reserved IS NOT NULL AND (candidate IS NULL OR candidate<>reserved) THEN reason := 'PLACEMENT_CONFLICT'; END IF;
   IF candidates>1 THEN reason := 'LEGACY_PLACEMENT_AMBIGUOUS'; END IF;
   IF reason IS NOT NULL THEN blocked := true; END IF;
   output := output || jsonb_build_array(jsonb_build_object('rowKey',rk,'outcome',
     CASE WHEN reason IS NOT NULL THEN 'blocked' WHEN candidate IS NULL THEN 'create' ELSE 'reuse' END,
     'linkId',candidate,'code',NULL,'version',NULL,'reasonCode',reason));
 END LOOP;
 IF blocked THEN
   SELECT jsonb_agg(CASE WHEN x->>'outcome'='blocked' THEN x ELSE x || '{"outcome":"failed","reasonCode":"CHUNK_NOT_COMMITTED"}'::jsonb END)
     INTO output FROM jsonb_array_elements(output) x;
   INSERT INTO whatsapp_link_batch_operations(batch_id,chunk_id,actor_staff_id,payload_hash,state,result)
     VALUES(p_batch,p_chunk,p_actor,p_chunk_hash,'rejected',output);
   RETURN jsonb_build_object('batchId',p_batch,'chunkId',p_chunk,'state','rejected','rows',output);
 END IF;
 output := '[]'::jsonb;
 FOR r IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
   rk := (r->>'rowKey')::uuid; pk := r->>'placementKey'; d := r->'input';
   SELECT x.link_id INTO candidate FROM whatsapp_tracking_link_placements x WHERE x.placement_key=pk;
   IF candidate IS NULL THEN
     SELECT min(l.id::text)::uuid INTO candidate FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v
       ON v.link_id=l.id AND v.version=l.current_version
       WHERE v.enabled AND v.placement_verified_at IS NOT NULL AND v.channel_id=p_channel
        AND v.placement_source=d->>'placementSource' AND v.entry_point_type=d->>'entryPointType'
        AND v.public_listing_no IS NOT DISTINCT FROM d->>'publicListingNo'
        AND v.property_id IS NOT DISTINCT FROM NULLIF(d->>'propertyId','')::uuid
        AND v.deal_type IS NOT DISTINCT FROM d->>'dealType'
        AND v.requested_staff_id IS NOT DISTINCT FROM NULLIF(d->>'requestedStaffId','')::uuid
        AND v.reference_mapping_id IS NOT DISTINCT FROM NULLIF(d->>'referenceMappingId','')::uuid
        AND v.branch_id IS NOT DISTINCT FROM d->>'branchId'
        AND v.external_listing_id IS NOT DISTINCT FROM d->>'externalListingId'
        AND v.video_id IS NOT DISTINCT FROM d->>'videoId'
        AND NOT EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id)
        AND ((d->>'placementSource'='website' AND r->>'placementId'='website:primary') OR d->>'placementSource' IN ('28hse','youtube'));
   END IF;
   IF candidate IS NULL THEN
     code := p_codes->>rk::text;
     IF code IS NULL OR code !~ '^[A-Za-z0-9_-]{32}$' THEN RAISE EXCEPTION 'WA_LINK_CODE_INVALID'; END IF;
     INSERT INTO whatsapp_tracking_links(code,created_by) VALUES(code,p_actor) RETURNING id INTO candidate;
     INSERT INTO whatsapp_tracking_link_versions(link_id,version,channel_id,placement_source,entry_point_type,
       public_listing_no,property_id,deal_type,requested_staff_id,branch_id,external_listing_id,video_id,
       enabled,created_by,placement_verified_at,reference_mapping_id)
       VALUES(candidate,1,p_channel,d->>'placementSource',d->>'entryPointType',d->>'publicListingNo',
         NULLIF(d->>'propertyId','')::uuid,d->>'dealType',NULLIF(d->>'requestedStaffId','')::uuid,
         d->>'branchId',d->>'externalListingId',d->>'videoId',true,p_actor,now(),
         NULLIF(d->>'referenceMappingId','')::uuid);
     reason := 'created';
   ELSE reason := 'reused'; END IF;
   INSERT INTO whatsapp_tracking_link_placements(placement_key,placement_id,link_id)
     VALUES(pk,r->>'placementId',candidate) ON CONFLICT(placement_key) DO NOTHING;
   SELECT l.code,l.current_version INTO result_code,result_version FROM whatsapp_tracking_links l WHERE l.id=candidate;
   output := output || jsonb_build_array(jsonb_build_object('rowKey',rk,'outcome',reason,
     'linkId',candidate,'code',result_code,'version',result_version,'reasonCode',NULL));
 END LOOP;
 INSERT INTO whatsapp_link_batch_operations(batch_id,chunk_id,actor_staff_id,payload_hash,state,result)
   VALUES(p_batch,p_chunk,p_actor,p_chunk_hash,'committed',output);
 INSERT INTO whatsapp_link_batch_rows(batch_id,row_key,chunk_id,placement_key,link_id,outcome)
   SELECT p_batch,(x->>'rowKey')::uuid,p_chunk,rr->>'placementKey',(x->>'linkId')::uuid,x->>'outcome'
    FROM jsonb_array_elements(output) x JOIN jsonb_array_elements(p_rows) rr ON rr->>'rowKey'=x->>'rowKey';
 RETURN jsonb_build_object('batchId',p_batch,'chunkId',p_chunk,'state','committed','rows',output);
END $$;
