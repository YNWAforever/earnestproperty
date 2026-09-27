-- Acquisition quality is explicit; legacy enquiries without review stay unknown.
CREATE TABLE IF NOT EXISTS inquiry_quality_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inquiry_id uuid NOT NULL REFERENCES inquiries(id),
  quality text NOT NULL CHECK(quality IN ('production','test','spam','unknown')),
  reason text NOT NULL CHECK(length(btrim(reason))>=8),
  changed_by uuid NOT NULL REFERENCES staff_users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiry_quality_latest ON inquiry_quality_revisions(inquiry_id,id DESC);
CREATE OR REPLACE FUNCTION reject_inquiry_quality_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'inquiry quality history is append-only'; END $$;
DROP TRIGGER IF EXISTS inquiry_quality_immutable ON inquiry_quality_revisions;
CREATE TRIGGER inquiry_quality_immutable BEFORE UPDATE OR DELETE ON inquiry_quality_revisions
FOR EACH ROW EXECUTE FUNCTION reject_inquiry_quality_change();
CREATE OR REPLACE VIEW inquiry_quality_records AS
SELECT i.id AS inquiry_id,
  COALESCE(q.quality,CASE WHEN i.status='spam' THEN 'spam' ELSE 'unknown' END) AS quality,
  q.changed_at AS quality_changed_at
FROM inquiries i
LEFT JOIN LATERAL (
 SELECT quality,changed_at FROM inquiry_quality_revisions WHERE inquiry_id=i.id ORDER BY id DESC LIMIT 1
) q ON true;
