import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { observeEpisode } from "./episodes.server.ts";
import { associatePortalEnquiry } from "./enquiry-association.server.ts";

const sample = JSON.parse(
  readFileSync(new URL("./fixtures/portal-enquiries.json", import.meta.url), "utf8"),
).golden28hse;
const episodeSql = readFileSync(
  new URL("../../../neon/migrations/20260912130000_whatsapp_enquiry_episodes.sql", import.meta.url),
  "utf8",
);
const serviceSql = readFileSync(
  new URL("../../../neon/migrations/20260912150000_whatsapp_service_workflow.sql", import.meta.url),
  "utf8",
);
const latestFunction = serviceSql.match(
  /CREATE OR REPLACE FUNCTION wa_observe_episode[\s\S]*?END \$\$;/,
)?.[0];

test("P05 positive: second distinct listing cannot silently reuse first unknown root", async () => {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean DEFAULT true);
      CREATE TABLE properties(id uuid PRIMARY KEY,title_zh text,agent_id uuid,status text,deal_type text,source_updated_at timestamptz,last_seen_at timestamptz,updated_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE property_public_members(property_id uuid,public_listing_no text);
      CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text);
      CREATE TABLE crm_leads(id uuid PRIMARY KEY,contact_id uuid,source text,stage text);
      CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,assigned_agent_id uuid);
      CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES whatsapp_conversations(id),contact_id uuid,direction text,text text,channel_id text,woztell_member_id text);
      CREATE TABLE inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text DEFAULT 'website',name text NOT NULL,crm_contact_id uuid,property_id uuid REFERENCES properties(id),status text DEFAULT 'new',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE listing_source_observations(id uuid PRIMARY KEY,validation_state text);
      CREATE TABLE property_source_links(source text,external_listing_id text,deal_type text,status text);
      CREATE TABLE mls_source_state(source text,scope_id text,external_listing_id text,deal_type text,property_id uuid,observation_id uuid,policy_version text,last_accepted_at timestamptz,source_status text);
      CREATE TABLE staff_external_references(id uuid,namespace text,external_reference text,staff_id uuid,mapping_version integer,valid_from timestamptz,valid_until timestamptz,verified_at timestamptz);
      CREATE TABLE whatsapp_enquiry_events(id uuid PRIMARY KEY,message_id uuid REFERENCES whatsapp_messages(id),kind text,origin text,capture_mode text,effects_eligible boolean,channel_id text,member_id text,occurred_at timestamptz,received_at timestamptz,processing_state text DEFAULT 'pending',activation_id uuid);`);
    await db.exec(episodeSql);
    await db.exec("ALTER TABLE inquiries ADD COLUMN activation_id uuid");
    await db.exec(latestFunction);
    const contact = randomUUID(),
      conversation = randomUUID();
    await query("INSERT INTO crm_contacts VALUES($1,$2)", [contact, "Synthetic Customer"]);
    await query("INSERT INTO whatsapp_conversations(id,contact_id) VALUES($1,$2)", [
      conversation,
      contact,
    ]);
    async function add(text, withSnapshot = true) {
      const message = randomUUID(),
        event = randomUUID();
      await query(
        "INSERT INTO whatsapp_messages VALUES($1,$2,$3,'inbound',$4,'synthetic-company','synthetic-customer')",
        [message, conversation, contact, text],
      );
      await query(
        "INSERT INTO whatsapp_enquiry_events(id,message_id,kind,origin,capture_mode,effects_eligible,channel_id,member_id,occurred_at,received_at) VALUES($1,$2,'customer_message','live_webhook','observe',false,'synthetic-company','synthetic-customer',now(),now())",
        [event, message],
      );
      return event;
    }
    const first = await add(sample);
    const firstInquiry = await observeEpisode(first, query);
    assert.equal(await observeEpisode(first, query), firstInquiry);
    const second = await add(
      sample.replaceAll("4033349", "4999999").replace("碧堤半島", "另一屋苑"),
    );
    const secondInquiry = await observeEpisode(second, query);
    assert.ok(secondInquiry === null || secondInquiry !== firstInquiry);
    assert.equal(
      (
        await query("SELECT association_review FROM whatsapp_enquiry_events WHERE id=$1", [second])
      )[0].association_review,
      true,
    );
  } finally {
    await db.close();
  }
});

const receiptMigration = readFileSync(
  new URL("../../../neon/migrations/20260929100000_whatsapp_inbound_receipts.sql", import.meta.url),
  "utf8",
);
const resolutionMigration = readFileSync(
  new URL(
    "../../../neon/migrations/20260929102000_whatsapp_portal_resolution.sql",
    import.meta.url,
  ),
  "utf8",
);
const associationMigration = readFileSync(
  new URL("../../../neon/migrations/20260929103000_whatsapp_no_link_episodes.sql", import.meta.url),
  "utf8",
);

async function withAssociationDb(fn) {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean DEFAULT true);
      CREATE TABLE properties(id uuid PRIMARY KEY,title_zh text,agent_id uuid,status text,deal_type text,source_updated_at timestamptz,last_seen_at timestamptz,updated_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE property_public_members(property_id uuid,public_listing_no text);
      CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text);
      CREATE TABLE crm_leads(id uuid PRIMARY KEY,contact_id uuid,source text,stage text);
      CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,assigned_agent_id uuid);
      CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES whatsapp_conversations(id),contact_id uuid,direction text,text text,channel_id text,woztell_member_id text);
      CREATE TABLE inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text DEFAULT 'website',name text NOT NULL,crm_contact_id uuid,property_id uuid REFERENCES properties(id),status text DEFAULT 'new',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE listing_source_observations(id uuid PRIMARY KEY,validation_state text);
      CREATE TABLE property_source_links(source text,external_listing_id text,deal_type text,status text);
      CREATE TABLE mls_source_state(source text,scope_id text,external_listing_id text,deal_type text,property_id uuid,observation_id uuid,policy_version text,last_accepted_at timestamptz,source_status text);
      CREATE TABLE staff_external_references(id uuid,namespace text,external_reference text,staff_id uuid,mapping_version integer,valid_from timestamptz,valid_until timestamptz,verified_at timestamptz);
      CREATE TABLE whatsapp_enquiry_events(id uuid PRIMARY KEY,message_id uuid REFERENCES whatsapp_messages(id),kind text,origin text,capture_mode text,effects_eligible boolean,channel_id text,member_id text,app_id text,external_message_id text,occurred_at timestamptz,received_at timestamptz,processing_state text DEFAULT 'pending',activation_id uuid);`);
    await db.exec(episodeSql);
    await db.exec("ALTER TABLE inquiries ADD COLUMN activation_id uuid");
    await db.exec(latestFunction);
    await db.exec(receiptMigration);
    await db.exec(resolutionMigration);
    await db.exec(associationMigration);
    const contact = randomUUID(),
      conversation = randomUUID();
    await query("INSERT INTO crm_contacts VALUES($1,'Synthetic Customer')", [contact]);
    await query("INSERT INTO whatsapp_conversations(id,contact_id) VALUES($1,$2)", [
      conversation,
      contact,
    ]);
    async function add(text, withSnapshot = true) {
      const message = randomUUID(),
        event = randomUUID(),
        receipt = randomUUID();
      const identity = `wa:${event}`;
      await query(
        "INSERT INTO whatsapp_messages VALUES($1,$2,$3,'inbound',$4,'synthetic-company','synthetic-customer')",
        [message, conversation, contact, text],
      );
      await query(
        "INSERT INTO whatsapp_enquiry_events(id,message_id,kind,origin,capture_mode,effects_eligible,channel_id,member_id,app_id,external_message_id,occurred_at,received_at) VALUES($1,$2,'customer_message','live_webhook','observe',false,'synthetic-company','synthetic-customer','synthetic-app',$3,now(),now())",
        [event, message, identity],
      );
      await query(
        "INSERT INTO whatsapp_inbound_receipts(id,tenant_key,provider,app_id,channel_id,member_id,event_kind,origin,identity_key,similarity_key,normalized_event,body_digest,capture_mode,received_at) VALUES($1,'tenant','woztell','synthetic-app','synthetic-company','synthetic-customer','customer_message','live_webhook',$2,'similar','{}','digest','observe',now())",
        [receipt, identity],
      );
      const interpretation = withSnapshot
        ? (
            await query(
              "INSERT INTO whatsapp_portal_interpretations(receipt_id,parser_version,interpretation,resolution) VALUES($1,'portal-intake-v1','{}','[]') RETURNING id",
              [receipt],
            )
          )[0].id
        : null;
      return { event, receipt, interpretation };
    }
    await fn({ query, add });
  } finally {
    await db.close();
  }
}

