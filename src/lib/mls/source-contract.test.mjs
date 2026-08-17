import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  createObservation,
  normalizePropertyNo,
} from "./source-contract.mjs";

test("property identity normalizes conservatively", () => {
  assert.equal(normalizePropertyNo(" c 003097 "), "C003097");
  assert.equal(normalizePropertyNo("Ａ- 12"), "A-12");
  assert.equal(normalizePropertyNo(""), null);
  assert.equal(normalizePropertyNo("C/12"), null);
  assert.equal(buildMatchKey(" c003097 ", "sale"), "sale:C003097");
  assert.equal(buildMatchKey(null, "rent"), null);
});

test("observation hash is stable and carries exact match identity", () => {
  const input = {
    source: SOURCE_28HSE,
    externalId: "3972991",
    dealType: "sale",
    sourceUrl: "https://www.28hse.com/buy/apartment/property-3972991",
    propertyNoRaw: "C003097",
    fields: { title_zh: "西半山單位", price: 12_000_000 },
    rawFields: { priceText: "售 $1,200萬" },
    mediaCandidates: [],
    discoveredAt: "2026-08-17T01:59:00.000Z",
    fetchedAt: "2026-08-17T02:00:00.000Z",
  };
  const first = createObservation(input);
  const second = createObservation({
    ...input,
    fields: { price: 12_000_000, title_zh: "西半山單位" },
  });
  assert.equal(first.matchKey, "sale:C003097");
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.source, SOURCE_28HSE);
  assert.equal(SOURCE_OLD_SITE, "old_site");
});
