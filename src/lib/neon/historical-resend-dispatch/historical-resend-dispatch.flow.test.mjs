import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchHistoricalStaffResend,
  historicalResendPorts,
  previewHistoricalStaffResend,
} from "./historical-resend-dispatch.server.ts";

const LEAD = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const INQ = "44444444-4444-4444-8444-444444444444";
const ENDPOINT = "33333333-3333-4333-8333-333333333333";
const HEX = "a".repeat(64);
const CHANNEL = "company";
const ACTOR = { staffId: "99999999-9999-4999-8999-999999999999", roles: ["admin"] };

const template = {
  name: "staff_enquiry_followup",
  language: "zh_HK",
  params: ["name", "source", "phone", "link"],
};
const lead = () => ({
  leadId: LEAD,
  inquiryId: INQ,
  createdAt: "2026-11-22T10:00:00.000Z",
  sourceLabel: "網站查詢 · C014574",
  customerName: "測試客戶",
  customerPhone: "85261112222",
  staffIds: [STAFF],
  fingerprint: "b".repeat(64),
});
const proof = (overrides = {}) => ({
  staffId: STAFF,
  staffName: "測試同事",
  channelId: CHANNEL,
  transport: "website_lead_phone",
  endpointId: ENDPOINT,
  endpointVersion: 2,
  destinationReference: "85291234567",
  maskedDestination: "••••4567",
  ready: true,
  reasons: [],
  checkedAt: "2026-11-25T09:00:00.000Z",
  fingerprint: HEX,
  eligible: true,
  mismatch: { kind: "none", requiresManualReview: false, resolution: "resolved", detail: "" },
  scope: { staffId: STAFF, channelId: CHANNEL },
  memberId: "member-1234",
  historical: {
    attemptId: "77777777-7777-4777-8777-777777777777",
    notificationId: "88888888-8888-4888-8888-888888888888",
    transport: "inbox_private_note",
    dispatchState: "failed",
    destinationReference: "85291234567",
    endpointId: ENDPOINT,
    endpointVersion: 2,
    channelId: CHANNEL,
    sentAt: "2026-11-22T10:00:00.000Z",
  },
  receipts: [],
  purpose: { kind: "recipient_consent", reference: null, verifiedAt: null },
  hours: { allowAllHours: true, approved: true, reference: null, approvedAt: null },
  conflicts: {
    crmContacts: 0,
    sameMemberContacts: 0,
    openConversations: 0,
    otherStaffEndpoints: 0,
    numberReuseReviews: 0,
    hash: "c".repeat(64),
    rows: [],
  },
  checks: [],
  review: {
    staffDirectoryMatch: true,
    staffActive: true,
    sharedPhone: false,
    hoursApproved: true,
    allowAllHours: true,
    identityReceiptRef: null,
    purposeRef: null,
    hoursReceiptRef: null,
    conflictHash: "c".repeat(64),
    conflicts: [],
    conflictCounts: {
      crmContacts: 0,
      sameMemberContacts: 0,
      openConversations: 0,
      otherStaffEndpoints: 0,
      numberReuseReviews: 0,
    },
    mismatch: { kind: "none", requiresManualReview: false, resolution: "resolved", detail: "" },
    endpoint: {
      id: ENDPOINT,
      version: 2,
      transport: "website_lead_phone",
      enabled: false,
      retired: false,
    },
    historical: null,
    receipts: [],
    checks: [],
  },
  ...overrides,
});

