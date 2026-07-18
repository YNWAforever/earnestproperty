import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedOperationTabs,
  resolveOperationTab,
} from "./operations-permissions.ts";
import {
  OperationsClientError,
  requestControlPlane,
  fetchOperationsJobs,
  retryOperationsJob,
} from "./operations-client.ts";
import {
  createOperationsHealthLoader,
  getOperationsSearchCorrection,
  resolveOperationsRouteState,
  transitionOperationsHealthState,
} from "./operations-route-state.ts";
import { createOperationsPoller } from "./operations-polling.ts";

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

test("Operations tabs retain Manager and Admin ordering with a safe fallback", () => {
  const manager = { ...agent, jobsRead: true, auditRead: true };
  const admin = { ...manager, migrationsPlan: true };
  assert.deepEqual(allowedOperationTabs(manager), ["overview", "jobs", "audit"]);
  assert.deepEqual(allowedOperationTabs(admin), ["overview", "jobs", "audit", "migrations"]);
  assert.equal(resolveOperationTab("migrations", manager), "overview");
  assert.equal(resolveOperationTab("migrations", admin), "migrations");
});

test("control-plane transport forces cookie credentials and strips authorization", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ ok: true, data: {}, requestId: "r-transport" }));
  };
  await requestControlPlane("/health", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { authorization: "Bearer caller-token" },
  }, fetchImpl);
  const headers = new Headers(captured.init.headers);
  assert.equal(captured.url, "/api/admin/control-plane/health");
  assert.equal(captured.init.credentials, "same-origin");
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("authorization"), null);
});

test("Operations client wrappers encode query and path values", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, data: {}, requestId: "r-wrapper" }));
  };
  try {
    await fetchOperationsJobs({
      status: "failed",
      jobType: "email & sms",
      cursor: "c/+=",
      limit: 25,
    });
    await retryOperationsJob("job/id?");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    calls[0].url,
    "/api/admin/control-plane/jobs?status=failed&jobType=email+%26+sms&cursor=c%2F%2B%3D&limit=25",
  );
  assert.equal(calls[1].url, "/api/admin/control-plane/jobs/job%2Fid%3F/retry");
  assert.equal(calls[1].init.body, "{}");
});

test("control-plane client rejects malformed JSON as an invalid response", async () => {
  const fetchImpl = async () => new Response("not json", { status: 502 });
  await assert.rejects(
    () => requestControlPlane("/health", {}, fetchImpl),
    (error) =>
      error instanceof OperationsClientError &&
      error.status === 502 &&
      error.code === "INVALID_RESPONSE" &&
      error.requestId === null,
  );
});

test("control-plane client rejects successful envelopes without data", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true, requestId: "r-malformed" }));
  await assert.rejects(
    () => requestControlPlane("/health", {}, fetchImpl),
    (error) =>
      error instanceof OperationsClientError &&
      error.status === 200 &&
      error.code === "INVALID_RESPONSE" &&
      error.requestId === "r-malformed",
  );
});

test("poller pauses while hidden and refreshes immediately when visible", () => {
  let visible = true;
  let timerCallback;
  let visibilityCallback;
  let ticks = 0;
  const poller = createOperationsPoller({
    intervalMs: 30_000,
    isVisible: () => visible,
    subscribeVisibility: (next) => {
      visibilityCallback = next;
      return () => { visibilityCallback = undefined; };
    },
    setTimer: (next, ms) => {
      assert.equal(ms, 30_000);
      timerCallback = next;
      return 1;
    },
    clearTimer: () => undefined,
    onPulse: () => { ticks += 1; },
  });

  poller.start();
  visible = false;
  timerCallback();
  assert.equal(ticks, 0);
  visible = true;
  visibilityCallback();
  assert.equal(ticks, 1);
  poller.stop();
});

