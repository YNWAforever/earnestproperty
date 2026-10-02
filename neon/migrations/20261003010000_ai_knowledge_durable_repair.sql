-- Additive transactional invalidation. No backfill, external provider call or
-- historical deletion. Deployment requires the ai.knowledge.repair@1 handler.
CREATE TABLE IF NOT EXISTS ai_knowledge_repair_requests (
  source_type ai_knowledge_source_type NOT NULL,
  source_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  completed_revision bigint NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(source_type,source_id),
  CHECK (completed_revision <= revision)
);

CREATE OR REPLACE FUNCTION ep_queue_knowledge_repair(p_type ai_knowledge_source_type,p_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  INSERT INTO ai_knowledge_repair_requests(source_type,source_id)
    VALUES(p_type,p_id) ON CONFLICT(source_type,source_id) DO UPDATE
    SET revision=ai_knowledge_repair_requests.revision+1,requested_at=now();
  UPDATE ai_knowledge_chunks c SET stale=true,updated_at=now()
    FROM ai_knowledge_sources s WHERE c.source_id=s.id AND s.source_type=p_type AND s.source_id=p_id;
  INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
    VALUES('ai.knowledge.repair',1,jsonb_build_object('batchId',txid_current()::text),'queued',5,
      now()+interval '15 seconds','ai.knowledge.repair:'||txid_current()::text)
    ON CONFLICT(idempotency_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION ep_invalidate_knowledge_source()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_row jsonb; new_row jsonb; item record; target_id text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND old_row IS NOT DISTINCT FROM new_row THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('faqs','articles','estates') THEN
    PERFORM ep_queue_knowledge_repair(CASE TG_TABLE_NAME WHEN 'faqs' THEN 'faq' WHEN 'articles' THEN 'article' ELSE 'estate' END::ai_knowledge_source_type,COALESCE(new_row->>'id',old_row->>'id'));
    IF TG_TABLE_NAME<>'estates' THEN RETURN NULL; END IF;
    FOR item IN SELECT DISTINCT p.id FROM properties p
      WHERE p.estate_id::text IN (old_row->>'id',new_row->>'id') ORDER BY p.id LOOP
      PERFORM ep_queue_knowledge_repair('listing',item.id::text);
    END LOOP;
  ELSIF TG_TABLE_NAME='property_public_groups' THEN
    FOR item IN SELECT property_id FROM property_public_members
      WHERE public_listing_no IN(old_row->>'public_listing_no',new_row->>'public_listing_no') ORDER BY property_id LOOP
      PERFORM ep_queue_knowledge_repair('listing',item.property_id::text);
    END LOOP;
  ELSE
    FOR target_id IN SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_TABLE_NAME='properties' THEN old_row->>'id' ELSE old_row->>'property_id' END,
      CASE WHEN TG_TABLE_NAME='properties' THEN new_row->>'id' ELSE new_row->>'property_id' END
    ]) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
      PERFORM ep_queue_knowledge_repair('listing',target_id);
      FOR item IN SELECT DISTINCT m.property_id FROM property_public_members m WHERE
        m.public_listing_no IN (SELECT public_listing_no FROM property_public_members WHERE property_id::text=target_id)
        OR (TG_TABLE_NAME='property_public_members' AND m.public_listing_no IN(old_row->>'public_listing_no',new_row->>'public_listing_no'))
        ORDER BY m.property_id LOOP
        IF item.property_id::text<>target_id THEN PERFORM ep_queue_knowledge_repair('listing',item.property_id::text); END IF;
      END LOOP;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER ep_knowledge_properties AFTER INSERT OR UPDATE OR DELETE ON properties
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
CREATE TRIGGER ep_knowledge_members AFTER INSERT OR UPDATE OR DELETE ON property_public_members
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
CREATE TRIGGER ep_knowledge_groups AFTER INSERT OR UPDATE OR DELETE ON property_public_groups
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
CREATE TRIGGER ep_knowledge_protected AFTER INSERT OR UPDATE OR DELETE ON property_sync_fields
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
CREATE TRIGGER ep_knowledge_source_state AFTER INSERT OR UPDATE OR DELETE ON mls_source_state
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
CREATE TRIGGER ep_knowledge_estates AFTER INSERT OR UPDATE OR DELETE ON estates
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
CREATE TRIGGER ep_knowledge_faqs AFTER INSERT OR UPDATE OR DELETE ON faqs
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
CREATE TRIGGER ep_knowledge_articles AFTER INSERT OR UPDATE OR DELETE ON articles
  FOR EACH ROW EXECUTE FUNCTION ep_invalidate_knowledge_source();
