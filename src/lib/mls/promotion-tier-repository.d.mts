import type { PromotionTier } from "./promotion-tier.d.mts";

export declare function savePromotionTiers(
  query: (
    text: string,
    params: unknown[],
    label?: string,
  ) => Promise<Array<Record<string, unknown>>>,
  observations: Array<{
    source: string;
    externalId: string;
    dealType: "sale" | "rent";
    promotionTier?: PromotionTier;
    promotionTierRaw?: string | null;
    fetchedAt: string;
    observationId?: string | null;
  }>,
  options: { snapshotComplete: boolean },
): Promise<{ written: number; skipped: number }>;
