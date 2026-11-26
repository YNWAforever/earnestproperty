import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { queryRows, transactionRows } from "../neon/db.server.ts";
import { wakeAfterCommit } from "../control-plane/job-wake.server.ts";
import { companyChannelId, providerChannelId } from "./wa-config.server.ts";

/** Preview deployments can share a database, so only the production webhook may start a greeting. */
export function customerGreetingScope(env = process.env) {
  const channel = companyChannelId(env);
  if (
    env.VERCEL_ENV !== "production" ||
    env.WOZTELL_ENABLED !== "true" ||
    env.EP_WA_ENQUIRY_MODE !== "active" ||
    !env.WOZTELL_APP_ID ||
    !env.EP_WA_ACTIVATION_ID ||
    !channel ||
    channel !== providerChannelId(env)
  )
    return null;
  return { app: env.WOZTELL_APP_ID, channel, generation: env.EP_WA_ACTIVATION_ID };
}

/** One service action, transcript, intent and leased delivery job commit together. */
export async function queueCustomerGreeting(
  eventId: string,
  query = queryRows,
  scope = customerGreetingScope(),
) {
  if (!scope) return;
  const queued = await query(
    `WITH target AS MATERIALIZED (
    SELECT * FROM whatsapp_customer_greeting_targets WHERE event_id=$1::uuid AND app_id=$2 AND channel_id=$3 AND activation_id=$4::uuid
  ), action AS (
    INSERT INTO whatsapp_service_actions(inquiry_id,purpose,due_at,policy_id,activation_id,outbound_intent_id)
    SELECT inquiry_id,'customer_greeting',now(),policy_id,activation_id,$5::uuid FROM target
    ON CONFLICT (inquiry_id) WHERE purpose='customer_greeting' DO NOTHING RETURNING *
  ), payload AS (
    SELECT a.id AS action_id,t.*,jsonb_build_object('text',t.body,'enquiryId',t.inquiry_id,
      'servicePurpose',a.purpose,'appId',t.app_id,'channelId',t.channel_id,'memberId',t.member_id) AS data
    FROM action a JOIN target t ON t.inquiry_id=a.inquiry_id
  ), intent AS (
    INSERT INTO whatsapp_outbound_intents(id,conversation_id,actor_type,service_action_id,kind,payload,payload_hash,message_id)
    SELECT $5::uuid,conversation_id,'service',action_id,'text',data,encode(sha256(convert_to(data::text,'UTF8')),'hex'),$6::uuid FROM payload RETURNING *
  ), transcript AS (
    INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,message_type,text,status,woztell_member_id,channel_id,payload)
    SELECT o.message_id,t.conversation_id,t.contact_id,'outbound','TEXT',t.body,'queued',t.member_id,t.channel_id,
      jsonb_build_object('actorType','service','serviceActionId',o.service_action_id) FROM intent o JOIN target t ON t.conversation_id=o.conversation_id
  ) INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
    SELECT 'woztell.reply.deliver',2,jsonb_build_object('actionId',service_action_id),'queued',3,now(),'wa.service.reply:'||id FROM intent RETURNING id`,
    [eventId, scope.app, scope.channel, scope.generation, randomUUID(), randomUUID()],
  );
  if (queued.length) wakeAfterCommit("service");
}

export async function reserveCustomerGreeting(
  intentId: string,
  actionId: string,
  job: { jobId: string; workerId: string } | undefined,
  transaction = transactionRows,
  scope = customerGreetingScope(),
) {
  if (!job) throw new Error("JOB_OWNERSHIP_LOST");
  const result = await transaction([
    {
      statement: `SELECT w.id FROM whatsapp_conversations w JOIN whatsapp_outbound_intents o ON o.conversation_id=w.id WHERE o.id=$1::uuid FOR UPDATE OF w`,
      params: [intentId],
    },
    {
      statement: `SELECT c.id FROM crm_contacts c JOIN whatsapp_conversations w ON w.contact_id=c.id JOIN whatsapp_outbound_intents o ON o.conversation_id=w.id WHERE o.id=$1::uuid FOR UPDATE OF c`,
      params: [intentId],
    },
    {
      statement: `WITH claim AS MATERIALIZED (
      SELECT o.id,EXISTS(SELECT 1 FROM whatsapp_customer_greeting_targets t WHERE t.inquiry_id=a.inquiry_id
        AND t.conversation_id=o.conversation_id AND t.activation_id=a.activation_id AND t.activation_id=$7::uuid
        AND t.app_id=$5 AND t.channel_id=$6 AND t.app_id=o.payload->>'appId' AND t.channel_id=o.payload->>'channelId'
        AND t.member_id=o.payload->>'memberId' AND t.body=o.payload->>'text'
        AND NOT EXISTS(SELECT 1 FROM whatsapp_outbound_intents other WHERE other.conversation_id=o.conversation_id AND other.id<>o.id AND other.state IN ('dispatching','unknown'))
      ) AS allowed FROM whatsapp_outbound_intents o JOIN whatsapp_service_actions a ON a.id=o.service_action_id AND a.outbound_intent_id=o.id
      JOIN ops_jobs j ON j.id=$3::uuid AND j.job_type='woztell.reply.deliver' AND j.payload_version=2 AND j.payload->>'actionId'=a.id::text
      WHERE o.id=$1::uuid AND a.id=$2::uuid AND a.purpose='customer_greeting' AND o.kind='text' AND o.actor_type='service'
        AND j.status='running' AND j.lease_owner=$4 AND j.lease_expires_at>clock_timestamp()
    ), reserved AS (
      UPDATE whatsapp_outbound_intents o SET state=CASE WHEN o.state='dispatching' THEN 'unknown' WHEN c.allowed THEN 'dispatching' ELSE 'cancelled' END,
        error=CASE WHEN o.state='dispatching' THEN 'WOZTELL_DELIVERY_UNKNOWN' WHEN NOT c.allowed THEN 'greeting_no_longer_eligible' END,
        dispatch_started_at=COALESCE(o.dispatch_started_at,CASE WHEN c.allowed THEN now() END),updated_at=now()
      FROM claim c WHERE o.id=c.id AND o.state IN ('queued','dispatching') RETURNING o.*
    ), transcript AS (UPDATE whatsapp_messages m SET status=r.state,error=r.error FROM reserved r WHERE m.id=r.message_id),
    action AS (UPDATE whatsapp_service_actions a SET state=CASE WHEN r.state='cancelled' THEN 'suppressed' ELSE r.state END,block_reason=r.error,updated_at=now() FROM reserved r WHERE a.id=r.service_action_id)
    SELECT payload->>'channelId' AS channel,payload->>'memberId' AS member,payload->>'text' AS body FROM reserved WHERE state='dispatching'`,
      params: [
        intentId,
        actionId,
        job.jobId,
        job.workerId,
        scope?.app ?? null,
        scope?.channel ?? null,
        scope?.generation ?? null,
      ],
    },
  ]);
  const row = result[2][0];
  return row
    ? {
        channelId: String(row.channel),
        memberId: String(row.member),
        response: [{ type: "TEXT", text: String(row.body) }],
      }
    : null;
}
