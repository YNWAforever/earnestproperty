import assert from "node:assert/strict";
import test from "node:test";
import { assessStaffReadiness } from "../neon/whatsapp-readiness-policy.ts";

const now = "2026-09-27T08:00:00.000Z";
const base = {
  staffId: "00000000-0000-4000-8000-000000000001",
  displayName: "合成同事",
  active: true,
  roles: ["agent"],
  mapping: {
    channelId: "company",
    eligible: true,
    verificationRef: "approved",
    verifiedAt: now,
    retiredAt: null,
    inboxUserId: "inbox-user",
    folderId: "folder",
  },
  inboxEndpoint: {
    channelId: "company",
    version: 2,
    transport: "inbox_private_note",
    destinationReference: "inbox-user",
    enabled: true,
    verifiedAt: now,
    retiredAt: null,
    permissionGranted: true,
    permissionRef: "approved",
    quietHoursApproved: true,
    lastInboundAt: null,
    templateName: null,
    templateLanguage: null,
    templateVerifiedAt: null,
  },
  staffEndpoint: {
    channelId: "company",
    version: 3,
    transport: "staff_whatsapp",
    destinationReference: "85291234567",
    enabled: true,
    verifiedAt: now,
    retiredAt: null,
    permissionGranted: true,
    permissionRef: "approved",
    quietHoursApproved: true,
    lastInboundAt: "2026-09-27T07:00:00.000Z",
    templateName: null,
    templateLanguage: null,
    templateVerifiedAt: null,
  },
  runtime: {
    channelId: "company",
    assignmentEnabled: true,
    notificationsEnabled: true,
    staffWhatsAppEnabled: true,
    inboxProviderVerified: true,
    staffTransportVerified: true,
    templateContractVerified: false,
  },
  checkedAt: now,
};
const reason = (capability) => capability.reasons.map((item) => item.code);
const evaluate = (patch) => assessStaffReadiness({ ...base, ...patch });

test("readiness keeps assignment, private note and staff phone separate", () => {
  const ready = evaluate({});
  assert.equal(ready.assignment.state, "ready");
  assert.equal(ready.inboxPrivateNote.state, "ready");
  assert.equal(ready.staffWhatsapp.state, "ready");
  assert.equal(ready.maskedDestination, "••••4567");
  assert.equal(ready.mappingVersion, null);
  assert.equal(ready.endpointVersion, 3);
  const noPhone = evaluate({ staffEndpoint: null });
  assert.equal(noPhone.assignment.state, "ready");
  assert.equal(noPhone.inboxPrivateNote.state, "ready");
  assert.deepEqual(reason(noPhone.staffWhatsapp), ["endpoint_missing"]);
  const noMapping = evaluate({ mapping: null });
  assert.deepEqual(reason(noMapping.assignment), ["mapping_missing"]);
  assert.equal(noMapping.staffWhatsapp.state, "blocked");
});

test("readiness blocks revoked, wrong-channel and unverified evidence", () => {
  assert.ok(reason(evaluate({ active: false }).assignment).includes("staff_inactive"));
  assert.ok(reason(evaluate({ roles: ["viewer"] }).assignment).includes("role_ineligible"));
  assert.ok(
    reason(evaluate({ mapping: { ...base.mapping, retiredAt: now } }).assignment).includes(
      "mapping_retired",
    ),
  );
  assert.ok(
    reason(evaluate({ mapping: { ...base.mapping, channelId: "other" } }).assignment).includes(
      "channel_mismatch",
    ),
  );
  assert.ok(
    reason(evaluate({ mapping: { ...base.mapping, verifiedAt: null } }).assignment).includes(
      "mapping_unverified",
    ),
  );
  assert.ok(
    reason(
      evaluate({ inboxEndpoint: { ...base.inboxEndpoint, destinationReference: "wrong" } })
        .inboxPrivateNote,
    ).includes("endpoint_unverified"),
  );
  assert.ok(
    reason(
      evaluate({ staffEndpoint: { ...base.staffEndpoint, permissionGranted: false } })
        .staffWhatsapp,
    ).includes("permission_missing"),
  );
  assert.ok(
    reason(
      evaluate({ runtime: { ...base.runtime, notificationsEnabled: false } }).staffWhatsapp,
    ).includes("runtime_disabled"),
  );
});

test("session text remains ready even when template is unverified; expired window blocks", () => {
  const configured = evaluate({
    staffEndpoint: {
      ...base.staffEndpoint,
      templateName: "approved_name",
      templateLanguage: "zh_HK",
    },
  });
  assert.equal(configured.staffWhatsapp.state, "ready");
  const expired = evaluate({
    staffEndpoint: {
      ...base.staffEndpoint,
      lastInboundAt: "2026-09-25T07:00:00.000Z",
      templateName: "approved_name",
      templateLanguage: "zh_HK",
      templateVerifiedAt: now,
    },
  });
  assert.ok(reason(expired.staffWhatsapp).includes("outside_message_window"));
  assert.ok(reason(expired.staffWhatsapp).includes("template_unverified"));
});
