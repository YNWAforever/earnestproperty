import assert from "node:assert/strict";
import test from "node:test";
import { assessStaffReadiness } from "../neon/whatsapp-readiness-policy.ts";

const base = {
  staffId: "00000000-0000-4000-8000-000000000002",
  displayName: "Synthetic colleague",
  active: true,
  roles: ["agent"],
  mapping: {
    channelId: "company",
    version: 4,
    reviewBasis: "provider_verified",
    reviewEnforced: true,
    reviewEvidenceId: "00000000-0000-4000-8000-000000000004",
    eligible: true,
    verificationRef: "review event",
    verifiedAt: "2026-09-27T00:00:00.000Z",
    retiredAt: null,
    inboxUserId: "inbox-user",
    folderId: "folder",
  },
  inboxEndpoint: null,
  staffEndpoint: null,
  runtime: {
    channelId: "company",
    assignmentEnabled: true,
    notificationsEnabled: false,
    staffWhatsAppEnabled: false,
    inboxProviderVerified: true,
    staffTransportVerified: false,
    templateContractVerified: false,
  },
  checkedAt: "2026-09-27T01:00:00.000Z",
};
test("strict mappings require provider review evidence without changing legacy behavior", () => {
  const reviewed = assessStaffReadiness(base);
  assert.equal(reviewed.assignment.state, "ready");
  assert.equal(reviewed.mappingVersion, 4);
  const forged = assessStaffReadiness({
    ...base,
    mapping: { ...base.mapping, reviewBasis: "legacy_manual", reviewEvidenceId: null },
  });
  assert.equal(forged.assignment.state, "blocked");
  assert.ok(forged.assignment.reasons.some((reason) => reason.code === "mapping_unverified"));
  const legacy = assessStaffReadiness({
    ...base,
    mapping: {
      ...base.mapping,
      version: 1,
      reviewEnforced: false,
      reviewBasis: "legacy_manual",
      reviewEvidenceId: null,
    },
  });
  assert.equal(legacy.assignment.state, "ready");
  assert.equal(legacy.mappingVersion, 1);
});
