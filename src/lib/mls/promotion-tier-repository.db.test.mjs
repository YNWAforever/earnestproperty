import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import { savePromotionTiers } from "./promotion-tier-repository.mjs";

const url = process.env.ASTRA_TEST_DATABASE_URL;
const stamp = "2026-10-02T05:34:07.123821Z";
const observation = (index, extra = {}) => ({
  source: "28hse_agent_540",
  externalId: String(4000000 + index),
  dealType: index % 5 === 0 ? "rent" : "sale",
  promotionTier: ["normal", "pinned", "gold"][index % 3],
  promotionTierRaw: [null, "置頂", "黃金"][index % 3],
  fetchedAt: stamp,
  observationId: null,
  ...extra,
});

test("promotion batches on a verified disposable Neon connection", { skip: !url }, async (t) => {
  await assertDisposableNeonTestTarget(url);
  assert.notEqual(url, process.env.DATABASE_URL_UNPOOLED);
  const client = new Client({ connectionString: url });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  await client.connect();
  const q = async (sql, args = []) => (await client.query(sql, args)).rows;
  try {
    // The connection-local shadow table carries the real column/check/index schema.
    // No source data, receipts or canonical inventory are copied or mutated.
    await q(
      "CREATE TEMP TABLE mls_source_promotion_tiers (LIKE public.mls_source_promotion_tiers INCLUDING ALL)",
    );
    await t.test(
      "281 daily offers preserve grades and timestamps within four database requests",
      async (t) => {
        const rows = Array.from({ length: 281 }, (_, index) => observation(index));
        rows[280].observationId = "00000000-0000-4000-8000-000000000001";
        let requests = 0;
        const started = performance.now();
        const result = await savePromotionTiers(
          async (sql, args) => {
            requests += 1;
            return q(sql, args);
          },
          rows,
          { snapshotComplete: true },
        );
        t.diagnostic(
          JSON.stringify({
            offers: 281,
            requests,
            elapsedMs: Math.round(performance.now() - started),
          }),
        );
        assert.deepEqual(result, { written: 281, skipped: 0 });
        const stored = await q(
          "SELECT external_listing_id,deal_type,promotion_tier,promotion_tier_raw,to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp,snapshot_complete,observation_id FROM mls_source_promotion_tiers ORDER BY external_listing_id",
        );
        assert.equal(stored.length, 281);
        assert.deepEqual(stored[0], {
          external_listing_id: "4000000",
          deal_type: "rent",
          promotion_tier: "normal",
          promotion_tier_raw: null,
          stamp,
          snapshot_complete: true,
          observation_id: null,
        });
        assert.deepEqual(stored[280], {
          external_listing_id: "4000280",
          deal_type: "rent",
          promotion_tier: "pinned",
          promotion_tier_raw: "置頂",
          stamp,
          snapshot_complete: true,
          observation_id: "00000000-0000-4000-8000-000000000001",
        });
        assert.ok(
          requests <= 4,
          `daily promotion writes made ${requests} database requests; budget is 4`,
        );
      },
    );
    await t.test(
      "duplicates across a batch boundary retain the last eligible offer independently of sale and rent",
      async () => {
        await q("TRUNCATE mls_source_promotion_tiers");
        const rows = Array.from({ length: 251 }, (_, index) => observation(index));
        rows.push(observation(0, { promotionTier: "gold", promotionTierRaw: "黃金" }));
        rows.push(
          observation(0, { dealType: "sale", promotionTier: "pinned", promotionTierRaw: "置頂" }),
        );
        assert.deepEqual(await savePromotionTiers(q, rows, { snapshotComplete: true }), {
          written: 253,
          skipped: 0,
        });
        assert.deepEqual(
          await q(
            "SELECT deal_type,promotion_tier FROM mls_source_promotion_tiers WHERE external_listing_id='4000000' ORDER BY deal_type::text",
          ),
          [
            { deal_type: "rent", promotion_tier: "gold" },
            { deal_type: "sale", promotion_tier: "pinned" },
          ],
        );
        assert.equal((await q("SELECT count(*)::int n FROM mls_source_promotion_tiers"))[0].n, 252);
      },
    );
    await t.test(
      "full duplicate offers in one chunk keep order without bypassing an earlier invalid observation",
      async () => {
        await q("TRUNCATE mls_source_promotion_tiers");
        assert.deepEqual(
          await savePromotionTiers(
            q,
            [observation(0, { promotionTier: "gold", promotionTierRaw: "黃金" }), observation(0)],
            { snapshotComplete: true },
          ),
          { written: 2, skipped: 0 },
        );
        assert.equal(
          (await q("SELECT promotion_tier FROM mls_source_promotion_tiers"))[0].promotion_tier,
          "normal",
        );
        await q("TRUNCATE mls_source_promotion_tiers");
        await q("BEGIN");
        await assert.rejects(
          () =>
            savePromotionTiers(
              q,
              [observation(0, { promotionTierRaw: "x".repeat(65) }), observation(0)],
              { snapshotComplete: true },
            ),
          (error) => error.code === "23514",
        );
        await q("ROLLBACK");
        assert.equal((await q("SELECT count(*)::int n FROM mls_source_promotion_tiers"))[0].n, 0);
      },
    );
    await t.test(
      "partial snapshots keep paid grades, allow promotion and ignore unknown observations",
      async () => {
        await q("TRUNCATE mls_source_promotion_tiers");
        await savePromotionTiers(
          q,
          [
            observation(1, { promotionTier: "gold", promotionTierRaw: "黃金" }),
            observation(2, { promotionTier: "normal", promotionTierRaw: null }),
          ],
          { snapshotComplete: true },
        );
        const result = await savePromotionTiers(
          q,
          [
            observation(1, { promotionTier: "normal", promotionTierRaw: null }),
            observation(2),
            observation(3, { promotionTier: "unknown" }),
          ],
          { snapshotComplete: false },
        );
        assert.deepEqual(result, { written: 1, skipped: 1 });
        assert.deepEqual(
          await q(
            "SELECT external_listing_id,promotion_tier,snapshot_complete FROM mls_source_promotion_tiers ORDER BY external_listing_id",
          ),
          [
            { external_listing_id: "4000001", promotion_tier: "gold", snapshot_complete: true },
            { external_listing_id: "4000002", promotion_tier: "gold", snapshot_complete: false },
          ],
        );
      },
    );
    await t.test(
      "partial duplicate evidence keeps the strongest grade observed in that snapshot",
      async () => {
        await q("TRUNCATE mls_source_promotion_tiers");
        await savePromotionTiers(q, [observation(0)], { snapshotComplete: true });
        assert.deepEqual(
          await savePromotionTiers(
            q,
            [
              observation(0, { promotionTier: "gold", promotionTierRaw: "黃金" }),
              observation(0, { promotionTier: "pinned", promotionTierRaw: "置頂" }),
            ],
            { snapshotComplete: false },
          ),
          { written: 1, skipped: 1 },
        );
        assert.equal(
          (await q("SELECT promotion_tier FROM mls_source_promotion_tiers"))[0].promotion_tier,
          "gold",
        );
      },
    );
    await t.test(
      "a late batch failure rolls back every earlier write in the caller transaction",
      async () => {
        await q("TRUNCATE mls_source_promotion_tiers");
        await q("BEGIN");
        const rows = Array.from({ length: 251 }, (_, index) => observation(index));
        rows[250].promotionTierRaw = "x".repeat(65);
        await assert.rejects(
          () => savePromotionTiers(q, rows, { snapshotComplete: true }),
          (error) => error.code === "23514",
        );
        await q("ROLLBACK");
        assert.equal((await q("SELECT count(*)::int n FROM mls_source_promotion_tiers"))[0].n, 0);
      },
    );
  } finally {
    await client.end();
  }
});
