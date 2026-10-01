import "@tanstack/react-start/server-only";
import { queryRows as defaultQueryRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server.ts";
import {
  validateForwardedEnquiry,
  validateLeadContactUpdate,
  type ForwardedEnquiryInput,
  type LeadContactUpdateInput,
} from "./forwarded-enquiries.ts";

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
  input: LeadContactUpdateInput,
  actor: StaffAccess,
  query: typeof defaultQueryRows = defaultQueryRows,
) {
  let valid: LeadContactUpdateInput;
  try {
    valid = validateLeadContactUpdate(input);
  } catch {
    throw new Response("Invalid contact", { status: 400 });
  }
  let row: { kind: "ok" | "forbidden" | "stale"; contact_id: string | null } | undefined;
  try {
    [row] = await query<{ kind: "ok" | "forbidden" | "stale"; contact_id: string | null }>(
      `WITH locked_lead AS MATERIALIZED (
         SELECT l.id AS lead_id,l.contact_id,
           EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=actor.id AND r.role::text IN ('admin','manager')) AS privileged
         FROM crm_leads l JOIN staff_users actor ON actor.id=$1::uuid AND actor.active
         WHERE l.id=$2::uuid
           AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=actor.id AND r.role::text IN ('admin','manager','agent'))
           AND (l.assigned_agent_id=actor.id OR EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=actor.id AND r.role::text IN ('admin','manager')))
         FOR UPDATE OF l
       ), locked_contact AS MATERIALIZED (
         SELECT c.id,c.name,c.email,l.lead_id,l.privileged
         FROM locked_lead l JOIN crm_contacts c ON c.id=l.contact_id
         FOR UPDATE OF c
       ), scoped AS MATERIALIZED (
         SELECT c.* FROM locked_contact c
         WHERE c.privileged OR NOT EXISTS(SELECT 1 FROM crm_leads other
           WHERE other.contact_id=c.id AND other.assigned_agent_id IS DISTINCT FROM $1::uuid)
       ), eligible AS MATERIALIZED (
         SELECT c.lead_id FROM scoped c
         WHERE c.id=$5::uuid AND (
           (c.name,c.email) IS NOT DISTINCT FROM ($6::text,$7::text)
           OR (c.name,c.email) IS NOT DISTINCT FROM ($3::text,$4::text))
       ), updated AS MATERIALIZED (
         SELECT result.contact_id FROM eligible e
         CROSS JOIN LATERAL wa_update_lead_contact($1::uuid,e.lead_id,$3::text,$4::text) result
       )
       SELECT CASE WHEN EXISTS(SELECT 1 FROM updated) THEN 'ok'
         WHEN NOT EXISTS(SELECT 1 FROM scoped) THEN 'forbidden' ELSE 'stale' END AS kind,
         (SELECT contact_id FROM updated LIMIT 1) AS contact_id`,
      [
        actor.staffId,
        valid.leadId,
        valid.name,
        valid.email,
        valid.expectedContactId,
        valid.expectedName,
        valid.expectedEmail,
      ],
    );
  } catch (error) {
    if (error instanceof Error && /\bWA_CONTACT_SCOPE\b/.test(error.message))
      throw new Response("Forbidden", { status: 403 });
    throw error;
  }
  if (!row) throw new Response("Contact unavailable", { status: 503 });
  if (row.kind === "forbidden") throw new Response("Forbidden", { status: 403 });
  if (row.kind === "stale") throw new Response("Contact changed", { status: 409 });
  if (!row.contact_id) throw new Response("Contact unavailable", { status: 503 });
  return { contactId: row.contact_id };
}
