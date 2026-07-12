CREATE TABLE IF NOT EXISTS ai_content_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('estate','article','faq','video','listing')),
  resource_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('generate','improve','shorten','translate','seo_optimize','fact_check')),
  selected_fields TEXT[] NOT NULL,
  source_fingerprint TEXT NOT NULL,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  patches JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT NOT NULL DEFAULT 'opencode_go',
  model TEXT,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generating','generated','partially_applied','applied','rejected','expired','failed')),
  accepted_fields TEXT[] NOT NULL DEFAULT '{}',
  requested_by UUID NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  decided_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  latency_ms INTEGER,
  usage_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_content_proposals_one_generating_per_staff_idx
  ON ai_content_proposals(requested_by) WHERE status = 'generating';
CREATE INDEX IF NOT EXISTS ai_content_proposals_resource_idx ON ai_content_proposals(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_content_proposals_staff_usage_idx ON ai_content_proposals(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_content_proposals_expiry_idx ON ai_content_proposals(status, expires_at);
