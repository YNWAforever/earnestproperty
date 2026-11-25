import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  getHistoricalRecipientProof,
  toPublicHistoricalRecipientProof,
} from "./historical-recipient-proof.server.ts";

/**
 * Synthetic-only regression tests: owned fixtures, a scripted read-only query port, no
 * database and no network. The reviewed evidence is injected as a digest Set through
 * the server-only 4th argument; production uses the committed immutable Set.
 */

process.env.WOZTELL_APP_ID = "owned_review_app";
const CHANNEL = "channel_fixture";
const STAFF = randomUUID();
const ENDPOINT = randomUUID();
const PHONE = "85291234567";
const MEMBER = "member_fixture_01";
const COMPANY_APPROVAL = "EP-APPROVAL-FIXTURE-001";
const BODY = Object.fromEntries(
  ["consent", "hours", "proof", "first"].map((tag) => [
    tag,
    createHash("sha256")
      .update("body:" + tag)
      .digest("hex"),
  ]),
);
const IDS = {
  consent: randomUUID(),
  allHours: randomUUID(),
  proof: randomUUID(),
  first: randomUUID(),
};

/** Mirrors the committed digest contract shared with production. */
function digest(role, receiptId, bodyDigest, staffId = STAFF) {
  return createHash("sha256")
    .update(
      [
        "historical-recipient-evidence:v1",
        role,
        staffId.toLowerCase(),
        receiptId.toLowerCase(),
        bodyDigest,
      ].join("\n"),
    )
    .digest("hex");
}

const FULL_REVIEW = new Set([
  digest("identity", IDS.proof, BODY.proof),
  digest("consent", IDS.consent, BODY.consent),
  digest("hours", IDS.allHours, BODY.hours),
  digest("first_confirmation", IDS.first, BODY.first),
]);

function metadata(overrides = {}) {
  return {
    version: 3,
    timezone: "Asia/Hong_Kong",
    authority: "authenticated_recipient_confirmation",
    transport: "website_lead_phone",
    allowAllHours: true,
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
    permission_granted: true,
    permission_ref: `recipient-consent:${IDS.consent}`,
    verification_ref: `accepted-ingress:${IDS.proof}`,
    quiet_hours_policy: { approved: true, allowAllHours: true, timezone: "Asia/Hong_Kong" },
    other_directory_claims: 0,
    ...overrides,
  };
}

function receiptRow(id, bodyDigest, { member = MEMBER, proofValid = true } = {}) {
  return { id, member_id: member, body_digest: bodyDigest, proof_valid: proofValid };
}

function reviewRow(overrides = {}) {
  return {
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
    contact_leads: 0,
    contact_inquiries: 0,
    projection_links: 0,
    member_binding_valid: false,
    ...overrides,
  };
}

function port({
  directory = directoryRow(),
  authority = {
    id: randomUUID(),
    actor_id: null,
    metadata: metadata(),
    configure_count: 2,
    distinct_company_refs: 1,
  },
  receipts = [
    receiptRow(IDS.consent, BODY.consent),
    receiptRow(IDS.allHours, BODY.hours),
    receiptRow(IDS.proof, BODY.proof),
  ],
  firstIngress = { id: IDS.first, member_id: MEMBER, body_digest: BODY.first },
  review = reviewRow(),
  conflicts = conflictRow(),
} = {}) {
  const query = async (statement) => {
    if (statement.includes("FROM staff_users s")) return directory === null ? [] : [directory];
    if (statement.includes("FROM audit_logs a")) return authority === null ? [] : [authority];
    if (statement.includes("AS same_member_contacts")) return conflicts === null ? [] : [conflicts];
    if (statement.includes("ORDER BY r.received_at ASC"))
      return firstIngress === null ? [] : [firstIngress];
    if (statement.includes("FROM whatsapp_inbound_receipts")) return receipts;
    if (statement.includes("enquiry_info_phone_approval_valid"))
      return review === null ? [] : [review];
    throw new Error("unexpected query: " + statement.slice(0, 120));
  };
  return query;
}

function proof(scenario, digests = FULL_REVIEW) {
  return getHistoricalRecipientProof(STAFF, CHANNEL, port(scenario), digests);
}

