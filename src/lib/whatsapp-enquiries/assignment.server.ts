import { mappingConflict } from "../neon/staff-mapping-review.server.ts";
import { wakeAfterCommit } from "../control-plane/job-wake.server.ts";
import "@tanstack/react-start/server-only";
import { createInboxApi } from "../woztell/inbox-api.server.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryRows, transactionRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server";
import {
  classifyAssignmentExecution,
  selectAssignment,
  selectNoLinkAssignment,
} from "./assignment-policy.ts";
type Ports = { query: typeof queryRows; transaction: typeof transactionRows };
const defaultPorts: Ports = { query: queryRows, transaction: transactionRows };
type Actor = Pick<StaffAccess, "staffId" | "roles">;
function manager(actor: Actor) {
  if (!actor.roles.some((r) => r === "admin" || r === "manager"))
    throw new Response("Forbidden", { status: 403 });
}

async function requireActiveManager(actor: Actor, query: typeof queryRows) {
  manager(actor);
  const rows = await query(
    `SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1`,
    [actor.staffId],
  );
  if (!rows.length) throw new Response("Forbidden", { status: 403 });
}
export async function assignmentSchemaAvailable() {
  const [r] = await queryRows(
    `SELECT to_regclass('whatsapp_assignment_requests') IS NOT NULL AS available`,
  );
  return r?.available === true;
}
const requestSchema = z
  .object({
    conversationId: z.string().uuid(),
    staffId: z.string().uuid().nullable(),
    reason: z.enum(["manual", "manager", "handover"]),
  })
  .strict();
