import test from "node:test";
import assert from "node:assert/strict";
import { dispatchPropertySync, workflowCapability } from "./dispatch-property-sync.mjs";
const env = {
  PROPERTY_SYNC_ADMIN_DISPATCH_ENABLED: "true",
  PROPERTY_SYNC_EXPECTED_BRANCH: "main",
  PROPERTY_SYNC_WORKFLOW_TOKEN: "synthetic-secret",
};
const input = {
  source: "28hse_agent_540",
  operation: "publication",
  requestAsset: "request-123-1.json",
  operationId: "10000000-0000-0000-0000-000000000001",
};
test("dispatch fixes repo workflow ref scope and original request without exposing managed credential", async () => {
  let call;
  const r = await dispatchPropertySync(input, {
    env,
    fetchImpl: async (url, options) => {
      call = { url, ...options };
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(r.accepted, true);
  assert.equal(call.redirect, "error");
  const body = JSON.parse(call.body);
  assert.deepEqual(body, {
    ref: "main",
    inputs: {
      mode: "publication-only",
      scope: "agent:540",
      bootstrap: "false",
      replay_asset: "request-123-1.json",
      operation_id: input.operationId,
    },
  });
  assert.ok(!JSON.stringify(r).includes(env.PROPERTY_SYNC_WORKFLOW_TOKEN));
});
test("Property.hk capability and arbitrary assets are blocked before provider call", async () => {
  assert.equal(workflowCapability("propertyhk", env).enabled, false);
  for (const requestAsset of [
    "https://evil.example/request",
    "../request-1-1.json",
    "request-1-1.json?token=x",
  ])
    await assert.rejects(
      dispatchPropertySync(
        { ...input, requestAsset },
        { env, fetchImpl: () => assert.fail("no fetch") },
      ),
    );
  assert.equal(
    workflowCapability(input.source, { ...env, PROPERTY_SYNC_EXPECTED_BRANCH: "other" }).enabled,
    false,
  );
});
test("accepted dispatch is not completion; definite rejection differs from unknown server outcome", async () => {
  assert.deepEqual(
    await dispatchPropertySync(input, {
      env,
      fetchImpl: async () => new Response(null, { status: 403 }),
    }),
    { accepted: false, rejected: true },
  );
  assert.deepEqual(
    await dispatchPropertySync(input, {
      env,
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    { accepted: false, rejected: false },
  );
});
