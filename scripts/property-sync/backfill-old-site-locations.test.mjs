import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TSUEN_WAN_DISTRICT,
  proposeLocation,
  runLocationBackfill,
} from "./backfill-old-site-locations.mjs";

function createResolver(result) {
  const calls = [];
  return {
    calls,
    resolveLocation(detail) {
      calls.push(detail);
      return typeof result === "function" ? result(detail) : result;
    },
  };
}

const LIDO_PROPERTY = {
  id: "11111111-1111-4111-8111-111111111111",
  listing_no: "B054805-6709182-S",
  title_zh: "麗都花園 第03座 售盤 #B054805",
  address: "深井 青山公路",
  estate_id: null,
  district_slug: null,
  source_payload: {
    rawFields: {
      "大廈 (中)": "麗都花園 第03座",
      "大廈 (英)": "LIDO GARDEN BLOCK 3",
      "街道 (中)": "青山公路深井段",
    },
  },
};

test("proposeLocation fills a NULL estate and district from the captured building text", () => {
  const resolver = createResolver({
    estateId: "estate-lido",
    estateSlug: "lido-garden",
    districtSlug: "sham-tseng",
    matchedBy: "name_zh",
    ambiguous: false,
  });
  const proposal = proposeLocation(LIDO_PROPERTY, resolver);

  assert.deepEqual(resolver.calls[0], {
    buildingZh: "麗都花園 第03座",
    buildingEn: "LIDO GARDEN BLOCK 3",
    streetZh: "青山公路深井段",
    streetEn: null,
    title: "麗都花園 第03座 售盤 #B054805",
    address: "深井 青山公路",
  });
  assert.deepEqual(proposal.changes, {
    estate_id: "estate-lido",
    district_slug: "sham-tseng",
  });
  assert.equal(proposal.changed, true);
  assert.equal(proposal.staleEstate, false);
  assert.equal(proposal.reason, null);
  assert.equal(proposal.matchedBy, "name_zh");
});

test("proposeLocation corrects only the bogus tsuen-wan district when the estate is already set", () => {
  const resolver = createResolver({
    estateId: "estate-lido",
    districtSlug: "sham-tseng",
    matchedBy: "name_zh",
    ambiguous: false,
  });
  const proposal = proposeLocation(
    { ...LIDO_PROPERTY, estate_id: "estate-lido", district_slug: TSUEN_WAN_DISTRICT },
    resolver,
  );

  assert.deepEqual(proposal.changes, { district_slug: "sham-tseng" });
  assert.equal(proposal.changed, true);
  assert.equal(proposal.reason, null);
});

test("proposeLocation reports a different non-NULL estate as stale without overwriting it", () => {
  const resolver = createResolver({
    estateId: "estate-lido",
    districtSlug: "sham-tseng",
    matchedBy: "name_zh",
    ambiguous: false,
  });
  const proposal = proposeLocation(
    { ...LIDO_PROPERTY, estate_id: "estate-other", district_slug: "sham-tseng" },
    resolver,
  );

  assert.deepEqual(proposal.changes, {});
  assert.equal(proposal.changed, false);
  assert.equal(proposal.staleEstate, true);
  assert.equal(proposal.reason, "stale_estate");
});

test("proposeLocation overwrites a stale estate only with updateStaleEstate", () => {
  const resolver = createResolver({
    estateId: "estate-lido",
    districtSlug: "sham-tseng",
    matchedBy: "name_en",
    ambiguous: false,
  });
  const row = { ...LIDO_PROPERTY, estate_id: "estate-other", district_slug: "sham-tseng" };
  const proposal = proposeLocation(row, resolver, { updateStaleEstate: true });

  assert.deepEqual(proposal.changes, { estate_id: "estate-lido" });
  assert.equal(proposal.changed, true);
  assert.equal(proposal.staleEstate, true);
});

test("proposeLocation never overwrites a non-NULL, non-tsuen-wan district", () => {
  const resolver = createResolver({
    estateId: null,
    districtSlug: "sham-tseng",
    matchedBy: null,
    ambiguous: false,
  });
  const proposal = proposeLocation(
    { ...LIDO_PROPERTY, estate_id: null, district_slug: "castle-peak-road" },
    resolver,
  );

  assert.deepEqual(proposal.changes, {});
  assert.equal(proposal.changed, false);
});

test("proposeLocation never fills an estate from an ambiguous match", () => {
  const resolver = createResolver({
    estateId: null,
    estateSlug: null,
    districtSlug: null,
    matchedBy: null,
    ambiguous: true,
  });
  const proposal = proposeLocation(LIDO_PROPERTY, resolver);

  assert.deepEqual(proposal.changes, {});
  assert.equal(proposal.changed, false);
  assert.equal(proposal.ambiguous, true);
  assert.equal(proposal.reason, "ambiguous");
});

test("proposeLocation reports no match when the resolver returns nothing", () => {
  const resolver = createResolver({ estateId: null, districtSlug: null, ambiguous: false });
  const proposal = proposeLocation(LIDO_PROPERTY, resolver);
  assert.deepEqual(proposal.changes, {});
  assert.equal(proposal.reason, "no_match");
});

test("proposeLocation falls back to the title when the payload has no building text", () => {
  const resolver = createResolver({ estateId: null, districtSlug: null, ambiguous: false });
  proposeLocation(
    { ...LIDO_PROPERTY, source_payload: null, title_zh: "碧堤半島 第01座 售盤 #B2" },
    resolver,
  );
  assert.equal(resolver.calls[0].buildingZh, "碧堤半島 第01座 售盤 #B2");
  assert.equal(resolver.calls[0].title, "碧堤半島 第01座 售盤 #B2");
});

