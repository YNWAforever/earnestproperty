import "@tanstack/react-start/server-only";
import { queryRows } from "./db.server";
import type { StaffAccess } from "./auth.server";
import {
  syncPageSchema,
  syncOperationSchema,
  type SyncOperationInput,
} from "./admin-property-sync.types";
import {
  readSyncWorkspace,
  requestSyncOperation,
  requireSyncRole,
} from "../mls/sync-run-repository.mjs";
import { workflowCapability, dispatchPropertySync } from "../mls/dispatch-property-sync.mjs";
export async function getAdminSyncWorkspace(input: unknown, actor: StaffAccess) {
  requireSyncRole(actor);
  const page = syncPageSchema.parse(input);
  return readSyncWorkspace({
    query: queryRows,
    actor,
    ...page,
    capabilities: {
      "28hse_agent_540": workflowCapability("28hse_agent_540"),
      propertyhk: workflowCapability("propertyhk"),
    },
  });
}
export async function startAdminSyncOperation(input: SyncOperationInput, actor: StaffAccess) {
  requireSyncRole(actor, ["admin"]);
  input = syncOperationSchema.parse(input);
  return requestSyncOperation({
    query: queryRows,
    actor,
    input,
    capability: workflowCapability(input.source),
    dispatch: dispatchPropertySync,
  });
}