export async function requestConversationAssignment(
  value: unknown,
  actor: Actor,
  ports: Ports = defaultPorts,
) {
  const { transaction: transactionRows } = ports;
  manager(actor);
  const input = requestSchema.parse(value);
  const result = await transactionRows([
    {
      statement: `SELECT set_config('app.wa_assignment_actor',$1,true),set_config('app.wa_assignment_reason',$2,true)`,
      params: [actor.staffId, input.reason],
    },
    {
      statement: `SELECT w.pending_assignment_id,w.assignment_version,w.assigned_agent_id FROM whatsapp_conversations w
WHERE w.id=$1::uuid AND wa_can_read_conversation($2::uuid,w.id) AND EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$2::uuid AND s.active AND r.role IN ('admin','manager'))
FOR UPDATE OF w`,
      params: [input.conversationId, actor.staffId],
    },
    {
      statement: `UPDATE whatsapp_conversations w SET assigned_agent_id=$2::uuid,updated_at=now()
WHERE w.id=$1::uuid AND wa_can_read_conversation($3::uuid,w.id) AND EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$3::uuid AND s.active AND r.role IN ('admin','manager'))
AND w.assigned_agent_id IS DISTINCT FROM $2::uuid
AND NOT EXISTS(SELECT 1 FROM whatsapp_assignment_requests r WHERE r.id=w.pending_assignment_id AND r.desired_staff_id IS NOT DISTINCT FROM $2::uuid AND r.state IN ('pending','executing','unknown'))
RETURNING pending_assignment_id,assignment_version,assigned_agent_id`,
      params: [input.conversationId, input.staffId, actor.staffId],
    },
  ]);
  const previous = result[1]?.[0];
  if (!previous) throw new Response("Forbidden", { status: 403 });
  const updated = result[2]?.[0];
  const assignment = updated ?? previous;
  if (
    updated?.pending_assignment_id &&
    Number(updated.assignment_version) > Number(previous.assignment_version)
  )
    wakeAfterCommit("service");
  return {
    ok: true,
    assignment: {
      pending_assignment_id: assignment.pending_assignment_id as string | null,
      assignment_version: Number(assignment.assignment_version),
      assigned_agent_id: assignment.assigned_agent_id as string | null,
    },
    notice: "分派要求已記錄；待 WOZTELL 確認。",
  };
}
export async function readAssignmentContext(
  conversationId: string,
  actor: Actor,
  ports: Ports = defaultPorts,
) {
  const { query: queryRows, transaction: transactionRows } = ports;
  z.string().uuid().parse(conversationId);
  if (!actor.roles.some((r) => ["admin", "manager", "agent"].includes(r)))
    throw new Response("Forbidden", { status: 403 });
  const global = actor.roles.some((r) => r === "admin" || r === "manager");
  const [authorized] = await queryRows(
    `SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role=ANY($2::staff_role[]) LIMIT 1`,
    [actor.staffId, global ? ["admin", "manager"] : ["agent"]],
  );
  if (!authorized) throw new Response("Forbidden", { status: 403 });
  const [row] = await queryRows(
    `SELECT w.assignment_version,w.assignment_lock,w.confirmed_staff_id,w.assigned_agent_id,
 (SELECT COALESCE(NULLIF(s.name_zh,''),NULLIF(s.name_en,'')) FROM staff_users s WHERE s.id=w.confirmed_staff_id) AS confirmed_staff_name,
 r.id AS request_id,r.desired_staff_id,r.state AS assignment_state,r.evidence,
 (SELECT COALESCE(NULLIF(s.name_zh,''),NULLIF(s.name_en,'')) FROM staff_users s WHERE s.id=r.desired_staff_id) AS desired_staff_name,
 (SELECT jsonb_agg(jsonb_build_object('id',i.id,'property',i.public_listing_no,'source',i.placement_source,'requestedStaffId',i.requested_staff_id,'requestedStaffName',(SELECT COALESCE(NULLIF(s.name_zh,''),NULLIF(s.name_en,'')) FROM staff_users s WHERE s.id=i.requested_staff_id),'dealType',(SELECT p.deal_type FROM properties p WHERE p.id=i.property_id),'firstResponseAt',i.first_human_response_at,'dueAt',i.response_due_at,'review',i.association_review)) FROM inquiries i WHERE i.conversation_id=w.id AND i.source='whatsapp' AND wa_can_read_enquiry($2::uuid,i.id) AND i.status NOT IN ('closed','resolved','spam')) AS enquiries
 FROM whatsapp_conversations w LEFT JOIN whatsapp_assignment_requests r ON r.id=w.pending_assignment_id WHERE w.id=$1::uuid AND wa_can_read_conversation($2::uuid,w.id)`,
    [conversationId, actor.staffId],
  );
  if (!row) {
    // Global staff may distinguish a missing conversation from an inaccessible
    // one; agents must not be able to enumerate conversations they do not own.
    if (global) {
      const [exists] = await queryRows("SELECT id FROM whatsapp_conversations WHERE id=$1::uuid", [
        conversationId,
      ]);
      if (!exists) throw new Response("Not Found", { status: 404 });
    }
    throw new Response("Forbidden", { status: 403 });
  }
  const proposal = await proposedConversationAssignment(conversationId, ports);
  const [proposedStaff] = proposal.staffId
    ? await queryRows<{ name: string | null }>(
        `SELECT COALESCE(NULLIF(name_zh,''),NULLIF(name_en,'')) AS name FROM staff_users WHERE id=$1::uuid`,
        [proposal.staffId],
      )
    : [];
  return {
    ...row,
    proposedStaffName: proposedStaff?.name ?? null,
    assignment_version: Number(row.assignment_version),
    proposedStaffId: proposal.staffId,
    proposalReason: proposal.reason,
  } as AssignmentContextDto;
}
const mappingSchema = z
  .object({
    staffId: z.string().uuid(),
    inboxUserId: z.string().trim().min(1).max(120),
    folderId: z.string().trim().min(1).max(120),
    routingNodeId: z.string().trim().max(120),
    branchId: z.string().trim().max(120).nullable(),
    verificationRef: z.string().trim().min(1).max(160),
    eligible: z.boolean(),
    expectedVersion: z.number().int().positive().nullable(),
  })
  .strict();
