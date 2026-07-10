import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { withStaffAuthHeaders } from "@/auth";
import { deriveAgentProfileEditorContext } from "./staff-security-policy";
import { WEBSITE_LISTING_NO_PATTERN } from "./website-inquiry.js";
import type {
  AdminAgentEditorContext,
  AdminAgentProfileInput,
  AdminAgentProfileMutationInput,
  AdminArticleInput,
  AdminAudienceInput,
  AdminCampaignInput,
  AdminConversationAiAssist,
  AdminConversationUpdateInput,
  AdminCrmSegmentPreview,
  AdminCmsVideoInput,
  AdminEstateInput,
  AdminFaqInput,
  AdminLeadActivityInput,
  AdminLeadUpdateInput,
  AdminListingFiltersInput,
  AdminPropertyInput,
  StaffRole,
} from "./admin-data.types";

async function requireStaff(roles: StaffRole[] = ["admin"]) {
  const { requireStaffAccess } = await import("./auth.server");
  return requireStaffAccess(getRequest(), roles);
}

const fetchAdminAgentEditorContextServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  return deriveAgentProfileEditorContext(staff.roles);
});

export async function fetchAdminAgentEditorContext(): Promise<AdminAgentEditorContext | null> {
  try {
    return await callStaffServerFn(async () =>
      fetchAdminAgentEditorContextServer(await withStaffAuthHeaders({})),
    );
  } catch (error) {
    if (isStaffAuthorizationError(error)) return null;
    throw error;
  }
}

const fetchAdminAgentProfilesServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminAgentProfiles();
});

export async function fetchAdminAgentProfiles() {
  return callStaffServerFn(async () =>
    fetchAdminAgentProfilesServer(await withStaffAuthHeaders({})),
  );
}

const fetchAdminAgentProfileServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminAgentProfile(data.id);
  });

export async function fetchAdminAgentProfile(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminAgentProfileServer(await withStaffAuthHeaders(options)),
  );
}

const saveAdminAgentProfileServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminAgentProfileMutationInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminAgentProfile(data, staff);
  });

export async function saveAdminAgentProfile(options: { data: AdminAgentProfileMutationInput }) {
  return callStaffServerFn(async () =>
    saveAdminAgentProfileServer(await withStaffAuthHeaders(options)),
  );
}

const STALE_SERVER_FN_RELOAD_KEY = "earnest-admin-stale-server-fn-reloaded";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  if (typeof status === "string") {
    const parsed = Number(status);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isStaffAuthorizationError(error: unknown) {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

function isStaleServerFunctionError(error: unknown) {
  const message = errorMessage(error);
  const status = errorStatus(error);
  if (status === 404 || status === 410) return true;
  if (status === 401 || status === 403) return false;
  return message === "HTTPError" && (status === null || status >= 500);
}

function storageFlagIsSet() {
  try {
    return window.sessionStorage.getItem(STALE_SERVER_FN_RELOAD_KEY) === "1";
  } catch {
    return true;
  }
}

function setStorageFlag() {
  try {
    window.sessionStorage.setItem(STALE_SERVER_FN_RELOAD_KEY, "1");
  } catch {
    return;
  }
}

function clearStorageFlag() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STALE_SERVER_FN_RELOAD_KEY);
  } catch {
    return;
  }
}

function reloadOnStaleServerFunction(error: unknown) {
  if (typeof window === "undefined" || !isStaleServerFunctionError(error)) return;
  if (storageFlagIsSet()) return;
  setStorageFlag();
  window.location.reload();
}

async function callStaffServerFn<T>(call: () => Promise<T>) {
  try {
    const result = await call();
    clearStorageFlag();
    return result;
  } catch (error) {
    reloadOnStaleServerFunction(error);
    throw error;
  }
}

const fetchAdminOverviewServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.getAdminOverview();
});

export async function fetchAdminOverview() {
  return callStaffServerFn(async () => fetchAdminOverviewServer(await withStaffAuthHeaders()));
}

const fetchAdminListingsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminListings({}, staff);
});

