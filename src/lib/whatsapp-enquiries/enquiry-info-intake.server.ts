import "@tanstack/react-start/server-only";

import { z } from "zod";
import { queryRows, transactionRows, type TransactionStatement } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server.ts";
import {
  buildEnquiryInfoDecisionStatement,
  enquiryInfoLockStatements,
  enquiryInfoSchemaAvailable,
  EnquiryInfoDecisionError,
} from "../neon/enquiry-info-decisions.server.ts";
import type { EnquiryInfoScope, EnquiryInfoSubject } from "../neon/enquiry-info-decisions.types.ts";
import type { NormalizedWoztellEvent } from "../woztell/woztell.server.ts";
import { normalizeAdminPhone } from "../neon/admin-workflow.ts";
import { forwardingPhone } from "./enquiry-forwarding-policy.mjs";
import { eventForReceiptProjection } from "./inbound-identity.ts";
import type {
  EnquiryInfoHeldReceiptResolution,
  EnquiryInfoReceiptContext,
  EnquiryInfoReleaseToken,
} from "./enquiry-info-intake.types.ts";

/** Integrated pre-CRM neutral-hold contract, distinct from external provider evidence. */
export const neutralHoldVersion = 1;

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Release = EnquiryInfoHeldReceiptResolution & { actor: Actor };
const releases = new WeakMap<EnquiryInfoReleaseToken, Release>();
const resolutionSchema = z
  .object({
    receiptId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    memberDecisionId: z.string().uuid(),
    resolution: z.enum(["customer", "staff"]),
    evidence: z
      .object({
        sourceReference: z.string().min(3).max(500),
        statement: z.string().min(3).max(4000),
      })
      .strict(),
  })
  .strict();
export type EnquiryInfoIntakeDisposition =
  | "ordinary"
  | "staff"
  | "review"
  | "done"
  | "outside"
  | "invalid";
