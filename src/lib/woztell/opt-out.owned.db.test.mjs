// FX-08 Tasks 2-3 / D-01 / D4: opt-out evidence, what it blocks, the accidental-opt-out
// clear and the near-miss flag, on owned full-schema Postgres.
// Synthetic data only. No provider call: fetch throws, wake is disabled and the
// enquiry workflow is off, so ingest only writes the transcript and the contact.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test, { mock } from "node:test";
import ts from "typescript";
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

test("FX-08 opt-out evidence (owned Postgres)", { timeout: 300000 }, async (t) => {
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
             ($1,'合成甲','test',true,$4::timestamptz,'2026-07-30T00:00:00Z'),
             ($2,'合成乙','test',true,NULL,'2026-08-03T00:00:00Z'),
             ($3,'合成丙','test',false,$4::timestamptz,'2026-08-04T00:00:00Z'),
             ($5,'合成丁','test',true,$4::timestamptz,'2026-07-30T00:00:00Z')`,
            [id(1), id(2), id(3), inbound, id(4)],
          );
          // Contact 丁 has a conversation whose latest inbound is newer than the contact's own
          // (and its updated_at), so the stamp must use the conversation's time.
          const convInbound = "2026-08-05T09:00:00.000Z";
          await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
             VALUES($1,'synthetic-legacy-4',$2,$3::timestamptz,$3::timestamptz)`,
            [id(4), CHANNEL, convInbound],
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
          // The stamp is the latest of the contact inbound, any conversation inbound and updated_at.
          assert.match(
            sql,
            /GREATEST\(\s*c\.last_inbound_at,\s*\(SELECT max\(wc\.last_inbound_at\) FROM whatsapp_conversations wc WHERE wc\.contact_id = c\.id\),\s*c\.updated_at\s*\)/,
          );
          assert.equal(updated(await pool.query(sql)), 3);
          const rows = await query(
            "SELECT id,opted_out_whatsapp,opted_out_at,opted_out_source,opted_out_message_id,opted_out_text FROM crm_contacts WHERE id=ANY($1::uuid[]) ORDER BY id",
            [[id(1), id(2), id(3), id(4)]],
          );
          assert.deepEqual(
            rows.map((r) => r.opted_out_whatsapp),
            [true, true, false, true],
          );
          assert.equal(rows[0].opted_out_at.toISOString(), inbound);
          assert.equal(rows[0].opted_out_source, "legacy");
          assert.equal(rows[1].opted_out_at.toISOString(), "2026-08-03T00:00:00.000Z");
          assert.equal(rows[1].opted_out_source, "legacy");
          assert.equal(rows[3].opted_out_at.toISOString(), convInbound);
          assert.equal(rows[3].opted_out_source, "legacy");
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
      // ---------------------------------------------------------------------
      // FX-08 Task 3: what an opt-out blocks, the accidental-opt-out clear,
      // and the near-miss flag. Live times are inside the 24 h window.
      // ---------------------------------------------------------------------
      const LIVE = Math.floor(Date.now() / 1000) - 3600;
      const CHANNEL_B = "synthetic-optout-channel-b";
      const ADMIN = id(60),
        MANAGER = id(61),
        AGENT = id(62),
        VIEWER = id(63),
        INACTIVE_MANAGER = id(64),
        BRANCH = id(65),
        TEMPLATE = id(70);
      await query(
        "INSERT INTO branches(id,slug,name) VALUES($1,'synthetic-optout-branch','合成分行')",
        [BRANCH],
      );
      for (const [staffId, role, active, branch] of [
        [ADMIN, "admin", true, null],
        [MANAGER, "manager", true, BRANCH],
        [AGENT, "agent", true, BRANCH],
        [VIEWER, "viewer", true, BRANCH],
        [INACTIVE_MANAGER, "manager", false, BRANCH],
      ]) {
        await query(
          "INSERT INTO staff_users(id,auth_user_id,name_zh,active,branch_id) VALUES($1,$2,'合成職員',$3,$4)",
          [staffId, `synthetic-optout-${role}-${staffId.slice(-2)}`, active, branch],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staffId, role]);
      }
      await query(
        "INSERT INTO whatsapp_templates(id,element_name,status) VALUES($1,'synthetic_optout_template','active')",
        [TEMPLATE],
      );
      const liveEvent = ({ messageId, member, phone, text, at, channel = CHANNEL }) =>
        normalizeWoztellEvent({
          memberId: member,
          channelId: channel,
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
      const conversation = async (member, channel = CHANNEL) =>
        (
          await query(
            "SELECT id,last_inbound_at FROM whatsapp_conversations WHERE woztell_member_id=$1 AND channel_id=$2",
            [member, channel],
          )
        )[0];
      const { enqueueOutboundIntent, deliverOutboundIntent } =
        await import("./outbound-intent.server.ts");
      let sends = 0;
      // Real enqueue, a real ops_jobs lease and the real begin/finish; only `send` is fake.
      const dispatch = async (conversationId, kind) => {
        const requestId = randomUUID();
        await enqueueOutboundIntent(
          kind === "text"
            ? { requestId, conversationId, kind, payload: { text: "合成回覆" } }
            : { requestId, conversationId, kind, payload: { templateId: TEMPLATE } },
          ADMIN,
          null,
        );
        const [job] = await query(
          "UPDATE ops_jobs SET status='running',lease_owner='synthetic-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
          ["woztell.reply:" + requestId],
        );
        let duringSend = null;
        await deliverOutboundIntent(requestId, {
          checkpoint: async () => {},
          job: { jobId: job.id, workerId: "synthetic-worker" },
          send: async (reservation) => {
            sends++;
            assert.equal(reservation.response[0].type, kind === "text" ? "TEXT" : "TEMPLATE");
            duringSend = (
              await query("SELECT state FROM whatsapp_outbound_intents WHERE id=$1", [requestId])
            )[0].state;
            return { ok: true, body: { messageId: "synthetic-out-" + requestId } };
          },
        });
        const [row] = await query("SELECT state FROM whatsapp_outbound_intents WHERE id=$1", [
          requestId,
        ]);
        return { state: row.state, duringSend };
      };
      const stampLegacy = (member) =>
        query(
          "UPDATE crm_contacts SET opted_out_whatsapp=true,opted_out_at=last_inbound_at,opted_out_source='legacy' WHERE whatsapp_member_id=$1",
          [member],
        );
      const audits = async (contactId, action) =>
        query(
          "SELECT actor_id,metadata FROM audit_logs WHERE subject_type='contact' AND subject_id=$1 AND action=$2 ORDER BY created_at",
          [contactId, action],
        );
      // A provider-confirmed assignment (a bare write only opens an assignment request).
      const assignTo = (conversationIds, staffId) =>
        transaction([
          { statement: "SELECT set_config('app.wa_confirm_assignment','true',true)", params: [] },
          {
            statement:
              "UPDATE whatsapp_conversations SET assigned_agent_id=$2,confirmed_staff_id=$2 WHERE id = ANY($1::uuid[])",
            params: [conversationIds, staffId],
          },
        ]);
      // assert.rejects needs a synchronous validator, so the Response body is read here.
      const rejectsWith = async (promise, status, body) => {
        let error;
        try {
          await promise;
        } catch (caught) {
          error = caught;
        }
        assert.ok(error instanceof Response, `expected a ${status} Response, got ${error}`);
        assert.equal(error.status, status);
        if (body) assert.equal(await error.text(), body);
      };
      const fullContact = async (member) =>
        (await query("SELECT * FROM crm_contacts WHERE whatsapp_member_id=$1", [member]))[0];

      await t.test(
        "opted-out contact: template cancelled, text allowed after newer inbound",
        async () => {
          const member = "synthetic-reopen-1";
          const phone = "85291240001";
          await ingest(
            liveEvent({ messageId: "synthetic-reopen-1a", member, phone, text: "退訂", at: LIVE }),
          );
          assert.equal((await contact(member)).opted_out_whatsapp, true);
          const conv = await conversation(member);
          const before = sends;
          assert.equal((await dispatch(conv.id, "text")).state, "cancelled");
          assert.equal(sends, before);
          assert.equal((await dispatch(conv.id, "template")).state, "cancelled");
          assert.equal(sends, before);
          await ingest(
            liveEvent({
              messageId: "synthetic-reopen-1b",
              member,
              phone,
              text: "你好",
              at: LIVE + 1,
            }),
          );
          assert.equal(
            (await contact(member)).opted_out_whatsapp,
            true,
            "a reply never clears the flag",
          );
          const reopened = await dispatch(conv.id, "text");
          assert.equal(reopened.duringSend, "dispatching");
          assert.equal(reopened.state, "accepted");
          assert.equal(sends, before + 1);
          assert.equal((await dispatch(conv.id, "template")).state, "cancelled");
          assert.equal(sends, before + 1);
        },
      );

      await t.test(
        "the opt-out message itself never reopens text; only a strictly later inbound does, and only on that conversation",
        async () => {
          const member = "synthetic-reopen-2";
          const phone = "85291240002";
          await ingest(
            liveEvent({
              messageId: "synthetic-reopen-2a",
              member,
              phone,
              text: "你好",
              at: LIVE - 10,
              channel: CHANNEL_B,
            }),
          );
          await ingest(
            liveEvent({ messageId: "synthetic-reopen-2b", member, phone, text: "STOP", at: LIVE }),
          );
          const optedOut = await contact(member);
          assert.equal(optedOut.opted_out_whatsapp, true);
          const c1 = await conversation(member, CHANNEL);
          const c2 = await conversation(member, CHANNEL_B);
          assert.notEqual(c1.id, c2.id);
          // The STOP's own inbound time equals opted_out_at: not strictly later.
          assert.equal(c1.last_inbound_at.getTime(), optedOut.opted_out_at.getTime());
          const before = sends;
          assert.equal((await dispatch(c1.id, "text")).state, "cancelled");
          assert.equal((await dispatch(c2.id, "text")).state, "cancelled");
          // Another contact's message changes nothing for this one.
          await ingest(
            liveEvent({
              messageId: "synthetic-reopen-2c",
              member: "synthetic-reopen-2-other",
              phone: "85291240092",
              text: "你好",
              at: LIVE + 2,
            }),
          );
          assert.equal((await dispatch(c1.id, "text")).state, "cancelled");
          // A newer message on C2 reopens C2 only.
          await ingest(
            liveEvent({
              messageId: "synthetic-reopen-2d",
              member,
              phone,
              text: "想問下",
              at: LIVE + 3,
              channel: CHANNEL_B,
            }),
          );
          assert.equal((await dispatch(c2.id, "text")).state, "accepted");
          assert.equal((await dispatch(c1.id, "text")).state, "cancelled");
          assert.equal(sends, before + 1);
        },
      );

      await t.test(
        "legacy opt-out (stamped at migration) stays blocked until the next customer message",
        async () => {
          const member = "synthetic-reopen-3";
          const phone = "85291240003";
          await ingest(
            liveEvent({ messageId: "synthetic-reopen-3a", member, phone, text: "唔要", at: LIVE }),
          );
          await stampLegacy(member);
          const conv = await conversation(member);
          const before = sends;
          assert.equal((await dispatch(conv.id, "text")).state, "cancelled");
          assert.equal(sends, before);
          await ingest(
            liveEvent({
              messageId: "synthetic-reopen-3b",
              member,
              phone,
              text: "仲有冇盤",
              at: LIVE + 1,
            }),
          );
          assert.equal((await dispatch(conv.id, "text")).state, "accepted");
          assert.equal(sends, before + 1);
        },
      );

      await t.test(
        "campaigns, surveys and service acks stay blocked while opted out, even after a reopen",
        async () => {
          const member = "synthetic-reopen-1"; // reopened in the first Task 3 test
          const row = await fullContact(member);
          const conv = await conversation(member);
          assert.equal(row.opted_out_whatsapp, true);
          assert.ok(conv.last_inbound_at > row.opted_out_at, "the conversation is reopened");
          const before = sends;
          // Campaign claim eligibility: run the contact gate from campaign-delivery itself.
          const campaignSource = readFileSync(
            new URL("./campaign-delivery.server.ts", import.meta.url),
            "utf8",
          );
          const gate =
            /contact\.opt_in_whatsapp = true\s+AND contact\.opted_out_whatsapp = false/.exec(
              campaignSource,
            );
          assert.ok(gate, "campaign claim still gates on opted_out_whatsapp");
          await query("UPDATE crm_contacts SET opt_in_whatsapp=true WHERE id=$1", [row.id]);
          const [{ allowed }] = await query(
            `SELECT (${gate[0]}) AS allowed FROM crm_contacts contact WHERE contact.id=$1`,
            [row.id],
          );
          assert.equal(allowed, false);
          await query("UPDATE crm_contacts SET opt_in_whatsapp=$2 WHERE id=$1", [
            row.id,
            row.opt_in_whatsapp,
          ]);
          const { isBlastRecipientAllowed } = await import("./woztell.server.ts");
          assert.equal(
            isBlastRecipientAllowed({ optedIn: true, optedOut: row.opted_out_whatsapp }),
            false,
          );
          // Service automation (survey, acks): evaluate the module's own blockedReason.
          const serviceSource = readFileSync(
            new URL("../whatsapp-enquiries/service-workflow.server.ts", import.meta.url),
            "utf8",
          );
          const file = ts.createSourceFile("s.ts", serviceSource, ts.ScriptTarget.Latest, true);
          let fn;
          const visit = (node) => {
            if (ts.isFunctionDeclaration(node) && node.name?.text === "blockedReason")
              fn = node.getText(file);
            ts.forEachChild(node, visit);
          };
          visit(file);
          assert.ok(fn, "blockedReason found");
          const context = {
            policyFromRow: () => ({ rules: { freshnessSeconds: 600 } }),
            unresolvedServicePolicy: () => [],
          };
          vm.runInNewContext(
            ts.transpile(`${fn}; globalThis.blockedReason = blockedReason;`, {
              target: ts.ScriptTarget.ES2022,
            }),
            context,
          );
          const now = new Date();
          const serviceRow = {
            activation_id: "synthetic-generation",
            ended_at: null,
            channel_id: CHANNEL,
            woztell_member_id: member,
            policy_id: "p",
            policy_status: "approved",
            effects_eligible: true,
            timing: "fresh",
            identity_quality: "provider_id",
            occurred_at: now.toISOString(),
            received_at: now.toISOString(),
            opted_out_whatsapp: row.opted_out_whatsapp,
            last_inbound_at: conv.last_inbound_at.toISOString(),
            inquiry_status: "open",
            purpose: "survey",
          };
          const runtime = {
            enabled: true,
            generationId: "synthetic-generation",
            channelId: CHANNEL,
          };
          assert.equal(context.blockedReason(serviceRow, runtime, now), "whatsapp_opt_out");
          // Control: the same row without the opt-out passes the opt-out gate.
          assert.notEqual(
            context.blockedReason({ ...serviceRow, opted_out_whatsapp: false }, runtime, now),
            "whatsapp_opt_out",
          );
          assert.equal(sends, before);
        },
      );

      await t.test(
        "an expired reopen (newer inbound over 24 h ago) blocks text again",
        async () => {
          const member = "synthetic-reopen-4";
          const phone = "85291240004";
          await ingest(
            liveEvent({ messageId: "synthetic-reopen-4a", member, phone, text: "退訂", at: LIVE }),
          );
          const row = await contact(member);
          const conv = await conversation(member);
          // Strictly later than the opt-out, but outside the 24 h window by dispatch time.
          await query(
            "UPDATE crm_contacts SET opted_out_at=now()-interval '26 hours' WHERE id=$1",
            [row.id],
          );
          await query(
            "UPDATE whatsapp_conversations SET last_inbound_at=now()-interval '25 hours' WHERE id=$1",
            [conv.id],
          );
          const before = sends;
          assert.equal((await dispatch(conv.id, "text")).state, "cancelled");
          assert.equal((await dispatch(conv.id, "template")).state, "cancelled");
          assert.equal(sends, before);
        },
      );

      await t.test("a second STOP after a reopen re-blocks text", async () => {
        const member = "synthetic-reopen-5";
        const phone = "85291240005";
        await ingest(
          liveEvent({ messageId: "synthetic-reopen-5a", member, phone, text: "退訂", at: LIVE }),
        );
        await ingest(
          liveEvent({
            messageId: "synthetic-reopen-5b",
            member,
            phone,
            text: "你好",
            at: LIVE + 1,
          }),
        );
        const conv = await conversation(member);
        const before = sends;
        assert.equal((await dispatch(conv.id, "text")).state, "accepted");
        await ingest(
          liveEvent({
            messageId: "synthetic-reopen-5c",
            member,
            phone,
            text: "STOP",
            at: LIVE + 2,
          }),
        );
        const row = await contact(member);
        assert.equal(row.opted_out_message_id, "synthetic-reopen-5c");
        assert.equal(row.opted_out_at.toISOString(), iso(LIVE + 2));
        assert.equal((await dispatch(conv.id, "text")).state, "cancelled");
        assert.equal(sends, before + 1);
      });

      const { clearAccidentalOptOut, readOptOutEvidence } =
        await import("../neon/whatsapp-opt-out.server.ts");
      // The version the manager's detail carries: the exact microsecond string from the read.
      const version = async (contactId) => (await readOptOutEvidence(contactId)).optedOutVersion;
      const manager = { staffId: MANAGER, roles: ["manager"] };
      const reason = "客戶只是回覆唔要睇呢個盤，不是退訂";

      await t.test(
        "clearAccidentalOptOut refuses when the contact's history contains a D4 message",
        async () => {
          const { setWhatsappMarketingConsent } =
            await import("../neon/whatsapp-consent.server.ts");
          // (a) Opted out by a live 退訂.
          const live = "synthetic-clear-1";
          await ingest(
            liveEvent({
              messageId: "synthetic-clear-1a",
              member: live,
              phone: "85291250001",
              text: "退訂",
              at: LIVE,
            }),
          );
          // (b) Legacy row whose history holds "STOP." (imported, so not opted out by ingest).
          const legacy = "synthetic-clear-2";
          await ingest(
            liveEvent({
              messageId: "synthetic-clear-2a",
              member: legacy,
              phone: "85291250002",
              text: "STOP.",
              at: LIVE - 20,
            }),
            "history_import",
          );
          await ingest(
            liveEvent({
              messageId: "synthetic-clear-2b",
              member: legacy,
              phone: "85291250002",
              text: "唔要",
              at: LIVE,
            }),
          );
          await stampLegacy(legacy);
          // (c) Staff-recorded 拒收推廣 (opted_out_at = now(), microsecond precision).
          const staff = "synthetic-clear-3";
          await ingest(
            liveEvent({
              messageId: "synthetic-clear-3a",
              member: staff,
              phone: "85291250003",
              text: "你好",
              at: LIVE,
            }),
          );
          await setWhatsappMarketingConsent(
            {
              contactId: (await contact(staff)).id,
              optedIn: false,
              evidenceSource: "customer_opt_out",
              evidenceRef: "synthetic-call-1",
            },
            manager,
          );
          for (const member of [live, legacy, staff]) {
            const before = await fullContact(member);
            assert.equal(before.opted_out_whatsapp, true, member);
            await rejectsWith(
              clearAccidentalOptOut(
                {
                  contactId: before.id,
                  reason,
                  expectedOptedOutAt: await version(before.id),
                },
                manager,
              ),
              409,
              "OPT_OUT_GENUINE_USE_CONSENT",
            );
            assert.deepEqual(await fullContact(member), before, member);
            assert.equal((await audits(before.id, "contact.whatsapp_opt_out_cleared")).length, 0);
          }
        },
      );

      await t.test(
        "clearAccidentalOptOut clears a legacy false positive, keeps the evidence and writes one audit row",
        async () => {
          const member = "synthetic-clear-4";
          await ingest(
            liveEvent({
              messageId: "synthetic-clear-4a",
              member,
              phone: "85291250004",
              text: "唔要",
              at: LIVE,
            }),
          );
          await stampLegacy(member);
          const before = await fullContact(member);
          assert.equal(before.opted_out_source, "legacy");
          const result = await clearAccidentalOptOut(
            {
              contactId: before.id,
              reason: `  ${reason}  `,
              expectedOptedOutAt: await version(before.id),
            },
            manager,
          );
          assert.deepEqual(result, { ok: true, contactId: before.id, cleared: true });
          const after = await fullContact(member);
          assert.equal(after.opted_out_whatsapp, false);
          for (const column of [
            "opted_out_at",
            "opted_out_message_id",
            "opted_out_text",
            "opted_out_source",
            "opt_in_whatsapp",
          ])
            assert.deepEqual(after[column], before[column], column);
          assert.notEqual(after.opted_out_cleared_at, null);
          assert.equal(after.opted_out_cleared_by, MANAGER);
          const rows = await audits(before.id, "contact.whatsapp_opt_out_cleared");
          assert.equal(rows.length, 1);
          assert.equal(rows[0].actor_id, MANAGER);
          assert.equal(rows[0].metadata.reason, reason);
          assert.equal(rows[0].metadata.optedOutSource, "legacy");
          assert.equal(
            new Date(rows[0].metadata.optedOutAt).getTime(),
            before.opted_out_at.getTime(),
          );
          assert.equal(rows[0].metadata.optedOutMessageId, null);
          assert.equal(rows[0].metadata.optedOutText, null);
        },
      );

      await t.test("clear is idempotent", async () => {
        const before = await fullContact("synthetic-clear-4");
        const again = await clearAccidentalOptOut(
          { contactId: before.id, reason, expectedOptedOutAt: await version(before.id) },
          manager,
        );
        assert.deepEqual(again, { ok: true, contactId: before.id, cleared: false });
        assert.deepEqual(await fullContact("synthetic-clear-4"), before);
        assert.equal((await audits(before.id, "contact.whatsapp_opt_out_cleared")).length, 1);
      });

      await t.test(
        "the opt-out version round-trips through readOptOutEvidence at microsecond precision",
        async () => {
          const member = "synthetic-clear-7";
          await ingest(
            liveEvent({
              messageId: "synthetic-clear-7a",
              member,
              phone: "85291250007",
              text: "唔要",
              at: LIVE,
            }),
          );
          await stampLegacy(member);
          const stamped = "2026-10-01T01:02:03.456789Z";
          const row = await contact(member);
          await query("UPDATE crm_contacts SET opted_out_at=$2::timestamptz WHERE id=$1", [
            row.id,
            stamped,
          ]);
          const evidence = await readOptOutEvidence(row.id);
          assert.equal(evidence.optedOut, true);
          assert.equal(evidence.optedOutVersion, stamped);
          assert.equal(evidence.optedOutSource, "legacy");
          assert.equal(await readOptOutEvidence(id(98)), null);
          // One microsecond off, or the millisecond ISO a Date would give, is not this version.
          await rejectsWith(
            clearAccidentalOptOut(
              { contactId: row.id, reason, expectedOptedOutAt: "2026-10-01T01:02:03.456788Z" },
              manager,
            ),
            409,
            "OPT_OUT_CHANGED",
          );
          await rejectsWith(
            clearAccidentalOptOut(
              { contactId: row.id, reason, expectedOptedOutAt: "2026-10-01T01:02:03.456Z" },
              manager,
            ),
            400,
          );
          assert.equal((await audits(row.id, "contact.whatsapp_opt_out_cleared")).length, 0);
          assert.deepEqual(
            await clearAccidentalOptOut(
              { contactId: row.id, reason, expectedOptedOutAt: evidence.optedOutVersion },
              manager,
            ),
            { ok: true, contactId: row.id, cleared: true },
          );
          const after = await readOptOutEvidence(row.id);
          assert.equal(after.optedOut, false);
          assert.equal(after.optedOutVersion, stamped);
          assert.equal(after.optedOutClearedBy, MANAGER);
        },
      );

      await t.test("a stale clear (expectedOptedOutAt mismatch) changes nothing", async () => {
        const member = "synthetic-clear-5";
        const phone = "85291250005";
        await ingest(
          liveEvent({ messageId: "synthetic-clear-5a", member, phone, text: "唔要", at: LIVE }),
        );
        await stampLegacy(member);
        const seen = await version((await fullContact(member)).id);
        // A new opt-out lands after the manager loaded the detail.
        await ingest(
          liveEvent({ messageId: "synthetic-clear-5b", member, phone, text: "退訂", at: LIVE + 5 }),
        );
        const before = await fullContact(member);
        assert.notEqual(await version(before.id), seen);
        await rejectsWith(
          clearAccidentalOptOut(
            { contactId: before.id, reason, expectedOptedOutAt: seen },
            manager,
          ),
          409,
          "OPT_OUT_CHANGED",
        );
        assert.deepEqual(await fullContact(member), before);
        assert.equal((await audits(before.id, "contact.whatsapp_opt_out_cleared")).length, 0);
      });

      await t.test(
        "approval gate: agents, viewers and inactive managers cannot clear",
        async () => {
          const member = "synthetic-clear-6";
          await ingest(
            liveEvent({
              messageId: "synthetic-clear-6a",
              member,
              phone: "85291250006",
              text: "唔要",
              at: LIVE,
            }),
          );
          await stampLegacy(member);
          const before = await fullContact(member);
          for (const actor of [
            { staffId: AGENT, roles: ["agent"] },
            { staffId: VIEWER, roles: ["viewer"] },
            { staffId: INACTIVE_MANAGER, roles: ["manager"] },
          ])
            await assert.rejects(
              clearAccidentalOptOut(
                {
                  contactId: before.id,
                  reason,
                  expectedOptedOutAt: await version(before.id),
                },
                actor,
              ),
              (error) => error instanceof Response && error.status === 403,
            );
          assert.deepEqual(await fullContact(member), before);
          assert.equal((await audits(before.id, "contact.whatsapp_opt_out_cleared")).length, 0);
        },
      );

      const { readOptOutNearMiss, dismissOptOutNearMiss } =
        await import("../neon/whatsapp-opt-out-near-miss.server.ts");
      const messageUuid = async (external) =>
        (
          await query("SELECT id FROM whatsapp_messages WHERE external_message_id=$1", [external])
        )[0].id;
      const DISMISSED = "contact.whatsapp_opt_out_near_miss_dismissed";

      await t.test(
        "a near-miss never changes opted_out_whatsapp, and a dismissal hides only messages up to the dismissed one",
        async () => {
          const member = "synthetic-near-1";
          const phone = "85291260001";
          await ingest(
            liveEvent({
              messageId: "synthetic-near-1a",
              member,
              phone,
              text: "我要退訂",
              at: LIVE,
            }),
          );
          const conv = await conversation(member);
          await assignTo([conv.id], MANAGER);
          const row = await contact(member);
          const input = { conversationId: conv.id, contactId: row.id };
          const first = await readOptOutNearMiss(input);
          assert.equal(first.messageId, await messageUuid("synthetic-near-1a"));
          assert.equal(first.text, "我要退訂");
          assert.equal(first.at, new Date(LIVE * 1000).toISOString());
          assert.equal(row.opted_out_whatsapp, false);
          assertNoEvidence(row);
          assert.deepEqual(
            await dismissOptOutNearMiss(
              { ...input, messageId: first.messageId, reason: "客戶只是問價" },
              manager,
            ),
            { ok: true, dismissed: true },
          );
          const rows = await audits(row.id, DISMISSED);
          assert.equal(rows.length, 1);
          assert.equal(rows[0].metadata.messageId, first.messageId);
          assert.equal(rows[0].metadata.conversationId, conv.id);
          assert.equal(rows[0].metadata.text, "我要退訂");
          assert.equal(rows[0].metadata.reason, "客戶只是問價");
          assert.equal(new Date(rows[0].metadata.messageAt).toISOString(), first.at);
          assert.equal(await readOptOutNearMiss(input), null);
          await ingest(
            liveEvent({
              messageId: "synthetic-near-1b",
              member,
              phone,
              text: "STOP please",
              at: LIVE + 2,
            }),
          );
          const second = await readOptOutNearMiss(input);
          assert.equal(second.messageId, await messageUuid("synthetic-near-1b"));
          await ingest(
            liveEvent({
              messageId: "synthetic-near-1c",
              member,
              phone,
              text: "Can I stop by?",
              at: LIVE + 3,
            }),
          );
          assert.deepEqual(await readOptOutNearMiss(input), second);
          const after = await contact(member);
          assert.equal(after.opted_out_whatsapp, false);
          assertNoEvidence(after);
        },
      );

      await t.test(
        "near-miss confirm through the consent dialog opts out with that message as evidence",
        async () => {
          const { setWhatsappMarketingConsent } =
            await import("../neon/whatsapp-consent.server.ts");
          const member = "synthetic-near-2";
          await ingest(
            liveEvent({
              messageId: "synthetic-near-2a",
              member,
              phone: "85291260002",
              text: "我要退訂",
              at: LIVE,
            }),
          );
          const conv = await conversation(member);
          const row = await contact(member);
          const input = { conversationId: conv.id, contactId: row.id };
          const flagged = await readOptOutNearMiss(input);
          assert.ok(flagged);
          await setWhatsappMarketingConsent(
            {
              contactId: row.id,
              optedIn: false,
              evidenceSource: "customer_opt_out",
              evidenceRef: `near-miss:${flagged.messageId}`,
            },
            manager,
          );
          const after = await contact(member);
          assert.equal(after.opted_out_whatsapp, true);
          assert.equal(after.opted_out_text, "我要退訂");
          assert.equal(after.opted_out_source, "staff_recorded");
          const consent = await audits(row.id, "contact.marketing_consent");
          assert.equal(consent.length, 1);
          assert.equal(consent[0].metadata.trigger, "near_miss");
          assert.equal(await readOptOutNearMiss(input), null);
          const before = sends;
          assert.equal((await dispatch(conv.id, "template")).state, "cancelled");
          assert.equal(sends, before);
        },
      );

      await t.test(
        "a confirmed stop on an opted-out but reopened contact starts a new episode and re-blocks text",
        async () => {
          const { setWhatsappMarketingConsent } =
            await import("../neon/whatsapp-consent.server.ts");
          const member = "synthetic-near-4";
          const phone = "85291260004";
          await ingest(
            liveEvent({ messageId: "synthetic-near-4a", member, phone, text: "退訂", at: LIVE }),
          );
          await ingest(
            liveEvent({
              messageId: "synthetic-near-4b",
              member,
              phone,
              text: "你好",
              at: LIVE + 1,
            }),
          );
          await ingest(
            liveEvent({
              messageId: "synthetic-near-4c",
              member,
              phone,
              text: "STOP please",
              at: LIVE + 2,
            }),
          );
          const conv = await conversation(member);
          const row = await contact(member);
          assert.equal(row.opted_out_whatsapp, true);
          assert.equal(row.opted_out_at.toISOString(), iso(LIVE));
          const before = sends;
          assert.equal((await dispatch(conv.id, "text")).state, "accepted", "reopened");
          const input = { conversationId: conv.id, contactId: row.id };
          const flagged = await readOptOutNearMiss(input);
          assert.equal(flagged.messageId, await messageUuid("synthetic-near-4c"));
          const [{ now: confirmedFrom }] = await query("SELECT now() AS now");
          await setWhatsappMarketingConsent(
            {
              contactId: row.id,
              optedIn: false,
              evidenceSource: "customer_opt_out",
              evidenceRef: `near-miss:${flagged.messageId}`,
            },
            manager,
          );
          const after = await contact(member);
          assert.equal(after.opted_out_whatsapp, true);
          assert.ok(after.opted_out_at >= confirmedFrom, "a new episode starts at the confirm");
          assert.ok(after.opted_out_at > conv.last_inbound_at);
          assert.equal(after.opted_out_source, "staff_recorded");
          assert.equal(after.opted_out_message_id, "synthetic-near-4c");
          assert.equal(after.opted_out_text, "STOP please");
          assert.equal(after.opted_out_cleared_at, null);
          assert.equal(await readOptOutNearMiss(input), null);
          assert.equal((await dispatch(conv.id, "text")).state, "cancelled");
          assert.equal(sends, before + 1);
        },
      );

      await t.test(
        "near-miss dismiss: idempotent, wrong-recipient and approval gates",
        async () => {
          const member = "synthetic-near-3";
          const phone = "85291260003";
          await ingest(
            liveEvent({
              messageId: "synthetic-near-3a",
              member,
              phone,
              text: "唔好再send嘢俾我",
              at: LIVE,
            }),
          );
          await ingest(
            liveEvent({
              messageId: "synthetic-near-3b",
              member,
              phone,
              text: "STOP please",
              at: LIVE + 1,
              channel: CHANNEL_B,
            }),
          );
          await ingest(
            liveEvent({
              messageId: "synthetic-near-3c",
              member: "synthetic-near-3-other",
              phone: "85291260093",
              text: "我要退訂",
              at: LIVE,
            }),
          );
          const conv = await conversation(member);
          const otherChannel = await conversation(member, CHANNEL_B);
          await assignTo([conv.id, otherChannel.id], MANAGER);
          const row = await contact(member);
          const input = { conversationId: conv.id, contactId: row.id };
          const flagged = await readOptOutNearMiss(input);
          assert.equal(flagged.messageId, await messageUuid("synthetic-near-3a"));
          // Wrong recipient: another contact's message, and this contact's message on another conversation.
          for (const messageId of [
            await messageUuid("synthetic-near-3c"),
            await messageUuid("synthetic-near-3b"),
          ])
            await assert.rejects(
              dismissOptOutNearMiss({ ...input, messageId }, manager),
              (error) => error instanceof Response && error.status === 404,
            );
          assert.equal((await audits(row.id, DISMISSED)).length, 0);
          // Approval gates.
          for (const actor of [
            { staffId: AGENT, roles: ["agent"] },
            { staffId: VIEWER, roles: ["viewer"] },
            { staffId: INACTIVE_MANAGER, roles: ["manager"] },
          ])
            await assert.rejects(
              dismissOptOutNearMiss({ ...input, messageId: flagged.messageId }, actor),
              (error) => error instanceof Response && error.status === 403,
            );
          assert.equal((await audits(row.id, DISMISSED)).length, 0);
          // Only a real near-miss can be dismissed: this contact's ordinary message is refused.
          await ingest(
            liveEvent({
              messageId: "synthetic-near-3d",
              member,
              phone,
              text: "你好，想約睇樓",
              at: LIVE + 2,
            }),
          );
          await rejectsWith(
            dismissOptOutNearMiss(
              { ...input, messageId: await messageUuid("synthetic-near-3d") },
              manager,
            ),
            404,
            "NEAR_MISS_MESSAGE_NOT_FOUND",
          );
          // A manager with no branch: whatever wa_can_read_conversation answers decides. Today
          // (branch-scoped managers) it is false and dismiss is a 404 with no audit; once #226
          // makes manager reads org-wide it is true and the dismissal is recorded under them.
          await query(
            "INSERT INTO staff_users(id,auth_user_id,name_zh,active) VALUES($1,'synthetic-optout-branchless','合成無分行經理',true)",
            [id(66)],
          );
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [id(66)]);
          const [{ readable: branchlessReads }] = await query(
            "SELECT wa_can_read_conversation($1,$2) AS readable",
            [id(66), conv.id],
          );
          const branchlessDismiss = () =>
            dismissOptOutNearMiss(
              { ...input, messageId: flagged.messageId },
              { staffId: id(66), roles: ["manager"] },
            );
          if (!branchlessReads) {
            await rejectsWith(branchlessDismiss(), 404, "NEAR_MISS_MESSAGE_NOT_FOUND");
            assert.equal((await audits(row.id, DISMISSED)).length, 0);
          } else {
            assert.deepEqual(await branchlessDismiss(), { ok: true, dismissed: true });
            const recorded = await audits(row.id, DISMISSED);
            assert.equal(recorded.length, 1);
            assert.equal(recorded[0].actor_id, id(66));
            assert.equal(recorded[0].metadata.messageId, flagged.messageId);
          }
          // Idempotent: one audit row per message, whoever dismissed it first.
          const dismiss = () =>
            dismissOptOutNearMiss({ ...input, messageId: flagged.messageId }, manager);
          assert.deepEqual(await dismiss(), { ok: true, dismissed: !branchlessReads });
          assert.deepEqual(await dismiss(), { ok: true, dismissed: false });
          assert.equal((await audits(row.id, DISMISSED)).length, 1);
          assert.equal(await readOptOutNearMiss(input), null);
          // The other conversation's near-miss is still flagged there.
          assert.equal(
            (await readOptOutNearMiss({ conversationId: otherChannel.id, contactId: row.id }))
              .messageId,
            await messageUuid("synthetic-near-3b"),
          );
          const source = readFileSync(
            new URL("../neon/whatsapp-opt-out-near-miss.server.ts", import.meta.url),
            "utf8",
          );
          assert.doesNotMatch(source, /UPDATE\s+crm_contacts/i);
          const after = await contact(member);
          assert.equal(after.opted_out_whatsapp, false);
          assertNoEvidence(after);
        },
      );

      await t.test(
        "a history-imported exact 退訂 is flagged for review on a not-opted-out contact, never opts out",
        async () => {
          const member = "synthetic-near-5";
          const phone = "85291260005";
          await ingest(
            liveEvent({ messageId: "synthetic-near-5a", member, phone, text: "你好", at: LIVE }),
          );
          await ingest(
            liveEvent({
              messageId: "synthetic-near-5b",
              member,
              phone,
              text: "退訂",
              at: LIVE + 1,
            }),
            "history_import",
          );
          const conv = await conversation(member);
          await assignTo([conv.id], MANAGER);
          const row = await contact(member);
          assert.equal(row.opted_out_whatsapp, false);
          assertNoEvidence(row);
          const input = { conversationId: conv.id, contactId: row.id };
          const snapshot = await fullContact(member);
          const flagged = await readOptOutNearMiss(input);
          assert.equal(flagged.messageId, await messageUuid("synthetic-near-5b"));
          assert.equal(flagged.text, "退訂");
          // The read never writes: the flag and the evidence stay untouched (D4: never from history).
          assert.deepEqual(await fullContact(member), snapshot);
          const after = await contact(member);
          assert.equal(after.opted_out_whatsapp, false);
          assertNoEvidence(after);
          // The detail exposes it through the same near-miss field.
          const { fetchAdminConversation } = await import("../neon/admin-data.server.ts");
          assert.equal(
            (await fetchAdminConversation(conv.id, manager, false)).opt_out_near_miss.messageId,
            flagged.messageId,
          );
          // Approval gate, then a manager can dismiss it like any near-miss (idempotent).
          await assert.rejects(
            dismissOptOutNearMiss(
              { ...input, messageId: flagged.messageId },
              {
                staffId: AGENT,
                roles: ["agent"],
              },
            ),
            (error) => error instanceof Response && error.status === 403,
          );
          const dismiss = () =>
            dismissOptOutNearMiss({ ...input, messageId: flagged.messageId }, manager);
          assert.deepEqual(await dismiss(), { ok: true, dismissed: true });
          assert.deepEqual(await dismiss(), { ok: true, dismissed: false });
          assert.equal((await audits(row.id, DISMISSED)).length, 1);
          assert.equal(await readOptOutNearMiss(input), null);
          const final = await contact(member);
          assert.equal(final.opted_out_whatsapp, false);
          assertNoEvidence(final);

          // Already opted out: a later exact word is not flagged again (the badge already shows).
          const optedOut = "synthetic-near-6";
          await ingest(
            liveEvent({
              messageId: "synthetic-near-6a",
              member: optedOut,
              phone: "85291260006",
              text: "退訂",
              at: LIVE,
            }),
          );
          await ingest(
            liveEvent({
              messageId: "synthetic-near-6b",
              member: optedOut,
              phone: "85291260006",
              text: "STOP",
              at: LIVE + 1,
            }),
            "history_import",
          );
          const optedConv = await conversation(optedOut);
          const optedRow = await contact(optedOut);
          assert.equal(optedRow.opted_out_whatsapp, true);
          assert.equal(optedRow.opted_out_message_id, "synthetic-near-6a");
          assert.equal(
            await readOptOutNearMiss({ conversationId: optedConv.id, contactId: optedRow.id }),
            null,
          );
        },
      );

      // FX-08 Task 5: the inbox detail read. Evidence is for every reader; the unknown send and
      // the resolve/clear capability flags are managers only.
      await t.test(
        "fetchAdminConversation exposes evidence to all readers and unknown_outbound to managers only",
        async () => {
          const { fetchAdminConversation } = await import("../neon/admin-data.server.ts");
          const agent = { staffId: AGENT, roles: ["agent"] };
          // 1. A genuine opt-out with an old unconfirmed send.
          await ingest(
            liveEvent({
              messageId: "synthetic-detail-1a",
              member: "synthetic-detail-1",
              phone: "85291270001",
              text: "退訂",
              at: LIVE,
            }),
          );
          const conv = await conversation("synthetic-detail-1");
          await assignTo([conv.id], AGENT);
          const old = await enqueueOutboundIntent(
            {
              requestId: randomUUID(),
              conversationId: conv.id,
              kind: "text",
              payload: { text: "合成回覆" },
            },
            ADMIN,
            null,
          );
          await query(
            "UPDATE whatsapp_outbound_intents SET state='unknown',dispatch_started_at=now()-interval '20 minutes',error='WOZTELL_DELIVERY_UNKNOWN' WHERE id=$1",
            [old.id],
          );
          const asManager = await fetchAdminConversation(conv.id, manager, false);
          assert.equal(asManager.opted_out_whatsapp, true);
          assert.equal(asManager.opted_out_text, "退訂");
          assert.equal(asManager.opted_out_source, "customer_message");
          assert.match(
            asManager.opted_out_version,
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
          );
          assert.equal(asManager.opt_out_near_miss, null);
          assert.equal(asManager.can_clear_opt_out, true);
          assert.equal(asManager.can_resolve_unknown_outbound, true);
          assert.equal(asManager.unknown_outbound.id, old.id);
          assert.equal(asManager.unknown_outbound.kind, "text");
          assert.equal(asManager.unknown_outbound.actor_type, "staff");
          assert.equal(asManager.unknown_outbound.resolvable, true);
          const asAgent = await fetchAdminConversation(conv.id, agent, false);
          assert.equal(asAgent.opted_out_whatsapp, true);
          assert.equal(asAgent.opted_out_text, "退訂");
          assert.equal(asAgent.opted_out_source, "customer_message");
          assert.equal(asAgent.can_clear_opt_out, false);
          assert.equal(asAgent.can_resolve_unknown_outbound, false);
          assert.equal(asAgent.unknown_outbound, null);
          // 2. An unconfirmed send younger than 15 minutes is listed but not yet resolvable.
          await query(
            "UPDATE whatsapp_outbound_intents SET dispatch_started_at=now()-interval '2 minutes' WHERE id=$1",
            [old.id],
          );
          assert.equal(
            (await fetchAdminConversation(conv.id, manager, false)).unknown_outbound.resolvable,
            false,
          );
          // 3. A near-miss is read for every reader and never opts the contact out.
          await ingest(
            liveEvent({
              messageId: "synthetic-detail-2a",
              member: "synthetic-detail-2",
              phone: "85291270002",
              text: "我要退訂",
              at: LIVE,
            }),
          );
          const nearConv = await conversation("synthetic-detail-2");
          await assignTo([nearConv.id], AGENT);
          for (const actor of [manager, agent]) {
            const detail = await fetchAdminConversation(nearConv.id, actor, false);
            assert.equal(detail.opted_out_whatsapp, false);
            assert.equal(detail.opted_out_source, null);
            assert.equal(detail.opt_out_near_miss.text, "我要退訂");
            assert.equal(
              detail.opt_out_near_miss.messageId,
              await messageUuid("synthetic-detail-2a"),
            );
            assert.equal(detail.unknown_outbound, null);
          }
        },
      );
    });
    assert.equal(network.mock.callCount(), 0);
  } finally {
    network.mock.restore();
    if (previousWake === undefined) delete process.env.OPS_EVENT_WAKE_ENABLED;
    else process.env.OPS_EVENT_WAKE_ENABLED = previousWake;
  }
});
