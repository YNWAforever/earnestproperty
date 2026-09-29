import assert from "node:assert/strict";
import test from "node:test";
import { parsePortalEnquiry } from "./portal-intake.ts";
import { resolvePortalReferences } from "./portal-resolution.server.ts";

const P1 = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const at = "2026-09-29T12:00:00Z";
const interpretation = parsePortalEnquiry(
  "鄧錦雄 Terence Tang 你好，我在 28Hse 見到這個 碧堤半島 售 $1,268 萬元 樓盤(ID:4033349)。請提供更多資料 https://www.28hse.com/buy/apartment/property-4033349?t=1790600623",
);
const scope = {
  channel_id: "company-wa",
  source: "28hse_agent_540",
  scope_id: "agent:540",
  staff_namespace: "28hse/account540",
};
const listing = {
  source: "28hse_agent_540",
  scope_id: "agent:540",
  external_listing_id: "4033349",
  deal_type: "sale",
  property_id: P1,
  observation_id: "obs-1",
  policy_version: "v1",
  last_accepted_at: at,
  source_status: "active",
  validation_state: "valid",
  publication_status: "active",
  public_offer: true,
  publication_owner_id: S1,
};
const mapping = {
  id: "map-1",
  namespace: "28hse/account540",
  external_reference: "鄧錦雄 Terence Tang",
  staff_id: S1,
  active: true,
  mapping_version: 1,
  valid_from: "2026-01-01T00:00:00Z",
  valid_until: null,
  verified_at: "2026-01-01T00:00:00Z",
};
const ports = (overrides = {}) => ({
  loadScopes: async () => [scope],
  loadListings: async () => [listing],
  loadStaffMappings: async () => [mapping],
  ...overrides,
});

test("verified source and staff map to synthetic P1/S1 without treating external ID as UUID", async () => {
  const [result] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports(),
  );
  assert.equal(result.status, "resolved");
  assert.equal(result.propertyId, P1);
  assert.equal(result.reference.externalListingId, "4033349");
  assert.equal(result.requestedStaffId, S1);
  assert.equal(result.publicationOwnerId, S1);
  assert.equal(result.snapshot.observationId, "obs-1");
  assert.equal(result.snapshot.mappingVersion, 1);
  assert.notEqual(result.propertyId, result.reference.externalListingId);
});

test("unbound channel and missing publication remain reviewable", async () => {
  const [unbound] = await resolvePortalReferences(
    interpretation,
    { channelId: "other", at },
    ports({ loadScopes: async () => [] }),
  );
  assert.equal(unbound.status, "review");
  assert.ok(unbound.reasons.includes("scope_conflict"));
  const [missing] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports({ loadListings: async () => [] }),
  );
  assert.ok(missing.reasons.includes("missing_publication"));
  assert.equal(missing.propertyId, null);
});

test("stale, withdrawn, and inactive staff cannot auto-resolve", async () => {
  const [stale] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports({ loadListings: async () => [{ ...listing, last_accepted_at: "2026-01-01T00:00:00Z" }] }),
  );
  assert.ok(stale.reasons.includes("stale_publication"));
  const [withdrawn] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports({ loadListings: async () => [{ ...listing, source_status: "delisted" }] }),
  );
  assert.ok(withdrawn.reasons.includes("missing_publication"));
  const [inactive] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports({ loadStaffMappings: async () => [{ ...mapping, active: false }] }),
  );
  assert.ok(inactive.reasons.includes("inactive_staff"));
});

test("same external ID with sale/rent and duplicate publication cannot take first row", async () => {
  const [ambiguous] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports({
      loadListings: async () => [
        listing,
        { ...listing, property_id: "33333333-3333-4333-8333-333333333333" },
      ],
    }),
  );
  assert.ok(ambiguous.reasons.includes("ambiguous_publication"));
  assert.equal(ambiguous.propertyId, null);
  const [sale] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports({ loadListings: async () => [{ ...listing, deal_type: "rent" }, listing] }),
  );
  assert.equal(sale.propertyId, P1);
});

test("same name with two approved staff mappings remains ambiguous", async () => {
  const [result] = await resolvePortalReferences(
    interpretation,
    { channelId: "company-wa", at },
    ports({
      loadStaffMappings: async () => [
        mapping,
        { ...mapping, id: "map-2", staff_id: "33333333-3333-4333-8333-333333333333" },
      ],
    }),
  );
  assert.ok(result.reasons.includes("ambiguous_staff"));
  assert.equal(result.requestedStaffId, null);
});

test("one thousand references use bounded batch lookups", async () => {
  const multi = {
    ...interpretation,
    references: Array.from({ length: 1000 }, (_, i) => ({
      ...interpretation.references[0],
      externalListingId: String(i),
    })),
  };
  let reads = 0;
  await resolvePortalReferences(
    multi,
    { channelId: "company-wa", at },
    ports({
      loadScopes: async () => {
        reads++;
        return [scope];
      },
      loadListings: async () => {
        reads++;
        return [];
      },
      loadStaffMappings: async () => {
        reads++;
        return [];
      },
    }),
  );
  assert.equal(reads, 3);
});
