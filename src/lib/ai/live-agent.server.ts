import "@tanstack/react-start/server-only";

import {
  queryRows,
  numberOrNull,
  stringOrEmpty,
  stringOrNull,
  transactionRows,
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

  const contactId = session.contact_id
    ? await updateLiveAgentContact({
        contactId: session.contact_id,
        name,
        phone,
        email,
        optInWhatsapp: leadInput.opt_in_whatsapp,
      })
    : await upsertLiveAgentContact({
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
  const conversationId = await resolveExistingWoztellConversation({
    conversationId: session.conversation_id,
    contactId,
  });
  const transitioningToHandoff = session.status !== "handoff_requested";

  // One transaction, not four sequential writes. The session flips to
  // 'handoff_requested' FIRST, so if any following insert failed the session was
  // already transitioned and `transitioningToHandoff` would be false on a retry
  // -- the agent-facing crm_activities follow-up and the audit row were then
  // never written at all, and a visitor who asked for a callback silently had no
  // task created for anyone.
  const handoffStatements = [
    {
      statement: `UPDATE live_agent_sessions
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
      params: [
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
    },
  ];

  if (transitioningToHandoff) {
    handoffStatements.push(
      {
        statement: `INSERT INTO crm_activities (lead_id, contact_id, activity_type, body)
       VALUES ($1,$2,'follow_up',$3)`,
        params: [leadId, contactId, note],
      },
      {
        statement: `INSERT INTO live_agent_messages (session_id, direction, message_text, safety_flags, shown_publicly)
       VALUES ($1,'system',$2,$3::text[],false)`,
        params: [
          session.id,
          "Live-agent handoff requested for WhatsApp follow-up.",
          ["handoff_requested"],
        ],
      },
      {
        statement: `INSERT INTO ai_audit_logs (actor_type, action, subject_type, subject_id, metadata)
       VALUES ('visitor','live_agent.handoff','live_agent_session',$1,$2::jsonb)`,
        params: [
          session.id,
          JSON.stringify({
            contactId,
            leadId,
            conversationId,
            hasPhone: Boolean(phone),
            sourcePath: leadInput.source_path,
          }),
        ],
      },
    );
  }

  await transactionRows(handoffStatements);

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
         -- Existing values win: the live-agent widget is unauthenticated, so a
         -- caller supplying someone else's phone number must not be able to
         -- rewrite that contact's name/phone/email. New values still fill
         -- blanks. opt_in_whatsapp was already never raised here.
         name = COALESCE(crm_contacts.name, EXCLUDED.name),
         phone = COALESCE(crm_contacts.phone, EXCLUDED.phone),
         email = COALESCE(crm_contacts.email, EXCLUDED.email),
         opt_in_whatsapp = crm_contacts.opt_in_whatsapp,
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

async function updateLiveAgentContact(input: {
  contactId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  optInWhatsapp: boolean;
}) {
  const rows = await queryRows<{ id: unknown }>(
    // Existing values win, matching upsertLiveAgentContact. This path is the
    // one an attacker actually reaches: the FIRST handoff with a victim's phone
    // hits the upsert's ON CONFLICT (which correctly preserves their fields)
    // but returns the victim's contact id, which is then bound to the session.
    // A SECOND handoff on the same unauthenticated session lands here with
    // session.contact_id already set -- so caller-wins COALESCE would rewrite
    // the victim's name, phone and email in place, while normalized_phone (not
    // in this SET list) still points the row at the victim for dedupe and blast
    // targeting.
    `UPDATE crm_contacts
     SET name = COALESCE(name, $1),
         phone = COALESCE(phone, $2),
         email = COALESCE(email, $3),
         updated_at = now()
     WHERE id=$4
     RETURNING id`,
    [input.name, input.phone, input.email, input.contactId],
  );
  if (rows[0]) return stringOrEmpty(rows[0].id);
  return upsertLiveAgentContact({
    name: input.name,
    phone: input.phone,
    normalizedPhone: null,
    email: input.email,
    optInWhatsapp: input.optInWhatsapp,
  });
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

async function resolveExistingWoztellConversation(input: {
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
         AND channel_id IS NOT NULL
         AND woztell_member_id IS NOT NULL
       RETURNING id`,
      [input.contactId, input.conversationId],
    );
    if (rows[0]) return stringOrEmpty(rows[0].id);
  }

  const existing = await queryRows<{ id: unknown }>(
    `SELECT id
     FROM whatsapp_conversations
     WHERE contact_id=$1
       AND channel_id IS NOT NULL
       AND woztell_member_id IS NOT NULL
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

  return null;
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
