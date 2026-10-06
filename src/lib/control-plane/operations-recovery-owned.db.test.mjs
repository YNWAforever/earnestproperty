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

function syntheticReceipt(messageId, mode = "active") {
  return {
    tenantKey: "woztell:synthetic-ops-app",
    appId: "synthetic-ops-app",
    channelId: "synthetic-ops-channel",
    origin: "live_webhook",
    eventKind: "customer_message",
    bodyDigest: "b".repeat(64),
    providerOccurredAt: "2026-10-06T01:59:59Z",
    receivedAt: new Date("2026-10-06T02:00:00Z"),
    capture: {
      mode,
      activationId: "22222222-2222-4222-8222-222222222222",
      effectsEligible: false,
    },
    event: {
      direction: "inbound",
      externalMessageId: messageId,
      legacyExternalMessageId: null,
      fromPhone: "85255550101",
      toPhone: "85255550202",
      timestamp: "2026-10-06T01:59:59Z",
      messageType: "TEXT",
      text: "合成測試訊息",
      woztellMemberId: "synthetic-ops-customer",
      channelId: "synthetic-ops-channel",
      appId: "synthetic-ops-app",
      memberName: "Synthetic Customer",
      payload: { type: "TEXT", eventType: "INBOUND", data: { text: "合成測試訊息" } },
    },
  };
}

test("FX-07 receipt retry backoff is shared by recovery and nextDueAt", async (t) => {
  // EP-19 leaves its process-wide module mocks in place; release them before re-mocking the DB.
  mock.reset();
  await withOwnedPostgres(async ({ query, transaction }) => {
    await mockOwnedServerDb(t.mock, query, transaction);
    const { storeInboundReceipt, recoverPendingInboundReceipts } =
      await import("../whatsapp-enquiries/inbound-receipts.server.ts");
    const { getNextJobDueAt } = await import("./jobs-next-due.ts");
    const nextDueAt = () => getNextJobDueAt({ lane: "service", capabilities: [], query });
    const dbNow = async () => (await query("SELECT now() AS now"))[0].now.getTime();
    const receiptRow = async (id) =>
      (await query("SELECT * FROM whatsapp_inbound_receipts WHERE id=$1", [id]))[0];
    const reset = () => query("DELETE FROM whatsapp_inbound_receipts");

    await t.test("a receipt younger than the in-flight grace is not replayed", async () => {
      await reset();
      const stored = await storeInboundReceipt(syntheticReceipt("synthetic-ops-fresh"), { query });
      assert.equal(stored.projectionState, "pending");
      const projected = [];
      const counts = await recoverPendingInboundReceipts({
        query,
        project: async (_event, mode) => projected.push(mode),
      });
      assert.equal(counts.projected, 0);
      assert.equal(projected.length, 0);
      const row = await receiptRow(stored.receiptId);
      assert.equal(row.projection_state, "pending");
      assert.equal(row.attempt_count, 1);
      const due = await nextDueAt();
      assert.ok(due, "a pending receipt must arm the service lane");
      const expected = row.updated_at.getTime() + 2 * 60_000;
      assert.ok(Math.abs(new Date(due).getTime() - expected) <= 1000, `${due} vs updated_at+2m`);
    });

    await t.test(
      "a due receipt is replayed in observe mode and then clears nextDueAt",
      async () => {
        await reset();
        const stored = await storeInboundReceipt(syntheticReceipt("synthetic-ops-due", "active"), {
          query,
        });
        await query(
          "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '3 minutes' WHERE id=$1",
          [stored.receiptId],
        );
        const modes = [];
        const counts = await recoverPendingInboundReceipts({
          query,
          project: async (_event, mode) => modes.push(mode),
        });
        assert.equal(counts.projected, 1);
        assert.deepEqual(modes, ["observe"]);
        const row = await receiptRow(stored.receiptId);
        assert.equal(row.capture_mode, "active");
        assert.equal(row.projection_state, "projected");
        assert.equal(row.effects_eligible, false);
        assert.equal(await nextDueAt(), null);
      },
    );

    await t.test("nextDueAt never points at a receipt recovery will not claim", async () => {
      await reset();
      const seed = async (messageId, assignments) => {
        const stored = await storeInboundReceipt(syntheticReceipt(messageId), { query });
        await query(
          `UPDATE whatsapp_inbound_receipts
           SET updated_at=now()-interval '3 hours', ${assignments} WHERE id=$1`,
          [stored.receiptId],
        );
        return stored.receiptId;
      };
      await seed("synthetic-ops-cap", "attempt_count=20, projection_state='failed'");
      await seed(
        "synthetic-ops-review",
        "projection_state='failed', block_reason='REVIEW_REQUIRED'",
      );
      await seed("synthetic-ops-projected", "projection_state='projected', projected_at=now()");
      const leasedId = await seed("synthetic-ops-leased", "lease_until=now()+interval '5 minutes'");
      const leased = await receiptRow(leasedId);
      const firstDue = await nextDueAt();
      assert.equal(firstDue, leased.lease_until.toISOString());
      assert.ok(new Date(firstDue).getTime() > (await dbNow()));

      const failing = await storeInboundReceipt(syntheticReceipt("synthetic-ops-failing"), {
        query,
      });
      await query(
        "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '3 minutes' WHERE id=$1",
        [failing.receiptId],
      );
      let projectCalls = 0;
      for (let run = 0; run < 3; run++) {
        await recoverPendingInboundReceipts({
          query,
          project: async () => {
            projectCalls++;
            throw new Error("SYNTHETIC_PROJECTION_FAILURE");
          },
        });
      }
      assert.equal(projectCalls, 1);
      const failed = await receiptRow(failing.receiptId);
      assert.equal(failed.projection_state, "failed");
      assert.equal(failed.attempt_count, 2);
      const due = await nextDueAt();
      assert.equal(due, new Date(failed.updated_at.getTime() + 4 * 60_000).toISOString());
      assert.ok(new Date(due).getTime() > (await dbNow()));
    });
  });
});

