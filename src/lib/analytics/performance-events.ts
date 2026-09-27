export type PerformanceEventType =
  | "lead_qualified"
  | "viewing_completed"
  | "assignment_confirmed"
  | "human_response"
  | "deal_confirmed"
  | "deal_cancelled";
export type PerformanceEventQuality = "production" | "test" | "spam" | "unknown";
export type PerformanceEventInput = {
  idempotencyKey?: string;
  type: PerformanceEventType;
  inquiryId?: string;
  leadId?: string;
  transactionId?: string;
  staffId?: string;
  branchIdAtEvent?: string;
  occurredAt: string;
  source: string;
  quality: PerformanceEventQuality;
  policyVersion?: string;
};
export type PerformanceEventRecord = {
  event_key: string;
  event_type: PerformanceEventType;
  source_id: string;
  inquiry_id: string | null;
  lead_id: string | null;
  transaction_id: string | null;
  staff_id: string | null;
  branch_id_at_event: string | null;
  occurred_at: string;
  source: string;
  quality: PerformanceEventQuality;
  policy_version: string | null;
};