export async function fetchAdminListings() {
  return callStaffServerFn(async () => fetchAdminListingsServer(await withStaffAuthHeaders()));
}

const fetchAdminEstateOptionsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminEstateOptions();
});

export async function fetchAdminEstateOptions() {
  return callStaffServerFn(async () => fetchAdminEstateOptionsServer(await withStaffAuthHeaders()));
}

const fetchAdminPropertyServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.getAdminProperty(data.id);
  });

export async function fetchAdminProperty(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminPropertyServer(await withStaffAuthHeaders(options)),
  );
}

const saveAdminPropertyServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminPropertyInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminProperty(data, staff);
  });

export async function saveAdminProperty(options: { data: AdminPropertyInput }) {
  return callStaffServerFn(async () =>
    saveAdminPropertyServer(await withStaffAuthHeaders(options)),
  );
}

const deleteAdminPropertyServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminProperty(data.id, staff);
  });

export async function deleteAdminProperty(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    deleteAdminPropertyServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminCmsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCms();
});

export async function fetchAdminCms() {
  return callStaffServerFn(async () => fetchAdminCmsServer(await withStaffAuthHeaders()));
}

const fetchAdminCmsVideosServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminCmsVideos();
});

export async function fetchAdminCmsVideos() {
  return callStaffServerFn(async () => fetchAdminCmsVideosServer(await withStaffAuthHeaders()));
}

const saveAdminCmsVideoServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminCmsVideoInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminCmsVideo(data, staff);
  });

export async function saveAdminCmsVideo(options: { data: AdminCmsVideoInput }) {
  return callStaffServerFn(async () =>
    saveAdminCmsVideoServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminAiKnowledgeStatusServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminAiKnowledgeStatus(staff);
});

export const fetchAdminAiKnowledgeStatus = async function fetchAdminAiKnowledgeStatus() {
  return callStaffServerFn(async () =>
    fetchAdminAiKnowledgeStatusServer(await withStaffAuthHeaders()),
  );
};

const rebuildAdminAiKnowledgeServer = createServerFn({ method: "POST" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.rebuildAdminAiKnowledge(staff);
});

export const rebuildAdminAiKnowledge = async function rebuildAdminAiKnowledge() {
  return callStaffServerFn(async () => rebuildAdminAiKnowledgeServer(await withStaffAuthHeaders()));
};

const fetchAdminCrmSegmentsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminCrmSegments(staff);
});

export const fetchAdminCrmSegments = async function fetchAdminCrmSegments() {
  return callStaffServerFn(async () => fetchAdminCrmSegmentsServer(await withStaffAuthHeaders()));
};

const previewAdminCrmSegmentServer = createServerFn({ method: "POST" })
  .inputValidator((data: { prompt: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.previewAdminCrmSegment(data, staff);
  });

export const previewAdminCrmSegment = async function previewAdminCrmSegment(options: {
  data: { prompt: string };
}) {
  return callStaffServerFn(async () =>
    previewAdminCrmSegmentServer(await withStaffAuthHeaders(options)),
  );
};

type AdminCrmSegmentSaveInput = {
  id?: string;
  name: string;
  description: string | null;
  natural_language_prompt: string;
  structured_filters: AdminCrmSegmentPreview["filters"];
  status: "draft" | "active" | "archived";
};

const saveAdminCrmSegmentServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminCrmSegmentSaveInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminCrmSegment(data, staff);
  });

export const saveAdminCrmSegment = async function saveAdminCrmSegment(options: {
  data: AdminCrmSegmentSaveInput;
}) {
  return callStaffServerFn(async () =>
    saveAdminCrmSegmentServer(await withStaffAuthHeaders(options)),
  );
};

const materializeAdminCrmSegmentServer = createServerFn({ method: "POST" })
  .inputValidator((data: { segmentId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.materializeAdminCrmSegment(data, staff);
  });

export const materializeAdminCrmSegment = async function materializeAdminCrmSegment(options: {
  data: { segmentId: string };
}) {
  return callStaffServerFn(async () =>
    materializeAdminCrmSegmentServer(await withStaffAuthHeaders(options)),
  );
};

const fetchAdminLeadsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminLeads(staff);
});

