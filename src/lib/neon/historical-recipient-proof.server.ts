import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { queryRows, type DbRow } from "./db.server.ts";
import {
  maskHistoricalIdentifier,
  type HistoricalConflictCounts,
  type HistoricalConflictResolution,
  type HistoricalMismatch,
  type HistoricalMismatchKind,
  type HistoricalProofReceipt,
  type HistoricalProofReasonCode,
  type HistoricalProofReview,
  type HistoricalRecipientProof,
  type HistoricalRecipientProofPublic,
} from "./historical-recipient-proof.types.ts";

/**
 * Read-only proof for ONE reviewed staff phone recipient on the company channel.
 *
 * Evidence: staff directory (active, canonical own phone), the website_lead_phone
 * endpoint (permission grant/ref and quiet-hours policy), the latest
 * `staff.endpoint.configure` audit row (authority literal, endpoint version,
 * timezone, allowAllHours, opaque companyApprovalRef and THREE receipt uuids), and
 * the scoped phone review (enquiry_info_head + snapshot + approval_valid).
 *
 * Attestation is frozen human review: sha256(role/staffId/receiptId/bodyDigest) listed
 * in HISTORICAL_FROZEN_EVIDENCE for this one fixed batch. Non-empty text is nothing.
 * Missing or unknown evidence blocks. Nothing is written, claimed or sent; customer
 * text is never read into a response.
 */

const AUTHORITY = "authenticated_recipient_confirmation";
const TZ = "Asia/Hong_Kong";
const TRANSPORT = "website_lead_phone";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL = /^[A-Za-z0-9_-]{1,160}$/;
const RECEIPT_KINDS = ["consent", "all_hours", "destination_proof"] as const;
const RECEIPT_KEYS = [
  "consentReceiptId",
  "allHoursReceiptId",
  "destinationProofReceiptId",
] as const;
const COMPANY_APPROVAL_MAX = 200;

export class HistoricalRecipientProofError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "HistoricalRecipientProofError";
    this.code = code;
  }
}

type QueryRows = typeof queryRows;
/** Server-side receipt fact: the id stays internal and never reaches `review`. */
type ReceiptFact = HistoricalProofReceipt & { id: string };
type Endpoint = {
  id: string;
  version: number;
  transport: string;
  destination: string;
  enabled: boolean;
  retired: boolean;
  permissionGranted: boolean;
  permissionRef: string | null;
  hoursPolicyApproved: boolean;
  policyTimezoneOk: boolean;
  verificationRef: string | null;
};
type Facts = {
  staffId: string;
  channelId: string;
  staffName: string;
  staffActive: boolean;
  directoryMatch: boolean;
  endpoint: Endpoint | null;
  authority: {
    version: number;
    timezone: string;
    authority: string;
    transport: string;
    allowAllHours: boolean;
    consentReceiptId: string | null;
    allHoursReceiptId: string | null;
    destinationProofReceiptId: string | null;
    companyApprovalRef: string | null;
    companyApprovalProven: boolean;
  } | null;
  receipts: ReceiptFact[];
  memberId: string | null;
  phoneReview: {
    decision: string;
    revision: number;
    valid: boolean;
    conflictHash: string;
    snapshotConflictHash: string;
  };
  conflicts: HistoricalConflictCounts;
  firstConfirmation: { receiptId: string; memberMatched: boolean; frozen: boolean } | null;
  exactFirstProjection: boolean;
};

const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const bool = (value: unknown) => value === true;
const num = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const uuid = (value: unknown): string | null => {
  const candidate = text(value);
  return candidate !== null && UUID.test(candidate) ? candidate.toLowerCase() : null;
};
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const digits = (value: string | null): string => (value ?? "").replace(/\D/g, "");

