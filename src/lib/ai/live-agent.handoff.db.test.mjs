import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { mockOwnedServerDb, repoRoot } from "../../../scripts/acceptance/owned-postgres-test.mjs";

// The real migrations that define every table the handoff SQL touches. Later migrations only add
// triggers and indexes that never fire on these paths.
const BASE_MIGRATIONS = [
  "20260622060000_public_content.sql",
  "20260623090000_neon_admin_crm_whatsapp.sql",
  "20260624110000_ai_crm_live_agent.sql",
  "20260626120000_live_agent_security.sql",
];
const migrationSql = BASE_MIGRATIONS.map((file) =>
  readFileSync(new URL("neon/migrations/" + file, repoRoot), "utf8"),
);

let db;
let afterQuery = null;
let modelCalls = 0;

const query = async (statement, params = []) => {
  const { rows } = await db.query(statement, params);
  await afterQuery?.(statement);
  return rows;
};
const transaction = async (statements) =>
  db.transaction(async (tx) => {
    const results = [];
    for (const { statement, params = [] } of statements) {
      results.push((await tx.query(statement, params)).rows);
    }
    return results;
  });

await mockOwnedServerDb(mock, query, transaction);
const knowledgeUrl = new URL("src/lib/ai/knowledge.server.ts", repoRoot).href;
// Spread the real module: admin-data.server.ts imports rebuildAiKnowledgeIndex from it.
const actualKnowledge = await import(knowledgeUrl);
mock.module(knowledgeUrl, {
  exports: {
    ...actualKnowledge,
    answerFromPublicKnowledge: async () => {
      modelCalls += 1;
      return {
        answer: "合成答案",
        confidence: 0.9,
        citations: [{ title: "合成來源", url_path: "/faq", source_type: "faq" }],
      };
    },
  },
});
const live = await import("./live-agent.server.ts");
const adminData = await import("../neon/admin-data.server.ts");

async function freshDb() {
  db = new PGlite({ extensions: { vector, pgcrypto } });
  for (const sql of migrationSql) await db.exec(sql);
  afterQuery = null;
  modelCalls = 0;
}

async function openSession() {
  const { session, accessToken } = await live.createLiveAgentSession({ sourcePath: "/listings" });
  return { sessionId: session.id, accessToken };
}

function handoffInput(session, overrides = {}) {
  return {
    sessionId: session.sessionId,
    accessToken: session.accessToken,
    name: "Synthetic visitor",
    phone: "9123 4567",
    intent: "buyer",
    opt_in_whatsapp: false,
    ...overrides,
  };
}

async function count(sql, params = []) {
  return (await query(sql, params))[0].n;
}

