export type PromotionTier = "gold" | "pinned" | "normal" | "unknown";

export declare const PROMOTION_TIERS: {
  readonly GOLD: "gold";
  readonly PINNED: "pinned";
  readonly NORMAL: "normal";
  readonly UNKNOWN: "unknown";
};

export declare const PROMOTION_TIER_VALUES: readonly PromotionTier[];

export declare function promotionTierRank(tier: string | null | undefined): number;
export declare function isPaidPromotionTier(tier: string | null | undefined): boolean;
export declare function isPromotionTier(value: unknown): value is PromotionTier;
export declare function normalize28HsePromotionTier(
  rawLabel: unknown,
  options?: { badgeObserved?: boolean },
): { tier: PromotionTier; raw: string | null };
export declare function strongestPromotionTier(
  tiers: Array<string | null | undefined>,
): PromotionTier;
export declare function shouldReplaceStoredPromotionTier(input: {
  incomingTier: string | null | undefined;
  storedTier: string | null | undefined;
  snapshotComplete: boolean;
}): boolean;
