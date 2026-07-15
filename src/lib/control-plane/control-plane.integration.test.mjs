import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const migrationPath = "neon/migrations/20260714180000_backend_control_plane.sql";

test("control plane migration creates durable operations tables", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const table of ["ops_audit_logs", "ops_jobs", "ops_job_attempts", "ops_migration_runs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(sql, /CHECK \(outcome IN \('success', 'failure', 'denied'\)\)/);
  assert.match(sql, /CHECK \(payload_version > 0\)/);
  assert.match(sql, /CHECK \(status IN \('queued', 'running', 'succeeded', 'failed', 'cancelled'\)\)/);
  assert.match(sql, /CHECK \(attempt_count >= 0\)/);
  assert.match(sql, /CHECK \(max_attempts > 0\)/);
  assert.match(sql, /UNIQUE \(idempotency_key\)/);
  assert.match(sql, /CHECK \(attempt_number > 0\)/);
  assert.match(sql, /CHECK \(outcome IN \('succeeded', 'failed', 'cancelled'\)\)/);
  assert.match(sql, /UNIQUE \(job_id, attempt_number\)/);
  assert.match(sql, /CHECK \(result IN \('succeeded', 'failed'\)\)/);
  for (const index of [
    "idx_ops_jobs_queue",
    "idx_ops_jobs_lease",
    "idx_ops_audit_logs_request_id",
    "idx_ops_audit_logs_created_at",
    "idx_ops_job_attempts_job_id",
    "idx_ops_migration_runs_request_id",
    "idx_ops_migration_runs_migration_id",
  ]) {
    assert.match(sql, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`));
  }
  assert.match(sql, /FOR EACH ROW EXECUTE FUNCTION prevent_ops_audit_mutation/);
  assert.match(sql, /END IF;\s*END\s*\$\$;/);
});

test("database helper uses Neon transaction batching", () => {
  const source = readFileSync("src/lib/neon/db.server.ts", "utf8");
  assert.match(source, /sql\.transaction\(/);
  assert.match(source, /tx\.query\(statement, params\)/);
});

test("job repository uses idempotent inserts, skip-locked claims, and guarded completion", () => {
  const source = readFileSync("src/lib/control-plane/jobs.server.ts", "utf8");
  assert.match(source, /ON CONFLICT \(idempotency_key\) DO UPDATE/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /status = 'running'[\s\S]*lease_owner = \$2/);
  assert.match(source, /status = 'cancelled'/);
  assert.match(source, /ON CONFLICT \(job_id, attempt_number\) DO NOTHING/);
  assert.doesNotMatch(source, /Math\.random/);
});

test("control plane migration applies and protects audit rows in a disposable database", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const databaseEnv = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
  delete databaseEnv.DATABASE_URL_UNPOOLED;
  const migrationRun = spawnSync(process.execPath, ["scripts/neon/apply-migrations.mjs"], {
    env: databaseEnv,
    encoding: "utf8",
  });
  assert.equal(migrationRun.status, 0, migrationRun.stderr || migrationRun.stdout);

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;

  try {
    const { queryRows, transactionRows } = await import("../neon/db.server.ts");
    const { listAuditLogs, writeAudit } = await import("./audit.server.ts");
    for (const table of ["ops_audit_logs", "ops_jobs", "ops_job_attempts", "ops_migration_runs"]) {
      const rows = await queryRows("SELECT to_regclass($1)::text AS name", [table]);
      assert.equal(rows[0]?.name, table);
    }

    const requestId = crypto.randomUUID();
    const staffRows = await queryRows(
      `INSERT INTO staff_users (email, name_en)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id::text AS id`,
      [`control-plane-${requestId}@example.test`, "Control Plane Test"],
    );
    const actor = {
      staffId: staffRows[0].id,
      authUserId: `test-${requestId}`,
      email: `control-plane-${requestId}@example.test`,
      name: "Control Plane Test",
      roles: ["admin"],
      bootstrap: false,
    };
    await writeAudit({
      actor,
      permission: "system.health.read",
      action: "test.audit",
      outcome: "success",
      context: { requestId, startedAt: new Date().toISOString() },
      metadata: { title: "visible", token: "hidden" },
    });

    const { rows: logs } = await listAuditLogs({ limit: 100 });
    const auditLog = logs.find((row) => row.request_id === requestId);
    assert.ok(auditLog);
    assert.equal(auditLog.metadata.title, "visible");
    assert.equal(auditLog.metadata.token, "[REDACTED]");
    await assert.rejects(
      () => queryRows("UPDATE ops_audit_logs SET action = $1 WHERE request_id = $2::uuid", ["changed", requestId]),
      /append-only/i,
    );
    await assert.rejects(
      () => queryRows("DELETE FROM ops_audit_logs WHERE request_id = $1::uuid", [requestId]),
      /append-only/i,
    );

    const transactionResult = await transactionRows([{ statement: "SELECT 1::integer AS value" }]);
    assert.equal(transactionResult[0]?.[0]?.value, 1);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousUnpooledUrl === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = previousUnpooledUrl;
  }
});

test("migration service rejects stale approvals and records one successful apply", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const databaseEnv = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
  delete databaseEnv.DATABASE_URL_UNPOOLED;
  const migrationRun = spawnSync(process.execPath, ["scripts/neon/apply-migrations.mjs"], {
    env: databaseEnv,
    encoding: "utf8",
  });
  assert.equal(migrationRun.status, 0, migrationRun.stderr || migrationRun.stdout);

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;

  try {
    const { queryRows } = await import("../neon/db.server.ts");
    const { computeMigrationChecksum } = await import("./migration-registry.server.ts");
    const { applyMigration, planMigration } = await import("./migrations.server.ts");
    const migrationId = "20260715093000_control_plane_integration_test";
    const statements = [
      {
        statement:
          "CREATE TABLE ops_control_plane_test_relation (id integer PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())",
      },
    ];
    const migration = {
      id: migrationId,
      checksum: await computeMigrationChecksum(statements),
      dependencies: [],
      summary: "Create the isolated control-plane integration-test relation.",
      statements,
      postconditions: [
        { relation: "ops_control_plane_test_relation" },
        { relation: "ops_control_plane_test_relation", column: "created_at" },
      ],
    };
    const deps = { registry: [migration], approvalSecret: "test-approval-secret" };

    await queryRows("DELETE FROM app_migrations WHERE version = $1", [migrationId]);
    await queryRows("DELETE FROM ops_migration_runs WHERE migration_id = $1", [migrationId]);
    await queryRows("DROP TABLE IF EXISTS ops_control_plane_stale_marker");
    await queryRows("DROP TABLE IF EXISTS ops_control_plane_test_relation");

    const requestId = crypto.randomUUID();
    const staffRows = await queryRows(
      `INSERT INTO staff_users (email, name_en)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id::text AS id`,
      [`migration-${requestId}@example.test`, "Migration Test"],
    );
    const actor = {
      staffId: staffRows[0].id,
      authUserId: `migration-${requestId}`,
      email: `migration-${requestId}@example.test`,
      name: "Migration Test",
      roles: ["admin"],
      bootstrap: false,
    };

    const stalePlan = await planMigration({ migrationId, actor }, deps);
    await queryRows("CREATE TABLE ops_control_plane_stale_marker (id integer)");
    await assert.rejects(
      () =>
        applyMigration(
          {
            migrationId,
            approvalToken: stalePlan.approvalToken,
            actor,
            context: { requestId: crypto.randomUUID(), startedAt: new Date().toISOString() },
          },
          deps,
        ),
      (error) => error?.code === "MIGRATION_APPROVAL_INVALID",
    );
    await queryRows("DROP TABLE ops_control_plane_stale_marker");

    const plan = await planMigration({ migrationId, actor }, deps);
    const result = await applyMigration(
      {
        migrationId,
        approvalToken: plan.approvalToken,
        actor,
        context: { requestId: crypto.randomUUID(), startedAt: new Date().toISOString() },
      },
      deps,
    );
    assert.equal(result.status, "succeeded");
    const relationRows = await queryRows("SELECT to_regclass($1)::text AS name", [
      "ops_control_plane_test_relation",
    ]);
    assert.equal(relationRows[0].name, "ops_control_plane_test_relation");

    await assert.rejects(
      () => planMigration({ migrationId, actor }, deps),
      (error) => error?.code === "CONFLICT_DUPLICATE",
    );
    const runRows = await queryRows(
      `SELECT result, count(*)::integer AS count
       FROM ops_migration_runs
       WHERE migration_id = $1
       GROUP BY result`,
      [migrationId],
    );
    const counts = Object.fromEntries(runRows.map((row) => [row.result, row.count]));
    assert.equal(counts.succeeded, 1);
    assert.equal(counts.failed, 1);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousUnpooledUrl === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = previousUnpooledUrl;
  }
});

test("durable jobs are idempotent, claimed disjointly, and recover expired leases", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const databaseEnv = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
  delete databaseEnv.DATABASE_URL_UNPOOLED;
  const migrationRun = spawnSync(process.execPath, ["scripts/neon/apply-migrations.mjs"], {
    env: databaseEnv,
    encoding: "utf8",
  });
  assert.equal(migrationRun.status, 0, migrationRun.stderr || migrationRun.stdout);

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;

  try {
    const { queryRows } = await import("../neon/db.server.ts");
    const { registerJobHandler } = await import("./job-handlers.server.ts");
    const {
      cancelJob,
      claimJobs,
      completeJob,
      enqueueJob,
      recoverExpiredLeases,
    } = await import("./jobs.server.ts");
    const handler = {
      jobType: "test.integration",
      payloadVersion: 1,
      parsePayload(input) {
        if (!input || typeof input !== "object" || typeof input.value !== "number") {
          throw Object.assign(new Error("Invalid payload"), { code: "VALIDATION_ERROR" });
        }
        return { value: input.value };
      },
      async run() {
        return { summary: { processed: 1 } };
      },
    };
    registerJobHandler(handler);
    await queryRows("DELETE FROM ops_jobs WHERE idempotency_key LIKE 'control-plane-integration:%'");

    const enqueueInput = {
      jobType: handler.jobType,
      payloadVersion: handler.payloadVersion,
      payload: { value: 1 },
      idempotencyKey: "control-plane-integration:idempotent",
      runAfter: new Date(Date.now() + 60 * 60 * 1_000),
    };
    const [first, second] = await Promise.all([enqueueJob(enqueueInput), enqueueJob(enqueueInput)]);
    assert.equal(first.id, second.id);

    const claimable = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        enqueueJob({
          ...enqueueInput,
          payload: { value: index },
          idempotencyKey: `control-plane-integration:claim:${index}`,
          runAfter: new Date(0),
        }),
      ),
    );
    const [workerA, workerB] = await Promise.all([
      claimJobs({ workerId: "integration-worker-a", limit: 2, leaseSeconds: 60 }),
      claimJobs({ workerId: "integration-worker-b", limit: 2, leaseSeconds: 60 }),
    ]);
    const workerAIds = new Set(workerA.map((job) => job.id));
    assert.equal(workerA.length, 2);
    assert.equal(workerB.length, 2);
    assert.equal(workerB.some((job) => workerAIds.has(job.id)), false);
    assert.deepEqual(
      new Set([...workerA, ...workerB].map((job) => job.id)),
      new Set(claimable.map((job) => job.id)),
    );

    const expired = await enqueueJob({
      ...enqueueInput,
      idempotencyKey: "control-plane-integration:expired",
      runAfter: new Date(0),
    });
    const live = await enqueueJob({
      ...enqueueInput,
      idempotencyKey: "control-plane-integration:live",
      runAfter: new Date(0),
    });
    await queryRows(
      `UPDATE ops_jobs
       SET status = 'running', attempt_count = 1, lease_owner = 'lease-test',
           lease_expires_at = CASE WHEN id = $1::uuid THEN now() - interval '1 minute'
                                   ELSE now() + interval '1 hour' END
       WHERE id IN ($1::uuid, $2::uuid)`,
      [expired.id, live.id],
    );
    await recoverExpiredLeases();
    const recovered = await claimJobs({ workerId: "integration-worker-c", limit: 10 });
    assert.equal(recovered.some((job) => job.id === expired.id), true);
    assert.equal(recovered.some((job) => job.id === live.id), false);

    const cancellable = await enqueueJob({
      ...enqueueInput,
      idempotencyKey: "control-plane-integration:cancel",
      runAfter: new Date(0),
    });
    const [running] = await claimJobs({ workerId: "integration-worker-cancel", limit: 1 });
    assert.equal(running.id, cancellable.id);
    assert.ok(await cancelJob({ jobId: running.id }));
    assert.equal(
      await completeJob({ jobId: running.id, workerId: "integration-worker-cancel" }),
      null,
    );
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousUnpooledUrl === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = previousUnpooledUrl;
  }
});

test("Operations read models aggregate jobs without exposing payloads", () => {
  const source = readFileSync("src/lib/control-plane/jobs.server.ts", "utf8");
  assert.match(source, /export async function getJobSummary/);
  assert.match(source, /count\(\*\) FILTER \(WHERE status = 'queued'\)/);
  assert.match(source, /lease_expires_at < now\(\)/);
  assert.doesNotMatch(
    source.slice(source.indexOf("export async function getJobSummary")),
    /SELECT[\s\S]{0,300}\bpayload\b/,
  );
});

test("migration states compare registry checksums with applied records", () => {
  const source = readFileSync("src/lib/control-plane/migrations.server.ts", "utf8");
  assert.match(source, /export async function listMigrationStates/);
  assert.match(source, /ops_migration_runs/);
  assert.match(source, /status: "drift"/);
  assert.doesNotMatch(source, /SELECT\s+statement|SELECT\s+sql/i);
});
