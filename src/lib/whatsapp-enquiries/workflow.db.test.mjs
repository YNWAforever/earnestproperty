import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import { ingestWoztellEvent } from "../woztell/woztell-ingest.server.ts";
import { parseWoztellProviderResult } from "../woztell/provider-result.ts";
import { normalizeWoztellEvent } from "../woztell/woztell.server.ts";
import { enqueueOutboundIntent, finishOutboundIntent } from "../woztell/outbound-intent.server.ts";
import { observeEnquiryEvent } from "./workflow.server.ts";
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

// Synthetic, isolated schema ONLY; never reads DATABASE_URL or production inventory.
const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "Phase 1 integrated capture, replay, rollback and observation (disposable)",
  { skip: !url },
  async (t) => {
    await assertDisposableNeonTestTarget(url);
    const db = neon(url),
      schema = "wa_p1_" + randomUUID().replaceAll("-", "");
    const tx = async (statements) =>
      (
        await db.transaction((q) => [
          q.query("SELECT set_config('search_path',$1,true)", [schema]),
          ...statements.map((s) => q.query(s.statement, s.params ?? [])),
        ])
      ).slice(1);
    const query = async (statement, params = []) => (await tx([{ statement, params }]))[0];
    const migrate = async (file) => {
      const chunks = splitSqlStatements(readFileSync(file, "utf8"));
      await tx(chunks.map((statement) => ({ statement })));
    };
    const now = new Date("2026-09-12T04:00:00Z");
    const event = (id = randomUUID(), extra = {}) =>
      normalizeWoztellEvent({
        type: "TEXT",
        messageId: "synthetic-" + id,
        member: "synthetic-" + id,
        channel: "fixture-channel",
        app: "fixture-app",
        timestamp: now.getTime(),
        data: { text: "Synthetic enquiry" },
        ...extra,
      });
    const available = async () => {
      const [r] = await query(
        "SELECT to_regclass('whatsapp_enquiry_events') IS NOT NULL available",
      );
      return r.available;
    };
    const options = { mode: "observe", schemaAvailable: available, now };
    const count = async (table) => Number((await query(`SELECT count(*) n FROM ${table}`))[0].n);
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      for (const statement of [
        `CREATE TYPE whatsapp_message_direction AS ENUM ('inbound','outbound')`,
        `CREATE TABLE staff_users(id uuid PRIMARY KEY,email text,active boolean DEFAULT true)`,
        `CREATE TABLE crm_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,phone text,normalized_phone text UNIQUE,whatsapp_member_id text UNIQUE,source text,opt_in_whatsapp boolean DEFAULT false,opted_out_whatsapp boolean DEFAULT false,last_inbound_at timestamptz,assigned_agent_id uuid,updated_at timestamptz DEFAULT now())`,
        `CREATE TABLE crm_leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid REFERENCES crm_contacts(id),assigned_agent_id uuid,stage text,intent text,source text,note text,created_at timestamptz,updated_at timestamptz)`,
        `CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid REFERENCES crm_contacts(id),woztell_member_id text,channel_id text,last_message_at timestamptz,last_inbound_at timestamptz,updated_at timestamptz DEFAULT now(),assigned_agent_id uuid,UNIQUE(woztell_member_id,channel_id))`,
        `CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES whatsapp_conversations(id),contact_id uuid REFERENCES crm_contacts(id),direction whatsapp_message_direction,message_type text,text text,external_message_id text UNIQUE,woztell_member_id text,channel_id text,payload jsonb DEFAULT '{}'::jsonb,status text,error text,sent_by uuid,created_at timestamptz DEFAULT now())`,
      ])
        await query(statement);
      // Use real queue, outbox and lead-trigger migrations, not mocks of transaction behaviour.
      await migrate("neon/migrations/20260714180000_backend_control_plane.sql");
      await migrate("neon/migrations/20260905130000_outbound_intents.sql");
      await migrate("neon/migrations/20260906100000_whatsapp_inbound_leads.sql");
      await t.test("AT-14 off works without ledger; observe rejects absent schema", async () => {
        await ingestWoztellEvent(event(), "live_webhook", tx, { mode: "off" });
        const before = await count("crm_contacts");
        await assert.rejects(
          ingestWoztellEvent(event(), "live_webhook", tx, options),
          /WA_ENQUIRY_SCHEMA_REQUIRED/,
        );
        assert.equal(await count("crm_contacts"), before);
      });
      await migrate("neon/migrations/20260912120000_whatsapp_enquiry_events.sql");
      await migrate("neon/migrations/20260912120000_whatsapp_enquiry_events.sql");
      await t.test("AT-10 concurrent live duplicates produce one event/job/lead", async () => {
        const e = event(),
          before = await count("ops_jobs");
        const results = await Promise.all(
          Array.from({ length: 8 }, () => ingestWoztellEvent(e, "live_webhook", tx, options)),
        );
        assert.equal(results.filter((r) => r.messageInserted).length, 1);
        assert.equal(await count("ops_jobs"), before + 1);
        assert.equal(
          (
            await query("SELECT * FROM whatsapp_enquiry_events WHERE external_message_id=$1", [
              e.externalMessageId,
            ])
          ).length,
          1,
        );
        assert.equal(
          (await query("SELECT * FROM crm_leads WHERE contact_id=$1", [results[0].contactId]))
            .length,
          1,
        );
      });
      await t.test(
        "AT-11 history-only creates transcript/legacy lead and no workflow",
        async () => {
          const before = await count("ops_jobs"),
            e = event();
          const r = await ingestWoztellEvent(e, "history_import", tx, options);
          assert.equal(r.messageInserted, true);
          assert.equal(await count("ops_jobs"), before);
          assert.equal(
            (await query("SELECT * FROM crm_leads WHERE contact_id=$1", [r.contactId])).length,
            1,
          );
        },
      );
      await t.test(
        "AT-12 history first, live first and concurrent orders each create one live event",
        async () => {
          for (const order of ["history-first", "live-first", "concurrent"]) {
            const e = event(),
              before = await count("ops_jobs");
            const live = () => ingestWoztellEvent(e, "live_webhook", tx, options),
              history = () => ingestWoztellEvent(e, "history_import", tx, options);
            if (order === "concurrent") await Promise.all([history(), live(), history(), live()]);
            else if (order === "history-first") {
              await history();
              await live();
            } else {
              await live();
              await history();
            }
            assert.equal(await count("ops_jobs"), before + 1);
            assert.equal(
              (
                await query("SELECT * FROM whatsapp_messages WHERE external_message_id=$1", [
                  e.externalMessageId,
                ])
              ).length,
              1,
            );
          }
        },
      );
      await t.test(
        "AT-07 early outbound webhook and later HTTP identity retain one transcript and ledger link",
        async () => {
          const incoming = event();
          const r = await ingestWoztellEvent(incoming, "history_import", tx, options);
          const staff = randomUUID(),
            intentId = randomUUID();
          await query("INSERT INTO staff_users(id,email) VALUES($1,$2)", [
            staff,
            "fixture@example.invalid",
          ]);
          await enqueueOutboundIntent(
            {
              requestId: intentId,
              conversationId: r.conversationId,
              kind: "text",
              payload: { text: "Synthetic reply" },
            },
            staff,
            null,
            query,
          );
          await query("UPDATE whatsapp_outbound_intents SET state='dispatching' WHERE id=$1", [
            intentId,
          ]);
          const callback = normalizeWoztellEvent({
            type: "MANUAL",
            app: "fixture-app",
            channel: incoming.channelId,
            member: incoming.woztellMemberId,
            messageEvent: {
              type: "TEXT",
              messageId: "reply-" + intentId,
              timestamp: now.getTime(),
              data: { text: "Synthetic reply" },
            },
          });
          await ingestWoztellEvent(callback, "live_webhook", tx, options);
          await finishOutboundIntent(
            intentId,
            {
              state: "accepted",
              externalMessageId: callback.externalMessageId,
              error: null,
              providerResult: parseWoztellProviderResult({
                ok: 1,
                sendResult: {
                  result: [{ messageEvent: { messageId: callback.externalMessageId } }],
                },
              }),
            },
            tx,
          );
          const messages = await query(
            "SELECT id FROM whatsapp_messages WHERE conversation_id=$1 AND direction='outbound'",
            [r.conversationId],
          );
          assert.equal(messages.length, 1);
          const [ledger] = await query(
            "SELECT message_id FROM whatsapp_enquiry_events WHERE external_message_id=$1",
            [callback.externalMessageId],
          );
          assert.equal(ledger.message_id, messages[0].id);
          const [stored] = await query("SELECT payload FROM whatsapp_messages WHERE id=$1", [
            messages[0].id,
          ]);
          assert.equal(stored.payload.providerResult.responseCount, 1);
          assert.equal(stored.payload.providerResult.outcome, "identifiable_acceptance");
          assert.equal(stored.payload.messageEvent.data.text, "Synthetic reply");
          assert.equal(
            (
              await query("SELECT message_id FROM whatsapp_outbound_intents WHERE id=$1", [
                intentId,
              ])
            )[0].message_id,
            messages[0].id,
          );
        },
      );
      await t.test(
        "AT-13 failure after event insert rolls transcript/contact/lead/event/job back",
        async () => {
          const tables = [
            "crm_contacts",
            "crm_leads",
            "whatsapp_messages",
            "whatsapp_enquiry_events",
            "ops_jobs",
          ];
          const before = await Promise.all(tables.map(count));
          const failing = (statements) => {
            const index = statements.findIndex((s) => s.statement.includes("INSERT INTO ops_jobs"));
            const copy = [...statements];
            copy.splice(index, 0, { statement: "SELECT 1/0" });
            return tx(copy);
          };
          await assert.rejects(
            ingestWoztellEvent(event(), "live_webhook", failing, options),
            /division by zero/,
          );
          assert.deepEqual(await Promise.all(tables.map(count)), before);
        },
      );
      await t.test("Synthetic legacy identity remains linked and marked ambiguous", async () => {
        const e = event(undefined, { messageId: undefined });
        await ingestWoztellEvent(e, "history_import", tx, options);
        await query(
          "UPDATE whatsapp_messages SET external_message_id=$2 WHERE external_message_id=$1",
          [e.externalMessageId, e.legacyExternalMessageId],
        );
        await ingestWoztellEvent(e, "live_webhook", tx, options);
        const [r] = await query(
          "SELECT * FROM whatsapp_enquiry_events WHERE external_message_id=$1",
          [e.externalMessageId],
        );
        assert.equal(r.identity_quality, "synthetic_ambiguous");
        assert.ok(r.message_id);
        assert.equal(r.effects_eligible, false);
      });
      await t.test(
        "Observation retry is idempotent and disabling suppresses pending work",
        async () => {
          const prior = process.env.EP_WA_ENQUIRY_MODE;
          try {
            process.env.EP_WA_ENQUIRY_MODE = "observe";
            const [e] = await query("SELECT id FROM whatsapp_enquiry_events ORDER BY id LIMIT 1");
            assert.equal(
              (await observeEnquiryEvent(e.id, async () => {}, query)).summary.observed,
              1,
            );
            assert.equal(
              (await observeEnquiryEvent(e.id, async () => {}, query)).summary.observed,
              0,
            );
            assert.equal(
              (
                await query("SELECT effects_eligible FROM whatsapp_enquiry_events WHERE id=$1", [
                  e.id,
                ])
              )[0].effects_eligible,
              false,
            );
            const [pending] = await query(
              "SELECT id FROM whatsapp_enquiry_events WHERE processing_state='pending' LIMIT 1",
            );
            process.env.EP_WA_ENQUIRY_MODE = "off";
            assert.equal(
              (await observeEnquiryEvent(pending.id, async () => {}, query)).summary.suppressed,
              1,
            );
            await assert.rejects(
              query("UPDATE whatsapp_enquiry_events SET effects_eligible=true WHERE id=$1", [e.id]),
              /check constraint/,
            );
          } finally {
            if (prior === undefined) delete process.env.EP_WA_ENQUIRY_MODE;
            else process.env.EP_WA_ENQUIRY_MODE = prior;
          }
        },
      );
    } finally {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  },
);