function harness(overrides = {}) {
  const state = {
    ledger: null,
    attempts: [],
    jobs: [],
    intents: [],
    finalized: null,
    sent: [],
    claimId: null,
    claimAttempt: "55555555-5555-4555-8555-555555555555",
    decisionId: "66666666-6666-4666-8666-666666666666",
    scanError: overrides.scanError ?? null,
    reconciledUnknown: overrides.reconciledUnknown ?? false,
  };
  const query = async (sql, params = []) => {
    if (state.scanError && sql.includes("historical_resend_decisions")) throw state.scanError;
    if (sql.includes("JOIN staff_roles")) return [{ id: ACTOR.staffId }];
    if (sql.includes("safe_error='lease_expired_after_dispatch'")) return [];
    if (sql.includes("FROM staff_notification_attempts WHERE attempt_key=$1"))
      return state.ledger
        ? [
            {
              id: state.ledger.attemptId,
              dispatch_state: state.ledger.dispatchState,
              provider_operation_id: state.ledger.providerOperationId ?? null,
            },
          ]
        : [];
    if (sql.includes("ARRAY(SELECT l.id")) return [{ lead_ids: [LEAD], inquiry_ids: [INQ] }];
    if (sql.includes("t.destination_reference_snapshot AS destination_reference"))
      return state.attempts;
    if (sql.includes("FROM ops_jobs")) return state.jobs;
    if (sql.includes("WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state='dispatching'"))
      return [{ id: state.claimAttempt }];
    if (sql.startsWith("UPDATE staff_notification_attempts SET dispatch_state=$3")) {
      state.finalized = params;
      // A concurrent reconcile may have made the row permanently unknown first.
      const stored = state.reconciledUnknown ? "unknown" : params[2];
      if (state.ledger) state.ledger.dispatchState = stored;
      return [{ dispatch_state: stored }];
    }
    throw new Error(`unexpected query: ${sql.slice(0, 90)}`);
  };
  const transaction = async (statements) =>
    statements.map(({ statement, params }) => {
      if (statement === "SELECT id FROM crm_leads WHERE id=$1::uuid FOR UPDATE")
        return [{ id: LEAD }];
      if (statement.includes("WITH claim AS")) {
        if (state.ledger) return [];
        state.claimId = params[6];
        state.ledger = { attemptId: state.claimAttempt, dispatchState: "dispatching" };
        return [
          { attempt_id: state.claimAttempt, claim_id: params[6], decision_id: state.decisionId },
        ];
      }
      throw new Error(`unexpected statement: ${statement.slice(0, 90)}`);
    });
  const transport = () => ({
    verificationRef: "verified",
    sendStaffWhatsAppByPhone: async (scope) => {
      await scope.beforeSend();
      state.sent.push(scope);
      return state.providerResult ?? { state: "accepted" };
    },
  });
  const ports = historicalResendPorts({
    query,
    transaction,
    resolveLead: overrides.resolveLead ?? (async () => lead()),
    recipientProof: overrides.recipientProof ?? (async () => proof()),
    transport: overrides.transport ?? transport,
    runtime: () => ({ enabled: true, channelId: CHANNEL, template }),
    channelId: () => CHANNEL,
    origin: () => "https://earnest.example.invalid",
    now: () => new Date("2026-11-25T10:00:00.000Z"),
  });
  return { state, ports };
}

test("preview is PII-minimal and ready on a signed phone proof", async () => {
  const { ports } = harness();
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  assert.equal(preview.ready, true);
  assert.deepEqual(preview.reasons, []);
  assert.equal(preview.transport, "website_lead_phone");
  assert.equal(preview.staffName, "測試同事");
  assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(preview.review);
  assert.equal(preview.review.endpoint.enabled, false);
  assert.equal(preview.review.conflictCounts.crmContacts, 0);
  assert.equal("customerName" in preview, false);
  assert.equal("customerPhone" in preview, false);
  assert.equal("destinationReference" in preview, false);
});

test("preview refuses a disabled historical endpoint only through the proof, never by re-checking it", async () => {
  const { ports } = harness();
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  assert.equal(preview.review.endpoint.enabled, false);
  assert.equal(preview.ready, true);
});

