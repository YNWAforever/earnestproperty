import assert from "node:assert/strict";
import { test } from "node:test";

import { SOURCE_28HSE, SOURCE_OLD_SITE, createObservation } from "./source-contract.mjs";
import { groupExactMatches, matchCanonicalProperty } from "./match.mjs";
import {
  RECONCILED_FIELDS,
  detectStaffOverride,
  nextLifecycleState,
  normalizeCanonicalFieldValue,
  reconcileProperty,
  validateCanonicalProposal,
} from "./reconcile.mjs";

function observation(source, externalId, propertyNo, dealType, fields = {}, extras = {}) {
  const requiredPrice = dealType === "sale" ? { price: 10_000_000 } : { rent: 25_000 };
  const created = createObservation({
    source,
    externalId,
    dealType,
    sourceUrl: `https://fixtures.invalid/${source}/${externalId}`,
    propertyNoRaw: propertyNo,
    fields: {
      title_zh: "測試單位",
      district_slug: "central-western",
      status: "active",
      ...requiredPrice,
      ...fields,
    },
    rawFields: extras.rawFields ?? {},
    mediaCandidates: extras.mediaCandidates ?? [],
    fetchedAt: "2026-08-17T00:00:00.000Z",
    quarantineReasons: extras.quarantineReasons,
  });
  return {
    ...created,
    id: extras.id ?? `obs:${source}:${externalId}:${dealType}`,
  };
}

function validNewProposal(overrides = {}) {
  return {
    listing_no: "C003097-3972991-S",
    canonical_property_no: "C003097",
    title_zh: "測試單位",
    title_en: null,
    deal_type: "sale",
    estate_id: null,
    district_slug: "central-western",
    address: null,
    price: 10_000_000,
    rent: null,
    saleable_area: null,
    gross_area: null,
    bedrooms: null,
    bathrooms: null,
    floor: null,
    orientation: null,
    features: [],
    description: null,
    images: ["https://owned.invalid/listing.jpg"],
    status: "active",
    ...overrides,
  };
}

function preparedRecord(sourceObservation, images, overrides = {}) {
  return {
    observationId: sourceObservation.id,
    source: sourceObservation.source,
    externalId: sourceObservation.externalId,
    dealType: sourceObservation.dealType,
    matchKey: sourceObservation.matchKey,
    images,
    ...overrides,
  };
}

function validationEvidenceFor(proposal, overrides = {}) {
  const inferredMatchKey =
    typeof proposal.canonical_property_no === "string" &&
    (proposal.deal_type === "sale" || proposal.deal_type === "rent")
      ? `${proposal.deal_type}:${proposal.canonical_property_no}`
      : null;
  return {
    schemaVersion: 1,
    targetMatchKey: inferredMatchKey,
    currentMatchKey: proposal.id == null ? null : inferredMatchKey,
    blockingCodes: [],
    conflicts: [],
    quarantines: [],
    media: {
      preparedImages: proposal.id == null ? [...(proposal.images ?? [])] : [],
      currentOwnedImages: proposal.id == null ? [] : [...(proposal.images ?? [])],
    },
    ...overrides,
  };
}

function validationOptions(proposal, overrides = {}) {
  const kind = overrides.kind ?? (proposal.id == null ? "new" : "update");
  return {
    kind,
    validationEvidence:
      overrides.validationEvidence ?? validationEvidenceFor(proposal, overrides.evidenceOverrides),
  };
}

test("deduplicates only exact property number plus deal type", () => {
  const groups = groupExactMatches([
    observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale"),
    observation(SOURCE_28HSE, "3972991", " c 003097 ", "sale"),
    observation(SOURCE_28HSE, "3976155", "C003097", "rent"),
    observation(SOURCE_28HSE, "3977000", null, "sale"),
  ]);

  assert.equal(groups.matched.get("sale:C003097").length, 2);
  assert.equal(groups.matched.get("rent:C003097").length, 1);
  assert.equal(groups.quarantined.length, 1);
  assert.equal(groups.quarantined[0].reason, "observation_not_valid");
});

test("rejects forged and malformed match keys without consulting fuzzy attributes", () => {
  const valid = observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale", {
    address: "Same address",
  });
  const forged = {
    ...valid,
    externalId: "old-forged",
    matchKey: "sale:C999999",
    fields: { ...valid.fields, address: "Same address" },
  };
  const malformed = { ...valid, externalId: "old-malformed", matchKey: "sale:c003097" };
  const groups = groupExactMatches([forged, malformed]);

  assert.equal(groups.matched.size, 0);
  assert.deepEqual(
    groups.quarantined.map(({ reason }) => reason),
    ["match_key_identity_mismatch", "malformed_match_key"],
  );
});

test("rejects a forged raw property identity even when its normalized fields look valid", () => {
  const valid = observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale");
  const forged = { ...valid, propertyNoRaw: "C999999" };
  const grouped = groupExactMatches([forged]);

  assert.equal(grouped.matched.size, 0);
  assert.equal(grouped.quarantined[0].reason, "match_key_identity_mismatch");
});

test("revalidates the complete immutable observation contract while allowing a database ID", () => {
  const valid = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  assert.equal(groupExactMatches([{ ...valid, id: "database-observation-id" }]).matched.size, 1);

  const forged = [
    { ...valid, schemaVersion: 99 },
    { ...valid, source: "third_party" },
    { ...valid, externalId: "" },
    { ...valid, sourceUrl: " " },
    { ...valid, quarantineReasons: ["forged-valid-state"] },
    { ...valid, contentHash: "0".repeat(64) },
    { ...valid, propertyNoRaw: 3097 },
    { ...valid, fetchedAt: null },
    { ...valid, discoveredAt: null },
    { ...valid, fields: [] },
    { ...valid, rawFields: [] },
    { ...valid, mediaCandidates: {} },
  ];
  for (const forgedObservation of forged) {
    const grouped = groupExactMatches([forgedObservation]);
    assert.equal(grouped.matched.size, 0);
    assert.equal(grouped.quarantined.length, 1);
  }

  const reconciled = reconcileProperty({ current: {}, observations: forged });
  assert.equal(reconciled.fields.title_zh.source, null);
  assert.equal(reconciled.canonical.title_zh, null);
});

