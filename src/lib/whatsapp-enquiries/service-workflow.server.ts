import "@tanstack/react-start/server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { queryRows, transactionRows, type DbRow } from "../neon/db.server.ts";
import {
  calculateServiceSchedule,
  type ServicePolicy,
  unresolvedServicePolicy,
} from "./service-policy.ts";
import { serviceRulesSchema } from "./policy-admin.server.ts";
import { renderServiceCopy, type ServicePurpose } from "./service-copy.ts";
import { deliverOutboundIntent, finishOutboundIntent } from "../woztell/outbound-intent.server.ts";
export type ServicePorts = { query: typeof queryRows; transaction: typeof transactionRows };
const ports: ServicePorts = { query: queryRows, transaction: transactionRows };
export type ServiceRuntime = {
  enabled: boolean;
  generationId: string | null;
  channelId: string | null;
};
export function serviceRuntime(): ServiceRuntime {
  return {
    enabled:
      process.env.EP_WA_ENQUIRY_MODE === "active" &&
      process.env.EP_WA_SERVICE_AUTOMATION_ENABLED === "true",
    generationId: process.env.EP_WA_ACTIVATION_ID ?? null,
    channelId: process.env.EP_WA_COMPANY_CHANNEL_ID ?? null,
  };
}
export type SurveyReply = { token: string; answer: "satisfied" | "assistance" };
/** The decoder is supplied only by a server-owned, tenant-verified transport adapter. Never infer a provider payload shape. */
export function parseSurveyReply(
  payload: unknown,
  decode?: (value: unknown) => SurveyReply | null,
): SurveyReply | null {
  if (!decode) return null;
  const reply = decode(payload);
  if (
    !reply ||
    !/^[A-Za-z0-9_-]{43}$/.test(reply.token) ||
    !["satisfied", "assistance"].includes(reply.answer)
  )
    return null;
  return reply;
}
export type ServiceTransport = {
  verificationRef: string;
  render: (input: {
    purpose: ServicePurpose;
    text: string;
    token: string | null;
  }) => Record<string, unknown>[];
  send: (input: {
    memberId: string;
    response: Record<string, unknown>[];
  }) => Promise<{ ok: boolean; body?: unknown; refused?: boolean }>;
  decode?: (value: unknown) => SurveyReply | null;
};
export function createLiveServiceTransport(): ServiceTransport {
  throw new Error("WOZTELL_SERVICE_TRANSPORT_UNVERIFIED");
}
function policyFromRow(r: DbRow): ServicePolicy {
  return {
    id: String(r.id),
    version: Number(r.version),
    status: r.status as ServicePolicy["status"],
    approvedBy: r.approved_by ? String(r.approved_by) : null,
    effectiveAt: r.effective_at ? new Date(String(r.effective_at)).toISOString() : null,
    copyVersion: r.copy_version ? String(r.copy_version) : null,
    rules: serviceRulesSchema.parse(
      Object.fromEntries(
        Object.entries(r.rules as Record<string, unknown>).filter(
          ([key]) => key !== "afterHoursCopy",
        ),
      ),
    ),
    copy: { afterHours: (r.rules as Record<string, unknown>).afterHoursCopy as string | null },
  };
}
export async function activateServiceGeneration(
  policyId: string,
  actorStaffId: string,
  p = ports,
  now = new Date(),
) {
  const [r] = await p.query("SELECT * FROM whatsapp_service_policies WHERE id=$1::uuid", [
    policyId,
  ]);
  if (
    !r ||
    unresolvedServicePolicy(policyFromRow(r)).length ||
    new Date(String(r.effective_at)) > now
  )
    throw new Error("WA_POLICY_UNAPPROVED");
  const result = await p.transaction([
    { statement: "SELECT pg_advisory_xact_lock(hashtextextended('wa-activation',0))" },
    {
      statement:
        "UPDATE whatsapp_enquiry_activations SET ended_at=$2::timestamptz WHERE ended_at IS NULL AND EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager'))",
      params: [actorStaffId, now.toISOString()],
    },
    {
      statement:
        "INSERT INTO whatsapp_enquiry_activations(mode,policy_id,created_by,cutover_at) SELECT 'active',$1::uuid,$2::uuid,$3::timestamptz WHERE EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$2::uuid AND s.active AND r.role IN ('admin','manager')) AND EXISTS(SELECT 1 FROM whatsapp_service_policies WHERE id=$1::uuid AND status='approved' AND effective_at<=$3::timestamptz) RETURNING id",
      params: [policyId, actorStaffId, now.toISOString()],
    },
  ]);
  if (!result[2]?.[0]) throw new Response("Forbidden", { status: 403 });
  return String(result[2][0].id);
}
export async function scheduleServiceForEvent(
  eventId: string,
  p = ports,
  runtime = serviceRuntime(),
  now = new Date(),
) {
  if (!runtime.enabled || !runtime.generationId) return { scheduled: 0 };
  const [row] = await p.query(
    `SELECT i.*,e.received_at,e.occurred_at,a.policy_id,p.id AS policy_key,p.version,p.status AS policy_status,p.rules,p.copy_version,p.approved_by,p.effective_at
 FROM whatsapp_enquiry_events e JOIN inquiries i ON i.id=e.inquiry_id AND i.intake_message_id=e.message_id
 JOIN whatsapp_enquiry_activations a ON a.id=e.activation_id JOIN whatsapp_service_policies p ON p.id=a.policy_id
 WHERE e.id=$1::uuid AND e.effects_eligible AND i.effects_eligible AND i.activation_id=e.activation_id AND a.id=$2::uuid AND a.ended_at IS NULL
 AND e.service_eligible AND e.channel_id=$3 AND e.identity_quality='provider_id' AND e.timing='fresh' AND e.received_at>=a.cutover_at`,
    [eventId, runtime.generationId, runtime.channelId],
  );
  if (!row) return { scheduled: 0 };
  const policy = policyFromRow({ ...row, id: row.policy_key, status: row.policy_status });
  const schedule = calculateServiceSchedule(
    policy,
    {
      occurredAt: row.occurred_at ? new Date(String(row.occurred_at)).toISOString() : null,
      receivedAt: new Date(String(row.received_at)).toISOString(),
      entryPointType: row.entry_point_type as "sales" | "reception",
    },
    now,
  );
  if (schedule.status !== "ready") {
    await p.query(
      "UPDATE inquiries SET service_state=$2 WHERE id=$1::uuid AND response_due_at IS NULL",
      [row.id, schedule.status === "unresolved" ? schedule.reasons.join(",") : schedule.reason],
    );
    return { scheduled: 0 };
  }
  const result = await p.transaction([
    { statement: "SELECT id FROM inquiries WHERE id=$1::uuid FOR UPDATE", params: [row.id] },
    {
      statement: `WITH instance AS (INSERT INTO whatsapp_service_surveys(inquiry_id,instance_version,policy_id,activation_id,due_at,expires_at,state)
 SELECT i.id,1,$2::uuid,$3::uuid,$4::timestamptz,$5::timestamptz,'queued' FROM inquiries i JOIN whatsapp_service_policies p ON p.id=$2::uuid JOIN whatsapp_enquiry_activations a ON a.id=$3::uuid
 WHERE i.id=$1::uuid AND i.effects_eligible AND i.activation_id=a.id AND a.ended_at IS NULL AND p.status='approved'
 ON CONFLICT(inquiry_id,instance_version) DO NOTHING RETURNING *),
 actions AS (INSERT INTO whatsapp_service_actions(inquiry_id,survey_id,purpose,due_at,policy_id,activation_id)
 SELECT i.inquiry_id,i.id,purpose,CASE WHEN purpose='survey' THEN i.due_at ELSE $6::timestamptz END,i.policy_id,i.activation_id FROM instance i CROSS JOIN unnest(CASE WHEN $7::boolean THEN ARRAY['survey','after_hours_ack'] ELSE ARRAY['survey'] END) purpose RETURNING *),
 jobs AS (INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
 SELECT 'woztell.enquiry.service',1,jsonb_build_object('actionId',id),'queued',5,due_at,'wa.service:'||id FROM actions UNION ALL SELECT 'woztell.enquiry.sla.check',1,jsonb_build_object('inquiryId',inquiry_id),'queued',5,$8::timestamptz,'wa.sla:'||inquiry_id FROM instance ON CONFLICT(idempotency_key) DO NOTHING RETURNING id)
 UPDATE inquiries SET response_due_at=$8::timestamptz,service_policy_id=$2::uuid,service_state='waiting_for_human' WHERE id=$1::uuid AND EXISTS(SELECT 1 FROM instance) RETURNING id`,
      params: [
        row.id,
        policy.id,
        runtime.generationId,
        schedule.surveyDueAt,
        schedule.expiryAt,
        now.toISOString(),
        schedule.afterHours,
        schedule.responseDueAt,
      ],
    },
  ]);
  return { scheduled: result[1].length };
}
async function actionContext(id: string, p: ServicePorts) {
  const [r] = await p.query(
    `SELECT a.*,s.state AS survey_state,s.expires_at,s.answer,s.token_hash,s.manager_task_id,s.manager_assignment_id,
 i.conversation_id,i.first_human_response_at,i.status AS inquiry_status,i.effects_eligible,i.intake_message_id,i.crm_contact_id,
 w.woztell_member_id,w.channel_id,w.last_inbound_at,c.opted_out_whatsapp,
 p.version,p.status AS policy_status,p.rules,p.copy_version,p.approved_by,p.effective_at,g.ended_at,
 e.occurred_at,e.received_at,e.timing,e.identity_quality,
 r.state AS assignment_state,r.desired_staff_id,w.confirmed_staff_id,
 EXISTS(SELECT 1 FROM staff_users u JOIN staff_roles role ON role.staff_user_id=u.id WHERE u.id=r.desired_staff_id AND u.active AND role.role IN ('admin','manager')) AS manager_active
 FROM whatsapp_service_actions a JOIN whatsapp_service_surveys s ON s.id=a.survey_id JOIN inquiries i ON i.id=a.inquiry_id
 JOIN whatsapp_conversations w ON w.id=i.conversation_id JOIN crm_contacts c ON c.id=w.contact_id
 JOIN whatsapp_service_policies p ON p.id=a.policy_id JOIN whatsapp_enquiry_activations g ON g.id=a.activation_id
 JOIN whatsapp_enquiry_events e ON e.message_id=i.intake_message_id AND e.inquiry_id=i.id
 LEFT JOIN whatsapp_assignment_requests r ON r.id=s.manager_assignment_id WHERE a.id=$1::uuid`,
    [id],
  );
  return r;
}
function blockedReason(r: DbRow, runtime: ServiceRuntime, now: Date): string | null {
  if (!runtime.enabled || r.activation_id !== runtime.generationId || r.ended_at)
    return "feature_disabled_or_generation_ended";
  if (r.channel_id !== runtime.channelId || !r.woztell_member_id)
    return "channel_or_member_unverified";
  const policy = policyFromRow({ ...r, id: r.policy_id, status: r.policy_status });
  if (unresolvedServicePolicy(policy).length) return "policy_unapproved";
  if (
    !r.effects_eligible ||
    r.timing !== "fresh" ||
    r.identity_quality !== "provider_id" ||
    !r.occurred_at ||
    new Date(String(r.received_at)).getTime() - new Date(String(r.occurred_at)).getTime() >
      Number(policy.rules.freshnessSeconds) * 1000
  )
    return "capture_ineligible";
  if (r.opted_out_whatsapp !== false) return "whatsapp_opt_out";
  if (
    !r.last_inbound_at ||
    new Date(String(r.last_inbound_at)).getTime() < now.getTime() - 86400000
  )
    return "window_expired_template_unverified";
  if (["closed", "resolved", "spam"].includes(String(r.inquiry_status))) return "inquiry_closed";
  if (
    r.purpose === "survey" &&
    (r.survey_state !== "queued" || new Date(String(r.expires_at)) < now)
  )
    return "survey_not_active";
  if (r.purpose === "survey" && policy.rules.suppressSurveyAfterHuman && r.first_human_response_at)
    return "approved_human_response_suppression";
  if (r.purpose === "survey_thanks" && r.answer !== "satisfied") return "answer_mismatch";
  if (
    r.purpose === "manager_ack" &&
    (!r.manager_task_id ||
      r.assignment_state !== "confirmed" ||
      r.confirmed_staff_id !== r.desired_staff_id ||
      !r.manager_active)
  )
    return "manager_assignment_unconfirmed";
  if (
    now.getTime() - new Date(String(r.due_at)).getTime() >
    Number(policy.rules.workerLagSeconds) * 1000
  )
    return "worker_lag_exceeded";
  return null;
}
/** Instance exists before outbox. One action produces one durable intent, transcript and versioned job atomically. */
export async function prepareServiceAction(
  id: string,
  p = ports,
  runtime = serviceRuntime(),
  now = new Date(),
  transport?: ServiceTransport,
) {
  const r = await actionContext(id, p);
  if (!r || !["queued", "blocked"].includes(String(r.state))) return { prepared: 0, blocked: 0 };
  let reason = blockedReason(r, runtime, now);
  if (!reason && new Date(String(r.due_at)) > now) return { prepared: 0, blocked: 0 };
  if (!transport && !reason) reason = "service_transport_unverified";
  if (reason) {
    await p.query(
      "UPDATE whatsapp_service_actions SET state=$2,block_reason=$3,updated_at=$4::timestamptz WHERE id=$1::uuid AND state IN ('queued','blocked')",
      [
        id,
        reason.startsWith("feature_") || reason === "approved_human_response_suppression"
          ? "suppressed"
          : "blocked",
        reason,
        now.toISOString(),
      ],
    );
    return { prepared: 0, blocked: 1 };
  }
  const policy = policyFromRow({ ...r, id: r.policy_id, status: r.policy_status }),
    text = renderServiceCopy(r.purpose as ServicePurpose, policy);
  const token = r.purpose === "survey" ? randomBytes(32).toString("base64url") : null;
  const response = transport!.render({ purpose: r.purpose as ServicePurpose, text, token });
  if (response.length !== 1) throw new Error("WA_SERVICE_SINGLE_RESPONSE_REQUIRED");
  const intentId = randomUUID(),
    messageId = randomUUID();
  const payload = {
    text,
    enquiryId: r.inquiry_id,
    servicePurpose: r.purpose,
    policyVersion: policy.version,
    copyVersion: policy.copyVersion,
    transportVerification: transport!.verificationRef,
    response,
  };
  const result = await p.transaction([
    {
      statement: "SELECT id FROM whatsapp_service_actions WHERE id=$1::uuid FOR UPDATE",
      params: [id],
    },
    {
      statement: `WITH eligible AS (SELECT a.*,i.conversation_id,w.contact_id,w.woztell_member_id,w.channel_id FROM whatsapp_service_actions a JOIN inquiries i ON i.id=a.inquiry_id JOIN whatsapp_conversations w ON w.id=i.conversation_id JOIN crm_contacts c ON c.id=w.contact_id JOIN whatsapp_enquiry_activations g ON g.id=a.activation_id JOIN whatsapp_service_policies p ON p.id=a.policy_id WHERE a.id=$1::uuid AND a.outbound_intent_id IS NULL AND a.state IN ('queued','blocked') AND g.ended_at IS NULL AND p.status='approved' AND NOT c.opted_out_whatsapp),
 intent AS (INSERT INTO whatsapp_outbound_intents(id,conversation_id,actor_type,service_action_id,kind,payload,payload_hash,message_id)
 SELECT $2::uuid,conversation_id,'service',id,'text',$3::jsonb,$4,$5::uuid FROM eligible RETURNING *),
 message AS (INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,message_type,text,status,woztell_member_id,channel_id,payload)
 SELECT i.message_id,e.conversation_id,e.contact_id,'outbound','TEXT',$3::jsonb->>'text','queued',e.woztell_member_id,e.channel_id,jsonb_build_object('actorType','service','serviceActionId',e.id) FROM intent i JOIN eligible e ON e.id=i.service_action_id RETURNING id),
 job AS (INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) SELECT 'woztell.reply.deliver',2,jsonb_build_object('actionId',service_action_id),'queued',3,now(),'wa.service.reply:'||id FROM intent ON CONFLICT(idempotency_key) DO NOTHING RETURNING id),
 survey AS (UPDATE whatsapp_service_surveys s SET token_hash=CASE WHEN e.purpose='survey' THEN $6 ELSE s.token_hash END FROM eligible e,intent i WHERE s.id=e.survey_id AND i.service_action_id=e.id RETURNING s.id)
 UPDATE whatsapp_service_actions a SET outbound_intent_id=i.id,state='queued',block_reason=NULL,updated_at=now() FROM intent i WHERE a.id=i.service_action_id RETURNING a.id`,
      params: [
        id,
        intentId,
        JSON.stringify(payload),
        createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        messageId,
        token ? createHash("sha256").update(token).digest("hex") : null,
      ],
    },
  ]);
  return { prepared: result[1].length, blocked: 0 };
}
export async function deliverServiceAction(
  id: string,
  context: { checkpoint: () => Promise<void>; job?: { jobId: string; workerId: string } },
  p = ports,
  runtime = serviceRuntime(),
  now = new Date(),
  transport?: ServiceTransport,
) {
  await context.checkpoint();
  await p.query(
    `WITH sync AS (UPDATE whatsapp_service_actions a SET state=CASE WHEN o.state='cancelled' THEN 'suppressed' ELSE o.state END,block_reason=o.error,updated_at=now() FROM whatsapp_outbound_intents o WHERE a.id=$1::uuid AND o.id=a.outbound_intent_id AND o.state IN ('accepted','unknown','failed','cancelled') RETURNING a.*)
 UPDATE whatsapp_service_surveys s SET state='sent',sent_at=COALESCE(s.sent_at,o.dispatch_started_at),message_id=o.message_id FROM sync a JOIN whatsapp_outbound_intents o ON o.id=a.outbound_intent_id WHERE s.id=a.survey_id AND a.purpose='survey' AND a.state='accepted' AND s.state='queued'`,
    [id],
  );
  const r = await actionContext(id, p);
  if (!r?.outbound_intent_id) return { dispatched: 0 };
  let reason = blockedReason(r, runtime, now);
  if (!transport && !reason) reason = "service_transport_unverified";
  const intent = String(r.outbound_intent_id);
  return deliverOutboundIntent(intent, {
    checkpoint: context.checkpoint,
    job: context.job,
    begin: async () => {
      if (!context.job) throw new Error("JOB_OWNERSHIP_LOST");
      if (p === ports) {
        runtime = serviceRuntime();
        reason = blockedReason(r, runtime, new Date());
        if (!transport && !reason) reason = "service_transport_unverified";
      }
      const results = await p.transaction([
        {
          statement: "SELECT id FROM whatsapp_service_actions WHERE id=$1::uuid FOR UPDATE",
          params: [id],
        },
        {
          statement:
            "SELECT c.id FROM crm_contacts c JOIN inquiries i ON i.crm_contact_id=c.id JOIN whatsapp_service_actions a ON a.inquiry_id=i.id WHERE a.id=$1::uuid FOR UPDATE OF c",
          params: [id],
        },
        {
          statement: `WITH eligible AS (SELECT o.id,o.payload,w.channel_id,w.woztell_member_id,(NOT c.opted_out_whatsapp AND p.status='approved' AND g.ended_at IS NULL AND g.id=$7::uuid AND w.channel_id=$8 AND w.last_inbound_at >= $6::timestamptz-interval '24 hours' AND $5::text IS NULL AND a.state IN ('queued','dispatching') AND q.effects_eligible AND q.activation_id=g.id AND q.status NOT IN ('closed','resolved','spam')
     AND (a.purpose<>'survey' OR (s.state='queued' AND s.expires_at>=$6::timestamptz AND (NOT (p.rules->>'suppressSurveyAfterHuman')::boolean OR q.first_human_response_at IS NULL)))
     AND (a.purpose<>'survey_thanks' OR s.answer='satisfied')
     AND (a.purpose<>'manager_ack' OR (s.answer='assistance' AND s.manager_task_id IS NOT NULL AND EXISTS(SELECT 1 FROM whatsapp_assignment_requests ar JOIN staff_users u ON u.id=ar.desired_staff_id JOIN staff_roles role ON role.staff_user_id=u.id JOIN whatsapp_staff_channels sc ON sc.staff_id=u.id AND sc.channel_id=w.channel_id WHERE ar.id=s.manager_assignment_id AND ar.state='confirmed' AND w.confirmed_staff_id=u.id AND u.active AND role.role IN ('manager','admin') AND sc.eligible AND sc.retired_at IS NULL)))) AS allowed
    FROM whatsapp_outbound_intents o JOIN whatsapp_service_actions a ON a.id=o.service_action_id JOIN inquiries q ON q.id=a.inquiry_id JOIN whatsapp_service_surveys s ON s.id=a.survey_id JOIN whatsapp_conversations w ON w.id=o.conversation_id JOIN crm_contacts c ON c.id=w.contact_id JOIN whatsapp_service_policies p ON p.id=a.policy_id JOIN whatsapp_enquiry_activations g ON g.id=a.activation_id
    JOIN ops_jobs j ON j.id=$2::uuid WHERE o.id=$1::uuid AND o.actor_type='service' AND j.job_type='woztell.reply.deliver' AND j.payload_version=2 AND j.payload->>'actionId'=a.id::text AND j.status='running' AND j.lease_owner=$3 AND a.id=$4::uuid AND j.lease_expires_at>clock_timestamp()),
    reserved AS (UPDATE whatsapp_outbound_intents o SET state=CASE WHEN o.state='dispatching' THEN 'unknown' WHEN e.allowed THEN 'dispatching' ELSE 'cancelled' END,error=CASE WHEN o.state='dispatching' THEN 'WOZTELL_DELIVERY_UNKNOWN' WHEN NOT e.allowed THEN COALESCE($5,'runtime_dispatch_gate') ELSE NULL END,dispatch_started_at=COALESCE(dispatch_started_at,$6::timestamptz),updated_at=now() FROM eligible e WHERE o.id=e.id AND o.state IN ('queued','dispatching') RETURNING o.*),
    transcript AS (UPDATE whatsapp_messages m SET status=r.state,error=r.error FROM reserved r WHERE m.id=r.message_id RETURNING m.id),
    action AS (UPDATE whatsapp_service_actions a SET state=CASE WHEN r.state='cancelled' THEN 'suppressed' ELSE r.state END,block_reason=COALESCE(r.error,$5),updated_at=now() FROM reserved r WHERE a.id=r.service_action_id RETURNING a.id)
    SELECT r.*,e.channel_id,e.woztell_member_id FROM reserved r JOIN eligible e ON e.id=r.id WHERE r.state='dispatching'`,
          params: [
            intent,
            context.job.jobId,
            context.job.workerId,
            id,
            reason,
            now.toISOString(),
            runtime.generationId,
            runtime.channelId,
          ],
        },
      ]);
      const row = results[2]?.[0];
      return row
        ? {
            channelId: String(row.channel_id),
            memberId: String(row.woztell_member_id),
            response: (row.payload as { response: Record<string, unknown>[] }).response,
          }
        : null;
    },
    send: transport?.send,
    finish: async (i, outcome) => {
      await finishOutboundIntent(i, outcome, p.transaction);
      await syncServiceActionAfterFinish(i, now, p);
    },
  });
}
/**
 * Copy the intent's state into its service action after the provider call. Only states the
 * whatsapp_service_actions CHECK allows are copied: a late finish on an intent a manager has
 * already resolved (resolved_sent / resolved_not_sent, FX-08) leaves the action as it was.
 */
