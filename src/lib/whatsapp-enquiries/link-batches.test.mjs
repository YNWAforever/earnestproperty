import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { batchPayloadHash, canonicalBatchRows } from "./link-batch-policy.ts";

const propertyId = randomUUID();
const staffId = randomUUID();
const base = (patch = {}) => ({
  rowKey: randomUUID(),
  placementId: "website:listing-card",
  input: {
    placementSource: "website",
    entryPointType: "sales",
    publicListingNo: " a074714 ",
    propertyId,
    dealType: "sale",
    requestedStaffId: staffId,
    placementVerified: true,
    enabled: true,
    ...patch,
  },
});
test("canonical placement separates sources and placements without using internal property ID as identity", () => {
  const first = canonicalBatchRows([base()], "company", 1000)[0];
  const same = canonicalBatchRows([base({ propertyId: randomUUID() })], "company", 1000)[0];
  assert.equal(first.input.publicListingNo, "A074714");
  assert.equal(first.placementKey, same.placementKey);
  assert.notEqual(first.rowHash, same.rowHash);
  assert.notEqual(
    first.placementKey,
    canonicalBatchRows([{ ...base(), placementId: "website:detail-cta" }], "company", 1000)[0]
      .placementKey,
  );
  assert.notEqual(
    first.placementKey,
    canonicalBatchRows(
      [
        {
          ...base(),
          placementId: "28hse-ad-123",
          input: { ...base().input, placementSource: "28hse", externalListingId: "28hse-ad-123" },
        },
      ],
      "company",
      1000,
    )[0].placementKey,
  );
  assert.notEqual(
    first.placementKey,
    canonicalBatchRows([base({ dealType: "rent" })], "company", 1000)[0].placementKey,
  );
  assert.notEqual(
    first.placementKey,
    canonicalBatchRows([base({ requestedStaffId: randomUUID() })], "company", 1000)[0].placementKey,
  );
});
test("row identity is stable across chunk order but duplicate keys and oversize drafts fail", () => {
  const rows = canonicalBatchRows(
    [base(), { ...base(), placementId: "website:detail" }],
    "company",
    1000,
  );
  assert.equal(batchPayloadHash(rows), batchPayloadHash([...rows].reverse()));
  assert.throws(
    () =>
      canonicalBatchRows(
        [
          { rowKey: rows[0].rowKey, placementId: rows[0].placementId, input: rows[0].input },
          { rowKey: rows[0].rowKey, placementId: rows[0].placementId, input: rows[0].input },
        ],
        "company",
        1000,
      ),
    /WA_LINK_DUPLICATE_ROW_KEY/,
  );
  assert.throws(
    () =>
      canonicalBatchRows(
        Array.from({ length: 51 }, (_, i) => ({ ...base(), placementId: `website:${i}` })),
        "company",
        50,
      ),
    /WA_LINK_BATCH_LIMIT/,
  );
  assert.throws(
    () => canonicalBatchRows([base({ publicListingNo: null })], "company", 1000),
    /WA_LINK_OFFER_CONTEXT_REQUIRED/,
  );
});