export async function fetchAdminLeads() {
  return callStaffServerFn(async () => fetchAdminLeadsServer(await withStaffAuthHeaders()));
}

const fetchAdminConversationsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminConversations(staff);
});

export async function fetchAdminConversations() {
  return callStaffServerFn(async () => fetchAdminConversationsServer(await withStaffAuthHeaders()));
}

const fetchCommandCenterServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listCommandCenter(staff);
});

export async function fetchCommandCenter() {
  return callStaffServerFn(async () => fetchCommandCenterServer(await withStaffAuthHeaders()));
}

const completeAdminLeadActivityServer = createServerFn({ method: "POST" })
  .inputValidator((data: { activity_id: string; lead_id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.completeAdminLeadActivity(data, staff);
  });

export async function completeAdminLeadActivity(options: {
  data: { activity_id: string; lead_id: string };
}) {
  return callStaffServerFn(async () =>
    completeAdminLeadActivityServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminCampaignsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCampaigns();
});

export async function fetchAdminCampaigns() {
  return callStaffServerFn(async () => fetchAdminCampaignsServer(await withStaffAuthHeaders()));
}

const websiteInquirySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30),
    email: z.string().trim().max(254).email().optional().or(z.literal("")),
    message: z.string().trim().max(2000).optional().or(z.literal("")),
    listingNo: z.string().regex(WEBSITE_LISTING_NO_PATTERN).optional(),
    property_id: z.string().trim().uuid().optional(),
    consentWhatsapp: z.boolean().default(false),
  })
  // Public, untrusted path: never accept a caller-supplied agent assignment.
  .strip();

export type WebsiteInquiryInput = z.infer<typeof websiteInquirySchema>;

export const createWebsiteInquiry = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => websiteInquirySchema.parse(data))
  .handler(async ({ data }) => {
    const adminData = await import("./admin-data.server");
    return adminData.createWebsiteInquiry(data);
  });

const updateAdminInquiryStatusServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateInquiryStatus(data.id, data.status, staff);
  });

export async function updateAdminInquiryStatus(options: { data: { id: string; status: string } }) {
  return callStaffServerFn(async () =>
    updateAdminInquiryStatusServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminAgentsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminAgents();
});

export async function fetchAdminAgents() {
  return callStaffServerFn(async () => fetchAdminAgentsServer(await withStaffAuthHeaders()));
}

const fetchAdminWoztellStatusServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const woztell = await import("../woztell/woztell.server");
  return { woztellEnabled: woztell.woztellEnabled() };
});

export async function fetchAdminWoztellStatus() {
  return callStaffServerFn(async () =>
    fetchAdminWoztellStatusServer(await withStaffAuthHeaders({})),
  );
}

const saveAdminEstateServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminEstateInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminEstate(data, staff);
  });

export async function saveAdminEstate(options: { data: AdminEstateInput }) {
  return callStaffServerFn(async () => saveAdminEstateServer(await withStaffAuthHeaders(options)));
}

const saveAdminArticleServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminArticleInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminArticle(data, staff);
  });

export async function saveAdminArticle(options: { data: AdminArticleInput }) {
  return callStaffServerFn(async () => saveAdminArticleServer(await withStaffAuthHeaders(options)));
}

const saveAdminFaqServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminFaqInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminFaq(data, staff);
  });

export async function saveAdminFaq(options: { data: AdminFaqInput }) {
  return callStaffServerFn(async () => saveAdminFaqServer(await withStaffAuthHeaders(options)));
}

const deleteAdminFaqServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminFaq(data.id, staff);
  });

export async function deleteAdminFaq(options: { data: { id: string } }) {
  return callStaffServerFn(async () => deleteAdminFaqServer(await withStaffAuthHeaders(options)));
}

const reorderAdminFaqsServer = createServerFn({ method: "POST" })
  .inputValidator((data: { orderedIds: string[] }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.reorderAdminFaqs(data.orderedIds, staff);
  });

