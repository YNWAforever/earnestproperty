import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server.ts";

export type EnquiryAccessContext = {
  actorId: string;
  roles: string[];
  active: boolean;
  actorBranchId: string | null;
  enquiryOwnerId: string | null;
  conversationAssigneeId: string | null;
  providerConfirmedId: string | null;
  responsibleBranchId: string | null;
  providerThreadReview: boolean;
};
export type EnquiryAccess = {
  canRead: boolean;
  canCorrect: boolean;
  canReply: boolean;
  canExport: boolean;
  historyScope: "none" | "enquiry" | "conversation";
};
const denied: EnquiryAccess = {
  canRead: false,
  canCorrect: false,
  canReply: false,
  canExport: false,
  historyScope: "none",
};

export function decideEnquiryAccess(context: EnquiryAccessContext): EnquiryAccess {
  if (!context.active || !context.actorId) return denied;
  const admin = context.roles.includes("admin");
  const manager =
    context.roles.includes("manager") &&
    !!context.actorBranchId &&
    context.actorBranchId === context.responsibleBranchId;
  const agent = context.roles.includes("agent");
  const queryOwner = context.enquiryOwnerId === context.actorId;
  const conversationOwner = context.conversationAssigneeId === context.actorId;
  const canRead = admin || manager || (agent && (queryOwner || conversationOwner));
  if (!canRead) return denied;
  const confirmed = context.providerConfirmedId === context.actorId;
  const canReply =
    confirmed &&
    !context.providerThreadReview &&
    (admin || (agent && (queryOwner || (!context.enquiryOwnerId && conversationOwner))));
  return {
    canRead,
    canCorrect: admin || manager,
    canReply,
    canExport: admin || manager,
    historyScope: admin || conversationOwner ? "conversation" : "enquiry",
  };
}

/** Reads DB roles and branch at request time; client role labels are never authority. */
export async function loadEnquiryAccess(
  actor: Pick<StaffAccess, "staffId">,
  inquiryId: string,
  query: typeof queryRows = queryRows,
): Promise<EnquiryAccess> {
  const [row] = await query<{
    actor_active: boolean;
    actor_branch_id: string | null;
    roles: string[];
    enquiry_owner_id: string | null;
    conversation_assignee_id: string | null;
    provider_confirmed_id: string | null;
    responsible_branch_id: string | null;
    provider_thread_review: boolean;
  }>(
    `SELECT a.active AS actor_active,a.branch_id AS actor_branch_id,
            ARRAY(SELECT role::text FROM staff_roles WHERE staff_user_id=a.id) AS roles,
            i.enquiry_owner_staff_id AS enquiry_owner_id,
            c.assigned_agent_id AS conversation_assignee_id,
            c.confirmed_staff_id AS provider_confirmed_id,
            COALESCE(owner.branch_id,assignee.branch_id) AS responsible_branch_id,
            (i.association_review OR i.provider_thread_review) AS provider_thread_review
     FROM inquiries i JOIN whatsapp_conversations c ON c.id=i.conversation_id
     JOIN staff_users a ON a.id=$2::uuid
     LEFT JOIN staff_users owner ON owner.id=i.enquiry_owner_staff_id
     LEFT JOIN staff_users assignee ON assignee.id=c.assigned_agent_id
     WHERE i.id=$1::uuid AND i.source='whatsapp'`,
    [inquiryId, actor.staffId],
  );
  if (!row) return denied;
  return decideEnquiryAccess({
    actorId: actor.staffId,
    roles: row.roles ?? [],
    active: row.actor_active,
    actorBranchId: row.actor_branch_id,
    enquiryOwnerId: row.enquiry_owner_id,
    conversationAssigneeId: row.conversation_assignee_id,
    providerConfirmedId: row.provider_confirmed_id,
    responsibleBranchId: row.responsible_branch_id,
    providerThreadReview: row.provider_thread_review,
  });
}

/** An enquiry-only owner sees linked customer messages, never an inherited chat transcript. */
export async function readEnquiryMessages(
  actor: Pick<StaffAccess, "staffId">,
  inquiryId: string,
  query: typeof queryRows = queryRows,
) {
  const [allowed] = await query<{ id: string }>(
    "SELECT i.id FROM inquiries i WHERE i.id=$1::uuid AND i.source='whatsapp' AND wa_can_read_enquiry($2::uuid,i.id)",
    [inquiryId, actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  const rows = await query<{ id: string; text: string | null; created_at: string }>(
    `SELECT DISTINCT m.id,m.text,m.created_at
       FROM whatsapp_enquiry_messages em
       JOIN whatsapp_messages m ON m.id=em.message_id AND m.direction='inbound'
       LEFT JOIN whatsapp_enquiry_reference_links ref
         ON ref.event_id=em.event_id AND ref.inquiry_id=$1::uuid
       WHERE (em.inquiry_id=$1::uuid OR ref.inquiry_id=$1::uuid)
         AND wa_can_read_enquiry($2::uuid,$1::uuid)
       ORDER BY m.created_at DESC,m.id DESC LIMIT 50`,
    [inquiryId, actor.staffId],
  );
  return rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at }));
}
