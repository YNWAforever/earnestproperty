import { createHash, randomUUID } from "node:crypto";

export type OutboundState =
  | "queued"
  | "dispatching"
  | "accepted"
  | "unknown"
  | "failed"
  | "cancelled";
export type OutboundIntentInput = { requestId: string; conversationId: string } & (
  | { kind: "text"; payload: { text: string } }
  | { kind: "template"; payload: { templateId: string } }
);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(code = "VALIDATION_ERROR") {
  return Object.assign(new Error(code), { code });
}
export function parseOutboundIntent(value: unknown): OutboundIntentInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const v = value as Record<string, unknown>;
  if (
    typeof v.requestId !== "string" ||
    !uuid.test(v.requestId) ||
    typeof v.conversationId !== "string" ||
    !uuid.test(v.conversationId)
  )
    throw invalid();
  if (!v.payload || typeof v.payload !== "object" || Array.isArray(v.payload)) throw invalid();
  const p = v.payload as Record<string, unknown>;
  if (Object.keys(p).length !== 1) throw invalid();
  const ids = {
    requestId: v.requestId.toLowerCase(),
    conversationId: v.conversationId.toLowerCase(),
  };
  if (v.kind === "text" && typeof p.text === "string" && p.text.trim() && p.text.length <= 4096)
    return { ...ids, kind: "text", payload: { text: p.text.trim() } };
  if (v.kind === "template" && typeof p.templateId === "string" && uuid.test(p.templateId))
    return { ...ids, kind: "template", payload: { templateId: p.templateId.toLowerCase() } };
  throw invalid();
}
export function hashOutboundIntent(input: OutboundIntentInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.conversationId,
        input.kind,
        input.kind === "text" ? input.payload.text : input.payload.templateId,
      ]),
    )
    .digest("hex");
}

/** Authorization and all durable records are committed by one statement. A request ID is global and actor-bound. */
export async function enqueueOutboundIntent(
  input: OutboundIntentInput,
  staffId: string,
  scope: string | null,
  injectedQuery?: typeof import("../neon/db.server.ts").queryRows,
) {
  const queryRows = injectedQuery ?? (await import("../neon/db.server.ts")).queryRows;
  const rows = await queryRows<{ id: string; state: OutboundState }>(
    `WITH authorized AS (
    SELECT wc.* FROM whatsapp_conversations wc WHERE wc.id=$2::uuid
    AND ($7::uuid IS NULL OR wc.assigned_agent_id=$7::uuid)
  ), intent AS (
    INSERT INTO whatsapp_outbound_intents (id,conversation_id,actor_staff_id,kind,payload,payload_hash,message_id)
    SELECT $1::uuid,id,$3::uuid,$4,$5::jsonb,$6,$8::uuid FROM authorized
    ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id
    WHERE whatsapp_outbound_intents.actor_staff_id=EXCLUDED.actor_staff_id
      AND whatsapp_outbound_intents.payload_hash=EXCLUDED.payload_hash
    RETURNING *
  ), message AS (
    INSERT INTO whatsapp_messages (id,conversation_id,contact_id,direction,message_type,text,sent_by,status,woztell_member_id,channel_id)
    SELECT i.message_id,a.id,a.contact_id,'outbound',upper(i.kind),
      CASE WHEN i.kind='text' THEN i.payload->>'text' ELSE '範本待傳送' END,
      i.actor_staff_id,i.state,a.woztell_member_id,a.channel_id FROM intent i JOIN authorized a ON a.id=i.conversation_id
    ON CONFLICT (id) DO NOTHING RETURNING id
  ), job AS (
    INSERT INTO ops_jobs (job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key,actor_staff_id)
    SELECT 'woztell.reply.deliver',1,jsonb_build_object('intentId',id),'queued',5,now(),'woztell.reply:'||id,actor_staff_id FROM intent
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
  ), recency AS (UPDATE whatsapp_conversations wc SET last_message_at=now(),updated_at=now() FROM intent i WHERE wc.id=i.conversation_id RETURNING wc.id) SELECT id,state FROM intent`,
    [
      input.requestId,
      input.conversationId,
      staffId,
      input.kind,
      JSON.stringify(input.payload),
      hashOutboundIntent(input),
      scope,
      randomUUID(),
    ],
  );
  if (!rows[0]) throw invalid("OUTBOUND_CONFLICT_OR_NOT_FOUND");
  return rows[0];
}

