import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { queryRows, type DbRow } from "./db.server.ts";
import {
  maskHistoricalIdentifier,
  type HistoricalConflictCounts,
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
 * Sources: staff directory (canonical phone), the website_lead_phone endpoint incl.
 * its permission/ref/quiet-hours policy, the latest `staff.endpoint.configure` audit
 * row (authority literal, endpoint version, timezone, allowAllHours and the THREE
 * whatsapp_inbound_receipts uuids), and the scoped phone review (enquiry_info_head +
 * enquiry_info_phone_snapshot + enquiry_info_phone_approval_valid).
 *
 * Receipt binding is the database's own canonicaliser. `companyApprovalRef` is opaque
 * business authorization, never a provider receipt. `actor_id` may be NULL for an
 * owner-authorized verification, so authority is proven by literal + version + the
 * attested receipts, not by a staff session. No historical attempt is read: these
 * recipients were never sent. Nothing is written, claimed or sent; customer text is
 * never read into a response.
 */

const AUTHORITY = "authenticated_recipient_confirmation";
const TZ = "Asia/Hong_Kong";
const TRANSPORT = "website_lead_phone";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL = /^[A-Za-z0-9_-]{1,160}$/;
const RECEIPT_KINDS = ["consent", "all_hours", "destination_proof"] as const;
const RECEIPT_KEYS = ["consentReceiptId", "allHoursReceiptId", "destinationProofReceiptId"] as const;
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
type Endpoint = {
  id: string;
  version: number;
  transport: string;
  destination: string;
  enabled: boolean;
  retired: boolean;
  permissionGranted: boolean;
  permissionRef: string | null;
  allowAllHoursPolicy: boolean;
  hoursPolicyApproved: boolean;
};
type Authority = {
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
};
type Facts = {
  staffId: string;
  channelId: string;
  appId: string | null;
  staffName: string;
  staffActive: boolean;
  directoryMatch: boolean;
  endpoint: Endpoint | null;
  authority: Authority | null;
  receipts: HistoricalProofReceipt[];
  memberId: string | null;
  review: { decision: string; revision: number; valid: boolean; conflictHash: string; snapshotConflictHash: string };
  conflicts: HistoricalConflictCounts;
  sameMemberProven: boolean;
};

const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const bool = (value: unknown) => value === true;
const num = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
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

/** Stable sha256 over canonical facts: no timestamps, no prose, no message text. */
function fingerprint(facts: Facts): string {
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
          .map((receipt) => `${receipt.kind}:${receipt.id}:${receipt.verified ? 1 : 0}:${receipt.attested ? 1 : 0}`)
          .sort()
          .join(",") || "none",
        facts.endpoint?.permissionRef ?? "no-permission-ref",
        facts.endpoint?.permissionGranted ? "permitted" : "unpermitted",
        facts.endpoint?.hoursPolicyApproved ? "policy-approved" : "policy-unapproved",
        facts.authority?.allowAllHours ? "all-hours" : "no-all-hours",
        facts.authority?.companyApprovalRef ?? "no-company-approval",
        facts.review.decision || "no-review",
        String(facts.review.revision),
        facts.review.valid ? "review-valid" : "review-invalid",
        String(facts.conflicts.crmContacts),
        String(facts.conflicts.sameMemberContacts),
        String(facts.conflicts.openConversations),
        String(facts.conflicts.otherStaffEndpoints),
        facts.review.conflictHash,
      ].join("\n"),
    )
    .digest("hex");
}

