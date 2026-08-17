import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  normalizePropertyNo,
} from "./source-contract.mjs";

export const RECONCILED_FIELDS = Object.freeze([
  "title_zh",
  "title_en",
  "estate_id",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
  "images",
  "status",
]);

export const CANONICAL_MEDIA_EVIDENCE = Symbol.for("earnestproperty.mls.canonical-media-evidence");

const NUMERIC_FIELDS = new Set(["price", "rent"]);
const INTEGER_FIELDS = new Set(["saleable_area", "gross_area", "bedrooms", "bathrooms"]);
const TEXT_FIELDS = new Set([
  "title_zh",
  "title_en",
  "estate_id",
  "district_slug",
  "address",
  "floor",
  "orientation",
  "description",
  "status",
]);
const CANONICAL_STATUSES = new Set(["draft", "active", "sold", "rented", "offline", "inactive"]);

function hasOwn(value, key) {
  return value != null && Object.prototype.hasOwnProperty.call(value, key);
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function finiteSafeNumber(value) {
  if (typeof value === "boolean" || value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return undefined;
    value = Number(trimmed);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) return undefined;
  return value;
}

function safeInteger(value) {
  if (typeof value === "boolean" || value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
    value = Number(trimmed);
  }
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function normalizeStringArray(value, { sort = false } = {}) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!sort) return normalized;
  return [...new Set(normalized)].sort(compareText);
}

export function normalizeCanonicalFieldValue(field, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (NUMERIC_FIELDS.has(field)) return finiteSafeNumber(value);
  if (INTEGER_FIELDS.has(field)) return safeInteger(value);
  if (field === "features") return normalizeStringArray(value, { sort: true });
  if (field === "images") return normalizeStringArray(value);
  if (TEXT_FIELDS.has(field)) return typeof value === "string" ? value.trim() : undefined;
  return cloneValue(value);
}

function normalizedState(field, state) {
  if (!state) return null;
  const normalized = { active_override: state.active_override === true };
  if (hasOwn(state, "last_published_value")) {
    normalized.last_published_value = normalizeCanonicalFieldValue(
      field,
      state.last_published_value,
    );
  }
  if (hasOwn(state, "override_value")) {
    normalized.override_value = normalizeCanonicalFieldValue(field, state.override_value);
  }
  return normalized;
}

function inactiveState(state) {
  if (!state) return null;
  return {
    last_published_value: cloneValue(state.last_published_value),
    override_value: cloneValue(state.override_value),
    active_override: false,
  };
}

export function detectStaffOverride(currentValue, state, options = {}) {
  const currentPresent = options.currentPresent ?? true;
  const sourcePresent = options.sourcePresent === true;
  const sourceValue = options.sourceValue;

  if (state?.active_override === true) {
    const storedOverride = state.override_value;
    if (!currentPresent) {
      return {
        active: true,
        value: cloneValue(storedOverride),
        newlyDetected: false,
        refreshed: false,
        nextState: {
          last_published_value: cloneValue(state.last_published_value),
          override_value: cloneValue(storedOverride),
          active_override: true,
        },
      };
    }
    const refreshed = !stableEqual(currentValue, storedOverride);
    return {
      active: true,
      value: cloneValue(currentValue),
      newlyDetected: false,
      refreshed,
      nextState: {
        last_published_value: cloneValue(state.last_published_value),
        override_value: cloneValue(currentValue),
        active_override: true,
      },
    };
  }

  if (
    state &&
    currentPresent &&
    hasOwn(state, "last_published_value") &&
    !stableEqual(currentValue, state.last_published_value)
  ) {
    return {
      active: true,
      value: cloneValue(currentValue),
      newlyDetected: true,
      refreshed: false,
      nextState: {
        last_published_value: cloneValue(state.last_published_value),
        override_value: cloneValue(currentValue),
        active_override: true,
      },
    };
  }

  if (!state && currentPresent && sourcePresent && !stableEqual(currentValue, sourceValue)) {
    return {
      active: true,
      value: cloneValue(currentValue),
      newlyDetected: true,
      refreshed: false,
      nextState: {
        last_published_value: cloneValue(sourceValue),
        override_value: cloneValue(currentValue),
        active_override: true,
      },
    };
  }

  return {
    active: false,
    value: undefined,
    newlyDetected: false,
    refreshed: false,
    nextState: inactiveState(state),
  };
}

