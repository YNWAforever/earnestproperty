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
  readOutboundReservation,
} from "./outbound-intent.server.ts";
import { sendWoztellResponse } from "./woztell.server.ts";
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
      readOutboundReservation: (value, staffId, scope) =>
        readOutboundReservation(value, staffId, scope, async (statement, params) => {
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
    return {
      calls,
      run: (requestId) => context.run({ request: request(requestId) }),
      reserve: (conversationId = id) =>
        context.run({
          request: new Request(
            `https://example.invalid/api/admin/woztell/send?reconciliation=true&conversationId=${conversationId}&staffId=untrusted&scope=untrusted`,
          ),
        }),
    };
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
  await t.test(
    "cold reservation read is scoped no-store and never exposes another actor's request",
    async () => {
      const h = fixture({ rows: [{ blocked: true, intent: null }] });
      const response = await h.reserve();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        ok: true,
        reservation: { blocked: true, intent: null },
      });
      assert.deepEqual(h.calls, [[id, id, id]]);
      for (const denial of [401, 403]) {
        const denied = fixture({ denial });
        await assert.rejects(
          denied.reserve(),
          (error) => error instanceof Response && error.status === denial,
        );
        assert.equal(denied.calls.length, 0);
      }
      const invalid = fixture();
      assert.equal((await invalid.reserve("invalid")).status, 400);
      assert.equal(invalid.calls.length, 0);
      assert.equal((await fixture({ rows: [] }).reserve()).status, 404);
      const unavailable = await fixture({ failure: true }).reserve();
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), { ok: false, error: "OUTBOUND_READ_UNAVAILABLE" });
    },
  );
});

