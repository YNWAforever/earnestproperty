import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
const beforeSql = `SELECT wc.id,c.name,c.opted_out_whatsapp,
  COALESCE(json_agg(json_build_object('direction',m.direction,'text',m.text,'created_at',m.created_at) ORDER BY m.created_at DESC) FILTER(WHERE m.id IS NOT NULL),'[]'::json) AS messages
  FROM whatsapp_conversations wc LEFT JOIN crm_contacts c ON c.id=wc.contact_id LEFT JOIN whatsapp_messages m ON m.conversation_id=wc.id
  WHERE wc.id=$1 AND wa_can_read_conversation($2::uuid,wc.id) GROUP BY wc.id,c.name,c.opted_out_whatsapp LIMIT 1`;

test(
  "conversation assist bounds actual SQL payload before aggregate, stabilizes ties and keeps ACL",
  { timeout: 180000 },
  async (t) => {
    await withOwnedPostgres(async ({ query, transaction, migrationCount }) => {
      let captured;
      await mockOwnedServerDb(
        mock,
        async (sql, params = []) => {
          const start = performance.now();
          const rows = await query(sql, params);
          if (sql.includes("AS messages"))
            captured = { sql, params, rows, ms: performance.now() - start };
          return rows;
        },
        transaction,
      );
      const { fetchAdminConversationAiAssist } = await import("./admin-data.server.ts");
      const [staff] = await query(
        "INSERT INTO staff_users(auth_user_id,email) VALUES('synthetic-assist','qa-assist@example.invalid') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent')", [staff.id]);
      const actor = {
        staffId: staff.id,
        authUserId: "synthetic-assist",
        roles: ["agent"],
        email: null,
        name: null,
        bootstrap: false,
      };
      const evidence = {
        environment: "owned-loopback-pg17",
        migrationCount,
        indexes: await query(
          "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='whatsapp_messages'",
        ),
        samples: [],
      };
      let fixture = 0;
      for (const n of [0, 10, 1000, 10000, 100000]) {
        await t.test(n + " messages remain bounded with a stable timestamp tie-break", async () => {
          const [conversation] = await query(
            "INSERT INTO whatsapp_conversations(assigned_agent_id) VALUES($1) RETURNING id",
            [staff.id],
          );
          const prefix = "00000000-0000-4000-800" + fixture++ + "-";
          if (n)
            await query(
              `INSERT INTO whatsapp_messages(id,conversation_id,direction,message_type,text,created_at)
          SELECT ($1||lpad(to_hex(i),12,'0'))::uuid,$2,'inbound','text','M'||lpad(i::text,6,'0')||repeat('好',220),'2026-10-01 00:00:00Z' FROM generate_series(1,$3::int) AS numbers(i)`,
              [prefix, conversation.id, n],
            );
          const params = [conversation.id, staff.id];
          const beforeStart = performance.now();
          const before = await query(beforeSql, params);
          const beforeMs = performance.now() - beforeStart;
          const result = await fetchAdminConversationAiAssist(
            { conversationId: conversation.id },
            actor,
          );
          const after = captured;
          const expected = await query(
            "SELECT text FROM whatsapp_messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10",
            [conversation.id],
          );
          const beforePlan = (
            await query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + beforeSql, params)
          )[0]["QUERY PLAN"];
          const afterPlan = (
            await query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + after.sql, params)
          )[0]["QUERY PLAN"];
          evidence.samples.push({
            n,
            beforeCount: before[0].messages.length,
            afterCount: after.rows[0].messages.length,
            beforeBytes: Buffer.byteLength(JSON.stringify(before[0].messages)),
            afterBytes: Buffer.byteLength(JSON.stringify(after.rows[0].messages)),
            beforeMs,
            afterMs: after.ms,
            beforePlan,
            afterPlan,
          });
          mkdirSync(".audit/remediation-20261003", { recursive: true });
          writeFileSync(
            ".audit/remediation-20261003/ep18-measurements.json",
            JSON.stringify(evidence, null, 2),
          );
          assert.equal(
            after.rows[0].messages.length,
            Math.min(n, 10),
            "The database result itself must be bounded before JS receives it",
          );
          assert.deepEqual(
            after.rows[0].messages.map((m) => m.text),
            expected.map((m) => m.text),
          );
          assert.equal(
            result.summary,
            n ? `最近 ${Math.min(n, 10)} 則 WhatsApp 訊息，客戶需要跟進。` : "未有足夠訊息。",
          );
        });
      }
      await t.test("out-of-scope actor receives no conversation or raw messages", async () => {
        const [conversation] = await query(
          "INSERT INTO whatsapp_conversations DEFAULT VALUES RETURNING id",
        );
        await assert.rejects(
          fetchAdminConversationAiAssist({ conversationId: conversation.id }, actor),
          /Conversation not found/,
        );
        assert.deepEqual(captured.rows, []);
      });
    });
  },
);
