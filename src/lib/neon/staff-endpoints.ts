import { dispatchWorkspaceRequest } from "../admin/workspace-request";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
import { z } from "zod";
const list = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  return (await import("./staff-endpoints.server")).listStaffEndpoints(
    await requireStaffAccess(getRequest(), ["admin", "manager"]),
  );
});
const save = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        id: z.string().uuid().optional(),
        expectedVersion: z.number().int().positive().optional(),
        staffId: z.string().uuid(),
        transport: z.enum(["inbox_private_note", "staff_whatsapp"]),
        destinationReference: z.string().max(256).optional(),
        verificationRef: z.string().max(160).optional(),
        permissionRef: z.string().min(1).max(160),
        allowAllHours: z.boolean(),
        enabled: z.boolean(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./staff-endpoints.server")).saveStaffEndpoint(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const health = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const r = await (
    await import("../whatsapp-enquiries/staff-notifications.server")
  ).getStaffNotificationHealth(await requireStaffAccess(getRequest(), ["admin", "manager"]));
  return {
    schemaAvailable: r.schemaAvailable,
    counts: Object.fromEntries(Object.entries(r.counts).map(([k, v]) => [k, Number(v ?? 0)])),
  };
});
export const fetchStaffEndpoints = async (isWorkspaceCurrent?: () => boolean) =>
  dispatchWorkspaceRequest(
    () => withStaffAuthHeaders({}),
    (prepared) => list(prepared),
    isWorkspaceCurrent,
  );
export const updateStaffEndpoint = async (
  data: Parameters<typeof save>[0]["data"],
  isWorkspaceCurrent?: () => boolean,
) =>
  dispatchWorkspaceRequest(
    () => withStaffAuthHeaders({ data }),
    (prepared) => save(prepared),
    isWorkspaceCurrent,
  );
export const fetchStaffNotificationHealth = async (isWorkspaceCurrent?: () => boolean) =>
  dispatchWorkspaceRequest(
    () => withStaffAuthHeaders({}),
    (prepared) => health(prepared),
    isWorkspaceCurrent,
  );

const attention = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  return (await import("./staff-endpoints.server")).listStaffAttention(
    await requireStaffAccess(getRequest(), ["admin", "manager"]),
  );
});
export const fetchStaffAttention = async (isWorkspaceCurrent?: () => boolean) =>
  dispatchWorkspaceRequest(
    () => withStaffAuthHeaders({}),
    (prepared) => attention(prepared),
    isWorkspaceCurrent,
  );

const disable = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() }).strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./staff-endpoints.server")).disableStaffEndpoint(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const turnOffStaffEndpoint = async (
  data: Parameters<typeof disable>[0]["data"],
  isWorkspaceCurrent?: () => boolean,
) =>
  dispatchWorkspaceRequest(
    () => withStaffAuthHeaders({ data }),
    (prepared) => disable(prepared),
    isWorkspaceCurrent,
  );

const reviewEvents = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  return (await import("./staff-endpoints.server")).listStaffEventReview(
    await requireStaffAccess(getRequest(), ["admin", "manager"]),
  );
});
export const fetchStaffEventReview = async (isWorkspaceCurrent?: () => boolean) =>
  dispatchWorkspaceRequest(
    () => withStaffAuthHeaders({}),
    (prepared) => reviewEvents(prepared),
    isWorkspaceCurrent,
  );
