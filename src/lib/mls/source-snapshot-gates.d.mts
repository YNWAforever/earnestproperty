import type { DecodedSnapshot } from "./ingestion-contract.mjs";
export type SnapshotGate = {
  allowed: boolean;
  full: boolean;
  reasons: string[];
  inferAbsence: boolean;
};
export type AppliedBaseline = {
  fullCount: number;
  fullReceiptId?: string | null;
  source?: string;
  scopeId?: string;
  policyVersion?: string;
  parserVersion?: string;
  applied?: boolean;
  full?: boolean;
};
export function evaluateSnapshotGate(
  batch: DecodedSnapshot,
  baseline?: AppliedBaseline | null,
  policy?: { absenceEnabled?: boolean },
): SnapshotGate;
