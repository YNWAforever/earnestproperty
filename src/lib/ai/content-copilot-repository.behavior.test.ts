import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  isContentCopilotAuditUuid,
  isGeneratingProposalConflict,
  sanitizeContentCopilotAuditMetadata,
  sanitizeContentCopilotUsageMetadata,
} from "./content-copilot-repository.server.ts";

test("audit identity accepts every canonical PostgreSQL UUID shape", () => {
  assert.equal(isContentCopilotAuditUuid("018f2c1e-1234-7123-8123-123456789abc"), true);
  assert.equal(isContentCopilotAuditUuid("00000000-0000-0000-0000-000000000000"), true);
  assert.equal(isContentCopilotAuditUuid("not-a-uuid"), false);
});

test("repository safety helpers reject unsafe metadata and map only the named conflict", () => {
  assert.equal(
    isGeneratingProposalConflict({
      code: "23505",
      constraint: "ai_content_proposals_one_generating_per_staff_idx",
    }),
    true,
  );
  assert.equal(
    isGeneratingProposalConflict({ code: "23505", constraint: "other_unique_constraint" }),
    false,
  );
  assert.deepEqual(
    sanitizeContentCopilotAuditMetadata(
      { provider: "opencode_go", model: "go-content", latencyMs: 12, acceptedFields: ["title_zh"] },
      "listing",
    ),
    { provider: "opencode_go", model: "go-content", latencyMs: 12, acceptedFields: ["title_zh"] },
  );
  assert.throws(
    () => sanitizeContentCopilotAuditMetadata({ status: "crm" }),
    /COPILOT_AUDIT_METADATA_INVALID/,
  );
  assert.throws(
    () => sanitizeContentCopilotAuditMetadata({ acceptedFields: ["price"] }, "listing"),
    /COPILOT_AUDIT_METADATA_INVALID/,
  );
  assert.throws(
    () => sanitizeContentCopilotUsageMetadata({ prompt: "private" }),
    /COPILOT_USAGE_METADATA_INVALID/,
  );
});
