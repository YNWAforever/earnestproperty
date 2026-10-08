// FX-12 Task 3 / C-04: a WhatsApp message whose member id and phone point at
// different contacts is stored in a 「身分待核對」 review conversation instead of
// failing ingest. One owned full-schema container for the whole file, real
// migrations. Synthetic data only (member ids synthetic-fx12-*, phones from the
// HK fictional range 5555 0xxx). Nothing talks to WozTell: fetch throws, the ops
// wake is disabled, and the only send is a fake that counts its calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import {
  mockOwnedServerDb,
  repoRoot,
  withOwnedPostgres,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";

const MIGRATION = "20261013100000_contact_identity_review.sql";
const REVIEW_TABLE = "crm_contact_identity_reviews";
const CHANNEL = "synthetic-fx12-channel";
const APP = "synthetic-fx12-app";
const id = (n) => `7c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
const MANAGER = id(2);
const AGENT = id(3);

// Today's contact pick, verbatim from main bfbfd618 (woztell-ingest.server.ts:175-186),
// before FX-12 touched it. Review Focus 1: ingest must still pick this contact.
const LEGACY_MATCH = `SELECT id FROM (
      SELECT * FROM crm_contacts WHERE normalized_phone=$1
        OR (length($1::text)=11 AND left($1::text,3)='852'
          AND normalized_phone=right($1::text,8)) OR whatsapp_member_id=$2
    ) matched
      WHERE (normalized_phone IS NULL OR $1::text IS NULL OR normalized_phone=$1
        OR (length($1::text)=11 AND left($1::text,3)='852'
          AND normalized_phone=right($1::text,8)))
        AND (whatsapp_member_id IS NULL OR $2::text IS NULL OR whatsapp_member_id=$2)
      ORDER BY (whatsapp_member_id=$2) DESC NULLS LAST,
        (normalized_phone=$1) DESC NULLS LAST, id
      LIMIT 1`;

test("FX-12 WhatsApp ingest identity review (owned Postgres)", { timeout: 300000 }, async (t) => {
  const previousWake = process.env.OPS_WAKE_URL;
  const previousEventWake = process.env.OPS_EVENT_WAKE_ENABLED;
  process.env.OPS_WAKE_URL = "";
  delete process.env.OPS_EVENT_WAKE_ENABLED;
  const network = mock.method(globalThis, "fetch", () => {
    throw new Error("FX-12 owned ingest test: network is disabled");
  });
  try {
    await withOwnedPostgres(async ({ pool, query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const { ingestWoztellEvent } = await import("./woztell-ingest.server.ts");
      const { normalizeWoztellEvent } = await import("./woztell.server.ts");
      const { enqueueOutboundIntent, deliverOutboundIntent } =
        await import("./outbound-intent.server.ts");
      const { storeInboundReceipt, markInboundReceipt, retryInboundReceipt } =
        await import("../whatsapp-enquiries/inbound-receipts.server.ts");

      for (const [staffId, role] of [
        [ADMIN, "admin"],
        [MANAGER, "manager"],
        [AGENT, "agent"],
      ]) {
        await query(
          "INSERT INTO staff_users(id,auth_user_id,email,name_zh,active) VALUES($1,$2,$3,$4,true)",
          [
            staffId,
            "synthetic-fx12-ingest-" + staffId,
            "fx12-ingest-" + staffId.slice(-2) + "@example.invalid",
            "測試同事" + staffId.slice(-1),
          ],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staffId, role]);
      }

      let clock = Math.floor(Date.now() / 1000) - 3600;
      const event = ({ messageId, member, phone, text, at }) =>
        normalizeWoztellEvent({
          memberId: member,
          channelId: CHANNEL,
          appId: APP,
          messageEvent: {
            messageId,
            from: phone,
            to: "85230000000",
            type: "TEXT",
            timestamp: at ?? ++clock,
            data: { text },
          },
        });
      const ingest = (e, origin = "live_webhook") =>
        ingestWoztellEvent(e, origin, undefined, {
          mode: "observe",
          signedEvent: true,
          schemaAvailable: async () => true,
          wake: () => {},
        });
      const seedContact = (contactId, { phone = null, member = null, name = "合成客戶" } = {}) =>
        query(
          `INSERT INTO crm_contacts(id,name,phone,normalized_phone,whatsapp_member_id,source,last_inbound_at)
           VALUES($1,$2,$3,$3,$4,'whatsapp','2026-09-01T00:00:00Z')`,
          [contactId, name, phone, member],
        );
      const rowHash = async (contactId) =>
        (await query("SELECT md5(c::text) AS h FROM crm_contacts c WHERE id=$1", [contactId]))[0]
          ?.h;
      const count = async (table, where = "true", params = []) =>
        (await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params))[0].n;
      const totals = async () => ({
        contacts: await count("crm_contacts"),
        conversations: await count("whatsapp_conversations"),
        messages: await count("whatsapp_messages"),
        leads: await count("crm_leads"),
        enquiryEvents: await count("whatsapp_enquiry_events"),
        jobs: await count("ops_jobs"),
        intents: await count("whatsapp_outbound_intents"),
        reviews: await count(REVIEW_TABLE),
      });
      const reviewsFor = (conversationId) =>
        query(`SELECT * FROM ${REVIEW_TABLE} WHERE conversation_id=$1 ORDER BY created_at`, [
          conversationId,
        ]);
      const messageByText = (text) =>
        query(
          `SELECT m.id,m.contact_id,m.conversation_id,m.external_message_id,
             wc.contact_id AS conversation_contact_id,wc.woztell_member_id
           FROM whatsapp_messages m JOIN whatsapp_conversations wc ON wc.id=m.conversation_id
           WHERE m.text=$1`,
          [text],
        );
      // Review rows, evidence and logs never hold a raw phone or member id.
      const assertNoIdentityInEvidence = (review) => {
        const text = JSON.stringify(review.evidence);
        assert.doesNotMatch(text, /5555|852|synthetic-fx12/, text);
      };

      await t.test("migration is additive and re-runnable", async () => {
        assert.equal(MIGRATION_VERSIONS.includes(MIGRATION), true);
        const sql = readFileSync(new URL("neon/migrations/" + MIGRATION, repoRoot), "utf8").replace(
          /\r\n/g,
          "\n",
        );
        assert.match(sql, /^SET LOCAL lock_timeout = '5s';$/m);
        const firstStatement = sql
          .split("\n")
          .filter((line) => line.trim() && !line.trim().startsWith("--"))[0];
        assert.equal(firstStatement.trim(), "SET LOCAL lock_timeout = '5s';");
        // apply-migrations.mjs splits on ';' and quotes even inside comments.
        for (const line of sql.split("\n")) {
          const comment = line.indexOf("--");
          if (comment >= 0) assert.doesNotMatch(line.slice(comment), /[;']/, line);
        }
        // Additive: no function or trigger is replaced and no existing row or table is changed.
        assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE|^\s*(DROP|ALTER|UPDATE|DELETE|INSERT)\b/im);
        assert.equal((sql.match(/IF NOT EXISTS/g) ?? []).length, 5);
        // A row in every relevant table, so the digest is not trivially empty.
        await seedContact(id(90), { phone: "85255550190", member: "synthetic-fx12-digest" });
        const tables = (
          await query(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>$1 ORDER BY tablename",
            [REVIEW_TABLE],
          )
        ).map((row) => row.tablename);
        const digest = async () => {
          const out = {};
          for (const table of tables)
            out[table] = (
              await query(
                `SELECT md5(COALESCE(string_agg(t::text,'|' ORDER BY t::text),'')) AS h FROM "${table}" t`,
              )
            )[0].h;
          return out;
        };
        const before = await digest();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        assert.deepEqual(await digest(), before);
        const [shape] = await query(
          `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name=$1`,
          [REVIEW_TABLE],
        );
        assert.equal(shape.n, 13);
        const [ownership] = await query(
          `SELECT kcu.column_name FROM information_schema.referential_constraints rc
           JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=rc.constraint_name
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=rc.unique_constraint_name
           WHERE kcu.table_name=$1 AND ccu.table_name='staff_users'`,
          [REVIEW_TABLE],
        );
        assert.equal(ownership.column_name, "resolved_by");
        await query("DELETE FROM crm_contacts WHERE id=$1", [id(90)]);
      });

      // Case a state, shared by the next two subtests.
      const X = id(301);
      let caseA;
      await t.test(
        "member conflict → message stored in review conversation, not lost",
        async () => {
          await seedContact(X, { phone: "85255550101", member: "synthetic-fx12-m1", name: "陳太" });
          const xBefore = await rowHash(X);
          const before = await totals();
          const first = event({
            messageId: "synthetic-fx12-a-1",
            member: "synthetic-fx12-m2",
            phone: "85255550101",
            text: "合成衝突訊息一",
          });
          const outcome = await ingest(first);
          assert.equal(outcome.identityReview, true);
          assert.equal(outcome.contactId, null);
          assert.equal(outcome.messageInserted, true);
          const messages = await messageByText("合成衝突訊息一");
          assert.equal(messages.length, 1);
          assert.equal(messages[0].contact_id, null);
          assert.equal(messages[0].conversation_id, outcome.conversationId);
          assert.equal(messages[0].conversation_contact_id, null);
          assert.equal(messages[0].woztell_member_id, "synthetic-fx12-m2");
          const reviews = await reviewsFor(outcome.conversationId);
          assert.equal(reviews.length, 1);
          assert.equal(reviews[0].status, "open");
          assert.equal(reviews[0].reason, "whatsapp_identity_conflict");
          assert.equal(reviews[0].contact_a, null);
          assert.equal(reviews[0].contact_b, X);
          assert.equal(reviews[0].evidence.kind, "member_phone_mismatch");
          assert.equal(reviews[0].evidence.messageCount, 1);
          assert.equal(reviews[0].evidence.optOutApplied, false);
          assert.equal(reviews[0].evidence.stopReceived, false);
          assertNoIdentityInEvidence(reviews[0]);

          const second = event({
            messageId: "synthetic-fx12-a-2",
            member: "synthetic-fx12-m2",
            phone: "85255550101",
            text: "合成衝突訊息二",
          });
          const again = await ingest(second);
          assert.equal(again.identityReview, true);
          assert.equal(again.conversationId, outcome.conversationId);
          const [secondMessage] = await messageByText("合成衝突訊息二");
          assert.equal(secondMessage.conversation_id, outcome.conversationId);
          assert.equal(secondMessage.contact_id, null);
          let open = await reviewsFor(outcome.conversationId);
          assert.equal(open.length, 1);
          assert.equal(open[0].evidence.messageCount, 2);

          // A redelivered webhook for the same message: no second row, review or conversation.
          const redelivered = await ingest(second);
          assert.equal(redelivered.messageInserted, false);
          assert.equal(redelivered.conversationId, outcome.conversationId);
          open = await reviewsFor(outcome.conversationId);
          assert.equal(open.length, 1);
          assert.equal(open[0].evidence.messageCount, 2);
          assert.equal(
            await count("whatsapp_conversations", "woztell_member_id=$1", ["synthetic-fx12-m2"]),
            1,
          );
          assert.equal((await messageByText("合成衝突訊息二")).length, 1);
          caseA = { conversationId: outcome.conversationId, xBefore, before };
        },
      );

      await t.test(
        "review path writes no contact field, no lead and no enquiry event",
        async () => {
          assert.ok(caseA, "depends on the member conflict subtest");
          assert.equal(await rowHash(X), caseA.xBefore);
          const after = await totals();
          assert.equal(after.contacts, caseA.before.contacts);
          assert.equal(after.leads, caseA.before.leads);
          assert.equal(after.enquiryEvents, caseA.before.enquiryEvents);
          assert.equal(after.jobs, caseA.before.jobs);
          assert.equal(after.intents, caseA.before.intents, "no auto-reply");
          assert.equal(after.messages, caseA.before.messages + 2);
          assert.equal(after.conversations, caseA.before.conversations + 1);
          assert.equal(after.reviews, caseA.before.reviews + 1);
        },
      );

      await t.test(
        "a blank fill that would collide goes to review instead of a 23505",
        async () => {
          // Variant 1: W holds the member with no phone, Y holds the phone with no member.
          const W = id(311);
          const Y = id(312);
          await seedContact(W, { member: "synthetic-fx12-m3" });
          await seedContact(Y, { phone: "85255550102" });
          const hashes = [await rowHash(W), await rowHash(Y)];
          const outcome = await ingest(
            event({
              messageId: "synthetic-fx12-b-1",
              member: "synthetic-fx12-m3",
              phone: "85255550102",
              text: "合成填補衝突一",
            }),
          );
          assert.equal(outcome.identityReview, true);
          assert.equal(outcome.contactId, null);
          const [review] = await reviewsFor(outcome.conversationId);
          assert.equal(review.evidence.kind, "fill_collision");
          assert.equal(review.contact_a, W);
          assert.equal(review.contact_b, Y);
          assertNoIdentityInEvidence(review);
          assert.deepEqual([await rowHash(W), await rowHash(Y)], hashes);
          const [message] = await messageByText("合成填補衝突一");
          assert.equal(message.contact_id, null);

          // Variant 2: Y2 holds the legacy 8-digit spelling of the same number.
          const Y2 = id(313);
          const W2 = id(314);
          await seedContact(Y2, { phone: "55550103" });
          await seedContact(W2, { member: "synthetic-fx12-m4" });
          const hashes2 = [await rowHash(Y2), await rowHash(W2)];
          const legacy = await ingest(
            event({
              messageId: "synthetic-fx12-b-2",
              member: "synthetic-fx12-m4",
              phone: "85255550103",
              text: "合成填補衝突二",
            }),
          );
          assert.equal(legacy.identityReview, true);
          const [legacyReview] = await reviewsFor(legacy.conversationId);
          assert.equal(legacyReview.evidence.kind, "fill_collision");
          assert.equal(legacyReview.contact_a, W2);
          assert.equal(legacyReview.contact_b, Y2);
          assert.deepEqual([await rowHash(Y2), await rowHash(W2)], hashes2);
        },
      );

      await t.test(
        "a conversation owned by another contact goes to review and commits no contact write",
        async () => {
          const Z = id(321);
          const V = id(322);
          await seedContact(Z, { phone: "85255550120" });
          await seedContact(V, { phone: "85255550106" });
          const [conversation] = await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
             VALUES($1,'synthetic-fx12-m5',$2,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z') RETURNING id`,
            [Z, CHANNEL],
          );
          const hashes = [await rowHash(Z), await rowHash(V)];
          const outcome = await ingest(
            event({
              messageId: "synthetic-fx12-c-1",
              member: "synthetic-fx12-m5",
              phone: "85255550106",
              text: "合成對話歸屬衝突",
            }),
          );
          assert.equal(outcome.identityReview, true);
          assert.equal(outcome.conversationId, conversation.id);
          const [message] = await messageByText("合成對話歸屬衝突");
          assert.equal(message.conversation_id, conversation.id);
          assert.equal(message.contact_id, null);
          assert.equal(message.conversation_contact_id, Z);
          const [review] = await reviewsFor(conversation.id);
          assert.equal(review.evidence.kind, "conversation_owner");
          assert.equal(review.contact_a, Z);
          assert.equal(review.contact_b, V);
          // Today V's last_inbound_at and member fill would commit before the throw.
          assert.deepEqual([await rowHash(Z), await rowHash(V)], hashes);
        },
      );

      await t.test("STOP in a conflicted message opts out every matched contact", async () => {
        const P = id(331); // phone owner, another member
        const M = id(332); // member owner, another phone
        await seedContact(P, { phone: "85255550107", member: "synthetic-fx12-m8" });
        await seedContact(M, { phone: "85255550108", member: "synthetic-fx12-m9" });
        const stop = event({
          messageId: "synthetic-fx12-stop-1",
          member: "synthetic-fx12-m9",
          phone: "85255550107",
          text: "STOP",
        });
        const outcome = await ingest(stop);
        assert.equal(outcome.identityReview, true);
        assert.equal(outcome.contactId, null);
        const optOut = (contactId) =>
          query(
            `SELECT opted_out_whatsapp,opted_out_source,opted_out_message_id,opted_out_text
             FROM crm_contacts WHERE id=$1`,
            [contactId],
          ).then((rows) => rows[0]);
        for (const contactId of [P, M]) {
          const row = await optOut(contactId);
          assert.equal(row.opted_out_whatsapp, true, contactId);
          assert.equal(row.opted_out_source, "customer_message");
          assert.equal(row.opted_out_message_id, stop.externalMessageId);
          assert.equal(row.opted_out_text, "STOP");
        }
        const [review] = await reviewsFor(outcome.conversationId);
        assert.equal(review.contact_a, M);
        assert.equal(review.contact_b, P);
        assert.equal(review.evidence.optOutApplied, true);
        assert.equal(review.evidence.stopReceived, true);
        assert.equal(review.evidence.kind, "member_phone_mismatch");

        // A redelivery changes nothing.
        const hashes = [await rowHash(P), await rowHash(M)];
        const redelivered = await ingest(stop);
        assert.equal(redelivered.messageInserted, false);
        assert.deepEqual([await rowHash(P), await rowHash(M)], hashes);
        const [same] = await reviewsFor(outcome.conversationId);
        assert.equal(same.evidence.messageCount, 1);
        assert.equal((await reviewsFor(outcome.conversationId)).length, 1);

        // A history_import STOP opts out nobody.
        const H1 = id(333);
        const H2 = id(334);
        await seedContact(H1, { phone: "85255550109", member: "synthetic-fx12-m10" });
        await seedContact(H2, { phone: "85255550110", member: "synthetic-fx12-m11" });
        const historical = await ingest(
          event({
            messageId: "synthetic-fx12-stop-2",
            member: "synthetic-fx12-m10",
            phone: "85255550110",
            text: "STOP",
          }),
          "history_import",
        );
        assert.equal(historical.identityReview, true);
        for (const contactId of [H1, H2])
          assert.equal((await optOut(contactId)).opted_out_whatsapp, false, contactId);
        const [historyReview] = await reviewsFor(historical.conversationId);
        assert.equal(historyReview.evidence.optOutApplied, false);
        assert.equal(historyReview.evidence.stopReceived, false);
      });

      await t.test(
        "two contacts holding the 8-digit and 852 forms: ingest picks the same contact as today",
        async () => {
          const legacyPick = async (phone, member) =>
            (await query(LEGACY_MATCH, [phone, member]))[0]?.id ?? null;
          const reviewsBefore = await count(REVIEW_TABLE);

          // (i) Neither holds a member: the exact canonical spelling wins and gets the member.
          const A1 = id(341);
          const B1 = id(342);
          await seedContact(A1, { phone: "55550104" });
          await seedContact(B1, { phone: "85255550104" });
          const expected1 = await legacyPick("85255550104", "synthetic-fx12-m6");
          assert.equal(expected1, B1);
          const first = await ingest(
            event({
              messageId: "synthetic-fx12-rf1-1",
              member: "synthetic-fx12-m6",
              phone: "85255550104",
              text: "合成揀選一",
            }),
          );
          assert.equal(first.identityReview, false);
          assert.equal(first.contactId, expected1);
          const [b1] = await query("SELECT whatsapp_member_id FROM crm_contacts WHERE id=$1", [B1]);
          assert.equal(b1.whatsapp_member_id, "synthetic-fx12-m6");

          // (ii) The legacy row holds the member: the member owner wins.
          const A2 = id(343);
          const B2 = id(344);
          await seedContact(A2, { phone: "55550105", member: "synthetic-fx12-m7" });
          await seedContact(B2, { phone: "85255550105" });
          const expected2 = await legacyPick("85255550105", "synthetic-fx12-m7");
          assert.equal(expected2, A2);
          const second = await ingest(
            event({
              messageId: "synthetic-fx12-rf1-2",
              member: "synthetic-fx12-m7",
              phone: "85255550105",
              text: "合成揀選二",
            }),
          );
          assert.equal(second.identityReview, false);
          assert.equal(second.contactId, expected2);

          // (iii) After (i), the next message attaches to B again.
          const expected3 = await legacyPick("85255550104", "synthetic-fx12-m6");
          const third = await ingest(
            event({
              messageId: "synthetic-fx12-rf1-3",
              member: "synthetic-fx12-m6",
              phone: "85255550104",
              text: "合成揀選三",
            }),
          );
          assert.equal(third.identityReview, false);
          assert.equal(third.contactId, expected3);
          assert.equal(third.contactId, B1);
          assert.equal(third.conversationId, first.conversationId);
          assert.equal(await count(REVIEW_TABLE), reviewsBefore);
        },
      );

      await t.test("a normal message is unchanged by FX-12", async () => {
        const before = await totals();
        const outcome = await ingest(
          event({
            messageId: "synthetic-fx12-normal-1",
            member: "synthetic-fx12-m12",
            phone: "85255550111",
            text: "你好，想問下有冇兩房單位",
          }),
        );
        assert.equal(outcome.identityReview, false);
        assert.ok(outcome.contactId);
        assert.ok(outcome.conversationId);
        assert.equal(outcome.messageInserted, true);
        const after = await totals();
        assert.deepEqual(
          {
            contacts: after.contacts - before.contacts,
            conversations: after.conversations - before.conversations,
            messages: after.messages - before.messages,
            leads: after.leads - before.leads,
            enquiryEvents: after.enquiryEvents - before.enquiryEvents,
            jobs: after.jobs - before.jobs,
            intents: after.intents - before.intents,
            reviews: after.reviews - before.reviews,
          },
          {
            contacts: 1,
            conversations: 1,
            messages: 1,
            leads: 1,
            enquiryEvents: 1,
            jobs: 1,
            intents: 0,
            reviews: 0,
          },
        );
        const [message] = await messageByText("你好，想問下有冇兩房單位");
        assert.equal(message.contact_id, outcome.contactId);
        assert.equal(message.conversation_contact_id, outcome.contactId);
      });

      await t.test("history import of a conflicted message also lands in review", async () => {
        const HX = id(351);
        await seedContact(HX, { phone: "85255550112", member: "synthetic-fx12-m13" });
        const hash = await rowHash(HX);
        const before = await totals();
        const outcome = await ingest(
          event({
            messageId: "synthetic-fx12-history-1",
            member: "synthetic-fx12-m14",
            phone: "85255550112",
            text: "合成舊訊息",
          }),
          "history_import",
        );
        assert.equal(outcome.identityReview, true);
        const [message] = await messageByText("合成舊訊息");
        assert.equal(message.contact_id, null);
        const [review] = await reviewsFor(outcome.conversationId);
        assert.equal(review.status, "open");
        assert.equal(review.evidence.optOutApplied, false);
        assert.equal(await rowHash(HX), hash);
        const after = await totals();
        assert.equal(after.leads, before.leads);
        assert.equal(after.enquiryEvents, before.enquiryEvents);
      });

      await t.test(
        "exhausted receipts from a conflict now project when a manager retries",
        async () => {
          const RX = id(361);
          await seedContact(RX, { phone: "85255550113", member: "synthetic-fx12-m15" });
          const raw = event({
            messageId: "synthetic-fx12-receipt-1",
            member: "synthetic-fx12-m16",
            phone: "85255550113",
            text: "合成收據訊息",
          });
          const stored = await storeInboundReceipt({
            tenantKey: "woztell:" + APP,
            appId: APP,
            channelId: CHANNEL,
            origin: "live_webhook",
            eventKind: "customer_message",
            bodyDigest: "c".repeat(64),
            providerOccurredAt: raw.timestamp,
            receivedAt: new Date(),
            capture: { mode: "observe", activationId: null, effectsEligible: false },
            event: raw,
          });
          await markInboundReceipt(stored.receiptId, "failed", "PROJECTION_FAILED");
          await query(
            "UPDATE whatsapp_inbound_receipts SET attempt_count=20,updated_at=now()-interval '3 hours' WHERE id=$1",
            [stored.receiptId],
          );
          const result = await retryInboundReceipt(
            stored.receiptId,
            { staffId: MANAGER, roles: ["manager"] },
            { requestId: randomUUID() },
          );
          assert.deepEqual(result, { receiptId: stored.receiptId, projectionState: "projected" });
          const [message] = await messageByText("合成收據訊息");
          assert.equal(message.contact_id, null);
          const [review] = await reviewsFor(message.conversation_id);
          assert.equal(review.status, "open");
          assert.equal(review.contact_b, RX);
        },
      );

      await t.test(
        "a 「身分待核對」 conversation refuses staff replies until it is linked",
        async () => {
          // The conversation is a normal one with a queued staff reply. Then a conflicting
          // message opens a review on it: the queued reply is cancelled at dispatch, and a
          // new reply is refused at enqueue. Nothing is sent.
          const Z = id(371);
          const V = id(372);
          await seedContact(Z, { phone: "85255550121" });
          await seedContact(V, { phone: "85255550114" });
          const [conversation] = await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
             VALUES($1,'synthetic-fx12-m17',$2,now(),now()) RETURNING id`,
            [Z, CHANNEL],
          );
          const reply = () =>
            enqueueOutboundIntent(
              {
                requestId: randomUUID(),
                conversationId: conversation.id,
                kind: "text",
                payload: { text: "合成回覆" },
              },
              MANAGER,
              null,
            );
          const queued = await reply();
          assert.equal(queued.state, "queued");

          const outcome = await ingest(
            event({
              messageId: "synthetic-fx12-reply-1",
              member: "synthetic-fx12-m17",
              phone: "85255550114",
              text: "合成回覆衝突",
            }),
          );
          assert.equal(outcome.identityReview, true);
          assert.equal(outcome.conversationId, conversation.id);

          let sends = 0;
          const [job] = await query(
            "UPDATE ops_jobs SET status='running',lease_owner='synthetic-fx12-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
            ["woztell.reply:" + queued.id],
          );
          const delivered = await deliverOutboundIntent(queued.id, {
            checkpoint: async () => {},
            send: async () => {
              sends += 1;
              return { ok: true, body: { ok: 1 } };
            },
            job: { jobId: job.id, workerId: "synthetic-fx12-worker" },
          });
          assert.deepEqual(delivered, { dispatched: 0 });
          assert.equal(sends, 0);
          const [intent] = await query("SELECT state FROM whatsapp_outbound_intents WHERE id=$1", [
            queued.id,
          ]);
          assert.equal(intent.state, "cancelled");

          const intentsBefore = await count("whatsapp_outbound_intents");
          await assert.rejects(reply(), { code: "OUTBOUND_CONFLICT_OR_NOT_FOUND" });
          assert.equal(await count("whatsapp_outbound_intents"), intentsBefore);
          // The case a review conversation (no contact) refuses too, for admin as well.
          assert.ok(caseA);
          await assert.rejects(
            enqueueOutboundIntent(
              {
                requestId: randomUUID(),
                conversationId: caseA.conversationId,
                kind: "text",
                payload: { text: "合成回覆" },
              },
              ADMIN,
              null,
            ),
            { code: "OUTBOUND_CONFLICT_OR_NOT_FOUND" },
          );
        },
      );

      await t.test(
        "an owned conversation whose message resolves to no contact goes to review and creates no contact",
        async () => {
          // Path (c′): before FX-12 a new contact was committed, then ingest threw.
          const Z = id(381);
          await seedContact(Z, { phone: "85255550129" });
          const [conversation] = await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
             VALUES($1,'synthetic-fx12-m18',$2,now(),now()) RETURNING id`,
            [Z, CHANNEL],
          );
          const hash = await rowHash(Z);
          const contactsBefore = await count("crm_contacts");
          const outcome = await ingest(
            event({
              messageId: "synthetic-fx12-cprime-1",
              member: "synthetic-fx12-m18",
              phone: "85255550130",
              text: "合成無聯絡人衝突",
            }),
          );
          assert.equal(outcome.identityReview, true);
          assert.equal(outcome.conversationId, conversation.id);
          assert.equal(await count("crm_contacts"), contactsBefore);
          assert.equal(await rowHash(Z), hash);
          const [review] = await reviewsFor(conversation.id);
          assert.equal(review.evidence.kind, "conversation_owner");
          assert.equal(review.contact_a, Z);
          assert.equal(review.contact_b, null);
          // A later STOP in this conversation matches no contact: nobody is opted out, but
          // the review records it so that a later link can apply it (review minor 2).
          const stop = await ingest(
            event({
              messageId: "synthetic-fx12-cprime-2",
              member: "synthetic-fx12-m18",
              phone: "85255550130",
              text: "STOP",
            }),
          );
          assert.equal(stop.identityReview, true);
          const [afterStop] = await reviewsFor(conversation.id);
          assert.equal(afterStop.evidence.messageCount, 2);
          assert.equal(afterStop.evidence.optOutApplied, false);
          assert.equal(afterStop.evidence.stopReceived, true);
          assert.equal(await rowHash(Z), hash);
        },
      );

      await t.test(
        "the conversation owner holds the member and another contact holds the phone: STOP opts out both",
        async () => {
          // The realistic case (c): the owner holds the conversation's member.
          const Z = id(391);
          const V = id(392);
          await seedContact(Z, { phone: "85255550131", member: "synthetic-fx12-m19" });
          await seedContact(V, { phone: "85255550132" });
          const [conversation] = await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
             VALUES($1,'synthetic-fx12-m19',$2,now(),now()) RETURNING id`,
            [Z, CHANNEL],
          );
          const stop = event({
            messageId: "synthetic-fx12-cstop-1",
            member: "synthetic-fx12-m19",
            phone: "85255550132",
            text: "STOP",
          });
          const outcome = await ingest(stop);
          assert.equal(outcome.identityReview, true);
          assert.equal(outcome.conversationId, conversation.id);
          const [review] = await reviewsFor(conversation.id);
          assert.equal(review.evidence.kind, "conversation_owner");
          assert.equal(review.contact_a, Z);
          assert.equal(review.contact_b, V);
          assert.equal(review.evidence.optOutApplied, true);
          const rows = await query(
            "SELECT id,opted_out_whatsapp,opted_out_message_id,whatsapp_member_id,normalized_phone FROM crm_contacts WHERE id=ANY($1::uuid[]) ORDER BY id",
            [[Z, V]],
          );
          for (const row of rows) {
            assert.equal(row.opted_out_whatsapp, true, row.id);
            assert.equal(row.opted_out_message_id, stop.externalMessageId);
          }
          // No identity field is filled from the conflicted message.
          assert.equal(rows.find((row) => row.id === V).whatsapp_member_id, null);
          assert.equal(rows.find((row) => row.id === Z).normalized_phone, "85255550131");
        },
      );

      await t.test(
        "no automated service reply is prepared or delivered in a 「身分待核對」 conversation",
        async () => {
          const service = await import("../whatsapp-enquiries/service-workflow.server.ts");
          const { buildLiveEventStatements } =
            await import("../whatsapp-enquiries/workflow.server.ts");
          const { observeEpisode } = await import("../whatsapp-enquiries/episodes.server.ts");
          const { SERVICE_CAPABILITIES } = await import("../control-plane/job-handlers.server.ts");
          const ports = { query, transaction };
          const previousEnv = {
            automation: process.env.EP_WA_SERVICE_AUTOMATION_ENABLED,
            activation: process.env.EP_WA_ACTIVATION_ID,
            channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
          };
          const restoreEnv = (key, value) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          };
          let sends = 0;
          const adapter = {
            verificationRef: "SYNTHETIC_ONLY",
            render: ({ text }) => [{ type: "TEXT", text }],
            send: async () => {
              sends += 1;
              return { ok: true, body: { messageId: "synthetic-fx12-service-out-" + sends } };
            },
          };
          try {
            const now = new Date();
            const [policy] = await query(
              `INSERT INTO whatsapp_service_policies(version,rules,status,approved_by,copy_version,effective_at)
               VALUES(1,$1::jsonb,'approved',$2,'fixture-only',$3::timestamptz) RETURNING id`,
              [
                JSON.stringify({
                  timezone: "Asia/Hong_Kong",
                  weekdays: [0, 1, 2, 3, 4, 5, 6],
                  holidays: [],
                  openMinute: 0,
                  closeMinute: 1439,
                  durationMode: "elapsed",
                  beforeOpen: "overnight",
                  atOpen: "daytime",
                  atClose: "overnight",
                  crossClosing: "elapsed",
                  reception: "sales",
                  suppressSurveyAfterHuman: false,
                  freshnessSeconds: 3600,
                  surveyExpirySeconds: 86400,
                  workerLagSeconds: 86400,
                  managerStaffId: ADMIN,
                  afterHoursCopy: "Hypothetical approved fixture after-hours copy",
                }),
                ADMIN,
                new Date(now.getTime() - 60000).toISOString(),
              ],
            );
            const generation = await service.activateServiceGeneration(
              policy.id,
              ADMIN,
              ports,
              new Date(now.getTime() - 1000),
            );
            const runtime = { enabled: true, generationId: generation, channelId: CHANNEL };
            process.env.EP_WA_SERVICE_AUTOMATION_ENABLED = "true";
            process.env.EP_WA_ACTIVATION_ID = generation;
            process.env.EP_WA_COMPANY_CHANNEL_ID = CHANNEL;

            // A normal customer conversation with a fresh enquiry and a scheduled survey.
            let seq = 0;
            const surveyFor = async (contactId, member, phone) => {
              seq += 1;
              await seedContact(contactId, { phone, member });
              const [conversation] = await query(
                `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
                 VALUES($1,$2,$3,now(),now()) RETURNING id`,
                [contactId, member, CHANNEL],
              );
              const messageId = "synthetic-fx12-service-intake-" + seq;
              await query(
                `INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,channel_id,woztell_member_id,external_message_id)
                 VALUES($1,$2,'inbound','TEXT','合成查詢',$3,$4,$5)`,
                [conversation.id, contactId, CHANNEL, member, messageId],
              );
              const intake = normalizeWoztellEvent({
                type: "TEXT",
                messageId,
                member,
                channel: CHANNEL,
                app: APP,
                timestamp: Math.floor(now.getTime() / 1000),
                data: { text: "合成查詢" },
              });
              const statements = buildLiveEventStatements(intake, now, "active");
              await transaction(statements);
              const eventId = statements[0].params[0];
              await observeEpisode(eventId, query);
              const scheduled = await service.scheduleServiceForEvent(eventId, ports, runtime, now);
              assert.equal(scheduled.scheduled, 1);
              const [action] = await query(
                `SELECT a.* FROM whatsapp_service_actions a JOIN inquiries i ON i.id=a.inquiry_id
                 WHERE i.conversation_id=$1 AND a.purpose='survey'`,
                [conversation.id],
              );
              return { conversationId: conversation.id, action, due: new Date(action.due_at) };
            };
            const running = async (actionId) => {
              const [job] = await query(
                "SELECT id FROM ops_jobs WHERE job_type='woztell.reply.deliver' AND payload_version=2 AND payload->>'actionId'=$1",
                [actionId],
              );
              await transaction([
                {
                  statement: "SELECT set_config('app.wa_worker_capabilities',$1,true)",
                  params: [JSON.stringify(SERVICE_CAPABILITIES)],
                },
                {
                  statement:
                    "UPDATE ops_jobs SET status='running',lease_owner='synthetic-fx12-worker',lease_expires_at=now()+interval '5 minutes' WHERE id=$1::uuid",
                  params: [job.id],
                },
              ]);
              return {
                checkpoint: async () => {},
                job: { jobId: job.id, workerId: "synthetic-fx12-worker" },
              };
            };
            const conflict = async (member, phone, messageId) => {
              const outcome = await ingest(
                event({ messageId, member, phone, text: "合成自動回覆衝突" + messageId.slice(-1) }),
              );
              assert.equal(outcome.identityReview, true);
              return outcome;
            };

            // 1. Prepared before the conflict, delivered after it: never sent.
            const Z = id(401);
            await seedContact(id(402), { phone: "85255550142" });
            const first = await surveyFor(Z, "synthetic-fx12-m20", "85255550141");
            assert.deepEqual(
              await service.prepareServiceAction(
                first.action.id,
                ports,
                runtime,
                first.due,
                adapter,
              ),
              { prepared: 1, blocked: 0 },
            );
            await conflict("synthetic-fx12-m20", "85255550142", "synthetic-fx12-service-c-1");
            const delivered = await service.deliverServiceAction(
              first.action.id,
              await running(first.action.id),
              ports,
              runtime,
              first.due,
              adapter,
            );
            assert.deepEqual(delivered, { dispatched: 0 });
            assert.equal(sends, 0);
            const [intent] = await query(
              "SELECT state,error FROM whatsapp_outbound_intents WHERE service_action_id=$1",
              [first.action.id],
            );
            assert.deepEqual(intent, { state: "cancelled", error: "identity_review_open" });
            const [suppressed] = await query(
              "SELECT state,block_reason FROM whatsapp_service_actions WHERE id=$1",
              [first.action.id],
            );
            assert.deepEqual(suppressed, {
              state: "suppressed",
              block_reason: "identity_review_open",
            });

            // 2. Prepared after the conflict: not eligible, terminal, no intent.
            const Z2 = id(403);
            await seedContact(id(404), { phone: "85255550144" });
            const second = await surveyFor(Z2, "synthetic-fx12-m21", "85255550143");
            const review = await conflict(
              "synthetic-fx12-m21",
              "85255550144",
              "synthetic-fx12-service-c-2",
            );
            const intentsBefore = await count("whatsapp_outbound_intents");
            assert.deepEqual(
              await service.prepareServiceAction(
                second.action.id,
                ports,
                runtime,
                second.due,
                adapter,
              ),
              { prepared: 0, blocked: 1 },
            );
            assert.equal(await count("whatsapp_outbound_intents"), intentsBefore);
            const [blocked] = await query(
              "SELECT state,block_reason FROM whatsapp_service_actions WHERE id=$1",
              [second.action.id],
            );
            assert.deepEqual(blocked, {
              state: "suppressed",
              block_reason: "identity_review_open",
            });

            // 2b. Races: the review opens after the action context was read. The SQL guard
            // inside the locked statement alone must refuse, at deliver and at prepare.
            const Z3 = id(405);
            await seedContact(id(406), { phone: "85255550146" });
            const third = await surveyFor(Z3, "synthetic-fx12-m22", "85255550145");
            assert.deepEqual(
              await service.prepareServiceAction(
                third.action.id,
                ports,
                runtime,
                third.due,
                adapter,
              ),
              { prepared: 1, blocked: 0 },
            );
            const lease = await running(third.action.id);
            let checkpoints = 0;
            const raced = await service.deliverServiceAction(
              third.action.id,
              {
                ...lease,
                // The second checkpoint runs after the context read, just before dispatch.
                checkpoint: async () => {
                  checkpoints += 1;
                  if (checkpoints === 2)
                    await conflict(
                      "synthetic-fx12-m22",
                      "85255550146",
                      "synthetic-fx12-service-c-3",
                    );
                },
              },
              ports,
              runtime,
              third.due,
              adapter,
            );
            assert.equal(checkpoints, 2);
            assert.deepEqual(raced, { dispatched: 0 });
            assert.equal(sends, 0);
            const [racedIntent] = await query(
              "SELECT state,error FROM whatsapp_outbound_intents WHERE service_action_id=$1",
              [third.action.id],
            );
            assert.deepEqual(racedIntent, { state: "cancelled", error: "identity_review_open" });

            const Z4 = id(407);
            await seedContact(id(408), { phone: "85255550148" });
            const fourth = await surveyFor(Z4, "synthetic-fx12-m23", "85255550147");
            await conflict("synthetic-fx12-m23", "85255550148", "synthetic-fx12-service-c-4");
            // A stale context read that has not seen the review yet.
            const staleQuery = async (statement, params) => {
              const rows = await query(statement, params);
              return statement.includes("AS identity_review_open,")
                ? rows.map((row) => ({ ...row, identity_review_open: false }))
                : rows;
            };
            const intentsBeforeRace = await count("whatsapp_outbound_intents");
            assert.deepEqual(
              await service.prepareServiceAction(
                fourth.action.id,
                { query: staleQuery, transaction },
                runtime,
                fourth.due,
                adapter,
              ),
              { prepared: 0, blocked: 0 },
            );
            assert.equal(await count("whatsapp_outbound_intents"), intentsBeforeRace);
            assert.equal(
              await count(
                "ops_jobs",
                "job_type='woztell.reply.deliver' AND payload->>'actionId'=$1",
                [fourth.action.id],
              ),
              0,
            );

            // 3. A manager resolves the review: automated replies work again.
            await query(
              `UPDATE crm_contact_identity_reviews SET status='linked',linked_contact_id=$2,
                 resolved_at=now(),resolved_by=$3,updated_at=now() WHERE conversation_id=$1 AND status='open'`,
              [review.conversationId, Z2, MANAGER],
            );
            // Stands in for the next scheduled action on the same conversation.
            await query(
              "UPDATE whatsapp_service_actions SET state='queued',block_reason=NULL WHERE id=$1",
              [second.action.id],
            );
            assert.deepEqual(
              await service.prepareServiceAction(
                second.action.id,
                ports,
                runtime,
                second.due,
                adapter,
              ),
              { prepared: 1, blocked: 0 },
            );
            assert.deepEqual(
              await service.deliverServiceAction(
                second.action.id,
                await running(second.action.id),
                ports,
                runtime,
                second.due,
                adapter,
              ),
              { dispatched: 1 },
            );
            assert.equal(sends, 1);
          } finally {
            restoreEnv("EP_WA_SERVICE_AUTOMATION_ENABLED", previousEnv.automation);
            restoreEnv("EP_WA_ACTIVATION_ID", previousEnv.activation);
            restoreEnv("EP_WA_COMPANY_CHANNEL_ID", previousEnv.channel);
          }
        },
      );
    });
  } finally {
    network.mock.restore();
    if (previousWake === undefined) delete process.env.OPS_WAKE_URL;
    else process.env.OPS_WAKE_URL = previousWake;
    if (previousEventWake === undefined) delete process.env.OPS_EVENT_WAKE_ENABLED;
    else process.env.OPS_EVENT_WAKE_ENABLED = previousEventWake;
  }
});