test("group ordering and generated listing numbers are input-order invariant", () => {
  const observations = [
    observation(SOURCE_OLD_SITE, "old-z", "C003097", "sale"),
    observation(SOURCE_28HSE, "400", "C003097", "sale"),
    observation(SOURCE_28HSE, "200", "C003097", "sale"),
  ];
  const forward = groupExactMatches(observations).matched.get("sale:C003097");
  const reverse = groupExactMatches([...observations].reverse()).matched.get("sale:C003097");

  assert.deepEqual(
    forward.map(({ source, externalId }) => [source, externalId]),
    reverse.map(({ source, externalId }) => [source, externalId]),
  );
  assert.equal(matchCanonicalProperty(forward, []).listingNo, "C003097-200-S");
  assert.equal(matchCanonicalProperty(reverse, []).listingNo, "C003097-200-S");
});

test("the returned exact-group Map iterates in sorted match-key order", () => {
  const observations = [
    observation(SOURCE_28HSE, "rent-z", "Z999", "rent"),
    observation(SOURCE_28HSE, "sale-a", "A001", "sale"),
  ];
  const forward = [...groupExactMatches(observations).matched.keys()];
  const reverse = [...groupExactMatches([...observations].reverse()).matched.keys()];
  assert.deepEqual(forward, ["rent:Z999", "sale:A001"]);
  assert.deepEqual(reverse, forward);
});

test("canonical matching normalizes conservatively, requires deal equality, and deduplicates IDs", () => {
  const outcome = matchCanonicalProperty({ matchKey: "sale:C003097" }, [
    { id: "p2", canonical_property_no: " C 003097 ", deal_type: "sale" },
    { id: "p1", canonical_property_no: "C003097", deal_type: "sale" },
    { id: "p2", canonical_property_no: "C003097", deal_type: "sale" },
    { id: "rent-row", canonical_property_no: "C003097", deal_type: "rent" },
    { id: "fuzzy-row", canonical_property_no: "C003097X", deal_type: "sale" },
  ]);

  assert.equal(outcome.kind, "ambiguous");
  assert.equal(outcome.reason, "ambiguous_canonical_match");
  assert.deepEqual(outcome.candidateIds, ["p1", "p2"]);
});

test("duplicate canonical rows with one ID but conflicting identities fail closed independent of order", () => {
  const candidates = [
    { id: "p1", canonical_property_no: "C003097", deal_type: "sale", listing_no: "ONE" },
    { id: "p1", canonical_property_no: "C999999", deal_type: "sale", listing_no: "ONE" },
  ];
  for (const rows of [candidates, [...candidates].reverse()]) {
    assert.deepEqual(matchCanonicalProperty({ matchKey: "sale:C003097" }, rows), {
      kind: "ambiguous",
      reason: "candidate_identity_conflict",
      candidateIds: ["p1"],
    });
  }
});

test("duplicate canonical rows with one identity but different listing numbers fail closed", () => {
  const outcome = matchCanonicalProperty({ matchKey: "sale:C003097" }, [
    { id: "p1", canonical_property_no: "C003097", deal_type: "sale", listing_no: "ONE" },
    { id: "p1", canonical_property_no: "C003097", deal_type: "sale", listing_no: "TWO" },
  ]);
  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason: "candidate_identity_conflict",
    candidateIds: ["p1"],
  });
});

test("identical duplicate candidate identities select a deterministic row", () => {
  const rows = [
    {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      listing_no: "ONE",
      marker: "Zulu",
    },
    {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      listing_no: "ONE",
      marker: "Alpha",
    },
  ];
  const forward = matchCanonicalProperty({ matchKey: "sale:C003097" }, rows);
  const reverse = matchCanonicalProperty({ matchKey: "sale:C003097" }, [...rows].reverse());
  assert.deepEqual(forward, reverse);
  assert.equal(forward.property.marker, "Alpha");
});

test("one exact canonical match preserves its existing listing number", () => {
  const outcome = matchCanonicalProperty({ matchKey: "rent:C003097" }, [
    {
      id: "p1",
      listing_no: "STAFF-LISTING-NO",
      canonical_property_no: "C003097",
      deal_type: "rent",
    },
  ]);

  assert.equal(outcome.kind, "existing");
  assert.equal(outcome.propertyId, "p1");
  assert.equal(outcome.listingNo, "STAFF-LISTING-NO");
});

test("only one active exact source link may disambiguate exact canonical rows", () => {
  const grouped = groupExactMatches([
    observation(SOURCE_28HSE, "3972991", "C003097", "sale"),
  ]).matched.get("sale:C003097");
  const candidates = [
    { id: "p1", canonical_property_no: "C003097", deal_type: "sale", listing_no: "ONE" },
    { id: "p2", canonical_property_no: "C003097", deal_type: "sale", listing_no: "TWO" },
  ];
  const outcome = matchCanonicalProperty(grouped, candidates, [
    {
      property_id: "p2",
      source: SOURCE_28HSE,
      external_listing_id: "3972991",
      deal_type: "sale",
      match_key: "sale:C003097",
      link_reason: "exact_property_no_and_deal_type",
      status: "active",
    },
  ]);

  assert.equal(outcome.kind, "existing");
  assert.equal(outcome.propertyId, "p2");
  assert.equal(outcome.listingNo, "TWO");
});

test("link identity disagreement and multiple linked rows quarantine without relinking", () => {
  const grouped = groupExactMatches([
    observation(SOURCE_28HSE, "3972991", "C003097", "sale"),
    observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale"),
  ]).matched.get("sale:C003097");
  const candidates = [
    { id: "p1", canonical_property_no: "C003097", deal_type: "sale" },
    { id: "p2", canonical_property_no: "C999999", deal_type: "sale" },
  ];
  const disagreement = matchCanonicalProperty(grouped, candidates, [
    {
      property_id: "p2",
      source: SOURCE_28HSE,
      external_listing_id: "3972991",
      deal_type: "sale",
      match_key: "sale:C003097",
      link_reason: "exact_property_no_and_deal_type",
      status: "active",
    },
  ]);
  const multiple = matchCanonicalProperty(
    grouped,
    [
      { id: "p1", canonical_property_no: "C003097", deal_type: "sale" },
      { id: "p2", canonical_property_no: "C003097", deal_type: "sale" },
    ],
    [
      {
        property_id: "p1",
        source: SOURCE_28HSE,
        external_listing_id: "3972991",
        deal_type: "sale",
        match_key: "sale:C003097",
        link_reason: "exact_property_no_and_deal_type",
        status: "active",
      },
      {
        property_id: "p2",
        source: SOURCE_OLD_SITE,
        external_listing_id: "old-1",
        deal_type: "sale",
        match_key: "sale:C003097",
        link_reason: "exact_property_no_and_deal_type",
        status: "active",
      },
    ],
  );

  assert.deepEqual(disagreement, {
    kind: "ambiguous",
    reason: "link_identity_conflict",
    candidateIds: ["p2"],
  });
  assert.deepEqual(multiple, {
    kind: "ambiguous",
    reason: "link_identity_conflict",
    candidateIds: ["p1", "p2"],
  });
});