test("poller installs one timer and listener, then removes both on stop", () => {
  let setTimerCalls = 0;
  let clearTimerCalls = 0;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const poller = createOperationsPoller({
    intervalMs: 30_000,
    isVisible: () => true,
    subscribeVisibility: () => {
      subscribeCalls += 1;
      return () => { unsubscribeCalls += 1; };
    },
    setTimer: () => { setTimerCalls += 1; return 1; },
    clearTimer: () => { clearTimerCalls += 1; },
    onPulse: () => undefined,
  });

  poller.start();
  poller.start();
  poller.stop();
  poller.stop();
  assert.equal(setTimerCalls, 1);
  assert.equal(subscribeCalls, 1);
  assert.equal(clearTimerCalls, 1);
  assert.equal(unsubscribeCalls, 1);
});

function operationsHealth(capabilities) {
  return {
    status: "healthy",
    checks: [],
    checkedAt: "2026-07-16T00:00:00.000Z",
    capabilities,
  };
}

test("Operations health failure clears prior capabilities and default-denies protected tabs", () => {
  const manager = { ...agent, jobsRead: true, auditRead: true };
  const failed = transitionOperationsHealthState(
    { health: operationsHealth(manager), error: null },
    { type: "failure", error: "Refresh failed" },
  );

  assert.deepEqual(failed, { health: null, error: "Refresh failed" });
  assert.deepEqual(resolveOperationsRouteState("jobs", failed.health).allowedTabs, ["overview"]);
  assert.equal(resolveOperationsRouteState("jobs", failed.health).activeTab, "overview");
});

test("Operations route state derives Agent, Manager, and Admin tab matrices", () => {
  const manager = { ...agent, jobsRead: true, auditRead: true };
  const admin = { ...manager, migrationsPlan: true };

  assert.deepEqual(resolveOperationsRouteState("jobs", operationsHealth(agent)).allowedTabs, ["overview"]);
  assert.deepEqual(resolveOperationsRouteState("audit", operationsHealth(manager)).allowedTabs, [
    "overview",
    "jobs",
    "audit",
  ]);
  assert.deepEqual(resolveOperationsRouteState("migrations", operationsHealth(admin)).allowedTabs, [
    "overview",
    "jobs",
    "audit",
    "migrations",
  ]);
});

test("Operations route replaces unauthorized searches once and skips resolved searches", () => {
  const manager = { ...agent, jobsRead: true, auditRead: true };
  const unauthorized = resolveOperationsRouteState("migrations", operationsHealth(manager));

  assert.deepEqual(unauthorized.correction, { tab: undefined });
  assert.equal(getOperationsSearchCorrection("audit", "audit"), null);
  assert.deepEqual(getOperationsSearchCorrection("unknown", "overview"), { tab: undefined });
});

test("Operations health loader starts with only the injected health fetch", async () => {
  let state = { health: null, error: null };
  const calls = [];
  const loader = createOperationsHealthLoader({
    fetchHealth: async () => {
      calls.push("health");
      return { data: operationsHealth(agent), requestId: "health-1" };
    },
    setState: (updater) => {
      state = updater(state);
    },
  });

  await loader.load();

  assert.deepEqual(calls, ["health"]);
  assert.deepEqual(state, { health: operationsHealth(agent), error: null });
});

test("poller ignores retained timer and visibility callbacks after stop", () => {
  let visible = true;
  let timerCallback;
  let visibilityCallback;
  let ticks = 0;
  const poller = createOperationsPoller({
    intervalMs: 30_000,
    isVisible: () => visible,
    subscribeVisibility: (listener) => {
      visibilityCallback = listener;
      return () => undefined;
    },
    setTimer: (listener) => {
      timerCallback = listener;
      return 1;
    },
    clearTimer: () => undefined,
    onPulse: () => {
      ticks += 1;
    },
  });

  poller.start();
  poller.stop();
  timerCallback();
  visible = false;
  visibilityCallback();
  visible = true;
  visibilityCallback();

  assert.equal(ticks, 0);
});