function companyAppId(): string | null {
  const value = process.env.WOZTELL_APP_ID?.trim();
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

/**
 * Committed, human-reviewed evidence for this one fixed batch. Digests only, no PII.
 * An entry is sha256("historical-recipient-evidence:v1\n<role>\n<staffId>\n<receiptId>\n<bodyDigest>")
 * with role in identity|consent|hours|first_confirmation.
 *
 * Immutable by construction: these are the reviewed receipts, not operator config.
 * Isolated tests may inject their own set through the optional 4th argument.
 */
const REVIEWED_EVIDENCE_DIGESTS: ReadonlySet<string> = new Set<string>([
  // 張: consent, identity(destination proof), hours.
  "e8446505feab9c88a7b9b7eaa8b5edc56e5b2dfd89953b4f452ebb43baab4a75",
  "1ec277146bc90d0f54523d300924a748576f98a2f34600f6e2faeaf3dec4ecbd",
  "a8dc3a804899e486411634ebe38997f88e60be7e099963e030944b3dbe809db9",
  // 李: consent, identity(destination proof), hours, plus the only first-confirmation override.
  "82e81aa3c418c939cabcc800eab19d4637bc124051b5e5da95ce4d109d16b747",
  "f600a9325f4809b35cc582d75cb4680e8618f01c9df9bcb44c6e4027da3ecd74",
  "a0d63102a18a1133efefa44d99f2524fbe35ae0e7492edc9ed46e54b90a3dcbe",
  "0b1d0262560919dbabfffce0a1e84904978b9743fbc1d773522389acbaed1973",
]);

function frozenDigest(
  role: string,
  staffId: string,
  receiptId: string,
  bodyDigest: string,
): string {
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

function isFrozen(
  digests: ReadonlySet<string>,
  role: string,
  staffId: string,
  receiptId: string,
  bodyDigest: string | null,
): boolean {
  if (!bodyDigest || !/^[a-f0-9]{64}$/i.test(bodyDigest)) return false;
  return digests.has(frozenDigest(role, staffId, receiptId, bodyDigest.toLowerCase()));
}

/** Stable sha256 over canonical facts; no timestamps, prose or text. */
function fingerprint(facts: Facts, resolution: HistoricalConflictResolution): string {
  return createHash("sha256")
    .update(
      [
        "historical-recipient-proof:v1",
        facts.staffId,
        facts.channelId,
        facts.endpoint?.id ?? "none",
        String(facts.endpoint?.version ?? 0),
        digits(facts.endpoint?.destination ?? ""),
        facts.memberId ?? "none",
        facts.receipts
          .map(
            (receipt) =>
              `${receipt.kind}:${receipt.id}:${receipt.verified ? 1 : 0}:${receipt.frozen ? 1 : 0}`,
          )
          .sort()
          .join(",") || "none",
        facts.endpoint?.permissionRef ?? "no-permission-ref",
        facts.firstConfirmation?.receiptId ?? "no-first-confirmation",
        facts.firstConfirmation?.frozen
          ? "first-confirmation-frozen"
          : "first-confirmation-unfrozen",
        facts.authority?.allowAllHours ? "all-hours" : "no-all-hours",
        facts.authority?.companyApprovalRef ?? "no-company-approval",
        facts.phoneReview.decision || "no-review",
        String(facts.phoneReview.revision),
        facts.phoneReview.valid ? "review-valid" : "review-invalid",
        String(facts.conflicts.crmContacts),
        String(facts.conflicts.sameMemberContacts),
        String(facts.conflicts.openConversations),
        String(facts.conflicts.otherStaffEndpoints),
        facts.phoneReview.conflictHash,
        resolution,
      ].join("\n"),
    )
    .digest("hex");
}

async function readDirectoryAndEndpoint(staffId: string, channelId: string, query: QueryRows) {
  const [row] = await query(
    `SELECT s.id AS staff_id,s.name_zh,s.name_en,s.active,
       enquiry_notification_phone(s.phone) AS own_phone,
       enquiry_notification_phone(s.whatsapp) AS own_whatsapp,
       ep.id AS endpoint_id,ep.version,ep.transport,
       enquiry_notification_phone(ep.destination_reference) AS destination,
       ep.enabled,ep.retired_at,ep.permission_granted,ep.permission_ref,ep.verification_ref,ep.quiet_hours_policy,
       (SELECT count(*) FROM staff_users u WHERE u.active AND u.id<>s.id
          AND ep.destination_reference IS NOT NULL
          AND (enquiry_notification_phone(u.phone)=enquiry_notification_phone(ep.destination_reference)
            OR enquiry_notification_phone(u.whatsapp)=enquiry_notification_phone(ep.destination_reference))) AS other_directory_claims
     FROM staff_users s
     LEFT JOIN LATERAL (
       SELECT e.* FROM staff_notification_endpoints e
       WHERE e.staff_id=s.id AND e.channel_id=$2 AND e.transport=$3
       ORDER BY (e.retired_at IS NULL) DESC,e.version DESC,e.updated_at DESC,e.id DESC LIMIT 1
     ) ep ON true
     WHERE s.id=$1::uuid`,
    [staffId, channelId, TRANSPORT],
  );
  return row ?? null;
}

async function readAuthority(endpointId: string, query: QueryRows): Promise<DbRow | null> {
  const [row] = await query(
    `SELECT a.metadata,
       (SELECT count(*) FROM audit_logs b WHERE b.action='staff.endpoint.configure'
          AND b.subject_type='staff_endpoint' AND b.subject_id=$1::uuid) AS configure_count,
       (SELECT count(DISTINCT b.metadata->>'companyApprovalRef') FROM audit_logs b
          WHERE b.action='staff.endpoint.configure' AND b.subject_type='staff_endpoint'
            AND b.subject_id=$1::uuid AND b.metadata->>'companyApprovalRef' IS NOT NULL) AS distinct_company_refs
     FROM audit_logs a
     WHERE a.action='staff.endpoint.configure' AND a.subject_type='staff_endpoint' AND a.subject_id=$1::uuid
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,
    [endpointId],
  );
  return row ?? null;
}

async function readReceipts(
  ids: readonly (string | null)[],
  staffId: string,
  digests: ReadonlySet<string>,
  appId: string | null,
  channelId: string,
  phone: string,
  query: QueryRows,
): Promise<{ receipts: ReceiptFact[]; memberId: string | null }> {
  const wanted = RECEIPT_KINDS.map((kind, index) => ({ kind, id: ids[index] })).filter(
    (entry): entry is { kind: HistoricalProofReceipt["kind"]; id: string } => entry.id !== null,
  );
  if (wanted.length === 0) return { receipts: [], memberId: null };
  const rows = await query(
    `SELECT r.id,r.member_id,r.body_digest,
       enquiry_info_member_proof_valid(jsonb_build_object('kind','accepted_ingress','receiptId',r.id),
         $2::text,$3::text,$4::text,r.member_id) AS proof_valid
     FROM whatsapp_inbound_receipts r WHERE r.id=ANY($1::uuid[])`,
    [wanted.map((entry) => entry.id), appId, channelId, phone],
  );
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
  const memberId = text(
    byId.get(wanted.find((entry) => entry.kind === "destination_proof")?.id ?? "")?.member_id,
  );
  const role = (kind: HistoricalProofReceipt["kind"]) =>
    kind === "consent" ? "consent" : kind === "all_hours" ? "hours" : "identity";
  return {
    memberId,
    receipts: wanted.map((entry) => {
      const row = byId.get(entry.id);
      const reviewed = isFrozen(
        digests,
        role(entry.kind),
        staffId,
        entry.id,
        text(row?.body_digest),
      );
      return {
        kind: entry.kind,
        id: entry.id,
        verified: bool(row?.proof_valid),
        matchedMember: memberId !== null && text(row?.member_id) === memberId,
        matchedPhone: bool(row?.proof_valid),
        frozen: reviewed,
        attested: reviewed,
      };
    }),
  };
}

/** Earliest signed ingress FROM this phone on the channel: the first staff confirmation. */
async function readFirstConfirmation(
  staffId: string,
  digests: ReadonlySet<string>,
  appId: string | null,
  channelId: string,
  phone: string,
  memberId: string | null,
  query: QueryRows,
): Promise<{ receiptId: string; memberMatched: boolean; frozen: boolean } | null> {
  if (!appId || phone === "") return null;
  const [row] = await query(
    `SELECT r.id,r.member_id,r.body_digest
     FROM whatsapp_inbound_receipts r
     WHERE r.app_id=$1 AND r.channel_id=$2 AND r.origin='live_webhook'
       AND enquiry_notification_phone(r.normalized_event->>'fromPhone')=$3
     ORDER BY r.received_at ASC,r.id ASC LIMIT 1`,
    [appId, channelId, phone],
  );
  if (!row?.id) return null;
  const receiptId = String(row.id);
  return {
    receiptId,
    memberMatched: memberId !== null && text(row.member_id) === memberId,
    frozen: isFrozen(digests, "first_confirmation", staffId, receiptId, text(row.body_digest)),
  };
}

async function readPhoneReview(
  appId: string | null,
  channelId: string,
  phone: string,
  query: QueryRows,
): Promise<DbRow | null> {
  if (!appId || phone === "") return null;
  const [row] = await query(
    `WITH scoped AS (SELECT enquiry_info_head($1,$2,'recipient_phone',$3) AS head,
       enquiry_info_phone_snapshot($1,$2,$3) AS snapshot)
     SELECT (head).decision AS decision,(head).revision AS revision,(head).conflict_hash AS conflict_hash,
       CASE WHEN (head).id IS NULL THEN false ELSE enquiry_info_phone_approval_valid((head).id) END AS approval_valid,
       snapshot->>'conflictHash' AS snapshot_conflict_hash
     FROM scoped`,
    [appId, channelId, phone],
  );
  return row ?? null;
}

async function readConflicts(
  phone: string,
  memberId: string | null,
  staffId: string,
  channelId: string,
  firstReceiptId: string | null,
  query: QueryRows,
): Promise<DbRow | null> {
  const [row] = await query(
    `WITH first_receipt AS (SELECT * FROM whatsapp_inbound_receipts WHERE id=$5::uuid)
     SELECT
       (SELECT count(*) FROM crm_contacts c WHERE enquiry_notification_phone(c.normalized_phone)=$1
          OR ($2::text IS NOT NULL AND c.whatsapp_member_id=$2)) AS crm_contacts,
       (SELECT count(*) FROM crm_contacts c WHERE $2::text IS NOT NULL AND c.whatsapp_member_id=$2) AS same_member_contacts,
       (SELECT count(*) FROM whatsapp_conversations w WHERE w.channel_id=$3
          AND $2::text IS NOT NULL AND w.woztell_member_id=$2) AS open_conversations,
       (SELECT count(*) FROM staff_notification_endpoints e WHERE e.channel_id=$3 AND e.staff_id<>$4::uuid
          AND e.retired_at IS NULL AND enquiry_notification_phone(e.destination_reference)=$1) AS other_endpoint_claims,
       (SELECT count(*) FROM crm_leads l JOIN crm_contacts c ON c.id=l.contact_id
          WHERE $2::text IS NOT NULL AND c.whatsapp_member_id=$2) AS contact_leads,
       (SELECT count(*) FROM inquiries i JOIN crm_contacts c ON c.id=i.crm_contact_id
          WHERE $2::text IS NOT NULL AND c.whatsapp_member_id=$2) AS contact_inquiries,
       (SELECT count(*) FROM first_receipt r
          JOIN crm_contacts c ON c.whatsapp_member_id=r.member_id
             AND enquiry_notification_phone(c.normalized_phone)=$1
             AND c.created_at>=r.received_at AND c.created_at<r.received_at+interval '1 minute'
          JOIN crm_leads l ON l.contact_id=c.id AND l.source='whatsapp'
            AND l.created_at=(r.normalized_event->>'timestamp')::timestamptz
          JOIN whatsapp_messages m ON m.contact_id=c.id AND m.woztell_member_id=r.member_id
            AND m.channel_id=r.channel_id AND m.created_at=l.created_at
            AND m.text=r.normalized_event->>'text'
          JOIN whatsapp_conversations w ON w.id=m.conversation_id AND w.channel_id=r.channel_id AND w.woztell_member_id=r.member_id
           JOIN inquiries i ON i.crm_contact_id=c.id AND i.intake_message_id=m.id AND i.source='whatsapp') AS projection_links,
       EXISTS(SELECT 1 FROM enquiry_forwarding_decisions d WHERE $2::text IS NOT NULL
          AND d.subject_kind='sender_member' AND d.member_id=$2 AND d.decision='staff_bound'
          AND enquiry_info_member_binding_valid(d.id)) AS member_binding_valid`,
    [phone, memberId, channelId, staffId, firstReceiptId],
  );
  return row ?? null;
}

export async function getHistoricalRecipientProof(
  staffId: string,
  channelId: string,
  query: QueryRows = queryRows,
  digests: ReadonlySet<string> = REVIEWED_EVIDENCE_DIGESTS,
): Promise<HistoricalRecipientProof> {
  if (!UUID.test(staffId))
    throw new HistoricalRecipientProofError("HISTORICAL_PROOF_STAFF_INVALID");
  if (!CHANNEL.test(channelId))
    throw new HistoricalRecipientProofError("HISTORICAL_PROOF_CHANNEL_INVALID");

  const appId = companyAppId();
  const row = await readDirectoryAndEndpoint(staffId, channelId, query);
  const staffName = text(row?.name_zh) || text(row?.name_en) || "";
  const destination = text(row?.destination) ?? "";
  const policy = record(row?.quiet_hours_policy);
  const endpoint: Endpoint | null = row?.endpoint_id
    ? {
        id: String(row.endpoint_id),
        version: num(row.version),
        transport: text(row.transport) ?? "",
        destination,
        enabled: bool(row.enabled),
        retired: row.retired_at !== null && row.retired_at !== undefined,
        permissionGranted: bool(row.permission_granted),
        permissionRef: text(row.permission_ref)?.trim() || null,
        hoursPolicyApproved: bool(policy.approved) && bool(policy.allowAllHours),
        policyTimezoneOk: text(policy.timezone) === null || text(policy.timezone) === TZ,
        verificationRef: text(row.verification_ref)?.trim() || null,
      }
    : null;

  const authorityRow = endpoint ? await readAuthority(endpoint.id, query) : null;
  const metadata = record(authorityRow?.metadata);
  const rawApproval = text(metadata.companyApprovalRef)?.trim() ?? null;
  const companyApprovalRef =
    rawApproval !== null && rawApproval.length > 0 && rawApproval.length <= COMPANY_APPROVAL_MAX
      ? rawApproval
      : null;
  const receiptIds = RECEIPT_KEYS.map(
    (key) =>
      uuid(metadata[key]) ??
      (key === "destinationProofReceiptId" ? uuid(metadata.verificationReceiptId) : null),
  );
  const receiptFacts = endpoint
    ? await readReceipts(receiptIds, staffId, digests, appId, channelId, destination, query)
    : { receipts: [] as ReceiptFact[], memberId: null };
  const firstConfirmation = endpoint
    ? await readFirstConfirmation(
        staffId,
        digests,
        appId,
        channelId,
        destination,
        receiptFacts.memberId,
        query,
      )
    : null;
  const reviewRow = await readPhoneReview(appId, channelId, destination, query);
  const conflictsRow = await readConflicts(
    destination,
    receiptFacts.memberId,
    staffId,
    channelId,
    firstConfirmation?.receiptId ?? null,
    query,
  );

  const conflicts: HistoricalConflictCounts = conflictsRow
    ? {
        crmContacts: num(conflictsRow.crm_contacts),
        sameMemberContacts: num(conflictsRow.same_member_contacts),
        openConversations: num(conflictsRow.open_conversations),
        otherStaffEndpoints:
          num(conflictsRow.other_endpoint_claims) + num(row?.other_directory_claims),
      }
    : { crmContacts: 0, sameMemberContacts: 0, openConversations: 0, otherStaffEndpoints: 0 };

  const facts: Facts = {
    staffId,
    channelId,
    staffName,
    staffActive: bool(row?.active),
    directoryMatch:
      destination !== "" &&
      [text(row?.own_phone), text(row?.own_whatsapp)].some((value) => value === destination),
    endpoint,
    authority: authorityRow
      ? {
          version: num(metadata.version, -1),
          timezone: text(metadata.timezone) ?? "",
          authority: text(metadata.authority) ?? "",
          transport: text(metadata.transport) ?? "",
          allowAllHours: bool(metadata.allowAllHours),
          consentReceiptId: receiptIds[0],
          allHoursReceiptId: receiptIds[1],
          destinationProofReceiptId: receiptIds[2],
          companyApprovalRef,
          companyApprovalProven:
            companyApprovalRef !== null &&
            num(authorityRow.configure_count) >= 1 &&
            num(authorityRow.distinct_company_refs) <= 1,
        }
      : null,
    receipts: receiptFacts.receipts,
    memberId: receiptFacts.memberId,
    phoneReview: {
      decision: text(reviewRow?.decision) ?? "",
      revision: num(reviewRow?.revision),
      valid: bool(reviewRow?.approval_valid),
      conflictHash: text(reviewRow?.conflict_hash) ?? "",
      snapshotConflictHash: text(reviewRow?.snapshot_conflict_hash) ?? "",
    },
    conflicts,
    firstConfirmation,
    exactFirstProjection:
      num(conflictsRow?.projection_links) === 1 &&
      num(conflictsRow?.contact_leads) === 1 &&
      num(conflictsRow?.contact_inquiries) === 1,
  };

  const resolution = conflictResolution(facts);
  const reasons = evaluate(facts, resolution);
  const mismatch = mismatchOf(reasons);
  const ready = reasons.length === 0;
  return {
    staffId,
    staffName,
    channelId,
    transport: TRANSPORT,
    endpointId: endpoint?.id ?? "",
    endpointVersion: endpoint?.version ?? 0,
    destinationReference: destination,
    maskedDestination: maskHistoricalIdentifier(destination),
    ready,
    eligible: ready,
    reasons,
    checkedAt: new Date().toISOString(),
    fingerprint: fingerprint(facts, resolution),
    review: buildReview(facts, reasons, mismatch, resolution),
  };
}

/**
 * clear                      no CRM/conversation conflict at all
 * staff_confirmation_projection  same-member conflicts, first confirmation frozen
 * current_phone_approval     a still-current scoped phone approval binds the same scope
 * unresolved                 anything else needs a human reviewer
 */
function conflictResolution(facts: Facts): HistoricalConflictResolution {
  if (facts.conflicts.crmContacts === 0 && facts.conflicts.openConversations === 0) return "clear";
  const sameMember =
    facts.conflicts.openConversations === 1 &&
    facts.conflicts.crmContacts === 1 &&
    facts.conflicts.sameMemberContacts === 1 &&
    facts.firstConfirmation?.memberMatched === true &&
    facts.firstConfirmation.frozen &&
    facts.exactFirstProjection &&
    facts.phoneReview.decision !== "revoked";
  if (sameMember) return "staff_confirmation_projection";
  const scopedApproval =
    facts.phoneReview.decision !== "revoked" &&
    facts.conflicts.sameMemberContacts === 0 &&
    facts.phoneReview.valid &&
    facts.phoneReview.conflictHash !== "" &&
    facts.phoneReview.conflictHash === facts.phoneReview.snapshotConflictHash;
  return scopedApproval ? "current_phone_approval" : "unresolved";
}

function evaluate(
  facts: Facts,
  resolution: HistoricalConflictResolution,
): HistoricalProofReasonCode[] {
  const reasons: HistoricalProofReasonCode[] = [];
  if (!facts.staffActive) reasons.push("staff_inactive");
  if (facts.staffName === "") reasons.push("staff_not_found");
  if (!facts.directoryMatch) reasons.push("directory_mismatch");
  if (!facts.endpoint) return [...reasons, "endpoint_missing"];
  if (facts.endpoint.retired) reasons.push("endpoint_retired");
  if (facts.endpoint.transport !== TRANSPORT) reasons.push("transport_not_reviewed_phone");
  if (!facts.endpoint.permissionGranted || facts.endpoint.permissionRef === null)
    reasons.push("permission_missing");
  const authority = facts.authority;
  if (!authority) reasons.push("authority_missing");
  else if (
    authority.version !== facts.endpoint.version ||
    authority.authority !== AUTHORITY ||
    authority.transport !== facts.endpoint.transport ||
    !facts.endpoint.policyTimezoneOk ||
    authority.timezone !== TZ
  ) {
    reasons.push("authority_mismatch");
  }
  if (authority !== null && !authority.companyApprovalProven)
    reasons.push("company_approval_missing");
  const frozen = (kind: HistoricalProofReceipt["kind"]) =>
    facts.receipts.some(
      (receipt) =>
        receipt.kind === kind &&
        receipt.verified &&
        receipt.matchedMember &&
        receipt.matchedPhone &&
        receipt.frozen,
    );
  if (
    !frozen("destination_proof") ||
    facts.endpoint.verificationRef !== `accepted-ingress:${authority?.destinationProofReceiptId}`
  )
    reasons.push("identity_receipt_missing");
  if (
    !frozen("consent") ||
    facts.endpoint.permissionRef !== `recipient-consent:${authority?.consentReceiptId}`
  )
    reasons.push("purpose_receipt_missing");
  // Hours need the policy, the audit approval AND a frozen receipt: both, not either.
  const hoursApproved =
    facts.endpoint.hoursPolicyApproved && authority?.allowAllHours === true && frozen("all_hours");
  if (!hoursApproved) reasons.push("hours_not_approved");
  if (facts.conflicts.otherStaffEndpoints > 0) reasons.push("shared_phone");
  if (facts.phoneReview.decision === "revoked") reasons.push("phone_approval_revoked");
  if (resolution === "unresolved") {
    if (facts.conflicts.crmContacts > 0 && !facts.firstConfirmation?.frozen) {
      reasons.push("first_confirmation_missing");
    }
    reasons.push("conflict_unresolved");
  }
  return [...new Set(reasons)];
}

function mismatchOf(reasons: HistoricalProofReasonCode[]): HistoricalMismatch {
  const table: [HistoricalProofReasonCode, HistoricalMismatchKind, string][] = [
    ["staff_inactive", "staff_inactive", "Staff directory entry is inactive."],
    ["staff_not_found", "staff_inactive", "Staff directory name is missing."],
    [
      "directory_mismatch",
      "directory_mismatch",
      "Endpoint phone is not the staff member's own phone or WhatsApp.",
    ],
    [
      "endpoint_missing",
      "endpoint_missing",
      "No phone endpoint for this staff member on the company channel.",
    ],
    ["endpoint_retired", "endpoint_retired", "The phone endpoint has been retired."],
    [
      "transport_not_reviewed_phone",
      "transport_not_reviewed_phone",
      "Only the phone transport is reviewable.",
    ],
    [
      "permission_missing",
      "authority_mismatch",
      "No current permission grant or permission reference.",
    ],
    ["authority_missing", "authority_mismatch", "No staff.endpoint.configure audit authority."],
    [
      "authority_mismatch",
      "authority_mismatch",
      "Audit authority mismatches endpoint version, transport, literal or timezone.",
    ],
    [
      "company_approval_missing",
      "authority_mismatch",
      "Company authorization absent or its old-audit provenance conflicts.",
    ],
    [
      "identity_receipt_missing",
      "identity_receipt_missing",
      "Destination-proof receipt missing, unfrozen or unbound.",
    ],
    [
      "purpose_receipt_missing",
      "purpose_receipt_missing",
      "Consent receipt missing, unfrozen or unbound.",
    ],
    [
      "hours_not_approved",
      "hours_not_approved",
      "Approved hours need the policy, the audit approval and a frozen receipt.",
    ],
    ["shared_phone", "shared_phone", "This phone is also claimed by another active staff member."],
    [
      "phone_approval_revoked",
      "phone_approval_revoked",
      "The prior phone review was revoked; fail closed.",
    ],
    [
      "first_confirmation_missing",
      "first_confirmation_missing",
      "The first staff confirmation receipt is not frozen for this batch.",
    ],
    [
      "conflict_unresolved",
      "conflict_unresolved",
      "An old CRM holder needs an authenticated per-purpose review.",
    ],
  ];
  const hit = table.find(([reason]) => reasons.includes(reason));
  return hit
    ? { kind: hit[1], requiresManualReview: true, resolution: "unresolved", detail: hit[2] }
    : { kind: "none", requiresManualReview: false, resolution: "resolved", detail: "Verified." };
}

function buildReview(
  facts: Facts,
  reasons: HistoricalProofReasonCode[],
  mismatch: HistoricalMismatch,
  resolution: HistoricalConflictResolution,
): HistoricalProofReview {
  const hoursApproved =
    (facts.endpoint?.hoursPolicyApproved ?? false) &&
    facts.authority?.allowAllHours === true &&
    facts.endpoint?.policyTimezoneOk === true &&
    !reasons.includes("hours_not_approved");
  return {
    status: reasons.length === 0 ? "eligible" : "unresolved",
    mismatch,
    staffDirectoryMatch: facts.directoryMatch,
    staffActive: facts.staffActive,
    sharedPhone: facts.conflicts.otherStaffEndpoints > 0,
    allowAllHours: facts.authority?.allowAllHours === true,
    hoursApproved,
    companyApprovalProven: facts.authority?.companyApprovalProven ?? false,
    firstConfirmationFrozen: facts.firstConfirmation?.frozen === true,
    conflictHash: facts.phoneReview.snapshotConflictHash || facts.phoneReview.conflictHash,
    conflictResolution: resolution,
    conflictCounts: { ...facts.conflicts },
    endpoint: {
      version: facts.endpoint?.version ?? 0,
      transport: facts.endpoint?.transport ?? TRANSPORT,
      enabled: facts.endpoint?.enabled ?? false,
      retired: facts.endpoint?.retired ?? false,
    },
    receipts: facts.receipts.map((receipt) => ({
      kind: receipt.kind,
      verified: receipt.verified,
      matchedMember: receipt.matchedMember,
      matchedPhone: receipt.matchedPhone,
      frozen: receipt.frozen,
      attested: receipt.attested,
    })),
  };
}

/** Browser projection: `review` is already id-free, so this only re-shapes the proof. */
export function toPublicHistoricalRecipientProof(
  proof: HistoricalRecipientProof,
): HistoricalRecipientProofPublic {
  return {
    staffName: proof.staffName,
    maskedDestination: proof.maskedDestination,
    ready: proof.ready,
    eligible: proof.eligible,
    reasons: proof.reasons,
    checkedAt: proof.checkedAt,
    fingerprint: proof.fingerprint,
    review: proof.review,
  };
}
