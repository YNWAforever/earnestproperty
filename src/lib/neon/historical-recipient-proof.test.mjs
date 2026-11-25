import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  getHistoricalRecipientProof,
  toPublicHistoricalRecipientProof,
} from "./historical-recipient-proof.server.ts";

/**
 * Synthetic-only regression tests. Every fact below is an owned fixture: no
 * production row, repository secret, real phone, member id or customer content.
 * The query port is scripted, so these tests need neither a database nor network.
 */

process.env.WOZTELL_APP_ID = "app_fixture";

const CHANNEL = "channel_fixture";
const STAFF = randomUUID();
const ENDPOINT = randomUUID();
const PHONE = "85291234567";
const MEMBER = "member_fixture_01";
const IDS = {
  consent: randomUUID(),
  allHours: randomUUID(),
  proof: randomUUID(),
};
/** Opaque business authorization: deliberately not a uuid and not a receipt id. */
const COMPANY_APPROVAL = "EP-APPROVAL-FIXTURE-001";

function metadata(overrides = {}) {
  return {
    version: 3,
    timezone: "Asia/Hong_Kong",
    authority: "authenticated_recipient_confirmation",
    transport: "website_lead_phone",
    allowAllHours: false,
    consentReceiptId: IDS.consent,
    allHoursReceiptId: IDS.allHours,
    destinationProofReceiptId: IDS.proof,
    companyApprovalRef: COMPANY_APPROVAL,
    ...overrides,
  };
}

function directoryRow(overrides = {}) {
  return {
    staff_id: STAFF,
    name_zh: "測試同事",
    name_en: "Fixture Staff",
    active: true,
    own_phone: PHONE,
    own_whatsapp: PHONE,
    endpoint_id: ENDPOINT,
    version: 3,
    transport: "website_lead_phone",
    destination: PHONE,
    enabled: false,
    retired_at: null,
    other_directory_claims: 0,
    ...overrides,
  };
}

function receiptRow(id, { member = MEMBER, proofValid = true, attested = true } = {}) {
  return {
    id,
    member_id: member,
    app_id: "app_fixture",
    channel_id: CHANNEL,
    origin: "live_webhook",
    proof_valid: proofValid,
    attested,
  };
}

function reviewRow(overrides = {}) {
  return {
    id: randomUUID(),
    decision: "approved",
    revision: 2,
    conflict_hash: "c".repeat(64),
    approval_valid: true,
    snapshot_conflict_hash: "c".repeat(64),
    ...overrides,
  };
}

function conflictRow(overrides = {}) {
  return {
    crm_contacts: 0,
    same_member_contacts: 0,
    open_conversations: 0,
    other_endpoint_claims: 0,
    member_binding_valid: false,
    ...overrides,
  };
}

function authorityRow(overrides = {}) {
  return {
    id: randomUUID(),
    actor_id: null,
    metadata: metadata(),
    configure_count: 2,
    distinct_company_refs: 1,
    ...overrides,
  };
}

/**
 * Scripted read-only port. Each production query is answered from the scenario;
 * anything unexpected throws, so a new query cannot silently pass.
 */
function port({
  directory = directoryRow(),
  authority = authorityRow(),
  receipts = [receiptRow(IDS.consent), receiptRow(IDS.allHours), receiptRow(IDS.proof)],
  review = reviewRow(),
  conflicts = conflictRow(),
} = {}) {
  const statements = [];
  const query = async (statement) => {
    statements.push(statement);
    if (statement.includes("FROM staff_users s")) return directory === null ? [] : [directory];
    if (statement.includes("FROM audit_logs a")) return authority === null ? [] : [authority];
    if (statement.includes("FROM whatsapp_inbound_receipts")) return receipts;
    if (statement.includes("enquiry_info_phone_approval_valid"))
      return review === null ? [] : [review];
    if (statement.includes("AS same_member_contacts")) return conflicts === null ? [] : [conflicts];
    throw new Error("unexpected query: " + statement.slice(0, 120));
  };
  return { query, statements };
}

async function proof(scenario) {
  const scripted = port(scenario);
  const result = await getHistoricalRecipientProof(STAFF, CHANNEL, scripted.query);
  return { result, statements: scripted.statements };
}