test("base migrations load on PGlite and a session can be opened", async () => {
  await freshDb();
  try {
    const session = await openSession();
    assert.match(
      session.sessionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.equal(typeof session.accessToken, "string");
    assert.ok(session.accessToken.length > 0);
  } finally {
    await db.close();
  }
});

test("concurrent double-submit still creates exactly one lead, follow-up and audit", async () => {
  await freshDb();
  try {
    const session = await openSession();
    // Both requests pass the session pre-read before either runs the claiming CTE.
    let arrivals = 0;
    let releaseReads;
    const bothRead = new Promise((resolve) => {
      releaseReads = resolve;
    });
    afterQuery = async (statement) => {
      if (!/SELECT \*\s+FROM live_agent_sessions/.test(statement)) return;
      arrivals += 1;
      if (arrivals > 2) return;
      if (arrivals === 2) releaseReads();
      await bothRead;
    };

    const input = handoffInput(session);
    const results = await Promise.all([
      live.requestLiveAgentHandoff(input),
      live.requestLiveAgentHandoff(input),
    ]);
    afterQuery = null;

    // Two pre-reads met at the barrier, and the loser re-read the session in the fallback, where
    // the same phone makes its correction a no-op.
    assert.equal(arrivals, 3);
    assert.deepEqual(results, [
      { ok: true, status: "handoff_requested" },
      { ok: true, status: "handoff_requested" },
    ]);
    assert.equal(await count("SELECT count(*)::int AS n FROM crm_leads"), 1);
    assert.equal(
      await count("SELECT count(*)::int AS n FROM crm_activities WHERE activity_type='follow_up'"),
      1,
    );
    assert.equal(
      await count("SELECT count(*)::int AS n FROM ai_audit_logs WHERE action='live_agent.handoff'"),
      1,
    );
    assert.equal(
      await count("SELECT count(*)::int AS n FROM live_agent_messages WHERE direction='system'"),
      1,
    );
    assert.equal(
      await count(
        "SELECT count(*)::int AS n FROM ai_audit_logs WHERE action='live_agent.handoff.phone_corrected'",
      ),
      0,
    );
  } finally {
    await db.close();
  }
});

async function handoffAudit(sessionId) {
  const rows = await query(
    `SELECT metadata FROM ai_audit_logs
     WHERE action='live_agent.handoff' AND subject_id=$1
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId],
  );
  assert.equal(rows.length, 1);
  return rows[0].metadata;
}

async function sessionRow(sessionId) {
  return (
    await query(
      "SELECT contact_id, lead_id, conversation_id FROM live_agent_sessions WHERE id=$1",
      [sessionId],
    )
  )[0];
}

test("a new handoff lead starts at stage new", async () => {
  await freshDb();
  try {
    const session = await openSession();
    assert.deepEqual(await live.requestLiveAgentHandoff(handoffInput(session)), {
      ok: true,
      status: "handoff_requested",
    });

    const { lead_id: leadId, contact_id: contactId } = await sessionRow(session.sessionId);
    const [lead] = await query("SELECT stage, source FROM crm_leads WHERE id=$1", [leadId]);
    assert.equal(lead.stage, "new");
    assert.equal(lead.source, "live_agent");
    const [contact] = await query("SELECT normalized_phone, source FROM crm_contacts WHERE id=$1", [
      contactId,
    ]);
    assert.equal(contact.normalized_phone, "85291234567");
    assert.equal(contact.source, "live_agent");
  } finally {
    await db.close();
  }
});

test("00852 and +852 inputs store the same normalized phone", async () => {
  await freshDb();
  try {
    const first = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(first, { phone: "0085261234567" }));
    const { contact_id: firstContactId } = await sessionRow(first.sessionId);
    const [contact] = await query("SELECT normalized_phone FROM crm_contacts WHERE id=$1", [
      firstContactId,
    ]);
    assert.equal(contact.normalized_phone, "85261234567");

    const second = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(second, { phone: "+852 6123 4567" }));
    const { contact_id: secondContactId } = await sessionRow(second.sessionId);
    assert.equal(secondContactId, firstContactId);
    assert.equal(
      await count(
        "SELECT count(*)::int AS n FROM crm_contacts WHERE normalized_phone LIKE '%61234567'",
      ),
      1,
    );
  } finally {
    await db.close();
  }
});

for (const storedPhone of ["85291234567", "91234567"]) {
  test(`a phone matching an existing customer never changes that customer's contact or WhatsApp conversation (stored as ${storedPhone})`, async () => {
    await freshDb();
    try {
      const [existing] = await query(
        `INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, updated_at)
         VALUES ('Existing customer', '9123 4567', $1, NULL, 'website', '2026-01-01T00:00:00Z')
         RETURNING id`,
        [storedPhone],
      );
      const contactId = existing.id;
      const [conversation] = await query(
        `INSERT INTO whatsapp_conversations (contact_id, channel_id, woztell_member_id, status, updated_at)
         VALUES ($1, 'synthetic-channel', 'synthetic-member', 'open', '2026-01-02T03:04:05Z')
         RETURNING id`,
        [contactId],
      );
      const conversationId = conversation.id;
      const contactBefore = await query("SELECT * FROM crm_contacts WHERE id=$1", [contactId]);
      const conversationBefore = await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [
        conversationId,
      ]);

      const session = await openSession();
      assert.deepEqual(
        await live.requestLiveAgentHandoff(
          handoffInput(session, {
            phone: "9123 4567",
            name: "Typo visitor",
            email: "typo@example.invalid",
          }),
        ),
        { ok: true, status: "handoff_requested" },
      );

      assert.deepEqual(
        await query("SELECT * FROM crm_contacts WHERE id=$1", [contactId]),
        contactBefore,
      );
      assert.equal(contactBefore[0].email, null);
      assert.deepEqual(
        await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [conversationId]),
        conversationBefore,
      );

      const after = await sessionRow(session.sessionId);
      assert.equal(after.conversation_id, null);
      assert.equal(after.contact_id, contactId);

      const notes = await query(
        "SELECT body FROM crm_activities WHERE lead_id=$1 AND activity_type='note'",
        [after.lead_id],
      );
      assert.deepEqual(
        notes.map((row) => row.body),
        [`可能與現有 WhatsApp 對話相關（對話編號 ${conversationId}）`],
      );

      const metadata = await handoffAudit(session.sessionId);
      assert.equal(metadata.possibleConversationId, conversationId);
      assert.equal(metadata.contactCreated, false);
      assert.equal(metadata.conversationId, undefined);
    } finally {
      await db.close();
    }
  });
}

