import assert from "node:assert/strict";
import test from "node:test";
import { previewCoverageBackfill } from "../neon/whatsapp-coverage.server.ts";

const actor = { staffId: "00000000-0000-4000-8000-000000000001", roles: ["admin"] };
const propertyId = "00000000-0000-4000-8000-000000000002";
test("coverage backfill only signs a fresh preview and never commits a link", async () => {
  const before = {
    channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
    enabled: process.env.EP_WA_TRACKED_LINKS_ENABLED,
  };
  process.env.EP_WA_COMPANY_CHANNEL_ID = "company";
  process.env.EP_WA_TRACKED_LINKS_ENABLED = "true";
  const statements = [];
  const query = async (sql, params = []) => {
    statements.push(sql);
    if (sql.includes("SELECT s.id FROM staff_users")) return [{ id: actor.staffId }];
    if (sql.includes("FROM canonical c JOIN properties") && params[3]?.includes(propertyId)) return [{
      property_id: propertyId, public_listing_no: "A074714", deal_type: "sale",
      candidate_count: 0, code: null,
    }];
    if (sql.includes("FROM canonical c JOIN properties")) return [];
    if (sql.includes("WITH wanted AS")) {
      const [row] = JSON.parse(params[0]);
      return [{
        row_key: row.rowKey, placement_key: row.placementKey,
        offer_ok: true, staff_ok: true, reference_ok: true,
        candidate_count: 0, candidate_id: null, reserved_id: null,
        mapping_version: null,
      }];
    }
    if (sql.includes("INSERT INTO whatsapp_link_batch_previews"))
      return [{ expires_at: new Date(Date.now() + 600000).toISOString() }];
    throw new Error("Unexpected SQL");
  };
  try {
    const result = await previewCoverageBackfill({ propertyIds: [propertyId] }, actor, query);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].placementId, "website:primary");
    assert.equal(result.rows[0].input.placementVerified, true);
    assert.equal(result.preview.counts.create, 1);
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO whatsapp_link_batch_previews")));
    assert.equal(statements.some((sql) => sql.includes("INSERT INTO whatsapp_tracking_links")), false);
    assert.equal(statements.some((sql) => sql.includes("wa_commit_link_batch_chunk")), false);
    await assert.rejects(
      previewCoverageBackfill({ propertyIds: ["00000000-0000-4000-8000-000000000003"] }, actor, query),
      (error) => error instanceof Response && error.status === 409,
    );
    await assert.rejects(
      previewCoverageBackfill({ propertyIds: [propertyId] }, { ...actor, roles: ["agent"] }, query),
      (error) => error instanceof Response && error.status === 403,
    );
  } finally {
    if (before.channel === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
    else process.env.EP_WA_COMPANY_CHANNEL_ID = before.channel;
    if (before.enabled === undefined) delete process.env.EP_WA_TRACKED_LINKS_ENABLED;
    else process.env.EP_WA_TRACKED_LINKS_ENABLED = before.enabled;
  }
});