test("full signed evidence and a clean conflict scope make the proof ready", async () => {
  const { result, statements } = await proof();

  assert.equal(result.ready, true);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.review.status, "eligible");
  assert.equal(result.review.mismatch.kind, "none");
  assert.equal(result.staffName, "測試同事");
  assert.equal(result.transport, "website_lead_phone");
  assert.equal(result.endpointVersion, 3);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.maskedDestination, "••••4567");
  assert.equal(result.review.identityReceiptRef, IDS.proof);
  assert.equal(result.review.purposeRef, IDS.consent);
  assert.equal(result.review.hoursReceiptRef, IDS.allHours);
  assert.equal(result.review.allowAllHours, false);
  assert.equal(result.review.hoursApproved, true);
  assert.equal(result.review.staffDirectoryMatch, true);
  assert.deepEqual(result.review.conflictCounts, {
    crmContacts: 0,
    sameMemberContacts: 0,
    openConversations: 0,
    otherStaffEndpoints: 0,
  });
  assert.equal(result.review.receipts.length, 3);
  assert.ok(result.review.receipts.every((receipt) => receipt.verified && receipt.attested));
  assert.equal(
    result.review.receipts.find((receipt) => receipt.kind === "consent").matchedMember,
    true,
  );
  // These recipients were never sent: no attempt history is consulted.
  assert.equal(
    statements.some((statement) => statement.includes("staff_notification_attempts")),
    false,
  );
  // The canonicaliser is the database function, not hand-rolled string logic.
  assert.ok(statements.some((statement) => statement.includes("enquiry_info_member_proof_valid")));
});

test("a guard-disabled endpoint is evidence, not a gate, while a retired endpoint blocks", async () => {
  assert.equal((await proof({ directory: directoryRow({ enabled: false }) })).result.ready, true);

  const retired = await proof({ directory: directoryRow({ retired_at: "2026-11-20T00:00:00Z" }) });
  assert.equal(retired.result.ready, false);
  assert.deepEqual(retired.result.reasons, ["endpoint_retired"]);
  assert.equal(retired.result.review.mismatch.kind, "endpoint_retired");
});

test("the staff.endpoint.configure audit row is the authority for version, literal, timezone and hours", async () => {
  const missing = await proof({ authority: null });
  assert.ok(missing.result.reasons.includes("authority_missing"));
  assert.equal(missing.result.ready, false);

  // actor_id may be NULL for an owner-authorized inbound verification: the
  // authority is the literal plus the endpoint version, not a staff session.
  const ownerAuthorized = await proof({
    authority: authorityRow(),
  });
  assert.equal(ownerAuthorized.result.ready, true);

  const wrongVersion = await proof({
    authority: authorityRow({ metadata: metadata({ version: 2 }) }),
  });
  assert.deepEqual(wrongVersion.result.reasons, ["authority_mismatch"]);

  const wrongLiteral = await proof({
    authority: authorityRow({ metadata: metadata({ authority: "owner_instruction" }) }),
  });
  assert.deepEqual(wrongLiteral.result.reasons, ["authority_mismatch"]);

  const wrongZone = await proof({
    authority: authorityRow({ metadata: metadata({ timezone: "Asia/Singapore" }) }),
  });
  assert.deepEqual(wrongZone.result.reasons, ["timezone_mismatch"]);
});

test("companyApprovalRef is opaque business authorization, never a provider receipt", async () => {
  const { result } = await proof();
  // Not a uuid, not in receipts, and never looked up as an inbound receipt.
  assert.equal(result.review.companyApprovalRef, COMPANY_APPROVAL);
  assert.equal(result.review.companyApprovalProven, true);
  assert.equal(
    result.review.receipts.some((receipt) => receipt.id === COMPANY_APPROVAL),
    false,
  );
  assert.equal(result.review.receipts.length, 3);

  // Presence alone is not provenance: conflicting old audit refs leave it unproven,
  // which is advisory evidence only (it does not fabricate a receipt gate).
  const inconsistent = await proof({
    authority: authorityRow({ configure_count: 3, distinct_company_refs: 2 }),
  });
  assert.equal(inconsistent.result.review.companyApprovalProven, false);
  assert.equal(
    inconsistent.result.review.checks.find((check) => check.id === "company_approval").ok,
    false,
  );
});

