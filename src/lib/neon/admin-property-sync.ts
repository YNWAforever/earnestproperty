import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
import { unwrapServerFnResponse } from "./server-fn-response";
import {
  syncPageSchema,
  syncOperationSchema,
  type SyncOperationInput,
} from "./admin-property-sync.types";
const readServer = createServerFn({ method: "GET" })
  .inputValidator(syncPageSchema)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    const { getAdminSyncWorkspace } = await import("./admin-property-sync.server");
    return getAdminSyncWorkspace(data, actor);
  });
const startServer = createServerFn({ method: "POST" })
  .inputValidator(syncOperationSchema)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin"]);
    const { startAdminSyncOperation } = await import("./admin-property-sync.server");
    return startAdminSyncOperation(data, actor);
  });
export async function fetchAdminSyncWorkspace(input: {
  data: { limit?: number; cursor?: { at: string; id: string } | null };
}) {
  return unwrapServerFnResponse(readServer(await withStaffAuthHeaders(input)));
}
export async function requestAdminSyncOperation(input: { data: SyncOperationInput }) {
  return unwrapServerFnResponse(startServer(await withStaffAuthHeaders(input)));
}
