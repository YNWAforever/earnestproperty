import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROMOTION_TIERS,
  isPaidPromotionTier,
  isPromotionTier,
  normalize28HsePromotionTier,
  promotionTierRank,
  shouldReplaceStoredPromotionTier,
  strongestPromotionTier,
} from "./promotion-tier.mjs";

test("the client's requested order is 黃金 > 置頂 > 普通, with unobserved last", () => {
  const ordered = [
    PROMOTION_TIERS.GOLD,
    PROMOTION_TIERS.PINNED,
    PROMOTION_TIERS.NORMAL,
    PROMOTION_TIERS.UNKNOWN,
  ];
  const ranks = ordered.map(promotionTierRank);
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  );
  assert.equal(new Set(ranks).size, ranks.length, "every tier must rank distinctly");
});

test("28Hse's two real grade labels normalize; everything else does not", () => {
  assert.deepEqual(normalize28HsePromotionTier("黃金", { badgeObserved: true }), {
    tier: "gold",
    raw: "黃金",
  });
  assert.deepEqual(normalize28HsePromotionTier("置頂", { badgeObserved: true }), {
    tier: "pinned",
    raw: "置頂",
  });
  // Whitespace and full/half-width variants are the same badge.
  assert.equal(normalize28HsePromotionTier(" 黃金 ", { badgeObserved: true }).tier, "gold");
});

test("a grade we have never seen stays unknown, never guessed into a tier", () => {
  const result = normalize28HsePromotionTier("鑽石", { badgeObserved: true });
  assert.equal(result.tier, PROMOTION_TIERS.UNKNOWN);
  assert.equal(result.raw, "鑽石", "the observed text is preserved for human review");
  assert.equal(isPaidPromotionTier(result.tier), false);
});

test("an estate or title containing 黃金 is never a gold grade", () => {
  // Real trap cases observed on the live 28Hse agent index: an estate named
  // 黃金海岸 / 黃金海灣, and a listing titled 「…黃金地段！連2車位！」 that
  // carried no badge at all.
  for (const text of ["黃金海岸", "黃金海灣", "香港黃金海岸", "黃金地段", "黃金海灣．珀岸"]) {
    assert.equal(
      normalize28HsePromotionTier(text, { badgeObserved: true }).tier,
      PROMOTION_TIERS.UNKNOWN,
      `${text} must not normalize to a promotion grade`,
    );
  }
});

test("no badge on a page we actually parsed is ordinary; no badge elsewhere is unknown", () => {
  assert.equal(
    normalize28HsePromotionTier("", { badgeObserved: true }).tier,
    PROMOTION_TIERS.NORMAL,
  );
  assert.equal(normalize28HsePromotionTier(null).tier, PROMOTION_TIERS.UNKNOWN);
  assert.equal(normalize28HsePromotionTier(undefined).tier, PROMOTION_TIERS.UNKNOWN);
});

test("only the two paid grades may be badged publicly", () => {
  assert.equal(isPaidPromotionTier(PROMOTION_TIERS.GOLD), true);
  assert.equal(isPaidPromotionTier(PROMOTION_TIERS.PINNED), true);
  assert.equal(isPaidPromotionTier(PROMOTION_TIERS.NORMAL), false);
  assert.equal(isPaidPromotionTier(PROMOTION_TIERS.UNKNOWN), false);
  assert.equal(isPromotionTier("platinum"), false);
});

test("several verified observations of one listing resolve deterministically", () => {
  assert.equal(strongestPromotionTier(["normal", "gold", "pinned"]), "gold");
  assert.equal(strongestPromotionTier(["pinned", "normal"]), "pinned");
  assert.equal(strongestPromotionTier(["unknown", "normal"]), "normal");
  assert.equal(strongestPromotionTier([]), PROMOTION_TIERS.UNKNOWN);
  assert.equal(strongestPromotionTier(["nonsense"]), PROMOTION_TIERS.UNKNOWN);
  // Order of observation must not change the answer.
  assert.equal(
    strongestPromotionTier(["gold", "normal"]),
    strongestPromotionTier(["normal", "gold"]),
  );
});

test("a complete snapshot may demote; an incomplete one may not", () => {
  // A gold placement that genuinely expired, seen on a full crawl.
  assert.equal(
    shouldReplaceStoredPromotionTier({
      incomingTier: "normal",
      storedTier: "gold",
      snapshotComplete: true,
    }),
    true,
  );
  // The same observation from a partial crawl is not evidence of a demotion.
  assert.equal(
    shouldReplaceStoredPromotionTier({
      incomingTier: "normal",
      storedTier: "gold",
      snapshotComplete: false,
    }),
    false,
  );
  // A positively observed upgrade is trustworthy either way.
  assert.equal(
    shouldReplaceStoredPromotionTier({
      incomingTier: "gold",
      storedTier: "normal",
      snapshotComplete: false,
    }),
    true,
  );
});

test("an unobserved tier never overwrites stored state", () => {
  for (const snapshotComplete of [true, false]) {
    assert.equal(
      shouldReplaceStoredPromotionTier({
        incomingTier: PROMOTION_TIERS.UNKNOWN,
        storedTier: "gold",
        snapshotComplete,
      }),
      false,
      "an incomplete extraction must not erase a valid tier",
    );
    assert.equal(
      shouldReplaceStoredPromotionTier({
        incomingTier: "not-a-tier",
        storedTier: "gold",
        snapshotComplete,
      }),
      false,
    );
  }
});

test("a first observation is stored even when the snapshot is incomplete", () => {
  assert.equal(
    shouldReplaceStoredPromotionTier({
      incomingTier: "normal",
      storedTier: PROMOTION_TIERS.UNKNOWN,
      snapshotComplete: false,
    }),
    true,
  );
});
