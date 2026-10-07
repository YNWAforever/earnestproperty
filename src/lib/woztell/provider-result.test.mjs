import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  DEFINITE_REJECTION_STATUSES,
  classifyOutboundSendResult,
  parseWoztellProviderResult,
} from "./provider-result.ts";

test("parses legacy top-level and data message identities", () => {
  for (const [body, id] of [
    [{ ok: 1, messageId: "top-id" }, "top-id"],
    [{ ok: 1, data: { messageId: "data-id" } }, "data-id"],
  ]) {
    const parsed = parseWoztellProviderResult(body);
    assert.equal(parsed.outcome, "identifiable_acceptance");
    assert.deepEqual(parsed.messageIds, [id]);
    assert.equal(parsed.possibleAccepted, true);
  }
});

test("parses documented nested result identities without inventing an inner success flag", () => {
  const body = {
    ok: 1,
    sendResult: {
      result: [{ messageEvent: { messageId: "first" } }, { messageEvent: { messageId: "second" } }],
    },
  };
  const parsed = parseWoztellProviderResult(body);
  assert.equal(parsed.outcome, "identifiable_acceptance");
  assert.deepEqual(parsed.messageIds, ["first", "second"]);
  assert.equal(parsed.responseCount, 2);
  assert.deepEqual(
    parsed.results.map(({ index, messageId, error }) => ({ index, messageId, error })),
    [
      { index: 0, messageId: "first", error: null },
      { index: 1, messageId: "second", error: null },
    ],
  );
});

test("outer execution acceptance without a stable identity remains distinguishable", () => {
  const parsed = parseWoztellProviderResult({ ok: 1, sendResult: { result: [{}] } });
  assert.equal(parsed.outcome, "execution_accepted");
  assert.equal(parsed.possibleAccepted, true);
  assert.deepEqual(parsed.messageIds, []);
  assert.equal(parsed.responseCount, 1);
});

test("an explicit outer refusal is definitive and retains its reason", () => {
  const parsed = parseWoztellProviderResult({
    ok: 0,
    err_code: 112,
    err: "Channel ID not found",
  });
  assert.equal(parsed.outcome, "definitive_refusal");
  assert.equal(parsed.possibleAccepted, false);
  assert.deepEqual(parsed.errors, ["WOZTELL_112: Channel ID not found"]);
});

test("inner errors prevent blanket success and preserve per-result evidence", () => {
  const parsed = parseWoztellProviderResult({
    ok: 1,
    sendResult: {
      result: [
        { messageEvent: { messageId: "accepted-id" } },
        { err_code: 23, err: "second response rejected" },
      ],
    },
  });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.equal(parsed.possibleAccepted, true);
  assert.deepEqual(parsed.messageIds, ["accepted-id"]);
  assert.deepEqual(parsed.errors, ["WOZTELL_23: second response rejected"]);
  assert.equal(parsed.results[1].error, "WOZTELL_23: second response rejected");
});

test("conflicting identity locations are partial and never choose an unsafe identity", () => {
  const parsed = parseWoztellProviderResult({
    ok: 1,
    messageId: "outer-id",
    sendResult: { result: [{ messageEvent: { messageId: "nested-id" } }] },
  });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.equal(parsed.possibleAccepted, true);
  assert.equal(parsed.primaryMessageId, null);
  assert.deepEqual(parsed.messageIds, ["outer-id", "nested-id"]);
  assert.ok(parsed.errors.includes("WOZTELL_CONFLICTING_MESSAGE_IDS"));
});

test("a refusal that also carries accepted-side-effect evidence is contradictory, not retryable", () => {
  const parsed = parseWoztellProviderResult({
    ok: 0,
    err: "request refused",
    sendResult: { result: [{ messageEvent: { messageId: "possibly-sent" } }] },
  });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.equal(parsed.possibleAccepted, true);
  assert.equal(parsed.primaryMessageId, "possibly-sent");
  assert.deepEqual(parsed.messageIds, ["possibly-sent"]);
});

test("an explicit inner refusal is retained even without a reason string", () => {
  const parsed = parseWoztellProviderResult({
    ok: 1,
    sendResult: { result: [{ ok: 0 }] },
  });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.deepEqual(parsed.errors, ["WOZTELL_RESULT_REFUSED"]);
  assert.equal(parsed.results[0].error, "WOZTELL_RESULT_REFUSED");
});

test("a sendResult refusal is retained even without a reason string", () => {
  const parsed = parseWoztellProviderResult({
    ok: 1,
    sendResult: { ok: 0 },
  });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.deepEqual(parsed.errors, ["WOZTELL_SEND_RESULT_REFUSED"]);
  assert.equal(parsed.possibleAccepted, true);
});

test("outer refusal plus explicit inner execution acceptance is contradictory", () => {
  const parsed = parseWoztellProviderResult({
    ok: 0,
    sendResult: { result: [{ ok: 1 }] },
  });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.equal(parsed.possibleAccepted, true);
});

test("errors on sendResult and messageEvent are preserved", () => {
  const parsed = parseWoztellProviderResult({
    ok: 1,
    sendResult: {
      error: "batch incomplete",
      result: [{ messageEvent: { error: "message rejected" } }],
    },
  });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.deepEqual(parsed.errors, ["batch incomplete", "message rejected"]);
  assert.equal(parsed.results[0].error, "message rejected");
});

test("an expected response count exposes omitted provider results", () => {
  const parsed = parseWoztellProviderResult(
    {
      ok: 1,
      sendResult: { result: [{ messageEvent: { messageId: "only-one" } }] },
    },
    { expectedResponseCount: 2 },
  );
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.equal(parsed.responseCount, 1);
  assert.ok(parsed.errors.includes("WOZTELL_RESPONSE_COUNT_MISMATCH"));
  assert.equal(parsed.primaryMessageId, "only-one");
});

