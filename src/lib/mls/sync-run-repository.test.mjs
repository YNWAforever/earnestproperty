import test from "node:test";
import assert from "node:assert/strict";
const m = () => import("./sync-run-repository.mjs");
const actor = { staffId: "10000000-0000-0000-0000-000000000001", roles: ["admin"] };
test("sync read and dispatch require roles before any database/provider access", async () => {
  const { readSyncWorkspace, requestSyncOperation } = await m();
  let calls = 0;
  const q = async () => {
    calls++;
    return [];
  };
  await assert.rejects(
    readSyncWorkspace({ query: q, actor: { ...actor, roles: ["agent"] } }),
    /FORBIDDEN/,
  );
  await assert.rejects(
    requestSyncOperation({
      query: q,
      actor: { ...actor, roles: ["manager"] },
      input: { source: "28hse_agent_540", operation: "collect", idempotencyKey: actor.staffId },
    }),
    /FORBIDDEN/,
  );
  assert.equal(calls, 0);
});
test("sync read is bounded, never invents success on DB failure, exposes four cards", async () => {
  const { readSyncWorkspace } = await m();
  const queries = [];
  const result = await readSyncWorkspace({
    actor,
    query: async (s, p) => {
      queries.push([s, p]);
      return [];
    },
  });
  assert.equal(result.cards.length, 4);
  assert.ok(result.cards.every((x) => x.health === "never_synced"));
  assert.equal(result.history.length, 0);
  assert.equal(result.nextCursor, null);
  await assert.rejects(readSyncWorkspace({ actor, limit: 101, query: async () => [] }), /INVALID/);
  await assert.rejects(
    readSyncWorkspace({
      actor,
      query: async () => {
        throw Error("DB unavailable");
      },
    }),
    /DB unavailable/,
  );
  assert.ok(queries.some(([s, p]) => s.includes("LIMIT") && p.includes(26)));
});
test("disabled provider capability refuses operation without reserving fake success", async () => {
  const { requestSyncOperation } = await m();
  let calls = 0;
  await assert.rejects(
    requestSyncOperation({
      actor,
      input: { source: "28hse_agent_540", operation: "collect", idempotencyKey: actor.staffId },
      query: () => calls++,
      capability: null,
    }),
    /CAPABILITY/,
  );
  assert.equal(calls, 0);
});
test("dispatch timeout is unknown; duplicate must reconcile and cannot blindly send again", async () => {
  const { requestSyncOperation } = await m();
  let sends = 0;
  const writes = [];
  const row = {
    id: "20000000-0000-0000-0000-000000000001",
    operation: "collect",
    source: "28hse_agent_540",
    dispatch_status: "reserved",
    newly_reserved: true,
  };
  const query = async (s, p) => {
    writes.push([s, p]);
    return s.includes("reserve_property_sync_operation") ? [row] : [];
  };
  const options = {
    actor,
    query,
    input: { source: row.source, operation: "collect", idempotencyKey: actor.staffId },
    capability: { enabled: true },
    dispatch: async () => {
      sends++;
      throw Error("timeout with token SECRET");
    },
  };
  const r = await requestSyncOperation(options);
  assert.equal(r.status, "unknown");
  assert.equal(sends, 1);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  row.dispatch_status = "unknown";
  row.newly_reserved = false;
  assert.equal((await requestSyncOperation(options)).status, "unknown");
  assert.equal(sends, 1);
});

test("dispatch-result readback checks role and valid identity before querying", async () => {
  const { readSyncOperationResult } = await m();
  let calls = 0;
  const query = async () => {
    calls++;
    return [];
  };
  for (const roles of [["agent"], ["manager"]])
    await assert.rejects(
      readSyncOperationResult({ query, actor: { ...actor, roles }, idempotencyKey: actor.staffId }),
      /FORBIDDEN/,
    );
  await assert.rejects(
    readSyncOperationResult({ query, actor, idempotencyKey: "invalid" }),
    /INVALID_OPERATION/,
  );
  assert.equal(calls, 0);
});

test("dispatch-result readback is caller-scoped and fresh DB role checks cannot be forged", async () => {
  const { readSyncOperationResult } = await m();
  const queries = [];
  const query = async (sql, params) => {
    queries.push([sql, params]);
    return [{ allowed: true, id: null }];
  };
  const missing = await readSyncOperationResult({ query, actor, idempotencyKey: actor.staffId });
  assert.equal(missing.reconciled, false);
  assert.equal(missing.state, "unknown");
  assert.deepEqual(queries[0][1], [actor.staffId, actor.staffId]);
  assert.match(queries[0][0], /idempotency_key/);
  assert.match(queries[0][0], /requested_by/);
  assert.match(queries[0][0], /staff_roles/);
  assert.match(queries[0][0], /s.active/);
  assert.doesNotMatch(queries[0][0], /\b(UPDATE|INSERT|DELETE|reserve_property_sync_operation)\b/i);
  await assert.rejects(
    readSyncOperationResult({
      query: async () => [{ allowed: false }],
      actor,
      idempotencyKey: actor.staffId,
    }),
    /FORBIDDEN/,
  );
});

test("dispatch-result readback never upgrades accepted, missing proof, or unknown phases to completion", async () => {
  const { readSyncOperationResult } = await m();
  const base = {
    allowed: true,
    id: actor.staffId,
    dispatch_status: "accepted",
    workflow_run_id: "123",
    finished_at: null,
    stages: {
      collection: { status: "succeeded" },
      ingestion: { status: "pending" },
      publication: { status: "pending" },
      verification: { status: "pending" },
    },
  };
  const read = (row) =>
    readSyncOperationResult({ query: async () => [row], actor, idempotencyKey: actor.staffId });
  for (const row of [
    base,
    { ...base, dispatch_status: "unknown" },
    { ...base, finished_at: new Date().toISOString(), workflow_run_id: null },
    {
      ...base,
      finished_at: new Date().toISOString(),
      stages: { collection: { status: "succeeded" } },
    },
    {
      ...base,
      finished_at: new Date().toISOString(),
      stages: { ...base.stages, publication: { status: "unknown" } },
    },
    {
      ...base,
      finished_at: new Date().toISOString(),
      stages: { ...base.stages, ingestion: { status: "succeeded" } },
      receipt_confirmed: false,
    },
  ])
    assert.equal((await read(row)).reconciled, false);
  const completed = await read({ ...base, finished_at: new Date().toISOString() });
  assert.equal(completed.reconciled, true);
  assert.equal(completed.state, "completed");
  assert.equal(
    (
      await read({
        ...base,
        finished_at: new Date().toISOString(),
        stages: { ...base.stages, ingestion: { status: "succeeded" } },
        receipt_confirmed: true,
      })
    ).reconciled,
    true,
  );
  const rejected = await read({
    ...base,
    dispatch_status: "failed",
    workflow_run_id: null,
    finished_at: new Date().toISOString(),
  });
  assert.equal(rejected.reconciled, true);
  assert.equal(rejected.state, "failed");
});
