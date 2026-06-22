import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { AdminPropertyInput, StaffRole } from "./admin-data.types";

async function requireStaff(roles: StaffRole[] = ["admin"]) {
  const { requireStaffAccess } = await import("./auth.server");
  return requireStaffAccess(getRequest(), roles);
}

export const fetchAdminOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.getAdminOverview();
});

export const fetchAdminListings = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminListings();
});

export const fetchAdminEstateOptions = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminEstateOptions();
});

export const fetchAdminProperty = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.getAdminProperty(data.id);
  });

export const saveAdminProperty = createServerFn({ method: "POST" })
  .inputValidator((data: AdminPropertyInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminProperty(data, staff);
  });

export const deleteAdminProperty = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminProperty(data.id, staff);
  });

export const fetchAdminCms = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCms();
});

export const fetchAdminLeads = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminLeads();
});

export const fetchAdminConversations = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminConversations();
});

export const fetchAdminCampaigns = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCampaigns();
});

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

export const updateAdminInquiryStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateInquiryStatus(data.id, data.status, staff);
  });
