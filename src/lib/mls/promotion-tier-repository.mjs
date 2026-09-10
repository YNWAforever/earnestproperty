import {
  PROMOTION_TIERS,
  isPromotionTier,
  shouldReplaceStoredPromotionTier,
} from "./promotion-tier.mjs";

/**
 * Persists observed 28Hse promotion grades into mls_source_promotion_tiers
 * (neon/migrations/20260909120000_source_promotion_tiers.sql).
 *
 * Deliberately separate from saveObservations: the tier is per source listing,
 * not per run, and its write has a rule that observation persistence does not
 * -- an incomplete snapshot may promote but never demote. Keeping it here also
 * keeps that behaviour testable on its own, without a live database.
 *
 * `snapshotComplete` must be the crawl's own completeness signal (28Hse's
 * `paginationComplete`, with a detected challenge counting as incomplete), not
 * a default. Passing `true` for a partial crawl is what would let a missing
 * badge look like a real demotion.
 */
export async function savePromotionTiers(query, observations, { snapshotComplete }) {
  if (typeof snapshotComplete !== "boolean") {
    throw new TypeError("snapshotComplete must be an explicit boolean");
  }
  const candidates = observations.filter(
    (observation) =>
      isPromotionTier(observation?.promotionTier) &&
      observation.promotionTier !== PROMOTION_TIERS.UNKNOWN,
  );
  if (candidates.length === 0) return { written: 0, skipped: 0 };

  const sources = candidates.map((o) => o.source);
  const externalIds = candidates.map((o) => String(o.externalId));
  const dealTypes = candidates.map((o) => o.dealType);

  const storedRows = await query(
    `SELECT source, external_listing_id, deal_type, promotion_tier
       FROM mls_source_promotion_tiers
      WHERE (source, external_listing_id, deal_type) IN (
        SELECT k.source, k.external_listing_id, k.deal_type::deal_type
          FROM unnest($1::text[], $2::text[], $3::text[])
            AS k(source, external_listing_id, deal_type)
      )`,
    [sources, externalIds, dealTypes],
    "read stored promotion tiers",
  );
  const stored = new Map(
    (storedRows ?? []).map((row) => [
      `${row.source} ${row.external_listing_id} ${row.deal_type}`,
      row.promotion_tier,
    ]),
  );

  let written = 0;
  let skipped = 0;
  for (const observation of candidates) {
    const key = `${observation.source} ${observation.externalId} ${observation.dealType}`;
    const storedTier = stored.get(key) ?? PROMOTION_TIERS.UNKNOWN;
    if (
      !shouldReplaceStoredPromotionTier({
        incomingTier: observation.promotionTier,
        storedTier,
        snapshotComplete,
      })
    ) {
      skipped += 1;
      continue;
    }
    await query(
      `INSERT INTO mls_source_promotion_tiers
         (source, external_listing_id, deal_type, promotion_tier, promotion_tier_raw,
          observed_at, snapshot_complete, observation_id)
       VALUES ($1, $2, $3::deal_type, $4, $5, $6::timestamptz, $7, $8::uuid)
       ON CONFLICT (source, external_listing_id, deal_type) DO UPDATE SET
         promotion_tier = EXCLUDED.promotion_tier,
         promotion_tier_raw = EXCLUDED.promotion_tier_raw,
         observed_at = EXCLUDED.observed_at,
         snapshot_complete = EXCLUDED.snapshot_complete,
         observation_id = EXCLUDED.observation_id,
         updated_at = now()`,
      [
        observation.source,
        String(observation.externalId),
        observation.dealType,
        observation.promotionTier,
        observation.promotionTierRaw ?? null,
        observation.fetchedAt,
        snapshotComplete,
        observation.observationId ?? null,
      ],
      "write promotion tier",
    );
    written += 1;
  }
  return { written, skipped };
}
