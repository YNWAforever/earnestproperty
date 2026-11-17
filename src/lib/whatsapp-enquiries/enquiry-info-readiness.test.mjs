import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveEnquiryInfoReadiness,
  ENQUIRY_INFO_SCHEMA_VERSION,
} from "./enquiry-info-readiness.js";

function fixture() {
  const report = {
    ready: false,
    reasonCodes: ["CAPABILITY_REFERENCES_MISSING", "RECIPIENT_MEMBERSHIP_UNVERIFIED"],
    capabilities: {
      whatsappVerification: false,
      correlationVerification: false,
      associationReview: false,
      replyContext: false,
    },
    members: { checked: false, complete: false, matched: [], provesWhatsappRegistration: false },
    flags: {
      woztellEnabled: true,
      staffNotificationsEnabled: true,
      enquiryMode: "observe",
      botAccessTokenPresent: true,
      openApiTokenPresent: true,
      channelSecretPresent: true,
      serviceAutomationEnabled: false,
    },
    channel: {
      appId: "owned-app",
      configuredChannelId: "owned-channel",
      connected: true,
      archived: false,
      senderPhone: "85224962283",
      companyPhoneMatches: true,
      senderDifferentFromFixedCopy: true,
      proofHash: "a".repeat(64),
    },
    template: {
      configured: {
        name: "owned_enquiry_info",
        language: "zh_HK",
        params: ["name", "source", "phone", "link"],
      },
      configuredApproved: true,
      selectionRequired: false,
      validationComplete: true,
      candidates: [
        {
          providerTemplateId: "owned-template-id",
          name: "owned_enquiry_info",
          language: "zh_HK",
          paramCount: 4,
          proofHash: "b".repeat(64),
        },
      ],
    },
  };
  const installation = {
    purpose: "enq_forward_info",
    version: 1,
    appId: "owned-app",
    channelId: "owned-channel",
    schemaVersion: ENQUIRY_INFO_SCHEMA_VERSION,
    schemaAvailable: true,
    receiptAdmissionVersion: 1,
    neutralHoldVersion: 1,
    templateTransportVersion: 1,
    runtimeBuildSha: "c".repeat(40),
    verifiedBuildSha: "c".repeat(40),
    releaseAuditId: "11111111-2222-4333-8444-555555555555",
  };
  return { report, installation };
}

test("informational readiness uses genuine scoped facts independently of legacy action references or member existence", () => {
  const { report, installation } = fixture();
  const result = deriveEnquiryInfoReadiness(report, installation);
  assert.equal(result.ready, true);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(report.ready, false);
  assert.ok(Object.values(report.capabilities).every((value) => value === false));
  assert.equal(result.provesWhatsappRegistration, false);
  assert.equal(result.provesDelivery, false);
  assert.equal(result.templateProofHash, "b".repeat(64));
});

test("informational readiness keeps every channel, credential and sender fence including unknown archive state", () => {
  for (const mutate of [
    (r) => {
      r.flags.woztellEnabled = false;
    },
    (r) => {
      r.flags.staffNotificationsEnabled = false;
    },
    (r) => {
      r.flags.enquiryMode = "off";
    },
    (r) => {
      r.flags.enquiryMode = "invalid";
    },
    (r) => {
      r.flags.botAccessTokenPresent = false;
    },
    (r) => {
      r.flags.openApiTokenPresent = false;
    },
    (r) => {
      r.flags.channelSecretPresent = false;
    },
    (r) => {
      r.channel.appId = null;
    },
    (r) => {
      r.channel.configuredChannelId = null;
    },
    (r) => {
      r.channel.connected = null;
    },
    (r) => {
      r.channel.archived = null;
    },
    (r) => {
      r.channel.archived = true;
    },
    (r) => {
      r.channel.senderPhone = null;
    },
    (r) => {
      r.channel.senderPhone = "85297987774";
    },
    (r) => {
      r.channel.companyPhoneMatches = null;
    },
    (r) => {
      r.channel.senderDifferentFromFixedCopy = false;
    },
    (r) => {
      r.channel.proofHash = null;
    },
  ]) {
    const { report, installation } = fixture();
    mutate(report);
    assert.equal(deriveEnquiryInfoReadiness(report, installation).ready, false);
  }
});

test("a declared live-delivery proof substitutes only for the provider's missing archive field", () => {
  const { report, installation } = fixture();
  report.channel.archived = null;
  assert.equal(deriveEnquiryInfoReadiness(report, installation).ready, false);
  report.channel.archiveProof = {
    mode: "live_delivery",
    reference: "audit:00000000-0000-4000-8000-000000000002",
  };
  assert.equal(deriveEnquiryInfoReadiness(report, installation).ready, true);
  report.channel.archived = true;
  assert.equal(deriveEnquiryInfoReadiness(report, installation).ready, false);
  report.channel.archived = null;
  report.channel.archiveProof = { mode: "something_else", reference: "audit:unknown" };
  assert.equal(deriveEnquiryInfoReadiness(report, installation).ready, false);
});

test("an approved flag alone cannot replace complete unambiguous template and semantic mapping evidence", () => {
  for (const mutate of [
    (t) => {
      t.selectionRequired = true;
    },
    (t) => {
      t.configuredApproved = false;
    },
    (t) => {
      t.validationComplete = false;
    },
    (t) => {
      t.configured.params = ["name", "name", "phone", "link"];
    },
    (t) => {
      t.configured.language = "private language";
    },
    (t) => {
      t.candidates = [];
    },
    (t) => {
      t.candidates[0].proofHash = "unverified";
    },
    (t) => {
      t.candidates[0].name = "another_template";
    },
    (t) => {
      t.candidates.push({ ...t.candidates[0], proofHash: "d".repeat(64) });
    },
  ]) {
    const { report, installation } = fixture();
    mutate(report.template);
    const result = deriveEnquiryInfoReadiness(report, installation);
    assert.equal(result.ready, false);
    assert.ok(result.reasonCodes.includes("INFO_APPROVED_TEMPLATE_UNVERIFIED"));
  }
});

test("software installation must match schema, privacy components, actual build and provider scope", () => {
  for (const patch of [
    { purpose: "legacy_staff" },
    { version: 0 },
    { schemaVersion: "older_schema" },
    { schemaAvailable: false },
    { receiptAdmissionVersion: 0 },
    { neutralHoldVersion: 0 },
    { templateTransportVersion: 0 },
    { appId: "other-app" },
    { channelId: "other-channel" },
    { verifiedBuildSha: "d".repeat(40) },
    { runtimeBuildSha: "not-a-build" },
    { releaseAuditId: "not-a-protected-release-proof" },
  ]) {
    const { report, installation } = fixture();
    assert.equal(deriveEnquiryInfoReadiness(report, { ...installation, ...patch }).ready, false);
  }
  assert.equal(deriveEnquiryInfoReadiness(fixture().report, null).ready, false);
  assert.equal(deriveEnquiryInfoReadiness(null, null).ready, false);
});

test("sensitive proof rejection invalidates informational readiness as well as the legacy result", () => {
  const { report, installation } = fixture();
  const result = deriveEnquiryInfoReadiness(report, installation, true);
  assert.equal(result.ready, false);
  assert.ok(result.reasonCodes.includes("SENSITIVE_PROVIDER_CONTENT_REDACTED"));
});
