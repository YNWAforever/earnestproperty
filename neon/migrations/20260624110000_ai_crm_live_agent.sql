CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  CREATE TYPE ai_knowledge_source_type AS ENUM ('faq', 'estate', 'district', 'article', 'listing', 'manual_public');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE ai_visibility AS ENUM ('public', 'staff');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE crm_ai_tag_safety AS ENUM ('factual', 'sensitive', 'judgmental');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE crm_ai_tag_status AS ENUM ('suggested', 'approved', 'rejected', 'auto_applied');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE crm_segment_status AS ENUM ('draft', 'active', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE crm_segment_eligibility AS ENUM ('eligible', 'missing_phone', 'not_opted_in', 'opted_out', 'blocked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE live_agent_session_status AS ENUM ('open', 'qualified', 'handoff_requested', 'handoff_completed', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE live_agent_message_direction AS ENUM ('visitor', 'assistant', 'staff', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type ai_knowledge_source_type NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url_path TEXT,
  locale TEXT NOT NULL DEFAULT 'zh-HK',
  public_visibility ai_visibility NOT NULL DEFAULT 'public',
  published BOOLEAN NOT NULL DEFAULT true,
  last_indexed_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  chunk_text TEXT NOT NULL,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  estate_slug TEXT,
  district_slug TEXT,
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  visibility ai_visibility NOT NULL DEFAULT 'public',
  freshness_score NUMERIC NOT NULL DEFAULT 1,
  embedding vector(1536),
  content_hash TEXT NOT NULL,
  stale BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_ai_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES crm_leads(id) ON DELETE CASCADE,
  intent TEXT,
  intent_confidence NUMERIC,
  budget_band TEXT,
  preferred_estates TEXT[] NOT NULL DEFAULT '{}',
  urgency TEXT,
  timeline TEXT,
  language TEXT,
  lead_score INTEGER NOT NULL DEFAULT 0,
  next_best_action TEXT,
  summary TEXT,
  last_analyzed_at TIMESTAMPTZ,
  analysis_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (contact_id IS NOT NULL OR lead_id IS NOT NULL),
  UNIQUE (contact_id, lead_id)
);

CREATE TABLE IF NOT EXISTS crm_ai_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES crm_leads(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  safety_level crm_ai_tag_safety NOT NULL DEFAULT 'factual',
  status crm_ai_tag_status NOT NULL DEFAULT 'suggested',
  confidence NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  created_by_ai BOOLEAN NOT NULL DEFAULT true,
  approved_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (contact_id IS NOT NULL OR lead_id IS NOT NULL),
  UNIQUE (contact_id, lead_id, tag)
);

CREATE TABLE IF NOT EXISTS crm_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  natural_language_prompt TEXT NOT NULL,
  structured_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  status crm_segment_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_segment_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES crm_segments(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES crm_leads(id) ON DELETE CASCADE,
  confidence NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  eligibility_status crm_segment_eligibility NOT NULL DEFAULT 'blocked',
  staff_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (contact_id IS NOT NULL OR lead_id IS NOT NULL),
  UNIQUE (segment_id, contact_id, lead_id)
);

CREATE TABLE IF NOT EXISTS live_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id TEXT,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  source_path TEXT,
  status live_agent_session_status NOT NULL DEFAULT 'open',
  intent TEXT,
  budget_min NUMERIC,
  budget_max NUMERIC,
  preferred_estates TEXT[] NOT NULL DEFAULT '{}',
  timeline TEXT,
  opt_in_whatsapp BOOLEAN NOT NULL DEFAULT false,
  assigned_agent_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_agent_sessions(id) ON DELETE CASCADE,
  direction live_agent_message_direction NOT NULL,
  message_text TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  safety_flags TEXT[] NOT NULL DEFAULT '{}',
  shown_publicly BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL,
  actor_id UUID,
  action TEXT NOT NULL,
  subject_type TEXT,
  subject_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_type ON ai_knowledge_sources(source_type, published);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_public ON ai_knowledge_chunks(visibility, stale, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_embedding ON ai_knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_crm_ai_profiles_lead ON crm_ai_profiles(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_ai_profiles_contact ON crm_ai_profiles(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_ai_tags_lead ON crm_ai_tags(lead_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_ai_tags_contact ON crm_ai_tags(contact_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_segments_status ON crm_segments(status);
CREATE INDEX IF NOT EXISTS idx_crm_segment_memberships_segment ON crm_segment_memberships(segment_id, eligibility_status);
CREATE INDEX IF NOT EXISTS idx_live_agent_sessions_contact ON live_agent_sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_live_agent_messages_session ON live_agent_messages(session_id, created_at);