test("a relink attempt reports every exact and conflicting linked row deterministically", () => {
  const grouped = groupExactMatches([
    observation(SOURCE_28HSE, "3972991", "C003097", "sale"),
    observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale"),
  ]).matched.get("sale:C003097");
  const outcome = matchCanonicalProperty(
    grouped,
    [
      { id: "p1", canonical_property_no: "C003097", deal_type: "sale" },
      { id: "p2", canonical_property_no: "C999999", deal_type: "sale" },
    ],
    [
      {
        property_id: "p1",
        source: SOURCE_28HSE,
        external_listing_id: "3972991",
        deal_type: "sale",
        match_key: "sale:C003097",
        link_reason: "exact_property_no_and_deal_type",
        status: "active",
      },
      {
        property_id: "p2",
        source: SOURCE_OLD_SITE,
        external_listing_id: "old-1",
        deal_type: "sale",
        match_key: "sale:C999999",
        link_reason: "exact_property_no_and_deal_type",
        status: "active",
      },
    ],
  );

  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason: "link_identity_conflict",
    candidateIds: ["p1", "p2"],
  });
});

test("a relevant active link with a non-exact reason fails closed", () => {
  const grouped = groupExactMatches([
    observation(SOURCE_28HSE, "3972991", "C003097", "sale"),
  ]).matched.get("sale:C003097");
  const outcome = matchCanonicalProperty(
    grouped,
    [
      { id: "p1", canonical_property_no: "C003097", deal_type: "sale" },
      { id: "p2", canonical_property_no: "C003097", deal_type: "sale" },
    ],
    [
      {
        property_id: "p1",
        source: SOURCE_28HSE,
        external_listing_id: "3972991",
        deal_type: "sale",
        match_key: "sale:C003097",
        link_reason: "manual_guess",
        status: "active",
      },
      {
        property_id: "p2",
        source: SOURCE_28HSE,
        external_listing_id: "3972991",
        deal_type: "sale",
        match_key: "sale:C003097",
        link_reason: "exact_property_no_and_deal_type",
        status: "rejected",
      },
    ],
  );

  assert.equal(outcome.kind, "ambiguous");
  assert.equal(outcome.reason, "link_identity_conflict");
  assert.deepEqual(outcome.candidateIds, ["p1"]);
});

test("active links are audited by source and external ID before deal filtering", () => {
  const grouped = groupExactMatches([
    observation(SOURCE_28HSE, "3972991", "C003097", "sale"),
  ]).matched.get("sale:C003097");
  const candidates = [
    { id: "p1", canonical_property_no: "C003097", deal_type: "sale", listing_no: "ONE" },
  ];
  const baseLink = {
    property_id: "p1",
    source: SOURCE_28HSE,
    external_listing_id: "3972991",
    deal_type: "sale",
    match_key: "sale:C003097",
    link_reason: "exact_property_no_and_deal_type",
    status: "active",
  };
  const conflictingLinks = [
    { ...baseLink, deal_type: "rent" },
    { ...baseLink, match_key: "sale:C999999" },
    { ...baseLink, link_reason: "manual_guess" },
    { ...baseLink, property_id: undefined },
    { ...baseLink, property_id: "stale-property" },
  ];
  for (const link of conflictingLinks) {
    const outcome = matchCanonicalProperty(grouped, candidates, [link]);
    assert.equal(outcome.kind, "ambiguous");
    assert.equal(outcome.reason, "link_identity_conflict");
  }
});

test("an empty linked canonical ID cannot identify an existing row", () => {
  const grouped = groupExactMatches([
    observation(SOURCE_28HSE, "3972991", "C003097", "sale"),
  ]).matched.get("sale:C003097");
  const outcome = matchCanonicalProperty(
    grouped,
    [{ id: "", canonical_property_no: "C003097", deal_type: "sale" }],
    [
      {
        property_id: "",
        source: SOURCE_28HSE,
        external_listing_id: "3972991",
        deal_type: "sale",
        match_key: "sale:C003097",
        link_reason: "exact_property_no_and_deal_type",
        status: "active",
      },
    ],
  );
  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason: "link_identity_conflict",
    candidateIds: [],
  });
});

test("inactive and unrelated links remain irrelevant", () => {
  const grouped = groupExactMatches([
    observation(SOURCE_28HSE, "3972991", "C003097", "sale"),
  ]).matched.get("sale:C003097");
  const candidate = {
    id: "p1",
    canonical_property_no: "C003097",
    deal_type: "sale",
    listing_no: "ONE",
  };
  const outcome = matchCanonicalProperty(
    grouped,
    [candidate],
    [
      {
        property_id: "other",
        source: SOURCE_28HSE,
        external_listing_id: "unrelated",
        deal_type: "rent",
        match_key: "rent:C999999",
        link_reason: "manual_guess",
        status: "active",
      },
      {
        property_id: "other",
        source: SOURCE_28HSE,
        external_listing_id: "3972991",
        deal_type: "rent",
        match_key: "rent:C999999",
        link_reason: "manual_guess",
        status: "rejected",
      },
    ],
  );
  assert.equal(outcome.kind, "existing");
  assert.equal(outcome.propertyId, "p1");
});

