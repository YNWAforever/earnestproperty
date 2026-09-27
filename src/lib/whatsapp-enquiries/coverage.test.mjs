import assert from "node:assert/strict";
import test from "node:test";
import { classifyWebsiteCoverage, summarizeWebsiteCoverage } from "./coverage.mjs";

test("six canonical offers count two tracked, three missing and one conflicted", () => {
  const rows = [1, 1, 0, 0, 0, 2].map((candidateCount, index) => ({
    propertyId: String(index + 1),
    publicListingNo: index < 2 ? "A000001" : `A${String(index + 1).padStart(6, "0")}`,
    dealType: index === 1 ? "rent" : "sale",
    candidateCount,
    code: candidateCount === 1 ? `code-${index}` : null,
  }));
  const classified = rows.map(classifyWebsiteCoverage);
  assert.deepEqual(summarizeWebsiteCoverage(classified), {
    eligibleOffers: 6,
    coveredOffers: 2,
    missingOffers: 3,
    conflictedOffers: 1,
  });
  assert.equal(classified[5].status, "conflicted");
  assert.equal(classified[5].code, null);
  assert.equal(classified[0].dealType, "sale");
  assert.equal(classified[1].dealType, "rent");
});
