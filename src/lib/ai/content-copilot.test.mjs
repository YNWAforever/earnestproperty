import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedContentCopilotFields,
  applySelectedContentPatches,
  buildContentFingerprint,
  contentCopilotRequestSchema,
  normalizeCitationUrl,
  validatePersistedContentCopilotRecord,
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
    sourceFingerprint: "a".repeat(64),
    patches: [{
      field: "price",
      before: null,
      after: "8800000",
      reason: "AI guess",
      confidence: "low",
      evidenceIds: [],
      unsupportedClaims: ["Estimated price"],
      claimType: "factual_web",
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
    { resourceType: "listing", sourceFingerprint: "a".repeat(64), currentFingerprint: "a".repeat(64) },
  );
  assert.deepEqual(result, { ok: true, value: { title_zh: "new title", description: "old description" }, error: null });
});

test("patch application rejects stale, conflicting, and non-allowlisted changes", () => {
  const patch = { field: "title_zh", before: "old title", after: "new title", reason: "clearer", confidence: "high", evidenceIds: [], unsupportedClaims: [] };
  assert.equal(applySelectedContentPatches({}, [patch], ["title_zh"], { resourceType: "listing", sourceFingerprint: "a".repeat(64), currentFingerprint: "b".repeat(64) }).error, "COPILOT_STALE_PROPOSAL");
  assert.equal(applySelectedContentPatches({ title_zh: "changed" }, [patch], ["title_zh"], { resourceType: "listing", sourceFingerprint: "a".repeat(64), currentFingerprint: "a".repeat(64) }).error, "COPILOT_PATCH_CONFLICT");
  assert.equal(applySelectedContentPatches({ price: "1" }, [{ ...patch, field: "price" }], ["price"], { resourceType: "listing", sourceFingerprint: "a".repeat(64), currentFingerprint: "a".repeat(64) }).error, "COPILOT_UNKNOWN_FIELD");
});

test("web evidence requires an https citation and factual web claims require a citation", () => {
  const missingCitation = validateContentCopilotProposal({ resourceType: "article", sourceFingerprint: "a".repeat(64), patches: [{ field: "title", before: "old", after: "new", reason: "fact", confidence: "high", evidenceIds: [], unsupportedClaims: [], claimType: "factual_web" }], evidence: [], warnings: [] });
  assert.equal(missingCitation.ok, false);
  assert.equal(missingCitation.error, "COPILOT_CITATION_REQUIRED");
  const unsafeCitation = validateContentCopilotProposal({ resourceType: "article", sourceFingerprint: "a".repeat(64), patches: [], evidence: [{ id: "web-1", type: "web", title: "Unsafe", url: "http://example.com", excerpt: "x" }], warnings: [] });
  assert.equal(unsafeCitation.ok, false);
  assert.equal(unsafeCitation.error, "COPILOT_PROPOSAL_INVALID");
  assert.equal(contentCopilotRequestSchema.safeParse({ resourceType: "article", resourceId: "11111111-1111-4111-8111-111111111111", action: "improve", selectedFields: ["title"], tone: "professional_property", targetLanguage: "zh-HK" }).data.researchMode, "internal");
});

test("unsaved records receive a stable save-first result", () => {
  assert.equal(validatePersistedContentCopilotRecord({ resourceId: "11111111-1111-4111-8111-111111111111", persisted: false }).error, "COPILOT_SAVE_FIRST");
  assert.equal(validatePersistedContentCopilotRecord({ resourceId: "11111111-1111-4111-8111-111111111111", persisted: true }).ok, true);
});

test("citation normalization accepts https only", () => {
  assert.equal(normalizeCitationUrl("https://example.com/a#b"), "https://example.com/a#b");
  assert.equal(normalizeCitationUrl("http://example.com"), null);
  assert.equal(normalizeCitationUrl("javascript:alert(1)"), null);
});