test("ok:0 with an identity but no reason stays contradictory", () => {
  const parsed = parseWoztellProviderResult({ ok: 0, messageId: "possibly-sent" });
  assert.equal(parsed.outcome, "partial_or_unknown");
  assert.equal(parsed.possibleAccepted, true);
  assert.equal(parsed.primaryMessageId, "possibly-sent");
});

test("malformed or verdict-free envelopes remain unknown", () => {
  for (const body of [null, {}, { ok: true }, { ok: "1" }]) {
    const parsed = parseWoztellProviderResult(body);
    assert.equal(parsed.outcome, "partial_or_unknown");
    assert.equal(parsed.possibleAccepted, false);
  }
});

// FX-08 / D-02: the staff/service send classifier. One assert per rule row; first match wins.
test("classifyOutboundSendResult covers the full rule table", () => {
  const parse = (body) => parseWoztellProviderResult(body);
  const classify = (result, body) => classifyOutboundSendResult(result, parse(body));
  assert.deepEqual(DEFINITE_REJECTION_STATUSES, [400, 401, 403, 404, 422, 429]);
  // 1. ok and an identifiable acceptance -> accepted.
  assert.deepEqual(classify({ ok: true, status: 200 }, { ok: 1, messageId: "m-1" }), {
    state: "accepted",
    error: null,
  });
  // 2. any acceptance signal (ok, or a possible acceptance in the body) -> unknown, even for a
  //    preflight stage, a refusal flag or a definite-rejection status.
  assert.deepEqual(classify({ ok: true, status: 200 }, { ok: 1, sendResult: { result: [{}] } }), {
    state: "unknown",
    error: "WOZTELL_DELIVERY_UNKNOWN",
  });
  assert.deepEqual(
    classify({ ok: false, status: 401, refused: true, stage: "preflight" }, { ok: 1 }),
    { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
  );
  // 3. a preflight (configuration) failure -> failed.
  assert.deepEqual(classify({ ok: false, stage: "preflight" }, undefined), {
    state: "failed",
    error: "WOZTELL_CONFIGURATION_UNAVAILABLE",
  });
  // 4. an explicit refusal (flag or ok:0 body) -> failed, before the status rule.
  assert.deepEqual(classify({ ok: false, refused: true }, undefined), {
    state: "failed",
    error: "WOZTELL_REFUSED",
  });
  assert.deepEqual(classify({ ok: false, status: 400 }, { ok: 0, err: "bad" }), {
    state: "failed",
    error: "WOZTELL_REFUSED",
  });
  // 5. a definite-rejection status with no acceptance signal -> failed.
  for (const status of DEFINITE_REJECTION_STATUSES)
    assert.deepEqual(
      classify({ ok: false, status, refused: false }, {}),
      { state: "failed", error: "WOZTELL_PROVIDER_REJECTED" },
      String(status),
    );
  // 3b. an answer whose body could not be read or parsed proves nothing, so it is unknown at
  //     ANY status, 4xx and 429 included (FX-10b controller ruling: never double-send).
  for (const status of [...DEFINITE_REJECTION_STATUSES, 200, 500]) {
    assert.deepEqual(
      classify({ ok: false, status, bodyUnreadable: true, error: "WOZTELL_INVALID_RESPONSE" }, {}),
      { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
      `unparsable ${status}`,
    );
    assert.deepEqual(
      classify({ ok: false, status, bodyUnreadable: true, refused: false }, {}),
      { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
      `empty ${status}`,
    );
    // An older result shape without the flag: the parse-failure code alone is enough.
    assert.deepEqual(
      classify({ ok: false, status, error: "WOZTELL_INVALID_RESPONSE" }, undefined),
      { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
      `flagless unparsable ${status}`,
    );
  }
  // 6. everything else (5xx, 408, an ambiguous 2xx, no status at all) -> unknown.
  for (const result of [
    { ok: false, status: 500 },
    { ok: false, status: 503, refused: false },
    { ok: false, status: 408 },
    { ok: false, status: 200, refused: false },
    { ok: false },
  ])
    assert.deepEqual(
      classify(result, {}),
      { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
      JSON.stringify(result),
    );
});

test("sendWoztellResponse reports a configuration failure as stage preflight without any fetch", async () => {
  // Module mocks are not enabled in this suite, so the network boundary is pinned at fetch,
  // which boundedProviderFetch uses by default: it must never be reached.
  const network = mock.method(globalThis, "fetch", () => {
    throw Error("Provider/network request forbidden in provider-result tests");
  });
  const saved = Object.fromEntries(
    ["WOZTELL_ENABLED", "WOZTELL_BOT_ACCESS_TOKEN", "WOZTELL_CHANNEL_ID"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  try {
    const { sendWoztellResponse } = await import("./woztell.server.ts");
    const input = { memberId: "synthetic-member", response: [{ type: "TEXT", text: "x" }] };
    delete process.env.WOZTELL_ENABLED;
    delete process.env.WOZTELL_BOT_ACCESS_TOKEN;
    delete process.env.WOZTELL_CHANNEL_ID;
    assert.deepEqual(await sendWoztellResponse(input), {
      ok: false,
      error: "WOZTELL_ENABLED is not true",
      stage: "preflight",
    });
    process.env.WOZTELL_ENABLED = "true";
    assert.deepEqual(await sendWoztellResponse(input), {
      ok: false,
      error: "Missing WOZTELL_BOT_ACCESS_TOKEN or WOZTELL_CHANNEL_ID",
      stage: "preflight",
    });
    assert.equal(network.mock.callCount(), 0);
  } finally {
    network.mock.restore();
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
