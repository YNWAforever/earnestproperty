import { z } from "zod";
import type { SyncStage, SyncHealth } from "../mls/sync-run-contract.mjs";
export const syncPageSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z
      .object({ at: z.string().datetime(), id: z.string().uuid() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export const syncOperationSchema = z
  .object({
    source: z.enum(["28hse_agent_540", "propertyhk"]),
    operation: z.enum(["collect", "ingestion", "publication"]),
    runId: z.string().uuid().optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type SyncOperationInput = z.infer<typeof syncOperationSchema>;
export interface SyncCapability {
  enabled: boolean;
  reason: string | null;
}
export interface SyncCard {
  label: string;
  source: string;
  branch: string | null;
  health: SyncHealth;
  message: string;
  connected: boolean;
  lastCollectionAt: string | null;
  lastAcceptedFullAt: string | null;
  lastPublishedAt: string | null;
  advertisements: number | null;
  backlog: number | null;
  publicCount: number | null;
  stages: Record<string, SyncStage>;
  branchEvidence: Record<string, string | number | boolean | null> | null;
  capability: SyncCapability;
}
export interface SyncHistoryRow {
  id: string;
  source: string;
  scope_id: string;
  operation: string;
  workflow_run_id: string | null;
  git_sha: string | null;
  request_asset: string | null;
  request_hash: string | null;
  receipt_id: string | null;
  stages: Record<string, SyncStage>;
  branches: Record<string, Record<string, string | number | boolean | null>>;
  counts: Record<string, number>;
  dispatch_status: string;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
}
export interface SyncWorkspace {
  cards: SyncCard[];
  history: SyncHistoryRow[];
  nextCursor: { at: string; id: string } | null;
  asOf: string;
}