export type EnquiryInfoIntakePlan = {
  scope: EnquiryInfoScope;
  receiptId: string;
  held: boolean;
  locks: TransactionStatement[];
  release: Release | null;
};
function receiptPredicate(event: NormalizedWoztellEvent, receiptId: string, params: unknown[]) {
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const id = add(receiptId),
    app = add(event.appId),
    channel = add(event.channelId),
    member = add(event.woztellMemberId),
    from = add(event.fromPhone),
    text = add(event.text),
    external = add(event.externalMessageId),
    timestamp = add(event.timestamp),
    type = add(event.messageType);
  return `r.id=${id}::uuid AND r.provider='woztell' AND r.origin='live_webhook' AND r.event_kind IN ('customer_message','unsupported')
    AND r.app_id=${app} AND r.channel_id=${channel} AND r.body_digest ~ '^[a-f0-9]{64}$'
    AND r.member_id IS NOT DISTINCT FROM ${member}::text
    AND r.normalized_event->>'appId'=${app} AND r.normalized_event->>'channelId'=${channel}
    AND r.normalized_event->>'direction'='inbound'
    AND r.normalized_event->>'woztellMemberId' IS NOT DISTINCT FROM ${member}::text
    AND r.normalized_event->>'fromPhone' IS NOT DISTINCT FROM ${from}::text
    AND r.normalized_event->>'text' IS NOT DISTINCT FROM ${text}::text
    AND r.normalized_event->>'timestamp'=${timestamp} AND r.normalized_event->>'messageType'=${type}
    AND ((r.event_kind='customer_message' AND ((r.identity_key IS NOT NULL AND r.identity_key=${external}) OR
      (r.identity_key IS NULL AND ${external}='wa-ambiguous:'||r.id::text))) OR
      (r.event_kind='unsupported' AND r.normalized_event->>'externalMessageId'=${external}))`;
}
/** Entirely absent optional schema is legacy-compatible; partial loss is never ordinary intake. */
export async function enquiryInfoReceiptSchemaAvailable(query: typeof queryRows): Promise<boolean> {
  if (await enquiryInfoSchemaAvailable(query)) return true;
  const [row] = await query(
    "SELECT to_regclass('enquiry_forwarding_decisions') IS NOT NULL AS ledger_present, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='whatsapp_inbound_receipts' AND column_name='enquiry_forwarding_arm_id') AS arm_present",
  );
  if (row?.ledger_present === true || row?.arm_present === true)
    throw new Error("WA_ENQUIRY_SCHEMA_REQUIRED");
  return false;
}
/** Context comes from the committed receipt store, never a claimed arm id or ready flag. */
export async function prepareEnquiryInfoIntake(
  event: NormalizedWoztellEvent,
  context: EnquiryInfoReceiptContext | undefined,
  transaction: typeof transactionRows,
  releaseToken?: EnquiryInfoReleaseToken,
): Promise<EnquiryInfoIntakePlan | null> {
  if (!context) return null;
  if (event.direction !== "inbound") throw new Error("WA_ENQUIRY_INFO_RECEIPT_MISMATCH");
  const query = (async (sql: string, params: unknown[] = []) =>
    (
      await transaction([{ statement: sql, params }], { isolationLevel: "ReadCommitted" })
    )[0]) as typeof queryRows;
  if (!(await enquiryInfoReceiptSchemaAvailable(query))) return null;
  z.string().uuid().parse(context.receiptId);
  if (!event.appId || !event.channelId) throw new Error("WA_ENQUIRY_INFO_RECEIPT_MISMATCH");
  const scope = { appId: event.appId, channelId: event.channelId };
  const release = releaseToken ? releases.get(releaseToken) : null;
  if (releaseToken && (!release || release.receiptId !== context.receiptId))
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_RELEASE_CONTEXT_INVALID");
  const phone = normalizeAdminPhone(event.fromPhone);
  const subjects: EnquiryInfoSubject[] = [{ kind: "receipt", receiptId: context.receiptId }];
  if (event.woztellMemberId && /^[A-Za-z0-9_-]{1,128}$/.test(event.woztellMemberId))
    subjects.push({ kind: "sender_member", memberId: event.woztellMemberId });
  const staffPhone = forwardingPhone(event.fromPhone);
  if (staffPhone) subjects.push({ kind: "recipient_phone", phone: staffPhone });
  const keys = [
    ...(phone ? [`woztell-phone:${phone}`] : []),
    ...(event.woztellMemberId ? [`woztell-member:${event.woztellMemberId}`] : []),
    `woztell-message:${event.externalMessageId}`,
  ];
  const locks = enquiryInfoLockStatements(scope, subjects, keys);
  const params: unknown[] = [];
  const predicate = receiptPredicate(event, context.receiptId, params);
  const result = await transaction(
    [
      ...locks,
      {
        statement: `SELECT r.enquiry_forwarding_arm_id,r.block_reason,r.projection_state FROM whatsapp_inbound_receipts r WHERE ${predicate}`,
        params,
      },
    ],
    { isolationLevel: "ReadCommitted" },
  );
  const row = result.at(-1)?.[0];
  if (!row) throw new Error("WA_ENQUIRY_INFO_RECEIPT_MISMATCH");
  if (!row.enquiry_forwarding_arm_id) {
    if (release) throw new EnquiryInfoDecisionError("ENQUIRY_INFO_RELEASE_CONTEXT_INVALID");
    return null;
  }
  return {
    scope,
    receiptId: context.receiptId,
    held: row.block_reason === "REVIEW_REQUIRED",
    locks,
    release: release ?? null,
  };
}
/** Preceding statements get a NEW ReadCommitted snapshot after all ordered locks. */
export function enquiryInfoPreparationStatements(
  event: NormalizedWoztellEvent,
  plan: EnquiryInfoIntakePlan,
): TransactionStatement[] {
  const params: unknown[] = [];
  const predicate = receiptPredicate(event, plan.receiptId, params);
  const before: TransactionStatement[] = [];
  if (plan.release) {
    before.push(
      buildEnquiryInfoDecisionStatement(
        {
          scope: plan.scope,
          subject: { kind: "receipt", receiptId: plan.receiptId },
          decision: plan.release.resolution === "customer" ? "released_customer" : "released_staff",
          expectedRevision: plan.release.expectedRevision,
          relatedDecisionId: plan.release.memberDecisionId,
          evidence: plan.release.evidence,
        },
        plan.release.actor,
      ),
    );
  } else {
    before.push({
      statement: `SELECT (enquiry_info_derive_staff_binding(r.app_id,r.channel_id,r.id,p.id)).id
      FROM whatsapp_inbound_receipts r CROSS JOIN LATERAL enquiry_info_head(r.app_id,r.channel_id,'recipient_phone',enquiry_notification_phone(r.normalized_event->>'fromPhone')) p
      WHERE ${predicate} AND r.enquiry_forwarding_arm_id IS NOT NULL AND r.projection_state<>'projected'
      AND r.block_reason IS DISTINCT FROM 'REVIEW_REQUIRED' AND r.member_id IS NOT NULL
      AND enquiry_info_phone_approval_valid(p.id)
      AND (enquiry_info_head(r.app_id,r.channel_id,'sender_member',r.member_id)).id IS NULL`,
      params,
    });
  }
  return before;
}
/** These CTEs guard the ACTUAL CRM statement as well as the earlier isolation decision.
 * A genuine prior hold retains this member's identity question across phone retirement.
 * Only the current authenticated customer review clears that concern for future replies;
 * the original held receipt still requires controlled release. Revocation reopens it.
 */
