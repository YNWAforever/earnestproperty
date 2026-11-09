-- Two correspondent agents per property, captured from the source listings.
--
-- 28hse shows two agents on every listing detail page ("代理個人牌照號碼" twice) and
-- property.hk names one in its URL (/asking_detail/<branch>/<agent>/<id>.html). Staff
-- licence numbers in staff_users.licence_no are the same EAA format (S-xxxxxx / E-xxxxxx),
-- so the source agents map back to staff deterministically.
--
-- The public listing page shows these agents; the visitor picks the one they want, and the
-- website enquiry records that choice so the new-lead WhatsApp alert reaches that colleague
-- (the alert already targets crm_leads.assigned_agent_id).
CREATE TABLE IF NOT EXISTS property_agents (
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 2),
  staff_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  -- Which source listing the agent came from: '28hse_agent_540' | 'propertyhk'.
  source text NOT NULL,
  source_name text,
  source_licence_no text,
  -- Source-side identity: the 28hse external listing id or the property.hk agent slug.
  source_ref text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, position)
);

CREATE INDEX IF NOT EXISTS property_agents_staff_idx ON property_agents (staff_id);

COMMENT ON TABLE property_agents IS
  'Up to two correspondent agents per property, mapped from the 28hse / property.hk listing.';
