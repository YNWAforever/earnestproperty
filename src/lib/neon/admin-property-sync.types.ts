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

export const withdrawalPageSchema = z
  .object({
    source: z.enum(["28hse_agent_540", "propertyhk"]),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().uuid().nullable().optional(),
  })
  .strict();
export const withdrawalPreviewSchema = z
  .object({
    source: z.enum(["28hse_agent_540", "propertyhk"]),
    candidateIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();
export const withdrawalApplySchema = z
  .object({
    previewId: z.string().uuid(),
    selectedIds: z.array(z.string().uuid()).min(1).max(100),
    expectedVersions: z.record(z.string().regex(/^[a-f0-9]{32}$/)),
    idempotencyKey: z.string().uuid(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export interface WithdrawalDecision {
  allowed: boolean;
  approval: string;
  reason: string;
  ruleVersion: string;
}
export interface WithdrawalRow {
  candidateId: string;
  propertyNo: string;
  title: string;
  dealType: string;
  version: string;
  status: string;
  decision: WithdrawalDecision;
  evidence: { kind: string; terminalReason: string | null; otherActiveSources: string[] };
}
export interface WithdrawalPage {
  enabled: boolean;
  reason?: string;
  rows: WithdrawalRow[];
  nextCursor: string | null;
  ruleVersion: string;
}
export interface WithdrawalPreview {
  previewId: string;
  expiresAt: string;
  rows: WithdrawalRow[];
}
export interface WithdrawalResult {
  candidateId: string;
  propertyNo: string;
  status: string;
  reason?: string;
  beforeVersion?: string;
  afterVersion?: string;
}
export type WithdrawalApplyInput = z.infer<typeof withdrawalApplySchema>;
export interface WithdrawalBatch {
  batchId?: string;
  results: WithdrawalResult[];
  replayed?: boolean;
  status?: string;
}