type Reservation = { memberId: string; response: Record<string, unknown>[] };
type Outcome = { state: OutboundState; externalMessageId: string | null; error: string | null };
type ProviderResult = {
  ok: boolean;
  body?: unknown;
  refused?: boolean;
  status?: number;
  error?: string;
};
export function providerMessageIdentity(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id =
    b.messageId ??
    (b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>).messageId : null);
  return typeof id === "string" && id.length > 0 && id.length <= 512 ? id : null;
}
export async function deliverOutboundIntent(
  id: string,
  deps: {
    checkpoint: () => Promise<void>;
    begin?: (id: string) => Promise<Reservation | null>;
    send?: (input: Reservation) => Promise<ProviderResult>;
    finish?: (id: string, outcome: Outcome) => Promise<void>;
    job?: { jobId: string; workerId: string };
  },
) {
  await deps.checkpoint();
  const reservation = await (
    deps.begin ?? ((intentId) => beginOutboundDispatch(intentId, deps.job))
  )(id);
  if (!reservation) return { dispatched: 0 };
  const finish = deps.finish ?? finishOutboundIntent;
  let externalMessageId: string | null = null;
  try {
    const send = deps.send ?? (await import("./woztell.server.ts")).sendWoztellResponse;
    const result = await send(reservation);
    externalMessageId = providerMessageIdentity(result.body);
    await finish(id, {
      state: result.ok ? "accepted" : result.refused ? "failed" : "unknown",
      externalMessageId,
      error: result.ok ? null : result.refused ? "WOZTELL_REFUSED" : "WOZTELL_DELIVERY_UNKNOWN",
    });
  } catch {
    // Never throw a retryable send after the irreversible boundary. If this write also fails,
    // the retained dispatching row is converted to unknown on recovery, never to queued.
    await finish(id, { state: "unknown", externalMessageId, error: "WOZTELL_DELIVERY_UNKNOWN" });
  }
  return { dispatched: 1 };
}

