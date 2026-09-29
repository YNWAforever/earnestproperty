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

export type EnquiryResolutionContext = {
  inquiryId: string;
  version: number;
  publicListingNo: string | null;
  associationReview: boolean;
  providerThreadReview: boolean;
  ownerStaffId: string | null;
  requestedStaffId: string | null;
  propertyId: string | null;
  references: { source: string; externalListingId: string | null; dealType: string | null }[];
  ownerCandidates: { id: string; label: string }[];
  propertyCandidates: { id: string; label: string }[];
  requestedStaffCandidates: { id: string; label: string }[];
};

/** Every candidate is recomputed from current authority; the CAS write rechecks it. */
export async function readEnquiryResolutionContext(
  actor: Pick<StaffAccess, "staffId">,
  inquiryId: string,
  query: typeof queryRows = queryRows,
): Promise<EnquiryResolutionContext> {
  const [row] = await query<{
    id: string;
    enquiry_version: number;
    public_listing_no: string | null;
    association_review: boolean;
    provider_thread_review: boolean;
    enquiry_owner_staff_id: string | null;
    requested_staff_id: string | null;
    property_id: string | null;
  }>(
    `SELECT i.id,i.enquiry_version,i.public_listing_no,i.association_review,
      i.provider_thread_review,i.enquiry_owner_staff_id,i.requested_staff_id,
      CASE WHEN i.enquiry_resolution ? 'propertyId'
        THEN NULLIF(i.enquiry_resolution->>'propertyId','')::uuid ELSE i.property_id END AS property_id
      FROM inquiries i WHERE i.id=$1::uuid AND i.source='whatsapp'
      AND wa_can_read_enquiry($2::uuid,i.id)`,
    [inquiryId, actor.staffId],
  );
  if (!row) throw new Response("Forbidden", { status: 403 });
  const references = await query<{
    source: string;
    external_listing_id: string | null;
    deal_type: string | null;
  }>(
    `SELECT l.source,l.external_listing_id,l.deal_type FROM whatsapp_enquiry_reference_links l
      WHERE l.inquiry_id=$1::uuid AND wa_can_read_enquiry($2::uuid,l.inquiry_id)
      ORDER BY l.created_at,l.event_id,l.ref_index LIMIT 20`,
    [inquiryId, actor.staffId],
  );
  const ownerCandidates = await query<{ id: string; label: string }>(
    `SELECT s.id,COALESCE(NULLIF(s.name_zh,''),NULLIF(s.name_en,''),s.email,'未命名同事') AS label
      FROM staff_users s JOIN staff_users a ON a.id=$2::uuid
      WHERE wa_can_correct_enquiry($2::uuid,$1::uuid) AND s.active
      AND (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='admin')
        OR (a.branch_id IS NOT NULL AND s.branch_id=a.branch_id))
      ORDER BY label,s.id LIMIT 100`,
    [inquiryId, actor.staffId],
  );
  const propertyCandidates = await query<{ id: string; label: string }>(
    `SELECT DISTINCT p.id,COALESCE(pm.public_listing_no,p.listing_no) || ' · ' ||
      COALESCE(NULLIF(p.title_zh,''),'樓盤') AS label
      FROM whatsapp_enquiry_reference_links l
      JOIN mls_source_state state ON state.source=CASE WHEN l.source='28hse'
        THEN '28hse_agent_540' ELSE 'propertyhk' END
        AND state.scope_id=l.scope_id AND state.external_listing_id=l.external_listing_id
        AND state.deal_type::text=l.deal_type
      JOIN properties p ON p.id=state.property_id AND p.status::text='active'
      LEFT JOIN property_public_members pm ON pm.property_id=p.id
      WHERE l.inquiry_id=$1::uuid AND wa_can_correct_enquiry($2::uuid,l.inquiry_id)
        AND state.source_status='active' AND state.last_accepted_at>=now()-interval '30 days'
      ORDER BY label,p.id LIMIT 100`,
    [inquiryId, actor.staffId],
  );
  const requestedStaffCandidates = await query<{ id: string; label: string }>(
    `SELECT DISTINCT staff.id,COALESCE(NULLIF(staff.name_zh,''),NULLIF(staff.name_en,''),staff.email,'未命名同事') AS label
      FROM whatsapp_enquiry_reference_links l
      JOIN whatsapp_portal_interpretations pi ON pi.id=l.interpretation_id
      JOIN whatsapp_inbound_receipts receipt ON receipt.id=l.receipt_id
      JOIN whatsapp_portal_source_scopes scope ON scope.channel_id=receipt.channel_id
        AND scope.source=CASE WHEN l.source='28hse' THEN '28hse_agent_540' ELSE 'propertyhk' END
        AND scope.scope_id=l.scope_id AND scope.enabled
      JOIN staff_external_references ref ON ref.namespace=scope.staff_namespace
        AND ref.external_reference=pi.interpretation->>'requestedStaffText'
        AND ref.valid_from<=now() AND (ref.valid_until IS NULL OR ref.valid_until>now())
        AND ref.verified_at<=now()
      JOIN staff_users staff ON staff.id=ref.staff_id AND staff.active
      WHERE l.inquiry_id=$1::uuid AND wa_can_correct_enquiry($2::uuid,l.inquiry_id)
      ORDER BY label,staff.id LIMIT 100`,
    [inquiryId, actor.staffId],
  );
  return {
    inquiryId: row.id,
    version: Number(row.enquiry_version),
    publicListingNo: row.public_listing_no,
    associationReview: row.association_review,
    providerThreadReview: row.provider_thread_review,
    ownerStaffId: row.enquiry_owner_staff_id,
    requestedStaffId: row.requested_staff_id,
    propertyId: row.property_id,
    references: references.map((ref) => ({
      source: ref.source,
      externalListingId: ref.external_listing_id,
      dealType: ref.deal_type,
    })),
    ownerCandidates,
    propertyCandidates,
    requestedStaffCandidates,
  };
}
