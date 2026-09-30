import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows, transactionRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server";
import type { StaffNotificationPage, StaffNotificationItem } from "./staff-notifications.types";
type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Ports = { query: typeof queryRows; transaction: typeof transactionRows };
const defaults: Ports = { query: queryRows, transaction: transactionRows };
export const notificationListSchema = z
  .object({
    cursor: z.string().max(300).nullable().optional(),
    status: z
      .enum(["all", "pending", "acknowledged", "resolved", "superseded", "cancelled"])
      .default("pending"),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const notificationActionSchema = z
  .object({
    notificationId: z.string().uuid(),
    expectedAssignmentVersion: z.number().int().nonnegative(),
  })
  .strict();
export const notificationHelpSchema = notificationActionSchema
  .extend({ reason: z.string().trim().min(1).max(500) })
  .strict();
async function authorize(actor: Actor, query = queryRows) {
  if (
    !actor.roles.some((r) => ["admin", "manager", "agent"].includes(r)) ||
    !(
      await query(
        "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager','agent')",
        [actor.staffId],
      )
    ).length
  )
    throw new Response("Forbidden", { status: 403 });
}
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
export async function listMyStaffNotifications(
  value: unknown,
  actor: Actor,
  query = queryRows,
): Promise<StaffNotificationPage> {
  await authorize(actor, query);
  const input = notificationListSchema.parse(value);
  const [schema] = await query(
    "SELECT to_regclass('staff_notification_intents') IS NOT NULL available",
  );
  if (!schema?.available) return { available: false, items: [], nextCursor: null };
  let cursor: { at: string; id: string } | null = null;
  if (input.cursor) {
    try {
      cursor = z
        .object({ at: z.string().datetime(), id: z.string().uuid() })
        .strict()
        .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
    } catch {
      throw new Response("INVALID_CURSOR", { status: 400 });
    }
  }
  const rows = await query(
    `SELECT n.*,i.public_listing_no,i.placement_source,i.response_due_at,i.first_human_response_at,p.deal_type,
 COALESCE(requested.name_zh,requested.name_en) requested_name,COALESCE(handler.name_zh,handler.name_en) handler_name,
 (i.status NOT IN ('closed','resolved','spam') AND NOT i.association_review AND i.first_human_response_at IS NULL AND EXISTS(SELECT 1 FROM whatsapp_enquiry_activations a WHERE a.id=n.activation_generation AND a.ended_at IS NULL) AND EXISTS(SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=n.recipient_staff_id AND m.channel_id=w.channel_id AND m.eligible AND m.retired_at IS NULL) AND n.assignment_version=w.assignment_version AND w.confirmed_staff_id=n.recipient_staff_id AND w.assigned_agent_id=n.recipient_staff_id AND n.purpose='action_required' AND n.acknowledgement_required AND n.work_state IN ('pending','acknowledged')) can_act,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('transport',a.transport,'state',a.dispatch_state,'evidenceKind',a.evidence_kind,'error',a.safe_error,'acceptedAt',a.provider_accepted_at,'acceptedSource',a.provider_acceptance_source,'deliveredAt',a.provider_delivered_at,'deliveredSource',a.provider_delivery_source,'readAt',a.provider_read_at,'readSource',a.provider_read_source)) FROM staff_notification_attempts a WHERE a.notification_id=n.id),'[]'::jsonb) attempts
 FROM staff_notification_intents n JOIN inquiries i ON i.id=n.inquiry_id JOIN whatsapp_conversations w ON w.id=n.conversation_id LEFT JOIN properties p ON p.id=i.property_id LEFT JOIN staff_users requested ON requested.id=n.requested_staff_id_snapshot JOIN staff_users handler ON handler.id=n.recipient_staff_id
 WHERE n.recipient_staff_id=$1::uuid AND ($2='all' OR n.work_state=$2) AND ($3::timestamptz IS NULL OR (n.created_at,n.id)<($3::timestamptz,$4::uuid)) ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,
    [actor.staffId, input.status, cursor?.at ?? null, cursor?.id ?? null, input.limit + 1],
  );
  const page = rows.slice(0, input.limit);
  const items: StaffNotificationItem[] = page.map((r) => ({
    id: String(r.id),
    inquiryId: String(r.inquiry_id),
    conversationId: String(r.conversation_id),
    assignmentVersion: Number(r.assignment_version),
    purpose: String(r.purpose),
    workState: r.work_state as StaffNotificationItem["workState"],
    requestedStaffId: r.requested_staff_id_snapshot ? String(r.requested_staff_id_snapshot) : null,
    requestedName: r.requested_name as string | null,
    handlerStaffId: String(r.recipient_staff_id),
    handlerName: r.handler_name as string | null,
    mismatchReason: r.mismatch_reason as string | null,
    publicListingNo: r.public_listing_no as string | null,
    dealType: r.deal_type as string | null,
    source: r.placement_source as string | null,
    responseDueAt: iso(r.response_due_at),
    firstHumanResponseAt: iso(r.first_human_response_at),
    acknowledgedAt: iso(r.acknowledged_at),
    helpRequestedAt: iso(r.help_requested_at),
    createdAt: iso(r.created_at)!,
    canAct: r.can_act === true,
    attempts: r.attempts as StaffNotificationItem["attempts"],
  }));
  const last = items.at(-1);
  return {
    available: true,
    items,
    nextCursor:
      rows.length > input.limit && last
        ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString("base64url")
        : null,
  };
}
async function mutate(value: unknown, actor: Actor, kind: "ack" | "help", ports = defaults) {
  await authorize(actor, ports.query);
  const input =
    kind === "help" ? notificationHelpSchema.parse(value) : notificationActionSchema.parse(value);
  const result = await ports.transaction([
    {
      statement:
        "SELECT w.id FROM whatsapp_conversations w JOIN staff_notification_intents n ON n.conversation_id=w.id WHERE n.id=$1::uuid FOR UPDATE OF w",
      params: [input.notificationId],
    },
    {
      statement: "SELECT id FROM staff_users WHERE id=$1::uuid FOR UPDATE",
      params: [actor.staffId],
    },
    {
      statement: `WITH eligible AS (SELECT n.id FROM staff_notification_intents n,whatsapp_conversations w,staff_users s,inquiries i
 WHERE n.id=$1::uuid AND n.recipient_staff_id=$2::uuid AND n.assignment_version=$3 AND n.purpose='action_required' AND n.acknowledgement_required AND n.work_state IN ('pending','acknowledged')
 AND i.id=n.inquiry_id AND i.status NOT IN ('closed','resolved','spam') AND NOT i.association_review AND i.first_human_response_at IS NULL AND EXISTS(SELECT 1 FROM whatsapp_enquiry_activations a WHERE a.id=n.activation_generation AND a.ended_at IS NULL) AND EXISTS(SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=n.recipient_staff_id AND m.channel_id=w.channel_id AND m.eligible AND m.retired_at IS NULL) AND w.id=n.conversation_id AND w.assignment_version=n.assignment_version AND w.confirmed_staff_id=n.recipient_staff_id AND w.assigned_agent_id=n.recipient_staff_id AND s.id=$2::uuid AND s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager','agent'))
 ),changed AS (UPDATE staff_notification_intents n SET
 work_state=CASE WHEN $4='ack' THEN 'acknowledged' ELSE n.work_state END,
 acknowledged_at=CASE WHEN $4='ack' THEN COALESCE(n.acknowledged_at,now()) ELSE n.acknowledged_at END,
 acknowledged_by=CASE WHEN $4='ack' THEN $2::uuid ELSE n.acknowledged_by END,
 help_requested_at=CASE WHEN $4='help' THEN COALESCE(n.help_requested_at,now()) ELSE n.help_requested_at END,
 help_reason=CASE WHEN $4='help' THEN COALESCE(n.help_reason,$5) ELSE n.help_reason END,updated_at=now()
 FROM eligible e WHERE n.id=e.id AND (($4='ack' AND n.acknowledged_at IS NULL) OR ($4='help' AND n.help_requested_at IS NULL))
 RETURNING n.id,n.work_state,n.acknowledged_at,n.help_requested_at),audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $2::uuid,CASE WHEN $4='ack' THEN 'staff.notification.ack' ELSE 'staff.notification.help' END,'staff_notification',id,jsonb_build_object('assignmentVersion',$3::integer) FROM changed RETURNING id)
 SELECT * FROM changed UNION ALL
 SELECT n.id,n.work_state,n.acknowledged_at,n.help_requested_at FROM staff_notification_intents n JOIN eligible e ON e.id=n.id WHERE NOT EXISTS(SELECT 1 FROM changed)`,
      params: [
        input.notificationId,
        actor.staffId,
        input.expectedAssignmentVersion,
        kind,
        "reason" in input ? input.reason : null,
      ],
    },
  ]);
  if (!result[2]?.length)
    throw new Response("NOTIFICATION_OWNER_OR_VERSION_CONFLICT", { status: 409 });
  return {
    ok: true,
    acknowledgedAt: iso(result[2][0].acknowledged_at),
    helpRequestedAt: iso(result[2][0].help_requested_at),
  };
}
export const acknowledgeStaffAssignment = (value: unknown, actor: Actor, ports = defaults) =>
  mutate(value, actor, "ack", ports);
export const requestStaffAssignmentHelp = (value: unknown, actor: Actor, ports = defaults) =>
  mutate(value, actor, "help", ports);
