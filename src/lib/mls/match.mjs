import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  normalizePropertyNo,
} from "./source-contract.mjs";

const EXACT_LINK_REASON = "exact_property_no_and_deal_type";

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function sourceRank(source) {
  if (source === SOURCE_28HSE) return 0;
  if (source === SOURCE_OLD_SITE) return 1;
  return 2;
}

function compareObservations(left, right) {
  return (
    sourceRank(left?.source) - sourceRank(right?.source) ||
    compareText(left?.externalId, right?.externalId) ||
    compareText(left?.dealType, right?.dealType) ||
    compareText(left?.id, right?.id)
  );
}

function parseMatchKey(matchKey) {
  if (typeof matchKey !== "string") return null;
  const matched = /^(sale|rent):([A-Z0-9-]+)$/.exec(matchKey);
  if (!matched) return null;
  const propertyNo = normalizePropertyNo(matched[2]);
  if (!propertyNo || buildMatchKey(propertyNo, matched[1]) !== matchKey) return null;
  return { dealType: matched[1], propertyNo, matchKey };
}

function observationQuarantineReason(observation) {
  if (!observation || observation.validationState !== "valid") return "observation_not_valid";
  if (typeof observation.matchKey !== "string") return "missing_match_key";
  if (!parseMatchKey(observation.matchKey)) return "malformed_match_key";
  const normalizedPropertyNo = normalizePropertyNo(observation.propertyNoNormalized);
  const normalizedRawPropertyNo = normalizePropertyNo(observation.propertyNoRaw);
  const expected = buildMatchKey(normalizedPropertyNo, observation.dealType);
  if (
    !expected ||
    expected !== observation.matchKey ||
    normalizedRawPropertyNo !== normalizedPropertyNo
  ) {
    return "match_key_identity_mismatch";
  }
  return null;
}

export function groupExactMatches(observations) {
  const matched = new Map();
  const quarantined = [];

  for (const observation of observations ?? []) {
    const reason = observationQuarantineReason(observation);
    if (reason) {
      quarantined.push({ observation, reason });
      continue;
    }
    const group = matched.get(observation.matchKey) ?? [];
    group.push(observation);
    matched.set(observation.matchKey, group);
  }

  for (const group of matched.values()) group.sort(compareObservations);
  quarantined.sort(
    (left, right) =>
      compareObservations(left.observation, right.observation) ||
      compareText(left.reason, right.reason),
  );
  return { matched, quarantined };
}

function describeGroup(group) {
  const observations = Array.isArray(group)
    ? [...group]
    : Array.isArray(group?.observations)
      ? [...group.observations]
      : [];
  const keys = new Set(observations.map((observation) => observation?.matchKey).filter(Boolean));
  const matchKey = Array.isArray(group)
    ? keys.size === 1
      ? [...keys][0]
      : null
    : (group?.matchKey ?? (keys.size === 1 ? [...keys][0] : null));
  return {
    identity: parseMatchKey(matchKey),
    observations: observations.sort(compareObservations),
  };
}

function candidateId(candidate) {
  const value = candidate?.id ?? candidate?.property_id ?? candidate?.propertyId;
  return value == null ? null : String(value);
}

function linkPropertyId(link) {
  const value = link?.property_id ?? link?.propertyId;
  return value == null ? null : String(value);
}

function exactCandidate(candidate, identity) {
  return (
    normalizePropertyNo(candidate?.canonical_property_no) === identity.propertyNo &&
    candidate?.deal_type === identity.dealType
  );
}

function uniqueCandidates(candidates) {
  const groupedById = new Map();
  for (const candidate of candidates ?? []) {
    const id = candidateId(candidate);
    if (id == null) continue;
    const rows = groupedById.get(id) ?? [];
    rows.push(candidate);
    groupedById.set(id, rows);
  }
  const byId = new Map();
  const identityConflicts = [];
  for (const [id, rows] of groupedById) {
    const identities = new Set(
      rows.map(
        (candidate) =>
          `${normalizePropertyNo(candidate.canonical_property_no) ?? ""}\u0000${candidate.deal_type ?? ""}`,
      ),
    );
    if (identities.size > 1) identityConflicts.push(id);
    rows.sort(
      (left, right) =>
        compareText(
          normalizePropertyNo(left.canonical_property_no),
          normalizePropertyNo(right.canonical_property_no),
        ) ||
        compareText(left.deal_type, right.deal_type) ||
        compareText(left.listing_no, right.listing_no),
    );
    byId.set(id, rows[0]);
  }
  return { byId, identityConflicts };
}

