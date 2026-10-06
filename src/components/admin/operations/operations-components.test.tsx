import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminOperationsOverview } from "./AdminOperationsOverview";
import { AdminOperationsReceipts, ReceiptsTable } from "./AdminOperationsReceipts";
import {
  canShowReceiptRetry,
  receiptAttemptsLabel,
  receiptReasonLabel,
  receiptRetryErrorMessage,
  receiptRetryToast,
  shouldRefreshOperationsReceipts,
} from "./operations-receipts-utils";
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
import type {
  InboundReceiptProblem,
  JobListItem,
  JobStatus,
} from "@/lib/admin/operations/operations-types";
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

test("jobs.queue row shows 背景工作排程 with overdue count and heartbeat age", () => {
  const html = renderToStaticMarkup(
    <AdminOperationsOverview
      health={{
        status: "degraded",
        checks: [
          {
            key: "jobs.queue",
            required: false,
            status: "degraded",
            details: {
              wakeConfigured: false,
              serviceHeartbeatFresh: false,
              generalHeartbeatFresh: true,
              noOverdueJobs: false,
              noExpiredLeases: true,
            },
            facts: { overdueQueued: 1, expiredLeases: 0, oldestHeartbeatMinutes: 31 },
          },
        ],
        checkedAt: "2026-10-06T03:00:00.000Z",
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

  expect(html).toContain("背景工作排程");
  expect(html).toContain("逾時未執行的工作：1");
  expect(html).toContain("過期租約：0");
  expect(html).toContain("工作程序最後回報：31 分鐘前");
  expect(html).toContain("未設定即時喚醒");
  expect(html).toContain("降級");
  // Facts replace the configured-count summary, and raw keys never reach the DOM.
  expect(html).not.toContain("項設定中已完成");
  expect(html).not.toMatch(/overdueQueued|oldestHeartbeatMinutes|wakeConfigured/);
});

test("jobs.queue row says 未有記錄 when a lane has never reported", () => {
  const html = renderToStaticMarkup(
    <AdminOperationsOverview
      health={{
        status: "degraded",
        checks: [
          {
            key: "jobs.queue",
            required: false,
            status: "degraded",
            details: { wakeConfigured: true },
            facts: { overdueQueued: 0, expiredLeases: 0, oldestHeartbeatMinutes: null },
          },
        ],
        checkedAt: "2026-10-06T03:00:00.000Z",
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
  expect(html).toContain("工作程序最後回報：未有記錄");
  expect(html).not.toContain("未設定即時喚醒");
});

test("an unreadable jobs.queue row says so in zh-HK", () => {
  const html = renderToStaticMarkup(
    <AdminOperationsOverview
      health={{
        status: "degraded",
        checks: [
          { key: "jobs.queue", required: false, status: "degraded", details: { readable: false } },
        ],
        checkedAt: "2026-10-06T03:00:00.000Z",
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
  expect(html).toContain("背景工作排程");
  expect(html).toContain("未能讀取工作排程狀態");
  expect(html).not.toContain("項設定中已完成");
});

test("the WhatsApp card uses the same 未有記錄 copy for a missing heartbeat", () => {
  const card = readFileSync(new URL("./WhatsappServiceHealth.tsx", import.meta.url), "utf8");
  expect(card).toContain('工作程序最後回報：{health.heartbeatAt ?? "未有記錄"}');
});

const receiptRow = (overrides: Partial<InboundReceiptProblem>): InboundReceiptProblem => ({
  id: "abcdef12-0000-4000-8000-000000000001",
  kind: "retry_scheduled",
  projectionState: "failed",
  captureMode: "observe",
  attemptCount: 3,
  blockReason: "PROJECTION_FAILED",
  receivedAt: "2026-10-06T01:00:00.000Z",
  nextRetryAt: "2026-10-06T01:10:00.000Z",
  conversationId: null,
  canRetry: true,
  ...overrides,
});
const receiptsSource =
  readFileSync(new URL("./AdminOperationsReceipts.tsx", import.meta.url), "utf8") +
  readFileSync(new URL("./operations-receipts-utils.ts", import.meta.url), "utf8");
const retryCapabilities = { ...agentCapabilities, jobsRead: true, jobsRetry: true };

test("receipts panel labels C-09 rows 需要分派 with an open-conversation link and no retry button", () => {
  const conversation = "11111111-1111-4111-8111-111111111111";
  const markup = renderToStaticMarkup(
    <ReceiptsTable
      rows={[
        receiptRow({
          id: "c0900000-0000-4000-8000-000000000009",
          kind: "needs_routing",
          projectionState: "projected",
          captureMode: "active",
          blockReason: null,
          nextRetryAt: null,
          conversationId: conversation,
          canRetry: false,
        }),
      ]}
      jobsRetry
      busy={false}
      emptyMessage="沒有需要處理的來訊收件。"
      onRetry={() => undefined}
    />,
  );
  expect(markup).toContain("需要分派");
  expect(markup).toContain("請開啟對話並手動分派");
  expect(markup).toContain(`href="/admin/whatsapp?conversation=${conversation}"`);
  expect(markup).toContain("開啟對話");
  const row = markup.slice(markup.indexOf("<tbody"));
  expect(row).not.toContain("重試");
  // Reference and state only: no phone, text or member fields.
  expect(markup).toContain("c0900000");
  expect(markup).not.toMatch(/phone|memberId|member_id|normalized/i);
});

test("a receipt without a conversation says 未有對話", () => {
  const markup = renderToStaticMarkup(
    <ReceiptsTable
      rows={[
        receiptRow({ kind: "review_required", blockReason: "REVIEW_REQUIRED", canRetry: false }),
      ]}
      jobsRetry
      busy={false}
      emptyMessage="x"
      onRetry={() => undefined}
    />,
  );
  expect(markup).toContain("未有對話");
  expect(markup).toContain("非即時來訊，需人工檢查");
  expect(markup).toContain("需人工檢查");
});

test("retry appears only for retryable rows and only with jobsRetry", () => {
  const rows = [
    receiptRow({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
    receiptRow({
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      kind: "retry_exhausted",
      attemptCount: 20,
      nextRetryAt: null,
    }),
    receiptRow({
      id: "cccccccc-0000-4000-8000-000000000003",
      kind: "review_required",
      canRetry: false,
    }),
  ];
  const render = (jobsRetry: boolean) =>
    renderToStaticMarkup(
      <ReceiptsTable
        rows={rows}
        jobsRetry={jobsRetry}
        busy={false}
        emptyMessage="x"
        onRetry={() => undefined}
      />,
    );
  const allowed = render(true);
  expect(allowed).toContain('aria-label="重試收件 aaaaaaaa"');
  expect(allowed).toContain('aria-label="重試收件 bbbbbbbb"');
  expect(allowed).not.toContain("重試收件 cccccccc");
  const restricted = render(false);
  expect(restricted).not.toContain("重試收件");
  expect(restricted).not.toContain("<button");
  // The whole panel is absent for staff without jobs.read (agents, viewers).
  expect(
    renderToStaticMarkup(
      <AdminOperationsReceipts
        capabilities={agentCapabilities}
        active
        pulse={0}
        onMutationComplete={() => undefined}
      />,
    ),
  ).toBe("");
  const panel = renderToStaticMarkup(
    <AdminOperationsReceipts
      capabilities={{ ...retryCapabilities, jobsRetry: false }}
      active
      pulse={0}
      onMutationComplete={() => undefined}
    />,
  );
  expect(panel).toContain("WhatsApp 來訊收件");
  expect(panel).not.toContain("重試收件");
  expect(panel).not.toContain("<button");
});

test("receipt helpers keep copy, toasts and refresh rules aligned with the spec", () => {
  expect(canShowReceiptRetry(receiptRow({}), true)).toBe(true);
  expect(canShowReceiptRetry(receiptRow({}), false)).toBe(false);
  expect(canShowReceiptRetry(receiptRow({ kind: "needs_routing" }), true)).toBe(false);
  expect(canShowReceiptRetry(receiptRow({ canRetry: false }), true)).toBe(false);
  expect(receiptRetryToast("projected")).toEqual({ kind: "success", message: "已補錄這則來訊。" });
  expect(receiptRetryToast("failed").message).toBe("重試未成功，系統會稍後再自動重試。");
  expect(receiptRetryErrorMessage("ref-1")).toBe("未能重試，請稍後再試。（支援參考編號：ref-1）");
  expect(receiptReasonLabel("WA_ENQUIRY_SCHEMA_REQUIRED")).toBe("資料庫結構未就緒");
  expect(receiptReasonLabel(null)).toBe("—");
  expect(
    shouldRefreshOperationsReceipts({
      active: true,
      jobsRead: true,
      pending: false,
      previousPulse: 1,
      pulse: 2,
    }),
  ).toBe(true);
  expect(
    shouldRefreshOperationsReceipts({
      active: true,
      jobsRead: true,
      pending: true,
      previousPulse: 1,
      pulse: 2,
    }),
  ).toBe(false);
});

test("the receipts panel never polls", () => {
  expect(receiptsSource).not.toMatch(/setInterval|useVisibleInterval/);
  // It reuses the page pulse and the shared 409 / audit-backed command only.
  expect(receiptsSource).toContain("retryOperationsReceipt");
  expect(receiptsSource).not.toMatch(/\bpayload\b|authorization|normalized_event|member_?id/i);
});

test("attempts past the cap display as 20+ for exhausted rows only", () => {
  expect(receiptAttemptsLabel(receiptRow({ kind: "retry_exhausted", attemptCount: 23 }))).toBe(
    "20+",
  );
  expect(receiptAttemptsLabel(receiptRow({ kind: "retry_exhausted", attemptCount: 20 }))).toBe(
    "20",
  );
  expect(receiptAttemptsLabel(receiptRow({ attemptCount: 3 }))).toBe("3");
});
