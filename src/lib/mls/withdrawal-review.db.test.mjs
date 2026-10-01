import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openSyncTestDatabase } from "./sync-test-database.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import { hashPayload } from "./ingestion-contract.mjs";
import { recordSyncRun } from "./sync-run-repository.mjs";
import {
  listWithdrawalCandidates,
  previewWithdrawals,
  applyWithdrawalPreview,
} from "./withdrawal-review.mjs";
import { canonicalListingCte } from "../neon/public-listing-query.js";
test(
  "withdrawal real SQL TTL permissions partial stale source competing managers idempotent unknown commit and public readback",
  { skip: !process.env.ASTRA_TEST_DATABASE_URL },
  async () => {
    const db = await openSyncTestDatabase([
      "20261001120000_property_sync_operations.sql",
      "20261001130000_property_withdrawal_review.sql",
    ]);
    const { query: q, client } = db;
    const manager = { staffId: randomUUID(), roles: ["manager"] },
      second = { staffId: randomUUID(), roles: ["manager"] },
      agent = { staffId: randomUUID(), roles: ["agent"] };
    let other;
    const source = "28hse_agent_540";
    const opts = {
      apply: true,
      connectionString: db.connectionString,
      createClient: db.createClient,
    };
    const apply = (preview, selected, actor = manager, port = client, key = randomUUID()) =>
      applyWithdrawalPreview({
        client: port,
        actor,
        previewId: preview.previewId,
        selectedIds: selected,
        expectedVersions: Object.fromEntries(
          preview.rows
            .filter((r) => selected.includes(r.candidateId))
            .map((r) => [r.candidateId, r.version]),
        ),
        idempotencyKey: key,
        reason: "已逐盤核實來源及樓盤狀態",
      });
    try {
      for (const a of [manager, second, agent]) {
        await q("INSERT INTO staff_users VALUES($1,true)", [a.staffId]);
        await q("INSERT INTO staff_roles VALUES($1,$2)", [a.staffId, a.roles[0]]);
      }
      await q(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'fixture','{"district_slugs":{"Test":"test"}}')`,
      );
      const targets = Array.from({ length: 5 }, (_, i) =>
          row(String(8800001 + i), { unit: String(i + 1) }),
        ),
        anchors = Array.from({ length: 13 }, (_, i) =>
          row(String(8900001 + i), { unit: String(20 + i) }),
        );
      const importFull = async (rows, hours) => {
        const payload = batch(rows, new Date(Date.now() - hours * 3600000).toISOString());
        await q("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 hours'");
        const receipt = await ingestSnapshot(payload, opts);
        await recordSyncRun({
          client,
          runId: randomUUID(),
          summary: {
            source,
            scopeId: "agent:540",
            requestHash: hashPayload(payload),
            stages: {
              collection: { status: "succeeded" },
              ingestion: { status: "succeeded", receiptId: receipt.receipt_id },
            },
            counts: {
              canonicalCreated: receipt.summary.properties_created,
              canonicalUpdated: receipt.summary.properties_changed,
            },
            finishedAt: new Date().toISOString(),
          },
        });
        return receipt;
      };
      await importFull([...targets, ...anchors], 53);
      await q("BEGIN");
      await q("SELECT set_config('app.admin_property_write','on',true)");
      await q("UPDATE properties SET status='active'");
      await q("COMMIT");
      const ids = (
        await q(
          "SELECT property_id FROM mls_source_state WHERE external_listing_id=ANY($1::text[]) ORDER BY external_listing_id",
          [targets.map((r) => r.property_id)],
        )
      ).map((r) => r.property_id);
      await importFull(anchors, 26);
      const pending = await previewWithdrawals({
        client,
        actor: manager,
        source,
        candidateIds: ids,
      });
      assert.ok(pending.rows.every((r) => r.decision.approval === "NOT_APPROVED"));
      assert.equal(
        (await q("SELECT count(*)::int n FROM properties WHERE status='inactive'"))[0].n,
        0,
      );
      await importFull(anchors, 1);
      await assert.rejects(
        previewWithdrawals({
          client,
          actor: { ...agent, roles: ["admin"] },
          source,
          candidateIds: ids,
        }),
        /FORBIDDEN/,
      );
      const a = await previewWithdrawals({
          client,
          actor: manager,
          source,
          candidateIds: ids.slice(0, 2),
        }),
        b = await previewWithdrawals({ client, actor: second, source, candidateIds: [ids[0]] });
      assert.ok(
        a.rows.every((r) => r.decision.allowed),
        JSON.stringify(a.rows.map((r) => r.decision)),
      );
      const expired = await previewWithdrawals({
        client,
        actor: manager,
        source,
        candidateIds: [ids[2]],
      });
      await q(
        "UPDATE property_withdrawal_previews SET expires_at=now()-interval '1 second' WHERE id=$1",
        [expired.previewId],
      );
      await assert.rejects(apply(expired, [ids[2]]), /STALE_PREVIEW/);
      const p2 = a.rows.find((r) => r.candidateId === ids[1]);
      await q("SELECT admin_property_manage($1,$2,$3,$4,$5)", [
        p2.propertyNo,
        p2.version,
        "sale",
        JSON.stringify({ description: "Staff change after preview" }),
        second.staffId,
      ]);
      const key = randomUUID();
      const result = await apply(a, ids.slice(0, 2), manager, client, key);
      assert.equal(result.results.filter((r) => r.status === "applied").length, 1);
      assert.equal(result.results.filter((r) => r.status === "blocked").length, 1);
      assert.deepEqual(
        (await apply(a, ids.slice(0, 2), manager, client, key)).results,
        result.results,
      );
      assert.equal((await apply(b, [ids[0]], second)).results[0].status, "blocked");
      const unknown = await previewWithdrawals({
          client,
          actor: manager,
          source,
          candidateIds: [ids[2]],
        }),
        unknownKey = randomUUID();
      let lose = true;
      const port = {
        query: async (s, p) => {
          const result = await client.query(s, p);
          if (s === "COMMIT" && lose) {
            lose = false;
            throw Error("synthetic lost commit ack");
          }
          return result;
        },
      };
      await assert.rejects(apply(unknown, [ids[2]], manager, port, unknownKey), /OUTCOME_UNKNOWN/);
      const recovered = await apply(unknown, [ids[2]], manager, client, unknownKey);
      assert.equal(recovered.replayed, true);
      assert.equal(recovered.results[0].status, "applied");
      const c1 = await previewWithdrawals({
          client,
          actor: manager,
          source,
          candidateIds: [ids[3]],
        }),
        c2 = await previewWithdrawals({ client, actor: second, source, candidateIds: [ids[3]] });
      other = db.createClient({ connectionString: db.connectionString });
      await other.connect();
      const competition = await Promise.all([
        apply(c1, [ids[3]]),
        apply(c2, [ids[3]], second, other),
      ]);
      assert.equal(
        competition.flatMap((r) => r.results).filter((r) => r.status === "applied").length,
        1,
      );
      assert.equal(
        competition.flatMap((r) => r.results).filter((r) => r.status === "blocked").length,
        1,
      );
      const publicRows = await q(canonicalListingCte("TRUE") + " SELECT * FROM canonical");
      assert.ok(!publicRows.some((r) => [ids[0], ids[2], ids[3]].includes(r.id)));
      assert.ok(publicRows.some((r) => r.id === ids[1]));
      assert.equal((await q("SELECT count(*)::int n FROM property_public_members"))[0].n, 18);
      assert.equal((await q("SELECT count(*)::int n FROM properties"))[0].n, 18);
      const sourceRace = await previewWithdrawals({
        client,
        actor: manager,
        source,
        candidateIds: [ids[4]],
      });
      const failed = (
        await q(
          "INSERT INTO property_sync_runs(source,scope_id,stages,finished_at) VALUES('28hse_agent_540','agent:540','{\"ingestion\":{\"status\":\"failed\"}}',now()) RETURNING id",
        )
      )[0];
      const failedInterval = await previewWithdrawals({
        client,
        actor: manager,
        source,
        candidateIds: [ids[4]],
      });
      assert.equal(failedInterval.rows[0].decision.reason, "failed_or_unknown_interval");
      await q("DELETE FROM property_sync_runs WHERE id=$1", [failed.id]);
      await q("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 hours'");
      await ingestSnapshot(
        batch([...targets, ...anchors], new Date(Date.now() - 30 * 60000).toISOString()),
        opts,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int n FROM properties WHERE id=ANY($1::uuid[]) AND status='inactive'",
            [[ids[0], ids[2], ids[3]]],
          )
        )[0].n,
        3,
      );
      assert.equal((await apply(sourceRace, [ids[4]])).results[0].status, "blocked");
      assert.equal(
        (await q("SELECT status::text FROM properties WHERE id=$1", [ids[4]]))[0].status,
        "active",
      );
    } finally {
      await other?.end();
      await db.close();
    }
  },
);