export async function reorderAdminFaqs(options: { data: { orderedIds: string[] } }) {
  return callStaffServerFn(async () => reorderAdminFaqsServer(await withStaffAuthHeaders(options)));
}

const fetchAdminMediaAssetsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminMediaAssets();
});

export async function fetchAdminMediaAssets() {
  return callStaffServerFn(async () => fetchAdminMediaAssetsServer(await withStaffAuthHeaders()));
}

const updateAdminMediaAssetServer = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; alt_text: string | null; owner_type: string; owner_id: string | null }) =>
      data,
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminMediaAsset(data, staff);
  });

export async function updateAdminMediaAsset(options: {
  data: { id: string; alt_text: string | null; owner_type: string; owner_id: string | null };
}) {
  return callStaffServerFn(async () =>
    updateAdminMediaAssetServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminListingsFilteredServer = createServerFn({ method: "GET" })
  .inputValidator((data: AdminListingFiltersInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.listAdminListings(data, staff);
  });

export async function fetchAdminListingsFiltered(options: { data: AdminListingFiltersInput }) {
  return callStaffServerFn(async () =>
    fetchAdminListingsFilteredServer(await withStaffAuthHeaders(options)),
  );
}

const updateAdminPropertyStatusServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: AdminPropertyInput["status"] }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminPropertyStatus(data.id, data.status, staff);
  });

export async function updateAdminPropertyStatus(options: {
  data: { id: string; status: AdminPropertyInput["status"] };
}) {
  return callStaffServerFn(async () =>
    updateAdminPropertyStatusServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminLeadServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminLead(data.id, staff);
  });

export async function fetchAdminLead(options: { data: { id: string } }) {
  return callStaffServerFn(async () => fetchAdminLeadServer(await withStaffAuthHeaders(options)));
}

const fetchAdminLeadAiProfileServer = createServerFn({ method: "GET" })
  .inputValidator((data: { leadId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminLeadAiProfile(data, staff);
  });

export const fetchAdminLeadAiProfile = async function fetchAdminLeadAiProfile(options: {
  data: { leadId: string };
}) {
  return callStaffServerFn(async () =>
    fetchAdminLeadAiProfileServer(await withStaffAuthHeaders(options)),
  );
};

const analyzeAdminLeadAiProfileServer = createServerFn({ method: "POST" })
  .inputValidator((data: { leadId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.analyzeAdminLeadAiProfile(data, staff);
  });

export const analyzeAdminLeadAiProfile = async function analyzeAdminLeadAiProfile(options: {
  data: { leadId: string };
}) {
  return callStaffServerFn(async () =>
    analyzeAdminLeadAiProfileServer(await withStaffAuthHeaders(options)),
  );
};

const approveAdminAiTagServer = createServerFn({ method: "POST" })
  .inputValidator((data: { tagId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.approveAdminAiTag(data, staff);
  });

export const approveAdminAiTag = async function approveAdminAiTag(options: {
  data: { tagId: string };
}) {
  return callStaffServerFn(async () =>
    approveAdminAiTagServer(await withStaffAuthHeaders(options)),
  );
};

const rejectAdminAiTagServer = createServerFn({ method: "POST" })
  .inputValidator((data: { tagId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.rejectAdminAiTag(data, staff);
  });

export const rejectAdminAiTag = async function rejectAdminAiTag(options: {
  data: { tagId: string };
}) {
  return callStaffServerFn(async () => rejectAdminAiTagServer(await withStaffAuthHeaders(options)));
};

const updateAdminLeadServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminLeadUpdateInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminLead(data, staff);
  });

export async function updateAdminLead(options: { data: AdminLeadUpdateInput }) {
  return callStaffServerFn(async () => updateAdminLeadServer(await withStaffAuthHeaders(options)));
}

const createAdminLeadActivityServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminLeadActivityInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.createAdminLeadActivity(data, staff);
  });

export async function createAdminLeadActivity(options: { data: AdminLeadActivityInput }) {
  return callStaffServerFn(async () =>
    createAdminLeadActivityServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminConversationServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminConversation(data.id, staff);
  });

