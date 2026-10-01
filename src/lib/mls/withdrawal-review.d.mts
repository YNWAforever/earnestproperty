import type { StaffAccess } from "../neon/auth.server";
import type {
  WithdrawalPage,
  WithdrawalPreview,
  WithdrawalBatch,
  WithdrawalApplyInput,
} from "../neon/admin-property-sync.types";
export const WITHDRAWAL_RULE_VERSION: string;
export function listWithdrawalCandidates(options: {
  client: any;
  actor: StaffAccess;
  source: string;
  limit?: number;
  cursor?: string | null;
}): Promise<Omit<WithdrawalPage, "enabled">>;
export function previewWithdrawals(options: {
  client: any;
  actor: StaffAccess;
  source: string;
  candidateIds: string[];
}): Promise<WithdrawalPreview>;
export function applyWithdrawalPreview(
  options: WithdrawalApplyInput & { client: any; actor: StaffAccess },
): Promise<WithdrawalBatch>;
export function readWithdrawalResult(options: {
  client: any;
  actor: StaffAccess;
  idempotencyKey: string;
}): Promise<WithdrawalBatch>;
