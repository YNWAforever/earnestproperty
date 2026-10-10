import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import {
  requestConversationAssignment,
  executeAssignment,
  reconcileAssignment,
  readAssignmentContext,
  observeQualifiedHumanResponse,
} from "./assignment.server.ts";
function splitSqlStatements(query) {
  const statements = [];
  let current = "",
    single = false,
    double = false,
    dollar = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index],
      next = query[index + 1];
    if (!single && !double && !dollar && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (!double && !dollar && char === "'" && query[index - 1] !== "\\") single = !single;
    if (!single && !dollar && char === '"') double = !double;
    if (!single && !double && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        dollar = dollar ? (dollar === tag ? null : dollar) : tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (!single && !double && !dollar && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const url = process.env.ASTRA_TEST_DATABASE_URL;
test("Phase3 isolated synthetic assignment and response evidence", { skip: !url }, async (t) => {
  await assertDisposableNeonTestTarget(url);
  const db = neon(url),
    schema = "wa_p3_" + randomUUID().replaceAll("-", "");
  const tx = async (statements) =>
    (
      await db.transaction((q) => [
        q.query("SELECT set_config('search_path',$1,true)", [schema]),
        ...statements.map((s) => q.query(s.statement, s.params ?? [])),
      ])
    ).slice(1);
  const query = async (statement, params = []) => (await tx([{ statement, params }]))[0];
  const ports = { query, transaction: tx },
    admin = randomUUID(),
    a = randomUUID(),
    b = randomUUID(),
    c = randomUUID(),
    conv = randomUUID();
  const actor = { staffId: admin, roles: ["admin"] };
  const migration = readFileSync(
    "neon/migrations/20260912140000_whatsapp_assignment_evidence.sql",
    "utf8",
  );
  const migrate = () => tx(splitSqlStatements(migration).map((statement) => ({ statement })));
  const request = async (staffId, conversationId = conv) =>
    (
      await requestConversationAssignment(
        { conversationId, staffId, reason: "manual" },
        actor,
        ports,
      )
    ).assignment.pending_assignment_id;
  let calls = 0;
  const provider = {
    execute: async () => {
      calls++;
      return { accepted: true };
    },
    readAuthoritativeAssignment: async () => ({ inboxUserId: "user-a", folderId: "folder" }),
  };
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const statement of [
      `CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean DEFAULT true,name_zh text,name_en text)`,
      `CREATE TYPE staff_role AS ENUM ('admin','manager','agent','viewer')`,
      `CREATE TABLE staff_roles(staff_user_id uuid,role staff_role)`,
      `CREATE TABLE properties(id uuid PRIMARY KEY,agent_id uuid,deal_type text)`,
      `CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,assigned_agent_id uuid,channel_id text DEFAULT 'fixture',woztell_member_id text DEFAULT 'synthetic',updated_at timestamptz DEFAULT now())`,
      `CREATE TABLE inquiries(id uuid PRIMARY KEY,conversation_id uuid,property_id uuid,created_at timestamptz DEFAULT now(),source text DEFAULT 'whatsapp',status text DEFAULT 'new',customer_message_at timestamptz DEFAULT '2026-09-12T00:00:00Z',webhook_received_at timestamptz DEFAULT '2026-09-12T00:00:00Z',first_human_response_at timestamptz,first_human_response_message_id uuid,first_human_response_staff_id uuid,public_listing_no text,placement_source text,requested_staff_id uuid,response_due_at timestamptz,association_review boolean DEFAULT false)`,
      `CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid,direction text,external_message_id text,sent_by uuid,channel_id text DEFAULT 'fixture',woztell_member_id text DEFAULT 'synthetic')`,
      `CREATE TABLE whatsapp_enquiry_events(id uuid PRIMARY KEY,message_id uuid,origin text,kind text,identity_quality text,timing text,evidence jsonb,external_message_id text,channel_id text,member_id text,occurred_at timestamptz,received_at timestamptz)`,
      `CREATE TABLE whatsapp_outbound_intents(id uuid PRIMARY KEY,conversation_id uuid,payload jsonb DEFAULT '{}',message_id uuid,actor_staff_id uuid,state text DEFAULT 'dispatching',external_message_id text,dispatch_started_at timestamptz)`,
    ])
      await query(statement);
    await migrate();
    await migrate();
    await query("INSERT INTO staff_users(id) VALUES($1),($2),($3),($4)", [admin, a, b, c]);
    await query(
      "INSERT INTO staff_roles VALUES($1,'admin'),($2,'agent'),($3,'agent'),($4,'agent')",
      [admin, c, a, b],
    );
    await query("INSERT INTO whatsapp_conversations(id) VALUES($1)", [conv]);
    await query(
      "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at,verified_by) VALUES($1,'fixture','user-a','folder','node',true,'synthetic',now(),$3),($2,'fixture','user-b','folder','node',true,'synthetic',now(),$3)",
      [a, b, admin],
    );
    await t.test("AT30 manager lock returns visible protected exception in context", async () => {
      await request(c);
      const context = await readAssignmentContext(conv, actor, ports);
      // FX-17a G-11: the lock and the proposal reason are admin-only diagnostics.
      assert.equal(context.diagnostics.assignmentLock, true);
      assert.equal(context.diagnostics.proposedStaffId, null);
      assert.equal(context.diagnostics.proposalReason, "protected_owner_unavailable");
      assert.equal(typeof context.assignment_version, "number");
    });
    await t.test("AT28 unmapped staff cannot execute or become confirmed", async () => {
      const id = await request(c);
      assert.equal((await executeAssignment(id, provider, ports)).state, "blocked");
      assert.equal(calls, 0);
      assert.equal(
        (await query("SELECT confirmed_staff_id FROM whatsapp_conversations"))[0]
          .confirmed_staff_id,
        null,
      );
    });
    await t.test("Mapped active staff without an authorized role cannot dispatch", async () => {
      await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [a]);
      const id = await request(a);
      assert.equal((await executeAssignment(id, provider, ports)).state, "blocked");
      assert.equal(calls, 0);
      await query("INSERT INTO staff_roles VALUES($1,'agent')", [a]);
    });
    let first;
    await t.test(
      "AT29/31 concurrent claims singleflight; HTTP acceptance remains unknown",
      async () => {
        first = await request(a);
        const results = await Promise.all(
          Array.from({ length: 5 }, () => executeAssignment(first, provider, ports)),
        );
        assert.equal(calls, 1);
        assert.equal(results.filter((x) => x.state === "unknown").length, 1);
        assert.equal(
          (await query("SELECT assigned_agent_id FROM whatsapp_conversations"))[0]
            .assigned_agent_id,
          null,
        );
      },
    );
    await t.test(
      "AT32 stale readback cannot confirm or release unresolved older operation",
      async () => {
        const second = await request(b);
        assert.equal((await reconcileAssignment(first, provider, ports)).confirmed, false);
        assert.equal(
          (await query("SELECT state FROM whatsapp_assignment_requests WHERE id=$1", [first]))[0]
            .state,
          "unknown",
        );
        assert.equal((await executeAssignment(second, provider, ports)).state, "blocked");
        assert.equal(calls, 1);
      },
    );
    await t.test("AT32 mapping changed while readback awaits cannot falsely confirm", async () => {
      const v = randomUUID();
      await query("INSERT INTO whatsapp_conversations(id) VALUES($1)", [v]);
      const id = await request(a, v);
      await executeAssignment(id, provider, ports);
      const race = {
        ...provider,
        readAuthoritativeAssignment: async () => {
          await query(
            "UPDATE whatsapp_staff_channels SET inbox_user_id='changed' WHERE staff_id=$1",
            [a],
          );
          return { inboxUserId: "user-a", folderId: "folder" };
        },
      };
      assert.equal((await reconcileAssignment(id, race, ports)).confirmed, false);
      await query("UPDATE whatsapp_staff_channels SET inbox_user_id='user-a' WHERE staff_id=$1", [
        a,
      ]);
      assert.equal((await reconcileAssignment(id, provider, ports)).confirmed, true);
      const [row] = await query(
        "SELECT assigned_agent_id,confirmed_staff_id,assignment_lock FROM whatsapp_conversations WHERE id=$1",
        [v],
      );
      assert.equal(row.assigned_agent_id, a);
      assert.equal(row.confirmed_staff_id, a);
      assert.equal(row.assignment_lock, true);
    });
    await t.test(
      "AT37 forged role and cross-record agent denied; staff exit retires mapping and pending requests",
      async () => {
        await assert.rejects(
          requestConversationAssignment(
            { conversationId: conv, staffId: b, reason: "manual" },
            { staffId: c, roles: ["admin"] },
            ports,
          ),
        );
        await assert.rejects(readAssignmentContext(conv, { staffId: c, roles: ["agent"] }, ports));
        await query("UPDATE staff_users SET active=false WHERE id=$1", [b]);
        const [mapping] = await query(
          "SELECT eligible,retired_at FROM whatsapp_staff_channels WHERE staff_id=$1",
          [b],
        );
        assert.equal(mapping.eligible, false);
        assert.ok(mapping.retired_at);
        assert.equal(
          (
            await query(
              "SELECT count(*)::int AS n FROM whatsapp_assignment_requests WHERE desired_staff_id=$1 AND state='pending'",
              [b],
            )
          )[0].n,
          0,
        );
      },
    );
    const inquiry = randomUUID(),
      secondInquiry = randomUUID(),
      message = randomUUID(),
      intent = randomUUID();
    await query("INSERT INTO inquiries(id,conversation_id) VALUES($1,$2)", [inquiry, conv]);
    await query(
      "INSERT INTO whatsapp_messages(id,conversation_id,direction,external_message_id,sent_by) VALUES($1,$2,'outbound',NULL,$3)",
      [message, conv, a],
    );
    await query(
      "INSERT INTO whatsapp_outbound_intents(id,conversation_id,message_id,actor_staff_id,dispatch_started_at) VALUES($1,$2,$3,$4,'2026-09-12T00:03:00Z')",
      [intent, conv, message, a],
    );
    await t.test(
      "AT34 deferred accepted-intent credit requires matching transcript provider ID and send time",
      async () => {
        await tx([
          {
            statement:
              "UPDATE whatsapp_outbound_intents SET state='accepted',external_message_id='synthetic-provider' WHERE id=$1",
            params: [intent],
          },
          {
            statement:
              "UPDATE whatsapp_messages SET external_message_id='synthetic-provider' WHERE id=$1",
            params: [message],
          },
        ]);
        const [row] = await query("SELECT * FROM inquiries WHERE id=$1", [inquiry]);
        assert.equal(
          new Date(row.first_human_response_at).toISOString(),
          "2026-09-12T00:03:00.000Z",
        );
        assert.equal(row.first_human_response_staff_id, a);
        assert.equal(
          (
            await query(
              "SELECT wa_credit_human_response($1,$2,$3,'2026-09-12T00:01:00Z','synthetic-provider','authenticated_intent') AS ok",
              [inquiry, message, a],
            )
          )[0].ok,
          false,
        );
        assert.equal(
          (
            await query(
              "SELECT wa_credit_human_response($1,$2,$3,'2026-09-12T00:03:00Z','wrong-provider','authenticated_intent') AS ok",
              [inquiry, message, a],
            )
          )[0].ok,
          false,
        );
        assert.equal(
          (await query("SELECT count(*)::int AS n FROM whatsapp_human_response_evidence"))[0].n,
          1,
        );
      },
    );
    await t.test("AT35 ambiguous replies require explicit open episode selection", async () => {
      await query("INSERT INTO inquiries(id,conversation_id) VALUES($1,$2)", [secondInquiry, conv]);
      await assert.rejects(
        query("INSERT INTO whatsapp_outbound_intents(id,conversation_id) VALUES($1,$2)", [
          randomUUID(),
          conv,
        ]),
        /ENQUIRY_SELECTION_REQUIRED/,
      );
      await query(
        "INSERT INTO whatsapp_outbound_intents(id,conversation_id,payload) VALUES($1,$2,$3)",
        [randomUUID(), conv, JSON.stringify({ enquiryId: secondInquiry })],
      );
      await query("UPDATE inquiries SET status='closed' WHERE id=$1", [secondInquiry]);
      await assert.rejects(
        query(
          "INSERT INTO whatsapp_outbound_intents(id,conversation_id,payload) VALUES($1,$2,$3)",
          [randomUUID(), conv, JSON.stringify({ enquiryId: secondInquiry })],
        ),
        /ENQUIRY_ASSOCIATION_INVALID/,
      );
    });
    await t.test(
      "AT34 verified Inbox persisted metadata requires separate capability; replay is idempotent",
      async () => {
        const v = randomUUID(),
          i = randomUUID(),
          m = randomUUID(),
          e = randomUUID();
        await query("INSERT INTO whatsapp_conversations(id) VALUES($1)", [v]);
        await query("INSERT INTO inquiries(id,conversation_id) VALUES($1,$2)", [i, v]);
        await query(
          "INSERT INTO whatsapp_messages(id,conversation_id,direction,external_message_id) VALUES($1,$2,'outbound','inbox-synthetic')",
          [m, v],
        );
        await query(
          "UPDATE whatsapp_staff_channels SET verified_at='2026-09-11T00:00:00Z' WHERE staff_id=$1",
          [a],
        );
        await query(
          "INSERT INTO whatsapp_enquiry_events VALUES($1,$2,'live_webhook','unverified_outbound','provider_id','fresh',$3,'inbox-synthetic','fixture','synthetic','2026-09-12T00:05:00Z','2026-09-12T00:05:01Z')",
          [e, m, JSON.stringify({ integrationId: "inbox", agentUserId: "user-a" })],
        );
        assert.equal(await observeQualifiedHumanResponse(e, query), false);
        await query(
          "INSERT INTO whatsapp_inbox_evidence_capabilities VALUES('fixture','synthetic-test-only','2026-09-11T00:00:00Z')",
        );
        assert.equal(await observeQualifiedHumanResponse(e, query), true);
        assert.equal(await observeQualifiedHumanResponse(e, query), true);
        assert.equal(
          (
            await query(
              "SELECT count(*)::int AS n FROM whatsapp_human_response_evidence WHERE inquiry_id=$1",
              [i],
            )
          )[0].n,
          1,
        );
        assert.equal(
          new Date(
            (await query("SELECT first_human_response_at FROM inquiries WHERE id=$1", [i]))[0]
              .first_human_response_at,
          ).toISOString(),
          "2026-09-12T00:05:00.000Z",
        );
        const otherEpisode = randomUUID();
        await query("UPDATE inquiries SET status='closed' WHERE id=$1", [i]);
        await query("INSERT INTO inquiries(id,conversation_id) VALUES($1,$2)", [otherEpisode, v]);
        assert.equal(await observeQualifiedHumanResponse(e, query), false);
        assert.equal(
          (
            await query("SELECT first_human_response_at FROM inquiries WHERE id=$1", [otherEpisode])
          )[0].first_human_response_at,
          null,
        );
        await query("UPDATE whatsapp_enquiry_events SET origin='history_import' WHERE id=$1", [e]);
        assert.equal(await observeQualifiedHumanResponse(e, query), false);
      },
    );
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
