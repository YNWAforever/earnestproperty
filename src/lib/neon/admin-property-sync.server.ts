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

import { Client } from "@neondatabase/serverless";
import { getDatabaseUrl } from "./db.server";
import { verifyDailyTarget } from "../../../scripts/mls/verify-daily-target.mjs";
import {
  listWithdrawalCandidates,
  previewWithdrawals,
  applyWithdrawalPreview,
  readWithdrawalResult,
  WITHDRAWAL_RULE_VERSION,
} from "../mls/withdrawal-review.mjs";
import {
  withdrawalPageSchema,
  withdrawalPreviewSchema,
  withdrawalApplySchema,
  type WithdrawalApplyInput,
} from "./admin-property-sync.types";
async function withdrawalClient<T>(actor: StaffAccess, action: (client: Client) => Promise<T>) {
  requireSyncRole(actor);
  if (process.env.PROPERTY_SYNC_WITHDRAWAL_REVIEW_ENABLED !== "true")
    throw new Response("撤盤 review 尚未啟用", { status: 503 });
  const connectionString = getDatabaseUrl();
  try {
    verifyDailyTarget(connectionString, process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST);
  } catch {
    throw new Response("資料庫目標未核實", { status: 503 });
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}
export async function getWithdrawalCandidates(input: unknown, actor: StaffAccess) {
  requireSyncRole(actor);
  const data = withdrawalPageSchema.parse(input);
  if (process.env.PROPERTY_SYNC_WITHDRAWAL_REVIEW_ENABLED !== "true")
    return {
      enabled: false,
      reason: "撤盤 review 尚待資料庫 migration 及正式設定驗收",
      rows: [],
      nextCursor: null,
      ruleVersion: WITHDRAWAL_RULE_VERSION,
    };
  return withdrawalClient(actor, async (client) => ({
    enabled: true,
    ...(await listWithdrawalCandidates({ client, actor, ...data })),
  }));
}
export async function createWithdrawalPreview(input: unknown, actor: StaffAccess) {
  const data = withdrawalPreviewSchema.parse(input);
  return withdrawalClient(actor, (client) => previewWithdrawals({ client, actor, ...data }));
}
export async function executeWithdrawalPreview(input: WithdrawalApplyInput, actor: StaffAccess) {
  const data = withdrawalApplySchema.parse(input);
  return withdrawalClient(actor, (client) => applyWithdrawalPreview({ client, actor, ...data }));
}
export async function getWithdrawalResult(input: { idempotencyKey: string }, actor: StaffAccess) {
  return withdrawalClient(actor, (client) => readWithdrawalResult({ client, actor, ...input }));
}
