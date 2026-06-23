import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { withStaffAuthHeaders } from "@/auth";
import type { AdminPropertyInput, StaffRole } from "./admin-data.types";

async function requireStaff(roles: StaffRole[] = ["admin"]) {
  const { requireStaffAccess } = await import("./auth.server");
  return requireStaffAccess(getRequest(), roles);
}

const fetchAdminOverviewServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.getAdminOverview();
});

export async function fetchAdminOverview() {
  return fetchAdminOverviewServer(await withStaffAuthHeaders());
}

const fetchAdminListingsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminListings();
});

export async function fetchAdminListings() {
  return fetchAdminListingsServer(await withStaffAuthHeaders());
}

const fetchAdminEstateOptionsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminEstateOptions();
});

export async function fetchAdminEstateOptions() {
  return fetchAdminEstateOptionsServer(await withStaffAuthHeaders());
}

const fetchAdminPropertyServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.getAdminProperty(data.id);
  });

export async function fetchAdminProperty(options: { data: { id: string } }) {
  return fetchAdminPropertyServer(await withStaffAuthHeaders(options));
}

const saveAdminPropertyServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminPropertyInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminProperty(data, staff);
  });

export async function saveAdminProperty(options: { data: AdminPropertyInput }) {
  return saveAdminPropertyServer(await withStaffAuthHeaders(options));
}

const deleteAdminPropertyServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminProperty(data.id, staff);
  });

export async function deleteAdminProperty(options: { data: { id: string } }) {
  return deleteAdminPropertyServer(await withStaffAuthHeaders(options));
}

const fetchAdminCmsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCms();
});

export async function fetchAdminCms() {
  return fetchAdminCmsServer(await withStaffAuthHeaders());
}

const fetchAdminLeadsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminLeads();
});

export async function fetchAdminLeads() {
  return fetchAdminLeadsServer(await withStaffAuthHeaders());
}

const fetchAdminConversationsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminConversations();
});

export async function fetchAdminConversations() {
  return fetchAdminConversationsServer(await withStaffAuthHeaders());
}

const fetchAdminCampaignsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCampaigns();
});

export async function fetchAdminCampaigns() {
  return fetchAdminCampaignsServer(await withStaffAuthHeaders());
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
  return updateAdminInquiryStatusServer(await withStaffAuthHeaders(options));
}