test("an update's current exact identity is authoritative and immutable", () => {
  const result = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      title_zh: "Current title",
    },
    matchKey: "rent:C999999",
    canonicalPropertyNo: "C999999",
    dealType: "rent",
    observations: [
      observation(SOURCE_28HSE, "3972991", "C999999", "rent", {
        title_zh: "Wrong identity title",
      }),
    ],
  });

  assert.equal(result.canonical.canonical_property_no, "C003097");
  assert.equal(result.canonical.deal_type, "sale");
  assert.equal(result.canonical.title_zh, "Current title");
  assert.ok(result.validationEvidence.blockingCodes.includes("target_identity_conflict"));
  assert.ok(result.quarantines.some(({ code }) => code === "observation_identity_mismatch"));
});

test("kind new cannot bypass an existing current row's authoritative identity", () => {
  const result = reconcileProperty({
    kind: "new",
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      title_zh: "Current title",
    },
    canonicalPropertyNo: "C999999",
    dealType: "rent",
    observations: [observation(SOURCE_28HSE, "3972991", "C999999", "rent")],
  });
  assert.equal(result.canonical.id, "p1");
  assert.equal(result.canonical.canonical_property_no, "C003097");
  assert.equal(result.canonical.deal_type, "sale");
  assert.ok(result.validationEvidence.blockingCodes.includes("target_identity_conflict"));
});

test("a lone observation that disagrees with the current identity is quarantined", () => {
  const result = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      title_zh: "Current title",
    },
    observations: [
      observation(SOURCE_28HSE, "3972991", "C999999", "sale", {
        title_zh: "Wrong identity title",
      }),
    ],
  });

  assert.equal(result.fields.title_zh.source, "current");
  assert.equal(result.canonical.title_zh, "Current title");
  assert.ok(result.validationEvidence.blockingCodes.includes("observation_identity_mismatch"));
});

test("new explicit identity representations must agree with each other and observations", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C999999", "sale");
  const mismatch = reconcileProperty({
    current: {},
    matchKey: "sale:C003097",
    canonicalPropertyNo: "C003097",
    dealType: "sale",
    observations: [source],
  });
  assert.equal(mismatch.fields.title_zh.source, null);
  assert.ok(mismatch.validationEvidence.blockingCodes.includes("target_identity_conflict"));

  const explicitDisagreement = reconcileProperty({
    current: {},
    matchKey: "sale:C003097",
    canonicalPropertyNo: "C999999",
    dealType: "sale",
    observations: [],
  });
  assert.ok(
    explicitDisagreement.validationEvidence.blockingCodes.includes("target_identity_conflict"),
  );
});

test("exactly one valid observation key may establish a new target when inputs omit identity", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  const result = reconcileProperty({ current: {}, observations: [source] });
  assert.equal(result.canonical.canonical_property_no, "C003097");
  assert.equal(result.canonical.deal_type, "sale");
  assert.equal(result.validationEvidence.targetMatchKey, "sale:C003097");
});

test("staff override wins, then 28Hse, then old site; 28Hse never supplies description", () => {
  const result = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      price: 11_000_000,
      description: "Staff copy",
    },
    fieldStates: {
      price: {
        last_published_value: 10_000_000,
        override_value: null,
        active_override: false,
      },
      description: {
        last_published_value: "Old source copy",
        override_value: "Staff copy",
        active_override: true,
      },
    },
    observations: [
      observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale", {
        price: 10_500_000,
        description: "Old source updated copy",
      }),
      observation(SOURCE_28HSE, "3972991", "C003097", "sale", {
        price: 10_800_000,
        description: "Forbidden platform copy",
      }),
    ],
  });

  assert.equal(result.fields.price.value, 11_000_000);
  assert.equal(result.fields.price.source, "staff_override");
  assert.equal(result.fields.description.value, "Staff copy");
  assert.equal(result.fields.description.source, "staff_override");

  const automated = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      price: 10_000_000,
      description: "Old source copy",
    },
    fieldStates: {
      price: { last_published_value: 10_000_000, override_value: null, active_override: false },
      description: {
        last_published_value: "Old source copy",
        override_value: null,
        active_override: false,
      },
    },
    observations: [
      observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale", {
        price: 10_500_000,
        description: "Permitted old-site copy",
      }),
      observation(SOURCE_28HSE, "3972991", "C003097", "sale", {
        price: 10_800_000,
        description: "Forbidden platform copy",
      }),
    ],
  });
  assert.equal(automated.fields.price.value, 10_800_000);
  assert.equal(automated.fields.price.source, SOURCE_28HSE);
  assert.equal(automated.fields.description.value, "Permitted old-site copy");
  assert.equal(automated.fields.description.source, SOURCE_OLD_SITE);
});

test("missing and quarantined higher-priority values fall back without erasing current values", () => {
  const quarantined28 = observation(SOURCE_28HSE, "3972991", "C003097", "sale", {
    price: null,
    title_en: "Must be ignored",
  });
  const result = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      address: "Current address",
      orientation: "East",
    },
    observations: [
      observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale", {
        title_en: "Old English title",
        address: "",
      }),
      quarantined28,
    ],
  });

  assert.equal(quarantined28.validationState, "quarantined");
  assert.equal(result.fields.title_en.value, "Old English title");
  assert.equal(result.fields.address.value, "Current address");
  assert.equal(result.fields.orientation.value, "East");
});

test("same-priority source conflicts are deterministic and explicitly quarantined", () => {
  const a = observation(SOURCE_28HSE, "100", "C003097", "sale", { address: "Alpha" });
  const z = observation(SOURCE_28HSE, "900", "C003097", "sale", { address: "Zulu" });
  const old = observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale", {
    address: "Old-site fallback",
  });
  const forward = reconcileProperty({ current: {}, observations: [z, old, a] });
  const reverse = reconcileProperty({ current: {}, observations: [a, old, z] });

  assert.equal(forward.fields.address.value, "Old-site fallback");
  assert.equal(forward.fields.address.source, SOURCE_OLD_SITE);
  assert.deepEqual(forward.fields.address, reverse.fields.address);
  assert.deepEqual(forward.conflicts, reverse.conflicts);
  assert.deepEqual(forward.quarantines, reverse.quarantines);
  assert.deepEqual(forward.conflicts, [
    {
      code: "source_value_conflict",
      field: "address",
      source: SOURCE_28HSE,
      observationIds: [a.id, z.id],
    },
  ]);
});

