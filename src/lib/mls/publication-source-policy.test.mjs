import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePublicationSource,
  createPropertyhkMediaObservation,
  validatePropertyhkMediaObservation,
} from "./publication-source-policy.mjs";
import { publicationDecision } from "./daily-publication.mjs";
import { exactUnitIdentity } from "./unit-identity.mjs";
const raw = {
  property_id: "P1",
  branch_code: "EPW",
  deal_type: "sale",
  source_status: "active",
  estate: "Test Estate",
  district: "Test",
  block: "1",
  floor: "12",
  unit: "A",
  price: "5380000",
  saleable_area: "500",
  source_url: "https://www.property.hk/fixture/EPW/P1",
  publication: {
    description: "Verified synthetic fixture description",
    images: ["https://media.fixture.property.hk/photo.jpg"],
  },
};
const policy = {
  source: "propertyhk",
  scope_id: "branches:EPW,EPS,EPT",
  policy_version: "no-hermes-v2",
  parser_version: "fixture-v2",
  owner: "no-hermes-v2",
  publish_enabled: true,
  id_scope: "global",
  config: {
    publication_verified: true,
    media_rights_confirmed: true,
    allowed_media_hosts_verified: true,
    allowed_media_hosts: ["media.fixture.property.hk"],
    source_url_identity: { verified: true, path_template: "/fixture/{branch}/{id}" },
  },
};
const p = {
  id: "p",
  status: "draft",
  ingestion_owner: "no-hermes-v2",
  source_count: 1,
  blocked: false,
  canonical_property_no: null,
  deal_type: "sale",
  external_listing_id: "P1",
  unit_key: exactUnitIdentity(raw).key,
  source_status: "active",
  estate_id: "estate",
  price: "5380000",
  saleable_area: "500",
  images: [],
  description: null,
  source_url: null,
};
test("verified Property.hk-only draft uses exact unit, no invented company number", () => {
  const source = resolvePublicationSource(policy);
  assert.equal(publicationDecision(raw, p, source), null);
  assert.ok(publicationDecision(raw, { ...p, unit_key: null }, source));
  assert.ok(publicationDecision(raw, { ...p, source_count: 2 }, source));
  assert.ok(
    publicationDecision(
      { ...raw, source_url: "https://www.property.hk/fixture/EPW/wrong" },
      p,
      source,
    ),
  );
});
test("unverified publication rights, identity and media hosts fail before network", () => {
  for (const field of [
    "publication_verified",
    "media_rights_confirmed",
    "allowed_media_hosts_verified",
  ])
    assert.throws(() =>
      resolvePublicationSource({ ...policy, config: { ...policy.config, [field]: false } }),
    );
  for (const host of ["127.0.0.1", "localhost", "evil.example/path", "*.property.hk"])
    assert.throws(() =>
      resolvePublicationSource({
        ...policy,
        config: { ...policy.config, allowed_media_hosts: [host] },
      }),
    );
  assert.throws(() => resolvePublicationSource({ ...policy, publish_enabled: false }));
});
test("Property.hk media codec is immutable, exact-unit bound and hash-checked", () => {
  const observation = createPropertyhkMediaObservation({
    raw,
    externalId: "P1",
    unitKey: p.unit_key,
    fetchedAt: "2026-10-01T01:00:00Z",
    aliases: {},
    verifySourceUrl: resolvePublicationSource(policy).verifySourceUrl,
  });
  assert.equal(validatePropertyhkMediaObservation(observation), null);
  assert.equal(observation.source, "propertyhk");
  assert.equal(observation.propertyNoRaw, null);
  assert.throws(() => {
    observation.mediaCandidates[0].url = "https://evil.example/a.jpg";
  });
  assert.ok(validatePropertyhkMediaObservation({ ...observation, contentHash: "0".repeat(64) }));
  assert.throws(() =>
    createPropertyhkMediaObservation({
      raw,
      externalId: "P1",
      unitKey: null,
      fetchedAt: "2026-10-01T01:00:00Z",
      verifySourceUrl: () => true,
    }),
  );
});
import { batch as sourceBatch } from "./ingestion-test-fixtures.mjs";
import { publishDaily } from "./daily-publication.mjs";
test("publisher resolves protected source policy and scopes target SQL before media", async () => {
  const payload = sourceBatch(
    [{ ...raw, title: "Synthetic" }],
    "2026-10-01T01:00:00Z",
    "propertyhk",
  );
  let preparations = 0;
  let targetArgs;
  const client = {
    query: async (sql, args) => {
      if (sql.includes("SELECT r.id FROM mls_ingestion_receipts")) return { rows: [{ id: "r" }] };
      if (sql.includes("SELECT * FROM mls_ingestion_policies")) return { rows: [policy] };
      if (sql.startsWith("SELECT p.*")) {
        targetArgs = args;
        return { rows: [p] };
      }
      return { rows: [] };
    },
  };
  const options = {
    payload,
    client,
    prepare: async () => preparations++,
    now: () => Date.parse("2026-10-01T02:00:00Z"),
  };
  const result = await publishDaily(options);
  assert.equal(result.ready.length, 1);
  assert.equal(preparations, 0);
  assert.deepEqual(targetArgs.slice(2), ["propertyhk", "branches:EPW,EPS,EPT"]);
  const blocked = {
    query: async (sql, args) =>
      sql.includes("SELECT * FROM mls_ingestion_policies")
        ? { rows: [{ ...policy, config: { ...policy.config, publication_verified: false } }] }
        : client.query(sql, args),
  };
  await assert.rejects(
    publishDaily({ ...options, client: blocked, apply: true }),
    /SOURCE_PUBLICATION_POLICY_UNVERIFIED/,
  );
  assert.equal(preparations, 0);
});
