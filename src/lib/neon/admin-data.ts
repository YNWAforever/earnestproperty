import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { withStaffAuthHeaders } from "@/auth";
import type {
  AdminArticleInput,
  AdminAudienceInput,
  AdminCampaignInput,
  AdminConversationUpdateInput,
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
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminListings();
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

const fetchAdminLeadsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminLeads();
});

export async function fetchAdminLeads() {
  return callStaffServerFn(async () => fetchAdminLeadsServer(await withStaffAuthHeaders()));
}

const fetchAdminConversationsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminConversations();
});

export async function fetchAdminConversations() {
  return callStaffServerFn(async () => fetchAdminConversationsServer(await withStaffAuthHeaders()));
}

const fetchAdminCampaignsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCampaigns();
});

export async function fetchAdminCampaigns() {
  return callStaffServerFn(async () => fetchAdminCampaignsServer(await withStaffAuthHeaders()));
}

export const createWebsiteInquiry = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      property_id: string;
      assigned_agent_id: string | null;
      name: string;
      phone: string;
      email: string | null;
      message: string | null;
    }) => data,
  )
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
    await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.listAdminListings(data);
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
    await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminLead(data.id);
  });

export async function fetchAdminLead(options: { data: { id: string } }) {
  return callStaffServerFn(async () => fetchAdminLeadServer(await withStaffAuthHeaders(options)));
}

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
    await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminConversation(data.id);
  });

export async function fetchAdminConversation(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminConversationServer(await withStaffAuthHeaders(options)),
  );
}

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