test("FX-07 jobs.queue health reports overdue work and silent lanes, and only those", async (t) => {
  // EP-19 leaves its process-wide module mocks in place; release them before re-mocking the DB.
  mock.reset();
  const env = {
    CONTROL_PLANE_APPROVAL_SECRET: "synthetic-approval-secret",
    OPS_WAKE_URL: "https://wake.fixture.invalid/wake",
  };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await withOwnedPostgres(async ({ query, transaction }) => {
    await mockOwnedServerDb(t.mock, query, transaction);
    const { runControlPlaneHealthChecks } = await import("./health.server.ts");
    const { recordWorkerHeartbeat } = await import("./worker-heartbeat.server.ts");
    const { jobQueueThresholds } = await import("./job-queue-health.ts");
    // Offsets follow the same HKT-clock thresholds the check picks for the current time.
    const { overdueGraceMinutes, heartbeatStaleMinutes } = jobQueueThresholds(new Date());
    const health = () => runControlPlaneHealthChecks({ now: new Date() });
    const jobsQueue = (result) => result.checks.find((check) => check.key === "jobs.queue");
    let seq = 0;
    const seedJob = (assignments) =>
      query(
        `INSERT INTO ops_jobs(job_type,payload_version,payload,status,idempotency_key,run_after,attempt_count,lease_owner,lease_expires_at)
         VALUES('ai.knowledge.repair',1,'{"batchId":"2026100601"}'::jsonb,$1,$2,$3::timestamptz,$4,$5,$6::timestamptz)`,
        [
          assignments.status ?? "queued",
          `qa-fx07-health-${++seq}`,
          assignments.runAfter,
          assignments.attemptCount ?? 0,
          assignments.leaseExpiresAt ? "qa-fx07-worker" : null,
          assignments.leaseExpiresAt ?? null,
        ],
      );
    const minutesFromDb = async (minutes) =>
      (await query("SELECT now() + make_interval(mins => $1::int) AS at", [minutes]))[0].at;
    const reset = async () => {
      await query("DELETE FROM ops_jobs WHERE idempotency_key LIKE 'qa-fx07-health-%'");
      await query("DELETE FROM whatsapp_service_worker_heartbeats");
      assert.equal(await recordWorkerHeartbeat("service-v2", ["synthetic.capability@1"]), true);
      assert.equal(await recordWorkerHeartbeat("general-v1", []), true);
    };

    await t.test("idle with fresh lane heartbeats is healthy", async () => {
      await reset();
      const result = await health();
      const check = jobsQueue(result);
      assert.equal(check.status, "healthy", JSON.stringify(check));
      assert.equal(check.required, false);
      assert.deepEqual(check.facts, {
        overdueQueued: 0,
        expiredLeases: 0,
        oldestHeartbeatMinutes: 0,
      });
      const beats = await query(
        "SELECT worker_id, capabilities FROM whatsapp_service_worker_heartbeats ORDER BY worker_id",
      );
      assert.deepEqual(beats, [
        { worker_id: "general-v1", capabilities: [] },
        { worker_id: "service-v2", capabilities: ["synthetic.capability@1"] },
      ]);
    });

    await t.test("queued job past run_after → degraded", async () => {
      await reset();
      await seedJob({ runAfter: await minutesFromDb(-(overdueGraceMinutes + 5)) });
      const result = await health();
      const check = jobsQueue(result);
      assert.equal(check.status, "degraded");
      assert.equal(check.facts.overdueQueued, 1);
      assert.equal(result.status, "degraded");
      assert.ok(
        result.checks.every((item) => item.status !== "failed"),
        JSON.stringify(result),
      );
    });

    await t.test("future-scheduled, just-due and backing-off jobs are not overdue", async () => {
      await reset();
      await seedJob({ runAfter: await minutesFromDb(60) });
      await seedJob({ runAfter: await minutesFromDb(-1) });
      await seedJob({ runAfter: await minutesFromDb(2), attemptCount: 1 });
      // A lease that expired a minute ago is the sweep's job, not an alarm.
      await seedJob({
        status: "running",
        runAfter: await minutesFromDb(-2),
        attemptCount: 1,
        leaseExpiresAt: await minutesFromDb(-1),
      });
      const check = jobsQueue(await health());
      assert.equal(check.status, "healthy", JSON.stringify(check));
      assert.equal(check.facts.overdueQueued, 0);
      assert.equal(check.facts.expiredLeases, 0);
    });

    await t.test("a lease expired beyond the grace → degraded", async () => {
      await reset();
      await seedJob({
        status: "running",
        runAfter: await minutesFromDb(-(overdueGraceMinutes + 10)),
        attemptCount: 1,
        leaseExpiresAt: await minutesFromDb(-(overdueGraceMinutes + 5)),
      });
      const check = jobsQueue(await health());
      assert.equal(check.status, "degraded");
      assert.equal(check.facts.expiredLeases, 1);
    });

    await t.test("heartbeat older than 30 min → degraded", async () => {
      await reset();
      await query(
        "UPDATE whatsapp_service_worker_heartbeats SET seen_at=now()-make_interval(mins => $1::int) WHERE worker_id='general-v1'",
        [heartbeatStaleMinutes + 1],
      );
      const check = jobsQueue(await health());
      assert.equal(check.status, "degraded");
      assert.equal(check.details.generalHeartbeatFresh, false);
      assert.equal(check.details.serviceHeartbeatFresh, true);
      assert.equal(check.facts.oldestHeartbeatMinutes, heartbeatStaleMinutes + 1);
    });

    await t.test("an unreadable job queue degrades only its own row and is logged", async () => {
      await reset();
      const errors = t.mock.method(console, "error", () => undefined);
      await query(
        "ALTER TABLE whatsapp_service_worker_heartbeats RENAME TO qa_fx07_heartbeats_hidden",
      );
      try {
        const result = await health();
        const check = jobsQueue(result);
        assert.equal(check.status, "degraded");
        assert.equal(check.required, false);
        assert.deepEqual(check.details, { readable: false });
        assert.equal(check.facts, undefined);
        for (const key of ["database.tables", "database.columns"])
          assert.equal(result.checks.find((item) => item.key === key)?.status, "healthy", key);
        assert.ok(
          errors.mock.calls.some((call) =>
            String(call.arguments[0]).includes("JOBS_QUEUE_UNREADABLE"),
          ),
        );
      } finally {
        await query(
          "ALTER TABLE qa_fx07_heartbeats_hidden RENAME TO whatsapp_service_worker_heartbeats",
        );
        errors.mock.restore();
      }
    });
  });
});