test("proposeLocation reads a JSON-string source_payload", () => {
  const resolver = createResolver({ estateId: null, districtSlug: null, ambiguous: false });
  proposeLocation(
    { ...LIDO_PROPERTY, source_payload: JSON.stringify(LIDO_PROPERTY.source_payload) },
    resolver,
  );
  assert.equal(resolver.calls[0].buildingZh, "麗都花園 第03座");
});

test("proposeLocation rejects malformed input", () => {
  assert.throws(() => proposeLocation(null, createResolver({})), /property row/);
  assert.throws(() => proposeLocation(LIDO_PROPERTY, {}), /resolveLocation/);
});

function createFakeSql({ properties = [], estates = [] } = {}) {
  const queries = [];
  const updates = [];
  const sql = async (strings, ...values) => {
    const text = String.raw(strings, ...values.map((_, index) => `$${index + 1}`));
    queries.push({ text, values });
    if (/UPDATE properties/.test(text)) {
      updates.push({ text, values });
      return [];
    }
    if (/FROM properties p/.test(text)) return properties;
    if (/FROM estates/.test(text)) return estates;
    return [];
  };
  return { sql, queries, updates };
}

function resolverForEstate() {
  return (estates) => {
    assert.equal(estates.length, 1);
    return createResolver({
      estateId: "estate-lido",
      estateSlug: "lido-garden",
      districtSlug: "sham-tseng",
      matchedBy: "name_zh",
      ambiguous: false,
    });
  };
}

const ESTATE_ROWS = [
  {
    id: "estate-lido",
    slug: "lido-garden",
    name_zh: "麗都花園",
    name_en: "LIDO GARDEN",
    aliases: null,
    district_slug: "sham-tseng",
  },
];

test("runLocationBackfill dry-run reports changes without updating", async () => {
  const { sql, updates } = createFakeSql({
    properties: [LIDO_PROPERTY],
    estates: ESTATE_ROWS,
  });
  const report = await runLocationBackfill({
    sql,
    dryRun: true,
    resolverFactory: resolverForEstate(),
  });

  assert.equal(updates.length, 0);
  assert.equal(report.dryRun, true);
  assert.equal(report.candidates, 1);
  assert.equal(report.changed, 1);
  assert.equal(report.applied, 0);
  assert.deepEqual(report.counts, { estate_id: 1, district_slug: 1 });
  assert.deepEqual(report.changes[0].changes, {
    estate_id: "estate-lido",
    district_slug: "sham-tseng",
  });
});

test("runLocationBackfill --apply updates only estate_id/district_slug/updated_at", async () => {
  const { sql, updates } = createFakeSql({
    properties: [LIDO_PROPERTY],
    estates: ESTATE_ROWS,
  });
  const report = await runLocationBackfill({
    sql,
    dryRun: false,
    resolverFactory: resolverForEstate(),
  });

  assert.equal(report.applied, 1);
  assert.equal(updates.length, 1);
  assert.match(updates[0].text, /SET\s+estate_id = \$1::uuid/);
  assert.match(updates[0].text, /district_slug = \$2/);
  assert.doesNotMatch(updates[0].text, /source_site|legacy_detail_id|status/);
  assert.deepEqual(updates[0].values, ["estate-lido", "sham-tseng", LIDO_PROPERTY.id]);
});

test("runLocationBackfill reports stale estates and leaves them alone by default", async () => {
  const staleRow = {
    ...LIDO_PROPERTY,
    estate_id: "estate-other",
    district_slug: "sham-tseng",
  };
  const { sql, updates } = createFakeSql({ properties: [staleRow], estates: ESTATE_ROWS });
  const report = await runLocationBackfill({
    sql,
    dryRun: false,
    resolverFactory: resolverForEstate(),
  });

  assert.equal(report.changed, 0);
  assert.equal(report.staleEstateCount, 1);
  assert.equal(report.staleEstate[0].proposed, "estate-lido");
  assert.equal(report.staleEstate[0].reason, "stale_estate");
  assert.equal(updates.length, 0);
});

test("runLocationBackfill --stale-estate applies the stale estate correction", async () => {
  const staleRow = {
    ...LIDO_PROPERTY,
    estate_id: "estate-other",
    district_slug: "sham-tseng",
  };
  const { sql, updates } = createFakeSql({ properties: [staleRow], estates: ESTATE_ROWS });
  const report = await runLocationBackfill({
    sql,
    dryRun: false,
    updateStaleEstate: true,
    resolverFactory: resolverForEstate(),
  });

  assert.equal(report.updateStaleEstate, true);
  assert.equal(report.changed, 1);
  assert.deepEqual(report.changes[0].changes, { estate_id: "estate-lido" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].values[0], "estate-lido");
});

test("runLocationBackfill records a failed update and keeps going", async () => {
  const sql = async (strings, ...values) => {
    const text = String.raw(strings, ...values.map((_, index) => `$${index + 1}`));
    if (/UPDATE properties/.test(text)) throw new Error("deadlock_detected");
    if (/FROM properties p/.test(text)) return [LIDO_PROPERTY];
    if (/FROM estates/.test(text)) return ESTATE_ROWS;
    return [];
  };
  const report = await runLocationBackfill({
    sql,
    dryRun: false,
    resolverFactory: resolverForEstate(),
  });

  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /deadlock_detected/);
});

test("runLocationBackfill requires an injected sql function", async () => {
  await assert.rejects(() => runLocationBackfill({}), /tagged-template function/);
});
