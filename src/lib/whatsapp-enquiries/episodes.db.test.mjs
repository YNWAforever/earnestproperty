import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import {
  saveTrackingLink,
  resolveTrackingLinks,
  trackedRedirect,
} from "../neon/whatsapp-enquiries.server.ts";
import { observeEpisode } from "./episodes.server.ts";
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

const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "Phase 2 synthetic isolated schema: migration, immutable links and episode transactions",
  { skip: !url },
  async (t) => {
    await assertDisposableNeonTestTarget(url);
    const db = neon(url),
      schema = "wa_p2_" + randomUUID().replaceAll("-", "");
    const tx = async (statements) =>
      (
        await db.transaction((q) => [
          q.query("SELECT set_config('search_path',$1,true)", [schema]),
          ...statements.map((s) => q.query(s.statement, s.params ?? [])),
        ])
      ).slice(1);
    const query = async (statement, params = []) => (await tx([{ statement, params }]))[0];
    const migration = readFileSync(
      "neon/migrations/20260912130000_whatsapp_enquiry_episodes.sql",
      "utf8",
    );
    const migrate = async () =>
      tx(splitSqlStatements(migration).map((statement) => ({ statement })));
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
        `INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,text,channel_id,woztell_member_id) VALUES($1,$2,$3,'inbound',$4,'fixture',($3::uuid)::text)`,
        [mid, conversation, contact, text],
      );
      await query(
        `INSERT INTO whatsapp_enquiry_events(id,message_id,kind,origin,capture_mode,effects_eligible,channel_id,member_id,occurred_at,received_at) VALUES($1,$2,'customer_message','live_webhook','observe',false,'fixture',$3,now(),now())`,
        [eid, mid, contact],
      );
      return eid;
    }
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      for (const statement of [
        `CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean DEFAULT true)`,
        `CREATE TABLE properties(id uuid PRIMARY KEY,title_zh text,agent_id uuid,status text,deal_type text,source_updated_at timestamptz,last_seen_at timestamptz,updated_at timestamptz,created_at timestamptz DEFAULT now())`,
        `CREATE TABLE property_public_members(property_id uuid,public_listing_no text)`,
        `CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text)`,
        `CREATE TABLE crm_leads(id uuid PRIMARY KEY,contact_id uuid,source text,stage text)`,
        `CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,assigned_agent_id uuid)`,
        `CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES whatsapp_conversations(id),contact_id uuid,direction text,text text,channel_id text,woztell_member_id text)`,
        `CREATE TABLE inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text DEFAULT 'website',name text NOT NULL,crm_contact_id uuid,property_id uuid REFERENCES properties(id),status text DEFAULT 'new',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
        `CREATE TABLE whatsapp_enquiry_events(id uuid PRIMARY KEY,message_id uuid REFERENCES whatsapp_messages(id),kind text,origin text,capture_mode text,effects_eligible boolean,channel_id text,member_id text,occurred_at timestamptz,received_at timestamptz,processing_state text DEFAULT 'pending')`,
      ])
        await query(statement);
      await query("INSERT INTO inquiries(name) VALUES($1)", ["legacy website"]);
      await migrate();
      await migrate();
      await query("INSERT INTO staff_users VALUES($1,true)", [staff]);
      await query("INSERT INTO properties(id) VALUES($1),($2)", [p, p2]);
      await query("INSERT INTO crm_contacts VALUES($1,NULL),($2,NULL)", [a, b]);
      await query("INSERT INTO whatsapp_conversations(id,contact_id) VALUES($1,$2),($3,$4)", [
        conv,
        a,
        other,
        b,
      ]);
      await query("INSERT INTO crm_leads VALUES($1,$2,'unrelated','qualified')", [randomUUID(), a]);
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
          assert.equal((await query("SELECT stage FROM crm_leads"))[0].stage, "qualified");
          await assert.rejects(
            query("UPDATE inquiries SET effects_eligible=true WHERE id=$1", [first]),
          );
        },
      );
      await t.test("AT-24 followups preserve root clock", async () => {
        const before = (await query("SELECT * FROM inquiries WHERE id=$1", [first]))[0];
        const eid = await event("when can I view?");
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
          for (const body of ["hello", "EPWA:" + ref + " EPWA:" + "b".repeat(32), "EPWA:bad"]) {
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
        "AT-17/18 registry CRUD versions and batched exact sale/rent current offerings",
        async () => {
          const saved = { ...process.env };
          Object.assign(process.env, {
            EP_WA_COMPANY_CHANNEL_ID: "fixture",
            EP_WA_TRACKED_LINKS_ENABLED: "true",
            EP_WA_COMPANY_PHONE: "85212345678",
          });
          try {
            await query(
              "UPDATE properties SET title_zh='Synthetic public offer',status='active',deal_type=CASE WHEN id=$1 THEN 'sale' ELSE 'rent' END",
              [p],
            );
            await query("INSERT INTO property_public_members VALUES($1,'G1'),($2,'G1')", [p, p2]);
            const actor = { staffId: staff, roles: ["admin"] },
              deps = { query, transaction: tx },
              registered = [];
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
                  },
                  actor,
                  deps,
                ),
              );
            const rent = await saveTrackingLink(
              {
                placementSource: "website",
                entryPointType: "sales",
                publicListingNo: "G1",
                propertyId: p2,
                dealType: "rent",
                enabled: true,
              },
              actor,
              deps,
            );
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
            const offers = [
              { propertyId: p, publicListingNo: "G1", dealType: "sale" },
              { propertyId: p2, publicListingNo: "G1", dealType: "rent" },
            ];
            const resolved = await resolveTrackingLinks(offers, query);
            assert.equal(resolved.links[0].href, "/w/" + registered[0].code);
            assert.equal(resolved.links[1].href, "/w/" + rent.code);
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
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  },
);
