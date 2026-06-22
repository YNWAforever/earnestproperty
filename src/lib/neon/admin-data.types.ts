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