test("source-value conflicts block proposal validation through direct and explicit evidence", () => {
  const a = observation(SOURCE_28HSE, "100", "C003097", "sale", { address: "Alpha" });
  const z = observation(SOURCE_28HSE, "900", "C003097", "sale", { address: "Zulu" });
  const current = validNewProposal({ id: "p1", address: "Current" });
  const result = reconcileProperty({
    current,
    observations: [a, z],
    currentOwnedImages: current.images,
  });

  assert.ok(result.validationEvidence.blockingCodes.includes("source_value_conflict"));
  assert.ok(validateCanonicalProposal({ ...result.canonical }).includes("source_value_conflict"));
  assert.ok(
    validateCanonicalProposal(result.canonical, {
      kind: "update",
      validationEvidence: result.validationEvidence,
    }).includes("source_value_conflict"),
  );

  const inconsistentEvidence = {
    ...result.validationEvidence,
    blockingCodes: [],
  };
  assert.ok(
    validateCanonicalProposal(result.canonical, {
      kind: "update",
      validationEvidence: inconsistentEvidence,
    }).includes("missing_reconciliation_evidence"),
  );

  const serialized = JSON.parse(JSON.stringify(result.canonical));
  assert.ok(
    validateCanonicalProposal(serialized, {
      kind: "update",
      currentOwnedImages: current.images,
    }).includes("missing_reconciliation_evidence"),
  );
});

test("reconciliation fails closed when observations from different exact identities are mixed", () => {
  const result = reconcileProperty({
    current: {},
    observations: [
      observation(SOURCE_28HSE, "sale-1", "C003097", "sale"),
      observation(SOURCE_28HSE, "rent-1", "C003097", "rent"),
    ],
  });

  assert.equal(result.fields.title_zh.source, null);
  assert.equal(result.conflicts[0].code, "mixed_exact_identities");
  assert.deepEqual(result.conflicts[0].matchKeys, ["rent:C003097", "sale:C003097"]);
});

test("normalizes database numbers, integers, text, feature sets, and ordered images safely", () => {
  assert.equal(normalizeCanonicalFieldValue("price", "10000000"), 10_000_000);
  assert.equal(normalizeCanonicalFieldValue("price", "10000000.5"), 10_000_000.5);
  for (const value of [true, false, "", "Infinity", Number.NaN, 9_007_199_254_740_992]) {
    assert.equal(normalizeCanonicalFieldValue("price", value), undefined);
  }
  assert.equal(normalizeCanonicalFieldValue("bedrooms", "3"), 3);
  assert.equal(normalizeCanonicalFieldValue("saleable_area", 450), 450);
  for (const value of [true, "3.5", 3.5, "", 9_007_199_254_740_992]) {
    assert.equal(normalizeCanonicalFieldValue("bedrooms", value), undefined);
  }
  assert.equal(normalizeCanonicalFieldValue("title_zh", "  測試單位  "), "測試單位");
  assert.deepEqual(
    normalizeCanonicalFieldValue("features", [" Sea view ", "Balcony", "Sea view", ""]),
    ["Balcony", "Sea view"],
  );
  assert.deepEqual(
    normalizeCanonicalFieldValue("images", [
      " https://owned.invalid/b.jpg ",
      "https://owned.invalid/a.jpg",
    ]),
    ["https://owned.invalid/b.jpg", "https://owned.invalid/a.jpg"],
  );
  assert.equal(normalizeCanonicalFieldValue("features", ["Balcony", 3]), undefined);
  assert.equal(
    normalizeCanonicalFieldValue("images", ["https://owned.invalid/a.jpg", false]),
    undefined,
  );
});

test("mixed automated arrays reject the whole field or prepared record", () => {
  const old = observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale", {
    features: ["Old-site fallback"],
  });
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale", {
    features: ["Balcony", 3],
  });
  const result = reconcileProperty({
    current: {},
    observations: [source, old],
    preparedImages: [preparedRecord(source, ["https://owned.invalid/listing.jpg", false])],
  });
  assert.deepEqual(result.fields.features.value, ["Old-site fallback"]);
  assert.equal(result.fields.features.source, SOURCE_OLD_SITE);
  assert.deepEqual(result.canonical.images, []);
  assert.ok(result.validationEvidence.blockingCodes.includes("prepared_media_invalid"));
});

test("normalization and reconciliation do not mutate their inputs", () => {
  const features = ["Sea view", "Balcony", "Sea view"];
  const current = {
    id: "p1",
    canonical_property_no: "C003097",
    deal_type: "sale",
    features,
    custom_admin_note: { keep: true },
  };
  const observations = [observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale")];
  const beforeCurrent = structuredClone(current);
  const beforeObservations = structuredClone(observations);

  normalizeCanonicalFieldValue("features", features);
  reconcileProperty({ current, observations });

  assert.deepEqual(current, beforeCurrent);
  assert.deepEqual(observations, beforeObservations);
});

test("estate slugs resolve only through the provided map and unknown slugs cannot erase fallback", () => {
  const result = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      estate_id: "current-estate",
    },
    fieldStates: {
      estate_id: {
        last_published_value: "current-estate",
        override_value: null,
        active_override: false,
      },
    },
    estateIdsBySlug: new Map([["bal-residence", "estate-1"]]),
    observations: [
      observation(SOURCE_OLD_SITE, "old-1", "C003097", "sale", {
        estate_slug: "bal-residence",
      }),
      observation(SOURCE_28HSE, "3972991", "C003097", "sale", {
        estate_slug: "unknown-slug",
      }),
    ],
  });

  assert.equal(result.fields.estate_id.value, "estate-1");
  assert.notEqual(result.fields.estate_id.value, "bal-residence");

  const unresolved = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      estate_id: "current-estate",
    },
    observations: [
      observation(SOURCE_28HSE, "3972991", "C003097", "sale", {
        estate_slug: "unknown-slug",
      }),
    ],
    estateIdsBySlug: new Map(),
  });
  assert.equal(unresolved.fields.estate_id.value, "current-estate");
});

