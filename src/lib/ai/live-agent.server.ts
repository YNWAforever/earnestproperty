import "@tanstack/react-start/server-only";

import { queryRows, numberOrNull, stringOrEmpty, stringOrNull } from "@/lib/neon/db.server";

import type { LiveAgentMessage, LiveAgentSession } from "./ai-types";
import { answerFromPublicKnowledge } from "./knowledge.server";
import { buildLiveAgentLeadInput, shouldOfferHumanHandoff } from "./live-agent.ts";

type LiveAgentSessionRow = {
  id: unknown;
  anonymous_id: unknown;
  contact_id: unknown;
  lead_id: unknown;
  conversation_id: unknown;
  source_path: unknown;
  status: unknown;
  intent: unknown;
  budget_min: unknown;
  budget_max: unknown;
  preferred_estates: unknown;
  timeline: unknown;
  opt_in_whatsapp: unknown;
};

type LiveAgentMessageRow = {
  id: unknown;
  session_id: unknown;
  direction: unknown;
  message_text: unknown;
  citations: unknown;
  safety_flags: unknown;
  shown_publicly: unknown;
  created_at: unknown;
};

type PublicLiveAgentSession = Pick<LiveAgentSession, "id" | "status">;

export class LiveAgentPublicError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LiveAgentPublicError";
    this.status = status;
  }
}

