export type StaffRole = "admin" | "manager" | "agent";

export type AdminPropertyInput = {
  id?: string;
  listing_no: string;
  title_zh: string;
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
  status: "draft" | "active" | "sold" | "rented" | "offline";
  featured: boolean;
  images: string[];
  agent_id: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
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

export type AdminEstateCmsRow = {
  id: string;
  slug: string;
  name_zh: string;
  district_slug: string;
  total_units: number | null;
  updated_at: string | null;
};

export type AdminArticleCmsRow = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string | null;
};

export type AdminFaqGroupRow = {
  scope: string;
  total: number;
};

export type AdminCmsData = {
  estates: AdminEstateCmsRow[];
  articles: AdminArticleCmsRow[];
  faqGroups: AdminFaqGroupRow[];
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
  element_name: string | null;
  language_code: string | null;
  audience_name: string | null;
  recipients: number;
};

export type AdminAgentRow = {
  id: string;
  name: string | null;
  email: string | null;
  roles: StaffRole[];
  active: boolean;
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
  assigned_agent_id: string | null;
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
};

export type AdminConversationUpdateInput = {
  id: string;
  status: string;
  assigned_agent_id: string | null;
};

export type AdminAudienceInput = {
  id?: string;
  name: string;
  description: string | null;
  filters: {
    intent?: string;
    source?: string;
    estate?: string;
    assigned_agent_id?: string;
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
  templates: Array<{ id: string; element_name: string; language_code: string; status: string }>;
  audiences: Array<{ id: string; name: string; description: string | null }>;
};