test("receipts must be attested and bound by the database canonicaliser", async () => {
  const unboundProof = await proof({
    receipts: [
      receiptRow(IDS.consent),
      receiptRow(IDS.allHours),
      receiptRow(IDS.proof, { proofValid: false }),
    ],
  });
  assert.deepEqual(unboundProof.result.reasons, ["identity_receipt_missing"]);

  const unattestedConsent = await proof({
    receipts: [
      receiptRow(IDS.consent, { attested: false }),
      receiptRow(IDS.allHours),
      receiptRow(IDS.proof),
    ],
  });
  assert.deepEqual(unattestedConsent.result.reasons, ["purpose_receipt_missing"]);

  const unboundHours = await proof({
    receipts: [
      receiptRow(IDS.consent),
      receiptRow(IDS.allHours, { proofValid: false }),
      receiptRow(IDS.proof),
    ],
  });
  assert.deepEqual(unboundHours.result.reasons, ["hours_receipt_missing"]);
});

test("additional hours need allowAllHours or an attested hours receipt", async () => {
  const noHours = port({
    authority: {
      id: randomUUID(),
      actor_id: null,
      metadata: metadata({ allHoursReceiptId: null }),
    },
    receipts: [receiptRow(IDS.consent), receiptRow(IDS.proof)],
  });
  const missing = await getHistoricalRecipientProof(STAFF, CHANNEL, noHours.query);
  assert.deepEqual(missing.reasons, ["hours_receipt_missing"]);
  assert.equal(missing.review.mismatch.kind, "hours_not_approved");

  const allowAll = port({
    authority: {
      id: randomUUID(),
      actor_id: null,
      metadata: metadata({ allowAllHours: true, allHoursReceiptId: null }),
    },
    receipts: [receiptRow(IDS.consent), receiptRow(IDS.proof)],
  });
  const allowed = await getHistoricalRecipientProof(STAFF, CHANNEL, allowAll.query);
  assert.deepEqual(allowed.reasons, []);
  assert.equal(allowed.review.allowAllHours, true);
});

