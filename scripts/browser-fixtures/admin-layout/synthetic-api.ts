// Layout evidence uses the existing owned ports, never a real database or provider.
export * from "../daily-work/synthetic-api";
export {
  fetchAdminEstateOptions,
  fetchAdminTransaction,
  saveAdminTransaction,
} from "../leave-guards/synthetic-api";

export {
  fetchAdminDistrictOptions,
  saveAdminProperty,
} from "../property-maintenance/synthetic-api";
export {
  fetchTransactionPerformance,
  saveTransactionPerformance,
  searchTransactionAttributionOptions,
  saveAdminFaq,
  deleteAdminFaq,
} from "../leave-guards/synthetic-api";
import { estate, article } from "../leave-guards/synthetic-api";
import type { AdminAgentProfileRow } from "../../../src/lib/neon/admin-data.types";
export const agent: AdminAgentProfileRow = {
  id: "20000000-0000-4000-8000-000000000001",
  auth_user_id: null,
  email: null,
  name_zh: "合成代理甲",
  name_en: "Synthetic Agent",
  job_title: "物業顧問",
  phone: null,
  whatsapp: null,
  licence_no: "E-123456",
  avatar_url: null,
  branch: "測試分行",
  branch_id: null,
  bio: "合成公開簡介",
  specialties: [],
  served_estate_slugs: [],
  public_slug: "synthetic-agent",
  show_on_website: false,
  display_order: 1,
  active: true,
  created_at: null,
  updated_at: null,
};
export const fetchAdminAgentEditorContext = async () => ({
  canManageIdentity: window.dailyWorkFixture.role === "admin",
});
export const fetchAdminAgentProfile = async () => structuredClone(agent);
export const fetchAdminBranches = async () => [];
export const saveAdminAgentProfile = async () => {
  throw Error("Agent writes are outside this geometry fixture");
};
export const fetchAdminCms = async () => ({
  estates: [estate],
  articles: [article],
  faqs: [],
  videos: [],
  media: [],
});
