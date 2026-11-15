import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { withOwnedPostgres } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import { resolveEnquiryForwarding } from "./enquiry-routing.server.ts";
import { normalizePhone } from "../phone.js";
import { notificationPhone } from "./enquiry-routing.mjs";
const migration = "20261116000000_enquiry_forwarding.sql";
const versions = MIGRATION_VERSIONS.includes(migration)
  ? MIGRATION_VERSIONS
  : [...MIGRATION_VERSIONS, migration];
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("owned forwarding schema is disabled by default and routes only approved new notification subjects", async (t) => {
  await withOwnedPostgres(
    async ({ query: q }) => {
      await t.test(
        "the migrated SQL helper shares canonical HK notification spellings and the explicit mobile-only policy",
        async () => {
          const cases = [];
          for (const prefix of [4, 5, 6, 7, 8, 9]) {
            const local = `${prefix}1234567`;
            for (const raw of [
              local,
              `852${local}`,
              `00852${local}`,
              `${local.slice(0, 4)} ${local.slice(4)}`,
              `+852 ${local.slice(0, 4)}-${local.slice(4)}`,
              `00852 ${local.slice(0, 4)} ${local.slice(4)}`,
              `(852) ${local.slice(0, 4)}.${local.slice(4)}`,
              `  ${local.slice(0, 4)}\t${local.slice(4)}  `,
            ])
              cases.push({ raw, canonical: `852${local}`, destination: `852${local}` });
          }
          // Identity accepts landlines and international customers; this notification
          // destination helper deliberately permits only HK prefixes 4 through 9.
          cases.push(
            { raw: "2688 2988", canonical: "85226882988", destination: null },
            { raw: "+852 3688 2988", canonical: "85236882988", destination: null },
            { raw: "00852 2688 2988", canonical: "85226882988", destination: null },
            { raw: "+44 20 7946 0958", canonical: "442079460958", destination: null },
            { raw: "0044 20 7946 0958", canonical: "442079460958", destination: null },
            { raw: "8613812345678", canonical: "8613812345678", destination: null },
          );
          for (const raw of [
            null,
            "",
            "abc",
            "00000000",
            "01234567",
            "12345678",
            "9123456",
            "912345678",
            "+852 9123 456",
            "+85212345678",
            "+1234567890123456",
            "9123 4567 ext 12",
            "9123 4567 / 9876 5432",
          ])
            cases.push({ raw, canonical: null, destination: null });
          const rows = await q(
            "SELECT value AS raw, enquiry_notification_phone(value) AS phone FROM unnest($1::text[]) WITH ORDINALITY AS inputs(value, ordinal) ORDER BY ordinal",
            [cases.map(({ raw }) => raw)],
          );
          assert.equal(rows.length, cases.length);
          for (const [index, { raw, canonical, destination }] of cases.entries()) {
            const label = JSON.stringify(raw);
            assert.equal(normalizePhone(raw), canonical, `shared identity: ${label}`);
            assert.equal(notificationPhone(raw), destination, `notification policy: ${label}`);
            assert.deepEqual(rows[index], { raw, phone: destination }, `migrated SQL: ${label}`);
          }
        },
      );
      const roleCount = (await q("SELECT count(*)::int n FROM staff_roles"))[0].n;
      const [customer] = await q(
        "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES('Owned Customer','9888 1234','85298881234') RETURNING id",
      );
      const lead = async (extra = {}) =>
        (
          await q(
            "INSERT INTO crm_leads(contact_id,property_id,source,note,preferred_estates,enquiry_routing_context,assigned_agent_id) VALUES($1,$2,'website',$3,$4,$5::jsonb,$6) RETURNING id",
            [
              customer.id,
              extra.propertyId ?? null,
              extra.note ?? "想查詢租盤",
              extra.preferred ?? [],
              JSON.stringify(extra.context ?? {}),
              extra.agentId ?? null,
            ],
          )
        )[0].id;
      let historic;
      await t.test(
        "real migration seeds 54 approved routes and four unverified disabled contacts without staff auth or jobs",
        async () => {
          assert.equal(
            (await q("SELECT count(*)::int n FROM enquiry_estate_routes WHERE enabled"))[0].n,
            54,
          );
          const contacts = await q(
            "SELECT enabled,verified_at,verification_ref,permission_granted,permission_ref,destination_reference,channel_id,destination_type FROM enquiry_notification_recipients ORDER BY recipient_key",
          );
          assert.equal(contacts.length, 4);
          for (const contact of contacts)
            assert.deepEqual(contact, {
              enabled: false,
              verified_at: null,
              verification_ref: null,
              permission_granted: false,
              permission_ref: null,
              destination_reference: null,
              channel_id: null,
              destination_type: "recipient_id",
            });
          assert.equal(
            (await q("SELECT enquiry_forwarding_is_enabled() AS enabled"))[0].enabled,
            false,
          );
          historic = await lead();
          assert.equal(
            (
              await q(
                "SELECT count(*)::int n FROM ops_jobs WHERE job_type='woztell.enquiry.forward'",
              )
            )[0].n,
            0,
          );
          assert.equal(
            await resolveEnquiryForwarding(q, { source: "website", subjectId: historic }),
            null,
          );
        },
      );
      await t.test(
        "only verified phone addressing can activate the copy and no history is enqueued",
        async () => {
          await assert.rejects(
            q("UPDATE enquiry_notification_recipients SET enabled=true WHERE recipient_key='copy'"),
            /NOT_VERIFIED/,
          );
          await assert.rejects(
            q(
              "UPDATE enquiry_notification_recipients SET enabled=true,verified_at=now(),verification_ref='owned-provider-proof',permission_granted=true,permission_ref='owned-owner-proof',channel_id='owned-company',destination_reference='not-a-phone' WHERE recipient_key='copy'",
            ),
            /PHONE_DESTINATION_MISMATCH/,
          );
          await q(
            "UPDATE enquiry_notification_recipients SET enabled=true,verified_at=now(),verification_ref='owned-provider-proof',permission_granted=true,permission_ref='owned-owner-proof',channel_id='owned-company',destination_reference=phone WHERE recipient_key='copy'",
          );
          assert.equal(
            (await q("SELECT enquiry_forwarding_is_enabled('owned-company') AS enabled"))[0]
              .enabled,
            true,
          );
          assert.equal(
            (await q("SELECT enquiry_enqueue_forward('website',$1) AS job", [historic]))[0].job,
            null,
          );
          assert.equal(
            (
              await q(
                "SELECT count(*)::int n FROM ops_jobs WHERE job_type='woztell.enquiry.forward'",
              )
            )[0].n,
            0,
          );
        },
      );
      await q(
        "INSERT INTO staff_users(id,name_zh,active,show_on_website,phone,whatsapp) VALUES($1,'主代理',true,true,'91234567','91234567'),($2,'第二代理',true,true,'92345678','92345678')",
        [id(1), id(2)],
      );
      await q(
        "INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,status,district_slug,source_authority) VALUES($1,'A900001','A900001','Owned property','sale','active','sham-tseng','28hse')",
        [id(10)],
      );
      await q(
        "INSERT INTO property_agents(property_id,position,staff_id,source) VALUES($1,1,$2,'owned-fixture'),($1,2,$3,'owned-fixture')",
        [id(10), id(1), id(2)],
      );
      let propertyLead;
      await t.test(
        "selected valid correspondent gets Sales plus copy without needing auth roles",
        async () => {
          propertyLead = await lead({
            propertyId: id(10),
            note: "豪景花園",
            context: {
              kind: "property",
              requestedPropertyId: id(10),
              requestedPublicListingNo: "A900001",
              selectedAgentId: id(2),
            },
          });
          const route = await resolveEnquiryForwarding(q, {
            source: "website",
            subjectId: propertyLead,
          });
          assert.equal(route.routingKind, "property");
          assert.deepEqual(
            route.recipients.map((r) => r.key),
            [`sales:${id(2)}`, "copy"],
          );
          assert.equal(route.propertyId, id(10));
          assert.equal((await q("SELECT count(*)::int n FROM staff_roles"))[0].n, roleCount);
          assert.equal(
            (
              await q("SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1", [
                `enquiry-forward:website:${propertyLead}`,
              ])
            )[0].n,
            1,
          );
          assert.equal(
            (await q("SELECT enquiry_enqueue_forward('website',$1) AS job", [propertyLead]))[0].job,
            null,
          );
        },
      );
      await t.test(
        "primary correspondent fills absent choice; unknown specific never downgrades to estate manager",
        async () => {
          const primaryLead = await lead({ propertyId: id(10) });
          assert.equal(
            (await resolveEnquiryForwarding(q, { source: "website", subjectId: primaryLead }))
              .recipients[0].key,
            `sales:${id(1)}`,
          );
          const unknown = await lead({
            note: "豪景花園",
            context: { kind: "property", requestedPropertyId: id(99) },
          });
          const route = await resolveEnquiryForwarding(q, {
            source: "website",
            subjectId: unknown,
          });
          assert.equal(route.routingKind, "review");
          assert.deepEqual(
            route.recipients.map((r) => r.key),
            ["copy"],
          );
          const estate = await lead({ preferred: ["春和海景花園"] });
          assert.deepEqual(
            (
              await resolveEnquiryForwarding(q, { source: "website", subjectId: estate })
            ).recipients.map((r) => r.key),
            ["manager:2", "copy"],
          );
        },
      );
      await t.test(
        "canonical estate IDs and their actual English names map without creating public estates",
        async () => {
          const estate = (await q("SELECT id FROM estates WHERE slug='bellagio'"))[0];
          const count = (await q("SELECT count(*)::int n FROM estates"))[0].n;
          for (const preferred of [[estate.id], ["Bellagio"]]) {
            const subject = await lead({ preferred });
            const route = await resolveEnquiryForwarding(q, {
              source: "website",
              subjectId: subject,
            });
            assert.deepEqual(
              route.recipients.map((r) => r.key),
              ["manager:3", "copy"],
            );
          }
          assert.equal((await q("SELECT count(*)::int n FROM estates"))[0].n, count);
        },
      );
      await t.test(
        "known authority row stays current despite a later legacy withdrawal",
        async () => {
          await q(
            "INSERT INTO properties(id,listing_no,title_zh,deal_type,status,district_slug,source_updated_at) VALUES($1,'OLD900001','Owned legacy','sale','inactive','sham-tseng',now()+interval '1 day')",
            [id(11)],
          );
          await q(
            "UPDATE property_public_members SET public_listing_no='A900001' WHERE property_id=$1",
            [id(11)],
          );
          assert.equal(
            (await resolveEnquiryForwarding(q, { source: "website", subjectId: propertyLead }))
              .routingKind,
            "property",
          );
          await q("UPDATE properties SET source_authority=null WHERE id=$1", [id(10)]);
          assert.equal(
            (await resolveEnquiryForwarding(q, { source: "website", subjectId: propertyLead }))
              .routingKind,
            "review",
          );
          await q("UPDATE properties SET source_authority='28hse' WHERE id=$1", [id(10)]);
        },
      );
      const whatsapp = async ({
        timing = "fresh",
        kind = "customer_message",
        channel = "owned-company",
        member = "owned-customer",
        phone = "85298881234",
      } = {}) => {
        const contact = (
          await q("INSERT INTO crm_contacts(name,phone) VALUES('Owned inbound',$1) RETURNING id", [
            phone,
          ])
        )[0].id;
        const conversation = (
          await q(
            "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id,assigned_agent_id,assignment_lock) VALUES($1,$2,$3,$4,true) RETURNING id",
            [contact, channel, member, id(1)],
          )
        )[0].id;
        const message = (
          await q(
            "INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,channel_id,woztell_member_id,external_message_id) VALUES($1,$2,'inbound','text','想問豪景花園租盤',$3,$4,$5) RETURNING id",
            [conversation, contact, channel, member, randomUUID()],
          )
        )[0].id;
        const inquiry = (
          await q(
            "INSERT INTO inquiries(source,crm_contact_id,conversation_id,intake_message_id,association_review) VALUES('whatsapp',$1,$2,$3,true) RETURNING id",
            [contact, conversation, message],
          )
        )[0].id;
        const event = randomUUID();
        await q(
          "INSERT INTO whatsapp_enquiry_events(id,dedupe_key,origin,app_id,channel_id,member_id,external_message_id,message_id,kind,occurred_at,received_at,timing,identity_quality,capture_mode,effects_eligible) VALUES($1,$2,'live_webhook','owned-app',$3,$4,$5,$6,$7,now(),now(),$8,'provider_id','observe',false)",
          [
            event,
            event.replaceAll("-", "").repeat(2),
            channel,
            member,
            randomUUID(),
            message,
            kind,
            timing,
          ],
        );
        await q("UPDATE whatsapp_enquiry_events SET inquiry_id=$2 WHERE id=$1", [event, inquiry]);
        return { inquiry, conversation, event, message };
      };
      await t.test(
        "fresh observe-mode estate-only inbound queues once without changing locked assignment or customer effects",
        async () => {
          const subject = await whatsapp();
          const route = await resolveEnquiryForwarding(q, {
            source: "whatsapp",
            subjectId: subject.inquiry,
          });
          assert.equal(route.routingKind, "estate");
          assert.deepEqual(
            route.recipients.map((r) => r.key),
            ["manager:1", "copy"],
          );
          assert.equal(route.conversationId, subject.conversation);
          assert.equal(route.sourceMessageId, subject.message);
          assert.equal(
            (
              await q("SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1", [
                `enquiry-forward:whatsapp:${subject.inquiry}`,
              ])
            )[0].n,
            1,
          );
          assert.deepEqual(
            (
              await q(
                "SELECT assigned_agent_id,assignment_lock FROM whatsapp_conversations WHERE id=$1",
                [subject.conversation],
              )
            )[0],
            { assigned_agent_id: id(1), assignment_lock: true },
          );
          assert.equal(
            (await q("SELECT effects_eligible FROM inquiries WHERE id=$1", [subject.inquiry]))[0]
              .effects_eligible,
            false,
          );
        },
      );
      await t.test(
        "stale, outbound, wrong channel and internal contact identities never enqueue",
        async () => {
          for (const input of [
            { timing: "stale" },
            { kind: "staff_outbound" },
            { channel: "other-channel" },
            { member: "85297987774" },
            { phone: "85266442444" },
          ]) {
            const subject = await whatsapp({ ...input, member: input.member ?? randomUUID() });
            assert.equal(
              (
                await q("SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1", [
                  `enquiry-forward:whatsapp:${subject.inquiry}`,
                ])
              )[0].n,
              0,
            );
            assert.equal(
              await resolveEnquiryForwarding(q, { source: "whatsapp", subjectId: subject.inquiry }),
              null,
            );
          }
        },
      );
      await t.test(
        "forwarding attempts freeze destination and routing facts while blocked rows may lack a destination",
        async () => {
          const copy = (
            await q("SELECT * FROM enquiry_notification_recipients WHERE recipient_key='copy'")
          )[0];
          const [attempt] = await q(
            'INSERT INTO staff_notification_attempts(lead_id,transport,forwarding_recipient_id,recipient_version,routing_snapshot,attempt_key) VALUES($1,\'staff_whatsapp\',$2,$3,\'{"purpose":"enquiry_forward","destinationType":"recipient_id"}\',\'owned-forward-freeze\') RETURNING *',
            [propertyLead, copy.id, copy.version],
          );
          assert.equal(attempt.destination_reference_snapshot, "85297987774");
          assert.equal(attempt.channel_id_snapshot, "owned-company");
          await assert.rejects(
            q("UPDATE staff_notification_attempts SET routing_snapshot='{}' WHERE id=$1", [
              attempt.id,
            ]),
            /IMMUTABLE/,
          );
          await assert.rejects(
            q("UPDATE staff_notification_attempts SET lead_id=$2 WHERE id=$1", [
              attempt.id,
              historic,
            ]),
            /IMMUTABLE/,
          );
          await q(
            "INSERT INTO staff_notification_attempts(lead_id,transport,routing_snapshot,dispatch_state,attempt_key) VALUES($1,'staff_whatsapp','{\"purpose\":\"enquiry_forward\"}','suppressed','owned-no-destination')",
            [historic],
          );
          await assert.rejects(
            q(
              "INSERT INTO staff_notification_attempts(lead_id,forwarding_inquiry_id,transport,attempt_key) VALUES($1,$2,'staff_whatsapp','owned-two-subjects')",
              [propertyLead, id(100)],
            ),
          );
        },
      );
    },
    { migrationVersions: versions },
  );
});