export async function createLiveAgentSession(input: {
  anonymousId?: string | null;
  sourcePath?: string | null;
}) {
  const anonymousId = cleanNullableText(input.anonymousId, 120);
  const sourcePath = cleanNullableText(input.sourcePath, 500);

  if (anonymousId) {
    const existing = await queryRows<LiveAgentSessionRow>(
      `SELECT *
       FROM live_agent_sessions
       WHERE anonymous_id = $1
         AND status IN ('open', 'qualified')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [anonymousId],
    );
    if (existing[0]) return mapSession(existing[0]);
  }

  const rows = await queryRows<LiveAgentSessionRow>(
    `INSERT INTO live_agent_sessions (anonymous_id, source_path)
     VALUES ($1,$2)
     RETURNING *`,
    [anonymousId, sourcePath],
  );

  return mapSession(requireRow(rows[0], "Unable to create live-agent session."));
}

export async function answerLiveAgentMessage(input: { sessionId: string; message: string }) {
  const sessionId = input.sessionId.trim();
  const visitorMessage = input.message.trim().slice(0, 2000);

  if (!isLiveAgentSessionId(sessionId) || !visitorMessage) {
    throw new LiveAgentPublicError("Invalid live-agent message.", 400);
  }

  const session = await getLiveAgentSessionForMessage(sessionId);

  await queryRows(
    `INSERT INTO live_agent_messages (session_id, direction, message_text, shown_publicly)
     VALUES ($1,'visitor',$2,true)`,
    [session.id, visitorMessage],
  );

  const answer = await answerFromPublicKnowledge({ question: visitorMessage });
  const handoffSuggested = shouldOfferHumanHandoff({
    confidence: answer.confidence,
    userAskedForHuman: /真人|人工|代理|whatsapp|聯絡|联系|call|電話|电话|agent|human/i.test(
      visitorMessage,
    ),
  });
  const safetyFlags = handoffSuggested ? ["handoff_suggested"] : [];
  const assistantText = handoffSuggested
    ? `${answer.answer}\n\n需要我幫你轉介持牌代理 WhatsApp 跟進嗎？`
    : answer.answer;

  const rows = await queryRows<LiveAgentMessageRow>(
    `INSERT INTO live_agent_messages (
       session_id, direction, message_text, citations, safety_flags, shown_publicly
     )
     VALUES ($1,'assistant',$2,$3::jsonb,$4::text[],true)
     RETURNING *`,
    [session.id, assistantText, JSON.stringify(answer.citations), safetyFlags],
  );

  await queryRows("UPDATE live_agent_sessions SET updated_at = now() WHERE id = $1", [session.id]);

  return {
    message: mapMessage(requireRow(rows[0], "Unable to create live-agent reply.")),
    handoffSuggested,
  };
}

export function isLiveAgentSessionId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function toPublicLiveAgentSession(session: LiveAgentSession): PublicLiveAgentSession {
  return {
    id: session.id,
    status: session.status,
  };
}

export async function requestLiveAgentHandoff(input: {
  sessionId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  intent?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  preferred_estates?: string[] | null;
  opt_in_whatsapp?: boolean | null;
}) {
  const sessionId = input.sessionId.trim();
  if (!isLiveAgentSessionId(sessionId)) {
    throw new LiveAgentPublicError("Invalid handoff session.", 400);
  }

  const session = await getLiveAgentSessionForHandoff(sessionId);
  const leadInput = buildLiveAgentLeadInput({
    ...input,
    source_path: session.source_path,
  });
  const name = cleanNullableText(leadInput.name, 160);
  const phone = cleanNullableText(leadInput.phone, 80);
  const email = cleanNullableText(leadInput.email, 200);
  const intent = cleanNullableText(leadInput.intent, 80) ?? "buyer";
  const preferredEstates = leadInput.preferred_estates.map((estate) => estate.slice(0, 120));
  const note = `Live agent handoff from ${leadInput.source_path ?? "public site"}`;

  const contactId = await upsertLiveAgentContact({
    name,
    phone,
    normalizedPhone: leadInput.normalized_phone,
    email,
    optInWhatsapp: leadInput.opt_in_whatsapp,
  });
  const leadId = await upsertLiveAgentLead({
    leadId: session.lead_id,
    contactId,
    intent,
    budgetMin: leadInput.budget_min,
    budgetMax: leadInput.budget_max,
    preferredEstates,
    note,
  });
  const conversationId = await upsertLiveAgentConversation({
    conversationId: session.conversation_id,
    contactId,
  });

  await queryRows(
    `UPDATE live_agent_sessions
     SET contact_id=$1,
         lead_id=$2,
         conversation_id=$3,
         status='handoff_requested',
         intent=$4,
         budget_min=$5,
         budget_max=$6,
         preferred_estates=$7::text[],
         opt_in_whatsapp=$8,
         updated_at=now()
     WHERE id=$9`,
    [
      contactId,
      leadId,
      conversationId,
      intent,
      leadInput.budget_min,
      leadInput.budget_max,
      preferredEstates,
      leadInput.opt_in_whatsapp,
      session.id,
    ],
  );

  await queryRows(
    `INSERT INTO crm_activities (lead_id, contact_id, activity_type, body)
     VALUES ($1,$2,'follow_up',$3)`,
    [leadId, contactId, note],
  );
  await queryRows(
    `INSERT INTO live_agent_messages (session_id, direction, message_text, safety_flags, shown_publicly)
     VALUES ($1,'system',$2,$3::text[],false)`,
    [session.id, "Live-agent handoff requested for WhatsApp follow-up.", ["handoff_requested"]],
  );
  await queryRows(
    `INSERT INTO ai_audit_logs (actor_type, action, subject_type, subject_id, metadata)
     VALUES ('visitor','live_agent.handoff','live_agent_session',$1,$2::jsonb)`,
    [
      session.id,
      JSON.stringify({
        contactId,
        leadId,
        conversationId,
        hasPhone: Boolean(phone),
        sourcePath: leadInput.source_path,
      }),
    ],
  );

  return { ok: true, status: "handoff_requested" as const };
}

async function getLiveAgentSessionForMessage(sessionId: string) {
  const rows = await queryRows<LiveAgentSessionRow>(
    `SELECT *
     FROM live_agent_sessions
     WHERE id = $1
       AND status IN ('open', 'qualified')
     LIMIT 1`,
    [sessionId],
  );
  if (rows[0]) return mapSession(rows[0]);

  const existing = await queryRows<{ status: unknown }>(
    "SELECT status FROM live_agent_sessions WHERE id = $1 LIMIT 1",
    [sessionId],
  );
  if (!existing[0]) throw new LiveAgentPublicError("Live-agent session not found.", 404);

  throw new LiveAgentPublicError("Live-agent session is not open.", 400);
}

async function getLiveAgentSessionForHandoff(sessionId: string) {
  const rows = await queryRows<LiveAgentSessionRow>(
    `SELECT *
     FROM live_agent_sessions
     WHERE id = $1
     LIMIT 1`,
    [sessionId],
  );
  const session = rows[0] ? mapSession(rows[0]) : null;
  if (!session) throw new LiveAgentPublicError("Live-agent session not found.", 404);
  if (
    session.status !== "open" &&
    session.status !== "qualified" &&
    session.status !== "handoff_requested"
  ) {
    throw new LiveAgentPublicError("Live-agent session is not open.", 400);
  }
  return session;
}

async function upsertLiveAgentContact(input: {
  name: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  optInWhatsapp: boolean;
}) {
  if (input.normalizedPhone) {
    const rows = await queryRows<{ id: unknown }>(
      `INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
       VALUES ($1,$2,$3,$4,'live_agent',$5)
       ON CONFLICT (normalized_phone) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, crm_contacts.name),
         phone = COALESCE(EXCLUDED.phone, crm_contacts.phone),
         email = COALESCE(EXCLUDED.email, crm_contacts.email),
         opt_in_whatsapp = crm_contacts.opt_in_whatsapp OR EXCLUDED.opt_in_whatsapp,
         updated_at = now()
       RETURNING id`,
      [input.name, input.phone, input.normalizedPhone, input.email, input.optInWhatsapp],
    );
    return stringOrEmpty(requireRow(rows[0], "Unable to create live-agent contact.").id);
  }

  const rows = await queryRows<{ id: unknown }>(
    `INSERT INTO crm_contacts (name, phone, email, source, opt_in_whatsapp)
     VALUES ($1,$2,$3,'live_agent',$4)
     RETURNING id`,
    [input.name, input.phone, input.email, input.optInWhatsapp],
  );
  return stringOrEmpty(requireRow(rows[0], "Unable to create live-agent contact.").id);
}

async function upsertLiveAgentLead(input: {
  leadId: string | null;
  contactId: string;
  intent: string;
  budgetMin: number | null;
  budgetMax: number | null;
  preferredEstates: string[];
  note: string;
}) {
  if (input.leadId) {
    const rows = await queryRows<{ id: unknown }>(
      `UPDATE crm_leads
       SET contact_id=$1,
           stage='contacted',
           intent=$2,
           budget_min=$3,
           budget_max=$4,
           preferred_estates=$5::text[],
           source='live_agent',
           note=COALESCE(NULLIF(note, ''), $6),
           updated_at=now()
       WHERE id=$7
       RETURNING id`,
      [
        input.contactId,
        input.intent,
        input.budgetMin,
        input.budgetMax,
        input.preferredEstates,
        input.note,
        input.leadId,
      ],
    );
    if (rows[0]) return stringOrEmpty(rows[0].id);
  }

  const rows = await queryRows<{ id: unknown }>(
    `INSERT INTO crm_leads (
       contact_id, stage, intent, budget_min, budget_max, preferred_estates, source, note
     )
     VALUES ($1,'contacted',$2,$3,$4,$5::text[],'live_agent',$6)
     RETURNING id`,
    [
      input.contactId,
      input.intent,
      input.budgetMin,
      input.budgetMax,
      input.preferredEstates,
      input.note,
    ],
  );
  return stringOrEmpty(requireRow(rows[0], "Unable to create live-agent lead.").id);
}

async function upsertLiveAgentConversation(input: {
  conversationId: string | null;
  contactId: string;
}) {
  if (input.conversationId) {
    const rows = await queryRows<{ id: unknown }>(
      `UPDATE whatsapp_conversations
       SET contact_id=$1,
           status='pending',
           last_message_at=COALESCE(last_message_at, now()),
           updated_at=now()
       WHERE id=$2
       RETURNING id`,
      [input.contactId, input.conversationId],
    );
    if (rows[0]) return stringOrEmpty(rows[0].id);
  }

  const existing = await queryRows<{ id: unknown }>(
    `SELECT id
     FROM whatsapp_conversations
     WHERE contact_id=$1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [input.contactId],
  );
  if (existing[0]) {
    await queryRows(
      `UPDATE whatsapp_conversations
       SET status='pending',
           last_message_at=COALESCE(last_message_at, now()),
           updated_at=now()
       WHERE id=$1`,
      [existing[0].id],
    );
    return stringOrEmpty(existing[0].id);
  }

  const rows = await queryRows<{ id: unknown }>(
    `INSERT INTO whatsapp_conversations (contact_id, status, last_message_at)
     VALUES ($1,'pending',now())
     RETURNING id`,
    [input.contactId],
  );
  return stringOrEmpty(requireRow(rows[0], "Unable to create handoff conversation.").id);
}