export async function saveStaffChannel(value: unknown, actor: Actor, ports: Ports = defaultPorts) {
  const { query: queryRows } = ports;
  manager(actor);
  const input = mappingSchema.parse(value);
  const channel = process.env.EP_WA_COMPANY_CHANNEL_ID;
  if (!channel) throw new Response("COMPANY_CHANNEL_NOT_CONFIGURED", { status: 409 });
  // This is the legacy manual-review path. It never upgrades evidence to provider verification.
  // A provider-reviewed mapping cannot be overwritten through this compatibility endpoint.
  let row: { id: string; version: number } | undefined;
  try {
    [row] = await queryRows<{ id: string; version: number }>(
      `WITH candidate AS (
         SELECT s.id FROM staff_users s WHERE s.id=$1::uuid AND s.active
         AND EXISTS(SELECT 1 FROM staff_users a JOIN staff_roles r ON r.staff_user_id=a.id
           WHERE a.id=$9::uuid AND a.active AND r.role IN ('admin','manager'))
         AND (($10::int IS NULL AND NOT EXISTS(
           SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=s.id AND m.channel_id=$2
         )) OR ($10::int IS NOT NULL AND EXISTS(
           SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=s.id AND m.channel_id=$2
             AND m.version=$10::int AND NOT m.review_enforced
         )))
       ), changed AS (
         INSERT INTO whatsapp_staff_channels(
           staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,branch_id,
           verification_ref,eligible,verified_at,verified_by,review_basis,review_enforced
         )
         SELECT id,$2,$3,$4,$5,$6,$7,$8,now(),$9::uuid,'legacy_manual',false FROM candidate
         ON CONFLICT(channel_id,staff_id) DO UPDATE SET
           inbox_user_id=EXCLUDED.inbox_user_id,folder_id=EXCLUDED.folder_id,
           routing_node_id=EXCLUDED.routing_node_id,branch_id=EXCLUDED.branch_id,
           verification_ref=EXCLUDED.verification_ref,eligible=EXCLUDED.eligible,
           verified_at=EXCLUDED.verified_at,verified_by=EXCLUDED.verified_by,
           retired_at=NULL,review_basis='legacy_manual',review_evidence_id=NULL
         WHERE whatsapp_staff_channels.version=$10::int
           AND NOT whatsapp_staff_channels.review_enforced
         RETURNING id,version
       ), audit AS (
         INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
         SELECT $9::uuid,'whatsapp.mapping.review','staff_channel',id,
           jsonb_build_object('evidenceRef',$7::text,'basis','legacy_manual','version',version)
         FROM changed RETURNING id
       )
       SELECT id,version FROM changed`,
      [
        input.staffId,
        channel,
        input.inboxUserId,
        input.folderId,
        input.routingNodeId,
        input.branchId,
        input.verificationRef,
        input.eligible,
        actor.staffId,
        input.expectedVersion,
      ],
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "23505")
      return mappingConflict(
        queryRows,
        "staff",
        input.staffId,
        channel,
        "MAPPING_IDENTITY_CONFLICT",
      );
    throw error;
  }
  if (!row) return mappingConflict(queryRows, "staff", input.staffId, channel);
  return { ok: true, version: Number(row.version) };
}
export async function listStaffChannels(actor: Actor, ports: Ports = defaultPorts) {
  const { query: queryRows } = ports;
  await requireActiveManager(actor, queryRows);
  const channel = process.env.EP_WA_COMPANY_CHANNEL_ID;
  if (!channel) throw new Response("COMPANY_CHANNEL_NOT_CONFIGURED", { status: 409 });
  return queryRows<StaffChannelDto>(
    `SELECT m.*,COALESCE(s.name_zh,s.name_en) AS name FROM whatsapp_staff_channels m JOIN staff_users s ON s.id=m.staff_id WHERE m.channel_id=$1 ORDER BY COALESCE(s.name_zh,s.name_en),m.id`,
    [channel],
  );
}
export async function proposedConversationAssignment(
  conversationId: string,
  ports: Ports = defaultPorts,
) {
  const { query: queryRows, transaction: transactionRows } = ports;
  const rows = await queryRows(
    `SELECT w.assigned_agent_id,w.assignment_lock,i.requested_staff_id,i.enquiry_owner_staff_id,i.association_review,i.attribution_method,i.link_open_id,p.agent_id AS offer_owner_id,m.staff_id
 FROM whatsapp_conversations w LEFT JOIN LATERAL(SELECT requested_staff_id,property_id,enquiry_owner_staff_id,association_review,attribution_method,link_open_id FROM inquiries WHERE conversation_id=w.id ORDER BY created_at DESC LIMIT 1)i ON true
 LEFT JOIN properties p ON p.id=i.property_id LEFT JOIN whatsapp_staff_channels m ON m.channel_id=w.channel_id AND m.eligible AND m.retired_at IS NULL AND EXISTS(SELECT 1 FROM staff_users s WHERE s.id=m.staff_id AND s.active) WHERE w.id=$1::uuid`,
    [conversationId],
  );
  const row = rows[0];
  if (!row) return { staffId: null, reason: "routing_exception" };
  const eligible = new Set(rows.flatMap((r) => (r.staff_id ? [String(r.staff_id)] : [])));
  if (row.attribution_method === "explicit_customer_statement" && !row.link_open_id)
    return selectNoLinkAssignment(
      {
        associationReview: row.association_review === true,
        conversationAssigneeId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
        requestedStaffId: row.requested_staff_id ? String(row.requested_staff_id) : null,
        publicationOwnerId: row.offer_owner_id ? String(row.offer_owner_id) : null,
        enquiryOwnerId: row.enquiry_owner_staff_id ? String(row.enquiry_owner_staff_id) : null,
      },
      eligible,
    );
  return selectAssignment(
    {
      protected: row.assignment_lock === true,
      protectedStaffId: row.assignment_lock ? String(row.assigned_agent_id ?? "") : null,
      coordinatorStaffId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
      requestedStaffId: row.requested_staff_id ? String(row.requested_staff_id) : null,
      offerOwnerId: row.offer_owner_id ? String(row.offer_owner_id) : null,
    },
    eligible,
  );
}
export type AssignmentProvider = {
  execute: (scope: {
    channelId: string;
    memberId: string;
    inboxUserId: string;
    folderId: string;
    nodeId: string;
    requestId: string;
    version: number;
    beforeSend?: () => Promise<void>;
  }) => Promise<{ accepted: boolean; definitivelyRefused?: boolean }>;
  readAuthoritativeAssignment: (scope: {
    channelId: string;
    memberId: string;
  }) => Promise<{ inboxUserId: string; folderId: string }>;
};
/** No live adapter can be created until the tenant's execution/readback contract is verified. */
export function createLiveAssignmentProvider(): AssignmentProvider {
  return createInboxApi();
}
export async function executeAssignment(
  requestId: string,
  provider: AssignmentProvider,
  ports: Ports = defaultPorts,
) {
  const { query: queryRows, transaction: transactionRows } = ports;
  z.string().uuid().parse(requestId);
  if (
    ports === defaultPorts &&
    (process.env.EP_WA_ROUTING_ENABLED !== "true" || process.env.EP_WA_ENQUIRY_MODE !== "active")
  )
    return { state: "blocked" };
  const claim = randomUUID();
  const result = await transactionRows([
    {
      statement: `SELECT w.id FROM whatsapp_conversations w JOIN whatsapp_assignment_requests r ON r.conversation_id=w.id WHERE r.id=$1::uuid FOR UPDATE OF w`,
      params: [requestId],
    },
    {
      statement: `WITH claimed AS (UPDATE whatsapp_assignment_requests r SET state='executing',claim_id=$2::uuid,started_at=now(),target_snapshot=jsonb_build_object('inboxUserId',m.inbox_user_id,'folderId',m.folder_id,'nodeId',m.routing_node_id) FROM whatsapp_conversations w,whatsapp_staff_channels m,staff_users s
 WHERE r.id=$1::uuid AND r.conversation_id=w.id AND r.state='pending' AND r.id=w.pending_assignment_id AND r.version=w.assignment_version
 AND m.staff_id=r.desired_staff_id AND m.channel_id=w.channel_id AND m.eligible AND m.retired_at IS NULL AND s.id=m.staff_id AND s.active AND EXISTS(SELECT 1 FROM staff_roles role WHERE role.staff_user_id=s.id AND role.role IN ('agent','manager','admin'))
 AND NOT EXISTS(SELECT 1 FROM whatsapp_assignment_requests x WHERE x.conversation_id=w.id AND x.state IN ('executing','unknown')) RETURNING r.*)
 SELECT c.*,w.channel_id,w.woztell_member_id,m.inbox_user_id,m.folder_id,m.routing_node_id FROM claimed c JOIN whatsapp_conversations w ON w.id=c.conversation_id JOIN whatsapp_staff_channels m ON m.staff_id=c.desired_staff_id AND m.channel_id=w.channel_id`,
      params: [requestId, claim],
    },
  ]);
  const row = result[1]?.[0];
  if (!row) return { state: "blocked" };
  let state: "unknown" | "failed" = "unknown";
  const beforeSend = async () => {
    const [valid] = await queryRows(
      "SELECT r.id FROM whatsapp_assignment_requests r JOIN whatsapp_conversations w ON w.pending_assignment_id=r.id JOIN staff_users s ON s.id=r.desired_staff_id JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=w.channel_id WHERE r.id=$1::uuid AND r.claim_id=$2::uuid AND r.state='executing' AND w.assignment_version=r.version AND s.active AND m.eligible AND m.retired_at IS NULL AND m.inbox_user_id=r.target_snapshot->>'inboxUserId' AND m.folder_id=r.target_snapshot->>'folderId' AND EXISTS(SELECT 1 FROM staff_roles role WHERE role.staff_user_id=s.id AND role.role IN ('agent','manager','admin'))",
      [requestId, claim],
    );
    if (
      !valid ||
      (ports === defaultPorts &&
        (process.env.EP_WA_ROUTING_ENABLED !== "true" ||
          process.env.EP_WA_ENQUIRY_MODE !== "active"))
    )
      throw Object.assign(new Error("WA_ASSIGNMENT_PREFLIGHT_BLOCKED"), {
        code: "WA_ASSIGNMENT_PREFLIGHT_BLOCKED",
      });
  };
  try {
    await beforeSend();
    state = classifyAssignmentExecution(
      await provider.execute({
        channelId: String(row.channel_id),
        memberId: String(row.woztell_member_id),
        inboxUserId: String(row.inbox_user_id),
        folderId: String(row.folder_id),
        nodeId: String(row.routing_node_id),
        requestId,
        version: Number(row.version),
        beforeSend,
      }),
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "WA_ASSIGNMENT_PREFLIGHT_BLOCKED"
    )
      state = "failed";
    /* An uncertain irreversible execution is never retried. */
  }
  await queryRows(
    `UPDATE whatsapp_assignment_requests SET state=$3,finished_at=now(),evidence=jsonb_build_object('executionOnly',true) WHERE id=$1::uuid AND claim_id=$2::uuid AND state='executing'`,
    [requestId, claim, state],
  );
  return { state };
}
/** Reconcile from an authoritative read, never from unsigned callbacks or execution acceptance. */
export async function reconcileAssignment(
  requestId: string,
  provider: AssignmentProvider,
  ports: Ports = defaultPorts,
) {
  const { query: queryRows, transaction: transactionRows } = ports;
  const [row] = await queryRows(
    `SELECT r.*,w.channel_id,w.woztell_member_id,r.target_snapshot->>'inboxUserId' AS inbox_user_id,r.target_snapshot->>'folderId' AS folder_id FROM whatsapp_assignment_requests r JOIN whatsapp_conversations w ON w.id=r.conversation_id JOIN whatsapp_staff_channels m ON m.staff_id=r.desired_staff_id AND m.channel_id=w.channel_id WHERE r.id=$1::uuid AND r.state IN ('executing','unknown')`,
    [requestId],
  );
  if (!row) {
    const [confirmed] = await queryRows(
      "SELECT id FROM whatsapp_assignment_requests WHERE id=$1::uuid AND state='confirmed'",
      [requestId],
    );
    if (confirmed) {
      const [schema] = await queryRows(
        "SELECT to_regclass('whatsapp_service_actions') IS NOT NULL available",
      );
      if (schema?.available) {
        const { reconcileServiceManagerAck } = await import("./service-workflow.server.ts");
        await reconcileServiceManagerAck(requestId, ports);
      }
    }
    return { confirmed: !!confirmed };
  }
  const actual = await provider.readAuthoritativeAssignment({
    channelId: String(row.channel_id),
    memberId: String(row.woztell_member_id),
  });
  const matches = actual.inboxUserId === row.inbox_user_id && actual.folderId === row.folder_id;
  const result = await transactionRows([
    {
      statement: `SELECT id FROM whatsapp_conversations WHERE id=$1::uuid FOR UPDATE`,
      params: [row.conversation_id],
    },
    { statement: `SELECT set_config('app.wa_confirm_assignment','true',true)` },
    {
      statement: `WITH verified AS (UPDATE whatsapp_assignment_requests r SET state=CASE WHEN $2::boolean THEN 'confirmed' ELSE 'unknown' END,evidence=$3::jsonb,finished_at=now() WHERE r.id=$1::uuid AND r.state IN ('unknown','executing') AND EXISTS(SELECT 1 FROM whatsapp_conversations c WHERE c.id=r.conversation_id AND c.assignment_version=r.version AND c.pending_assignment_id=r.id) AND EXISTS(SELECT 1 FROM whatsapp_staff_channels m JOIN staff_users s ON s.id=m.staff_id WHERE m.staff_id=r.desired_staff_id AND m.channel_id=$4 AND m.eligible AND m.retired_at IS NULL AND s.active AND EXISTS(SELECT 1 FROM staff_roles role WHERE role.staff_user_id=s.id AND role.role IN ('agent','manager','admin')) AND m.inbox_user_id=r.target_snapshot->>'inboxUserId' AND m.folder_id=r.target_snapshot->>'folderId') RETURNING *) UPDATE whatsapp_conversations w SET confirmed_staff_id=r.desired_staff_id,assigned_agent_id=r.desired_staff_id,updated_at=now() FROM verified r WHERE w.id=r.conversation_id AND w.assignment_version=r.version AND w.pending_assignment_id=r.id AND r.state='confirmed' RETURNING w.id`,
      params: [
        requestId,
        matches,
        JSON.stringify({ authoritative: true, ...actual }),
        row.channel_id,
      ],
    },
  ]);
  if (result[2]?.length) {
    const [schema] = await queryRows(
      "SELECT to_regclass('whatsapp_service_actions') IS NOT NULL available",
    );
    if (schema?.available) {
      const { reconcileServiceManagerAck } = await import("./service-workflow.server.ts");
      await reconcileServiceManagerAck(requestId, ports);
    }
  }
  return { confirmed: !!result[2]?.length };
}
export async function readEnquiryQueue(actor: Actor, ports: Ports = defaultPorts) {
  const { query: queryRows, transaction: transactionRows } = ports;
  await requireActiveManager(actor, queryRows);
  return queryRows<EnquiryQueueDto>(
    `SELECT i.id,i.conversation_id,i.public_listing_no,i.service_state,i.response_due_at,i.association_review,w.confirmed_staff_id,r.state AS assignment_state FROM inquiries i JOIN whatsapp_conversations w ON w.id=i.conversation_id LEFT JOIN whatsapp_assignment_requests r ON r.id=w.pending_assignment_id WHERE i.source='whatsapp' AND wa_can_read_enquiry($1::uuid,i.id) AND i.status NOT IN ('closed','resolved','spam') AND (i.first_human_response_at IS NULL OR i.association_review OR r.state IN ('failed','unknown')) ORDER BY i.response_due_at ASC NULLS LAST,i.created_at ASC LIMIT 100`,
    [actor.staffId],
  );
}

