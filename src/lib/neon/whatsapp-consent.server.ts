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
  const rows = await query(
    `WITH eligible AS (
      SELECT c.id FROM crm_contacts c
      WHERE c.id = $1::uuid AND EXISTS (
        SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id = s.id
        WHERE s.id = $3::uuid AND s.active = true AND r.role IN ('admin', 'manager')
      ) FOR UPDATE OF c
    ), changed AS (
      UPDATE crm_contacts c SET opt_in_whatsapp = $2, opted_out_whatsapp = NOT $2, updated_at = now()
      FROM eligible e WHERE c.id = e.id RETURNING c.id, c.opt_in_whatsapp AS opted_in
    ), evidence AS (
      INSERT INTO crm_consent_events (contact_id, opted_in, source, evidence_ref, copy_version, actor_staff_id)
      SELECT id, opted_in, $4, $5, $6, $3::uuid FROM changed RETURNING id
    ), audit AS (
      INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
      SELECT $3::uuid, 'contact.marketing_consent', 'contact', id,
        jsonb_build_object('optedIn', opted_in, 'source', $4::text, 'copyVersion', $6::text)
      FROM changed RETURNING id
    ) SELECT id, opted_in FROM changed`,
    [
      input.contactId,
      input.optedIn,
      actor.staffId,
      input.evidenceSource,
      input.evidenceRef,
      "whatsapp-marketing-v1",
    ],
  );
  if (!rows[0]) throw new Response("Forbidden", { status: 403 });
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