test("a new number creates a contact and records contactCreated in the handoff audit", async () => {
  await freshDb();
  try {
    const session = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(session, { phone: "+44 7700 900123" }));

    const after = await sessionRow(session.sessionId);
    const [contact] = await query("SELECT normalized_phone, source FROM crm_contacts WHERE id=$1", [
      after.contact_id,
    ]);
    assert.equal(contact.normalized_phone, "447700900123");
    assert.equal(contact.source, "live_agent");
    assert.equal(
      await count(
        "SELECT count(*)::int AS n FROM crm_activities WHERE lead_id=$1 AND activity_type='note'",
        [after.lead_id],
      ),
      0,
    );

    const metadata = await handoffAudit(session.sessionId);
    assert.equal(metadata.contactCreated, true);
    assert.equal(metadata.possibleConversationId, null);
  } finally {
    await db.close();
  }
});

// Ordered rows of every table a correction or a post-handoff message could touch. Session rows
// keep updated_at too, so a refused correction cannot even bump the session.
async function snapshot() {
  return {
    contacts: await query("SELECT * FROM crm_contacts ORDER BY id"),
    leads: await query("SELECT * FROM crm_leads ORDER BY id"),
    sessions: await query(
      `SELECT id, status, contact_id, lead_id, conversation_id, updated_at
       FROM live_agent_sessions
       ORDER BY id`,
    ),
    activities: await query("SELECT * FROM crm_activities ORDER BY id"),
    aiAudits: await query("SELECT * FROM ai_audit_logs ORDER BY id"),
    conversations: await query("SELECT * FROM whatsapp_conversations ORDER BY id"),
  };
}

async function correctionAudits(sessionId) {
  const rows = await query(
    `SELECT actor_type, subject_type, metadata FROM ai_audit_logs
     WHERE action='live_agent.handoff.phone_corrected' AND subject_id=$1
     ORDER BY created_at`,
    [sessionId],
  );
  for (const row of rows) {
    assert.equal(row.actor_type, "visitor");
    assert.equal(row.subject_type, "live_agent_session");
    // The audit identifies contacts by id only; it never stores a raw or normalised phone.
    assert.doesNotMatch(
      JSON.stringify(row.metadata).replace(/\s|-/g, ""),
      /91234567|61234567|98765432|51234567/,
    );
  }
  return rows.map((row) => row.metadata);
}

async function insertStaff() {
  const [staff] = await query(
    `INSERT INTO staff_users (email, name_en)
     VALUES ('synthetic-agent@example.invalid', 'Synthetic agent')
     RETURNING id`,
  );
  await query("INSERT INTO staff_roles (staff_user_id, role) VALUES ($1, 'agent')", [staff.id]);
  return staff.id;
}

