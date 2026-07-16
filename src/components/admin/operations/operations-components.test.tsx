import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminOperationsOverview } from "./AdminOperationsOverview";
import {
  canCancelOperationsJob,
  canRetryOperationsJob,
  mergeOperationsJobRows,
  shouldRefreshOperationsJobs,
} from "./AdminOperationsJobs";
const jobsSource = readFileSync(new URL("./AdminOperationsJobs.tsx", import.meta.url), "utf8");

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