test("raw observation images are ignored and only explicit prepared images can win", () => {
  const source = observation(
    SOURCE_28HSE,
    "3972991",
    "C003097",
    "sale",
    { images: ["https://media.28hse.example/hotlink.jpg"] },
    {
      mediaCandidates: [
        {
          url: "https://media.28hse.example/hotlink.jpg",
          category: "listing_photo",
          isPrimary: true,
        },
      ],
    },
  );
  const ignored = reconcileProperty({ current: {}, observations: [source] });
  assert.deepEqual(ignored.canonical.images, []);
  assert.notEqual(ignored.fields.images.source, SOURCE_28HSE);

  const prepared = reconcileProperty({
    current: {},
    observations: [source],
    preparedImages: [preparedRecord(source, ["https://owned.invalid/listing.jpg"])],
  });
  assert.deepEqual(prepared.canonical.images, ["https://owned.invalid/listing.jpg"]);
  assert.equal(prepared.fields.images.source, SOURCE_28HSE);
  assert.equal(prepared.fields.images.observationId, source.id);
});

test("an orphan or quarantined prepared-image record cannot become canonical", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  const result = reconcileProperty({
    current: {},
    observations: [source],
    preparedImages: [
      preparedRecord(source, ["https://owned.invalid/orphan.jpg"], {
        externalId: "not-this-listing",
        observationId: "missing-observation",
      }),
    ],
  });

  assert.deepEqual(result.canonical.images, []);
  assert.equal(result.quarantines.at(-1).code, "orphan_prepared_images");
});

test("prepared media requires every exact observation identity component", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  const complete = preparedRecord(source, ["https://owned.invalid/listing.jpg"]);
  const invalidRecords = [
    { ...complete, observationId: undefined },
    { ...complete, source: SOURCE_OLD_SITE },
    { ...complete, externalId: "other" },
    { ...complete, dealType: "rent" },
    { ...complete, matchKey: "sale:C999999" },
  ];
  for (const record of invalidRecords) {
    const result = reconcileProperty({
      current: {},
      observations: [source],
      preparedImages: [record],
    });
    assert.deepEqual(result.canonical.images, []);
    assert.ok(result.validationEvidence.blockingCodes.includes("prepared_media_invalid"));
  }
});

test("prepared media cannot bind through a synthetic observation ID", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  const withoutId = { ...source };
  Reflect.deleteProperty(withoutId, "id");
  const result = reconcileProperty({
    current: {},
    observations: [withoutId],
    preparedImages: [
      preparedRecord(source, ["https://owned.invalid/listing.jpg"], {
        observationId: `${source.source}:${source.externalId}:${source.dealType}`,
      }),
    ],
  });
  assert.deepEqual(result.canonical.images, []);
  assert.ok(result.validationEvidence.blockingCodes.includes("prepared_media_invalid"));
});

test("a non-array prepared-media collection fails closed instead of throwing", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  const result = reconcileProperty({
    current: {},
    observations: [source],
    preparedImages: preparedRecord(source, ["https://owned.invalid/listing.jpg"]),
  });
  assert.deepEqual(result.canonical.images, []);
  assert.ok(result.validationEvidence.blockingCodes.includes("prepared_media_invalid"));
});

test("prepared images require an exact observation or source external identity", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  const result = reconcileProperty({
    current: {},
    observations: [source],
    preparedImages: [
      {
        source: SOURCE_28HSE,
        images: ["https://owned.invalid/unbound.jpg"],
      },
    ],
  });

  assert.deepEqual(result.canonical.images, []);
  assert.equal(result.quarantines.at(-1).code, "orphan_prepared_images");
});

test("a later staff edit refreshes an already-active override and preserves the source baseline", () => {
  const decision = detectStaffOverride(12_000_000, {
    last_published_value: 10_000_000,
    override_value: 11_000_000,
    active_override: true,
  });

  assert.equal(decision.active, true);
  assert.equal(decision.value, 12_000_000);
  assert.equal(decision.nextState.override_value, 12_000_000);
  assert.equal(decision.nextState.last_published_value, 10_000_000);
});

test("explicit null and empty staff values are sticky overrides, not missing values", () => {
  for (const currentValue of [null, "", []]) {
    const detected = detectStaffOverride(
      currentValue,
      { last_published_value: "source", override_value: null, active_override: false },
      { currentPresent: true },
    );
    assert.equal(detected.active, true);
    assert.deepEqual(detected.value, currentValue);

    const sticky = detectStaffOverride(
      currentValue,
      {
        last_published_value: currentValue,
        override_value: currentValue,
        active_override: true,
      },
      { currentPresent: true, sourcePresent: true, sourceValue: currentValue },
    );
    assert.equal(sticky.active, true);
  }
});

test("initial backfill protects a differing current value and seeds the reviewed source baseline", () => {
  const result = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      price: 12_000_000,
    },
    fieldStates: {},
    observations: [observation(SOURCE_28HSE, "3972991", "C003097", "sale", { price: 10_000_000 })],
  });

  assert.equal(result.fields.price.source, "staff_override");
  assert.equal(result.fields.price.value, 12_000_000);
  assert.deepEqual(result.fields.price.nextFieldState, {
    last_published_value: 10_000_000,
    override_value: 12_000_000,
    active_override: true,
  });
});

test("an absent current property is not confused with an explicit undefined staff edit", () => {
  const absent = reconcileProperty({
    current: { id: "p1", canonical_property_no: "C003097", deal_type: "sale" },
    fieldStates: {
      title_en: {
        last_published_value: "Old",
        override_value: null,
        active_override: false,
      },
    },
    observations: [observation(SOURCE_28HSE, "3972991", "C003097", "sale", { title_en: "New" })],
  });

  assert.equal(absent.fields.title_en.source, SOURCE_28HSE);
  assert.equal(absent.fields.title_en.value, "New");
});

test("a field-state record without a published baseline does not invent an override", () => {
  const result = reconcileProperty({
    current: {
      id: "p1",
      canonical_property_no: "C003097",
      deal_type: "sale",
      title_en: "Existing",
    },
    fieldStates: { title_en: { active_override: false } },
    observations: [observation(SOURCE_28HSE, "3972991", "C003097", "sale", { title_en: "Source" })],
  });

  assert.equal(result.fields.title_en.source, SOURCE_28HSE);
  assert.equal(result.fields.title_en.value, "Source");
});

