// Reuse the shell ports of the no-link fixture; add only what the transaction form and the
// CMS dialogs read and write. Everything lives in memory: no SQL, no provider.
export * from "../no-link/synthetic-api";
import { fetchAdminPage as shellPage } from "../no-link/synthetic-api";

export const membership = { role: "agent", binding: "20000000-0000-4000-8000-000000000001" };
export async function fetchStaffSession() {
  return { status: "ok", staffId: membership.binding, roles: [membership.role] };
}

const estateId = "70000000-0000-4000-8000-000000000001";
export const estate = {
  id: estateId,
  slug: "synthetic-estate",
  name_zh: "合成屋苑",
  name_en: null,
  district_slug: "kowloon",
  developer: null,
  year_completed: null,
  phases: null,
  total_units: null,
  area_min: null,
  area_max: null,
  description: null,
  hero_image: null,
  facilities: [],
  seo_title: "合成標題",
  seo_description: null,
  updated_at: null,
};

type Row = Record<string, unknown>;
const transactions = new Map<string, Row>();
transactions.set("70000000-0000-4000-8000-0000000000aa", {
  id: "70000000-0000-4000-8000-0000000000aa",
  estate_id: estateId,
  estate_name_zh: "合成屋苑",
  deal_type: "sale",
  price: 8500000,
  saleable_area: 600,
  saleable_psf: 14166,
  deal_date: "2026-05-01",
  unit: "A",
  block: "1",
  floor_band: "中層",
  source: "合成來源",
  source_url: null,
  // B-04: the fixture session is an agent, who cannot edit a verified deal.
  verification_state: "unverified",
  published: false,
  agent_id: null,
  agent_name: null,
  attribution_status: null,
  finance_visible: true,
});
export const saves: Row[] = [];
(window as unknown as { leaveGuardFixture: unknown }).leaveGuardFixture = {
  saves,
  editorReads: 0,
};

export async function fetchAdminEstateOptions() {
  return [{ id: estateId, name_zh: estate.name_zh, district_slug: estate.district_slug }];
}
export async function fetchAdminTransaction({ data }: { data: { id: string } }) {
  return transactions.get(data.id) ?? null;
}
export async function saveAdminTransaction({ data }: { data: Row }) {
  const id = (data.id as string | undefined) ?? "70000000-0000-4000-8000-0000000000bb";
  saves.push({ ...data });
  transactions.set(id, {
    ...(transactions.get(id) ?? {}),
    ...data,
    id,
    verification_state: data.verified ? "verified" : "unverified",
    estate_name_zh: estate.name_zh,
    finance_visible: true,
  });
  return { id };
}

const faqs: Row[] = [];
export async function fetchAdminPage(options: { data: { resource: string } }) {
  const { resource } = options.data;
  if (resource === "estates") return { rows: [estate], total: 1, nextCursor: null };
  if (resource === "faqs") return { rows: faqs, total: faqs.length, nextCursor: null };
  if (resource === "articles" || resource === "videos" || resource === "media")
    return { rows: [], total: 0, nextCursor: null };
  return shellPage(options as never);
}
export async function fetchAdminAiKnowledgeStatus() {
  return { enabled: false };
}
export async function saveAdminFaq({ data }: { data: Row }) {
  faqs.push({ ...data, id: `faq-${faqs.length + 1}`, created_at: null });
  saves.push({ faq: data });
  return { id: `faq-${faqs.length}` };
}
export const checkAdminFaqConflicts = async () => ({ existing: [], archived: [] });
export const deleteAdminFaq = async () => ({ ok: true });
export const restoreAdminFaq = async () => ({ ok: true, version: "" });
export const rebuildAdminAiKnowledge = async () => ({});
export const saveAdminCmsVideo = async () => ({});
export const updateAdminMediaAsset = async () => ({});
export const fetchAdminDistrictOptions = async () => [{ slug: "kowloon", name_zh: "九龍" }];
// The finance panel is only mounted for admin and manager; this fixture signs in as an agent.
export const fetchTransactionPerformance = async () => null;
export const saveTransactionPerformance = async () => ({});
export const searchTransactionAttributionOptions = async () => [];