test("correction while uncontacted updates the contact this handoff created", async () => {
  await freshDb();
  try {
    const session = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(session, { phone: "9123 4567" }));
    const before = await sessionRow(session.sessionId);

    assert.deepEqual(
      await live.requestLiveAgentHandoff(handoffInput(session, { phone: "6123 4567" })),
      { ok: true, status: "handoff_requested" },
    );

    const after = await sessionRow(session.sessionId);
    assert.equal(after.contact_id, before.contact_id);
    assert.equal(after.lead_id, before.lead_id);
    const [lead] = await query("SELECT contact_id FROM crm_leads WHERE id=$1", [before.lead_id]);
    assert.equal(lead.contact_id, before.contact_id);
    assert.equal(await count("SELECT count(*)::int AS n FROM crm_leads"), 1);
    assert.equal(await count("SELECT count(*)::int AS n FROM crm_contacts"), 1);

    const [contact] = await query("SELECT phone, normalized_phone FROM crm_contacts WHERE id=$1", [
      before.contact_id,
    ]);
    assert.equal(contact.normalized_phone, "85261234567");
    assert.equal(contact.phone, "6123 4567");

    assert.deepEqual(await correctionAudits(session.sessionId), [
      {
        leadId: before.lead_id,
        fromContactId: before.contact_id,
        toContactId: before.contact_id,
        mode: "updated_contact",
        possibleConversationId: null,
      },
    ]);
  } finally {
    await db.close();
  }
});

test("same phone resubmitted is a no-op", async () => {
  await freshDb();
  try {
    const session = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(session, { phone: "91234567" }));
    const before = await snapshot();

    assert.deepEqual(
      await live.requestLiveAgentHandoff(handoffInput(session, { phone: "+852 9123 4567" })),
      { ok: true, status: "handoff_requested" },
    );

    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await correctionAudits(session.sessionId), []);
  } finally {
    await db.close();
  }
});

test("correction when the handoff matched an existing customer relinks to a new contact and leaves that customer unchanged", async () => {
  await freshDb();
  try {
    const [existing] = await query(
      `INSERT INTO crm_contacts (name, phone, normalized_phone, source, updated_at)
       VALUES ('Existing customer', '9123 4567', '85291234567', 'website', '2026-01-01T00:00:00Z')
       RETURNING id`,
    );
    // The visitor opts in on both submits; the snapshot proves the matched customer's consent
    // (seeded false) is never raised.
    const session = await openSession();
    await live.requestLiveAgentHandoff(
      handoffInput(session, { phone: "9123 4567", opt_in_whatsapp: true }),
    );
    const linked = await sessionRow(session.sessionId);
    assert.equal(linked.contact_id, existing.id);
    const existingBefore = await query("SELECT * FROM crm_contacts WHERE id=$1", [existing.id]);
    assert.equal(existingBefore[0].opt_in_whatsapp, false);

    assert.deepEqual(
      await live.requestLiveAgentHandoff(
        handoffInput(session, { phone: "6123 4567", opt_in_whatsapp: true }),
      ),
      { ok: true, status: "handoff_requested" },
    );

    const after = await sessionRow(session.sessionId);
    assert.notEqual(after.contact_id, existing.id);
    assert.equal(after.lead_id, linked.lead_id);
    assert.equal(after.conversation_id, null);
    const [created] = await query(
      "SELECT phone, normalized_phone, source FROM crm_contacts WHERE id=$1",
      [after.contact_id],
    );
    assert.equal(created.normalized_phone, "85261234567");
    assert.equal(created.phone, "6123 4567");
    assert.equal(created.source, "live_agent");

    const [lead] = await query("SELECT contact_id FROM crm_leads WHERE id=$1", [after.lead_id]);
    assert.equal(lead.contact_id, after.contact_id);
    assert.deepEqual(
      await query("SELECT * FROM crm_contacts WHERE id=$1", [existing.id]),
      existingBefore,
    );

    const followUps = await query(
      "SELECT contact_id FROM crm_activities WHERE lead_id=$1 AND activity_type='follow_up'",
      [after.lead_id],
    );
    assert.deepEqual(
      followUps.map((row) => row.contact_id),
      [after.contact_id],
    );

    assert.deepEqual(await correctionAudits(session.sessionId), [
      {
        leadId: after.lead_id,
        fromContactId: existing.id,
        toContactId: after.contact_id,
        mode: "relinked",
        possibleConversationId: null,
      },
    ]);
  } finally {
    await db.close();
  }
});

