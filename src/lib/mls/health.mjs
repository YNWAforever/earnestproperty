const DEAL_TYPES = ["sale", "rent"];
const SOURCE_28HSE = "28hse_agent_540";
const SOURCE_OLD_SITE = "old_site";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isCountSnapshot(value) {
  return isRecord(value) && isCount(value.sale) && isCount(value.rent);
}

function isSuccessfulSnapshot(value) {
  return isCountSnapshot(value) && value.sale + value.rent > 0;
}

function isSupportedSource(value) {
  return value === SOURCE_OLD_SITE || value === SOURCE_28HSE;
}

function isExternalId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/\s/u.test(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isPropertyNumber(value) {
  return typeof value === "string" && /^[A-Z0-9-]+$/.test(value);
}

function isCoreValidObservation(observation) {
  if (observation.validationState !== "valid") return false;
  if (!Array.isArray(observation.quarantineReasons) || observation.quarantineReasons.length > 0) {
    return false;
  }
  if (!isPropertyNumber(observation.propertyNoNormalized) || !isRecord(observation.fields)) {
    return false;
  }
  const activePrice =
    observation.dealType === "sale" ? observation.fields.price : observation.fields.rent;
  if (observation.dealType === "sale" || observation.dealType === "rent") {
    return typeof activePrice === "number" && Number.isFinite(activePrice) && activePrice > 0;
  }
  return false;
}

function analyzeIdentityEvidence(sourceResult, discovered) {
  const observations = Array.isArray(sourceResult.observations) ? sourceResult.observations : [];
  const byIdentity = new Map();
  let invalidIdentity = !Array.isArray(sourceResult.observations);

  for (const observation of observations) {
    if (
      !isRecord(observation) ||
      observation.source !== sourceResult.source ||
      !isExternalId(observation.externalId) ||
      !DEAL_TYPES.includes(observation.dealType)
    ) {
      invalidIdentity = true;
      continue;
    }
    const key = `${observation.dealType}:${observation.externalId}`;
    const group = byIdentity.get(key) ?? [];
    group.push(observation);
    byIdentity.set(key, group);
  }

  if (observations.length !== discovered || byIdentity.size !== discovered) {
    invalidIdentity = true;
  }

  let validUnique = 0;
  const uniqueCounts = { sale: 0, rent: 0 };
  for (const group of byIdentity.values()) {
    if (group.length !== 1) {
      invalidIdentity = true;
      continue;
    }
    const [observation] = group;
    uniqueCounts[observation.dealType] += 1;
    if (isCoreValidObservation(observation)) validUnique += 1;
  }

  validUnique = Math.max(0, validUnique - Math.max(0, byIdentity.size - discovered));

  return { invalidIdentity, uniqueCounts, validUnique };
}

function normalizeCurrentCounts(sourceResult, uniqueCounts, discovered) {
  if (!isCountSnapshot(sourceResult.advertisedCounts)) {
    return { counts: { sale: 0, rent: 0 }, invalid: true, inconsistent: false };
  }
  const advertised = sourceResult.advertisedCounts;
  const advertisedTotal = advertised.sale + advertised.rent;
  const uniqueTotal = uniqueCounts.sale + uniqueCounts.rent;
  if (advertisedTotal === 0) {
    const oldSiteFallback = sourceResult.source === SOURCE_OLD_SITE;
    return {
      counts: oldSiteFallback ? { ...uniqueCounts } : { ...advertised },
      invalid: false,
      inconsistent: oldSiteFallback
        ? uniqueTotal !== discovered
        : discovered > 0 || uniqueTotal > 0,
    };
  }
  return {
    counts: { ...advertised },
    invalid: false,
    inconsistent:
      advertised.sale !== uniqueCounts.sale ||
      advertised.rent !== uniqueCounts.rent ||
      advertisedTotal !== discovered ||
      uniqueTotal !== discovered,
  };
}

function hasValidPaginationEvidence(sourceResult) {
  const pageCounts = sourceResult.pageCounts;
  if (!isCountSnapshot(pageCounts)) return false;
  return sourceResult.paginationComplete !== true || (pageCounts.sale > 0 && pageCounts.rent > 0);
}

function normalizeHistory(previousSuccessful, rollingCounts) {
  let invalid = false;
  let previous = null;
  if (previousSuccessful !== undefined && previousSuccessful !== null) {
    if (isSuccessfulSnapshot(previousSuccessful)) previous = previousSuccessful;
    else invalid = true;
  }

  let rolling = [];
  if (rollingCounts !== undefined && rollingCounts !== null) {
    if (!Array.isArray(rollingCounts)) {
      invalid = true;
    } else {
      const successful = [];
      for (const snapshot of rollingCounts) {
        if (isSuccessfulSnapshot(snapshot)) successful.push(snapshot);
        else invalid = true;
      }
      rolling = successful.slice(-7);
    }
  }

  return {
    invalid,
    previous,
    rolling,
    baselineRequired: previous === null && rolling.length === 0,
  };
}

function baselineFor(dealType, history) {
  const candidates = [];
  if (history.previous) {
    candidates.push(
      dealType === "combined"
        ? history.previous.sale + history.previous.rent
        : history.previous[dealType],
    );
  }
  if (history.rolling.length) {
    const rollingValues = history.rolling.map((snapshot) =>
      dealType === "combined" ? snapshot.sale + snapshot.rent : snapshot[dealType],
    );
    candidates.push(median(rollingValues));
  }
  const nonzero = candidates.filter((value) => value > 0);
  return nonzero.length ? Math.max(...nonzero) : null;
}

function minimumFloor(baseline, maximumDropFraction) {
  return baseline === null ? null : baseline * (1 - maximumDropFraction);
}

function belowFloor(observed, floor) {
  return floor !== null && observed < floor;
}

function isHealthDecision(value, source) {
  if (!isRecord(value) || value.source !== source || typeof value.healthy !== "boolean") {
    return false;
  }
  if (Object.hasOwn(value, "baselineRequired") && typeof value.baselineRequired !== "boolean") {
    return false;
  }
  if (
    Object.hasOwn(value, "reasons") &&
    (!Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === "string"))
  ) {
    return false;
  }
  return !value.healthy || (value.reasons ?? []).length === 0;
}

