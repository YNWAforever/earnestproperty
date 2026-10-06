import assert from "node:assert/strict";
import { mock, test } from "bun:test";

let queryCount = 0;
mock.module("@/lib/neon/db.server", () => ({
  getSql: () => {
    throw new Error("UNEXPECTED_DATABASE_ACCESS");
  },
  queryRows: async () => {
    queryCount += 1;
    throw new Error("UNEXPECTED_DATABASE_ACCESS");
  },
  numberOrNull: (value) => (value == null ? null : Number(value)),
  stringOrEmpty: (value) => (value == null ? "" : String(value)),
  stringOrNull: (value) => (value == null ? null : String(value)),
}));

const { LiveAgentPublicError, requestLiveAgentHandoff } = await import("./live-agent.server.ts");
const {
  formatHandoffPhoneForDisplay,
  liveAgentPhoneErrorFromBody,
  liveAgentPhoneErrorMessage,
  validateHandoffPhone,
} = await import("./live-agent.ts");

const PHONE_REQUIRED_COPY = "請輸入電話號碼，方便代理聯絡你。";
const PHONE_INVALID_COPY = "電話號碼格式不正確，請輸入 8 位香港手機號碼，或連國家碼的號碼。";

const ownedSession = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  accessToken: "test-token",
};

test("validateHandoffPhone normalises HK mobiles and international numbers", () => {
  const cases = [
    [
      ["91234567", "9123 4567", "9123-4567", "+852 9123 4567", "0085291234567", "85291234567"],
      "85291234567",
    ],
    [["+852-6123-4567"], "85261234567"],
    [["+447700900123", "+44 7700 900123"], "447700900123"],
    [["+8613800138000"], "8613800138000"],
  ];
  for (const [inputs, normalized] of cases) {
    for (const input of inputs) {
      assert.deepEqual(validateHandoffPhone(input), { ok: true, normalized }, `input ${input}`);
    }
  }
});

test("validateHandoffPhone rejects blank as REQUIRED and malformed numbers as INVALID", () => {
  for (const blank of [undefined, null, "", "   "]) {
    assert.deepEqual(
      validateHandoffPhone(blank),
      { ok: false, code: "LIVE_AGENT_PHONE_REQUIRED" },
      `blank ${JSON.stringify(blank)}`,
    );
  }
  for (const invalid of [
    "9123456",
    "31234567",
    "2123 4567",
    "123456789",
    "+852 2345 6789",
    "00852 2345 6789",
    "+1234567",
    "+1234567890123456",
    "+0123456789",
    "(852) 9123 4567",
    "9123abcd",
    "00447700900123",
  ]) {
    assert.deepEqual(
      validateHandoffPhone(invalid),
      { ok: false, code: "LIVE_AGENT_PHONE_INVALID" },
      `invalid ${invalid}`,
    );
  }
});

test("phone error copy is the exact zh-HK text", () => {
  assert.equal(liveAgentPhoneErrorMessage("LIVE_AGENT_PHONE_REQUIRED"), PHONE_REQUIRED_COPY);
  assert.equal(liveAgentPhoneErrorMessage("LIVE_AGENT_PHONE_INVALID"), PHONE_INVALID_COPY);
});

test("formatHandoffPhoneForDisplay formats HK and international numbers", () => {
  assert.equal(formatHandoffPhoneForDisplay("85291234567"), "+852 9123 4567");
  assert.equal(formatHandoffPhoneForDisplay("85261234567"), "+852 6123 4567");
  assert.equal(formatHandoffPhoneForDisplay("447700900123"), "+447700900123");
  assert.equal(formatHandoffPhoneForDisplay("8613800138000"), "+8613800138000");
});

test("liveAgentPhoneErrorFromBody maps only phone codes and never echoes server text", () => {
  assert.equal(
    liveAgentPhoneErrorFromBody({ code: "LIVE_AGENT_PHONE_INVALID", error: "raw" }),
    PHONE_INVALID_COPY,
  );
  assert.equal(
    liveAgentPhoneErrorFromBody({ code: "LIVE_AGENT_PHONE_REQUIRED", error: "raw" }),
    PHONE_REQUIRED_COPY,
  );
  assert.equal(liveAgentPhoneErrorFromBody({ error: "Live-agent session is not open." }), null);
  assert.equal(liveAgentPhoneErrorFromBody(null), null);
  assert.equal(liveAgentPhoneErrorFromBody({ code: "OTHER" }), null);
});

test("handoff service rejects invalid budgets before session or CRM SQL", async () => {
  for (const budget of [
    { budget_min: -1, budget_max: 100 },
    { budget_min: 200, budget_max: 100 },
    { budget_min: 0, budget_max: -1 },
    { budget_min: Number.POSITIVE_INFINITY, budget_max: null },
  ]) {
    await assert.rejects(
      requestLiveAgentHandoff({ ...ownedSession, ...budget }),
      (error) => error instanceof LiveAgentPublicError && error.status === 400,
    );
  }
  assert.equal(queryCount, 0);
});

test("handoff service rejects a missing or invalid phone before any SQL", async () => {
  queryCount = 0;
  for (const [phone, code, message] of [
    [undefined, "LIVE_AGENT_PHONE_REQUIRED", PHONE_REQUIRED_COPY],
    ["", "LIVE_AGENT_PHONE_REQUIRED", PHONE_REQUIRED_COPY],
    ["  ", "LIVE_AGENT_PHONE_REQUIRED", PHONE_REQUIRED_COPY],
    ["9123456", "LIVE_AGENT_PHONE_INVALID", PHONE_INVALID_COPY],
    ["+852 2345 6789", "LIVE_AGENT_PHONE_INVALID", PHONE_INVALID_COPY],
  ]) {
    await assert.rejects(
      requestLiveAgentHandoff({ ...ownedSession, phone }),
      (error) =>
        error instanceof LiveAgentPublicError &&
        error.status === 400 &&
        error.code === code &&
        error.message === message,
      `phone ${JSON.stringify(phone)}`,
    );
  }
  assert.equal(queryCount, 0);
});

test("valid handoff budget proceeds to session lookup", async () => {
  queryCount = 0;
  await assert.rejects(
    requestLiveAgentHandoff({
      ...ownedSession,
      phone: "9123 4567",
      budget_min: 0,
      budget_max: 100,
    }),
    /UNEXPECTED_DATABASE_ACCESS/,
  );
  assert.equal(queryCount, 1);
});
