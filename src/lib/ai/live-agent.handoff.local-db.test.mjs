import assert from "node:assert/strict";
import pg from "pg";
import { mock, test } from "bun:test";

const LOCAL_URL = "postgresql://postgres:local-audit-only@127.0.0.1:55432/postgres";
const enabled = process.env.LOCAL_POSTGRES_URL === LOCAL_URL;

(enabled ? test : test.skip)(
  "handoff prevents duplicate work, closed-session revival, contact takeover and partial writes",
  async () => {
    const adminPool = new pg.Pool({ connectionString: LOCAL_URL });
    const schema = `handoff_audit_${crypto.randomUUID().replaceAll("-", "")}`;
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: LOCAL_URL, options: `-c search_path=${schema}` });

    try {
      for (const ddl of [
        `CREATE TYPE crm_lead_stage AS ENUM ('new', 'contacted', 'qualified')`,
        `CREATE TYPE live_agent_session_status AS ENUM ('open', 'qualified', 'handoff_requested', 'handoff_completed', 'closed')`,
        `CREATE TYPE live_agent_message_direction AS ENUM ('visitor', 'assistant', 'system')`,
        `CREATE TABLE live_agent_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), access_token text NOT NULL,
        anonymous_id text, source_path text, contact_id uuid, lead_id uuid,
        conversation_id uuid, status live_agent_session_status NOT NULL DEFAULT 'open', intent text,
        budget_min numeric, budget_max numeric, preferred_estates text[],
        timeline text, opt_in_whatsapp boolean DEFAULT false,
        updated_at timestamptz DEFAULT now())`,
        `CREATE TABLE crm_contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone text,
        normalized_phone text UNIQUE, email text, source text,
        opt_in_whatsapp boolean DEFAULT false, updated_at timestamptz DEFAULT now())`,
        `CREATE TABLE crm_leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid, stage crm_lead_stage,
        intent text, budget_min numeric, budget_max numeric, preferred_estates text[],
        source text, note text, updated_at timestamptz DEFAULT now())`,
        `CREATE TABLE whatsapp_conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid, channel_id text,
        woztell_member_id text, status text, last_message_at timestamptz,
        updated_at timestamptz DEFAULT now())`,
        `CREATE TABLE crm_activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid,
        contact_id uuid, activity_type text, body text)`,
        `CREATE TABLE live_agent_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid,
        direction live_agent_message_direction, message_text text, safety_flags text[], shown_publicly boolean)`,
        `CREATE TABLE ai_audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_type text,
        action text, subject_type text, subject_id uuid, metadata jsonb)`,
      ])
        await pool.query(ddl);

      const inserted = await pool.query(
        "INSERT INTO live_agent_sessions (access_token, source_path) VALUES ('secret-token', '/listings') RETURNING id",
      );
      const sessionId = inserted.rows[0].id;
      let releaseReads;
      const readsDone = new Promise((resolve) => {
        releaseReads = resolve;
      });
      let readCount = 0;
      let blockClosedRead = false;
      let releaseClosedRead;
      let reportClosedRead;
      const closedReadGate = new Promise((resolve) => {
        releaseClosedRead = resolve;
      });
      const closedReadSeen = new Promise((resolve) => {
        reportClosedRead = resolve;
      });

      mock.module("@/lib/neon/db.server", () => ({
        getSql: () => {
          throw new Error("Unexpected Neon adapter access");
        },
        queryRows: async (statement, params = []) => {
          const rows = (await pool.query(statement, params)).rows;
          if (statement.includes("SELECT *") && statement.includes("FROM live_agent_sessions")) {
            readCount += 1;
            if (readCount === 2) releaseReads();
            await readsDone;
            if (blockClosedRead) {
              reportClosedRead();
              await closedReadGate;
            }
          }
          return rows;
        },
        stringOrEmpty: (value) => (value == null ? "" : String(value)),
        stringOrNull: (value) => (value == null ? null : String(value)),
        numberOrNull: (value) => (value == null ? null : Number(value)),
      }));

      const { requestLiveAgentHandoff } = await import("./live-agent.server.ts");
      const input = {
        sessionId,
        accessToken: "secret-token",
        name: "Visitor",
        phone: "61234567",
        intent: "buyer",
        opt_in_whatsapp: false,
      };
      await Promise.all([requestLiveAgentHandoff(input), requestLiveAgentHandoff(input)]);

      const counts = await pool.query(
        `SELECT
         (SELECT count(*)::int FROM crm_activities) AS follow_ups,
         (SELECT count(*)::int FROM live_agent_messages WHERE direction='system') AS messages,
         (SELECT count(*)::int FROM ai_audit_logs) AS audits,
         (SELECT count(*)::int FROM crm_leads) AS leads`,
      );
      assert.equal(counts.rows[0].follow_ups, 1);
      assert.equal(counts.rows[0].messages, 1);
      assert.equal(counts.rows[0].audits, 1);
      assert.equal(counts.rows[0].leads, 1);
      blockClosedRead = true;

      const closingSession = await pool.query(
        "INSERT INTO live_agent_sessions (access_token, source_path) VALUES ('secret-token', '/listings') RETURNING id",
      );
      const closingId = closingSession.rows[0].id;
      const closingRequest = requestLiveAgentHandoff({ ...input, sessionId: closingId });
      await closedReadSeen;
      await pool.query("UPDATE live_agent_sessions SET status='closed' WHERE id=$1", [closingId]);
      releaseClosedRead();
      await assert.rejects(closingRequest, (error) => error?.status === 400);

      const closedState = await pool.query("SELECT status FROM live_agent_sessions WHERE id=$1", [
        closingId,
      ]);
      const finalActivities = await pool.query("SELECT count(*)::int AS count FROM crm_activities");
      assert.equal(closedState.rows[0].status, "closed");
      assert.equal(finalActivities.rows[0].count, 1);

      const victim = await pool.query(
        `INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
       VALUES ('Original', '6999 8888', '69998888', 'original@example.test', 'website', false)
       RETURNING id`,
      );
      const victimSession = await pool.query(
        "INSERT INTO live_agent_sessions (access_token, contact_id) VALUES ('secret-token', $1) RETURNING id",
        [victim.rows[0].id],
      );
      await requestLiveAgentHandoff({
        ...input,
        sessionId: victimSession.rows[0].id,
        name: "Untrusted",
        phone: "6999 8888",
        email: "untrusted@example.test",
        opt_in_whatsapp: true,
      });
      const preserved = await pool.query(
        "SELECT name, phone, email, opt_in_whatsapp FROM crm_contacts WHERE id=$1",
        [victim.rows[0].id],
      );
      assert.deepEqual(preserved.rows[0], {
        name: "Original",
        phone: "6999 8888",
        email: "original@example.test",
        opt_in_whatsapp: false,
      });

      const conflictSession = await pool.query(
        "INSERT INTO live_agent_sessions (access_token) VALUES ('secret-token') RETURNING id",
      );
      await requestLiveAgentHandoff({
        ...input,
        sessionId: conflictSession.rows[0].id,
        name: "Untrusted again",
        phone: "6999 8888",
        email: "another@example.test",
        opt_in_whatsapp: true,
      });
      const conflicted = await pool.query(
        "SELECT name, phone, email, opt_in_whatsapp FROM crm_contacts WHERE id=$1",
        [victim.rows[0].id],
      );
      const boundContact = await pool.query(
        "SELECT contact_id FROM live_agent_sessions WHERE id=$1",
        [conflictSession.rows[0].id],
      );
      assert.deepEqual(conflicted.rows[0], preserved.rows[0]);
      assert.equal(boundContact.rows[0].contact_id, victim.rows[0].id);
      const failedSession = await pool.query(
        "INSERT INTO live_agent_sessions (access_token) VALUES ('secret-token') RETURNING id",
      );
      const beforeFailure = await pool.query(
        `SELECT (SELECT count(*)::int FROM crm_contacts) AS contacts,
              (SELECT count(*)::int FROM crm_leads) AS leads,
              (SELECT count(*)::int FROM crm_activities) AS activities`,
      );
      await pool.query(
        "ALTER TABLE ai_audit_logs ADD CONSTRAINT reject_new_audit CHECK (false) NOT VALID",
      );
      await assert.rejects(
        requestLiveAgentHandoff({
          ...input,
          sessionId: failedSession.rows[0].id,
          phone: "68887777",
        }),
      );
      const afterFailure = await pool.query(
        `SELECT (SELECT count(*)::int FROM crm_contacts) AS contacts,
              (SELECT count(*)::int FROM crm_leads) AS leads,
              (SELECT count(*)::int FROM crm_activities) AS activities`,
      );
      const failedState = await pool.query("SELECT status FROM live_agent_sessions WHERE id=$1", [
        failedSession.rows[0].id,
      ]);
      assert.deepEqual(afterFailure.rows[0], beforeFailure.rows[0]);
      assert.equal(failedState.rows[0].status, "open");
    } finally {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    }
  },
);
