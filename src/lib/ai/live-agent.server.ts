import "@tanstack/react-start/server-only";

import {
  queryRows,
  numberOrNull,
  stringOrEmpty,
  stringOrNull,
} from "@/lib/neon/db.server";

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
  access_token: unknown;
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
  sessionId?: string | null;
  accessToken?: string | null;
}): Promise<{ session: LiveAgentSession; accessToken: string }> {
  const anonymousId = cleanNullableText(input.anonymousId, 120);
  const sourcePath = cleanNullableText(input.sourcePath, 500);

  // Only reuse an existing session when the caller proves ownership with the
  // matching server-issued {sessionId, accessToken}. anonymousId alone is
  // attacker-supplied and never authorizes reuse (analytics field only).
  const sessionId = input.sessionId?.trim();
  const accessToken = cleanNullableText(input.accessToken, 120);
  if (sessionId && accessToken && isLiveAgentSessionId(sessionId)) {
    const existing = await queryRows<LiveAgentSessionRow>(
      `SELECT *
       FROM live_agent_sessions
       WHERE id = $1
         AND access_token = $2
         AND status IN ('open', 'qualified')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [sessionId, accessToken],
    );
    if (existing[0]) {
      const row = existing[0];
      return { session: mapSession(row), accessToken: stringOrEmpty(row.access_token) };
    }
  }

  const rows = await queryRows<LiveAgentSessionRow>(
    `INSERT INTO live_agent_sessions (anonymous_id, source_path)
     VALUES ($1,$2)
     RETURNING *`,
    [anonymousId, sourcePath],
  );

  const row = requireRow(rows[0], "Unable to create live-agent session.");
  return { session: mapSession(row), accessToken: stringOrEmpty(row.access_token) };
}

export async function answerLiveAgentMessage(input: {
  sessionId: string;
  accessToken: string;
  message: string;
}) {
  const sessionId = input.sessionId.trim();
  const accessToken = input.accessToken.trim();
  const visitorMessage = input.message.trim().slice(0, 2000);

  if (!isLiveAgentSessionId(sessionId) || !accessToken || !visitorMessage) {
    throw new LiveAgentPublicError("Invalid live-agent message.", 400);
  }

  const session = await getLiveAgentSessionForMessage(sessionId, accessToken);

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
  accessToken: string;
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
  const accessToken = input.accessToken.trim();
  if (!isLiveAgentSessionId(sessionId) || !accessToken) {
    throw new LiveAgentPublicError("Invalid handoff session.", 400);
  }

  const session = await getLiveAgentSessionForHandoff(sessionId, accessToken);
  if (session.status === "handoff_requested") {
    return { ok: true, status: "handoff_requested" as const };
  }
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

  // The claim locks the still-open session before any contact or lead write.
  // A concurrent request that loses the claim has no rows to feed into the
  // dependent CTEs, so it cannot create an orphan lead or duplicate follow-up.
  const rows = await queryRows<{ id: unknown }>(
    `WITH claimed AS MATERIALIZED (
       SELECT id, contact_id, lead_id, conversation_id
       FROM live_agent_sessions
       WHERE id=$1
         AND access_token=$2
         AND status IN ('open', 'qualified')
       FOR UPDATE
     ),
     updated_contact AS (
       UPDATE crm_contacts c
       SET name=COALESCE(c.name, $3),
           phone=COALESCE(c.phone, $4),
           email=COALESCE(c.email, $6),
           updated_at=now()
       FROM claimed s
       WHERE c.id=s.contact_id
       RETURNING c.id
     ),
     inserted_contact AS (
       INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
       SELECT $3, $4, $5, $6, 'live_agent', $7 FROM claimed
       WHERE NOT EXISTS (SELECT 1 FROM updated_contact)
       ON CONFLICT (normalized_phone) DO UPDATE SET
         name=COALESCE(crm_contacts.name, EXCLUDED.name),
         phone=COALESCE(crm_contacts.phone, EXCLUDED.phone),
         email=COALESCE(crm_contacts.email, EXCLUDED.email),
         opt_in_whatsapp=crm_contacts.opt_in_whatsapp,
         updated_at=now()
       RETURNING id
     ),
     resolved_contact AS (
       SELECT id FROM updated_contact
       UNION ALL SELECT id FROM inserted_contact
     ),
     updated_lead AS (
       UPDATE crm_leads l
       SET contact_id=c.id,
           stage='contacted',
           intent=$8,
           budget_min=$9,
           budget_max=$10,
           preferred_estates=$11::text[],
           source='live_agent',
           note=COALESCE(NULLIF(l.note, ''), $12),
           updated_at=now()
       FROM claimed s CROSS JOIN resolved_contact c
       WHERE l.id=s.lead_id
       RETURNING l.id
     ),
     inserted_lead AS (
       INSERT INTO crm_leads (
         contact_id, stage, intent, budget_min, budget_max, preferred_estates, source, note
       )
       SELECT c.id, 'contacted', $8, $9, $10, $11::text[], 'live_agent', $12
       FROM claimed s CROSS JOIN resolved_contact c
       WHERE NOT EXISTS (SELECT 1 FROM updated_lead)
       RETURNING id
     ),
     resolved_lead AS (
       SELECT id FROM updated_lead
       UNION ALL SELECT id FROM inserted_lead
     ),
     candidate_conversation AS (
       SELECT w.id
       FROM claimed s CROSS JOIN resolved_contact c
       JOIN whatsapp_conversations w
         ON (w.id=s.conversation_id OR w.contact_id=c.id)
       WHERE w.channel_id IS NOT NULL
         AND w.woztell_member_id IS NOT NULL
       ORDER BY CASE WHEN w.id=s.conversation_id THEN 0 ELSE 1 END, w.updated_at DESC
       LIMIT 1
     ),
     updated_conversation AS (
       UPDATE whatsapp_conversations w
       SET contact_id=c.id,
           status='pending',
           last_message_at=COALESCE(w.last_message_at, now()),
           updated_at=now()
       FROM candidate_conversation candidate CROSS JOIN resolved_contact c
       WHERE w.id=candidate.id
       RETURNING w.id
     ),
     transitioned AS (
       UPDATE live_agent_sessions s
       SET contact_id=c.id,
           lead_id=l.id,
           conversation_id=(SELECT id FROM updated_conversation),
           status='handoff_requested',
           intent=$8,
           budget_min=$9,
           budget_max=$10,
           preferred_estates=$11::text[],
           opt_in_whatsapp=$7,
           updated_at=now()
       FROM claimed claim CROSS JOIN resolved_contact c CROSS JOIN resolved_lead l
       WHERE s.id=claim.id
         AND s.status IN ('open', 'qualified')
       RETURNING s.id
     ),
     follow_up AS (
       INSERT INTO crm_activities (lead_id, contact_id, activity_type, body)
       SELECT l.id, c.id, 'follow_up', $12
       FROM transitioned t CROSS JOIN resolved_contact c CROSS JOIN resolved_lead l
       RETURNING id
     ),
     handoff_message AS (
       INSERT INTO live_agent_messages (session_id, direction, message_text, safety_flags, shown_publicly)
       SELECT id, 'system', $13, ARRAY['handoff_requested']::text[], false
       FROM transitioned
       RETURNING id
     ),
     handoff_audit AS (
       INSERT INTO ai_audit_logs (actor_type, action, subject_type, subject_id, metadata)
       SELECT 'visitor', 'live_agent.handoff', 'live_agent_session', t.id,
         jsonb_build_object(
           'contactId', c.id,
           'leadId', l.id,
           'conversationId', (SELECT id FROM updated_conversation),
           'hasPhone', $14::boolean,
           'sourcePath', $15::text
         )
       FROM transitioned t CROSS JOIN resolved_contact c CROSS JOIN resolved_lead l
       RETURNING id
     )
     SELECT id FROM transitioned`,
    [
      session.id,
      accessToken,
      name,
      phone,
      leadInput.normalized_phone,
      email,
      leadInput.opt_in_whatsapp,
      intent,
      leadInput.budget_min,
      leadInput.budget_max,
      preferredEstates,
      note,
      "Live-agent handoff requested for WhatsApp follow-up.",
      Boolean(phone),
      leadInput.source_path,
    ],
  );

  if (!rows[0]) {
    // The other in-flight request may have won the transition. An owned,
    // already-requested session is an idempotent success; any other state is
    // a real lifecycle conflict.
    const current = await getLiveAgentSessionForHandoff(sessionId, accessToken);
    if (current.status !== "handoff_requested") {
      throw new LiveAgentPublicError("Live-agent session is not open.", 400);
    }
  }

  return { ok: true, status: "handoff_requested" as const };
}

async function getLiveAgentSessionForMessage(sessionId: string, accessToken: string) {
  const rows = await queryRows<LiveAgentSessionRow>(
    `SELECT *
     FROM live_agent_sessions
     WHERE id = $1
       AND access_token = $2
       AND status IN ('open', 'qualified')
     LIMIT 1`,
    [sessionId, accessToken],
  );
  if (rows[0]) return mapSession(rows[0]);

  // Distinguish a wrong/missing token (403) from a closed but owned session
  // (400) and a truly unknown session (404) without leaking which sessions
  // exist to an unauthenticated caller.
  const owned = await queryRows<{ status: unknown }>(
    "SELECT status FROM live_agent_sessions WHERE id = $1 AND access_token = $2 LIMIT 1",
    [sessionId, accessToken],
  );
  if (owned[0]) throw new LiveAgentPublicError("Live-agent session is not open.", 400);

  const existing = await queryRows<{ id: unknown }>(
    "SELECT id FROM live_agent_sessions WHERE id = $1 LIMIT 1",
    [sessionId],
  );
  if (!existing[0]) throw new LiveAgentPublicError("Live-agent session not found.", 404);

  throw new LiveAgentPublicError("Live-agent session access denied.", 403);
}

async function getLiveAgentSessionForHandoff(sessionId: string, accessToken: string) {
  const rows = await queryRows<LiveAgentSessionRow>(
    `SELECT *
     FROM live_agent_sessions
     WHERE id = $1
       AND access_token = $2
     LIMIT 1`,
    [sessionId, accessToken],
  );
  const session = rows[0] ? mapSession(rows[0]) : null;
  if (!session) {
    const existing = await queryRows<{ id: unknown }>(
      "SELECT id FROM live_agent_sessions WHERE id = $1 LIMIT 1",
      [sessionId],
    );
    if (!existing[0]) throw new LiveAgentPublicError("Live-agent session not found.", 404);
    throw new LiveAgentPublicError("Live-agent session access denied.", 403);
  }
  if (
    session.status !== "open" &&
    session.status !== "qualified" &&
    session.status !== "handoff_requested"
  ) {
    throw new LiveAgentPublicError("Live-agent session is not open.", 400);
  }
  return session;
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