function observationIdentitySet(observations) {
  return new Set(
    observations.map(
      (observation) =>
        `${observation.source}\u0000${observation.externalId}\u0000${observation.dealType}`,
    ),
  );
}

function relevantActiveLinks(observations, sourceLinks) {
  const identities = observationIdentitySet(observations);
  return (sourceLinks ?? []).filter((link) => {
    if (link?.status !== "active") return false;
    const externalId = link.external_listing_id ?? link.externalId;
    return identities.has(`${link.source}\u0000${externalId}\u0000${link.deal_type}`);
  });
}

function ambiguous(reason, candidateIds) {
  return {
    kind: "ambiguous",
    reason,
    candidateIds: [...new Set(candidateIds.filter((id) => id != null).map(String))].sort(
      compareText,
    ),
  };
}

function existingOutcome(candidate, identity) {
  const id = candidateId(candidate);
  return {
    kind: "existing",
    property: candidate,
    propertyId: id,
    listingNo: candidate.listing_no,
    matchKey: identity.matchKey,
  };
}

function preferredExternalId(observations) {
  for (const source of [SOURCE_28HSE, SOURCE_OLD_SITE]) {
    const externalIds = observations
      .filter((observation) => observation.source === source)
      .map((observation) => String(observation.externalId))
      .sort(compareText);
    if (externalIds.length) return externalIds[0];
  }
  return "NEW";
}

export function matchCanonicalProperty(group, candidates = [], sourceLinks = []) {
  const { identity, observations } = describeGroup(group);
  if (!identity) return ambiguous("invalid_match_key", []);

  const { byId: candidatesById, identityConflicts } = uniqueCandidates(candidates);
  if (identityConflicts.length) {
    return ambiguous("candidate_identity_conflict", identityConflicts);
  }
  const exactById = new Map(
    [...candidatesById].filter(([, candidate]) => exactCandidate(candidate, identity)),
  );
  const links = relevantActiveLinks(observations, sourceLinks);
  const linkedIds = [];
  const conflictingIds = [];

  for (const link of links) {
    if (link.link_reason !== EXACT_LINK_REASON) continue;
    const id = linkPropertyId(link);
    const candidate = id == null ? null : candidatesById.get(id);
    if (
      link.match_key !== identity.matchKey ||
      !candidate ||
      !exactCandidate(candidate, identity)
    ) {
      if (id != null) conflictingIds.push(id);
      continue;
    }
    linkedIds.push(id);
  }

  if (conflictingIds.length) {
    return ambiguous("link_identity_conflict", [...linkedIds, ...conflictingIds]);
  }
  const uniqueLinkedIds = [...new Set(linkedIds)].sort(compareText);
  if (uniqueLinkedIds.length > 1) return ambiguous("link_identity_conflict", uniqueLinkedIds);
  if (uniqueLinkedIds.length === 1) {
    return existingOutcome(exactById.get(uniqueLinkedIds[0]), identity);
  }

  const exactIds = [...exactById.keys()].sort(compareText);
  if (exactIds.length > 1) return ambiguous("ambiguous_canonical_match", exactIds);
  if (exactIds.length === 1) return existingOutcome(exactById.get(exactIds[0]), identity);

  const suffix = identity.dealType === "sale" ? "S" : "R";
  return {
    kind: "new",
    matchKey: identity.matchKey,
    propertyNo: identity.propertyNo,
    dealType: identity.dealType,
    listingNo: `${identity.propertyNo}-${preferredExternalId(observations)}-${suffix}`,
  };
}