test("reviewed digests, an all-hours policy and matching refs make the proof ready", async () => {
  const result = await proof();

  assert.equal(result.ready, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.review.status, "eligible");
  assert.equal(result.review.mismatch.kind, "none");
  assert.equal(result.review.conflictResolution, "clear");
  assert.equal(result.review.allowAllHours, true);
  assert.equal(result.review.hoursApproved, true);
  assert.equal(result.review.companyApprovalProven, true);
  assert.equal(result.review.firstConfirmationFrozen, true);
  assert.equal(result.maskedDestination, "••••4567");
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(
    result.review.receipts.every(
      (receipt) => receipt.verified && receipt.frozen && receipt.attested,
    ),
  );
});

test("unreviewed or tampered digests block; text alone attests nothing", async () => {
  const unreviewed = await proof({}, new Set());
  assert.deepEqual(unreviewed.reasons, [
    "identity_receipt_missing",
    "purpose_receipt_missing",
    "hours_not_approved",
  ]);

  const tampered = await proof({
    receipts: [
      receiptRow(IDS.consent, BODY.consent),
      receiptRow(IDS.allHours, BODY.hours),
      receiptRow(IDS.proof, "a".repeat(64)),
    ],
  });
  assert.ok(tampered.reasons.includes("identity_receipt_missing"));
});

test("hours need the policy, the audit approval and a frozen receipt together", async () => {
  const noFlag = await proof({
    authority: {
      id: randomUUID(),
      actor_id: null,
      metadata: metadata({ allowAllHours: false }),
      configure_count: 2,
      distinct_company_refs: 1,
    },
  });
  assert.ok(noFlag.reasons.includes("hours_not_approved"));

  const noPolicy = await proof({
    directory: directoryRow({ quiet_hours_policy: { approved: false, allowAllHours: true } }),
  });
  assert.ok(noPolicy.reasons.includes("hours_not_approved"));

  const noReceipt = await proof({
    receipts: [receiptRow(IDS.consent, BODY.consent), receiptRow(IDS.proof, BODY.proof)],
  });
  assert.ok(noReceipt.reasons.includes("hours_not_approved"));
});

test("a guard-disabled endpoint is evidence, not a gate; a retired endpoint blocks", async () => {
  assert.equal((await proof({ directory: directoryRow({ enabled: false }) })).ready, true);

  const retired = await proof({ directory: directoryRow({ retired_at: "2026-11-20T00:00:00Z" }) });
  assert.deepEqual(retired.reasons, ["endpoint_retired"]);
});

test("authority version, literal, zone, refs and company provenance are enforced", async () => {
  const base = {
    id: randomUUID(),
    actor_id: null,
    metadata: metadata(),
    configure_count: 2,
    distinct_company_refs: 1,
  };
  for (const [overrides, expected] of [
    [{ metadata: metadata({ version: 2 }) }, "authority_mismatch"],
    [{ metadata: metadata({ authority: "owner_instruction" }) }, "authority_mismatch"],
    [{ metadata: metadata({ timezone: "Asia/Singapore" }) }, "authority_mismatch"],
    [{ distinct_company_refs: 2 }, "company_approval_missing"],
  ]) {
    const result = await proof({ authority: { ...base, ...overrides } });
    assert.ok(result.reasons.includes(expected), expected);
  }

  const identityMismatch = await proof({
    directory: directoryRow({ verification_ref: randomUUID() }),
  });
  assert.ok(identityMismatch.reasons.includes("identity_receipt_missing"));

  const purposeMismatch = await proof({
    directory: directoryRow({ permission_ref: "unsigned-ref" }),
  });
  assert.ok(purposeMismatch.reasons.includes("purpose_receipt_missing"));

  const policyZone = await proof({
    directory: directoryRow({
      quiet_hours_policy: { approved: true, allowAllHours: true, timezone: "Asia/Singapore" },
    }),
  });
  assert.ok(policyZone.reasons.includes("authority_mismatch"));

  const noAuthority = await proof({ authority: null });
  assert.ok(noAuthority.reasons.includes("authority_missing"));
});

