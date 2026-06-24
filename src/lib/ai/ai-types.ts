export type AiVisibility = "public" | "staff";
export type AiKnowledgeSourceType =
  | "faq"
  | "estate"
  | "district"
  | "article"
  | "listing"
  | "manual_public";
export type AiTagSafetyLevel = "factual" | "sensitive" | "judgmental";
export type AiTagStatus = "suggested" | "approved" | "rejected" | "auto_applied";
export type CrmSegmentStatus = "draft" | "active" | "archived";
export type CrmSegmentEligibility =
  | "eligible"
  | "missing_phone"
  | "not_opted_in"
  | "opted_out"
  | "blocked";

export type AiKnowledgeSource = {
  id: string;
  source_type: AiKnowledgeSourceType;
  source_id: string;
  title: string;
  url_path: string | null;
  locale: string;
  public_visibility: AiVisibility;
  published: boolean;
  last_indexed_at: string | null;
  content_hash: string;
};

export type AiKnowledgeChunk = {
  id: string;
  source_id: string;
  source_type?: AiKnowledgeSourceType;
  title?: string;
  url_path?: string | null;
  sort_order: number;
  chunk_text: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  estate_slug: string | null;
  district_slug: string | null;
  listing_id: string | null;
  visibility: AiVisibility;
  freshness_score: number;
  stale: boolean;
  published?: boolean;
};

export type CrmAiProfile = {
  id: string;
  contact_id: string | null;
  lead_id: string | null;
  intent: string | null;
  intent_confidence: number | null;
  budget_band: string | null;
  preferred_estates: string[];
  urgency: string | null;
  timeline: string | null;
  language: string | null;
  lead_score: number;
  next_best_action: string | null;
  summary: string | null;
  last_analyzed_at: string | null;
  analysis_version: string;
};

export type CrmAiTag = {
  id: string;
  contact_id: string | null;
  lead_id: string | null;
  tag: string;
  category: string;
  safety_level: AiTagSafetyLevel;
  status: AiTagStatus;
  confidence: number;
  reason: string | null;
  created_by_ai: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export type CrmSegmentFilters = {
  intent?: string;
  district_slug?: string;
  preferred_estates?: string[];
  budget?: { min: number | null; max: number | null };
  source?: string;
  assigned_agent_id?: string;
  last_activity_days?: number;
  require_whatsapp_opt_in?: boolean;
};

export type CrmSegment = {
  id: string;
  name: string;
  description: string | null;
  natural_language_prompt: string;
  structured_filters: CrmSegmentFilters;
  status: CrmSegmentStatus;
  created_at: string;
  updated_at: string;
};

export type CrmSegmentMembership = {
  id: string;
  segment_id: string;
  contact_id: string | null;
  lead_id: string | null;
  confidence: number;
  reason: string | null;
  eligibility_status: CrmSegmentEligibility;
  staff_approved: boolean;
};

export type LiveAgentSession = {
  id: string;
  anonymous_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  source_path: string | null;
  status: "open" | "qualified" | "handoff_requested" | "handoff_completed" | "closed";
  intent: string | null;
  budget_min: number | null;
  budget_max: number | null;
  preferred_estates: string[];
  timeline: string | null;
  opt_in_whatsapp: boolean;
};

export type LiveAgentMessage = {
  id: string;
  session_id: string;
  direction: "visitor" | "assistant" | "staff" | "system";
  message_text: string;
  citations: Array<{ title: string; url_path: string | null; source_type: string }>;
  safety_flags: string[];
  shown_publicly: boolean;
  created_at: string;
};
