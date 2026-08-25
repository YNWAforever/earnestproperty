import type {
  CrmAiProfile,
  CrmAiTag,
  CrmSegment,
  CrmSegmentEligibility,
  CrmSegmentFilters,
} from "@/lib/ai/ai-types";
import type { LeadPriority, WhatsappLinkStatus } from "./command-center";

export type StaffRole = "admin" | "manager" | "agent";

export type AdminPropertyInput = {
  id?: string;
  listing_no: string;
  title_zh: string;
  title_en: string | null;
  deal_type: "sale" | "rent";
  estate_id: string | null;
  district_slug: string;
  address: string | null;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  description: string | null;
  features: string[];
  status: "draft" | "active" | "sold" | "rented" | "offline";
  featured: boolean;
  images: string[];
  agent_id: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  video_url?: string | null;
};

export type AdminListingRow = {
  id: string;
  listing_no: string;
  title_zh: string;
  deal_type: string;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  status: string;
  featured: boolean;
  images: string[];
  updated_at: string;
  estate_name_zh: string | null;
  agent_name: string | null;
};

export type AdminEstateCmsRow = AdminEstateInput & {
  id: string;
  updated_at: string | null;
};

export type AdminArticleCmsRow = AdminArticleInput & {
  id: string;
  updated_at: string | null;
};

export type AdminFaqGroupRow = {
  scope: string;
  total: number;
};

export type AdminFaqCmsRow = AdminFaqInput & {
  id: string;
  created_at: string | null;
};

export type AdminCmsVideoInput = {
  id?: string;
  title: string;
  video_url: string;
  description: string | null;
  sort_order: number;
  published: boolean;
};

