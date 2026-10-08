import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

// FX-12 contact identity on owned Postgres. One container for the whole file:
// Tasks 2-4 add subtests below. Synthetic data only (HK fictional range
// 5555 0xxx). Nothing talks to WozTell, Neon production or a model: fetch
// throws and the ops wake is disabled.

const id = (n) => `7c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
const MANAGER = id(2);
const AGENT = id(3);

// Today's two-format match, verbatim from main bfbfd618 (woztell-ingest.server.ts:175-177).
const oldMatchSql = (column, param) =>
  `(${column}=${param} OR (length(${param}::text)=11 AND left(${param}::text,3)='852'
    AND ${column}=right(${param}::text,8)))`;

test("FX-12 contact identity on owned Postgres", { timeout: 300000 }, async (t) => {
  const previousWake = process.env.OPS_WAKE_URL;
  const previousEventWake = process.env.OPS_EVENT_WAKE_ENABLED;
  process.env.OPS_WAKE_URL = "";
  delete process.env.OPS_EVENT_WAKE_ENABLED;
  const network = mock.method(globalThis, "fetch", () => {
    throw new Error("FX-12 owned test: network is disabled");
  });
  try {
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const { phoneMatchSql } = await import("../phone.js");
      const { marketingIdentitySafeSql, campaignRecipientPrimarySql } =
        await import("./phone-identity.ts");
      const server = await import("./admin-data.server.ts");
      const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");

      for (const [staffId, role] of [
        [ADMIN, "admin"],
        [MANAGER, "manager"],
        [AGENT, "agent"],
      ]) {
        await query(
          "INSERT INTO staff_users(id,auth_user_id,email,name_zh,active) VALUES($1,$2,$3,$4,true)",
          [
            staffId,
            "synthetic-fx12-" + staffId,
            "fx12-" + staffId.slice(-2) + "@example.invalid",
            "測試同事" + staffId.slice(-1),
          ],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staffId, role]);
      }

      const contactRow = (contactId) =>
        query(
          "SELECT id,name,normalized_phone,opt_in_whatsapp,whatsapp_member_id FROM crm_contacts WHERE id=$1",
          [contactId],
        ).then((rows) => rows[0]);
      const contactsWithPhoneLike = (digits) =>
        query("SELECT id FROM crm_contacts WHERE normalized_phone LIKE '%' || $1 ORDER BY id", [
          digits,
        ]).then((rows) => rows.map((row) => row.id));

      await t.test(
        "phoneMatchSql matches every pair today's match matched, plus 00852",
        async () => {
          const stored = [
            "55550001",
            "85255550001",
            "0085255550001",
            "442079460958",
            "85255550002",
          ];
          const values = stored.map((_, index) => `($${index + 2}::text)`).join(",");
          const matches = async (build, param) =>
            (
              await query(
                `SELECT v.p FROM (VALUES ${values}) v(p) WHERE ${build("v.p", "$1")} ORDER BY v.p`,
                [param, ...stored],
              )
            ).map((row) => row.p);
          for (const param of ["85255550001", "442079460958", "55550001", "0085255550001"]) {
            const before = await matches(oldMatchSql, param);
            const after = await matches(phoneMatchSql, param);
            for (const value of before) assert.ok(after.includes(value), param + " lost " + value);
            const added = after.filter((value) => !before.includes(value));
            assert.ok(
              added.every((value) => value === "00" + param),
              param + " added more than the 00852 spelling: " + added.join(","),
            );
          }
          assert.deepEqual(await matches(phoneMatchSql, "85255550001"), [
            "0085255550001",
            "55550001",
            "85255550001",
          ]);
          assert.deepEqual(await matches(phoneMatchSql, "442079460958"), ["442079460958"]);
          assert.deepEqual(await matches(phoneMatchSql, null), []);
        },
      );

      await t.test("marketing identity sees an opted-out peer stored as 00852", async () => {
        const W = id(100);
        const X = id(101);
        await query(
          `INSERT INTO crm_contacts(id,name,normalized_phone,source,opt_in_whatsapp,opted_out_whatsapp)
           VALUES($1,'Synthetic FX12 W','85255550010','whatsapp',false,true),
                 ($2,'Synthetic FX12 X','0085255550010','website',true,false)`,
          [W, X],
        );
        const [safe] = await query(
          `SELECT ${marketingIdentitySafeSql("c")} AS safe FROM crm_contacts c WHERE c.id=$1`,
          [X],
        );
        assert.equal(safe.safe, false);
        // The 8-digit legacy spelling stays linked too (today's behaviour).
        const L = id(102);
        await query(
          `INSERT INTO crm_contacts(id,name,normalized_phone,source,opt_in_whatsapp)
           VALUES($1,'Synthetic FX12 L','55550010','website',true)`,
          [L],
        );
        const [legacy] = await query(
          `SELECT ${marketingIdentitySafeSql("c")} AS safe FROM crm_contacts c WHERE c.id=$1`,
          [L],
        );
        assert.equal(legacy.safe, false);

        const [template] = await query(
          "INSERT INTO whatsapp_templates(element_name,status) VALUES('fx12_owned','active') RETURNING id",
        );
        const [audience] = await query(
          "INSERT INTO whatsapp_audiences(name,created_by) VALUES('FX12 audience',$1) RETURNING id",
          [ADMIN],
        );
        const [campaign] = await query(
          "INSERT INTO whatsapp_campaigns(name,template_id,audience_id,status,created_by) VALUES('FX12 campaign',$1,$2,'review',$3) RETURNING id",
          [template.id, audience.id, ADMIN],
        );
        const [rw] = await query(
          "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id,status) VALUES($1,$2,'sent') RETURNING id",
          [campaign.id, W],
        );
        const [rx] = await query(
          "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
          [campaign.id, X],
        );
        const primary = async (recipientId) =>
          (
            await query(
              `SELECT ${campaignRecipientPrimarySql("r", "c")} AS primary
               FROM whatsapp_campaign_recipients r JOIN crm_contacts c ON c.id=r.contact_id
               WHERE r.id=$1`,
              [recipientId],
            )
          )[0].primary;
        assert.equal(await primary(rx.id), false, "X and W are one phone");
        assert.equal(await primary(rw.id), true);
      });

      await t.test(
        "a website enquiry typed as 00852 joins the existing contact without changing consent or name",
        async () => {
          const existing = id(200);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,source,opt_in_whatsapp)
             VALUES($1,'陳太','85255550020','whatsapp',false)`,
            [existing],
          );
          await server.createWebsiteInquiry({
            submissionId: "7c000000-0000-4000-8000-000000000201",
            name: "Chan",
            phone: "00852 5555 0020",
            consentWhatsapp: true,
          });
          assert.deepEqual(await contactsWithPhoneLike("55550020"), [existing]);
          const row = await contactRow(existing);
          assert.equal(row.name, "陳太");
          assert.equal(row.opt_in_whatsapp, false);
          assert.equal(row.normalized_phone, "85255550020");
          const leads = await query(
            "SELECT contact_id FROM crm_leads WHERE contact_id=$1 AND source='website'",
            [existing],
          );
          assert.equal(leads.length, 1);
        },
      );

      await t.test(
        "two contacts holding the 8-digit and 852 forms: website and ingest pick the same contact as today",
        async () => {
          const legacy = id(300);
          const canonical = id(301);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,source)
             VALUES($1,'Synthetic FX12 legacy','55550030','website'),
                   ($2,'Synthetic FX12 canonical','85255550030','website')`,
            [legacy, canonical],
          );
          // Today: the exact canonical spelling wins over the 8-digit row.
          await server.createWebsiteInquiry({
            submissionId: "7c000000-0000-4000-8000-000000000302",
            name: "Synthetic",
            phone: "5555 0030",
          });
          const websiteLeads = await query(
            "SELECT contact_id FROM crm_leads WHERE contact_id = ANY($1::uuid[])",
            [[legacy, canonical]],
          );
          assert.deepEqual(
            websiteLeads.map((row) => row.contact_id),
            [canonical],
          );
          const outcome = await ingestWoztellEvent(
            {
              direction: "inbound",
              externalMessageId: "synthetic-fx12-message-300",
              legacyExternalMessageId: null,
              fromPhone: "85255550030",
              toPhone: null,
              timestamp: new Date("2026-10-08T02:00:00.000Z"),
              messageType: "TEXT",
              text: "你好",
              woztellMemberId: "synthetic-fx12-member-300",
              channelId: "synthetic-fx12-channel",
              appId: "synthetic-fx12-app",
              memberName: null,
              payload: { type: "TEXT", eventType: "INBOUND", data: { text: "你好" } },
            },
            "live_webhook",
            undefined,
            { mode: "off" },
          );
          assert.equal(outcome.contactId, canonical);
          assert.deepEqual(await contactsWithPhoneLike("55550030"), [legacy, canonical]);
        },
      );

      await t.test(
        "an 8-digit legacy row still wins over a lower-id 00852 row, so the pick never moves",
        async () => {
          // The 00852 row has the LOWER id. Today it never matches, so today's pick is
          // the 8-digit row. The wider match must not move the pick to the 00852 row.
          const zeroZero = id(400);
          const legacy = id(401);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,source)
             VALUES($1,'Synthetic FX12 00852','0085255550040','website'),
                   ($2,'Synthetic FX12 legacy','55550040','website')`,
            [zeroZero, legacy],
          );
          await server.createWebsiteInquiry({
            submissionId: "7c000000-0000-4000-8000-000000000402",
            name: "Synthetic",
            phone: "5555 0040",
          });
          const websiteLeads = await query(
            "SELECT contact_id FROM crm_leads WHERE contact_id = ANY($1::uuid[])",
            [[zeroZero, legacy]],
          );
          assert.deepEqual(
            websiteLeads.map((row) => row.contact_id),
            [legacy],
          );
          const outcome = await ingestWoztellEvent(
            {
              direction: "inbound",
              externalMessageId: "synthetic-fx12-message-400",
              legacyExternalMessageId: null,
              fromPhone: "85255550040",
              toPhone: null,
              timestamp: new Date("2026-10-08T02:05:00.000Z"),
              messageType: "TEXT",
              text: "你好",
              woztellMemberId: "synthetic-fx12-member-400",
              channelId: "synthetic-fx12-channel",
              appId: "synthetic-fx12-app",
              memberName: null,
              payload: { type: "TEXT", eventType: "INBOUND", data: { text: "你好" } },
            },
            "live_webhook",
            undefined,
            { mode: "off" },
          );
          assert.equal(outcome.contactId, legacy);
          assert.deepEqual(await contactsWithPhoneLike("55550040"), [zeroZero, legacy]);
        },
      );

      await t.test("an inbound 852 message finds a contact stored only as 00852", async () => {
        const zeroZero = id(500);
        await query(
          `INSERT INTO crm_contacts(id,name,normalized_phone,source)
           VALUES($1,'Synthetic FX12 only 00852','0085255550050','website')`,
          [zeroZero],
        );
        const outcome = await ingestWoztellEvent(
          {
            direction: "inbound",
            externalMessageId: "synthetic-fx12-message-500",
            legacyExternalMessageId: null,
            fromPhone: "85255550050",
            toPhone: null,
            timestamp: new Date("2026-10-08T02:10:00.000Z"),
            messageType: "TEXT",
            text: "你好",
            woztellMemberId: "synthetic-fx12-member-500",
            channelId: "synthetic-fx12-channel",
            appId: "synthetic-fx12-app",
            memberName: null,
            payload: { type: "TEXT", eventType: "INBOUND", data: { text: "你好" } },
          },
          "live_webhook",
          undefined,
          { mode: "off" },
        );
        assert.equal(outcome.contactId, zeroZero);
        assert.deepEqual(await contactsWithPhoneLike("55550050"), [zeroZero]);
      });

      await t.test(
        "a website enquiry typed as (+852) joins the existing customer (fix round 1, I-2)",
        async () => {
          const existing = id(550);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,source,opt_in_whatsapp)
             VALUES($1,'陳生','85255550055','whatsapp',false)`,
            [existing],
          );
          await server.createWebsiteInquiry({
            submissionId: "7c000000-0000-4000-8000-000000000551",
            name: "Chan",
            phone: "(+852) 5555 0055",
            consentWhatsapp: true,
          });
          assert.deepEqual(await contactsWithPhoneLike("55550055"), [existing]);
          const phoneless = await query(
            "SELECT count(*)::int AS n FROM crm_contacts WHERE normalized_phone IS NULL AND phone=$1",
            ["(+852) 5555 0055"],
          );
          assert.equal(phoneless[0].n, 0, "no phoneless duplicate customer");
          const row = await contactRow(existing);
          assert.equal(row.name, "陳生");
          assert.equal(row.opt_in_whatsapp, false);
        },
      );

      // Campaign helpers for the fix-round-1 I-3 tests. Each test uses its own
      // contact source so its audience sees only its own synthetic contacts.
      let campaignSeq = 0;
      const seedCampaign = async (source) => {
        campaignSeq += 1;
        const [template] = await query(
          "INSERT INTO whatsapp_templates(element_name,status) VALUES($1,'active') RETURNING id",
          ["fx12_owned_" + campaignSeq],
        );
        const [audience] = await query(
          "INSERT INTO whatsapp_audiences(name,filters,created_by) VALUES($1,$2::jsonb,$3) RETURNING id",
          ["FX12 audience " + campaignSeq, JSON.stringify({ source }), ADMIN],
        );
        const [campaign] = await query(
          "INSERT INTO whatsapp_campaigns(name,template_id,audience_id,status,created_by) VALUES($1,$2,$3,'review',$4) RETURNING id",
          ["FX12 campaign " + campaignSeq, template.id, audience.id, ADMIN],
        );
        return campaign.id;
      };
      const admin = { staffId: ADMIN, authUserId: "synthetic-fx12-" + ADMIN, roles: ["admin"] };
      const queuedContacts = async (campaignId) =>
        (
          await query(
            "SELECT contact_id FROM whatsapp_campaign_recipients WHERE campaign_id=$1 AND status='queued' ORDER BY contact_id",
            [campaignId],
          )
        ).map((row) => row.contact_id);

      await t.test(
        "campaign dedupe keeps the WhatsApp contact over its lower-id 00852 twin (I-3)",
        async () => {
          const twin = id(600);
          const member = id(601);
          const optedOut = id(602);
          const optedOutTwin = id(603);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,whatsapp_member_id,source,opt_in_whatsapp,opted_out_whatsapp)
             VALUES($1,'Synthetic FX12 twin','0085255550060',NULL,'fx12-dedupe',true,false),
                   ($2,'Synthetic FX12 member','85255550060','synthetic-fx12-member-601','fx12-dedupe',true,false),
                   ($3,'Synthetic FX12 opted out','85255550061','synthetic-fx12-member-602','fx12-dedupe',false,true),
                   ($4,'Synthetic FX12 opted-out twin','0085255550061',NULL,'fx12-dedupe',true,false)`,
            [twin, member, optedOut, optedOutTwin],
          );
          const campaignId = await seedCampaign("fx12-dedupe");
          const result = await server.materializeCampaignRecipients(campaignId, admin);
          assert.equal(result.ok, true, JSON.stringify(result));
          // The member row wins; the opted-out number and its twin are both excluded.
          assert.deepEqual(await queuedContacts(campaignId), [member]);

          // Rows queued before the fix (both twins queued): only the member row is primary.
          const queuedBefore = await seedCampaign("fx12-dedupe-none");
          const [rTwin] = await query(
            "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
            [queuedBefore, twin],
          );
          const [rMember] = await query(
            "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
            [queuedBefore, member],
          );
          const primary = async (recipientId) =>
            (
              await query(
                `SELECT ${campaignRecipientPrimarySql("r", "c")} AS primary
                 FROM whatsapp_campaign_recipients r JOIN crm_contacts c ON c.id=r.contact_id
                 WHERE r.id=$1`,
                [recipientId],
              )
            )[0].primary;
          assert.equal(await primary(rMember.id), true, "member row is primary");
          assert.equal(await primary(rTwin.id), false, "00852 twin is not primary");
        },
      );

      await t.test(
        "an opted-in 852 contact is excluded when its 00852 twin never consented (Minor 10)",
        async () => {
          const consented = id(650);
          const notConsented = id(651);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,whatsapp_member_id,source,opt_in_whatsapp)
             VALUES($1,'Synthetic FX12 consented','85255550065','synthetic-fx12-member-650','whatsapp',true),
                   ($2,'Synthetic FX12 not consented','0085255550065',NULL,'website',false)`,
            [consented, notConsented],
          );
          const [row] = await query(
            `SELECT ${marketingIdentitySafeSql("c")} AS safe FROM crm_contacts c WHERE c.id=$1`,
            [consented],
          );
          assert.equal(row.safe, false);
        },
      );

      await t.test(
        "delivery sends a member-less legacy contact as 852 and never sends an unparseable phone raw (I-3, D-09)",
        async () => {
          const { deliverWoztellCampaign } = await import("../woztell/campaign-delivery.server.ts");
          const legacy = id(700);
          const zeroZero = id(701);
          const broken = id(702);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,source,opt_in_whatsapp)
             VALUES($1,'Synthetic FX12 legacy','55550070','website',true),
                   ($2,'Synthetic FX12 00852','0085255550071','website',true),
                   ($3,'Synthetic FX12 broken','12345','website',true)`,
            [legacy, zeroZero, broken],
          );
          const campaignId = await seedCampaign("fx12-delivery-none");
          for (const contactId of [legacy, zeroZero, broken]) {
            await query(
              "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2)",
              [campaignId, contactId],
            );
          }
          // Real contact rows from the owned database; the provider is a recorder.
          const recipientsFromDb = () =>
            query(
              `SELECT r.id, c.normalized_phone, c.whatsapp_member_id, c.opt_in_whatsapp,
                 c.opted_out_whatsapp, 'fx12' AS element_name, 'zh_HK' AS language_code,
                 '[]'::jsonb AS components
               FROM whatsapp_campaign_recipients r JOIN crm_contacts c ON c.id=r.contact_id
               WHERE r.campaign_id=$1 AND r.status='queued' ORDER BY c.id`,
              [campaignId],
            );
          let claimed = false;
          const sends = [];
          await deliverWoztellCampaign(campaignId, {
            isEnabled: () => true,
            claimRecipients: async () => {
              if (claimed) return [];
              claimed = true;
              return recipientsFromDb();
            },
            beginDispatch: async (_campaign, recipientId) =>
              (await recipientsFromDb()).find((row) => row.id === recipientId) ?? null,
            updateRecipient: async (recipientId, status, code) => {
              await query(
                "UPDATE whatsapp_campaign_recipients SET status=$2,error=$3 WHERE id=$1",
                [recipientId, status, code],
              );
            },
            hasPendingRecipients: async () => false,
            refreshStatus: async () => {},
            sendResponse: async ({ memberId }) => {
              sends.push(memberId);
              return { ok: true, status: 200, body: {} };
            },
          });
          assert.deepEqual(sends.sort(), ["85255550070", "85255550071"]);
          const [brokenRow] = await query(
            `SELECT r.status, r.error FROM whatsapp_campaign_recipients r
             WHERE r.campaign_id=$1 AND r.contact_id=$2`,
            [campaignId, broken],
          );
          assert.deepEqual(
            [brokenRow.status, brokenRow.error],
            ["failed", "WOZTELL_RECIPIENT_PHONE_INVALID"],
          );
        },
      );
    });
  } finally {
    network.mock.restore();
    if (previousWake === undefined) delete process.env.OPS_WAKE_URL;
    else process.env.OPS_WAKE_URL = previousWake;
    if (previousEventWake !== undefined) process.env.OPS_EVENT_WAKE_ENABLED = previousEventWake;
  }
});