/** Directory identity + endpoint policy in canonical phone form. */
async function readDirectoryAndEndpoint(staffId: string, channelId: string, query: QueryRows) {
  const [row] = await query(
    `SELECT s.id AS staff_id,s.name_zh,s.name_en,s.active,
       enquiry_notification_phone(s.phone) AS own_phone,
       enquiry_notification_phone(s.whatsapp) AS own_whatsapp,
       ep.id AS endpoint_id,ep.version,ep.transport,
       enquiry_notification_phone(ep.destination_reference) AS destination,
       ep.enabled,ep.retired_at,ep.permission_granted,ep.permission_ref,ep.quiet_hours_policy,
       (SELECT count(*) FROM staff_users u
         WHERE u.active AND u.id<>s.id AND $2::text IS NOT NULL
           AND (enquiry_notification_phone(u.phone)=$2 OR enquiry_notification_phone(u.whatsapp)=$2)) AS other_directory_claims
     FROM staff_users s
     LEFT JOIN LATERAL (
       SELECT e.* FROM staff_notification_endpoints e
       WHERE e.staff_id=s.id AND e.channel_id=$3 AND e.transport=$4
       ORDER BY (e.retired_at IS NULL) DESC,e.version DESC,e.updated_at DESC,e.id DESC LIMIT 1
     ) ep ON true
     WHERE s.id=$1::uuid`,
    [staffId, null, channelId, TRANSPORT],
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

/** Three receipt uuids; the database function re-checks app/channel/member/phone. */
async function readReceipts(
  ids: readonly (string | null)[],
  appId: string | null,
  channelId: string,
  phone: string,
  query: QueryRows,
): Promise<{ receipts: HistoricalProofReceipt[]; memberId: string | null }> {
  const wanted = RECEIPT_KINDS.map((kind, index) => ({ kind, id: ids[index] })).filter(
    (entry): entry is { kind: HistoricalProofReceipt["kind"]; id: string } => entry.id !== null,
  );
  if (wanted.length === 0) return { receipts: [], memberId: null };
  const rows = await query(
    `SELECT r.id,r.member_id,
       enquiry_info_member_proof_valid(jsonb_build_object('kind','accepted_ingress','receiptId',r.id),
         $2::text,$3::text,$4::text,r.member_id) AS proof_valid,
       COALESCE(length(btrim(r.normalized_event->>'text'))>0,false) AS attested
     FROM whatsapp_inbound_receipts r WHERE r.id=ANY($1::uuid[])`,
    [wanted.map((entry) => entry.id), appId, channelId, phone],
  );
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
  const memberId = text(byId.get(wanted.find((entry) => entry.kind === "destination_proof")?.id ?? "")?.member_id);
  return {
    memberId,
    receipts: wanted.map((entry) => {
      const row = byId.get(entry.id);
      return {
        kind: entry.kind,
        id: entry.id,
        verified: bool(row?.proof_valid),
        matchedMember: memberId !== null && text(row?.member_id) === memberId,
        matchedPhone: bool(row?.proof_valid),
        attested: bool(row?.attested),
      };
    }),
  };
}

async function readPhoneReview(
  appId: string | null,
  channelId: string,
  phone: string,
  query: QueryRows,
): Promise<DbRow | null> {
  if (!appId) return null;
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

/** Earliest signed ingress FROM this phone on the company channel (not the member's). */
async function readFirstIngress(
  appId: string | null,
  channelId: string,
  phone: string,
  query: QueryRows,
): Promise<DbRow | null> {
  if (!appId || phone === "") return null;
  const [row] = await query(
    `SELECT r.id,r.member_id,COALESCE(length(btrim(r.normalized_event->>'text'))>0,false) AS attested
     FROM whatsapp_inbound_receipts r
     WHERE r.app_id=$1 AND r.channel_id=$2 AND r.origin='live_webhook'
       AND enquiry_notification_phone(r.normalized_event->>'fromPhone')=$3
     ORDER BY r.received_at ASC,r.id ASC LIMIT 1`,
    [appId, channelId, phone],
  );
  return row ?? null;
}

async function readConflicts(
  phone: string,
  memberId: string | null,
  staffId: string,
  channelId: string,
  query: QueryRows,
): Promise<DbRow | null> {
  const [row] = await query(
    `SELECT
       (SELECT count(*) FROM crm_contacts c WHERE enquiry_notification_phone(c.normalized_phone)=$1
          OR ($2::text IS NOT NULL AND c.whatsapp_member_id=$2)) AS crm_contacts,
       (SELECT count(*) FROM crm_contacts c WHERE $2::text IS NOT NULL AND c.whatsapp_member_id=$2) AS same_member_contacts,
       (SELECT count(*) FROM whatsapp_conversations w WHERE w.channel_id=$3
          AND $2::text IS NOT NULL AND w.woztell_member_id=$2) AS open_conversations,
       (SELECT count(*) FROM staff_notification_endpoints e WHERE e.channel_id=$3 AND e.staff_id<>$4::uuid
          AND e.retired_at IS NULL AND enquiry_notification_phone(e.destination_reference)=$1) AS other_endpoint_claims,
       EXISTS(SELECT 1 FROM enquiry_forwarding_decisions d WHERE $2::text IS NOT NULL
          AND d.subject_kind='sender_member' AND d.member_id=$2 AND d.decision='staff_bound'
          AND enquiry_info_member_binding_valid(d.id)) AS member_binding_valid`,
    [phone, memberId, channelId, staffId],
  );
  return row ?? null;
}

export async function getHistoricalRecipientProof(
  staffId: string,
  channelId: string,
  query: QueryRows = queryRows,
): Promise<HistoricalRecipientProof> {
  if (!UUID.test(staffId)) throw new HistoricalRecipientProofError("HISTORICAL_PROOF_STAFF_INVALID");
  if (!CHANNEL.test(channelId)) throw new HistoricalRecipientProofError("HISTORICAL_PROOF_CHANNEL_INVALID");

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
        allowAllHoursPolicy: bool(policy.allowAllHours),
        hoursPolicyApproved: bool(policy.approved) && bool(policy.allowAllHours),
      }
    : null;

  const authorityRow = endpoint ? await readAuthority(endpoint.id, query) : null;
  const metadata = record(authorityRow?.metadata);
  const rawApproval = text(metadata.companyApprovalRef)?.trim() ?? null;
  const companyApprovalRef =
    rawApproval !== null && rawApproval.length > 0 && rawApproval.length <= COMPANY_APPROVAL_MAX
      ? rawApproval
      : null;
  const receiptIds = RECEIPT_KEYS.map((key) => uuid(metadata[key]));
  const receiptFacts = endpoint
    ? await readReceipts(receiptIds, appId, channelId, destination, query)
    : { receipts: [] as HistoricalProofReceipt[], memberId: null };
  const reviewRow = destination ? await readPhoneReview(appId, channelId, destination, query) : null;
  const conflictsRow = destination
    ? await readConflicts(destination, receiptFacts.memberId, staffId, channelId, query)
    : null;

  const facts: Facts = {
    staffId,
    channelId,
    appId,
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
    review: {
      decision: text(reviewRow?.decision) ?? "",
      revision: num(reviewRow?.revision),
      valid: bool(reviewRow?.approval_valid),
      conflictHash: text(reviewRow?.conflict_hash) ?? "",
      snapshotConflictHash: text(reviewRow?.snapshot_conflict_hash) ?? "",
    },
    conflicts: conflictsRow
      ? {
          crmContacts: num(conflictsRow.crm_contacts),
          sameMemberContacts: num(conflictsRow.same_member_contacts),
          openConversations: num(conflictsRow.open_conversations),
          otherStaffEndpoints: num(conflictsRow.other_endpoint_claims) + num(row?.other_directory_claims),
        }
      : { crmContacts: 0, sameMemberContacts: 0, openConversations: 0, otherStaffEndpoints: 0 },
    sameMemberProven: bool(conflictsRow?.member_binding_valid),
  };

  const reasons = evaluate(facts);
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
    fingerprint: fingerprint(facts),
    review: buildReview(facts, reasons, mismatch),
  };
}

/** Fail-closed reasons. Hours need the policy, the audit flag AND an attested receipt. */
function evaluate(facts: Facts): HistoricalProofReasonCode[] {
  const reasons: HistoricalProofReasonCode[] = [];
  if (!facts.staffActive) reasons.push("staff_inactive");
  if (facts.staffName === "") reasons.push("staff_not_found");
  if (!facts.directoryMatch) reasons.push("directory_mismatch");
  if (!facts.endpoint) return [...reasons, "endpoint_missing"];
  if (facts.endpoint.retired) reasons.push("endpoint_retired");
  if (facts.endpoint.transport !== TRANSPORT) reasons.push("transport_not_reviewed_phone");
  if (!facts.endpoint.permissionGranted || facts.endpoint.permissionRef === null) {
    reasons.push("permission_missing");
  }
  const authority = facts.authority;
  if (!authority) reasons.push("authority_missing");
  else if (
    authority.version !== facts.endpoint.version ||
    authority.authority !== AUTHORITY ||
    authority.transport !== facts.endpoint.transport ||
    authority.timezone !== TZ
  ) {
    reasons.push("authority_mismatch");
  }
  if (authority !== null && !authority.companyApprovalProven) reasons.push("company_approval_missing");
  const verified = (kind: HistoricalProofReceipt["kind"]) =>
    facts.receipts.some((receipt) => receipt.kind === kind && receipt.verified && receipt.attested);
  if (!verified("destination_proof")) reasons.push("identity_receipt_missing");
  if (!verified("consent")) reasons.push("purpose_receipt_missing");
  // Both are required: an all-hours policy that is not receipted, or a receipt without
  // the policy/audit approval, is not approved hours.
  const hoursApproved =
    facts.endpoint.hoursPolicyApproved &&
    facts.endpoint.allowAllHoursPolicy &&
    authority?.allowAllHours === true &&
    verified("all_hours");
  if (!hoursApproved) reasons.push("hours_not_approved");
  if (facts.conflicts.otherStaffEndpoints > 0) reasons.push("shared_phone");
  if (facts.review.decision === "revoked") reasons.push("phone_approval_revoked");
  if (facts.conflicts.crmContacts > 0 || facts.conflicts.openConversations > 0) {
    const sameMemberOnly =
      facts.sameMemberProven &&
      facts.conflicts.openConversations === 0 &&
      facts.conflicts.crmContacts === facts.conflicts.sameMemberContacts;
    const scopedApproval =
      facts.review.valid &&
      facts.review.conflictHash !== "" &&
      facts.review.conflictHash === facts.review.snapshotConflictHash;
    if (!sameMemberOnly && !scopedApproval && facts.review.decision !== "revoked") {
      reasons.push("conflict_unresolved");
    }
  }
  return [...new Set(reasons)];
}

function mismatchOf(reasons: HistoricalProofReasonCode[]): HistoricalMismatch {
  const table: [HistoricalProofReasonCode, HistoricalMismatchKind, string][] = [
    ["staff_inactive", "staff_inactive", "The staff directory entry is inactive."],
    ["staff_not_found", "staff_inactive", "The staff directory name is missing."],
    ["directory_mismatch", "directory_mismatch", "The endpoint phone is not the staff member's own phone or WhatsApp."],
    ["endpoint_missing", "endpoint_missing", "No phone endpoint for this staff member on the company channel."],
    ["endpoint_retired", "endpoint_retired", "The phone endpoint has been retired."],
    ["transport_not_reviewed_phone", "transport_not_reviewed_phone", "Only the phone transport is reviewable."],
    ["permission_missing", "authority_mismatch", "The endpoint has no current permission grant or permission reference."],
    ["authority_missing", "authority_mismatch", "No staff.endpoint.configure audit authority."],
    ["authority_mismatch", "authority_mismatch", "The audit authority does not match the endpoint version, transport, authority literal or timezone."],
    ["company_approval_missing", "authority_mismatch", "Company authorization is absent or its old-audit provenance conflicts."],
    ["identity_receipt_missing", "identity_receipt_missing", "The destination-proof ingress receipt is missing, unattested or unbound."],
    ["purpose_receipt_missing", "purpose_receipt_missing", "The consent ingress receipt is missing, unattested or unbound."],
    ["hours_not_approved", "hours_not_approved", "Approved hours need the all-hours policy, the audit approval and an attested receipt."],
    ["shared_phone", "shared_phone", "This phone is also claimed by another active staff member."],
    ["phone_approval_revoked", "phone_approval_revoked", "The prior phone review was revoked; fail closed."],
    ["conflict_unresolved", "conflict_unresolved", "An old CRM holder needs an authenticated per-purpose review for this number."],
  ];
  const hit = table.find(([reason]) => reasons.includes(reason));
  return hit
    ? { kind: hit[1], requiresManualReview: true, resolution: "unresolved", detail: hit[2] }
    : { kind: "none", requiresManualReview: false, resolution: "resolved", detail: "Signed evidence and the scoped phone review agree." };
}

function buildReview(
  facts: Facts,
  reasons: HistoricalProofReasonCode[],
  mismatch: HistoricalMismatch,
): HistoricalProofReview {
  const byKind = (kind: HistoricalProofReceipt["kind"]) => facts.receipts.find((receipt) => receipt.kind === kind);
  const endpoint = facts.endpoint;
  const hoursApproved =
    (endpoint?.hoursPolicyApproved ?? false) &&
    (endpoint?.allowAllHoursPolicy ?? false) &&
    facts.authority?.allowAllHours === true &&
    byKind("all_hours")?.verified === true;
  const checks = [
    { id: "staff_active", ok: facts.staffActive },
    { id: "directory_name", ok: facts.staffName !== "" },
    { id: "directory_phone", ok: facts.directoryMatch },
    { id: "endpoint_permission", ok: (endpoint?.permissionGranted ?? false) && endpoint?.permissionRef !== null },
    { id: "endpoint_version", ok: facts.authority?.version === endpoint?.version },
    { id: "authority", ok: facts.authority?.authority === AUTHORITY },
    { id: "timezone", ok: facts.authority?.timezone === TZ },
    { id: "company_approval", ok: facts.authority?.companyApprovalProven ?? false },
    { id: "identity_receipt", ok: byKind("destination_proof")?.verified === true },
    { id: "purpose_receipt", ok: byKind("consent")?.verified === true },
    { id: "hours_receipt", ok: hoursApproved },
    { id: "exclusive_staff_phone", ok: facts.conflicts.otherStaffEndpoints === 0 },
    { id: "conflict_scope", ok: reasons.length === 0 },
  ].map((check) => ({ ...check, detail: check.ok ? "verified" : "not proven" }));
  return {
    status: reasons.length === 0 ? "eligible" : "unresolved",
    mismatch,
    staffDirectoryMatch: facts.directoryMatch,
    staffActive: facts.staffActive,
    sharedPhone: facts.conflicts.otherStaffEndpoints > 0,
    identityReceiptRef: facts.authority?.destinationProofReceiptId ?? null,
    purposeRef: facts.authority?.consentReceiptId ?? null,
    hoursReceiptRef: facts.authority?.allHoursReceiptId ?? null,
    allowAllHours: facts.authority?.allowAllHours === true,
    hoursApproved,
    companyApprovalRef: facts.authority?.companyApprovalRef ?? null,
    companyApprovalProven: facts.authority?.companyApprovalProven ?? false,
    conflictHash: facts.review.snapshotConflictHash || facts.review.conflictHash,
    conflictCounts: { ...facts.conflicts },
    endpoint: {
      id: endpoint?.id ?? "",
      version: endpoint?.version ?? 0,
      transport: endpoint?.transport ?? TRANSPORT,
      enabled: endpoint?.enabled ?? false,
      retired: endpoint?.retired ?? false,
    },
    receipts: facts.receipts.map((receipt) => ({ ...receipt })),
    checks,
  };
}

/** Browser-safe payload: masked destination plus the already-redacted review. */
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