async function beginOutboundDispatch(
  id: string,
  job?: { jobId: string; workerId: string },
): Promise<Reservation | null> {
  if (!job) throw invalid("JOB_OWNERSHIP_LOST");
  const { transactionRows } = await import("../neon/db.server.ts");
  const result = await transactionRows([
    {
      statement: `SELECT wc.id FROM whatsapp_conversations wc JOIN whatsapp_outbound_intents i ON i.conversation_id=wc.id WHERE i.id=$1::uuid FOR UPDATE OF wc`,
      params: [id],
    },
    {
      statement: `SELECT c.id FROM crm_contacts c JOIN whatsapp_conversations wc ON wc.contact_id=c.id JOIN whatsapp_outbound_intents i ON i.conversation_id=wc.id WHERE i.id=$1::uuid FOR UPDATE OF c`,
      params: [id],
    },
    {
      statement: `SELECT t.id FROM whatsapp_templates t JOIN whatsapp_outbound_intents i ON i.payload->>'templateId'=t.id::text WHERE i.id=$1::uuid FOR UPDATE OF t`,
      params: [id],
    },
    { statement: `SELECT id FROM ops_jobs WHERE id=$1::uuid FOR UPDATE`, params: [job.jobId] },
    {
      statement: `WITH eligibility AS (
      SELECT i.id,wc.woztell_member_id,t.element_name,t.language_code,t.components,i.kind,i.payload,
      (c.opted_out_whatsapp=false AND NULLIF(wc.woztell_member_id,'') IS NOT NULL
       AND (i.kind='text' AND wc.last_inbound_at >= now()-interval '24 hours' OR i.kind='template' AND t.status LIKE 'active%')
       AND EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=i.actor_staff_id AND s.active=true AND (r.role IN ('admin','manager') OR r.role='agent' AND wc.assigned_agent_id=s.id))
       AND j.status='running' AND j.lease_owner=$3 AND j.lease_expires_at>clock_timestamp()) AS allowed
      FROM whatsapp_outbound_intents i JOIN whatsapp_conversations wc ON wc.id=i.conversation_id
      LEFT JOIN crm_contacts c ON c.id=wc.contact_id LEFT JOIN whatsapp_templates t ON t.id::text=i.payload->>'templateId'
      JOIN ops_jobs j ON j.id=$2::uuid WHERE i.id=$1::uuid
    ), reserved AS (
      UPDATE whatsapp_outbound_intents i SET state=CASE WHEN i.state='dispatching' THEN 'unknown' WHEN e.allowed THEN 'dispatching' ELSE 'cancelled' END,
      dispatch_started_at=COALESCE(i.dispatch_started_at,CASE WHEN e.allowed THEN clock_timestamp() END),updated_at=now()
      FROM eligibility e WHERE i.id=e.id AND i.state IN ('queued','dispatching') RETURNING i.*,e.element_name,e.language_code,e.components
    ), transcript AS (
      UPDATE whatsapp_messages m SET status=r.state,
      payload=CASE WHEN r.state='dispatching' THEN jsonb_build_object('dispatchResponse',
        CASE WHEN r.kind='text' THEN jsonb_build_object('type','TEXT','text',r.payload->>'text')
        ELSE jsonb_build_object('type','TEMPLATE','elementName',r.element_name,'languageCode',r.language_code,'components',r.components) END)
        ELSE m.payload END FROM reserved r WHERE m.id=r.message_id RETURNING m.id
    ) SELECT e.* FROM eligibility e JOIN reserved r ON r.id=e.id WHERE r.state='dispatching'`,
      params: [id, job.jobId, job.workerId],
    },
  ]);
  const row = result[4]?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const payload = row.payload as { text: string };
  return {
    memberId: String(row.woztell_member_id),
    response:
      row.kind === "text"
        ? [{ type: "TEXT", text: payload.text }]
        : [
            {
              type: "TEMPLATE",
              elementName: row.element_name,
              languageCode: row.language_code,
              components: row.components,
            },
          ],
  };
}

/** Serialize provider identity with ingestion. Early callback rows become the intent's transcript row. */
export async function finishOutboundIntent(
  id: string,
  outcome: Outcome,
  injectedTransaction?: typeof import("../neon/db.server.ts").transactionRows,
) {
  const transactionRows =
    injectedTransaction ?? (await import("../neon/db.server.ts")).transactionRows;
  await transactionRows([
    {
      statement: `SELECT pg_advisory_xact_lock(hashtextextended('woztell-message:'||COALESCE($1,$2),0))`,
      params: [outcome.externalMessageId, id],
    },
    {
      statement: `WITH existing AS (
      SELECT m.id FROM whatsapp_messages m JOIN whatsapp_outbound_intents i ON i.id=$1::uuid
      WHERE m.external_message_id=$3 AND m.conversation_id=i.conversation_id AND m.direction='outbound'
    ), reconciled AS (
      UPDATE whatsapp_outbound_intents i SET state=CASE WHEN i.state='accepted' THEN 'accepted' ELSE $2 END,external_message_id=COALESCE($3,i.external_message_id),
      message_id=COALESCE((SELECT id FROM existing),i.message_id),error=CASE WHEN i.state='accepted' THEN NULL ELSE $4 END,updated_at=now()
      WHERE i.id=$1::uuid AND i.state IN ('dispatching','unknown','accepted') RETURNING i.*
    ), removed AS (
      DELETE FROM whatsapp_messages m USING reconciled i WHERE m.id<>i.message_id AND m.id=(SELECT message_id FROM whatsapp_outbound_intents WHERE id=i.id)
      AND m.external_message_id IS NULL RETURNING m.id
    ) UPDATE whatsapp_messages m SET status=i.state,external_message_id=i.external_message_id,error=i.error,sent_by=i.actor_staff_id
      FROM reconciled i WHERE m.id=i.message_id`,
      params: [id, outcome.state, outcome.externalMessageId, outcome.error],
    },
  ]);
}
