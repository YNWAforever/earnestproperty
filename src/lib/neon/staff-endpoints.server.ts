import "@tanstack/react-start/server-only";
import { z } from "zod";
import { maskStaffDestination } from "./whatsapp-readiness-policy.ts";
import { staffNotificationRuntime } from "../whatsapp-enquiries/staff-notifications.server.ts";
import { queryRows, transactionRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server";
type Actor = Pick<StaffAccess, "staffId" | "roles">;
export const endpointInput = z
  .object({
    id: z.string().uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    staffId: z.string().uuid(),
    transport: z.enum(["inbox_private_note", "staff_whatsapp"]),
    destinationReference: z.string().max(256).optional(),
    verificationRef: z.string().trim().max(160).optional(),
    permissionRef: z.string().trim().min(1).max(160),
    allowAllHours: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();
async function authorize(actor: Actor, query = queryRows) {
  if (
    !actor.roles.some((r) => r === "admin" || r === "manager") ||
    !(
      await query(
        "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager')",
        [actor.staffId],
      )
    ).length
  )
    throw new Response("Forbidden", { status: 403 });
}
export async function listStaffEndpoints(actor: Actor, query = queryRows) {
  await authorize(actor, query);
  const rows = await query(
    "SELECT id,staff_id,transport,channel_id,version,mapping_version,enabled,retired_at,verification_ref,destination_reference,verified_at,permission_granted,last_inbound_at,template_verified_at FROM staff_notification_endpoints ORDER BY updated_at DESC LIMIT 200",
  );
  return rows.map((r) => ({
    id: String(r.id),
    staffId: String(r.staff_id),
    transport: String(r.transport),
    channelId: String(r.channel_id),
    version: Number(r.version),
    mappingVersion: r.mapping_version == null ? null : Number(r.mapping_version),
    enabled: r.enabled === true,
    retired: r.retired_at !== null,
    verificationRef: String(r.verification_ref ?? ""),
    maskedDestination: maskStaffDestination(String(r.destination_reference ?? "")),
    verifiedAt: r.verified_at ? new Date(String(r.verified_at)).toISOString() : null,
    permissionGranted: r.permission_granted === true,
    lastInboundAt: r.last_inbound_at ? new Date(String(r.last_inbound_at)).toISOString() : null,
    templateVerifiedAt: r.template_verified_at
      ? new Date(String(r.template_verified_at)).toISOString()
      : null,
  }));
}
export async function saveStaffEndpoint(
  value: unknown,
  actor: Actor,
  ports = { query: queryRows, transaction: transactionRows },
) {
  await authorize(actor, ports.query);
  const d = endpointInput.parse(value);
  if (d.id && !d.expectedVersion) throw new Response("VERSION_REQUIRED", { status: 400 });
  const channelId = staffNotificationRuntime().channelId;
  if (!channelId) throw new Response("COMPANY_CHANNEL_UNAVAILABLE", { status: 409 });
  const [mapping] = await ports.query(
    `SELECT m.channel_id,m.inbox_user_id,m.version,m.eligible,m.retired_at,m.verified_at,
       m.review_enforced,m.review_basis,m.review_evidence_id
     FROM whatsapp_staff_channels m JOIN staff_users s ON s.id=m.staff_id
     WHERE m.staff_id=$1::uuid AND m.channel_id=$2 AND s.active LIMIT 1`,
    [d.staffId, channelId],
  );
  if (!mapping || mapping.eligible !== true || mapping.retired_at || !mapping.verified_at)
    throw new Response("STAFF_MAPPING_UNAVAILABLE", { status: 409 });
  const privateNote = d.transport === "inbox_private_note";
  if (
    privateNote &&
    (mapping.review_enforced !== true ||
      mapping.review_basis !== "provider_verified" ||
      !mapping.review_evidence_id ||
      !mapping.inbox_user_id)
  )
    throw new Response("INBOX_MAPPING_REVIEW_REQUIRED", { status: 409 });
  const destinationReference = privateNote
    ? String(mapping.inbox_user_id)
    : (d.destinationReference?.trim() ?? "");
  const verificationRef = privateNote
    ? String(mapping.review_evidence_id)
    : (d.verificationRef?.trim() ?? "");
  if (!destinationReference || !verificationRef)
    throw new Response("ENDPOINT_VERIFICATION_REQUIRED", { status: 400 });
  const mappingVersion = Number(mapping.version);
  const params = [
    d.staffId,
    d.transport,
    channelId,
    destinationReference,
    verificationRef,
    d.permissionRef,
    JSON.stringify(d.allowAllHours ? { approved: true, allowAllHours: true } : {}),
    d.enabled,
    actor.staffId,
    d.id ?? null,
    d.expectedVersion ?? null,
    mappingVersion,
  ];
  const guard =
    "EXISTS(SELECT 1 FROM staff_users a JOIN staff_roles r ON r.staff_user_id=a.id WHERE a.id=$9::uuid AND a.active AND r.role IN ('admin','manager')) AND EXISTS(SELECT 1 FROM staff_users s JOIN whatsapp_staff_channels m ON m.staff_id=s.id WHERE s.id=$1::uuid AND s.active AND m.channel_id=$3 AND m.version=$12 AND m.eligible AND m.retired_at IS NULL AND m.verified_at IS NOT NULL AND ($2<>'inbox_private_note' OR (m.inbox_user_id=$4 AND m.review_enforced AND m.review_basis='provider_verified' AND m.review_evidence_id::text=$5)))";
  const statement = d.id
    ? `UPDATE staff_notification_endpoints SET transport=$2,channel_id=$3,destination_reference=$4,verification_ref=$5,verified_at=now(),permission_ref=$6,permission_granted=true,quiet_hours_policy=$7::jsonb,enabled=$8,mapping_version=$12,updated_at=now(),last_inbound_at=CASE WHEN destination_reference=$4 AND channel_id=$3 AND transport=$2 THEN last_inbound_at ELSE NULL END,template_name=NULL,template_language=NULL,template_verified_at=NULL WHERE id=$10::uuid AND staff_id=$1::uuid AND version=$11 AND retired_at IS NULL AND ${guard} RETURNING id,version`
    : `INSERT INTO staff_notification_endpoints(staff_id,transport,channel_id,destination_reference,verification_ref,verified_at,permission_ref,permission_granted,quiet_hours_policy,enabled,mapping_version) SELECT $1::uuid,$2,$3,$4,$5,now(),$6,true,$7::jsonb,$8,$12 WHERE $10::uuid IS NULL AND $11::integer IS NULL AND ${guard} RETURNING id,version`;
  const rows = await ports.transaction([
    {
      statement:
        "SELECT id FROM staff_users WHERE id IN ($1::uuid,$2::uuid) ORDER BY id FOR UPDATE",
      params: [actor.staffId, d.staffId],
    },
    {
      statement: `WITH changed AS (${statement}),audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $9::uuid,'staff.endpoint.configure','staff_endpoint',id,jsonb_build_object('version',version,'enabled',$8::boolean,'mappingVersion',$12::integer) FROM changed RETURNING id) SELECT * FROM changed`,
      params,
    },
  ]);
  if (!rows[1]?.length)
    throw new Response("ENDPOINT_PERMISSION_OR_VERSION_CONFLICT", { status: 409 });
  return { id: String(rows[1][0].id), version: Number(rows[1][0].version), mappingVersion };
}

export async function listStaffAttention(actor: Actor, query = queryRows) {
  await authorize(actor, query);
  const rows =
    await query(`SELECT i.id AS inquiry_id,i.conversation_id,i.public_listing_no,'routing' AS kind,x.reason AS reason,x.created_at FROM staff_notification_routing_exceptions x JOIN inquiries i ON i.id=x.inquiry_id WHERE x.state='open'
UNION ALL SELECT n.inquiry_id,n.conversation_id,i.public_listing_no,'help',n.help_reason,n.help_requested_at FROM staff_notification_intents n JOIN inquiries i ON i.id=n.inquiry_id WHERE n.help_requested_at IS NOT NULL AND n.work_state IN ('pending','acknowledged') ORDER BY created_at ASC LIMIT 100`);
  return rows.map((r) => ({
    inquiryId: String(r.inquiry_id),
    conversationId: String(r.conversation_id),
    propertyNo: r.public_listing_no ? String(r.public_listing_no) : null,
    kind: String(r.kind),
    reason: String(r.reason),
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

export async function disableStaffEndpoint(
  value: unknown,
  actor: Actor,
  ports = { query: queryRows, transaction: transactionRows },
) {
  await authorize(actor, ports.query);
  const d = z
    .object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() })
    .strict()
    .parse(value);
  const rows = await ports.transaction([
    {
      statement: "SELECT id FROM staff_users WHERE id=$1::uuid FOR UPDATE",
      params: [actor.staffId],
    },
    {
      statement: `WITH changed AS (UPDATE staff_notification_endpoints SET enabled=false,updated_at=now() WHERE id=$1::uuid AND version=$2 AND EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$3::uuid AND s.active AND r.role IN ('admin','manager')) RETURNING id),audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $3::uuid,'staff.endpoint.disable','staff_endpoint',id,'{}'::jsonb FROM changed RETURNING id) SELECT id FROM changed`,
      params: [d.id, d.expectedVersion, actor.staffId],
    },
  ]);
  if (!rows[1]?.length)
    throw new Response("ENDPOINT_PERMISSION_OR_VERSION_CONFLICT", { status: 409 });
  return { ok: true };
}

/** Protected review read model. Raw provider payload and credentials never reach the browser. */
export async function listStaffEventReview(actor: Actor, query = queryRows) {
  await authorize(actor, query);
  const rows = await query(
    `SELECT e.id,e.event_kind,e.created_at,e.protected_payload,w.id AS conversation_id FROM staff_notification_internal_events e LEFT JOIN whatsapp_conversations w ON w.channel_id=e.channel_id AND w.woztell_member_id=e.member_id WHERE e.association_state='review' ORDER BY e.created_at,e.id LIMIT 100`,
  );
  const { normalizeWoztellEvent } = await import("../woztell/woztell.server.ts");
  return rows.map((r) => {
    const event = normalizeWoztellEvent(r.protected_payload as Record<string, unknown>);
    return {
      id: String(r.id),
      kind: String(r.event_kind),
      createdAt: new Date(String(r.created_at)).toISOString(),
      conversationId: r.conversation_id ? String(r.conversation_id) : null,
      text: typeof event.text === "string" ? event.text.slice(0, 2000) : null,
    };
  });
}
