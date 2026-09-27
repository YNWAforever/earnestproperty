export type PerformanceFilters = {
  start: string;
  end: string;
  branchId?: string | null;
  staffId?: string | null;
  source?: "website" | "whatsapp" | "28hse" | "youtube" | "other" | "unknown" | null;
  dealType?: "sale" | "rent" | null;
  cohortWindowDays: 30 | 90;
};
export type PerformanceMetric = {
  value: number | string | null;
  unit: "count" | "ratio" | "minutes" | "HKD";
  denominator: number | null;
  sampleSize: number | null;
  status: "ready" | "provisional" | "unavailable";
  drilldownKey: string | null;
};
export type PerformanceReport = {
  range: { start: string; end: string; cohortWindowDays: 30 | 90 };
  asOf: string;
  qualityCoverage: {
    inquiries: { production: number; test: number; spam: number; unknown: number };
    deals: { production: number; unknown: number; unattributed: number };
  };
  acquisition: {
    inquiries: PerformanceMetric;
    uniqueCustomers: PerformanceMetric;
    qualifiedLeads: PerformanceMetric;
    completedViewings: PerformanceMetric;
    saleConversion: PerformanceMetric;
  };
  followup: {
    confirmedAssignments: PerformanceMetric;
    responseMedianMinutes: PerformanceMetric;
    responseP90Minutes: PerformanceMetric;
    unanswered: PerformanceMetric;
    overdue: PerformanceMetric;
    businessSla: PerformanceMetric;
  };
  sales: {
    deals: PerformanceMetric;
    saleValue: PerformanceMetric;
    commissionReceivable: PerformanceMetric;
  };
  backlog: { openInquiries: PerformanceMetric; unknownQuality: PerformanceMetric };
  agents: Array<{
    staffId: string;
    branchId: string | null;
    deals: number;
    inquiries: number;
    qualifiedLeads: number;
    completedViewings: number;
    humanResponses: number;
    weightedSaleValue: string;
    commissionReceivable: string | null;
    commissionSampleSize: number;
  }>;
  definitions: Record<string, string>;
};

export type PerformanceRecord = {
  kind: string;
  id: string;
  occurredAt: string;
  quality: string;
  staffId: string | null;
  inquiryId: string | null;
  leadId: string | null;
  transactionId: string | null;
};
export type PerformanceRecordPage = { records: PerformanceRecord[]; nextCursor: string | null };
