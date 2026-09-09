import assert from "node:assert/strict";
import { test } from "node:test";

import { savePromotionTiers } from "./promotion-tier-repository.mjs";
import { PROMOTION_TIERS } from "./promotion-tier.mjs";

function observation(over) {
  return {
    source: "28hse_agent_540",
    externalId: "3998335",
    dealType: "rent",
    promotionTier: PROMOTION_TIERS.GOLD,
    promotionTierRaw: "黃金",
    fetchedAt: "2026-09-09T00:00:00.000Z",
    observationId: null,
    ...over,
  };
}

/** A query stub that answers the stored-tier read and records every write. */
function fakeQuery(storedRows = []) {
  const writes = [];
  const reads = [];
  const query = async (text, params) => {
    if (text.includes("SELECT source, external_listing_id, deal_type, promotion_tier")) {
      reads.push(params);
      return storedRows;
    }
    if (text.includes("INSERT INTO mls_source_promotion_tiers")) {
      writes.push(params);
      return [];
    }
    throw new Error(`unexpected query: ${text.slice(0, 60)}`);
  };
  return { query, writes, reads };
}

test("an observed grade is persisted with its raw text and observation time", async () => {
  const { query, writes } = fakeQuery();
  const result = await savePromotionTiers(query, [observation({})], { snapshotComplete: true });

  assert.deepEqual(result, { written: 1, skipped: 0 });
  const [source, externalId, dealType, tier, raw, observedAt, complete] = writes[0];
  assert.equal(source, "28hse_agent_540");
  assert.equal(externalId, "3998335");
  assert.equal(dealType, "rent");
  assert.equal(tier, PROMOTION_TIERS.GOLD);
  assert.equal(raw, "黃金");
  assert.equal(observedAt, "2026-09-09T00:00:00.000Z");
  assert.equal(complete, true);
});

test("an unobserved tier is never written, so an incomplete extraction cannot erase state", async () => {
  const { query, writes } = fakeQuery([
    {
      source: "28hse_agent_540",
      external_listing_id: "3998335",
      deal_type: "rent",
      promotion_tier: "gold",
    },
  ]);
  const result = await savePromotionTiers(
    query,
    [observation({ promotionTier: PROMOTION_TIERS.UNKNOWN, promotionTierRaw: null })],
    { snapshotComplete: true },
  );
  assert.deepEqual(result, { written: 0, skipped: 0 });
  assert.equal(writes.length, 0);
});

test("a complete snapshot may demote a listing whose placement expired", async () => {
  const { query, writes } = fakeQuery([
    {
      source: "28hse_agent_540",
      external_listing_id: "3998335",
      deal_type: "rent",
      promotion_tier: "gold",
    },
  ]);
  const result = await savePromotionTiers(
    query,
    [observation({ promotionTier: PROMOTION_TIERS.NORMAL, promotionTierRaw: null })],
    { snapshotComplete: true },
  );
  assert.deepEqual(result, { written: 1, skipped: 0 });
  assert.equal(writes[0][3], PROMOTION_TIERS.NORMAL);
});

test("an incomplete snapshot must not demote, but may still record a promotion", async () => {
  const stored = [
    {
      source: "28hse_agent_540",
      external_listing_id: "3998335",
      deal_type: "rent",
      promotion_tier: "gold",
    },
  ];

  const demote = fakeQuery(stored);
  assert.deepEqual(
    await savePromotionTiers(
      demote.query,
      [observation({ promotionTier: PROMOTION_TIERS.NORMAL, promotionTierRaw: null })],
      { snapshotComplete: false },
    ),
    { written: 0, skipped: 1 },
  );
  assert.equal(demote.writes.length, 0, "a partial crawl is not evidence of a demotion");

  const promote = fakeQuery([{ ...stored[0], promotion_tier: "normal" }]);
  assert.deepEqual(
    await savePromotionTiers(promote.query, [observation({})], { snapshotComplete: false }),
    { written: 1, skipped: 0 },
  );
  assert.equal(promote.writes[0][3], PROMOTION_TIERS.GOLD);
});

test("snapshotComplete must be stated explicitly, never defaulted", async () => {
  const { query } = fakeQuery();
  await assert.rejects(() => savePromotionTiers(query, [observation({})], {}), TypeError);
  await assert.rejects(
    () => savePromotionTiers(query, [observation({})], { snapshotComplete: "yes" }),
    TypeError,
  );
});

test("nothing is queried at all when no observation carries a grade", async () => {
  const { query, reads, writes } = fakeQuery();
  const result = await savePromotionTiers(
    query,
    [observation({ promotionTier: PROMOTION_TIERS.UNKNOWN })],
    { snapshotComplete: true },
  );
  assert.deepEqual(result, { written: 0, skipped: 0 });
  assert.equal(reads.length, 0);
  assert.equal(writes.length, 0);
});

test("a first sighting is stored even when nothing is on record yet", async () => {
  const { query, writes } = fakeQuery([]);
  await savePromotionTiers(
    query,
    [observation({ promotionTier: PROMOTION_TIERS.NORMAL, promotionTierRaw: null })],
    { snapshotComplete: false },
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0][3], PROMOTION_TIERS.NORMAL);
});

test("Property.hk and old-site records are not given a 28Hse paid tier", async () => {
  const { query, writes } = fakeQuery();
  await savePromotionTiers(
    query,
    [
      observation({ source: "propertyhk", promotionTier: PROMOTION_TIERS.UNKNOWN }),
      observation({ source: "old_site", promotionTier: PROMOTION_TIERS.UNKNOWN }),
    ],
    { snapshotComplete: true },
  );
  assert.equal(writes.length, 0);
});
