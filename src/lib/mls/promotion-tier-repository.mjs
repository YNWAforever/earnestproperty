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
  let pending = [];
  const queuedKeys = new Set();
  const flush = async () => {
    if (pending.length === 0) return;
    await query(
      `INSERT INTO mls_source_promotion_tiers
         (source, external_listing_id, deal_type, promotion_tier, promotion_tier_raw,
          observed_at, snapshot_complete, observation_id)
       SELECT k.source, k.external_listing_id, k.deal_type::deal_type,
              k.promotion_tier, k.promotion_tier_raw, k.observed_at,
              k.snapshot_complete, k.observation_id
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                     $6::timestamptz[], $7::boolean[], $8::uuid[])
           AS k(source, external_listing_id, deal_type, promotion_tier, promotion_tier_raw,
                observed_at, snapshot_complete, observation_id)
       ON CONFLICT (source, external_listing_id, deal_type) DO UPDATE SET
         promotion_tier = EXCLUDED.promotion_tier,
         promotion_tier_raw = EXCLUDED.promotion_tier_raw,
         observed_at = EXCLUDED.observed_at,
         snapshot_complete = EXCLUDED.snapshot_complete,
         observation_id = EXCLUDED.observation_id,
         updated_at = now()`,
      [
        pending.map((o) => o.source),
        pending.map((o) => String(o.externalId)),
        pending.map((o) => o.dealType),
        pending.map((o) => o.promotionTier),
        pending.map((o) => o.promotionTierRaw ?? null),
        pending.map((o) => o.fetchedAt),
        pending.map(() => snapshotComplete),
        pending.map((o) => o.observationId ?? null),
      ],
      "write promotion tiers",
    );
    pending = [];
    queuedKeys.clear();
  };
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
    // A SQL upsert cannot affect one identity twice. Flush rather than discarding
    // earlier duplicates, so every accepted observation still hits schema checks.
    if (queuedKeys.has(key)) await flush();
    pending.push(observation);
    queuedKeys.add(key);
    // A later partial observation cannot downgrade an earlier upgrade in this batch.
    stored.set(key, observation.promotionTier);
    written += 1;
    if (pending.length === 250) await flush();
  }
  await flush();
  return { written, skipped };
}