test("corrected number that belongs to another customer links read-only and notes the conversation", async () => {
  await freshDb();
  try {
    const [other] = await query(
      `INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, updated_at)
       VALUES ('Other customer', '6123 4567', '85261234567', NULL, 'website', '2026-01-01T00:00:00Z')
       RETURNING id`,
    );
    const [conversation] = await query(
      `INSERT INTO whatsapp_conversations (contact_id, channel_id, woztell_member_id, status, updated_at)
       VALUES ($1, 'synthetic-channel', 'synthetic-member', 'open', '2026-01-02T03:04:05Z')
       RETURNING id`,
      [other.id],
    );
    const otherBefore = await query("SELECT * FROM crm_contacts WHERE id=$1", [other.id]);
    assert.equal(otherBefore[0].opt_in_whatsapp, false);
    const conversationBefore = await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [
      conversation.id,
    ]);

    // The visitor opts in on both submits; the snapshot proves the matched customer's consent
    // (seeded false) is never raised.
    const session = await openSession();
    await live.requestLiveAgentHandoff(
      handoffInput(session, { phone: "9876 5432", opt_in_whatsapp: true }),
    );
    const first = await sessionRow(session.sessionId);
    assert.notEqual(first.contact_id, other.id);

    assert.deepEqual(
      await live.requestLiveAgentHandoff(
        handoffInput(session, {
          phone: "6123 4567",
          name: "Typo visitor",
          email: "typo@example.invalid",
          opt_in_whatsapp: true,
        }),
      ),
      { ok: true, status: "handoff_requested" },
    );

    const after = await sessionRow(session.sessionId);
    assert.equal(after.contact_id, other.id);
    assert.equal(after.conversation_id, null);
    const [lead] = await query("SELECT contact_id FROM crm_leads WHERE id=$1", [after.lead_id]);
    assert.equal(lead.contact_id, other.id);

    assert.deepEqual(
      await query("SELECT * FROM crm_contacts WHERE id=$1", [other.id]),
      otherBefore,
    );
    assert.deepEqual(
      await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [conversation.id]),
      conversationBefore,
    );

    const notes = await query(
      "SELECT body, contact_id FROM crm_activities WHERE lead_id=$1 AND activity_type='note'",
      [after.lead_id],
    );
    assert.deepEqual(
      notes.map((row) => [row.body, row.contact_id]),
      [[`可能與現有 WhatsApp 對話相關（對話編號 ${conversation.id}）`, other.id]],
    );

    // existing_for_new won, so the contact the first handoff created was relinked away from,
    // never updated to the other customer's number and never deleted.
    const [firstContact] = await query(
      "SELECT phone, normalized_phone FROM crm_contacts WHERE id=$1",
      [first.contact_id],
    );
    assert.equal(firstContact.normalized_phone, "85298765432");
    assert.equal(firstContact.phone, "9876 5432");

    assert.deepEqual(await correctionAudits(session.sessionId), [
      {
        leadId: after.lead_id,
        fromContactId: first.contact_id,
        toContactId: other.id,
        mode: "relinked",
        possibleConversationId: conversation.id,
      },
    ]);
  } finally {
    await db.close();
  }
});

test("a second correction never updates the pre-existing customer the first correction linked to", async () => {
  await freshDb();
  try {
    // No conversation, lead or session references this customer, so only the handoff audit's
    // contactId tells it apart from the contact the handoff created.
    const [other] = await query(
      `INSERT INTO crm_contacts (name, phone, normalized_phone, source, updated_at)
       VALUES ('Other customer', '6123 4567', '85261234567', 'website', '2026-01-01T00:00:00Z')
       RETURNING id`,
    );
    const otherBefore = await query("SELECT * FROM crm_contacts WHERE id=$1", [other.id]);

    const session = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(session, { phone: "9876 5432" }));
    const first = await sessionRow(session.sessionId);
    await live.requestLiveAgentHandoff(handoffInput(session, { phone: "6123 4567" }));
    assert.equal((await sessionRow(session.sessionId)).contact_id, other.id);

    await live.requestLiveAgentHandoff(handoffInput(session, { phone: "5123 4567" }));

    const after = await sessionRow(session.sessionId);
    assert.notEqual(after.contact_id, other.id);
    assert.notEqual(after.contact_id, first.contact_id);
    const [created] = await query("SELECT normalized_phone FROM crm_contacts WHERE id=$1", [
      after.contact_id,
    ]);
    assert.equal(created.normalized_phone, "85251234567");
    assert.deepEqual(
      await query("SELECT * FROM crm_contacts WHERE id=$1", [other.id]),
      otherBefore,
    );
    assert.deepEqual(
      (await correctionAudits(session.sessionId)).map((metadata) => metadata.mode),
      ["relinked", "relinked"],
    );
  } finally {
    await db.close();
  }
});