test("a wrong or missing bearer writes no lane heartbeat on either drain route", async (t) => {
  // No database: the routes must return before touching it. The heartbeat
  // writer is mocked to count calls and to stop the drain with a sentinel.
  mock.reset();
  const calls = [];
  t.mock.module(new URL("./worker-heartbeat.server.ts", import.meta.url).href, {
    exports: {
      recordWorkerHeartbeat: async (id) => {
        calls.push(id);
        throw new Error("SYNTHETIC_HEARTBEAT_SENTINEL");
      },
    },
  });
  const { drainServiceJobs } = await import("../../routes/api.admin.whatsapp.service-worker.ts");
  const { Route: generalRoute } = await import("../../routes/api.admin.control-plane.worker.ts");
  const handlers = generalRoute.options.server.handlers;
  const drains = [
    ["service-v2", drainServiceJobs],
    ["general-v1", handlers.POST],
    ["general-v1", handlers.GET],
  ];
  const original = process.env.CRON_SECRET;
  t.after(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });
  process.env.CRON_SECRET = "synthetic-cron-secret";
  for (const [lane, drain] of drains) {
    for (const headers of [
      {},
      { authorization: "Bearer wrong" },
      { authorization: "synthetic-cron-secret" },
    ]) {
      const response = await drain({
        request: new Request("https://fixture.invalid/drain", { method: "POST", headers }),
      });
      assert.equal(response.status, 401, `${lane} ${JSON.stringify(headers)}`);
    }
    assert.deepEqual(calls, [], `${lane} wrote a heartbeat without the bearer`);
  }
  // Positive control: the right bearer reaches the (mocked) writer once per call.
  for (const [lane, drain] of drains) {
    calls.length = 0;
    await assert.rejects(
      drain({
        request: new Request("https://fixture.invalid/drain", {
          method: "POST",
          headers: { authorization: "Bearer synthetic-cron-secret" },
        }),
      }),
      /SYNTHETIC_HEARTBEAT_SENTINEL/,
    );
    assert.deepEqual(calls, [lane]);
  }
});

