import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { StaffAccess } from "./auth.server";
import { queryRows } from "./db.server.ts";

const schema = z
  .object({
    contactId: z.string().uuid(),
    optedIn: z.boolean(),
    evidenceSource: z.enum(["written_confirmation", "recorded_call", "customer_opt_out"]),
    evidenceRef: z.string().regex(/^[A-Za-z0-9:_./-]{1,120}$/),
  })
  .strict();

export async function setWhatsappMarketingConsent(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  query = queryRows,
) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
  const input = schema.parse(value);
  if (input.optedIn && input.evidenceSource === "customer_opt_out") {
    throw new Response("Opt-in requires affirmative evidence.", { status: 400 });
  }
  // Owner decision 7: confirming a near-miss names the customer's own inbound message.
  const nearMiss =
    /^near-miss:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      input.evidenceRef,
    );
  const nearMissMessageId = !input.optedIn && nearMiss ? nearMiss[1] : null;
  // FX-08: recording 拒收推廣 on a contact who was not opted out stamps staff_recorded
  // evidence. Recording consent clears the flag but keeps every evidence column.
  const rows = await query(
    `WITH eligible AS (
      SELECT c.id FROM crm_contacts c
      WHERE c.id = $1::uuid AND EXISTS (
        SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id = s.id
        WHERE s.id = $3::uuid AND s.active = true AND r.role IN ('admin', 'manager')
      ) FOR UPDATE OF c
    ), near_miss AS (
      SELECT m.external_message_id, left(m.text, 500) AS text FROM whatsapp_messages m
      WHERE m.id = $7::uuid AND m.contact_id = $1::uuid AND m.direction = 'inbound'
    ), guard AS (
      SELECT ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM near_miss)) AS ok
    ), changed AS (
      UPDATE crm_contacts c SET opt_in_whatsapp = $2, opted_out_whatsapp = NOT $2,
        opted_out_at = CASE WHEN NOT $2 AND NOT c.opted_out_whatsapp THEN now() ELSE c.opted_out_at END,
        opted_out_source = CASE WHEN NOT $2 AND NOT c.opted_out_whatsapp THEN 'staff_recorded' ELSE c.opted_out_source END,
        opted_out_message_id = CASE WHEN NOT $2 AND NOT c.opted_out_whatsapp THEN (SELECT external_message_id FROM near_miss) ELSE c.opted_out_message_id END,
        opted_out_text = CASE WHEN NOT $2 AND NOT c.opted_out_whatsapp THEN (SELECT text FROM near_miss) ELSE c.opted_out_text END,
        updated_at = now()
      FROM eligible e, guard g WHERE c.id = e.id AND g.ok RETURNING c.id, c.opt_in_whatsapp AS opted_in
    ), evidence AS (
      INSERT INTO crm_consent_events (contact_id, opted_in, source, evidence_ref, copy_version, actor_staff_id)
      SELECT id, opted_in, $4, $5, $6, $3::uuid FROM changed RETURNING id
    ), audit AS (
      INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
      SELECT $3::uuid, 'contact.marketing_consent', 'contact', id,
        jsonb_build_object('optedIn', opted_in, 'source', $4::text, 'copyVersion', $6::text,
          'evidenceRef', $5::text,
          'trigger', CASE WHEN $7::uuid IS NOT NULL THEN 'near_miss' ELSE 'manual' END)
      FROM changed RETURNING id
    ) SELECT (SELECT ok FROM guard) AS evidence_ok, ch.id, ch.opted_in
      FROM (SELECT 1) one LEFT JOIN changed ch ON true`,
    [
      input.contactId,
      input.optedIn,
      actor.staffId,
      input.evidenceSource,
      input.evidenceRef,
      "whatsapp-marketing-v1",
      nearMissMessageId,
    ],
  );
  if (rows[0]?.evidence_ok === false) {
    // Wrong-recipient guard: the message is unknown, outbound, or another contact's.
    throw new Response("NEAR_MISS_MESSAGE_NOT_FOUND", { status: 400 });
  }
  if (!rows[0]?.id) throw new Response("Forbidden", { status: 403 });
  return { ok: true as const, optedIn: rows[0].opted_in === true };
}

/** Compatibility endpoint for stale clients; a reason cannot restore marketing consent. */
export function rejectLegacyWhatsappOptOutReset(
  actor: Pick<StaffAccess, "staffId" | "roles">,
): never {
  if (!actor.roles.some((role) => role === "admin" || role === "manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
  throw new Response(
    "CONSENT_EVIDENCE_REQUIRED: 請使用「管理 WhatsApp 推廣同意」，明確記錄客戶意願、核實方式及內部憑證編號。",
    { status: 409 },
  );
}