export function median(values) {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("median values must be finite numbers");
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateSourceHealth(sourceResult, options = {}) {
  if (!isRecord(sourceResult)) throw new TypeError("sourceResult must be an object");
  if (!isRecord(options)) throw new TypeError("health options must be an object");

  const {
    previousSuccessful,
    rollingCounts,
    maximumDropFraction = 0.3,
    minimumParseRate = 0.98,
  } = options;
  if (
    !Number.isFinite(maximumDropFraction) ||
    maximumDropFraction < 0 ||
    maximumDropFraction >= 1
  ) {
    throw new RangeError("maximumDropFraction must be at least zero and less than one");
  }
  if (!Number.isFinite(minimumParseRate) || minimumParseRate < 0 || minimumParseRate > 1) {
    throw new RangeError("minimumParseRate must be between zero and one");
  }

  const discoveredIsValid = isCount(sourceResult.discovered);
  const discovered = discoveredIsValid ? sourceResult.discovered : 0;
  const evidence = analyzeIdentityEvidence(sourceResult, discovered);
  if (!discoveredIsValid) evidence.invalidIdentity = true;
  const parseRate = discovered > 0 ? Math.min(evidence.validUnique, discovered) / discovered : 0;
  const current = normalizeCurrentCounts(sourceResult, evidence.uniqueCounts, discovered);
  const counts = {
    ...current.counts,
    combined: current.counts.sale + current.counts.rent,
  };
  const history = normalizeHistory(previousSuccessful, rollingCounts);
  const floors = {
    sale: minimumFloor(baselineFor("sale", history), maximumDropFraction),
    rent: minimumFloor(baselineFor("rent", history), maximumDropFraction),
    combined: minimumFloor(baselineFor("combined", history), maximumDropFraction),
  };

  const reasons = [];
  if (!isSupportedSource(sourceResult.source)) reasons.push("source_invalid");
  if (sourceResult.identityValid !== true) reasons.push("identity_invalid");
  if (sourceResult.robotsAllowed !== true) reasons.push("robots_disallowed");
  if (sourceResult.paginationComplete !== true) reasons.push("pagination_incomplete");
  if (!hasValidPaginationEvidence(sourceResult)) reasons.push("pagination_evidence_invalid");
  if (sourceResult.challengeDetected !== false) reasons.push("challenge_detected");
  if (discovered === 0) reasons.push("zero_inventory");
  if (evidence.invalidIdentity) reasons.push("identity_evidence_invalid");
  if (current.invalid) reasons.push("counts_invalid");
  if (current.inconsistent) reasons.push("counts_inconsistent");
  if (history.invalid) reasons.push("history_invalid");
  if (belowFloor(counts.sale, floors.sale)) reasons.push("sale_count_below_floor");
  if (belowFloor(counts.rent, floors.rent)) reasons.push("rent_count_below_floor");
  if (belowFloor(counts.combined, floors.combined)) reasons.push("combined_count_below_floor");
  if (parseRate < minimumParseRate) reasons.push("parse_rate_below_minimum");
  if (
    !Array.isArray(sourceResult.conflictingDuplicateIds) ||
    sourceResult.conflictingDuplicateIds.length > 0
  ) {
    reasons.push("conflicting_duplicate_ids");
  }

  return {
    source: typeof sourceResult.source === "string" ? sourceResult.source : null,
    healthy: reasons.length === 0,
    baselineRequired: history.baselineRequired,
    parseRate,
    validDiscovered: evidence.validUnique,
    discovered,
    counts,
    floors,
    reasons,
  };
}

export function evaluateRunGate({ oldSite, hse28 } = {}) {
  const hse28Valid = isHealthDecision(hse28, SOURCE_28HSE);
  const oldSiteValid = isHealthDecision(oldSite, SOURCE_OLD_SITE);
  const hse28Healthy = hse28Valid && hse28.healthy;
  const oldSiteHealthy = oldSiteValid && oldSite.healthy;
  const baselinePending =
    (hse28Valid && hse28.baselineRequired === true) ||
    (oldSiteValid && oldSite.baselineRequired === true);
  const reasons = [];

  if (!hse28Valid) reasons.push("28hse_decision_invalid");
  if (!oldSiteValid) reasons.push("old_site_decision_invalid");
  if (hse28Valid && !hse28.healthy) reasons.push("28hse_unhealthy");
  if (oldSiteValid && !oldSite.healthy) reasons.push("old_site_unhealthy");
  if (hse28Valid && hse28.baselineRequired === true) reasons.push("28hse_baseline_required");
  if (oldSiteValid && oldSite.baselineRequired === true) reasons.push("old_site_baseline_required");

  const mode = !hse28Healthy ? "blocked" : oldSiteHealthy ? "full" : "degraded";
  return {
    mode,
    mayPublishUpserts: hse28Healthy && !baselinePending,
    mayAdvanceInactivity: mode === "full" && !baselinePending,
    reasons,
  };
}