const STAFF_SIGNALS = [
  [
    "stage contacted",
    ({ leadId }) => query("UPDATE crm_leads SET stage='contacted' WHERE id=$1", [leadId]),
  ],
  [
    "assigned agent",
    ({ leadId, staffId }) =>
      query("UPDATE crm_leads SET assigned_agent_id=$2 WHERE id=$1", [leadId, staffId]),
  ],
  [
    "staff note",
    ({ leadId, staffId }) =>
      query(
        `INSERT INTO crm_activities (lead_id, staff_user_id, activity_type, body)
         VALUES ($1, $2, 'note', 'Synthetic staff note')`,
        [leadId, staffId],
      ),
  ],
  [
    "staff audit",
    ({ leadId, staffId }) =>
      query(
        `INSERT INTO audit_logs (actor_id, action, subject_type, subject_id)
         VALUES ($1, 'lead.update', 'lead', $2)`,
        [staffId, leadId],
      ),
  ],
];

for (const [label, staffActs] of STAFF_SIGNALS) {
  test(`correction is refused without any write once staff have acted (${label})`, async () => {
    await freshDb();
    try {
      const session = await openSession();
      await live.requestLiveAgentHandoff(handoffInput(session, { phone: "9123 4567" }));
      const { lead_id: leadId } = await sessionRow(session.sessionId);
      const staffId = await insertStaff();
      await staffActs({ leadId, staffId });
      const before = await snapshot();

      assert.deepEqual(
        await live.requestLiveAgentHandoff(handoffInput(session, { phone: "6123 4567" })),
        { ok: true, status: "handoff_requested" },
      );

      assert.deepEqual(await snapshot(), before);
    } finally {
      await db.close();
    }
  });
}

async function sessionMessages(sessionId) {
  // PGlite's clock has millisecond resolution, so two inserts can share a created_at. ctid breaks
  // the tie in insertion order on this append-only table.
  return query(
    `SELECT direction, message_text, citations, safety_flags, shown_publicly, created_at
     FROM live_agent_messages
     WHERE session_id=$1
     ORDER BY created_at, ctid`,
    [sessionId],
  );
}

test("message after handoff is stored, answered with fixed copy and never calls the model", async () => {
  await freshDb();
  try {
    const session = await openSession();
    const first = await live.answerLiveAgentMessage({ ...session, message: "想問屋苑" });
    assert.equal(modelCalls, 1, "positive control: the mocked model answers before the handoff");
    assert.equal(first.message.direction, "assistant");

    await live.requestLiveAgentHandoff(handoffInput(session));
    const leadsBefore = await query("SELECT * FROM crm_leads ORDER BY id");
    const activitiesBefore = await query("SELECT * FROM crm_activities ORDER BY id");

    const result = await live.answerLiveAgentMessage({ ...session, message: "仲有我想要高層" });

    assert.equal(modelCalls, 1);
    assert.equal(result.message.message_text, "已轉交代理，我哋會盡快聯絡你。");
    assert.equal(result.message.direction, "assistant");
    assert.equal(result.handoffSuggested, false);

    const messages = await sessionMessages(session.sessionId);
    const [visitor, reply] = messages.slice(-2);
    assert.equal(visitor.direction, "visitor");
    assert.equal(visitor.message_text, "仲有我想要高層");
    assert.equal(reply.direction, "assistant");
    assert.equal(reply.message_text, "已轉交代理，我哋會盡快聯絡你。");
    assert.deepEqual(reply.citations, []);
    assert.deepEqual(reply.safety_flags, ["handoff_requested"]);
    assert.equal(reply.shown_publicly, true);
    assert.ok(reply.created_at >= visitor.created_at);

    assert.deepEqual(await query("SELECT * FROM crm_leads ORDER BY id"), leadsBefore);
    assert.deepEqual(await query("SELECT * FROM crm_activities ORDER BY id"), activitiesBefore);
  } finally {
    await db.close();
  }
});