test("a revoked phone review fails closed even when every receipt verifies", async () => {
  const { result } = await proof({
    review: reviewRow({ decision: "revoked", approval_valid: false }),
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ["phone_approval_revoked"]);
  assert.equal(result.review.status, "unresolved");
  assert.equal(result.review.mismatch.requiresManualReview, true);
});

test("the directory phone must be the staff member's own and claimed by nobody else", async () => {
  const mismatched = await proof({
    directory: directoryRow({ own_phone: "85290000000", own_whatsapp: "85290000001" }),
  });
  assert.equal(mismatched.result.ready, false);
  assert.ok(mismatched.result.reasons.includes("directory_mismatch"));

  const otherStaffClaims = await proof({ directory: directoryRow({ other_directory_claims: 1 }) });
  assert.equal(otherStaffClaims.result.ready, false);
  assert.ok(otherStaffClaims.result.reasons.includes("shared_phone"));

  const otherEndpointClaims = await proof({ conflicts: conflictRow({ other_endpoint_claims: 1 }) });
  assert.equal(otherEndpointClaims.result.ready, false);
  assert.deepEqual(otherEndpointClaims.result.reasons, ["shared_phone"]);
  assert.equal(otherEndpointClaims.result.review.sharedPhone, true);
});

test("provably misprojected same-member CRM is resolved, not a customer conflict", async () => {
  const sameMember = {
    crm_contacts: 2,
    same_member_contacts: 2,
    open_conversations: 0,
    member_binding_valid: true,
  };
  const bound = await proof({ conflicts: conflictRow(sameMember) });
  assert.equal(bound.result.ready, true);
  assert.deepEqual(bound.result.reasons, []);
  assert.equal(bound.result.review.conflictCounts.crmContacts, 2);
  assert.equal(bound.result.review.conflictCounts.sameMemberContacts, 2);

  // Same-member alone is not enough: without a still-current scoped review it stays
  // unresolved even though every conflicting contact is the staff member's own.
  const unproven = await proof({
    conflicts: conflictRow({ ...sameMember, member_binding_valid: false }),
    review: reviewRow({ decision: null, approval_valid: false }),
  });
  assert.equal(unproven.result.ready, false);
  assert.deepEqual(unproven.result.reasons, ["conflict_unresolved"]);
  assert.equal(unproven.result.review.mismatch.requiresManualReview, true);
});

test("a different old CRM holder stays unresolved without a still-current scoped review", async () => {
  const differentHolder = {
    crm_contacts: 1,
    same_member_contacts: 0,
    open_conversations: 0,
    member_binding_valid: false,
  };
  const invalidReview = await proof({
    conflicts: conflictRow(differentHolder),
    review: reviewRow({ decision: null, approval_valid: false }),
  });
  assert.equal(invalidReview.result.ready, false);
  assert.deepEqual(invalidReview.result.reasons, ["conflict_unresolved"]);

  const staleHash = await proof({
    conflicts: conflictRow(differentHolder),
    review: reviewRow({ snapshot_conflict_hash: "d".repeat(64) }),
  });
  assert.equal(staleHash.result.ready, false, "the approval must bind the same conflict scope");
  assert.deepEqual(staleHash.result.reasons, ["conflict_unresolved"]);

  const reviewed = await proof({ conflicts: conflictRow(differentHolder) });
  assert.equal(
    reviewed.result.ready,
    true,
    "an authenticated per-purpose review resolves this one purpose",
  );
  assert.equal(reviewed.result.review.conflictHash, "c".repeat(64));
});

test("an inactive staff member, a missing endpoint and the wrong transport are refused", async () => {
  const inactive = await proof({ directory: directoryRow({ active: false }) });
  assert.equal(inactive.result.ready, false);
  assert.ok(inactive.result.reasons.includes("staff_inactive"));

  const noEndpoint = await proof({ directory: directoryRow({ endpoint_id: null, version: null }) });
  assert.deepEqual(noEndpoint.result.reasons, ["endpoint_missing"]);

  const wrongTransport = await proof({
    directory: directoryRow({ transport: "inbox_private_note" }),
  });
  assert.equal(wrongTransport.result.ready, false);
  assert.ok(wrongTransport.result.reasons.includes("transport_not_reviewed_phone"));
});

test("the fingerprint is stable across re-reads and changes with the proof facts", async () => {
  const first = await proof();
  const second = await proof();
  assert.equal(first.result.fingerprint, second.result.fingerprint);

  const drifted = await proof({
    review: reviewRow({ snapshot_conflict_hash: "e".repeat(64), conflict_hash: "e".repeat(64) }),
  });
  assert.notEqual(drifted.result.fingerprint, first.result.fingerprint);

  const movedDestination = await proof({ directory: directoryRow({ destination: "85298765432" }) });
  assert.notEqual(movedDestination.result.fingerprint, first.result.fingerprint);
});

test("the browser projection never carries the raw phone or member id", async () => {
  const { result } = await proof();
  const safe = toPublicHistoricalRecipientProof(result);
  const serialised = JSON.stringify(safe);

  assert.equal("destinationReference" in safe, false);
  assert.equal(serialised.includes(PHONE), false);
  assert.equal(serialised.includes(MEMBER), false);
  assert.equal(safe.eligible, true);
  assert.equal(safe.maskedDestination, "••••4567");
  assert.equal(safe.review.mismatch.kind, "none");
  assert.equal(safe.review.allowAllHours, false);
  assert.equal(safe.review.identityReceiptRef, IDS.proof);
  assert.equal(safe.review.purposeRef, IDS.consent);
  assert.equal(safe.review.hoursReceiptRef, IDS.allHours);
  assert.deepEqual(Object.keys(safe.review.conflictCounts), [
    "crmContacts",
    "sameMemberContacts",
    "openConversations",
    "otherStaffEndpoints",
  ]);
});

test("invalid identifiers fail closed without touching the database", async () => {
  let called = 0;
  const query = async () => {
    called += 1;
    return [];
  };
  await assert.rejects(
    getHistoricalRecipientProof("not-a-uuid", CHANNEL, query),
    /HISTORICAL_PROOF_STAFF_INVALID/,
  );
  await assert.rejects(
    getHistoricalRecipientProof(STAFF, "bad channel id", query),
    /HISTORICAL_PROOF_CHANNEL_INVALID/,
  );
  assert.equal(called, 0);
});
