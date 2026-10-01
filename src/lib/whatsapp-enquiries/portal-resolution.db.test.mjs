import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parsePortalEnquiry } from "./portal-intake.ts";
import {
  makePortalResolutionPorts,
  recordPortalInterpretation,
  resolvePortalReferences,
} from "./portal-resolution.server.ts";

const P1 = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const receipt = "33333333-3333-4333-8333-333333333333";
const at = "2026-09-29T12:00:00Z";
const input = parsePortalEnquiry(
  "鄧錦雄 Terence Tang 你好，我在 28Hse 見到這個 碧堤半島 售 $1,268 萬元 樓盤(ID:4033349)。請提供更多資料 https://www.28hse.com/buy/apartment/property-4033349?t=1790600623",
);

async function withDb(fn) {
  const db = new PGlite();
  const query = async (statement, params = []) => (await db.query(statement, params)).rows;
  try {
    await db.exec(`
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean NOT NULL);
      CREATE TABLE listing_source_observations(id uuid PRIMARY KEY,validation_state text NOT NULL);
      CREATE TABLE properties(id uuid PRIMARY KEY,status text NOT NULL,agent_id uuid);
      CREATE TABLE property_source_links(source text,external_listing_id text,deal_type text,status text);
      CREATE TABLE property_public_members(property_id uuid);
      CREATE TABLE mls_source_state(source text,scope_id text,external_listing_id text,deal_type text,property_id uuid,observation_id uuid,policy_version text,last_accepted_at timestamptz,source_status text);
      CREATE TABLE staff_external_references(id uuid,namespace text,external_reference text,staff_id uuid,mapping_version integer,valid_from timestamptz,valid_until timestamptz,verified_at timestamptz);
    `);
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260929100000_whatsapp_inbound_receipts.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260929102000_whatsapp_portal_resolution.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await query("INSERT INTO staff_users VALUES($1,true)", [S1]);
    const scopedPorts = makePortalResolutionPorts(query);
    await fn({ db, query, ports: scopedPorts });
  } finally {
    await db.close();
  }
}

test("new migration seeds no authority and signed-scope readback can resolve only after verified synthetic mapping", async () => {
  await withDb(async ({ query, ports }) => {
    const [before] = await resolvePortalReferences(input, { channelId: "company-wa", at }, ports);
    assert.ok(before.reasons.includes("scope_conflict"));
    await query(
      "INSERT INTO whatsapp_portal_source_scopes(channel_id,source,scope_id,staff_namespace,enabled,verified_by,verified_at,verification_ref) VALUES('company-wa','28hse_agent_540','agent:540','28hse/account540',true,$1,$2,'synthetic-review')",
      [S1, at],
    );
    const obs = "44444444-4444-4444-8444-444444444444";
    await query("INSERT INTO listing_source_observations VALUES($1,'valid')", [obs]);
    await query("INSERT INTO properties VALUES($1,'active',$2)", [P1, S1]);
    await query("INSERT INTO property_public_members VALUES($1)", [P1]);
    await query(
      "INSERT INTO property_source_links VALUES('28hse_agent_540','4033349','sale','active')",
    );
    await query(
      "INSERT INTO mls_source_state VALUES('28hse_agent_540','agent:540','4033349','sale',$1,$2,'v1',$3,'active')",
      [P1, obs, at],
    );
    await query(
      "INSERT INTO staff_external_references VALUES($1,'28hse/account540','鄧錦雄 Terence Tang',$2,1,'2026-01-01T00:00:00Z',null,'2026-01-01T00:00:00Z')",
      ["55555555-5555-4555-8555-555555555555", S1],
    );
    const [after] = await resolvePortalReferences(input, { channelId: "company-wa", at }, ports);
    assert.equal(after.status, "resolved");
    assert.equal(after.propertyId, P1);
    assert.equal(after.requestedStaffId, S1);
    const [other] = await resolvePortalReferences(input, { channelId: "unbound-wa", at }, ports);
    assert.ok(other.reasons.includes("scope_conflict"));
    assert.equal(other.propertyId, null);
  });
});

test("interpretation snapshots cannot be rewritten or deleted", async () => {
  await withDb(async ({ query }) => {
    await query(
      "INSERT INTO whatsapp_inbound_receipts(id,tenant_key,provider,app_id,channel_id,event_kind,origin,similarity_key,normalized_event,body_digest,capture_mode,received_at) VALUES($1,'tenant','woztell','app','channel','customer_message','live_webhook','similar','{}','digest','observe',$2)",
      [receipt, at],
    );
    await query(
      "INSERT INTO whatsapp_portal_interpretations(receipt_id,parser_version,interpretation,resolution) VALUES($1,'portal-intake-v1',$2::jsonb,'[]'::jsonb)",
      [receipt, JSON.stringify(input)],
    );
    await assert.rejects(
      () =>
        query(
          "UPDATE whatsapp_portal_interpretations SET parser_version='v2' WHERE receipt_id=$1",
          [receipt],
        ),
      /WA_PORTAL_INTERPRETATION_IMMUTABLE/,
    );
    await assert.rejects(
      () => query("DELETE FROM whatsapp_portal_interpretations WHERE receipt_id=$1", [receipt]),
      /WA_PORTAL_INTERPRETATION_IMMUTABLE/,
    );
  });
});

test("same parser-version snapshot is idempotent and changed evidence conflicts", async () => {
  await withDb(async ({ query }) => {
    await query(
      "INSERT INTO whatsapp_inbound_receipts(id,tenant_key,provider,app_id,channel_id,event_kind,origin,similarity_key,normalized_event,body_digest,capture_mode,received_at) VALUES($1,'tenant','woztell','app','channel','customer_message','live_webhook','similar','{}','digest','observe',$2)",
      [receipt, at],
    );
    const id = await recordPortalInterpretation(receipt, input, [], query);
    assert.equal(await recordPortalInterpretation(receipt, input, [], query), id);
    await assert.rejects(
      () => recordPortalInterpretation(receipt, { ...input, estateText: "Other" }, [], query),
      /PORTAL_INTERPRETATION_VERSION_CONFLICT/,
    );
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM whatsapp_portal_interpretations"))[0].n,
      1,
    );
  });
});
