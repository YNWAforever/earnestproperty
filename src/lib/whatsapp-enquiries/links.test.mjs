import { linkDto } from "../neon/whatsapp-enquiries.server.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  mintReference,
  extractReferences,
  shouldMintReference,
  companyWhatsappHref,
  chooseEpisode,
} from "./links.ts";
test("AT-15/16 only ordinary GET may mint; HEAD/prefetch never mint", () => {
  assert.equal(shouldMintReference(new Request("https://fixture/w/test")), true);
  for (const request of [
    new Request("https://fixture", { method: "HEAD" }),
    new Request("https://fixture", { headers: { purpose: "prefetch" } }),
    new Request("https://fixture", { headers: { "sec-purpose": "prefetch;prerender" } }),
  ])
    assert.equal(shouldMintReference(request), false);
});
test("AT-19 trusted phone and once-encoded text", () => {
  assert.equal(
    companyWhatsappHref("85212345678", "樓盤 & 20%"),
    "https://wa.me/85212345678?text=" + encodeURIComponent("樓盤 & 20%"),
  );
  assert.throws(() => companyWhatsappHref("https://evil.test", "x"));
});
test("AT-20 random 192-bit references and multiple malformed reference triage", () => {
  const a = mintReference(),
    b = mintReference();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(extractReferences("hello"), { references: [], invalid: false });
  assert.deepEqual(extractReferences("EPWA:" + a + " EPWA:" + a), {
    references: [a],
    invalid: false,
  });
  assert.equal(extractReferences("EPWA:bad").invalid, true);
  assert.equal(extractReferences("EPWA:" + a + " EPWA:" + b).references.length, 2);
});
test("AT-24/25 followup and distinct property episodes; ambiguous messages remain triage", () => {
  assert.deepEqual(chooseEpisode([{ id: "a", propertyId: "p" }], null, false), {
    inquiryId: "a",
    review: false,
  });
  assert.deepEqual(chooseEpisode([{ id: "a", propertyId: "p" }], "q", false), {
    inquiryId: null,
    review: false,
  });
  assert.deepEqual(
    chooseEpisode(
      [
        { id: "a", propertyId: "p" },
        { id: "b", propertyId: "q" },
      ],
      null,
      false,
    ),
    { inquiryId: null, review: true },
  );
  assert.deepEqual(chooseEpisode([{ id: "a", propertyId: "p" }], null, true), {
    inquiryId: null,
    review: true,
  });
});

test("tracking link DTO normalizes database Date values without changing null or string values", () => {
  const timestamp = "2026-09-27T10:00:00.000Z";
  assert.equal(
    linkDto({ placement_verified_at: new Date(timestamp) }).placementVerifiedAt,
    timestamp,
  );
  assert.equal(linkDto({ placement_verified_at: timestamp }).placementVerifiedAt, timestamp);
  assert.equal(linkDto({ placement_verified_at: null }).placementVerifiedAt, null);
});
