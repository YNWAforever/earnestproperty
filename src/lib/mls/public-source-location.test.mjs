import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readPublicSourceLocation } from "./public-source-location.mjs";

// Entirely synthetic, memory-only SQL. No connection string, files or network.
const id = "00000000-0000-0000-0000-000000000001";
const peer = "00000000-0000-0000-0000-000000000002";
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE properties(id uuid, status text, deal_type text, canonical_property_no text,
      ingestion_owner text, ingestion_identity_policy text);
    CREATE TABLE property_public_members(property_id uuid, public_listing_no text);
    CREATE TABLE property_public_groups(public_listing_no text, canonical_property_no text, review_required boolean);
    CREATE TABLE mls_source_state(property_id uuid, source text, external_listing_id text,
      deal_type text, scope_id text, policy_version text, observation_id text, source_status text,
      raw_identity jsonb, unit_key text, last_accepted_at timestamptz);
    CREATE TABLE listing_source_observations(id text, source text, external_listing_id text,
      deal_type text, validation_state text, payload jsonb);
    CREATE TABLE property_source_links(property_id uuid, source text, external_listing_id text,
      deal_type text, status text);
    CREATE TABLE mls_ingestion_policies(source text, scope_id text, policy_version text,
      owner text, publish_enabled boolean, config jsonb);
    CREATE TABLE mls_ingestion_reviews(source text, external_listing_id text, deal_type text, status text);
    CREATE TABLE mls_ingestion_conflicts(property_id uuid, field_name text, review_status text);
    CREATE TABLE property_sync_fields(property_id uuid, field_name text, active_override boolean,
      selection_reason text);
    CREATE TABLE admin_property_overrides(property_no text, shared jsonb, sale jsonb, rent jsonb);
  `);
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(`TRUNCATE properties,property_public_members,property_public_groups,
    mls_source_state,listing_source_observations,property_source_links,mls_ingestion_policies,
    mls_ingestion_reviews,mls_ingestion_conflicts,property_sync_fields,admin_property_overrides;
    INSERT INTO properties VALUES('${id}','active','sale','TEST100','no-hermes-v2','no-hermes-v2');
    INSERT INTO property_public_members VALUES('${id}','TEST100');
    INSERT INTO property_public_groups VALUES('TEST100','TEST100',false);
    INSERT INTO mls_ingestion_policies VALUES('28hse_agent_540','agent:540','no-hermes-v2',
      'no-hermes-v2',true,'{"company_number_identity":{"approved":true,"version":"company-number-v1","approved_by":"synthetic-test"}}');
  `);
  await addSource();
});

async function addSource({
  propertyId = id,
  externalId = "1001",
  deal = "sale",
  source = "28hse_agent_540",
  fields = {},
} = {}) {
  const identity = {
    estate: "Synthetic Estate",
    district: "Synthetic District",
    block: "9",
    phase: "2A",
    floor: "LOW",
    unit: null,
    agency_property_no: "TEST100",
    ...fields,
  };
  const payload = {
    schemaVersion: 2,
    policyVersion: "no-hermes-v2",
    holdProjection: false,
    identity,
    fields: identity,
    sourceStatus: "active",
  };
  await db.query("INSERT INTO listing_source_observations VALUES($1,$2,$3,$4,'valid',$5)", [
    externalId,
    source,
    externalId,
    deal,
    payload,
  ]);
  await db.query(
    "INSERT INTO mls_source_state VALUES($1,$2,$3,$4,'agent:540','no-hermes-v2',$3,'active',$5,null,'2026-10-01T00:00:00Z')",
    [propertyId, source, externalId, deal, identity],
  );
  await db.query("INSERT INTO property_source_links VALUES($1,$2,$3,$4,'active')", [
    propertyId,
    source,
    externalId,
    deal,
  ]);
}

async function read(ids = [id]) {
  const statements = [];
  await db.exec("BEGIN READ ONLY");
  try {
    return await readPublicSourceLocation(
      async (sql, params) => {
        assert.match(sql.trim(), /^(SELECT|WITH)\b/i, "public enrichment must be read-only");
        statements.push(sql);
        assert.ok(statements.length <= 2, "one schema probe and one bounded read");
        return (await db.query(sql, params)).rows;
      },
      id,
      ids,
    );
  } finally {
    await db.exec("ROLLBACK");
  }
}

async function setFloorEvidence(value, previous = "", observed = "") {
  await db.query(
    "UPDATE mls_source_state SET raw_identity=jsonb_set(raw_identity,'{floor}',$1::jsonb)",
    [JSON.stringify(previous)],
  );
  await db.query(
    `UPDATE listing_source_observations SET payload=jsonb_set(
      jsonb_set(payload,'{identity,floor}',$1::jsonb),'{fields,floor}',$2::jsonb)`,
    [JSON.stringify(observed), JSON.stringify(value)],
  );
}

for (const band of ["高層", "中層", "低層", "HIGH", "MID", "LOW"]) {
  for (const unknown of [null, ""]) {
    test(`${band} with ${JSON.stringify(unknown)} exact floor exposes only verified block/phase`, async () => {
      await setFloorEvidence(band, unknown, unknown);
      const before = (await db.query("SELECT payload FROM listing_source_observations")).rows;
      assert.deepEqual(await read(), { block: "9", phase: "2A" });
      assert.deepEqual(
        (await db.query("SELECT payload FROM listing_source_observations")).rows,
        before,
      );
    });
  }
}

for (const [previous, observed] of [
  [null, ""],
  ["", null],
]) {
  test(`mixed ${JSON.stringify(previous)}/${JSON.stringify(observed)} unknown floors accept a display band`, async () => {
    await setFloorEvidence("低層", previous, observed);
    assert.deepEqual(await read(), { block: "9", phase: "2A" });
  });
}

test("omitted exact floor keys remain unknown rather than rejecting a display band", async () => {
  await setFloorEvidence("低層");
  await db.exec(`UPDATE mls_source_state SET raw_identity=raw_identity-'floor';
    UPDATE listing_source_observations SET payload=jsonb_set(payload,'{identity}',(payload->'identity')-'floor');`);
  assert.deepEqual(await read(), { block: "9", phase: "2A" });
});

for (const [reason, value, previous, observed] of [
  ["different exact floor in display fields", "12", "13", "13"],
  ["different exact floor in saved identity", "13", "12", "13"],
  ["unverified exact floor", "12", "", ""],
  ["known saved floor with missing observation identity", "低層", "12", ""],
  ["band cannot validate a known exact floor", "低層", "12", "12"],
  ["band cannot validate a newly observed exact floor", "低層", "", "12"],
  ["known conflicting floor identities behind a band", "低層", "12", "13"],
  ["different saved band", "低層", "高層", ""],
  ["unsupported floor description", "PENTHOUSE", "", ""],
  ["range cannot imply an exact floor", "1-11/27", "", ""],
  ["band with an unverified numeric suffix", "低層 12", "", ""],
]) {
  test(`${reason} still suppresses source location`, async () => {
    await setFloorEvidence(value, previous, observed);
    assert.equal(await read(), null);
  });
}

test("matching exact floor remains eligible without changing its identity", async () => {
  await setFloorEvidence("12", "12", "12");
  assert.deepEqual(await read(), { block: "9", phase: "2A" });
});

test("accepted partial observations expose only block/phase without canonical columns or a new apply", async () => {
  assert.deepEqual(await read(), { block: "9", phase: "2A" });
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM listing_source_observations")).rows[0].n,
    1,
  );
});

test("matching multi-ad sources deduplicate under the existing company identity policy", async () => {
  await addSource({ externalId: "1002" });
  assert.deepEqual(await read(), { block: "9", phase: "2A" });
});

for (const [reason, sql] of [
  [
    "held identity",
    `UPDATE listing_source_observations SET payload=jsonb_set(payload,'{holdProjection}','true')`,
  ],
  [
    "unknown identity hold",
    `UPDATE listing_source_observations SET payload=payload-'holdProjection'`,
  ],
  ["invalid observation", `UPDATE listing_source_observations SET validation_state='quarantined'`],
  ["wrong observation ID", `UPDATE mls_source_state SET observation_id='absent'`],
  ["wrong source ID", `UPDATE listing_source_observations SET external_listing_id='9999'`],
  ["wrong source", `UPDATE listing_source_observations SET source='propertyhk'`],
  ["wrong observation offer", `UPDATE listing_source_observations SET deal_type='rent'`],
  ["wrong property offer", `UPDATE properties SET deal_type='rent'`],
  ["wrong scope", `UPDATE mls_source_state SET scope_id='agent:999'`],
  ["wrong state policy", `UPDATE mls_source_state SET policy_version='legacy'`],
  [
    "wrong payload policy",
    `UPDATE listing_source_observations SET payload=jsonb_set(payload,'{policyVersion}','"legacy"')`,
  ],
  [
    "wrong payload version",
    `UPDATE listing_source_observations SET payload=jsonb_set(payload,'{schemaVersion}','1')`,
  ],
  ["missing link", `DELETE FROM property_source_links`],
  ["unverified link", `UPDATE property_source_links SET status='proposed'`],
  ["wrong link property", `UPDATE property_source_links SET property_id='${peer}'`],
  ["changed company identity", `UPDATE properties SET canonical_property_no='OTHER'`],
  ["changed group identity", `UPDATE property_public_groups SET canonical_property_no='OTHER'`],
  ["group awaiting review", `UPDATE property_public_groups SET review_required=true`],
  ["unapproved company rule", `UPDATE mls_ingestion_policies SET config='{}'`],
  ["disabled publication policy", `UPDATE mls_ingestion_policies SET publish_enabled=false`],
  ["wrong owner", `UPDATE properties SET ingestion_owner='legacy'`],
  ["wrong identity owner", `UPDATE properties SET ingestion_identity_policy='legacy'`],
  ["disabled policy owner", `UPDATE mls_ingestion_policies SET owner='disabled'`],
  ["delisted source", `UPDATE mls_source_state SET source_status='delisted'`],
  ["draft property", `UPDATE properties SET status='draft'`],
  ["inactive property", `UPDATE properties SET status='inactive'`],
  [
    "open identity review",
    `INSERT INTO mls_ingestion_reviews VALUES('28hse_agent_540','1001','sale','open')`,
  ],
  [
    "unreviewed block conflict",
    `INSERT INTO mls_ingestion_conflicts VALUES('${id}','block','unreviewed')`,
  ],
  [
    "unreviewed phase conflict",
    `INSERT INTO mls_ingestion_conflicts VALUES('${id}','phase','unreviewed')`,
  ],
  [
    "unreviewed floor conflict",
    `INSERT INTO mls_ingestion_conflicts VALUES('${id}','floor','unreviewed')`,
  ],
  [
    "manual location field",
    `INSERT INTO property_sync_fields VALUES('${id}','block',true,'primary')`,
  ],
  [
    "manual ownership reason",
    `INSERT INTO property_sync_fields VALUES('${id}','phase',false,'manual_override')`,
  ],
  [
    "manual address",
    `INSERT INTO property_sync_fields VALUES('${id}','address',true,'manual_override')`,
  ],
  [
    "manual floor",
    `INSERT INTO property_sync_fields VALUES('${id}','floor',true,'manual_override')`,
  ],
  [
    "explicit empty shared override",
    `INSERT INTO admin_property_overrides VALUES('TEST100','{"block":null}','{}','{}')`,
  ],
  [
    "offer-specific override",
    `INSERT INTO admin_property_overrides VALUES('TEST100','{}','{"phase":"Manual"}','{}')`,
  ],
  [
    "offer-specific floor override",
    `INSERT INTO admin_property_overrides VALUES('TEST100','{}','{"floor":"Staff floor"}','{}')`,
  ],
  [
    "state versus observation identity",
    `UPDATE listing_source_observations SET payload=jsonb_set(payload,'{identity,block}','"7"')`,
  ],
  [
    "field versus identity",
    `UPDATE listing_source_observations SET payload=jsonb_set(payload,'{fields,block}','"7"')`,
  ],
]) {
  test(`${reason} suppresses new source location instead of bypassing a safety gate`, async () => {
    await db.exec(sql);
    assert.equal(await read(), null);
  });
  test(`${reason} still suppresses location with an unknown exact floor and a display band`, async () => {
    await setFloorEvidence("低層");
    await db.exec(sql);
    assert.equal(await read(), null);
  });
}

test("multi-ad ambiguity is held even before a durable conflict has been written", async () => {
  await addSource({ externalId: "1002", fields: { block: "8" } });
  assert.equal(await read(), null);
});

test("matching multi-ad floor bands do not create an exact floor identity", async () => {
  await addSource({ externalId: "1002" });
  await setFloorEvidence("低層");
  assert.deepEqual(await read(), { block: "9", phase: "2A" });
  await db.query(
    "UPDATE listing_source_observations SET payload=jsonb_set(payload,'{fields,floor}',$1::jsonb) WHERE id='1002'",
    [JSON.stringify("高層")],
  );
  assert.equal(await read(), null);
});

test("sale/rent display bands must still agree when exact floors are unknown", async () => {
  await db.exec(`INSERT INTO properties VALUES('${peer}','active','rent','TEST100','no-hermes-v2','no-hermes-v2');
    INSERT INTO property_public_members VALUES('${peer}','TEST100');`);
  await addSource({ propertyId: peer, externalId: "1002", deal: "rent" });
  await setFloorEvidence("低層");
  assert.deepEqual(await read([id, peer]), { block: "9", phase: "2A" });
  await db.query(
    "UPDATE listing_source_observations SET payload=jsonb_set(payload,'{fields,floor}',$1::jsonb) WHERE id='1002'",
    [JSON.stringify("高層")],
  );
  assert.equal(await read([id, peer]), null);
});

test("active sale/rent members must agree and must not inherit another public group's location", async () => {
  await db.exec(`INSERT INTO properties VALUES('${peer}','active','rent','TEST100','no-hermes-v2','no-hermes-v2');
    INSERT INTO property_public_members VALUES('${peer}','TEST100');`);
  await addSource({ propertyId: peer, externalId: "1002", deal: "rent" });
  assert.deepEqual(await read([id, peer]), { block: "9", phase: "2A" });
  await db.exec(
    `UPDATE property_public_members SET public_listing_no='OTHER' WHERE property_id='${peer}'`,
  );
  assert.equal(await read([id, peer]), null);
});

test("conflicting physical facts across active offers are not combined", async () => {
  await db.exec(`INSERT INTO properties VALUES('${peer}','active','rent','TEST100','no-hermes-v2','no-hermes-v2');
    INSERT INTO property_public_members VALUES('${peer}','TEST100');`);
  await addSource({ propertyId: peer, externalId: "1002", deal: "rent", fields: { block: "8" } });
  assert.equal(await read([id, peer]), null);
});

for (const [field, other] of [
  ["estate", "Other Estate"],
  ["district", "Other District"],
  ["floor", "HIGH"],
  ["unit", "B"],
]) {
  test(`matching block/phase cannot hide a cross-offer ${field} identity conflict`, async () => {
    await db.exec("TRUNCATE mls_source_state,listing_source_observations,property_source_links");
    await addSource({ fields: { unit: "A" } });
    await db.exec(`INSERT INTO properties VALUES('${peer}','active','rent','TEST100','no-hermes-v2','no-hermes-v2');
      INSERT INTO property_public_members VALUES('${peer}','TEST100');`);
    await addSource({
      propertyId: peer,
      externalId: "1002",
      deal: "rent",
      fields: { unit: "A", [field]: other },
    });
    assert.equal(await read([id, peer]), null);
  });
}

test("missing phase stays null and floor ranges never become a phase or a block", async () => {
  await db.exec("TRUNCATE mls_source_state,listing_source_observations,property_source_links");
  await addSource({ fields: { phase: null, floor: "LOW (1-11/27)" } });
  assert.deepEqual(await read(), { block: "9", phase: null });
  await db.exec("TRUNCATE mls_source_state,listing_source_observations,property_source_links");
  await addSource({ fields: { block: null, phase: null, floor: "LOW (1-11/27)" } });
  assert.equal(await read(), null);
});

test("unrelated manual description and images remain untouched and do not veto location", async () => {
  await setFloorEvidence("低層");
  await db.exec(`INSERT INTO property_sync_fields VALUES('${id}','description',true,'manual_override');
    INSERT INTO admin_property_overrides VALUES('TEST100','{"description":"Staff text","images":[]}','{}','{}');`);
  const before = (await db.query("SELECT * FROM admin_property_overrides")).rows;
  assert.deepEqual(await read(), { block: "9", phase: "2A" });
  assert.deepEqual((await db.query("SELECT * FROM admin_property_overrides")).rows, before);
});

test("resolved reviews and other source identities do not block a verified observation", async () => {
  await db.exec(`INSERT INTO mls_ingestion_reviews VALUES('28hse_agent_540','1001','sale','resolved'),('28hse_agent_540','9999','sale','open');
    INSERT INTO mls_ingestion_conflicts VALUES('${id}','block','reviewed');`);
  assert.deepEqual(await read(), { block: "9", phase: "2A" });
});

test("pre-migration or no active offers returns unknown without reading source tables", async () => {
  let calls = 0;
  const unavailable = async () => {
    calls++;
    return [{ available: false }];
  };
  assert.equal(await readPublicSourceLocation(unavailable, id, [id]), null);
  assert.equal(calls, 1);
  calls = 0;
  assert.equal(await readPublicSourceLocation(unavailable, id, []), null);
  assert.equal(calls, 0);
});