test("message to a closed session is still rejected", async () => {
  await freshDb();
  try {
    const session = await openSession();
    await query("UPDATE live_agent_sessions SET status='closed' WHERE id=$1", [session.sessionId]);

    await assert.rejects(
      live.answerLiveAgentMessage({ ...session, message: "仲有我想要高層" }),
      (error) => error instanceof live.LiveAgentPublicError && error.status === 400,
    );
    assert.equal(modelCalls, 0);
    assert.deepEqual(await sessionMessages(session.sessionId), []);
  } finally {
    await db.close();
  }
});

async function insertStaffMember(email, role) {
  const [staff] = await query(
    "INSERT INTO staff_users (email, name_en) VALUES ($1, 'Synthetic staff') RETURNING id",
    [email],
  );
  await query("INSERT INTO staff_roles (staff_user_id, role) VALUES ($1, $2)", [staff.id, role]);
  return {
    staffId: staff.id,
    authUserId: `synthetic-auth-${staff.id}`,
    email: null,
    name: null,
    roles: [role],
    bootstrap: false,
  };
}

// PGlite's clock has millisecond resolution, so the rows of one flow can share a created_at while
// their ids are random. Re-stamp them one second apart in insertion order (ctid, test-only) so
// the expected order below does not depend on the production tie-break.
async function spaceOutMessages(sessionId) {
  await query(
    `WITH ordered AS (
       SELECT id, row_number() OVER (ORDER BY created_at, ctid) AS n
       FROM live_agent_messages
       WHERE session_id=$1
     )
     UPDATE live_agent_messages m
     SET created_at = '2026-01-01T00:00:00Z'::timestamptz + (ordered.n * interval '1 second')
     FROM ordered
     WHERE m.id = ordered.id`,
    [sessionId],
  );
}

const readTranscript = (leadId, actor) => adminData.fetchLeadLiveAgentTranscript({ leadId }, actor);
const projectTranscript = (messages) =>
  messages.map((message) => ({ role: message.role, text: message.text }));
const isForbidden = (error) => error instanceof Response && error.status === 403;

test("transcript is readable by the assigned agent and managers, in order, and refused to other agents", async () => {
  await freshDb();
  try {
    const session = await openSession();
    await live.answerLiveAgentMessage({ ...session, message: "想問屋苑" });
    await live.requestLiveAgentHandoff(handoffInput(session));
    await live.answerLiveAgentMessage({ ...session, message: "仲有我想要高層" });
    const { lead_id: leadId } = await sessionRow(session.sessionId);
    await spaceOutMessages(session.sessionId);

    const agentA = await insertStaffMember("synthetic-agent-a@example.invalid", "agent");
    const agentB = await insertStaffMember("synthetic-agent-b@example.invalid", "agent");
    const manager = await insertStaffMember("synthetic-manager@example.invalid", "manager");
    await query("UPDATE crm_leads SET assigned_agent_id=$2 WHERE id=$1", [leadId, agentA.staffId]);
    const messagesBefore = await query("SELECT * FROM live_agent_messages ORDER BY id");
    const auditsBefore = await query("SELECT * FROM audit_logs ORDER BY id");

    const [systemRow] = await query(
      "SELECT message_text FROM live_agent_messages WHERE session_id=$1 AND direction='system'",
      [session.sessionId],
    );
    const expected = [
      { role: "visitor", text: "想問屋苑" },
      { role: "assistant", text: "合成答案" },
      { role: "system", text: systemRow.message_text },
      { role: "visitor", text: "仲有我想要高層" },
      { role: "assistant", text: "已轉交代理，我哋會盡快聯絡你。" },
    ];

    const asAgent = await readTranscript(leadId, agentA);
    assert.deepEqual(projectTranscript(asAgent), expected);
    assert.deepEqual(projectTranscript(await readTranscript(leadId, manager)), expected);
    for (const message of asAgent) {
      assert.ok(!Number.isNaN(Date.parse(message.created_at)));
    }
    assert.deepEqual(
      asAgent.map((message) => message.created_at),
      [...asAgent.map((message) => message.created_at)].sort(),
    );
    await assert.rejects(readTranscript(leadId, agentB), isForbidden);

    await query("UPDATE crm_leads SET assigned_agent_id=NULL WHERE id=$1", [leadId]);
    const leadsUnassigned = await query("SELECT * FROM crm_leads ORDER BY id");
    await assert.rejects(readTranscript(leadId, agentA), isForbidden);
    assert.deepEqual(projectTranscript(await readTranscript(leadId, manager)), expected);

    // Reading writes nothing: no message, lead or audit row changed.
    assert.deepEqual(await query("SELECT * FROM live_agent_messages ORDER BY id"), messagesBefore);
    assert.deepEqual(await query("SELECT * FROM crm_leads ORDER BY id"), leadsUnassigned);
    assert.deepEqual(await query("SELECT * FROM audit_logs ORDER BY id"), auditsBefore);
  } finally {
    await db.close();
  }
});