test("malformed field-state metadata blocks automation and preserves current data", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale", {
    title_en: "Automated title",
    price: 11_000_000,
  });
  const cases = [
    {
      field: "title_en",
      current: { title_en: "Staff title" },
      state: { active_override: true, last_published_value: "Source title" },
      expected: "Staff title",
    },
    {
      field: "title_en",
      current: {},
      state: { active_override: true, override_value: "Stored override" },
      expected: null,
    },
    {
      field: "title_en",
      current: { title_en: "Staff title" },
      state: {
        active_override: "true",
        last_published_value: "Source title",
        override_value: "Staff title",
      },
      expected: "Staff title",
    },
    {
      field: "price",
      current: { price: 10_000_000 },
      state: { active_override: false, last_published_value: "not-a-number" },
      expected: 10_000_000,
    },
  ];

  for (const fixture of cases) {
    const result = reconcileProperty({
      current: {
        id: "p1",
        canonical_property_no: "C003097",
        deal_type: "sale",
        ...fixture.current,
      },
      fieldStates: { [fixture.field]: fixture.state },
      observations: [source],
    });
    assert.deepEqual(result.fields[fixture.field].value, fixture.expected);
    assert.notEqual(result.fields[fixture.field].value, undefined);
    assert.ok(result.validationEvidence.blockingCodes.includes("field_state_invalid"));
  }
});

test("updates preserve all non-reconciled current properties", () => {
  const current = {
    id: "p1",
    canonical_property_no: "C003097",
    deal_type: "sale",
    listing_no: "KEEP-NO",
    price: 10_000_000,
    featured: true,
    management_fee: 3_000,
    video_url: "https://owned.invalid/video",
    floorplan_url: "https://owned.invalid/floorplan",
    agent_id: "agent-1",
    seo_title: "Staff SEO",
    custom_admin_note: "Keep me",
  };
  const result = reconcileProperty({
    current,
    listingNo: "DO-NOT-REPLACE",
    fieldStates: {
      price: { last_published_value: 10_000_000, override_value: null, active_override: false },
    },
    observations: [observation(SOURCE_28HSE, "3972991", "C003097", "sale", { price: 11_000_000 })],
  });

  for (const field of [
    "listing_no",
    "featured",
    "management_fee",
    "video_url",
    "floorplan_url",
    "agent_id",
    "seo_title",
    "custom_admin_note",
  ]) {
    assert.deepEqual(result.canonical[field], current[field]);
  }
  assert.equal(result.canonical.listing_no, "KEEP-NO");
});

test("new rows receive only safe defaults and legacy columns require an explicitly linked old-site observation", () => {
  const old = observation(SOURCE_OLD_SITE, "6709182", "C003097", "sale");
  const base = {
    current: {},
    observations: [old],
    listingNo: "C003097-6709182-S",
    canonicalPropertyNo: "C003097",
    dealType: "sale",
  };
  const unlinked = reconcileProperty(base);
  assert.deepEqual(
    {
      featured: unlinked.canonical.featured,
      management_fee: unlinked.canonical.management_fee,
      video_url: unlinked.canonical.video_url,
      floorplan_url: unlinked.canonical.floorplan_url,
      source_site: unlinked.canonical.source_site,
    },
    {
      featured: false,
      management_fee: null,
      video_url: null,
      floorplan_url: null,
      source_site: "dual-source-mls",
    },
  );
  assert.equal(Object.hasOwn(unlinked.canonical, "legacy_detail_id"), false);
  assert.equal(Object.hasOwn(unlinked.canonical, "legacy_property_no"), false);
  assert.equal(Object.hasOwn(unlinked.canonical, "legacy_url"), false);

  const linked = reconcileProperty({ ...base, linkedObservationIds: [old.id] });
  assert.equal(linked.canonical.legacy_detail_id, "6709182");
  assert.equal(linked.canonical.legacy_property_no, "C003097");
  assert.equal(linked.canonical.legacy_url, old.sourceUrl);
});

test("every reconciled field exposes a complete provenance decision", () => {
  const result = reconcileProperty({
    current: {},
    observations: [observation(SOURCE_28HSE, "3972991", "C003097", "sale")],
  });
  assert.deepEqual(Object.keys(result.fields), [...RECONCILED_FIELDS]);
  for (const decision of Object.values(result.fields)) {
    assert.deepEqual(Object.keys(decision), [
      "value",
      "source",
      "observationId",
      "changed",
      "nextFieldState",
    ]);
  }
});

test("new proposal validation requires canonical identity, active value, status, and prepared-owned media", () => {
  const valid = validNewProposal();
  assert.deepEqual(validateCanonicalProposal(valid, validationOptions(valid)), []);
  const invalid = validNewProposal({
    listing_no: " ",
    title_zh: "",
    district_slug: null,
    deal_type: "lease",
    price: Number.POSITIVE_INFINITY,
    status: "published",
    images: ["https://media.28hse.example/hotlink.jpg"],
  });
  assert.deepEqual(
    validateCanonicalProposal(
      invalid,
      validationOptions(invalid, {
        evidenceOverrides: {
          media: { preparedImages: [], currentOwnedImages: [] },
        },
      }),
    ),
    [
      "missing_listing_no",
      "missing_title_zh",
      "missing_district_slug",
      "invalid_deal_type",
      "invalid_status",
      "missing_owned_primary_image",
    ],
  );
  const missingPrice = validNewProposal({ price: null });
  assert.deepEqual(validateCanonicalProposal(missingPrice, validationOptions(missingPrice)), [
    "invalid_sale_price",
  ]);
  const missingRent = validNewProposal({ deal_type: "rent", price: null, rent: 0 });
  assert.deepEqual(validateCanonicalProposal(missingRent, validationOptions(missingRent)), [
    "invalid_rent",
  ]);
});

test("all real canonical statuses are valid", () => {
  for (const status of ["draft", "active", "sold", "rented", "offline", "inactive"]) {
    const proposal = validNewProposal({ status });
    assert.deepEqual(validateCanonicalProposal(proposal, validationOptions(proposal)), []);
  }
});

test("updates require explicit current or prepared ownership evidence and cannot null required columns", () => {
  const update = validNewProposal({ id: "p1" });
  assert.deepEqual(validateCanonicalProposal(update, { kind: "update" }), [
    "missing_reconciliation_evidence",
    "missing_owned_primary_image",
  ]);
  assert.deepEqual(validateCanonicalProposal(update, validationOptions(update)), []);
  const invalidUpdate = { ...update, listing_no: null, title_zh: null };
  assert.deepEqual(validateCanonicalProposal(invalidUpdate, validationOptions(invalidUpdate)), [
    "missing_listing_no",
    "missing_title_zh",
  ]);
});

