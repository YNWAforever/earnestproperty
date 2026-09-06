import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { withStaffAuthHeaders } from "@/auth";
import { unwrapServerFnResponse } from "./server-fn-response.ts";
import {
  propertyGroupFiltersSchema,
  propertyManagementSchema,
  type PropertyGroupFilters,
  type PropertyManagementInput,
} from "./admin-properties.types.ts";
async function staff() {
  const { requireStaffAccess } = await import("./auth.server");
  return requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
}
const groupsServer = createServerFn({ method: "GET" })
  .inputValidator(propertyGroupFiltersSchema)
  .handler(async ({ data }) => {
    const actor = await staff();
    const { listAdminPropertyGroups } = await import("./admin-properties.server");
    return listAdminPropertyGroups(data, actor);
  });
const detailServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1).max(100) }).strict())
  .handler(async ({ data }) => {
    const actor = await staff();
    const { getAdminManagedProperty } = await import("./admin-properties.server");
    return getAdminManagedProperty(data.id, actor);
  });
const saveServer = createServerFn({ method: "POST" })
  .inputValidator(propertyManagementSchema)
  .handler(async ({ data }) => {
    const actor = await staff();
    const { saveAdminPropertyManagement } = await import("./admin-property-management.server");
    return saveAdminPropertyManagement(data, actor);
  });
export async function fetchAdminPropertyGroups(input: { data: PropertyGroupFilters }) {
  return unwrapServerFnResponse(groupsServer(await withStaffAuthHeaders(input)));
}
export async function fetchAdminManagedProperty(input: { data: { id: string } }) {
  return unwrapServerFnResponse(detailServer(await withStaffAuthHeaders(input)));
}
export async function saveAdminPropertyManagement(input: { data: PropertyManagementInput }) {
  return unwrapServerFnResponse(saveServer(await withStaffAuthHeaders(input)));
}
