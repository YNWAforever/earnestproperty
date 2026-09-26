import assert from "node:assert/strict";
import test from "node:test";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";

const keys = [
  "EP_WA_STAFF_WHATSAPP_VERIFICATION_REF",
  "EP_WA_STAFF_CORRELATION_VERIFICATION_REF",
  "EP_WA_STAFF_ASSOCIATION_REVIEW_REF",
  "EP_WA_STAFF_REPLY_CONTEXT_PATH",
  "EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED",
  "WOZTELL_CHANNEL_ID",
];
const values = [
  "synthetic-verification",
  "synthetic-correlation",
  "synthetic-review",
  "context.replyTo",
  "true",
  "company",
];
const scope = {
  channelId: "company",
  memberId: "synthetic-staff-only",
  message: "Protected work item",
  templateName: null,
  templateLanguage: null,
  beforeSend: async () => {},
};

test("staff transport distinguishes acceptance, refusal, unknown and unsupported template", async () => {
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key, index) => {
    process.env[key] = values[index];
  });
  try {
    const calls = [];
    const accepted = createStaffWhatsAppTransport(async (input) => {
      calls.push(input);
      return { ok: true, body: { ok: 1, messageId: "synthetic-message" } };
    });
    const result = await accepted.sendStaffWhatsApp(scope);
    assert.deepEqual(result, {
      state: "accepted",
      evidenceKind: "provider_accepted",
      providerOperationId: "synthetic-message",
    });
    assert.equal("deliveredAt" in result, false);
    assert.equal(calls[0].memberId, scope.memberId);
    await assert.rejects(
      accepted.sendStaffWhatsApp({ ...scope, templateName: "unverified" }),
      (error) => error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
    );
    assert.equal(calls.length, 1);
    const refused = createStaffWhatsAppTransport(async () => ({
      ok: true,
      body: { ok: 0, err_code: 112, err: "synthetic refusal" },
    }));
    assert.equal((await refused.sendStaffWhatsApp(scope)).state, "failed");
    const ambiguous = createStaffWhatsAppTransport(async () => ({
      ok: true,
      body: { ok: 1, sendResult: { result: [{}] } },
    }));
    assert.equal((await ambiguous.sendStaffWhatsApp(scope)).state, "accepted");
    const timeout = createStaffWhatsAppTransport(async () => {
      throw new Error("synthetic timeout");
    });
    await assert.rejects(timeout.sendStaffWhatsApp(scope), /synthetic timeout/);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