test("text and template HTTP writes preserve reservation409 and trusted actor guards", async () => {
  for (const [path, body] of [
    [
      "src/routes/api.admin.woztell.send.ts",
      { requestId: id, conversationId: id, text: "Synthetic reply" },
    ],
    [
      "src/routes/api.admin.woztell.send-template.ts",
      { requestId: id, conversationId: id, templateId: id },
    ],
  ]) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    let handler;
    function visit(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === "POST")
        handler = node.initializer.getText(source);
      ts.forEachChild(node, visit);
    }
    visit(source);
    let calls = 0;
    const context = {
      Response,
      JSON,
      SyntaxError,
      Error,
      parseOutboundIntent,
      requireStaffAccess: async () => ({ staffId: id, roles: ["agent"] }),
      agentScope: (staff) => staff.staffId,
      enqueueOutboundIntent: async (_value, staffId, scope) => {
        calls++;
        assert.equal(staffId, id);
        assert.equal(scope, id);
        throw Object.assign(new Error("OUTBOUND_RECONCILIATION_REQUIRED"), { code: "P0001" });
      },
    };
    vm.runInNewContext(
      ts.transpile(`globalThis.run = ${handler}`, { target: ts.ScriptTarget.ES2022 }),
      context,
    );
    const request = () =>
      new Request("https://example.invalid/api/admin/woztell/send", {
        method: "POST",
        body: JSON.stringify({ ...body, staffId: "untrusted", scope: "untrusted" }),
      });
    const refused = await context.run({ request: request() });
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), {
      ok: false,
      error: "OUTBOUND_RECONCILIATION_REQUIRED",
    });
    assert.equal(calls, 1);
    for (const denial of [401, 403]) {
      context.requireStaffAccess = async () => {
        throw new Response("Denied", { status: denial });
      };
      await assert.rejects(
        context.run({ request: request() }),
        (error) => error instanceof Response && error.status === denial,
      );
      assert.equal(calls, 1);
    }
  }
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
// FX-08 / D-02: a definite refusal or a config error is `failed` (no lock), never `unknown`.
// Provider-down fallback: every case calls the fake send exactly once, and a second delivery of
// the same intent makes no call at all. Nothing here talks to WozTell.
async function deliverTwice(result) {
  const h = harness(() => {
    if (result instanceof Error) throw result;
    return result;
  });
  await deliverOutboundIntent(id, h.deps);
  await deliverOutboundIntent(id, h.deps);
  assert.equal(h.sends(), 1);
  assert.equal(h.persisted.length, 1);
  return { state: h.state(), error: h.persisted[0].error };
}
// FX-10b controller ruling, backed by "never double-send": an answer whose body could not be
// read or parsed (gateway HTML, an empty body, truncated JSON) proves nothing about whether the
// customer got the message, so it is `unknown` (locked until a manager resolves it) at any
// status. The send is made once and never repeated.
test("an unreadable or unparsable provider answer is unknown at any status, never re-sent", async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    for (const result of [
      // sendWoztellResponse's shape for HTML or truncated JSON.
      { ok: false, error: "WOZTELL_INVALID_RESPONSE", status, bodyUnreadable: true },
      // Its shape for an empty body.
      {
        ok: false,
        error: `WOZTELL_HTTP_${status}`,
        status,
        body: {},
        refused: false,
        bodyUnreadable: true,
      },
      // An older shape without the flag still fails closed on the parse-failure code.
      { ok: false, error: "WOZTELL_INVALID_RESPONSE", status },
    ])
      assert.deepEqual(
        await deliverTwice(result),
        { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
        JSON.stringify(result),
      );
  }
});
// The same ruling end to end: a fake WozTell answer goes through the real sendWoztellResponse
// and the real classifier. The fake fetch is the only network; nothing here talks to WozTell.
async function deliverRawAnswerTwice(status, text) {
  const originalFetch = globalThis.fetch;
  const previous = {
    enabled: process.env.WOZTELL_ENABLED,
    token: process.env.WOZTELL_BOT_ACCESS_TOKEN,
    channel: process.env.WOZTELL_CHANNEL_ID,
  };
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return new Response(text, { status });
  };
  process.env.WOZTELL_ENABLED = "true";
  process.env.WOZTELL_BOT_ACCESS_TOKEN = "test-token";
  process.env.WOZTELL_CHANNEL_ID = "test-channel";
  try {
    let raw;
    const h = harness(async () => {
      raw = await sendWoztellResponse({
        memberId: "m1",
        response: [{ type: "TEXT", text: "hi" }],
      });
      return raw;
    });
    await deliverOutboundIntent(id, h.deps);
    await deliverOutboundIntent(id, h.deps);
    assert.equal(h.sends(), 1);
    assert.equal(fetches, 1);
    return { raw, state: h.state(), error: h.persisted[0].error };
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WOZTELL_ENABLED = previous.enabled;
    process.env.WOZTELL_BOT_ACCESS_TOKEN = previous.token;
    process.env.WOZTELL_CHANNEL_ID = previous.channel;
  }
}
for (const [status, label, text] of [
  [400, "a gateway HTML page", "<html><body>400 Bad Request</body></html>"],
  [429, "a gateway HTML page", "<html><body>429 Too Many Requests</body></html>"],
  [403, "an empty body", ""],
  [422, "truncated JSON", '{"ok":0,"err":"Parameter(s) is'],
]) {
  test(`a staff send answered ${status} with ${label} is unknown, not a definite refusal`, async () => {
    const { raw, state, error } = await deliverRawAnswerTwice(status, text);
    assert.equal(raw.ok, false);
    assert.equal(raw.status, status);
    assert.equal(raw.bodyUnreadable, true);
    assert.notEqual(raw.refused, true);
    assert.deepEqual({ state, error }, { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" });
  });
}
test("a parsed ok:0 refusal at 4xx is readable and stays a definite refusal", async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    const { raw, state, error } = await deliverRawAnswerTwice(
      status,
      JSON.stringify({ ok: 0, err: "Parameter(s) is missing" }),
    );
    assert.notEqual(raw.bodyUnreadable, true, String(status));
    assert.equal(raw.refused, true, String(status));
    assert.deepEqual(
      { state, error },
      { state: "failed", error: "WOZTELL_REFUSED" },
      String(status),
    );
  }
});
test("definite rejections and config errors are failed", async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    // A parsed JSON 4xx with no acceptance evidence (refused:false).
    for (const result of [
      { ok: false, error: `WOZTELL_HTTP_${status}`, status, body: {}, refused: false },
      { ok: false, error: `WOZTELL_HTTP_${status}`, status, body: {}, bodyUnreadable: false },
    ])
      assert.deepEqual(
        await deliverTwice(result),
        { state: "failed", error: "WOZTELL_PROVIDER_REJECTED" },
        JSON.stringify(result),
      );
    // An explicit ok:0 is a refusal first (rule 4 precedes rule 5): still failed.
    assert.deepEqual(
      await deliverTwice({ ok: false, error: "refused", status, body: { ok: 0 }, refused: true }),
      { state: "failed", error: "WOZTELL_REFUSED" },
      String(status),
    );
  }
  for (const error of [
    "WOZTELL_ENABLED is not true",
    "Missing WOZTELL_BOT_ACCESS_TOKEN or WOZTELL_CHANNEL_ID",
  ])
    assert.deepEqual(await deliverTwice({ ok: false, error, stage: "preflight" }), {
      state: "failed",
      error: "WOZTELL_CONFIGURATION_UNAVAILABLE",
    });
});
test("any acceptance signal keeps unknown: 401 with ok:1, 429 with a messageId, 2xx execution_accepted", async () => {
  for (const result of [
    { ok: false, error: "WOZTELL_HTTP_401", status: 401, body: { ok: 1 }, refused: false },
    { ok: false, error: "WOZTELL_HTTP_429", status: 429, body: { messageId: "maybe-sent" } },
    { ok: true, status: 200, body: { ok: 1, sendResult: { result: [{}] } } },
    // A config-stage shape that nonetheless carries acceptance evidence is never `failed`.
    { ok: false, stage: "preflight", status: 403, body: { ok: 1 } },
  ])
    assert.deepEqual(
      await deliverTwice(result),
      { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
      JSON.stringify(result),
    );
});
test("5xx without ok:0, a timeout throw and an ambiguous 2xx stay unknown", async () => {
  for (const result of [
    { ok: false, error: "WOZTELL_HTTP_503", status: 503, body: {}, refused: false },
    { ok: false, error: "WOZTELL_INVALID_RESPONSE", status: 500 },
    { ok: false, error: "WOZTELL_AMBIGUOUS_RESPONSE", status: 200, body: {}, refused: false },
    { ok: false, error: "WOZTELL_AMBIGUOUS_RESPONSE" },
    Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    new TypeError("fetch failed"),
  ])
    assert.deepEqual(
      await deliverTwice(result),
      { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
      String(result?.error ?? result),
    );
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
  assert.equal(JSON.parse(statements.at(-1).params[14])?.type, "TEXT");
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

// FX-08 D4: structural pin on the one dispatch predicate. Behaviour is proven on owned
// Postgres in opt-out.owned.db.test.mjs; this catches a silent widening in review.
test("eligibility SQL keeps template behind opted_out_whatsapp=false and gates text on last_inbound_at > opted_out_at", () => {
  const source = readFileSync("src/lib/woztell/outbound-intent.server.ts", "utf8").replace(
    /\s+/g,
    " ",
  );
  const start = source.indexOf("WITH eligibility AS (");
  const end = source.indexOf(") AS allowed", start);
  assert.ok(start > 0 && end > start, "eligibility CTE found");
  const allowed = source.slice(start, end);
  const text =
    /\(i\.kind='text' AND wc\.last_inbound_at >= now\(\)-interval '24 hours' AND \(c\.opted_out_whatsapp=false OR \(c\.opted_out_at IS NOT NULL AND wc\.last_inbound_at > c\.opted_out_at\)\)\)/;
  const template =
    /\(i\.kind='template' AND c\.opted_out_whatsapp=false AND t\.status LIKE 'active%'\)/;
  assert.match(allowed, text);
  assert.match(allowed, template);
  // The reopen is strictly later, never >=, and never reads the contact-level inbound time.
  assert.doesNotMatch(allowed, /last_inbound_at\s*>=\s*c\.opted_out_at/);
  assert.doesNotMatch(allowed, /(?<!w)c\.last_inbound_at/);
  // Exactly one opted_out_at comparison and exactly two flag reads (text + template).
  assert.equal(allowed.match(/opted_out_at/g).length, 2);
  assert.equal(allowed.match(/c\.opted_out_whatsapp=false/g).length, 2);
  // No other kind can slip through: the two branches are the whole kind gate.
  assert.match(
    allowed,
    /NULLIF\(wc\.woztell_member_id,''\) IS NOT NULL AND \( \(i\.kind='text'[\s\S]*\) OR \(i\.kind='template'[^)]*\)\)/,
  );
});
