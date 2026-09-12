import assert from "node:assert/strict";
import test from "node:test";

import { parseWoztellProviderResult } from "./provider-result.ts";

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