function ref(id) {
  return {
    referenceKey: "a".repeat(60) + id.slice(-4).padStart(4, "0"),
    source: "28hse",
    scopeId: "agent:540",
    externalListingId: id,
    dealType: "sale",
    propertyId: null,
  };
}

test("two no-link listing events produce separate roots, replay is idempotent", async () => {
  await withAssociationDb(async ({ query, add }) => {
    const a = await add(sample);
    const b = await add(sample.replaceAll("4033349", "4999999"));
    const [ar] = await query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb) AS id", [
      a.event,
      a.receipt,
      a.interpretation,
      JSON.stringify([ref("4033349")]),
    ]);
    const [br] = await query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb) AS id", [
      b.event,
      b.receipt,
      b.interpretation,
      JSON.stringify([ref("4999999")]),
    ]);
    assert.notEqual(ar.id, br.id);
    assert.equal((await query("SELECT count(*)::int AS n FROM inquiries"))[0].n, 2);
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM whatsapp_enquiry_reference_links"))[0].n,
      2,
    );
    assert.equal(
      (
        await query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb) AS id", [
          b.event,
          b.receipt,
          b.interpretation,
          JSON.stringify([ref("4999999")]),
        ])
      )[0].id,
      br.id,
    );
    assert.equal((await query("SELECT count(*)::int AS n FROM inquiries"))[0].n, 2);
    assert.equal(
      (
        await query(
          "SELECT bool_and(association_review) AS review,bool_or(effects_eligible) AS effects FROM inquiries",
        )
      )[0].review,
      true,
    );
    assert.equal(
      (await query("SELECT bool_or(effects_eligible) AS effects FROM inquiries"))[0].effects,
      false,
    );
  });
});

