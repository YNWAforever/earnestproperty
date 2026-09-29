import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePortalEnquiry } from "./portal-intake.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/portal-enquiries.json", import.meta.url), "utf8"),
);

test("golden 28Hse message parses without a link record, network, or model", () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("NETWORK_FORBIDDEN");
  };
  try {
    const result = parsePortalEnquiry(fixtures.golden28hse);
    assert.equal(result.parserVersion, "portal-intake-v1");
    assert.equal(result.requestedStaffText, "鄧錦雄 Terence Tang");
    assert.equal(result.estateText, "碧堤半島");
    assert.equal(result.messageDealType, "sale");
    assert.equal(result.quotedPriceHkd, 12680000);
    assert.equal(result.references.length, 1);
    assert.deepEqual(result.references[0].sourceEvidence, ["url-derived", "message-declared"]);
    assert.equal(result.references[0].source, "28hse");
    assert.equal(result.references[0].externalListingId, "4033349");
    assert.equal(result.references[0].dealType, "sale");
    assert.equal(
      result.references[0].canonicalUrl,
      "https://www.28hse.com/buy/apartment/property-4033349",
    );
    assert.equal(
      result.references[0].originalUrl,
      "https://www.28hse.com/buy/apartment/property-4033349?t=1790600623",
    );
    assert.equal(
      fixtures.golden28hse.slice(...result.references[0].spans[0]),
      result.references[0].originalUrl,
    );
    assert.equal(networkCalls, 0);
    assert.equal(JSON.stringify(result).includes("internalPropertyId"), false);
    assert.equal(JSON.stringify(result).includes("customerName"), false);
    assert.equal(JSON.stringify(result).includes("click"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sale and rent URL IDs remain strings including leading zeroes", () => {
  const sale = parsePortalEnquiry("https://www.28hse.com/buy/apartment/property-04033349");
  const rent = parsePortalEnquiry("https://www.28hse.com/rent/apartment/property-4999999");
  assert.equal(sale.references[0].externalListingId, "04033349");
  assert.equal(rent.references[0].dealType, "rent");
  assert.equal(rent.references[0].externalListingId, "4999999");
});

test("duplicate URL appearances combine while distinct IDs stay separate", () => {
  const a = "https://www.28hse.com/buy/apartment/property-4033349";
  const b = "https://www.28hse.com/buy/apartment/property-4999999";
  const result = parsePortalEnquiry(`${a}，${a}。${b}`);
  assert.equal(result.references.length, 2);
  assert.equal(result.references[0].spans.length, 2);
  assert.equal(result.references[1].externalListingId, "4999999");
});

test("full width punctuation and absent staff name are safe", () => {
  const result = parsePortalEnquiry(
    "你好！在28Hse見到這個 碧堤半島，租 $18,000 元：https://www.28hse.com/rent/apartment/property-0007",
  );
  assert.equal(result.requestedStaffText, null);
  assert.equal(result.messageDealType, "rent");
  assert.equal(result.references[0].externalListingId, "0007");
});

test("text ID and URL ID conflict requires review without discarding either evidence", () => {
  const result = parsePortalEnquiry(
    "樓盤(ID:4033349) https://www.28hse.com/buy/apartment/property-4999999",
  );
  assert.equal(result.references[0].externalListingId, "4999999");
  assert.ok(result.warnings.includes("text_url_id_conflict"));
  assert.equal(result.requiresReview, true);
});

test("unknown query stays, only exact nonidentity t is removed", () => {
  const result = parsePortalEnquiry(
    "https://www.28hse.com/buy/apartment/property-4033349?unit=A&t=123&source=abc",
  );
  assert.equal(
    result.references[0].canonicalUrl,
    "https://www.28hse.com/buy/apartment/property-4033349?unit=A&source=abc",
  );
});

test("PropertyHK is only recognised host with unverified URL shape", () => {
  const result = parsePortalEnquiry("https://www.property.hk/detail/100?unit=2");
  assert.equal(result.references[0].source, "propertyhk");
  assert.equal(result.references[0].externalListingId, null);
  assert.equal(result.references[0].shape, "unverified");
  assert.ok(result.warnings.includes("propertyhk_shape_unverified"));
});

test("spoofed hosts, userinfo, local URLs and oversized text never become authoritative refs", () => {
  const result = parsePortalEnquiry(
    "https://www.28hse.com.evil.test/buy/apartment/property-3 https://evil.test@www.28hse.com/buy/apartment/property-4 http://127.0.0.1/buy/apartment/property-5",
  );
  assert.equal(result.references.length, 0);
  const huge = parsePortalEnquiry(
    "x".repeat(20000) + " https://www.28hse.com/buy/apartment/property-6",
  );
  assert.equal(huge.references.length, 0);
  assert.ok(huge.warnings.includes("text_too_long"));
});