export function buildEnquiryInfoIntakeGate(
  event: NormalizedWoztellEvent,
  plan: EnquiryInfoIntakePlan,
  params: unknown[],
) {
  const predicate = receiptPredicate(event, plan.receiptId, params);
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const explicitPhone = add(normalizeAdminPhone(event.fromPhone));
  const releaseResolution = add(plan.release?.resolution ?? null);
  const releaseRevision = add(plan.release ? plan.release.expectedRevision + 1 : null);
  const releaseMember = add(plan.release?.memberDecisionId ?? null);
  const releaseActor = add(plan.release?.actor.staffId ?? null);
  const ctes = `info_receipt AS MATERIALIZED (SELECT r.* FROM whatsapp_inbound_receipts r WHERE ${predicate}),
    info_conversation AS MATERIALIZED (
      SELECT w.id,w.contact_id FROM whatsapp_conversations w JOIN info_receipt r ON w.woztell_member_id=r.member_id
        AND (w.channel_id=r.channel_id OR w.channel_id IS NULL)
      ORDER BY (w.channel_id=(SELECT channel_id FROM info_receipt)) DESC NULLS LAST LIMIT 1
    ), info_linked_contact AS MATERIALIZED (
      SELECT c.contact_id AS id FROM info_conversation c WHERE c.contact_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM crm_contact_identity_reviews v WHERE v.conversation_id=c.id AND v.status='linked')
    ), info_contacts AS MATERIALIZED (
      SELECT c.* FROM crm_contacts c WHERE c.id IN (SELECT id FROM info_linked_contact)
      OR (NOT EXISTS(SELECT 1 FROM info_linked_contact) AND
        (c.whatsapp_member_id=(SELECT member_id FROM info_receipt) OR c.id IN (SELECT contact_id FROM info_conversation)))
    ), info_staff_phones AS MATERIALIZED (
      SELECT enquiry_notification_phone(s.whatsapp) AS phone FROM staff_users s WHERE s.active AND s.show_on_website
      UNION SELECT enquiry_notification_phone(s.phone) FROM staff_users s WHERE s.active AND s.show_on_website
      UNION SELECT d.phone FROM enquiry_forwarding_decisions d JOIN info_receipt r ON d.app_id=r.app_id AND d.channel_id=r.channel_id
        WHERE d.subject_kind='recipient_phone' AND d.decision='approved' AND (enquiry_info_head(d.app_id,d.channel_id,'recipient_phone',d.phone)).id=d.id
      UNION SELECT phone FROM enquiry_forwarding_copy_contact()
    ), info_facts AS MATERIALIZED (
      SELECT r.*,
        EXISTS(SELECT 1 FROM enquiry_forwarding_decisions d WHERE d.app_id=r.app_id AND d.channel_id=r.channel_id
          AND d.subject_kind='sender_member' AND d.member_id=r.member_id AND d.decision='staff_bound') AS historical_staff,
        EXISTS(SELECT 1 FROM enquiry_forwarding_decisions h
          JOIN whatsapp_inbound_receipts prior ON prior.id=h.receipt_id AND prior.app_id=h.app_id AND prior.channel_id=h.channel_id AND prior.member_id=h.member_id
          JOIN enquiry_forwarding_decisions arm ON arm.id=prior.enquiry_forwarding_arm_id AND arm.app_id=prior.app_id AND arm.channel_id=prior.channel_id AND arm.subject_kind='policy' AND arm.decision='armed'
          WHERE h.app_id=r.app_id AND h.channel_id=r.channel_id AND h.member_id=r.member_id
            AND h.subject_kind='receipt' AND h.decision='held' AND h.related_decision_id=arm.id
            AND h.evidence->>'reason'='sender_identity_unresolved'
            AND prior.provider='woztell' AND prior.origin='live_webhook' AND prior.event_kind IN ('customer_message','unsupported')
            AND prior.normalized_event->>'direction'='inbound') AS prior_identity_review,
        ((enquiry_info_head(r.app_id,r.channel_id,'sender_member',r.member_id)).decision='customer_confirmed'
          AND (enquiry_info_head(r.app_id,r.channel_id,'sender_member',r.member_id)).authority_kind='staff_session'
          AND (enquiry_info_head(r.app_id,r.channel_id,'sender_member',r.member_id)).actor_staff_id IS NOT NULL) AS current_customer_confirmed,
        enquiry_info_phone_approval_valid((enquiry_info_head(r.app_id,r.channel_id,'recipient_phone',enquiry_notification_phone(r.normalized_event->>'fromPhone'))).id) AS approved_from_phone,
        (EXISTS(SELECT 1 FROM info_contacts c JOIN info_staff_phones p ON p.phone=enquiry_notification_phone(c.normalized_phone))
          OR EXISTS(SELECT 1 FROM info_staff_phones p WHERE p.phone=${explicitPhone}::text)) AS staff_concern,
        EXISTS(SELECT 1 FROM info_contacts) AS ordinary_context,
        (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).id AS receipt_decision_id,
        (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).decision AS receipt_decision,
        (${releaseResolution}::text IS NOT NULL AND
          (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).revision=${releaseRevision}::integer AND
          (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).actor_staff_id=${releaseActor}::uuid AND
          (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).related_decision_id=${releaseMember}::uuid AND
          (enquiry_info_head(r.app_id,r.channel_id,'sender_member',r.member_id)).id=${releaseMember}::uuid AND
          (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).decision=CASE WHEN ${releaseResolution}='customer' THEN 'released_customer' ELSE 'released_staff' END
        ) AS authorized_release
      FROM info_receipt r
    ), info_gate AS MATERIALIZED (
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM info_receipt) THEN 'invalid' ELSE (SELECT CASE
        WHEN f.enquiry_forwarding_arm_id IS NULL THEN 'outside'
        WHEN NOT EXISTS(SELECT 1 FROM enquiry_forwarding_decisions a WHERE a.id=f.enquiry_forwarding_arm_id AND a.app_id=f.app_id AND a.channel_id=f.channel_id AND a.subject_kind='policy' AND a.decision='armed') THEN 'invalid'
        WHEN f.projection_state='projected' THEN 'done'
        WHEN f.block_reason='REVIEW_REQUIRED' AND NOT COALESCE(f.authorized_release,false) THEN 'review'
        WHEN f.historical_staff OR (f.approved_from_phone AND f.member_id IS NOT NULL) THEN 'staff'
        WHEN f.staff_concern THEN 'review'
        WHEN f.prior_identity_review AND NOT COALESCE(f.current_customer_confirmed,false) THEN 'review'
        WHEN COALESCE(f.authorized_release,false) AND ${releaseResolution}='customer' THEN 'ordinary'
        WHEN ${explicitPhone}::text IS NOT NULL OR f.ordinary_context THEN 'ordinary'
        ELSE 'review' END FROM info_facts f) END AS disposition
    ), info_hold AS MATERIALIZED (
      SELECT (enquiry_info_system_hold(f.app_id,f.channel_id,f.id,jsonb_build_object('reason','sender_identity_unresolved','armId',f.enquiry_forwarding_arm_id))).id
      FROM info_facts f, info_gate g WHERE g.disposition='review' AND (f.receipt_decision IS NULL OR f.receipt_decision='held')
    ), info_held_receipt AS (
      UPDATE whatsapp_inbound_receipts r SET projection_state='failed',block_reason='REVIEW_REQUIRED',lease_until=NULL,updated_at=now()
      FROM info_hold h,info_facts f WHERE r.id=f.id AND r.projection_state<>'projected' RETURNING r.id
    ), info_staff_event AS (
      INSERT INTO staff_notification_internal_events(external_event_key,notification_attempt_id,channel_id,member_id,association_state,event_kind,protected_payload)
      SELECT 'enq-info:receipt:'||f.id::text,NULL,f.channel_id,f.member_id,'review',f.normalized_event->>'messageType',
        jsonb_build_object('purpose','enq_forward_info','receiptId',f.id,'armId',f.enquiry_forwarding_arm_id,'event',f.normalized_event)
      FROM info_facts f,info_gate g WHERE g.disposition='staff' ON CONFLICT(external_event_key) DO NOTHING RETURNING external_event_key
    ), info_staff_receipt AS (
      UPDATE whatsapp_inbound_receipts r SET projection_state='projected',block_reason=NULL,lease_until=NULL,projected_at=COALESCE(r.projected_at,now()),updated_at=now()
      FROM info_facts f,info_gate g WHERE r.id=f.id AND g.disposition='staff'
        AND (${releaseResolution}::text IS NOT NULL OR r.block_reason IS DISTINCT FROM 'REVIEW_REQUIRED')
        AND (EXISTS(SELECT 1 FROM info_staff_event) OR EXISTS(SELECT 1 FROM staff_notification_internal_events e WHERE e.external_event_key='enq-info:receipt:'||f.id::text))
      RETURNING r.id
    ),`;
  return {
    ctes,
    allowed: "EXISTS(SELECT 1 FROM info_gate WHERE disposition IN ('ordinary','outside'))",
  };
}
export async function classifyEnquiryInfoIntake(
  event: NormalizedWoztellEvent,
  plan: EnquiryInfoIntakePlan,
  transaction: typeof transactionRows,
): Promise<EnquiryInfoIntakeDisposition> {
  // Release approval and projection must commit together in the final CRM transaction.
  if (plan.release) return "ordinary";
  const params: unknown[] = [];
  const gate = buildEnquiryInfoIntakeGate(event, plan, params);
  const result = await transaction(
    [
      ...plan.locks,
      ...enquiryInfoPreparationStatements(event, plan),
      {
        statement: `WITH ${gate.ctes} result AS (SELECT disposition FROM info_gate) SELECT * FROM result`,
        params,
      },
    ],
    { isolationLevel: "ReadCommitted" },
  );
  const disposition = result.at(-1)?.[0]?.disposition as EnquiryInfoIntakeDisposition | undefined;
  if (!disposition || disposition === "invalid")
    throw new Error("WA_ENQUIRY_INFO_RECEIPT_MISMATCH");
  return disposition;
}
/** An existing old transcript cannot cause a new enquiry when the final gate held/isolated it. */
export function guardEnquiryInfoWorkflows(
  event: NormalizedWoztellEvent,
  plan: EnquiryInfoIntakePlan,
  statements: TransactionStatement[],
) {
  if (!statements.length) return statements;
  const params = [...(statements[0].params ?? [])];
  const predicate = receiptPredicate(event, plan.receiptId, params);
  const marker = "WHERE (m.external_message_id";
  if (!statements[0].statement.includes(marker))
    throw new Error("WA_ENQUIRY_INFO_WORKFLOW_GUARD_REQUIRED");
  return [
    {
      statement: statements[0].statement.replace(
        marker,
        () =>
          `WHERE EXISTS(SELECT 1 FROM whatsapp_inbound_receipts r WHERE ${predicate} AND r.block_reason IS DISTINCT FROM 'REVIEW_REQUIRED' AND NOT EXISTS(SELECT 1 FROM staff_notification_internal_events e WHERE e.external_event_key='enq-info:receipt:'||r.id::text)) AND (m.external_message_id`,
      ),
      params,
    },
    ...statements.slice(1),
  ];
}
export function enquiryInfoReleaseCompletion(
  event: NormalizedWoztellEvent,
  plan: EnquiryInfoIntakePlan,
): TransactionStatement[] {
  if (!plan.release) return [];
  return [
    {
      statement: `UPDATE whatsapp_inbound_receipts r SET projection_state='projected',block_reason=NULL,lease_until=NULL,projected_at=COALESCE(r.projected_at,now()),updated_at=now()
      WHERE r.id=$1::uuid AND (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).revision=$2
      AND (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).related_decision_id=$3::uuid
      AND (($4='customer' AND EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.external_message_id=$5 AND m.channel_id=r.channel_id AND m.woztell_member_id=r.member_id AND m.contact_id IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM staff_notification_internal_events e WHERE e.external_event_key='enq-info:receipt:'||r.id::text))
        OR ($4='staff' AND EXISTS(SELECT 1 FROM staff_notification_internal_events e WHERE e.external_event_key='enq-info:receipt:'||r.id::text))) RETURNING r.id`,
      params: [
        plan.receiptId,
        plan.release.expectedRevision + 1,
        plan.release.memberDecisionId,
        plan.release.resolution,
        event.externalMessageId,
      ],
    },
    {
      // A failed final classification/projection MUST roll back the preceding release CAS too.
      statement: `SELECT 1 / CASE WHEN EXISTS(SELECT 1 FROM whatsapp_inbound_receipts r
        WHERE r.id=$1::uuid AND r.projection_state='projected' AND r.block_reason IS NULL
        AND (($2='customer' AND EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.external_message_id=$3 AND m.channel_id=r.channel_id AND m.woztell_member_id=r.member_id AND m.contact_id IS NOT NULL)
          AND NOT EXISTS(SELECT 1 FROM staff_notification_internal_events e WHERE e.external_event_key='enq-info:receipt:'||r.id::text))
          OR ($2='staff' AND EXISTS(SELECT 1 FROM staff_notification_internal_events e WHERE e.external_event_key='enq-info:receipt:'||r.id::text))))
        THEN 1 ELSE 0 END AS release_committed`,
      params: [plan.receiptId, plan.release.resolution, event.externalMessageId],
    },
  ];
}
/** No public wrapper: callers must obtain actor via requireStaffAccess(admin/manager). */
export async function resolveEnquiryInfoHeldReceipt(
  input: EnquiryInfoHeldReceiptResolution,
  actor: Actor,
  ports: { query?: typeof queryRows; transaction?: typeof transactionRows } = {},
) {
  const valid = resolutionSchema.parse(input);
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_REVIEWER_FORBIDDEN", 403);
  if (ports.query && !ports.transaction)
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_RECEIPT_TRANSACTION_REQUIRED");
  const transaction = ports.transaction;
  const query =
    ports.query ??
    (transaction
      ? ((async (statement: string, params: unknown[] = []) =>
          (await transaction([{ statement, params }], { isolationLevel: "ReadCommitted" }))[0] ??
          []) as typeof queryRows)
      : queryRows);
  const [row] = await query(
    `SELECT r.* FROM whatsapp_inbound_receipts r JOIN staff_users s ON s.id=$2::uuid AND s.active
    WHERE r.id=$1::uuid AND r.origin='live_webhook' AND r.event_kind IN ('customer_message','unsupported') AND r.enquiry_forwarding_arm_id IS NOT NULL
      AND r.projection_state='failed' AND r.block_reason='REVIEW_REQUIRED'
      AND EXISTS(SELECT 1 FROM staff_roles sr WHERE sr.staff_user_id=s.id AND sr.role IN ('admin','manager'))`,
    [valid.receiptId, actor.staffId],
  );
  if (!row) throw new EnquiryInfoDecisionError("ENQUIRY_INFO_RELEASE_REVIEW_REQUIRED");
  const original =
    typeof row.normalized_event === "string"
      ? JSON.parse(row.normalized_event)
      : row.normalized_event;
  const event = eventForReceiptProjection(
    original as NormalizedWoztellEvent,
    valid.receiptId,
    row.event_kind as "customer_message" | "unsupported",
    row.identity_key as string | null,
  );
  const token = Object.freeze({});
  releases.set(token, { ...valid, actor: { staffId: actor.staffId, roles: [...actor.roles] } });
  try {
    const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
    return await ingestWoztellEvent(event, "live_webhook", ports.transaction, {
      signedEvent: true,
      mode: "off",
      receiptContext: { receiptId: valid.receiptId },
      enquiryInfoRelease: token,
    });
  } catch (error) {
    const databaseError = error as { code?: string; message?: string };
    if (databaseError?.code === "22012")
      throw new EnquiryInfoDecisionError("ENQUIRY_INFO_RELEASE_NOT_PROJECTED");
    const decisionCode = databaseError?.message?.match(/\bENQUIRY_INFO_[A-Z_]{1,80}\b/)?.[0];
    if (decisionCode)
      throw new EnquiryInfoDecisionError(decisionCode, databaseError.code === "42501" ? 403 : 409);
    throw error;
  } finally {
    releases.delete(token);
  }
}