test("FX-07 receipts: observe-only retry, listing and C-09 labelling", async (t) => {
  // EP-19 leaves its process-wide module mocks in place; release them before re-mocking the DB.
  mock.reset();
  await withOwnedPostgres(async ({ query, transaction }) => {
    await mockOwnedServerDb(t.mock, query, transaction);
    const {
      storeInboundReceipt,
      recoverPendingInboundReceipts,
      retryInboundReceipt,
      listInboundReceiptProblems,
    } = await import("../whatsapp-enquiries/inbound-receipts.server.ts");
    const staff = async (label, role) => {
      const [row] = await query("INSERT INTO staff_users(auth_user_id) VALUES($1) RETURNING id", [
        `qa-fx07-receipts-${label}`,
      ]);
      return { staffId: row.id, roles: [role] };
    };
    const admin = await staff("admin", "admin");
    const manager = await staff("manager", "manager");
    const agent = await staff("agent", "agent");
    const receiptRow = async (id) =>
      (await query("SELECT * FROM whatsapp_inbound_receipts WHERE id=$1", [id]))[0];
    const auditRows = (id) =>
      query("SELECT * FROM ops_audit_logs WHERE resource_id=$1 ORDER BY created_at", [id]);
    const reset = async () => {
      await query("DELETE FROM whatsapp_inbound_receipts");
      await query("DELETE FROM whatsapp_conversations WHERE channel_id='synthetic-ops-channel'");
    };
    const seed = async (messageId, assignments = "", mode = "active") => {
      const stored = await storeInboundReceipt(syntheticReceipt(messageId, mode), { query });
      await query(
        `UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '3 hours'${
          assignments ? `, ${assignments}` : ""
        } WHERE id=$1`,
        [stored.receiptId],
      );
      return stored.receiptId;
    };
    const recorder = () => {
      const calls = [];
      return { calls, project: async (_event, mode) => calls.push(mode) };
    };

    await t.test("retry re-projects a failed receipt once; audited; agent forbidden", async () => {
      await reset();
      const id = await seed(
        "synthetic-ops-retry",
        "projection_state='failed', block_reason='PROJECTION_FAILED', attempt_count=20",
      );
      const forbidden = recorder();
      const denied = await retryInboundReceipt(
        id,
        agent,
        { requestId: randomUUID() },
        { query, project: forbidden.project },
      ).then(
        () => null,
        (error) => error,
      );
      assert.ok(denied instanceof Response);
      assert.equal(denied.status, 403);
      assert.equal(forbidden.calls.length, 0);
      assert.equal((await receiptRow(id)).projection_state, "failed");
      assert.equal((await receiptRow(id)).attempt_count, 20);
      assert.equal((await auditRows(id)).length, 0);

      const requestId = randomUUID();
      const adminRun = recorder();
      const result = await retryInboundReceipt(
        id,
        admin,
        { requestId },
        { query, project: adminRun.project },
      );
      assert.deepEqual(result, { receiptId: id, projectionState: "projected" });
      assert.deepEqual(adminRun.calls, ["observe"]);
      const saved = await receiptRow(id);
      assert.equal(saved.projection_state, "projected");
      assert.equal(saved.capture_mode, "active");
      assert.equal(saved.effects_eligible, false);
      assert.equal(saved.attempt_count, 21);
      const audit = await auditRows(id);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, "whatsapp.receipt.retry");
      assert.equal(audit[0].permission, "system.jobs.retry");
      assert.equal(audit[0].resource_type, "whatsapp_inbound_receipt");
      assert.equal(audit[0].actor_staff_id, admin.staffId);
      assert.equal(audit[0].request_id, requestId);
      assert.equal(audit[0].outcome, "success");

      // A manager may retry too.
      const second = await seed(
        "synthetic-ops-retry-manager",
        "projection_state='blocked_schema', block_reason='WA_ENQUIRY_SCHEMA_REQUIRED'",
      );
      const managerRun = recorder();
      assert.deepEqual(
        await retryInboundReceipt(
          second,
          manager,
          { requestId: randomUUID() },
          { query, project: managerRun.project },
        ),
        { receiptId: second, projectionState: "projected" },
      );
      assert.equal((await auditRows(second))[0].actor_staff_id, manager.staffId);

      // A failing projection reports failed and leaves the receipt for recovery.
      const third = await seed("synthetic-ops-retry-fails", "projection_state='failed'");
      assert.deepEqual(
        await retryInboundReceipt(
          third,
          admin,
          { requestId: randomUUID() },
          {
            query,
            project: async () => {
              throw new Error("SYNTHETIC_PROJECTION_FAILURE");
            },
          },
        ),
        { receiptId: third, projectionState: "failed" },
      );
      assert.equal((await receiptRow(third)).block_reason, "PROJECTION_FAILED");

      // Not retryable: projected, REVIEW_REQUIRED, C-09 (projected), non-live and leased receipts.
      const blockedIds = [
        await seed("synthetic-ops-r-projected", "projection_state='projected'"),
        await seed(
          "synthetic-ops-r-review",
          "projection_state='failed', block_reason='REVIEW_REQUIRED'",
        ),
        await seed("synthetic-ops-r-c09", "projection_state='projected', attempt_count=2"),
        await seed(
          "synthetic-ops-r-historical",
          "projection_state='failed', origin='historical_import'",
        ),
        await seed(
          "synthetic-ops-r-leased",
          "projection_state='failed', lease_until=now()+interval '5 minutes'",
        ),
      ];
      const untouched = recorder();
      for (const blocked of blockedIds) {
        assert.equal(
          await retryInboundReceipt(
            blocked,
            admin,
            { requestId: randomUUID() },
            { query, project: untouched.project },
          ),
          null,
          blocked,
        );
        assert.equal((await auditRows(blocked)).length, 0);
      }
      assert.equal(untouched.calls.length, 0);
    });

    await t.test("concurrent retry, double click and recovery project a receipt once", async () => {
      await reset();
      const id = await seed(
        "synthetic-ops-concurrent",
        "projection_state='failed', block_reason='PROJECTION_FAILED', attempt_count=2",
      );
      const projects = recorder();
      const slow = async (event, mode) => {
        await new Promise((done) => setTimeout(done, 150));
        return projects.project(event, mode);
      };
      const ports = { query, project: slow };
      const [first, second, recovered] = await Promise.all([
        retryInboundReceipt(id, admin, { requestId: randomUUID() }, ports),
        retryInboundReceipt(id, manager, { requestId: randomUUID() }, ports),
        recoverPendingInboundReceipts({ query, project: slow }),
      ]);
      assert.equal(projects.calls.length, 1);
      const winners = [first, second].filter(Boolean);
      assert.ok(winners.length <= 1);
      assert.equal(winners.length + recovered.projected, 1);
      assert.equal((await auditRows(id)).length, winners.length);
      assert.equal((await receiptRow(id)).projection_state, "projected");
    });

    await t.test(
      "a receipt inside the in-flight grace is not retryable or listed as retryable",
      async () => {
        await reset();
        const stored = await storeInboundReceipt(syntheticReceipt("synthetic-ops-grace"), {
          query,
        });
        await query(
          "UPDATE whatsapp_inbound_receipts SET projection_state='failed', block_reason='PROJECTION_FAILED' WHERE id=$1",
          [stored.receiptId],
        );
        const run = recorder();
        assert.equal(
          await retryInboundReceipt(
            stored.receiptId,
            admin,
            { requestId: randomUUID() },
            { query, project: run.project },
          ),
          null,
        );
        assert.equal(run.calls.length, 0);
        assert.equal((await auditRows(stored.receiptId)).length, 0);
        assert.equal((await receiptRow(stored.receiptId)).attempt_count, 1);
        const listed = await listInboundReceiptProblems(admin, { query });
        const row = listed.rows.find((item) => item.id === stored.receiptId);
        assert.equal(row.kind, "retry_scheduled");
        assert.equal(row.canRetry, false);
        // Once the grace has passed the same receipt becomes retryable.
        await query(
          "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '3 minutes' WHERE id=$1",
          [stored.receiptId],
        );
        assert.equal(
          (await listInboundReceiptProblems(admin, { query })).rows.find(
            (item) => item.id === stored.receiptId,
          ).canRetry,
          true,
        );
        assert.deepEqual(
          await retryInboundReceipt(
            stored.receiptId,
            admin,
            { requestId: randomUUID() },
            { query, project: run.project },
          ),
          { receiptId: stored.receiptId, projectionState: "projected" },
        );
      },
    );

    await t.test(
      "list shows retry, exhausted, review and 需要分派 receipts without message content",
      async () => {
        await reset();
        const scheduled = await seed(
          "synthetic-ops-l-scheduled",
          "projection_state='failed', block_reason='PROJECTION_FAILED', attempt_count=3",
        );
        const exhausted = await seed(
          "synthetic-ops-l-exhausted",
          "projection_state='failed', block_reason='PROJECTION_FAILED', attempt_count=20",
        );
        const review = await seed(
          "synthetic-ops-l-review",
          "projection_state='failed', block_reason='REVIEW_REQUIRED'",
        );
        const routing = await seed(
          "synthetic-ops-l-routing",
          "projection_state='projected', attempt_count=2, projected_at=now()",
        );
        const oldRouting = await seed(
          "synthetic-ops-l-old-routing",
          "projection_state='projected', attempt_count=2, projected_at=now(), received_at=now()-interval '40 days'",
        );
        const plain = await seed("synthetic-ops-l-plain", "projection_state='projected'");
        const [conversation] = await query(
          `INSERT INTO whatsapp_conversations(woztell_member_id, channel_id)
           VALUES('synthetic-ops-customer','synthetic-ops-channel') RETURNING id`,
        );
        const result = await listInboundReceiptProblems(admin, { query });
        const byId = new Map(result.rows.map((row) => [row.id, row]));
        assert.equal(byId.get(scheduled).kind, "retry_scheduled");
        assert.equal(byId.get(scheduled).canRetry, true);
        assert.ok(byId.get(scheduled).nextRetryAt);
        assert.equal(byId.get(exhausted).kind, "retry_exhausted");
        assert.equal(byId.get(exhausted).canRetry, true);
        assert.equal(byId.get(exhausted).nextRetryAt, null);
        assert.equal(byId.get(review).kind, "review_required");
        assert.equal(byId.get(review).canRetry, false);
        assert.equal(byId.get(routing).kind, "needs_routing");
        assert.equal(byId.get(routing).canRetry, false);
        assert.equal(byId.get(routing).captureMode, "active");
        assert.equal(byId.has(oldRouting), false);
        assert.equal(byId.has(plain), false);
        assert.equal(byId.get(routing).conversationId, conversation.id);
        assert.deepEqual(result.counts, {
          retry_scheduled: 1,
          retry_exhausted: 1,
          review_required: 1,
          needs_routing: 1,
        });
        const serialized = JSON.stringify(result);
        for (const secret of [
          "85255550101",
          "85255550202",
          "合成測試訊息",
          "synthetic-ops-customer",
        ])
          assert.equal(serialized.includes(secret), false, secret);
        for (const row of result.rows)
          for (const key of ["memberId", "member_id", "text", "normalizedEvent", "phone"])
            assert.equal(key in row, false, key);
      },
    );
  });
});
