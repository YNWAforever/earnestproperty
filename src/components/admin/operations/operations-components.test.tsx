import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminOperationsOverview } from "./AdminOperationsOverview";
import {
  isValidAuditRequestId,
  safeAuditMetadataEntries,
  shouldApplyAuditRequestId,
} from "./AdminOperationsAudit";
import {
  canCancelOperationsJob,
  canRetryOperationsJob,
  mergeOperationsJobRows,
  shouldRefreshOperationsJobs,
} from "./AdminOperationsJobs";
import { canConfirmMigrationApply, migrationPlanShouldClear } from "./AdminOperationsMigrations";
const jobsSource = readFileSync(new URL("./AdminOperationsJobs.tsx", import.meta.url), "utf8");
const auditSource = readFileSync(new URL("./AdminOperationsAudit.tsx", import.meta.url), "utf8");
const migrationsSource = readFileSync(
  new URL("./AdminOperationsMigrations.tsx", import.meta.url),
  "utf8",
);

const agentCapabilities = {
  jobsRead: false,
  jobsRetry: false,
  jobsCancel: false,
  auditRead: false,
  migrationsPlan: false,
  migrationsApply: false,
};

test("job commands follow guarded backend states", () => {
  expect(canRetryOperationsJob("failed")).toBe(true);
  expect(canRetryOperationsJob("cancelled")).toBe(true);
  expect(canRetryOperationsJob("running")).toBe(false);
  expect(canCancelOperationsJob("queued")).toBe(true);
  expect(canCancelOperationsJob("succeeded")).toBe(false);
});
test("job pagination and polling helpers preserve active capability boundaries", () => {
  const first = [{ id: "first" }] as never[];
  const second = [{ id: "second" }] as never[];
  expect(mergeOperationsJobRows(first, second, false)).toEqual(second);
  expect(mergeOperationsJobRows(first, second, true)).toEqual([...first, ...second]);
  expect(
    shouldRefreshOperationsJobs({
      active: true,
      jobsRead: true,
      pending: false,
      previousPulse: 1,
      pulse: 2,
    }),
  ).toBe(true);
  expect(
    shouldRefreshOperationsJobs({
      active: false,
      jobsRead: true,
      pending: false,
      previousPulse: 1,
      pulse: 2,
    }),
  ).toBe(false);
  for (const blocked of [
    { active: true, jobsRead: false, pending: false, previousPulse: 1, pulse: 2 },
    { active: true, jobsRead: true, pending: true, previousPulse: 1, pulse: 2 },
    { active: true, jobsRead: true, pending: false, previousPulse: 2, pulse: 2 },
  ]) {
    expect(shouldRefreshOperationsJobs(blocked)).toBe(false);
  }
});
test("jobs UI omits sensitive payload fields", () => {
  expect(jobsSource).toContain("AdminConfirmDialog");
  expect(jobsSource).not.toMatch(/\bpayload\b|authorization|prompt|phone|approvalToken/i);
  expect(jobsSource).toContain("工作狀態已更新");
});

test("audit metadata and request filters stay deterministic and sanitized", () => {
  expect(
    safeAuditMetadataEntries({
      status: "queued",
      secret: "do-not-show",
      nested: { token: "raw-token", status: "queued", array: [{ password: "raw-password" }] },
    }),
  ).toEqual([
    ["nested", '{"array":[{"password":"[REDACTED]"}],"status":"queued","token":"[REDACTED]"}'],
    ["status", "queued"],
  ]);
  const longKey = "x".repeat(200);
  expect(safeAuditMetadataEntries({ [longKey]: "value" })[0]?.[0]).toBe(`${"x".repeat(117)}...`);
  expect(isValidAuditRequestId("123e4567-e89b-72d3-a456-426614174000")).toBe(true);
  expect(shouldApplyAuditRequestId("not-a-uuid")).toBe(false);
  expect(isValidAuditRequestId("not-a-uuid")).toBe(false);
  expect(auditSource).not.toMatch(/\bdelete\b|CSV export|\bphone\b|\bprompt\b|authorization/i);
});

test("migration apply requires an exact full ID", () => {
  expect(
    canConfirmMigrationApply(
      "20260714180000_backend_control_plane",
      "20260714180000_backend_control_plane",
    ),
  ).toBe(true);
  expect(canConfirmMigrationApply("20260714180000_backend_control_plane", "20260714180000")).toBe(
    false,
  );
});

test("stale or conflicting migration plans are cleared", () => {
  expect(migrationPlanShouldClear(409)).toBe(true);
  expect(migrationPlanShouldClear(500)).toBe(false);
});

test("migration controls keep approval tokens and raw SQL out of the UI", () => {
  expect(migrationsSource).toContain("AdminConfirmDialog");
  expect(migrationsSource).not.toMatch(
    /localStorage|sessionStorage|URLSearchParams[\s\S]*approvalToken/,
  );
  expect(migrationsSource).toMatch(/setPlan\(null\)[\s\S]*applyOperationsMigration/);
  expect(migrationsSource).toMatch(/migration\.status === "pending"[\s\S]*Plan migration/);
  expect(migrationsSource).toMatch(/migration\.status === "applied"[\s\S]*Applied/);
  expect(migrationsSource).toMatch(/capabilities\.migrationsApply/);
  expect(migrationsSource).toMatch(/setPlan\(null\)[\s\S]*fetchOperationsMigrations/);
  expect(migrationsSource).not.toMatch(/Apply All|\bsql\b|\bpayload\b|\bprovider\b/i);
});

test("Agent overview omits job and migration summaries", () => {
  const html = renderToStaticMarkup(
    <AdminOperationsOverview
      health={{
        status: "healthy",
        checks: [
          {
            key: "database.tables",
            required: true,
            status: "healthy",
            details: { DATABASE_URL: true },
          },
        ],
        checkedAt: "2026-07-15T00:00:00.000Z",
        capabilities: agentCapabilities,
      }}
      jobsSummary={null}
      migrations={null}
      stale={false}
      error={null}
      onRefresh={() => undefined}
      onOpenJobs={() => undefined}
    />,
  );

  expect(html).toContain("Database tables");
  expect(html).not.toContain("DATABASE_URL");
  expect(html).not.toContain("Job summary");
  expect(html).not.toContain("Migration status");
});
