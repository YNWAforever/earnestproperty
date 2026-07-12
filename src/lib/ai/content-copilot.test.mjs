import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedContentCopilotFields,
  applySelectedContentPatches,
  buildContentFingerprint,
  normalizeCitationUrl,
  validateContentCopilotProposal,
} from "./content-copilot.ts";

test("listing allowlist includes copy and SEO but excludes facts", () => {
  assert.deepEqual(allowedContentCopilotFields("listing"), [
    "title_zh", "title_en", "description", "features", "seo_title", "seo_description",
  ]);
  assert.equal(allowedContentCopilotFields("listing").includes("price"), false);
  assert.equal(allowedContentCopilotFields("listing").includes("status"), false);
});

test("fingerprints are stable across object key order and change with source content", async () => {
  const first = await buildContentFingerprint({ title: "first title", content: "first content" });
  const reordered = await buildContentFingerprint({ content: "first content", title: "first title" });
  const changed = await buildContentFingerprint({ title: "first title", content: "changed content" });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("proposal validation rejects unknown fields and unsupported selectable claims", () => {
  const result = validateContentCopilotProposal({
    resourceType: "listing",
    sourceFingerprint: "1234567890abcdef",
    patches: [{
      field: "price",
      before: null,
      after: "8800000",
      reason: "AI guess",
      confidence: "low",
      evidenceIds: [],
      unsupportedClaims: ["Estimated price"],
    }],
    evidence: [],
    warnings: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "COPILOT_UNKNOWN_FIELD");
});

test("only selected supported patches are applied", () => {
  const result = applySelectedContentPatches(
    { title_zh: "old title", description: "old description" },
    [
      { field: "title_zh", before: "old title", after: "new title", reason: "clearer", confidence: "high", evidenceIds: [], unsupportedClaims: [] },
      { field: "description", before: "old description", after: "new description", reason: "clearer", confidence: "high", evidenceIds: [], unsupportedClaims: ["uncited travel time"] },
    ],
    ["title_zh", "description"],
  );
  assert.deepEqual(result, { title_zh: "new title", description: "old description" });
});

test("citation normalization accepts https only", () => {
  assert.equal(normalizeCitationUrl("https://example.com/a#b"), "https://example.com/a#b");
  assert.equal(normalizeCitationUrl("http://example.com"), null);
  assert.equal(normalizeCitationUrl("javascript:alert(1)"), null);
});
