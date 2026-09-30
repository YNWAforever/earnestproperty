import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  enquiry: "11111111-1111-4111-8111-111111111111",
  conversation: "22222222-2222-4222-8222-222222222222",
  branch: "33333333-3333-4333-8333-333333333333",
  s1: "44444444-4444-4444-8444-444444444444",
  s2: "55555555-5555-4555-8555-555555555555",
  message: "66666666-6666-4666-8666-666666666666",
  intent: "77777777-7777-4777-8777-777777777777",
};
async function fixture(fn) {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,branch_id uuid);
      CREATE TABLE staff_roles(staff_user_id uuid,role text);
      CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,assigned_agent_id uuid,confirmed_staff_id uuid);
      CREATE TABLE inquiries(id uuid PRIMARY KEY,source text,conversation_id uuid,link_open_id uuid,
        attribution_method text,status text,association_review boolean,
        updated_at timestamptz DEFAULT now());
      CREATE TABLE whatsapp_enquiry_events(id uuid PRIMARY KEY);
      CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,direction text,status text,
        external_message_id text);
      CREATE TABLE whatsapp_outbound_intents(id uuid PRIMARY KEY,message_id uuid,
        enquiry_id uuid,actor_staff_id uuid,actor_type text,state text,
        external_message_id text,dispatch_started_at timestamptz);
      CREATE TABLE human_credit(message_id uuid PRIMARY KEY);
      CREATE FUNCTION wa_credit_human_response(uuid,uuid,uuid,timestamptz,text,text)
        RETURNS boolean LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO human_credit VALUES($2) ON CONFLICT DO NOTHING; RETURN true; END $$;
      CREATE FUNCTION wa_credit_accepted_intent() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.state='accepted' THEN
          PERFORM wa_credit_human_response(NEW.enquiry_id,NEW.message_id,
            NEW.actor_staff_id,NEW.dispatch_started_at,NEW.external_message_id,'authenticated_intent');
        END IF; RETURN NEW; END $$;
      CREATE TRIGGER wa_intent_human_response AFTER UPDATE ON whatsapp_outbound_intents
        FOR EACH ROW EXECUTE FUNCTION wa_credit_accepted_intent();`);
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260929104000_whatsapp_enquiry_access.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260929105000_whatsapp_no_link_effects.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260930090000_whatsapp_no_link_source_authority.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await query("INSERT INTO staff_users VALUES($1,true,$3),($2,true,$3)", [
      ids.s1,
      ids.s2,
      ids.branch,
    ]);
    await query("INSERT INTO staff_roles VALUES($1,'agent'),($2,'agent')", [ids.s1, ids.s2]);
    await query("INSERT INTO whatsapp_conversations VALUES($1,$2,$2)", [ids.conversation, ids.s1]);
    await query(
      "INSERT INTO inquiries(id,source,conversation_id,attribution_method,status,association_review,enquiry_owner_staff_id,provider_thread_review) VALUES($1,'whatsapp',$2,'explicit_customer_statement','new',true,$3,false)",
      [ids.enquiry, ids.conversation, ids.s1],
    );
    await fn({
      query,
      exec: (sql) => db.exec(sql),
      transaction: async (statements) => {
        await db.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements)
            results.push(await query(statement.statement, statement.params ?? []));
          await db.exec("COMMIT");
          return results;
        } catch (error) {
          await db.exec("ROLLBACK");
          throw error;
        }
      },
    });
  } finally {
    await db.close();
  }
}

test("no-link SQL reply requires reviewed enquiry and provider-confirmed whole-thread assignee", async () => {
  await fixture(async ({ query }) => {
    const can = async (staff) =>
      (await query("SELECT wa_can_reply_enquiry($1,$2) allowed", [staff, ids.enquiry]))[0].allowed;
    assert.equal(await can(ids.s1), false);
    await query("UPDATE inquiries SET association_review=false WHERE id=$1", [ids.enquiry]);
    assert.equal(await can(ids.s1), true);
    assert.equal(await can(ids.s2), false);
    await query("UPDATE whatsapp_conversations SET confirmed_staff_id=NULL WHERE id=$1", [
      ids.conversation,
    ]);
    assert.equal(await can(ids.s1), false);
    await query("UPDATE whatsapp_conversations SET confirmed_staff_id=$2 WHERE id=$1", [
      ids.conversation,
      ids.s1,
    ]);
    await query("UPDATE staff_users SET active=false WHERE id=$1", [ids.s1]);
    assert.equal(await can(ids.s1), false);
  });
});

test("provider accepted is not human reply; delivered/read receipt credits once", async () => {
  await fixture(async ({ query }) => {
    await query("INSERT INTO whatsapp_messages VALUES($1,'outbound','queued','provider-1')", [
      ids.message,
    ]);
    await query(
      "INSERT INTO whatsapp_outbound_intents VALUES($1,$2,$3,$4,'staff','dispatching','provider-1',now())",
      [ids.intent, ids.message, ids.enquiry, ids.s1],
    );
    await query("UPDATE whatsapp_outbound_intents SET state='accepted' WHERE id=$1", [ids.intent]);
    assert.equal((await query("SELECT count(*)::int n FROM human_credit"))[0].n, 0);
    await query("UPDATE whatsapp_messages SET status='accepted' WHERE id=$1", [ids.message]);
    assert.equal((await query("SELECT count(*)::int n FROM human_credit"))[0].n, 0);
    await query("UPDATE whatsapp_messages SET status='delivered' WHERE id=$1", [ids.message]);
    assert.equal((await query("SELECT count(*)::int n FROM human_credit"))[0].n, 1);
    await query("UPDATE whatsapp_messages SET status='read' WHERE id=$1", [ids.message]);
    assert.equal((await query("SELECT count(*)::int n FROM human_credit"))[0].n, 1);
  });
});

const prepIds = {
  event: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  activation: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  property: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  mapping: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
async function setupPreparation({ query, exec }, options = {}) {
  await exec(
    "ALTER TABLE whatsapp_enquiry_events ADD COLUMN inquiry_id uuid, ADD COLUMN origin text, ADD COLUMN capture_mode text, ADD COLUMN effects_eligible boolean, ADD COLUMN notification_eligible boolean, ADD COLUMN notification_routing_eligible boolean, ADD COLUMN timing text, ADD COLUMN identity_quality text, ADD COLUMN activation_id uuid, ADD COLUMN channel_id text, ADD COLUMN evidence jsonb;",
  );
  await exec(
    "ALTER TABLE whatsapp_conversations ADD COLUMN channel_id text, ADD COLUMN pending_assignment_id uuid, ADD COLUMN assignment_version bigint DEFAULT 0, ADD COLUMN assignment_lock boolean DEFAULT false, ADD COLUMN woztell_member_id text, ADD COLUMN updated_at timestamptz DEFAULT now();",
  );
  await exec(
    "ALTER TABLE inquiries ADD COLUMN effects_eligible boolean DEFAULT false, ADD COLUMN activation_id uuid;",
  );
  await exec(
    "CREATE TABLE whatsapp_enquiry_reference_links(event_id uuid,ref_index integer,inquiry_id uuid,conversation_id uuid,resolution jsonb,property_id uuid,scope_id text,external_listing_id text,deal_type text,source text); CREATE TABLE whatsapp_enquiry_activations(id uuid PRIMARY KEY,ended_at timestamptz); CREATE TABLE whatsapp_portal_source_scopes(channel_id text,source text,scope_id text,enabled boolean,verified_at timestamptz); CREATE TABLE mls_source_state(source text,scope_id text,external_listing_id text,deal_type text,property_id uuid,source_status text,last_accepted_at timestamptz); CREATE TABLE properties(id uuid PRIMARY KEY,agent_id uuid,status text); CREATE TABLE staff_external_references(id uuid,mapping_version integer,staff_id uuid,valid_from timestamptz,valid_until timestamptz,verified_at timestamptz); CREATE TABLE whatsapp_staff_channels(staff_id uuid,channel_id text,eligible boolean,retired_at timestamptz,review_enforced boolean,review_basis text,inbox_user_id text,folder_id text,routing_node_id text); CREATE TABLE whatsapp_assignment_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid,desired_staff_id uuid,version bigint,reason text,state text DEFAULT 'pending',target_snapshot jsonb DEFAULT '{}'::jsonb,claim_id uuid,started_at timestamptz,finished_at timestamptz,evidence jsonb DEFAULT '{}'::jsonb); CREATE TABLE ops_jobs(job_type text,payload_version integer,payload jsonb,status text,max_attempts integer,run_after timestamptz,idempotency_key text UNIQUE);",
  );
  await query(
    "UPDATE whatsapp_conversations SET assigned_agent_id=NULL,confirmed_staff_id=NULL,channel_id='company',woztell_member_id='synthetic-customer' WHERE id=$1",
    [ids.conversation],
  );
  await query("UPDATE inquiries SET enquiry_owner_staff_id=NULL WHERE id=$1", [ids.enquiry]);
  await query("INSERT INTO whatsapp_enquiry_activations VALUES($1,NULL)", [prepIds.activation]);
  await query(
    "INSERT INTO whatsapp_enquiry_events VALUES($1,$2,'live_webhook',$3,$4,true,true,'fresh','provider_id',$5,'company',$6::jsonb)",
    [
      prepIds.event,
      ids.enquiry,
      options.observe ? "observe" : "active",
      !options.observe,
      prepIds.activation,
      JSON.stringify({ noLinkEffectsEligible: !options.legacyCapture }),
    ],
  );
  await query(
    "INSERT INTO whatsapp_portal_source_scopes VALUES('company','28hse_agent_540','agent:540',true,now())",
  );
  await query("INSERT INTO properties VALUES($1,$2,'active')", [prepIds.property, ids.s1]);
  await query(
    "INSERT INTO mls_source_state VALUES('28hse_agent_540','agent:540','4033349','sale',$1,'active',now())",
    [prepIds.property],
  );
  if (!options.noMapping)
    await query(
      "INSERT INTO staff_external_references VALUES($1,1,$2,now()-interval '1 day',NULL,now()-interval '1 day')",
      [prepIds.mapping, ids.s1],
    );
  await query(
    "INSERT INTO whatsapp_staff_channels VALUES($1,'company',true,NULL,true,'provider_verified','agent-inbox','verified-folder','')",
    [ids.s1],
  );
  const resolution = {
    status: "resolved",
    reasons: [],
    requestedStaffId: ids.s1,
    publicationOwnerId: ids.s1,
    snapshot: { mappingId: prepIds.mapping, mappingVersion: 1 },
  };
  await query(
    "INSERT INTO whatsapp_enquiry_reference_links VALUES($1,0,$2,$3,$4::jsonb,$5,'agent:540','4033349','sale','28hse')",
    [prepIds.event, ids.enquiry, ids.conversation, JSON.stringify(resolution), prepIds.property],
  );
}

test("active verified no-link P1/S1 queues one provider request and no tracking link", async () => {
  await fixture(async (db) => {
    await setupPreparation(db);
    const first = (
      await db.query("SELECT wa_prepare_no_link_followup($1) result", [prepIds.event])
    )[0].result;
    assert.equal(first.decision, "assignment_pending");
    const again = (
      await db.query("SELECT wa_prepare_no_link_followup($1) result", [prepIds.event])
    )[0].result;
    assert.deepEqual(again, first);
    const [inquiry] = await db.query(
      "SELECT enquiry_owner_staff_id,effects_eligible,activation_id FROM inquiries WHERE id=$1",
      [ids.enquiry],
    );
    assert.equal(inquiry.enquiry_owner_staff_id, ids.s1);
    assert.equal(inquiry.effects_eligible, true);
    assert.equal(inquiry.activation_id, prepIds.activation);
    const [conversation] = await db.query(
      "SELECT assigned_agent_id,pending_assignment_id FROM whatsapp_conversations WHERE id=$1",
      [ids.conversation],
    );
    assert.equal(conversation.assigned_agent_id, null);
    assert.ok(conversation.pending_assignment_id);
    assert.equal((await db.query("SELECT count(*)::int n FROM ops_jobs"))[0].n, 1);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM whatsapp_no_link_effect_decisions"))[0].n,
      1,
    );
  });
});

test("observe capture and expired mapping leave no-link query visible for review with zero effects", async () => {
  for (const options of [{ observe: true }, { noMapping: true }, { legacyCapture: true }]) {
    await fixture(async (db) => {
      await setupPreparation(db, options);
      const [result] = await db.query("SELECT wa_prepare_no_link_followup($1) result", [
        prepIds.event,
      ]);
      assert.equal(result.result.decision, "review");
      assert.equal(
        (await db.query("SELECT effects_eligible FROM inquiries WHERE id=$1", [ids.enquiry]))[0]
          .effects_eligible,
        false,
      );
      assert.equal((await db.query("SELECT count(*)::int n FROM ops_jobs"))[0].n, 0);
    });
  }
});

test("fake provider accepted stays unknown until authoritative readback; S1 can then reply without invented acknowledgement", async () => {
  await fixture(async (db) => {
    await setupPreparation(db);
    const prep = (
      await db.query("SELECT wa_prepare_no_link_followup($1) result", [prepIds.event])
    )[0].result;
    assert.equal(prep.decision, "assignment_pending");
    const [request] = await db.query("SELECT id FROM whatsapp_assignment_requests");
    const { executeAssignment, reconcileAssignment } = await import("./assignment.server.ts");
    let calls = 0;
    const provider = {
      execute: async ({ channelId, memberId, beforeSend }) => {
        await beforeSend();
        assert.equal(channelId, "company");
        assert.equal(memberId, "synthetic-customer");
        calls++;
        return { accepted: true };
      },
      readAuthoritativeAssignment: async () => ({
        inboxUserId: "agent-inbox",
        folderId: "verified-folder",
      }),
    };
    const ports = { query: db.query, transaction: db.transaction };
    assert.equal((await executeAssignment(request.id, provider, ports)).state, "unknown");
    assert.equal(calls, 1);
    assert.equal(
      (
        await db.query("SELECT confirmed_staff_id FROM whatsapp_conversations WHERE id=$1", [
          ids.conversation,
        ])
      )[0].confirmed_staff_id,
      null,
    );
    assert.equal((await reconcileAssignment(request.id, provider, ports)).confirmed, true);
    assert.equal(calls, 1);
    assert.equal(
      (await db.query("SELECT provider_thread_review FROM inquiries WHERE id=$1", [ids.enquiry]))[0]
        .provider_thread_review,
      false,
    );
    assert.equal(
      (await db.query("SELECT wa_can_reply_enquiry($1,$2) allowed", [ids.s1, ids.enquiry]))[0]
        .allowed,
      true,
    );
    assert.equal((await db.query("SELECT count(*)::int n FROM human_credit"))[0].n, 0);
  });
});
