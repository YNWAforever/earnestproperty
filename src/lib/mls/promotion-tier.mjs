/**
 * 28Hse promotion tiers, as the client asked for them on 網頁07092026.docx p5:
 * 「可否將黃金嘅盤排先，跟住順序落置頂盤，最後係普通盤」 -- gold first, then
 * pinned, then ordinary.
 *
 * These are 28Hse's own paid placement grades, NOT anything about the estate,
 * the price, the title wording or a listing's position in an arbitrary
 * response. The source renders the grade as a badge on the agent index card:
 *
 *   <div class="item property_item">
 *     <div class="image myimage desktop_myimage">
 *       <a class="detail_page" href="…/property-3998335">
 *         …
 *         <div class="ui top left attached small label grade_label">黃金</div>
 *       </a>
 *     </div>
 *     …
 *
 * Observed live on www.28hse.com/agent/540 while implementing this: the sale
 * index carried 黃金 badges, the rent index carried both 黃金 and 置頂, and
 * cards with no badge at all are the ordinary tier. A card on that same page
 * carried 「黃金地段」 in its *title* with no badge -- which is exactly why the
 * tier is read from `.grade_label` and never inferred from text.
 */

/** The normalized tiers. `unknown` means "not observed", never "ordinary". */
export const PROMOTION_TIERS = Object.freeze({
  GOLD: "gold",
  PINNED: "pinned",
  NORMAL: "normal",
  UNKNOWN: "unknown",
});

export const PROMOTION_TIER_VALUES = Object.freeze([
  PROMOTION_TIERS.GOLD,
  PROMOTION_TIERS.PINNED,
  PROMOTION_TIERS.NORMAL,
  PROMOTION_TIERS.UNKNOWN,
]);

/**
 * The client's requested display order. `unknown` sorts last: an unclassified
 * listing may occupy an unpromoted fallback position, but it must never be
 * presented as a paid tier.
 */
const RANK = Object.freeze({
  [PROMOTION_TIERS.GOLD]: 0,
  [PROMOTION_TIERS.PINNED]: 1,
  [PROMOTION_TIERS.NORMAL]: 2,
  [PROMOTION_TIERS.UNKNOWN]: 3,
});

/** Rank used for ordering. Lower sorts first. Mirrors the SQL CASE exactly. */
export function promotionTierRank(tier) {
  return RANK[tier] ?? RANK[PROMOTION_TIERS.UNKNOWN];
}

/** Only the two paid grades may ever be badged publicly. */
export function isPaidPromotionTier(tier) {
  return tier === PROMOTION_TIERS.GOLD || tier === PROMOTION_TIERS.PINNED;
}

export function isPromotionTier(value) {
  return PROMOTION_TIER_VALUES.includes(value);
}

/**
 * The exact grade labels 28Hse renders. Deliberately an exact-match table
 * rather than a substring or regex test: 黃金海岸 / 黃金海灣 / 黃金地段 all
 * contain 黃金, and none of them is a promotion grade.
 */
const LABELS = new Map([
  ["黃金", PROMOTION_TIERS.GOLD],
  ["置頂", PROMOTION_TIERS.PINNED],
]);

function clean(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Normalizes one observed `.grade_label` value.
 *
 * @param {unknown} rawLabel the badge's text, or null/undefined/"" when the
 *   card carried no badge at all.
 * @param {{ badgeObserved?: boolean }} [options] `badgeObserved` says whether
 *   the *page* was parsed well enough that the absence of a badge is itself
 *   evidence. Pass `true` only from a successfully parsed agent index, where a
 *   card with no badge really is an ordinary listing. Everywhere else, absence
 *   means we simply did not look, which is `unknown`, not `normal`.
 * @returns {{ tier: string, raw: string | null }}
 */
export function normalize28HsePromotionTier(rawLabel, { badgeObserved = false } = {}) {
  const raw = clean(rawLabel);
  if (!raw) {
    return {
      tier: badgeObserved ? PROMOTION_TIERS.NORMAL : PROMOTION_TIERS.UNKNOWN,
      raw: null,
    };
  }
  const tier = LABELS.get(raw);
  // A grade we have never seen must not be guessed into gold, pinned or
  // ordinary. It stays unknown, with the observed text preserved so a human
  // can extend the table from real evidence rather than from a guess.
  return { tier: tier ?? PROMOTION_TIERS.UNKNOWN, raw };
}

/**
 * Picks the tier to keep when one canonical listing has several verified
 * source observations (e.g. the same external id seen on two index pages).
 * Deterministic: the strongest observed paid grade wins, and `unknown` only
 * wins when nothing else was observed. Never combines unmatched records and
 * never changes which source or agent is chosen for the listing itself.
 */
export function strongestPromotionTier(tiers) {
  let best = PROMOTION_TIERS.UNKNOWN;
  for (const tier of tiers) {
    if (!isPromotionTier(tier)) continue;
    if (promotionTierRank(tier) < promotionTierRank(best)) best = tier;
  }
  return best;
}

/**
 * Whether an incoming observation is allowed to overwrite the tier already
 * stored for a source listing.
 *
 * A complete, trustworthy snapshot may demote (a listing whose gold placement
 * expired must be able to fall back). An incomplete snapshot -- a partial
 * crawl, an aborted pagination run, a challenge-blocked page -- carries no
 * evidence about placement, so it must leave valid tier state alone rather
 * than silently flattening every listing to ordinary.
 */
export function shouldReplaceStoredPromotionTier({ incomingTier, storedTier, snapshotComplete }) {
  if (!isPromotionTier(incomingTier)) return false;
  // Never observed on this pass: keep whatever is stored.
  if (incomingTier === PROMOTION_TIERS.UNKNOWN) return false;
  // A real observation on a complete snapshot is authoritative in both
  // directions -- promotion and demotion.
  if (snapshotComplete) return true;
  // On an incomplete snapshot, accept an upgrade (we positively saw the badge)
  // but never a demotion, which would be inferred from missing evidence.
  if (!isPromotionTier(storedTier) || storedTier === PROMOTION_TIERS.UNKNOWN) return true;
  return promotionTierRank(incomingTier) < promotionTierRank(storedTier);
}
