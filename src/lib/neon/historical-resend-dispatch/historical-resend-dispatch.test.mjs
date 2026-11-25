import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_RESEND_ATTEMPT_PREFIX,
  HISTORICAL_RESEND_REASONS,
  historicalResendAttemptKey,
  historicalResendFingerprint,
  historicalResendLedgerState,
  historicalResendOutcome,
  historicalResendProofReasons,
} from "./historical-resend-dispatch.mjs";

const LEAD = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "company";
const ENDPOINT = "33333333-3333-4333-8333-333333333333";
const HEX = "a".repeat(64);
const proof = (overrides = {}) => ({
  staffId: STAFF,
  transport: "website_lead_phone",
  channelId: CHANNEL,
  endpointId: ENDPOINT,
  endpointVersion: 2,
  destinationReference: "85291234567",
  fingerprint: HEX,
  ready: true,
  reasons: [],
  ...overrides,
});
const parts = (overrides = {}) => ({
  leadFingerprint: "b".repeat(64),
  proofFingerprint: HEX,
  leadId: LEAD,
  staffId: STAFF,
  channelId: CHANNEL,
  transport: "website_lead_phone",
  endpointId: ENDPOINT,
  endpointVersion: 2,
  destinationReference: "85291234567",
  message: "歷史查詢補發：網站查詢",
  ...overrides,
});

test("attempt key is per lead + staff and never includes an endpoint version", () => {
  const key = historicalResendAttemptKey(LEAD, STAFF);
  assert.equal(key, `${HISTORICAL_RESEND_ATTEMPT_PREFIX}${LEAD}:${STAFF}`);
  assert.equal(historicalResendAttemptKey(LEAD, STAFF), key);
  assert.notEqual(historicalResendAttemptKey(LEAD, ENDPOINT), key);
});

test("fingerprint is stable and binds every approval input", () => {
  const base = historicalResendFingerprint(parts());
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.equal(historicalResendFingerprint(parts()), base);
  for (const changed of [
    { leadFingerprint: "c".repeat(64) },
    { proofFingerprint: "d".repeat(64) },
    { endpointId: "44444444-4444-4444-8444-444444444444" },
    { endpointVersion: 3 },
    { destinationReference: "85298765432" },
    { channelId: "other" },
    { message: "歷史查詢補發：其他" },
  ]) {
    assert.notEqual(historicalResendFingerprint(parts(changed)), base);
  }
});

test("a yes needs ready === true AND an explicit empty reason array", () => {
  assert.deepEqual(historicalResendProofReasons(proof(), CHANNEL, STAFF), []);
  for (const malformed of [
    { ready: false, reasons: [] },
    { ready: false, reasons: undefined },
    { ready: true, reasons: undefined },
    { ready: true, reasons: null },
    { ready: true, reasons: ["hours_not_approved"] },
    { ready: "true", reasons: [] },
  ]) {
    assert.notDeepEqual(
      historicalResendProofReasons(proof(malformed), CHANNEL, STAFF),
      [],
      `must reject ${JSON.stringify(malformed)}`,
    );
  }
});

test("proof classification is fail-closed on identity, endpoint and transport", () => {
  const cases = [
    [{ staffId: ENDPOINT }, HISTORICAL_RESEND_REASONS.proofStaffMismatch],
    [{ endpointId: "not-a-uuid" }, HISTORICAL_RESEND_REASONS.proofEndpointInvalid],
    [{ endpointVersion: 0 }, HISTORICAL_RESEND_REASONS.proofEndpointInvalid],
    [{ endpointVersion: -3 }, HISTORICAL_RESEND_REASONS.proofEndpointInvalid],
    [{ endpointVersion: 2.5 }, HISTORICAL_RESEND_REASONS.proofEndpointInvalid],
    [{ endpointVersion: 2 ** 40 }, HISTORICAL_RESEND_REASONS.proofEndpointInvalid],
    [{ transport: "staff_whatsapp" }, HISTORICAL_RESEND_REASONS.proofNotPhone],
    [{ channelId: "other" }, HISTORICAL_RESEND_REASONS.proofChannelMismatch],
    [{ destinationReference: "852912345" }, HISTORICAL_RESEND_REASONS.proofEndpointChanged],
    [{ fingerprint: "xyz" }, HISTORICAL_RESEND_REASONS.proofFingerprintInvalid],
  ];
  for (const [overrides, expected] of cases) {
    const reasons = historicalResendProofReasons(proof(overrides), CHANNEL, STAFF);
    assert.ok(reasons.includes(expected), `${JSON.stringify(overrides)} -> ${reasons}`);
  }
  assert.deepEqual(historicalResendProofReasons(null, CHANNEL, STAFF), [
    HISTORICAL_RESEND_REASONS.noRecipientProof,
  ]);
});

test("ledger states keep accepted and delivered successful, unknown permanent", () => {
  assert.equal(historicalResendLedgerState("accepted"), "sent");
  assert.equal(historicalResendLedgerState("delivered"), "sent");
  assert.equal(historicalResendLedgerState("unknown"), "unknown");
  assert.equal(historicalResendLedgerState("dispatching"), "in_flight");
  assert.equal(historicalResendLedgerState("queued"), "in_flight");
  assert.equal(historicalResendLedgerState("failed"), "failed");
  assert.equal(historicalResendLedgerState("suppressed"), "suppressed");
  assert.equal(historicalResendLedgerState(null), "idle");
});

test("provider acceptance needs no operation id; uncertain is unknown, never failed", () => {
  assert.deepEqual(historicalResendOutcome({ state: "accepted" }).ok, true);
  assert.equal(historicalResendOutcome({ state: "accepted" }).dispatchState, "accepted");
  assert.equal(historicalResendOutcome({ state: "accepted" }).providerOperationId, null);
  assert.equal(
    historicalResendOutcome({ state: "accepted", providerOperationId: "msg-1" })
      .providerOperationId,
    "msg-1",
  );
  assert.equal(historicalResendOutcome({ state: "failed" }).dispatchState, "failed");
  assert.equal(historicalResendOutcome({ state: "unknown" }).dispatchState, "unknown");
  assert.equal(historicalResendOutcome({ state: "suppressed" }).dispatchState, "suppressed");
  assert.equal(historicalResendOutcome(null).dispatchState, "unknown");
  assert.equal(historicalResendOutcome(null).ok, false);
});
