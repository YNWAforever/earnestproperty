import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOutboundIntent,
  hashOutboundIntent,
  deliverOutboundIntent,
} from "./outbound-intent.server.ts";
const id = "11111111-1111-4111-8111-111111111111";
const input = { requestId: id, conversationId: id, kind: "text", payload: { text: "hello" } };
test("kind-specific canonical payload hash rejects changed text and invalid payloads", () => {
  assert.equal(
    hashOutboundIntent(parseOutboundIntent(input)),
    hashOutboundIntent(parseOutboundIntent({ ...input, payload: { text: " hello " } })),
  );
  assert.notEqual(
    hashOutboundIntent(input),
    hashOutboundIntent({ ...input, payload: { text: "different" } }),
  );
  assert.throws(() => parseOutboundIntent({ ...input, payload: { text: "hello", extra: true } }));
  assert.throws(() => parseOutboundIntent({ ...input, requestId: "bad" }));
});
function harness(send, failAccepted = false) {
  let state = "queued",
    sends = 0;
  const persisted = [];
  return {
    deps: {
      checkpoint: async () => {},
      begin: async () => {
        if (state !== "queued") return null;
        state = "dispatching";
        return { memberId: "fake", response: [] };
      },
      send: async () => {
        sends++;
        return send();
      },
      finish: async (_id, result) => {
        if (failAccepted && result.state === "accepted") throw Error("db down");
        state = result.state;
        persisted.push(result);
      },
    },
    state: () => state,
    sends: () => sends,
    persisted,
  };
}
test("duplicate workers never dispatch a reserved intent twice", async () => {
  const h = harness(() => ({ ok: true, body: { messageId: "external-1" } }));
  await Promise.all([deliverOutboundIntent(id, h.deps), deliverOutboundIntent(id, h.deps)]);
  assert.equal(h.sends(), 1);
  assert.equal(h.state(), "accepted");
  assert.equal(h.persisted[0].externalMessageId, "external-1");
});
test("provider acceptance plus response loss remains unknown without automatic resend", async () => {
  const h = harness(() => {
    throw Error("response lost");
  });
  await deliverOutboundIntent(id, h.deps);
  await deliverOutboundIntent(id, h.deps);
  assert.equal(h.sends(), 1);
  assert.equal(h.state(), "unknown");
});
test("accepted response plus database failure cannot resend", async () => {
  const h = harness(() => ({ ok: true, body: { messageId: "external-2" } }), true);
  await deliverOutboundIntent(id, h.deps);
  await deliverOutboundIntent(id, h.deps);
  assert.equal(h.sends(), 1);
  assert.equal(h.state(), "unknown");
  assert.equal(h.persisted[0].externalMessageId, "external-2");
});
test("explicit provider refusal is failed; ambiguous HTTP failure is unknown", async () => {
  for (const [result, state] of [
    [{ ok: false, refused: true }, "failed"],
    [{ ok: false, status: 503 }, "unknown"],
  ]) {
    const h = harness(() => result);
    await deliverOutboundIntent(id, h.deps);
    assert.equal(h.state(), state);
  }
});

// The injected transaction inspects the exact production SQL boundary; real SQL execution is
// covered separately by outbound-intent.db.test.mjs on the approved disposable database.
test("later callback carries strict outbound evidence into atomic unknown-intent reconciliation", async () => {
  const { ingestWoztellEvent } = await import("./woztell-ingest.server.ts");
  const { normalizeWoztellEvent } = await import("./woztell.server.ts");
  const h = harness(() => ({ ok: true, body: { messageId: "known-id" } }), true);
  await deliverOutboundIntent(id, h.deps);
  assert.equal(h.state(), "unknown");
  const event = normalizeWoztellEvent({
    type: "BOT",
    memberId: "fake",
    channelId: "test-channel",
    messageEvent: { messageId: "known-id", type: "TEXT", data: { text: "hello" } },
  });
  let statements;
  await ingestWoztellEvent(event, async (input) => {
    statements = input;
    return input.map((_, index) =>
      index === input.length - 1 ? [{ contact_id: id, conversation_id: id, inserted: false }] : [],
    );
  });
  const sql = statements.at(-1).statement;
  assert.match(sql, /accepted_intent AS/);
  assert.match(sql, /UPDATE whatsapp_outbound_intents[\s\S]*state='accepted'/);
  assert.match(sql, /m\.channel_id=\$7/);
  assert.match(sql, /m\.woztell_member_id=\$2/);
  assert.match(sql, /i\.conversation_id=cv\.id/);
  assert.match(sql, /i\.payload->>'text'=\$11/);
  assert.match(sql, /UPDATE whatsapp_messages[\s\S]*status='accepted'/);
  assert.equal(JSON.parse(statements.at(-1).params.at(-1))?.type, "TEXT");
  assert.equal(h.sends(), 1);
});

test("outbound reconciliation evidence rejects synthetic identities and unsupported content", async () => {
  const { normalizeWoztellEvent, outboundWoztellEvidence } = await import("./woztell.server.ts");
  const payload = {
    type: "BOT",
    memberId: "member",
    channelId: "channel",
    messageEvent: { messageId: "external", type: "TEXT", data: { text: "hello" } },
  };
  const event = normalizeWoztellEvent(payload);
  assert.deepEqual(outboundWoztellEvidence(event), { type: "TEXT", text: "hello" });
  for (const patch of [
    { direction: "inbound" },
    { legacyExternalMessageId: "synthetic" },
    { channelId: null },
    { woztellMemberId: null },
    { text: null },
    { messageType: "UNKNOWN" },
  ])
    assert.equal(outboundWoztellEvidence({ ...event, ...patch }), null);
  const template = normalizeWoztellEvent({
    ...payload,
    messageEvent: {
      messageId: "template-external",
      type: "TEMPLATE",
      data: { elementName: "approved", languageCode: "zh_HK" },
    },
  });
  assert.deepEqual(outboundWoztellEvidence(template), {
    type: "TEMPLATE",
    elementName: "approved",
    languageCode: "zh_HK",
    components: [],
  });
  assert.equal(
    outboundWoztellEvidence({
      ...template,
      payload: {
        ...payload,
        messageEvent: { type: "TEMPLATE", data: { elementName: "approved" } },
      },
    }),
    null,
  );
});
