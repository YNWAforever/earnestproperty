import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test("EP-19 owned retry retains original job identity, payload, attempts and atomic audit", async () => {
  await withOwnedPostgres(async ({ query, transaction }) => {
    await mockOwnedServerDb(mock, query, transaction);
    const wakes = [];
    mock.module(new URL("./job-wake.server.ts", import.meta.url).href, {
      exports: {
        wakeAfterCommit: (lane) => wakes.push(lane),
        laneForJob: () => "general",
      },
    });
    const { enqueueJob, retryJob } = await import("./jobs.server.ts");
    const [actor] = await query(
      "INSERT INTO staff_users(auth_user_id) VALUES('qa-ops-recovery') RETURNING id",
    );
    const created = await enqueueJob(
      {
        jobType: "ai.knowledge.repair",
        payloadVersion: 1,
        payload: { batchId: "2026100301" },
        idempotencyKey: "qa-ops-original-run",
        actorStaffId: actor.id,
      },
      { wake: false },
    );
    await query(
      "UPDATE ops_jobs SET status='failed',attempt_count=2,last_error_code='OWNED_REPAIR_FAILED' WHERE id=$1",
      [created.id],
    );
    const requests = [randomUUID(), randomUUID()];
    const attempts = await Promise.all(
      requests.map((requestId) => retryJob(created.id, { actorStaffId: actor.id, requestId })),
    );
    assert.equal(attempts.filter(Boolean).length, 1);
    const [saved] = await query("SELECT * FROM ops_jobs WHERE id=$1", [created.id]);
    assert.equal(saved.status, "queued");
    assert.equal(saved.idempotency_key, "qa-ops-original-run");
    assert.deepEqual(saved.payload, { batchId: "2026100301" });
    assert.equal(saved.attempt_count, 2);
    assert.equal(saved.max_attempts, 3);
    assert.equal(saved.last_error_code, null);
    const audit = await query(
      "SELECT * FROM ops_audit_logs WHERE resource_id=$1 AND action='job.retry'",
      [created.id],
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_staff_id, actor.id);
    assert.equal(audit[0].outcome, "success");
    assert.ok(requests.includes(audit[0].request_id));
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key='qa-ops-original-run'",
        )
      )[0].n,
      1,
    );
    assert.equal(wakes.length, 1);
    // A lost response is reconciled by reading this original job, not enqueueing another run.
    assert.equal(
      await retryJob(created.id, { actorStaffId: actor.id, requestId: randomUUID() }),
      null,
    );
    assert.equal(
      (
        await query("SELECT count(*)::int n FROM ops_audit_logs WHERE resource_id=$1", [created.id])
      )[0].n,
      1,
    );
  });
});
