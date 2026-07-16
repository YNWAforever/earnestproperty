import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminOperationsOverview } from "./AdminOperationsOverview";
import { canCancelOperationsJob, canRetryOperationsJob } from "./AdminOperationsJobs";
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
test("jobs UI omits sensitive payload fields", () => {
  expect(jobsSource).toContain("AdminConfirmDialog");
  expect(jobsSource).not.toMatch(/\bpayload\b|authorization|prompt|phone|approvalToken/i);
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