export type AdminCmsVideoRow = AdminCmsVideoInput & {
  id: string;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminCmsData = {
  estates: AdminEstateCmsRow[];
  articles: AdminArticleCmsRow[];
  faqGroups: AdminFaqGroupRow[];
  faqs: AdminFaqCmsRow[];
};

export type AdminLeadRow = {
  id: string;
  stage: string;
  intent: string;
  budget_min: number | null;
  budget_max: number | null;
  source: string;
  note: string | null;
  created_at: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  opt_in_whatsapp: boolean | null;
  assigned_agent_id: string | null;
  listing_no: string | null;
  property_title: string | null;
};

export type AdminConversationRow = {
  id: string;
  status: string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  name: string | null;
  phone: string | null;
  opted_out_whatsapp: boolean | null;
  last_text: string | null;
  last_direction: string | null;
};

export type AdminCampaignRow = {
  id: string;
  name: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  template_id: string | null;
  audience_id: string | null;
  element_name: string | null;
  language_code: string | null;
  template_status: string | null;
  audience_name: string | null;
  recipients: number;
  /** Per-recipient delivery outcome. Without these a blast where most sends
   * failed looked identical to a clean one. */
  sent: number;
  failed: number;
  blocked: number;
  pending: number;
};

export type AdminAgentRow = {
  id: string;
  name: string | null;
  email: string | null;
  roles: StaffRole[];
  active: boolean;
};

export type AdminAgentProfileInput = {
  id?: string;
  auth_user_id: string | null;
  email: string | null;
  name_zh: string | null;
  name_en: string | null;
  job_title: string | null;
  phone: string | null;
  whatsapp: string | null;
  licence_no: string | null;
  avatar_url: string | null;
  branch: string | null;
  bio: string | null;
  specialties: string[];
  served_estate_slugs: string[];
  public_slug: string | null;
  show_on_website: boolean;
  /** null means "append to the end" on create, and "leave unchanged" on update. */
  display_order: number | null;
  active: boolean;
};

export type AdminAgentProfileMutationInput = Omit<
  AdminAgentProfileInput,
  "auth_user_id" | "email" | "active"
> &
  Partial<Pick<AdminAgentProfileInput, "auth_user_id" | "email" | "active">>;

export type AdminAgentEditorContext = {
  canManageIdentity: boolean;
};

export type AdminAgentProfileRow = AdminAgentProfileInput & {
  id: string;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminEstateInput = {
  id?: string;
  slug: string;
  name_zh: string;
  name_en: string | null;
  district_slug: string;
  developer: string | null;
  year_completed: number | null;
  phases: number | null;
  total_units: number | null;
  area_min: number | null;
  area_max: number | null;
  description: string | null;
  hero_image: string | null;
  facilities: string[];
  seo_title: string | null;
  seo_description: string | null;
};

export type AdminArticleInput = {
  id?: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  cover_image: string | null;
  category: string | null;
  reading_minutes: number | null;
  published: boolean;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

export type AdminFaqInput = {
  id?: string;
  scope: string;
  question: string;
  answer: string;
  sort_order: number;
  /**
   * Bulk import only. Without it, creating a question that already exists in the
   * scope is refused rather than silently overwriting the existing row's answer.
   */
  upsert?: boolean;
};

export type AdminMediaAssetRow = {
  id: string;
  url: string;
  pathname: string;
  content_type: string | null;
  size_bytes: number | null;
  alt_text: string | null;
  owner_type: string;
  owner_id: string | null;
  created_at: string;
};

export type AdminListingFiltersInput = {
  q?: string;
  status?: string;
  deal_type?: "sale" | "rent" | "all";
  estate_id?: string;
  featured?: "yes" | "no" | "all";
  agent_id?: string;
};

export type AdminLeadDetail = AdminLeadRow & {
  contact_id: string | null;
  preferred_estates: string[];
  activities: AdminLeadActivityRow[];
};

export type AdminLeadActivityRow = {
  id: string;
  activity_type: string;
  body: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  staff_name: string | null;
};

export type AdminLeadUpdateInput = {
  id: string;
  stage: string;
  intent: string;
  budget_min: number | null;
  budget_max: number | null;
  preferred_estates: string[];
  assigned_agent_id: string | null;
  note: string | null;
};

export type AdminLeadActivityInput = {
  lead_id: string;
  contact_id: string | null;
  activity_type: "note" | "call" | "viewing" | "follow_up";
  body: string;
  due_at: string | null;
  completed_at: string | null;
};

export type AdminConversationMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  text: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export type AdminConversationDetail = AdminConversationRow & {
  contact_id: string | null;
  assigned_agent_id: string | null;
  woztell_member_id: string | null;
  messages: AdminConversationMessageRow[];
  /**
   * Server-computed: whether the viewer may clear this contact's WhatsApp
   * opt-out (admin/manager only). Computed here rather than from client-side
   * roles for the same reason admin.operations.tsx reads health.capabilities --
   * the client never sees the role list, and the server fn enforces it again.
   */
  can_clear_opt_out: boolean;
};

export type AdminConversationUpdateInput = {
  id: string;
  status: string;
  assigned_agent_id: string | null;
};

export type AdminConversationAiAssist = {
  summary: string;
  detectedIntent: string | null;
  urgency: string | null;
  suggestedReply: string | null;
  handoffNote: string | null;
};

export type AdminAudienceInput = {
  id?: string;
  name: string;
  description: string | null;
  filters: {
    intent?: string;
    source?: string;
    /** Multiple estate slugs are OR'd together. Renamed from the old singular
     * `estate` so a segment's preferred_estates list translates without loss
     * -- see createAudienceFromSegment. */
    estates?: string[];
    district_slug?: string;
    assigned_agent_id?: string;
    budget_min?: number;
    budget_max?: number;
    last_activity_days?: number;
    require_whatsapp_opt_in?: boolean;
  };
};

export type AdminAudiencePreview = {
  total: number;
  eligible: number;
  optedOut: number;
  missingPhone: number;
  notOptedIn: number;
};

export type AdminCampaignInput = {
  id?: string;
  name: string;
  template_id: string | null;
  audience_id: string | null;
  status: "draft" | "review" | "scheduled";
  scheduled_at: string | null;
};

export type AdminBlastOptions = {
  templates: Array<{
    id: string;
    element_name: string;
    language_code: string;
    status: string;
    category: string;
    description: string | null;
    /** WhatsApp send-time parameter substitutions, forwarded verbatim to
     * Woztell. Not the approved body text — that is never stored locally. */
    components: unknown;
  }>;
  audiences: Array<{
    id: string;
    name: string;
    description: string | null;
    filters: AdminAudienceInput["filters"];
  }>;
};

/** An approved WhatsApp template an agent can send outside the 24-hour reply
 * window. Same shape as AdminBlastOptions["templates"][number], scoped down to
 * what a 1:1 send needs -- no `status`, since the server only ever returns
 * templates whose status already starts with "active". */
export type AdminWhatsappTemplateRow = {
  id: string;
  element_name: string;
  language_code: string;
  category: string;
  description: string | null;
  components: unknown;
};

export type AdminAiKnowledgeStatus = {
  enabled: boolean;
  sources: number;
  chunks: number;
  publicChunks: number;
  staleChunks: number;
  lastIndexedAt: string | null;
};

export type AdminAiKnowledgeRebuildResult = {
  indexedSources: number;
  indexedChunks: number;
};

export type AdminLeadAiProfile = {
  profile: CrmAiProfile | null;
  tags: CrmAiTag[];
};

export type AdminCrmSegmentPreview = {
  filters: CrmSegmentFilters;
  total: number;
  eligible: number;
  contacts: Array<{
    contact_id: string;
    lead_id: string | null;
    name: string | null;
    phone: string | null;
    eligibility_status: CrmSegmentEligibility;
    confidence: number;
    reason: string;
  }>;
};

export type AdminCrmSegmentRow = CrmSegment & {
  members: number;
  eligible_members: number;
};

export type CommandCenterFilterKey =
  | "today"
  | "high_score"
  | "unassigned"
  | "live_agent"
  | "whatsapp"
  | "all";

export type CommandCenterRow = {
  lead_id: string;
  contact_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  intent: string | null;
  budget_min: number | null;
  budget_max: number | null;
  preferred_estates: string[];
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  lead_score: number | null;
  urgency: string | null;
  timeline: string | null;
  budget_band: string | null;
  summary: string | null;
  next_best_action: string | null;
  last_analyzed_at: string | null;
  has_overdue_followup: boolean;
  next_followup_due_at: string | null;
  last_activity_at: string | null;
  handoff_status: string | null;
  handoff_at: string | null;
  whatsapp: WhatsappLinkStatus;
  priority: LeadPriority;
};

export type CommandCenterKpis = {
  hot: number;
  overdue: number;
  unassigned: number;
  handoffs: number;
  whatsapp_blocked: number;
};

export type CommandCenterData = {
  rows: CommandCenterRow[];
  kpis: CommandCenterKpis;
  generated_at: string;
  woztell_enabled: boolean;
};

export type StaffAccessRole = "admin" | "manager" | "agent";

/** One key per entry in STAFF_OWNERSHIP_COLUMNS, keyed by table name. */
export type StaffOwnedCounts = {
  properties: number;
  crm_contacts: number;
  crm_leads: number;
  inquiries: number;
  whatsapp_conversations: number;
  live_agent_sessions: number;
};

export type StaffAccessSummary = {
  staffId: string;
  roles: StaffAccessRole[];
  active: boolean;
  /** True when the viewer is looking at their own record. */
  isSelf: boolean;
  /** True when removing this person's admin would leave the system with none. */
  isLastAdmin: boolean;
  /** True when this email is in ADMIN_BOOTSTRAP_EMAILS -- an owner account that
   * cannot be demoted or deactivated through the UI by anyone. */
  isProtected: boolean;
  owned: StaffOwnedCounts;
  ownedTotal: number;
};
