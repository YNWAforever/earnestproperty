import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedOperationTabs,
  resolveOperationTab,
} from "./operations-permissions.ts";
import {
  OperationsClientError,
  requestControlPlane,
} from "./operations-client.ts";

const agent = {
  jobsRead: false,
  jobsRetry: false,
  jobsCancel: false,
  auditRead: false,
  migrationsPlan: false,
  migrationsApply: false,
};

test("Operations tabs hide inaccessible panels and fall back to overview", () => {
  assert.deepEqual(allowedOperationTabs(agent), ["overview"]);
  assert.equal(resolveOperationTab("jobs", agent), "overview");
  assert.equal(resolveOperationTab("unknown", agent), "overview");
});

test("control-plane client parses envelopes and preserves request IDs", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true, data: { status: "healthy" }, requestId: "r-1" }));
  assert.deepEqual(await requestControlPlane("/health", {}, fetchImpl), {
    data: { status: "healthy" },
    requestId: "r-1",
  });
});

test("control-plane client converts conflict envelopes to a stable error", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: "CONFLICT_DUPLICATE", message: "conflict", retryable: false },
        requestId: "r-2",
      }),
      { status: 409 },
    );
  await assert.rejects(
    () => requestControlPlane("/jobs/id/retry", { method: "POST" }, fetchImpl),
    (error) =>
      error instanceof OperationsClientError &&
      error.status === 409 &&
      error.code === "CONFLICT_DUPLICATE" &&
      error.requestId === "r-2",
  );
});
