import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { withStaffAuthHeaders } from "@/auth";
import type { AdminPropertyInput, StaffRole } from "./admin-data.types";

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
