import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PerformanceDashboard } from "./PerformanceDashboard";
import { PerformanceTable } from "./PerformanceTable";
import type {
  PerformanceReport,
  PerformanceFilters,
} from "@/lib/analytics/sales-performance.types";

const filters: PerformanceFilters = {
  start: "2026-06-01",
  end: "2026-06-30",
  cohortWindowDays: 90,
};
const m = (
  value: number | string | null,
  unit: "count" | "ratio" | "minutes" | "HKD" = "count",
  status: "ready" | "provisional" | "unavailable" = "ready",
  key: string | null = "inquiries",
) => ({
  value,
  unit,
  denominator: 10,
  sampleSize: value === null ? 0 : 2,
  status,
  drilldownKey: key,
});
const report: PerformanceReport = {
  range: filters,
  asOf: "2026-09-27T00:00:00.000Z",
  qualityCoverage: {
    inquiries: { production: 10, test: 2, spam: 1, unknown: 3 },
    events: { production: 6, test: 0, spam: 0, unknown: 3 },
    deals: { production: 2, test: 0, spam: 0, unknown: 1, unattributed: 4 },
  },
  acquisition: {
    inquiries: m(10),
    uniqueCustomers: m(null, "count", "unavailable", null),
    qualifiedLeads: m(6),
    completedViewings: m(3),
    saleConversion: m(0.2, "ratio", "provisional", "converted"),
  },
  followup: {
    confirmedAssignments: m(4),
    responseMedianMinutes: m(18, "minutes"),
    responseP90Minutes: m(52, "minutes"),
    unanswered: m(2),
    overdue: m(1),
    businessSla: m(null, "ratio", "unavailable", null),
  },
  sales: {
    deals: m(2),
    saleValue: m("10000000.00", "HKD"),
    commissionReceivable: m("100000.00", "HKD"),
  },
  backlog: { openInquiries: m(4), unknownQuality: m(1) },
  agents: [
    {
      staffId: "00000000-0000-4000-8000-000000000001",
      branchId: null,
      deals: 1,
      inquiries: 4,
      qualifiedLeads: 2,
      completedViewings: 1,
      humanResponses: 2,
      weightedSaleValue: "6000000.00",
      commissionReceivable: "60000.00",
      commissionSampleSize: 1,
    },
  ],
  definitions: { saleConversion: "Cohort conversion", uniqueCustomers: "Verified identity only" },
};
test("dashboard presents four named areas, quality coverage, provisional and unavailable values", () => {
  const html = renderToStaticMarkup(
    createElement(PerformanceDashboard, {
      filters,
      report,
      options: null,
      onApplyFilters: () => {},
      onOpenRecords: () => {},
    }),
  );
  for (const label of ["新增與轉換", "回覆及跟進", "成交及佣金", "當前待辦", "資料品質"])
    expect(html).toContain(label);
  expect(html).toContain("暫定");
  expect(html).toContain("未有足夠資料");
  expect(html).toContain("20%");
  expect(html).toContain("未歸因");
  expect(html).toContain("未知跟進事件");
  expect(html).toContain("可查看記錄");
});
test("agent table keeps sample and value labels separate", () => {
  const html = renderToStaticMarkup(
    createElement(PerformanceDashboard, {
      filters,
      report,
      options: null,
      onApplyFilters: () => {},
      onOpenRecords: () => {},
    }),
  );
  expect(html).toContain("代理績效");
  expect(html).toContain("加權成交額");
  expect(html).toContain("佣金樣本");
});
test("record table keeps scope and quality correction visible without PII", () => {
  const html = renderToStaticMarkup(
    createElement(PerformanceTable, {
      drilldownKey: "quality_unknown_inquiries",
      page: {
        records: [
          {
            kind: "inquiry",
            id: "00000000-0000-4000-8000-000000000001",
            occurredAt: "2026-06-01T00:00:00Z",
            quality: "unknown",
            staffId: null,
            inquiryId: null,
            leadId: "00000000-0000-4000-8000-000000000002",
            transactionId: null,
            eventKey: null,
          },
        ],
        nextCursor: null,
      },
      canCorrect: true,
      canQualify: true,
      loading: false,
      onClose: () => {},
      onMore: () => {},
      onCorrect: async () => {},
      onQualify: async () => {},
    }),
  );
  expect(html).toContain("標為測試");
  expect(html).toContain("標為垃圾");
  expect(html).toContain("恢復有效");
  expect(html).toContain("修正原因");
  expect(html).toContain("核實合格線索");
  expect(html).not.toContain("@example.com");
});
