// FX-08 Task 2 / D-01 / D4: opt-out evidence on owned full-schema Postgres.
// Synthetic data only. No provider call: fetch throws, wake is disabled and the
// enquiry workflow is off, so ingest only writes the transcript and the contact.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import {
  mockOwnedServerDb,
  repoRoot,
  withOwnedPostgres,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";

const MIGRATION = "20261008100000_whatsapp_opt_out_evidence.sql";
const id = (n) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CHANNEL = "synthetic-optout-channel";
const BASE = 1788000000; // 2026-08-29, unix seconds, in the past

test("FX-08 opt-out evidence (owned Postgres)", { timeout: 180000 }, async (t) => {
  const network = mock.method(globalThis, "fetch", () => {
    throw Error("Provider/network request forbidden in owned opt-out acceptance");
  });
  const previousWake = process.env.OPS_EVENT_WAKE_ENABLED;
  delete process.env.OPS_EVENT_WAKE_ENABLED;
  try {
    await withOwnedPostgres(async ({ pool, query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const { ingestWoztellEvent } = await import("./woztell-ingest.server.ts");
      const { normalizeWoztellEvent } = await import("./woztell.server.ts");
      const event = ({ messageId, member, phone, text, at }) =>
        normalizeWoztellEvent({
          memberId: member,
          channelId: CHANNEL,
          appId: "synthetic-app",
          messageEvent: {
            messageId,
            from: phone,
            to: "85230000000",
            type: "TEXT",
            timestamp: at,
            data: { text },
          },
        });
      const ingest = (e, origin = "live_webhook") =>
        ingestWoztellEvent(e, origin, undefined, {
          mode: "off",
          signedEvent: true,
          wake: () => assert.fail("no wake in opt-out acceptance"),
        });
      const contact = async (member) =>
        (
          await query(
            `SELECT id,opted_out_whatsapp,opted_out_at,opted_out_message_id,opted_out_text,
              opted_out_source,opted_out_cleared_at,opted_out_cleared_by,last_inbound_at
             FROM crm_contacts WHERE whatsapp_member_id=$1`,
            [member],
          )
        )[0];
      const iso = (seconds) => new Date(seconds * 1000).toISOString();
      // Simulates Task 3's manager clear: the flag goes false, the evidence is kept.
      const clear = (member, staffId) =>
        query(
          "UPDATE crm_contacts SET opted_out_whatsapp=false,opted_out_cleared_at=now(),opted_out_cleared_by=$2 WHERE whatsapp_member_id=$1",
          [member, staffId],
        );
      const assertNoEvidence = (row) => {
        for (const column of [
          "opted_out_at",
          "opted_out_message_id",
          "opted_out_text",
          "opted_out_source",
        ])
          assert.equal(row[column], null, column);
      };

      await t.test(
        "migration A is additive: it adds six columns and stamps legacy rows without changing any flag",
        async () => {
          assert.equal(MIGRATION_VERSIONS.includes(MIGRATION), true);
          const columns = await query(
            `SELECT column_name,data_type FROM information_schema.columns
             WHERE table_name='crm_contacts' AND column_name LIKE 'opted_out_%' ORDER BY column_name`,
          );
          assert.deepEqual(
            columns.map((c) => c.column_name),
            [
              "opted_out_at",
              "opted_out_cleared_at",
              "opted_out_cleared_by",
              "opted_out_message_id",
              "opted_out_source",
              "opted_out_text",
              "opted_out_whatsapp",
            ],
          );
          const inbound = "2026-08-01T10:00:00.000Z";
          await query(
            `INSERT INTO crm_contacts(id,name,source,opted_out_whatsapp,last_inbound_at,updated_at) VALUES
             ($1,'合成甲','test',true,$4::timestamptz,'2026-08-02T00:00:00Z'),
             ($2,'合成乙','test',true,NULL,'2026-08-03T00:00:00Z'),
             ($3,'合成丙','test',false,$4::timestamptz,'2026-08-04T00:00:00Z')`,
            [id(1), id(2), id(3), inbound],
          );
          const sql = readFileSync(new URL("neon/migrations/" + MIGRATION, repoRoot), "utf8");
          assert.doesNotMatch(sql, /SET[^;]*\bopted_out_whatsapp\s*=/i);
          // Bounded lock wait inside the runner's transaction, and a documented rollback window.
          assert.match(sql, /^SET LOCAL lock_timeout = '5s';$/m);
          assert.match(sql, /rollback window/i);
          // apply-migrations.mjs splits on ';' and quotes even inside comments.
          for (const line of sql.split("\n").filter((l) => l.trim().startsWith("--")))
            assert.doesNotMatch(line, /[;']/, line);
          const updated = (results) =>
            [results]
              .flat()
              .filter((r) => r.command === "UPDATE")
              .reduce((n, r) => n + r.rowCount, 0);
          assert.equal(updated(await pool.query(sql)), 2);
          const rows = await query(
            "SELECT id,opted_out_whatsapp,opted_out_at,opted_out_source,opted_out_message_id,opted_out_text FROM crm_contacts WHERE id=ANY($1::uuid[]) ORDER BY id",
            [[id(1), id(2), id(3)]],
          );
          assert.deepEqual(
            rows.map((r) => r.opted_out_whatsapp),
            [true, true, false],
          );
          assert.equal(rows[0].opted_out_at.toISOString(), inbound);
          assert.equal(rows[0].opted_out_source, "legacy");
          assert.equal(rows[1].opted_out_at.toISOString(), "2026-08-03T00:00:00.000Z");
          assert.equal(rows[1].opted_out_source, "legacy");
          for (const row of rows) {
            assert.equal(row.opted_out_message_id, null);
            assert.equal(row.opted_out_text, null);
          }
          assertNoEvidence(rows[2]);
          // Re-runnable: a second pass changes nothing.
          assert.equal(updated(await pool.query(sql)), 0);
          await assert.rejects(
            query("UPDATE crm_contacts SET opted_out_source='robot' WHERE id=$1", [id(1)]),
            /crm_contacts_opted_out_source_check/,
          );
        },
      );

      await t.test("「退訂」 → opt-out with evidence", async () => {
        const member = "synthetic-optout-1";
        const at = BASE + 10;
        const result = await ingest(
          event({ messageId: "synthetic-msg-1", member, phone: "85291230001", text: "退訂", at }),
        );
        assert.equal(result.messageInserted, true);
        const row = await contact(member);
        assert.equal(row.opted_out_whatsapp, true);
        assert.equal(row.opted_out_at.toISOString(), iso(at));
        assert.equal(row.opted_out_message_id, "synthetic-msg-1");
        assert.equal(row.opted_out_text, "退訂");
        assert.equal(row.opted_out_source, "customer_message");
        assert.equal(row.last_inbound_at.getTime(), row.opted_out_at.getTime());
      });

      await t.test(
        "the raw message text is stored, not the normalised form, bounded at 500",
        async () => {
          const member = "synthetic-optout-raw";
          await ingest(
            event({
              messageId: "synthetic-msg-raw",
              member,
              phone: "85291230009",
              text: " 「ＳＴＯＰ」！ ",
              at: BASE + 11,
            }),
          );
          const row = await contact(member);
          assert.equal(row.opted_out_whatsapp, true);
          assert.equal(row.opted_out_text, " 「ＳＴＯＰ」！ ");
          assert.match(
            readFileSync(new URL("./woztell-ingest.server.ts", import.meta.url), "utf8"),
            /left\(\$11(::text)?,\s*500\)/,
          );
        },
      );

      for (const [name, text, n] of [
        ["「唔要」 as reply → not opt-out", "唔要", 2],
        ['"Can I stop by?" → not opt-out', "Can I stop by?", 3],
      ])
        await t.test(name, async () => {
          const member = `synthetic-optout-${n}`;
          const result = await ingest(
            event({
              messageId: `synthetic-msg-${n}`,
              member,
              phone: `8529123000${n}`,
              text,
              at: BASE + 20,
            }),
          );
          assert.equal(result.messageInserted, true);
          const row = await contact(member);
          assert.equal(row.opted_out_whatsapp, false);
          assertNoEvidence(row);
        });

      await t.test("history_import never sets opt-out", async () => {
        // Existing contact.
        const member = "synthetic-optout-4";
        await ingest(
          event({
            messageId: "synthetic-msg-4a",
            member,
            phone: "85291230004",
            text: "你好",
            at: BASE + 30,
          }),
        );
        const imported = await ingest(
          event({
            messageId: "synthetic-msg-4b",
            member,
            phone: "85291230004",
            text: "退訂",
            at: BASE + 40,
          }),
          "history_import",
        );
        assert.equal(imported.messageInserted, true);
        const row = await contact(member);
        assert.equal(row.opted_out_whatsapp, false);
        assertNoEvidence(row);
        assert.equal(row.last_inbound_at.toISOString(), iso(BASE + 40));
        // Newly created contact.
        const fresh = "synthetic-optout-5";
        const created = await ingest(
          event({
            messageId: "synthetic-msg-5",
            member: fresh,
            phone: "85291230005",
            text: "STOP",
            at: BASE + 50,
          }),
          "history_import",
        );
        assert.equal(created.messageInserted, true);
        const newRow = await contact(fresh);
        assert.equal(newRow.opted_out_whatsapp, false);
        assertNoEvidence(newRow);
        assert.equal(newRow.last_inbound_at.toISOString(), iso(BASE + 50));
        const [{ n }] = await query(
          "SELECT count(*)::int n FROM whatsapp_messages WHERE external_message_id = ANY($1::text[])",
          [["synthetic-msg-4b", "synthetic-msg-5"]],
        );
        assert.equal(n, 2);
      });

      await t.test(
        "a redelivered opt-out message does not re-set the flag after a clear, but a new 退訂 does",
        async () => {
          const member = "synthetic-optout-6";
          const phone = "85291230006";
          const x = event({
            messageId: "synthetic-msg-6x",
            member,
            phone,
            text: "退訂",
            at: BASE + 60,
          });
          await ingest(x);
          assert.equal((await contact(member)).opted_out_whatsapp, true);
          await query(
            "INSERT INTO staff_users(id,auth_user_id,name_zh) VALUES($1,'synthetic-optout-clearer','合成清除者')",
            [id(51)],
          );
          await clear(member, id(51));
          const again = await ingest(x);
          assert.equal(again.messageInserted, false);
          const cleared = await contact(member);
          assert.equal(cleared.opted_out_whatsapp, false);
          assert.equal(cleared.opted_out_message_id, "synthetic-msg-6x");
          assert.notEqual(cleared.opted_out_cleared_at, null);
          assert.equal(cleared.opted_out_cleared_by, id(51));
          await ingest(
            event({ messageId: "synthetic-msg-6y", member, phone, text: "退訂", at: BASE + 70 }),
          );
          const reopted = await contact(member);
          assert.equal(reopted.opted_out_whatsapp, true);
          assert.equal(reopted.opted_out_message_id, "synthetic-msg-6y");
          assert.equal(reopted.opted_out_at.toISOString(), iso(BASE + 70));
          assert.equal(reopted.opted_out_source, "customer_message");
          // A new opt-out starts a fresh episode: the previous clear markers are reset.
          assert.equal(reopted.opted_out_cleared_at, null);
          assert.equal(reopted.opted_out_cleared_by, null);
        },
      );

      await t.test(
        "a history-imported copy never swallows the live opt-out for the same message",
        async () => {
          const member = "synthetic-optout-11";
          const stop = event({
            messageId: "synthetic-msg-11",
            member,
            phone: "85291230011",
            text: "退訂",
            at: BASE + 130,
          });
          const imported = await ingest(stop, "history_import");
          assert.equal(imported.messageInserted, true);
          assert.equal((await contact(member)).opted_out_whatsapp, false);
          const live = await ingest(stop);
          assert.equal(live.messageInserted, false);
          const row = await contact(member);
          assert.equal(row.opted_out_whatsapp, true);
          assert.equal(row.opted_out_message_id, "synthetic-msg-11");
          assert.equal(row.opted_out_text, "退訂");
          assert.equal(row.opted_out_source, "customer_message");
          assert.equal(row.opted_out_at.toISOString(), iso(BASE + 130));
        },
      );

      await t.test(
        "a redelivered live opt-out is applied once; evidence is unchanged",
        async () => {
          const member = "synthetic-optout-12";
          const stop = event({
            messageId: "synthetic-msg-12",
            member,
            phone: "85291230012",
            text: "STOP",
            at: BASE + 140,
          });
          await ingest(stop);
          const first = await contact(member);
          assert.equal(first.opted_out_whatsapp, true);
          const again = await ingest(stop);
          assert.equal(again.messageInserted, false);
          assert.deepEqual(await contact(member), first);
        },
      );

      await t.test(
        "a redelivery with no messageId (synthesized and legacy ids) stays cleared",
        async () => {
          // Synthesized id: the same body always yields the same digest id.
          const member = "synthetic-optout-13";
          const phone = "85291230013";
          const stop = event({ member, phone, text: "退訂", at: BASE + 150 });
          assert.equal(stop.legacyExternalMessageId !== null, true);
          await ingest(stop);
          assert.equal((await contact(member)).opted_out_message_id, stop.externalMessageId);
          await clear(member, id(51));
          assert.equal((await ingest(stop)).messageInserted, false);
          assert.equal((await contact(member)).opted_out_whatsapp, false);

          // Legacy pre-digest id: a row stored by pre-FX-08 code (which always applied
          // the opt-out) under the bare legacy key, legacy-stamped and then cleared.
          const legacyMember = "synthetic-optout-14";
          const legacyPhone = "85291230014";
          await ingest(
            event({
              messageId: "synthetic-msg-14a",
              member: legacyMember,
              phone: legacyPhone,
              text: "你好",
              at: BASE + 155,
            }),
          );
          const legacy = event({
            member: legacyMember,
            phone: legacyPhone,
            text: "退訂",
            at: BASE + 160,
          });
          const legacyContact = await contact(legacyMember);
          await query(
            `INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,external_message_id,woztell_member_id,channel_id,status,created_at)
             SELECT id,$1,'inbound','TEXT','退訂',$2,$3,$4,'received',$5::timestamptz
             FROM whatsapp_conversations WHERE woztell_member_id=$3`,
            [
              legacyContact.id,
              legacy.legacyExternalMessageId,
              legacyMember,
              CHANNEL,
              iso(BASE + 160),
            ],
          );
          await query(
            "UPDATE crm_contacts SET opted_out_at=$2::timestamptz,opted_out_source='legacy',opted_out_cleared_at=now(),opted_out_cleared_by=$3 WHERE id=$1",
            [legacyContact.id, iso(BASE + 160), id(51)],
          );
          assert.equal((await ingest(legacy)).messageInserted, false);
          const after = await contact(legacyMember);
          assert.equal(after.opted_out_whatsapp, false);
          assert.equal(after.opted_out_source, "legacy");
          assert.equal(after.opted_out_message_id, null);
        },
      );

      await t.test("an older opt-out arriving late does not overwrite newer evidence", async () => {
        const member = "synthetic-optout-7";
        const phone = "85291230007";
        await ingest(
          event({ messageId: "synthetic-msg-7y", member, phone, text: "STOP", at: BASE + 90 }),
        );
        await ingest(
          event({ messageId: "synthetic-msg-7z", member, phone, text: "退訂", at: BASE + 80 }),
        );
        const row = await contact(member);
        assert.equal(row.opted_out_whatsapp, true);
        assert.equal(row.opted_out_message_id, "synthetic-msg-7y");
        assert.equal(row.opted_out_text, "STOP");
        assert.equal(row.opted_out_at.toISOString(), iso(BASE + 90));
      });

      await t.test("wrong recipient: an opt-out on contact A never touches contact B", async () => {
        const a = "synthetic-optout-8a",
          b = "synthetic-optout-8b";
        await ingest(
          event({
            messageId: "synthetic-msg-8b",
            member: b,
            phone: "85291230082",
            text: "你好",
            at: BASE + 100,
          }),
        );
        const before = await contact(b);
        await ingest(
          event({
            messageId: "synthetic-msg-8a",
            member: a,
            phone: "85291230081",
            text: "退訂",
            at: BASE + 110,
          }),
        );
        assert.equal((await contact(a)).opted_out_whatsapp, true);
        const after = await contact(b);
        assert.notEqual(after.id, (await contact(a)).id);
        assert.deepEqual(after, before);
      });

      await t.test(
        "a near-miss confirm copies the contact's own inbound message; a foreign message is refused with no write",
        async () => {
          const { setWhatsappMarketingConsent } =
            await import("../neon/whatsapp-consent.server.ts");
          await query(
            "INSERT INTO staff_users(id,auth_user_id,name_zh) VALUES($1,'synthetic-optout-manager','合成經理')",
            [id(50)],
          );
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [id(50)]);
          const actor = { staffId: id(50), roles: ["manager"] };
          const own = "synthetic-optout-9",
            other = "synthetic-optout-10";
          await ingest(
            event({
              messageId: "synthetic-msg-9",
              member: own,
              phone: "85291230091",
              text: "我要退訂",
              at: BASE + 120,
            }),
          );
          await ingest(
            event({
              messageId: "synthetic-msg-10",
              member: other,
              phone: "85291230092",
              text: "唔好再send嘢俾我",
              at: BASE + 121,
            }),
          );
          const target = await contact(own);
          assert.equal(target.opted_out_whatsapp, false);
          const message = async (ext) =>
            (await query("SELECT id FROM whatsapp_messages WHERE external_message_id=$1", [ext]))[0]
              .id;
          const foreign = await message("synthetic-msg-10");
          await assert.rejects(
            setWhatsappMarketingConsent(
              {
                contactId: target.id,
                optedIn: false,
                evidenceSource: "customer_opt_out",
                evidenceRef: `near-miss:${foreign}`,
              },
              actor,
            ),
            (error) => error instanceof Response && error.status === 400,
          );
          assert.deepEqual(await contact(own), target);
          const [{ n: noAudit }] = await query(
            "SELECT count(*)::int n FROM audit_logs WHERE subject_id=$1",
            [target.id],
          );
          assert.equal(noAudit, 0);
          // An ineligible caller always gets 403, never the 400 existence signal:
          // an inactive manager, and an unknown contact.
          await query(
            "INSERT INTO staff_users(id,auth_user_id,name_zh,active) VALUES($1,'synthetic-optout-inactive','合成離職',false)",
            [id(52)],
          );
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [id(52)]);
          for (const [who, contactId] of [
            [{ staffId: id(52), roles: ["manager"] }, target.id],
            [actor, id(99)],
          ])
            for (const ref of [foreign, await message("synthetic-msg-9")])
              await assert.rejects(
                setWhatsappMarketingConsent(
                  {
                    contactId,
                    optedIn: false,
                    evidenceSource: "customer_opt_out",
                    evidenceRef: `near-miss:${ref}`,
                  },
                  who,
                ),
                (error) => error instanceof Response && error.status === 403,
              );
          assert.deepEqual(await contact(own), target);
          // A stale clear marker from an earlier episode is reset by a new opt-out.
          await query(
            "UPDATE crm_contacts SET opted_out_cleared_at=now(),opted_out_cleared_by=$2 WHERE id=$1",
            [target.id, id(50)],
          );
          await setWhatsappMarketingConsent(
            {
              contactId: target.id,
              optedIn: false,
              evidenceSource: "customer_opt_out",
              evidenceRef: `near-miss:${await message("synthetic-msg-9")}`,
            },
            actor,
          );
          const confirmed = await contact(own);
          assert.equal(confirmed.opted_out_whatsapp, true);
          assert.equal(confirmed.opted_out_source, "staff_recorded");
          assert.equal(confirmed.opted_out_message_id, "synthetic-msg-9");
          assert.equal(confirmed.opted_out_text, "我要退訂");
          assert.notEqual(confirmed.opted_out_at, null);
          assert.equal(confirmed.opted_out_cleared_at, null);
          assert.equal(confirmed.opted_out_cleared_by, null);
          const [audit] = await query(
            "SELECT metadata FROM audit_logs WHERE subject_id=$1 AND action='contact.marketing_consent'",
            [target.id],
          );
          assert.equal(audit.metadata.trigger, "near_miss");
          assert.match(audit.metadata.evidenceRef, /^near-miss:/);
          // Recording consent clears the flag and keeps every evidence column.
          await setWhatsappMarketingConsent(
            {
              contactId: target.id,
              optedIn: true,
              evidenceSource: "written_confirmation",
              evidenceRef: "synthetic-case-1",
            },
            actor,
          );
          const consented = await contact(own);
          assert.equal(consented.opted_out_whatsapp, false);
          for (const column of [
            "opted_out_at",
            "opted_out_message_id",
            "opted_out_text",
            "opted_out_source",
          ])
            assert.deepEqual(consented[column], confirmed[column], column);
        },
      );

      await t.test("evidence text is bounded at 500 characters (near-miss confirm)", async () => {
        const { setWhatsappMarketingConsent } = await import("../neon/whatsapp-consent.server.ts");
        const member = "synthetic-optout-15";
        const long = "我要退訂" + "長".repeat(700);
        await ingest(
          event({
            messageId: "synthetic-msg-15",
            member,
            phone: "85291230015",
            text: long,
            at: BASE + 170,
          }),
        );
        const before = await contact(member);
        assert.equal(before.opted_out_whatsapp, false);
        const [{ id: messageUuid, text: stored }] = await query(
          "SELECT id,text FROM whatsapp_messages WHERE external_message_id='synthetic-msg-15'",
        );
        assert.equal(stored, long);
        await setWhatsappMarketingConsent(
          {
            contactId: before.id,
            optedIn: false,
            evidenceSource: "customer_opt_out",
            evidenceRef: `near-miss:${messageUuid}`,
          },
          { staffId: id(50), roles: ["manager"] },
        );
        const row = await contact(member);
        assert.equal(row.opted_out_text.length, 500);
        assert.equal(row.opted_out_text, long.slice(0, 500));
      });
    });
    assert.equal(network.mock.callCount(), 0);
  } finally {
    network.mock.restore();
    if (previousWake === undefined) delete process.env.OPS_EVENT_WAKE_ENABLED;
    else process.env.OPS_EVENT_WAKE_ENABLED = previousWake;
  }
});