test("preview fails closed for malformed proof evidence", async () => {
  for (const bad of [
    proof({ ready: false, reasons: [] }),
    proof({ ready: true, reasons: undefined }),
    proof({ staffId: ENDPOINT }),
    proof({ endpointVersion: 0 }),
    proof({ transport: "staff_whatsapp" }),
  ]) {
    const { ports } = harness({ recipientProof: async () => bad });
    const preview = await previewHistoricalStaffResend(
      { leadId: LEAD, staffId: STAFF },
      ACTOR,
      ports,
    );
    assert.equal(preview.ready, false, JSON.stringify(bad.ready));
    assert.ok(preview.reasons.length > 0);
  }
});

test("preview refuses a staff member outside the server-calculated historical scope", async () => {
  const { ports } = harness({ resolveLead: async () => ({ ...lead(), staffIds: [ENDPOINT] }) });
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  assert.equal(preview.ready, false);
  assert.ok(preview.reasons.includes("recipient_not_in_historical_scope"));
});

test("preview blocks pending original jobs and a recipient already reached by any alias", async () => {
  const pending = harness();
  pending.state.jobs = [{ id: "job-1" }];
  assert.ok(
    (
      await previewHistoricalStaffResend({ leadId: LEAD, staffId: STAFF }, ACTOR, pending.ports)
    ).reasons.includes("original_jobs_pending"),
  );
  const sent = harness();
  sent.state.attempts = [
    {
      id: "attempt-old",
      dispatch_state: "accepted",
      endpoint_id: ENDPOINT,
      forwarding_recipient_id: null,
      staff_id: STAFF,
      destination_reference: "85291234567",
    },
  ];
  assert.ok(
    (
      await previewHistoricalStaffResend({ leadId: LEAD, staffId: STAFF }, ACTOR, sent.ports)
    ).reasons.includes("recipient_already_sent"),
  );
  const illegible = harness();
  illegible.state.attempts = [
    {
      id: "attempt-unknown",
      dispatch_state: "accepted",
      endpoint_id: null,
      forwarding_recipient_id: null,
      staff_id: null,
      destination_reference: null,
    },
  ];
  assert.ok(
    (
      await previewHistoricalStaffResend({ leadId: LEAD, staffId: STAFF }, ACTOR, illegible.ports)
    ).reasons.includes("duplicate_review_required"),
  );
});

test("dispatch rejects a stale preview fingerprint with 409", async () => {
  const { ports } = harness();
  await assert.rejects(
    () =>
      dispatchHistoricalStaffResend(
        { leadId: LEAD, staffId: STAFF, fingerprint: "d".repeat(64), confirm: true },
        ACTOR,
        ports,
      ),
    (error) => error instanceof Response && error.status === 409,
  );
});

test("dispatch accepts without a provider operation id and is then a permanent duplicate", async () => {
  const { state, ports } = harness();
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  const result = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(result.ok, true);
  assert.equal(result.state, "accepted");
  assert.equal(result.attemptId, state.claimAttempt);
  assert.equal(result.decisionId, state.decisionId);
  assert.equal(state.finalized[2], "accepted");
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].phone, "85291234567");
  const again = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(again.ok, false);
  assert.equal(again.state, "duplicate");
  assert.equal(state.sent.length, 1, "never sends twice");
});

test("a provider operation id is carried through for delivery reconciliation", async () => {
  const { state, ports } = harness();
  state.providerResult = { state: "accepted", providerOperationId: "msg-123" };
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  const result = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(result.ok, true);
  assert.equal(result.providerOperationId, "msg-123");
  assert.equal(state.finalized[4], "msg-123");
});

test("an uncertain provider outcome is unknown permanently, never accepted or failed", async () => {
  const { state, ports } = harness();
  state.providerResult = { state: "unknown" };
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  const result = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(result.ok, false);
  assert.equal(result.state, "unknown");
  assert.equal(state.finalized[2], "unknown");
  const again = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(again.state, "duplicate");
  assert.equal(again.reason, "ledger_unknown_permanent");
  assert.equal(state.sent.length, 1);
});

