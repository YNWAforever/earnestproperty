import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  normalizePropertyNo,
  stableObservationHash,
} from "./source-contract.mjs";
import { exactObservationQuarantineReason } from "./match.mjs";

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

const RECONCILED_FIELD_NAMES = new Set(RECONCILED_FIELDS);

const RECONCILIATION_EVIDENCE = Symbol("earnestproperty.mls.reconciliation-evidence");
const RECONCILIATION_EVIDENCE_DOMAIN = "earnestproperty.mls.reconciliation-evidence.v1";

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
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const PERSISTED_OBSERVATION_REF_KEYS = new Set([
  "id",
  "source",
  "externalId",
  "dealType",
  "propertyNoNormalized",
  "matchKey",
  "contentHash",
]);

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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
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
  if (value.some((entry) => typeof entry !== "string")) return undefined;
  const normalized = value.map((entry) => entry.trim()).filter(Boolean);
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

function isPlainRecord(value) {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function normalizeStateValue(field, state, key) {
  if (!hasOwn(state, key)) return { present: false, value: undefined, valid: true };
  const value = normalizeCanonicalFieldValue(field, state[key]);
  return { present: true, value, valid: value !== undefined };
}

function validateFieldState(field, state, present) {
  if (!present) return { valid: true, state: null };
  if (!isPlainRecord(state) || typeof state.active_override !== "boolean") {
    return { valid: false, state: null };
  }
  const lastPublished = normalizeStateValue(field, state, "last_published_value");
  const override = normalizeStateValue(field, state, "override_value");
  if (
    !lastPublished.valid ||
    !override.valid ||
    (state.active_override && (!lastPublished.present || !override.present))
  ) {
    return { valid: false, state: null };
  }
  const normalized = { active_override: state.active_override === true };
  if (lastPublished.present) normalized.last_published_value = lastPublished.value;
  if (override.present) normalized.override_value = override.value;
  return { valid: true, state: normalized };
}

function stateFromRepositoryRow(row) {
  const state = {};
  for (const key of ["last_published_value", "override_value", "active_override"]) {
    if (hasOwn(row, key)) state[key] = cloneValue(row[key]);
  }
  return state;
}

function normalizeFieldStatesInput(input, current) {
  if (!hasOwn(input, "fieldStates") || input.fieldStates === undefined) {
    return { valid: true, states: {} };
  }
  const supplied = input.fieldStates;
  if (Array.isArray(supplied)) {
    const currentId = current?.id == null ? null : String(current.id);
    const states = {};
    const seen = new Set();
    let valid = currentId != null || supplied.length === 0;
    for (const row of supplied) {
      if (
        !isPlainRecord(row) ||
        typeof row.property_id !== "string" ||
        row.property_id.length === 0 ||
        row.property_id.trim() !== row.property_id ||
        !RECONCILED_FIELD_NAMES.has(row.field_name)
      ) {
        valid = false;
        continue;
      }
      const rowKey = `${row.property_id}\u0000${row.field_name}`;
      if (seen.has(rowKey)) valid = false;
      seen.add(rowKey);
      if (row.property_id === currentId) {
        states[row.field_name] = stateFromRepositoryRow(row);
      }
    }
    return { valid, states };
  }
  if (
    !isPlainRecord(supplied) ||
    Object.keys(supplied).some((field) => !RECONCILED_FIELD_NAMES.has(field))
  ) {
    return { valid: false, states: {} };
  }
  return { valid: true, states: supplied };
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

function normalizeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function explicitObservationId(observation) {
  const value = observation?.id ?? observation?.observationId;
  return normalizeUuid(value);
}

function observationCompositeKey(value) {
  return JSON.stringify([
    value?.source,
    value?.externalId,
    value?.dealType,
    value?.propertyNoNormalized,
    value?.matchKey,
    value?.contentHash,
  ]);
}

function observationMatchesPersistedRef(observation, ref) {
  return (
    ref != null &&
    observation.source === ref.source &&
    observation.externalId === ref.externalId &&
    observation.dealType === ref.dealType &&
    observation.propertyNoNormalized === ref.propertyNoNormalized &&
    observation.matchKey === ref.matchKey &&
    observation.contentHash === ref.contentHash
  );
}

function compareCandidates(left, right) {
  return (
    sourceRank(left.source) - sourceRank(right.source) ||
    compareText(left.externalId, right.externalId) ||
    compareText(left.observationId, right.observationId)
  );
}

function automatedPresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function addBlockingCode(blockingCodes, code) {
  if (!blockingCodes.includes(code)) blockingCodes.push(code);
}

function preparedImageCandidates(records, observationBindings, quarantines, blockingCodes) {
  const candidates = [];
  if (records == null) return candidates;
  if (!Array.isArray(records)) {
    quarantines.push({ code: "orphan_prepared_images", observationId: null });
    addBlockingCode(blockingCodes, "prepared_media_invalid");
    return candidates;
  }
  for (const record of records) {
    const images = isPlainRecord(record)
      ? normalizeCanonicalFieldValue("images", record.images)
      : undefined;
    const recordObservationId = isPlainRecord(record) ? normalizeUuid(record.observationId) : null;
    const matchingBindings =
      recordObservationId == null ? [] : (observationBindings.byId.get(recordObservationId) ?? []);
    const matchedBinding = matchingBindings.length === 1 ? matchingBindings[0] : null;
    const matched = matchedBinding?.observation;
    const identityMatches =
      matched &&
      record.source === matched.source &&
      record.externalId === matched.externalId &&
      record.dealType === matched.dealType &&
      record.matchKey === matched.matchKey;
    if (!identityMatches || !automatedPresent(images)) {
      quarantines.push({
        code: "orphan_prepared_images",
        observationId: record.observationId == null ? null : String(record.observationId),
      });
      addBlockingCode(blockingCodes, "prepared_media_invalid");
      continue;
    }
    candidates.push({
      source: matched.source,
      externalId: String(matched.externalId),
      observationId: matchedBinding.observationId,
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

function bindPersistedObservations(
  observations,
  persistedObservationRefs,
  quarantines,
  blockingCodes,
) {
  const bound = [];
  const byId = new Map();
  for (const observation of observations) {
    const enrichedId = explicitObservationId(observation);
    const persistedRef = persistedObservationRefs.get(observationCompositeKey(observation));
    if (!observationMatchesPersistedRef(observation, persistedRef)) {
      quarantines.push({
        code: "observation_provenance_unbound",
        observationId: enrichedId ?? observationId(observation),
        source: observation.source,
        externalId: observation.externalId,
        matchKey: observation.matchKey,
      });
      addBlockingCode(blockingCodes, "observation_provenance_unbound");
      continue;
    }
    const binding = { observation, observationId: persistedRef.id };
    bound.push(binding);
    const matchingBindings = byId.get(persistedRef.id) ?? [];
    matchingBindings.push(binding);
    byId.set(persistedRef.id, matchingBindings);
  }
  return { observations: bound, byId };
}

function candidatesForField(field, boundObservations, estateIdsBySlug, preparedCandidates) {
  if (field === "images") return preparedCandidates;
  return boundObservations
    .map(({ observation, observationId: persistedId }) => ({
      source: observation.source,
      externalId: String(observation.externalId),
      observationId: persistedId,
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
      continue;
    }
    return fromSource[0];
  }
  return null;
}

function normalizeEvidenceImages(value) {
  const images = normalizeCanonicalFieldValue("images", value);
  return Array.isArray(images) ? images : [];
}

function validationEvidencePayload(candidate) {
  return {
    schemaVersion: candidate.schemaVersion,
    targetMatchKey: candidate.targetMatchKey,
    currentMatchKey: candidate.currentMatchKey,
    blockingCodes: cloneValue(candidate.blockingCodes),
    conflicts: cloneValue(candidate.conflicts),
    quarantines: cloneValue(candidate.quarantines),
    media: cloneValue(candidate.media),
  };
}

function sealValidationEvidence(payload) {
  const evidence = validationEvidencePayload(payload);
  return {
    ...evidence,
    integrityHash: stableObservationHash({
      domain: RECONCILIATION_EVIDENCE_DOMAIN,
      evidence,
    }),
  };
}

function evidenceIntegrityValid(candidate) {
  if (
    typeof candidate.integrityHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.integrityHash)
  ) {
    return false;
  }
  const evidence = validationEvidencePayload(candidate);
  return (
    stableObservationHash({
      domain: RECONCILIATION_EVIDENCE_DOMAIN,
      evidence,
    }) === candidate.integrityHash
  );
}

function attachReconciliationEvidence(canonical, validationEvidence) {
  const authoritativeEvidence = deepFreeze(cloneValue(validationEvidence));
  Object.defineProperty(canonical, RECONCILIATION_EVIDENCE, {
    value: authoritativeEvidence,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

function identityFromParts(propertyNo, dealType) {
  const normalizedPropertyNo = normalizePropertyNo(propertyNo);
  const matchKey = buildMatchKey(normalizedPropertyNo, dealType);
  return matchKey ? { propertyNo: normalizedPropertyNo, dealType, matchKey } : null;
}

function parseCanonicalMatchKey(matchKey) {
  if (typeof matchKey !== "string") return null;
  const matched = /^(sale|rent):([A-Z0-9-]+)$/.exec(matchKey);
  if (!matched) return null;
  const identity = identityFromParts(matched[2], matched[1]);
  return identity?.matchKey === matchKey ? identity : null;
}

function pushConflict(conflicts, blockingCodes, code, details = {}) {
  conflicts.push({ code, ...details });
  addBlockingCode(blockingCodes, code);
}

function persistedObservationRefsFromInput(input, conflicts, quarantines, blockingCodes) {
  if (!hasOwn(input, "persistedObservationRefs") && !hasOwn(input, "persistedObservationIds")) {
    return new Map();
  }
  const supplied = input.persistedObservationRefs;
  const refs = new Map();
  const ids = new Set();
  const identities = new Set();
  let invalid = !Array.isArray(supplied);
  if (Array.isArray(supplied)) {
    for (const ref of supplied) {
      const ownKeys = isPlainRecord(ref) ? Reflect.ownKeys(ref) : [];
      const propertyNoNormalized = isPlainRecord(ref)
        ? normalizePropertyNo(ref.propertyNoNormalized)
        : null;
      const valid =
        isPlainRecord(ref) &&
        ownKeys.length === PERSISTED_OBSERVATION_REF_KEYS.size &&
        ownKeys.every(
          (key) => typeof key === "string" && PERSISTED_OBSERVATION_REF_KEYS.has(key),
        ) &&
        normalizeUuid(ref.id) === ref.id &&
        (ref.source === SOURCE_28HSE || ref.source === SOURCE_OLD_SITE) &&
        typeof ref.externalId === "string" &&
        ref.externalId.length > 0 &&
        ref.externalId.trim() === ref.externalId &&
        !/\s/.test(ref.externalId) &&
        (ref.dealType === "sale" || ref.dealType === "rent") &&
        propertyNoNormalized != null &&
        ref.propertyNoNormalized === propertyNoNormalized &&
        ref.matchKey === buildMatchKey(propertyNoNormalized, ref.dealType) &&
        typeof ref.contentHash === "string" &&
        CONTENT_HASH_PATTERN.test(ref.contentHash);
      if (!valid) {
        invalid = true;
        continue;
      }
      const identity = `${ref.source}\u0000${ref.externalId}\u0000${ref.dealType}`;
      const compositeKey = observationCompositeKey(ref);
      if (ids.has(ref.id) || identities.has(identity) || refs.has(compositeKey)) {
        invalid = true;
        continue;
      }
      refs.set(compositeKey, deepFreeze(cloneValue(ref)));
      ids.add(ref.id);
      identities.add(identity);
    }
  }
  if (!invalid) return refs;

  const conflict = { code: "persisted_observation_refs_invalid" };
  conflicts.push(conflict);
  quarantines.push(cloneValue(conflict));
  addBlockingCode(blockingCodes, conflict.code);
  return new Map();
}

function linkedOldSiteObservation(
  input,
  observationBindings,
  conflicts,
  quarantines,
  blockingCodes,
) {
  if (!hasOwn(input, "linkedObservationIds")) return null;
  const linkedObservationIds = input.linkedObservationIds;
  let invalid = !Array.isArray(linkedObservationIds);
  const linkedIds = new Set();
  if (Array.isArray(linkedObservationIds)) {
    for (const value of linkedObservationIds) {
      const id = normalizeUuid(value);
      if (id == null || !observationBindings.byId.has(id)) invalid = true;
      else linkedIds.add(id);
    }
  }

  for (const id of linkedIds) {
    if (observationBindings.byId.get(id)?.length !== 1) invalid = true;
  }
  if (invalid) {
    const conflict = { code: "legacy_link_invalid" };
    conflicts.push(conflict);
    quarantines.push(cloneValue(conflict));
    addBlockingCode(blockingCodes, conflict.code);
    return null;
  }
  const eligible = [...linkedIds]
    .map((id) => observationBindings.byId.get(id)[0])
    .filter(({ observation }) => observation.source === SOURCE_OLD_SITE)
    .sort((left, right) => compareText(left.observationId, right.observationId));
  if (eligible.length > 1) {
    const conflict = {
      code: "legacy_link_ambiguous",
      observationIds: eligible.map(({ observationId: id }) => id),
    };
    conflicts.push(conflict);
    quarantines.push(cloneValue(conflict));
    addBlockingCode(blockingCodes, conflict.code);
    return null;
  }
  return eligible[0]?.observation ?? null;
}

function resolveTargetIdentity({
  input,
  current,
  isUpdate,
  observations,
  conflicts,
  quarantines,
  blockingCodes,
}) {
  let target = null;
  let currentMatchKey = null;
  let identityBlocked = false;

  if (isUpdate) {
    target = identityFromParts(current.canonical_property_no, current.deal_type);
    currentMatchKey = target?.matchKey ?? null;
    if (!target) {
      pushConflict(conflicts, blockingCodes, "target_identity_conflict", {
        reason: "current_identity_invalid",
      });
      identityBlocked = true;
    }

    if (hasOwn(input, "matchKey")) {
      const explicit = parseCanonicalMatchKey(input.matchKey);
      if (!explicit || !target || explicit.matchKey !== target.matchKey) identityBlocked = true;
    }
    if (hasOwn(input, "canonicalPropertyNo")) {
      const explicitPropertyNo = normalizePropertyNo(input.canonicalPropertyNo);
      if (!explicitPropertyNo || !target || explicitPropertyNo !== target.propertyNo) {
        identityBlocked = true;
      }
    }
    if (hasOwn(input, "dealType") && (!target || input.dealType !== target.dealType)) {
      identityBlocked = true;
    }
    if (identityBlocked && !blockingCodes.includes("target_identity_conflict")) {
      pushConflict(conflicts, blockingCodes, "target_identity_conflict", {
        reason: "explicit_identity_disagreement",
      });
    }
  } else {
    const explicitIdentities = [];
    if (hasOwn(input, "matchKey")) {
      const explicit = parseCanonicalMatchKey(input.matchKey);
      if (explicit) explicitIdentities.push(explicit);
      else identityBlocked = true;
    }
    const hasExplicitPropertyNo = hasOwn(input, "canonicalPropertyNo");
    const hasExplicitDealType = hasOwn(input, "dealType");
    if (hasExplicitPropertyNo || hasExplicitDealType) {
      const explicit =
        hasExplicitPropertyNo && hasExplicitDealType
          ? identityFromParts(input.canonicalPropertyNo, input.dealType)
          : null;
      if (explicit) explicitIdentities.push(explicit);
      else identityBlocked = true;
    }
    const explicitKeys = [...new Set(explicitIdentities.map(({ matchKey }) => matchKey))];
    if (explicitKeys.length > 1) identityBlocked = true;
    if (identityBlocked) {
      pushConflict(conflicts, blockingCodes, "target_identity_conflict", {
        reason: "explicit_identity_disagreement",
      });
    } else if (explicitIdentities.length) {
      target = explicitIdentities[0];
    }
  }

  const observationKeys = [...new Set(observations.map(({ matchKey }) => matchKey))].sort(
    compareText,
  );
  if (!isUpdate && !target && !identityBlocked) {
    if (observationKeys.length === 1) target = parseCanonicalMatchKey(observationKeys[0]);
    else if (observationKeys.length === 0) {
      pushConflict(conflicts, blockingCodes, "target_identity_missing");
      identityBlocked = true;
    } else {
      pushConflict(conflicts, blockingCodes, "mixed_exact_identities", {
        matchKeys: observationKeys,
      });
      identityBlocked = true;
    }
  }

  const acceptedObservations = [];
  let observationMismatch = false;
  for (const observation of observations) {
    if (target && observation.matchKey === target.matchKey) acceptedObservations.push(observation);
    else {
      observationMismatch = true;
      quarantines.push({
        code: "observation_identity_mismatch",
        observationId: observationId(observation),
        matchKey: observation.matchKey,
      });
    }
  }
  if (observationMismatch) {
    if (isUpdate) addBlockingCode(blockingCodes, "observation_identity_mismatch");
    else addBlockingCode(blockingCodes, "target_identity_conflict");
    identityBlocked = true;
  }
  return {
    target,
    currentMatchKey,
    observations: identityBlocked ? [] : acceptedObservations,
  };
}

export function reconcileProperty(input) {
  const current = input?.current && typeof input.current === "object" ? input.current : {};
  const fieldStateInput = normalizeFieldStatesInput(input ?? {}, current);
  const fieldStates = fieldStateInput.states;
  const estateIdsBySlug = input?.estateIdsBySlug ?? new Map();
  const conflicts = [];
  const quarantines = [];
  const blockingCodes = [];
  const contractObservations = [];
  const currentIsUpdate = hasOwn(current, "id") && current.id != null;
  const isUpdate = input?.kind === "update" || currentIsUpdate;
  const persistedObservationRefs = persistedObservationRefsFromInput(
    input ?? {},
    conflicts,
    quarantines,
    blockingCodes,
  );

  for (const observation of input?.observations ?? []) {
    const contractReason = exactObservationQuarantineReason(observation);
    if (contractReason == null) contractObservations.push(observation);
    else {
      quarantines.push({
        code: "observation_not_valid",
        observationId: observationId(observation),
        reason: contractReason,
      });
    }
  }
  contractObservations.sort(
    (left, right) =>
      sourceRank(left.source) - sourceRank(right.source) ||
      compareText(left.externalId, right.externalId) ||
      compareText(observationId(left), observationId(right)),
  );
  const resolvedIdentity = resolveTargetIdentity({
    input: input ?? {},
    current,
    isUpdate,
    observations: contractObservations,
    conflicts,
    quarantines,
    blockingCodes,
  });
  const validObservations = resolvedIdentity.observations;
  if (!isUpdate && validObservations.length === 0) {
    addBlockingCode(blockingCodes, "missing_valid_observation");
  }
  const observationBindings = bindPersistedObservations(
    validObservations,
    persistedObservationRefs,
    quarantines,
    blockingCodes,
  );

  const preparedCandidates = preparedImageCandidates(
    input?.preparedImages,
    observationBindings,
    quarantines,
    blockingCodes,
  );
  const fields = {};
  const canonical = isUpdate
    ? cloneValue(current)
    : {
        featured: false,
        management_fee: null,
        video_url: null,
        floorplan_url: null,
        source_site: "dual-source-mls",
      };

  if (!isUpdate && input?.listingNo !== undefined) canonical.listing_no = input.listingNo;
  if (!isUpdate && resolvedIdentity.target) {
    canonical.canonical_property_no = resolvedIdentity.target.propertyNo;
    canonical.deal_type = resolvedIdentity.target.dealType;
  }

  for (const field of RECONCILED_FIELDS) {
    const currentPropertyPresent = hasOwn(current, field);
    const normalizedCurrent = currentPropertyPresent
      ? normalizeCanonicalFieldValue(field, current[field])
      : undefined;
    const usableCurrent = currentPropertyPresent && normalizedCurrent !== undefined;
    const sourceCandidate = chooseSourceCandidate(
      field,
      candidatesForField(
        field,
        observationBindings.observations,
        estateIdsBySlug,
        preparedCandidates,
      ),
      conflicts,
      quarantines,
    );
    const stateResult = fieldStateInput.valid
      ? validateFieldState(field, fieldStates[field], hasOwn(fieldStates, field))
      : { valid: false, state: null };
    if (!stateResult.valid) {
      const conflict = { code: "field_state_invalid", field };
      conflicts.push(conflict);
      quarantines.push(cloneValue(conflict));
      addBlockingCode(blockingCodes, "field_state_invalid");
      const value = usableCurrent
        ? cloneValue(normalizedCurrent)
        : field === "features" || field === "images"
          ? []
          : null;
      fields[field] = {
        value,
        source: usableCurrent ? "current" : null,
        observationId: null,
        changed: false,
        nextFieldState: null,
      };
      canonical[field] = cloneValue(value);
      continue;
    }
    const sourcePresent = sourceCandidate != null;
    const state = stateResult.state;
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
    const linkedOldSite = linkedOldSiteObservation(
      input ?? {},
      observationBindings,
      conflicts,
      quarantines,
      blockingCodes,
    );
    if (linkedOldSite) {
      canonical.legacy_detail_id = String(linkedOldSite.externalId);
      canonical.legacy_property_no = linkedOldSite.propertyNoNormalized;
      canonical.legacy_url = linkedOldSite.sourceUrl;
    }
  }

  for (const conflict of conflicts) addBlockingCode(blockingCodes, conflict.code);
  const preparedEvidence = preparedCandidates.flatMap(({ value }) => value);
  const currentOwnedImagesValue = normalizeCanonicalFieldValue("images", input?.currentOwnedImages);
  const currentOwnedImages = Array.isArray(currentOwnedImagesValue) ? currentOwnedImagesValue : [];
  if (hasOwn(input ?? {}, "currentOwnedImages") && !Array.isArray(currentOwnedImagesValue)) {
    addBlockingCode(blockingCodes, "prepared_media_invalid");
    quarantines.push({ code: "current_media_evidence_invalid", observationId: null });
  }
  quarantines.sort(
    (left, right) =>
      compareText(left.code, right.code) ||
      compareText(left.field, right.field) ||
      compareText(left.source, right.source) ||
      compareText(left.observationId, right.observationId),
  );
  const validationEvidence = deepFreeze(
    sealValidationEvidence({
      schemaVersion: 1,
      targetMatchKey: resolvedIdentity.target?.matchKey ?? null,
      currentMatchKey: resolvedIdentity.currentMatchKey,
      blockingCodes: [...blockingCodes],
      conflicts: cloneValue(conflicts),
      quarantines: cloneValue(quarantines),
      media: {
        preparedImages: [...preparedEvidence],
        currentOwnedImages: [...currentOwnedImages],
      },
    }),
  );
  attachReconciliationEvidence(canonical, validationEvidence);

  return { fields, canonical, conflicts, quarantines, validationEvidence };
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validMatchKeyOrNull(value) {
  return value === null || parseCanonicalMatchKey(value) != null;
}

function strictStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function strictNonEmptyStringArray(value) {
  return (
    strictStringArray(value) && value.every((entry) => entry.length > 0 && entry.trim() === entry)
  );
}

function codedEvidenceItems(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isPlainRecord(entry) &&
        typeof entry.code === "string" &&
        entry.code.length > 0 &&
        entry.code.trim() === entry.code,
    )
  );
}

function evidenceFromProposal(proposal, options) {
  const attached = proposal?.[RECONCILIATION_EVIDENCE];
  const candidate = hasOwn(options, "validationEvidence") ? options.validationEvidence : attached;
  const explicitEvidenceDisagrees =
    attached != null && hasOwn(options, "validationEvidence") && !stableEqual(attached, candidate);
  const conflictsCovered =
    isPlainRecord(candidate) &&
    strictStringArray(candidate.blockingCodes) &&
    Array.isArray(candidate.conflicts) &&
    candidate.conflicts.every(
      (conflict) => isPlainRecord(conflict) && candidate.blockingCodes.includes(conflict.code),
    );
  const mediaOptionsAgree =
    isPlainRecord(candidate?.media) &&
    (!hasOwn(options, "preparedImages") ||
      (strictNonEmptyStringArray(options.preparedImages) &&
        stableEqual(options.preparedImages, candidate.media.preparedImages))) &&
    (!hasOwn(options, "currentOwnedImages") ||
      (strictNonEmptyStringArray(options.currentOwnedImages) &&
        stableEqual(options.currentOwnedImages, candidate.media.currentOwnedImages)));
  if (
    explicitEvidenceDisagrees ||
    !isPlainRecord(candidate) ||
    candidate.schemaVersion !== 1 ||
    !validMatchKeyOrNull(candidate.targetMatchKey) ||
    !validMatchKeyOrNull(candidate.currentMatchKey) ||
    !strictNonEmptyStringArray(candidate.blockingCodes) ||
    !codedEvidenceItems(candidate.conflicts) ||
    !codedEvidenceItems(candidate.quarantines) ||
    !conflictsCovered ||
    !isPlainRecord(candidate.media) ||
    !strictNonEmptyStringArray(candidate.media.preparedImages) ||
    !strictNonEmptyStringArray(candidate.media.currentOwnedImages) ||
    !mediaOptionsAgree ||
    !evidenceIntegrityValid(candidate)
  ) {
    return {
      valid: false,
      targetMatchKey: null,
      currentMatchKey: null,
      blockingCodes: [],
      preparedImages: [],
      currentOwnedImages: [],
    };
  }
  return {
    valid: true,
    targetMatchKey: candidate.targetMatchKey,
    currentMatchKey: candidate.currentMatchKey,
    blockingCodes: [...new Set(candidate.blockingCodes)].sort(compareText),
    preparedImages: normalizeEvidenceImages(candidate.media.preparedImages),
    currentOwnedImages: normalizeEvidenceImages(candidate.media.currentOwnedImages),
  };
}

export function validateCanonicalProposal(proposal, options = {}) {
  const value = proposal && typeof proposal === "object" ? proposal : {};
  const kind = options.kind ?? (value.id == null ? "new" : "update");
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const evidence = evidenceFromProposal(value, options);

  if (kind !== "new" && kind !== "update") add("invalid_proposal_kind");
  if (!evidence.valid) add("missing_reconciliation_evidence");

  if (!nonEmptyText(value.listing_no)) add("missing_listing_no");
  if (!nonEmptyText(value.title_zh)) add("missing_title_zh");
  if (!nonEmptyText(value.district_slug)) add("missing_district_slug");
  const dealTypeValid = value.deal_type === "sale" || value.deal_type === "rent";
  if (!dealTypeValid) add("invalid_deal_type");
  const canonicalPropertyNo = normalizePropertyNo(value.canonical_property_no);
  if (!nonEmptyText(value.canonical_property_no)) add("missing_canonical_property_no");
  else if (canonicalPropertyNo !== value.canonical_property_no) add("invalid_canonical_identity");
  const proposalMatchKey = buildMatchKey(canonicalPropertyNo, value.deal_type);
  if (
    dealTypeValid &&
    canonicalPropertyNo &&
    evidence.valid &&
    (proposalMatchKey !== evidence.targetMatchKey ||
      (kind === "update" &&
        evidence.currentMatchKey != null &&
        proposalMatchKey !== evidence.currentMatchKey))
  ) {
    add("invalid_canonical_identity");
  }
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

  const proposalImages = Array.isArray(value.images) ? value.images : [];
  const eligibleEvidence =
    kind === "new"
      ? evidence.preparedImages
      : [...evidence.preparedImages, ...evidence.currentOwnedImages];
  if (
    !proposalImages.length ||
    typeof proposalImages[0] !== "string" ||
    proposalImages[0].length === 0 ||
    proposalImages[0].trim() !== proposalImages[0] ||
    !eligibleEvidence.includes(proposalImages[0])
  ) {
    add("missing_owned_primary_image");
  }
  if (
    proposalImages
      .slice(1)
      .some(
        (image) =>
          typeof image !== "string" ||
          image.length === 0 ||
          image.trim() !== image ||
          !eligibleEvidence.includes(image),
      )
  ) {
    add("unowned_canonical_image");
  }
  if (evidence.valid) {
    for (const code of evidence.blockingCodes) add(code);
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
  if (!Number.isSafeInteger(consecutive) || consecutive < 0 || consecutive > POSTGRES_INTEGER_MAX) {
    throw new TypeError("lifecycle input consecutive must be a nonnegative integer within INT");
  }
  if (
    typeof seen !== "boolean" ||
    typeof mayAdvanceInactivity !== "boolean" ||
    typeof hasStatusOverride !== "boolean" ||
    (currentStatus !== undefined && !CANONICAL_STATUSES.has(currentStatus))
  ) {
    throw new TypeError("lifecycle input must use exact booleans and a valid status");
  }
  if (seen) {
    return {
      consecutive: 0,
      statusChange: currentStatus === "inactive" && !hasStatusOverride ? "active" : null,
    };
  }
  if (!mayAdvanceInactivity) return { consecutive: 0, statusChange: null };

  const nextConsecutive = Math.min(consecutive + 1, 2);
  const shouldInactivate =
    nextConsecutive >= 2 && currentStatus !== "inactive" && !hasStatusOverride;
  return {
    consecutive: nextConsecutive,
    statusChange: shouldInactivate ? "inactive" : null,
  };
}
