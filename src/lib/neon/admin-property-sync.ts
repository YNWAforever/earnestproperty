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

import { z } from "zod";
import {
  withdrawalPageSchema,
  withdrawalPreviewSchema,
  withdrawalApplySchema,
  type WithdrawalApplyInput,
} from "./admin-property-sync.types";
async function reviewActor() {
  const { requireStaffAccess } = await import("./auth.server");
  return requireStaffAccess(getRequest(), ["admin", "manager"]);
}
const withdrawalReadServer = createServerFn({ method: "GET" })
  .inputValidator(withdrawalPageSchema)
  .handler(async ({ data }) => {
    const actor = await reviewActor();
    const { getWithdrawalCandidates } = await import("./admin-property-sync.server");
    return getWithdrawalCandidates(data, actor);
  });
const withdrawalPreviewServer = createServerFn({ method: "POST" })
  .inputValidator(withdrawalPreviewSchema)
  .handler(async ({ data }) => {
    const actor = await reviewActor();
    const { createWithdrawalPreview } = await import("./admin-property-sync.server");
    return createWithdrawalPreview(data, actor);
  });
const withdrawalApplyServer = createServerFn({ method: "POST" })
  .inputValidator(withdrawalApplySchema)
  .handler(async ({ data }) => {
    const actor = await reviewActor();
    const { executeWithdrawalPreview } = await import("./admin-property-sync.server");
    return executeWithdrawalPreview(data, actor);
  });
const withdrawalResultServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ idempotencyKey: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const actor = await reviewActor();
    const { getWithdrawalResult } = await import("./admin-property-sync.server");
    return getWithdrawalResult(data, actor);
  });
export async function fetchWithdrawalCandidates(input: {
  data: { source: "28hse_agent_540" | "propertyhk"; limit?: number; cursor?: string | null };
}) {
  return unwrapServerFnResponse(withdrawalReadServer(await withStaffAuthHeaders(input)));
}
export async function requestWithdrawalPreview(input: {
  data: { source: "28hse_agent_540" | "propertyhk"; candidateIds: string[] };
}) {
  return unwrapServerFnResponse(withdrawalPreviewServer(await withStaffAuthHeaders(input)));
}
export async function applyAdminWithdrawalPreview(input: { data: WithdrawalApplyInput }) {
  return unwrapServerFnResponse(withdrawalApplyServer(await withStaffAuthHeaders(input)));
}
export async function fetchWithdrawalResult(input: { data: { idempotencyKey: string } }) {
  return unwrapServerFnResponse(withdrawalResultServer(await withStaffAuthHeaders(input)));
}