test("a preflight block before the provider boundary stays suppressed", async () => {
  const { state, ports } = harness({
    transport: () => ({
      verificationRef: "verified",
      sendStaffWhatsAppByPhone: async () => {
        throw Object.assign(new Error("blocked"), { code: "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED" });
      },
    }),
  });
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  const result = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(result.ok, false);
  assert.equal(result.state, "suppressed");
  assert.equal(state.finalized[2], "suppressed");
  assert.equal(state.finalized[5], "transport_preflight_blocked");
});

test("member-targeted rows use the intent recipient, never a mutable inbox id", async () => {
  const ours = harness();
  ours.state.attempts = [
    {
      id: "attempt-member",
      dispatch_state: "accepted",
      notification_id: "77777777-7777-4777-8777-777777777777",
      intent_recipient_staff_id: STAFF,
      endpoint_id: null,
      forwarding_recipient_id: null,
      staff_id: null,
      destination_reference: null,
    },
  ];
  assert.ok(
    (
      await previewHistoricalStaffResend({ leadId: LEAD, staffId: STAFF }, ACTOR, ours.ports)
    ).reasons.includes("recipient_already_sent"),
  );
  const unknownRecipient = harness();
  unknownRecipient.state.attempts = [
    {
      id: "attempt-member-unknown",
      dispatch_state: "accepted",
      notification_id: "77777777-7777-4777-8777-777777777777",
      intent_recipient_staff_id: null,
      endpoint_id: null,
      forwarding_recipient_id: null,
      staff_id: null,
      destination_reference: null,
    },
  ];
  assert.ok(
    (
      await previewHistoricalStaffResend(
        { leadId: LEAD, staffId: STAFF },
        ACTOR,
        unknownRecipient.ports,
      )
    ).reasons.includes("duplicate_review_required"),
  );
  const mutableInbox = harness();
  mutableInbox.state.attempts = [
    {
      id: "attempt-inbox",
      dispatch_state: "accepted",
      notification_id: null,
      endpoint_id: ENDPOINT,
      endpoint_transport: "inbox_private_note",
      forwarding_recipient_id: null,
      staff_id: null,
      destination_reference: "member-1234",
    },
  ];
  assert.ok(
    (
      await previewHistoricalStaffResend(
        { leadId: LEAD, staffId: STAFF },
        ACTOR,
        mutableInbox.ports,
      )
    ).reasons.includes("duplicate_review_required"),
  );
});

const OTHER_STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherRecipient = (overrides = {}) => ({
  id: "other-historical-attempt",
  dispatch_state: "dispatching",
  endpoint_id: ENDPOINT,
  endpoint_transport: "website_lead_phone",
  staff_id: null,
  destination_reference: "85298765432",
  forwarding_recipient_id: null,
  notification_id: null,
  historical_decision_id: "other-decision",
  historical_decision_staff_id: OTHER_STAFF,
  ...overrides,
});