test("ownership evidence must cover the selected primary image, not only a secondary image", () => {
  const proposal = validNewProposal({
    images: ["https://unowned.invalid/primary.jpg", "https://owned.invalid/secondary.jpg"],
  });
  assert.deepEqual(
    validateCanonicalProposal(
      proposal,
      validationOptions(proposal, {
        evidenceOverrides: {
          media: {
            preparedImages: ["https://owned.invalid/secondary.jpg"],
            currentOwnedImages: [],
          },
        },
      }),
    ),
    ["missing_owned_primary_image"],
  );
});

test("proposal validation rejects an unknown explicit proposal kind", () => {
  const proposal = validNewProposal();
  assert.deepEqual(
    validateCanonicalProposal(proposal, validationOptions(proposal, { kind: "replace" })),
    ["invalid_proposal_kind"],
  );
});

test("proposal validation requires an already-normalized canonical identity", () => {
  const missing = validNewProposal({ canonical_property_no: null });
  assert.ok(
    validateCanonicalProposal(missing, validationOptions(missing)).includes(
      "missing_canonical_property_no",
    ),
  );

  const unnormalized = validNewProposal({ canonical_property_no: " c 003097 " });
  assert.ok(
    validateCanonicalProposal(unnormalized, validationOptions(unnormalized)).includes(
      "invalid_canonical_identity",
    ),
  );

  const targetMismatch = validNewProposal();
  assert.ok(
    validateCanonicalProposal(
      targetMismatch,
      validationOptions(targetMismatch, {
        evidenceOverrides: { targetMatchKey: "rent:C003097" },
      }),
    ).includes("invalid_canonical_identity"),
  );
});

test("update proposal identity cannot differ from supplied current identity evidence", () => {
  const update = validNewProposal({
    id: "p1",
    canonical_property_no: "C999999",
  });
  assert.ok(
    validateCanonicalProposal(
      update,
      validationOptions(update, {
        evidenceOverrides: {
          targetMatchKey: "sale:C003097",
          currentMatchKey: "sale:C003097",
        },
      }),
    ).includes("invalid_canonical_identity"),
  );
});

test("reconciled prepared-media evidence survives the brief's one-argument proposal example", () => {
  const source = observation(SOURCE_28HSE, "3972991", "C003097", "sale");
  const resolved = reconcileProperty({
    current: {},
    observations: [source],
    listingNo: "C003097-3972991-S",
    canonicalPropertyNo: "C003097",
    dealType: "sale",
    preparedImages: [preparedRecord(source, ["https://owned.invalid/listing.jpg"])],
  });

  assert.deepEqual(
    validateCanonicalProposal({
      ...resolved.canonical,
      title_zh: "",
    }),
    ["missing_title_zh"],
  );
});

test("proposal error codes are unique and deterministic", () => {
  const invalid = {
    listing_no: "",
    title_zh: "",
    district_slug: "",
    deal_type: "sale",
    price: false,
    status: "bad",
    images: [],
  };
  const first = validateCanonicalProposal(invalid, validationOptions(invalid));
  const clone = structuredClone(invalid);
  const second = validateCanonicalProposal(clone, validationOptions(clone));
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
});

test("lifecycle validates counters, resets degraded absence, and inactivates on the second full absence", () => {
  for (const consecutive of [-1, 1.5, "1", Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => nextLifecycleState({ consecutive, seen: false, mayAdvanceInactivity: true }),
      /nonnegative integer/,
    );
  }
  assert.deepEqual(
    nextLifecycleState({ consecutive: 1, seen: false, mayAdvanceInactivity: false }),
    { consecutive: 0, statusChange: null },
  );
  const once = nextLifecycleState({
    consecutive: 0,
    seen: false,
    mayAdvanceInactivity: true,
    currentStatus: "active",
  });
  const twice = nextLifecycleState({
    consecutive: once.consecutive,
    seen: false,
    mayAdvanceInactivity: true,
    currentStatus: "active",
  });
  assert.deepEqual(once, { consecutive: 1, statusChange: null });
  assert.deepEqual(twice, { consecutive: 2, statusChange: "inactive" });
  assert.deepEqual(
    nextLifecycleState({
      consecutive: 2,
      seen: false,
      mayAdvanceInactivity: true,
      currentStatus: "inactive",
    }),
    { consecutive: 3, statusChange: null },
  );
});

test("lifecycle requires exact boolean inputs and a valid supplied status", () => {
  const valid = {
    consecutive: 0,
    seen: false,
    mayAdvanceInactivity: true,
    currentStatus: "active",
    hasStatusOverride: false,
  };
  for (const invalid of [
    { ...valid, seen: 0 },
    { ...valid, mayAdvanceInactivity: "true" },
    { ...valid, hasStatusOverride: null },
    { ...valid, currentStatus: "published" },
  ]) {
    assert.throws(() => nextLifecycleState(invalid), /lifecycle input/);
  }

  assert.throws(
    () =>
      nextLifecycleState({
        ...valid,
        consecutive: Number.MAX_SAFE_INTEGER,
      }),
    /lifecycle input/,
  );
});

test("seen listings reset absence and reactivate even in degraded upsert mode", () => {
  assert.deepEqual(
    nextLifecycleState({
      consecutive: 2,
      seen: true,
      mayAdvanceInactivity: false,
      currentStatus: "inactive",
    }),
    { consecutive: 0, statusChange: "active" },
  );
  assert.deepEqual(
    nextLifecycleState({
      consecutive: 2,
      seen: true,
      mayAdvanceInactivity: true,
      currentStatus: "active",
    }),
    { consecutive: 0, statusChange: null },
  );
});

test("staff status overrides block lifecycle transitions and protect terminal statuses", () => {
  assert.deepEqual(
    nextLifecycleState({
      consecutive: 1,
      seen: false,
      mayAdvanceInactivity: true,
      currentStatus: "sold",
      hasStatusOverride: true,
    }),
    { consecutive: 2, statusChange: null },
  );
  assert.deepEqual(
    nextLifecycleState({
      consecutive: 2,
      seen: true,
      mayAdvanceInactivity: false,
      currentStatus: "inactive",
      hasStatusOverride: true,
    }),
    { consecutive: 0, statusChange: null },
  );
});
