import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { StaffAccess } from "./auth.server.ts";
import { queryRows, transactionRows } from "./db.server.ts";
import {
  ENQUIRY_COPY,
  ENQUIRY_MANAGERS,
  ENQUIRY_ROUTING_APPROVAL,
  notificationPhone,
} from "../whatsapp-enquiries/enquiry-routing.mjs";
import { forwardingSchemaAvailable } from "../whatsapp-enquiries/enquiry-forwarding-coverage.server.ts";
import { companyChannelId } from "../whatsapp-enquiries/wa-config.server.ts";
import { staffDestinationNotACustomer } from "../whatsapp-enquiries/staff-recipient-guard.ts";
import type {
  EnquiryForwardingSettings,
  EnquiryRecipientSetting,
  EnquiryRecipientReadiness,
} from "./enquiry-forwarding.types.ts";
type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Ports = { query: typeof queryRows; transaction: typeof transactionRows };
const defaults: Ports = { query: queryRows, transaction: transactionRows };
async function authorize(actor: Actor, query: typeof queryRows) {
  if (
    !actor.roles.some((role) => role === "admin" || role === "manager") ||
    !(
      await query(
        "SELECT s.id FROM staff_users s WHERE s.id=$1::uuid AND s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager'))",
        [actor.staffId],
      )
    ).length
  )
    throw new Response("Forbidden", { status: 403 });
}
async function providerCheck(query: typeof queryRows) {
  const [row] = await query(
    "SELECT id,subject_id,metadata,created_at FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.provider_checked' AND created_at>now()-interval '24 hours' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  return row ?? null;
}
async function desiredRecipients(query: typeof queryRows) {
  const rows = await query(
    "SELECT id,COALESCE(NULLIF(name_zh,''),NULLIF(name_en,''),'未命名同事') AS name,whatsapp FROM staff_users WHERE active AND show_on_website ORDER BY display_order,name_zh,id",
  );
  const sales = rows.flatMap((row) => {
    const phone = notificationPhone(row.whatsapp);
    return phone
      ? [
          {
            key: `sales:${row.id}`,
            kind: "sales" as const,
            staffId: String(row.id),
            phone,
            displayName: String(row.name),
          },
        ]
      : [];
  });
  return [ENQUIRY_COPY, ...Object.values(ENQUIRY_MANAGERS), ...sales];
}
/** Internal readiness input; callers must establish the job lease before reading the roster. */
export async function getTrustedEnquiryForwardingRecipientPhones(
  query = queryRows,
): Promise<string[]> {
  const desired = await desiredRecipients(query);
  return [
    ...new Set(
      desired
        .map(({ phone }) => notificationPhone(phone))
        .filter((phone): phone is string => phone !== null),
    ),
  ];
}
const recipientCustomerGuard = `${staffDestinationNotACustomer("r")} AND ${staffDestinationNotACustomer("r", "phone")}`;
function customerConflictSql(recipientsParam: string, channelParam: string) {
  return `SELECT r.key,r.phone FROM (
    SELECT d.key,d.phone,d.phone AS destination_reference,${channelParam}::text AS channel_id
    FROM jsonb_to_recordset(${recipientsParam}::jsonb) AS d(key text,phone text)
  ) r WHERE NOT (${recipientCustomerGuard})`;
}
async function recipientReadiness(
  query: typeof queryRows,
  desired: Awaited<ReturnType<typeof desiredRecipients>>,
  channel: string | null,
): Promise<EnquiryRecipientReadiness> {
  if (!channel)
    return { checked: false, customerConflictRecipientKeys: [], distinctBlockedPhoneCount: 0 };
  const [row] = await query(
    `WITH customer_conflicts AS (${customerConflictSql("$1", "$2")})
     SELECT COALESCE(array_agg(key ORDER BY key),ARRAY[]::text[]) AS conflict_recipient_keys,
       count(DISTINCT phone)::int AS distinct_blocked_phone_count FROM customer_conflicts`,
    [JSON.stringify(desired.map(({ key, phone }) => ({ key, phone }))), channel],
  ).catch(() => {
    console.warn("Enquiry forwarding recipient identity check failed.");
    return [];
  });
  if (
    !row ||
    !Array.isArray(row.conflict_recipient_keys) ||
    !Number.isInteger(Number(row.distinct_blocked_phone_count))
  )
    return { checked: false, customerConflictRecipientKeys: [], distinctBlockedPhoneCount: 0 };
  return {
    checked: true,
    customerConflictRecipientKeys: row.conflict_recipient_keys.map(String),
    distinctBlockedPhoneCount: Number(row.distinct_blocked_phone_count),
  };
}
export async function getEnquiryForwardingSettings(
  actor: Actor,
  query = queryRows,
): Promise<EnquiryForwardingSettings> {
  await authorize(actor, query);
  if (!(await forwardingSchemaAvailable(query)))
    return { available: false, recipients: [], routes: [], counts: {}, providerCheck: null };
  const [registered, routes, desired, check, counts] = await Promise.all([
    query(
      "SELECT recipient_key,phone,version,enabled,verified_at,retired_at FROM enquiry_notification_recipients",
    ),
    query(
      "SELECT scope_key,label,manager_recipient_key,version,enabled FROM enquiry_estate_routes ORDER BY district_scope,manager_recipient_key,label",
    ),
    desiredRecipients(query),
    providerCheck(query),
    query(
      "SELECT dispatch_state,count(*)::int AS n FROM staff_notification_attempts WHERE routing_snapshot->>'purpose'='enquiry_forward' AND created_at>now()-interval '7 days' GROUP BY dispatch_state UNION ALL SELECT 'needs_review',count(DISTINCT (routing_snapshot->>'source')||':'||COALESCE(lead_id,forwarding_inquiry_id)::text)::int FROM staff_notification_attempts WHERE routing_snapshot->>'purpose'='enquiry_forward' AND created_at>now()-interval '7 days' AND (routing_snapshot->>'routingKind'='review' OR routing_snapshot->>'reason'='property_sales_unavailable')",
    ),
  ]);
  const byKey = new Map(registered.map((row) => [String(row.recipient_key), row]));
  const metadata = check?.metadata as Record<string, unknown> | undefined;
  const recipients: EnquiryRecipientSetting[] = desired.map((recipient) => {
    const saved = byKey.get(recipient.key);
    return {
      key: recipient.key,
      kind: recipient.kind,
      name: recipient.displayName ?? (recipient.kind === "copy" ? "固定副本" : recipient.key),
      phone: recipient.phone,
      version: saved ? Number(saved.version) : null,
      enabled: saved?.enabled === true && saved?.retired_at == null,
      verified: saved?.verified_at != null && saved.phone === recipient.phone,
    };
  });
  return {
    available: true,
    recipients,
    routes: routes.map((row) => ({
      key: String(row.scope_key),
      label: String(row.label),
      managerKey: String(row.manager_recipient_key),
      version: Number(row.version),
      enabled: row.enabled === true,
    })),
    counts: Object.fromEntries(counts.map((row) => [String(row.dispatch_state), Number(row.n)])),
    recipientReadiness: await recipientReadiness(query, desired, companyChannelId()),
    providerCheck: check
      ? {
          ready: metadata?.ready === true,
          checkedAt: String(check.created_at),
          reasonCodes: Array.isArray(metadata?.reasonCodes)
            ? metadata.reasonCodes.filter((v): v is string => typeof v === "string")
            : ["provider_check_unreadable"],
        }
      : null,
  };
}
export const forwardingEnabledInput = z
  .object({ enabled: z.boolean(), expectedCopyVersion: z.number().int().positive() })
  .strict();
export async function setEnquiryForwardingEnabled(
  input: unknown,
  actor: Actor,
  ports: Ports = defaults,
) {
  await authorize(actor, ports.query);
  const data = forwardingEnabledInput.parse(input);
  if (!(await forwardingSchemaAvailable(ports.query)))
    throw new Response("查詢通知資料庫未就緒。", { status: 409 });
  const channel = companyChannelId();
  let evidence: Record<string, unknown> | null = null;
  let desired: Awaited<ReturnType<typeof desiredRecipients>> = [];
  if (data.enabled) {
    const check = await providerCheck(ports.query);
    const metadata = check?.metadata as Record<string, unknown> | undefined;
    const checkedChannel = metadata?.channel as Record<string, unknown> | undefined;
    if (!channel || metadata?.ready !== true || checkedChannel?.configuredChannelId !== channel)
      throw new Response("請先完成 WhatsApp 連接、通知模板及核實設定。", { status: 409 });
    evidence = { ref: `provider-check-audit:${check!.id}`, channel, metadata };
    desired = await desiredRecipients(ports.query);
  }
  const ref = evidence?.ref ?? null;
  const items = desired
    .filter((row) => row.key !== "copy")
    .map((row) => ({ key: row.key, kind: row.kind, staff_id: row.staffId, phone: row.phone }));
  const [, saved] = await ports
    .transaction(
      [
        {
          statement:
            "SELECT id FROM enquiry_notification_recipients WHERE recipient_key='copy' FOR UPDATE",
        },
        {
          statement: `WITH customer_conflicts AS MATERIALIZED (
          ${customerConflictSql("$8", "$3")} AND $2::boolean
        ), gate AS (
        UPDATE enquiry_notification_recipients SET enabled=$2,
          channel_id=CASE WHEN $2 THEN $3 ELSE channel_id END,
          destination_type=CASE WHEN $2 THEN 'recipient_id' ELSE destination_type END,
          destination_reference=CASE WHEN $2 THEN phone ELSE destination_reference END,
          verification_ref=CASE WHEN $2 THEN $4 ELSE verification_ref END,
          verified_at=CASE WHEN $2 THEN now() ELSE verified_at END,
          permission_granted=CASE WHEN $2 THEN true ELSE permission_granted END,
          permission_ref=CASE WHEN $2 THEN $5 ELSE permission_ref END
        WHERE recipient_key='copy' AND version=$1 AND (NOT $2 OR NOT EXISTS(SELECT 1 FROM customer_conflicts)) RETURNING id,version
      ), recipients AS (
        INSERT INTO enquiry_notification_recipients(recipient_key,kind,staff_id,phone,channel_id,destination_type,destination_reference,enabled,verification_ref,verified_at,permission_granted,permission_ref)
        SELECT d.key,d.kind,d.staff_id,d.phone,$3,'recipient_id',d.phone,true,$4,now(),true,$5
        FROM jsonb_to_recordset($6::jsonb) AS d(key text,kind text,staff_id uuid,phone text) CROSS JOIN gate
        WHERE $2
        ON CONFLICT(recipient_key) DO UPDATE SET staff_id=EXCLUDED.staff_id,phone=EXCLUDED.phone,channel_id=EXCLUDED.channel_id,destination_type=EXCLUDED.destination_type,destination_reference=EXCLUDED.destination_reference,enabled=true,verification_ref=EXCLUDED.verification_ref,verified_at=EXCLUDED.verified_at,permission_granted=true,permission_ref=EXCLUDED.permission_ref,retired_at=NULL RETURNING id
      ), paused AS (
        UPDATE enquiry_notification_recipients SET enabled=false WHERE recipient_key<>'copy' AND NOT $2 AND EXISTS(SELECT 1 FROM gate) RETURNING id
      ), audit AS (
        INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
        SELECT $7::uuid,'whatsapp.enquiry_forwarding.configured','enquiry_notification_recipients',id,jsonb_build_object('enabled',$2,'version',version,'recipientCount',jsonb_array_length($6::jsonb),'verificationRef',$4) FROM gate RETURNING id
      ) SELECT (SELECT id FROM gate) AS id,(SELECT version FROM gate) AS version,
        ARRAY(SELECT key FROM customer_conflicts ORDER BY key) AS conflict_recipient_keys,
        (SELECT count(DISTINCT phone)::int FROM customer_conflicts) AS distinct_blocked_phone_count`,
          params: [
            data.expectedCopyVersion,
            data.enabled,
            channel,
            ref,
            ENQUIRY_ROUTING_APPROVAL,
            JSON.stringify(items),
            actor.staffId,
            JSON.stringify(desired.map(({ key, phone }) => ({ key, phone }))),
          ],
        },
      ],
      { isolationLevel: "Serializable" },
    )
    .catch((error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error ? String(error.code) : null;
      if (code === "40001" || code === "40P01")
        throw new Response("設定已變更，請重新整理。", { status: 409 });
      throw error;
    });
  if (data.enabled && Number(saved[0]?.distinct_blocked_phone_count) > 0)
    throw new Response("部分通知電話與現有客戶身份重疊，請先核對身份資料後再啟用。", {
      status: 409,
      headers: { "X-Error-Code": "RECIPIENT_IDENTITY_REVIEW_REQUIRED" },
    });
  if (!saved[0]?.id) throw new Response("設定已變更，請重新整理。", { status: 409 });
  return { version: Number(saved[0].version), enabled: data.enabled };
}
export async function queueEnquiryForwardingCheck(actor: Actor, ports: Ports = defaults) {
  await authorize(actor, ports.query);
  const requestId = randomUUID();
  const rows = await ports.query(
    "WITH job AS (INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key,actor_staff_id) VALUES('woztell.enquiry.forward.readiness',1,'{}','queued',2,now(),$1,$2::uuid) RETURNING id), audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $2::uuid,'whatsapp.enquiry_forwarding.check_requested','ops_job',id,'{}'::jsonb FROM job) SELECT id FROM job",
    [`enquiry-forward-readiness:${requestId}`, actor.staffId],
  );
  const { wakeAfterCommit } = await import("../control-plane/job-wake.server.ts");
  try {
    wakeAfterCommit("service");
  } catch {
    console.warn("[enquiry-forwarding] provider_check_wake_failed");
  }
  return { jobId: String(rows[0].id) };
}
