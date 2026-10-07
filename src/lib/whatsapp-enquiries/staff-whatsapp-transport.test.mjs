import assert from "node:assert/strict";
import test from "node:test";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";

const keys = [
  "EP_WA_STAFF_WHATSAPP_VERIFICATION_REF",
  "EP_WA_STAFF_CORRELATION_VERIFICATION_REF",
  "EP_WA_STAFF_ASSOCIATION_REVIEW_REF",
  "EP_WA_STAFF_REPLY_CONTEXT_PATH",
  "EP_WA_STAFF_NOTIFICATIONS_ENABLED",
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
  template: null,
  beforeSend: async () => {},
};
const template = {
  type: "TEMPLATE",
  elementName: "staff_lead_alert",
  languageCode: "zh_HK",
  components: [
    {
      type: "body",
      parameters: [
        { type: "text", text: "合成客戶" },
        { type: "text", text: "網站查詢" },
        { type: "text", text: "https://earnest.example.invalid/admin/leads" },
      ],
    },
  ],
};

async function withEnv(patch, run) {
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key, index) => {
    process.env[key] = values[index];
  });
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}
const accepting = (calls) =>
  createStaffWhatsAppTransport(async (input) => {
    calls.push(input);
    return { ok: true, body: { ok: 1, messageId: "synthetic-message" } };
  });

test("staff transport distinguishes acceptance, refusal and unknown", () =>
  withEnv({}, async () => {
    const calls = [];
    const accepted = accepting(calls);
    const result = await accepted.sendStaffWhatsApp(scope);
    assert.deepEqual(result, {
      state: "accepted",
      evidenceKind: "provider_accepted",
      providerOperationId: "synthetic-message",
    });
    assert.equal("deliveredAt" in result, false);
    assert.equal(calls[0].memberId, scope.memberId);
    assert.deepEqual(calls[0].response, [{ type: "TEXT", text: scope.message }]);
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
  }));

test("sends a TEMPLATE response when a template is given and never a TEXT", () =>
  withEnv({}, async () => {
    const calls = [];
    const api = accepting(calls);
    const result = await api.sendStaffWhatsApp({ ...scope, template });
    assert.equal(result.state, "accepted");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { memberId: scope.memberId, response: [template] });
    assert.ok(calls[0].response.every((item) => item.type !== "TEXT"));
    assert.doesNotMatch(JSON.stringify(calls[0]), /Protected work item/);
  }));

test("refuses when EP_WA_STAFF_NOTIFICATIONS_ENABLED is not true", async () => {
  for (const value of [undefined, "false", "", "TRUE", "1"])
    await withEnv({ EP_WA_STAFF_NOTIFICATIONS_ENABLED: value }, async () => {
      const calls = [];
      let boundaryCalls = 0;
      const api = accepting(calls);
      for (const candidate of [scope, { ...scope, template }])
        await assert.rejects(
          api.sendStaffWhatsApp({
            ...candidate,
            beforeSend: async () => {
              boundaryCalls++;
            },
          }),
          (error) => error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
        );
      assert.equal(calls.length, 0, `provider called with switch ${value}`);
      assert.equal(boundaryCalls, 0);
    });
});

test("channel mismatch is a preflight block, not a send", () =>
  withEnv({}, async () => {
    const calls = [];
    const api = accepting(calls);
    for (const candidate of [scope, { ...scope, template }])
      await assert.rejects(
        api.sendStaffWhatsApp({ ...candidate, channelId: "other-channel" }),
        (error) => error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
      );
    await assert.rejects(
      api.sendStaffWhatsApp({
        ...scope,
        template,
        beforeSend: async () => {
          throw new Error("endpoint_changed");
        },
      }),
      (error) => error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
    );
    assert.equal(calls.length, 0);
  }));