export async function fetchAdminConversation(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminConversationServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminConversationAiAssistServer = createServerFn({ method: "GET" })
  .inputValidator((data: { conversationId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminConversationAiAssist(data, staff);
  });

export const fetchAdminConversationAiAssist =
  async function fetchAdminConversationAiAssist(options: {
    data: { conversationId: string };
  }): Promise<AdminConversationAiAssist> {
    return callStaffServerFn(async () =>
      fetchAdminConversationAiAssistServer(await withStaffAuthHeaders(options)),
    );
  };

const updateAdminConversationServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminConversationUpdateInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminConversation(data, staff);
  });

export async function updateAdminConversation(options: { data: AdminConversationUpdateInput }) {
  return callStaffServerFn(async () =>
    updateAdminConversationServer(await withStaffAuthHeaders(options)),
  );
}

export async function sendAdminConversationReply(options: {
  data: { conversationId: string; recipientId: string; text: string };
}) {
  const request = await withStaffAuthHeaders({
    headers: { "Content-Type": "application/json" },
  });
  const response = await fetch("/api/admin/woztell/send", {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(options.data),
  });
  const payload = await response.json().catch(() => null);

  if (payload && typeof payload === "object") {
    return payload as { ok: boolean; error?: string };
  }
  return {
    ok: false,
    error: response.statusText || "WhatsApp reply failed",
  };
}

const fetchAdminBlastOptionsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminBlastOptions();
});

export async function fetchAdminBlastOptions() {
  return callStaffServerFn(async () => fetchAdminBlastOptionsServer(await withStaffAuthHeaders()));
}

const saveAdminAudienceServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminAudienceInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminAudience(data, staff);
  });

export async function saveAdminAudience(options: { data: AdminAudienceInput }) {
  return callStaffServerFn(async () =>
    saveAdminAudienceServer(await withStaffAuthHeaders(options)),
  );
}

const previewAdminAudienceServer = createServerFn({ method: "GET" })
  .inputValidator((data: { audience_id?: string; filters?: AdminAudienceInput["filters"] }) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.previewAdminAudience(data);
  });

export async function previewAdminAudience(options: {
  data: { audience_id?: string; filters?: AdminAudienceInput["filters"] };
}) {
  return callStaffServerFn(async () =>
    previewAdminAudienceServer(await withStaffAuthHeaders(options)),
  );
}

const saveAdminCampaignServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminCampaignInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminCampaign(data, staff);
  });

export async function saveAdminCampaign(options: { data: AdminCampaignInput }) {
  return callStaffServerFn(async () =>
    saveAdminCampaignServer(await withStaffAuthHeaders(options)),
  );
}

const materializeCampaignRecipientsServer = createServerFn({ method: "POST" })
  .inputValidator((data: { campaign_id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.materializeCampaignRecipients(data.campaign_id, staff);
  });

export async function materializeCampaignRecipients(options: { data: { campaign_id: string } }) {
  return callStaffServerFn(async () =>
    materializeCampaignRecipientsServer(await withStaffAuthHeaders(options)),
  );
}

export async function sendAdminCampaignQueue(options: { data: { id: string } }) {
  const request = await withStaffAuthHeaders({
    headers: { "Content-Type": "application/json" },
  });
  const response = await fetch(`/api/admin/campaigns/${options.data.id}/queue`, {
    method: "POST",
    headers: request.headers,
  });
  const payload = await response.json().catch(() => null);

  if (payload && typeof payload === "object") {
    return payload as {
      ok: boolean;
      error?: string;
      materialization?: { eligible?: number };
    };
  }
  return {
    ok: false,
    error: response.statusText || "Campaign queue failed",
  };
}

const queueAdminCampaignServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.queueAdminCampaign(data.id, staff);
  });

export async function queueAdminCampaign(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    queueAdminCampaignServer(await withStaffAuthHeaders(options)),
  );
}

const cancelAdminCampaignServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.cancelAdminCampaign(data.id, staff);
  });

export async function cancelAdminCampaign(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    cancelAdminCampaignServer(await withStaffAuthHeaders(options)),
  );
}