test("one message with two references preserves both, second stays review", async () => {
  await withAssociationDb(async ({ query, add }) => {
    const a = await add(sample);
    await query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb)", [
      a.event,
      a.receipt,
      a.interpretation,
      JSON.stringify([ref("4033349"), ref("4999999")]),
    ]);
    const links = await query(
      "SELECT ref_index,external_listing_id,inquiry_id,association_review FROM whatsapp_enquiry_reference_links ORDER BY ref_index",
    );
    assert.equal(links.length, 2);
    assert.ok(links[0].inquiry_id);
    assert.equal(links[1].inquiry_id, null);
    assert.equal(links[1].association_review, true);
  });
});

test("projected portal events without a mapping still create distinct review roots and immutable interpretations", async () => {
  await withAssociationDb(async ({ query, add }) => {
    const a = await add(sample, false);
    const b = await add(sample.replaceAll("4033349", "4999999"), false);
    const first = await associatePortalEnquiry(a.event, query);
    const second = await associatePortalEnquiry(b.event, query);
    assert.equal(first.handled, true);
    assert.equal(second.handled, true);
    assert.notEqual(first.inquiryId, second.inquiryId);
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM whatsapp_portal_interpretations"))[0].n,
      2,
    );
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM whatsapp_enquiry_reference_links"))[0].n,
      2,
    );
    assert.equal(
      (
        await query(
          "SELECT bool_and(association_review) AS review,bool_or(effects_eligible) AS effects FROM inquiries",
        )
      )[0].review,
      true,
    );
    assert.equal(
      (await query("SELECT bool_or(effects_eligible) AS effects FROM inquiries"))[0].effects,
      false,
    );
  });
});

test("same reference continues its open enquiry; a closed enquiry starts a new root", async () => {
  await withAssociationDb(async ({ query, add }) => {
    const a = await add(sample);
    const first = (
      await query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb) AS id", [
        a.event,
        a.receipt,
        a.interpretation,
        JSON.stringify([ref("4033349")]),
      ])
    )[0].id;
    const continued = await add(sample);
    const same = (
      await query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb) AS id", [
        continued.event,
        continued.receipt,
        continued.interpretation,
        JSON.stringify([ref("4033349")]),
      ])
    )[0].id;
    assert.equal(same, first);
    assert.equal((await query("SELECT count(*)::int AS n FROM inquiries"))[0].n, 1);
    await query("UPDATE inquiries SET status='closed' WHERE id=$1", [first]);
    const afterClose = await add(sample);
    const fresh = (
      await query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb) AS id", [
        afterClose.event,
        afterClose.receipt,
        afterClose.interpretation,
        JSON.stringify([ref("4033349")]),
      ])
    )[0].id;
    assert.notEqual(fresh, first);
    assert.equal((await query("SELECT count(*)::int AS n FROM inquiries"))[0].n, 2);
  });
});

