-- Fill missing details from sources rechecked on 2026-09-06; see docs/audits/production-admin-repair.md.
-- Preserve authored values and revision history; record the complete before-image.
CREATE TABLE IF NOT EXISTS estate_content_repair_20260906 (estate_id uuid PRIMARY KEY,before_row jsonb NOT NULL,repaired_at timestamptz NOT NULL DEFAULT now());
DO $repair$
DECLARE item jsonb; live estates%ROWTYPE; prior cms_content_revisions%ROWTYPE; patch jsonb; next_version integer;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements($content$[{"slug":"bellagio","address":"青山公路深井段33號","facilities":["住客會所","室外泳池","健身室","網球場","兒童遊樂場"]},{"slug":"hong-kong-garden","address":"青山公路青龍頭段100號"},{"slug":"lido-garden","address":"青山公路深井段41–63號","developer":"長江實業／熊谷組","facilities":["住客會所","室外泳池","健身室","網球場","平台花園"]},{"slug":"chun-wong-kui","facilities":["住客會所","園林"]},{"slug":"oma-oma","facilities":["住客會所 Club OMA"]}]$content$::jsonb) LOOP
  SELECT * INTO live FROM estates WHERE slug=item->>'slug';
  IF NOT FOUND THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cms:estate:'||live.id::text,0));
  SELECT * INTO live FROM estates WHERE id=live.id FOR UPDATE;
  patch='{}'::jsonb;
  IF nullif(trim(live.address),'') IS NULL AND item ? 'address' THEN patch=patch||jsonb_build_object('address',item->>'address'); END IF;
  IF nullif(trim(live.developer),'') IS NULL AND item ? 'developer' THEN patch=patch||jsonb_build_object('developer',item->>'developer'); END IF;
  IF coalesce(cardinality(live.facilities),0)=0 AND item ? 'facilities' THEN patch=patch||jsonb_build_object('facilities',item->'facilities'); END IF;
  IF patch='{}'::jsonb THEN CONTINUE; END IF;
  INSERT INTO estate_content_repair_20260906(estate_id,before_row) VALUES(live.id,to_jsonb(live)) ON CONFLICT DO NOTHING;
  SELECT * INTO prior FROM cms_content_revisions WHERE resource_type='estate' AND resource_id=live.id AND state='published' FOR UPDATE;
  IF FOUND THEN
   SELECT coalesce(max(version_number),0)+1 INTO next_version FROM cms_content_revisions WHERE resource_type='estate' AND resource_id=live.id;
   UPDATE cms_content_revisions SET state='superseded' WHERE id=prior.id;
   INSERT INTO cms_content_revisions(resource_type,resource_id,state,version_number,payload,published_at,base_published_version,validation_summary)
   VALUES('estate',live.id,'published',next_version,prior.payload||patch,now(),prior.version_number,'{}'::jsonb);
  END IF;
  UPDATE estates SET address=coalesce(patch->>'address',address),developer=coalesce(patch->>'developer',developer),facilities=CASE WHEN patch ? 'facilities' THEN ARRAY(SELECT jsonb_array_elements_text(patch->'facilities')) ELSE facilities END,updated_at=now() WHERE id=live.id;
 END LOOP;
END $repair$;
