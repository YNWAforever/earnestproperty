import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  parseOutboundIntent,
  hashOutboundIntent,
  deliverOutboundIntent,
  finishOutboundIntent,
  readOutboundIntent,
} from "./outbound-intent.server.ts";
const id = "11111111-1111-4111-8111-111111111111";
const input = { requestId: id, conversationId: id, kind: "text", payload: { text: "hello" } };
test("readonly HTTP handler authenticates before scoped outbound read and sanitizes failure", async (t) => {
  const source = ts.createSourceFile(
    "send.ts",
    readFileSync("src/routes/api.admin.woztell.send.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let handler;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "GET")
      handler = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler, "GET recovery handler exists");
  const actor = { staffId: id, roles: ["agent"] };
  function fixture({ denial, rows = [{ id, kind: "text", state: "unknown" }], failure } = {}) {
    const calls = [];
    const context = {
      URL,
      Response,
      requireStaffAccess: async (_request, roles) => {
        assert.deepEqual(Array.from(roles), ["admin", "manager", "agent"]);
        if (denial) throw new Response("Denied", { status: denial });
        return actor;
      },
      agentScope: (staff) => staff.staffId,
      readOutboundIntent: (value, staffId, scope) =>
        readOutboundIntent(value, staffId, scope, async (statement, params) => {
          assert.match(statement, /^SELECT /);
          calls.push(params);
          if (failure) throw Error("Synthetic private failure detail");
          return rows;
        }),
    };
    vm.runInNewContext(
      ts.transpile(`globalThis.run = ${handler}`, { target: ts.ScriptTarget.ES2022 }),
      context,
    );
    const request = (requestId = id) =>
      new Request(
        `https://example.invalid/api/admin/woztell/send?requestId=${requestId}&conversationId=${id}&staffId=untrusted&scope=untrusted`,
      );
    return { calls, run: (requestId) => context.run({ request: request(requestId) }) };
  }
  await t.test("successful read keeps unknown and ignores client actor or scope", async () => {
    const h = fixture();
    const response = await h.run();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).intent.state, "unknown");
    assert.deepEqual(h.calls, [[id, id, id, id]]);
  });
  await t.test("unauthenticated and denied actors never reach a query", async () => {
    for (const denial of [401, 403]) {
      const h = fixture({ denial });
      await assert.rejects(
        h.run(),
        (error) => error instanceof Response && error.status === denial,
      );
      assert.equal(h.calls.length, 0);
    }
  });
  await t.test("invalid identifier is400 without query", async () => {
    const h = fixture();
    assert.equal((await h.run("invalid")).status, 400);
    assert.equal(h.calls.length, 0);
  });
  await t.test("missing or forbidden request is404 without identity disclosure", async () => {
    const response = await fixture({ rows: [] }).run();
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "OUTBOUND_NOT_FOUND_OR_FORBIDDEN",
    });
  });
  await t.test("query outage is503 with no raw error or mutation", async () => {
    const response = await fixture({ failure: true }).run();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "OUTBOUND_READ_UNAVAILABLE" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});
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
test("nested provider identity is persisted for callback correlation", async () => {
  const h = harness(() => ({
    ok: true,
    body: {
      ok: 1,
      sendResult: { result: [{ messageEvent: { messageId: "nested-external" } }] },
    },
  }));
  await deliverOutboundIntent(id, h.deps);
  assert.equal(h.state(), "accepted");
  assert.equal(h.persisted[0].externalMessageId, "nested-external");
  assert.equal(h.persisted[0].providerResult.responseCount, 1);
  assert.equal(h.persisted[0].providerResult.results[0].messageId, "nested-external");
});
test("execution acceptance without a stable message identity stays unknown", async () => {
  const h = harness(() => ({ ok: true, body: { ok: 1, sendResult: { result: [{}] } } }));
  await deliverOutboundIntent(id, h.deps);
  await deliverOutboundIntent(id, h.deps);
  assert.equal(h.state(), "unknown");
  assert.equal(h.sends(), 1);
});
test("mixed response evidence is terminal unknown but retains a unique id for correlation", async () => {
  const h = harness(() => ({
    ok: false,
    body: {
      ok: 1,
      sendResult: {
        result: [
          { messageEvent: { messageId: "possibly-sent" } },
          { err: "second response rejected" },
        ],
      },
    },
  }));
  await deliverOutboundIntent(id, h.deps);
  await deliverOutboundIntent(id, h.deps);
  assert.equal(h.state(), "unknown");
  assert.equal(h.persisted[0].externalMessageId, "possibly-sent");
  assert.equal(h.sends(), 1);
});
test("an early callback row is adopted before the HTTP result updates the transcript", async () => {
  let statements;
  await finishOutboundIntent(
    id,
    { state: "accepted", externalMessageId: "early-callback-id", error: null },
    async (input) => {
      statements = input;
      return input.map(() => []);
    },
  );
  const sql = statements[1].statement;
  assert.match(sql, /existing AS/);
  assert.match(sql, /m\.external_message_id=\$3/);
  assert.match(sql, /message_id=COALESCE\(\(SELECT id FROM existing\),i\.message_id\)/);
  assert.match(sql, /DELETE FROM whatsapp_messages/);
  assert.match(sql, /jsonb_build_object\('providerResult',\$5::jsonb\)/);
  assert.match(sql, /COALESCE\(m\.payload,'\{\}'::jsonb\)/);
  assert.deepEqual(statements[1].params, [id, "accepted", "early-callback-id", null, null]);
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
  await ingestWoztellEvent(event, "live_webhook", async (input) => {
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