export async function syncServiceActionAfterFinish(intentId: string, now: Date, p = ports) {
  await p.query(
    `WITH action AS (UPDATE whatsapp_service_actions a SET state=o.state,block_reason=o.error,updated_at=now() FROM whatsapp_outbound_intents o WHERE o.id=$1::uuid AND a.id=o.service_action_id AND o.state IN ('queued','dispatching','accepted','unknown','failed') RETURNING a.*)
 UPDATE whatsapp_service_surveys s SET state=CASE WHEN a.state='accepted' THEN 'sent' ELSE s.state END,sent_at=CASE WHEN a.state='accepted' THEN COALESCE(s.sent_at,$2::timestamptz) ELSE s.sent_at END,message_id=o.message_id FROM action a JOIN whatsapp_outbound_intents o ON o.id=a.outbound_intent_id WHERE s.id=a.survey_id AND a.purpose='survey' AND s.state='queued'`,
    [intentId, now.toISOString()],
  );
}
export async function processServiceAnswer(
  eventId: string,
  p = ports,
  runtime = serviceRuntime(),
  now = new Date(),
  transport?: ServiceTransport,
) {
  if (!runtime.enabled || !runtime.generationId || !transport?.decode) return { answered: 0 };
  const [e] = await p.query(
    "SELECT m.payload FROM whatsapp_enquiry_events e JOIN whatsapp_messages m ON m.id=e.message_id WHERE e.id=$1::uuid",
    [eventId],
  );
  const reply = e ? parseSurveyReply(e.payload, transport.decode) : null;
  if (!reply) return { answered: 0 };
  const [r] = await p.query(
    "SELECT wa_service_answer($1::uuid,$2,$3,$4::timestamptz,$5::uuid) id",
    [
      eventId,
      createHash("sha256").update(reply.token).digest("hex"),
      reply.answer,
      now.toISOString(),
      runtime.generationId,
    ],
  );
  return { answered: r?.id ? 1 : 0 };
}

