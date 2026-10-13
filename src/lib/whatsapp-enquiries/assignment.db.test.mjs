import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { onDbTarget } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import {
  applyMigrations,
  isolatedDatabase,
  migrationsAfter,
  migrationsBefore,
} from "../../../scripts/acceptance/migrated-schema.mjs";
import {
  requestConversationAssignment,
  executeAssignment,
  reconcileAssignment,
  readAssignmentContext,
  observeQualifiedHumanResponse,
} from "./assignment.server.ts";
// The on-demand Neon run keeps its ASTRA_TEST_DATABASE_URL contract.
const neonRun = { urlVar: "ASTRA_TEST_DATABASE_URL" };
const ASSIGNMENT = "20260912140000_whatsapp_assignment_evidence.sql";
// Owned Docker Postgres by default (a fresh database in the container); ASTRA_TEST_DATABASE_URL
// (behind the disposable guard) for an explicit Neon run. In CI a missing database fails instead
// of skipping. The isolated schema is built from the real migrations, in order.
test(
  "Phase3 isolated synthetic assignment and response evidence",
  onDbTarget(async (target, t) => {
    const { sql: db, end } = await isolatedDatabase(target),
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
    const migrate = () => applyMigrations(db, schema, [ASSIGNMENT]);
    // Real-schema rows. Conversations are on the fixture channel; each has its own member.
    const addConversation = (id, member = "synthetic-" + id) =>
      query(
        "INSERT INTO whatsapp_conversations(id,channel_id,woztell_member_id) VALUES($1,'fixture',$2)",
        [id, member],
      );
    const addInquiry = (id, conversationId) =>
      query(
        "INSERT INTO inquiries(id,conversation_id,source,customer_message_at,webhook_received_at) VALUES($1,$2,'whatsapp','2026-09-12T00:00:00Z','2026-09-12T00:00:00Z')",
        [id, conversationId],
      );
    const staffIntent = (id, conversationId, payload = {}) =>
      query(
        "INSERT INTO whatsapp_outbound_intents(id,conversation_id,actor_staff_id,kind,payload,payload_hash,message_id) VALUES($1,$2,$3,'text',$4,$5,$6)",
        [
          id,
          conversationId,
          admin,
          JSON.stringify(payload),
          createHash("sha256").update(id).digest("hex"),
          randomUUID(),
        ],
      );
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
      await applyMigrations(db, schema, migrationsBefore(ASSIGNMENT));
      await migrate();
      await migrate();
      await applyMigrations(db, schema, migrationsAfter(ASSIGNMENT));
      await query("INSERT INTO staff_users(id) VALUES($1),($2),($3),($4)", [admin, a, b, c]);
      await query(
        "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin'),($2,'agent'),($3,'agent'),($4,'agent')",
        [admin, c, a, b],
      );
      await addConversation(conv);
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
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent')", [a]);
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
      await t.test(
        "AT32 mapping changed while readback awaits cannot falsely confirm",
        async () => {
          const v = randomUUID();
          await addConversation(v);
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
          await query(
            "UPDATE whatsapp_staff_channels SET inbox_user_id='user-a' WHERE staff_id=$1",
            [a],
          );
          assert.equal((await reconcileAssignment(id, provider, ports)).confirmed, true);
          const [row] = await query(
            "SELECT assigned_agent_id,confirmed_staff_id,assignment_lock FROM whatsapp_conversations WHERE id=$1",
            [v],
          );
          assert.equal(row.assigned_agent_id, a);
          assert.equal(row.confirmed_staff_id, a);
          assert.equal(row.assignment_lock, true);
        },
      );
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
          await assert.rejects(
            readAssignmentContext(conv, { staffId: c, roles: ["agent"] }, ports),
          );
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
      await addInquiry(inquiry, conv);
      // A staff send must be by someone who may read the conversation (wa_can_read_conversation,
      // 4ff9fa59 and 846b0e5d; enforced on insert by wa_guard_outbound_reservation). Staff a is
      // an unassigned agent here, so a also takes the manager role for the reply below.
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [a]);
      await query(
        "INSERT INTO whatsapp_messages(id,conversation_id,direction,message_type,external_message_id,sent_by,channel_id,woztell_member_id) VALUES($1,$2,'outbound','text',NULL,$3,'fixture',$4)",
        [message, conv, a, "synthetic-" + conv],
      );
      await query(
        "INSERT INTO whatsapp_outbound_intents(id,conversation_id,message_id,actor_staff_id,kind,payload,payload_hash,state,dispatch_started_at) VALUES($1,$2,$3,$4,'text','{}',$5,'dispatching','2026-09-12T00:03:00Z')",
        [intent, conv, message, a, createHash("sha256").update(intent).digest("hex")],
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
          // 5954c446 (feat: connect no-link enquiries to verified follow-up workflow): provider
          // acceptance no longer proves a human reply (wa_credit_accepted_intent became a no-op).
          // The credit is deferred until the transcript row is delivered/read with the same
          // provider ID (wa_credit_delivered_intent), still at the intent's send time.
          assert.equal(
            (await query("SELECT first_human_response_at FROM inquiries WHERE id=$1", [inquiry]))[0]
              .first_human_response_at,
            null,
          );
          await query("UPDATE whatsapp_messages SET status='delivered' WHERE id=$1", [message]);
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
        await addInquiry(secondInquiry, conv);
        await assert.rejects(staffIntent(randomUUID(), conv), /ENQUIRY_SELECTION_REQUIRED/);
        await staffIntent(randomUUID(), conv, { enquiryId: secondInquiry });
        await query("UPDATE inquiries SET status='closed' WHERE id=$1", [secondInquiry]);
        await assert.rejects(
          staffIntent(randomUUID(), conv, { enquiryId: secondInquiry }),
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
          await addConversation(v, "synthetic");
          await addInquiry(i, v);
          await query(
            "INSERT INTO whatsapp_messages(id,conversation_id,direction,message_type,external_message_id,channel_id,woztell_member_id) VALUES($1,$2,'outbound','text','inbox-synthetic','fixture','synthetic')",
            [m, v],
          );
          await query(
            "UPDATE whatsapp_staff_channels SET verified_at='2026-09-11T00:00:00Z' WHERE staff_id=$1",
            [a],
          );
          await query(
            "INSERT INTO whatsapp_enquiry_events(id,message_id,origin,kind,identity_quality,timing,evidence,external_message_id,channel_id,member_id,occurred_at,received_at,dedupe_key,app_id) VALUES($1,$2,'live_webhook','unverified_outbound','provider_id','fresh',$3,'inbox-synthetic','fixture','synthetic','2026-09-12T00:05:00Z','2026-09-12T00:05:01Z',$4,'fixture-app')",
            [
              e,
              m,
              JSON.stringify({ integrationId: "inbox", agentUserId: "user-a" }),
              createHash("sha256").update(e).digest("hex"),
            ],
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
          await addInquiry(otherEpisode, v);
          assert.equal(await observeQualifiedHumanResponse(e, query), false);
          assert.equal(
            (
              await query("SELECT first_human_response_at FROM inquiries WHERE id=$1", [
                otherEpisode,
              ])
            )[0].first_human_response_at,
            null,
          );
          // A captured event cannot be relabelled as history import: the ledger admits only
          // live_webhook events and the capture is immutable (b6d049e9, wa_capture_immutable).
          await assert.rejects(
            query("UPDATE whatsapp_enquiry_events SET origin='history_import' WHERE id=$1", [e]),
            /WA_CAPTURE_IMMUTABLE/,
          );
          // History-import evidence can never enter the ledger in the first place, so it can never
          // be credited: the origin CHECK rejects it (20260912120000).
          const history = randomUUID();
          await assert.rejects(
            query(
              "INSERT INTO whatsapp_enquiry_events(id,message_id,origin,kind,identity_quality,timing,evidence,external_message_id,channel_id,member_id,occurred_at,received_at,dedupe_key,app_id) VALUES($1,$2,'history_import','unverified_outbound','provider_id','fresh',$3,'inbox-synthetic-history','fixture','synthetic','2026-09-12T00:06:00Z','2026-09-12T00:06:01Z',$4,'fixture-app')",
              [
                history,
                m,
                JSON.stringify({ integrationId: "inbox", agentUserId: "user-a" }),
                createHash("sha256").update(history).digest("hex"),
              ],
            ),
            /whatsapp_enquiry_events_origin_check/,
          );
        },
      );
    } finally {
      try {
        await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await end();
      }
    }
  }, neonRun),
);
