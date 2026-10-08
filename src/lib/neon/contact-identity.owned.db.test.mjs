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

      await t.test(
        "activity contact comes from the lead, never from the client (B-10)",
        async () => {
          const K = id(800);
          const Z = id(801);
          const L = id(802);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,source)
             VALUES($1,'Synthetic FX12 K','85255550080','website'),
                   ($2,'Synthetic FX12 Z','85255550081','website')`,
            [K, Z],
          );
          await query(
            "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,stage,intent) VALUES($1,$2,$3,'new','buyer')",
            [L, K, AGENT],
          );
          const agentActor = {
            staffId: AGENT,
            authUserId: "synthetic-fx12-" + AGENT,
            roles: ["agent"],
          };
          const base = {
            lead_id: L,
            activity_type: "note",
            body: "x",
            due_at: null,
            completed_at: null,
          };
          const forged = await server.createAdminLeadActivity(
            { ...base, contact_id: Z },
            agentActor,
          );
          const omitted = await server.createAdminLeadActivity(base, agentActor);
          const rows = await query("SELECT id,contact_id FROM crm_activities WHERE lead_id=$1", [
            L,
          ]);
          assert.equal(rows.length, 2);
          assert.deepEqual(rows.map((r) => r.id).sort(), [forged.id, omitted.id].sort());
          for (const row of rows) assert.equal(row.contact_id, K);
        },
      );

      await t.test(
        "a stale tab after a phone correction still files the note on the lead's current contact",
        async () => {
          const K = id(810);
          const K2 = id(811);
          const L = id(812);
          await query(
            `INSERT INTO crm_contacts(id,name,normalized_phone,source)
             VALUES($1,'Synthetic FX12 old','85255550082','website'),
                   ($2,'Synthetic FX12 corrected','85255550083','website')`,
            [K, K2],
          );
          await query(
            "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,stage,intent) VALUES($1,$2,$3,'new','buyer')",
            [L, K, AGENT],
          );
          await query("UPDATE crm_leads SET contact_id=$2, updated_at=now() WHERE id=$1", [L, K2]);
          const agentActor = {
            staffId: AGENT,
            authUserId: "synthetic-fx12-" + AGENT,
            roles: ["agent"],
          };
          const { id: activityId } = await server.createAdminLeadActivity(
            {
              lead_id: L,
              contact_id: K,
              activity_type: "note",
              body: "stale",
              due_at: null,
              completed_at: null,
            },
            agentActor,
          );
          const [row] = await query("SELECT contact_id FROM crm_activities WHERE id=$1", [
            activityId,
          ]);
          assert.equal(row.contact_id, K2);
        },
      );

      await t.test("agent scope is unchanged", async () => {
        const K = id(820);
        const L = id(821);
        await query(
          "INSERT INTO crm_contacts(id,name,normalized_phone,source) VALUES($1,'Synthetic FX12 scope','85255550084','website')",
          [K],
        );
        await query(
          "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,stage,intent) VALUES($1,$2,$3,'new','buyer')",
          [L, K, MANAGER],
        );
        const agentActor = {
          staffId: AGENT,
          authUserId: "synthetic-fx12-" + AGENT,
          roles: ["agent"],
        };
        await assert.rejects(
          server.createAdminLeadActivity(
            {
              lead_id: L,
              contact_id: K,
              activity_type: "note",
              body: "no",
              due_at: null,
              completed_at: null,
            },
            agentActor,
          ),
          (error) => error instanceof Response && error.status === 403,
        );
        const [{ n }] = await query(
          "SELECT count(*)::int AS n FROM crm_activities WHERE lead_id=$1",
          [L],
        );
        assert.equal(n, 0);
      });

      // ---- Task 4: the 「可能重複客戶」 / 「身分待核對」 list, resolution and reply gate ----
      const review = await import("./contact-identity-review.server.ts");
      const { readAdminPage } = await import("./admin-pagination.server.ts");
      const { enqueueOutboundIntent } = await import("../woztell/outbound-intent.server.ts");
      const actorFor = (staffId, role) => ({
        staffId,
        authUserId: "synthetic-fx12-" + staffId,
        email: null,
        name: null,
        roles: [role],
        bootstrap: false,
      });
      const managerActor = actorFor(MANAGER, "manager");
      const adminActor = actorFor(ADMIN, "admin");
      const agentActor = actorFor(AGENT, "agent");
      const CHANNEL = "synthetic-fx12-channel";
      let clock = Date.parse("2026-10-08T03:00:00.000Z");
      const inbound = ({ messageId, member, phone, text, name = null, origin = "live_webhook" }) =>
        ingestWoztellEvent(
          {
            direction: "inbound",
            externalMessageId: messageId,
            legacyExternalMessageId: null,
            fromPhone: phone,
            toPhone: null,
            timestamp: new Date((clock += 60000)),
            messageType: "TEXT",
            text,
            woztellMemberId: member,
            channelId: CHANNEL,
            appId: "synthetic-fx12-app",
            memberName: name,
            payload: {
              type: "TEXT",
              eventType: "INBOUND",
              data: { text },
              ...(name ? { memberExtra: { name } } : {}),
            },
          },
          origin,
          undefined,
          { mode: "off" },
        );
      const seed = (contactId, { phone = null, member = null, name = "合成客戶" } = {}) =>
        query(
          `INSERT INTO crm_contacts(id,name,phone,normalized_phone,whatsapp_member_id,source)
           VALUES($1,$2,$3,$3,$4,'whatsapp')`,
          [contactId, name, phone, member],
        );
      const one = async (sql, params = []) => (await query(sql, params))[0];
      const n = async (sql, params = []) => (await one(sql, params)).n;
      const reviewRow = (reviewId) =>
        one("SELECT * FROM crm_contact_identity_reviews WHERE id=$1", [reviewId]);
      const openReviewFor = (conversationId) =>
        one(
          "SELECT * FROM crm_contact_identity_reviews WHERE conversation_id=$1 AND status='open'",
          [conversationId],
        );
      const auditFor = (reviewId) =>
        query(
          "SELECT actor_id,action,subject_type,subject_id,metadata FROM audit_logs WHERE subject_id=$1",
          [reviewId],
        );
      // Review rows, audit metadata and the list never hold a raw phone or member id.
      const assertNoIdentity = (value) => {
        // Random UUIDs can contain "852…" by chance; they are ids, not phones.
        const text = JSON.stringify(value).replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
          "<id>",
        );
        assert.doesNotMatch(text, /5555|852\d|synthetic-fx12-t4/, text);
      };
      const rejectsStatus = async (promise, status, body) => {
        let error;
        await assert.rejects(
          promise.catch((caught) => {
            error = caught;
            throw caught;
          }),
        );
        assert.ok(error instanceof Response, String(error));
        assert.equal(error.status, status);
        if (body) assert.equal(await error.text(), body);
      };
      // Everything a resolution could touch, as one digest.
      const worldDigest = async () =>
        (
          await one(`SELECT md5(concat_ws('|',
            (SELECT string_agg(t::text,',' ORDER BY t.id) FROM crm_contact_identity_reviews t),
            (SELECT string_agg(t::text,',' ORDER BY t.id) FROM crm_contacts t),
            (SELECT string_agg(t::text,',' ORDER BY t.id) FROM crm_leads t),
            (SELECT string_agg(t::text,',' ORDER BY t.id) FROM whatsapp_conversations t),
            (SELECT string_agg(t::text,',' ORDER BY t.id) FROM whatsapp_messages t),
            (SELECT count(*) FROM audit_logs))) AS h`)
        ).h;

      // Case a (Task 3): X holds P and m1. A message from (P, m2) opens a review with
      // contact_a NULL (no member owner) and contact_b X.
      const X = id(900);
      const P = "85255550901";
      let caseA;
      const openCaseA = async () => {
        if (caseA) return caseA;
        await seed(X, { phone: P, member: "synthetic-fx12-t4-m1", name: "陳太" });
        const first = await inbound({
          messageId: "synthetic-fx12-t4-a-1",
          member: "synthetic-fx12-t4-m2",
          phone: P,
          text: "合成核對訊息一",
        });
        await inbound({
          messageId: "synthetic-fx12-t4-a-2",
          member: "synthetic-fx12-t4-m2",
          phone: P,
          text: "合成核對訊息二",
        });
        assert.equal(first.identityReview, true);
        const open = await openReviewFor(first.conversationId);
        assert.equal(open.contact_a, null);
        assert.equal(open.contact_b, X);
        caseA = { conversationId: first.conversationId, reviewId: open.id };
        return caseA;
      };

      await t.test("only managers and admins can list or resolve", async () => {
        const { reviewId } = await openCaseA();
        const before = await worldDigest();
        await rejectsStatus(review.listContactIdentityReviews({ status: "open" }, agentActor), 403);
        await rejectsStatus(
          review.resolveContactIdentityReview({ id: reviewId, action: "link_b" }, agentActor),
          403,
        );
        assert.equal(await worldDigest(), before);
        assert.equal((await server.getAdminAttentionCounts(agentActor)).identityReviewsOpen, 0);
        const open = await n(
          "SELECT count(*)::int AS n FROM crm_contact_identity_reviews WHERE status='open'",
        );
        assert.ok(open >= 1);
        assert.equal(
          (await server.getAdminAttentionCounts(managerActor)).identityReviewsOpen,
          open,
        );
        assert.equal((await server.getAdminAttentionCounts(adminActor)).identityReviewsOpen, open);

        const listed = await review.listContactIdentityReviews({ status: "open" }, managerActor);
        assert.equal(listed.openCount, open);
        const row = listed.rows.find((item) => item.id === reviewId);
        assert.ok(row);
        assert.equal(row.reason, "whatsapp_identity_conflict");
        assert.equal(row.a, null);
        assert.equal(row.b.id, X);
        assert.equal(row.b.name, "陳太");
        assert.equal(row.b.maskedPhone, "•••• 0901");
        assert.equal(row.b.hasWhatsapp, true);
        assert.equal(row.conversationId, caseA.conversationId);
        assert.equal(row.messageCount, 2);
        assertNoIdentity(listed);
      });

      await t.test(
        "link_b attaches the stored messages to B and opens B's first lead",
        async () => {
          const { conversationId, reviewId } = await openCaseA();
          assert.equal(
            await n("SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1", [X]),
            0,
          );
          const messagesBefore = await query(
            "SELECT id,text,created_at FROM whatsapp_messages WHERE conversation_id=$1 ORDER BY id",
            [conversationId],
          );
          assert.equal(messagesBefore.length, 2);
          const result = await review.resolveContactIdentityReview(
            { id: reviewId, action: "link_b", note: "合成備註" },
            managerActor,
          );
          assert.deepEqual(result, { ok: true, status: "linked", linkedContactId: X });

          const conversation = await one(
            "SELECT contact_id FROM whatsapp_conversations WHERE id=$1",
            [conversationId],
          );
          assert.equal(conversation.contact_id, X);
          // Reattached, not copied or lost.
          assert.deepEqual(
            await query(
              "SELECT id,text,created_at FROM whatsapp_messages WHERE conversation_id=$1 ORDER BY id",
              [conversationId],
            ),
            messagesBefore,
          );
          assert.equal(
            await n(
              "SELECT count(*)::int AS n FROM whatsapp_messages WHERE conversation_id=$1 AND contact_id IS DISTINCT FROM $2",
              [conversationId, X],
            ),
            0,
          );
          const x = await contactRow(X);
          assert.equal(x.whatsapp_member_id, "synthetic-fx12-t4-m1");
          assert.equal(x.normalized_phone, P);
          // FX-09 UPDATE path: X had no lead, so it gets exactly one.
          assert.equal(
            await n("SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1", [X]),
            1,
          );
          assert.equal(
            (await one("SELECT opted_out_whatsapp FROM crm_contacts WHERE id=$1", [X]))
              .opted_out_whatsapp,
            false,
          );

          const resolved = await reviewRow(reviewId);
          assert.equal(resolved.status, "linked");
          assert.equal(resolved.resolved_by, MANAGER);
          assert.equal(resolved.linked_contact_id, X);
          assert.equal(resolved.resolution_note, "合成備註");
          assert.ok(resolved.resolved_at);
          const audit = await auditFor(reviewId);
          assert.equal(audit.length, 1);
          assert.equal(audit[0].action, "contact.identity_review.resolve");
          assert.equal(audit[0].actor_id, MANAGER);
          assert.deepEqual(audit[0].metadata, {
            reviewId,
            reason: "whatsapp_identity_conflict",
            action: "link_b",
          });
          assertNoIdentity(audit[0].metadata);

          // A contact that already has a lead gets no second one from a link.
          const Y = id(901);
          const L = id(902);
          await seed(Y, { phone: "85255550902", member: "synthetic-fx12-t4-m3" });
          await query(
            "INSERT INTO crm_leads(id,contact_id,stage,intent,source) VALUES($1,$2,'contacted','buyer','website')",
            [L, Y],
          );
          const other = await inbound({
            messageId: "synthetic-fx12-t4-y-1",
            member: "synthetic-fx12-t4-m4",
            phone: "85255550902",
            text: "合成核對訊息三",
          });
          const otherReview = await openReviewFor(other.conversationId);
          const leadHash = await one("SELECT md5(l::text) AS h FROM crm_leads l WHERE id=$1", [L]);
          await review.resolveContactIdentityReview(
            { id: otherReview.id, action: "link_b" },
            adminActor,
          );
          assert.equal(
            await n("SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1", [Y]),
            1,
          );
          assert.deepEqual(
            await one("SELECT md5(l::text) AS h FROM crm_leads l WHERE id=$1", [L]),
            leadHash,
          );
        },
      );

      await t.test(
        "after a manager links the conversation, the next message lands there and opens no new review",
        async () => {
          const { conversationId } = await openCaseA();
          const reviewsBefore = await n(
            "SELECT count(*)::int AS n FROM crm_contact_identity_reviews",
          );
          const xBefore = await contactRow(X);
          const outcome = await inbound({
            messageId: "synthetic-fx12-t4-a-3",
            member: "synthetic-fx12-t4-m2",
            phone: P,
            text: "合成核對後訊息",
          });
          assert.equal(outcome.identityReview, false);
          assert.equal(outcome.conversationId, conversationId);
          assert.equal(outcome.contactId, X);
          const message = await one("SELECT contact_id FROM whatsapp_messages WHERE text=$1", [
            "合成核對後訊息",
          ]);
          assert.equal(message.contact_id, X);
          assert.equal(
            await n("SELECT count(*)::int AS n FROM crm_contact_identity_reviews"),
            reviewsBefore,
          );
          const xAfter = await contactRow(X);
          assert.equal(xAfter.whatsapp_member_id, xBefore.whatsapp_member_id);
          assert.equal(xAfter.normalized_phone, xBefore.normalized_phone);
        },
      );

      await t.test(
        "link_new creates a contact with the member and no phone or consent",
        async () => {
          const W = id(910);
          await seed(W, { phone: "85255550910", member: "synthetic-fx12-t4-m10" });
          const wBefore = await one("SELECT md5(c::text) AS h FROM crm_contacts c WHERE id=$1", [
            W,
          ]);
          const outcome = await inbound({
            messageId: "synthetic-fx12-t4-n-1",
            member: "synthetic-fx12-t4-m11",
            phone: "85255550910",
            text: "合成新客訊息",
            name: "合成新客",
          });
          const open = await openReviewFor(outcome.conversationId);
          const contactsBefore = await n("SELECT count(*)::int AS n FROM crm_contacts");
          const result = await review.resolveContactIdentityReview(
            { id: open.id, action: "link_new" },
            managerActor,
          );
          assert.equal(result.status, "linked");
          assert.ok(result.linkedContactId);
          assert.notEqual(result.linkedContactId, W);
          assert.equal(await n("SELECT count(*)::int AS n FROM crm_contacts"), contactsBefore + 1);
          const created = await one("SELECT * FROM crm_contacts WHERE id=$1", [
            result.linkedContactId,
          ]);
          assert.equal(created.name, "合成新客");
          assert.equal(created.whatsapp_member_id, "synthetic-fx12-t4-m11");
          assert.equal(created.phone, null);
          assert.equal(created.normalized_phone, null);
          assert.equal(created.opt_in_whatsapp, false);
          assert.equal(created.opted_out_whatsapp, false);
          assert.equal(created.source, "whatsapp");
          assert.equal(
            (
              await one("SELECT contact_id FROM whatsapp_conversations WHERE id=$1", [
                outcome.conversationId,
              ])
            ).contact_id,
            result.linkedContactId,
          );
          assert.equal(
            await n("SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1", [
              result.linkedContactId,
            ]),
            1,
          );
          // The phone owner is untouched.
          assert.deepEqual(
            await one("SELECT md5(c::text) AS h FROM crm_contacts c WHERE id=$1", [W]),
            wBefore,
          );
          assert.equal((await reviewRow(open.id)).linked_contact_id, result.linkedContactId);
        },
      );

      await t.test(
        "a STOP received in the review conversation opts out the contact it is linked to",
        async () => {
          // (c′): the conversation belongs to Z (who does not hold the member), and a STOP
          // arrives from a phone nobody holds. It matched no contact, so nobody was opted
          // out at ingest. Linking to Z must apply it, with FX-08 evidence.
          const Z = id(920);
          await seed(Z, { phone: "85255550920", name: "合成業主" });
          const [conversation] = await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
             VALUES($1,'synthetic-fx12-t4-m20',$2,now(),now()) RETURNING id`,
            [Z, CHANNEL],
          );
          const stop = await inbound({
            messageId: "synthetic-fx12-t4-stop-1",
            member: "synthetic-fx12-t4-m20",
            phone: "85255550929",
            text: "STOP",
          });
          assert.equal(stop.identityReview, true);
          assert.equal(stop.conversationId, conversation.id);
          const open = await openReviewFor(conversation.id);
          assert.equal(open.contact_a, Z);
          assert.equal(open.evidence.stopReceived, true);
          assert.equal(open.evidence.optOutApplied, false);
          assert.equal(
            (await one("SELECT opted_out_whatsapp FROM crm_contacts WHERE id=$1", [Z]))
              .opted_out_whatsapp,
            false,
          );
          const stopMessage = await one(
            "SELECT external_message_id,created_at FROM whatsapp_messages WHERE external_message_id=$1",
            ["synthetic-fx12-t4-stop-1"],
          );
          await review.resolveContactIdentityReview(
            { id: open.id, action: "link_a" },
            managerActor,
          );
          const z = await one("SELECT * FROM crm_contacts WHERE id=$1", [Z]);
          assert.equal(z.opted_out_whatsapp, true);
          assert.equal(z.opted_out_source, "customer_message");
          assert.equal(z.opted_out_message_id, "synthetic-fx12-t4-stop-1");
          assert.equal(z.opted_out_text, "STOP");
          assert.equal(z.opted_out_at.toISOString(), stopMessage.created_at.toISOString());

          // link_new carries the STOP to the new contact too.
          const W = id(921);
          await seed(W, { phone: "85255550921", member: "synthetic-fx12-t4-m21" });
          const conflicted = await inbound({
            messageId: "synthetic-fx12-t4-stop-2",
            member: "synthetic-fx12-t4-m22",
            phone: "85255550921",
            text: "退訂",
          });
          const second = await openReviewFor(conflicted.conversationId);
          assert.equal(second.evidence.stopReceived, true);
          const linked = await review.resolveContactIdentityReview(
            { id: second.id, action: "link_new" },
            managerActor,
          );
          const created = await one("SELECT * FROM crm_contacts WHERE id=$1", [
            linked.linkedContactId,
          ]);
          assert.equal(created.opted_out_whatsapp, true);
          assert.equal(created.opted_out_source, "customer_message");
          assert.equal(created.opted_out_message_id, "synthetic-fx12-t4-stop-2");
          assert.equal(created.opted_out_text, "退訂");
          assert.equal(created.opt_in_whatsapp, false);
        },
      );

      await t.test(
        "a second resolve of the same review → 409 REVIEW_ALREADY_RESOLVED, and an action/reason mismatch → 400",
        async () => {
          const { reviewId } = await openCaseA();
          let before = await worldDigest();
          await rejectsStatus(
            review.resolveContactIdentityReview({ id: reviewId, action: "link_b" }, managerActor),
            409,
            "REVIEW_ALREADY_RESOLVED",
          );
          await rejectsStatus(
            review.resolveContactIdentityReview({ id: id(999), action: "dismiss" }, managerActor),
            404,
          );
          assert.equal(await worldDigest(), before);

          // A fresh case a review: link_a has no side A, and duplicate actions do not apply.
          const V = id(930);
          await seed(V, { phone: "85255550930", member: "synthetic-fx12-t4-m30" });
          const outcome = await inbound({
            messageId: "synthetic-fx12-t4-m-1",
            member: "synthetic-fx12-t4-m31",
            phone: "85255550930",
            text: "合成不適用",
          });
          const open = await openReviewFor(outcome.conversationId);
          before = await worldDigest();
          for (const action of ["link_a", "same_person", "dismiss"])
            await rejectsStatus(
              review.resolveContactIdentityReview({ id: open.id, action }, managerActor),
              400,
              "REVIEW_ACTION_NOT_ALLOWED",
            );
          assert.equal(await worldDigest(), before);

          // Two managers at once: exactly one wins, the other gets 409, one audit row.
          const results = await Promise.allSettled([
            review.resolveContactIdentityReview({ id: open.id, action: "link_b" }, managerActor),
            review.resolveContactIdentityReview({ id: open.id, action: "link_new" }, adminActor),
          ]);
          assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
          const loser = results.find((r) => r.status === "rejected");
          assert.ok(loser.reason instanceof Response);
          assert.equal(loser.reason.status, 409);
          assert.equal((await auditFor(open.id)).length, 1);
          assert.equal(
            await n(
              "SELECT count(*)::int AS n FROM crm_contacts WHERE whatsapp_member_id='synthetic-fx12-t4-m31'",
            ),
            results[1].status === "fulfilled" ? 1 : 0,
          );
        },
      );

      await t.test("duplicate decisions never merge or edit contacts", async () => {
        const pairs = [
          ["same_person", "same_person", 940],
          ["different_people", "different_people", 950],
          ["dismiss", "dismissed", 960],
        ];
        for (const [action, status, base] of pairs) {
          const A = id(base);
          const B = id(base + 1);
          const digits = String(base).padStart(4, "0");
          await query(
            `INSERT INTO crm_contacts(id,name,phone,normalized_phone,source)
             VALUES($1,'合成重複甲',$3,$3,'website'),($2,'合成重複乙',$4,$4,'whatsapp')`,
            [A, B, "8525555" + digits, "5555" + digits],
          );
          await query(
            "INSERT INTO crm_leads(id,contact_id,stage,intent,source) VALUES($1,$2,'new','buyer','website'),($3,$4,'new','tenant','whatsapp')",
            [id(base + 2), A, id(base + 3), B],
          );
          await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id)
             VALUES($1,$2,$3)`,
            [B, "synthetic-fx12-t4-d" + base, CHANNEL],
          );
          const [dup] = await query(
            `INSERT INTO crm_contact_identity_reviews(reason,contact_a,contact_b,evidence)
             VALUES('phone_format_duplicate',$1,$2,'{"kind":"phone_format"}') RETURNING id`,
            [A, B],
          );
          const pairDigest = () =>
            one(
              `SELECT md5(concat_ws('|',
                (SELECT string_agg(c::text,',' ORDER BY c.id) FROM crm_contacts c WHERE c.id IN ($1,$2)),
                (SELECT string_agg(l::text,',' ORDER BY l.id) FROM crm_leads l WHERE l.contact_id IN ($1,$2)),
                (SELECT string_agg(w::text,',' ORDER BY w.id) FROM whatsapp_conversations w WHERE w.contact_id IN ($1,$2)))) AS h`,
              [A, B],
            );
          const before = await pairDigest();
          const contactsBefore = await n("SELECT count(*)::int AS n FROM crm_contacts");
          for (const linkAction of ["link_a", "link_b", "link_new"])
            await rejectsStatus(
              review.resolveContactIdentityReview({ id: dup.id, action: linkAction }, managerActor),
              400,
              "REVIEW_ACTION_NOT_ALLOWED",
            );
          const result = await review.resolveContactIdentityReview(
            { id: dup.id, action },
            managerActor,
          );
          assert.deepEqual(result, { ok: true, status, linkedContactId: null });
          assert.deepEqual(await pairDigest(), before);
          assert.equal(await n("SELECT count(*)::int AS n FROM crm_contacts"), contactsBefore);
          const resolved = await reviewRow(dup.id);
          assert.equal(resolved.status, status);
          assert.equal(resolved.linked_contact_id, null);
          assert.equal(resolved.resolved_by, MANAGER);
          const audit = await auditFor(dup.id);
          assert.equal(audit.length, 1);
          assert.deepEqual(audit[0].metadata, {
            reviewId: dup.id,
            reason: "phone_format_duplicate",
            action,
          });
        }
        const resolved = await review.listContactIdentityReviews(
          { status: "resolved" },
          managerActor,
        );
        const sample = resolved.rows.find((row) => row.status === "same_person");
        assert.ok(sample);
        assert.equal(sample.a.maskedPhone, "•••• 0940");
        assert.equal(sample.b.maskedPhone, "•••• 0940");
        assert.equal(sample.a.leadCount, 1);
        assert.equal(sample.a.openLeadIds.length, 1);
        assert.ok(sample.resolvedByName);
        assertNoIdentity(resolved.rows);
      });

      await t.test("a reply to a conversation under review is refused", async () => {
        const R = id(970);
        await seed(R, { phone: "85255550970", member: "synthetic-fx12-t4-m70" });
        const outcome = await inbound({
          messageId: "synthetic-fx12-t4-r-1",
          member: "synthetic-fx12-t4-m71",
          phone: "85255550970",
          text: "合成回覆門檻",
        });
        const reply = () =>
          enqueueOutboundIntent(
            {
              requestId: crypto.randomUUID(),
              conversationId: outcome.conversationId,
              kind: "text",
              payload: { text: "合成回覆" },
            },
            MANAGER,
            null,
          );
        const intents = () =>
          n("SELECT count(*)::int AS n FROM whatsapp_outbound_intents WHERE conversation_id=$1", [
            outcome.conversationId,
          ]);
        await assert.rejects(reply(), { code: "IDENTITY_REVIEW_REQUIRED" });
        assert.equal(await intents(), 0);
        const open = await openReviewFor(outcome.conversationId);
        await review.resolveContactIdentityReview({ id: open.id, action: "link_b" }, managerActor);
        const queued = await reply();
        assert.equal(queued.state, "queued");
        assert.equal(await intents(), 1);
      });

      await t.test(
        "the inbox marks the review conversation and counts it for managers",
        async () => {
          const before = {
            manager: (await server.getAdminAttentionCounts(managerActor)).unansweredConversations,
            agent: (await server.getAdminAttentionCounts(agentActor)).unansweredConversations,
          };
          const Q = id(980);
          await seed(Q, { phone: "85255550980", member: "synthetic-fx12-t4-m80" });
          const outcome = await inbound({
            messageId: "synthetic-fx12-t4-i-1",
            member: "synthetic-fx12-t4-m81",
            phone: "85255550980",
            text: "合成收件匣",
          });
          const open = await openReviewFor(outcome.conversationId);
          const page = await readAdminPage({ resource: "conversations", limit: 100 }, managerActor);
          const row = page.rows.find((item) => item.id === outcome.conversationId);
          assert.ok(row);
          assert.equal(row.identity_review, true);
          assert.equal(row.identity_review_id, open.id);
          assert.equal(row.next_action, "review");
          assert.equal(
            (await server.getAdminAttentionCounts(managerActor)).unansweredConversations,
            before.manager + 1,
          );
          assert.equal(
            (await server.getAdminAttentionCounts(agentActor)).unansweredConversations,
            before.agent,
          );
          const managerDetail = await server.fetchAdminConversation(
            outcome.conversationId,
            managerActor,
            false,
          );
          assert.equal(managerDetail.identity_review_id, open.id);
          assert.equal(managerDetail.can_resolve_identity_review, true);

          // Case c: the conversation's assigned agent sees the badge too, but cannot resolve.
          const Z = id(985);
          await seed(Z, { phone: "85255550985", member: "synthetic-fx12-t4-m85" });
          const [owned] = await query(
            `INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,assigned_agent_id,last_message_at,last_inbound_at)
             VALUES($1,'synthetic-fx12-t4-m85',$2,$3,now(),now()) RETURNING id`,
            [Z, CHANNEL, AGENT],
          );
          const V = id(986);
          await seed(V, { phone: "85255550986" });
          const conflicted = await inbound({
            messageId: "synthetic-fx12-t4-i-2",
            member: "synthetic-fx12-t4-m85",
            phone: "85255550986",
            text: "合成負責代理",
          });
          assert.equal(conflicted.identityReview, true);
          assert.equal(conflicted.conversationId, owned.id);
          const agentPage = await readAdminPage(
            { resource: "conversations", limit: 100 },
            agentActor,
          );
          const agentRow = agentPage.rows.find((item) => item.id === owned.id);
          assert.ok(agentRow);
          assert.equal(agentRow.identity_review, true);
          assert.equal(agentRow.next_action, "review");
          const agentDetail = await server.fetchAdminConversation(owned.id, agentActor, false);
          assert.ok(agentDetail.identity_review_id);
          assert.equal(agentDetail.can_resolve_identity_review, false);
          await assert.rejects(
            enqueueOutboundIntent(
              {
                requestId: crypto.randomUUID(),
                conversationId: owned.id,
                kind: "text",
                payload: { text: "合成回覆" },
              },
              AGENT,
              AGENT,
            ),
            { code: "IDENTITY_REVIEW_REQUIRED" },
          );
          await rejectsStatus(
            review.resolveContactIdentityReview(
              { id: agentDetail.identity_review_id, action: "link_a" },
              agentActor,
            ),
            403,
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
