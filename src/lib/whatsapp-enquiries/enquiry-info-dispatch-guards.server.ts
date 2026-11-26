import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { queryRows } from "../neon/db.server.ts";
import type { StaffAlertTemplate } from "../woztell/staff-alert-template.ts";
import type { EnquiryInfoSourceWitness } from "./enquiry-info-source-witness.server.ts";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export type EnquiryInfoDispatchEvidence = {
  purpose: "enq_forward_info";
  version: 1;
  appId: string;
  channelId: string;
  companySenderPhone: string;
  armId: string;
  policyRevision: number;
  providerProofAuditId: string;
  channelProofHash: string;
  templateProofHash: string;
  reviewId: string | null;
  reviewRevision: number;
  profileHash: string;
  conflictHash: string;
};
export type EnquiryInfoDispatchContext = Omit<
  EnquiryInfoDispatchEvidence,
  "reviewId" | "reviewRevision" | "profileHash" | "conflictHash"
>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function enquiryInfoEvidenceHash(
  value: EnquiryInfoDispatchEvidence,
  sourceWitness: EnquiryInfoSourceWitness,
) {
  return digest([
    value.purpose,
    value.version,
    value.appId,
    value.channelId,
    value.companySenderPhone,
    value.armId,
    value.policyRevision,
    value.providerProofAuditId,
    value.channelProofHash,
    value.templateProofHash,
    value.reviewId,
    value.reviewRevision,
    value.profileHash,
    value.conflictHash,
    sourceWitness.version,
    sourceWitness.hash,
    sourceWitness.salesHash,
  ]);
}
export function parseEnquiryInfoDispatchEvidence(
  value: unknown,
): EnquiryInfoDispatchEvidence | null {
  const v = object(value);
  if (
    v.purpose !== "enq_forward_info" ||
    v.version !== 1 ||
    typeof v.appId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(v.appId) ||
    typeof v.channelId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(v.channelId) ||
    typeof v.companySenderPhone !== "string" ||
    !/^852[2-9]\d{7}$/.test(v.companySenderPhone) ||
    typeof v.armId !== "string" ||
    !uuid.test(v.armId) ||
    !Number.isInteger(v.policyRevision) ||
    Number(v.policyRevision) < 1 ||
    typeof v.providerProofAuditId !== "string" ||
    !uuid.test(v.providerProofAuditId) ||
    typeof v.channelProofHash !== "string" ||
    !hash.test(v.channelProofHash) ||
    typeof v.templateProofHash !== "string" ||
    !hash.test(v.templateProofHash) ||
    (v.reviewId !== null && (typeof v.reviewId !== "string" || !uuid.test(v.reviewId))) ||
    !Number.isInteger(v.reviewRevision) ||
    Number(v.reviewRevision) < 0 ||
    (v.reviewId === null ? v.reviewRevision !== 0 : Number(v.reviewRevision) < 1) ||
    typeof v.profileHash !== "string" ||
    !hash.test(v.profileHash) ||
    typeof v.conflictHash !== "string" ||
    !hash.test(v.conflictHash)
  )
    return null;
  return v as EnquiryInfoDispatchEvidence;
}