export type AssignmentContextDto = {
  proposedStaffId: string | null;
  proposedStaffName: string | null;
  proposalReason: string;
  assignment_version: number;
  assignment_lock: boolean;
  confirmed_staff_id: string | null;
  confirmed_staff_name: string | null;
  assigned_agent_id: string | null;
  request_id: string | null;
  desired_staff_id: string | null;
  desired_staff_name: string | null;
  assignment_state: string | null;
  evidence: Record<string, string | boolean> | null;
  enquiries:
    | {
        id: string;
        property: string | null;
        source: string | null;
        requestedStaffId: string | null;
        requestedStaffName: string | null;
        dealType: string | null;
        firstResponseAt: string | null;
        dueAt: string | null;
        review: boolean;
      }[]
    | null;
};
export type StaffChannelDto = {
  id: string;
  staff_id: string;
  channel_id: string;
  version: number;
  review_basis: "legacy_manual" | "provider_verified";
  review_enforced: boolean;
  retired_at: string | null;
  name: string | null;
  inbox_user_id: string;
  folder_id: string;
  routing_node_id: string;
  branch_id: string | null;
  eligible: boolean;
  verified_at: string | null;
};
export type EnquiryQueueDto = {
  id: string;
  conversation_id: string;
  public_listing_no: string | null;
  service_state: string;
  response_due_at: string | null;
  association_review: boolean;
  confirmed_staff_id: string | null;
  assignment_state: string | null;
};

/** Persisted signed-live capture is mandatory; the capability table is empty until tenant verification. */
export async function observeQualifiedHumanResponse(
  eventId: string,
  injectedQuery?: typeof queryRows,
) {
  z.string().uuid().parse(eventId);
  const query = injectedQuery ?? queryRows;
  const [schema] = await query(
    `SELECT to_regclass('whatsapp_inbox_evidence_capabilities') IS NOT NULL AS available`,
  );
  if (schema?.available !== true) return false;
  const [row] = await query(`SELECT wa_observe_inbox_response($1::uuid) AS credited`, [eventId]);
  return row?.credited === true;
}
