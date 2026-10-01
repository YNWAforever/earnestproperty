import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { openSyncTestDatabase } from "./sync-test-database.mjs";
import {
  recordSyncRun,
  readSyncWorkspace,
  requestSyncOperation,
  readSyncOperationResult,
} from "./sync-run-repository.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { hashPayload } from "./ingestion-contract.mjs";
test(
  "isolated migration execution metadata direct RBAC receipts replay health keyset and query measurements",
  { skip: !process.env.ASTRA_TEST_DATABASE_URL },
  async () => {
    const db = await openSyncTestDatabase(["20261001120000_property_sync_operations.sql"]);
    const { query, client } = db;
    const admin = { staffId: randomUUID(), roles: ["admin"] },
      manager = { staffId: randomUUID(), roles: ["manager"] },
      agent = { staffId: randomUUID(), roles: ["agent"] },
      otherAdmin = { staffId: randomUUID(), roles: ["admin"] };
    try {
      for (const actor of [admin, manager, agent, otherAdmin]) {
        await query("INSERT INTO staff_users VALUES($1,true)", [actor.staffId]);
        await query("INSERT INTO staff_roles VALUES($1,$2)", [actor.staffId, actor.roles[0]]);
      }
      for (const actor of [manager, agent])
        await assert.rejects(
          query("SELECT reserve_property_sync_operation($1,$2,$3,$4)", [
            "28hse_agent_540",
            "collect",
            randomUUID(),
            actor.staffId,
          ]),
          /FORBIDDEN/,
        );
      const input = {
        source: "28hse_agent_540",
        operation: "collect",
        idempotencyKey: randomUUID(),
      };
      let dispatched = 0;
      const options = {
        query,
        actor: admin,
        input,
        capability: { enabled: true },
        dispatch: async () => {
          dispatched++;
          return { accepted: true };
        },
      };
      const reservation = await requestSyncOperation(options);
      assert.equal(reservation.status, "accepted");
      assert.equal((await requestSyncOperation(options)).status, "accepted");
      assert.equal(dispatched, 1);
      const readResult = (actor) =>
        readSyncOperationResult({ query, actor, idempotencyKey: input.idempotencyKey });
      assert.equal((await readResult(admin)).reconciled, false);
      assert.equal((await readResult(otherAdmin)).state, "unknown");
      for (const actor of [manager, agent])
        await assert.rejects(readResult({ ...actor, roles: ["admin"] }), /FORBIDDEN/);

      await assert.rejects(
        requestSyncOperation({ ...options, input: { ...input, idempotencyKey: randomUUID() } }),
        /IN_PROGRESS/,
      );
      await query(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'fixture','{"district_slugs":{"Test":"test"}}')`,
      );
      const payload = batch([row("9900001")], new Date(Date.now() - 40 * 3600000).toISOString());
      const receipt = await ingestSnapshot(payload, {
        connectionString: db.connectionString,
        createClient: db.createClient,
        apply: true,
      });
      const summary = {
        source: "28hse_agent_540",
        scopeId: "agent:540",
        requestHash: hashPayload(payload),
        gitSha: "a".repeat(40),
        workflowRunId: "10001",
        privateEvidenceRef: { requestAsset: "request-10001-1.json" },
        stages: {
          collection: { status: "succeeded" },
          ingestion: { status: "succeeded", receiptId: receipt.receipt_id },
          publication: { status: "failed", errorCode: "MEDIA_FAILED" },
        },
        counts: { canonicalCreated: 1, canonicalUpdated: 0, held: 1 },
        finishedAt: new Date().toISOString(),
      };
      await recordSyncRun({ client, runId: reservation.runId, summary });
      await recordSyncRun({ client, runId: reservation.runId, summary });
      assert.equal(
        (await readResult(admin)).reconciled,
        false,
        "partial stage metadata stays locked",
      );
      summary.stages.verification = { status: "pending" };
      await recordSyncRun({ client, runId: reservation.runId, summary });
      await query("BEGIN READ ONLY");
      try {
        const firstRead = await readResult(admin);
        assert.equal(firstRead.reconciled, true);
        assert.equal(firstRead.state, "completed");
        assert.deepEqual(await readResult(admin), firstRead);
        assert.equal((await readResult(otherAdmin)).reconciled, false);
      } finally {
        await query("ROLLBACK");
      }
      assert.equal(dispatched, 1, "result readback cannot redispatch");
      await query(
        "UPDATE property_sync_runs SET stages=jsonb_set(stages,'{publication,status}','\"unknown\"'::jsonb) WHERE id=$1",
        [reservation.runId],
      );
      assert.equal((await readResult(admin)).reconciled, false);
      await query(
        "UPDATE property_sync_runs SET stages=jsonb_set(stages,'{publication,status}','\"failed\"'::jsonb) WHERE id=$1",
        [reservation.runId],
      );

      await assert.rejects(
        recordSyncRun({
          client,
          runId: reservation.runId,
          summary: { ...summary, stages: { collection: { status: "running" } } },
        }),
        /terminal/,
      );
      await assert.rejects(
        recordSyncRun({
          client,
          runId: reservation.runId,
          summary: { ...summary, requestHash: "0".repeat(64) },
        }),
        /RECEIPT/,
      );
      const ws = await readSyncWorkspace({ query, actor: manager });
      assert.equal(ws.cards.length, 4);
      assert.equal(ws.history.length, 1);
      assert.equal(ws.cards[0].backlog, 1);
      assert.equal(ws.cards[0].message, "同步失敗，保留現有資料");
      assert.equal(ws.cards[1].health, "never_synced");
      const previousPublicationAt = new Date(Date.now() - 3600000).toISOString();
      await query(
        `INSERT INTO property_sync_runs(source,scope_id,workflow_run_id,stages,counts,started_at,finished_at)
         VALUES('28hse_agent_540','agent:540','10002',$1::jsonb,'{"published":1}',now()-interval '2 hours',now()-interval '1 hour')`,
        [
          JSON.stringify({
            publication: { status: "succeeded", finishedAt: previousPublicationAt },
          }),
        ],
      );
      for (const status of ["failed", "unknown", "cancelled"]) {
        await query(
          "UPDATE property_sync_runs SET stages=jsonb_set(stages,'{publication,status}',to_jsonb($2::text)) WHERE id=$1",
          [reservation.runId, status],
        );
        await query("BEGIN READ ONLY");
        try {
          const latestFailure = await readSyncWorkspace({ query, actor: manager });
          assert.equal(latestFailure.cards[0].lastPublishedAt, previousPublicationAt);
          assert.equal(latestFailure.cards[0].health, status === "unknown" ? "unknown" : "failed");
          assert.ok(latestFailure.cards.slice(1).every((card) => card.lastPublishedAt === null));
        } finally {
          await query("ROLLBACK");
        }
      }
      await query(
        "UPDATE property_sync_runs SET stages=jsonb_set(stages,'{publication,status}','\"failed\"'::jsonb) WHERE id=$1",
        [reservation.runId],
      );
      await query(
        "UPDATE property_sync_runs SET started_at=now()-interval '2 minutes' WHERE id=$1",
        [reservation.runId],
      );
      const rejectedKey = randomUUID();
      const rejected = await requestSyncOperation({
        ...options,
        input: { ...input, idempotencyKey: rejectedKey },
        dispatch: async () => ({ accepted: false, rejected: true }),
      });
      assert.equal(rejected.status, "failed");
      await query("BEGIN READ ONLY");
      try {
        const rejectedCard = (await readSyncWorkspace({ query, actor: manager })).cards[0];
        assert.equal(rejectedCard.health, "failed");
        assert.equal(rejectedCard.lastPublishedAt, previousPublicationAt);
        assert.equal(
          (await readSyncOperationResult({ query, actor: admin, idempotencyKey: rejectedKey }))
            .state,
          "failed",
        );
      } finally {
        await query("ROLLBACK");
      }
      await query("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '31 hours'");
      const staleCard = (await readSyncWorkspace({ query, actor: admin })).cards[0];
      assert.equal(staleCard.health, "stale");
      assert.equal(staleCard.lastPublishedAt, previousPublicationAt);
      await query(
        `INSERT INTO property_sync_runs(source,scope_id,started_at,finished_at) SELECT '28hse_agent_540','agent:540',now()-g*interval '1 second',now() FROM generate_series(1,1000)g`,
      );
      const first = await readSyncWorkspace({ query, actor: admin, limit: 25 }),
        second = await readSyncWorkspace({
          query,
          actor: admin,
          limit: 25,
          cursor: first.nextCursor,
        });
      assert.equal(first.history.length, 25);
      assert.equal(second.history.length, 25);
      assert.ok(!second.history.some((r) => first.history.some((f) => f.id === r.id)));
      const plans = await query(
        "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM property_sync_runs ORDER BY started_at DESC,id DESC LIMIT 25",
      );
      const times = [];
      let publicationRead;
      const measuredQuery = (sql, params = []) => {
        if (sql.includes("last_published_at")) publicationRead = { sql, params };
        return query(sql, params);
      };
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        await readSyncWorkspace({ query: measuredQuery, actor: admin });
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const publicationPlan = await query(
        "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + publicationRead.sql,
        publicationRead.params,
      );
      writeFileSync(
        ".task-logs/t9-query-measurements.json",
        JSON.stringify(
          {
            synthetic: true,
            rows: 1003,
            iterations: 7,
            p50Ms: times[3],
            p95Ms: times[6],
            plans,
            publicationPlan,
          },
          null,
          2,
        ),
      );
    } finally {
      await db.close();
    }
  },
);