function sourceRank(source) {
  if (source === SOURCE_28HSE) return 0;
  if (source === SOURCE_OLD_SITE) return 1;
  return 2;
}

function observationId(observation) {
  return String(
    observation?.id ??
      observation?.observationId ??
      `${observation?.source}:${observation?.externalId}:${observation?.dealType}`,
  );
}

function compareCandidates(left, right) {
  return (
    sourceRank(left.source) - sourceRank(right.source) ||
    compareText(left.externalId, right.externalId) ||
    compareText(left.observationId, right.observationId)
  );
}

function isValidObservation(observation) {
  if (!observation || observation.validationState !== "valid") return false;
  return (
    buildMatchKey(observation.propertyNoNormalized, observation.dealType) === observation.matchKey
  );
}

function automatedPresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function preparedImageCandidates(records, observations, quarantines) {
  const candidates = [];
  for (const record of records ?? []) {
    if (!record || Array.isArray(record) || typeof record !== "object") continue;
    const images = normalizeCanonicalFieldValue("images", record.images);
    const hasExactIdentity = record.observationId != null || record.externalId != null;
    const matched =
      hasExactIdentity &&
      observations.find((observation) => {
        const idMatches =
          record.observationId == null ||
          String(record.observationId) === observationId(observation);
        const externalMatches =
          record.externalId == null || String(record.externalId) === String(observation.externalId);
        return record.source === observation.source && idMatches && externalMatches;
      });
    if (!matched || !automatedPresent(images)) {
      quarantines.push({
        code: "orphan_prepared_images",
        observationId: record.observationId == null ? null : String(record.observationId),
      });
      continue;
    }
    candidates.push({
      source: matched.source,
      externalId: String(matched.externalId),
      observationId: observationId(matched),
      value: images,
    });
  }
  return candidates.sort(compareCandidates);
}

function sourceValue(observation, field, estateIdsBySlug) {
  if (field === "images") return undefined;
  if (field === "description" && observation.source === SOURCE_28HSE) return undefined;
  if (field === "estate_id") {
    const slug = normalizeCanonicalFieldValue("district_slug", observation.fields?.estate_slug);
    if (!slug || !(estateIdsBySlug instanceof Map)) return undefined;
    return normalizeCanonicalFieldValue("estate_id", estateIdsBySlug.get(slug));
  }
  return normalizeCanonicalFieldValue(field, observation.fields?.[field]);
}

function candidatesForField(field, observations, estateIdsBySlug, preparedCandidates) {
  if (field === "images") return preparedCandidates;
  return observations
    .map((observation) => ({
      source: observation.source,
      externalId: String(observation.externalId),
      observationId: observationId(observation),
      value: sourceValue(observation, field, estateIdsBySlug),
    }))
    .filter((candidate) => automatedPresent(candidate.value))
    .sort(compareCandidates);
}

function chooseSourceCandidate(field, candidates, conflicts, quarantines) {
  for (const source of [SOURCE_28HSE, SOURCE_OLD_SITE]) {
    const fromSource = candidates.filter((candidate) => candidate.source === source);
    if (!fromSource.length) continue;
    const distinctValues = new Set(
      fromSource.map((candidate) => JSON.stringify(stableValue(candidate.value))),
    );
    if (distinctValues.size > 1) {
      const conflict = {
        code: "source_value_conflict",
        field,
        source,
        observationIds: fromSource.map(({ observationId: id }) => id),
      };
      conflicts.push(conflict);
      quarantines.push(cloneValue(conflict));
    }
    return fromSource[0];
  }
  return null;
}

function normalizeEvidenceImages(value) {
  const images = normalizeCanonicalFieldValue("images", value);
  return Array.isArray(images) ? images : [];
}

