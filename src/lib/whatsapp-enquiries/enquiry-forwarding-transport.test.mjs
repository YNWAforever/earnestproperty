import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { sendWoztellResponse } from "../woztell/woztell.server.ts";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";
const config = {
  WOZTELL_ENABLED: "true",
  WOZTELL_BOT_ACCESS_TOKEN: "owned-transport-token",
  WOZTELL_CHANNEL_ID: "owned-transport-channel",
  EP_WA_COMPANY_CHANNEL_ID: "owned-transport-channel",
  EP_WA_ENQUIRY_MODE: "observe",
  EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
  EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: "owned-provider-capability",
  EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "owned-correlation-proof",
  EP_WA_STAFF_ASSOCIATION_REVIEW_REF: "owned-association-proof",
  EP_WA_STAFF_REPLY_CONTEXT_PATH: "context.replyTo",
};
const template = {
  type: "TEMPLATE",
  elementName: "owned_staff_enquiry",
  languageCode: "zh_HK",
  components: [],
};
async function withProvider(
  run,
  { body = { ok: 1, messageId: "owned-operation-id" }, status = 200 } = {},
) {
  const saved = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  Object.assign(process.env, config);
  const calls = [];
  const intercepted = mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://bot.api.woztell.com/sendResponses");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer owned-transport-token");
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    await run(calls);
  } finally {
    intercepted.mock.restore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("documented phone delivery uses recipientId and the fixed WOZTELL endpoint with bearer authorization", async () => {
  await withProvider(async (calls) => {
    const result = await sendWoztellResponse({
      recipientId: "85297987774",
      channelId: config.WOZTELL_CHANNEL_ID,
      response: [template],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0].body, {
      channelId: config.WOZTELL_CHANNEL_ID,
      recipientId: "85297987774",
      response: [template],
    });
    assert.equal(Object.hasOwn(calls[0].body, "memberId"), false);
  });
});
test("an opaque member destination retains memberId without being converted to a phone", async () => {
  await withProvider(async (calls) => {
    await sendWoztellResponse({
      memberId: "opaque-woztell-member-owned-A",
      channelId: config.WOZTELL_CHANNEL_ID,
      response: [template],
    });
    assert.equal(calls[0].body.memberId, "opaque-woztell-member-owned-A");
    assert.equal(Object.hasOwn(calls[0].body, "recipientId"), false);
  });
});
test("ambiguous, empty and cross-channel destinations are refused before any provider request", async () => {
  await withProvider(async (calls) => {
    for (const input of [
      {},
      { memberId: "", recipientId: "" },
      { memberId: "opaque-member", recipientId: "85297987774" },
      { recipientId: "85297987774", channelId: "other-channel" },
    ]) {
      const result = await sendWoztellResponse({ response: [template], ...input });
      assert.equal(result.refused, true);
    }
    assert.equal(calls.length, 0);
  });
});
test("phone factory waits for the guarded boundary and sends only the approved template", async () => {
  await withProvider(async (calls) => {
    let checked = false;
    const transport = createStaffWhatsAppTransport();
    const result = await transport.sendStaffWhatsAppByPhone({
      phone: "+852 9798 7774",
      channelId: config.WOZTELL_CHANNEL_ID,
      message: "must not replace template",
      template,
      beforeSend: async () => {
        checked = true;
        assert.equal(calls.length, 0);
      },
    });
    assert.equal(checked, true);
    assert.equal(result.state, "accepted");
    assert.equal(result.evidenceKind, "provider_accepted");
    assert.equal(result.providerOperationId, "owned-operation-id");
    assert.deepEqual(calls[0].body.response, [template]);
    assert.equal(calls[0].body.recipientId, "85297987774");
    assert.equal(Object.hasOwn(calls[0].body, "memberId"), false);
  });
});
test("a failed beforeSend check, missing template or invalid phone cannot reach the provider", async () => {
  await withProvider(async (calls) => {
    const transport = createStaffWhatsAppTransport();
    const base = {
      phone: "85297987774",
      channelId: config.WOZTELL_CHANNEL_ID,
      message: "Owned notification",
      template,
      beforeSend: async () => {},
    };
    for (const input of [
      {
        ...base,
        beforeSend: async () => {
          throw Error("owned route changed");
        },
      },
      { ...base, template: null },
      { ...base, phone: "opaque-member-is-not-a-phone" },
      { ...base, phone: "8613812345678" },
    ])
      await assert.rejects(
        () => transport.sendStaffWhatsAppByPhone(input),
        (error) => error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
      );
    assert.equal(calls.length, 0);
  });
});
test("the existing member transport keeps its verified opaque member contract", async () => {
  await withProvider(async (calls) => {
    const transport = createStaffWhatsAppTransport();
    const result = await transport.sendStaffWhatsApp({
      memberId: "verified-owned-member",
      channelId: config.WOZTELL_CHANNEL_ID,
      message: "Owned legacy staff notice",
      template,
      beforeSend: async () => {},
    });
    assert.equal(result.state, "accepted");
    assert.equal(calls[0].body.memberId, "verified-owned-member");
    assert.equal(Object.hasOwn(calls[0].body, "recipientId"), false);
  });
});
test("a documented definitive refusal stays failed while an unreadable response stays unknown", async () => {
  const send = async (calls) => {
    const result = await createStaffWhatsAppTransport().sendStaffWhatsAppByPhone({
      phone: "85297987774",
      channelId: config.WOZTELL_CHANNEL_ID,
      message: "Owned",
      template,
      beforeSend: async () => {},
    });
    assert.equal(calls.length, 1);
    return result;
  };
  await withProvider(async (calls) => assert.equal((await send(calls)).state, "failed"), {
    body: { ok: 0, err_code: 131, err: "owned definitive refusal" },
    status: 500,
  });
  await withProvider(async (calls) => assert.equal((await send(calls)).state, "unknown"), {
    body: "upstream response unavailable",
    status: 502,
  });
});
