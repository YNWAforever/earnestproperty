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
