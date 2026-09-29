import "@tanstack/react-start/server-only";
import { queryRows as defaultQueryRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server.ts";
import { validateForwardedEnquiry, type ForwardedEnquiryInput } from "./forwarded-enquiries.ts";

export async function captureForwardedEnquiry(
  input: ForwardedEnquiryInput,
  actor: StaffAccess,
  query: typeof defaultQueryRows = defaultQueryRows,
) {
  const valid = validateForwardedEnquiry(input);
  const [result] = await query<{ lead_id: string; created: boolean }>(
    `SELECT * FROM wa_capture_forwarded_enquiry($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz,
       $7,$8,$9,$10::timestamptz,$11::uuid)`,
    [
      actor.staffId,
      valid.requestId,
      valid.text,
      valid.sourceUrl,
      valid.originalCustomerContact,
      valid.originalReceivedAt,
      valid.note,
      valid.businessSource,
      valid.followUpTitle,
      valid.followUpDueAt,
      valid.responsibleStaffId,
    ],
  );
  if (!result) throw Error("轉交未能保存。");
  return { leadId: result.lead_id, created: result.created };
}

/** Extra original-contact evidence is readable only through the CRM lead's current scope. */
export async function readForwardedEnquiry(
  leadId: string,
  actor: StaffAccess,
  query: typeof defaultQueryRows = defaultQueryRows,
) {
  const [row] = await query<{
    raw_text: string;
    business_source: string;
    source_url: string | null;
    original_customer_contact: string | null;
    original_received_at: Date | string | null;
    note: string | null;
    forwarded_by_name: string | null;
  }>(
    `SELECT f.raw_text,f.business_source,f.source_url,f.original_customer_contact,
       f.original_received_at,f.note,
       COALESCE(NULLIF(s.name_zh,''),NULLIF(s.name_en,''),s.email) AS forwarded_by_name
     FROM whatsapp_forwarded_enquiries f JOIN crm_leads l ON l.id=f.crm_lead_id
     JOIN staff_users s ON s.id=f.forwarded_by
     JOIN staff_users actor ON actor.id=$2::uuid AND actor.active
     WHERE f.crm_lead_id=$1::uuid AND (
       l.assigned_agent_id=$2::uuid OR EXISTS(
         SELECT 1 FROM staff_roles r WHERE r.staff_user_id=actor.id
         AND r.role::text IN ('admin','manager')))
     LIMIT 1`,
    [leadId, actor.staffId],
  );
  return row ?? null;
}
export async function readLeadConversationLinks(
  leadId: string,
  actor: StaffAccess,
  query: typeof defaultQueryRows = defaultQueryRows,
) {
  return query<{ id: string }>(
    `SELECT c.id FROM crm_leads l JOIN whatsapp_conversations c
      ON c.contact_id=l.contact_id AND l.contact_id IS NOT NULL
     JOIN staff_users actor ON actor.id=$2::uuid AND actor.active
     WHERE l.id=$1::uuid AND (
       l.assigned_agent_id=$2::uuid OR EXISTS(
         SELECT 1 FROM staff_roles r WHERE r.staff_user_id=actor.id
         AND r.role::text IN ('admin','manager')))
       AND wa_can_read_conversation($2::uuid,c.id)
     ORDER BY c.created_at DESC,c.id DESC LIMIT 5`,
    [leadId, actor.staffId],
  );
}
export async function updateLeadContact(
  input: { leadId: string; name: string | null; email: string | null },
  actor: StaffAccess,
  query: typeof defaultQueryRows = defaultQueryRows,
) {
  const name = input.name?.trim() || null;
  const email = input.email?.trim() || null;
  if (
    (name?.length ?? 0) > 160 ||
    (email?.length ?? 0) > 254 ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Response("Invalid contact", { status: 400 });
  const [row] = await query<{ contact_id: string }>(
    `SELECT * FROM wa_update_lead_contact($1::uuid,$2::uuid,$3,$4)`,
    [actor.staffId, input.leadId, name, email],
  );
  if (!row) throw new Response("Forbidden", { status: 403 });
  return { contactId: row.contact_id };
}