/** The activation already bound a fresh protected provider check to this exact arm. */
export async function loadEnquiryInfoDispatchContext(
  scope: {
    appId: string;
    channelId: string;
    companySenderPhone: string;
    template: StaffAlertTemplate;
  },
  query = queryRows,
): Promise<EnquiryInfoDispatchContext | null> {
  const rows = await query(
    `SELECT p.id AS arm_id,p.revision AS policy_revision,
    a.id AS provider_proof_audit_id,
    a.metadata#>>'{infoForwarding,channelProofHash}' AS channel_proof_hash,
    a.metadata#>>'{infoForwarding,templateProofHash}' AS template_proof_hash,
    a.metadata#>>'{channel,senderPhone}' AS sender_phone,
    a.metadata#>'{template,configured}' AS configured_template
    FROM enquiry_forwarding_decisions p
    JOIN enquiry_notification_recipients copy ON copy.recipient_key='copy' AND copy.enabled AND copy.channel_id=$2
    JOIN audit_logs a ON a.id::text=p.evidence->>'providerProofAuditId'
    JOIN ops_jobs checked_job ON checked_job.id=a.subject_id
    WHERE p.app_id=$1 AND p.channel_id=$2 AND p.subject_kind='policy' AND p.decision='armed'
      AND p.id=(enquiry_info_head($1,$2,'policy','policy')).id
      AND copy.phone<>(a.metadata#>>'{channel,senderPhone}')
       AND copy.verification_ref='provider-check-audit:'||a.id::text
      AND a.action='whatsapp.enquiry_forwarding.provider_checked' AND a.actor_id IS NULL AND a.subject_type='ops_job'
      AND checked_job.job_type='woztell.enquiry.forward.readiness' AND checked_job.payload_version=1 AND checked_job.payload='{}'::jsonb
      AND a.metadata#>'{infoForwarding,ready}'='true'::jsonb
      AND a.metadata#>>'{infoForwarding,purpose}'='enq_forward_info' AND a.metadata#>'{infoForwarding,version}'='1'::jsonb
      AND a.metadata#>>'{infoForwarding,appId}'=$1 AND a.metadata#>>'{infoForwarding,channelId}'=$2
      AND p.created_at>=a.created_at AND p.created_at-a.created_at<interval '24 hours'`,
    [scope.appId, scope.channelId],
  );
  const row = rows[0];
  if (
    !row ||
    typeof row.arm_id !== "string" ||
    !uuid.test(row.arm_id) ||
    typeof row.provider_proof_audit_id !== "string" ||
    !uuid.test(row.provider_proof_audit_id) ||
    typeof row.channel_proof_hash !== "string" ||
    !hash.test(row.channel_proof_hash) ||
    typeof row.template_proof_hash !== "string" ||
    !hash.test(row.template_proof_hash) ||
    row.sender_phone !== scope.companySenderPhone ||
    !Number.isInteger(Number(row.policy_revision)) ||
    Number(row.policy_revision) < 1
  )
    return null;
  const configured = object(row.configured_template);
  if (
    digest([configured.name, configured.language, configured.params]) !==
    digest([scope.template.name, scope.template.language, scope.template.params])
  )
    return null;
  return {
    purpose: "enq_forward_info",
    version: 1,
    appId: scope.appId,
    channelId: scope.channelId,
    companySenderPhone: scope.companySenderPhone,
    armId: row.arm_id,
    policyRevision: Number(row.policy_revision),
    providerProofAuditId: row.provider_proof_audit_id,
    channelProofHash: row.channel_proof_hash,
    templateProofHash: row.template_proof_hash,
  };
}
export async function loadEnquiryInfoPhoneEvidence(
  context: EnquiryInfoDispatchContext,
  phone: string,
  query = queryRows,
): Promise<EnquiryInfoDispatchEvidence | null> {
  const [row] = await query(
    `SELECT enquiry_info_phone_snapshot($1,$2,$3) AS snapshot,
    (enquiry_info_head($1,$2,'recipient_phone',$3)).id AS review_id,
    COALESCE((enquiry_info_head($1,$2,'recipient_phone',$3)).revision,0) AS review_revision,
    enquiry_info_recipient_allowed($1,$2,$3) AS allowed`,
    [context.appId, context.channelId, phone],
  );
  const snapshot = object(row?.snapshot);
  if (!row) return null;
  // Observed hashes are retained for blocked attempts too. Authorization is the
  // fresh DB predicate in the planning/claim/one-use permit statements below.
  return parseEnquiryInfoDispatchEvidence({
    ...context,
    reviewId: row.review_id ?? null,
    reviewRevision: Number(row.review_revision),
    profileHash: snapshot.profileHash,
    conflictHash: snapshot.conflictHash,
  });
}

