export type DecimalString = string;
export type TransactionAttributionStatus =
  | "draft"
  | "verified_attributed"
  | "verified_unattributed"
  | "cancelled";
export type AgentCredit = { staffId: string; branchIdAtClose: string | null; shareBps: number };
export type TransactionPerformanceInput = {
  transactionId: string;
  expectedVersion: number;
  leadId: string | null;
  publicListingNo: string | null;
  dealType: "sale" | "rent";
  confirmedAt: string | null;
  commissionReceivable: DecimalString | null;
  commissionReceived: DecimalString | null;
  credits: AgentCredit[];
  attributionStatus: TransactionAttributionStatus;
  reason: string;
};
export type TransactionPerformance = Omit<
  TransactionPerformanceInput,
  "expectedVersion" | "reason"
> & {
  version: number;
  credits: AgentCredit[];
};