test("the directory phone must be the staff member's own and claimed by nobody else", async () => {
  const mismatched = await proof({
    directory: directoryRow({ own_phone: "85290000000", own_whatsapp: "85290000001" }),
  });
  assert.ok(mismatched.reasons.includes("directory_mismatch"));

  const otherStaff = await proof({ directory: directoryRow({ other_directory_claims: 1 }) });
  assert.ok(otherStaff.reasons.includes("shared_phone"));

  const otherEndpoint = await proof({ conflicts: conflictRow({ other_endpoint_claims: 1 }) });
  assert.deepEqual(otherEndpoint.reasons, ["shared_phone"]);
});

test("a revoked phone review fails closed even with every receipt reviewed", async () => {
  const result = await proof({ review: reviewRow({ decision: "revoked", approval_valid: false }) });
  assert.deepEqual(result.reasons, ["phone_approval_revoked"]);
  assert.equal(result.review.status, "unresolved");
});

test("same-member CRM closes only with the frozen first confirmation and its exact projection", async () => {
  const sameMember = {
    crm_contacts: 1,
    same_member_contacts: 1,
    open_conversations: 1,
    contact_leads: 1,
    contact_inquiries: 1,
    projection_links: 1,
    member_binding_valid: true,
  };
  const projected = await proof({ conflicts: conflictRow(sameMember) });
  assert.equal(projected.ready, true);
  assert.equal(projected.review.conflictResolution, "staff_confirmation_projection");

  for (const broken of [{ projection_links: 0 }, { contact_leads: 2 }, { contact_inquiries: 0 }]) {
    const result = await proof({
      conflicts: conflictRow({ ...sameMember, ...broken }),
      review: reviewRow({ decision: null, approval_valid: false }),
    });
    assert.equal(result.review.conflictResolution, "unresolved", JSON.stringify(broken));
    assert.ok(result.reasons.includes("conflict_unresolved"));
  }

  const unfrozen = await proof({
    conflicts: conflictRow(sameMember),
    firstIngress: { id: randomUUID(), member_id: MEMBER, body_digest: BODY.first },
    review: reviewRow({ decision: null, approval_valid: false }),
  });
  assert.ok(unfrozen.reasons.includes("first_confirmation_missing"));
});

test("a different old CRM holder resolves only through a still-current scoped approval", async () => {
  const differentHolder = {
    crm_contacts: 1,
    same_member_contacts: 0,
    open_conversations: 0,
    contact_leads: 0,
    contact_inquiries: 0,
    projection_links: 0,
    member_binding_valid: false,
  };
  const reviewed = await proof({ conflicts: conflictRow(differentHolder) });
  assert.equal(reviewed.ready, true);
  assert.equal(reviewed.review.conflictResolution, "current_phone_approval");

  const stale = await proof({
    conflicts: conflictRow(differentHolder),
    review: reviewRow({ snapshot_conflict_hash: "d".repeat(64) }),
  });
  assert.equal(stale.review.conflictResolution, "unresolved");
  assert.ok(stale.reasons.includes("conflict_unresolved"));
});

test("the fingerprint is stable across re-reads and changes with the facts", async () => {
  const first = await proof();
  const second = await proof();
  assert.equal(first.fingerprint, second.fingerprint);

  const moved = await proof({ directory: directoryRow({ destination: "85298765432" }) });
  assert.notEqual(moved.fingerprint, first.fingerprint);
});

test("the browser projection carries no raw phone, member id or opaque approval", async () => {
  const result = await proof();
  const serialised = JSON.stringify(toPublicHistoricalRecipientProof(result));

  assert.equal(serialised.includes(PHONE), false);
  assert.equal(serialised.includes(MEMBER), false);
  assert.equal(serialised.includes(COMPANY_APPROVAL), false);
  for (const id of Object.values(IDS)) assert.equal(serialised.includes(id), false);
  assert.equal(serialised.includes(result.endpointId), false);
  assert.equal(result.maskedDestination, "••••4567");
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
    getHistoricalRecipientProof(STAFF, "bad channel", query),
    /HISTORICAL_PROOF_CHANNEL_INVALID/,
  );
  assert.equal(called, 0);
});