export async function checkServiceObligation(
  inquiryId: string,
  p = ports,
  runtime = serviceRuntime(),
  now = new Date(),
) {
  if (!runtime.enabled || !runtime.generationId) return { checked: 0 };
  const rows = await p.query(
    `UPDATE inquiries i SET service_state=CASE WHEN first_human_response_at IS NOT NULL THEN 'human_response_recorded' WHEN response_due_at<=$2::timestamptz THEN 'human_response_overdue' ELSE 'waiting_for_human' END
 WHERE i.id=$1::uuid AND i.effects_eligible AND i.activation_id=$3::uuid AND EXISTS(SELECT 1 FROM whatsapp_enquiry_activations a JOIN whatsapp_service_policies p ON p.id=a.policy_id WHERE a.id=i.activation_id AND a.ended_at IS NULL AND p.status='approved') RETURNING id`,
    [inquiryId, now.toISOString(), runtime.generationId],
  );
  return { checked: rows.length };
}
export async function reconcileServiceManagerAck(requestId: string, p = ports, now = new Date()) {
  const rows = await p.query(
    `WITH ready AS (UPDATE whatsapp_service_actions a SET state='queued',block_reason=NULL,due_at=$2::timestamptz,updated_at=now() FROM whatsapp_service_surveys s JOIN whatsapp_assignment_requests r ON r.id=s.manager_assignment_id JOIN whatsapp_conversations w ON w.id=r.conversation_id JOIN staff_users u ON u.id=r.desired_staff_id
 WHERE a.survey_id=s.id AND a.purpose='manager_ack' AND a.state='blocked' AND a.outbound_intent_id IS NULL AND s.manager_task_id IS NOT NULL AND r.id=$1::uuid AND r.state='confirmed' AND w.confirmed_staff_id=r.desired_staff_id AND u.active RETURNING a.id)
 INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) SELECT 'woztell.enquiry.service',1,jsonb_build_object('actionId',id),'queued',3,$2::timestamptz,'wa.manager.confirmed:'||id FROM ready ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    [requestId, now.toISOString()],
  );
  return { queued: rows.length };
}
