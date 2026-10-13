import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import { onDbTarget } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import {
  applyMigrations,
  isolatedDatabase,
  migrationsAfter,
  migrationsBefore,
} from "../../../scripts/acceptance/migrated-schema.mjs";
import {
  saveTrackingLink,
  resolveTrackingLinks,
  trackedRedirect,
} from "../neon/whatsapp-enquiries.server.ts";
import { observeEpisode } from "./episodes.server.ts";

// The on-demand Neon run keeps its ASTRA_TEST_DATABASE_URL contract.
const neonRun = { urlVar: "ASTRA_TEST_DATABASE_URL" };
const EPISODES = "20260912130000_whatsapp_enquiry_episodes.sql";
// Owned Docker Postgres by default (a fresh database in the container); ASTRA_TEST_DATABASE_URL
// (behind the disposable guard) for an explicit Neon run. In CI a missing database fails instead
// of skipping. The isolated schema is built from the real migrations, in order.
test(
  "Phase 2 synthetic isolated schema: migration, immutable links and episode transactions",
  onDbTarget(async (target, t) => {
    const { sql: db, end } = await isolatedDatabase(target),
      schema = "wa_p2_" + randomUUID().replaceAll("-", "");
    const tx = async (statements) =>
      (
        await db.transaction((q) => [
          q.query("SELECT set_config('search_path',$1,true)", [schema]),
          ...statements.map((s) => q.query(s.statement, s.params ?? [])),
        ])
      ).slice(1);
    const query = async (statement, params = []) => (await tx([{ statement, params }]))[0];
    const migrate = () => applyMigrations(db, schema, [EPISODES]);
    const a = randomUUID(),
      b = randomUUID(),
      conv = randomUUID(),
      other = randomUUID(),
      p = randomUUID(),
      p2 = randomUUID(),
      link = randomUUID(),
      staff = randomUUID();
    const ref = "a".repeat(32),
      hash = createHash("sha256").update(ref).digest("hex");
    async function event(text = "hello", conversation = conv, contact = a) {
      const mid = randomUUID(),
        eid = randomUUID();
      await query(
        `INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,message_type,text,channel_id,woztell_member_id) VALUES($1,$2,$3,'inbound','text',$4,'fixture',($3::uuid)::text)`,
        [mid, conversation, contact, text],
      );
      await query(
        `INSERT INTO whatsapp_enquiry_events(id,dedupe_key,app_id,external_message_id,timing,identity_quality,message_id,kind,origin,capture_mode,effects_eligible,channel_id,member_id,occurred_at,received_at) VALUES($1,$4,'fixture-app',$5,'fresh','provider_id',$2,'customer_message','live_webhook','observe',false,'fixture',$3,now(),now())`,
        [eid, mid, contact, createHash("sha256").update(eid).digest("hex"), "synthetic-" + eid],
      );
      return eid;
    }
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await applyMigrations(db, schema, migrationsBefore(EPISODES));
      await query("INSERT INTO inquiries(name) VALUES($1)", ["legacy website"]);
      await migrate();
      await migrate();
      await applyMigrations(db, schema, migrationsAfter(EPISODES));
      await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [staff]);
      // Two offers (sale and rent) of one public listing G1: the real public-identity trigger
      // groups them under G1 through the shared canonical number.
      await query(
        "INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,district_slug) VALUES($1,'SYN-G1-S','G1','Synthetic','sale','synthetic'),($2,'SYN-G1-R','G1','Synthetic','rent','synthetic')",
        [p, p2],
      );
      await query("INSERT INTO crm_contacts(id,name) VALUES($1,NULL),($2,NULL)", [a, b]);
      await query("INSERT INTO whatsapp_conversations(id,contact_id) VALUES($1,$2),($3,$4)", [
        conv,
        a,
        other,
        b,
      ]);
      // An unrelated lead mid-pipeline (a real crm_lead_stage value) must be left untouched.
      await query(
        "INSERT INTO crm_leads(id,contact_id,source,stage) VALUES($1,$2,'unrelated','negotiating')",
        [randomUUID(), a],
      );
      await query("INSERT INTO whatsapp_tracking_links(id,code,created_by) VALUES($1,$2,$3)", [
        link,
        "abcdefghijklmnop",
        staff,
      ]);
      await query(
        "INSERT INTO whatsapp_tracking_link_versions(link_id,version,channel_id,placement_source,entry_point_type,public_listing_no,property_id,deal_type) VALUES($1,1,'fixture','youtube','sales','G1',$2,'sale')",
        [link, p],
      );
      await query(
        "INSERT INTO whatsapp_link_opens(reference_hash,link_id,link_version,channel_id,context_snapshot) VALUES($1,$2,1,'fixture',$3)",
        [
          hash,
          link,
          JSON.stringify({
            propertyId: p,
            publicListingNo: "G1",
            placementSource: "youtube",
            entryPointType: "sales",
          }),
        ],
      );
      await t.test("AT-22 website remains non-null; legacy row survives", async () => {
        await assert.rejects(query("INSERT INTO inquiries(source,name) VALUES('website',NULL)"));
        assert.equal((await query("SELECT * FROM inquiries WHERE source='website'")).length, 1);
      });
      await t.test("AT-15 open creates no inquiry, contact or lead", async () => {
        assert.equal((await query("SELECT * FROM crm_contacts")).length, 2);
        assert.equal((await query("SELECT * FROM inquiries WHERE source='whatsapp'")).length, 0);
      });
      let first;
      await t.test(
        "AT-10/22/23/27 duplicate root preserves null name, unrelated lead, effects false",
        async () => {
          const eid = await event("EPWA:" + ref);
          const ids = await Promise.all(
            Array.from({ length: 6 }, () => observeEpisode(eid, query)),
          );
          assert.equal(new Set(ids).size, 1);
          first = ids[0];
          const [row] = await query("SELECT * FROM inquiries WHERE id=$1", [first]);
          assert.equal(row.name, null);
          assert.equal(row.crm_lead_id, null);
          assert.equal(row.effects_eligible, false);
          assert.equal(row.placement_source, "youtube");
          assert.equal((await query("SELECT stage FROM crm_leads"))[0].stage, "negotiating");
          // b6d049e9 (feat: implement guarded WhatsApp enquiry workflow and service follow-up)
          // dropped inquiries_effects_eligible_check: Phase 4 lets an active, fresh capture make
          // its inquiry effects-eligible at intake. The guard is now the immutable capture
          // event, which an observe-mode capture can never turn effects-eligible.
          await assert.rejects(
            query("UPDATE whatsapp_enquiry_events SET effects_eligible=true WHERE id=$1", [eid]),
            /WA_CAPTURE_IMMUTABLE/,
          );
        },
      );
      await t.test("AT-24 followups preserve root clock", async () => {
        const before = (await query("SELECT * FROM inquiries WHERE id=$1", [first]))[0];
        // A follow-up joins a property enquiry only through that property's reference (see the
        // no-reference subtest below, 90e923b1).
        const eid = await event("EPWA:" + ref + " when can I view?");
        assert.equal(await observeEpisode(eid, query), first);
        const after = (await query("SELECT * FROM inquiries WHERE id=$1", [first]))[0];
        assert.equal(String(before.customer_message_at), String(after.customer_message_at));
        assert.equal(after.intake_message_id, before.intake_message_id);
      });
      await t.test("AT-21 forwarded token creates separate identity and episode", async () => {
        const eid = await event("EPWA:" + ref, other, b);
        const second = await observeEpisode(eid, query);
        assert.notEqual(second, first);
        assert.equal(
          (await query("SELECT crm_contact_id FROM inquiries WHERE id=$1", [second]))[0]
            .crm_contact_id,
          b,
        );
        assert.equal((await query("SELECT * FROM crm_contacts")).length, 2);
      });
      await t.test("AT-25 different selected property creates another episode", async () => {
        const token = "b".repeat(32);
        await query(
          "INSERT INTO whatsapp_link_opens(reference_hash,link_id,link_version,channel_id,context_snapshot) VALUES($1,$2,1,'fixture',$3)",
          [
            createHash("sha256").update(token).digest("hex"),
            link,
            JSON.stringify({
              propertyId: p2,
              publicListingNo: "G2",
              placementSource: "website",
              entryPointType: "sales",
            }),
          ],
        );
        const eid = await event("EPWA:" + token);
        assert.notEqual(await observeEpisode(eid, query), first);
      });
      await t.test(
        "AT-20 ambiguous followup and multiple refs are retained without arbitrary association",
        async () => {
          const before = (await query("SELECT * FROM inquiries")).length;
          // A message with no reference at all is not ambiguous since 90e923b1; it is covered
          // by the no-reference subtest below.
          for (const body of ["EPWA:" + ref + " EPWA:" + "b".repeat(32), "EPWA:bad"]) {
            const eid = await event(body);
            assert.equal(await observeEpisode(eid, query), null);
            assert.equal(
              (
                await query("SELECT association_review FROM whatsapp_enquiry_events WHERE id=$1", [
                  eid,
                ])
              )[0].association_review,
              true,
            );
          }
          assert.equal((await query("SELECT * FROM inquiries")).length, before);
        },
      );
      await t.test(
        "No-reference follow-ups never join a property enquiry; one unknown-property root is kept for review",
        async () => {
          // 90e923b1 (fix: separate enquiries for distinct property references) made the
          // episode SQL "NULL property is never a wildcard" (20260929103000): a message without
          // a reference no longer attaches to an open property enquiry. It is retained on one
          // unknown-property root flagged for review, and later no-reference messages join it.
          const propertyRoots = (
            await query(
              "SELECT id FROM inquiries WHERE conversation_id=$1 AND property_id IS NOT NULL",
              [conv],
            )
          ).map((row) => row.id);
          assert.ok(propertyRoots.includes(first));
          const before = (await query("SELECT * FROM inquiries WHERE id=$1", [first]))[0];
          const unknown = await observeEpisode(await event("hello"), query);
          assert.ok(unknown);
          assert.ok(!propertyRoots.includes(unknown));
          const [root] = await query(
            "SELECT property_id,association_review,attribution_method,effects_eligible FROM inquiries WHERE id=$1",
            [unknown],
          );
          assert.deepEqual(
            [root.property_id, root.association_review, root.attribution_method],
            [null, true, "unknown"],
          );
          assert.equal(root.effects_eligible, false);
          assert.equal(await observeEpisode(await event("when can I view?"), query), unknown);
          const after = (await query("SELECT * FROM inquiries WHERE id=$1", [first]))[0];
          assert.equal(String(before.customer_message_at), String(after.customer_message_at));
          assert.equal(after.intake_message_id, before.intake_message_id);
        },
      );
      await t.test(
        "AT-17/18 registry CRUD versions and batched exact sale/rent current offerings",
        async () => {
          const saved = { ...process.env };
          Object.assign(process.env, {
            EP_WA_COMPANY_CHANNEL_ID: "fixture",
            EP_WA_TRACKED_LINKS_ENABLED: "true",
            EP_WA_COMPANY_PHONE: "85212345678",
          });
          try {
            // p (sale) and p2 (rent) were seeded as members of public listing G1.
            await query(
              "UPDATE properties SET title_zh='Synthetic public offer',status='active' WHERE id=ANY($1::uuid[])",
              [[p, p2]],
            );
            assert.deepEqual(
              (
                await query(
                  "SELECT public_listing_no FROM property_public_members WHERE property_id=ANY($1::uuid[])",
                  [[p, p2]],
                )
              ).map((row) => row.public_listing_no),
              ["G1", "G1"],
            );
            const actor = { staffId: staff, roles: ["admin"] },
              deps = { query, transaction: tx },
              registered = [];
            // Since 27b05808 (feat(whatsapp): manage website tracking coverage) the public
            // resolver only uses a website link whose placement is verified
            // (websiteCandidateLateral: `v.placement_verified_at IS NOT NULL`), so the website
            // links that public pages must resolve are saved as placement-verified, as the admin
            // coverage flow does. Before that commit the resolver ignored verification.
            for (const placementSource of ["website", "28hse", "youtube"])
              registered.push(
                await saveTrackingLink(
                  {
                    placementSource,
                    entryPointType: "sales",
                    publicListingNo: "G1",
                    propertyId: p,
                    dealType: "sale",
                    enabled: true,
                    placementVerified: placementSource === "website",
                  },
                  actor,
                  deps,
                ),
              );
            const rentOffer = {
              placementSource: "website",
              entryPointType: "sales",
              publicListingNo: "G1",
              propertyId: p2,
              dealType: "rent",
              enabled: true,
            };
            // An enabled but unverified website rent link is never offered publicly.
            const unverifiedRent = await saveTrackingLink(rentOffer, actor, deps);
            assert.equal(unverifiedRent.placementVerified, false);
            const offers = [
              {
                propertyId: p,
                publicListingNo: "G1",
                dealType: "sale",
                title: "Synthetic public offer",
              },
              {
                propertyId: p2,
                publicListingNo: "G1",
                dealType: "rent",
                title: "Synthetic public offer",
              },
            ];
            const beforeRent = await resolveTrackingLinks(offers, query);
            assert.equal(beforeRent.links[0].href, "/w/" + registered[0].code);
            assert.equal(beforeRent.links[1].href, null);
            const rent = await saveTrackingLink(
              { ...rentOffer, placementVerified: true },
              actor,
              deps,
            );
            assert.equal(rent.placementVerified, true);
            assert.equal(new Set(registered.map((l) => l.code)).size, 3);
            for (const l of registered) {
              const response = await trackedRedirect(
                new Request("https://fixture/w/" + l.code),
                l.code,
                query,
              );
              assert.equal(response.status, 302);
              const text = new URL(response.headers.get("Location")).searchParams.get("text");
              const token = text.match(/EPWA:([A-Za-z0-9_-]{32})/)[1];
              const [open] = await query(
                "SELECT context_snapshot FROM whatsapp_link_opens WHERE reference_hash=$1",
                [createHash("sha256").update(token).digest("hex")],
              );
              assert.equal(open.context_snapshot.placementSource, l.placementSource);
              assert.equal(open.context_snapshot.propertyId, p);
              assert.equal(open.context_snapshot.publicListingNo, "G1");
            }
            // A placement-verified, enabled website RENT link resolves to /w/<code> exactly like
            // the sale link, in one batched read; the unverified rent link is not a candidate.
            const resolved = await resolveTrackingLinks(offers, query);
            assert.equal(resolved.links[0].href, "/w/" + registered[0].code);
            assert.equal(resolved.links[1].href, "/w/" + rent.code);
            assert.deepEqual(
              resolved.actions.map((action) => [action.dealType, action.mode, action.href]),
              [
                ["sale", "tracked", "/w/" + registered[0].code],
                ["rent", "tracked", "/w/" + rent.code],
              ],
            );
            const revised = await saveTrackingLink(
              { ...registered[0], id: registered[0].id, expectedVersion: 1, enabled: false },
              actor,
              deps,
            );
            assert.equal(revised.version, 2);
            await assert.rejects(
              saveTrackingLink(
                { ...registered[0], id: registered[0].id, expectedVersion: 1, enabled: true },
                actor,
                deps,
              ),
            );
            assert.equal(
              (
                await query("SELECT * FROM whatsapp_tracking_link_versions WHERE link_id=$1", [
                  registered[0].id,
                ])
              ).length,
              2,
            );
            await query("UPDATE properties SET status='sold' WHERE id=$1", [p]);
            const fallback = await trackedRedirect(
              new Request("https://fixture"),
              registered[1].code,
              query,
            );
            assert.ok(!fallback.headers.get("Location").includes("EPWA"));
            await query("UPDATE staff_users SET active=false WHERE id=$1", [staff]);
            delete process.env.EP_WA_COMPANY_CHANNEL_ID;
            const retired = await saveTrackingLink(
              { ...registered[1], expectedVersion: 1, enabled: false },
              actor,
              deps,
            );
            assert.equal(retired.enabled, false);
            assert.equal(retired.version, 2);
            assert.equal(retired.channelId, registered[1].channelId);
          } finally {
            process.env = saved;
          }
        },
      );
      await t.test("Approved service-policy versions cannot be silently rewritten", async () => {
        const id = randomUUID();
        await query(
          "INSERT INTO whatsapp_service_policies(id,version,status,rules,copy_version,approved_by,effective_at) VALUES($1,1,'approved','{}','fixture',$2,now())",
          [id, staff],
        );
        await assert.rejects(
          query("UPDATE whatsapp_service_policies SET rules='{\"changed\":true}' WHERE id=$1", [
            id,
          ]),
        );
        await query("UPDATE whatsapp_service_policies SET status='retired' WHERE id=$1", [id]);
        await assert.rejects(
          query("UPDATE whatsapp_service_policies SET status='approved' WHERE id=$1", [id]),
        );
      });
      await t.test("Attribution versions and snapshots cannot be rewritten", async () => {
        await assert.rejects(
          query("UPDATE whatsapp_tracking_link_versions SET placement_source='other'"),
        );
        await assert.rejects(query("UPDATE whatsapp_link_opens SET context_snapshot='{}'::jsonb"));
      });
    } finally {
      try {
        await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await end();
      }
    }
  }, neonRun),
);
