import type { StaffAccess } from "./auth.server.ts";
import type { TransactionPerformanceInput } from "./transaction-performance.types.ts";
export function validatePerformanceInput(
  input: TransactionPerformanceInput,
  actor: StaffAccess,
): TransactionPerformanceInput;
export function buildSavePerformanceQuery(
  input: TransactionPerformanceInput,
  actor: StaffAccess,
): { statement: string; params: unknown[] };
export const SAVE_PERFORMANCE_SQL: string;