function attachMediaEvidence(canonical, preparedImages, currentOwnedImages) {
  Object.defineProperty(canonical, CANONICAL_MEDIA_EVIDENCE, {
    value: Object.freeze({
      preparedImages: Object.freeze([...preparedImages]),
      currentOwnedImages: Object.freeze([...currentOwnedImages]),
    }),
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

function observationIdentity(observation) {
  return {
    dealType: observation?.dealType,
    propertyNo: normalizePropertyNo(observation?.propertyNoNormalized),
  };
}

export function reconcileProperty(input) {
  const current = input?.current && typeof input.current === "object" ? input.current : {};
  const fieldStates = input?.fieldStates ?? {};
  const estateIdsBySlug = input?.estateIdsBySlug ?? new Map();
  const conflicts = [];
  const quarantines = [];
  const validObservations = [];

  for (const observation of input?.observations ?? []) {
    if (isValidObservation(observation)) validObservations.push(observation);
    else {
      quarantines.push({
        code: "observation_not_valid",
        observationId: observationId(observation),
      });
    }
  }
  validObservations.sort(
    (left, right) =>
      sourceRank(left.source) - sourceRank(right.source) ||
      compareText(left.externalId, right.externalId) ||
      compareText(observationId(left), observationId(right)),
  );
  const requestedMatchKey =
    input?.matchKey ?? buildMatchKey(current.canonical_property_no, current.deal_type);
  const matchKeys = [...new Set(validObservations.map(({ matchKey }) => matchKey))].sort(
    compareText,
  );
  if (matchKeys.length > 1) {
    if (requestedMatchKey && matchKeys.includes(requestedMatchKey)) {
      for (let index = validObservations.length - 1; index >= 0; index -= 1) {
        if (validObservations[index].matchKey !== requestedMatchKey) {
          quarantines.push({
            code: "observation_identity_mismatch",
            observationId: observationId(validObservations[index]),
          });
          validObservations.splice(index, 1);
        }
      }
    } else {
      const conflict = { code: "mixed_exact_identities", matchKeys };
      conflicts.push(conflict);
      quarantines.push(cloneValue(conflict));
      validObservations.length = 0;
    }
  }

  const preparedCandidates = preparedImageCandidates(
    input?.preparedImages,
    validObservations,
    quarantines,
  );
  const fields = {};
  const currentIsUpdate = hasOwn(current, "id") && current.id != null;
  const isUpdate = input?.kind === "update" || (input?.kind !== "new" && currentIsUpdate);
  const canonical = isUpdate
    ? cloneValue(current)
    : {
        featured: false,
        management_fee: null,
        video_url: null,
        floorplan_url: null,
        source_site: "dual-source-mls",
      };

  const firstIdentity = observationIdentity(validObservations[0]);
  if (!isUpdate && input?.listingNo !== undefined) canonical.listing_no = input.listingNo;
  if (!isUpdate || input?.canonicalPropertyNo !== undefined) {
    const canonicalPropertyNo = normalizePropertyNo(
      input?.canonicalPropertyNo ?? firstIdentity.propertyNo,
    );
    if (canonicalPropertyNo) canonical.canonical_property_no = canonicalPropertyNo;
  }
  if (!isUpdate || input?.dealType !== undefined) {
    canonical.deal_type = input?.dealType ?? firstIdentity.dealType;
  }

  for (const field of RECONCILED_FIELDS) {
    const currentPropertyPresent = hasOwn(current, field);
    const normalizedCurrent = currentPropertyPresent
      ? normalizeCanonicalFieldValue(field, current[field])
      : undefined;
    const usableCurrent = currentPropertyPresent && normalizedCurrent !== undefined;
    const sourceCandidate = chooseSourceCandidate(
      field,
      candidatesForField(field, validObservations, estateIdsBySlug, preparedCandidates),
      conflicts,
      quarantines,
    );
    const sourcePresent = sourceCandidate != null;
    const state = hasOwn(fieldStates, field) ? normalizedState(field, fieldStates[field]) : null;
    const override = detectStaffOverride(normalizedCurrent, state, {
      currentPresent: usableCurrent,
      sourcePresent,
      sourceValue: sourceCandidate?.value,
    });

    let value;
    let source;
    let winningObservationId;
    let nextFieldState;

    if (override.active) {
      value = cloneValue(override.value);
      source = "staff_override";
      winningObservationId = null;
      nextFieldState = override.nextState;
    } else if (sourceCandidate) {
      value = cloneValue(sourceCandidate.value);
      source = sourceCandidate.source;
      winningObservationId = sourceCandidate.observationId;
      nextFieldState = {
        last_published_value: cloneValue(value),
        override_value: null,
        active_override: false,
      };
    } else if (usableCurrent) {
      value = cloneValue(normalizedCurrent);
      source = "current";
      winningObservationId = null;
      nextFieldState = override.nextState;
    } else {
      value = field === "features" || field === "images" ? [] : null;
      source = null;
      winningObservationId = null;
      nextFieldState = override.nextState;
    }

    const changed = usableCurrent
      ? !stableEqual(value, normalizedCurrent)
      : sourceCandidate != null || override.active;
    fields[field] = {
      value,
      source,
      observationId: winningObservationId,
      changed,
      nextFieldState,
    };
    canonical[field] = cloneValue(value);
  }

  if (!isUpdate) {
    const linkedIds = new Set((input?.linkedObservationIds ?? []).map(String));
    const linkedOldSite = validObservations.find(
      (observation) =>
        observation.source === SOURCE_OLD_SITE && linkedIds.has(observationId(observation)),
    );
    if (linkedOldSite) {
      canonical.legacy_detail_id = String(linkedOldSite.externalId);
      canonical.legacy_property_no = linkedOldSite.propertyNoNormalized;
      canonical.legacy_url = linkedOldSite.sourceUrl;
    }
  }

  quarantines.sort(
    (left, right) =>
      compareText(left.code, right.code) ||
      compareText(left.field, right.field) ||
      compareText(left.source, right.source) ||
      compareText(left.observationId, right.observationId),
  );
  const preparedEvidence = preparedCandidates.flatMap(({ value }) => value);
  const currentOwnedImages = normalizeEvidenceImages(input?.currentOwnedImages);
  attachMediaEvidence(canonical, preparedEvidence, currentOwnedImages);

  return { fields, canonical, conflicts, quarantines };
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function evidenceFromProposal(proposal, options) {
  const attached = proposal?.[CANONICAL_MEDIA_EVIDENCE] ?? {};
  return {
    preparedImages: normalizeEvidenceImages(options.preparedImages ?? attached.preparedImages),
    currentOwnedImages: normalizeEvidenceImages(
      options.currentOwnedImages ?? attached.currentOwnedImages,
    ),
  };
}

export function validateCanonicalProposal(proposal, options = {}) {
  const value = proposal && typeof proposal === "object" ? proposal : {};
  const kind = options.kind ?? (value.id == null ? "new" : "update");
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };

  if (kind !== "new" && kind !== "update") add("invalid_proposal_kind");

  if (!nonEmptyText(value.listing_no)) add("missing_listing_no");
  if (!nonEmptyText(value.title_zh)) add("missing_title_zh");
  if (!nonEmptyText(value.district_slug)) add("missing_district_slug");
  const dealTypeValid = value.deal_type === "sale" || value.deal_type === "rent";
  if (!dealTypeValid) add("invalid_deal_type");
  if (!CANONICAL_STATUSES.has(value.status)) add("invalid_status");

  const requireActiveValue = kind === "new" || value.status === "active";
  if (dealTypeValid && requireActiveValue) {
    if (value.deal_type === "sale") {
      const price = normalizeCanonicalFieldValue("price", value.price);
      if (!(typeof price === "number" && price > 0)) add("invalid_sale_price");
    } else {
      const rent = normalizeCanonicalFieldValue("rent", value.rent);
      if (!(typeof rent === "number" && rent > 0)) add("invalid_rent");
    }
  }

  const proposalImages = normalizeEvidenceImages(value.images);
  const evidence = evidenceFromProposal(value, options);
  const eligibleEvidence =
    kind === "new"
      ? evidence.preparedImages
      : [...evidence.preparedImages, ...evidence.currentOwnedImages];
  if (!proposalImages.length || !eligibleEvidence.includes(proposalImages[0])) {
    add("missing_owned_primary_image");
  }
  return errors;
}

export function nextLifecycleState({
  consecutive,
  seen,
  mayAdvanceInactivity,
  currentStatus,
  hasStatusOverride = false,
}) {
  if (!Number.isInteger(consecutive) || consecutive < 0) {
    throw new TypeError("consecutive must be a nonnegative integer");
  }
  if (seen) {
    return {
      consecutive: 0,
      statusChange: currentStatus === "inactive" && !hasStatusOverride ? "active" : null,
    };
  }
  if (!mayAdvanceInactivity) return { consecutive: 0, statusChange: null };

  const nextConsecutive = consecutive + 1;
  const shouldInactivate =
    nextConsecutive >= 2 && currentStatus !== "inactive" && !hasStatusOverride;
  return {
    consecutive: nextConsecutive,
    statusChange: shouldInactivate ? "inactive" : null,
  };
}