test("two managers approving distinct staff may send in parallel", async () => {
  for (const alias of ["85298765432", "98765432"]) {
    const { state, ports } = harness();
    state.attempts = [
      otherRecipient({
        destination_reference: alias,
        historical_decision_staff_id: OTHER_STAFF,
      }),
    ];
    const preview = await previewHistoricalStaffResend(
      { leadId: LEAD, staffId: STAFF },
      ACTOR,
      ports,
    );
    assert.equal(preview.ready, true, `${alias}: a proven sibling must not block`);
    const result = await dispatchHistoricalStaffResend(
      { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
      ACTOR,
      ports,
    );
    assert.equal(
      result.state,
      "accepted",
      `${alias}: the sibling's dispatch is not a cross-route send`,
    );
    assert.equal(state.sent.length, 1);
  }
});

test("a sibling is proven only by durable decision + distinct staff + distinct frozen phone", async () => {
  const cases = [
    [{ historical_decision_id: null }, "ordinary queued/dispatching attempt"],
    [{ historical_decision_staff_id: STAFF }, "same staff"],
    [{ historical_decision_staff_id: null }, "unknown decision staff"],
    [{ destination_reference: "91234567" }, "same phone through an 8-digit alias"],
    [{ destination_reference: null }, "missing frozen phone"],
    [{ destination_reference: "member-1234" }, "unparseable frozen target"],
  ];
  for (const [overrides, label] of cases) {
    const { state, ports } = harness();
    state.attempts = [otherRecipient(overrides)];
    const preview = await previewHistoricalStaffResend(
      { leadId: LEAD, staffId: STAFF },
      ACTOR,
      ports,
    );
    assert.equal(preview.ready, false, `${label}: must stay fail-closed`);
    assert.ok(preview.reasons.length > 0, label);
    const blocked = await dispatchHistoricalStaffResend(
      {
        leadId: LEAD,
        staffId: STAFF,
        fingerprint: preview.fingerprint ?? "0".repeat(64),
        confirm: true,
      },
      ACTOR,
      ports,
    );
    assert.equal(blocked.state, "blocked", label);
    assert.equal(state.sent.length, 0, label);
  }
});

test("a terminal recipient matches through the canonical HK phone alias", async () => {
  const { state, ports } = harness();
  state.attempts = [
    otherRecipient({
      dispatch_state: "accepted",
      destination_reference: "91234567",
      historical_decision_id: null,
      historical_decision_staff_id: null,
    }),
  ];
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  assert.equal(preview.ready, false);
  assert.ok(preview.reasons.includes("recipient_already_sent"));
});

test("release before the historical migration masks the proof and refuses dispatch", async () => {
  const { state, ports } = harness({
    scanError: Object.assign(new Error('relation "historical_resend_decisions" does not exist'), {
      code: "42P01",
    }),
  });
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  assert.equal(preview.ready, false);
  assert.ok(preview.reasons.includes("historical_migration_pending"));
  assert.equal(preview.fingerprint, null, "no approval token may exist before the migration");
  assert.ok(preview.review, "the masked proof still renders for the reviewer");
  assert.equal(preview.staffName, "測試同事");
  const blocked = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: "0".repeat(64), confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.reason, "historical_migration_pending");
  assert.equal(state.sent.length, 0, "no provider call");
  assert.equal(state.ledger, null, "no attempt/decision claim is written");
});

test("a non-migration read failure propagates instead of being masked", async () => {
  const { ports } = harness({
    scanError: Object.assign(new Error("permission denied for table"), { code: "42501" }),
  });
  await assert.rejects(() =>
    previewHistoricalStaffResend({ leadId: LEAD, staffId: STAFF }, ACTOR, ports),
  );
});

test("a late failure never overwrites an already-reconciled unknown", async () => {
  const { state, ports } = harness({ reconciledUnknown: true });
  state.providerResult = { state: "failed" };
  const preview = await previewHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF },
    ACTOR,
    ports,
  );
  const result = await dispatchHistoricalStaffResend(
    { leadId: LEAD, staffId: STAFF, fingerprint: preview.fingerprint, confirm: true },
    ACTOR,
    ports,
  );
  assert.equal(result.state, "unknown", "the reconciled unknown wins over the late failure");
  assert.equal(result.reason, "ledger_unknown_permanent");
  assert.equal(state.finalized[2], "failed", "the failure was attempted but not stored");
  assert.equal(state.ledger.dispatchState, "unknown");
});

test("only admin and manager may review or dispatch", async () => {
  const { ports } = harness();
  await assert.rejects(
    () =>
      previewHistoricalStaffResend(
        { leadId: LEAD, staffId: STAFF },
        { staffId: ACTOR.staffId, roles: ["agent"] },
        ports,
      ),
    (error) => error instanceof Response && error.status === 403,
  );
});
