-- Source rows remain authoritative. This ledger is an immutable, idempotent projection.
CREATE TABLE IF NOT EXISTS crm_lead_qualifications (
  lead_id uuid PRIMARY KEY REFERENCES crm_leads(id) ON DELETE CASCADE,
  qualified_at timestamptz NOT NULL,
  evidence text NOT NULL CHECK (length(btrim(evidence)) >= 8),
  qualified_by uuid NOT NULL REFERENCES staff_users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_events (
  event_key text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN
    ('lead_qualified','viewing_completed','assignment_confirmed','human_response','deal_confirmed','deal_cancelled')),
  source_id text NOT NULL,
  inquiry_id uuid,
  lead_id uuid,
  transaction_id uuid,
  staff_id uuid,
  branch_id_at_event uuid,
  occurred_at timestamptz NOT NULL,
  source text NOT NULL,
  initial_quality text NOT NULL DEFAULT 'unknown' CHECK (initial_quality='unknown'),
  policy_version text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_type,source_id),
  CHECK (event_key=event_type || ':' || source_id)
);
CREATE INDEX IF NOT EXISTS performance_events_time ON performance_events(occurred_at,event_type);
CREATE INDEX IF NOT EXISTS performance_events_inquiry ON performance_events(inquiry_id) WHERE inquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS performance_events_lead ON performance_events(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS performance_events_transaction ON performance_events(transaction_id) WHERE transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS performance_event_quality_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL REFERENCES performance_events(event_key),
  quality text NOT NULL CHECK (quality IN ('production','test','spam','unknown')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 8),
  changed_by uuid NOT NULL REFERENCES staff_users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS performance_quality_latest ON performance_event_quality_revisions(event_key,id DESC);

CREATE TABLE IF NOT EXISTS performance_event_occurrence_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL REFERENCES performance_events(event_key),
  occurred_at timestamptz NOT NULL,
  staff_id uuid,
  reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS performance_occurrence_latest ON performance_event_occurrence_revisions(event_key,id DESC);

CREATE OR REPLACE VIEW performance_event_records AS
SELECT e.event_key,e.event_type,e.source_id,e.inquiry_id,e.lead_id,e.transaction_id,
  COALESCE(o.staff_id,e.staff_id) AS staff_id,e.branch_id_at_event,
  COALESCE(o.occurred_at,e.occurred_at) AS occurred_at,e.source,
  COALESCE(q.quality,e.initial_quality) AS quality,e.policy_version,e.recorded_at,
  q.changed_at AS quality_changed_at
FROM performance_events e
LEFT JOIN LATERAL (
  SELECT quality,changed_at FROM performance_event_quality_revisions
  WHERE event_key=e.event_key ORDER BY id DESC LIMIT 1
) q ON true
LEFT JOIN LATERAL (
  SELECT occurred_at,staff_id FROM performance_event_occurrence_revisions
  WHERE event_key=e.event_key ORDER BY id DESC LIMIT 1
) o ON true;

CREATE OR REPLACE FUNCTION reject_performance_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'performance history is append-only'; END $$;
DROP TRIGGER IF EXISTS performance_lead_qualification_immutable ON crm_lead_qualifications;
CREATE TRIGGER performance_lead_qualification_immutable BEFORE UPDATE OR DELETE ON crm_lead_qualifications
FOR EACH ROW EXECUTE FUNCTION reject_performance_history_change();
DROP TRIGGER IF EXISTS performance_event_immutable ON performance_events;
CREATE TRIGGER performance_event_immutable BEFORE UPDATE OR DELETE ON performance_events
FOR EACH ROW EXECUTE FUNCTION reject_performance_history_change();
DROP TRIGGER IF EXISTS performance_quality_immutable ON performance_event_quality_revisions;
CREATE TRIGGER performance_quality_immutable BEFORE UPDATE OR DELETE ON performance_event_quality_revisions
FOR EACH ROW EXECUTE FUNCTION reject_performance_history_change();
DROP TRIGGER IF EXISTS performance_occurrence_immutable ON performance_event_occurrence_revisions;
CREATE TRIGGER performance_occurrence_immutable BEFORE UPDATE OR DELETE ON performance_event_occurrence_revisions
FOR EACH ROW EXECUTE FUNCTION reject_performance_history_change();

CREATE OR REPLACE FUNCTION capture_qualified_lead_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO performance_events(event_key,event_type,source_id,lead_id,staff_id,branch_id_at_event,occurred_at,source)
  SELECT 'lead_qualified:'||NEW.lead_id::text,'lead_qualified',NEW.lead_id::text,NEW.lead_id,
    NEW.qualified_by,s.branch_id,NEW.qualified_at,'crm_lead:'||NEW.lead_id::text
  FROM staff_users s WHERE s.id=NEW.qualified_by
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS performance_qualified_lead ON crm_lead_qualifications;
CREATE TRIGGER performance_qualified_lead AFTER INSERT ON crm_lead_qualifications
FOR EACH ROW EXECUTE FUNCTION capture_qualified_lead_event();

CREATE OR REPLACE FUNCTION capture_completed_viewing_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.activity_type='viewing' AND NEW.completed_at IS NOT NULL
    AND (TG_OP='INSERT' OR OLD.completed_at IS NULL) THEN
    INSERT INTO performance_events(event_key,event_type,source_id,lead_id,staff_id,branch_id_at_event,occurred_at,source)
    SELECT 'viewing_completed:'||NEW.id::text,'viewing_completed',NEW.id::text,NEW.lead_id,
      NEW.staff_user_id,s.branch_id,NEW.completed_at,'crm_activity:'||NEW.id::text
    FROM staff_users s WHERE s.id=NEW.staff_user_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS performance_completed_viewing ON crm_activities;
CREATE TRIGGER performance_completed_viewing AFTER INSERT OR UPDATE OF completed_at,activity_type ON crm_activities
FOR EACH ROW EXECUTE FUNCTION capture_completed_viewing_event();

CREATE OR REPLACE FUNCTION capture_confirmed_assignment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_inquiry uuid;
BEGIN
  IF NEW.state='confirmed' AND OLD.state IS DISTINCT FROM 'confirmed' AND NEW.finished_at IS NOT NULL THEN
    SELECT CASE WHEN count(*)=1 THEN (array_agg(i.id))[1] ELSE NULL END INTO selected_inquiry FROM inquiries i
    WHERE i.conversation_id=NEW.conversation_id AND i.source='whatsapp'
    AND i.created_at<=NEW.finished_at;
    INSERT INTO performance_events(event_key,event_type,source_id,inquiry_id,staff_id,branch_id_at_event,occurred_at,source)
    SELECT 'assignment_confirmed:'||NEW.id::text,'assignment_confirmed',NEW.id::text,
      selected_inquiry,NEW.desired_staff_id,s.branch_id,NEW.finished_at,'wa_assignment:'||NEW.id::text
    FROM staff_users s WHERE s.id=NEW.desired_staff_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS performance_confirmed_assignment ON whatsapp_assignment_requests;
CREATE TRIGGER performance_confirmed_assignment AFTER UPDATE OF state ON whatsapp_assignment_requests
FOR EACH ROW EXECUTE FUNCTION capture_confirmed_assignment_event();

CREATE OR REPLACE FUNCTION capture_human_response_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  IF NEW.first_human_response_at IS NULL OR
    (OLD.first_human_response_at IS NOT NULL AND
     NEW.first_human_response_at IS NOT DISTINCT FROM OLD.first_human_response_at) THEN RETURN NEW; END IF;
  k:='human_response:'||NEW.id::text;
  IF OLD.first_human_response_at IS NULL THEN
    INSERT INTO performance_events(event_key,event_type,source_id,inquiry_id,staff_id,branch_id_at_event,occurred_at,source,policy_version)
    SELECT k,'human_response',NEW.id::text,NEW.id,NEW.first_human_response_staff_id,
      s.branch_id,NEW.first_human_response_at,'wa_human_response:'||NEW.id::text,NEW.service_policy_id::text
    FROM staff_users s WHERE s.id=NEW.first_human_response_staff_id
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO performance_event_occurrence_revisions(event_key,occurred_at,staff_id,reason)
    VALUES(k,NEW.first_human_response_at,NEW.first_human_response_staff_id,'Earlier verified response evidence');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS performance_human_response ON inquiries;
CREATE TRIGGER performance_human_response AFTER UPDATE OF first_human_response_at ON inquiries
FOR EACH ROW EXECUTE FUNCTION capture_human_response_event();

CREATE OR REPLACE FUNCTION capture_deal_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
  IF NEW.attribution_status IN ('verified_attributed','verified_unattributed') THEN kind:='deal_confirmed';
  ELSIF NEW.attribution_status='cancelled' THEN kind:='deal_cancelled';
  ELSE RETURN NEW; END IF;
  INSERT INTO performance_events(event_key,event_type,source_id,lead_id,transaction_id,staff_id,occurred_at,source)
  VALUES(kind||':'||NEW.transaction_id::text||':'||NEW.version::text,kind,
    NEW.transaction_id::text||':'||NEW.version::text,NEW.lead_id,NEW.transaction_id,
    NEW.changed_by,CASE WHEN kind='deal_cancelled' THEN NEW.changed_at ELSE COALESCE(NEW.confirmed_at,NEW.changed_at) END,
    'transaction_version:'||NEW.transaction_id::text||':'||NEW.version::text)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS performance_deal_version ON transaction_performance_versions;
CREATE TRIGGER performance_deal_version AFTER INSERT ON transaction_performance_versions
FOR EACH ROW EXECUTE FUNCTION capture_deal_event();
