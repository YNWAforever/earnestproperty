import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminOperationsOverview } from "./AdminOperationsOverview";
import {
  auditMetadataOmittedCount,
  isValidAuditRequestId,
  safeAuditMetadataEntries,
  shouldApplyAuditRequestId,
} from "./operations-audit-utils";
import {
  canCancelOperationsJob,
  canRetryOperationsJob,
  mergeOperationsJobRows,
  shouldRefreshOperationsJobs,
} from "./operations-jobs-utils";
import { canConfirmMigrationApply, migrationPlanShouldClear } from "./operations-migrations-utils";
import type { JobListItem, JobStatus } from "@/lib/admin/operations/operations-types";
const jobsSource =
  readFileSync(new URL("./AdminOperationsJobs.tsx", import.meta.url), "utf8") +
  readFileSync(new URL("./operations-jobs-utils.ts", import.meta.url), "utf8");
// Both halves of the audit panel are read: the sanitiser moved to
// operations-audit-utils.ts, and the assertion below must follow it or it would
// still pass while checking a file that no longer holds the logic.
const auditSource =
  readFileSync(new URL("./AdminOperationsAudit.tsx", import.meta.url), "utf8") +
  readFileSync(new URL("./operations-audit-utils.ts", import.meta.url), "utf8");
const migrationsSource =
  readFileSync(new URL("./AdminOperationsMigrations.tsx", import.meta.url), "utf8") +
  readFileSync(new URL("./operations-migrations-utils.ts", import.meta.url), "utf8");

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
  const job = (id: string, status: JobStatus = "queued"): JobListItem => ({
    id,
    jobType: "demo",
    status,
    attemptCount: 0,
    maxAttempts: 3,
    runAfter: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    createdAt: "2026-08-05T00:00:00.000Z",
    payloadVersion: 1,
    leaseExpiresAt: null,
    errorCode: null,
  });
  const first = [job("first")];
  const second = [job("second")];
  expect(mergeOperationsJobRows(first, second, "replace")).toEqual(second);
  expect(mergeOperationsJobRows(first, second, "append")).toEqual([...first, ...second]);
  // A background tick only ever sees page 1; it must update rows in place and
  // keep the deeper pages the operator loaded, not snap the list back to 25.
  const refreshed = mergeOperationsJobRows(
    [...first, ...second],
    [job("first", "succeeded")],
    "refresh",
  );
  expect(refreshed).toHaveLength(first.length + second.length);
  expect(refreshed.find((row) => row.id === first[0].id)?.status).toBe("succeeded");
  expect(refreshed.map((row) => row.id)).toEqual([...first, ...second].map((row) => row.id));
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
  expect(jobsSource).toContain("此工作的狀態已改變，指令未有執行。");
  // A 409 must be announced, not just written to a quiet status line.
  expect(jobsSource).toMatch(/reason\.status === 409[\s\S]*toast\.error/);
});

test("audit metadata and request filters stay deterministic and sanitized", () => {
  // A sensitive key is redacted, not removed: on the compliance surface an
  // investigator must be able to tell "never recorded" from "hidden from you".
  expect(
    safeAuditMetadataEntries({
      status: "queued",
      secret: "do-not-show",
      nested: { token: "raw-token", status: "queued", array: [{ password: "raw-password" }] },
    }),
  ).toEqual([
    ["nested", '{"array":[{"password":"[REDACTED]"}],"status":"queued","token":"[REDACTED]"}'],
    ["secret", "[REDACTED]"],
    ["status", "queued"],
  ]);
  // The display caps must be reported rather than silently swallowing keys.
  const wide = Object.fromEntries(
    Array.from({ length: 26 }, (_, index) => [`key_${String(index).padStart(2, "0")}`, index]),
  );
  expect(safeAuditMetadataEntries(wide)).toHaveLength(20);
  expect(auditMetadataOmittedCount(wide)).toBe(6);
  expect(auditMetadataOmittedCount({ status: "queued" })).toBe(0);
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
  // The apply confirmation must stay mounted while the request is in flight.
  // `plan` gates the dialog's `open`, so clearing it before the await unmounted
  // the modal the instant Apply was clicked and ran an irreversible schema
  // change with no feedback at all.
  expect(migrationsSource).toMatch(
    /setApplying\(true\);[\s\S]*await applyOperationsMigration\([\s\S]*setPlan\(null\)/,
  );
  expect(migrationsSource).not.toMatch(
    /setPlan\(null\);\s*\n\s*setTypedId\(""\);\s*\n\s*setApplying\(true\)/,
  );
  // The fetched plan must actually be shown; the confirm used to display only
  // the migration ID.
  expect(migrationsSource).toContain("plan.summary");
  expect(migrationsSource).toContain("plan.checksum");
  expect(migrationsSource).toContain("plan.schemaFingerprint");
  expect(migrationsSource).toMatch(/migration\.status === "pending"[\s\S]*執行計劃/);
  expect(migrationsSource).toMatch(/migration\.status === "applied"[\s\S]*已套用/);
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

  expect(html).toContain("資料庫表格");
  // The check's raw config detail keys must never reach the DOM.
  expect(html).not.toContain("DATABASE_URL");
  // An agent has neither jobsRead nor migrationsPlan, so neither summary
  // section may render.
  expect(html).not.toContain("背景工作概況");
  expect(html).not.toContain("遷移狀態");
});
