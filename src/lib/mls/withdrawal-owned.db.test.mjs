import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { withOwnedPostgres } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import {
  previewWithdrawals,
  applyWithdrawalPreview,
  readWithdrawalResult,
} from "./withdrawal-review.mjs";
import { canonicalListingCte } from "../neon/public-listing-query.js";

test("EP-11 canonical sibling active offer blocks a source absence candidate on full schema", async () => {
  await withOwnedPostgres(async ({ pool, query }) => {
    const client = await pool.connect();
    try {
      const [manager] = await query(
        "INSERT INTO staff_users(auth_user_id) VALUES('qa-withdraw-manager') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [manager.id]);
      const actor = { staffId: manager.id, roles: ["manager"] };
      await query(
        "INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version) VALUES('28hse_agent_540','agent:540','synthetic-owned','synthetic-owned'),('propertyhk','branches:EPW,EPS,EPT','synthetic-owned','synthetic-owned')",
      );
      const receipts = [];
      const [oldRun] = await query(
        "INSERT INTO listing_sync_runs(scheduled_for,mode,status,parser_version) VALUES(current_date,'shadow','shadow_healthy','synthetic-owned') RETURNING id",
      );
      for (const [source, scope, hours] of [
        ["28hse_agent_540", "agent:540", 26],
        ["28hse_agent_540", "agent:540", 1],
        ["propertyhk", "branches:EPW,EPS,EPT", 1],
      ]) {
        const [run] = await query(
          "INSERT INTO listing_sync_runs(scheduled_for,mode,status,parser_version) VALUES(current_date,'shadow','shadow_healthy','synthetic-owned') RETURNING id",
        );
        const [receipt] = await query(
          "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,full_snapshot,response) VALUES($1,$2,'synthetic-owned','synthetic-owned',now()-$3::int*interval '1 hour',$4,$5,true,'{\"success\":true}') RETURNING *",
          [source, scope, hours, randomUUID().replaceAll("-", "").repeat(2), run.id],
        );
        await query(
          'INSERT INTO property_sync_runs(source,scope_id,receipt_id,stages,finished_at) VALUES($1,$2,$3,\'{"collection":{"status":"succeeded"},"ingestion":{"status":"succeeded"}}\',now())',
          [source, scope, receipt.id],
        );
        receipts.push(receipt);
      }
      const [target, sibling] = await query(
        "INSERT INTO properties(listing_no,title_zh,deal_type,district_slug,status) VALUES('QA-WITHDRAW-SALE','同一物業售盤','sale','sham-tseng','active'),('QA-WITHDRAW-SIBLING','同一物業另一廣告','sale','sham-tseng','active') RETURNING id",
      );
      const [identity] = await query(
        "SELECT public_listing_no FROM property_public_members WHERE property_id=$1",
        [target.id],
      );
      await query("UPDATE property_public_members SET public_listing_no=$1 WHERE property_id=$2", [
        identity.public_listing_no,
        sibling.id,
      ]);
      for (const [property, receipt, external] of [
        [target, receipts[0], "111"],
        [sibling, receipts[2], "222"],
      ]) {
        const [observation] = await query(
          "INSERT INTO listing_source_observations(run_id,source,external_listing_id,deal_type,source_url,payload,content_hash,validation_state,discovered_at,fetched_at) VALUES($1,$2,$3,'sale','https://example.invalid/owned','{}',repeat('a',64),'valid',now(),now()) RETURNING id",
          [property.id === target.id ? oldRun.id : receipt.run_id, receipt.source, external],
        );
        await query(
          "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,$2,$3,'sale','source_id_v2','active',now()-interval '53 hours',now()-interval '53 hours',$4)",
          [property.id, receipt.source, external, receipt.run_id],
        );
        await query(
          "INSERT INTO mls_source_state(source,scope_id,policy_version,external_listing_id,deal_type,observation_id,last_receipt_id,property_id,source_status,first_seen_at,last_accepted_at) VALUES($1,$2,'synthetic-owned',$3,'sale',$4,$5,$6,'active',now()-interval '53 hours',now())",
          [receipt.source, receipt.scope_id, external, observation.id, receipt.id, property.id],
        );
      }
      // Missing in two comparable synthetic full runs, but another canonical member remains active.
      const preview = await previewWithdrawals({
        client,
        actor,
        source: "28hse_agent_540",
        candidateIds: [target.id],
      });
      assert.equal(
        preview.rows[0].decision.allowed,
        false,
        "Source absence must not deactivate another member's current offer",
      );
      assert.equal(preview.rows[0].decision.reason, "active_source_conflict");
      assert.equal(
        (await query("SELECT count(*)::int n FROM properties WHERE status='active'"))[0].n,
        2,
      );
      await query("UPDATE mls_source_state SET source_status='delisted' WHERE property_id=$1", [
        sibling.id,
      ]);
      const noConflict = await previewWithdrawals({
        client,
        actor,
        source: "28hse_agent_540",
        candidateIds: [target.id],
      });
      assert.equal(noConflict.rows[0].decision.allowed, true);
      await query("UPDATE mls_source_state SET source_status='active' WHERE property_id=$1", [
        sibling.id,
      ]);
      const key = randomUUID();
      const input = {
        client,
        actor,
        previewId: noConflict.previewId,
        selectedIds: [target.id],
        expectedVersions: { [target.id]: noConflict.rows[0].version },
        idempotencyKey: key,
        reason: "Synthetic source changed after preview",
      };
      const result = await applyWithdrawalPreview(input);
      assert.equal(result.results[0].status, "blocked");
      assert.equal(result.results[0].reason, "STALE_SOURCE_OR_PROPERTY");
      assert.deepEqual((await applyWithdrawalPreview(input)).results, result.results);
      assert.deepEqual(
        (await readWithdrawalResult({ client, actor, idempotencyKey: key })).results,
        result.results,
      );
      assert.equal(
        (await query("SELECT count(*)::int n FROM properties WHERE status='active'"))[0].n,
        2,
      );
      // A distinct active rental remains public when two full observations
      // authorize only the sale's withdrawal. It is not a sale source conflict.
      await query("UPDATE properties SET deal_type='rent',rent=26000 WHERE id=$1", [sibling.id]);
      await query("UPDATE property_source_links SET deal_type='rent' WHERE property_id=$1", [
        sibling.id,
      ]);
      const [rentalObservation] = await query(
        "INSERT INTO listing_source_observations(run_id,source,external_listing_id,deal_type,source_url,payload,content_hash,validation_state,discovered_at,fetched_at) SELECT run_id,source,external_listing_id,'rent',source_url,payload,content_hash,validation_state,discovered_at,fetched_at FROM listing_source_observations WHERE id IN (SELECT observation_id FROM mls_source_state WHERE property_id=$1) RETURNING id",
        [sibling.id],
      );
      await query(
        "UPDATE mls_source_state SET deal_type='rent',observation_id=$2 WHERE property_id=$1",
        [sibling.id, rentalObservation.id],
      );
      const saleOnly = await previewWithdrawals({
        client,
        actor,
        source: "28hse_agent_540",
        candidateIds: [target.id],
      });
      assert.equal(
        saleOnly.rows[0].decision.allowed,
        true,
        "Rental offer must not suppress a valid sale-only withdrawal",
      );
      const saleResult = await applyWithdrawalPreview({
        client,
        actor,
        previewId: saleOnly.previewId,
        selectedIds: [target.id],
        expectedVersions: { [target.id]: saleOnly.rows[0].version },
        idempotencyKey: randomUUID(),
        reason: "Synthetic sale-only confirmed absence, preserve rent",
      });
      assert.equal(saleResult.results[0].status, "applied", JSON.stringify(saleResult));
      assert.deepEqual(
        (await query("SELECT id,status::text FROM properties ORDER BY id"))
          .map((p) => [p.id, p.status])
          .sort(),
        [
          [target.id, "inactive"],
          [sibling.id, "active"],
        ].sort(),
      );
      const publicOffers = await query(
        canonicalListingCte("TRUE", true) +
          " SELECT p.id,p.deal_type::text FROM canonical JOIN properties p ON p.id=canonical.id WHERE canonical.public_listing_no=$1",
        [identity.public_listing_no],
      );
      assert.deepEqual(
        publicOffers.map((p) => [p.id, p.deal_type]),
        [[sibling.id, "rent"]],
      );
      assert.ok(
        (
          await query(
            "SELECT count(*)::int n FROM ai_knowledge_repair_requests WHERE source_id=$1 AND completed_revision<revision",
            [target.id],
          )
        )[0].n >= 1,
      );
    } finally {
      client.release();
    }
  });
});
