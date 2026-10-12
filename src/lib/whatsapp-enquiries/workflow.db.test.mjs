import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { onDbTarget } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import {
  applyMigrations,
  isolatedDatabase,
  migrationsAfter,
  migrationsBefore,
} from "../../../scripts/acceptance/migrated-schema.mjs";
import { ingestWoztellEvent } from "../woztell/woztell-ingest.server.ts";
import { parseWoztellProviderResult } from "../woztell/provider-result.ts";
import { normalizeWoztellEvent } from "../woztell/woztell.server.ts";
import { enqueueOutboundIntent, finishOutboundIntent } from "../woztell/outbound-intent.server.ts";
import { observeEnquiryEvent } from "./workflow.server.ts";
// Synthetic, isolated schema ONLY; never reads DATABASE_URL or production inventory.
// Owned Docker Postgres by default (a fresh database in the container); ASTRA_TEST_DATABASE_URL
// (behind the disposable guard) keeps the explicit Neon run. In CI a missing database fails
// instead of skipping. The schema is built from the real migrations, in order.
const neonRun = { urlVar: "ASTRA_TEST_DATABASE_URL" };
const ENQUIRY_EVENTS = "20260912120000_whatsapp_enquiry_events.sql";
// Contact migrations every ingest reads in any enquiry mode (opt-out evidence, profile name,
// FX-12 identity review). They are additive, re-runnable and independent of the enquiry
// ledger, so the "before the ledger" state includes them; migrationsAfter re-applies them.
const CONTACT_MIGRATIONS = [
  "20261008100000_whatsapp_opt_out_evidence.sql",
  "20261009100000_contact_profile_name.sql",
  "20261013100000_contact_identity_review.sql",
];
test(
  "Phase 1 integrated capture, replay, rollback and observation (disposable)",
  onDbTarget(async (target, t) => {
    const { sql: db, end } = await isolatedDatabase(target),
      schema = "wa_p1_" + randomUUID().replaceAll("-", "");
    const tx = async (statements) =>
      (
        await db.transaction((q) => [
          q.query("SELECT set_config('search_path',$1,true)", [schema]),
          ...statements.map((s) => q.query(s.statement, s.params ?? [])),
        ])
      ).slice(1);
    const query = async (statement, params = []) => (await tx([{ statement, params }]))[0];
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
      // Production's schema just before the enquiry ledger (queue, outbox, inbound-lead trigger).
      await applyMigrations(db, schema, migrationsBefore(ENQUIRY_EVENTS));
      await applyMigrations(db, schema, CONTACT_MIGRATIONS);
      await t.test("AT-14 off works without ledger; observe rejects absent schema", async () => {
        await ingestWoztellEvent(event(), "live_webhook", tx, { mode: "off" });
        const before = await count("crm_contacts");
        await assert.rejects(
          ingestWoztellEvent(event(), "live_webhook", tx, options),
          /WA_ENQUIRY_SCHEMA_REQUIRED/,
        );
        assert.equal(await count("crm_contacts"), before);
      });
      await applyMigrations(db, schema, [ENQUIRY_EVENTS]);
      await applyMigrations(db, schema, [ENQUIRY_EVENTS]);
      await applyMigrations(db, schema, migrationsAfter(ENQUIRY_EVENTS));
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
          // Staff replies require read access to the conversation (wa_can_read_conversation,
          // 4ff9fa59 and 846b0e5d); a manager may act on every conversation.
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [staff]);
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
              // b6d049e9 replaced the column CHECK with the wa_capture_immutable trigger, which
              // rejects any change to a captured event's eligibility before constraints run.
              /WA_CAPTURE_IMMUTABLE/,
            );
          } finally {
            if (prior === undefined) delete process.env.EP_WA_ENQUIRY_MODE;
            else process.env.EP_WA_ENQUIRY_MODE = prior;
          }
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