/** Fixed SQL fragments only: no user-provided identifier or value interpolation. */
export function enquiryInfoDispatchEvidenceSql(snapshot: "t.routing_snapshot" | "d.snapshot") {
  if (snapshot !== "t.routing_snapshot" && snapshot !== "d.snapshot")
    throw Error("INVALID_SNAPSHOT_SQL");
  const info = `${snapshot}->'info'`;
  const app = `(${info}->>'appId')`,
    channel = `(${info}->>'channelId')`;
  return `(${info}->>'purpose'='enq_forward_info' AND ${info}->'version'='1'::jsonb
    AND enquiry_info_recipient_allowed(${app},${channel},r.phone)
    AND EXISTS(SELECT 1 FROM enquiry_forwarding_decisions info_arm
      JOIN audit_logs info_proof ON info_proof.id::text=info_arm.evidence->>'providerProofAuditId'
      JOIN ops_jobs proof_job ON proof_job.id=info_proof.subject_id
      WHERE info_arm.id::text=${info}->>'armId' AND info_arm.app_id=${app} AND info_arm.channel_id=${channel}
        AND info_arm.subject_kind='policy' AND info_arm.decision='armed'
        AND info_arm.id=(enquiry_info_head(${app},${channel},'policy','policy')).id
        AND info_arm.revision::text=${info}->>'policyRevision'
        AND info_proof.id::text=${info}->>'providerProofAuditId'
        AND info_proof.action='whatsapp.enquiry_forwarding.provider_checked' AND info_proof.actor_id IS NULL AND info_proof.subject_type='ops_job'
        AND proof_job.job_type='woztell.enquiry.forward.readiness' AND proof_job.payload_version=1 AND proof_job.payload='{}'::jsonb
        AND info_proof.metadata#>'{infoForwarding,ready}'='true'::jsonb
        AND info_proof.metadata#>>'{infoForwarding,purpose}'='enq_forward_info' AND info_proof.metadata#>'{infoForwarding,version}'='1'::jsonb
        AND info_proof.metadata#>>'{infoForwarding,appId}'=${app} AND info_proof.metadata#>>'{infoForwarding,channelId}'=${channel}
        AND info_proof.metadata#>>'{infoForwarding,channelProofHash}'=${info}->>'channelProofHash'
        AND info_proof.metadata#>>'{infoForwarding,templateProofHash}'=${info}->>'templateProofHash'
        AND info_proof.metadata#>>'{channel,senderPhone}'=${info}->>'companySenderPhone'
        AND r.verification_ref='provider-check-audit:'||info_proof.id::text
        AND info_arm.created_at>=info_proof.created_at AND info_arm.created_at-info_proof.created_at<interval '24 hours')
    AND EXISTS(SELECT 1 FROM LATERAL enquiry_info_phone_snapshot(${app},${channel},r.phone) current_phone(value)
      WHERE current_phone.value->>'profileHash'=${info}->>'profileHash' AND current_phone.value->>'conflictHash'=${info}->>'conflictHash')
    AND (enquiry_info_head(${app},${channel},'recipient_phone',r.phone)).id::text IS NOT DISTINCT FROM ${info}->>'reviewId'
    AND COALESCE((enquiry_info_head(${app},${channel},'recipient_phone',r.phone)).revision,0)::text=${info}->>'reviewRevision')`;
}

/** A late projection of a pre-arm or previous-arm receipt must never become new work. */
export function enquiryInfoCausalReceiptSql(snapshot: "t.routing_snapshot" | "d.snapshot") {
  if (snapshot !== "t.routing_snapshot" && snapshot !== "d.snapshot")
    throw Error("INVALID_SNAPSHOT_SQL");
  return `(${snapshot}->>'source'='website' OR (${snapshot}->>'source'='whatsapp' AND EXISTS(
    SELECT 1 FROM inquiries causal_inquiry
    JOIN whatsapp_messages causal_message ON causal_message.id=causal_inquiry.intake_message_id AND causal_message.conversation_id=causal_inquiry.conversation_id
    JOIN whatsapp_enquiry_events causal_event ON causal_event.message_id=causal_message.id AND causal_event.inquiry_id=causal_inquiry.id
    JOIN whatsapp_inbound_receipts causal_receipt ON causal_receipt.app_id=causal_event.app_id AND causal_receipt.channel_id=causal_event.channel_id AND causal_receipt.member_id=causal_event.member_id
    WHERE causal_inquiry.id::text=${snapshot}->>'subjectId'
      AND causal_event.origin='live_webhook' AND causal_receipt.origin='live_webhook' AND causal_receipt.provider='woztell'
      AND causal_event.app_id=${snapshot}#>>'{info,appId}' AND causal_event.channel_id=${snapshot}#>>'{info,channelId}'
      AND causal_receipt.enquiry_forwarding_arm_id::text=${snapshot}#>>'{info,armId}'
      AND causal_receipt.projection_state IN ('pending','projected') AND causal_receipt.block_reason IS NULL
      AND causal_receipt.body_digest~'^[a-f0-9]{64}$'
      AND ((causal_receipt.event_kind='customer_message' AND causal_event.external_message_id=COALESCE(causal_receipt.identity_key,'wa-ambiguous:'||causal_receipt.id::text))
        OR (causal_receipt.event_kind='unsupported' AND causal_event.external_message_id=causal_receipt.normalized_event->>'externalMessageId')))))`;
}
