import {
  DEAL_TYPES,
  OBSERVATION_SCHEMA_VERSION,
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  normalizePropertyNo,
  stableObservationHash,
} from "./source-contract.mjs";

const EXACT_LINK_REASON = "exact_property_no_and_deal_type";
const SOURCES = new Set([SOURCE_28HSE, SOURCE_OLD_SITE]);
const MEDIA_CATEGORIES = new Set([
  "listing_photo",
  "map",
  "floorplan",
  "qr",
  "vr",
  "branded",
  "unknown",
]);

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function compareStableValue(left, right) {
  return compareText(JSON.stringify(stableValue(left)), JSON.stringify(stableValue(right)));
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
    compareText(left?.id, right?.id) ||
    compareStableValue(left, right)
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

function isPlainRecord(value) {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function mediaCandidatesValid(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (candidate) =>
        isPlainRecord(candidate) &&
        typeof candidate.url === "string" &&
        candidate.url.trim() === candidate.url &&
        candidate.url.length > 0 &&
        MEDIA_CATEGORIES.has(candidate.category) &&
        typeof candidate.isPrimary === "boolean",
    )
  );
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function exactNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function exactNullableString(value) {
  return value === null || exactNonEmptyString(value);
}

function sourceUrlValid(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function hashMatches(observation) {
  if (typeof observation.contentHash !== "string") return false;
  return (
    stableObservationHash({
      schemaVersion: observation.schemaVersion,
      source: observation.source,
      externalId: observation.externalId,
      dealType: observation.dealType,
      propertyNoNormalized: observation.propertyNoNormalized,
      fields: observation.fields,
      rawFields: observation.rawFields,
      mediaCandidates: observation.mediaCandidates,
      sourceUpdatedAt: observation.sourceUpdatedAt ?? null,
    }) === observation.contentHash
  );
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
  if (
    observation.schemaVersion !== OBSERVATION_SCHEMA_VERSION ||
    !SOURCES.has(observation.source) ||
    !exactNonEmptyString(observation.externalId) ||
    /\s/.test(observation.externalId) ||
    !sourceUrlValid(observation.sourceUrl) ||
    !DEAL_TYPES.includes(observation.dealType) ||
    typeof observation.propertyNoRaw !== "string" ||
    observation.propertyNoNormalized !== normalizedPropertyNo ||
    !exactNullableString(observation.sourceUpdatedAt) ||
    !exactNonEmptyString(observation.discoveredAt) ||
    !exactNonEmptyString(observation.fetchedAt) ||
    !isPlainRecord(observation.fields) ||
    !isPlainRecord(observation.rawFields) ||
    !mediaCandidatesValid(observation.mediaCandidates) ||
    !stringArray(observation.quarantineReasons) ||
    observation.quarantineReasons.length !== 0 ||
    !stringArray(observation.parseWarnings) ||
    !hashMatches(observation)
  ) {
    return "observation_contract_invalid";
  }
  return null;
}

export function exactObservationQuarantineReason(observation) {
  return observationQuarantineReason(observation);
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

  const sortedMatched = new Map(
    [...matched.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([matchKey, group]) => [matchKey, group.sort(compareObservations)]),
  );
  quarantined.sort(
    (left, right) =>
      compareObservations(left.observation, right.observation) ||
      compareText(left.reason, right.reason),
  );
  return { matched: sortedMatched, quarantined };
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
  if (value == null) return null;
  const id = String(value);
  return exactNonEmptyString(id) ? id : null;
}

function linkPropertyId(link) {
  const value = link?.property_id ?? link?.propertyId;
  if (value == null) return null;
  const id = String(value);
  return exactNonEmptyString(id) ? id : null;
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
    const listingNumbers = new Set(rows.map((candidate) => candidate.listing_no ?? null));
    if (identities.size > 1 || listingNumbers.size > 1) identityConflicts.push(id);
    rows.sort(
      (left, right) =>
        compareText(
          normalizePropertyNo(left.canonical_property_no),
          normalizePropertyNo(right.canonical_property_no),
        ) ||
        compareText(left.deal_type, right.deal_type) ||
        compareText(left.listing_no, right.listing_no) ||
        compareStableValue(left, right),
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
    return [...identities].some((identity) =>
      identity.startsWith(`${link.source}\u0000${externalId}\u0000`),
    );
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
  let linkConflict = false;

  for (const link of links) {
    const id = linkPropertyId(link);
    const candidate = id == null ? null : candidatesById.get(id);
    if (
      link.link_reason !== EXACT_LINK_REASON ||
      link.deal_type !== identity.dealType ||
      link.match_key !== identity.matchKey ||
      id == null ||
      !candidate ||
      !exactCandidate(candidate, identity)
    ) {
      linkConflict = true;
      if (id != null) conflictingIds.push(id);
      continue;
    }
    linkedIds.push(id);
  }

  if (linkConflict) {
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