function mapSession(row: LiveAgentSessionRow): LiveAgentSession {
  return {
    id: stringOrEmpty(row.id),
    anonymous_id: stringOrNull(row.anonymous_id),
    contact_id: stringOrNull(row.contact_id),
    lead_id: stringOrNull(row.lead_id),
    conversation_id: stringOrNull(row.conversation_id),
    source_path: stringOrNull(row.source_path),
    status: liveAgentSessionStatus(row.status),
    intent: stringOrNull(row.intent),
    budget_min: numberOrNull(row.budget_min),
    budget_max: numberOrNull(row.budget_max),
    preferred_estates: textArray(row.preferred_estates),
    timeline: stringOrNull(row.timeline),
    opt_in_whatsapp: row.opt_in_whatsapp === true,
  };
}

function mapMessage(row: LiveAgentMessageRow): LiveAgentMessage {
  return {
    id: stringOrEmpty(row.id),
    session_id: stringOrEmpty(row.session_id),
    direction: liveAgentMessageDirection(row.direction),
    message_text: stringOrEmpty(row.message_text),
    citations: citationArray(row.citations),
    safety_flags: textArray(row.safety_flags),
    shown_publicly: row.shown_publicly === true,
    created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
  };
}

function liveAgentSessionStatus(value: unknown): LiveAgentSession["status"] {
  if (
    value === "open" ||
    value === "qualified" ||
    value === "handoff_requested" ||
    value === "handoff_completed" ||
    value === "closed"
  ) {
    return value;
  }
  return "open";
}

function liveAgentMessageDirection(value: unknown): LiveAgentMessage["direction"] {
  if (value === "visitor" || value === "assistant" || value === "staff" || value === "system") {
    return value;
  }
  return "system";
}

function citationArray(value: unknown): LiveAgentMessage["citations"] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((citation) => {
    if (!citation || typeof citation !== "object") return [];
    const row = citation as Record<string, unknown>;
    return [
      {
        title: stringOrEmpty(row.title),
        url_path: stringOrNull(row.url_path),
        source_type: stringOrEmpty(row.source_type),
      },
    ];
  });
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function textArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function cleanNullableText(value: string | null | undefined, maxLength: number) {
  const text = value?.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
