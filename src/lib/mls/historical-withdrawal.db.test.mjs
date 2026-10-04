import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withOwnedPostgres } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import {
  listWithdrawalCandidates,
  previewWithdrawals,
  applyWithdrawalPreview,
} from "./withdrawal-review.mjs";
test("132 historical missing synthetic candidates remain NOT_APPROVED with zero inventory withdrawals", async () => {
  await withOwnedPostgres(async ({ pool, query: q }) => {
    const client = await pool.connect();
    const db = { client };
    const actor = { staffId: randomUUID(), roles: ["manager"] };
    try {
      await q("INSERT INTO staff_users(id,active) VALUES($1,true);", [actor.staffId]);
      await q("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [actor.staffId]);
      await q(
        "INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','fixture-v2','no-hermes-v2',false,'{}')",
      );
      const old = randomUUID(),
        fresh = randomUUID();
      for (const id of [old, fresh])
        await q(
          "INSERT INTO listing_sync_runs(id,scheduled_for,mode,status,parser_version) VALUES($1,current_date,'shadow','shadow_healthy','fixture-v2')",
          [id],
        );
      await q(
        "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,full_snapshot,response) VALUES('28hse_agent_540','agent:540','no-hermes-v2','fixture-v2',now()-interval '1 hour',repeat('a',64),$1,true,$2::jsonb)",
        [fresh, JSON.stringify({ success: true, status: "success" })],
      );
      // Direct, labelled fixture setup; no production baseline or parser authority is claimed.
      await q(
        "INSERT INTO properties(listing_no,title_zh,deal_type,district_slug,status) SELECT 'HIST-'||g,'合成歷史候選','sale','fixture','active' FROM generate_series(1,132) g",
      );
      await q(
        "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) SELECT p.id,'28hse_agent_540',substring(p.listing_no from 6),'sale','fixture','exact_property_no_and_deal_type','active',now()-interval '72 hours',now()-interval '72 hours',$1 FROM properties p",
        [old],
      );
      const before = await q(
        "SELECT p.id,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id ORDER BY p.id",
      );
      const a = await listWithdrawalCandidates({
        client: db.client,
        actor,
        source: "28hse_agent_540",
        limit: 100,
      });
      const b = await listWithdrawalCandidates({
        client: db.client,
        actor,
        source: "28hse_agent_540",
        limit: 100,
        cursor: a.nextCursor,
      });
      assert.equal(a.rows.length, 100);
      assert.equal(b.rows.length, 32);
      assert.equal(b.nextCursor, null);
      assert.equal(new Set([...a.rows, ...b.rows].map((r) => r.candidateId)).size, 132);
      assert.ok(
        [...a.rows, ...b.rows].every(
          (r) => !r.decision.allowed && r.decision.approval === "NOT_APPROVED",
        ),
      );
      const preview = await previewWithdrawals({
        client: db.client,
        actor,
        source: "28hse_agent_540",
        candidateIds: [a.rows[0].candidateId],
      });
      const applied = await applyWithdrawalPreview({
        client: db.client,
        actor,
        previewId: preview.previewId,
        selectedIds: [a.rows[0].candidateId],
        expectedVersions: { [a.rows[0].candidateId]: a.rows[0].version },
        idempotencyKey: randomUUID(),
        reason: "測試歷史缺席不能授權批量撤盤",
      });
      assert.ok(applied.results.every((r) => r.status === "blocked"));
      assert.equal(
        (await q("SELECT count(*)::int AS n FROM properties WHERE status='inactive'"))[0].n,
        0,
      );
      assert.equal(
        (await q("SELECT count(*)::int AS n FROM property_source_links WHERE status='active'"))[0]
          .n,
        132,
      );
      assert.deepEqual(
        await q(
          "SELECT p.id,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id ORDER BY p.id",
        ),
        before,
      );
    } finally {
      client.release();
    }
  });
});