test("transcript only reads the lead's own sessions and keeps staff messages", async () => {
  await freshDb();
  try {
    const first = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(first));
    const { lead_id: leadId } = await sessionRow(first.sessionId);
    const other = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(other, { phone: "6123 4567" }));
    await query("DELETE FROM live_agent_messages");
    await query(
      `INSERT INTO live_agent_messages (session_id, direction, message_text, created_at)
       VALUES ($1, 'staff', '同事跟進', '2026-02-01T00:00:00Z'),
              ($2, 'visitor', '別人的對話', '2026-02-01T00:00:01Z')`,
      [first.sessionId, other.sessionId],
    );

    const manager = await insertStaffMember("synthetic-manager@example.invalid", "manager");
    const messages = await readTranscript(leadId, manager);
    assert.deepEqual(projectTranscript(messages), [{ role: "staff", text: "同事跟進" }]);
    assert.equal(messages[0].created_at, "2026-02-01T00:00:00.000Z");
  } finally {
    await db.close();
  }
});

test("transcript returns at most the latest 100 messages, oldest first", async () => {
  await freshDb();
  try {
    const session = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(session));
    const { lead_id: leadId } = await sessionRow(session.sessionId);
    await query("DELETE FROM live_agent_messages WHERE session_id=$1", [session.sessionId]);
    await query(
      `INSERT INTO live_agent_messages (session_id, direction, message_text, created_at)
       SELECT $1::uuid,
              'visitor',
              'm' || lpad(n::text, 3, '0'),
              '2026-03-01T00:00:00Z'::timestamptz + (n * interval '1 second')
       FROM generate_series(1, 120) AS n`,
      [session.sessionId],
    );

    const manager = await insertStaffMember("synthetic-manager@example.invalid", "manager");
    const messages = await readTranscript(leadId, manager);
    assert.equal(messages.length, 100);
    assert.equal(messages[0].text, "m021");
    assert.equal(messages[99].text, "m120");
    assert.deepEqual(
      messages.map((message) => message.text),
      Array.from({ length: 100 }, (_, i) => `m${String(i + 21).padStart(3, "0")}`),
    );
  } finally {
    await db.close();
  }
});

test("transcript rows that share a created_at come back in a stable id order", async () => {
  await freshDb();
  try {
    const session = await openSession();
    await live.requestLiveAgentHandoff(handoffInput(session));
    const { lead_id: leadId } = await sessionRow(session.sessionId);
    await query("DELETE FROM live_agent_messages WHERE session_id=$1", [session.sessionId]);
    // Ids are listed out of order on purpose; the tie-break must sort them, not insertion order.
    for (const [id, text] of [
      ["00000000-0000-4000-8000-000000000003", "third"],
      ["00000000-0000-4000-8000-000000000001", "first"],
      ["00000000-0000-4000-8000-000000000002", "second"],
    ]) {
      await query(
        `INSERT INTO live_agent_messages (id, session_id, direction, message_text, created_at)
         VALUES ($1, $2, 'visitor', $3, '2026-04-01T00:00:00Z')`,
        [id, session.sessionId, text],
      );
    }

    const manager = await insertStaffMember("synthetic-manager@example.invalid", "manager");
    const first = await readTranscript(leadId, manager);
    const second = await readTranscript(leadId, manager);
    assert.deepEqual(
      first.map((message) => message.text),
      ["first", "second", "third"],
    );
    assert.deepEqual(second, first);
  } finally {
    await db.close();
  }
});