test("wrong receipt scope is rejected before any enquiry write", async () => {
  await withAssociationDb(async ({ query, add }) => {
    const a = await add(sample);
    const b = await add(sample);
    await assert.rejects(
      () =>
        query("SELECT wa_associate_no_link($1,$2,$3,$4::jsonb)", [
          a.event,
          b.receipt,
          b.interpretation,
          JSON.stringify([ref("4033349")]),
        ]),
      /WA_PORTAL_RECEIPT_SCOPE_INVALID/,
    );
    assert.equal((await query("SELECT count(*)::int AS n FROM inquiries"))[0].n, 0);
  });
});

test("golden P1 and verified requested S1 are stored without changing conversation assignee", async () => {
  await withAssociationDb(async ({ query, add }) => {
    const staff = "22222222-2222-4222-8222-222222222222";
    const otherOwner = "33333333-3333-4333-8333-333333333333";
    const property = "11111111-1111-4111-8111-111111111111";
    const observation = "44444444-4444-4444-8444-444444444444";
    await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [staff]);
    await query("INSERT INTO properties(id,status,agent_id) VALUES($1,'active',$2)", [
      property,
      staff,
    ]);
    await query("INSERT INTO property_public_members VALUES($1,'P1')", [property]);
    await query("INSERT INTO listing_source_observations VALUES($1,'valid')", [observation]);
    await query(
      "INSERT INTO property_source_links VALUES('28hse_agent_540','4033349','sale','active')",
    );
    await query(
      "INSERT INTO mls_source_state VALUES('28hse_agent_540','agent:540','4033349','sale',$1,$2,'v1',now(),'active')",
      [property, observation],
    );
    await query(
      "INSERT INTO staff_external_references VALUES($1,'28hse/account540','鄧錦雄 Terence Tang',$2,1,now()-interval '1 day',null,now()-interval '1 day')",
      ["55555555-5555-4555-8555-555555555555", staff],
    );
    await query(
      "INSERT INTO whatsapp_portal_source_scopes(channel_id,source,scope_id,staff_namespace,enabled,verified_by,verified_at,verification_ref) VALUES('synthetic-company','28hse_agent_540','agent:540','28hse/account540',true,$1,now()-interval '1 day','synthetic-review')",
      [staff],
    );
    const a = await add(sample, false);
    const [conversation] = await query(
      "SELECT conversation_id FROM whatsapp_messages WHERE id=(SELECT message_id FROM whatsapp_enquiry_events WHERE id=$1)",
      [a.event],
    );
    await query("UPDATE whatsapp_conversations SET assigned_agent_id=$1 WHERE id=$2", [
      otherOwner,
      conversation.conversation_id,
    ]);
    const decision = await associatePortalEnquiry(a.event, query);
    assert.equal(decision.handled, true);
    const [enquiry] = await query(
      "SELECT property_id,requested_staff_id,association_review,effects_eligible FROM inquiries WHERE id=$1",
      [decision.inquiryId],
    );
    assert.equal(enquiry.property_id, property);
    assert.equal(enquiry.requested_staff_id, staff);
    assert.equal(enquiry.association_review, true);
    assert.equal(enquiry.effects_eligible, false);
    assert.equal(
      (
        await query("SELECT assigned_agent_id FROM whatsapp_conversations WHERE id=$1", [
          conversation.conversation_id,
        ])
      )[0].assigned_agent_id,
      otherOwner,
    );
    const [snapshot] = await query(
      "SELECT resolution FROM whatsapp_portal_interpretations WHERE receipt_id=$1",
      [a.receipt],
    );
    assert.equal(snapshot.resolution[0].publicationOwnerId, staff);
    assert.equal(snapshot.resolution[0].reference.externalListingId, "4033349");
  });
});
