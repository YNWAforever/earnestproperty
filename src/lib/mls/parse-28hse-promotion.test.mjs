import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { build28HseAgentUrl, parse28HseAgentIndex, parse28HseDetail } from "./parse-28hse.mjs";
import { PROMOTION_TIERS } from "./promotion-tier.mjs";

const fixture = (name) =>
  readFileSync(new URL(`./__fixtures__/28hse/${name}`, import.meta.url), "utf8");

const rentIndex = () =>
  parse28HseAgentIndex(fixture("agent-rent-promotion-grades.html"), {
    dealType: "rent",
    pageUrl: build28HseAgentUrl("rent", 1),
  });

const byId = (parsed) => new Map(parsed.links.map((link) => [link.externalId, link]));

test("the 28Hse grade badge is read per listing, from .grade_label", () => {
  const links = byId(rentIndex());
  assert.equal(links.get("3998335").promotionTier, PROMOTION_TIERS.GOLD);
  assert.equal(links.get("3998335").promotionTierRaw, "黃金");
  assert.equal(links.get("4005841").promotionTier, PROMOTION_TIERS.PINNED);
  assert.equal(links.get("4005841").promotionTierRaw, "置頂");
});

test("a listing with no badge on a successfully parsed index is ordinary, not unknown", () => {
  const link = byId(rentIndex()).get("4005842");
  assert.equal(link.promotionTier, PROMOTION_TIERS.NORMAL);
  assert.equal(link.promotionTierRaw, null);
});

test("黃金 in a listing title is never read as a gold placement", () => {
  const link = byId(rentIndex()).get("4005842");
  // This is the real listing from the live index: its title says 黃金地段 and
  // it carries no grade badge.
  assert.match(link.summaryTitle, /黃金地段/);
  assert.equal(link.promotionTier, PROMOTION_TIERS.NORMAL);
});

test("a listing's two anchors are merged, so the title anchor cannot erase the badge", () => {
  // Each card has an image anchor (badged) and a title anchor (unbadged), and
  // the title anchor wins the summaryTitle contest because it is longer.
  const link = byId(rentIndex()).get("3998335");
  assert.match(link.summaryTitle, /3房套/, "the longer title anchor still supplies the title");
  assert.equal(link.promotionTier, PROMOTION_TIERS.GOLD, "and the badge survives that merge");
});

test("the grade never enters the observation, whose key set is contract-bound", () => {
  // sync-repository.mjs enforces an exact key set on every observation
  // (OBSERVATION_KEYS). The grade is a property of the listing's placement on
  // the agent index, not of the detail page an observation describes, so it
  // travels beside the observations on the adapter result instead of widening
  // that contract -- and every existing observation content hash is unchanged.
  const observation = parse28HseDetail(fixture("detail-rent-3976155.html"), {
    dealType: "rent",
    sourceUrl: "https://www.28hse.com/rent/apartment/property-3976155",
    summaryTitle: "測試放盤",
    discoveredAt: "2026-09-09T00:00:00.000Z",
    fetchedAt: "2026-09-09T00:00:00.000Z",
  });
  assert.ok(!Object.hasOwn(observation, "promotionTier"));
  assert.ok(!Object.hasOwn(observation, "promotionTierRaw"));
});

test("a grade is never inferred from an observation's own fields", () => {
  // The only source of a grade is the index badge. Nothing in the detail
  // parser may produce one, however the listing is titled or priced.
  const observation = parse28HseDetail(fixture("detail-rent-3976155.html"), {
    dealType: "rent",
    sourceUrl: "https://www.28hse.com/rent/apartment/property-3976155",
    summaryTitle: "黃金地段筍盤",
    discoveredAt: "2026-09-09T00:00:00.000Z",
    fetchedAt: "2026-09-09T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(observation).includes('"gold"'), false);
});

test("existing 28Hse fixtures with no grade markup still parse, with no invented tier", () => {
  const parsed = parse28HseAgentIndex(fixture("agent-sale-page-1.html"), {
    dealType: "sale",
    pageUrl: build28HseAgentUrl("sale", 1),
  });
  assert.ok(parsed.links.length > 0);
  for (const link of parsed.links) {
    // The page parsed as a real agent index, so a missing badge is ordinary --
    // and in particular is never gold or pinned.
    assert.equal(link.promotionTier, PROMOTION_TIERS.NORMAL);
    assert.equal(link.promotionTierRaw, null);
  }
});

test("the parsed index is the only place a grade can come from", () => {
  // Guards the direction of the data flow: the index parser produces grades,
  // and nothing downstream may invent one. If this ever needs to change, the
  // change should be visible here rather than in a silent inference.
  const parsed = rentIndex();
  assert.deepEqual(
    parsed.links.map((link) => [link.externalId, link.promotionTier]).sort(),
    [
      ["3998335", "gold"],
      ["4005841", "pinned"],
      ["4005842", "normal"],
    ].sort(),
  );
});
